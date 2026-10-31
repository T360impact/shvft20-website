// Risks: the consortium's risk register. Header with the source document,
// lead banners (no owner, review due, overdue actions, proposals, a reading
// to review), four stat cards, a heat map and the effect of further action,
// category pills, then the list and the selected risk's detail.
//
// The lead and accountable body edit everything; partners see consortium
// risks, update the ones they own, and propose new risks and score changes.
// Imports from an existing register are read, reviewed and confirmed under
// risks/import/<id>. Generic: scale, bands and categories come from the
// workspace's own settings.
import { db, html, raw, render, $, $$, must, act, toast, icon, pill, statCard, openDrawer, fmtDate, fmtDateTime, uploadFile,
  segControl, bindSegments, sectionGroup, today, live as liveUpdates, liveMark } from '../lib.js';
import { initials } from '../charts.js';

const STATUS = { open: 'Open', monitoring: 'Monitoring', escalated: 'Escalated', closed: 'Closed' };
const ACTION_STATUS = { not_started: 'Not started', in_progress: 'In progress', complete: 'Complete', not_applicable: 'Not applicable' };
const ACTION_TONE = { not_started: 'grey', in_progress: 'blue', complete: 'green', not_applicable: 'grey' };
const FEATURE = { compliance_vault: 'Compliance vault', safeguarding_flags: 'Safeguarding flags', registration: 'Registration',
  session_plans: 'Session plans', forms: 'Forms' };
const TONE = { green: 'green', amber: 'amber', red: 'red' };
const errText = async (error) => { try { return (await error.context.json()).error || error.message; } catch { return error.message; } };

