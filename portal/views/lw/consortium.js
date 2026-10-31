// The Consortium tracker's sections other than tasks: agreements as a board
// or table, assurance packs, governance (meetings, decision log, conflicts,
// escalation), partner performance against profile, funder outputs,
// referral pathways, money and milestones. Performance and money are for
// the lead and operations lead only.
import { html, raw, render, $, $$, db, must, act, toast, icon, pill, openDrawer, fmtDate, fmtMonth, fmtMoney, fmtNum, formData, today, emptyState, sectionGroup, segControl, bindSegments, headline } from '../../lib.js';
import { isSenior, isWide, ragTag, personName, base } from './common.js';

// Picked hub, date and view survive a live refresh.
const ui = (ctx) => ctx.lwUi || (ctx.lwUi = {});

const AG = [['not_started', 'Not started', 'grey'], ['drafting', 'Drafting', 'blue'], ['issued', 'Issued', 'blue'], ['in_review', 'In review', 'amber'], ['signed', 'Signed', 'green']];
const agLabel = (s) => (AG.find((a) => a[0] === s) || AG[0]);
const ITEMS = { safeguarding_policy: 'Safeguarding policy', dsl_name: 'Designated safeguarding lead', incident_route: 'Incident reporting route', dbs_register: 'DBS register confirmed', insurance: 'Insurance' };
const ITEM_TONE = { missing: 'red', requested: 'amber', received: 'blue', verified: 'green' };
const STEP = { conversation: 'Conversation and a reason', recovery_plan: 'Recovery plan with dates', variation: 'Variation' };
const MONEY = { mobilisation_payment: 'Mobilisation payments', quarterly_payment: 'Quarterly payments', claim: 'Claims to the funder', evidence_deadline: 'Evidence deadlines', unfunded_cost: 'Unfunded costs to resolve' };
const REF = { not_started: ['grey', 'Not started'], drafted: ['amber', 'Drafted'], confirmed: ['green', 'Confirmed'] };

export async function agreements(ctx, el) {
  const rows = must(await db.from('lw_agreements').select('*').eq('consortium_id', ctx.consortium.id).is('retired_at', null).order('position'));
  const view = ui(ctx)._ag || 'board';
  const again = () => agreements(ctx, el);
  const card = (a) => html`<button type="button" class="lw-card ${a.blocks_first_session && a.status !== 'signed' ? 'blocking' : ''}" data-ag="${a.id}"><strong>${a.name}</strong>
    <span class="muted small">${a.parties || ''}</span>
    <span class="lw-card-tags">${a.blocks_first_session && a.status !== 'signed' ? pill('red', 'Blocks first session', 'overdue') : ''}
      ${a.target_date ? html`<span class="small ${a.target_date < today() && a.status !== 'signed' ? 'warn-text' : 'muted'}">By ${fmtDate(a.target_date)}</span>` : a.target_text ? html`<span class="muted small">${a.target_text}</span>` : ''}</span></button>`;
  render(el, html`<div class="lw-toolbar">${segControl('agv', [['board', 'Board'], ['table', 'Table']], view)}
      ${isSenior(ctx) ? html`<button class="btn secondary small" id="add-ag">${raw(icon('add', 16))}Add agreement</button>` : ''}</div>
    ${!rows.length ? emptyState('governance', 'No agreements yet. Import a plan, or add them here.') : view === 'board'
      ? html`<div class="lw-board">${AG.map(([k, label]) => { const here = rows.filter((a) => a.status === k); return html`<section class="lw-col"><header><strong>${label}</strong><span class="muted small">${here.length}</span></header>${here.map(card)}</section>`; })}</div>`
      : html`<div class="table-wrap"><table class="lw-table"><thead><tr><th>Agreement</th><th>Parties</th><th>Drafts</th><th>Signs</th><th>Target</th><th>Status</th></tr></thead><tbody>
        ${rows.map((a) => html`<tr class="clickable" data-ag="${a.id}"><td><strong>${a.name}</strong>${a.blocks_first_session ? html`<br>${pill('red', 'Blocks first session')}` : ''}</td><td>${a.parties || ''}</td>
          <td>${a.drafter_text || ''}</td><td>${a.signer_text || ''}</td><td>${a.target_date ? fmtDate(a.target_date) : a.target_text || ''}</td><td>${pill(agLabel(a.status)[2], agLabel(a.status)[1])}</td></tr>`)}</tbody></table></div>`}`);
  $$('[data-seg-for="agv"] [data-seg]', el).forEach((b) => b.addEventListener('click', () => { ui(ctx)._ag = b.dataset.seg; again(); }));
  bindSegments(el);
  const form = (a = {}) => html`<form class="form" id="ag-form">
    <label class="f">Agreement<input name="name" required maxlength="200" value="${a.name || ''}"></label>
    <label class="f">Between<input name="parties" maxlength="1000" value="${a.parties || ''}"></label>
    <label class="f">What it must settle<textarea name="must_settle" rows="4" maxlength="4000">${a.must_settle || ''}</textarea></label>
    <div class="fields"><label class="f">Drafts<input name="drafter_text" maxlength="300" value="${a.drafter_text || ''}"></label><label class="f">Signs<input name="signer_text" maxlength="300" value="${a.signer_text || ''}"></label></div>
    <div class="fields"><label class="f">Target date<input type="date" name="target_date" value="${a.target_date || ''}"></label>
      <label class="f">Status<select name="status">${AG.map(([k, v]) => html`<option value="${k}" ${raw(a.status === k ? 'selected' : '')}>${v}</option>`)}</select></label></div>
    ${a.target_text ? html`<p class="small muted">Plan says: “${a.target_text}”</p>` : ''}
    <div class="fields"><label class="f">Signed on<input type="date" name="signed_on" value="${a.signed_on || ''}"></label><label class="f">Signed copy link<input type="url" name="signed_copy_link" placeholder="https://" value="${a.signed_copy_link || ''}"></label></div>
    <label class="check"><input type="checkbox" name="blocks" ${raw(a.blocks_first_session ? 'checked' : '')}> Must be signed before the first session</label>
    <label class="f">Notes<textarea name="notes" rows="2" maxlength="2000">${a.notes || ''}</textarea></label>
    ${isSenior(ctx) ? html`<div class="btns"><button class="btn">Save</button></div>` : ''}
    ${a.source_reference ? html`<p class="small muted">From the plan: ${a.source_reference}</p>` : ''}</form>`;
  const read = (f) => ({ name: f.name, parties: f.parties || null, must_settle: f.must_settle || null, drafter_text: f.drafter_text || null, signer_text: f.signer_text || null,
    target_date: f.target_date || null, status: f.status, signed_on: f.signed_on || (f.status === 'signed' ? today() : null), signed_copy_link: f.signed_copy_link || null,
    blocks_first_session: !!f.blocks, notes: f.notes || null });
  const save = (d, id) => $('#ag-form', d).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => {
    if (id) must(await db.from('lw_agreements').update(read(formData(e.target))).eq('id', id));
    else must(await db.from('lw_agreements').insert({ consortium_id: ctx.consortium.id, ...read(formData(e.target)) }));
    d.close(); again(); }); });
  $('#add-ag', el)?.addEventListener('click', () => save(openDrawer('Add an agreement', form()), null));
  $$('[data-ag]', el).forEach((b) => b.addEventListener('click', () => { const a = rows.find((x) => x.id === b.dataset.ag); save(openDrawer(a.name, form(a)), a.id); }));
}

