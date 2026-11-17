// UAT mode, on staging only (the staging build's config.js says
// ENVIRONMENT = 'staging'; production's says nothing): a banner saying the
// data is test data, and for testers in the demo workspace a button that
// rebuilds it (the uat-reseed function, which refuses anywhere but staging).
import * as config from './config.js';
import { db, html, render, toast, errorText } from './lib.js';

const DEMO = 'a0000000-0000-4000-8000-000000000001';
/** @type {Record<string, unknown>} */
const flags = config;
export const uatMode = () => flags.ENVIRONMENT === 'staging' || flags.UAT_MODE === true;

export function uatBanner(state) {
  if (!uatMode() || document.getElementById('uat-banner')) return;
  const tester = state.profile?.is_platform_admin || (state.memberships || []).some((m) => m.consortium_id === DEMO);
  const el = document.createElement('div');
  el.id = 'uat-banner';
  el.setAttribute('role', 'status');
  render(el, html`<strong>UAT mode</strong> <span>Test data only. Nothing here is real.</span>
    ${tester ? html`<button type="button" class="linkbtn small" id="uat-reseed">Reseed the test workspace</button>` : ''}`);
  document.body.prepend(el);
  document.getElementById('uat-reseed')?.addEventListener('click', async (e) => {
    if (!confirm('Rebuild the test workspace? Everything testers changed in it is lost.')) return;
    const b = /** @type {HTMLButtonElement} */ (e.currentTarget);
    b.disabled = true; b.textContent = 'Rebuilding…';
    const { error } = await db.functions.invoke('uat-reseed', { body: {} });
    if (error) { toast(errorText(error), 'bad'); b.disabled = false; b.textContent = 'Reseed the test workspace'; return; }
    toast('The test workspace has been rebuilt.');
    setTimeout(() => location.reload(), 800);
  });
}
