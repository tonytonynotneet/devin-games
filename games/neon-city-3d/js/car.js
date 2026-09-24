/* NEON CITY 3D — car: low-poly vehicles, arcade drive physics, enter/exit, damage,
   lane traffic AI (parked + driving traffic per spec), wreck cleanup. */
import * as THREE from 'three';
const NC = window.NC;

const CAR_DEFS = {
  civic: { l: 3.6, w: 1.7, h: 0.9, top: 16, accel: 14, cols: [0xf43f5e, 0x22d3ee, 0xfacc15, 0xe2e8f0, 0xa855f7] },
  sport: { l: 3.9, w: 1.8, h: 0.8, top: 24, accel: 22, cols: [0xf97316, 0xff2d95, 0x22d3ee] },
  taxi: { l: 3.6, w: 1.7, h: 0.9, top: 15, accel: 13, cols: [0xfacc15] },
  van: { l: 4.1, w: 1.9, h: 1.3, top: 13, accel: 11, cols: [0x64748b, 0x94a3b8] },
  police: { l: 3.7, w: 1.75, h: 0.9, top: 21, accel: 19, cols: [0x1e3a8a] },
};

const TRAFFIC_N = 10;        // moving traffic pool
const TRAFFIC_SPEED = 8.5;
const LANE = 1.9;            // right-lane offset from road center
const DX = [1, 0, -1, 0], DZ = [0, 1, 0, -1]; // dirA: 0:+x 1:+z 2:-x 3:-z

function box(w, h, d, c, x = 0, y = 0, z = 0, emissive = false) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d),
    emissive ? new THREE.MeshBasicMaterial({ color: c }) : new THREE.MeshLambertMaterial({ color: c }));
  m.position.set(x, y, z);
  return m;
}
const wheelGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.25, 10);
const wheelMat = new THREE.MeshLambertMaterial({ color: 0x0a0c12 });

