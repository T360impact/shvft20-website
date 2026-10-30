// Consortium hub: who is in the consortium, key dates, the funder's
// requirements and the delivery model by site. The lead keeps it up to date.
import { db, html, render, $, $$, formData, toast, act, must, fmtDate, fmtMoney, KIND_LABEL, today } from '../lib.js';

export default async function hub(ctx, el) {
  const c = ctx.consortium;
  const [dates, measures] = await Promise.all([
    db.from('key_dates').select('*').eq('consortium_id', c.id).order('due_on').then(must),
    db.from('outcome_measures').select('*').eq('consortium_id', c.id).order('code').then(must),
  ]);
  const byKind = (k) => ctx.orgs.filter((o) => o.kind === k).map((o) => o.name).join(', ') || '–';
  const upcoming = dates.filter((d) => d.due_on >= today());
  const past = dates.filter((d) => d.due_on < today());

  render(el, html`
    <div class="page-head"><div><span class="eyebrow">Consortium</span><h1>${c.name}</h1>
      ${c.description ? html`<p class="muted">${c.description}</p>` : ''}</div></div>
    ${!c.allow_real_records ? html`<div class="banner warn" style="margin-bottom:20px"><strong>Demo mode.</strong> Use made-up young people only until the data protection impact assessment and data processing agreements are signed.</div>` : ''}
    <div class="grid2">
      <section class="panel"><h2>Overview</h2>
        <dl class="facts">
          <dt>Funder</dt><dd>${c.funder || '–'}</dd>
          <dt>Programme</dt><dd>${c.programme || '–'}</dd>
          ${ctx.role !== 'youth_voice' ? html`<dt>Grant value</dt><dd>${fmtMoney(c.grant_value) || '–'}</dd>` : ''}
          <dt>Runs</dt><dd>${fmtDate(c.start_date)} to ${fmtDate(c.end_date)}</dd>
          <dt>Lead</dt><dd>${byKind('lead')}</dd>
          <dt>Accountable body</dt><dd>${byKind('accountable_body')}</dd>
          <dt>Delivery partners</dt><dd>${byKind('delivery_partner')}</dd>
          <dt>Ages</dt><dd>${c.min_age} to ${c.max_age}</dd>
          ${c.targeted_share_target != null ? html`<dt>Targeted share</dt><dd>${c.targeted_share_target}% of young people reached</dd>` : ''}
        </dl>
      </section>
      <section class="panel"><h2>Key dates</h2>
        ${upcoming.length ? html`<div class="table-wrap"><table><tbody>${upcoming.map((d) => html`
          <tr><td class="nowrap">${fmtDate(d.due_on)}</td><td><strong>${d.title}</strong>${d.notes ? html`<br><span class="muted small">${d.notes}</span>` : ''}</td>
          ${ctx.manages ? html`<td><button class="linkbtn small" data-del-date="${d.id}">Remove</button></td>` : ''}</tr>`)}
        </tbody></table></div>` : html`<p class="empty">No upcoming dates.</p>`}
        ${past.length ? html`<details style="margin-top:10px"><summary class="small muted">${past.length} past date${past.length > 1 ? 's' : ''}</summary>
          <ul class="small muted">${past.map((d) => html`<li>${fmtDate(d.due_on)}: ${d.title}</li>`)}</ul></details>` : ''}
        ${ctx.manages ? html`<details class="add" style="margin-top:14px"><summary>Add a date</summary>
          <form class="form" id="add-date"><div class="fields">
            <label class="f">What<input name="title" required></label>
            <label class="f">Date<input type="date" name="due_on" required></label></div>
            <label class="f">Notes<input name="notes"></label>
            <div class="btns"><button class="btn">Add date</button></div></form></details>` : ''}
      </section>
    </div>

    <section class="panel" style="margin-top:20px"><header><h2>Partners and contacts</h2></header>
      <div class="table-wrap"><table>
        <thead><tr><th>Organisation</th><th>Role</th><th>Contact</th>${ctx.seesAll ? html`<th class="num">Budget</th>` : ''}${ctx.manages ? html`<th></th>` : ''}</tr></thead>
        <tbody>${ctx.orgs.map((o) => html`<tr>
          <td><strong>${o.name}</strong></td><td>${KIND_LABEL[o.kind]}</td>
          <td>${o.contact_name || ''}${o.contact_email ? html`<br><a href="mailto:${o.contact_email}">${o.contact_email}</a>` : ''}${o.contact_phone ? html`<br>${o.contact_phone}` : ''}</td>
          ${ctx.seesAll ? html`<td class="num">${fmtMoney(o.budget)}</td>` : ''}
          ${ctx.manages ? html`<td><button class="linkbtn small" data-edit-org="${o.id}">Edit</button></td>` : ''}
        </tr>`)}</tbody></table></div>
      ${ctx.manages ? html`<details class="add" id="org-box" style="margin-top:14px"><summary id="org-summary">Add an organisation</summary>
        <form class="form" id="org-form"><input type="hidden" name="id">
          <div class="fields">
            <label class="f">Name<input name="name" required></label>
            <label class="f">Role<select name="kind" required>${Object.entries(KIND_LABEL).map(([k, v]) => html`<option value="${k}">${v}</option>`)}</select></label>
            <label class="f">Budget (£)<input type="number" name="budget" min="0" step="1"></label>
          </div>
          <div class="fields">
            <label class="f">Contact name<input name="contact_name"></label>
            <label class="f">Contact email<input type="email" name="contact_email"></label>
            <label class="f">Contact phone<input type="tel" name="contact_phone"></label>
          </div>
          <div class="btns"><button class="btn">Save organisation</button></div></form></details>` : ''}
    </section>

    <section class="panel" style="margin-top:20px"><header><h2>Delivery model by site</h2></header>
      ${ctx.sites.length ? html`<div class="table-wrap"><table>
        <thead><tr><th>Site</th><th>Run by</th><th>Area</th><th>Days</th><th>Notes</th>${ctx.manages ? html`<th></th>` : ''}</tr></thead>
        <tbody>${ctx.sites.map((s) => html`<tr><td><strong>${s.name}</strong></td><td>${ctx.org(s.organisation_id)?.name || '–'}</td>
          <td>${s.area || ''}</td><td>${s.delivery_days || ''}</td><td class="small">${s.notes || ''}</td>
          ${ctx.manages ? html`<td><button class="linkbtn small" data-del-site="${s.id}">Remove</button></td>` : ''}</tr>`)}</tbody></table></div>`
      : html`<p class="empty">No sites yet.</p>`}
      ${ctx.manages ? html`<details class="add" style="margin-top:14px"><summary>Add a site</summary>
        <form class="form" id="add-site"><div class="fields">
          <label class="f">Site name<input name="name" required></label>
          <label class="f">Run by<select name="organisation_id"><option value="">Choose…</option>${ctx.orgs.map((o) => html`<option value="${o.id}">${o.name}</option>`)}</select></label>
          <label class="f">Area<input name="area"></label>
          <label class="f">Delivery days<input name="delivery_days" placeholder="e.g. Tue and Thu evenings"></label></div>
          <label class="f">Notes<input name="notes"></label>
          <div class="btns"><button class="btn">Add site</button></div></form></details>` : ''}
    </section>

    <div class="grid2" style="margin-top:20px">
      <section class="panel"><h2>Funder's requirements</h2>
        <p class="prose">${c.funder_requirements || 'Not added yet.'}</p></section>
      <section class="panel"><h2>Delivery model</h2>
        <p class="prose">${c.delivery_model || 'Not added yet.'}</p></section>
    </div>

    <div class="grid2" style="margin-top:20px">
      <section class="panel"><h2>Outcome framework</h2>
        ${measures.length ? html`<ul>${measures.map((m) => html`<li><strong>${m.label}</strong>${m.description ? html` <span class="muted small">${m.description}</span>` : ''}${m.active ? '' : html` <span class="muted small">(retired)</span>`}</li>`)}</ul>`
        : html`<p class="empty">Not agreed yet. Partners can't record outcomes until it is.</p>`}
        ${ctx.manages ? html`<details class="add" style="margin-top:14px"><summary>Add an outcome</summary>
          <form class="form" id="add-measure"><div class="fields">
            <label class="f">Short code<input name="code" required placeholder="e.g. CONF"></label>
            <label class="f">Outcome<input name="label" required></label></div>
            <label class="f">How it's measured<input name="description"></label>
            <div class="btns"><button class="btn">Add outcome</button></div></form></details>` : ''}
      </section>
      <section class="panel"><h2>Who counts as targeted</h2>
        ${c.targeted_criteria.length ? html`<ul>${c.targeted_criteria.map((t) => html`<li>${t}</li>`)}</ul>` : html`<p class="empty">Not agreed yet.</p>`}
      </section>
    </div>

    ${ctx.manages ? html`<details class="add" style="margin-top:20px"><summary>Edit consortium details</summary>
      <form class="form" id="edit-c">
        <div class="fields">
          <label class="f">Name<input name="name" value="${c.name}" required></label>
          <label class="f">Funder<input name="funder" value="${c.funder || ''}"></label>
          <label class="f">Programme<input name="programme" value="${c.programme || ''}"></label>
          <label class="f">Grant value (£)<input type="number" name="grant_value" value="${c.grant_value ?? ''}" min="0"></label>
        </div>
        <div class="fields">
          <label class="f">Starts<input type="date" name="start_date" value="${c.start_date}" required></label>
          <label class="f">Ends<input type="date" name="end_date" value="${c.end_date}" required></label>
          <label class="f">Youngest age<input type="number" name="min_age" value="${c.min_age}" min="0" max="30" required></label>
          <label class="f">Oldest age<input type="number" name="max_age" value="${c.max_age}" min="0" max="30" required></label>
          <label class="f">Targeted share (%)<input type="number" name="targeted_share_target" value="${c.targeted_share_target ?? ''}" min="0" max="100" step="0.1"></label>
        </div>
        <label class="f">Summary<textarea name="description">${c.description || ''}</textarea></label>
        <label class="f">Funder's requirements<textarea name="funder_requirements">${c.funder_requirements || ''}</textarea></label>
        <label class="f">Delivery model<textarea name="delivery_model">${c.delivery_model || ''}</textarea></label>
        <label class="f">Who counts as targeted<span class="hint">One per line. These become the options when a young person is registered.</span>
          <textarea name="targeted_criteria">${c.targeted_criteria.join('\n')}</textarea></label>
        <div class="btns"><button class="btn">Save details</button></div>
      </form></details>` : ''}`);

  if (!ctx.manages) return;

  $('#add-date').addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => { must(await db.from('key_dates').insert({ ...formData(e.target), consortium_id: c.id })); toast('Date added.'); hub(ctx, el); });
  });
  $$('[data-del-date]').forEach((b) => b.addEventListener('click', () => act(b, async () => {
    must(await db.from('key_dates').delete().eq('id', b.dataset.delDate)); hub(ctx, el);
  })));

  const orgForm = $('#org-form');
  $$('[data-edit-org]').forEach((b) => b.addEventListener('click', () => {
    const o = ctx.org(b.dataset.editOrg);
    for (const k of ['id', 'name', 'kind', 'budget', 'contact_name', 'contact_email', 'contact_phone']) orgForm.elements[k].value = o[k] ?? '';
    $('#org-summary').textContent = `Edit ${o.name}`;
    $('#org-box').open = true;
    orgForm.elements.name.focus();
  }));
  orgForm.addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      const { id, ...row } = formData(orgForm);
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

  $('#add-measure').addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      const row = formData(e.target);
      must(await db.from('outcome_measures').insert({ ...row, code: row.code.toUpperCase(), consortium_id: c.id }));
      toast('Outcome added.'); hub(ctx, el);
    });
  });

  $('#edit-c').addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      const row = formData(e.target);
      row.targeted_criteria = (row.targeted_criteria || '').split('\n').map((s) => s.trim()).filter(Boolean);
      must(await db.from('consortia').update(row).eq('id', c.id));
      toast('Details saved.');
      await ctx.reload();
    });
  });
}
