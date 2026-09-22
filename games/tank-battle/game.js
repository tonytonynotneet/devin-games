(() => {
'use strict';

/* ================= 設定 ================= */
const TILE = 40;
const COLS = 19, ROWS = 15;          // 760 x 600
const TANK_R = 13;
const SPEED_FWD = 132;               // px/s 前進
const SPEED_BACK = 92;               // px/s 後退
const ROT_SPEED = 3.4;               // rad/s 旋回
const BULLET_SPEED = 300;
const BULLET_R = 4;
const MAX_BOUNCES = 3;
const MAX_AMMO = 4;                  // 同時に飛べる砲弾数
const FIRE_COOLDOWN = 340;           // ms
const BULLET_LIFE = 5200;            // ms
const SELF_ARM_MS = 160;             // この時間は自弾が自分に当たらない
const WIN_ROUNDS = 3;
const COUNTDOWN_MS = 2400;
const ROUNDEND_MS = 2100;
const LOOP_OPEN_RATE = 0.16;         // 迷路に余分な抜け道を開ける確率

const COL_P1 = '#4ecdc4', GLOW_P1 = '#7ff2ea';
const COL_P2 = '#ff6b9d', GLOW_P2 = '#ffa1c2';

/* ================= DOM ================= */
const $ = (id) => document.getElementById(id);
const canvas = $('game');
const ctx = canvas.getContext('2d');
canvas.width = COLS * TILE;
canvas.height = ROWS * TILE;

const scrStart = $('screen-start'), scrGame = $('screen-game');
const overlay = $('overlay'), ovMain = $('overlay-main'),
      ovSub = $('overlay-sub'), ovBtns = $('overlay-btns');
const hudName = [$('hud-name1'), $('hud-name2')];
const pipsEl  = [$('pips1'), $('pips2')];
const ammoEl  = [$('ammo1'), $('ammo2')];
const roundLabel = $('round-label');

/* 迷路はラウンドごとにオフスクリーンへ描きためる */
const mazeCv = document.createElement('canvas');
mazeCv.width = canvas.width; mazeCv.height = canvas.height;
const mazeCtx = mazeCv.getContext('2d');

/* ================= 状態 ================= */
let state = 'title';           // title | countdown | play | roundend | matchend
let paused = false;
let walls = new Uint8Array(COLS * ROWS);   // 1 = 壁
let players = [];
let bullets = [];
let particles = [];            // {kind:'dot'|'emoji', ...}
let round = 1;
let countdownT = 0, lastCount = -1;
let roundEndT = 0;
let shakeT = 0;

const input = [
  { up: false, down: false, left: false, right: false, fire: false },
  { up: false, down: false, left: false, right: false, fire: false },
];

function getNames() {
  const n1 = $('name1').value.trim() || $('name1').placeholder || 'プレイヤー1';
  const n2 = $('name2').value.trim() || $('name2').placeholder || 'プレイヤー2';
  return [n1, n2];
}

function spawnPos(i) {
  // 角に開けた 2x2 フロアの中央
  return i === 0
    ? { x: TILE * 2, y: TILE * 2, ang: 0.62 }
    : { x: canvas.width - TILE * 2, y: canvas.height - TILE * 2, ang: Math.PI + 0.62 };
}

function makePlayers() {
  const names = getNames();
  const s0 = spawnPos(0), s1 = spawnPos(1);
  return [
    { id: 0, name: names[0], color: COL_P1, glow: GLOW_P1,
      x: s0.x, y: s0.y, ang: s0.ang, alive: true, score: 0, cool: 0 },
    { id: 1, name: names[1], color: COL_P2, glow: GLOW_P2,
      x: s1.x, y: s1.y, ang: s1.ang, alive: true, score: 0, cool: 0 },
  ];
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

function renderAmmo() {
  players.forEach((p, i) => {
    const live = MAX_AMMO - bullets.filter((b) => b.owner === i).length;
    ammoEl[i].innerHTML = '';
    for (let k = 0; k < MAX_AMMO; k++) {
      const d = document.createElement('span');
      d.className = 'ammo-dot' + (k < live ? ' live' : '');
      ammoEl[i].appendChild(d);
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
const sfxTick  = () => tone(520, .09, 'sine', .06);
const sfxGo    = () => tone(880, .18, 'sine', .09);
const sfxFire  = () => { tone(640, .09, 'square', .05, 140); noise(.08, .05); };
const sfxBounce= () => tone(980, .05, 'triangle', .045, 1400);
const sfxBoom  = () => { noise(.5, .22); tone(120, .5, 'sawtooth', .1, 40); };
const sfxWin   = () => [523, 659, 784, 1046].forEach((f, i) => tone(f, .16, 'triangle', .07, null, i * .13));
const sfxDraw  = () => { tone(300, .2, 'sine', .06); tone(300, .2, 'sine', .06, null, .25); };
const sfxLose  = () => tone(240, .3, 'sine', .05, 160);

/* ================= 迷路生成 ================= */
function genMaze() {
  walls = new Uint8Array(COLS * ROWS).fill(1);
  const idx = (x, y) => y * COLS + x;
  const inRange = (x, y) => x > 0 && y > 0 && x < COLS - 1 && y < ROWS - 1;

  // 穴掘り法（奇数座標が部屋、偶数は壁）
  const seen = new Set(['1,1']);
  const stack = [[1, 1]];
  walls[idx(1, 1)] = 0;
  const DIRS = [[2, 0], [-2, 0], [0, 2], [0, -2]];
  while (stack.length) {
    const [cx, cy] = stack[stack.length - 1];
    const opts = DIRS
      .map(([dx, dy]) => [cx + dx, cy + dy])
      .filter(([nx, ny]) => inRange(nx, ny) && !seen.has(nx + ',' + ny));
    if (!opts.length) { stack.pop(); continue; }
    const [nx, ny] = opts[(Math.random() * opts.length) | 0];
    walls[idx(cx + (nx - cx) / 2, cy + (ny - cy) / 2)] = 0;
    walls[idx(nx, ny)] = 0;
    seen.add(nx + ',' + ny);
    stack.push([nx, ny]);
  }

  // ループを増やして追いかけっこを面白く
  for (let y = 1; y < ROWS - 1; y++) {
    for (let x = 1; x < COLS - 1; x++) {
      if (!walls[idx(x, y)]) continue;
      const h = !walls[idx(x - 1, y)] && !walls[idx(x + 1, y)];
      const v = !walls[idx(x, y - 1)] && !walls[idx(x, y + 1)];
      if ((h || v) && Math.random() < LOOP_OPEN_RATE) walls[idx(x, y)] = 0;
    }
  }

  // スポーン地点は 2x2 開ける（追い詰められて即死しないように）
  [[1, 1], [COLS - 2, ROWS - 2]].forEach(([sx, sy]) => {
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = 0; dx <= 1; dx++) {
        const tx = Math.min(COLS - 2, Math.max(1, sx + (sx > COLS / 2 ? -dx : dx)));
        const ty = Math.min(ROWS - 2, Math.max(1, sy + (sy > ROWS / 2 ? -dy : dy)));
        walls[idx(tx, ty)] = 0;
      }
    }
  });

  renderMaze();
}

function renderMaze() {
  mazeCtx.clearRect(0, 0, mazeCv.width, mazeCv.height);

  // 床のうっすらグリッド
  mazeCtx.fillStyle = 'rgba(255,255,255,.028)';
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (!walls[y * COLS + x] && (x + y) % 2 === 0) {
        mazeCtx.fillRect(x * TILE, y * TILE, TILE, TILE);
      }
    }
  }

  // 壁ブロック（上面ハイライト付き）
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (!walls[y * COLS + x]) continue;
      const px = x * TILE, py = y * TILE;
      mazeCtx.fillStyle = '#34305a';
      mazeCtx.fillRect(px, py, TILE, TILE);
      mazeCtx.fillStyle = '#443f74';
      mazeCtx.fillRect(px + 2, py + 2, TILE - 4, TILE - 4);
      mazeCtx.fillStyle = '#565091';
      mazeCtx.fillRect(px + 2, py + 2, TILE - 4, 5);
      // 床に面した辺に薄い影線
      mazeCtx.fillStyle = 'rgba(0,0,0,.28)';
      if (y + 1 < ROWS && !walls[(y + 1) * COLS + x]) mazeCtx.fillRect(px, py + TILE - 3, TILE, 3);
      if (x + 1 < COLS && !walls[y * COLS + x + 1]) mazeCtx.fillRect(px + TILE - 3, py, 3, TILE);
    }
  }
}

/* ================= 当たり判定 ================= */
function circleHitsWall(cx, cy, r) {
  const x0 = Math.max(0, ((cx - r) / TILE) | 0);
  const x1 = Math.min(COLS - 1, ((cx + r) / TILE) | 0);
  const y0 = Math.max(0, ((cy - r) / TILE) | 0);
  const y1 = Math.min(ROWS - 1, ((cy + r) / TILE) | 0);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (!walls[ty * COLS + tx]) continue;
      const nx = Math.max(tx * TILE, Math.min(cx, tx * TILE + TILE));
      const ny = Math.max(ty * TILE, Math.min(cy, ty * TILE + TILE));
      const dx = cx - nx, dy = cy - ny;
      if (dx * dx + dy * dy < r * r) return true;
    }
  }
  return false;
}

