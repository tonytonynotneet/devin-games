/* NEON CITY 3D — people: pedestrians + entity stores (peds/cops/pcars).
   Cop/pcar spawning & pursuit lives in wanted.js. */
import * as THREE from 'three';
const NC = window.NC;
const U = () => NC.util;

const PED_N = 26;

NC.register('people', {
  peds: [], cops: [], pcars: [],

  raiseWanted(p, n) {
    if (!p || p.dead) return;
    const was = p.stars;
    p.stars = Math.min(6, p.stars + n);
    if (p.stars > was) NC.toast('★'.repeat(p.stars), 1100);
    p._wantedT = 0;
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

  damage(e, dmg, src) {
    if (!e || e.dead) return;
    e.hp -= dmg;
    if (e.hp <= 0) {
      e.dead = true;
      e.mesh.rotation.x = Math.PI / 2; // fall over
      e.mesh.position.y = 0.25;
      if (src && NC.state.players.indexOf(src) >= 0) {
        const cash = U().randi(10, 60);
        NC.state.money += cash;
        NC.kill((src.char === 'koto' ? 'koto' : 'zuza') + ' +$' + cash);
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
    this.peds.push({ mesh, x: pt.x, z: pt.z, yaw: Math.random() * 6.28, step: Math.random(), hp: 40, dead: false, tx: pt.x, tz: pt.z, panic: 0, wait: Math.random() * 3 });
  },
  init() {
    this.peds.length = 0; this.cops.length = 0; this.pcars.length = 0;
    for (let i = 0; i < PED_N; i++) this._spawnPed();
  },

  update(dt, state) {
    if (NC.net && NC.net.isGuest && NC.net.isGuest()) return;
    // ---------- peds wander ----------
    for (const e of this.peds) {
      if (e.dead) continue;
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
  },
});
