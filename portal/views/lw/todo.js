// To do: the place for ad hoc work. Type it, press Enter, it's on the list
// (yours unless you say otherwise). Grouped by when it's due, with a big box
// to tick it off; open any item for the full task (notes, history,
// assigning). To-dos are tasks in their own list, so they also count on
// This week and on the owner's list.
import { html, raw, render, $, $$, db, must, act, toast, icon, pill, today, emptyState, sectionGroup, segControl, bindSegments, formData, fmtDate } from '../../lib.js';
import { isWide, isSenior, ownerText, ownerSelect, ownerFields, bindTasks, hubName } from './common.js';

const ui = (ctx) => ctx.lwUi || (ctx.lwUi = {});
const addDays = (d, n) => { const x = new Date(`${d}T12:00:00`); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };

export default async function todo(ctx, el, refresh) {
  const c = ctx.consortium.id;
  const me = ctx.user.id;
  const st = ui(ctx)._todo || (ui(ctx)._todo = { who: 'mine' });
  const rows = must(await db.from('tasks').select('*').eq('consortium_id', c).eq('tracker', 'todo').is('retired_at', null).order('due_date', { ascending: true, nullsFirst: false }));
  const t0 = today();
  const weekEnd = addDays(t0, 6 - ((new Date(`${t0}T12:00:00`).getDay() + 6) % 7));
  const done = (t) => ['done', 'not_done'].includes(t.status);
  const mine = (t) => t.owner_profile_id === me || t.created_by === me && !t.owner_profile_id && !t.owner_role;
  const shown = rows.filter((t) => (st.who === 'all' ? true : mine(t)) && (st.who === 'done' ? done(t) && mine(t) : !done(t)));
  const groups = st.who === 'done' ? [['Done', shown]] : [
    ['Overdue', shown.filter((t) => t.due_date && t.due_date < t0)],
    ['Today', shown.filter((t) => t.due_date === t0)],
    ['This week', shown.filter((t) => t.due_date > t0 && t.due_date <= weekEnd)],
    ['Later', shown.filter((t) => t.due_date > weekEnd)],
    ['No date', shown.filter((t) => !t.due_date)]].filter(([, ts]) => ts.length);

  const row = (t) => html`<li class="lw-todo ${done(t) ? 'is-done' : ''}">
    <button type="button" class="lw-todo-tick" data-tick="${t.id}" aria-pressed="${String(done(t))}" aria-label="${done(t) ? 'Mark not done' : 'Mark done'}: ${t.title}">${done(t) ? raw(icon('check', 18)) : ''}</button>
    <button type="button" class="lw-row" data-task="${t.id}"><span class="lw-row-main"><strong class="${done(t) ? 'lw-done' : ''}">${t.title}</strong>
      <span class="muted small">${st.who === 'all' || !mine(t) ? ownerText(ctx, t) : 'You'}${t.hub_id ? ` · ${hubName(ctx, t.hub_id)}` : ''}${t.detail ? ' · has notes' : ''}</span></span>
      <span class="lw-row-tags">${t.visibility === 'lead_only' ? pill('grey', 'Lead only') : ''}${t.due_date ? (t.due_date < t0 && !done(t) ? pill('red', fmtDate(t.due_date), 'overdue') : t.due_date === t0 ? pill('amber', 'Today', 'due') : html`<span class="muted small">${fmtDate(t.due_date)}</span>`) : ''}</span></button></li>`;

  render(el, html`
    <form class="lw-quickadd" id="qa" autocomplete="off">
      <label class="sr-only" for="qa-title">Something that needs doing</label>
      <input id="qa-title" name="title" required maxlength="200" placeholder="Add something that needs doing, then press Enter">
      <div class="lw-quickadd-more">
        <label class="f">Due<input type="date" name="due" value="${st.lastDue || ''}"></label>
        <label class="f">For${ownerSelect(ctx, 'owner', `p:${me}`)}</label>
        ${isSenior(ctx) ? html`<label class="check small"><input type="checkbox" name="lead_only"> Lead and operations lead only</label>` : ''}
        <button class="btn">${raw(icon('add', 16))}Add</button></div>
      <p class="small muted">Ad hoc work only. Never write young people's names, contact or health details here.</p></form>
    <div class="lw-toolbar">${segControl('todo', [['mine', `Mine (${rows.filter((t) => mine(t) && !done(t)).length})`], ...(isWide(ctx) ? [['all', `Everyone's (${rows.filter((t) => !done(t)).length})`]] : []), ['done', 'Done']], st.who)}</div>
    ${groups.length ? groups.map(([label, ts]) => sectionGroup({ title: label, meta: `${ts.length} item${ts.length === 1 ? '' : 's'}`, open: true, aside: label === 'Overdue' ? pill('red', `${ts.length}`, 'overdue') : '',
      body: html`<ul class="lw-list lw-todos">${ts.map(row)}</ul>` }))
      : emptyState('check', st.who === 'done' ? 'Nothing ticked off yet.' : 'Nothing on the list. Add something above.')}`);

  bindSegments(el);
  $$('[data-seg-for="todo"] [data-seg]', el).forEach((b) => b.addEventListener('click', () => { st.who = b.dataset.seg; todo(ctx, el, refresh); }));
  bindTasks(el, ctx, refresh);
  $('#qa', el).addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter || $('#qa button', el), async () => {
      const f = formData(e.target);
      must(await db.from('tasks').insert({ consortium_id: c, tracker: 'todo', area: 'To do', title: f.title.trim(), due_date: f.due || null,
        ...ownerFields(f.owner || ''), visibility: f.lead_only ? 'lead_only' : 'team' }));
      st.lastDue = f.due || '';
      toast('Added.');
      await todo(ctx, el, refresh);
      $('#qa-title', el)?.focus();
    });
  });
  $$('[data-tick]', el).forEach((b) => b.addEventListener('click', () => act(b, async () => {
    const t = rows.find((x) => x.id === b.dataset.tick);
    must(await db.rpc('lw_task_update', { p_task: t.id, p_status: done(t) ? 'not_started' : 'done' }));
    await todo(ctx, el, refresh);
  })));
}
