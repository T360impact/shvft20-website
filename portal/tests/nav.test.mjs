// Navigation tests. Run: node --test website/portal/tests/nav.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowed, sidebar, reachable, tabsFor, landing, isConvenor, PAGES } from '../nav.js';

// The sidebar as it was before it was grouped (every page the person may
// open, People only for the lead), frozen here to compare against.
const OLD = {
  master: ['lead'], programme: ['accountable_body'], mine: ['accountable_body', 'partner_manager', 'hub_worker', 'org_admin', 'finance', 'reporting'],
  bid: ['lead', 'accountable_body', 'partner_manager'], dashboard: ['lead', 'accountable_body', 'partner_manager', 'hub_worker', 'funder_observer', 'youth_voice'],
  shared: ['associate'], hub: 'all', agreements: ['lead', 'accountable_body', 'partner_manager', 'funder_observer'],
  targets: ['lead', 'accountable_body', 'partner_manager', 'org_admin', 'finance'], progress: ['lead', 'accountable_body', 'partner_manager', 'org_admin', 'reporting'],
  uploads: ['lead', 'accountable_body', 'partner_manager', 'org_admin', 'reporting'], reporting: ['lead', 'accountable_body', 'partner_manager', 'org_admin', 'reporting'],
  profile: ['lead', 'accountable_body', 'partner_manager', 'org_admin', 'finance', 'reporting', 'hub_worker', 'associate'], organisations: ['lead'],
  compliance: ['lead', 'accountable_body'], returns: ['lead', 'accountable_body', 'partner_manager', 'funder_observer'], risks: ['lead', 'accountable_body', 'partner_manager', 'hub_worker'], team: ['lead'],
};
const OLD_BID = ['bid', 'targets', 'hub', 'agreements', 'team'];
function oldVisible(ctx) {
  return Object.keys(OLD).filter((key) => {
    const roles = OLD[key];
    if ((key === 'mine' || key === 'profile') && !ctx.orgId && !ctx.isAdmin) return false;
    if (ctx.consortium.stage !== 'live' && !OLD_BID.includes(key)) return false;
    if (ctx.consortium.stage === 'live' && key === 'bid' && !(ctx.seesAll && ctx.consortium.bid_deadline)) return false;
    if (key === 'team' && !ctx.manages) return false;
    if (ctx.role === 'associate') return roles === 'all' || roles.includes('associate');
    return roles === 'all' || roles.includes(ctx.role) || ctx.extraRoles.some((r) => roles.includes(r)) || ctx.isAdmin;
  });
}

const ctxFor = (role, extraRoles = [], stage = 'live', o = {}) => ({
  consortium: { id: 'c1', stage, bid_deadline: o.bidDeadline ?? '2026-01-01' }, role, extraRoles, orgId: o.orgId === undefined ? 'org1' : o.orgId,
  isAdmin: !!o.isAdmin, seesAll: !!o.isAdmin || ['lead', 'accountable_body'].includes(role), manages: !!o.isAdmin || role === 'lead', lw: { roles: role === 'lead' ? ['lead'] : [] } });
const PEOPLE = [
  ['lead'], ['accountable_body'], ['accountable_body', ['finance', 'reporting']], ['partner_manager'], ['partner_manager', ['org_admin']], ['partner_manager', ['finance']],
  ['partner_manager', ['reporting', 'safeguarding']], ['hub_worker'], ['hub_worker', ['reporting']], ['funder_observer'], ['youth_voice'], ['associate'], ['associate', ['org_admin']],
  ['platform_admin', [], { isAdmin: true, orgId: null }], ['lead', [], { isAdmin: true }],
];

test('every page someone could reach before is still reachable after the regrouping', () => {
  for (const stage of ['live', 'bid', 'submitted']) {
    for (const [role, extra = [], o = {}] of PEOPLE) {
      const ctx = ctxFor(role, extra, stage, o);
      const now = reachable(ctx);
      for (const key of oldVisible(ctx)) assert.ok(now.has(key), `${role}+${extra.join('+')} in a ${stage} workspace can no longer reach "${key}"`);
    }
  }
});

