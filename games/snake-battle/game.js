(() => {
'use strict';

/* ================= 設定 ================= */
const COLS = 40, ROWS = 30, CELL = 20;
const NORMAL_INTERVAL = 105;   // 通常速度 (ms/マス)
const BOOST_INTERVAL  = 58;    // ダッシュ速度
const BOOST_MAX = 100;
const BOOST_DRAIN = 55;        // 毎秒
const BOOST_REGEN = 26;
const WIN_ROUNDS = 3;
const COUNTDOWN_MS = 2400;
const ROUNDEND_MS  = 1900;

const COL_P1 = '#4ecdc4', GLOW_P1 = '#7ff2ea';
const COL_P2 = '#ff6b9d', GLOW_P2 = '#ffa1c2';

/* ================= DOM ================= */
const $ = (id) => document.getElementById(id);
const canvas = $('game');
const ctx = canvas.getContext('2d');
canvas.width = COLS * CELL;
canvas.height = ROWS * CELL;

const scrStart = $('screen-start'), scrGame = $('screen-game');
const overlay = $('overlay'), ovMain = $('overlay-main'),
      ovSub = $('overlay-sub'), ovBtns = $('overlay-btns');
const hudName = [$('hud-name1'), $('hud-name2')];
const pipsEl  = [$('pips1'), $('pips2')];
const boostEl = [$('boost1'), $('boost2')];
const roundLabel = $('round-label');

/* 軌跡はオフスクリーンに1回ずつ描き足す（毎フレーム全描画しない） */
const trailCv = document.createElement('canvas');
trailCv.width = canvas.width; trailCv.height = canvas.height;
const trailCtx = trailCv.getContext('2d');

/* ================= 状態 ================= */
const DIR = {
  up:    { x: 0, y: -1 },
  down:  { x: 0, y:  1 },
  left:  { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

let state = 'title';           // title | countdown | play | roundend | matchend
let paused = false;
let grid = new Uint8Array(COLS * ROWS);
let players = [];
let round = 1;
let countdownT = 0, lastCount = -1;
let roundEndT = 0;
let particles = [];
let shakeT = 0;
const boostHeld = [false, false];

function makePlayers() {
  const names = getNames();
  return [
    { id: 0, name: names[0], color: COL_P1, glow: GLOW_P1,
      x: 8, y: (ROWS >> 1), dir: DIR.right, queue: [],
      alive: true, boost: BOOST_MAX, boosting: false, moveAcc: 0, score: 0 },
    { id: 1, name: names[1], color: COL_P2, glow: GLOW_P2,
      x: COLS - 9, y: (ROWS >> 1), dir: DIR.left, queue: [],
      alive: true, boost: BOOST_MAX, boosting: false, moveAcc: 0, score: 0 },
  ];
}

function getNames() {
  const n1 = $('name1').value.trim() || $('name1').placeholder || 'Player 1';
  const n2 = $('name2').value.trim() || $('name2').placeholder || 'Player 2';
  return [n1, n2];
}

function renderPips() {
  players.forEach((p, i) => {
    pipsEl[i].innerHTML = '';
    for (let k = 0; k < WIN_ROUNDS; k++) {
      const d = document.createElement('span');
      d.className = 'pip' + (k < p.score ? ' won' : '');
      pipsEl[i].appendChild(d);
    }
  });
}

/* ================= サウンド ================= */
let AC = null;
function audio() {
  if (!AC) {
    try { AC = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (e) { AC = null; }
  }
  if (AC && AC.state === 'suspended') AC.resume();
  return AC;
}
function tone(freq, dur, type = 'square', vol = 0.05, slideTo = null, when = 0) {
  const ac = audio(); if (!ac) return;
  const t = ac.currentTime + when;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ac.destination);
  o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur = 0.3, vol = 0.15) {
  const ac = audio(); if (!ac) return;
  const len = (ac.sampleRate * dur) | 0;
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const s = ac.createBufferSource(); s.buffer = buf;
  const g = ac.createGain();
  g.gain.setValueAtTime(vol, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
  s.connect(g).connect(ac.destination); s.start();
}
const sfxTurn   = () => tone(320, .04, 'square', .02);
const sfxTick   = () => tone(520, .09, 'sine', .06);
const sfxGo     = () => tone(880, .18, 'sine', .09);
const sfxBoost  = () => tone(180, .08, 'sawtooth', .025, 320);
const sfxCrash  = () => { noise(.35, .18); tone(140, .4, 'sawtooth', .09, 40); };
const sfxWin    = () => [523, 659, 784, 1046].forEach((f, i) => tone(f, .16, 'triangle', .07, null, i * .13));
const sfxDraw   = () => { tone(300, .2, 'sine', .06); tone(300, .2, 'sine', .06, null, .25); };

/* ================= 入力 ================= */
function queueDir(p, dirName) {
  const d = DIR[dirName]; if (!d) return;
  const last = p.queue.length ? p.queue[p.queue.length - 1] : p.dir;
  // 同じ向き・逆方向(180°)は無視
  if ((d.x === last.x && d.y === last.y) || (d.x === -last.x && d.y === -last.y)) return;
  if (p.queue.length < 3) { p.queue.push(d); if (state === 'play') sfxTurn(); }
}

const KEYMAP = {
  KeyW: [0, 'up'],    KeyA: [0, 'left'],  KeyS: [0, 'down'], KeyD: [0, 'right'],
  ArrowUp: [1, 'up'], ArrowLeft: [1, 'left'], ArrowDown: [1, 'down'], ArrowRight: [1, 'right'],
};
const BOOST_KEYS = { KeyF: 0, Enter: 1, NumpadEnter: 1, ShiftRight: 1 };

document.addEventListener('keydown', (e) => {
  if (e.repeat) { if (KEYMAP[e.code] || BOOST_KEYS[e.code] !== undefined) e.preventDefault(); return; }

  if (state === 'title' && (e.code === 'Enter' || e.code === 'Space')) {
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return; // 入力中は開始しない
    e.preventDefault(); startMatch(); return;
  }

  if (e.code === 'KeyP' && state === 'play') { togglePause(); return; }

  if (state === 'matchend' && e.code === 'Enter') { e.preventDefault(); startMatch(); return; }

  if (KEYMAP[e.code]) {
    e.preventDefault();
    if (state === 'play' && !paused) queueDir(players[KEYMAP[e.code][0]], KEYMAP[e.code][1]);
    return;
  }
  if (BOOST_KEYS[e.code] !== undefined) {
    e.preventDefault();
    const id = BOOST_KEYS[e.code];
    if (!boostHeld[id] && state === 'play' && !paused && players[id] && players[id].boost > 0) sfxBoost();
    boostHeld[id] = true;
  }
});
document.addEventListener('keyup', (e) => {
  if (BOOST_KEYS[e.code] !== undefined) boostHeld[BOOST_KEYS[e.code]] = false;
});
window.addEventListener('blur', () => { boostHeld[0] = boostHeld[1] = false; });

/* ---- タッチ検出 ---- */
const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0
  || (window.matchMedia && matchMedia('(pointer: coarse)').matches);
if (isTouch) document.body.classList.add('is-touch');
window.addEventListener('touchstart', () => document.body.classList.add('is-touch'),
  { once: true, passive: true });

/* ---- タッチボタン ---- */
document.querySelectorAll('#touch-controls [data-dir]').forEach((btn) => {
  const press = (e) => {
    e.preventDefault();
    if (state === 'play') queueDir(players[+btn.dataset.p], btn.dataset.dir);
  };
  btn.addEventListener('pointerdown', press);
  btn.addEventListener('touchstart', press, { passive: false });
});
document.querySelectorAll('#touch-controls [data-boost]').forEach((btn) => {
  const id = +btn.dataset.p;
  const on = (e) => {
    e.preventDefault();
    boostHeld[id] = true; btn.classList.add('held');
    if (state === 'play' && !paused && players[id].boost > 0) sfxBoost();
  };
  const off = () => { boostHeld[id] = false; btn.classList.remove('held'); };
  btn.addEventListener('pointerdown', on);
  btn.addEventListener('touchstart', on, { passive: false });
  btn.addEventListener('pointerup', off);
  btn.addEventListener('pointercancel', off);
  btn.addEventListener('pointerleave', off);
  btn.addEventListener('touchend', off);
  btn.addEventListener('touchcancel', off);
});
// 画面スクロール/ダブルタップズーム防止
$('touch-controls').addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
$('touch-controls').addEventListener('contextmenu', (e) => e.preventDefault());

/* ================= ゲーム進行 ================= */
function startMatch() {
  audio();
  players = makePlayers();
  players.forEach((p, i) => {
    hudName[i].textContent = p.name;
    boostEl[i].style.width = '100%';
  });
  renderPips();
  round = 1;
  paused = false;
  scrStart.classList.add('hidden');
  scrGame.classList.remove('hidden');
  if (document.activeElement) document.activeElement.blur();
  startRound();
}

function startRound() {
  grid.fill(0);
  trailCtx.clearRect(0, 0, trailCv.width, trailCv.height);
  particles = [];
  players.forEach((p, i) => {
    p.alive = true; p.queue = []; p.boost = BOOST_MAX; p.boosting = false; p.moveAcc = 0;
    if (i === 0) { p.x = 8; p.y = ROWS >> 1; p.dir = DIR.right; }
    else        { p.x = COLS - 9; p.y = ROWS >> 1; p.dir = DIR.left; }
    grid[p.y * COLS + p.x] = p.id + 1;
    drawTrailCell(p);
  });
  roundLabel.textContent = 'ROUND ' + round;
  state = 'countdown';
  countdownT = COUNTDOWN_MS; lastCount = -1;
  overlay.classList.remove('hidden');
  ovBtns.classList.add('hidden');
  ovSub.textContent = '';
}

function endRound(deadIds) {
  state = 'roundend';
  roundEndT = ROUNDEND_MS;
  shakeT = 300;
  overlay.classList.remove('hidden');

  const bothDead = deadIds.length === 2;
  deadIds.forEach((id) => spawnExplosion(players[id], id));

  if (bothDead) {
    sfxDraw();
    ovMain.textContent = 'Draw ☹️';
    ovMain.style.color = '#eae7f5';
    ovSub.textContent = 'Simultaneous crash — this round doesn\'t count';
  } else {
    const winner = players[deadIds[0] ^ 1];   // 生き残った方
    const loser = players[deadIds[0]];
    winner.score++;
    sfxCrash();
    ovMain.textContent = winner.name + ' takes the round!';
    ovMain.style.color = winner.color;
    ovSub.textContent = `${players[0].name} ${players[0].score} - ${players[1].score} ${players[1].name} (${loser.name} ☹️)`;
  }
  renderPips();
}

function nextAfterRound() {
  const champ = players.find((p) => p.score >= WIN_ROUNDS);
  if (champ) { endMatch(champ); return; }
  round++;
  startRound();
}

function endMatch(champ) {
  state = 'matchend';
  sfxWin();
  overlay.classList.remove('hidden');
  ovBtns.classList.remove('hidden');
  const loser = players.find((p) => p !== champ);
  ovMain.textContent = '🏆 ' + champ.name + ' wins!';
  ovMain.style.color = champ.color;
  ovSub.textContent = `${players[0].name} ${players[0].score} - ${players[1].score} ${players[1].name} (${loser.name} ☹️)`;
}

function togglePause() {
  paused = !paused;
  if (paused) {
    overlay.classList.remove('hidden');
    ovBtns.classList.add('hidden');
    ovMain.textContent = 'Paused';
    ovMain.style.color = '#eae7f5';
    ovSub.textContent = 'Press P to resume';
  } else {
    overlay.classList.add('hidden');
  }
}

/* ================= ロジック ================= */
function stepIntent(p, interval, dt) {
  p.boosting = boostHeld[p.id] && p.boost > 0;
  if (p.boosting) p.boost = Math.max(0, p.boost - BOOST_DRAIN * dt / 1000);
  else p.boost = Math.min(BOOST_MAX, p.boost + BOOST_REGEN * dt / 1000);
  p.moveAcc += dt;
  return p.moveAcc >= interval;
}

function moveOnce(p) {
  const nx = p.x + p.dir.x, ny = p.y + p.dir.y;
  if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) return false;      // 外壁
  if (grid[ny * COLS + nx] !== 0) return false;                       // 軌跡・頭
  p.x = nx; p.y = ny;
  grid[ny * COLS + nx] = p.id + 1;
  drawTrailCell(p);
  return true;
}

function updatePlay(dt) {
  const pending = [];
  players.forEach((p) => {
    if (!p.alive) return;
    const interval = p.boosting || (boostHeld[p.id] && p.boost > 0) ? BOOST_INTERVAL : NORMAL_INTERVAL;
    if (stepIntent(p, interval, dt)) {
      p.moveAcc -= interval;
      pending.push(p);
    }
  });
  if (!pending.length) return;

  // 方向キューを消化
  pending.forEach((p) => {
    while (p.queue.length) {
      const d = p.queue.shift();
      if (!(d.x === -p.dir.x && d.y === -p.dir.y)) { p.dir = d; break; }
    }
  });

  // 同時解決: 行き先が他スネークの頭 or 両者同じマス → 衝突
  const dead = [];
  const dests = pending.map((p) => ({ x: p.x + p.dir.x, y: p.y + p.dir.y }));
  pending.forEach((p, i) => { p.crashX = dests[i].x; p.crashY = dests[i].y; });

  if (pending.length === 2) {
    const [a, b] = pending;
    if (dests[0].x === dests[1].x && dests[0].y === dests[1].y) {
      dead.push(a.id, b.id);
    } else if (dests[0].x === b.x && dests[0].y === b.y &&
               dests[1].x === a.x && dests[1].y === a.y) {
      dead.push(a.id, b.id);   // 頭のすれ違い
    } else {
      // 相手の現在の頭位置への突入は自分が死ぬ（そのマスは動いても残る）
      if (dests[0].x === b.x && dests[0].y === b.y) dead.push(a.id);
      if (dests[1].x === a.x && dests[1].y === a.y) dead.push(b.id);
    }
  }

  pending.forEach((p) => {
    if (dead.includes(p.id)) return;
    if (!moveOnce(p)) dead.push(p.id);
  });

  if (dead.length) {
    dead.forEach((id) => { players[id].alive = false; });
    endRound([...new Set(dead)]);
  }
}

/* ---- キャラクター (koto=P1, zuza=P2) ---- */
const SKIN_P1 = '#f6d7bd', SKIN_P2 = '#f0cfae';
const HAIR_P1 = '#16131d', HAIR_P2 = '#3a2a1e';
const CHAR_SHIRT = '#0d0c14', CHAR_CHAIN = '#d4d8e2', CHAR_GLASSES = '#08080d';

function drawKoto(c, gx, gy) {
  // マッシュルームカットの後ろ髪
  c.fillStyle = HAIR_P1;
  c.beginPath(); c.ellipse(0, -4.6, 9.6, 8.8, 0, 0, Math.PI * 2); c.fill();

  // 黒シャツの肩
  c.fillStyle = CHAR_SHIRT;
  c.beginPath(); c.roundRect(-8.5, 5.6, 17, 7.5, 3.5); c.fill();

  // 銀チェーンネックレス
  c.strokeStyle = CHAR_CHAIN; c.lineWidth = 1.1;
  c.beginPath(); c.arc(0, 5.4, 4.4, Math.PI * 0.18, Math.PI * 0.82); c.stroke();

  // 腕時計
  c.strokeStyle = CHAR_CHAIN; c.lineWidth = 1.6;
  c.beginPath(); c.moveTo(-8.6, 9.4); c.lineTo(-5.9, 9.4); c.stroke();
  c.fillStyle = '#22242f';
  c.beginPath(); c.arc(-7.2, 9.4, 1.6, 0, Math.PI * 2); c.fill();

  // 顔
  c.fillStyle = SKIN_P1;
  c.beginPath(); c.arc(0, -1.4, 7.4, 0, Math.PI * 2); c.fill();

  // 重めの前髪（下辺まっすぐ）
  c.fillStyle = HAIR_P1;
  c.beginPath();
  c.moveTo(-8, -3.3);
  c.lineTo(-8, -4.6);
  c.quadraticCurveTo(0, -11.4, 8, -4.6);
  c.lineTo(8, -3.3);
  c.closePath();
  c.fill();

  // 目（進行方向にずらす）
  const ex = gx * 1.4, ey = gy * 1.1;
  c.fillStyle = '#171320';
  c.beginPath();
  c.ellipse(-2.7 + ex, -1 + ey, 1.15, 1.5, 0, 0, Math.PI * 2);
  c.ellipse(2.7 + ex, -1 + ey, 1.15, 1.5, 0, 0, Math.PI * 2);
  c.fill();
}

function drawZuza(c, gx, gy) {
  // 肩の後ろまで伸びる長い直毛
  c.fillStyle = HAIR_P2;
  c.beginPath(); c.roundRect(-10.5, -13.5, 21, 27, 9); c.fill();

  // 黒い服
  c.fillStyle = CHAR_SHIRT;
  c.beginPath(); c.roundRect(-8, 6, 16, 7, 3.5); c.fill();

  // 顔
  c.fillStyle = SKIN_P2;
  c.beginPath(); c.arc(0, -2, 8, 0, Math.PI * 2); c.fill();

  // 額と顔の両サイドに落ちるストレートヘア
  c.fillStyle = HAIR_P2;
  c.beginPath(); c.ellipse(0, -7.6, 9.2, 5.6, 0, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.roundRect(-9.5, -8, 4, 15.5, 2); c.fill();
  c.beginPath(); c.roundRect(5.5, -8, 4, 15.5, 2); c.fill();

  // 黒サングラス
  const sx = gx * 1.3, sy = gy * 1;
  c.fillStyle = CHAR_GLASSES;
  c.beginPath(); c.roundRect(-7.6 + sx, -4.4 + sy, 6.9, 4.4, 2.2); c.fill();
  c.beginPath(); c.roundRect(0.7 + sx, -4.4 + sy, 6.9, 4.4, 2.2); c.fill();
  c.fillRect(-1.1 + sx, -3.4 + sy, 2.2, 1.3);
  c.strokeStyle = 'rgba(255,255,255,.5)'; c.lineWidth = 0.9;
  c.beginPath(); c.moveTo(-6.1 + sx, -1.6 + sy); c.lineTo(-4 + sx, -3.7 + sy); c.stroke();
}

function drawCharacter(c, cx, cy, s, p) {
  const g = p.dir || { x: 0, y: 0 };
  c.save();
  c.translate(cx, cy);

  // 軌跡色のハロー（どちらの蛇か一目で分かるよう維持）
  c.shadowColor = p.boosting ? p.glow : p.color;
  c.shadowBlur = p.boosting ? 16 : 9;
  c.fillStyle = p.boosting ? p.glow : p.color;
  c.globalAlpha = p.boosting ? 0.5 : 0.28;
  c.beginPath(); c.arc(0, 0, 14.5 * s, 0, Math.PI * 2); c.fill();
  c.shadowBlur = 0;
  c.globalAlpha = 1;

  c.scale(s, s);
  if (p.id === 0) drawKoto(c, g.x, g.y);
  else drawZuza(c, g.x, g.y);
  c.restore();
}

/* ================= 描画 ================= */
function drawTrailCell(p) {
  const x = p.x * CELL, y = p.y * CELL;
  trailCtx.fillStyle = p.color;
  trailCtx.globalAlpha = 0.28;
  trailCtx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
  trailCtx.globalAlpha = 1;
  trailCtx.fillRect(x + 5, y + 5, CELL - 10, CELL - 10);
}

function spawnExplosion(p) {
  const px = (p.crashX !== undefined ? p.crashX : p.x) * CELL + CELL / 2;
  const py = (p.crashY !== undefined ? p.crashY : p.y) * CELL + CELL / 2;
  for (let i = 0; i < 46; i++) {
    const a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 240;
    particles.push({
      x: px, y: py,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      life: 0.5 + Math.random() * 0.5, t: 0,
      color: p.color, size: 2 + Math.random() * 4,
    });
  }
}

function drawHead(p) {
  if (!p.alive) return;
  const cx = p.x * CELL + CELL / 2, cy = p.y * CELL + CELL / 2;
  drawCharacter(ctx, cx, cy, 0.85, p);
}

/* ---- スタート画面 / HUD のアバター ---- */
function paintAvatar(el, id) {
  if (!el) return;
  drawCharacter(el.getContext('2d'), el.width / 2, el.height / 2, el.width / 32, {
    id,
    color: id === 0 ? COL_P1 : COL_P2,
    glow: id === 0 ? GLOW_P1 : GLOW_P2,
    boosting: false,
    dir: { x: 0, y: 0 },
  });
}
paintAvatar($('avatar1'), 0);
paintAvatar($('avatar2'), 1);
paintAvatar($('hud-avatar1'), 0);
paintAvatar($('hud-avatar2'), 1);

function render(dt) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 背景グリッド
  ctx.strokeStyle = 'rgba(255,255,255,.035)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = CELL; x < canvas.width; x += CELL) { ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); }
  for (let y = CELL; y < canvas.height; y += CELL) { ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); }
  ctx.stroke();

  // 外枠
  ctx.strokeStyle = 'rgba(255,107,157,.35)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);

  // 軌跡 + 頭
  if (shakeT > 0) {
    const s = 4;
    ctx.save();
    ctx.translate((Math.random() - .5) * s, (Math.random() - .5) * s);
  }
  ctx.drawImage(trailCv, 0, 0);
  players.forEach(drawHead);

  // パーティクル
  if (particles.length) {
    particles = particles.filter((pt) => {
      pt.t += dt / 1000;
      if (pt.t >= pt.life) return false;
      pt.x += pt.vx * dt / 1000; pt.y += pt.vy * dt / 1000;
      pt.vx *= 0.96; pt.vy *= 0.96;
      ctx.globalAlpha = 1 - pt.t / pt.life;
      ctx.fillStyle = pt.color;
      ctx.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
      return true;
    });
    ctx.globalAlpha = 1;
  }
  if (shakeT > 0) { ctx.restore(); shakeT = Math.max(0, shakeT - dt); }

  // HUD ブーストゲージ
  players.forEach((p, i) => { boostEl[i].style.width = p.boost + '%'; });
}

/* ================= メインループ ================= */
let lastTs = 0;
function loop(ts) {
  requestAnimationFrame(loop);
  const dt = Math.min(60, ts - lastTs || 16);
  lastTs = ts;

  if (state === 'countdown') {
    countdownT -= dt;
    const n = Math.ceil(countdownT / 800);
    if (n !== lastCount) {
      lastCount = n;
      if (n > 0) { ovMain.textContent = String(n); ovMain.style.color = '#eae7f5'; sfxTick(); }
      else { ovMain.textContent = 'GO!'; ovMain.style.color = '#4ecdc4'; sfxGo(); }
    }
    if (countdownT <= -350) { overlay.classList.add('hidden'); state = 'play'; }
  } else if (state === 'play' && !paused) {
    updatePlay(dt);
  } else if (state === 'roundend') {
    roundEndT -= dt;
    if (roundEndT <= 0) nextAfterRound();
  }
  render(dt);
}
requestAnimationFrame(loop);

/* ================= 画面遷移 ================= */
$('btn-start').addEventListener('click', startMatch);
$('btn-replay').addEventListener('click', () => { audio(); startMatch(); });
$('btn-title').addEventListener('click', () => {
  state = 'title';
  overlay.classList.add('hidden');
  scrGame.classList.add('hidden');
  scrStart.classList.remove('hidden');
});

})();