function pointInWall(cx, cy, r) {
  return circleHitsWall(cx, cy, r);
}

function otherTank(p) { return players[p.id ^ 1]; }

function tryMove(p, dx, dy) {
  const nx = p.x + dx, ny = p.y + dy;
  if (circleHitsWall(nx, ny, TANK_R - 1)) return;
  const o = otherTank(p);
  if (o.alive) {
    const ddx = nx - o.x, ddy = ny - o.y;
    if (ddx * ddx + ddy * ddy < (TANK_R * 2 - 2) * (TANK_R * 2 - 2)) return;
  }
  p.x = nx; p.y = ny;
}

/* ================= 砲弾 ================= */
function fire(p) {
  if (!p.alive || p.cool > 0) return;
  if (bullets.filter((b) => b.owner === p.id).length >= MAX_AMMO) return;
  p.cool = FIRE_COOLDOWN;
  const mx = p.x + Math.cos(p.ang) * (TANK_R + 8);
  const my = p.y + Math.sin(p.ang) * (TANK_R + 8);
  bullets.push({
    x: mx, y: my,
    vx: Math.cos(p.ang) * BULLET_SPEED,
    vy: Math.sin(p.ang) * BULLET_SPEED,
    owner: p.id, bounces: MAX_BOUNCES, life: BULLET_LIFE, age: 0,
    px: mx, py: my,
  });
  sfxFire();
  spawnMuzzle(p);
  renderAmmo();
}

