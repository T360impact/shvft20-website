// Consortium Portal: sign-in, two-step verification, the page shell and the
// router. Each screen lives in views/ and receives a context describing the
// consortium and the signed-in person's role in it.
import { db, html, render, raw, $, formData, toast, errorText, act, must, fmtDate, statusPill, daysUntil, ROLE_LABEL, PD_ROLES } from './lib.js';
import hub from './views/hub.js';
import agreements from './views/agreements.js';
import register from './views/register.js';
import sessions from './views/sessions.js';
import returns from './views/returns.js';
import dashboard from './views/dashboard.js';
import team from './views/team.js';
import admin from './views/admin.js';
import bid from './views/bid.js';
import library from './views/library.js';

const app = $('#app');

// Supabase reads sign-in links from the address bar on start-up, so note
// what kind of link this was before it clears it.
const startHash = location.hash;
const linkType = /[#&]type=(invite|recovery)/.exec(startHash)?.[1] || null;
const linkError = /[#&]error_description=([^&]+)/.exec(startHash)?.[1];

const state = { user: null, profile: null, memberships: [], ctx: null, ready: false };

const VIEWS = {
  bid: { label: 'Bid readiness', view: bid, roles: ['lead', 'accountable_body', 'partner_manager'] },
  dashboard: { label: 'Dashboard', view: dashboard, roles: 'all' },
  hub: { label: 'Consortium', view: hub, roles: 'all' },
  agreements: { label: 'Agreements', view: agreements, roles: ['lead', 'accountable_body', 'partner_manager', 'funder_observer'] },
  sessions: { label: 'Sessions', view: sessions, roles: PD_ROLES },
  register: { label: 'Young people', view: register, roles: PD_ROLES },
  returns: { label: 'Returns', view: returns, roles: ['lead', 'accountable_body', 'partner_manager', 'funder_observer'] },
  team: { label: 'People', view: team, roles: ['lead'] },
};

// Administrators see every page except the delivery ones, which need an
// organisation to record against.
// A bid workspace only has the bid pages; a live consortium keeps its bid
// as a record for the lead and accountable body.
const BID_VIEWS = ['bid', 'hub', 'agreements', 'team'];
const allowed = (key, ctx) => {
  const v = VIEWS[key];
  if (!v) return false;
  const stage = ctx.consortium.stage;
  if (stage !== 'live' && !BID_VIEWS.includes(key)) return false;
  if (stage === 'live' && key === 'bid' && !(ctx.seesAll && ctx.consortium.bid_deadline)) return false;
  return v.roles === 'all' || v.roles.includes(ctx.role) || (ctx.isAdmin && v.roles !== PD_ROLES);
};
const homeView = (ctx) => (ctx.consortium.stage === 'live' ? 'dashboard' : allowed('bid', ctx) ? 'bid' : 'hub');
// Shvft2.0 staff: administrators and anyone leading a consortium.
const isConvenor = () => !!state.profile?.is_platform_admin || state.memberships.some((m) => m.role === 'lead');

// ---------------------------------------------------------------- sign-in

function authCard(inner) {
  render(app, html`<div class="auth"><div class="auth-card">
    <span class="wordmark">SHVFT<span class="two">2.0</span><small>Consortium Portal</small></span>
    ${inner}
  </div></div>`);
}

function signInView(message) {
  authCard(html`
    <div><h1>Sign in</h1><p class="muted small" style="margin-top:6px">For partners in a Shvft2.0 consortium. Your lead sends you an invitation.</p></div>
    ${message ? html`<div class="banner warn">${message}</div>` : ''}
    <form class="form" id="signin">
      <label class="f">Email<input type="email" name="email" autocomplete="username" required></label>
      <label class="f">Password<input type="password" name="password" autocomplete="current-password" required></label>
      <button class="btn">Sign in</button>
    </form>
    <button class="linkbtn small" id="forgot" type="button">Forgotten your password?</button>`);
  $('#signin').addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      const { email, password } = formData(e.target);
      must(await db.auth.signInWithPassword({ email, password }));
      await boot();
    });
  });
  $('#forgot').addEventListener('click', forgotView);
}

function forgotView() {
  authCard(html`
    <div><h1>Reset your password</h1><p class="muted small" style="margin-top:6px">We'll email you a link. If it doesn't arrive, ask your consortium lead for a reset link.</p></div>
    <form class="form" id="forgot-form">
      <label class="f">Email<input type="email" name="email" autocomplete="username" required></label>
      <button class="btn">Send reset link</button>
    </form>
    <button class="linkbtn small" id="back" type="button">Back to sign in</button>`);
  $('#back').addEventListener('click', () => signInView());
  $('#forgot-form').addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      must(await db.auth.resetPasswordForEmail(formData(e.target).email, { redirectTo: `${location.origin}/portal/` }));
      toast('If that address has an account, a reset link is on its way.');
      signInView();
    });
  });
}

