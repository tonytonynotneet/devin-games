/* NEON CITY 3D — hud: stats, wanted stars, minimap radar, WASTED/BUSTED overlays, mission text. */
const NC = window.NC;

NC.register('hud', {
  _mm: null,
  _mmT: 0,

  wasted(p) { this._ov(p, 'WASTED', false); },
  busted(p) { this._ov(p, 'BUSTED', true); },
  _ov(p, txt, isBusted) {
    const o = document.getElementById('ovl'), t = document.getElementById('ovl-txt');
    t.textContent = txt; t.className = isBusted ? 'busted' : '';
    o.classList.add('on');
    setTimeout(() => {
      o.classList.remove('on');
      const pen = isBusted ? 400 : 200;
      const cash = Math.min(NC.state.money, pen);
      NC.state.money -= cash;
      if (isBusted) { p.stars = 0; p.ammo = {}; p.weapons = { fist: true }; p.weapon = 'fist'; }
      p.busted = isBusted; p.dead = !isBusted;
      NC.player.spawnPlayer(p);
      if (isBusted) NC.toast('RELEASED — lost your guns', 1800);
      else NC.toast('PATCHED UP — -$' + cash, 1800);
    }, 2600);
  },

  mission(txt) {
    const m = document.getElementById('mission');
    if (!txt) { m.classList.remove('on'); return; }
    m.textContent = txt; m.classList.add('on');
  },

  update(dt, s) {
    const me = NC.me();
    if (!me) return;
    document.getElementById('hp').textContent = Math.max(0, Math.round(me.hp));
    document.getElementById('money').textContent = '$' + Math.round(s.money);
    document.getElementById('weapon').textContent = me.weapon === 'fist' ? 'FIST' : me.weapon.toUpperCase() + ' ' + (me.ammo[me.weapon] || 0);
    document.getElementById('stars').textContent = '★'.repeat(me.stars) + '☆'.repeat(6 - me.stars);
    // minimap ~8Hz
    this._mmT -= dt;
    if (this._mmT <= 0) { this._mmT = 0.12; this._drawMap(s, me); }
  },

  _drawMap(s, me) {
    if (!this._mm) { const c = document.getElementById('minimap'); this._mm = c.getContext('2d'); }
    const g = this._mm, W = 132, R = 60; // radar range in meters
    const k = W / (R * 2);
    g.fillStyle = 'rgba(5,7,15,0.9)'; g.fillRect(0, 0, W, W);
    const px = me.inCar ? me.inCar.x : me.x, pz = me.inCar ? me.inCar.z : me.z;
    const wx = (x) => W / 2 + (x - px) * k, wz = (z) => W / 2 + (z - pz) * k;
    // roads
    g.strokeStyle = '#232a4a'; g.lineWidth = 2;
    g.beginPath();
    for (const r of NC.city.ROAD_X) { g.moveTo(wx(r), 0); g.lineTo(wx(r), W); }
    for (const r of NC.city.ROAD_Z) { g.moveTo(0, wz(r)); g.lineTo(W, wz(r)); }
    g.stroke();
    // POIs
    g.fillStyle = '#ff3355'; g.fillRect(wx(NC.city.hospital.x) - 3, wz(NC.city.hospital.z) - 3, 6, 6);
    g.fillStyle = '#60a5fa'; g.fillRect(wx(NC.city.police.x) - 3, wz(NC.city.police.z) - 3, 6, 6);
    // mission markers
    if (NC.missions && NC.missions.markers) {
      g.fillStyle = '#facc15';
      for (const m of NC.missions.markers(s) || []) { g.beginPath(); g.arc(wx(m.x), wz(m.z), 3.4, 0, 7); g.fill(); }
    }
    // cops / peds
    if (NC.people) {
      g.fillStyle = '#60a5fa';
      for (const c of NC.people.cops || []) { if (c.dead) continue; g.beginPath(); g.arc(wx(c.x), wz(c.z), 1.8, 0, 7); g.fill(); }
      for (const c of NC.people.pcars || []) { if (c.dead) continue; g.fillRect(wx(c.x) - 2, wz(c.z) - 2, 4, 4); }
    }
    // partner
    for (const p of s.players) {
      if (!p || p === me || p.dead || !p.mesh.visible) continue;
      g.fillStyle = '#ff2d95'; g.beginPath(); g.arc(wx(p.x), wz(p.z), 3, 0, 7); g.fill();
    }
    // me
    g.save();
    g.translate(W / 2, W / 2);
    g.rotate(-(me.inCar ? me.inCar.yaw : me.yaw));
    g.fillStyle = '#22d3ee';
    g.beginPath(); g.moveTo(0, -6); g.lineTo(4, 4); g.lineTo(-4, 4); g.closePath(); g.fill();
    g.restore();
  },
});
