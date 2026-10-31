// Bid readiness: the checklist of everything the bid needs, who owns each
// item, and how close the bid is to being submittable. Partners see only
// their own items plus the bid's overall percentage; the lead sees all,
// reviews uploads and converts the workspace when the bid is won.
import { db, html, raw, render, $, $$, formData, toast, act, must, icon, pill, duePill, countdown, statCard, emptyState, fmtDate, fmtDateTime, fmtMoney, statusPill, daysUntil, uploadFile, openFile, today } from '../lib.js';
import { chart, ring, stackedBars } from '../charts.js';

// Standard reasons for returning an item, so the same quality bar applies
// to every partner and every bid.
const STANDARDS = [
  'Attendances are presented as unique young people. Show each young person once and count visits separately.',
  'Some participants are outside the eligible age range.',
  'Delivery hours or days conflict with the agreed delivery model.',
  'The document is out of date or has expired.',
  'It isn\'t signed and dated.',
  'The organisation name doesn\'t match your registered name.',
];

const dueText = (d, status) => {
  if (!d) return '';
  if (status === 'approved') return fmtDate(d);
  const n = daysUntil(d);
  return n < 0 ? `${fmtDate(d)} · ${-n} day${n === -1 ? '' : 's'} overdue` : n === 0 ? `${fmtDate(d)} · due today` : `${fmtDate(d)} · in ${n} day${n === 1 ? '' : 's'}`;
};
// Blocking (mandatory, not approved) first, then overdue, then by due date.
const rank = (i) => [i.mandatory && i.status !== 'approved' ? 0 : 1, i.status === 'approved' ? 1 : 0, i.due_on || '9999'];
const byRank = (a, b) => { const x = rank(a); const y = rank(b); return x[0] - y[0] || x[1] - y[1] || x[2].localeCompare(y[2]); };

