// Signing: agreements signed electronically in the portal. Generic for
// every workspace.
//   #/c/<id>/signing        what's waiting for you, agreements in progress,
//                           the register of signed agreements, and policy
//                           acknowledgements tracked per person.
//   #/c/<id>/signing/<ag>   one agreement: the document on screen (page
//                           navigation, zoom, search, thumbnails), its status,
//                           signers, versions and timeline, and signing.
// What each person sees is decided by the database (row level security);
// signing needs two-step sign-in with a code from the last 10 minutes, and
// the server checks the document's hash before saving a signature.
import { db, html, raw, render, $, $$, formData, toast, act, must, icon, pill, fmtDate, fmtDateTime, statCard, sectionGroup, emptyState } from '../lib.js';
import { filterAgreements, nextAgreementDate, signerTurn, daysUntil } from '../calc.js';
import { mountViewer } from '../pdfview.js';
import { TYPE, VISIBILITY, esignCall, signerChoices, newAgreement, editDetails, uploadVersion, fromTemplate, signersEditor, placementSaver,
  reasonDrawer, signedCopyDrawer, dueText } from './esign-prepare.js';

const STATUS = {
  draft: ['grey', 'Draft', 'waiting'], out_for_signature: ['blue', 'Out for signature', 'submitted'], partially_signed: ['amber', 'Partly signed', 'due'],
  completed: ['green', 'Signed', 'approved'], declined: ['red', 'Declined', 'rejected'], voided: ['grey', 'Voided', 'rejected'],
  expired: ['amber', 'Expired', 'expiry'], superseded: ['grey', 'Superseded', 'waiting'],
};
const REQ = { waiting: ['grey', 'Waiting their turn'], sent: ['blue', 'Asked to sign'], viewed: ['blue', 'Opened'], signed: ['green', 'Signed'], declined: ['red', 'Declined'] };
const EVENT = {
  created: 'Created', version_uploaded: 'Document version added', signers_set: 'Signers set', sent: 'Sent for signature', viewed: 'Viewed', signed: 'Signed',
  declined: 'Declined', reminded: 'Reminder sent', resumed: 'Signing resumed', voided: 'Voided', completed: 'Completed', signed_outside: 'Signed outside the portal',
  downloaded: 'Downloaded', commented: 'Comment added', shared: 'Funder sharing changed', superseded: 'Superseded by a variation', expired: 'Expired',
};
const CONSENT = { version: 'esign-1', text: 'I agree to sign this document electronically and that my electronic signature has the same effect as a handwritten signature.' };
const IN_PROGRESS = ['draft', 'out_for_signature', 'partially_signed', 'declined'];
const agPill = (s) => pill(...(STATUS[s] || ['grey', s]));
const reqPill = (s) => pill(...(REQ[s] || ['grey', s]));
const base = (ctx) => `#/c/${ctx.consortium.id}/signing`;

async function canPrepare(ctx) {
  if (ctx.manages) return true;
  if (ctx.role !== 'accountable_body') return false;
  const s = (await db.from('workspace_settings').select('agreements_accountable_body_prepares').eq('consortium_id', ctx.consortium.id).maybeSingle()).data;
  return !!s?.agreements_accountable_body_prepares;
}

export default async function signing(ctx, el, parts = []) {
  ctx.prepares = await canPrepare(ctx);
  if (parts[0]) return detail(ctx, el, parts[0]);
  return register(ctx, el);
}

// ------------------------------------------------------------------ the list

