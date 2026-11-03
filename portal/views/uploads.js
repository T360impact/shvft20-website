// Weekly figures: each partner uploads its weekly register summary (from
// T360, or the blank template), the portal checks it, shows what it will
// count towards, and counts it once the uploader confirms. The portal holds
// no individual young person's details: a file with names, dates of birth,
// contact details or full postcodes is turned away before anything is kept.
import { db, html, raw, render, $, $$, must, act, toast, icon, pill, statCard, openDrawer, fmtDate, fmtDateTime, fmtMonth, fmtNum,
  sectionGroup, emptyState, uploadFile, liveMark, live } from '../lib.js';

const XLSX_URL = '/portal/vendor/xlsx-0.20.3.mjs';
let sheetjs;
const loadXlsx = async () => (sheetjs ||= await import(XLSX_URL));

export const TEMPLATE_VERSION = 'T360-WRS-1';
export const FIELDS = ['sessions_delivered', 'total_attendances', 'unique_young_people', 'new_to_consortium', 'new_to_organisation',
  'returning_young_people', 'targeted_unique', 'targeted_attendances', 'age_14_15', 'age_16_17', 'age_18_20', 'age_21_24', 'out_of_range',
  'female', 'male', 'non_binary', 'prefer_not_to_say_gender', 'imd_decile_1_2', 'imd_decile_3_4', 'imd_decile_5_10', 'imd_unknown',
  'referrals_made', 'referrals_received', 'outreach_hours', 'surveys_completed', 'matched_pre_post_pairs'];
export const COLUMNS = ['template_version', 'week_start', 'week_end', 'organisation', 'site', 'programme', ...FIELDS, 'notes'];
const TEXT_COLS = ['organisation', 'site', 'programme', 'notes'];
const UPLOAD_ROLES = ['org_admin', 'reporting', 'partner_manager', 'accountable_body'];
const ST = { confirmed: ['green', 'Confirmed'], validated: ['blue', 'Checked, not confirmed'], needs_attention: ['red', 'Needs attention'] };

