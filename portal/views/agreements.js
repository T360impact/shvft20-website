// Agreements and commitments: the grant and consortium agreements, each
// partner's schedule (signed by the partner, countersigned by the accountable
// body) and the targets promised to the funder.
import { db, html, raw, render, $, $$, formData, toast, act, must, icon, fmtDate, fmtDateTime, fmtMoney, fmtNum, statusPill, statCard, openDrawer, uploadFile, openFile,
  segControl, bindSegments, sectionGroup, MEASURE_LABEL } from '../lib.js';

const DOC_KIND = { application_form: 'Application form', grant_agreement: 'Grant agreement', consortium_agreement: 'Consortium agreement', partner_schedule: 'Partner schedule', policy: 'Policy', other: 'Other' };

// Document types grouped the way a lead looks for them.
const DOC_GROUP = [
  ['Agreements', ['grant_agreement', 'consortium_agreement']],
  ['Partner schedules', ['partner_schedule']],
  ['Programme documents', ['application_form', 'submitted_bid', 'budget', 'delivery_model', 'monitoring_framework']],
  ['Risk registers', ['risk_register']],
  ['Policies', ['policy']],
  ['Other', ['other']],
];
const KIND_NAME = { ...DOC_KIND, submitted_bid: 'Submitted bid', budget: 'Budget', delivery_model: 'Delivery model', monitoring_framework: 'Outcome framework', risk_register: 'Risk register' };
const periodKey = (m) => (m.period === 'lifetime' || m.year == null ? 'lifetime' : String(m.year));
const periodName = (p) => (p === 'lifetime' ? 'Project lifetime' : `Year ${p}`);
const sectionKey = (m) => `${m.section || 'Other'} ${m.kind === 'outcome' ? 'outcomes' : 'outputs'}`;

