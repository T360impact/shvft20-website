// Meeting views, one presentable screen each. The weekly operations meeting
// goes hub by hub (last delivery day's figures, checklists, incidents,
// staffing for the next day, plans, food) then referrals and open actions.
// The monthly consortium meeting brings partner RAG, outputs, returns,
// referrals, next month's plans, risks and decisions. Actions added here get
// an owner and a due date and land on the owner's list and This week.
// "Export to PDF" prints the screen for the minutes.
import { html, raw, render, $, $$, db, must, act, toast, icon, pill, fmtDate, fmtMonth, fmtNum, formData, today, emptyState, headline } from '../../lib.js';
import { ownerSelect, ownerFields, hubSelect, isWide, ragTag, miniRing, base, bindTasks, statusTag, dueTag, subNav } from './common.js';

// Picked hub, date and view survive a live refresh.
const ui = (ctx) => ctx.lwUi || (ctx.lwUi = {});

const hm = (t) => String(t || '').slice(0, 5);

export default async function meetings(ctx, el, sub, refresh) {
  const kind = sub === 'monthly' && isWide(ctx) ? 'monthly' : 'weekly';
  const b = base(ctx);
  const back = html`<p class="page-sub"><a class="linkbtn small" href="${b}/consortium/governance">${raw(icon('next', 14))} Governance</a></p>`;
  const nav = html`${back}${subNav(`${b}/meetings`, [['weekly', 'Weekly operations'], ...(isWide(ctx) ? [['monthly', 'Monthly consortium']] : [])], kind)}`;
  if (kind === 'weekly') return weekly(ctx, el, nav, refresh);
  return monthly(ctx, el, nav, refresh);
}

const actionForm = (ctx, tracker) => html`<form class="form lw-action-form no-print" id="act-form"><h3 class="small-head">New action</h3>
  <label class="f">Action<input name="title" required maxlength="200"></label>
  <div class="fields"><label class="f">Owner${ownerSelect(ctx, 'owner', '')}</label><label class="f">Due<input type="date" name="due" required value="${today()}"></label>
    ${tracker === 'operations' ? html`<label class="f">Hub${hubSelect(ctx, 'hub_id', '')}</label>` : ''}</div>
  <div class="btns"><button class="btn">Add action</button></div></form>`;

function bindAction(ctx, el, meeting, date, tracker, refresh) {
  $('#act-form', el)?.addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      const f = formData(e.target);
      if (!f.owner) throw new Error('Give the action an owner.');
      const occ = meeting ? must(await db.rpc('lw_meeting_open', { p_meeting: meeting.id, p_date: date })) : null;
      must(await db.from('tasks').insert({ consortium_id: ctx.consortium.id, tracker, area: meeting?.name || 'Meeting actions', title: f.title,
        ...ownerFields(f.owner), due_date: f.due, hub_id: f.hub_id || null, meeting_id: occ }));
      toast('Action added to their list.'); refresh();
    });
  });
  $('#print', el)?.addEventListener('click', () => window.print());
}

const actionsBlock = (ctx, actions) => (actions.length ? html`<ul class="lw-list">${actions.map((a) => html`<li><button type="button" class="lw-row" data-task="${a.id}">
  <span class="lw-row-main"><strong>${a.title}</strong><span class="muted small">${a.owner}${a.meeting_id ? ' · from a meeting' : ''}</span></span>
  <span class="lw-row-tags">${dueTag(a.due_date, false)}${statusTag(a.status)}</span></button></li>`)}</ul>` : html`<p class="muted small">No open actions.</p>`);