// The same checks the database runs, so a file is turned away before it
// leaves the browser. Names are checked again on the server.
const PII_HEADING = /\b(name|names|first ?name|forename|surname|last ?name|full ?name|dob|date of birth|birth ?date|birthday|postcode|post code|address|e-?mail|phone|mobile|telephone|tel|nhs number|upn|member (code|id)|t360 id|person id)\b/i;
// Names of places and things ("Site name", "Programme name") are fine.
const THING_NAME = /\b(site|programme|program|organisation|organization|org|venue|hub|club|school|project|activity|session|partner|provider|team|area|ward|borough|outcome|measure|file|sheet|funder|course)[ _-]*names?\b/gi;
const piiHeading = (h) => PII_HEADING.test(String(h).replace(/[_-]+/g, ' ').replace(THING_NAME, ' '));
const piiCell = (t) => {
  const s = String(t ?? '');
  if (!s.trim()) return null;
  if (/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(s)) return 'an email address';
  if (/(\+44|0)7\d{9}|(\+44|0)[1-3]\d{8,9}/.test(s.replace(/[\s().-]/g, ''))) return 'a phone number';
  if (/(^|[^A-Z0-9])[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][ABD-HJLNP-UW-Z]{2}([^A-Z0-9]|$)/.test(s.toUpperCase())) return 'a full postcode';
  if (/\b(dob|d\.o\.b|date of birth|born on)\b/i.test(s)) return 'a date of birth';
  return null;
};
const norm = (h) => String(h ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const toDate = (v) => {
  if (v instanceof Date) return iso(v);
  const s = String(v ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : s;
};
const canUpload = (ctx) => !!ctx.orgId && (UPLOAD_ROLES.includes(ctx.role) || ctx.extraRoles.some((r) => UPLOAD_ROLES.includes(r)));

export default async function uploads(ctx, el) {
  const c = ctx.consortium;
  const since = iso(new Date(Date.now() - 120 * 864e5));
  const [subs, ups] = await Promise.all([
    db.from('weekly_submissions').select('id, organisation_id, site_id, programme_id, week_start, status, unique_young_people, new_to_consortium, total_attendances, sessions_delivered, targeted_unique, out_of_range, problems, replaced_at, confirmed_at, source_file_id')
      .eq('consortium_id', c.id).gte('week_start', since).order('week_start', { ascending: false }).then(must),
    db.from('report_uploads').select('id, organisation_id, file_name, storage_path, status, uploaded_at').eq('consortium_id', c.id).order('uploaded_at', { ascending: false }).limit(20).then(must),
  ]);
  const progs = must(await db.from('programmes').select('id, name, kind').eq('consortium_id', c.id).order('name'));
  const current = subs.filter((s) => s.status === 'confirmed' && !s.replaced_at);
  const mondays = Array.from({ length: 8 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 7 * (i + 1)); return iso(d); });
  const orgs = ctx.seesAll ? ctx.orgs.filter((o) => ['delivery_partner', 'accountable_body'].includes(o.kind)) : ctx.orgs.filter((o) => o.id === ctx.orgId);
  const missing = (o) => mondays.filter((m) => !current.some((s) => s.organisation_id === o.id && s.week_start === m));
  const attention = subs.filter((s) => s.status === 'needs_attention' && !s.replaced_at);
  const lastWeek = current.reduce((a, s) => (s.week_start > a ? s.week_start : a), '');
  const name = (list, id) => list.find((x) => x.id === id)?.name || '–';
  const months = [...new Set(current.map((s) => s.week_start.slice(0, 7)))];

  render(el, html`
    <div class="page-head"><div><span class="eyebrow">Weekly figures</span><h1>Weekly figures</h1>
      <p class="muted">Each week's register summary, by site and programme. Totals only: the portal never holds a young person's details.</p>
      <p style="margin-top:8px">${liveMark()}</p></div>
      <div class="btns"><button type="button" class="btn secondary" id="tpl">${raw(icon('download', 16))}Blank template</button>
        ${canUpload(ctx) ? html`<button type="button" class="btn" id="up">${raw(icon('upload', 16))}Upload a week</button>` : ''}</div></div>
    <div class="stats stats-4">
      ${statCard({ icon: 'approved', value: lastWeek ? fmtDate(lastWeek) : 'None yet', label: 'Last confirmed week' })}
      ${statCard({ icon: 'overdue', value: orgs.reduce((n, o) => n + missing(o).length, 0), label: 'Weeks missing', trend: { dir: 'flat', tone: 'grey', text: 'in the last 8 weeks' } })}
      ${statCard({ icon: 'returned', value: attention.length, label: 'Need attention', trend: { dir: 'flat', tone: attention.length ? 'red' : 'green', text: 'totals that don\'t add up' } })}
      ${statCard({ icon: 'youngPeople', value: fmtNum(current.reduce((n, s) => n + s.new_to_consortium, 0)), label: 'New young people', trend: { dir: 'flat', tone: 'grey', text: 'new to the consortium, last 4 months' } })}</div>
    <div class="dgrid">
      <section class="dcard full"><header class="dcard-head"><h2>Missing weeks</h2><p>Monday to Sunday weeks with no confirmed upload. Partners are reminded each Tuesday.</p></header>
        ${orgs.map((o, i) => sectionGroup({ title: o.name, meta: missing(o).length ? `${missing(o).length} missing` : 'all in', open: i === 0 && missing(o).length > 0,
          aside: missing(o).length ? pill('amber', `${missing(o).length}`) : pill('green', 'Up to date'),
          body: missing(o).length ? html`<p class="small">${missing(o).map((m) => `week of ${fmtDate(m)}`).join(' · ')}</p>` : html`<p class="small muted">Every week in the last eight is confirmed.</p>` }))}</section>
      <section class="dcard full"><header class="dcard-head"><h2>Confirmed weeks</h2><p>The counted version of each week. A re-upload replaces a week; the earlier version is kept.</p></header>
        ${months.length ? months.map((m, i) => { const rows = current.filter((s) => s.week_start.startsWith(m)); return sectionGroup({ title: fmtMonth(`${m}-01`), meta: `${new Set(rows.map((r) => r.week_start)).size} weeks · ${rows.length} site and programme row${rows.length === 1 ? '' : 's'}`, open: i === 0,
          body: html`<div class="table-wrap"><table><thead><tr><th>Week of</th>${ctx.seesAll ? html`<th>Partner</th>` : ''}<th>Site</th><th>Programme</th><th class="num">Unique</th><th class="num">New</th><th class="num">Attendances</th><th class="num">Sessions</th></tr></thead>
            <tbody>${rows.map((s) => html`<tr><td>${fmtDate(s.week_start)}</td>${ctx.seesAll ? html`<td>${name(ctx.orgs, s.organisation_id)}</td>` : ''}<td>${name(ctx.sites, s.site_id)}</td><td>${name(progs, s.programme_id)}</td>
              <td class="num">${fmtNum(s.unique_young_people - s.out_of_range)}</td><td class="num">${fmtNum(s.new_to_consortium)}</td><td class="num">${fmtNum(s.total_attendances)}</td><td class="num">${fmtNum(s.sessions_delivered)}</td></tr>`)}</tbody></table></div>` }); })
          : emptyState('spreadsheet', 'No weeks confirmed yet.', canUpload(ctx) ? html`<button type="button" class="btn" data-up>Upload a week</button>` : '')}</section>
      ${attention.length ? html`<section class="dcard full"><header class="dcard-head"><h2>Needs attention</h2><p>Uploaded but not counted: these totals don't add up.</p></header>
        <ul class="lw-list">${attention.map((s) => html`<li class="lw-row static"><span class="lw-row-main"><strong>Week of ${fmtDate(s.week_start)} · ${name(ctx.sites, s.site_id)}</strong>
          <span class="small">${(s.problems || []).filter((p) => p.blocking).map((p) => p.message).join(' ')}</span></span></li>`)}</ul></section>` : ''}
      ${sectionGroup({ title: 'Recent uploads', meta: `${ups.length}`, body: ups.length ? html`<ul class="lw-list">${ups.map((u) => html`<li class="lw-row static"><span class="lw-row-main"><strong>${u.file_name || 'Upload'}</strong>
        <span class="muted small">${ctx.seesAll ? `${name(ctx.orgs, u.organisation_id)} · ` : ''}${fmtDateTime(u.uploaded_at)}</span></span><span class="lw-row-tags">${pill(u.status === 'confirmed' ? 'green' : 'grey', u.status)}</span></li>`)}</ul>` : html`<p class="muted small">None.</p>` })}
    </div>`);

  $('#tpl', el)?.addEventListener('click', (e) => act(e.currentTarget, () => downloadTemplate(ctx, progs)));
  $$('#up, [data-up]', el).forEach((b) => b.addEventListener('click', () => openUpload(ctx, progs, () => uploads(ctx, el))));
  live(c.id, () => { if (!document.querySelector('dialog[open]')) uploads(ctx, el); });
}

// The blank template, for partners not on T360: a README and a Data sheet.
async function downloadTemplate(ctx, progs) {
  const X = await loadXlsx();
  const wb = X.utils.book_new();
  const readme = [['Weekly register summary', ''], ['Template version', TEMPLATE_VERSION], ['', ''],
    ['What this is', 'One row per site per programme per week (Monday to Sunday). Totals only.'],
    ['Never include', 'Names, dates of birth, postcodes, member codes, contact details or anything about one young person. A file with any of these is turned away.'],
    ['Must add up', 'new_to_organisation + returning_young_people = unique_young_people. The age columns (including out_of_range), the gender columns and the IMD columns each add up to unique_young_people.'],
    ['new_to_consortium', 'Young people new to the whole consortium this week. On T360 this comes from the shared register; without T360, count those you know are new to every partner.'],
    ['out_of_range', 'Young people outside the programme\'s ages. They are not counted towards the targets.'],
    ['Sites', ctx.sites.map((s) => s.name).join(', ') || 'Ask the consortium lead'], ['Programmes', progs.map((p) => p.name).join(', ') || 'Ask the consortium lead']];
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(readme), 'README');
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([COLUMNS, [TEMPLATE_VERSION, '', '', ctx.orgName || '', '', '', ...FIELDS.map(() => 0), '']]), 'Data');
  X.writeFile(wb, 'weekly-register-summary.xlsx');
}

