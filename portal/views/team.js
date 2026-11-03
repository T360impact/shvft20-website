// People: who has access to this consortium, invitations, removing access
// in one step, and the audit trail of who changed what.
//
// Inviting: the consortium lead picks the person's organisation from this
// workspace, from others already on the platform ("Add to this workspace"),
// or adds a new one inside the form (checked for duplicates first). The
// organisation's relationship to the workspace suggests the roles to tick.
// Invitations last 14 days and can be resent or cancelled; until the portal
// sends email, the lead copies the link.
import { db, html, raw, render, $, $$, formData, toast, act, must, icon, pill, fmtDate, fmtDateTime, sectionGroup, ROLE_LABEL } from '../lib.js';
import { LEVEL } from './dbs.js';

// The invite function returns its own error text; surface it.
export async function adminCall(body) {
  const { data, error } = await db.functions.invoke('portal-admin', { body });
  if (error) {
    let message = error.message;
    try { message = (await error.context.json()).error || message; } catch { /* keep the generic message */ }
    throw new Error(message);
  }
  return data;
}

const ENTITY = {
  consortia: 'consortium details', organisations: 'an organisation', memberships: 'a member', key_dates: 'a key date', sites: 'a site',
  commitments: 'a commitment', documents: 'a document', partner_schedules: 'a schedule', young_people: 'a young person\'s record',
  yp_links: 'a register link', sessions: 'a session', attendance: 'attendance', outcome_measures: 'the outcome framework',
  outcomes: 'an outcome', returns: 'a return', invitations: 'an invitation',
};
// Extra roles a person can hold on top of their main one.
export const EXTRA = { org_admin: 'Org admin', finance: 'Finance', operations: 'Operations', reporting: 'Reporting',
  safeguarding: 'Safeguarding contact', bid_contributor: 'Bid contributor', hub_worker: 'Hub worker' };
export const RELATIONSHIP = { delivery_partner: 'Delivery partner', lead_organisation: 'Lead organisation', referral_partner: 'Referral partner',
  site_owner: 'Site owner', staffing_provider: 'Staffing provider', youth_voice: 'Youth voice', funder: 'Funder', shvft_team: 'Shvft team', other: 'Other' };
export const ORG_TYPE = { charity: 'Charity', cic: 'CIC', company: 'Company', local_authority: 'Local authority', nhs_body: 'NHS body',
  school_college: 'School or college', statutory_service: 'Statutory service', youth_voice_body: 'Youth voice body', funder: 'Funder', other: 'Other' };
// What each relationship suggests: the roles ticked, the others offered, and what they'll see.
const SUGGEST = {
  delivery_partner: { tick: ['partner_manager', 'reporting'], offer: ['partner_manager', 'reporting', 'finance', 'org_admin', 'safeguarding', 'hub_worker'],
    sees: 'The full partner dashboard: their targets, returns, weekly figures, risks and documents. Money only with the finance or org admin role.' },
  lead_organisation: { tick: ['accountable_body'], offer: ['accountable_body', 'finance', 'reporting', 'org_admin'], sees: 'The whole programme, as the accountable body.' },
  referral_partner: { tick: ['associate'], offer: ['associate', 'org_admin'], sees: 'The published Summary, documents shared with them and actions assigned to them. No targets, returns, finance or risks.' },
  youth_voice: { tick: ['youth_voice'], offer: ['youth_voice'], sees: 'The published Summary and the dashboard\'s aggregate figures.' },
  funder: { tick: ['funder_observer'], offer: ['funder_observer'], sees: 'What you publish to the funder.' },
  shvft_team: { tick: ['lead'], offer: ['lead'], sees: 'Everything, as the consortium lead team.' },
};
['site_owner', 'staffing_provider', 'other'].forEach((k) => { SUGGEST[k] = SUGGEST.referral_partner; });
const ROLE_NAME = { ...ROLE_LABEL, associate: 'Associate', ...EXTRA };
const ACTION = { insert: 'added', update: 'changed', delete: 'removed', view: 'viewed' };
const inviteLink = (token) => `${location.origin}/portal/?invite=${encodeURIComponent(token)}`;

// Shown after the page reloads with the new organisation in it.
let lastResult = null;

function linkBox(link, who, note = 'It works once and expires after 24 hours. Send it privately, for example by email from your own account.') {
  return html`<div class="link-box"><strong>Send this link to ${who}</strong>
    <span class="small">${note}</span>
    <input readonly value="${link}" id="the-link"><div class="btns"><button type="button" class="btn small" id="copy">Copy link</button></div></div>`;
}

