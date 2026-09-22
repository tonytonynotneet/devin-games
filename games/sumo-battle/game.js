'use strict';
/* 相撲押し出しバトル — 2人対戦・土俵押し出しゲーム */

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);

const startScreen = $('startScreen');
const endScreen = $('endScreen');
const winnerText = $('winnerText');
const finalScore = $('finalScore');
const loserNote = $('loserNote');
const startBtn = $('startBtn');
const rematchBtn = $('rematchBtn');
const renameBtn = $('renameBtn');
const name1El = $('name1');
const name2El = $('name2');
const muteBtn = $('muteBtn');
const touchToggle = $('touchToggle');

const WIN_ROUNDS = 3;

/* ---------- サイズ / レスポンシブ ---------- */
let W = 0, H = 0, dpr = 1;
let cx = 0, cy = 0, dohyoR = 200, wr = 24;
let portrait = false;

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  portrait = H > W;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cx = W / 2;
  cy = H * 0.55;
  dohyoR = Math.min(W, H) * (touchMode ? 0.30 : 0.33);
  wr = dohyoR * 0.115;
  layoutTouch();
}
window.addEventListener('resize', resize);

/* ---------- サウンド ---------- */
let AC = null, muted = false;
function ac() {
  if (muted) return null;
  if (!AC) {
    try { AC = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (e) { return null; }
  }
  if (AC.state === 'suspended') AC.resume();
  return AC;
}
function tone(freq, dur, type = 'sine', vol = 0.18, slideTo = null, delay = 0) {
  const a = ac(); if (!a) return;
  const t = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t); o.stop(t + dur + 0.05);
}
function noiseBurst(dur, vol = 0.25, freq = 800, delay = 0) {
  const a = ac(); if (!a) return;
  const t = a.currentTime + delay;
  const n = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, n, a.sampleRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < n; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = a.createBufferSource(); src.buffer = buf;
  const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
  const g = a.createGain(); g.gain.value = vol;
  src.connect(f).connect(g).connect(a.destination);
  src.start(t);
}
const sfx = {
  click:   () => tone(700, 0.06, 'square', 0.1),
  count:   () => tone(880, 0.09, 'sine', 0.2),
  go:      () => { tone(660, 0.1, 'sine', 0.22); tone(1320, 0.22, 'sine', 0.2, null, 0.09); },
  dash:    () => noiseBurst(0.22, 0.2, 2400),
  bump:    (s = 1) => { noiseBurst(0.1, Math.min(0.3, 0.1 + s * 0.2), 500 + s * 400); tone(90 + s * 40, 0.12, 'sine', 0.25); },
  clinch:  () => { tone(160, 0.25, 'sawtooth', 0.12, 220); },
  shove:   () => { noiseBurst(0.18, 0.3, 1200); tone(120, 0.2, 'square', 0.15, 60); },
  ringout: () => { tone(300, 0.15, 'square', 0.15, 200); },
  win:     () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.16, 'triangle', 0.2, null, i * 0.11)); },
};

/* ---------- プレイヤー ---------- */
function mkPlayer(color, dark) {
  return {
    name: '', color, dark,
    x: 0, y: 0, vx: 0, vy: 0,
    face: 0, wins: 0,
    inK: { x: 0, y: 0 },        // キーボード入力
    inT: { x: 0, y: 0 },        // タッチ入力
    dashQ: false,               // 突っ張り要求
    dashCD: 0, dashT: 0,
    squash: 0, flash: 0,
    joy: { id: null, ax: 0, ay: 0, dx: 0, dy: 0 },
    dashBtn: { x: 0, y: 0, r: 0 },
  };
}
const players = [mkPlayer('#ff5d5d', '#b03a3a'), mkPlayer('#4ecdc4', '#2b8a83')];

/* ---------- ゲーム状態 ---------- */
let state = 'start';       // start | countdown | fight | roundend
let countT = 0, roundEndT = 0, roundWinner = -1, roundDraw = false;
let contactT = -1;         // 接触継続時間（負=再接触クールダウン）
let clinch = false, clinchT = 0, advantage = 0;
let shake = 0;
let particles = [];
let touchMode = false;
let matchOver = false;