export default async function risks(ctx, el, [sub, id]) {
  if (sub === 'import' && id) return review(ctx, el, id);
  const c = ctx.consortium;
  const [reg, members, profiles] = await Promise.all([
    db.rpc('risk_register', { p_consortium: c.id }).then(must),
    db.from('memberships').select('user_id, organisation_id, role').eq('consortium_id', c.id).eq('active', true).then(must),
    Promise.resolve([]),
  ]);
  const ids = [...new Set(members.map((m) => m.user_id))];
  const people = ids.length ? must(await db.from('profiles').select('id, full_name, email').in('id', ids)) : profiles;
  const personName = (pid) => { const p = people.find((x) => x.id === pid); return p?.full_name || p?.email || ''; };
  const s = reg.settings;
  const admin = reg.editable;
  const m = s.scale_max;
  const bands = [...s.bands].sort((a, b) => a.min_score - b.min_score);
  const bandOf = (score) => (score == null ? null : [...bands].reverse().find((b) => score >= b.min_score) || bands[0]);
  const tone = (name) => TONE[(bands.find((b) => b.name === name) || {}).colour] || 'grey';
  const top = bands[bands.length - 1]?.name;
  const cats = reg.categories;
  const catOf = (r) => cats.find((k) => k.id === r.category_id);
  const all = reg.risks;
  const live = all.filter((r) => r.status !== 'closed');
  const unowned = live.filter((r) => !r.owner_organisation_id && !r.owner_profile_id);
  const actions = live.flatMap((r) => r.actions.map((a) => ({ ...a, risk: r })));
  const overdue = actions.filter((a) => a.due_date && a.due_date < today() && ['not_started', 'in_progress'].includes(a.status));
  const done = actions.filter((a) => a.status === 'complete').length;
  const open = actions.filter((a) => ['not_started', 'in_progress'].includes(a.status)).length;
  const highBefore = live.filter((r) => r.band === top).length;
  const highAfter = live.filter((r) => r.residual_band === top).length;
  const reviewOverdue = admin && reg.review_due && reg.review_due < today();
  const suggestionFor = (aid) => reg.suggestions.find((x) => x.action_id === aid);
  let selected = live[0]?.id || all[0]?.id;
  let cat = '';
  let view = 'before';

  const scorePill = (score, band) => (score == null ? html`<span class="muted small">–</span>` : html`<span class="rpill tone-${tone(band)}">${score}</span>`);
  const ownerOf = (r) => (r.owner_organisation_id ? ctx.org(r.owner_organisation_id)?.name : '') || r.owner_name || '';

  // ---------------------------------------------------------------- parts
  const header = () => html`<div class="page-head"><div><span class="eyebrow">Project risks</span><h1>Risk register</h1>
      <p class="meta-line">${s.source_title ? [s.source_title, s.source_signed ? `signed ${s.source_signed}` : '', s.register_version ? `version ${s.register_version}` : ''].filter(Boolean).join(' · ') : 'No register uploaded yet'}</p>
      <p style="margin-top:8px">${liveMark()}</p>
      <p class="meta-line">${`Likelihood × severity, 1 to ${m} each`} · ${bands.map((b, i) => `${b.name} ${b.min_score}${bands[i + 1] ? `–${bands[i + 1].min_score - 1}` : '+'}`).join(', ')} · reviewed every ${s.review_frequency_months} months${reg.review_due ? ` · next review ${fmtDate(reg.review_due)}` : ''}</p></div>
    <div class="btns">${admin ? html`<button class="btn secondary" id="upload">${raw(icon('upload', 16))}Upload new version</button>
      <button class="btn" id="add">${raw(icon('add', 16))}Add risk</button>` : html`<button class="btn secondary" id="add">${raw(icon('add', 16))}Propose a risk</button>`}</div></div>`;

  const banners = () => {
    const out = [];
    if (admin && reg.import?.status === 'needs_review') out.push(html`<div class="lead-banner"><span><strong>A register reading is ready to review.</strong> Nothing goes live until you confirm it.</span><a class="btn secondary" href="#/c/${c.id}/risks/import/${reg.import.id}">Review</a></div>`);
    if (admin && reg.import?.status === 'running') out.push(html`<div class="lead-banner"><span><strong>Reading the register.</strong> This usually takes one to three minutes.</span><button class="btn secondary" id="refresh">Refresh</button></div>`);
    if (admin && reg.import?.status === 'failed') out.push(html`<div class="lead-banner"><span><strong>The register couldn't be read.</strong> ${reg.import.error || ''}</span></div>`);
    if (admin && unowned.length) out.push(html`<div class="lead-banner"><span><strong>${unowned.length} risk${unowned.length === 1 ? ' has' : 's have'} no named owner.</strong> Only you can see this.</span><button class="btn secondary" id="assign">Assign owners</button></div>`);
    if (admin && reviewOverdue) out.push(html`<div class="lead-banner"><span><strong>The register review was due ${fmtDate(reg.review_due)}.</strong></span><button class="btn secondary" id="review-now">Record review</button></div>`);
    if (overdue.length) out.push(html`<div class="lead-banner"><span><strong>${overdue.length} action${overdue.length === 1 ? ' is' : 's are'} overdue.</strong> ${overdue.slice(0, 3).map((a) => a.risk.ref).join(', ')}${overdue.length > 3 ? '…' : ''}</span></div>`);
    if (admin && reg.proposals.length) out.push(html`<div class="lead-banner"><span><strong>${reg.proposals.length} proposal${reg.proposals.length === 1 ? '' : 's'} from partners.</strong></span><button class="btn secondary" id="proposals">Review proposals</button></div>`);
    if (admin && reg.suggestions.length) out.push(html`<div class="lead-banner"><span><strong>${reg.suggestions.length} action${reg.suggestions.length === 1 ? ' looks' : 's look'} complete</strong> from what the portal already holds. Check and mark them in the risk's detail.</span></div>`);
    return out.length ? html`<div class="banners">${out}</div>` : '';
  };

  const stats = () => html`<div class="stats stats-4">
    ${statCard({ icon: 'safeguarding', value: live.length, label: 'Risks logged', trend: { dir: 'flat', tone: 'grey', text: `across ${cats.length} categor${cats.length === 1 ? 'y' : 'ies'}` } })}
    ${statCard({ icon: 'overdue', value: highBefore, label: `${top} before action`, trend: { dir: 'flat', tone: highBefore ? 'red' : 'green', text: `score ${bands[bands.length - 1]?.min_score} or more` } })}
    ${statCard({ icon: 'approved', value: highAfter, label: `${top} after action`, trend: highAfter ? { dir: 'down', tone: 'red', text: 'still need attention' } : { dir: 'up', tone: 'green', chip: 'None', text: 'once further action is done' } })}
    ${statCard({ icon: 'returns', value: open, label: 'Actions to complete', trend: { dir: done ? 'up' : 'flat', tone: done ? 'green' : 'grey', text: `${done} of ${actions.length} confirmed complete` } })}</div>`;

  // Heat map: likelihood rows (high at top) by severity columns.
  const heat = () => {
    const after = view === 'after';
    const placed = live.filter((r) => (after ? r.residual_likelihood && r.residual_severity : true));
    const unplaced = after ? live.filter((r) => !(r.residual_likelihood && r.residual_severity)).length : 0;
    const sel = all.find((r) => r.id === selected);
    const at = (l, sv) => placed.filter((r) => (after ? r.residual_likelihood === l && r.residual_severity === sv : r.likelihood === l && r.severity === sv));
    const rows = [];
    for (let l = m; l >= 1; l -= 1) {
      rows.push(html`<div class="hm-label" title="${s.likelihood_labels[l - 1] || ''}">${l}</div>`);
      for (let sv = 1; sv <= m; sv += 1) {
        const here = at(l, sv);
        const isSel = sel && (after ? sel.residual_likelihood === l && sel.residual_severity === sv : sel.likelihood === l && sel.severity === sv);
        rows.push(html`<div class="hm-cell tone-${tone(bandOf(l * sv)?.name)} ${isSel ? 'sel' : ''}" title="Likelihood ${l} × severity ${sv} = ${l * sv}">
          <span class="hm-score">${l * sv}</span>${here.map((r) => html`<button type="button" class="hm-ref" data-pick="${r.id}">${r.ref}</button>`)}</div>`);
      }
    }
    return html`<div class="hm-tools">${segControl('hm', [['before', 'Before'], ['after', 'After']], view)}</div>
      <div class="heatmap" style="--n:${m}" role="group" aria-label="Heat map ${after ? 'after' : 'before'} further action">
        <div class="hm-axis-y">Likelihood</div>${rows}<div></div><div></div>${Array.from({ length: m }, (_, i) => html`<div class="hm-label" title="${s.severity_labels[i] || ''}">${i + 1}</div>`)}
        <div class="hm-axis-x">Severity</div></div>
      ${after && unplaced ? html`<p class="muted small" style="margin-top:12px">${unplaced} of ${live.length} risks have a single residual score rather than a likelihood and severity, so they can't be placed on this grid. Their after-action band shows in the bars beside it.</p>` : ''}`;
  };

  const effect = () => {
    const bar = (key, label) => {
      const counts = bands.map((b) => [b, live.filter((r) => (key === 'band' ? r.band : r.residual_band) === b.name).length]);
      const none = key === 'residual_band' ? live.filter((r) => !r.residual_band).length : 0;
      return html`<div class="fx-row"><span class="fx-label">${label}</span><span class="fx-bar">${counts.filter(([, n]) => n).map(([b, n]) => html`<i class="tone-${tone(b.name)}" style="flex:${n}" title="${n} ${b.name}">${n}</i>`)}${none ? html`<i class="tone-grey" style="flex:${none}" title="${none} without a residual">${none}</i>` : ''}</span></div>`;
    };
    const still = live.filter((r) => r.residual_band && bands.findIndex((b) => b.name === r.residual_band) >= 1).sort((a, b) => b.residual_score - a.residual_score);
    return html`${bar('band', 'Before')}${bar('residual_band', 'After')}
      <div class="fx-key">${bands.map((b) => html`<span><i class="tone-${tone(b.name)}"></i>${b.name}</span>`)}</div>
      <h3 class="small-head" style="margin-top:20px">${still.length ? `Still ${bands[1]?.name.toLowerCase()} or above after action` : `Every risk falls to ${bands[0]?.name.toLowerCase()} after action`}</h3>
      ${still.length ? html`<ul class="fx-list">${still.map((r) => html`<li><button type="button" class="linkbtn" data-pick="${r.id}">${r.ref}</button> <span>${r.title}</span>${scorePill(r.residual_score, r.residual_band)}</li>`)}</ul>` : ''}`;
  };

  const pills = () => html`<div class="cat-pills" role="group" aria-label="Category">
    ${[['', 'All', live.length], ...cats.map((k) => [k.id, `${k.code}. ${k.name}`, live.filter((r) => r.category_id === k.id).length])].map(([v, label, n]) =>
      html`<button type="button" class="cat-pill" data-cat="${v}" aria-pressed="${v === cat}">${label} <span>${n}</span></button>`)}</div>`;

  const list = () => {
    const rows = (cat ? all.filter((r) => r.category_id === cat) : all).filter((r) => r.status !== 'closed' || cat);
    return html`<ul class="risk-list">${rows.map((r) => html`<li><button type="button" class="risk-row ${r.id === selected ? 'sel' : ''}" data-pick="${r.id}">
        <span class="rr-ref">${r.ref}</span>
        <span class="rr-main"><strong>${r.title}</strong><span class="muted small">${r.actions[0]?.description || 'No further action'}</span></span>
        <span class="rr-scores">${scorePill(r.inherent_score, r.band)}<span class="muted" aria-hidden="true">→</span>${scorePill(r.residual_score, r.residual_band)}</span>
        <span class="rr-owner">${ownerOf(r) ? html`<span class="avatar-sm" title="${ownerOf(r)}">${initials(ownerOf(r))}</span>` : html`<span class="muted small">Unassigned</span>`}</span></button></li>`)}</ul>`;
  };

  const tile = (label, score, l, sv, band) => html`<div class="score-tile tone-${tone(band)}"><span class="small">${label}</span><b>${score ?? '–'}</b>
    <span class="small">${l && sv ? `${l} × ${sv}` : score != null ? 'single score' : 'not scored'}${band ? ` · ${band}` : ''}</span></div>`;

  const detail = () => {
    const r = all.find((x) => x.id === selected);
    if (!r) return html`<p class="muted">Select a risk to see its detail.</p>`;
    const k = catOf(r);
    return html`<div class="rd-head"><span class="eyebrow">${r.ref}${k ? ` · ${k.name}` : ''}</span><h2>${r.title}</h2>
        <p class="muted small">${STATUS[r.status]}${r.visibility === 'lead_only' ? ' · lead only' : ''}${r.version > 1 ? ` · version ${r.version}` : ''}</p></div>
      <p>${r.hazard}</p>
      ${r.who_at_risk ? html`<p class="small"><strong>Who is at risk:</strong> ${r.who_at_risk}</p>` : ''}
      <div class="score-tiles">${tile('Before action', r.inherent_score, r.likelihood, r.severity, r.band)}${tile('After action', r.residual_score, r.residual_likelihood, r.residual_severity, r.residual_band)}</div>
      ${r.controls ? html`<h3 class="small-head">Controls in place</h3><p class="small">${r.controls}</p>` : ''}
      <h3 class="small-head">Further action</h3>
      ${r.actions.length ? html`<ul class="rd-actions">${r.actions.map((a) => {
        const sug = suggestionFor(a.id);
        return html`<li data-action="${a.id}"><p>${a.description}</p>
          <div class="rd-act-meta">${pill(ACTION_TONE[a.status], ACTION_STATUS[a.status])}
            <span class="muted small">${a.owner_organisation_id ? ctx.org(a.owner_organisation_id)?.name : 'No owner'}${a.owner_name ? `, ${a.owner_name}` : ''} · ${a.due_date ? `due ${fmtDate(a.due_date)}` : 'no due date'}</span>
            ${a.linked_feature && a.linked_feature !== 'none' ? html`<span class="chip-neutral">${FEATURE[a.linked_feature]}</span>` : ''}</div>
          ${sug ? html`<p class="suggest small">${sug.reason} <button type="button" class="linkbtn small" data-complete="${a.id}">Mark complete</button></p>` : ''}
          ${a.can_update ? html`<div class="rd-act-edit"><label class="f small">Status<select data-act-status="${a.id}">${Object.entries(ACTION_STATUS).map(([v, t]) => html`<option value="${v}" ${a.status === v ? 'selected' : ''}>${t}</option>`)}</select></label>
            ${admin ? html`<label class="f small">Due<input type="date" data-act-due="${a.id}" value="${a.due_date || ''}"></label>
              <label class="f small">Owner<select data-act-owner="${a.id}"><option value="">No owner</option>${ctx.orgs.filter((o) => o.kind !== 'funder').map((o) => html`<option value="${o.id}" ${a.owner_organisation_id === o.id ? 'selected' : ''}>${o.name}</option>`)}</select></label>
              <label class="f small">Linked feature<select data-act-feature="${a.id}"><option value="">None</option>${Object.entries(FEATURE).map(([v, t]) => html`<option value="${v}" ${a.linked_feature === v ? 'selected' : ''}>${t}</option>`)}</select></label>` : ''}</div>` : ''}</li>`;
      })}</ul>` : html`<p class="muted small">No further action set.</p>`}
      <dl class="facts"><dt>Owner</dt><dd>${ownerOf(r) || 'Unassigned'}${r.owner_name && r.owner_organisation_id ? ` · ${r.owner_name}` : ''}</dd>
        <dt>Next review</dt><dd>${r.next_review ? fmtDate(r.next_review) : reg.review_due ? fmtDate(reg.review_due) : 'Not set'}</dd>
        ${r.source_reference ? html`<dt>Source</dt><dd class="small">${r.source_reference}</dd>` : ''}</dl>
      <div class="btns">${admin ? html`<button class="btn secondary" id="assign-one">Assign owner</button>` : ''}
        ${r.can_update ? html`<button class="btn" id="update">Add update</button>` : ''}
        ${admin ? html`<button class="btn secondary" id="edit-risk">Edit</button>` : ''}</div>
      <h3 class="small-head" style="margin-top:24px">History</h3>
      ${r.updates.length ? html`<ul class="rd-history">${r.updates.map((u) => html`<li><span class="muted small">${fmtDateTime(u.created_at)} · ${u.author}</span>
          <span>${u.note || ''}${u.old_score !== u.new_score && u.new_score != null && u.old_score != null ? html` <span class="muted">Score ${u.old_score} → ${u.new_score}${u.new_band ? ` (${u.new_band})` : ''}</span>` : ''}${u.old_status && u.new_status && u.old_status !== u.new_status ? html` <span class="muted">${STATUS[u.old_status]} → ${STATUS[u.new_status]}</span>` : ''}</span></li>`)}</ul>`
      : html`<p class="muted small">No updates yet.</p>`}`;
  };

  // ---------------------------------------------------------------- page
  const draw = () => {
    render(el, html`${header()}${banners()}
      ${all.length ? html`${stats()}
        <div class="dgrid">
          <section class="dcard half"><header class="dcard-head"><h2>Heat map</h2><p>Each risk placed by likelihood and severity. Select one to see it.</p></header>${heat()}</section>
          <section class="dcard half"><header class="dcard-head"><h2>Effect of further action</h2><p>Risks by band, before and after the further action is complete.</p></header>${effect()}</section>
          <section class="dcard full"><header class="dcard-head"><h2>Risks</h2></header>${pills()}
            <div class="risk-split"><div class="risk-list-wrap">${list()}</div><div class="risk-detail" id="detail">${detail()}</div></div></section>
        </div>`
      : html`<section class="dcard" style="margin-top:24px">${admin ? html`<p>No risks yet. Upload your existing risk register and the portal will read it for you to check, or add risks one by one.</p>`
        : html`<p>The lead hasn't published the risk register yet.</p>`}</section>`}`);
    bind();
  };

  const redraw = async () => risks(ctx, el, []);
  function bind() {
    $$('[data-pick]', el).forEach((b) => b.addEventListener('click', () => {
      selected = b.dataset.pick;
      const keep = window.scrollY;
      draw();
      window.scrollTo(0, keep);
      if (window.innerWidth < 900) $('#detail', el)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    $$('[data-seg-for="hm"] [data-seg]', el).forEach((b) => b.addEventListener('click', () => { view = b.dataset.seg; const keep = window.scrollY; draw(); window.scrollTo(0, keep); }));
    $$('[data-cat]', el).forEach((b) => b.addEventListener('click', () => {
      cat = b.dataset.cat;
      const rows = cat ? all.filter((r) => r.category_id === cat) : live;
      if (!rows.some((r) => r.id === selected)) selected = rows[0]?.id;
      const keep = window.scrollY; draw(); window.scrollTo(0, keep);
    }));
    $('#refresh', el)?.addEventListener('click', redraw);
    $('#upload', el)?.addEventListener('click', () => uploadDialog(ctx, redraw));
    $('#add', el)?.addEventListener('click', () => riskForm(ctx, { admin, settings: s, cats, all, people, members, personName }, null, redraw));
    $('#edit-risk', el)?.addEventListener('click', () => riskForm(ctx, { admin, settings: s, cats, all, people, members, personName }, all.find((r) => r.id === selected), redraw));
    $('#assign', el)?.addEventListener('click', () => assignDialog(ctx, unowned, members, personName, redraw));
    $('#assign-one', el)?.addEventListener('click', () => assignDialog(ctx, [all.find((r) => r.id === selected)], members, personName, redraw));
    $('#review-now', el)?.addEventListener('click', () => reviewDialog(ctx, s, redraw));
    $('#proposals', el)?.addEventListener('click', () => proposalsDialog(ctx, reg, all, cats, redraw));
    $('#update', el)?.addEventListener('click', () => updateDialog(ctx, all.find((r) => r.id === selected), admin, m, redraw));
    const saveAction = (aid, patch) => act(null, async () => { must(await db.rpc('update_risk_action', { p_action: aid, ...patch })); toast('Action updated.'); await redraw(); });
    $$('[data-act-status]', el).forEach((sel) => sel.addEventListener('change', () => saveAction(sel.dataset.actStatus, { p_status: sel.value })));
    $$('[data-act-due]', el).forEach((inp) => inp.addEventListener('change', () => saveAction(inp.dataset.actDue, inp.value ? { p_due: inp.value } : { p_clear_due: true })));
    $$('[data-act-owner]', el).forEach((sel) => sel.addEventListener('change', () => sel.value && saveAction(sel.dataset.actOwner, { p_owner_organisation: sel.value })));
    $$('[data-act-feature]', el).forEach((sel) => sel.addEventListener('change', () => act(null, async () => {
      must(await db.from('risk_actions').update({ linked_feature: sel.value || null }).eq('id', sel.dataset.actFeature)); toast('Linked feature saved.'); await redraw();
    })));
    $$('[data-complete]', el).forEach((b) => b.addEventListener('click', () => saveAction(b.dataset.complete, { p_status: 'complete' })));
  }
  draw();
  // Live: updates from partners show without a refresh, unless a form is open.
  liveUpdates(c.id, () => {
    if (document.querySelector('dialog[open]')) return;
    const y = window.scrollY;
    risks(ctx, el, []).then(() => window.scrollTo(0, y));
  });
}

// ---------------------------------------------------------------- dialogs

function uploadDialog(ctx, done) {
  const c = ctx.consortium;
  const d = openDrawer('Upload a risk register', html`<form class="form" id="reg-form">
    <p class="small muted">A PDF, Word or Excel register. The portal reads its scoring, categories and every risk with its source, for you to check before anything goes live. Owners, dates and statuses are never filled in for you.</p>
    <label class="f">Title<input name="title" value="Risk register" required maxlength="120"></label>
    <label class="f">File<input type="file" name="file" accept=".pdf,.docx,.xlsx" required></label>
    <div class="btns"><button class="btn">${raw(icon('upload', 16))}Upload and read</button></div></form>`);
  $('#reg-form', d).addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      const file = e.target.elements.file.files[0];
      if (!/\.(pdf|docx|xlsx)$/i.test(file.name)) throw new Error('Upload a PDF, Word (.docx) or Excel (.xlsx) file.');
      const path = await uploadFile('documents', `${c.id}/shared`, file);
      const doc = must(await db.from('documents').insert({ consortium_id: c.id, kind: 'risk_register', title: e.target.elements.title.value.trim(), storage_path: path,
        file_name: file.name, mime_type: file.type || null, uploaded_by: ctx.user.id }).select('id').single());
      const { error } = await db.functions.invoke('extract-risk-register', { body: { consortium_id: c.id, document_id: doc.id } });
      if (error) throw new Error(await errText(error));
      d.close();
      toast('Reading the register. This usually takes one to three minutes.');
      await done();
    });
  });
}

