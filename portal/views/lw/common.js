// Lead Workspace: the parts every page shares. The page header with its
// tabs, the people and roles a task can belong to, task rows and the task
// drawer, and the live refresh on the workspace's private signal.
import { db, html, raw, render, $, $$, must, act, toast, icon, pill, openDrawer, fmtDate, fmtDateTime, formData, today,
  live, liveMark, daysUntil } from '../../lib.js';

export const ROLE = { lead: 'Lead', operations_lead: 'Operations lead', hub_lead: 'Hub lead', hub_staff: 'Hub staff', coordinator: 'Coordinator' };
export const TASK_STATUS = { not_started: 'Not started', in_progress: 'In progress', done: 'Done', blocked: 'Blocked', not_done: 'Not done' };
export const TASK_TONE = { not_started: 'grey', in_progress: 'blue', done: 'green', blocked: 'amber', not_done: 'red' };
export const RHYTHM = { saturday_before: 'Before opening', saturday_during: 'While open', saturday_close: 'At close', weekly: 'Weekly', monthly: 'Monthly', termly: 'Termly' };
export const RAG_LABEL = { green: 'On track', amber: 'Behind', red: 'Well behind', grey: 'No profile yet' };

export const base = (ctx) => `#/c/${ctx.consortium.id}/lw`;
export const lw = (ctx) => ctx.lw || { roles: [] };
export const isSenior = (ctx) => !!lw(ctx).senior;
export const isWide = (ctx) => !!lw(ctx).wide;
export const isLead = (ctx) => !!lw(ctx).lead;
export const hubName = (ctx, id) => (lw(ctx).hubs || []).find((h) => h.id === id)?.name || '';
export const hubsOf = (ctx) => lw(ctx).hubs || [];

// Owners are people on the lead team or a role. Values are "p:<id>" or "r:<role>".
export const personName = (ctx, id) => (lw(ctx).team || []).find((p) => p.user_id === id)?.name || '';
export function ownerText(ctx, t) {
  if (t.owner_profile_id) return personName(ctx, t.owner_profile_id) || t.owner_label || 'Someone on the team';
  if (t.owner_role) return ROLE[t.owner_role];
  return t.owner_label || 'Unassigned';
}
export const ownerValue = (t) => (t.owner_profile_id ? `p:${t.owner_profile_id}` : t.owner_role ? `r:${t.owner_role}` : '');
export const ownerFields = (v) => ({ owner_profile_id: v.startsWith('p:') ? v.slice(2) : null, owner_role: v.startsWith('r:') ? v.slice(2) : null });
export const ownerSelect = (ctx, name, value = '') => html`<select name="${name}">
  <option value="">Unassigned</option>
  <optgroup label="People">${(lw(ctx).team || []).map((p) => html`<option value="p:${p.user_id}" ${raw(value === `p:${p.user_id}` ? 'selected' : '')}>${p.name} · ${p.roles.map((r) => ROLE[r]).join(', ')}</option>`)}</optgroup>
  <optgroup label="Roles">${Object.entries(ROLE).map(([k, v]) => html`<option value="r:${k}" ${raw(value === `r:${k}` ? 'selected' : '')}>${v}</option>`)}</optgroup></select>`;
export const hubSelect = (ctx, name, value = '', { any = true, label = 'Whole workspace' } = {}) => html`<select name="${name}">
  ${any && isWide(ctx) ? html`<option value="">${label}</option>` : ''}
  ${hubsOf(ctx).map((h) => html`<option value="${h.id}" ${raw(value === h.id ? 'selected' : '')}>${h.name}</option>`)}</select>`;

export const dueTag = (d, done) => {
  if (!d) return html`<span class="muted small">No date</span>`;
  if (done) return html`<span class="muted small">${fmtDate(d)}</span>`;
  const n = daysUntil(d);
  if (n < 0) return pill('red', `${-n}d overdue`, 'overdue');
  if (n <= 7) return pill('amber', n === 0 ? 'Today' : fmtDate(d), 'due');
  return html`<span class="muted small">${fmtDate(d)}</span>`;
};
export const statusTag = (s) => pill(TASK_TONE[s] || 'grey', TASK_STATUS[s] || s);
export const ragTag = (r) => pill(r || 'grey', RAG_LABEL[r] || 'No profile yet', { green: 'approved', amber: 'overdue', red: 'rejected' }[r] || 'waiting');