/* ---------- 入力: キーボード ---------- */
const keys = new Set();
const KEYMAP = {
  KeyW: [0, 'y', -1], KeyA: [0, 'x', -1], KeyS: [0, 'y', 1], KeyD: [0, 'x', 1],
  ArrowUp: [1, 'y', -1], ArrowLeft: [1, 'x', -1], ArrowDown: [1, 'y', 1], ArrowRight: [1, 'x', 1],
};
const DASH_KEYS = { KeyF: 0, Space: 0, Enter: 1, ShiftRight: 1 };

window.addEventListener('keydown', (e) => {
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA') {
    if (e.code === 'Enter') { e.preventDefault(); tryStart(); }
    return;
  }
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Enter'].includes(e.code)) {
    e.preventDefault();
  }
  if (e.code === 'KeyM') { toggleMute(); return; }
  if (e.repeat) return;
  keys.add(e.code);
  if (DASH_KEYS[e.code] !== undefined) players[DASH_KEYS[e.code]].dashQ = true;
  if ((e.code === 'Enter' || e.code === 'Space') && state === 'start' && !startScreen.classList.contains('hidden')) tryStart();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

function readKeyboard() {
  for (const p of players) { p.inK.x = 0; p.inK.y = 0; }
  for (const code of keys) {
    const m = KEYMAP[code];
    if (!m) continue;
    const p = players[m[0]];
    p.inK[m[1]] += m[2];
  }
  for (const p of players) {
    const l = Math.hypot(p.inK.x, p.inK.y);
    if (l > 1) { p.inK.x /= l; p.inK.y /= l; }
  }
}

/* ---------- 入力: タッチ ---------- */
function detectTouch() {
  return ('ontouchstart' in window) || navigator.maxTouchPoints > 0 ||
    new URLSearchParams(location.search).has('touch');
}
function layoutTouch() {
  if (!touchMode) return;
  const r = Math.max(46, Math.min(W, H) * 0.075);
  const m = Math.max(18, Math.min(W, H) * 0.035);
  if (portrait) {
    players[0].dashBtn = { x: W - m - r, y: H - m - r, r };
    players[1].dashBtn = { x: m + r, y: m + r, r };
  } else {
    players[0].dashBtn = { x: m + r, y: H - m - r, r };
    players[1].dashBtn = { x: W - m - r, y: H - m - r, r };
  }
}
function zoneOf(x, y) {
  // P1=0, P2=1。縦画面: P1下半分 / P2上半分。横画面: P1左半分 / P2右半分。
  if (portrait) return y > H / 2 ? 0 : 1;
  return x < W / 2 ? 0 : 1;
}
function touchPos(t) {
  const r = canvas.getBoundingClientRect();
  return { x: t.clientX - r.left, y: t.clientY - r.top };
}
canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    const { x, y } = touchPos(t);
    const i = zoneOf(x, y);
    const p = players[i];
    const b = p.dashBtn;
    if (Math.hypot(x - b.x, y - b.y) <= b.r * 1.15) {
      p.dashQ = true;
      continue;
    }
    if (p.joy.id === null) {
      p.joy.id = t.identifier;
      p.joy.ax = x; p.joy.ay = y; p.joy.dx = 0; p.joy.dy = 0;
    }
  }
}, { passive: false });
canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    for (const p of players) {
      if (p.joy.id === t.identifier) {
        const { x, y } = touchPos(t);
        const R = Math.min(W, H) * 0.09;
        let dx = x - p.joy.ax, dy = y - p.joy.ay;
        const l = Math.hypot(dx, dy);
        if (l > R) { dx = dx / l * R; dy = dy / l * R; }
        p.joy.dx = dx / R; p.joy.dy = dy / R;
      }
    }
  }
}, { passive: false });
function endTouch(e) {
  e.preventDefault();
  for (const t of e.changedTouches) {
    for (const p of players) {
      if (p.joy.id === t.identifier) { p.joy.id = null; p.joy.dx = 0; p.joy.dy = 0; }
    }
  }
}
canvas.addEventListener('touchend', endTouch, { passive: false });
canvas.addEventListener('touchcancel', endTouch, { passive: false });
// タッチ検出で自動 ON
window.addEventListener('touchstart', () => setTouchMode(true), { once: true, passive: true });

function setTouchMode(on) {
  if (touchMode === on) return;
  touchMode = on;
  touchToggle.classList.toggle('on', on);
  resize();
}
touchToggle.addEventListener('click', () => { sfx.click(); setTouchMode(!touchMode); });

