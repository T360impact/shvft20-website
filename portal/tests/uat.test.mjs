// UAT mode shows only on staging (the staging build's config) or in the test runner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('U-UAT-01 production\'s config doesn\'t switch UAT mode on', () => {
  const cfg = readFileSync(new URL('../config.js', import.meta.url), 'utf8');
  assert.doesNotMatch(cfg, /ENVIRONMENT\s*=\s*'staging'|UAT_MODE\s*=\s*true/);
});
test('U-UAT-02 the staging build sets the flag UAT mode reads', () => {
  const wf = readFileSync(new URL('../../.github/workflows/deploy.yml', import.meta.url), 'utf8');
  assert.match(wf, /export const ENVIRONMENT = 'staging';/);
  assert.match(readFileSync(new URL('../uat.js', import.meta.url), 'utf8'), /flags\.ENVIRONMENT === 'staging'/);
});