function setPasswordView(kind) {
  authCard(html`
    <div><h1>${kind === 'invite' ? 'Welcome to the portal' : 'Choose a new password'}</h1>
    <p class="muted small" style="margin-top:6px">Use at least 12 characters. A short sentence you'll remember works well.</p></div>
    <form class="form" id="setpw">
      <label class="f">New password<input type="password" name="password" minlength="12" autocomplete="new-password" required></label>
      <label class="f">Type it again<input type="password" name="confirm" minlength="12" autocomplete="new-password" required></label>
      <button class="btn">Save password</button>
    </form>`);
  $('#setpw').addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      const { password, confirm } = formData(e.target);
      if (password !== confirm) throw new Error('The two passwords don\'t match.');
      must(await db.auth.updateUser({ password }));
      toast('Password saved.');
      history.replaceState(null, '', '/portal/');
      await boot(true);
    });
  });
}

// Two-step sign-in with an authenticator app, required for anyone who can
// see young people's personal data.
async function mfaView() {
  const factors = must(await db.auth.mfa.listFactors());
  const verified = factors.totp.find((f) => f.status === 'verified');
  if (verified) {
    authCard(html`
      <div><h1>Two-step sign-in</h1><p class="muted small" style="margin-top:6px">Enter the 6-digit code from your authenticator app.</p></div>
      <form class="form" id="mfa">
        <label class="f">Code<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label>
        <button class="btn">Verify</button>
      </form>
      <button class="linkbtn small" id="out" type="button">Sign out</button>`);
    $('#mfa').addEventListener('submit', (e) => {
      e.preventDefault();
      act(e.submitter, async () => {
        must(await db.auth.mfa.challengeAndVerify({ factorId: verified.id, code: formData(e.target).code }));
        await boot(true);
      });
    });
  } else {
    // Clear half-finished set-ups so enrolment can start again.
    for (const f of factors.all.filter((f) => f.status !== 'verified')) await db.auth.mfa.unenroll({ factorId: f.id });
    const enrolled = must(await db.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Portal ${new Date().toISOString().slice(0, 10)}` }));
    authCard(html`
      <div><h1>Set up two-step sign-in</h1>
      <p class="muted small" style="margin-top:6px">You can see young people's personal details, so the portal needs a second check when you sign in. Scan this with an authenticator app such as Microsoft Authenticator or Google Authenticator, then enter the code it shows.</p></div>
      <div class="qr"><img src="${enrolled.totp.qr_code}" alt="QR code for your authenticator app"></div>
      <details><summary class="small">Can't scan it?</summary><p class="small muted" style="margin:8px 0 4px">Enter this key in the app instead:</p><code class="secret">${enrolled.totp.secret}</code></details>
      <form class="form" id="mfa">
        <label class="f">Code from the app<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label>
        <button class="btn">Turn on two-step sign-in</button>
      </form>
      <button class="linkbtn small" id="out" type="button">Sign out</button>`);
    $('#mfa').addEventListener('submit', (e) => {
      e.preventDefault();
      act(e.submitter, async () => {
        must(await db.auth.mfa.challengeAndVerify({ factorId: enrolled.id, code: formData(e.target).code }));
        toast('Two-step sign-in is on.');
        await boot(true);
      });
    });
  }
  $('#out').addEventListener('click', signOut);
}

async function signOut() {
  Object.assign(state, { user: null, profile: null, memberships: [], ctx: null, ready: false });
  await db.auth.signOut();
  history.replaceState(null, '', '/portal/');
  signInView();
}

// --------------------------------------------------------------- start-up

async function boot(skipLink = false) {
  const { data: { session } } = await db.auth.getSession();
  if (!session) return signInView(linkError ? decodeURIComponent(linkError.replace(/\+/g, ' ')) : null);
  if (!skipLink && linkType) return setPasswordView(linkType);

  state.user = session.user;
  state.profile = must(await db.from('profiles').select('*').eq('id', session.user.id).maybeSingle()) || {};
  state.memberships = must(await db.from('memberships')
    .select('id, role, consortium_id, organisation_id, consortia(name, stage, bid_deadline), organisations(name)')
    .eq('user_id', session.user.id).eq('active', true));

  const needsMfa = state.profile.is_platform_admin || state.memberships.some((m) => PD_ROLES.includes(m.role));
  if (needsMfa) {
    const aal = must(await db.auth.mfa.getAuthenticatorAssuranceLevel());
    if (aal.currentLevel !== 'aal2') return mfaView();
  }
  state.ready = true;
  if (!location.hash.startsWith('#/')) location.hash = '#/';
  else route();
}

// ------------------------------------------------------------------ shell

async function loadCtx(consortiumId) {
  if (state.ctx?.consortium.id === consortiumId) return state.ctx;
  const consortium = must(await db.from('consortia').select('*').eq('id', consortiumId).maybeSingle());
  if (!consortium) return null;
  const [orgs, sites] = await Promise.all([
    db.from('organisations').select('*').eq('consortium_id', consortiumId).order('name').then(must),
    db.from('sites').select('*').eq('consortium_id', consortiumId).order('name').then(must),
  ]);
  const m = state.memberships.find((x) => x.consortium_id === consortiumId);
  const isAdmin = !!state.profile.is_platform_admin;
  state.ctx = {
    consortium, orgs, sites, isAdmin,
    user: state.user, profile: state.profile,
    role: m?.role || (isAdmin ? 'platform_admin' : null),
    orgId: m?.organisation_id || null,
    orgName: m?.organisations?.name || '',
    seesAll: isAdmin || ['lead', 'accountable_body'].includes(m?.role),
    manages: isAdmin || m?.role === 'lead',
    hasPd: PD_ROLES.includes(m?.role),
    org: (id) => orgs.find((o) => o.id === id),
    site: (id) => sites.find((s) => s.id === id),
    reload: async () => { state.ctx = null; await loadCtx(consortiumId); route(); },
  };
  return state.ctx;
}

function shell(ctx, active) {
  const nav = ctx
    ? Object.entries(VIEWS).filter(([k]) => allowed(k, ctx) && (k !== 'team' || ctx.manages))
      .map(([k, v]) => html`<li><a href="#/c/${ctx.consortium.id}/${k}" ${raw(active === k ? 'aria-current="page"' : '')}>${k === 'hub' && ctx.consortium.stage !== 'live' ? 'Workspace' : v.label}</a></li>`)
    : [];
  render(app, html`
    <header class="bar"><div class="bar-in">
      <a class="wordmark" href="#/">SHVFT<span class="two">2.0</span><small>Portal</small></a>
      <span class="bar-c">${ctx ? `${ctx.consortium.name}${ctx.orgName ? ` · ${ctx.orgName}` : ''}` : ''}</span>
      <div class="bar-user">
        ${isConvenor() ? html`<a href="#/library">Library</a>` : ''}
        ${state.profile.is_platform_admin ? html`<a href="#/admin">Admin</a>` : ''}
        <a href="#/account">Account</a>
        <button type="button" id="signout">Sign out</button>
      </div>
    </div>
    ${nav.length ? html`<nav class="nav" aria-label="Portal"><ul>${nav}</ul></nav>` : ''}
    </header>
    <main id="main"></main>`);
  $('#signout').addEventListener('click', signOut);
  return $('#main');
}

async function home() {
  const main = shell(null);
  let list = state.memberships.map((m) => ({ id: m.consortium_id, name: m.consortia?.name, stage: m.consortia?.stage, deadline: m.consortia?.bid_deadline, role: m.role, org: m.organisations?.name }));
  if (state.profile.is_platform_admin) {
    const all = must(await db.from('consortia').select('id, name, stage, bid_deadline').order('name'));
    for (const c of all) if (!list.some((l) => l.id === c.id)) list.push({ id: c.id, name: c.name, stage: c.stage, deadline: c.bid_deadline, role: 'platform_admin' });
  }
  // Reminders: open bid items assigned to the user's organisations that are
  // due within a week or overdue.
  const myOrgs = state.memberships.map((m) => m.organisation_id);
  const soon = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const tasks = myOrgs.length ? must(await db.from('bid_items').select('id, consortium_id, name, due_on, status, consortia(name, stage)')
    .in('organisation_id', myOrgs).in('status', ['requested', 'returned']).lte('due_on', soon).order('due_on')).filter((t) => t.consortia?.stage === 'bid') : [];
  if (list.length === 1 && !tasks.length) { location.replace(`#/c/${list[0].id}/${list[0].stage === 'live' ? 'dashboard' : 'bid'}`); return; }
  const card = (c) => html`<a class="panel" href="#/c/${c.id}/${c.stage === 'live' ? 'dashboard' : 'bid'}" style="text-decoration:none">
    <h2>${c.name}</h2><p style="margin-top:8px">${statusPill(c.stage)}${c.stage === 'bid' && c.deadline ? html` <span class="small muted">Deadline ${fmtDate(c.deadline)}</span>` : ''}</p>
    <p class="muted small" style="margin-top:6px">${ROLE_LABEL[c.role]}${c.org ? ` · ${c.org}` : ''}</p></a>`;
  const bids = list.filter((c) => c.stage !== 'live');
  const live = list.filter((c) => c.stage === 'live');
  render(main, html`
    <div class="page-head"><div><span class="eyebrow">Welcome</span><h1>${state.profile.full_name ? `Hello, ${state.profile.full_name.split(' ')[0]}` : 'Your workspaces'}</h1></div></div>
    ${tasks.length ? html`<section class="panel" style="margin-bottom:20px"><h2>Due soon</h2>
      <div class="table-wrap"><table><tbody>${tasks.map((t) => {
        const n = daysUntil(t.due_on);
        return html`<tr><td><a href="#/c/${t.consortium_id}/bid/${t.id}">${t.name}</a><br><span class="small muted">${t.consortia?.name}</span></td>
          <td>${statusPill(t.status)}</td><td class="small nowrap">${n < 0 ? html`<span class="rag rag-red">${-n} day${n === -1 ? '' : 's'} overdue</span>` : n === 0 ? 'Due today' : `Due in ${n} day${n === 1 ? '' : 's'}`}</td></tr>`;
      })}</tbody></table></div></section>` : ''}
    ${live.length ? html`<h2 style="margin-bottom:12px">Consortia</h2><div class="grid2">${live.map(card)}</div>` : ''}
    ${bids.length ? html`<h2 style="margin:24px 0 12px">Bids</h2><div class="grid2">${bids.map(card)}</div>` : ''}
    ${!list.length ? html`<div class="panel"><p>You're not part of a bid or consortium yet. Your lead adds you, and you'll see it here.</p></div>` : ''}`);
}

function account() {
  const main = shell(null);
  render(main, html`
    <div class="page-head"><div><span class="eyebrow">Account</span><h1>${state.profile.full_name || state.user.email}</h1>
    <p class="muted">${state.user.email}</p></div></div>
    <div class="grid2">
      <div class="panel"><h2>Change password</h2>
        <form class="form" id="pw">
          <label class="f">New password<input type="password" name="password" minlength="12" autocomplete="new-password" required></label>
          <button class="btn">Save password</button>
        </form></div>
      <div class="panel"><h2>Your name</h2>
        <form class="form" id="nm">
          <label class="f">Full name<input name="full_name" value="${state.profile.full_name || ''}" required></label>
          <button class="btn">Save</button>
        </form></div>
    </div>`);
  $('#pw').addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => { must(await db.auth.updateUser({ password: formData(e.target).password })); e.target.reset(); toast('Password changed.'); });
  });
  $('#nm').addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      const { full_name } = formData(e.target);
      must(await db.from('profiles').update({ full_name }).eq('id', state.user.id));
      state.profile.full_name = full_name;
      toast('Saved.');
    });
  });
}

