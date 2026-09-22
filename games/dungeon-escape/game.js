'use strict';

/* ================= 定数 ================= */
const TILE = 40, COLS = 24, ROWS = 15;
const W = COLS * TILE, H = ROWS * TILE;
const P1_COLOR = '#ff6b9d', P2_COLOR = '#4ecdc4';
const SPEED = 165, PR = 13;          // プレイヤー速度(px/s)・半径
const BAT_R = 14;

/* ================= レベル =================
   マップ文字: #=かべ .=ゆか 1,2=スポーン s=赤スイッチ g=金スイッチ
   d=赤とびら(押している間だけ開く) e=金とびら(同時押しで永久に開く)
   *=ほうせき x=ゴール                                      */
const LEVELS = [
  {
    title: 'Floor 1: Hold the Switches',
    hint: 'Red doors open while a switch is held down',
    map: [
      '########################',
      '#..........#...........#',
      '#.s........#.........x.#',
      '#..........#...........#',
      '#....*.....#.....*.....#',
      '#..........#...........#',
      '#.1........#...........#',
      '#..........d.....s.....#',
      '#.2........#...........#',
      '#..........#...........#',
      '#.s........#.........x.#',
      '#..........#...........#',
      '#....*.....#.....*.....#',
      '#..........#...........#',
      '########################',
    ],
    enemies: [],
  },
  {
    title: 'Floor 2: Twin Switches',
    hint: 'Gold switches need both of you pressing at once!',
    map: [
      '########################',
      '#..........#...........#',
      '#.g........#...........#',
      '#....##....#...........#',
      '#.1.##.....#.........x.#',
      '#....##....#...........#',
      '#....##....#...........#',
      '#..........e......*....#',
      '#....##....#...........#',
      '#....##....#...........#',
      '#.2.##.....#.........x.#',
      '#....##....#...........#',
      '#.g........#...........#',
      '#..........#...........#',
      '########################',
    ],
    enemies: [
      { x: 17, y: 4,  dx: 0, dy: 1,  sp: 62 },
      { x: 17, y: 10, dx: 0, dy: -1, sp: 62 },
      { x: 13, y: 7,  dx: 1, dy: 0,  sp: 78, bounds: [12, 7, 22, 7] },
    ],
  },
  {
    title: 'Floor 3: The Final Dungeon',
    hint: 'Slip through the doors, dodge the bats, and reach the goals together!',
    map: [
      '########################',
      '#..........#...........#',
      '#.s........#...........#',
      '#..........#...........#',
      '#.1........#........x..#',
      '#..........d...........#',
      '#..........#.....*.....#',
      '#..........#...........#',
      '#..........d...s.......#',
      '#.2........#...........#',
      '#..........#........x..#',
      '#..........#...........#',
      '#.s........#...........#',
      '#..........#...........#',
      '########################',
    ],
    enemies: [
      { x: 17, y: 2,  dx: 0, dy: 1,  sp: 66 },
      { x: 14, y: 7,  dx: 1, dy: 0,  sp: 82, bounds: [12, 7, 22, 7] },
      { x: 17, y: 12, dx: 0, dy: -1, sp: 66 },
    ],
  },
];

/* ================= DOM ================= */
const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');
const $ = id => document.getElementById(id);
const el = {
  floor: $('hudFloor'), hint: $('hudHint'), time: $('hudTime'),
  gems: $('hudGems'), miss: $('hudMiss'),
  p1name: $('p1name'), p2name: $('p2name'),
  padname1: $('padname1'), padname2: $('padname2'),
  banner: $('banner'), flash: $('flash'),
  title: $('titleScreen'), pause: $('pauseScreen'), result: $('resultScreen'),
  name1: $('name1'), name2: $('name2'),
  resTime: $('resTime'), resMiss: $('resMiss'), resGems: $('resGems'),
  resMsg: $('resMsg'), rank: $('rank'),
  titleFace1: $('titleFace1'), titleFace2: $('titleFace2'),
  hudFace1: $('hudFace1'), hudFace2: $('hudFace2'),
  resFace1: $('resFace1'), resFace2: $('resFace2'),
};

