// Progress against targets. Each organisation reports, month by month, what
// it has delivered against the targets it can report on: its own and the
// consortium's shared ones. Figures go in on this page, or in a spreadsheet
// downloaded from it and uploaded back. save_progress() checks every figure
// before anything is saved, and the dashboard adds them up.
import { db, html, raw, render, $, $$, toast, act, must, icon, fmtNum, fmtMonth, fmtDateTime, today, uploadFile, openFile, sectionGroup, statCard, live, liveMark } from '../lib.js';
import { chart, donut, hbars, lineChart } from '../charts.js';
import { periodText, figureText } from './targets.js';

// SheetJS, loaded only when someone downloads or uploads a spreadsheet.
const XLSX_URL = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs';
let sheetjs;
const loadXlsx = async () => (sheetjs ||= await import(XLSX_URL));

const REF = "Ref (don't change)";
const COLS = ['Section', 'Output or outcome', 'Period', 'Target', 'Reported before this month', 'This month', 'Note', REF];
const KIND = { output: 'Outputs', outcome: 'Outcomes' };
const isPct = (k) => k.unit === '%' || k.measure === 'targeted_pct';
const addMonths = (m, n) => {
  const d = new Date(`${m}-01T12:00:00`);
  d.setMonth(d.getMonth() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const shiftYears = (d, n) => `${Number(d.slice(0, 4)) + n}${d.slice(4)}`;
// Same rule as save_progress(): a month belongs to year N if it starts on or
// after the month year N starts in, and before year N ends.
const inYear = (c, month, y) => `${month}-01` >= `${shiftYears(c.start_date, y - 1).slice(0, 7)}-01` && `${month}-01` < shiftYears(c.start_date, y);
// A figure as typed or as a spreadsheet shows it: "1,200", "30%" and "£50"
// become numbers; anything else goes to the server as written, which says
// what's wrong with it.
const clean = (v) => {
  const s = String(v ?? '').trim().replace(/[,\s£]/g, '').replace(/%$/, '');
  if (s === '') return null;
  return /^\d+(\.\d+)?$/.test(s) ? Number(s) : String(v).trim();
};
const fileSafe = (s) => s.replace(/[^\w ()-]+/g, '').trim();

export default async function progress(ctx, el, [orgParam, monthParam]) {
  const c = ctx.consortium;
  const delivering = ctx.orgs.filter((o) => ['lead', 'accountable_body', 'delivery_partner'].includes(o.kind));
  const org = ctx.manages
    ? delivering.find((o) => o.id === orgParam) || delivering.find((o) => o.id === ctx.orgId) || delivering[0]
    : ctx.org(ctx.orgId);
  const first = c.start_date?.slice(0, 7);
  const last = [today().slice(0, 7), c.end_date?.slice(0, 7)].filter(Boolean).sort()[0];
  if (!org || !first || last < first) {
    render(el, html`<div class="page-head"><div><span class="eyebrow">Progress</span><h1>Progress against targets</h1></div></div>
      <div class="panel"><p>${!first ? 'The programme needs a start date before progress can be reported.' : `Reporting opens in ${fmtMonth(`${first}-01`)}, when the programme starts.`}</p></div>`);
    return;
  }
  const wanted = /^\d{4}-\d{2}$/.test(monthParam || '') ? monthParam : addMonths(today().slice(0, 7), -1);
  const month = wanted < first ? first : wanted > last ? last : wanted;
  const go = (o, m) => { location.hash = `#/c/${c.id}/progress/${o}/${m}`; };

  const [commits, entries, uploads, everyone] = await Promise.all([
    db.from('commitments').select('*, commitment_organisations(organisation_id)').eq('consortium_id', c.id)
      .is('superseded_by', null).is('retired_at', null).or(`organisation_id.is.null,organisation_id.eq.${org.id}`).then(must),
    db.from('progress_entries').select('*').eq('consortium_id', c.id).eq('organisation_id', org.id).then(must),
    db.from('progress_uploads').select('*').eq('consortium_id', c.id).eq('organisation_id', org.id).order('created_at', { ascending: false }).limit(12).then(must),
    ctx.manages ? db.from('progress_entries').select('organisation_id, period_month').eq('consortium_id', c.id).then(must) : [],
  ]);

  // The lines this organisation can report for this month, with what it has
  // reported so far: this month's figure, and the total (or, for a
  // percentage, the latest figure) from earlier months.
  const rows = commits.filter((k) => k.period === 'lifetime' || inYear(c, month, k.year)).map((k) => {
    const mine = entries.filter((e) => e.commitment_id === k.id);
    const now = mine.find((e) => e.period_month.slice(0, 7) === month);
    const before = mine.filter((e) => e.period_month.slice(0, 7) < month).sort((a, b) => a.period_month.localeCompare(b.period_month));
    const prior = !before.length ? null : isPct(k) ? before[before.length - 1].value : before.reduce((s, e) => s + Number(e.value), 0);
    const own = k.organisation_id === org.id;
    const linked = own || (k.commitment_organisations || []).some((l) => l.organisation_id === org.id);
    return { k, now, prior, own, linked, locked: isPct(k) && !ctx.manages };
  });
  const group = (r) => [r.k.section, KIND[r.k.kind] || 'Targets'].filter(Boolean).join(' · ');
  // As the documents list them: by section, outputs before outcomes, yearly
  // before lifetime, lines linked to this organisation first.
  rows.sort((a, b) => (a.k.section || '').localeCompare(b.k.section || '') || (a.k.kind === 'outcome') - (b.k.kind === 'outcome')
    || (a.k.period === 'lifetime') - (b.k.period === 'lifetime') || b.linked - a.linked || a.k.label.localeCompare(b.k.label));
  const groups = [...new Set(rows.map(group))];
  const anyLinked = rows.some((r) => r.linked && !r.own);
  const monthName = fmtMonth(`${month}-01`);
  const months = [];
  for (let m = last; m >= first; m = addMonths(m, -1)) months.push(m);

  const row = (r) => html`<tr class="entry-row" data-k="${r.k.id}" data-had="${r.now ? '1' : ''}" data-linked="${r.linked ? '1' : ''}">
    <td><strong>${r.k.label}</strong><br><span class="small muted">${[periodText(r.k), r.own ? `${org.name}'s own target` : r.linked ? `Linked to ${org.name}` : 'Whole consortium'].join(' · ')}</span></td>
    <td class="num">${figureText(r.k.target, r.k.unit)}</td>
    <td class="num">${r.prior == null ? '–' : figureText(r.prior, r.k.unit)}</td>
    <td class="num"><input name="v" inputmode="decimal" value="${r.now?.value ?? ''}" ${r.locked ? 'disabled' : ''} aria-label="${r.k.label}, ${monthName}"
      placeholder="${r.locked ? 'Lead' : ''}">${r.k.unit === '%' || r.k.measure === 'targeted_pct' ? ' %' : ''}</td>
    <td><input name="n" value="${r.now?.note ?? ''}" maxlength="500" ${r.locked ? 'disabled' : ''} aria-label="Note for ${r.k.label}"></td></tr>`;

  // For the lead: who has reported this month, and their latest month.
  const roundup = ctx.manages ? delivering.map((o) => {
    const theirs = everyone.filter((e) => e.organisation_id === o.id);
    return { o, now: theirs.filter((e) => e.period_month.slice(0, 7) === month).length, latest: theirs.map((e) => e.period_month).sort().pop() };
  }) : [];

  // At a glance: this month's lines filled, the organisation's figures month
  // by month, and (for the lead) every partner's reporting this month.
  const filled = rows.filter((r) => r.now).length;
  const filledPct = rows.length ? Math.round((100 * filled) / rows.length) : 0;
  const measureOf = Object.fromEntries(commits.map((k) => [k.id, k.measure]));
  const series = [];
  for (let m = first; m <= month; m = addMonths(m, 1)) series.push(m);
  const monthSum = (measure, m) => entries.filter((e) => measureOf[e.commitment_id] === measure && e.period_month.slice(0, 7) === m).reduce((t, e) => t + Number(e.value), 0);
  const monthCount = (m) => entries.filter((e) => e.period_month.slice(0, 7) === m).length;
  const shortM = new Intl.DateTimeFormat('en-GB', { month: 'short', year: '2-digit' });
  const label = (m) => shortM.format(new Date(`${m}-01T12:00:00`));
  const anyTrend = series.some((m) => monthCount(m));
  const reportedOrgs = roundup.filter((x) => x.now).length;
  const lastUpload = uploads[0];

  render(el, html`
    <div class="page-head"><div><span class="eyebrow">Progress</span><h1>What ${org.name} delivered</h1>
      <p class="muted">Report each month's figures against the targets. Type them in below, or download the spreadsheet, fill it in and upload it. Either way the portal checks every figure, keeps the record, and the dashboard adds them up.</p>
      <p style="margin-top:8px">${liveMark()}</p></div></div>

    <section class="panel"><form class="form" id="pick"><div class="fields">
      ${ctx.manages ? html`<label class="f">Organisation<select name="org">${delivering.map((o) => html`<option value="${o.id}" ${o.id === org.id ? 'selected' : ''}>${o.name}</option>`)}</select></label>` : ''}
      <label class="f">Month<select name="month">${months.map((m) => html`<option value="${m}" ${m === month ? 'selected' : ''}>${fmtMonth(`${m}-01`)}</option>`)}</select></label>
    </div></form>
    ${rows.length ? html`<div class="btns" style="margin-top:16px">
      <button class="btn secondary" type="button" id="download">Download spreadsheet for ${monthName}</button>
      <label class="btn secondary" for="sheet">Upload a completed spreadsheet</label>
      <input type="file" id="sheet" accept=".xlsx,.xls,.csv" hidden></div>
      <div id="preview"></div>` : ''}
    </section>

    <div class="stats stats-4">
      ${statCard({ icon: 'targets', value: rows.length ? `${filled} of ${rows.length}` : '–', label: 'Lines filled', trend: rows.length ? { dir: filled === rows.length ? 'up' : 'flat', tone: filled === rows.length ? 'green' : filled ? 'amber' : 'grey', chip: `${filledPct}%`, text: `for ${monthName}` } : null })}
      ${statCard({ icon: 'spreadsheet', value: monthCount(month), label: 'Figures saved', trend: { dir: 'flat', tone: 'grey', text: `for ${monthName} · ${entries.length} in total` } })}
      ${ctx.manages ? statCard({ icon: 'partners', value: `${reportedOrgs} of ${roundup.length}`, label: 'Partners reported', trend: { dir: reportedOrgs === roundup.length ? 'up' : 'flat', tone: reportedOrgs === roundup.length ? 'green' : 'amber', text: `for ${monthName}` } })
        : statCard({ icon: 'partners', value: entries.length ? fmtMonth(entries.map((e) => e.period_month).sort().pop()) : '–', label: 'Latest month reported', trend: { dir: 'flat', tone: 'grey', text: org.name } })}
      ${statCard({ icon: 'upload', value: uploads.length, label: 'Spreadsheets', trend: { dir: 'flat', tone: 'grey', text: lastUpload ? `latest ${fmtDateTime(lastUpload.created_at)}` : 'none yet' } })}</div>

    <div class="dgrid" style="margin-bottom:24px">
      <section class="dcard half"><header class="dcard-head"><h2>${monthName} at a glance</h2><p>Lines ${org.name} has filled for the month.</p></header>
        ${rows.length ? html`<div class="glance">${donut(filledPct, { size: 150, stroke: 18, color: 'var(--progress)', rest: 'var(--track)', label: 'filled' })}
          <ul class="glance-key">${groups.map((g) => { const gr = rows.filter((r) => group(r) === g); const n = gr.filter((r) => r.now).length;
            return html`<li><span>${g}</span><strong>${n} of ${gr.length}</strong><span class="slim"><span style="width:${gr.length ? (100 * n) / gr.length : 0}%"></span></span></li>`; })}</ul></div>`
        : html`<p class="muted">No lines to report this month.</p>`}</section>
      <section class="dcard half"><header class="dcard-head"><h2>Month by month</h2><p>Young people reached and attendances ${org.name} has reported.</p></header>
        ${anyTrend && series.length < 2 ? html`<div class="two-figs"><div><b>${fmtNum(monthSum('reached', month))}</b><span>young people reached in ${monthName}</span></div>
            <div><b>${fmtNum(monthSum('attendances', month))}</b><span>attendances in ${monthName}</span></div></div>
            <p class="muted small" style="margin-top:12px">The month-by-month line starts once there are two months of figures.</p>`
          : anyTrend ? chart(`${fmtNum(series.reduce((t, m) => t + monthSum('reached', m), 0))} young people and ${fmtNum(series.reduce((t, m) => t + monthSum('attendances', m), 0))} attendances reported so far.`, `${org.name}, by month`,
          lineChart(series.map(label), [
            { name: 'Attendances', color: 'var(--series-1)', values: series.map((m) => monthSum('attendances', m)) },
            { name: 'Young people', color: 'var(--series-2)', values: series.map((m) => monthSum('reached', m)) }]))
        : html`<p class="muted">The chart starts with the first month's figures.</p>`}</section>
      ${roundup.length ? html`<section class="dcard full"><header class="dcard-head"><h2>Who has reported for ${monthName}</h2><p>Figures each organisation has saved for the month, and the latest month it reported. Select one to see its figures.</p></header>
        ${hbars(roundup.map((x) => ({ id: x.o.id, label: x.o.name, sub: x.latest ? `Latest month reported: ${fmtMonth(x.latest)}` : 'Nothing reported yet',
          value: x.now ? `${x.now} figure${x.now === 1 ? '' : 's'}` : '', pill: x.now ? '' : html` <span class="pill pill-proposed">None yet</span>`,
          pct: x.now ? (100 * x.now) / Math.max(1, ...roundup.map((y) => y.now)) : 0, tone: x.now ? 'green' : 'grey' })))}</section>` : ''}
    </div>

    ${!commits.length ? html`<section class="panel" style="margin-top:20px"><p>There are no confirmed targets to report against yet. Once the lead confirms the targets under Targets and budget, they appear here.</p></section>`
    : !rows.length ? html`<section class="panel" style="margin-top:20px"><p>No targets fall in ${monthName}.</p></section>`
    : html`<section class="panel" style="margin-top:20px">
      <header><h2>${monthName}</h2>${anyLinked ? html`<label class="check small"><input type="checkbox" id="only-linked"> Only lines linked to ${org.name}</label>` : ''}</header>
      <form id="entry"><p class="muted small" style="margin-bottom:12px">Open a section to enter its figures. <button type="button" class="linkbtn small" id="open-all">Open all</button></p>
        ${groups.map((g, i) => {
          const gr = rows.filter((r) => group(r) === g);
          return sectionGroup({ title: g, open: i === 0, meta: `${gr.length} line${gr.length === 1 ? '' : 's'} · ${gr.filter((r) => r.now).length} filled for ${monthName}`,
            body: html`<div class="table-wrap"><table class="entry">
              <thead><tr><th>Output or outcome</th><th class="num">Target</th><th class="num">Reported before</th><th class="num">${monthName}</th><th>Note</th></tr></thead>
              <tbody>${gr.map(row)}</tbody></table></div>` });
        })}
      <div id="errors"></div>
      <p class="small muted" style="margin-top:10px">Leave a figure empty if there's nothing to report. Emptying a figure you saved before removes it.${rows.some((r) => r.locked) ? ' Percentages are reported by the consortium lead.' : ''}</p>
      <div class="btns" style="margin-top:14px"><button class="btn">Save ${monthName}</button></div></form></section>`}


    ${uploads.length ? html`<section class="panel" style="margin-top:20px">${sectionGroup({ title: `Spreadsheets ${org.name} uploaded`, meta: `${uploads.length} file${uploads.length === 1 ? '' : 's'} · latest ${fmtDateTime(uploads[0].created_at)}`, body: html`
      <div class="table-wrap"><table><thead><tr><th>File</th><th>Month</th><th class="num">Figures</th><th>Uploaded</th></tr></thead>
      <tbody>${uploads.map((u) => html`<tr><td><button type="button" class="linkbtn" data-path="${u.storage_path}">${u.file_name || 'Spreadsheet'}</button></td>
        <td>${fmtMonth(u.period_month)}</td><td class="num">${u.rows_saved}</td><td class="small">${fmtDateTime(u.created_at)}</td></tr>`)}</tbody></table></div>` })}</section>` : ''}`);

  const again = () => progress(ctx, el, [org.id, month]);
  $('#pick').addEventListener('change', (e) => go(e.currentTarget.elements.org?.value || org.id, e.currentTarget.elements.month.value));
  $('#only-linked')?.addEventListener('change', (e) => $$('table.entry').forEach((t) => t.classList.toggle('linked-only', e.target.checked)));
  $('#open-all')?.addEventListener('click', (e) => {
    const open = e.currentTarget.textContent === 'Open all';
    $$('#entry details.tgroup').forEach((d) => { d.open = open; });
    e.currentTarget.textContent = open ? 'Close all' : 'Open all';
  });
  $$('[data-path]').forEach((b) => b.addEventListener('click', () => openFile(b, 'documents', b.dataset.path)));
  $$('.hbar[data-id]').forEach((b) => { const open = () => go(b.dataset.id, month); b.addEventListener('click', open); b.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); }); });
  // Live: new figures from anyone reload the page, unless figures are being
  // typed here, in which case a banner offers the refresh instead.
  let typing = false;
  $('#entry')?.addEventListener('input', () => { typing = true; });
  live(c.id, () => {
    if (typing) {
      if (!$('.fresh-banner', el)) el.insertAdjacentHTML('afterbegin', '<div class="lead-banner fresh-banner"><span><strong>New figures have arrived.</strong> Save yours first, then refresh to see them.</span><button class="btn secondary" type="button" data-fresh>Refresh</button></div>');
      $('[data-fresh]', el)?.addEventListener('click', again);
      return;
    }
    const y = window.scrollY;
    again().then(() => window.scrollTo(0, y));
  });

  const call = (p_rows, p_dry_run, file) => db.rpc('save_progress', {
    p_consortium: c.id, p_org: org.id, p_month: `${month}-01`, p_rows, p_dry_run, p_file_path: file?.path ?? null, p_file_name: file?.name ?? null,
  }).then(must);
  const errorList = (errs) => html`<div class="banner warn" style="margin-top:14px"><strong>Nothing was saved. Fix ${errs.length === 1 ? 'this' : 'these'} first:</strong>
    <ul style="margin:6px 0 0;padding-left:18px">${errs.map((m) => html`<li>${m}</li>`)}</ul></div>`;

  // ------------------------------------------------------ typed in the page
  $('#entry')?.addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      render($('#errors'), '');
      const p_rows = $$('tr[data-k]', e.target).filter((tr) => !tr.querySelector('[name=v]').disabled).map((tr) => ({
        commitment_id: tr.dataset.k, value: clean(tr.querySelector('[name=v]').value), note: tr.querySelector('[name=n]').value, had: !!tr.dataset.had,
      })).filter((r) => r.value !== null || r.had).map(({ had, ...r }) => r);
      const check = await call(p_rows, true);
      if (!check.ok) { render($('#errors'), errorList(check.errors)); return; }
      if (!check.plan.some((p) => p.action !== 'unchanged')) { toast('Nothing has changed.'); return; }
      const res = await call(p_rows, false);
      toast(`${monthName} saved: ${res.saved} figure${res.saved === 1 ? '' : 's'}${res.cleared ? `, ${res.cleared} removed` : ''}.`);
      again();
    });
  });

  // -------------------------------------------------------- spreadsheet out
  $('#download')?.addEventListener('click', (e) => act(e.currentTarget, async () => {
    const X = await loadXlsx();
    const aoa = [
      [`Progress return: ${c.name}`],
      ['Organisation', org.name],
      ['Month', monthName],
      ['Organisation ref', org.id],
      ['Month ref', month],
      ['Fill in "This month" for each line you have something to report, with a note if it helps. Leave it empty if there\'s nothing to report. Don\'t change the refs, the Ref column or the column order.'],
      [],
      COLS,
      ...rows.map((r) => [group(r), `${r.k.label}${r.locked ? ' (reported by the lead)' : ''}`, periodText(r.k), figureText(r.k.target, r.k.unit),
        r.prior == null ? '' : figureText(r.prior, r.k.unit), r.now?.value == null ? '' : Number(r.now.value), r.now?.note ?? '', r.k.id]),
    ];
    const ws = X.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 26 }, { wch: 70 }, { wch: 16 }, { wch: 10 }, { wch: 14 }, { wch: 12 }, { wch: 40 }, { wch: 38 }];
    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, ws, 'Progress');
    X.writeFile(wb, `${fileSafe(`${c.name} progress ${org.name} ${month}`)}.xlsx`);
  }));

  // --------------------------------------------------------- spreadsheet in
  $('#sheet')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    act(null, async () => {
      const X = await loadXlsx();
      const wb = X.read(await file.arrayBuffer());
      const ws = wb.Sheets.Progress || wb.Sheets[wb.SheetNames[0]];
      const grid = X.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
      const meta = (label) => String(grid.find((r) => String(r[0]).trim() === label)?.[1] ?? '').trim();
      const h = grid.findIndex((r) => r.map((x) => String(x).trim()).includes(REF));
      if (h < 0) throw new Error('That isn\'t a progress spreadsheet from the portal. Download the spreadsheet for this month, fill it in and upload that.');
      if (meta('Organisation ref') !== org.id || meta('Month ref') !== month) {
        const theirs = ctx.org(meta('Organisation ref'))?.name || 'another organisation';
        throw new Error(`That spreadsheet is for ${theirs}, ${/^\d{4}-\d{2}$/.test(meta('Month ref')) ? fmtMonth(`${meta('Month ref')}-01`) : 'another month'}. Choose that organisation and month first, or download the spreadsheet for ${org.name}, ${monthName}.`);
      }
      const col = (name) => grid[h].map((x) => String(x).trim()).indexOf(name);
      const had = new Set(rows.filter((r) => r.now).map((r) => r.k.id));
      const p_rows = grid.slice(h + 1).filter((r) => String(r[col(REF)] ?? '').trim()).map((r) => ({
        commitment_id: String(r[col(REF)]).trim(), value: clean(r[col('This month')]), note: String(r[col('Note')] ?? '').trim(),
      })).filter((r) => r.value !== null || had.has(r.commitment_id));
      const check = await call(p_rows, true);
      const changes = check.plan.filter((p) => p.action !== 'unchanged');
      const fmt = (p, v) => (v == null ? '–' : figureText(v, p.unit));
      render($('#preview'), html`<div class="preview">
        <h3>${file.name}</h3>
        ${check.ok ? '' : errorList(check.errors)}
        ${changes.length ? html`<p class="small" style="margin-top:8px">${changes.length} change${changes.length === 1 ? '' : 's'} for ${monthName}:</p>
          <div class="table-wrap"><table><thead><tr><th>Output or outcome</th><th class="num">Was</th><th class="num">Now</th></tr></thead>
          <tbody>${changes.map((p) => html`<tr class="diff-${p.action === 'cleared' ? 'removed' : p.action === 'added' ? 'added' : 'changed'}"><td>${p.label}<br><span class="small muted">${periodText(p)}${p.note ? ` · ${p.note}` : ''}</span></td>
            <td class="num">${fmt(p, p.old_value)}</td><td class="num">${p.action === 'cleared' ? 'Removed' : fmt(p, p.new_value)}</td></tr>`)}</tbody></table></div>`
        : check.ok ? html`<p class="small muted" style="margin-top:8px">This spreadsheet matches what's already saved for ${monthName}.</p>` : ''}
        <div class="btns" style="margin-top:12px">${check.ok && changes.length ? html`<button class="btn" type="button" id="save-sheet">Save these figures</button>` : ''}
          <button class="btn secondary" type="button" id="cancel-sheet">${check.ok && changes.length ? 'Cancel' : 'Close'}</button></div></div>`);
      $('#cancel-sheet').addEventListener('click', () => render($('#preview'), ''));
      $('#save-sheet')?.addEventListener('click', (ev) => act(ev.currentTarget, async () => {
        const path = await uploadFile('documents', `${c.id}/progress/${org.id}`, file);
        const res = await call(p_rows, false, { path, name: file.name });
        toast(`${monthName} saved from ${file.name}: ${res.saved} figure${res.saved === 1 ? '' : 's'}${res.cleared ? `, ${res.cleared} removed` : ''}.`);
        again();
      }));
    });
  });
}