// Header: eyebrow, title, who you are here, live mark, and the area tabs.
export function header(ctx, area, title, sub = '', actions = '') {
  const b = base(ctx);
  const roles = lw(ctx).roles.map((r) => ROLE[r]).join(', ') || 'Staff';
  const tabs = [['week', 'This week'], ['operations', 'Operations'], ['consortium', 'Consortium'], ['todo', 'To do']]
    .filter(([k]) => lw(ctx).roles.length || k === 'mine');
  if (isSenior(ctx)) tabs.push(['plans', 'Plans']);
  if (isLead(ctx)) tabs.push(['team', 'Team and hubs']);
  return html`<div class="page-head lw-head"><div><span class="eyebrow">Lead Workspace · private to the lead team</span><h1>${title}</h1>
      <p class="meta-line">${sub ? html`${sub} · ` : ''}You: ${roles}</p><p style="margin-top:8px">${liveMark()}</p></div>
      ${actions ? html`<div class="btns">${actions}</div>` : ''}</div>
    ${lw(ctx).roles.length ? html`<nav class="tabs lw-tabs" aria-label="Lead Workspace">${tabs.map(([k, label]) => html`<a href="${b}/${k}" aria-selected="${String(area === k)}">${label}</a>`)}</nav>` : ''}`;
}

// Second-level links in a segmented bar (Operations and Consortium pages).
export const subNav = (href, items, active) => html`<nav class="seg lw-sub" aria-label="Sections">${items.map(([k, label]) => html`<a class="seg-btn" href="${href}/${k}" aria-pressed="${String(k === active)}">${label}</a>`)}</nav>`;

// Reload the page when anything in the workspace's Lead Workspace changes,
// but never while someone is typing or a drawer is open.
export function liveRefresh(ctx, rerender) {
  live(ctx.consortium.id, () => {
    const busy = document.querySelector('dialog[open]') || (document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName));
    if (busy) return;
    rerender();
  }, 'lw_pings');
}

// ------------------------------------------------------------------ tasks

export const taskRow = (ctx, t) => html`<li><button type="button" class="lw-row" data-task="${t.id}">
  <span class="lw-row-main"><strong>${t.title}</strong>
    <span class="muted small">${ownerText(ctx, t)}${t.assigned_how === 'auto' ? ' (allocated automatically)' : ''}${t.hub_id ? ` · ${hubName(ctx, t.hub_id)}` : ''}${t.delegated ? ' · delegated' : ''}${t.meeting_id ? ' · meeting action' : ''}</span></span>
  <span class="lw-row-tags">${!t.owner_profile_id && !t.owner_role && !['done', 'not_done'].includes(t.status) ? pill('amber', 'Unassigned') : ''}${t.visibility === 'lead_only' ? html`<span class="lw-lock" title="Lead and operations lead only">${raw(icon('safeguarding', 14))}</span>` : ''}
    ${dueTag(t.due_date, ['done', 'not_done'].includes(t.status))}${statusTag(t.status)}</span></button></li>`;

// Add or edit a task. Hub roles can only place it at their own hub.
export function taskForm(ctx, t = {}, defaults = {}) {
  const v = { tracker: 'operations', ...defaults, ...t };
  return html`<form class="form" id="task-form">
    <label class="f">What needs doing<input name="title" required maxlength="200" value="${v.title || ''}"></label>
    <label class="f">Detail <span class="muted small">(optional)</span><textarea name="detail" rows="3" maxlength="4000">${v.detail || ''}</textarea></label>
    <div class="fields">
      <label class="f">Tracker<select name="tracker"><option value="operations" ${raw(v.tracker === 'operations' ? 'selected' : '')}>Operations</option>
        <option value="consortium" ${raw(v.tracker === 'consortium' ? 'selected' : '')}>Consortium</option>
        <option value="todo" ${raw(v.tracker === 'todo' ? 'selected' : '')}>To do</option></select></label>
      <label class="f">Area<input name="area" maxlength="80" value="${v.area || ''}" placeholder="For example Hiring" list="lw-areas"></label></div>
    <div class="fields"><label class="f">Owner${ownerSelect(ctx, 'owner', ownerValue(v))}</label>
      <label class="f">Hub${hubSelect(ctx, 'hub_id', v.hub_id || '')}</label></div>
    <div class="fields"><label class="f">Due<input type="date" name="due_date" value="${v.due_date || ''}"></label>
      ${isSenior(ctx) ? html`<label class="f">Who can see it<select name="visibility"><option value="team">The lead team</option>
        <option value="lead_only" ${raw(v.visibility === 'lead_only' ? 'selected' : '')}>Lead and operations lead only</option></select></label>` : ''}</div>
    <label class="f">Source <span class="muted small">(optional: the plan section, meeting or email it came from)</span><input name="source_reference" maxlength="300" value="${v.source_reference || ''}"></label>
    <p class="small muted">Never write young people's names, dates of birth, contact details or health details here. The portal refuses them.</p>
    <div class="btns"><button class="btn">${t.id ? 'Save' : 'Add task'}</button></div></form>`;
}