function riskForm(ctx, { admin, settings: s, cats, all }, risk, done) {
  const m = s.scale_max;
  const opts = (v) => Array.from({ length: m }, (_, i) => html`<option value="${i + 1}" ${v === i + 1 ? 'selected' : ''}>${i + 1}</option>`);
  const d = openDrawer(risk ? `Edit ${risk.ref}` : admin ? 'Add a risk' : 'Propose a risk', html`<form class="form" id="risk-form">
    ${!admin ? html`<p class="small muted">The lead reviews your proposal before it joins the register.</p>` : ''}
    <p class="small muted">Describe the risk without naming any young person. Medical, allergy and safeguarding case details stay in your own records.</p>
    <label class="f">Category<select name="category_id">${cats.map((k) => html`<option value="${k.id}" ${risk?.category_id === k.id ? 'selected' : ''}>${k.code}. ${k.name}</option>`)}<option value="">No category</option></select></label>
    <label class="f">Title<span class="hint">Up to 60 characters.</span><input name="title" maxlength="60" required value="${risk?.title || ''}"></label>
    <label class="f">Hazard and how harm could occur<textarea name="hazard" rows="3" required>${risk?.hazard || ''}</textarea></label>
    <label class="f">Who is at risk<input name="who_at_risk" value="${risk?.who_at_risk || ''}"></label>
    <div class="fields"><label class="f">Likelihood<select name="likelihood">${opts(risk?.likelihood)}</select></label>
      <label class="f">Severity<select name="severity">${opts(risk?.severity)}</select></label></div>
    <label class="f">Controls in place<textarea name="controls" rows="3">${risk?.controls || ''}</textarea></label>
    ${!risk ? html`<label class="f">Further action<span class="hint">One per line.</span><textarea name="actions" rows="2"></textarea></label>` : ''}
    ${admin ? html`<div class="fields"><label class="f">After action: likelihood<select name="rl"><option value="">–</option>${opts(risk?.residual_likelihood)}</select></label>
      <label class="f">After action: severity<select name="rs"><option value="">–</option>${opts(risk?.residual_severity)}</select></label></div>
      <label class="f">Who can see it<select name="visibility"><option value="consortium" ${risk?.visibility !== 'lead_only' ? 'selected' : ''}>Everyone in the consortium</option>
        <option value="lead_only" ${risk?.visibility === 'lead_only' ? 'selected' : ''}>Lead only</option></select></label>` : ''}
    <div class="btns"><button class="btn">${risk ? 'Save' : admin ? 'Add risk' : 'Send to the lead'}</button></div></form>`);
  $('#risk-form', d).addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      const f = e.target.elements;
      const row = { category_id: f.category_id.value || null, title: f.title.value.trim(), hazard: f.hazard.value.trim(), who_at_risk: f.who_at_risk.value.trim() || null,
        likelihood: Number(f.likelihood.value), severity: Number(f.severity.value), controls: f.controls.value.trim() || null };
      const lines = f.actions ? f.actions.value.split('\n').map((x) => x.trim()).filter(Boolean) : [];
      if (!admin) {
        must(await db.rpc('propose_risk', { p_consortium: ctx.consortium.id, p_payload: { ...row, further_actions: lines } }));
        d.close(); toast('Sent to the lead.'); return done();
      }
      Object.assign(row, { residual_likelihood: f.rl.value ? Number(f.rl.value) : null, residual_severity: f.rs.value ? Number(f.rs.value) : null, visibility: f.visibility.value });
      if ((row.residual_likelihood == null) !== (row.residual_severity == null)) throw new Error('Give both an after-action likelihood and severity, or neither.');
      if (risk) {
        if (row.residual_likelihood == null) { delete row.residual_likelihood; delete row.residual_severity; }
        must(await db.from('risks').update(row).eq('id', risk.id));
      } else {
        const code = cats.find((k) => k.id === row.category_id)?.code || 'R';
        const n = Math.max(0, ...all.filter((r) => new RegExp(`^${code}\\d+$`).test(r.ref)).map((r) => Number(r.ref.slice(code.length)))) + 1;
        const made = must(await db.from('risks').insert({ ...row, consortium_id: ctx.consortium.id, ref: `${code}${n}` }).select('id').single());
        if (lines.length) must(await db.from('risk_actions').insert(lines.map((description, i) => ({ risk_id: made.id, consortium_id: ctx.consortium.id, description, position: i + 1 }))));
      }
      d.close(); toast(risk ? 'Saved.' : 'Risk added.'); return done();
    });
  });
}

