/* dream-home online sync — host-authoritative, auto-pair via shared/online.js.
   Wire-up happens in game.js via DH.net.* hooks; safe no-op when offline.

   Host: simulates everything. Sends {type:'state', ...serialize} ~10Hz plus
   {type:'pos', players:[{x,y,dir,step,moving}]} ~20Hz. Applies guest inputs
   and guest remoteActions as they arrive.
   Guest: sends {type:'input', inp} on change (~30Hz) and {type:'act', name, args}
   for module actions; applies host snapshots + positions to render. Guest does
   NOT simulate module update() — it only interpolates toward host state.
*/
(function () {
  const DH = (window.DH = window.DH || {});
  const net = (DH.net = {
    online: false, role: null, _s: null, _lastInput: "", _acc: 0, _posAcc: 0,
    guestState: null, // latest host snapshot on guest side
    pos: null,        // latest host position packet on guest side
  });

  const modules = () => [DH.furniture, DH.garden, DH.animals, DH.court, DH.sauna, DH.couple].filter(Boolean);

  net.connect = function (want, onRole) {
    if (typeof want === "function") { onRole = want; want = null; }
    if (!window.DGOnline) return null;
    DGOnline.connect("dream-home", want).then(s => {
      net._s = s;
      net.role = s.role;
      net.online = true;
      s.onmessage = m => { try { net._handle(m); } catch (e) {} };
      s.onpeer = joined => {
        if (!joined) DH.toast && DH.toast("Partner left ☹️");
        else if (net.role === "host") net.sendFullState(true);
        else if (net.role === "guest") net.send({ type: "hello" });
      };
      s.ws && (s.ws.onclose = () => { net.online = false; });
      onRole && onRole(s.role);
    }).catch(() => { DH.toast && DH.toast("Couldn't connect ☹️"); onRole && onRole(null); });
    return true;
  };

  net._handle = function (m) {
    const st = DH.state;
    if (net.role === "host") {
      if (m.type === "input" && st.players[1]) {
        const k = DH.inp && DH.inp[1];
        if (k) Object.assign(k, m.inp);
      } else if (m.type === "act") {
        for (const mod of modules()) mod.remoteAction && mod.remoteAction(m.name, m.args);
      } else if (m.type === "actAt") {
        DH.tryActionAt && DH.tryActionAt(m.x, m.y);
      } else if (m.type === "hello") {
        net.sendFullState(true);
      }
    } else if (net.role === "guest") {
      if (m.type === "state") {
        net.guestState = m;
        if (m.started && !st.running) DH.startRun && DH.startRun(m.names || []);
      } else if (m.type === "pos") net.pos = m;
      else if (m.type === "hud") Object.assign(st, m.hud);
    }
  };

  net.send = function (o) { try { net._s && net._s.send(o); } catch (e) {} };

  // ---- host side ----
  net.sendFullState = function (started) {
    const snap = {};
    for (const mod of modules()) if (mod.serialize) snap[mod._name] = mod.serialize();
    const st = DH.state;
    net.send({
      type: "state", snap, hud: net._hud(), started: !!started,
      names: (st.players || []).map(p => p.name),
      players: (st.players || []).map(p => ({ x: p.x, y: p.y, dir: p.dir })),
    });
  };
  net._hud = function () {
    const st = DH.state;
    return { happiness: st.happiness, coins: st.coins, timeMin: st.timeMin };
  };
  net.hostTick = function (dt) {
    if (!net.online || net.role !== "host") return;
    net._acc += dt; net._posAcc += dt;
    if (net._posAcc > 0.05) {
      net._posAcc = 0;
      net.send({ type: "pos", players: DH.state.players.map(p => ({ x: +p.x.toFixed(1), y: +p.y.toFixed(1), dir: p.dir, step: +p.step.toFixed(2), moving: p.moving })) });
    }
    if (net._acc > 0.3) { net._acc = 0; net.sendFullState(); }
  };

  // ---- guest side ----
  net.guestSendInput = function (inp) {
    if (!net.online || net.role !== "guest") return;
    const s = JSON.stringify(inp);
    if (s !== net._lastInput) { net._lastInput = s; net.send({ type: "input", inp }); }
  };
  net.guestAction = function (name, args) { net.send({ type: "act", name, args }); };
  net.applySnapshot = function () {
    if (net.role !== "guest" || !net.guestState) return;
    const snap = net.guestState.snap || {};
    for (const mod of modules()) if (mod.deserialize && snap[mod._name]) mod.deserialize(snap[mod._name]);
    if (net.guestState.hud) Object.assign(DH.state, net.guestState.hud);
  };
  net.applyPositions = function () {
    if (net.role !== "guest" || !net.pos) return;
    net.pos.players.forEach((sp, i) => {
      const p = DH.state.players[i];
      if (!p) return;
      // light interpolation
      p.x += (sp.x - p.x) * 0.35; p.y += (sp.y - p.y) * 0.35;
      p.dir = sp.dir; p.step = sp.step; p.moving = sp.moving;
    });
  };
})();
