// Monthly partner returns: drafted by the partner, numbers filled from the
// register on submission, reviewed by the lead with a red, amber or green
// rating. Every step is stamped with who and when.
import { db, html, raw, render, $, formData, toast, act, must, icon, pill, fmtMonth, fmtDateTime, fmtNum, rag, statusPill, emptyState, downloadCsv } from '../lib.js';
import { chart, hbars } from '../charts.js';

// The steps of a return, each with its icon.
const STEPS = [['attendance', 'Numbers'], ['bids', 'Report'], ['submitted', 'Submit'], ['approved', 'Review']];
const stepOf = (status) => ({ draft: 1, changes_requested: 1, submitted: 3, approved: 4 }[status] ?? 0);

const lastMonth = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); };
const COUNTS = [['reached', 'New young people'], ['targeted', 'Of whom targeted'], ['sessions', 'Sessions'], ['attendances', 'Attendances'], ['outcomes', 'Outcomes']];

export default async function returns(ctx, el, [returnId]) {
  if (returnId) return detail(ctx, el, returnId);
  const c = ctx.consortium;
  const all = must(await db.from('returns').select('*').eq('consortium_id', c.id).order('period_month', { ascending: false }));
  const mine = all.filter((r) => r.organisation_id === ctx.orgId);
  const queue = all.filter((r) => r.status === 'submitted');
  const canDraft = ['partner_manager', 'accountable_body', 'lead'].includes(ctx.role) && ctx.orgId;

  const table = (rows, showOrg) => html`<div class="table-wrap"><table class="cards">
    <thead><tr><th>Month</th>${showOrg ? html`<th>Partner</th>` : ''}<th>Status</th><th>Rating</th><th class="num">New</th><th class="num">Attendances</th><th>Submitted</th></tr></thead>
    <tbody>${rows.map((r) => html`<tr><td class="nowrap"><a href="#/c/${c.id}/returns/${r.id}">${fmtMonth(r.period_month)}</a></td>
      ${showOrg ? html`<td data-label="Partner">${ctx.org(r.organisation_id)?.name}</td>` : ''}
      <td data-label="Status">${statusPill(r.status)}</td><td data-label="Rating">${r.rag ? rag(r.rag) : ''}</td>
      <td class="num" data-label="New">${fmtNum(r.reached_count)}</td><td class="num" data-label="Attendances">${fmtNum(r.attendances_count)}</td>
      <td class="small nowrap" data-label="Submitted">${fmtDateTime(r.submitted_at)}</td></tr>`)}</tbody></table></div>`;

  render(el, html`
    <div class="page-head"><div><span class="eyebrow m-compliance">${raw(icon('returns', 16))}Returns</span><h1>Monthly returns</h1>
      <p>${ctx.role === 'funder_observer' ? 'Returns the consortium lead has approved.' : 'One return per partner a month, with numbers taken from the register.'}</p></div>
      ${ctx.seesAll || ctx.role === 'funder_observer' ? html`<div class="btns"><button class="btn secondary" id="export">${raw(icon('download', 18))}Export</button></div>` : ''}</div>
    ${ctx.manages && queue.length ? html`<section class="panel m-compliance" style="margin-bottom:24px"><h2>${raw(icon('submitted', 20))}Waiting for your review (${queue.length})</h2>${table(queue, true)}</section>` : ''}
    ${canDraft ? html`<section class="panel m-compliance" style="margin-bottom:24px"><header><h2>${raw(icon('returns', 20))}${ctx.orgName}'s returns</h2></header>
      <form class="form" id="start" style="margin-top:12px"><div class="fields">
        <label class="f">Month<input type="month" name="month" value="${lastMonth()}" required></label></div>
        <div class="btns"><button class="btn">${raw(icon('add', 18))}Start return</button></div></form>
      ${mine.length ? html`<div style="margin-top:16px">${table(mine, false)}</div>` : ''}</section>` : ''}
    ${ctx.seesAll || ctx.role === 'funder_observer' ? html`<section class="panel m-compliance"><h2>${raw(icon('returns', 20))}All returns</h2>
      ${all.length ? table(all, true) : emptyState('returns', 'No returns yet.', '', 'compliance')}</section>` : ''}`);

  $('#export')?.addEventListener('click', () => downloadCsv(`${c.name} returns.csv`, all.map((r) => ({
    Month: r.period_month.slice(0, 7), Partner: ctx.org(r.organisation_id)?.name, Status: r.status, Rating: r.rag || '',
    'New young people': r.reached_count, 'Of whom targeted': r.targeted_count, Sessions: r.sessions_count,
    Attendances: r.attendances_count, Outcomes: r.outcomes_count, 'Safeguarding concerns raised': r.safeguarding_concerns,
    Risks: r.risks || '', Narrative: r.narrative || '', Submitted: r.submitted_at || '', Reviewed: r.reviewed_at || '',
  }))));

  $('#start')?.addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      const period = `${formData(e.target).month}-01`;
      const existing = mine.find((r) => r.period_month === period);
      const id = existing?.id || must(await db.from('returns').insert({ consortium_id: c.id, organisation_id: ctx.orgId, period_month: period }).select('id').single()).id;
      location.hash = `#/c/${c.id}/returns/${id}`;
    });
  });
}

