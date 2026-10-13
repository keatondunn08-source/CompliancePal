// Generates the static site into ../../site from content.mjs and the data files in ./data.
// Usage: node tools/build/build.mjs   (no dependencies; Node 18+)
//
// Inputs:
//   content.mjs              copy, business facts, regions
//   data/regions-map.json    region geometry (tools/maps)
//   data/region-facts.json   per-region facts computed from map data (tools/maps)
//   data/footage.json        which regions have real footage + credits (tools/footage)
// The CSS and JS in site/assets are hand-written; this script only writes HTML, SVG, XML and txt.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { business as B, nav, services, specialist, regions, schoolYear } from './content.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SITE = join(here, '../../site');
const readJson = (p, fallback) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : fallback);

const mapData = readJson(join(here, 'data/regions-map.json'), null);
const facts = readJson(join(here, 'data/region-facts.json'), {});
const footage = readJson(join(here, 'data/footage.json'), {});

const TODAY = new Date().toISOString().slice(0, 10);
const YEAR = new Date().getFullYear();

// ------------------------------------------------------------------ helpers

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const abs = (path) => `${B.url}${path}`;
const hash = (file) => createHash('sha256').update(readFileSync(join(SITE, file))).digest('hex').slice(0, 10);
const svcById = Object.fromEntries(services.map((s) => [s.id, s]));
const regionById = Object.fromEntries(regions.map((r) => [r.id, r]));
const hasVideo = (id) => Boolean(footage[id]);
const kmFor = (id) => facts[id]?.kmFromBase ?? mapData?.regions.find((r) => r.id === id)?.kmFromBase;
const addressLine = `${B.address.street}, ${B.address.locality} ${B.address.region} ${B.address.postcode}`;

function write(path, html) {
  const file = join(SITE, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html);
}

// Responsive sources for a region's hero: real footage poster if we have footage, otherwise the map still.
function heroSources(id) {
  const dir = hasVideo(id) ? 'footage' : 'map';
  const base = `/assets/img/${dir}/${id}`;
  return {
    landscape: [960, 1440, 1920, 2560].map((w) => `${base}-${w}.webp ${w}w`).join(', '),
    portrait: [720, 1080].map((w) => `${base}-portrait-${w}.webp ${w}w`).join(', '),
    fallback: `${base}-1440.webp`,
  };
}

const icon = {
  phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>',
  mail: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18v12H3z"/><path d="m3 7 9 6 9-6"/></svg>',
  pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  arrow: '<svg class="arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  pause: '<svg class="icon-pause" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14"/></svg>',
  play: '<svg class="icon-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12.5-7.5z"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
};

const mark = '<svg class="brand__mark" viewBox="0 0 40 40" aria-hidden="true"><rect x="1.5" y="1.5" width="37" height="37" rx="11" class="brand__pane"/><circle cx="27.5" cy="27" r="1.7" class="brand__drop"/><circle cx="31.5" cy="22.5" r="1.2" class="brand__drop"/><circle cx="22.5" cy="31.5" r="1.2" class="brand__drop"/><path d="M11 29 29 11" class="brand__blade"/><path d="M8.5 21.5 21.5 8.5" class="brand__sheen"/></svg>';

// ------------------------------------------------------------------ shared chrome

function head({ path, title, description, preload = '', jsonld = [] }) {
  const graph = { '@context': 'https://schema.org', '@graph': jsonld };
  return `<!doctype html>
<html lang="en-AU">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${abs(path)}">
  <meta name="theme-color" content="#12172a">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${esc(B.name)}">
  <meta property="og:locale" content="en_AU">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${abs(path)}">
  <meta property="og:image" content="${abs('/assets/img/og.jpg')}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="/assets/img/favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/assets/img/apple-touch-icon.png">
  <link rel="preload" href="/assets/fonts/archivo-var.woff2" as="font" type="font/woff2" crossorigin>
${preload}  <link rel="stylesheet" href="/assets/css/site.css?v=${hash('assets/css/site.css')}">
  <script type="module" src="/assets/js/site.js?v=${hash('assets/js/site.js')}"></script>
${jsonld.length ? `  <script type="application/ld+json">${JSON.stringify(graph)}</script>\n` : ''}</head>`;
}

function header(path) {
  const items = nav.map(({ href, label }) => {
    const current = path === href || (href !== '/' && path.startsWith(href));
    return `<li><a href="${href}"${current ? ' aria-current="page"' : ''}>${esc(label)}</a></li>`;
  }).join('\n          ');
  return `<a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header" data-header>
    <div class="wrap site-header__inner">
      <a class="brand" href="/">${mark}<span class="brand__text"><span class="brand__name">Corporate Cleaning</span><span class="brand__sub">Solutions · Brisbane</span></span></a>
      <nav class="site-nav" aria-label="Main">
        <button class="site-nav__toggle" type="button" aria-expanded="false" aria-controls="site-menu" data-nav-toggle>
          <span class="visually-hidden">Menu</span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h18M3 12h18M3 17h18"/></svg>
        </button>
        <ul class="site-nav__menu" id="site-menu" data-nav-menu>
          ${items}
          <li class="site-nav__phone"><a href="${B.phone.href}">${B.phone.display}</a></li>
          <li class="site-nav__cta"><a class="button button--small" href="#quote">Book a site walk</a></li>
        </ul>
      </nav>
    </div>
  </header>`;
}

