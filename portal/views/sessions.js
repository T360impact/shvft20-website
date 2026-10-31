// Sessions and attendance, built for a phone at the hub: start a session,
// tap each young person who came, register newcomers on the spot.
import { db, html, raw, render, $, $$, formData, toast, act, must, icon, emptyState, fmtDate, ageOn, today, errorText } from '../lib.js';

// A big tick that fades, so staff checking people in at the door can see it worked.
const tick = () => {
  const t = document.createElement('div');
  t.className = 'tick-pop';
  t.innerHTML = `<span>${icon('check', 56, 'Checked in')}</span>`;
  document.body.append(t);
  setTimeout(() => t.remove(), 900);
};
import { registerForm, submitRegistration } from './register.js';

export default async function sessions(ctx, el, [sessionId]) {
  if (sessionId) return attendance(ctx, el, sessionId);
  const c = ctx.consortium;
  const list = must(await db.from('sessions').select('id, session_date, title, site_id, run_by, organisation_id, attendance(count)')
    .eq('consortium_id', c.id).order('session_date', { ascending: false }).limit(200));
  const mySites = ctx.sites.filter((s) => !s.organisation_id || s.organisation_id === ctx.orgId);
  const mine = list.filter((s) => s.organisation_id === ctx.orgId);

  render(el, html`
    <div class="page-head"><div><span class="eyebrow m-delivery">${raw(icon('sessions', 16))}Sessions</span><h1>Check in</h1>
      <p>Start a session, then check in everyone who comes.</p></div></div>
    <div class="grid2">
      <section class="panel m-delivery"><h2>${raw(icon('add', 20))}Start a session</h2>
        <form class="form" id="new-session"><div class="fields">
          <label class="f">Date<input type="date" name="session_date" value="${today()}" max="${today()}" required></label>
          <label class="f">Site<select name="site_id" required><option value="">Choose…</option>${mySites.map((s) => html`<option value="${s.id}">${s.name}</option>`)}</select></label></div>
          <label class="f">Session<input name="title" required placeholder="e.g. Tuesday youth club"></label>
          <label class="f">Run by<input name="run_by" value="${ctx.profile.full_name || ''}"></label>
          <div class="btns"><button class="btn">${raw(icon('checkin', 18))}Start session</button></div></form>
      </section>
      <section class="panel m-delivery"><h2>${raw(icon('sessions', 20))}Recent sessions</h2>
        ${mine.length ? html`<div class="table-wrap"><table><thead><tr><th>Date</th><th>Session</th><th class="num">Came</th></tr></thead>
          <tbody>${mine.map((s) => html`<tr><td class="nowrap">${fmtDate(s.session_date)}</td>
            <td><a href="#/c/${c.id}/sessions/${s.id}">${s.title}</a><br><span class="muted small">${ctx.site(s.site_id)?.name || ''}</span></td>
            <td class="num">${s.attendance?.[0]?.count ?? 0}</td></tr>`)}</tbody></table></div>`
        : emptyState('sessions', 'No sessions yet. Start one to check people in.', '', 'delivery')}
        ${ctx.seesAll && list.length > mine.length ? html`<p class="muted small" style="margin-top:10px">${list.length - mine.length} sessions run by other partners are counted on the dashboard.</p>` : ''}
      </section>
    </div>`);

  $('#new-session').addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      const row = must(await db.from('sessions').insert({ ...formData(e.target), consortium_id: c.id, organisation_id: ctx.orgId, created_by: ctx.user.id })
        .select('id').single());
      location.hash = `#/c/${c.id}/sessions/${row.id}`;
    });
  });
}

