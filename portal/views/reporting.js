// Reporting: what each partner owes each period, and reports in any format.
// Partners upload Word, PDF, Excel or CSV files; the text is read in the
// browser, checked for identifying details, and AI proposes a value for each
// requirement with the passage it came from. The partner accepts, edits or
// leaves each one blank; nothing counts until they confirm. "What's missing"
// lists what's still owed, with an upload or enter button on each item. The
// consortium lead sees a gap matrix of partners by requirements, queries any
// confirmed value, chases, and edits the requirements.
import { db, html, raw, render, $, $$, must, act, toast, icon, pill, statCard, openDrawer, formData, fmtDate, fmtDateTime, fmtNum,
  sectionGroup, emptyState, segControl, bindSegments, openFile, liveMark, live, daysUntil, uploadType } from '../lib.js';
import { readReport, piiInSegments, looksWeekly, fileType } from '../extract.js';
import { openUpload as openWeekly } from './uploads.js';

const UPLOAD_ROLES = ['org_admin', 'reporting', 'partner_manager', 'accountable_body'];
export const canUpload = (ctx) => !!ctx.orgId && (UPLOAD_ROLES.includes(ctx.role) || ['lead'].includes(ctx.role) || ctx.extraRoles.some((r) => UPLOAD_ROLES.includes(r)));
export const ST = { provided: ['green', 'Provided', 'approved'], partial: ['amber', 'Partly provided', 'info'], unconfirmed: ['blue', 'Not confirmed yet', 'submitted'],
  queried: ['amber', 'Queried', 'returned'], missing: ['red', 'Missing', 'overdue'] };
const PERIOD = { weekly: 'Weekly', monthly: 'Monthly', termly: 'Termly', cohort_end: 'Cohort end' };
const EVIDENCE = { none: 'No evidence', register: 'Register (anonymised)', certificate: 'Certificates (names removed)', attendance_summary: 'Attendance summary', case_study: 'Case study' };
const CONF = { high: ['green', 'High confidence'], medium: ['blue', 'Medium confidence'], low: ['amber', 'Low confidence'] };
const FLAG = { outside_period: 'Outside the period', age_out_of_range: 'Includes ages outside the range', pre_existing: 'Includes young people known before the programme',
  attendances_not_people: 'May be attendances, not young people', sum: 'A sum: check it', conflict: 'Two figures: choose one' };
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const lastMonth = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return iso(d).slice(0, 7); };

// --------------------------------------------------------- What's missing

export async function loadGaps(ctx, org) {
  const g = must(await db.rpc('reporting_gaps', { p_consortium: ctx.consortium.id, p_org: org }));
  return g.organisations?.[0] || { items: [], provided: 0, total: 0, all: [] };
}

// The partner's list, grouped by what's needed, each item with its button.
export function gapList(ctx, items, ro = false) {
  if (!items.length) return emptyState('check', 'Nothing missing for the last period. Everything asked for is in.');
  const groups = [['missing', 'Missing'], ['queried', 'Queried by the consortium lead'], ['partial', 'Partly provided'], ['unconfirmed', 'Read from an upload, waiting for you']]
    .map(([k, t]) => [k, t, items.filter((x) => x.status === k)]).filter(([, , xs]) => xs.length);
  const row = (x) => html`<li class="lw-row static gap-row"><span class="lw-row-main"><strong>${x.instruction}</strong>
      <span class="muted small">${x.target && x.target !== x.label ? `Counts towards: ${x.target.slice(0, 90)}${x.target.length > 90 ? '…' : ''} · ` : ''}${x.mandatory ? 'Required' : 'Optional'}</span></span>
    <span class="lw-row-tags">${due(x.due_date)}
      ${ro ? '' : x.status === 'unconfirmed' ? html`<a class="btn small" href="#/c/${ctx.consortium.id}/reporting">Review</a>`
        : html`<button type="button" class="btn small" data-gap-up="${x.period_type}|${x.period_start}">${raw(icon('upload', 14))}Upload</button>
          ${x.evidence_required === 'none' || x.status === 'queried' ? html`<button type="button" class="btn secondary small" data-gap-enter="${x.requirement_id}|${x.period_start}" data-gap-label="${x.label}"
            data-gap-period="${x.period_label}" data-gap-queried="${x.status === 'queried' ? '1' : ''}">${x.status === 'queried' ? 'Check' : 'Enter'}</button>` : ''}`}</span></li>`;
  return groups.map(([k, t, xs], i) => sectionGroup({ title: t, meta: `${xs.length}`, open: i === 0, aside: pill(ST[k][0], `${xs.length}`), body: html`<ul class="lw-list">${xs.map(row)}</ul>` }));
}
const due = (d) => { const n = daysUntil(d); return n < 0 ? pill('red', `Overdue since ${fmtDate(d)}`, 'overdue') : pill(n <= 3 ? 'amber' : 'grey', `Due ${fmtDate(d)}`); };

