// Turns licensed aerial masters into the hero's web files.
//
//   node tools/footage/encode.mjs            # every clip in clips.json
//   node tools/footage/encode.mjs cbd-valley # one area
//
// For each clip in clips.json it:
//   1. downloads the master (curl, so the environment's proxy is honoured) or uses a local file
//   2. cuts `duration` seconds from `start`, and blends the last second into the first so it loops seamlessly
//   3. encodes 2160p (only if the master is 4K), 1080p, 720p and a 720×1280 portrait cut,
//      each as WebM/VP9 and MP4/H.264, no audio
//   4. writes first-frame posters (WebP) at the sizes the page asks for
//   5. records the area in tools/build/data/footage.json, which the site generator reads
// Then run `node tools/build/build.mjs` to put the footage into the pages.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '../..');
const CACHE = join(here, '.cache');
const OUT_VIDEO = join(ROOT, 'site/assets/video');
const OUT_IMG = join(ROOT, 'site/assets/img/footage');
const MANIFEST = join(ROOT, 'tools/build/data/footage.json');
const LOOP_FADE = 1.0; // seconds blended across the loop point

const { clips } = JSON.parse(readFileSync(join(here, 'clips.json'), 'utf8'));
const only = process.argv[2];
[CACHE, OUT_VIDEO, OUT_IMG].forEach((d) => mkdirSync(d, { recursive: true }));

function run(cmd, args) {
  return new Promise((ok, fail) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => (code === 0 ? ok(out) : fail(new Error(`${cmd} exited ${code}\n${err.slice(-2000)}`))));
  });
}

const ffmpeg = (args) => run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
const kb = (f) => `${Math.round(statSync(f).size / 1024)} KB`;

async function master(clip) {
  if (!/^https?:/.test(clip.source)) return resolve(here, clip.source);
  const file = join(CACHE, `${clip.area}-master${clip.source.match(/\.(mp4|mov|webm)(\?|$)/i)?.[0].replace(/\?$/, '') || '.mp4'}`);
  if (!existsSync(file)) {
    console.log(`  downloading ${clip.source}`);
    await run('curl', ['-fL', '--retry', '4', '--retry-delay', '2', '-o', file, clip.source]);
  }
  return file;
}

async function probe(file) {
  const json = JSON.parse(await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate', '-show_entries', 'format=duration', '-of', 'json', file]));
  const s = json.streams[0];
  const [num, den] = s.r_frame_rate.split('/').map(Number);
  return { width: s.width, height: s.height, fps: num / (den || 1), duration: Number(json.format.duration) };
}

async function encodeClip(clip) {
  const id = clip.area;
  const src = await master(clip);
  const info = await probe(src);
  const D = clip.duration || 8;
  const start = clip.start || 0;
  if (start + D + LOOP_FADE > info.duration + 0.01) throw new Error(`${id}: clip is ${info.duration.toFixed(1)} s; start ${start} + ${D} s + ${LOOP_FADE} s fade doesn't fit`);
  const fps = Math.min(30, Math.round(info.fps));
  const uhd = info.width >= 3840 && info.height >= 2160;
  console.log(`${id}: ${info.width}×${info.height} @ ${info.fps.toFixed(2)} fps, using ${start}–${start + D + LOOP_FADE} s${uhd ? ' (4K)' : ''}`);

  // Loop master: lossless-ish intermediate at full resolution, 16:9, `fps`, seamless loop.
  const loop = join(CACHE, `${id}-loop.mkv`);
  const crop169 = 'crop=w=min(iw\\,ih*16/9):h=min(ih\\,iw*9/16)';
  await ffmpeg([
    '-ss', String(start), '-t', String(D + LOOP_FADE), '-i', src,
    '-filter_complex',
    `[0:v]${crop169},fps=${fps},format=yuv420p,split[a][b];`
    + `[a]trim=start=${LOOP_FADE}:end=${D + LOOP_FADE},setpts=PTS-STARTPTS[main];`
    + `[b]trim=start=0:end=${LOOP_FADE},setpts=PTS-STARTPTS[head];`
    + `[main][head]xfade=transition=fade:duration=${LOOP_FADE}:offset=${D - LOOP_FADE}[v]`,
    '-map', '[v]', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '10', loop,
  ]);

  const x264 = ['-c:v', 'libx264', '-preset', 'slow', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an'];
  const vp9 = ['-c:v', 'libvpx-vp9', '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2', '-pix_fmt', 'yuv420p', '-an'];
  const tiers = [
    ...(uhd ? [['2160', 'scale=3840:2160:flags=lanczos', 26, 34]] : []),
    ['1080', 'scale=1920:1080:flags=lanczos', 24, 36],
    ['720', 'scale=1280:720:flags=lanczos', 25, 38],
  ];
  const x = Math.min(1, Math.max(0, clip.portraitX ?? 0.5));
  const portraitVf = `crop=w=ih*9/16:h=ih:x=(iw-ih*9/16)*${x}:y=0,scale=720:1280:flags=lanczos`;

  for (const [name, vf, crfH264, crfVp9] of [...tiers, ['portrait', portraitVf, 25, 38]]) {
    const mp4 = join(OUT_VIDEO, `${id}-${name}.mp4`);
    const webm = join(OUT_VIDEO, `${id}-${name}.webm`);
    await ffmpeg(['-i', loop, '-vf', vf, ...x264, '-crf', String(crfH264), mp4]);
    await ffmpeg(['-i', loop, '-vf', vf, ...vp9, '-crf', String(crfVp9), webm]);
    console.log(`  ${name}: ${kb(mp4)} mp4, ${kb(webm)} webm`);
  }

  // Posters are the first frame, so the switch from poster to video is invisible.
  for (const w of [960, 1440, 1920, 2560]) {
    await ffmpeg(['-i', loop, '-frames:v', '1', '-vf', `scale=${w}:${Math.round((w * 9) / 16)}:flags=lanczos`, '-c:v', 'libwebp', '-quality', w <= 1440 ? '72' : '76', join(OUT_IMG, `${id}-${w}.webp`)]);
  }
  for (const w of [720, 1080]) {
    await ffmpeg(['-i', loop, '-frames:v', '1', '-vf', portraitVf.replace('scale=720:1280', `scale=${w}:${Math.round((w * 16) / 9)}`), '-c:v', 'libwebp', '-quality', '70', join(OUT_IMG, `${id}-portrait-${w}.webp`)]);
  }
  console.log(`  posters: ${id}-1440.webp ${kb(join(OUT_IMG, `${id}-1440.webp`))}, ${id}-portrait-720.webp ${kb(join(OUT_IMG, `${id}-portrait-720.webp`))}`);

  return { uhd, caption: clip.caption, credit: clip.credit };
}

const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {};
for (const clip of clips) {
  if (only && clip.area !== only) continue;
  if (!clip.source) { console.log(`${clip.area}: no source yet, skipped`); continue; }
  manifest[clip.area] = await encodeClip(clip);
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
}
console.log(`\nfootage.json: ${Object.keys(manifest).join(', ') || 'empty'}\nNow run: node tools/build/build.mjs`);