/* ================= サウンド ================= */
let actx = null, muted = false;
function ensureAudio() {
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { } }
  if (actx && actx.state === 'suspended') actx.resume();
}
function tone(f, dur = .12, type = 'square', vol = .1, slideTo = null, delay = 0) {
  if (!actx || muted) return;
  const t0 = actx.currentTime + delay;
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(.001, t0 + dur);
  o.connect(g).connect(actx.destination);
  o.start(t0); o.stop(t0 + dur + .02);
}
const sfx = {
  press()  { tone(560, .07, 'square', .09); tone(840, .07, 'square', .07, null, .05); },
  release(){ tone(330, .08, 'square', .07); },
  door()   { tone(200, .35, 'sawtooth', .07, 640); },
  latch()  { [523, 784, 1046].forEach((f, i) => tone(f, .13, 'square', .11, null, i * .1)); },
  gem()    { tone(920, .08, 'sine', .13); tone(1380, .14, 'sine', .12, null, .07); },
  hit()    { tone(220, .3, 'sawtooth', .15, 70); },
  heart()  { tone(660, .07, 'sine', .09); tone(990, .1, 'sine', .09, null, .07); },
  clear()  { [523, 659, 784, 1046].forEach((f, i) => tone(f, .15, 'triangle', .13, null, i * .11)); },
  win()    { [523, 659, 784, 880, 1046, 1318, 1568].forEach((f, i) => tone(f, .2, 'triangle', .14, null, i * .13)); },
  go()     { tone(440, .1, 'square', .1); tone(880, .18, 'square', .11, null, .12); },
};

/* ================= キャラクター (koto=P1, zuza=P2) ================= */
const SKIN_C = '#f6d7bd', SKIN2_C = '#f0cfae';
const HAIR_KOTO = '#171320', HAIR_ZUZA = '#3a2a1e';
const CHAR_SHIRT = '#0d0c14', CHAR_CHAIN = '#d4d8e2', CHAR_GLASS = '#0a0a12';

// 見た目は名前に合わせる（不明な名前なら P1=koto, P2=zuza）
function pickChar(i, name) {
  const n = (name || '').trim().toLowerCase();
  if (n === 'koto' || n === 'zuza') return n;
  return i === 0 ? 'koto' : 'zuza';
}

function drawKoto(c, dx, dy, sad) {
  // 後ろ髪（ぱっつんマッシュ）
  c.fillStyle = HAIR_KOTO;
  c.beginPath(); c.ellipse(0, -4.5, 9.8, 9.2, 0, 0, 7); c.fill();

  // 黒シャツ
  c.fillStyle = CHAR_SHIRT;
  c.beginPath(); c.roundRect(-9, 3, 18, 12.5, 5); c.fill();

  // 手
  c.fillStyle = SKIN_C;
  c.beginPath(); c.arc(-9.6, 9.5, 2, 0, 7); c.arc(9.6, 9.5, 2, 0, 7); c.fill();

  // 左の手首に腕時計
  c.fillStyle = '#20242f';
  c.beginPath(); c.roundRect(-11.9, 7.1, 4.6, 2.1, 1); c.fill();
  c.fillStyle = '#0d0f18';
  c.beginPath(); c.arc(-9.6, 8.2, 1.7, 0, 7); c.fill();
  c.strokeStyle = CHAR_CHAIN; c.lineWidth = .7;
  c.beginPath(); c.arc(-9.6, 8.2, 1.7, 0, 7); c.stroke();
  c.lineWidth = .5;
  c.beginPath(); c.moveTo(-9.6, 8.2); c.lineTo(-9.1, 7.5); c.stroke();

  // 銀チェーンのネックレス
  c.strokeStyle = CHAR_CHAIN; c.lineWidth = 1.1;
  c.beginPath(); c.arc(0, 3.4, 4.6, Math.PI * .16, Math.PI * .84); c.stroke();

  // 顔
  c.fillStyle = SKIN_C;
  c.beginPath(); c.arc(0, -4, 7.6, 0, 7); c.fill();

  // 重めのぱっつん前髪
  c.fillStyle = HAIR_KOTO;
  c.beginPath();
  c.moveTo(-8.4, -4.6);
  c.lineTo(-8.4, -5.8);
  c.quadraticCurveTo(0, -13.2, 8.4, -5.8);
  c.lineTo(8.4, -4.6);
  c.closePath(); c.fill();
  // ほおの横まで下りるサイドの毛束
  c.beginPath(); c.roundRect(-8.6, -6.5, 2.6, 6.5, 1.3); c.fill();
  c.beginPath(); c.roundRect(6, -6.5, 2.6, 6.5, 1.3); c.fill();

  if (sad) {
    c.strokeStyle = '#171320'; c.lineWidth = 1.1;
    c.beginPath(); c.arc(-2.7, -3.2, 1.5, Math.PI * 1.15, Math.PI * 1.85); c.stroke();
    c.beginPath(); c.arc(2.7, -3.2, 1.5, Math.PI * 1.15, Math.PI * 1.85); c.stroke();
    c.beginPath(); c.arc(0, 1.6, 2, Math.PI * 1.2, Math.PI * 1.8); c.stroke();
  } else {
    // 目（進行方向にずらす）
    c.fillStyle = '#171320';
    c.beginPath();
    c.ellipse(-2.7 + dx * 1.6, -3.2 + dy * 1.2, 1.15, 1.5, 0, 0, 7);
    c.ellipse(2.7 + dx * 1.6, -3.2 + dy * 1.2, 1.15, 1.5, 0, 0, 7);
    c.fill();
    // 小さな笑顔
    c.strokeStyle = '#171320'; c.lineWidth = .9;
    c.beginPath(); c.arc(0, -0.6, 1.7, Math.PI * .25, Math.PI * .75); c.stroke();
  }
}

