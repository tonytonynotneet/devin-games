/* NEON CITY 3D — save: money/weapons/pos -> localStorage 'neon3d-save' (additive only). */
const NC = window.NC;
const KEY = 'neon3d-save';

NC.register('save', {
  _t: 0,

  init() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (s) {
        NC.state.money = s.money || 0;
        const me = NC.me();
        if (me) {
          me.weapons = { fist: true, ...(s.weapons || {}) };
          me.ammo = s.ammo || {};
          me.weapon = s.weapon || 'fist';
          if (typeof s.hp === 'number' && s.hp > 0) me.hp = Math.min(100, s.hp);
          if (typeof s.x === 'number' && typeof s.z === 'number' && !NC.city.solidAt(s.x, s.z, 0.5)) { me.x = s.x; me.z = s.z; me.mesh.position.set(s.x, 0, s.z); }
        }
      }
    } catch (e) {}
  },

  now() {
    const me = NC.me();
    if (!me) return;
    try {
      localStorage.setItem(KEY, JSON.stringify({
        v: 1, money: NC.state.money, x: me.x, z: me.z, hp: me.hp,
        weapons: me.weapons, ammo: me.ammo, weapon: me.weapon,
      }));
    } catch (e) {}
  },

  update(dt) {
    this._t += dt;
    if (this._t > 5) { this._t = 0; this.now(); }
  },
});
