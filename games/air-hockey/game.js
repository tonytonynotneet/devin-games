'use strict';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = canvas.width;
const H = canvas.height;

const WALL = 16;          // rink border thickness
const GOAL_H = 170;       // goal mouth height
const MR = 24;            // mallet radius
const PR = 13;            // puck radius
const WIN_SCORE = 7;
const MALLET_SPEED = 620; // px/s
const PUCK_MAX = 1150;
const PUCK_MIN_SERVE = 300;
const FRICTION = 0.12;    // puck damping /s
const PUNCH = 0.32;       // how much mallet velocity transfers to puck

const C1 = '#ff6b9d';
const C2 = '#4ecdc4';

const el = id => document.getElementById(id);
const menuEl = el('menu');
const resultEl = el('result');
const bannerEl = el('banner');
const pauseEl = el('pause');
const score1El = el('score1');
const score2El = el('score2');
const name1El = el('name1');
const name2El = el('name2');
const winnerTextEl = el('winnerText');
const finalScoreEl = el('finalScore');
const startBtn = el('startBtn');
const replayBtn = el('replayBtn');
const menuBtn = el('menuBtn');
const input1 = el('input1');
const input2 = el('input2');
const pauseBtn = el('pauseBtn');

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const mallets = [
  { x: W * 0.25, y: H / 2, px: W * 0.25, py: H / 2, vx: 0, vy: 0, side: 0, color: C1, touch: null },
  { x: W * 0.75, y: H / 2, px: W * 0.75, py: H / 2, vx: 0, vy: 0, side: 1, color: C2, touch: null },
];
const puck = { x: W / 2, y: H / 2, vx: 0, vy: 0 };

const S = {
  mode: 'menu',          // menu | count | live | goal | over
  paused: false,
  countT: 0,
  goalT: 0,
  lastScorer: -1,
  scores: [0, 0],
  names: ['プレイヤー1', 'プレイヤー2'],
  touchMode: false,
  touched: [false, false],
  shake: 0,
  demoT: 0,
};

const keys = Object.create(null);

/* ── audio ── */
let AC = null;
function ac() {
  if (!AC) {
    try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
  }
  if (AC.state === 'suspended') AC.resume();
  return AC;
}
function tone(freq, dur = 0.08, type = 'square', vol = 0.12, when = 0) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime + when;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}
const sHit = v => tone(180 + Math.min(400, v * 0.4), 0.07, 'square', 0.14);
const sWall = () => tone(120, 0.05, 'square', 0.08);
const sCount = () => tone(660, 0.07, 'sine', 0.12);
const sGo = () => tone(990, 0.14, 'sine', 0.16);
const sGoal = () => { tone(523, 0.12, 'triangle', 0.16); tone(659, 0.12, 'triangle', 0.16, 0.1); tone(784, 0.22, 'triangle', 0.18, 0.2); };
const sWin = () => { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, 0.16, 'triangle', 0.15, i * 0.11)); };

/* ── input ── */
window.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
  keys[k] = true;
  if (k === 'p') togglePause();
  if (k === 'enter' || k === ' ') {
    if (S.mode === 'menu') startGame();
    else if (S.mode === 'over') restart();
  }
});
window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
window.addEventListener('blur', () => { if (playing()) setPause(true); });
document.addEventListener('visibilitychange', () => { if (document.hidden && playing()) setPause(true); });

const keyDirs = [
  { up: 'w', down: 's', left: 'a', right: 'd' },
  { up: 'arrowup', down: 'arrowdown', left: 'arrowleft', right: 'arrowright' },
];

/* ── touch: split-screen drag, one finger per half ── */
const touchMap = new Map(); // touchId -> side

function canvasPos(t) {
  const r = canvas.getBoundingClientRect();
  return {
    x: (t.clientX - r.left) * (W / r.width),
    y: (t.clientY - r.top) * (H / r.height),
  };
}
function enableTouchMode() {
  if (S.touchMode) return;
  S.touchMode = true;
  document.body.classList.add('touch');
}
canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  enableTouchMode();
  ac();
  for (const t of e.changedTouches) {
    if (touchMap.has(t.identifier)) continue;
    const p = canvasPos(t);
    const side = p.x < W / 2 ? 0 : 1;
    if ([...touchMap.values()].includes(side)) continue; // one finger per side
    touchMap.set(t.identifier, side);
    S.touched[side] = true;
    mallets[side].touch = p;
  }
}, { passive: false });
canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    const side = touchMap.get(t.identifier);
    if (side === undefined) continue;
    mallets[side].touch = canvasPos(t);
  }
}, { passive: false });
function endTouch(e) {
  for (const t of e.changedTouches) {
    const side = touchMap.get(t.identifier);
    if (side === undefined) continue;
    touchMap.delete(t.identifier);
    mallets[side].touch = null;
  }
}
canvas.addEventListener('touchend', endTouch);
canvas.addEventListener('touchcancel', endTouch);

