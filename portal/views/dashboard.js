// Live dashboard: progress against every commitment to the funder, by
// partner, site and year, plus a quarterly view to copy into the funder's
// return. Figures come from consortium_progress(), which returns counts only.
import { db, html, render, $, must, fmtNum, fmtDate, fmtMoney, rag, statusPill, fmtMonth, downloadCsv, MEASURE_LABEL } from '../lib.js';

const KIND = { output: 'Output', outcome: 'Outcome' };

// Outputs and outcomes linked to each organisation, as the programme
// documents (or the lead) connect them, with each organisation's budget.
function byOrganisation(ctx, p, budgets) {
  const orgs = ctx.orgs.filter((o) => ['lead', 'accountable_body', 'delivery_partner'].includes(o.kind));
  const lines = p.commitments.filter((x) => x.kind);
  const linkedTo = (o) => lines.filter((x) => (x.links || []).includes(o.id));
  const rows = orgs.map((o) => ({ o, outputs: linkedTo(o).filter((x) => x.kind === 'output').length, outcomes: linkedTo(o).filter((x) => x.kind === 'outcome').length, budget: budgets[o.id] }));
  const max = Math.max(1, ...rows.map((r) => r.outputs + r.outcomes));
  const anyLinks = rows.some((r) => r.outputs + r.outcomes);
  if (!lines.length) return '';
  return html`<section class="panel" style="margin-top:20px"><header><h2>Outputs and outcomes by organisation</h2>
      <span class="muted small">Links come from the documents, or are added by the lead</span></header>
    ${anyLinks ? html`<div class="org-bars">${rows.map((r) => html`<div class="org-bar">
        <span class="name">${r.o.name}</span>
        <span class="track" role="img" aria-label="${r.outputs} outputs and ${r.outcomes} outcomes">
          <span class="seg-output" style="width:${(100 * r.outputs) / max}%"></span><span class="seg-outcome" style="width:${(100 * r.outcomes) / max}%"></span></span>
        <span class="vals">${r.outputs} output${r.outputs === 1 ? '' : 's'} · ${r.outcomes} outcome${r.outcomes === 1 ? '' : 's'}${r.budget != null ? ` · ${fmtMoney(r.budget)}` : ''}</span>
      </div>`)}</div>
      <div class="legend"><span><i style="background:var(--ink)"></i>Outputs</span><span><i style="background:var(--green-ink)"></i>Outcomes</span>${Object.keys(budgets).length ? html`<span>£ = budget allocated</span>` : ''}</div>
      <details style="margin-top:16px"><summary class="small"><strong>See which output or outcome each organisation is linked to</strong></summary>
        <div class="table-wrap" style="margin-top:10px"><table class="matrix">
          <thead><tr><th>Output or outcome</th><th class="num">Target</th>${orgs.map((o) => html`<th class="org">${o.name}</th>`)}</tr></thead>
          <tbody>${lines.map((x) => html`<tr><td class="lbl"><strong>${x.label}</strong><br><span class="small muted">${[KIND[x.kind], x.section, x.period === 'lifetime' ? 'Project lifetime' : `Year ${x.year}`].filter(Boolean).join(' · ')}</span></td>
            <td class="num">${fmtNum(x.target)}${x.unit === '%' ? '%' : ''}</td>
            ${orgs.map((o) => html`<td class="dot">${(x.links || []).includes(o.id) ? html`<span aria-label="linked">●</span>` : ''}</td>`)}</tr>`)}</tbody>
        </table></div></details>`
    : html`<p class="empty">No outputs or outcomes are linked to an organisation yet. When you review documents under Targets and budget, tick the organisations each line belongs to.</p>`}
  </section>`;
}

