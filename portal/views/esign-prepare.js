// Preparing an agreement for signature: its details, the document (an
// upload or a template with merge fields), who signs in what order, and the
// side panels for the lead's other actions. The signing page itself is in
// esign.js. Every change goes through the database's agreement functions
// or the agreements edge function; nothing writes to the tables directly.
import { db, html, raw, render, $, $$, formData, toast, act, must, icon, openDrawer, uploadType, fmtDate, ROLE_LABEL } from '../lib.js';
import { mergeTemplate, unfilledFields } from '../calc.js';

export const TYPE = {
  grant_agreement: 'Grant agreement', sub_contract: 'Sub-contract', consortium_agreement: 'Consortium agreement', data_sharing_agreement: 'Data sharing agreement',
  site_agreement: 'Site agreement', referral_pathway: 'Referral pathway', staffing_agreement: 'Staffing agreement', services_agreement: 'Services agreement',
  partner_schedule: 'Partner schedule', policy_acknowledgement: 'Policy acknowledgement', other: 'Other',
};
export const VISIBILITY = { parties: 'The parties only', members: 'Everyone in the workspace', lead: 'The lead and accountable body only' };
const MERGE_HELP = { workspace: 'Workspace name', lead_organisation: 'Lead organisation', accountable_body: 'Accountable body', partner: 'The partner',
  start_date: 'Programme start', end_date: 'Programme end', today: 'Today\'s date', allocation_total: 'Partner\'s allocation', allocation_by_year: 'Allocation by year', targets: 'Partner\'s targets' };

// The agreements edge function returns its own error text (and a hint, such as "reconfirm").
export async function esignCall(body) {
  const { data, error } = await db.functions.invoke('agreements', { body });
  if (error) {
    let message = error.message; let hint;
    try { const j = await error.context.json(); message = j.error || message; hint = j.hint; } catch { /* keep the generic message */ }
    throw Object.assign(new Error(message), { hint });
  }
  return data;
}

// Workspace members (and pending invitations) who could be asked to sign.
export async function signerChoices(ctx) {
  const ms = must(await db.from('memberships').select('user_id, organisation_id, role').eq('consortium_id', ctx.consortium.id).eq('active', true));
  const ids = ms.map((m) => m.user_id);
  const ps = ids.length ? must(await db.from('profiles').select('id, full_name, email, job_title').in('id', ids)) : [];
  const invites = ctx.manages ? must(await db.from('invitations').select('email, full_name, organisation_id, role').eq('consortium_id', ctx.consortium.id).eq('status', 'pending')) : [];
  const byId = Object.fromEntries(ps.map((p) => [p.id, p]));
  return [
    ...ms.map((m) => ({ key: m.user_id, profile_id: m.user_id, name: byId[m.user_id]?.full_name || byId[m.user_id]?.email || 'Member', title: byId[m.user_id]?.job_title || '',
      organisation_id: m.organisation_id, role: m.role })),
    ...invites.map((i) => ({ key: `invite:${i.email}`, email: i.email, name: `${i.full_name || i.email} (invited)`, title: '', organisation_id: i.organisation_id, role: i.role })),
  ].sort((a, b) => a.name.localeCompare(b.name));
}

const orgOptions = (ctx, chosen = []) => ctx.orgs.map((o) => html`<label class="check"><input type="checkbox" name="parties" value="${o.id}" ${raw(chosen.includes(o.id) ? 'checked' : '')}> ${o.name}</label>`);
const partiesOf = (form) => $$('input[name=parties]:checked', form).map((x) => x.value);

// ------------------------------------------------------------ new agreement

