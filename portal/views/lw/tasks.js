// A tracker's tasks: four headline cards, filters for hub, owner and status,
// then one collapsible section per area with a one-line summary. Work is
// allocated from the plan automatically where the owner is clear; anything
// left can be assigned one at a time (in the task) or several at once.
import { html, raw, render, $, $$, db, must, act, toast, today, statCard, sectionGroup, toneBar, emptyState, segControl, bindSegments, icon } from '../../lib.js';
import { lw, isWide, isSenior, hubsOf, ownerText, ownerSelect, ownerFields, taskRow, bindTasks, addTask } from './common.js';

// Filters and the selection survive a live refresh.
const ui = (ctx) => ctx.lwUi || (ctx.lwUi = {});

export default async function trackerTasks(ctx, el, tracker, refresh) {
  const rows = must(await db.from('tasks').select('*').eq('consortium_id', ctx.consortium.id).eq('tracker', tracker).is('retired_at', null)
    .order('due_date', { ascending: true, nullsFirst: false }));
  const me = ctx.user.id;
  const myRoles = lw(ctx).roles;
  const key = `_tt_${tracker}`;
  const state = ui(ctx)[key] || (ui(ctx)[key] = { hub: '', owner: '', status: 'open', picking: false, picked: new Set() });
  const t0 = today();
  const in7 = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const open = (t) => !['done', 'not_done'].includes(t.status);
  const unassigned = (t) => !t.owner_profile_id && !t.owner_role;

  const draw = () => {
    const shown = rows.filter((t) => (!state.hub || t.hub_id === state.hub)
      && (!state.owner || (state.owner === 'me' ? t.owner_profile_id === me || (!t.owner_profile_id && myRoles.includes(t.owner_role))
        : state.owner === 'none' ? unassigned(t) : ownerText(ctx, t) === state.owner))
      && (state.status === 'all' || (state.status === 'open' ? open(t) : !open(t))));
    const live = rows.filter(open);
    const loose = live.filter(unassigned);
    const groups = new Map();
    shown.forEach((t) => { const k = t.delegated ? `Delegated · ${t.owner_label || ownerText(ctx, t)}` : (t.area || 'General'); groups.set(k, [...(groups.get(k) || []), t]); });
    const owners = [...new Set(rows.filter((t) => !unassigned(t)).map((t) => ownerText(ctx, t)))].sort();
    const pickRow = (t) => html`<li><label class="lw-row lw-pick ${state.picked.has(t.id) ? 'on' : ''}"><input type="checkbox" data-pick="${t.id}" ${raw(state.picked.has(t.id) ? 'checked' : '')}>
      <span class="lw-row-main"><strong>${t.title}</strong><span class="muted small">${unassigned(t) ? 'Unassigned' : ownerText(ctx, t)}${t.owner_label && unassigned(t) ? ` · plan says “${t.owner_label}”` : ''}</span></span></label></li>`;
    render($('#tt', el), html`
      <div class="stats stats-4">
        ${statCard({ icon: 'returns', value: live.length, label: 'Open', trend: { dir: 'flat', tone: 'grey', text: `${rows.length - live.length} closed` } })}
        ${statCard({ icon: 'due', value: live.filter((t) => t.due_date && t.due_date >= t0 && t.due_date <= in7).length, label: 'Due this week', trend: { dir: 'flat', tone: 'grey', text: 'next seven days' } })}
        ${statCard({ icon: 'overdue', value: live.filter((t) => t.due_date && t.due_date < t0).length, label: 'Overdue', trend: { dir: 'flat', tone: live.some((t) => t.due_date && t.due_date < t0) ? 'red' : 'green', text: 'past their date' } })}
        ${statCard({ icon: 'people', value: loose.length, label: 'Unassigned', trend: { dir: 'flat', tone: loose.length ? 'amber' : 'green', text: loose.length ? 'need an owner' : 'everything has an owner' } })}</div>
      ${loose.length && !state.picking ? html`<div class="lead-banner"><span><strong>${loose.length} open task${loose.length === 1 ? ' has' : 's have'} no owner.</strong>
        ${isSenior(ctx) ? 'Allocate automatically matches them to the team from the plan\'s wording; assign the rest yourself.' : 'Assign them to someone on the team.'}</span>
        <span class="btns">${isSenior(ctx) ? html`<button class="btn secondary small" id="auto">Allocate automatically</button>` : ''}<button class="btn small" id="pick-loose">Assign them</button></span></div>` : ''}
      <div class="filters lw-filters">
        ${isWide(ctx) && hubsOf(ctx).length ? html`<label class="f">Hub<select id="f-hub"><option value="">All hubs</option>${hubsOf(ctx).map((h) => html`<option value="${h.id}" ${raw(state.hub === h.id ? 'selected' : '')}>${h.name}</option>`)}</select></label>` : ''}
        <label class="f">Owner<select id="f-owner"><option value="">Everyone</option><option value="me" ${raw(state.owner === 'me' ? 'selected' : '')}>Mine</option>
          <option value="none" ${raw(state.owner === 'none' ? 'selected' : '')}>Unassigned (${loose.length})</option>
          ${owners.map((o) => html`<option ${raw(state.owner === o ? 'selected' : '')}>${o}</option>`)}</select></label>
        <div>${segControl('st', [['open', 'Open'], ['closed', 'Done'], ['all', 'All']], state.status)}</div></div>
      ${shown.length ? [...groups].map(([area, ts], i) => sectionGroup({
        title: area,
        meta: `${ts.filter(open).length} open${ts.filter((t) => open(t) && t.due_date && t.due_date < t0).length ? ` · ${ts.filter((t) => open(t) && t.due_date && t.due_date < t0).length} overdue` : ''}${ts.filter((t) => open(t) && unassigned(t)).length ? ` · ${ts.filter((t) => open(t) && unassigned(t)).length} unassigned` : ''}`,
        aside: toneBar([['approved', ts.filter((t) => t.status === 'done').length, 'done'], ['submitted', ts.filter((t) => t.status === 'in_progress').length, 'in progress'],
          ['returned', ts.filter((t) => ['blocked', 'not_done'].includes(t.status)).length, 'blocked or not done'], ['requested', ts.filter((t) => t.status === 'not_started').length, 'not started']]),
        open: state.picking || (i === 0 && groups.size <= 4),
        body: html`<ul class="lw-list">${ts.map((t) => (state.picking ? pickRow(t) : taskRow(ctx, t)))}</ul>`,
      })) : emptyState('check', rows.length ? 'Nothing matches these filters.' : `No ${tracker} tasks yet. Add one, or import a plan.`)}
      ${state.picking ? html`<div class="lw-assignbar" role="region" aria-label="Assign selected tasks">
        <span><strong>${state.picked.size}</strong> selected · <button type="button" class="linkbtn small" id="pick-all">Select all shown</button></span>
        <label class="f">Assign to${ownerSelect(ctx, 'bulk-owner', '')}</label>
        <span class="btns"><button class="btn" id="bulk-go" ${raw(state.picked.size ? '' : 'disabled')}>Assign</button><button class="btn secondary" id="bulk-cancel">Done</button></span></div>` : ''}
      <datalist id="lw-areas">${[...new Set(rows.map((t) => t.area).filter(Boolean))].map((a) => html`<option value="${a}">`)}</datalist>`);
    $('#pick', el).textContent = state.picking ? 'Stop assigning' : 'Assign tasks';
    $('#f-hub', el)?.addEventListener('change', (e) => { state.hub = e.target.value; draw(); });
    $('#f-owner', el).addEventListener('change', (e) => { state.owner = e.target.value; draw(); });
    $$('[data-seg-for="st"] [data-seg]', el).forEach((b) => b.addEventListener('click', () => { state.status = b.dataset.seg; draw(); }));
    bindSegments($('#tt', el));
    bindTasks(el, ctx, refresh);
    $$('[data-pick]', el).forEach((c) => c.addEventListener('change', () => { if (c.checked) state.picked.add(c.dataset.pick); else state.picked.delete(c.dataset.pick); draw(); }));
    $('#pick-all', el)?.addEventListener('click', () => { shown.forEach((t) => state.picked.add(t.id)); draw(); });
    $('#pick-loose', el)?.addEventListener('click', () => { state.picking = true; state.owner = 'none'; state.status = 'open'; state.picked = new Set(); draw(); });
    $('#bulk-cancel', el)?.addEventListener('click', () => { state.picking = false; state.picked = new Set(); if (state.owner === 'none') state.owner = ''; draw(); });
    $('#bulk-go', el)?.addEventListener('click', (e) => act(e.target, async () => {
      const o = ownerFields($('[name="bulk-owner"]', el).value || '');
      if (!o.owner_profile_id && !o.owner_role) throw new Error('Choose who to assign them to.');
      const n = must(await db.rpc('lw_assign_tasks', { p_tasks: [...state.picked], p_owner_profile: o.owner_profile_id, p_owner_role: o.owner_role }));
      toast(`${n} task${n === 1 ? '' : 's'} assigned.`); state.picked = new Set(); refresh();
    }));
    $('#auto', el)?.addEventListener('click', (e) => act(e.target, async () => {
      const n = must(await db.rpc('lw_auto_allocate', { p_consortium: ctx.consortium.id }));
      toast(n ? `${n} task${n === 1 ? '' : 's'} allocated from the plan's wording.` : 'Nothing could be matched yet. Add the team under Team and hubs, or assign them yourself.');
      refresh();
    }));
  };
  render(el, html`<div class="lw-toolbar"><span class="btns"><button class="btn" id="add-task">${raw(icon('add', 16))}Add task</button>
    <button class="btn secondary" id="pick">${state.picking ? 'Assigning…' : 'Assign tasks'}</button></span></div><div id="tt"></div>`);
  $('#add-task', el).addEventListener('click', () => addTask(ctx, { tracker, hub_id: isWide(ctx) ? null : hubsOf(ctx)[0]?.id || null }, refresh));
  $('#pick', el).addEventListener('click', () => { state.picking = !state.picking; state.picked = new Set(); draw(); });
  draw();
}
