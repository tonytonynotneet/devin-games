/* NEON CITY 3D — car: low-poly vehicles, arcade drive physics, enter/exit, damage. */
import * as THREE from 'three';
const NC = window.NC;

const CAR_DEFS = {
  civic: { l: 3.6, w: 1.7, h: 0.9, top: 16, accel: 14, cols: [0xf43f5e, 0x22d3ee, 0xfacc15, 0xe2e8f0, 0xa855f7] },
  sport: { l: 3.9, w: 1.8, h: 0.8, top: 24, accel: 22, cols: [0xf97316, 0xff2d95, 0x22d3ee] },
  taxi: { l: 3.6, w: 1.7, h: 0.9, top: 15, accel: 13, cols: [0xfacc15] },
  van: { l: 4.1, w: 1.9, h: 1.3, top: 13, accel: 11, cols: [0x64748b, 0x94a3b8] },
  police: { l: 3.7, w: 1.75, h: 0.9, top: 21, accel: 19, cols: [0x1e3a8a] },
};

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
    mesh.rotation.y = yaw;
    NC.scene.add(mesh);
    const car = { kind, def, group: mesh, x, z, yaw, speed: 0, steer: 0, hp: 100, dead: false, driver: null };
    this.list.push(car);
    return car;
  },

  nearestCar(x, z, r) {
    let best = null, bd = r * r;
    for (const c of this.list) {
      if (c.dead || c.driver) continue;
      const d = (c.x - x) ** 2 + (c.z - z) ** 2;
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  },

  tryEnter(p) {
    const c = this.nearestCar(p.x, p.z, 3.4);
    if (!c) return false;
    p.inCar = c; c.driver = p;
    p.mesh.visible = false;
    NC.toast(kindName(c.kind).toUpperCase(), 900);
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

  damage(c, d) {
    c.hp -= d;
    if (c.hp <= 0 && !c.dead) {
      c.dead = true;
      if (c.driver) { const p = c.driver; this.tryExit(p); NC.combat && NC.combat.applyPlayerDamage(p, 55); }
      NC.combat && NC.combat.explode(c.x, 0.8, c.z, 5);
      c.group.visible = false;
      const w = c.group.clone(); // burnt wreck (dark)
      w.traverse(o => { if (o.material) o.material = new THREE.MeshLambertMaterial({ color: 0x14161c }); });
      NC.scene.add(w);
      setTimeout(() => { NC.scene.remove(w); }, 30000);
      NC.shake(8);
    }
  },

  // arcade drive: inp.joy.x = steer, -joy.y = throttle (stick up = forward)
  drive(c, inp, dt, p) {
    const U = NC.util;
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
    if (NC.city.solidAt(nx, c.z, 1.1)) { c.speed *= -0.35; NC.shake(3); NC.combat && NC.combat.sparkAt(c.x, 0.6, c.z); }
    else if (NC.city.solidAt(c.x, nz, 1.1)) { c.speed *= -0.35; NC.shake(3); }
    else { c.x = nx; c.z = nz; }
    c.group.position.set(c.x, 0, c.z);
    c.group.rotation.y = c.yaw - Math.PI / 2; // mesh long axis is X; forward is (sin yaw, cos yaw)
    // run over peds
    if (Math.abs(c.speed) > 4 && NC.people) {
      for (const e of NC.people.peds || []) {
        if (e.dead) continue;
        if (NC.util.dist3(c.x, c.z, e.x, e.z) < 1.6) {
          NC.people.damage(e, 999, p); NC.shake(4);
          NC.people.raiseWanted && NC.people.raiseWanted(p, 2);
        }
      }
      for (const e of NC.people.cops || []) {
        if (e.dead) continue;
        if (NC.util.dist3(c.x, c.z, e.x, e.z) < 1.6) {
          NC.people.damage(e, 999, p); NC.shake(4);
          NC.people.raiseWanted && NC.people.raiseWanted(p, 2);
        }
      }
    }
  },

  init() {
    // parked cars scattered on roads
    const kinds = ['civic', 'civic', 'taxi', 'van', 'sport'];
    for (let i = 0; i < 26; i++) {
      const rx = NC.city.ROAD_X[NC.util.randi(1, NC.city.N - 1)];
      const z = NC.util.rand(-NC.city.EXT / 2 + 10, NC.city.EXT / 2 - 10);
      const lane = Math.random() < 0.5 ? -3 : 3;
      this.spawn(kinds[i % kinds.length], rx + lane, z, 0); // N-S road: forward is ±Z
    }
    for (let i = 0; i < 14; i++) {
      const rz = NC.city.ROAD_Z[NC.util.randi(1, NC.city.N - 1)];
      const x = NC.util.rand(-NC.city.EXT / 2 + 10, NC.city.EXT / 2 - 10);
      const lane = Math.random() < 0.5 ? -3 : 3;
      this.spawn(kinds[(i + 2) % kinds.length], x, rz + lane, Math.PI / 2); // E-W road: forward is ±X
    }
  },
});

function emisBar(w, h, d, c, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color: c }));
  m.position.set(x, y, z);
  return m;
}
function kindName(k) { return k === 'civic' ? 'CAR' : k; }