NC.register('car', {
  list: [],

  makeMesh(kind, color) {
    const d = CAR_DEFS[kind];
    const col = color !== undefined ? color : d.cols[(Math.random() * d.cols.length) | 0];
    const g = new THREE.Group();
    g.add(box(d.l, d.h * 0.55, d.w, col, 0, 0.42, 0));                          // body
    g.add(box(d.l * 0.52, d.h * 0.5, d.w * 0.86, 0x10141f, -d.l * 0.04, 0.42 + d.h * 0.44, 0)); // cabin glass
    g.add(box(d.l * 0.54, 0.06, d.w * 0.88, col, -d.l * 0.04, 0.42 + d.h * 0.7, 0));            // roof
    // wheels
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.rotation.z = Math.PI / 2;
      w.position.set(sx * d.l * 0.32, 0.32, sz * (d.w / 2 - 0.1));
      g.add(w);
    }
    // neon underglow + lights
    g.add(box(d.l * 0.92, 0.05, d.w * 0.94, col, 0, 0.08, 0, true));
    g.add(box(0.08, 0.14, 0.34, 0xfff4c0, d.l / 2 - 0.02, 0.5, -d.w * 0.28, true));  // headlight L
    g.add(box(0.08, 0.14, 0.34, 0xfff4c0, d.l / 2 - 0.02, 0.5, d.w * 0.28, true));   // headlight R
    g.add(box(0.06, 0.12, 0.4, 0xff3355, -d.l / 2 + 0.02, 0.5, -d.w * 0.28, true));  // tail L
    g.add(box(0.06, 0.12, 0.4, 0xff3355, -d.l / 2 + 0.02, 0.5, d.w * 0.28, true));   // tail R
    if (kind === 'police') {
      g.add(emisBar(0.5, 0.12, 0.3, 0xff3355, 0, 0.42 + d.h * 0.7 + 0.09, -0.2));
      g.add(emisBar(0.5, 0.12, 0.3, 0x60a5fa, 0, 0.42 + d.h * 0.7 + 0.09, 0.2));
    }
    return g;
  },

  spawn(kind, x, z, yaw = 0) {
    const def = CAR_DEFS[kind];
    const mesh = this.makeMesh(kind);
    mesh.position.set(x, 0, z);
    mesh.rotation.y = yaw - Math.PI / 2;
    NC.scene.add(mesh);
    const car = { kind, def, group: mesh, x, z, yaw, speed: 0, steer: 0, hp: 100, dead: false, driver: null, ai: false, parked: false, dirA: 0, nextI: 0 };
    this.list.push(car);
    return car;
  },

  // ---------- grid-lane traffic helpers ----------
  // dirA axis travel: 0/2 move along x on a horizontal road, 1/3 along z on a vertical road
  _laneLines(dirA) { return (dirA % 2 === 0) ? NC.city.ROAD_Z : NC.city.ROAD_X; },

  _nextLine(lines, v, sign) {
    let best = null;
    for (const r of lines) {
      if (sign > 0 ? (r > v + 0.5 && (best === null || r < best)) : (r < v - 0.5 && (best === null || r > best))) best = r;
    }
    return best;
  },

  _snapLane(c) {
    // decide travel axis from which road band we're in, sit in the right-hand lane
    const nearX = NC.util.dist3(c.x, 0, nearestOf(NC.city.ROAD_X, c.x), 0) < NC.city.ROAD / 2 - 0.5;
    const nearZ = NC.util.dist3(0, c.z, 0, nearestOf(NC.city.ROAD_Z, c.z)) < NC.city.ROAD / 2 - 0.5;
    const vertical = nearX && nearZ ? Math.random() < 0.5 : nearX;
    if (vertical) {
      c.dirA = Math.random() < 0.5 ? 1 : 3;
      c.x = nearestOf(NC.city.ROAD_X, c.x) + (c.dirA === 1 ? LANE : -LANE);
    } else {
      c.dirA = Math.random() < 0.5 ? 0 : 2;
      c.z = nearestOf(NC.city.ROAD_Z, c.z) + (c.dirA === 0 ? -LANE : LANE);
    }
    c.yaw = c.dirA * Math.PI / 2;
    this._armNext(c);
  },

  _armNext(c) {
    const dx = DX[c.dirA], dz = DZ[c.dirA];
    const sign = dx || dz;
    const lines = dx ? NC.city.ROAD_X : NC.city.ROAD_Z;
    const v = dx ? c.x : c.z;
    const n = this._nextLine(lines, v, sign);
    // no road left ahead: target the boundary intersection so _arrive forces a turn
    c.nextI = n === null ? (sign > 0 ? Math.max(...lines) : Math.min(...lines)) : n;
  },

  _arrive(c) {
    // reached an intersection: usually straight (70%), else a legal turn
    const dx = DX[c.dirA], dz = DZ[c.dirA];
    const sign = dx || dz;
    if (dx) c.x = c.nextI; else c.z = c.nextI;
    const axisLines = dx ? NC.city.ROAD_X : NC.city.ROAD_Z;
    const v = dx ? c.x : c.z;
    const straight = this._nextLine(axisLines, v, sign) !== null;
    // perpendicular dirs are legal iff the next road on that axis exists
    const pv = dx ? c.z : c.x;
    const perpLines = dx ? NC.city.ROAD_Z : NC.city.ROAD_X;
    const turns = [1, 3].map(d => (c.dirA + d) % 4)
      .filter(nd => this._nextLine(perpLines, pv, DX[nd] || DZ[nd]) !== null);
    if (straight && Math.random() > 0.3) { this._armNext(c); return; }
    c.dirA = turns.length ? turns[(Math.random() * turns.length) | 0] : (c.dirA + 2) % 4;
    // snap onto the new lane
    if (c.dirA % 2 === 0) c.z = nearestOf(NC.city.ROAD_Z, c.z) + (c.dirA === 0 ? -LANE : LANE);
    else c.x = nearestOf(NC.city.ROAD_X, c.x) + (c.dirA === 1 ? LANE : -LANE);
    c.yaw = c.dirA * Math.PI / 2;
    this._armNext(c);
  },

  _carAhead(c, range) {
    const dx = DX[c.dirA], dz = DZ[c.dirA];
    let best = null;
    for (const o of this.list) {
      if (o === c) continue;
      const rx = o.x - c.x, rz = o.z - c.z;
      const fwd = rx * dx + rz * dz;
      if (fwd < 0.5 || fwd > range) continue;
      const side = Math.abs(rx * dz - rz * dx);
      if (side < 2.6 && (!best || fwd < best.d)) best = { d: fwd };
    }
    return best;
  },

  _trafficStep(c, dt) {
    const ahead = this._carAhead(c, 9);
    const target = ahead ? Math.max(0, (ahead.d - 4.5) * 1.6) : TRAFFIC_SPEED;
    c.speed = NC.util.lerp(c.speed, Math.min(target, TRAFFIC_SPEED), Math.min(1, dt * 3));
    c.x += DX[c.dirA] * c.speed * dt;
    c.z += DZ[c.dirA] * c.speed * dt;
    const pos = DX[c.dirA] ? c.x : c.z;
    if ((c.nextI - pos) * (DX[c.dirA] || DZ[c.dirA]) <= 1.2) this._arrive(c);
    c.group.position.set(c.x, 0, c.z);
    c.group.rotation.y = c.yaw - Math.PI / 2;
  },

  _spawnTraffic(state) {
    // random road point >=45m from every local player
    for (let i = 0; i < 24; i++) {
      const along = NC.util.rand(-NC.city.EXT / 2 + 12, NC.city.EXT / 2 - 12);
      let x, z;
      if (Math.random() < 0.5) x = NC.city.ROAD_X[NC.util.randi(0, NC.city.N)], z = along;
      else z = NC.city.ROAD_Z[NC.util.randi(0, NC.city.N)], x = along;
      let ok = true;
      for (const p of state.players) {
        if (!p) continue;
        if (NC.util.dist3(x, z, p.x, p.z) < 45) { ok = false; break; }
      }
      if (!ok && i < 20) continue;
      const c = this.spawn(pickKind(), x, z, 0);
      c.ai = true; c.driver = { npc: true };
      this._snapLane(c);
      return c;
    }
    return null;
  },

  _manage(state) {
    let ai = 0;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const c = this.list[i];
      let nearest = 1e9;
      for (const p of state.players) if (p) nearest = Math.min(nearest, NC.util.dist3(c.x, c.z, p.x, p.z));
      if (c.dead && nearest > 170) {
        NC.scene.remove(c.group); this.list.splice(i, 1); continue; // haul away far wrecks
      }
      if (c.ai && !c.dead && nearest > 150) {
        // recirculate distant traffic back near the action
        NC.scene.remove(c.group); this.list.splice(i, 1);
        continue;
      }
      if (c.ai && !c.dead) ai++;
    }
    for (let i = ai; i < TRAFFIC_N; i++) this._spawnTraffic(state);
  },

  nearestCar(x, z, r, allowDriven) {
    let best = null, bd = r * r;
    for (const c of this.list) {
      if (c.dead || c.isPursuit) continue;           // pursuit cruisers stay locked
      if (c.driver && !(allowDriven && c.driver.npc)) continue;
      const d = (c.x - x) ** 2 + (c.z - z) ** 2;
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  },

  tryEnter(p) {
    const c = this.nearestCar(p.x, p.z, 3.4, true);
    if (!c) return false;
    const jacked = !!(c.driver && c.driver.npc);
    if (jacked) { c.driver = null; NC.toast('DRIVER PULLED OUT!', 1200); }
    if (c.ai || c.parked) { c.ai = false; c.parked = false; }
    c.speed = 0; c.driver = p; p.inCar = c;
    p.mesh.visible = false;
    if ((jacked || c.kind === 'police') && NC.people && NC.people.raiseWanted) {
      NC.people.raiseWanted(p, 1);
      NC.toast(jacked ? 'CARJACKING! +' : 'STOLE A POLICE CRUISER!', 1500);
    } else {
      NC.toast(kindName(c.kind).toUpperCase(), 900);
    }
    return true;
  },
  tryExit(p) {
    const c = p.inCar; if (!c) return;
    const a = c.yaw + Math.PI / 2;
    let ex = c.x + Math.sin(a) * 2.2, ez = c.z + Math.cos(a) * 2.2;
    if (NC.city.solidAt(ex, ez, 0.6)) { ex = c.x - Math.sin(a) * 2.2; ez = c.z - Math.cos(a) * 2.2; }
    p.x = ex; p.z = ez; p.inCar = null; c.driver = null;
    p.mesh.visible = true;
    p.mesh.position.set(ex, 0, ez);
    NC.camera && (NC.camera.yaw = c.yaw + Math.PI); // keep camera behind the car
  },

  damage(c, d, src) {
    c.hp -= d;
    if (c.hp <= 0 && !c.dead) {
      c.dead = true; c.ai = false;
      if (c.driver) {
        const p = c.driver;
        if (p.npc) c.driver = null;                 // npc traffic driver just dies with the car
        else { this.tryExit(p); NC.combat && NC.combat.applyPlayerDamage(p, 55); }
      }
      NC.combat && NC.combat.explode(c.x, 0.8, c.z, 5);
      c.group.visible = false;
      const w = c.group.clone(); // burnt wreck (dark)
      w.traverse(o => { if (o.material) o.material = new THREE.MeshLambertMaterial({ color: 0x14161c }); });
      NC.scene.add(w);
      setTimeout(() => { NC.scene.remove(w); }, 30000);
      NC.shake(8);
      if (src && NC.state.players.indexOf(src) >= 0)
        NC.kill((src.char || 'you') + ' totaled a ' + kindName(c.kind).toLowerCase());
    }
  },

  // arcade drive: inp.joy.x = steer, -joy.y = throttle (stick up = forward)
  drive(c, inp, dt, p) {
    if (!c || c.dead) { if (p) p.inCar = null; return; }
    const thr = NC.util.clamp(-inp.joy.y, -1, 1) * inp.joy.mag;
    const steerIn = NC.util.clamp(inp.joy.x, -1, 1);
    c.speed += thr * c.def.accel * dt;
    c.speed -= c.speed * (thr === 0 ? 0.7 : 0.25) * dt;
    c.speed = NC.util.clamp(c.speed, -c.def.top * 0.4, c.def.top);
    c.steer = NC.util.lerp(c.steer, steerIn, dt * 8);
    const spdF = Math.min(1, Math.abs(c.speed) / 6);
    c.yaw -= c.steer * spdF * Math.sign(c.speed) * dt * 1.9;
    const nx = c.x + Math.sin(c.yaw) * c.speed * dt;
    const nz = c.z + Math.cos(c.yaw) * c.speed * dt;
    if (NC.city.solidAt(nx, c.z, 1.1) || NC.city.solidAt(c.x, nz, 1.1)) {
      const impact = Math.abs(c.speed);
      c.speed *= -0.35; NC.shake(Math.min(8, 2 + impact * 0.25));
      NC.combat && NC.combat.sparkAt(c.x, 0.6, c.z);
      if (impact > 5) this.damage(c, impact * 0.55, p); // crash damage (spec: cars damage & explode)
    } else { c.x = nx; c.z = nz; }

    // car-vs-car: push apart + trade damage (wrecks still block)
    for (const o of this.list) {
      if (o === c) continue;
      const d = NC.util.dist3(c.x, c.z, o.x, o.z);
      const minD = (c.def.w + o.def.w) * 0.9;
      if (d >= minD || d < 0.01) continue;
      const a = Math.atan2(o.x - c.x, o.z - c.z);
      const overlap = (minD - d) * 0.5;
      o.x += Math.sin(a) * overlap; o.z += Math.cos(a) * overlap;
      c.x -= Math.sin(a) * overlap; c.z -= Math.cos(a) * overlap;
      const rel = Math.abs(c.speed) + Math.abs(o.speed || 0) * 0.4;
      if (rel > 4) {
        this.damage(o, rel * 0.7, p);
        this.damage(c, rel * 0.5, p);
        NC.shake(3);
        NC.combat && NC.combat.sparkAt((c.x + o.x) / 2, 0.6, (c.z + o.z) / 2);
      }
      if (c.dead) break;
      c.speed *= 0.55;
    }

    c.group.position.set(c.x, 0, c.z);
    c.group.rotation.y = c.yaw - Math.PI / 2; // mesh long axis is X; forward is (sin yaw, cos yaw)
    // run over peds
    if (Math.abs(c.speed) > 4 && NC.people) {
      for (const e of NC.people.peds || []) {
        if (e.dead) continue;
        if (NC.util.dist3(c.x, c.z, e.x, e.z) < 1.6) {
          NC.people.damage(e, 999, p); NC.shake(4); // kill credit + wanted handled in people.damage
        }
      }
      for (const e of NC.people.cops || []) {
        if (e.dead) continue;
        if (NC.util.dist3(c.x, c.z, e.x, e.z) < 1.6) {
          NC.people.damage(e, 999, p); NC.shake(4);
        }
      }
    }
  },

  init() {
    this._mgmtT = 0;
    // parked cars hugging the road edge (out of the driving lanes)
    const kinds = ['civic', 'civic', 'taxi', 'van', 'sport'];
    for (let i = 0; i < 26; i++) {
      const rx = NC.city.ROAD_X[NC.util.randi(1, NC.city.N - 1)];
      const z = NC.util.rand(-NC.city.EXT / 2 + 10, NC.city.EXT / 2 - 10);
      const lane = Math.random() < 0.5 ? -4.4 : 4.4;
      const c = this.spawn(kinds[i % kinds.length], rx + lane, z, 0); // N-S road: forward is ±Z
      c.parked = true;
    }
    for (let i = 0; i < 14; i++) {
      const rz = NC.city.ROAD_Z[NC.util.randi(1, NC.city.N - 1)];
      const x = NC.util.rand(-NC.city.EXT / 2 + 10, NC.city.EXT / 2 - 10);
      const lane = Math.random() < 0.5 ? -4.4 : 4.4;
      const c = this.spawn(kinds[(i + 2) % kinds.length], x, rz + lane, Math.PI / 2); // E-W road: forward is ±X
      c.parked = true;
    }
    // two parked police cruisers by the station — stealing one is a crime
    for (const off of [-4, 5]) {
      const c = this.spawn('police', NC.city.police.x + off, NC.city.police.z + 6, Math.PI / 2);
      c.parked = true;
    }
  },

  start(state) {
    for (let i = 0; i < TRAFFIC_N; i++) this._spawnTraffic(state);
  },

  update(dt, state) {
    if (NC.net && NC.net.isGuest && NC.net.isGuest()) return; // host drives the world
    for (const c of this.list)
      if (c.ai && !c.dead && c.driver && c.driver.npc) this._trafficStep(c, dt);
    this._mgmtT = (this._mgmtT || 0) - dt;
    if (this._mgmtT <= 0) { this._mgmtT = 0.6; this._manage(state); }
  },
});

function nearestOf(lines, v) {
  let best = lines[0], bd = Math.abs(v - lines[0]);
  for (const r of lines) { const d = Math.abs(v - r); if (d < bd) { bd = d; best = r; } }
  return best;
}
function pickKind() {
  const r = Math.random();
  return r < 0.42 ? 'civic' : r < 0.62 ? 'taxi' : r < 0.82 ? 'van' : 'sport';
}
function emisBar(w, h, d, c, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color: c }));
  m.position.set(x, y, z);
  return m;
}
function kindName(k) { return k === 'civic' ? 'CAR' : k; }
