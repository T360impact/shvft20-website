// DBS checks. The portal records only that a check of a level exists, its
// dates, how it was verified and by whom: never the certificate number,
// anything on it, or a result. Decisions about a disclosure stay with the
// employing organisation.
//  dbs (page)     The register: the consortium lead and lead organisation
//                 see every member; an organisation's admin or safeguarding
//                 contact sees their own people. Items to verify first.
//  myDbsCard      "My DBS" on Account: status, level, next due, provide or renew.
//  dbsBanner      The workspace notice for someone whose check is missing.
//  dbsFields      The workspace setting, in the wizard and on Settings.
import { db, html, raw, render, $, $$, must, act, toast, icon, pill, openDrawer, formData, fmtDate, today, daysUntil, statCard, sectionGroup, toneBar, uploadFile, emptyState, ROLE_LABEL } from '../lib.js';

export const LEVEL = { basic: 'Basic', standard: 'Standard', enhanced: 'Enhanced', enhanced_barred: 'Enhanced with barred list' };
const WORKFORCE = { child: 'Children', adult: 'Adults', both: 'Children and adults' };
const METHOD = { original_seen: 'Original seen', update_service_check: 'Update service check', employer_confirmation: 'Employer confirmation' };
const STATUS = { verified: ['green', 'Verified', 'approved'], due_soon: ['amber', 'Due soon', 'due'], expired: ['red', 'Expired', 'overdue'],
  not_provided: ['red', 'Missing', 'overdue'], submitted: ['blue', 'To verify', 'submitted'], returned: ['amber', 'Returned', 'returned'], not_required: ['grey', 'Not required', 'info'] };
const TONE = { verified: 'green', due_soon: 'amber', expired: 'red', not_provided: 'red', submitted: 'blue', returned: 'amber', not_required: 'grey' };
export const dbsPill = (s) => pill(...(STATUS[s] || ['grey', s, 'info']));
const statusOf = (p) => (p.required ? p.status : 'not_required');
// Every role a workspace can require a check for, main and extra.
const ROLES = { lead: 'Consortium lead', accountable_body: 'Lead organisation', partner_manager: 'Partner manager', hub_worker: 'Hub or session worker',
  associate: 'Associate', funder_observer: 'Funder observer', youth_voice: 'Youth voice', org_admin: 'Org admin', finance: 'Finance',
  operations: 'Operations', reporting: 'Reporting', safeguarding: 'Safeguarding contact', bid_contributor: 'Bid contributor' };
const DEFAULT_ROLES = Object.keys(ROLES).filter((r) => !['funder_observer', 'youth_voice'].includes(r));
const XLSX_URL = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs';
const fileSafe = (s) => s.replace(/[^\w ()-]+/g, '').trim();

// ------------------------------------------------------- workspace setting

