// The portal's Content Security Policy stays strict, and no script is
// loaded from anywhere but this site. Run: node --test 'portal/tests/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const portal = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(portal, 'index.html'), 'utf8');
const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] || '';
const policy = Object.fromEntries(csp.split(';').map((d) => d.trim().split(/\s+/)).filter((d) => d[0]).map(([k, ...v]) => [k, v]));
const PROJECT = 'wxwrnjoyerudbhigjxts.supabase.co';

test('the page has a Content Security Policy', () => assert.ok(csp, 'no CSP meta tag in portal/index.html'));

test('scripts only from this site, never eval or inline', () => {
  assert.deepEqual(policy['script-src'], ["'self'"]);
  assert.deepEqual(policy['default-src'], ["'self'"]);
  for (const v of Object.values(policy).flat()) assert.ok(!["'unsafe-eval'", "'wasm-unsafe-eval'", '*', 'https:', 'http:'].includes(v), `the policy allows ${v}`);
});

test('data goes only to the portal\'s Supabase project', () => {
  assert.deepEqual(policy['connect-src'].filter((s) => s !== "'self'").sort(), [`https://${PROJECT}`, `wss://${PROJECT}`]);
});

test('no plug-ins, frames, foreign forms or base changes', () => {
  assert.deepEqual(policy['object-src'], ["'none'"]);
  assert.deepEqual(policy['frame-src'], ["'none'"]);
  assert.deepEqual(policy['base-uri'], ["'self'"]);
  assert.deepEqual(policy['form-action'], ["'self'"]);
});

const files = (dir) => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? (f === 'vendor' || f === 'tests' ? [] : files(p)) : [p]; });

test('no portal code loads a script from another site', () => {
  for (const f of files(portal).filter((p) => /\.(m?js|html)$/.test(p))) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/(?:import\s*\(?\s*|from\s+|src\s*=\s*|loadScript\()\s*['"`](https?:\/\/[^'"`]+)/g)) assert.fail(`${f} loads ${m[1]}`);
    assert.ok(!/cdn\.jsdelivr|cdnjs\.cloudflare|cdn\.sheetjs|unpkg\.com/.test(src), `${f} mentions a CDN`);
  }
});

test('vendored files match the checksums in vendor/README.md', () => {
  const readme = readFileSync(join(portal, 'vendor', 'README.md'), 'utf8');
  const rows = [...readme.matchAll(/`([^`]+\.m?js)` \|[^|]*\|[^|]*\|[^|]*\| `([0-9a-f]{64})`/g)];
  assert.ok(rows.length >= 5);
  for (const [, name, sum] of rows) assert.equal(createHash('sha256').update(readFileSync(join(portal, 'vendor', name))).digest('hex'), sum, `${name} changed`);
});