function footer() {
  const credits = Object.values(footage).map((f) => f.credit).filter(Boolean);
  const footageCredit = credits.length
    ? ` Aerial footage: ${credits.map((c) => `<a href="${esc(c.url)}" rel="noopener">${esc(c.title || 'clip')}</a> by ${esc(c.author)} (${esc(c.source)})`).join('; ')}.`
    : '';
  return `<footer class="site-footer">
    <div class="wrap site-footer__grid">
      <div class="site-footer__about">
        <a class="brand brand--footer" href="/">${mark}<span class="brand__text"><span class="brand__name">Corporate Cleaning</span><span class="brand__sub">Solutions · Brisbane</span></span></a>
        <p>Family-run contract cleaning for Brisbane’s private schools, builders and commercial buildings since ${B.founded}.</p>
      </div>
      <nav class="site-footer__col" aria-label="Services">
        <h2 class="site-footer__h">Services</h2>
        <ul role="list">${services.map((s) => `<li><a href="${s.href}">${esc(s.name)}</a></li>`).join('')}</ul>
      </nav>
      <nav class="site-footer__col" aria-label="Service areas">
        <h2 class="site-footer__h">Areas</h2>
        <ul role="list">${regions.map((r) => `<li><a href="/areas/${r.id}/">${esc(r.name)}</a></li>`).join('')}</ul>
      </nav>
      <div class="site-footer__col">
        <h2 class="site-footer__h">Contact</h2>
        <ul role="list">
          <li><a href="${B.phone.href}">${B.phone.display}</a></li>
          <li><a href="mailto:${B.email}">${B.email.replace('@', '<wbr>@')}</a></li>
          <li>${esc(B.address.street)}<br>${esc(B.address.locality)} ${B.address.region} ${B.address.postcode}</li>
        </ul>
      </div>
    </div>
    <div class="wrap site-footer__legal">
      <p>© ${YEAR} ${esc(B.legalName)}</p>
      <p class="site-footer__credits" id="credits">Maps drawn from data © OpenStreetMap contributors and the Overture Maps Foundation (ODbL).${footageCredit}</p>
    </div>
  </footer>`;
}

function page({ path, title, description, preload, jsonld, main, bodyClass = '' }) {
  return `${head({ path, title, description, preload, jsonld })}
<body${bodyClass ? ` class="${bodyClass}"` : ''}>
  ${header(path)}
  <main id="main">
${main}
  </main>
  ${footer()}
</body>
</html>
`;
}

// ------------------------------------------------------------------ JSON-LD

const BIZ_ID = `${B.url}/#business`;

function businessLd() {
  return {
    '@type': 'LocalBusiness',
    '@id': BIZ_ID,
    name: B.name,
    legalName: B.legalName,
    url: `${B.url}/`,
    logo: abs('/assets/img/favicon.svg'),
    image: abs('/assets/img/og.jpg'),
    description: 'Family-run contract cleaning for private schools, builders’ handover cleans and small-to-medium commercial buildings across Brisbane.',
    foundingDate: B.founded,
    telephone: B.phone.intl,
    email: B.email,
    address: {
      '@type': 'PostalAddress',
      streetAddress: B.address.street,
      addressLocality: B.address.locality,
      addressRegion: B.address.region,
      postalCode: B.address.postcode,
      addressCountry: 'AU',
    },
    areaServed: regions.map((r) => ({ '@type': 'Place', name: `${r.long}, Brisbane QLD` })),
    knowsAbout: ['School cleaning', 'Builders’ cleans', 'Commercial cleaning', 'Body corporate cleaning', 'Vinyl stripping and sealing', 'Carpet steam cleaning', 'Tile cleaning', 'Pressure cleaning', 'Glass cleaning'],
  };
}

const crumbsLd = (trail) => ({
  '@type': 'BreadcrumbList',
  itemListElement: trail.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: abs(path) })),
});

const serviceLd = ({ name, path, description, areaServed }) => ({
  '@type': 'Service',
  name,
  url: abs(path),
  description,
  provider: { '@id': BIZ_ID },
  areaServed: areaServed || { '@type': 'City', name: 'Brisbane' },
});

// ------------------------------------------------------------------ components

function frost() {
  return `<div class="frost" aria-hidden="true"><div class="frost__wipe"><div class="frost__pane"></div></div><div class="frost__blade"></div></div>`;
}

function crumbs(trail) {
  return `<nav class="crumbs" aria-label="Breadcrumb"><ol role="list">${trail.map(([name, path], i) =>
    i === trail.length - 1 ? `<li><span aria-current="page">${esc(name)}</span></li>` : `<li><a href="${path}">${esc(name)}</a></li>`).join('')}</ol></nav>`;
}

// The hero image is never the LCP element (Chrome ignores full-viewport images; the headline is LCP),
// so it loads at low priority and never competes with the fonts and CSS. The frost covers it meanwhile.
function poster(id) {
  const s = heroSources(id);
  return `<picture class="hero__poster" data-hero-poster>
          <source media="(max-aspect-ratio: 4/5)" srcset="${s.portrait}" sizes="100vw">
          <img src="${s.fallback}" srcset="${s.landscape}" sizes="100vw" width="1920" height="1080" alt="" fetchpriority="low" decoding="async">
        </picture>`;
}

function slideCaption(r) {
  return hasVideo(r.id) ? `Real footage · ${footage[r.id].caption}` : r.suburbs.join(' · ');
}

function tabButton(r, current) {
  const f = footage[r.id];
  return `<button type="button" class="flyover__tab" data-area="${r.id}" data-name="${esc(r.name)}" data-meta="${esc(slideCaption(r))}" data-href="/areas/${r.id}/" data-kind="${f ? 'video' : 'still'}"${f?.uhd ? ' data-uhd="1"' : ''}${current ? ' aria-current="true"' : ''}><span class="flyover__tab-name">${esc(r.name)}</span><span class="flyover__bar"><span class="flyover__fill"></span></span></button>`;
}

// Home hero: cycles through every region (real footage where we have it, map stills elsewhere).
function heroHome(slides) {
  const first = slides[0];
  return `    <section class="hero hero--media hero--home" id="top" aria-labelledby="hero-title" data-flyover>
      <div class="hero__media" aria-hidden="true">
        ${poster(first.id)}
      </div>
      <div class="hero__scrim" aria-hidden="true"></div>
      ${frost()}
      <div class="wrap hero__content">
        <h1 class="hero__title" id="hero-title"><span class="hero__kicker eyebrow eyebrow--light">Brisbane school &amp; commercial cleaners · Since ${B.founded}</span> Spotless schools. <span class="hero__title-alt">Handover&#8209;ready sites.</span></h1>
        <p class="hero__lede">We clean Brisbane’s private schools and commercial buildings, and get new builds ready for handover. One family business, based in Moorooka.</p>
        <div class="hero__actions">
          <a class="button button--bloom" href="#quote">Book a site walk</a>
          <a class="button button--ghost" href="${B.phone.href}">Call ${B.phone.display}</a>
        </div>
      </div>
      <div class="flyover">
        <div class="wrap flyover__inner">
          <p class="flyover__now">
            <span class="flyover__label">Now showing</span>
            <a class="flyover__name" href="/areas/${first.id}/" data-flyover-link><span data-flyover-name>${esc(first.name)}</span>${icon.arrow}</a>
            <span class="flyover__meta" data-flyover-meta>${esc(slideCaption(first))}</span>
          </p>
          <ol class="flyover__tabs" role="list" aria-label="Service areas">
            ${slides.map((r, i) => `<li>${tabButton(r, i === 0)}</li>`).join('\n            ')}
          </ol>
          <button type="button" class="flyover__toggle" data-flyover-toggle aria-pressed="false">${icon.pause}${icon.play}<span class="visually-hidden">Pause the area tour</span></button>
        </div>
      </div>
    </section>`;
}

