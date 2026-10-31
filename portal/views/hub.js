// Consortium summary: what the partnership is for, who does what, what it
// measures, how it's delivered and run. It never shows financial
// information, for any role; money lives under Targets and budget. The lead
// edits a draft and publishes it; everyone else sees the published version.
// The lead's edit view also keeps the workspace's records: organisations,
// sites, key dates, outcomes and details.
import { db, html, raw, render, $, $$, formData, toast, act, must, icon, pill, emptyState, openFile, headline, fmtDate, fmtNum, KIND_LABEL, ROLE_LABEL, today } from '../lib.js';
import { initials } from '../charts.js';

// How an outcome is evidenced, read from the document's own evidence text.
const METHOD = [
  [/survey|scale|self[- ]?report|questionnaire|pre and post|warwick|ucla/i, 'Survey', 'surveys', 'surveys'],
  [/register|attendance|session log|logs|records|registration/i, 'Session data', 'attendance', 'delivery'],
];
const methodOf = (evidence) => (evidence ? METHOD.find(([re]) => re.test(evidence)) || [null, 'Form', 'requirements', 'compliance'] : [null, 'Unknown']);
const METHOD_TEXT = { Survey: 'Survey', 'Session data': 'Session data', Form: 'Monitoring form', Unknown: 'Method not set' };
const lines = (v) => (v || '').split('\n').map((s) => s.trim()).filter(Boolean);
const firstSentence = (s) => (s || '').split(/(?<=\.)\s/)[0];
const DOC_KIND = { delivery_model: 'Delivery model', monitoring_framework: 'Outcome framework', consortium_agreement: 'Consortium agreement', policy: 'Policy', other: 'Document' };

