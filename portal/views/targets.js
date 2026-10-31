// Targets and budget. The lead uploads the programme's documents, has Claude
// read every target and budget line out of them, reviews each one against
// its source, and confirms once the figures reconcile. Each partner's org
// admin then confirms their own targets and budget. Re-running on a new
// document version shows what changed before anything is replaced.
import { db, html, render, $, $$, formData, toast, act, must, fmtDate, fmtDateTime, fmtMoney, fmtNum, statusPill, uploadFile, MEASURE_LABEL, pill, segControl, bindSegments, sectionGroup, toneBar } from '../lib.js';
import { loadBudget, budgetView } from './budget.js';

const PROGRAMME_DOCS = {
  application_form: 'Application form', submitted_bid: 'Submitted bid', budget: 'Budget', delivery_model: 'Delivery model (e.g. Annex A)',
  grant_agreement: 'Offer letter or grant agreement', monitoring_framework: 'Monitoring framework',
};
const ACCEPT = '.pdf,.docx,.xlsx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const CENTRAL = '__central';
const TOTAL = '__total';
const KIND = { output: 'Output', outcome: 'Outcome' };

// How the document states a target: its period and its figure as written.
export const periodText = (r) => (r.period === 'lifetime' ? 'Project lifetime' : `Year ${r.year ?? '?'}`);
export const figureText = (value, unit) => (unit === '%' ? `${fmtNum(value)}%` : fmtNum(value));
const context = (r) => [KIND[r.kind], r.section, r.priority].filter(Boolean).join(' · ');

export default async function targets(ctx, el, [sub, id]) {
  if (sub === 'run' && id && ctx.manages) return review(ctx, el, id);
  return ctx.manages ? leadHome(ctx, el) : partnerHome(ctx, el);
}

// Current (not superseded, not retired) commitments, with the organisations
// each is linked to, and allocations.
async function current(ctx, orgId) {
  let c = db.from('commitments').select('*, commitment_organisations(organisation_id)').eq('consortium_id', ctx.consortium.id)
    .is('superseded_by', null).is('retired_at', null).order('period', { ascending: false }).order('year').order('section').order('label');
  let a = db.from('allocations').select('*').eq('consortium_id', ctx.consortium.id).is('superseded_by', null).is('retired_at', null).order('year').order('budget_line');
  if (orgId) { c = c.eq('organisation_id', orgId); a = a.eq('organisation_id', orgId); }
  return Promise.all([c.then(must), a.then(must)]);
}