function assignDialog(ctx, list, members, personName, done) {
  const orgs = ctx.orgs.filter((o) => o.kind !== 'funder' && o.kind !== 'youth_voice');
  const d = openDrawer(list.length > 1 ? 'Assign owners' : `Owner for ${list[0].ref}`, html`<form id="assign-form">
    <div class="table-wrap"><table class="assign-table"><thead><tr><th>Risk</th><th>Organisation</th><th>Person</th></tr></thead>
    <tbody>${list.map((r) => html`<tr data-risk="${r.id}"><td><strong>${r.ref}</strong> ${r.title}</td>
      <td><select name="org" aria-label="Organisation for ${r.ref}"><option value="">Choose…</option>${orgs.map((o) => html`<option value="${o.id}" ${r.owner_organisation_id === o.id ? 'selected' : ''}>${o.name}</option>`)}</select></td>
      <td><select name="person" aria-label="Person for ${r.ref}"><option value="">Anyone in the organisation</option>${members.map((mm) => html`<option value="${mm.user_id}" data-org="${mm.organisation_id}" ${r.owner_profile_id === mm.user_id ? 'selected' : ''}>${personName(mm.user_id) || 'Unnamed'}</option>`)}</select></td></tr>`)}</tbody></table></div>
    <div class="btns" style="margin-top:16px"><button class="btn">Save owners</button></div></form>`);
  // Only people in the chosen organisation.
  $$('tr[data-risk]', d).forEach((tr) => {
    const org = $('[name=org]', tr); const person = $('[name=person]', tr);
    const filter = () => $$('option[data-org]', person).forEach((o) => { o.hidden = !!org.value && o.dataset.org !== org.value; });
    org.addEventListener('change', () => { filter(); if (person.selectedOptions[0]?.hidden) person.value = ''; });
    filter();
  });
  $('#assign-form', d).addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      const rows = $$('tr[data-risk]', d).map((tr) => ({ risk_id: tr.dataset.risk, owner_organisation_id: $('[name=org]', tr).value || null, owner_profile_id: $('[name=person]', tr).value || null }))
        .filter((r) => r.owner_organisation_id || r.owner_profile_id);
      if (!rows.length) throw new Error('Choose an owner for at least one risk.');
      const n = must(await db.rpc('assign_risk_owners', { p_consortium: ctx.consortium.id, p_rows: rows }));
      d.close(); toast(`${n} owner${n === 1 ? '' : 's'} saved.`); return done();
    });
  });
}