function heroArea(r) {
  const video = hasVideo(r.id);
  return `    <section class="hero hero--media hero--area" id="top" aria-labelledby="hero-title"${video ? ' data-flyover' : ''}>
      <div class="hero__media" aria-hidden="true">
        ${poster(r.id)}
      </div>
      <div class="hero__scrim" aria-hidden="true"></div>
      ${frost()}
      <div class="wrap hero__content">
        ${crumbs([['Home', '/'], ['Areas', '/areas/'], [r.name, `/areas/${r.id}/`]])}
        <p class="eyebrow eyebrow--light">Service area · ${esc(r.name)}</p>
        <h1 class="hero__title hero__title--area" id="hero-title">${esc(r.h1)}</h1>
        <p class="hero__lede">${esc(r.lede)}</p>
        <div class="hero__actions">
          <a class="button button--bloom" href="#quote">Book a site walk</a>
          <a class="button button--ghost" href="${B.phone.href}">Call ${B.phone.display}</a>
        </div>
      </div>
      <div class="flyover flyover--single">
        <div class="wrap flyover__inner">
          <p class="flyover__now">
            <span class="flyover__label">${video ? 'Real footage' : 'The suburbs we cover'}</span>
            <span class="flyover__meta">${esc(video ? footage[r.id].caption : r.suburbs.join(' · '))}</span>
          </p>
          ${video ? `<ol class="flyover__tabs" role="list" hidden><li>${tabButton(r, true)}</li></ol>
          <button type="button" class="flyover__toggle" data-flyover-toggle aria-pressed="false">${icon.pause}${icon.play}<span class="visually-hidden">Pause the video</span></button>` : ''}
        </div>
      </div>
    </section>`;
}

function heroType({ eyebrow, title, lede, trail, motif = 'tiles' }) {
  return `    <section class="hero hero--type hero--${motif}" id="top" aria-labelledby="hero-title">
      <div class="hero__motif" aria-hidden="true"></div>
      ${frost()}
      <div class="wrap hero__content">
        ${trail ? crumbs(trail) : ''}
        <p class="eyebrow eyebrow--light">${esc(eyebrow)}</p>
        <h1 class="hero__title hero__title--type" id="hero-title">${title}</h1>
        <p class="hero__lede">${lede}</p>
        <div class="hero__actions">
          <a class="button button--bloom" href="#quote">Book a site walk</a>
          <a class="button button--ghost" href="${B.phone.href}">Call ${B.phone.display}</a>
        </div>
      </div>
    </section>`;
}

function sectionHead({ eyebrow, title, intro, id, light = false }) {
  return `<div class="section__head">
          <p class="eyebrow${light ? ' eyebrow--light' : ''}">${esc(eyebrow)}</p>
          <h2 class="section__title" id="${id}">${title}</h2>
          ${intro ? `<p class="section__intro">${intro}</p>` : ''}
        </div>`;
}

const stages = [
  { name: 'Rough clean', when: 'When the trades finish', text: 'Site rubbish out. Cement dust and debris off floors, sills, benches and stairs.' },
  { name: 'Final clean', when: 'Before inspection', text: 'Glass inside and out, frames and tracks, fixtures, joinery, washrooms and kitchens, then floors finished to suit the surface.' },
  { name: 'Touch-up clean', when: 'After defects', text: 'A pass over everywhere the trades went back into, so the handover walk-through sees a finished building.' },
];

function specialties({ headingLevel = 3 } = {}) {
  const h = `h${headingLevel}`;
  return `<ul class="specialties" role="list">
          <li class="specialty specialty--schools">
            <p class="specialty__kicker">Specialty</p>
            <${h} class="specialty__title"><a href="${svcById.schools.href}">${esc(svcById.schools.name)}</a></${h}>
            <p>${esc(svcById.schools.blurb)}</p>
            <ul class="ticks ticks--cols" role="list" aria-label="Across the campus">
              ${['Classrooms', 'Toilet blocks', 'Halls & gyms', 'Staff rooms', 'Glass & entries', 'Outdoor areas'].map((z) => `<li>${icon.check}${esc(z)}</li>`).join('')}
            </ul>
            <ol class="term-strip" role="list" aria-label="How the work fits the school year">
              ${schoolYear.map((t) => `<li class="term-strip__seg term-strip__seg--${t.kind}"><span class="visually-hidden">${esc(t.label)}: ${t.kind === 'term' ? 'daily cleaning' : 'deep floor work'}</span></li>`).join('')}
            </ol>
            <p class="term-strip__key" aria-hidden="true"><span class="key key--term">Term: daily clean</span><span class="key key--break">Holidays: floors &amp; deep clean</span></p>
          </li>
          <li class="specialty specialty--builders">
            <p class="specialty__kicker">Specialty</p>
            <${h} class="specialty__title"><a href="${svcById.builders.href}">${esc(svcById.builders.name)}</a></${h}>
            <p>${esc(svcById.builders.blurb)}</p>
            <ol class="stage-chips" role="list" aria-label="The three stages of a builders’ clean">
              ${stages.map((s) => `<li>${esc(s.name)}</li>`).join('')}
            </ol>
          </li>
          <li class="specialty specialty--commercial">
            <p class="specialty__kicker">Specialty</p>
            <${h} class="specialty__title"><a href="${svcById.commercial.href}">${esc(svcById.commercial.name)}</a></${h}>
            <p>${esc(svcById.commercial.blurb)}</p>
            <ul class="chips" role="list" aria-label="Specialist services">
              ${specialist.map((s) => `<li>${esc(s.name)}</li>`).join('')}
            </ul>
          </li>
        </ul>`;
}

