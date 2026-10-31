// Small charts in the module colours, drawn as SVG and HTML so the portal
// needs no chart library. Every chart sits under a one line takeaway and a
// title, values are labelled on the chart rather than in a legend, and
// meaning never rests on colour alone. Groups under five are suppressed.
import { html, raw, fmtNum } from './lib.js';

export const SMALL = 5;
export const tooSmall = (n) => n != null && n > 0 && n < SMALL;

export const chart = (takeaway, title, body) => html`<div class="chart">
  ${takeaway ? html`<p class="takeaway">${takeaway}</p>` : ''}${title ? html`<p class="chart-title">${title}</p>` : ''}${body}</div>`;

export const initials = (name) => (name || '?').replace(/\(.*?\)/g, '').split(/\s+/).filter((w) => /^[A-Za-z]/.test(w) && !/^(the|of|and)$/i.test(w))
  .slice(0, 2).map((w) => w[0].toUpperCase()).join('');

// A progress ring with the figure in the middle.
export function ring(pct, { size = 140, stroke = 14, color = 'var(--green)', label = '', value = null, track = 'var(--grey-tint)' } = {}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  const shown = value ?? `${fmtNum(p)}%`;
  return html`<div class="ring" style="width:${size}px;height:${size}px;--ring-font:${Math.round(size / 5)}px" role="img" aria-label="${label ? `${label}: ` : ''}${shown}">
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" style="stroke:${track}" stroke-width="${stroke}"></circle>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" style="stroke:${color}" stroke-width="${stroke}" stroke-linecap="${p > 0 && p < 100 ? 'round' : 'butt'}"
        stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - p / 100)}"></circle></svg>
    <div class="ring-label" aria-hidden="true"><div><b>${shown}</b>${label && size >= 110 ? html`<span>${label}</span>` : ''}</div></div></div>`;
}

// Two-part donut (for example targeted against universal) with a marker at
// a minimum, such as the funder's targeted share.
export function donut(pct, { size = 160, stroke = 22, color = 'var(--m-surveys)', rest = 'var(--m-delivery)', marker = null, label = '' } = {}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  const cx = size / 2;
  const tick = marker == null ? '' : (() => {
    const a = (2 * Math.PI * marker) / 100;
    const [r1, r2] = [r - stroke / 2 - 4, r + stroke / 2 + 4];
    return html`<line x1="${cx + r1 * Math.cos(a)}" y1="${cx + r1 * Math.sin(a)}" x2="${cx + r2 * Math.cos(a)}" y2="${cx + r2 * Math.sin(a)}" style="stroke:var(--text)" stroke-width="3" stroke-linecap="round"></line>`;
  })();
  return html`<div class="ring" style="width:${size}px;height:${size}px;--ring-font:${Math.round(size / 5.5)}px" role="img"
    aria-label="${label}: ${fmtNum(p)}%${marker != null ? `, minimum ${fmtNum(marker)}%` : ''}">
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true" style="overflow:visible">
      <circle cx="${cx}" cy="${cx}" r="${r}" fill="none" style="stroke:${rest}" stroke-width="${stroke}" opacity=".35"></circle>
      <circle cx="${cx}" cy="${cx}" r="${r}" fill="none" style="stroke:${color}" stroke-width="${stroke}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - p / 100)}"></circle>
      ${tick}</svg>
    <div class="ring-label" aria-hidden="true"><div><b>${fmtNum(p)}%</b><span>${label}</span></div></div></div>`;
}

// Horizontal bars: label, value at the end, the bar coloured by status.
// rows: [{ id, label, sub, pct, tone, value, marker, pill }]
export const hbars = (rows) => html`<div class="hbars">${rows.map((r) => html`
  <div class="hbar ${r.id ? 'clickable' : ''}" ${r.id ? html`data-id="${r.id}" tabindex="0" role="button"` : ''}>
    <span class="lbl">${r.label}${r.sub ? html`<small>${r.sub}</small>` : ''}</span>
    <span class="val">${r.value}${r.pill || ''}</span>
    ${r.pct == null ? '' : html`<span class="track fill-${r.tone || 'grey'}" aria-hidden="true"><span style="width:${Math.max(0, Math.min(100, r.pct))}%"></span>
      ${r.marker != null ? html`<i style="left:${Math.min(100, r.marker)}%"></i>` : ''}</span>`}</div>`)}</div>`;

