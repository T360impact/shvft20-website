// Shared plumbing for the Consortium Portal: the database client, HTML
// escaping, formatting, small UI helpers and CSV export.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

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

export const rag = (r) => html`<span class="rag rag-${r || 'grey'}">${{ green: 'Green', amber: 'Amber', red: 'Red' }[r] || 'Not started'}</span>`;
export const statusPill = (s) => html`<span class="pill pill-${s}">${{
  draft: 'Draft', submitted: 'Submitted', changes_requested: 'Changes requested', approved: 'Approved',
  issued: 'Awaiting partner', partner_signed: 'Awaiting countersignature', countersigned: 'Signed',
  requested: 'Requested', returned: 'Returned',
  bid: 'Bid in progress', live: 'Live', lost: 'Not won', closed: 'Closed',
  running: 'Reading documents', needs_review: 'Needs review', confirmed: 'Confirmed', failed: 'Failed',
  proposed: 'To review', accepted: 'Accepted', edited: 'Edited', rejected: 'Rejected',
}[s] || s}</span>`;

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