export function bindGapList(ctx, el, again) {
  $$('[data-gap-up]', el).forEach((b) => b.addEventListener('click', () => { const [t, s] = b.dataset.gapUp.split('|'); openReportUpload(ctx, { type: t, start: s }, again); }));
  $$('[data-gap-enter]', el).forEach((b) => b.addEventListener('click', () => {
    const [req, start] = b.dataset.gapEnter.split('|');
    const queried = !!b.dataset.gapQueried;
    const d = openDrawer(`${b.dataset.gapLabel}, ${b.dataset.gapPeriod}`, html`<form class="form" id="ent-form">
      ${queried ? html`<p class="small">The consortium lead asked you to check this figure. Correct it, or confirm it as it is.</p>` : ''}
      <label class="f">${queried ? 'Corrected figure (leave empty to keep it)' : 'Total'}<input name="v" type="number" step="any" min="0" ${queried ? '' : 'required'}></label>
      <label class="f">Note <span class="muted small">(optional; no young people's details)</span><input name="note" maxlength="500"></label>
      <div class="btns"><button class="btn">${queried ? 'Confirm' : 'Save and count'}</button></div></form>`);
    $('#ent-form', d).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => {
      const f = formData(e.target);
      must(await db.rpc('enter_requirement_value', { p_requirement: req, p_period_start: start, p_value: f.v === '' ? null : Number(f.v), p_note: f.note || null }));
      d.close(); toast('Confirmed. It now counts.'); again();
    }); });
  }));
}

// ---------------------------------------------------------------- upload

function periodField(type, start) {
  if (type === 'monthly') return html`<label class="f">Month<input type="month" name="month" value="${(start || '').slice(0, 7) || lastMonth()}" max="${iso(new Date()).slice(0, 7)}" required></label>`;
  return html`<label class="f">Any day in the ${type === 'weekly' ? 'week' : 'term'}<input type="date" name="day" value="${start || ''}" max="${iso(new Date())}" required></label>`;
}

export function openReportUpload(ctx, preset = {}, done = () => {}) {
  const d = openDrawer('Upload a report', html`<form class="form" id="ru-form">
    <p class="small muted">Word, PDF, Excel or CSV, several at once. The portal reads each file, proposes a figure for each thing you report, and shows you where it found it. Nothing counts until you confirm.</p>
    <div class="banner warn small">Files must not name young people or include dates of birth, contact details or full postcodes. A file that does is turned away and not kept: remove names from certificates and registers first.</div>
    <label class="f">The period it covers<select name="type">${Object.entries(PERIOD).map(([k, t]) => html`<option value="${k}" ${k === (preset.type || 'monthly') ? 'selected' : ''}>${t}</option>`)}</select></label>
    <div id="ru-period">${periodField(preset.type || 'monthly', preset.start)}</div>
    <label class="f">Files<input type="file" name="files" multiple required accept=".docx,.pdf,.xlsx,.xls,.csv"></label>
    <div class="btns"><button class="btn">${raw(icon('upload', 16))}Read the files</button></div></form><div id="ru-out"></div>`);
  $('[name=type]', d).addEventListener('change', (e) => render($('#ru-period', d), periodField(e.target.value)));
  $('#ru-form', d).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => {
    const f = new FormData(e.target);
    const type = f.get('type');
    const start = type === 'monthly' ? `${f.get('month')}-01` : f.get('day');
    const files = [...e.target.files.files];
    const out = $('#ru-out', d);
    const res = files.map((file) => ({ file, state: 'waiting', text: 'Waiting' }));
    let batch = null;
    const show = () => render(out, html`<ul class="lw-list" style="margin-top:12px">${res.map((r) => html`<li class="lw-row static"><span class="lw-row-main"><strong>${r.file.name}</strong>
      <span class="small ${r.state === 'rejected' || r.state === 'error' ? 'warn-text' : 'muted'}">${r.text}</span></span>
      <span class="lw-row-tags">${pill({ read: 'green', rejected: 'red', error: 'red', weekly: 'blue', reading: 'grey', waiting: 'grey' }[r.state], { read: 'Read', rejected: 'Turned away', error: 'Not read', weekly: 'Weekly summary', reading: 'Reading…', waiting: 'Waiting' }[r.state])}
        ${r.state === 'weekly' ? html`<button type="button" class="btn secondary small" data-weekly="${res.indexOf(r)}">Upload as weekly figures</button>` : ''}</span></li>`)}</ul>
      <div class="btns" style="margin-top:12px">${batch && res.some((r) => r.state === 'read') ? html`<a class="btn" href="#/c/${ctx.consortium.id}/reporting/review/${batch}">Review and confirm</a>` : ''}</div>`);
    show();
    for (const r of res) {
      r.state = 'reading'; r.text = 'Reading the file in your browser…'; show();
      try {
        const got = await readReport(r.file);
        // A weekly register summary goes to the weekly upload.
        if ((got.type === 'xlsx' || got.type === 'csv') && looksWeekly(got.segments)) { r.state = 'weekly'; r.text = 'This is a weekly register summary. Upload it as weekly figures.'; show(); continue; }
        // Turned away here, before anything leaves the browser.
        const why = piiInSegments(got.segments);
        if (why) { r.state = 'rejected'; r.text = `It contains ${why}. The portal can't hold anything that identifies a young person, so nothing from this file has been sent or kept. Upload an anonymised version.`; show(); continue; }
        batch ||= must(await db.rpc('start_report_batch', { p_consortium: ctx.consortium.id, p_period_type: type, p_period_start: start }));
        r.text = 'Checking and finding the figures. This can take a minute…'; show();
        const { data, error } = await db.functions.invoke('extract-report', { body: { batch_id: batch, file_name: r.file.name, file_type: got.type, sha256: got.sha256, segments: got.segments } });
        if (error) {
          let msg = error.message;
          try { msg = (await error.context.json()).error || msg; } catch { /* keep the message */ }
          r.state = /identif|name|postcode|birth|email|phone/i.test(msg) ? 'rejected' : 'error'; r.text = msg; show(); continue;
        }
        // The original is kept only now, after the checks, so the source link can open it.
        const path = `${data.folder}/${data.file_id}.${fileType(r.file.name) === 'xlsx' ? r.file.name.split('.').pop().toLowerCase() : fileType(r.file.name)}`;
        must(await db.storage.from('documents').upload(path, r.file, { contentType: uploadType('documents', r.file) }));
        must(await db.from('report_uploads').update({ storage_path: path }).eq('id', data.file_id));
        r.state = 'read';
        r.text = data.warning || `${data.proposals} figure${data.proposals === 1 ? '' : 's'} found${data.dropped ? `; ${data.dropped} left out because they weren't in the file as stated` : ''}.`;
      } catch (err) { r.state = 'error'; r.text = err.message; }
      show();
    }
    $$('[data-weekly]', out).forEach((b) => b.addEventListener('click', async () => {
      const progs = must(await db.from('programmes').select('id, name, kind').eq('consortium_id', ctx.consortium.id).order('name'));
      d.close(); openWeekly(ctx, progs, done, res[Number(b.dataset.weekly)].file);
    }));
    if (batch && !res.some((r) => r.state === 'read')) must(await db.rpc('cancel_report_batch', { p_batch: batch }));
    if (batch && res.some((r) => r.state === 'read')) location.hash = `#/c/${ctx.consortium.id}/reporting/review/${batch}`;
  }); });
}

