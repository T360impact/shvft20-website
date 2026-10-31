// Notifications: the portal's own list of what has happened for you (returns
// due or sent back, payments, actions and risks assigned, documents
// expiring, chases). The same notices go by email, straight away or as a
// digest, as set under Account.
import { db, html, raw, render, $, $$, must, act, toast, icon, openDrawer, fmtDateTime } from '../lib.js';

export async function unreadCount() {
  const { count } = await db.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null);
  return count || 0;
}

export async function openNotifications(onChange) {
  const rows = must(await db.from('notifications').select('*').order('created_at', { ascending: false }).limit(60));
  const unread = rows.filter((n) => !n.read_at);
  const d = openDrawer('Notifications', html`
    ${unread.length ? html`<div class="btns"><button type="button" class="btn secondary small" id="read-all">Mark all as read</button></div>` : ''}
    ${rows.length ? html`<ul class="lw-list notif-list">${rows.map((n) => html`<li><a class="lw-row ${n.read_at ? '' : 'unread'}" href="${n.link || '#/'}" data-n="${n.id}">
      <span class="lw-row-main"><strong>${n.title}</strong>${n.body ? html`<span class="small">${n.body}</span>` : ''}<span class="muted small">${fmtDateTime(n.created_at)}</span></span>
      ${n.read_at ? '' : html`<span class="notif-dot" aria-label="Unread"></span>`}</a></li>`)}</ul>` : html`<p class="muted">Nothing yet.</p>`}
    <p class="small muted">Choose how often these come by email under Account.</p>`);
  $$('[data-n]', d).forEach((a) => a.addEventListener('click', async () => {
    await db.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', a.dataset.n);
    d.close(); onChange?.();
  }));
  $('#read-all', d)?.addEventListener('click', (e) => act(e.target, async () => {
    must(await db.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null));
    toast('All read.'); d.close(); onChange?.();
  }));
}

export const notifIcon = (n) => html`${raw(icon('info', 20))}<span>Notifications${n ? html` <b class="notif-count">${n}</b>` : ''}</span>`;
