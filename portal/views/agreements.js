// Agreements and commitments: the grant and consortium agreements, each
// partner's schedule (signed by the partner, countersigned by the accountable
// body) and the targets promised to the funder.
import { db, html, render, $, $$, formData, toast, act, must, fmtDate, fmtDateTime, fmtMoney, fmtNum, statusPill, MEASURE_LABEL } from '../lib.js';

const DOC_KIND = { grant_agreement: 'Grant agreement', consortium_agreement: 'Consortium agreement', partner_schedule: 'Partner schedule', policy: 'Policy', other: 'Other' };

export default async function agreements(ctx, el) {
  const c = ctx.consortium;
  const [docs, schedules, commitments] = await Promise.all([
    db.from('documents').select('*').eq('consortium_id', c.id).order('created_at', { ascending: false }).then(must),
    ctx.role === 'funder_observer' ? [] : db.from('partner_schedules').select('*').eq('consortium_id', c.id).order('created_at').then(must),
    db.from('commitments').select('*').eq('consortium_id', c.id).order('year').order('measure').then(must),
  ]);
  const partners = ctx.orgs.filter((o) => ['delivery_partner', 'accountable_body', 'lead'].includes(o.kind));
  const name = ctx.profile.full_name || '';

  const waiting = (s) => (s.status === 'issued' && ctx.role === 'partner_manager' && s.organisation_id === ctx.orgId)
    || (s.status === 'partner_signed' && ctx.role === 'accountable_body');

  render(el, html`
    <div class="page-head"><div><span class="eyebrow">Agreements and commitments</span><h1>What everyone has signed up to</h1></div></div>

    <section class="panel"><header><h2>Documents</h2></header>
      ${docs.length ? html`<div class="table-wrap"><table>
        <thead><tr><th>Document</th><th>Type</th><th>For</th><th>Added</th>${ctx.seesAll ? html`<th></th>` : ''}</tr></thead>
        <tbody>${docs.map((d) => html`<tr>
          <td>${d.storage_path ? html`<button class="linkbtn" data-open="${d.storage_path}">${d.title}</button>` : html`<strong>${d.title}</strong>`}</td>
          <td>${DOC_KIND[d.kind]}</td><td>${d.organisation_id ? ctx.org(d.organisation_id)?.name : 'Whole consortium'}</td>
          <td class="nowrap">${fmtDate(d.created_at)}</td>
          ${ctx.seesAll ? html`<td><button class="linkbtn small" data-del-doc="${d.id}" data-path="${d.storage_path || ''}">Remove</button></td>` : ''}
        </tr>`)}</tbody></table></div>` : html`<p class="empty">No documents yet.</p>`}
      ${ctx.seesAll ? html`<details class="add" style="margin-top:14px"><summary>Upload a document</summary>
        <form class="form" id="upload"><div class="fields">
          <label class="f">Title<input name="title" required></label>
          <label class="f">Type<select name="kind">${Object.entries(DOC_KIND).map(([k, v]) => html`<option value="${k}">${v}</option>`)}</select></label>
          <label class="f">Who can see it<select name="organisation_id"><option value="">Whole consortium</option>${partners.map((o) => html`<option value="${o.id}">${o.name} only</option>`)}</select></label></div>
          <label class="f">File<span class="hint">PDF or Word, up to 25MB.</span><input type="file" name="file" accept=".pdf,.doc,.docx,.xlsx,.odt" required></label>
          <div class="btns"><button class="btn">Upload</button></div></form></details>` : ''}
    </section>

    ${ctx.role !== 'funder_observer' ? html`<section class="panel" style="margin-top:20px"><header><h2>Partner schedules</h2></header>
      <p class="muted small">Each partner's targets, sites, days and budget. The partner signs, then the accountable body countersigns.</p>
      ${schedules.length ? html`<div class="stack" style="margin-top:14px">${schedules.map((s) => html`
        <article class="panel" style="background:var(--paper)">
          <header><h3>${ctx.org(s.organisation_id)?.name}: ${s.title}</h3>${statusPill(s.status)}</header>
          <dl class="facts" style="margin-top:12px">
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
            <button class="btn small secondary" data-del-sched="${s.id}">Delete draft</button></div>` : ''}
        </article>`)}</div>` : html`<p class="empty">No schedules yet.</p>`}
      ${ctx.manages ? html`<details class="add" style="margin-top:14px"><summary>Draft a schedule</summary>
        <form class="form" id="new-sched"><div class="fields">
          <label class="f">Partner<select name="organisation_id" required><option value="">Choose…</option>${partners.map((o) => html`<option value="${o.id}">${o.name}</option>`)}</select></label>
          <label class="f">Title<input name="title" value="Delivery schedule, year 1" required></label>
          <label class="f">Budget (£)<input type="number" name="budget" min="0"></label></div>
          <label class="f">Targets<textarea name="targets" placeholder="e.g. 150 young people reached, 33% targeted, 80 sessions"></textarea></label>
          <div class="fields"><label class="f">Sites<input name="sites"></label><label class="f">Delivery days<input name="delivery_days"></label></div>
          <div class="btns"><button class="btn">Save draft</button></div></form></details>` : ''}
    </section>` : ''}

    <section class="panel" style="margin-top:20px"><header><h2>Commitments to the funder</h2></header>
      <p class="muted small">The targets the dashboard tracks. Year 1 runs from ${fmtDate(c.start_date)}.</p>
      ${commitments.length ? html`<div class="table-wrap" style="margin-top:10px"><table>
        <thead><tr><th>Year</th><th>Measure</th><th>Who</th><th>Site</th><th class="num">Target</th>${ctx.manages ? html`<th></th>` : ''}</tr></thead>
        <tbody>${commitments.map((m) => html`<tr><td>${m.year}</td><td><strong>${m.label}</strong><br><span class="muted small">${MEASURE_LABEL[m.measure]}</span>${m.notes ? html`<br><span class="muted small">${m.notes}</span>` : ''}</td>
          <td>${m.organisation_id ? ctx.org(m.organisation_id)?.name : 'Whole consortium'}</td><td>${m.site_id ? ctx.site(m.site_id)?.name : '–'}</td>
          <td class="num">${fmtNum(m.target)}${m.measure === 'targeted_pct' ? '%' : ''}</td>
          ${ctx.manages ? html`<td><button class="linkbtn small" data-del-cm="${m.id}">Remove</button></td>` : ''}</tr>`)}</tbody></table></div>`
      : html`<p class="empty">No commitments yet.</p>`}
      ${ctx.manages ? html`<details class="add" style="margin-top:14px"><summary>Add a commitment</summary>
        <form class="form" id="new-cm"><div class="fields">
          <label class="f">Measure<select name="measure" required>${Object.entries(MEASURE_LABEL).map(([k, v]) => html`<option value="${k}">${v}</option>`)}</select></label>
          <label class="f">Label<input name="label" required placeholder="e.g. New young people reached"></label>
          <label class="f">Programme year<input type="number" name="year" min="1" value="1" required></label>
          <label class="f">Target<input type="number" name="target" min="0" step="0.1" required></label></div>
          <div class="fields">
          <label class="f">Who<select name="organisation_id"><option value="">Whole consortium</option>${partners.map((o) => html`<option value="${o.id}">${o.name}</option>`)}</select></label>
          <label class="f">Site<select name="site_id"><option value="">All sites</option>${ctx.sites.map((s) => html`<option value="${s.id}">${s.name}</option>`)}</select></label>
          <label class="f">Notes<input name="notes"></label></div>
          <div class="btns"><button class="btn">Add commitment</button></div></form></details>` : ''}
    </section>`);

  const again = () => agreements(ctx, el);

  // Open the tab during the click so pop-up blockers allow it, then point
  // it at a link that works for one minute.
  $$('[data-open]').forEach((b) => b.addEventListener('click', () => {
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    act(b, async () => {
      try {
        const { signedUrl } = must(await db.storage.from('documents').createSignedUrl(b.dataset.open, 60));
        if (tab) tab.location = signedUrl; else location.href = signedUrl;
      } catch (e) { tab?.close(); throw e; }
    });
  }));

  $$('form.sign').forEach((f) => f.addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      must(await db.rpc('sign_schedule', { p_schedule: f.dataset.id, p_name: formData(f).signed_name }));
      toast('Signed.'); again();
    });
  }));

  if (ctx.seesAll) {
    $('#upload').addEventListener('submit', (e) => {
      e.preventDefault();
      act(e.submitter, async () => {
        const row = formData(e.target);
        const file = e.target.elements.file.files[0];
        const safe = file.name.replace(/[^\w.\-]+/g, '_').slice(-80);
        const path = `${c.id}/${row.organisation_id || 'shared'}/${crypto.randomUUID()}-${safe}`;
        must(await db.storage.from('documents').upload(path, file, { contentType: file.type || undefined }));
        must(await db.from('documents').insert({
          consortium_id: c.id, organisation_id: row.organisation_id, kind: row.kind, title: row.title,
          storage_path: path, file_name: file.name, uploaded_by: ctx.user.id,
        }));
        toast('Uploaded.'); again();
      });
    });
    $$('[data-del-doc]').forEach((b) => b.addEventListener('click', () => act(b, async () => {
      if (b.dataset.path) await db.storage.from('documents').remove([b.dataset.path]);
      must(await db.from('documents').delete().eq('id', b.dataset.delDoc)); again();
    })));
  }

  if (!ctx.manages) return;
  $('#new-sched').addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => { must(await db.from('partner_schedules').insert({ ...formData(e.target), consortium_id: c.id })); toast('Draft saved.'); again(); });
  });
  $$('[data-issue]').forEach((b) => b.addEventListener('click', () => act(b, async () => {
    must(await db.from('partner_schedules').update({ status: 'issued' }).eq('id', b.dataset.issue)); toast('Issued for signature.'); again();
  })));
  $$('[data-del-sched]').forEach((b) => b.addEventListener('click', () => act(b, async () => {
    must(await db.from('partner_schedules').delete().eq('id', b.dataset.delSched)); again();
  })));
  $('#new-cm').addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => { must(await db.from('commitments').insert({ ...formData(e.target), consortium_id: c.id })); toast('Commitment added.'); again(); });
  });
  $$('[data-del-cm]').forEach((b) => b.addEventListener('click', () => act(b, async () => {
    must(await db.from('commitments').delete().eq('id', b.dataset.delCm)); again();
  })));
}
