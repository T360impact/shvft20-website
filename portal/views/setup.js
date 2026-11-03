// The set-up checklist the wizards land on: every step to get a bid or a
// consortium going, each ticked from what the workspace already holds, and
// each opening the page where it's done (or done here: details, funder
// profile, the application form and guidance, reading the documents).
import { db, html, raw, render, $, $$, must, act, toast, icon, pill, formData, fmtDate, uploadFile } from '../lib.js';

export default async function setup(ctx, el) {
  const c = ctx.consortium;
  const bid = c.stage !== 'live';
  const [settings, profiles, docs, runs, cms, versions, invites, members, items] = await Promise.all([
    db.from('workspace_settings').select('funder_profile_id, updated_at').eq('consortium_id', c.id).maybeSingle().then(must),
    db.from('funder_profiles').select('id, name').order('name').then(must),
    db.from('documents').select('id, title, kind').eq('consortium_id', c.id).then(must),
    db.from('extraction_runs').select('id, status').eq('consortium_id', c.id).then(must),
    db.from('commitments').select('id', { count: 'exact', head: true }).eq('consortium_id', c.id).is('superseded_by', null).is('retired_at', null),
    db.from('workspace_summary_versions').select('version', { count: 'exact', head: true }).eq('consortium_id', c.id),
    db.from('invitations').select('id, status').eq('consortium_id', c.id).then(must),
    db.from('memberships').select('id', { count: 'exact', head: true }).eq('consortium_id', c.id).eq('active', true),
    db.from('bid_items').select('id', { count: 'exact', head: true }).eq('consortium_id', c.id),
  ]);
  const href = (k) => `#/c/${c.id}/${k}`;
  const appForm = docs.filter((d) => d.kind === 'application_form');
  const guidance = docs.filter((d) => d.kind === 'other' && /guidance/i.test(d.title));
  const partnersDone = invites.length > 0 || (members.count || 0) > 1;
  const S = bid ? [
    { k: 'details', title: 'Details', done: !!(c.name && c.bid_deadline), text: c.bid_deadline ? `${c.funder || 'Funder not set'} · deadline ${fmtDate(c.bid_deadline)}` : 'Name, funder, deadline and value.', inline: 'details' },
    { k: 'profile', title: 'Funder profile', done: !!settings?.funder_profile_id, text: 'Optional: the funder\'s reporting rules and budget headings.', inline: 'profile', optional: true },
    { k: 'docs', title: 'The application form and guidance', done: appForm.length > 0, text: appForm.length ? `${appForm.length} application form${appForm.length === 1 ? '' : 's'}, ${guidance.length} guidance` : 'Upload them here; they stay under Documents.', inline: 'docs' },
    { k: 'partners', title: 'Invite partners', done: partnersDone, text: 'From any organisation, or a new one added in the invite form.', go: href('team'), label: 'Invite partners' },
    { k: 'read', title: 'Requirements from the documents', done: runs.length > 0 || (items.count || 0) > 0, text: runs.length ? 'Read. Check what was found under Requirements.' : 'Read the documents for the funder\'s targets, budget and rules; add the checklist of what each partner must provide.', inline: 'read' },
    { k: 'open', title: 'Open the bid', done: false, text: 'Readiness, the checklist and deadlines.', go: href('bid'), label: 'Go to the bid' },
  ] : [
    { k: 'profile', title: 'Funder profile', done: !!settings?.funder_profile_id, text: 'The funder\'s reporting rules, budget headings and outcome framework.', inline: 'profile', optional: true },
    { k: 'details', title: 'Basic details', done: !!(c.name && c.funder && c.start_date && c.end_date), text: `${c.funder || 'Funder not set'} · ${c.start_date ? `${fmtDate(c.start_date)} to ${fmtDate(c.end_date)}` : 'dates not set'}`, inline: 'details' },
    { k: 'settings', title: 'Settings', done: !!settings?.updated_at && +new Date(settings.updated_at) - +new Date(c.created_at) > 60000, text: 'Reporting period, return due dates, ratings and what the funder sees.', go: href('master'), label: 'Open settings', tab: 'settings' },
    { k: 'partners', title: 'Partners and roles', done: partnersDone, text: 'Invite each partner\'s people; the relationship sets their access.', go: href('team'), label: 'Invite partners' },
    { k: 'docs', title: 'Documents and extraction', done: docs.length > 0 && runs.length > 0, text: `${docs.length} document${docs.length === 1 ? '' : 's'} uploaded, ${runs.length} read.`, go: href('agreements'), label: 'Upload documents', go2: href('targets'), label2: 'Read them' },
    { k: 'targets', title: 'Confirm targets and budget', done: (cms.count || 0) > 0 && !runs.some((r) => r.status === 'needs_review'), text: `${cms.count || 0} targets${runs.some((r) => r.status === 'needs_review') ? ' · a reading is waiting to be checked' : ''}.`, go: href('targets'), label: 'Targets and budget' },
    { k: 'summary', title: 'Publish the Summary', done: (versions.count || 0) > 0, text: 'What the programme is and who does what, for every partner.', go: href('hub'), label: 'Open the Summary' },
  ];
  const done = S.filter((s) => s.done).length;
  const again = () => setup(ctx, el);
  render(el, html`
    <div class="page-head"><div><span class="eyebrow">Set-up checklist</span><h1>${c.name}</h1>
      <p class="muted">${done} of ${S.length} steps done. Each one opens where it's done; come back here any time.</p></div></div>
    <ol class="setup-list">${S.map((s, i) => html`<li class="${s.done ? 'done' : ''}" id="step-${s.k}">
      <span class="setup-num">${s.done ? raw(icon('check', 18)) : i + 1}</span>
      <div class="setup-main"><p><strong>${s.title}</strong> ${s.done ? pill('green', 'Done') : s.optional ? pill('grey', 'Optional') : ''}</p><p class="small muted">${s.text}</p>
        <div class="setup-inline" data-inline="${s.inline || ''}"></div></div>
      <div class="btns">${s.inline ? html`<button type="button" class="btn ${s.done ? 'secondary' : ''} small" data-open="${s.inline}">${s.done ? 'Change' : 'Do it here'}</button>` : ''}
        ${s.go ? html`<a class="btn ${s.done ? 'secondary' : ''} small" href="${s.go}" ${raw(s.tab ? `data-tab="${s.tab}"` : '')}>${s.label}</a>` : ''}${s.go2 ? html`<a class="btn secondary small" href="${s.go2}">${s.label2}</a>` : ''}</div></li>`)}</ol>`);

  // The settings tab of the Dashboard.
  $$('[data-tab]', el).forEach((a) => a.addEventListener('click', () => { (ctx.uiTier ||= {}).mtab = a.dataset.tab; }));
  const forms = {
    details: () => html`<form class="form" data-form="details">
      <label class="f">Name<input name="name" required value="${c.name || ''}"></label>
      <div class="fields"><label class="f">Funder<input name="funder" value="${c.funder || ''}"></label>${bid ? '' : html`<label class="f">Programme<input name="programme" value="${c.programme || ''}"></label>`}
        <label class="f">Value (£)<input type="number" name="grant_value" min="0" value="${c.grant_value ?? ''}"></label></div>
      ${bid ? html`<label class="f">Deadline<input type="date" name="bid_deadline" value="${c.bid_deadline || ''}" required></label>`
        : html`<div class="fields"><label class="f">Starts<input type="date" name="start_date" required value="${c.start_date || ''}"></label><label class="f">Ends<input type="date" name="end_date" required value="${c.end_date || ''}"></label></div>`}
      <div class="btns"><button class="btn small">Save</button></div></form>`,
    profile: () => html`<form class="form" data-form="profile"><label class="f">Funder profile<select name="profile" required><option value="">Choose…</option>${profiles.map((p) => html`<option value="${p.id}" ${p.id === settings?.funder_profile_id ? 'selected' : ''}>${p.name}</option>`)}</select></label>
      <div class="btns"><button class="btn small">Apply</button></div></form>`,
    docs: () => html`<form class="form" data-form="docs">
      <label class="f">Application form<input type="file" name="app" accept=".pdf,.docx,.xlsx"></label>
      <label class="f">Guidance<input type="file" name="guide" accept=".pdf,.docx,.xlsx" multiple></label>
      <div class="btns"><button class="btn small">Upload</button></div></form>`,
    read: () => html`${docs.length ? html`<form class="form" data-form="read"><fieldset><legend>Read these documents</legend><div class="checks">${docs.map((d) => html`<label class="check small"><input type="checkbox" name="doc" value="${d.id}" checked> ${d.title}</label>`)}</div></fieldset>
      <div class="btns"><button class="btn small">Read them</button><a class="btn secondary small" href="${href('bid')}">Add a checklist from a template</a></div></form>`
      : html`<p class="small">Upload the application form and guidance first.</p>`}`,
  };
  $$('[data-open]', el).forEach((b) => b.addEventListener('click', () => {
    const box = $(`[data-inline="${b.dataset.open}"]`, el);
    if (box.innerHTML) { render(box, ''); return; }
    render(box, forms[b.dataset.open]());
    const form = $('form', box);
    form?.addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => {
      const f = formData(e.target);
      if (b.dataset.open === 'details') {
        must(await db.from('consortia').update(bid ? { name: f.name, funder: f.funder || null, grant_value: f.grant_value ? Number(f.grant_value) : null, bid_deadline: f.bid_deadline }
          : { name: f.name, funder: f.funder || null, programme: f.programme || null, grant_value: f.grant_value ? Number(f.grant_value) : null, start_date: f.start_date, end_date: f.end_date }).eq('id', c.id));
        toast('Saved.'); return ctx.reload();
      }
      if (b.dataset.open === 'profile') { must(await db.rpc('apply_funder_profile', { p_consortium: c.id, p_profile: f.profile })); toast('Funder profile applied.'); return ctx.reload(); }
      if (b.dataset.open === 'docs') {
        const app = e.target.app.files[0]; const guides = [...e.target.guide.files];
        if (!app && !guides.length) throw new Error('Choose the application form or the guidance.');
        for (const [file, kind, title] of [...(app ? [[app, 'application_form', `Application form: ${app.name}`]] : []), ...guides.map((g) => [g, 'other', `Guidance: ${g.name}`])]) {
          const path = await uploadFile('documents', `${c.id}/shared`, file);
          must(await db.from('documents').insert({ consortium_id: c.id, kind, title: title.slice(0, 200), storage_path: path, file_name: file.name, mime_type: file.type || null, uploaded_by: ctx.user.id }));
        }
        toast('Uploaded. They are under Documents.'); return again();
      }
      if (b.dataset.open === 'read') {
        const ids = $$('[name=doc]:checked', e.target).map((x) => x.value);
        if (!ids.length) throw new Error('Tick at least one document.');
        const { error } = await db.functions.invoke('extract-programme-data', { body: { consortium_id: c.id, document_ids: ids } });
        if (error) { let m = error.message; try { m = (await error.context.json()).error || m; } catch { /* keep it */ } throw new Error(m); }
        toast('Reading the documents. Check what was found under Requirements in a minute or two.'); return again();
      }
    }); });
  }));
}
