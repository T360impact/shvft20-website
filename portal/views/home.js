// The platform Home (no sidebar): a greeting, "Start a bid" and "Set up a
// consortium" for the consortium lead and Shvft staff, then a card for each
// workspace the person can open. Live consortia show the month of the
// programme, the next deadline, open tasks for me, the progress score and a
// status; bids show the deadline, readiness and items waiting for me.
// Tabs for Live, Bids and Closed; search; demo workspaces can be hidden.
// Programme figures stay inside each workspace. Below the cards, what's
// waiting for the person across their workspaces. A project's consortium
// lead (or Shvft staff) can archive it, or delete it after typing its name.
import { db, html, raw, render, $, $$, must, act, toast, icon, pill, duePill, statusPill, emptyState, openDrawer, fmtMonth, fmtDate, daysUntil, segControl, bindSegments, sectionGroup, ROLE_LABEL } from '../lib.js';
import { ring } from './profile.js';
import { adminCall } from './team.js';

const MODULE = {
  bids: { label: 'Bids', icon: 'bids', mod: 'bids' },
  returns: { label: 'Returns', icon: 'returns', mod: 'compliance' },
  finance: { label: 'Targets and budget', icon: 'finance', mod: 'finance' },
  risks: { label: 'Risks', icon: 'safeguarding', mod: 'compliance' },
};
const KEY = 'portal-home';
const remember = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
const save = (v) => { try { localStorage.setItem(KEY, JSON.stringify({ ...remember(), ...v })); } catch { /* per-device convenience only */ } };

const status = (w) => {
  if (w.tab === 'closed') return w.archived ? pill('grey', 'Archived') : statusPill(w.stage);
  if (w.stage === 'live') return w.score == null ? pill('grey', 'Not started') : w.score >= 95 ? pill('green', 'On track', 'approved') : w.score >= 80 ? pill('amber', 'Some concern') : pill('red', 'Behind', 'overdue');
  return w.stage === 'submitted' ? pill('blue', 'Submitted', 'submitted') : pill('blue', 'In progress');
};
const countdown = (d) => { const n = daysUntil(d); return n == null ? '' : n < 0 ? pill('red', `${-n} day${n === -1 ? '' : 's'} ago`) : n === 0 ? pill('red', 'Today') : pill(n <= 7 ? 'amber' : 'grey', `${n} day${n === 1 ? '' : 's'} left`); };

const liveCard = (w) => html`<a class="ws-card" href="#/c/${w.id}">
  <div class="ws-card-head"><div><h3>${w.name}</h3><p class="small muted">${[w.funder, w.programme].filter(Boolean).join(' · ') || 'Consortium'}</p></div>
    ${w.score != null ? html`<span class="ws-ring" title="Progress score">${ring(w.score, 56)}</span>` : ''}</div>
  <dl class="ws-facts"><div><dt>Month</dt><dd>${w.month ? `${w.month} of ${w.months}` : '–'}</dd></div>
    <div><dt>Next deadline</dt><dd>${w.next_deadline ? html`${fmtDate(w.next_deadline.date)}<span class="small muted"> ${w.next_deadline.label}</span>` : '–'}</dd></div>
    <div><dt>Open tasks for you</dt><dd>${w.open_tasks || 0}</dd></div></dl>
  <p class="ws-pills">${status(w)}${w.is_demo ? pill('grey', 'Demo') : ''}${w.role ? html`<span class="small muted">${ROLE_LABEL[w.role] || w.role}${w.organisation ? ` · ${w.organisation}` : ''}</span>` : ''}</p></a>`;
const bidCard = (w) => html`<a class="ws-card" href="#/c/${w.id}">
  <div class="ws-card-head"><div><h3>${w.name}</h3><p class="small muted">${w.funder || 'Bid'}</p></div>
    ${w.readiness != null ? html`<span class="ws-ring" title="Mandatory items approved">${ring(w.readiness, 56)}</span>` : ''}</div>
  <dl class="ws-facts"><div><dt>Deadline</dt><dd>${w.deadline ? html`${fmtDate(w.deadline)} ${countdown(w.deadline)}` : '–'}</dd></div>
    <div><dt>Readiness</dt><dd>${w.readiness == null ? 'No required items yet' : `${w.readiness}% of required items approved`}</dd></div>
    <div><dt>Waiting for you</dt><dd>${w.awaiting_me || 0}</dd></div></dl>
  <p class="ws-pills">${status(w)}${w.is_demo ? pill('grey', 'Demo') : ''}${w.role ? html`<span class="small muted">${ROLE_LABEL[w.role] || w.role}${w.organisation ? ` · ${w.organisation}` : ''}</span>` : ''}</p></a>`;
const closedCard = (w) => html`<a class="ws-card" href="#/c/${w.id}"><div class="ws-card-head"><div><h3>${w.name}</h3><p class="small muted">${w.funder || ''}</p></div></div>
  <p class="ws-pills">${status(w)}${w.is_demo ? pill('grey', 'Demo') : ''}</p></a>`;