// One stacked bar per row. segs: [{ key, n, label }]
export const stackedBars = (rows, keys) => html`<div class="hbars">${rows.map((r) => {
  const total = r.segs.reduce((s, x) => s + x.n, 0);
  return html`<div class="hbar"><span class="lbl">${r.label}</span><span class="val">${r.value ?? ''}</span>
    <div class="stacked" style="grid-column:1/-1" role="img" aria-label="${r.label}: ${r.segs.filter((s) => s.n).map((s) => `${s.n} ${s.label.toLowerCase()}`).join(', ')}">
      ${r.segs.filter((s) => s.n).map((s) => html`<span class="seg-${s.key}" style="flex:${s.n}" title="${s.n} ${s.label.toLowerCase()}">${(100 * s.n) / total >= 8 ? s.n : ''}</span>`)}</div></div>`;
})}
  <div class="key">${keys.map(([k, label]) => html`<span><i class="seg-${k}"></i>${label}</span>`)}</div></div>`;

// A line chart of a few series over time, labelled at the last point. No
// gridlines; the axis carries the time labels only. Drawn twice, wide and
// narrow, so the text stays readable on a phone.
export function lineChart(labels, series, { height = 220 } = {}) {
  const draw = (W, every) => {
    const pad = { l: 8, r: 112, t: 16, b: 28 };
    const max = Math.max(1, ...series.flatMap((s) => s.values));
    const x = (i) => pad.l + (labels.length < 2 ? (W - pad.l - pad.r) / 2 : (i * (W - pad.l - pad.r)) / (labels.length - 1));
    const y = (v) => pad.t + (height - pad.t - pad.b) * (1 - v / max);
    // End labels never overlap: each sits at least 34px below the one above.
    const ends = series.map((s, n) => ({ n, y: y(s.values[s.values.length - 1]) })).sort((a, b) => a.y - b.y);
    ends.forEach((e, i) => { if (i && e.y < ends[i - 1].y + 34) e.y = ends[i - 1].y + 34; });
    const labelY = (n) => ends.find((e) => e.n === n).y;
    return html`<svg viewBox="0 0 ${W} ${height + 20}" role="img" aria-label="${series.map((s) => `${s.name}: ${s.values.map((v, i) => `${labels[i]} ${v}`).join(', ')}`).join('. ')}">
      <line x1="${pad.l}" x2="${W - pad.r}" y1="${height - pad.b}" y2="${height - pad.b}" style="stroke:var(--border)"></line>
      ${labels.map((l, i) => (i % every === 0 || i === labels.length - 1 ? html`<text x="${x(i)}" y="${height - 8}" text-anchor="middle">${l}</text>` : ''))}
      ${series.map((s, n) => {
        const last = s.values.length - 1;
        return html`<polyline fill="none" style="stroke:${s.color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" points="${s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}"></polyline>
          ${s.values.map((v, i) => html`<circle cx="${x(i)}" cy="${y(v)}" r="${i === last ? 5 : 3}" style="fill:${s.color}"></circle>`)}
          <text class="val" x="${x(last) + 10}" y="${labelY(n) + 4}">${fmtNum(s.values[last])}</text>
          <text x="${x(last) + 10}" y="${labelY(n) + 18}">${s.name}</text>`;
      })}</svg>`;
  };
  return html`<div class="linechart"><div class="lc-wide">${draw(640, Math.ceil(labels.length / 8))}</div><div class="lc-narrow">${draw(340, Math.ceil(labels.length / 4))}</div></div>`;
}
