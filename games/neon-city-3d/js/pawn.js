/* NEON CITY 3D — pawn: low-poly humanoid builder + walk animation.
   Chars: koto (bowl-cut + cyan streak + chain), zuza (long hair + sunglasses + magenta), cop, ped. */
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
const NC = window.NC;

const PAL = {
  koto: { skin: 0xf0c8a0, hair: 0x16181d, hi: 0x22d3ee, jacket: 0x14161f, legs: 0x14161c, acc: 0xc0c8d8 },
  zuza: { skin: 0xf0c8a0, hair: 0x2b1b12, hi: 0xff2d95, jacket: 0x121019, legs: 0x131118, acc: 0xff2d95 },
  cop: { skin: 0xe8b88a, hair: 0x101418, hi: 0x60a5fa, jacket: 0x1e3a8a, legs: 0x10182e, acc: 0x60a5fa },
  ped: { skin: 0xe8b88a, hair: 0x3a2e22, hi: 0x8890a8, jacket: 0x2a2f42, legs: 0x1a1e2c, acc: 0x8890a8 },
};

function box(w, h, d, c, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color: c }));
  m.position.set(x, y, z);
  return m;
}
function emis(w, h, d, c, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color: c }));
  m.position.set(x, y, z);
  return m;
}

NC.register('pawn', {
  make(char) {
    const p = PAL[char] || PAL.ped;
    const g = new THREE.Group();
    const rig = {};
    // legs (pivot at hip y=0.55)
    rig.legL = new THREE.Group(); rig.legR = new THREE.Group();
    rig.legL.position.set(-0.11, 0.55, 0); rig.legR.position.set(0.11, 0.55, 0);
    const legGeoL = box(0.16, 0.55, 0.18, p.legs, 0, -0.27, 0);
    const legGeoR = legGeoL.clone();
    rig.legL.add(legGeoL); rig.legR.add(legGeoR);
    g.add(rig.legL, rig.legR);
    // torso
    const torso = new THREE.Group(); torso.position.y = 0.55;
    torso.add(box(0.46, 0.55, 0.26, p.jacket, 0, 0.28, 0));
    torso.add(emis(0.48, 0.05, 0.28, p.hi, 0, 0.53, 0)); // neon collar
    torso.add(emis(0.48, 0.04, 0.28, p.hi, 0, 0.02, 0)); // hem
    if (char === 'koto') torso.add(emis(0.16, 0.05, 0.02, p.acc, 0, 0.42, 0.14)); // chain
    // arms
    rig.armL = new THREE.Group(); rig.armR = new THREE.Group();
    rig.armL.position.set(-0.29, 0.5, 0); rig.armR.position.set(0.29, 0.5, 0);
    rig.armL.add(box(0.12, 0.5, 0.14, p.jacket, 0, -0.25, 0));
    rig.armR.add(box(0.12, 0.5, 0.14, p.jacket, 0, -0.25, 0));
    if (char === 'koto') rig.armR.add(emis(0.14, 0.08, 0.16, 0x22d3ee, 0, -0.42, 0)); // holo-watch
    torso.add(rig.armL, rig.armR);
    // head
    const head = new THREE.Group(); head.position.y = 0.62;
    head.add(box(0.3, 0.3, 0.28, p.skin, 0, 0.15, 0));
    if (char === 'koto') {
      head.add(box(0.34, 0.12, 0.32, p.hair, 0, 0.27, 0));          // bowl top
      head.add(box(0.34, 0.1, 0.32, p.hair, 0, 0.2, -0.02));        // sides
      head.add(emis(0.06, 0.1, 0.02, p.hi, -0.13, 0.2, 0.15));      // cyan streak
      head.add(box(0.03, 0.05, 0.02, 0x101014, -0.07, 0.12, 0.15)); // eyes
      head.add(box(0.03, 0.05, 0.02, 0x101014, 0.07, 0.12, 0.15));
    } else if (char === 'zuza') {
      head.add(box(0.34, 0.12, 0.32, p.hair, 0, 0.27, 0));
      head.add(box(0.06, 0.34, 0.3, p.hair, -0.17, 0.08, -0.02));   // side falls
      head.add(box(0.06, 0.34, 0.3, p.hair, 0.17, 0.08, -0.02));
      head.add(box(0.3, 0.5, 0.1, p.hair, 0, -0.02, -0.19));        // back fall
      head.add(emis(0.06, 0.06, 0.1, p.hi, -0.17, -0.1, -0.02));    // neon tips
      head.add(emis(0.06, 0.06, 0.1, p.hi, 0.17, -0.1, -0.02));
      head.add(box(0.22, 0.07, 0.03, 0x05070a, 0, 0.14, 0.15));     // sunglasses
      head.add(emis(0.22, 0.015, 0.032, p.acc, 0, 0.16, 0.15));
    } else if (char === 'cop') {
      head.add(box(0.34, 0.1, 0.32, p.hair, 0, 0.27, 0));
      head.add(box(0.36, 0.07, 0.34, 0x0d1330, 0, 0.32, 0));        // cap
      head.add(emis(0.36, 0.02, 0.1, 0x60a5fa, 0, 0.3, 0.13));
      head.add(box(0.03, 0.05, 0.02, 0x101014, -0.07, 0.12, 0.15));
      head.add(box(0.03, 0.05, 0.02, 0x101014, 0.07, 0.12, 0.15));
    } else {
      head.add(box(0.34, 0.1, 0.32, p.hair, 0, 0.27, 0));
      head.add(box(0.03, 0.05, 0.02, 0x101014, -0.07, 0.12, 0.15));
      head.add(box(0.03, 0.05, 0.02, 0x101014, 0.07, 0.12, 0.15));
    }
    torso.add(head);
    g.add(torso);
    g.userData.rig = rig;
    g.userData.char = char;
    return g;
  },

  // swing limbs while moving; seated pose in car
  anim(pawn, step, moving, inCar) {
    const r = pawn.userData.rig;
    if (!r) return;
    if (inCar) {
      r.legL.rotation.x = r.legR.rotation.x = -1.4;
      r.armL.rotation.x = r.armR.rotation.x = -0.7;
      return;
    }
    const s = moving ? Math.sin(step * Math.PI * 2) : 0;
    r.legL.rotation.x = s * 0.9;
    r.legR.rotation.x = -s * 0.9;
    r.armL.rotation.x = -s * 0.7;
    r.armR.rotation.x = s * 0.7;
  },
});
