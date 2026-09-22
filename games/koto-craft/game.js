'use strict';
/* global THREE */

// ==================================================================
// Koto Craft — a tiny voxel sandbox for koto & zuza
// ==================================================================

// ---------------- config ----------------
const CHUNK = 16;
const HEIGHT = 64;
const SEA = 22;
const VIEW_RADIUS = 6;     // meshed chunk radius
const DATA_RADIUS = 7;     // generated (unmeshed) chunk radius ring
const REACH = 6;
const DAY_LEN = 240;       // seconds per day cycle

const GRAV = 26, JUMP_V = 8.7, WALK_V = 5.4, SPRINT_V = 7.4, FLY_V = 11;
const EYE = 1.62, PW = 0.6, PH = 1.8;

const B = { AIR:0, GRASS:1, DIRT:2, STONE:3, WOOD:4, LEAVES:5, SAND:6, WATER:7, BRICK:8, GLASS:9, COBBLE:10 };
const HOTBAR = [B.GRASS, B.DIRT, B.STONE, B.COBBLE, B.WOOD, B.LEAVES, B.SAND, B.BRICK, B.GLASS];

const isSolid = t => t !== B.AIR && t !== B.WATER;
const inTransMesh = t => t === B.WATER || t === B.GLASS;

function faceVisible(t, n) {
  if (n === B.AIR) return true;
  if (n === t) return false;
  if (n === B.WATER || n === B.GLASS) return true;
  return false;
}

// ---------------- deterministic noise ----------------
let WORLD_SEED = 1337;
function hash2(x, z) {
  let h = (x * 374761393 + z * 668265263 + WORLD_SEED * 974711) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi), b = hash2(xi + 1, zi), c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, z) {
  return vnoise(x, z) * 0.6 + vnoise(x * 2.7 + 13.7, z * 2.7 + 7.1) * 0.3 + vnoise(x * 6.1 + 31.3, z * 6.1 + 17.9) * 0.1;
}
function heightAt(x, z) {
  let h = 25 + (fbm(x * 0.013, z * 0.013) - 0.5) * 20 + (vnoise(x * 0.004 + 9.7, z * 0.004 + 3.1) - 0.5) * 10;
  return Math.max(6, Math.min(HEIGHT - 10, Math.floor(h)));
}
function treeAt(x, z) {
  const r = hash2(x * 7 + 11, z * 13 + 29);
  if (r < 0.014) return 4 + Math.floor(r * 1000 % 3); // trunk height 4-6
  return 0;
}

// ---------------- procedural textures ----------------
function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function texOf(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
}
let R = 12345;
function rnd() { R = (R * 1103515245 + 12345) & 0x7fffffff; return R / 0x7fffffff; }
function px(ctx, x, y, c) { ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1); }
function vary(base, amt) {
  const v = () => Math.round((rnd() - 0.5) * 2 * amt);
  return `rgb(${base[0] + v()},${base[1] + v()},${base[2] + v()})`;
}
function noiseFill(ctx, x0, y0, base, amt) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(ctx, x0 + x, y0 + y, vary(base, amt));
}

// tile indices in a 4x4 atlas (64x64 canvas)
const T = { GRASS_T:0, GRASS_S:1, DIRT:2, STONE:3, COBBLE:4, WOOD_S:5, WOOD_T:6, LEAVES:7, SAND:8, WATER:9, BRICK:10, GLASS:11 };
const FACE_TILE = {
  [B.GRASS]:  { top: T.GRASS_T, bottom: T.DIRT, side: T.GRASS_S },
  [B.DIRT]:   { all: T.DIRT },
  [B.STONE]:  { all: T.STONE },
  [B.COBBLE]: { all: T.COBBLE },
  [B.WOOD]:   { top: T.WOOD_T, bottom: T.WOOD_T, side: T.WOOD_S },
  [B.LEAVES]: { all: T.LEAVES },
  [B.SAND]:   { all: T.SAND },
  [B.WATER]:  { all: T.WATER },
  [B.BRICK]:  { all: T.BRICK },
  [B.GLASS]:  { all: T.GLASS },
};

function buildAtlas() {
  const c = mkCanvas(64, 64), ctx = c.getContext('2d');
  const tile = (i, fn) => { const x0 = (i % 4) * 16, y0 = ((i / 4) | 0) * 16; ctx.save(); ctx.translate(x0, y0); fn(); ctx.restore(); };

  tile(T.GRASS_T, () => {
    noiseFill(ctx, 0, 0, [92, 166, 56], 22);
    for (let i = 0; i < 12; i++) px(ctx, (rnd() * 16) | 0, (rnd() * 16) | 0, vary([70, 140, 44], 10));
  });
  tile(T.GRASS_S, () => {
    noiseFill(ctx, 0, 0, [134, 96, 67], 18);
    for (let x = 0; x < 16; x++) {
      const d = 3 + Math.floor(rnd() * 3);
      for (let y = 0; y < d; y++) px(ctx, x, y, vary([92, 166, 56], 18));
    }
  });
  tile(T.DIRT, () => {
    noiseFill(ctx, 0, 0, [134, 96, 67], 18);
    for (let i = 0; i < 8; i++) px(ctx, (rnd() * 16) | 0, (rnd() * 16) | 0, vary([105, 72, 50], 8));
  });
  tile(T.STONE, () => {
    noiseFill(ctx, 0, 0, [125, 125, 125], 14);
    for (let i = 0; i < 14; i++) px(ctx, (rnd() * 16) | 0, (rnd() * 16) | 0, vary([96, 96, 96], 8));
  });
  tile(T.COBBLE, () => {
    noiseFill(ctx, 0, 0, [110, 110, 110], 12);
    for (let i = 0; i < 7; i++) {
      const bx = (rnd() * 12) | 0, by = (rnd() * 12) | 0;
      ctx.fillStyle = vary([80, 80, 80], 8);
      ctx.fillRect(bx, by, 3 + (rnd() * 3) | 0, 2 + (rnd() * 2) | 0);
    }
    for (let i = 0; i < 10; i++) px(ctx, (rnd() * 16) | 0, (rnd() * 16) | 0, vary([150, 150, 150], 10));
  });
  tile(T.WOOD_S, () => {
    noiseFill(ctx, 0, 0, [104, 76, 42], 14);
    for (let x = 0; x < 16; x += 4) for (let y = 0; y < 16; y++) px(ctx, x + ((rnd() * 2) | 0), y, vary([78, 55, 30], 8));
  });
  tile(T.WOOD_T, () => {
    noiseFill(ctx, 0, 0, [150, 112, 64], 12);
    for (let i = 0; i < 8; i += 2) {
      ctx.strokeStyle = vary([104, 76, 42], 8);
      ctx.strokeRect(i / 2 + 2, i / 2 + 2, 16 - i - 4, 16 - i - 4);
    }
  });
  tile(T.LEAVES, () => {
    noiseFill(ctx, 0, 0, [52, 124, 40], 22);
    for (let i = 0; i < 22; i++) px(ctx, (rnd() * 16) | 0, (rnd() * 16) | 0, vary([28, 74, 22], 10));
    for (let i = 0; i < 10; i++) px(ctx, (rnd() * 16) | 0, (rnd() * 16) | 0, vary([90, 160, 60], 14));
  });
  tile(T.SAND, () => {
    noiseFill(ctx, 0, 0, [226, 215, 162], 14);
    for (let i = 0; i < 10; i++) px(ctx, (rnd() * 16) | 0, (rnd() * 16) | 0, vary([200, 188, 132], 8));
  });
  tile(T.WATER, () => {
    ctx.fillStyle = 'rgba(56,105,215,0.78)'; ctx.fillRect(0, 0, 16, 16);
    for (let y = 1; y < 16; y += 4) {
      ctx.fillStyle = 'rgba(140,185,255,0.35)';
      ctx.fillRect((rnd() * 8) | 0, y, 6 + (rnd() * 8) | 0, 1);
    }
  });
  tile(T.BRICK, () => {
    noiseFill(ctx, 0, 0, [152, 72, 56], 12);
    ctx.fillStyle = 'rgb(188,180,168)';
    for (let y = 3; y < 16; y += 4) ctx.fillRect(0, y, 16, 1);
    for (let y = 0; y < 16; y += 4) for (let x = (y % 8 === 0 ? 4 : 8); x < 16; x += 8) ctx.fillRect(x, y, 1, 3);
  });
  tile(T.GLASS, () => {
    ctx.clearRect(0, 0, 16, 16);
    ctx.fillStyle = 'rgba(190,220,235,0.16)'; ctx.fillRect(0, 0, 16, 16);
    ctx.fillStyle = 'rgba(230,245,250,0.85)';
    for (let i = 0; i < 16; i++) { px(ctx, i, 0, 'rgba(230,245,250,0.9)'); px(ctx, i, 15, 'rgba(230,245,250,0.9)'); px(ctx, 0, i, 'rgba(230,245,250,0.9)'); px(ctx, 15, i, 'rgba(230,245,250,0.9)'); }
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    px(ctx, 3, 11, ctx.fillStyle); px(ctx, 4, 10, ctx.fillStyle); px(ctx, 5, 9, ctx.fillStyle); px(ctx, 6, 8, ctx.fillStyle);
  });
  return c;
}