const linkedNames = (ctx, r) => (r.commitment_organisations || []).map((l) => ctx.org(l.organisation_id)?.name).filter(Boolean).join(', ');
// Targets one period at a time (a segmented switch), grouped into sections
// as the documents group them, each closed to a one-line summary.
const periodKey = (r) => (r.period === 'lifetime' ? 'lifetime' : String(r.year));
const periodName = (p) => (p === 'lifetime' ? 'Project lifetime' : `Year ${p}`);
const sectionKey = (r) => `${r.section || 'Other'} ${r.kind === 'outcome' ? 'outcomes' : 'outputs'}`;
const sectionRank = (k) => (k.startsWith('Targeted') ? 0 : k.startsWith('Universal') ? 1 : 2);
let paneCount = 0;
const targetTable = (ctx, rows, showOrg) => {
  if (!rows.length) return html`<p class="empty">No targets yet.</p>`;
  const name = `tp${++paneCount}`;
  const periods = [...new Set(rows.map(periodKey))].sort((a, b) => (a === 'lifetime') - (b === 'lifetime') || a - b);
  const table = (list) => html`<div class="table-wrap"><table>
    <thead><tr><th>Output or outcome</th>${showOrg ? html`<th>Who</th>` : ''}<th>Linked organisations</th><th class="num">Target</th><th>Version</th><th>Partner confirmed</th></tr></thead>
    <tbody>${list.map((r) => html`<tr><td><strong>${r.label}</strong><br><span class="small muted">${periodText(r)} · ${context(r)}${r.site_id ? ` · ${ctx.site(r.site_id)?.name}` : r.site_name ? ` · ${r.site_name}` : ''}</span></td>
      ${showOrg ? html`<td>${r.organisation_id ? ctx.org(r.organisation_id)?.name : 'Whole consortium'}</td>` : ''}
      <td class="small">${linkedNames(ctx, r) || html`<span class="muted">–</span>`}</td>
      <td class="num">${figureText(r.target, r.unit)}</td><td>v${r.version}</td>
      <td class="small">${r.organisation_id ? (r.confirmed_by_partner_at ? fmtDateTime(r.confirmed_by_partner_at) : html`<span class="pill pill-proposed">Waiting</span>`) : '–'}</td></tr>`)}</tbody></table></div>`;
  return html`<div class="group-tools">${periods.length > 1 ? segControl(name, [...periods.map((p) => [p, periodName(p)]), ['', 'All periods']], periods[0]) : html`<span></span>`}
      <span class="muted small">${rows.length} target${rows.length === 1 ? '' : 's'}</span></div>
    ${periods.map((p) => {
      const pr = rows.filter((r) => periodKey(r) === p);
      const keys = [...new Set(pr.map(sectionKey))].sort((a, b) => sectionRank(a) - sectionRank(b) || a.localeCompare(b));
      return html`<div class="pane" data-seg-pane="${name}:${p}"><h3 class="pane-head">${periodName(p)}</h3>${keys.map((k) => {
        const kr = pr.filter((r) => sectionKey(r) === k);
        const waiting = kr.filter((r) => r.organisation_id && !r.confirmed_by_partner_at).length;
        return sectionGroup({ title: k, meta: `${kr.length} target${kr.length === 1 ? '' : 's'}${kr.some((r) => r.organisation_id) ? ` · ${kr.filter((r) => r.confirmed_by_partner_at).length} confirmed` : ''}`,
          aside: waiting ? pill('amber', `${waiting} waiting`, 'waiting') : '', body: table(kr) });
      })}</div>`;
    })}`;
};

// ------------------------------------------------------------------ partner

async function partnerHome(ctx, el) {
  const [[commit, alloc], links, budget] = await Promise.all([
    current(ctx, ctx.orgId),
    db.from('commitment_organisations').select('commitments(*, commitment_organisations(organisation_id))').eq('organisation_id', ctx.orgId).then(must),
    loadBudget(ctx, ctx.orgId),
  ]);
  const linked = links.map((l) => l.commitments).filter((x) => x && !x.superseded_by && !x.retired_at);
  const waiting = [...commit, ...alloc].filter((r) => !r.confirmed_by_partner_at).length;
  const canConfirm = ctx.role === 'partner_manager' || ctx.extraRoles.includes('org_admin');
  render(el, html`
    <div class="page-head"><div><span class="eyebrow">Targets and budget</span><h1>${ctx.orgName}'s commitments</h1>
      <p class="muted">What ${ctx.orgName} is committed to deliver, and its budget, as agreed with the consortium lead.</p></div></div>
    ${linked.length ? html`<section class="panel" style="margin-bottom:20px"><h2>Outputs and outcomes ${ctx.orgName} is linked to</h2>
      <p class="muted small">Consortium targets the programme documents connect to ${ctx.orgName}, for example as the organisation that delivers them or holds the evidence.</p>
      ${targetTable(ctx, linked, false)}</section>` : ''}
    ${commit.length + alloc.length === 0 ? html`<div class="panel"><p>The lead hasn't allocated targets or budget of ${ctx.orgName}'s own yet.</p></div>` : html`
      ${waiting ? html`<div class="banner warn" style="margin-bottom:20px"><strong>${waiting} item${waiting === 1 ? '' : 's'} to confirm.</strong>
        ${canConfirm ? 'Check the figures below. If anything is wrong, tell the lead before confirming.' : 'Your organisation admin confirms these.'}</div>`
      : html`<div class="banner info" style="margin-bottom:20px">Everything here is confirmed.</div>`}
      <section class="panel"><h2>Targets</h2>${targetTable(ctx, commit, false)}</section>
      <section class="panel" style="margin-top:20px"><h2>Budget</h2>${budgetView(ctx, budget)}
        ${!alloc.length && !canConfirm && !ctx.extraRoles.includes('finance') ? html`<p class="small muted">Budgets are visible to your organisation's admin and finance roles.</p>` : ''}</section>
      ${waiting && canConfirm ? html`<section class="panel" style="margin-top:20px"><h2>Confirm</h2>
        <form class="form" id="confirm">
          <label class="check"><input type="checkbox" required> I've checked these targets and budget and confirm them on behalf of ${ctx.orgName}.</label>
          <div class="btns"><button class="btn">Confirm targets and budget</button></div></form></section>` : ''}`}`);
  bindSegments(el);
  $('#confirm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      const n = must(await db.rpc('confirm_partner_allocation', { p_consortium: ctx.consortium.id }));
      toast(`${n} item${n === 1 ? '' : 's'} confirmed.`); partnerHome(ctx, el);
    });
  });
}