async function route() {
  if (!state.ready) return;
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  window.scrollTo(0, 0);
  try {
    if (!parts.length) return await home();
    if (parts[0] === 'account') return account();
    if (parts[0] === 'admin' && state.profile.is_platform_admin) return await admin(shell(null));
    if (parts[0] === 'library' && isConvenor()) return await library(shell(null), parts.slice(1));
    if (parts[0] === 'c' && parts[1]) {
      const ctx = await loadCtx(parts[1]);
      if (!ctx) { render(shell(null), html`<div class="panel">That consortium isn't available to you.</div>`); return; }
      const key = parts[2] || homeView(ctx);
      if (!allowed(key, ctx)) { location.replace(`#/c/${ctx.consortium.id}/${homeView(ctx)}`); return; }
      const main = shell(ctx, key);
      render(main, html`<p class="loading">Loading…</p>`);
      await VIEWS[key].view(ctx, main, parts.slice(3));
      return;
    }
    location.replace('#/');
  } catch (e) {
    const main = $('#main') || shell(null);
    render(main, html`<div class="panel"><h2>That didn't load</h2><p class="muted" style="margin-top:8px">${errorText(e)}</p></div>`);
  }
}

window.addEventListener('hashchange', route);
// Signed out elsewhere (another tab, or the session expired).
db.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT' && state.ready) {
    Object.assign(state, { user: null, profile: null, memberships: [], ctx: null, ready: false });
    signInView();
  }
});
boot().catch((e) => signInView(errorText(e)));
