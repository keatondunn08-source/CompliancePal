// Corporate Cleaning Solutions: site behaviour. Plain ES module, no dependencies.

const FADE = 0.9;          // seconds; keep in sync with .hero__layer transition in site.css
const STILL_SECONDS = 7;   // how long a map still stays on screen in the home hero tour
const PHONE = '0410 689 872';
const EMAIL = 'justin@corporatecleaningsolutions.com.au';

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const onMediaChange = (mq, fn) => (mq.addEventListener ? mq.addEventListener('change', fn) : mq.addListener(fn));

// ---------------------------------------------------------------- hero tour
//
// Slides come from the .flyover__tab buttons. A slide is either real footage
// (data-kind="video") or a map still (data-kind="still"). Two stacked layers:
// one on screen, one loading the next slide, then they crossfade. Only two
// media elements ever exist, which matters on phones.
//
// `desired` is the slide that should be on screen; `frontIndex` is the one
// that is. Each transition takes a token, so a newer transition (or a stop)
// makes older ones bail out.

function initFlyover() {
  const hero = document.querySelector('[data-flyover]');
  if (!hero) return null;

  const media = hero.querySelector('.hero__media');
  const posterImg = hero.querySelector('[data-hero-poster] img');
  const posterSource = hero.querySelector('[data-hero-poster] source');
  const nameEl = hero.querySelector('[data-flyover-name]');
  const metaEl = hero.querySelector('[data-flyover-meta]');
  const linkEl = hero.querySelector('[data-flyover-link]');
  const toggle = hero.querySelector('[data-flyover-toggle]');
  const slides = [...hero.querySelectorAll('.flyover__tab')].map((tab) => ({
    id: tab.dataset.area,
    name: tab.dataset.name,
    meta: tab.dataset.meta,
    href: tab.dataset.href,
    kind: tab.dataset.kind === 'video' ? 'video' : 'still',
    uhd: tab.dataset.uhd === '1',
    tab,
  }));
  const n = slides.length;
  if (!n) return null;
  const single = n === 1;
  const mod = (i) => ((i % n) + n) % n;

  const portrait = matchMedia('(max-aspect-ratio: 4/5)');
  const conn = navigator.connection || {};
  const lowData = Boolean(conn.saveData) || /(^|-)2g$/.test(conn.effectiveType || '');
  const slowNet = lowData || /3g/.test(conn.effectiveType || '');
  // Browsers without the Network Information API (Safari, Firefox) are given the benefit of the doubt.
  const fastNet = !conn.effectiveType || (conn.effectiveType === '4g' && (conn.downlink == null || conn.downlink >= 8));

  const layers = [0, 1].map(() => {
    const el = document.createElement('div');
    el.className = 'hero__layer';
    media.appendChild(el);
    return { el, video: null, img: null, kind: '' };
  });
  let webm = document.createElement('video').canPlayType('video/webm; codecs="vp9"') !== '';

  // ---- sources

  const imgDir = (s) => (s.kind === 'video' ? 'footage' : 'map');
  const landscapeSet = (s) => [960, 1440, 1920, 2560].map((w) => `/assets/img/${imgDir(s)}/${s.id}-${w}.webp ${w}w`).join(', ');
  const portraitSet = (s) => [720, 1080].map((w) => `/assets/img/${imgDir(s)}/${s.id}-portrait-${w}.webp ${w}w`).join(', ');

  // 4K only goes to big screens with more pixels than 1080p can fill: at least
  // 1600 CSS px wide and 2400+ physical px (1440p monitors and up, 4K/5K displays,
  // large Retina laptops), on a fast connection. Phones get a portrait cut.
  function videoVariant(s) {
    if (portrait.matches) return 'portrait';
    const px = innerWidth * Math.min(devicePixelRatio || 1, 3);
    if (s.uhd && fastNet && !slowNet && innerWidth >= 1600 && px >= 2400) return '2160';
    return px >= 1500 && !slowNet ? '1080' : '720';
  }
  const videoSrc = (s) => `/assets/video/${s.id}-${videoVariant(s)}.${webm ? 'webm' : 'mp4'}`;

  // ---- state

  const failed = new Set();
  let requested = 0;
  let desired = 0;
  let front = -1;                                   // layer on screen (-1: the poster)
  let frontIndex = slides[0].kind === 'still' ? 0 : -1; // the poster already shows a still slide 0
  let running = false;
  let userPaused = reducedMotion.matches || lowData;
  let autoAdvance = !userPaused && !single;
  let inView = true;
  let pageVisible = !document.hidden;
  let token = 0;
  let pending = 0;
  let cleanup = 0;
  let raf = 0;
  let preloadedFor = -1;      // slide whose successor has been preloaded

  // A clock for still slides, which have no currentTime of their own.
  let clockStart = 0;
  let clockElapsed = 0;
  let clockOn = false;
  const clockNow = () => (clockElapsed + (clockOn ? performance.now() - clockStart : 0)) / 1000;
  const clockReset = () => { clockElapsed = 0; clockStart = performance.now(); clockOn = true; };
  const clockPause = () => { if (clockOn) { clockElapsed += performance.now() - clockStart; clockOn = false; } };
  const clockResume = () => { if (!clockOn) { clockStart = performance.now(); clockOn = true; } };

  // ---- layers

  function withTimeout(promise, ms = 12000) {
    let timer;
    return Promise.race([promise, new Promise((r) => { timer = setTimeout(() => r('timeout'), ms); })]).finally(() => clearTimeout(timer));
  }

  function videoReady(v) {
    if (v.error) return Promise.resolve(false);
    if (v.readyState >= 3) return Promise.resolve(true);
    return withTimeout(new Promise((resolve) => {
      const done = (ok) => { v.removeEventListener('canplay', yes); v.removeEventListener('error', no); resolve(ok); };
      const yes = () => done(true);
      const no = () => done(false);
      v.addEventListener('canplay', yes);
      v.addEventListener('error', no);
    }));
  }

  function prepareVideo(layer, s) {
    if (layer.img) { layer.img.remove(); layer.img = null; }
    let v = layer.video;
    if (!v) {
      v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.setAttribute('muted', '');
      v.setAttribute('playsinline', '');
      v.preload = 'auto';
      v.disablePictureInPicture = true;
      v.setAttribute('aria-hidden', 'true');
      layer.el.appendChild(v);
      layer.video = v;
    }
    v.loop = single;
    const src = videoSrc(s);
    if (v.dataset.src !== src || v.error) {
      v.dataset.src = src;
      v.src = src;
      v.load(); // iOS won't buffer a src it hasn't been told to load
    }
    layer.kind = 'video';
    return videoReady(v);
  }

  function prepareStill(layer, s) {
    if (layer.video) { layer.video.pause(); layer.video.removeAttribute('src'); layer.video.load(); layer.video.remove(); layer.video = null; }
    let img = layer.img;
    if (!img) {
      img = document.createElement('img');
      img.alt = '';
      img.decoding = 'async';
      img.sizes = '100vw';
      layer.el.appendChild(img);
      layer.img = img;
    }
    const set = portrait.matches ? portraitSet(s) : landscapeSet(s);
    if (img.dataset.set !== set) { img.dataset.set = set; img.srcset = set; }
    layer.kind = 'still';
    return withTimeout(img.decode().then(() => true, () => false));
  }

  const prepare = (layer, s) => (s.kind === 'video' ? prepareVideo(layer, s) : prepareStill(layer, s));

  function pauseLayer(layer) { if (layer.video) layer.video.pause(); }

  function drift(img) {
    if (!img || reducedMotion.matches) return;
    img.classList.remove('is-drifting');
    void img.offsetWidth; // restart the CSS animation
    img.classList.add('is-drifting');
  }

  // ---- UI

  function updateUi(i) {
    const s = slides[i];
    if (nameEl) nameEl.textContent = s.name;
    if (metaEl) metaEl.textContent = s.meta;
    if (linkEl) linkEl.href = s.href;
    slides.forEach((x, j) => {
      if (j === i) x.tab.setAttribute('aria-current', 'true');
      else x.tab.removeAttribute('aria-current');
      x.tab.classList.toggle('is-done', j < i);
      if (j !== i) x.tab.style.removeProperty('--progress');
    });
  }

  const syncToggle = () => toggle && toggle.setAttribute('aria-pressed', String(userPaused));

  function setPoster(i) {
    if (!posterImg) return;
    const s = slides[i];
    if (posterSource) posterSource.srcset = portraitSet(s);
    posterImg.srcset = landscapeSet(s);
  }

  function showPoster(i) {
    clearTimeout(cleanup);
    layers.forEach((l) => { pauseLayer(l); l.el.classList.remove('is-active'); });
    front = -1;
    setPoster(i);
    frontIndex = slides[i].kind === 'still' ? i : -1;
    if (frontIndex !== -1) clockReset();
  }

  function nextPlayable(i) {
    for (let k = 1; k <= n; k++) {
      const j = mod(i + k);
      if (!failed.has(j)) return j;
    }
    return -1;
  }

  function preloadNext() {
    if (!autoAdvance || frontIndex === -1 || pending) return;
    const next = nextPlayable(frontIndex);
    if (next === -1 || next === frontIndex) return;
    const back = front === -1 ? 0 : 1 - front;
    prepare(layers[back], slides[next]);
  }

  // ---- playback

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
    layers.forEach(pauseLayer);
    clockPause();
    hero.classList.add('is-paused');
  }

  function holdStill() {
    stop();
    userPaused = true;
    syncToggle();
  }

  function giveUp() {
    // Nothing will play (offline, blocked, missing files): settle on the poster.
    holdStill();
    if (toggle) toggle.hidden = true;
    desired = requested;
    updateUi(requested);
    showPoster(requested);
  }

  async function show() {
    const mine = ++token;
    pending = mine;
    clearTimeout(cleanup);
    const target = desired;
    const s = slides[target];
    try {
      const back = front === -1 ? 0 : 1 - front;
      const layer = layers[back];
      const state = await prepare(layer, s);
      if (mine !== token || !running) return;
      if (state === 'timeout') return; // still loading; the next tick or start() retries
      if (!state) {
        if (s.kind === 'video' && webm) { webm = false; show(); return; } // retry once as MP4/H.264
        failed.add(target);
        const next = nextPlayable(target);
        if (next === -1) { giveUp(); return; }
        desired = next;
        show();
        return;
      }
      if (s.kind === 'video') {
        layer.video.currentTime = 0;
        try {
          await layer.video.play();
        } catch (err) {
          if (mine !== token || !running) return;
          // Autoplay refused (e.g. iOS Low Power Mode): wait for a tap on play.
          if (err && err.name === 'NotAllowedError') { holdStill(); showPoster(target); }
          return;
        }
        if (mine !== token || !running) { layer.video.pause(); return; }
      } else {
        drift(layer.img);
        clockReset();
      }
      failed.delete(target);
      const prev = front;
      front = back;
      frontIndex = target;
      updateUi(target);
      layer.el.classList.add('is-active');
      if (prev !== -1) {
        layers[prev].el.classList.remove('is-active');
        cleanup = setTimeout(() => pauseLayer(layers[prev]), FADE * 1000 + 60);
      }
    } finally {
      if (pending === mine) pending = 0;
    }
  }

  function tick() {
    raf = requestAnimationFrame(tick);
    if (frontIndex === -1) return;
    const s = slides[frontIndex];
    const layer = front === -1 ? null : layers[front];
    let t;
    let dur;
    if (layer && layer.kind === 'video') {
      const v = layer.video;
      if (!v || !v.duration) return;
      t = v.currentTime;
      dur = v.duration;
    } else {
      t = clockNow();
      dur = STILL_SECONDS;
    }
    s.tab.style.setProperty('--progress', Math.min(1, t / dur).toFixed(4));
    // Load the next slide once this one is under way, so it never competes with the first paint.
    if (running && !pending && preloadedFor !== frontIndex && t > Math.min(2.5, dur / 3)) { preloadedFor = frontIndex; preloadNext(); }
    if (!running || pending || single || dur - t > FADE) return;
    if (!autoAdvance) {
      if (t >= dur || (layer && layer.video && layer.video.ended)) holdStill(); // play-once mode
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
    hero.classList.remove('is-paused');
    if (frontIndex !== -1 && desired === frontIndex) {
      const layer = front === -1 ? null : layers[front];
      if (layer && layer.kind === 'video') layer.video.play().catch(() => {});
      else clockResume();
    } else {
      show();
    }
    raf = requestAnimationFrame(tick);
  }

  // Explicit choice of a slide (a tab).
  function goTo(i) {
    desired = requested = mod(i);
    failed.delete(desired);
    if (reducedMotion.matches || lowData) autoAdvance = false; // honour the request, but don't start cycling
    userPaused = false;
    if (toggle) toggle.hidden = false;
    syncToggle();
    updateUi(desired);
    if (running) show();
    else start();
  }

  slides.forEach((s, i) => s.tab.addEventListener('click', () => goTo(i)));

  if (toggle) {
    toggle.addEventListener('click', () => {
      userPaused = !userPaused;
      syncToggle();
      if (userPaused) stop();
      else { autoAdvance = !single; start(); }
    });
  }

  onMediaChange(portrait, () => {
    // Different files for tall screens: reload whatever is showing.
    clearTimeout(cleanup);
    layers.forEach((l) => {
      if (l.video) { l.video.pause(); l.video.removeAttribute('src'); delete l.video.dataset.src; l.video.load(); }
      if (l.img) delete l.img.dataset.set;
    });
    const i = frontIndex !== -1 ? frontIndex : desired;
    desired = i;
    showPoster(i);
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
  if (userPaused) hero.classList.add('is-paused');
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      inView = entries[entries.length - 1].isIntersecting;
      if (inView) start(); else stop();
    }, { threshold: 0.1 }).observe(hero);
  } else {
    start();
  }

  return { goTo, slides };
}

