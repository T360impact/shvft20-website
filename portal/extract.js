// Reads a partner's report in the browser: the text of a Word file (by
// heading, with its tables), each page of a PDF, or each sheet of a
// spreadsheet. The file itself never leaves the browser until its text has
// passed the identifying-details checks here, in the extract-report function
// and in the database.
// Served from this site (vendor/README.md), not a CDN.
const PDFJS = '/portal/vendor/pdf-3.11.174.min.js';
const PDFJS_WORKER = '/portal/vendor/pdf.worker-3.11.174.min.js';
const JSZIP = '/portal/vendor/jszip-3.10.1.min.js';
const XLSX_URL = '/portal/vendor/xlsx-0.20.3.mjs';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const SECTION_CHARS = 2500;

const scripts = {};
const loadScript = (src) => (scripts[src] ||= new Promise((ok, fail) => {
  const s = document.createElement('script');
  s.src = src; s.onload = ok; s.onerror = () => fail(new Error('The file reader didn\'t load. Check your connection and try again.'));
  document.head.append(s);
}));

export const fileType = (name) => {
  const ext = String(name).toLowerCase().split('.').pop();
  return { docx: 'docx', pdf: 'pdf', xlsx: 'xlsx', xls: 'xlsx', csv: 'csv' }[ext] || null;
};

// Word: paragraphs grouped under their headings, and each table on its own.
async function readDocx(buf) {
  await loadScript(JSZIP);
  const zip = await window.JSZip.loadAsync(buf);
  const xml = await zip.file('word/document.xml')?.async('string');
  if (!xml) throw new Error('This doesn\'t look like a Word document. Save it as .docx and try again.');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const body = doc.getElementsByTagNameNS(W, 'body')[0];
  const text = (node) => {
    let out = '';
    const walk = (n) => {
      for (const ch of n.childNodes) {
        if (ch.namespaceURI !== W) continue;
        if (ch.localName === 't') out += ch.textContent;
        else if (ch.localName === 'tab') out += ' ';
        else if (ch.localName === 'br' || ch.localName === 'cr') out += '\n';
        else if (ch.localName !== 'pPr' && ch.localName !== 'rPr') walk(ch);
      }
    };
    walk(node);
    return out.replace(/[ \t]+/g, ' ').trim();
  };
  const segs = [];
  let cur = null; let s = 0; let t = 0;
  const flush = () => { if (cur && cur.text.trim()) segs.push(cur); cur = null; };
  for (const el of body.children) {
    if (el.localName === 'p') {
      const style = el.getElementsByTagNameNS(W, 'pStyle')[0]?.getAttributeNS(W, 'val') || '';
      const line = text(el);
      if (!line) continue;
      if (/^(heading|title)/i.test(style)) { flush(); cur = { ref: `s${++s}`, kind: 'section', label: line.slice(0, 120), text: `${line}\n` }; continue; }
      if (!cur || cur.text.length > SECTION_CHARS) { const label = cur?.label || ''; flush(); cur = { ref: `s${++s}`, kind: 'section', label, text: '' }; }
      cur.text += `${line}\n`;
    } else if (el.localName === 'tbl') {
      const rows = [...el.getElementsByTagNameNS(W, 'tr')].filter((tr) => tr.parentNode === el)
        .map((tr) => [...tr.childNodes].filter((c) => /** @type {Element} */ (c).localName === 'tc').map((tc) => [.../** @type {Element} */ (tc).getElementsByTagNameNS(W, 'p')].map(text).join(' ').trim()));
      if (!rows.some((r) => r.some(Boolean))) continue;
      // Keep the document's order: the text before the table, the table, then the text after.
      const label = cur?.label || '';
      flush();
      segs.push({ ref: `t${++t}`, kind: 'table', label: `Table ${t}${label ? ` (${label})` : ''}`, rows });
      cur = { ref: `s${++s}`, kind: 'section', label, text: '' };
    }
  }
  flush();
  return segs;
}