// The setting's fields. Names start dbs_ so the wizard can hold them in its own form.
export const dbsFields = (s = {}) => {
  const roles = s.dbs_roles || DEFAULT_ROLES;
  return html`<fieldset class="dbs-set"><legend>DBS checks</legend>
    <label class="check"><input type="checkbox" name="dbs_required" ${s.dbs_required ? 'checked' : ''}> DBS required for members</label>
    <div class="dbs-more" ${raw(s.dbs_required ? '' : 'hidden')}>
      <div class="checks" style="margin-top:8px"><label class="check"><input type="radio" name="dbs_apply" value="all" ${s.dbs_apply === 'all' ? 'checked' : ''}> All members</label>
        <label class="check"><input type="radio" name="dbs_apply" value="roles" ${s.dbs_apply !== 'all' ? 'checked' : ''}> Selected roles</label></div>
      <div class="dbs-roles" ${raw(s.dbs_apply === 'all' ? 'hidden' : '')}><p class="small muted" style="margin:6px 0">Untick roles with no contact with young people, such as finance only.</p>
        <div class="checks">${Object.entries(ROLES).map(([k, t]) => html`<label class="check small"><input type="checkbox" name="dbs_roles" value="${k}" data-multi="1" ${roles.includes(k) ? 'checked' : ''}> ${t}</label>`)}</div></div>
      <div class="fields">
        <label class="f">Level required<select name="dbs_level">${Object.entries(LEVEL).map(([k, t]) => html`<option value="${k}" ${(s.dbs_level || 'enhanced_barred') === k ? 'selected' : ''}>${t}</option>`)}</select></label>
        <label class="f">Workforce<select name="dbs_workforce">${Object.entries(WORKFORCE).map(([k, t]) => html`<option value="${k}" ${(s.dbs_workforce || 'child') === k ? 'selected' : ''}>${t}</option>`)}</select></label>
        <label class="f">Re-check every (years)<input type="number" name="dbs_renewal_years" min="1" max="10" value="${s.dbs_renewal_years ?? 3}"></label>
        <label class="f">Days to provide it<input type="number" name="dbs_grace_days" min="0" max="90" value="${s.dbs_grace_days ?? 14}"></label>
        <label class="f">Keep uploaded copies after verifying (days)<input type="number" name="dbs_file_retention_days" min="1" max="183" value="${s.dbs_file_retention_days ?? 30}"></label></div>
      <label class="check"><input type="checkbox" name="dbs_update_service_annual" ${s.dbs_update_service_annual !== false ? 'checked' : ''}> People on the update service can renew with a status check every 12 months</label>
      <label class="check"><input type="checkbox" name="dbs_block_delivery" ${s.dbs_block_delivery !== false ? 'checked' : ''}> Hold delivery roles until verified (they can sign in, but can't be rostered or log sessions)</label>
      <p class="small muted">Changes apply to everyone already in the workspace: anyone who now needs a check gets the days to provide it from today.</p></div></fieldset>`;
};
export function bindDbsFields(root) {
  const sync = () => {
    const box = $('.dbs-set', root); if (!box) return;
    $('.dbs-more', box).hidden = !$('[name=dbs_required]', box).checked;
    $('.dbs-roles', box).hidden = $('[name=dbs_apply]:checked', box)?.value === 'all';
  };
  $$('.dbs-set input', root).forEach((i) => i.addEventListener('change', sync));
  sync();
}
// The setting as workspace_settings columns, from formData().
export const dbsValues = (f) => ({
  dbs_required: !!f.dbs_required, dbs_apply: f.dbs_apply || 'roles', dbs_roles: f.dbs_roles || [], dbs_level: f.dbs_level, dbs_workforce: f.dbs_workforce,
  dbs_renewal_years: Number(f.dbs_renewal_years || 3), dbs_grace_days: Number(f.dbs_grace_days ?? 14), dbs_file_retention_days: Number(f.dbs_file_retention_days || 30),
  dbs_update_service_annual: !!f.dbs_update_service_annual, dbs_block_delivery: !!f.dbs_block_delivery,
});

// The Settings tab's own form.
export async function dbsSettings(ctx, el) {
  const s = must(await db.from('workspace_settings').select('dbs_required, dbs_apply, dbs_roles, dbs_level, dbs_workforce, dbs_renewal_years, dbs_update_service_annual, dbs_grace_days, dbs_block_delivery, dbs_file_retention_days')
    .eq('consortium_id', ctx.consortium.id).maybeSingle()) || {};
  const box = document.createElement('form');
  box.className = 'form panel'; box.style.marginTop = '20px';
  render(box, html`<h2>DBS checks</h2>${dbsFields(s)}<div class="btns"><button class="btn">Save DBS setting</button></div>`);
  el.append(box);
  bindDbsFields(box);
  box.addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => {
    const v = dbsValues(formData(box));
    if (v.dbs_required && v.dbs_apply === 'roles' && !v.dbs_roles.length) throw new Error('Tick at least one role, or choose all members.');
    must(await db.from('workspace_settings').update(v).eq('consortium_id', ctx.consortium.id));
    toast(v.dbs_required ? 'Saved. Anyone who now needs a check has been told.' : 'Saved. DBS checks are not required here.');
  }); });
}

