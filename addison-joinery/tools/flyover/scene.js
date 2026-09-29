// Renders one service area as a CNC-cut timber site model and exposes
// window.renderFrame(t) for the headless frame grabber (render.mjs).
//
// World axes: X east, Y up, Z south. Scene files use local metres (x east, y north).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { HorizontalTiltShiftShader } from 'three/addons/shaders/HorizontalTiltShiftShader.js';
import { VerticalTiltShiftShader } from 'three/addons/shaders/VerticalTiltShiftShader.js';

const q = new URLSearchParams(location.search);
const AREA = q.get('area');
const W = +q.get('w') || 1920;
const H = +q.get('h') || 1080;
const FOV = +q.get('fov') || 34;
const TEX = Math.min(+q.get('tex') || 4096, 4096);

const C = {
  fog: 0x1d1611,
  land: '#c9a170',
  grainDark: 'rgba(92, 58, 28, 0.085)',
  grainLight: 'rgba(255, 236, 205, 0.05)',
  park: '#ad8a55',
  bush: '#8e6e43',
  sand: '#e8d6b2',
  rock: '#b09a80',
  plaza: '#d6b88f',
  rail: '#a3865d',
  // engraved road grooves: major, local, minor, path, rail
  road: ['rgba(100, 66, 34, 0.34)', 'rgba(104, 70, 36, 0.3)', 'rgba(110, 74, 40, 0.2)', 'rgba(120, 82, 44, 0.1)', 'rgba(80, 54, 30, 0.32)'],
  pool: '#0d0c0b',
  ply: ['#dfc8a0', '#bc9d70'],
  building: 0xefdcb9,
  bridge: 0xe6d4b4,
  tree: 0x6a4a2e,
  water: 0x0c0b0a,
};

function status(msg) { console.log(`[scene] ${msg}`); }

// ------------------------------------------------------------------ geometry

function ringArea(flat) {
  let a = 0;
  for (let i = 0, n = flat.length; i < n; i += 2) {
    const j = (i + 2) % n;
    a += flat[i] * flat[j + 1] - flat[j] * flat[i + 1];
  }
  return a / 2;
}

function orient(flat, ccw) {
  const isCcw = ringArea(flat) > 0;
  if (isCcw === ccw) return flat;
  const out = new Array(flat.length);
  for (let i = 0, n = flat.length / 2; i < n; i++) {
    out[2 * i] = flat[2 * (n - 1 - i)];
    out[2 * i + 1] = flat[2 * (n - 1 - i) + 1];
  }
  return out;
}

// Accumulates non-indexed triangles with flat normals.
class Builder {
  constructor({ color = false, uv = false } = {}) {
    this.pos = []; this.nor = []; this.col = color ? [] : null; this.uv = uv ? [] : null;
  }
  tri(a, b, c, ca, cb, cc, ua, ub, uc) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    this.pos.push(...a, ...b, ...c);
    this.nor.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    if (this.col) this.col.push(...ca, ...cb, ...cc);
    if (this.uv) this.uv.push(...ua, ...ub, ...uc);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    if (this.col) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (this.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    return g;
  }
}