// ---------------------------------------------------------------- header + nav

function initHeader() {
  const header = document.querySelector('[data-header]');
  const toggle = document.querySelector('[data-nav-toggle]');
  const menu = document.querySelector('[data-nav-menu]');
  if (!header) return;

  // A sentinel at the top of the page tells us when it's scrolled away, without
  // reading scrollY (which forces a layout if it runs before the first one).
  if ('IntersectionObserver' in window) {
    const sentinel = document.createElement('div');
    sentinel.className = 'scroll-sentinel';
    sentinel.setAttribute('aria-hidden', 'true');
    document.body.prepend(sentinel);
    new IntersectionObserver(([entry]) => header.classList.toggle('is-scrolled', !entry.isIntersecting)).observe(sentinel);
  } else {
    const onScroll = () => header.classList.toggle('is-scrolled', scrollY > 24);
    addEventListener('scroll', onScroll, { passive: true });
    requestAnimationFrame(onScroll);
  }

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

// ---------------------------------------------------------------- quote form

function initForm() {
  const form = document.querySelector('[data-quote-form]');
  if (!form) return;
  const status = form.querySelector('[data-form-status]');
  const button = form.querySelector('[type="submit"]');
  form.noValidate = true; // validated below; without JS the browser still checks required fields

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
      setStatus(`Fill in the ${invalid.length === 1 ? 'highlighted field' : `${invalid.length} highlighted fields`} to send your request.`, 'error');
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
      setStatus('Request sent. We’ll call you to book the site walk.', 'ok');
    } catch {
      setStatus(`Your request didn’t send. Call ${PHONE} or email ${EMAIL} instead.`, 'error');
    } finally {
      button.disabled = false;
    }
  });
}