export default async function home(main, state) {
  const h = must(await db.rpc('platform_home'));
  const all = h.workspaces;
  const first = (state.profile.full_name || '').split(' ')[0];
  const hour = new Date().getHours();
  const realExists = all.some((w) => !w.is_demo);
  const pref = remember();
  const live = all.filter((w) => w.tab === 'live');
  const bids = all.filter((w) => w.tab === 'bids');
  const actions = h.can_create ? html`<div class="ws-actions">
    <a class="ws-action" href="#/new/bid">${raw(icon('bids', 28))}<span><strong>Start a bid</strong><span class="small muted">Funder profile, deadline, the application form and guidance, then invite partners.</span></span></a>
    <a class="ws-action" href="#/new/consortium">${raw(icon('governance', 28))}<span><strong>Set up a consortium</strong><span class="small muted">From a won bid or from scratch: partners, documents, targets, then publish the Summary.</span></span></a></div>` : '';

  render(main, html`
    <div class="home-head"><h1>${hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}${first ? html`, <span class="grad">${first}</span>` : ''}</h1>
      <p class="muted">${live.length} live consorti${live.length === 1 ? 'um' : 'a'}, ${bids.length} bid${bids.length === 1 ? '' : 's'} in progress.</p></div>
    ${actions}
    ${all.length ? html`<div class="home-tools">${segControl('htab', [['live', `Live (${live.length})`], ['bids', `Bids (${bids.length})`], ['closed', `Closed and archived (${all.length - live.length - bids.length})`]], pref.tab || (live.length || !bids.length ? 'live' : 'bids'))}
        <input type="search" id="ws-q" placeholder="Search by name" aria-label="Search workspaces">
        ${all.some((w) => w.is_demo) ? html`<label class="check small"><input type="checkbox" id="ws-demo" ${(pref.demo ?? !realExists) ? 'checked' : ''}> Show demo workspaces</label>` : ''}</div>
      <div id="ws-list"></div>`
      : h.can_create ? html`<p class="muted" style="margin-top:16px">Start with a bid you're going for, or a consortium that's already funded. You can add partners, documents and targets as you go.</p>`
        : html`<section class="panel">${emptyState('partners', 'You\'re not part of a bid or consortium yet. Your consortium lead sends you an invitation.')}</section>`}
    <div id="waiting"></div>`);

  const list = $('#ws-list', main);
  const paint = () => {
    if (!list) return;
    const tab = $('[data-seg-for="htab"] [aria-pressed="true"]', main)?.dataset.seg || 'live';
    const q = ($('#ws-q', main)?.value || '').trim().toLowerCase();
    const demo = $('#ws-demo', main)?.checked ?? true;
    const ws = all.filter((w) => w.tab === tab && (demo || !w.is_demo) && (!q || w.name.toLowerCase().includes(q)));
    const card = tab === 'live' ? liveCard : tab === 'bids' ? bidCard : closedCard;
    render(list, ws.length ? html`<div class="ws-grid">${ws.map((w) => html`<div class="ws-card-wrap ${w.can_delete ? 'can-manage' : ''}">${card(w)}
      ${w.can_delete ? html`<button type="button" class="ws-manage" data-manage="${w.id}" aria-label="Archive or delete ${w.name}" title="Archive or delete">${raw(icon('more', 18))}</button>` : ''}</div>`)}</div>`
      : html`<p class="muted" style="margin-top:12px">${q ? 'Nothing matches that name.' : tab === 'closed' ? 'Nothing closed or archived.' : `No ${tab === 'live' ? 'live consortia' : 'bids in progress'}${demo ? '' : ' (demo workspaces are hidden)'}.`}</p>`);
    $$('[data-manage]', list).forEach((b) => b.addEventListener('click', () => act(b, () => manage(all.find((w) => w.id === b.dataset.manage), () => home(main, state)))));
  };
  bindSegments(main);
  $$('[data-seg-for="htab"] [data-seg]', main).forEach((b) => b.addEventListener('click', () => { save({ tab: b.dataset.seg }); paint(); }));
  $('#ws-q', main)?.addEventListener('input', paint);
  $('#ws-demo', main)?.addEventListener('change', (e) => { save({ demo: e.target.checked }); paint(); });
  paint();
  waiting($('#waiting', main), state, all);
}