export async function assurance(ctx, el) {
  const rows = must(await db.rpc('lw_assurance', { p_consortium: ctx.consortium.id }));
  const again = () => assurance(ctx, el);
  render(el, rows.length ? html`<p class="small muted">Evidence each partner holds, not contracts. Insurance and safeguarding policies already in a partner's document library show here by themselves.</p>
    <div class="table-wrap"><table class="lw-table lw-assure"><thead><tr><th>Partner</th>${Object.values(ITEMS).map((v) => html`<th>${v}</th>`)}<th>Complete</th></tr></thead><tbody>
    ${rows.map((o) => html`<tr><th scope="row">${o.name}</th>${o.items.map((i) => html`<td><button type="button" class="lw-cellbtn" data-org="${o.organisation_id}" data-item="${i.item}" ${raw(isSenior(ctx) ? '' : 'disabled')}>
      ${pill(ITEM_TONE[i.status], i.status[0].toUpperCase() + i.status.slice(1))}${i.from_library ? html`<span class="muted small">from library</span>` : ''}${i.detail ? html`<span class="small">${i.detail}</span>` : ''}</button></td>`)}
      <td>${o.items.filter((i) => ['received', 'verified'].includes(i.status)).length} of 5</td></tr>`)}</tbody></table></div>` : emptyState('partners', 'No partners in this workspace yet.'));
  $$('[data-org]', el).forEach((b) => b.addEventListener('click', () => {
    const o = rows.find((x) => x.organisation_id === b.dataset.org); const i = o.items.find((x) => x.item === b.dataset.item);
    const d = openDrawer(`${o.name} · ${ITEMS[i.item]}`, html`<form class="form" id="as-form">
      <label class="f">Status<select name="status">${Object.keys(ITEM_TONE).map((k) => html`<option value="${k}" ${raw(i.status === k ? 'selected' : '')}>${k[0].toUpperCase() + k.slice(1)}</option>`)}</select></label>
      <label class="f">${i.item === 'dsl_name' ? 'Name of the designated safeguarding lead' : 'Detail'} <span class="muted small">(no contact details)</span><input name="detail" maxlength="500" value="${i.detail || ''}"></label>
      <div class="btns"><button class="btn">Save</button></div></form>`);
    $('#as-form', d).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => {
      const f = formData(e.target);
      must(await db.from('assurance_items').upsert({ consortium_id: ctx.consortium.id, organisation_id: o.organisation_id, item: i.item, status: f.status, detail: f.detail || null, checked_on: today() }, { onConflict: 'organisation_id,item' }));
      d.close(); again(); }); });
  }));
}