function drawZuza(c, dx, dy, sad) {
  // 肩よりずっと下まで伸びる長い直毛
  c.fillStyle = HAIR_ZUZA;
  c.beginPath(); c.roundRect(-10.6, -13.5, 21.2, 31, 9); c.fill();

  // 黒い服
  c.fillStyle = CHAR_SHIRT;
  c.beginPath(); c.roundRect(-8.5, 3, 17, 12.5, 5); c.fill();

  // 手
  c.fillStyle = SKIN2_C;
  c.beginPath(); c.arc(-9.2, 9.5, 2, 0, 7); c.arc(9.2, 9.5, 2, 0, 7); c.fill();

  // 顔
  c.fillStyle = SKIN2_C;
  c.beginPath(); c.arc(0, -4.2, 7.8, 0, 7); c.fill();

  // 額に落ちる直毛
  c.fillStyle = HAIR_ZUZA;
  c.beginPath(); c.ellipse(0, -8.2, 8.8, 4.4, 0, 0, 7); c.fill();
  // 顔の両サイドを胸まで流れる毛束
  c.beginPath(); c.roundRect(-9.4, -7.5, 4, 17, 2); c.fill();
  c.beginPath(); c.roundRect(5.4, -7.5, 4, 17, 2); c.fill();

  // 黒サングラス（進行方向にずらす）
  const sx = dx * 1.3, sy = dy * 1;
  c.fillStyle = CHAR_GLASS;
  c.beginPath(); c.roundRect(-7.2 + sx, -6 + sy, 6.6, 4.6, 2.2); c.fill();
  c.beginPath(); c.roundRect(.6 + sx, -6 + sy, 6.6, 4.6, 2.2); c.fill();
  c.fillRect(-1 + sx, -5 + sy, 2, 1.4);
  c.strokeStyle = 'rgba(255,255,255,.5)'; c.lineWidth = .9;
  c.beginPath(); c.moveTo(-5.6 + sx, -3.4 + sy); c.lineTo(-3.7 + sx, -5.3 + sy); c.stroke();

  c.strokeStyle = '#241a20';
  if (sad) {
    c.lineWidth = 1.1;
    c.beginPath(); c.arc(0, 2.2, 2, Math.PI * 1.2, Math.PI * 1.8); c.stroke();
  } else {
    c.lineWidth = .9;
    c.beginPath(); c.arc(0, 0, 1.7, Math.PI * .25, Math.PI * .75); c.stroke();
  }
}

// キャラ＋プレイヤーカラーのハロー（見分けやすさのため残す）
function drawChar(c, cx, cy, s, char, o = {}) {
  const d = o.dir || { x: 0, y: 0 };
  c.save();
  c.translate(cx, cy);
  if (o.accent) {
    c.save();
    c.shadowColor = o.accent;
    c.shadowBlur = 9;
    c.globalAlpha *= .32;
    c.fillStyle = o.accent;
    c.beginPath(); c.arc(0, 0, 15 * s, 0, 7); c.fill();
    c.restore();
  }
  c.scale(s, s);
  if (char === 'zuza') drawZuza(c, d.x, d.y, !!o.sad);
  else drawKoto(c, d.x, d.y, !!o.sad);
  c.restore();
}

/* ---- タイトル / HUD / リザルトの顔アイコン ---- */
function paintFace(elc, char, i, sad) {
  if (!elc) return;
  const c = elc.getContext('2d');
  c.clearRect(0, 0, elc.width, elc.height);
  drawChar(c, elc.width / 2, elc.height / 2 + 2, elc.width / 36, char,
    { accent: i === 0 ? P1_COLOR : P2_COLOR, sad });
}
function paintNameFaces() {
  paintFace(el.titleFace1, pickChar(0, el.name1.value), 0);
  paintFace(el.titleFace2, pickChar(1, el.name2.value), 1);
}

/* ================= 状態 ================= */
const game = { state: 'title', floor: 0, time: 0, misses: 0, gemsGot: 0, gemsTotal: 0, t: 0 };
let grid = [];            // 壁グリッド
let doors = [], switches = [], gems = [], exits = [], enemies = [], particles = [];
let doorMap = {};         // "tx,ty" -> door
let players = [];
let bannerT = 0, clearT = 0;

LEVELS.forEach(l => l.map.forEach(r => { for (const c of r) if (c === '*') game.gemsTotal++; }));