test('nobody gains a page they could not open before (apart from the new ones)', () => {
  const NEW = ['setup', 'programmes'];
  for (const stage of ['live', 'bid']) {
    for (const [role, extra = [], o = {}] of PEOPLE) {
      const ctx = ctxFor(role, extra, stage, o);
      const before = new Set(oldVisible(ctx));
      // Signing (5 November 2026) is open to everyone: anyone can be asked to sign.
      for (const key of reachable(ctx)) if (key !== 'lw' && key !== 'dbs' && key !== 'signing' && !NEW.includes(key) && !(key === 'organisations' && stage === 'bid')) assert.ok(before.has(key), `${role} in ${stage} newly reaches "${key}"`);
      for (const key of NEW) if (reachable(ctx).has(key)) assert.ok(role === 'lead' || o.isAdmin, `${role} must not reach ${key}`);
    }
  }
});

test('the sidebar is grouped, and merged pages are tabs', () => {
  const lead = ctxFor('lead');
  assert.deepEqual(sidebar(lead).map((g) => g.label), ['Overview', 'Delivery', 'Partners', 'Risks', 'Bid record', 'Lead workspace']);
  assert.equal(sidebar(lead)[0].items[0].href, '#/c/c1/master', 'the lead\'s Dashboard is the master view');
  assert.deepEqual(tabsFor('master', lead).map((t) => t.key), ['master', 'dashboard', 'progress']);
  const partner = ctxFor('partner_manager', ['org_admin']);
  assert.deepEqual(sidebar(partner)[0].items.map((i) => i.label), ['Dashboard', 'Summary', 'My organisation']);
  assert.deepEqual(tabsFor('mine', partner).map((t) => t.key), ['mine', 'profile']);
  assert.ok(!sidebar(partner).flatMap((g) => g.items).some((i) => ['progress', 'profile', 'master', 'team', 'programme'].includes(i.key)), 'merged pages are not separate sidebar items');
  const ab = ctxFor('accountable_body');
  assert.deepEqual(tabsFor('hub', ab).map((t) => t.key), ['hub', 'programme'], 'the programme sits in Summary');
  const bid = ctxFor('lead', [], 'bid');
  assert.deepEqual(sidebar(bid)[0].items.map((i) => i.label), ['Overview', 'Summary', 'Requirements', 'Documents', 'Signing', 'Partners', 'Set-up checklist', 'Convert to consortium']);
});

test('a partner with one workspace lands inside it; leads and staff land on Home', () => {
  const one = [{ consortium_id: 'c1', role: 'partner_manager' }];
  assert.equal(landing({}, one), '#/c/c1');
  assert.equal(landing({}, [...one, { consortium_id: 'c2', role: 'partner_manager' }]), null);
  assert.equal(landing({}, [{ consortium_id: 'c1', role: 'lead' }]), null);
  assert.equal(landing({ is_platform_admin: true }, one), null);
});

test('a partner never sees Start a bid or Set up a consortium', () => {
  for (const role of ['accountable_body', 'partner_manager', 'hub_worker', 'funder_observer', 'youth_voice', 'associate']) {
    assert.equal(isConvenor({}, [{ consortium_id: 'c1', role }, { consortium_id: 'c2', role }]), false, role);
  }
  assert.equal(isConvenor({}, [{ consortium_id: 'c1', role: 'lead' }]), true);
  assert.equal(isConvenor({ is_platform_admin: true }, []), true);
});

test('pages that became tabs keep their own routes', () => {
  for (const key of ['master', 'progress', 'programme', 'profile', 'team']) assert.ok(PAGES[key], key);
  assert.ok(allowed('progress', ctxFor('partner_manager')) && allowed('team', ctxFor('lead')));
});

test('the DBS register: the lead team and organisation admins in a live workspace, never funders, youth voice, hub workers or associates', () => {
  const yes = [['lead'], ['accountable_body'], ['partner_manager'], ['hub_worker', ['org_admin']], ['hub_worker', ['safeguarding']], ['platform_admin', [], { isAdmin: true, orgId: null }]];
  const no = [['hub_worker'], ['hub_worker', ['reporting']], ['funder_observer'], ['youth_voice'], ['associate'], ['associate', ['org_admin']]];
  for (const [role, extra = [], o = {}] of yes) assert.ok(reachable(ctxFor(role, extra, 'live', o)).has('dbs'), `${role}+${extra.join('+')} should reach the DBS register`);
  for (const [role, extra = [], o = {}] of no) assert.ok(!allowed('dbs', ctxFor(role, extra, 'live', o)), `${role}+${extra.join('+')} must not open the DBS register`);
  assert.ok(!allowed('dbs', ctxFor('lead', [], 'bid')), 'a bid workspace has no DBS register');
});

