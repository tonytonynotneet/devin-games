/* NEON CITY 3D — props: neon-tipped bollards, planters, rooftop billboards.
   Everything instanced or shared-texture: adds well under 150 draw calls. */
import * as THREE from 'three';
const NC = window.NC;
const U = () => NC.util;

function billTex(text, color) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#05070f'; g.fillRect(0, 0, 128, 64);
  g.strokeStyle = color; g.lineWidth = 4; g.strokeRect(3, 3, 122, 58);
  g.fillStyle = color; g.font = 'bold 30px monospace';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 64, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

NC.register('props', {
  init() {
    const S = NC.scene, C = NC.city;
    const RIM = C.BLOCK / 2 + 3.2; // sit on the sidewalk rim ring
    const M = new THREE.Matrix4();

    // ---------- neon-tipped bollards at sidewalk corners ----------
    const spots = [];
    for (let bx = 0; bx < C.N; bx++) for (let bz = 0; bz < C.N; bz++) {
      const c = C.blockCenter(bx, bz);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        if (Math.random() < 0.3) continue;
        const x = c.x + sx * RIM, z = c.z + sz * RIM;
        if (C.solidAt(x, z, 0.45)) continue;
        spots.push([x, z]);
      }
    }
    if (spots.length) {
      const pole = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(0.09, 0.11, 1.0, 6),
        new THREE.MeshLambertMaterial({ color: 0x2a3050 }), spots.length);
      const tip = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(0.13, 0.13, 0.16, 6),
        new THREE.MeshBasicMaterial({ color: 0xffffff }), spots.length);
      const tipCols = [0xff2d95, 0x22d3ee, 0xfacc15, 0xa855f7];
      const col = new THREE.Color();
      spots.forEach(([x, z], i) => {
        M.makeTranslation(x, 0.5, z); pole.setMatrixAt(i, M);
        M.makeTranslation(x, 1.06, z); tip.setMatrixAt(i, M);
        tip.setColorAt(i, col.setHex(tipCols[i % tipCols.length]));
      });
      S.add(pole, tip);
    }

    // ---------- planters along the rims ----------
    const plants = [];
    for (let bx = 0; bx < C.N; bx++) for (let bz = 0; bz < C.N; bz++) {
      const c = C.blockCenter(bx, bz);
      for (let side = 0; side < 4; side++) {
        if (Math.random() < 0.55) continue;
        const along = U().rand(-C.BLOCK / 2 + 3, C.BLOCK / 2 - 3);
        const x = side < 2 ? c.x + along : c.x + (side === 2 ? -RIM : RIM);
        const z = side < 2 ? c.z + (side === 0 ? -RIM : RIM) : c.z + along;
        if (C.solidAt(x, z, 0.9)) continue;
        plants.push([x, z, side >= 2]);
      }
    }
    if (plants.length) {
      const boxI = new THREE.InstancedMesh(
        new THREE.BoxGeometry(0.7, 0.55, 2.2),
        new THREE.MeshLambertMaterial({ color: 0x232b45 }), plants.length);
      const bushI = new THREE.InstancedMesh(
        new THREE.IcosahedronGeometry(0.55, 0),
        new THREE.MeshLambertMaterial({ color: 0x2dd4bf, emissive: 0x0d9488, emissiveIntensity: 0.5 }), plants.length);
      const Q = new THREE.Quaternion(), V = new THREE.Vector3(), SC = new THREE.Vector3(1, 1, 1), Y = new THREE.Vector3(0, 1, 0);
      plants.forEach(([x, z, vert], i) => {
        Q.setFromAxisAngle(Y, vert ? Math.PI / 2 : 0);
        M.compose(V.set(x, 0.55, z), Q, SC); boxI.setMatrixAt(i, M);
        M.compose(V.set(x, 1.05, z), Q, SC); bushI.setMatrixAt(i, M);
      });
      S.add(boxI, bushI);
    }

    // ---------- glowing billboards on tall building faces ----------
    const texs = [billTex('NEON', '#22d3ee'), billTex('24H', '#ff2d95'), billTex('ソウル', '#facc15'), billTex('BAR', '#a855f7')];
    const blds = (C.buildings || []).filter(b => b.h > 30);
    let placed = 0;
    for (const b of blds) {
      if (placed >= 10 || Math.random() < 0.35) continue;
      // face the nearest road
      let dBest = 1e9, face = 1; // 0:-z 1:+z 2:+x 3:-x
      for (const r of C.ROAD_X) {
        const d = Math.abs(b.x - r);
        if (d < dBest) { dBest = d; face = b.x > r ? 3 : 2; }
      }
      for (const r of C.ROAD_Z) {
        const d = Math.abs(b.z - r);
        if (d < dBest) { dBest = d; face = b.z > r ? 0 : 1; }
      }
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(7, 3.5),
        new THREE.MeshBasicMaterial({ map: texs[placed % texs.length] })
      );
      const y = b.h * 0.72;
      if (face === 0) { m.position.set(b.x, y, b.z - b.d / 2 - 0.06); m.rotation.y = Math.PI; }
      else if (face === 1) { m.position.set(b.x, y, b.z + b.d / 2 + 0.06); }
      else if (face === 2) { m.position.set(b.x + b.w / 2 + 0.06, y, b.z); m.rotation.y = Math.PI / 2; }
      else { m.position.set(b.x - b.w / 2 - 0.06, y, b.z); m.rotation.y = -Math.PI / 2; }
      S.add(m);
      placed++;
    }
  },
});