export async function governance(ctx, el) {
  const c = ctx.consortium.id;
  const view = ui(ctx)._gv || 'meetings';
  const [meetings, occ, log, conflicts, settings] = await Promise.all([
    db.from('lw_meetings').select('*').eq('consortium_id', c).is('retired_at', null).order('position').then(must),
    db.from('meeting_occurrences').select('*').eq('consortium_id', c).order('held_on', { ascending: false }).then(must),
    db.from('decision_log').select('*').eq('consortium_id', c).order('decided_on', { ascending: false }).then(must),
    db.from('conflicts_register').select('*').eq('consortium_id', c).order('declared_on', { ascending: false }).then(must),
    db.from('lw_settings').select('escalation_route').eq('consortium_id', c).maybeSingle().then(must),
  ]);
  const again = () => governance(ctx, el);
  const route = settings?.escalation_route || [];
  const meetingsView = () => (meetings.length ? meetings.map((m, i) => { const o = occ.filter((x) => x.meeting_id === m.id); return sectionGroup({ title: m.name,
    meta: [m.frequency_text, m.chair_text ? `chair ${m.chair_text}` : ''].filter(Boolean).join(' · '), open: i === 0,
    aside: m.kind === 'weekly_operations' ? html`<a class="btn secondary small" href="${base(ctx)}/meetings/weekly">Open</a>` : m.kind === 'monthly_consortium' ? html`<a class="btn secondary small" href="${base(ctx)}/meetings/monthly">Open</a>` : '',
    body: html`${m.purpose ? html`<p class="small">${m.purpose}</p>` : ''}${m.attendees ? html`<p class="small muted">Who: ${m.attendees}</p>` : ''}
      ${o.length ? html`<ul class="lw-list">${o.slice(0, 6).map((x) => html`<li class="lw-row static"><span class="lw-row-main"><strong>${fmtDate(x.held_on)}</strong>
        <span class="muted small">${x.status}${x.minutes ? ' · minutes written' : ''}</span></span><span class="lw-row-tags">${x.papers_link ? html`<a href="${x.papers_link}" target="_blank" rel="noopener">Papers</a>` : ''}
        ${x.minutes_link ? html`<a href="${x.minutes_link}" target="_blank" rel="noopener">Minutes</a>` : ''}<button type="button" class="btn secondary small" data-occ="${x.id}">Edit</button></span></li>`)}</ul>` : ''}
      <button type="button" class="btn secondary small" data-newocc="${m.id}">Record a meeting</button>` }); }) : emptyState('governance', 'No meetings yet. They come from the plan.'));
  const logView = () => html`${isSenior(ctx) ? html`<div class="lw-toolbar"><button class="btn secondary small" id="add-dec">${raw(icon('add', 16))}Log a decision</button></div>` : ''}
    ${log.length ? html`<div class="table-wrap"><table class="lw-table"><thead><tr><th>Date</th><th>Decision</th><th>Who decided</th><th>Meeting</th></tr></thead><tbody>
      ${log.map((d) => html`<tr><td class="nowrap">${fmtDate(d.decided_on)}</td><td>${d.decision}</td><td>${d.decided_by_text || personName(ctx, d.decided_by_profile) || ''}</td>
        <td>${d.occurrence_id ? (() => { const o = occ.find((x) => x.id === d.occurrence_id); const m = o && meetings.find((y) => y.id === o.meeting_id); return m ? `${m.name}, ${fmtDate(o.held_on)}` : ''; })() : ''}</td></tr>`)}</tbody></table></div>` : emptyState('governance', 'No decisions logged yet.')}`;
  const conflictView = () => html`${isSenior(ctx) ? html`<div class="lw-toolbar"><button class="btn secondary small" id="add-coi">${raw(icon('add', 16))}Record an interest</button></div>` : ''}
    ${conflicts.length ? html`<div class="table-wrap"><table class="lw-table"><thead><tr><th>Person</th><th>Interest</th><th>Declared</th><th>How it is managed</th></tr></thead><tbody>
      ${conflicts.map((x) => html`<tr><td>${x.person_name}</td><td>${x.interest}</td><td class="nowrap">${fmtDate(x.declared_on)}</td><td>${x.how_managed || ''}</td></tr>`)}</tbody></table></div>` : emptyState('governance', 'No interests declared yet.')}`;
  const escalationView = () => html`<ol class="lw-steps">${route.map((s, i) => html`<li><span class="lw-step-n">${i + 1}</span>${s}</li>`)}</ol>
    ${!route.length ? emptyState('governance', 'No escalation route set.') : ''}
    ${isSenior(ctx) ? html`<form class="form" id="esc-form"><label class="f">Escalation route, one step per line<textarea name="route" rows="5">${route.join('\n')}</textarea></label><div class="btns"><button class="btn secondary">Save route</button></div></form>` : ''}`;
  render(el, html`<div class="lw-toolbar"><span class="btns"><a class="btn secondary small" href="${base(ctx)}/meetings/weekly">Weekly operations meeting view</a>
      ${isWide(ctx) ? html`<a class="btn secondary small" href="${base(ctx)}/meetings/monthly">Monthly consortium meeting view</a>` : ''}</span></div>
    ${segControl('gv', [['meetings', 'Meetings'], ['log', 'Decision log'], ['conflicts', 'Conflicts of interest'], ['escalation', 'Escalation route']], view)}
    ${view === 'meetings' ? meetingsView() : view === 'log' ? logView() : view === 'conflicts' ? conflictView() : escalationView()}`);
  $$('[data-seg-for="gv"] [data-seg]', el).forEach((b) => b.addEventListener('click', () => { ui(ctx)._gv = b.dataset.seg; again(); }));
  bindSegments(el);

  const occForm = (o) => html`<form class="form" id="oc-form"><label class="f">Date<input type="date" name="held_on" required value="${o.held_on || today()}"></label>
    <label class="f">Status<select name="status">${['planned', 'held', 'cancelled'].map((k) => html`<option ${raw(o.status === k ? 'selected' : '')}>${k}</option>`)}</select></label>
    <label class="f">Papers link<input type="url" name="papers_link" placeholder="https://" value="${o.papers_link || ''}"></label>
    <label class="f">Minutes link<input type="url" name="minutes_link" placeholder="https://" value="${o.minutes_link || ''}"></label>
    <label class="f">Minutes <span class="muted small">(no young people's details)</span><textarea name="minutes" rows="5" maxlength="8000">${o.minutes || ''}</textarea></label>
    <div class="btns"><button class="btn">Save</button></div></form>`;
  const readOcc = (f) => ({ held_on: f.held_on, status: f.status, papers_link: f.papers_link || null, minutes_link: f.minutes_link || null, minutes: f.minutes || null });
  $$('[data-newocc]', el).forEach((b) => b.addEventListener('click', () => { const d = openDrawer('Record a meeting', occForm({}));
    $('#oc-form', d).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => {
      must(await db.from('meeting_occurrences').insert({ consortium_id: c, meeting_id: b.dataset.newocc, ...readOcc(formData(e.target)) })); d.close(); again(); }); }); }));
  $$('[data-occ]', el).forEach((b) => b.addEventListener('click', () => { const o = occ.find((x) => x.id === b.dataset.occ); const d = openDrawer('Meeting record', occForm(o));
    $('#oc-form', d).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => { must(await db.from('meeting_occurrences').update(readOcc(formData(e.target))).eq('id', o.id)); d.close(); again(); }); }); }));
  $('#add-dec', el)?.addEventListener('click', () => { const d = openDrawer('Log a decision', html`<form class="form" id="dl-form">
    <label class="f">Decision<textarea name="decision" required rows="3" maxlength="2000"></textarea></label>
    <div class="fields"><label class="f">Date<input type="date" name="decided_on" value="${today()}"></label><label class="f">Who decided<input name="by" maxlength="300"></label></div>
    <label class="f">Meeting<select name="occ"><option value="">Not at a meeting</option>${occ.slice(0, 20).map((o) => html`<option value="${o.id}">${meetings.find((m) => m.id === o.meeting_id)?.name}, ${fmtDate(o.held_on)}</option>`)}</select></label>
    <label class="f">Who can see it<select name="vis"><option value="team">The lead team</option><option value="lead_only">Lead and operations lead only</option></select></label>
    <div class="btns"><button class="btn">Log it</button></div></form>`);
    $('#dl-form', d).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => { const f = formData(e.target);
      must(await db.from('decision_log').insert({ consortium_id: c, decision: f.decision, decided_on: f.decided_on, decided_by_text: f.by || null, occurrence_id: f.occ || null, visibility: f.vis })); d.close(); again(); }); }); });
  $('#add-coi', el)?.addEventListener('click', () => { const d = openDrawer('Record an interest', html`<form class="form" id="ci-form">
    <label class="f">Person<input name="person" required maxlength="120"></label><label class="f">Interest<textarea name="interest" required rows="2" maxlength="1000"></textarea></label>
    <label class="f">Declared on<input type="date" name="on" value="${today()}"></label><label class="f">How it is managed<textarea name="how" rows="2" maxlength="1000"></textarea></label>
    <div class="btns"><button class="btn">Save</button></div></form>`);
    $('#ci-form', d).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => { const f = formData(e.target);
      must(await db.from('conflicts_register').insert({ consortium_id: c, person_name: f.person, interest: f.interest, declared_on: f.on, how_managed: f.how || null })); d.close(); again(); }); }); });
  $('#esc-form', el)?.addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => {
    const steps = formData(e.target).route.split('\n').map((x) => x.trim()).filter(Boolean);
    must(await db.from('lw_settings').upsert({ consortium_id: c, escalation_route: steps }, { onConflict: 'consortium_id' })); toast('Saved.'); again(); }); });
}