// ---------------- character skins ----------------
// Each part is a small canvas texture applied to box faces.
function makeSkin(char) {
  const skin = '#d9a066', hair = char === 'koto' ? '#181418' : '#3a2416';
  const shirt = '#161616', pants = char === 'koto' ? '#2a2e38' : '#141414', shoe = '#0c0c0c';
  const mk = (w, h, fn) => { const c = mkCanvas(w, h), x = c.getContext('2d'); fn(x); return c; };
  const fill = (x, c) => { x.fillStyle = c; x.fillRect(0, 0, x.canvas.width, x.canvas.height); };
  const rect = (x, c, a, b, w, h) => { x.fillStyle = c; x.fillRect(a, b, w, h); };

  const headFront = mk(8, 8, x => {
    fill(x, skin);
    if (char === 'koto') {
      rect(x, hair, 0, 0, 8, 2);                 // fringe
      px(x, 1, 2, hair); px(x, 3, 2, hair); px(x, 6, 2, hair);
      rect(x, '#fff', 1, 4, 2, 1); rect(x, '#fff', 5, 4, 2, 1);
      px(x, 2, 4, '#222'); px(x, 6, 4, '#222');
      px(x, 3, 6, '#8a5a30'); px(x, 4, 6, '#8a5a30');
    } else {
      rect(x, hair, 0, 0, 8, 1); px(x, 0, 1, hair); px(x, 7, 1, hair);
      rect(x, '#0a0a0a', 0, 3, 8, 2);            // sunglasses band
      px(x, 1, 3, '#333'); px(x, 6, 3, '#333');  // glint
      px(x, 3, 6, '#8a5a30'); px(x, 4, 6, '#8a5a30');
    }
  });
  const headSide = mk(8, 8, x => {
    fill(x, char === 'koto' ? skin : hair);
    if (char === 'koto') { rect(x, hair, 0, 0, 8, 4); rect(x, hair, 0, 4, 2, 1); }
  });
  const headBack = mk(8, 8, x => {
    fill(x, hair);
    if (char === 'koto') rect(x, skin, 0, 7, 8, 1);
  });
  const headTop = mk(8, 8, x => fill(x, hair));
  const headBottom = mk(8, 8, x => fill(x, skin));
  const torsoFront = mk(8, 12, x => {
    fill(x, shirt);
    if (char === 'koto') {                       // silver chain necklace
      px(x, 2, 1, '#d8d8d8'); px(x, 5, 1, '#d8d8d8');
      px(x, 3, 2, '#c0c0c0'); px(x, 4, 2, '#c0c0c0');
      px(x, 3, 1, '#e8e8e8'); px(x, 4, 1, '#e8e8e8');
    } else {
      px(x, 3, 2, '#232323'); px(x, 4, 2, '#232323');
    }
  });
  const torsoBack = mk(8, 12, x => fill(x, char === 'zuza' ? hair : shirt));
  const torsoSide = mk(4, 12, x => fill(x, shirt));
  const armR = mk(4, 12, x => { fill(x, shirt); rect(x, skin, 0, 9, 4, 3); });
  const armL = mk(4, 12, x => {
    fill(x, shirt); rect(x, skin, 0, 9, 4, 3);
    if (char === 'koto') { rect(x, '#c8c8c8', 0, 8, 4, 1); px(x, 1, 7, '#666'); px(x, 2, 7, '#666'); } // wristwatch
  });
  const leg = mk(4, 12, x => { fill(x, pants); rect(x, shoe, 0, 10, 4, 2); });
  const hairPanel = char === 'zuza'
    ? mk(8, 16, x => { fill(x, hair); for (let i = 0; i < 8; i++) px(x, i * 2 % 8, i * 2 % 16, '#2a1810'); for (let i = 0; i < 8; i++) px(x, i, 13 + (i % 3), '#2f1c10'); })
    : null;
  const out = { headFront, headSide, headBack, headTop, headBottom, torsoFront, torsoBack, torsoSide, armR, armL, leg, hairPanel };
  for (const k in out) if (out[k]) out[k] = texOf(out[k]);
  return out;
}