function updateDialog(ctx, r, admin, m, done) {
  const opts = (v) => html`<option value="">No change</option>${Array.from({ length: m }, (_, i) => html`<option value="${i + 1}" ${v === i + 1 ? '' : ''}>${i + 1}</option>`)}`;
  const d = openDrawer(`Update ${r.ref}`, html`<form class="form" id="upd-form">
    <label class="f">Note<textarea name="note" rows="3" maxlength="2000" placeholder="What has changed. No names or case details."></textarea></label>
    <label class="f">Status<select name="status">${Object.entries(STATUS).map(([v, t]) => html`<option value="${v}" ${r.status === v ? 'selected' : ''}>${t}</option>`)}</select></label>
    <details class="wording"><summary class="small">Change the score${admin ? '' : ' (the lead approves it)'}</summary>
      <div class="fields"><label class="f">Likelihood (now ${r.likelihood})<select name="l">${opts()}</select></label><label class="f">Severity (now ${r.severity})<select name="s">${opts()}</select></label></div>
      <div class="fields"><label class="f">After action: likelihood<select name="rl">${opts()}</select></label><label class="f">After action: severity<select name="rs">${opts()}</select></label></div></details>
    <div class="btns"><button class="btn">Save update</button></div></form>`);
  $('#upd-form', d).addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      const f = e.target.elements; const num = (x) => (x.value ? Number(x.value) : null);
      if ((num(f.rl) == null) !== (num(f.rs) == null)) throw new Error('Give both an after-action likelihood and severity, or neither.');
      const res = must(await db.rpc('add_risk_update', { p_risk: r.id, p_note: f.note.value.trim() || null, p_status: f.status.value !== r.status ? f.status.value : null,
        p_likelihood: num(f.l), p_severity: num(f.s), p_residual_likelihood: num(f.rl), p_residual_severity: num(f.rs) }));
      d.close();
      toast(res?.proposed ? 'Saved. The score change is with the lead to approve.' : res?.into_top_band ? 'Saved. This risk is now in the highest band.' : 'Update saved.');
      return done();
    });
  });
}