/* ── flow ── */
function playing() { return ['count', 'live', 'goal'].includes(S.mode); }
function setPause(p) {
  if (!playing() && p) return;
  S.paused = p;
  pauseEl.classList.toggle('hidden', !p);
}
function togglePause() { if (playing()) setPause(!S.paused); }

function resetPositions() {
  mallets[0].x = mallets[0].px = W * 0.25; mallets[0].y = mallets[0].py = H / 2;
  mallets[1].x = mallets[1].px = W * 0.75; mallets[1].y = mallets[1].py = H / 2;
  mallets.forEach(m => { m.vx = m.vy = 0; });
  puck.x = W / 2; puck.y = H / 2; puck.vx = puck.vy = 0;
}

function startGame() {
  S.names[0] = input1.value.trim() || 'プレイヤー1';
  S.names[1] = input2.value.trim() || 'プレイヤー2';
  name1El.textContent = S.names[0];
  name2El.textContent = S.names[1];
  el('ctlName1').textContent = S.names[0];
  el('ctlName2').textContent = S.names[1];
  S.scores = [0, 0];
  score1El.textContent = '0';
  score2El.textContent = '0';
  menuEl.classList.add('hidden');
  resultEl.classList.add('hidden');
  resetPositions();
  startCount(Math.random() < 0.5 ? 0 : 1); // random first serve direction
  ac();
  startBtn.blur();
}

function restart() {
  S.scores = [0, 0];
  score1El.textContent = '0';
  score2El.textContent = '0';
  resultEl.classList.add('hidden');
  resetPositions();
  startCount(S.lastScorer === 0 ? 1 : 0); // serve toward the player who conceded
  replayBtn.blur();
}

function toMenu() {
  S.mode = 'menu';
  setPause(false);
  resultEl.classList.add('hidden');
  menuEl.classList.remove('hidden');
  menuBtn.blur();
}

function serve(toward) {
  // puck launches toward the player who concedes (index 0 = left, 1 = right)
  const ang = (Math.random() * 0.9 - 0.45); // ±26°
  const dir = toward === 0 ? -1 : 1;
  puck.x = W / 2; puck.y = H / 2;
  puck.vx = Math.cos(ang) * PUCK_MIN_SERVE * dir;
  puck.vy = Math.sin(ang) * PUCK_MIN_SERVE;
}

function startCount(toward) {
  S.mode = 'count';
  S.countT = 1.5;
  S.serveTo = toward;
  setBanner('3', 'count-anim');
}

function goal(scorer) {
  S.scores[scorer]++;
  S.lastScorer = scorer;
  score1El.textContent = S.scores[0];
  score2El.textContent = S.scores[1];
  S.shake = 0.45;
  if (S.scores[scorer] >= WIN_SCORE) {
    S.mode = 'over';
    sWin();
    winnerTextEl.textContent = S.names[scorer] + ' の勝利！';
    winnerTextEl.style.color = scorer === 0 ? C1 : C2;
    winnerTextEl.style.background = 'none';
    finalScoreEl.textContent = S.scores[0] + ' — ' + S.scores[1];
    setTimeout(() => resultEl.classList.remove('hidden'), 600);
  } else {
    S.mode = 'goal';
    S.goalT = 1.3;
    sGoal();
    setBanner('ゴール！ ' + S.names[scorer], 'goal-anim', scorer === 0 ? C1 : C2);
  }
}

function setBanner(text, cls, color) {
  bannerEl.textContent = text;
  bannerEl.style.color = color || 'var(--text)';
  bannerEl.classList.remove('hidden', 'goal-anim', 'count-anim');
  void bannerEl.offsetWidth; // restart animation
  if (cls) bannerEl.classList.add(cls);
}
function hideBanner() { bannerEl.classList.add('hidden'); }

/* ── physics ── */
function moveMallet(m, dt, idx) {
  m.px = m.x; m.py = m.y;
  let dx = 0, dy = 0;
  const kd = keyDirs[idx];
  if (keys[kd.up]) dy -= 1;
  if (keys[kd.down]) dy += 1;
  if (keys[kd.left]) dx -= 1;
  if (keys[kd.right]) dx += 1;
  if (dx || dy) {
    const l = Math.hypot(dx, dy);
    m.x += dx / l * MALLET_SPEED * dt;
    m.y += dy / l * MALLET_SPEED * dt;
  }
  if (m.touch) {
    const tx = m.touch.x - m.x, ty = m.touch.y - m.y;
    const d = Math.hypot(tx, ty);
    if (d > 1) {
      const step = Math.min(d, MALLET_SPEED * 1.25 * dt); // touch slightly faster feels snappier
      m.x += tx / d * step;
      m.y += ty / d * step;
    }
  }
  // bounds: own half + walls
  const minX = idx === 0 ? WALL + MR : W / 2 + MR * 0.5;
  const maxX = idx === 0 ? W / 2 - MR * 0.5 : W - WALL - MR;
  m.x = clamp(m.x, minX, maxX);
  m.y = clamp(m.y, WALL + MR, H - WALL - MR);
  m.vx = (m.x - m.px) / dt;
  m.vy = (m.y - m.py) / dt;
}

