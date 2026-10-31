// Team and hubs (the lead only): who is on the lead team in which role,
// the hubs and their delivery days, and the workspace's Lead Workspace
// settings. Partners, the accountable body, funders and youth voice members
// get access only when the lead adds them here by name.
import { html, raw, render, $, $$, db, must, act, toast, icon, pill, openDrawer, formData, emptyState, sectionGroup } from '../../lib.js';
import { ROLE, lw, hubName } from './common.js';

const DAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [7, 'Sun']];
const MEMBER = { lead: 'Lead', accountable_body: 'Accountable body', partner_manager: 'Partner', hub_worker: 'Hub worker', funder_observer: 'Funder', youth_voice: 'Youth voice' };

export default async function team(ctx, el, refresh) {
  const c = ctx.consortium.id;
  const [hubs, settings] = await Promise.all([
    db.from('hubs').select('*').eq('consortium_id', c).order('position').order('name').then(must),
    db.from('lw_settings').select('*').eq('consortium_id', c).maybeSingle().then(must),
  ]);
  const ctxl = lw(ctx);
  const s = settings || { min_on_floor: 5, rota_publish_weeks: 2, activity_plan_due_day: 15, monthly_return_due_day: 5, perf_amber_below: 0.8, perf_red_below: 0.5 };
  const reload = async () => { await ctx.reload(); };
  const external = (p) => p.member_role && !['lead', 'hub_worker'].includes(p.member_role);

  render(el, html`<div class="grid2">
    <section class="panel"><header><h2>The lead team</h2><button class="btn secondary small" id="add-person">${raw(icon('add', 16))}Add someone</button></header>
      <p class="small muted">Only people listed here can open the Lead Workspace. Anyone from a partner, the accountable body, a funder or youth voice is shown with their organisation.</p>
      ${Object.entries(ROLE).map(([k, label]) => { const ps = ctxl.team.filter((p) => p.roles.includes(k)); return sectionGroup({ title: label, meta: `${ps.length}`, open: ps.length > 0 && ps.length < 6,
        body: ps.length ? html`<ul class="lw-list">${ps.map((p) => html`<li class="lw-row static"><span class="lw-row-main"><strong>${p.name}</strong>
          <span class="muted small">${p.org || ''}${external(p) ? ` · ${MEMBER[p.member_role]} (invited by name)` : ''}${p.hubs.length ? ` · ${p.hubs.map((h) => hubName(ctx, h)).join(', ')}` : ''}</span></span>
          <span class="lw-row-tags">${p.rows.filter((r) => r.role === k).map((r) => html`<button type="button" class="btn secondary small" data-rm="${r.id}">Remove${r.hub_id ? ` from ${hubName(ctx, r.hub_id)}` : ''}</button>`)}
            ${k === 'lead' && !p.rows.some((r) => r.role === 'lead') ? html`<span class="muted small">Consortium lead</span>` : ''}</span></li>`)}</ul>` : html`<p class="muted small">Nobody yet.</p>` }); })}</section>
    <section class="panel"><header><h2>Hubs</h2><button class="btn secondary small" id="add-hub">${raw(icon('add', 16))}Add hub</button></header>
      ${hubs.length ? html`<ul class="lw-list">${hubs.map((h) => html`<li><button type="button" class="lw-row" data-hub="${h.id}"><span class="lw-row-main"><strong>${h.name}</strong>
        <span class="muted small">${h.site_id ? ctx.site(h.site_id)?.name || '' : 'No site linked'} · ${DAYS.filter(([d]) => h.delivery_days.includes(d)).map(([, l]) => l).join(', ')}</span></span></button></li>`)}</ul>`
        : emptyState('sites', 'No hubs yet. Add one for each place the lead team runs sessions.')}</section>
    <section class="panel"><header><h2>Settings</h2></header><form class="form" id="set-form">
      <div class="fields"><label class="f">Minimum on the floor<input type="number" name="min_on_floor" min="1" max="50" value="${s.min_on_floor}"></label>
        <label class="f">Publish rotas, weeks ahead<input type="number" name="rota_publish_weeks" min="0" max="12" value="${s.rota_publish_weeks}"></label></div>
      <div class="fields"><label class="f">Activity plans due on day<input type="number" name="activity_plan_due_day" min="1" max="28" value="${s.activity_plan_due_day}"></label>
        <label class="f">Partner returns due on day<input type="number" name="monthly_return_due_day" min="1" max="28" value="${s.monthly_return_due_day}"></label></div>
      <div class="fields"><label class="f">Amber below (% of profile)<input type="number" name="amber" min="0" max="200" value="${Math.round(s.perf_amber_below * 100)}"></label>
        <label class="f">Red below (% of profile)<input type="number" name="red" min="0" max="200" value="${Math.round(s.perf_red_below * 100)}"></label></div>
      <div class="btns"><button class="btn">Save settings</button></div></form></section></div>`);

  $('#set-form', el).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => { const f = formData(e.target);
    must(await db.from('lw_settings').upsert({ consortium_id: c, min_on_floor: Number(f.min_on_floor), rota_publish_weeks: Number(f.rota_publish_weeks),
      activity_plan_due_day: Number(f.activity_plan_due_day), monthly_return_due_day: Number(f.monthly_return_due_day),
      perf_amber_below: Number(f.amber) / 100, perf_red_below: Number(f.red) / 100 }, { onConflict: 'consortium_id' })); toast('Saved.'); }); });

  $('#add-person', el).addEventListener('click', () => {
    const d = openDrawer('Add someone to the lead team', html`<form class="form" id="tm-form">
      <label class="f">Person<select name="user" required><option value="">Choose</option>${ctxl.people.map((p) => html`<option value="${p.user_id}">${p.name} · ${p.org || ''} · ${MEMBER[p.member_role] || p.member_role}</option>`)}</select></label>
      <p class="small muted">Only people already in this workspace. Invite new people on the People page first.</p>
      <label class="f">Role<select name="role">${Object.entries(ROLE).map(([k, v]) => html`<option value="${k}">${v}</option>`)}</select></label>
      <label class="f" id="hub-f">Hub<select name="hub">${hubs.map((h) => html`<option value="${h.id}">${h.name}</option>`)}</select></label>
      <p class="small" id="warn" hidden></p>
      <div class="btns"><button class="btn">Add</button></div></form>`);
    const sync = () => {
      const f = formData($('#tm-form', d));
      $('#hub-f', d).hidden = !['hub_lead', 'hub_staff'].includes(f.role);
      const p = ctxl.people.find((x) => x.user_id === f.user);
      const w = $('#warn', d);
      w.hidden = !(p && external(p));
      w.textContent = p && external(p) ? `${p.name} is ${MEMBER[p.member_role] === 'Partner' ? 'from a partner' : `in the ${MEMBER[p.member_role]?.toLowerCase()} role`}. Adding them gives them this Lead Workspace role, by name, on top of their own access.` : '';
    };
    $('#tm-form', d).addEventListener('change', sync); sync();
    $('#tm-form', d).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => { const f = formData(e.target);
      const hub = ['hub_lead', 'hub_staff'].includes(f.role) ? f.hub : null;
      if (['hub_lead', 'hub_staff'].includes(f.role) && !hub) throw new Error('Add a hub first.');
      must(await db.from('lw_team').insert({ consortium_id: c, user_id: f.user, role: f.role, hub_id: hub }));
      d.close(); toast('Added.'); await reload(); }); });
  });
  $$('[data-rm]', el).forEach((b) => b.addEventListener('click', () => act(b, async () => {
    if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Remove: sure?'; return; }
    must(await db.from('lw_team').delete().eq('id', b.dataset.rm)); toast('Removed.'); await reload();
  })));

  const hubForm = (h = {}) => html`<form class="form" id="hb-form"><label class="f">Name<input name="name" required maxlength="120" value="${h.name || ''}"></label>
    <label class="f">Site<select name="site"><option value="">No site</option>${ctx.sites.map((x) => html`<option value="${x.id}" ${raw(h.site_id === x.id ? 'selected' : '')}>${x.name}</option>`)}</select></label>
    <fieldset><legend>Delivery days</legend><div class="checks">${DAYS.map(([n, l]) => html`<label class="check"><input type="checkbox" name="day" value="${n}" ${raw((h.delivery_days || [6]).includes(n) ? 'checked' : '')}> ${l}</label>`)}</div></fieldset>
    <p class="small muted">Delivery-day checklists and rotas follow these days.</p><div class="btns"><button class="btn">Save</button></div></form>`;
  const readHub = (form) => { const f = formData(form); return { name: f.name, site_id: f.site || null, delivery_days: $$('[name=day]:checked', form).map((x) => Number(x.value)) }; };
  $('#add-hub', el).addEventListener('click', () => { const d = openDrawer('Add a hub', hubForm());
    $('#hb-form', d).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => { const row = readHub(e.target);
      if (!row.delivery_days.length) throw new Error('Pick at least one delivery day.');
      must(await db.from('hubs').insert({ consortium_id: c, ...row, position: hubs.length })); d.close(); toast('Hub added.'); await reload(); }); }); });
  $$('[data-hub]', el).forEach((b) => b.addEventListener('click', () => { const h = hubs.find((x) => x.id === b.dataset.hub); const d = openDrawer(h.name, hubForm(h));
    $('#hb-form', d).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => { const row = readHub(e.target);
      if (!row.delivery_days.length) throw new Error('Pick at least one delivery day.');
      must(await db.from('hubs').update(row).eq('id', h.id)); d.close(); await reload(); }); }); }));
  void pill; void refresh;
}