// --------------------------------------------------------------------- lead

async function leadHome(ctx, el) {
  const c = ctx.consortium;
  const [docs, runs, confirmations, [commit], budget] = await Promise.all([
    db.from('documents').select('*').eq('consortium_id', c.id).in('kind', Object.keys(PROGRAMME_DOCS)).order('created_at', { ascending: false }).then(must),
    db.from('extraction_runs').select('*').eq('consortium_id', c.id).order('created_at', { ascending: false }).limit(20).then(must),
    db.rpc('partner_confirmations', { p_consortium: c.id }).then(must),
    current(ctx, null),
    loadBudget(ctx, null),
  ]);
  // Latest version of each document: one nothing else replaces.
  const replaced = new Set(docs.map((d) => d.previous_id).filter(Boolean));
  const latest = docs.filter((d) => !replaced.has(d.id));
  const running = runs.some((r) => r.status === 'running');

  render(el, html`
    <div class="page-head"><div><span class="eyebrow">Targets and budget</span><h1>From documents to commitments</h1>
      <p class="muted">Upload the programme's documents, let the portal read every target and budget line from them, check each one against its source, then confirm. Partners confirm their own figures after that.</p></div></div>

    <div class="grid2">
      <section class="panel"><h2>Programme documents</h2>
        ${latest.length ? html`<form id="run-form"><div class="table-wrap"><table>
          <thead><tr><th></th><th>Document</th><th>Version</th><th>Added</th></tr></thead>
          <tbody>${latest.map((d) => html`<tr><td><input type="checkbox" name="doc" value="${d.id}" checked aria-label="Read ${d.title}"></td>
            <td><strong>${d.title}</strong><br><span class="small muted">${PROGRAMME_DOCS[d.kind]} · ${d.file_name || ''}</span></td>
            <td>v${d.version}</td><td class="small nowrap">${fmtDate(d.created_at)}<br><button type="button" class="linkbtn small" data-new-version="${d.id}">New version</button></td></tr>`)}
          </tbody></table></div>
          <div class="btns" style="margin-top:14px"><button class="btn" ${running ? 'disabled' : ''}>${running ? 'Reading…' : 'Read the ticked documents'}</button></div>
          <p class="small muted" style="margin-top:8px">The text of these documents is sent to the Claude API to find the figures. Don't upload anything containing young people's personal details.</p>
        </form>` : html`<p class="empty">No programme documents yet.</p>`}
        <details class="add" id="upload-box" style="margin-top:14px"><summary id="upload-summary">Upload a document</summary>
          <form class="form" id="upload"><input type="hidden" name="previous_id">
            <div class="fields">
              <label class="f">Type<select name="kind" required>${Object.entries(PROGRAMME_DOCS).map(([k, v]) => html`<option value="${k}">${v}</option>`)}</select></label>
              <label class="f">Title<input name="title" required></label></div>
            <label class="f">File<span class="hint">PDF, Word (.docx) or Excel (.xlsx). Scanned PDFs need a text layer.</span><input type="file" name="file" accept="${ACCEPT}" required></label>
            <div class="btns"><button class="btn">Upload</button></div></form></details>
      </section>

      <section class="panel"><h2>Reading runs</h2>
        ${runs.length ? html`<div class="table-wrap"><table><thead><tr><th>Started</th><th>Documents</th><th>Status</th></tr></thead>
          <tbody>${runs.map((r) => html`<tr><td class="small nowrap">${['needs_review', 'confirmed'].includes(r.status) ? html`<a href="#/c/${c.id}/targets/run/${r.id}">${fmtDateTime(r.created_at)}</a>` : fmtDateTime(r.created_at)}</td>
            <td>${r.source_document_ids.length}</td>
            <td>${statusPill(r.status)}${r.error ? html`<br><span class="small warn-text">${r.error}</span>` : ''}</td></tr>`)}</tbody></table></div>`
        : html`<p class="empty">Nothing read yet.</p>`}
        ${running ? html`<p class="small muted" style="margin-top:10px">Reading usually takes one to three minutes. This page updates by itself.</p>` : ''}
      </section>
    </div>

    <section class="panel" style="margin-top:20px"><h2>Partner confirmation</h2>
      ${confirmations?.length ? html`<div class="table-wrap"><table><thead><tr><th>Partner</th><th class="num">Confirmed</th><th>Last confirmed</th></tr></thead>
        <tbody>${confirmations.map((p) => html`<tr><td><strong>${p.name}</strong></td>
          <td class="num">${p.confirmed === p.items ? html`<span class="pill pill-confirmed">All ${p.items}</span>` : html`<span class="pill pill-proposed">${p.confirmed} of ${p.items}</span>`}</td>
          <td class="small">${p.confirmed_at ? fmtDateTime(p.confirmed_at) : '–'}</td></tr>`)}</tbody></table></div>`
      : html`<p class="empty">Nothing allocated to partners yet.</p>`}
    </section>
    <section class="panel" style="margin-top:20px"><h2>Current targets</h2>${targetTable(ctx, commit, true)}</section>
    <section class="panel" style="margin-top:20px"><header><h2>Current budget</h2>
        ${ctx.manages ? html`<form id="grant" style="display:flex;gap:8px;align-items:end;flex-wrap:wrap"><label class="f">Grant value (£)<input type="number" name="grant_value" min="0" step="1" value="${c.grant_value ?? ''}" style="width:160px"></label>
          <button class="btn secondary small">Save</button></form>` : ''}</header>
      ${budgetView(ctx, budget, { project: true })}</section>`);

  bindSegments(el);
  const again = () => leadHome(ctx, el);
  // The grant value lives here, with the rest of the money, not on the summary.
  $('#grant')?.addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      const v = e.target.elements.grant_value.value;
      must(await db.from('consortia').update({ grant_value: v === '' ? null : Number(v) }).eq('id', c.id));
      toast('Grant value saved.');
      await ctx.reload();
    });
  });
  if (running) setTimeout(() => { if (location.hash.endsWith('/targets')) again(); }, 6000);

  $$('[data-new-version]').forEach((b) => b.addEventListener('click', () => {
    const d = latest.find((x) => x.id === b.dataset.newVersion);
    const f = $('#upload');
    f.elements.previous_id.value = d.id;
    f.elements.kind.value = d.kind;
    f.elements.title.value = d.title;
    $('#upload-summary').textContent = `New version of ${d.title}`;
    $('#upload-box').open = true;
    f.elements.file.focus();
  }));
  $('#upload').addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      const f = formData(e.target);
      const file = e.target.elements.file.files[0];
      if (!/\.(pdf|docx|xlsx)$/i.test(file.name)) throw new Error('Upload a PDF, Word (.docx) or Excel (.xlsx) file.');
      const prev = f.previous_id ? latest.find((d) => d.id === f.previous_id) : null;
      const path = await uploadFile('documents', `${c.id}/shared`, file);
      must(await db.from('documents').insert({ consortium_id: c.id, kind: f.kind, title: f.title, storage_path: path, file_name: file.name,
        mime_type: file.type || null, uploaded_by: ctx.user.id, version: prev ? prev.version + 1 : 1, previous_id: prev?.id ?? null }));
      toast(prev ? `Version ${prev.version + 1} uploaded. Read it again to see what changed.` : 'Uploaded.'); again();
    });
  });
  $('#run-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      const ids = $$('input[name=doc]:checked', e.target).map((x) => x.value);
      if (!ids.length) throw new Error('Tick at least one document.');
      const { data, error } = await db.functions.invoke('extract-programme-data', { body: { consortium_id: c.id, document_ids: ids } });
      if (error) {
        let message = error.message;
        try { message = (await error.context.json()).error || message; } catch { /* keep the generic message */ }
        throw new Error(message);
      }
      toast('Reading the documents. This usually takes one to three minutes.');
      again();
      return data;
    });
  });
}

