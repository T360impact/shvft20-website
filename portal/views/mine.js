// The three dashboard tiers.
//  mine       "My organisation in this programme": what's missing, a partner's
//             role, actions, targets, return, money (finance and org admin only), risks,
//             documents and the consortium's progress (no money).
//  programme  The lead organisation's view: its own delivery, plus the whole
//             programme's delivery, returns, finance, payment approvals and
//             recording, countersignatures, risks and the next board.
//  master     The consortium lead's master view: drive controls, data
//             health, settings, and "view as" (read only and logged).
import { docPill } from './profile.js';
import { loadGaps, gapList, bindGapList, canUpload } from './reporting.js';
import { dbsSettings } from './dbs.js';
import { db, html, raw, render, $, $$, must, act, toast, icon, pill, rag, statusPill, statCard, openDrawer, formData, fmtDate, fmtDateTime, fmtMonth, fmtMoney, fmtNum,
  today, emptyState, sectionGroup, segControl, bindSegments, headline, uploadFile, ROLE_LABEL, live, liveMark } from '../lib.js';

const PAY = { scheduled: ['grey', 'Scheduled'], awaiting_return: ['amber', 'Awaiting return'], on_hold: ['red', 'On hold'], return_approved: ['blue', 'Return approved'],
  approved_for_payment: ['blue', 'Approved for payment'], paid: ['green', 'Paid'] };
const KIND = { return: 'Return', agreement: 'Agreement', assurance: 'Assurance pack', risk_action: 'Risk action', delivery_plan: 'Delivery plan', cohort_dates: 'Cohort dates', other: 'Action' };
const SRC = { weekly_upload: ['blue', 'Weekly upload'], return_manual: ['grey', 'Manual'], evidence_upload: ['grey', 'Evidence'] };
const payPill = (s) => pill(...(PAY[s] || ['grey', s]));
const money = (n) => (n == null ? '–' : fmtMoney(n));
const ui = (ctx) => ctx.uiTier || (ctx.uiTier = {});

// ------------------------------------------------------------------- tier 1

export default async function mine(ctx, el, _parts, preview = null) {
  const d = preview || must(await db.rpc('my_organisation', { p_consortium: ctx.consortium.id }));
  if (d && !preview) d.pack = must(await db.rpc('assurance_pack', { p_consortium: ctx.consortium.id, p_org: d.organisation.id }))[0]?.items || [];
  if (!d) { render(el, html`<div class="panel">You're not linked to an organisation in this workspace.</div>`); return; }
  try { d.gaps ||= await loadGaps(ctx, d.organisation.id); } catch { d.gaps = null; }
  render(el, partnerView(ctx, d));
  if (!d.read_only) bindGapList(ctx, el, () => mine(ctx, el, _parts));
  bindPartner(ctx, el, d, () => mine(ctx, el, _parts));
  if (!preview) live(ctx.consortium.id, () => { if (!document.querySelector('dialog[open]')) mine(ctx, el, _parts); });
}

