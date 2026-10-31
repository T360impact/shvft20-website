// Organisations: every organisation in the workspace, for the consortium
// lead, grouped by its relationship, with its people, profile completeness
// and compliance. Edit, change the relationship (which decides whether it
// appears in targets, budget and returns), or remove it from this workspace
// (its people lose access here only; its records stay).
import { db, html, raw, render, $, $$, must, act, toast, icon, pill, openDrawer, formData, sectionGroup, emptyState, statCard } from '../lib.js';
import { ring } from './profile.js';
import { RELATIONSHIP } from './team.js';

const ORDER = ['shvft_team', 'lead_organisation', 'delivery_partner', 'referral_partner', 'site_owner', 'staffing_provider', 'youth_voice', 'funder', 'other'];

export default async function organisations(ctx, el) {
  const c = ctx.consortium;
  const rows = must(await db.rpc('workspace_organisations', { p_consortium: c.id }));
  const live = rows.filter((r) => !r.removed_at);
  const removed = rows.filter((r) => r.removed_at);
  const again = () => ctx.reload();
  const compliance = (r) => (!r.pack ? html`<span class="small muted">Not asked</span>`
    : r.pack.missing ? pill('amber', `${r.pack.missing} missing`) : pill('green', `${r.pack.provided} of ${r.pack.total}`));
  const row = (r) => html`<li class="lw-row static"><span class="lw-row-main"><strong>${r.name}</strong>
      <span class="muted small">${r.people} ${r.people === 1 ? 'person' : 'people'}${r.invited ? ` · ${r.invited} invited` : ''}${r.needs_profile && !r.people ? ' · new, waiting for its first person' : ''}</span></span>
    <span class="lw-row-tags">${r.completeness ? html`<span class="ring-cell" title="Profile ${r.completeness.score}% complete">${ring(r.completeness.score, 40)}</span>` : ''}
      ${compliance(r)}
      <a class="btn secondary small" href="#/c/${c.id}/team/invite/${r.organisation_id}">Invite</a>
      <button type="button" class="btn secondary small" data-edit="${r.organisation_id}">Edit</button></span></li>`;
  const groups = ORDER.map((k) => [k, live.filter((r) => r.relationship === k)]).filter(([, xs]) => xs.length);
  render(el, html`
    <div class="page-head"><div><span class="eyebrow">Organisations</span><h1>Organisations</h1>
      <p class="muted">Everyone's organisation in this workspace. Only delivery partners appear in targets, budget and returns.</p></div>
      <div class="btns"><a class="btn" href="#/c/${c.id}/team">${raw(icon('add', 16))}Invite someone</a></div></div>
    <div class="stats stats-4">
      ${statCard({ icon: 'partners', value: live.length, label: 'Organisations' })}
      ${statCard({ icon: 'delivery', value: live.filter((r) => r.relationship === 'delivery_partner').length, label: 'Delivery partners' })}
      ${statCard({ icon: 'people', value: live.reduce((n, r) => n + r.people, 0), label: 'People', trend: { dir: 'flat', tone: 'grey', text: `${live.reduce((n, r) => n + r.invited, 0)} invited` } })}
      ${statCard({ icon: 'compliance', value: live.filter((r) => r.pack?.missing).length, label: 'With documents missing', trend: { dir: 'flat', tone: live.some((r) => r.pack?.missing) ? 'amber' : 'green', text: 'from the assurance pack' } })}</div>
    <section class="dcard full">${groups.length ? groups.map(([k, xs], i) => sectionGroup({ title: RELATIONSHIP[k], meta: `${xs.length}`, open: i < 3, body: html`<ul class="lw-list">${xs.map(row)}</ul>` }))
      : emptyState('partners', 'No organisations yet.', html`<a class="btn" href="#/c/${c.id}/team">Invite someone</a>`)}
      ${removed.length ? sectionGroup({ title: 'Removed from this workspace', meta: `${removed.length}`, body: html`<ul class="lw-list">${removed.map((r) => html`<li class="lw-row static">
        <span class="lw-row-main"><strong>${r.name}</strong><span class="muted small">${RELATIONSHIP[r.relationship]}</span></span>
        <span class="lw-row-tags">${r.partner_id ? html`<button type="button" class="btn secondary small" data-back="${r.organisation_id}">Add back</button>` : ''}</span></li>`)}</ul>` }) : ''}</section>`);

  $$('[data-back]', el).forEach((b) => b.addEventListener('click', () => act(b, async () => {
    const r = removed.find((x) => x.organisation_id === b.dataset.back);
    must(await db.rpc('add_organisation', { p_consortium: c.id, p_relationship: r.relationship, p_partner: r.partner_id })); toast(`${r.name} is back. Invite its people again.`); again();
  })));
  $$('[data-edit]', el).forEach((b) => b.addEventListener('click', () => {
    const r = live.find((x) => x.organisation_id === b.dataset.edit);
    const own = r.organisation_id === ctx.orgId;
    const d = openDrawer(r.name, html`<form class="form" id="org-form">
      <label class="f">Name in this workspace<input name="name" required maxlength="200" value="${r.name}"></label>
      <label class="f">Contact email<input type="email" name="contact_email" value="${r.contact_email || ''}"></label>
      <div class="btns"><button class="btn">Save</button><a class="btn secondary" href="#/c/${c.id}/profile/${r.organisation_id}">Profile and documents</a></div></form>
      <form class="form" id="rel-form" style="margin-top:20px"><label class="f">Relationship to this workspace<span class="hint">Delivery partners appear in targets, budget and returns. Changing it doesn't change anyone's role: do that on People.</span>
        <select name="relationship">${Object.entries(RELATIONSHIP).filter(([k]) => k !== 'shvft_team' || ctx.isAdmin || r.relationship === 'shvft_team').map(([k, t]) => html`<option value="${k}" ${k === r.relationship ? 'selected' : ''}>${t}</option>`)}</select></label>
        <div class="btns"><button class="btn secondary">Change relationship</button></div></form>
      ${own ? '' : html`<div style="margin-top:20px"><h3 class="small-head">Remove from this workspace</h3>
        <p class="small muted">${r.people} ${r.people === 1 ? 'person loses' : 'people lose'} access to this workspace only; pending invitations are cancelled. Its records and its other workspaces are untouched.</p>
        <div class="btns" id="rm-box"><button type="button" class="btn secondary" id="rm">Remove ${r.name}</button></div></div>`}`);
    $('#org-form', d).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => {
      const f = formData(e.target); must(await db.from('organisations').update({ name: f.name, contact_email: f.contact_email || null }).eq('id', r.organisation_id)); d.close(); toast('Saved.'); again(); }); });
    $('#rel-form', d).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => {
      must(await db.rpc('set_relationship', { p_org: r.organisation_id, p_relationship: formData(e.target).relationship })); d.close(); toast('Relationship changed.'); again(); }); });
    // Removing asks once more on the page itself.
    $('#rm', d)?.addEventListener('click', () => {
      render($('#rm-box', d), html`<button type="button" class="btn danger" id="rm-yes">Yes, remove ${r.name}</button><button type="button" class="btn secondary" id="rm-no">Keep it</button>`);
      $('#rm-no', d).addEventListener('click', () => d.close());
      $('#rm-yes', d).addEventListener('click', (e) => act(e.currentTarget, async () => {
        const n = must(await db.rpc('remove_organisation', { p_org: r.organisation_id })); d.close(); toast(`${r.name} removed. ${n} ${n === 1 ? 'person' : 'people'} lost access here.`); again(); }));
    });
  }));
}