/* ================= 入力 ================= */
const keymap = {
  KeyW: [0, 'u'], KeyA: [0, 'l'], KeyS: [0, 'd'], KeyD: [0, 'r'], KeyF: [0, 'act'],
  ArrowUp: [1, 'u'], ArrowLeft: [1, 'l'], ArrowDown: [1, 'd'], ArrowRight: [1, 'r'],
  Enter: [1, 'act'],
};
const input = [{ u: 0, d: 0, l: 0, r: 0 }, { u: 0, d: 0, l: 0, r: 0 }];

window.addEventListener('keydown', e => {
  if (game.state === 'play' && keymap[e.code]) e.preventDefault();
  if ((e.code === 'Escape' || e.code === 'KeyP') && (game.state === 'play' || game.state === 'paused')) {
    e.preventDefault(); togglePause(); return;
  }
  if (e.repeat || !keymap[e.code]) return;
  const [p, k] = keymap[e.code];
  if (k === 'act') { if (game.state === 'play') doEmote(p); return; }
  input[p][k] = 1;
});
window.addEventListener('keyup', e => {
  if (!keymap[e.code]) return;
  const [p, k] = keymap[e.code];
  if (k !== 'act') input[p][k] = 0;
});
window.addEventListener('blur', () => { input.forEach(i => { i.u = i.d = i.l = i.r = 0; }); });
document.addEventListener('visibilitychange', () => { if (document.hidden && game.state === 'play') togglePause(); });

// デバッグ: N でフロアスキップ
window.addEventListener('keydown', e => {
  if (e.code === 'KeyN' && game.state === 'play') nextFloor();
});

/* ---- タッチパッド ---- */
document.querySelectorAll('.pbtn').forEach(btn => {
  const pad = btn.closest('.pad');
  const p = +pad.dataset.p, k = btn.dataset.k;
  const press = on => {
    btn.classList.toggle('held', on);
    if (k === 'act') { if (on && game.state === 'play') doEmote(p); return; }
    input[p][k] = on ? 1 : 0;
  };
  btn.addEventListener('pointerdown', e => { e.preventDefault(); btn.setPointerCapture(e.pointerId); press(true); });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev =>
    btn.addEventListener(ev, () => press(false)));
});
document.getElementById('pads').addEventListener('contextmenu', e => e.preventDefault());
document.getElementById('pads').addEventListener('touchstart', e => e.preventDefault(), { passive: false });

/* ================= レベル構築 ================= */
function loadFloor(idx) {
  const L = LEVELS[idx];
  grid = []; doors = []; switches = []; gems = []; exits = []; enemies = []; particles = []; doorMap = {};
  L.map.forEach((row, ty) => {
    grid[ty] = [];
    for (let tx = 0; tx < COLS; tx++) {
      const c = row[tx], px = tx * TILE + TILE / 2, py = ty * TILE + TILE / 2;
      grid[ty][tx] = (c === '#');
      if (c === 's' || c === 'g') switches.push({ tx, ty, x: px, y: py, gold: c === 'g', pressed: false });
      if (c === 'd' || c === 'e') { const dr = { tx, ty, latch: c === 'e', latched: false, openT: 0 }; doors.push(dr); doorMap[tx + ',' + ty] = dr; }
      if (c === '*') gems.push({ x: px, y: py, got: false, bob: Math.random() * 6 });
      if (c === 'x') exits.push({ x: px, y: py, occ: false });
      if (c === '1') players[0].x = players[0].spawn.x = px, players[0].y = players[0].spawn.y = py;
      if (c === '2') players[1].x = players[1].spawn.x = px, players[1].y = players[1].spawn.y = py;
    }
  });
  L.enemies.forEach(d => enemies.push({
    x: d.x * TILE + TILE / 2, y: d.y * TILE + TILE / 2,
    dx: d.dx, dy: d.dy, sp: d.sp, bob: Math.random() * 6,
    bounds: d.bounds ? d.bounds.map(v => v * TILE + TILE / 2) : null,
  }));
  players.forEach(p => { p.invuln = 0; p.emoteCd = 0; });
  game.floor = idx;
  el.floor.textContent = L.title;
  el.hint.textContent = L.hint;
  showBanner(L.title, L.hint, 2.4);
}