export function newAgreement(ctx, done, { type = 'sub_contract' } = {}) {
  const lw = ctx.lwAgreements || [];
  const sched = ctx.schedules || [];
  const d = openDrawer(type === 'policy_acknowledgement' ? 'Send a policy for acknowledgement' : 'New agreement', html`<form class="form" id="ag-new">
    <div class="fields">
      <label class="f">Title<input name="title" required maxlength="200" placeholder="${type === 'policy_acknowledgement' ? 'e.g. Safeguarding protocol 2026' : 'e.g. Sub-contract: Partner name'}"></label>
      <label class="f">Type<select name="type">${Object.entries(TYPE).map(([k, v]) => html`<option value="${k}" ${raw(k === type ? 'selected' : '')}>${v}</option>`)}</select></label>
    </div>
    <fieldset class="f ag-parties" ${raw(type === 'policy_acknowledgement' ? 'hidden' : '')}><legend>Parties</legend><div class="checks">${orgOptions(ctx)}</div></fieldset>
    <div class="fields">
      <label class="f">Who can see it<select name="visibility">${Object.entries(VISIBILITY).map(([k, v]) => html`<option value="${k}">${v}</option>`)}</select><span class="hint">Signers always see what they're asked to sign.</span></label>
      <label class="f">Effective from<input type="date" name="effective_date"></label>
      <label class="f">Expires<input type="date" name="expiry_date"></label>
      <label class="f">Review by<input type="date" name="review_date"></label>
    </div>
    <label class="check"><input type="checkbox" name="requires_deed"> It must be executed as a deed (signed outside the portal, then uploaded)</label>
    <label class="check"><input type="checkbox" name="shared_with_funder"> Share it with the funder once sent</label>
    ${lw.length ? html`<label class="f">Lead Workspace agreement it settles<select name="lw_agreement_id"><option value="">None</option>${lw.map((a) => html`<option value="${a.id}">${a.name}${a.blocks_first_session ? ' (blocks first session)' : ''}</option>`)}</select>
      <span class="hint">When it's signed, the board shows it signed and any "blocks first session" flag clears.</span></label>` : ''}
    ${sched.length ? html`<label class="f">Partner schedule it replaces<select name="partner_schedule_id"><option value="">None</option>${sched.map((s) => html`<option value="${s.id}">${ctx.org(s.organisation_id)?.name}: ${s.title}</option>`)}</select></label>` : ''}
    <div class="btns"><button class="btn">Create draft</button></div></form>`);
  const f = $('#ag-new', d);
  f.elements.type.addEventListener('change', () => { $('.ag-parties', f).hidden = f.elements.type.value === 'policy_acknowledgement'; });
  if (type === 'policy_acknowledgement') f.elements.visibility.value = 'members';
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      const v = formData(f);
      const id = must(await db.rpc('agreement_create', { p_consortium: ctx.consortium.id, p_title: v.title, p_type: v.type, p_parties: v.type === 'policy_acknowledgement' ? [] : partiesOf(f),
        p_visibility: v.visibility, p_requires_deed: !!v.requires_deed, p_effective: v.effective_date || null, p_expiry: v.expiry_date || null, p_review: v.review_date || null,
        p_shared_with_funder: !!v.shared_with_funder, p_lw_agreement: v.lw_agreement_id || null, p_partner_schedule: v.partner_schedule_id || null }));
      toast('Draft created. Add the document next.'); d.close(); done(id);
    });
  });
}

export function editDetails(ctx, a, done) {
  const d = openDrawer('Agreement details', html`<form class="form" id="ag-edit">
    <label class="f">Title<input name="title" required maxlength="200" value="${a.title}"></label>
    ${a.type !== 'policy_acknowledgement' ? html`<fieldset class="f"><legend>Parties</legend><div class="checks">${orgOptions(ctx, a.parties)}</div></fieldset>` : ''}
    <div class="fields">
      <label class="f">Who can see it<select name="visibility">${Object.entries(VISIBILITY).map(([k, v]) => html`<option value="${k}" ${raw(k === a.visibility ? 'selected' : '')}>${v}</option>`)}</select></label>
      <label class="f">Effective from<input type="date" name="effective_date" value="${a.effective_date || ''}"></label>
      <label class="f">Expires<input type="date" name="expiry_date" value="${a.expiry_date || ''}"></label>
      <label class="f">Review by<input type="date" name="review_date" value="${a.review_date || ''}"></label>
      <label class="f">Sign by<input type="date" name="due_date" value="${a.due_date || ''}"></label>
    </div>
    <label class="f">Message to signers<textarea name="message" maxlength="2000">${a.message || ''}</textarea></label>
    <label class="check"><input type="checkbox" name="requires_deed" ${raw(a.requires_deed ? 'checked' : '')}> Must be executed as a deed</label>
    <div class="btns"><button class="btn">Save</button></div></form>`);
  $('#ag-edit', d).addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      const v = formData(e.target);
      const fields = { title: v.title, visibility: v.visibility, effective_date: v.effective_date || null, expiry_date: v.expiry_date || null, review_date: v.review_date || null,
        due_date: v.due_date || null, message: v.message || '', requires_deed: !!v.requires_deed };
      if (a.type !== 'policy_acknowledgement') fields.parties = partiesOf(e.target);
      must(await db.rpc('agreement_update', { p_agreement: a.id, p_fields: fields }));
      toast('Saved.'); d.close(); done();
    });
  });
}

// ----------------------------------------------------------------- document

export function uploadVersion(ctx, a, done) {
  const d = openDrawer(a.current_version_id ? 'Upload a new version' : 'Add the document', html`<form class="form" id="ag-up">
    <label class="f">File<span class="hint">A PDF, or a Word (.docx) file, which is turned into a PDF for signing. Check the preview before you send it: Word layouts are simplified.</span>
      <input type="file" name="file" accept=".pdf,.docx" required></label>
    ${a.current_version_id ? html`<label class="f">What changed<input name="change_note" maxlength="1000"></label>` : ''}
    <div class="btns"><button class="btn">${raw(icon('upload', 16))}Upload</button></div></form>`);
  $('#ag-up', d).addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      const file = e.target.elements.file.files[0];
      const contentType = uploadType('agreements', file);
      const path = `${a.consortium_id}/${a.id}/source/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]+/g, '_').slice(-80)}`;
      must(await db.storage.from('agreements').upload(path, file, { contentType }));
      await esignCall({ action: 'prepare', agreement_id: a.id, source_path: path, source_name: file.name, change_note: e.target.elements.change_note?.value || '' });
      toast('Document added.'); d.close(); done();
    });
  });
}

export async function fromTemplate(ctx, a, done) {
  const templates = must(await db.from('agreement_templates').select('*').order('title'));
  const party = a.parties.find((p) => ctx.org(p)?.kind === 'delivery_partner') || a.parties[0] || null;
  const d = openDrawer('Create from a template', html`<form class="form" id="ag-tpl">
    <div class="fields">
      <label class="f">Template<select name="template">${templates.map((t) => html`<option value="${t.id}" ${raw(t.type === a.type ? 'selected' : '')}>${t.title}${t.consortium_id ? '' : ' (standard)'}</option>`)}</select></label>
      <label class="f">Fill in for<select name="org"><option value="">No partner</option>${ctx.orgs.map((o) => html`<option value="${o.id}" ${raw(o.id === party ? 'selected' : '')}>${o.name}</option>`)}</select></label>
    </div>
    <label class="f">Text<span class="hint"># for a heading, ## for a sub-heading, - for a bullet. Fields in {{double braces}} are filled from the portal; fill any left before generating.</span>
      <textarea name="body" rows="16" class="mono"></textarea></label>
    <p class="small muted" id="tpl-left"></p>
    <details><summary class="small">Merge fields</summary><dl class="facts small">${Object.entries(MERGE_HELP).map(([k, v]) => html`<dt><code>{{${k}}}</code></dt><dd>${v}</dd>`)}</dl></details>
    <div class="ag-preview" hidden><h3 class="pane-head">Preview</h3><div class="prose ag-preview-body"></div></div>
    <div class="btns"><button type="button" class="btn secondary" id="tpl-preview">Preview</button><button class="btn">Generate PDF</button>
      <button type="button" class="linkbtn small" id="tpl-save">Save as this workspace's template</button></div></form>`);
  const f = $('#ag-tpl', d);
  const fill = async () => {
    const t = templates.find((x) => x.id === f.elements.template.value);
    if (!t) return;
    const fields = must(await db.rpc('agreement_merge_fields', { p_consortium: ctx.consortium.id, p_org: f.elements.org.value || null }));
    f.elements.body.value = mergeTemplate(t.body, fields || {});
    left();
  };
  const left = () => { const u = unfilledFields(f.elements.body.value); $('#tpl-left', f).textContent = u.length ? `Still to fill: ${u.join(', ')}` : 'Every field is filled.'; };
  f.elements.template.addEventListener('change', fill);
  f.elements.org.addEventListener('change', fill);
  f.elements.body.addEventListener('input', left);
  if (templates.length) await fill();
  $('#tpl-preview', f).addEventListener('click', () => {
    const p = $('.ag-preview', f); p.hidden = false;
    render($('.ag-preview-body', f), html`${f.elements.body.value.split(/\n{2,}/).map((para) => {
      const t = para.trim();
      return t.startsWith('## ') ? html`<h4>${t.slice(3)}</h4>` : t.startsWith('# ') ? html`<h3>${t.slice(2)}</h3>`
        : t.split('\n').every((l) => /^[-*]\s/.test(l)) ? html`<ul>${t.split('\n').map((l) => html`<li>${l.replace(/^[-*]\s+/, '')}</li>`)}</ul>` : html`<p>${t}</p>`;
    })}`);
    p.scrollIntoView({ block: 'start' });
  });
  $('#tpl-save', f).addEventListener('click', (e) => act(e.currentTarget, async () => {
    const t = templates.find((x) => x.id === f.elements.template.value);
    must(await db.rpc('agreement_template_save', { p_consortium: ctx.consortium.id, p_id: t?.consortium_id ? t.id : null, p_title: t?.consortium_id ? t.title : `${a.title} template`,
      p_type: a.type, p_body: f.elements.body.value }));
    toast('Template saved for this workspace.');
  }));
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      if (unfilledFields(f.elements.body.value).length) throw new Error('Fill in every merge field first.');
      const t = templates.find((x) => x.id === f.elements.template.value);
      await esignCall({ action: 'generate', agreement_id: a.id, body: f.elements.body.value, template_title: t?.title || 'text' });
      toast('PDF generated. Check it, then add the signers.'); d.close(); done();
    });
  });
}