function washroomFeature({ id = 'washrooms-title', compact = false } = {}) {
  return `    <section class="section section--ink washrooms" aria-labelledby="${id}">
      <div class="wrap washrooms__grid">
        <div class="washrooms__head">
          <p class="eyebrow eyebrow--light">Washrooms</p>
          <h2 class="section__title washrooms__title" id="${id}">Toilet blocks that don’t smell like toilet&nbsp;blocks.</h2>
        </div>
        <div class="washrooms__copy">
          <p>Odour is the most common complaint about washrooms in any busy building, and school toilet blocks are some of the busiest. Fragrance only covers it up for a while.</p>
          <p>We use biological cleaning agents, which break down the residue that causes the smell. The product we use is biodegradable and works on most washroom surfaces.</p>
          ${compact ? '' : '<p>It doesn’t replace everything. Toilet bowls still get a dedicated bowl cleaner, because that is what works best on them.</p>'}
          <ul class="ticks" role="list">
            <li>${icon.check}Breaks down the cause of odours</li>
            <li>${icon.check}Biodegradable</li>
            <li>${icon.check}Safe on most washroom surfaces</li>
          </ul>
        </div>
      </div>
    </section>`;
}

function regionsBlock({ highlight = '', headingLevel = 3, compact = false } = {}) {
  const h = `h${headingLevel}`;
  const list = regions.map((r) => {
    const km = kmFor(r.id);
    return `<li><a class="region-link${r.id === highlight ? ' is-current' : ''}" href="/areas/${r.id}/" data-region="${r.id}"${r.id === highlight ? ' aria-current="page"' : ''}>
              <${h} class="region-link__name">${esc(r.name)}</${h}>
              <span class="region-link__suburbs">${esc(r.suburbs.join(' · '))}</span>
              ${km != null ? `<span class="region-link__km">${r.id === 'southside' ? 'Home base' : `${Number(km).toFixed(1)} km from our base`}</span>` : ''}
              ${icon.arrow}
            </a></li>`;
  }).join('\n            ');
  return `<div class="regions${compact ? ' regions--compact' : ''}">
          <div class="regions__map" data-regions-map${highlight ? ` data-highlight="${highlight}"` : ''}></div>
          <ul class="regions__list" role="list">
            ${list}
          </ul>
        </div>`;
}

function processSteps() {
  const steps = [
    ['We walk the site with you', 'We look at every area that needs cleaning and talk through how often, when, and anything that hasn’t worked before.'],
    ['You get a written scope and price', 'Each area, each task and how often it’s done, written down so everyone knows what’s included.'],
    ['We start when it suits you', 'The first day of term, the week before handover, or the first of the month.'],
  ];
  return `<ol class="steps" role="list">
          ${steps.map(([t, d], i) => `<li class="step"><span class="step__num" aria-hidden="true">${i + 1}</span><h3 class="step__title">${esc(t)}</h3><p>${esc(d)}</p></li>`).join('\n          ')}
        </ol>`;
}

function quote({ source, title = 'Tell us about the building.', intro }) {
  const types = ['Private school', 'Builders’ clean', 'Commercial building', 'Body corporate common areas', 'Specialist floor, carpet or glass work', 'Something else'];
  return `    <section class="section quote" id="quote" aria-labelledby="quote-title">
      <div class="wrap quote__grid">
        <div class="quote__intro">
          <p class="eyebrow">Book a site walk</p>
          <h2 class="section__title" id="quote-title">${title}</h2>
          <p>${intro || 'Send us the details and we’ll call you to arrange a time to walk through the building together. You’ll get a written scope and price after that.'}</p>
          <ul class="contact-list" role="list">
            <li>${icon.phone}<a href="${B.phone.href}">${B.phone.display}</a></li>
            <li>${icon.mail}<a href="mailto:${B.email}">${B.email.replace('@', '<wbr>@')}</a></li>
            <li>${icon.pin}<span>${esc(B.address.street)}<br>${esc(B.address.locality)} ${B.address.region} ${B.address.postcode}</span></li>
          </ul>
        </div>
        <form class="form" name="quote" method="POST" action="/thank-you/" data-netlify="true" netlify-honeypot="bot-field" data-quote-form>
          <input type="hidden" name="form-name" value="quote">
          <input type="hidden" name="page" value="${esc(source)}">
          <p hidden><label>Leave this empty: <input name="bot-field" tabindex="-1" autocomplete="off"></label></p>
          <div class="form__row">
            <div class="field">
              <label for="q-name">Your name</label>
              <input id="q-name" name="name" autocomplete="name" required>
            </div>
            <div class="field">
              <label for="q-org">Organisation <span class="field__opt">(optional)</span></label>
              <input id="q-org" name="organisation" autocomplete="organization">
            </div>
          </div>
          <div class="form__row">
            <div class="field">
              <label for="q-phone">Phone</label>
              <input id="q-phone" name="phone" type="tel" autocomplete="tel" inputmode="tel" required>
            </div>
            <div class="field">
              <label for="q-email">Email</label>
              <input id="q-email" name="email" type="email" autocomplete="email" required>
            </div>
          </div>
          <div class="form__row">
            <div class="field">
              <label for="q-type">Type of building</label>
              <select id="q-type" name="building-type" required>
                <option value="" selected disabled>Choose one</option>
                ${types.map((t) => `<option>${esc(t)}</option>`).join('\n                ')}
              </select>
            </div>
            <div class="field">
              <label for="q-suburb">Suburb</label>
              <input id="q-suburb" name="suburb" autocomplete="address-level2" required>
            </div>
          </div>
          <div class="field">
            <label for="q-message">What needs cleaning?</label>
            <textarea id="q-message" name="message" rows="5" required placeholder="Size of the building, how often you’d like it cleaned, and when you’d like to start."></textarea>
          </div>
          <div class="form__foot">
            <button class="button" type="submit">Send request</button>
            <p class="form__status" role="status" aria-live="polite" data-form-status></p>
          </div>
        </form>
      </div>
    </section>`;
}

// ------------------------------------------------------------------ pages

