// node shoot.mjs <path> [desktop|mobile] [full|fold] [waitMs] [outName]
// Run from tools/verify after `npm install`, with `npm run serve` running. Writes to ./shots/.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const [path = '/', device = 'desktop', mode = 'fold', wait = '2600', name] = process.argv.slice(2);
const vp = device === 'mobile' ? { width: 412, height: 860, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { width: 1440, height: 900, deviceScaleFactor: 1 };
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.deviceScaleFactor, isMobile: vp.isMobile, hasTouch: vp.hasTouch });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`); });
await page.goto(`http://localhost:8080${path}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(+wait);
if (mode === 'full') {
  // scroll through so lazy content and reveals trigger, then back to top
  const h = await page.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y < h; y += 500) { await page.evaluate((yy) => scrollTo(0, yy), y); await page.waitForTimeout(120); }
  await page.waitForTimeout(900);
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(400);
}
const out = name || `${path.replace(/\W+/g, '_') || 'home'}-${device}-${mode}.png`;
mkdirSync('shots', { recursive: true });
await page.screenshot({ path: `shots/${out}`, fullPage: mode === 'full' });
console.log(`shots/${out}`);
if (errors.length) console.log(errors.join('\n'));
await browser.close();