function buildCharacter(char) {
  const s = makeSkin(char);
  const g = new THREE.Group();
  const mk = (w, h, d, tex, px_, py, pz, pivotTop) => {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mats = tex.map(t => new THREE.MeshBasicMaterial({ map: t }));
    const m = new THREE.Mesh(geo, mats);
    if (pivotTop) { geo.translate(0, -h / 2, 0); m.position.set(px_, py, pz); }
    else m.position.set(px_, py, pz);
    g.add(m); return m;
  };

  // head
  mk(0.52, 0.52, 0.52, [s.headSide, s.headSide, s.headTop, s.headBottom, s.headFront, s.headBack], 0, 1.56, 0);
  // torso (front +z)
  mk(0.6, 0.62, 0.3, [s.torsoSide, s.torsoSide, s.torsoSide, s.torsoSide, s.torsoFront, s.torsoBack], 0, 0.99, 0);
  // arms (pivot at shoulder y=1.3)
  const armL = mk(0.2, 0.62, 0.26, [s.armL, s.armL, s.armL, s.armL, s.armL, s.armL], -0.41, 1.3, 0, true);
  const armR = mk(0.2, 0.62, 0.26, [s.armR, s.armR, s.armR, s.armR, s.armR, s.armR], 0.41, 1.3, 0, true);
  // legs (pivot at hip y=0.7)
  const legL = mk(0.26, 0.7, 0.3, [s.leg, s.leg, s.leg, s.leg, s.leg, s.leg], -0.14, 0.7, 0, true);
  const legR = mk(0.26, 0.7, 0.3, [s.leg, s.leg, s.leg, s.leg, s.leg, s.leg], 0.14, 0.7, 0, true);
  if (s.hairPanel) {
    const hp = mk(0.44, 1.02, 0.06, [s.hairPanel, s.hairPanel, s.hairPanel, s.hairPanel, s.hairPanel, s.hairPanel], 0, 1.31, -0.19, true);
    hp.name = 'hair';
  }
  return { group: g, armL, armR, legL, legR };
}

