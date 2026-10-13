#!/usr/bin/env node
// Rasterises the night-map pages written by build_maps.py with headless Chromium.
//
//   node render.mjs <jobs.json>
//
// jobs.json: [{ "html": "/abs/page.html", "png": "/abs/out.png", "w": 2560, "h": 1440,
//               "layout": "/abs/labels.json" (optional: where to write the label layout) }]
// Each page sets window.__ready = true once its fonts are loaded and labels are placed.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const CONCURRENCY = Number(process.env.RENDER_CONCURRENCY || 3);
const jobs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--force-color-profile=srgb', '--font-render-hinting=none', '--disable-lcd-text'],
});

async function run(job) {
  const t0 = Date.now();
  const page = await browser.newPage({ viewport: { width: job.w, height: job.h }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error(`  [pageerror] ${job.png}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' || m.text().startsWith('[label]')) console.log(`  ${m.text()}`); });
  await page.goto(pathToFileURL(job.html).href, { waitUntil: 'load', timeout: 0 });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000, polling: 100 });
  if (job.layout) fs.writeFileSync(job.layout, JSON.stringify(await page.evaluate(() => window.__layout || null)));
  await page.screenshot({ path: job.png, type: 'png', timeout: 0 });
  await page.close();
  console.log(`  rendered ${job.png.split('/').pop()} ${job.w}x${job.h} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

try {
  const queue = [...jobs];
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) await run(queue.shift());
  }));
} finally {
  await browser.close();
}
