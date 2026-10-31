// People compliance: the recruitment pipeline as a board by stage with the
// plan's target dates, the training matrix (green complete, amber expiring
// within 60 days, red missing or expired), and monthly supervision.
// Statuses and dates only: never certificate, passport or ID numbers.
import { html, raw, render, $, $$, db, must, act, toast, icon, pill, openDrawer, fmtDate, formData, today, emptyState, sectionGroup, segControl, bindSegments } from '../../lib.js';
import { hubsOf, hubName, isSenior, isLead, lw, ROLE } from './common.js';

// Picked hub, date and view survive a live refresh.
const ui = (ctx) => ctx.lwUi || (ctx.lwUi = {});

const STAGES = [['briefed', 'Briefed'], ['shortlisted', 'Shortlisted'], ['interviewed', 'Interviewed'], ['offered', 'Offered'], ['checks', 'Checks'], ['inducted', 'Inducted'], ['active', 'Active']];
const DBS = { not_started: 'Not started', applied: 'Applied', cleared: 'Cleared' };

export default async function people(ctx, el, refresh) {
  const c = ctx.consortium.id;
  const view = ui(ctx)._ppl || 'pipeline';
  const [staff, recs, matrix, sup, settings] = await Promise.all([
    db.from('staff').select('*').eq('consortium_id', c).order('name').then(must),
    db.from('recruitment').select('*').eq('consortium_id', c).then(must),
    db.rpc('lw_training_matrix', { p_consortium: c }).then(must),
    db.from('supervision').select('*').eq('consortium_id', c).order('due_date').then(must),
    db.from('lw_settings').select('*').eq('consortium_id', c).maybeSingle().then(must),
  ]);
  const rec = (id) => recs.find((r) => r.staff_id === id) || {};
  const missing = (id) => {
    const r = rec(id);
    return [r.dbs_status !== 'cleared' ? 'DBS' : '', (r.references_received || 0) < 2 ? `${r.references_received || 0} of 2 references` : '',
      !r.right_to_work_checked ? 'Right to work' : '', !r.induction_completed ? 'Induction' : ''].filter(Boolean);
  };
  const targets = settings?.recruitment_targets || {};
  const canManage = isSenior(ctx) || (lw(ctx).roles.includes('hub_lead'));
  const current = staff.filter((s) => s.status !== 'left');

  const pipeline = () => html`<div class="lw-board" role="list">${STAGES.map(([k, label]) => {
    const here = current.filter((s) => (rec(s.id).stage || 'briefed') === k);
    const due = targets[k];
    const late = due && due < today() && here.some((s) => missing(s.id).length);
    return html`<section class="lw-col" role="listitem"><header><strong>${label}</strong><span class="muted small">${here.length}</span>
      ${due ? html`<span class="small ${late ? 'warn-text' : 'muted'}">Target ${fmtDate(due)}</span>` : ''}</header>
      ${here.map((s) => { const m = missing(s.id); return html`<button type="button" class="lw-card" data-staff="${s.id}"><strong>${s.name}</strong>
        <span class="muted small">${s.role}${s.employer ? ` · ${s.employer}` : ''}${s.is_bank ? ' · bank' : ''}</span>
        <span class="lw-card-tags">${m.length ? m.map((x) => pill('amber', x)) : pill('green', 'Can be rostered', 'approved')}</span></button>`; })}
    </section>`;
  })}</div>`;

  const training = () => (matrix.courses.length ? html`<div class="table-wrap"><table class="lw-matrix"><thead><tr><th>Person</th>
    ${matrix.courses.map((k) => html`<th><button type="button" class="linkbtn" data-course="${k.id}">${k.name}</button><span class="muted small">${k.validity_months ? `${k.validity_months} months` : 'No expiry'}</span></th>`)}</tr></thead>
    <tbody>${matrix.people.map((p) => html`<tr><th scope="row">${p.name}<span class="muted small">${p.role}</span></th>${matrix.courses.map((k) => {
      const cell = p.cells[k.id] || {};
      const label = cell.state === 'green' ? `Done ${fmtDate(cell.completed)}` : cell.state === 'amber' ? `Expires ${fmtDate(cell.expires)}` : cell.state === 'red' ? (cell.completed ? `Expired ${fmtDate(cell.expires)}` : 'Missing') : '';
      return html`<td><button type="button" class="lw-cell ${cell.state}" data-rec="${p.id}" data-c="${k.id}" title="${label}">${cell.state === 'none' ? '' : html`<i></i>${label}`}</button></td>`;
    })}</tr>`)}</tbody></table></div>
    <p class="small muted lw-key"><span class="lw-cell green"><i></i></span>Complete <span class="lw-cell amber"><i></i></span>Expires within 60 days <span class="lw-cell red"><i></i></span>Missing or expired · blank: not needed for that role</p>`
    : emptyState('library', 'No training courses yet. Add the courses each role needs.'));

  const supervision = () => {
    const overdue = sup.filter((s) => !s.held_date && s.due_date < today());
    const upcoming = sup.filter((s) => !s.held_date && s.due_date >= today());
    const held = sup.filter((s) => s.held_date);
    const nm = (id) => staff.find((s) => s.id === id)?.name || '';
    const row = (s) => html`<li><button type="button" class="lw-row" data-sup="${s.id}"><span class="lw-row-main"><strong>${nm(s.staff_id)}</strong>
      <span class="muted small">${s.supervisor_id ? `with ${nm(s.supervisor_id)} · ` : ''}due ${fmtDate(s.due_date)}${s.held_date ? ` · held ${fmtDate(s.held_date)}` : ''}</span></span>
      <span class="lw-row-tags">${s.held_date ? pill('green', 'Held', 'approved') : s.due_date < today() ? pill('red', 'Overdue', 'overdue') : pill('blue', 'Booked', 'due')}</span></button></li>`;
    return html`${sectionGroup({ title: 'Overdue', meta: `${overdue.length}`, open: overdue.length > 0, body: html`<ul class="lw-list">${overdue.map(row)}</ul>` })}
      ${sectionGroup({ title: 'Coming up', meta: `${upcoming.length}`, open: !overdue.length, body: html`<ul class="lw-list">${upcoming.map(row)}</ul>` })}
      ${sectionGroup({ title: 'Held', meta: `${held.length}`, body: html`<ul class="lw-list">${held.slice(-30).map(row)}</ul>` })}`;
  };

  render(el, html`<div class="lw-toolbar">${segControl('ppl', [['pipeline', 'Pipeline'], ['training', 'Training'], ['supervision', 'Supervision']], view)}
      <span class="btns">${canManage ? html`<button class="btn secondary small" id="add-staff">${raw(icon('add', 16))}Add person</button>` : ''}
      ${view === 'training' && isSenior(ctx) ? html`<button class="btn secondary small" id="add-course">Add course</button>` : ''}
      ${view === 'supervision' && canManage ? html`<button class="btn secondary small" id="add-sup">Book supervision</button>` : ''}
      ${view === 'pipeline' && isSenior(ctx) ? html`<button class="btn secondary small" id="targets">Stage target dates</button>` : ''}</span></div>
    <p class="small muted">Statuses and dates only. Never record certificate, passport or ID numbers here.</p>
    ${!current.length ? emptyState('people', 'No staff yet. Add people as they enter the pipeline.') : view === 'pipeline' ? pipeline() : view === 'training' ? training() : supervision()}`);
  $$('[data-seg-for="ppl"] [data-seg]', el).forEach((b) => b.addEventListener('click', () => { ui(ctx)._ppl = b.dataset.seg; people(ctx, el, refresh); }));
  bindSegments(el);
  const again = () => people(ctx, el, refresh);

  const staffForm = (s = {}) => html`<form class="form" id="st-form">
    <div class="fields"><label class="f">Name<input name="name" required maxlength="120" value="${s.name || ''}"></label>
      <label class="f">Role<input name="role" required maxlength="120" value="${s.role || ''}" placeholder="For example Youth Coach" list="lw-roles"></label></div>
    <datalist id="lw-roles">${[...new Set(staff.map((x) => x.role))].map((r) => html`<option value="${r}">`)}</datalist>
    <fieldset><legend>Hubs</legend><div class="checks">${hubsOf(ctx).map((h) => html`<label class="check"><input type="checkbox" name="hub" value="${h.id}" ${raw((s.hub_ids || []).includes(h.id) ? 'checked' : '')}> ${h.name}</label>`)}</div></fieldset>
    <div class="fields"><label class="f">Employer <span class="muted small">(agency or partner)</span><input name="employer" maxlength="120" value="${s.employer || ''}"></label>
      <label class="f">Status<select name="status">${[['pipeline', 'In the pipeline'], ['active', 'Active'], ['left', 'Left']].map(([k, v]) => html`<option value="${k}" ${raw(s.status === k ? 'selected' : '')}>${v}</option>`)}</select></label></div>
    <label class="f">Work email <span class="muted small">(optional)</span><input type="email" name="email" maxlength="200" value="${s.contact_email || ''}"></label>
    <label class="check"><input type="checkbox" name="bank" ${raw(s.is_bank ? 'checked' : '')}> Bank staff (sees cover requests)</label>
    ${isLead(ctx) ? html`<label class="f">Portal account <span class="muted small">(lets them see their own shifts)</span><select name="profile"><option value="">None</option>
      ${(lw(ctx).people || []).map((p) => html`<option value="${p.user_id}" ${raw(s.profile_id === p.user_id ? 'selected' : '')}>${p.name} · ${p.org || ''}</option>`)}</select></label>` : ''}
    <div class="btns"><button class="btn">${s.id ? 'Save' : 'Add person'}</button></div></form>`;
  const readStaff = (form) => {
    const f = formData(form);
    return { name: f.name.trim(), role: f.role.trim(), hub_ids: $$('[name=hub]:checked', form).map((x) => x.value), employer: f.employer || null,
      status: f.status, contact_email: f.email || null, is_bank: !!f.bank, ...(isLead(ctx) ? { profile_id: f.profile || null } : {}) };
  };
  $('#add-staff', el)?.addEventListener('click', () => {
    const d = openDrawer('Add a person', staffForm({ status: 'pipeline' }));
    $('#st-form', d).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => {
      const row = must(await db.from('staff').insert({ consortium_id: c, ...readStaff(e.target) }).select('id').single());
      must(await db.from('recruitment').insert({ staff_id: row.id, consortium_id: c }));
      d.close(); toast('Added.'); again(); }); });
  });

  $$('[data-staff]', el).forEach((b) => b.addEventListener('click', () => {
    const s = staff.find((x) => x.id === b.dataset.staff); const r = rec(s.id); const m = missing(s.id);
    const d = openDrawer(s.name, html`<p class="muted small">${s.role} · ${(s.hub_ids || []).map((h) => hubName(ctx, h)).join(', ') || 'No hub'}</p>
      ${m.length ? html`<div class="lead-banner"><span><strong>Can't be rostered yet.</strong> Missing: ${m.join(', ')}.</span></div>` : html`<p>${pill('green', 'Can be rostered', 'approved')}</p>`}
      <form class="form" id="rc-form">
        <label class="f">Stage<select name="stage">${STAGES.map(([k, v]) => html`<option value="${k}" ${raw((r.stage || 'briefed') === k ? 'selected' : '')}>${v}</option>`)}</select></label>
        <fieldset><legend>DBS</legend><div class="fields"><label class="f">Status<select name="dbs">${Object.entries(DBS).map(([k, v]) => html`<option value="${k}" ${raw((r.dbs_status || 'not_started') === k ? 'selected' : '')}>${v}</option>`)}</select></label>
          <label class="f">Cleared on<input type="date" name="dbs_date" value="${r.dbs_cleared_date || ''}"></label></div>
          <label class="check"><input type="checkbox" name="update" ${raw(r.dbs_update_service ? 'checked' : '')}> On the DBS update service</label></fieldset>
        <fieldset><legend>References received</legend><div class="seg">${[0, 1, 2].map((n) => html`<label class="seg-btn lw-radio"><input type="radio" name="refs" value="${n}" ${raw((r.references_received || 0) === n ? 'checked' : '')}>${n}</label>`)}</div></fieldset>
        <fieldset><legend>Right to work</legend><div class="fields"><label class="check"><input type="checkbox" name="rtw" ${raw(r.right_to_work_checked ? 'checked' : '')}> Checked</label>
          <label class="f">On<input type="date" name="rtw_date" value="${r.right_to_work_date || ''}"></label></div></fieldset>
        <label class="f">Induction completed<input type="date" name="induction" value="${r.induction_completed || ''}"></label>
        <p class="small muted">Dates and statuses only. No certificate, passport or ID numbers.</p>
        ${canManage ? html`<div class="btns"><button class="btn">Save</button><button type="button" class="btn secondary" id="edit-person">Edit details</button></div>` : ''}</form>`);
    $('#rc-form', d).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => {
      const f = formData(e.target);
      must(await db.from('recruitment').upsert({ staff_id: s.id, consortium_id: c, stage: f.stage, dbs_status: f.dbs, dbs_cleared_date: f.dbs_date || (f.dbs === 'cleared' ? today() : null),
        dbs_update_service: !!f.update, references_received: Number(f.refs || 0), right_to_work_checked: !!f.rtw,
        right_to_work_date: f.rtw_date || (f.rtw ? today() : null), induction_completed: f.induction || null }, { onConflict: 'staff_id' }));
      if (f.stage === 'active' && s.status === 'pipeline') must(await db.from('staff').update({ status: 'active' }).eq('id', s.id));
      d.close(); toast('Saved.'); again(); }); });
    $('#edit-person', d)?.addEventListener('click', () => {
      d.close();
      const d2 = openDrawer(`Edit ${s.name}`, staffForm(s));
      $('#st-form', d2).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => { must(await db.from('staff').update(readStaff(e.target)).eq('id', s.id)); d2.close(); again(); }); });
    });
  }));

  $('#targets', el)?.addEventListener('click', () => {
    const d = openDrawer('Stage target dates', html`<form class="form" id="tg-form"><p class="small muted">From the plan's hiring timeline. The board flags a stage when its date has passed and people there still can't be rostered.</p>
      ${STAGES.map(([k, v]) => html`<label class="f">${v}<input type="date" name="${k}" value="${targets[k] || ''}"></label>`)}<div class="btns"><button class="btn">Save</button></div></form>`);
    $('#tg-form', d).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => {
      const f = formData(e.target); const t = Object.fromEntries(Object.entries(f).filter(([, v]) => v));
      must(await db.from('lw_settings').upsert({ consortium_id: c, recruitment_targets: t }, { onConflict: 'consortium_id' })); d.close(); again(); }); });
  });

  const courseForm = (k = {}) => html`<form class="form" id="co-form"><label class="f">Course<input name="name" required maxlength="160" value="${k.name || ''}"></label>
    <label class="f">Required for roles <span class="muted small">(comma separated, as written on the staff list)</span><input name="roles" value="${(k.required_roles || []).join(', ')}"></label>
    <label class="f">Valid for (months) <span class="muted small">(blank: never expires)</span><input type="number" name="months" min="1" max="120" value="${k.validity_months || ''}"></label>
    <div class="btns"><button class="btn">Save</button></div></form>`;
  const readCourse = (f) => ({ name: f.name.trim(), required_roles: (f.roles || '').split(',').map((x) => x.trim()).filter(Boolean), validity_months: f.months ? Number(f.months) : null });
  $('#add-course', el)?.addEventListener('click', () => {
    const d = openDrawer('Add a course', courseForm());
    $('#co-form', d).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => { must(await db.from('training_courses').insert({ consortium_id: c, ...readCourse(formData(e.target)) })); d.close(); again(); }); });
  });
  $$('[data-course]', el).forEach((b) => b.addEventListener('click', () => {
    if (!isSenior(ctx)) return;
    const k = matrix.courses.find((x) => x.id === b.dataset.course);
    const d = openDrawer(`Edit ${k.name}`, courseForm(k));
    $('#co-form', d).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => { must(await db.from('training_courses').update(readCourse(formData(e.target))).eq('id', k.id)); d.close(); again(); }); });
  }));
  $$('[data-rec]', el).forEach((b) => b.addEventListener('click', () => {
    if (!canManage) return;
    const p = matrix.people.find((x) => x.id === b.dataset.rec); const k = matrix.courses.find((x) => x.id === b.dataset.c);
    const d = openDrawer(`${p.name} · ${k.name}`, html`<form class="form" id="tr-form"><label class="f">Completed on<input type="date" name="done" required max="${today()}"></label>
      <p class="small muted">${k.validity_months ? `The expiry date is set ${k.validity_months} months on.` : 'This course doesn\'t expire.'}</p><div class="btns"><button class="btn">Record</button></div></form>`);
    $('#tr-form', d).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => {
      must(await db.from('training_records').insert({ consortium_id: c, staff_id: p.id, course_id: k.id, completed_date: formData(e.target).done })); d.close(); again(); }); });
  }));

  const supForm = (s = {}) => html`<form class="form" id="su-form">
    <label class="f">Who<select name="staff" required>${current.map((p) => html`<option value="${p.id}" ${raw(p.id === s.staff_id ? 'selected' : '')}>${p.name}</option>`)}</select></label>
    <label class="f">Supervisor<select name="sup"><option value="">Not set</option>${current.map((p) => html`<option value="${p.id}" ${raw(p.id === s.supervisor_id ? 'selected' : '')}>${p.name}</option>`)}</select></label>
    <div class="fields"><label class="f">Due<input type="date" name="due" required value="${s.due_date || today()}"></label><label class="f">Held on<input type="date" name="held" value="${s.held_date || ''}"></label></div>
    <label class="f">Notes <span class="muted small">(no young people's details)</span><textarea name="notes" rows="3" maxlength="2000">${s.notes || ''}</textarea></label>
    <div class="btns"><button class="btn">Save</button></div></form>`;
  const readSup = (f) => ({ staff_id: f.staff, supervisor_id: f.sup || null, due_date: f.due, held_date: f.held || null, notes: f.notes || null });
  $('#add-sup', el)?.addEventListener('click', () => {
    const d = openDrawer('Book supervision', supForm());
    $('#su-form', d).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => { must(await db.from('supervision').insert({ consortium_id: c, ...readSup(formData(e.target)) })); d.close(); again(); }); });
  });
  $$('[data-sup]', el).forEach((b) => b.addEventListener('click', () => {
    const s = sup.find((x) => x.id === b.dataset.sup);
    const d = openDrawer('Supervision', supForm(s));
    $('#su-form', d).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => {
      const row = readSup(formData(e.target));
      must(await db.from('supervision').update(row).eq('id', s.id));
      // Held: book the next one a month on.
      if (row.held_date && !s.held_date) {
        const next = new Date(`${row.due_date}T12:00:00`); next.setMonth(next.getMonth() + 1);
        must(await db.from('supervision').insert({ consortium_id: c, staff_id: row.staff_id, supervisor_id: row.supervisor_id, due_date: next.toISOString().slice(0, 10) }));
      }
      d.close(); again(); }); });
  }));
}

export { ROLE };