// Partner performance: each partner's targets this year against its monthly
// profile, the return, and the underperformance ladder. Lead only.
export async function partners(ctx, el) {
  const c = ctx.consortium.id;
  if (!isSenior(ctx)) { render(el, emptyState('safeguarding', 'Partner performance is for the lead and operations lead.')); return; }
  const rows = must(await db.rpc('lw_partner_performance', { p_consortium: c }));
  const again = () => partners(ctx, el);
  render(el, html`<p class="small muted">Lead and operations lead only. Green at or above 80% of profile to date, amber below, red below half (change these under Team and hubs).</p>
    ${rows.length ? rows.map((p, i) => { const worst = ['red', 'amber', 'green', 'grey'].find((r) => p.targets.some((t) => t.rag === r)) || 'grey'; return sectionGroup({ title: p.name,
      meta: `${p.targets.length} targets · return due ${fmtDate(p.return_due)} ${p.return_received ? '· last month received' : '· last month not in'}`, aside: ragTag(worst), open: i === 0 || worst === 'red',
      body: html`${p.targets.length ? html`<div class="table-wrap"><table class="lw-table"><thead><tr><th>Target</th><th class="num">Year</th><th class="num">Profile to date</th><th class="num">Achieved</th><th>Against profile</th><th></th></tr></thead><tbody>
        ${p.targets.map((t) => html`<tr><td>${headline(t.label)}</td><td class="num">${fmtNum(t.target)}</td><td class="num">${fmtNum(t.planned)}${t.profiled ? '' : html`<span class="muted small"> even</span>`}</td>
          <td class="num">${fmtNum(t.achieved)}</td><td>${ragTag(t.rag)}${t.ratio != null ? html` <span class="muted small">${Math.round(t.ratio * 100)}%</span>` : ''}</td>
          <td><button type="button" class="btn secondary small" data-prof="${t.commitment_id}">Profile</button></td></tr>`)}</tbody></table></div>` : html`<p class="muted small">No targets for this year.</p>`}
        <h3 class="small-head">Underperformance</h3>
        <ol class="lw-steps">${['conversation', 'recovery_plan', 'variation'].map((k, n) => { const s = p.steps.filter((x) => x.step === k).pop(); return html`<li class="${s ? 'done' : ''}"><span class="lw-step-n">${n + 1}</span>
          <span><strong>${STEP[k]}</strong>${s ? html`<span class="muted small"> · ${fmtDate(s.step_date)} · ${s.status}</span><br><span class="small">${s.notes || ''}</span>` : ''}</span></li>`; })}</ol>
        <button type="button" class="btn secondary small" data-step="${p.organisation_id}">Record a step</button>` }); }) : emptyState('partners', 'No partners with targets yet.')}`);
  $$('[data-step]', el).forEach((b) => b.addEventListener('click', () => {
    const d = openDrawer('Record a step', html`<form class="form" id="ps-form"><label class="f">Step<select name="step">${Object.entries(STEP).map(([k, v]) => html`<option value="${k}">${v}</option>`)}</select></label>
      <label class="f">Date<input type="date" name="on" value="${today()}"></label><label class="f">Notes<textarea name="notes" rows="3" maxlength="2000"></textarea></label>
      <label class="f">Status<select name="status"><option value="open">Open</option><option value="closed">Closed</option></select></label><div class="btns"><button class="btn">Save</button></div></form>`);
    $('#ps-form', d).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => { const f = formData(e.target);
      must(await db.from('perf_steps').insert({ consortium_id: c, organisation_id: b.dataset.step, step: f.step, step_date: f.on, notes: f.notes || null, status: f.status })); d.close(); again(); }); });
  }));
  $$('[data-prof]', el).forEach((b) => b.addEventListener('click', () => {
    const t = rows.flatMap((p) => p.targets).find((x) => x.commitment_id === b.dataset.prof);
    const start = new Date(`${ctx.consortium.start_date || today()}T12:00:00`); start.setFullYear(start.getFullYear() + (t.year || 1) - 1);
    const months = Array.from({ length: 12 }, (_, i) => { const x = new Date(start); x.setDate(1); x.setMonth(start.getMonth() + i); return x.toISOString().slice(0, 7); });
    const d = openDrawer(`Monthly profile · ${headline(t.label)}`, html`<form class="form" id="pf-form"><p class="small muted">Year target ${fmtNum(t.target)}. Leave blank for an even split.</p>
      <div class="lw-profile">${months.map((m) => html`<label class="f">${fmtMonth(`${m}-01`)}<input type="number" min="0" step="any" name="${m}" value="${t.profile[m] ?? ''}"></label>`)}</div>
      <p class="small" id="pf-sum"></p><div class="btns"><button class="btn">Save profile</button></div></form>`);
    const sum = () => { const s = $$('#pf-form input', d).reduce((a, x) => a + (Number(x.value) || 0), 0); $('#pf-sum', d).textContent = `Profiled ${fmtNum(s)} of ${fmtNum(t.target)}.`; };
    $('#pf-form', d).addEventListener('input', sum); sum();
    $('#pf-form', d).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => {
      const vals = $$('#pf-form input', d).filter((x) => x.value !== '').map((x) => ({ consortium_id: c, commitment_id: t.commitment_id, month: `${x.name}-01`, planned: Number(x.value) }));
      must(await db.from('output_profiles').delete().eq('commitment_id', t.commitment_id));
      if (vals.length) must(await db.from('output_profiles').insert(vals));
      d.close(); again(); }); });
  }));
}

