/* NEON CITY — combat: weapons, bullets, explosions, damage fx, weapon pickups. */
(function () {
  const NC = window.NC;
  const U = NC.util;

  const WEAPONS = {
    fist: { melee: true, dmg: 30, cd: 0.45 },
    pistol: { dmg: 34, spd: 520, cd: 0.22, ammoPickup: 60, pellets: 1, spread: 0 },
    smg: { dmg: 22, spd: 560, cd: 0.09, ammoPickup: 120, pellets: 1, spread: 0 },
    shotgun: { dmg: 16, spd: 460, cd: 0.7, ammoPickup: 24, pellets: 6, spread: 0.28 },
    rifle: { dmg: 46, spd: 720, cd: 0.17, ammoPickup: 90, pellets: 1, spread: 0.015, ttl: 1.3 },
    rpg: { dmg: 30, spd: 380, cd: 1.1, ammoPickup: 6, pellets: 1, spread: 0, boom: 46, ttl: 1.6 },
  };
  const WCOLS = { pistol: "#22d3ee", smg: "#facc15", shotgun: "#ff2d95", rifle: "#a3e635", rpg: "#f97316" };
  const PICKUP_N = 12, PICKUP_RESPAWN = 75, PICKUP_R = 14;

  const bullets = [], pickups = [];
  const fx = [], dmgNums = [], explosions = []; // cosmetic-only (safe on guests)

  const angDiff = (a, b) => {
    let d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  };

  // ---------- fx ----------
  function blood(x, y) {
    for (let i = 0; i < 5; i++)
      fx.push({ kind: "blood", x, y, vx: U.rand(-70, 70), vy: U.rand(-90, 10), t: 0, dur: U.rand(0.3, 0.5), c: "#dc2626" });
  }
  function sparkAt(x, y) {
    for (let i = 0; i < 4; i++)
      fx.push({ kind: "spark", x, y, vx: U.rand(-90, 90), vy: U.rand(-90, 90), t: 0, dur: U.rand(0.12, 0.25), c: "#ffe9a0" });
  }
  function dmgNum(x, y, v) {
    if (dmgNums.length > 40) dmgNums.shift();
    dmgNums.push({ x, y: y - 16, txt: "" + Math.round(v), t: 0 });
  }
  function tickFx(dt) {
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i];
      f.t += dt;
      if (f.vx !== undefined) {
        f.x += f.vx * dt; f.y += f.vy * dt;
        if (f.kind === "blood") f.vy += 300 * dt;
      }
      if (f.t > f.dur) fx.splice(i, 1);
    }
    for (let i = explosions.length - 1; i >= 0; i--) {
      explosions[i].t += dt;
      if (explosions[i].t > explosions[i].dur) explosions.splice(i, 1);
    }
    for (let i = dmgNums.length - 1; i >= 0; i--) {
      const d = dmgNums[i];
      d.t += dt; d.y -= 26 * dt;
      if (d.t > 0.8) dmgNums.splice(i, 1);
    }
  }

  // ---------- damage ----------
  function applyPlayerDamage(p, dmg) {
    if (!p || p.dead) return;
    p.hp -= dmg;
    p.flash = 0.4;
    NC.shake(3);
    if (p.hp <= 0) {
      p.hp = 0;
      p.dead = true;
      if (NC.hud && NC.hud.wasted) NC.hud.wasted(p); // hud schedules spawnPlayer + penalty
      else if (NC.player && NC.player.spawnPlayer) setTimeout(() => NC.player.spawnPlayer(p), 1500);
    }
  }

  function hitTest(b) {
    const s = NC.state;
    if (NC.people && NC.people.damage) {
      for (const arr of [NC.people.peds, NC.people.cops]) {
        if (!arr) continue;
        for (const e of arr) {
          if (!e || e.dead || e === b.owner) continue;
          if (U.dist(b.x, b.y, e.x, e.y) < 8) {
            NC.people.damage(e, b.dmg, b.owner);
            blood(e.x, e.y); dmgNum(e.x, e.y, b.dmg);
            return true;
          }
        }
      }
    }
    if (s) for (const p of s.players) {
      if (p === b.owner || p.dead || p.inCar) continue;
      if (U.dist(b.x, b.y, p.x, p.y) < 8) {
        applyPlayerDamage(p, b.dmg);
        blood(p.x, p.y); dmgNum(p.x, p.y, b.dmg);
        return true;
      }
    }
    if (NC.cars && NC.cars.list) {
      for (const c of NC.cars.list) {
        if (!c || c.dead) continue;
        if (b.owner && b.owner.inCar === c) continue;
        if (U.dist(b.x, b.y, c.x, c.y) < 12) {
          const d = b.dmg * 0.5;
          NC.cars.damage(c, d);
          sparkAt(b.x, b.y); dmgNum(c.x, c.y - 10, d);
          return true;
        }
      }
    }
    return false;
  }

  function fire(shooter, x, y, angle, weapon) {
    const def = WEAPONS[weapon];
    if (!shooter || !def || !def.spd) return;
    const n = def.pellets || 1;
    const sx = x + Math.cos(angle) * 15;
    const sy = y + Math.sin(angle) * 15;
    for (let i = 0; i < n; i++) {
      const a = angle + (n > 1 ? U.rand(-def.spread, def.spread) : 0);
      bullets.push({ x: sx, y: sy, vx: Math.cos(a) * def.spd, vy: Math.sin(a) * def.spd, dmg: def.dmg, owner: shooter, ttl: def.ttl || 0.9, boom: def.boom || 0 });
    }
    fx.push({ kind: "flash", x: sx, y: sy, t: 0, dur: 0.07 });
    if (NC.people) {
      if (NC.people.panicAt) NC.people.panicAt(x, y, 240);
      if (NC.state && NC.state.players.indexOf(shooter) >= 0 && NC.people.raiseWanted)
        NC.people.raiseWanted(shooter, 1);
    }
  }

  function melee(shooter) {
    if (!shooter || shooter.dead) return;
    const s = NC.state;
    const R = 32, ARC = Math.PI / 3; // 28px reach + target radius, ±60°
    let hitPedCop = false;
    fx.push({ kind: "slash", x: shooter.x, y: shooter.y, a: shooter.angle, t: 0, dur: 0.16 });
    const inArc = (ex, ey) =>
      U.dist(shooter.x, shooter.y, ex, ey) <= R &&
      Math.abs(angDiff(Math.atan2(ey - shooter.y, ex - shooter.x), shooter.angle)) <= ARC;
    if (NC.people && NC.people.damage) {
      for (const arr of [NC.people.peds, NC.people.cops]) {
        if (!arr) continue;
        for (const e of arr) {
          if (!e || e.dead || e === shooter) continue;
          if (inArc(e.x, e.y)) {
            NC.people.damage(e, WEAPONS.fist.dmg, shooter);
            blood(e.x, e.y); dmgNum(e.x, e.y, WEAPONS.fist.dmg);
            hitPedCop = true;
          }
        }
      }
    }
    if (s) for (const p of s.players) {
      if (p === shooter || p.dead || p.inCar) continue;
      if (inArc(p.x, p.y)) {
        applyPlayerDamage(p, WEAPONS.fist.dmg);
        blood(p.x, p.y); dmgNum(p.x, p.y, WEAPONS.fist.dmg);
      }
    }
    if (NC.cars && NC.cars.list) {
      for (const c of NC.cars.list) {
        if (!c || c.dead) continue;
        if (inArc(c.x, c.y)) { NC.cars.damage(c, 8); sparkAt(c.x, c.y); }
      }
    }
    if (hitPedCop && NC.people && NC.people.raiseWanted && s && s.players.indexOf(shooter) >= 0)
      NC.people.raiseWanted(shooter, 1);
  }

  function explode(x, y, r) {
    const s = NC.state;
    if (s) for (const p of s.players) {
      if (p.dead || p.inCar) continue;
      if (U.dist(x, y, p.x, p.y) <= r) { applyPlayerDamage(p, 60); dmgNum(p.x, p.y, 60); }
    }
    if (NC.people && NC.people.damage) {
      for (const arr of [NC.people.peds, NC.people.cops]) {
        if (!arr) continue;
        for (const e of arr) {
          if (!e || e.dead) continue;
          if (U.dist(x, y, e.x, e.y) <= r) { NC.people.damage(e, 999, null); blood(e.x, e.y); }
        }
      }
    }
    if (NC.cars && NC.cars.list) {
      for (const c of NC.cars.list) {
        if (!c || c.dead) continue;
        if (U.dist(x, y, c.x, c.y) <= r + 10) { NC.cars.damage(c, 50); sparkAt(c.x, c.y); }
      }
    }
    explosions.push({ x, y, r, t: 0, dur: 0.5 });
    for (let i = 0; i < 10; i++)
      fx.push({ kind: "spark", x, y, vx: U.rand(-160, 160), vy: U.rand(-160, 160), t: 0, dur: U.rand(0.3, 0.5), c: i % 2 ? "#f97316" : "#facc15" });
    NC.shake(10);
  }

  // ---------- lifecycle ----------
  function init() {
    bullets.length = 0; fx.length = 0; dmgNums.length = 0; explosions.length = 0;
    pickups.length = 0;
    const kinds = ["pistol", "smg", "shotgun", "rifle", "rifle", "rpg"];
    for (let i = 0; i < PICKUP_N; i++) {
      const pt = NC.world.randomSidewalk();
      pickups.push({ x: pt.x, y: pt.y, w: kinds[i % kinds.length], taken: false, respawn: 0 });
    }
  }
  function start() {}

  function update(dt, state) {
    tickFx(dt); // cosmetic — runs on guests too
    if (NC.net && NC.net.isGuest && NC.net.isGuest()) return;
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.x += b.vx * dt; b.y += b.vy * dt; b.ttl -= dt;
      if (b.ttl <= 0) { if (b.boom) explode(b.x, b.y, b.boom); bullets.splice(i, 1); continue; }
      if (NC.world.solidAt(b.x, b.y, 2)) { if (b.boom) explode(b.x, b.y, b.boom); else sparkAt(b.x, b.y); bullets.splice(i, 1); continue; }
      if (hitTest(b)) { if (b.boom) explode(b.x, b.y, b.boom); bullets.splice(i, 1); }
    }
    for (const pk of pickups) {
      if (pk.taken) {
        pk.respawn -= dt;
        if (pk.respawn <= 0) pk.taken = false;
        continue;
      }
      for (const p of state.players) {
        if (p.dead || p.busted || p.inCar) continue;
        if (U.dist(p.x, p.y, pk.x, pk.y) < PICKUP_R) {
          pk.taken = true; pk.respawn = PICKUP_RESPAWN;
          p.weapons[pk.w] = true;
          p.ammo[pk.w] = (p.ammo[pk.w] || 0) + WEAPONS[pk.w].ammoPickup;
          p.weapon = pk.w;
          NC.toast("PICKED UP " + pk.w.toUpperCase());
          break;
        }
      }
    }
  }

  // ---------- draw ----------
  function drawPickup(ctx, pk, t) {
    const y = pk.y + Math.sin(t * 4 + pk.x) * 2;
    const c = WCOLS[pk.w] || "#fff";
    ctx.globalAlpha = 0.25 + 0.12 * Math.sin(t * 5);
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.arc(pk.x, y, 11, 0, 7); ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = c; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(pk.x, y, 13 + Math.sin(t * 5) * 2, 0, 7); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#0a0c10";
    if (pk.w === "shotgun") {
      ctx.fillRect(pk.x - 8, y - 2, 16, 3); ctx.fillRect(pk.x - 8, y + 1, 6, 3);
    } else if (pk.w === "smg") {
      ctx.fillRect(pk.x - 7, y - 2, 13, 4); ctx.fillRect(pk.x - 1, y + 2, 3, 4); ctx.fillRect(pk.x - 7, y + 1, 4, 3);
    } else {
      ctx.fillRect(pk.x - 5, y - 2, 9, 4); ctx.fillRect(pk.x - 4, y + 2, 3, 3);
    }
  }

  function collectDraws(draws, camX, camY, state) {
    const z = state.cam.zoom || 1;
    const x0 = camX - 40, y0 = camY - 40, x1 = camX + NC.vw / z + 40, y1 = camY + NC.vh / z + 40;
    for (const b of bullets) {
      if (b.x < x0 || b.x > x1 || b.y < y0 || b.y > y1) continue;
      draws.push({
        y: b.y,
        fn: (ctx) => {
          ctx.strokeStyle = "rgba(255,233,160,0.55)";
          ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(b.x - b.vx * 0.025, b.y - b.vy * 0.025); ctx.lineTo(b.x, b.y); ctx.stroke();
          NC.sprites.drawBullet(ctx, b.x, b.y);
        },
      });
    }
    const t = performance.now() / 1000;
    for (const pk of pickups) {
      if (pk.taken || pk.x < x0 || pk.x > x1 || pk.y < y0 || pk.y > y1) continue;
      draws.push({ y: pk.y, fn: (ctx) => drawPickup(ctx, pk, t) });
    }
  }

  function drawOver(ctx, cam) {
    const z = cam.zoom || 1;
    const x0 = cam.x - 60, y0 = cam.y - 60, x1 = cam.x + NC.vw / z + 60, y1 = cam.y + NC.vh / z + 60;
    for (const e of explosions) {
      if (e.x < x0 || e.x > x1 || e.y < y0 || e.y > y1) continue;
      const k = e.t / e.dur;
      ctx.globalAlpha = 0.85 * (1 - k);
      ctx.fillStyle = "#f97316";
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r * (0.3 + k * 0.9), 0, 7); ctx.fill();
      ctx.fillStyle = "#facc15";
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r * (0.25 + k * 0.55), 0, 7); ctx.fill();
      ctx.globalAlpha = 1;
    }
    for (const f of fx) {
      if (f.x < x0 || f.x > x1 || f.y < y0 || f.y > y1) continue;
      if (f.kind === "slash") {
        const k = f.t / f.dur;
        ctx.globalAlpha = 0.7 * (1 - k);
        ctx.strokeStyle = "#e2e8f0"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(f.x, f.y, 10 + k * 18, f.a - 0.9, f.a + 0.9); ctx.stroke();
        ctx.globalAlpha = 1;
        continue;
      }
      ctx.globalAlpha = f.kind === "flash" ? 0.9 : 1 - f.t / f.dur;
      ctx.fillStyle = f.c || "#fff7cc";
      const sz = f.kind === "flash" ? 5 : 3;
      ctx.fillRect(f.x - sz / 2, f.y - sz / 2, sz, sz);
      ctx.globalAlpha = 1;
    }
    ctx.font = "bold 10px monospace"; ctx.textAlign = "center";
    for (const d of dmgNums) {
      if (d.x < x0 || d.x > x1 || d.y < y0 || d.y > y1) continue;
      ctx.globalAlpha = Math.max(0, 1 - d.t / 0.8);
      ctx.fillStyle = "#facc15";
      ctx.fillText(d.txt, d.x, d.y);
      ctx.globalAlpha = 1;
    }
  }

  // ---------- save / net ----------
  function ownerTag(o, s) {
    if (!o) return null;
    const i = s ? s.players.indexOf(o) : -1;
    return i >= 0 ? "p" + i : "n";
  }
  function resolveOwner(tag, s) {
    if (tag === "n" || !tag || !s) return null;
    return s.players[parseInt(tag.slice(1), 10)] || null;
  }
  function serialize() {
    const s = NC.state;
    return {
      b: bullets.map((b) => ({
        x: Math.round(b.x * 10) / 10, y: Math.round(b.y * 10) / 10,
        vx: Math.round(b.vx), vy: Math.round(b.vy), dmg: b.dmg,
        ttl: Math.round(b.ttl * 100) / 100, o: ownerTag(b.owner, s),
      })),
      p: pickups.map((pk) => ({ x: pk.x, y: pk.y, w: pk.w, t: pk.taken ? Math.round(pk.respawn * 10) / 10 : 0 })),
    };
  }
  function deserialize(sv) {
    if (!sv) return;
    const s = NC.state;
    bullets.length = 0;
    for (const b of sv.b || [])
      bullets.push({ x: b.x, y: b.y, vx: b.vx, vy: b.vy, dmg: b.dmg, ttl: b.ttl || 0.5, owner: resolveOwner(b.o, s) });
    if (sv.p) {
      pickups.length = 0;
      for (const pk of sv.p) pickups.push({ x: pk.x, y: pk.y, w: pk.w, taken: (pk.t || 0) > 0, respawn: pk.t || 0 });
    }
  }
  function remoteAction(name, args) {
    const s = NC.state;
    if (!s || !args) return;
    const p = s.players[args.pi];
    if (!p || p.dead || p.busted) return;
    if (name === "fire") {
      const w = args.weapon, def = WEAPONS[w];
      if (!def || !def.spd || !p.weapons[w] || (p.ammo[w] || 0) <= 0 || p.iatk > 0) return;
      fire(p, args.x, args.y, args.angle, w);
      p.ammo[w]--;
      p.iatk = def.cd;
      if (p.ammo[w] <= 0) p.weapon = "fist";
    } else if (name === "melee") {
      if (p.iatk > 0) return;
      melee(p);
      p.iatk = WEAPONS.fist.cd;
    }
  }

  NC.register("combat", {
    WEAPONS, bullets, pickups,
    fire, melee, explode, hitTest, applyPlayerDamage,
    init, start, update, collectDraws, drawOver,
    serialize, deserialize, remoteAction,
  });
})();