function reviewDialog(ctx, s, done) {
  const d = openDrawer('Record a review', html`<form class="form" id="rev-form">
    <p class="small muted">The next review falls due in ${s.review_frequency_months} months.${s.review_triggers ? ` ${s.review_triggers}` : ''}</p>
    <label class="f">Notes<textarea name="notes" rows="4" maxlength="4000"></textarea></label>
    <div class="btns"><button class="btn">Record review</button></div></form>`);
  $('#rev-form', d).addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      const next = must(await db.rpc('record_risk_review', { p_consortium: ctx.consortium.id, p_notes: e.target.elements.notes.value }));
      d.close(); toast(`Review recorded. Next due ${fmtDate(next)}.`); return done();
    });
  });
}

function proposalsDialog(ctx, reg, all, cats, done) {
  const d = openDrawer('Proposals from partners', html`<ul class="rows">${reg.proposals.map((p) => {
    const r = all.find((x) => x.id === p.risk_id);
    return html`<li data-prop="${p.id}"><p><strong>${p.kind === 'new' ? `New risk: ${p.payload.title}` : `Score change for ${r?.ref || 'a risk'}`}</strong></p>
      <p class="muted small">${[p.organisation, p.by, fmtDateTime(p.created_at)].filter(Boolean).join(' · ')}</p>
      ${p.kind === 'new' ? html`<p class="small">${p.payload.hazard} · likelihood ${p.payload.likelihood} × severity ${p.payload.severity}</p>`
        : html`<p class="small">${Object.entries(p.payload).map(([k, v]) => `${k.replace('_', ' ')} ${r?.[k] ?? '–'} → ${v}`).join(' · ')}</p>`}
      ${p.reason ? html`<p class="small muted">${p.reason}</p>` : ''}
      ${p.kind === 'new' ? html`<label class="f small">Category<select data-cat-for="${p.id}">${cats.map((k) => html`<option value="${k.id}">${k.code}. ${k.name}</option>`)}</select></label>` : ''}
      <div class="btns"><button class="btn small" data-approve="${p.id}">Approve</button><button class="btn secondary small" data-reject="${p.id}">Reject</button></div></li>`;
  })}</ul>`);
  const decide = (b, ok) => act(b, async () => {
    const pid = b.dataset.approve || b.dataset.reject;
    const catSel = $(`[data-cat-for="${pid}"]`, d);
    // For a new risk the lead chooses its category; the proposal keeps everything else.
    must(await db.rpc('decide_risk_proposal', { p_proposal: pid, p_approve: ok, p_category: ok && catSel ? catSel.value : null }));
    d.close(); toast(ok ? 'Approved.' : 'Rejected.'); return done();
  });
  $$('[data-approve]', d).forEach((b) => b.addEventListener('click', () => decide(b, true)));
  $$('[data-reject]', d).forEach((b) => b.addEventListener('click', () => decide(b, false)));
}