async function weekly(ctx, el, nav, refresh) {
  const date = ui(ctx)._mdate || today();
  const m = must(await db.rpc('lw_weekly_meeting', { p_consortium: ctx.consortium.id, p_date: date }));
  render(el, html`${nav}
    <div class="lw-toolbar no-print"><label class="f">Meeting date<input type="date" id="m-date" value="${date}"></label>
      <button class="btn secondary" id="print">${raw(icon('download', 16))}Export to PDF</button></div>
    <article class="lw-meeting">
      <header class="lw-meeting-head"><h2>${m.meeting?.name || 'Weekly operations meeting'}</h2><p class="muted">${ctx.consortium.name} · ${fmtDate(date)}${m.meeting?.chair_text ? ` · chair ${m.meeting.chair_text}` : ''}</p></header>
      ${m.hubs.length ? m.hubs.map((h) => { const s = h.completion.filter((x) => x.rhythm.startsWith('saturday')).reduce((a, x) => ({ t: a.t + x.ticked, n: a.n + x.not_done, all: a.all + x.total }), { t: 0, n: 0, all: 0 });
        const r = h.rota;
        return html`<section class="lw-mhub"><h3>${h.hub}</h3>
          <div class="lw-mgrid">
            <div class="lw-mfig"><span class="muted small">Last delivery day</span><strong>${h.date ? fmtDate(h.date) : '–'}</strong></div>
            <div class="lw-mfig"><span class="muted small">Attendances</span><strong>${fmtNum(h.attendances)}</strong></div>
            <div class="lw-mfig"><span class="muted small">New members</span><strong>${fmtNum(h.new_members)}</strong></div>
            <div class="lw-mfig"><span class="muted small">Targeted attendances</span><strong>${fmtNum(h.targeted_attendances)}</strong></div>
            <div class="lw-mfig lw-mring">${miniRing(s.t, s.n, s.all, 56)}<span class="muted small">Checklists</span></div></div>
          <div class="lw-mcols">
            <div><h4>Not done this week</h4>${h.not_done.length ? html`<ul class="lw-nd">${h.not_done.map((n) => html`<li class="small">${n.item}<span class="muted"> · ${n.reason} · ${fmtDate(n.date)}</span></li>`)}</ul>` : html`<p class="muted small">Nothing.</p>`}
              <h4>Incidents</h4><p class="small">${h.log?.incident_refs || html`<span class="muted">No references logged.</span>`}</p></div>
            <div><h4>Next delivery day${h.next_day ? `, ${fmtDate(h.next_day)}` : ''}</h4>
              ${r?.hours ? html`<p class="small">Doors ${hm(r.hours.doors_open)}–${hm(r.hours.doors_close)} · ${r.shifts.filter((x) => x.status === 'rostered').length} rostered
                ${r.gaps.length ? html` · ${pill('amber', `below ${r.minimum} at ${r.gaps.map((g) => g.time).join(', ')}`)}` : html` · ${pill('green', 'covered', 'approved')}`}
                ${r.shifts.some((x) => x.status === 'uncovered') ? html` · ${pill('red', `${r.shifts.filter((x) => x.status === 'uncovered').length} need cover`)}` : ''}
                ${r.published ? '' : html` · ${pill('grey', 'not published')}`}</p>` : html`<p class="muted small">No rota yet.</p>`}
              <h4>Activity plans</h4><p class="small">${h.plans.length ? h.plans.map((p) => `${fmtMonth(p.month)}: ${p.status}`).join(' · ') : html`<span class="muted">None started.</span>`}</p>
              <h4>Food and materials</h4><p class="small">${h.log?.food_materials || html`<span class="muted">Not logged.</span>`}</p>
              ${h.log?.next_needs ? html`<h4>Needs</h4><p class="small">${h.log.next_needs}</p>` : ''}</div></div></section>`; }) : emptyState('sites', 'No hubs yet.')}
      <section class="lw-mhub"><h3>Referral pathways in progress</h3>${m.referrals.length ? html`<p class="small">${m.referrals.map((r) => `${r.service} (${r.status.replace('_', ' ')})`).join(' · ')}</p>` : html`<p class="muted small">All confirmed, or none set up.</p>`}
        <p class="small muted">Figures above come from each hub site's confirmed weekly uploads.</p></section>
      <section class="lw-mhub"><h3>Open actions</h3>${actionsBlock(ctx, m.actions)}${actionForm(ctx, 'operations')}</section>
    </article>`);
  $('#m-date', el).addEventListener('change', (e) => { ui(ctx)._mdate = e.target.value || today(); weekly(ctx, el, nav, refresh); });
  bindTasks(el, ctx, refresh);
  bindAction(ctx, el, m.meeting, date, 'operations', refresh);
}