// ------------------------------------------------------------------ signers

export async function signersEditor(ctx, a, requests, done) {
  const people = await signerChoices(ctx);
  if (a.type === 'policy_acknowledgement') return audienceEditor(ctx, a, done);
  const row = (r = {}) => html`<div class="ag-signer">
    <label class="f">Person<select name="who" required><option value="">Choose…</option>${people.map((p) => html`<option value="${p.key}" ${raw((r.signer_profile_id ? r.signer_profile_id === p.key : `invite:${r.signer_email}` === p.key) ? 'selected' : '')}>${p.name}${ctx.org(p.organisation_id) ? `, ${ctx.org(p.organisation_id).name}` : ''}</option>`)}</select></label>
    <label class="f">Signs as<input name="role_label" maxlength="200" value="${r.signer_role_label || ''}" placeholder="e.g. for the Foundation, Head of Programmes"></label>
    <label class="f ag-order">Order<input type="number" name="order" min="1" max="20" value="${r.sign_order || 1}"></label>
    <button type="button" class="linkbtn small" data-remove>Remove</button></div>`;
  const d = openDrawer('Who signs', html`<form class="form" id="ag-signers">
    <p class="small muted">Signers with the same number sign at the same time; lower numbers sign first. Someone not yet in the workspace? <a href="#/c/${ctx.consortium.id}/team">Invite them</a> first: once invited they appear here, and they're asked to sign when they join.</p>
    <div id="ag-signer-rows">${(requests.length ? requests : [{}]).map(row)}</div>
    <button type="button" class="btn secondary small" id="ag-add-signer">${raw(icon('add', 16))}Add a signer</button>
    <div class="btns"><button class="btn">Save signers</button></div></form>`);
  const rows = $('#ag-signer-rows', d);
  const bindRemove = () => $$('[data-remove]', rows).forEach((b) => { b.onclick = () => b.closest('.ag-signer').remove(); });
  bindRemove();
  $('#ag-add-signer', d).addEventListener('click', () => {
    const t = document.createElement('div'); render(t, row({ sign_order: Math.max(1, ...$$('[name=order]', rows).map((x) => Number(x.value))) }));
    rows.append(...t.children); bindRemove();
  });
  $('#ag-signers', d).addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      const signers = $$('.ag-signer', rows).map((el) => {
        const key = $('[name=who]', el).value;
        const p = people.find((x) => x.key === key);
        const prev = requests.find((r) => (r.signer_profile_id || `invite:${r.signer_email}`) === key);
        return { ...(p.profile_id ? { profile_id: p.profile_id } : { email: p.email, name: p.name.replace(/ \(invited\)$/, ''), organisation_id: p.organisation_id }),
          role_label: $('[name=role_label]', el).value, order: Number($('[name=order]', el).value) || 1, placements: prev?.placements || [] };
      });
      if (!signers.length) throw new Error('Add at least one signer.');
      must(await db.rpc('agreement_set_signers', { p_agreement: a.id, p_signers: signers }));
      toast('Signers saved.'); d.close(); done();
    });
  });
}