// ---------------- tiny synth SFX ----------------
let AC = null, noiseBuf = null;
function audio() {
  if (!AC) {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    const len = AC.sampleRate * 0.25, b = AC.createBuffer(1, len, AC.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    noiseBuf = b;
  }
  if (AC.state === 'suspended') AC.resume();
  return AC;
}
function sfxBreak() {
  try {
    const a = audio(), t = a.currentTime;
    const src = a.createBufferSource(); src.buffer = noiseBuf;
    const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(1800, t); f.frequency.exponentialRampToValueAtTime(240, t + 0.11);
    const g = a.createGain(); g.gain.setValueAtTime(0.35, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    src.connect(f); f.connect(g); g.connect(a.destination); src.start(t); src.stop(t + 0.13);
  } catch (e) {}
}
function sfxPlace() {
  try {
    const a = audio(), t = a.currentTime, o = a.createOscillator(), g = a.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(520, t); o.frequency.exponentialRampToValueAtTime(180, t + 0.07);
    g.gain.setValueAtTime(0.22, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + 0.1);
  } catch (e) {}
}
function sfxStep() {
  try {
    const a = audio(), t = a.currentTime;
    const src = a.createBufferSource(); src.buffer = noiseBuf; src.playbackRate.value = 0.7 + Math.random() * 0.5;
    const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700;
    const g = a.createGain(); g.gain.setValueAtTime(0.06, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    src.connect(f); f.connect(g); g.connect(a.destination); src.start(t); src.stop(t + 0.08);
  } catch (e) {}
}

// ---------------- world ----------------
const atlasCanvas = buildAtlas();
const atlasTex = texOf(atlasCanvas);
const matOpaque = new THREE.MeshBasicMaterial({ map: atlasTex, vertexColors: true, side: THREE.DoubleSide });
const matTrans = new THREE.MeshBasicMaterial({ map: atlasTex, vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide });

const FACES = [ // [dx,dy,dz], 4 verts (top-left, top-right, bottom-right, bottom-left as seen facing the face), shade, slot
  { d: [ 1,0,0], v: [[1,1,0],[1,1,1],[1,0,1],[1,0,0]], s: 0.78, slot: 'side' },
  { d: [-1,0,0], v: [[0,1,1],[0,1,0],[0,0,0],[0,0,1]], s: 0.78, slot: 'side' },
  { d: [0, 1,0], v: [[0,1,1],[1,1,1],[1,1,0],[0,1,0]], s: 1.00, slot: 'top' },
  { d: [0,-1,0], v: [[0,0,0],[1,0,0],[1,0,1],[0,0,1]], s: 0.50, slot: 'bottom' },
  { d: [0,0, 1], v: [[1,1,1],[0,1,1],[0,0,1],[1,0,1]], s: 0.88, slot: 'side' },
  { d: [0,0,-1], v: [[0,1,0],[1,1,0],[1,0,0],[0,0,0]], s: 0.88, slot: 'side' },
];
const FACE_UV = [[0,1],[1,1],[1,0],[0,0]];

class World {
  constructor() { this.chunks = new Map(); this.group = new THREE.Group(); }
  key(cx, cz) { return cx + ',' + cz; }
  getBlock(wx, wy, wz) {
    if (wy < 0) return B.STONE;
    if (wy >= HEIGHT) return B.AIR;
    const cx = Math.floor(wx / CHUNK), cz = Math.floor(wz / CHUNK);
    const c = this.chunks.get(this.key(cx, cz));
    if (!c || !c.data) return B.AIR;
    return c.data[((wy * CHUNK) + (wz - cz * CHUNK)) * CHUNK + (wx - cx * CHUNK)];
  }
  getRaw(cx, cz, lx, wy, lz) { return ((wy * CHUNK) + lz) * CHUNK + lx; }
  setBlock(wx, wy, wz, t) {
    if (wy < 0 || wy >= HEIGHT) return;
    const cx = Math.floor(wx / CHUNK), cz = Math.floor(wz / CHUNK);
    const c = this.chunks.get(this.key(cx, cz));
    if (!c || !c.data) return;
    c.data[this.getRaw(cx, cz, wx - cx * CHUNK, wy, wz - cz * CHUNK)] = t;
    this.dirty(cx, cz);
    const lx = wx - cx * CHUNK, lz = wz - cz * CHUNK;
    if (lx === 0) this.dirty(cx - 1, cz);
    if (lx === CHUNK - 1) this.dirty(cx + 1, cz);
    if (lz === 0) this.dirty(cx, cz - 1);
    if (lz === CHUNK - 1) this.dirty(cx, cz + 1);
  }
  dirty(cx, cz) { const c = this.chunks.get(this.key(cx, cz)); if (c) c.dirty = true; }
  genData(cx, cz) {
    const k = this.key(cx, cz);
    let c = this.chunks.get(k);
    if (!c) { c = { data: null, meshO: null, meshT: null, dirty: false }; this.chunks.set(k, c); }
    if (c.data) return c;
    const data = new Uint8Array(CHUNK * HEIGHT * CHUNK);
    for (let lz = 0; lz < CHUNK; lz++) for (let lx = 0; lx < CHUNK; lx++) {
      const wx = cx * CHUNK + lx, wz = cz * CHUNK + lz;
      const h = heightAt(wx, wz);
      const beach = h <= SEA + 1;
      for (let y = 0; y <= h; y++) {
        let t = B.STONE;
        if (y === h) t = beach ? B.SAND : B.GRASS;
        else if (y > h - 4) t = beach ? B.SAND : B.DIRT;
        data[this.getRaw(cx, cz, lx, y, lz)] = t;
      }
      if (h < SEA) for (let y = h + 1; y <= SEA; y++) data[this.getRaw(cx, cz, lx, y, lz)] = B.WATER;
    }
    // trees (check a margin so leaves trunks crossing borders land correctly)
    for (let tz = -2; tz < CHUNK + 2; tz++) for (let tx = -2; tx < CHUNK + 2; tx++) {
      const wx = cx * CHUNK + tx, wz = cz * CHUNK + tz;
      const th = treeAt(wx, wz);
      if (!th) continue;
      const h = heightAt(wx, wz);
      if (h <= SEA + 1) continue;
      for (let y = h + 1; y <= h + th; y++) {
        if (tx >= 0 && tx < CHUNK && tz >= 0 && tz < CHUNK) data[this.getRaw(cx, cz, tx, y, tz)] = B.WOOD;
      }
      for (let dy = th - 2; dy <= th + 1; dy++) for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
        const ly = h + dy, lx = tx + dx, lz = tz + dz;
        if (lx < 0 || lx >= CHUNK || lz < 0 || lz >= CHUNK || ly >= HEIGHT) continue;
        const r = Math.abs(dx) + Math.abs(dz) + Math.max(0, dy - th);
        if (r > 3 || (dy === th + 1 && Math.abs(dx) + Math.abs(dz) > 1)) continue;
        const idx = this.getRaw(cx, cz, lx, ly, lz);
        if (data[idx] === B.AIR) data[idx] = B.LEAVES;
      }
    }
    c.data = data;
    return c;
  }
  removeMesh(c) {
    for (const m of [c.meshO, c.meshT]) if (m) { this.group.remove(m); m.geometry.dispose(); }
    c.meshO = c.meshT = null;
  }
  buildMesh(cx, cz) {
    const c = this.chunks.get(this.key(cx, cz));
    if (!c || !c.data) return;
    this.removeMesh(c);
    const op = { p: [], u: [], c: [], i: [] }, tr = { p: [], u: [], c: [], i: [] };
    for (let y = 0; y < HEIGHT; y++) for (let lz = 0; lz < CHUNK; lz++) for (let lx = 0; lx < CHUNK; lx++) {
      const t = c.data[this.getRaw(cx, cz, lx, y, lz)];
      if (t === B.AIR) continue;
      const wx = cx * CHUNK + lx, wz = cz * CHUNK + lz;
      const tgt = inTransMesh(t) ? tr : op;
      const tiles = FACE_TILE[t];
      for (const f of FACES) {
        const n = this.getBlock(wx + f.d[0], y + f.d[1], wz + f.d[2]);
        if (!faceVisible(t, n)) continue;
        const tile = f.slot === 'top' ? (tiles.top ?? tiles.all) : f.slot === 'bottom' ? (tiles.bottom ?? tiles.all) : (tiles.side ?? tiles.all);
        const u0 = (tile % 4) * 0.25, v0 = 1 - (((tile / 4) | 0) + 1) * 0.25;
        const base = tgt.p.length / 3;
        let shade = f.s;
        if (f.slot === 'top') shade *= Math.min(1, 0.5 + y / (SEA * 1.6)); // depth darkening
        for (let k = 0; k < 4; k++) {
          const v = f.v[k];
          tgt.p.push(wx + v[0], y + v[1], wz + v[2]);
          tgt.u.push(u0 + FACE_UV[k][0] * 0.25, v0 + FACE_UV[k][1] * 0.25);
          tgt.c.push(shade, shade, shade);
        }
        tgt.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
    const mkMesh = (a, mat) => {
      if (!a.i.length) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(a.p, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(a.u, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(a.c, 3));
      g.setIndex(a.i);
      const m = new THREE.Mesh(g, mat);
      m.matrixAutoUpdate = false;
      this.group.add(m);
      return m;
    };
    c.meshO = mkMesh(op, matOpaque);
    c.meshT = mkMesh(tr, matTrans);
    c.dirty = false;
  }
  dropFar(cx0, cz0) {
    for (const [k, c] of this.chunks) {
      const [cx, cz] = k.split(',').map(Number);
      if (Math.max(Math.abs(cx - cx0), Math.abs(cz - cz0)) > DATA_RADIUS + 1) {
        this.removeMesh(c);
        this.chunks.delete(k);
      }
    }
  }
}

// ---------------- voxel raycast (Amanatides & Woo) ----------------
function raycastVoxel(world, ox, oy, oz, dx, dy, dz, maxDist) {
  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const stepX = Math.sign(dx) || 1, stepY = Math.sign(dy) || 1, stepZ = Math.sign(dz) || 1;
  const tdx = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tdy = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  const tdz = dz !== 0 ? Math.abs(1 / dz) : Infinity;
  let tmx = dx !== 0 ? (stepX > 0 ? (x + 1 - ox) : (ox - x)) * tdx : Infinity;
  let tmy = dy !== 0 ? (stepY > 0 ? (y + 1 - oy) : (oy - y)) * tdy : Infinity;
  let tmz = dz !== 0 ? (stepZ > 0 ? (z + 1 - oz) : (oz - z)) * tdz : Infinity;
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < 256; i++) {
    const b = world.getBlock(x, y, z);
    if (b !== B.AIR && b !== B.WATER) return { x, y, z, nx, ny, nz, b };
    const t = Math.min(tmx, tmy, tmz);
    if (t > maxDist) return null;
    if (tmx <= tmy && tmx <= tmz) { x += stepX; tmx += tdx; nx = -stepX; ny = 0; nz = 0; }
    else if (tmy <= tmz) { y += stepY; tmy += tdy; ny = -stepY; nx = 0; nz = 0; }
    else { z += stepZ; tmz += tdz; nz = -stepZ; nx = 0; ny = 0; }
  }
  return null;
}

// ---------------- entity physics ----------------
function makeEntity(w, h) {
  return { pos: new THREE.Vector3(), vel: new THREE.Vector3(), w, h, onGround: false, inWater: false };
}
function overlapsBlock(world, e) {
  const hw = e.w / 2;
  const x0 = Math.floor(e.pos.x - hw), x1 = Math.floor(e.pos.x + hw);
  const y0 = Math.floor(e.pos.y), y1 = Math.floor(e.pos.y + e.h);
  const z0 = Math.floor(e.pos.z - hw), z1 = Math.floor(e.pos.z + hw);
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++)
    if (isSolid(world.getBlock(x, y, z))) return { x, y, z };
  return null;
}
function moveAxis(world, e, ax, d) {
  if (d === 0) return;
  e.pos[ax] += d;
  const hw = e.w / 2, eps = 1e-4;
  for (let iter = 0; iter < 4; iter++) {
    if (!overlapsBlock(world, e)) return;
    if (ax === 'x') e.pos.x = d > 0 ? Math.floor(e.pos.x + hw) - hw - eps : Math.floor(e.pos.x - hw) + 1 + hw + eps;
    else if (ax === 'z') e.pos.z = d > 0 ? Math.floor(e.pos.z + hw) - hw - eps : Math.floor(e.pos.z - hw) + 1 + hw + eps;
    else {
      if (d < 0) { e.pos.y = Math.floor(e.pos.y) + 1 + eps; e.onGround = true; }
      else e.pos.y = Math.floor(e.pos.y + e.h) - e.h - eps;
      e.vel.y = 0;
    }
  }
}
function stepEntity(world, e, dt, wishX, wishZ, jump, fly, descend) {
  const feet = world.getBlock(Math.floor(e.pos.x), Math.floor(e.pos.y + 0.1), Math.floor(e.pos.z));
  const head = world.getBlock(Math.floor(e.pos.x), Math.floor(e.pos.y + e.h * 0.7), Math.floor(e.pos.z));
  e.inWater = feet === B.WATER || head === B.WATER;
  if (fly) {
    e.vel.y = jump ? FLY_V * 0.8 : descend ? -FLY_V * 0.8 : 0;
  } else if (e.inWater) {
    e.vel.y = Math.max(e.vel.y - GRAV * 0.25 * dt, -3.2);
    if (jump) e.vel.y = Math.min(e.vel.y + 30 * dt, 3.4);
  } else {
    e.vel.y = Math.max(e.vel.y - GRAV * dt, -48);
    if (jump && e.onGround) e.vel.y = JUMP_V;
  }
  const damp = e.inWater && !fly ? 0.55 : 1;
  const boost = fly ? FLY_V / WALK_V : 1;
  e.vel.x = wishX * damp * boost;
  e.vel.z = wishZ * damp * boost;
  e.onGround = false;
  moveAxis(world, e, 'x', e.vel.x * dt);
  moveAxis(world, e, 'z', e.vel.z * dt);
  moveAxis(world, e, 'y', e.vel.y * dt);
}

// ---------------- game state ----------------
let renderer, scene, camera, world, player, playerModel, npc, npcModel, npcName;
let outline, sunMesh, moonMesh;
let state = 'title';   // title | loading | playing | paused
let myChar = null;
let yaw = 0, pitch = 0, thirdPerson = false, flying = false;
let inv = {}, sel = 0;
let dayT = 0.30;
let spawnPos = new THREE.Vector3();
const keys = {};
let breakHeld = false, placeHeld = false, breakCd = 0, placeCd = 0;
let walkDist = 0;
let genQueue = [], meshQueue = [];
let loadTotal = 1;
const isTouch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

// ---------------- DOM ----------------
const $ = id => document.getElementById(id);
const canvas = $('game'), hudEl = $('hud'), titleEl = $('title'), pauseEl = $('pause'), touchEl = $('touch');
const hotbarEl = $('hotbar'), hintEl = $('hint'), playBtn = $('play'), loadEl = $('loading'), loadBar = $('loadbar');

// ---------------- init three ----------------
function initGL() {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.08, 400);
  camera.rotation.order = 'YXZ';
  addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  });

  // sun + moon: flat squares, MC-style
  const sunMat = new THREE.MeshBasicMaterial({ color: 0xfff3b0, fog: false });
  const moonMat = new THREE.MeshBasicMaterial({ color: 0xd8e2ee, fog: false });
  sunMesh = new THREE.Mesh(new THREE.PlaneGeometry(26, 26), sunMat);
  moonMesh = new THREE.Mesh(new THREE.PlaneGeometry(18, 18), moonMat);
  sunMesh.material.side = moonMesh.material.side = THREE.DoubleSide;
  scene.add(sunMesh, moonMesh);

  outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
    new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55 })
  );
  outline.visible = false;
  scene.add(outline);
}

