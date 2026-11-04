// Shared calculations and upload checks. Run: node --test website/portal/tests/calc.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daysUntil, dueState, countdownTone, sumAmounts, percentOf, meetsMinimum, withinLimit, scoreBand, checkUpload, UPLOAD_RULES } from '../calc.js';

test('days until a date, counted in whole days from today', () => {
  assert.equal(daysUntil('2026-11-10', '2026-11-04'), 6);
  assert.equal(daysUntil('2026-11-04', '2026-11-04'), 0);
  assert.equal(daysUntil('2026-11-01', '2026-11-04'), -3);
  assert.equal(daysUntil(null, '2026-11-04'), null);
  // Across the clocks going back (25 October 2026) it is still whole days.
  assert.equal(daysUntil('2026-10-27', '2026-10-24'), 3);
  assert.equal(daysUntil('2027-01-01', '2026-12-31'), 1);
});

test('due dates: overdue red, within a week amber, later blue', () => {
  assert.deepEqual(dueState(-1), { tone: 'red', text: '1 day overdue' });
  assert.deepEqual(dueState(-5), { tone: 'red', text: '5 days overdue' });
  assert.deepEqual(dueState(0), { tone: 'amber', text: 'Due today' });
  assert.deepEqual(dueState(1), { tone: 'amber', text: 'Due in 1 day' });
  assert.deepEqual(dueState(7), { tone: 'amber', text: 'Due in 7 days' });
  assert.deepEqual(dueState(8), { tone: 'blue', text: null });
});

test('deadline countdown: red under three days, amber under a week', () => {
  assert.equal(countdownTone(-2), 'red');
  assert.equal(countdownTone(2), 'red');
  assert.equal(countdownTone(3), 'amber');
  assert.equal(countdownTone(6), 'amber');
  assert.equal(countdownTone(7), 'blue');
});

test('totals add amounts held as text or numbers', () => {
  assert.equal(sumAmounts([{ amount: '1200.50' }, { amount: 300 }, { amount: '0' }]), 1500.5);
  assert.equal(sumAmounts([]), 0);
  assert.equal(sumAmounts([{ amount: null }, { amount: 10 }]), 10);
});

test('percentage of target, and no division by a missing target', () => {
  assert.equal(percentOf(45, 60), 75);
  assert.equal(percentOf(90, 60), 150);
  assert.equal(percentOf(10, 0), 0);
  assert.equal(percentOf(10, null), 0);
});

test('targeted share against the funder\'s minimum', () => {
  assert.equal(meetsMinimum(60, 60), true);
  assert.equal(meetsMinimum(59.9, 60), false);
  assert.equal(meetsMinimum(null, 60), null);
  assert.equal(meetsMinimum(70, null), null);
});

test('funding limits: a maximum or a minimum share', () => {
  assert.equal(withinLimit(10, { limit_kind: 'max', limit_pct: 10 }), true);
  assert.equal(withinLimit(10.1, { limit_kind: 'max', limit_pct: 10 }), false);
  assert.equal(withinLimit(25, { limit_kind: 'min', limit_pct: 25 }), true);
  assert.equal(withinLimit(24, { limit_kind: 'min', limit_pct: 25 }), false);
});

test('a workspace score as a status', () => {
  assert.equal(scoreBand(null), 'not_started');
  assert.equal(scoreBand(100), 'on_track');
  assert.equal(scoreBand(95), 'on_track');
  assert.equal(scoreBand(94.9), 'concern');
  assert.equal(scoreBand(80), 'concern');
  assert.equal(scoreBand(79), 'behind');
  assert.equal(scoreBand(0), 'behind');
});

test('uploads: allowed types by extension, with the type to store', () => {
  assert.deepEqual(checkUpload('documents', { name: 'Q1 Return.PDF', size: 1000 }), { contentType: 'application/pdf' });
  assert.deepEqual(checkUpload('documents', { name: 'weekly.csv', size: 10 }), { contentType: 'text/csv' });
  assert.deepEqual(checkUpload('library', { name: 'logo.svg', size: 10 }), { contentType: 'image/svg+xml' });
  assert.deepEqual(checkUpload('dbs', { name: 'cert.heic', size: 10 }), { contentType: 'image/heic' });
});

test('uploads: refused types, sizes and buckets', () => {
  for (const name of ['run.exe', 'page.html', 'script.js', 'archive.zip', 'noextension', 'logo.svg.exe']) {
    assert.ok('error' in checkUpload('documents', { name, size: 10 }), name);
  }
  assert.ok('error' in checkUpload('documents', { name: 'logo.svg', size: 10 }), 'SVG only in the library');
  assert.ok('error' in checkUpload('dbs', { name: 'cert.docx', size: 10 }), 'DBS takes a PDF or photo only');
  assert.ok('error' in checkUpload('documents', { name: 'big.pdf', size: 25 * 1024 * 1024 + 1 }));
  assert.ok('error' in checkUpload('dbs', { name: 'big.pdf', size: 10 * 1024 * 1024 + 1 }));
  assert.ok('error' in checkUpload('documents', { name: 'empty.pdf', size: 0 }));
  assert.ok('error' in checkUpload('elsewhere', { name: 'a.pdf', size: 10 }));
});

test('every upload rule matches a bucket the database knows', () => {
  assert.deepEqual(Object.keys(UPLOAD_RULES).sort(), ['dbs', 'documents', 'lead-workspace', 'library']);
});