function homePage() {
  const slides = [...regions].sort((a, b) => Number(hasVideo(b.id)) - Number(hasVideo(a.id)));
  const main = `${heroHome(slides)}

    <section class="section statement" aria-label="About us">
      <div class="wrap">
        <p class="statement__text">Cleaning in Brisbane since <em>${B.founded}</em>, one family the whole way. Today that means <em>${B.schools} private schools</em>, small and medium commercial buildings, and new builds cleaned and ready for <em>handover</em>.</p>
      </div>
    </section>

    <section class="section section--tight" id="services" aria-labelledby="services-title">
      <div class="wrap">
        ${sectionHead({ eyebrow: 'What we clean', title: 'Schools, new builds and the buildings in&nbsp;between.', id: 'services-title' })}
        ${specialties()}
      </div>
    </section>

${washroomFeature()}

    <section class="section" id="areas" aria-labelledby="areas-title">
      <div class="wrap">
        ${sectionHead({ eyebrow: 'Where we work', title: 'Based in Moorooka. Working across&nbsp;Brisbane.', id: 'areas-title', intro: 'We cover the Brisbane metropolitan area. Each of these six areas has its own page with the suburbs and services we cover there. If your building is somewhere else in Brisbane, ask anyway.' })}
        ${regionsBlock()}
      </div>
    </section>

    <section class="section section--mist" aria-labelledby="process-title">
      <div class="wrap">
        ${sectionHead({ eyebrow: 'How a contract starts', title: 'Three steps, starting with a walk&nbsp;through.', id: 'process-title' })}
        ${processSteps()}
      </div>
    </section>

    <section class="section family" aria-labelledby="family-title">
      <div class="wrap family__grid">
        <div>
          <p class="eyebrow">Since ${B.founded}</p>
          <h2 class="section__title" id="family-title">One family, in one form or another, since&nbsp;${B.founded}.</h2>
        </div>
        <div class="family__copy">
          <p>Corporate Cleaning Solutions is a family business. It has been around in one form or another since ${B.founded}, and it is still family-run today, from our base on ${esc(B.address.street)} in ${esc(B.address.locality)}.</p>
          <p>We keep to three things we know well. Private schools. Builders’ cleans for handover. Small and medium commercial buildings, including body corporate common areas. Everything else we do, from vinyl strip-and-seal to pressure cleaning, supports those three.</p>
          <p class="family__sign">Talk to Justin: <a href="${B.phone.href}">${B.phone.display}</a></p>
        </div>
      </div>
    </section>

${quote({ source: '/' })}`;

  return page({
    path: '/',
    title: 'Corporate Cleaning Solutions | School & Commercial Cleaners, Brisbane',
    description: 'Family-run Brisbane cleaning contractor since 1978. Private school cleaning, builders’ handover cleans and commercial and body corporate cleaning, based in Moorooka.',
    jsonld: [businessLd(), { '@type': 'WebSite', name: B.name, url: `${B.url}/` }],
    main,
    bodyClass: 'has-media-hero',
  });
}

function schoolsPage() {
  const path = svcById.schools.href;
  const trail = [['Home', '/'], ['Private school cleaning', path]];
  const zones = [
    ['Classrooms & learning spaces', 'Floors, desks, sills, whiteboards and bins, cleaned after the last bell.'],
    ['Toilet blocks & change rooms', 'Daily washroom cleaning with biological agents to deal with the cause of odours.'],
    ['Staff rooms & administration', 'Kitchens, offices, reception and meeting rooms, kept presentable for staff and visiting parents.'],
    ['Halls, gyms & corridors', 'High-traffic floors scrubbed during term, then stripped and resealed during the holidays.'],
    ['Glass & entries', 'Entry doors, partitions and windows, so the front of the school looks right at pick-up.'],
    ['Outdoor areas', 'Pressure cleaning for walkways, courts, covered areas and entries.'],
  ];
  const main = `${heroType({
    eyebrow: 'Private school cleaning · Brisbane',
    title: 'School cleaning that works around the school&nbsp;year.',
    lede: `We clean ${B.schools} private schools across Brisbane. Daily cleaning keeps term running. The holidays are when floors get stripped and sealed, carpets steam cleaned and tiles scrubbed.`,
    trail,
  })}

    <section class="section" aria-labelledby="year-title">
      <div class="wrap">
        ${sectionHead({ eyebrow: 'The school year', title: 'Daily work during term. Deep work in the&nbsp;holidays.', id: 'year-title', intro: 'The heavy floor work needs empty buildings, so we plan it into the breaks. Private schools set their own term dates, so we work from your calendar.' })}
        <ol class="year" role="list">
          ${schoolYear.map((t) => `<li class="year__seg year__seg--${t.kind}">
            <span class="year__label">${esc(t.label)}</span>
            <span class="year__when">${esc(t.when)}</span>
            <span class="year__what">${t.kind === 'term' ? 'Daily clean: classrooms, washrooms, staff areas, halls' : t.label === 'Summer break' ? 'The big one: whole-campus floor program, carpets and high glass' : 'Vinyl strip &amp; seal, carpet steam clean, tile scrub'}</span>
          </li>`).join('\n          ')}
        </ol>
      </div>
    </section>

    <section class="section section--mist" aria-labelledby="zones-title">
      <div class="wrap">
        ${sectionHead({ eyebrow: 'Across the campus', title: 'Every part of the school, not just the&nbsp;classrooms.', id: 'zones-title' })}
        <ul class="zones" role="list">
          ${zones.map(([t, d]) => `<li class="zone"><h3 class="zone__title">${esc(t)}</h3><p>${esc(d)}</p></li>`).join('\n          ')}
        </ul>
      </div>
    </section>

${washroomFeature({ id: 'washrooms-title' })}

    <section class="section" aria-labelledby="areas-title">
      <div class="wrap">
        ${sectionHead({ eyebrow: 'Where we work', title: 'Schools across Brisbane’s inner&nbsp;ring.', id: 'areas-title', intro: 'From Toowong to Coorparoo and Clayfield to Annerley. Pick your area to see the suburbs we cover.' })}
        ${regionsBlock({ compact: true })}
      </div>
    </section>

${quote({ source: path, title: 'Tell us about your school.', intro: 'Send us the details and we’ll call to arrange a walk through the campus. We can start at the beginning of a term or plan a holiday floor program first.' })}`;

  return page({
    path,
    title: 'Private School Cleaning in Brisbane | Corporate Cleaning Solutions',
    description: `Daily school cleaning during term and holiday floor programs (vinyl strip and seal, carpet steam cleaning, tile scrubbing) for Brisbane private schools. Family-run since ${B.founded}.`,
    jsonld: [serviceLd({ name: 'Private school cleaning', path, description: 'Daily cleaning during term and holiday floor programs for Brisbane private schools.' }), crumbsLd(trail)],
    main,
  });
}

