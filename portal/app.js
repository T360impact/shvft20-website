// Consortium Portal: sign-in, two-step verification, the page shell and the
// router. Each screen lives in views/ and receives a context describing the
// consortium and the signed-in person's role in it.
import { db, html, render, raw, $, formData, toast, errorText, act, must, icon, PD_ROLES } from './lib.js';
import homePage from './views/home.js';
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
import targets from './views/targets.js';
import progress from './views/progress.js';

const app = $('#app');

// Supabase reads sign-in links from the address bar on start-up, so note
// what kind of link this was before it clears it.
const startHash = location.hash;
const linkType = /[#&]type=(invite|recovery)/.exec(startHash)?.[1] || null;
const linkError = /[#&]error_description=([^&]+)/.exec(startHash)?.[1];

const state = { user: null, profile: null, memberships: [], ctx: null, ready: false };

// Light unless the person has chosen dark in Account; the device setting is ignored.
const applyTheme = (t) => { document.documentElement.dataset.theme = t === 'dark' ? 'dark' : 'light'; };

const TAB_ORDER = ['dashboard', 'sessions', 'progress', 'returns', 'bid', 'targets', 'hub'];

// Each page belongs to a module, which sets its icon and accent colour.
const VIEWS = {
  bid: { label: 'Bid readiness', short: 'Bid', icon: 'bids', mod: 'bids', view: bid, roles: ['lead', 'accountable_body', 'partner_manager'] },
  dashboard: { label: 'Dashboard', short: 'Dashboard', icon: 'dashboard', mod: 'brand', view: dashboard, roles: 'all' },
  hub: { label: 'Summary', short: 'Summary', icon: 'partners', mod: 'governance', view: hub, roles: 'all' },
  agreements: { label: 'Agreements', short: 'Agreements', icon: 'governance', mod: 'governance', view: agreements, roles: ['lead', 'accountable_body', 'partner_manager', 'funder_observer'] },
  targets: { label: 'Targets and budget', short: 'Budget', icon: 'finance', mod: 'finance', view: targets, roles: ['lead', 'accountable_body', 'partner_manager', 'org_admin', 'finance'] },
  progress: { label: 'Progress', short: 'Progress', icon: 'outcomes', mod: 'delivery', view: progress, roles: ['lead', 'accountable_body', 'partner_manager', 'org_admin', 'reporting'] },
  sessions: { label: 'Sessions', short: 'Check in', icon: 'sessions', mod: 'delivery', view: sessions, roles: PD_ROLES },
  register: { label: 'Young people', short: 'People', icon: 'youngPeople', mod: 'delivery', view: register, roles: PD_ROLES },
  returns: { label: 'Returns', short: 'Returns', icon: 'returns', mod: 'compliance', view: returns, roles: ['lead', 'accountable_body', 'partner_manager', 'funder_observer'] },
  team: { label: 'People', short: 'Team', icon: 'people', mod: 'governance', view: team, roles: ['lead'] },
};

// Administrators see every page except the delivery ones, which need an
// organisation to record against.
// A bid workspace only has the bid pages; a live consortium keeps its bid
// as a record for the lead and accountable body.
const BID_VIEWS = ['bid', 'targets', 'hub', 'agreements', 'team'];
const allowed = (key, ctx) => {
  const v = VIEWS[key];
  if (!v) return false;
  const stage = ctx.consortium.stage;
  if (stage !== 'live' && !BID_VIEWS.includes(key)) return false;
  if (stage === 'live' && key === 'bid' && !(ctx.seesAll && ctx.consortium.bid_deadline)) return false;
  return v.roles === 'all' || v.roles.includes(ctx.role) || ctx.extraRoles.some((r) => v.roles.includes(r)) || (ctx.isAdmin && v.roles !== PD_ROLES);
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
  applyTheme('light');
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
  applyTheme(state.profile.theme);
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
  // Roles held on top of the main one (finance, org admin, ...).
  const extraRoles = m ? must(await db.from('membership_roles').select('role').eq('membership_id', m.id)).map((r) => r.role) : [];
  state.ctx = {
    consortium, orgs, sites, isAdmin,
    user: state.user, profile: state.profile,
    role: m?.role || (isAdmin ? 'platform_admin' : null),
    extraRoles,
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

// The page frame: a sidebar on a desktop, a top bar and bottom tab bar on a
// phone. Pages outside a consortium (home, account, library) keep showing the
// last consortium's pages so moving between them stays one tap.
function shell(ctx, active) {
  const navCtx = ctx || state.ctx;
  const pages = navCtx ? Object.entries(VIEWS).filter(([k]) => allowed(k, navCtx) && (k !== 'team' || navCtx.manages)) : [];
  const link = ([k, v], short) => html`<a href="#/c/${navCtx.consortium.id}/${k}" class="m-${v.mod}" ${raw(active === k ? 'aria-current="page"' : '')}>
    ${raw(icon(v.icon, 20))}<span>${short ? v.short : v.label}</span></a>`;
  const homeLink = () => html`<a href="#/" class="m-brand" ${raw(active === 'home' ? 'aria-current="page"' : '')}>${raw(icon('home', 20))}<span>Home</span></a>`;
  const extras = html`${isConvenor() ? html`<a href="#/library">${raw(icon('library', 20))}<span>Library</span></a>` : ''}
    ${state.profile.is_platform_admin ? html`<a href="#/admin">${raw(icon('admin', 20))}<span>Admin</span></a>` : ''}
    <a href="#/account">${raw(icon('people', 20))}<span>Account</span></a>`;
  const where = navCtx ? html`<strong>${navCtx.consortium.name}</strong>${navCtx.orgName}` : '';
  // The phone's tab bar holds the most used pages; the rest go under More.
  const tabs = TAB_ORDER.map((k) => pages.find(([key]) => key === k)).filter(Boolean).slice(0, 3);
  const rest = pages.filter((p) => !tabs.includes(p));
  render(app, html`
    <div class="app">
      <aside class="side">
        <a class="wordmark" href="#/">SHVFT<span class="two">2.0</span><small>Portal</small></a>
        ${where ? html`<p class="where">${where}</p>` : ''}
        <nav aria-label="Portal"><ul><li>${homeLink()}</li>${pages.map((p) => html`<li>${link(p)}</li>`)}</ul></nav>
        <div class="foot">${extras}<button type="button" data-signout>${raw(icon('logout', 20))}<span>Sign out</span></button></div>
      </aside>
      <div class="main-col">
        <header class="topbar"><a class="wordmark" href="#/">SHVFT<span class="two">2.0</span></a><span class="where">${navCtx ? navCtx.consortium.name : ''}</span></header>
        <main id="main"></main>
      </div>
      <nav class="tabbar" aria-label="Portal shortcuts">${homeLink()}${tabs.map((p) => link(p, true))}
        <button type="button" id="more" aria-haspopup="dialog">${raw(icon('more', 20))}<span>More</span></button></nav>
      <dialog class="more-sheet" id="more-sheet" aria-label="More pages"><ul>
        ${rest.map((p) => html`<li>${link(p)}</li>`)}
        <li>${extras}</li>
        <li><button type="button" class="row" data-signout>${raw(icon('logout', 20))}<span>Sign out</span></button></li>
        <li><button type="button" class="row" data-close-sheet>${raw(icon('close', 20))}<span>Close</span></button></li></ul></dialog>
    </div>`);
  document.querySelectorAll('[data-signout]').forEach((b) => b.addEventListener('click', signOut));
  const sheet = $('#more-sheet');
  $('#more').addEventListener('click', () => sheet.showModal());
  sheet.addEventListener('click', (e) => { if (e.target === sheet || e.target.closest('a, [data-close-sheet]')) sheet.close(); });
  return $('#main');
}

async function home() {
  const main = shell(null, 'home');
  await homePage(main, state);
}

function account() {
  const main = shell(null, 'account');
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
