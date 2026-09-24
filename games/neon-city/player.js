/* NEON CITY — player: movement (on-foot + driving), damage, camera target. */
(function () {
  const NC = window.NC;
  const U = NC.util;

  const WALK = 140, RUN = 200;

  function mkPlayer(char, x, y) {
    return {
      char, x, y, dir: "down", angle: Math.PI / 2, step: 0,
      hp: 100, maxHp: 100, money: 0, wanted: 0, stars: 0,
      inCar: null, weapon: "fist", weapons: { fist: true },
      ammo: { pistol: 60, smg: 0, shotgun: 0 },
      dead: false, busted: false, sprint: 0, flash: 0, iatk: 0,
      missionCD: 0,
    };
  }

  function spawnPlayer(p) {
    // hospital respawn (wasted) or police station (busted) handled by caller —
    // this just revives at a safe road point.
    const w = NC.world;
    const pt = p.busted ? w.policeStation : w.hospital;
    const road = w.nearestRoadTo(pt.x, pt.y);
    p.x = road.x; p.y = road.y;
    p.hp = p.maxHp; p.dead = false; p.busted = false;
    p.inCar = null; p.wanted = 0; p.stars = 0;
    p.weapon = "fist"; p.weapons = { fist: true };
  }

  function tryMove(p, dx, dy, dt) {
    const r = 8;
    const nx = p.x + dx * dt, ny = p.y + dy * dt;
    if (!NC.world.solidAt(nx, p.y, r)) p.x = nx;
    if (!NC.world.solidAt(p.x, ny, r)) p.y = ny;
    // car bodies are also solid on foot (unless it's the car you're driving)
    const car = NC.cars && NC.cars.carAt(p.x, p.y, 12);
    if (car && car !== p.inCar) {
      const cx = car.x, cy = car.y;
      const away = Math.atan2(p.y - cy, p.x - cx);
      p.x += Math.cos(away) * 40 * dt;
      p.y += Math.sin(away) * 40 * dt;
    }
  }

  // guest-side prediction: move self, send edges via net (host applies real logic)
  function guestSelfMove(p, inp, dt) {
    const j = inp.joy || inp;
    if (p.inCar) {
      // predicted car visuals come from snapshot; still let local car speed feel right
      p.x = p.inCar.x; p.y = p.inCar.y;
      if (inp.aEdge) NC.net && NC.net.act && NC.net.act("car-exit", {});
    } else {
      const mag = Math.min(1, j.mag || Math.hypot(j.x || 0, j.y || 0));
      if (mag > 0.12) {
        const sp = mag > 0.85 ? RUN : WALK;
        const a = Math.atan2(j.y, j.x);
        tryMove(p, Math.cos(a) * sp * mag, Math.sin(a) * sp * mag, dt);
        p.angle = a;
        p.step = (p.step + dt * mag * 3) % 1;
      }
      if (inp.aEdge) NC.net && NC.net.act && NC.net.act("car-enter", {});
      if (inp.bEdge) NC.net && NC.net.act && NC.net.act("fire-self", { x: p.x, y: p.y, angle: p.angle, weapon: p.weapon });
      if (inp.cEdge) NC.net && NC.net.act && NC.net.act("weapon-cycle", {});
    }
  }

  function update(dt, state) {
    const guest = NC.net && NC.net.isGuest && NC.net.isGuest();
    for (const p of state.players) {
      if (p.dead || p.busted) continue;
      p.flash = Math.max(0, p.flash - dt);
      p.iatk = Math.max(0, p.iatk - dt);
      p.missionCD = Math.max(0, p.missionCD - dt);
      const isMe = p === NC.me();
      // guests: only predict own movement locally; other entities come from snapshots
      if (guest && !isMe) continue;
      const inp = isMe ? NC.input : (p._remoteInput || { joy: { x: 0, y: 0, mag: 0 } });
      if (guest && isMe) { guestSelfMove(p, inp, dt); continue; }
      const j = inp.joy || inp;
      if (p.inCar) {
        // driving handled by cars module via cars.drive(car, inp, dt)
        if (NC.cars && NC.cars.drive) NC.cars.drive(p.inCar, inp, dt, p);
        p.x = p.inCar.x; p.y = p.inCar.y;
        p.angle = p.inCar.angle;
        // exit
        if (inp.aEdge && NC.cars) NC.cars.tryExit(p);
        // firing from car = drive-by handled by combat via car window
      } else {
        const mag = Math.min(1, j.mag || Math.hypot(j.x || 0, j.y || 0));
        if (mag > 0.12) {
          const sp = mag > 0.85 ? RUN : WALK;
          const a = Math.atan2(j.y, j.x);
          tryMove(p, Math.cos(a) * sp * mag, Math.sin(a) * sp * mag, dt);
          p.angle = a;
          p.step = (p.step + dt * mag * 3) % 1;
          p.dir = Math.abs(j.x) > Math.abs(j.y) ? (j.x > 0 ? "right" : "left") : (j.y > 0 ? "down" : "up");
        }
        // A: enter car / interact
        if (inp.aEdge) {
          let used = false;
          for (const m of NC._mods) {
            if (!m.interactables) continue;
            for (const it of m.interactables(state) || []) {
              if (U.dist(p.x, p.y, it.x, it.y) < (it.r || 40)) { it.cb(p, state); used = true; break; }
            }
            if (used) break;
          }
          if (!used && NC.cars) NC.cars.tryEnter(p);
        }
        // B: attack
        if (inp.b && p.iatk <= 0 && NC.combat) {
          if (p.weapon === "fist") { NC.combat.melee(p); p.iatk = 0.45; }
          else if ((p.ammo[p.weapon] || 0) > 0) {
            NC.combat.fire(p, p.x, p.y, p.angle, p.weapon);
            p.iatk = p.weapon === "smg" ? 0.09 : p.weapon === "shotgun" ? 0.7 : 0.3;
            p.ammo[p.weapon]--;
            if (p.ammo[p.weapon] <= 0) p.weapon = "fist";
          } else p.weapon = "fist";
        }
        // C: weapon cycle
        if (inp.cEdge) {
          const order = ["fist", "pistol", "smg", "shotgun"].filter((w) => p.weapons[w]);
          p.weapon = order[(order.indexOf(p.weapon) + 1) % order.length];
          NC.toast(p.weapon.toUpperCase(), 900);
        }
      }
      // regenerate a bit of hp under 30 when not wanted
      if (p.hp < 30 && p.stars === 0) p.hp = Math.min(30, p.hp + dt * 3);
    }
  }

  function drawSelf(collectDraws, state) {
    for (const p of state.players) {
      collectDraws.push({
        y: p.y + 16,
        fn: (ctx) => {
          if (p.inCar) return; // hidden inside car body
          NC.sprites.drawChar(ctx, p.x, p.y, p.char, p.dir, p.step, {
            weapon: p.weapon,
            name: p.char,
            nameCol: p.char === "koto" ? "#22d3ee" : "#ff2d95",
          });
          if (p.flash > 0) {
            ctx.globalAlpha = p.flash * 2;
            ctx.fillStyle = "#fff";
            ctx.fillRect(p.x - 12, p.y - 18, 24, 36);
            ctx.globalAlpha = 1;
          }
        },
      });
    }
  }

  NC.register("player", {
    mkPlayer, spawnPlayer, update,
    collectDraws: (draws, camX, camY, state) => drawSelf(draws, state),
    interactables() { return []; },
    serialize() { return null; },
    deserialize() {},
  });
})();