// A file handed over from "Upload a report" (preset) is read straight away.
export function openUpload(ctx, progs, done, preset = null) {
  const d = openDrawer('Upload weekly figures', html`<div id="wk">
    <p class="small muted">The weekly register summary from T360, or the blank template. One row per site, programme and week.</p>
    <label class="f">File (.xlsx or .csv)<input type="file" id="wk-file" accept=".xlsx,.xls,.csv"></label><div id="wk-step"></div></div>`);
  const step = $('#wk-step', d);
  const state = { file: null, headers: [], rows: [], version: null, mapping: null };
  const read = async (file, input) => {
    state.file = file;
    try {
      const X = await loadXlsx();
      const wb = X.read(await file.arrayBuffer(), { cellDates: true });
      const ws = wb.Sheets.Data || wb.Sheets[wb.SheetNames.find((n) => !/readme/i.test(n)) || wb.SheetNames[0]];
      const aoa = X.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' }).filter((r) => r.some((v) => String(v).trim() !== ''));
      if (aoa.length < 2) throw new Error('The file has no rows of figures.');
      const headers = aoa[0].map((h) => String(h).trim());
      // Turned away here, before anything leaves the browser.
      const bad = headers.find(piiHeading);
      if (bad) throw new Error(`This file has a “${bad}” column, which would identify young people. The portal only takes totals: remove that column (or use the weekly summary from T360) and upload again. Nothing from this file has been kept.`);
      aoa.slice(1).forEach((r, i) => r.forEach((v, j) => { if (typeof v === 'string' && !/^-?\d+(\.\d+)?$/.test(v.trim())) { const why = piiCell(v); if (why) throw new Error(`Row ${i + 2}, column “${headers[j]}” contains what looks like ${why}. Remove it and upload again. Nothing from this file has been kept.`); } }));
      state.headers = headers; state.raw = aoa.slice(1);
      const idx = Object.fromEntries(headers.map((h, i) => [norm(h), i]));
      const version = state.raw[0][idx.template_version];
      if (String(version).trim() === TEMPLATE_VERSION && COLUMNS.every((c) => c in idx || c === 'notes')) {
        state.version = TEMPLATE_VERSION; state.mapping = Object.fromEntries(COLUMNS.map((c) => [c, idx[c]]));
        await stage(ctx, d, step, state, progs, done);
      } else {
        mapColumns(ctx, d, step, state, progs, done);
      }
    } catch (err) {
      if (input) input.value = '';
      render(step, html`<div class="banner bad" role="alert" style="margin-top:12px">${err.message}</div>`);
    }
  };
  $('#wk-file', d).addEventListener('change', (e) => { if (e.target.files[0]) read(e.target.files[0], e.target); });
  if (preset) read(preset, null);
}

