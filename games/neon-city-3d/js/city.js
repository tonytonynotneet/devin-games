/* NEON CITY 3D — city: procedural neon metropolis, collision, roads, POIs. */
import * as THREE from 'three';
const NC = window.NC;
const U = () => NC.util;

const BLOCK = 34, ROAD = 12, PITCH = BLOCK + ROAD, N = 9;
const EXT = N * PITCH + ROAD; // total span; roads centered at -EXT/2 + k*PITCH
const ROAD_X = [], ROAD_Z = [];
for (let k = 0; k <= N; k++) { ROAD_X.push(-EXT / 2 + k * PITCH); ROAD_Z.push(-EXT / 2 + k * PITCH); }

NC.register('city', {
  PITCH, EXT, BLOCK, ROAD, ROAD_X, ROAD_Z, N,
  solids: [],
  buildings: [],
  hospital: { x: 0, z: 0 },
  police: { x: 0, z: 0 },
  fixer: { x: 0, z: 0 },

  roadLines(axis) { return axis === 'x' ? ROAD_X : ROAD_Z; },

  isRoad(x, z) {
    for (const r of ROAD_X) if (Math.abs(x - r) < ROAD / 2) return true;
    for (const r of ROAD_Z) if (Math.abs(z - r) < ROAD / 2) return true;
    return false;
  },
  solidAt(x, z, r = 0.6) {
    if (Math.abs(x) > EXT / 2 || Math.abs(z) > EXT / 2) return true; // city edge wall
    for (const s of this.solids)
      if (x > s.x - s.hw - r && x < s.x + s.hw + r && z > s.z - s.hd - r && z < s.z + s.hd + r) return true;
    return false;
  },
  // first free point stepping out from (x,z) toward a road — accepts (x,z) or {x,z}
  nearestRoadTo(a, b) {
    const x = typeof a === 'object' ? a.x : a;
    const z = typeof a === 'object' ? a.z : b;
    let bx = 1e9, bz = 1e9, dx = 0, dz = 0;
    for (const r of ROAD_X) { const d = Math.abs(x - r); if (d < bx) { bx = d; dx = r; } }
    for (const r of ROAD_Z) { const d = Math.abs(z - r); if (d < bz) { bz = d; dz = r; } }
    return bx < bz ? { x: dx, z } : { x, z: dz };
  },
  randomSidewalk() {
    for (let i = 0; i < 40; i++) {
      const bx = U().randi(0, N - 1), bz = U().randi(0, N - 1);
      const cx = -EXT / 2 + bx * PITCH + PITCH / 2, cz = -EXT / 2 + bz * PITCH + PITCH / 2;
      const side = U().randi(0, 3);
      const off = BLOCK / 2 + 1.5 + U().rand(0, ROAD / 2 - 2.5);
      const along = U().rand(-BLOCK / 2 + 2, BLOCK / 2 - 2);
      const x = side === 0 ? cx + along : side === 1 ? cx + along : side === 2 ? cx - off : cx + off;
      const z = side === 0 ? cz - off : side === 1 ? cz + off : cz + along;
      if (!this.solidAt(x, z, 0.8)) return { x, z };
    }
    return { x: 0, z: ROAD_Z[0] };
  },
  blockCenter(bx, bz) { return { x: -EXT / 2 + bx * PITCH + PITCH / 2, z: -EXT / 2 + bz * PITCH + PITCH / 2 }; },

  init() {
    const S = NC.scene;
    // ---------- ground + roads ----------
    const gnd = new THREE.Mesh(
      new THREE.PlaneGeometry(EXT + 300, EXT + 300),
      new THREE.MeshLambertMaterial({ color: 0x0a1024 })
    );
    gnd.rotation.x = -Math.PI / 2; S.add(gnd);

    const roadMat = new THREE.MeshLambertMaterial({ color: 0x1b2340 });
    const laneMat = new THREE.MeshBasicMaterial({ color: 0x37436e });
    const lineMat = new THREE.MeshBasicMaterial({ color: 0x4a578e });
    for (const rx of ROAD_X) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(ROAD, EXT + ROAD), roadMat);
      m.rotation.x = -Math.PI / 2; m.position.set(rx, 0.02, 0); S.add(m);
      // center dashes
      for (let z = -EXT / 2; z < EXT / 2; z += 6) {
        const d = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 2.4), lineMat);
        d.rotation.x = -Math.PI / 2; d.position.set(rx, 0.04, z + 1.2); S.add(d);
      }
    }
    for (const rz of ROAD_Z) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(EXT + ROAD, ROAD), roadMat);
      m.rotation.x = -Math.PI / 2; m.position.set(0, 0.02, rz); S.add(m);
    }

    // ---------- window texture ----------
    const wc = document.createElement('canvas'); wc.width = wc.height = 96;
    const wg = wc.getContext('2d');
    wg.fillStyle = '#0a0d18'; wg.fillRect(0, 0, 96, 96);
    const cols = ['#22d3ee', '#ff2d95', '#facc15', '#a855f7', '#7dd3fc', '#0f1320'];
    for (let y = 4; y < 92; y += 10) for (let x = 4; x < 92; x += 8) {
      wg.fillStyle = Math.random() < 0.42 ? cols[(Math.random() * 6) | 0] : '#0f1320';
      wg.fillRect(x, y, 5, 6);
    }
    const winTex = new THREE.CanvasTexture(wc);
    winTex.wrapS = winTex.wrapT = THREE.RepeatWrapping;

    // ---------- buildings ----------
    const signCols = [0xff2d95, 0x22d3ee, 0xfacc15, 0xa855f7];
    const tintCols = [0x0d1120, 0x101527, 0x0b0f1e, 0x121a33, 0x0f1424];
    const paras = [], ledges = [];
    const rng = (a, b) => a + Math.random() * (b - a);
    for (let bx = 0; bx < N; bx++) for (let bz = 0; bz < N; bz++) {
      const c = this.blockCenter(bx, bz);
      // sidewalk rim
      const sw = new THREE.Mesh(
        new THREE.BoxGeometry(BLOCK + 6, 0.5, BLOCK + 6),
        new THREE.MeshLambertMaterial({ color: 0x1f2847 })
      );
      sw.position.set(c.x, 0.25, c.z); S.add(sw);
      if ((bx + bz) % 9 === 4) continue; // ~1/9 blocks = empty lot
      const h = rng(12, 46);
      const w = rng(24, 30), d = rng(24, 30);
      const tex = winTex.clone();
      tex.needsUpdate = true;
      tex.repeat.set(Math.max(1, Math.round(w / 8)), Math.max(2, Math.round(h / 8)));
      const tint = tintCols[(Math.random() * tintCols.length) | 0];
      const bld = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        new THREE.MeshLambertMaterial({ color: tint, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: rng(0.55, 1.3) })
      );
      bld.position.set(c.x, h / 2, c.z); S.add(bld);
      this.solids.push({ x: c.x, z: c.z, hw: w / 2, hd: d / 2 });
      this.buildings.push({ x: c.x, z: c.z, w, d, h });
      // parapet band on a subset + an occasional mid ledge — breaks the uniform silhouette
      if (Math.random() < 0.45) paras.push([c.x, h - 0.4, c.z, w + 0.9, d + 0.9]);
      if (h > 26 && Math.random() < 0.35) ledges.push([c.x, h * rng(0.4, 0.7), c.z, w + 0.5, d + 0.5]);
      // rooftop glow trim
      const trim = new THREE.Mesh(
        new THREE.BoxGeometry(w + 0.4, 0.5, d + 0.4),
        new THREE.MeshBasicMaterial({ color: signCols[(Math.random() * 4) | 0] })
      );
      trim.position.set(c.x, h + 0.25, c.z); S.add(trim);
      // vertical neon sign strip on some
      if (Math.random() < 0.4) {
        const sign = new THREE.Mesh(
          new THREE.BoxGeometry(0.6, h * 0.6, 2.2),
          new THREE.MeshBasicMaterial({ color: signCols[(Math.random() * 4) | 0] })
        );
        const sx = c.x + (Math.random() < 0.5 ? w / 2 + 0.4 : -w / 2 - 0.4);
        sign.position.set(sx, h * 0.55, c.z + rng(-d / 3, d / 3)); S.add(sign);
      }
    }
    // instanced parapets + ledges (2 draw calls total)
    const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
    const putInst = (geo, mat, arr, hh) => {
      if (!arr.length) return;
      const im = new THREE.InstancedMesh(geo, mat, arr.length);
      arr.forEach(([x, y, z, w, d], i) => {
        _m4.compose(_v.set(x, y, z), _q, _s.set(w, hh, d)); im.setMatrixAt(i, _m4);
      });
      S.add(im);
    };
    putInst(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0x1b2340 }), paras, 1.1);
    putInst(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0x232c4a }), ledges, 0.35);

    // ---------- POIs ----------
    const hosp = this.blockCenter(1, 1);
    const hb = new THREE.Mesh(new THREE.BoxGeometry(26, 18, 26), new THREE.MeshLambertMaterial({ color: 0x141a30, emissive: 0xffffff, emissiveMap: winTex, emissiveIntensity: 0.7 }));
    hb.position.set(hosp.x, 9, hosp.z); S.add(hb);
    this.solids.push({ x: hosp.x, z: hosp.z, hw: 13, hd: 13 });
    const cross1 = new THREE.Mesh(new THREE.BoxGeometry(8, 3, 1), new THREE.MeshBasicMaterial({ color: 0xff3355 }));
    const cross2 = new THREE.Mesh(new THREE.BoxGeometry(3, 8, 1), new THREE.MeshBasicMaterial({ color: 0xff3355 }));
    cross1.position.set(hosp.x, 19.5, hosp.z - 13.1); cross2.position.set(hosp.x, 19.5, hosp.z - 13.1);
    S.add(cross1, cross2);
    this.hospital = { x: hosp.x, z: hosp.z - 16 };

    const pol = this.blockCenter(N - 2, N - 2);
    const pb = new THREE.Mesh(new THREE.BoxGeometry(26, 14, 26), new THREE.MeshLambertMaterial({ color: 0x101a34, emissive: 0xffffff, emissiveMap: winTex, emissiveIntensity: 0.7 }));
    pb.position.set(pol.x, 7, pol.z); S.add(pb);
    this.solids.push({ x: pol.x, z: pol.z, hw: 13, hd: 13 });
    const badge = new THREE.Mesh(new THREE.BoxGeometry(10, 2, 1), new THREE.MeshBasicMaterial({ color: 0x60a5fa }));
    badge.position.set(pol.x, 15.5, pol.z - 13.1); S.add(badge);
    this.police = { x: pol.x, z: pol.z - 16 };

    this.fixer = this.randomSidewalk();

    // ---------- streetlights ----------
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x222838 });
    const headMat = new THREE.MeshBasicMaterial({ color: 0x9fd8ff });
    for (const rx of ROAD_X) {
      for (let z = -EXT / 2 + 8; z < EXT / 2; z += 46) {
        const pole = new THREE.Mesh(new THREE.BoxGeometry(0.35, 5.4, 0.35), poleMat);
        pole.position.set(rx - ROAD / 2 - 1, 2.7, z); S.add(pole);
        const head = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.3, 0.6), headMat);
        head.position.set(rx - ROAD / 2, 5.4, z); S.add(head);
      }
    }

    // ---------- sky ----------
    const starGeo = new THREE.BufferGeometry();
    const pts = [];
    for (let i = 0; i < 700; i++) {
      const a = Math.random() * Math.PI * 2, r = 300 + Math.random() * 300, y = 60 + Math.random() * 300;
      pts.push(Math.cos(a) * r, y, Math.sin(a) * r);
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    S.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0x9fb4ff, size: 1.6, sizeAttenuation: false })));
    const moonM = new THREE.Mesh(new THREE.SphereGeometry(14, 16, 12), new THREE.MeshBasicMaterial({ color: 0xcfe0ff }));
    moonM.position.set(-220, 200, -320); S.add(moonM);
  },
});
