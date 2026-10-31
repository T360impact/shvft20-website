// Organisation profile: one profile per organisation, carried across every
// workspace it joins, with its compliance documents. The organisation's own
// admins edit it; the consortium lead and lead organisation review its
// documents; other partners see only its name, logo, description and role.
import { db, html, raw, render, $, $$, must, act, toast, icon, pill, openDrawer, formData, fmtDate, sectionGroup, uploadFile, openFile, KIND_LABEL } from '../lib.js';

const GROUPS = [['governance', 'Governance'], ['safeguarding', 'Safeguarding'], ['insurance', 'Insurance'], ['policies', 'Policies'], ['evidence', 'Evidence']];
const FORMS = [['charity', 'Registered charity'], ['charitable_company', 'Charitable company'], ['cio', 'CIO'], ['cic', 'Community interest company'],
  ['company_limited_by_guarantee', 'Company limited by guarantee'], ['company_limited_by_shares', 'Company limited by shares'], ['community_benefit_society', 'Community benefit society'],
  ['unincorporated', 'Unincorporated association'], ['public_body', 'Public body'], ['other', 'Other']];
const BANDS = ['0', '1-5', '6-10', '11-25', '26-50', '51-100', '100+'];
const CONTACTS = [['main', 'Main contact'], ['safeguarding', 'Safeguarding lead'], ['finance', 'Finance contact'], ['data_protection', 'Data protection contact']];
export const DOC_STATUS = { missing: ['red', 'Missing'], uploaded: ['blue', 'Uploaded'], under_review: ['blue', 'Under review'], approved: ['green', 'Approved'],
  already_provided: ['green', 'Already provided'], needs_changes: ['amber', 'Needs changes'], expired: ['red', 'Expired'] };
export const docPill = (s) => pill(...(DOC_STATUS[s] || ['grey', s]));

// A completeness ring out of 100.
export const ring = (score, size = 72) => {
  const r = size / 2 - 6; const len = 2 * Math.PI * r; const off = len * (1 - score / 100);
  return raw(`<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${score} out of 100 complete">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--track)" stroke-width="8"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--progress)" stroke-width="8" stroke-linecap="round" stroke-dasharray="${len.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    <text x="50%" y="54%" text-anchor="middle" font-size="${size / 4.2}" font-weight="700" fill="currentColor">${score}</text></svg>`);
};

