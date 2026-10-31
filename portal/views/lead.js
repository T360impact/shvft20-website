// Lead Workspace: the lead team's private trackers. Routes under lw/:
//   week (default)          This week
//   operations/<section>    tasks, checklists, rota, people, delivery
//   consortium/<section>    tasks, agreements, governance, partners, outputs,
//                           assurance, referrals, money, milestones
//   meetings/<weekly|monthly>, plans[/<id>], team, mine
// Only lead team roles reach it; staff with a portal account see "mine".
import { html, render, $ } from '../lib.js';
import { header, subNav, base, lw, isSenior, isLead, isWide, liveRefresh } from './lw/common.js';
import week from './lw/week.js';
import trackerTasks from './lw/tasks.js';
import checklists from './lw/checklists.js';
import rota, { myShifts } from './lw/rota.js';
import people from './lw/people.js';
import delivery from './lw/delivery.js';
import { agreements, assurance, governance, partners, outputs, referrals, money, milestones } from './lw/consortium.js';
import meetings from './lw/meetings.js';
import plans from './lw/plan.js';
import team from './lw/team.js';

const OPS = [['tasks', 'Tasks'], ['checklists', 'Checklists'], ['rota', 'Rota'], ['people', 'People'], ['delivery', 'Delivery']];
const CON = [['tasks', 'Tasks'], ['agreements', 'Agreements'], ['governance', 'Governance'], ['partners', 'Partners'], ['outputs', 'Outputs'],
  ['assurance', 'Assurance'], ['referrals', 'Referrals'], ['money', 'Money'], ['milestones', 'Milestones']];

export default async function lead(ctx, el, [area = 'week', sub, id] = []) {
  if (!lw(ctx).roles.length) area = 'mine';
  const b = base(ctx);
  const rerun = () => lead(ctx, el, [area, sub, id]);
  const page = (title, subtitle, body) => {
    render(el, html`${header(ctx, area, title, subtitle)}${body}<div id="lw-body"><p class="loading">Loading…</p></div>`);
    return $('#lw-body', el);
  };
  liveRefresh(ctx, rerun);

  if (area === 'mine') return myShifts(ctx, page('My shifts', ''));
  if (area === 'week') return week(ctx, page('This week', 'What needs the lead team now'), rerun);
  if (area === 'operations') {
    const s = OPS.some(([k]) => k === sub) ? sub : 'tasks';
    const body = page('Operations', 'Hubs, staff and delivery', subNav(`${b}/operations`, OPS, s));
    if (s === 'tasks') return trackerTasks(ctx, body, 'operations', rerun);
    if (s === 'checklists') return checklists(ctx, body, rerun);
    if (s === 'rota') return rota(ctx, body, rerun);
    if (s === 'people') return people(ctx, body, rerun);
    return delivery(ctx, body, rerun);
  }
  if (area === 'consortium') {
    const items = CON.filter(([k]) => (isSenior(ctx) || !['partners', 'money'].includes(k)) && (isWide(ctx) || ['tasks', 'outputs', 'milestones'].includes(k)));
    const s = items.some(([k]) => k === sub) ? sub : 'tasks';
    const body = page('Consortium', 'Agreements, governance, partners and the funder', subNav(`${b}/consortium`, items, s));
    const views = { tasks: (x) => trackerTasks(ctx, x, 'consortium', rerun), agreements, assurance, governance, partners, outputs, referrals, money, milestones };
    return s === 'tasks' ? views.tasks(body) : views[s](ctx, body);
  }
  if (area === 'meetings') return meetings(ctx, page('Meetings', 'One screen per meeting'), sub, rerun);
  if (area === 'plans' && isSenior(ctx)) return plans(ctx, page(sub ? 'Review a plan' : 'Plans', 'Import a mobilisation or operations plan'), sub, rerun);
  if (area === 'team' && isLead(ctx)) return team(ctx, page('Team and hubs', 'Who is in the Lead Workspace'), rerun);
  location.replace(`${b}/week`);
}
