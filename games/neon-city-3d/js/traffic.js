/* NEON CITY 3D — traffic: driverless civilian cars cruise the road grid.
   Repurposes parked cars (or spawns civvies) and moves them along road lanes:
   straight preferred at intersections, random turn otherwise; yields to
   players/peds/cars ahead; despawns+respawns when stuck or far from players. */
const NC = window.NC;
const U = () => NC.util;

const WANT = 8, SPEED = 9, FAR = 150, STUCK_T = 9, BLOCK_T = 1.6;
const BOUND = () => NC.city.EXT / 2 - 1.5;

NC.register('traffic', {
  cars: [],
  _driven: new Set(), // cars a player has driven — never teleport those into service

  _ok(c) { return c && !c.dead && !c.driver && !c.isPursuit && c.kind !== 'police' && !this._driven.has(c); },

  _claim(c) {
    c._traffic = true;
    c._t = { axis: 'z', dir: 1, road: 0, lane: 3, cross: null, stuck: 0, blocked: 0, clearT: 0, turning: null };
    this._place(c);
    this.cars.push(c);
  },

  // nearest grid line to v on the given road array
  _line(lines, v) {
    let best = lines[0], bd = 1e9;
    for (const r of lines) { const d = Math.abs(v - r); if (d < bd) { bd = d; best = r; } }
    return best;
  },

  // put a car on a random road lane; when a player exists pick a spot 42–100m out (not within 26m)
  _place(c) {
    const C = NC.city, t = c._t;
    const ps = NC.state.players.filter(p => p && !p.dead && p.mesh.visible);
    const near = ps.length ? ps[U().randi(0, ps.length - 1)] : null;
    let tx = U().rand(-C.EXT / 2 + 6, C.EXT / 2 - 6), tz = U().rand(-C.EXT / 2 + 6, C.EXT / 2 - 6);
    for (let i = 0; i < 30; i++) {
      if (near) {
        const a = Math.random() * Math.PI * 2, r = U().rand(42, 100);
        tx = U().clamp(near.x + Math.sin(a) * r, -C.EXT / 2 + 4, C.EXT / 2 - 4);
        tz = U().clamp(near.z + Math.cos(a) * r, -C.EXT / 2 + 4, C.EXT / 2 - 4);
      }
      const q = C.nearestRoadTo(tx, tz);
      let bad = false;
      for (const p of ps) if (U().dist3(q.x, q.z, p.x, p.z) < 26) { bad = true; break; }
      if (!bad) for (const o of NC.car.list) if (o !== c && !o.dead && U().dist3(q.x, q.z, o.x, o.z) < 5) { bad = true; break; }
      if (!bad) { tx = q.x; tz = q.z; break; }
      tx = q.x; tz = q.z; // keep last snap as fallback
    }
    // the coord nearest a road line tells us which road we sit on
    const rx = this._line(C.ROAD_X, tx), rz = this._line(C.ROAD_Z, tz);
    t.axis = Math.abs(tx - rx) < Math.abs(tz - rz) ? 'z' : 'x';
    t.road = t.axis === 'z' ? rx : rz;
    t.dir = Math.random() < 0.5 ? 1 : -1;
    t.lane = 3 * t.dir;
    t.cross = null; t.stuck = 0; t.blocked = 0; t.clearT = 0; t.turning = null;
    if (t.axis === 'z') {
      if (Math.abs(t.road + t.lane) > BOUND()) { t.dir = -t.dir; t.lane = 3 * t.dir; }
      c.x = t.road + t.lane; c.z = tz; c.yaw = t.dir > 0 ? 0 : Math.PI;
    } else {
      if (Math.abs(t.road - t.lane) > BOUND()) { t.dir = -t.dir; t.lane = 3 * t.dir; }
      c.z = t.road - t.lane; c.x = tx; c.yaw = t.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    }
    c.speed = SPEED * 0.6;
    c.group.position.set(c.x, 0, c.z);
    c.group.rotation.y = c.yaw - Math.PI / 2;
  },

  init() {
    this.cars.length = 0;
    for (const c of NC.car.list) {
      if (this.cars.length >= WANT) break;
      if (this._ok(c)) this._claim(c);
    }
  },

  update(dt, state) {
    if (NC.net && NC.net.isGuest && NC.net.isGuest()) return;
    const C = NC.city;
    // drop cars that got stolen/destroyed, top the pool back up
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      if (c.driver || c.isPursuit) this._driven.add(c);
      if (!this._ok(c)) { c._traffic = false; c._t = null; this.cars.splice(i, 1); }
    }
    for (const c of NC.car.list) {
      if (this.cars.length >= WANT) break;
      if (this._ok(c) && !c._traffic) this._claim(c);
    }
    while (this.cars.length < WANT) {
      const kinds = ['civic', 'civic', 'taxi', 'van', 'sport'];
      this._claim(NC.car.spawn(kinds[U().randi(0, kinds.length - 1)], 0, 0));
    }

    const ps = state.players.filter(p => p && !p.dead);
    const peds = NC.people ? NC.people.peds : [];
    const cops = NC.people ? NC.people.cops : [];

    for (const c of this.cars) {
      const t = c._t;
      const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
      // obstacle check: ~5m ahead of the nose
      const ax = c.x + fx * 5, az = c.z + fz * 5;
      let block = null, bd = 1e9;
      const chk = (e, r) => {
        const d = U().dist3(ax, az, e.x, e.z);
        if (d < r && d < bd) { bd = d; block = e; }
      };
      for (const p of ps) if (!p.inCar && p.mesh.visible) chk(p, 2.6);
      for (const e of peds) if (!e.dead) chk(e, 2.4);
      for (const e of cops) if (!e.dead) chk(e, 2.4);
      for (const o of NC.car.list) if (o !== c && !o.dead) chk(o, 3.8);

      const tgt = block ? 0 : SPEED;
      c.speed = U().lerp(c.speed, tgt, Math.min(1, dt * (block ? 8 : 2.2)));

      // bookkeeping: blocked by a live thing vs truly stuck
      if (c.speed < 0.6) {
        t.blocked += dt;
        if (!block || block.def !== undefined) t.stuck += dt; else t.stuck = 0;
      } else { t.blocked = 0; t.stuck = 0; }
      if (t.stuck > STUCK_T) { this._place(c); continue; }

      // slip into the oncoming lane to pass a stopped vehicle (never for peds/players)
      if (!t.turning && block && block.def !== undefined && t.blocked > BLOCK_T) {
        let safe = true;
        for (const o of this.cars) {
          if (o === c || !o._t || o._t.turning) continue;
          const d = U().dist3(o.x, o.z, ax + fx * 10, az + fz * 10);
          if (d < 9) { safe = false; break; }
        }
        if (safe && Math.abs(t.axis === 'z' ? t.road - 3 * t.dir : t.road + 3 * t.dir) <= BOUND()) t.lane = -3 * t.dir;
      }
      if (t.lane !== 3 * t.dir) {
        if (!block) t.clearT += dt; else t.clearT = 0;
        if (t.clearT > 2.5) { t.lane = 3 * t.dir; t.clearT = 0; }
      } else t.clearT = 0;

      // >150m from every player → recycle nearer
      let nearest = 1e9;
      for (const p of ps) nearest = Math.min(nearest, U().dist3(c.x, c.z, p.x, p.z));
      if (ps.length && nearest > FAR) { this._place(c); continue; }

      if (t.turning) {
        const T = t.turning;
        if (T.axis === 'x') { c.x += T.dir * c.speed * dt; c.z = U().lerp(c.z, T.laneCoord, Math.min(1, dt * 4)); }
        else { c.z += T.dir * c.speed * dt; c.x = U().lerp(c.x, T.laneCoord, Math.min(1, dt * 4)); }
        const want = T.axis === 'x' ? (T.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (T.dir > 0 ? 0 : Math.PI);
        c.yaw += U().clamp(U().angDiff(want, c.yaw), -1, 1) * Math.min(1, dt * 3.4);
        if (Math.abs(U().angDiff(want, c.yaw)) < 0.05) {
          c.yaw = want; t.axis = T.axis; t.dir = T.dir; t.road = T.road;
          t.lane = 3 * T.dir; t.turning = null; t.cross = T.from; // skip re-triggering the crossing we came from
        }
      } else {
        if (t.axis === 'z') {
          c.z += t.dir * c.speed * dt;
          c.x = U().lerp(c.x, t.road + t.lane, Math.min(1, dt * 4));
          c.yaw = t.dir > 0 ? 0 : Math.PI;
        } else {
          c.x += t.dir * c.speed * dt;
          c.z = U().lerp(c.z, t.road - t.lane, Math.min(1, dt * 4));
          c.yaw = t.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
        }
        // intersection entry → decide straight vs turn (forced at the grid edge)
        const along = t.axis === 'z' ? c.z : c.x;
        const lines = t.axis === 'z' ? C.ROAD_Z : C.ROAD_X;
        let inside = null;
        for (const ln of lines) if (Math.abs(along - ln) <= C.ROAD / 2) { inside = ln; break; }
        if (inside !== null && t.cross !== inside) {
          const edge = (t.dir > 0 && inside >= lines[lines.length - 1] - 0.01) ||
                       (t.dir < 0 && inside <= lines[0] + 0.01);
          if (edge || Math.random() < 0.3) {
            let nd = Math.random() < 0.5 ? 1 : -1;
            let laneCoord = t.axis === 'z' ? inside - 3 * nd : inside + 3 * nd;
            if (Math.abs(laneCoord) > BOUND()) { nd = -nd; laneCoord = t.axis === 'z' ? inside - 3 * nd : inside + 3 * nd; }
            t.turning = { axis: t.axis === 'z' ? 'x' : 'z', dir: nd, road: inside, laneCoord, from: t.road };
          }
        }
        t.cross = inside;
        if (Math.abs(along) > C.EXT / 2 - 1) { this._place(c); continue; }
      }
      c.group.position.set(c.x, 0, c.z);
      c.group.rotation.y = c.yaw - Math.PI / 2;
    }
  },
});