function puckWalls() {
  const gy0 = H / 2 - GOAL_H / 2;
  const gy1 = H / 2 + GOAL_H / 2;
  if (puck.y - PR < WALL) { puck.y = WALL + PR; puck.vy = Math.abs(puck.vy); sWall(); }
  if (puck.y + PR > H - WALL) { puck.y = H - WALL - PR; puck.vy = -Math.abs(puck.vy); sWall(); }

  const inMouth = puck.y > gy0 + PR * 0.3 && puck.y < gy1 - PR * 0.3;
  if (puck.x - PR < WALL) {
    if (inMouth) {
      if (puck.x < WALL) { goal(1); return; }
      puck.y = clamp(puck.y, gy0 + PR, gy1 - PR);
    } else {
      puck.x = WALL + PR; puck.vx = Math.abs(puck.vx); sWall();
    }
  }
  if (puck.x + PR > W - WALL) {
    if (inMouth) {
      if (puck.x > W - WALL) { goal(0); return; }
      puck.y = clamp(puck.y, gy0 + PR, gy1 - PR);
    } else {
      puck.x = W - WALL - PR; puck.vx = -Math.abs(puck.vx); sWall();
    }
  }
}

function malletHit(m) {
  const dx = puck.x - m.x, dy = puck.y - m.y;
  const d = Math.hypot(dx, dy);
  const rr = MR + PR;
  if (d >= rr || d === 0) return;
  const nx = dx / d, ny = dy / d;
  puck.x = m.x + nx * rr;
  puck.y = m.y + ny * rr;
  const rvx = puck.vx - m.vx, rvy = puck.vy - m.vy;
  const vn = rvx * nx + rvy * ny;
  if (vn < 0) {
    puck.vx -= 1.9 * vn * nx;
    puck.vy -= 1.9 * vn * ny;
    puck.vx += m.vx * PUNCH;
    puck.vy += m.vy * PUNCH;
    const sp = Math.hypot(puck.vx, puck.vy);
    const ns = Math.min(PUCK_MAX, sp * 1.04 + 20);
    if (sp > 1) { puck.vx *= ns / sp; puck.vy *= ns / sp; }
    sHit(Math.abs(vn));
  }
}

function step(dt) {
  moveMallet(mallets[0], dt, 0);
  moveMallet(mallets[1], dt, 1);

  const speed = Math.hypot(puck.vx, puck.vy);
  const sub = speed > 800 ? 2 : 1;
  const sdt = dt / sub;
  for (let i = 0; i < sub && S.mode === 'live'; i++) {
    puck.x += puck.vx * sdt;
    puck.y += puck.vy * sdt;
    const damp = Math.exp(-FRICTION * sdt);
    puck.vx *= damp; puck.vy *= damp;
    puckWalls();
    malletHit(mallets[0]);
    malletHit(mallets[1]);
  }
}

/* ── demo puck for menu backdrop ── */
function demoStep(dt) {
  S.demoT += dt;
  puck.x += puck.vx * dt;
  puck.y += puck.vy * dt;
  if (Math.hypot(puck.vx, puck.vy) < 1 || S.demoT > 12) {
    S.demoT = 0;
    const a = Math.random() * Math.PI * 2;
    puck.vx = Math.cos(a) * 260;
    puck.vy = Math.sin(a) * 260;
  }
  if (puck.y - PR < WALL) { puck.y = WALL + PR; puck.vy = Math.abs(puck.vy); }
  if (puck.y + PR > H - WALL) { puck.y = H - WALL - PR; puck.vy = -Math.abs(puck.vy); }
  if (puck.x - PR < WALL) { puck.x = WALL + PR; puck.vx = Math.abs(puck.vx); }
  if (puck.x + PR > W - WALL) { puck.x = W - WALL - PR; puck.vx = -Math.abs(puck.vx); }
  for (let i = 0; i < 2; i++) {
    const m = mallets[i];
    const nx = (i === 0 ? W * 0.25 : W * 0.75) + Math.cos(S.demoT * 1.4 + i * 2) * 50;
    const ny = H / 2 + Math.sin(S.demoT * 1.9 + i * 3) * 70;
    m.vx = (nx - m.x) / dt;
    m.vy = (ny - m.y) / dt;
    m.x = nx;
    m.y = ny;
    malletHit(m);
  }
}