// ---------------------------------------------------------------- source

// The passage a figure came from, highlighted, with the original file.
async function openSource(fileId, src, file) {
  const f = must(await db.from('report_uploads').select('file_name, file_type, storage_path, segments').eq('id', fileId).single());
  const seg = (f.segments || []).find((s) => s.ref === src.ref);
  const words = String(src.quote || '').trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = words.length ? new RegExp(words.join('\\s+'), 'i') : null;
  const marked = (t) => { const m = re && re.exec(t); return m ? html`${t.slice(0, m.index)}<mark>${m[0]}</mark>${t.slice(m.index + m[0].length)}` : t; };
  const colOf = (cell) => { const m = /^([A-Z]+)(\d+)$/.exec(cell || ''); return m ? [Number(m[2]) - 1, [...m[1]].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1] : null; };
  const at = colOf(src.cell);
  const where = seg?.kind === 'page' ? `Page ${seg.page}` : seg?.sheet ? `Sheet “${seg.sheet}”${src.cell ? `, cell ${src.cell}` : ''}` : seg?.label || 'Passage';
  const d = openDrawer(`Source: ${f.file_name}`, html`<p class="small muted">${where}. The figure was taken only because this passage states it.</p>
    <blockquote class="src-quote">“${src.quote}”</blockquote>
    ${!seg ? html`<p class="muted small">The passage isn't available.</p>` : seg.rows ? html`<div class="table-wrap"><table class="src-table"><tbody>${seg.rows.slice(0, 200).map((r, i) => html`<tr>${r.map((v, j) => html`<td class="${at && at[0] === i && at[1] === j ? 'hit' : ''}">${v}</td>`)}</tr>`)}</tbody></table></div>`
      : html`<div class="src-text">${marked(seg.text || '')}</div>`}
    ${f.storage_path ? html`<div class="btns" style="margin-top:12px"><button type="button" class="btn secondary" id="src-open">${raw(icon('download', 16))}Open the original${seg?.page ? ` at page ${seg.page}` : ''}</button></div>` : ''}`);
  $('#src-open', d)?.addEventListener('click', (e) => openFile(e.currentTarget, 'documents', f.storage_path, seg?.page && f.file_type === 'pdf' ? `#page=${seg.page}` : ''));
  setTimeout(() => $('mark, td.hit', d)?.scrollIntoView({ block: 'center' }), 50);
}

// ---------------------------------------------------------------- review

