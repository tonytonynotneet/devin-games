/* Super Koto — an original Mario-style platformer for koto & zuza.
   Pure canvas + DOM overlays, no dependencies. Runs from file://. */
(function () {
  'use strict';

  const cv = document.getElementById('cv');
  const ctx = cv.getContext('2d');
  const W = 960, H = 512, TILE = 32;
  ctx.imageSmoothingEnabled = false;

  // ---------- tuning ----------
  const GRAV = 2050, MAXFALL = 1050;
  const WALK_MAX = 175, RUN_MAX = 300;
  const ACC_G = 2500, ACC_A = 1900, FRICTION = 2300;
  const JUMP_BASE = 760, JUMP_RUNK = 0.55, JUMP_CUT = 240;
  const COYOTE = 0.09, JBUF = 0.13;
  const STOMP_BOUNCE = 430, STOMP_BOOST = 640;
  const SOLID = new Set(['X', 'B', '?', 'M', 'u', 'S', 'd']);

  const $ = id => document.getElementById(id);
  const hudP1 = $('hudP1'), hudP2 = $('hudP2'), chipP2 = $('chipP2'),
    hudCoins = $('hudCoins'), hudTime = $('hudTime'), hudWorld = $('hudWorld'),
    banner = $('banner');

  // ---------- helpers ----------
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, t) => a + (b - a) * t;
  const pad6 = n => String(Math.max(0, Math.floor(n))).padStart(6, '0');

  // ---------- input ----------
  const inp = [
    { l: 0, r: 0, j: 0, run: 0, jEdge: 0, runEdge: 0 },
    { l: 0, r: 0, j: 0, run: 0, jEdge: 0, runEdge: 0 },
  ];
  const KEYMAP = {
    KeyA: [0, 'l'], KeyD: [0, 'r'], KeyW: [0, 'j'], Space: [0, 'j'],
    KeyJ: [0, 'run'], ShiftLeft: [0, 'run'],
    ArrowLeft: [1, 'l'], ArrowRight: [1, 'r'], ArrowUp: [1, 'j'],
    Enter: [1, 'run'], Slash: [1, 'run'], Numpad0: [1, 'j'],
  };
  window.addEventListener('keydown', e => {
    if (e.repeat) { if (KEYMAP[e.code]) e.preventDefault(); return; }
    const m = KEYMAP[e.code];
    if (m) {
      const k = inp[m[0]], key = m[1];
      if (key === 'j' && !k.j) k.jEdge = 1;
      if (key === 'run' && !k.run) k.runEdge = 1;
      k[key] = 1;
      e.preventDefault();
      SK.sfx.unlock();
    }
    if (e.code === 'Escape' || e.code === 'KeyP') togglePause();
    if (e.code === 'KeyM') toggleMute();
    if (e.code === 'KeyR' && G.state === 'play') reloadLevel();
  });
  window.addEventListener('keyup', e => {
    const m = KEYMAP[e.code];
    if (m) inp[m[0]][m[1]] = 0;
  });
  window.addEventListener('blur', () => {
    inp.forEach(k => { k.l = k.r = k.j = k.run = 0; });
    if (G.state === 'play') togglePause(true);
  });

  // ---------- touch pads ----------
  let padsOn = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  const touchLayer = $('touchLayer');
  function refreshPads() {
    touchLayer.classList.toggle('hidden', !padsOn);
    $('padR').style.display = (G.mode === 'coop') ? '' : 'none';
  }
  document.querySelectorAll('.tbtn').forEach(btn => {
    const pi = +btn.dataset.p, key = btn.dataset.k;
    const on = e => {
      e.preventDefault();
      const k = inp[pi];
      if (key === 'j' && !k.j) k.jEdge = 1;
      if (key === 'run' && !k.run) k.runEdge = 1;
      k[key] = 1;
      btn.classList.add('on');
      SK.sfx.unlock();
    };
    const off = e => {
      e.preventDefault();
      inp[pi][key] = 0;
      btn.classList.remove('on');
    };
    btn.addEventListener('pointerdown', on);
    btn.addEventListener('pointerup', off);
    btn.addEventListener('pointercancel', off);
    btn.addEventListener('pointerleave', off);
  });
  $('btnPads').addEventListener('click', () => { padsOn = !padsOn; refreshPads(); });

  // ---------- game state ----------
  const G = {
    state: 'title',      // title | intro | play | pause | clear | over | win
    mode: 'solo',
    levelIdx: 0,
    level: null,
    grid: null,
    players: [],
    enemies: [], items: [], projs: [], parts: [], texts: [], anims: [], coinsEnt: [],
    cam: 0,
    coins: 0,
    timeLeft: 300,
    clearT: 0,
    best: (() => { try { return +(localStorage.getItem('superKotoBest') || 0); } catch (e) { return 0; } })(),
    waitingChar: null,
    t: 0,
  };

  function makePlayer(char, name, pid) {
    return {
      pid, char, name,
      x: 0, y: 0, w: 20, h: 44, vx: 0, vy: 0, face: 1,
      onGround: false, coyote: 0, jbuf: 0, prevJump: 0,
      st: 'play',          // play | dead | bubble | out | clear
      deadT: 0, invuln: 0, powered: false, powerT: 0,
      lives: 3, score: 0, coins: 0,
      animT: 0, skid: 0, lagT: 0, throwCd: 0,
      bx: 0, by: 0,        // bubble pos
      cleared: false,
    };
  }

  // ---------- level loading ----------
  function loadLevel(idx, keepLives) {
    const L = SK.levels[idx];
    G.levelIdx = idx;
    G.level = L;
    // deep-copy grid
    G.grid = L.grid.map(r => r.slice());
    G.enemies = L.enemies.map(e => spawnEnemy(e.t, e.x, e.y));
    G.items = []; G.projs = []; G.parts = []; G.texts = []; G.anims = [];
    G.coinsEnt = [];
    for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++)
      if (L.grid[y][x] === 'C') G.coinsEnt.push({ x: x * TILE + 16, y: y * TILE + 16, ph: (x * 7 + y * 3) % 6 });
    G.timeLeft = L.time;
    G.cam = 0;
    G.clearT = 0;
    G.players.forEach((p, i) => {
      p.x = L.spawn.x + i * 40; p.y = L.spawn.y;
      p.vx = p.vy = 0; p.cleared = false;
      p.invuln = 0; p.lagT = 0; p.throwCd = 0;
      if (p.st === 'out' || p.lives <= 0) p.lives = Math.max(1, p.lives); // revive at new level
      p.st = 'play';
    });
    inp.forEach(k => { k.jEdge = k.runEdge = 0; });
    hudWorld.textContent = '1-' + (idx + 1);
    updateHUD();
  }

  function spawnEnemy(t, x, y) {
    const e = { type: t, x, y, vx: 0, vy: 0, w: 26, h: 26, t: Math.random() * 9, dead: 0, deadT: 0, dir: -1 };
    if (t === 'm') { e.vx = -55; e.h = 26; }
    if (t === 'g') { e.vx = -34; e.w = 26; e.h = 24; }
    if (t === 'f') { e.vx = -42; e.baseY = y; e.h = 24; e.homeX = x; }
    return e;
  }

  // ---------- tiles / collision ----------
  const tileAt = (tx, ty) =>
    (tx < 0 || tx >= G.level.w) ? 'X' : (ty < 0 || ty >= G.level.h) ? ' ' : G.grid[ty][tx];
  const solidAt = (tx, ty) => SOLID.has(tileAt(tx, ty));

  function moveX(e, dt) {
    e.x += e.vx * dt;
    const y0 = Math.floor(e.y / TILE), y1 = Math.floor((e.y + e.h - 1) / TILE);
    if (e.vx > 0) {
      const tx = Math.floor((e.x + e.w) / TILE);
      for (let ty = y0; ty <= y1; ty++) if (solidAt(tx, ty)) { e.x = tx * TILE - e.w - 0.01; e.vx = 0; return true; }
    } else if (e.vx < 0) {
      const tx = Math.floor(e.x / TILE);
      for (let ty = y0; ty <= y1; ty++) if (solidAt(tx, ty)) { e.x = (tx + 1) * TILE + 0.01; e.vx = 0; return true; }
    }
    return false;
  }

  function moveY(e, dt, onHead) {
    e.y += e.vy * dt;
    e.onGround = false;
    const x0 = Math.floor((e.x + 2) / TILE), x1 = Math.floor((e.x + e.w - 2) / TILE);
    if (e.vy > 0) {
      const ty = Math.floor((e.y + e.h) / TILE);
      for (let tx = x0; tx <= x1; tx++) if (solidAt(tx, ty)) { e.y = ty * TILE - e.h - 0.01; e.vy = 0; e.onGround = true; return ty; }
    } else if (e.vy < 0) {
      const ty = Math.floor(e.y / TILE);
      for (let tx = x0; tx <= x1; tx++) if (solidAt(tx, ty)) {
        e.y = (ty + 1) * TILE + 0.01; e.vy = 0;
        if (onHead) onHead(tx, ty);
        return ty;
      }
    }
    return -1;
  }

  // ---------- blocks ----------
  function bumpAnim(tx, ty) { G.anims.push({ tx, ty, t: 0 }); }
  function hitBlock(p, tx, ty) {
    const c = tileAt(tx, ty);
    if (c === '?' || c === 'M') {
      bumpAnim(tx, ty);
      G.grid[ty][tx] = 'u';
      if (c === '?') {
        G.items.push({ type: 'coinpop', x: tx * TILE + 16, y: ty * TILE - 16, vy: -460, t: 0 });
        addCoin(p, tx * TILE + 16, ty * TILE);
        SK.sfx.coin();
      } else {
        G.items.push({ type: 'heart', x: tx * TILE + 2, y: ty * TILE - 30, vx: 55, vy: -160, w: 28, h: 28, born: 0 });
        SK.sfx.sprout();
      }
      killOnBlock(tx, ty);
    } else if (c === 'B') {
      if (p.powered) {
        G.grid[ty][tx] = ' ';
        SK.sfx.brick();
        p.score += 50;
        shards(tx * TILE + 16, ty * TILE + 16, '#b0522e');
      } else { bumpAnim(tx, ty); SK.sfx.bump(); killOnBlock(tx, ty); }
    } else if (SOLID.has(c)) {
      SK.sfx.bump();
      killOnBlock(tx, ty);
    }
  }
  function killOnBlock(tx, ty) {
    // enemies standing on the bumped block die (classic)
    for (const e of G.enemies) {
      if (e.dead) continue;
      const etx = Math.floor((e.x + e.w / 2) / TILE), ety = Math.floor((e.y + e.h + 2) / TILE);
      if (etx === tx && ety === ty) killEnemy(e, true);
    }
  }

  function addCoin(p, x, y) {
    G.coins++;
    p.coins++; p.score += 100;
    sparkle(x, y, '#ffd94a', 6);
    if (G.coins % 50 === 0) {
      G.players.forEach(q => { if (q.st === 'play' || q.st === 'bubble') q.lives++; });
      SK.sfx.oneUp();
      addText(x, y - 20, '1UP!', '#7dff8a');
    }
  }

  // ---------- particles / texts ----------
  function sparkle(x, y, col, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 120;
      G.parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60, g: 300, life: 0.5 + Math.random() * 0.3, t: 0, col, sz: 2 + Math.random() * 3 });
    }
  }
  function shards(x, y, col) {
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + (i - 2.5) * 0.45;
      G.parts.push({ x, y, vx: Math.cos(a) * 160, vy: Math.sin(a) * 300, g: 1400, life: 1.1, t: 0, col, sz: 5 });
    }
  }
  function dust(x, y, n) {
    for (let i = 0; i < n; i++)
      G.parts.push({ x: x + (Math.random() - 0.5) * 14, y, vx: (Math.random() - 0.5) * 60, vy: -Math.random() * 60, g: 200, life: 0.35, t: 0, col: '#d8c8a8', sz: 2 + Math.random() * 2 });
  }
  function addText(x, y, txt, col) { G.texts.push({ x, y, txt, col: col || '#fff', t: 0 }); }

  // ---------- player logic ----------
  function hurtPlayer(p) {
    if (p.invuln > 0 || p.st !== 'play') return;
    if (p.powered) {
      p.powered = false; p.invuln = 2;
      p.vy = -300; p.vx = -p.face * 140;
      SK.sfx.hit();
      sparkle(p.x + p.w / 2, p.y + 10, '#ffffff', 10);
    } else killPlayer(p);
  }

  function killPlayer(p) {
    if (p.st !== 'play') return;
    p.st = 'dead'; p.deadT = 0; p.vy = -640; p.vx = 0;
    p.lives--;
    SK.sfx.die();
    addText(p.x + p.w / 2 - 8, p.y - 10, '☹', '#fff');
    updateHUD();
  }

  function respawnOrBubble(p) {
    if (G.mode === 'solo') {
      if (p.lives > 0) {
        p.x = G.level.spawn.x; p.y = G.level.spawn.y;
        p.vx = p.vy = 0; p.st = 'play'; p.invuln = 2; p.powered = false;
        G.cam = clamp(p.x - W * 0.4, 0, G.level.w * TILE - W);
        // enemies respawn too (classic restart)
        G.enemies = G.level.enemies.map(e => spawnEnemy(e.t, e.x, e.y));
        G.items = G.items.filter(i => false); G.projs = [];
        G.timeLeft = G.level.time;
      } else gameOver();
    } else {
      const mate = G.players.find(q => q !== p && (q.st === 'play' || q.st === 'bubble' || q.st === 'clear'));
      if (p.lives > 0 && mate) {
        p.st = 'bubble';
        p.bx = mate.x + mate.w / 2 - p.w / 2;
        p.by = mate.y - 160;
        p.vx = p.vy = 0;
        SK.sfx.bubble();
      } else if (p.lives > 0) {
        // no live partner — respawn at the level start alone
        p.x = G.level.spawn.x; p.y = G.level.spawn.y;
        p.vx = p.vy = 0; p.st = 'play'; p.invuln = 2; p.powered = false;
        if (G.timeLeft <= 0) G.timeLeft = G.level.time;
      } else {
        p.st = 'out';
      }
    }
    checkAllDead();
  }

  function checkAllDead() {
    const any = G.players.some(p => p.st === 'play' || p.st === 'bubble' || p.st === 'dead' || p.st === 'clear');
    if (!any && G.state === 'play') gameOver();
  }

  function gameOver() {
    G.state = 'over';
    SK.sfx.gameover();
    saveBest();
    showCard('☹️ GAME OVER',
      `${G.players.map(p => `${p.name}: ${pad6(p.score)}`).join('\n')}\nBest: ${pad6(G.best)}`,
      [
        { label: '↻ Continue', cb: () => { G.players.forEach(p => { p.lives = 3; p.st = 'play'; p.powered = false; }); loadLevel(G.levelIdx, true); G.state = 'play'; hideCards(); }, cls: 'bigbtn' },
        { label: 'Back to Title', cb: toTitle, cls: 'midbtn' },
      ]);
  }

  function levelClear() {
    if (G.state !== 'play') return;
    G.state = 'clear'; G.clearT = 0;
    SK.sfx.flag();
    const bonus = Math.ceil(G.timeLeft) * 10;
    G.players.forEach(p => {
      if (p.st === 'play' || p.st === 'bubble') { p.st = 'clear'; p.cleared = true; p.score += bonus; p.vx = 90; }
    });
    confetti(G.level.flag.x, 140);
  }

  function winGame() {
    G.state = 'win';
    SK.sfx.win();
    saveBest();
    const names = G.players.map(p => p.name).join(' ♥ ');
    showCard('🏆 YOU WIN! 🏆',
      `${names} reached the goal together!\n` +
      G.players.map(p => `${p.name}: ${pad6(p.score)}`).join('\n') +
      `\nBest: ${pad6(G.best)}`,
      [
        { label: '▶ Play Again', cb: () => { startGame(true); }, cls: 'bigbtn' },
        { label: 'Back to Title', cb: toTitle, cls: 'midbtn' },
      ]);
  }

  function saveBest() {
    const tot = G.players.reduce((s, p) => s + p.score, 0);
    if (tot > G.best) { G.best = tot; try { localStorage.setItem('superKotoBest', tot); } catch (e) { } }
  }

  function nextLevel() {
    if (G.levelIdx + 1 >= SK.levels.length) { winGame(); return; }
    loadLevel(G.levelIdx + 1, true);
    showIntro();
  }

  function confetti(x, y) {
    const cols = ['#ff6b9d', '#4ecdc4', '#ffd94a', '#8aff7a', '#ffffff'];
    for (let i = 0; i < 60; i++) {
      const a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 240;
      G.parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 200, g: 500, life: 1.4 + Math.random(), t: 0, col: cols[i % cols.length], sz: 3 + Math.random() * 4 });
    }
  }

  // ---------- update ----------
  function updatePlayer(p, dt) {
    const k = inp[p.pid];
    if (p.st === 'bubble') {
      const mate = G.players.find(q => q !== p && (q.st === 'play' || q.st === 'clear'));
      if (!mate) {
        // nobody to float to — land back at the start rather than vanish
        p.x = G.level.spawn.x; p.y = G.level.spawn.y;
        p.vx = p.vy = 0; p.st = 'play'; p.invuln = 2;
        return;
      }
      const tx = mate.x + mate.w / 2 - p.w / 2, ty = mate.y - 10;
      p.bx = lerp(p.bx, tx, Math.min(1, 4 * dt));
      p.by = lerp(p.by, ty, Math.min(1, 4 * dt));
      p.x = p.bx; p.y = p.by;
      if (Math.hypot(p.x - tx, p.y - ty) < 26 && mate.onGround) {
        p.st = 'play'; p.invuln = 2; p.powered = false;
        SK.sfx.pop();
        sparkle(p.x + p.w / 2, p.y + p.h / 2, '#bfeaff', 10);
      }
      return;
    }
    if (p.st === 'dead') {
      p.deadT += dt;
      p.vy += GRAV * 0.6 * dt;
      p.y += p.vy * dt;
      if (p.deadT > 1.5 && G.state === 'play') respawnOrBubble(p);
      return;
    }
    if (p.st === 'clear') {
      p.x += p.vx * dt;
      p.animT += dt * 10;
      return;
    }
    if (p.st !== 'play') return;

    // horizontal
    const dir = (k.r ? 1 : 0) - (k.l ? 1 : 0);
    const max = k.run ? RUN_MAX : WALK_MAX;
    if (dir) {
      const acc = p.onGround ? ACC_G : ACC_A;
      if (Math.sign(p.vx) !== dir && Math.abs(p.vx) > 60 && p.onGround) {
        p.skid = 0.15;
        if (Math.abs(p.vx) > 150) dust(p.x + p.w / 2, p.y + p.h, 2);
      }
      p.vx += acc * dir * dt;
      p.vx = clamp(p.vx, -max, max);
      p.face = dir;
    } else {
      const f = (p.onGround ? FRICTION : 500) * dt;
      p.vx = Math.abs(p.vx) <= f ? 0 : p.vx - Math.sign(p.vx) * f;
    }

    // jump
    if (p.onGround) p.coyote = COYOTE; else p.coyote -= dt;
    p.jbuf -= dt;
    if (k.jEdge) { p.jbuf = JBUF; k.jEdge = 0; }
    if (p.jbuf > 0 && p.coyote > 0) {
      const jv = JUMP_BASE + Math.abs(p.vx) * JUMP_RUNK;
      p.vy = -jv;
      p.coyote = 0; p.jbuf = 0;
      SK.sfx.jump(p.powered);
      dust(p.x + p.w / 2, p.y + p.h, 3);
    }
    if (!k.j && p.vy < -JUMP_CUT) p.vy = -JUMP_CUT;

    // gravity
    p.vy += GRAV * dt;
    if (p.vy > MAXFALL) p.vy = MAXFALL;

    // throw spark-heart
    p.throwCd -= dt;
    if (k.runEdge) {
      k.runEdge = 0;
      if (p.powered && p.throwCd <= 0) {
        p.throwCd = 0.38;
        G.projs.push({ x: p.x + p.w / 2 + p.face * 14, y: p.y + 14, vx: p.face * 400, vy: -60, t: 0, owner: p.pid });
        SK.sfx.throwIt();
      }
    }

    // integrate
    p.onGround = false;
    moveX(p, dt);
    const wasAir = !p.onGround;
    moveY(p, dt, (tx, ty) => hitBlock(p, tx, ty));
    if (p.onGround && p.vy === 0 && p.landedAir) { dust(p.x + p.w / 2, p.y + p.h, 4); p.landedAir = false; }
    if (!p.onGround) p.landedAir = true;

    p.x = clamp(p.x, 0, G.level.w * TILE - p.w);
    if (p.y > G.level.h * TILE + 40) { killPlayer(p); p.deadT = 1.0; } // pit

    p.invuln -= dt; p.skid -= dt;
    p.animT += dt * (Math.abs(p.vx) / 60 + 0.1) * (k.run ? 1.4 : 1);

    // coins pickup
    for (const c of G.coinsEnt) {
      if (c.got) continue;
      if (Math.abs(p.x + p.w / 2 - c.x) < 24 && Math.abs(p.y + p.h / 2 - c.y) < 30) {
        c.got = true; addCoin(p, c.x, c.y); SK.sfx.coin();
      }
    }

    // items pickup
    for (const it of G.items) {
      if (it.type !== 'heart' || it.got) continue;
      if (overlap(p, it)) {
        it.got = true;
        p.powered = true; p.score += 1000; p.powerT = 6;
        SK.sfx.power();
        sparkle(p.x + p.w / 2, p.y + 12, '#ff8ab0', 12);
        addText(p.x, p.y - 8, 'POWER UP!', '#ff8ab0');
      }
    }

    // flag
    if (p.x + p.w / 2 >= G.level.flag.x - 6) levelClear();

    // co-op: offscreen / lagging -> bubble (free)
    if (G.mode === 'coop') {
      const offL = p.x + p.w < G.cam - 60, offR = p.x > G.cam + W + 60;
      const mate = G.players.find(q => q !== p);
      // only the player left *behind* bubbles — never the on-screen leader
      const far = mate && (mate.x + mate.w / 2) - (p.x + p.w / 2) > W - 90;
      if (offL || offR || far) p.lagT += dt; else p.lagT = 0;
      if (p.lagT > (far ? 0.4 : 1.1)) {
        p.st = 'bubble'; p.lagT = 0;
        p.bx = p.x; p.by = p.y - 80;
        SK.sfx.bubble();
        addText(p.x, p.y - 16, 'bubble!', '#bfeaff');
      }
    }
  }

  const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  function updateEnemy(e, dt) {
    if (e.dead) {
      e.deadT += dt;
      if (e.dead === 2) { e.vy += GRAV * dt; e.y += e.vy * dt; e.x += e.vx * dt; }
      return;
    }
    e.t += dt;
    if (e.type === 'f') {
      e.x += e.vx * dt;
      e.y = e.baseY + Math.sin(e.t * 3) * 20;
      const aheadX = Math.floor((e.vx > 0 ? e.x + e.w : e.x) / TILE);
      if (solidAt(aheadX, Math.floor((e.y + e.h / 2) / TILE))) e.vx = -e.vx;
      else if (e.x < e.homeX - 90) e.vx = Math.abs(e.vx);
      else if (e.x > e.homeX + 90) e.vx = -Math.abs(e.vx);
    } else {
      e.vy += GRAV * dt;
      const hitWall = moveX(e, dt);
      if (hitWall) e.vx = -e.vx;
      moveY(e, dt);
      if (e.y > G.level.h * TILE + 60) e.dead = 3;
    }

    // touch players
    for (const p of G.players) {
      if (p.st !== 'play' || e.dead) continue;
      if (!overlap(p, e)) continue;
      const stomp = p.vy > 60 && (p.y + p.h) - e.y < e.h * 0.6;
      if (stomp && e.type !== 'g') {
        e.dead = 1; e.deadT = 0;
        p.vy = (inp[p.pid].j ? -STOMP_BOOST : -STOMP_BOUNCE);
        p.score += 200;
        SK.sfx.stomp();
        dust(e.x + e.w / 2, e.y + e.h, 5);
      } else {
        hurtPlayer(p);
      }
    }
  }

  function killEnemy(e, flip) {
    if (e.dead) return;
    e.dead = flip ? 2 : 1; e.deadT = 0;
    if (flip) { e.vy = -420; e.vx = 60 * (Math.random() < 0.5 ? -1 : 1); }
  }

  function updateItems(dt) {
    for (const it of G.items) {
      if (it.type === 'coinpop') {
        it.t += dt; it.vy += 1600 * dt; it.y += it.vy * dt;
        continue;
      }
      if (it.type === 'heart' && !it.got) {
        it.born += dt;
        it.vy += GRAV * dt;
        if (moveX(it, dt)) it.vx = -it.vx;
        moveY(it, dt);
        if (it.y > G.level.h * TILE + 60) it.got = true;
      }
    }
    G.items = G.items.filter(i => i.type === 'coinpop' ? i.t < 0.8 : !i.got);
  }

  function updateProjs(dt) {
    for (const s of G.projs) {
      s.t += dt;
      s.vy += 700 * dt;
      s.x += s.vx * dt; s.y += s.vy * dt;
      const tx = Math.floor(s.x / TILE), ty = Math.floor(s.y / TILE);
      if (solidAt(tx, ty)) { s.dead = true; sparkle(s.x, s.y, '#ff8ab0', 5); continue; }
      for (const e of G.enemies) {
        if (e.dead) continue;
        if (s.x > e.x - 4 && s.x < e.x + e.w + 4 && s.y > e.y - 4 && s.y < e.y + e.h + 4) {
          s.dead = true;
          killEnemy(e, true);
          const p = G.players[s.owner];
          if (p) p.score += 200;
          SK.sfx.kick();
          sparkle(e.x + e.w / 2, e.y, '#ffd94a', 8);
          break;
        }
      }
      if (s.t > 1.4 || s.y > G.level.h * TILE) s.dead = true;
    }
    G.projs = G.projs.filter(s => !s.dead);
  }

  function updateCamera(dt) {
    const live = G.players.filter(p => p.st === 'play' || p.st === 'clear' || p.st === 'bubble');
    if (!live.length) return;
    let mid = 0;
    live.forEach(p => mid += p.x + p.w / 2);
    mid /= live.length;
    const target = clamp(mid - W / 2, 0, Math.max(0, G.level.w * TILE - W));
    G.cam = Math.abs(target - G.cam) > 600 ? target : lerp(G.cam, target, Math.min(1, 8 * dt));
  }

  function update(dt) {
    G.t += dt;
    if (G.state === 'clear') {
      G.clearT += dt;
      G.players.forEach(p => updatePlayer(p, dt));
      updateItems(dt); updateProjs(dt);
      updateParticles(dt);
      updateCamera(dt);
      if (G.clearT > 2.4) {
        const last = G.levelIdx + 1 >= SK.levels.length;
        showCard(last ? '🚩 LEVEL CLEAR!' : '🚩 LEVEL CLEAR!',
          `Time bonus +${Math.ceil(G.timeLeft) * 10}\n` +
          G.players.map(p => `${p.name}: ${pad6(p.score)}`).join('\n'),
          [{ label: last ? 'Finish!' : 'Next Level ▶', cb: () => { hideCards(); nextLevel(); }, cls: 'bigbtn' }]);
        G.state = 'cardwait';
      }
      return;
    }
    if (G.state !== 'play') return;

    G.timeLeft -= dt;
    if (G.timeLeft <= 0) {
      G.timeLeft = 0;
      G.players.forEach(p => { if (p.st === 'play') killPlayer(p); });
    }

    G.players.forEach(p => updatePlayer(p, dt));
    G.enemies.forEach(e => updateEnemy(e, dt));
    G.enemies = G.enemies.filter(e => e.dead !== 3 && !(e.dead === 2 && e.y > G.level.h * TILE + 80) && !(e.dead === 1 && e.deadT > 0.5));
    updateItems(dt); updateProjs(dt);
    updateParticles(dt);
    for (const a of G.anims) a.t += dt;
    G.anims = G.anims.filter(a => a.t < 0.28);
    updateCamera(dt);
    updateHUD();
  }

  function updateParticles(dt) {
    for (const pt of G.parts) {
      pt.t += dt;
      pt.vy += pt.g * dt;
      pt.x += pt.vx * dt; pt.y += pt.vy * dt;
    }
    G.parts = G.parts.filter(p => p.t < p.life);
    for (const t of G.texts) { t.t += dt; t.y -= 40 * dt; }
    G.texts = G.texts.filter(t => t.t < 1.0);
  }

  // ---------- rendering ----------
  function drawTile(ch, tx, ty, ox) {
    const x = tx * TILE - ox;
    let y = ty * TILE;
    if (ch === 'X') {
      const grass = !solidAt(tx, ty - 1);
      ctx.fillStyle = '#8a5a30'; ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = '#7a4c26';
      ctx.fillRect(x + 6, y + 12, 4, 4); ctx.fillRect(x + 20, y + 20, 4, 4); ctx.fillRect(x + 14, y + 26, 4, 4);
      if (grass) {
        ctx.fillStyle = '#54b054'; ctx.fillRect(x, y, TILE, 10);
        ctx.fillStyle = '#7ed07e'; ctx.fillRect(x, y, TILE, 4);
        ctx.fillStyle = '#54b054';
        ctx.fillRect(x + 4, y + 10, 3, 3); ctx.fillRect(x + 18, y + 10, 3, 3); ctx.fillRect(x + 26, y + 10, 3, 3);
      }
    } else if (ch === 'B') {
      y += bumpDy(tx, ty);
      ctx.fillStyle = '#b0522e'; ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = '#7a3418';
      ctx.fillRect(x, y + 14, TILE, 3); ctx.fillRect(x, y + 29, TILE, 3);
      ctx.fillRect(x + 14, y, 3, 14); ctx.fillRect(x + 6, y + 15, 3, 14); ctx.fillRect(x + 24, y + 15, 3, 14);
      ctx.fillStyle = '#d47a52'; ctx.fillRect(x, y, TILE, 3);
    } else if (ch === '?' || ch === 'M') {
      drawQuestion(x, y + bumpDy(tx, ty), ch === 'M');
    } else if (ch === 'u') {
      y += bumpDy(tx, ty);
      ctx.fillStyle = '#9a7438'; ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = '#6e5024'; ctx.fillRect(x, y, TILE, 3); ctx.fillRect(x, y + TILE - 3, TILE, 3);
      ctx.fillRect(x + 4, y + 4, 3, 3); ctx.fillRect(x + TILE - 7, y + 4, 3, 3);
      ctx.fillRect(x + 4, y + TILE - 7, 3, 3); ctx.fillRect(x + TILE - 7, y + TILE - 7, 3, 3);
    } else if (ch === 'S') {
      ctx.fillStyle = '#8a92a8'; ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = '#6a7288'; ctx.fillRect(x + 3, y + 3, TILE - 6, TILE - 6);
      ctx.fillStyle = '#8a92a8'; ctx.fillRect(x + 6, y + 6, TILE - 12, TILE - 12);
      ctx.fillStyle = '#aab2c8'; ctx.fillRect(x + 3, y + 3, TILE - 6, 3);
    } else if (ch === 'd') {
      const cap = tileAt(tx, ty - 1) !== 'd';
      const left = tileAt(tx - 1, ty) !== 'd';
      if (cap) {
        if (left) { // cap spans both columns, drawn once from the left tile
          ctx.fillStyle = '#1b8a72'; ctx.fillRect(x - 2, y, 68, 14);
          ctx.fillStyle = '#2ec4a0'; ctx.fillRect(x - 2, y, 68, 10);
          ctx.fillStyle = '#7fe8d0'; ctx.fillRect(x + 4, y + 2, 5, 8);
          ctx.fillStyle = '#0e5a48'; ctx.fillRect(x + 58, y + 2, 5, 8);
        }
      } else {
        ctx.fillStyle = '#2ec4a0'; ctx.fillRect(x, y, TILE, TILE);
        if (left) {
          ctx.fillStyle = '#7fe8d0'; ctx.fillRect(x + 4, y, 5, TILE);
          ctx.fillStyle = '#1b8a72'; ctx.fillRect(x, y, 2, TILE);
        } else {
          ctx.fillStyle = '#1b8a72'; ctx.fillRect(x + TILE - 7, y, 7, TILE);
        }
      }
    }
  }

  function bumpDy(tx, ty) {
    const a = G.anims.find(a => a.tx === tx && a.ty === ty);
    return a ? -Math.sin((a.t / 0.28) * Math.PI) * 9 : 0;
  }

  function drawQuestion(x, y, isHeart) {
    ctx.fillStyle = '#e8a32e'; ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = '#b87a1e'; ctx.fillRect(x, y, TILE, 4); ctx.fillRect(x, y + TILE - 4, TILE, 4);
    ctx.fillRect(x, y, 4, TILE); ctx.fillRect(x + TILE - 4, y, 4, TILE);
    ctx.fillStyle = '#ffd977'; ctx.fillRect(x + 4, y + 4, TILE - 8, 3);
    ctx.fillStyle = '#7a4c12';
    ctx.fillRect(x + 6, y + 6, 3, 3); ctx.fillRect(x + TILE - 9, y + 6, 3, 3);
    ctx.fillRect(x + 6, y + TILE - 9, 3, 3); ctx.fillRect(x + TILE - 9, y + TILE - 9, 3, 3);
    ctx.fillStyle = isHeart ? '#ff4a6a' : '#fff2cc';
    ctx.font = 'bold 20px "Courier New", monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(isHeart ? '♥' : '?', x + TILE / 2, y + TILE / 2 + 1);
  }

  function drawBackground() {
    const sky = G.level.sky;
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, sky.top); grad.addColorStop(1, sky.bot);
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);

    // sun
    ctx.fillStyle = '#fff8d8';
    ctx.beginPath(); ctx.arc(W - 130, 70, 34, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff3b0';
    ctx.beginPath(); ctx.arc(W - 130, 70, 26, 0, 7); ctx.fill();

    // clouds (parallax .35)
    ctx.fillStyle = '#ffffffcc';
    const cw = 300;
    for (let i = -1; i < W / cw + 2; i++) {
      const cx = i * cw - (G.cam * 0.35 % cw) + ((i % 2) ? 90 : 0);
      const cy = 50 + ((i * 37) % 60);
      cloud(cx, cy);
    }
    // far hills (parallax .25)
    ctx.fillStyle = sky.far;
    const hw = 340;
    for (let i = -1; i < W / hw + 2; i++) {
      const hx = i * hw - (G.cam * 0.25 % hw);
      ctx.beginPath();
      ctx.ellipse(hx + 170, H - 40, 190, 130, 0, Math.PI, 0);
      ctx.fill();
    }
    // near hills (parallax .5)
    ctx.fillStyle = sky.near;
    const nw = 240;
    for (let i = -1; i < W / nw + 2; i++) {
      const hx = i * nw - (G.cam * 0.5 % nw);
      ctx.beginPath();
      ctx.ellipse(hx + 120, H - 10, 130, 80, 0, Math.PI, 0);
      ctx.fill();
    }
  }
  function cloud(x, y) {
    ctx.beginPath();
    ctx.ellipse(x, y, 26, 12, 0, 0, 7);
    ctx.ellipse(x + 20, y - 6, 20, 11, 0, 0, 7);
    ctx.ellipse(x + 40, y, 24, 12, 0, 0, 7);
    ctx.fill();
  }

  function drawFlag() {
    const fx = G.level.flag.x - G.cam;
    const groundY = G.level.flag.y + TILE;
    // pole
    ctx.fillStyle = '#c8ccd8'; ctx.fillRect(fx - 3, 60, 6, groundY - 60);
    ctx.fillStyle = '#8a8ea0'; ctx.fillRect(fx + 1, 60, 2, groundY - 60);
    // ball
    ctx.fillStyle = '#ffd94a';
    ctx.beginPath(); ctx.arc(fx, 54, 8, 0, 7); ctx.fill();
    // waving flag with heart
    const wob = Math.sin(G.t * 4) * 3;
    ctx.fillStyle = '#ff4a6a';
    ctx.beginPath();
    ctx.moveTo(fx + 3, 64);
    ctx.lineTo(fx + 40 + wob, 76);
    ctx.lineTo(fx + 3, 90);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('♥', fx + 16, 76);
  }

  function drawChar(char, frame, x, y, face, opts) {
    const img = SK.spr[char][frame] || SK.spr[char].idle;
    const dw = 32 * (opts && opts.scale || 1), dh = 48 * (opts && opts.scale || 1);
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    if (face < 0) { ctx.translate(dw, 0); ctx.scale(-1, 1); }
    if (opts && opts.ghost) ctx.globalAlpha = 0.55;
    if (opts && opts.flat) { ctx.translate(0, dh * 0.8); ctx.scale(1, 0.2); }
    if (opts && opts.spin) { ctx.translate(dw / 2, dh / 2); ctx.rotate(opts.spin); ctx.translate(-dw / 2, -dh / 2); }
    ctx.drawImage(img, 0, 0, dw, dh);
    ctx.restore();
    if (opts && opts.powered) {
      // sparkle aura for powered form
      const t = G.t * 8;
      ctx.fillStyle = '#ffe9f4';
      for (let i = 0; i < 4; i++) {
        const a = t + i * 1.7;
        ctx.fillRect(x + dw / 2 + Math.cos(a) * (dw * 0.7) - 2, y + dh / 2 + Math.sin(a) * (dh * 0.55) - 2, 4, 4);
      }
    }
  }

  function playerFrame(p) {
    if (p.st === 'dead') return 'dead';
    if (!p.onGround) return 'jump';
    if (Math.abs(p.vx) > 15) return (Math.floor(p.animT) % 2) ? 'run0' : 'run1';
    return 'idle';
  }

  function drawPlayer(p) {
    if (p.st === 'out') return;
    const blink = p.invuln > 0 && Math.floor(G.t * 14) % 2 === 0;
    if (blink && p.st === 'play') return; // invulnerability blink
    const sc = p.powered ? 1.18 : 1;
    const dw = 32, dh = 48 * sc;
    const x = p.x + p.w / 2 - 16, y = p.y + p.h - dh;
    if (p.st === 'bubble') {
      // bubble
      ctx.strokeStyle = '#bfeaff'; ctx.lineWidth = 3;
      ctx.fillStyle = '#bfeaff33';
      ctx.beginPath();
      ctx.arc(p.x + p.w / 2, p.y + p.h / 2, 30, 0, 7);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ffffff88';
      ctx.beginPath(); ctx.arc(p.x + p.w / 2 - 10, p.y + p.h / 2 - 12, 6, 0, 7); ctx.fill();
      drawChar(p.char, 'idle', x, y, p.face, { scale: sc });
      return;
    }
    drawChar(p.char, playerFrame(p), x, y, p.face,
      { scale: sc, spin: p.st === 'dead' ? Math.sin(p.deadT * 6) * 0.4 : 0, powered: p.powered });
    // name tag
    ctx.fillStyle = '#00000088';
    ctx.font = 'bold 11px sans-serif';
    const nm = p.name, tw = ctx.measureText(nm).width;
    ctx.fillRect(x + 16 - tw / 2 - 4, y - 16, tw + 8, 13);
    ctx.fillStyle = p.pid === 0 ? '#4ecdc4' : '#ff6b9d';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(nm, x + 16, y - 9);
  }

  function drawEnemy(e) {
    let img;
    const fr = Math.floor(e.t * 6) % 2;
    if (e.type === 'm') img = SK.spr.maru[fr];
    else if (e.type === 'g') img = SK.spr.toge[fr];
    else img = SK.spr.pata[fr];
    const x = e.x + e.w / 2 - 16, y = e.y + e.h - 32;
    if (e.dead === 1) {
      ctx.save();
      ctx.translate(x + 16, y + 32);
      ctx.scale(1, Math.max(0.15, 1 - e.deadT * 4));
      ctx.drawImage(img, -16, -32, 32, 32);
      ctx.restore();
    } else if (e.dead === 2) {
      ctx.save();
      ctx.translate(x + 16, y + 16);
      ctx.scale(1, -1);
      ctx.drawImage(img, -16, -16, 32, 32);
      ctx.restore();
    } else {
      const face = e.vx < 0 ? -1 : 1;
      ctx.save();
      if (face > 0) { ctx.translate(x + 32, y); ctx.scale(-1, 1); ctx.drawImage(img, 0, 0, 32, 32); }
      else ctx.drawImage(img, x, y, 32, 32);
      ctx.restore();
    }
  }

  function drawCoin(c) {
    const s = Math.abs(Math.cos(G.t * 4 + c.ph));
    ctx.save();
    ctx.translate(c.x - G.cam, c.y);
    ctx.scale(Math.max(0.15, s), 1);
    ctx.fillStyle = '#b87a1e';
    ctx.beginPath(); ctx.arc(0, 0, 11, 0, 7); ctx.fill();
    ctx.fillStyle = '#ffd94a';
    ctx.beginPath(); ctx.arc(0, 0, 9, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff3b0';
    ctx.fillRect(-2, -6, 3, 12);
    ctx.restore();
  }

  function draw() {
    drawBackground();
    const ox = Math.round(G.cam);

    // tiles
    const tx0 = Math.max(0, Math.floor(ox / TILE)), tx1 = Math.min(G.level.w - 1, Math.ceil((ox + W) / TILE));
    for (let ty = 0; ty < G.level.h; ty++)
      for (let tx = tx0; tx <= tx1; tx++) {
        const c = G.grid[ty][tx];
        if (c !== ' ') drawTile(c, tx, ty, ox);
      }

    drawFlag();

    // waiting partner NPC (solo mode)
    if (G.mode === 'solo' && G.waitingChar && G.level.wait) {
      const nx = G.level.wait.x - ox, ny = G.level.wait.y - 48;
      const fr = Math.floor(G.t * 3) % 2 ? 'wave' : 'idle';
      drawChar(G.waitingChar, fr, nx, ny, -1, {});
      ctx.font = '16px sans-serif';
      ctx.fillStyle = '#ff4a6a';
      ctx.fillText('♥', nx + 16, ny - 14 + Math.sin(G.t * 3) * 4);
    }

    // entities
    G.coinsEnt.forEach(c => { if (!c.got && c.x - ox > -40 && c.x - ox < W + 40) drawCoin(c); });
    G.items.forEach(it => {
      if (it.type === 'coinpop') { drawCoin({ x: it.x, y: it.y, ph: 0 }); }
      else if (it.type === 'heart' && !it.got) {
        const bob = Math.sin(it.born * 5) * 2;
        ctx.drawImage(SK.spr.heart, it.x - ox, it.y + bob, 28, 28);
      }
    });
    G.enemies.forEach(e => {
      if (e.x - ox > -60 && e.x - ox < W + 60) {
        ctx.save(); ctx.translate(-ox, 0); drawEnemy(e); ctx.restore();
      }
    });
    G.projs.forEach(s => {
      ctx.save();
      ctx.translate(s.x - ox, s.y);
      ctx.rotate(s.t * 9 * Math.sign(s.vx));
      ctx.drawImage(SK.spr.spark, -8, -8, 16, 16);
      ctx.restore();
    });
    G.players.forEach(p => { ctx.save(); ctx.translate(-ox, 0); drawPlayer(p); ctx.restore(); });

    // particles
    for (const pt of G.parts) {
      ctx.globalAlpha = Math.max(0, 1 - pt.t / pt.life);
      ctx.fillStyle = pt.col;
      ctx.fillRect(pt.x - ox - pt.sz / 2, pt.y - pt.sz / 2, pt.sz, pt.sz);
    }
    ctx.globalAlpha = 1;

    // floating texts
    ctx.font = 'bold 14px "Courier New", monospace';
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    for (const t of G.texts) {
      ctx.globalAlpha = Math.max(0, 1 - t.t);
      ctx.fillStyle = '#000';
      ctx.fillText(t.txt, t.x - ox + 1, t.y + 1);
      ctx.fillStyle = t.col;
      ctx.fillText(t.txt, t.x - ox, t.y);
    }
    ctx.globalAlpha = 1;
  }

  // ---------- HUD ----------
  function updateHUD() {
    const fmt = p => `${p.name} · ${pad6(p.score)} · ${'♥'.repeat(Math.max(0, p.lives)) || '✕'}`;
    hudP1.textContent = fmt(G.players[0]);
    if (G.players[1]) hudP2.textContent = fmt(G.players[1]);
    hudCoins.textContent = G.coins;
    hudTime.textContent = Math.ceil(G.timeLeft);
    hudTime.parentElement.style.color = G.timeLeft < 30 ? '#ff6b6b' : '';
  }

  // ---------- screens ----------
  const cardScreen = $('cardScreen'), cardTitle = $('cardTitle'), cardSub = $('cardSub'), cardBtns = $('cardBtns');
  function showCard(title, sub, btns) {
    cardTitle.innerHTML = title;
    cardSub.textContent = sub;
    cardBtns.innerHTML = '';
    btns.forEach(b => {
      const el = document.createElement('button');
      el.className = b.cls || 'midbtn';
      el.innerHTML = b.label;
      el.addEventListener('click', () => { SK.sfx.unlock(); SK.sfx.select(); el.blur(); b.cb(); });
      cardBtns.appendChild(el);
    });
    cardScreen.classList.remove('hidden');
  }
  function hideCards() { cardScreen.classList.add('hidden'); }

  function showBanner(txt, ms) {
    banner.textContent = txt;
    banner.classList.remove('hidden');
    banner.style.opacity = 1;
    clearTimeout(banner._t);
    banner._t = setTimeout(() => { banner.style.opacity = 0; }, ms || 1400);
  }

  function showIntro() {
    const L = G.level;
    G.state = 'intro';
    showCard(`World 1-${G.levelIdx + 1}`,
      `${L.name} — ${L.sub}\n${G.players.map(p => `${p.name} ♥${p.lives}`).join('   ')}`,
      [{ label: 'GO!', cb: () => { hideCards(); G.state = 'play'; showBanner(`WORLD 1-${G.levelIdx + 1}`, 1200); }, cls: 'bigbtn' }]);
  }

  function toTitle() {
    G.state = 'title';
    hideCards();
    $('pauseScreen').classList.add('hidden');
    $('titleScreen').classList.remove('hidden');
    $('charRow').classList.add('hidden');
    $('modeRow').classList.remove('hidden');
    refreshPads();
  }

  function startGame(replay) {
    const n1 = ($('name1').value || 'koto').slice(0, 10);
    const n2 = ($('name2').value || 'zuza').slice(0, 10);
    G.players = [];
    if (G.mode === 'solo') {
      const hero = G.soloChar === 'zuza' ? 'zuza' : 'koto';
      const p = makePlayer(hero, hero === 'koto' ? n1 : n2, 0);
      G.players.push(p);
      G.waitingChar = hero === 'koto' ? 'zuza' : 'koto';
      chipP2.classList.add('hidden');
    } else {
      G.players.push(makePlayer('koto', n1, 0), makePlayer('zuza', n2, 1));
      G.waitingChar = null;
      chipP2.classList.remove('hidden');
    }
    G.coins = 0;
    $('titleScreen').classList.add('hidden');
    loadLevel(0, false);
    showIntro();
    refreshPads();
  }

  function togglePause(force) {
    if (G.state === 'play' || force === true) {
      if (G.state !== 'play') return;
      G.state = 'pause';
      $('pauseScreen').classList.remove('hidden');
      SK.sfx.pause();
    } else if (G.state === 'pause') {
      G.state = 'play';
      $('pauseScreen').classList.add('hidden');
      SK.sfx.pause();
    }
  }

  function reloadLevel(keepScore) {
    const scores = G.players.map(p => p.score);
    const lives = G.players.map(p => p.lives);
    loadLevel(G.levelIdx, true);
    G.players.forEach((p, i) => { p.score = scores[i]; p.lives = Math.max(1, lives[i]); p.powered = false; });
    G.state = 'play';
    hideCards();
    $('pauseScreen').classList.add('hidden');
  }

  // ---------- wiring ----------
  $('btnSolo').addEventListener('click', () => {
    SK.sfx.unlock(); SK.sfx.select();
    G.mode = 'solo';
    $('modeRow').classList.add('hidden');
    $('charRow').classList.remove('hidden');
    $('pickName1').textContent = $('name1').value || 'koto';
    $('pickName2').textContent = $('name2').value || 'zuza';
  });
  $('btnCoop').addEventListener('click', () => {
    SK.sfx.unlock(); SK.sfx.select();
    G.mode = 'coop';
    startGame();
  });
  $('pickKoto').addEventListener('click', () => { G.soloChar = 'koto'; SK.sfx.select(); startGame(); });
  $('pickZuza').addEventListener('click', () => { G.soloChar = 'zuza'; SK.sfx.select(); startGame(); });
  $('btnResume').addEventListener('click', () => togglePause());
  $('btnRestart').addEventListener('click', () => reloadLevel());
  $('btnQuit').addEventListener('click', () => toTitle());
  $('btnPause').addEventListener('click', () => togglePause());
  $('btnMute').addEventListener('click', () => toggleMute());
  function toggleMute() {
    const m = SK.sfx.toggleMute();
    $('btnMute').textContent = m ? '🔇' : '🔊';
  }

  // ---------- main loop ----------
  let last = 0;
  function loop(ts) {
    const dt = Math.min(0.033, (ts - last) / 1000 || 0.016);
    last = ts;
    if (G.state === 'play' || G.state === 'clear') update(dt);
    if (G.state !== 'title' && G.level) draw();
    else {
      // attract-mode backdrop behind the title card
      drawBackground();
      ctx.fillStyle = '#0008'; ctx.fillRect(0, 0, W, H);
    }
    requestAnimationFrame(loop);
  }

  // ---------- boot ----------
  SK.buildSprites();
  SK.G = G; // debug/testing handle
  // title-screen character previews
  document.querySelectorAll('#pickKoto .charprev')[0].getContext('2d').drawImage(SK.spr.koto.idle, 0, 0, 64, 96);
  document.querySelectorAll('#pickZuza .charprev')[0].getContext('2d').drawImage(SK.spr.zuza.idle, 0, 0, 64, 96);
  // demo level behind title
  G.level = SK.levels[0];
  G.grid = G.level.grid.map(r => r.slice());
  G.players = [makePlayer('koto', 'koto', 0)];
  updateHUD();
  refreshPads();
  requestAnimationFrame(loop);
})();
