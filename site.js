// Links to the old single-page sections land on the page that now holds them.
const moved = { about: '/about/', team: '/about/#team', services: '/services/', who: '/services/#who', how: '/how-we-work/', 'youth-voice': '/how-we-work/#youth-voice', tools: '/how-we-work/#tools', impact: '/impact/', resources: '/impact/#resources', training: '/training/', business: '/for-businesses/', contact: '/contact/', governance: '/governance/', privacy: '/governance/#privacy' };
if (location.pathname === '/' && moved[location.hash.slice(1)]) location.replace(moved[location.hash.slice(1)]);

const toggle = document.querySelector('.menu-toggle');
const nav = document.getElementById('nav');
toggle.addEventListener('click', () => {
  const open = nav.classList.toggle('open');
  toggle.setAttribute('aria-expanded', open);
});
nav.addEventListener('click', e => {
  if (e.target.tagName === 'A') { nav.classList.remove('open'); toggle.setAttribute('aria-expanded', false); }
});
// Count the headline figure up from zero the first time it scrolls into view.
const counts = document.querySelectorAll('.count');
if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const io = new IntersectionObserver(entries => entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    io.unobserve(entry.target);
    const el = entry.target, to = +el.dataset.to, start = performance.now(), duration = 2000;
    const tick = now => {
      const t = Math.min((now - start) / duration, 1);
      el.textContent = t < 1 ? '£' + (to * (1 - Math.pow(1 - t, 3))).toFixed(1) + 'm' : el.dataset.final;
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), { threshold: 0.6 });
  counts.forEach(el => { el.dataset.final = el.textContent; el.textContent = '£0.0m'; io.observe(el); });
}
// No mailing-list backend yet: confirm locally until sign-up is wired up.
document.getElementById('newsletter')?.addEventListener('submit', e => {
  e.preventDefault();
  const msg = document.getElementById('newsletter-msg');
  msg.textContent = 'Thank you. Sign-up opens at launch; we will be in touch.';
  msg.hidden = false;
  e.target.reset();
});