export async function outputs(ctx, el) {
  const c = ctx.consortium.id;
  const [rows, cms] = await Promise.all([
    db.rpc('lw_outputs_status', { p_consortium: c }).then(must),
    isSenior(ctx) ? db.from('commitments').select('id, label, organisation_id, year, measure').eq('consortium_id', c).is('retired_at', null).is('superseded_by', null).then(must) : Promise.resolve([]),
  ]);
  const again = () => outputs(ctx, el);
  const years = [...new Set(rows.map((o) => o.year))].sort();
  const yr = ui(ctx)._oy || years[0] || 1;
  render(el, rows.length ? html`<div class="lw-toolbar">${years.length > 1 ? segControl('oy', years.map((y) => [y, `Year ${y}`]), yr) : html`<span></span>`}
      <span class="muted small">Achieved comes from the portal's targets each output is linked to, or a figure entered by hand. T360 isn't connected yet.</span></div>
    <div class="lw-cards">${rows.filter((o) => o.year === Number(yr)).map((o) => html`<button type="button" class="lw-card lw-output" data-out="${o.id}"><strong>${o.name}</strong>
      <span class="lw-out-figs"><b>${fmtNum(o.achieved ?? 0)}</b><span class="muted small">of ${fmtNum(o.target)} · ${fmtNum(o.planned)} expected by now</span></span>
      <span class="bar-track"><span class="bar-fill" style="width:${Math.min(100, o.target ? ((o.achieved || 0) / o.target) * 100 : 0)}%"></span></span>
      <span class="lw-card-tags">${o.achieved == null ? pill('grey', 'Not linked yet') : ragTag(o.rag)}<span class="muted small">${o.recorded_by || ''}</span></span></button>`)}</div>`
    : emptyState('outcomes', 'No funder outputs yet. Import a plan to bring them in.'));
  $$('[data-seg-for="oy"] [data-seg]', el).forEach((b) => b.addEventListener('click', () => { ui(ctx)._oy = Number(b.dataset.seg); again(); }));
  bindSegments(el);
  $$('[data-out]', el).forEach((b) => b.addEventListener('click', () => {
    const o = rows.find((x) => x.id === b.dataset.out);
    const d = openDrawer(o.name, html`<dl class="kv"><dt>Year ${o.year} target</dt><dd>${fmtNum(o.target)}</dd><dt>Recorded by</dt><dd>${o.recorded_by || '–'}</dd><dt>Source</dt><dd>${o.source || '–'}</dd>
      <dt>Expected by now</dt><dd>${fmtNum(o.planned)}</dd><dt>Achieved</dt><dd>${o.achieved == null ? 'Not linked yet' : fmtNum(o.achieved)}</dd></dl>
      ${isSenior(ctx) ? html`<form class="form" id="out-form">
        <label class="f">Achieved from<select name="src"><option value="portal" ${raw(o.achieved_source === 'portal' ? 'selected' : '')}>The portal's targets</option><option value="manual" ${raw(o.achieved_source === 'manual' ? 'selected' : '')}>A figure I enter</option></select></label>
        <fieldset><legend>Linked portal targets</legend><div class="checks lw-scroll">${cms.filter((k) => k.year === o.year || k.year == null).map((k) => html`<label class="check"><input type="checkbox" name="cm" value="${k.id}" ${raw(o.commitment_ids.includes(k.id) ? 'checked' : '')}> ${headline(k.label)} <span class="muted small">${ctx.org(k.organisation_id)?.name || ''}</span></label>`)}</div></fieldset>
        <label class="f">Achieved figure <span class="muted small">(when entered by hand)</span><input type="number" min="0" step="any" name="manual" value="${o.manual_achieved ?? ''}"></label>
        <label class="f">Owner<input name="owner" maxlength="300" value="${o.owner_text || ''}"></label>
        <div class="btns"><button class="btn">Save</button></div></form>` : ''}`);
    $('#out-form', d)?.addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => { const f = formData(e.target);
      must(await db.from('lw_outputs').update({ achieved_source: f.src, commitment_ids: $$('[name=cm]:checked', e.target).map((x) => x.value), manual_achieved: f.manual === '' ? null : Number(f.manual), owner_text: f.owner || null }).eq('id', o.id));
      d.close(); again(); }); });
  }));
}

