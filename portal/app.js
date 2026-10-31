// Consortium Portal: sign-in, two-step verification, the page shell and the
// router. Each screen lives in views/ and receives a context describing the
// consortium and the signed-in person's role in it.
import { db, html, render, raw, $, $$, formData, toast, errorText, act, must, icon, pill, statusPill } from './lib.js';
import { PD_ROLES, PAGES, allowed, sidebar, tabsFor, PARENT, landing, isConvenor as convenorOf } from './nav.js';
import homePage from './views/home.js';
import hub from './views/hub.js';
import agreements from './views/agreements.js';
import uploads from './views/uploads.js';
import profile from './views/profile.js';
import compliance from './views/compliance.js';
import reporting from './views/reporting.js';
import returns from './views/returns.js';
import risks from './views/risks.js';
import dashboard from './views/dashboard.js';
import team, { adminCall } from './views/team.js';
import organisations from './views/organisations.js';
import shared from './views/shared.js';
import admin from './views/admin.js';
import bid from './views/bid.js';
import library from './views/library.js';
import targets from './views/targets.js';
import progress from './views/progress.js';
import lead from './views/lead.js';
import myOrg, { programme, master } from './views/mine.js';
import programmes from './views/programmes.js';
import setup from './views/setup.js';
import wizard from './views/wizard.js';
import { unreadCount, openNotifications, notifIcon } from './views/notifications.js';

const app = $('#app');

