// Addison Joinery — site behaviour. Plain ES module, no dependencies.

const FADE = 0.9; // seconds; keep in sync with .hero__video transition in site.css

// ---------------------------------------------------------------- shared

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
// Safari < 14 only has the deprecated addListener on MediaQueryList.
const onMediaChange = (mq, fn) => (mq.addEventListener ? mq.addEventListener('change', fn) : mq.addListener(fn));

// ---------------------------------------------------------------- flyover hero
//
// Two stacked <video> layers: one on screen, one loading the next area.
// `desired` is the area that should be on screen; `frontIndex` is the one that
// is. Every transition takes a token: a newer transition (or stop) makes older
// ones bail out, and only the transition holding `pending` blocks auto-advance.

function initFlyover() {
  const hero = document.querySelector('[data-flyover]');
  if (!hero) return null;

  const media = hero.querySelector('.hero__media');
  const posterImg = hero.querySelector('[data-flyover-poster] img');
  const posterSource = hero.querySelector('[data-flyover-poster] source');
  const nameEl = hero.querySelector('[data-flyover-name]');
  const suburbsEl = hero.querySelector('[data-flyover-suburbs]');
  const toggle = hero.querySelector('[data-flyover-toggle]');
  const areas = [...hero.querySelectorAll('.flyover__tab')].map((tab) => ({
    id: tab.dataset.area, name: tab.dataset.name, suburbs: tab.dataset.suburbs, tab,
  }));
  const n = areas.length;
  const mod = (i) => ((i % n) + n) % n;

  const portrait = matchMedia('(max-aspect-ratio: 4/5)');
  const conn = navigator.connection || {};
  const lowData = Boolean(conn.saveData) || /(^|-)2g$/.test(conn.effectiveType || '');
  const slowNet = lowData || /3g/.test(conn.effectiveType || '');

  const layers = [0, 1].map(() => {
    const v = document.createElement('video');
    v.className = 'hero__video';
    v.muted = true;
    v.playsInline = true;
    v.setAttribute('muted', '');
    v.setAttribute('playsinline', '');
    v.preload = 'auto';
    v.disablePictureInPicture = true;
    v.setAttribute('aria-hidden', 'true');
    media.appendChild(v);
    return v;
  });
  let webm = layers[0].canPlayType('video/webm; codecs="vp9"') !== '';

  const failed = new Set();   // areas whose clip wouldn't load
  let requested = 0;          // area last asked for (initial load or a click)
  let desired = 0;
  let frontIndex = -1;        // area on screen (-1: poster)
  let front = -1;             // layer on screen (-1: poster)
  let running = false;
  let userPaused = reducedMotion.matches || lowData;
  let autoAdvance = !userPaused; // false: play the chosen clip once, then hold
  let inView = true;
  let pageVisible = !document.hidden;
  let token = 0;
  let pending = 0;
  let cleanup = 0;            // timer that retires the faded-out layer
  let raf = 0;

  function variant() {
    if (portrait.matches) return 'portrait';
    const px = innerWidth * Math.min(devicePixelRatio || 1, 2);
    return px >= 1500 && !slowNet ? '1080' : '720';
  }

  const srcFor = (i) => `assets/video/${areas[i].id}-${variant()}.${webm ? 'webm' : 'mp4'}`;

  function setPoster(i) {
    posterSource.srcset = `assets/img/flyover/${areas[i].id}-portrait.webp`;
    posterImg.src = `assets/img/flyover/${areas[i].id}.webp`;
  }

  function load(layer, i) {
    const src = srcFor(i);
    if (layer.dataset.src === src && !layer.error) return;
    layer.dataset.src = src;
    layer.src = src;
    layer.load(); // needed: iOS won't buffer a src it hasn't been told to load
  }

  // Resolves true (playable), false (error) or 'timeout' (still loading).
  function ready(layer) {
    return new Promise((resolve) => {
      if (layer.error) { resolve(false); return; }
      if (layer.readyState >= 3) { resolve(true); return; }
      const finish = (result) => {
        clearTimeout(timer);
        layer.removeEventListener('canplay', onReady);
        layer.removeEventListener('error', onError);
        resolve(result);
      };
      const onReady = () => finish(true);
      const onError = () => finish(false);
      const timer = setTimeout(() => finish('timeout'), 12000);
      layer.addEventListener('canplay', onReady);
      layer.addEventListener('error', onError);
    });
  }

  function updateUi(i) {
    nameEl.textContent = areas[i].name;
    suburbsEl.textContent = areas[i].suburbs;
    areas.forEach((a, j) => {
      if (j === i) a.tab.setAttribute('aria-current', 'true');
      else a.tab.removeAttribute('aria-current');
      a.tab.classList.toggle('is-done', j < i);
      if (j !== i) a.tab.style.removeProperty('--progress');
    });
  }

  function syncToggle() {
    toggle.setAttribute('aria-pressed', String(userPaused));
  }

  function showPoster(i) {
    clearTimeout(cleanup);
    layers.forEach((l) => { l.pause(); l.classList.remove('is-active'); });
    front = -1;
    frontIndex = -1;
    setPoster(i);
  }

  function nextPlayable(i) {
    for (let k = 1; k <= n; k++) {
      const j = mod(i + k);
      if (!failed.has(j)) return j;
    }
    return -1;
  }

  function preloadNext() {
    if (front === -1 || !autoAdvance) return;
    const next = nextPlayable(frontIndex);
    if (next !== -1) load(layers[1 - front], next);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
    layers.forEach((l) => l.pause());
  }

  function holdStill() {
    stop();
    userPaused = true;
    syncToggle();
  }

  function giveUp() {
    // Nothing will play (offline, blocked, missing files): settle on the poster
    // and stop offering a pause button for a still image.
    holdStill();
    toggle.hidden = true;
    desired = requested;
    updateUi(requested);
    showPoster(requested);
  }

  async function show() {
    const mine = ++token;
    pending = mine;
    clearTimeout(cleanup); // the layer we're about to reuse may still be fading out
    const target = desired;
    try {
      const back = front === -1 ? 0 : 1 - front;
      const layer = layers[back];
      load(layer, target);
      const state = await ready(layer);
      if (mine !== token || !running) return;
      if (state === 'timeout') return; // still loading; the next tick or start() retries
      if (!state) {
        if (webm) { webm = false; show(); return; } // retry once as MP4/H.264
        failed.add(target);
        const next = nextPlayable(target);
        if (next === -1) { giveUp(); return; }
        desired = next;
        if (front === -1) updateUi(next);
        show();
        return;
      }
      layer.currentTime = 0;
      try {
        await layer.play();
      } catch (err) {
        if (mine !== token || !running) return; // interrupted by stop() or a newer transition
        // Autoplay refused (e.g. iOS Low Power Mode): wait for a tap on play.
        if (err && err.name === 'NotAllowedError') { holdStill(); showPoster(target); }
        return;
      }
      if (mine !== token || !running) { layer.pause(); return; }
      failed.delete(target);
      const prev = front;
      front = back;
      frontIndex = target;
      updateUi(target);
      layer.classList.add('is-active');
      if (prev === -1) {
        preloadNext();
      } else {
        layers[prev].classList.remove('is-active');
        cleanup = setTimeout(() => { layers[prev].pause(); preloadNext(); }, FADE * 1000 + 60);
      }
    } finally {
      if (pending === mine) pending = 0;
    }
  }

  function tick() {
    raf = requestAnimationFrame(tick);
    const v = layers[front];
    if (!v || !v.duration) return;
    areas[frontIndex].tab.style.setProperty('--progress', Math.min(1, v.currentTime / v.duration).toFixed(4));
    if (!running || pending || v.duration - v.currentTime > FADE) return;
    if (!autoAdvance) {
      if (v.ended) holdStill(); // play-once mode: keep the last frame on screen
      return;
    }
    const next = nextPlayable(frontIndex);
    if (next === -1) { giveUp(); return; }
    desired = next;
    show();
  }

  function start() {
    if (running || userPaused || !inView || !pageVisible) return;
    running = true;
    if (front === -1 || desired !== frontIndex) show();
    else layers[front].play().catch(() => {});
    raf = requestAnimationFrame(tick);
  }

  // Explicit choice of an area (hero tab or an Areas-section button).
  function goTo(i) {
    desired = requested = mod(i);
    failed.delete(desired);
    // With reduced motion or Save-Data, honour the request but don't start cycling.
    if (reducedMotion.matches || lowData) autoAdvance = false;
    userPaused = false;
    toggle.hidden = false;
    syncToggle();
    updateUi(desired);
    if (running) show();
    else start();
  }

  areas.forEach((a, i) => a.tab.addEventListener('click', () => goTo(i)));

  toggle.addEventListener('click', () => {
    userPaused = !userPaused;
    syncToggle();
    if (userPaused) stop();
    else { autoAdvance = true; start(); }
  });

  onMediaChange(portrait, () => {
    // Different clips for tall screens: drop both layers and reload the current area.
    clearTimeout(cleanup);
    layers.forEach((l) => { l.pause(); l.removeAttribute('src'); delete l.dataset.src; l.load(); });
    if (frontIndex !== -1) desired = frontIndex;
    showPoster(desired);
    if (running) { token++; show(); }
  });

  onMediaChange(reducedMotion, () => {
    if (reducedMotion.matches) { autoAdvance = false; holdStill(); }
  });

  document.addEventListener('visibilitychange', () => {
    pageVisible = !document.hidden;
    if (pageVisible) start(); else stop();
  });

  syncToggle();
  updateUi(0);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      inView = entries[entries.length - 1].isIntersecting; // latest state wins
      if (inView) start(); else stop();
    }, { threshold: 0.1 }).observe(hero);
  } else {
    start();
  }

  return { goTo, areas };
}

