/* NEON CITY 3D — combat: hitscan weapons w/ tracers, explosions, pickups, melee. */
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
const NC = window.NC;

const WEAPONS = {
  fist: { melee: true, dmg: 30, cd: 0.45 },
  pistol: { dmg: 34, spd: 60, cd: 0.22, ammoPickup: 60, pellets: 1, spread: 0, range: 60 },
  smg: { dmg: 22, spd: 64, cd: 0.09, ammoPickup: 120, pellets: 1, spread: 0.02, range: 60 },
  shotgun: { dmg: 16, spd: 55, cd: 0.7, ammoPickup: 24, pellets: 6, spread: 0.22, range: 34 },
  rifle: { dmg: 46, spd: 80, cd: 0.17, ammoPickup: 90, pellets: 1, spread: 0.008, range: 90 },
  rpg: { dmg: 30, spd: 26, cd: 1.1, ammoPickup: 6, pellets: 1, spread: 0, boom: 6, range: 120 },
};
const WCOLS = { pistol: 0x22d3ee, smg: 0xfacc15, shotgun: 0xff2d95, rifle: 0xa3e635, rpg: 0xf97316 };
const PICKUP_N = 14;

NC.register('combat', {
  WEAPONS,
  bullets: [], fx: [], pickups: [],

  cd: (w) => (WEAPONS[w] || WEAPONS.fist).cd,

  fire(shooter, x, z, angle, weapon) {
    const def = WEAPONS[weapon];
    if (!shooter || !def || !def.spd) return;
    const n = def.pellets || 1;
    const sx = x + Math.sin(angle) * 0.8, sz = z + Math.cos(angle) * 0.8;
    for (let i = 0; i < n; i++) {
      const a = angle + (n > 1 ? NC.util.rand(-def.spread, def.spread) : 0);
      this.bullets.push({
        x: sx, z: sz, vx: Math.sin(a) * def.spd, vz: Math.cos(a) * def.spd,
        dmg: def.dmg, owner: shooter, ttl: (def.range || 60) / def.spd, boom: def.boom || 0,
      });
    }
    this.flash(sx, 1.3, sz);
    if (NC.people) {
      if (NC.people.panicAt) NC.people.panicAt(x, z, 30);
      if (NC.state.players.indexOf(shooter) >= 0 && NC.people.raiseWanted)
        NC.people.raiseWanted(shooter, 1);
    }
  },

  melee(p) {
    this.fx.push({ kind: 'slash', x: p.x, z: p.z, t: 0, dur: 0.16 });
    const R = 2.2;
    let hit = false;
    for (const arr of [NC.people && NC.people.peds, NC.people && NC.people.cops]) {
      if (!arr) continue;
      for (const e of arr) {
        if (!e || e.dead) continue;
        if (NC.util.dist3(p.x, p.z, e.x, e.z) < R) { NC.people.damage(e, WEAPONS.fist.dmg, p); hit = true; }
      }
    }
    // fists dent cars too
    if (NC.car && NC.car.list) {
      for (const c of NC.car.list) {
        if (!c || c.dead || c === p.inCar) continue;
        if (NC.util.dist3(p.x, p.z, c.x, c.z) < R + 1) { NC.car.damage(c, 8, p); this.sparkAt(c.x, 0.6, c.z); }
      }
    }
    if (hit && NC.state.players.indexOf(p) >= 0 && NC.people.raiseWanted) NC.people.raiseWanted(p, 1);
  },

  explode(x, y, z, r) {
    const s = NC.state;
    for (const p of s.players) {
      if (!p || p.dead || p.inCar) continue;
      if (NC.util.dist3(x, z, p.x, p.z) <= r) { this.applyPlayerDamage(p, 60); }
    }
    if (NC.people && NC.people.damage) {
      for (const arr of [NC.people.peds, NC.people.cops]) {
        if (!arr) continue;
        for (const e of arr) {
          if (!e || e.dead) continue;
          if (NC.util.dist3(x, z, e.x, e.z) <= r) NC.people.damage(e, 999, null);
        }
      }
    }
    if (NC.car && NC.car.list) {
      for (const c of NC.car.list) {
        if (!c || c.dead) continue;
        if (NC.util.dist3(x, z, c.x, c.z) <= r + 1) NC.car.damage(c, 60);
      }
    }
    this.fx.push({ kind: 'boom', x, y: y || 0.8, z, t: 0, dur: 0.55, r });
    NC.shake(12);
  },

  sparkAt(x, y, z) { this.fx.push({ kind: 'spark', x, y, z, t: 0, dur: 0.18 }); },
  flash(x, y, z) { this.fx.push({ kind: 'flash', x, y, z, t: 0, dur: 0.06 }); },
  blood(x, z) { this.fx.push({ kind: 'blood', x, z, t: 0, dur: 0.4 }); },

  applyPlayerDamage(p, dmg) {
    if (!p || p.dead) return;
    p.hp -= dmg; p.flash = 0.4; NC.shake(3);
    if (p.hp <= 0) {
      p.hp = 0; p.dead = true;
      if (NC.hud && NC.hud.wasted) NC.hud.wasted(p);
      else setTimeout(() => NC.player.spawnPlayer(p), 1500);
    }
  },

  hitTest(b) {
    const s = NC.state;
    if (NC.people && NC.people.damage) {
      for (const arr of [NC.people.peds, NC.people.cops]) {
        if (!arr) continue;
        for (const e of arr) {
          if (!e || e.dead || e === b.owner) continue;
          if (NC.util.dist3(b.x, b.z, e.x, e.z) < 0.55) {
            NC.people.damage(e, b.dmg, b.owner); this.blood(e.x, e.z);
            return true;
          }
        }
      }
    }
    for (const p of s.players) {
      if (!p || p === b.owner || p.dead || p.inCar) continue;
      if (NC.util.dist3(b.x, b.z, p.x, p.z) < 0.55) {
        this.applyPlayerDamage(p, b.dmg); this.blood(p.x, p.z);
        return true;
      }
    }
    if (NC.car && NC.car.list) {
      for (const c of NC.car.list) {
        if (!c || c.dead) continue;
        if (b.owner && b.owner.inCar === c) continue;
        if (NC.util.dist3(b.x, b.z, c.x, c.z) < 1.4) {
          NC.car.damage(c, b.dmg * 0.5, b.owner); this.sparkAt(b.x, 0.6, b.z);
          return true;
        }
      }
    }
    return false;
  },

  init() {
    this.bullets.length = 0; this.fx.length = 0; this.pickups.length = 0;
    const kinds = ['pistol', 'smg', 'shotgun', 'rifle', 'rifle', 'rpg'];
    for (let i = 0; i < PICKUP_N; i++) {
      const pt = NC.city.randomSidewalk();
      this._addPickup(pt.x, pt.z, kinds[i % kinds.length]);
    }
    // pools
    this._tracerMat = new THREE.MeshBasicMaterial({ color: 0xfff4c0 });
    this._tracerGeo = new THREE.BoxGeometry(0.06, 0.06, 1.4);
    this._fxMeshes = [];
  },

  _addPickup(x, z, w) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.28, 0.2),
      new THREE.MeshBasicMaterial({ color: WCOLS[w] || 0xffffff })
    );
    m.position.set(x, 0.6, z);
    NC.scene.add(m);
    this.pickups.push({ x, z, w, mesh: m, taken: false, respawn: 0 });
  },

  update(dt, state) {
    // host-authoritative for damage, but guests still step their own tracers
    // locally so bullets fly smoothly; hitTest/explode stay host-only.
    const guest = NC.net && NC.net.isGuest && NC.net.isGuest();
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.x += b.vx * dt; b.z += b.vz * dt; b.ttl -= dt;
      let dead = false;
      if (b.ttl <= 0) dead = true;
      else if (NC.city.solidAt(b.x, b.z, 0.1)) { if (!guest && b.boom) this.explode(b.x, 0.8, b.z, b.boom); else this.sparkAt(b.x, 0.8, b.z); dead = true; }
      else if (!guest && this.hitTest(b)) { if (b.boom) this.explode(b.x, 0.8, b.z, b.boom); dead = true; }
      if (dead) { if (!guest && b.ttl <= 0 && b.boom) this.explode(b.x, 0.8, b.z, b.boom); this.bullets.splice(i, 1); }
    }
    for (const pk of this.pickups) {
      if (pk.taken) {
        pk.mesh.visible = false;
        pk.respawn -= dt;
        if (pk.respawn <= 0) { pk.taken = false; pk.mesh.visible = true; }
        continue;
      }
      pk.mesh.rotation.y += dt * 2.4;
      for (const p of state.players) {
        if (!p || p.dead || p.busted || p.inCar || p.remote) continue;
        if (NC.util.dist3(p.x, p.z, pk.x, pk.z) < 1.2) {
          pk.taken = true; pk.respawn = 75;
          p.weapons[pk.w] = true;
          p.ammo[pk.w] = (p.ammo[pk.w] || 0) + WEAPONS[pk.w].ammoPickup;
          p.weapon = pk.w;
          NC.toast('PICKED UP ' + pk.w.toUpperCase());
          break;
        }
      }
    }
    this._tickFx(dt);
  },

  _tickFx(dt) {
    // bullets as tracers — sync meshes each frame
    const S = NC.scene;
    while (this._fxMeshes.length < this.bullets.length) {
      const m = new THREE.Mesh(this._tracerGeo, this._tracerMat);
      S.add(m); this._fxMeshes.push(m);
    }
    for (let i = 0; i < this._fxMeshes.length; i++) {
      const m = this._fxMeshes[i], b = this.bullets[i];
      if (b) {
        m.visible = true; m.userData.kind = 'tracer';
        m.position.set(b.x, 1.3, b.z);
        m.rotation.y = Math.atan2(b.vx, b.vz);
      } else m.visible = false;
    }
    // fx: spawn/despawn transient meshes
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.t += dt;
      if (!f.mesh) {
        if (f.kind === 'boom') {
          f.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff7722, transparent: true, opacity: 0.9 }));
          f.mesh.position.set(f.x, f.y, f.z);
        } else if (f.kind === 'spark') {
          f.mesh = new THREE.Mesh(new THREE.SphereGeometry(0.3, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffe9a0 }));
          f.mesh.position.set(f.x, f.y, f.z);
        } else if (f.kind === 'flash') {
          f.mesh = new THREE.Mesh(new THREE.SphereGeometry(0.4, 6, 4), new THREE.MeshBasicMaterial({ color: 0xfff4c0 }));
          f.mesh.position.set(f.x, f.y, f.z);
        } else if (f.kind === 'blood') {
          f.mesh = new THREE.Mesh(new THREE.SphereGeometry(0.35, 6, 4), new THREE.MeshBasicMaterial({ color: 0xdc2626 }));
          f.mesh.position.set(f.x, 0.6, f.z);
        } else if (f.kind === 'slash') {
          f.mesh = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.08, 6, 10, Math.PI), new THREE.MeshBasicMaterial({ color: 0xffffff }));
          f.mesh.position.set(f.x, 1.1, f.z);
        }
        if (f.mesh) S.add(f.mesh);
      }
      if (f.mesh) {
        if (f.kind === 'boom') { const k = f.t / f.dur; f.mesh.scale.setScalar(0.5 + k * f.r); f.mesh.material.opacity = 0.9 * (1 - k); }
        else { f.mesh.material.opacity = Math.max(0, 1 - f.t / f.dur); f.mesh.material.transparent = true; }
      }
      if (f.t > f.dur) { if (f.mesh) { S.remove(f.mesh); } this.fx.splice(i, 1); }
    }
  },
});
