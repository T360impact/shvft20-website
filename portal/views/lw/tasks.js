// A tracker's tasks: four headline cards, filters for hub, owner and status,
// then one collapsible section per area with a one-line summary.
import { html, raw, render, $, $$, db, must, today, statCard, sectionGroup, toneBar, emptyState, segControl, bindSegments, icon } from '../../lib.js';
import { lw, isWide, hubsOf, ownerText, taskRow, bindTasks, addTask } from './common.js';

export default async function trackerTasks(ctx, el, tracker, refresh) {
  const rows = must(await db.from('tasks').select('*').eq('consortium_id', ctx.consortium.id).eq('tracker', tracker).is('retired_at', null)
    .order('due_date', { ascending: true, nullsFirst: false }));
  const me = ctx.user.id;
  const myRoles = lw(ctx).roles;
  const state = { hub: '', owner: '', status: 'open' };
  const t0 = today();
  const in7 = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const open = (t) => !['done', 'not_done'].includes(t.status);

  const draw = () => {
    const shown = rows.filter((t) => (!state.hub || t.hub_id === state.hub)
      && (!state.owner || (state.owner === 'me' ? t.owner_profile_id === me || (!t.owner_profile_id && myRoles.includes(t.owner_role)) : ownerText(ctx, t) === state.owner))
      && (state.status === 'all' || (state.status === 'open' ? open(t) : !open(t))));
    const live = rows.filter(open);
    const groups = new Map();
    shown.forEach((t) => { const k = t.delegated ? `Delegated · ${t.owner_label || ownerText(ctx, t)}` : (t.area || 'General'); groups.set(k, [...(groups.get(k) || []), t]); });
    const owners = [...new Set(rows.map((t) => ownerText(ctx, t)))].sort();
    render($('#tt', el), html`
      <div class="stats stats-4">
        ${statCard({ icon: 'returns', value: live.length, label: 'Open', trend: { dir: 'flat', tone: 'grey', text: `${rows.length - live.length} closed` } })}
        ${statCard({ icon: 'due', value: live.filter((t) => t.due_date && t.due_date >= t0 && t.due_date <= in7).length, label: 'Due this week', trend: { dir: 'flat', tone: 'grey', text: 'next seven days' } })}
        ${statCard({ icon: 'overdue', value: live.filter((t) => t.due_date && t.due_date < t0).length, label: 'Overdue', trend: { dir: 'flat', tone: live.some((t) => t.due_date && t.due_date < t0) ? 'red' : 'green', text: 'past their date' } })}
        ${statCard({ icon: 'waiting', value: live.filter((t) => t.status === 'blocked').length, label: 'Blocked', trend: { dir: 'flat', tone: 'grey', text: 'waiting on something' } })}</div>
      <div class="filters lw-filters">
        ${isWide(ctx) && hubsOf(ctx).length ? html`<label class="f">Hub<select id="f-hub"><option value="">All hubs</option>${hubsOf(ctx).map((h) => html`<option value="${h.id}" ${raw(state.hub === h.id ? 'selected' : '')}>${h.name}</option>`)}</select></label>` : ''}
        <label class="f">Owner<select id="f-owner"><option value="">Everyone</option><option value="me" ${raw(state.owner === 'me' ? 'selected' : '')}>Mine</option>
          ${owners.map((o) => html`<option ${raw(state.owner === o ? 'selected' : '')}>${o}</option>`)}</select></label>
        <div>${segControl('st', [['open', 'Open'], ['closed', 'Done'], ['all', 'All']], state.status)}</div></div>
      ${shown.length ? [...groups].map(([area, ts], i) => sectionGroup({
        title: area,
        meta: `${ts.filter(open).length} open${ts.filter((t) => open(t) && t.due_date && t.due_date < t0).length ? ` · ${ts.filter((t) => open(t) && t.due_date && t.due_date < t0).length} overdue` : ''}`,
        aside: toneBar([['approved', ts.filter((t) => t.status === 'done').length, 'done'], ['submitted', ts.filter((t) => t.status === 'in_progress').length, 'in progress'],
          ['returned', ts.filter((t) => ['blocked', 'not_done'].includes(t.status)).length, 'blocked or not done'], ['requested', ts.filter((t) => t.status === 'not_started').length, 'not started']]),
        open: i === 0 && groups.size <= 4,
        body: html`<ul class="lw-list">${ts.map((t) => taskRow(ctx, t))}</ul>`,
      })) : emptyState('check', rows.length ? 'Nothing matches these filters.' : `No ${tracker} tasks yet. Add one, or import a plan.`)}
      <datalist id="lw-areas">${[...new Set(rows.map((t) => t.area).filter(Boolean))].map((a) => html`<option value="${a}">`)}</datalist>`);
    $('#f-hub', el)?.addEventListener('change', (e) => { state.hub = e.target.value; draw(); });
    $('#f-owner', el).addEventListener('change', (e) => { state.owner = e.target.value; draw(); });
    $$('[data-seg-for="st"] [data-seg]', el).forEach((b) => b.addEventListener('click', () => { state.status = b.dataset.seg; draw(); }));
    bindSegments($('#tt', el));
    bindTasks(el, ctx, refresh);
  };
  render(el, html`<div class="lw-toolbar"><button class="btn" id="add-task">${raw(icon('add', 16))}Add task</button></div><div id="tt"></div>`);
  $('#add-task', el).addEventListener('click', () => addTask(ctx, { tracker, hub_id: isWide(ctx) ? null : hubsOf(ctx)[0]?.id || null }, refresh));
  draw();
}