function partnerView(ctx, d) {
  const c = ctx.consortium;
  const ro = d.read_only;
  const overdue = d.actions.filter((a) => a.overdue);
  const behind = d.targets.filter((t) => ['amber', 'red'].includes(t.rag));
  const ret = d.return;
  const m = d.money;
  const actionRow = (a) => html`<li class="lw-row static"><span class="lw-row-main"><strong>${a.title}</strong>
    <span class="muted small">${KIND[a.kind] || 'Action'}${a.mine ? ' · assigned to you' : ''}</span></span>
    <span class="lw-row-tags">${a.due ? (a.overdue ? pill('red', `Due ${fmtDate(a.due)}`, 'overdue') : html`<span class="small muted">Due ${fmtDate(a.due)}</span>`) : ''}
      ${a.source === 'return' ? html`<a class="btn secondary small" href="#/c/${c.id}/returns">Open</a>` : a.source === 'agreement' ? html`<a class="btn secondary small" href="#/c/${c.id}/agreements">Open</a>`
        : a.source === 'risk' ? html`<a class="btn secondary small" href="#/c/${c.id}/risks">Open</a>` : a.source === 'action' && !ro ? html`<button type="button" class="btn secondary small" data-done="${a.id}">Done</button>` : ''}</span></li>`;
  const groups = [['Overdue', d.actions.filter((a) => a.overdue)], ['Coming up', d.actions.filter((a) => !a.overdue && a.due)], ['No date', d.actions.filter((a) => !a.due)]].filter(([, x]) => x.length);
  return html`
    ${ro ? html`<div class="lead-banner viewas"><span><strong>Viewing as ${d.organisation.name}${d.roles?.length ? ` (${d.roles.map((r) => ROLE_LABEL[r] || r).join(', ')})` : ''}.</strong> Read only: nothing here can be changed.</span></div>` : ''}
    <div class="page-head"><div><span class="eyebrow">My organisation</span><h1>${d.organisation.name} in this programme</h1>
      <p class="meta-line">${d.role_card?.role_title || ROLE_LABEL[ctx.role] || ''}</p><p style="margin-top:8px">${ro ? '' : liveMark()}</p></div></div>
    <div class="stats stats-4">
      ${statCard({ icon: 'overdue', value: d.actions.length, label: 'My actions', trend: { dir: 'flat', tone: overdue.length ? 'red' : 'green', text: overdue.length ? `${overdue.length} overdue` : 'none overdue' } })}
      ${statCard({ icon: 'returns', value: ret.status === 'not_started' ? 'Not started' : (ret.return?.status || ret.status).replace('_', ' '), label: `Return for ${fmtMonth(ret.return?.period_month || ret.period_month)}`,
        trend: { dir: 'flat', tone: ret.missing?.length ? 'amber' : 'grey', text: ret.due_date ? `due ${fmtDate(ret.due_date)}${ret.missing?.length ? ` · ${ret.missing.length} missing` : ''}` : 'not started yet' } })}
      ${statCard({ icon: 'targets', value: `${d.targets.length - behind.length} of ${d.targets.length}`, label: 'Targets on track', trend: { dir: 'flat', tone: behind.length ? 'amber' : 'green', text: behind.length ? `${behind.length} behind profile` : 'against profile to date' } })}
      ${m ? statCard({ icon: 'finance', value: money(m.owed_now), label: 'Owed to you now', trend: { dir: 'flat', tone: m.on_hold.length ? 'red' : 'grey', text: m.on_hold.length ? `${m.on_hold.length} payment${m.on_hold.length === 1 ? '' : 's'} on hold` : `paid to date ${money(m.paid_to_date)}` } })
        : statCard({ icon: 'safeguarding', value: d.risks.length, label: 'My risks', trend: { dir: 'flat', tone: 'grey', text: 'owned or raised by you' } })}</div>

    <div class="dgrid">
      ${d.gaps ? html`<section class="dcard full"><header class="dcard-head"><h2>What's missing ${d.gaps.items.length ? pill('red', `${d.gaps.items.length}`) : pill('green', 'Nothing')}</h2>
        <p>For the last period: ${d.gaps.provided} of ${d.gaps.total} provided. ${ro ? '' : html`<a href="#/c/${c.id}/reporting">All reporting</a>`}</p></header>
        ${gapList(ctx, d.gaps.items, ro || !canUpload(ctx))}</section>` : ''}
      <section class="dcard half"><header class="dcard-head"><h2>Our role</h2><p>From the programme summary.</p></header>
        ${d.role_card ? html`<p><strong>${d.role_card.role_title}</strong></p>${d.role_card.responsibilities?.length ? html`<ul class="small">${d.role_card.responsibilities.map((x) => html`<li>${x}</li>`)}</ul>` : ''}
          ${d.role_card.key_contact ? html`<p class="small muted">Key contact: ${d.role_card.key_contact}</p>` : ''}` : html`<p class="muted small">The consortium lead hasn't described your role in the summary yet.</p>`}
        <h3 class="small-head" style="margin-top:12px">Our people in the portal</h3>
        <p class="small">${d.contacts.map((p) => `${p.name} (${[ROLE_LABEL[p.role] || p.role, ...(p.extra || [])].join(', ')})`).join(' · ') || 'Nobody yet'}</p></section>
      <section class="dcard half"><header class="dcard-head"><h2>My return</h2><p>${fmtMonth(ret.return?.period_month || ret.period_month)}${ret.due_date ? `, due ${fmtDate(ret.due_date)}` : ''}</p></header>
        <p>${statusPill(ret.return?.status || 'draft')}</p>
        ${ret.missing?.length ? html`<p class="small" style="margin-top:8px"><strong>Still missing:</strong> ${ret.missing.slice(0, 5).join(' · ')}${ret.missing.length > 5 ? '…' : ''}</p>` : ''}
        ${ret.return?.status === 'changes_requested' && ret.return.review_note ? html`<p class="small warn-text">Sent back: ${ret.return.review_note}</p>` : ''}
        ${ro ? '' : html`<div class="btns" style="margin-top:12px"><a class="btn" href="#/c/${c.id}/returns${ret.return?.id ? `/${ret.return.id}` : ''}">${ret.return?.id ? 'Open the return' : 'Start the return'}</a></div>`}</section>
      <section class="dcard full"><header class="dcard-head"><h2>My actions</h2><p>Everything assigned to ${d.organisation.name} or to you, overdue first.</p></header>
        ${groups.length ? groups.map(([t, xs], i) => sectionGroup({ title: t, meta: `${xs.length}`, open: i === 0, aside: t === 'Overdue' ? pill('red', `${xs.length}`, 'overdue') : '', body: html`<ul class="lw-list">${xs.map(actionRow)}</ul>` }))
          : emptyState('check', 'Nothing waiting on you.')}</section>
      <section class="dcard full"><header class="dcard-head"><h2>My targets</h2><p>This year. Shared targets show what you delivered and how the whole target stands against profile.</p></header>
        ${d.targets.length ? html`<div class="table-wrap"><table><thead><tr><th>Target</th><th class="num">Yours</th><th class="num">Whole target</th><th class="num">Profile to date</th><th>Against profile</th><th>Source</th></tr></thead>
          <tbody>${d.targets.map((t) => html`<tr><td>${headline(t.label)}${t.shared ? html` <span class="muted small">shared</span>` : ''}</td><td class="num">${fmtNum(t.mine)}</td>
            <td class="num">${fmtNum(t.achieved)} / ${fmtNum(t.target)}</td><td class="num">${fmtNum(t.profile_to_date)}</td><td>${rag(t.rag === 'grey' ? null : t.rag)}</td><td>${pill(...(SRC[t.source] || ['grey', t.source]))}</td></tr>`)}</tbody></table></div>`
          : html`<p class="muted small">No targets are linked to ${d.organisation.name} this year.</p>`}</section>
      ${m ? moneyPanel(ctx, m, ro) : ''}
      <section class="dcard half"><header class="dcard-head"><h2>My risks</h2><p>Risks you own or raised.</p></header>
        ${d.risks.length ? html`<ul class="lw-list">${d.risks.map((r) => html`<li><a class="lw-row" href="#/c/${c.id}/risks"><span class="lw-row-main"><strong>${r.ref} ${r.title}</strong></span>
          <span class="lw-row-tags">${r.review_status === 'awaiting_review' ? pill('amber', 'Awaiting review') : ''}${r.band ? html`<span class="small muted">${r.band}</span>` : ''}</span></a></li>`)}</ul>` : html`<p class="muted small">None.</p>`}</section>
      <section class="dcard half"><header class="dcard-head"><h2>My documents</h2><p>This workspace's assurance pack, and anything expiring.</p></header>
        ${(d.pack || []).length ? html`<ul class="lw-list">${d.pack.map((x) => html`<li class="lw-row static"><span class="lw-row-main"><strong>${x.label}</strong>
          ${x.expires_on ? html`<span class="small ${x.expiring || x.status === 'expired' ? 'warn-text' : 'muted'}">expires ${fmtDate(x.expires_on)}</span>` : ''}</span>
          <span class="lw-row-tags">${docPill(x.status)}</span></li>`)}</ul>` : html`<p class="muted small">The consortium lead hasn't set the assurance pack yet.</p>`}
        ${d.documents.agreements.length ? html`<p class="small" style="margin-top:8px">Agreements: ${d.documents.agreements.map((x) => `${x.title} (${x.status.replace('_', ' ')})`).join(' · ')}</p>` : ''}
        ${ro ? '' : html`<p style="margin-top:8px"><a href="#/c/${c.id}/profile">Upload or renew documents on your profile</a></p>`}</section>
      <section class="dcard full"><header class="dcard-head"><h2>Consortium progress</h2><p>The whole programme this year, from confirmed weekly uploads and approved returns.</p></header>
        <div class="stats stats-4">${statCard({ icon: 'youngPeople', value: fmtNum(d.consortium.reached), label: 'Young people reached' })}${statCard({ icon: 'attendance', value: fmtNum(d.consortium.attendances), label: 'Attendances' })}
          ${statCard({ icon: 'sessions', value: fmtNum(d.consortium.sessions), label: 'Sessions' })}${statCard({ icon: 'returns', value: `${d.consortium.returns_approved} of ${d.consortium.partners}`, label: 'Returns approved last month' })}</div>
        <p style="margin-top:12px"><a href="#/c/${c.id}/dashboard">The full consortium dashboard</a></p></section>
    </div>`;
}

function moneyPanel(ctx, m, ro) {
  return html`<section class="dcard full"><header class="dcard-head"><h2>My money</h2><p>Year ${m.year}. The lead organisation records payments; the portal never moves money.</p></header>
    <div class="stats stats-4">
      ${statCard({ icon: 'finance', value: money(m.allocation_year), label: 'Allocation this year', trend: { dir: 'flat', tone: 'grey', text: `${money(m.allocation_programme)} over the programme` } })}
      ${statCard({ icon: 'paid', value: money(m.paid_to_date), label: 'Paid to date' })}
      ${statCard({ icon: 'due', value: money(m.owed_now), label: 'Owed now', trend: { dir: 'flat', tone: 'grey', text: 'approved, not yet paid' } })}
      ${statCard({ icon: 'waiting', value: m.due_next ? money(m.due_next.amount) : '–', label: 'Due next', trend: { dir: 'flat', tone: 'grey', text: m.due_next ? `${m.due_next.label}${m.due_next.due_date ? `, ${fmtDate(m.due_next.due_date)}` : ''}` : 'nothing scheduled' } })}</div>
    ${m.on_hold.length ? html`<div class="lead-banner" style="margin-top:12px"><span><strong>On hold:</strong> ${m.on_hold.map((h) => `${h.label} (${money(h.amount)}): ${h.reason}`).join(' · ')}</span></div>` : ''}
    ${m.mobilisation ? html`<p style="margin-top:12px"><strong>Mobilisation payment</strong> ${money(m.mobilisation.amount)} ${payPill(m.mobilisation.status)}
      ${m.mobilisation.paid_on ? html`<span class="small muted">paid ${fmtDate(m.mobilisation.paid_on)}, ref ${m.mobilisation.reference}</span>` : m.mobilisation.reason ? html`<span class="small muted">${m.mobilisation.reason}</span>` : ''}</p>` : ''}
    ${sectionGroup({ title: 'Payment schedule', meta: `${m.schedule.length} payment${m.schedule.length === 1 ? '' : 's'}`, open: true, body: m.schedule.length ? html`<div class="table-wrap"><table>
      <thead><tr><th>Payment</th><th class="num">Amount</th><th>Linked return</th><th>Status</th><th>Paid</th></tr></thead>
      <tbody>${m.schedule.map((l) => html`<tr><td>${l.label}</td><td class="num">${money(l.amount)}</td><td>${l.period_month ? fmtMonth(l.period_month) : '–'}</td>
        <td>${payPill(l.status)}${l.reason ? html`<br><span class="small muted">${l.reason}</span>` : ''}</td><td class="small">${l.paid_on ? `${fmtDate(l.paid_on)} · ${l.reference}` : ''}</td></tr>`)}</tbody></table></div>` : html`<p class="muted small">No payments scheduled yet.</p>` })}
    ${sectionGroup({ title: 'Invoices', meta: `${m.invoices.length}`, open: false, aside: ro ? '' : html`<button type="button" class="btn secondary small" id="add-invoice">Submit an invoice</button>`,
      body: m.invoices.length ? html`<ul class="lw-list">${m.invoices.map((i) => html`<li class="lw-row static"><span class="lw-row-main"><strong>${i.number}</strong><span class="muted small">${fmtDate(i.submitted_on)}</span></span>
        <span class="lw-row-tags"><span>${money(i.amount)}</span>${pill(i.status === 'paid' || i.status === 'approved' ? 'green' : i.status === 'queried' ? 'amber' : 'blue', i.status)}</span></li>`)}</ul>` : html`<p class="muted small">None submitted.</p>` })}
    ${sectionGroup({ title: 'Spend against budget', meta: `${m.spend.length} line${m.spend.length === 1 ? '' : 's'}`, open: false, body: m.spend.length ? html`<div class="table-wrap"><table>
      <thead><tr><th>Budget line</th><th class="num">Budget</th><th class="num">Spent</th><th class="num">Remaining</th></tr></thead>
      <tbody>${m.spend.map((s) => html`<tr><td>${s.line}</td><td class="num">${money(s.budget)}</td><td class="num">${money(s.spent)}</td><td class="num ${s.remaining < 0 ? 'warn-text' : ''}">${money(s.remaining)}</td></tr>`)}</tbody></table></div>`
      : html`<p class="muted small">No budget lines this year.</p>` })}
  </section>`;
}

function bindPartner(ctx, el, d, again) {
  if (d.read_only) return;
  $$('[data-done]', el).forEach((b) => b.addEventListener('click', () => act(b, async () => {
    must(await db.from('partner_actions').update({ status: 'done' }).eq('id', b.dataset.done)); toast('Done.'); again();
  })));
  $('#add-invoice', el)?.addEventListener('click', () => {
    const m = d.money;
    const dr = openDrawer('Submit an invoice', html`<form class="form" id="inv-form">
      <div class="fields"><label class="f">Invoice number<input name="number" required maxlength="60"></label><label class="f">Amount (£)<input name="amount" type="number" step="0.01" min="0" required></label></div>
      <label class="f">For which payment<select name="schedule"><option value="">Not linked</option>${m.schedule.concat(m.mobilisation ? [m.mobilisation] : []).filter((l) => l.status !== 'paid').map((l) => html`<option value="${l.id}">${l.label} (${money(l.amount)})</option>`)}</select></label>
      <fieldset><legend>Split across budget lines (optional)</legend>${m.spend.map((s) => html`<label class="f">${s.line}<input type="number" step="0.01" min="0" name="line_${s.allocation_id}" data-alloc="${s.allocation_id}"></label>`)}</fieldset>
      <label class="f">The invoice (PDF)<input type="file" name="file" accept=".pdf,image/*"></label>
      <div class="btns"><button class="btn">Submit</button></div></form>`);
    $('#inv-form', dr).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => {
      const f = formData(e.target);
      const file = e.target.file.files[0];
      const path = file ? await uploadFile('documents', `${ctx.consortium.id}/invoices/${d.organisation.id}`, file) : null;
      const inv = must(await db.from('invoices').insert({ consortium_id: ctx.consortium.id, organisation_id: d.organisation.id, number: f.number, amount: Number(f.amount),
        schedule_id: f.schedule || null, storage_path: path, file_name: file?.name || null }).select('id').single());
      const lines = $$('[data-alloc]', e.target).filter((x) => x.value).map((x) => ({ invoice_id: inv.id, consortium_id: ctx.consortium.id, allocation_id: x.dataset.alloc, amount: Number(x.value) }));
      if (lines.length) must(await db.from('invoice_lines').insert(lines));
      dr.close(); toast('Invoice submitted to the lead organisation.'); again(); }); });
  });
}

// ------------------------------------------------------------------- tier 2

export async function programme(ctx, el, _parts, preview = null) {
  const p = preview || must(await db.rpc('lead_org_dashboard', { p_consortium: ctx.consortium.id }));
  render(el, programmeView(ctx, p, !!preview));
  if (!preview) {
    bindProgramme(ctx, el, p, () => programme(ctx, el, _parts));
    live(ctx.consortium.id, () => { if (!document.querySelector('dialog[open]')) programme(ctx, el, _parts); });
  }
}

function programmeView(ctx, p, ro) {
  const c = ctx.consortium;
  const f = p.finance || {};
  const canPay = (ctx.role === 'accountable_body' || ctx.isAdmin) && !ro;
  const statusCell = (m) => html`<td class="rcell ${m.status}" title="${fmtMonth(m.month)}: ${m.status}">${m.status === 'approved' ? (m.rag ? m.rag[0].toUpperCase() : '✓') : m.status === 'none' ? '' : m.status === 'submitted' ? '…' : m.status === 'changes_requested' ? '↩' : '·'}</td>`;
  return html`
    ${ro ? html`<div class="lead-banner viewas"><span><strong>Viewing as the lead organisation.</strong> Read only.</span></div>` : ''}
    <div class="page-head"><div><span class="eyebrow">Lead organisation</span><h1>The programme</h1>
      <p class="meta-line">${c.name}${c.funder ? ` · ${c.funder}` : ''}</p><p style="margin-top:8px">${ro ? '' : liveMark()}</p></div></div>
    <div class="stats stats-4">
      ${statCard({ icon: 'finance', value: money(f.grant), label: 'Grant awarded', trend: { dir: 'flat', tone: 'grey', text: `${money(f.claimed)} claimed · ${money(f.received)} received` } })}
      ${statCard({ icon: 'paid', value: money(f.paid_out), label: 'Paid to partners', trend: { dir: 'flat', tone: 'grey', text: `${money(f.central_costs)} central costs this year` } })}
      ${statCard({ icon: 'approved', value: (f.approvals || []).length, label: 'Payments waiting', trend: { dir: 'flat', tone: (f.approvals || []).length ? 'amber' : 'green', text: 'to approve or record' } })}
      ${statCard({ icon: 'safeguarding', value: p.risks.awaiting_review, label: 'Risks to review', trend: { dir: 'flat', tone: 'grey', text: `${p.risks.safeguarding_flags} safeguarding flags in 12 months` } })}</div>
    <div class="dgrid">
      <section class="dcard full"><header class="dcard-head"><h2>Delivery by partner</h2><p>This year's targets linked to each partner, against profile. <a href="#/c/${c.id}/dashboard">Filter by partner, site and year on the dashboard.</a></p></header>
        <div class="table-wrap"><table><thead><tr><th>Partner</th><th class="num">Targets</th><th class="num">On track</th><th class="num">Behind</th><th>Last return</th></tr></thead>
          <tbody>${p.delivery.map((x) => html`<tr><td>${x.name}</td><td class="num">${x.targets}</td><td class="num">${x.on_track}</td><td class="num ${x.behind ? 'warn-text' : ''}">${x.behind}</td>
            <td>${x.return ? html`${statusPill(x.return.status)} ${x.return.rag ? rag(x.return.rag) : ''}` : html`<span class="muted small">None</span>`}</td></tr>`)}</tbody></table></div></section>
      <section class="dcard full"><header class="dcard-head"><h2>Returns</h2><p>The last six months. ✓ approved (with its rating), … submitted, ↩ sent back, · draft.</p></header>
        <div class="table-wrap"><table class="rgrid"><thead><tr><th>Partner</th>${(p.returns[0]?.months || []).map((m) => html`<th>${fmtMonth(m.month).slice(0, 3)}</th>`)}</tr></thead>
          <tbody>${p.returns.map((r) => html`<tr><td>${r.name}</td>${r.months.map(statusCell)}</tr>`)}</tbody></table></div></section>
      <section class="dcard full"><header class="dcard-head"><h2>Payments</h2><p>A quarterly payment can be approved once its return is approved. Record each payment made with its date and reference.</p></header>
        ${(f.approvals || []).length ? html`<ul class="lw-list">${f.approvals.map((l) => html`<li class="lw-row static"><span class="lw-row-main"><strong>${l.organisation}: ${l.label}</strong>
          <span class="muted small">${money(l.amount)}${l.period_month ? ` · ${fmtMonth(l.period_month)} return` : ''}</span></span><span class="lw-row-tags">${payPill(l.status)}
          ${canPay && l.status === 'return_approved' ? html`<button type="button" class="btn small" data-approve="${l.id}">Approve for payment</button>` : ''}
          ${canPay && l.status === 'approved_for_payment' ? html`<button type="button" class="btn small" data-record="${l.id}" data-amount="${l.amount - (l.paid || 0)}" data-label="${l.organisation}: ${l.label}">Record payment</button>` : ''}</span></li>`)}</ul>`
          : html`<p class="muted small">Nothing waiting.</p>`}
        ${sectionGroup({ title: 'By partner', meta: `${(f.partners || []).length} partners`, open: false, body: html`<div class="table-wrap"><table><thead><tr><th>Partner</th><th class="num">Allocation this year</th><th class="num">Paid</th><th class="num">Owed</th><th class="num">Spent (invoiced)</th><th class="num">Forecast underspend</th></tr></thead>
          <tbody>${(f.partners || []).map((x) => html`<tr><td>${x.name}</td><td class="num">${money(x.allocation_year)}</td><td class="num">${money(x.paid)}</td><td class="num">${money(x.owed)}</td><td class="num">${money(x.spent_year)}</td>
            <td class="num ${x.forecast_underspend > 0 ? 'warn-text' : ''}">${money(x.forecast_underspend)}</td></tr>`)}</tbody></table></div>` })}
        ${sectionGroup({ title: 'Invoices waiting', meta: `${(f.invoices_waiting || []).length}`, open: (f.invoices_waiting || []).length > 0, body: (f.invoices_waiting || []).length ? html`<ul class="lw-list">${f.invoices_waiting.map((i) => html`<li class="lw-row static">
          <span class="lw-row-main"><strong>${i.organisation}: ${i.number}</strong><span class="muted small">${money(i.amount)} · ${fmtDate(i.submitted_on)}</span></span>
          <span class="lw-row-tags">${pill(i.status === 'queried' ? 'amber' : 'blue', i.status)}${canPay ? html`<button type="button" class="btn secondary small" data-inv="${i.id}" data-st="approved">Approve</button><button type="button" class="btn secondary small" data-inv="${i.id}" data-st="queried">Query</button>` : ''}</span></li>`)}</ul>` : html`<p class="muted small">None.</p>` })}
        ${!ro ? html`<div class="btns" style="margin-top:12px"><button type="button" class="btn secondary small" id="add-line">Add to the payment schedule</button></div>` : ''}</section>
      <section class="dcard half"><header class="dcard-head"><h2>Claims from the funder</h2><p>Claim dates and evidence deadlines.</p></header>
        ${(f.claims || []).length ? html`<ul class="lw-list">${f.claims.map((x) => html`<li><button type="button" class="lw-row" data-claim="${x.id}"><span class="lw-row-main"><strong>${x.label}</strong>
          <span class="muted small">${x.due_date ? `claim due ${fmtDate(x.due_date)}` : ''}${x.evidence_deadline ? ` · evidence by ${fmtDate(x.evidence_deadline)}` : ''}</span></span>
          <span class="lw-row-tags">${money(x.amount_claimed)} ${pill(x.status === 'received' ? 'green' : x.status === 'queried' ? 'amber' : x.status === 'submitted' ? 'blue' : 'grey', x.status)}</span></button></li>`)}</ul>` : html`<p class="muted small">None set up.</p>`}
        ${!ro ? html`<button type="button" class="btn secondary small" id="add-claim">Add a claim</button>` : ''}</section>
      <section class="dcard half"><header class="dcard-head"><h2>Countersignature</h2><p>Partner schedules signed by the partner, waiting for you.</p></header>
        ${p.countersign.length ? html`<ul class="small">${p.countersign.map((s) => html`<li>${s.organisation}: ${s.title} <span class="muted">signed ${fmtDate(s.partner_signed_at)}</span></li>`)}</ul><a class="btn secondary small" href="#/c/${c.id}/agreements">Countersign</a>`
          : html`<p class="muted small">Nothing waiting.</p>`}</section>
      <section class="dcard half"><header class="dcard-head"><h2>Risk register</h2><p>Open risks by band after action.</p></header>
        <p>${Object.entries(p.risks.by_band || {}).map(([b, n]) => html`<span class="doc-chip">${b}: <strong>${n}</strong></span> `)}</p>
        <p class="small muted">${p.risks.awaiting_review} awaiting review · ${p.risks.safeguarding_flags} safeguarding concerns reported in returns in the last 12 months</p><a href="#/c/${c.id}/risks">Open the register</a></section>
      <section class="dcard half"><header class="dcard-head"><h2>Next board meeting</h2></header>
        ${p.next_board ? html`<p><strong>${p.next_board.title}</strong>, ${fmtDate(p.next_board.due_on)}</p>${p.next_board.notes ? html`<p class="small muted">${p.next_board.notes}</p>` : ''}` : html`<p class="muted small">No board meeting in the key dates.</p>`}
        ${p.board_papers.length ? html`<p class="small">Papers: ${p.board_papers.map((x) => x.title).join(' · ')}</p>` : ''}</section>
      ${p.own ? html`<section class="dcard full"><header class="dcard-head"><h2>Your own delivery</h2><p>${p.own.organisation.name} as a delivery partner.</p></header>
        <p class="small">${p.own.actions.length} action${p.own.actions.length === 1 ? '' : 's'} · ${p.own.targets.length} target${p.own.targets.length === 1 ? '' : 's'} · return ${(p.own.return.return?.status || p.own.return.status).replace('_', ' ')}</p>
        ${ro ? '' : html`<a class="btn secondary small" href="#/c/${c.id}/mine">Open My organisation</a>`}</section>` : ''}
    </div>`;
}

function bindProgramme(ctx, el, p, again) {
  const c = ctx.consortium.id;
  $$('[data-approve]', el).forEach((b) => b.addEventListener('click', () => act(b, async () => { must(await db.rpc('approve_payment', { p_line: b.dataset.approve })); toast('Approved for payment. The partner is told.'); again(); })));
  $$('[data-record]', el).forEach((b) => b.addEventListener('click', () => {
    const d = openDrawer(`Record payment: ${b.dataset.label}`, html`<form class="form" id="rp-form"><p class="small muted">Record a payment you have already made. The portal never moves money.</p>
      <div class="fields"><label class="f">Amount (£)<input name="amount" type="number" step="0.01" min="0.01" required value="${b.dataset.amount}"></label>
        <label class="f">Date paid<input type="date" name="paid_on" required value="${today()}" max="${today()}"></label></div>
      <label class="f">Payment reference<input name="reference" required maxlength="120"></label><div class="btns"><button class="btn">Record payment</button></div></form>`);
    $('#rp-form', d).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => { const f = formData(e.target);
      must(await db.rpc('record_payment', { p_line: b.dataset.record, p_amount: Number(f.amount), p_paid_on: f.paid_on, p_reference: f.reference })); d.close(); toast('Recorded. The partner is told by email.'); again(); }); });
  }));
  $$('[data-inv]', el).forEach((b) => b.addEventListener('click', () => act(b, async () => {
    must(await db.from('invoices').update({ status: b.dataset.st, reviewed_by: ctx.user.id, reviewed_at: new Date().toISOString() }).eq('id', b.dataset.inv)); again();
  })));
  const orgs = ctx.orgs.filter((o) => ['delivery_partner', 'accountable_body', 'lead'].includes(o.kind));
  $('#add-line', el)?.addEventListener('click', () => {
    const d = openDrawer('Add to the payment schedule', html`<form class="form" id="pl-form">
      <label class="f">Partner<select name="org" required>${orgs.map((o) => html`<option value="${o.id}">${o.name}</option>`)}</select></label>
      <label class="f">Kind<select name="kind"><option value="quarterly">Quarterly payment</option><option value="mobilisation">Mobilisation payment (due on sub-contract signature)</option><option value="final">Final payment</option><option value="other">Other</option></select></label>
      <label class="f">Label<input name="label" required maxlength="120" placeholder="For example Year 1, quarter 2"></label>
      <div class="fields"><label class="f">Year<input type="number" name="year" min="1" max="10" value="1"></label><label class="f">Quarter<input type="number" name="quarter" min="1" max="4"></label></div>
      <div class="fields"><label class="f">Released by the return for<input type="month" name="month"></label><label class="f">Due<input type="date" name="due"></label></div>
      <label class="f">Amount (£)<input type="number" name="amount" step="0.01" min="0" required></label><div class="btns"><button class="btn">Add</button></div></form>`);
    $('#pl-form', d).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => { const f = formData(e.target);
      must(await db.from('payment_schedule').insert({ consortium_id: c, organisation_id: f.org, kind: f.kind, label: f.label, year: f.year ? Number(f.year) : null, quarter: f.quarter ? Number(f.quarter) : null,
        period_month: f.kind === 'mobilisation' || !f.month ? null : `${f.month}-01`, due_date: f.due || null, amount: Number(f.amount) })); d.close(); again(); }); });
  });
  const claimForm = (x = {}) => html`<form class="form" id="cl-form"><label class="f">Claim<input name="label" required maxlength="120" value="${x.label || ''}" placeholder="For example First six-month claim"></label>
    <div class="fields"><label class="f">Claim due<input type="date" name="due" value="${x.due_date || ''}"></label><label class="f">Evidence deadline<input type="date" name="ev" value="${x.evidence_deadline || ''}"></label></div>
    <div class="fields"><label class="f">Amount claimed (£)<input type="number" step="0.01" name="claimed" value="${x.amount_claimed ?? ''}"></label>
      <label class="f">Status<select name="status">${['planned', 'submitted', 'received', 'queried'].map((s) => html`<option ${x.status === s ? 'selected' : ''}>${s}</option>`)}</select></label></div>
    <div class="fields"><label class="f">Amount received (£)<input type="number" step="0.01" name="received" value="${x.amount_received ?? ''}"></label><label class="f">Received on<input type="date" name="received_on" value="${x.received_on || ''}"></label></div>
    <div class="btns"><button class="btn">Save</button></div></form>`;
  const readClaim = (f) => ({ label: f.label, due_date: f.due || null, evidence_deadline: f.ev || null, amount_claimed: f.claimed === '' ? null : Number(f.claimed), status: f.status,
    amount_received: f.received === '' ? null : Number(f.received), received_on: f.received_on || null, submitted_on: f.status !== 'planned' ? today() : null });
  $('#add-claim', el)?.addEventListener('click', () => { const d = openDrawer('Add a claim', claimForm());
    $('#cl-form', d).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => { must(await db.from('funder_claims').insert({ consortium_id: c, ...readClaim(formData(e.target)) })); d.close(); again(); }); }); });
  $$('[data-claim]', el).forEach((b) => b.addEventListener('click', () => { const x = p.finance.claims.find((y) => y.id === b.dataset.claim); const d = openDrawer(x.label, claimForm(x));
    $('#cl-form', d).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => { must(await db.from('funder_claims').update(readClaim(formData(e.target))).eq('id', x.id)); d.close(); again(); }); }); }));
}

// ------------------------------------------------------------------- tier 3

export async function master(ctx, el) {
  const c = ctx.consortium;
  const v = must(await db.rpc('master_view', { p_consortium: c.id }));
  const tab = ui(ctx).mtab || 'drive';
  const h = v.health;
  const partners = ctx.orgs.filter((o) => ['delivery_partner', 'accountable_body', 'lead'].includes(o.kind));
  render(el, html`
    <div class="page-head"><div><span class="eyebrow">Shvft2.0 view</span><h1>Dashboard</h1><p class="meta-line">${c.name} · everything across all partners</p>
      <p style="margin-top:8px">${liveMark()}</p></div>
      <div class="btns">${ctx.lw?.roles?.length ? html`<a class="btn secondary" href="#/c/${c.id}/lw/week">Lead Workspace</a>` : ''}</div></div>
    <div class="stats stats-4">
      ${statCard({ icon: 'returns', value: h.missing_returns.length, label: 'Returns missing', trend: { dir: 'flat', tone: h.missing_returns.length ? 'red' : 'green', text: `for ${fmtMonth(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 15).toISOString().slice(0, 10))}` } })}
      ${statCard({ icon: 'submitted', value: h.to_review, label: 'Returns to review', trend: { dir: 'flat', tone: h.to_review ? 'amber' : 'green', text: 'submitted, waiting for you' } })}
      ${statCard({ icon: 'safeguarding', value: h.risks_to_review, label: 'Risks to review', trend: { dir: 'flat', tone: h.risks_to_review ? 'amber' : 'green', text: 'raised by partners' } })}
      ${statCard({ icon: 'spreadsheet', value: (h.weekly || []).reduce((n, w) => n + w.missing, 0), label: 'Weeks missing', trend: { dir: 'flat', tone: (h.weekly || []).some((w) => w.missing) ? 'amber' : 'green', text: 'weekly uploads, last 4 weeks' } })}</div>
    ${segControl('mtab', [['drive', 'Drive'], ['health', 'Data health'], ['programme', 'Programme'], ['settings', 'Settings'], ['viewas', 'View as']], tab)}
    <div id="mbody"></div>`);
  bindSegments(el);
  $$('[data-seg-for="mtab"] [data-seg]', el).forEach((b) => b.addEventListener('click', () => { ui(ctx).mtab = b.dataset.seg; master(ctx, el); }));
  const body = $('#mbody', el);
  const again = () => master(ctx, el);
  if (tab === 'programme') return programme(ctx, body, [], v.programme);
  if (tab === 'health') return health(ctx, body, v, again);
  if (tab === 'settings') return settings(ctx, body, v.settings || {}, again);
  if (tab === 'viewas') return viewAs(ctx, body, partners);
  return drive(ctx, body, v, partners, again);
}

function drive(ctx, el, v, partners, again) {
  const c = ctx.consortium.id;
  const open = v.actions.filter((a) => a.status === 'open');
  render(el, html`<div class="dgrid">
    <section class="dcard full"><header class="dcard-head"><h2>Actions issued</h2><p>Give any organisation or person an action; it lands on their dashboard and by email.</p></header>
      <div class="btns"><button class="btn" id="issue">${raw(icon('add', 16))}Issue an action</button></div>
      ${open.length ? html`<ul class="lw-list" style="margin-top:12px">${open.map((a) => html`<li class="lw-row static"><span class="lw-row-main"><strong>${a.title}</strong>
        <span class="muted small">${a.assignee_name || a.organisation}${a.due_date ? ` · due ${fmtDate(a.due_date)}` : ''} · ${KIND[a.kind]}</span></span>
        <span class="lw-row-tags">${a.due_date && a.due_date < today() ? pill('red', 'Overdue', 'overdue') : ''}<button type="button" class="btn secondary small" data-chase-org="${a.organisation_id || ''}" data-chase-person="${a.assignee || ''}" data-chase-title="${a.title}">Chase</button></span></li>`)}</ul>`
        : html`<p class="muted small" style="margin-top:12px">No open actions.</p>`}</section>
    <section class="dcard full"><header class="dcard-head"><h2>Controls</h2><p>Where each lever lives.</p></header>
      <ul class="lw-list">
        <li><a class="lw-row" href="#/c/${c}/returns"><span class="lw-row-main"><strong>Approve or send back returns</strong><span class="muted small">${v.health.to_review} waiting</span></span></a></li>
        <li><a class="lw-row" href="#/c/${c}/targets"><span class="lw-row-main"><strong>Set and version targets</strong><span class="muted small">Changing a target makes a new version partners confirm</span></span></a></li>
        <li><a class="lw-row" href="#/c/${c}/hub"><span class="lw-row-main"><strong>Publish the Summary</strong></span></a></li>
        <li><a class="lw-row" href="#/c/${c}/dashboard"><span class="lw-row-main"><strong>Publish the Dashboard and set the funder view</strong><span class="muted small">Edit mode on the dashboard chooses what the funder sees</span></span></a></li>
        <li><a class="lw-row" href="#/c/${c}/risks"><span class="lw-row-main"><strong>Review raised risks</strong><span class="muted small">${v.health.risks_to_review} waiting</span></span></a></li>
      </ul></section></div>`);
  $('#issue', el).addEventListener('click', () => {
    const d = openDrawer('Issue an action', html`<form class="form" id="ia-form">
      <label class="f">To<select name="org" required><option value="">Choose an organisation</option>${partners.map((o) => html`<option value="${o.id}">${o.name}</option>`)}</select></label>
      <label class="f">Kind<select name="kind">${Object.entries(KIND).map(([k, t]) => html`<option value="${k}">${t}</option>`)}</select></label>
      <label class="f">What needs doing<input name="title" required maxlength="200"></label>
      <label class="f">Detail <span class="muted small">(optional; no young people's details)</span><textarea name="detail" rows="3" maxlength="2000"></textarea></label>
      <label class="f">Due<input type="date" name="due"></label><div class="btns"><button class="btn">Issue</button></div></form>`);
    $('#ia-form', d).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => { const f = formData(e.target);
      must(await db.from('partner_actions').insert({ consortium_id: c, organisation_id: f.org, kind: f.kind, title: f.title, detail: f.detail || null, due_date: f.due || null }));
      d.close(); toast('Issued. They are told by email.'); again(); }); });
  });
  bindChase(ctx, el);
}

function bindChase(ctx, el) {
  $$('[data-chase-org]', el).forEach((b) => b.addEventListener('click', () => {
    const d = openDrawer('Chase', html`<form class="form" id="ch-form"><label class="f">Message<textarea name="msg" rows="4" required>${b.dataset.chaseTitle ? `A reminder about: ${b.dataset.chaseTitle}.` : 'A reminder that your return is due.'}</textarea></label>
      <p class="small muted">Sent by email and shown in their portal notifications.</p><div class="btns"><button class="btn">Send</button></div></form>`);
    $('#ch-form', d).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => {
      must(await db.rpc('chase', { p_consortium: ctx.consortium.id, p_org: b.dataset.chaseOrg || null, p_person: b.dataset.chasePerson || null, p_message: formData(e.target).msg }));
      d.close(); toast('Sent.'); }); });
  }));
}

function health(ctx, el, v) {
  const h = v.health;
  render(el, html`
    ${sectionGroup({ title: 'Missing returns', meta: `${h.missing_returns.length} for last month`, open: true, body: h.missing_returns.length ? html`<ul class="lw-list">${h.missing_returns.map((x) => html`<li class="lw-row static">
      <span class="lw-row-main"><strong>${x.name}</strong><span class="muted small">${x.status === 'none' ? 'Not started' : x.status.replace('_', ' ')}</span></span>
      <span class="lw-row-tags"><button type="button" class="btn secondary small" data-chase-org="${x.organisation_id}" data-chase-person="" data-chase-title="">Chase</button></span></li>`)}</ul>` : html`<p class="muted small">Every return is in.</p>` })}
    ${sectionGroup({ title: 'Weekly uploads', meta: `${(h.weekly || []).filter((w) => w.missing || w.attention).length} partners need a look`, open: true, body: html`<div class="table-wrap"><table><thead><tr><th>Partner</th><th>Last confirmed week</th><th class="num">Missing (last 4)</th><th class="num">Needs attention</th><th></th></tr></thead>
      <tbody>${(h.weekly || []).map((w) => html`<tr><td>${w.organisation}</td><td>${w.last_week ? fmtDate(w.last_week) : html`<span class="muted small">None yet</span>`}</td>
        <td class="num ${w.missing ? 'warn-text' : ''}">${w.missing}</td><td class="num">${w.attention}</td>
        <td>${w.missing ? html`<button type="button" class="btn secondary small" data-chase-org="${w.organisation_id}" data-chase-person="" data-chase-title="your weekly figures">Chase</button>` : ''}</td></tr>`)}</tbody></table></div>` })}
    ${sectionGroup({ title: 'Targets with no data this year', meta: `${h.no_data.length}`, body: h.no_data.length ? html`<ul class="small">${h.no_data.map((x) => html`<li>${headline(x.label)}${x.organisation ? ` · ${x.organisation}` : ''} <span class="muted">${x.source.replace('_', ' ')}</span></li>`)}</ul>` : html`<p class="muted small">Every target has figures.</p>` })}`);
  bindChase(ctx, el);
}

function settings(ctx, el, s, again) {
  const mins = s.targeted_minimum_by_year || {};
  render(el, html`<form class="form panel" id="ws-form">
    <h2>Workspace settings</h2>
    <fieldset><legend>Reporting</legend><div class="fields">
      <label class="f">Reporting period<select name="reporting_frequency">${['monthly', 'quarterly'].map((x) => html`<option ${s.reporting_frequency === x ? 'selected' : ''}>${x}</option>`)}</select></label>
      <label class="f">Year starts in month<input type="number" name="reporting_period_start" min="1" max="12" value="${s.reporting_period_start ?? 4}"></label>
      <label class="f">Return due, days after the period<input type="number" name="return_due_days_after_period" min="1" max="60" value="${s.return_due_days_after_period ?? 10}"></label>
      <label class="f">Reminder, days before due<input type="number" name="reminder_days_before_due" min="0" max="30" value="${s.reminder_days_before_due ?? 3}"></label></div></fieldset>
    <fieldset><legend>Ratings and privacy</legend><div class="fields">
      <label class="f">Green at or above (% of profile)<input type="number" name="green" min="0" max="200" value="${Math.round((s.rag_green_ratio ?? 0.95) * 100)}"></label>
      <label class="f">Amber at or above (% of profile)<input type="number" name="amber" min="0" max="200" value="${Math.round((s.rag_amber_ratio ?? 0.8) * 100)}"></label>
      <label class="f">Suppress counts below<input type="number" name="small_number_suppression_threshold" min="0" max="20" value="${s.small_number_suppression_threshold ?? 5}"></label></div></fieldset>
    <fieldset><legend>Targeted share, minimum by year (%)</legend><div class="fields">${[1, 2, 3].map((y) => html`<label class="f">Year ${y}<input type="number" step="0.1" name="min_${y}" value="${mins[y] ?? s.targeted_minimum_percent ?? ''}"></label>`)}</div></fieldset>
    <fieldset><legend>Payments and the funder</legend><div class="fields">
      <label class="f">Payment terms (days)<input type="number" name="payment_terms_days" min="0" max="120" value="${s.payment_terms_days ?? 30}"></label>
      <label class="check"><input type="checkbox" name="payment_in_arrears" ${s.payment_in_arrears ? 'checked' : ''}> Paid in arrears</label>
      <label class="check"><input type="checkbox" name="funder_can_see_finance" ${s.funder_can_see_finance ? 'checked' : ''}> The funder sees consortium finance totals</label>
      <label class="check"><input type="checkbox" name="funder_can_see_partner_detail" ${s.funder_can_see_partner_detail ? 'checked' : ''}> The funder sees each partner's detail</label></div></fieldset>
    <div class="btns"><button class="btn">Save settings</button></div></form><div id="dbs-box"></div>`);
  $('#ws-form', el).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => {
    const f = formData(e.target);
    const byYear = Object.fromEntries([1, 2, 3].filter((y) => f[`min_${y}`] !== '').map((y) => [String(y), Number(f[`min_${y}`])]));
    must(await db.from('workspace_settings').update({ reporting_frequency: f.reporting_frequency, reporting_period_start: Number(f.reporting_period_start),
      return_due_days_after_period: Number(f.return_due_days_after_period), reminder_days_before_due: Number(f.reminder_days_before_due),
      rag_green_ratio: Number(f.green) / 100, rag_amber_ratio: Number(f.amber) / 100, small_number_suppression_threshold: Number(f.small_number_suppression_threshold),
      targeted_minimum_by_year: byYear, payment_terms_days: Number(f.payment_terms_days), payment_in_arrears: !!f.payment_in_arrears,
      funder_can_see_finance: !!f.funder_can_see_finance, funder_can_see_partner_detail: !!f.funder_can_see_partner_detail }).eq('consortium_id', ctx.consortium.id));
    toast('Settings saved.'); again(); }); });
  dbsSettings(ctx, $('#dbs-box', el));
  weeklySettings(ctx, el);
}

// Programmes, and how each target fills from the weekly uploads.
const WEEKLY_FIELDS = ['sessions_delivered', 'total_attendances', 'unique_young_people', 'new_to_consortium', 'new_to_organisation', 'returning_young_people', 'targeted_unique',
  'targeted_attendances', 'referrals_made', 'referrals_received', 'outreach_hours', 'surveys_completed', 'matched_pre_post_pairs'];
const AGG = [['sum', 'Sum of the weeks'], ['latest', 'Latest week'], ['ratio', 'Share (one field over another)']];
export async function weeklySettings(ctx, el) {
  const c = ctx.consortium.id;
  const box = document.createElement('div');
  el.append(box);
  const [progs, cms, maps] = await Promise.all([
    db.from('programmes').select('*').eq('consortium_id', c).order('name').then(must),
    db.from('commitments').select('id, label, year, period, kind, measure, data_source, organisation_id').eq('consortium_id', c).is('superseded_by', null).is('retired_at', null).eq('kind', 'output').order('year').order('label').then(must),
    db.from('target_mappings').select('*').eq('consortium_id', c).then(must),
  ]);
  const map = (id) => maps.find((m) => m.commitment_id === id) || {};
  const years = [...new Set(cms.map((k) => (k.period === 'lifetime' ? 'Whole programme' : `Year ${k.year}`)))];
  const row = (k) => { const m = map(k.id); return html`<tr data-k="${k.id}"><td>${headline(k.label)}${k.organisation_id ? html` <span class="muted small">${ctx.org(k.organisation_id)?.name || ''}</span>` : ''}</td>
    <td><select name="src">${[['weekly_upload', 'Weekly uploads'], ['return_manual', 'Typed in the return'], ['evidence_upload', 'Figure with evidence']].map(([v, l]) => html`<option value="${v}" ${k.data_source === v ? 'selected' : ''}>${l}</option>`)}</select></td>
    <td><select name="field"><option value="">–</option>${WEEKLY_FIELDS.map((f) => html`<option value="${f}" ${m.source_field === f ? 'selected' : ''}>${f.replace(/_/g, ' ')}</option>`)}</select></td>
    <td><select name="agg">${AGG.map(([v, l]) => html`<option value="${v}" ${(m.aggregation || 'sum') === v ? 'selected' : ''}>${l}</option>`)}</select>
      <select name="den" aria-label="Divided by"><option value="">divided by…</option>${['unique_young_people', 'total_attendances'].map((f) => html`<option value="${f}" ${m.denominator_field === f ? 'selected' : ''}>${f.replace(/_/g, ' ')}</option>`)}</select></td>
    <td><select name="kinds"><option value="">All programmes</option>${['universal', 'targeted', 'specialist'].map((x) => html`<option value="${x}" ${(m.programme_kinds || [])[0] === x ? 'selected' : ''}>${x} only</option>`)}</select></td>
    <td><button type="button" class="btn secondary small" data-save-map>Save</button></td></tr>`; };
  render(box, html`<section class="panel" style="margin-top:20px"><h2>Programmes</h2>
      <p class="small muted">Weekly uploads name a site and a programme. Universal, targeted or specialist decides which targets a programme's figures count towards.</p>
      <ul class="lw-list">${progs.map((p) => html`<li class="lw-row static"><span class="lw-row-main"><strong>${p.name}</strong></span><span class="lw-row-tags">${pill(p.kind === 'universal' ? 'blue' : 'grey', p.kind)}</span></li>`)}</ul>
      <form class="form" id="prog-form"><div class="fields"><label class="f">Programme<input name="name" required maxlength="120"></label>
        <label class="f">Kind<select name="kind"><option value="universal">Universal</option><option value="targeted">Targeted</option><option value="specialist">Specialist</option></select></label></div>
        <div class="btns"><button class="btn secondary">Add programme</button></div></form></section>
    <section class="panel" style="margin-top:20px"><h2>How weekly figures count</h2>
      <p class="small muted">For each target filled from the weekly uploads: which column counts, how the weeks add up, and which programmes. For example, unique young people in universal provision is the sum of new to the consortium, universal only. Changes re-count every confirmed week.</p>
      ${years.map((y, i) => { const ks = cms.filter((k) => (k.period === 'lifetime' ? 'Whole programme' : `Year ${k.year}`) === y); return sectionGroup({ title: y, meta: `${ks.filter((k) => map(k.id).source_field).length} of ${ks.length} mapped`, open: i === 0,
        body: html`<div class="table-wrap"><table><thead><tr><th>Target</th><th>Filled from</th><th>Column</th><th>Adds up as</th><th>Programmes</th><th></th></tr></thead><tbody>${ks.map(row)}</tbody></table></div>` }); })}</section>`);
  $('#prog-form', box).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => {
    const f = formData(e.target); must(await db.from('programmes').insert({ consortium_id: c, name: f.name.trim(), kind: f.kind })); toast('Programme added.'); box.remove(); weeklySettings(ctx, el);
  }); });
  $$('[data-save-map]', box).forEach((b) => b.addEventListener('click', () => act(b, async () => {
    const tr = b.closest('tr'); const v = (n) => tr.querySelector(`[name=${n}]`).value;
    const k = cms.find((x) => x.id === tr.dataset.k);
    if (v('src') !== k.data_source) { must(await db.from('commitments').update({ data_source: v('src') }).eq('id', k.id)); k.data_source = v('src'); }
    if (v('src') === 'weekly_upload' && v('field')) {
      if (v('agg') === 'ratio' && !v('den')) throw new Error('A share needs a column to divide by.');
      must(await db.from('target_mappings').upsert({ commitment_id: k.id, consortium_id: c, source_field: v('field'), aggregation: v('agg'), denominator_field: v('agg') === 'ratio' ? v('den') : null,
        programme_kinds: v('kinds') ? [v('kinds')] : null, updated_by: ctx.user.id, updated_at: new Date().toISOString() }));
    } else if (map(k.id).source_field) {
      must(await db.from('target_mappings').delete().eq('commitment_id', k.id));
    }
    toast('Saved. Confirmed weeks are re-counted.');
  })));
}

function viewAs(ctx, el, partners) {
  render(el, html`<section class="panel"><h2>View as</h2><p class="small muted">See exactly what someone else sees. Read only, and every preview is logged.</p>
    <form class="form" id="va-form"><div class="fields">
      <label class="f">Whose view<select name="who"><option value="partner">A partner</option><option value="lead_org">The lead organisation</option><option value="funder">The funder</option></select></label>
      <label class="f">Organisation<select name="org">${partners.filter((o) => o.kind !== 'lead').map((o) => html`<option value="${o.id}">${o.name}</option>`)}</select></label>
      <label class="f">As<select name="role"><option value="partner_manager">Partner manager (no money)</option><option value="finance">Finance (with money)</option><option value="org_admin">Org admin (with money)</option><option value="hub_worker">Hub worker</option></select></label></div>
      <div class="btns"><button class="btn">Preview</button></div></form></section><div id="va-out"></div>`);
  $('#va-form', el).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => {
    const f = formData(e.target);
    const out = $('#va-out', el);
    if (f.who === 'partner') {
      must(await db.rpc('log_view_as', { p_consortium: ctx.consortium.id, p_kind: 'partner', p_org: f.org, p_role: f.role }));
      const d = must(await db.rpc('my_organisation', { p_consortium: ctx.consortium.id, p_org: f.org, p_as_role: f.role }));
      d.pack = must(await db.rpc('assurance_pack', { p_consortium: ctx.consortium.id, p_org: f.org }))[0]?.items || [];
      render(out, html`<div class="viewas-frame">${partnerView(ctx, d)}</div>`);
    } else if (f.who === 'lead_org') {
      must(await db.rpc('log_view_as', { p_consortium: ctx.consortium.id, p_kind: 'lead_org' }));
      const p = must(await db.rpc('lead_org_dashboard', { p_consortium: ctx.consortium.id }));
      render(out, html`<div class="viewas-frame">${programmeView(ctx, p, true)}</div>`);
    } else {
      must(await db.rpc('log_view_as', { p_consortium: ctx.consortium.id, p_kind: 'funder' }));
      const [fin, layout] = await Promise.all([db.rpc('funder_finance', { p_consortium: ctx.consortium.id }).then(must), db.rpc('dashboard_layout', { p_consortium: ctx.consortium.id }).then(must)]);
      const settings = (await db.from('workspace_settings').select('funder_can_see_finance, funder_can_see_partner_detail').eq('consortium_id', ctx.consortium.id).maybeSingle()).data || {};
      render(out, html`<div class="viewas-frame"><div class="lead-banner viewas"><span><strong>Viewing as the funder.</strong> Read only.</span></div>
        <section class="panel"><h2>What the funder sees</h2>
        <p>Dashboard panels: ${(layout?.published?.funder || []).join(', ') || 'the default funder panels'}.</p>
        <p>Partner detail: ${settings.funder_can_see_partner_detail ? 'shown' : 'totals only'}.</p>
        <p>Finance: ${settings.funder_can_see_finance && fin ? `grant ${money(fin.grant)}, claimed ${money(fin.claimed)}, received ${money(fin.received)}, paid to partners ${money(fin.paid_to_partners)}` : 'not shown'}.</p>
        <p class="small muted">Approved returns only, never a partner's money or members.</p></section></div>`);
    }
    // Nothing in a preview can be changed: every control is inert.
    $$('.viewas-frame button, .viewas-frame input, .viewas-frame select, .viewas-frame textarea', out).forEach((x) => { x.disabled = true; });
    $$('.viewas-frame a', out).forEach((a) => { a.removeAttribute('href'); a.setAttribute('aria-disabled', 'true'); });
  }); });
}