function buildersPage() {
  const path = svcById.builders.href;
  const trail = [['Home', '/'], ['Builders’ cleans', path]];
  const covers = [
    ['Floors', 'Cement dust, grout haze, paint and plaster spots lifted, then each floor finished to suit its surface.'],
    ['Glass & frames', 'Labels, stickers and overspray removed. Frames, tracks and sills vacuumed and wiped.'],
    ['Joinery & fixtures', 'Cupboards inside and out, benchtops, tapware, light switches and fittings.'],
    ['Bathrooms & kitchens', 'Tiles, grout, screens, basins and appliances, detailed for inspection.'],
    ['Outside', 'Pressure cleaning for paths, driveways, entries and car parks.'],
    ['Rubbish', 'Site rubbish and packaging cleared so the building is empty and ready.'],
  ];
  const main = `${heroType({
    eyebrow: 'Builders’ cleans · Brisbane',
    title: 'From site dust to handover, in three&nbsp;stages.',
    lede: 'Builders’ cleans are one of our three specialties. We clear the cement dust, paint marks and rubbish the trades leave behind, and get the building ready to hand over.',
    trail,
    motif: 'grid',
  })}

    <section class="section" aria-labelledby="stages-title">
      <div class="wrap">
        ${sectionHead({ eyebrow: 'The three stages', title: 'Tell us the handover date. We’ll plan back from&nbsp;it.', id: 'stages-title' })}
        <ol class="stages" role="list">
          ${stages.map((s, i) => `<li class="stage">
            <span class="stage__num" aria-hidden="true">${i + 1}</span>
            <p class="stage__when">${esc(s.when)}</p>
            <h3 class="stage__title">${esc(s.name)}</h3>
            <p>${esc(s.text)}</p>
          </li>`).join('\n          ')}
        </ol>
      </div>
    </section>

    <section class="section section--mist" aria-labelledby="covers-title">
      <div class="wrap">
        ${sectionHead({ eyebrow: 'What’s covered', title: 'Everything the handover inspection will&nbsp;look&nbsp;at.', id: 'covers-title' })}
        <ul class="zones" role="list">
          ${covers.map(([t, d]) => `<li class="zone"><h3 class="zone__title">${esc(t)}</h3><p>${esc(d)}</p></li>`).join('\n          ')}
        </ul>
      </div>
    </section>

    <section class="section section--ink split" aria-labelledby="schoolbuild-title">
      <div class="wrap split__grid">
        <div>
          <p class="eyebrow eyebrow--light">New school buildings</p>
          <h2 class="section__title" id="schoolbuild-title">Building at a school? We already clean&nbsp;schools.</h2>
        </div>
        <div class="split__copy">
          <p>When a new block goes up on a working campus, the builders’ clean is only half the job. We clean schools every day, so we know what a classroom, a toilet block or a staff room needs to be ready for students on day one.</p>
          <p>We introduced ourselves to Brisbane’s building industry as a platinum sponsor at an industry event in Newstead, and builders’ cleans have been one of our three specialties ever since.</p>
        </div>
      </div>
    </section>

${quote({ source: path, title: 'When’s your handover?', intro: 'Tell us about the project and the handover date, and we’ll arrange a site walk and a staged price.' })}`;

  return page({
    path,
    title: 'Builders’ Cleans & Handover Cleaning, Brisbane | Corporate Cleaning Solutions',
    description: 'Rough, final and touch-up builders’ cleans in Brisbane. Cement dust, paint marks and rubbish removed, glass and fittings detailed, buildings ready for handover.',
    jsonld: [serviceLd({ name: 'Builders’ cleans', path, description: 'Staged builders’ cleans (rough, final and touch-up) for handover across Brisbane.' }), crumbsLd(trail)],
    main,
  });
}

function commercialPage() {
  const path = svcById.commercial.href;
  const trail = [['Home', '/'], ['Commercial cleaning', path]];
  const main = `${heroType({
    eyebrow: 'Commercial & body corporate · Brisbane',
    title: 'Commercial cleaning for Brisbane’s small and medium&nbsp;buildings.',
    lede: 'Regular contract cleaning for offices, commercial premises and body corporate common areas. The specialist floor and glass work is done by the same team.',
    trail,
    motif: 'glass',
  })}

    <section class="section" aria-labelledby="contract-title">
      <div class="wrap">
        ${sectionHead({ eyebrow: 'Contract cleaning', title: 'Two kinds of building, one regular&nbsp;schedule.', id: 'contract-title' })}
        <div class="pair">
          <article class="pair__card">
            <h3 class="pair__title">Commercial buildings</h3>
            <p>Offices and commercial premises big enough to need a proper cleaning contract, and small enough that you want to know who is doing the cleaning.</p>
            <ul class="ticks ticks--dark" role="list">
              <li>${icon.check}Offices, reception and meeting rooms</li>
              <li>${icon.check}Kitchens and staff areas</li>
              <li>${icon.check}Washrooms with biological odour control</li>
              <li>${icon.check}Floors, glass and bins</li>
            </ul>
          </article>
          <article class="pair__card">
            <h3 class="pair__title">Body corporate common areas</h3>
            <p>The parts of an apartment or strata building every owner walks through, cleaned on a schedule the committee can see.</p>
            <ul class="ticks ticks--dark" role="list">
              <li>${icon.check}Foyers, lifts and stairwells</li>
              <li>${icon.check}Corridors and carpets</li>
              <li>${icon.check}Car parks and bin areas</li>
              <li>${icon.check}Entry glass and outdoor paths</li>
            </ul>
          </article>
        </div>
      </div>
    </section>

    <section class="section section--mist" aria-labelledby="specialist-title">
      <div class="wrap">
        ${sectionHead({ eyebrow: 'Specialist services', title: 'The work between the regular&nbsp;cleans.', id: 'specialist-title', intro: 'Booked as a one-off, or scheduled into a contract a few times a year.' })}
        <ul class="zones" role="list">
          ${specialist.map((s) => `<li class="zone"><h3 class="zone__title">${esc(s.name)}</h3><p>${esc(s.text)}</p></li>`).join('\n          ')}
        </ul>
      </div>
    </section>

${washroomFeature({ id: 'washrooms-title', compact: true })}

    <section class="section" aria-labelledby="areas-title">
      <div class="wrap">
        ${sectionHead({ eyebrow: 'Where we work', title: 'Commercial cleaning across&nbsp;Brisbane.', id: 'areas-title' })}
        ${regionsBlock({ compact: true })}
      </div>
    </section>

${quote({ source: path })}`;

  return page({
    path,
    title: 'Commercial & Body Corporate Cleaning, Brisbane | Corporate Cleaning Solutions',
    description: 'Contract cleaning for small and medium commercial buildings and body corporate common areas across Brisbane, plus glass, tile, carpet steam, vinyl strip and seal and pressure cleaning.',
    jsonld: [serviceLd({ name: 'Commercial and body corporate cleaning', path, description: 'Contract cleaning for small and medium commercial buildings and body corporate common areas in Brisbane.' }), crumbsLd(trail)],
    main,
  });
}

