/* NEON CITY — net: 2-player co-op over PeerJS auto-pairing (host-authoritative).
   Host runs the world and broadcasts {t:'snap'} every ~120ms; the guest sends
   {t:'in'} inputs every ~60ms (edge flags fire immediately) and {t:'act'} for
   discrete actions. Everything is JSON-plain and solo-safe: when
   DGOnline/PeerJS is missing or the pair never forms, the game stays solo. */
(function () {
  const NC = window.NC;
  const U = NC.util;

  const SNAP_MS = 120, IN_MS = 60;
  const qs = new URLSearchParams(location.search);

  const net = {
    role: null,        // "host" | "guest" once DGOnline resolves
    online: false,     // transport established (may still have no peer)
    peerOn: false,     // a peer is connected right now
    _s: null,          // DGOnline session
    _connecting: false,
    _queue: [],        // discrete messages buffered until the conn opens
    _snapAcc: 0, _inAcc: 0,
    _snap: null,       // latest host snapshot (guest side)
    _synced: false,    // guest adopted host pos for own player at least once
    _added: false,     // host spawned players[1] for the joined guest
  };

  net.isGuest = () => net.role === "guest";

  // ---------- connect ----------
  net.connect = function (as) {
    if (net._connecting || net._s) return;
    if (!window.DGOnline || !DGOnline.connect) return;
    net._connecting = true;
    const want = (as || qs.get("as")) === "zuza" ? "guest" : "host"; // koto/missing → host
    let p;
    try { p = DGOnline.connect("neon-city", want); } catch (e) { net._connecting = false; return; }
    Promise.resolve(p).then((s) => {
      net._s = s;
      net.role = s.role || want;
      net.online = true;
      net._connecting = false;
      s.onmessage = (m) => { try { net._handle(m); } catch (e) {} };
      s.onpeer = (j) => { try { net._onpeer(j); } catch (e) {} };
      // PeerJS guest: the data conn is already open by the time connect() resolves
      if (net.role === "guest" && s._conn) net._onpeer(true);
    }).catch(() => { net._connecting = false; net._s = null; }); // stay solo silently
  };

  net._onpeer = function (joined) {
    net.peerOn = joined;
    if (joined) while (net._queue.length) {
      try { net._s.send(net._queue.shift()); } catch (e) { break; }
    }
    const s = NC.state;
    if (!s) return;
    if (net.role === "host") {
      if (joined) {
        if (s.players.length < 2 && NC.player && NC.player.mkPlayer) {
          s.players.push(NC.player.mkPlayer("zuza", s.players[0].x + 26, s.players[0].y));
          net._added = true;
        }
        s.playSolo = false;
        NC.toast("zuza joined — partner in crime 🖤");
      } else {
        NC.toast("zuza left");
        if (net._added && s.players.length > 1) { s.players.splice(1, 1); net._added = false; }
        if (s.players.length < 2) s.playSolo = true;
      }
    } else if (!joined) NC.toast("koto left — you're solo now");
  };

  // ---------- send ----------
  net._send = function (o) { try { net._s && net._s.send(o); } catch (e) {} };

  // discrete messages are buffered until a peer is actually connected
  net._post = function (o) {
    if (net._s && net.peerOn) net._send(o);
    else { net._queue.push(o); if (net._queue.length > 60) net._queue.shift(); }
  };

  net.act = function (name, args) { net._post({ t: "act", name, args: args || {} }); };
  net.send = function (type, data) {
    const o = { t: type };
    if (data && typeof data === "object") Object.assign(o, data);
    else if (data !== undefined) o.d = data;
    net._post(o);
  };

  // ---------- receive ----------
  net._handle = function (m) {
    if (!m || typeof m !== "object") return;
    const s = NC.state;
    if (!s) return;
    if (m.t === "in") {
      if (net.role === "host" && s.players[1]) s.players[1]._remoteInput = m;
    } else if (m.t === "act") {
      if (net.role !== "host") return;
      const args = m.args || {};
      if (args.pi === undefined) args.pi = 1; // guest is always players[1]
      net.remoteAction(m.name, args, args.pi); // own table first
      for (const mod of NC._mods) {
        if (mod === net || !mod.remoteAction) continue;
        try { mod.remoteAction(m.name, args, args.pi); } catch (e) {}
      }
    } else if (m.t === "snap") {
      if (net.role === "guest") net._snap = m;
    } else {
      for (const mod of NC._mods) {
        if (mod === net || !mod.netMessage) continue;
        try { mod.netMessage(m.t, m); } catch (e) {}
      }
    }
  };

  // guest→host actions fired by player.js guestSelfMove (and any module act())
  net.remoteAction = function (name, args, pi) {
    const s = NC.state;
    if (!s) return;
    const p = s.players[pi || 1];
    if (!p) return;
    args = args || {};
    if (name === "car-enter") {
      if (NC.cars && NC.cars.tryEnter) NC.cars.tryEnter(p);
    } else if (name === "car-exit") {
      if (NC.cars && NC.cars.tryExit) NC.cars.tryExit(p);
    } else if (name === "fire-self") {
      if (!NC.combat || p.dead || p.busted || p.iatk > 0) return;
      const w = args.weapon || p.weapon;
      if (w === "fist") { if (NC.combat.melee) { NC.combat.melee(p); p.iatk = 0.45; } }
      else if (NC.combat.fire && p.weapons && p.weapons[w] && (p.ammo[w] || 0) > 0) {
        NC.combat.fire(p, args.x, args.y, args.angle, w);
        p.iatk = (NC.combat.WEAPONS && NC.combat.WEAPONS[w] && NC.combat.WEAPONS[w].cd) || 0.3;
        if (--p.ammo[w] <= 0) p.weapon = "fist";
      }
    } else if (name === "weapon-cycle") {
      const order = ["fist", "pistol", "smg", "shotgun"].filter((w) => p.weapons && p.weapons[w]);
      if (order.length) {
        p.weapon = order[(order.indexOf(p.weapon) + 1) % order.length];
        NC.toast(p.weapon.toUpperCase(), 900);
      }
    }
  };

  // ---------- host broadcast ----------
  net._sendSnap = function (s) {
    const cars = (NC.cars && NC.cars.list) || [];
    const mods = {};
    for (const m of NC._mods) {
      if (m === net || !m.serialize) continue;
      try { const d = m.serialize(); if (d != null) mods[m._name] = d; } catch (e) {}
    }
    net._send({
      t: "snap", timeMin: s.timeMin,
      players: s.players.map((p) => ({
        char: p.char,
        x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10,
        angle: Math.round((p.angle || 0) * 100) / 100, dir: p.dir,
        step: Math.round((p.step || 0) * 100) / 100,
        hp: Math.round(p.hp || 0), money: Math.round(p.money || 0),
        wanted: Math.round((p.wanted || 0) * 100) / 100, stars: p.stars || 0,
        weapon: p.weapon, inCar: p.inCar ? cars.indexOf(p.inCar) : -1,
        dead: !!p.dead, busted: !!p.busted,
      })),
      mods,
    });
  };

  // ---------- guest apply ----------
  net._applySnap = function (dt, s) {
    const snap = net._snap;
    if (!snap) return;
    net._snap = null;
    const me = NC.me && NC.me();
    // 1) ensure a local player object exists per snapshot slot
    (snap.players || []).forEach((sp, i) => {
      if (!s.players[i] && NC.player && NC.player.mkPlayer)
        s.players[i] = NC.player.mkPlayer(sp.char || "zuza", sp.x, sp.y);
      if (s.players[i] && sp.char) s.players[i].char = sp.char;
    });
    // 2) module state (cars list etc.) — fresh objects before inCar mapping
    const mods = snap.mods || {};
    for (const m of NC._mods) {
      if (m === net || !m.deserialize) continue;
      const d = mods[m._name];
      if (d == null) continue;
      try { m.deserialize(d); } catch (e) {}
    }
    // 3) players — remote lerp ~12/s, own keeps predicted pos unless downed/driving
    const cars = (NC.cars && NC.cars.list) || [];
    const k = Math.min(1, dt * 12);
    (snap.players || []).forEach((sp, i) => {
      const p = s.players[i];
      if (!p) return;
      const mine = p === me;
      const wasDown = p.dead || p.busted;
      p.hp = sp.hp; p.wanted = sp.wanted; p.stars = sp.stars;
      p.weapon = sp.weapon; p.money = sp.money;
      p.inCar = sp.inCar >= 0 ? cars[sp.inCar] || null : null;
      p.dead = !!sp.dead; p.busted = !!sp.busted;
      const firstSync = mine && !net._synced;
      if (!mine || wasDown || p.dead || p.busted || p.inCar || firstSync) {
        if (firstSync || Math.abs(sp.x - p.x) > 160 || Math.abs(sp.y - p.y) > 160) {
          p.x = sp.x; p.y = sp.y;
        } else {
          p.x += (sp.x - p.x) * k; p.y += (sp.y - p.y) * k;
        }
      }
      if (mine) {
        net._synced = true;
        if (p.dead && !wasDown && NC.hud && NC.hud.wasted) NC.hud.wasted(p);
        else if (p.busted && !wasDown && NC.hud && NC.hud.busted) NC.hud.busted(p);
      } else {
        p.angle = sp.angle; p.dir = sp.dir; p.step = sp.step;
      }
    });
    if (snap.timeMin !== undefined) s.timeMin = snap.timeMin;
  };

  // ---------- frame ----------
  net.update = function (dt, s) {
    if (!net.online) return;
    if (net.role === "host") {
      // give a fresh remoteInput's edge flags exactly one frame of visibility —
      // this module runs before player.js consumes them in update()
      const p1 = s.players[1];
      if (p1 && p1._remoteInput) {
        const ri = p1._remoteInput;
        if (ri._seen) ri.aEdge = ri.bEdge = ri.cEdge = false;
        else ri._seen = true;
      }
      if (net.peerOn) {
        net._snapAcc += dt * 1000;
        if (net._snapAcc >= SNAP_MS) { net._snapAcc = 0; net._sendSnap(s); }
      }
    } else if (net.role === "guest") {
      net._applySnap(dt, s);
      if (!net.peerOn) return;
      const inp = NC.input;
      net._inAcc += dt * 1000;
      if (net._inAcc >= IN_MS || inp.aEdge || inp.bEdge || inp.cEdge) {
        net._inAcc = 0;
        net._send({
          t: "in",
          joy: { x: +inp.joy.x.toFixed(3), y: +inp.joy.y.toFixed(3), mag: +inp.joy.mag.toFixed(3) },
          a: inp.a, b: inp.b, c: inp.c,
          aEdge: inp.aEdge, bEdge: inp.bEdge, cEdge: inp.cEdge,
        });
      }
    }
  };

  net.drawHUD = function (ctx) {
    const on = net.peerOn;
    ctx.save();
    ctx.font = "bold 9px monospace";
    ctx.textAlign = "right";
    ctx.globalAlpha = on ? 0.95 : 0.45;
    ctx.fillStyle = on ? "#22d3ee" : "#64748b";
    ctx.fillText(on ? "ONLINE" : "SOLO", NC.vw - 90, NC.vh - 13);
    ctx.beginPath(); ctx.arc(NC.vw - 96 - ctx.measureText(on ? "ONLINE" : "SOLO").width, NC.vh - 16, 3, 0, 7); ctx.fill();
    ctx.restore();
  };

  // ---------- module contract ----------
  net.init = function () {};
  net.start = function () { net.connect(); }; // NC.state exists by now; reads ?as itself
  net.interactables = function () { return []; };
  net.serialize = function () { return null; }; // transport only — owns no state
  net.deserialize = function () {};
  NC.register("net", net);
})();
