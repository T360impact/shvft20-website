// Shared plumbing for the Consortium Portal: the database client, HTML
// escaping, formatting, small UI helpers and CSV export.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { icon } from './icons.js';

export { icon };

export const db = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'shvft-portal-auth' },
});

export const ROLE_LABEL = {
  platform_admin: 'Platform administrator',
  lead: 'Partnership consortium lead',
  accountable_body: 'Accountable body',
  partner_manager: 'Delivery partner manager',
  hub_worker: 'Hub or session worker',
  funder_observer: 'Funder observer',
  youth_voice: 'Youth voice',
};

export const KIND_LABEL = {
  lead: 'Consortium lead',
  accountable_body: 'Accountable body',
  delivery_partner: 'Delivery partner',
  funder: 'Funder',
  youth_voice: 'Youth voice',
  other: 'Other',
};

export const MEASURE_LABEL = {
  reached: 'Young people reached',
  targeted: 'Targeted young people',
  targeted_pct: 'Targeted share (%)',
  sessions: 'Sessions delivered',
  attendances: 'Attendances',
  outcomes: 'Outcomes achieved',
  other: 'Other',
};

// Roles that handle young people's personal data, and so need two-step sign-in.
export const PD_ROLES = ['lead', 'accountable_body', 'partner_manager', 'hub_worker'];

// Tagged template that escapes every interpolated value unless it is
// wrapped in raw().
const RAW = Symbol('raw');
export const raw = (s) => ({ [RAW]: String(s) });
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const part = (v) => (v && v[RAW] !== undefined ? v[RAW] : Array.isArray(v) ? v.map(part).join('') : esc(v));
export function html(strings, ...values) {
  return raw(strings.reduce((out, s, i) => out + s + (i < values.length ? part(values[i]) : ''), ''));
}
export const render = (el, view) => { el.innerHTML = part(view); };

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const monthFmt = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });
const dtFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const fmtDate = (d) => (d ? dateFmt.format(new Date(String(d).length === 10 ? `${d}T12:00:00` : d)) : '');
export const fmtMonth = (d) => (d ? monthFmt.format(new Date(`${String(d).slice(0, 10)}T12:00:00`)) : '');
export const fmtDateTime = (d) => (d ? dtFmt.format(new Date(d)) : '');
export const fmtMoney = (n) => (n == null ? '' : new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(n));
export const fmtNum = (n) => (n == null ? '–' : new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 }).format(n));
export const today = () => new Date().toISOString().slice(0, 10);
export const ageOn = (dob, on = new Date()) => {
  const b = new Date(`${dob}T12:00:00`);
  let a = on.getFullYear() - b.getFullYear();
  if (on.getMonth() < b.getMonth() || (on.getMonth() === b.getMonth() && on.getDate() < b.getDate())) a -= 1;
  return a;
};

// Read a form into a plain object; empty strings become null.
export function formData(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') {
      if (el.dataset.multi) { (out[el.name] ||= []); if (el.checked) out[el.name].push(el.value); }
      else out[el.name] = el.checked;
    } else if (el.type === 'radio') {
      if (el.checked) out[el.name] = el.value;
    } else {
      const v = el.value.trim();
      out[el.name] = v === '' ? null : el.type === 'number' ? Number(v) : v;
    }
  }
  return out;
}

// Supabase errors carry the database's own message, which our functions
// write for people. Constraint failures get a plainer line.
export function errorText(error) {
  const m = error?.message || String(error || 'Something went wrong.');
  if (/duplicate key/i.test(m)) return 'That already exists.';
  if (/row-level security|permission denied/i.test(m)) return 'You don\'t have permission to do that.';
  if (/JWT|session/i.test(m)) return 'Your sign-in has expired. Please sign in again.';
  return m;
}

let toastTimer;
export function toast(message, kind = 'ok') {
  const el = $('#toast');
  el.textContent = message;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, kind === 'error' ? 6000 : 3200);
}

// Run an async action from a form or button, showing errors inline.
export async function act(button, fn) {
  const label = button?.textContent;
  if (button) { button.disabled = true; button.textContent = 'Working…'; }
  try {
    await fn();
  } catch (e) {
    toast(errorText(e), 'error');
  } finally {
    if (button) { button.disabled = false; button.textContent = label; }
  }
}

// Throw on a Supabase error so act() can show it.
export const must = ({ data, error }) => { if (error) throw error; return data; };