async function register(ctx, el, filters = {}) {
  const c = ctx.consortium;
  const [ags, reqs] = await Promise.all([
    db.from('agreements').select('*').eq('consortium_id', c.id).order('updated_at', { ascending: false }).then(must),
    db.from('signature_requests').select('id, agreement_id, version_id, status, signer_name, signer_email, signer_profile_id, signer_organisation_id, sign_order, signed_at').eq('consortium_id', c.id).then(must),
  ]);
  const current = (a) => reqs.filter((r) => r.version_id === a.current_version_id);
  const toSign = ags.filter((a) => ['out_for_signature', 'partially_signed'].includes(a.status))
    .map((a) => ({ a, r: current(a).find((r) => r.signer_profile_id === ctx.user.id && ['sent', 'viewed'].includes(r.status)) })).filter((x) => x.r);
  const acks = ags.filter((a) => a.type === 'policy_acknowledgement' && a.status !== 'draft');
  const inProgress = ags.filter((a) => IN_PROGRESS.includes(a.status) && a.type !== 'policy_acknowledgement');
  const done = ags.filter((a) => !IN_PROGRESS.includes(a.status) && a.type !== 'policy_acknowledgement');
  const soon = done.filter((a) => { const n = nextAgreementDate(a); return n && daysUntil(n.date) <= 60 && daysUntil(n.date) >= 0 && a.status === 'completed'; });
  const progress = (a) => { const rs = current(a); return rs.length ? `${rs.filter((r) => r.status === 'signed').length} of ${rs.length} signed` : 'No signers yet'; };
  const parties = (a) => a.parties.map((p) => ctx.org(p)?.name).filter(Boolean).join(', ') || (a.type === 'policy_acknowledgement' ? 'Everyone asked' : '–');
  const link = (a) => `${base(ctx)}/${a.id}`;
  const shown = filterAgreements(done, filters);
  const types = [...new Set(shown.map((a) => a.type))];

  const regTable = (list) => html`<div class="table-wrap"><table>
    <thead><tr><th>Agreement</th><th>Parties</th><th>Status</th><th>Signed</th><th>Effective</th><th>Expires</th><th>Next review</th></tr></thead>
    <tbody>${list.map((a) => html`<tr><td><a href="${link(a)}"><strong>${a.title}</strong></a>${a.signed_outside ? html`<br><span class="muted small">Signed outside the portal</span>` : ''}</td>
      <td>${parties(a)}</td><td>${agPill(a.status)}</td><td class="nowrap">${fmtDate(a.completed_at)}</td><td class="nowrap">${fmtDate(a.effective_date) || '–'}</td>
      <td class="nowrap">${fmtDate(a.expiry_date) || '–'}</td><td class="nowrap">${fmtDate(a.review_date) || '–'}</td></tr>`)}</tbody></table></div>`;
  const ackBody = (a) => {
    const rs = current(a);
    const byOrg = [...new Set(rs.map((r) => r.signer_organisation_id))];
    return byOrg.map((o) => {
      const list = rs.filter((r) => r.signer_organisation_id === o);
      return sectionGroup({ title: ctx.org(o)?.name || 'No organisation', meta: `${list.filter((r) => r.status === 'signed').length} of ${list.length} agreed`,
        body: html`<ul class="lw-list">${list.map((r) => html`<li class="lw-row static"><span class="lw-row-main"><strong>${r.signer_name || r.signer_email}</strong></span>
          <span class="lw-row-tags">${r.status === 'signed' ? html`${pill('green', 'Agreed')} <span class="small muted">${fmtDate(r.signed_at)}</span>` : reqPill(r.status)}</span></li>`)}</ul>` });
    });
  };

  render(el, html`
    <div class="page-head"><div><span class="eyebrow">Signing</span><h1>Agreements and signatures</h1>
      <p class="meta-line">Read agreements on screen and sign them here. Every view and signature is recorded.</p></div>
      ${ctx.prepares ? html`<div class="btns"><button class="btn secondary" id="ag-ack">${raw(icon('check', 16))}Policy acknowledgement</button>
        <button class="btn" id="ag-new">${raw(icon('add', 16))}New agreement</button></div>` : ''}</div>
    <div class="stats stats-4">
      ${statCard({ icon: 'submitted', value: toSign.length, label: 'Waiting for you', trend: toSign.length ? { dir: 'flat', tone: 'amber', text: 'to read and sign' } : { dir: 'up', tone: 'green', text: 'nothing to sign' } })}
      ${statCard({ icon: 'governance', value: inProgress.length, label: 'In progress', trend: { dir: 'flat', tone: 'grey', text: `${inProgress.filter((a) => a.status === 'declined').length} declined` } })}
      ${statCard({ icon: 'approved', value: done.filter((a) => a.status === 'completed').length, label: 'Signed', trend: { dir: 'flat', tone: 'grey', text: `${done.length} in the register` } })}
      ${statCard({ icon: 'expiry', value: soon.length, label: 'Expiry or review', trend: { dir: 'flat', tone: soon.length ? 'amber' : 'green', text: 'in the next 60 days' } })}</div>

    ${toSign.length ? html`<section class="dcard full ag-tosign"><header class="dcard-head"><h2>Agreements to sign</h2><p>Open each one, read it to the last page, then sign.</p></header>
      <ul class="lw-list">${toSign.map(({ a }) => html`<li class="lw-row static"><span class="lw-row-main"><strong>${a.title}</strong>
        <span class="muted small">${TYPE[a.type]}${a.due_date ? ` · ${dueText(a)}` : ''}</span></span>
        <span class="lw-row-tags">${a.due_date && daysUntil(a.due_date) < 0 ? pill('red', 'Overdue', 'overdue') : ''}<a class="btn small" href="${link(a)}">Open and sign</a></span></li>`)}</ul></section>` : ''}

    <div class="dgrid">
      <section class="dcard full"><header class="dcard-head"><h2>In progress</h2><p>Drafts, agreements out for signature and any that were declined.</p></header>
        ${inProgress.length ? IN_PROGRESS.map((s) => [s, inProgress.filter((a) => a.status === s)]).filter(([, l]) => l.length).map(([s, l]) => sectionGroup({
          title: STATUS[s][1], meta: `${l.length} agreement${l.length === 1 ? '' : 's'}`, open: s === 'declined',
          body: html`<ul class="lw-list">${l.map((a) => html`<li><a class="lw-row" href="${link(a)}"><span class="lw-row-main"><strong>${a.title}</strong>
            <span class="muted small">${TYPE[a.type]} · ${parties(a)}</span></span><span class="lw-row-tags"><span class="small muted">${progress(a)}</span>${a.due_date ? html`<span class="small muted">${dueText(a)}</span>` : ''}</span></a></li>`)}</ul>` }))
        : emptyState('governance', ctx.prepares ? 'Nothing in progress. Start a new agreement to send one for signature.' : 'Nothing in progress.')}</section>

      <section class="dcard full"><header class="dcard-head"><h2>Register</h2><p>Signed agreements, with their dates. The lead and the parties are told 60 and 30 days before an expiry or review date.</p></header>
        <form class="group-tools ag-filters" id="ag-filter">
          <label class="f">Type<select name="type"><option value="">Any type</option>${Object.entries(TYPE).filter(([k]) => k !== 'policy_acknowledgement').map(([k, v]) => html`<option value="${k}" ${raw(filters.type === k ? 'selected' : '')}>${v}</option>`)}</select></label>
          <label class="f">Party<select name="party"><option value="">Any party</option>${ctx.orgs.map((o) => html`<option value="${o.id}" ${raw(filters.party === o.id ? 'selected' : '')}>${o.name}</option>`)}</select></label>
          <label class="f">Status<select name="status"><option value="">Any status</option>${['completed', 'expired', 'superseded', 'voided'].map((s) => html`<option value="${s}" ${raw(filters.status === s ? 'selected' : '')}>${STATUS[s][1]}</option>`)}</select></label>
          <span class="muted small">${shown.length} of ${done.length}</span></form>
        ${shown.length ? types.map((t) => { const l = shown.filter((a) => a.type === t); return sectionGroup({ title: TYPE[t], meta: `${l.length} agreement${l.length === 1 ? '' : 's'}`, open: types.length === 1, body: regTable(l) }); })
          : html`<p class="empty">${done.length ? 'No agreements match.' : 'No signed agreements yet.'}</p>`}</section>

      ${acks.length ? html`<section class="dcard full"><header class="dcard-head"><h2>Policy acknowledgements</h2><p>Who has read and agreed each policy, by organisation.</p></header>
        ${acks.map((a) => { const rs = current(a); return sectionGroup({ title: a.title, meta: `${rs.filter((r) => r.status === 'signed').length} of ${rs.length} agreed`, aside: agPill(a.status),
          body: html`${ackBody(a)}<p style="margin-top:8px"><a class="btn secondary small" href="${link(a)}">Open</a></p>` }); })}</section>` : ''}

      ${ctx.manages ? html`<section class="dcard full lead-only"><header class="dcard-head"><h2>Who prepares agreements</h2></header>
        <label class="check"><input type="checkbox" id="ag-ab" ${raw(ctx.prepares && (await db.from('workspace_settings').select('agreements_accountable_body_prepares').eq('consortium_id', c.id).maybeSingle()).data?.agreements_accountable_body_prepares ? 'checked' : '')}>
          The accountable body can prepare and send agreements too (only the lead can void one)</label></section>` : ''}
    </div>`);

  const again = (f = filters) => register(ctx, el, f);
  $('#ag-filter', el)?.addEventListener('change', (e) => again(formData(e.currentTarget)));
  const open = (id) => { location.hash = `${base(ctx)}/${id}`; };
  if (ctx.prepares) {
    const extra = async () => {
      ctx.lwAgreements = (await db.from('lw_agreements').select('id, name, blocks_first_session, status').eq('consortium_id', c.id).is('retired_at', null).neq('status', 'signed')).data || [];
      ctx.schedules = (await db.from('partner_schedules').select('id, organisation_id, title, status').eq('consortium_id', c.id)).data || [];
    };
    $('#ag-new', el).addEventListener('click', (e) => act(e.currentTarget, async () => { await extra(); newAgreement(ctx, open); }));
    $('#ag-ack', el).addEventListener('click', (e) => act(e.currentTarget, async () => { await extra(); newAgreement(ctx, open, { type: 'policy_acknowledgement' }); }));
  }
  $('#ag-ab', el)?.addEventListener('change', (e) => act(null, async () => {
    must(await db.from('workspace_settings').update({ agreements_accountable_body_prepares: e.target.checked }).eq('consortium_id', c.id));
    toast(e.target.checked ? 'The accountable body can now prepare agreements.' : 'Only the lead prepares agreements now.');
  }));
}

