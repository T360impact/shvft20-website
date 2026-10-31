// Live dashboard: the whole project's progress on one page. A programme
// clock, headline cards, a progress score, every target in a filterable
// table, then programmes, partners, outcomes, sites, alerts, reach and the
// funder's quarterly view. Figures come from consortium_progress() (counts
// only) and dashboard_extras(); a target's details open in a drawer.
//
// The lead can switch to edit mode: show, hide and reorder panels, pin
// headline cards, write a lead note, choose which panels the funder sees,
// then save a draft or publish. Every publish is a version that can be
// restored. Everyone else sees the published layout only.
import { db, html, raw, render, $, $$, must, act, toast, icon, pill, statusPill, fmtNum, fmtMoney, fmtDate, fmtDateTime, rag, fmtMonth, downloadCsv, statCard, openDrawer, headline as shortLabel, MEASURE_LABEL } from '../lib.js';
import { chart, lineChart, initials, ring } from '../charts.js';

const KIND = { output: 'Output', outcome: 'Outcome' };
const SOURCE = { reported: 'From partner reports', records: 'From the register' };
const isPct = (x) => x.unit === '%' || x.measure === 'targeted_pct';
const TONE = { green: 'green', amber: 'amber', red: 'red', grey: 'grey' };
const shortMonth = new Intl.DateTimeFormat('en-GB', { month: 'short', year: '2-digit' });

// Panels in their default order. Lead-only panels sit apart and can't be
// moved, hidden or shown to the funder.
const PANELS = {
  note: 'Lead note', stats: 'Headline figures', score: 'Progress score', alerts: 'Activity and alerts', targets: 'Targets',
  partners: 'Partners', sites: 'Sites', reach: 'Reach', links: 'Who the targets link to',
  outcomes: 'Outcomes', programmes: 'Programmes', quarters: "Quarterly view for the funder's return",
};
// Each panel is a card: full width, or half so two sit side by side.
const SIZE = { note: 'full', stats: 'full', targets: 'full', outcomes: 'full', programmes: 'full', quarters: 'full' };
const ORDER = Object.keys(PANELS);
const METRICS = { reached: 'Young people reached', attendances: 'Attendances', targeted: 'Targeted share', sessions: 'Sessions', surveys: 'Survey response rate', returns: 'Returns on time' };

// Until there are records in the register, the headline figures are what
// partners have reported.
const fromReports = (p) => p.reported?.any && !p.totals.reached && !p.totals.sessions && !p.totals.attendances;
const figure = (p, k) => (fromReports(p) ? p.reported[k] : p.totals[k]);

// Headline stat cards, each with a trend against this year's target. Home
// shows the same four.
export function headline(p) {
  const today = new Date().toISOString().slice(0, 10);
  const thisYear = (m) => p.commitments.find((x) => x.measure === m && x.period === 'year' && !x.organisation_id && x.year_start <= today && today < x.year_end);
  const trend = (m) => {
    const k = thisYear(m);
    if (!k || !k.source) return k ? { dir: 'flat', tone: 'grey', text: 'Nothing reported yet' } : null;
    if (!Number(k.actual)) return { dir: 'flat', tone: 'grey', text: `Year ${k.year} target ${fmtNum(k.target)}` };
    const share = k.target ? Math.round((100 * k.actual) / k.target) : 0;
    return { dir: { green: 'up', amber: 'flat', red: 'down' }[k.rag] || 'flat', tone: TONE[k.rag] || 'grey', chip: `${share}%`, text: `of the year ${k.year} target of ${fmtNum(k.target)}` };
  };
  const min = p.consortium?.targeted_share_target;
  const share = figure(p, 'targeted_pct');
  return [
    { key: 'reached', icon: 'youngPeople', mod: 'delivery', value: fmtNum(figure(p, 'reached') || 0), label: 'Young people reached', trend: trend('reached') },
    { key: 'attendances', icon: 'attendance', mod: 'delivery', value: fmtNum(figure(p, 'attendances') || 0), label: 'Attendances', trend: trend('attendances') },
    { key: 'sessions', icon: 'sessions', mod: 'delivery', value: fmtNum(figure(p, 'sessions') || 0), label: 'Sessions', trend: trend('sessions') },
    { key: 'targeted', icon: 'targets', mod: 'surveys', value: share == null ? '–' : `${fmtNum(share)}%`, label: 'Targeted share',
      trend: min == null ? null : share == null ? { dir: 'flat', tone: 'grey', text: `Funder's minimum ${fmtNum(min)}%` }
        : share >= min ? { dir: 'up', tone: 'green', chip: 'On target', text: `At or above the ${fmtNum(min)}% minimum` } : { dir: 'down', tone: 'red', chip: 'Below', text: `Below the ${fmtNum(min)}% minimum` } },
  ];
}

// Outputs and outcomes linked to each organisation, as the programme
// documents (or the lead) connect them, with budgets for those who see money.
function byOrganisation(ctx, p, budgets) {
  const orgs = ctx.orgs.filter((o) => ['lead', 'accountable_body', 'delivery_partner'].includes(o.kind));
  const lines = p.commitments.filter((x) => x.kind);
  const linkedTo = (o) => lines.filter((x) => (x.links || []).includes(o.id));
  const rows = orgs.map((o) => ({ o, outputs: linkedTo(o).filter((x) => x.kind === 'output').length, outcomes: linkedTo(o).filter((x) => x.kind === 'outcome').length, budget: budgets[o.id] ?? null }))
    .filter((r) => r.outputs + r.outcomes || r.budget != null).sort((a, b) => b.outputs + b.outcomes - (a.outputs + a.outcomes));
  const max = Math.max(1, ...rows.map((r) => r.outputs + r.outcomes));
  if (!lines.length || !rows.some((r) => r.outputs + r.outcomes)) return null;
  const top = rows[0];
  return html`${chart(top ? `${top.o.name} is linked to the most targets: ${top.outputs + top.outcomes}.` : '', 'Outputs and outcomes each organisation is named against, from the programme documents', html`
      <div class="org-bars">${rows.map((r) => html`<div class="org-bar">
        <span class="name">${r.o.name}</span>
        <span class="track" role="img" aria-label="${r.outputs} outputs and ${r.outcomes} outcomes">
          ${r.outputs ? html`<span class="seg-output" style="width:${(100 * r.outputs) / max}%"></span>` : ''}${r.outcomes ? html`<span class="seg-outcome" style="width:${(100 * r.outcomes) / max}%"></span>` : ''}</span>
        <span class="vals">${r.outputs} output${r.outputs === 1 ? '' : 's'} · ${r.outcomes} outcome${r.outcomes === 1 ? '' : 's'}${r.budget != null ? ` · ${fmtMoney(r.budget)}` : ''}</span>
      </div>`)}</div>`)}
      <button type="button" class="linkbtn small" data-matrix style="margin-top:16px">See each link</button>`;
}

