/* NEON CITY — cars: parked cars, grid traffic AI, driving physics, wrecks. */
(function () {
  const NC = window.NC;
  const U = NC.util;

  const CAR_HP = 60;
  const ENTER_R = 36;
  const TRAFFIC_N = 12;      // moving traffic pool size
  const PARKED_PER_BLOCK = 0.42; // ~26 parked across 63 blocks => ~38 cars total
  const TRAFFIC_SPEED = 110;
  const DESPAWN_R = 1200, RESPAWN_R = 500;
  const ACCEL = 240;

  const list = [];
  const parts = []; // cosmetic smoke (not serialized)
  let nextId = 1;
  let mgmtT = 0;

  const isGuest = () => !!(NC.net && NC.net.isGuest && NC.net.isGuest());
  const CARS = () => NC.sprites.CARS;

  // ---------- spawn ----------
  function mkCar(x, y, type, angle) {
    const def = CARS()[type];
    const c = {
      id: nextId++, x, y, angle: angle || 0, speed: 0,
      type, color: U.pick(def.cols), glow: U.pick(["#22d3ee", "#ff2d95", "#a855f7"]),
      driver: null, hp: CAR_HP, dead: false, ai: false,
      dirA: 0, nextI: 0, parked: false,
    };
    list.push(c);
    return c;
  }
  function pickType() {
    const r = Math.random();
    return r < 0.42 ? "civic" : r < 0.62 ? "taxi" : r < 0.82 ? "van" : "sport";
  }

  // ---------- grid lane helpers ----------
  // road centers: i*PITCH+ROAD/2 (i in 0..COLS) vertical, j*PITCH+ROAD/2 horizontal
  const laneX = (v) => U.clamp(Math.round((v - NC.world.ROAD / 2) / NC.world.PITCH) * NC.world.PITCH + NC.world.ROAD / 2, NC.world.ROAD / 2, NC.world.COLS * NC.world.PITCH + NC.world.ROAD / 2);
  const laneY = (v) => U.clamp(Math.round((v - NC.world.ROAD / 2) / NC.world.PITCH) * NC.world.PITCH + NC.world.ROAD / 2, NC.world.ROAD / 2, NC.world.ROWS * NC.world.PITCH + NC.world.ROAD / 2);
  const maxX = () => NC.world.COLS * NC.world.PITCH + NC.world.ROAD / 2;
  const maxY = () => NC.world.ROWS * NC.world.PITCH + NC.world.ROAD / 2;
  const DIRX = [1, 0, -1, 0], DIRY = [0, 1, 0, -1]; // dirA: 0:+x 1:+y 2:-x 3:-y
  // next road center ahead of v along +/-
  function nextCenter(v, sign, axisMax) {
    const P = NC.world.PITCH, R = NC.world.ROAD / 2;
    const c = sign > 0
      ? (Math.floor((v - R) / P) + 1) * P + R
      : Math.floor((v - R) / P) * P + R;
    return U.clamp(c, R, axisMax);
  }

  function snapToLane(c) {
    // decide axis by which road band the point is in (intersection => random)
    const fx = U.wrap(c.x, NC.world.PITCH), fy = U.wrap(c.y, NC.world.PITCH);
    const onV = fx < NC.world.ROAD, onH = fy < NC.world.ROAD;
    let vertical = onV && onH ? Math.random() < 0.5 : onV;
    if (vertical) { c.x = laneX(c.x); c.dirA = Math.random() < 0.5 ? 1 : 3; }
    else { c.y = laneY(c.y); c.dirA = Math.random() < 0.5 ? 0 : 2; }
    c.angle = c.dirA * Math.PI / 2;
    armNext(c);
  }
  function armNext(c) {
    const dx = DIRX[c.dirA], dy = DIRY[c.dirA];
    if (dx) c.nextI = nextCenter(c.x, dx, maxX());
    else c.nextI = nextCenter(c.y, dy, maxY());
  }

  function spawnTraffic(state, minDist) {
    for (let i = 0; i < 30; i++) {
      const pt = NC.world.randomRoad();
      let ok = true;
      for (const p of state.players) {
        const d = U.dist(pt.x, pt.y, p.x, p.y);
        if (d < (minDist || 0)) { ok = false; break; }
      }
      if (!ok && i < 24) continue;
      const c = mkCar(pt.x, pt.y, pickType(), 0);
      c.ai = true; c.driver = { npc: true }; c.speed = TRAFFIC_SPEED;
      snapToLane(c);
      return c;
    }
    return null;
  }

  function addParked(state) {
    const W = NC.world, BLOCK = W.PITCH - W.ROAD;
    for (let bx = 0; bx < W.COLS; bx++) {
      for (let by = 0; by < W.ROWS; by++) {
        if (Math.random() > PARKED_PER_BLOCK) continue;
        const ox = W.ROAD + bx * W.PITCH, oy = W.ROAD + by * W.PITCH;
        const side = U.randi(0, 3), along = U.rand(40, BLOCK - 40);
        let x, y, angle;
        if (side === 0) { x = ox + 2; y = oy + along; angle = Math.PI / 2; }
        else if (side === 1) { x = ox + BLOCK - 2; y = oy + along; angle = -Math.PI / 2; }
        else if (side === 2) { x = ox + along; y = oy + 2; angle = 0; }
        else { x = ox + along; y = oy + BLOCK - 2; angle = Math.PI; }
        if (NC.world.solidAt(x, y, 8)) continue;
        const c = mkCar(x, y, pickType(), angle);
        c.parked = true;
      }
    }
    // two police cruisers parked on the road by the station — stealing one is a crime
    const ps = NC.world.policeStation;
    const oy = NC.world.ROAD + (NC.world.ROWS - 2) * NC.world.PITCH;
    for (const dxOff of [-44, 26]) {
      const x = ps.x + dxOff, y = oy - 26;
      if (!NC.world.solidAt(x, y, 10)) {
        const c = mkCar(x, y, "police", 0);
        c.parked = true;
      }
    }
  }

  // ---------- traffic AI ----------
  function carAhead(c, range) {
    const dx = DIRX[c.dirA], dy = DIRY[c.dirA];
    let best = null;
    for (const o of list) {
      if (o === c) continue;
      const rx = o.x - c.x, ry = o.y - c.y;
      const fwd = rx * dx + ry * dy;
      if (fwd < 8 || fwd > range) continue;
      const side = Math.abs(rx * dy - ry * dx);
      if (side < 24 && (!best || fwd < best.d)) best = { d: fwd, o };
    }
    return best;
  }

  function arrive(c) {
    // c reached intersection at coordinate c.nextI along its axis
    const dx = DIRX[c.dirA], dy = DIRY[c.dirA];
    const axisMax = dx ? maxX() : maxY();
    const perpMax = dx ? maxY() : maxX();
    // can it keep straight past this intersection?
    const canStraight = dx
      ? (dx > 0 ? c.nextI < axisMax : c.nextI > NC.world.ROAD / 2)
      : (dy > 0 ? c.nextI < axisMax : c.nextI > NC.world.ROAD / 2);
    // turn candidates: perpendicular dirs that stay in bounds
    const perp = [1, 3].map((d) => (c.dirA + d) % 4);
    const others = perp.filter((nd) => {
      const s = DIRX[nd] || DIRY[nd]; // sign along the new axis
      const coord = dx ? laneY(c.y) : laneX(c.x); // current perp coord = new axis position
      const nxt = coord + s * NC.world.PITCH;
      return nxt >= NC.world.ROAD / 2 && nxt <= perpMax;
    });
    if (!canStraight && !others.length) { c.dirA = (c.dirA + 2) % 4; c.angle = c.dirA * Math.PI / 2; armNext(c); return; }
    const turn = (!canStraight && others.length) || (others.length && Math.random() < 0.3);
    if (turn) {
      const nd = others[Math.floor(Math.random() * others.length)];
      // snap to the intersection center
      if (dx) { c.x = c.nextI; } else { c.y = c.nextI; }
      c.dirA = nd;
      c.angle = nd * Math.PI / 2;
      // new next intersection along new axis
      const s = DIRX[nd] || DIRY[nd];
      const coord = DIRX[nd] ? c.x : c.y;
      c.nextI = U.clamp(coord + s * NC.world.PITCH, NC.world.ROAD / 2, (DIRX[nd] ? maxX() : maxY()));
    } else {
      c.nextI += (dx || dy) * NC.world.PITCH;
      c.nextI = U.clamp(c.nextI, NC.world.ROAD / 2, axisMax);
    }
  }

  function trafficStep(c, dt) {
    const ahead = carAhead(c, 60);
    const target = ahead ? Math.max(0, (ahead.d - 22) * 3.2) : TRAFFIC_SPEED;
    c.speed = U.lerp(c.speed, Math.min(target, TRAFFIC_SPEED), Math.min(1, dt * 3));
    const dx = DIRX[c.dirA], dy = DIRY[c.dirA];
    c.x += dx * c.speed * dt;
    c.y += dy * c.speed * dt;
    // hold lane center on perpendicular axis
    if (dx) c.y = U.lerp(c.y, laneY(c.y), Math.min(1, dt * 5));
    else c.x = U.lerp(c.x, laneX(c.x), Math.min(1, dt * 5));
    // reached the next intersection? (remaining distance signed along travel dir)
    const pos = dx ? c.x : c.y;
    if ((c.nextI - pos) * (dx || dy) <= 4) arrive(c);
  }

  // ---------- population ----------
  function manage(state) {
    for (let i = list.length - 1; i >= 0; i--) {
      const c = list[i];
      let nearest = 1e9;
      for (const p of state.players) nearest = Math.min(nearest, U.dist(c.x, c.y, p.x, p.y));
      if (c.ai && c.driver !== "player" && nearest > DESPAWN_R) {
        // respawn same car near players but >RESPAWN_R away
        const pt = NC.world.randomRoad();
        c.x = pt.x; c.y = pt.y; c.hp = CAR_HP; c.dead = false;
        c.driver = { npc: true }; c.speed = TRAFFIC_SPEED;
        snapToLane(c);
        let tries = 0;
        while (tries++ < 20) {
          let ok = true;
          for (const p of state.players) if (U.dist(c.x, c.y, p.x, p.y) < RESPAWN_R) ok = false;
          if (ok) break;
          const q = NC.world.randomRoad(); c.x = q.x; c.y = q.y; snapToLane(c);
        }
      } else if (c.dead && nearest > DESPAWN_R + 300) {
        list.splice(i, 1); // haul away far wrecks
      }
    }
    let ai = 0;
    for (const c of list) if (c.ai && c.driver !== "player" && !c.dead) ai++;
    for (let i = ai; i < TRAFFIC_N; i++) spawnTraffic(state, RESPAWN_R);
  }

  // ---------- smoke ----------
  function puff(x, y, col, r, life) {
    if (parts.length > 160) parts.shift();
    parts.push({ x, y, vx: U.rand(-26, 26), vy: U.rand(-26, 26), t: 0, life: life || 0.7, r: r || 4, col: col || "190,196,214" });
  }
  function updateParts(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.t >= p.life) parts.splice(i, 1);
    }
  }

  // ---------- damage ----------
  function damage(car, dmg) {
    if (!car || car.dead) return;
    car.hp -= dmg;
    if (car.hp > 0) return;
    car.hp = 0; car.dead = true; car.ai = false; car.speed = 0;
    const wasPlayer = car.driver === "player";
    car.driver = null;
    if (NC.combat && NC.combat.explode) { try { NC.combat.explode(car.x, car.y, 70); } catch (e) {} }
    NC.shake(8);
    for (let i = 0; i < 16; i++)
      puff(car.x + U.rand(-14, 14), car.y + U.rand(-10, 10), i % 2 ? "255,110,40" : "255,200,60", U.rand(5, 11), U.rand(0.5, 1.1));
    if (wasPlayer && NC.state) {
      for (const p of NC.state.players) {
        if (p.inCar === car) {
          p.inCar = null; p.hp = 0;
          if (NC.hud && NC.hud.wasted && !p.dead) NC.hud.wasted(p);
        }
      }
    }
  }

  // ---------- enter / exit / drive ----------
  function nearestCar(x, y, r) {
    let best = null, bd = r;
    for (const c of list) {
      if (c.dead) continue;
      const d = U.dist(x, y, c.x, c.y);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }
  function carAt(x, y, r = 10) {
    for (const c of list) {
      const rad = r + CARS()[c.type].w * 0.32;
      if (U.dist(x, y, c.x, c.y) < rad) return c;
    }
    return null;
  }

  function tryEnter(p) {
    // nearest non-dead, not player-driven car within ENTER_R
    let best = null, bd = ENTER_R;
    for (const c of list) {
      if (c.dead || c.driver === "player") continue;
      const d = U.dist(p.x, p.y, c.x, c.y);
      if (d < bd) { bd = d; best = c; }
    }
    if (!best) return false;
    const occupied = !!best.driver; // npc ped inside
    const copCar = best.type === "police";
    if (occupied) { best.driver = null; NC.toast("Driver pulled out!", 1400); }
    best.ai = false; best.parked = false; best.speed = 0;
    best.driver = "player";
    if (copCar) best.siren = true;
    p.inCar = best;
    if ((occupied || copCar) && NC.people && NC.people.raiseWanted)
      NC.people.raiseWanted(p, 1);
    NC.toast(copCar ? "Stolen a police cruiser!" : "Car jacked — floor it!", 1300);
    return true;
  }

  function tryExit(p) {
    const car = p.inCar;
    if (!car) return false;
    const px = -Math.sin(car.angle), py = Math.cos(car.angle); // car's left side
    const spots = [
      [car.x + px * 26, car.y + py * 26], [car.x - px * 26, car.y - py * 26],
      [car.x - Math.cos(car.angle) * 30, car.y - Math.sin(car.angle) * 30],
      [car.x + Math.cos(car.angle) * 30, car.y + Math.sin(car.angle) * 30],
      [car.x, car.y],
    ];
    for (const s of spots) {
      if (!NC.world.solidAt(s[0], s[1], 8)) { p.x = s[0]; p.y = s[1]; break; }
    }
    car.driver = null;
    car.speed = 0;
    car.siren = false;
    p.inCar = null;
    return true;
  }

  function drive(car, inp, dt, p) {
    if (!car || car.dead) { if (p) p.inCar = null; return; }
    const j = (inp && inp.joy) || inp || { x: 0, y: 0, mag: 0 };
    const steer = U.clamp(j.x || 0, -1, 1);
    const thr = U.clamp(-(j.y || 0), -1, 1); // stick up = forward
    const top = CARS()[car.type].top;

    if (thr > 0.1) car.speed = Math.min(top, car.speed + ACCEL * thr * dt);
    else if (thr < -0.1) {
      if (car.speed > 10) car.speed = Math.max(0, car.speed + ACCEL * 1.5 * thr * dt); // brake
      else car.speed = Math.max(-top * 0.38, car.speed + ACCEL * thr * dt); // reverse
    } else {
      car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 140 * dt); // coast
    }
    // steering rate scales with speed; inverts in reverse
    const spdF = U.clamp(Math.abs(car.speed) / 140, 0, 1) * (car.speed < 0 ? -1 : 1);
    car.angle += steer * 2.7 * spdF * dt;

    // skid smoke: hard steering at speed or hard braking
    if ((Math.abs(steer) > 0.55 && Math.abs(car.speed) > 130) || (thr < -0.5 && car.speed > 80)) {
      const bx = car.x - Math.cos(car.angle) * 14, by = car.y - Math.sin(car.angle) * 14;
      puff(bx + U.rand(-6, 6), by + U.rand(-6, 6), "170,176,196", U.rand(3, 6), 0.6);
    }

    const def = CARS()[car.type];
    const sgn = car.speed >= 0 ? 1 : -1;
    const mx = Math.cos(car.angle) * car.speed * dt, my = Math.sin(car.angle) * car.speed * dt;
    const px = car.x + Math.cos(car.angle) * sgn * (def.w / 2 + 4) + mx;
    const py = car.y + Math.sin(car.angle) * sgn * (def.w / 2 + 4) + my;
    if (!NC.world.solidAt(px, py, 8)) {
      car.x += mx; car.y += my;
    } else {
      const impact = Math.abs(car.speed);
      car.speed = -car.speed * 0.35;
      car.x -= Math.cos(car.angle) * 2; car.y -= Math.sin(car.angle) * 2;
      damage(car, impact * 0.06);
      NC.shake(Math.min(10, 3 + impact * 0.03));
      for (let i = 0; i < 5; i++) puff(car.x + Math.cos(car.angle) * sgn * 16, car.y + Math.sin(car.angle) * sgn * 16, "200,205,225", 4, 0.5);
    }

    // run over peds / cops
    if (Math.abs(car.speed) > 45 && NC.people) {
      for (const arr of [NC.people.peds, NC.people.cops]) {
        if (!arr) continue;
        for (const ped of arr) {
          if (!ped || ped.dead || (ped.hp !== undefined && ped.hp <= 0)) continue;
          if (U.dist(car.x, car.y, ped.x, ped.y) < def.w * 0.5 + 6) {
            try { NC.people.damage(ped, 999, p); } catch (e) {}
            if (NC.people.raiseWanted) NC.people.raiseWanted(p, 1);
            car.speed *= 0.86;
            NC.shake(2);
            puff(ped.x, ped.y, "255,60,80", 5, 0.6);
          }
        }
      }
    }

    // car vs car (wrecks still block)
    for (const o of list) {
      if (o === car) continue;
      const d = U.dist(car.x, car.y, o.x, o.y);
      const minD = (def.w + CARS()[o.type].w) * 0.33;
      if (d >= minD || d < 0.01) continue;
      const push = U.angTo(car.x, car.y, o.x, o.y);
      const overlap = (minD - d) * 0.5;
      o.x += Math.cos(push) * overlap; o.y += Math.sin(push) * overlap;
      car.x -= Math.cos(push) * overlap; car.y -= Math.sin(push) * overlap;
      const rel = Math.abs(car.speed) + Math.abs(o.speed || 0) * 0.4;
      if (rel > 30) {
        damage(o, rel * 0.05);
        damage(car, rel * 0.04);
        NC.shake(3);
        puff((car.x + o.x) / 2, (car.y + o.y) / 2, "220,224,240", 5, 0.5);
      }
      car.speed *= 0.55;
    }
  }

  // ---------- module hooks ----------
  function init() { list.length = 0; parts.length = 0; }
  function start(state) {
    if (list.length) return; // restored via deserialize
    addParked(state);
    for (let i = 0; i < TRAFFIC_N; i++) spawnTraffic(state, 0);
  }

  function update(dt, state) {
    updateParts(dt);
    if (isGuest()) return; // host runs all world/AI mutation
    for (const c of list) {
      if (c.ai && !c.dead && c.driver !== "player") trafficStep(c, dt);
    }
    mgmtT -= dt;
    if (mgmtT <= 0) { mgmtT = 0.6; manage(state); }
  }

  function collectDraws(draws, camX, camY, state) {
    const z = (state && state.cam && state.cam.zoom) || 1;
    const x1 = camX + NC.vw / z + 90, y1 = camY + NC.vh / z + 90;
    const x0 = camX - 90, y0 = camY - 90;
    for (const c of list) {
      if (c.x < x0 || c.x > x1 || c.y < y0 || c.y > y1) continue;
      draws.push({
        y: c.y + 10,
        fn: (ctx) => NC.sprites.drawCar(ctx, c.x, c.y, c.angle, c.type, c.color, {
          dead: c.dead, glow: c.glow, siren: c.siren,
        }),
      });
    }
  }

  function drawOver(ctx, cam) {
    // wreck smoke
    const now = performance.now();
    for (const c of list) {
      if (!c.dead) continue;
      if (c.x < cam.x - 60 || c.x > cam.x + NC.vw + 60 || c.y < cam.y - 60 || c.y > cam.y + NC.vh + 60) continue;
      if (now > (c._smk || 0)) { c._smk = now + 150; puff(c.x + U.rand(-8, 8), c.y, "60,60,70", U.rand(3, 6), 1.1); }
    }
    for (const pt of parts) {
      if (pt.x < cam.x - 40 || pt.x > cam.x + NC.vw + 40 || pt.y < cam.y - 40 || pt.y > cam.y + NC.vh + 40) continue;
      const a = (1 - pt.t / pt.life) * 0.42;
      ctx.fillStyle = `rgba(${pt.col},${a})`;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.r * (1 + pt.t * 1.6), 0, 7);
      ctx.fill();
    }
  }

  function interactables(state) {
    const out = [];
    for (const p of state.players) {
      if (p.dead || p.busted || p.inCar) continue;
      let best = null, bd = ENTER_R;
      for (const c of list) {
        if (c.dead || c.driver === "player") continue;
        const d = U.dist(p.x, p.y, c.x, c.y);
        if (d < bd) { bd = d; best = c; }
      }
      if (best) out.push({
        x: best.x, y: best.y, r: ENTER_R,
        label: best.type === "police" ? "Steal cop car" : "Enter car",
        cb: (pl) => tryEnter(pl),
      });
    }
    return out;
  }

  function serialize() {
    return list.map((c) => ({
      id: c.id, x: Math.round(c.x * 10) / 10, y: Math.round(c.y * 10) / 10,
      angle: c.angle, speed: c.speed, type: c.type, color: c.color, glow: c.glow,
      hp: c.hp, dead: c.dead, ai: c.ai, dirA: c.dirA, nextI: c.nextI, parked: c.parked,
      siren: !!c.siren,
      driver: c.driver === "player" ? "player" : c.driver ? "npc" : null,
    }));
  }
  function deserialize(s) {
    if (!Array.isArray(s)) return;
    list.length = 0;
    for (const d of s) {
      const c = {
        id: d.id || nextId++, x: d.x || 0, y: d.y || 0, angle: d.angle || 0,
        speed: d.speed || 0, type: CARS()[d.type] ? d.type : "civic",
        color: d.color || "#22d3ee", glow: d.glow || "#22d3ee",
        hp: d.hp === undefined ? CAR_HP : d.hp, dead: !!d.dead,
        ai: !!d.ai, dirA: d.dirA || 0, nextI: d.nextI || 0, parked: !!d.parked,
        siren: !!d.siren,
        driver: d.driver === "player" ? "player" : d.driver === "npc" ? { npc: true } : null,
      };
      list.push(c);
      if (c.id >= nextId) nextId = c.id + 1;
    }
    // relink players' inCar refs to the fresh car objects
    if (NC.state && NC.state.players) {
      for (const p of NC.state.players) {
        if (p.inCar) p.inCar = list.find((c) => c.id === p.inCar.id) || null;
      }
    }
  }

  function remoteAction(name, args) {
    const s = NC.state;
    if (!s || !args) return;
    const p = s.players[args.pi];
    if (!p || p.dead || p.busted) return;
    if (name === "car-enter") tryEnter(p);
    else if (name === "car-exit") tryExit(p);
  }

  NC.register("cars", {
    list, nearestCar, carAt, tryEnter, tryExit, drive, damage,
    init, start, update, collectDraws, drawOver, interactables,
    serialize, deserialize, remoteAction,
  });
})();