// ------------------------------------------------------------- the banner

export const dbsBanner = (ctx) => {
  const s = ctx.dbs;
  if (!s?.required || s.ok) return '';
  const left = daysUntil(s.grace_until);
  const what = { submitted: 'Your DBS check is waiting to be verified.', returned: 'Your DBS check was returned: please provide it again.',
    expired: 'Your DBS check has expired.' }[s.status] || (s.level_too_low ? `This workspace needs a ${LEVEL[s.level_required].toLowerCase()} DBS check, above the one you hold.`
    : `This workspace needs a ${LEVEL[s.level_required].toLowerCase()} DBS check from you.`);
  const when = s.status === 'submitted' ? '' : s.grace_over ? ' The time to provide it has run out.' : left != null && left >= 0 ? ` ${left === 0 ? 'Due today' : `${left} day${left === 1 ? '' : 's'} left`} to provide it.` : '';
  return html`<div class="banner ${s.grace_over || s.status === 'expired' ? 'bad' : 'warn'} dbs-banner">${raw(icon('safeguarding', 18))}<span><strong>${what}</strong>${when}
    ${s.blocked ? ' Until it is verified you can sign in, but you can\'t be rostered or log sessions.' : ''}
    ${s.status === 'submitted' ? '' : html` <a href="#/account">Provide it</a>`}</span></div>`;
};

// ------------------------------------------------------------- My DBS card

