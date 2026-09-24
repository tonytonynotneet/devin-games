/* NEON CITY 3D — net: PeerJS co-op. Each side simulates its own pawn; host owns the world. */
const NC = window.NC;

NC.register('net', {
  role: null, _net: null, _snapT: 0, _sendT: 0,
  _prevDead: false, _prevBusted: false,

  isGuest() { return this.role === 'guest'; },
  connected() { return !!(this._net && this._net._conn && this._net._conn.open); },

  async init(state) {
    const as = new URLSearchParams(location.search).get('as');
    if (!as) return; // solo
    const want = as === 'koto' ? 'host' : 'guest';
    const stat = document.getElementById('netstat');
    try {
      this._net = await DGOnline.connect('neon-city-3d', want);
      this.role = want;
      stat && (stat.textContent = want === 'host' ? 'hosting — zuza can join' : 'joined koto\'s city');
      this._net.onpeer = (on) => NC.toast(on ? (want === 'host' ? 'zuza joined 💗' : 'koto joined 💗') : 'partner left', 1600);
      this._net.onmessage = (d) => this._onMsg(d, state);
    } catch (e) {
      stat && (stat.textContent = 'solo (partner offline)');
    }
  },

  _onMsg(d, state) {
    if (this.role === 'host') {
      const remote = state.players[1];
      if (!remote) return;
      if (d.type === 'state') {
        remote.x = d.x; remote.z = d.z; remote.yaw = d.yaw; remote.step = d.step || 0;
        remote.weapon = d.weapon;
        remote.mesh.visible = !d.inCar;
        remote.mesh.position.set(d.x, 0, d.z);
        remote.mesh.rotation.y = d.yaw;
        NC.pawn.anim(remote.mesh, remote.step, d.moving, d.inCar);
        if (d.inCar != null) {
          const c = NC.car.list[d.inCar];
          if (c && !c.driver) { remote.inCar = c; c.driver = remote; }
        } else if (remote.inCar) { remote.inCar.driver = null; remote.inCar = null; }
      } else if (d.type === 'act' && d.name === 'fire') {
        NC.combat.fire(remote, d.x, d.z, d.angle, d.weapon);
      } else if (d.type === 'act' && d.name === 'car') {
        const c = NC.car.list[d.idx];
        if (c) { c.x = d.x; c.z = d.z; c.yaw = d.yaw; c.speed = d.speed; c.group.position.set(c.x, 0, c.z); c.group.rotation.y = c.yaw - Math.PI / 2; }
      }
    } else {
      // guest: apply world snapshot
      if (d.type !== 'snap') return;
      const s = d;
      NC.state.money = s.money;
      // host player
      const rp = state.players[0];
      if (rp && s.p0) {
        rp.x = s.p0[0]; rp.z = s.p0[1]; rp.yaw = s.p0[2]; rp.step = s.p0[3];
        rp.hp = s.p0[4]; rp.stars = s.p0[5];
        rp.mesh.visible = s.p0[6] < 0;
        rp.mesh.position.set(rp.x, 0, rp.z); rp.mesh.rotation.y = rp.yaw;
        NC.pawn.anim(rp.mesh, rp.step, true, s.p0[6] >= 0);
        if (s.p0[6] >= 0 && NC.car.list[s.p0[6]]) { rp.inCar = NC.car.list[s.p0[6]]; rp.inCar.driver = rp; }
        else if (rp.inCar) { rp.inCar.driver = null; rp.inCar = null; }
      }
      const me = NC.me();
      if (me && s.p1) {
        me.hp = s.p1[4]; me.stars = s.p1[5];
        if (!!s.p1[7] !== this._prevDead) { this._prevDead = !!s.p1[7]; if (this._prevDead) NC.hud.wasted(me); }
        if (!!s.p1[8] !== this._prevBusted) { this._prevBusted = !!s.p1[8]; if (this._prevBusted) NC.hud.busted(me); }
      }
      // entities
      const syncEnts = (arr, snaps) => {
        for (let i = 0; i < snaps.length; i++) {
          const e = arr[i]; if (!e || !snaps[i]) continue;
          e.x = snaps[i][0]; e.z = snaps[i][1]; e.yaw = snaps[i][2];
          e.mesh.position.set(e.x, e.dead ? 0.25 : 0, e.z);
          e.mesh.rotation.y = e.yaw;
          if (!!snaps[i][3] !== e.dead) { e.dead = !!snaps[i][3]; e.mesh.rotation.x = e.dead ? Math.PI / 2 : 0; }
          NC.pawn.anim(e.mesh, e.step || 0, true, false);
        }
      };
      syncEnts(NC.people.peds, s.peds);
      syncEnts(NC.people.cops, s.cops);
      for (let i = 0; i < s.cars.length; i++) {
        const c = NC.car.list[i]; if (!c || !s.cars[i]) continue;
        const [x, z, yaw, dead, drivenByGuest] = s.cars[i];
        if (c.driver === me) continue; // guest drives own car, host mirrors it back
        c.x = x; c.z = z; c.yaw = yaw;
        if (!!dead !== c.dead) { c.dead = !!dead; c.group.visible = !dead; }
        c.group.position.set(x, 0, z); c.group.rotation.y = yaw - Math.PI / 2;
      }
      if (s.mission) NC.hud.mission(s.mission);
    }
  },

  update(dt, state) {
    if (!this._net) return;
    const me = NC.me();
    if (!me) return;
    this._sendT += dt;
    if (this._sendT < (this.role === 'host' ? 1 / 12 : 1 / 15)) return;
    this._sendT = 0;
    if (this.role === 'host') {
      const z = state.players[1];
      const p0 = me.inCar ? NC.car.list.indexOf(me.inCar) : -1;
      const p1 = z && z.inCar ? NC.car.list.indexOf(z.inCar) : -1;
      this._net.send({
        type: 'snap', money: state.money,
        p0: [me.x, me.z, me.yaw, me.step, me.hp, me.stars, p0, me.dead ? 1 : 0, me.busted ? 1 : 0],
        p1: z ? [z.x, z.z, z.yaw, z.step, z.hp, z.stars, p1, z.dead ? 1 : 0, z.busted ? 1 : 0] : null,
        peds: NC.people.peds.map(e => [Math.round(e.x * 10) / 10, Math.round(e.z * 10) / 10, Math.round(e.yaw * 100) / 100, e.dead ? 1 : 0]),
        cops: NC.people.cops.map(e => [Math.round(e.x * 10) / 10, Math.round(e.z * 10) / 10, Math.round(e.yaw * 100) / 100, e.dead ? 1 : 0]),
        cars: NC.car.list.map(c => [Math.round(c.x * 10) / 10, Math.round(c.z * 10) / 10, Math.round(c.yaw * 100) / 100, c.dead ? 1 : 0]),
        mission: NC.missions.current(),
      });
    } else {
      this._net.send({
        type: 'state', x: me.x, z: me.z, yaw: me.yaw, step: me.step,
        weapon: me.weapon, moving: NC.input.joy.mag > 0.12,
        inCar: me.inCar ? NC.car.list.indexOf(me.inCar) : null,
      });
      if (me.inCar) {
        const i = NC.car.list.indexOf(me.inCar), c = me.inCar;
        this._net.send({ type: 'act', name: 'car', idx: i, x: c.x, z: c.z, yaw: c.yaw, speed: c.speed });
      }
    }
  },

  // guest reports a shot to the host
  reportFire(p, x, z, angle, weapon) {
    if (this.role === 'guest' && this.connected())
      this._net.send({ type: 'act', name: 'fire', x, z, angle, weapon });
  },
});