// -------------------------------------------------------------- one agreement

async function detail(ctx, el, id, view = {}) {
  const a = must(await db.from('agreements').select('*').eq('id', id).maybeSingle());
  if (!a) { render(el, html`<div class="panel">That agreement isn't available to you. <a href="${base(ctx)}">Back to signing</a></div>`); return; }
  const [versions, reqs, events, comments, people] = await Promise.all([
    db.from('agreement_versions').select('*').eq('agreement_id', a.id).order('version', { ascending: false }).then(must),
    db.from('signature_requests').select('*').eq('agreement_id', a.id).order('sign_order').then(must),
    db.from('agreement_events').select('*').eq('agreement_id', a.id).order('at', { ascending: false }).then(must),
    db.from('agreement_comments').select('*').eq('agreement_id', a.id).order('created_at').then(must),
    signerChoices(ctx).catch(() => []),
  ]);
  const name = Object.fromEntries(people.filter((p) => p.profile_id).map((p) => [p.profile_id, p.name]));
  const who = (u) => (u === ctx.user.id ? 'You' : name[u] || (u ? 'A member' : 'The portal'));
  const cur = versions.find((v) => v.id === a.current_version_id);
  const curReqs = reqs.filter((r) => r.version_id === a.current_version_id);
  const mine = curReqs.find((r) => r.signer_profile_id === ctx.user.id);
  const live = ['out_for_signature', 'partially_signed'].includes(a.status);
  const myTurn = !!mine && live && ['sent', 'viewed'].includes(mine.status) && signerTurn(mine, curReqs);
  const prep = ctx.prepares;
  const party = ctx.seesAll || a.parties.includes(ctx.orgId) || !!mine;
  const finished = ['completed', 'expired', 'superseded'].includes(a.status);
  const allSigned = curReqs.length && curReqs.every((r) => r.status === 'signed');
  const shownVersion = view.version || a.current_version_id;
  const placing = view.placing ? curReqs.find((r) => r.id === view.placing) : null;
  const again = (v = {}) => detail(ctx, el, a.id, v);

  const actions = [];
  if (party && (cur || a.completed_pdf_path)) actions.push(html`<button class="btn secondary" id="ag-dl">${raw(icon('download', 16))}Download</button>`);
  if (prep && a.status === 'draft') {
    actions.push(html`<button class="btn secondary" id="ag-edit">Details</button>`);
    actions.push(html`<button class="btn secondary" id="ag-doc">${raw(icon('upload', 16))}${cur ? 'New version' : 'Add the document'}</button>`);
    if (a.type !== 'policy_acknowledgement') actions.push(html`<button class="btn secondary" id="ag-tpl">From a template</button>`);
    if (cur) actions.push(html`<button class="btn secondary" id="ag-signers">${a.type === 'policy_acknowledgement' ? 'Who acknowledges' : 'Signers'}</button>`);
    if (cur && curReqs.length) actions.push(html`<button class="btn" id="ag-send">${raw(icon('submitted', 16))}Send for signature</button>`);
  }
  if (prep && a.status === 'declined') actions.push(html`<button class="btn secondary" id="ag-doc">${raw(icon('upload', 16))}New version</button><button class="btn" id="ag-resume">Ask again</button>`);
  if (prep && a.status === 'partially_signed' && allSigned) actions.push(html`<button class="btn" id="ag-finish">Finish</button>`);
  if (prep && finished) actions.push(html`<button class="btn secondary" id="ag-vary">Create new version</button>`);
  if (prep && !finished && a.status !== 'voided' && a.status !== 'draft' && a.type !== 'policy_acknowledgement') actions.push(html`<button class="btn secondary" id="ag-copy">Upload signed copy</button>`);
  if (prep && a.status === 'draft' && a.requires_deed) actions.push(html`<button class="btn secondary" id="ag-copy">Upload signed copy</button>`);

  const facts = html`<dl class="facts small">
    <dt>Status</dt><dd>${agPill(a.status)}</dd>
    <dt>Type</dt><dd>${TYPE[a.type]}${a.requires_deed ? ' (a deed)' : ''}</dd>
    <dt>Parties</dt><dd>${a.parties.map((p) => ctx.org(p)?.name).filter(Boolean).join(', ') || '–'}</dd>
    <dt>Who sees it</dt><dd>${VISIBILITY[a.visibility]}${a.shared_with_funder ? ', and the funder' : ''}</dd>
    ${a.due_date && !finished ? html`<dt>Sign by</dt><dd>${fmtDate(a.due_date)}</dd>` : ''}
    <dt>Effective</dt><dd>${fmtDate(a.effective_date) || '–'}</dd><dt>Expires</dt><dd>${fmtDate(a.expiry_date) || '–'}</dd><dt>Review</dt><dd>${fmtDate(a.review_date) || '–'}</dd>
    ${a.completed_at ? html`<dt>Completed</dt><dd>${fmtDateTime(a.completed_at)}${a.signed_outside ? ' (signed outside the portal)' : ''}</dd>` : ''}
    ${a.outside_note ? html`<dt>Note</dt><dd>${a.outside_note}</dd>` : ''}
    ${a.void_reason ? html`<dt>Voided</dt><dd>${fmtDateTime(a.voided_at)}: ${a.void_reason}</dd>` : ''}
    ${cur?.signing_sha256 ? html`<dt>Document hash</dt><dd><code class="hash" title="SHA-256 of the document sent for signature">${cur.signing_sha256}</code></dd>` : ''}
    ${a.completed_sha256 ? html`<dt>Completed file hash</dt><dd><code class="hash">${a.completed_sha256}</code></dd>` : ''}
    ${a.varies_agreement_id ? html`<dt>Varies</dt><dd><a href="${base(ctx)}/${a.varies_agreement_id}">the original agreement</a></dd>` : ''}
  </dl>${prep && a.status !== 'draft' ? html`<label class="check small" style="margin-top:8px"><input type="checkbox" id="ag-funder" ${raw(a.shared_with_funder ? 'checked' : '')}> Shared with the funder</label>` : ''}`;

  const signerList = curReqs.length ? html`<ul class="lw-list">${curReqs.map((r) => html`<li class="lw-row static"><span class="lw-row-main">
      <strong>${r.signer_name || r.signer_email}${r.signer_profile_id ? '' : ' (invited)'}</strong>
      <span class="muted small">${[r.signer_role_label, ctx.org(r.signer_organisation_id)?.name, a.type === 'policy_acknowledgement' ? '' : `order ${r.sign_order}`].filter(Boolean).join(' · ')}</span>
      ${r.status === 'declined' ? html`<span class="small">Reason: ${r.decline_reason}</span>` : ''}</span>
    <span class="lw-row-tags">${reqPill(r.status)}${r.signed_at ? html`<span class="small muted">${fmtDateTime(r.signed_at)}</span>` : ''}
      ${prep && live && ['sent', 'viewed'].includes(r.status) ? html`<button type="button" class="linkbtn small" data-remind="${r.id}">Remind${r.reminder_count ? ` (${r.reminder_count})` : ''}</button>` : ''}
      ${prep && a.status === 'draft' && cur ? html`<button type="button" class="linkbtn small" data-place="${r.id}">${(r.placements || []).length ? `${r.placements.length} place${r.placements.length === 1 ? '' : 's'}` : 'Mark where they sign'}</button>` : ''}</span></li>`)}</ul>`
    : html`<p class="empty small">${a.type === 'policy_acknowledgement' ? 'Choose who acknowledges it.' : 'No signers yet.'}</p>`;

  // Viewed and downloaded events are grouped by day so the timeline stays short.
  const timeline = (() => {
    const days = [...new Set(events.map((e) => e.at.slice(0, 10)))];
    return days.map((d, i) => {
      const es = events.filter((e) => e.at.slice(0, 10) === d);
      return sectionGroup({ title: fmtDate(d), meta: `${es.length} event${es.length === 1 ? '' : 's'}`, open: i === 0,
        body: html`<ul class="ag-events">${es.map((e) => html`<li><span class="small muted">${fmtDateTime(e.at).split(', ').pop()}</span> <strong>${EVENT[e.event] || e.event}</strong>
          <span class="small">by ${who(e.actor)}${e.detail?.reason ? `: ${e.detail.reason}` : ''}${e.detail?.version ? ` (version ${e.detail.version})` : ''}</span></li>`)}</ul>` });
    });
  })();

  render(el, html`
    <div class="page-head"><div><span class="eyebrow"><a href="${base(ctx)}">Signing</a></span><h1>${a.title}</h1>
      <p class="meta-line">${TYPE[a.type]} · ${agPill(a.status)}${a.due_date && live ? ` · ${dueText(a)}` : ''}</p></div>
      ${actions.length ? html`<div class="btns">${actions}</div>` : ''}</div>
    ${myTurn ? html`<div class="lead-banner"><span><strong>Please sign.</strong> Read the document to its last page; the Sign button then becomes available.</span></div>` : ''}
    ${placing ? html`<div class="lead-banner"><span><strong>Marking where ${placing.signer_name || 'they'} sign${placing.signer_name ? 's' : ''}.</strong> Click on the page. Each click adds a place.</span>
      <span class="btns"><button type="button" class="btn secondary small" id="ag-place-clear">Clear places</button><button type="button" class="btn small" id="ag-place-done">Done</button></span></div>` : ''}
    <div class="ag-layout">
      <div class="ag-doc" id="ag-view">${cur || a.completed_pdf_path ? html`<p class="loading">Opening the document…</p>` : emptyState('governance', prep ? 'Add the document: upload a PDF or Word file, or create one from a template.' : 'The document hasn\'t been added yet.')}</div>
      <aside class="ag-side">
        ${myTurn ? signPanel(ctx, mine) : ''}
        <section class="ag-panel"><h2>Status</h2>${facts}</section>
        <section class="ag-panel"><h2>${a.type === 'policy_acknowledgement' ? 'People asked' : 'Signers'}</h2>
          ${curReqs.length ? html`<p class="small muted">${curReqs.filter((r) => r.status === 'signed').length} of ${curReqs.length} ${a.type === 'policy_acknowledgement' ? 'agreed' : 'signed'}</p>` : ''}${signerList}</section>
        ${versions.length ? html`<section class="ag-panel"><h2>Versions</h2><ul class="lw-list">${versions.map((v) => html`<li class="lw-row static"><span class="lw-row-main"><strong>Version ${v.version}</strong>
          <span class="muted small">${[v.source_name, v.change_note, fmtDate(v.created_at)].filter(Boolean).join(' · ')}</span></span>
          <span class="lw-row-tags">${v.locked_at ? pill('blue', 'Locked') : pill('grey', 'Draft')}${v.id === shownVersion ? html`<span class="small muted">showing</span>` : html`<button type="button" class="linkbtn small" data-version="${v.id}">View</button>`}</span></li>`)}</ul></section>` : ''}
        ${a.status === 'draft' || comments.length ? html`<section class="ag-panel"><h2>Comments</h2><p class="small muted">On the draft, before it's sent. Not part of the signed document.</p>
          ${comments.length ? html`<ul class="ag-comments">${comments.map((m) => html`<li><strong>${who(m.author)}</strong> <span class="small muted">${fmtDateTime(m.created_at)}</span><p>${m.body}</p></li>`)}</ul>` : ''}
          ${a.status === 'draft' && cur && ctx.role !== 'funder_observer' ? html`<form class="form" id="ag-comment"><label class="f">Add a comment<textarea name="body" required maxlength="2000" rows="2"></textarea></label><div class="btns"><button class="btn secondary small">Comment</button></div></form>` : ''}</section>` : ''}
        <section class="ag-panel"><h2>Timeline</h2>${timeline}</section>
        ${prep && !['voided', 'completed', 'expired', 'superseded'].includes(a.status) ? html`<section class="ag-panel">${a.status === 'draft' && !versions.some((v) => v.locked_at)
          ? html`<button type="button" class="linkbtn small" id="ag-delete">Delete this draft</button>` : ctx.manages ? html`<button type="button" class="linkbtn small" id="ag-void">Void this agreement</button>` : ''}</section>` : ''}
      </aside>
    </div>`);

  // The document.
  const viewEl = $('#ag-view', el);
  let reached = !!mine?.reached_end_at;
  if (cur || a.completed_pdf_path) {
    try {
      const opened = must(await db.rpc('agreement_open', { p_agreement: a.id, p_kind: 'view', p_version: view.version || null }));
      const { signedUrl } = must(await db.storage.from('agreements').createSignedUrl(opened.path, 60));
      const res = await fetch(signedUrl);
      if (!res.ok) throw new Error('The document could not be opened.');
      const bytes = new Uint8Array(await res.arrayBuffer());
      const marks = placing ? (placing.placements || []).map((p) => ({ ...p, label: placing.signer_name || 'Sign here' }))
        : curReqs.flatMap((r) => (r.placements || []).map((p) => ({ ...p, label: r.signer_name || 'Sign here' })));
      const places = placing ? [...(placing.placements || [])] : null;
      await mountViewer(viewEl, bytes, {
        watermark: opened.completed ? '' : 'Draft',
        marks: opened.completed ? [] : marks,
        onReachEnd: async () => {
          if (!myTurn || reached) return;
          reached = true;
          await db.rpc('agreement_reached_end', { p_request: mine.id });
          enableSign();
        },
        onPageClick: placing ? (page, x, y) => act(null, async () => {
          places.push({ page, x: Math.max(0, Math.min(0.7, x - 0.02)), y: Math.max(0, Math.min(0.94, y - 0.03)), w: 0.28, h: 0.06 });
          await placementSaver(a, curReqs)(placing.id, places);
          again({ placing: placing.id });
        }) : undefined,
      });
    } catch (e) {
      render(viewEl, html`<p class="panel">${e.message || 'The document could not be opened.'}</p>`);
    }
  }

  // Signing.
  const enableSign = () => { const b = $('#sign-btn', el); if (b) { b.disabled = !$('#sign-consent', el)?.checked; b.dataset.ready = '1'; } $('#sign-read', el)?.remove(); };
  if (myTurn) bindSign(ctx, el, a, mine, () => again(), reached && enableSign);

  // Everything else.
  $$('[data-version]', el).forEach((b) => b.addEventListener('click', () => again({ version: b.dataset.version })));
  $('#ag-dl', el)?.addEventListener('click', (e) => act(e.currentTarget, async () => {
    const blob = await esignCall({ action: 'download', agreement_id: a.id, version_id: view.version || null });
    const url = URL.createObjectURL(blob instanceof Blob ? blob : new Blob([blob], { type: 'application/pdf' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: `${a.title.replace(/[^\w -]+/g, '').trim() || 'agreement'}${finished ? '' : ' (draft)'}.pdf` });
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }));
  $('#ag-comment', el)?.addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => { must(await db.rpc('agreement_comment', { p_agreement: a.id, p_body: formData(e.target).body })); again(); });
  });
  if (!prep) return;
  $('#ag-edit', el)?.addEventListener('click', () => editDetails(ctx, a, () => again()));
  $('#ag-doc', el)?.addEventListener('click', () => uploadVersion(ctx, a, () => again()));
  $('#ag-tpl', el)?.addEventListener('click', (e) => act(e.currentTarget, () => fromTemplate(ctx, a, () => again())));
  $('#ag-signers', el)?.addEventListener('click', (e) => act(e.currentTarget, () => signersEditor(ctx, a, curReqs, () => again())));
  $('#ag-send', el)?.addEventListener('click', (e) => act(e.currentTarget, async () => {
    if (!confirm('Send for signature? The document is locked: any change after this needs a new version.')) return;
    const r = await esignCall({ action: 'send', agreement_id: a.id });
    toast(`Sent. ${r.asked} ${r.asked === 1 ? 'person has' : 'people have'} been asked to sign.`); again();
  }));
  $('#ag-resume', el)?.addEventListener('click', (e) => act(e.currentTarget, async () => { must(await db.rpc('agreement_resume', { p_agreement: a.id })); toast('Asked again.'); again(); }));
  $('#ag-finish', el)?.addEventListener('click', (e) => act(e.currentTarget, async () => { await esignCall({ action: 'complete', agreement_id: a.id }); toast('Completed.'); again(); }));
  $('#ag-vary', el)?.addEventListener('click', (e) => act(e.currentTarget, async () => {
    const nid = must(await db.rpc('agreement_vary', { p_agreement: a.id }));
    toast('Variation started: add the new document, then send it for signature. The original stays in force until it is signed.');
    location.hash = `${base(ctx)}/${nid}`;
  }));
  $('#ag-copy', el)?.addEventListener('click', () => signedCopyDrawer(a, () => again()));
  $('#ag-funder', el)?.addEventListener('change', (e) => act(null, async () => {
    must(await db.rpc('agreement_share_with_funder', { p_agreement: a.id, p_share: e.target.checked }));
    toast(e.target.checked ? 'Shared with the funder.' : 'No longer shared with the funder.');
  }));
  $('#ag-delete', el)?.addEventListener('click', (e) => act(e.currentTarget, async () => {
    if (!confirm('Delete this draft? This can\'t be undone.')) return;
    must(await db.rpc('agreement_delete_draft', { p_agreement: a.id })); location.hash = base(ctx);
  }));
  $('#ag-void', el)?.addEventListener('click', () => reasonDrawer('Void this agreement', 'Why is it being voided? Everyone involved is told.', 'Void it', async (reason) => {
    must(await db.rpc('agreement_void', { p_agreement: a.id, p_reason: reason })); toast('Voided.'); again();
  }));
  $$('[data-remind]', el).forEach((b) => b.addEventListener('click', () => act(b, async () => { must(await db.rpc('agreement_remind', { p_request: b.dataset.remind })); toast('Reminder sent.'); again(); })));
  $$('[data-place]', el).forEach((b) => b.addEventListener('click', () => again({ placing: b.dataset.place })));
  $('#ag-place-done', el)?.addEventListener('click', () => again());
  $('#ag-place-clear', el)?.addEventListener('click', (e) => act(e.currentTarget, async () => { await placementSaver(a, curReqs)(placing.id, []); again({ placing: placing.id }); }));
}