export default async function agreements(ctx, el) {
  const c = ctx.consortium;
  const [docs, schedules, commitments] = await Promise.all([
    db.from('documents').select('*').eq('consortium_id', c.id).order('created_at', { ascending: false }).then(must),
    ctx.role === 'funder_observer' ? [] : db.from('partner_schedules').select('*').eq('consortium_id', c.id).order('created_at').then(must),
    // Current versions only: a changed target keeps its old version in the record, not here.
    db.from('commitments').select('*').eq('consortium_id', c.id).is('superseded_by', null).is('retired_at', null).order('year').order('measure').then(must),
  ]);
  const partners = ctx.orgs.filter((o) => ['delivery_partner', 'accountable_body', 'lead'].includes(o.kind));
  const name = ctx.profile.full_name || '';
  const waiting = (s) => (s.status === 'issued' && ctx.role === 'partner_manager' && s.organisation_id === ctx.orgId)
    || (s.status === 'partner_signed' && ctx.role === 'accountable_body');
  const signed = schedules.filter((s) => s.status === 'countersigned').length;
  const mine = schedules.filter(waiting).length;
  const periods = [...new Set(commitments.map(periodKey))].sort((a, b) => (a === 'lifetime') - (b === 'lifetime') || a - b);
  // Open on the programme year we're in.
  const currentYear = String(c.start_date ? Math.max(1, Math.floor((Date.now() - Date.parse(c.start_date)) / (365.25 * 864e5)) + 1) : 1);
  const firstPeriod = periods.includes(currentYear) ? currentYear : periods[0];

  const docTable = (list) => html`<div class="table-wrap"><table>
    <thead><tr><th>Document</th><th>Type</th><th>For</th><th>Added</th>${ctx.seesAll ? html`<th></th>` : ''}</tr></thead>
    <tbody>${list.map((d) => html`<tr>
      <td>${d.storage_path ? html`<button class="linkbtn" data-open="${d.storage_path}">${d.title}</button>` : html`<strong>${d.title}</strong>`}</td>
      <td>${KIND_NAME[d.kind] || 'Document'}</td><td>${d.organisation_id ? ctx.org(d.organisation_id)?.name : 'Whole consortium'}</td>
      <td class="nowrap">${fmtDate(d.created_at)}</td>
      ${ctx.seesAll ? html`<td><button class="linkbtn small" data-del-doc="${d.id}" data-path="${d.storage_path || ''}">Remove</button></td>` : ''}</tr>`)}</tbody></table></div>`;

  const schedBody = (s) => html`<dl class="facts">
      <dt>Targets</dt><dd class="prose">${s.targets || '–'}</dd>
      <dt>Sites</dt><dd>${s.sites || '–'}</dd>
      <dt>Days</dt><dd>${s.delivery_days || '–'}</dd>
      <dt>Budget</dt><dd>${fmtMoney(s.budget) || '–'}</dd>
      ${s.partner_signed_at ? html`<dt>Partner signed</dt><dd>${s.partner_signed_name}, ${fmtDateTime(s.partner_signed_at)}</dd>` : ''}
      ${s.countersigned_at ? html`<dt>Countersigned</dt><dd>${s.countersigned_name}, ${fmtDateTime(s.countersigned_at)}</dd>` : ''}
    </dl>
    ${waiting(s) ? html`<form class="form sign" data-id="${s.id}" style="margin-top:14px">
      <label class="check"><input type="checkbox" name="agree" required> I have authority to sign for ${ctx.orgName} and agree to this schedule.</label>
      <div class="fields"><label class="f">Type your full name to sign<input name="signed_name" value="${name}" required></label></div>
      <div class="btns"><button class="btn">Sign schedule</button></div></form>` : ''}
    ${ctx.manages && s.status === 'draft' ? html`<div class="btns" style="margin-top:14px">
      <button class="btn small" data-issue="${s.id}">Issue for signature</button>
      <button class="btn small secondary" data-del-sched="${s.id}">Delete draft</button></div>` : ''}`;

  const cmTable = (list) => html`<div class="table-wrap"><table>
    <thead><tr><th>Measure</th><th>Who</th><th>Site</th><th class="num">Target</th>${ctx.manages ? html`<th></th>` : ''}</tr></thead>
    <tbody>${list.map((m) => html`<tr><td><strong>${m.label}</strong><br><span class="muted small">${[periodName(periodKey(m)), MEASURE_LABEL[m.measure]].filter(Boolean).join(' · ')}</span>${m.notes ? html`<br><span class="muted small">${m.notes}</span>` : ''}</td>
      <td>${m.organisation_id ? ctx.org(m.organisation_id)?.name : 'Whole consortium'}</td><td>${m.site_id ? ctx.site(m.site_id)?.name : m.site_name || '–'}</td>
      <td class="num">${fmtNum(m.target)}${m.measure === 'targeted_pct' || m.unit === '%' ? '%' : ''}</td>
      ${ctx.manages ? html`<td><button class="linkbtn small" data-del-cm="${m.id}">Remove</button></td>` : ''}</tr>`)}</tbody></table></div>`;

  render(el, html`
    <div class="page-head"><div><span class="eyebrow">Agreements and commitments</span><h1>What everyone has signed up to</h1></div>
      ${ctx.seesAll || ctx.manages ? html`<div class="btns">${ctx.seesAll ? html`<button class="btn secondary" id="open-upload">${raw(icon('upload', 16))}Upload a document</button>` : ''}
        ${ctx.manages ? html`<button class="btn secondary" id="open-sched">${raw(icon('add', 16))}Draft a schedule</button><button class="btn" id="open-cm">${raw(icon('add', 16))}Add a commitment</button>` : ''}</div>` : ''}</div>

    <div class="stats stats-4">
      ${statCard({ icon: 'bids', value: docs.length, label: 'Documents', trend: { dir: 'flat', tone: 'grey', text: `${DOC_GROUP.filter(([, ks]) => docs.some((d) => ks.includes(d.kind))).length} kinds held` } })}
      ${ctx.role !== 'funder_observer' ? statCard({ icon: 'governance', value: schedules.length ? `${signed} of ${schedules.length}` : '–', label: 'Schedules signed',
        trend: schedules.length ? { dir: signed === schedules.length ? 'up' : 'flat', tone: signed === schedules.length ? 'green' : 'amber', text: signed === schedules.length ? 'all countersigned' : 'still to sign' } : { dir: 'flat', tone: 'grey', text: 'no schedules yet' } }) : ''}
      ${statCard({ icon: 'targets', value: commitments.length, label: 'Commitments', trend: { dir: 'flat', tone: 'grey', text: `over ${periods.length} period${periods.length === 1 ? '' : 's'}` } })}
      ${ctx.role !== 'funder_observer' ? statCard({ icon: 'submitted', value: mine, label: 'Waiting for you', trend: mine ? { dir: 'flat', tone: 'amber', text: 'schedules to sign' } : { dir: 'up', tone: 'green', text: 'nothing to sign' } }) : ''}</div>

    <div class="dgrid">
      <section class="dcard full"><header class="dcard-head"><h2>Commitments to the funder</h2><p>The targets the dashboard tracks. Year 1 runs from ${fmtDate(c.start_date)}.</p></header>
        ${commitments.length ? html`<div class="group-tools">${periods.length > 1 ? segControl('cm', [...periods.map((p) => [p, periodName(p)]), ['', 'All']], firstPeriod) : html`<span></span>`}
            <span class="muted small">${commitments.length} commitment${commitments.length === 1 ? '' : 's'}</span></div>
          ${periods.map((p) => {
            const pr = commitments.filter((m) => periodKey(m) === p);
            const keys = [...new Set(pr.map(sectionKey))].sort((a, b) => (a.startsWith('Targeted') ? 0 : a.startsWith('Universal') ? 1 : 2) - (b.startsWith('Targeted') ? 0 : b.startsWith('Universal') ? 1 : 2) || a.localeCompare(b));
            return html`<div class="pane" data-seg-pane="cm:${p}"><h3 class="pane-head">${periodName(p)}</h3>${keys.map((k) => {
              const kr = pr.filter((m) => sectionKey(m) === k);
              return sectionGroup({ title: k, meta: `${kr.length} commitment${kr.length === 1 ? '' : 's'}`, body: cmTable(kr) });
            })}</div>`;
          })}` : html`<p class="empty">No commitments yet.</p>`}</section>

      ${ctx.role !== 'funder_observer' ? html`<section class="dcard half"><header class="dcard-head"><h2>Partner schedules</h2><p>Each partner's targets, sites, days and budget. The partner signs, then the accountable body countersigns.</p></header>
        ${schedules.length ? schedules.map((s) => sectionGroup({ title: ctx.org(s.organisation_id)?.name || 'Partner', meta: s.title, aside: statusPill(s.status), open: waiting(s), body: schedBody(s) }))
        : html`<p class="empty">No schedules yet.</p>`}</section>` : ''}

      <section class="dcard ${ctx.role !== 'funder_observer' ? 'half' : 'full'}"><header class="dcard-head"><h2>Documents</h2><p>Grouped by type. Open a group to see its documents.</p></header>
        ${docs.length ? DOC_GROUP.map(([title, kinds]) => [title, docs.filter((d) => kinds.includes(d.kind))]).filter(([, list]) => list.length)
          .map(([title, list]) => sectionGroup({ title, meta: `${list.length} document${list.length === 1 ? '' : 's'} · latest ${fmtDate(list[0].created_at)}`, body: docTable(list) }))
        : html`<p class="empty">No documents yet.</p>`}</section>
    </div>`);
  bindSegments(el);

  // The add forms open in a side panel rather than sitting on the page.
  $('#open-upload')?.addEventListener('click', () => {
    const d = openDrawer('Upload a document', html`<form class="form" id="upload"><div class="fields">
      <label class="f">Title<input name="title" required></label>
      <label class="f">Type<select name="kind">${Object.entries(KIND_NAME).map(([k, v]) => html`<option value="${k}">${v}</option>`)}</select></label>
      <label class="f">Who can see it<select name="organisation_id"><option value="">Whole consortium</option>${partners.map((o) => html`<option value="${o.id}">${o.name} only</option>`)}</select></label></div>
      <label class="f">File<span class="hint">PDF or Word, up to 25MB.</span><input type="file" name="file" accept=".pdf,.doc,.docx,.xlsx,.odt" required></label>
      <div class="btns"><button class="btn">Upload</button></div></form>`);
    bindUpload(d);
  });
  $('#open-sched')?.addEventListener('click', () => {
    const d = openDrawer('Draft a schedule', html`<form class="form" id="new-sched"><div class="fields">
      <label class="f">Partner<select name="organisation_id" required><option value="">Choose…</option>${partners.map((o) => html`<option value="${o.id}">${o.name}</option>`)}</select></label>
      <label class="f">Title<input name="title" value="Delivery schedule, year 1" required></label>
      <label class="f">Budget (£)<input type="number" name="budget" min="0"></label></div>
      <label class="f">Targets<textarea name="targets" placeholder="e.g. 150 young people reached, 33% targeted, 80 sessions"></textarea></label>
      <div class="fields"><label class="f">Sites<input name="sites"></label><label class="f">Delivery days<input name="delivery_days"></label></div>
      <div class="btns"><button class="btn">Save draft</button></div></form>`);
    bindSched(d);
  });
  $('#open-cm')?.addEventListener('click', () => {
    const d = openDrawer('Add a commitment', html`<form class="form" id="new-cm"><div class="fields">
      <label class="f">Measure<select name="measure" required>${Object.entries(MEASURE_LABEL).map(([k, v]) => html`<option value="${k}">${v}</option>`)}</select></label>
      <label class="f">Label<input name="label" required placeholder="e.g. New young people reached"></label>
      <label class="f">Programme year<input type="number" name="year" min="1" value="1" required></label>
      <label class="f">Target<input type="number" name="target" min="0" step="0.1" required></label></div>
      <div class="fields">
      <label class="f">Who<select name="organisation_id"><option value="">Whole consortium</option>${partners.map((o) => html`<option value="${o.id}">${o.name}</option>`)}</select></label>
      <label class="f">Site<select name="site_id"><option value="">All sites</option>${ctx.sites.map((s) => html`<option value="${s.id}">${s.name}</option>`)}</select></label>
      <label class="f">Notes<input name="notes"></label></div>
      <div class="btns"><button class="btn">Add commitment</button></div></form>`);
    bindCm(d);
  });

  const again = () => agreements(ctx, el);

  $$('[data-open]').forEach((b) => b.addEventListener('click', () => openFile(b, 'documents', b.dataset.open)));

  $$('form.sign').forEach((f) => f.addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      must(await db.rpc('sign_schedule', { p_schedule: f.dataset.id, p_name: formData(f).signed_name }));
      toast('Signed.'); again();
    });
  }));

  function bindUpload(root) {
    $('#upload', root).addEventListener('submit', (e) => {
      e.preventDefault();
      act(e.submitter, async () => {
        const row = formData(e.target);
        const file = e.target.elements.file.files[0];
        const path = await uploadFile('documents', `${c.id}/${row.organisation_id || 'shared'}`, file);
        must(await db.from('documents').insert({
          consortium_id: c.id, organisation_id: row.organisation_id, kind: row.kind, title: row.title,
          storage_path: path, file_name: file.name, uploaded_by: ctx.user.id,
        }));
        toast('Uploaded.'); root.close(); again();
      });
    });
  }
  if (ctx.seesAll) {
    $$('[data-del-doc]').forEach((b) => b.addEventListener('click', () => act(b, async () => {
      if (b.dataset.path) await db.storage.from('documents').remove([b.dataset.path]);
      must(await db.from('documents').delete().eq('id', b.dataset.delDoc)); again();
    })));
  }

  function bindSched(root) {
    $('#new-sched', root).addEventListener('submit', (e) => {
      e.preventDefault();
      act(e.submitter, async () => { must(await db.from('partner_schedules').insert({ ...formData(e.target), consortium_id: c.id })); toast('Draft saved.'); root.close(); again(); });
    });
  }
  function bindCm(root) {
    $('#new-cm', root).addEventListener('submit', (e) => {
      e.preventDefault();
      act(e.submitter, async () => { must(await db.from('commitments').insert({ ...formData(e.target), consortium_id: c.id })); toast('Commitment added.'); root.close(); again(); });
    });
  }
  if (!ctx.manages) return;
  $$('[data-issue]').forEach((b) => b.addEventListener('click', () => act(b, async () => {
    must(await db.from('partner_schedules').update({ status: 'issued' }).eq('id', b.dataset.issue)); toast('Issued for signature.'); again();
  })));
  $$('[data-del-sched]').forEach((b) => b.addEventListener('click', () => act(b, async () => {
    must(await db.from('partner_schedules').delete().eq('id', b.dataset.delSched)); again();
  })));
  $$('[data-del-cm]').forEach((b) => b.addEventListener('click', () => act(b, async () => {
    must(await db.from('commitments').delete().eq('id', b.dataset.delCm)); again();
  })));
}