/* ── render ── */
function draw() {
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  if (S.shake > 0) {
    ctx.translate((Math.random() - 0.5) * S.shake * 22, (Math.random() - 0.5) * S.shake * 22);
  }

  // rink
  const gy0 = H / 2 - GOAL_H / 2;
  const gy1 = H / 2 + GOAL_H / 2;
  ctx.fillStyle = '#171530';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#1e1b38';
  ctx.fillRect(WALL, WALL, W - WALL * 2, H - WALL * 2);

  // goal mouths
  ctx.fillStyle = 'rgba(255,107,157,.14)';
  ctx.fillRect(0, gy0, WALL, GOAL_H);
  ctx.fillStyle = 'rgba(78,205,196,.14)';
  ctx.fillRect(W - WALL, gy0, WALL, GOAL_H);
  ctx.shadowBlur = 16;
  ctx.shadowColor = C1;
  ctx.fillStyle = C1;
  ctx.fillRect(0, gy0, 5, GOAL_H);
  ctx.shadowColor = C2;
  ctx.fillStyle = C2;
  ctx.fillRect(W - 5, gy0, 5, GOAL_H);
  ctx.shadowBlur = 0;

  // posts
  ctx.fillStyle = '#3a3560';
  [[0, gy0], [0, gy1], [W, gy0], [W, gy1]].forEach(([x, y]) => {
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fill();
  });

  // rink border
  ctx.strokeStyle = '#3a3560';
  ctx.lineWidth = 3;
  ctx.strokeRect(WALL, WALL, W - WALL * 2, H - WALL * 2);

  // center line + circle
  ctx.strokeStyle = 'rgba(138,134,163,.4)';
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 10]);
  ctx.beginPath();
  ctx.moveTo(W / 2, WALL);
  ctx.lineTo(W / 2, H - WALL);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(W / 2, H / 2, 60, 0, Math.PI * 2);
  ctx.stroke();

  // touch hints
  if (S.touchMode) {
    ctx.font = '600 20px "Hiragino Kaku Gothic ProN", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,107,157,.5)';
    if (!S.touched[0]) ctx.fillText('ここをドラッグ', W * 0.25, H * 0.82);
    ctx.fillStyle = 'rgba(78,205,196,.5)';
    if (!S.touched[1]) ctx.fillText('ここをドラッグ', W * 0.75, H * 0.82);
  }

  // puck
  ctx.shadowBlur = 18;
  ctx.shadowColor = '#ffd166';
  ctx.fillStyle = '#ffd166';
  ctx.beginPath();
  ctx.arc(puck.x, puck.y, PR, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,255,255,.65)';
  ctx.beginPath();
  ctx.arc(puck.x - PR * 0.3, puck.y - PR * 0.3, PR * 0.35, 0, Math.PI * 2);
  ctx.fill();

  // mallets
  for (const m of mallets) {
    ctx.shadowBlur = 20;
    ctx.shadowColor = m.color;
    ctx.fillStyle = m.color;
    ctx.beginPath();
    ctx.arc(m.x, m.y, MR, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(15,14,26,.55)';
    ctx.beginPath();
    ctx.arc(m.x, m.y, MR * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(m.x, m.y, MR * 0.55, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/* ── main loop ── */
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  if (S.shake > 0) S.shake = Math.max(0, S.shake - dt * 1.6);

  if (S.paused) {
    draw();
    requestAnimationFrame(frame);
    return;
  }

  switch (S.mode) {
    case 'menu':
      demoStep(dt);
      break;
    case 'count': {
      moveMallet(mallets[0], dt, 0);
      moveMallet(mallets[1], dt, 1);
      const prev = Math.ceil(S.countT / 0.5);
      S.countT -= dt;
      const cur = Math.ceil(S.countT / 0.5);
      if (S.countT <= 0) {
        hideBanner();
        serve(S.serveTo);
        S.mode = 'live';
        sGo();
      } else if (cur !== prev && cur >= 1) {
        setBanner(String(cur), 'count-anim');
        sCount();
      }
      break;
    }
    case 'live':
      step(dt);
      break;
    case 'goal':
      S.goalT -= dt;
      if (S.goalT <= 0) {
        resetPositions();
        startCount(1 - S.lastScorer); // serve toward conceder
      }
      break;
    case 'over':
      demoStep(dt);
      break;
  }
  draw();
  requestAnimationFrame(frame);
}

/* ── wire up ── */
startBtn.addEventListener('click', startGame);
replayBtn.addEventListener('click', restart);
menuBtn.addEventListener('click', toMenu);
pauseBtn.addEventListener('click', () => { enableTouchMode(); togglePause(); });
[input1, input2].forEach(inp => inp.addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.key === 'Enter') startGame();
}));
if (navigator.maxTouchPoints > 0 || 'ontouchstart' in window) enableTouchMode();
requestAnimationFrame(frame);
