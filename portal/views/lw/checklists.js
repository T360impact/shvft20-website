// Hub checklists. Built for a phone at the door: pick the hub and day, then
// one list per checklist with large tap targets. Tap to tick, tap again to
// untick, "Not done" asks for a reason. A checklist submits only when every
// required item is ticked or has a reason; the hub lead signs it off.
// Rings show completion per hub per day and for the week.
import { html, raw, render, $, $$, db, must, act, toast, icon, pill, openDrawer, fmtDate, formData, today, emptyState, sectionGroup, uploadFile } from '../../lib.js';
import { RHYTHM, hubsOf, hubName, isSenior, miniRing } from './common.js';

// Picked hub, date and view survive a live refresh.
const ui = (ctx) => ctx.lwUi || (ctx.lwUi = {});

const ORDER = ['saturday_before', 'saturday_during', 'saturday_close', 'weekly', 'monthly', 'termly'];
const weekStart = (d) => { const x = new Date(`${d}T12:00:00`); const n = (x.getDay() + 6) % 7; x.setDate(x.getDate() - n); return x.toISOString().slice(0, 10); };
const addDays = (d, n) => { const x = new Date(`${d}T12:00:00`); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };

export default async function checklists(ctx, el, refresh) {
  const c = ctx.consortium.id;
  const hubs = hubsOf(ctx);
  if (!hubs.length) { render(el, emptyState('sites', 'Add a hub first. The lead does this under Team and hubs.')); return; }
  const state = ui(ctx)._cl || (ui(ctx)._cl = { hub: hubs[0].id, date: today() });

  const draw = async () => {
    const wk = weekStart(state.date);
    const [list, comp, overdue, hubDays] = await Promise.all([
      db.rpc('lw_checklists', { p_consortium: c, p_date: state.date, p_hub: state.hub }).then(must),
      db.rpc('lw_checklist_completion', { p_consortium: c, p_from: wk, p_to: addDays(wk, 6) }).then(must),
      db.rpc('lw_checklist_overdue', { p_consortium: c }).then(must),
      db.from('hubs').select('id, delivery_days').eq('consortium_id', c).then(must),
    ]);
    const sum = (rows) => rows.reduce((a, r) => ({ t: a.t + r.ticked, n: a.n + r.not_done, all: a.all + r.total }), { t: 0, n: 0, all: 0 });
    // Only the days the hubs deliver on, so the grid fits a phone.
    const dows = new Set(hubDays.flatMap((h) => h.delivery_days || [6]));
    const days = Array.from({ length: 7 }, (_, i) => addDays(wk, i)).filter((d, i) => dows.has(i + 1));
    render(el, html`
      ${overdue.length ? html`<div class="lead-banner"><span><strong>${overdue.length} checklist${overdue.length === 1 ? ' is' : 's are'} overdue and not submitted.</strong>
        ${overdue.slice(0, 3).map((o) => `${hubName(ctx, o.hub_id)}, ${(RHYTHM[o.rhythm] || o.name).toLowerCase()}, ${fmtDate(o.period_date)}`).join('; ')}</span></div>` : ''}
      <div class="filters lw-filters">
        ${hubs.length > 1 ? html`<label class="f">Hub<select id="cl-hub">${hubs.map((h) => html`<option value="${h.id}" ${raw(h.id === state.hub ? 'selected' : '')}>${h.name}</option>`)}</select></label>` : ''}
        <label class="f">Day<input type="date" id="cl-date" value="${state.date}"></label>
        ${isSenior(ctx) ? html`<button type="button" class="btn secondary small" id="tpl">Checklist templates</button>` : ''}</div>
      <div class="panel lw-week"><header><h2>This week</h2><span class="muted small">Week of ${fmtDate(wk)} · green ticked, amber not done</span></header>
        <div class="lw-ring-grid" style="--days:${days.length}">
          <span></span>${days.map((d) => html`<span class="small muted lw-day ${d === state.date ? 'on' : ''}">${new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short' })}</span>`)}<span class="small muted">Week</span>
          ${hubs.map((h) => {
            const mine = comp.filter((r) => r.hub_id === h.id);
            const w = sum(mine);
            return html`<span class="small lw-hubname">${h.name}</span>${days.map((d) => { const s = sum(mine.filter((r) => r.date === d && r.rhythm.startsWith('saturday'))); return html`<button type="button" class="lw-ringbtn" data-day="${d}" data-hub="${h.id}">${miniRing(s.t, s.n, s.all, 40)}</button>`; })}
              <span>${miniRing(w.t, w.n, w.all, 48)}</span>`;
          })}</div></div>
      ${list.length ? ORDER.flatMap((r) => list.filter((i) => i.rhythm === r)).map((inst) => instanceCard(inst)) : emptyState('check', `No checklists for ${hubName(ctx, state.hub)} on ${fmtDate(state.date)}. Delivery-day checklists appear on the hub's delivery days.`)}`);
    $('#cl-hub', el)?.addEventListener('change', (e) => { state.hub = e.target.value; draw(); });
    $('#cl-date', el).addEventListener('change', (e) => { state.date = e.target.value || today(); draw(); });
    $$('.lw-ringbtn', el).forEach((b) => b.addEventListener('click', () => { state.date = b.dataset.day; state.hub = b.dataset.hub; draw(); }));
    $('#tpl', el)?.addEventListener('click', () => templates(ctx, draw));
    bindInstances(list);
  };

  const instanceCard = (inst) => {
    const ticks = Object.fromEntries(inst.ticks.map((t) => [t.item_id, t]));
    const open = inst.status === 'open';
    const left = inst.items.filter((i) => i.required && !ticks[i.id]).length;
    const done = inst.items.filter((i) => ticks[i.id]?.state === 'ticked').length;
    const nd = inst.items.filter((i) => ticks[i.id]?.state === 'not_done').length;
    return html`<section class="panel lw-cl" data-inst="${inst.id}">
      <header><div><h2>${RHYTHM[inst.rhythm] || inst.name}</h2><span class="muted small">${inst.name}${inst.rhythm.startsWith('saturday') ? '' : ` · from ${fmtDate(inst.period_date)}`}</span></div>
        <span class="lw-cl-state">${miniRing(done, nd, inst.items.length, 40)}
          ${inst.status === 'signed_off' ? pill('green', 'Signed off', 'approved') : inst.status === 'submitted' ? pill('blue', 'Submitted', 'submitted') : new Date(inst.due_at) < new Date() ? pill('red', 'Overdue', 'overdue') : pill('grey', `${left} to do`, 'waiting')}</span></header>
      <ul class="lw-ticks">${inst.items.map((it) => {
        const t = ticks[it.id];
        return html`<li class="lw-tick ${t ? t.state : ''}">
          <button type="button" class="lw-tickbtn" data-item="${it.id}" ${raw(open ? '' : 'disabled')} aria-pressed="${String(t?.state === 'ticked')}">
            <span class="lw-box" aria-hidden="true">${t?.state === 'ticked' ? raw(icon('check', 18)) : t?.state === 'not_done' ? '–' : ''}</span>
            <span class="lw-tick-text">${it.text}${it.required ? '' : html` <span class="muted small">(optional)</span>`}
              ${t?.state === 'not_done' ? html`<span class="small lw-reason">Not done: ${t.reason}</span>` : ''}
              ${t?.evidence ? html`<span class="small muted">${t.evidence.includes('/checklists/') ? 'Photo added' : t.evidence}</span>` : ''}</span></button>
          ${open ? html`<button type="button" class="lw-ndbtn" data-nd="${it.id}" aria-label="Not done: ${it.text}">${t?.state === 'not_done' ? 'Edit reason' : 'Not done'}</button>` : ''}</li>`;
      })}</ul>
      <div class="btns lw-cl-actions">
        ${open ? html`<button class="btn" data-submit ${raw(left ? 'disabled' : '')}>${left ? `${left} required item${left === 1 ? '' : 's'} to go` : 'Submit checklist'}</button>` : ''}
        ${inst.status === 'submitted' && inst.can_sign_off ? html`<button class="btn" data-signoff>Sign off</button>` : ''}
        ${inst.status !== 'open' && inst.can_sign_off ? html`<button class="btn secondary" data-reopen>Reopen</button>` : ''}</div></section>`;
  };

  // Items that ask for evidence: a short note, or a photo kept in the
  // workspace's private files.
  const withEvidence = (inst, item) => {
    const d = openDrawer('Tick with evidence', html`<form class="form" id="ev-form"><p>${item.text}</p>
      ${item.evidence === 'photo' ? html`<label class="f">Photo<input type="file" name="photo" accept="image/*" capture="environment" required></label>
        <p class="small muted">Photograph the thing checked, never a young person.</p>`
        : html`<label class="f">Note<input name="note" required maxlength="1000"></label>`}
      <div class="btns"><button class="btn">Tick</button></div></form>`);
    $('#ev-form', d).addEventListener('submit', (e) => {
      e.preventDefault();
      act(e.submitter, async () => {
        let evidence = formData(e.target).note || null;
        const file = e.target.photo?.files?.[0];
        if (file) evidence = await uploadFile('lead-workspace', `${c}/checklists/${inst.id}`, file);
        must(await db.from('checklist_ticks').upsert({ instance_id: inst.id, consortium_id: c, item_id: item.id, state: 'ticked', evidence }, { onConflict: 'instance_id,item_id' }));
        d.close(); await draw();
      });
    });
  };

  const bindInstances = (list) => {
    $$('[data-inst]', el).forEach((sec) => {
      const inst = list.find((i) => i.id === sec.dataset.inst);
      const tick = (item) => inst.ticks.find((t) => t.item_id === item);
      $$('[data-item]', sec).forEach((b) => b.addEventListener('click', () => {
        const t = tick(b.dataset.item);
        const item = inst.items.find((i) => i.id === b.dataset.item);
        if (t?.state !== 'ticked' && item.evidence !== 'none') { withEvidence(inst, item); return; }
        act(b, async () => {
          if (t?.state === 'ticked') must(await db.from('checklist_ticks').delete().eq('instance_id', inst.id).eq('item_id', item.id));
          else must(await db.from('checklist_ticks').upsert({ instance_id: inst.id, consortium_id: c, item_id: item.id, state: 'ticked', reason: null }, { onConflict: 'instance_id,item_id' }));
          await draw();
        });
      }));
      $$('[data-nd]', sec).forEach((b) => b.addEventListener('click', () => {
        const t = tick(b.dataset.nd);
        const item = inst.items.find((i) => i.id === b.dataset.nd);
        const d = openDrawer('Not done', html`<form class="form" id="nd-form"><p>${item.text}</p>
          <label class="f">Why wasn't it done?<textarea name="reason" required rows="3" maxlength="1000">${t?.state === 'not_done' ? t.reason : ''}</textarea></label>
          ${item.evidence === 'note' ? html`<label class="f">Note<input name="evidence" maxlength="1000" value="${t?.evidence || ''}"></label>` : ''}
          <p class="small muted">It goes on the list for the weekly operations meeting. Don't name young people or describe incidents here; use the incident reference.</p>
          <div class="btns"><button class="btn">Save</button>${t ? html`<button type="button" class="btn secondary" id="clear">Clear</button>` : ''}</div></form>`);
        $('#nd-form', d).addEventListener('submit', (e) => {
          e.preventDefault();
          act(e.submitter, async () => {
            const f = formData(e.target);
            must(await db.from('checklist_ticks').upsert({ instance_id: inst.id, consortium_id: c, item_id: item.id, state: 'not_done', reason: f.reason, evidence: f.evidence || null }, { onConflict: 'instance_id,item_id' }));
            d.close(); await draw();
          });
        });
        $('#clear', d)?.addEventListener('click', (e) => act(e.target, async () => {
          must(await db.from('checklist_ticks').delete().eq('instance_id', inst.id).eq('item_id', item.id)); d.close(); await draw();
        }));
      }));
      $('[data-submit]', sec)?.addEventListener('click', (e) => act(e.target, async () => { must(await db.rpc('lw_checklist_submit', { p_instance: inst.id })); toast('Submitted. The hub lead signs it off.'); await draw(); }));
      $('[data-signoff]', sec)?.addEventListener('click', (e) => act(e.target, async () => { must(await db.rpc('lw_checklist_sign_off', { p_instance: inst.id })); toast('Signed off.'); await draw(); }));
      $('[data-reopen]', sec)?.addEventListener('click', (e) => act(e.target, async () => { must(await db.rpc('lw_checklist_sign_off', { p_instance: inst.id, p_reopen: true })); await draw(); }));
    });
  };

  await draw();
}

// Templates: one per rhythm (or more). Each item has its wording, whether
// it is required, and the evidence it asks for.
async function templates(ctx, done) {
  const rows = must(await db.from('checklist_templates').select('*').eq('consortium_id', ctx.consortium.id).is('retired_at', null).order('position'));
  const d = openDrawer('Checklist templates', html`<p class="small muted">New checklists use the current wording; ones already started keep theirs.</p>
    ${ORDER.map((r) => { const ts = rows.filter((t) => t.rhythm === r); return sectionGroup({ title: RHYTHM[r], meta: ts.length ? `${ts.reduce((a, t) => a + t.items.length, 0)} items` : 'None yet',
      body: html`${ts.map((t) => html`<p><button type="button" class="linkbtn" data-tpl="${t.id}">${t.name}</button> <span class="muted small">${t.items.length} items${t.active ? '' : ' · paused'}${t.owner_label ? ` · ${t.owner_label}` : ''}</span></p>`)}
        <button type="button" class="btn secondary small" data-new="${r}">Add a ${RHYTHM[r].toLowerCase()} checklist</button>` }); })}`);
  const edit = (t) => {
    d.close();
    const e2 = openDrawer(t.id ? `Edit ${t.name}` : 'New checklist', html`<form class="form" id="tpl-form">
      <label class="f">Name<input name="name" required maxlength="200" value="${t.name || ''}"></label>
      <label class="f">Rhythm<select name="rhythm">${ORDER.map((r) => html`<option value="${r}" ${raw(r === t.rhythm ? 'selected' : '')}>${RHYTHM[r]}</option>`)}</select></label>
      <label class="check"><input type="checkbox" name="active" ${raw(t.active !== false ? 'checked' : '')}> In use</label>
      <fieldset><legend>Items, in order</legend><ol class="lw-tpl-items" id="items">${(t.items || []).map((i) => itemRow(i))}</ol>
        <button type="button" class="btn secondary small" id="add-item">Add an item</button></fieldset>
      <div class="btns"><button class="btn">Save</button></div></form>`);
    $('#add-item', e2).addEventListener('click', () => { const tmp = document.createElement('ol'); render(tmp, itemRow({})); $('#items', e2).append(...tmp.children); });
    $('#items', e2).addEventListener('click', (ev) => { if (ev.target.closest('[data-rm]')) ev.target.closest('li').remove(); });
    $('#tpl-form', e2).addEventListener('submit', (ev) => {
      ev.preventDefault();
      act(ev.submitter, async () => {
        const f = formData(ev.target);
        const items = $$('#items li', e2).map((li) => ({ id: li.dataset.id || undefined, text: $('[name=it]', li).value.trim(), required: $('[name=req]', li).checked, evidence: $('[name=ev]', li).value })).filter((i) => i.text);
        const row = { name: f.name, rhythm: f.rhythm, active: !!f.active, items };
        if (t.id) must(await db.from('checklist_templates').update(row).eq('id', t.id));
        else must(await db.from('checklist_templates').insert({ consortium_id: ctx.consortium.id, ...row }));
        e2.close(); toast('Saved.'); done();
      });
    });
  };
  $$('[data-tpl]', d).forEach((b) => b.addEventListener('click', () => edit(rows.find((t) => t.id === b.dataset.tpl))));
  $$('[data-new]', d).forEach((b) => b.addEventListener('click', () => edit({ rhythm: b.dataset.new, name: RHYTHM[b.dataset.new], items: [] })));
}

const itemRow = (i) => html`<li data-id="${i.id || ''}"><input name="it" value="${i.text || ''}" maxlength="300" placeholder="What to check">
  <label class="check small"><input type="checkbox" name="req" ${raw(i.required !== false ? 'checked' : '')}> Required</label>
  <select name="ev" aria-label="Evidence"><option value="none">No evidence</option><option value="note" ${raw(i.evidence === 'note' ? 'selected' : '')}>A note</option><option value="photo" ${raw(i.evidence === 'photo' ? 'selected' : '')}>A photo</option></select>
  <button type="button" class="icon-btn" data-rm aria-label="Remove">${raw(icon('close', 16))}</button></li>`;