export async function myDbsCard(el, state) {
  const d = must(await db.rpc('dbs_my'));
  const cur = d.current; const pend = d.pending;
  const needs = d.workspaces.filter((w) => !w.ok);
  const nextDue = d.workspaces.map((w) => w.next_due).filter(Boolean).sort()[0] || cur?.next_due_date;
  const st = d.workspaces.length ? (needs.length ? (needs.find((w) => ['expired', 'not_provided', 'returned'].includes(w.status)) || needs[0]).status : (d.workspaces.some((w) => w.status === 'due_soon') ? 'due_soon' : 'verified'))
    : cur ? 'verified' : 'not_required';
  render(el, html`<h2>My DBS</h2>
    <div class="dbs-card-head">${dbsPill(st)}${cur ? html`<span class="small">${LEVEL[cur.level]}${cur.workforce ? ` · ${WORKFORCE[cur.workforce].toLowerCase()}` : ''}</span>` : ''}</div>
    ${cur ? html`<dl class="dbs-dl"><dt>Verified</dt><dd>${fmtDate(cur.verified_at)} · ${METHOD[cur.verification_method]}</dd>
      <dt>Next due</dt><dd>${nextDue ? html`${fmtDate(nextDue)} <span class="muted small">(${daysUntil(nextDue)} days)</span>` : '–'}</dd>
      ${cur.on_update_service ? html`<dt>Update service</dt><dd>Renews ${fmtDate(cur.update_service_renewal_date)}${cur.last_update_service_check_date ? ` · last checked ${fmtDate(cur.last_update_service_check_date)}` : ''}</dd>` : ''}</dl>`
      : html`<p class="small muted">${d.workspaces.length ? 'You haven\'t got a verified DBS check on the portal yet.' : 'No workspace needs a DBS check from you.'}</p>`}
    ${pend ? html`<p class="small">${pend.verification_status === 'returned' ? html`${pill('amber', 'Returned', 'returned')} ${pend.return_reason}` : html`${pill('blue', 'Waiting to be verified', 'submitted')} sent ${fmtDate(pend.created_at)}`}</p>` : ''}
    ${d.workspaces.length ? html`<ul class="dbs-ws small">${d.workspaces.map((w) => html`<li><span>${w.name}</span><span class="muted">${LEVEL[w.level_required]}</span>${dbsPill(w.status)}
      ${!w.ok && w.status !== 'submitted' && !w.grace_over && w.grace_until ? html`<span class="muted">by ${fmtDate(w.grace_until)}</span>` : ''}</li>`)}</ul>` : ''}
    ${d.workspaces.length ? html`<div class="btns"><button type="button" class="btn ${needs.length ? '' : 'secondary'}" id="dbs-provide">${raw(icon('upload', 16))}${cur ? 'Renew or update' : 'Provide my DBS'}</button></div>
      <p class="small muted">Quickest: ask your organisation admin or safeguarding contact to confirm it on the portal. Or upload a copy here; it's seen only by whoever verifies it and is deleted after.</p>` : ''}`);
  $('#dbs-provide', el)?.addEventListener('click', () => provideDrawer(d.workspaces, state, () => myDbsCard(el, state)));
}

function provideDrawer(workspaces, state, done) {
  const need = workspaces.find((w) => !w.ok) || workspaces[0];
  const top = workspaces.reduce((a, w) => (LEVEL_RANK[w.level_required] > LEVEL_RANK[a] ? w.level_required : a), 'basic');
  const d = openDrawer('Provide your DBS check', html`<form class="form" id="dbs-form">
    ${workspaces.length > 1 ? html`<label class="f">For<select name="ws">${workspaces.map((w) => html`<option value="${w.consortium_id}" ${w === need ? 'selected' : ''}>${w.name}</option>`)}</select>
      <span class="hint">It counts in every workspace that needs this level or lower.</span></label>` : ''}
    <div class="fields"><label class="f">Level<select name="level" required>${Object.entries(LEVEL).map(([k, t]) => html`<option value="${k}" ${k === top ? 'selected' : ''}>${t}</option>`)}</select></label>
      <label class="f dbs-wf">Workforce<select name="workforce">${Object.entries(WORKFORCE).map(([k, t]) => html`<option value="${k}" ${k === (need.workforce_required || 'child') ? 'selected' : ''}>${t}</option>`)}</select></label></div>
    <label class="f">Issue date<input type="date" name="issue_date" required max="${today()}"></label>
    <label class="check"><input type="checkbox" name="on_us"> I'm on the DBS update service</label>
    <label class="f dbs-us" hidden>Update service renewal date<input type="date" name="renewal_date"><span class="hint">When your annual subscription renews. With this, a copy is optional: your verifier checks your status online.</span></label>
    <label class="f">A copy of the certificate <span class="muted small">(PDF or photo)</span><input type="file" name="file" accept="application/pdf,image/jpeg,image/png,image/heic,image/webp"></label>
    <p class="small muted">${raw(icon('info', 14))} Don't type the certificate number or anything the certificate says. The copy is seen only by your verifier and Shvft staff, and deleted automatically once it's verified.</p>
    <div class="btns"><button class="btn">Send for verification</button></div></form>`);
  const f = $('#dbs-form', d);
  const sync = () => { $('.dbs-us', f).hidden = !$('[name=on_us]', f).checked; $('[name=renewal_date]', f).required = $('[name=on_us]', f).checked;
    $('.dbs-wf', f).hidden = LEVEL_RANK[$('[name=level]', f).value] < 3; };
  $$('[name=on_us], [name=level]', f).forEach((i) => i.addEventListener('change', sync)); sync();
  f.addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => {
    const v = formData(f); const file = $('[name=file]', f).files[0];
    if (!file && !v.on_us) throw new Error('Upload a copy, or tick that you\'re on the update service.');
    if (file && file.size > 10 * 1024 * 1024) throw new Error('That file is over 10 MB.');
    const path = file ? await uploadFile('dbs', state.user.id, file) : null;
    must(await db.rpc('dbs_submit', { p_consortium: v.ws || need.consortium_id, p_level: v.level, p_workforce: LEVEL_RANK[v.level] >= 3 ? v.workforce : null,
      p_issue_date: v.issue_date, p_on_update_service: !!v.on_us, p_renewal_date: v.on_us ? v.renewal_date : null, p_file_path: path }));
    d.close(); toast('Sent. Your verifier has been told.'); done();
  }); });
}
const LEVEL_RANK = { basic: 1, standard: 2, enhanced: 3, enhanced_barred: 4 };

