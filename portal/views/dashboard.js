// Live dashboard: progress against every commitment to the funder. Headline
// numbers first, then a bar per target coloured by its rating, the targeted
// share against the funder's minimum, reach over time and a tile per
// partner. Figures come from consortium_progress(), which returns counts
// only; a target's details open in a drawer.
import { db, html, raw, render, $, $$, must, icon, pill, fmtNum, fmtMoney, rag, fmtMonth, downloadCsv, statCard, emptyState, openDrawer, MEASURE_LABEL } from '../lib.js';
import { chart, hbars, donut, ring, lineChart, initials } from '../charts.js';

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

  // One bar per target: achieved against target, coloured by rating, with a
  // tick where it should be by now.
  const targetChart = (y) => {
    const rows = period(y);
    const onTrack = rows.filter((x) => x.rag === 'green').length;
    const reported = rows.filter((x) => x.source).length;
    const current = y === 'lifetime' || (rows[0]?.year_start <= today && today < rows[0]?.year_end);
    const takeaway = !reported ? 'Nothing reported against these targets yet.'
      : `${onTrack} of ${rows.length} target${rows.length === 1 ? ' is' : 's are'} on track${rows.length - reported ? `; ${rows.length - reported} not reported yet` : ''}.`;
    return html`<section class="panel m-delivery"><header><h2>${raw(icon('targets', 20))}${y === 'lifetime' ? 'Project lifetime' : `Year ${y}`}</h2>
      <span class="small muted">${current ? `${Math.round(rows[0].elapsed * 100)}% of the way through` : rows[0].year_start > today ? 'Not started' : 'Finished'}</span></header>
      ${chart(takeaway, 'Achieved against target. The tick shows where each should be by today.', hbars(rows.map((x) => {
        const share = x.target ? (100 * x.actual) / x.target : 0;
        return {
          id: x.id, label: x.label, sub: [x.section, x.organisation].filter(Boolean).join(' · '),
          pct: isPct(x) ? x.actual : share, tone: x.source ? TONE[x.rag] : 'grey',
          marker: x.source && !isPct(x) && x.target ? (100 * x.expected) / x.target : isPct(x) ? x.target : null,
          value: x.source ? `${fmtNum(x.actual)}${pct(x)} of ${fmtNum(x.target)}${pct(x)}${isPct(x) ? '' : ` · ${fmtNum(Math.round(share))}%`}` : `Target ${fmtNum(x.target)}${pct(x)}`,
          pill: x.source ? rag(x.rag) : pill('grey', 'Not reported', 'waiting'),
        };
      })))}</section>`;
  };

  // Targeted share against the funder's minimum.
  const share = figure(p, 'targeted_pct');
  const min = c.targeted_share_target;
  // New young people and attendances by month.
  const anyMonths = months.some((m) => m.reached || m.attendances);
  const totalAtt = months.reduce((s, m) => s + (m.attendances || 0), 0);
  const totalNew = months.reduce((s, m) => s + (m.reached || 0), 0);
  // Partner tiles: the latest return's rating and two delivery figures.
  const partnerFig = (o, m) => (o[m] || p.commitments.filter((x) => x.measure === m).reduce((s, x) => s + (x.by_org || []).filter((b) => b.organisation_id === o.id).reduce((t, b) => t + Number(b.value), 0), 0));
  const RING = { green: ['var(--green)', 100], amber: ['var(--amber)', 66], red: ['var(--red)', 33] };

  render(el, html`
    <div class="page-head"><div><span class="eyebrow m-brand">${raw(icon('dashboard', 16))}Dashboard</span><h1>Are we on track?</h1>
      <p>Progress against every target, from partner reports and the register.</p></div>
      ${ctx.role !== 'youth_voice' ? html`<div class="btns"><button class="btn secondary" id="x-commit">${raw(icon('download', 18))}Export targets</button>
        <button class="btn secondary" id="x-quarters">${raw(icon('download', 18))}Quarters</button></div>` : ''}</div>
    ${!c.allow_real_records ? html`<div class="banner warn" style="margin-bottom:24px">${raw(icon('info', 20))}<span><strong>Demo mode.</strong> ${fromReports(p)
      ? 'Figures come from partner reports; the register holds made-up records only.' : 'Register figures come from made-up records.'}</span></div>` : ''}

    <div class="stats">${headline(p).map(statCard)}</div>

    <div class="section"><h2>Targets</h2>
      ${periods.length ? html`<div class="stack">${periods.map(targetChart)}</div>`
      : html`<section class="panel">${emptyState('targets', 'No targets confirmed yet.', ctx.manages ? html`<a class="btn" href="#/c/${c.id}/targets">${raw(icon('targets', 18))}Set targets</a>` : '', 'delivery')}</section>`}</div>

    <div class="section"><h2>Reach</h2><div class="grid2 split">
      <section class="panel m-surveys"><header><h2>${raw(icon('targets', 20))}Targeted share</h2></header>
        ${share == null ? emptyState('youngPeople', 'No targeted share reported yet.', '', 'surveys')
        : chart(min == null ? `${fmtNum(share)}% of young people are from targeted groups.` : share >= min ? `${fmtNum(share)}% targeted, at or above the ${fmtNum(min)}% minimum.` : `${fmtNum(share)}% targeted, below the ${fmtNum(min)}% minimum.`,
          'Targeted against universal young people. The black tick is the funder\'s minimum.',
          html`<div style="display:flex;flex-wrap:wrap;gap:24px;align-items:center">${donut(share, { marker: min, label: 'targeted' })}
            <div class="key" style="display:grid;gap:8px"><span><i style="background:var(--m-surveys)"></i>Targeted ${fmtNum(share)}%</span>
              <span><i style="background:var(--m-delivery);opacity:.35"></i>Universal ${fmtNum(100 - share)}%</span>
              ${min != null ? html`<span><i style="background:var(--text)"></i>Minimum ${fmtNum(min)}%</span>` : ''}</div></div>`)}</section>
      <section class="panel m-delivery"><header><h2>${raw(icon('outcomes', 20))}Reach over time</h2></header>
        ${anyMonths ? chart(`${fmtNum(totalNew)} new young people and ${fmtNum(totalAtt)} attendances so far.`, 'New young people and attendances by month',
          lineChart(months.map((m) => shortMonth.format(new Date(`${m.month.slice(0, 10)}T12:00:00`))), [
            { name: 'Attendances', color: 'var(--m-delivery)', values: months.map((m) => m.attendances || 0) },
            { name: 'New young people', color: 'var(--m-surveys)', values: months.map((m) => m.reached || 0) }]))
        : emptyState('outcomes', 'Nothing recorded yet. Monthly figures appear here as partners report.', '', 'delivery')}</section>
    </div></div>

    ${p.partners.length ? html`<div class="section"><header><h2>${p.partners.length > 1 ? 'Partners' : ctx.orgName}</h2>
      ${p.partners.length > 1 ? html`<button class="btn secondary small" id="x-partners">${raw(icon('download', 16))}Export</button>` : ''}</header>
      <div class="tiles">${p.partners.map((o) => {
        const r = o.latest_return?.status === 'approved' ? o.latest_return.rag : null;
        const [col, fill] = RING[r] || ['var(--grey)', 0];
        return html`<article class="panel tile"><span class="avatar" aria-hidden="true">${initials(o.name)}</span>
          <div style="min-width:0"><h3>${o.name}</h3><span class="small muted">${o.last_progress ? `Reported ${fmtMonth(o.last_progress)}` : 'No progress reported'}</span></div>
          ${ring(fill, { size: 48, stroke: 6, color: col, value: '', label: r ? `Latest return ${r}` : 'No rated return' })}
          <div class="figs"><div><b>${fmtNum(partnerFig(o, 'reached'))}</b><span>Young people</span></div><div><b>${fmtNum(partnerFig(o, 'attendances'))}</b><span>Attendances</span></div></div>
          <div style="grid-column:1/-1;display:flex;flex-wrap:wrap;gap:8px">${rag(r)}${o.escalation ? html`<span class="pill tone-${o.escalation === 'Conversation' ? 'amber' : 'red'}">${raw(icon('overdue', 14))}${o.escalation}</span>` : ''}</div></article>`;
      })}</div></div>` : ''}

    <div class="section">${byOrganisation(ctx, p, budgets)}</div>

    <div class="section"><details class="add"><summary>${raw(icon('sessions', 18))}Quarterly view for the funder's return</summary>
      ${p.quarters.length ? html`<div class="table-wrap"><table class="cards">
        <thead><tr><th>Quarter</th><th class="num">New young people</th><th class="num">Targeted %</th><th class="num">Sessions</th><th class="num">Attendances</th><th class="num">Outcomes</th></tr></thead>
        <tbody>${p.quarters.map((q) => html`<tr><td class="nowrap"><strong>${q.label}</strong></td>
          <td class="num" data-label="New young people">${fmtNum(q.reached)}</td><td class="num" data-label="Targeted %">${q.reached ? `${fmtNum((100 * q.targeted) / q.reached)}%` : '–'}</td>
          <td class="num" data-label="Sessions">${fmtNum(q.sessions)}</td><td class="num" data-label="Attendances">${fmtNum(q.attendances)}</td><td class="num" data-label="Outcomes">${fmtNum(q.outcomes)}</td></tr>`)}</tbody></table></div>`
      : html`<p class="empty">Delivery hasn't started yet.</p>`}</details></div>`);

  // A target's details in a drawer.
  $$('.hbar[data-id]').forEach((row) => {
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
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
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