// What's waiting for this person across their workspaces, grouped by module.
async function waiting(el, state, all) {
  const name = (id) => all.find((c) => c.id === id)?.name || '';
  const myOrgs = state.memberships.map((m) => m.organisation_id).filter(Boolean);
  const leads = state.memberships.filter((m) => m.role === 'lead').map((m) => m.consortium_id);
  const confirmers = state.memberships.filter((m) => m.role === 'partner_manager').map((m) => m.organisation_id);
  const soon = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
  const [items, myReturns, toReview, toConfirm] = await Promise.all([
    myOrgs.length ? db.from('bid_items').select('id, consortium_id, name, due_on, status, consortia(name, stage)')
      .in('organisation_id', myOrgs).in('status', ['requested', 'returned']).lte('due_on', soon).order('due_on').then(must) : [],
    myOrgs.length ? db.from('returns').select('id, consortium_id, period_month, status').in('organisation_id', myOrgs).in('status', ['draft', 'changes_requested']).then(must) : [],
    leads.length ? db.from('returns').select('id, consortium_id, organisation_id, period_month, organisations(name)').in('consortium_id', leads).eq('status', 'submitted').then(must) : [],
    confirmers.length ? db.from('allocations').select('consortium_id').in('organisation_id', confirmers).is('confirmed_by_partner_at', null).is('superseded_by', null).is('retired_at', null).then(must) : [],
  ]);
  const riskSets = await Promise.all(all.filter((c) => c.stage === 'live' && c.role && c.role !== 'associate').map((c) => db.rpc('risk_reminders', { p_consortium: c.id }).then(({ data }) => ({ c, r: data || {} }))));
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
  const groups = Object.entries(tasks).filter(([, t]) => t.length);
  if (!groups.length) return;
  render(el, html`<div class="section"><h2>Waiting for you</h2>${groups.map(([k, t], i) => sectionGroup({ title: MODULE[k].label, meta: `${t.length}`, open: i === 0,
    body: html`<ul class="tasks">${t.map((x) => html`<li><a href="${x.href}"><span><strong>${x.title}</strong><span class="small muted">${x.where}</span></span>${x.pill}</a></li>`)}</ul>` }))}</div>`);
}

// Archive (reversible) or delete (for good) a project. Deleting shows what
// goes, then asks "are you sure" with the project's name typed in.
async function manage(w, again) {
  const p = must(await db.rpc('workspace_delete_preview', { p_consortium: w.id }));
  const k = p.counts;
  const what = [[k.organisations, 'organisation'], [k.people, 'person\'s access', 'people\'s access'], [k.targets, 'target'], [k.returns, 'monthly return'], [k.weekly, 'week of figures', 'weeks of figures'],
    [k.documents, 'document'], [k.risks, 'risk'], [k.bid_items, 'bid checklist item'], [k.tasks, 'Lead Workspace task']]
    .filter(([n]) => n > 0).map(([n, one, many]) => `${n} ${n === 1 ? one : many || `${one}s`}`);
  const d = openDrawer(p.name, html`
    <section><h3 class="small-head">${p.archived ? 'Restore' : 'Archive'}</h3>
      <p class="small muted">${p.archived ? 'Moves it back from Closed and archived.' : 'Moves it to Closed and archived. Nothing is deleted, and you can restore it any time.'}</p>
      <div class="btns"><button type="button" class="btn secondary" id="arch">${p.archived ? 'Restore it' : 'Archive it'}</button></div></section>
    <section style="margin-top:24px"><h3 class="small-head">Delete permanently</h3>
      <p class="small">This deletes ${p.name} and everything in it${what.length ? `: ${what.join(', ')}` : ''}, and its uploaded files. Partners' own profiles and documents are kept, as they're shared with other projects.</p>
      <p class="small"><strong>It can't be undone.</strong></p>
      ${p.stage === 'live' && !p.is_demo ? html`<div class="banner warn small">This is a live consortium. If the programme has finished, archiving keeps its records for audit and the funder.</div>` : ''}
      <div id="del-step" style="margin-top:12px"><div class="btns"><button type="button" class="btn danger" id="del-1">Delete this project…</button></div></div></section>`);
  $('#arch', d).addEventListener('click', (e) => act(e.currentTarget, async () => {
    must(await db.rpc('archive_workspace', { p_consortium: w.id, p_archive: !p.archived }));
    d.close(); toast(p.archived ? `${p.name} restored.` : `${p.name} archived. It's under Closed and archived.`); again();
  }));
  $('#del-1', d).addEventListener('click', () => {
    const step = $('#del-step', d);
    render(step, html`<div class="banner bad"><div><strong>Are you sure?</strong> ${p.name} and everything in it will be deleted for everyone, permanently.</div></div>
      <label class="f" style="margin-top:12px">Type <strong>${p.name}</strong> to confirm<input id="del-name" autocomplete="off" spellcheck="false"></label>
      <div class="btns"><button type="button" class="btn danger" id="del-2" disabled>Delete permanently</button><button type="button" class="btn secondary" id="del-no">Keep it</button></div>`);
    const input = $('#del-name', step); const go = $('#del-2', step);
    input.focus();
    input.addEventListener('input', () => { go.disabled = input.value.trim().toLowerCase() !== p.name.trim().toLowerCase(); });
    $('#del-no', step).addEventListener('click', () => d.close());
    go.addEventListener('click', () => act(go, async () => {
      const res = await adminCall({ action: 'delete_workspace', consortium_id: w.id, confirm: input.value });
      d.close();
      toast(res.files_left ? `${p.name} deleted. Some files couldn't be removed; Shvft staff have a record.` : `${p.name} deleted.`);
      // The person's list of workspaces has changed: start afresh.
      setTimeout(() => { location.hash = '#/'; location.reload(); }, 900);
    }));
  });
}
