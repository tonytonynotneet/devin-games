// Game logic: slingshot aiming, launch, bird abilities, camera, scoring,
// win/lose, level flow, save. Depends on PH (physics.js), AB.sprites, AB.LEVELS, AB.sfx.
(() => {
'use strict';
const AB = window.AB = window.AB || {};
const SPR = AB.sprites;

const qs = new URLSearchParams(location.search);
const PLAY = qs.get('play') === '1';
const AS = qs.get('as') || 'koto';
const DUO = qs.get('duo') === '1' || AS === 'koto' || AS === 'zuza';
const DEBUG = qs.get('debug') === '1';

// ---- tuning (mirrors the video's debug panel) ----
const T = AB.TUN = {
  gravity: 1500,        // floaty feel = lower gravity + higher launch speed
  launchPower: 11.2,    // px/s per px pulled
  maxPull: 110,
  // damage = (impactSpeed - threshold) * dmgScale — resting/settle contact deals zero
  // thresholds sit above settle-jitter noise (~140 px/s) far below bird hits (~1200)
  thrIce: 170, thrWood: 240, thrStone: 400,
  hpIce: 26, hpWood: 55, hpStone: 110,
  dmgBlock: 0.12, dmgPig: 0.12,
  explodePower: 900, explodeRadius: 200, explodeDmg: 55,
  pigHp: 26, pigThr: 170, helmetHp: 70, helmetThr: 240,
};

const save = {
  load() { try { return JSON.parse(localStorage.getItem('angrybirds-save')) || { unlocked: 0, stars: {}, score: {} }; } catch (e) { return { unlocked: 0, stars: {}, score: {} }; } },
  put(s) { try { localStorage.setItem('angrybirds-save', JSON.stringify(s)); } catch (e) {} },
};

const G = {
  level: 0, state: 'aim', // aim | fly | settle | clear | fail
  world: null, parts: SPR.makeParticles(),
  bird: null, birdT: 0, trailT: 0, restT: 0, settleT: 0,
  queue: [], turn: 0,
  score: 0, camX: 0, camY: 0, camTX: 0, scale: 1,
  shake: 0, sling: { x: 190, y: 0, px: 0, py: 0 },
  drag: null, lastTapT: 0,
};
let SV = save.load();

const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');
let VW = 0, VH = 0, DPR = 1;
function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  VW = innerWidth; VH = innerHeight;
  cv.width = VW * DPR; cv.height = VH * DPR;
  cv.style.width = VW + 'px'; cv.style.height = VH + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  fitCam(true);
}
addEventListener('resize', resize);

// ---- world building ----
function buildWorld(i) {
  const L = AB.buildLevel(i);
  const w = PH.makeWorld(T.gravity);
  w.onImpact = onImpact;
  // ground
  const g = PH.box(700, L.gy + 449, 4200, 900, { stat: true, friction: 0.9 });
  g.tag = 'ground';
  PH.add(w, g);
  // blocks
  for (const d of L.blocks) {
    const den = { ice: 0.0007, wood: 0.0013, stone: 0.003 }[d.mat];
    const thr = { ice: T.thrIce, wood: T.thrWood, stone: T.thrStone }[d.mat];
    const hp = { ice: T.hpIce, wood: T.hpWood, stone: T.hpStone }[d.mat];
    const b = d.shape === 'tri' ? PH.tri(d.x, d.y, d.w, d.h, { density: den })
      : PH.box(d.x, d.y, d.w, d.h, { density: den });
    b.tag = 'block'; b.hp = b.maxHp = hp; b.threshold = thr; b.dmgScale = T.dmgBlock;
    b.restitution = 0.02; b.friction = 0.65;
    b.score = d.mat === 'stone' ? 1000 : 500;
    b.data = { mat: d.mat };
    b.angle = d.ang || 0;
    b.asleep = true; // structures stand frozen until hit (classic AB behavior)
    PH.add(w, b);
  }
  // pigs
  for (const d of L.pigs) {
    const helmet = d.variant === 'helmet';
    const b = PH.circle(d.x, d.y, helmet ? 21 : 18, { density: 0.0009, restitution: 0.1, friction: 0.6 });
    b.tag = 'pig'; b.hp = b.maxHp = helmet ? T.helmetHp : T.pigHp;
    b.threshold = helmet ? T.helmetThr : T.pigThr; b.dmgScale = T.dmgPig; b.score = 5000;
    b.data = { variant: d.variant };
    b.asleep = true;
    PH.add(w, b);
  }
  G.world = w; G.levelDef = L;
  G.queue = [...L.birds]; G.turn = 0; G.score = 0;
  G.sling.x = 190; G.sling.y = L.gy - 62;
  G.parts = SPR.makeParticles();
  nextBird();
  fitCam(true);
  updHUD();
}

function makeBird(kind) {
  const r = SPR.BIRD[kind].size;
  const b = PH.circle(G.sling.x, G.sling.y - 6, r, { density: 0.0022, restitution: 0.18, friction: 0.4 });
  b.tag = 'bird'; b.hp = b.maxHp = 1e9; b.threshold = 1e9; b.asleep = true;
  b.data = { kind, used: false, launched: false };
  PH.add(G.world, b);
  return b;
}
function nextBird() {
  if (!G.queue.length) { G.bird = null; checkEnd(); return; }
  G.bird = makeBird(G.queue[0]);
  G.birdT = 0; G.restT = 0; G.state = 'aim';
  if (DUO) banner((G.turn % 2 === 0 ? 'KOTO' : 'ZUZA') + "'S SHOT");
}
function launch(vx, vy) {
  const b = G.bird;
  b.data.launched = true; b.asleep = false; b.vx = vx; b.vy = vy;
  G.state = 'fly'; G.birdT = 0; G.trailT = 0;
  AB.sfx.launch();
}
function ability() {
  const b = G.bird;
  if (!b || b.dead || !b.data.launched || b.data.used) return;
  b.data.used = true;
  const k = b.data.kind;
  if (k === 'koto-dash') {
    const sp = Math.hypot(b.vx, b.vy) || 1, boost = Math.max(900, sp * 2.1);
    b.vx = b.vx / sp * boost; b.vy = Math.min(b.vy / sp * boost, 200);
    SPR.burst(G.parts, b.x, b.y, '#22d3ee', 8, 120);
    AB.sfx.dash();
  } else if (k === 'zuza') {
    for (const dv of [-0.32, 0.32]) {
      const c = PH.circle(b.x, b.y, b.kind.r, { density: 0.0022, restitution: 0.18, friction: 0.4 });
      c.tag = 'bird'; c.hp = 1e9; c.threshold = 1e9;
      c.data = { kind: 'zuza-mini', used: true, launched: true };
      const sp = Math.hypot(b.vx, b.vy), a = Math.atan2(b.vy, b.vx);
      c.vx = Math.cos(a + dv) * sp; c.vy = Math.sin(a + dv) * sp;
      PH.add(G.world, c); extraBirds.push(c);
    }
    AB.sfx.split();
  } else if (k === 'zuza-bomb') {
    explodeAt(b);
  }
}
const extraBirds = [];
function explodeAt(b) {
  PH.explode(G.world, b.x, b.y, T.explodeRadius, T.explodePower, T.explodeDmg);
  SPR.burst(G.parts, b.x, b.y, '#ff9a3c', 26, 520);
  SPR.burst(G.parts, b.x, b.y, '#a855f7', 18, 380);
  SPR.burst(G.parts, b.x, b.y, '#3a3a44', 14, 260);
  G.shake = Math.max(G.shake, 14);
  b.dead = true;
  AB.sfx.boom();
}

// ---- damage ----
function onImpact(body, imp, forced) {
  if (body.tag === 'block' || body.tag === 'pig') {
    const dmg = forced ? imp - body.threshold : (imp - body.threshold) * body.dmgScale;
    if (dmg <= 0) return;
    body.hp -= dmg; body.hitFlash = 0.5;
    body.asleep = false; body.sleepT = 0;
    if (body.hp <= 0 && !body.dead) {
      body.dead = true;
      G.score += body.score;
      if (body.tag === 'pig') { SPR.burst(G.parts, body.x, body.y, '#8ed158', 14, 300); SPR.burst(G.parts, body.x, body.y, '#fff', 8, 160); AB.sfx.pop(); }
      else { SPR.debris(G.parts, body.x, body.y, body.data.mat); AB.sfx.woodbreak(); }
      updHUD();
    } else if (body.tag === 'block') AB.sfx.crack();
    else AB.sfx.thud();
  } else if (body.tag === 'bird' && !forced) {
    if (body.data.kind === 'zuza-bomb' && body.data.launched && !body.data.used && imp > 220) { body.data.used = true; explodeAt(body); }
    else if (imp > 150) AB.sfx.thud();
  }
}

// ---- input ----
const pt = e => { const t = e.touches ? e.touches[0] : e; return { x: t.clientX, y: t.clientY }; };
const toWorld = (sx, sy) => ({ x: sx / G.scale + G.camX, y: sy / G.scale + G.camY });

function down(e) {
  AB.sfx.unlock();
  const p = pt(e);
  if (G.state === 'aim' && G.bird) {
    const bs = { x: (G.sling.x - G.camX) * G.scale, y: (G.sling.y - 6 - G.camY) * G.scale };
    if (Math.hypot(p.x - bs.x, p.y - bs.y) < 110 * G.scale || p.x < VW * 0.35) {
      G.drag = { aim: true, sx: p.x, sy: p.y };
      e.preventDefault(); return;
    }
  }
  if (G.state === 'fly') { // tap = ability (distinguish from pan by short tap)
    G.drag = { pan: true, sx: p.x, sy: p.y, t: performance.now(), moved: false };
    return;
  }
  G.drag = { pan: true, sx: p.x, sy: p.y, t: performance.now(), moved: false };
}
function move(e) {
  if (!G.drag) return;
  const p = pt(e);
  if (G.drag.aim && G.bird) {
    const dx = p.x - G.drag.sx, dy = p.y - G.drag.sy;
    const d = Math.hypot(dx, dy), m = T.maxPull * G.scale;
    const cl = d > m ? m / d : 1;
    G.bird.x = G.sling.x + dx * cl / G.scale;
    G.bird.y = G.sling.y - 6 + dy * cl / G.scale;
    e.preventDefault();
  } else if (G.drag.pan) {
    if (Math.abs(p.x - G.drag.sx) > 8) G.drag.moved = true;
    G.camX -= (p.x - G.drag.sx) / G.scale;
    G.drag.sx = p.x; G.drag.sy = p.y;
    clampCam();
    e.preventDefault();
  }
}
function up(e) {
  if (!G.drag) return;
  if (G.drag.aim && G.bird && G.state === 'aim') {
    const dx = G.sling.x - G.bird.x, dy = G.sling.y - 6 - G.bird.y;
    const pull = Math.hypot(dx, dy);
    if (pull > 12) {
      launch(dx * T.launchPower, dy * T.launchPower);
      G.turn++;
    } else { G.bird.x = G.sling.x; G.bird.y = G.sling.y - 6; }
  } else if (G.drag.pan && G.state === 'fly' && !G.drag.moved && performance.now() - G.drag.t < 250) {
    ability();
  }
  G.drag = null;
}
addEventListener('pointerdown', down, { passive: false });
addEventListener('pointermove', move, { passive: false });
addEventListener('pointerup', up);
addEventListener('pointercancel', up);
addEventListener('keydown', e => {
  if (e.code === 'Space') ability();
  if (e.code === 'KeyR') buildWorld(G.level);
});

// ---- camera ----
function fitCam(snap) {
  G.scale = Math.max(0.5, Math.min(1.7, VH / 470));
  const viewW = VW / G.scale;
  G.camY = G.levelDef ? G.levelDef.gy + 14 - VH / G.scale * 0.9 : -100;
  clampCam();
  if (snap) G.camX = 0;
}
function clampCam() {
  const viewW = VW / G.scale;
  const maxX = Math.max(0, (G.levelDef ? 1500 : 1500) - viewW + 120);
  G.camX = Math.max(-40, Math.min(maxX, G.camX));
}
function camFollow(dt) {
  let tx = 0;
  if (G.state === 'fly' && G.bird && !G.bird.dead) tx = Math.max(0, G.bird.x - VW / G.scale * 0.35);
  G.camX += (tx - G.camX) * Math.min(1, dt * (G.state === 'fly' ? 5 : 3));
  clampCam();
}

// ---- flow ----
function pigsLeft() { return G.world.bodies.filter(b => b.tag === 'pig' && !b.dead).length; }
function sceneQuiet() {
  for (const b of G.world.bodies) {
    if (b.dead || b.stat || b === G.bird) continue;
    if (b.asleep) continue;
    if (Math.hypot(b.vx, b.vy) > 24) return false;
  }
  return true;
}
function checkEnd() {
  if (pigsLeft() === 0) { winLevel(); return; }
  if (!G.queue.length && (!G.bird || G.bird.dead || G.birdDone)) {
    if (G.state !== 'fail') { G.state = 'fail'; showOverlay('fail'); AB.sfx.fail(); }
  }
}
function winLevel() {
  G.state = 'clear';
  G.score += G.queue.length * 10000;
  const st = G.score >= G.levelDef.stars[2] ? 3 : G.score >= G.levelDef.stars[1] ? 2 : 1;
  SV.stars[G.level] = Math.max(SV.stars[G.level] || 0, st);
  SV.score[G.level] = Math.max(SV.score[G.level] || 0, G.score);
  SV.unlocked = Math.max(SV.unlocked, Math.min(AB.LEVELS.length - 1, G.level + 1));
  save.put(SV);
  showOverlay('clear', st);
  AB.sfx.win(); AB.sfx.star();
}
function birdDone() {
  if (G.bird && !G.bird.dead) {
    SPR.burst(G.parts, G.bird.x, G.bird.y, '#ccc', 8, 120);
    G.bird.dead = true;
  }
  for (const b of extraBirds.splice(0)) if (!b.dead) b.dead = true;
  G.queue.shift();
  nextBird();
}

// ---- overlays / HUD ----
const el = id => document.getElementById(id);
function updHUD() {
  el('score').textContent = G.score.toLocaleString();
  el('pigs').textContent = pigsLeft();
  const q = G.queue.map((k, i) => `<span class="qdot ${i === 0 && G.bird ? 'cur' : ''}">${i === 0 ? '▶' : ''}${k === 'zuza' || k === 'zuza-bomb' ? 'z' : 'k'}</span>`).join('');
  el('queue').innerHTML = q;
}
function banner(t) {
  const b = el('banner'); b.textContent = t; b.classList.add('on');
  clearTimeout(banner._t); banner._t = setTimeout(() => b.classList.remove('on'), 1100);
}
function showOverlay(kind, stars) {
  const o = el('ovl'); o.className = 'ovl on ' + kind;
  el('ovl-title').textContent = kind === 'clear' ? 'LEVEL CLEAR!' : 'FAILED…';
  el('ovl-stars').textContent = kind === 'clear' ? '★'.repeat(stars) + '☆'.repeat(3 - stars) : '';
  el('ovl-score').textContent = kind === 'clear' ? 'SCORE ' + G.score.toLocaleString() : 'SCORE ' + G.score.toLocaleString();
  el('ovl-next').style.display = kind === 'clear' && G.level < AB.LEVELS.length - 1 ? '' : 'none';
}
el('ovl-next').onclick = () => { el('ovl').className = 'ovl'; G.level++; buildWorld(G.level); };
el('ovl-retry').onclick = () => { el('ovl').className = 'ovl'; buildWorld(G.level); };
el('ovl-menu').onclick = () => { el('ovl').className = 'ovl'; showMenu(); };
el('btn-restart').onclick = () => buildWorld(G.level);
el('btn-menu').onclick = showMenu;

function showMenu() {
  const m = el('menu'); m.className = 'menu on';
  const grid = el('lvgrid'); grid.innerHTML = '';
  AB.LEVELS.forEach((L, i) => {
    const d = document.createElement('button');
    d.className = 'lv' + (i <= SV.unlocked ? '' : ' lock');
    d.innerHTML = `<b>${i + 1}</b><span>${'★'.repeat(SV.stars[i] || 0)}${'☆'.repeat(3 - (SV.stars[i] || 0))}</span><em>${L.name}</em>`;
    d.disabled = i > SV.unlocked;
    d.onclick = () => { m.className = 'menu'; G.level = i; buildWorld(i); };
    grid.appendChild(d);
  });
}
el('btn-play').onclick = () => { el('title').className = 'title off'; showMenu(); };

// ---- main loop ----
let last = performance.now();
function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.033, (t - last) / 1000); last = t;
  if (!G.world) return;
  G.world.gravity = T.gravity;
  PH.step(G.world, dt);
  SPR.updateParticles(G.parts, dt, T.gravity);
  if (G.shake > 0) G.shake = Math.max(0, G.shake - dt * 30);

  const b = G.bird;
  if (b && !b.dead) {
    G.birdT += dt;
    if (b.data.launched) {
      G.trailT += dt;
      if (G.trailT > 0.09) { SPR.trail(G.parts, b.x, b.y); G.trailT = 0; }
      const sp = Math.hypot(b.vx, b.vy);
      const grounded = b.y > G.levelDef.gy - b.kind.r - 4;
      if ((grounded && sp < 30) || G.birdT > 9 || b.x > 2600 || b.y > 2000) {
        G.restT += dt;
        if (G.restT > 0.7 || G.birdT > 9) { birdDone(); }
      } else G.restT = 0;
    }
  }
  if (G.state === 'fly' && (!b || b.dead || b.data.launched) && sceneQuiet() && G.birdT > 1.2) {
    G.settleT += dt;
    if (G.settleT > 0.5) { G.settleT = 0; birdDone(); }
  } else G.settleT = 0;
  if (pigsLeft() === 0 && G.state !== 'clear' && G.state !== 'fail') {
    G.winT = (G.winT || 0) + dt;
    if (G.winT > 1.0) winLevel();
  } else G.winT = 0;
  if (!G.queue.length && G.state !== 'clear' && G.state !== 'fail') checkEnd();

  for (const bd of G.world.bodies) if (bd.hitFlash > 0) bd.hitFlash -= dt * 3;
  camFollow(dt);
  draw();
}
function draw() {
  const L = G.levelDef;
  ctx.clearRect(0, 0, VW, VH);
  const shx = (Math.random() - 0.5) * G.shake, shy = (Math.random() - 0.5) * G.shake;
  SPR.drawBackground(ctx, G.camX, VW, VH, L ? L.theme : 'day');
  ctx.save();
  ctx.scale(G.scale, G.scale);
  ctx.translate(-G.camX + shx / G.scale, -G.camY + shy / G.scale);
  SPR.drawGround(ctx, -200, L.gy, 3400, L.theme);
  // sling back fork + band
  SPR.drawSlingBack(ctx, G.sling.x, G.sling.y + 20);
  if (G.bird && G.state === 'aim' && G.drag && G.drag.aim) {
    SPR.drawBand(ctx, G.sling.x - 4, G.sling.y + 6, G.bird.x, G.bird.y, true);
    SPR.drawBand(ctx, G.sling.x + 10, G.sling.y + 8, G.bird.x, G.bird.y, false);
    // trajectory dots
    const vx0 = (G.sling.x - G.bird.x) * T.launchPower, vy0 = (G.sling.y - 6 - G.bird.y) * T.launchPower;
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    for (let i = 1; i <= 8; i++) {
      const tt = i * 0.09;
      ctx.beginPath();
      ctx.arc(G.bird.x + vx0 * tt, G.bird.y + vy0 * tt + 0.5 * T.gravity * tt * tt, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  for (const bd of G.world.bodies) {
    if (bd.dead || bd.tag === 'ground') continue;
    if (bd.tag === 'block') SPR.drawBlock(ctx, bd);
    else if (bd.tag === 'pig') SPR.drawPig(ctx, bd);
    else if (bd.tag === 'bird') SPR.drawBird(ctx, bd);
  }
  for (const bd of extraBirds) if (!bd.dead) SPR.drawBird(ctx, bd);
  SPR.drawParticles(ctx, G.parts);
  SPR.drawSlingFront(ctx, G.sling.x, G.sling.y + 20);
  // waiting birds on ground
  G.queue.slice(1, 4).forEach((k, i) => {
    const fake = { x: 60 + i * 34, y: L.gy - 16, angle: 0, kind: { r: 13 }, data: { kind: k } };
    SPR.drawBird(ctx, fake);
  });
  ctx.restore();
  // explosion flash ring
}

// ---- debug panel ----
if (DEBUG) {
  const p = document.createElement('div'); p.id = 'dbg';
  p.innerHTML = '<b>TUNING</b>';
  const rows = [['gravity', 300, 3000], ['launchPower', 4, 20], ['thrIce', 0, 60], ['thrWood', 0, 80], ['thrStone', 0, 120], ['hpIce', 5, 100], ['hpWood', 10, 200], ['hpStone', 20, 300], ['explodePower', 200, 2500], ['explodeRadius', 60, 400]];
  for (const [k, mn, mx] of rows) {
    const r = document.createElement('div'); r.className = 'drow';
    r.innerHTML = `<span>${k}</span><input type="range" min="${mn}" max="${mx}" step="1" value="${T[k]}"><em>${T[k]}</em>`;
    const inp = r.querySelector('input'), em = r.querySelector('em');
    inp.oninput = () => { T[k] = +inp.value; em.textContent = inp.value; };
    p.appendChild(r);
  }
  document.body.appendChild(p);
}

// ---- boot ----
AB.G = G; AB.buildWorld = buildWorld; // exposed for debug/tests
resize();
if (PLAY) { el('title').className = 'title off'; G.level = Math.min(SV.unlocked, AB.LEVELS.length - 1); buildWorld(G.level); }
requestAnimationFrame(frame);
})();
