// Compliance: one row per organisation (profile completeness, documents
// approved, missing and expiring, next expiry) for the consortium lead and
// lead organisation, and the workspace's assurance pack: which document
// types every organisation here must provide.
import { db, html, render, $$, must, act, toast, pill, fmtDate, daysUntil, sectionGroup, statCard } from '../lib.js';
import { ring } from './profile.js';

const GROUPS = [['governance', 'Governance'], ['safeguarding', 'Safeguarding'], ['insurance', 'Insurance'], ['policies', 'Policies'], ['evidence', 'Evidence']];

export default async function compliance(ctx, el) {
  const c = ctx.consortium;
  const [rows, types, reqs] = await Promise.all([
    db.rpc('compliance_overview', { p_consortium: c.id }).then(must),
    db.from('document_types').select('*').eq('active', true).order('position').then(must),
    db.from('workspace_document_requirements').select('type_key').eq('consortium_id', c.id).then(must),
  ]);
  const required = new Set(reqs.map((r) => r.type_key));
  const expiring = rows.reduce((n, r) => n + r.expiring, 0);
  const toReview = rows.reduce((n, r) => n + r.to_review, 0);
  render(el, html`
    <div class="page-head"><div><span class="eyebrow">Compliance</span><h1>Compliance</h1>
      <p class="muted">Each organisation's profile and documents. Documents are uploaded once and count in every workspace that needs them.</p></div></div>
    <div class="stats stats-4">
      ${statCard({ icon: 'partners', value: rows.length, label: 'Organisations' })}
      ${statCard({ icon: 'submitted', value: toReview, label: 'To review', trend: { dir: 'flat', tone: toReview ? 'amber' : 'green', text: 'uploaded, waiting for you' } })}
      ${statCard({ icon: 'overdue', value: rows.reduce((n, r) => n + r.missing, 0), label: 'Missing', trend: { dir: 'flat', tone: 'grey', text: 'required, missing or expired' } })}
      ${statCard({ icon: 'expiry', value: expiring, label: 'Expiring soon', trend: { dir: 'flat', tone: 'grey', text: 'in the next 60 days' } })}</div>
    <div class="dgrid">
      <section class="dcard full"><header class="dcard-head"><h2>Organisations</h2><p>Open one to review its documents.</p></header>
        <div class="table-wrap"><table><thead><tr><th>Organisation</th><th>Profile</th><th class="num">Approved</th><th class="num">Missing</th><th class="num">To review</th><th class="num">Expiring</th><th>Next expiry</th></tr></thead>
          <tbody>${rows.map((r) => html`<tr><td><a href="#/c/${c.id}/profile/${r.organisation_id}">${r.name}</a></td>
            <td><span class="ring-cell">${ring(r.completeness.score, 40)}</span></td><td class="num">${r.approved}</td>
            <td class="num ${r.missing ? 'warn-text' : ''}">${r.missing}</td><td class="num">${r.to_review ? pill('blue', `${r.to_review}`) : '0'}</td><td class="num">${r.expiring}</td>
            <td>${r.next_expiry ? html`${fmtDate(r.next_expiry)} <span class="small muted">(${daysUntil(r.next_expiry)} days)</span>` : '–'}</td></tr>`)}</tbody></table></div></section>
      <section class="dcard full"><header class="dcard-head"><h2>Assurance pack</h2><p>The document types every organisation in this workspace must provide.${ctx.manages ? ' Tick to require one.' : ''}</p></header>
        ${GROUPS.map(([g, label], i) => { const ts = types.filter((t) => t.group_name === g); return ts.length ? sectionGroup({ title: label, meta: `${ts.filter((t) => required.has(t.key)).length} of ${ts.length} required`, open: i === 0,
          body: html`<div class="checks">${ts.map((t) => html`<label class="check"><input type="checkbox" data-req="${t.key}" ${required.has(t.key) ? 'checked' : ''} ${ctx.manages ? '' : 'disabled'}> ${t.label}${t.expires ? html` <span class="muted small">(expires)</span>` : ''}</label>`)}</div>` }) : ''; })}</section>
    </div>`);
  $$('[data-req]', el).forEach((b) => b.addEventListener('change', () => act(b, async () => {
    if (b.checked) must(await db.from('workspace_document_requirements').insert({ consortium_id: c.id, type_key: b.dataset.req }));
    else must(await db.from('workspace_document_requirements').delete().eq('consortium_id', c.id).eq('type_key', b.dataset.req));
    toast(b.checked ? 'Now required in this workspace.' : 'No longer required.');
  })));
}