function killBullet(b) {
  for (let i = 0; i < 8; i++) {
    const a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 120;
    particles.push({ kind: 'dot', x: b.x, y: b.y,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      life: .35, t: 0, color: '#cfc9ee', size: 1.5 + Math.random() * 2 });
  }
}

function updateBullets(dt) {
  const deadTanks = new Set();
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.px = b.x; b.py = b.y;
    b.age += dt; b.life -= dt;

    // X 軸
    const nx = b.x + b.vx * dt / 1000;
    if (pointInWall(nx, b.y, BULLET_R)) {
      b.vx = -b.vx; b.bounces--;
      sfxBounce();
      spark(b.x, b.y, 0);
    } else b.x = nx;
    // Y 軸
    const ny = b.y + b.vy * dt / 1000;
    if (pointInWall(b.x, ny, BULLET_R)) {
      b.vy = -b.vy; b.bounces--;
      sfxBounce();
      spark(b.x, b.y, 1);
    } else b.y = ny;

    if (b.bounces < 0 || b.life <= 0) {
      killBullet(b);
      bullets.splice(i, 1);
      renderAmmo();
      continue;
    }

    // 戦車への命中
    players.forEach((p) => {
      if (!p.alive || deadTanks.has(p.id)) return;
      if (p.id === b.owner && b.age < SELF_ARM_MS) return;
      const dx = b.x - p.x, dy = b.y - p.y;
      if (dx * dx + dy * dy < (BULLET_R + TANK_R - 2) * (BULLET_R + TANK_R - 2)) {
        deadTanks.add(p.id);
        b.life = 0;
      }
    });
    if (b.life <= 0) { bullets.splice(i, 1); renderAmmo(); }
  }

  if (deadTanks.size) {
    deadTanks.forEach((id) => { players[id].alive = false; });
    endRound([...deadTanks]);
  }
}