async function monthly(ctx, el, nav, refresh) {
  const month = ui(ctx)._mmonth || today().slice(0, 7);
  const m = must(await db.rpc('lw_monthly_meeting', { p_consortium: ctx.consortium.id, p_month: `${month}-01` }));
  const RET = { approved: ['green', 'Approved'], submitted: ['blue', 'Submitted'], changes_requested: ['amber', 'Changes requested'], draft: ['grey', 'Draft'], not_received: ['red', 'Not received'] };
  render(el, html`${nav}
    <div class="lw-toolbar no-print"><label class="f">Month<input type="month" id="m-month" value="${month}"></label>
      <button class="btn secondary" id="print">${raw(icon('download', 16))}Export to PDF</button></div>
    <article class="lw-meeting">
      <header class="lw-meeting-head"><h2>${m.meeting?.name || 'Monthly consortium meeting'}</h2><p class="muted">${ctx.consortium.name} · ${fmtMonth(`${month}-01`)}${m.meeting?.chair_text ? ` · chair ${m.meeting.chair_text}` : ''}</p></header>
      ${m.partners.length ? html`<section class="lw-mhub"><h3>Partners against profile</h3><div class="table-wrap"><table class="lw-table"><thead><tr><th>Partner</th><th>Return</th><th>Targets</th></tr></thead><tbody>
        ${m.partners.map((p) => html`<tr><th scope="row">${p.name}</th><td>${p.return_received ? pill('green', 'In', 'approved') : pill('red', 'Not in')}</td>
          <td>${p.targets.map((t) => html`<span class="lw-mtarget">${headline(t.label, 5)} ${ragTag(t.rag)}<span class="muted small">${fmtNum(t.achieved)}/${fmtNum(t.planned)}</span></span>`)}</td></tr>`)}</tbody></table></div></section>` : ''}
      <section class="lw-mhub"><h3>Funder outputs</h3>${m.outputs.length ? html`<div class="lw-mgrid">${m.outputs.map((o) => html`<div class="lw-mfig"><span class="muted small">${o.name}</span><strong>${fmtNum(o.achieved ?? 0)}<span class="muted small"> / ${fmtNum(o.planned)} expected</span></strong>${o.achieved == null ? pill('grey', 'Not linked') : ragTag(o.rag)}</div>`)}</div>` : html`<p class="muted small">No outputs yet.</p>`}</section>
      <section class="lw-mhub lw-mcols"><div><h3>Returns for last month</h3><ul class="lw-nd">${m.returns.map((r) => html`<li class="small">${r.organisation} ${pill(...(RET[r.status] || RET.not_received))}</li>`)}</ul></div>
        <div><h3>Referral pathways</h3><ul class="lw-nd">${m.referrals.map((r) => html`<li class="small">${r.service} · ${r.status.replace('_', ' ')}</li>`)}</ul>${!m.referrals.length ? html`<p class="muted small">None set up.</p>` : ''}</div></section>
      <section class="lw-mhub lw-mcols"><div><h3>Next month's activity plans</h3><ul class="lw-nd">${m.next_plans.map((p) => html`<li class="small">${p.hub} · ${p.status.replace('_', ' ')}${p.due_date ? ` · due ${fmtDate(p.due_date)}` : ''}</li>`)}</ul></div>
        <div><h3>Top risks</h3>${m.risks.length ? html`<ul class="lw-nd">${m.risks.map((r) => html`<li class="small"><strong>${r.ref}</strong> ${r.title} <span class="muted">· ${r.band || ''} ${r.residual_score ?? ''}</span></li>`)}</ul>` : html`<p class="muted small">No open risks.</p>`}</div></section>
      <section class="lw-mhub"><h3>Decisions this month</h3>${m.decisions.length ? html`<ul class="lw-nd">${m.decisions.map((d) => html`<li class="small">${fmtDate(d.decided_on)} · ${d.decision}</li>`)}</ul>` : html`<p class="muted small">None logged yet.</p>`}</section>
      <section class="lw-mhub"><h3>Open consortium actions</h3>${actionsBlock(ctx, m.actions)}${actionForm(ctx, 'consortium')}</section>
    </article>`);
  $('#m-month', el).addEventListener('change', (e) => { ui(ctx)._mmonth = e.target.value || today().slice(0, 7); monthly(ctx, el, nav, refresh); });
  bindTasks(el, ctx, refresh);
  bindAction(ctx, el, m.meeting, today(), 'consortium', refresh);
}