export function downloadCsv(filename, rows) {
  if (!rows.length) { toast('Nothing to export yet.'); return; }
  const cols = Object.keys(rows[0]);
  const cell = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// A status is always a tinted pill with an icon and words, never colour alone.
export const pill = (tone, text, iconName) => html`<span class="pill tone-${tone}">${iconName ? raw(icon(iconName, 14)) : ''}${text}</span>`;
export const rag = (r) => pill(r || 'grey', { green: 'Green', amber: 'Amber', red: 'Red' }[r] || 'Not started',
  { green: 'approved', amber: 'overdue', red: 'rejected' }[r] || 'waiting');
const STATUS = {
  draft: ['grey', 'Draft', 'waiting'], submitted: ['blue', 'Submitted', 'submitted'], changes_requested: ['amber', 'Changes requested', 'returned'],
  approved: ['green', 'Approved', 'approved'], issued: ['blue', 'Awaiting partner', 'submitted'], partner_signed: ['amber', 'Awaiting countersignature', 'due'],
  countersigned: ['green', 'Signed', 'approved'], requested: ['amber', 'Requested', 'due'], returned: ['amber', 'Returned', 'returned'],
  bid: ['blue', 'Bid in progress', 'bids'], live: ['green', 'Live', 'approved'], lost: ['grey', 'Not won', 'rejected'], closed: ['grey', 'Closed', 'waiting'],
  running: ['blue', 'Reading documents', 'due'], needs_review: ['blue', 'Needs review', 'info'], confirmed: ['green', 'Confirmed', 'approved'],
  failed: ['red', 'Failed', 'rejected'], proposed: ['blue', 'To review', 'waiting'], accepted: ['green', 'Accepted', 'approved'],
  edited: ['green', 'Edited', 'approved'], rejected: ['red', 'Rejected', 'rejected'], overdue: ['red', 'Overdue', 'overdue'],
  paid: ['green', 'Paid', 'paid'], due: ['amber', 'Due', 'due'],
};
export const statusPill = (s) => { const [tone, text, ic] = STATUS[s] || ['grey', s, 'info']; return pill(tone, text, ic); };

// A short headline for a long funder statement: the wording without its
// "Number of young people that ..." preamble, brackets or "as a result of
// this funding", eight words at most. The full wording stays available.
export function headline(label, max = 8) {
  let s = String(label || '').replace(/\s*\([^)]*\)/g, '')
    .replace(/^(the )?(%|percentage) of (unique )?young people/i, 'Share of young people')
    .replace(/^(the )?(total )?number of (unique )?young people (that|who) (report |have )?/i, '')
    .replace(/^(the )?(total )?number of (unique )?young people/i, 'Young people')
    .replace(/\s+(as a result of|through|as part of) this funding/gi, '').trim();
  s = s.charAt(0).toUpperCase() + s.slice(1);
  const words = s.split(/\s+/);
  return words.length > max ? `${words.slice(0, max).join(' ')}…` : s;
}

// A due date as a pill: overdue in red, within a week in amber, later in blue.
export const duePill = (d, status) => {
  if (!d) return '';
  if (status === 'approved') return pill('green', fmtDate(d), 'approved');
  const n = daysUntil(d);
  if (n < 0) return pill('red', `${-n} day${n === -1 ? '' : 's'} overdue`, 'overdue');
  if (n <= 7) return pill('amber', n === 0 ? 'Due today' : `Due in ${n} day${n === 1 ? '' : 's'}`, 'due');
  return pill('blue', `Due ${fmtDate(d)}`, 'due');
};

// Days to a deadline as a chip with an alarm clock: amber under a week, red
// under three days.
export const countdown = (d) => {
  if (!d) return '';
  const n = daysUntil(d);
  const tone = n < 3 ? 'red' : n < 7 ? 'amber' : 'blue';
  return html`<span class="pill tone-${tone} countdown">${raw(icon('expiry', 14))}${n < 0 ? 'Deadline passed' : n === 0 ? 'Deadline today' : `${n} day${n === 1 ? '' : 's'} to the deadline`}</span>`;
};

