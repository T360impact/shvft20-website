// Delivery planning: a calendar across hubs (blocks, reset weeks,
// showcases, trips and meetings), monthly activity plans with their due
// dates, trips, the weekly log per hub, and kitchen checks.
import { html, raw, render, $, $$, db, must, act, toast, icon, pill, openDrawer, fmtDate, fmtMonth, formData, today, emptyState, sectionGroup, segControl, bindSegments } from '../../lib.js';
import { hubsOf, hubName, isWide } from './common.js';

// Picked hub, date and view survive a live refresh.
const ui = (ctx) => ctx.lwUi || (ctx.lwUi = {});

const PLAN = { draft: ['grey', 'Draft'], reviewed: ['blue', 'Reviewed'], published: ['green', 'Published'], not_started: ['red', 'Not started'] };
const addDays = (d, n) => { const x = new Date(`${d}T12:00:00`); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
const monday = (d) => { const x = new Date(`${d}T12:00:00`); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x.toISOString().slice(0, 10); };
const firstOf = (d, n = 0) => { const x = new Date(`${d.slice(0, 7)}-01T12:00:00`); x.setMonth(x.getMonth() + n); return x.toISOString().slice(0, 10); };

export default async function delivery(ctx, el, refresh) {
  const c = ctx.consortium.id;
  const hubs = hubsOf(ctx);
  if (!hubs.length) { render(el, emptyState('sites', 'Add a hub first. The lead does this under Team and hubs.')); return; }
  const st = ui(ctx)._dl || (ui(ctx)._dl = { view: 'calendar', month: firstOf(today()), hub: hubs[0].id, week: monday(today()) });
  const [blocks, plans, trips, logs, kitchen, meetings, staff] = await Promise.all([
    db.from('activity_blocks').select('*').eq('consortium_id', c).order('start_date').then(must),
    db.from('activity_plans').select('*').eq('consortium_id', c).order('month').then(must),
    db.from('trips').select('*').eq('consortium_id', c).order('trip_date').then(must),
    db.from('weekly_logs').select('*').eq('consortium_id', c).order('week_start', { ascending: false }).then(must),
    db.from('kitchen_checks').select('*').eq('consortium_id', c).order('checked_on', { ascending: false }).then(must),
    db.from('lw_meetings').select('id, name, rule, frequency_text').eq('consortium_id', c).is('retired_at', null).then(must),
    db.from('staff').select('id, name, hub_ids').eq('consortium_id', c).neq('status', 'left').then(must),
  ]);
  const again = () => delivery(ctx, el, refresh);
  const end = (b) => addDays(b.start_date, b.weeks * 7 - 1);

  // Calendar: the weeks of a month, one column per hub.
  const calendar = () => {
    const m0 = st.month; const m1 = firstOf(m0, 1);
    const weeks = []; for (let w = monday(m0); w < m1; w = addDays(w, 7)) weeks.push(w);
    const weekly = meetings.filter((m) => /FREQ=WEEKLY/.test(m.rule || ''));
    const monthly = meetings.filter((m) => /FREQ=MONTHLY/.test(m.rule || ''));
    return html`<div class="lw-toolbar"><span class="btns"><button class="btn secondary small" data-m="-1">${raw(icon('next', 14))}</button>
        <strong>${fmtMonth(m0)}</strong><button class="btn secondary small" data-m="1">${raw(icon('next', 14))}</button></span>
      <button class="btn secondary small" id="add-block">${raw(icon('add', 16))}Add block or reset week</button></div>
      <div class="table-wrap"><table class="lw-cal"><thead><tr><th>Week of</th>${hubs.map((h) => html`<th>${h.name}</th>`)}</tr></thead><tbody>
      ${weeks.map((w) => { const we = addDays(w, 6); return html`<tr><th scope="row">${fmtDate(w)}
        ${weekly.length || monthly.length ? html`<span class="muted small">${[...weekly.map((m) => m.name), ...monthly.filter(() => w <= addDays(m0, 6) && we >= m0).map((m) => m.name)].join(' · ')}</span>` : ''}</th>
        ${hubs.map((h) => {
          const bs = blocks.filter((b) => b.hub_id === h.id && b.start_date <= we && end(b) >= w);
          const ts = trips.filter((t) => t.hub_id === h.id && t.trip_date >= w && t.trip_date <= we);
          const sc = blocks.filter((b) => b.hub_id === h.id && b.showcase_date && b.showcase_date >= w && b.showcase_date <= we);
          return html`<td>${bs.map((b) => html`<button type="button" class="lw-chip ${b.kind}" data-block="${b.id}">${b.kind === 'reset' ? 'Reset' : b.name} · wk ${Math.floor((+new Date(`${w}T12:00:00`) - +new Date(`${monday(b.start_date)}T12:00:00`)) / 6048e5) + 1}/${b.weeks}</button>`)}
            ${sc.map((b) => html`<span class="lw-chip show">Showcase ${fmtDate(b.showcase_date)}</span>`)}
            ${ts.map((t) => html`<span class="lw-chip trip">Trip · ${t.destination}</span>`)}</td>`;
        })}</tr>`; })}</tbody></table></div>`;
  };

  const planCard = (h, month) => {
    const p = plans.find((x) => x.hub_id === h.id && x.month === month);
    const due = p?.due_date || addDays(firstOf(month, -1), 14);
    const status = p?.status || 'not_started';
    const late = status !== 'published' && due < today();
    return html`<button type="button" class="lw-card" data-plan="${h.id}|${month}"><strong>${h.name} · ${fmtMonth(month)}</strong>
      <span class="lw-card-tags">${pill(PLAN[status][0], PLAN[status][1])}${late ? pill('red', `Overdue since ${fmtDate(due)}`, 'overdue') : html`<span class="muted small">Due ${fmtDate(due)}</span>`}</span>
      ${p ? html`<span class="muted small">${[p.menu ? 'menu' : '', p.specialists ? 'specialists' : '', p.trips ? 'trips' : '', p.materials ? 'materials' : '', p.staffing_needs ? 'staffing' : ''].filter(Boolean).join(' · ') || 'Nothing filled in yet'}</span>` : ''}</button>`;
  };
  const activity = () => html`${[0, 1].map((n) => { const m = firstOf(today(), n); return sectionGroup({ title: n ? 'Next month' : 'This month', meta: fmtMonth(m), open: true,
      body: html`<div class="lw-cards">${hubs.map((h) => planCard(h, m))}</div>` }); })}`;

  const tripsView = () => {
    const up = trips.filter((t) => t.trip_date >= today()); const past = trips.filter((t) => t.trip_date < today());
    const row = (t) => html`<li><button type="button" class="lw-row" data-trip="${t.id}"><span class="lw-row-main"><strong>${t.destination}</strong>
      <span class="muted small">${hubName(ctx, t.hub_id)} · ${fmtDate(t.trip_date)}${t.staff_count ? ` · ${t.staff_count} staff to ${t.young_people_count || '?'} young people` : ''}</span></span>
      <span class="lw-row-tags">${t.risk_assessment_done ? pill('green', 'Risk assessed') : pill('amber', 'Risk assessment')}${t.consent_forms_done ? pill('green', 'Consent in') : pill('amber', 'Consent forms')}</span></button></li>`;
    return html`<div class="lw-toolbar"><button class="btn secondary small" id="add-trip">${raw(icon('add', 16))}Add trip</button></div>
      ${sectionGroup({ title: 'Coming up', meta: `${up.length}`, open: true, body: up.length ? html`<ul class="lw-list">${up.map(row)}</ul>` : emptyState('check', 'No trips planned.') })}
      ${sectionGroup({ title: 'Past', meta: `${past.length}`, body: html`<ul class="lw-list">${past.slice(-20).map(row)}</ul>` })}`;
  };

  const logView = () => {
    const l = logs.find((x) => x.hub_id === st.hub && x.week_start === st.week) || {};
    return html`<div class="filters lw-filters">${hubs.length > 1 ? html`<label class="f">Hub<select id="lg-hub">${hubs.map((h) => html`<option value="${h.id}" ${raw(h.id === st.hub ? 'selected' : '')}>${h.name}</option>`)}</select></label>` : ''}
      <label class="f">Week of<input type="date" id="lg-week" value="${st.week}"></label></div>
      <form class="form panel" id="lg-form">
        <label class="f">Maintenance issues for the building owner<textarea name="maintenance" rows="2" maxlength="2000">${l.maintenance || ''}</textarea></label>
        <label class="f">Food and materials ordered<textarea name="food_materials" rows="2" maxlength="2000">${l.food_materials || ''}</textarea></label>
        <label class="f">Incident references <span class="muted small">(references only, such as INC-0412; details stay in the incident system)</span><input name="incident_refs" maxlength="500" value="${l.incident_refs || ''}"></label>
        <label class="f">Story of the week<textarea name="story" rows="3" maxlength="2000">${l.story || ''}</textarea></label>
        <div class="fields"><label class="f">Link to the evidence bank<input type="url" name="story_link" placeholder="https://" value="${l.story_link || ''}"></label>
          <label class="check"><input type="checkbox" name="story_consent" ${raw(l.story_consent ? 'checked' : '')}> Consent recorded for this story</label></div>
        <label class="f">Next delivery day's needs<textarea name="next_needs" rows="2" maxlength="2000">${l.next_needs || ''}</textarea></label>
        <div class="btns"><button class="btn">Save the log</button></div></form>`;
  };

  const kitchenView = () => html`<div class="lw-toolbar"><button class="btn secondary small" id="add-kc">${raw(icon('add', 16))}Record a kitchen check</button></div>
    <div class="lw-cards">${hubs.map((h) => { const k = kitchen.find((x) => x.hub_id === h.id); return html`<div class="panel"><header><h2>${h.name}</h2>${k ? html`<span class="muted small">Checked ${fmtDate(k.checked_on)}</span>` : pill('amber', 'Not checked')}</header>
      ${k ? html`<dl class="kv"><dt>Food</dt><dd>${k.food_source === 'delivered' ? 'Delivered' : k.food_source === 'on_site' ? 'Cooked on site' : 'Not set'}</dd>
        <dt>Equipment</dt><dd>${k.equipment || '–'}</dd><dt>Permissions</dt><dd>${k.permissions || '–'}</dd>
        <dt>Food hygiene certified</dt><dd>${k.hygiene_staff_ids.map((id) => staff.find((s) => s.id === id)?.name).filter(Boolean).join(', ') || pill('red', 'Nobody named')}</dd></dl>` : ''}</div>`; })}</div>`;

  render(el, html`${segControl('dv', [['calendar', 'Calendar'], ['plans', 'Activity plans'], ['trips', 'Trips'], ['log', 'Weekly log'], ['kitchen', 'Kitchen']], st.view)}
    <div id="dv-body">${st.view === 'calendar' ? calendar() : st.view === 'plans' ? activity() : st.view === 'trips' ? tripsView() : st.view === 'log' ? logView() : kitchenView()}</div>`);
  $$('[data-seg-for="dv"] [data-seg]', el).forEach((b) => b.addEventListener('click', () => { st.view = b.dataset.seg; again(); }));
  bindSegments(el);
  $$('[data-m]', el).forEach((b) => b.addEventListener('click', () => { st.month = firstOf(st.month, Number(b.dataset.m)); again(); }));

  const blockForm = (b = {}) => html`<form class="form" id="bk-form">
    <label class="f">Hub<select name="hub">${hubs.map((h) => html`<option value="${h.id}" ${raw(h.id === b.hub_id ? 'selected' : '')}>${h.name}</option>`)}</select></label>
    <div class="seg">${[['block', 'Activity block'], ['reset', 'Reset week(s)']].map(([k, v]) => html`<label class="seg-btn lw-radio"><input type="radio" name="kind" value="${k}" ${raw((b.kind || 'block') === k ? 'checked' : '')}>${v}</label>`)}</div>
    <label class="f">Name<input name="name" required maxlength="160" value="${b.name || ''}" placeholder="For example Music production"></label>
    <div class="fields"><label class="f">Starts<input type="date" name="start" required value="${b.start_date || ''}"></label><label class="f">Weeks<input type="number" name="weeks" min="1" max="52" value="${b.weeks || 8}"></label></div>
    <div class="fields"><label class="f">Showcase<input type="date" name="showcase" value="${b.showcase_date || ''}"></label>
      <label class="f">Status<select name="status">${['planned', 'running', 'done'].map((k) => html`<option ${raw(b.status === k ? 'selected' : '')}>${k}</option>`)}</select></label></div>
    <div class="btns"><button class="btn">Save</button>${b.id ? html`<button type="button" class="btn secondary" id="rm">Remove</button>` : ''}</div></form>`;
  const readBlock = (f) => ({ hub_id: f.hub, kind: f.kind, name: f.name, start_date: f.start, weeks: Number(f.weeks || 8), showcase_date: f.showcase || null, status: f.status });
  $('#add-block', el)?.addEventListener('click', () => {
    const d = openDrawer('Add a block', blockForm({ hub_id: st.hub }));
    $('#bk-form', d).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => { must(await db.from('activity_blocks').insert({ consortium_id: c, ...readBlock(formData(e.target)) })); d.close(); again(); }); });
  });
  $$('[data-block]', el).forEach((x) => x.addEventListener('click', () => {
    const b = blocks.find((y) => y.id === x.dataset.block);
    const d = openDrawer(b.name, blockForm(b));
    $('#bk-form', d).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => { must(await db.from('activity_blocks').update(readBlock(formData(e.target))).eq('id', b.id)); d.close(); again(); }); });
    $('#rm', d).addEventListener('click', (e) => act(e.target, async () => { must(await db.from('activity_blocks').delete().eq('id', b.id)); d.close(); again(); }));
  }));

  $$('[data-plan]', el).forEach((x) => x.addEventListener('click', () => {
    const [hub, month] = x.dataset.plan.split('|');
    const p = plans.find((y) => y.hub_id === hub && y.month === month) || {};
    const running = blocks.filter((b) => b.hub_id === hub && b.kind === 'block' && b.start_date <= addDays(firstOf(month, 1), -1) && end(b) >= month);
    const d = openDrawer(`${hubName(ctx, hub)} · ${fmtMonth(month)}`, html`<form class="form" id="ap-form">
      ${running.length ? html`<p class="small"><strong>Blocks running:</strong> ${running.map((b) => `${b.name} (weeks ${Math.max(1, Math.floor((+new Date(`${month}T12:00:00`) - +new Date(`${b.start_date}T12:00:00`)) / 6048e5) + 1)}–${Math.min(b.weeks, Math.floor((+new Date(`${addDays(firstOf(month, 1), -1)}T12:00:00`) - +new Date(`${b.start_date}T12:00:00`)) / 6048e5) + 1)})`).join('; ')}</p>` : html`<p class="small muted">No blocks running this month. Add them on the calendar.</p>`}
      <label class="f">Specialists<textarea name="specialists" rows="2" maxlength="2000">${p.specialists || ''}</textarea></label>
      <label class="f">Trips and events<textarea name="trips" rows="2" maxlength="2000">${p.trips || ''}</textarea></label>
      <label class="f">Menu<textarea name="menu" rows="2" maxlength="2000">${p.menu || ''}</textarea></label>
      <label class="f">Materials<textarea name="materials" rows="2" maxlength="2000">${p.materials || ''}</textarea></label>
      <label class="f">Staffing needs<textarea name="staffing_needs" rows="2" maxlength="2000">${p.staffing_needs || ''}</textarea></label>
      <label class="f">Status<select name="status">${['draft', 'reviewed', 'published'].map((k) => html`<option value="${k}" ${raw((p.status || 'draft') === k ? 'selected' : '')}>${PLAN[k][1]}</option>`)}</select></label>
      <p class="small muted">The hub lead or operations lead reviews and publishes. Due ${fmtDate(p.due_date || addDays(firstOf(month, -1), 14))}.</p>
      <div class="btns"><button class="btn">Save</button></div></form>`);
    $('#ap-form', d).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => {
      const f = formData(e.target);
      const row = { specialists: f.specialists || null, trips: f.trips || null, menu: f.menu || null, materials: f.materials || null, staffing_needs: f.staffing_needs || null, status: f.status,
        blocks: running.map((b) => ({ block_id: b.id, name: b.name })) };
      if (p.id) must(await db.from('activity_plans').update(row).eq('id', p.id));
      else must(await db.from('activity_plans').insert({ consortium_id: c, hub_id: hub, month, ...row }));
      d.close(); toast('Saved.'); again(); }); });
  }));

  const tripForm = (t = {}) => html`<form class="form" id="tp-form">
    <label class="f">Hub<select name="hub">${hubs.map((h) => html`<option value="${h.id}" ${raw(h.id === t.hub_id ? 'selected' : '')}>${h.name}</option>`)}</select></label>
    <div class="fields"><label class="f">Date<input type="date" name="date" required value="${t.trip_date || ''}"></label><label class="f">Destination<input name="dest" required maxlength="200" value="${t.destination || ''}"></label></div>
    <div class="fields"><label class="f">Staff going<input type="number" min="0" name="staff" value="${t.staff_count ?? ''}"></label><label class="f">Young people going<input type="number" min="0" name="yp" value="${t.young_people_count ?? ''}"></label></div>
    <label class="check"><input type="checkbox" name="ra" ${raw(t.risk_assessment_done ? 'checked' : '')}> Risk assessment done</label>
    <label class="check"><input type="checkbox" name="cf" ${raw(t.consent_forms_done ? 'checked' : '')}> Consent forms in</label>
    <div class="btns"><button class="btn">Save</button></div></form>`;
  const readTrip = (f) => ({ hub_id: f.hub, trip_date: f.date, destination: f.dest, staff_count: f.staff ? Number(f.staff) : null, young_people_count: f.yp ? Number(f.yp) : null, risk_assessment_done: !!f.ra, consent_forms_done: !!f.cf });
  $('#add-trip', el)?.addEventListener('click', () => {
    const d = openDrawer('Add a trip', tripForm({ hub_id: st.hub }));
    $('#tp-form', d).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => { must(await db.from('trips').insert({ consortium_id: c, ...readTrip(formData(e.target)) })); d.close(); again(); }); });
  });
  $$('[data-trip]', el).forEach((x) => x.addEventListener('click', () => {
    const t = trips.find((y) => y.id === x.dataset.trip);
    const d = openDrawer(t.destination, tripForm(t));
    $('#tp-form', d).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => { must(await db.from('trips').update(readTrip(formData(e.target))).eq('id', t.id)); d.close(); again(); }); });
  }));

  $('#lg-hub', el)?.addEventListener('change', (e) => { st.hub = e.target.value; again(); });
  $('#lg-week', el)?.addEventListener('change', (e) => { st.week = monday(e.target.value || today()); again(); });
  $('#lg-form', el)?.addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => {
    const f = formData(e.target);
    must(await db.from('weekly_logs').upsert({ consortium_id: c, hub_id: st.hub, week_start: st.week, maintenance: f.maintenance || null, food_materials: f.food_materials || null,
      incident_refs: f.incident_refs || null, story: f.story || null, story_link: f.story_link || null, story_consent: !!f.story_consent, next_needs: f.next_needs || null }, { onConflict: 'hub_id,week_start' }));
    toast('Log saved.'); }); });

  $('#add-kc', el)?.addEventListener('click', () => {
    const d = openDrawer('Kitchen check', html`<form class="form" id="kc-form">
      <label class="f">Hub<select name="hub">${hubs.map((h) => html`<option value="${h.id}">${h.name}</option>`)}</select></label>
      <label class="f">Food<select name="src"><option value="on_site">Cooked on site</option><option value="delivered">Delivered</option></select></label>
      <label class="f">Equipment<textarea name="equipment" rows="2" maxlength="2000"></textarea></label>
      <label class="f">Permissions <span class="muted small">(the building owner's, environmental health)</span><textarea name="permissions" rows="2" maxlength="2000"></textarea></label>
      <fieldset><legend>Food hygiene certified staff</legend><div class="checks">${staff.map((s) => html`<label class="check"><input type="checkbox" name="hy" value="${s.id}"> ${s.name}</label>`)}</div></fieldset>
      <div class="btns"><button class="btn">Save</button></div></form>`);
    $('#kc-form', d).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => {
      const f = formData(e.target);
      must(await db.from('kitchen_checks').insert({ consortium_id: c, hub_id: f.hub, food_source: f.src, equipment: f.equipment || null, permissions: f.permissions || null,
        hygiene_staff_ids: $$('[name=hy]:checked', e.target).map((x) => x.value) })); d.close(); again(); }); });
  });
  void isWide;
}