function spark(x, y, axis) {
  for (let i = 0; i < 5; i++) {
    const a = Math.random() * Math.PI * 2, sp = 30 + Math.random() * 90;
    particles.push({ kind: 'dot', x, y,
      vx: Math.cos(a) * sp * (axis ? .6 : 1.4),
      vy: Math.sin(a) * sp * (axis ? 1.4 : .6),
      life: .25, t: 0, color: '#ffd97a', size: 1 + Math.random() * 2 });
  }
}

function spawnMuzzle(p) {
  const mx = p.x + Math.cos(p.ang) * (TANK_R + 8);
  const my = p.y + Math.sin(p.ang) * (TANK_R + 8);
  for (let i = 0; i < 6; i++) {
    const a = p.ang + (Math.random() - .5) * .8, sp = 80 + Math.random() * 140;
    particles.push({ kind: 'dot', x: mx, y: my,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      life: .18, t: 0, color: '#ffd97a', size: 1.5 + Math.random() * 2.5 });
  }
}

function spawnExplosion(p) {
  for (let i = 0; i < 60; i++) {
    const a = Math.random() * Math.PI * 2, sp = 50 + Math.random() * 260;
    particles.push({ kind: 'dot', x: p.x, y: p.y,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      life: .5 + Math.random() * .6, t: 0,
      color: i % 3 === 0 ? '#ffd97a' : p.color,
      size: 2 + Math.random() * 4 });
  }
  // 敗北した戦車の上にさりげなく ☹️
  particles.push({ kind: 'emoji', x: p.x, y: p.y - 8, vy: -26, t: 0, life: 1.4, ch: '☹️' });
}

/* ================= 入力 ================= */
const KEYMAP = {
  KeyW: [0, 'up'], KeyS: [0, 'down'], KeyA: [0, 'left'], KeyD: [0, 'right'],
  ArrowUp: [1, 'up'], ArrowDown: [1, 'down'], ArrowLeft: [1, 'left'], ArrowRight: [1, 'right'],
};
const FIRE_KEYS = { KeyF: 0, Enter: 1, NumpadEnter: 1, ShiftRight: 1 };
const GAME_KEYS = new Set([...Object.keys(KEYMAP), ...Object.keys(FIRE_KEYS), 'Space']);

document.addEventListener('keydown', (e) => {
  if (GAME_KEYS.has(e.code)) e.preventDefault();

  if (state === 'title' && (e.code === 'Enter' || e.code === 'Space')) {
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
    e.preventDefault(); startMatch(); return;
  }
  if (e.code === 'KeyP' && state === 'play') { togglePause(); return; }
  if (state === 'matchend' && e.code === 'Enter') { e.preventDefault(); startMatch(); return; }

  const mv = KEYMAP[e.code];
  if (mv) { input[mv[0]][mv[1]] = true; return; }
  const fk = FIRE_KEYS[e.code];
  if (fk !== undefined && !e.repeat) {
    input[fk].fire = true;
    if (state === 'play' && !paused && players[fk]) fire(players[fk]);
  } else if (fk !== undefined) {
    input[fk].fire = true;
  }
});
document.addEventListener('keyup', (e) => {
  const mv = KEYMAP[e.code];
  if (mv) { input[mv[0]][mv[1]] = false; return; }
  const fk = FIRE_KEYS[e.code];
  if (fk !== undefined) input[fk].fire = false;
});
window.addEventListener('blur', () => {
  input.forEach((i) => { i.up = i.down = i.left = i.right = i.fire = false; });
});

