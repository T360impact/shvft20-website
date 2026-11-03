// Plans: upload a mobilisation or operations plan (Word or PDF), the reader
// proposes tasks, agreements, checklists, meetings, milestones, outputs,
// lead decisions and delegations, each with its section. The review
// screen shows one kind at a time; accept, edit or reject each item, with
// the date the portal read from the wording and who the owner matched.
// A later version shows what changed against the plan that is live now.
// Nothing goes live until the lead confirms.
import { html, raw, render, $, $$, db, must, act, toast, icon, pill, openDrawer, fmtDate, fmtMonth, fmtDateTime, formData, emptyState, sectionGroup, segControl, bindSegments, statCard, statusPill } from '../../lib.js';
import { base, ROLE, RHYTHM, personName, ownerSelect, isSenior } from './common.js';

// Picked hub, date and view survive a live refresh.
const ui = (ctx) => ctx.lwUi || (ctx.lwUi = {});

const KINDS = [['task', 'Tasks'], ['agreement', 'Agreements'], ['checklist', 'Checklists'], ['meeting', 'Meetings'], ['milestone', 'Milestones'], ['output', 'Outputs'], ['decision', 'Lead decisions'], ['delegation', 'Delegations']];
const DIFF = { new: ['blue', 'New'], changed: ['amber', 'Changed'], removed: ['red', 'Removed'], unchanged: ['grey', 'Unchanged'] };
const FIELDS = {
  task: [['title', 'What'], ['detail', 'Detail', 'long'], ['owner', 'Owner'], ['due', 'By'], ['tracker', 'Tracker'], ['area', 'Area']],
  agreement: [['name', 'Agreement'], ['parties', 'Between'], ['must_settle', 'What it must settle', 'long'], ['drafter', 'Drafts'], ['signer', 'Signs'], ['target', 'Target']],
  checklist: [['name', 'Rhythm as written'], ['owner', 'Owner']],
  meeting: [['name', 'Meeting'], ['attendees', 'Who', 'long'], ['frequency', 'When'], ['purpose', 'What it does', 'long'], ['chair', 'Chair']],
  milestone: [['when', 'When'], ['what', 'Milestone', 'long'], ['evidence', 'Evidence']],
  output: [['name', 'Output'], ['year', 'Year'], ['target', 'Target'], ['recorded_by', 'Recorded by'], ['source', 'Source']],
  decision: [['text', 'Decision', 'long'], ['due', 'Due'], ['options', 'Options', 'long']],
  delegation: [['owner', 'Delegated to'], ['item', 'What', 'long']],
};
const dataTitle = (i) => { const d = { ...i.data, ...i.edits }; return d.title || d.name || d.what || d.text || d.item || RHYTHM[d.rhythm] || ''; };

export default async function plans(ctx, el, id, refresh) {
  if (!isSenior(ctx)) { render(el, emptyState('safeguarding', 'Plans are for the lead and operations lead.')); return; }
  if (id) return review(ctx, el, id, refresh);
  const rows = must(await db.from('plan_imports').select('id, title, file_name, status, version, created_at, confirmed_at, error, summary').eq('consortium_id', ctx.consortium.id).order('created_at', { ascending: false }));
  const live = rows.find((r) => r.status === 'confirmed');
  render(el, html`<div class="grid2">
    <section class="panel"><header><h2>Upload a plan</h2></header>
      <p class="small">A mobilisation or operations plan, as Word or PDF. The portal reads its tasks, agreements, checklists, meetings, milestones, outputs, your decisions and what you delegate, then waits for you to review it. ${live ? `Uploading a new version shows what has changed since version ${live.version}.` : ''}</p>
      <form class="form" id="up-form"><label class="f">Plan<input type="file" name="file" accept=".docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" required></label>
        <p class="small muted">The file stays in the lead team's private storage. Plans are about operations; if one contains young people's details, remove them first.</p>
        <div class="btns"><button class="btn">${raw(icon('upload', 16))}Read the plan</button></div></form></section>
    <section class="panel"><header><h2>Versions</h2></header>
      ${rows.length ? html`<ul class="lw-list">${rows.map((r) => html`<li><a class="lw-row" href="${base(ctx)}/plans/${r.id}"><span class="lw-row-main"><strong>${r.title || r.file_name}</strong>
        <span class="muted small">${r.version ? `Version ${r.version} · confirmed ${fmtDateTime(r.confirmed_at)}` : `Uploaded ${fmtDateTime(r.created_at)}`}${r.summary ? ` · ${r.summary.added} added, ${r.summary.changed} changed, ${r.summary.retired} removed` : ''}${r.error ? ` · ${r.error}` : ''}</span></span>
        <span class="lw-row-tags">${statusPill(r.status)}</span></a></li>`)}</ul>` : emptyState('upload', 'No plans yet.')}</section></div>`);
  $('#up-form', el).addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      const file = e.target.file.files[0];
      if (!/\.(docx|pdf)$/i.test(file.name)) throw new Error('Choose a Word (.docx) or PDF file.');
      const path = `${ctx.consortium.id}/plans/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]+/g, '_').slice(-80)}`;
      must(await db.storage.from('lead-workspace').upload(path, file, { contentType: file.type || undefined }));
      const { data, error } = await db.functions.invoke('extract-plan', { body: { consortium_id: ctx.consortium.id, storage_path: path, file_name: file.name, title: file.name.replace(/\.[^.]+$/, ''), mime_type: file.type || null } });
      if (error) { let m = error.message; try { m = (await error.context.json()).error || m; } catch { /* keep */ } throw new Error(m); }
      toast('Reading the plan. This takes one to three minutes.');
      location.hash = `${base(ctx)}/plans/${data.import_id}`;
    });
  });
}