export async function referrals(ctx, el) {
  const rows = must(await db.from('referral_pathways').select('*').eq('consortium_id', ctx.consortium.id).order('service'));
  const again = () => referrals(ctx, el);
  render(el, html`${isSenior(ctx) ? html`<div class="lw-toolbar"><button class="btn secondary small" id="add-ref">${raw(icon('add', 16))}Add a pathway</button></div>` : ''}
    ${rows.length ? html`<div class="lw-cards">${rows.map((r) => html`<button type="button" class="lw-card" data-ref="${r.id}"><strong>${r.service}</strong>
      <span class="lw-card-tags">${pill(REF[r.status][0], REF[r.status][1])}${r.confirmed_on ? html`<span class="muted small">Confirmed ${fmtDate(r.confirmed_on)}</span>` : ''}</span>
      ${r.contacts ? html`<span class="muted small">${r.contacts}</span>` : ''}</button>`)}</div>` : emptyState('partners', 'No referral pathways yet.')}`);
  const form = (r = {}) => html`<form class="form" id="rf-form"><label class="f">Service<input name="service" required maxlength="200" value="${r.service || ''}"></label>
    <div class="fields"><label class="f">Status<select name="status">${Object.entries(REF).map(([k, v]) => html`<option value="${k}" ${raw(r.status === k ? 'selected' : '')}>${v[1]}</option>`)}</select></label>
      <label class="f">Confirmed on<input type="date" name="on" value="${r.confirmed_on || ''}"></label></div>
    <label class="f">Named contacts <span class="muted small">(names and roles; no emails or phone numbers)</span><textarea name="contacts" rows="2" maxlength="1000">${r.contacts || ''}</textarea></label>
    <label class="f">Notes<textarea name="notes" rows="2" maxlength="1000">${r.notes || ''}</textarea></label>${isSenior(ctx) ? html`<div class="btns"><button class="btn">Save</button></div>` : ''}</form>`;
  const read = (f) => ({ service: f.service, status: f.status, confirmed_on: f.on || (f.status === 'confirmed' ? today() : null), contacts: f.contacts || null, notes: f.notes || null });
  const bind = (d, id) => $('#rf-form', d).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => {
    if (id) must(await db.from('referral_pathways').update(read(formData(e.target))).eq('id', id)); else must(await db.from('referral_pathways').insert({ consortium_id: ctx.consortium.id, ...read(formData(e.target)) }));
    d.close(); again(); }); });
  $('#add-ref', el)?.addEventListener('click', () => bind(openDrawer('Add a pathway', form()), null));
  $$('[data-ref]', el).forEach((b) => b.addEventListener('click', () => { const r = rows.find((x) => x.id === b.dataset.ref); bind(openDrawer(r.service, form(r)), r.id); }));
}

