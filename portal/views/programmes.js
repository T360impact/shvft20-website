// Programmes: the consortium's programmes, and how each target fills from
// the weekly uploads (also under Dashboard, Settings).
import { html, render, $ } from '../lib.js';
import { weeklySettings } from './mine.js';

export default async function programmes(ctx, el) {
  render(el, html`<div class="page-head"><div><span class="eyebrow">Delivery</span><h1>Programmes</h1>
    <p class="muted">Each programme partners report weekly figures against, and which target each weekly figure counts towards.</p></div></div><div id="prog-body"></div>`);
  await weeklySettings(ctx, $('#prog-body', el));
}
