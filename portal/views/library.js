// Library (Shvft2.0 staff only): every partner Shvft2.0 has worked with and
// their approved, in-date documents, plus the checklist templates new bids
// start from. Partners who have been through a bid before are asked only
// for what has lapsed or changed.
import { db, html, render, $, $$, formData, toast, act, must, fmtDate, daysUntil, openFile } from '../lib.js';

const docState = (d) => {
  const n = daysUntil(d.expires_on);
  if (n == null) return html`<span class="pill pill-approved">No expiry</span>`;
  if (n < 0) return html`<span class="pill pill-lost">Expired ${fmtDate(d.expires_on)}</span>`;
  if (n <= 60) return html`<span class="pill pill-returned">Expires ${fmtDate(d.expires_on)}</span>`;
  return html`<span class="pill pill-approved">Valid to ${fmtDate(d.expires_on)}</span>`;
};

export default async function library(el, [templateId] = []) {
  if (templateId) return template(el, templateId);
  const [partners, docs, orgs, templates] = await Promise.all([
    db.from('partners').select('*').order('name').then(must),
    db.from('partner_documents').select('*').order('title').then(must),
    db.from('organisations').select('id, partner_id, consortium_id, consortia(name, stage)').not('partner_id', 'is', null).then(must),
    db.from('bid_templates').select('id, name, description, bid_template_items(count)').order('name').then(must),
  ]);

  render(el, html`
    <div class="page-head"><div><span class="eyebrow">Library</span><h1>Partners and templates</h1>
      <p class="muted">Approved documents with an expiry date are kept here and reused in later bids until they lapse. Templates turn a funder's requirements into a ready-made checklist.</p></div></div>

    <section class="panel"><header><h2>Checklist templates</h2></header>
      ${templates.length ? html`<div class="table-wrap"><table><thead><tr><th>Template</th><th class="num">Items</th></tr></thead>
        <tbody>${templates.map((t) => html`<tr><td><a href="#/library/${t.id}">${t.name}</a>${t.description ? html`<br><span class="small muted">${t.description}</span>` : ''}</td>
          <td class="num">${t.bid_template_items?.[0]?.count ?? 0}</td></tr>`)}</tbody></table></div>` : html`<p class="empty">No templates yet.</p>`}
      <details class="add" style="margin-top:14px"><summary>New template</summary>
        <form class="form" id="new-t"><div class="fields">
          <label class="f">Name<input name="name" required placeholder="e.g. National Lottery Reaching Communities"></label>
          <label class="f">Description<input name="description"></label></div>
          <div class="btns"><button class="btn">Create template</button></div></form></details>
    </section>

    <section class="panel" style="margin-top:20px"><header><h2>Partners</h2></header>
      ${partners.length ? html`<div class="stack" style="margin-top:12px">${partners.map((p) => {
        const mine = docs.filter((d) => d.partner_id === p.id);
        const where = orgs.filter((o) => o.partner_id === p.id);
        return html`<article class="panel" style="background:var(--paper)">
          <header><h3>${p.name}</h3><span class="small muted">${[p.charity_number && `Charity ${p.charity_number}`, p.company_number && `Company ${p.company_number}`].filter(Boolean).join(' · ')}</span></header>
          <p class="small muted" style="margin-top:6px">${where.length ? `In: ${where.map((o) => o.consortia?.name).join(', ')}` : 'Not in a bid or consortium yet'}</p>
          ${mine.length ? html`<div class="table-wrap" style="margin-top:10px"><table><tbody>${mine.map((d) => html`<tr>
            <td><button class="linkbtn" data-file="${d.storage_path}">${d.title}</button><br><span class="small muted">${d.library_key}</span></td>
            <td>${docState(d)}</td><td class="small nowrap">Approved ${fmtDate(d.approved_at)}</td>
            <td><button class="linkbtn small" data-del-doc="${d.id}">Remove</button></td></tr>`)}</tbody></table></div>`
          : html`<p class="empty">No approved documents yet.</p>`}
        </article>`;
      })}</div>` : html`<p class="empty">No partners yet. They're added when you add an organisation to a bid or consortium.</p>`}
      <details class="add" style="margin-top:14px"><summary>Add a partner</summary>
        <form class="form" id="new-p"><div class="fields">
          <label class="f">Name<input name="name" required></label>
          <label class="f">Charity number<input name="charity_number"></label>
          <label class="f">Company number<input name="company_number"></label></div>
          <div class="btns"><button class="btn">Add partner</button></div></form></details>
    </section>`);

  const again = () => library(el, []);
  $$('[data-file]').forEach((b) => b.addEventListener('click', () => openFile(b, 'documents', b.dataset.file)));
  $$('[data-del-doc]').forEach((b) => b.addEventListener('click', () => act(b, async () => {
    must(await db.from('partner_documents').delete().eq('id', b.dataset.delDoc)); toast('Removed from the library.'); again();
  })));
  $('#new-t').addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      const row = must(await db.from('bid_templates').insert(formData(e.target)).select('id').single());
      location.hash = `#/library/${row.id}`;
    });
  });
  $('#new-p').addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => { must(await db.from('partners').insert(formData(e.target))); toast('Partner added.'); again(); });
  });
}

