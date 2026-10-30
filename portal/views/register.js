// Young person register. One record per young person across the consortium:
// registering someone already on the register links them to your
// organisation instead of counting them again. Each partner sees only the
// young people it works with.
import { db, html, render, $, $$, formData, toast, act, must, fmtDate, ageOn, today } from '../lib.js';

export function registerForm(ctx, { id = 'reg-form', compact = false } = {}) {
  const c = ctx.consortium;
  const mySites = ctx.sites.filter((s) => !s.organisation_id || s.organisation_id === ctx.orgId);
  return html`<form class="form" id="${id}">
    ${!c.allow_real_records ? html`<div class="banner warn small">Demo mode: use made-up details only.</div>` : ''}
    <div class="fields">
      <label class="f">First name<input name="first" autocomplete="off" required></label>
      <label class="f">Last name<input name="last" autocomplete="off" required></label>
      <label class="f">Date of birth<input type="date" name="dob" required max="${today()}"></label>
      <label class="f">Postcode<input name="postcode" autocomplete="off" required></label>
      ${compact ? '' : html`<label class="f">Site<select name="site"><option value="">Choose…</option>${mySites.map((s) => html`<option value="${s.id}">${s.name}</option>`)}</select></label>`}
    </div>
    <fieldset><legend>Who gave consent to register</legend><div class="checks">
      <label class="check"><input type="radio" name="consent_by" value="young_person" required> The young person (16 or over)</label>
      <label class="check"><input type="radio" name="consent_by" value="parent_or_carer"> A parent or carer</label>
    </div></fieldset>
    ${c.targeted_criteria.length ? html`<fieldset><legend>Targeted (tick any that apply)</legend><div class="checks">
      ${c.targeted_criteria.map((t) => html`<label class="check"><input type="checkbox" name="reasons" value="${t}" data-multi="1"> ${t}</label>`)}
    </div></fieldset>` : ''}
    <label class="check"><input type="checkbox" name="photo_consent"> Consent given for photos and stories</label>
    <div class="btns"><button class="btn">Register</button></div>
  </form>`;
}

// Returns the young person's id, and tells the worker if they were already
// on the register.
export async function submitRegistration(ctx, form, siteId) {
  const f = formData(form);
  const reasons = f.reasons || [];
  const res = must(await db.rpc('register_young_person', {
    p_consortium: ctx.consortium.id, p_site: siteId ?? f.site, p_first: f.first, p_last: f.last, p_dob: f.dob,
    p_postcode: f.postcode, p_targeted: reasons.length > 0, p_reasons: reasons, p_consent_by: f.consent_by,
    p_photo_consent: !!f.photo_consent,
  }));
  toast(res.existing
    ? `Already on the register (added by ${res.registered_by} on ${fmtDate(res.registered_at)}). Linked to you, not counted again.`
    : 'Registered.');
  return res.id;
}

export default async function register(ctx, el, [ypId]) {
  if (ypId) return detail(ctx, el, ypId);
  const people = must(await db.from('young_people')
    .select('id, first_name, last_name, date_of_birth, postcode, targeted, is_demo, organisation_id, site_id, registered_at')
    .eq('consortium_id', ctx.consortium.id).order('last_name').order('first_name'));

  render(el, html`
    <div class="page-head"><div><span class="eyebrow">Young people</span><h1>Register</h1>
      <p class="muted">Young people ${ctx.orgName} works with. Everyone is registered once across the whole consortium and counted as new only then.</p></div></div>
    <div class="grid2">
      <section class="panel"><header><h2>${people.length} young ${people.length === 1 ? 'person' : 'people'}</h2></header>
        <label class="f" style="margin-top:12px">Find someone<input type="search" id="find" placeholder="Name or postcode"></label>
        ${people.length ? html`<div class="table-wrap" style="margin-top:10px"><table id="yp-table">
          <thead><tr><th>Name</th><th>Age</th><th>Postcode</th><th>Registered</th></tr></thead>
          <tbody>${people.map((p) => html`<tr data-q="${`${p.first_name} ${p.last_name} ${p.postcode}`.toLowerCase()}">
            <td><a href="#/c/${ctx.consortium.id}/register/${p.id}">${p.first_name} ${p.last_name}</a>
              ${p.targeted ? html` <span class="pill pill-submitted">Targeted</span>` : ''}${p.is_demo ? html` <span class="pill pill-demo">Demo</span>` : ''}</td>
            <td>${ageOn(p.date_of_birth)}</td><td class="nowrap">${p.postcode}</td>
            <td class="nowrap small">${fmtDate(p.registered_at)}${p.organisation_id !== ctx.orgId ? html`<br><span class="muted">by ${ctx.org(p.organisation_id)?.name}</span>` : ''}</td>
          </tr>`)}</tbody></table></div>` : html`<p class="empty">No one registered yet.</p>`}
      </section>
      <section class="panel"><h2>Register a young person</h2>
        <p class="muted small">Ages ${ctx.consortium.min_age} to ${ctx.consortium.max_age}. We check name, date of birth and postcode against the whole consortium so nobody is counted twice.</p>
        ${registerForm(ctx)}
      </section>
    </div>`);

  $('#find')?.addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    $$('#yp-table tbody tr').forEach((tr) => { tr.hidden = q && !tr.dataset.q.includes(q); });
  });
  $('#reg-form').addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      const id = await submitRegistration(ctx, e.target);
      location.hash = `#/c/${ctx.consortium.id}/register/${id}`;
    });
  });
}