/* ---------- 物理 ---------- */
function resetPositions() {
  const gap = dohyoR * 0.42;
  players[0].x = cx - gap; players[0].y = cy; players[0].face = 0;
  players[1].x = cx + gap; players[1].y = cy; players[1].face = Math.PI;
  for (const p of players) {
    p.vx = p.vy = 0; p.dashCD = 0; p.dashT = 0; p.squash = 0; p.flash = 0;
    p.dashQ = false;
  }
  contactT = -1; clinch = false; clinchT = 0; advantage = 0;
  particles = [];
}

function startRound() {
  resetPositions();
  state = 'countdown';
  countT = 0;
  sfx.count();
}

function inputVec(p) {
  let x = p.inK.x + p.inT.x, y = p.inK.y + p.inT.y;
  const l = Math.hypot(x, y);
  if (l > 1) { x /= l; y /= l; }
  return { x, y };
}

function update(dt) {
  for (const p of players) {
    p.inT.x = p.joy.id !== null ? p.joy.dx : 0;
    p.inT.y = p.joy.id !== null ? p.joy.dy : 0;
    p.dashCD = Math.max(0, p.dashCD - dt);
    p.dashT = Math.max(0, p.dashT - dt);
    p.squash *= Math.exp(-8 * dt);
    p.flash = Math.max(0, p.flash - dt * 3);
  }
  shake = Math.max(0, shake - dt * 26);
  updateParticles(dt);

  if (state === 'countdown') {
    countT += dt;
    if (countT > 1.9) { state = 'fight'; sfx.go(); }
    return;
  }
  if (state === 'roundend') {
    roundEndT += dt;
    if (roundEndT > 1.9) {
      if (matchOver) { showEnd(); state = 'start'; }
      else startRound();
    }
    return;
  }
  if (state !== 'fight') return;

  const [p1, p2] = players;
  const ACC = dohyoR * 6.5;
  const MAXV = dohyoR * 1.55;
  const DASHV = dohyoR * 2.7;
  const PUSHF = dohyoR * 3.4;

  for (const p of players) {
    const iv = inputVec(p);
    if (iv.x || iv.y) p.face = Math.atan2(iv.y, iv.x);
    // 突っ張り（ダッシュ）
    if (p.dashQ) {
      p.dashQ = false;
      if (p.dashCD <= 0) {
        const a = (iv.x || iv.y) ? Math.atan2(iv.y, iv.x) : p.face;
        if (clinch) {
          // 組み合い中: 一発押し（両者に同じインパルス）
          const ix = Math.cos(a) * DASHV * 0.9, iy = Math.sin(a) * DASHV * 0.9;
          p1.vx += ix; p1.vy += iy; p2.vx += ix; p2.vy += iy;
          sfx.shove(); shake += 5;
          spawnBurst((p1.x + p2.x) / 2, (p1.y + p2.y) / 2, p.color, 14);
        } else {
          p.vx += Math.cos(a) * DASHV;
          p.vy += Math.sin(a) * DASHV;
          p.dashT = 0.32; p.squash = -0.35;
          sfx.dash();
          spawnDust(p);
        }
        p.dashCD = 1.4;
      }
    }
    if (!clinch) {
      p.vx += iv.x * ACC * dt;
      p.vy += iv.y * ACC * dt;
      p.vx *= Math.exp(-3.6 * dt);
      p.vy *= Math.exp(-3.6 * dt);
      const sp = Math.hypot(p.vx, p.vy);
      const cap = p.dashT > 0 ? MAXV * 2.2 : MAXV;
      if (sp > cap) { p.vx = p.vx / sp * cap; p.vy = p.vy / sp * cap; }
    }
  }

  // ---- 衝突 ----
  let dx = p2.x - p1.x, dy = p2.y - p1.y;
  let dist = Math.hypot(dx, dy) || 0.001;
  const minD = wr * 2;
  const touching = dist < minD + 1.5;
  const engaged = dist < minD + wr * 0.8; // 組み合い判定は近接で見る

  if (touching && !clinch) {
    const nx = dx / dist, ny = dy / dist;
    const overlap = minD - dist;
    // 質量: 突っ張り中は重い
    const m1 = p1.dashT > 0 ? 2.2 : 1, m2 = p2.dashT > 0 ? 2.2 : 1;
    const tot = m1 + m2;
    if (overlap > 0) {
      p1.x -= nx * overlap * (m2 / tot); p1.y -= ny * overlap * (m2 / tot);
      p2.x += nx * overlap * (m1 / tot); p2.y += ny * overlap * (m1 / tot);
      // 速度インパルス
      const rvx = p2.vx - p1.vx, rvy = p2.vy - p1.vy;
      const rel = rvx * nx + rvy * ny;
      if (rel < 0) {
        const j = -(1 + 0.2) * rel / (1 / m1 + 1 / m2);
        p1.vx -= j * nx / m1; p1.vy -= j * ny / m1;
        p2.vx += j * nx / m2; p2.vy += j * ny / m2;
        const imp = Math.abs(rel) / (dohyoR * 1.5);
        if (imp > 0.35) {
          sfx.bump(Math.min(1, imp));
          shake += Math.min(9, imp * 10);
          spawnBurst((p1.x + p2.x) / 2, (p1.y + p2.y) / 2, '#ffd166', Math.floor(6 + imp * 12));
          p1.flash = p2.flash = 0.6;
          p1.squash = p2.squash = 0.3;
        }
      }
      // 継続押し: 相手方向に入力していると押す力
      for (const [self, opp, sgn] of [[p1, p2, 1], [p2, p1, -1]]) {
        const iv = inputVec(self);
        const d = iv.x * nx * sgn + iv.y * ny * sgn; // 相手側へ押す成分
        if (d > 0) {
          const f = PUSHF * d * (self.dashT > 0 ? 2.3 : 1);
          opp.vx += nx * sgn * f * dt;
          opp.vy += ny * sgn * f * dt;
        }
      }
    }
    contactT += dt;
    if (contactT > 0.6) {
      clinch = true; clinchT = 0;
      sfx.clinch();
      spawnBurst((p1.x + p2.x) / 2, (p1.y + p2.y) / 2, '#ffffff', 10);
    }
  } else if (!clinch && engaged) {
    // 近くにいるだけでも組み合いゲージは溜まる
    contactT += dt;
    if (contactT > 0.6) {
      clinch = true; clinchT = 0;
      sfx.clinch();
      spawnBurst((p1.x + p2.x) / 2, (p1.y + p2.y) / 2, '#ffffff', 10);
    }
  } else if (!touching && !engaged) {
    if (clinch) clinch = false;
    contactT = -0.35;
  }

  // ---- 組み合い ----
  if (clinch) {
    clinchT += dt;
    dx = p2.x - p1.x; dy = p2.y - p1.y; dist = Math.hypot(dx, dy) || 0.001;
    const nx = dx / dist, ny = dy / dist;
    // 固めて一体化: 距離を minD に保つ
    const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
    p1.x = mx - nx * wr; p1.y = my - ny * wr;
    p2.x = mx + nx * wr; p2.y = my + ny * wr;
    // ペア速度 = 平均
    let pvx = (p1.vx + p2.vx) / 2, pvy = (p1.vy + p2.vy) / 2;
    const CF = dohyoR * 7.5;
    const i1 = inputVec(p1), i2 = inputVec(p2);
    pvx += (i1.x + i2.x) * CF * dt / 2;
    pvy += (i1.y + i2.y) * CF * dt / 2;
    pvx *= Math.exp(-2.6 * dt); pvy *= Math.exp(-2.6 * dt);
    const sp = Math.hypot(pvx, pvy), cap = dohyoR * 1.1;
    if (sp > cap) { pvx = pvx / sp * cap; pvy = pvy / sp * cap; }
    p1.vx = p2.vx = pvx; p1.vy = p2.vy = pvy;
    // 優勢ゲージ: ペアがどちら側へ動いているか
    const advT = Math.max(-1, Math.min(1, (pvx * nx + pvy * ny) / (dohyoR * 0.5)));
    advantage += (advT - advantage) * 5 * dt;
    // 組み合い中は向き合ったまま
    p1.face = Math.atan2(ny, nx);
    p2.face = Math.atan2(-ny, -nx);
    if (clinchT > 3.0) {
      clinch = false; contactT = -0.5;
      // 小さく離れる
      p1.vx -= nx * dohyoR * 0.8; p1.vy -= ny * dohyoR * 0.8;
      p2.vx += nx * dohyoR * 0.8; p2.vy += ny * dohyoR * 0.8;
      noiseBurst(0.12, 0.15, 900);
    }
  } else {
    advantage *= Math.exp(-6 * dt);
  }

  // 位置更新
  for (const p of players) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    // 画面外に飛ばないよう軽く制限
    p.x = Math.max(-wr * 3, Math.min(W + wr * 3, p.x));
    p.y = Math.max(-wr * 3, Math.min(H + wr * 3, p.y));
    if (!clinch && (p.vx || p.vy) && Math.hypot(p.vx, p.vy) > dohyoR * 0.2) {
      p.face = Math.atan2(p.vy, p.vx);
    }
  }

  // ---- 土俵外判定 ----
  const out1 = Math.hypot(p1.x - cx, p1.y - cy) > dohyoR;
  const out2 = Math.hypot(p2.x - cx, p2.y - cy) > dohyoR;
  if (out1 || out2) {
    if (out1 && out2) { roundDraw = true; roundWinner = -1; }
    else { roundDraw = false; roundWinner = out1 ? 1 : 0; }
    if (!roundDraw) {
      players[roundWinner].wins++;
      matchOver = players[roundWinner].wins >= WIN_ROUNDS;
      if (matchOver) sfx.win(); else sfx.ringout();
      spawnBurst(players[roundWinner].x, players[roundWinner].y, players[roundWinner].color, 24);
    } else {
      sfx.ringout();
    }
    state = 'roundend'; roundEndT = 0; clinch = false;
    shake += 6;
  }
}

