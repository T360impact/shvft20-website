// Shared with us: the home of an associate organisation (a referral
// partner, site owner or staffing provider). Actions assigned to them or
// their organisation, documents shared with their organisation, and the
// published Summary. No targets, returns, finance or risks unless the
// consortium lead gives them a fuller role.
import { db, html, render, $$, must, act, toast, pill, fmtDate, sectionGroup, emptyState, openFile, today, live, liveMark } from '../lib.js';

export default async function shared(ctx, el) {
  const c = ctx.consortium;
  const [actions, docs] = await Promise.all([
    db.from('partner_actions').select('id, title, detail, due_date, status, organisation_id, assignee').eq('consortium_id', c.id).order('due_date', { ascending: true }).then(must),
    db.from('documents').select('id, title, kind, storage_path, created_at').eq('consortium_id', c.id).eq('organisation_id', ctx.orgId).order('created_at', { ascending: false }).then(must),
  ]);
  const open = actions.filter((a) => a.status === 'open');
  const done = actions.filter((a) => a.status === 'done');
  const again = () => shared(ctx, el);
  render(el, html`
    <div class="page-head"><div><span class="eyebrow">Shared with us</span><h1>${ctx.orgName || 'Your organisation'} in ${c.name}</h1>
      <p class="muted">What the consortium lead has shared with you and asked of you.</p><p style="margin-top:8px">${liveMark()}</p></div>
      <div class="btns"><a class="btn secondary" href="#/c/${c.id}/hub">The programme Summary</a></div></div>
    <div class="dgrid">
      <section class="dcard full"><header class="dcard-head"><h2>Actions for you</h2><p>Assigned to you or ${ctx.orgName || 'your organisation'}.</p></header>
        ${open.length ? html`<ul class="lw-list">${open.map((a) => html`<li class="lw-row static"><span class="lw-row-main"><strong>${a.title}</strong>
          ${a.detail ? html`<span class="small muted">${a.detail}</span>` : ''}</span>
          <span class="lw-row-tags">${a.due_date ? (a.due_date < today() ? pill('red', `Due ${fmtDate(a.due_date)}`, 'overdue') : pill('grey', `Due ${fmtDate(a.due_date)}`)) : ''}
            <button type="button" class="btn secondary small" data-done="${a.id}">Done</button></span></li>`)}</ul>` : emptyState('check', 'Nothing waiting on you.')}
        ${done.length ? sectionGroup({ title: 'Done', meta: `${done.length}`, body: html`<ul class="small">${done.map((a) => html`<li>${a.title}</li>`)}</ul>` }) : ''}</section>
      <section class="dcard full"><header class="dcard-head"><h2>Documents shared with you</h2></header>
        ${docs.length ? html`<ul class="lw-list">${docs.map((x) => html`<li class="lw-row static"><span class="lw-row-main"><strong>${x.title}</strong><span class="small muted">Shared ${fmtDate(x.created_at)}</span></span>
          <span class="lw-row-tags">${x.storage_path ? html`<button type="button" class="btn secondary small" data-open="${x.storage_path}">Open</button>` : ''}</span></li>`)}</ul>`
          : html`<p class="muted small">Nothing shared yet.</p>`}</section>
      <section class="dcard full"><header class="dcard-head"><h2>Your organisation</h2><p>Keep your profile and documents up to date; they're shared across every workspace you're in.</p></header>
        <p><a class="btn secondary" href="#/c/${c.id}/profile">Our profile</a></p></section>
    </div>`);
  $$('[data-done]', el).forEach((b) => b.addEventListener('click', () => act(b, async () => {
    must(await db.from('partner_actions').update({ status: 'done' }).eq('id', b.dataset.done)); toast('Done.'); again(); })));
  $$('[data-open]', el).forEach((b) => b.addEventListener('click', () => openFile(b, 'documents', b.dataset.open)));
  live(c.id, () => { if (!document.querySelector('dialog[open]')) again(); });
}