async function attendance(ctx, el, sessionId) {
  const c = ctx.consortium;
  const s = must(await db.from('sessions').select('*').eq('id', sessionId).maybeSingle());
  if (!s) { render(el, html`<div class="panel">That session isn't available to you.</div>`); return; }
  const own = s.organisation_id === ctx.orgId;
  const [people, marks] = await Promise.all([
    db.from('young_people').select('id, first_name, last_name, date_of_birth').eq('consortium_id', c.id).order('first_name').order('last_name').then(must),
    db.from('attendance').select('young_person_id').eq('session_id', sessionId).then(must),
  ]);
  const present = new Set(marks.map((m) => m.young_person_id));
  // People already ticked come first, so the list reads as the register.
  people.sort((a, b) => Number(present.has(b.id)) - Number(present.has(a.id)));

  render(el, html`
    <p class="small" style="margin-bottom:10px"><a href="#/c/${c.id}/sessions">← All sessions</a></p>
    <div class="page-head"><div><span class="eyebrow m-delivery">${raw(icon('sites', 16))}${fmtDate(s.session_date)} · ${ctx.site(s.site_id)?.name || ''}</span><h1>${s.title}</h1>
      ${s.run_by ? html`<p>Run by ${s.run_by}</p>` : ''}</div>
      <div class="big-count" aria-live="polite"><b id="count">${present.size}</b><span class="small muted">checked in</span></div></div>
    ${own ? '' : html`<div class="banner info" style="margin-bottom:24px">${raw(icon('info', 20))}<span>Only the partner that ran this session can change who's checked in.</span></div>`}
    <div class="grid2">
      <section class="panel m-delivery"><h2>${raw(icon('checkin', 20))}Who's here</h2>
        <label class="f">Find someone<input type="search" id="find" placeholder="Start typing"></label>
        ${people.length ? html`<div class="att-list" style="margin-top:12px">${people.map((p) => html`
          <label class="att-row ${present.has(p.id) ? 'on' : ''}" data-q="${`${p.first_name} ${p.last_name}`.toLowerCase()}">
            <input type="checkbox" data-yp="${p.id}" ${present.has(p.id) ? 'checked' : ''} ${own ? '' : 'disabled'}>
            <span><strong>${p.first_name} ${p.last_name}</strong> <span class="muted small">age ${ageOn(p.date_of_birth)}</span></span>
            <span class="here">${raw(icon('approved', 16))}Here</span>
          </label>`)}</div>`
        : emptyState('youngPeople', 'No one registered yet. Register people as they arrive.', '', 'delivery')}
      </section>
      ${own ? html`<section class="panel m-delivery"><h2>${raw(icon('add', 20))}Someone new?</h2>
        <p class="helper">Register them and they're checked in. Nobody is counted twice.</p>
        ${registerForm(ctx, { id: 'quick-reg', compact: true })}</section>` : ''}
    </div>`);

  $('#find').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    $$('.att-row').forEach((r) => { r.hidden = q && !r.dataset.q.includes(q); });
  });
  if (!own) return;

  $$('[data-yp]').forEach((box) => box.addEventListener('change', async () => {
    const yp = box.dataset.yp;
    const row = box.closest('.att-row');
    row.classList.toggle('on', box.checked);
    const { error } = box.checked
      ? await db.from('attendance').insert({ consortium_id: c.id, session_id: sessionId, young_person_id: yp, organisation_id: ctx.orgId, created_by: ctx.user.id })
      : await db.from('attendance').delete().eq('session_id', sessionId).eq('young_person_id', yp);
    if (error && !/duplicate/i.test(error.message)) {
      box.checked = !box.checked;
      row.classList.toggle('on', box.checked);
      toast(errorText(error), 'error');
      return;
    }
    $('#count').textContent = $$('[data-yp]:checked').length;
    if (box.checked) tick();
  }));

  $('#quick-reg').addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      const id = await submitRegistration(ctx, e.target, s.site_id);
      const { error } = await db.from('attendance').insert({ consortium_id: c.id, session_id: sessionId, young_person_id: id, organisation_id: ctx.orgId, created_by: ctx.user.id });
      if (error && !/duplicate/i.test(error.message)) throw error;
      attendance(ctx, el, sessionId);
    });
  });
}