function areasPage() {
  const path = '/areas/';
  const trail = [['Home', '/'], ['Areas', path]];
  const main = `${heroType({
    eyebrow: 'Service areas · Brisbane',
    title: 'Six areas, one base in&nbsp;Moorooka.',
    lede: 'We cover the Brisbane metropolitan area. These six areas each have their own page with the suburbs we cover, the buildings we clean there and how far they are from our base.',
    trail,
    motif: 'map',
  })}

    <section class="section" aria-label="Areas we cover">
      <div class="wrap">
        ${regionsBlock({ headingLevel: 2 })}
      </div>
    </section>

    <section class="section section--mist" aria-labelledby="else-title">
      <div class="wrap narrow">
        <h2 class="section__title" id="else-title">Somewhere else in&nbsp;Brisbane?</h2>
        <p class="section__intro">These areas aren’t a hard boundary. If your building is elsewhere in the Brisbane metro area, send us the suburb and what needs cleaning and we’ll tell you straight away whether we can help.</p>
      </div>
    </section>

${quote({ source: path })}`;

  return page({
    path,
    title: 'Service Areas Across Brisbane | Corporate Cleaning Solutions',
    description: 'School, builders’ and commercial cleaning across six Brisbane areas: CBD & Valley, Southside, South Brisbane & Gabba, Western Suburbs, Northside and Eastside.',
    jsonld: [crumbsLd(trail)],
    main,
  });
}

function areaPage(r) {
  const path = `/areas/${r.id}/`;
  const trail = [['Home', '/'], ['Areas', '/areas/'], [r.name, path]];
  const km = kmFor(r.id);
  const f = facts[r.id] || {};
  const factItems = [
    r.id === 'southside'
      ? ['Home base', `Our office is on ${B.address.street}, ${B.address.locality}`]
      : km != null ? [`${Number(km).toFixed(1)} km`, 'from our Moorooka base, as the crow flies'] : null,
    [`${r.suburbs.length} suburbs`, r.suburbs.join(', ')],
    f.riverFrontageKm >= 3 ? [`${Number(f.riverFrontageKm).toFixed(1)} km`, 'of Brisbane River frontage'] : f.areaKm2 ? [`${Number(f.areaKm2).toFixed(1)} km²`, 'across the area'] : null,
  ].filter(Boolean);

  const main = `${heroArea(r)}

    <section class="section section--tight facts" aria-label="${esc(r.name)} at a glance">
      <div class="wrap">
        <dl class="facts__list">
          ${factItems.map(([big, small]) => `<div class="facts__item"><dt>${esc(big)}</dt><dd>${esc(small)}</dd></div>`).join('\n          ')}
        </dl>
      </div>
    </section>

    <section class="section" aria-labelledby="local-title">
      <div class="wrap local">
        <div class="local__copy">
          <p class="eyebrow">${esc(r.long)}</p>
          <h2 class="section__title" id="local-title">Cleaning ${esc(r.where)}</h2>
          ${r.copy.map((p) => `<p>${esc(p)}</p>`).join('\n          ')}
          <ul class="chips chips--suburbs" role="list" aria-label="Suburbs covered">
            ${r.suburbs.map((s) => `<li>${esc(s)}</li>`).join('')}
          </ul>
        </div>
        <div class="local__map regions__map regions__map--mini" data-regions-map data-highlight="${r.id}"></div>
      </div>
    </section>

    <section class="section section--mist" aria-labelledby="services-title">
      <div class="wrap">
        ${sectionHead({ eyebrow: 'What we do here', title: `Our three specialties ${esc(r.where)}`, id: 'services-title' })}
        <ul class="area-services" role="list">
          ${r.order.map((id) => `<li class="area-service">
            <h3 class="area-service__title"><a href="${svcById[id].href}">${esc(svcById[id].name)}</a></h3>
            <p>${esc(r.focus[id])}</p>
          </li>`).join('\n          ')}
        </ul>
        <p class="area-services__more">Also available here: ${specialist.map((s) => esc(s.name.toLowerCase())).join(', ')}. <a href="/commercial-cleaning/">See specialist services</a></p>
      </div>
    </section>

    <section class="section section--tight" aria-labelledby="near-title">
      <div class="wrap">
        <h2 class="near__title" id="near-title">Nearby areas</h2>
        <ul class="near" role="list">
          ${r.near.map((id) => `<li><a class="near__link" href="/areas/${id}/"><span>${esc(regionById[id].name)}</span><span class="near__suburbs">${esc(regionById[id].suburbs.join(' · '))}</span>${icon.arrow}</a></li>`).join('\n          ')}
        </ul>
      </div>
    </section>

${quote({ source: path, title: `Tell us about your building ${esc(r.where)}.` })}`;

  return page({
    path,
    title: `${r.title} | Corporate Cleaning Solutions`,
    description: r.description,
    jsonld: [
      serviceLd({
        name: `Commercial, school and builders’ cleaning in ${r.name}, Brisbane`,
        path,
        description: r.description,
        areaServed: r.suburbs.map((s) => ({ '@type': 'Place', name: `${s}, QLD` })),
      }),
      crumbsLd(trail),
    ],
    main,
    bodyClass: 'has-media-hero',
  });
}