// ---------------------------------------------------------------- regions map

function initRegionsMaps() {
  const holders = [...document.querySelectorAll('[data-regions-map]')];
  if (!holders.length) return;
  let svgText = null;

  const load = () => {
    svgText = svgText || fetch('/assets/img/brisbane-regions.svg').then((r) => (r.ok ? r.text() : Promise.reject(r.status)));
    return svgText;
  };

  function mount(holder) {
    load().then((text) => {
      holder.innerHTML = text; // our own static file
      const groups = [...holder.querySelectorAll('.rm-region')];
      const marked = [...holder.querySelectorAll('svg [data-region]')]; // shapes and labels
      const scope = holder.closest('.regions') || holder;
      const links = [...scope.querySelectorAll('.region-link[data-region]')];
      const setActive = (id) => {
        marked.forEach((g) => g.classList.toggle('is-active', g.dataset.region === id));
        links.forEach((l) => l.classList.toggle('is-active', l.dataset.region === id));
      };
      marked.forEach((g) => { if (g.dataset.region === holder.dataset.highlight) g.classList.add('is-current'); });
      groups.forEach((g) => {
        g.addEventListener('click', () => { location.href = g.dataset.href; });
        g.addEventListener('pointerenter', () => setActive(g.dataset.region));
        g.addEventListener('pointerleave', () => setActive(null));
      });
      links.forEach((l) => {
        l.addEventListener('pointerenter', () => setActive(l.dataset.region));
        l.addEventListener('pointerleave', () => setActive(null));
        l.addEventListener('focus', () => setActive(l.dataset.region));
        l.addEventListener('blur', () => setActive(null));
      });
    }).catch(() => {}); // the list beside the map still works without it
  }

  if (!('IntersectionObserver' in window)) { holders.forEach(mount); return; }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      io.unobserve(entry.target);
      mount(entry.target);
    });
  }, { rootMargin: '600px 0px' });
  holders.forEach((h) => io.observe(h));
}

// ---------------------------------------------------------------- boot

function safely(name, fn) {
  try { return fn(); } catch (err) { console.error(`[site] ${name} failed`, err); return null; }
}

safely('flyover', initFlyover);
safely('header', initHeader);
safely('form', initForm);
safely('regions', initRegionsMaps);
