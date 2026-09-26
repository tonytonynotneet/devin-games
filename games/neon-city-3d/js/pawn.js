/* NEON CITY 3D — pawn: low-poly humanoid builder + walk animation.
   Chars: koto (mash cut + silver chain + silver watch), zuza (waist-long hair + slim shades + gold bracelet), cop, ped. */
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
const NC = window.NC;

const PAL = {
  koto: { skin: 0xf0c8a0, hair: 0x2a1d12, hi: 0x22d3ee, jacket: 0x241f1d, legs: 0x14161c, acc: 0xd8dde8 },
  zuza: { skin: 0xf2d4b8, hair: 0x4a3520, hi: 0xff2d95, jacket: 0x0d0b0f, legs: 0x131118, acc: 0xd4af37 },
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
    torso.add(emis(0.48, 0.03, 0.28, p.hi, 0, 0.02, 0)); // faint neon hem
    if (char === 'koto') {
      // silver chain necklace — V shape on chest (photo)
      torso.add(emis(0.02, 0.14, 0.02, p.acc, -0.05, 0.44, 0.14));
      torso.add(emis(0.02, 0.14, 0.02, p.acc, 0.05, 0.44, 0.14));
    }
    // arms
    rig.armL = new THREE.Group(); rig.armR = new THREE.Group();
    rig.armL.position.set(-0.29, 0.5, 0); rig.armR.position.set(0.29, 0.5, 0);
    const sleeve = char === 'zuza' ? p.skin : p.jacket; // zuza: sleeveless top (photo)
    rig.armL.add(box(0.12, 0.5, 0.14, sleeve, 0, -0.25, 0));
    rig.armR.add(box(0.12, 0.5, 0.14, sleeve, 0, -0.25, 0));
    if (char === 'koto') rig.armL.add(emis(0.15, 0.09, 0.17, 0xc9d2e0, 0, -0.42, 0)); // silver watch, left wrist
    if (char === 'zuza') rig.armR.add(emis(0.14, 0.05, 0.16, 0xd4af37, 0, -0.4, 0));  // gold bracelet, right wrist
    torso.add(rig.armL, rig.armR);
    // head
    const head = new THREE.Group(); head.position.y = 0.62;
    head.add(box(0.3, 0.3, 0.28, p.skin, 0, 0.15, 0));
    if (char === 'koto') {
      // mash-mushroom cut: cap covers crown + ears, fringe over brows (photo)
      head.add(box(0.36, 0.14, 0.34, p.hair, 0, 0.28, 0));          // crown cap
      head.add(box(0.36, 0.16, 0.34, p.hair, 0, 0.2, -0.03));       // sides over ears
      head.add(box(0.36, 0.08, 0.06, p.hair, 0, 0.17, 0.14));       // fringe
      head.add(box(0.03, 0.05, 0.02, 0x101014, -0.07, 0.12, 0.15)); // eyes
      head.add(box(0.03, 0.05, 0.02, 0x101014, 0.07, 0.12, 0.15));
    } else if (char === 'zuza') {
      // long straight brown hair past waist + front falls + slim shades (photo)
      head.add(box(0.34, 0.13, 0.34, p.hair, 0, 0.28, 0));          // crown
      head.add(box(0.06, 0.5, 0.3, p.hair, -0.17, -0.02, -0.02));   // side falls
      head.add(box(0.06, 0.5, 0.3, p.hair, 0.17, -0.02, -0.02));
      head.add(box(0.3, 0.62, 0.12, p.hair, 0, -0.1, -0.19));       // back fall to waist
      head.add(box(0.1, 0.4, 0.06, p.hair, -0.2, -0.06, 0.1));      // front fall over shoulder
      head.add(box(0.1, 0.4, 0.06, p.hair, 0.2, -0.06, 0.1));
      head.add(box(0.24, 0.06, 0.03, 0x05070a, 0, 0.14, 0.15));     // slim black sunglasses
      head.add(box(0.05, 0.02, 0.02, 0xd4748a, 0, 0.04, 0.15));     // lips
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