// A file not in the template: the uploader confirms which column is which.
// "Suggest" asks AI for a mapping from the headings and three sample values
// (the file has already passed the identifying-details checks).
function mapColumns(ctx, d, step, state, progs, done) {
  const need = COLUMNS.filter((c) => c !== 'template_version');
  // Common headings for the same figures.
  const ALIAS = { week_start: ['week', 'week_commencing', 'w_c', 'wc', 'week_beginning', 'from'], week_end: ['to', 'week_ending'], site: ['site_name', 'venue', 'location', 'hub'],
    programme: ['programme_name', 'program', 'project', 'activity'], organisation: ['organisation_name', 'organization', 'partner', 'org'],
    total_attendances: ['attendances', 'attendance', 'visits', 'total_visits'], unique_young_people: ['unique_yp', 'unique', 'young_people', 'individuals', 'unique_individuals'],
    sessions_delivered: ['sessions', 'no_of_sessions', 'number_of_sessions'], new_to_organisation: ['new', 'new_young_people', 'new_yp', 'new_starters'],
    returning_young_people: ['returning', 'returners', 'repeat'], targeted_unique: ['targeted', 'targeted_young_people', 'targeted_yp'], notes: ['note', 'comments', 'comment'] };
  const guess = (c) => state.headers.findIndex((h) => { const n = norm(h); return n === c || n.replace(/_/g, '') === c.replace(/_/g, '') || (ALIAS[c] || []).includes(n); });
  const samples = (j) => state.raw.slice(0, 3).map((r) => r[j]).filter((v) => v !== '').map((v) => (v instanceof Date ? iso(v) : String(v).slice(0, 30))).join(', ');
  const opts = (sel) => html`<option value="">Not in this file</option>${state.headers.map((h, j) => html`<option value="${j}" ${sel === j ? 'selected' : ''}>${h} (${samples(j) || 'empty'})</option>`)}`;
  render(step, html`<div class="banner warn" style="margin-top:12px">This file isn't in the standard template, so confirm which column holds each figure. Columns left out count as 0.</div>
    <div class="btns" style="margin:12px 0"><button type="button" class="btn secondary small" id="ai-map">${raw(icon('info', 16))}Suggest a mapping</button></div>
    <form class="form" id="map-form">${need.map((c) => html`<label class="f">${c.replace(/_/g, ' ')}<select name="${c}">${opts(guess(c) >= 0 ? guess(c) : null)}</select></label>`)}
    <div class="btns"><button class="btn">Check these figures</button></div></form>`);
  $('#ai-map', step).addEventListener('click', (e) => act(e.currentTarget, async () => {
    const { data, error } = await db.functions.invoke('map-columns', { body: { consortium_id: ctx.consortium.id, columns: COLUMNS, headers: state.headers.map((h, j) => ({ heading: h, samples: samples(j) })) } });
    if (error || !data?.mapping) throw new Error('No suggestion this time. Choose the columns yourself.');
    Object.entries(data.mapping).forEach(([c, j]) => { const s = $(`select[name="${c}"]`, step); if (s && j != null && j >= 0) s.value = String(j); });
    toast('Suggested. Check each one before going on.');
  }));
  $('#map-form', step).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => {
    const f = new FormData(e.target);
    state.mapping = Object.fromEntries(need.map((c) => [c, f.get(c) === '' ? null : Number(f.get(c))]));
    state.version = null;
    await stage(ctx, d, step, state, progs, done);
  }); });
}