export default async function bid(ctx, el, [itemId]) {
  if (itemId) return item(ctx, el, itemId);
  const c = ctx.consortium;
  const [items, summary, templates] = await Promise.all([
    db.from('bid_items').select('*').eq('consortium_id', c.id).then(must),
    db.rpc('bid_summary', { p_consortium: c.id }).then(must),
    ctx.manages ? db.from('bid_templates').select('id, name').order('name').then(must) : [],
  ]);
  items.sort(byRank);
  const mine = items.filter((i) => i.organisation_id === ctx.orgId);
  const open = c.stage === 'bid';
  const decidable = ['bid', 'submitted'].includes(c.stage);
  const owners = ctx.orgs.filter((o) => ['lead', 'accountable_body', 'delivery_partner'].includes(o.kind));

  // Items as a table on a desktop and cards on a phone; due dates and
  // statuses as pills.
  const itemTable = (rows, showOrg) => html`<div class="table-wrap"><table class="cards">
    <thead><tr><th>Item</th>${showOrg ? html`<th>Owner</th>` : ''}<th>Due</th><th>Status</th></tr></thead>
    <tbody>${rows.map((i) => html`<tr class="${i.mandatory && i.status !== 'approved' ? 'blocking' : ''}">
      <td><a href="#/c/${c.id}/bid/${i.id}">${i.name}</a>${i.mandatory ? html` ${pill('grey', 'Required')}` : ''}
        ${i.status === 'returned' && i.review_comment ? html`<br><span class="small muted">${i.review_comment}</span>` : ''}</td>
      ${showOrg ? html`<td data-label="Owner">${ctx.org(i.organisation_id)?.name}</td>` : ''}
      <td data-label="Due">${duePill(i.due_on, i.status) || html`<span class="muted small">No date</span>`}</td><td data-label="Status">${statusPill(i.status)}</td></tr>`)}</tbody></table></div>`;

  // Items by status for each organisation (the lead's view).
  const KEYS = [['approved', 'Approved'], ['submitted', 'Submitted'], ['returned', 'Returned'], ['requested', 'Requested']];
  const perOrg = owners.map((o) => {
    const theirs = items.filter((i) => i.organisation_id === o.id);
    return { o, total: theirs.length, open: theirs.filter((i) => i.status !== 'approved').length, segs: KEYS.map(([key, label]) => ({ key, label, n: theirs.filter((i) => i.status === key).length })) };
  }).filter((r) => r.total).sort((a, b) => b.open - a.open);
  const pct = summary.pct ?? 0;

  render(el, html`
    <div class="page-head"><div><span class="eyebrow m-bids">${raw(icon('bids', 16))}${c.stage === 'live' ? 'Bid record' : 'Bid workspace'} · ${c.funder || 'Funder to confirm'}</span><h1>${c.name}</h1>
      <p style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">${statusPill(c.stage)}${open ? countdown(c.bid_deadline) : ''}
        ${c.bid_deadline ? html`<span class="small muted">Deadline ${fmtDate(c.bid_deadline)}${c.grant_value ? ` · ${fmtMoney(c.grant_value)}` : ''}</span>` : ''}</p></div>
      ${ctx.manages && open ? html`<div class="btns"><a class="btn" href="#add-item-card">${raw(icon('add', 18))}Add item</a></div>` : ''}</div>

    <div class="grid2 split" style="grid-template-columns:minmax(0,1fr) minmax(0,2fr)">
      <section class="panel m-bids" style="display:grid;justify-items:center;gap:12px;text-align:center">
        ${ring(pct, { size: 168, stroke: 16, color: 'var(--progress)', track: 'var(--track)', label: 'required approved' })}
        <p class="small muted">${summary.blocking ? `${summary.blocking} required item${summary.blocking === 1 ? '' : 's'} still open` : 'Every required item is approved'}</p></section>
      <div class="stats">
        ${statCard({ icon: 'requirements', mod: 'bids', value: summary.blocking, label: 'Required items open', trend: summary.blocking ? { dir: 'flat', tone: 'amber', text: 'Blocks submission' } : { dir: 'up', tone: 'green', text: 'Ready' } })}
        ${statCard({ icon: 'overdue', mod: 'bids', value: summary.overdue, label: 'Overdue', trend: summary.overdue ? { dir: 'down', tone: 'red', text: 'Chase these first' } : { dir: 'flat', tone: 'green', text: 'None overdue' } })}
        ${ctx.seesAll ? statCard({ icon: 'submitted', mod: 'bids', value: items.filter((i) => i.status === 'submitted').length, label: 'Waiting for your review' }) : ''}
      </div></div>
    ${summary.blocking && open ? html`<div class="banner warn" style="margin-top:24px">${raw(icon('overdue', 20))}<span><strong>Not yet eligible to submit.</strong> Any open required item could make the application ineligible.</span></div>` : ''}

    ${!ctx.seesAll ? html`<section class="panel m-bids section"><header><h2>${raw(icon('requirements', 20))}${ctx.orgName}'s items</h2></header>
      <p class="helper">Upload against each item; the lead approves it or returns it with a comment.</p>
      ${mine.length ? itemTable(mine, false) : emptyState('requirements', `Nothing has been asked of ${ctx.orgName} yet.`, '', 'bids')}</section>` : ''}

    ${ctx.seesAll && perOrg.length ? html`<section class="panel m-bids section"><header><h2>${raw(icon('partners', 20))}By organisation</h2></header>
      ${chart(perOrg[0].open ? `${perOrg[0].o.name} has the most open items: ${perOrg[0].open} of ${perOrg[0].total}.` : 'Every organisation\'s items are approved.',
        'Items by status for each organisation', stackedBars(perOrg.map((r) => ({ label: r.o.name, value: `${r.total - r.open} of ${r.total} approved`, segs: r.segs })), KEYS))}</section>` : ''}

    ${ctx.seesAll ? html`<section class="panel m-bids section"><header><h2>${raw(icon('requirements', 20))}Every item</h2>
      <label class="f" style="min-width:200px"><span class="sr-only">Show</span><select id="filter">
        <option value="">Everything</option><option value="open">Still open</option><option value="submitted">Waiting for review</option>
        ${owners.map((o) => html`<option value="${o.id}">${o.name}</option>`)}</select></label></header>
      ${items.length ? html`<div id="all-items">${itemTable(items, true)}</div>` : emptyState('requirements', 'No items yet. Start from a template or add one.', '', 'bids')}
    </section>` : ''}

    ${c.eligibility_rules ? html`<section class="panel m-compliance section"><h2>${raw(icon('compliance', 20))}Eligibility rules</h2><p class="prose">${c.eligibility_rules}</p></section>` : ''}

    ${ctx.manages && open ? html`<div class="grid2 section">
      <section class="panel m-bids"><h2>${raw(icon('requirements', 20))}Start from a template</h2>
        ${templates.length ? html`<form class="form" id="apply"><div class="fields">
          <label class="f">Template<select name="template" required>${templates.map((t) => html`<option value="${t.id}">${t.name}</option>`)}</select></label>
          <label class="f">One-off items go to<select name="owner" required>${owners.map((o) => html`<option value="${o.id}" ${o.kind === 'lead' ? 'selected' : ''}>${o.name}</option>`)}</select></label></div>
          <details class="learn"><summary>${raw(icon('info', 16))}Learn more</summary><p>Per-partner items go to every delivery partner and the accountable body. Anything already approved and in date in the library is reused.</p></details>
          <div class="btns"><button class="btn">${raw(icon('add', 18))}Add checklist</button></div></form>`
        : emptyState('library', 'No templates yet.', html`<a class="btn secondary" href="#/library">${raw(icon('library', 18))}Library</a>`, 'bids')}
      </section>
      <section class="panel m-bids" id="add-item-card"><h2>${raw(icon('add', 20))}Add an item</h2>
        <form class="form" id="add-item">
          <label class="f">Item<input name="name" required placeholder="e.g. Site agreement"></label>
          <label class="f">What good looks like<textarea name="description"></textarea></label>
          <div class="fields">
            <label class="f">Owner<select name="organisation_id" required>${owners.map((o) => html`<option value="${o.id}">${o.name}</option>`)}</select></label>
            <label class="f">Due<input type="date" name="due_on" max="${c.bid_deadline || ''}"></label></div>
          <label class="check"><input type="checkbox" name="mandatory" checked> Required for submission</label>
          <label class="f">Example file<span class="hint">Optional. The partner can download it.</span><input type="file" name="example"></label>
          <div class="btns"><button class="btn">${raw(icon('add', 18))}Add item</button></div></form>
      </section></div>` : ''}

    ${ctx.manages ? html`<section class="panel m-governance section"><h2>${raw(icon('governance', 20))}Outcome</h2>
      ${open ? html`<div class="banner info" style="margin-bottom:16px">${raw(icon('submitted', 20))}<span>Once the application has gone in, mark it submitted. Every partner must have confirmed their targets and budget first.
        <span class="btns" style="margin-top:12px;display:flex"><button class="btn small" type="button" id="submitted">${raw(icon('submitted', 16))}Mark submitted</button></span></span></div>` : ''}
      ${decidable ? html`<p class="helper">If won, this workspace becomes the consortium and everything carries across.</p>
        <form class="form" id="won" style="margin-top:16px"><div class="fields">
          <label class="f">Programme starts<input type="date" name="start" required></label>
          <label class="f">Programme ends<input type="date" name="end" required></label></div>
          <div class="btns"><button class="btn">${raw(icon('approved', 18))}We won</button><button class="btn secondary" type="button" id="lost">We didn't win</button></div></form>`
      : c.stage === 'lost' ? html`<p class="muted">Marked as not won${c.decided_at ? ` on ${fmtDate(c.decided_at)}` : ''}. Everything stays on file.</p>
        <div class="btns" style="margin-top:12px"><button class="btn secondary" id="reopen-bid">${raw(icon('returned', 18))}Reopen bid</button></div>`
      : html`<p class="muted">Won and converted${c.decided_at ? ` on ${fmtDate(c.decided_at)}` : ''}. This is the record of what went in.</p>`}
    </section>` : ''}`);

  const again = () => bid(ctx, el, []);
  $('#filter')?.addEventListener('change', (e) => {
    const v = e.target.value;
    const rows = items.filter((i) => !v || (v === 'open' ? i.status !== 'approved' : v === 'submitted' ? i.status === 'submitted' : i.organisation_id === v));
    render($('#all-items'), itemTable(rows, true));
  });
  $('#apply')?.addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      const f = formData(e.target);
      const res = must(await db.rpc('apply_bid_template', { p_consortium: c.id, p_template: f.template, p_owner: f.owner }));
      toast(`${res.created} items added${res.reused ? `, ${res.reused} reused from the library` : ''}.`);
      again();
    });
  });
  $('#add-item')?.addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      const f = formData(e.target);
      const file = e.target.elements.example.files[0];
      const example_path = file ? await uploadFile('library', `examples/${c.id}`, file) : null;
      must(await db.from('bid_items').insert({ consortium_id: c.id, organisation_id: f.organisation_id, name: f.name, description: f.description,
        due_on: f.due_on, mandatory: !!f.mandatory, example_path }));
      toast('Item added.'); again();
    });
  });
  $('#won')?.addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      const f = formData(e.target);
      must(await db.rpc('convert_bid', { p_consortium: c.id, p_start: f.start, p_end: f.end }));
      toast('Congratulations. The consortium is open.');
      await ctx.reload();
      location.hash = `#/c/${c.id}/hub`;
    });
  });
  $('#lost')?.addEventListener('click', (e) => act(e.currentTarget, async () => {
    must(await db.rpc('close_bid', { p_consortium: c.id, p_outcome: 'lost' })); toast('Marked as not won. Everything stays on file.'); await ctx.reload();
  }));
  $('#submitted')?.addEventListener('click', (e) => act(e.currentTarget, async () => {
    must(await db.rpc('mark_bid_submitted', { p_consortium: c.id })); toast('Marked as submitted.'); await ctx.reload();
  }));
  $('#reopen-bid')?.addEventListener('click', (e) => act(e.currentTarget, async () => {
    must(await db.rpc('close_bid', { p_consortium: c.id, p_outcome: 'bid' })); await ctx.reload();
  }));
}