// ---------------- streaming ----------------
function enqueueAround(cx0, cz0) {
  genQueue = []; meshQueue = [];
  for (let r = 0; r <= DATA_RADIUS; r++)
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++)
      if (Math.max(Math.abs(dx), Math.abs(dz)) === r)
        genQueue.push([cx0 + dx, cz0 + dz]);
  for (let r = 0; r <= VIEW_RADIUS; r++)
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++)
      if (Math.max(Math.abs(dx), Math.abs(dz)) === r)
        meshQueue.push([cx0 + dx, cz0 + dz]);
  loadTotal = meshQueue.length;
}
function processQueues(genN, meshN) {
  let n = 0;
  while (genQueue.length && n < genN) {
    const [cx, cz] = genQueue.shift();
    world.genData(cx, cz); n++;
  }
  n = 0;
  while (meshQueue.length && n < meshN) {
    const [cx, cz] = meshQueue.shift();
    const c = world.chunks.get(world.key(cx, cz));
    if (c && c.data && !c.dirty && (c.meshO || c.meshT)) continue;
    world.genData(cx, cz); // make sure this chunk has data even if its gen entry was consumed
    world.buildMesh(cx, cz); n++;
  }
}

// ---------------- characters / preview ----------------
function drawCard(char, cv) {
  const s = makeSkin(char); // canvases accessible via texture .image
  const img = t => t.image;
  const x = cv.getContext('2d');
  x.imageSmoothingEnabled = false;
  x.clearRect(0, 0, cv.width, cv.height);
  const S = 7.5;
  x.drawImage(img(s.headFront), 30, 4, 8 * S, 8 * S);            // head
  x.drawImage(img(s.torsoFront), 32, 66, 8 * S * 0.94, 56);      // torso
  x.drawImage(img(s.armL), 6, 66, 4 * S * 0.8, 56);              // left arm
  x.drawImage(img(s.armR), 92, 66, 4 * S * 0.8, 56);             // right arm
  x.drawImage(img(s.leg), 34, 124, 22, 42);                      // legs
  x.drawImage(img(s.leg), 64, 124, 22, 42);
}

