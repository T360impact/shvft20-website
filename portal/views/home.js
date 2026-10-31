// Home: a greeting, the person's tasks grouped by module with due dates as
// pills, then the headline numbers for their consortium, then their
// workspaces. Everything comes from what they can already see.
import { db, html, raw, render, must, icon, pill, duePill, statusPill, statCard, emptyState, fmtMonth, fmtNum, daysUntil, ROLE_LABEL } from '../lib.js';
import { headline } from './dashboard.js';

const MODULE = {
  bids: { label: 'Bids', icon: 'bids', mod: 'bids' },
  returns: { label: 'Returns', icon: 'returns', mod: 'compliance' },
  finance: { label: 'Targets and budget', icon: 'finance', mod: 'finance' },
  risks: { label: 'Risks', icon: 'safeguarding', mod: 'compliance' },
};

export default async function home(main, state) {
  const list = state.memberships.map((m) => ({ id: m.consortium_id, name: m.consortia?.name, stage: m.consortia?.stage, role: m.role, org: m.organisations?.name, orgId: m.organisation_id }));
  if (state.profile.is_platform_admin) {
    const all = must(await db.from('consortia').select('id, name, stage').order('name'));
    for (const c of all) if (!list.some((l) => l.id === c.id)) list.push({ id: c.id, name: c.name, stage: c.stage, role: 'platform_admin' });
  }
  const myOrgs = state.memberships.map((m) => m.organisation_id).filter(Boolean);
  const leads = state.memberships.filter((m) => m.role === 'lead').map((m) => m.consortium_id);
  const confirmers = state.memberships.filter((m) => m.role === 'partner_manager').map((m) => m.organisation_id);
  const soon = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
  const live = list.find((c) => c.stage === 'live');

  const [items, myReturns, toReview, toConfirm, progress] = await Promise.all([
    myOrgs.length ? db.from('bid_items').select('id, consortium_id, name, due_on, status, consortia(name, stage)')
      .in('organisation_id', myOrgs).in('status', ['requested', 'returned']).lte('due_on', soon).order('due_on').then(must) : [],
    myOrgs.length ? db.from('returns').select('id, consortium_id, period_month, status').in('organisation_id', myOrgs).in('status', ['draft', 'changes_requested']).then(must) : [],
    leads.length ? db.from('returns').select('id, consortium_id, organisation_id, period_month, organisations(name)').in('consortium_id', leads).eq('status', 'submitted').then(must) : [],
    confirmers.length ? db.from('allocations').select('consortium_id').in('organisation_id', confirmers).is('confirmed_by_partner_at', null).is('superseded_by', null).is('retired_at', null).then(must) : [],
    live ? db.rpc('consortium_progress', { p_consortium: live.id }).then(must) : null,
  ]);
  // Risk reminders: actions due within 14 days or overdue; for the lead, a
  // review due, risks rescored into the top band and partner proposals.
  const riskSets = await Promise.all(list.filter((c) => c.stage === 'live').map((c) => db.rpc('risk_reminders', { p_consortium: c.id })
    .then(({ data }) => ({ c, r: data || {} }))));
  const name = (id) => list.find((c) => c.id === id)?.name || '';

  const tasks = {
    bids: items.filter((t) => t.consortia?.stage === 'bid').map((t) => ({ href: `#/c/${t.consortium_id}/bid/${t.id}`, title: t.name, where: t.consortia?.name, pill: duePill(t.due_on) || statusPill(t.status) })),
    returns: [
      ...myReturns.map((r) => ({ href: `#/c/${r.consortium_id}/returns/${r.id}`, title: `${fmtMonth(r.period_month)} return`, where: name(r.consortium_id), pill: statusPill(r.status) })),
      ...toReview.map((r) => ({ href: `#/c/${r.consortium_id}/returns/${r.id}`, title: `Review ${r.organisations?.name}'s ${fmtMonth(r.period_month)} return`, where: name(r.consortium_id), pill: statusPill('submitted') })),
    ],
    finance: [...new Set(toConfirm.map((a) => a.consortium_id))].map((id) => ({ href: `#/c/${id}/targets`, title: 'Confirm your budget', where: name(id), pill: pill('amber', 'Waiting for you', 'due') })),
    risks: riskSets.flatMap(({ c, r }) => [
      ...(r.actions || []).map((a) => ({ href: `#/c/${c.id}/risks`, title: `${a.risk_ref}: ${a.description}`, where: c.name, pill: duePill(a.due_date) })),
      ...(r.review_due && daysUntil(r.review_due) <= 14 ? [{ href: `#/c/${c.id}/risks`, title: 'Review the risk register', where: c.name, pill: duePill(r.review_due) }] : []),
      ...(r.into_top_band || []).map((x) => ({ href: `#/c/${c.id}/risks`, title: `${x.risk_ref} moved into the highest band`, where: c.name, pill: pill('red', 'Rescored', 'overdue') })),
      ...(r.proposals ? [{ href: `#/c/${c.id}/risks`, title: `${r.proposals} risk proposal${r.proposals === 1 ? '' : 's'} to review`, where: c.name, pill: pill('blue', 'Waiting for you', 'submitted') }] : []),
    ]),
  };
  const due = Object.values(tasks).flat().length;
  const overdue = items.filter((t) => t.consortia?.stage === 'bid' && t.due_on && daysUntil(t.due_on) < 0).length;
  const first = (state.profile.full_name || '').split(' ')[0];
  const hour = new Date().getHours();
  const card = (c) => html`<a class="panel" href="#/c/${c.id}/${c.stage === 'live' ? 'dashboard' : 'bid'}" style="text-decoration:none;color:inherit">
    <h3>${c.name}</h3><p style="margin-top:8px">${statusPill(c.stage)}</p>
    <p class="small muted" style="margin-top:8px">${ROLE_LABEL[c.role]}${c.org ? ` · ${c.org}` : ''}</p></a>`;

  render(main, html`
    <div class="page-head"><div><h1>${hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}${first ? html`, <span class="grad">${first}</span>` : ''}</h1>
      <p>${due ? `You have ${due} thing${due === 1 ? '' : 's'} to do.` : 'Nothing needs you right now.'}</p></div></div>

    ${due ? html`<div class="grid3">${Object.entries(tasks).filter(([, t]) => t.length).map(([k, t]) => html`
      <section class="panel m-${MODULE[k].mod}"><h2>${raw(icon(MODULE[k].icon, 20))}${MODULE[k].label}</h2>
        <ul class="tasks">${t.map((x) => html`<li><a href="${x.href}"><span><strong>${x.title}</strong><span class="small muted">${x.where}</span></span>${x.pill}</a></li>`)}</ul></section>`)}</div>`
    : html`<section class="panel">${emptyState('approved', 'You\'re up to date. New tasks appear here with their due dates.', '', 'finance')}</section>`}

    ${progress ? html`<div class="section"><header><h2>${live.name}</h2><a class="btn secondary small" href="#/c/${live.id}/dashboard">${raw(icon('dashboard', 16))}Dashboard</a></header>
      <div class="stats">${headline(progress).slice(0, 3).map(statCard)}
        ${statCard({ icon: 'due', mod: 'compliance', value: fmtNum(due), label: 'Tasks to do', trend: overdue
          ? { dir: 'up', tone: 'red', text: `${overdue} overdue` } : due ? { dir: 'flat', tone: 'amber', text: 'None overdue' } : { dir: 'flat', tone: 'green', text: 'All clear' } })}</div></div>` : ''}

    ${list.length > 1 || !live ? html`<div class="section"><h2>Your workspaces</h2><div class="grid3">${list.map(card)}</div></div>` : ''}
    ${!list.length ? html`<section class="panel">${emptyState('partners', 'You\'re not part of a bid or consortium yet. Your lead adds you.')}</section>` : ''}`);
}
