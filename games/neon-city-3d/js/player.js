/* NEON CITY 3D — player: spawn, camera-relative movement, car drive, attack, hp/death. */
const NC = window.NC;
const U = () => NC.util;

NC.register('player', {
  spawnPlayer(p) {
    const spot = NC.city.nearestRoadTo(p.busted ? NC.city.police : (p.dead ? NC.city.hospital : { x: -30, z: 20 }));
    p.x = spot.x + 2; p.z = spot.z; p.dead = false; p.busted = false;
    p.hp = 100; p.stars = 0;
    if (p.inCar) { p.inCar.driver = null; p.inCar = null; }
    p.mesh.visible = true;
    p.mesh.position.set(p.x, 0, p.z);
    NC.camera.yaw = Math.PI * 0.75;
  },

  init(state) {
    // who am I — ?as=koto|zuza (default koto; second player joins via net)
    const as = new URLSearchParams(location.search).get('as');
    const myChar = as === 'zuza' ? 'zuza' : 'koto';
    NC.playerIdx = myChar === 'koto' ? 0 : 1;
    const mk = (char, x, z) => {
      const mesh = NC.pawn.make(char);
      mesh.position.set(x, 0, z);
      NC.scene.add(mesh);
      return {
        char, mesh, x, z, yaw: Math.PI / 2, step: 0, hp: 100, stars: 0,
        weapon: 'fist', weapons: { fist: true }, ammo: {},
        dead: false, busted: false, iatk: 0, flash: 0, inCar: null, remote: false,
      };
    };
    const me = mk(myChar, -30, 20);
    state.players[NC.playerIdx] = me;
    if (NC.playerIdx === 1) { // zuza player exists as remote placeholder until koto joins
      state.players[0] = mk('koto', -34, 24);
      state.players[0].remote = true;
      state.players[0].mesh.visible = false; // hidden until host syncs
    } else {
      state.players[1] = mk('zuza', -34, 24);
      state.players[1].remote = true;
      state.players[1].mesh.visible = false;
    }
    this.spawnPlayer(me);
    if (state.players[1 - NC.playerIdx]) {
      state.players[1 - NC.playerIdx].mesh.position.set(me.x + 2.4, 0, me.z + 1.2);
    }
  },

  update(dt, state) {
    const inp = NC.input;
    for (const p of state.players) {
      if (!p || p.remote) continue; // remote players driven by net
      if (p.dead || p.busted) { p.iatk -= dt; continue; }
      p.iatk -= dt;
      if (p.flash > 0) p.flash -= dt;
      const j = inp.joy;

      if (p.inCar) {
        NC.car.drive(p.inCar, inp, dt, p);
        // crash damage may have destroyed the car → tryExit already ran, inCar is null now
        if (p.inCar) { p.x = p.inCar.x; p.z = p.inCar.z; }
        else { p.mesh.visible = true; p.mesh.position.set(p.x, 0, p.z); }
        if (p.inCar && inp.aEdge) NC.car.tryExit(p);
      } else {
        // camera-relative move: stick up = away from camera
        if (j.mag > 0.12) {
          const camYaw = NC.state.camYaw !== undefined ? NC.state.camYaw : p.yaw;
          const a = Math.atan2(j.x, -j.y) + camYaw + Math.PI;
          const sp = 7.5 * j.mag;
          const nx = p.x + Math.sin(a) * sp * dt;
          const nz = p.z + Math.cos(a) * sp * dt;
          if (!NC.city.solidAt(nx, p.z, 0.5)) p.x = nx;
          if (!NC.city.solidAt(p.x, nz, 0.5)) p.z = nz;
          p.yaw = a;
          p.step = (p.step + dt * j.mag * 2.4) % 1;
        }
        p.mesh.position.set(p.x, 0, p.z);
        p.mesh.rotation.y = p.yaw;
        NC.pawn.anim(p.mesh, p.step, j.mag > 0.12, false);
        // A: interact / enter car
        if (inp.aEdge) {
          let used = false;
          for (const m of NC._mods) {
            if (!m.interactables) continue;
            for (const it of m.interactables(state) || []) {
              if (U().dist3(p.x, p.z, it.x, it.z) < (it.r || 3)) { it.cb(p, state); used = true; break; }
            }
            if (used) break;
          }
          if (!used) NC.car.tryEnter(p);
        }
        // B: attack — hold = autofire, aim assist toward nearest hostile
        if (inp.b && p.iatk <= 0 && NC.combat) {
          if (p.weapon === 'fist') { NC.combat.melee(p); p.iatk = 0.45; }
          else if ((p.ammo[p.weapon] || 0) > 0) {
            let best = null, bd = 1e9;
            for (const arr of [NC.people && NC.people.cops, NC.people && NC.people.peds]) {
              if (!arr) continue;
              for (const e of arr) {
                if (!e || e.dead) continue;
                const d = U().dist3(p.x, p.z, e.x, e.z);
                if (d > 55) continue;
                const a = Math.atan2(e.x - p.x, e.z - p.z);
                let da = Math.abs(NC.util.angDiff(a, p.yaw));
                if (da > 1.4) continue;
                const sc = d + da * 10;
                if (sc < bd) { bd = sc; best = e; }
              }
            }
            if (best) p.yaw = Math.atan2(best.x - p.x, best.z - p.z);
            NC.combat.fire(p, p.x, p.z, p.yaw, p.weapon);
            if (NC.net && NC.net.reportFire) NC.net.reportFire(p, p.x, p.z, p.yaw, p.weapon);
            p.iatk = NC.combat.cd(p.weapon);
            p.ammo[p.weapon]--;
            if (p.ammo[p.weapon] <= 0) p.weapon = 'fist';
          } else p.weapon = 'fist';
        }
        // C: weapon cycle
        if (inp.cEdge) {
          const order = ['fist', 'pistol', 'smg', 'rifle', 'shotgun', 'rpg'].filter((w) => p.weapons[w]);
          p.weapon = order[(order.indexOf(p.weapon) + 1) % order.length];
          NC.toast(p.weapon.toUpperCase(), 900);
        }
      }
      if (p.hp < 30 && p.stars === 0) p.hp = Math.min(30, p.hp + dt * 3);
    }
  },
});