async function item(ctx, el, id) {
  const c = ctx.consortium;
  const i = must(await db.from('bid_items').select('*').eq('id', id).maybeSingle());
  if (!i) { render(el, html`<div class="panel">That item isn't available to you.</div>`); return; }
  const [versions, events] = await Promise.all([
    db.from('bid_item_versions').select('*').eq('item_id', id).order('version', { ascending: false }).then(must),
    db.from('bid_item_events').select('*').eq('item_id', id).order('created_at', { ascending: false }).then(must),
  ]);
  const owner = i.organisation_id === ctx.orgId;
  const canUpload = (owner || ctx.manages) && i.status !== 'approved' && c.stage !== 'lost';

  render(el, html`
    <p class="small" style="margin-bottom:10px"><a href="#/c/${c.id}/bid">← Bid readiness</a></p>
    <div class="page-head"><div><span class="eyebrow">${ctx.org(i.organisation_id)?.name}</span><h1>${i.name}</h1>
      <p style="margin-top:8px">${statusPill(i.status)} ${i.mandatory ? html`<span class="pill pill-mandatory">Required</span>` : ''}
        ${i.due_on ? html` <span class="muted small">Due ${dueText(i.due_on, i.status)}</span>` : ''}</p></div></div>
    ${i.status === 'returned' && i.review_comment ? html`<div class="banner warn" style="margin-bottom:20px"><strong>Returned:</strong> ${i.review_comment}</div>` : ''}
    ${i.status === 'approved' && i.review_comment ? html`<div class="banner info" style="margin-bottom:20px">${i.review_comment}</div>` : ''}
    <div class="grid2">
      <section class="panel"><h2>What good looks like</h2>
        <p class="prose">${i.description || 'No guidance added.'}</p>
        ${i.example_path ? html`<div class="btns" style="margin-top:14px"><button class="btn small secondary" id="example">Download the example</button></div>` : ''}
        ${i.expires ? html`<p class="muted small" style="margin-top:12px">Once approved, this goes into ${ctx.org(i.organisation_id)?.name}'s library and is reused in future bids until it expires.</p>` : ''}
      </section>
      ${canUpload ? html`<section class="panel"><h2>${versions.length ? 'Upload a new version' : 'Upload'}</h2>
        <form class="form" id="upload">
          <label class="f">File<input type="file" name="file" required></label>
          <label class="f">Note for the lead<span class="hint">Optional, for example what changed since the last version.</span><textarea name="note"></textarea></label>
          <div class="btns"><button class="btn">Submit for review</button></div></form></section>` : ''}
      ${ctx.manages && i.status === 'submitted' ? html`<section class="panel"><h2>Review version ${versions[0]?.version}</h2>
        <form class="form" id="review">
          <label class="f">Comment<span class="hint">Needed when you return it. Say exactly what needs changing.</span><textarea name="comment" id="comment"></textarea></label>
          <div class="quick-picks">${STANDARDS.map((s) => html`<button type="button" data-pick="${s}">${s}</button>`)}</div>
          ${i.expires ? html`<label class="f">Expires on<span class="hint">Needed to approve. The library uses it to decide when to ask again.</span><input type="date" name="expires_on" min="${today()}"></label>` : ''}
          <div class="btns"><button class="btn" value="approved">Approve</button><button class="btn secondary" value="returned">Return with comments</button></div>
        </form></section>` : ''}
      ${ctx.manages && i.status === 'approved' && c.stage === 'bid' ? html`<section class="panel"><h2>Reopen</h2>
        <form class="form" id="reopen"><label class="f">Why<input name="comment" placeholder="e.g. the funder has changed the template"></label>
        <div class="btns"><button class="btn secondary">Ask for a new version</button></div></form></section>` : ''}
    </div>
    <div class="grid2" style="margin-top:20px">
      <section class="panel"><h2>Versions</h2>
        ${versions.length ? html`<div class="table-wrap"><table><thead><tr><th>Version</th><th>File</th><th>Uploaded</th></tr></thead>
          <tbody>${versions.map((v) => html`<tr><td>${v.version}${v.version === versions[0].version && i.status === 'approved' ? html` <span class="pill pill-approved">Approved</span>` : ''}</td>
            <td><button class="linkbtn" data-file="${v.storage_path}">${v.file_name || 'Download'}</button>${v.note ? html`<br><span class="small muted">${v.note}</span>` : ''}</td>
            <td class="small nowrap">${fmtDateTime(v.uploaded_at)}</td></tr>`)}</tbody></table></div>`
        : html`<p class="empty">Nothing uploaded yet.</p>`}
      </section>
      <section class="panel"><h2>History</h2>
        ${events.length ? html`<ul class="history">${events.map((e) => html`<li><strong>${{ uploaded: `Version ${e.version} uploaded`, returned: `Version ${e.version} returned`, approved: `Version ${e.version} approved`, reused: 'Reused from the library', reopened: 'Reopened' }[e.action]}</strong>
          <span class="small muted"> · ${fmtDateTime(e.created_at)}</span>${e.comment ? html`<br><span class="small">${e.comment}</span>` : ''}</li>`)}</ul>`
        : html`<p class="empty">Nothing yet.</p>`}
      </section>
    </div>
    ${ctx.manages && c.stage === 'bid' ? html`<details class="add" style="margin-top:20px"><summary>Edit or remove this item</summary>
      <form class="form" id="edit-item">
        <label class="f">Item<input name="name" value="${i.name}" required></label>
        <label class="f">What good looks like<textarea name="description">${i.description || ''}</textarea></label>
        <div class="fields"><label class="f">Due<input type="date" name="due_on" value="${i.due_on || ''}"></label>
          <label class="f">Owner<select name="organisation_id">${ctx.orgs.map((o) => html`<option value="${o.id}" ${o.id === i.organisation_id ? 'selected' : ''}>${o.name}</option>`)}</select></label></div>
        <label class="check"><input type="checkbox" name="mandatory" ${i.mandatory ? 'checked' : ''}> Required for submission</label>
        <div class="btns"><button class="btn">Save</button><button class="btn danger" type="button" id="del-item">Remove item</button></div>
      </form></details>` : ''}`);

  const again = () => item(ctx, el, id);
  $('#example')?.addEventListener('click', (e) => openFile(e.currentTarget, 'library', i.example_path));
  $$('[data-file]').forEach((b) => b.addEventListener('click', () => openFile(b, 'documents', b.dataset.file)));
  $$('[data-pick]').forEach((b) => b.addEventListener('click', () => {
    const box = $('#comment');
    box.value = box.value ? `${box.value}\n${b.dataset.pick}` : b.dataset.pick;
    box.focus();
  }));
  $('#upload')?.addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      const f = formData(e.target);
      const path = await uploadFile('documents', `${c.id}/items/${id}`, e.target.elements.file.files[0]);
      must(await db.rpc('submit_bid_item', { p_item: id, p_path: path, p_file_name: e.target.elements.file.files[0].name, p_note: f.note }));
      toast('Submitted for review.'); again();
    });
  });
  $('#review')?.addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      const f = formData(e.target);
      must(await db.rpc('review_bid_item', { p_item: id, p_decision: e.submitter.value, p_comment: f.comment, p_expires_on: f.expires_on || null }));
      toast(e.submitter.value === 'approved' ? 'Approved.' : 'Returned with your comments.'); again();
    });
  });
  $('#reopen')?.addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => { must(await db.rpc('reopen_bid_item', { p_item: id, p_comment: formData(e.target).comment })); toast('Reopened.'); again(); });
  });
  $('#edit-item')?.addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      const f = formData(e.target);
      must(await db.from('bid_items').update({ name: f.name, description: f.description, due_on: f.due_on, organisation_id: f.organisation_id, mandatory: !!f.mandatory }).eq('id', id));
      toast('Saved.'); again();
    });
  });
  $('#del-item')?.addEventListener('click', (e) => act(e.currentTarget, async () => {
    must(await db.from('bid_items').delete().eq('id', id));
    location.hash = `#/c/${c.id}/bid`;
  }));
}
