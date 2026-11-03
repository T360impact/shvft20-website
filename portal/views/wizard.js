// The two wizards on the platform Home, for the consortium lead and Shvft
// staff. Each collects what's needed to create the workspace, creates it
// (the creator becomes its consortium lead), then opens its set-up
// checklist for the remaining steps.
//   Start a bid:          funder profile (or none), name, funder, deadline, value.
//   Set up a consortium:  from a won bid (it becomes the consortium, keeping
//                         everything) or from scratch.
import { db, html, raw, render, $, $$, must, act, toast, icon, formData, fmtDate } from '../lib.js';
import { dbsFields, bindDbsFields, dbsValues } from './dbs.js';

const steps = (n, all) => html`<ol class="wiz-steps" aria-label="Steps">${all.map((s, i) => html`<li class="${i < n ? 'done' : i === n ? 'current' : ''}">${s}</li>`)}</ol>`;
const BID_STEPS = ['Details', 'Application form and guidance', 'Invite partners', 'Requirements from the documents'];
const CON_STEPS = ['Start', 'Funder profile and details', 'Settings', 'Partners and roles', 'Documents and extraction', 'Targets and budget', 'Publish the Summary'];

export default async function wizard(el, state, [kind, fromId], created) {
  const profiles = must(await db.from('funder_profiles').select('id, name').order('name'));
  const profileSelect = html`<label class="f">Funder profile<span class="hint">Sets the funder's reporting rules, budget headings and outcome framework. Choose none if it's a new funder.</span>
    <select name="funder_profile"><option value="">None</option>${profiles.map((p) => html`<option value="${p.id}">${p.name}</option>`)}</select></label>`;
  const demo = html`<label class="check small"><input type="checkbox" name="is_demo"> A demo workspace, for practice or training</label>`;
  if (kind === 'bid') {
    render(el, html`<div class="wiz"><p class="small"><a href="#/">← All projects</a></p><h1>Start a bid</h1>${steps(0, BID_STEPS)}
      <form class="form panel" id="wiz-form">
        ${profileSelect}
        <label class="f">Bid name<input name="name" required maxlength="120" placeholder="for example: Tottenham youth clubs 2027"></label>
        <div class="fields"><label class="f">Funder<input name="funder" maxlength="120"></label><label class="f">Value (£)<input type="number" name="value" min="0" step="1"></label></div>
        <label class="f">Deadline<input type="date" name="deadline" required min="${new Date().toISOString().slice(0, 10)}"></label>
        ${demo}
        <div class="btns"><button class="btn">${raw(icon('bids', 16))}Create the bid workspace</button><a class="btn secondary" href="#/">Cancel</a></div>
        <p class="small muted">Next: upload the application form and guidance, invite partners, and read the documents for the funder's requirements.</p></form></div>`);
  } else {
    const home = must(await db.rpc('platform_home'));
    const bids = home.workspaces.filter((w) => w.tab === 'bids' && (w.role === 'lead' || state.profile.is_platform_admin));
    const won = fromId && bids.some((b) => b.id === fromId);
    render(el, html`<div class="wiz"><p class="small"><a href="#/">← All projects</a></p><h1>Set up a consortium</h1>${steps(0, CON_STEPS)}
      <form class="form panel" id="wiz-form">
        <fieldset><legend>Start from</legend><div class="checks">
          <label class="check"><input type="radio" name="from" value="bid" ${won || (bids.length && !fromId) ? 'checked' : ''} ${bids.length ? '' : 'disabled'}> A won bid${bids.length ? '' : ' (you have no bids in progress)'}</label>
          <label class="check"><input type="radio" name="from" value="scratch" ${!bids.length ? 'checked' : ''}> From scratch</label></div></fieldset>
        <div id="from-bid">${bids.length ? html`<label class="f">The bid<span class="hint">It becomes the consortium in place: its partners, documents, checklist and budget stay.</span>
          <select name="bid">${bids.map((b) => html`<option value="${b.id}" ${b.id === fromId ? 'selected' : ''}>${b.name}${b.deadline ? ` (deadline ${fmtDate(b.deadline)})` : ''}</option>`)}</select></label>` : ''}</div>
        <div id="from-scratch">${profileSelect}
          <label class="f">Consortium name<input name="name" maxlength="120"></label>
          <div class="fields"><label class="f">Funder<input name="funder" maxlength="120"></label><label class="f">Programme<input name="programme" maxlength="120"></label></div>
          ${demo}</div>
        <div class="fields"><label class="f">Value (£)<input type="number" name="value" min="0" step="1"></label>
          <label class="f">Starts<input type="date" name="start" required></label><label class="f">Ends<input type="date" name="end" required></label></div>
        ${dbsFields({})}
        <div class="btns"><button class="btn">${raw(icon('governance', 16))}Set up the consortium</button><a class="btn secondary" href="#/">Cancel</a></div>
        <p class="small muted">Next: settings, partners and their roles, documents to read, targets and budget to confirm, then publish the Summary.</p></form></div>`);
    const sync = () => { const fromBid = $('[name=from]:checked', el)?.value === 'bid'; $('#from-bid', el).hidden = !fromBid; $('#from-scratch', el).hidden = fromBid; $('[name=name]', el).required = !fromBid; };
    $$('[name=from]', el).forEach((r) => r.addEventListener('change', sync)); sync();
    bindDbsFields(el);
  }
  $('#wiz-form', el).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => {
    const f = formData(e.target);
    const fromBid = kind !== 'bid' && f.from === 'bid';
    if (kind !== 'bid' && f.start && f.end && f.end <= f.start) throw new Error('The end date must be after the start.');
    const id = must(await db.rpc('create_workspace', { p_stage: kind === 'bid' ? 'bid' : 'live', p_name: fromBid ? null : f.name, p_funder: f.funder || null, p_programme: f.programme || null,
      p_value: f.value ? Number(f.value) : null, p_deadline: f.deadline || null, p_start: f.start || null, p_end: f.end || null,
      p_funder_profile: fromBid ? null : f.funder_profile || null, p_from_bid: fromBid ? f.bid : null, p_is_demo: !!f.is_demo }));
    // The DBS setting, once the workspace exists (it applies to everyone already in it).
    if (kind !== 'bid' && f.dbs_required) must(await db.from('workspace_settings').update(dbsValues(f)).eq('consortium_id', id));
    toast(kind === 'bid' ? 'Bid workspace created. Next steps are on its checklist.' : 'Consortium set up. Next steps are on its checklist.');
    await created(id);
  }); });
}
