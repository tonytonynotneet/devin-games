/* NEON CITY 3D — wanted: star decay (unseen), cop/police-car spawns, pursuit, BUSTED.
   Entity arrays live on NC.people (cops, pcars) — this module runs their AI. */
const NC = window.NC;
const U = () => NC.util;

const COP_CAP = [0, 2, 4, 6, 9, 12, 16];
const PCAR_CAP = [0, 0, 0, 1, 2, 3, 4];
const BUSTED_R = 2.2, BUSTED_T = 1.4;
const COP_SHOOT_R = 26, SEE_R = 45;   // cop gun range / "can see you" radius for decay

NC.register('wanted', {
  _copNear(p, r) {
    for (const c of NC.people.cops) if (!c.dead && U().dist3(c.x, c.z, p.x, p.z) < r) return true;
    for (const c of NC.people.pcars) if (!c.dead && U().dist3(c.x, c.z, p.x, p.z) < r) return true;
    return false;
  },
  _spawnCop(t) {
    // spawn at a road point 20-40m away from target
    const a = Math.random() * Math.PI * 2, d = 20 + Math.random() * 20;
    let x = t.x + Math.sin(a) * d, z = t.z + Math.cos(a) * d;
    const r = NC.city.nearestRoadTo(x, z); x = r.x; z = r.z;
    const mesh = NC.pawn.make('cop');
    mesh.position.set(x, 0, z);
    NC.scene.add(mesh);
    NC.people.cops.push({ mesh, x, z, yaw: 0, step: 0, hp: 80, dead: false, deadT: 0, isCop: true, atk: 0, fireCD: 0.6 + Math.random() * 0.8 });
  },
  _spawnPcar(t) {
    const a = Math.random() * Math.PI * 2;
    const x = t.x + Math.sin(a) * 34, z = t.z + Math.cos(a) * 34;
    const r = NC.city.nearestRoadTo(x, z);
    const c = NC.car.spawn('police', r.x, r.z, Math.random() * 6.28);
    c.isPursuit = true;
    NC.people.pcars.push(c);
  },

  update(dt, state) {
    if (NC.net && NC.net.isGuest && NC.net.isGuest()) return;
    const me = NC.me();
    const cops = NC.people.cops, pcars = NC.people.pcars;
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
      while (cops.filter(c => !c.dead).length < cap) this._spawnCop(target);
      while (pcars.filter(c => !c.dead).length < pcap) this._spawnPcar(target);
    }
    // despawn surplus/far cops
    for (let i = cops.length - 1; i >= 0; i--) {
      const c = cops[i];
      if (c.dead && c.deadT > 8) { NC.scene.remove(c.mesh); cops.splice(i, 1); continue; }
      if (c.dead) c.deadT = (c.deadT || 0) + dt;
      if (me && U().dist3(c.x, c.z, me.x, me.z) > 120) { NC.scene.remove(c.mesh); cops.splice(i, 1); }
    }
    for (let i = pcars.length - 1; i >= 0; i--) {
      const c = pcars[i];
      if (c.dead || (me && U().dist3(c.x, c.z, me.x, me.z) > 130)) {
        c.group.visible = false; c.dead = true; pcars.splice(i, 1);
      }
    }
    // ---------- cop pursuit ----------
    for (const c of cops) {
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
        if (c.atk > 0.8) { c.atk = 0; NC.people.hurtPlayer(tgt, 8); }
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
      NC.pawn.anim(c.mesh, c.step, bd > BUSTED_R || !!tgt.inCar, false);
    }
    // ---------- police car pursuit ----------
    for (const c of pcars) {
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
      if (bd < 2.4 && !tgt.inCar) { NC.people.hurtPlayer(tgt, 14); }
      if (tgt.inCar && bd < 4.2) { NC.car.damage(tgt.inCar, 10, null); NC.shake(3); }
      // spawn foot cop near the car sometimes
      if (Math.random() < dt * 0.4 && cops.filter(c2 => !c2.dead).length < cap) this._spawnCop(c);
    }
  },
});
