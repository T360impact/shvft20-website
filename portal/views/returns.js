// Monthly partner returns: drafted by the partner, numbers filled from the
// register on submission, reviewed by the lead with a red, amber or green
// rating. Every step is stamped with who and when.
import { db, html, render, $, formData, toast, act, must, fmtMonth, fmtDateTime, fmtNum, rag, statusPill, downloadCsv } from '../lib.js';

const lastMonth = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); };
const COUNTS = [['reached', 'New young people'], ['targeted', 'Of whom targeted'], ['sessions', 'Sessions'], ['attendances', 'Attendances'], ['outcomes', 'Outcomes']];

export default async function returns(ctx, el, [returnId]) {
  if (returnId) return detail(ctx, el, returnId);
  const c = ctx.consortium;
  const all = must(await db.from('returns').select('*').eq('consortium_id', c.id).order('period_month', { ascending: false }));
  const mine = all.filter((r) => r.organisation_id === ctx.orgId);
  const queue = all.filter((r) => r.status === 'submitted');
  const canDraft = ['partner_manager', 'accountable_body', 'lead'].includes(ctx.role) && ctx.orgId;

  const table = (rows, showOrg) => html`<div class="table-wrap"><table>
    <thead><tr><th>Month</th>${showOrg ? html`<th>Partner</th>` : ''}<th>Status</th><th>Rating</th><th class="num">New</th><th class="num">Attendances</th><th>Submitted</th></tr></thead>
    <tbody>${rows.map((r) => html`<tr><td class="nowrap"><a href="#/c/${c.id}/returns/${r.id}">${fmtMonth(r.period_month)}</a></td>
      ${showOrg ? html`<td>${ctx.org(r.organisation_id)?.name}</td>` : ''}
      <td>${statusPill(r.status)}</td><td>${r.rag ? rag(r.rag) : ''}</td>
      <td class="num">${fmtNum(r.reached_count)}</td><td class="num">${fmtNum(r.attendances_count)}</td>
      <td class="small nowrap">${fmtDateTime(r.submitted_at)}</td></tr>`)}</tbody></table></div>`;

  render(el, html`
    <div class="page-head"><div><span class="eyebrow">Partner returns</span><h1>Monthly returns</h1>
      <p class="muted">${ctx.role === 'funder_observer' ? 'Returns the consortium lead has approved.' : 'One return per partner each month. The numbers come from the register when you submit, so they always match the data.'}</p></div>
      ${ctx.seesAll || ctx.role === 'funder_observer' ? html`<button class="btn secondary" id="export">Export to Excel (CSV)</button>` : ''}</div>
    ${ctx.manages && queue.length ? html`<section class="panel" style="margin-bottom:20px"><h2>Waiting for your review (${queue.length})</h2>${table(queue, true)}</section>` : ''}
    ${canDraft ? html`<section class="panel" style="margin-bottom:20px"><header><h2>${ctx.orgName}'s returns</h2></header>
      <form class="form" id="start" style="margin-top:12px"><div class="fields">
        <label class="f">Month<input type="month" name="month" value="${lastMonth()}" required></label></div>
        <div class="btns"><button class="btn">Start this month's return</button></div></form>
      ${mine.length ? html`<div style="margin-top:16px">${table(mine, false)}</div>` : ''}</section>` : ''}
    ${ctx.seesAll || ctx.role === 'funder_observer' ? html`<section class="panel"><h2>All returns</h2>
      ${all.length ? table(all, true) : html`<p class="empty">No returns yet.</p>`}</section>` : ''}`);

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
  const counts = editable ? must(await db.rpc('return_preview', { p_return: id })) : {
    reached: r.reached_count, targeted: r.targeted_count, sessions: r.sessions_count, attendances: r.attendances_count, outcomes: r.outcomes_count,
  };

  render(el, html`
    <p class="small" style="margin-bottom:10px"><a href="#/c/${c.id}/returns">← All returns</a></p>
    <div class="page-head"><div><span class="eyebrow">${ctx.org(r.organisation_id)?.name}</span><h1>${fmtMonth(r.period_month)} return</h1>
      <p style="margin-top:8px">${statusPill(r.status)} ${r.rag ? rag(r.rag) : ''}</p></div></div>
    ${r.status === 'changes_requested' && r.review_note ? html`<div class="banner warn" style="margin-bottom:20px"><strong>Changes requested:</strong> ${r.review_note}</div>` : ''}
    <section class="panel"><header><h2>Numbers for the month</h2>${editable ? html`<span class="muted small">Live from the register. Fixed when you submit.</span>` : ''}</header>
      <div class="stats" style="margin-top:12px">${COUNTS.map(([k, label]) => html`<div class="stat"><b>${fmtNum(counts?.[k])}</b><span>${label}</span></div>`)}</div>
    </section>
    ${editable ? html`<section class="panel" style="margin-top:20px"><h2>Your report</h2>
      <form class="form" id="ret">
        <div class="fields"><label class="f">Safeguarding concerns raised this month<input type="number" name="safeguarding_concerns" min="0" value="${r.safeguarding_concerns}" required></label></div>
        <label class="f">Reference numbers<span class="hint">Your own safeguarding reference for each concern, separated by commas. Never names or case details: those stay in your safeguarding system with your DSL.</span>
          <input name="safeguarding_refs" value="${r.safeguarding_refs || ''}"></label>
        <label class="f">Risks and issues<textarea name="risks">${r.risks || ''}</textarea></label>
        <label class="f">Narrative<span class="hint">What went well, what didn't, and anything the lead should know.</span><textarea name="narrative" required>${r.narrative || ''}</textarea></label>
        <div class="btns"><button class="btn secondary" name="save" value="1" formnovalidate>Save draft</button><button class="btn" name="submit" value="1">Submit to the lead</button></div>
      </form></section>`
    : html`<section class="panel" style="margin-top:20px"><h2>Report</h2>
      <dl class="facts">
        <dt>Safeguarding concerns</dt><dd>${r.safeguarding_concerns}${r.safeguarding_refs ? ` (refs: ${r.safeguarding_refs})` : ''}</dd>
        <dt>Risks and issues</dt><dd class="prose">${r.risks || '–'}</dd>
        <dt>Narrative</dt><dd class="prose">${r.narrative || '–'}</dd>
        <dt>Submitted</dt><dd>${fmtDateTime(r.submitted_at) || '–'}</dd>
        ${r.reviewed_at ? html`<dt>Reviewed</dt><dd>${fmtDateTime(r.reviewed_at)}${r.review_note ? html`<br><span class="muted">${r.review_note}</span>` : ''}</dd>` : ''}
      </dl></section>`}
    ${ctx.manages && r.status === 'submitted' ? html`<section class="panel" style="margin-top:20px"><h2>Review</h2>
      <p class="muted small">An amber rating means a conversation. A second amber or any red opens an improvement plan.</p>
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