function isSolidTile(tx, ty) {
  if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return true;
  if (grid[ty][tx]) return true;
  const dr = doorMap[tx + ',' + ty];
  if (dr && dr.openT < .6) return true;
  return false;
}
function circleHitsSolid(cx, cy, r) {
  const x0 = Math.floor((cx - r) / TILE), x1 = Math.floor((cx + r) / TILE);
  const y0 = Math.floor((cy - r) / TILE), y1 = Math.floor((cy + r) / TILE);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    if (!isSolidTile(tx, ty)) continue;
    const nx = Math.max(tx * TILE, Math.min(cx, tx * TILE + TILE));
    const ny = Math.max(ty * TILE, Math.min(cy, ty * TILE + TILE));
    if ((cx - nx) ** 2 + (cy - ny) ** 2 < r * r) return true;
  }
  return false;
}
function moveCircle(o, dx, dy, r) {
  if (dx && !circleHitsSolid(o.x + dx, o.y, r)) o.x += dx;
  else if (dx) {
    // 壁にめりこまないよう段階的に詰める
    const step = Math.sign(dx);
    while (Math.abs(dx) > 1 && !circleHitsSolid(o.x + step, o.y, r)) { o.x += step; dx -= step; }
  }
  if (dy && !circleHitsSolid(o.x, o.y + dy, r)) o.y += dy;
  else if (dy) {
    const step = Math.sign(dy);
    while (Math.abs(dy) > 1 && !circleHitsSolid(o.x, o.y + step, r)) { o.y += step; dy -= step; }
  }
}
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

/* ================= ゲーム進行 ================= */
function startRun() {
  ensureAudio();
  players = [
    { name: el.name1.value.trim() || 'Player 1', color: P1_COLOR, spawn: {}, x: 0, y: 0, dir: { x: 1, y: 0 }, invuln: 0, emoteCd: 0 },
    { name: el.name2.value.trim() || 'Player 2', color: P2_COLOR, spawn: {}, x: 0, y: 0, dir: { x: 1, y: 0 }, invuln: 0, emoteCd: 0 },
  ];
  players.forEach((p, i) => { p.char = pickChar(i, p.name); });
  el.p1name.textContent = el.padname1.textContent = players[0].name;
  el.p2name.textContent = el.padname2.textContent = players[1].name;
  paintFace(el.hudFace1, players[0].char, 0);
  paintFace(el.hudFace2, players[1].char, 1);
  game.time = 0; game.misses = 0; game.gemsGot = 0;
  el.time.textContent = '0:00';
  el.miss.textContent = '0';
  el.gems.textContent = '0/' + game.gemsTotal;
  loadFloor(0);
  game.state = 'count'; clearT = 1.1;
  showBanner('GO!', 'Escape the dungeon together', 1.1);
  sfx.go();
  el.title.classList.add('hidden');
  el.result.classList.add('hidden');
  document.activeElement && document.activeElement.blur();
}
function nextFloor() {
  if (game.floor + 1 >= LEVELS.length) { winGame(); return; }
  loadFloor(game.floor + 1);
  game.state = 'count'; clearT = 1.0;
}
function floorCleared() {
  game.state = 'clear'; clearT = 1.7;
  showBanner('Floor Clear!', players[0].name + ' & ' + players[1].name + ' — great teamwork!', 1.7, true);
  sfx.clear();
  exits.forEach(e => ring(e.x, e.y, '#ffe082'));
}
function winGame() {
  game.state = 'result';
  sfx.win();
  const t = game.time, mm = fmtTime(t);
  const allGems = game.gemsGot === game.gemsTotal;
  let rank = 'B', msg = 'Escaped! Now try a faster, cleaner run';
  if (t <= 210 && game.misses <= 2 && allGems) { rank = 'S'; msg = 'Perfect! Your bond is unstoppable!'; }
  else if (t <= 330 && game.misses <= 5) { rank = 'A'; msg = 'Amazing teamwork! So close to S rank!'; }
  el.rank.textContent = rank;
  el.resTime.textContent = mm;
  el.resMiss.textContent = game.misses;
  el.resGems.textContent = game.gemsGot + ' / ' + game.gemsTotal;
  el.resMsg.textContent = players[0].name + ' & ' + players[1].name + ': ' + msg;
  // ☹️の代わりにキャラの顔（Bランクはしょんぼり顔）
  paintFace(el.resFace1, players[0].char, 0, rank === 'B');
  paintFace(el.resFace2, players[1].char, 1, rank === 'B');
  el.result.classList.remove('hidden');
  document.activeElement && document.activeElement.blur();
}
function togglePause() {
  if (game.state === 'play') { game.state = 'paused'; el.pause.classList.remove('hidden'); }
  else if (game.state === 'paused') { game.state = 'play'; el.pause.classList.add('hidden'); document.activeElement && document.activeElement.blur(); }
}
function backToTitle() {
  game.state = 'title';
  el.pause.classList.add('hidden');
  el.result.classList.add('hidden');
  el.title.classList.remove('hidden');
}
function fmtTime(t) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return m + ':' + String(s).padStart(2, '0');
}
function showBanner(text, sub, sec, faces) {
  el.banner.innerHTML = '';
  if (faces) {
    [0, 1].forEach(i => {
      const fc = document.createElement('canvas');
      fc.width = fc.height = 48;
      fc.className = 'bface';
      el.banner.appendChild(fc);
      paintFace(fc, players[i].char, i);
    });
  }
  const sp = document.createElement('span');
  sp.className = 'btext';
  sp.innerHTML = text + (sub ? '<small>' + sub + '</small>' : '');
  el.banner.appendChild(sp);
  el.banner.classList.remove('hidden');
  bannerT = sec;
}
function doEmote(p) {
  const pl = players[p];
  if (!pl || pl.emoteCd > 0) return;
  pl.emoteCd = .7;
  particles.push({ type: 'emoji', ch: '💗', x: pl.x, y: pl.y - 18, vy: -46, life: 1.1, t: 0, size: 22 });
  sfx.heart();
}
function playerHit(p) {
  const pl = players[p];
  if (pl.invuln > 0) return;
  game.misses++;
  el.miss.textContent = game.misses;
  sfx.hit();
  flashRed();
  particles.push({ type: 'face', char: pl.char, color: pl.color, x: pl.x, y: pl.y - 16, vy: -34, life: 1.3, t: 0 });
  for (let i = 0; i < 10; i++) spark(pl.x, pl.y, pl.color);
  pl.x = pl.spawn.x; pl.y = pl.spawn.y;
  pl.invuln = 1.5;
}
function flashRed() {
  el.flash.classList.add('on');
  setTimeout(() => el.flash.classList.remove('on'), 60);
}
function spark(x, y, color) {
  const a = Math.random() * Math.PI * 2, v = 40 + Math.random() * 90;
  particles.push({ type: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: .55, t: 0, color });
}
function ring(x, y, color) {
  particles.push({ type: 'ring', x, y, life: .7, t: 0, color });
}

