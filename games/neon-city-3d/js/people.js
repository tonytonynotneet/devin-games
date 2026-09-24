/* NEON CITY 3D — people: pedestrians, cops, police cars, wanted level, busted. */
import * as THREE from 'three';
const NC = window.NC;
const U = () => NC.util;

const PED_N = 26;
const COP_CAP = [0, 2, 4, 6, 9, 12, 16];
const PCAR_CAP = [0, 0, 0, 1, 2, 3, 4];
const BUSTED_R = 2.2, BUSTED_T = 1.4;
const COP_SHOOT_R = 26, SEE_R = 45;   // cop gun range / "can see you" radius for decay
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

  _copNear(p, r) {
    for (const c of this.cops) if (!c.dead && U().dist3(c.x, c.z, p.x, p.z) < r) return true;
    for (const c of this.pcars) if (!c.dead && U().dist3(c.x, c.z, p.x, p.z) < r) return true;
    return false;
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
  _spawnCop(t) {
    // spawn at a road point 20-40m away from target
    const a = Math.random() * Math.PI * 2, d = 20 + Math.random() * 20;
    let x = t.x + Math.sin(a) * d, z = t.z + Math.cos(a) * d;
    const r = NC.city.nearestRoadTo(x, z); x = r.x; z = r.z;
    const mesh = NC.pawn.make('cop');
    mesh.position.set(x, 0, z);
    NC.scene.add(mesh);
    this.cops.push({ mesh, x, z, yaw: 0, step: 0, hp: 80, dead: false, deadT: 0, isCop: true, atk: 0, fireCD: 0.6 + Math.random() * 0.8 });
  },
  _spawnPcar(t) {
    const a = Math.random() * Math.PI * 2;
    const x = t.x + Math.sin(a) * 34, z = t.z + Math.cos(a) * 34;
    const r = NC.city.nearestRoadTo(x, z);
    const c = NC.car.spawn('police', r.x, r.z, Math.random() * 6.28);
    c.isPursuit = true;
    this.pcars.push(c);
  },

  init() {
    this.peds.length = 0; this.cops.length = 0; this.pcars.length = 0; this.loot.length = 0;
    this._senseT = 0;
    for (let i = 0; i < PED_N; i++) this._spawnPed();
  },

  update(dt, state) {
    if (NC.net && NC.net.isGuest && NC.net.isGuest()) return;
    const me = NC.me();
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
    // ---------- wanted per player (decays only while unseen by law) ----------
    let maxStars = 0;
    for (const p of state.players) {
      if (!p || (p.remote && !p.mesh.visible) || p.dead || p.busted) continue;
      if (p.stars > 0) {
        if (this._copNear(p, SEE_R)) { p._wantedT = 0; p._drainT = 0; }
        else {
          p._wantedT = (p._wantedT || 0) + dt;
          if (p._wantedT > 6) {
            p._drainT = (p._drainT || 0) + dt;
            if (p._drainT >= 3) {
              p._drainT = 0;
              p.stars = Math.max(0, p.stars - 1);
              if (p.stars === 0) NC.toast('Wanted level cleared', 1600);
            }
          }
        }
      }
      maxStars = Math.max(maxStars, p.stars);
    }
    // ---------- cop spawning ----------
    const cap = COP_CAP[maxStars], pcap = PCAR_CAP[maxStars];
    if (me && maxStars > 0) {
      const target = [...state.players].filter(p => p && !(p.remote && !p.mesh.visible) && !p.dead && p.stars === maxStars)[0] || me;
      while (this.cops.filter(c => !c.dead).length < cap) this._spawnCop(target);
      while (this.pcars.filter(c => !c.dead).length < pcap) this._spawnPcar(target);
    }
    // despawn surplus/far cops
    for (let i = this.cops.length - 1; i >= 0; i--) {
      const c = this.cops[i];
      if (c.dead && c.deadT > 8) { NC.scene.remove(c.mesh); this.cops.splice(i, 1); continue; }
      if (c.dead) c.deadT = (c.deadT || 0) + dt;
      if (me && U().dist3(c.x, c.z, me.x, me.z) > 120) { NC.scene.remove(c.mesh); this.cops.splice(i, 1); }
    }
    for (let i = this.pcars.length - 1; i >= 0; i--) {
      const c = this.pcars[i];
      if (c.dead || (me && U().dist3(c.x, c.z, me.x, me.z) > 130)) {
        c.group.visible = false; c.dead = true; this.pcars.splice(i, 1);
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
    // ---------- cop pursuit ----------
    for (const c of this.cops) {
      if (c.dead) continue;
      // nearest wanted player (remote partner included — host applies for both)
      let tgt = null, bd = 1e9;
      for (const p of state.players) {
        if (!p || (p.remote && !p.mesh.visible) || p.dead || p.busted || p.stars <= 0) continue;
        const d = U().dist3(c.x, c.z, p.x, p.z);
        if (d < bd) { bd = d; tgt = p; }
      }
      if (!tgt) { NC.pawn.anim(c.mesh, c.step, false, false); continue; }
      const a = Math.atan2(tgt.x - c.x, tgt.z - c.z);
      c.yaw = a;
      if (bd > BUSTED_R || tgt.inCar) {
        const sp = 5.6;
        const nx = c.x + Math.sin(a) * sp * dt, nz = c.z + Math.cos(a) * sp * dt;
        if (!NC.city.solidAt(nx, nz, 0.4)) { c.x = nx; c.z = nz; }
        else { c.x += Math.cos(a) * sp * dt; c.z -= Math.sin(a) * sp * dt; } // slide around obstacle
        c.step = (c.step + dt * 2.2) % 1;
        c.bustT = 0;
      } else {
        c.bustT = (c.bustT || 0) + dt;
        c.atk = (c.atk || 0) + dt;
        if (c.atk > 0.8) { c.atk = 0; this.hurtPlayer(tgt, 8); }
        if (c.bustT > BUSTED_T) { tgt.busted = true; NC.hud.busted(tgt); }
      }
      // armed cops shoot from range once you're at 2★ (spec: they shoot you)
      c.fireCD -= dt;
      if (tgt.stars >= 2 && !tgt.inCar && bd > 4 && bd < COP_SHOOT_R && c.fireCD <= 0 && NC.combat) {
        c.fireCD = 0.9 + Math.random() * 0.5;
        NC.combat.fire(c, c.x, c.z, a + (Math.random() - 0.5) * 0.22, 'pistol');
      }
      c.mesh.position.set(c.x, 0, c.z);
      c.mesh.rotation.y = c.yaw;
      NC.pawn.anim(c.mesh, c.step, bd > BUSTED_R, false);
    }
    // ---------- police car pursuit ----------
    for (const c of this.pcars) {
      if (c.dead) continue;
      let tgt = null, bd = 1e9;
      for (const p of state.players) {
        if (!p || (p.remote && !p.mesh.visible) || p.dead || p.busted || p.stars <= 0) continue;
        const d = U().dist3(c.x, c.z, p.x, p.z);
        if (d < bd) { bd = d; tgt = p; }
      }
      if (!tgt) continue;
      const a = Math.atan2(tgt.x - c.x, tgt.z - c.z);
      const da = NC.util.angDiff(a, c.yaw);
      c.yaw += NC.util.clamp(da, -1, 1) * dt * 2.2;
      const sp = bd > 6 ? 14 : 7;
      const nx = c.x + Math.sin(c.yaw) * sp * dt, nz = c.z + Math.cos(c.yaw) * sp * dt;
      if (!NC.city.solidAt(nx, nz, 1.1)) { c.x = nx; c.z = nz; }
      else c.yaw += dt * 1.5;
      c.group.position.set(c.x, 0, c.z);
      c.group.rotation.y = c.yaw - Math.PI / 2;
      c.speed = sp;
      // ram damage
      if (bd < 2.4 && !tgt.inCar) { this.hurtPlayer(tgt, 14); }
      if (tgt.inCar && bd < 4.2) { NC.car.damage(tgt.inCar, 10, null); NC.shake(3); }
      // spawn foot cop near the car sometimes
      if (Math.random() < dt * 0.4 && this.cops.filter(c2 => !c2.dead).length < cap) this._spawnCop(c);
    }
  },
});
