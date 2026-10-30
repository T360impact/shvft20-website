// Platform administration (Shvft2.0 only): every consortium on the portal,
// and setting up a new one. Partners, sites and targets are then added from
// the consortium's own pages.
import { db, html, render, $, formData, toast, act, must, fmtDate, fmtMoney } from '../lib.js';

export default async function admin(el) {
  const list = must(await db.from('consortia').select('id, name, funder, programme, grant_value, start_date, end_date, allow_real_records').order('start_date', { ascending: false }));
  render(el, html`
    <div class="page-head"><div><span class="eyebrow">Platform administration</span><h1>All consortia</h1>
      <p class="muted">Each consortium is walled off from the others. Set one up here, then add its partners, sites and targets from its own pages.</p></div></div>
    <section class="panel">
      ${list.length ? html`<div class="table-wrap"><table>
        <thead><tr><th>Consortium</th><th>Funder</th><th>Runs</th><th class="num">Grant</th><th>Records</th></tr></thead>
        <tbody>${list.map((c) => html`<tr><td><a href="#/c/${c.id}/hub">${c.name}</a><br><span class="muted small">${c.programme || ''}</span></td>
          <td>${c.funder || ''}</td><td class="small nowrap">${fmtDate(c.start_date)} to ${fmtDate(c.end_date)}</td>
          <td class="num">${fmtMoney(c.grant_value)}</td>
          <td>${c.allow_real_records ? html`<span class="pill pill-approved">Live</span>` : html`<span class="pill pill-demo">Demo only</span>`}</td></tr>`)}</tbody></table></div>`
      : html`<p class="empty">No consortia yet.</p>`}
    </section>
    <section class="panel" style="margin-top:20px"><h2>Set up a consortium</h2>
      <form class="form" id="new-c">
        <div class="fields">
          <label class="f">Name<input name="name" required></label>
          <label class="f">Funder<input name="funder"></label>
          <label class="f">Programme<input name="programme"></label>
          <label class="f">Grant value (£)<input type="number" name="grant_value" min="0"></label></div>
        <div class="fields">
          <label class="f">Starts<input type="date" name="start_date" required></label>
          <label class="f">Ends<input type="date" name="end_date" required></label>
          <label class="f">Youngest age<input type="number" name="min_age" value="14" min="0" max="30" required></label>
          <label class="f">Oldest age<input type="number" name="max_age" value="24" min="0" max="30" required></label></div>
        <div class="btns"><button class="btn">Create consortium</button></div>
      </form>
      <p class="muted small" style="margin-top:12px">New consortia start in demo mode. Switching a consortium to real records is done in the database once its data protection impact assessment and data processing agreements are signed.</p>
    </section>`);

  $('#new-c').addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      const row = must(await db.from('consortia').insert(formData(e.target)).select('id').single());
      toast('Consortium created. Add its partners next.');
      location.hash = `#/c/${row.id}/hub`;
    });
  });
}