// Extrudes a polygon (rings in local x/y-north) between y0 and y1.
// cap: Builder for the top face; walls: Builder for the side faces.
function extrude(rings, y0, y1, cap, walls, opts = {}) {
  const outer = orient(rings[0], true);
  const holes = rings.slice(1).map((r) => orient(r, false));
  const all = [outer, ...holes];
  const { half = 0, extent = 1, wallColor, roofColor, wallUv } = opts;

  if (cap) {
    const contour = [];
    for (let i = 0; i < outer.length; i += 2) contour.push(new THREE.Vector2(outer[i], outer[i + 1]));
    const hs = holes.map((h) => { const p = []; for (let i = 0; i < h.length; i += 2) p.push(new THREE.Vector2(h[i], h[i + 1])); return p; });
    const pts = contour.concat(...hs);
    let faces;
    try { faces = THREE.ShapeUtils.triangulateShape(contour, hs); } catch { faces = []; }
    for (const f of faces) {
      let [a, b, c] = f.map((i) => pts[i]);
      if ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) < 0) [b, c] = [c, b];
      const P = (p) => [p.x, y1, -p.y];
      const U = (p) => [(p.x + half) / extent, (p.y + half) / extent];
      cap.tri(P(a), P(b), P(c), roofColor, roofColor, roofColor, U(a), U(b), U(c));
    }
  }
  if (walls) {
    for (const r of all) {
      let run = 0;
      for (let i = 0, n = r.length; i < n; i += 2) {
        const j = (i + 2) % n;
        const ax = r[i], ay = r[i + 1], bx = r[j], by = r[j + 1];
        const len = Math.hypot(bx - ax, by - ay);
        if (len < 0.05) continue;
        const A = [ax, y0, -ay], B = [bx, y0, -by], Cc = [bx, y1, -by], D = [ax, y1, -ay];
        const c0 = wallColor ? wallColor(y0) : null, c1 = wallColor ? wallColor(y1) : null;
        const uA = wallUv ? [run, y0] : null, uB = wallUv ? [run + len, y0] : null;
        const uC = wallUv ? [run + len, y1] : null, uD = wallUv ? [run, y1] : null;
        walls.tri(A, B, Cc, c0, c0, c1, uA, uB, uC);
        walls.tri(A, Cc, D, c0, c1, c1, uA, uC, uD);
        run += len;
      }
    }
  }
}

// ------------------------------------------------------------------ textures

function mulberry(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function stipplePattern(ctx, base, dots, density, seed) {
  const s = 256, c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, s, s);
  const rnd = mulberry(seed);
  for (let i = 0; i < density; i++) {
    g.fillStyle = dots[i % dots.length];
    const r = 0.6 + rnd() * 1.6;
    g.beginPath(); g.arc(rnd() * s, rnd() * s, r, 0, Math.PI * 2); g.fill();
  }
  return ctx.createPattern(c, 'repeat');
}

