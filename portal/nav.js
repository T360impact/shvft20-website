// Navigation: which pages exist, who may open each, how the workspace
// sidebar groups them, which pages sit together as tabs, and where each
// person lands. Plain data and functions (no page code), so it can be
// tested on its own (tests/nav.test.mjs).

export const PD_ROLES = ['lead', 'accountable_body', 'partner_manager', 'hub_worker'];

// Every page, with the roles that may open it (main or extra role). These
// are the same as before the sidebar was grouped; pages that became tabs
// keep their own routes.
export const PAGES = {
  master: { label: 'Master view', icon: 'governance', mod: 'brand', roles: ['lead'] },
  programme: { label: 'The programme', icon: 'finance', mod: 'finance', roles: ['accountable_body'] },
  mine: { label: 'My organisation', icon: 'home', mod: 'brand', roles: ['accountable_body', 'partner_manager', 'hub_worker', 'org_admin', 'finance', 'reporting'] },
  bid: { label: 'Bid readiness', icon: 'bids', mod: 'bids', roles: ['lead', 'accountable_body', 'partner_manager'] },
  dashboard: { label: 'Dashboard', icon: 'dashboard', mod: 'brand', roles: ['lead', 'accountable_body', 'partner_manager', 'hub_worker', 'funder_observer', 'youth_voice'] },
  shared: { label: 'Shared with us', icon: 'home', mod: 'brand', roles: ['associate'] },
  setup: { label: 'Set-up checklist', icon: 'requirements', mod: 'brand', roles: ['lead'] },
  hub: { label: 'Summary', icon: 'partners', mod: 'governance', roles: 'all' },
  agreements: { label: 'Agreements', icon: 'governance', mod: 'governance', roles: ['lead', 'accountable_body', 'partner_manager', 'funder_observer'] },
  // Electronic signing: everyone, since anyone can be asked to sign or acknowledge a policy. Each sees only what row level security lets them.
  signing: { label: 'Signing', icon: 'submitted', mod: 'governance', roles: 'all' },
  targets: { label: 'Targets and budget', icon: 'finance', mod: 'finance', roles: ['lead', 'accountable_body', 'partner_manager', 'org_admin', 'finance'] },
  progress: { label: 'Progress', icon: 'outcomes', mod: 'delivery', roles: ['lead', 'accountable_body', 'partner_manager', 'org_admin', 'reporting'] },
  programmes: { label: 'Programmes', icon: 'sessions', mod: 'delivery', roles: ['lead'] },
  uploads: { label: 'Weekly figures', icon: 'spreadsheet', mod: 'delivery', roles: ['lead', 'accountable_body', 'partner_manager', 'org_admin', 'reporting'] },
  reporting: { label: 'Reporting', icon: 'requirements', mod: 'delivery', roles: ['lead', 'accountable_body', 'partner_manager', 'org_admin', 'reporting'] },
  profile: { label: 'Our profile', icon: 'partners', mod: 'governance', roles: ['lead', 'accountable_body', 'partner_manager', 'org_admin', 'finance', 'reporting', 'hub_worker', 'associate'] },
  organisations: { label: 'Organisations', icon: 'partners', mod: 'governance', roles: ['lead'] },
  compliance: { label: 'Compliance', icon: 'compliance', mod: 'compliance', roles: ['lead', 'accountable_body'] },
  // The DBS register: everyone for the lead team, own people for an organisation's admin or safeguarding contact.
  dbs: { label: 'DBS checks', icon: 'safeguarding', mod: 'compliance', roles: ['lead', 'accountable_body', 'partner_manager', 'org_admin', 'safeguarding'] },
  returns: { label: 'Returns', icon: 'returns', mod: 'compliance', roles: ['lead', 'accountable_body', 'partner_manager', 'funder_observer'] },
  risks: { label: 'Risks', icon: 'safeguarding', mod: 'compliance', roles: ['lead', 'accountable_body', 'partner_manager', 'hub_worker'] },
  team: { label: 'People', icon: 'people', mod: 'governance', roles: ['lead'] },
  // The lead team's private area: its own sidebar group.
  lw: { label: 'Lead Workspace', icon: 'governance', mod: 'brand', roles: 'lw' },
};

// A bid workspace has only the bid pages; a live consortium keeps its bid
// as a record for the lead and accountable body.
const BID_PAGES = ['bid', 'targets', 'hub', 'agreements', 'signing', 'team', 'organisations', 'setup'];

export function allowed(key, ctx) {
  const v = PAGES[key];
  if (!v || !ctx) return false;
  if (key === 'lw') return !!(ctx.lw?.roles?.length || ctx.staffSelf);
  // My organisation needs an organisation to show.
  if ((key === 'mine' || key === 'profile') && !ctx.orgId && !ctx.isAdmin) return false;
  const stage = ctx.consortium.stage;
  if (stage !== 'live' && !BID_PAGES.includes(key)) return false;
  if (stage === 'live' && key === 'bid' && !(ctx.seesAll && ctx.consortium.bid_deadline)) return false;
  // Associates see only what's meant for them; extra roles (org admin) don't widen it.
  if (ctx.role === 'associate') return v.roles === 'all' || v.roles.includes('associate');
  return v.roles === 'all' || v.roles.includes(ctx.role) || (ctx.extraRoles || []).some((r) => v.roles.includes(r)) || (ctx.isAdmin && v.roles !== PD_ROLES);
}

