/* NEON CITY — people: pedestrians, cops, and the WANTED system.
   Host-authoritative: guests skip update() but draw deserialized state.
   Cross-module surface:
     NC.people.peds / cops / loot / pcars
     panicAt(x,y,r)           — gunshots call this; peds in radius flee
     damage(ent,dmg,byPlayer) — works on peds, cops AND players
     kill(ent,byPlayer)       — death: corpse + money drop + panic ripple
     raiseWanted(p,n)         — crime → stars (callers: combat, cars)
     wantedTick(p,dt)         — decay when unseen
     busted(p)                — cop touched a wanted player
     bountyDrop(x,y[,amt])    — money pickup
     hurtPlayer(p,dmg,sx,sy)  — HP loss + knockback + WASTED fallback
   remoteAction "crime" {pi,stars} → raiseWanted(players[pi],stars) */
(function () {
  const NC = window.NC;
  const U = NC.util;

  const POP = 40;                       // live pedestrians
  const COP_CAP = [0, 2, 4, 6, 9, 12, 16];
  const PCAR_CAP = [0, 0, 0, 1, 2, 3, 4];
  const PED_HP = 24, COP_HP = 50;
  const PANIC_SPEED = 118, COP_SPEED = 190;
  const BUST_R = 22, MELEE_R = 26, SHOOT_R = 260, SEE_R = 320;
  const CORPSE_T = 14, LOOT_T = 45;

  const peds = [], cops = [], loot = [], pcars = [];
  const PED_CHARS = [];
  let S = null;
  let nextId = 1;
  let senseT = 0, spawnT = 0, copSpawnT = 0, recycleT = 0;

  // ped palette variants (sprites.js is loaded before this file)
  (function () {
    if (!NC.sprites || !NC.sprites.PAL) return;
    const base = NC.sprites.PAL.ped;
    const hair = ["#3b3f4a", "#57402e", "#1f2937", "#6b5563", "#27403a", "#4a3b2a"];
    const jacket = ["#2a2f3a", "#3a2f2a", "#27333f", "#38293f", "#213a33", "#403030"];
    const trim = ["#facc15", "#22d3ee", "#ff2d95", "#a855f7", "#34d399", "#f97316"];
    for (let i = 0; i < 6; i++) {
      const k = "ped" + i;
      NC.sprites.PAL[k] = Object.assign({}, base, {
        hair: hair[i], jacket: jacket[i], trim: trim[i], hi: trim[i], acc: trim[i],
      });
      PED_CHARS.push(k);
    }
  })();

  const players = () => (S && S.players) || [];
  const dirOf = (a) =>
    Math.abs(Math.cos(a)) > Math.abs(Math.sin(a))
      ? Math.cos(a) > 0 ? "right" : "left"
      : Math.sin(a) > 0 ? "down" : "up";

  // axis-separated wall slide; returns distance actually travelled
  function slideMove(e, vx, vy, dt, r) {
    const nx = e.x + vx * dt, ny = e.y + vy * dt;
    let moved = 0;
    if (!NC.world.solidAt(nx, e.y, r)) { moved += Math.abs(nx - e.x); e.x = nx; }
    if (!NC.world.solidAt(e.x, ny, r)) { moved += Math.abs(ny - e.y); e.y = ny; }
    return moved;
  }

  // ---------- pedestrians ----------
  function spawnPed(nearPlayers) {
    let pt = null;
    for (let i = 0; i < 9; i++) {
      const c = NC.world.randomSidewalk();
      if (NC.world.solidAt(c.x, c.y, 6)) continue;
      if (!nearPlayers) { pt = c; break; }
      let ok = false, far = true;
      for (const p of players()) {
        const d = U.dist(p.x, p.y, c.x, c.y);
        if (d < 950) far = false;
        if (d > 220 && d < 950) ok = true;
      }
      if (ok || (far && i === 8)) { pt = c; break; }
      pt = c;
    }
    if (!pt) return null;
    const ped = {
      id: nextId++, x: pt.x, y: pt.y, char: U.pick(PED_CHARS.length ? PED_CHARS : ["ped"]),
      dir: "down", angle: 0, step: 0, hp: PED_HP, dead: false, deadT: 0, flash: 0,
      mode: "wander", tx: pt.x, ty: pt.y, wt: U.rand(0, 2),
      spd: U.rand(42, 62), fleeT: 0, fx: 0, fy: 0, stuck: 0,
    };
    peds.push(ped);
    return ped;
  }

  function pickTarget(ped) {
    for (let i = 0; i < 8; i++) {
      const a = U.rand(0, Math.PI * 2), d = U.rand(50, 190);
      const x = ped.x + Math.cos(a) * d, y = ped.y + Math.sin(a) * d;
      if (!NC.world.solidAt(x, y, 6)) { ped.tx = x; ped.ty = y; return; }
    }
    const pt = NC.world.randomSidewalk();
    ped.tx = pt.x; ped.ty = pt.y;
  }

  function flee(ped, x, y) {
    ped.mode = "flee"; ped.fx = x; ped.fy = y; ped.fleeT = U.rand(3, 5.5);
  }

  function panicAt(x, y, r = 240) {
    for (const ped of peds) {
      if (ped.dead || ped.mode === "flee") continue;
      if (U.dist(ped.x, ped.y, x, y) < r) flee(ped, x, y);
    }
  }

  function updatePed(ped, dt) {
    if (ped.dead) { ped.deadT += dt; return ped.deadT > CORPSE_T; }
    ped.flash = Math.max(0, ped.flash - dt);
    if (ped.mode === "flee") {
      ped.fleeT -= dt;
      const a = U.angTo(ped.fx, ped.fy, ped.x, ped.y);
      slideMove(ped, Math.cos(a) * PANIC_SPEED, Math.sin(a) * PANIC_SPEED, dt, 5);
      ped.step = (ped.step + dt * 5) % 1;
      ped.dir = dirOf(a); ped.angle = a;
      if (ped.fleeT <= 0) { ped.mode = "wander"; ped.wt = U.rand(0.5, 2); pickTarget(ped); }
      return false;
    }
    if (ped.wt > 0) { ped.wt -= dt; return false; }
    const d = U.dist(ped.x, ped.y, ped.tx, ped.ty);
    if (d < 12) { ped.wt = U.rand(0.6, 3.2); pickTarget(ped); return false; }
    const a = U.angTo(ped.x, ped.y, ped.tx, ped.ty);
    const mv = slideMove(ped, Math.cos(a) * ped.spd, Math.sin(a) * ped.spd, dt, 5);
    ped.step = (ped.step + dt * 2.4) % 1;
    ped.dir = dirOf(a); ped.angle = a;
    if (mv < ped.spd * dt * 0.3) {
      ped.stuck += dt;
      if (ped.stuck > 0.6) { ped.stuck = 0; pickTarget(ped); }
    } else ped.stuck = 0;
    return false;
  }

  // throttled "senses": corpses and speeding cars scare peds
  function sense() {
    const deads = [];
    for (const e of peds) if (e.dead && e.deadT < 9) deads.push(e);
    for (const e of cops) if (e.dead && e.deadT < 9) deads.push(e);
    const carList = (NC.cars && NC.cars.list) || [];
    for (const ped of peds) {
      if (ped.dead || ped.mode === "flee") continue;
      for (const e of deads) {
        if (U.dist(ped.x, ped.y, e.x, e.y) < 70) { flee(ped, e.x, e.y); break; }
      }
      if (ped.mode === "flee") continue;
      for (const car of carList) {
        if (!car.dead && Math.abs(car.speed || 0) > 130 &&
            U.dist(ped.x, ped.y, car.x, car.y) < 60) { flee(ped, car.x, car.y); break; }
      }
      if (ped.mode === "flee") continue;
      for (const car of pcars) {
        if (!car.dead && car._inList) continue; // already scanned
        if (!car.dead && Math.abs(car.speed || 0) > 130 &&
            U.dist(ped.x, ped.y, car.x, car.y) < 60) { flee(ped, car.x, car.y); break; }
      }
    }
  }

  // ---------- money ----------
  function bountyDrop(x, y, amt) {
    loot.push({ x, y, amt: amt || U.randi(8, 40), age: 0 });
    if (loot.length > 60) loot.shift();
  }

  // ---------- damage / death ----------
  function hurtPlayer(p, dmg, sx, sy) {
    if (!p || p.dead || p.busted) return;
    p.hp -= dmg;
    p.flash = 0.35;
    NC.shake(3);
    if (sx !== undefined) {
      const a = U.angTo(sx, sy, p.x, p.y);
      const nx = p.x + Math.cos(a) * 22, ny = p.y + Math.sin(a) * 22;
      if (!NC.world.solidAt(nx, ny, 6)) { p.x = nx; p.y = ny; }
    }
    if (p.hp <= 0) {
      p.hp = 0; p.dead = true;
      if (NC.hud && NC.hud.wasted) NC.hud.wasted(p);
      else { NC.toast(p.char.toUpperCase() + " — WASTED"); NC.player.spawnPlayer(p); }
    }
  }

  function kill(ent, byPlayer) {
    if (!ent || ent.dead) return;
    ent.dead = true; ent.deadT = 0; ent.mode = "dead";
    bountyDrop(ent.x, ent.y);
    panicAt(ent.x, ent.y, 120); // fresh corpse scares the crowd
    if (ent.isCop && byPlayer) {
      raiseWanted(byPlayer, 1);
      NC.toast("Cop down — heat rising", 1400);
    }
  }

  function damage(ent, dmg, byPlayer) {
    if (!ent || ent.dead) return false;
    if (ent.maxHp !== undefined && ent.weapons) { // it's a player object
      hurtPlayer(ent, dmg);
      return ent.dead;
    }
    ent.hp -= dmg;
    ent.flash = 0.15;
    if (ent.hp <= 0) { kill(ent, byPlayer); return true; }
    if (!ent.isCop) {
      const px = byPlayer ? byPlayer.x : ent.x, py = byPlayer ? byPlayer.y : ent.y;
      flee(ent, px, py);
    }
    return false;
  }

  // ---------- wanted ----------
  function raiseWanted(p, n = 1) {
    if (!p || p.dead || p.busted) return;
    p.stars = Math.min(6, Math.max(0, (p.stars || 0) + n));
    p.wanted = p.stars;
    p.seenT = 0; p.drainT = 0;
  }

  function copNear(p, r) {
    for (const c of cops)
      if (!c.dead && U.dist(c.x, c.y, p.x, p.y) < r) return true;
    for (const c of pcars)
      if (!c.dead && U.dist(c.x, c.y, p.x, p.y) < r) return true;
    return false;
  }

  function wantedTick(p, dt) {
    if (!p || p.dead || p.stars <= 0) return;
    if (copNear(p, SEE_R)) { p.seenT = 0; p.drainT = 0; return; }
    p.seenT = (p.seenT || 0) + dt;
    if (p.seenT >= 6) {
      p.drainT = (p.drainT || 0) + dt;
      if (p.drainT >= 3) {
        p.drainT = 0;
        p.stars = Math.max(0, p.stars - 1);
        p.wanted = p.stars;
        if (p.stars === 0) NC.toast("Wanted level cleared", 1800);
      }
    }
  }

  function busted(p) {
    if (!p || p.busted || p.dead) return;
    p.busted = true;
    if (NC.hud && NC.hud.busted) NC.hud.busted(p);
    else { // hud.js may not be present yet — minimal fallback
      NC.toast("BUSTED — dragged to the station", 2200);
      NC.player.spawnPlayer(p);
    }
  }

  function wantedTarget() {
    let best = null, bs = -1;
    for (const p of players()) {
      if (p.dead || p.busted) continue;
      if ((p.stars || 0) > bs) { bs = p.stars; best = p; }
    }
    return bs > 0 ? best : null;
  }

  // ---------- cops ----------
  function edgeRoadPoint(x, y) {
    const cam = (S && S.cam) || { zoom: 1 };
    const R = (Math.max(NC.vw || 800, NC.vh || 400) / (cam.zoom || 1)) / 2;
    for (let i = 0; i < 10; i++) {
      const a = U.rand(0, Math.PI * 2), d = R + U.rand(60, 220);
      const pt = NC.world.nearestRoadTo(x + Math.cos(a) * d, y + Math.sin(a) * d);
      if (!NC.world.solidAt(pt.x, pt.y, 9)) return pt;
    }
    return null;
  }

  function spawnCop(t) {
    const pt = edgeRoadPoint(t.x, t.y);
    if (!pt) return;
    cops.push({
      id: nextId++, x: pt.x, y: pt.y, isCop: true, char: "cop",
      dir: "down", angle: 0, step: 0, hp: COP_HP, dead: false, deadT: 0, flash: 0,
      mode: "chase", armed: false, atkCD: 0, fireCD: U.rand(0.5, 1.2),
      tx: 0, ty: 0,
    });
  }

  function updateCop(c, dt) {
    if (c.dead) { c.deadT += dt; return c.deadT > CORPSE_T; }
    c.atkCD -= dt; c.fireCD -= dt; c.flash = Math.max(0, c.flash - dt);
    let t = null, bd = 1e9;
    for (const p of players()) {
      if (p.dead || p.busted || (p.stars || 0) <= 0) continue;
      const d = U.dist(c.x, c.y, p.x, p.y);
      if (d < bd) { bd = d; t = p; }
    }
    if (!t) {
      c.armed = false;
      if (!c.tx) { const pt = NC.world.randomRoad(); c.tx = pt.x; c.ty = pt.y; }
      const a = U.angTo(c.x, c.y, c.tx, c.ty);
      slideMove(c, Math.cos(a) * 70, Math.sin(a) * 70, dt, 6);
      c.step = (c.step + dt * 2.2) % 1; c.dir = dirOf(a); c.angle = a;
      if (U.dist(c.x, c.y, c.tx, c.ty) < 24) { c.tx = 0; }
      let far = true;
      for (const p of players())
        if (U.dist(c.x, c.y, p.x, p.y) < 850) { far = false; break; }
      return far; // despawn when off-duty and far away
    }
    const a = U.angTo(c.x, c.y, t.x, t.y);
    c.angle = a;
    if (!t.inCar && bd < BUST_R) { busted(t); return false; }
    if (bd > 16 || t.inCar) {
      slideMove(c, Math.cos(a) * COP_SPEED, Math.sin(a) * COP_SPEED, dt, 6);
      c.step = (c.step + dt * 4) % 1;
      c.dir = dirOf(a);
    }
    c.armed = t.stars >= 2;
    if (!t.inCar && bd < MELEE_R && c.atkCD <= 0) {
      c.atkCD = 0.8;
      hurtPlayer(t, 12, c.x, c.y);
    } else if (t.stars >= 2 && bd < SHOOT_R && bd > 30 && c.fireCD <= 0 &&
               NC.combat && NC.combat.fire) {
      c.fireCD = U.rand(0.9, 1.4);
      NC.combat.fire(c, c.x, c.y, a + U.rand(-0.12, 0.12), "pistol");
    }
    return false;
  }

  // ---------- police cars ----------
  function spawnPcar(t) {
    const pt = edgeRoadPoint(t.x, t.y);
    if (!pt) return;
    const car = {
      x: pt.x, y: pt.y, angle: U.rand(0, Math.PI * 2), speed: 0,
      type: "police", color: "#1e3a8a", siren: true,
      driver: "police", hp: 90, dead: false, engine: true,
      people: true, hitCD: 0, glow: "#60a5fa",
    };
    if (NC.cars && Array.isArray(NC.cars.list)) {
      car._inList = true;
      NC.cars.list.push(car);
    }
    pcars.push(car);
  }

  function removePcar(i) {
    const car = pcars[i];
    pcars.splice(i, 1);
    if (car._inList && !car.dead && NC.cars && NC.cars.list) {
      const j = NC.cars.list.indexOf(car);
      if (j >= 0) NC.cars.list.splice(j, 1);
    }
  }

  function updatePcar(car, dt) {
    if (car.dead) return true; // wreck belongs to cars.js / combat fx
    car.hitCD -= dt;
    let t = null, bd = 1e9;
    for (const p of players()) {
      if (p.dead || p.busted || (p.stars || 0) <= 0) continue;
      const d = U.dist(car.x, car.y, p.x, p.y);
      if (d < bd) { bd = d; t = p; }
    }
    let far = true;
    for (const p of players())
      if (U.dist(car.x, car.y, p.x, p.y) < 1000) { far = false; break; }
    if (!t) return far; // no wanted driver — leave the area
    const want = U.angTo(car.x, car.y, t.x, t.y);
    let diff = want - car.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    car.angle += U.clamp(diff, -2.4 * dt, 2.4 * dt);
    const wantSpd = Math.abs(diff) < 0.6 ? 235 : 110;
    car.speed = U.lerp(car.speed || 0, wantSpd, Math.min(1, dt * 2.5));
    const nx = car.x + Math.cos(car.angle) * car.speed * dt;
    const ny = car.y + Math.sin(car.angle) * car.speed * dt;
    if (!NC.world.solidAt(nx, car.y, 10)) car.x = nx; else car.speed *= 0.4;
    if (!NC.world.solidAt(car.x, ny, 10)) car.y = ny; else car.speed *= 0.4;
    if (car.hitCD <= 0 && Math.abs(car.speed) > 40) {
      for (const p of players()) {
        if (p.dead || p.busted) continue;
        if (U.dist(car.x, car.y, p.x, p.y) < 30) {
          car.hitCD = 1.2;
          car.speed *= 0.5;
          if (p.inCar && NC.cars && NC.cars.damage) NC.cars.damage(p.inCar, 25);
          else if (!p.inCar) { hurtPlayer(p, 20, car.x, car.y); p.slowT = 1.4; }
          break;
        }
      }
    }
    return false;
  }

  // ---------- module hooks ----------
  function init(state) {
    S = state;
    peds.length = cops.length = loot.length = pcars.length = 0;
  }

  function start(state) {
    S = state;
    if (peds.length === 0) for (let i = 0; i < 30; i++) spawnPed(true);
  }

  function update(dt, state) {
    if (NC.net && NC.net.isGuest && NC.net.isGuest()) return;
    S = state;

    // ped population + senses
    let alivePeds = 0;
    for (const e of peds) if (!e.dead) alivePeds++;
    spawnT -= dt;
    if (alivePeds < POP && spawnT <= 0) { spawnT = 0.35; spawnPed(true); }
    senseT -= dt;
    if (senseT <= 0) { senseT = 0.3; sense(); }
    recycleT -= dt;
    if (recycleT <= 0) {
      recycleT = 2.5;
      for (const ped of peds) {
        if (ped.dead || ped.mode === "flee") continue;
        let near = false;
        for (const p of players())
          if (U.dist(ped.x, ped.y, p.x, p.y) < 1300) { near = true; break; }
        if (!near) { // quietly repopulate near the action
          const pt = NC.world.randomSidewalk();
          if (!NC.world.solidAt(pt.x, pt.y, 6)) { ped.x = pt.x; ped.y = pt.y; pickTarget(ped); }
        }
      }
    }
    for (let i = peds.length - 1; i >= 0; i--)
      if (updatePed(peds[i], dt)) peds.splice(i, 1);

    // wanted decay + reinforcements
    for (const p of players()) wantedTick(p, dt);
    let maxStars = 0;
    for (const p of players()) if (!p.dead && !p.busted) maxStars = Math.max(maxStars, p.stars || 0);
    let copAlive = 0;
    for (const c of cops) if (!c.dead) copAlive++;
    copSpawnT -= dt;
    if (maxStars >= 1 && copAlive < COP_CAP[maxStars] && copSpawnT <= 0) {
      copSpawnT = 0.7;
      const t = wantedTarget();
      if (t) spawnCop(t);
    }
    for (let i = cops.length - 1; i >= 0; i--)
      if (updateCop(cops[i], dt)) cops.splice(i, 1);
    let pcAlive = 0;
    for (const c of pcars) if (!c.dead) pcAlive++;
    if (maxStars >= 3 && pcAlive < PCAR_CAP[maxStars]) {
      const t = wantedTarget();
      if (t) spawnPcar(t);
    }
    for (let i = pcars.length - 1; i >= 0; i--)
      if (updatePcar(pcars[i], dt)) removePcar(i);

    // money pickups: collect + expire
    for (let i = loot.length - 1; i >= 0; i--) {
      const k = loot[i];
      k.age += dt;
      if (k.age > LOOT_T) { loot.splice(i, 1); continue; }
      for (const p of players()) {
        if (p.dead || p.busted) continue;
        if (U.dist(p.x, p.y, k.x, k.y) < 14) {
          p.money = (p.money || 0) + k.amt;
          NC.toast("+$" + k.amt, 1200);
          loot.splice(i, 1);
          break;
        }
      }
    }
  }

  // ---------- draw ----------
  function drawEnt(ctx, e) {
    if (e.dead) { // flat corpse, rotated 90°
      ctx.save();
      ctx.translate(Math.round(e.x), Math.round(e.y));
      ctx.rotate(Math.PI / 2);
      if (e.deadT > 9) ctx.globalAlpha = Math.max(0.25, 1 - (e.deadT - 9) / (CORPSE_T - 9));
      NC.sprites.drawChar(ctx, 0, 0, e.isCop ? "cop" : e.char, "down", 0);
      ctx.restore();
      ctx.fillStyle = "rgba(140,10,30,0.5)";
      ctx.beginPath(); ctx.ellipse(e.x, e.y + 13, 11, 5, 0, 0, 7); ctx.fill();
      ctx.globalAlpha = 1;
      return;
    }
    NC.sprites.drawChar(ctx, e.x, e.y, e.isCop ? "cop" : e.char, e.dir, e.step, {
      weapon: e.isCop && e.armed ? "pistol" : "fist",
    });
    if (e.flash > 0) {
      ctx.globalAlpha = Math.min(1, e.flash * 4);
      ctx.fillStyle = "#fff";
      ctx.fillRect(e.x - 12, e.y - 18, 24, 36);
      ctx.globalAlpha = 1;
    }
    if (!e.isCop && e.mode === "flee" && e.fleeT > 1.2) {
      ctx.fillStyle = "#facc15";
      ctx.font = "bold 10px monospace";
      ctx.textAlign = "center";
      ctx.fillText("!", e.x, e.y - 24);
    }
  }

  function collectDraws(draws, camX, camY, state) {
    const zoom = (state.cam && state.cam.zoom) || 1;
    const x0 = camX - 60, x1 = camX + (NC.vw || 800) / zoom + 60;
    const y0 = camY - 60, y1 = camY + (NC.vh || 400) / zoom + 60;
    const on = (e) => e.x > x0 && e.x < x1 && e.y > y0 && e.y < y1;
    const t = performance.now() / 1000;
    for (const k of loot) {
      if (!on(k)) continue;
      draws.push({ y: k.y, fn: (ctx) => NC.sprites.drawMoney(ctx, k.x, k.y, t) });
    }
    for (const e of peds) {
      if (!on(e)) continue;
      draws.push({ y: e.y + 14, fn: (ctx) => drawEnt(ctx, e) });
    }
    for (const c of cops) {
      if (!on(c)) continue;
      draws.push({ y: c.y + 14, fn: (ctx) => drawEnt(ctx, c) });
    }
    for (const car of pcars) {
      if (car._inList || !on(car)) continue; // cars.js draws list members
      draws.push({
        y: car.y + 10,
        fn: (ctx) => NC.sprites.drawCar(ctx, car.x, car.y, car.angle, "police", car.color, { siren: true, dead: car.dead, glow: "#60a5fa" }),
      });
    }
  }

  // ---------- sync ----------
  const r1 = (v) => Math.round(v * 10) / 10;
  function mkPed(o) {
    return {
      id: o.i || nextId++, x: o.x || 0, y: o.y || 0, char: o.c || "ped",
      dir: o.d || "down", angle: 0, step: o.s || 0, hp: o.hp || PED_HP,
      dead: !!o.dead, deadT: o.dt || 0, flash: 0,
      mode: o.m || "wander", tx: o.x || 0, ty: o.y || 0, wt: 0,
      spd: 50, fleeT: 0, fx: 0, fy: 0, stuck: 0,
    };
  }
  function mkCop(o) {
    return {
      id: o.i || nextId++, x: o.x || 0, y: o.y || 0, isCop: true, char: "cop",
      dir: o.d || "down", angle: 0, step: o.s || 0, hp: o.hp || COP_HP,
      dead: !!o.dead, deadT: o.dt || 0, flash: 0,
      mode: "chase", armed: !!o.a, atkCD: 0, fireCD: 1, tx: 0, ty: 0,
    };
  }
  function serialize() {
    return {
      p: peds.map((e) => ({ i: e.id, x: r1(e.x), y: r1(e.y), c: e.char, d: e.dir, s: r1(e.step), hp: e.hp, dead: e.dead, dt: r1(e.deadT), m: e.mode })),
      c: cops.map((e) => ({ i: e.id, x: r1(e.x), y: r1(e.y), d: e.dir, s: r1(e.step), hp: e.hp, dead: e.dead, dt: r1(e.deadT), a: e.armed ? 1 : 0 })),
      l: loot.map((k) => ({ x: r1(k.x), y: r1(k.y), a: k.amt })),
      n: nextId,
    };
  }
  function deserialize(d) {
    if (!d || typeof d !== "object") return;
    if (Array.isArray(d.p)) { peds.length = 0; for (const o of d.p) peds.push(mkPed(o)); }
    if (Array.isArray(d.c)) { cops.length = 0; for (const o of d.c) cops.push(mkCop(o)); }
    if (Array.isArray(d.l)) { loot.length = 0; for (const o of d.l) loot.push({ x: o.x, y: o.y, amt: o.a, age: 0 }); }
    if (typeof d.n === "number") nextId = d.n;
  }

  const API = {
    crime(a) {
      const pi = Array.isArray(a) ? a[0] : a && a.pi;
      const n = Array.isArray(a) ? a[1] : a && a.stars;
      const p = players()[pi];
      if (p && typeof n === "number") raiseWanted(p, n);
    },
    panicAt(a) {
      const o = Array.isArray(a) ? { x: a[0], y: a[1], r: a[2] } : a || {};
      panicAt(o.x, o.y, o.r);
    },
  };
  function remoteAction(name, args) {
    const fn = API[name];
    if (typeof fn !== "function") return false;
    fn(args);
    return true;
  }

  NC.register("people", {
    peds, cops, loot, pickups: loot, pcars,
    panicAt, damage, kill, hurtPlayer,
    raiseWanted, wantedTick, busted, bountyDrop,
    init, start, update, collectDraws, serialize, deserialize, remoteAction,
  });
})();