async function template(el, id) {
  const t = must(await db.from('bid_templates').select('*').eq('id', id).maybeSingle());
  if (!t) { render(el, html`<div class="panel">Template not found.</div>`); return; }
  const items = must(await db.from('bid_template_items').select('*').eq('template_id', id).order('position').order('name'));

  render(el, html`
    <p class="small" style="margin-bottom:10px"><a href="#/library">← Library</a></p>
    <div class="page-head"><div><span class="eyebrow">Checklist template</span><h1>${t.name}</h1>${t.description ? html`<p class="muted">${t.description}</p>` : ''}</div></div>
    <section class="panel">
      ${items.length ? html`<div class="table-wrap"><table>
        <thead><tr><th>Item</th><th>Who</th><th class="num">Due before deadline</th><th>Reuse</th><th></th></tr></thead>
        <tbody>${items.map((i) => html`<tr><td><strong>${i.name}</strong>${i.mandatory ? html` <span class="pill pill-mandatory">Required</span>` : ''}${i.description ? html`<br><span class="small muted">${i.description}</span>` : ''}</td>
          <td>${i.per_partner ? 'Every partner' : 'One organisation'}</td><td class="num">${i.days_before_deadline} days</td>
          <td class="small">${i.library_key ? `${i.library_key}${i.expires ? ', expires' : ''}` : '–'}</td>
          <td><button class="linkbtn small" data-del="${i.id}">Remove</button></td></tr>`)}</tbody></table></div>`
      : html`<p class="empty">No items yet.</p>`}
    </section>
    <section class="panel" style="margin-top:20px"><h2>Add an item</h2>
      <form class="form" id="add">
        <label class="f">Item<input name="name" required placeholder="e.g. Public liability insurance certificate"></label>
        <label class="f">What good looks like<textarea name="description" placeholder="e.g. Current certificate showing at least £5m cover, in the organisation's registered name."></textarea></label>
        <div class="fields">
          <label class="f">Due this many days before the deadline<input type="number" name="days_before_deadline" min="0" value="14" required></label>
          <label class="f">Order<input type="number" name="position" value="${items.length + 1}"></label>
          <label class="f">Library key<span class="hint">Same key across templates means the same document, e.g. insurance_pl. Leave blank for bid-specific items.</span><input name="library_key" pattern="[a-z0-9_]+"></label></div>
        <div class="checks">
          <label class="check"><input type="checkbox" name="mandatory" checked> Required for submission</label>
          <label class="check"><input type="checkbox" name="per_partner" checked> Ask every partner</label>
          <label class="check"><input type="checkbox" name="expires"> Has an expiry date</label></div>
        <div class="btns"><button class="btn">Add item</button></div></form>
    </section>
    <details class="add" style="margin-top:20px"><summary>Delete this template</summary>
      <p class="muted small" style="margin:10px 0">Bids already built from it keep their items.</p>
      <button class="btn danger" id="del-t">Delete template</button></details>`);

  const again = () => template(el, id);
  $('#add').addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      const f = formData(e.target);
      must(await db.from('bid_template_items').insert({ ...f, mandatory: !!f.mandatory, per_partner: !!f.per_partner, expires: !!f.expires, position: f.position ?? 0, template_id: id }));
      toast('Item added.'); again();
    });
  });
  $$('[data-del]').forEach((b) => b.addEventListener('click', () => act(b, async () => {
    must(await db.from('bid_template_items').delete().eq('id', b.dataset.del)); again();
  })));
  $('#del-t').addEventListener('click', (e) => act(e.currentTarget, async () => {
    must(await db.from('bid_templates').delete().eq('id', id)); location.hash = '#/library';
  }));
}