export default async function hub(ctx, el, [sub]) {
  if (sub === 'edit' && ctx.manages) return edit(ctx, el);
  const c = ctx.consortium;
  const [s, dates] = await Promise.all([
    db.rpc('consortium_summary', { p_consortium: c.id }).then(must),
    db.from('key_dates').select('title, due_on, notes').eq('consortium_id', c.id).gte('due_on', today()).order('due_on').limit(6).then(must),
  ]);
  const w = s.workspace;
  const sum = s.summary || {};
  const docIds = (s.documents || []).map((d) => d.id);
  const docs = docIds.length ? must(await db.from('documents').select('id, storage_path').in('id', docIds)) : [];
  const roleOf = (o) => (sum.organisations || []).find((r) => r.organisation_id === o.id);
  const orgs = [...s.organisations].sort((a, b) => (roleOf(a)?.position ?? 9) - (roleOf(b)?.position ?? 9));
  const share = s.targeted?.share;
  const min = s.targeted?.minimum;
  const isBid = w.stage !== 'live';
  const start = sum.start_date || w.start_date;
  const end = sum.end_date || w.end_date;
  // Outcomes grouped under their themes, in the framework's order.
  const outcomes = [...s.outcomes].sort((a, b) => a.code.localeCompare(b.code));
  const themes = [...new Set(outcomes.map((o) => o.theme || 'Outcomes'))];
  const reported = outcomes.filter((o) => o.reported);
  const outcomeRow = (o) => {
    const short = o.headline || headline(o.label);
    const pct = o.reported && o.target ? (100 * o.actual) / o.target : null;
    return html`<li class="row">
      <div>${short !== o.label ? html`<details class="wording"><summary>${short}</summary><p>${o.label}</p></details>` : html`<span>${o.label}</span>`}
        <span class="muted">${[METHOD_TEXT[methodOf(o.evidence)[1]], o.section].filter(Boolean).join(' · ')}</span>
        ${o.evidence ? html`<details class="wording"><summary class="small muted" style="text-decoration:underline">How it's measured</summary><p>${o.evidence}</p></details>` : ''}</div>
      <div class="row-end">${pct != null ? html`<span class="figure"><span>${fmtNum(o.actual)} of ${fmtNum(o.target)}</span><strong>${fmtNum(Math.round(pct))}%</strong></span>
        <span class="slim" role="img" aria-label="${fmtNum(Math.round(pct))}% of the target"><span style="width:${Math.min(100, pct)}%"></span></span>`
        : html`<span class="not-yet">${o.target != null ? `Target ${fmtNum(o.target)} · not yet reported` : 'Not yet reported'}</span>`}</div></li>`;
  };

  render(el, html`
    <div class="page-head"><div><span class="eyebrow">${isBid ? 'Bid summary' : 'Consortium summary'}</span><h1>${w.name}</h1>
      <p class="meta-line">${[sum.funder_name || w.funder, sum.programme_name || w.programme].filter(Boolean).join(' · ')}</p>
      <p class="meta-line">${[sum.area_served, sum.age_range ? `Ages ${sum.age_range}` : `Ages ${w.min_age} to ${w.max_age}`, start ? `${fmtDate(start)} to ${fmtDate(end)}` : ''].filter(Boolean).join(' · ')}</p>
      ${sum.purpose ? html`<p class="lead-para">${firstSentence(sum.purpose)}</p>` : ''}</div>
      ${s.editable ? html`<div class="btns" style="align-items:center">
        ${s.published ? (s.draft_changed ? pill('amber', `Unpublished changes · version ${s.version} is live`, 'due') : pill('green', `Published · version ${s.version}`, 'approved')) : pill('grey', 'Draft', 'waiting')}
        <a class="btn secondary" href="#/c/${c.id}/hub/edit">Edit</a>
        ${s.summary && (!s.published || s.draft_changed) ? html`<button class="btn" id="publish">${raw(icon('submitted', 16))}Publish</button>` : ''}</div>` : ''}</div>
    ${!s.summary ? html`<p class="note">${s.editable ? 'Start the summary from what the bid already holds, then edit and publish it.' : 'The lead hasn\'t published the summary yet. Partners, sites and outcomes below are live.'}</p>` : ''}

    ${sum.purpose || sum.aims?.length ? html`<section class="sec"><div class="sec-head"><h2>About the project</h2></div>
      <div class="two-col"><div><p class="muted" style="margin-bottom:8px">Purpose</p><p>${sum.purpose}</p></div>
        ${sum.aims?.length ? html`<div><p class="muted" style="margin-bottom:8px">Aims</p><ul class="plain">${sum.aims.map((a) => html`<li>${a}</li>`)}</ul></div>` : ''}</div></section>` : ''}

    <section class="sec"><div class="sec-head"><h2>Partners</h2><p>Who is in the partnership and what each organisation does.</p></div>
      <ul class="people">${orgs.map((o) => {
        const r = roleOf(o);
        return html`<li><span class="avatar-sm" aria-hidden="true">${initials(o.name)}</span><div style="min-width:0">
          <strong>${o.name}</strong><span class="muted small">${r?.role_title || o.default_role}</span>
          ${r?.responsibilities?.length ? html`<ul class="plain small" style="margin-top:6px">${r.responsibilities.map((x) => html`<li>${x}</li>`)}</ul>` : ''}
          ${o.contact ? html`<p class="small muted" style="margin-top:4px">${o.contact.name}, ${(ROLE_LABEL[o.contact.role] || o.contact.role).toLowerCase()}</p>` : ''}</div></li>`;
      })}</ul></section>

    <section class="sec"><div class="sec-head split-head"><div><h2>What we are measuring</h2>
      <p>${outcomes.length ? `${outcomes.length} outcomes${reported.length ? `, ${reported.length} with progress reported` : ', none reported yet'}.` : 'No outcome framework agreed yet.'}</p></div></div>
      ${themes.map((t) => html`<div style="margin-top:24px"><h3 style="margin-bottom:4px">${t}</h3>
        <ul class="rows">${outcomes.filter((o) => (o.theme || 'Outcomes') === t).map(outcomeRow)}</ul></div>`)}</section>

    <section class="sec"><div class="sec-head"><h2>Delivery</h2>${sum.delivery_overview ? html`<p>${sum.delivery_overview}</p>` : ''}</div>
      <div class="two-col">
        <div><h3 style="margin-bottom:4px">Sites</h3>
          ${s.sites.length ? html`<ul class="rows">${s.sites.map((x) => html`<li><strong>${x.name}</strong>${x.organisation ? html` <span class="muted">· ${x.organisation}</span>` : ''}
            ${x.days || x.notes ? html`<div class="muted">${[x.days, x.notes].filter(Boolean).join(' · ')}</div>` : ''}</li>`)}</ul>` : html`<p class="not-yet">No sites added yet.</p>`}</div>
        <div><h3 style="margin-bottom:4px">Targeted share</h3>
          ${share == null ? html`<p class="not-yet" style="padding-top:20px">Not yet reported${min != null ? `. The funder's minimum is ${fmtNum(min)}%.` : '.'}</p>`
          : html`<p style="margin-top:12px;font-weight:600">${min == null ? `${fmtNum(share)}% of young people are from targeted groups.` : share >= min ? `${fmtNum(share)}%, at or above the ${fmtNum(min)}% minimum.` : `${fmtNum(share)}%, below the ${fmtNum(min)}% minimum.`}</p>
            <div style="padding-top:12px"><div class="figure" style="display:flex;justify-content:space-between;align-items:baseline"><strong style="font:400 30px/1 var(--display)">${fmtNum(share)}%</strong>
              ${min != null ? (share >= min ? pill('green', `At or above ${fmtNum(min)}%`, 'approved') : pill('amber', `Below ${fmtNum(min)}%`, 'overdue')) : ''}</div>
            <span class="slim" style="margin-top:12px" role="img" aria-label="${fmtNum(share)}% targeted${min != null ? `, minimum ${fmtNum(min)}%` : ''}"><span style="width:${Math.min(100, share)}%"></span>${min != null ? html`<i style="left:${min}%"></i>` : ''}</span>
            <p class="muted small" style="margin-top:8px">Share of young people from targeted groups${min != null ? '; the mark is the funder\'s minimum' : ''}.</p></div>`}
          ${w.targeted_criteria?.length ? html`<details class="wording" style="margin-top:16px"><summary class="small muted">Who counts as targeted</summary>
            <ul class="plain small">${w.targeted_criteria.map((t) => html`<li>${t}</li>`)}</ul></details>` : ''}</div>
      </div></section>

    ${sum.youth_voice_mechanism || sum.governance?.length ? html`<section class="sec two-col">
      ${sum.youth_voice_mechanism ? html`<div><div class="sec-head"><h2>Youth voice</h2></div><p>${sum.youth_voice_mechanism}</p></div>` : ''}
      ${sum.governance?.length ? html`<div><div class="sec-head"><h2>Governance</h2></div><ul class="plain">${sum.governance.map((g) => html`<li>${g}</li>`)}</ul></div>` : ''}</section>` : ''}

    ${dates.length || s.documents.length ? html`<section class="sec two-col">
      ${dates.length ? html`<div><div class="sec-head"><h2>Key dates</h2></div><ul class="rows">${dates.map((d) => html`<li class="row" style="grid-template-columns:minmax(0,1fr) auto"><span>${d.title}</span><span class="muted nowrap">${fmtDate(d.due_on)}</span></li>`)}</ul></div>` : ''}
      ${s.documents.length ? html`<div><div class="sec-head"><h2>Key documents</h2></div><ul class="rows">${s.documents.map((d) => {
        const f = docs.find((x) => x.id === d.id);
        return html`<li>${f?.storage_path ? html`<button class="linkbtn" data-path="${f.storage_path}">${d.title}</button>` : d.title} <span class="muted">· ${DOC_KIND[d.kind] || 'Document'}</span></li>`;
      })}</ul></div>` : ''}</section>` : ''}`);

  $$('[data-path]').forEach((b) => b.addEventListener('click', () => openFile(b, 'documents', b.dataset.path)));
  $('#publish')?.addEventListener('click', (e) => act(e.currentTarget, async () => {
    const n = must(await db.rpc('publish_summary', { p_consortium: c.id }));
    toast(`Version ${n} published.`);
    hub(ctx, el, []);
  }));
}

// ---------------------------------------------------------------- the lead

async function edit(ctx, el) {
  const c = ctx.consortium;
  const [s, members, documents, dates, measures, partners] = await Promise.all([
    db.rpc('consortium_summary', { p_consortium: c.id }).then(must),
    db.from('memberships').select('user_id, role, organisation_id').eq('consortium_id', c.id).eq('active', true).then(must),
    db.from('documents').select('id, title, kind, version, previous_id').eq('consortium_id', c.id).in('kind', Object.keys(DOC_KIND)).order('title').then(must),
    db.from('key_dates').select('*').eq('consortium_id', c.id).order('due_on').then(must),
    db.from('outcome_measures').select('*').eq('consortium_id', c.id).order('code').then(must),
    db.from('partners').select('id, name').order('name').then(must),
  ]);
  const ids = [...new Set(members.map((m) => m.user_id))];
  const people = ids.length ? must(await db.from('profiles').select('id, full_name, email').in('id', ids)) : [];
  const nameOf = (id) => { const p = people.find((x) => x.id === id); return p?.full_name || p?.email || 'Unnamed'; };
  const sum = s.summary || {};
  const replaced = new Set(documents.map((d) => d.previous_id).filter(Boolean));
  const docs = documents.filter((d) => !replaced.has(d.id));
  const roleOf = (o) => (sum.organisations || []).find((r) => r.organisation_id === o.id);
  const isBid = c.stage !== 'live';

  render(el, html`
    <p class="small" style="margin-bottom:16px"><a href="#/c/${c.id}/hub">← Summary</a></p>
    <div class="page-head"><div><span class="eyebrow m-governance">${raw(icon('partners', 16))}Edit summary</span><h1>${c.name}</h1>
      <p>Edit the draft, then publish it. No money appears on the summary.</p></div>
      <div class="btns"><button class="btn secondary" id="prefill">${raw(icon('spreadsheet', 18))}Fill from the bid</button></div></div>

    ${!s.summary ? html`<section class="panel">${emptyState('bids', 'No draft yet. Fill it from what the bid already holds, then edit.', html`<button class="btn" id="prefill2">${raw(icon('spreadsheet', 18))}Fill from the bid</button>`, 'governance')}</section>` : html`
    <form class="stack" id="summary">
      <section class="panel m-brand"><h2>${raw(icon('info', 20))}About</h2>
        <div class="form" style="display:grid;gap:16px">
          <label class="f">Purpose<span class="hint">Up to 600 characters. The first sentence is shown at the top.</span><textarea name="purpose" maxlength="600" required>${sum.purpose || ''}</textarea></label>
          <label class="f">Aims<span class="hint">One per line, up to 10.</span><textarea name="aims">${(sum.aims || []).join('\n')}</textarea></label>
          <div class="fields">
            <label class="f">Funder<input name="funder_name" maxlength="120" value="${sum.funder_name || ''}"></label>
            <label class="f">Programme<input name="programme_name" maxlength="160" value="${sum.programme_name || ''}"></label>
            <label class="f">Area served<input name="area_served" maxlength="120" value="${sum.area_served || ''}"></label>
            <label class="f">Ages<input name="age_range" maxlength="40" value="${sum.age_range || ''}" placeholder="e.g. 14 to 24"></label>
            <label class="f">Starts<input type="date" name="start_date" value="${sum.start_date || ''}"></label>
            <label class="f">Ends<input type="date" name="end_date" value="${sum.end_date || ''}"></label></div></div></section>
      <section class="panel m-delivery"><h2>${raw(icon('sites', 20))}Delivery, youth voice and governance</h2>
        <div class="form" style="display:grid;gap:16px">
          <label class="f">How delivery works<span class="hint">Up to 600 characters.</span><textarea name="delivery_overview" maxlength="600">${sum.delivery_overview || ''}</textarea></label>
          <label class="f">How young people shape the programme<span class="hint">Up to 300 characters.</span><textarea name="youth_voice_mechanism" maxlength="300">${sum.youth_voice_mechanism || ''}</textarea></label>
          <label class="f">Governance<span class="hint">One short statement per line: meeting rhythm, escalation route, how decisions are made.</span><textarea name="governance">${(sum.governance || []).join('\n')}</textarea></label></div></section>
      <section class="panel m-governance"><h2>${raw(icon('partners', 20))}Partners</h2>
        <div class="tiles">${s.organisations.map((o) => {
          const r = roleOf(o);
          const theirs = members.filter((m) => m.organisation_id === o.id);
          return html`<fieldset class="org-role" data-org="${o.id}"><legend>${o.name}</legend>
            <label class="f">Role<input name="role_title" maxlength="80" value="${r?.role_title || o.default_role}" required></label>
            <label class="f">Responsibilities<span class="hint">One per line, three to five.</span><textarea name="responsibilities">${(r?.responsibilities || []).join('\n')}</textarea></label>
            <label class="f">Key contact<select name="key_contact"><option value="">None</option>
              ${theirs.map((m) => html`<option value="${m.user_id}" ${r?.key_contact_profile_id === m.user_id ? 'selected' : ''}>${nameOf(m.user_id)} · ${ROLE_LABEL[m.role] || m.role}</option>`)}</select></label></fieldset>`;
        })}</div></section>
      <section class="panel m-governance"><h2>${raw(icon('bids', 20))}Key documents</h2>
        <p class="helper">Only documents without money can be shared here: never the budget, grant agreement or submitted bid.</p>
        ${docs.length ? html`<div class="checks" style="margin-top:12px;display:grid;gap:8px">${docs.map((d) => html`<label class="check"><input type="checkbox" name="doc" value="${d.id}" ${(sum.document_ids || []).includes(d.id) ? 'checked' : ''}>
          ${d.title} <span class="small muted">· ${DOC_KIND[d.kind]}</span></label>`)}</div>` : html`<p class="empty">No shareable documents uploaded. Add them under Agreements.</p>`}</section>
      <div class="btns"><button class="btn secondary" name="save" value="1">Save draft</button><button class="btn" name="publish" value="1">${raw(icon('submitted', 18))}Save and publish</button></div>
    </form>`}

    <div class="section"><h2>Workspace records</h2><p class="helper" style="margin-bottom:16px">Organisations, sites, key dates and outcomes, used across the portal. Budgets are under Targets and budget.</p>
      <section class="panel m-governance"><h2>${raw(icon('partners', 20))}Organisations</h2>
        <div class="table-wrap"><table class="cards"><thead><tr><th>Organisation</th><th>Kind</th><th>Contact</th><th></th></tr></thead>
          <tbody>${ctx.orgs.map((o) => html`<tr><td><strong>${o.name}</strong></td><td data-label="Kind">${KIND_LABEL[o.kind]}</td>
            <td data-label="Contact">${o.contact_name || ''}${o.contact_email ? html`<br>${o.contact_email}` : ''}</td>
            <td><button class="linkbtn small" data-edit-org="${o.id}">Edit</button></td></tr>`)}</tbody></table></div>
        <details class="add" id="org-box" style="margin-top:16px"><summary id="org-summary">${raw(icon('add', 18))}Add an organisation</summary>
          <form class="form" id="org-form"><input type="hidden" name="id">
            <div class="fields">
              <label class="f">Name<input name="name" required></label>
              <label class="f">Kind<select name="kind" required>${Object.entries(KIND_LABEL).map(([k, v]) => html`<option value="${k}">${v}</option>`)}</select></label>
              <label class="f">Partner library record<span class="hint">Links approved documents across bids.</span><select name="partner_id">
                <option value="">Not linked</option><option value="new">Create a new record</option>${partners.map((p) => html`<option value="${p.id}">${p.name}</option>`)}</select></label></div>
            <div class="fields">
              <label class="f">Contact name<input name="contact_name"></label>
              <label class="f">Contact email<input type="email" name="contact_email"></label>
              <label class="f">Contact phone<input type="tel" name="contact_phone"></label></div>
            <div class="btns"><button class="btn">Save organisation</button></div></form></details></section>

      <div class="grid2" style="margin-top:24px">
        <section class="panel m-delivery"><h2>${raw(icon('sites', 20))}Sites</h2>
          ${ctx.sites.length ? html`<ul class="statements">${ctx.sites.map((x) => html`<li>${raw(icon('sites', 18))}<span><strong>${x.name}</strong>${x.delivery_days ? ` · ${x.delivery_days}` : ''}
            <button class="linkbtn small" data-del-site="${x.id}">Remove</button></span></li>`)}</ul>` : html`<p class="empty">No sites yet.</p>`}
          <details class="add" style="margin-top:16px"><summary>${raw(icon('add', 18))}Add a site</summary>
            <form class="form" id="add-site"><div class="fields">
              <label class="f">Site name<input name="name" required></label>
              <label class="f">Run by<select name="organisation_id"><option value="">Choose…</option>${ctx.orgs.map((o) => html`<option value="${o.id}">${o.name}</option>`)}</select></label>
              <label class="f">Area<input name="area"></label>
              <label class="f">Days and times<input name="delivery_days" placeholder="e.g. Saturdays 11am to 6pm"></label></div>
              <label class="f">Notes<input name="notes"></label>
              <div class="btns"><button class="btn">Add site</button></div></form></details></section>
        <section class="panel m-compliance"><h2>${raw(icon('expiry', 20))}Key dates</h2>
          ${dates.length ? html`<ul class="statements">${dates.map((d) => html`<li>${raw(icon('sessions', 18))}<span><strong>${fmtDate(d.due_on)}</strong> ${d.title}
            <button class="linkbtn small" data-del-date="${d.id}">Remove</button></span></li>`)}</ul>` : html`<p class="empty">No dates yet.</p>`}
          <details class="add" style="margin-top:16px"><summary>${raw(icon('add', 18))}Add a date</summary>
            <form class="form" id="add-date"><div class="fields">
              <label class="f">What<input name="title" required></label>
              <label class="f">Date<input type="date" name="due_on" required></label></div>
              <label class="f">Notes<input name="notes"></label>
              <div class="btns"><button class="btn">Add date</button></div></form></details></section>
      </div>

      <div class="grid2" style="margin-top:24px">
        <section class="panel m-surveys"><h2>${raw(icon('outcomes', 20))}Outcome framework</h2>
          ${measures.length ? html`<ul class="statements">${measures.map((m) => html`<li>${raw(icon('outcomes', 18))}<span><strong>${m.code}</strong> ${m.label}${m.active ? '' : ' (retired)'}</span></li>`)}</ul>` : html`<p class="empty">Not agreed yet.</p>`}
          <details class="add" style="margin-top:16px"><summary>${raw(icon('add', 18))}Add an outcome</summary>
            <form class="form" id="add-measure"><div class="fields">
              <label class="f">Short code<input name="code" required placeholder="e.g. CONF"></label>
              <label class="f">Outcome<input name="label" required></label></div>
              <label class="f">How it's measured<input name="description"></label>
              <div class="btns"><button class="btn">Add outcome</button></div></form></details></section>
        <section class="panel m-governance"><h2>${raw(icon('admin', 20))}Workspace details</h2>
          <form class="form" id="edit-c">
            <div class="fields">
              <label class="f">Name<input name="name" value="${c.name}" required></label>
              <label class="f">Funder<input name="funder" value="${c.funder || ''}"></label>
              <label class="f">Programme<input name="programme" value="${c.programme || ''}"></label>
              ${isBid ? html`<label class="f">Bid deadline<input type="date" name="bid_deadline" value="${c.bid_deadline || ''}"></label>` : ''}
              <label class="f">Starts<input type="date" name="start_date" value="${c.start_date || ''}" ${isBid ? '' : 'required'}></label>
              <label class="f">Ends<input type="date" name="end_date" value="${c.end_date || ''}" ${isBid ? '' : 'required'}></label>
              <label class="f">Youngest age<input type="number" name="min_age" value="${c.min_age}" min="0" max="30" required></label>
              <label class="f">Oldest age<input type="number" name="max_age" value="${c.max_age}" min="0" max="30" required></label>
              <label class="f">Targeted share (%)<input type="number" name="targeted_share_target" value="${c.targeted_share_target ?? ''}" min="0" max="100" step="0.1"></label></div>
            <label class="f">Short description<textarea name="description">${c.description || ''}</textarea></label>
            ${isBid ? html`<label class="f">Eligibility rules<span class="hint">Shown at the top of bid readiness.</span><textarea name="eligibility_rules">${c.eligibility_rules || ''}</textarea></label>` : ''}
            <label class="f">Funder's requirements<textarea name="funder_requirements">${c.funder_requirements || ''}</textarea></label>
            <label class="f">Delivery model<textarea name="delivery_model">${c.delivery_model || ''}</textarea></label>
            <label class="f">Who counts as targeted<span class="hint">One per line. These become the options when a young person is registered.</span>
              <textarea name="targeted_criteria">${c.targeted_criteria.join('\n')}</textarea></label>
            <div class="btns"><button class="btn">Save details</button></div></form></section>
      </div>
    </div>`);

  const again = () => edit(ctx, el);
  const prefill = (b) => act(b, async () => { must(await db.rpc('prefill_summary', { p_consortium: c.id })); toast('Filled from the bid. Check every line before publishing.'); again(); });
  $('#prefill').addEventListener('click', (e) => prefill(e.currentTarget));
  $('#prefill2')?.addEventListener('click', (e) => prefill(e.currentTarget));

  $('#summary')?.addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      const f = e.target;
      const v = (n) => f.elements[n].value.trim() || null;
      must(await db.from('workspace_summary').upsert({
        consortium_id: c.id, purpose: v('purpose'), aims: lines(f.elements.aims.value).slice(0, 10), funder_name: v('funder_name'), programme_name: v('programme_name'),
        area_served: v('area_served'), age_range: v('age_range'), start_date: v('start_date'), end_date: v('end_date'),
        delivery_overview: v('delivery_overview'), youth_voice_mechanism: v('youth_voice_mechanism'), governance: lines(f.elements.governance.value).slice(0, 10),
        document_ids: $$('input[name=doc]:checked', f).map((x) => x.value),
      }));
      must(await db.from('organisation_roles_in_workspace').upsert($$('.org-role', f).map((fs, i) => ({
        consortium_id: c.id, organisation_id: fs.dataset.org, role_title: fs.querySelector('[name=role_title]').value.trim(),
        responsibilities: lines(fs.querySelector('[name=responsibilities]').value).slice(0, 5),
        key_contact_profile_id: fs.querySelector('[name=key_contact]').value || null, position: i + 1,
      }))));
      if (e.submitter.name === 'publish') {
        const n = must(await db.rpc('publish_summary', { p_consortium: c.id }));
        toast(`Version ${n} published.`);
        location.hash = `#/c/${c.id}/hub`;
      } else { toast('Draft saved.'); again(); }
    });
  });

  const orgForm = $('#org-form');
  $$('[data-edit-org]').forEach((b) => b.addEventListener('click', () => {
    const o = ctx.org(b.dataset.editOrg);
    for (const k of ['id', 'name', 'kind', 'contact_name', 'contact_email', 'contact_phone', 'partner_id']) orgForm.elements[k].value = o[k] ?? '';
    $('#org-summary').textContent = `Edit ${o.name}`;
    $('#org-box').open = true;
    orgForm.elements.name.focus();
  }));
  orgForm.addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      const { id, ...row } = formData(orgForm);
      if (row.partner_id === 'new') row.partner_id = must(await db.from('partners').insert({ name: row.name }).select('id').single()).id;
      if (id) must(await db.from('organisations').update(row).eq('id', id));
      else must(await db.from('organisations').insert({ ...row, consortium_id: c.id }));
      toast('Organisation saved.');
      await ctx.reload();
    });
  });
  $('#add-site').addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => { must(await db.from('sites').insert({ ...formData(e.target), consortium_id: c.id })); toast('Site added.'); await ctx.reload(); });
  });
  $$('[data-del-site]').forEach((b) => b.addEventListener('click', () => act(b, async () => {
    must(await db.from('sites').delete().eq('id', b.dataset.delSite)); await ctx.reload();
  })));
  $('#add-date').addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => { must(await db.from('key_dates').insert({ ...formData(e.target), consortium_id: c.id })); toast('Date added.'); again(); });
  });
  $$('[data-del-date]').forEach((b) => b.addEventListener('click', () => act(b, async () => {
    must(await db.from('key_dates').delete().eq('id', b.dataset.delDate)); again();
  })));
  $('#add-measure').addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      const row = formData(e.target);
      must(await db.from('outcome_measures').insert({ ...row, code: row.code.toUpperCase(), consortium_id: c.id }));
      toast('Outcome added.'); again();
    });
  });
  $('#edit-c').addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      const row = formData(e.target);
      row.targeted_criteria = (row.targeted_criteria || '').split('\n').map((x) => x.trim()).filter(Boolean);
      must(await db.from('consortia').update(row).eq('id', c.id));
      toast('Details saved.');
      await ctx.reload();
    });
  });
}