// ---------------------------------------------------------------- header + nav

function initHeader() {
  const header = document.querySelector('[data-header]');
  const toggle = document.querySelector('[data-nav-toggle]');
  const menu = document.querySelector('[data-nav-menu]');
  if (!header) return;

  const onScroll = () => header.classList.toggle('is-scrolled', scrollY > 24);
  onScroll();
  addEventListener('scroll', onScroll, { passive: true });

  if (!toggle || !menu) return;
  const setOpen = (open) => {
    toggle.setAttribute('aria-expanded', String(open));
    menu.classList.toggle('is-open', open);
    header.classList.toggle('menu-open', open);
  };
  toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
  menu.addEventListener('click', (e) => { if (e.target.closest('a')) setOpen(false); });
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') { setOpen(false); toggle.focus(); }
  });
}

// ---------------------------------------------------------------- enquiry form

function initForm() {
  const form = document.querySelector('[data-enquiry-form]');
  if (!form) return;
  const status = form.querySelector('[data-form-status]');
  const button = form.querySelector('[type="submit"]');
  form.noValidate = true; // JS validates below; without JS the browser still checks required fields

  const setStatus = (msg, kind = '') => {
    status.textContent = msg;
    status.className = `form__status${kind ? ` is-${kind}` : ''}`;
  };

  form.addEventListener('input', (e) => {
    if (e.target.getAttribute('aria-invalid') === 'true' && e.target.checkValidity()) e.target.removeAttribute('aria-invalid');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fields = [...form.elements].filter((el) => el.willValidate);
    fields.forEach((el) => el.removeAttribute('aria-invalid'));
    const invalid = fields.filter((el) => !el.checkValidity());
    if (invalid.length) {
      invalid.forEach((el) => el.setAttribute('aria-invalid', 'true'));
      invalid[0].focus();
      setStatus('Please complete the highlighted fields.', 'error');
      return;
    }
    button.disabled = true;
    setStatus('Sending…');
    try {
      // Netlify Forms accepts an urlencoded POST to any path on the site.
      const res = await fetch('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(new FormData(form)).toString(),
      });
      if (!res.ok) throw new Error(String(res.status));
      form.reset();
      setStatus('Thanks, your enquiry is in. We’ll be in touch soon.', 'ok');
    } catch {
      setStatus('Sorry, that didn’t send. Please call 0424 186 855 or email danielle@addisonjoinery.com.au.', 'error');
    } finally {
      button.disabled = false;
    }
  });
}