/* ---------- パーティクル ---------- */
function spawnDust(p) {
  for (let i = 0; i < 8; i++) {
    const a = p.face + Math.PI + (Math.random() - 0.5) * 1.2;
    const s = dohyoR * (0.5 + Math.random() * 1.2);
    particles.push({
      x: p.x - Math.cos(p.face) * wr, y: p.y - Math.sin(p.face) * wr,
      vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      life: 0.45 + Math.random() * 0.2, t: 0,
      size: 3 + Math.random() * 4, color: '#cbb98d',
    });
  }
}
function spawnBurst(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = dohyoR * (0.4 + Math.random() * 1.6);
    particles.push({
      x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      life: 0.4 + Math.random() * 0.4, t: 0,
      size: 2 + Math.random() * 5, color,
    });
  }
}
function updateParticles(dt) {
  for (const q of particles) {
    q.t += dt;
    q.x += q.vx * dt; q.y += q.vy * dt;
    q.vx *= Math.exp(-4 * dt); q.vy *= Math.exp(-4 * dt);
  }
  particles = particles.filter((q) => q.t < q.life);
}

/* ---------- 描画 ---------- */
function draw() {
  ctx.clearRect(0, 0, W, H);
  // 背景
  const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H));
  bg.addColorStop(0, '#241c38');
  bg.addColorStop(1, '#100c1c');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  if (shake > 0.3) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);

  drawDohyo();
  drawParticles();

  // 力士（P2を先に描いてP1を手前に）
  drawRikishi(players[1]);
  drawRikishi(players[0]);

  drawHUD();
  if (touchMode) drawTouchUI();
  if (state === 'countdown') drawCountdown();
  if (state === 'roundend') drawRoundEnd();

  ctx.restore();
}