async function review(ctx, el, batchId) {
  const c = ctx.consortium;
  const r = must(await db.rpc('report_batch', { p_batch: batchId }));
  const b = r.batch;
  const open = b.status === 'open' && b.organisation_id === ctx.orgId && canUpload(ctx);
  const files = Object.fromEntries(r.files.map((f) => [f.id, f]));
  const found = r.rows.filter((x) => x.proposals.length);
  const covered = r.rows.filter((x) => !x.proposals.length && x.state.status === 'provided');
  const rest = r.rows.filter((x) => !x.proposals.length && x.state.status !== 'provided');
  const dropped = r.files.reduce((n, f) => n + (f.dropped || 0), 0);
  const isLow = (x) => x.proposals.some((p) => p.confidence === 'low' || p.flags.length);
  // Preselect only when every passage gives the same figure, and one of them
  // is confident and unflagged.
  const pre = (x) => { const v = x.proposals.filter((p) => p.kind === 'value'); const pool = v.length ? v : x.proposals;
    if (new Set(pool.map((p) => (p.kind === 'value' ? Number(p.value) : p.item_count))).size !== 1) return null;
    return pool.find((p) => p.confidence !== 'low' && !p.flags.length)?.id || null; };
  const opt = (x, p) => html`<label class="rv-opt ${p.confidence === 'low' || p.flags.length ? 'low' : ''}"><input type="radio" name="c_${x.requirement_id}" value="p:${p.id}" ${pre(x) === p.id ? 'checked' : ''} ${open ? '' : 'disabled'}>
    <span><strong>${p.kind === 'evidence' ? `${fmtNum(p.item_count)} ${p.evidence_type === 'certificate' ? 'certificate' : 'item'}${p.item_count === 1 ? '' : 's'} (evidence)` : fmtNum(p.value)}</strong>
      ${pill(...CONF[p.confidence])} ${p.flags.map((fl) => pill('amber', FLAG[fl] || fl))}
      ${p.sum_of?.length ? html`<span class="small muted"> ${p.sum_of.map(fmtNum).join(' + ')}</span>` : ''}
      <br><span class="small muted">${files[p.file_id]?.file_name || ''}${p.source?.page ? `, page ${p.source.page}` : p.source?.sheet ? `, ${p.source.sheet}${p.source.cell ? ` ${p.source.cell}` : ''}` : ''}: “${String(p.source?.quote || '').slice(0, 140)}”</span>
      <button type="button" class="linkbtn small" data-src="${p.id}">Show the source</button>${p.note ? html`<br><span class="small">${p.note}</span>` : ''}</span></label>`;
  const rowView = (x) => { const ev = x.proposals.filter((p) => p.kind === 'evidence'); const vals = x.proposals.filter((p) => p.kind === 'value');
    return html`<div class="rv-row ${isLow(x) ? 'low' : ''}" data-req="${x.requirement_id}">
      <p><strong>${x.label}</strong> ${x.mandatory ? pill('grey', 'Required') : ''} ${x.evidence_required !== 'none' ? pill('blue', EVIDENCE[x.evidence_required]) : ''}
        ${x.state.status === 'provided' ? pill('green', 'Already provided: this replaces it') : ''}<br>
        <span class="small muted">${x.target && x.target !== x.label ? `Counts towards: ${x.target}` : ''}</span></p>
      <div class="rv-opts">${x.proposals.map((p) => opt(x, p))}
        <label class="rv-opt"><input type="radio" name="c_${x.requirement_id}" value="edit" ${open ? '' : 'disabled'}><span>Enter a different figure <input type="number" step="any" min="0" name="e_${x.requirement_id}" class="rv-num" ${open ? '' : 'disabled'}></span></label>
        <label class="rv-opt"><input type="radio" name="c_${x.requirement_id}" value="blank" ${open ? '' : 'disabled'}><span>Leave blank</span></label></div>
      ${ev.length && vals.length ? html`<label class="check small"><input type="checkbox" name="ev_${x.requirement_id}" value="${ev[0].id}" checked ${open ? '' : 'disabled'}> Keep ${files[ev[0].file_id]?.file_name || 'the file'} as the evidence</label>` : ''}</div>`; };
  const simpleRow = (x) => html`<div class="rv-row" data-req="${x.requirement_id}"><p><strong>${x.label}</strong> ${x.mandatory ? pill('grey', 'Required') : ''}
      ${x.state.status !== 'missing' ? pill(...ST[x.state.status]) : ''}<br><span class="small muted">${x.target && x.target !== x.label ? `Counts towards: ${x.target}` : ''}</span></p>
    ${open && x.evidence_required === 'none' ? html`<label class="f small">Enter it (optional)<input type="number" step="any" min="0" name="e_${x.requirement_id}" class="rv-num"></label>` : ''}</div>`;

  render(el, html`
    <p class="small" style="margin-bottom:16px"><a href="#/c/${c.id}/reporting">← Reporting</a></p>
    <div class="page-head"><div><span class="eyebrow">Review an upload</span><h1>${b.period_label}</h1>
      <p class="muted">${b.status === 'open' ? 'Check each figure against its source, then confirm. Nothing counts until you do.' : `This upload was ${b.status} ${fmtDateTime(b.confirmed_at || b.created_at)}.`}</p></div></div>
    <div class="stats stats-4">
      ${statCard({ icon: 'bids', value: r.files.length, label: 'Files read' })}
      ${statCard({ icon: 'approved', value: found.length, label: 'Requirements found' })}
      ${statCard({ icon: 'overdue', value: found.filter(isLow).length, label: 'Need a closer look', trend: { dir: 'flat', tone: found.some(isLow) ? 'amber' : 'green', text: 'low confidence or flagged' } })}
      ${statCard({ icon: 'requirements', value: rest.length, label: 'Not found', trend: { dir: 'flat', tone: 'grey', text: 'enter them or upload more' } })}</div>
    ${dropped ? html`<div class="banner warn">${dropped} proposed figure${dropped === 1 ? ' was' : 's were'} left out because the quoted passage or figure couldn't be found in the file as stated.</div>` : ''}
    <form id="rv-form" class="dgrid">
      <section class="dcard full"><header class="dcard-head"><h2>Files</h2></header><ul class="lw-list">${r.files.map((f) => html`<li class="lw-row static"><span class="lw-row-main"><strong>${f.file_name}</strong>
        <span class="small muted">${{ data: 'Report of figures', evidence: 'Evidence', both: 'Figures and evidence', other: 'Nothing to report found' }[f.file_role] || 'Read'}</span></span>
        <span class="lw-row-tags">${f.storage_path ? html`<button type="button" class="btn secondary small" data-open="${f.storage_path}">Open</button>` : ''}</span></li>`)}</ul></section>
      <section class="dcard full"><header class="dcard-head"><h2>Found in your files</h2><p>Accept a figure, enter a different one, or leave it blank. Highlighted ones need a closer look.</p></header>
        ${found.length ? found.map(rowView) : html`<p class="muted small">No figures were found. Enter them below or upload another file.</p>`}</section>
      ${rest.length ? html`<section class="dcard full">${sectionGroup({ title: 'Not found', meta: `${rest.length}`, open: !found.length, body: html`${rest.map(simpleRow)}` })}</section>` : ''}
      ${covered.length ? html`<section class="dcard full">${sectionGroup({ title: 'Already provided for this period', meta: `${covered.length}`, body: html`<ul class="small">${covered.map((x) => html`<li>${x.label}${x.state.source === 'weekly' ? ' (from your weekly uploads)' : ''}</li>`)}</ul>` })}</section>` : ''}
      ${open ? html`<section class="dcard full"><div class="btns"><button class="btn" id="rv-confirm">Confirm and count</button>
        <button type="button" class="btn secondary" id="rv-cancel">Cancel this upload</button></div>
        <p class="small muted" style="margin-top:8px">Confirmed figures count towards the targets straight away. The consortium lead can query any of them.</p></section>` : ''}
    </form>`);

  $$('[data-src]', el).forEach((btn) => btn.addEventListener('click', () => { const p = r.rows.flatMap((x) => x.proposals).find((q) => q.id === btn.dataset.src); act(btn, () => openSource(p.file_id, p.source)); }));
  $$('[data-open]', el).forEach((btn) => btn.addEventListener('click', () => openFile(btn, 'documents', btn.dataset.open)));
  $$('.rv-num', el).forEach((inp) => inp.addEventListener('input', () => { const radio = inp.closest('.rv-opt')?.querySelector('input[type=radio]'); if (radio) radio.checked = true; }));
  $('#rv-cancel', el)?.addEventListener('click', (e) => act(e.currentTarget, async () => { must(await db.rpc('cancel_report_batch', { p_batch: b.id })); toast('Upload cancelled. Nothing counted.'); location.hash = `#/c/${c.id}/reporting`; }));
  $('#rv-form', el).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => {
    const f = new FormData(e.target);
    const decisions = [];
    for (const x of found) {
      const v = f.get(`c_${x.requirement_id}`);
      if (!v) throw new Error(`Choose a figure for “${x.label}”, enter one, or leave it blank.`);
      if (v === 'blank') { decisions.push({ requirement_id: x.requirement_id, choice: 'blank' }); continue; }
      if (v === 'edit') { const n = f.get(`e_${x.requirement_id}`); if (n === '') throw new Error(`Enter the figure for “${x.label}”.`); decisions.push({ requirement_id: x.requirement_id, choice: 'edit', value: Number(n) }); continue; }
      decisions.push({ requirement_id: x.requirement_id, choice: 'accept', extracted_id: v.slice(2), evidence_id: f.get(`ev_${x.requirement_id}`) || null });
    }
    for (const x of rest) { const n = f.get(`e_${x.requirement_id}`); if (n != null && n !== '') decisions.push({ requirement_id: x.requirement_id, choice: 'edit', value: Number(n) }); }
    const res = must(await db.rpc('confirm_report_batch', { p_batch: b.id, p_decisions: decisions }));
    toast(`${res.confirmed} figure${res.confirmed === 1 ? '' : 's'} confirmed. ${res.gaps.organisations?.[0]?.items?.length ? `${res.gaps.organisations[0].items.length} still missing.` : 'Nothing missing.'}`);
    location.hash = `#/c/${c.id}/reporting`;
  }); });
}