async function detail(ctx, el, id) {
  const c = ctx.consortium;
  const p = must(await db.from('young_people').select('*').eq('id', id).maybeSingle());
  if (!p) { render(el, html`<div class="panel">That record isn't available to you.</div>`); return; }
  db.rpc('log_view', { p_young_person: id });
  const [visits, outcomes, measures] = await Promise.all([
    db.from('attendance').select('id, sessions(session_date, title, site_id)').eq('young_person_id', id).then(must),
    db.from('outcomes').select('id, achieved_on, note, outcome_measures(label)').eq('young_person_id', id).order('achieved_on', { ascending: false }).then(must),
    db.from('outcome_measures').select('id, label').eq('consortium_id', c.id).eq('active', true).order('label').then(must),
  ]);
  visits.sort((a, b) => (b.sessions?.session_date || '').localeCompare(a.sessions?.session_date || ''));

  render(el, html`
    <p class="small" style="margin-bottom:10px"><a href="#/c/${c.id}/register">← All young people</a></p>
    <div class="page-head"><div><span class="eyebrow">Young person</span><h1>${p.first_name} ${p.last_name}</h1>
      <p class="muted">Age ${ageOn(p.date_of_birth)} · ${p.postcode}${p.is_demo ? ' · demo record' : ''}</p></div></div>
    <div class="grid2">
      <section class="panel"><h2>Details</h2>
        <dl class="facts">
          <dt>Date of birth</dt><dd>${fmtDate(p.date_of_birth)}</dd>
          <dt>Registered</dt><dd>${fmtDate(p.registered_at)} by ${ctx.org(p.organisation_id)?.name}</dd>
          <dt>Site</dt><dd>${ctx.site(p.site_id)?.name || '–'}</dd>
          <dt>Consent</dt><dd>${p.consent_by === 'parent_or_carer' ? 'Parent or carer' : 'Young person'}</dd>
          <dt>Photos and stories</dt><dd>${p.photo_consent ? 'Consent given' : 'No consent'}</dd>
          <dt>Targeted</dt><dd>${p.targeted ? p.targeted_reasons.join(', ') : 'No'}</dd>
          <dt>Visits</dt><dd>${visits.length}</dd>
        </dl>
        <details class="add" style="margin-top:14px"><summary>Update details</summary>
          <form class="form" id="edit-yp"><div class="fields">
            <label class="f">First name<input name="first_name" value="${p.first_name}" required></label>
            <label class="f">Last name<input name="last_name" value="${p.last_name}" required></label>
            <label class="f">Postcode<input name="postcode" value="${p.postcode}" required></label></div>
            ${c.targeted_criteria.length ? html`<fieldset><legend>Targeted</legend><div class="checks">
              ${c.targeted_criteria.map((t) => html`<label class="check"><input type="checkbox" name="reasons" value="${t}" data-multi="1" ${p.targeted_reasons.includes(t) ? 'checked' : ''}> ${t}</label>`)}
            </div></fieldset>` : ''}
            <label class="check"><input type="checkbox" name="photo_consent" ${p.photo_consent ? 'checked' : ''}> Consent given for photos and stories</label>
            <p class="muted small">Date of birth can't be changed here because it's used to stop double counting. Ask your lead if it's wrong.</p>
            <div class="btns"><button class="btn">Save</button></div></form></details>
      </section>
      <section class="panel"><h2>Outcomes</h2>
        ${outcomes.length ? html`<ul>${outcomes.map((o) => html`<li><strong>${o.outcome_measures?.label}</strong>, ${fmtDate(o.achieved_on)}${o.note ? html` <span class="muted small">${o.note}</span>` : ''}</li>`)}</ul>`
        : html`<p class="empty">None recorded yet.</p>`}
        ${measures.length ? html`<details class="add" style="margin-top:14px"><summary>Record an outcome</summary>
          <form class="form" id="add-outcome"><div class="fields">
            <label class="f">Outcome<select name="measure_id" required>${measures.map((m) => html`<option value="${m.id}">${m.label}</option>`)}</select></label>
            <label class="f">Date achieved<input type="date" name="achieved_on" value="${today()}" max="${today()}" required></label></div>
            <label class="f">Short note<span class="hint">Evidence only, for example "completed Level 1 award". Never safeguarding or health details.</span><input name="note" maxlength="200"></label>
            <div class="btns"><button class="btn">Record outcome</button></div></form></details>`
        : html`<p class="muted small">Your lead hasn't set up the outcome framework yet.</p>`}
      </section>
    </div>
    <section class="panel" style="margin-top:20px"><h2>Attendance</h2>
      ${visits.length ? html`<div class="table-wrap"><table><thead><tr><th>Date</th><th>Session</th><th>Site</th></tr></thead>
        <tbody>${visits.map((v) => html`<tr><td class="nowrap">${fmtDate(v.sessions?.session_date)}</td><td>${v.sessions?.title}</td><td>${ctx.site(v.sessions?.site_id)?.name || ''}</td></tr>`)}</tbody></table></div>`
      : html`<p class="empty">No visits recorded by ${ctx.orgName} yet.</p>`}
    </section>`);

  $('#edit-yp').addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      const f = formData(e.target);
      const reasons = f.reasons || [];
      must(await db.from('young_people').update({
        first_name: f.first_name, last_name: f.last_name, postcode: f.postcode.toUpperCase(),
        targeted: reasons.length > 0, targeted_reasons: reasons, photo_consent: !!f.photo_consent,
      }).eq('id', id));
      toast('Saved.'); detail(ctx, el, id);
    });
  });
  $('#add-outcome')?.addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      must(await db.from('outcomes').insert({ ...formData(e.target), consortium_id: c.id, organisation_id: ctx.orgId, young_person_id: id, created_by: ctx.user.id }));
      toast('Outcome recorded.'); detail(ctx, el, id);
    });
  });
}