// ------------------------------------------------------------------ signing

function signPanel(ctx, r) {
  return html`<section class="ag-panel ag-sign"><h2>Sign</h2>
    <form class="form" id="ag-sign">
      <p class="small" id="sign-read">${raw(icon('info', 16))} Read to the last page to sign.</p>
      <div class="fields">
        <label class="f">Your name<input name="name" required maxlength="200" value="${ctx.profile.full_name || r.signer_name || ''}"></label>
        <label class="f">Your title<input name="title" maxlength="200" value="${ctx.profile.job_title || ''}"></label>
      </div>
      ${r.signer_role_label ? html`<p class="small muted">Signing ${r.signer_role_label}${ctx.org(r.signer_organisation_id) ? `, ${ctx.org(r.signer_organisation_id).name}` : ''}.</p>` : ''}
      <fieldset class="f"><legend>Signature</legend><div class="seg" role="radiogroup">
        <label class="seg-btn"><input type="radio" name="type" value="typed" checked> Type it</label>
        <label class="seg-btn"><input type="radio" name="type" value="drawn"> Draw it</label></div></fieldset>
      <div data-sig="typed"><label class="f">Type your name as your signature<input name="typed_name" maxlength="200" value="${ctx.profile.full_name || ''}"></label>
        <p class="ag-typed" aria-hidden="true">${ctx.profile.full_name || ''}</p></div>
      <div data-sig="drawn" hidden><canvas class="ag-pad" width="560" height="180" aria-label="Draw your signature here"></canvas>
        <button type="button" class="linkbtn small" id="pad-clear">Clear</button></div>
      <label class="check"><input type="checkbox" id="sign-consent" required> ${CONSENT.text}</label>
      <div class="ag-code" hidden><label class="f">Enter a fresh code from your authenticator app<span class="hint">Signing needs a code from the last 10 minutes.</span>
        <input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6"></label><div class="ag-enrol"></div></div>
      <div class="btns"><button class="btn" id="sign-btn" disabled>Sign</button><button type="button" class="linkbtn small" id="sign-decline">Decline to sign</button></div>
    </form></section>`;
}