// ------------------------------------------------------------------ page

export default async function reporting(ctx, el, parts = []) {
  if (parts[0] === 'review' && parts[1]) return review(ctx, el, parts[1]);
  if (ctx.seesAll && !parts.includes('mine')) return leadView(ctx, el);
  return partnerView(ctx, el);
}

async function partnerView(ctx, el) {
  const c = ctx.consortium;
  if (!ctx.orgId) { render(el, html`<div class="panel">You're not linked to an organisation in this workspace.</div>`); return; }
  const [g, batches, vals] = await Promise.all([loadGaps(ctx, ctx.orgId),
    db.from('report_batches').select('id, period_type, period_start, status, created_at').eq('consortium_id', c.id).eq('organisation_id', ctx.orgId).order('created_at', { ascending: false }).limit(12).then(must),
    db.from('requirement_values').select('id, requirement_id, period_start, value, evidence_count, source, status, query_comment, confirmed_at').eq('consortium_id', c.id).eq('organisation_id', ctx.orgId).order('confirmed_at', { ascending: false }).limit(40).then(must)]);
  const openB = batches.filter((x) => x.status === 'open');
  const label = (id) => g.all.find((x) => x.requirement_id === id)?.label || 'A requirement';
  const up = canUpload(ctx);
  const again = () => partnerView(ctx, el);
  render(el, html`
    <div class="page-head"><div><span class="eyebrow">Reporting</span><h1>What's missing</h1>
      <p class="muted">What ${ctx.orgName || 'your organisation'} reports each period, from your targets. Upload reports in any format, or enter figures directly.</p>
      <p style="margin-top:8px">${liveMark()}</p></div>
      <div class="btns">${up ? html`<button type="button" class="btn" id="ru">${raw(icon('upload', 16))}Upload a report</button>` : ''}<a class="btn secondary" href="#/c/${c.id}/uploads">Weekly figures</a></div></div>
    <div class="stats stats-4">
      ${statCard({ icon: 'overdue', value: g.items.length, label: 'Missing', trend: { dir: 'flat', tone: g.items.length ? 'red' : 'green', text: 'for the last period' } })}
      ${statCard({ icon: 'approved', value: `${g.provided} of ${g.total}`, label: 'Provided' })}
      ${statCard({ icon: 'sessions', value: g.items.length ? fmtDate(g.items.map((x) => x.due_date).sort()[0]) : '–', label: 'Next due' })}
      ${statCard({ icon: 'submitted', value: openB.length, label: 'Uploads to review', trend: { dir: 'flat', tone: openB.length ? 'amber' : 'grey', text: 'read, not confirmed' } })}</div>
    <div class="dgrid">
      <section class="dcard full"><header class="dcard-head"><h2>What's missing</h2><p>Items clear by themselves once the figure or evidence is confirmed.</p></header>
        ${gapList(ctx, g.items, !up)}</section>
      ${openB.length ? html`<section class="dcard full"><header class="dcard-head"><h2>Uploads to review</h2></header><ul class="lw-list">${openB.map((x) => html`<li><a class="lw-row" href="#/c/${c.id}/reporting/review/${x.id}">
        <span class="lw-row-main"><strong>${PERIOD[x.period_type]} from ${fmtDate(x.period_start)}</strong><span class="muted small">Uploaded ${fmtDateTime(x.created_at)}</span></span><span class="lw-row-tags">${pill('blue', 'Review')}</span></a></li>`)}</ul></section>` : ''}
      <section class="dcard full">${sectionGroup({ title: 'Confirmed figures', meta: `${vals.length}`, body: vals.length ? html`<ul class="lw-list">${vals.map((v) => html`<li class="lw-row static"><span class="lw-row-main"><strong>${label(v.requirement_id)}: ${v.value == null ? '–' : fmtNum(v.value)}</strong>
          <span class="muted small">Period from ${fmtDate(v.period_start)} · ${v.source === 'upload' ? 'from an upload' : 'entered'}${v.evidence_count ? ` · ${v.evidence_count} evidence items` : ''}${v.query_comment ? ` · queried: “${v.query_comment}”` : ''}</span></span>
          <span class="lw-row-tags">${v.status === 'queried' ? pill('amber', 'Queried') : pill('green', 'Counts')}</span></li>`)}</ul>` : html`<p class="muted small">None yet.</p>` })}</section>
      <section class="dcard full">${sectionGroup({ title: 'Everything you report', meta: `${g.all.length}`, body: html`<ul class="lw-list">${g.all.map((x) => html`<li class="lw-row static"><span class="lw-row-main"><strong>${x.label}</strong>
          <span class="muted small">${PERIOD[x.period_type]} · ${x.mandatory ? 'required' : 'optional'}${x.evidence_required !== 'none' ? ` · ${EVIDENCE[x.evidence_required].toLowerCase()}` : ''}</span></span><span class="lw-row-tags">${pill(...ST[x.status])}</span></li>`)}</ul>` })}</section>
    </div>`);
  $('#ru', el)?.addEventListener('click', () => openReportUpload(ctx, {}, again));
  bindGapList(ctx, el, again);
  live(c.id, () => { if (!document.querySelector('dialog[open]')) again(); });
}