function audienceEditor(ctx, a, done) {
  const d = openDrawer('Who acknowledges it', html`<form class="form" id="ag-aud">
    <label class="f">Send to<select name="audience"><option value="all">Everyone in the workspace</option>
      ${Object.entries(ROLE_LABEL).filter(([k]) => k !== 'platform_admin').map(([k, v]) => html`<option value="${k}" ${raw(a.audience === k ? 'selected' : '')}>${v}</option>`)}
      ${['org_admin', 'finance', 'operations', 'reporting', 'safeguarding', 'hub_worker'].map((k) => html`<option value="${k}" ${raw(a.audience === k ? 'selected' : '')}>Extra role: ${k.replace('_', ' ')}</option>`)}</select></label>
    <p class="small muted">Each person reads the document and signs to say they have read it and agree. The portal tracks who has.</p>
    <div class="btns"><button class="btn">Save</button></div></form>`);
  $('#ag-aud', d).addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      const n = must(await db.rpc('agreement_set_audience', { p_agreement: a.id, p_audience: formData(e.target).audience }));
      toast(`${n} ${n === 1 ? 'person' : 'people'} will be asked.`); d.close(); done();
    });
  });
}

// Signature places: one signer at a time, click on the page where they sign.
export function placementSaver(a, requests) {
  return async (requestId, placements) => {
    const signers = requests.map((r) => ({ ...(r.signer_profile_id ? { profile_id: r.signer_profile_id } : { email: r.signer_email, name: r.signer_name, organisation_id: r.signer_organisation_id }),
      role_label: r.signer_role_label, order: r.sign_order, placements: r.id === requestId ? placements : r.placements }));
    must(await db.rpc('agreement_set_signers', { p_agreement: a.id, p_signers: signers }));
  };
}

