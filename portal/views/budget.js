// The budget laid out the way the budget document lays it out (for example
// Annex A): the project total, then one table per organisation with the same
// cost categories in the same order and the document's commentary on each,
// then the funding breakdown with its limits. Used on the Targets and budget
// pages; what each person sees is limited by the database.
import { db, html, must, fmtMoney, fmtNum, fmtDateTime } from '../lib.js';

const WORDS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const monthYear = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric' });

// "Year one" and "Oct 2026 – Sep 2027", from the consortium's start date.
export function yearHeading(c, n) {
  const label = `Year ${WORDS[n - 1] || n}`;
  if (!c.start_date) return { label, range: '' };
  const s = new Date(`${c.start_date}T12:00:00`);
  s.setFullYear(s.getFullYear() + n - 1);
  const e = new Date(s);
  e.setFullYear(e.getFullYear() + 1);
  e.setDate(e.getDate() - 1);
  return { label, range: `${monthYear.format(s)} – ${monthYear.format(e)}` };
}

export async function loadBudget(ctx, orgId) {
  const c = ctx.consortium.id;
  let alloc = db.from('allocations').select('*').eq('consortium_id', c).is('superseded_by', null).is('retired_at', null);
  if (orgId) alloc = alloc.eq('organisation_id', orgId);
  const [a, sections, notes, elements, amounts] = await Promise.all([
    alloc.then(must),
    db.from('budget_sections').select('*').eq('consortium_id', c).order('position').then(must),
    db.from('budget_notes').select('*').eq('consortium_id', c).then(must),
    db.from('funding_elements').select('*').eq('consortium_id', c).order('position').then(must),
    db.from('funding_amounts').select('*').eq('consortium_id', c).then(must),
  ]);
  return { alloc: a, sections, notes, elements, amounts };
}

const sum = (rows) => rows.reduce((s, r) => s + Number(r.amount), 0);

// One Annex A style table: cost categories down the side, years across.
function costTable(c, years, categories, rows, noteFor) {
  const lines = [...categories, ...new Set(rows.map((r) => r.budget_line).filter((l) => !categories.includes(l)))];
  const cell = (line, y) => sum(rows.filter((r) => r.budget_line === line && r.year === y));
  return html`<div class="table-wrap"><table class="budget">
    <thead><tr><th>Cost category</th>${years.map((y) => {
      const h = yearHeading(c, y);
      return html`<th class="num">${h.label}${h.range ? html`<br><span class="range">${h.range}</span>` : ''}</th>`;
    })}<th class="num">Total</th></tr></thead>
    <tbody>${lines.map((line) => {
      const note = noteFor(line);
      const total = sum(rows.filter((r) => r.budget_line === line));
      return html`<tr class="${total ? '' : 'nil'}"><td class="cat">${note
        ? html`<details><summary>${line}</summary><p>${note.note}</p>${note.source_reference ? html`<p class="small muted">${note.source_reference}</p>` : ''}</details>`
        : line}</td>
        ${years.map((y) => html`<td class="num">${fmtMoney(cell(line, y))}</td>`)}<td class="num"><strong>${fmtMoney(total)}</strong></td></tr>`;
    })}
    <tr class="total"><td>Total</td>${years.map((y) => html`<td class="num">${fmtMoney(sum(rows.filter((r) => r.year === y)))}</td>`)}<td class="num">${fmtMoney(sum(rows))}</td></tr>
    </tbody></table></div>`;
}