// ---------------- input ----------------
function bindInput() {
  addEventListener('keydown', e => {
    if (state !== 'playing') return;
    keys[e.code] = true;
    if (e.code.startsWith('Digit')) {
      const d = +e.code.slice(5);
      if (d >= 1 && d <= 9) { sel = d - 1; updateHotbar(); }
    }
    if (e.code === 'KeyV' || e.code === 'F5' || e.code === 'F4') { thirdPerson = !thirdPerson; e.preventDefault(); }
    if (e.code === 'KeyF') toggleFly();
    if (e.code === 'KeyP' || e.code === 'Escape') doPause();
    if (e.code === 'Space') {
      const now = performance.now();
      if (now - (bindInput._lastSpace || 0) < 280) toggleFly();
      bindInput._lastSpace = now;
      e.preventDefault();
    }
  });
  addEventListener('keyup', e => { keys[e.code] = false; });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; breakHeld = placeHeld = false; });

  canvas.addEventListener('click', () => {
    if (state === 'playing' && !isTouch && document.pointerLockElement !== canvas) lockPointer();
  });
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement !== canvas && state === 'playing' && !isTouch) doPause();
  });
  document.addEventListener('pointerlockerror', () => { hint('click again to grab the mouse'); });

  addEventListener('mousemove', e => {
    if (document.pointerLockElement !== canvas) return;
    yaw -= e.movementX * 0.0026;
    pitch = Math.max(-1.55, Math.min(1.55, pitch - e.movementY * 0.0026));
  });
  canvas.addEventListener('mousedown', e => {
    if (state !== 'playing' || isTouch || document.pointerLockElement !== canvas) return;
    if (e.button === 0) breakHeld = true;
    if (e.button === 2) { placeHeld = true; tryPlace(); }
  });
  addEventListener('mouseup', e => {
    if (e.button === 0) breakHeld = false;
    if (e.button === 2) placeHeld = false;
  });
  addEventListener('contextmenu', e => e.preventDefault());
  addEventListener('wheel', e => {
    if (state !== 'playing') return;
    sel = (sel + (e.deltaY > 0 ? 1 : -1) + 9) % 9;
    updateHotbar();
  }, { passive: true });

  bindTouch();
}
function lockPointer() {
  try {
    const p = canvas.requestPointerLock({ unadjustedMovement: true });
    if (p && p.catch) p.catch(() => canvas.requestPointerLock());
  } catch (e) { try { canvas.requestPointerLock(); } catch (e2) {} }
}
function toggleFly() {
  flying = !flying;
  $('flymsg').classList.toggle('hidden', !flying);
  if (!flying) player.vel.y = 0;
}
function hint(t) { hintEl.textContent = t; hintEl.style.opacity = 1; clearTimeout(hint._t); hint._t = setTimeout(() => hintEl.style.opacity = 0, 2600); }

// ---------------- touch controls ----------------
const joyVec = { x: 0, y: 0 };
let touchJump = false, touchBreak = false;
function bindTouch() {
  const joy = $('joy'), knob = $('joyknob');
  let joyId = null, lookId = null, lx = 0, ly = 0;
  const joyRect = () => joy.getBoundingClientRect();

  joy.addEventListener('pointerdown', e => {
    joyId = e.pointerId; joy.setPointerCapture(e.pointerId); joyMove(e);
  });
  function joyMove(e) {
    const r = joyRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let dx = (e.clientX - cx) / (r.width / 2), dy = (e.clientY - cy) / (r.height / 2);
    const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; }
    joyVec.x = dx; joyVec.y = -dy;
    knob.style.transform = `translate(calc(-50% + ${dx * 34}px), calc(-50% + ${dy * 34}px))`;
  }
  joy.addEventListener('pointermove', e => { if (e.pointerId === joyId) joyMove(e); });
  const joyEnd = e => { if (e.pointerId === joyId) { joyId = null; joyVec.x = joyVec.y = 0; knob.style.transform = 'translate(-50%,-50%)'; } };
  joy.addEventListener('pointerup', joyEnd); joy.addEventListener('pointercancel', joyEnd);

  canvas.addEventListener('pointerdown', e => {
    if (state !== 'playing' || e.pointerType === 'mouse') return;
    lookId = e.pointerId; lx = e.clientX; ly = e.clientY;
  });
  canvas.addEventListener('pointermove', e => {
    if (e.pointerId !== lookId) return;
    yaw -= (e.clientX - lx) * 0.006;
    pitch = Math.max(-1.55, Math.min(1.55, pitch - (e.clientY - ly) * 0.006));
    lx = e.clientX; ly = e.clientY;
  });
  const lookEnd = e => { if (e.pointerId === lookId) lookId = null; };
  canvas.addEventListener('pointerup', lookEnd); canvas.addEventListener('pointercancel', lookEnd);

  const hold = (el, on, off) => {
    el.addEventListener('pointerdown', e => { e.preventDefault(); on(); });
    el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off);
  };
  hold($('btn-jump'), () => touchJump = true, () => touchJump = false);
  hold($('btn-break'), () => touchBreak = true, () => touchBreak = false);
  $('btn-place').addEventListener('pointerdown', e => { e.preventDefault(); tryPlace(); });
  $('btn-fly').addEventListener('pointerdown', e => { e.preventDefault(); toggleFly(); });
  $('btn-cam').addEventListener('pointerdown', e => { e.preventDefault(); thirdPerson = !thirdPerson; });
  $('btn-pause').addEventListener('pointerdown', e => { e.preventDefault(); doPause(); });
}

// ---------------- inventory / hotbar ----------------
function buildHotbar() {
  hotbarEl.innerHTML = '';
  HOTBAR.forEach((b, i) => {
    const slot = document.createElement('div');
    slot.className = 'slot' + (i === sel ? ' sel' : '');
    const cv = mkCanvas(40, 40), x = cv.getContext('2d');
    x.imageSmoothingEnabled = false;
    const tile = FACE_TILE[b].side ?? FACE_TILE[b].all;
    x.drawImage(atlasCanvas, (tile % 4) * 16, ((tile / 4) | 0) * 16, 16, 16, 2, 2, 36, 36);
    slot.appendChild(cv);
    const k = document.createElement('span'); k.className = 'key'; k.textContent = i + 1; slot.appendChild(k);
    const cnt = document.createElement('span'); cnt.className = 'cnt'; cnt.id = 'cnt' + i; slot.appendChild(cnt);
    slot.addEventListener('pointerdown', e => { e.preventDefault(); sel = i; updateHotbar(); });
    hotbarEl.appendChild(slot);
  });
  updateHotbar();
}
function updateHotbar() {
  [...hotbarEl.children].forEach((s, i) => {
    s.classList.toggle('sel', i === sel);
    s.querySelector('.cnt').textContent = inv[HOTBAR[i]] || '';
  });
}

