// Full readiness report at /readiness/report/?r=<token>. Loads the stored
// answers through shvft-readiness-report and redraws them with framework.js.
(() => {
  const R = window.READINESS;
  const API = 'https://axlkftquhlsinibkxivc.supabase.co/functions/v1';
  const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF4bGtmdHF1aGxzaW5pYmt4aXZjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk3MDY3NzQsImV4cCI6MjEwNTI4Mjc3NH0.34wA5oBuHq9k9DNIzLm-9ypzyTXIKDvOdQSm2ywRX0w';
  const root = document.getElementById('report');
  if (!root || !R) return;

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const STATUS = { yes: ['Done', 'ok'], partly: ['Partly', 'part'], no: ['Not yet', 'gap'], unsure: ['Not sure', 'gap'], na: ['Not applicable', 'na'] };

  const failMsg = text => {
    root.innerHTML = `<div class="wrap rc-wrap"><span class="eyebrow">Readiness report</span><h1>${esc(text)}</h1>
      <p class="lede">Check you used the whole link from your email, or take the check again.</p>
      <div class="btns"><a class="btn btn-primary" href="/#readiness">Take the readiness check</a></div></div>`;
  };

  const token = new URLSearchParams(location.search).get('r') || '';
  if (!/^[0-9a-f-]{36}$/i.test(token)) { failMsg('We could not find that report.'); return; }

  fetch(`${API}/shvft-readiness-report`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: KEY, authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ token }),
  })
    .then(res => res.json().then(data => ({ res, data })))
    .then(({ res, data }) => { if (!res.ok || !data.ok) throw new Error(data.error); draw(data.report); })
    .catch(err => failMsg(err.message || 'We could not load that report just now.'));

  function draw(rep) {
    const org = {
      name: rep.org_name, legal_form: rep.legal_form, income_band: rep.income_band, paid_staff_band: rep.paid_staff_band,
      volunteer_band: rep.volunteer_band, years_operating_band: rep.years_operating_band,
      largest_award_band: rep.largest_award_band, target_bid_band: rep.target_bid_band,
    };
    R.profile.filter(f => f.extra).forEach(f => { org[f.id] = rep.answers?.[`_${f.id}`]; });
    const r = R.score(org, rep.answers || {});
    const date = new Date(rep.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    document.title = `${rep.org_name} readiness report | Shvft2.0`;

    const sectionsHtml = r.sections.map(s => {
      const rows = s.questions.map(q => {
        const a = rep.answers?.[q.id] || 'unsure';
        const [label, cls] = STATUS[a] || STATUS.unsure;
        return `<li class="rr-item rr-${cls}"><span class="rr-status">${label}</span>
          <div><p class="rr-q">${esc(q.text)}${q.blocker ? ' <span class="rc-key">Essential</span>' : ''}</p>
          ${a !== 'yes' && a !== 'na' ? `<p class="rr-fix">${esc(q.fix)}</p>` : ''}</div></li>`;
      }).join('');
      return `<section class="rr-section"><div class="rr-section-head"><h2>${esc(s.title)}</h2><span class="rr-pct">${s.pct}%</span></div>
        <ul class="rr-list">${rows}</ul></section>`;
    }).join('');

    root.innerHTML = `<div class="wrap rc-wrap">
      <span class="eyebrow">Readiness report · ${esc(date)}</span>
      <h1>${esc(rep.org_name)}</h1>
      <div class="rc-score" style="--pct:${r.score}">
        <div class="rc-dial" aria-hidden="true"><span>${r.score}</span></div>
        <div><h2>${esc(r.band)}</h2><p class="lede">${esc(R.bandText[r.band])}</p><p class="sr-only">Score ${r.score} out of 100.</p></div>
      </div>
      ${r.blockers.length ? `<div class="rc-alert"><h3>Fix these before you bid</h3><ol>${r.blockers.map(b => `<li><strong>${esc(b.short)}</strong>. ${esc(b.fix)}</li>`).join('')}</ol></div>` : ''}
      ${r.capacity.length ? `<div class="rc-note"><h3>Your size and the bids you are aiming for</h3>${r.capacity.map(c => `<p>${esc(c)}</p>`).join('')}</div>` : ''}
      <h3 class="rc-sub">Scores by area</h3>
      <div class="rc-bars">${r.sections.map(s => `<div class="rc-bar"><span class="rc-bar-label">${esc(s.title)}</span><span class="rc-bar-track"><span class="rc-bar-fill" style="width:${s.pct}%"></span></span><span class="rc-bar-val">${s.pct}%</span></div>`).join('')}</div>
      ${sectionsHtml}
      <div class="rc-report-cta"><h3>Want help closing the gaps?</h3>
        <p>We work alongside youth and community organisations to get bid ready, from policies and governance to partnerships and the bid itself.</p>
        <div class="btns"><a class="btn btn-primary" href="/contact/#enquiry">Talk to us about your results</a></div></div>
      <p class="rc-hint">This report is a guide based on your own answers, not legal or financial advice. Requirements differ between funders, so always check each funder's or commissioner's own criteria. Framework ${esc(rep.framework_version)}.</p>
    </div>`;
  }
})();