function fundingTable(c, years, elements, amounts) {
  if (!elements.length) return '';
  const amt = (e, y) => Number(amounts.find((a) => a.element_id === e.id && a.year === y)?.amount || 0);
  const tot = (e) => years.reduce((s, y) => s + amt(e, y), 0);
  const top = elements.filter((e) => !e.part_of);
  const grant = top.reduce((s, e) => s + tot(e), 0);
  const share = (e) => {
    const base = e.part_of ? tot(elements.find((p) => p.id === e.part_of)) : grant;
    return base ? (100 * tot(e)) / base : 0;
  };
  const within = (e) => (e.limit_kind === 'max' ? share(e) <= e.limit_pct : share(e) >= e.limit_pct);
  return html`<h3 style="margin-top:26px">Funding breakdown</h3>
    <div class="table-wrap" style="margin-top:10px"><table class="budget">
    <thead><tr><th>Funding element</th>${years.map((y) => html`<th class="num">${yearHeading(c, y).label}</th>`)}<th class="num">Total</th><th class="num">Share</th><th>Limit</th><th>Check</th></tr></thead>
    <tbody>${elements.map((e) => html`<tr class="${e.part_of ? 'sub' : ''}"><td class="cat">${e.label}</td>
      ${years.map((y) => html`<td class="num">${fmtMoney(amt(e, y))}</td>`)}<td class="num"><strong>${fmtMoney(tot(e))}</strong></td>
      <td class="num">${fmtNum(share(e))}%</td>
      <td class="small">${e.limit_kind ? `${e.limit_kind === 'max' ? 'Maximum' : 'Minimum'} ${fmtNum(e.limit_pct)}% of ${e.part_of ? elements.find((p) => p.id === e.part_of)?.label.split(' (')[0].toLowerCase() : 'the grant'}${e.limit_note ? ` ${e.limit_note}` : ''}` : '–'}</td>
      <td>${e.limit_kind ? html`<span class="rag ${within(e) ? 'rag-green' : 'rag-red'}">${within(e) ? 'Within limit' : 'Outside limit'}</span>` : ''}</td></tr>`)}
    <tr class="total"><td>Total</td>${years.map((y) => html`<td class="num">${fmtMoney(top.reduce((s, e) => s + amt(e, y), 0))}</td>`)}<td class="num">${fmtMoney(grant)}</td><td colspan="3"></td></tr>
    </tbody></table></div>`;
}

// opts.project: show the project total and funding breakdown (lead and
// accountable body). Organisations come in the document's order, then any
// others that have money against them.
export function budgetView(ctx, b, opts = {}) {
  const c = ctx.consortium;
  const { alloc, sections, notes, elements, amounts } = b;
  if (!alloc.length) return html`<p class="empty">No budget yet.</p>`;
  const years = [...new Set([...alloc.map((r) => r.year), ...amounts.map((a) => a.year)])].sort((x, y) => x - y);
  const categories = c.budget_categories || [...new Set(alloc.map((r) => r.budget_line))].sort();
  const orgIds = [...sections.map((s) => s.organisation_id), ...new Set(alloc.map((r) => r.organisation_id).filter(Boolean))]
    .filter((id, i, all) => all.indexOf(id) === i && alloc.some((r) => r.organisation_id === id));
  const central = alloc.filter((r) => r.is_central);
  const note = (orgId) => (line) => notes.find((n) => (n.organisation_id || null) === orgId && n.budget_line === line);

  const orgBlock = (id) => {
    const s = sections.find((x) => x.organisation_id === id);
    const rows = alloc.filter((r) => r.organisation_id === id);
    const confirmed = rows.every((r) => r.confirmed_by_partner_at);
    const last = rows.map((r) => r.confirmed_by_partner_at).filter(Boolean).sort().pop();
    return html`<section class="budget-org">
      <header><h3>${s ? html`<span class="muted">${s.title}:</span> ${s.name_in_document || ctx.org(id)?.name}` : ctx.org(id)?.name}</h3>
        <span class="small">${confirmed ? html`<span class="pill pill-confirmed">Confirmed</span> <span class="muted">${fmtDateTime(last)}</span>` : html`<span class="pill pill-proposed">Waiting for ${ctx.org(id)?.name} to confirm</span>`}</span></header>
      ${costTable(c, years, categories, rows, note(id))}</section>`;
  };

  return html`
    ${opts.project ? html`<section class="budget-org"><header><h3>Project total – all organisations</h3>
      ${c.grant_value ? html`<span class="small muted">Grant ${fmtMoney(c.grant_value)}${Math.round(sum(alloc)) !== Math.round(Number(c.grant_value)) ? ` · budget totals ${fmtMoney(sum(alloc))}` : ''}</span>` : ''}</header>
      ${costTable(c, years, categories, alloc, note(null))}</section>` : ''}
    ${orgIds.map(orgBlock)}
    ${central.length ? html`<section class="budget-org"><header><h3>Central costs</h3></header>${costTable(c, years, categories, central, () => null)}</section>` : ''}
    ${opts.project ? fundingTable(c, years, elements, amounts) : ''}
    <p class="small muted" style="margin-top:12px">Open a cost category to read what it covers, as the budget document describes it.</p>`;
}
