// Bid readiness check: steps through the profile and each section of
// READINESS (framework.js), scores in the browser, then sends the result to
// the shvft-readiness-submit function when the visitor asks for the report.
(() => {
  const R = window.READINESS;
  const API = 'https://axlkftquhlsinibkxivc.supabase.co/functions/v1';
  const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF4bGtmdHF1aGxzaW5pYmt4aXZjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk3MDY3NzQsImV4cCI6MjEwNTI4Mjc3NH0.34wA5oBuHq9k9DNIzLm-9ypzyTXIKDvOdQSm2ywRX0w';
  const DRAFT = 'shvft-readiness-draft';

  const root = document.getElementById('rc');
  const intro = document.getElementById('readiness');
  if (!root || !R) return;

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  let state = { step: 0, org: {}, answers: {} };
  try {
    const saved = JSON.parse(localStorage.getItem(DRAFT) || 'null');
    if (saved && saved.version === R.version) state = saved;
  } catch {}
  const save = () => { try { localStorage.setItem(DRAFT, JSON.stringify({ ...state, version: R.version })); } catch {} };
  const clearDraft = () => { try { localStorage.removeItem(DRAFT); } catch {} };

  const sections = () => R.sections.filter(s => !s.when || s.when(state.org));
  const totalSteps = () => sections().length + 1; // profile + sections

  function start(fresh) {
    if (fresh) state = { step: 0, org: {}, answers: {} };
    intro.hidden = true;
    root.hidden = false;
    render();
    root.scrollIntoView({ block: 'start' });
  }

  document.getElementById('rc-start')?.addEventListener('click', () => start(false));
  const resume = document.getElementById('rc-resume');
  if (resume && (state.step > 0 || state.org.name)) {
    resume.hidden = false;
    resume.querySelector('button')?.addEventListener('click', () => start(true));
    document.getElementById('rc-start').textContent = 'Carry on where you left off';
  }

  function progress() {
    const n = totalSteps();
    const at = Math.min(state.step, n);
    return `<div class="rc-progress" role="progressbar" aria-label="Progress" aria-valuemin="0" aria-valuemax="${n}" aria-valuenow="${at}">
      <div class="rc-progress-bar" style="width:${Math.round((at / n) * 100)}%"></div></div>
      <p class="rc-stepcount">${at < n ? `Step ${at + 1} of ${n}` : 'Your results'}</p>`;
  }

  function fieldHtml(f) {
    const v = state.org[f.id] ?? '';
    const req = f.required ? ' required' : '';
    const label = `<label for="org-${f.id}">${esc(f.label)}${f.required ? '' : ' <span class="opt">(optional)</span>'}</label>`;
    const hint = f.hint ? `<p class="rc-hint" id="org-${f.id}-hint">${esc(f.hint)}</p>` : '';
    const described = f.hint ? ` aria-describedby="org-${f.id}-hint"` : '';
    if (f.options) {
      return `<div class="field${f.wide ? ' wide' : ''}">${label}${hint}<select id="org-${f.id}" name="${f.id}"${req}${described}>
        <option value="">Choose one</option>${f.options.map(o => `<option${o === v ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select></div>`;
    }
    return `<div class="field${f.wide ? ' wide' : ''}">${label}${hint}<input type="text" id="org-${f.id}" name="${f.id}" value="${esc(v)}" maxlength="${f.max || 200}"${req}${described}${f.autocomplete ? ` autocomplete="${f.autocomplete}"` : ''}></div>`;
  }

  function profileStep() {
    return `<div class="rc-head"><span class="eyebrow">About your organisation</span>
      <h2>Tell us who you are.</h2>
      <p class="lede">This shapes the questions you see and lets us compare your size with the bids you are aiming for.</p></div>
      <form class="rc-form rc-grid" id="rc-step" novalidate>${R.profile.map(fieldHtml).join('')}
      ${nav(false, 'Start the questions')}</form>`;
  }

  function questionHtml(q, i) {
    const a = state.answers[q.id];
    const opts = [['yes', 'Yes'], ['partly', 'Partly or in progress'], ['no', 'No'], ['unsure', 'Not sure']];
    if (q.na) opts.push(['na', q.na]);
    return `<fieldset class="rc-q${q.blocker ? ' is-key' : ''}" id="q-${q.id}">
      <legend><span class="rc-qn">${i + 1}</span><span>${esc(q.text)}${q.blocker ? ' <span class="rc-key">Essential</span>' : ''}</span></legend>
      ${q.help ? `<p class="rc-help">${esc(q.help)}</p>` : ''}
      <div class="rc-opts">${opts.map(([val, lab]) => `<label class="rc-opt"><input type="radio" name="${q.id}" value="${val}"${a === val ? ' checked' : ''}><span>${esc(lab)}</span></label>`).join('')}</div>
    </fieldset>`;
  }

  function sectionStep(s, n, of) {
    const qs = s.questions.filter(q => !q.when || q.when(state.org));
    return `<div class="rc-head"><span class="eyebrow">Area ${n} of ${of}</span>
      <h2>${esc(s.heading || s.title)}</h2>${s.intro ? `<p class="lede">${esc(s.intro)}</p>` : ''}</div>
      <form class="rc-form" id="rc-step" novalidate>${qs.map(questionHtml).join('')}
      ${nav(true, state.step === totalSteps() - 1 ? 'See my results' : 'Next')}</form>`;
  }

  function nav(back, next) {
    return `<div class="rc-nav wide">${back ? '<button type="button" class="btn btn-secondary" data-back>Back</button>' : ''}
      <button type="submit" class="btn btn-primary">${esc(next)}</button>
      <p class="rc-msg" role="alert"></p></div>`;
  }

  function bar(label, pct) {
    return `<div class="rc-bar"><span class="rc-bar-label">${esc(label)}</span>
      <span class="rc-bar-track"><span class="rc-bar-fill" style="width:${pct}%"></span></span>
      <span class="rc-bar-val">${pct}%</span></div>`;
  }

  function resultsStep() {
    const r = R.score(state.org, state.answers);
    const top = r.gaps.slice(0, 3);
    return `<div class="rc-result">
      <div class="rc-score" style="--pct:${r.score}">
        <div class="rc-dial" aria-hidden="true"><span>${r.score}</span></div>
        <div><span class="eyebrow">${esc(state.org.name)}</span>
          <h2>${esc(r.band)}</h2>
          <p class="lede">${esc(R.bandText[r.band])}</p>
          <p class="sr-only">Your score is ${r.score} out of 100.</p></div>
      </div>
      ${r.blockers.length ? `<div class="rc-alert"><h3>${r.blockers.length === 1 ? 'One thing could stop you bidding' : `${r.blockers.length} things could stop you bidding`}</h3>
        <p>Funders and commissioners usually treat these as pass or fail. Your full report explains how to fix each one.</p></div>` : ''}
      ${r.capacity.length ? `<div class="rc-note">${r.capacity.map(c => `<p>${esc(c)}</p>`).join('')}</div>` : ''}
      <h3 class="rc-sub">How you scored in each area</h3>
      <div class="rc-bars">${r.sections.map(s => bar(s.title, s.pct)).join('')}</div>
      ${top.length ? `<h3 class="rc-sub">Your top ${top.length === 1 ? 'priority' : `${top.length} priorities`}</h3>
        <ol class="rc-top">${top.map(g => `<li><strong>${esc(g.short)}</strong><span>${esc(g.fix)}</span></li>`).join('')}</ol>` : ''}
    </div>
    ${reportForm(r)}`;
  }

  function reportForm(r) {
    return `<div class="rc-report-cta"><h3>Get your full report by email</h3>
      <p>Every answer scored, with what to do next for each gap. We will send it straight to your inbox.</p>
      <form class="rc-form rc-grid" id="rc-contact" novalidate>
        <input type="text" name="website" class="sr-only" tabindex="-1" autocomplete="off" aria-hidden="true">
        <div class="field"><label for="c-name">Your name</label><input id="c-name" name="name" required autocomplete="name" maxlength="120"></div>
        <div class="field"><label for="c-role">Your role <span class="opt">(optional)</span></label><input id="c-role" name="role" autocomplete="organization-title" maxlength="120"></div>
        <div class="field"><label for="c-email">Email address</label><input id="c-email" name="email" type="email" required autocomplete="email" maxlength="200"></div>
        <div class="field"><label for="c-phone">Phone <span class="opt">(optional)</span></label><input id="c-phone" name="phone" type="tel" autocomplete="tel" maxlength="40"></div>
        <fieldset class="rc-consent wide"><legend>Staying in touch <span class="opt">(optional)</span></legend>
          <label><input type="checkbox" name="consent_email"> <span>${esc(R.consent.email)}</span></label>
          <label><input type="checkbox" name="consent_phone"> <span>${esc(R.consent.phone)}</span></label>
          <p class="rc-hint">${esc(R.consent.notice)} <a href="/governance/#privacy">Read our privacy notice</a>.</p>
        </fieldset>
        <div class="rc-nav wide"><button type="button" class="btn btn-secondary" data-back>Change my answers</button>
          <button type="submit" class="btn btn-primary">Email me my report</button><p class="rc-msg" role="alert"></p></div>
      </form></div>`;
  }

  function sentStep(email, token, emailed) {
    return `<div class="rc-done"><span class="eyebrow">${emailed ? 'Report on its way' : 'Report ready'}</span>
      <h2>${emailed ? 'Check your inbox.' : 'Your full report is ready.'}</h2>
      <p class="lede">${emailed
        ? `We have sent your full report to <strong>${esc(email)}</strong>. If it has not arrived in a few minutes, check your junk folder.`
        : 'Open it below and bookmark the page, as the link is private to you. We will also be in touch by email.'}</p>
      <div class="btns">${token ? `<a class="btn btn-primary" href="/readiness/report/?r=${encodeURIComponent(token)}">Open my report now</a>` : ''}
      <a class="btn btn-secondary" href="/contact/#enquiry">Talk to us about your results</a></div></div>`;
  }

  function render() {
    const secs = sections();
    let html;
    if (state.step === 0) html = profileStep();
    else if (state.step <= secs.length) html = sectionStep(secs[state.step - 1], state.step, secs.length);
    else html = resultsStep();
    root.innerHTML = `<div class="wrap rc-wrap">${progress()}${html}</div>`;
    root.querySelector('[data-back]')?.addEventListener('click', () => { state.step = Math.max(0, state.step - 1); save(); render(); focusTop(); });
    root.querySelector('#rc-step')?.addEventListener('submit', onStep);
    root.querySelector('#rc-step')?.addEventListener('change', onChange);
    root.querySelector('#rc-contact')?.addEventListener('submit', onContact);
  }

  function focusTop() {
    const h = root.querySelector('h2');
    if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
    root.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }

  function onChange(e) {
    const el = e.target;
    if (el.type === 'radio') { state.answers[el.name] = el.value; el.closest('fieldset')?.classList.remove('is-missing'); }
    else if (el.name) state.org[el.name] = el.value.trim();
    save();
  }

  function onStep(e) {
    e.preventDefault();
    const form = e.target;
    const msg = form.querySelector('.rc-msg');
    if (state.step === 0) {
      form.querySelectorAll('input, select').forEach(el => { state.org[el.name] = el.value.trim(); });
      const missing = [...form.querySelectorAll('[required]')].filter(el => !el.value.trim());
      form.querySelectorAll('[required]').forEach(el => el.setAttribute('aria-invalid', !el.value.trim()));
      if (missing.length) { msg.textContent = 'Please fill in the fields marked without “optional”.'; missing[0].focus(); return; }
    } else {
      const unanswered = [...form.querySelectorAll('fieldset.rc-q')].filter(fs => !fs.querySelector('input:checked'));
      unanswered.forEach(fs => fs.classList.add('is-missing'));
      if (unanswered.length) {
        msg.textContent = unanswered.length === 1 ? 'Please answer the highlighted question. “Not sure” is fine.' : `Please answer the ${unanswered.length} highlighted questions. “Not sure” is fine.`;
        unanswered[0].querySelector('input')?.focus();
        return;
      }
    }
    state.step += 1;
    save();
    render();
    focusTop();
  }

  async function onContact(e) {
    e.preventDefault();
    const form = e.target;
    const msg = form.querySelector('.rc-msg');
    const button = form.querySelector('button[type="submit"]');
    const fd = new FormData(form);
    const contact = { name: String(fd.get('name') || '').trim(), role: String(fd.get('role') || '').trim(), email: String(fd.get('email') || '').trim(), phone: String(fd.get('phone') || '').trim() };
    let bad = null;
    form.querySelectorAll('[required]').forEach(el => { const b = !el.checkValidity(); el.setAttribute('aria-invalid', b); if (b && !bad) bad = el; });
    if (bad) { msg.className = 'rc-msg err'; msg.textContent = 'Please add your name and a valid email address.'; bad.focus(); return; }

    const r = R.score(state.org, state.answers);
    const payload = {
      website: String(fd.get('website') || ''),
      framework_version: R.version,
      org: { ...state.org },
      contact,
      // Profile answers with no column of their own (bid type, children,
      // health) ride along in answers so the report can redraw the same check.
      answers: { ...state.answers, ...Object.fromEntries(R.profile.filter(f => f.extra).map(f => [`_${f.id}`, state.org[f.id] || ''])) },
      section_scores: Object.fromEntries(r.sections.map(s => [s.id, s.pct])),
      score: r.score,
      band: r.band,
      blockers: r.blockers.map(b => b.short),
      consent_email: fd.get('consent_email') === 'on',
      consent_phone: fd.get('consent_phone') === 'on',
      consent_wording: { email: R.consent.email, phone: R.consent.phone, notice: R.consent.notice },
    };
    button.disabled = true;
    msg.className = 'rc-msg';
    msg.textContent = 'Sending…';
    try {
      const res = await fetch(`${API}/shvft-readiness-submit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', apikey: KEY, authorization: `Bearer ${KEY}` },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'That did not send. Could you try once more?');
      clearDraft();
      root.querySelector('.rc-wrap').innerHTML = progress() + sentStep(contact.email, data.report_token, data.emailed === true);
      focusTop();
    } catch (err) {
      msg.className = 'rc-msg err';
      msg.textContent = err.message || 'That did not send. Could you try once more?';
      button.disabled = false;
    }
  }
})();
