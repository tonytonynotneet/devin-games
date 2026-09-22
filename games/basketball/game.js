(() => {
'use strict';

/* ================= 設定 ================= */
const W = 900, H = 520;
const FLOOR_Y = 462;                 // 床面のY
const LEFT_WALL = 30, RIGHT_WALL = W - 30;
const GRAV_P = 1750, GRAV_B = 1500;  // 重力（プレイヤー / ボール）
const RUN_SPEED = 270, ACCEL = 3400, FRICTION = 2800, AIR_CTRL = 0.72;
const JUMP_V = 700;
const CHARGE_MS = 780;               // フルチャージまでの時間
const SWEET = 0.6875, SWEET_WIN = 0.04; // スイッシュゾーン（メーター位置±）
const FAKE_MAX = 0.12;               // これ以下のチャージはフェイク
const BALL_R = 9;
const RIM = { x: 812, y: FLOOR_Y - 170, w: 46 };  // リング開口: x-w .. x
const BOARD = { x: RIM.x + 2, y: RIM.y - 62, w: 10, h: 64 };
const THREE_D = 340;                 // 3ptラインまでの距離
const TARGET = 11;                   // 先取点
const REG_T = 90;                    // レギュレーション秒数
const STEAL_RANGE = 84, STEAL_CD = 750, STEAL_ARM = 260;
const STUN_MS = 420;

const COL_P1 = '#4ecdc4', GLOW_P1 = '#7ff2ea';
const COL_P2 = '#ff6b9d', GLOW_P2 = '#ffa1c2';
const COL_BALL = '#f0923f';
const COL_SKIN = '#ffd9b3';

/* ================= DOM ================= */
const $ = (id) => document.getElementById(id);
const canvas = $('game');
const ctx = canvas.getContext('2d');

const scrStart = $('screen-start'), scrGame = $('screen-game');
const overlay = $('overlay'), ovMain = $('overlay-main'),
      ovSub = $('overlay-sub'), ovBtns = $('overlay-btns');
const hudName = [$('hud-name1'), $('hud-name2')];
const hudScore = [$('score1'), $('score2')];
const marks = [$('mark1'), $('mark2')];
const clockEl = $('clock'), targetEl = $('target-label');

/* ================= 状態 ================= */
let state = 'title';        // title | countdown | play | basket | checkball | matchend
let paused = false;
let players = [];
let ball = null;
let regT = REG_T * 1000;
let overtime = false;
let lastScorer = -1;
let countdownT = 0, lastCount = -1;
let basketT = 0, checkT = 0;
let particles = [], floaters = [];
let shakeT = 0;
let dribbleT = 0, lastDribbleDown = false;
const moveHeld = [{ left: false, right: false }, { left: false, right: false }];

function getNames() {
  const n1 = $('name1').value.trim() || $('name1').placeholder || 'プレイヤー1';
  const n2 = $('name2').value.trim() || $('name2').placeholder || 'プレイヤー2';
  return [n1, n2];
}

function makePlayers() {
  const names = getNames();
  return [
    { id: 0, name: names[0], color: COL_P1, glow: GLOW_P1,
      x: 300, y: FLOOR_Y, vx: 0, vy: 0, w: 30, h: 56, face: 1, onGround: true,
      score: 0, hasBall: false, charging: false, charge: 0,
      stealCd: 0, armT: 0, stunT: 0, stepT: 0 },
    { id: 1, name: names[1], color: COL_P2, glow: GLOW_P2,
      x: 580, y: FLOOR_Y, vx: 0, vy: 0, w: 30, h: 56, face: -1, onGround: true,
      score: 0, hasBall: false, charging: false, charge: 0,
      stealCd: 0, armT: 0, stunT: 0, stepT: 0 },
  ];
}

function makeBall() {
  return { x: 0, y: 0, vx: 0, vy: 0, state: 'held', owner: players[0],
           shotBy: null, pts: 0, swish: false, touchedRim: false,
           noPick: -1, noPickUntil: 0, rot: 0 };
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
function noise(dur = 0.3, vol = 0.15, hp = false) {
  const ac = audio(); if (!ac) return;
  const len = (ac.sampleRate * dur) | 0;
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const s = ac.createBufferSource(); s.buffer = buf;
  let node = s;
  if (hp) {
    const f = ac.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 2500;
    s.connect(f); node = f;
  }
  const g = ac.createGain();
  g.gain.setValueAtTime(vol, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
  node.connect(g).connect(ac.destination); s.start();
}
const sfxTick    = () => tone(520, .09, 'sine', .06);
const sfxGo      = () => tone(880, .18, 'sine', .09);
const sfxJump    = () => tone(300, .08, 'sine', .025, 460);
const sfxDribble = () => { noise(.05, .05); tone(95, .07, 'sine', .06); };
const sfxCharge  = () => tone(220, .5, 'sine', .02, 620);
const sfxShoot   = () => noise(.14, .07, true);
const sfxSwish   = () => { noise(.16, .09, true); tone(1150, .1, 'sine', .04, 900); };
const sfxRim     = () => { tone(230, .12, 'square', .06, 180); tone(340, .08, 'square', .04, 260); };
const sfxBoard   = () => { noise(.08, .1); tone(130, .1, 'sine', .08); };
const sfxSteal   = () => { tone(680, .07, 'square', .05, 900); noise(.06, .05); };
const sfxBlock   = () => { noise(.14, .14); tone(160, .18, 'sawtooth', .08, 70); };
const sfxScore   = () => [660, 880].forEach((f, i) => tone(f, .12, 'triangle', .07, null, i * .09));
const sfxThree   = () => [660, 880, 1174].forEach((f, i) => tone(f, .14, 'triangle', .07, null, i * .09));
const sfxBuzzer  = () => tone(196, .8, 'square', .12);
const sfxWin     = () => [523, 659, 784, 1046].forEach((f, i) => tone(f, .16, 'triangle', .07, null, i * .13));
const sfxFake    = () => tone(420, .05, 'sine', .04);
const sfxPickup  = () => tone(500, .05, 'sine', .03);

/* ================= 入力 ================= */
const MOVE_KEYS = {
  KeyA: [0, 'left'], KeyD: [0, 'right'],
  ArrowLeft: [1, 'left'], ArrowRight: [1, 'right'],
};
const JUMP_KEYS = { KeyW: 0, ArrowUp: 1 };
const ACT_KEYS = { KeyF: 0, Enter: 1, NumpadEnter: 1, ShiftRight: 1 };

function pressAction(id) {
  const p = players[id];
  if (!p || p.stunT > 0) return;
  if (p.hasBall) {
    p.charging = true; p.charge = 0;
    sfxCharge();
  } else if (p.stealCd <= 0) {
    p.armT = STEAL_ARM; p.stealCd = STEAL_CD;
    trySteal(p);
  }
}

function releaseAction(id) {
  const p = players[id];
  if (!p || !p.charging) return;
  p.charging = false;
  if (!p.hasBall) { p.charge = 0; return; }
  if (p.charge < FAKE_MAX) { p.charge = 0; sfxFake(); return; }
  shoot(p);
}

function tryJump(id) {
  const p = players[id];
  if (!p) return;
  if (p.onGround && p.stunT <= 0) { p.vy = -JUMP_V; p.onGround = false; sfxJump(); }
}

document.addEventListener('keydown', (e) => {
  const code = e.code;
  if (e.repeat) {
    if (MOVE_KEYS[code] || JUMP_KEYS[code] !== undefined || ACT_KEYS[code] !== undefined || code === 'Space') e.preventDefault();
    return;
  }
  if (state === 'title' && (code === 'Enter' || code === 'Space')) {
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
    e.preventDefault(); startMatch(); return;
  }
  if (code === 'KeyP' && state === 'play') { togglePause(); return; }
  if (state === 'matchend' && code === 'Enter') {
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
    e.preventDefault(); startMatch(); return;
  }
  if (MOVE_KEYS[code]) {
    e.preventDefault();
    moveHeld[MOVE_KEYS[code][0]][MOVE_KEYS[code][1]] = true;
    return;
  }
  if (JUMP_KEYS[code] !== undefined) {
    e.preventDefault();
    if (state === 'play' && !paused) tryJump(JUMP_KEYS[code]);
    return;
  }
  if (ACT_KEYS[code] !== undefined) {
    e.preventDefault();
    if (state === 'play' && !paused) pressAction(ACT_KEYS[code]);
  }
});
document.addEventListener('keyup', (e) => {
  const code = e.code;
  if (MOVE_KEYS[code]) moveHeld[MOVE_KEYS[code][0]][MOVE_KEYS[code][1]] = false;
  if (ACT_KEYS[code] !== undefined) releaseAction(ACT_KEYS[code]);
});
window.addEventListener('blur', () => {
  moveHeld.forEach((m) => { m.left = m.right = false; });
  players.forEach((p) => { if (p.charging) { p.charging = false; p.charge = 0; } });
});

/* ---- タッチ検出 ---- */
const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0
  || (window.matchMedia && matchMedia('(pointer: coarse)').matches);
if (isTouch) document.body.classList.add('is-touch');
window.addEventListener('touchstart', () => document.body.classList.add('is-touch'),
  { once: true, passive: true });

/* ---- タッチボタン ---- */
document.querySelectorAll('#touch-controls [data-move]').forEach((btn) => {
  const id = +btn.dataset.p, dir = btn.dataset.move;
  const on = (e) => { e.preventDefault(); moveHeld[id][dir] = true; btn.classList.add('held'); };
  const off = () => { moveHeld[id][dir] = false; btn.classList.remove('held'); };
  btn.addEventListener('pointerdown', on);
  btn.addEventListener('touchstart', on, { passive: false });
  btn.addEventListener('pointerup', off);
  btn.addEventListener('pointercancel', off);
  btn.addEventListener('pointerleave', off);
  btn.addEventListener('touchend', off);
  btn.addEventListener('touchcancel', off);
});
document.querySelectorAll('#touch-controls [data-jump]').forEach((btn) => {
  const press = (e) => {
    e.preventDefault();
    if (state === 'play' && !paused) tryJump(+btn.dataset.p);
  };
  btn.addEventListener('pointerdown', press);
  btn.addEventListener('touchstart', press, { passive: false });
});
document.querySelectorAll('#touch-controls [data-act]').forEach((btn) => {
  const id = +btn.dataset.p;
  const on = (e) => {
    e.preventDefault(); btn.classList.add('held');
    if (state === 'play' && !paused) pressAction(id);
  };
  const off = () => { btn.classList.remove('held'); releaseAction(id); };
  btn.addEventListener('pointerdown', on);
  btn.addEventListener('touchstart', on, { passive: false });
  btn.addEventListener('pointerup', off);
  btn.addEventListener('pointercancel', off);
  btn.addEventListener('pointerleave', off);
  btn.addEventListener('touchend', off);
  btn.addEventListener('touchcancel', off);
});
$('touch-controls').addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
$('touch-controls').addEventListener('contextmenu', (e) => e.preventDefault());

/* ================= ゲーム進行 ================= */
function startMatch() {
  audio();
  players = makePlayers();
  ball = makeBall();
  ball.owner.hasBall = true;
  players.forEach((p, i) => {
    hudName[i].textContent = p.name;
    hudScore[i].textContent = '0';
  });
  regT = REG_T * 1000;
  overtime = false; lastScorer = -1;
  paused = false;
  particles = []; floaters = [];
  clockEl.classList.remove('urgent');
  targetEl.textContent = TARGET + '点先取 / ' + REG_T + '秒';
  scrStart.classList.add('hidden');
  scrGame.classList.remove('hidden');
  if (document.activeElement) document.activeElement.blur();
  updateMarks();
  startCountdown('TIP OFF!');
}

function startCountdown(label) {
  state = 'countdown';
  countdownT = 2400; lastCount = -1;
  overlay.classList.remove('hidden');
  ovBtns.classList.add('hidden');
  ovMain.textContent = label;
  ovMain.style.color = '#eae7f5';
  ovSub.textContent = '';
}

function scoreBasket(p) {
  p.score += ball.pts;
  lastScorer = p.id;
  hudScore[p.id].textContent = p.score;
  sfxScore();
  if (ball.pts === 3) sfxThree();
  if (ball.swish) sfxSwish();
  spawnNetFx();
  addFloater(ball.x, RIM.y - 20, '+' + ball.pts, p.color, 1.6);
  if (ball.pts === 3) addFloater(ball.x, RIM.y - 48, '3ポイント！', '#ffd166', 1.0);
  shakeT = ball.pts === 3 ? 260 : 140;

  if (!overtime && p.score >= TARGET) { endMatch(p); return; }
  if (overtime) { endMatch(p); return; }
  state = 'basket';
  basketT = 1400;
  ball.state = 'loose';
  ball.vx *= .25; ball.vy = 150;
}

function checkBall(possessionId) {
  const off = players[possessionId], def = players[1 - possessionId];
  off.x = 300; off.y = FLOOR_Y; off.vx = off.vy = 0; off.face = 1;
  off.onGround = true; off.stunT = 0; off.charging = false; off.charge = 0;
  def.x = 580; def.y = FLOOR_Y; def.vx = def.vy = 0; def.face = -1;
  def.onGround = true; def.stunT = 0; def.charging = false; def.charge = 0;
  players.forEach((p) => { p.hasBall = false; p.stealCd = 0; p.armT = 0; });
  off.hasBall = true;
  ball.state = 'held'; ball.owner = off; ball.shotBy = null;
  updateMarks();
  state = 'checkball';
  checkT = 1100;
  overlay.classList.remove('hidden');
  ovBtns.classList.add('hidden');
  ovMain.textContent = 'チェックボール';
  ovMain.style.color = '#eae7f5';
  ovSub.textContent = off.name + ' の攻撃';
}

function endMatch(champ) {
  state = 'matchend';
  sfxBuzzer();
  setTimeout(sfxWin, 350);
  overlay.classList.remove('hidden');
  ovBtns.classList.remove('hidden');
  const loser = players.find((p) => p !== champ);
  ovMain.textContent = '🏆 ' + champ.name + ' の勝利！';
  ovMain.style.color = champ.color;
  ovSub.textContent = `${players[0].name} ${players[0].score} - ${players[1].score} ${players[1].name}　（${loser.name} ☹️）`;
  clockEl.classList.remove('urgent');
}

function regulationEnd() {
  if (players[0].score !== players[1].score) {
    endMatch(players[0].score > players[1].score ? players[0] : players[1]);
    return;
  }
  overtime = true;
  sfxBuzzer();
  const pos = lastScorer === -1 ? 1 : 1 - lastScorer;
  targetEl.textContent = 'サドンデス — 先取点！';
  checkBall(pos);
  ovMain.textContent = 'サドンデス！';
  ovSub.textContent = '先に1本決めた方が勝ち — ' + players[pos].name + ' の攻撃';
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

function updateMarks() {
  players.forEach((p, i) => marks[i].classList.toggle('on', p.hasBall));
}

/* ================= シュート ================= */
function shoot(p) {
  const c = p.charge;
  p.charge = 0;
  const rx = ball.x, ry = ball.y;
  const tx = RIM.x - RIM.w / 2, ty = RIM.y;
  const dx = tx - rx;
  const apexY = Math.min(ry, ty) - (105 + 0.32 * Math.abs(dx));
  const g = GRAV_B;
  const t1 = Math.sqrt(2 * Math.max(1, ry - apexY) / g);
  const t2 = Math.sqrt(2 * Math.max(1, ty - apexY) / g);
  let vx = dx / (t1 + t2);
  let vy = -g * t1;
  const m = 0.45 + 0.8 * c;
  const swish = Math.abs(m - 1) <= SWEET_WIN;
  if (!swish) { vx *= m; vy *= m; }

  p.hasBall = false; p.charging = false;
  ball.state = 'shot';
  ball.owner = null;
  ball.shotBy = p;
  ball.pts = Math.abs(dx) > THREE_D ? 3 : 2;
  ball.swish = swish;
  ball.touchedRim = false;
  ball.vx = vx; ball.vy = vy;
  ball.noPick = p.id;
  ball.noPickUntil = performance.now() + 450;
  sfxShoot();
  updateMarks();
}

function trySteal(p) {
  const o = players[1 - p.id];
  if (!o.hasBall) return;
  const dx = o.x - p.x, dy = o.y - p.y;
  const facingOk = Math.sign(dx) === p.face || Math.abs(dx) < 26;
  if (Math.abs(dx) < STEAL_RANGE && Math.abs(dy) < 66 && facingOk) {
    o.hasBall = false; o.charging = false; o.charge = 0; o.stunT = STUN_MS;
    ball.state = 'loose'; ball.owner = null; ball.shotBy = null;
    ball.x = o.x + p.face * 12; ball.y = o.y - 30;
    ball.vx = p.face * 210 + (Math.random() * 60 - 30);
    ball.vy = -200;
    ball.noPick = o.id; ball.noPickUntil = performance.now() + 350;
    sfxSteal();
    addFloater(o.x, o.y - o.h - 18, 'スティール！', p.color, 0.9);
    spawnBurst(ball.x, ball.y, p.color, 10);
    updateMarks();
  }
}

/* ================= 更新 ================= */
function updatePlayer(p, dt) {
  const dtS = dt / 1000;
  if (p.stunT > 0) p.stunT -= dt;
  if (p.stealCd > 0) p.stealCd -= dt;
  if (p.armT > 0) p.armT -= dt;

  const m = moveHeld[p.id];
  let dir = 0;
  if (p.stunT <= 0) {
    if (m.left) dir -= 1;
    if (m.right) dir += 1;
  }
  if (dir !== 0) p.face = dir;

  const speedMul = (p.charging ? 0.32 : 1) * (p.stunT > 0 ? 0.25 : 1);
  const target = dir * RUN_SPEED * speedMul;
  const acc = (p.onGround ? ACCEL : ACCEL * AIR_CTRL);
  if (dir !== 0) {
    p.vx += Math.sign(target - p.vx) * acc * dtS;
    if (Math.abs(p.vx) > Math.abs(target)) p.vx = target;
  } else {
    const fr = (p.onGround ? FRICTION : FRICTION * 0.35) * dtS;
    if (Math.abs(p.vx) <= fr) p.vx = 0; else p.vx -= Math.sign(p.vx) * fr;
  }

  p.vy += GRAV_P * dtS;
  p.x += p.vx * dtS;
  p.y += p.vy * dtS;

  const hw = p.w / 2;
  if (p.x < LEFT_WALL + hw) { p.x = LEFT_WALL + hw; if (p.vx < 0) p.vx = 0; }
  if (p.x > RIGHT_WALL - hw) { p.x = RIGHT_WALL - hw; if (p.vx > 0) p.vx = 0; }
  if (p.y >= FLOOR_Y) {
    if (!p.onGround && p.vy > 420) sfxDribble();
    p.y = FLOOR_Y; p.vy = 0; p.onGround = true;
  } else {
    p.onGround = false;
  }

  if (p.charging) {
    p.charge = Math.min(1, p.charge + dt / CHARGE_MS);
  }
  if (p.onGround && Math.abs(p.vx) > 40) p.stepT += dt * Math.abs(p.vx) / 200;
}

function separatePlayers() {
  const [a, b] = players;
  const dx = b.x - a.x;
  const overlapX = (a.w / 2 + b.w / 2) - Math.abs(dx);
  const overlapY = Math.min(a.y, b.y) - Math.max(a.y - a.h, b.y - b.h);
  if (overlapX > 0 && overlapY > 6) {
    const push = overlapX / 2 + 0.5;
    const s = dx >= 0 ? 1 : -1;
    a.x -= push * s; b.x += push * s;
    a.x = Math.max(LEFT_WALL + a.w / 2, Math.min(RIGHT_WALL - a.w / 2, a.x));
    b.x = Math.max(LEFT_WALL + b.w / 2, Math.min(RIGHT_WALL - b.w / 2, b.x));
  }
}

function bounceOffCircle(b, cx, cy, r, rest) {
  const dx = b.x - cx, dy = b.y - cy;
  const d = Math.hypot(dx, dy), min = BALL_R + r;
  if (d >= min || d === 0) return false;
  const nx = dx / d, ny = dy / d;
  b.x = cx + nx * min; b.y = cy + ny * min;
  const vn = b.vx * nx + b.vy * ny;
  if (vn < 0) {
    b.vx -= (1 + rest) * vn * nx;
    b.vy -= (1 + rest) * vn * ny;
  }
  return true;
}

function updateBall(dt) {
  const b = ball;
  const dtS = dt / 1000;
  b.rot += b.vx * dtS * 0.04;

  if (b.state === 'held') {
    const o = b.owner;
    if (o.charging) {
      b.x += ((o.x + o.face * 6) - b.x) * 0.35;
      b.y += ((o.y - o.h - 16) - b.y) * 0.35;
    } else {
      dribbleT += dt;
      const phase = (dribbleT % 340) / 340;
      const bounce = Math.abs(Math.sin(phase * Math.PI)) * 26;
      b.x = o.x + o.face * 17;
      b.y = o.y - 12 - (26 - bounce);
      const down = bounce > 23;
      if (down && !lastDribbleDown && state === 'play') sfxDribble();
      lastDribbleDown = down;
    }
    return;
  }

  const prevY = b.y;
  b.vy += GRAV_B * dtS;
  b.x += b.vx * dtS;
  b.y += b.vy * dtS;

  // 壁
  if (b.x < LEFT_WALL + BALL_R) { b.x = LEFT_WALL + BALL_R; b.vx = Math.abs(b.vx) * 0.6; sfxBoard(); }
  if (b.x > RIGHT_WALL - BALL_R) { b.x = RIGHT_WALL - BALL_R; b.vx = -Math.abs(b.vx) * 0.6; sfxBoard(); }

  // 床
  if (b.y > FLOOR_Y - BALL_R) {
    b.y = FLOOR_Y - BALL_R;
    if (Math.abs(b.vy) > 60) { b.vy = -b.vy * 0.62; sfxDribble(); }
    else { b.vy = 0; b.vx *= 0.82; }
    if (b.state === 'shot') {
      b.state = 'loose';
      if (!b.touchedRim && b.shotBy) {
        addFloater(b.shotBy.x, b.shotBy.y - b.shotBy.h - 20, 'エアボール ☹️', '#8a86a3', 1.2);
      }
    }
  }

  // バックボード
  if (b.x + BALL_R > BOARD.x && b.x - BALL_R < BOARD.x + BOARD.w &&
      b.y + BALL_R > BOARD.y && b.y - BALL_R < BOARD.y + BOARD.h) {
    if (b.x < BOARD.x && b.vx > 0) { b.x = BOARD.x - BALL_R; b.vx = -b.vx * 0.55; }
    else if (b.x > BOARD.x + BOARD.w && b.vx < 0) { b.x = BOARD.x + BOARD.w + BALL_R; b.vx = -b.vx * 0.55; }
    else if (b.y < BOARD.y && b.vy > 0) { b.y = BOARD.y - BALL_R; b.vy = -b.vy * 0.55; }
    else { b.y = BOARD.y + BOARD.h + BALL_R; b.vy = Math.abs(b.vy) * 0.55; }
    b.touchedRim = true;
    sfxBoard();
  }

  // リム両端（小さな円として反射）
  if (bounceOffCircle(b, RIM.x - RIM.w, RIM.y, 3.5, 0.5) ||
      bounceOffCircle(b, RIM.x, RIM.y, 3.5, 0.5)) {
    b.touchedRim = true;
    sfxRim();
  }

  // ゴール判定: リム面を上から下へ通過
  if (b.state === 'shot' && b.vy > 0 && prevY < RIM.y && b.y >= RIM.y &&
      b.x > RIM.x - RIM.w + BALL_R * 0.6 && b.x < RIM.x - BALL_R * 0.6) {
    scoreBasket(b.shotBy);
    return;
  }

  // プレイヤーとの接触
  const now = performance.now();
  for (const p of players) {
    const px = p.x, py = p.y - p.h / 2;
    const dx = b.x - px, dy = b.y - py;
    const rr = BALL_R + p.w / 2 + 8;
    if (dx * dx + dy * dy > rr * rr) continue;

    if (b.state === 'shot') {
      if (b.shotBy !== p) {
        // ブロック！
        b.state = 'loose';
        b.vx = dx * 6 + p.vx * 0.5;
        b.vy = Math.max(140, b.vy * 0.3);
        b.shotBy = null;
        b.noPick = -1;
        sfxBlock();
        shakeT = 220;
        addFloater(p.x, p.y - p.h - 20, 'ブロック！', p.color, 1.1);
        spawnBurst(b.x, b.y, p.color, 16);
        break;
      } else if (now >= b.noPickUntil) {
        pickUp(p);
        break;
      }
    } else if (b.state === 'loose') {
      if (now >= b.noPickUntil || b.noPick !== p.id) pickUp(p);
      break;
    }
  }
}

function pickUp(p) {
  players.forEach((q) => { q.hasBall = false; q.charging = false; });
  p.hasBall = true;
  ball.state = 'held'; ball.owner = p; ball.shotBy = null;
  sfxPickup();
  updateMarks();
}

function updateTimers(dt) {
  if (overtime) return;
  regT -= dt;
  if (regT <= 0) {
    regT = 0;
    if (ball.state !== 'shot') regulationEnd();
  } else if (regT < 10000) {
    clockEl.classList.add('urgent');
    if (Math.floor((regT + dt) / 1000) !== Math.floor(regT / 1000)) sfxTick();
  }
}

function updateFx(dt) {
  const dtS = dt / 1000;
  particles = particles.filter((pt) => {
    pt.t += dtS;
    if (pt.t >= pt.life) return false;
    pt.x += pt.vx * dtS; pt.y += pt.vy * dtS;
    pt.vy += (pt.grav || 0) * dtS;
    return true;
  });
  floaters = floaters.filter((f) => {
    f.t += dtS;
    f.y += f.vy * dtS;
    return f.t < f.life;
  });
}

/* ================= パーティクル等 ================= */
function spawnBurst(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 200;
    particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      life: .3 + Math.random() * .4, t: 0, color, size: 2 + Math.random() * 3, grav: 300 });
  }
}
function spawnNetFx() {
  for (let i = 0; i < 18; i++) {
    const a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 140;
    particles.push({ x: RIM.x - RIM.w / 2, y: RIM.y + 6,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40,
      life: .4 + Math.random() * .4, t: 0, color: '#ffd166', size: 2 + Math.random() * 3, grav: 200 });
  }
}
function addFloater(x, y, text, color, life) {
  floaters.push({ x, y, vy: -34, text, color, t: 0, life });
}

/* ================= 描画 ================= */
function drawCourt() {
  // 床
  const grd = ctx.createLinearGradient(0, FLOOR_Y, 0, H);
  grd.addColorStop(0, '#2a2540');
  grd.addColorStop(1, '#1a1730');
  ctx.fillStyle = grd;
  ctx.fillRect(0, FLOOR_Y, W, H - FLOOR_Y);

  // 壁
  ctx.fillStyle = '#181527';
  ctx.fillRect(0, 0, LEFT_WALL, H);
  ctx.fillRect(RIGHT_WALL, 0, W - RIGHT_WALL, H);

  // フロアライン
  ctx.strokeStyle = 'rgba(255,255,255,.5)';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(LEFT_WALL, FLOOR_Y); ctx.lineTo(RIGHT_WALL, FLOOR_Y); ctx.stroke();

  // センターサークル（ハーフコートの端）
  ctx.strokeStyle = 'rgba(255,255,255,.14)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(LEFT_WALL, FLOOR_Y - 110, 90, 0, Math.PI * 2); ctx.stroke();

  // 3ptライン
  const cx = RIM.x - RIM.w / 2;
  ctx.strokeStyle = 'rgba(240,146,63,.5)';
  ctx.setLineDash([8, 7]);
  ctx.beginPath();
  ctx.arc(cx, FLOOR_Y, THREE_D, Math.PI, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(240,146,63,.55)';
  ctx.font = '11px sans-serif';
  ctx.fillText('3PT', LEFT_WALL + 12, FLOOR_Y - 8);

  // ペイントエリア
  ctx.strokeStyle = 'rgba(255,255,255,.12)';
  ctx.strokeRect(RIM.x - 140, FLOOR_Y - 130, 140 + (RIGHT_WALL - RIM.x), 130);

  // ゴールポスト（右壁に固定）
  ctx.strokeStyle = '#3d3860';
  ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(BOARD.x + BOARD.w / 2, BOARD.y + 10); ctx.lineTo(RIGHT_WALL, BOARD.y - 14); ctx.stroke();
}

function drawHoop(back) {
  if (back) {
    // バックボード
    ctx.fillStyle = 'rgba(220,225,255,.16)';
    ctx.strokeStyle = 'rgba(255,255,255,.75)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(BOARD.x, BOARD.y, BOARD.w, BOARD.h, 3);
    ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.5)';
    ctx.strokeRect(BOARD.x - 1, RIM.y - 26, 1, 24);
    // ネット（簡易）
    ctx.strokeStyle = 'rgba(255,255,255,.4)';
    ctx.lineWidth = 1.5;
    const top = RIM.y + 2, bot = RIM.y + 26;
    for (let i = 0; i <= 4; i++) {
      const x0 = RIM.x - RIM.w + (RIM.w / 4) * i;
      const x1 = RIM.x - RIM.w * 0.78 + (RIM.w * 0.56 / 4) * i;
      ctx.beginPath(); ctx.moveTo(x0, top); ctx.lineTo(x1, bot); ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(RIM.x - RIM.w, top + 8); ctx.lineTo(RIM.x - RIM.w * 0.15, top + 8);
    ctx.moveTo(RIM.x - RIM.w * 0.88, bot - 9); ctx.lineTo(RIM.x - RIM.w * 0.2, bot - 9);
    ctx.stroke();
  } else {
    // リム
    ctx.strokeStyle = '#ff7a3d';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(RIM.x - RIM.w, RIM.y); ctx.lineTo(RIM.x + 1, RIM.y); ctx.stroke();
    ctx.fillStyle = '#ff7a3d';
    ctx.beginPath(); ctx.arc(RIM.x - RIM.w, RIM.y, 3.5, 0, Math.PI * 2); ctx.fill();
  }
}

function drawPlayer(p) {
  const x = p.x, feet = p.y;
  const bob = p.onGround && Math.abs(p.vx) > 40 ? Math.sin(p.stepT * 0.06) * 2 : 0;
  const y = feet - bob;

  // 影
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.beginPath();
  ctx.ellipse(p.x, FLOOR_Y + 6, p.w * 0.7, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  if (p.stunT > 0) ctx.translate(Math.sin(p.stunT * 0.08) * 1.5, 0);

  // 体（カプセル）
  ctx.fillStyle = p.color;
  ctx.strokeStyle = p.glow;
  ctx.lineWidth = 2;
  ctx.shadowColor = p.color; ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.roundRect(x - p.w / 2, y - p.h + 14, p.w, p.h - 14, 10);
  ctx.fill(); ctx.stroke();
  ctx.shadowBlur = 0;

  // ジャージの番号風マーク
  ctx.fillStyle = 'rgba(15,14,26,.55)';
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(String(p.id + 1), x, y - p.h + 38);

  // 頭
  ctx.fillStyle = COL_SKIN;
  ctx.beginPath(); ctx.arc(x, y - p.h + 2, 11, 0, Math.PI * 2); ctx.fill();

  // 目（向いている方向）
  ctx.fillStyle = '#0f0e1a';
  const ex = p.face * 4;
  ctx.beginPath();
  ctx.arc(x + ex - 3, y - p.h, 1.8, 0, Math.PI * 2);
  ctx.arc(x + ex + 3, y - p.h, 1.8, 0, Math.PI * 2);
  ctx.fill();

  // スティールの腕
  if (p.armT > 0) {
    ctx.strokeStyle = p.glow;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x + p.face * 6, y - p.h + 24);
    ctx.lineTo(x + p.face * (p.w / 2 + 16), y - p.h + 18);
    ctx.stroke();
  }

  // チャージ中は両手を上げる
  if (p.charging && p.hasBall) {
    ctx.strokeStyle = COL_SKIN;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(x - 8, y - p.h + 26); ctx.lineTo(x + p.face * 2, y - p.h - 4);
    ctx.moveTo(x + 8, y - p.h + 26); ctx.lineTo(x + p.face * 10, y - p.h - 4);
    ctx.stroke();
  }
  ctx.restore();

  // 名前ラベル
  ctx.fillStyle = p.color;
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(p.name, x, y + 16);

  // チャージメーター
  if (p.charging && p.hasBall) drawChargeMeter(p);
}

function drawChargeMeter(p) {
  const mw = 7, mh = 52;
  const mx = p.x - p.w / 2 - 16, my = p.y - p.h - mh - 6;
  ctx.fillStyle = 'rgba(15,14,26,.8)';
  ctx.strokeStyle = 'rgba(255,255,255,.3)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(mx - 2, my - 2, mw + 4, mh + 4, 4); ctx.fill(); ctx.stroke();

  // スイートゾーン
  const zy = my + mh * (1 - SWEET - SWEET_WIN * 2);
  const zh = mh * SWEET_WIN * 4;
  ctx.fillStyle = 'rgba(120,255,140,.35)';
  ctx.fillRect(mx, zy, mw, zh);
  ctx.strokeStyle = '#7cff8c';
  ctx.beginPath(); ctx.moveTo(mx - 3, my + mh * (1 - SWEET)); ctx.lineTo(mx + mw + 3, my + mh * (1 - SWEET)); ctx.stroke();

  // 充填
  const fh = mh * p.charge;
  const inZone = Math.abs((0.45 + 0.8 * p.charge) - 1) <= SWEET_WIN;
  ctx.fillStyle = inZone ? '#7cff8c' : p.color;
  ctx.fillRect(mx, my + mh - fh, mw, fh);

  // 予測弾道
  drawTrajectory(p);
}

function drawTrajectory(p) {
  const m = 0.45 + 0.8 * p.charge;
  const rx = ball.x, ry = ball.y;
  const tx = RIM.x - RIM.w / 2, ty = RIM.y;
  const dx = tx - rx;
  const apexY = Math.min(ry, ty) - (105 + 0.32 * Math.abs(dx));
  const g = GRAV_B;
  const t1 = Math.sqrt(2 * Math.max(1, ry - apexY) / g);
  const t2 = Math.sqrt(2 * Math.max(1, ty - apexY) / g);
  let vx = dx / (t1 + t2), vy = -g * t1;
  if (Math.abs(m - 1) > SWEET_WIN) { vx *= m; vy *= m; }

  let sx = rx, sy = ry, svx = vx, svy = vy;
  const step = 0.045;
  ctx.fillStyle = 'rgba(255,255,255,.5)';
  for (let i = 0; i < 34; i++) {
    svy += g * step;
    sx += svx * step;
    sy += svy * step;
    if (sy > FLOOR_Y) break;
    if (i % 2 === 0) {
      ctx.globalAlpha = Math.max(0.08, 0.55 - i * 0.016);
      ctx.beginPath(); ctx.arc(sx, sy, 2.2, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

function drawBall() {
  const b = ball;
  ctx.save();
  ctx.translate(b.x, b.y);
  ctx.rotate(b.rot * 0.2);
  ctx.fillStyle = COL_BALL;
  ctx.strokeStyle = '#8a4b12';
  ctx.lineWidth = 1.5;
  ctx.shadowColor = COL_BALL; ctx.shadowBlur = b.state === 'shot' ? 14 : 6;
  ctx.beginPath(); ctx.arc(0, 0, BALL_R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.shadowBlur = 0;
  // 縫い目
  ctx.beginPath(); ctx.moveTo(-BALL_R, 0); ctx.lineTo(BALL_R, 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -BALL_R); ctx.lineTo(0, BALL_R); ctx.stroke();
  ctx.beginPath(); ctx.arc(-BALL_R, 0, BALL_R, -Math.PI / 2, Math.PI / 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(BALL_R, 0, BALL_R, Math.PI / 2, Math.PI * 1.5); ctx.stroke();
  ctx.restore();
}

function render(dt) {
  ctx.clearRect(0, 0, W, H);
  drawCourt();
  drawHoop(true);

  if (shakeT > 0) {
    const s = 4;
    ctx.save();
    ctx.translate((Math.random() - .5) * s, (Math.random() - .5) * s);
  }
  players.forEach(drawPlayer);
  drawBall();
  drawHoop(false);

  // パーティクル
  particles.forEach((pt) => {
    ctx.globalAlpha = Math.max(0, 1 - pt.t / pt.life);
    ctx.fillStyle = pt.color;
    ctx.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
  });
  ctx.globalAlpha = 1;

  // フローター
  floaters.forEach((f) => {
    ctx.globalAlpha = Math.max(0, 1 - f.t / f.life);
    ctx.fillStyle = f.color;
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(f.text, f.x, f.y);
  });
  ctx.globalAlpha = 1;

  if (shakeT > 0) { ctx.restore(); shakeT = Math.max(0, shakeT - dt); }

  // 時計
  if (!overtime) {
    const s = Math.ceil(regT / 1000);
    clockEl.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  } else {
    clockEl.textContent = 'OT';
    clockEl.classList.add('urgent');
  }
}

/* ================= メインループ ================= */
let lastTs = 0;
function loop(ts) {
  requestAnimationFrame(loop);
  const dt = Math.min(50, ts - lastTs || 16);
  lastTs = ts;

  if (state === 'countdown') {
    countdownT -= dt;
    const n = Math.ceil((countdownT - 400) / 800);
    if (n !== lastCount) {
      lastCount = n;
      if (n > 0) { ovMain.textContent = String(n); ovMain.style.color = '#eae7f5'; sfxTick(); }
      else if (n === 0) { ovMain.textContent = 'GO!'; ovMain.style.color = '#f0923f'; sfxGo(); }
    }
    if (countdownT <= -350) { overlay.classList.add('hidden'); state = 'play'; }
  } else if (state === 'play' && !paused) {
    players.forEach((p) => updatePlayer(p, dt));
    separatePlayers();
    updateBall(dt);
    updateTimers(dt);
  } else if (state === 'basket') {
    players.forEach((p) => updatePlayer(p, dt));
    separatePlayers();
    updateBall(dt);
    basketT -= dt;
    if (basketT <= 0) checkBall(1 - lastScorer);
  } else if (state === 'checkball') {
    checkT -= dt;
    if (checkT <= 0) { overlay.classList.add('hidden'); state = 'play'; }
  }
  updateFx(dt);
  if (state !== 'title') render(dt);
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