// Big number, short label, and a trend in status colour.
export const statCard = ({ icon: ic, mod = 'brand', value, label, trend }) => html`<div class="stat m-${mod}">
  <div class="stat-top"><span class="stat-label">${label}</span>${ic ? html`<span class="stat-icon">${raw(icon(ic, 18))}</span>` : ''}</div>
  <div class="stat-value"><b>${value}</b>${trend?.chip ? html`<span class="stat-chip ${trend.tone}">${trend.chip}</span>` : ''}</div>
  ${trend ? html`<div class="stat-foot ${trend.tone}">${raw(icon({ up: 'up', down: 'down', flat: 'flat' }[trend.dir] || 'flat', 14))}<span>${trend.text}</span></div>` : ''}</div>`;

// Icon, one sentence, one button.
export const emptyState = (ic, text, action = '', mod = '') => html`<div class="empty-state ${mod ? `m-${mod}` : ''}">${raw(icon(ic, 48))}<p>${text}</p>${action}</div>`;

// Row details in a side drawer, so tables keep to the columns that matter.
export function openDrawer(title, body) {
  const d = document.createElement('dialog');
  d.className = 'drawer';
  d.setAttribute('aria-label', title);
  render(d, html`<div class="drawer-in"><header><h2>${title}</h2>
    <button type="button" class="icon-btn" data-close aria-label="Close">${raw(icon('close', 20))}</button></header>${body}</div>`);
  document.body.append(d);
  d.addEventListener('close', () => d.remove());
  d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-close]')) d.close(); });
  d.showModal();
  return d;
}

export const daysUntil = (d) => (d ? Math.round((new Date(`${d}T12:00:00`) - new Date(`${today()}T12:00:00`)) / 864e5) : null);

// Upload a file to private storage under a folder, keeping a readable name.
export async function uploadFile(bucket, folder, file) {
  const safe = file.name.replace(/[^\w.\-]+/g, '_').slice(-80);
  const path = `${folder}/${crypto.randomUUID()}-${safe}`;
  must(await db.storage.from(bucket).upload(path, file, { contentType: file.type || undefined }));
  return path;
}

// Open a private file in a new tab. The tab opens during the click so
// pop-up blockers allow it, then points at a link that works for a minute.
export function openFile(button, bucket, path) {
  const tab = window.open('', '_blank');
  if (tab) tab.opener = null;
  act(button, async () => {
    try {
      const { signedUrl } = must(await db.storage.from(bucket).createSignedUrl(path, 60));
      if (tab) tab.location = signedUrl; else location.href = signedUrl;
    } catch (e) { tab?.close(); throw e; }
  });
}

// ------------------------------------------------- grouped lists, not long ones
// The portal never lays out long runs of rows. Lists are grouped into short
// collapsible sections, each with a one-line summary, and switched with
// segments; every row stays one click away.

// A segmented switch. Panes marked data-seg-pane="name:value" show for their
// value; the empty value ('') shows them all.
export const segControl = (name, options, selected) => html`<div class="seg" role="group" data-seg-for="${name}">${options.map(([v, label]) => html`<button type="button" class="seg-btn" data-seg="${v}" aria-pressed="${String(v) === String(selected)}">${label}</button>`)}</div>`;
export function bindSegments(root = document) {
  $$('[data-seg-for]', root).forEach((bar) => {
    const name = bar.dataset.segFor;
    const apply = (v) => {
      $$('[data-seg]', bar).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.seg === v)));
      $$(`[data-seg-pane^="${name}:"]`, root).forEach((p) => { p.hidden = v !== '' && p.dataset.segPane !== `${name}:${v}`; });
    };
    $$('[data-seg]', bar).forEach((b) => b.addEventListener('click', () => apply(b.dataset.seg)));
    apply($('[aria-pressed="true"]', bar)?.dataset.seg ?? '');
  });
}

// A collapsible section: a title, a one-line summary, an optional bar or pill
// on the right, and the rows inside.
export const sectionGroup = ({ title, meta = '', aside = '', body, open = false }) => html`<details class="tgroup" ${raw(open ? 'open' : '')}>
  <summary><span class="tg-title">${title}</span><span class="tg-meta">${meta}</span><span class="tg-aside">${aside}</span><span class="tg-chev" aria-hidden="true"></span></summary>
  <div class="tg-body">${body}</div></details>`;

// A thin bar of counts by tone, for a section's summary line.
export const toneBar = (parts) => {
  const shown = parts.filter(([, n]) => n);
  return shown.length ? html`<span class="tg-bar" role="img" aria-label="${shown.map(([t, n, label]) => `${n} ${label || t}`).join(', ')}">${shown.map(([t, n]) => html`<i class="seg-${t}" style="flex:${n}"></i>`)}</span>` : '';
};