// -------------------------------------------------------- verifying

// Open an uploaded copy: the view is logged, then a one-minute link.
function openCertificate(button, recordId) {
  const tab = window.open('', '_blank');
  if (tab) tab.opener = null;
  act(button, async () => {
    try {
      const path = must(await db.rpc('dbs_certificate_open', { p_record: recordId }));
      const { signedUrl } = must(await db.storage.from('dbs').createSignedUrl(path, 60));
      if (tab) tab.location = signedUrl; else location.href = signedUrl;
    } catch (e) { tab?.close(); throw e; }
  });
}
// Returned or replaced copies are deleted straight away (the hourly run is the backstop).
const purge = () => db.functions.invoke('dbs-file-cleanup', { body: {} }).catch(() => {});

function verifyDrawer(p, done) {
  const x = p.pending;
  const d = openDrawer(`Verify ${p.name}'s DBS`, html`<dl class="dbs-dl">
      <dt>Level</dt><dd>${LEVEL[x.level]}${x.workforce ? ` · ${WORKFORCE[x.workforce].toLowerCase()}` : ''} <span class="muted small">(needs ${LEVEL[p.level_required].toLowerCase()})</span></dd>
      <dt>Issue date</dt><dd>${fmtDate(x.issue_date)}</dd>
      <dt>Update service</dt><dd>${x.on_update_service ? `Yes, renews ${fmtDate(x.renewal_date)}` : 'No'}</dd>
      <dt>Sent</dt><dd>${fmtDate(x.submitted_at)}</dd>${x.notes ? html`<dt>Note</dt><dd>${x.notes}</dd>` : ''}</dl>
    ${x.has_file ? html`<p><button type="button" class="btn secondary" id="open-cert">${raw(icon('view', 16))}Open the copy</button> <span class="small muted">Opening it is logged.</span></p>` : ''}
    <form class="form" id="v-form"><fieldset><legend>How you verified it</legend><div class="checks">
      ${x.has_file ? html`<label class="check"><input type="radio" name="method" value="original_seen" checked> I've checked the copy against the details above</label>` : ''}
      ${x.on_update_service ? html`<label class="check"><input type="radio" name="method" value="update_service_check" ${x.has_file ? '' : 'checked'}> I checked their status on the update service</label>
        <label class="f">Date of the check<input type="date" name="check_date" max="${today()}" value="${today()}"></label>` : ''}</div></fieldset>
      <p class="small muted">${raw(icon('info', 14))} Record only that the check exists and its details. Any decision about what it says stays with their employer under its safer recruitment policy.</p>
      <div class="btns"><button class="btn" name="go" value="approve">${raw(icon('approved', 16))}Verify</button></div>
      <details style="margin-top:12px"><summary class="small">Return it instead</summary>
        <label class="f">What needs to change<textarea name="reason" rows="2" maxlength="500" placeholder="for example: the photo is too blurry to read the issue date"></textarea></label>
        <div class="btns"><button class="btn secondary" name="go" value="return">Return it</button></div></details></form>`);
  $('#open-cert', d)?.addEventListener('click', (e) => openCertificate(e.currentTarget, x.id));
  $('#v-form', d).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => {
    const f = formData(e.target); const approve = e.submitter.value === 'approve';
    must(await db.rpc('dbs_verify', { p_record: x.id, p_approve: approve, p_method: f.method || 'original_seen',
      p_check_date: f.method === 'update_service_check' ? f.check_date : null, p_reason: approve ? null : f.reason }));
    if (!approve) await purge();
    d.close(); toast(approve ? 'Verified. They have been told.' : 'Returned, and the copy deleted.'); done();
  }); });
}

function confirmDrawer(ctx, p, done) {
  const d = openDrawer(`Confirm ${p.name}'s DBS`, html`<form class="form" id="c-form">
    <p class="small">Confirm you have seen their original certificate or checked the update service. No copy is needed.</p>
    <div class="fields"><label class="f">Level<select name="level">${Object.entries(LEVEL).map(([k, t]) => html`<option value="${k}" ${k === p.level_required ? 'selected' : ''}>${t}</option>`)}</select></label>
      <label class="f dbs-wf">Workforce<select name="workforce">${Object.entries(WORKFORCE).map(([k, t]) => html`<option value="${k}" ${k === (p.workforce_required || 'child') ? 'selected' : ''}>${t}</option>`)}</select></label></div>
    <label class="f">Issue date<input type="date" name="issue_date" required max="${today()}"></label>
    <label class="check"><input type="checkbox" name="on_us"> On the update service</label>
    <div class="fields dbs-us" hidden><label class="f">Subscription renews<input type="date" name="renewal_date"></label>
      <label class="f">Status checked on <span class="muted small">(optional)</span><input type="date" name="check_date" max="${today()}"></label></div>
    <p class="small muted">${raw(icon('info', 14))} Don't enter the certificate number or anything it says.</p>
    <div class="btns"><button class="btn">${raw(icon('approved', 16))}Confirm</button></div></form>`);
  const f = $('#c-form', d);
  const sync = () => { $('.dbs-us', f).hidden = !$('[name=on_us]', f).checked; $('[name=renewal_date]', f).required = $('[name=on_us]', f).checked;
    $('.dbs-wf', f).hidden = LEVEL_RANK[$('[name=level]', f).value] < 3; };
  $$('[name=on_us], [name=level]', f).forEach((i) => i.addEventListener('change', sync)); sync();
  f.addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => {
    const v = formData(f);
    must(await db.rpc('dbs_confirm', { p_consortium: ctx.consortium.id, p_profile: p.user_id, p_level: v.level, p_workforce: LEVEL_RANK[v.level] >= 3 ? v.workforce : null,
      p_issue_date: v.issue_date, p_on_update_service: !!v.on_us, p_renewal_date: v.on_us ? v.renewal_date : null, p_check_date: v.on_us ? v.check_date : null }));
    await purge();
    d.close(); toast('Confirmed. They have been told.'); done();
  }); });
}

// --------------------------------------------------------------- the page

const ui = (ctx) => ctx.dbsUi || (ctx.dbsUi = { org: '', status: '', role: '' });

export default async function dbs(ctx, el) {
  const c = ctx.consortium;
  const reg = must(await db.rpc('dbs_register', { p_consortium: c.id }));
  const s = reg.settings || {};
  const head = html`<div class="page-head"><div><span class="eyebrow">Compliance</span><h1>DBS checks</h1>
    <p class="muted">${reg.all_orgs ? 'Every member\'s DBS check: the level held against the level required, how it was verified and when it\'s next due.' : 'Your organisation\'s people in this workspace, and checks waiting for you to verify.'}
      No certificate numbers or contents are kept.</p></div>
    ${s.required ? html`<div class="btns"><button type="button" class="btn secondary" id="dbs-export">${raw(icon('download', 16))}Export to Excel</button></div>` : ''}</div>`;
  if (!s.required) {
    render(el, html`${head}${emptyState('safeguarding', 'This workspace doesn\'t require DBS checks.',
      ctx.manages ? html`<a class="btn" href="#/c/${c.id}/master" id="go-settings">Turn it on in Settings</a>` : '')}`);
    $('#go-settings', el)?.addEventListener('click', () => { ctx.uiTier = { ...(ctx.uiTier || {}), mtab: 'settings' }; });
    return;
  }
  const people = reg.people.filter((p) => p.required);
  const extra = reg.people.length - people.length;
  const count = (st) => people.filter((p) => p.status === st).length;
  const toVerify = people.filter((p) => p.pending && p.can_verify);
  const u = ui(ctx);
  const orgs = [...new Map(people.map((p) => [p.organisation_id, p.organisation])).entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  const roleSet = [...new Set(people.flatMap((p) => p.roles))];
  const shown = people.filter((p) => (!u.org || p.organisation_id === u.org) && (!u.status || (u.status === 'missing' ? ['not_provided', 'returned', 'submitted'].includes(p.status) : p.status === u.status))
    && (!u.role || p.roles.includes(u.role)));
  const heldCell = (p) => (p.level_held ? html`${LEVEL[p.level_held]}${p.level_too_low ? html` <span class="warn-text small">below ${LEVEL[p.level_required].toLowerCase()}</span>` : ''}` : html`<span class="muted">None</span>`);
  const row = (p) => html`<tr><td><strong>${p.name}</strong>${p.blocked ? html`<br><span class="small warn-text">On hold: can't be rostered</span>` : ''}</td>
    <td class="small">${p.roles.map((r) => ROLES[r] || ROLE_LABEL[r] || r).join(', ')}</td>
    <td class="small">${heldCell(p)}<br><span class="muted">needs ${LEVEL[p.level_required].toLowerCase()}</span></td>
    <td class="small">${p.method ? METHOD[p.method] : '–'}${p.verified_by ? html`<br><span class="muted">${p.verified_by}</span>` : ''}</td>
    <td class="small">${p.next_due ? fmtDate(p.next_due) : !p.ok && !p.grace_over && p.grace_until ? html`<span class="muted">Provide by ${fmtDate(p.grace_until)}</span>` : '–'}</td>
    <td>${dbsPill(p.status)}${p.grace_over && p.status !== 'submitted' ? html`<br><span class="small warn-text">overdue</span>` : ''}</td>
    <td class="num">${p.pending && p.can_verify ? html`<button type="button" class="btn small" data-verify="${p.user_id}">Verify</button>`
      : p.can_verify ? html`<button type="button" class="btn secondary small" data-confirm="${p.user_id}">${p.ok ? 'Update' : 'Confirm'}</button>` : ''}</td></tr>`;
  const table = (list) => html`<div class="table-wrap"><table class="dbs-table"><thead><tr><th>Person</th><th>Role</th><th>Level held</th><th>Verified</th><th>Next due</th><th>Status</th><th></th></tr></thead>
    <tbody>${list.map(row)}</tbody></table></div>`;
  const byOrg = orgs.map(([id, name]) => [id, name, shown.filter((p) => p.organisation_id === id)]).filter(([, , l]) => l.length);
  render(el, html`${head}
    <div class="stats stats-4">
      ${statCard({ icon: 'approved', value: count('verified') + count('due_soon'), label: 'Verified', trend: { dir: 'flat', tone: 'green', text: `of ${people.length} who need one` } })}
      ${statCard({ icon: 'due', value: count('due_soon'), label: 'Due soon', trend: { dir: 'flat', tone: count('due_soon') ? 'amber' : 'green', text: 'within 60 days' } })}
      ${statCard({ icon: 'overdue', value: count('expired'), label: 'Expired', trend: { dir: 'flat', tone: count('expired') ? 'red' : 'green', text: 'past their due date' } })}
      ${statCard({ icon: 'safeguarding', value: count('not_provided') + count('returned') + count('submitted'), label: 'Missing', trend: { dir: 'flat', tone: toVerify.length ? 'blue' : 'grey', text: `${toVerify.length} waiting for you to verify` } })}</div>
    <p class="small muted" style="margin:-4px 0 16px">${LEVEL[s.level]} required for ${s.apply === 'all' ? 'all members' : 'the roles ticked in Settings'} · re-checked every ${s.renewal_years} year${s.renewal_years === 1 ? '' : 's'}${s.update_service_annual ? ' or by an annual update service check' : ''} · ${s.grace_days} days to provide it${s.block_delivery ? ' · delivery roles held until verified' : ''}${extra ? ` · ${extra} member${extra === 1 ? '' : 's'} not required` : ''}</p>
    ${toVerify.length ? sectionGroup({ title: 'To verify', meta: `${toVerify.length} waiting`, aside: pill('blue', `${toVerify.length}`, 'submitted'), open: true, body: table(toVerify) }) : ''}
    <div class="filters">
      ${reg.all_orgs ? html`<label class="f">Organisation<select data-filter="org"><option value="">All</option>${orgs.map(([id, n]) => html`<option value="${id}" ${u.org === id ? 'selected' : ''}>${n}</option>`)}</select></label>` : ''}
      <label class="f">Status<select data-filter="status"><option value="">All</option>${[['verified', 'Verified'], ['due_soon', 'Due soon'], ['expired', 'Expired'], ['missing', 'Missing or waiting']].map(([k, t]) => html`<option value="${k}" ${u.status === k ? 'selected' : ''}>${t}</option>`)}</select></label>
      <label class="f">Role<select data-filter="role"><option value="">All</option>${roleSet.map((r) => html`<option value="${r}" ${u.role === r ? 'selected' : ''}>${ROLES[r] || r}</option>`)}</select></label></div>
    ${byOrg.length ? byOrg.map(([id, name, list], i) => sectionGroup({ title: name || 'No organisation', open: byOrg.length === 1 || (i === 0 && !!(u.org || u.status || u.role)),
      meta: `${list.length} ${list.length === 1 ? 'person' : 'people'} · ${list.filter((p) => p.ok).length} verified`,
      aside: toneBar(['green', 'amber', 'red', 'blue'].map((t) => [t, list.filter((p) => TONE[statusOf(p)] === t).length, { green: 'verified', amber: 'due soon or returned', red: 'missing or expired', blue: 'to verify' }[t]])),
      body: table(list) })) : html`<p class="muted small">Nobody matches these filters.</p>`}`);
  const again = () => dbs(ctx, el);
  $$('[data-filter]', el).forEach((sel) => sel.addEventListener('change', () => { u[sel.dataset.filter] = sel.value; again(); }));
  $$('[data-verify]', el).forEach((b) => b.addEventListener('click', () => verifyDrawer(people.find((p) => p.user_id === b.dataset.verify), again)));
  $$('[data-confirm]', el).forEach((b) => b.addEventListener('click', () => confirmDrawer(ctx, people.find((p) => p.user_id === b.dataset.confirm), again)));
  $('#dbs-export', el)?.addEventListener('click', (e) => act(e.currentTarget, async () => {
    const X = await import(XLSX_URL);
    const aoa = [['Name', 'Organisation', 'Roles', 'Level held', 'Level required', 'Verification method', 'Verified by', 'Verified on', 'Next due', 'Status', 'Provide by']];
    for (const p of shown) aoa.push([p.name, p.organisation || '', p.roles.map((r) => ROLES[r] || r).join(', '), p.level_held ? LEVEL[p.level_held] : '', LEVEL[p.level_required],
      p.method ? METHOD[p.method] : '', p.verified_by || '', p.verified_at ? p.verified_at.slice(0, 10) : '', p.next_due || '', STATUS[p.status]?.[1] || p.status, p.ok ? '' : p.grace_until || '']);
    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(aoa), 'DBS register');
    X.writeFile(wb, `${fileSafe(`${c.name} DBS register ${today()}`)}.xlsx`);
  }));
}

// Counts for the Compliance page and This week: missing, due soon, expired.
export async function dbsSummaryTile(ctx) {
  const { data } = await db.rpc('dbs_summary', { p_consortium: ctx.consortium.id });
  if (!data?.required) return null;
  return data;
}
