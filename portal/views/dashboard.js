// Live dashboard: progress against every commitment to the funder. Headline
// numbers first, then a bar per target coloured by its rating, the targeted
// share against the funder's minimum, reach over time and a tile per
// partner. Figures come from consortium_progress(), which returns counts
// only; a target's details open in a drawer.
import { db, html, raw, render, $, $$, must, icon, pill, headline as shortLabel, fmtNum, fmtMoney, rag, fmtMonth, downloadCsv, statCard, emptyState, openDrawer, MEASURE_LABEL } from '../lib.js';
import { chart, lineChart, initials } from '../charts.js';

const KIND = { output: 'Output', outcome: 'Outcome' };
const SOURCE = { reported: 'From partner reports', records: 'From the register' };
const isPct = (x) => x.unit === '%' || x.measure === 'targeted_pct';
const TONE = { green: 'green', amber: 'amber', red: 'red', grey: 'grey' };
const shortMonth = new Intl.DateTimeFormat('en-GB', { month: 'short', year: '2-digit' });

// Until there are records in the register, the headline figures are what
// partners have reported.
const fromReports = (p) => p.reported?.any && !p.totals.reached && !p.totals.sessions && !p.totals.attendances;
const figure = (p, k) => (fromReports(p) ? p.reported[k] : p.totals[k]);

// Headline stat cards, each with a trend against this year's target.
export function headline(p) {
  const today = new Date().toISOString().slice(0, 10);
  const thisYear = (m) => p.commitments.find((x) => x.measure === m && x.period === 'year' && !x.organisation_id && x.year_start <= today && today < x.year_end);
  const trend = (m) => {
    const k = thisYear(m);
    if (!k || !k.source) return k ? { dir: 'flat', tone: 'grey', text: 'Nothing reported yet' } : null;
    const share = k.target ? Math.round((100 * k.actual) / k.target) : 0;
    return { dir: { green: 'up', amber: 'flat', red: 'down' }[k.rag] || 'flat', tone: TONE[k.rag] || 'grey', text: `${share}% of the year ${k.year} target` };
  };
  const min = p.consortium?.targeted_share_target;
  const share = figure(p, 'targeted_pct');
  return [
    { icon: 'youngPeople', mod: 'delivery', value: fmtNum(figure(p, 'reached') || 0), label: 'Young people reached', trend: trend('reached') },
    { icon: 'attendance', mod: 'delivery', value: fmtNum(figure(p, 'attendances') || 0), label: 'Attendances', trend: trend('attendances') },
    { icon: 'sessions', mod: 'delivery', value: fmtNum(figure(p, 'sessions') || 0), label: 'Sessions', trend: trend('sessions') },
    { icon: 'targets', mod: 'surveys', value: share == null ? '–' : `${fmtNum(share)}%`, label: 'Targeted share',
      trend: share == null || min == null ? null : share >= min ? { dir: 'up', tone: 'green', text: `At or above the ${fmtNum(min)}% minimum` } : { dir: 'down', tone: 'red', text: `Below the ${fmtNum(min)}% minimum` } },
  ];
}