// ---------------------------------------------------------------- reveal on scroll

function initReveal() {
  if (reducedMotion.matches || !('IntersectionObserver' in window)) return;
  const els = document.querySelectorAll('.section__head, .service, .area, .step, .about__copy, .glance__item, .form');
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      io.unobserve(entry.target);
    });
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0.06 });
  els.forEach((el) => {
    const siblings = el.parentElement ? [...el.parentElement.children] : [];
    el.style.transitionDelay = `${(siblings.indexOf(el) % 3) * 70}ms`;
    el.setAttribute('data-reveal', '');
    io.observe(el);
  });
  document.documentElement.classList.add('js-reveal');
}

// ---------------------------------------------------------------- boot

function safely(name, fn) {
  try { return fn(); } catch (err) { console.error(`[site] ${name} failed`, err); return null; }
}

const flyover = safely('flyover', initFlyover);
safely('header', initHeader);
safely('form', initForm);
safely('reveal', initReveal);

document.querySelectorAll('[data-year]').forEach((el) => { el.textContent = String(new Date().getFullYear()); });

document.querySelectorAll('[data-fly-to]').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (!flyover) return;
    flyover.goTo(flyover.areas.findIndex((a) => a.id === btn.dataset.flyTo));
    document.getElementById('top').scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth' });
  });
});