// ------------------------------------------------------------ the review

async function review(ctx, el, importId) {
  const c = ctx.consortium;
  const imp = must(await db.from('risk_imports').select('*').eq('id', importId).maybeSingle());
  if (!imp) { render(el, html`<div class="panel">That import isn't available.</div>`); return; }
  if (imp.status === 'running') {
    render(el, html`<p class="small"><a href="#/c/${c.id}/risks">← Risks</a></p><section class="dcard" style="margin-top:16px"><p>Reading the register. This usually takes one to three minutes.</p>
      <div class="btns" style="margin-top:12px"><button class="btn secondary" id="again">Check again</button></div></section>`);
    $('#again').addEventListener('click', () => review(ctx, el, importId));
    return;
  }
  const pv = must(await db.rpc('risk_import_preview', { p_import: importId }));
  const doc = pv.document || {};
  const flagged = pv.risks.filter((r) => r.flags.length);
  const fmtLvl = (v) => (v == null ? '–' : String(v));
  const DIFF = { added: ['green', 'New'], changed: ['amber', 'Changed'], unchanged: ['grey', 'Unchanged'] };
  const open = imp.status === 'needs_review';
  const byCat = pv.categories.map((k) => [k, pv.risks.filter((r) => r.category_code === k.code)]).concat([[{ code: '', name: 'No category' }, pv.risks.filter((r) => !pv.categories.some((k) => k.code === r.category_code))]]).filter(([, rs]) => rs.length);

  render(el, html`<p class="small"><a href="#/c/${c.id}/risks">← Risks</a></p>
    <div class="page-head"><div><span class="eyebrow">Register import · ${fmtDateTime(imp.created_at)}</span><h1>Check the register</h1>
      <p class="meta-line">${[doc.title, doc.signed ? `signed ${doc.signed}` : ''].filter(Boolean).join(' · ')}</p>
      <p class="muted">Every risk as the document gives it, with where it came from. Edit the short titles, check the flags, then confirm. Owners, due dates and statuses are left for you to set.</p></div></div>
    <div class="stats stats-4">
      ${statCard({ icon: 'safeguarding', value: pv.risks.length, label: 'Risks read', trend: { dir: 'flat', tone: 'grey', text: `in ${pv.categories.length} categories` } })}
      ${statCard({ icon: 'returns', value: pv.risks.reduce((n, r) => n + r.further_actions.length, 0), label: 'Further actions', trend: { dir: 'flat', tone: 'grey', text: 'each becomes an action, not started' } })}
      ${statCard({ icon: flagged.length ? 'overdue' : 'approved', value: flagged.length, label: 'Flags to check', trend: flagged.length ? { dir: 'down', tone: 'amber', text: 'see the marked rows' } : { dir: 'up', tone: 'green', text: 'every score checks out' } })}
      ${statCard({ icon: 'targets', value: pv.has_current ? pv.risks.filter((r) => r.diff !== 'unchanged').length : pv.risks.length, label: pv.has_current ? 'New or changed' : 'New risks', trend: { dir: 'flat', tone: 'grey', text: pv.has_current ? `${pv.removed.length} no longer listed` : 'first version of the register' } })}</div>
    <div class="dgrid">
      <section class="dcard half"><header class="dcard-head"><h2>Scoring</h2></header>
        <p class="small">${doc.scoring_method || 'The document does not say how it scores risk.'}</p>
        ${pv.converted ? html`<p class="note" style="margin-top:12px">The document uses ${pv.scale.type === 'levels' ? `levels (${(pv.scale.levels || []).join(', ')})` : `a 1 to ${pv.scale.likelihood_max} scale`}; each score is converted to this workspace's 1 to ${pv.workspace_scale} scale. Each row shows the document's value and the converted one.</p>` : html`<p class="muted small" style="margin-top:8px">Same scale as this workspace (1 to ${pv.workspace_scale}); no conversion.</p>`}
        ${pv.proposed_bands ? html`<p class="small" style="margin-top:12px"><strong>Bands in the document:</strong> ${pv.proposed_bands.map((b) => `${b.name} from ${b.min_score}`).join(', ')}</p>
          <label class="check small" style="margin-top:8px"><input type="checkbox" id="apply" ${pv.apply_settings ? 'checked' : ''} ${open ? '' : 'disabled'}> Use the document's bands and scoring method for this workspace</label>` : ''}
        <p class="small muted" style="margin-top:8px">Current bands: ${pv.current_bands.map((b) => `${b.name} from ${b.min_score}`).join(', ')}</p></section>
      <section class="dcard half"><header class="dcard-head"><h2>${pv.has_current ? 'Compared with the confirmed register' : 'Categories'}</h2></header>
        ${pv.has_current ? html`<p class="small">${['added', 'changed', 'unchanged'].map((k) => `${pv.risks.filter((r) => r.diff === k).length} ${DIFF[k][1].toLowerCase()}`).join(' · ')}${pv.removed.length ? ` · ${pv.removed.length} no longer listed (they will be closed)` : ''}</p>
          ${pv.removed.length ? html`<ul class="plain small" style="margin-top:8px">${pv.removed.map((r) => html`<li>${r.ref} ${r.title}</li>`)}</ul>` : ''}`
        : html`<ul class="plain small">${pv.categories.map((k) => html`<li>${k.code}. ${k.name} · ${pv.risks.filter((r) => r.category_code === k.code).length} risks</li>`)}</ul>`}</section>
      <section class="dcard full"><header class="dcard-head"><h2>Risks</h2><p>Grouped by the document's sections. Sections with flags start open.</p></header>
        ${byCat.map(([k, rs]) => sectionGroup({ title: `${k.code ? `${k.code}. ` : ''}${k.name}`, open: rs.some((r) => r.flags.length),
          meta: `${rs.length} risk${rs.length === 1 ? '' : 's'}${rs.some((r) => r.flags.length) ? ` · ${rs.filter((r) => r.flags.length).length} flagged` : ''}${pv.has_current ? ` · ${rs.filter((r) => r.diff !== 'unchanged').length} new or changed` : ''}`,
          body: html`<ul class="imp-list">${rs.map((r) => html`<li class="${r.flags.length ? 'flagged' : ''}">
            <div class="imp-top"><span class="rr-ref">${r.ref}</span>
              <label class="f imp-title"><span class="sr-only">Title for ${r.ref}</span><input data-title="${r.index}" maxlength="60" value="${r.title || ''}" ${open ? '' : 'disabled'}></label>
              ${pv.has_current ? pill(DIFF[r.diff][0], DIFF[r.diff][1]) : ''}</div>
            <p class="small">${r.hazard}</p>
            <div class="imp-scores small">
              <span>Before: ${fmtLvl(r.likelihood_doc)} × ${fmtLvl(r.severity_doc)}${r.stated_score != null ? ` = ${fmtLvl(r.stated_score)}` : ''}${pv.converted ? html` → <strong>${r.likelihood} × ${r.severity} = ${r.inherent}</strong>` : ''} <span class="rpill tone-${r.band === pv.current_bands[pv.current_bands.length - 1].name ? 'red' : r.band === pv.current_bands[0].name ? 'green' : 'amber'}">${r.band || '–'}</span>
                ${r.score_ok === true ? html`<span class="ok-mark" title="Stated score equals likelihood × severity">✓</span>` : ''}</span>
              <span>After: ${r.residual_doc.likelihood != null ? `${fmtLvl(r.residual_doc.likelihood)} × ${fmtLvl(r.residual_doc.severity)}` : fmtLvl(r.residual_doc.score)}${pv.converted && r.residual_score != null ? html` → <strong>${r.residual_score}</strong>` : ''}${r.residual_doc.likelihood == null && r.residual_score != null ? ' (single score)' : ''}</span>
              ${r.was ? html`<span class="muted">Was ${r.was.likelihood} × ${r.was.severity}, after ${r.was.residual_score ?? '–'}</span>` : ''}</div>
            ${r.further_actions.length ? html`<p class="small"><strong>Further action:</strong> ${r.further_actions.join(' · ')}</p>` : ''}
            ${r.flags.length ? html`<p class="warn-text small">${r.flags.join(' · ')}</p>` : ''}
            <p class="muted small">Source: ${[doc.title, r.location, r.row ? `row ${r.row}` : ''].filter(Boolean).join(', ')}</p></li>`)}</ul>` }))}</section>
    </div>
    ${open ? html`<div class="btns" style="margin-top:24px"><button class="btn" id="confirm">Confirm ${pv.risks.length} risks</button>
      <button class="btn secondary" id="discard">Discard this reading</button></div>` : html`<p class="note" style="margin-top:24px">This reading is ${imp.status}.</p>`}`);

  // Titles and the settings choice are saved into the import as you go.
  const saveExtracted = async () => {
    const ex = structuredClone(imp.extracted);
    $$('[data-title]', el).forEach((inp) => { ex.risks[Number(inp.dataset.title)].title = inp.value.trim(); });
    must(await db.from('risk_imports').update({ extracted: ex, apply_settings: $('#apply', el)?.checked ?? imp.apply_settings }).eq('id', importId));
    imp.extracted = ex;
  };
  $$('[data-title]', el).forEach((inp) => inp.addEventListener('change', () => act(null, saveExtracted)));
  $('#apply', el)?.addEventListener('change', () => act(null, saveExtracted));
  $('#confirm', el)?.addEventListener('click', (e) => act(e.currentTarget, async () => {
    await saveExtracted();
    const res = must(await db.rpc('confirm_risk_import', { p_import: importId }));
    toast(`Register version ${res.version} confirmed: ${res.added} added, ${res.changed} changed, ${res.closed} closed, ${res.actions} actions.`);
    location.hash = `#/c/${c.id}/risks`;
  }));
  $('#discard', el)?.addEventListener('click', (e) => act(e.currentTarget, async () => {
    must(await db.from('risk_imports').update({ status: 'discarded' }).eq('id', importId));
    toast('Reading discarded.'); location.hash = `#/c/${c.id}/risks`;
  }));
}
