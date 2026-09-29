#!/usr/bin/env node
// Renders the service-area flyovers with headless Chromium (WebGL via SwiftShader)
// and encodes the web deliverables.
//
//   node render.mjs --preview [--areas=a,b] [--orient=landscape]   stills at t=0, .5, 1
//   node render.mjs [--areas=a,b] [--orient=landscape,portrait]    full render + encode
//   node render.mjs --encode-only [--areas=a,b]                    re-encode from masters
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(ROOT, '../../site');
const OUT_VIDEO = path.join(SITE, 'assets/video');
const OUT_POSTER = path.join(SITE, 'assets/img/flyover');
const MASTERS = path.join(ROOT, '.cache/masters');
const PREVIEWS = path.join(ROOT, '.cache/preview');

const argv = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'areas.json'), 'utf8'));
const areaIds = argv.areas ? String(argv.areas).split(',') : config.areas.map((a) => a.id);
const FPS = +argv.fps || 30;
const SECONDS = +argv.seconds || 7;
const ORIENTS = {
  landscape: { w: 1920, h: 1080, fov: 34, params: '' },
  portrait: { w: 720, h: 1280, fov: 56, params: '&pitchOffset=5' },
};
const orients = argv.orient ? String(argv.orient).split(',') : Object.keys(ORIENTS);
const FFMPEG = process.env.FFMPEG
  || execFileSync('python3', ['-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())']).toString().trim();
const extra = ['fog', 'tilt', 'exposure', 'shadow', 'tex']
  .filter((k) => argv[k]).map((k) => `&${k}=${argv[k]}`).join('');

function ffmpeg(args, { input } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: [input ? 'pipe' : 'ignore', 'inherit', 'inherit'] });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
    if (input) input(p.stdin);
  });
}

async function withServer(fn) {
  const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' };
  const server = http.createServer((req, res) => {
    const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end(); return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try { return await fn(`http://127.0.0.1:${server.address().port}`); } finally { server.close(); }
}

async function openScene(browser, base, id, o) {
  const page = await browser.newPage({ viewport: { width: 320, height: 240 } });
  page.on('console', (m) => { if (m.text().startsWith('[scene]')) console.log(`  ${m.text()}`); });
  page.on('pageerror', (e) => console.error('  [pageerror]', e.message));
  await page.goto(`${base}/scene.html?area=${id}&w=${o.w}&h=${o.h}&fov=${o.fov}${o.params}${extra}`);
  await page.waitForFunction(() => window.sceneReady || window.sceneError, null, { timeout: 0, polling: 500 });
  const err = await page.evaluate(() => window.sceneError);
  if (err) throw new Error(err);
  return page;
}

const png = (dataUrl) => Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');

async function render(browser, base) {
  fs.mkdirSync(MASTERS, { recursive: true });
  fs.mkdirSync(PREVIEWS, { recursive: true });
  for (const id of areaIds) {
    for (const name of orients) {
      const o = ORIENTS[name];
      console.log(`== ${id} ${name} ${o.w}x${o.h}`);
      const page = await openScene(browser, base, id, o);
      if (argv.preview) {
        for (const t of [0, 0.5, 1]) {
          const s = Date.now();
          const buf = png(await page.evaluate((tt) => window.renderFrame(tt), t));
          fs.writeFileSync(path.join(PREVIEWS, `${id}-${name}-${t}.png`), buf);
          console.log(`  t=${t} ${(Date.now() - s) / 1000}s`);
        }
      } else {
        const frames = FPS * SECONDS;
        const master = path.join(MASTERS, `${id}-${name}.mp4`);
        const started = Date.now();
        await ffmpeg(['-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '8', '-pix_fmt', 'yuv444p', master], {
          input: async (stdin) => {
            for (let f = 0; f < frames; f++) {
              const buf = png(await page.evaluate((tt) => window.renderFrame(tt), f / (frames - 1)));
              if (!stdin.write(buf)) await new Promise((r) => stdin.once('drain', r));
              if (f % 30 === 0) {
                const per = (Date.now() - started) / (f + 1) / 1000;
                console.log(`  frame ${f}/${frames}  ${per.toFixed(2)}s/frame  eta ${((frames - f) * per / 60).toFixed(1)} min`);
              }
            }
            stdin.end();
          },
        });
        console.log(`  master done in ${((Date.now() - started) / 60000).toFixed(1)} min`);
      }
      await page.close();
    }
    if (!argv.preview) await encode(id);
  }
}

async function encode(id) {
  fs.mkdirSync(OUT_VIDEO, { recursive: true });
  fs.mkdirSync(OUT_POSTER, { recursive: true });
  const land = path.join(MASTERS, `${id}-landscape.mp4`);
  const port = path.join(MASTERS, `${id}-portrait.mp4`);
  const x264 = ['-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an'];
  const vp9 = ['-c:v', 'libvpx-vp9', '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2', '-pix_fmt', 'yuv420p', '-an'];
  if (orients.includes('landscape') && fs.existsSync(land)) {
    console.log(`  encoding ${id} landscape`);
    await ffmpeg(['-i', land, '-vf', 'scale=1920:1080:flags=lanczos', ...x264, '-crf', '24', path.join(OUT_VIDEO, `${id}-1080.mp4`)]);
    await ffmpeg(['-i', land, '-vf', 'scale=1920:1080:flags=lanczos', ...vp9, '-crf', '37', path.join(OUT_VIDEO, `${id}-1080.webm`)]);
    await ffmpeg(['-i', land, '-vf', 'scale=1280:720:flags=lanczos', ...x264, '-crf', '25', path.join(OUT_VIDEO, `${id}-720.mp4`)]);
    await ffmpeg(['-i', land, '-vf', 'scale=1280:720:flags=lanczos', ...vp9, '-crf', '38', path.join(OUT_VIDEO, `${id}-720.webm`)]);
    await ffmpeg(['-i', land, '-frames:v', '1', '-vf', 'scale=1920:1080:flags=lanczos', '-c:v', 'libwebp', '-quality', '72', path.join(OUT_POSTER, `${id}.webp`)]);
    await ffmpeg(['-ss', String(SECONDS / 2), '-i', land, '-frames:v', '1', '-vf', 'scale=889:500:flags=lanczos,crop=800:500', '-c:v', 'libwebp', '-quality', '70', path.join(OUT_POSTER, `${id}-card.webp`)]);
  }
  if (orients.includes('portrait') && fs.existsSync(port)) {
    console.log(`  encoding ${id} portrait`);
    await ffmpeg(['-i', port, ...x264, '-crf', '25', path.join(OUT_VIDEO, `${id}-portrait.mp4`)]);
    await ffmpeg(['-i', port, ...vp9, '-crf', '38', path.join(OUT_VIDEO, `${id}-portrait.webm`)]);
    await ffmpeg(['-i', port, '-frames:v', '1', '-c:v', 'libwebp', '-quality', '72', path.join(OUT_POSTER, `${id}-portrait.webp`)]);
  }
}

if (argv['encode-only']) {
  for (const id of areaIds) await encode(id);
} else {
  const browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle',
      '--js-flags=--max-old-space-size=12000'],
  });
  try { await withServer((base) => render(browser, base)); } finally { await browser.close(); }
}