// Outputs and outcomes linked to each organisation, as the programme
// documents (or the lead) connect them, with each organisation's budget.
function byOrganisation(ctx, p, budgets) {
  const orgs = ctx.orgs.filter((o) => ['lead', 'accountable_body', 'delivery_partner'].includes(o.kind));
  const lines = p.commitments.filter((x) => x.kind);
  const linkedTo = (o) => lines.filter((x) => (x.links || []).includes(o.id));
  const rows = orgs.map((o) => ({ o, outputs: linkedTo(o).filter((x) => x.kind === 'output').length, outcomes: linkedTo(o).filter((x) => x.kind === 'outcome').length, budget: budgets[o.id] }))
    .filter((r) => r.outputs + r.outcomes || r.budget != null).sort((a, b) => b.outputs + b.outcomes - (a.outputs + a.outcomes));
  const max = Math.max(1, ...rows.map((r) => r.outputs + r.outcomes));
  if (!lines.length) return '';
  const top = rows[0];
  return html`<section class="panel m-governance"><header><h2>${raw(icon('partners', 20))}Who the targets link to</h2></header>
    ${rows.some((r) => r.outputs + r.outcomes) ? html`${chart(top ? `${top.o.name} is linked to the most targets: ${top.outputs + top.outcomes}.` : '', 'Outputs and outcomes each organisation is named against, from the programme documents', html`
      <div class="org-bars">${rows.map((r) => html`<div class="org-bar">
        <span class="name">${r.o.name}</span>
        <span class="track" role="img" aria-label="${r.outputs} outputs and ${r.outcomes} outcomes">
          ${r.outputs ? html`<span class="seg-output" style="width:${(100 * r.outputs) / max}%"></span>` : ''}${r.outcomes ? html`<span class="seg-outcome" style="width:${(100 * r.outcomes) / max}%"></span>` : ''}</span>
        <span class="vals">${r.outputs} output${r.outputs === 1 ? '' : 's'} · ${r.outcomes} outcome${r.outcomes === 1 ? '' : 's'}${r.budget != null ? ` · ${fmtMoney(r.budget)}` : ''}</span>
      </div>`)}</div>`)}
      <details class="learn" style="margin-top:16px"><summary>${raw(icon('chevron', 16))}See each link</summary>
        <div class="table-wrap" style="margin-top:12px"><table class="matrix">
          <thead><tr><th>Output or outcome</th><th class="num">Target</th>${orgs.map((o) => html`<th class="org">${o.name}</th>`)}</tr></thead>
          <tbody>${lines.map((x) => html`<tr><td class="lbl"><strong>${x.label}</strong><br><span class="small muted">${[KIND[x.kind], x.section, x.period === 'lifetime' ? 'Project lifetime' : `Year ${x.year}`].filter(Boolean).join(' · ')}</span></td>
            <td class="num">${fmtNum(x.target)}${x.unit === '%' ? '%' : ''}</td>
            ${orgs.map((o) => html`<td class="dot">${(x.links || []).includes(o.id) ? html`<span role="img" aria-label="linked">●</span>` : ''}</td>`)}</tr>`)}</tbody>
        </table></div></details>`
    : emptyState('partners', 'No targets are linked to an organisation yet.', '', 'governance')}
  </section>`;
}