// ---------------- actions ----------------
function eyePos() { return new THREE.Vector3(player.pos.x, player.pos.y + EYE, player.pos.z); }
function lookDir() {
  const v = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
  return v;
}
function targetBlock() {
  const e = eyePos(), d = lookDir();
  return raycastVoxel(world, e.x, e.y, e.z, d.x, d.y, d.z, REACH);
}
function tryBreak() {
  const t = targetBlock();
  if (!t || t.y === 0) return;
  world.setBlock(t.x, t.y, t.z, B.AIR);
  const drop = t.b === B.WATER ? null : t.b;
  if (drop && HOTBAR.includes(drop)) { inv[drop] = (inv[drop] || 0) + 1; updateHotbar(); }
  sfxBreak();
}
function tryPlace() {
  const t = targetBlock();
  if (!t) return;
  const bx = t.x + t.nx, by = t.y + t.ny, bz = t.z + t.nz;
  const type = HOTBAR[sel];
  if ((inv[type] || 0) <= 0) { hint('no ' + 'blocks left — break some first'); return; }
  const cur = world.getBlock(bx, by, bz);
  if (cur !== B.AIR && cur !== B.WATER) return;
  // don't place inside the player or npc
  for (const e of [player, npc && npc.e]) {
    if (!e) continue;
    const hw = e.w / 2;
    if (bx + 1 > e.pos.x - hw && bx < e.pos.x + hw && bz + 1 > e.pos.z - hw && bz < e.pos.z + hw && by + 1 > e.pos.y && by < e.pos.y + e.h) return;
  }
  world.setBlock(bx, by, bz, type);
  inv[type]--; updateHotbar();
  sfxPlace();
}

// ---------------- NPC ----------------
function makeNPC(char, x, z) {
  const e = makeEntity(PW, PH);
  e.pos.set(x, 0, z);
  world.genData(Math.floor(x / CHUNK), Math.floor(z / CHUNK));
  for (let y = HEIGHT - 1; y > 0; y--) if (isSolid(world.getBlock(Math.floor(x), y, Math.floor(z)))) { e.pos.y = y + 1; break; }
  const model = buildCharacter(char);
  model.group.position.copy(e.pos);
  scene.add(model.group);
  // name tag
  const cv = mkCanvas(128, 32), cx2 = cv.getContext('2d');
  cx2.font = 'bold 20px monospace'; cx2.textAlign = 'center';
  cx2.fillStyle = 'rgba(0,0,0,.45)'; cx2.fillRect(34, 4, 60, 24);
  cx2.fillStyle = '#fff'; cx2.fillText(char, 64, 23);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: texOf(cv), transparent: true }));
  sp.scale.set(1.4, 0.35, 1); sp.position.y = 2.15;
  model.group.add(sp);
  return { e, model, tx: x, tz: z, timer: 0, phase: 0 };
}
function updateNPC(dt) {
  const n = npc; if (!n) return;
  n.timer -= dt;
  if (n.timer <= 0) {
    n.timer = 3 + Math.random() * 5;
    if (Math.random() < 0.65) { n.tx = n.home + (Math.random() - 0.5) * 22; n.tz = n.homeZ + (Math.random() - 0.5) * 22; }
    else { n.tx = n.e.pos.x; n.tz = n.e.pos.z; }
  }
  const dx = n.tx - n.e.pos.x, dz = n.tz - n.e.pos.z;
  const dist = Math.hypot(dx, dz);
  let wx = 0, wz = 0;
  if (dist > 0.8) {
    const d = Math.atan2(dx, dz);
    wx = Math.sin(d) * 1.7; wz = Math.cos(d) * 1.7;
    // hop if blocked ahead
    const ahead = world.getBlock(Math.floor(n.e.pos.x + dx / dist), Math.floor(n.e.pos.y + 0.2), Math.floor(n.e.pos.z + dz / dist));
    if (isSolid(ahead) && n.e.onGround) n.e.vel.y = JUMP_V;
  }
  stepEntity(world, n.e, dt, wx, wz, false, false, false);
  n.model.group.position.copy(n.e.pos);
  if (dist > 0.8) { n.phase += dt * 7; n.model.group.rotation.y = Math.atan2(wx, wz); }
  const sw = Math.sin(n.phase) * (dist > 0.8 ? 0.6 : 0.04);
  n.model.armL.rotation.x = sw; n.model.armR.rotation.x = -sw;
  n.model.legL.rotation.x = -sw; n.model.legR.rotation.x = sw;
}

// ---------------- day/night ----------------
const skyDay = new THREE.Color(0.55, 0.74, 0.97), skyNight = new THREE.Color(0.012, 0.018, 0.05);
const skyCol = new THREE.Color();
function updateDay(dt) {
  dayT = (dayT + dt / DAY_LEN) % 1;
  const a = dayT * Math.PI * 2;
  const sunH = Math.sin(a);                       // -1..1
  const dayF = THREE.MathUtils.clamp(sunH * 1.6 + 0.12, 0, 1);
  const light = 0.14 + 0.86 * dayF;
  skyCol.copy(skyNight).lerp(skyDay, dayF);
  scene.background = skyCol;
  scene.fog.color.copy(skyCol);
  matOpaque.color.setScalar(light);
  matTrans.color.setScalar(light);
  // sun / moon positions relative to camera
  const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
  sunMesh.position.set(cx + Math.cos(a) * 170, cy + Math.sin(a) * 170, cz - 60);
  moonMesh.position.set(cx - Math.cos(a) * 170, cy - Math.sin(a) * 170, cz + 60);
  sunMesh.lookAt(cx, cy, cz); moonMesh.lookAt(cx, cy, cz);
  sunMesh.visible = sunH > -0.25; moonMesh.visible = sunH < 0.25;
}