function drawDohyo() {
  // 俵（わら）リング
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, dohyoR + wr * 0.55, 0, Math.PI * 2);
  ctx.fillStyle = '#7a5c36';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, dohyoR + wr * 0.35, 0, Math.PI * 2);
  ctx.fillStyle = '#a5825a';
  ctx.fill();
  // 俵の筋
  ctx.strokeStyle = 'rgba(60,42,20,.5)';
  ctx.lineWidth = 2;
  const n = 28;
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx, cy, dohyoR + wr * 0.45, a, a + Math.PI / n * 0.7);
    ctx.stroke();
  }
  // 粘土面
  const clay = ctx.createRadialGradient(cx, cy - dohyoR * 0.15, dohyoR * 0.1, cx, cy, dohyoR);
  clay.addColorStop(0, '#d9b77c');
  clay.addColorStop(0.75, '#c9a367');
  clay.addColorStop(1, '#b8935a');
  ctx.beginPath();
  ctx.arc(cx, cy, dohyoR, 0, Math.PI * 2);
  ctx.fillStyle = clay;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.35)';
  ctx.lineWidth = 3;
  ctx.stroke();
  // 仕切り線
  ctx.strokeStyle = 'rgba(255,255,255,.8)';
  ctx.lineWidth = Math.max(3, wr * 0.16);
  const sl = wr * 1.1;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + s * wr * 1.6 - sl / 2, cy);
    ctx.lineTo(cx + s * wr * 1.6 + sl / 2, cy);
    ctx.stroke();
  }
  ctx.restore();
}

