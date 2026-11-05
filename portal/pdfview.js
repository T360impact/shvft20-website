// An on-screen PDF viewer for agreements: pages one under another, drawn as
// they scroll into view, with page navigation, zoom, search and thumbnails.
// PDF.js is served from this site (vendor/README.md), never a CDN.
//
// mountViewer(el, bytes, options) → { pages, goTo(n), destroy() }
//   watermark   text across every page (unsigned versions show "Draft")
//   onReachEnd  called once, when the last page has been on screen
//   onPageClick (page, x, y) as fractions of the page, for marking signature places
//   marks       [{ page, x, y, w, h, label }] boxes drawn over the pages
import { html, raw, render, $, $$, icon } from './lib.js';

const PDFJS = '/portal/vendor/pdf-3.11.174.min.js';
const PDFJS_WORKER = '/portal/vendor/pdf.worker-3.11.174.min.js';
let loading;
const loadPdfJs = () => (loading ||= new Promise((ok, fail) => {
  if (window.pdfjsLib) { ok(); return; }
  const s = document.createElement('script');
  s.src = PDFJS; s.onload = () => ok(); s.onerror = () => fail(new Error('The document viewer didn\'t load. Check your connection and try again.'));
  document.head.append(s);
})).then(() => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; });

/** @param {HTMLElement} el @param {Uint8Array} bytes @param {{ watermark?: string, onReachEnd?: () => void, onPageClick?: (p: number, x: number, y: number) => void, marks?: Array<any> }} [opts] */
export async function mountViewer(el, bytes, opts = {}) {
  await loadPdfJs();
  const pdf = await window.pdfjsLib.getDocument({ data: bytes, isEvalSupported: false }).promise;
  const n = pdf.numPages;
  let scale = 0; // 0 = fit the width
  let current = 1;
  let fitScale = 1;
  const texts = new Map();

  render(el, html`<div class="pv">
    <div class="pv-bar" role="toolbar" aria-label="Document controls">
      <button type="button" class="icon-btn" data-pv="thumbs" aria-label="Show pages" aria-pressed="false">${raw(icon('menu', 18))}</button>
      <button type="button" class="icon-btn" data-pv="prev" aria-label="Previous page">‹</button>
      <label class="pv-page"><input type="number" min="1" max="${n}" value="1" aria-label="Page"> <span>of ${n}</span></label>
      <button type="button" class="icon-btn" data-pv="next" aria-label="Next page">›</button>
      <span class="pv-sep"></span>
      <button type="button" class="icon-btn" data-pv="out" aria-label="Zoom out">−</button>
      <button type="button" class="linkbtn small" data-pv="fit">Fit</button>
      <button type="button" class="icon-btn" data-pv="in" aria-label="Zoom in">+</button>
      <form class="pv-search" role="search"><input type="search" placeholder="Search" aria-label="Search the document"><span class="muted small" aria-live="polite"></span></form>
    </div>
    <div class="pv-body"><nav class="pv-thumbs" hidden aria-label="Pages"></nav><div class="pv-pages" tabindex="0"></div></div></div>`);
  const pagesEl = $('.pv-pages', el);
  const thumbs = $('.pv-thumbs', el);
  const pageInput = $('.pv-page input', el);

  const slots = [];
  for (let i = 1; i <= n; i++) {
    const s = document.createElement('div');
    s.className = 'pv-sheet'; s.dataset.page = String(i);
    s.setAttribute('aria-label', `Page ${i} of ${n}`);
    pagesEl.append(s);
    slots.push(s);
    const t = document.createElement('button');
    t.type = 'button'; t.className = 'pv-thumb'; t.dataset.go = String(i); t.textContent = String(i);
    thumbs.append(t);
  }

  const widthFor = async (i) => {
    const page = await pdf.getPage(i);
    const base = page.getViewport({ scale: 1 });
    // Room for the padding and a scrollbar that may appear once the pages are laid out.
    const s = scale || Math.max(0.4, (pagesEl.clientWidth - 44) / base.width);
    if (!scale) fitScale = s;
    return { page, viewport: page.getViewport({ scale: s }) };
  };
  const drawn = new Map();
  async function draw(i) {
    const slot = slots[i - 1];
    const key = `${scale}:${pagesEl.clientWidth}`;
    if (drawn.get(i) === key) return;
    drawn.set(i, key);
    const { page, viewport } = await widthFor(i);
    const ratio = window.devicePixelRatio || 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width * ratio); canvas.height = Math.floor(viewport.height * ratio);
    canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : null }).promise;
    slot.style.width = `${viewport.width}px`; slot.style.height = `${viewport.height}px`;
    slot.replaceChildren(canvas);
    if (opts.watermark) { const w = document.createElement('span'); w.className = 'pv-watermark'; w.textContent = opts.watermark; slot.append(w); }
    for (const m of (opts.marks || []).filter((x) => x.page === i)) {
      const b = document.createElement('span');
      b.className = 'pv-mark';
      Object.assign(b.style, { left: `${m.x * 100}%`, top: `${m.y * 100}%`, width: `${m.w * 100}%`, height: `${m.h * 100}%` });
      b.textContent = m.label || 'Sign here';
      slot.append(b);
    }
  }
  // Size every sheet first so the scroll position means something, then draw what's in view.
  async function layout() {
    drawn.clear();
    const first = await widthFor(1);
    for (const s of slots) { s.style.width = `${first.viewport.width}px`; s.style.height = `${first.viewport.height}px`; s.replaceChildren(); }
    for (const s of slots) if (visible(s)) draw(Number(s.dataset.page));
  }
  const visible = (s) => { const r = s.getBoundingClientRect(); const v = pagesEl.getBoundingClientRect(); return r.bottom > v.top - 400 && r.top < v.bottom + 400; };

  let ended = false;
  const seen = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const i = Number(/** @type {HTMLElement} */ (e.target).dataset.page);
      if (e.isIntersecting) draw(i);
      if (e.isIntersecting && e.intersectionRatio >= 0.5) {
        current = i; pageInput.value = String(i);
        $$('.pv-thumb', el).forEach((t) => t.classList.toggle('on', t.dataset.go === String(i)));
      }
      if (i === n && e.isIntersecting && e.intersectionRatio >= 0.5 && !ended) { ended = true; opts.onReachEnd?.(); }
    }
  }, { root: pagesEl, threshold: [0, 0.5] });
  slots.forEach((s) => seen.observe(s));
  // The same from scrolling, in case the observer is slow to report (a background tab).
  let tick;
  pagesEl.addEventListener('scroll', () => {
    clearTimeout(tick);
    tick = setTimeout(() => {
      const v = pagesEl.getBoundingClientRect();
      const shown = slots.filter(visible);
      shown.forEach((x) => draw(Number(x.dataset.page)));
      const mid = slots.find((x) => { const r = x.getBoundingClientRect(); return r.top <= v.top + v.height / 2 && r.bottom >= v.top + v.height / 2; });
      if (mid) { current = Number(mid.dataset.page); pageInput.value = String(current); }
      const last = slots[n - 1].getBoundingClientRect();
      if (!ended && last.top < v.bottom - Math.min(last.height, v.height) / 2) { ended = true; opts.onReachEnd?.(); }
    }, 120);
  }, { passive: true });
  await layout();
  if (n === 1 && !ended) { ended = true; opts.onReachEnd?.(); }

  const goTo = (i) => { const p = Math.min(n, Math.max(1, i)); current = p; pageInput.value = String(p); slots[p - 1].scrollIntoView({ block: 'start' }); };
  const zoom = (f) => { scale = f ? Math.min(3, Math.max(0.4, (scale || fitScale) * f)) : 0; layout().then(() => goTo(current)); };
  el.addEventListener('click', (e) => {
    const t = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-pv],[data-go]'));
    if (!t) return;
    const a = t.getAttribute('data-pv');
    if (t.dataset.go) goTo(Number(t.dataset.go));
    else if (a === 'prev') goTo(current - 1);
    else if (a === 'next') goTo(current + 1);
    else if (a === 'in') zoom(1.25);
    else if (a === 'out') zoom(0.8);
    else if (a === 'fit') zoom(0);
    else if (a === 'thumbs') { thumbs.hidden = !thumbs.hidden; t.setAttribute('aria-pressed', String(!thumbs.hidden)); }
  });
  pageInput.addEventListener('change', () => goTo(Number(pageInput.value)));
  pagesEl.addEventListener('keydown', (e) => {
    if (e.key === 'PageDown' || e.key === 'ArrowRight') { e.preventDefault(); goTo(current + 1); }
    if (e.key === 'PageUp' || e.key === 'ArrowLeft') { e.preventDefault(); goTo(current - 1); }
  });
  if (opts.onPageClick) {
    pagesEl.classList.add('placing');
    pagesEl.addEventListener('click', (e) => {
      const s = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('.pv-sheet'));
      if (!s) return;
      const r = s.getBoundingClientRect();
      opts.onPageClick(Number(s.dataset.page), (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    });
  }

  // Search: each page's text is read once, then matched case-insensitively.
  const searchForm = $('.pv-search', el);
  searchForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = $('input', searchForm).value.trim().toLowerCase();
    const out = $('span', searchForm);
    if (!q) { out.textContent = ''; return; }
    out.textContent = 'Searching…';
    const hits = [];
    for (let i = 1; i <= n; i++) {
      if (!texts.has(i)) texts.set(i, (await (await pdf.getPage(i)).getTextContent()).items.map((x) => x.str).join(' ').toLowerCase());
      if (texts.get(i).includes(q)) hits.push(i);
    }
    $$('.pv-thumb', el).forEach((t) => t.classList.toggle('hit', hits.includes(Number(t.dataset.go))));
    out.textContent = hits.length ? `Found on page${hits.length === 1 ? '' : 's'} ${hits.slice(0, 8).join(', ')}${hits.length > 8 ? '…' : ''}` : 'Not found';
    const next = hits.find((h) => h > current) || hits[0];
    if (next) goTo(next);
  });

  // Fitting the width follows the space the pages have (window size, thumbnails shown or not).
  let lastWidth = pagesEl.clientWidth; let timer;
  const resized = new ResizeObserver(() => {
    if (scale || Math.abs(pagesEl.clientWidth - lastWidth) < 8) return;
    lastWidth = pagesEl.clientWidth;
    clearTimeout(timer); timer = setTimeout(() => layout().then(() => goTo(current)), 150);
  });
  resized.observe(pagesEl);
  return { pages: n, goTo, destroy: () => { seen.disconnect(); resized.disconnect(); pdf.destroy(); } };
}