export default async function profile(ctx, el, [orgId]) {
  const c = ctx.consortium;
  const org = orgId || ctx.orgId;
  if (!org) { render(el, html`<div class="panel">Choose an organisation from the compliance page.</div>`); return; }
  const p = must(await db.rpc('org_profile', { p_consortium: c.id, p_org: org }));
  const logoUrl = p.logo_path ? (await db.storage.from('library').createSignedUrl(p.logo_path, 600)).data?.signedUrl : null;
  const head = html`<div class="page-head"><div class="org-head">${logoUrl ? html`<img class="org-logo" src="${logoUrl}" alt="">` : ''}
    <div><span class="eyebrow">Organisation profile</span><h1>${p.name}</h1><p class="meta-line">${KIND_LABEL[p.kind] || ''}${p.full && p.workspaces?.length > 1 ? ` · in ${p.workspaces.length} workspaces` : ''}</p></div></div>
    ${p.full ? html`<div class="ring-box">${ring(p.completeness.score)}<span class="small muted">profile complete</span></div>` : ''}</div>`;
  if (!p.full) {
    render(el, html`${head}<section class="panel"><p>${p.description || 'No description yet.'}</p>
      ${p.documents ? html`<h2 style="margin-top:16px">Documents shared with you</h2><ul class="small">${p.documents.map((x) => html`<li>${x.title}</li>`)}</ul>` : ''}</section>`);
    return;
  }
  const groups = GROUPS.map(([g, label]) => [label, p.documents.filter((x) => x.group === g)]).filter(([, xs]) => xs.length);
  const docRow = (x) => {
    const cur = x.current;
    const st = cur ? cur.status : 'missing';
    return html`<li class="lw-row static"><span class="lw-row-main"><strong>${x.label}</strong>
      <span class="muted small">${cur ? `${cur.title} · version ${cur.version}${cur.issue_date ? ` · issued ${fmtDate(cur.issue_date)}` : ''}${cur.expires_on ? ` · expires ${fmtDate(cur.expires_on)}` : ''}${x.history ? ` · ${x.history} earlier` : ''}` : (x.expires ? 'Needs an expiry date when uploaded' : '')}</span>
      ${cur?.review_comment && st === 'needs_changes' ? html`<span class="small warn-text">${cur.review_comment}</span>` : ''}</span>
      <span class="lw-row-tags">${x.required ? pill('grey', 'Required here') : ''}${docPill(st)}
        ${cur ? html`<button type="button" class="btn secondary small" data-open="${cur.path}">Open</button>` : ''}
        ${p.can_edit ? html`<button type="button" class="btn secondary small" data-upload="${x.type}">${cur ? 'New version' : 'Upload'}</button>` : ''}
        ${p.can_review && cur && ['uploaded', 'under_review'].includes(st) ? html`<button type="button" class="btn small" data-approve="${cur.id}">Approve</button><button type="button" class="btn secondary small" data-return="${cur.id}">Return</button>` : ''}</span></li>`;
  };
  const ct = p.contacts || {};
  render(el, html`${head}
    ${p.completeness.missing.length ? html`<div class="lead-banner"><span><strong>Still to add:</strong> ${p.completeness.missing.join(', ')}.</span></div>` : ''}
    <div class="dgrid">
      <section class="dcard full"><header class="dcard-head"><h2>Documents</h2><p>Uploaded once, used in every workspace and bid. An approved, in-date document shows as already provided wherever it's needed.</p></header>
        ${groups.map(([label, xs], i) => sectionGroup({ title: label, meta: `${xs.filter((x) => x.current?.status === 'approved').length} of ${xs.length} approved`, open: i === 0,
          aside: xs.some((x) => x.required && (!x.current || ['expired', 'needs_changes'].includes(x.current.status))) ? pill('amber', 'Action needed') : '',
          body: html`<ul class="lw-list">${xs.map(docRow)}</ul>` }))}</section>
      <section class="dcard full"><header class="dcard-head"><h2>Profile</h2><p>${p.can_edit ? 'Shared with every workspace you join. Never add bank or card details.' : 'Kept by the organisation.'}</p></header>
        <form class="form" id="pf">
          <div class="fields"><label class="f">Legal name<input name="legal_name" value="${p.legal_name || ''}" maxlength="200"></label><label class="f">Trading name<input name="trading_name" value="${p.trading_name || ''}" maxlength="200"></label></div>
          <div class="fields"><label class="f">Legal form<select name="legal_form"><option value="">Choose…</option>${FORMS.map(([k, v]) => html`<option value="${k}" ${p.legal_form === k ? 'selected' : ''}>${v}</option>`)}</select></label>
            <label class="f">Charity number<input name="charity_number" value="${p.charity_number || ''}" maxlength="20"></label><label class="f">Company number<input name="company_number" value="${p.company_number || ''}" maxlength="20"></label></div>
          <label class="f">Registered address<input name="registered_address" value="${p.registered_address || ''}" maxlength="300"></label>
          <div class="fields"><label class="f">Website<input name="website" type="url" value="${p.website || ''}" placeholder="https://"></label><label class="f">Brand colour<input name="brand_colour" type="color" value="${p.brand_colour || '#111a2c'}"></label>
            <label class="f">Logo<input type="file" name="logo" accept="image/png,image/jpeg,image/svg+xml"></label></div>
          <label class="f">Description<textarea name="description" rows="3" maxlength="1500">${p.description || ''}</textarea></label>
          <div class="fields"><label class="f">Areas served <span class="hint">separate with commas</span><input name="areas_served" value="${(p.areas_served || []).join(', ')}"></label>
            <label class="f">Ages served<input name="ages_served" value="${p.ages_served || ''}" maxlength="60" placeholder="For example 14 to 24"></label></div>
          <label class="f">Services <span class="hint">separate with commas</span><input name="services" value="${(p.services || []).join(', ')}"></label>
          <div class="fields"><label class="f">Staff<select name="staff_band"><option value="">Choose…</option>${BANDS.map((b) => html`<option ${p.staff_band === b ? 'selected' : ''}>${b}</option>`)}</select></label>
            <label class="f">Volunteers<select name="volunteer_band"><option value="">Choose…</option>${BANDS.map((b) => html`<option ${p.volunteer_band === b ? 'selected' : ''}>${b}</option>`)}</select></label></div>
          <fieldset><legend>Named contacts</legend>${CONTACTS.map(([k, label]) => html`<div class="fields"><label class="f">${label}<input name="c_${k}_name" value="${ct[k]?.name || ''}" maxlength="120" placeholder="Name"></label>
            <label class="f">Role<input name="c_${k}_role" value="${ct[k]?.role || ''}" maxlength="120"></label><label class="f">Work email<input name="c_${k}_email" type="email" value="${ct[k]?.email || ''}" maxlength="200"></label></div>`)}</fieldset>
          ${p.can_edit ? html`<div class="btns"><button class="btn">Save profile</button></div>` : ''}</form></section>
    </div>`);
  if (!p.can_edit) $$('#pf input, #pf select, #pf textarea', el).forEach((x) => { x.disabled = true; });
  const again = () => profile(ctx, el, [orgId]);

  $('#pf', el).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => {
    const f = formData(e.target);
    const list = (s) => (s || '').split(',').map((x) => x.trim()).filter(Boolean);
    const contacts = Object.fromEntries(CONTACTS.map(([k]) => [k, { name: f[`c_${k}_name`] || '', role: f[`c_${k}_role`] || '', email: f[`c_${k}_email`] || '' }]).filter(([, v]) => v.name));
    const logo = e.target.logo.files[0];
    const logo_path = logo ? await uploadFile('library', `partners/${p.id}/logo`, logo) : p.logo_path;
    must(await db.from('partners').update({ legal_name: f.legal_name || null, trading_name: f.trading_name || null, legal_form: f.legal_form || null,
      charity_number: f.charity_number || null, company_number: f.company_number || null, registered_address: f.registered_address || null, website: f.website || null,
      brand_colour: f.brand_colour || null, description: f.description || null, areas_served: list(f.areas_served), ages_served: f.ages_served || null, services: list(f.services),
      staff_band: f.staff_band || null, volunteer_band: f.volunteer_band || null, contacts, logo_path }).eq('id', p.id));
    toast('Profile saved.'); again();
  }); });
  $$('[data-open]', el).forEach((b) => b.addEventListener('click', () => openFile(b, 'library', b.dataset.open)));
  $$('[data-upload]', el).forEach((b) => b.addEventListener('click', () => {
    const t = p.documents.find((x) => x.type === b.dataset.upload);
    const d = openDrawer(`${t.current ? 'New version' : 'Upload'}: ${t.label}`, html`<form class="form" id="df">
      <label class="f">File<input type="file" name="file" required accept=".pdf,.docx,.doc,image/*"></label>
      <label class="f">Title<input name="title" required maxlength="200" value="${t.label}"></label>
      <div class="fields"><label class="f">Issue date<input type="date" name="issue_date"></label><label class="f">Expiry date${t.expires ? '' : ' (if it has one)'}<input type="date" name="expires_on" ${t.expires ? 'required' : ''}></label></div>
      <label class="f">Note <span class="hint">optional; no bank details</span><input name="note" maxlength="500"></label>
      <p class="small muted">The consortium lead or lead organisation reviews it. ${t.current ? 'The current version is kept in the history.' : ''}</p>
      <div class="btns"><button class="btn">Upload</button></div></form>`);
    $('#df', d).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => {
      const f = formData(e.target); const file = e.target.file.files[0];
      const path = await uploadFile('library', `partners/${p.id}/${t.type}`, file);
      must(await db.from('partner_documents').insert({ partner_id: p.id, library_key: t.type, title: f.title, storage_path: path, file_name: file.name,
        issue_date: f.issue_date || null, expires_on: f.expires_on || null, note: f.note || null }));
      d.close(); toast('Uploaded for review.'); again();
    }); });
  }));
  $$('[data-approve]', el).forEach((b) => b.addEventListener('click', () => act(b, async () => { must(await db.rpc('review_document', { p_doc: b.dataset.approve, p_approve: true })); toast('Approved.'); again(); })));
  $$('[data-return]', el).forEach((b) => b.addEventListener('click', () => {
    const d = openDrawer('Return with a comment', html`<form class="form" id="rf"><label class="f">What needs to change<textarea name="c" rows="3" required maxlength="1000"></textarea></label><div class="btns"><button class="btn">Return</button></div></form>`);
    $('#rf', d).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => {
      must(await db.rpc('review_document', { p_doc: b.dataset.return, p_approve: false, p_comment: formData(e.target).c })); d.close(); toast('Returned to the organisation.'); again();
    }); });
  }));
}
