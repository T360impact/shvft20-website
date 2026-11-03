// Rota per hub per date: a timeline of shifts and breaks, the floor
// headcount in 15 minute slots while the doors are open, and any slot below
// the minimum in amber with its exact time. Publishing is blocked until each
// gap is covered or the lead overrides with a reason. Cover requests mark a
// shift uncovered for bank staff and record who accepted.
import { html, raw, render, $, $$, db, must, act, toast, icon, pill, openDrawer, fmtDate, fmtDateTime, formData, today, emptyState } from '../../lib.js';
import { hubsOf, hubName, isLead } from './common.js';

// Picked hub, date and view survive a live refresh.
const ui = (ctx) => ctx.lwUi || (ctx.lwUi = {});

const mins = (t) => { const [h, m] = String(t).slice(0, 5).split(':').map(Number); return h * 60 + m; };
const hm = (t) => String(t || '').slice(0, 5);
const nextDelivery = (days) => { const d = new Date(); for (let i = 0; i < 8; i += 1) { const x = new Date(d); x.setDate(d.getDate() + i); if (days.includes(((x.getDay() + 6) % 7) + 1)) return x.toISOString().slice(0, 10); } return today(); };

export default async function rota(ctx, el, refresh) {
  const c = ctx.consortium.id;
  const hubs = hubsOf(ctx);
  if (!hubs.length) { render(el, emptyState('sites', 'Add a hub first. The lead does this under Team and hubs.')); return; }
  const state = ui(ctx)._rota || (ui(ctx)._rota = { hub: hubs[0].id, date: null });
  const hubRow = must(await db.from('hubs').select('id, delivery_days').eq('id', state.hub).maybeSingle());
  state.date = state.date || nextDelivery(hubRow?.delivery_days || [6]);

  const [r, staff] = await Promise.all([
    db.rpc('lw_rota', { p_consortium: c, p_hub: state.hub, p_date: state.date }).then(must),
    db.from('staff').select('id, name, role, hub_ids, status, is_bank').eq('consortium_id', c).neq('status', 'left').order('name').then(must),
  ]);
  const ids = staff.map((s) => s.id);
  const [recs, gate] = await Promise.all([ids.length ? db.from('recruitment').select('*').in('staff_id', ids).then(must) : [],
    // The database's own gate: a verified DBS on the portal counts, and is required where the workspace holds delivery roles.
    db.rpc('lw_staff_gate', { p_consortium: c }).then(must)]);
  const missing = (sid) => {
    const x = recs.find((q) => q.staff_id === sid);
    return [(gate[sid] || []).some((m) => m.startsWith('DBS')) ? 'DBS' : '', (x?.references_received || 0) < 2 ? `${x?.references_received || 0}/2 refs` : '',
      !x?.right_to_work_checked ? 'right to work' : '', !x?.induction_completed ? 'induction' : ''].filter(Boolean);
  };
  const shifts = r.shifts;
  const open = r.hours ? mins(r.hours.doors_open) : null;
  const close = r.hours ? mins(r.hours.doors_close) : null;
  const lo = Math.min(...shifts.map((s) => mins(s.start_time)), open ?? 600) - 30;
  const hi = Math.max(...shifts.map((s) => mins(s.end_time)), close ?? 1140) + 30;
  const pos = (t) => `${((mins(t) - lo) / (hi - lo)) * 100}%`;
  const width = (a, b) => `${((mins(b) - mins(a)) / (hi - lo)) * 100}%`;
  const hours = []; for (let h = Math.ceil(lo / 60); h * 60 <= hi; h += 1) hours.push(h);
  const gaps = r.gaps;
  const canEdit = r.can_publish;

  render(el, html`
    <div class="filters lw-filters">
      ${hubs.length > 1 ? html`<label class="f">Hub<select id="r-hub">${hubs.map((h) => html`<option value="${h.id}" ${raw(h.id === state.hub ? 'selected' : '')}>${h.name}</option>`)}</select></label>` : ''}
      <label class="f">Date<input type="date" id="r-date" value="${state.date}"></label>
      ${canEdit ? html`<button type="button" class="btn secondary small" id="hours">${r.hours ? `Doors ${hm(r.hours.doors_open)}–${hm(r.hours.doors_close)} · minimum ${r.minimum}` : 'Set doors open and close'}</button>` : ''}</div>
    ${!r.hours ? emptyState('sessions', `No session hours for ${hubName(ctx, state.hub)} on ${fmtDate(state.date)} yet. Set the doors open and close times to check the floor.`) : ''}
    <section class="panel"><header><h2>${hubName(ctx, state.hub)} · ${fmtDate(state.date)}</h2>
      <span>${r.published ? pill('green', `Published ${fmtDateTime(r.published.published_at)}`, 'approved') : pill('grey', 'Not published', 'waiting')}
        ${gaps.length ? pill('amber', `${gaps.length} slot${gaps.length === 1 ? '' : 's'} below ${r.minimum}`, 'overdue') : r.hours ? pill('green', `Five on the floor throughout`.replace('Five', String(r.minimum)), 'approved') : ''}</span></header>
      <div class="lw-timeline" role="img" aria-label="Shifts and breaks across the day">
        <div class="lw-tl-hours">${hours.map((h) => html`<span style="left:${pos(`${h}:00`)}">${h}:00</span>`)}</div>
        ${r.hours ? html`<div class="lw-tl-doors" style="left:calc(180px + (100% - 180px) * ${(mins(r.hours.doors_open) - lo) / (hi - lo)});width:calc((100% - 180px) * ${(close - open) / (hi - lo)})"><span>Doors open</span></div>` : ''}
        ${shifts.map((s) => html`<div class="lw-tl-row ${s.status}"><span class="lw-tl-name">${s.staff_name || 'Uncovered'}<span class="muted small">${s.role_on_shift || s.staff_role || ''}${s.on_floor ? '' : ' · off floor'}</span></span>
          <span class="lw-tl-track"><button type="button" class="lw-tl-bar ${s.on_floor ? '' : 'off'} ${s.status}" data-shift="${s.id}" style="left:${pos(s.start_time)};width:${width(s.start_time, s.end_time)}">
            ${hm(s.start_time)}–${hm(s.end_time)}${s.cover?.status === 'open' ? ' · cover asked' : ''}</button>
            ${s.break_start ? html`<span class="lw-tl-break" style="left:${pos(s.break_start)};width:${width(s.break_start, s.break_end)}" title="Break ${hm(s.break_start)}–${hm(s.break_end)}"></span>` : ''}</span></div>`)}
        ${r.slots.length ? html`<div class="lw-tl-row lw-tl-count"><span class="lw-tl-name">On the floor<span class="muted small">minimum ${r.minimum}</span></span>
          <span class="lw-tl-track">${r.slots.map((s) => html`<span class="lw-slot ${s.short ? 'short' : ''}" style="left:${pos(s.time)};width:${width('00:00', '00:15')}" title="${s.time}: ${s.on_floor} on the floor">${s.on_floor}</span>`)}</span></div>` : ''}
      </div>
      ${gaps.length ? html`<div class="lead-banner lw-gaps"><span><strong>The floor drops below ${r.minimum} at ${gaps.map((g) => g.time).join(', ')}.</strong> Stagger the breaks, add a shift, or ask for cover.</span></div>` : ''}
      ${canEdit ? html`<div class="btns"><button class="btn secondary" id="add-shift">${raw(icon('add', 16))}Add shift</button>
        <button class="btn" id="publish" ${raw(gaps.length && !isLead(ctx) ? 'disabled' : '')}>${r.published ? 'Publish again' : 'Publish to staff'}</button></div>
        ${gaps.length && !isLead(ctx) ? html`<p class="small muted">Cover each gap to publish. Only the lead can publish with a gap, giving a reason.</p>` : ''}` : ''}
      ${r.published?.override_reason ? html`<p class="small muted">Published with ${r.published.gaps.length} gap${r.published.gaps.length === 1 ? '' : 's'}: ${r.published.override_reason}</p>` : ''}
    </section>`);

  $('#r-hub', el)?.addEventListener('change', (e) => { state.hub = e.target.value; state.date = null; rota(ctx, el, refresh); });
  $('#r-date', el).addEventListener('change', (e) => { state.date = e.target.value || today(); rota(ctx, el, refresh); });
  const again = () => rota(ctx, el, refresh);

  $('#hours', el)?.addEventListener('click', () => {
    const d = openDrawer('Session hours', html`<form class="form" id="h-form"><p class="muted small">${hubName(ctx, state.hub)} · ${fmtDate(state.date)}</p>
      <div class="fields"><label class="f">Doors open<input type="time" name="open" required value="${hm(r.hours?.doors_open) || '11:00'}"></label>
        <label class="f">Doors close<input type="time" name="close" required value="${hm(r.hours?.doors_close) || '18:00'}"></label></div>
      <label class="f">Minimum on the floor <span class="muted small">(blank uses the workspace's ${r.minimum})</span><input type="number" min="1" max="50" name="min" value="${r.hours?.min_on_floor || ''}"></label>
      <div class="btns"><button class="btn">Save</button></div></form>`);
    $('#h-form', d).addEventListener('submit', (e) => {
      e.preventDefault();
      act(e.submitter, async () => {
        const f = formData(e.target);
        must(await db.from('hub_session_hours').upsert({ consortium_id: c, hub_id: state.hub, session_date: state.date, doors_open: f.open, doors_close: f.close, min_on_floor: f.min ? Number(f.min) : null }, { onConflict: 'hub_id,session_date' }));
        d.close(); again();
      });
    });
  });

  const shiftForm = (s = {}) => html`<form class="form" id="s-form">
    <label class="f">Who<select name="staff_id" required><option value="">Choose</option>${staff.map((p) => { const m = missing(p.id); return html`<option value="${p.id}" ${raw(p.id === s.staff_id ? 'selected' : '')} ${raw(m.length ? 'disabled' : '')}>${p.name} · ${p.role}${p.is_bank ? ' · bank' : ''}${m.length ? ` (missing ${m.join(', ')})` : ''}</option>`; })}</select></label>
    <p class="small muted">People can only be rostered once DBS, two references, right to work and induction are all done. A verified DBS on the portal counts.</p>
    <div class="fields"><label class="f">Start<input type="time" name="start" required value="${hm(s.start_time) || '10:00'}"></label><label class="f">End<input type="time" name="end" required value="${hm(s.end_time) || '19:00'}"></label></div>
    <div class="fields"><label class="f">Break from<input type="time" name="bs" value="${hm(s.break_start)}"></label><label class="f">Break to<input type="time" name="be" value="${hm(s.break_end)}"></label></div>
    <label class="f">Role on shift<input name="role" maxlength="120" value="${s.role_on_shift || ''}" placeholder="For example Youth Coach"></label>
    <label class="check"><input type="checkbox" name="floor" ${raw(s.on_floor !== false ? 'checked' : '')}> Counts on the floor</label>
    <div class="btns"><button class="btn">${s.id ? 'Save' : 'Add shift'}</button>
      ${s.id ? html`<button type="button" class="btn secondary" id="cover">Ask for cover</button><button type="button" class="btn secondary" id="cancel">Remove shift</button>` : ''}</div></form>`;
  const readShift = (f) => ({ staff_id: f.staff_id, start_time: f.start, end_time: f.end, break_start: f.bs || null, break_end: f.be || null, role_on_shift: f.role || null, on_floor: !!f.floor });

  $('#add-shift', el)?.addEventListener('click', () => {
    const d = openDrawer('Add a shift', shiftForm());
    $('#s-form', d).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => {
      must(await db.from('shifts').insert({ consortium_id: c, hub_id: state.hub, shift_date: state.date, ...readShift(formData(e.target)) })); d.close(); again(); }); });
  });
  $$('[data-shift]', el).forEach((b) => b.addEventListener('click', () => {
    const s = shifts.find((x) => x.id === b.dataset.shift);
    if (!canEdit) return;
    if (s.status === 'uncovered') { coverDrawer(s); return; }
    const d = openDrawer(`${s.staff_name || 'Shift'} · ${hm(s.start_time)}–${hm(s.end_time)}`, shiftForm(s));
    $('#s-form', d).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => {
      must(await db.from('shifts').update(readShift(formData(e.target))).eq('id', s.id)); d.close(); again(); }); });
    $('#cancel', d).addEventListener('click', (e) => act(e.target, async () => { must(await db.from('shifts').update({ status: 'cancelled' }).eq('id', s.id)); d.close(); again(); }));
    $('#cover', d).addEventListener('click', () => {
      d.close();
      const d2 = openDrawer('Ask for cover', html`<form class="form" id="c-form"><p>${s.staff_name}'s shift, ${hm(s.start_time)}–${hm(s.end_time)}, becomes uncovered. Bank staff see it on their own shifts page and can take it.</p>
        <label class="f">Note for bank staff <span class="muted small">(optional)</span><input name="note" maxlength="500"></label>
        <div class="btns"><button class="btn">Ask for cover</button></div></form>`);
      $('#c-form', d2).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => {
        must(await db.rpc('lw_cover_request', { p_shift: s.id, p_note: formData(e.target).note || null })); d2.close(); toast('Cover requested.'); again(); }); });
    });
  }));

  const coverDrawer = (s) => {
    const bank = staff.filter((p) => p.is_bank && p.status === 'active' && !missing(p.id).length);
    const d = openDrawer('Record who is covering', html`<form class="form" id="a-form"><p>Uncovered ${hm(s.start_time)}–${hm(s.end_time)}${s.cover?.note ? ` · ${s.cover.note}` : ''}</p>
      <label class="f">Who accepted<select name="staff" required><option value="">Choose</option>${(bank.length ? bank : staff.filter((p) => !missing(p.id).length)).map((p) => html`<option value="${p.id}">${p.name}${p.is_bank ? ' · bank' : ''}</option>`)}</select></label>
      <div class="btns"><button class="btn">Record</button></div></form>`);
    $('#a-form', d).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => {
      must(await db.rpc('lw_cover_accept', { p_request: s.cover.id, p_staff: formData(e.target).staff })); d.close(); toast('Cover recorded.'); again(); }); });
  };

  $('#publish', el)?.addEventListener('click', () => {
    if (!gaps.length) { act($('#publish', el), async () => { must(await db.rpc('lw_rota_publish', { p_hub: state.hub, p_date: state.date })); toast('Published. Staff see their own shifts.'); again(); }); return; }
    const d = openDrawer('Publish with gaps', html`<form class="form" id="o-form"><p>The floor drops below ${r.minimum} at <strong>${gaps.map((g) => g.time).join(', ')}</strong>.</p>
      <label class="f">Why it is safe to publish anyway<textarea name="reason" required rows="3" maxlength="1000"></textarea></label>
      <div class="btns"><button class="btn">Publish with this reason</button></div></form>`);
    $('#o-form', d).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => {
      must(await db.rpc('lw_rota_publish', { p_hub: state.hub, p_date: state.date, p_override_reason: formData(e.target).reason })); d.close(); toast('Published with your reason recorded.'); again(); }); });
  });
}