// Every test persona's sidebar in a live workspace (the personas of the
// database repository's test suite, tests/lib/personas.mjs). A change here is
// a change to what someone can open: update it on purpose.
const PERSONA_SIDEBARS = {
  lead: [['Overview', ['Dashboard', 'Summary', 'Set-up checklist']], ['Delivery', ['Programmes', 'Weekly figures', 'Reporting', 'Returns', 'Targets and budget']],
    ['Partners', ['Agreements', 'Signing', 'Organisations and people', 'Compliance', 'DBS checks']], ['Risks', ['Risks']], ['Lead workspace', ['This week', 'Operations', 'Consortium', 'To do']]],
  foundation: [['Overview', ['Dashboard', 'Summary', 'My organisation']], ['Delivery', ['Weekly figures', 'Reporting', 'Returns', 'Targets and budget']],
    ['Partners', ['Agreements', 'Signing', 'Compliance', 'DBS checks']], ['Risks', ['Risks']]],
  partner_a_sole: [['Overview', ['Dashboard', 'Summary', 'My organisation']], ['Delivery', ['Weekly figures', 'Reporting', 'Returns', 'Targets and budget']],
    ['Partners', ['Agreements', 'Signing', 'DBS checks']], ['Risks', ['Risks']]],
  partner_b_report: [['Overview', ['Dashboard', 'Summary', 'My organisation']], ['Delivery', ['Weekly figures', 'Reporting', 'Returns', 'Targets and budget']],
    ['Partners', ['Agreements', 'Signing', 'DBS checks']], ['Risks', ['Risks']]],
  partner_b_finance: [['Overview', ['Dashboard', 'Summary', 'My organisation']], ['Delivery', ['Weekly figures', 'Reporting', 'Returns', 'Targets and budget']],
    ['Partners', ['Agreements', 'Signing', 'DBS checks']], ['Risks', ['Risks']]],
  hub_worker: [['Overview', ['Dashboard', 'Summary', 'My organisation']], ['Partners', ['Signing']], ['Risks', ['Risks']]],
  hub_lead_1: [['Overview', ['Dashboard', 'Summary', 'My organisation']], ['Partners', ['Signing']], ['Risks', ['Risks']], ['Lead workspace', ['This week', 'Operations', 'Consortium', 'To do']]],
  hub_staff_2: [['Overview', ['Dashboard', 'Summary', 'My organisation']], ['Partners', ['Signing']], ['Risks', ['Risks']], ['Lead workspace', ['This week', 'Operations', 'Consortium', 'To do']]],
  funder: [['Overview', ['Dashboard', 'Summary']], ['Delivery', ['Returns']], ['Partners', ['Agreements', 'Signing']]],
  youth_voice: [['Overview', ['Dashboard', 'Summary']], ['Partners', ['Signing']]],
  associate: [['Overview', ['Shared with us', 'Summary']], ['Partners', ['Signing']]],
};
const PERSONA_CTX = { lead: ['lead', [], ['lead']], foundation: ['accountable_body', []], partner_a_sole: ['partner_manager', ['org_admin', 'finance', 'reporting']],
  partner_b_report: ['partner_manager', ['reporting']], partner_b_finance: ['partner_manager', ['finance']], hub_worker: ['hub_worker', []],
  hub_lead_1: ['hub_worker', [], ['hub_lead']], hub_staff_2: ['hub_worker', [], ['hub_staff']], funder: ['funder_observer', []], youth_voice: ['youth_voice', []], associate: ['associate', []] };

for (const [key, want] of Object.entries(PERSONA_SIDEBARS)) {
  test(`U-NAV-${key}: the sidebar for ${key} matches the permissions matrix`, () => {
    const [role, extra, lw = []] = PERSONA_CTX[key];
    const ctx = { consortium: { id: 'c1', stage: 'live', bid_deadline: null }, role, extraRoles: extra, orgId: 'org1', isAdmin: false,
      seesAll: ['lead', 'accountable_body'].includes(role), manages: role === 'lead', lw: { roles: lw } };
    assert.deepEqual(sidebar(ctx).map((g) => [g.label, g.items.map((i) => i.label)]), want);
  });
}

test('U-NAV-money: nobody without the lead, accountable body, finance or org admin role is offered a money page', () => {
  for (const key of ['hub_worker', 'hub_lead_1', 'hub_staff_2', 'youth_voice', 'associate', 'funder']) {
    const labels = PERSONA_SIDEBARS[key].flatMap(([, items]) => items);
    assert.ok(!labels.includes('Targets and budget'), key);
  }
});
