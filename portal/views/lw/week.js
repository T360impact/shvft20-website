// This week: the Lead Workspace's landing page. Everything that needs the
// lead team now, each as a short section that opens to detail: the lead's
// decisions, overdue tasks by owner, checklists for the last delivery day,
// rota gaps, people blockers, agreements, outputs behind, delegated work.
import { html, raw, render, $, $$, db, must, act, toast, icon, pill, openDrawer, fmtDate, fmtMonth, formData, today, emptyState, sectionGroup, statCard, headline } from '../../lib.js';
import { hubName, isSenior, isWide, base, bindTasks, statusTag, dueTag, miniRing, ragTag, RHYTHM } from './common.js';

export default async function week(ctx, el, refresh) {
  const [w, wp] = await Promise.all([
    db.rpc('lw_this_week', { p_consortium: ctx.consortium.id }).then(must),
    db.rpc('lw_week_progress', { p_consortium: ctx.consortium.id }).then(must),
  ]);
  const b = base(ctx);
  const overdueN = w.overdue.reduce((a, g) => a + g.tasks.length, 0);
  const gapsN = w.rota_gaps.length;
  const peopleN = w.recruitment.length + w.training.length + w.supervision.length;
  const behind = w.outputs.length + w.partners_behind.reduce((a, p) => a + p.targets.length, 0);
  const taskLine = (t) => html`<li><button type="button" class="lw-row" data-task="${t.id}"><span class="lw-row-main"><strong>${t.title}</strong>
    ${t.tracker ? html`<span class="muted small">${t.tracker === 'consortium' ? 'Consortium' : 'Operations'}${t.meeting_id ? ' · meeting action' : ''}</span>` : ''}</span>
    <span class="lw-row-tags">${dueTag(t.due_date, false)}${statusTag(t.status)}</span></button></li>`;

  // Due this week: everything with a deadline Monday to Sunday, done or not,
  // one bar for the week and the items day by day.
  const KIND = { task: 'Task', delegated: 'Delegated', decision: 'Your decision', agreement: 'Agreement', milestone: 'Milestone',
    activity_plan: 'Activity plan', checklist: 'Checklist', supervision: 'Supervision', money: 'Money' };
  const bar = (done, total, extra = '') => html`<span class="lw-progress" role="img" aria-label="${done} of ${total} done"><i style="width:${total ? Math.round((done / total) * 100) : 0}%"></i>${extra}</span>`;
  const due = wp.due;
  const dueDone = due.filter((x) => x.done).length;
  const dueLate = due.filter((x) => !x.done && x.due < today()).length;
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(`${wp.week_start}T12:00:00`); d.setDate(d.getDate() + i); return d.toISOString().slice(0, 10); });
  const dueLine = (x) => html`<li>${x.kind === 'task' || x.kind === 'delegated' ? html`<button type="button" class="lw-row" data-task="${x.id}">${dueInner(x)}</button>` : html`<a class="lw-row" href="${{ decision: `${b}/week`, agreement: `${b}/consortium/agreements`, milestone: `${b}/consortium/milestones`,
      activity_plan: `${b}/operations/delivery`, checklist: `${b}/operations/checklists`, supervision: `${b}/operations/people`, money: `${b}/consortium/money` }[x.kind] || `${b}/week`}">${dueInner(x)}</a>`}</li>`;
  const dueInner = (x) => html`<span class="lw-check ${x.done ? 'on' : ''}" aria-hidden="true">${x.done ? raw(icon('check', 14)) : ''}</span>
    <span class="lw-row-main"><strong class="${x.done ? 'lw-done' : ''}">${x.title}</strong><span class="muted small">${KIND[x.kind]}${x.owner ? ` · ${x.owner}` : ''}${x.blocks ? ' · blocks first session' : ''}</span></span>
    <span class="lw-row-tags">${x.unassigned && !x.done ? pill('amber', 'Unassigned') : ''}${x.done ? pill('green', 'Done', 'approved') : x.due < today() ? pill('red', 'Overdue', 'overdue') : x.status ? statusTag(['not_started', 'in_progress', 'blocked', 'not_done', 'done'].includes(x.status) ? x.status : 'not_started') : ''}</span>`;
  const weekPanel = html`<section class="panel lw-weekdue"><header><div><h2>Due this week</h2><span class="muted small">${fmtDate(wp.week_start)} to ${fmtDate(wp.week_end)}</span></div>
      <span class="lw-weekfig"><b>${dueDone}</b> of ${due.length} done${dueLate ? html` · <span class="warn-text">${dueLate} overdue</span>` : ''}</span></header>
    ${bar(dueDone, due.length)}
    ${due.length ? days.filter((d) => due.some((x) => x.due === d)).map((d) => { const items = due.filter((x) => x.due === d); const n = items.filter((x) => x.done).length;
      return sectionGroup({ title: new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' }), meta: `${items.length} due · ${n} done`,
        aside: bar(n, items.length), open: d === today() || (d > today() && !days.some((x) => x >= today() && x < d && due.some((y) => y.due === x))) || (items.some((x) => !x.done) && d < today()),
        body: html`<ul class="lw-list">${items.map(dueLine)}</ul>` }); }) : html`<p class="muted small">Nothing has a deadline this week.</p>`}</section>`;
  const trackerPanel = html`<section class="panel lw-trackers"><header><h2>Progress</h2><span class="muted small">All tasks in each tracker</span></header>
    <div class="lw-trackgrid">${['operations', 'consortium'].map((k) => { const t = wp.trackers.find((x) => x.tracker === k) || { total: 0, done: 0, in_progress: 0, blocked: 0, overdue: 0, unassigned: 0, areas: [] };
      return html`<div class="lw-track"><a class="lw-track-head" href="${b}/${k}/tasks"><strong>${k === 'operations' ? 'Operations' : 'Consortium'}</strong><span><b>${t.done}</b> of ${t.total} done</span></a>
        ${bar(t.done, t.total)}
        <p class="small muted">${t.in_progress} in progress${t.blocked ? ` · ${t.blocked} blocked` : ''}${t.overdue ? ` · ${t.overdue} overdue` : ''}${t.unassigned ? html` · <a href="${b}/${k}/tasks">${t.unassigned} unassigned</a>` : ''}</p>
        ${t.areas?.length ? html`<details class="lw-areas"><summary class="small">By area</summary><ul>${t.areas.map((a) => html`<li><span class="small">${a.area}</span>${bar(a.done, a.total)}<span class="small muted">${a.done}/${a.total}</span></li>`)}</ul></details>` : ''}</div>`; })}</div></section>`;

  const sections = [];
  if (isSenior(ctx)) sections.push(sectionGroup({ title: 'Your decisions', meta: w.decisions.length ? `${w.decisions.length} open${w.decisions.some((d) => d.due_date && d.due_date < today()) ? ' · some past their date' : ''}` : 'None open',
    open: w.decisions.length > 0, aside: w.decisions.length ? pill('blue', `${w.decisions.length}`) : '',
    body: w.decisions.length ? html`<ul class="lw-list">${w.decisions.map((d) => html`<li><button type="button" class="lw-row" data-dec="${d.id}"><span class="lw-row-main"><strong>${d.text}</strong>
      ${d.options ? html`<span class="muted small">Options: ${d.options}</span>` : ''}</span><span class="lw-row-tags">${dueTag(d.due_date, false)}<span class="btn small secondary">Decide</span></span></button></li>`)}</ul>`
      : emptyState('check', 'No decisions waiting on you.') }));
  sections.push(sectionGroup({ title: 'Your tasks', meta: `${w.my_tasks.length} open`, open: w.my_tasks.length > 0 && w.my_tasks.length <= 8,
    body: w.my_tasks.length ? html`<ul class="lw-list">${w.my_tasks.map(taskLine)}</ul>` : emptyState('check', 'Nothing on your list.') }));
  sections.push(sectionGroup({ title: 'Overdue', meta: overdueN ? `${overdueN} task${overdueN === 1 ? '' : 's'} across ${w.overdue.length} owner${w.overdue.length === 1 ? '' : 's'}` : 'Nothing overdue',
    aside: overdueN ? pill('red', `${overdueN}`, 'overdue') : pill('green', 'Clear', 'approved'),
    body: w.overdue.map((g) => html`<h3 class="small-head">${g.owner}</h3><ul class="lw-list">${g.tasks.map(taskLine)}</ul>`) }));
  sections.push(sectionGroup({ title: 'Checklists', meta: w.checklists.length ? `Last delivery day per hub${w.checklists_overdue.length ? ` · ${w.checklists_overdue.length} overdue` : ''}` : 'No hubs yet',
    aside: w.checklists_overdue.length ? pill('red', `${w.checklists_overdue.length} overdue`, 'overdue') : '',
    body: html`<div class="lw-cards">${w.checklists.map((h) => { const s = h.completion.filter((x) => x.rhythm.startsWith('saturday')).reduce((a, x) => ({ t: a.t + x.ticked, n: a.n + x.not_done, all: a.all + x.total }), { t: 0, n: 0, all: 0 });
      return html`<div class="panel lw-hubcheck"><header><h2>${h.hub}</h2><span class="muted small">${fmtDate(h.date)}</span></header>
        <div class="lw-hubcheck-body">${miniRing(s.t, s.n, s.all, 64)}<div>${h.not_done.length ? html`<p class="small"><strong>Not done</strong></p><ul class="lw-nd">${h.not_done.map((n) => html`<li class="small">${n.item}<span class="muted"> · ${n.reason}</span></li>`)}</ul>` : html`<p class="small muted">${s.all ? 'Nothing marked not done.' : 'No checklist that day.'}</p>`}</div></div></div>`; })}</div>
      ${w.checklists_overdue.length ? html`<p class="small warn-text">Not submitted: ${w.checklists_overdue.map((o) => `${hubName(ctx, o.hub_id)} ${o.name} (${fmtDate(o.period_date)})`).join('; ')}</p>` : ''}` }));
  sections.push(sectionGroup({ title: 'Five on the floor', meta: gapsN ? `${gapsN} upcoming rota${gapsN === 1 ? '' : 's'} with gaps` : 'No gaps in the next fortnight',
    aside: gapsN ? pill('amber', `${gapsN}`, 'overdue') : pill('green', 'Covered', 'approved'),
    body: html`<ul class="lw-list">${w.rota_gaps.map((g) => html`<li><a class="lw-row" href="${b}/operations/rota"><span class="lw-row-main"><strong>${g.hub} · ${fmtDate(g.date)}</strong>
      <span class="muted small">Below the minimum at ${g.gaps.join(', ')}</span></span></a></li>`)}</ul>` }));
  sections.push(sectionGroup({ title: 'People', meta: peopleN ? [w.recruitment.length ? `${w.recruitment.length} can't be rostered` : '', w.training.length ? `${w.training.length} training expiring` : '', w.supervision.length ? `${w.supervision.length} supervision overdue` : ''].filter(Boolean).join(' · ') : 'All clear',
    aside: peopleN ? pill('amber', `${peopleN}`) : pill('green', 'Clear', 'approved'),
    body: html`${w.recruitment.length ? html`<h3 class="small-head">Can't be rostered yet</h3><ul class="lw-list">${w.recruitment.map((r) => html`<li class="lw-row static"><span class="lw-row-main"><strong>${r.name}</strong><span class="muted small">${r.role}</span></span>
        <span class="lw-row-tags">${r.missing.map((m) => pill('amber', m))}</span></li>`)}</ul>` : ''}
      ${w.training.length ? html`<h3 class="small-head">Training</h3><ul class="lw-list">${w.training.map((t) => html`<li class="lw-row static"><span class="lw-row-main"><strong>${t.name}</strong><span class="muted small">${t.course}</span></span>
        <span class="lw-row-tags">${pill(t.state === 'expired' ? 'red' : 'amber', t.state === 'expired' ? `Expired ${fmtDate(t.expires)}` : `Expires ${fmtDate(t.expires)}`)}</span></li>`)}</ul>` : ''}
      ${w.supervision.length ? html`<h3 class="small-head">Supervision overdue</h3><ul class="lw-list">${w.supervision.map((s) => html`<li class="lw-row static"><span class="lw-row-main"><strong>${s.name}</strong></span><span class="lw-row-tags">${pill('red', `Due ${fmtDate(s.due_date)}`)}</span></li>`)}</ul>` : ''}` }));
  if (w.activity_plans.length) sections.push(sectionGroup({ title: 'Activity plans', meta: `${w.activity_plans.length} not published by the due date`, aside: pill('red', 'Overdue', 'overdue'),
    body: html`<ul class="lw-list">${w.activity_plans.map((p) => html`<li><a class="lw-row" href="${b}/operations/delivery"><span class="lw-row-main"><strong>${p.hub} · ${fmtMonth(p.month)}</strong>
      <span class="muted small">Due ${fmtDate(p.due_date)}</span></span><span class="lw-row-tags">${pill('red', 'Overdue', 'overdue')}${pill('grey', p.status.replace('_', ' '))}</span></a></li>`)}</ul>` }));
  if (w.agreements.length) sections.push(sectionGroup({ title: 'Agreements', meta: `${w.agreements.filter((a) => a.blocks_first_session).length} blocking the first session · ${w.agreements.filter((a) => a.target_date && a.target_date <= today()).length} past their date`,
    aside: w.agreements.some((a) => a.blocks_first_session) ? pill('red', 'Blocking', 'overdue') : pill('amber', 'Due'),
    body: html`<ul class="lw-list">${w.agreements.map((a) => html`<li><a class="lw-row" href="${b}/consortium/agreements"><span class="lw-row-main"><strong>${a.name}</strong>
      <span class="muted small">${a.status.replace('_', ' ')}${a.target_text ? ` · ${a.target_text}` : ''}</span></span>
      <span class="lw-row-tags">${a.blocks_first_session ? pill('red', 'Blocks first session') : ''}${a.target_date ? dueTag(a.target_date, false) : ''}</span></a></li>`)}</ul>` }));
  if (behind) sections.push(sectionGroup({ title: 'Outputs behind profile', meta: `${behind} behind`, aside: pill('amber', `${behind}`),
    body: html`${w.outputs.length ? html`<h3 class="small-head">Funder outputs</h3><ul class="lw-list">${w.outputs.map((o) => html`<li class="lw-row static"><span class="lw-row-main"><strong>${o.name}</strong>
        <span class="muted small">${o.achieved ?? 0} of ${o.planned} expected by now</span></span><span class="lw-row-tags">${ragTag(o.rag)}</span></li>`)}</ul>` : ''}
      ${w.partners_behind.map((p) => html`<h3 class="small-head">${p.name}</h3><ul class="lw-list">${p.targets.map((t) => html`<li class="lw-row static"><span class="lw-row-main"><strong>${headline(t.label)}</strong>
        <span class="muted small">${t.achieved} of ${t.planned} profiled to date</span></span><span class="lw-row-tags">${ragTag(t.rag)}</span></li>`)}</ul>`)}` }));
  if (w.delegated.length) sections.push(sectionGroup({ title: 'Delegated', meta: `${w.delegated.reduce((a, g) => a + g.tasks.length, 0)} items with ${w.delegated.length} owners · ${w.delegated.reduce((a, g) => a + g.tasks.filter((t) => t.status === 'done').length, 0)} done`,
    body: w.delegated.map((g) => html`<h3 class="small-head">${g.owner}</h3><ul class="lw-list">${g.tasks.map(taskLine)}</ul>`) }));
  if (w.milestones.length) sections.push(sectionGroup({ title: 'Milestones in the next fortnight', meta: `${w.milestones.length}`,
    body: html`<ul class="lw-list">${w.milestones.map((m) => html`<li><a class="lw-row" href="${b}/consortium/milestones"><span class="lw-row-main"><strong>${m.what}</strong><span class="muted small">${m.when_text || ''}</span></span>
      <span class="lw-row-tags">${dueTag(m.due_date, false)}</span></a></li>`)}</ul>` }));

  render(el, html`<div class="stats stats-4">
      ${statCard({ icon: 'governance', value: isSenior(ctx) ? w.decisions.length : w.my_tasks.length, label: isSenior(ctx) ? 'Decisions waiting' : 'Your open tasks', trend: { dir: 'flat', tone: 'grey', text: isSenior(ctx) ? 'reserved for the lead' : 'assigned to you or your role' } })}
      ${statCard({ icon: 'overdue', value: overdueN, label: 'Overdue tasks', trend: { dir: 'flat', tone: overdueN ? 'red' : 'green', text: 'across both trackers' } })}
      ${statCard({ icon: 'people', value: gapsN, label: 'Rotas with gaps', trend: { dir: 'flat', tone: gapsN ? 'amber' : 'green', text: 'next 14 days' } })}
      ${statCard({ icon: 'outcomes', value: behind, label: 'Behind profile', trend: { dir: 'flat', tone: behind ? 'amber' : 'green', text: 'outputs and partner targets' } })}</div>
    <p class="lw-meetlinks small"><span class="muted">Meeting views:</span> <a href="${b}/meetings/weekly">Weekly operations</a>${isWide(ctx) ? html` · <a href="${b}/meetings/monthly">Monthly consortium</a>` : ''} · <a href="${b}/todo">To do list</a></p>
    <div class="lw-weekgrid">${weekPanel}${trackerPanel}</div>
    <div class="lw-sections">${sections}</div>`);
  bindTasks(el, ctx, refresh);
  $$('[data-dec]', el).forEach((btn) => btn.addEventListener('click', () => {
    const d0 = w.decisions.find((x) => x.id === btn.dataset.dec);
    const d = openDrawer('Decide', html`<form class="form" id="dc-form"><p><strong>${d0.text}</strong></p>${d0.options ? html`<p class="small">Options: ${d0.options}</p>` : ''}
      <label class="f">What you decided<textarea name="outcome" required rows="3" maxlength="2000"></textarea></label>
      <p class="small muted">It is written to the decision log with today's date and your name.</p>
      <details><summary class="small">Change the due date or options instead</summary><div class="fields"><label class="f">Due<input type="date" name="due" value="${d0.due_date || ''}"></label></div>
        <label class="f">Options<textarea name="options" rows="2" maxlength="2000">${d0.options || ''}</textarea></label><button type="button" class="btn secondary small" id="save-only">Save without deciding</button></details>
      <div class="btns"><button class="btn">Mark decided</button></div></form>`);
    $('#dc-form', d).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => {
      must(await db.from('lw_decisions').update({ status: 'decided', outcome: formData(e.target).outcome }).eq('id', d0.id)); d.close(); toast('Decided and logged.'); refresh(); }); });
    $('#save-only', d).addEventListener('click', (e) => act(e.target, async () => { const f = formData($('#dc-form', d));
      must(await db.from('lw_decisions').update({ due_date: f.due || null, options: f.options || null }).eq('id', d0.id)); d.close(); refresh(); }));
  }));
  void RHYTHM; void raw; void icon;
}