// A member of staff's own published shifts, and open cover if they are bank staff.
export async function myShifts(ctx, el) {
  const me = must(await db.rpc('lw_my_shifts', { p_consortium: ctx.consortium.id }));
  if (!me.staff) { render(el, emptyState('sessions', 'You are not on the staff list for this workspace.')); return; }
  render(el, html`<div class="grid2">
    <section class="panel"><header><h2>My shifts</h2><span class="muted small">Published rotas only</span></header>
      ${me.shifts.length ? html`<ul class="lw-list">${me.shifts.map((s) => html`<li class="lw-row static"><span class="lw-row-main"><strong>${fmtDate(s.date)} · ${s.hub}</strong>
        <span class="muted small">${hm(s.start)}–${hm(s.end)}${s.break_start ? ` · break ${hm(s.break_start)}–${hm(s.break_end)}` : ''}${s.role ? ` · ${s.role}` : ''}</span></span></li>`)}</ul>` : emptyState('sessions', 'No published shifts yet.')}
      ${me.missing?.length ? html`<p class="small warn-text">Before you can be rostered: ${me.missing.join('; ')}.</p>` : ''}</section>
    ${me.staff.is_bank ? html`<section class="panel"><header><h2>Cover needed</h2></header>
      ${me.cover.length ? html`<ul class="lw-list">${me.cover.map((s) => html`<li class="lw-row static"><span class="lw-row-main"><strong>${fmtDate(s.date)} · ${s.hub}</strong>
        <span class="muted small">${hm(s.start)}–${hm(s.end)}${s.note ? ` · ${s.note}` : ''}</span></span><button class="btn small" data-take="${s.id}">Take it</button></li>`)}</ul>` : emptyState('check', 'No cover needed right now.')}</section>` : ''}</div>`);
  $$('[data-take]', el).forEach((b) => b.addEventListener('click', () => act(b, async () => {
    must(await db.rpc('lw_cover_accept', { p_request: b.dataset.take })); toast('The shift is yours.'); myShifts(ctx, el);
  })));
}