export async function money(ctx, el) {
  if (!isSenior(ctx)) { render(el, emptyState('finance', 'Money is for the lead and operations lead.')); return; }
  const rows = must(await db.from('money_items').select('*').eq('consortium_id', ctx.consortium.id).order('due_date', { nullsFirst: false }));
  const again = () => money(ctx, el);
  render(el, html`<div class="lw-toolbar"><span class="small muted">Lead and operations lead only.</span><button class="btn secondary small" id="add-m">${raw(icon('add', 16))}Add</button></div>
    ${Object.entries(MONEY).map(([k, label], i) => { const rs = rows.filter((r) => r.kind === k); return sectionGroup({ title: label,
      meta: rs.length ? `${rs.length} · ${fmtMoney(rs.reduce((a, r) => a + (Number(r.amount) || 0), 0))}` : 'None yet', open: i === 0 || (k === 'unfunded_cost' && rs.some((r) => r.status !== 'resolved')),
      body: rs.length ? html`<ul class="lw-list">${rs.map((r) => html`<li><button type="button" class="lw-row" data-m="${r.id}"><span class="lw-row-main"><strong>${r.title}</strong>
        <span class="muted small">${r.organisation_id ? `${ctx.org(r.organisation_id)?.name || ''} · ` : ''}${r.amount != null ? fmtMoney(r.amount) : ''}${r.options ? ' · options noted' : ''}</span></span>
        <span class="lw-row-tags">${r.due_date ? html`<span class="small ${r.due_date < today() && !['paid', 'submitted', 'resolved'].includes(r.status) ? 'warn-text' : 'muted'}">${fmtDate(r.due_date)}</span>` : ''}${pill(['paid', 'submitted', 'resolved'].includes(r.status) ? 'green' : r.status === 'due' ? 'amber' : 'grey', r.status)}</span></button></li>`)}</ul>` : html`<p class="muted small">Nothing here yet.</p>` }); })}`);
  const form = (r = {}) => html`<form class="form" id="mn-form"><label class="f">Kind<select name="kind">${Object.entries(MONEY).map(([k, v]) => html`<option value="${k}" ${raw(r.kind === k ? 'selected' : '')}>${v}</option>`)}</select></label>
    <label class="f">What<input name="title" required maxlength="200" value="${r.title || ''}"></label>
    <div class="fields"><label class="f">Partner<select name="org"><option value="">None</option>${ctx.orgs.map((o) => html`<option value="${o.id}" ${raw(r.organisation_id === o.id ? 'selected' : '')}>${o.name}</option>`)}</select></label>
      <label class="f">Amount (£)<input type="number" step="any" name="amount" value="${r.amount ?? ''}"></label></div>
    <div class="fields"><label class="f">Due<input type="date" name="due" value="${r.due_date || ''}"></label>
      <label class="f">Status<select name="status">${['planned', 'due', 'paid', 'submitted', 'resolved'].map((k) => html`<option ${raw(r.status === k ? 'selected' : '')}>${k}</option>`)}</select></label></div>
    <label class="f">Options <span class="muted small">(for unfunded costs: where it could sit)</span><textarea name="options" rows="3" maxlength="2000">${r.options || ''}</textarea></label>
    <div class="btns"><button class="btn">Save</button></div></form>`;
  const read = (f) => ({ kind: f.kind, title: f.title, organisation_id: f.org || null, amount: f.amount === '' ? null : Number(f.amount), due_date: f.due || null, status: f.status, options: f.options || null });
  const bind = (d, id) => $('#mn-form', d).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => {
    if (id) must(await db.from('money_items').update(read(formData(e.target))).eq('id', id)); else must(await db.from('money_items').insert({ consortium_id: ctx.consortium.id, ...read(formData(e.target)) }));
    d.close(); again(); }); });
  $('#add-m', el).addEventListener('click', () => bind(openDrawer('Add a money item', form()), null));
  $$('[data-m]', el).forEach((b) => b.addEventListener('click', () => { const r = rows.find((x) => x.id === b.dataset.m); bind(openDrawer(r.title, form(r)), r.id); }));
}

