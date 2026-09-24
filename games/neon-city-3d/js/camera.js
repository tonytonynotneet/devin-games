/* NEON CITY 3D — camera: third-person follow, right-drag orbit, obstruction pull-in. */
import * as THREE from 'three';
const NC = window.NC;

NC.register('camera', {
  yaw: Math.PI,       // world angle camera sits behind player (0 = +z)
  pitch: 0.42,
  dist: 5.2,
  _t: new THREE.Vector3(),

  init() { this._ray = new THREE.Raycaster(); },

  update(dt) {
    const cam = NC.cam, inp = NC.input, me = NC.me();
    if (!me) return;
    // consume drag deltas
    const c = inp.cam;
    if (c.dx || c.dy) {
      this.yaw -= c.dx * 0.008;
      this.pitch = NC.util.clamp(this.pitch + c.dy * 0.006, 0.12, 1.1);
      c.dx = c.dy = 0;
    }
    const inCar = me.inCar;
    const dist = inCar ? 8.5 : 5.2;
    const hgt = inCar ? 4.4 : 2.6;
    this.dist = NC.util.lerp(this.dist, dist, dt * 5);
    const ty = inCar ? me.inCar.group.position : me.mesh.position;
    const px = inCar ? me.inCar.group.position.x : me.x;
    const pz = inCar ? me.inCar.group.position.z : me.z;
    const py = (inCar ? me.inCar.group.position.y : 1.2) + 0.6;

    const cy = Math.sin(this.pitch) * this.dist;
    const ch = Math.cos(this.pitch) * this.dist;
    const tx = px + Math.sin(this.yaw) * ch;
    const tz = pz + Math.cos(this.yaw) * ch;
    // pull camera in if a building blocks the boom (cheap: probe at 40/80%)
    let k = 1;
    for (const f of [0.4, 0.7, 1.0]) {
      const sx = px + (tx - px) * f, sz = pz + (tz - pz) * f, sy = py + (cy + hgt - py) * f;
      if (NC.city.solidAt(sx, sz, 0.3) && sy < 12) { k = Math.min(k, f * 0.82); }
    }
    const fx = px + (tx - px) * k, fz = pz + (tz - pz) * k;
    const fy = py + (cy + hgt - py) * k;
    cam.position.x = NC.util.lerp(cam.position.x, fx, Math.min(1, dt * 10));
    cam.position.y = NC.util.lerp(cam.position.y, fy, Math.min(1, dt * 10));
    cam.position.z = NC.util.lerp(cam.position.z, fz, Math.min(1, dt * 10));
    cam.lookAt(px, py, pz);
    // expose aim yaw (camera facing direction on ground plane)
    NC.state.camYaw = this.yaw + Math.PI;
  },
});
