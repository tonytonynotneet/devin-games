/* NEON CITY 3D — main: module bus, renderer, loop, shared state. */
import * as THREE from 'three';

const NC = window.NC = {
  _mods: [],
  register(name, mod) {
    mod._name = name; NC[name] = mod; NC._mods.push(mod);
    return mod;
  },
  state: { players: [], money: 0, time: 0, started: false },
  me() { return NC.state.players[NC.playerIdx || 0]; },
  toast(msg, ms = 1400) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('on');
    clearTimeout(NC._toastT);
    NC._toastT = setTimeout(() => t.classList.remove('on'), ms);
  },
  kill(msg) {
    const k = document.getElementById('killfeed');
    const d = document.createElement('div');
    d.textContent = msg; k.appendChild(d);
    while (k.children.length > 4) k.firstChild.remove();
    setTimeout(() => d.remove(), 4200);
  },
  shake(n) { NC._shake = Math.max(NC._shake || 0, n); },
  util: {
    rand: (a, b) => a + Math.random() * (b - a),
    randi: (a, b) => Math.floor(a + Math.random() * (b - a + 1)),
    clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
    dist: (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by),
    dist3: (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz),
    angDiff(a, b) { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; },
    lerp: (a, b, t) => a + (b - a) * t,
  },
};

// ---------- renderer ----------
const canvas = document.getElementById('cv3d');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05060f);
scene.fog = new THREE.Fog(0x0a0e24, 60, 340);
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 500);
camera.position.set(0, 6, 8);
NC.scene = scene; NC.cam = camera; NC.renderer = renderer; NC.THREE = THREE;

// lights
const amb = new THREE.AmbientLight(0x404860, 1.15);
const hemi = new THREE.HemisphereLight(0x2a3570, 0x0a0c18, 0.85);
const moon = new THREE.DirectionalLight(0x8fa5ff, 0.7);
moon.position.set(80, 140, 60);
scene.add(amb, hemi, moon);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---------- module wiring ----------
const PLAY = new URLSearchParams(location.search).has('play');
const MODS = ['input', 'city', 'pawn', 'camera', 'player', 'car', 'combat', 'people', 'wanted', 'missions', 'hud', 'save', 'net'];
await Promise.all(MODS.map(m => import(`./${m}.js`).catch(e => { console.error('mod', m, e); })));
// run init/start/update in declared MODS order — import eval order is arbitrary
// and several modules' init() depends on earlier ones (city solids before
// combat/people/missions spawn entities).
const ORDERED = MODS.map(n => NC[n]).filter(m => m && m._name);
for (const m of ORDERED) m.init && m.init(NC.state);
for (const m of ORDERED) m.start && m.start(NC.state);

// ---------- loop ----------
let last = performance.now();
function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (t - last) / 1000); last = t;
  const s = NC.state;
  if (!s.started) { renderer.render(scene, camera); return; }
  s.time += dt;
  if (NC.input && NC.input.pollKeys) NC.input.pollKeys();
  for (const m of ORDERED) m.update && m.update(dt, s);
  if (NC.input) NC.input.endFrame();
  // camera shake decay
  if (NC._shake > 0) {
    camera.position.x += (Math.random() - 0.5) * NC._shake * 0.12;
    camera.position.y += (Math.random() - 0.5) * NC._shake * 0.08;
    NC._shake = Math.max(0, NC._shake - dt * 22);
  }
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

// ---------- boot ----------
document.getElementById('btn-play').onclick = () => {
  document.getElementById('title').classList.remove('on');
  NC.state.started = true;
  NC.toast('WELCOME TO NEON CITY', 2000);
};
document.getElementById('btn-help').onclick = () => document.getElementById('help').classList.add('on');
document.getElementById('help-close').onclick = () => document.getElementById('help').classList.remove('on');
document.getElementById('ovl-btn').onclick = () => document.getElementById('ovl').classList.remove('on');
document.getElementById('btn-restart').onclick = () => location.reload();

if (PLAY) {
  document.getElementById('title').classList.remove('on');
  NC.state.started = true;
} else {
  document.getElementById('title').classList.add('on');
}