// ---------------------------------------------------------- other actions

export function reasonDrawer(title, label, button, run) {
  const d = openDrawer(title, html`<form class="form" id="ag-reason"><label class="f">${label}<textarea name="reason" required maxlength="2000"></textarea></label>
    <div class="btns"><button class="btn">${button}</button></div></form>`);
  $('#ag-reason', d).addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => { await run(formData(e.target).reason); d.close(); });
  });
}

export function signedCopyDrawer(a, done) {
  const d = openDrawer('Upload the signed copy', html`<form class="form" id="ag-copy">
    <p class="small muted">For a deed, or when a party signs on paper: upload the executed PDF. It's recorded as signed outside the portal and the agreement is completed.</p>
    <label class="f">Signed PDF<input type="file" name="file" accept=".pdf" required></label>
    <label class="f">How and when it was signed<textarea name="note" required maxlength="2000" placeholder="e.g. Executed as a deed by both parties on 4 November 2026, witnessed."></textarea></label>
    <div class="btns"><button class="btn">Record as signed</button></div></form>`);
  $('#ag-copy', d).addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      const file = e.target.elements.file.files[0];
      if (!/\.pdf$/i.test(file.name)) throw new Error('Upload the signed copy as a PDF.');
      const contentType = uploadType('agreements', file);
      const path = `${a.consortium_id}/${a.id}/source/${crypto.randomUUID()}-signed.pdf`;
      must(await db.storage.from('agreements').upload(path, file, { contentType }));
      await esignCall({ action: 'signed_copy', agreement_id: a.id, path, note: formData(e.target).note });
      toast('Recorded as signed.'); d.close(); done();
    });
  });
}

export const dueText = (a) => (a.due_date ? `Sign by ${fmtDate(a.due_date)}` : '');