// ------------------------------------------------------------------- review

async function review(ctx, el, runId) {
  const c = ctx.consortium;
  const run = must(await db.from('extraction_runs').select('*').eq('id', runId).maybeSingle());
  if (!run) { render(el, html`<div class="panel">That run isn't available.</div>`); return; }
  const [items, docs] = await Promise.all([
    db.from('extracted_items').select('*').eq('extraction_run_id', runId).order('created_at').then(must),
    db.from('documents').select('id, title, storage_path, file_name').in('id', run.source_document_ids).then(must),
  ]);
  const open = run.status === 'needs_review';
  el.style.maxWidth = '1600px'; // the review table needs the room
  const partners = ctx.orgs.filter((o) => ['delivery_partner', 'accountable_body', 'lead'].includes(o.kind));
  const who = (i) => (i.is_consortium_total ? TOTAL : i.is_central ? CENTRAL : i.organisation_id || '');
  const years = [1, 2, 3, 4, 5];
  // Targets grouped as the documents group them (section, then output or
  // outcome); budget lines grouped by organisation.
  const groupOf = (i) => (i.item_type === 'budget_line'
    ? `2|Budget · ${i.is_central ? 'Central costs' : ctx.org(i.organisation_id)?.name || `Not allocated (${i.proposed_org_name || 'no name'})`}`
    : `1|${[i.section, i.kind === 'outcome' ? 'Outcomes' : 'Outputs'].filter(Boolean).join(' · ')}`);
  const groups = new Map();
  for (const i of items) {
    const key = groupOf(i);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  }
  const ordered = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  const dis = open ? '' : 'disabled';

  const row = (i) => html`<tr class="item-row ${i.review_status === 'rejected' ? 'rejected' : ''}" data-id="${i.id}">
    <td>${statusPill(i.review_status)}${i.needs_check ? html`<br><span class="warn-text">Check: ${i.check_reason}</span>` : ''}</td>
    <td><textarea name="label" rows="2" ${dis} aria-label="Wording">${i.label || i.budget_line_name || ''}</textarea>
      ${i.priority ? html`<br><span class="small muted">${i.priority}</span>` : ''}
      ${i.evidence ? html`<details><summary class="small">Evidence</summary><p class="small muted">${i.evidence}</p></details>` : ''}</td>
    <td><input type="number" name="value" step="any" value="${i.value ?? ''}" ${dis} aria-label="Figure">${i.unit === '%' ? ' %' : ''}</td>
    <td>${i.item_type === 'target'
      ? html`<select name="period" ${dis} aria-label="Period"><option value="lifetime" ${i.period === 'lifetime' ? 'selected' : ''}>Project lifetime</option>
          ${years.map((y) => html`<option value="${y}" ${i.period === 'year' && i.year === y ? 'selected' : ''}>Year ${y}</option>`)}</select>`
      : html`<select name="period" ${dis} aria-label="Year">${years.map((y) => html`<option value="${y}" ${i.year === y ? 'selected' : ''}>Year ${y}</option>`)}</select>`}</td>
    <td>${i.item_type === 'target'
      ? html`<select name="measure" ${dis} aria-label="Tracked as">${Object.entries(MEASURE_LABEL).map(([k, v]) => html`<option value="${k}" ${i.measure === k ? 'selected' : ''}>${k === 'other' ? 'Not tracked automatically' : v}</option>`)}</select>`
      : html`<span class="small muted">–</span>`}</td>
    <td><select name="who" ${dis} aria-label="Belongs to">
      <option value="">Not allocated${i.proposed_org_name ? ` (document says ${i.proposed_org_name})` : ''}</option>
      ${i.item_type === 'target' ? html`<option value="${TOTAL}" ${who(i) === TOTAL ? 'selected' : ''}>Whole consortium</option>`
        : html`<option value="${CENTRAL}" ${who(i) === CENTRAL ? 'selected' : ''}>Central costs</option>`}
      ${partners.map((o) => html`<option value="${o.id}" ${who(i) === o.id ? 'selected' : ''}>${o.name}</option>`)}</select></td>
    <td>${i.item_type === 'target' ? html`<details class="links"><summary class="small">${i.linked_org_ids.length ? i.linked_org_ids.map((x) => ctx.org(x)?.name).filter(Boolean).join(', ') : 'None'}</summary>
        ${i.named_organisations.length ? html`<p class="small muted">Document names: ${i.named_organisations.join(', ')}</p>` : html`<p class="small muted">The document names no organisation for this line.</p>`}
        ${partners.map((o) => html`<label class="check small"><input type="checkbox" name="link" value="${o.id}" ${i.linked_org_ids.includes(o.id) ? 'checked' : ''} ${dis}> ${o.name}</label><br>`)}
      </details>` : html`<span class="small muted">–</span>`}</td>
    <td class="ref">${i.source_document_id ? html`<button type="button" class="linkbtn small" data-doc="${i.source_document_id}" data-page="${i.source_page || ''}">${i.source_reference}</button>` : i.source_reference}</td>
    <td class="nowrap">${open ? html`<button type="button" class="btn small" data-act="accept">Accept</button> <button type="button" class="btn small secondary" data-act="reject">Reject</button>` : ''}</td>
  </tr>`;

  render(el, html`
    <p class="small" style="margin-bottom:10px"><a href="#/c/${c.id}/targets">← Targets and budget</a></p>
    <div class="page-head"><div><span class="eyebrow">Review · ${fmtDateTime(run.created_at)}</span><h1>Check what was read</h1>
      <p class="muted">Every line is the document's own wording and figure, with a link to where it came from. Accept what's right, correct anything that isn't (it's then marked as edited), and reject what doesn't belong. Organisations are linked only where the document names them; tick others yourself if you know them. Confirm unlocks when every check passes.</p>
      <p style="margin-top:8px">${statusPill(run.status)}</p></div></div>
    <div class="grid2">
      <section class="panel"><h2>Checks</h2><div id="checks"><p class="muted">Checking…</p></div>
        ${c.targeted_share_target != null ? html`<label class="f" style="margin-top:14px">The ${c.targeted_share_target}% targeted-share minimum applies
          <select id="basis" ${dis}><option value="each_year" ${c.targeted_share_basis === 'each_year' ? 'selected' : ''}>to every year</option>
          <option value="programme_average" ${c.targeted_share_basis === 'programme_average' ? 'selected' : ''}>to the average across the programme</option></select></label>` : ''}
      </section>
      <section class="panel"><h2>What confirming will change</h2><div id="diff"><p class="muted">Working it out…</p></div></section>
    </div>
    ${open ? html`<div class="btns" style="margin:20px 0"><button class="btn" id="confirm" disabled>Confirm and create commitments</button>
      <button class="btn secondary" id="accept-all" type="button">Accept everything not yet reviewed</button></div>` : ''}
    <section class="panel" style="margin-top:20px"><h2>${items.length} line${items.length === 1 ? '' : 's'}</h2>
      ${items.length ? html`<p class="muted small" style="margin-bottom:12px">Grouped as the documents group them. Sections with lines still to review start open.</p>
        ${ordered.map(([key, rows]) => {
          const n = (st) => rows.filter((r) => r.review_status === st).length;
          return sectionGroup({ title: key.split('|')[1], open: n('proposed') > 0,
            meta: `${rows.length} line${rows.length === 1 ? '' : 's'} · ${n('accepted') + n('edited')} accepted${n('rejected') ? ` · ${n('rejected')} rejected` : ''}${rows.some((r) => r.needs_check) ? ` · ${rows.filter((r) => r.needs_check).length} to check` : ''}`,
            aside: toneBar([['green', n('accepted') + n('edited'), 'accepted'], ['red', n('rejected'), 'rejected'], ['none', n('proposed'), 'to review']]),
            body: html`<div class="table-wrap"><table>
              <thead><tr><th>Status</th><th>Wording in the document</th><th>Figure</th><th>Period</th><th>Tracked as</th><th>Belongs to</th><th>Linked organisations</th><th>Source</th><th></th></tr></thead>
              <tbody>${rows.map(row)}</tbody></table></div>` });
        })}` : html`<p class="empty">No figures were found in these documents.</p>`}
    </section>`);

  const docById = (did) => docs.find((d) => d.id === did);
  $$('[data-doc]').forEach((b) => b.addEventListener('click', () => {
    const d = docById(b.dataset.doc);
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    act(b, async () => {
      const { signedUrl } = must(await db.storage.from('documents').createSignedUrl(d.storage_path, 300));
      const url = b.dataset.page && /\.pdf$/i.test(d.file_name || '') ? `${signedUrl}#page=${b.dataset.page}` : signedUrl;
      if (tab) tab.location = url; else location.href = url;
    });
  }));

  async function refresh() {
    const res = must(await db.rpc('intake_review', { p_run: runId }));
    render($('#checks'), html`<ul class="checklist">${res.checks.map((k) => html`<li class="${k.ok ? 'ok' : 'bad'}"><span class="mark">${k.ok ? '✓' : '✗'}</span>
      <span><strong>${k.label}</strong>${k.key === 'budget' && k.difference != null ? html` <span class="small muted">(difference ${fmtMoney(k.difference)})</span>` : ''}
      ${k.key === 'targeted' && k.years?.length ? html`<br><span class="small muted">${k.years.join(' · ')}</span>` : ''}
      ${k.details?.length ? html`<ul>${k.details.map((d) => html`<li>${d}</li>`)}</ul>` : ''}</span></li>`)}</ul>`);
    const counts = { added: 0, changed: 0, removed: 0, unchanged: 0 };
    res.plan.forEach((p) => { counts[p.action] += 1; });
    const label = (p) => `${p.kind === 'target' ? p.label : p.budget_line}, ${p.period === 'lifetime' ? 'project lifetime' : `year ${p.year}`} · ${p.is_central ? 'Central costs' : p.organisation_id ? ctx.org(p.organisation_id)?.name : p.kind === 'target' ? 'Whole consortium' : 'Not allocated'}`;
    const fmt = (p, v) => (p.kind === 'budget_line' ? fmtMoney(v) : fmtNum(v));
    const changes = res.plan.filter((p) => p.action !== 'unchanged');
    render($('#diff'), html`<p class="small"><span class="diff-added">${counts.added} added</span> · <span class="diff-changed">${counts.changed} changed</span> · <span class="diff-removed">${counts.removed} removed</span> · ${counts.unchanged} unchanged</p>
      ${changes.length ? html`<ul class="small" style="margin-top:8px">${changes.slice(0, 40).map((p) => html`<li class="diff-${p.action}">${p.action === 'added' ? '+' : p.action === 'removed' ? '−' : '~'} ${label(p)}:
        ${p.action === 'changed' ? `${fmt(p, p.old_value)} → ${fmt(p, p.new_value)}` : p.action === 'removed' ? fmt(p, p.old_value) : fmt(p, p.new_value)}</li>`)}</ul>
        ${changes.length > 40 ? html`<p class="small muted">…and ${changes.length - 40} more.</p>` : ''}` : ''}
      ${counts.changed + counts.removed ? html`<p class="small muted" style="margin-top:8px">Old versions are kept. Partners whose figures change will be asked to confirm again.</p>` : ''}`);
    const btn = $('#confirm');
    if (btn) btn.disabled = !res.ok;
  }
  await refresh();
  if (!open) return;

  // Save a row. Changing the wording, figure, period or tracking counts as an
  // edit; allocation and links are review decisions, not edits.
  async function save(tr, status) {
    const id = tr.dataset.id;
    const it = items.find((x) => x.id === id);
    const get = (n) => tr.querySelector(`[name=${n}]`)?.value ?? '';
    const w = get('who');
    const per = get('period');
    const patch = {
      label: get('label').trim() || null,
      value: get('value') === '' ? null : Number(get('value')),
      period: it.item_type === 'target' && per === 'lifetime' ? 'lifetime' : 'year',
      year: per === 'lifetime' ? null : Number(per),
      is_consortium_total: w === TOTAL, is_central: w === CENTRAL,
      organisation_id: w && w !== TOTAL && w !== CENTRAL ? w : null,
    };
    if (it.item_type === 'target') {
      patch.measure = get('measure');
      patch.linked_org_ids = $$('input[name=link]:checked', tr).map((x) => x.value);
    } else patch.budget_line_name = patch.label;
    const was = { label: it.label || it.budget_line_name, value: it.value, period: it.period, year: it.year, measure: it.measure };
    const changed = Object.keys(was).some((k) => k in patch && String(patch[k] ?? '') !== String(was[k] ?? ''));
    patch.review_status = status === 'rejected' ? 'rejected' : changed ? 'edited' : status;
    must(await db.from('extracted_items').update(patch).eq('id', id));
    Object.assign(it, patch);
    const pill = tr.querySelector('td:first-child .pill');
    pill.className = `pill pill-${patch.review_status}`;
    pill.textContent = { accepted: 'Accepted', edited: 'Edited', rejected: 'Rejected', proposed: 'To review' }[patch.review_status];
    tr.classList.toggle('rejected', patch.review_status === 'rejected');
    const summary = tr.querySelector('details.links summary');
    if (summary) summary.textContent = patch.linked_org_ids.map((x) => ctx.org(x)?.name).filter(Boolean).join(', ') || 'None';
  }
  $$('[data-act]').forEach((b) => b.addEventListener('click', () => act(b, async () => {
    await save(b.closest('tr'), b.dataset.act === 'accept' ? 'accepted' : 'rejected');
    await refresh();
  })));
  // Allocation and link changes on an already reviewed line save straight away.
  $$('.item-row select[name=who], .item-row input[name=link]').forEach((s) => s.addEventListener('change', () => {
    const tr = s.closest('tr');
    const it = items.find((x) => x.id === tr.dataset.id);
    if (it.review_status !== 'proposed') act(null, async () => { await save(tr, it.review_status === 'rejected' ? 'rejected' : 'accepted'); await refresh(); });
  }));
  $('#basis')?.addEventListener('change', (e) => act(null, async () => {
    must(await db.from('consortia').update({ targeted_share_basis: e.target.value }).eq('id', c.id));
    c.targeted_share_basis = e.target.value;
    await refresh();
  }));
  $('#accept-all')?.addEventListener('click', (e) => act(e.currentTarget, async () => {
    for (const tr of $$('.item-row')) {
      const it = items.find((x) => x.id === tr.dataset.id);
      if (it.review_status === 'proposed') await save(tr, 'accepted');
    }
    await refresh();
  }));
  $('#confirm')?.addEventListener('click', (e) => act(e.currentTarget, async () => {
    const res = must(await db.rpc('confirm_extraction', { p_run: runId }));
    toast(`Confirmed: ${res.added} added, ${res.changed} changed, ${res.removed} removed.${res.partners_to_reconfirm.length ? ` ${res.partners_to_reconfirm.length} partner${res.partners_to_reconfirm.length === 1 ? '' : 's'} will confirm again.` : ''}`);
    location.hash = `#/c/${c.id}/targets`;
  }));
}