/* ================= 更新 ================= */
function update(dt) {
  if (bannerT > 0) { bannerT -= dt; if (bannerT <= 0) el.banner.classList.add('hidden'); }

  if (game.state === 'count') {
    clearT -= dt; if (clearT <= 0) game.state = 'play';
    return;
  }
  if (game.state === 'clear') {
    clearT -= dt; if (clearT <= 0) nextFloor();
    return;
  }
  if (game.state !== 'play') return;

  game.time += dt;
  el.time.textContent = fmtTime(game.time);

  // ---- プレイヤー移動 ----
  players.forEach((p, i) => {
    const inp = input[i];
    let vx = (inp.r ? 1 : 0) - (inp.l ? 1 : 0);
    let vy = (inp.d ? 1 : 0) - (inp.u ? 1 : 0);
    if (vx && vy) { vx *= Math.SQRT1_2; vy *= Math.SQRT1_2; }
    if (vx || vy) p.dir = { x: vx, y: vy };
    moveCircle(p, vx * SPEED * dt, vy * SPEED * dt, PR);
    if (p.invuln > 0) p.invuln -= dt;
    if (p.emoteCd > 0) p.emoteCd -= dt;
  });

  // ---- スイッチ ----
  switches.forEach(s => {
    const now = players.some(p => dist(p, s) < TILE * .78);
    if (now && !s.pressed) { sfx.press(); ring(s.x, s.y, s.gold ? '#f0b429' : '#e05656'); }
    if (!now && s.pressed) sfx.release();
    s.pressed = now;
  });

  // ---- とびら ----
  const redPressed = switches.some(s => !s.gold && s.pressed);
  const goldSwitches = switches.filter(s => s.gold);
  const allGold = goldSwitches.length > 0 && goldSwitches.every(s => s.pressed);
  doors.forEach(dr => {
    let want;
    if (dr.latch) {
      if (!dr.latched && allGold) { dr.latched = true; sfx.latch(); ring(dr.tx * TILE + 20, dr.ty * TILE + 20, '#f0b429'); }
      want = dr.latched;
    } else {
      want = redPressed;
      // 閉まる前に、とびらの中に誰かいないか確認（はさまり防止）
      if (!want && players.some(p => Math.abs(p.x - (dr.tx * TILE + 20)) < TILE * .8 && Math.abs(p.y - (dr.ty * TILE + 20)) < TILE * .8)) want = true;
    }
    const prev = dr.openT;
    dr.openT = Math.max(0, Math.min(1, dr.openT + (want ? 3 : -3) * dt));
    if (want && prev < .1 && dr.openT >= .1) sfx.door();
  });

  // ---- てき ----
  enemies.forEach(e => {
    e.bob += dt * 6;
    const mx = e.dx * e.sp * dt, my = e.dy * e.sp * dt;
    if (mx && (circleHitsSolid(e.x + mx, e.y, BAT_R) || (e.bounds && (e.x + mx < e.bounds[0] || e.x + mx > e.bounds[2])))) e.dx = -e.dx; else e.x += mx;
    if (my && (circleHitsSolid(e.x, e.y + my, BAT_R) || (e.bounds && (e.y + my < e.bounds[1] || e.y + my > e.bounds[3])))) e.dy = -e.dy; else e.y += my;
    players.forEach((p, i) => {
      if (Math.hypot(p.x - e.x, p.y - e.y) < PR + BAT_R - 4) playerHit(i);
    });
  });

  // ---- ほうせき ----
  gems.forEach(g => {
    if (g.got) return;
    g.bob += dt * 4;
    players.forEach(p => {
      if (!g.got && dist(p, g) < PR + 10) {
        g.got = true; game.gemsGot++;
        el.gems.textContent = game.gemsGot + '/' + game.gemsTotal;
        sfx.gem();
        for (let i = 0; i < 8; i++) spark(g.x, g.y, '#9be8ff');
      }
    });
  });

  // ---- ゴール ----
  let allOcc = exits.length > 0;
  exits.forEach(ex => {
    ex.occ = players.some(p => dist(p, ex) < TILE * .72);
    if (!ex.occ) allOcc = false;
  });
  if (allOcc) floorCleared();

  // ---- パーティクル ----
  particles = particles.filter(pt => {
    pt.t += dt;
    if (pt.vy !== undefined) pt.y += pt.vy * dt;
    if (pt.vx !== undefined) pt.x += pt.vx * dt;
    return pt.t < pt.life;
  });
}