// PDF: one passage per page, lines kept.
async function readPdf(buf) {
  await loadScript(PDFJS);
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const pdf = await window.pdfjsLib.getDocument({ data: buf, isEvalSupported: false }).promise;
  const segs = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    const textOut = tc.items.map((it) => it.str + (it.hasEOL ? '\n' : ' ')).join('').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();
    if (textOut) segs.push({ ref: `p${i}`, kind: 'page', page: i, label: `Page ${i}`, text: textOut });
  }
  if (!segs.length) throw new Error('No text could be read from this PDF. If it is a scan, upload the original document instead.');
  return segs;
}

// Spreadsheets: each sheet as a table, cells as they're shown.
async function readSheet(buf) {
  const X = await import(XLSX_URL);
  const wb = X.read(buf, { cellDates: true });
  const segs = [];
  wb.SheetNames.forEach((name, i) => {
    const rows = X.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' }).map((r) => r.map((v) => String(v ?? '').trim()));
    while (rows.length && !rows[rows.length - 1].some(Boolean)) rows.pop();
    if (rows.length) segs.push({ ref: `t${i + 1}`, kind: 'table', sheet: name.slice(0, 60), label: name, rows });
  });
  return { segs, wb, X };
}

// A spreadsheet that is (or looks like) the weekly register summary goes to
// the weekly upload instead.
export function looksWeekly(segs) {
  const head = (segs[0]?.rows?.[0] || []).map((h) => h.toLowerCase());
  return head.includes('template_version') || head.some((h) => /^(week|week[ _]?(start|commencing|beginning)|w\/?c)$/.test(h));
}

export async function readReport(file) {
  const type = fileType(file.name);
  if (!type) throw new Error('Upload a Word (.docx), PDF, Excel or CSV file.');
  if (file.size > 25 * 1024 * 1024) throw new Error('This file is over 25 MB. Split it or save a smaller copy.');
  const buf = await file.arrayBuffer();
  // Hashed first: the PDF reader takes the buffer over.
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const segments = type === 'docx' ? await readDocx(buf) : type === 'pdf' ? await readPdf(buf) : (await readSheet(buf)).segs;
  if (!segments.length) throw new Error('No text could be read from this file.');
  return { type, segments, sha256: hash };
}

// The same checks as the database (names are checked there, against the
// list of first names). Returns what was found, or null.
const HEADING = /\b(name|names|first ?name|forename|surname|last ?name|full ?name|dob|date of birth|birth ?date|birthday|postcode|post code|address|e-?mail|phone|mobile|telephone|tel|nhs number|upn|member (code|id)|t360 id|person id)\b/i;
const THING_NAME = /\b(site|programme|program|organisation|organization|org|venue|hub|club|school|project|activity|session|partner|provider|team|area|ward|borough|outcome|measure|file|sheet|funder|course)[ _-]*names?\b/gi;
export function piiInText(t) {
  const s = String(t ?? '');
  if (!s.trim()) return null;
  if (/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(s)) return 'an email address';
  if (/(\+44\s?7\d{3}|\b07\d{3})[\s-]?\d{3}[\s-]?\d{3}\b/.test(s) || /(\+44\s?|\b0)(20|1\d{2,4}|3\d{2})\)?[\s-]?\d{3,4}[\s-]?\d{3,4}\b/.test(s)) return 'a phone number';
  if (/(^|[^A-Z0-9])[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][ABD-HJLNP-UW-Z]{2}([^A-Z0-9]|$)/.test(s.toUpperCase())) return 'a full postcode';
  if (/\b(dob|d\.o\.b|date of birth|born on)\b/i.test(s)) return 'a date of birth';
  const y = new Date().getFullYear();
  for (const m of s.matchAll(/\b\d{1,2}[/.-]\d{1,2}[/.-](\d{4})\b|\b(\d{4})-\d{2}-\d{2}\b/g)) { const yr = Number(m[1] || m[2]); if (yr >= y - 25 && yr <= y - 8) return 'a date of birth'; }
  return null;
}
export function piiInSegments(segs) {
  for (const s of segs) {
    if (s.rows) {
      const bad = (s.rows[0] || []).find((h) => HEADING.test(String(h).replace(/[_-]+/g, ' ').replace(THING_NAME, ' ')));
      if (bad) return `a “${bad}” column, which would identify young people`;
      for (const r of s.rows) { const why = piiInText(r.join(' | ')); if (why) return why; }
    } else {
      const why = piiInText(s.text);
      if (why) return why;
    }
  }
  return null;
}
