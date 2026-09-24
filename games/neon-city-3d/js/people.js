/* NEON CITY 3D — people: pedestrians + entity stores (peds/cops/pcars/loot).
   Cop/pcar spawning & pursuit lives in wanted.js. */
import * as THREE from 'three';
const NC = window.NC;
const U = () => NC.util;

const PED_N = 26;
const CORPSE_T = 14, LOOT_T = 45;

let _lootGeo = null, _lootMat = null;

NC.register('people', {
  peds: [], cops: [], pcars: [], loot: [],

  raiseWanted(p, n) {
    if (!p || p.dead || p.busted) return;
    const was = p.stars;
    p.stars = Math.min(6, Math.max(0, p.stars + n));
    if (p.stars > was) NC.toast('★'.repeat(p.stars), 1100);
    p._wantedT = 0; p._drainT = 0;
  },

  panicAt(x, z, r) {
    for (const e of this.peds) {
      if (e.dead) continue;
      if (U().dist3(x, z, e.x, e.z) < r) {
        e.panic = 6;
        const a = Math.atan2(e.x - x, e.z - z);
        e.tx = e.x + Math.sin(a) * 30; e.tz = e.z + Math.cos(a) * 30;
      }
    }
  },

  // money drop on kill — walk over to collect (spec: peds die → drop money)
  _dropLoot(x, z, amt) {
    if (!_lootGeo) {
      _lootGeo = new THREE.BoxGeometry(0.34, 0.2, 0.34);
      _lootMat = new THREE.MeshBasicMaterial({ color: 0x34d399 });
    }
    const mesh = new THREE.Mesh(_lootGeo, _lootMat);
    mesh.position.set(x, 0.5, z);
    NC.scene.add(mesh);
    this.loot.push({ x, z, amt, mesh, t: 0 });
    if (this.loot.length > 40) { const l = this.loot.shift(); NC.scene.remove(l.mesh); }
  },

  damage(e, dmg, src) {
    if (!e || e.dead) return;
    e.hp -= dmg;
    if (e.hp <= 0) {
      e.dead = true; e.deadT = 0;
      e.mesh.rotation.x = Math.PI / 2; // fall over
      e.mesh.position.y = 0.25;
      this._dropLoot(e.x, e.z, e.isCop ? U().randi(30, 90) : U().randi(10, 60));
      if (src && NC.state.players.indexOf(src) >= 0) {
        NC.kill((src.char === 'koto' ? 'koto' : 'zuza') + ' — ' + (e.isCop ? 'COP DOWN' : 'ped down'));
        this.raiseWanted(src, e.isCop ? 2 : 1);
        if (NC.missions && NC.missions.noteKill) NC.missions.noteKill(e, src);
      }
    }
  },

  hurtPlayer(p, dmg) { NC.combat.applyPlayerDamage(p, dmg); },

  _spawnPed() {
    const pt = NC.city.randomSidewalk();
    const mesh = NC.pawn.make('ped');
    // randomize jacket tint
    mesh.traverse(o => { if (o.material && o.material.color && Math.random() < 0.5) o.material = o.material.clone(); });
    mesh.position.set(pt.x, 0, pt.z);
    NC.scene.add(mesh);
    this.peds.push({ mesh, x: pt.x, z: pt.z, yaw: Math.random() * 6.28, step: Math.random(), hp: 40, dead: false, deadT: 0, tx: pt.x, tz: pt.z, panic: 0, wait: Math.random() * 3 });
  },

  init() {
    this.peds.length = 0; this.cops.length = 0; this.pcars.length = 0; this.loot.length = 0;
    this._senseT = 0;
    for (let i = 0; i < PED_N; i++) this._spawnPed();
  },

  update(dt, state) {
    if (NC.net && NC.net.isGuest && NC.net.isGuest()) return;
    // nearest live local-or-linked player to (x,z) — remote partner counts (host is authority)
    const nearPlayer = (x, z) => {
      let bd = 1e9;
      for (const p of state.players) {
        if (!p || (p.remote && !p.mesh.visible)) continue;
        bd = Math.min(bd, U().dist3(x, z, p.x, p.z));
      }
      return bd;
    };
    // ---------- peds wander ----------
    let alivePeds = 0;
    for (const e of this.peds) {
      if (e.dead) {
        e.deadT += dt;
        if (e.deadT > CORPSE_T && e.mesh) { NC.scene.remove(e.mesh); e.mesh = null; }
        continue;
      }
      alivePeds++;
      e.panic = Math.max(0, e.panic - dt);
      const dx = e.tx - e.x, dz = e.tz - e.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.6 || e.wait > 0) {
        e.wait -= dt;
        if (e.wait <= 0) {
          const pt = NC.city.randomSidewalk();
          e.tx = pt.x; e.tz = pt.z; e.wait = U().rand(0, 4);
        }
      } else {
        const sp = e.panic > 0 ? 5.2 : 1.6;
        const a = Math.atan2(dx, dz);
        let nx = e.x + Math.sin(a) * sp * dt, nz = e.z + Math.cos(a) * sp * dt;
        if (NC.city.solidAt(nx, nz, 0.4)) { e.tx = e.x + U().rand(-10, 10); e.tz = e.z + U().rand(-10, 10); }
        else { e.x = nx; e.z = nz; }
        e.yaw = a;
        e.step = (e.step + dt * sp * 0.35) % 1;
      }
      e.mesh.position.set(e.x, 0, e.z);
      e.mesh.rotation.y = e.yaw;
      NC.pawn.anim(e.mesh, e.step, true, false);
    }
    // keep the city populated (host only)
    this._spawnT = (this._spawnT || 0) - dt;
    if (alivePeds < PED_N && this._spawnT <= 0) {
      this._spawnT = 0.4;
      for (let i = 0; i < 8; i++) {
        const pt = NC.city.randomSidewalk();
        if (nearPlayer(pt.x, pt.z) > 30) {
          const mesh = NC.pawn.make('ped');
          mesh.position.set(pt.x, 0, pt.z);
          NC.scene.add(mesh);
          this.peds.push({ mesh, x: pt.x, z: pt.z, yaw: Math.random() * 6.28, step: Math.random(), hp: 40, dead: false, deadT: 0, tx: pt.x, tz: pt.z, panic: 0, wait: 0 });
          break;
        }
      }
    }
    // ---------- senses: speeding cars scare peds ----------
    this._senseT = (this._senseT || 0) - dt;
    if (this._senseT <= 0) {
      this._senseT = 0.3;
      for (const e of this.peds) {
        if (e.dead || e.panic > 0) continue;
        for (const c of NC.car.list) {
          if (c.dead || Math.abs(c.speed) < 8) continue;
          if (U().dist3(e.x, e.z, c.x, c.z) < 7) { this.panicAt(c.x, c.z, 8); break; }
        }
      }
    }
    // ---------- money loot pickups ----------
    for (let i = this.loot.length - 1; i >= 0; i--) {
      const l = this.loot[i];
      l.t += dt;
      l.mesh.rotation.y += dt * 3;
      l.mesh.position.y = 0.5 + Math.sin(l.t * 5) * 0.12;
      if (l.t > LOOT_T) { NC.scene.remove(l.mesh); this.loot.splice(i, 1); continue; }
      for (const p of state.players) {
        if (!p || p.dead || p.busted || p.inCar || (p.remote && !p.mesh.visible)) continue;
        if (U().dist3(p.x, p.z, l.x, l.z) < 1.3) {
          NC.state.money += l.amt;
          NC.toast('+$' + l.amt, 1100);
          NC.scene.remove(l.mesh); this.loot.splice(i, 1);
          break;
        }
      }
    }
  },
});