/* ================= 描画 ================= */
function draw() {
  ctx.clearRect(0, 0, W, H);

  // ゆか
  for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) {
    const x = tx * TILE, y = ty * TILE;
    if (grid[ty] && grid[ty][tx]) {
      ctx.fillStyle = '#292344';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = '#332b56';
      ctx.fillRect(x + 2, y + 2, TILE - 4, 6);
      ctx.fillStyle = '#1d1836';
      ctx.fillRect(x + 2, y + TILE - 8, TILE - 4, 6);
    } else {
      ctx.fillStyle = (tx + ty) % 2 ? '#1a1730' : '#1d1a34';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.strokeStyle = 'rgba(255,255,255,.03)';
      ctx.strokeRect(x + .5, y + .5, TILE - 1, TILE - 1);
    }
  }

  // ゴール
  exits.forEach(ex => {
    const pulse = 1 + Math.sin(game.t * 4) * .08;
    ctx.save();
    ctx.translate(ex.x, ex.y);
    ctx.scale(pulse, pulse);
    const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 19);
    g.addColorStop(0, ex.occ ? 'rgba(140,255,190,.95)' : 'rgba(120,240,170,.8)');
    g.addColorStop(1, 'rgba(60,180,110,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, 19, 0, 7); ctx.fill();
    ctx.strokeStyle = ex.occ ? '#8cffbe' : '#3fae74';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.arc(0, 0, 15, 0, 7); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  });

  // ほうせき
  gems.forEach(g => {
    if (g.got) return;
    const yy = Math.sin(g.bob) * 3;
    ctx.save();
    ctx.translate(g.x, g.y + yy);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = '#8fd8ff';
    ctx.fillRect(-7, -7, 14, 14);
    ctx.fillStyle = '#d8f4ff';
    ctx.fillRect(-7, -7, 14, 5);
    ctx.restore();
  });

  // スイッチ
  switches.forEach(s => {
    const c = s.gold ? '#f0b429' : '#e05656';
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.beginPath(); ctx.arc(s.x, s.y + 3, 15, 0, 7); ctx.fill();
    ctx.fillStyle = s.pressed ? c : '#3a3357';
    ctx.beginPath(); ctx.arc(s.x, s.y, 14, 0, 7); ctx.fill();
    ctx.strokeStyle = c;
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(s.x, s.y, 14, 0, 7); ctx.stroke();
    ctx.fillStyle = s.pressed ? '#fff' : c;
    ctx.beginPath(); ctx.arc(s.x, s.y, s.pressed ? 5 : 4, 0, 7); ctx.fill();
  });

  // とびら
  doors.forEach(dr => {
    const x = dr.tx * TILE, y = dr.ty * TILE;
    const c = dr.latch ? '#f0b429' : '#e05656';
    const h = TILE * (1 - dr.openT);
    if (h > 1) {
      ctx.fillStyle = dr.latch ? '#7a5a10' : '#6b2b36';
      ctx.fillRect(x + 3, y + (TILE - h) / 2, TILE - 6, h);
      ctx.fillStyle = c;
      ctx.fillRect(x + 3, y + (TILE - h) / 2, TILE - 6, Math.min(5, h));
      ctx.fillRect(x + 3, y + (TILE + h) / 2 - Math.min(5, h), TILE - 6, Math.min(5, h));
      // 取っ手っぽい飾り
      ctx.fillRect(x + TILE / 2 - 2, y + TILE / 2 - Math.min(6, h / 2), 4, Math.min(12, h));
    }
    if (dr.openT > 0 && dr.openT < 1) {
      ctx.strokeStyle = c; ctx.globalAlpha = .5;
      ctx.strokeRect(x + 3.5, y + 3.5, TILE - 7, TILE - 7);
      ctx.globalAlpha = 1;
    }
  });

  // てき（バット）
  enemies.forEach(e => {
    const flap = Math.sin(e.bob) * .18;
    ctx.save();
    ctx.translate(e.x, e.y + Math.sin(e.bob * .7) * 2);
    ctx.scale(1 + flap, 1 - flap);
    ctx.font = '26px serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('🦇', 0, 0);
    ctx.restore();
  });

  // プレイヤー
  players.forEach((p, i) => {
    const blink = p.invuln > 0 && Math.floor(game.t * 12) % 2 === 0;
    ctx.save();
    if (blink) ctx.globalAlpha = .35;
    // 影
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.beginPath(); ctx.ellipse(p.x, p.y + PR - 2, PR * .9, 5, 0, 0, 7); ctx.fill();
    // キャラ（koto / zuza）
    drawChar(ctx, p.x, p.y + 1, 1, p.char, { dir: p.dir, accent: p.color });
    ctx.restore();
    // 名前
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,.7)';
    ctx.strokeText(p.name, p.x, p.y - PR - 7);
    ctx.fillStyle = p.color;
    ctx.fillText(p.name, p.x, p.y - PR - 7);
  });

  // ほのかな光（プレイヤー周り）
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  players.forEach(p => {
    const g = ctx.createRadialGradient(p.x, p.y, 10, p.x, p.y, 130);
    g.addColorStop(0, 'rgba(255,190,110,.10)');
    g.addColorStop(1, 'rgba(255,190,110,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(p.x, p.y, 130, 0, 7); ctx.fill();
  });
  ctx.restore();

  // パーティクル
  particles.forEach(pt => {
    const k = 1 - pt.t / pt.life;
    ctx.save();
    ctx.globalAlpha = Math.max(0, k);
    if (pt.type === 'emoji') {
      ctx.font = (pt.size || 20) + 'px serif';
      ctx.textAlign = 'center';
      ctx.fillText(pt.ch, pt.x, pt.y);
    } else if (pt.type === 'spark') {
      ctx.fillStyle = pt.color;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, 2.5 * k, 0, 7); ctx.fill();
    } else if (pt.type === 'face') {
      drawChar(ctx, pt.x, pt.y, .85, pt.char, { accent: pt.color, sad: true });
    } else if (pt.type === 'ring') {
      ctx.strokeStyle = pt.color;
      ctx.lineWidth = 3 * k;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, 10 + (1 - k) * 30, 0, 7); ctx.stroke();
    }
    ctx.restore();
  });
}