export default async function team(ctx, el, parts = []) {
  const c = ctx.consortium;
  const [members, audit, invites] = await Promise.all([
    db.from('memberships').select('id, role, active, organisation_id, user_id, created_at, deactivated_at').eq('consortium_id', c.id).then(must),
    db.from('audit_log').select('*').eq('consortium_id', c.id).order('created_at', { ascending: false }).limit(100).then(must),
    db.from('invitations').select('id, organisation_id, email, full_name, job_title, role, extra_roles, status, expires_at, created_at, sent_at, accepted_at').eq('consortium_id', c.id).order('created_at', { ascending: false }).then(must),
  ]);
  const extras = members.length ? must(await db.from('membership_roles').select('membership_id, role').in('membership_id', members.map((m) => m.id))) : [];
  const has = (m, r) => extras.some((x) => x.membership_id === m.id && x.role === r);
  const ids = [...new Set([...members.map((m) => m.user_id), ...audit.map((a) => a.actor).filter(Boolean)])];
  const profiles = ids.length ? must(await db.from('profiles').select('id, full_name, email, job_title').in('id', ids)) : [];
  const who = (id) => profiles.find((p) => p.id === id);
  const orgName = (id) => (ctx.allOrgs || ctx.orgs).find((o) => o.id === id)?.name || '–';
  members.sort((a, b) => Number(b.active) - Number(a.active) || orgName(a.organisation_id).localeCompare(orgName(b.organisation_id)));
  const now = new Date().toISOString();
  const state = (i) => (i.status === 'pending' && i.expires_at < now ? 'expired' : i.status);
  const groups = [['pending', 'Waiting to be accepted'], ['expired', 'Expired'], ['accepted', 'Accepted'], ['cancelled', 'Cancelled']]
    .map(([k, t]) => [k, t, invites.filter((i) => state(i) === k)]).filter(([, , xs]) => xs.length);
  const preOrg = parts[0] === 'invite' ? ctx.orgs.find((o) => o.id === parts[1]) : null;

  render(el, html`
    <div class="page-head"><div><span class="eyebrow">People</span><h1>Who has access</h1>
      <p class="muted">Everyone signs in as themselves. What they see depends on their role and organisation. Anyone who can see young people's details must use two-step sign-in.</p></div>
      <div class="btns"><a class="btn secondary" href="#/c/${c.id}/organisations">Organisations</a></div></div>
    <div class="grid2">
      <section class="panel"><h2>Members</h2>
        <div class="table-wrap"><table>
          <thead><tr><th>Person</th><th>Organisation and role</th><th></th></tr></thead>
          <tbody>${members.map((m) => html`<tr class="${m.active ? '' : 'muted'}">
            <td><strong>${who(m.user_id)?.full_name || '–'}</strong><br><span class="small muted">${who(m.user_id)?.email || ''}${who(m.user_id)?.job_title ? ` · ${who(m.user_id).job_title}` : ''}</span></td>
            <td>${orgName(m.organisation_id)}<br><span class="small muted">${ROLE_NAME[m.role] || m.role}${m.active ? '' : ` · removed ${fmtDateTime(m.deactivated_at)}`}</span>
              ${m.active ? html`<details style="margin-top:6px"><summary class="small">Also: ${Object.keys(EXTRA).filter((r) => has(m, r)).map((r) => EXTRA[r]).join(', ') || 'no other roles'}</summary>
                <div class="checks" style="margin-top:6px">${Object.entries(EXTRA).map(([r, label]) => html`<label class="check small"><input type="checkbox" data-role="${r}" data-membership="${m.id}" ${has(m, r) ? 'checked' : ''}> ${label}</label>`)}</div></details>` : ''}</td>
            <td class="nowrap">${m.user_id === ctx.user.id ? html`<span class="small muted">You</span>` : m.active
              ? html`<button class="linkbtn small" data-reset="${who(m.user_id)?.email || ''}">Reset link</button><br><button class="linkbtn small" data-off="${m.id}">Remove access</button>`
              : html`<button class="linkbtn small" data-on="${m.id}">Restore</button>`}</td></tr>`)}</tbody></table></div>
        <div id="reset-out" style="margin-top:12px"></div>
      </section>
      <section class="panel"><h2>Invite someone</h2>
        <div id="invite-out">${lastResult || ''}</div>
        <form class="form" id="invite" autocomplete="off">
          <div class="f org-pick"><span>Organisation</span>
            <input type="search" id="org-q" placeholder="Search by name, charity or company number" aria-label="Find the organisation" aria-controls="org-results" value="${preOrg?.name || ''}">
            <div id="org-results" class="pick-list" role="listbox" hidden></div>
            <div id="org-chosen"></div></div>
          <div id="new-org" hidden></div>
          <div id="roles-box"></div>
          <div class="fields"><label class="f">Full name<input name="full_name" required maxlength="120"></label>
            <label class="f">Email<input type="email" name="email" required></label></div>
          <div id="dbs-hint"></div>
          <label class="f">Job title <span class="muted small">(optional)</span><input name="job_title" maxlength="120"></label>
          <label class="f">A personal message <span class="muted small">(optional)</span><textarea name="message" rows="3" maxlength="1000"></textarea></label>
          <div class="btns"><button class="btn">${raw(icon('submitted', 16))}Send invitation</button></div>
        </form>
      </section>
    </div>
    <section class="panel" style="margin-top:20px"><h2>Invitations</h2>
      <p class="muted small">Each link works for 14 days. Resending gives a fresh link and stops the old one.</p>
      ${groups.length ? groups.map(([k, t, xs], i) => sectionGroup({ title: t, meta: `${xs.length}`, open: i === 0 && k !== 'cancelled',
        body: html`<ul class="lw-list">${xs.map((x) => html`<li class="lw-row static"><span class="lw-row-main"><strong>${x.full_name}</strong>
          <span class="muted small">${x.email} · ${orgName(x.organisation_id)} · ${[x.role, ...(x.extra_roles || [])].map((r) => ROLE_NAME[r] || r).join(', ')}</span></span>
          <span class="lw-row-tags">${k === 'pending' ? pill('blue', `Expires ${fmtDate(x.expires_at)}`) : k === 'expired' ? pill('amber', 'Expired') : k === 'accepted' ? pill('green', `Accepted ${fmtDate(x.accepted_at)}`) : pill('grey', 'Cancelled')}
            ${['pending', 'expired'].includes(k) ? html`<button type="button" class="btn secondary small" data-resend="${x.id}">Resend</button><button type="button" class="linkbtn small" data-cancel="${x.id}">Cancel</button>` : ''}</span></li>`)}</ul>` }))
        : html`<p class="empty">No invitations yet.</p>`}
    </section>
    <section class="panel" style="margin-top:20px"><h2>Recent activity</h2>
      <p class="muted small">The last 100 changes.</p>
      ${audit.length ? html`<div class="table-wrap" style="margin-top:10px"><table><thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead>
        <tbody>${audit.map((a) => html`<tr><td class="nowrap small">${fmtDateTime(a.created_at)}</td><td>${who(a.actor)?.full_name || who(a.actor)?.email || 'System'}</td>
          <td>${ACTION[a.action] || a.action} ${ENTITY[a.entity] || a.entity}${a.detail?.status ? ` (${a.detail.status.replace('_', ' ')})` : ''}</td></tr>`)}</tbody></table></div>`
      : html`<p class="empty">Nothing yet.</p>`}
    </section>`);
  lastResult = null;

  const wireCopy = () => $('#copy')?.addEventListener('click', async () => {
    const input = $('#the-link');
    try { await navigator.clipboard.writeText(input.value); toast('Link copied.'); } catch { input.select(); }
  });
  wireCopy();
  bindInvite(ctx, el, preOrg);

  // Send (or show) an invitation's link.
  const deliver = async (inv, who) => {
    const res = await adminCall({ action: 'send_invite', consortium_id: c.id, invitation_id: inv.id, token: inv.token });
    const until = fmtDate(inv.expires_at);
    return res.sent ? html`<div class="banner info">Invitation emailed to ${who}. The link works until ${until}.</div>`
      : linkBox(inviteLink(inv.token), who, `${res.error || 'The portal doesn\'t send email yet, so send this yourself.'} It works once, until ${until}.`);
  };
  $$('[data-resend]').forEach((b) => b.addEventListener('click', () => act(b, async () => {
    const x = invites.find((i) => i.id === b.dataset.resend);
    const inv = must(await db.rpc('resend_invitation', { p_invitation: x.id }));
    lastResult = await deliver(inv, x.full_name); team(ctx, el);
  })));
  $$('[data-cancel]').forEach((b) => b.addEventListener('click', () => act(b, async () => {
    must(await db.rpc('cancel_invitation', { p_invitation: b.dataset.cancel })); toast('Invitation cancelled. The link no longer works.'); team(ctx, el);
  })));
  $$('[data-reset]').forEach((b) => b.addEventListener('click', () => act(b, async () => {
    const res = await adminCall({ action: 'reset_link', consortium_id: c.id, email: b.dataset.reset });
    render($('#reset-out'), linkBox(res.link, b.dataset.reset));
    wireCopy();
  })));
  $$('[data-off]').forEach((b) => b.addEventListener('click', () => act(b, async () => {
    must(await db.from('memberships').update({ active: false, deactivated_at: new Date().toISOString() }).eq('id', b.dataset.off));
    toast('Access removed.'); team(ctx, el);
  })));
  $$('[data-role]').forEach((box) => box.addEventListener('change', () => act(null, async () => {
    const row = { membership_id: box.dataset.membership, role: box.dataset.role };
    if (box.checked) must(await db.from('membership_roles').insert(row));
    else must(await db.from('membership_roles').delete().match(row));
    toast(box.checked ? `${EXTRA[row.role]} added.` : `${EXTRA[row.role]} removed.`);
  })));
  $$('[data-on]').forEach((b) => b.addEventListener('click', () => act(b, async () => {
    must(await db.from('memberships').update({ active: true, deactivated_at: null }).eq('id', b.dataset.on));
    toast('Access restored.'); team(ctx, el);
  })));

  // ----------------------------------------------------------- inviting
  function bindInvite(ctx, el, pre) {
    const form = $('#invite', el);
    const q = $('#org-q', form); const list = $('#org-results', form); const chosen = $('#org-chosen', form); const panel = $('#new-org', form);
    // { type: 'workspace' | 'platform' | 'new', organisation_id, partner_id, name, relationship }
    /** @type {any} */
    let pick = pre ? { type: 'workspace', organisation_id: pre.id, name: pre.name, relationship: pre.relationship || 'delivery_partner' } : null;
    let found = { workspace: [], platform: [] };
    let dupOk = false;
    const relSelect = (sel) => html`<label class="f">Relationship to this workspace<select name="relationship" required><option value="">Choose…</option>
      ${Object.entries(RELATIONSHIP).filter(([k]) => k !== 'shvft_team' || ctx.isAdmin).map(([k, t]) => html`<option value="${k}" ${k === sel ? 'selected' : ''}>${t}</option>`)}</select></label>`;
    const roles = (rel) => {
      const s = SUGGEST[rel];
      if (!s) return render($('#roles-box', form), '');
      render($('#roles-box', form), html`<fieldset><legend>Roles</legend><div class="checks">${s.offer.map((r) => html`<label class="check"><input type="checkbox" name="roles" value="${r}" ${s.tick.includes(r) ? 'checked' : ''}> ${ROLE_NAME[r]}</label>`)}</div>
        <p class="small muted" style="margin-top:6px">${raw(icon('info', 14))} ${s.sees}${pick?.type === 'new' ? ' As the first person from a new organisation, they also become its admin and are asked to complete its profile.' : ''}</p></fieldset>`);
    };
    const showChosen = () => {
      if (!pick) { render(chosen, ''); panel.hidden = true; roles(null); return; }
      if (pick.type === 'new') { render(chosen, ''); return; }
      render(chosen, html`<div class="chosen-org"><span><strong>${pick.name}</strong> ${pick.type === 'platform' ? pill('blue', 'Add to this workspace') : pill('grey', RELATIONSHIP[pick.relationship] || '')}</span>
        <button type="button" class="linkbtn small" id="org-change">Change</button></div>${pick.type === 'platform' ? relSelect('') : ''}`);
      $('#org-change', chosen).addEventListener('click', () => { pick = null; q.value = ''; showChosen(); q.focus(); search(); });
      $('[name=relationship]', chosen)?.addEventListener('change', (e) => { pick.relationship = e.target.value; roles(e.target.value); });
      roles(pick.relationship);
    };
    const newPanel = (name = '') => {
      pick = { type: 'new' }; dupOk = false; render(chosen, ''); panel.hidden = false;
      render(panel, html`<div class="new-org-panel"><div class="lw-row-main"><strong>A new organisation</strong><span class="small muted">It's added to the platform with a basic profile.</span></div>
        <label class="f">Organisation name<input name="org_name" required maxlength="200" value="${name}"></label>
        <div class="fields"><label class="f">Type<select name="org_type">${Object.entries(ORG_TYPE).map(([k, t]) => html`<option value="${k}">${t}</option>`)}</select></label>
          ${relSelect('')}</div>
        <div class="fields"><label class="f">Charity number <span class="muted small">(optional)</span><input name="charity_number" maxlength="20"></label>
          <label class="f">Company number <span class="muted small">(optional)</span><input name="company_number" maxlength="20"></label></div>
        <div class="fields"><label class="f">Website <span class="muted small">(optional)</span><input name="website" maxlength="200" placeholder="example.org.uk"></label>
          <label class="f">Main contact email <span class="muted small">(optional; the person you invite if left empty)</span><input type="email" name="contact_email"></label></div>
        <div id="dups"></div><button type="button" class="linkbtn small" id="new-cancel">Cancel and search again</button></div>`);
      $('[name=relationship]', panel).addEventListener('change', (e) => { pick.relationship = e.target.value; roles(e.target.value); });
      $$('[name=charity_number], [name=company_number], [name=org_name]', panel).forEach((i) => i.addEventListener('input', () => { dupOk = false; render($('#dups', panel), ''); }));
      $('#new-cancel', panel).addEventListener('click', () => { pick = null; panel.hidden = true; render(panel, ''); showChosen(); q.focus(); });
      $('[name=org_name]', panel).focus();
    };
    const choose = (opt) => {
      list.hidden = true;
      if (opt.dataset.new) return newPanel(q.value.trim());
      const x = (opt.dataset.kind === 'workspace' ? found.workspace : found.platform)[Number(opt.dataset.i)];
      pick = opt.dataset.kind === 'workspace' ? { type: 'workspace', organisation_id: x.organisation_id, name: x.name, relationship: x.relationship }
        : { type: 'platform', partner_id: x.partner_id, name: x.name, relationship: '' };
      panel.hidden = true; q.value = x.name; showChosen();
    };
    let timer;
    const search = () => { clearTimeout(timer); timer = setTimeout(async () => {
      if (pick && pick.type !== 'new' && q.value === pick.name) return;
      const res = must(await db.rpc('search_organisations', { p_consortium: ctx.consortium.id, p_q: q.value.trim() }));
      found = res;
      const row = (x, kind, i) => html`<li role="option" tabindex="-1" class="pick-opt" data-kind="${kind}" data-i="${i}"><strong>${x.name}</strong>
        <span class="small muted">${kind === 'workspace' ? RELATIONSHIP[x.relationship] || '' : [x.trading_name, x.charity_number && `Charity ${x.charity_number}`, x.company_number && `Company ${x.company_number}`].filter(Boolean).join(' · ')}</span>
        ${kind === 'platform' ? pill('blue', 'Add to this workspace') : ''}</li>`;
      render(list, html`<ul>${res.workspace.length ? html`<li class="pick-head" role="presentation">In this workspace</li>${res.workspace.map((x, i) => row(x, 'workspace', i))}` : ''}
        ${res.platform.length ? html`<li class="pick-head" role="presentation">On the platform</li>${res.platform.map((x, i) => row(x, 'platform', i))}` : ''}
        ${!res.platform.length && q.value.trim().length < 2 ? html`<li class="pick-head" role="presentation">Type two letters to search the platform</li>` : ''}
        <li role="option" tabindex="-1" class="pick-opt pick-new" data-new="1">${raw(icon('add', 16))}<strong>Add a new organisation</strong></li></ul>`);
      list.hidden = false;
      $$('.pick-opt', list).forEach((o) => { o.addEventListener('mousedown', (e) => { e.preventDefault(); choose(o); }); o.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); choose(o); } }); });
    }, 200); };
    q.addEventListener('input', () => { if (pick?.type !== 'new') pick = null; showChosen(); search(); });
    q.addEventListener('focus', search);
    q.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); $('.pick-opt', list)?.focus(); } if (e.key === 'Escape') list.hidden = true; });
    list.addEventListener('keydown', (e) => { const all = $$('.pick-opt', list); const i = all.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); all[Math.min(i + 1, all.length - 1)]?.focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); (i <= 0 ? q : all[i - 1]).focus(); } if (e.key === 'Escape') { list.hidden = true; q.focus(); } });
    q.addEventListener('blur', () => setTimeout(() => { if (!list.contains(document.activeElement)) list.hidden = true; }, 150));
    showChosen();

    // DBS: whether these roles need a check here, and whether the person already holds one.
    let hintTimer;
    const dbsHint = () => { clearTimeout(hintTimer); hintTimer = setTimeout(async () => {
      const ticked = $$('[name=roles]:checked', form).map((b) => b.value);
      const email = $('[name=email]', form).value.trim();
      const box = $('#dbs-hint', form);
      if (!ticked.length) { render(box, ''); return; }
      const { data: h } = await db.rpc('dbs_invite_check', { p_consortium: ctx.consortium.id, p_email: email, p_roles: ticked });
      if (!h?.required) { render(box, ''); return; }
      render(box, html`<div class="banner ${h.already ? 'ok' : 'info'}">${raw(icon('safeguarding', 18))}<span><strong>DBS required: ${LEVEL[h.level].toLowerCase()}.</strong>
        ${h.already ? ` Already verified, due ${fmtDate(h.already.due)}. It carries over.`
          : ` They'll be asked for it when they first sign in, with ${h.grace_days} days to provide it${h.block_delivery && ticked.includes('hub_worker') ? '. As a hub worker they can\'t be rostered until it\'s verified' : ''}.`}</span></div>`);
    }, 300); };
    form.addEventListener('change', (e) => { if (e.target.name === 'roles' || e.target.name === 'email') dbsHint(); });
    $('[name=email]', form).addEventListener('blur', dbsHint);
    dbsHint();

    form.addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => {
      const f = formData(form);
      const ticked = $$('[name=roles]:checked', form).map((b) => b.value);
      if (!pick) throw new Error('Choose the person\'s organisation, or add a new one.');
      if (pick.type !== 'workspace' && !pick.relationship) throw new Error('Choose the organisation\'s relationship to this workspace.');
      if (!ticked.length) throw new Error('Tick at least one role.');
      let orgId = pick.organisation_id;
      if (pick.type === 'platform') orgId = must(await db.rpc('add_organisation', { p_consortium: ctx.consortium.id, p_relationship: pick.relationship, p_partner: pick.partner_id }));
      if (pick.type === 'new') {
        // Possible duplicates first: offer the existing one.
        if (!dupOk) {
          const dups = must(await db.rpc('organisation_duplicates', { p_consortium: ctx.consortium.id, p_name: f.org_name, p_charity: f.charity_number || null, p_company: f.company_number || null }));
          if (dups.length) {
            render($('#dups', panel), html`<div class="banner warn"><div><strong>This may already be on the platform.</strong>
              <ul class="small" style="margin:6px 0">${dups.map((x, i) => html`<li>${x.name} (${x.reason}${x.charity_number ? `, charity ${x.charity_number}` : ''}${x.company_number ? `, company ${x.company_number}` : ''})
                <button type="button" class="btn secondary small" data-use="${i}">${x.organisation_id ? 'Use it' : 'Use it: add to this workspace'}</button></li>`)}</ul>
              ${dups.some((x) => x.reason !== 'a similar name') ? '' : html`<button type="button" class="linkbtn small" id="dup-no">No, it's a different organisation</button>`}</div></div>`);
            $$('[data-use]', panel).forEach((b) => b.addEventListener('click', () => { const x = dups[Number(b.dataset.use)];
              pick = x.organisation_id ? { type: 'workspace', organisation_id: x.organisation_id, name: x.name, relationship: pick.relationship || 'delivery_partner' }
                : { type: 'platform', partner_id: x.partner_id, name: x.name, relationship: pick.relationship || '' };
              panel.hidden = true; render(panel, ''); q.value = x.name; showChosen(); if (pick.type === 'platform' && pick.relationship) $('[name=relationship]', chosen).value = pick.relationship; }));
            $('#dup-no', panel)?.addEventListener('click', () => { dupOk = true; render($('#dups', panel), html`<p class="small muted">Noted. Send the invitation again to add it.</p>`); });
            return;
          }
        }
        orgId = must(await db.rpc('add_organisation', { p_consortium: ctx.consortium.id, p_relationship: pick.relationship, p_name: f.org_name, p_org_type: f.org_type,
          p_charity: f.charity_number || null, p_company: f.company_number || null, p_website: f.website || null, p_contact_email: f.contact_email || f.email }));
      }
      const inv = must(await db.rpc('create_invitation', { p_consortium: ctx.consortium.id, p_organisation: orgId, p_email: f.email, p_full_name: f.full_name,
        p_roles: ticked, p_job_title: f.job_title || null, p_message: f.message || null }));
      lastResult = await deliver(inv, f.full_name);
      if (pick.type !== 'workspace') await ctx.reload(); else team(ctx, el);
    }); });
  }
}