// Pages shown together as tabs, under one sidebar item.
export const FAMILIES = {
  dashboard: [['master', 'Overview'], ['dashboard', 'Consortium dashboard'], ['progress', 'Progress']],
  hub: [['hub', 'Summary'], ['programme', 'The programme']],
  mine: [['mine', 'My organisation'], ['profile', 'Our profile']],
  organisations: [['organisations', 'Organisations'], ['team', 'People']],
  uploads: [['uploads', 'Weekly figures'], ['progress', 'Progress']],
};
// Which sidebar item a page belongs to (for pages that are tabs).
export const PARENT = { master: 'dashboard', progress: 'dashboard', programme: 'hub', profile: 'mine', team: 'organisations' };

export function tabsFor(key, ctx) {
  const fam = Object.entries(FAMILIES).find(([, tabs]) => tabs.some(([k]) => k === key))?.[0];
  // Progress opened from Weekly figures shows the Weekly figures tabs.
  const family = key === 'progress' && ctx.from === 'uploads' ? 'uploads' : fam;
  if (!family) return [];
  const tabs = FAMILIES[family].filter(([k]) => allowed(k, ctx));
  // The Shvft lead's Dashboard opens on the Master view; everyone else's on the consortium dashboard.
  const labelled = tabs.map(([k, label]) => ({ key: k, label: k === 'dashboard' && !allowed('master', ctx) ? 'Dashboard' : label,
    href: `#/c/${ctx.consortium.id}/${k}${k === 'progress' && family === 'uploads' ? '?from=uploads' : ''}` }));
  return labelled.length > 1 ? labelled : [];
}

// The workspace sidebar: groups of pages this person may open.
export function sidebar(ctx) {
  const c = ctx.consortium;
  const item = (key, label) => ({ key, label: label || PAGES[key].label, icon: PAGES[key].icon, mod: PAGES[key].mod,
    href: `#/c/${c.id}/${key === 'dashboard' && allowed('master', ctx) ? 'master' : key}` });
  const groups = c.stage === 'live' ? [
    { key: 'overview', label: 'Overview', items: [['dashboard'], ['shared'], ['hub'], ['mine'], ['setup']] },
    { key: 'delivery', label: 'Delivery', items: [['programmes'], ['uploads'], ['reporting'], ['returns'], ['targets']] },
    { key: 'partners', label: 'Partners', items: [['agreements'], ['signing'], ['organisations', 'Organisations and people'], ['compliance'], ['dbs']] },
    { key: 'risks', label: 'Risks', items: [['risks']] },
    { key: 'record', label: 'Bid record', items: [['bid']] },
  ] : [
    { key: 'bid', label: 'Bid', items: [['bid', 'Overview'], ['hub', 'Summary'], ['targets', 'Requirements'], ['agreements', 'Documents'], ['signing'], ['organisations', 'Partners'], ['setup']] },
  ];
  const out = groups.map((g) => ({ ...g, items: g.items.filter(([k]) => allowed(k, ctx) || (k === 'dashboard' && allowed('master', ctx))).map(([k, l]) => item(k, l)) })).filter((g) => g.items.length);
  // Converting a won bid is the lead's, from the bid itself.
  if (c.stage !== 'live' && ctx.manages && c.stage !== 'lost') out[0].items.push({ key: 'convert', label: 'Convert to consortium', icon: 'approved', mod: 'brand', href: `#/new/consortium/${c.id}` });
  if (allowed('lw', ctx)) {
    const links = ctx.lw?.roles?.length ? [['week', 'This week', 'home'], ['operations', 'Operations', 'sessions'], ['consortium', 'Consortium', 'governance'], ['todo', 'To do', 'check']]
      : [['mine', 'My shifts', 'sessions']];
    out.push({ key: 'lw', label: 'Lead workspace', items: links.map(([k, label, ic]) => ({ key: `lw/${k}`, label, icon: ic, mod: 'brand', href: `#/c/${c.id}/lw/${k}` })) });
  }
  return out;
}

// Pages a sidebar link leads to, and the tabs and links on those pages.
// Used by the tests: every page someone could open before is still a
// click or two away.
export const LINKS = { compliance: ['profile', 'dbs'], organisations: ['profile'], shared: ['profile', 'hub'] };
export function reachable(ctx) {
  const seen = new Set();
  const visit = (k) => {
    if (seen.has(k) || !allowed(k, ctx)) return;
    seen.add(k);
    for (const t of tabsFor(k, ctx)) visit(t.key);
    for (const t of tabsFor(k, { ...ctx, from: 'uploads' })) visit(t.key);
    for (const l of LINKS[k] || []) visit(l);
  };
  for (const g of sidebar(ctx)) for (const i of g.items) if (PAGES[i.href.split('/')[3]]) visit(i.href.split('/')[3]);
  return seen;
}

// Shvft staff and consortium leads: the platform Home, with "Start a bid"
// and "Set up a consortium".
export const isConvenor = (profile, memberships) => !!profile?.is_platform_admin || (memberships || []).some((m) => m.role === 'lead');

// Where someone lands: anyone else with exactly one workspace goes straight in.
export function landing(profile, memberships) {
  if (isConvenor(profile, memberships)) return null;
  const ids = [...new Set((memberships || []).map((m) => m.consortium_id))];
  return ids.length === 1 ? `#/c/${ids[0]}` : null;
}