// Every output and outcome against every organisation, opened in a drawer.
function linkMatrix(ctx, p) {
  const orgs = ctx.orgs.filter((o) => ['lead', 'accountable_body', 'delivery_partner'].includes(o.kind));
  const lines = p.commitments.filter((x) => x.kind);
  return html`<div class="table-wrap"><table class="matrix">
    <thead><tr><th>Output or outcome</th><th class="num">Target</th>${orgs.map((o) => html`<th class="org">${o.name}</th>`)}</tr></thead>
    <tbody>${lines.map((x) => html`<tr><td class="lbl"><strong>${x.label}</strong><br><span class="small muted">${[KIND[x.kind], x.section, x.period === 'lifetime' ? 'Project lifetime' : `Year ${x.year}`].filter(Boolean).join(' · ')}</span></td>
      <td class="num">${fmtNum(x.target)}${x.unit === '%' ? '%' : ''}</td>
      ${orgs.map((o) => html`<td class="dot">${(x.links || []).includes(o.id) ? html`<span role="img" aria-label="linked">●</span>` : ''}</td>`)}</tr>`)}</tbody>
  </table></div>`;
}

export default async function dashboard(ctx, el, [tab] = [], opts = {}) {
  const c = ctx.consortium;
  const funder = ctx.role === 'funder_observer';
  // Partners get a second tab for their own organisation's targets and tasks.
  const ownTab = !ctx.seesAll && !funder && ctx.orgId && ctx.role !== 'youth_voice';
  // Partners see delivery data only; the lead, accountable body and funder
  // also see each organisation's budget on the links panel.
  const seesMoney = ctx.seesAll || funder;
  const [p, months, alloc, x, layout, sum] = await Promise.all([
    db.rpc('consortium_progress', { p_consortium: c.id }).then(must),
    db.rpc('consortium_months', { p_consortium: c.id }).then(must),
    seesMoney ? db.from('allocations').select('organisation_id, amount').eq('consortium_id', c.id).is('superseded_by', null).is('retired_at', null).then(must) : [],
    db.rpc('dashboard_extras', { p_consortium: c.id }).then(must),
    db.rpc('dashboard_layout', { p_consortium: c.id }).then(must),
    db.rpc('consortium_summary', { p_consortium: c.id }).then(must),
  ]);
  const budgets = {};
  for (const a of alloc) if (a.organisation_id) budgets[a.organisation_id] = (budgets[a.organisation_id] || 0) + Number(a.amount);

  // The layout being shown: the lead edits a copy of the draft.
  const blank = { order: ORDER, hidden: [], funder: ORDER, pinned: [], note: '' };
  const fill = (l) => ({ ...blank, ...(l || {}), order: [...new Set([...(l?.order || []), ...ORDER])].filter((k) => PANELS[k]) });
  let editing = !!opts.editing;
  let L = fill(layout.published);
  let draft = fill(layout.draft || layout.published);
  let dirty = false;

  const today = new Date().toISOString().slice(0, 10);
  const periods = [...new Set(p.commitments.map((k) => (k.period === 'lifetime' ? 'lifetime' : k.year)))]
    .sort((a, b) => (a === 'lifetime') - (b === 'lifetime') || a - b);
  const pct = (m) => (isPct(m) ? '%' : '');
  const reportedBy = (k) => (k.by_org || []).map((b) => `${ctx.org(b.organisation_id)?.name} ${fmtNum(b.value)}${pct(k)}`).join(' · ');
  const whoOf = (k) => k.organisation || (k.links || []).map((id) => ctx.org(id)?.name).filter(Boolean).join(', ') || 'Whole consortium';
  const orgsOf = (k) => (k.organisation_id ? [k.organisation_id] : k.links || []);
  const periodLabel = (y) => (y === 'lifetime' ? 'Project lifetime' : `Year ${y}`);
  const shareOf = (k) => (k.target ? (100 * k.actual) / k.target : 0);

  // ------------------------------------------------------------ the parts

  const t = x.timeline || {};
  const timeline = () => (t.months ? html`<div class="clock" role="group" aria-label="Programme timeline">
      <div class="clock-head"><strong>${t.month ? `Month ${t.month} of ${t.months}` : `Starts ${fmtDate(t.start)}`}</strong>
        ${t.next ? html`<span class="muted">Next: ${t.next.title}, ${fmtDate(t.next.due_on)}</span>` : ''}</div>
      <span class="clock-bar" role="img" aria-label="${t.month ? `Month ${t.month} of ${t.months}` : 'Not started'}"><span style="width:${Math.min(100, (100 * (t.month || 0)) / t.months)}%"></span></span>
      <div class="clock-ends muted small"><span>${fmtDate(t.start)}</span><span>${fmtDate(t.end)}</span></div></div>` : '');

  const share = figure(p, 'targeted_pct');
  // The funder's minimum for the current programme year (it can rise each year).
  const min = p.consortium?.targeted_share_target ?? c.targeted_share_target;
  const ret = x.returns || {};
  const cards = () => {
    const h = Object.fromEntries(headline(p).map((f) => [f.key, f]));
    const all = {
      ...h,
      surveys: { key: 'surveys', icon: 'surveys', mod: 'surveys', value: x.surveys?.rate != null ? `${fmtNum(x.surveys.rate)}%` : '–', label: 'Survey response rate',
        trend: x.surveys?.rate != null ? null : { dir: 'flat', tone: 'grey', text: 'Starts with the first survey' } },
      returns: { key: 'returns', icon: 'returns', mod: 'compliance', value: ret.due ? `${ret.on_time} of ${ret.due}` : '–', label: 'Returns on time',
        trend: ret.due ? { dir: ret.on_time === ret.due ? 'up' : 'down', tone: ret.on_time === ret.due ? 'green' : 'amber', chip: `${Math.round((100 * ret.on_time) / ret.due)}%`, text: 'submitted by the due date' } : { dir: 'flat', tone: 'grey', text: 'No returns due yet' } },
    };
    const keys = ['reached', 'attendances', 'targeted', 'sessions', 'surveys', 'returns'];
    const pins = (editing ? draft : L).pinned;
    return [...pins.filter((k) => all[k]), ...keys.filter((k) => !pins.includes(k))].map((k) => all[k]);
  };
  const stats = () => html`<div class="stats stats-6">${cards().map((f) => html`<div class="stat-wrap">${statCard(f)}
    ${(editing ? draft : L).pinned.includes(f.key) && !editing ? html`<span class="pinned" title="Pinned by the lead">Pinned</span>` : ''}
    ${editing ? html`<label class="check small pin"><input type="checkbox" data-pin="${f.key}" ${draft.pinned.includes(f.key) ? 'checked' : ''}> Pin to the top</label>` : ''}</div>`)}</div>`;

  // Overall progress: each reported target's achievement against where it
  // should be by now, capped at 100, averaged; bars per outcome theme.
  const scored = p.commitments.filter((k) => k.source && (isPct(k) ? k.target : k.expected));
  const score = scored.some((k) => Number(k.actual) > 0) ? Math.round(scored.reduce((s, k) => s + Math.min(1, k.actual / (isPct(k) ? k.target : k.expected)), 0) / scored.length * 100) : null;
  const outcomes = [...(sum.outcomes || [])].filter((o) => o.active !== false);
  const themes = [...new Set(outcomes.map((o) => o.theme || 'Outcomes'))].map((th) => {
    const list = outcomes.filter((o) => (o.theme || 'Outcomes') === th);
    const got = list.filter((o) => o.reported && o.target);
    return { th, n: list.length, avg: got.length ? got.reduce((s, o) => s + Math.min(100, (100 * o.actual) / o.target), 0) / got.length : null };
  });
  const scorePanel = () => html`<div class="score">
    <div class="score-ring">${ring(score ?? 0, { size: 132, stroke: 12, color: 'var(--progress)', track: 'var(--track)', value: score == null ? '–' : `${score}`, label: 'out of 100' })}
      <p class="muted small">${score == null ? 'The score starts once delivery is recorded.' : `Average of ${scored.length} reported target${scored.length === 1 ? '' : 's'} against where each should be by today.`}</p></div>
    <div><h3 class="small-head">By outcome theme</h3>
      ${themes.length ? html`<ul class="theme-bars">${themes.filter((r) => r.avg != null || ctx.manages).map((r) => html`<li>
        <div class="tb-top"><span class="tb-name">${r.th}</span>${r.avg != null ? html`<span class="tb-val">${Math.round(r.avg)}%</span>` : ''}</div>
        <span class="muted small">${r.n} outcome${r.n === 1 ? '' : 's'}${r.avg == null ? ' · results begin with the first survey' : ''}</span>
        <span class="slim"><span style="width:${r.avg ?? 0}%"></span></span></li>`)}</ul>
        ${!ctx.manages && themes.every((r) => r.avg == null) ? html`<p class="muted small">Results by theme appear with the first survey returns.</p>` : ''}`
      : html`<p class="muted small">No outcome framework agreed yet.</p>`}</div></div>`;

  // Targets: every commitment in one table, grouped by year, with filters.
  const partnerIds = [...new Set(p.commitments.flatMap(orgsOf))].filter((id) => ctx.org(id));
  const sites = [...new Set(p.commitments.map((k) => k.site).filter(Boolean))];
  const programmes = x.programmes || [];
  // Targets show one year at a time, starting with the current year.
  let yearSel = String(p.commitments.find((k) => k.period === 'year' && k.year_start <= today && today < k.year_end)?.year ?? '');
  // One compact row per target: a short headline (the full wording is in
  // its details and on hover), who, the target, progress and status.
  // In the first quarter of a period, a target with nothing recorded isn't
  // behind yet: it reads "None recorded yet" rather than red.
  const early = (k) => !Number(k.actual) && (k.elapsed ?? 0) < 0.25;
  const statusOf = (k) => (!k.source || early(k) ? 'none' : k.rag || 'grey');
  const targetRow = (k) => {
    const s = shareOf(k);
    const short = shortLabel(k.label, 12);
    return html`<tr data-row data-orgs="${orgsOf(k).join(' ')}" data-site="${k.site || ''}" data-year="${k.period === 'lifetime' ? 'lifetime' : k.year}">
      <td class="t-main"><button type="button" class="t-label" data-id="${k.id}" title="${k.label}">${short}</button>
        <span class="t-meta">${[KIND[k.kind], k.section, k.site, k.source ? SOURCE[k.source].toLowerCase() : ''].filter(Boolean).join(' · ')}${k.by_org?.length ? ` · reported: ${reportedBy(k)}` : ''}</span>
        ${editing ? html`<button type="button" class="linkbtn small" data-change="${k.id}">Change</button>` : ''}</td>
      <td class="t-who" data-label="Partner"><span title="${whoOf(k)}">${whoOf(k)}</span></td>
      <td class="num" data-label="Target">${fmtNum(k.target)}${pct(k)}</td>
      <td class="t-prog" data-label="Progress">${k.source ? html`<span class="t-fig"><strong>${fmtNum(k.actual)}${pct(k)}</strong><span class="muted">${isPct(k) ? '' : ` · ${fmtNum(Math.round(s))}%`}</span></span>
        <span class="slim" role="img" aria-label="${isPct(k) ? `${fmtNum(k.actual)}%` : `${fmtNum(Math.round(s))}% of the target`}"><span style="width:${Math.min(100, isPct(k) ? k.actual : s)}%"></span>
          ${isPct(k) ? html`<i style="left:${Math.min(100, k.target)}%"></i>` : k.target ? html`<i style="left:${Math.min(100, (100 * k.expected) / k.target)}%"></i>` : ''}</span>` : html`<span class="muted">–</span>`}</td>
      <td class="t-status" data-label="Status">${!k.source ? html`<span class="muted small">Not reported</span>` : early(k) ? html`<span class="muted small">None recorded yet</span>` : rag(k.rag)}</td></tr>`;
  };
  const groupNote = (rows) => {
    const onTrack = rows.filter((k) => k.source && k.rag === 'green').length;
    const reported = rows.filter((k) => k.source).length;
    const current = rows[0].period === 'lifetime' || (rows[0].year_start <= today && today < rows[0].year_end);
    return [current ? `${Math.round(rows[0].elapsed * 100)}% of the way through` : rows[0].year_start > today ? 'Not started' : 'Finished',
      reported ? `${onTrack} of ${rows.length} on track` : 'nothing reported yet', reported && rows.length - reported ? `${rows.length - reported} not reported` : ''].filter(Boolean).join(' · ');
  };
  // Targets in short sections: each year's targets grouped by section and
  // type (Targeted outputs, Universal outcomes...). A section header shows
  // its count, how many are reported and a status bar; it opens to its rows.
  const SECTION_ORDER = (k) => [k.section || 'Other', k.kind === 'outcome' ? 'outcomes' : 'outputs'];
  const targetsTable = (list, withFilters) => {
    const years = periods.filter((y) => list.some((k) => (y === 'lifetime' ? k.period === 'lifetime' : k.period !== 'lifetime' && k.year === y)));
    if (!years.length) return html`<p class="note">No targets confirmed yet.${ctx.manages ? html` <a href="#/c/${c.id}/targets">Set targets</a>` : ''}</p>`;
    const inYear = (y) => list.filter((k) => (y === 'lifetime' ? k.period === 'lifetime' : k.period !== 'lifetime' && k.year === y));
    const sectionsOf = (rows) => {
      const keys = [...new Set(rows.map((k) => SECTION_ORDER(k).join('|')))]
        .sort((a, b) => (a.startsWith('Targeted') ? 0 : a.startsWith('Universal') ? 1 : 2) - (b.startsWith('Targeted') ? 0 : b.startsWith('Universal') ? 1 : 2) || a.localeCompare(b));
      return keys.map((key) => [key.split('|'), rows.filter((k) => SECTION_ORDER(k).join('|') === key)]);
    };
    const statusBar = (rows) => {
      const n = (st) => rows.filter((k) => statusOf(k) === st).length;
      const parts = [['green', n('green')], ['amber', n('amber')], ['red', n('red')], ['none', rows.length - n('green') - n('amber') - n('red')]].filter(([, v]) => v);
      return html`<span class="tg-bar" role="img" aria-label="${parts.map(([t, v]) => `${v} ${t === 'none' ? 'not reported' : t}`).join(', ')}">${parts.map(([t, v]) => html`<i class="seg-${t}" style="flex:${v}"></i>`)}</span>`;
    };
    return html`${withFilters ? html`<div class="target-tools"><div class="filters" role="group" aria-label="Filter targets">
        ${partnerIds.length > 1 ? html`<label class="f">Partner<select data-filter="org"><option value="">All partners</option>${partnerIds.map((id) => html`<option value="${id}">${ctx.org(id).name}</option>`)}</select></label>` : ''}
        ${programmes.length ? html`<label class="f">Programme<select data-filter="programme"><option value="">All programmes</option>${programmes.map((g) => html`<option value="${g.id}">${g.name}</option>`)}</select></label>` : ''}
        ${sites.length ? html`<label class="f">Site<select data-filter="site"><option value="">All sites</option>${sites.map((s) => html`<option>${s}</option>`)}</select></label>` : ''}
      </div>
      ${periods.length > 1 ? html`<div class="seg" role="group" aria-label="Year">${[...periods, ''].map((y) => html`<button type="button" class="seg-btn" data-year-tab="${y}" aria-pressed="${String(y) === yearSel}">${y === '' ? 'All years' : periodLabel(y)}</button>`)}</div>` : ''}</div>` : ''}
      <p class="muted small tg-help">Open a section to see its targets; select a target for its details.${list.some((k) => k.source) ? ' The mark on each bar is where it should be by today.' : ''}
        <button type="button" class="linkbtn small" data-open-all>Open all</button></p>
      ${years.map((y) => {
        const rows = inYear(y);
        return html`<div class="tyear" data-year="${y}"><div class="tyear-head"><h3>${periodLabel(y)}</h3><span class="muted small">${groupNote(rows)}</span></div>
          ${sectionsOf(rows).map(([[section, kind], srows]) => html`<details class="tgroup">
            <summary><span class="tg-title">${section} ${kind}</span>
              <span class="tg-meta">${srows.length} target${srows.length === 1 ? '' : 's'} · ${srows.filter((k) => k.source).length} reported · ${srows.filter((k) => statusOf(k) === 'green').length} on track</span>
              ${statusBar(srows)}<span class="tg-chev" aria-hidden="true"></span></summary>
            <div class="table-wrap"><table class="cards targets-table">
              <thead><tr><th>Measure</th><th>Partner</th><th class="num">Target</th><th>Progress</th><th>Status</th></tr></thead>
              <tbody>${srows.map(targetRow)}</tbody></table></div></details>`)}</div>`;
      })}`;
  };

  const reachPanel = () => {
    const anyMonths = months.some((m) => m.reached || m.attendances);
    const totalAtt = months.reduce((s, m) => s + (m.attendances || 0), 0);
    const totalNew = months.reduce((s, m) => s + (m.reached || 0), 0);
    return html`<div class="stack-col">
      <div><h3 class="small-head">Targeted share</h3>
        ${share == null ? html`<p class="not-yet">Not yet reported${min != null ? `. The funder's minimum is ${fmtNum(min)}%.` : '.'}</p>`
        : html`<p class="takeaway" style="margin-top:12px;font-weight:600">${min == null ? `${fmtNum(share)}% of young people are from targeted groups.` : share >= min ? `${fmtNum(share)}% targeted, at or above the ${fmtNum(min)}% minimum.` : `${fmtNum(share)}% targeted, below the ${fmtNum(min)}% minimum.`}</p>
          <div style="padding-top:12px"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px"><strong style="font:400 30px/1 var(--display)">${fmtNum(share)}%</strong>
            ${min != null ? (share >= min ? pill('green', `At or above ${fmtNum(min)}%`, 'approved') : pill('amber', `Below ${fmtNum(min)}%`, 'overdue')) : ''}</div>
          <span class="slim" style="margin-top:12px" role="img" aria-label="${fmtNum(share)}% targeted${min != null ? `, minimum ${fmtNum(min)}%` : ''}"><span style="width:${Math.min(100, share)}%"></span>${min != null ? html`<i style="left:${min}%"></i>` : ''}</span>
          <p class="muted small" style="margin-top:8px">Targeted ${fmtNum(share)}% · Universal ${fmtNum(100 - share)}%${min != null ? ` · Minimum ${fmtNum(min)}% (the mark)` : ''}.</p></div>`}</div>
      <div><h3 class="small-head">Reach over time</h3>
        ${anyMonths ? chart(`${fmtNum(totalNew)} new young people and ${fmtNum(totalAtt)} attendances so far.`, 'New young people and attendances by month',
          lineChart(months.map((m) => shortMonth.format(new Date(`${m.month.slice(0, 10)}T12:00:00`))), [
            { name: 'Attendances', color: 'var(--series-1)', values: months.map((m) => m.attendances || 0) },
            { name: 'New young people', color: 'var(--series-2)', values: months.map((m) => m.reached || 0) }]))
        : html`<p class="not-yet">Nothing recorded yet.</p>`}</div></div>`;
  };

  // Partners: returns, sessions and reach against each partner's own
  // reach target. No money.
  const partnerFig = (o, m) => (o[m] || p.commitments.filter((k) => k.measure === m).reduce((s, k) => s + (k.by_org || []).filter((b) => b.organisation_id === o.id).reduce((n, b) => n + Number(b.value), 0), 0));
  const reachTarget = (o) => p.commitments.filter((k) => k.measure === 'reached' && k.period === 'year' && k.year_start <= today && today < k.year_end
    && (k.organisation_id === o.id || (!k.organisation_id && (k.links || []).length === 1 && k.links[0] === o.id))).reduce((s, k) => s + Number(k.target), 0);
  const partnersPanel = () => html`<ul class="rows">${p.partners.map((o) => {
    const r = o.latest_return?.status === 'approved' ? o.latest_return.rag : null;
    const target = reachTarget(o);
    const reached = partnerFig(o, 'reached');
    return html`<li class="partner-row"><div class="partner-top"><span class="avatar-sm" aria-hidden="true">${initials(o.name)}</span><strong>${o.name}</strong>
        <span class="pills">${rag(r)}${o.escalation ? pill(o.escalation === 'Conversation' ? 'amber' : 'red', o.escalation, 'overdue') : ''}</span></div>
      <p class="muted small">${fmtNum(reached)}${target ? ` of ${fmtNum(target)}` : ''} young people · ${fmtNum(partnerFig(o, 'attendances'))} attendances · ${fmtNum(partnerFig(o, 'sessions'))} sessions</p>
      ${target ? html`<span class="slim" role="img" aria-label="${Math.round((100 * reached) / target)}% of their reach target"><span style="width:${Math.min(100, (100 * reached) / target)}%"></span></span>` : ''}
      <p class="muted small">Return: ${o.latest_return ? html`${fmtMonth(o.latest_return.period)} ${statusPill(o.latest_return.status)}` : 'none yet'} · ${o.last_progress ? `last reported ${fmtMonth(o.last_progress)}` : 'no progress reported yet'}</p></li>`;
  })}</ul>`;

  // Outcomes: change per measure. Before and after scores come from
  // surveys; until then, results against the target.
  // Outcomes grouped into their themes: one numbered tile per theme with its
  // average progress and a small bar per outcome, and a breakdown that opens
  // the individual outcomes. Before and after scores arrive with surveys.
  const OUTCOME_ICON = (t) => (/safe|belong|access|space/i.test(t) ? 'compliance' : /skill|progress|work|employ|train|educat/i.test(t) ? 'outcomes'
    : /well|health|relation|mental|emotion/i.test(t) ? 'surveys' : 'targets');
  const pctOf = (o) => (o.reported && o.target ? Math.min(100, (100 * o.actual) / o.target) : null);
  const outcomesPanel = () => {
    if (!outcomes.length || (!ctx.manages && !outcomes.some((o) => o.reported))) return null;
    return html`<div class="otiles">${themes.map((r, i) => {
      const list = outcomes.filter((o) => (o.theme || 'Outcomes') === r.th);
      return html`<article class="otile g${(i % 4) + 1}">
        <div class="otile-tab" aria-hidden="true"><span>${String(i + 1).padStart(2, '0')}</span></div>
        <div class="otile-body">
          <header><span class="otile-icon">${raw(icon(OUTCOME_ICON(r.th), 20))}</span>
            <div><h3>${r.th}</h3><span class="muted small">${r.n} outcome${r.n === 1 ? '' : 's'}</span></div></header>
          <div class="otile-fig"><b>${r.avg == null ? '–' : `${Math.round(r.avg)}%`}</b>
            <span class="muted small">${r.avg == null ? 'Results begin with the first survey' : 'average progress against target'}</span></div>
          <div class="ochart" role="img" aria-label="${list.map((o) => `${o.headline || shortLabel(o.label)}: ${pctOf(o) == null ? 'no result' : `${Math.round(pctOf(o))}%`}`).join('; ')}">
            ${list.map((o) => html`<span class="ocol" title="${o.code ? `${o.code} · ` : ''}${o.headline || shortLabel(o.label)}${pctOf(o) == null ? '' : ` · ${Math.round(pctOf(o))}%`}"><i style="height:${Math.max(pctOf(o) ?? 0, 0)}%"></i></span>`)}</div>
          <details class="obreak"><summary>Break down ${r.n} outcome${r.n === 1 ? '' : 's'}</summary>
            <ul class="olist">${list.map((o) => {
              const sh = pctOf(o);
              return html`<li><span class="ocode">${o.code || ''}</span><span class="oname" title="${o.label}">${o.headline || shortLabel(o.label)}</span>
                <span class="oval">${o.before != null ? `Before ${fmtNum(o.before)} · After ${fmtNum(o.after)}` : sh != null ? `${fmtNum(o.actual)} of ${fmtNum(o.target)} · ${Math.round(sh)}%` : ctx.manages ? html`<span class="muted">No results yet</span>` : ''}</span>
                ${sh != null ? html`<span class="slim"><span style="width:${sh}%"></span></span>` : ''}</li>`;
            })}</ul></details></div></article>`;
    })}</div>
    <p class="muted small" style="margin-top:16px">Before and after scores appear here once the first surveys are back.</p>`;
  };

  const sitesPanel = () => {
    const list = x.sites || [];
    if (!list.length) return null;
    const max = Math.max(1, ...list.map((s) => s.attendances));
    const any = list.some((s) => s.attendances);
    return html`<ul class="rows">${list.map((s) => html`<li class="kv"><div><strong>${s.name}</strong>${s.organisation ? html`<span class="muted small" style="display:block">${s.organisation}</span>` : ''}</div>
      <div class="kv-end"><span class="muted small">${fmtNum(s.attendances)} attendance${s.attendances === 1 ? '' : 's'} · ${fmtNum(s.sessions)} session${s.sessions === 1 ? '' : 's'}</span>
        ${any ? html`<span class="slim" role="img" aria-label="${s.attendances} attendances"><span style="width:${(100 * s.attendances) / max}%"></span></span>` : ''}</div></li>`)}</ul>
      ${list.every((s) => !s.sessions) ? html`<p class="muted small" style="margin-top:12px">Attendance by site builds as sessions are logged in the register.</p>` : ''}`;
  };

  const alertsPanel = () => {
    const items = [
      ...(x.returns_due || []).map((r) => ({ ic: r.overdue ? 'overdue' : 'due', text: html`<strong>${r.organisation}</strong>: ${fmtMonth(r.period)} return ${r.overdue ? 'overdue' : 'due'} ${fmtDate(r.due_on)}`, tone: r.overdue ? 'red' : 'amber' })),
      ...(ret.awaiting_review ? [{ ic: 'submitted', text: html`<a href="#/c/${c.id}/returns">${ret.awaiting_review} return${ret.awaiting_review === 1 ? '' : 's'} awaiting your review</a>`, tone: 'blue' }] : []),
      ...(x.compliance || []).map((d) => ({ ic: 'expiry', text: html`<strong>${d.organisation}</strong>: ${d.title} expires ${fmtDate(d.expires_on)}`, tone: 'amber' })),
      ...(x.risks || []).map((r) => ({ ic: 'safeguarding', text: html`<strong>${r.organisation}</strong> flagged a risk in ${fmtMonth(r.period)}: ${r.text}`, tone: 'red' })),
    ];
    const stories = x.stories || [];
    return html`<div class="stack-col"><div><h3 class="small-head">Needs attention</h3>
        ${items.length ? html`<ul class="rows alerts">${items.map((i) => html`<li><span class="alert-ic tone-${i.tone}">${raw(icon(i.ic, 16))}</span><span>${i.text}</span></li>`)}</ul>`
        : html`<p class="muted">Nothing needs attention.</p>`}</div>
      <div><h3 class="small-head">Latest stories</h3>
        ${stories.length ? html`<ul class="rows">${stories.map((s) => html`<li><p>${s.text}</p><span class="muted small">${s.organisation} · ${fmtMonth(s.period)}</span></li>`)}</ul>`
        : html`<p class="muted">Stories from partners' returns appear here.</p>`}</div></div>`;
  };

  const programmesPanel = () => (programmes.length ? html`<ul class="rows">${programmes.map((g) => html`<li class="row"><div><strong>${g.name}</strong><span class="muted">${g.lead_partner || ''}</span></div>
      <div class="row-end"><span class="figure"><span>${g.key_target || ''}</span><span>${statusPill(g.status)}</span></span></div></li>`)}</ul>`
    : ctx.manages ? html`<p class="note">Programmes appear here once they are set up, with their lead partner, key target and progress. Only you can see this.</p>` : null);

  const quartersPanel = () => html`<details class="wording"><summary><span class="muted small">Show the table</span></summary>
    ${p.quarters.length ? html`<div class="table-wrap" style="margin-top:16px"><table class="cards">
      <thead><tr><th>Quarter</th><th class="num">New young people</th><th class="num">Targeted %</th><th class="num">Sessions</th><th class="num">Attendances</th><th class="num">Outcomes</th></tr></thead>
      <tbody>${p.quarters.map((q) => html`<tr><td class="nowrap"><strong>${q.label}</strong></td>
        <td class="num" data-label="New young people">${fmtNum(q.reached)}</td><td class="num" data-label="Targeted %">${q.reached ? `${fmtNum((100 * q.targeted) / q.reached)}%` : '–'}</td>
        <td class="num" data-label="Sessions">${fmtNum(q.sessions)}</td><td class="num" data-label="Attendances">${fmtNum(q.attendances)}</td><td class="num" data-label="Outcomes">${fmtNum(q.outcomes)}</td></tr>`)}</tbody></table></div>`
    : html`<p class="not-yet" style="margin-top:12px">Delivery hasn't started yet.</p>`}</details>`;

  const notePanel = () => {
    const l = editing ? draft : L;
    if (editing) return html`<label class="f"><span class="sr-only">Lead note</span><textarea id="note" maxlength="600" rows="3" placeholder="A short update for partners and the funder, up to 600 characters.">${l.note || ''}</textarea></label>`;
    return l.note ? html`<p class="lead-note">${l.note}</p>${layout.published_at ? html`<p class="muted small" style="margin-top:8px">Updated ${fmtDate(layout.published_at)}</p>` : ''}` : null;
  };

  const SUB = {
    stats: '', score: 'One number for the whole project, out of 100, and how each outcome theme is doing.',
    targets: 'Every commitment to the funder, by year, with what has been achieved.', programmes: 'Progress per programme, with its lead partner.',
    partners: "Each partner's latest return, sessions and reach against their target.", outcomes: 'Change for young people on each outcome measure.',
    sites: 'Attendance and sessions at each site.', alerts: 'Returns due, documents expiring, risks flagged and the latest stories.',
    reach: 'Who the programme is reaching, and how that is changing month by month.', links: 'Outputs and outcomes each organisation is named against in the programme documents.', quarters: '',
  };
  const BODY = { note: notePanel, stats, score: scorePanel, targets: () => targetsTable(p.commitments, true), programmes: programmesPanel, partners: () => (p.partners.length ? partnersPanel() : null),
    outcomes: outcomesPanel, sites: sitesPanel, alerts: alertsPanel, reach: reachPanel, links: () => byOrganisation(ctx, p, budgets), quarters: quartersPanel };

  // The lead's own panels: data health, approvals and the link to finance.
  const h = x.health;
  const leadPanels = () => {
    if (!ctx.manages || !h) return '';
    const health = [
      [h.targets_unconfirmed, 'target', 'waiting for a partner to confirm', 'targets'], [h.targets_unreported, 'target', 'with nothing reported', 'progress'],
      [h.targets_unlinked, 'target', 'not linked to an organisation', 'targets'], [h.outcomes_no_method, 'outcome', 'without a measurement method', 'hub/methods'],
      [h.partners_no_contact, 'partner', 'without a contact email', 'hub/edit'], [h.sites_no_partner, 'site', 'without a partner', 'hub/edit'],
    ].filter(([n]) => n);
    const approvals = [[ret.awaiting_review, 'return', 'to review', 'returns'], [h.bid_items_to_review, 'bid document', 'to review', 'bid'],
      [h.extraction_to_review, 'document reading', 'to check', 'targets']].filter(([n]) => n);
    const line = ([n, noun, text, to]) => html`<li class="row" style="grid-template-columns:minmax(0,1fr) auto"><span><strong>${fmtNum(n)}</strong> ${noun}${n === 1 ? '' : 's'} ${text}</span><a class="small" href="#/c/${c.id}/${to}">Open</a></li>`;
    return html`<section class="dcard full lead-only"><header class="dcard-head"><span class="eyebrow">Only you can see this</span><h2>For the lead</h2></header>
      <div class="two-col">
        <div><h3 class="small-head">Data health</h3>${health.length ? html`<ul class="rows">${health.map(line)}</ul>` : html`<p class="muted">Everything is linked, confirmed and reported.</p>`}</div>
        <div><h3 class="small-head">Awaiting approval</h3>${approvals.length ? html`<ul class="rows">${approvals.map(line)}</ul>` : html`<p class="muted">Nothing waiting for you.</p>`}
          <p style="margin-top:16px"><a class="btn secondary" href="#/c/${c.id}/targets">${raw(icon('finance', 16))}Finance</a></p></div></div></section>`;
  };

  // My organisation: a partner's own targets and tasks.
  const mine = () => {
    const own = p.commitments.filter((k) => orgsOf(k).includes(ctx.orgId));
    const tasks = [
      ...(x.returns_due || []).map((r) => html`${fmtMonth(r.period)} return ${r.overdue ? 'overdue since' : 'due'} ${fmtDate(r.due_on)} · <a href="#/c/${c.id}/returns">Open returns</a>`),
      ...(x.compliance || []).map((d) => html`${d.title} expires ${fmtDate(d.expires_on)}`),
    ];
    return html`<div class="dgrid"><section class="dcard full"><header class="dcard-head"><h2>Your tasks</h2></header>
        ${tasks.length ? html`<ul class="rows">${tasks.map((tk) => html`<li>${tk}</li>`)}</ul>` : html`<p class="muted">Nothing due right now.</p>`}
        <p style="margin-top:12px"><a class="btn secondary" href="#/c/${c.id}/progress">${raw(icon('upload', 16))}Report progress</a></p></section>
      <section class="dcard full"><header class="dcard-head"><h2>Your targets</h2><p>Targets your organisation delivers or is named against.</p></header>
        ${own.length ? targetsTable(own, false) : html`<p class="muted">No targets name your organisation yet.</p>`}</section></div>`;
  };

  // ------------------------------------------------------------ the page

  const visible = (k) => {
    const l = editing ? draft : L;
    if (editing) return true;
    if (l.hidden.includes(k)) return false;
    if (funder && !l.funder.includes(k)) return false;
    return true;
  };
  const panel = (k, i, keys) => {
    const body = BODY[k]();
    if (!editing && (body == null || body === '')) return '';
    const hidden = draft.hidden.includes(k);
    return html`<section class="dcard ${SIZE[k] || 'half'} ${k === 'stats' && !editing ? 'bare' : ''} ${k === 'score' ? 'feature' : ''} ${editing && hidden ? 'is-hidden' : ''}" data-panel="${k}">
      ${editing ? html`<div class="panel-tools" role="group" aria-label="${PANELS[k]} panel">
        <button type="button" class="icon-btn" data-move="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move ${PANELS[k]} up"><span aria-hidden="true">↑</span></button>
        <button type="button" class="icon-btn" data-move="1" ${i === keys.length - 1 ? 'disabled' : ''} aria-label="Move ${PANELS[k]} down"><span aria-hidden="true">↓</span></button>
        <button type="button" class="btn secondary small" data-toggle>${hidden ? 'Show' : 'Hide'}</button>
        <label class="check small"><input type="checkbox" data-funder ${draft.funder.includes(k) ? 'checked' : ''}> Funder sees this</label>
        ${hidden ? pill('grey', 'Hidden', 'view') : ''}</div>` : ''}
      ${k === 'stats' ? '' : html`<header class="dcard-head"><h2>${PANELS[k]}</h2>${SUB[k] ? html`<p>${SUB[k]}</p>` : ''}</header>`}
      ${editing && hidden ? '' : body ?? html`<p class="muted small">Nothing to show here yet.</p>`}</section>`;
  };

  const draw = () => {
    const l = editing ? draft : L;
    const keys = l.order.filter((k) => editing || visible(k));
    const status = layout.version ? (layout.draft_changed || dirty ? pill('amber', `Unpublished changes · version ${layout.version} is live`, 'due') : pill('green', `Published · version ${layout.version}`, 'approved')) : pill('grey', 'Default layout', 'waiting');
    render(el, html`
      <div class="page-head"><div><span class="eyebrow">Dashboard</span><h1>${c.name}</h1>
        <p class="meta-line">${[sum.summary?.funder_name || c.funder, sum.summary?.programme_name || c.programme].filter(Boolean).join(' · ')}${c.start_date ? ` · ${fmtDate(c.start_date)} to ${fmtDate(c.end_date)}` : ''}</p>
        <p>Are we on track? Progress against every target, from partner reports and the register.</p></div>
        <div class="btns">${ctx.role !== 'youth_voice' && !editing ? html`<button class="btn secondary" id="x-commit">Export targets</button>
          <button class="btn secondary" id="x-quarters">Quarters</button>` : ''}
          ${layout.editable ? (editing ? '' : html`<button class="btn secondary" id="edit">Edit</button>`) : ''}</div></div>
      ${editing ? html`<div class="edit-bar" role="region" aria-label="Edit the dashboard">
        <span>${status}</span><span class="muted small">Move, hide or pin panels. Partners and the funder see the published version.</span>
        <span class="btns"><button class="linkbtn small" id="history">View history</button><button class="btn secondary" id="save">Save draft</button>
          <button class="btn" id="publish">${raw(icon('submitted', 16))}Publish</button><button class="btn secondary" id="done">Done</button></span></div>` : ''}
      ${timeline()}
      ${!c.allow_real_records ? html`<p class="note" style="margin-top:24px">Demo mode: ${fromReports(p) ? 'figures come from partner reports; the register holds made-up records only.' : 'register figures come from made-up records.'}</p>` : ''}
      ${ownTab ? html`<div class="tabs" role="tablist" style="margin-top:24px">
        <a role="tab" href="#/c/${c.id}/dashboard" aria-selected="${tab !== 'mine'}">Consortium</a>
        <a role="tab" href="#/c/${c.id}/dashboard/mine" aria-selected="${tab === 'mine'}">My organisation</a></div>` : ''}
      ${ownTab && tab === 'mine' ? mine() : html`<div class="dgrid">${keys.map((k, i) => panel(k, i, keys))}${editing ? '' : leadPanels()}</div>`}`);
    bind();
  };

  // ------------------------------------------------------------ behaviour

  const applyFilters = () => {
    const f = Object.fromEntries($$('[data-filter]', el).map((sel) => [sel.dataset.filter, sel.value]));
    if ($('[data-year-tab]', el)) f.year = yearSel;
    $$('tr[data-row]', el).forEach((r) => {
      r.hidden = !!((f.org && !r.dataset.orgs.split(' ').includes(f.org)) || (f.site && r.dataset.site !== f.site) || (f.year && r.dataset.year !== f.year));
    });
    $$('details.tgroup', el).forEach((g) => { g.hidden = !$$('tr[data-row]', g).some((r) => !r.hidden); });
    $$('.tyear', el).forEach((y) => { y.hidden = (f.year && y.dataset.year !== f.year) || !$$('details.tgroup', y).some((g) => !g.hidden); });
  };
  const changed = () => { dirty = true; };

  function bind() {
    $$('[data-filter]', el).forEach((sel) => sel.addEventListener('change', applyFilters));
    $$('[data-year-tab]', el).forEach((b) => b.addEventListener('click', () => {
      yearSel = b.dataset.yearTab;
      $$('[data-year-tab]', el).forEach((x2) => x2.setAttribute('aria-pressed', String(x2 === b)));
      applyFilters();
    }));
    applyFilters();
    $$('[data-open-all]', el).forEach((b) => b.addEventListener('click', () => {
      const open = b.textContent === 'Open all';
      $$('details.tgroup', el).forEach((d) => { d.open = open; });
      b.textContent = open ? 'Close all' : 'Open all';
    }));
    $('[data-matrix]', el)?.addEventListener('click', () => openDrawer('Who the targets link to', linkMatrix(ctx, p)));
    $$('button[data-id]', el).forEach((b) => b.addEventListener('click', () => {
      const k = p.commitments.find((r) => r.id === b.dataset.id);
      openDrawer(k.label, html`<p>${k.source ? rag(k.rag) : pill('grey', 'Not reported', 'waiting')}</p><dl class="facts">
        <dt>Type</dt><dd>${[KIND[k.kind], k.section, periodLabel(k.period === 'lifetime' ? 'lifetime' : k.year)].filter(Boolean).join(' · ')}</dd>
        <dt>Who</dt><dd>${k.organisation || 'Whole consortium'}${k.site ? ` · ${k.site}` : ''}</dd>
        <dt>Target</dt><dd>${fmtNum(k.target)}${pct(k)}</dd>
        <dt>Due by now</dt><dd>${k.source ? `${fmtNum(k.expected)}${pct(k)}` : '–'}</dd>
        <dt>Achieved</dt><dd>${k.source ? `${fmtNum(k.actual)}${pct(k)}` : 'Nothing reported yet'}</dd>
        <dt>Source</dt><dd>${SOURCE[k.source] || '–'}${k.last_reported ? ` · latest ${fmtMonth(k.last_reported)}` : ''}</dd>
        ${k.by_org?.length ? html`<dt>Reported by</dt><dd>${reportedBy(k)}</dd>` : ''}
        ${k.links?.length ? html`<dt>Linked to</dt><dd>${k.links.map((id) => ctx.org(id)?.name).filter(Boolean).join(', ')}</dd>` : ''}
        <dt>Tracked as</dt><dd>${MEASURE_LABEL[k.measure]}</dd></dl>`);
    }));

    const name = c.name.replace(/[^\w ]+/g, '');
    $('#x-commit', el)?.addEventListener('click', () => downloadCsv(`${name} targets.csv`, p.commitments.map((k) => ({
      Period: periodLabel(k.period === 'lifetime' ? 'lifetime' : k.year), Type: KIND[k.kind] || '', Section: k.section || '', Commitment: k.label, 'Tracked as': MEASURE_LABEL[k.measure],
      'Actual from': k.source === 'reported' ? 'Partner reports' : k.source === 'records' ? 'Register' : '', 'Reported by': reportedBy(k),
      'Linked organisations': (k.links || []).map((id) => ctx.org(id)?.name).filter(Boolean).join('; '), Who: k.organisation || 'Whole consortium', Site: k.site || '',
      Target: k.target, 'Due by now': k.expected, Actual: k.actual, Rating: k.rag,
    }))));
    $('#x-quarters', el)?.addEventListener('click', () => downloadCsv(`${name} quarters.csv`, p.quarters.map((q) => ({
      Quarter: q.label, 'New young people': q.reached, Targeted: q.targeted,
      'Targeted %': q.reached ? Math.round((1000 * q.targeted) / q.reached) / 10 : '', Sessions: q.sessions, Attendances: q.attendances, Outcomes: q.outcomes,
    }))));
    $('[data-panel="partners"] .dcard-head', el)?.insertAdjacentHTML('beforeend', !editing && p.partners.length > 1 ? '<button class="btn secondary small" id="x-partners">Export</button>' : '');
    $('#x-partners', el)?.addEventListener('click', () => downloadCsv(`${name} partners.csv`, p.partners.map((o) => ({
      Partner: o.name, Reached: o.reached, 'Targeted %': o.targeted_pct ?? '', Sessions: o.sessions, Attendances: o.attendances,
      Outcomes: o.outcomes, 'Latest progress': o.last_progress ? o.last_progress.slice(0, 7) : '',
      'Latest return': o.latest_return ? `${o.latest_return.period.slice(0, 7)} ${o.latest_return.status}` : '',
      Rating: o.latest_return?.rag || '', Action: o.escalation || '',
    }))));

    $('#edit', el)?.addEventListener('click', () => { editing = true; draw(); });
    if (!editing) return;
    // Changing a target makes a new version; linked partners confirm it again.
    $$('[data-change]', el).forEach((b) => b.addEventListener('click', () => {
      const k = p.commitments.find((r) => r.id === b.dataset.change);
      const d = openDrawer('Change target', html`<form class="form" id="revise">
        <label class="f">Wording<textarea name="label" rows="3" maxlength="400" required>${k.label}</textarea></label>
        <label class="f">Target${pct(k) ? ' (%)' : ''}<input type="number" name="target" min="0" step="any" value="${k.target}" required></label>
        <p class="muted small">This is version ${k.version || 1}. Saving makes version ${(k.version || 1) + 1}${orgsOf(k).length ? `; ${orgsOf(k).map((id) => ctx.org(id)?.name).filter(Boolean).join(', ')} will be asked to confirm it again` : ''}. Progress already reported carries over.</p>
        <div class="btns"><button class="btn">Save new version</button></div></form>`);
      $('#revise', d).addEventListener('submit', (e) => {
        e.preventDefault();
        act(e.submitter, async () => {
          must(await db.rpc('revise_commitment', { p_commitment: k.id, p_label: e.target.elements.label.value.trim(), p_target: Number(e.target.elements.target.value) }));
          if (dirty) must(await db.rpc('save_dashboard_draft', { p_consortium: c.id, p_layout: draft }));
          d.close(); toast('Target changed. Partners will confirm the new version.');
          await dashboard(ctx, el, [tab], { editing: true });
        });
      });
    }));
    $('#note', el)?.addEventListener('input', (e) => { draft.note = e.target.value; changed(); });
    $$('[data-pin]', el).forEach((b) => b.addEventListener('change', () => {
      draft.pinned = b.checked ? [...draft.pinned, b.dataset.pin] : draft.pinned.filter((k) => k !== b.dataset.pin);
      changed(); draw();
    }));
    $$('[data-panel]', el).forEach((s) => {
      const k = s.dataset.panel;
      $('[data-move]', s) && $$('[data-move]', s).forEach((b) => b.addEventListener('click', () => {
        const i = draft.order.indexOf(k); const j = i + Number(b.dataset.move);
        [draft.order[i], draft.order[j]] = [draft.order[j], draft.order[i]];
        changed(); draw();
        $(`[data-panel="${k}"] [data-move="${b.dataset.move}"]`, el)?.focus();
      }));
      $('[data-toggle]', s)?.addEventListener('click', () => {
        draft.hidden = draft.hidden.includes(k) ? draft.hidden.filter((h2) => h2 !== k) : [...draft.hidden, k];
        changed(); draw();
      });
      $('[data-funder]', s)?.addEventListener('change', (e) => {
        draft.funder = e.target.checked ? [...draft.funder, k] : draft.funder.filter((f) => f !== k);
        changed();
      });
    });
    const save = async () => { must(await db.rpc('save_dashboard_draft', { p_consortium: c.id, p_layout: draft })); dirty = false; layout.draft_changed = true; };
    $('#save', el).addEventListener('click', (e) => act(e.currentTarget, async () => { await save(); toast('Draft saved.'); draw(); }));
    $('#publish', el).addEventListener('click', (e) => act(e.currentTarget, async () => {
      await save();
      const n = must(await db.rpc('publish_dashboard', { p_consortium: c.id }));
      Object.assign(layout, { version: n, draft_changed: false, published_at: new Date().toISOString() });
      L = fill(draft);
      toast(`Version ${n} published.`);
      draw();
    }));
    $('#done', el).addEventListener('click', () => {
      if (dirty) toast('Unsaved changes kept in this view. Save a draft to keep them.', 'warn');
      editing = false; draw();
    });
    $('#history', el).addEventListener('click', async () => {
      const vs = must(await db.from('dashboard_layout_versions').select('version, snapshot, published_by, published_at').eq('consortium_id', c.id).order('version', { ascending: false }));
      const ids = [...new Set(vs.map((v) => v.published_by).filter(Boolean))];
      const people = ids.length ? must(await db.from('profiles').select('id, full_name, email').in('id', ids)) : [];
      const who = (id) => { const pr = people.find((q) => q.id === id); return pr?.full_name || pr?.email || 'Unknown'; };
      const d = openDrawer('Dashboard history', vs.length ? html`<ul class="rows">${vs.map((v) => html`<li class="row" style="grid-template-columns:minmax(0,1fr) auto">
          <div><strong>Version ${v.version}</strong><span class="muted">${who(v.published_by)} · ${fmtDateTime(v.published_at)}</span>
            ${v.snapshot?.note ? html`<span class="muted">Note: ${v.snapshot.note}</span>` : ''}</div>
          <button class="btn secondary small" data-restore="${v.version}">Restore</button></li>`)}</ul>
        <p class="muted small" style="margin-top:12px">Restoring copies that version into the draft. Publish it to make it live.</p>` : html`<p class="muted">Nothing published yet.</p>`);
      $$('[data-restore]', d || document).forEach((b) => b.addEventListener('click', () => act(b, async () => {
        must(await db.rpc('restore_dashboard_version', { p_consortium: c.id, p_version: Number(b.dataset.restore) }));
        draft = fill(vs.find((v) => v.version === Number(b.dataset.restore)).snapshot);
        layout.draft_changed = true; dirty = false;
        (b.closest('dialog'))?.close();
        toast(`Version ${b.dataset.restore} copied into the draft.`);
        draw();
      })));
    });
  }

  draw();
}