export async function milestones(ctx, el) {
  const rows = must(await db.from('lw_milestones').select('*').eq('consortium_id', ctx.consortium.id).is('retired_at', null).order('due_date', { nullsFirst: false }));
  const again = () => milestones(ctx, el);
  const MS = { upcoming: ['blue', 'Upcoming'], met: ['green', 'Met'], missed: ['red', 'Missed'], moved: ['amber', 'Moved'] };
  render(el, rows.length ? html`<ol class="lw-timeline-v">${rows.map((m) => html`<li class="${m.status} ${m.status === 'upcoming' && m.due_date && m.due_date < today() ? 'late' : ''}">
    <span class="lw-tv-when">${m.due_date ? (m.precision === 'month' ? fmtMonth(m.due_date) : fmtDate(m.due_date)) : m.when_text}<span class="muted small">${m.when_text && m.due_date ? m.when_text : ''}</span></span>
    <button type="button" class="lw-tv-body" data-ms="${m.id}"><strong>${m.what}</strong>${m.evidence ? html`<span class="muted small">Evidence: ${m.evidence}</span>` : ''}
      <span class="lw-card-tags">${pill(MS[m.status][0], MS[m.status][1])}${m.evidence_link ? html`<span class="small">Evidence linked</span>` : ''}</span></button></li>`)}</ol>`
    : emptyState('dashboard', 'No milestones yet. Import a plan to bring in its timeline.'));
  $$('[data-ms]', el).forEach((b) => b.addEventListener('click', () => {
    if (!isSenior(ctx)) return;
    const m = rows.find((x) => x.id === b.dataset.ms);
    const d = openDrawer('Milestone', html`<form class="form" id="ms-form"><p>${m.what}</p>
      <div class="fields"><label class="f">Date<input type="date" name="due" value="${m.due_date || ''}"></label>
        <label class="f">Status<select name="status">${Object.entries(MS).map(([k, v]) => html`<option value="${k}" ${raw(m.status === k ? 'selected' : '')}>${v[1]}</option>`)}</select></label></div>
      <label class="f">Evidence link<input type="url" name="link" placeholder="https://" value="${m.evidence_link || ''}"></label><div class="btns"><button class="btn">Save</button></div></form>`);
    $('#ms-form', d).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => { const f = formData(e.target);
      must(await db.from('lw_milestones').update({ due_date: f.due || null, status: f.status, evidence_link: f.link || null }).eq('id', m.id)); d.close(); again(); }); });
  }));
}
