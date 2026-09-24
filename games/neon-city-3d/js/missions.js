/* NEON CITY 3D — missions: fixer NPC + 6 mission types + glowing beacon markers. */
import * as THREE from 'three';
const NC = window.NC;
const U = () => NC.util;

const TYPES = ['delivery', 'taxi', 'rampage', 'getaway', 'race', 'codate'];

NC.register('missions', {
  cur: null, _markerMeshes: [], _fixerMesh: null, _guestMarkers: null, _guestObj: null, lastType: null,

  current() {
    const c = this.cur;
    if (!c) return this._guestObj || 'Find the ★ fixer for work';
    return c.objective;
  },
  markers() {
    const guest = NC.net && NC.net.isGuest && NC.net.isGuest();
    if (guest) return this._guestMarkers || [];
    const out = this._fixerMesh && !this.cur ? [{ x: NC.city.fixer.x, z: NC.city.fixer.z }] : [];
    if (this.cur) for (const m of this.cur.markers) out.push(m);
    return out;
  },

  // any live, linked player at a marker (needCar → driving counts via car pos)
  _playerAt(m, needCar, r) {
    for (const p of NC.state.players) {
      if (!p || p.dead || p.busted || (p.remote && !p.mesh.visible)) continue;
      if (needCar && !p.inCar) continue;
      const px = p.inCar ? p.inCar.x : p.x, pz = p.inCar ? p.inCar.z : p.z;
      if (U().dist3(px, pz, m.x, m.z) < (r || 4)) return p;
    }
    return null;
  },

  begin(p, forceType) {
    if (this.cur) { NC.toast('Finish the current job first', 1600); return; }
    if (!p || p.dead || p.busted || (p.missionCD || 0) > 0) return;
    const pool = TYPES.filter(t => t !== this.lastType);
    const type = forceType || pool[(Math.random() * pool.length) | 0];
    this.lastType = type;
    p.missionCD = 3;
    const mk = (x, z) => ({ x, z });
    const road = () => { const i = U().randi(1, NC.city.N - 1); return { x: NC.city.ROAD_X[i], z: U().rand(-NC.city.EXT / 2 + 30, NC.city.EXT / 2 - 30) }; };
    let cur = null;
    if (type === 'delivery') {
      const a = road(), b = road();
      cur = { type, step: 0, markers: [mk(a.x, a.z)], data: { drop: b }, timer: 75, objective: 'DELIVERY — reach the pickup point', payout: 300 + U().randi(0, 200) };
    } else if (type === 'taxi') {
      const a = NC.city.randomSidewalk(), b = NC.city.randomSidewalk();
      cur = { type, step: 0, markers: [mk(a.x, a.z)], data: { drop: b }, objective: 'TAXI — pick up the fare', payout: 250 + U().randi(0, 150) };
    } else if (type === 'rampage') {
      cur = { type, step: 0, markers: [], data: { kills: 0, need: 5 }, timer: 75, objective: 'RAMPAGE — cause chaos! (5 takedowns)', payout: 500 };
    } else if (type === 'getaway') {
      cur = { type, step: 0, markers: [], timer: 45, objective: 'GETAWAY — survive & lose all ☆ before time runs out', payout: 400 };
      NC.people.raiseWanted(p, 3);
    } else if (type === 'race') {
      const cps = [];
      for (let i = 0; i < 4; i++) { const r = road(); cps.push(mk(r.x, r.z)); }
      cur = { type, step: 0, markers: [cps[0]], data: { cps }, timer: 90, objective: 'RACE — hit the checkpoint', payout: 450 };
      NC.toast('GET IN A CAR!', 1500);
    } else if (type === 'codate') {
      const a = NC.city.randomSidewalk(), b = NC.city.randomSidewalk();
      cur = { type, step: 0, markers: [mk(a.x, a.z), mk(b.x, b.z)], data: { a: mk(a.x, a.z), b: mk(b.x, b.z), aOk: false, bOk: false }, objective: 'DATE — both of you reach your spots 💗', payout: 600 };
    }
    if (cur) { this.cur = cur; NC.toast('MISSION: ' + cur.objective, 2200); NC.hud.mission(cur.objective); }
  },

  _pay(p, c) {
    NC.state.money += c.payout;
    NC.toast('MISSION CLEAR +$' + c.payout, 2400);
    NC.hud.mission('');
    this.cur = null;
    for (const pl of NC.state.players) if (pl) pl.missionCD = Math.max(pl.missionCD || 0, 3);
  },
  _fail(msg) {
    NC.toast(msg || 'MISSION FAILED', 1800);
    NC.hud.mission('');
    this.cur = null;
    for (const pl of NC.state.players) if (pl) pl.missionCD = Math.max(pl.missionCD || 0, 3);
  },

  noteKill(e, src) {
    if (this.cur && this.cur.type === 'rampage' && src && NC.state.players.indexOf(src) >= 0)
      this.cur.data.kills++;
  },

  interactables() {
    const guest = NC.net && NC.net.isGuest && NC.net.isGuest();
    if (guest) {
      // host is authoritative: ask it to start a job for us
      return [{ x: NC.city.fixer.x, z: NC.city.fixer.z, r: 3, cb: () => NC.net.act && NC.net.act('mission-start') }];
    }
    return this.cur ? [] : [{ x: NC.city.fixer.x, z: NC.city.fixer.z, r: 3, cb: (p) => this.begin(p) }];
  },

  // host-side handler for a guest's mission-start request
  remoteAction(name, remote) {
    if (name !== 'mission-start') return false;
    if (!remote) return false;
    if (U().dist3(remote.x, remote.z, NC.city.fixer.x, NC.city.fixer.z) < 40) this.begin(remote);
    return true;
  },

  init() {
    // fixer beacon: golden pillar + marker pawn
    const fm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.9, 0.9, 30, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.18, side: THREE.DoubleSide })
    );
    fm.position.set(NC.city.fixer.x, 15, NC.city.fixer.z);
    NC.scene.add(fm);
    const fp = NC.pawn.make('ped');
    fp.position.set(NC.city.fixer.x, 0, NC.city.fixer.z);
    fp.traverse(o => { if (o.material && o.material.emissive) { o.material = o.material.clone(); } });
    NC.scene.add(fp);
    this._fixerMesh = fm;
  },

  _syncMarkers(list) {
    // keep one beacon mesh per active marker
    const ms = list || (this.cur ? this.cur.markers : []);
    const want = ms.length;
    while (this._markerMeshes.length < want) {
      const m = new THREE.Mesh(
        new THREE.CylinderGeometry(0.9, 0.9, 26, 12, 1, true),
        new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.22, side: THREE.DoubleSide })
      );
      NC.scene.add(m); this._markerMeshes.push(m);
    }
    for (let i = 0; i < this._markerMeshes.length; i++) {
      const mm = this._markerMeshes[i];
      if (i < want) { mm.visible = true; mm.position.set(ms[i].x, 13, ms[i].z); }
      else mm.visible = false;
    }
  },

  update(dt, state) {
    const guest = NC.net && NC.net.isGuest && NC.net.isGuest();
    if (guest) { this._syncMarkers(this._guestMarkers || []); return; }
    for (const p of state.players) if (p) p.missionCD = Math.max(0, (p.missionCD || 0) - dt);
    const c = this.cur;
    if (!c) { this._syncMarkers(); return; }
    this._syncMarkers();
    const p = NC.me();
    if (!p) return; // players not spawned yet — never crash (spec: no null-me crash)
    if (c.timer !== undefined && c.timer !== null) {
      c.timer -= dt;
      if (c.timer <= 0) { this._fail('OUT OF TIME'); return; }
    }
    // dying (or getting busted on getaway) fails the job — same as 2D
    for (const pl of state.players) if (pl && pl.dead) { this._fail('MISSION FAILED — you died'); return; }
    if (c.type === 'delivery') {
      const hit = this._playerAt(c.markers[0], false, 4);
      if (!hit) return;
      if (c.step === 0) {
        c.step = 1;
        c.markers = [c.data.drop];
        c.objective = 'DELIVERY — drop it off';
        NC.hud.mission(c.objective); NC.toast(c.objective, 1600);
      } else this._pay(hit, c);
    } else if (c.type === 'taxi') {
      if (c.step === 0) {
        const hit = this._playerAt(c.markers[0], true, 6); // must drive up in a car
        if (hit) {
          c.step = 1;
          c.markers = [c.data.drop];
          c.objective = 'TAXI — drive them to the marker';
          NC.hud.mission(c.objective); NC.toast('Fare aboard — drive!', 1600);
        }
      } else {
        for (const pl of state.players) if (pl && pl.inCar && pl.inCar.dead) { this._fail('MISSION FAILED — the fare is toast'); return; }
        const hit = this._playerAt(c.markers[0], false, 6);
        if (hit) this._pay(hit, c);
      }
    } else if (c.type === 'rampage') {
      c.objective = `RAMPAGE — chaos! (${c.data.kills}/${c.data.need})`;
      NC.hud.mission(c.objective);
      if (c.data.kills >= c.data.need) this._pay(p, c);
    } else if (c.type === 'getaway') {
      if (p.busted) { this._fail('MISSION FAILED — BUSTED'); return; }
      c.data.zeroT = (p.stars === 0) ? (c.data.zeroT || 0) + dt : 0;
      if (c.data.zeroT >= 2) this._pay(p, c);
    } else if (c.type === 'race') {
      const hit = this._playerAt(c.markers[0], true, 6); // checkpoints only count in a car
      if (hit) {
        c.step++;
        if (c.step >= c.data.cps.length) { this._pay(hit, c); return; }
        c.markers = [c.data.cps[c.step]];
        c.timer += 20;
        c.objective = `RACE — checkpoint ${c.step + 1}/4`;
        NC.hud.mission(c.objective); NC.toast('CHECKPOINT!', 900);
      }
    } else if (c.type === 'codate') {
      for (const pl of state.players) {
        if (!pl || pl.dead || (pl.remote && !pl.mesh.visible)) continue;
        const ix = pl.inCar ? pl.inCar.x : pl.x, iz = pl.inCar ? pl.inCar.z : pl.z;
        if (pl.char === 'koto' && U().dist3(ix, iz, c.data.a.x, c.data.a.z) < 3.5) c.data.aOk = true;
        if (pl.char === 'zuza' && U().dist3(ix, iz, c.data.b.x, c.data.b.z) < 3.5) c.data.bOk = true;
      }
      c.objective = `DATE — koto ${c.data.aOk ? '✓' : '→A'} · zuza ${c.data.bOk ? '✓' : '→B'} 💗`;
      NC.hud.mission(c.objective);
      if (c.data.aOk && c.data.bOk) this._pay(p, c);
    }
  },
});