// ---------------- main loop ----------------
let lastT = 0, playerPhase = 0, swingAmp = 0;
function tick(t) {
  requestAnimationFrame(tick);
  const dt = Math.min(0.05, (t - lastT) / 1000 || 0.016);
  lastT = t;

  if (state === 'loading') {
    processQueues(10, 8);
    const remaining = genQueue.length + meshQueue.length;
    loadBar.style.setProperty('--p', 1 - remaining / loadTotal);
    if (!meshQueue.length) startPlay();
  } else if (state === 'playing') {
    // stream chunks around player
    const pcx = Math.floor(player.pos.x / CHUNK), pcz = Math.floor(player.pos.z / CHUNK);
    if (pcx !== tick._cx || pcz !== tick._cz) { tick._cx = pcx; tick._cz = pcz; enqueueAround(pcx, pcz); world.dropFar(pcx, pcz); }
    processQueues(6, 3);
    // remesh dirty chunks
    let rem = 0;
    for (const [k, c] of world.chunks) {
      if (c.dirty && rem < 4) { const [cx, cz] = k.split(',').map(Number); world.buildMesh(cx, cz); rem++; }
    }

    // input → velocity: f_in forward(+)/back(-), s_in right(+)/left(-)
    let f_in = (keys['KeyW'] ? 1 : 0) - (keys['KeyS'] ? 1 : 0) + joyVec.y;
    let s_in = (keys['KeyD'] ? 1 : 0) - (keys['KeyA'] ? 1 : 0) + joyVec.x;
    const m = Math.hypot(f_in, s_in); if (m > 1) { f_in /= m; s_in /= m; }
    const sprint = keys['ShiftLeft'] || keys['ShiftRight'];
    const sp = sprint ? SPRINT_V : WALK_V;
    const sy = Math.sin(yaw), cy = Math.cos(yaw);
    // forward = (-sin yaw, -cos yaw), right = (cos yaw, -sin yaw)
    const wx = (-sy * f_in + cy * s_in) * sp, wz = (-cy * f_in - sy * s_in) * sp;
    stepEntity(world, player, dt, wx, wz, keys['Space'] || touchJump, flying, sprint);

    // walk sfx + arm swing phase
    if (player.onGround && Math.hypot(player.vel.x, player.vel.z) > 1) {
      walkDist += Math.hypot(player.vel.x, player.vel.z) * dt;
      playerPhase += dt * 9;
      if (walkDist > 1.6) { walkDist = 0; sfxStep(); }
    }

    // break/place repeat
    breakCd -= dt; placeCd -= dt;
    const tgt = targetBlock();
    outline.visible = !!tgt;
    if (tgt) outline.position.set(tgt.x + 0.5, tgt.y + 0.5, tgt.z + 0.5);
    if ((breakHeld || touchBreak) && breakCd <= 0) { tryBreak(); breakCd = 0.22; }
    if (placeHeld && placeCd <= 0) { tryPlace(); placeCd = 0.26; }

    // fell out of the world
    if (player.pos.y < -12) die();

    // camera
    const ep = eyePos();
    if (thirdPerson) {
      const d = lookDir();
      let dist = 4.5;
      for (let s = 0.3; s < dist; s += 0.15) {
        const sx = ep.x - d.x * s, sy2 = ep.y - d.y * s + 0.3, sz = ep.z - d.z * s;
        if (isSolid(world.getBlock(Math.floor(sx), Math.floor(sy2), Math.floor(sz)))) { dist = s - 0.2; break; }
      }
      camera.position.set(ep.x - d.x * dist, ep.y - d.y * dist + 0.3, ep.z - d.z * dist);
      camera.rotation.set(pitch, yaw, 0);
      playerModel.group.visible = true;
    } else {
      camera.position.copy(ep);
      camera.rotation.set(pitch, yaw, 0);
      playerModel.group.visible = false;
    }
    playerModel.group.position.copy(player.pos);
    playerModel.group.rotation.y = yaw + Math.PI;
    const moving = player.onGround && Math.hypot(player.vel.x, player.vel.z) > 1;
    swingAmp += ((moving ? 0.6 : 0) - swingAmp) * Math.min(1, dt * 8);
    const psw = Math.sin(playerPhase) * swingAmp;
    playerModel.armL.rotation.x = psw; playerModel.armR.rotation.x = -psw;
    playerModel.legL.rotation.x = -psw; playerModel.legR.rotation.x = psw;

    updateNPC(dt);
    updateDay(dt);
  }
  renderer.render(scene, camera);
}

function die() {
  const dm = $('deathmsg');
  dm.classList.remove('hidden');
  player.pos.copy(spawnPos); player.vel.set(0, 0, 0);
  setTimeout(() => dm.classList.add('hidden'), 1800);
}

// ---------------- state transitions ----------------
function doPause() {
  if (state !== 'playing') return;
  state = 'paused';
  pauseEl.classList.remove('hidden');
  if (document.pointerLockElement) document.exitPointerLock();
}
function resume() {
  pauseEl.classList.add('hidden');
  state = 'playing';
  if (!isTouch) lockPointer();
}
function startPlay() {
  loadEl.classList.add('hidden');
  titleEl.classList.add('hidden');
  hudEl.classList.remove('hidden');
  if (isTouch) touchEl.classList.remove('hidden');
  state = 'playing';
  hint(isTouch ? 'drag to look · joystick to move' : 'click to grab the mouse · WASD move · space jump');
  if (!isTouch) lockPointer();
}

function startWorld(char) {
  WORLD_SEED = (Math.random() * 1e9) | 0;
  world = new World();
  scene.add(world.group);
  state = 'loading';
  loadEl.classList.remove('hidden');
  playBtn.classList.add('hidden');
  document.getElementById('chars').style.pointerEvents = 'none';

  player = makeEntity(PW, PH);
  // spawn on dry land near origin: first column with ground above sea level
  let sx = 8.5, sz = 8.5;
  world.genData(0, 0);
  outer: for (let r = 0; r < 32; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
    if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
    if (heightAt(8 + dx, 8 + dz) > SEA + 1) { sx = 8 + dx + 0.5; sz = 8 + dz + 0.5; break outer; }
  }
  player.pos.set(sx, HEIGHT, sz);
  for (let y = HEIGHT - 1; y > 0; y--) {
    const b = world.getBlock(Math.floor(sx), y, Math.floor(sz));
    if (isSolid(b) && b !== B.LEAVES) { player.pos.y = y + 1; break; }
  }
  spawnPos.copy(player.pos);

  playerModel = buildCharacter(char);
  scene.add(playerModel.group);

  const other = char === 'koto' ? 'zuza' : 'koto';
  npc = makeNPC(other, sx + 3, sz + 3);
  npc.home = sx + 3; npc.homeZ = sz + 3;
  yaw = Math.atan2(npc.e.pos.x - player.pos.x, npc.e.pos.z - player.pos.z) + Math.PI; // face the npc at spawn
  pitch = -0.1;

  HOTBAR.forEach(b => inv[b] = 16);
  buildHotbar();
  enqueueAround(Math.floor(sx / CHUNK), Math.floor(sz / CHUNK));
  loadTotal = genQueue.length + meshQueue.length;
  scene.fog = new THREE.Fog(0x88aaff, (VIEW_RADIUS - 1.5) * CHUNK, (VIEW_RADIUS - 0.4) * CHUNK);
}

// ---------------- boot ----------------
function boot() {
  initGL();
  bindInput();
  document.querySelectorAll('.charcard').forEach(card => {
    drawCard(card.dataset.char, card.querySelector('canvas'));
    card.addEventListener('click', () => {
      document.querySelectorAll('.charcard').forEach(c => c.classList.remove('sel'));
      card.classList.add('sel');
      playBtn.disabled = false;
      playBtn.textContent = 'Enter World as ' + card.dataset.char;
    });
  });
  playBtn.addEventListener('click', () => {
    const card = document.querySelector('.charcard.sel');
    if (!card) return;
    if (!isTouch) lockPointer(); // inside the user gesture so the world starts locked
    startWorld(card.dataset.char);
  });
  $('resume').addEventListener('click', resume);
  $('totitle').addEventListener('click', () => location.reload());
  requestAnimationFrame(tick);
}
boot();