// The lead: the gap matrix, values to query, and the requirements.
async function leadView(ctx, el) {
  const c = ctx.consortium;
  const tab = ctx.repTab || 'matrix';
  const m = must(await db.rpc('gap_matrix', { p_consortium: c.id }));
  const types = [...new Set(m.columns.map((x) => x.period_type))];
  const ptype = ctx.repPeriod && types.includes(ctx.repPeriod) ? ctx.repPeriod : types.includes('monthly') ? 'monthly' : types[0];
  const cols = m.columns.filter((x) => x.period_type === ptype).sort((a, b) => (b.mandatory - a.mandatory) || a.label.localeCompare(b.label));
  const cells = m.rows.flatMap((r) => Object.values(r.cells || {}));
  const count = (s) => cells.filter((x) => x.status === s).length;
  const again = () => leadView(ctx, el);
  render(el, html`
    <div class="page-head"><div><span class="eyebrow">Reporting</span><h1>Reporting gaps</h1>
      <p class="muted">Every partner's requirements for the last completed period: green provided, amber partial or not confirmed, red missing.</p>
      <p style="margin-top:8px">${liveMark()}</p></div>
      <div class="btns">${ctx.orgId && canUpload(ctx) ? html`<a class="btn secondary" href="#/c/${c.id}/reporting/mine">Our own reporting</a>` : ''}</div></div>
    <div class="stats stats-4">
      ${statCard({ icon: 'approved', value: count('provided'), label: 'Provided' })}
      ${statCard({ icon: 'info', value: count('partial') + count('unconfirmed') + count('queried'), label: 'Partial', trend: { dir: 'flat', tone: 'grey', text: 'partly in, not confirmed or queried' } })}
      ${statCard({ icon: 'overdue', value: count('missing'), label: 'Missing', trend: { dir: 'flat', tone: count('missing') ? 'red' : 'green', text: `across ${m.rows.length} partner${m.rows.length === 1 ? '' : 's'}` } })}
      ${statCard({ icon: 'requirements', value: m.columns.length, label: 'Requirements' })}</div>
    ${segControl('reptab', [['matrix', 'Gap matrix'], ['requirements', 'Requirements']], tab)}
    <div id="rbody"></div>`);
  bindSegments(el);
  $$('[data-seg-for="reptab"] [data-seg]', el).forEach((b) => b.addEventListener('click', () => { ctx.repTab = b.dataset.seg; again(); }));
  const body = $('#rbody', el);
  if (tab === 'requirements') return requirementsTab(ctx, body, again);
  const sym = { provided: '✓', partial: '½', unconfirmed: '?', queried: '!', missing: '✕' };
  const tone = (s) => ({ provided: 'green', partial: 'amber', unconfirmed: 'amber', queried: 'amber', missing: 'red' }[s] || 'grey');
  render(body, html`<section class="dcard full">
    ${types.length > 1 ? segControl('repperiod', types.map((t) => [t, PERIOD[t]]), ptype) : ''}
    ${m.rows.length ? html`<div class="table-wrap" style="margin-top:12px"><table class="gap-matrix"><thead><tr><th>Partner</th>${cols.map((col) => html`<th class="gm-head" title="${col.target || col.label}"><span>${col.label.slice(0, 34)}${col.label.length > 34 ? '…' : ''}</span></th>`)}<th></th></tr></thead>
      <tbody>${m.rows.map((r) => html`<tr><th scope="row">${r.name}<br><span class="small muted">${r.provided} of ${r.total}</span></th>
        ${cols.map((col) => { const x = r.cells?.[col.key]; return html`<td>${x ? html`<button type="button" class="gm-cell tone-${tone(x.status)}" data-cell="${r.organisation_id}|${col.key}" title="${ST[x.status][1]}: ${x.label}" aria-label="${r.name}, ${x.label}: ${ST[x.status][1]}">${sym[x.status]}</button>` : html`<span class="muted small">–</span>`}</td>`; })}
        <td>${Object.values(r.cells || {}).some((x) => x.status !== 'provided') ? html`<button type="button" class="btn secondary small" data-chase="${r.organisation_id}">Chase</button>` : ''}</td></tr>`)}</tbody></table></div>
      <p class="small muted" style="margin-top:8px">✓ provided · ½ partly provided · ? read, not confirmed · ! queried · ✕ missing. Select a cell for detail.</p>`
      : emptyState('requirements', 'No requirements yet. They come from the targets linked to each partner.')}</section>`);
  bindSegments(body);
  $$('[data-seg-for="repperiod"] [data-seg]', body).forEach((b) => b.addEventListener('click', () => { ctx.repPeriod = b.dataset.seg; again(); }));
  $$('[data-cell]', body).forEach((b) => b.addEventListener('click', () => {
    const [org, key] = b.dataset.cell.split('|');
    const row = m.rows.find((r) => r.organisation_id === org);
    const x = row.cells[key];
    const d = openDrawer(`${row.name}: ${x.label}`, html`<p>${pill(...ST[x.status])} <span class="small muted">${x.period_label}, due ${fmtDate(x.due_date)}</span></p>
      ${x.value != null ? html`<p style="margin-top:8px">Confirmed figure: <strong>${fmtNum(x.value)}</strong>${x.source === 'weekly' ? ' (from weekly uploads)' : ''}</p>` : x.source === 'weekly' ? html`<p style="margin-top:8px">Covered by the weekly uploads.</p>` : ''}
      ${x.instruction ? html`<p class="small" style="margin-top:8px">What they've been told: ${x.instruction}</p>` : ''}
      ${x.value_id && ctx.manages && x.status === 'provided' ? html`<form class="form" id="q-form" style="margin-top:12px"><label class="f">Query this figure<span class="hint">It stops counting and goes back to ${row.name} with your comment.</span>
        <textarea name="comment" rows="3" required maxlength="1000"></textarea></label><div class="btns"><button class="btn secondary">Send the query</button></div></form>` : ''}`);
    $('#q-form', d)?.addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => {
      must(await db.rpc('query_requirement_value', { p_value: x.value_id, p_comment: formData(e.target).comment })); d.close(); toast(`Queried. ${row.name} has been told.`); again(); }); });
  }));
  $$('[data-chase]', body).forEach((b) => b.addEventListener('click', () => {
    const row = m.rows.find((r) => r.organisation_id === b.dataset.chase);
    const items = Object.values(row.cells).filter((x) => x.status !== 'provided' && x.instruction);
    const d = openDrawer(`Chase ${row.name}`, html`<form class="form" id="ch-form"><label class="f">Message<textarea name="msg" rows="8" required>${`These are still outstanding:\n${items.map((x) => `• ${x.instruction}`).join('\n')}`}</textarea></label>
      <p class="small muted">Sent by email to ${row.name} and shown in their portal notifications.</p><div class="btns"><button class="btn">Send</button></div></form>`);
    $('#ch-form', d).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => {
      must(await db.rpc('chase', { p_consortium: c.id, p_org: row.organisation_id, p_person: null, p_message: formData(e.target).msg })); d.close(); toast('Sent.'); }); });
  }));
  live(c.id, () => { if (!document.querySelector('dialog[open]')) again(); });
}

async function requirementsTab(ctx, el, again) {
  const c = ctx.consortium;
  const [reqs, fields, cms] = await Promise.all([
    db.from('reporting_requirements').select('*').eq('consortium_id', c.id).eq('active', true).order('label').then(must),
    db.from('report_fields').select('key, label, upload_hint').order('label').then(must),
    db.from('commitments').select('id, label').eq('consortium_id', c.id).is('superseded_by', null).is('retired_at', null).order('label').then(must)]);
  const orgs = ctx.orgs.filter((o) => reqs.some((q) => q.organisation_id === o.id) || ['delivery_partner', 'accountable_body'].includes(o.kind));
  render(el, html`<section class="dcard full"><header class="dcard-head"><h2>Requirements</h2><p>Generated from the targets linked to each partner and the outcome framework. Your edits stay when they're rebuilt.</p></header>
    <div class="btns">${ctx.manages ? html`<button type="button" class="btn" id="rq-add">${raw(icon('add', 16))}Add a requirement</button><button type="button" class="btn secondary" id="rq-gen">Rebuild from targets</button>` : ''}</div>
    ${orgs.map((o, i) => { const qs = reqs.filter((q) => q.organisation_id === o.id); return sectionGroup({ title: o.name, meta: `${qs.length} · ${qs.filter((q) => q.mandatory).length} required`, open: i === 0,
      body: qs.length ? html`<ul class="lw-list">${qs.map((q) => html`<li class="lw-row static"><span class="lw-row-main"><strong>${q.label}</strong>
        <span class="muted small">${PERIOD[q.period_type]} · ${q.mandatory ? 'required' : 'optional'} · ${EVIDENCE[q.evidence_required]} · due ${q.due_days_after} days after the period${q.edited ? ' · edited' : ''}${q.origin === 'manual' ? ' · added by hand' : ''}</span></span>
        <span class="lw-row-tags">${ctx.manages ? html`<button type="button" class="btn secondary small" data-rq="${q.id}">Edit</button>` : ''}</span></li>`)}</ul>` : html`<p class="muted small">No targets are linked to ${o.name}.</p>` }); })}</section>`);
  const form = (q = {}) => html`<form class="form" id="rq-form">
    ${q.id ? '' : html`<label class="f">Partner<select name="organisation_id" required>${orgs.map((o) => html`<option value="${o.id}">${o.name}</option>`)}</select></label>
      <label class="f">Figure<select name="field">${fields.map((f) => html`<option value="${f.key}">${f.label}</option>`)}</select></label>
      <label class="f">Counts towards (optional)<select name="commitment_id"><option value="">No target</option>${cms.map((k) => html`<option value="${k.id}">${k.label.slice(0, 90)}</option>`)}</select></label>`}
    <label class="f">What partners see<input name="label" value="${q.label || ''}" maxlength="120" ${q.id ? 'required' : ''} placeholder="${q.id ? '' : 'The figure\'s name, if different'}"></label>
    <div class="fields"><label class="f">Period<select name="period_type">${Object.entries(PERIOD).map(([k, t]) => html`<option value="${k}" ${q.period_type === k || (!q.id && k === 'monthly') ? 'selected' : ''}>${t}</option>`)}</select></label>
      <label class="f">Due (days after the period)<input type="number" name="due_days_after" min="0" max="60" value="${q.due_days_after ?? 5}"></label></div>
    <label class="f">Evidence<select name="evidence_required">${Object.entries(EVIDENCE).map(([k, t]) => html`<option value="${k}" ${q.evidence_required === k ? 'selected' : ''}>${t}</option>`)}</select></label>
    <label class="f">What to upload<input name="upload_hint" value="${q.upload_hint || ''}" maxlength="80" placeholder="for example: outreach log"></label>
    <label class="check"><input type="checkbox" name="mandatory" ${q.mandatory !== false ? 'checked' : ''}> Required: the monthly return can't be submitted without it, unless the partner gives a reason</label>
    <div class="btns"><button class="btn">Save</button>${q.id ? html`<button type="button" class="btn secondary" id="rq-off">Stop asking for this</button>` : ''}</div></form>`;
  const save = (d, q) => $('#rq-form', d).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => {
    const f = formData(e.target);
    const row = { period_type: f.period_type, due_days_after: Number(f.due_days_after), evidence_required: f.evidence_required, upload_hint: f.upload_hint || 'records', mandatory: !!f.mandatory };
    if (q) must(await db.from('reporting_requirements').update({ ...row, label: f.label }).eq('id', q.id));
    else { const fl = fields.find((x) => x.key === f.field);
      must(await db.from('reporting_requirements').insert({ ...row, consortium_id: c.id, organisation_id: f.organisation_id, field: f.field, label: f.label || fl.label,
        commitment_id: f.commitment_id || null, upload_hint: f.upload_hint || fl.upload_hint })); }
    d.close(); toast('Saved.'); again();
  }); });
  $('#rq-add', el)?.addEventListener('click', () => { const d = openDrawer('Add a requirement', form()); save(d, null); });
  $('#rq-gen', el)?.addEventListener('click', (e) => act(e.currentTarget, async () => { const n = must(await db.rpc('generate_requirements', { p_consortium: c.id })); toast(n ? `${n} added from the targets.` : 'Up to date with the targets.'); again(); }));
  $$('[data-rq]', el).forEach((b) => b.addEventListener('click', () => {
    const q = reqs.find((x) => x.id === b.dataset.rq);
    const d = openDrawer(`Edit: ${q.label}`, form(q));
    save(d, q);
    $('#rq-off', d).addEventListener('click', (e) => act(e.currentTarget, async () => { must(await db.from('reporting_requirements').update({ active: false }).eq('id', q.id)); d.close(); toast('No longer asked for.'); again(); }));
  }));
}
