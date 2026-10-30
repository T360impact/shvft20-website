// People: who has access to this consortium, invitations, removing access
// in one step, and the audit trail of who changed what.
import { db, html, render, $, $$, formData, toast, act, must, fmtDateTime, ROLE_LABEL } from '../lib.js';

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
  outcomes: 'an outcome', returns: 'a return',
};
// Extra roles a person can hold on top of their main one.
const EXTRA = { org_admin: 'Org admin', finance: 'Finance', operations: 'Operations', reporting: 'Reporting',
  safeguarding: 'Safeguarding contact', bid_contributor: 'Bid contributor', hub_worker: 'Hub worker' };

const ACTION = { insert: 'added', update: 'changed', delete: 'removed', view: 'viewed' };

function linkBox(link, who) {
  return html`<div class="link-box"><strong>Send this link to ${who}</strong>
    <span class="small">It works once and expires after 24 hours. Send it privately, for example by email from your own account.</span>
    <input readonly value="${link}" id="the-link"><div class="btns"><button type="button" class="btn small" id="copy">Copy link</button></div></div>`;
}

export default async function team(ctx, el) {
  const c = ctx.consortium;
  const [members, audit] = await Promise.all([
    db.from('memberships').select('id, role, active, organisation_id, user_id, created_at, deactivated_at').eq('consortium_id', c.id).then(must),
    db.from('audit_log').select('*').eq('consortium_id', c.id).order('created_at', { ascending: false }).limit(100).then(must),
  ]);
  const extras = members.length ? must(await db.from('membership_roles').select('membership_id, role').in('membership_id', members.map((m) => m.id))) : [];
  const has = (m, r) => extras.some((x) => x.membership_id === m.id && x.role === r);
  const ids = [...new Set([...members.map((m) => m.user_id), ...audit.map((a) => a.actor).filter(Boolean)])];
  const profiles = ids.length ? must(await db.from('profiles').select('id, full_name, email').in('id', ids)) : [];
  const who = (id) => profiles.find((p) => p.id === id);
  members.sort((a, b) => Number(b.active) - Number(a.active) || (ctx.org(a.organisation_id)?.name || '').localeCompare(ctx.org(b.organisation_id)?.name || ''));

  render(el, html`
    <div class="page-head"><div><span class="eyebrow">People</span><h1>Who has access</h1>
      <p class="muted">Everyone signs in as themselves. What they see depends on their role and organisation. Anyone who can see young people's details must use two-step sign-in.</p></div></div>
    <div class="grid2">
      <section class="panel"><h2>Members</h2>
        <div class="table-wrap"><table>
          <thead><tr><th>Person</th><th>Organisation and role</th><th></th></tr></thead>
          <tbody>${members.map((m) => html`<tr class="${m.active ? '' : 'muted'}">
            <td><strong>${who(m.user_id)?.full_name || '–'}</strong><br><span class="small muted">${who(m.user_id)?.email || ''}</span></td>
            <td>${ctx.org(m.organisation_id)?.name}<br><span class="small muted">${ROLE_LABEL[m.role]}${m.active ? '' : ` · removed ${fmtDateTime(m.deactivated_at)}`}</span>
              ${m.active ? html`<details style="margin-top:6px"><summary class="small">Also: ${Object.keys(EXTRA).filter((r) => has(m, r)).map((r) => EXTRA[r]).join(', ') || 'no other roles'}</summary>
                <div class="checks" style="margin-top:6px">${Object.entries(EXTRA).map(([r, label]) => html`<label class="check small"><input type="checkbox" data-role="${r}" data-membership="${m.id}" ${has(m, r) ? 'checked' : ''}> ${label}</label>`)}</div></details>` : ''}</td>
            <td class="nowrap">${m.user_id === ctx.user.id ? html`<span class="small muted">You</span>` : m.active
              ? html`<button class="linkbtn small" data-reset="${who(m.user_id)?.email || ''}">Reset link</button><br><button class="linkbtn small" data-off="${m.id}">Remove access</button>`
              : html`<button class="linkbtn small" data-on="${m.id}">Restore</button>`}</td></tr>`)}</tbody></table></div>
        <div id="reset-out" style="margin-top:12px"></div>
      </section>
      <section class="panel"><h2>Invite someone</h2>
        <form class="form" id="invite">
          <div class="fields">
            <label class="f">Full name<input name="full_name" required></label>
            <label class="f">Email<input type="email" name="email" required></label></div>
          <div class="fields">
            <label class="f">Organisation<select name="organisation_id" required><option value="">Choose…</option>${ctx.orgs.map((o) => html`<option value="${o.id}">${o.name}</option>`)}</select></label>
            <label class="f">Role<select name="role" required>${Object.entries(ROLE_LABEL).filter(([k]) => k !== 'platform_admin').map(([k, v]) => html`<option value="${k}" ${k === 'partner_manager' ? 'selected' : ''}>${v}</option>`)}</select></label></div>
          <div class="btns"><button class="btn">Create invitation</button></div>
        </form>
        <div id="invite-out" style="margin-top:12px"></div>
      </section>
    </div>
    <section class="panel" style="margin-top:20px"><h2>Recent activity</h2>
      <p class="muted small">The last 100 changes, and every time someone opened a young person's record.</p>
      ${audit.length ? html`<div class="table-wrap" style="margin-top:10px"><table><thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead>
        <tbody>${audit.map((a) => html`<tr><td class="nowrap small">${fmtDateTime(a.created_at)}</td><td>${who(a.actor)?.full_name || who(a.actor)?.email || 'System'}</td>
          <td>${ACTION[a.action] || a.action} ${ENTITY[a.entity] || a.entity}${a.detail?.status ? ` (${a.detail.status.replace('_', ' ')})` : ''}</td></tr>`)}</tbody></table></div>`
      : html`<p class="empty">Nothing yet.</p>`}
    </section>`);

  const wireCopy = () => $('#copy')?.addEventListener('click', async () => {
    const input = $('#the-link');
    try { await navigator.clipboard.writeText(input.value); toast('Link copied.'); } catch { input.select(); }
  });

  $('#invite').addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      const f = formData(e.target);
      const res = await adminCall({ action: 'invite', consortium_id: c.id, ...f });
      await team(ctx, el);
      render($('#invite-out'), res.link ? linkBox(res.link, f.full_name)
        : html`<div class="banner info">${f.full_name} already has an account, so they've been added. They'll see this consortium next time they sign in.</div>`);
      wireCopy();
    });
  });
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
}