// Supabase reads sign-in links from the address bar on start-up, so note
// what kind of link this was before it clears it.
const startHash = location.hash;
// An invitation link (?invite=...) is kept until it has been accepted, so
// it survives signing in or setting up an account.
const INVITE_KEY = 'portal-invite';
const inviteFromUrl = new URLSearchParams(location.search).get('invite');
if (inviteFromUrl) { try { localStorage.setItem(INVITE_KEY, JSON.stringify({ token: inviteFromUrl, at: Date.now() })); } catch { /* the URL still has it */ } }
const pendingInvite = () => { try { const v = JSON.parse(localStorage.getItem(INVITE_KEY) || 'null'); return v && Date.now() - v.at < 864e5 * 14 ? v.token : null; } catch { return inviteFromUrl; } };
const clearInvite = () => { try { localStorage.removeItem(INVITE_KEY); } catch { /* nothing kept */ } };
// A sign-up link from an invitation can arrive as a magic link; it still needs a password.
const linkType = /[#&]type=(invite|recovery)/.exec(startHash)?.[1] || (/[#&]type=magiclink/.test(startHash) && pendingInvite() ? 'invite' : null);
const linkError = /[#&]error_description=([^&]+)/.exec(startHash)?.[1];

const state = { user: null, profile: null, memberships: [], ctx: null, ready: false, unread: 0, prefs: null };

// Light unless the person has chosen dark in Account; the device setting is ignored.
const applyTheme = (t) => { document.documentElement.dataset.theme = t === 'dark' ? 'dark' : 'light'; };

const TAB_ORDER = ['mine', 'master', 'dashboard', 'reporting', 'uploads', 'returns', 'bid', 'targets', 'hub'];

// Which page each route shows. Who may open each, and how the sidebar
// groups them, is in nav.js.
const VIEWS = { master, programme, mine: myOrg, bid, dashboard, shared, setup, hub, agreements, targets, progress, programmes, uploads, reporting, profile,
  organisations, compliance, returns, risks, team, lw: lead };

// A live workspace opens on each person's own tier: the master view for the
// consortium lead, the programme for the lead organisation, their own
// organisation for a partner, and the dashboard for everyone else.
const homeView = (ctx) => (ctx.onboarding && allowed('profile', ctx) ? 'profile' : ctx.role === 'associate' ? 'shared'
  : ctx.consortium.stage !== 'live' ? (allowed('bid', ctx) ? 'bid' : 'hub')
  : ['master', 'programme', 'mine'].find((k) => allowed(k, ctx) && (k !== 'master' || ctx.manages)) || 'dashboard');
// Shvft2.0 staff: administrators and anyone leading a consortium.
const isConvenor = () => convenorOf(state.profile, state.memberships);

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

// The invitation link, before signing in: who invited them to what, then
// set up an account (new) or sign in as the invited address (existing).
async function inviteView(token) {
  const { data: inv } = await db.rpc('invitation_info', { p_token: token });
  const done = (msg) => { clearInvite(); history.replaceState(null, '', '/portal/'); signInView(msg); };
  if (!inv) return done('That invitation link isn\'t valid. Ask the consortium lead for a new one.');
  if (inv.status !== 'pending') return done(inv.status === 'expired' ? 'That invitation has expired. Ask the consortium lead to resend it.'
    : inv.status === 'accepted' ? 'That invitation has been accepted. Sign in to continue.' : 'That invitation was cancelled. Ask the consortium lead for a new one.');
  authCard(html`
    <div><h1>You're invited</h1><p class="muted small" style="margin-top:6px">${inv.invited_by || 'The consortium lead'} has invited ${inv.full_name} to join
      <strong>${inv.workspace}</strong>, as part of ${inv.organisation}.</p></div>
    ${inv.message ? html`<blockquote class="src-quote">${inv.message}</blockquote>` : ''}
    <p class="small muted">For ${inv.email_hint}. The link works until ${new Date(inv.expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.</p>
    ${inv.has_account ? html`<button class="btn" id="inv-signin">Sign in to accept</button>`
      : html`<button class="btn" id="inv-new">Accept and set up your account</button><button class="linkbtn small" id="inv-signin" type="button">I already have an account</button>`}`);
  $('#inv-signin').addEventListener('click', () => signInView(`Sign in as ${inv.email_hint} to accept the invitation to ${inv.workspace}.`));
  $('#inv-new')?.addEventListener('click', (e) => act(e.currentTarget, async () => {
    const res = await adminCall({ action: 'accept_new', token });
    location.href = res.link;
  }));
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
  applyTheme('light');
  Object.assign(state, { user: null, profile: null, memberships: [], ctx: null, ready: false });
  await db.auth.signOut();
  history.replaceState(null, '', '/portal/');
  signInView();
}

// --------------------------------------------------------------- start-up

async function boot(skipLink = false) {
  const { data: { session } } = await db.auth.getSession();
  if (!session) return pendingInvite() && !linkError ? inviteView(pendingInvite()) : signInView(linkError ? decodeURIComponent(linkError.replace(/\+/g, ' ')) : null);
  if (!skipLink && linkType) return setPasswordView(linkType);
  // Signed in with an invitation waiting: accept it as this person.
  if (pendingInvite()) {
    const { data: acc, error } = await db.rpc('accept_invitation', { p_token: pendingInvite() });
    clearInvite();
    history.replaceState(null, '', `/portal/${acc ? `#/c/${acc.consortium_id}` : location.hash}`);
    if (error) toast(errorText(error), 'bad'); else toast('Invitation accepted. Welcome.');
  }

  state.user = session.user;
  state.profile = must(await db.from('profiles').select('*').eq('id', session.user.id).maybeSingle()) || {};
  applyTheme(state.profile.theme);
  state.memberships = must(await db.from('memberships')
    .select('id, role, onboarding, consortium_id, organisation_id, consortia(name, stage, bid_deadline), organisations(name)')
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
  const [allOrgs, sites] = await Promise.all([
    db.from('organisations').select('*').eq('consortium_id', consortiumId).order('name').then(must),
    db.from('sites').select('*').eq('consortium_id', consortiumId).order('name').then(must),
  ]);
  // Organisations taken out of the workspace keep their names for old records.
  const orgs = allOrgs.filter((o) => !o.removed_at);
  const m = state.memberships.find((x) => x.consortium_id === consortiumId);
  const isAdmin = !!state.profile.is_platform_admin;
  // Roles held on top of the main one (finance, org admin, ...).
  const extraRoles = m ? must(await db.from('membership_roles').select('role').eq('membership_id', m.id)).map((r) => r.role) : [];
  // Lead Workspace: roles held on the lead team (none for most people), and
  // whether this person is on the staff list with their own shifts.
  const [lwCtx, mine] = await Promise.all([
    db.rpc('lw_context', { p_consortium: consortiumId }).then(({ data }) => data || { roles: [] }),
    db.rpc('lw_my_shifts', { p_consortium: consortiumId }).then(({ data }) => data),
  ]);
  state.ctx = {
    consortium, orgs, allOrgs, sites, isAdmin,
    onboarding: !!m?.onboarding,
    user: state.user, profile: state.profile,
    role: m?.role || (isAdmin ? 'platform_admin' : null),
    extraRoles,
    lw: lwCtx,
    staffSelf: !!mine?.staff,
    orgId: m?.organisation_id || null,
    orgName: m?.organisations?.name || '',
    seesAll: isAdmin || ['lead', 'accountable_body'].includes(m?.role),
    manages: isAdmin || m?.role === 'lead',
    hasPd: PD_ROLES.includes(m?.role),
    org: (id) => allOrgs.find((o) => o.id === id),
    site: (id) => sites.find((s) => s.id === id),
    reload: async () => { state.ctx = null; await loadCtx(consortiumId); route(); },
  };
  return state.ctx;
}

// Collapsed sidebar groups, remembered on this device.
const NAV_KEY = 'portal-nav-closed';
const closedGroups = () => { try { return JSON.parse(localStorage.getItem(NAV_KEY) || '[]'); } catch { return []; } };

// Notifications, Library, Admin, Account and Sign out, in either frame.
function wireCommon() {
  document.querySelectorAll('[data-signout]').forEach((b) => b.addEventListener('click', signOut));
  const paintCount = () => { document.querySelectorAll('[data-notifs]').forEach((b) => render(b, notifIcon(state.unread))); };
  document.querySelectorAll('[data-notifs]').forEach((b) => b.addEventListener('click', () => openNotifications(async () => { state.unread = await unreadCount(); paintCount(); })));
  unreadCount().then((n) => { state.unread = n; paintCount(); }).catch(() => {});
}

// Outside a workspace (Home, Account, Library, Admin, the wizards): a slim
// top bar only, no sidebar.
function topShell(active) {
  render(app, html`
    <div class="app top-only">
      <header class="platform-bar">
        <a class="wordmark" href="#/">SHVFT<span class="two">2.0</span><small>Portal</small></a>
        <div class="platform-bar-right">
          <button type="button" class="icon-btn" data-notifs aria-label="Notifications">${notifIcon(state.unread)}</button>
          <details class="account-menu"><summary aria-label="Account menu"><span class="avatar">${(state.profile.full_name || state.user.email || '?').slice(0, 1).toUpperCase()}</span></summary>
            <div class="account-pop"><p class="small"><strong>${state.profile.full_name || ''}</strong><br><span class="muted">${state.user.email}</span></p>
              <a href="#/" ${raw(active === 'home' ? 'aria-current="page"' : '')}>${raw(icon('home', 18))}All projects</a>
              ${isConvenor() ? html`<a href="#/library">${raw(icon('library', 18))}Library</a>` : ''}
              ${state.profile.is_platform_admin ? html`<a href="#/admin">${raw(icon('admin', 18))}Admin</a>` : ''}
              <a href="#/account">${raw(icon('people', 18))}Account</a>
              <button type="button" data-signout>${raw(icon('logout', 18))}Sign out</button></div></details>
        </div>
      </header>
      <main id="main" class="platform-main"></main>
    </div>`);
  wireCommon();
  return $('#main');
}

// Inside a workspace: the sidebar with the workspace's name, status and a
// switcher, then its pages in groups (collapsible, remembered), and the
// Lead workspace for the lead team. A top bar and tab bar on a phone.
function shell(ctx, active) {
  if (!ctx) return topShell(active);
  const c = ctx.consortium;
  const groups = sidebar(ctx);
  const closed = closedGroups();
  const current = PARENT[active] || active;
  const lwSub = active === 'lw' ? `lw/${location.hash.split('/')[4] || 'week'}` : '';
  const isOn = (i) => i.key === current || i.key === lwSub || (i.key === 'dashboard' && active === 'master');
  const link = (i, short) => html`<a href="${i.href}" class="m-${i.mod}" ${raw(isOn(i) ? 'aria-current="page"' : '')}>${raw(icon(i.icon, 20))}<span>${short ? i.label.split(' ')[0] : i.label}</span></a>`;
  const mine = [...new Map(state.memberships.map((m) => [m.consortium_id, m])).values()];
  const switcher = mine.length > 1 || !mine.some((m) => m.consortium_id === c.id) ? html`<label class="ws-switch"><span class="sr-only">Switch workspace</span>
    <select id="ws-switch">${[...(mine.some((m) => m.consortium_id === c.id) ? [] : [{ consortium_id: c.id, consortia: { name: c.name } }]), ...mine].map((m) => html`<option value="${m.consortium_id}" ${m.consortium_id === c.id ? 'selected' : ''}>${m.consortia?.name}</option>`)}</select></label>` : '';
  const extras = html`<button type="button" data-notifs>${notifIcon(state.unread)}</button>
    ${isConvenor() ? html`<a href="#/library">${raw(icon('library', 20))}<span>Library</span></a>` : ''}
    ${state.profile.is_platform_admin ? html`<a href="#/admin">${raw(icon('admin', 20))}<span>Admin</span></a>` : ''}
    <a href="#/account">${raw(icon('people', 20))}<span>Account</span></a>`;
  const flat = groups.flatMap((g) => g.items);
  // The phone's tab bar holds the most used pages; the rest go under More.
  const tabs = TAB_ORDER.map((k) => flat.find((i) => i.key === k)).filter(Boolean).slice(0, 3);
  render(app, html`
    <div class="app">
      <aside class="side">
        <a class="wordmark" href="#/">SHVFT<span class="two">2.0</span><small>Portal</small></a>
        <div class="ws-head"><a class="all-projects" href="#/">${raw(icon('home', 16))}All projects</a>
          <p class="ws-name"><strong>${c.name}</strong></p>
          <p class="ws-meta">${statusPill(c.stage)}${c.is_demo ? pill('grey', 'Demo') : ''}${ctx.orgName ? html`<span class="small muted">${ctx.orgName}</span>` : ''}</p>
          ${switcher}</div>
        <nav aria-label="Workspace">${groups.map((g) => html`<details class="side-sec" data-group="${g.key}" ${raw(closed.includes(g.key) ? '' : 'open')}>
          <summary class="side-group">${g.label}</summary><ul>${g.items.map((i) => html`<li>${link(i)}</li>`)}</ul></details>`)}</nav>
        <div class="foot">${extras}<button type="button" data-signout>${raw(icon('logout', 20))}<span>Sign out</span></button></div>
      </aside>
      <div class="main-col">
        <header class="topbar"><a class="wordmark" href="#/">SHVFT<span class="two">2.0</span></a><span class="where">${c.name}</span></header>
        <main id="main"></main>
      </div>
      <nav class="tabbar" aria-label="Portal shortcuts"><a href="#/" class="m-brand">${raw(icon('home', 20))}<span>All</span></a>${tabs.map((i) => link(i, true))}
        <button type="button" id="more" aria-haspopup="dialog">${raw(icon('more', 20))}<span>More</span></button></nav>
      <dialog class="more-sheet" id="more-sheet" aria-label="More pages"><ul>
        ${groups.map((g) => html`<li class="sheet-group">${g.label}</li>${g.items.map((i) => html`<li>${link(i)}</li>`)}`)}
        <li>${extras}</li>
        <li><button type="button" class="row" data-signout>${raw(icon('logout', 20))}<span>Sign out</span></button></li>
        <li><button type="button" class="row" data-close-sheet>${raw(icon('close', 20))}<span>Close</span></button></li></ul></dialog>
    </div>`);
  wireCommon();
  $$('.side-sec').forEach((d) => d.addEventListener('toggle', () => {
    const now = new Set(closedGroups());
    if (d.open) now.delete(d.dataset.group); else now.add(d.dataset.group);
    try { localStorage.setItem(NAV_KEY, JSON.stringify([...now])); } catch { /* remembered for this visit only */ }
  }));
  $('#ws-switch')?.addEventListener('change', (e) => { location.hash = `#/c/${e.target.value}`; });
  const sheet = $('#more-sheet');
  $('#more').addEventListener('click', () => sheet.showModal());
  sheet.addEventListener('click', (e) => { if (e.target === sheet || e.target.closest('a, [data-close-sheet]')) sheet.close(); });
  // Pages shown together (the Dashboard's tiers, Summary and the programme, ...) get tabs.
  const main = $('#main');
  const tabsHere = tabsFor(active, ctx);
  if (!tabsHere.length) return main;
  render(main, html`<nav class="page-tabs" aria-label="${PAGES[current]?.label || ''}">${tabsHere.map((t) => html`<a href="${t.href}" ${raw(t.key === active ? 'aria-current="page"' : '')}>${t.label}</a>`)}</nav><div id="tab-body"></div>`);
  return $('#tab-body');
}

async function home() {
  const main = topShell('home');
  await homePage(main, state);
}

// After a wizard creates a workspace: the person is now its consortium lead.
async function created(id) {
  state.memberships = must(await db.from('memberships')
    .select('id, role, onboarding, consortium_id, organisation_id, consortia(name, stage, bid_deadline), organisations(name)')
    .eq('user_id', state.user.id).eq('active', true));
  state.ctx = null;
  location.hash = `#/c/${id}/setup`;
}

async function account() {
  state.prefs = must(await db.from('notification_prefs').select('*').eq('user_id', state.user.id).maybeSingle());
  const main = topShell('account');
  render(main, html`
    <div class="page-head"><div><span class="eyebrow">Account</span><h1>${state.profile.full_name || state.user.email}</h1>
    <p class="muted">${state.user.email}</p></div></div>
    <div class="grid2">
      <div class="panel"><h2>Change password</h2>
        <form class="form" id="pw">
          <label class="f">New password<input type="password" name="password" minlength="12" autocomplete="new-password" required></label>
          <button class="btn">Save password</button>
        </form></div>
      <div class="panel"><h2>Appearance</h2>
        <form class="form" id="theme"><fieldset><legend>Theme</legend><div class="checks">
          <label class="check"><input type="radio" name="theme" value="light" ${state.profile.theme !== 'dark' ? 'checked' : ''}> Light</label>
          <label class="check"><input type="radio" name="theme" value="dark" ${state.profile.theme === 'dark' ? 'checked' : ''}> Dark</label></div></fieldset>
          <p class="small muted">Saved to your account, so it follows you to any device.</p></form></div>
      <div class="panel"><h2>Email notifications</h2>
        <form class="form" id="np"><fieldset><legend>Send me portal notices by email</legend><div class="checks">
          ${[['immediate', 'As they happen'], ['daily', 'A daily digest at 7am'], ['weekly', 'A weekly digest on Mondays'], ['off', 'Never (portal only)']].map(([v, t]) => html`<label class="check"><input type="radio" name="mode" value="${v}" ${(state.prefs?.email_mode || 'immediate') === v ? 'checked' : ''}> ${t}</label>`)}</div></fieldset>
          <p class="small muted">Returns due or sent back, payments, actions and risks assigned to you, documents expiring, and reminders from the consortium lead.</p></form></div>
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
  $('#np').addEventListener('change', (e) => act(null, async () => {
    must(await db.from('notification_prefs').upsert({ user_id: state.user.id, email_mode: e.target.value, updated_at: new Date().toISOString() }));
    toast('Saved.');
  }));
  $('#theme').addEventListener('change', (e) => act(null, async () => {
    const theme = e.target.value;
    must(await db.from('profiles').update({ theme }).eq('id', state.user.id));
    state.profile.theme = theme;
    applyTheme(theme);
    toast(theme === 'dark' ? 'Dark theme on.' : 'Light theme on.');
  }));
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
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const parts = path.split('/').filter(Boolean);
  window.scrollTo(0, 0);
  try {
    if (!parts.length) {
      // Anyone but a lead or Shvft staff, with one workspace, goes straight in.
      const to = landing(state.profile, state.memberships);
      if (to) { location.replace(to); return; }
      return await home();
    }
    if (parts[0] === 'account') return await account();
    if (parts[0] === 'new' && isConvenor()) return await wizard(topShell('new'), state, parts.slice(1), created);
    if (parts[0] === 'admin' && state.profile.is_platform_admin) return await admin(topShell('admin'));
    if (parts[0] === 'library' && isConvenor()) return await library(topShell('library'), parts.slice(1));
    if (parts[0] === 'c' && parts[1]) {
      const ctx = await loadCtx(parts[1]);
      if (!ctx) { render(topShell(null), html`<div class="panel">That consortium isn't available to you.</div>`); return; }
      const key = parts[2] || homeView(ctx);
      if (!allowed(key, ctx)) { location.replace(`#/c/${ctx.consortium.id}/${homeView(ctx)}`); return; }
      ctx.from = new URLSearchParams(query).get('from');
      const main = shell(ctx, key);
      render(main, html`<p class="loading">Loading…</p>`);
      await VIEWS[key](ctx, main, parts.slice(3));
      return;
    }
    location.replace('#/');
  } catch (e) {
    const main = $('#tab-body') || $('#main') || topShell(null);
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