function contactPage() {
  const path = '/contact/';
  const trail = [['Home', '/'], ['Contact', path]];
  const main = `${heroType({
    eyebrow: 'Contact',
    title: 'Book a site walk, or just ask a&nbsp;question.',
    lede: `Call <a href="${B.phone.href}">${B.phone.display}</a>, email <a href="mailto:${B.email}">${B.email.replace('@', '<wbr>@')}</a>, or use the form below. We’re based at ${esc(addressLine)}.`,
    trail,
    motif: 'glass',
  })}

${quote({ source: path, title: 'Tell us about the building.' })}

    <section class="section section--mist" aria-labelledby="areas-title">
      <div class="wrap">
        ${sectionHead({ eyebrow: 'Where we work', title: 'Six areas across&nbsp;Brisbane.', id: 'areas-title' })}
        ${regionsBlock({ compact: true })}
      </div>
    </section>`;

  return page({
    path,
    title: 'Contact & Book a Site Walk | Corporate Cleaning Solutions, Moorooka',
    description: `Book a site walk or ask a question. Call ${B.phone.display} or email us. Corporate Cleaning Solutions, ${addressLine}.`,
    jsonld: [businessLd(), crumbsLd(trail)],
    main,
  });
}

function thankYouPage() {
  const main = `    <section class="hero hero--type hero--tiles hero--short" aria-labelledby="hero-title">
      <div class="hero__motif" aria-hidden="true"></div>
      <div class="wrap hero__content">
        <p class="eyebrow eyebrow--light">Request sent</p>
        <h1 class="hero__title hero__title--type" id="hero-title">Thanks. We’ll call you to book the site&nbsp;walk.</h1>
        <p class="hero__lede">If it’s urgent, call <a href="${B.phone.href}">${B.phone.display}</a>.</p>
        <div class="hero__actions"><a class="button button--bloom" href="/">Back to the home page</a></div>
      </div>
    </section>`;
  return page({
    path: '/thank-you/',
    title: 'Request sent | Corporate Cleaning Solutions',
    description: 'Your site walk request has been sent to Corporate Cleaning Solutions.',
    main,
  }).replace(/href="#quote"/g, 'href="/contact/#quote"');
  // Deliberately no `noindex`: it costs the page its Lighthouse SEO score, and an unlinked page that's
  // missing from the sitemap is a non-issue in search. It's the no-JS fallback for the form anyway.
}

function notFoundPage() {
  const main = `    <section class="hero hero--type hero--tiles hero--short" aria-labelledby="hero-title">
      <div class="hero__motif" aria-hidden="true"></div>
      <div class="wrap hero__content">
        <p class="eyebrow eyebrow--light">Page not found</p>
        <h1 class="hero__title hero__title--type" id="hero-title">This page has been cleaned&nbsp;away.</h1>
        <p class="hero__lede">The address may be old or mistyped. Try the home page, or call <a href="${B.phone.href}">${B.phone.display}</a>.</p>
        <div class="hero__actions"><a class="button button--bloom" href="/">Go to the home page</a><a class="button button--ghost" href="/areas/">See our areas</a></div>
      </div>
    </section>`;
  return page({
    path: '/404.html',
    title: 'Page not found | Corporate Cleaning Solutions',
    description: 'The page you were looking for could not be found.',
    main,
  }).replace(/href="#quote"/g, 'href="/contact/#quote"');
}

// ------------------------------------------------------------------ regions SVG (injected inline by site.js)

function regionsSvg() {
  if (!mapData) return null;
  const regionMeta = Object.fromEntries(regions.map((r) => [r.id, r]));
  // Two-line labels where a region name is long; labels sit above every shape so none get covered.
  const lines = { 'south-brisbane': ['South Brisbane', '& Gabba'], 'western-suburbs': ['Western', 'Suburbs'] };
  const shapes = mapData.regions.map((g) => `<path class="rm-region rm-region__shape" data-region="${g.id}" data-href="/areas/${g.id}/" d="${g.d}"/>`).join('');
  const labels = mapData.regions.map((g) => {
    const text = lines[g.id] || [regionMeta[g.id]?.name || g.name];
    const [x, y] = g.label;
    const y0 = y - ((text.length - 1) * 21) / 2;
    return `<text class="rm-label" data-region="${g.id}" x="${x}" y="${y0.toFixed(1)}" text-anchor="middle">${text.map((t, i) => `<tspan x="${x}"${i ? ' dy="21"' : ''}>${esc(t)}</tspan>`).join('')}</text>`;
  }).join('');
  const b = mapData.base;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${mapData.viewBox}" class="rm" aria-hidden="true" focusable="false">`
    + `<path class="rm-water" d="${mapData.water}"/>`
    + (mapData.roads ? `<path class="rm-roads" d="${mapData.roads}"/>` : '')
    + `<g class="rm-regions">${shapes}</g><g class="rm-labels">${labels}</g>`
    + (b ? `<g class="rm-base"><circle class="rm-base__halo" cx="${b.x}" cy="${b.y}" r="16"/><circle class="rm-base__dot" cx="${b.x}" cy="${b.y}" r="5.5"/><text class="rm-base__label" x="${b.x + 14}" y="${b.y + 26}">Our base</text></g>` : '')
    + '</svg>';
}

// ------------------------------------------------------------------ write everything

const pages = [
  ['index.html', homePage()],
  ['private-school-cleaning/index.html', schoolsPage()],
  ['builders-cleans/index.html', buildersPage()],
  ['commercial-cleaning/index.html', commercialPage()],
  ['areas/index.html', areasPage()],
  ...regions.map((r) => [`areas/${r.id}/index.html`, areaPage(r)]),
  ['contact/index.html', contactPage()],
  ['thank-you/index.html', thankYouPage()],
  ['404.html', notFoundPage()],
];
pages.forEach(([file, html]) => write(file, html));

const svg = regionsSvg();
if (svg) write('assets/img/brisbane-regions.svg', svg);
else console.warn('! data/regions-map.json missing: regions map not written');

const indexable = ['/', svcById.schools.href, svcById.builders.href, svcById.commercial.href, '/areas/', ...regions.map((r) => `/areas/${r.id}/`), '/contact/'];
write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${indexable.map((p) => `  <url><loc>${abs(p)}</loc><lastmod>${TODAY}</lastmod></url>`).join('\n')}
</urlset>
`);
write('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${abs('/sitemap.xml')}\n`);

console.log(`Wrote ${pages.length} pages${svg ? ' + regions SVG' : ''}, sitemap.xml, robots.txt`);
console.log(`Footage: ${Object.keys(footage).length ? Object.keys(footage).join(', ') : 'none yet (map stills everywhere)'}`);