/* ---- タッチ検出 ---- */
const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0
  || (window.matchMedia && matchMedia('(pointer: coarse)').matches);
if (isTouch) document.body.classList.add('is-touch');
window.addEventListener('touchstart', () => document.body.classList.add('is-touch'),
  { once: true, passive: true });

/* ---- タッチボタン ---- */
document.querySelectorAll('#touch-controls [data-dir]').forEach((btn) => {
  const pid = +btn.dataset.p, dir = btn.dataset.dir;
  const on = (e) => { e.preventDefault(); input[pid][dir] = true; btn.classList.add('held'); };
  const off = () => { input[pid][dir] = false; btn.classList.remove('held'); };
  btn.addEventListener('pointerdown', on);
  btn.addEventListener('touchstart', on, { passive: false });
  btn.addEventListener('pointerup', off);
  btn.addEventListener('pointercancel', off);
  btn.addEventListener('pointerleave', off);
  btn.addEventListener('touchend', off);
  btn.addEventListener('touchcancel', off);
});
document.querySelectorAll('#touch-controls [data-fire]').forEach((btn) => {
  const pid = +btn.dataset.p;
  const on = (e) => {
    e.preventDefault();
    input[pid].fire = true; btn.classList.add('held');
    if (state === 'play' && !paused && players[pid]) fire(players[pid]);
  };
  const off = () => { input[pid].fire = false; btn.classList.remove('held'); };
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
  players.forEach((p, i) => { hudName[i].textContent = p.name; });
  renderPips();
  round = 1;
  paused = false;
  scrStart.classList.add('hidden');
  scrGame.classList.remove('hidden');
  if (document.activeElement) document.activeElement.blur();
  startRound();
}

function startRound() {
  genMaze();
  bullets = [];
  particles = [];
  players.forEach((p, i) => {
    const s = spawnPos(i);
    p.x = s.x; p.y = s.y; p.ang = s.ang;
    p.alive = true; p.cool = 0;
  });
  input.forEach((i) => { i.up = i.down = i.left = i.right = i.fire = false; });
  renderAmmo();
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
  shakeT = 320;
  overlay.classList.remove('hidden');

  const bothDead = deadIds.length === 2;
  deadIds.forEach((id) => spawnExplosion(players[id]));

  if (bothDead) {
    sfxDraw();
    ovMain.textContent = '引き分け！';
    ovMain.style.color = '#eae7f5';
    ovSub.textContent = '同時撃破 — このラウンドはノーカウント';
  } else {
    const winner = players[deadIds[0] ^ 1];   // 生き残った方
    const loser = players[deadIds[0]];
    winner.score++;
    sfxBoom();
    setTimeout(sfxLose, 200);
    ovMain.textContent = winner.name + ' のラウンド獲得！';
    ovMain.style.color = winner.color;
    ovSub.textContent =
      `${players[0].name} ${players[0].score} - ${players[1].score} ${players[1].name}　☹️ ${loser.name}`;
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
  const loser = players[champ.id ^ 1];
  overlay.classList.remove('hidden');
  ovBtns.classList.remove('hidden');
  ovMain.textContent = '🏆 ' + champ.name + ' の勝利！';
  ovMain.style.color = champ.color;
  ovSub.textContent =
    `${players[0].name} ${players[0].score} - ${players[1].score} ${players[1].name}　☹️ ${loser.name} おしい！`;
}

function togglePause() {
  paused = !paused;
  if (paused) {
    overlay.classList.remove('hidden');
    ovBtns.classList.add('hidden');
    ovMain.textContent = 'ポーズ中';
    ovMain.style.color = '#eae7f5';
    ovSub.textContent = 'P キーで再開';
  } else {
    overlay.classList.add('hidden');
  }
}

/* ================= ロジック ================= */
function updatePlay(dt) {
  players.forEach((p) => {
    if (!p.alive) return;
    const inp = input[p.id];
    if (inp.left)  p.ang -= ROT_SPEED * dt / 1000;
    if (inp.right) p.ang += ROT_SPEED * dt / 1000;
    let spd = 0;
    if (inp.up) spd = SPEED_FWD;
    else if (inp.down) spd = -SPEED_BACK;
    if (spd) {
      const dx = Math.cos(p.ang) * spd * dt / 1000;
      const dy = Math.sin(p.ang) * spd * dt / 1000;
      tryMove(p, dx, 0);
      tryMove(p, 0, dy);
    }
    if (p.cool > 0) p.cool -= dt;
    // 押しっぱなしでも連射（クールダウン＋残弾で制限）
    if (inp.fire && p.cool <= 0) fire(p);
  });
  updateBullets(dt);
}

/* ================= 描画 ================= */
function drawTank(p) {
  if (!p.alive) return;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.ang);
  ctx.shadowColor = p.color;
  ctx.shadowBlur = 14;

  // キャタピラ
  ctx.fillStyle = '#0c0b16';
  ctx.beginPath(); ctx.roundRect(-14, -13, 28, 8, 3); ctx.fill();
  ctx.beginPath(); ctx.roundRect(-14, 5, 28, 8, 3); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.14)';
  for (let i = -11; i <= 11; i += 6) {
    ctx.fillRect(i, -12, 3, 6);
    ctx.fillRect(i, 6, 3, 6);
  }

  // 車体
  ctx.fillStyle = p.color;
  ctx.beginPath(); ctx.roundRect(-12, -9, 24, 18, 5); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.18)';
  ctx.beginPath(); ctx.roundRect(-12, -9, 24, 6, 5); ctx.fill();

  // 砲身
  ctx.fillStyle = p.color;
  ctx.beginPath(); ctx.roundRect(6, -3, 20, 6, 3); ctx.fill();

  // 砲塔
  ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,.28)';
  ctx.beginPath(); ctx.arc(0, 0, 3.4, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawBullets() {
  bullets.forEach((b) => {
    // 残りわずかな弾は点滅
    const dying = b.life < 900 && ((b.life / 120) | 0) % 2 === 0;
    ctx.save();
    ctx.strokeStyle = players[b.owner].color;
    ctx.globalAlpha = dying ? .3 : .45;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(b.px, b.py);
    ctx.lineTo(b.x - b.vx * .018, b.y - b.vy * .018);
    ctx.stroke();
    ctx.globalAlpha = dying ? .5 : 1;
    ctx.shadowColor = '#fff';
    ctx.shadowBlur = 8;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(b.x, b.y, BULLET_R, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  });
}

function drawParticles(dt) {
  particles = particles.filter((pt) => {
    pt.t += dt / 1000;
    if (pt.t >= pt.life) return false;
    if (pt.kind === 'emoji') {
      pt.y += pt.vy * dt / 1000;
      ctx.globalAlpha = Math.min(1, (pt.life - pt.t) * 2.2);
      ctx.font = '20px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(pt.ch, pt.x, pt.y);
      ctx.globalAlpha = 1;
      return true;
    }
    pt.x += pt.vx * dt / 1000; pt.y += pt.vy * dt / 1000;
    pt.vx *= 0.94; pt.vy *= 0.94;
    ctx.globalAlpha = 1 - pt.t / pt.life;
    ctx.fillStyle = pt.color;
    ctx.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
    return true;
  });
  ctx.globalAlpha = 1;
}

function render(dt) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (shakeT > 0) {
    const s = 5;
    ctx.save();
    ctx.translate((Math.random() - .5) * s, (Math.random() - .5) * s);
  }

  ctx.drawImage(mazeCv, 0, 0);

  // スポーンマーカー（薄い色丸）
  players.forEach((p) => {
    if (state !== 'play' && state !== 'countdown') return;
    ctx.globalAlpha = .10;
    ctx.fillStyle = p.color;
    const s = spawnPos(p.id);
    ctx.beginPath(); ctx.arc(s.x, s.y, TANK_R + 5, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  });

  players.forEach(drawTank);
  drawBullets();
  drawParticles(dt);

  if (shakeT > 0) { ctx.restore(); shakeT = Math.max(0, shakeT - dt); }
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