function drawRikishi(p) {
  const dashing = p.dashT > 0;
  ctx.save();
  ctx.translate(p.x, p.y);
  // 突っ張りの伸縮 + 衝撃のつぶれ
  const stretch = dashing ? 1.18 : 1 - Math.max(-0.3, Math.min(0.3, p.squash));
  ctx.rotate(p.face);
  ctx.scale(stretch, 1 / Math.sqrt(stretch));

  // 体
  const grad = ctx.createRadialGradient(-wr * 0.3, -wr * 0.3, wr * 0.2, 0, 0, wr);
  grad.addColorStop(0, '#f8d7b0');
  grad.addColorStop(1, '#e0a86f');
  ctx.beginPath();
  ctx.arc(0, 0, wr, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.lineWidth = wr * 0.09;
  ctx.strokeStyle = '#7a4b2a';
  ctx.stroke();

  // まわし（背中側の帯）
  ctx.beginPath();
  ctx.arc(0, 0, wr * 0.82, Math.PI * 0.55, Math.PI * 1.45);
  ctx.strokeStyle = p.color;
  ctx.lineWidth = wr * 0.34;
  ctx.stroke();
  // まわしの締め込み
  ctx.beginPath();
  ctx.arc(-wr * 0.8, 0, wr * 0.22, 0, Math.PI * 2);
  ctx.fillStyle = p.dark;
  ctx.fill();

  // 目（前側）
  ctx.fillStyle = '#2b1d12';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(wr * 0.45, s * wr * 0.3, wr * 0.075, 0, Math.PI * 2);
    ctx.fill();
  }
  // まげ
  ctx.beginPath();
  ctx.arc(wr * 0.1, 0, wr * 0.16, 0, Math.PI * 2);
  ctx.fillStyle = '#241a12';
  ctx.fill();

  if (p.flash > 0) {
    ctx.globalAlpha = Math.min(0.6, p.flash);
    ctx.beginPath();
    ctx.arc(0, 0, wr, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  // 突っ張りクールダウンリング
  if (state === 'fight' || state === 'roundend') {
    ctx.save();
    ctx.beginPath();
    if (p.dashCD <= 0) {
      ctx.strokeStyle = 'rgba(255,255,255,.0)';
    } else {
      ctx.arc(p.x, p.y, wr + 7, -Math.PI / 2, -Math.PI / 2 + (1 - p.dashCD / 1.4) * Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,.65)';
      ctx.lineWidth = 4;
      ctx.stroke();
    }
    ctx.restore();
  }

  // 名前ラベル
  ctx.save();
  ctx.font = `700 ${Math.max(11, wr * 0.42)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(0,0,0,.55)';
  ctx.strokeText(p.name, p.x, p.y - wr - 10);
  ctx.fillStyle = p.color;
  ctx.fillText(p.name, p.x, p.y - wr - 10);
  ctx.restore();
}

function drawParticles() {
  for (const q of particles) {
    const a = 1 - q.t / q.life;
    ctx.globalAlpha = a;
    ctx.beginPath();
    ctx.arc(q.x, q.y, q.size * (0.5 + a * 0.5), 0, Math.PI * 2);
    ctx.fillStyle = q.color;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function stars(n) {
  let s = '';
  for (let i = 0; i < WIN_ROUNDS; i++) s += i < n ? '★' : '☆';
  return s;
}

function drawHUD() {
  const fs = Math.max(15, Math.min(26, W * 0.03));
  ctx.save();
  ctx.font = `800 ${fs}px sans-serif`;
  ctx.textBaseline = 'middle';
  // P1 左
  ctx.textAlign = 'left';
  ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,.5)';
  ctx.strokeText(players[0].name, 18, 30);
  ctx.fillStyle = players[0].color;
  ctx.fillText(players[0].name, 18, 30);
  ctx.font = `${fs * 0.85}px sans-serif`;
  ctx.fillStyle = '#ffd166';
  ctx.fillText(stars(players[0].wins), 18, 30 + fs);
  // P2 右
  ctx.font = `800 ${fs}px sans-serif`;
  ctx.textAlign = 'right';
  ctx.strokeText(players[1].name, W - 18, 30);
  ctx.fillStyle = players[1].color;
  ctx.fillText(players[1].name, W - 18, 30);
  ctx.font = `${fs * 0.85}px sans-serif`;
  ctx.fillStyle = '#ffd166';
  ctx.fillText(stars(players[1].wins), W - 18, 30 + fs);
  // 中央
  ctx.textAlign = 'center';
  ctx.font = `700 ${fs * 0.7}px sans-serif`;
  ctx.fillStyle = 'rgba(240,235,255,.75)';
  ctx.fillText(`First to ${WIN_ROUNDS}`, cx, 30);

  // 組み合いゲージ
  if (clinch || Math.abs(advantage) > 0.03) {
    const bw = Math.min(300, W * 0.5), bh = 16;
    const bx = cx - bw / 2, by = H - 34;
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    roundRect(bx - 8, by - 26, bw + 16, bh + 34, 12);
    ctx.fill();
    ctx.fillStyle = 'rgba(240,235,255,.85)';
    ctx.font = `700 ${fs * 0.62}px sans-serif`;
    ctx.fillText('CLINCH!', cx, by - 14);
    // バー
    ctx.fillStyle = players[0].color;
    roundRect(bx, by, bw / 2, bh, 8); ctx.fill();
    ctx.fillStyle = players[1].color;
    roundRect(bx + bw / 2, by, bw / 2, bh, 8); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.3)';
    roundRect(bx, by, bw, bh, 8); ctx.fill();
    // マーカー
    const mx = bx + bw / 2 + advantage * (bw / 2 - 6);
    ctx.beginPath();
    ctx.arc(mx, by + bh / 2, 11, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,.4)';
    ctx.stroke();
  }
  ctx.restore();
}

function drawCountdown() {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const t = countT;
  let txt = 'Ready…';
  if (t > 1.0) txt = 'GO!';
  const fs = Math.min(64, W * 0.09);
  ctx.font = `900 ${fs}px sans-serif`;
  const pop = 1 + Math.max(0, 0.25 - (t % 1)) * 1.6;
  ctx.translate(cx, cy - dohyoR * 0.05);
  ctx.scale(pop, pop);
  ctx.lineWidth = 8;
  ctx.strokeStyle = 'rgba(0,0,0,.6)';
  ctx.strokeText(txt, 0, 0);
  ctx.fillStyle = t > 1.0 ? '#ffd166' : '#fff';
  ctx.fillText(txt, 0, 0);
  ctx.restore();
}

function drawRoundEnd() {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const fs = Math.min(52, W * 0.075);
  ctx.font = `900 ${fs}px sans-serif`;
  ctx.translate(cx, cy);
  let txt;
  if (roundDraw) {
    txt = 'Do-over!';
    ctx.fillStyle = '#ffd166';
  } else {
    const p = players[roundWinner];
    txt = `${p.name} scores!`;
    ctx.fillStyle = p.color;
  }
  const s = 1 + Math.max(0, 0.3 - roundEndT) * 1.4;
  ctx.scale(s, s);
  ctx.lineWidth = 9;
  ctx.strokeStyle = 'rgba(0,0,0,.65)';
  ctx.strokeText(txt, 0, 0);
  ctx.fillText(txt, 0, 0);
  ctx.restore();
}

function drawTouchUI() {
  const fs = Math.max(12, Math.min(W, H) * 0.03);
  for (let i = 0; i < 2; i++) {
    const p = players[i];
    const flip = portrait && i === 1; // 上側は向こう向き
    ctx.save();
    // ゾーン枠とラベル
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = p.color;
    if (portrait) ctx.fillRect(0, i === 0 ? H / 2 : 0, W, H / 2);
    else ctx.fillRect(i === 0 ? 0 : W / 2, 0, W / 2, H);
    ctx.globalAlpha = 1;
    // 中央分割線
    ctx.strokeStyle = 'rgba(255,255,255,.25)';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    if (portrait) { ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); }
    else { ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); }
    ctx.stroke();
    ctx.setLineDash([]);

    // 突っ張りボタン
    const b = p.dashBtn;
    const ready = p.dashCD <= 0;
    ctx.save();
    if (flip) { ctx.translate(b.x, b.y); ctx.rotate(Math.PI); ctx.translate(-b.x, -b.y); }
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fillStyle = ready ? p.color : 'rgba(120,115,140,.55)';
    ctx.globalAlpha = ready ? 0.85 : 0.5;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,.5)';
    ctx.stroke();
    if (!ready) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r - 5, -Math.PI / 2, -Math.PI / 2 + (1 - p.dashCD / 1.4) * Math.PI * 2);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 4;
      ctx.stroke();
    }
    ctx.fillStyle = '#1a1428';
    ctx.font = `900 ${b.r * 0.42}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('PUSH', b.x, b.y - b.r * 0.18);
    ctx.font = `700 ${b.r * 0.22}px sans-serif`;
    ctx.fillText(clinch ? 'SHOVE!' : 'thrust', b.x, b.y + b.r * 0.3);
    ctx.restore();

    // ジョイスティック
    if (p.joy.id !== null) {
      const R = Math.min(W, H) * 0.09;
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.arc(p.joy.ax, p.joy.ay, R, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(p.joy.ax + p.joy.dx * R, p.joy.ay + p.joy.dy * R, R * 0.45, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // ゾーン説明
    ctx.font = `700 ${fs}px sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    ctx.textAlign = 'center';
    const lx = portrait ? W / 2 : (i === 0 ? W * 0.25 : W * 0.75);
    const ly = portrait ? (i === 0 ? H - fs * 2.2 : fs * 2.6) : H * 0.5 + dohyoR + fs * 2;
    ctx.save();
    if (flip) { ctx.translate(lx, ly); ctx.rotate(Math.PI); ctx.translate(-lx, -ly); }
    ctx.fillText(`${p.name} zone — drag to move`, lx, ly);
    ctx.restore();
    ctx.restore();
  }
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ---------- 画面遷移 ---------- */
function sanitize(v, fallback) {
  const s = (v || '').trim().slice(0, 12);
  return s || fallback;
}
function tryStart() {
  if (startScreen.classList.contains('hidden')) return;
  players[0].name = sanitize(name1El.value, 'Player 1');
  players[1].name = sanitize(name2El.value, 'Player 2');
  players[0].wins = players[1].wins = 0;
  matchOver = false;
  startScreen.classList.add('hidden');
  endScreen.classList.add('hidden');
  if (document.activeElement) document.activeElement.blur();
  sfx.click();
  startRound();
}
function showEnd() {
  const w = players[roundWinner];
  winnerText.textContent = `${w.name} wins!`;
  winnerText.style.color = w.color;
  finalScore.textContent = `${players[0].name} ${players[0].wins} – ${players[1].wins} ${players[1].name}`;
  loserNote.textContent = `${players[1 - roundWinner].name} — so close… ☹️`;
  endScreen.classList.remove('hidden');
}
startBtn.addEventListener('click', tryStart);
rematchBtn.addEventListener('click', () => {
  sfx.click();
  players[0].wins = players[1].wins = 0;
  matchOver = false;
  endScreen.classList.add('hidden');
  if (document.activeElement) document.activeElement.blur();
  startRound();
});
renameBtn.addEventListener('click', () => {
  sfx.click();
  endScreen.classList.add('hidden');
  startScreen.classList.remove('hidden');
  state = 'start';
});
function toggleMute() {
  muted = !muted;
  muteBtn.textContent = muted ? '🔇' : '🔊';
  muteBtn.classList.toggle('on', muted);
}
muteBtn.addEventListener('click', toggleMute);

// マウス/タッチでの「つづける」用: roundend中タップで早送り
canvas.addEventListener('pointerdown', () => {
  if (state === 'roundend' && roundEndT > 0.4) roundEndT = 1.9;
});

/* ---------- ループ ---------- */
let last = 0;
function loop(ts) {
  const dt = Math.min(0.033, (ts - last) / 1000 || 0.016);
  last = ts;
  readKeyboard();
  update(dt);
  draw();
  requestAnimationFrame(loop);
}

/* ---------- 起動 ---------- */
touchMode = detectTouch();
touchToggle.classList.toggle('on', touchMode);
resize();
players[0].name = sanitize(name1El.value, 'Player 1');
players[1].name = sanitize(name2El.value, 'Player 2');
resetPositions();
requestAnimationFrame(loop);
