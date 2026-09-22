/* dream-home court module — basketball half-court + winter ice rink.
   Contract with game.js (same as furniture.js):
     DH.court.init(state)                    – called once at load
     DH.court.start(state)                   – called when a run starts
     DH.court.update(dt, state)              – per frame (sim; host side only)
     DH.court.interactables(p)               – -> [{label,x,y,action}]
     DH.court.collectDraws(draws, camX, camY) – push {y, fn} for depth-sorted render
     DH.court.drawGround(ctx, camX, camY, state) – court/ice surface UNDER entities
     DH.court.drawOverlay(ctx, camX, camY, state) – scoreboard, charge bar, hints, fx
     DH.court.serialize()/deserialize(data)/remoteAction(name, args)

   Notes on wiring: game.js's nearestActions() and net.js's module list only
   cover furniture/garden/animals, so this module dispatches its own actions:
   update() watches DH.inp[pid].a for press/release edges and calls
   interactables()[0].action() (the contract array is still honored). Charge
   shots use hold-to-release, detected the same way.
   Ice skating nudges p.x/p.y AFTER game.js's movement each frame — players
   carry real momentum on the rink (stored in the unused p.vx/p.vy fields).
*/
(function () {
  const DH = (window.DH = window.DH || {});
  const T = 32;

  // ---------- geometry ----------
  const CT = { x: 11 * T, y: 12 * T, w: 7 * T, h: 5 * T };   // tiles x11-17, y12-16
  const CX = CT.x + CT.w / 2;                                // 464
  const RIM = { x: CX, y: CT.y + 6 };                        // rim hangs on top edge
  const POLE_TILE = "14,11";                                 // blocked: pole footing
  const SPOT = { x: CX, y: CT.y + CT.h + 6 };                // 'Play'/'Skate' anchor
  const SPOT_R = 40;
  const ARC_R = 96;           // release beyond this = long shot (2 pts in versus)
  const WIN_SCORE = 5;        // versus: first to 5
  const JOIN_WINDOW = 6;      // seconds the second player may join for 1v1

  // ice physics
  const ICE_ACC = 640, ICE_MAX = 205, SKATE_MAX = 240, ICE_DECAY = 1.9;
  const SPIN_LIMIT = 3.2, FALL_T = 1.4;

  const rnd = (a, b) => a + Math.random() * (b - a);
  const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function h2(x, y) { // deterministic decor hash (same recipe as world.js)
    let h = (x * 374761393 + y * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  }

  const onCourt = (x, y) => x > CT.x - 4 && x < CT.x + CT.w + 4 && y > CT.y - 4 && y < CT.y + CT.h + 4;
  const onRink = (x, y) => x > CT.x + 8 && x < CT.x + CT.w - 8 && y > CT.y + 8 && y < CT.y + CT.h - 8;

  // ---------- state (plain JSON only — serialized for net sync) ----------
  let gs = null, C = null;
  const S = {
    mode: "off",                 // off | wait | solo | versus | win
    join: [false, false],
    waitT: 0, winT: 0, winPid: -1,
    score: [0, 0],
    solo: { shots: 0, made: 0, streak: 0 },
    ball: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, holder: -1, freeT: 0, fly: null },
    noSteal: 0, netT: 0,
    charge: [0, 0], charging: [false, false], stealCd: [0, 0],
    skating: [false, false], spin: [0, 0], fall: [0, 0],
    marks: [], fx: [],
    msg: "", msgT: 0,
  };
  // sim-local (not serialized): prev input edge, prev pos for ice physics
  const loc = {
    prevA: [0, 0], px: [0, 0], py: [0, 0], onIce: [false, false], inited: [false, false],
    cd: [0, 0], happyAcc: [0, 0], markAcc: [0, 0], pin: [{ x: 0, y: 0 }, { x: 0, y: 0 }],
    season: null,
  };

  function resetBall() {
    S.ball = { x: CX, y: CT.y + CT.h / 2 + 18, z: 0, vx: 0, vy: 0, vz: 0, holder: -1, freeT: 0, fly: null };
  }
  function say(msg, t = 2.2) { S.msg = msg; S.msgT = t; }
  function fx(k, x, y, o = {}) { S.fx.push({ k, x, y, life: o.life || 0.8, max: o.life || 0.8, ...o }); }

  // ---------- actions (remote-callable via remoteAction) ----------
  function pressPlay(pid) {
    const winter = gs.season === "winter";
    if (winter) { toggleSkate(pid); return true; }
    if (S.mode === "off") {
      S.mode = "wait"; S.join = [false, false]; S.join[pid] = true;
      S.waitT = JOIN_WINDOW; S.score = [0, 0]; S.solo = { shots: 0, made: 0, streak: 0 };
      resetBall();
      const other = gs.players[1 - pid];
      say(`${other.name}: press ⚡ at the court to join!`);
      DH.toast(`${gs.players[pid].name} hit the court! 🏀`);
      return true;
    }
    if (S.mode === "wait" && !S.join[pid]) { // second player joins -> versus
      S.join[pid] = true; S.mode = "versus"; S.score = [0, 0];
      S.ball.holder = S.join[0] ? 0 : 1; S.noSteal = 1.5;
      say("1v1! First to 5 🏀"); DH.toast("1v1 — first to 5! 🏀");
      return true;
    }
    if (S.mode === "wait" && S.join[pid]) { S.mode = "off"; DH.toast("Game cancelled"); return true; }
    return false;
  }

  function quitGame(pid) {
    if (S.mode === "off") return false;
    if (S.mode === "versus") say(`${gs.players[pid].name} left the game`);
    endMode();
    return true;
  }

  function endMode() {
    S.mode = "off"; S.join = [false, false]; S.score = [0, 0];
    S.charge = [0, 0]; S.charging = [false, false];
    resetBall();
  }

  function pickUp(pid) {
    const b = S.ball, p = gs.players[pid];
    if (S.mode === "off" || b.holder !== -1 || b.fly || gs.season === "winter") return false;
    if (dist2(p.x, p.y, b.x, b.y) > 30 * 30) return false;
    b.holder = pid; b.fly = null; b.freeT = 0;
    return true;
  }

  function shootBall(pid) {
    const b = S.ball, p = gs.players[pid];
    if (b.holder !== pid || b.fly) return;
    const power = clamp(S.charge[pid], 0, 1);
    const d = Math.hypot(p.x - RIM.x, p.y - RIM.y);
    const ux = (RIM.x - p.x) / (d || 1), uy = (RIM.y - p.y) / (d || 1);
    let tx, ty, made;
    if (d < 55 && power < 0.18) {          // tap near the rim = layup
      made = Math.random() < 0.92;
      tx = RIM.x + rnd(-2, 2); ty = RIM.y + rnd(-2, 2);
    } else {
      const sweet = clamp(0.28 + (d / 240) * 0.62, 0, 0.95); // ideal power grows with range
      const err = (power - sweet) * d * 0.95;                // short/long along shot line
      tx = RIM.x - ux * err + rnd(-4, 4);
      ty = RIM.y - uy * err + rnd(-4, 4);
      made = Math.abs(err) < 9 && dist2(tx, ty, RIM.x, RIM.y) < 11 * 11;
    }
    const pts = d > ARC_R ? 2 : 1;
    b.holder = -1; b.z = 24;
    b.fly = {
      t: 0, dur: 0.5 + d / 380, sx: p.x, sy: p.y, sz: 24,
      tx, ty, arc: 46 + d * 0.28, made, pts, shooter: pid,
    };
    S.charge[pid] = 0; S.charging[pid] = false;
    if (S.mode === "solo") S.solo.shots++;
  }

  function scoreBasket(fly) {
    const pid = fly.shooter, name = gs.players[pid].name;
    gs.coins += 2; gs.happiness += 1;
    S.netT = 0.55;
    fx("pop", RIM.x, RIM.y - 10, { life: 1.1, txt: "+2", vy: -22 });
    for (let i = 0; i < 4; i++) fx("star", RIM.x + rnd(-10, 10), RIM.y + rnd(-4, 8), { life: 0.7, vy: -14 });
    if (S.mode === "versus") {
      S.score[pid] += fly.pts;
      say(`${name} +${fly.pts}!  ${S.score[0]}–${S.score[1]}`);
      DH.toast(`${name} scores +${fly.pts} 🏀`);
      if (S.score[pid] >= WIN_SCORE) {
        S.mode = "win"; S.winPid = pid; S.winT = 3.5;
        say(`🏆 ${name} wins ${Math.max(...S.score)}–${Math.min(...S.score)}!`);
      } else { // loser's ball, brief no-steal grace
        const other = 1 - pid;
        S.ball.holder = other; S.ball.fly = null; S.noSteal = 1.2;
        S.charging[other] = false; S.charge[other] = 0;
      }
      return;
    }
    S.solo.made++; S.solo.streak++;
    say(S.solo.streak > 1 ? `${name} is on fire — ${S.solo.streak} in a row!` : `Swish! +2🪙`);
    DH.toast(Math.random() < 0.3 ? `Swish! +2🪙 +1🏠` : `Bucket! +2🪙`);
    dropBall();
  }

  function missBasket(fly) {
    const b = S.ball;
    b.holder = -1; b.fly = null;
    b.x = fly.tx; b.y = fly.ty; b.z = 10;
    const a = rnd(0, Math.PI * 2), sp = rnd(40, 85); // clang off the rim
    b.vx = Math.cos(a) * sp; b.vy = Math.abs(Math.sin(a) * sp) + 25; b.vz = 55;
    if (S.mode === "solo") { S.solo.streak = 0; }
    if (Math.random() < 0.45) {
      fx("sad", fly.tx, fly.ty - 14, { life: 1 });
      if (Math.random() < 0.5) DH.toast("Brick... ☹️");
    }
  }

  function dropBall() { // after a make: ball falls through the net
    const b = S.ball;
    b.fly = null; b.holder = -1;
    b.x = RIM.x; b.y = RIM.y + 6; b.z = 8;
    b.vx = rnd(-8, 8); b.vy = rnd(10, 30); b.vz = 0; b.freeT = 0;
  }

  function toggleSkate(pid) {
    if (gs.season !== "winter") return false;
    S.skating[pid] = !S.skating[pid];
    DH.toast(S.skating[pid] ? "Skating! ⛸️ press ⚡ to spin" : "Back to shoes 👟");
    return true;
  }

  function spinSkate(pid) {
    if (!S.skating[pid] || S.fall[pid] > 0) return;
    const p = gs.players[pid];
    if (!onRink(p.x, p.y)) return;
    S.spin[pid] += 1.35;
    fx("swirl", p.x, p.y - 18, { life: 0.5 });
    if (S.spin[pid] > SPIN_LIMIT) {
      S.spin[pid] = 0; S.fall[pid] = FALL_T;
      loc.pin[pid] = { x: p.x, y: p.y };
      p.vx = 0; p.vy = 0;
      fx("sad", p.x, p.y - 34, { life: 1.4 });
      DH.toast(`${p.name} slipped on the ice! ☹️`);
    }
  }

  const API = { pressPlay, quitGame, pickUp, toggleSkate, spinSkate };

  // ---------- per-player input edge ----------
  function onPress(pid) {
    const p = gs.players[pid];
    if (!p || S.fall[pid] > 0) return;
    if (gs.season !== "winter" && S.ball.holder === pid) { // start charging a shot
      S.charging[pid] = true; S.charge[pid] = 0;
      return;
    }
    if (S.skating[pid] && onRink(p.x, p.y)) { spinSkate(pid); return; }
    if (loc.cd[pid] > 0) return;
    const acts = M.interactables(p);
    if (acts.length) { loc.cd[pid] = 0.3; acts[0].action(); }
  }
  function onRelease(pid) {
    if (S.charging[pid]) shootBall(pid);
    S.charging[pid] = false; S.charge[pid] = 0;
  }

  // ---------- ball sim ----------
  function stepBall(dt) {
    const b = S.ball;
    if (b.fly) {
      const f = b.fly;
      f.t += dt / f.dur;
      const t = Math.min(1, f.t);
      b.x = f.sx + (f.tx - f.sx) * t;
      b.y = f.sy + (f.ty - f.sy) * t;
      b.z = f.sz + f.arc * 4 * t * (1 - t);
      if (f.t >= 1) (f.made ? scoreBasket : missBasket)(f);
      return;
    }
    if (b.holder !== -1) {
      const p = gs.players[b.holder];
      const d = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[p.dir] || [0, 1];
      b.x = p.x + d[0] * 8; b.y = p.y + 4 + d[1] * 4;
      b.z = p.moving ? Math.abs(Math.sin(p.step * Math.PI * 2)) * 10 + 2 : 3;
      return;
    }
    // free ball: bounce + roll
    if (b.z > 0 || b.vz > 0) {
      b.vz -= 520 * dt; b.z += b.vz * dt;
      if (b.z <= 0) { b.z = 0; b.vz = -b.vz * 0.45; if (Math.abs(b.vz) < 25) b.vz = 0; }
    }
    b.x += b.vx * dt; b.y += b.vy * dt;
    const fr = Math.exp(-2.6 * dt); b.vx *= fr; b.vy *= fr;
    if (DH.world.solidAtPx(b.x, b.y)) { b.vx *= -0.35; b.vy *= -0.35; b.x -= b.vx * dt * 4; b.y -= b.vy * dt * 4; }
    b.x = clamp(b.x, 8, DH.world.W * T - 8); b.y = clamp(b.y, 8, DH.world.H * T - 8);
    // auto-pickup on contact while a game is live
    if (S.mode !== "off") {
      for (const p of gs.players) {
        const i = p.pid;
        if (S.join[i] && dist2(p.x, p.y, b.x, b.y) < 16 * 16) { b.holder = i; b.freeT = 0; return; }
      }
      // idle ball returns to the players so nobody chases forever
      b.freeT += dt;
      if (b.freeT > 5) {
        const p0 = gs.players[S.join[0] ? 0 : 1];
        b.x += (p0.x - b.x) * dt * 2; b.y += (p0.y - 6 - b.y) * dt * 2;
        if (dist2(b.x, b.y, p0.x, p0.y) < 20 * 20) { b.holder = p0.pid; b.freeT = 0; }
      }
    }
  }

  // ---------- ice physics (post-move nudge) ----------
  function skatePhysics(p, i, k, dt) {
    const wasIce = loc.onIce[i], isIce = onRink(p.x, p.y);
    if (S.fall[i] > 0) { // pinned while slipping
      p.x = loc.pin[i].x; p.y = loc.pin[i].y;
      loc.px[i] = p.x; loc.py[i] = p.y;
      return;
    }
    if (!isIce) {
      if (wasIce) { p.vx = 0; p.vy = 0; loc.onIce[i] = false; }
      loc.px[i] = p.x; loc.py[i] = p.y;
      return;
    }
    // undo this frame's direct move, then integrate momentum ourselves.
    // A jump > a frame's walk distance means a teleport/spawn — rebase, don't slide.
    const gx = p.x - loc.px[i], gy = p.y - loc.py[i];
    if (Math.abs(gx) > 24 || Math.abs(gy) > 24) {
      loc.px[i] = p.x; loc.py[i] = p.y; p.vx = 0; p.vy = 0; loc.onIce[i] = true;
      return;
    }
    if (!wasIce) { // stepped on: seed momentum from whatever movement happened
      p.vx = gx / Math.max(dt, 1 / 240); p.vy = gy / Math.max(dt, 1 / 240);
      const vmax0 = S.skating[i] ? SKATE_MAX : ICE_MAX;
      const sp = Math.hypot(p.vx, p.vy);
      if (sp > vmax0) { p.vx *= vmax0 / sp; p.vy *= vmax0 / sp; }
      loc.onIce[i] = true;
    }
    p.x = loc.px[i]; p.y = loc.py[i];   // undo game.js's direct move
    let dx = (k.r ? 1 : 0) - (k.l ? 1 : 0), dy = (k.d ? 1 : 0) - (k.u ? 1 : 0);
    if (dx && dy) { dx *= 0.707; dy *= 0.707; }
    p.vx += dx * ICE_ACC * dt; p.vy += dy * ICE_ACC * dt;
    const fr = Math.exp(-ICE_DECAY * dt); p.vx *= fr; p.vy *= fr;
    const vmax = S.skating[i] ? SKATE_MAX : ICE_MAX;
    const sp = Math.hypot(p.vx, p.vy);
    if (sp > vmax) { p.vx *= vmax / sp; p.vy *= vmax / sp; }
    const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt;
    if (DH.world.canStand(nx, p.y)) p.x = nx; else p.vx *= -0.35;
    if (DH.world.canStand(p.x, ny)) p.y = ny; else p.vy *= -0.35;
    // sprite faces the glide
    if (sp > 12) {
      p.dir = Math.abs(p.vx) > Math.abs(p.vy) ? (p.vx > 0 ? "right" : "left") : (p.vy > 0 ? "down" : "up");
      p.step += dt * sp / 24; p.moving = true;
    } else p.moving = false;
    // carve marks + speed trails + joy
    if (sp > 60) {
      loc.markAcc[i] += dt;
      if (loc.markAcc[i] > 0.07) {
        loc.markAcc[i] = 0;
        S.marks.push({ x1: loc.px[i], y1: loc.py[i], x2: p.x, y2: p.y, life: 14 });
        if (S.marks.length > 140) S.marks.shift();
        if (sp > 110) fx("trail", p.x - p.vx * 0.06, p.y - 2 - p.vy * 0.06, { life: 0.4 });
      }
      if (S.skating[i]) {
        loc.happyAcc[i] += dt;
        if (loc.happyAcc[i] > 4) {
          loc.happyAcc[i] = 0;
          gs.happiness += 1;
          fx("star", p.x, p.y - 30, { life: 0.8, vy: -12 });
        }
      }
    }
    loc.px[i] = p.x; loc.py[i] = p.y;
  }

  // ---------- module contract ----------
  const M = (DH.court = {
    init(state) { gs = state; DH.world.blocked.add(POLE_TILE); },

    start(state) {
      gs = state;
      endMode(); S.solo = { shots: 0, made: 0, streak: 0 };
      S.skating = [false, false]; S.spin = [0, 0]; S.fall = [0, 0];
      S.marks = []; S.fx = []; S.noSteal = 0; S.netT = 0; S.msg = ""; S.msgT = 0;
      loc.prevA = [0, 0]; loc.onIce = [false, false]; loc.inited = [false, false];
      loc.cd = [0, 0]; loc.happyAcc = [0, 0]; loc.markAcc = [0, 0]; loc.season = null;
      DH.world.blocked.add(POLE_TILE);
      resetBall();
    },

    update(dt, state) {
      gs = state;
      const winter = state.season === "winter";
      if (loc.season !== state.season) { // season flip
        if (loc.season && winter && S.mode !== "off") {
          endMode(); DH.toast("The court froze over — grab skates! ⛸️");
        }
        if (!winter) { S.skating = [false, false]; S.spin = [0, 0]; S.fall = [0, 0]; }
        loc.season = state.season;
      }

      // timers
      S.msgT = Math.max(0, S.msgT - dt);
      S.noSteal = Math.max(0, S.noSteal - dt);
      S.netT = Math.max(0, S.netT - dt);
      for (const m of S.marks) m.life -= dt;
      S.marks = S.marks.filter(m => m.life > 0);
      for (const f of S.fx) { f.life -= dt; if (f.vy) f.y += f.vy * dt; }
      S.fx = S.fx.filter(f => f.life > 0);

      // wait window -> solo
      if (S.mode === "wait") {
        S.waitT -= dt;
        if (S.waitT <= 0) {
          const pid = S.join[0] ? 0 : 1;
          S.mode = "solo";
          say(`${state.players[pid].name}'s shootout — sink some hoops!`);
          DH.toast("Solo shootout — hold ⚡ to shoot 🏀");
        }
      }
      if (S.mode === "win") { S.winT -= dt; if (S.winT <= 0) endMode(); }

      // per-player input + physics (game.js never calls update() for guests,
      // so this always runs on the side that simulates)
      for (const p of state.players) {
        const i = p.pid;
        loc.cd[i] = Math.max(0, loc.cd[i] - dt);
        S.stealCd[i] = Math.max(0, S.stealCd[i] - dt);
        S.spin[i] = Math.max(0, S.spin[i] - dt * 1.15);
        S.fall[i] = Math.max(0, S.fall[i] - dt);
        if (!loc.inited[i]) { loc.inited[i] = true; loc.px[i] = p.x; loc.py[i] = p.y; }
        const k = DH.inp[i] || { a: 0 };
        if (k.a && !loc.prevA[i]) onPress(i);
        if (!k.a && loc.prevA[i]) onRelease(i);
        loc.prevA[i] = k.a || 0;
        if (S.charging[i]) S.charge[i] = Math.min(1, S.charge[i] + dt / 0.8);
        if (winter) skatePhysics(p, i, k, dt);
        else { loc.px[i] = p.x; loc.py[i] = p.y; loc.onIce[i] = false; p.vx = 0; p.vy = 0; }
        if (S.skating[i] && !onRink(p.x, p.y) && !onCourt(p.x, p.y)) S.skating[i] = false;
      }

      if (!winter) stepBall(dt);

      // versus steals: defender touching the carrier takes the ball
      if (S.mode === "versus" && S.ball.holder !== -1 && S.noSteal <= 0) {
        const h = S.ball.holder, d = 1 - h;
        const ph = state.players[h], pd = state.players[d];
        if (ph && pd && S.stealCd[d] <= 0 && S.fall[h] <= 0 &&
            dist2(ph.x, ph.y, pd.x, pd.y) < 16 * 16) {
          S.ball.holder = d; S.stealCd[d] = 1.1; S.noSteal = 0.4;
          S.charging[h] = false; S.charge[h] = 0;
          fx("pop", pd.x, pd.y - 30, { life: 0.7, txt: "STEAL!", vy: -18 });
          DH.toast(`${pd.name} steals! 🏀`);
        }
      }
    },

    interactables(p) {
      if (!p || p.pid == null || !gs) return [];
      const out = [];
      const nearSpot = dist2(p.x, p.y, SPOT.x, SPOT.y) < SPOT_R * SPOT_R;
      if (gs.season === "winter") {
        if (nearSpot) {
          out.push({
            label: S.skating[p.pid] ? "Stop skating ⛸️" : "Skate ⛸️",
            x: SPOT.x, y: SPOT.y, action: () => toggleSkate(p.pid),
          });
          out.push({
            label: "Play 🏀 (court frozen — skate instead?)",
            x: SPOT.x, y: SPOT.y, action: () => DH.toast("Too icy for hoops — skate instead! ⛸️"),
          });
        }
        return out;
      }
      if (S.mode === "off") {
        if (nearSpot) out.push({ label: "Play 🏀", x: SPOT.x, y: SPOT.y, action: () => pressPlay(p.pid) });
        return out;
      }
      // a game is live
      if (!S.join[p.pid]) {
        if (S.mode === "wait" && nearSpot)
          out.push({ label: "Join 1v1! 🏀", x: SPOT.x, y: SPOT.y, action: () => pressPlay(p.pid) });
        return out;
      }
      if (S.ball.holder === p.pid) return out;          // action key = shoot while holding
      if (S.ball.holder === -1 && !S.ball.fly &&
          dist2(p.x, p.y, S.ball.x, S.ball.y) < 30 * 30)
        out.push({ label: "Pick up 🏀", x: S.ball.x, y: S.ball.y, action: () => pickUp(p.pid) });
      if (nearSpot)
        out.push({
          label: S.mode === "wait" ? "Cancel 🏀" : "Quit 🏀",
          x: SPOT.x, y: SPOT.y, action: () => quitGame(p.pid),
        });
      return out;
    },

    collectDraws(draws, camX, camY) {
      if (!C) C = document.getElementById("cv").getContext("2d");
      const winter = gs && gs.season === "winter";
      draws.push({ y: CT.y + 10, fn: () => drawHoop(C, CX - camX, CT.y - camY, winter) });
      const b = S.ball;
      if (!winter) draws.push({ y: b.y, fn: () => drawBall(C, b.x - camX, b.y - camY, b.z) });
    },

    drawGround(ctx, camX, camY, state) {
      const winter = state && state.season === "winter";
      const x = CT.x - camX, y = CT.y - camY;
      if (winter) drawRink(ctx, x, y);
      else drawCourt(ctx, x, y);
    },

    drawOverlay(ctx, camX, camY, state) {
      const winter = state.season === "winter";
      // action hints (game.js's hint pass doesn't reach this module)
      for (const p of state.players) {
        const acts = M.interactables(p);
        if (acts.length) {
          ctx.fillStyle = "#ffffffdd"; ctx.font = "bold 11px sans-serif";
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText("⚡ " + acts[0].label, p.x - camX, p.y - camY - 42);
        }
        // charge bar
        if (S.charging[p.pid]) {
          const bx = p.x - camX - 15, by = p.y - camY - 50;
          const d = Math.hypot(p.x - RIM.x, p.y - RIM.y);
          const sweet = d < 55 ? 0.1 : clamp(0.28 + (d / 240) * 0.62, 0, 0.95);
          ctx.fillStyle = "#00000088"; ctx.fillRect(bx - 1, by - 1, 32, 7);
          ctx.fillStyle = "#3fae5a"; ctx.fillRect(bx + sweet * 30 - 3, by, 7, 5);
          ctx.fillStyle = "#ffd76b"; ctx.fillRect(bx, by, S.charge[p.pid] * 30, 5);
        }
        // skate spin swirl + fall marker
        if (S.spin[p.pid] > 0.4 && S.fall[p.pid] <= 0) {
          const a = Date.now() / 90;
          ctx.strokeStyle = "#dff2ffcc"; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(p.x - camX, p.y - camY - 14, 12 + Math.sin(a) * 3, a, a + 4.2); ctx.stroke();
        }
        if (S.fall[p.pid] > 0) {
          DH.sprites.sad(ctx, p.x - camX, p.y - camY - 40);
          ctx.fillStyle = "#ffe58a";
          const a = Date.now() / 130;
          for (let s = 0; s < 3; s++) {
            const sx = p.x - camX + Math.cos(a + s * 2.1) * 14;
            const sy = p.y - camY - 34 + Math.sin(a + s * 2.1) * 4;
            ctx.fillRect(sx, sy, 2, 2);
          }
        }
      }
      // fx
      for (const f of S.fx) {
        const a = Math.max(0, f.life / f.max);
        const fx0 = f.x - camX, fy = f.y - camY;
        ctx.globalAlpha = a;
        if (f.k === "star") { ctx.font = "11px sans-serif"; ctx.textAlign = "center"; ctx.fillText("✨", fx0, fy); }
        else if (f.k === "sad") DH.sprites.sad(ctx, fx0, fy);
        else if (f.k === "swirl") { ctx.strokeStyle = "#dff2ff"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(fx0, fy, 8 * (1 - a) + 4, 0, Math.PI * 1.6); ctx.stroke(); }
        else if (f.k === "trail") { ctx.fillStyle = "#eaf7ff"; ctx.fillRect(fx0 - 3, fy - 1, 6, 2); }
        else if (f.k === "pop") {
          ctx.font = "bold 12px sans-serif"; ctx.textAlign = "center";
          ctx.fillStyle = "#00000088"; ctx.fillText(f.txt, fx0 + 1, fy + 1);
          ctx.fillStyle = "#ffe58a"; ctx.fillText(f.txt, fx0, fy);
        }
        ctx.globalAlpha = 1;
      }
      // scoreboard / banners
      const cw = ctx.canvas.width;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      const panel = (w, h, draw) => {
        ctx.fillStyle = "#141826cc";
        ctx.beginPath(); ctx.roundRect(cw / 2 - w / 2, 8, w, h, 8); ctx.fill();
        draw();
      };
      if (S.mode === "wait") {
        panel(320, 30, () => {
          ctx.fillStyle = "#ffe9b0"; ctx.font = "bold 12px sans-serif";
          ctx.fillText(`🏀 ${state.players[1 - (S.join[0] ? 0 : 1)].name}: press ⚡ here to join! solo in ${Math.ceil(S.waitT)}s`, cw / 2, 23);
        });
      } else if (S.mode === "versus") {
        panel(240, 30, () => {
          ctx.fillStyle = "#fff"; ctx.font = "bold 13px sans-serif";
          ctx.fillText(`🏀 ${state.players[0].name} ${S.score[0]} — ${S.score[1]} ${state.players[1].name} · first to ${WIN_SCORE}`, cw / 2, 23);
        });
      } else if (S.mode === "solo") {
        panel(240, 30, () => {
          ctx.fillStyle = "#fff"; ctx.font = "bold 13px sans-serif";
          ctx.fillText(`🏀 ${S.solo.made} / ${S.solo.shots} made` + (S.solo.streak > 1 ? ` · ${S.solo.streak}🔥` : ""), cw / 2, 23);
        });
      } else if (S.mode === "win") {
        panel(280, 36, () => {
          ctx.fillStyle = "#ffe58a"; ctx.font = "bold 15px sans-serif";
          ctx.fillText(`🏆 ${state.players[S.winPid].name} wins ${Math.max(...S.score)}–${Math.min(...S.score)}!`, cw / 2, 26);
        });
      }
      if (S.msgT > 0 && S.mode !== "wait") {
        ctx.fillStyle = "#ffffffee"; ctx.font = "bold 12px sans-serif";
        ctx.fillText(S.msg, cw / 2, 58);
      }
      if (winter) {
        ctx.fillStyle = "#eaf7ffcc"; ctx.font = "bold 11px sans-serif";
        ctx.fillText("❄️ the court is an ice rink — watch your step!", cw / 2, ctx.canvas.height - 12);
      }
    },

    // ---------- net-sync boundary ----------
    serialize() {
      return JSON.parse(JSON.stringify({
        mode: S.mode, join: S.join, waitT: S.waitT, score: S.score, solo: S.solo,
        ball: S.ball, skating: S.skating, spin: S.spin, marks: S.marks, msg: S.msg, msgT: S.msgT,
      }));
    },
    deserialize(data) {
      if (!data) return;
      Object.assign(S, {
        mode: data.mode || "off", join: data.join || [false, false],
        waitT: data.waitT || 0, score: data.score || [0, 0],
        solo: data.solo || { shots: 0, made: 0, streak: 0 },
        ball: data.ball || S.ball, skating: data.skating || [false, false],
        spin: data.spin || [0, 0], marks: data.marks || [],
        msg: data.msg || "", msgT: data.msgT || 0,
      });
    },
    remoteAction(name, args) {
      return typeof API[name] === "function" ? API[name].apply(null, args || []) : false;
    },
    pressPlay, quitGame, pickUp, toggleSkate, spinSkate,
    _S: S, // exposed for tests/debug
  });

  // ---------- drawing ----------
  function drawCourt(ctx, x, y) {
    // asphalt pad
    ctx.fillStyle = "#4e565f"; ctx.fillRect(x - 6, y - 6, CT.w + 12, CT.h + 12);
    ctx.fillStyle = "#59616c"; ctx.fillRect(x, y, CT.w, CT.h);
    // speckle wear
    for (let i = 0; i < 26; i++) {
      const hx = Math.floor(h2(i, 7) * CT.w), hy = Math.floor(h2(i, 13) * CT.h);
      ctx.fillStyle = h2(i, 21) > 0.5 ? "#525b65" : "#606a75";
      ctx.fillRect(x + hx, y + hy, 5, 3);
    }
    // painted key (top) + free-throw line
    ctx.fillStyle = "#3a6bd133"; ctx.fillRect(x + CX - CT.x - 26, y, 52, 62);
    ctx.strokeStyle = "#f2ede0"; ctx.lineWidth = 2;
    ctx.strokeRect(x + CX - CT.x - 26, y - 2, 52, 62);
    // boundary
    ctx.strokeRect(x + 4, y + 4, CT.w - 8, CT.h - 8);
    // 3pt arc around the rim
    ctx.save();
    ctx.beginPath(); ctx.rect(x + 4, y + 4, CT.w - 8, CT.h - 8); ctx.clip();
    ctx.beginPath(); ctx.arc(x + CT.w / 2, y + 6, ARC_R, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
    // center circle (bottom half-court marking)
    ctx.beginPath(); ctx.arc(x + CT.w / 2, y + CT.h - 34, 22, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    // corner accents
    ctx.fillStyle = "#f2ede0";
    ctx.fillRect(x + 4, y + CT.h - 34, 18, 2); ctx.fillRect(x + CT.w - 22, y + CT.h - 34, 18, 2);
  }

  function drawRink(ctx, x, y) {
    // snow rim around the ice
    ctx.fillStyle = "#f4f8fb"; ctx.fillRect(x - 8, y - 8, CT.w + 16, CT.h + 16);
    ctx.fillStyle = "#d9e9f2"; ctx.fillRect(x - 8, y - 8, CT.w + 16, 4);
    // ice base
    ctx.fillStyle = "#a9d4ea"; ctx.fillRect(x, y, CT.w, CT.h);
    ctx.fillStyle = "#bce0f2"; ctx.fillRect(x, y, CT.w, CT.h / 2);
    // sparkle speckles
    for (let i = 0; i < 22; i++) {
      const hx = Math.floor(h2(i, 31) * CT.w), hy = Math.floor(h2(i, 47) * CT.h);
      ctx.fillStyle = h2(i, 59) > 0.5 ? "#d4ecfa" : "#9cc8e0";
      ctx.fillRect(x + hx, y + hy, 3, 2);
    }
    // hockey markings: red center + blue lines, center circle
    ctx.fillStyle = "#d2545444"; ctx.fillRect(x + 4, y + CT.h / 2 - 2, CT.w - 8, 4);
    ctx.fillStyle = "#3a6bd144"; ctx.fillRect(x + 4, y + CT.h / 3 - 2, CT.w - 8, 4);
    ctx.fillRect(x + 4, y + (CT.h * 2) / 3 - 2, CT.w - 8, 4);
    ctx.strokeStyle = "#d2545466"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x + CT.w / 2, y + CT.h / 2, 20, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = "#d25454"; ctx.fillRect(x + CT.w / 2 - 2, y + CT.h / 2 - 2, 4, 4);
    ctx.strokeStyle = "#eef6fb"; ctx.strokeRect(x + 3, y + 3, CT.w - 6, CT.h - 6);
    // carved skate marks
    ctx.strokeStyle = "#ffffff55"; ctx.lineWidth = 1;
    ctx.beginPath();
    for (const m of S.marks) {
      ctx.globalAlpha = Math.min(0.6, m.life / 14);
      ctx.moveTo(m.x1 - (CT.x - x), m.y1 - (CT.y - y));
      ctx.lineTo(m.x2 - (CT.x - x), m.y2 - (CT.y - y));
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawHoop(ctx, rx, ty, winter) {
    // rx = rim center x (screen), ty = court top y (screen)
    const poleX = rx - 3;
    // pole
    ctx.fillStyle = "#5a626c"; ctx.fillRect(poleX, ty - 34, 6, 42);
    ctx.fillStyle = "#495059"; ctx.fillRect(poleX + 4, ty - 34, 2, 42);
    ctx.fillStyle = "#3f464e"; ctx.fillRect(poleX - 3, ty + 4, 12, 4); // base plate
    // backboard
    ctx.fillStyle = winter ? "#eaf4fa" : "#f2ede0";
    ctx.fillRect(rx - 18, ty - 32, 36, 16);
    ctx.fillStyle = "#9fc4d8"; ctx.fillRect(rx - 16, ty - 30, 32, 12);
    ctx.strokeStyle = "#d4573e"; ctx.lineWidth = 1.5;
    ctx.strokeRect(rx - 7, ty - 26, 14, 8);
    ctx.strokeStyle = "#f2ede0"; ctx.strokeRect(rx - 18, ty - 32, 36, 16);
    // frost on the board in winter
    if (winter) {
      ctx.fillStyle = "#ffffffaa";
      ctx.fillRect(rx - 18, ty - 34, 36, 4);
      ctx.fillRect(rx - 14, ty - 17, 3, 4); ctx.fillRect(rx + 4, ty - 17, 3, 5); ctx.fillRect(rx + 12, ty - 17, 2, 3);
    }
    // rim
    ctx.strokeStyle = "#e06428"; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.ellipse(rx, ty + 8, 10, 4, 0, 0, Math.PI * 2); ctx.stroke();
    // net (front) — ripple when a basket drops through
    const wig = S.netT > 0 ? Math.sin(Date.now() / 60) * 2.5 * (S.netT / 0.55) : 0;
    ctx.strokeStyle = winter ? "#e8f2f8" : "#f6f2e6"; ctx.lineWidth = 1;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(rx + i * 4.2, ty + 9);
      ctx.quadraticCurveTo(rx + i * 3 + wig, ty + 16, rx + i * 1.6 - wig, ty + 21);
      ctx.stroke();
    }
    for (let r = 0; r < 2; r++) {
      ctx.beginPath();
      ctx.ellipse(rx + (r ? -wig * 0.5 : wig * 0.5), ty + 12 + r * 5, 8 - r * 3, 2.2, 0, 0, Math.PI);
      ctx.stroke();
    }
  }

  function drawBall(ctx, x, y, z) {
    DH.sprites.shadow(ctx, x, y, 12 - Math.min(8, z * 0.12));
    const by = y - 4 - z;
    ctx.fillStyle = "#e8842c";
    ctx.beginPath(); ctx.arc(x, by, 6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#9c4f14"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(x, by, 6, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 6, by); ctx.lineTo(x + 6, by); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, by - 4, 6, 0.25 * Math.PI, 0.75 * Math.PI); ctx.stroke();
    ctx.fillStyle = "#f5b06a"; ctx.fillRect(x - 3, by - 4, 3, 2);
  }
})();