// When the session last confirmed an authenticator code, from its token.
async function codeAge() {
  const { data: { session } } = await db.auth.getSession();
  try {
    const part = session.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(part.padEnd(part.length + ((4 - (part.length % 4)) % 4), '=')));
    const t = Math.max(0, ...(claims.amr || []).filter((x) => x.method === 'totp').map((x) => x.timestamp));
    return { aal: claims.aal, seconds: t ? Date.now() / 1000 - t : Infinity };
  } catch { return { aal: null, seconds: Infinity }; }
}

function bindSign(ctx, el, a, r, done, readyNow) {
  const f = $('#ag-sign', el);
  const btn = $('#sign-btn', f);
  const consent = $('#sign-consent', f);
  const update = () => { btn.disabled = !(btn.dataset.ready && consent.checked); };
  consent.addEventListener('change', update);
  if (readyNow) readyNow();
  // Typed or drawn.
  const pad = $('.ag-pad', f);
  const pen = pad.getContext('2d');
  let strokes = 0; let drawing = false;
  const pos = (e) => { const b = pad.getBoundingClientRect(); return [(e.clientX - b.left) * (pad.width / b.width), (e.clientY - b.top) * (pad.height / b.height)]; };
  pad.addEventListener('pointerdown', (e) => { drawing = true; pad.setPointerCapture(e.pointerId); pen.lineWidth = 2.4; pen.lineCap = 'round'; pen.strokeStyle = '#111a2c'; pen.beginPath(); pen.moveTo(...pos(e)); });
  pad.addEventListener('pointermove', (e) => { if (!drawing) return; pen.lineTo(...pos(e)); pen.stroke(); strokes++; });
  pad.addEventListener('pointerup', () => { drawing = false; });
  $('#pad-clear', f).addEventListener('click', () => { pen.clearRect(0, 0, pad.width, pad.height); strokes = 0; });
  const showSig = () => { const t = $('input[name=type]:checked', f).value; $('[data-sig=typed]', f).hidden = t !== 'typed'; $('[data-sig=drawn]', f).hidden = t !== 'drawn'; };
  $$('input[name=type]', f).forEach((x) => x.addEventListener('change', showSig));
  f.elements.typed_name.addEventListener('input', () => { $('.ag-typed', f).textContent = f.elements.typed_name.value; });

  // A fresh authenticator code, or setting one up for someone who has none.
  const codeBox = $('.ag-code', f);
  async function freshCode() {
    const age = await codeAge();
    if (age.aal === 'aal2' && age.seconds < 9 * 60) return true;
    const code = f.elements.code.value.trim();
    const factors = must(await db.auth.mfa.listFactors());
    let factor = factors.totp.find((x) => x.status === 'verified');
    if (!code) {
      codeBox.hidden = false;
      if (!factor && !$('.qr', codeBox)) {
        for (const x of factors.all.filter((x) => x.status !== 'verified')) await db.auth.mfa.unenroll({ factorId: x.id });
        const en = must(await db.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Portal ${new Date().toISOString().slice(0, 10)}` }));
        codeBox.dataset.factor = en.id;
        render($('.ag-enrol', codeBox), html`<p class="small muted">Signing needs two-step verification. Scan this with an authenticator app, such as Microsoft Authenticator or Google Authenticator, then enter the code it shows.</p>
          <div class="qr"><img src="${en.totp.qr_code}" alt="QR code for your authenticator app"></div>`);
      }
      f.elements.code.focus();
      throw new Error('Enter a fresh code from your authenticator app, then press Sign again.');
    }
    factor ||= { id: codeBox.dataset.factor };
    must(await db.auth.mfa.challengeAndVerify({ factorId: factor.id, code }));
    f.elements.code.value = '';
    codeBox.hidden = true;
    return true;
  }

  f.addEventListener('submit', (e) => {
    e.preventDefault();
    act(btn, async () => {
      if (!consent.checked) throw new Error('Tick the consent to sign electronically.');
      const v = formData(f);
      const type = v.type;
      if (type === 'typed' && !String(v.typed_name || '').trim()) throw new Error('Type your name as your signature.');
      if (type === 'drawn' && strokes < 5) throw new Error('Draw your signature in the box.');
      await freshCode();
      try {
        const res = await esignCall({ action: 'sign', request_id: r.id, type, typed_name: v.typed_name, drawn_png: type === 'drawn' ? pad.toDataURL('image/png') : null,
          name: v.name, title: v.title, consent_version: CONSENT.version });
        toast(res.complete ? 'Signed. Everyone has now signed: the completed agreement is ready.' : 'Signed. Thank you.');
        done();
      } catch (err) {
        if (err.hint === 'reconfirm') { codeBox.hidden = false; f.elements.code.focus(); }
        throw err;
      }
    });
  });
  $('#sign-decline', f).addEventListener('click', () => reasonDrawer('Decline to sign', 'Why are you declining? The lead is told, and the agreement is paused.', 'Decline', async (reason) => {
    must(await db.rpc('agreement_decline', { p_request: r.id, p_reason: reason })); toast('Declined. The lead has been told.'); done();
  }));
}