export default async function dashboard(ctx, el) {
  const c = ctx.consortium;
  const [p, alloc] = await Promise.all([
    db.rpc('consortium_progress', { p_consortium: c.id }).then(must),
    ctx.role === 'youth_voice' ? [] : db.from('allocations').select('organisation_id, amount').eq('consortium_id', c.id).is('superseded_by', null).is('retired_at', null).then(must),
  ]);
  const budgets = {};
  for (const a of alloc) if (a.organisation_id) budgets[a.organisation_id] = (budgets[a.organisation_id] || 0) + Number(a.amount);
  const t = p.totals;
  const periods = [...new Set(p.commitments.map((x) => (x.period === 'lifetime' ? 'lifetime' : x.year)))];
  const pct = (m) => (m.unit === '%' || m.measure === 'targeted_pct' ? '%' : '');

  render(el, html`
    <div class="page-head"><div><span class="eyebrow">Live dashboard</span><h1>Are we on track?</h1>
      <p class="muted">Every figure traces back to a record a partner entered. Ratings compare progress with where we should be by today.</p></div>
      ${ctx.role !== 'youth_voice' ? html`<div class="btns"><button class="btn secondary" id="x-commit">Export targets</button><button class="btn secondary" id="x-quarters">Export quarters</button></div>` : ''}</div>
    ${!c.allow_real_records ? html`<div class="banner warn" style="margin-bottom:20px"><strong>Demo mode.</strong> These figures come from made-up records.</div>` : ''}
    <div class="stats">
      <div class="stat"><b>${fmtNum(t.reached)}</b><span>Young people reached</span></div>
      <div class="stat"><b>${t.targeted_pct == null ? '–' : `${fmtNum(t.targeted_pct)}%`}</b><span>Targeted${c.targeted_share_target != null ? ` (aim ${fmtNum(c.targeted_share_target)}%)` : ''}</span></div>
      <div class="stat"><b>${fmtNum(t.sessions)}</b><span>Sessions</span></div>
      <div class="stat"><b>${fmtNum(t.attendances)}</b><span>Attendances</span></div>
      <div class="stat"><b>${fmtNum(t.outcomes)}</b><span>Outcomes</span></div>
    </div>

    ${byOrganisation(ctx, p, budgets)}

    ${periods.length ? periods.map((y) => {
      const rows = p.commitments.filter((x) => (y === 'lifetime' ? x.period === 'lifetime' : x.period !== 'lifetime' && x.year === y));
      return html`<section class="panel" style="margin-top:20px"><header><h2>${y === 'lifetime' ? 'Project lifetime' : `Year ${y}`}</h2>
        <span class="muted small">${fmtDate(rows[0].year_start)} to ${fmtDate(rows[0].year_end)} · ${Math.round(rows[0].elapsed * 100)}% through</span></header>
        <div class="table-wrap"><table>
          <thead><tr><th>Commitment</th><th>Who</th><th class="num">Target</th><th class="num">Due by now</th><th class="num">Actual</th><th>Progress</th><th>Rating</th></tr></thead>
          <tbody>${rows.map((x) => {
            const share = x.target ? Math.min(100, Math.round((x.actual / x.target) * 100)) : 0;
            const tracked = x.measure !== 'other' && x.measure !== 'outcomes';
            return html`<tr><td><strong>${x.label}</strong><br><span class="muted small">${[KIND[x.kind], x.section, tracked ? `tracked as ${MEASURE_LABEL[x.measure].toLowerCase()}` : 'not tracked automatically yet'].filter(Boolean).join(' · ')}</span></td>
              <td>${x.organisation || 'Whole consortium'}${x.site ? html`<br><span class="muted small">${x.site}</span>` : ''}</td>
              <td class="num">${fmtNum(x.target)}${pct(x)}</td><td class="num">${tracked ? `${fmtNum(x.expected)}${pct(x)}` : '–'}</td>
              <td class="num"><strong>${tracked ? `${fmtNum(x.actual)}${pct(x)}` : '–'}</strong></td>
              <td>${tracked ? html`<span class="bar-track" title="${share}% of the target"><span class="bar-fill" style="width:${share}%"></span></span>` : ''}</td>
              <td>${tracked ? rag(x.rag) : html`<span class="rag rag-grey">Not tracked</span>`}</td></tr>`;
          })}</tbody></table></div></section>`;
    }) : html`<section class="panel" style="margin-top:20px"><p class="empty">No commitments set yet.${ctx.manages ? ' Add them under Agreements.' : ''}</p></section>`}

    ${p.partners.length ? html`<section class="panel" style="margin-top:20px"><header><h2>${p.partners.length > 1 ? 'By partner' : ctx.orgName}</h2>
      ${p.partners.length > 1 ? html`<button class="btn small secondary" id="x-partners">Export</button>` : ''}</header>
      <div class="table-wrap"><table>
        <thead><tr><th>Partner</th><th class="num">Reached</th><th class="num">Targeted</th><th class="num">Sessions</th><th class="num">Attendances</th><th class="num">Outcomes</th><th>Latest return</th><th>Action</th></tr></thead>
        <tbody>${p.partners.map((o) => html`<tr><td><strong>${o.name}</strong></td>
          <td class="num">${fmtNum(o.reached)}</td><td class="num">${o.targeted_pct == null ? '–' : `${fmtNum(o.targeted_pct)}%`}</td>
          <td class="num">${fmtNum(o.sessions)}</td><td class="num">${fmtNum(o.attendances)}</td><td class="num">${fmtNum(o.outcomes)}</td>
          <td class="small">${o.latest_return ? html`${fmtMonth(o.latest_return.period)}<br>${statusPill(o.latest_return.status)} ${o.latest_return.rag ? rag(o.latest_return.rag) : ''}` : html`<span class="muted">None yet</span>`}</td>
          <td>${o.escalation ? html`<span class="rag ${o.escalation === 'Conversation' ? 'rag-amber' : 'rag-red'}">${o.escalation}</span>` : ''}</td></tr>`)}</tbody></table></div>
    </section>` : ''}

    <section class="panel" style="margin-top:20px"><header><h2>Quarterly view</h2><span class="muted small">Financial-year quarters, whole consortium</span></header>
      ${p.quarters.length ? html`<div class="table-wrap"><table>
        <thead><tr><th>Quarter</th><th class="num">New young people</th><th class="num">Targeted</th><th class="num">Targeted %</th><th class="num">Sessions</th><th class="num">Attendances</th><th class="num">Outcomes</th></tr></thead>
        <tbody>${p.quarters.map((q) => html`<tr><td class="nowrap"><strong>${q.label}</strong></td>
          <td class="num">${fmtNum(q.reached)}</td><td class="num">${fmtNum(q.targeted)}</td>
          <td class="num">${q.reached ? `${fmtNum((100 * q.targeted) / q.reached)}%` : '–'}</td>
          <td class="num">${fmtNum(q.sessions)}</td><td class="num">${fmtNum(q.attendances)}</td><td class="num">${fmtNum(q.outcomes)}</td></tr>`)}</tbody></table></div>`
      : html`<p class="empty">Delivery hasn't started yet.</p>`}
    </section>`);

  const name = c.name.replace(/[^\w ]+/g, '');
  $('#x-commit')?.addEventListener('click', () => downloadCsv(`${name} targets.csv`, p.commitments.map((x) => ({
    Period: x.period === 'lifetime' ? 'Project lifetime' : `Year ${x.year}`, Type: KIND[x.kind] || '', Section: x.section || '', Commitment: x.label, 'Tracked as': MEASURE_LABEL[x.measure],
    'Linked organisations': (x.links || []).map((id) => ctx.org(id)?.name).filter(Boolean).join('; '), Who: x.organisation || 'Whole consortium', Site: x.site || '',
    Target: x.target, 'Due by now': x.expected, Actual: x.actual, Rating: x.rag,
  }))));
  $('#x-quarters')?.addEventListener('click', () => downloadCsv(`${name} quarters.csv`, p.quarters.map((q) => ({
    Quarter: q.label, 'New young people': q.reached, Targeted: q.targeted,
    'Targeted %': q.reached ? Math.round((1000 * q.targeted) / q.reached) / 10 : '', Sessions: q.sessions, Attendances: q.attendances, Outcomes: q.outcomes,
  }))));
  $('#x-partners')?.addEventListener('click', () => downloadCsv(`${name} partners.csv`, p.partners.map((o) => ({
    Partner: o.name, Reached: o.reached, 'Targeted %': o.targeted_pct ?? '', Sessions: o.sessions, Attendances: o.attendances,
    Outcomes: o.outcomes, 'Latest return': o.latest_return ? `${o.latest_return.period.slice(0, 7)} ${o.latest_return.status}` : '',
    Rating: o.latest_return?.rag || '', Action: o.escalation || '',
  }))));
}