function buildRows(state) {
  return state.raw.map((r, i) => {
    const o = {};
    for (const c of COLUMNS) {
      const j = state.mapping[c];
      const v = j == null ? '' : r[j];
      if (c === 'week_start' || c === 'week_end') o[c] = v === '' ? '' : toDate(v);
      else if (TEXT_COLS.includes(c) || c === 'template_version') o[c] = String(v ?? '').trim();
      else {
        const n = v === '' || v == null ? 0 : Number(v);
        if (!Number.isFinite(n) || n < 0 || (c !== 'outreach_hours' && !Number.isInteger(n))) throw new Error(`Row ${i + 2}: “${v}” isn't a whole number for ${c.replace(/_/g, ' ')}.`);
        o[c] = n;
      }
    }
    return o;
  });
}

async function stage(ctx, d, step, state, progs, done) {
  const rows = buildRows(state);
  const res = must(await db.rpc('stage_weekly', { p_consortium: ctx.consortium.id, p_headers: state.headers, p_rows: rows,
    p_template_version: state.version, p_file_name: state.file.name, p_mapping: state.mapping }));
  if (res.unknown) return mapNames(ctx, d, step, state, progs, done, res.unknown);
  preview(ctx, d, step, state, res, done);
}

// Site or programme names the workspace doesn't know: map once, remembered.
function mapNames(ctx, d, step, state, progs, done, unknown) {
  const rowsFor = (kind, list) => unknown[kind].map((n) => html`<label class="f">“${n}” is<select name="${kind}:${n}" required><option value="">Choose…</option>${list.map((x) => html`<option value="${x.id}">${x.name}</option>`)}</select></label>`);
  render(step, html`<div class="banner warn" style="margin-top:12px">Some names in the file aren't this workspace's. Say which they are; the portal remembers for next time.</div>
    <form class="form" id="names-form">${unknown.sites.length ? html`<fieldset><legend>Sites</legend>${rowsFor('sites', ctx.sites)}</fieldset>` : ''}
      ${unknown.programmes.length ? html`<fieldset><legend>Programmes</legend>${progs.length ? rowsFor('programmes', progs) : html`<p class="small">This workspace has no programmes yet. Ask the consortium lead to add them.</p>`}</fieldset>` : ''}
      <div class="btns"><button class="btn">Save and check again</button></div></form>`);
  $('#names-form', step).addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => {
    for (const [k, v] of new FormData(e.target)) {
      const [kind, ...rest] = k.split(':');
      must(await db.rpc('save_upload_alias', { p_consortium: ctx.consortium.id, p_kind: kind === 'sites' ? 'site' : 'programme', p_alias: rest.join(':'), p_target: v }));
    }
    await stage(ctx, d, step, state, progs, done);
  }); });
}