/* ================= メインループ ================= */
let lastT = 0;
function loop(ts) {
  const dt = Math.min(.033, (ts - lastT) / 1000 || 0);
  lastT = ts;
  game.t += dt;
  update(dt);
  if (game.state !== 'title') draw();
  requestAnimationFrame(loop);
}

/* ================= UI 配線 ================= */
$('btnStart').addEventListener('click', startRun);
$('btnReplay').addEventListener('click', startRun);
$('btnResume').addEventListener('click', togglePause);
$('btnQuit').addEventListener('click', backToTitle);
$('btnTitle2').addEventListener('click', backToTitle);
$('btnPause').addEventListener('click', () => { if (game.state === 'play' || game.state === 'paused') togglePause(); });
$('btnMute').addEventListener('click', e => {
  muted = !muted;
  e.currentTarget.textContent = muted ? '🔇' : '🔊';
});
$('btnPads').addEventListener('click', () => document.body.classList.toggle('touch'));

// 名前を変えるとタイトルの顔アイコンも変わる
el.name1.addEventListener('input', paintNameFaces);
el.name2.addEventListener('input', paintNameFaces);
paintNameFaces();
paintFace(el.hudFace1, 'koto', 0);
paintFace(el.hudFace2, 'zuza', 1);

// タッチデバイスなら自動でパッド表示
if (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window || navigator.maxTouchPoints > 0) {
  document.body.classList.add('touch');
}

// タイトル中も背景にダンジョンを薄く描画
players = [
  { name: 'P1', char: 'koto', color: P1_COLOR, spawn: {}, x: -99, y: -99, dir: { x: 1, y: 0 }, invuln: 0, emoteCd: 0 },
  { name: 'P2', char: 'zuza', color: P2_COLOR, spawn: {}, x: -99, y: -99, dir: { x: 1, y: 0 }, invuln: 0, emoteCd: 0 },
];
loadFloor(0);
el.floor.textContent = 'Dungeon Escape';
el.banner.classList.add('hidden');
bannerT = 0;
requestAnimationFrame(loop);