async function detail(ctx, el, id) {
  const c = ctx.consortium;
  const r = must(await db.from('returns').select('*').eq('id', id).maybeSingle());
  if (!r) { render(el, html`<div class="panel">That return isn't available to you.</div>`); return; }
  const editable = r.organisation_id === ctx.orgId && ['draft', 'changes_requested'].includes(r.status) && ctx.role !== 'funder_observer';
  const [counts, targets] = await Promise.all([
    editable ? db.rpc('return_preview', { p_return: id }).then(must) : {
      reached: r.reached_count, targeted: r.targeted_count, sessions: r.sessions_count, attendances: r.attendances_count, outcomes: r.outcomes_count,
    },
    db.from('commitments').select('measure, year, period, target').eq('consortium_id', c.id).eq('organisation_id', r.organisation_id)
      .is('superseded_by', null).is('retired_at', null).eq('period', 'year').then(must),
  ]);
  // This month against a monthly share of the organisation's own yearly target.
  const year = c.start_date ? Math.floor(((new Date(`${r.period_month}T12:00:00`) - new Date(`${c.start_date}T12:00:00`)) / 864e5) / 365.25) + 1 : null;
  const monthly = (k) => { const t = targets.filter((x) => x.measure === k && x.year === year).reduce((s, x) => s + Number(x.target), 0); return t ? t / 12 : null; };
  const rows = COUNTS.filter(([k]) => k !== 'outcomes' || counts?.outcomes).map(([k, label]) => {
    const n = Number(counts?.[k] || 0);
    const t = monthly(k);
    const share = t ? (100 * n) / t : null;
    return { label, sub: t ? `Monthly target ${fmtNum(Math.round(t))}` : 'No monthly target for this organisation', pct: share,
      tone: share == null ? 'grey' : share >= 95 ? 'green' : share >= 80 ? 'amber' : 'red', marker: t ? 100 : null,
      value: share == null ? fmtNum(n) : `${fmtNum(n)} · ${fmtNum(Math.round(share))}%`,
      // Bars are green; a shortfall shows as a pill, not a bar colour.
      pill: share != null && share < 95 ? pill(share >= 80 ? 'amber' : 'red', 'Below target', 'overdue') : '' };
  });
  const withTarget = rows.filter((x) => x.marker != null);
  const met = withTarget.filter((x) => x.tone === 'green').length;
  const step = stepOf(r.status);

  render(el, html`
    <p class="small" style="margin-bottom:16px"><a href="#/c/${c.id}/returns">← All returns</a></p>
    <div class="page-head"><div><span class="eyebrow m-compliance">${raw(icon('returns', 16))}${ctx.org(r.organisation_id)?.name}</span><h1>${fmtMonth(r.period_month)} return</h1>
      <p style="display:flex;gap:8px;flex-wrap:wrap">${statusPill(r.status)} ${r.rag ? rag(r.rag) : ''}</p></div></div>
    <ol class="stepper" aria-label="Return steps">${STEPS.map(([ic, label], i) => html`<li class="${i < step ? 'done' : i === step ? 'current' : ''}" ${raw(i === step ? 'aria-current="step"' : '')}>
      <span class="dot">${raw(icon(i < step ? 'check' : ic, 20))}</span>${label}</li>`)}</ol>
    ${r.status === 'changes_requested' && r.review_note ? html`<div class="banner warn" style="margin-bottom:24px">${raw(icon('returned', 20))}<span><strong>Changes requested:</strong> ${r.review_note}</span></div>` : ''}
    <section class="panel m-compliance"><header><h2>${raw(icon('attendance', 20))}Numbers for the month</h2>${editable ? html`<span class="small muted">Live from the register, fixed when you submit</span>` : ''}</header>
      ${chart(withTarget.length ? `${met} of ${withTarget.length} measure${withTarget.length === 1 ? '' : 's'} at or above the monthly target.` : `${ctx.org(r.organisation_id)?.name} has no monthly targets of its own, so these are counts.`,
        withTarget.length ? 'This month against a twelfth of the yearly target. The tick is the monthly target.' : '', hbars(rows))}
    </section>
    ${editable ? html`<section class="panel m-compliance"><h2>${raw(icon('bids', 20))}Your report</h2>
      <form class="form" id="ret">
        <div class="fields"><label class="f">Safeguarding concerns raised this month<input type="number" name="safeguarding_concerns" min="0" value="${r.safeguarding_concerns}" required></label></div>
        <label class="f">Reference numbers<span class="hint">Your own safeguarding reference for each concern, separated by commas. Never names or case details: those stay in your safeguarding system with your DSL.</span>
          <input name="safeguarding_refs" value="${r.safeguarding_refs || ''}"></label>
        <label class="f">Risks and issues<textarea name="risks">${r.risks || ''}</textarea></label>
        <label class="f">Narrative<span class="hint">What went well, what didn't, and anything the lead should know.</span><textarea name="narrative" required>${r.narrative || ''}</textarea></label>
        <div class="btns"><button class="btn secondary" name="save" value="1" formnovalidate>Save draft</button><button class="btn" name="submit" value="1">${raw(icon('submitted', 18))}Submit return</button></div>
      </form></section>`
    : html`<section class="panel m-compliance"><h2>${raw(icon('bids', 20))}Report</h2>
      <dl class="facts">
        <dt>Safeguarding concerns</dt><dd>${r.safeguarding_concerns}${r.safeguarding_refs ? ` (refs: ${r.safeguarding_refs})` : ''}</dd>
        <dt>Risks and issues</dt><dd class="prose">${r.risks || '–'}</dd>
        <dt>Narrative</dt><dd class="prose">${r.narrative || '–'}</dd>
        <dt>Submitted</dt><dd>${fmtDateTime(r.submitted_at) || '–'}</dd>
        ${r.reviewed_at ? html`<dt>Reviewed</dt><dd>${fmtDateTime(r.reviewed_at)}${r.review_note ? html`<br><span class="muted">${r.review_note}</span>` : ''}</dd>` : ''}
      </dl></section>`}
    ${ctx.manages && r.status === 'submitted' ? html`<section class="panel m-compliance"><h2>${raw(icon('approved', 20))}Review</h2>
      <p class="helper">Amber means a conversation; a second amber or any red opens an improvement plan.</p>
      <form class="form" id="review" style="margin-top:12px">
        <fieldset><legend>Rating</legend><div class="checks">
          <label class="check"><input type="radio" name="rag" value="green"> Green, on track</label>
          <label class="check"><input type="radio" name="rag" value="amber"> Amber, some concern</label>
          <label class="check"><input type="radio" name="rag" value="red"> Red, off track</label></div></fieldset>
        <label class="f">Note to the partner<span class="hint">Needed if you ask for changes.</span><textarea name="note"></textarea></label>
        <div class="btns"><button class="btn" name="decision" value="approved">Approve</button><button class="btn secondary" name="decision" value="changes_requested">Ask for changes</button></div>
      </form></section>` : ''}`);

  $('#ret')?.addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      const { safeguarding_concerns, safeguarding_refs, risks, narrative } = formData(e.target);
      must(await db.from('returns').update({ safeguarding_concerns, safeguarding_refs, risks, narrative }).eq('id', id));
      if (e.submitter.name === 'submit') {
        must(await db.rpc('submit_return', { p_return: id }));
        toast('Submitted to the lead.');
      } else toast('Draft saved.');
      detail(ctx, el, id);
    });
  });
  $('#review')?.addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      const f = formData(e.target);
      must(await db.rpc('review_return', { p_return: id, p_decision: e.submitter.value, p_rag: f.rag || null, p_note: f.note }));
      toast(e.submitter.value === 'approved' ? 'Approved.' : 'Sent back for changes.');
      detail(ctx, el, id);
    });
  });
}
