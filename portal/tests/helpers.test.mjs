// Shared helpers: HTML escaping, formatting, small-number suppression and
// the identifying-details checks on weekly uploads.
// Run: node --test website/portal/tests/helpers.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { html, raw, fmtMoney, fmtNum, fmtDate, fmtMonth, statusPill } from '../lib.js';
import { tooSmall, SMALL, initials } from '../charts.js';
import { piiHeading, piiCell } from '../calc.js';

// html`` returns markup wrapped under a private symbol; read it back as a string.
const text = (v) => (typeof v === 'string' ? v : v[Object.getOwnPropertySymbols(v)[0]]);

test('U-HTML-01 everything put into a page is escaped unless marked raw', () => {
  assert.equal(text(html`<p>${'<script>alert(1)</script>'}</p>`), '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  assert.equal(text(html`<a title="${'" onmouseover="x'}">`), '<a title="&quot; onmouseover=&quot;x">');
  assert.match(text(html`<p>${"it's & more"}</p>`), /^<p>it(&#39;|&#x27;)s &amp; more<\/p>$/);
  assert.equal(text(html`<b>${raw('<i>ok</i>')}</b>`), '<b><i>ok</i></b>');
  assert.equal(text(html`<ul>${['<a>', '<b>'].map((x) => html`<li>${x}</li>`)}</ul>`), '<ul><li>&lt;a&gt;</li><li>&lt;b&gt;</li></ul>');
  assert.equal(text(html`<p>${null}${undefined}${0}</p>`), '<p>0</p>');
});

test('U-FMT-01 money, numbers and dates as the portal shows them (en-GB)', () => {
  assert.equal(fmtMoney(573481), '£573,481');
  assert.equal(fmtMoney(850000), '£850,000');
  assert.equal(fmtMoney(null), '');
  assert.equal(fmtNum(1234.56), '1,234.6');
  assert.equal(fmtNum(null), '–');
  assert.equal(fmtDate('2026-11-17'), '17 Nov 2026');
  assert.equal(fmtDate(''), '');
  assert.equal(fmtMonth('2026-11-01'), 'November 2026');
});

test('U-STATUS-01 statuses read as words with a colour, never a colour alone', () => {
  const s = text(statusPill('changes_requested'));
  assert.match(s, /Changes requested/);
  assert.match(s, /tone-amber/);
  assert.match(text(statusPill('something_new')), /something_new/);
});

test('U-SUPPRESS-01 counts under five are suppressed in charts, zero is not', () => {
  assert.equal(SMALL, 5);
  for (const n of [1, 2, 3, 4]) assert.equal(tooSmall(n), true, String(n));
  for (const n of [0, 5, 6, 120, null]) assert.equal(tooSmall(n), false, String(n));
});

test('U-CHART-01 organisation initials for chart labels', () => {
  assert.equal(initials('Test Partner A'), 'TP'); // two letters at most
  assert.equal(initials('The Foundation of Youth (Test)'), 'FY');
});

test('U-PII-01 column headings that identify young people are refused; names of places and things are fine', () => {
  for (const h of ['Name', 'First name', 'surname', 'Full_Name', 'DOB', 'Date of birth', 'Postcode', 'Email', 'Mobile', 'NHS number', 'UPN', 'T360 ID', 'member code'])
    assert.equal(piiHeading(h), true, h);
  for (const h of ['Site name', 'Programme name', 'organisation_name', 'Hub', 'week_start', 'unique_young_people', 'new_to_consortium', 'Venue name', 'Outcome measure name'])
    assert.equal(piiHeading(h), false, h);
});

test('U-PII-02 cells that look like contact details, postcodes or dates of birth are refused', () => {
  assert.equal(piiCell('jordan@example.com'), 'an email address');
  assert.equal(piiCell('07700 900123'), 'a phone number');
  assert.equal(piiCell('020 7946 0000'), 'a phone number');
  assert.equal(piiCell('N17 0AP'), 'a full postcode');
  assert.equal(piiCell('lives at N170AP'), 'a full postcode');
  assert.equal(piiCell('DOB 01/02/2010'), 'a date of birth');
  for (const ok of ['', 'Evening Centre', 'N17', 'Wellbeing programme', 'Year 1', '14-15']) assert.equal(piiCell(ok), null, ok);
});