function buildGroundTexture(scene) {
  const size = TEX, E = scene.extent, half = E / 2, k = size / E;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const X = (x) => (x + half) * k;
  const Y = (y) => (half - y) * k;

  ctx.fillStyle = C.land; ctx.fillRect(0, 0, size, size);

  // Veneer grain: long, gently wandering strokes running east-west.
  const rnd = mulberry(1234);
  ctx.lineCap = 'round';
  for (let i = 0; i < 1400; i++) {
    const y0 = rnd() * size, amp = 8 + rnd() * 40, f = (0.4 + rnd() * 1.2) / size * Math.PI * 2, ph = rnd() * 6.28;
    ctx.strokeStyle = rnd() < 0.72 ? C.grainDark : C.grainLight;
    ctx.lineWidth = 1 + rnd() * rnd() * 7;
    ctx.beginPath();
    for (let x = -20; x <= size + 20; x += 48) {
      const y = y0 + Math.sin(x * f + ph) * amp + Math.sin(x * f * 3.7 + ph * 2) * amp * 0.18;
      x < 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  const fillPolys = (polys, style) => {
    ctx.fillStyle = style;
    ctx.beginPath();
    for (const rings of polys) {
      for (const r of rings) {
        ctx.moveTo(X(r[0]), Y(r[1]));
        for (let i = 2; i < r.length; i += 2) ctx.lineTo(X(r[i]), Y(r[i + 1]));
        ctx.closePath();
      }
    }
    ctx.fill('evenodd');
  };
  const t = scene.tex;
  fillPolys(t.park, stipplePattern(ctx, C.park, ['rgba(70,45,20,0.35)', 'rgba(250,225,180,0.22)'], 1400, 3));
  fillPolys(t.bush, stipplePattern(ctx, C.bush, ['rgba(50,30,12,0.4)', 'rgba(230,200,150,0.18)'], 2200, 5));
  fillPolys(t.sand, stipplePattern(ctx, C.sand, ['rgba(160,120,70,0.18)'], 700, 7));
  fillPolys(t.rock, C.rock);
  fillPolys(t.plaza, C.plaza);
  fillPolys(t.rail, C.rail);

  // Engraved roads, drawn fine-to-bold so major roads sit on top.
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  for (const style of [3, 2, 1, 4, 0]) {
    ctx.strokeStyle = C.road[style];
    for (const [w, s, pts] of scene.roads) {
      if (s !== style) continue;
      ctx.lineWidth = Math.max(1, w * k);
      if (s === 4) ctx.setLineDash([w * k * 1.6, w * k * 1.1]); else ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(X(pts[0]), Y(pts[1]));
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(X(pts[i]), Y(pts[i + 1]));
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);
  fillPolys(t.pool, C.pool);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

function plyTexture() {
  const c = document.createElement('canvas');
  c.width = 8; c.height = 128;
  const g = c.getContext('2d');
  const plies = 5, h = 128 / plies;
  for (let i = 0; i < plies; i++) {
    g.fillStyle = C.ply[i % 2]; g.fillRect(0, i * h, 8, h);
    g.fillStyle = 'rgba(80,50,25,0.35)'; g.fillRect(0, i * h, 8, 1.5);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function skyEnvironment(sunDir) {
  // Warm studio sky, used only for reflections on the resin water. Sampled
  // directly (no PMREM): PMREM under SwiftShader produced speckled garbage.
  const w = 1024, h = 512;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#231c17');
  grad.addColorStop(0.40, '#4a3a2e');
  grad.addColorStop(0.49, '#b8844f');
  grad.addColorStop(0.55, '#34261b');
  grad.addColorStop(1, '#0d0a08');
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  const az = Math.atan2(sunDir.x, -sunDir.z);
  const u = ((az / (Math.PI * 2)) + 0.75) % 1;
  for (const du of [-1, 0, 1]) {
    const glow = g.createRadialGradient((u + du) * w, h * 0.46, 4, (u + du) * w, h * 0.46, 170);
    glow.addColorStop(0, 'rgba(255,214,160,0.9)');
    glow.addColorStop(1, 'rgba(255,170,100,0)');
    g.fillStyle = glow; g.fillRect(0, 0, w, h);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ------------------------------------------------------------------ scene

const TILE = 700; // metres; geometry is chunked so off-screen tiles are culled

function tileKey(x, y) { return `${Math.floor(x / TILE)},${Math.floor(y / TILE)}`; }

async function main() {
  const t0 = performance.now();
  const data = await (await fetch(`./.cache/scenes/${AREA}.json`)).json();
  status(`loaded ${AREA} in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
  const E = data.extent, half = E / 2, L = data.layer, WY = data.waterY;

  const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false; // sun and model are static: render the shadow map once
  renderer.shadowMap.needsUpdate = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = +q.get('exposure') || 1.14;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(C.fog);
  scene.fog = new THREE.FogExp2(C.fog, +q.get('fog') || 0.00034);

  const sunAz = THREE.MathUtils.degToRad(data.sun?.[0] ?? 290);
  const sunEl = THREE.MathUtils.degToRad(data.sun?.[1] ?? 22);
  const sunDir = new THREE.Vector3(Math.sin(sunAz) * Math.cos(sunEl), Math.sin(sunEl), -Math.cos(sunAz) * Math.cos(sunEl));
  // Image-based lighting is by far the most expensive thing under SwiftShader,
  // so only the water gets reflections; everything else is sun + sky fill.
  const env = skyEnvironment(sunDir);

  // -- ground: stacked contour layers
  const groundTex = buildGroundTexture(data);
  const plyTex = plyTexture();
  const top = new Builder({ uv: true });
  const side = new Builder({ uv: true });
  for (const layer of data.layers) {
    const y0 = layer.k === 0 ? WY - 3 : (layer.k - 1) * L;
    const y1 = layer.k * L;
    for (const rings of layer.polys) extrude(rings, y0, y1, top, side, { half, extent: E, wallUv: true });
  }
  const topMat = new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.8, metalness: 0 });
  plyTex.repeat.set(1 / 40, 1 / L);
  const sideMat = new THREE.MeshStandardMaterial({ map: plyTex, roughness: 0.85, metalness: 0 });
  const topMesh = new THREE.Mesh(top.geometry(), topMat);
  const sideMesh = new THREE.Mesh(side.geometry(), sideMat);
  for (const m of [topMesh, sideMesh]) { m.receiveShadow = true; m.castShadow = true; scene.add(m); }
  status(`terrain: ${top.pos.length / 9 | 0} + ${side.pos.length / 9 | 0} tris`);

  // -- buildings: maple blocks, each with a slightly different piece of timber
  const bldTiles = new Map();
  let bldTris = 0;
  for (const b of data.buildings) {
    const [z0, z1, ...rings] = b;
    const key = tileKey(rings[0][0], rings[0][1]);
    if (!bldTiles.has(key)) bldTiles.set(key, new Builder({ color: true }));
    const baseY = Math.max(z0, WY);
    const tint = 0.9 + 0.12 * ((Math.sin(rings[0][0] * 12.9898 + rings[0][1] * 78.233) * 43758.5453) % 1 + 1) % 1;
    const roof = [tint * 1.03, tint * 1.02, tint];
    const ao = (y) => {
      const f = Math.min(1, Math.max(0, (y - baseY - 0.5) / 9));
      const v = tint * (0.56 + 0.44 * f * f * (3 - 2 * f));
      return [v, v, v * 0.98];
    };
    extrude(rings, z0, z1, bldTiles.get(key), bldTiles.get(key), { wallColor: ao, roofColor: roof });
  }
  const bldMat = new THREE.MeshStandardMaterial({ color: C.building, vertexColors: true, roughness: 0.82, metalness: 0 });
  for (const b of bldTiles.values()) {
    const mesh = new THREE.Mesh(b.geometry(), bldMat);
    mesh.castShadow = mesh.receiveShadow = true;
    bldTris += b.pos.length / 9;
    scene.add(mesh);
  }
  status(`buildings: ${data.buildings.length} (${bldTris | 0} tris in ${bldTiles.size} tiles)`);

  // -- bridges (decks over water)
  const deckParts = [];
  for (const [w, deckY, pts] of data.bridges) {
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const ax = pts[i], ay = pts[i + 1], bx = pts[i + 2], by = pts[i + 3];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 0.5) continue;
      const g = new THREE.BoxGeometry(len + w * 0.5, 2.2, w);
      g.rotateY(Math.atan2(by - ay, bx - ax));
      g.translate((ax + bx) / 2, deckY - 1.1, -(ay + by) / 2);
      deckParts.push(g.toNonIndexed());
    }
  }
  if (deckParts.length) {
    const deck = new THREE.Mesh(mergeGeometries(deckParts), new THREE.MeshStandardMaterial({ color: C.bridge, roughness: 0.8 }));
    deck.castShadow = deck.receiveShadow = true;
    scene.add(deck);
  }

  // -- trees: turned timber beads, chunked for culling
  const tr = data.trees, nTrees = tr.length / 4;
  const treeGeo = new THREE.IcosahedronGeometry(1, 0);
  const treeMat = new THREE.MeshStandardMaterial({ color: C.tree, roughness: 0.7, metalness: 0, flatShading: false });
  const byTile = new Map();
  for (let i = 0; i < nTrees; i++) {
    const key = tileKey(tr[4 * i], tr[4 * i + 1]);
    if (!byTile.has(key)) byTile.set(key, []);
    byTile.get(key).push(i);
  }
  const m4 = new THREE.Matrix4(), s = new THREE.Vector3(), p = new THREE.Vector3(), rot = new THREE.Quaternion();
  const col = new THREE.Color();
  const rnd = mulberry(99);
  for (const ids of byTile.values()) {
    const inst = new THREE.InstancedMesh(treeGeo, treeMat, ids.length);
    ids.forEach((i, j) => {
      const x = tr[4 * i], y = tr[4 * i + 1], base = tr[4 * i + 2], r = tr[4 * i + 3];
      p.set(x, base + r * 0.9, -y); s.set(r, r * 0.92, r);
      rot.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI);
      m4.compose(p, rot, s);
      inst.setMatrixAt(j, m4);
      const v = 0.8 + rnd() * 0.35;
      inst.setColorAt(j, col.setRGB(v, v * (0.95 + rnd() * 0.07), v * 0.94));
    });
    inst.computeBoundingSphere();
    inst.castShadow = inst.receiveShadow = true;
    scene.add(inst);
  }
  status(`trees: ${nTrees} in ${byTile.size} tiles`);

  // -- water: black resin
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(80000, 80000),
    new THREE.MeshPhongMaterial({ color: C.water, specular: 0x5a4a3a, shininess: 80, envMap: env, reflectivity: 0.32, combine: THREE.MixOperation }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = WY;
  scene.add(water);

  // -- camera rig: target glides along the path, camera trails it at pitch/dist
  const cam = data.camera;
  const P0 = new THREE.Vector3().fromArray(cam.path[0]), P1 = new THREE.Vector3().fromArray(cam.path[1]);
  const fwd = new THREE.Vector3().fromArray(cam.forward).normalize();
  const pitch = THREE.MathUtils.degToRad(cam.pitch + (+q.get('pitchOffset') || 0));
  const dist = cam.dist * (+q.get('distScale') || 1);
  const offset = fwd.clone().multiplyScalar(-dist * Math.cos(pitch)).add(new THREE.Vector3(0, dist * Math.sin(pitch), 0));

  // -- light: one static shadow map covering everything the camera sees
  const focus = P0.clone().add(P1).multiplyScalar(0.5).addScaledVector(fwd, 550);
  const sun = new THREE.DirectionalLight(0xffd4a0, 3.3);
  sun.position.copy(focus).addScaledVector(sunDir, 4000);
  sun.target.position.copy(focus);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const S = +q.get('shadow') || 1800;
  Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 100, far: 9000 });
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.8;
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(0xf2dcc0, 0x3b2b1d, 0.9));

  // -- camera + post
  const camera = new THREE.PerspectiveCamera(FOV, W / H, 5, 7000);
  const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: +(q.get('msaa') ?? 4) });
  const composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(1);
  composer.setSize(W, H);
  composer.addPass(new RenderPass(scene, camera));
  const blur = +q.get('tilt') || 2.6;
  const hPass = new ShaderPass(HorizontalTiltShiftShader);
  hPass.uniforms.h.value = blur / W; hPass.uniforms.r.value = 0.5;
  const vPass = new ShaderPass(VerticalTiltShiftShader);
  vPass.uniforms.v.value = blur / H; vPass.uniforms.r.value = 0.5;
  composer.addPass(hPass); composer.addPass(vPass);
  // Multiplicative vignette. (three's VignetteShader mixes towards 1 - darkness,
  // which goes negative for darkness > 1 and turns to garbage under ACES.)
  const vig = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, amount: { value: 0.55 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float amount; varying vec2 vUv;
      void main() {
        vec4 c = texture2D(tDiffuse, vUv);
        float d = length((vUv - 0.5) * vec2(1.0, 0.85)) * 1.414;
        c.rgb *= 1.0 - amount * smoothstep(0.45, 1.1, d);
        gl_FragColor = c;
      }`,
  });
  composer.addPass(vig);
  composer.addPass(new OutputPass());

  const ease = (t) => 0.8 * t + 0.2 * t * t * (3 - 2 * t);
  const target = new THREE.Vector3();
  window.renderFrame = (t) => {
    target.lerpVectors(P0, P1, ease(Math.min(1, Math.max(0, t))));
    camera.position.copy(target).add(offset);
    camera.lookAt(target);
    composer.render();
    return renderer.domElement.toDataURL('image/png');
  };
  status(`ready in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
  window.sceneReady = true;
}

main().catch((e) => { console.error(e); window.sceneError = String(e && e.stack || e); });