async function review(ctx, el, id, refresh) {
  const r = must(await db.rpc('plan_import_review', { p_import: id }));
  const imp = r.import;
  if (imp.status === 'running') {
    render(el, html`<div class="lead-banner"><span><strong>Reading ${imp.file_name}.</strong> This usually takes one to three minutes.</span><button class="btn secondary" id="again">Check again</button></div>`);
    $('#again', el).addEventListener('click', () => review(ctx, el, id, refresh));
    setTimeout(() => { if (location.hash.endsWith(id) && document.body.contains(el)) review(ctx, el, id, refresh); }, 15000);
    return;
  }
  if (imp.status === 'failed') { render(el, html`<div class="lead-banner"><span><strong>The plan couldn't be read.</strong> ${imp.error || ''}</span><a class="btn secondary" href="${base(ctx)}/plans">Back to plans</a></div>`); return; }
  const items = r.items;
  const editable = imp.status === 'needs_review';
  const versioned = !!imp.previous_version && editable;
  if (ui(ctx)._pr?.id !== id) ui(ctx)._pr = { id, kind: KINDS.find(([k]) => items.some((i) => i.kind === k && (!versioned || i.diff !== 'unchanged')))?.[0] || 'task', diff: versioned ? 'todo' : '' };
  const st = ui(ctx)._pr;
  const pending = items.filter((i) => i.decision === 'pending').length;
  const isVersion = versioned;
  const n = (k) => items.filter((i) => i.kind === k && i.diff !== 'removed').length;

  const whenText = (i) => {
    const w = i.when; if (!w) return '';
    const over = i.edits?.due_date;
    if (over) return html`<span class="lw-when">${pill('green', `Set to ${fmtDate(over)}`)}</span>`;
    if (w.kind === 'date') return html`<span class="lw-when">“${w.text}” → <strong>${w.label}</strong>${w.note ? html` <span class="muted small">${w.note}</span>` : ''}</span>`;
    if (w.kind === 'recurring') return html`<span class="lw-when">${w.text ? `“${w.text}” → ` : ''}<strong>${w.label || (w.rule === 'DELIVERY_DAYS' ? 'Every delivery day' : w.rule)}</strong>${w.note ? html` <span class="muted small">${w.note}</span>` : ''}</span>`;
    if (w.kind === 'relative') return html`<span class="lw-when">“${w.text}” <span class="muted small">depends on another event; set a date if you know it</span></span>`;
    return w.text ? html`<span class="lw-when">“${w.text}” <span class="muted small">no date read</span></span>` : '';
  };
  const ownerText = (i) => {
    const o = { ...(i.owner || {}), ...(i.edits?.owner || {}) }; if (!o.label && !o.profile_id && !o.role) return '';
    if (o.profile_id) return html`<span class="lw-owner">${raw(icon('people', 14))}<strong>${personName(ctx, o.profile_id) || 'Team member'}</strong>${o.label ? html` <span class="muted small">from “${o.label}”</span>` : ''}</span>`;
    if (o.role) return html`<span class="lw-owner">${raw(icon('people', 14))}<strong>${ROLE[o.role]}</strong> <span class="muted small">role, no single person yet · “${o.label}”</span></span>`;
    if (o.organisation_id) return html`<span class="lw-owner">${raw(icon('partners', 14))}<strong>${ctx.org(o.organisation_id)?.name}</strong> <span class="muted small">organisation</span></span>`;
    return html`<span class="lw-owner muted small">Kept as written: “${o.label}”</span>`;
  };
  const changes = (i) => (i.diff === 'changed' && i.live_data ? FIELDS[i.kind].filter(([k]) => JSON.stringify(i.data[k] ?? null) !== JSON.stringify(i.live_data[k] ?? null)).map(([k, label]) => html`<p class="small lw-diffline"><strong>${label}:</strong>
    <del>${String(i.live_data[k] ?? '–')}</del> <ins>${String(i.data[k] ?? '–')}</ins></p>`) : '');
  const flag = (i) => { const arr = imp.document && null; void arr; return ''; };

  const card = (i) => {
    const d = { ...i.data, ...i.edits };
    return html`<article class="lw-pi ${i.decision} ${i.diff}" data-item="${i.id}">
      <header><span class="lw-pi-title">${dataTitle(i)}</span><span class="lw-card-tags">${isVersion || i.diff !== 'new' ? pill(DIFF[i.diff][0], DIFF[i.diff][1]) : ''}
        ${i.decision === 'accepted' ? pill('green', Object.keys(i.edits || {}).length ? 'Accepted with edits' : 'Accepted', 'approved') : i.decision === 'rejected' ? pill('red', 'Rejected', 'rejected') : ''}</span></header>
      ${i.kind === 'checklist' ? html`<p class="small"><strong>${RHYTHM[d.rhythm] || d.rhythm}</strong> · ${(d.items || []).length} items</p><ol class="lw-pi-items small">${(d.items || []).map((x) => html`<li>${x}</li>`)}</ol>`
        : FIELDS[i.kind].filter(([k]) => !['title', 'name', 'what', 'text', 'item', 'owner', 'due', 'target', 'when', 'frequency', 'tracker', 'area', 'detail'].includes(k) && d[k] != null && d[k] !== '').map(([k, label, long]) => html`<p class="small ${long ? 'lw-long' : ''}"><span class="muted">${label}:</span> ${String(d[k])}</p>`)}
      ${d.detail && d.detail !== d.title ? html`<details class="small lw-long"><summary>Full wording</summary><p>${d.detail}</p></details>` : ''}
      ${changes(i)}
      <div class="lw-pi-meta">${i.kind === 'task' ? html`<span class="lw-when">${d.tracker === 'consortium' ? 'Consortium' : 'Operations'} tracker</span>` : ''}${whenText(i)}${ownerText(i)}${i.kind === 'output' ? html`<span class="lw-when"><strong>${d.target}</strong> in year ${d.year}</span>` : ''}
        ${i.kind === 'agreement' && d.blocks_first_session ? pill('red', 'Blocks first session') : ''}</div>
      ${i.privacy ? html`<p class="small warn-text">${raw(icon('safeguarding', 14))} ${i.privacy} Edit it before accepting.</p>` : ''}
      <p class="small muted lw-src">${i.source_section || (i.diff === 'removed' ? 'In the live plan, not in this version' : '')}${i.quote && i.diff !== 'removed' ? ` · “${i.quote}”` : ''}</p>
      ${editable && i.diff !== 'unchanged' ? html`<div class="btns lw-pi-actions"><button class="btn small ${i.decision === 'accepted' ? '' : 'secondary'}" data-acc="${i.id}" ${raw(i.privacy ? 'disabled' : '')}>${i.diff === 'removed' ? 'Remove from live' : 'Accept'}</button>
        ${i.diff !== 'removed' ? html`<button class="btn small secondary" data-edit="${i.id}">Edit</button>` : ''}
        <button class="btn small ${i.decision === 'rejected' ? '' : 'secondary'}" data-rej="${i.id}">${i.diff === 'removed' ? 'Keep it' : 'Reject'}</button></div>` : ''}</article>`;
  };

  const shown = items.filter((i) => i.kind === st.kind && (!st.diff || (st.diff === 'todo' ? i.diff !== 'unchanged' : i.diff === st.diff)));
  // Long kinds open as sections: tasks by area, milestones by month,
  // delegations by owner. Each section says how many are left to decide.
  const groupOf = (i) => (i.kind === 'task' ? ({ ...i.data, ...i.edits }.area || 'Other')
    : i.kind === 'delegation' ? i.data.owner
    : i.kind === 'milestone' ? (i.when?.date ? fmtMonth(i.when.date) : 'No date') : null);
  const grouped = (list) => {
    if (groupOf(list[0]) == null) return list.map(card);
    const keys = [...new Set(list.map(groupOf))];
    return keys.map((k, n) => { const g = list.filter((i) => groupOf(i) === k); const p = g.filter((i) => i.decision === 'pending').length;
      return sectionGroup({ title: k, meta: `${g.length} item${g.length === 1 ? '' : 's'}${p ? ` · ${p} to decide` : ' · all decided'}`, open: n === 0, body: html`<div class="lw-pis">${g.map(card)}</div>` }); });
  };
  const diffCounts = Object.keys(DIFF).map((k) => [k, items.filter((i) => i.diff === k).length]);
  render(el, html`<div class="page-sub"><a class="linkbtn small" href="${base(ctx)}/plans">${raw(icon('next', 14))} All plans</a></div>
    <div class="lead-banner"><span><strong>${imp.title || imp.file_name}</strong>${imp.document?.dated ? ` · dated ${imp.document.dated}` : ''} · dates read against ${fmtDate(imp.anchor_date)}.
      ${editable ? (pending ? ` ${pending} item${pending === 1 ? '' : 's'} to decide. Nothing goes live until you confirm.` : ' Everything is decided.') : ` Confirmed as version ${imp.version}.`}</span>
      ${editable ? html`<span class="btns"><button class="btn secondary" id="accept-kind">Accept all ${KINDS.find(([k]) => k === st.kind)[1].toLowerCase()}</button><button class="btn" id="confirm" ${raw(pending ? 'disabled' : '')}>Confirm plan</button></span>` : ''}</div>
    ${isVersion ? html`<div class="stats stats-4">${diffCounts.map(([k, v]) => statCard({ value: v, label: `${DIFF[k][1]} since version ${imp.previous_version}`, trend: { dir: 'flat', tone: DIFF[k][0] === 'grey' ? 'grey' : DIFF[k][0], text: k === 'unchanged' ? 'already accepted' : 'to decide' } }))}</div>` : ''}
    <div class="lw-kinds">${KINDS.map(([k, label]) => { const all = items.filter((i) => i.kind === k); const p = all.filter((i) => i.decision === 'pending').length;
      return html`<button type="button" class="lw-kind ${st.kind === k ? 'on' : ''}" data-kind="${k}" ${raw(all.length ? '' : 'disabled')}><b>${n(k)}</b><span>${label}</span>${p ? html`<i>${p} to decide</i>` : isVersion && all.length && !all.some((i) => i.diff !== 'unchanged') ? html`<i class="ok">no changes</i>` : all.length ? html`<i class="ok">done</i>` : ''}</button>`; })}</div>
    ${isVersion ? segControl('pdiff', [['todo', 'To decide'], ['', 'All'], ['new', 'New'], ['changed', 'Changed'], ['removed', 'Removed'], ['unchanged', 'Unchanged']], st.diff) : ''}
    <div class="lw-pis">${shown.length ? grouped(shown) : emptyState('check', 'Nothing here.')}</div>`);

  $$('[data-kind]', el).forEach((b) => b.addEventListener('click', () => { st.kind = b.dataset.kind; review(ctx, el, id, refresh); }));
  $$('[data-seg-for="pdiff"] [data-seg]', el).forEach((b) => b.addEventListener('click', () => { st.diff = b.dataset.seg; review(ctx, el, id, refresh); }));
  bindSegments(el);
  const again = () => review(ctx, el, id, refresh);
  const decide = (item, decision, edits) => db.rpc('plan_item_decide', { p_item: item, p_decision: decision, p_edits: edits ?? null }).then(must);
  $$('[data-acc]', el).forEach((b) => b.addEventListener('click', () => act(b, async () => { const i = items.find((x) => x.id === b.dataset.acc); await decide(i.id, i.decision === 'accepted' ? 'pending' : 'accepted'); again(); })));
  $$('[data-rej]', el).forEach((b) => b.addEventListener('click', () => act(b, async () => { const i = items.find((x) => x.id === b.dataset.rej); await decide(i.id, i.decision === 'rejected' ? 'pending' : 'rejected'); again(); })));
  $('#accept-kind', el)?.addEventListener('click', (e) => act(e.target, async () => { const n2 = must(await db.rpc('plan_import_accept_all', { p_import: id, p_kind: st.kind })); toast(`${n2} accepted.`); again(); }));
  $('#confirm', el)?.addEventListener('click', (e) => act(e.target, async () => {
    const res = must(await db.rpc('plan_import_confirm', { p_import: id }));
    toast(`Version ${res.version} is live: ${res.added} added, ${res.changed} changed, ${res.retired} removed.`); refresh();
  }));
  $$('[data-edit]', el).forEach((b) => b.addEventListener('click', () => {
    const i = items.find((x) => x.id === b.dataset.edit);
    const d = { ...i.data, ...i.edits };
    const o = { ...(i.owner || {}), ...(i.edits?.owner || {}) };
    const ownerVal = o.profile_id ? `p:${o.profile_id}` : o.role ? `r:${o.role}` : '';
    const dr = openDrawer('Edit before accepting', html`<form class="form" id="pe-form">
      ${i.kind === 'checklist' ? html`<label class="f">Items, one per line<textarea name="items" rows="10">${(d.items || []).join('\n')}</textarea></label>` : ''}
      ${FIELDS[i.kind].map(([k, label, long]) => html`<label class="f">${label}${long ? html`<textarea name="${k}" rows="3">${d[k] ?? ''}</textarea>` : k === 'tracker'
        ? html`<select name="tracker"><option value="operations" ${raw(d.tracker === 'operations' ? 'selected' : '')}>Operations</option><option value="consortium" ${raw(d.tracker === 'consortium' ? 'selected' : '')}>Consortium</option></select>`
        : html`<input name="${k}" value="${d[k] ?? ''}" ${raw(['year', 'target'].includes(k) ? 'type="number" step="any"' : '')}>`}</label>`)}
      ${i.when && i.when.kind !== 'recurring' ? html`<label class="f">Date <span class="muted small">(read as ${i.when.label || 'no date'})</span><input type="date" name="due_date" value="${i.edits?.due_date || (i.when.kind === 'date' ? i.when.date : '')}"></label>` : ''}
      ${['task', 'delegation', 'agreement', 'meeting', 'checklist'].includes(i.kind) ? html`<label class="f">Owner in the portal${ownerSelect(ctx, 'owner_pick', ownerVal)}</label>` : ''}
      ${i.kind === 'agreement' ? html`<label class="check"><input type="checkbox" name="blocks" ${raw(d.blocks_first_session ? 'checked' : '')}> Must be signed before the first session</label>` : ''}
      <div class="btns"><button class="btn">Save and accept</button></div></form>`);
    $('#pe-form', dr).addEventListener('submit', (e) => {
      e.preventDefault();
      act(e.submitter, async () => {
        const f = formData(e.target);
        const edits = {};
        FIELDS[i.kind].forEach(([k]) => { let v = f[k]; if (['year', 'target'].includes(k)) v = v === '' ? null : Number(v); if (v !== undefined && JSON.stringify(v ?? '') !== JSON.stringify(i.data[k] ?? '')) edits[k] = v; });
        if (i.kind === 'checklist') { const its = f.items.split('\n').map((x) => x.trim()).filter(Boolean); if (JSON.stringify(its) !== JSON.stringify(i.data.items)) edits.items = its; }
        if (f.due_date && f.due_date !== (i.when?.date || '')) edits.due_date = f.due_date;
        if (f.owner_pick !== undefined && f.owner_pick !== ownerVal) edits.owner = f.owner_pick ? (f.owner_pick.startsWith('p:') ? { profile_id: f.owner_pick.slice(2), role: null } : { role: f.owner_pick.slice(2), profile_id: null }) : { profile_id: null, role: null };
        if (i.kind === 'agreement' && !!f.blocks !== !!i.data.blocks_first_session) edits.blocks_first_session = !!f.blocks;
        await decide(i.id, 'accepted', edits);
        dr.close(); again();
      });
    });
  }));
  void flag; void sectionGroup;
}