// What will count towards which target, before anything counts.
function preview(ctx, d, step, state, res, done) {
  const blocked = res.rows.filter((r) => r.status === 'needs_attention');
  render(step, html`
    <div class="banner ${blocked.length ? 'bad' : 'ok'}" style="margin-top:12px">${blocked.length
      ? `${blocked.length} row${blocked.length === 1 ? '' : 's'} don't add up. Correct the file and upload it again; nothing has been counted.`
      : `${res.rows.length} row${res.rows.length === 1 ? '' : 's'} checked. Nothing counts until you confirm.`}</div>
    ${res.rows.map((r, i) => sectionGroup({ title: `Week of ${fmtDate(r.week_start)} · ${r.site || 'No site'} · ${r.programme || 'No programme'}`,
      meta: r.replaces ? 'replaces the earlier upload' : '', open: i < 3 || r.status === 'needs_attention',
      aside: pill(...(ST[r.status] || ['grey', r.status])),
      body: html`${(r.problems || []).map((p) => html`<p class="small ${p.blocking ? 'warn-text' : 'muted'}">${p.blocking ? raw(icon('returned', 14)) : raw(icon('info', 14))} ${p.message}</p>`)}
        <p class="small">Unique ${fmtNum(r.figures.unique_young_people)} · new to the consortium ${fmtNum(r.figures.new_to_consortium)} · attendances ${fmtNum(r.figures.total_attendances)} · sessions ${fmtNum(r.figures.sessions_delivered)}</p>
        ${r.counts.length ? html`<ul class="small">${r.counts.map((x) => html`<li>${x.label}: <strong>${x.aggregation === 'ratio' ? `${x.value ?? '–'}%` : fmtNum(x.value)}</strong> this week</li>`)}</ul>`
          : html`<p class="small muted">No target is mapped to these figures yet.</p>`}` }))}
    <div class="btns" style="margin-top:12px"><button type="button" class="btn" id="wk-confirm" ${blocked.length ? 'disabled' : ''}>Confirm and count</button></div>`);
  $('#wk-confirm', step)?.addEventListener('click', (e) => act(e.currentTarget, async () => {
    // The file is kept only now, after the checks.
    const path = await uploadFile('documents', `${ctx.consortium.id}/weekly/${ctx.orgId}`, state.file);
    must(await db.from('report_uploads').update({ storage_path: path }).eq('id', res.upload_id));
    must(await db.rpc('confirm_weekly', { p_upload: res.upload_id }));
    d.close(); toast('Confirmed. The figures now count.'); done();
  }));
}