export default async function dashboard(ctx, el) {
  const c = ctx.consortium;
  const [p, months, alloc] = await Promise.all([
    db.rpc('consortium_progress', { p_consortium: c.id }).then(must),
    db.rpc('consortium_months', { p_consortium: c.id }).then(must),
    ctx.role === 'youth_voice' ? [] : db.from('allocations').select('organisation_id, amount').eq('consortium_id', c.id).is('superseded_by', null).is('retired_at', null).then(must),
  ]);
  const budgets = {};
  for (const a of alloc) if (a.organisation_id) budgets[a.organisation_id] = (budgets[a.organisation_id] || 0) + Number(a.amount);
  const periods = [...new Set(p.commitments.map((x) => (x.period === 'lifetime' ? 'lifetime' : x.year)))]
    .sort((a, b) => (a === 'lifetime') - (b === 'lifetime') || a - b);
  const pct = (m) => (isPct(m) ? '%' : '');
  const reportedBy = (x) => (x.by_org || []).map((b) => `${ctx.org(b.organisation_id)?.name} ${fmtNum(b.value)}${pct(x)}`).join(' · ');
  const today = new Date().toISOString().slice(0, 10);
  const period = (y) => p.commitments.filter((x) => (y === 'lifetime' ? x.period === 'lifetime' : x.period !== 'lifetime' && x.year === y));

  // One row per target: the headline, and a slim green bar of achieved
  // against target with a mark where it should be by today. Status shows
  // only as a small pill.
  const targetRow = (x) => {
    const short = shortLabel(x.label);
    const share = x.target ? (100 * x.actual) / x.target : 0;
    return html`<li class="row">
      <div>${short !== x.label ? html`<details class="wording"><summary>${short}</summary><p>${x.label}</p></details>` : html`<span>${x.label}</span>`}
        <span class="muted">${[KIND[x.kind], x.section, x.organisation || 'Whole consortium', x.site, x.source ? SOURCE[x.source].toLowerCase() : 'nothing reported yet'].filter(Boolean).join(' · ')}</span>
        ${x.by_org?.length ? html`<span class="muted">Reported: ${reportedBy(x)}</span>` : ''}</div>
      <div class="row-end"><span class="figure"><span class="${x.source ? '' : 'not-yet'}">${x.source ? `${fmtNum(x.actual)}${pct(x)} of ${fmtNum(x.target)}${pct(x)}${isPct(x) ? '' : ` · ${fmtNum(Math.round(share))}%`}` : `Target ${fmtNum(x.target)}${pct(x)} · not yet reported`}</span>
          <span>${x.source ? rag(x.rag) : pill('grey', 'Not reported', 'waiting')}<button type="button" class="linkbtn small" data-id="${x.id}">Details</button></span></span>
        ${x.source ? html`<span class="slim" role="img" aria-label="${isPct(x) ? `${fmtNum(x.actual)}%` : `${fmtNum(Math.round(share))}% of the target`}"><span style="width:${Math.min(100, isPct(x) ? x.actual : share)}%"></span>
          ${isPct(x) ? html`<i style="left:${Math.min(100, x.target)}%"></i>` : x.target ? html`<i style="left:${Math.min(100, (100 * x.expected) / x.target)}%"></i>` : ''}</span>` : ''}</div></li>`;
  };
  const targetSection = (y) => {
    const rows = period(y);
    const onTrack = rows.filter((x) => x.source && x.rag === 'green').length;
    const reported = rows.filter((x) => x.source).length;
    const current = y === 'lifetime' || (rows[0]?.year_start <= today && today < rows[0]?.year_end);
    const note = [current ? `${Math.round(rows[0].elapsed * 100)}% of the way through` : rows[0].year_start > today ? 'Not started' : 'Finished',
      reported ? `${onTrack} of ${rows.length} on track` : 'nothing reported yet', reported && rows.length - reported ? `${rows.length - reported} not reported` : ''].filter(Boolean).join(' · ');
    return html`<section class="sec"><details class="period" open><summary><h2>${y === 'lifetime' ? 'Project lifetime' : `Year ${y}`}</h2>
      <span class="muted small">${note}</span></summary>
      ${reported ? html`<p class="muted small" style="margin-top:4px">The mark on each bar is where it should be by today.</p>` : ''}
      <ul class="rows" style="margin-top:8px">${rows.map(targetRow)}</ul></details></section>`;
  };

  // Targeted share against the funder's minimum.
  const share = figure(p, 'targeted_pct');
  const min = c.targeted_share_target;
  const anyMonths = months.some((m) => m.reached || m.attendances);
  const totalAtt = months.reduce((s, m) => s + (m.attendances || 0), 0);
  const totalNew = months.reduce((s, m) => s + (m.reached || 0), 0);
  const partnerFig = (o, m) => (o[m] || p.commitments.filter((x) => x.measure === m).reduce((s, x) => s + (x.by_org || []).filter((b) => b.organisation_id === o.id).reduce((t, b) => t + Number(b.value), 0), 0));
  const TREND = { green: 'trend-up', red: 'trend-down' };

  render(el, html`
    <div class="page-head"><div><span class="eyebrow">Dashboard</span><h1>Are we on track?</h1>
      <p>Progress against every target, from partner reports and the register.</p></div>
      ${ctx.role !== 'youth_voice' ? html`<div class="btns"><button class="btn secondary" id="x-commit">Export targets</button>
        <button class="btn secondary" id="x-quarters">Quarters</button></div>` : ''}</div>
    ${!c.allow_real_records ? html`<p class="note" style="margin-bottom:24px">Demo mode: ${fromReports(p) ? 'figures come from partner reports; the register holds made-up records only.' : 'register figures come from made-up records.'}</p>` : ''}

    <div class="band" role="group" aria-label="Headline figures">${headline(p).map((f) => html`<div><b>${f.value}</b><span>${f.label}</span>
      ${f.trend ? html`<span class="${TREND[f.trend.tone] || 'trend-flat'}">${f.trend.text}</span>` : ''}</div>`)}</div>

    ${periods.length ? periods.map(targetSection)
    : html`<section class="sec"><p class="note">No targets confirmed yet.${ctx.manages ? html` <a href="#/c/${c.id}/targets">Set targets</a>` : ''}</p></section>`}

    <section class="sec"><div class="sec-head"><h2>Reach</h2><p>Who the programme is reaching, and how that is changing month by month.</p></div>
      <div class="two-col">
        <div><h3 style="margin-bottom:4px">Targeted share</h3>
          ${share == null ? html`<p class="not-yet" style="padding-top:20px">Not yet reported${min != null ? `. The funder's minimum is ${fmtNum(min)}%.` : '.'}</p>`
          : html`<div style="padding-top:20px"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px"><strong style="font:400 30px/1 var(--display)">${fmtNum(share)}%</strong>
              ${min != null ? (share >= min ? pill('green', `At or above ${fmtNum(min)}%`, 'approved') : pill('amber', `Below ${fmtNum(min)}%`, 'overdue')) : ''}</div>
            <span class="slim" style="margin-top:12px" role="img" aria-label="${fmtNum(share)}% targeted${min != null ? `, minimum ${fmtNum(min)}%` : ''}"><span style="width:${Math.min(100, share)}%"></span>${min != null ? html`<i style="left:${min}%"></i>` : ''}</span>
            <p class="muted small" style="margin-top:8px">Targeted ${fmtNum(share)}% · Universal ${fmtNum(100 - share)}%${min != null ? ` · Minimum ${fmtNum(min)}% (the mark)` : ''}.</p></div>`}</div>
        <div><h3 style="margin-bottom:4px">Reach over time</h3>
          ${anyMonths ? chart(`${fmtNum(totalNew)} new young people and ${fmtNum(totalAtt)} attendances so far.`, '',
            lineChart(months.map((m) => shortMonth.format(new Date(`${m.month.slice(0, 10)}T12:00:00`))), [
              { name: 'Attendances', color: 'var(--series-1)', values: months.map((m) => m.attendances || 0) },
              { name: 'New young people', color: 'var(--series-2)', values: months.map((m) => m.reached || 0) }]))
          : html`<p class="not-yet" style="padding-top:20px">Nothing recorded yet.</p>`}</div>
      </div></section>

    ${p.partners.length ? html`<section class="sec"><div class="sec-head split-head"><div><h2>${p.partners.length > 1 ? 'Partners' : ctx.orgName}</h2>
      <p>Each partner's latest return and what they have reported.</p></div>
      ${p.partners.length > 1 ? html`<button class="btn secondary" id="x-partners">Export</button>` : ''}</div>
      <ul class="rows">${p.partners.map((o) => {
        const r = o.latest_return?.status === 'approved' ? o.latest_return.rag : null;
        return html`<li class="row"><div style="display:flex;gap:12px;align-items:flex-start"><span class="avatar-sm" aria-hidden="true">${initials(o.name)}</span>
            <div><strong>${o.name}</strong><span class="muted" style="display:block">${o.last_progress ? `Last reported ${fmtMonth(o.last_progress)}` : 'No progress reported yet'}</span></div></div>
          <div class="row-end"><span class="figure"><span>${fmtNum(partnerFig(o, 'reached'))} young people · ${fmtNum(partnerFig(o, 'attendances'))} attendances</span></span>
            <span style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">${rag(r)}${o.escalation ? pill(o.escalation === 'Conversation' ? 'amber' : 'red', o.escalation, 'overdue') : ''}</span></div></li>`;
      })}</ul></section>` : ''}

    <section class="sec"><div class="sec-head"><h2>Who the targets link to</h2><p>Outputs and outcomes each organisation is named against in the programme documents.</p></div>
      ${byOrganisation(ctx, p, budgets)}</section>
    <section class="sec" style="margin-top:32px"><details class="wording"><summary><h2 style="display:inline">Quarterly view</h2> <span class="muted small">Show</span></summary>
      ${p.quarters.length ? html`<div class="table-wrap" style="margin-top:16px"><table class="cards">
        <thead><tr><th>Quarter</th><th class="num">New young people</th><th class="num">Targeted %</th><th class="num">Sessions</th><th class="num">Attendances</th><th class="num">Outcomes</th></tr></thead>
        <tbody>${p.quarters.map((q) => html`<tr><td class="nowrap"><strong>${q.label}</strong></td>
          <td class="num" data-label="New young people">${fmtNum(q.reached)}</td><td class="num" data-label="Targeted %">${q.reached ? `${fmtNum((100 * q.targeted) / q.reached)}%` : '–'}</td>
          <td class="num" data-label="Sessions">${fmtNum(q.sessions)}</td><td class="num" data-label="Attendances">${fmtNum(q.attendances)}</td><td class="num" data-label="Outcomes">${fmtNum(q.outcomes)}</td></tr>`)}</tbody></table></div>`
      : html`<p class="not-yet" style="margin-top:12px">Delivery hasn't started yet.</p>`}</details></section>`);

  // A target's details in a drawer.
  $$('button[data-id]').forEach((row) => {
    const open = () => {
      const x = p.commitments.find((k) => k.id === row.dataset.id);
      openDrawer(x.label, html`<p>${x.source ? rag(x.rag) : pill('grey', 'Not reported', 'waiting')}</p><dl class="facts">
        <dt>Type</dt><dd>${[KIND[x.kind], x.section, x.period === 'lifetime' ? 'Project lifetime' : `Year ${x.year}`].filter(Boolean).join(' · ')}</dd>
        <dt>Who</dt><dd>${x.organisation || 'Whole consortium'}${x.site ? ` · ${x.site}` : ''}</dd>
        <dt>Target</dt><dd>${fmtNum(x.target)}${pct(x)}</dd>
        <dt>Due by now</dt><dd>${x.source ? `${fmtNum(x.expected)}${pct(x)}` : '–'}</dd>
        <dt>Achieved</dt><dd>${x.source ? `${fmtNum(x.actual)}${pct(x)}` : 'Nothing reported yet'}</dd>
        <dt>Source</dt><dd>${SOURCE[x.source] || '–'}${x.last_reported ? ` · latest ${fmtMonth(x.last_reported)}` : ''}</dd>
        ${x.by_org?.length ? html`<dt>Reported by</dt><dd>${reportedBy(x)}</dd>` : ''}
        ${x.links?.length ? html`<dt>Linked to</dt><dd>${x.links.map((id) => ctx.org(id)?.name).filter(Boolean).join(', ')}</dd>` : ''}
        <dt>Tracked as</dt><dd>${MEASURE_LABEL[x.measure]}</dd></dl>`);
    };
    row.addEventListener('click', open);
  });

  const name = c.name.replace(/[^\w ]+/g, '');
  $('#x-commit')?.addEventListener('click', () => downloadCsv(`${name} targets.csv`, p.commitments.map((x) => ({
    Period: x.period === 'lifetime' ? 'Project lifetime' : `Year ${x.year}`, Type: KIND[x.kind] || '', Section: x.section || '', Commitment: x.label, 'Tracked as': MEASURE_LABEL[x.measure],
    'Actual from': x.source === 'reported' ? 'Partner reports' : x.source === 'records' ? 'Register' : '', 'Reported by': reportedBy(x),
    'Linked organisations': (x.links || []).map((id) => ctx.org(id)?.name).filter(Boolean).join('; '), Who: x.organisation || 'Whole consortium', Site: x.site || '',
    Target: x.target, 'Due by now': x.expected, Actual: x.actual, Rating: x.rag,
  }))));
  $('#x-quarters')?.addEventListener('click', () => downloadCsv(`${name} quarters.csv`, p.quarters.map((q) => ({
    Quarter: q.label, 'New young people': q.reached, Targeted: q.targeted,
    'Targeted %': q.reached ? Math.round((1000 * q.targeted) / q.reached) / 10 : '', Sessions: q.sessions, Attendances: q.attendances, Outcomes: q.outcomes,
  }))));
  $('#x-partners')?.addEventListener('click', () => downloadCsv(`${name} partners.csv`, p.partners.map((o) => ({
    Partner: o.name, Reached: o.reached, 'Targeted %': o.targeted_pct ?? '', Sessions: o.sessions, Attendances: o.attendances,
    Outcomes: o.outcomes, 'Latest progress': o.last_progress ? o.last_progress.slice(0, 7) : '',
    'Latest return': o.latest_return ? `${o.latest_return.period.slice(0, 7)} ${o.latest_return.status}` : '',
    Rating: o.latest_return?.rag || '', Action: o.escalation || '',
  }))));
}