export function readTaskForm(form, ctx) {
  const f = formData(form);
  return {
    title: f.title.trim(), detail: f.detail?.trim() || null, tracker: f.tracker, area: f.area?.trim() || null,
    ...ownerFields(f.owner || ''), hub_id: f.hub_id || null, due_date: f.due_date || null,
    ...(isSenior(ctx) ? { visibility: f.visibility || 'team' } : {}), source_reference: f.source_reference?.trim() || null,
  };
}

export function addTask(ctx, defaults, done) {
  const d = openDrawer('Add a task', taskForm(ctx, {}, defaults));
  $('#task-form', d).addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      must(await db.from('tasks').insert({ consortium_id: ctx.consortium.id, ...defaults, ...readTaskForm(e.target, ctx) }));
      d.close(); toast('Task added.'); done();
    });
  });
}

// A task's detail: update its status with a note, see its history, edit it.
export async function openTask(ctx, id, done) {
  const [t, hist] = await Promise.all([
    db.from('tasks').select('*').eq('id', id).maybeSingle().then(must),
    db.from('task_updates').select('*').eq('task_id', id).order('created_at', { ascending: false }).then(must),
  ]);
  if (!t) { toast('That task is no longer available.', 'error'); return; }
  const who = (pid) => personName(ctx, pid) || 'Someone';
  const d = openDrawer(t.title, html`
    <div class="kv-list">
      <p>${statusTag(t.status)} ${dueTag(t.due_date, ['done', 'not_done'].includes(t.status))} ${t.visibility === 'lead_only' ? pill('grey', 'Lead only', 'safeguarding') : ''}</p>
      ${t.detail ? html`<p class="prose">${t.detail}</p>` : ''}
      <p class="small muted">${ownerText(ctx, t)}${t.owner_label && (t.owner_profile_id || t.owner_role) ? ` (plan says: ${t.owner_label})` : ''}
        ${t.hub_id ? ` · ${hubName(ctx, t.hub_id)}` : ''} · ${t.tracker === 'consortium' ? 'Consortium' : 'Operations'}${t.area ? ` · ${t.area}` : ''}
        ${t.due_text ? html`<br>Plan date: “${t.due_text}”` : ''}${t.source_reference ? html`<br>Source: ${t.source_reference}` : ''}</p>
      ${t.reason ? html`<p class="small"><strong>Reason:</strong> ${t.reason}</p>` : ''}</div>
    <form class="form lw-assign" id="as-form"><label class="f">Assign to${ownerSelect(ctx, 'owner', ownerValue(t))}</label>
      <button class="btn secondary small">Assign</button></form>
    ${t.assigned_how === 'auto' ? html`<p class="small muted">Allocated automatically from the plan's “${t.owner_label}”.</p>` : ''}
    <form class="form" id="upd-form"><fieldset><legend>Update</legend>
      <div class="seg" role="radiogroup">${Object.entries(TASK_STATUS).map(([k, v]) => html`<label class="seg-btn lw-radio"><input type="radio" name="status" value="${k}" ${raw(k === t.status ? 'checked' : '')}>${v}</label>`)}</div>
      <label class="f" id="reason-f">Why <span class="muted small">(needed for not done)</span><input name="reason" maxlength="1000" value="${t.reason || ''}"></label>
      <label class="f">Note <span class="muted small">(optional)</span><input name="note" maxlength="2000"></label></fieldset>
      <div class="btns"><button class="btn">Save update</button><button type="button" class="btn secondary" id="edit">Edit task</button>
        ${isSenior(ctx) ? html`<button type="button" class="btn secondary" id="del">Delete</button>` : ''}</div></form>
    ${sectionHistory(hist, who)}`);
  $('#as-form', d).addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      const o = ownerFields(formData(e.target).owner || '');
      must(await db.rpc('lw_assign_tasks', { p_tasks: [id], p_owner_profile: o.owner_profile_id, p_owner_role: o.owner_role }));
      d.close(); toast(o.owner_profile_id || o.owner_role ? 'Assigned.' : 'Unassigned.'); done();
    });
  });
  const reasonF = $('#reason-f', d);
  const syncReason = () => { const s = $('input[name=status]:checked', d)?.value; reasonF.hidden = !['blocked', 'not_done'].includes(s); };
  $$('input[name=status]', d).forEach((r) => r.addEventListener('change', syncReason));
  syncReason();
  $('#upd-form', d).addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      const f = formData(e.target);
      must(await db.rpc('lw_task_update', { p_task: id, p_status: f.status !== t.status ? f.status : null, p_reason: f.reason || null, p_note: f.note || null }));
      if (f.status === t.status && f.reason !== (t.reason || '') && ['blocked', 'not_done'].includes(f.status)) must(await db.from('tasks').update({ reason: f.reason }).eq('id', id));
      d.close(); toast('Updated.'); done();
    });
  });
  $('#edit', d).addEventListener('click', () => {
    d.close();
    const e2 = openDrawer('Edit task', taskForm(ctx, t));
    $('#task-form', e2).addEventListener('submit', (ev) => {
      ev.preventDefault();
      act(ev.submitter, async () => { must(await db.from('tasks').update(readTaskForm(ev.target, ctx)).eq('id', id)); e2.close(); toast('Saved.'); done(); });
    });
  });
  $('#del', d)?.addEventListener('click', (e) => act(e.target, async () => {
    if (e.target.dataset.sure !== '1') { e.target.dataset.sure = '1'; e.target.textContent = 'Delete for good?'; return; }
    must(await db.from('tasks').delete().eq('id', id)); d.close(); toast('Deleted.'); done();
  }));
}

const sectionHistory = (hist, who) => (hist.length ? html`<details class="lw-history"><summary>History (${hist.length})</summary><ol class="rows">${hist.map((h) => html`<li>
  <span class="small"><strong>${h.to_status ? (h.from_status ? `${TASK_STATUS[h.from_status]} → ${TASK_STATUS[h.to_status]}` : `Added as ${TASK_STATUS[h.to_status].toLowerCase()}`) : 'Note'}</strong>
  · ${who(h.author_id)} · ${fmtDateTime(h.created_at)}</span>${h.note ? html`<br><span class="small">${h.note}</span>` : ''}</li>`)}</ol></details>` : '');

// Bind every [data-task] button under a root to its drawer.
export function bindTasks(root, ctx, done) {
  $$('[data-task]', root).forEach((b) => b.addEventListener('click', () => openTask(ctx, b.dataset.task, done).catch((e) => toast(e.message, 'error'))));
}

// Small ring for checklist completion: green for ticked, amber for not done.
export function miniRing(ticked, notDone, total, size = 44) {
  const r = (size - 6) / 2; const c = 2 * Math.PI * r;
  const a = total ? ticked / total : 0; const b = total ? notDone / total : 0;
  const pct = total ? Math.round(((ticked + notDone) / total) * 100) : 0;
  return html`<span class="lw-ring" style="width:${size}px;height:${size}px" role="img" aria-label="${total ? `${ticked} of ${total} ticked, ${notDone} not done` : 'No checklist'}">
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--grey-tint)" stroke-width="6"/>
    ${total ? raw(`<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--green)" stroke-width="6" stroke-dasharray="${a * c} ${c}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--amber)" stroke-width="6" stroke-dasharray="${b * c} ${c}" stroke-dashoffset="${-a * c}" transform="rotate(-90 ${size / 2} ${size / 2})"/>`) : ''}</svg>
    <b>${total ? `${pct}${size >= 56 ? '%' : ''}` : '–'}</b></span>`;
}

export { today, fmtDate, fmtDateTime, render, html, raw, db, must, act, toast, $, $$, icon, pill, openDrawer, formData };
