/* dream-home finnish sauna + cold plunge module — フィンランド式サウナ.
   Contract with game.js (same as other modules):
     DH.sauna.init(state)          – once at load
     DH.sauna.start(state)         – on each run start
     DH.sauna.update(dt, state)    – per frame (sim under authority; FX tick in draw)
     DH.sauna.interactables(p)     – -> [{label,x,y,action}]
     DH.sauna.collectDraws(draws, camX, camY) – depth-sorted hut walls/props
     DH.sauna.drawGround(ctx,camX,camY,state) – plunge tub water + interior floor
     DH.sauna.drawOverlay(ctx,camX,camY,state) – FX, markers, aura, action hint
     serialize/deserialize/remoteAction       – JSON-plain state for net sync

   Build: sauna hut x19-21/y13-15 (door south at 20,15 opens onto the tub),
   wooden plunge tub x19-20/y16-17 (walkable icy water — exiting the sauna
   means splashing in). Core loop: heat up inside → throw löyly on the stove →
   don't overheat ☹️ → plunge → "totonou" 整い aura + happiness ticks.
   Both players inside together = "löyly for two" 💕 bonus (koto & zuza).

   Note: game.js's action dispatch list only covers furniture/garden/animals,
   so this module polls DH.inp action-key edges itself (and wraps
   DH.tryActionAt for online guests). If game.js ever wires sauna into
   nearestActions, `wired` flips on the first external interactables() call
   and all self-dispatch/hints defer to it automatically.
*/
(function () {
  const DH = (window.DH = window.DH || {});
  const T = 32;

  // ---------- layout ----------
  const HUT = { x1: 19, y1: 13, x2: 21, y2: 15 };        // tiles
  const DOOR = { tx: 20, ty: 15 };                        // walkable door tile (south face)
  const INT = { x: 20 * T + 16, y: 14 * T + 16 };         // interior stand point
  const WALL_TILES = ["19,13", "20,13", "21,13", "19,14", "21,14", "19,15", "21,15"];
  const TUB = { x1: 19, y1: 16, x2: 20, y2: 17 };         // tiles — walkable water
  const TUB_C = { x: (TUB.x1 + (TUB.x2 - TUB.x1 + 1) / 2) * T, y: (TUB.y1 + (TUB.y2 - TUB.y1 + 1) / 2) * T };
  const STOVE = { x: 20.62 * T, y: 14.18 * T };           // stove anchor inside the hut

  // ---------- tuning ----------
  const STOVE_UP = 6, STOVE_LOYLY = 16;                 // °C-ish heat rates
  const STOVE_CAP = 108, STOVE_IDLE_DECAY = 1.6;
  const HEAT_RATE = 0.095;        // player heat gain = stove*HEAT_RATE per s
  const HEAT_DECAY = 6, WARN_AT = 80, OVERHEAT_AT = 100;
  const LOYLY_CD = 2.5, TONO_T = 16;                      // s; ~1 game-hour
  const INTERACT_R = 46;

  // ---------- module state (plain JSON only) ----------
  let gs = null;
  const S = {
    heat: { 0: 0, 1: 0 }, tono: { 0: 0, 1: 0 },
    stove: 55, loylyN: 0, loylyCd: 0, shake: 0,
    inS: { 0: false, 1: false }, inT: { 0: false, 1: false },
    warned: { 0: false, 1: false }, bothT: 0, bothAnnounced: false,
    sweatT: { 0: 0, 1: 0 }, fx: [],
  };
  const S_reset = () => {
    S.heat = { 0: 0, 1: 0 }; S.tono = { 0: 0, 1: 0 };
    S.stove = 55; S.loylyN = 0; S.loylyCd = 0; S.shake = 0;
    S.inS = { 0: false, 1: false }; S.inT = { 0: false, 1: false };
    S.warned = { 0: false, 1: false }; S.bothT = 0; S.bothAnnounced = false;
    S.sweatT = { 0: 0, 1: 0 }; S.fx = [];
  };

  const rnd = (a, b) => a + Math.random() * (b - a);
  const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
  const addHappy = n => { if (gs) gs.happiness = Math.max(0, gs.happiness + n); };
  const tileOf = p => ({ tx: Math.floor(p.x / T), ty: Math.floor(p.y / T) });
  const inSauna = p => { const t = tileOf(p); return t.tx === 20 && t.ty === 14; };
  const inTub = p => {
    const t = tileOf(p);
    return t.tx >= TUB.x1 && t.tx <= TUB.x2 && t.ty >= TUB.y1 && t.ty <= TUB.y2;
  };

  function fx(k, x, y, o) { if (S.fx.length < 90) S.fx.push(Object.assign({ k, x, y, vx: 0, vy: 0, age: 0, ttl: 1 }, o)); }
  const steam = (x, y, n = 6) => { for (let i = 0; i < n; i++) fx("steam", x + rnd(-12, 12), y + rnd(-6, 4), { vy: -22 - rnd(0, 14), ttl: rnd(0.7, 1.3), sz: rnd(4, 8) }); };
  const splash = (x, y, n = 10) => { for (let i = 0; i < n; i++) fx("splash", x + rnd(-8, 8), y - 4, { vx: rnd(-55, 55), vy: -60 - rnd(0, 50), ttl: rnd(0.35, 0.6), sz: rnd(1.5, 3) }); };
  const sparkle = (x, y, n = 5) => { for (let i = 0; i < n; i++) fx("spark", x + rnd(-14, 14), y - rnd(4, 26), { vy: -8, ttl: rnd(0.5, 1), sz: rnd(2, 4) }); };
  const hearts = (x, y, n = 2) => { for (let i = 0; i < n; i++) fx("heart", x + rnd(-10, 10), y + rnd(-4, 2), { vy: -22 - rnd(0, 10), ttl: 1 }); };
  const poof = (x, y) => { for (let i = 0; i < 5; i++) fx("steam", x + rnd(-8, 8), y + rnd(-10, 0), { vy: -14, ttl: 0.45, sz: rnd(3, 6) }); };

  // ---------- actions (remote-callable) ----------
  const API = {
    enter(pid) {
      const p = gs && gs.players[pid];
      if (!p || inSauna(p)) return false;
      poof(p.x, p.y - 8);
      p.x = INT.x + rnd(-3, 3); p.y = INT.y; p.dir = "up"; p.moving = false;
      poof(INT.x, INT.y - 8);
      if (S.inS[pid ? 0 : 1] && !S.bothAnnounced) { S.bothAnnounced = true; DH.toast("Sauna for two 💕"); }
      return true;
    },
    leave(pid) {
      const p = gs && gs.players[pid];
      if (!p || !inSauna(p)) return false;
      p.x = DOOR.tx * T + 16; p.y = DOOR.ty * T + 20; p.dir = "down"; p.moving = false;
      poof(p.x, p.y - 8);
      return true;
    },
    loyly(pid) {
      const p = gs && gs.players[pid];
      if (!p || !inSauna(p) || S.loylyCd > 0) return false;
      S.loylyCd = LOYLY_CD; S.loylyN++;
      S.stove = Math.min(STOVE_CAP, S.stove + STOVE_LOYLY);
      S.shake = 0.45;
      steam(STOVE.x, STOVE.y - 4, 14);
      const both = S.inS[0] && S.inS[1];
      if (both) { hearts(INT.x, INT.y - 22, 4); addHappy(5); DH.toast("Löyly for two! 💕"); }
      else { addHappy(3); DH.toast("Löyly! 💧"); }
      return true;
    },
    plunge(pid) {
      const p = gs && gs.players[pid];
      if (!p || inSauna(p)) return false;
      p.x = TUB_C.x + rnd(-8, 8); p.y = TUB_C.y + rnd(-6, 6); p.dir = "down"; p.moving = false;
      return doPlunge(pid);
    },
  };

  function doPlunge(pid) {
    const p = gs.players[pid];
    splash(p.x, p.y, 14);
    const hot = S.heat[pid] >= 35;
    S.heat[pid] = 0;
    if (hot) {
      const partnerBuff = S.tono[pid ? 0 : 1] > 0;
      S.tono[pid] = TONO_T;
      sparkle(p.x, p.y, 8);
      if (partnerBuff) { hearts(p.x, p.y - 18, 3); addHappy(12); DH.toast("整い together! 💕✨"); }
      else { addHappy(8); DH.toast("整い — totally refreshed ✨"); }
    } else { addHappy(1.5); DH.toast("Brrr! Icy! ❄️"); }
    return true;
  }

  // ---------- self-dispatch ----------
  // game.js dispatches actions only for [furniture, garden, animals]; until it
  // lists sauna too we watch action-key edges ourselves (and dedupe guest
  // actAt relays). Keyboard edges come from our own keydown listener (a held
  // `a` flag can flip between frames); the level-edge poll stays as a fallback
  // for touch buttons and guest input relay. When an external interactables()
  // call lands, wired flips and we defer to game.js.
  const prevA = [false, false], pendA = [false, false], lastFire = [0, 0];
  let wired = false;

  function otherActs(p) {
    const out = [];
    for (const m of [DH.furniture, DH.garden, DH.animals])
      if (m && m.interactables) out.push(...m.interactables(p));
    return out;
  }
  function fire(p, pid) {
    if (wired) return;
    if (otherActs(p).length) return;           // game.js already consumed this press
    const acts = M.interactables(Object.assign({ _self: 1 }, p));
    if (acts.length) { lastFire[pid] = performance.now(); acts[0].action(); }
  }

  // ---------- module contract ----------
  const M = (DH.sauna = {
    authority: true,

    init(state) {
      gs = state;
      const W = DH.world;
      WALL_TILES.forEach(k => W.blocked.add(k));   // hut walls solid; door + interior walkable
      if (!W._blockPatched) {                       // same trick furniture uses for world.blocked
        W._blockPatched = true;
        const s0 = W.isSolid.bind(W);
        W.isSolid = (tx, ty) => s0(tx, ty) || W.blocked.has(tx + "," + ty);
      }
      window.addEventListener("keydown", e => {      // own press edges (game.js eats aEdge)
        if (e.repeat) return;
        if (e.code === "KeyF" || e.code === "Space") pendA[0] = true;
        else if (e.code === "Enter") pendA[1] = true;
      });
      if (DH.tryActionAt && !DH.tryActionAt._sauna) { // guest actAt fallback
        const t0 = DH.tryActionAt;
        const wrapped = (x, y) => {
          if (wired || performance.now() - lastFire[1] < 350 || otherActs({ x, y, pid: 1 }).length) return t0(x, y);
          const acts = M.interactables({ x, y, pid: 1, _self: 1 });
          if (acts.length) { lastFire[1] = performance.now(); return acts[0].action(); }
          return t0(x, y);
        };
        wrapped._sauna = true;
        DH.tryActionAt = wrapped;
      }
      const net = DH.net;
      if (net && !net._saunaPatched) {              // piggyback sauna snapshots for guests
        net._saunaPatched = true;
        const c0 = net.connect.bind(net);
        net.connect = onRole => c0(role => {
          const s = net._s;
          if (s && s.onmessage) {
            const h0 = s.onmessage;
            s.onmessage = m => {
              if (m && m.type === "dhSauna" && net.role === "guest") M.deserialize(m.snap);
              else h0(m);
            };
          }
          onRole && onRole(role);
        });
      }
    },

    start(state) { gs = state; S_reset(); },

    update(dt, state) {
      gs = state;
      for (const [i, p] of state.players.entries()) {
        const a = !!(DH.inp[i] && DH.inp[i].a);
        const edge = pendA[i] || (a && !prevA[i]);
        pendA[i] = false;
        if (edge && !wired && (!DH.net || !DH.net.online || DH.net.role !== "guest")) fire(p, i);
        prevA[i] = a;
        S.inS[i] = inSauna(p);
        const wasT = S.inT[i];
        S.inT[i] = inTub(p);
        if (M.authority && S.inT[i] && !wasT) doPlunge(i);
      }
      if (!M.authority) { S.loylyCd = Math.max(0, S.loylyCd - dt); return; }

      // stove heats while occupied, löyly spikes it; cools when empty
      const occupied = S.inS[0] || S.inS[1];
      if (!occupied) S.stove = Math.max(45, S.stove - STOVE_IDLE_DECAY * dt);
      else S.stove = Math.min(STOVE_CAP, S.stove + STOVE_UP * dt);
      S.loylyCd = Math.max(0, S.loylyCd - dt);
      S.shake = Math.max(0, S.shake - dt);

      for (const [i, p] of state.players.entries()) {
        if (S.inS[i]) {
          S.heat[i] = Math.min(OVERHEAT_AT, S.heat[i] + S.stove * HEAT_RATE * dt);
          S.sweatT[i] -= dt;
          if (S.heat[i] > 45 && S.sweatT[i] <= 0) { S.sweatT[i] = 0.6; fx("sweat", p.x + rnd(-7, 7), p.y - 18, { vy: 26, ttl: 0.55, sz: 2 }); }
          if (S.heat[i] >= WARN_AT && !S.warned[i]) { S.warned[i] = true; DH.toast("Getting too hot ☹️ — plunge! ❄️"); }
          if (S.heat[i] >= OVERHEAT_AT) {           // stumble out the door
            S.heat[i] = 78;
            p.x = DOOR.tx * T + 16; p.y = DOOR.ty * T + 20; p.dir = "down";
            poof(p.x, p.y - 8);
            DH.toast(`${p.name} overheated ☹️`);
          }
        } else {
          S.heat[i] = Math.max(0, S.heat[i] - HEAT_DECAY * dt);
          if (S.heat[i] < WARN_AT - 15) S.warned[i] = false;
        }
        if (S.tono[i] > 0) {
          S.tono[i] -= dt;
          addHappy(0.55 * dt);
          if (Math.random() < dt * 1.4) sparkle(p.x, p.y - 6, 1);
        }
      }
      // löyly together: both inside → shared hearts
      if (S.inS[0] && S.inS[1]) {
        S.bothT += dt;
        if (S.bothT > 1.7) { S.bothT = 0; hearts((INT.x + DOOR.tx * T) / 2 - 8, INT.y - 26, 2); addHappy(1.2); }
      } else { S.bothT = 0; S.bothAnnounced = false; }

      const net = DH.net;
      if (net && net.online && net.role === "host" && (M._bcast = (M._bcast || 0) + dt) > 0.4) {
        M._bcast = 0; net.send({ type: "dhSauna", snap: M.serialize() });
      }
    },

    interactables(p) {
      if (!p._self) wired = true;
      if (!gs || !gs.running) return [];
      const out = [];
      if (inSauna(p)) {
        out.push({ label: "Throw löyly 💧", x: STOVE.x, y: STOVE.y, d2: dist2(p.x, p.y, STOVE.x, STOVE.y), action: () => API.loyly(p.pid || 0) });
        out.push({ label: "Leave sauna 🚪", x: DOOR.tx * T + 16, y: DOOR.ty * T + 20, d2: dist2(p.x, p.y, DOOR.tx * T + 16, DOOR.ty * T + 20), action: () => API.leave(p.pid || 0) });
      } else {
        if (dist2(p.x, p.y, DOOR.tx * T + 16, DOOR.ty * T + 16) < INTERACT_R * INTERACT_R)
          out.push({ label: "Enter sauna 🧖", x: DOOR.tx * T + 16, y: DOOR.ty * T + 16, d2: dist2(p.x, p.y, DOOR.tx * T + 16, DOOR.ty * T + 16), action: () => API.enter(p.pid || 0) });
        if (!inTub(p) && dist2(p.x, p.y, TUB_C.x, TUB_C.y) < 60 * 60)
          out.push({ label: "Jump in plunge pool ❄️", x: TUB_C.x, y: TUB_C.y, d2: dist2(p.x, p.y, TUB_C.x, TUB_C.y), action: () => API.plunge(p.pid || 0) });
      }
      out.sort((a, b) => a.d2 - b.d2);
      return out;
    },

    // ----- drawing -----
    collectDraws(draws, camX, camY) {
      draws.push({ y: 14 * T, fn: () => drawHutBack(camX, camY) });
      draws.push({ y: 16 * T - 1, fn: () => drawHutFront(camX, camY) });
    },

    drawGround(ctx, camX, camY, state) {
      drawInterior(ctx, camX, camY);
      drawTub(ctx, camX, camY, state && state.season);
    },

    drawOverlay(ctx, camX, camY, state) {
      const now = performance.now();
      const dt = Math.min(0.06, ((now - (M._fxT || now)) / 1000) || 0.016);
      M._fxT = now;
      for (let i = S.fx.length - 1; i >= 0; i--) {
        const f = S.fx[i];
        f.age += dt; f.x += (f.vx || 0) * dt; f.y += (f.vy || 0) * dt;
        if (f.age >= f.ttl) { S.fx[i] = S.fx[S.fx.length - 1]; S.fx.pop(); continue; }
        drawFx(ctx, f, camX, camY);
      }
      if (!gs || !gs.running) return;
      const players = state.players;
      for (const [i, p] of players.entries()) {
        const sx = p.x - camX, sy = p.y - camY;
        if (S.inT[i]) { // waist-deep waterline over the legs
          ctx.fillStyle = "rgba(140,215,240,0.55)";
          ctx.fillRect(sx - 8, sy - 8, 16, 8);
          ctx.fillStyle = "rgba(255,255,255,0.35)";
          ctx.fillRect(sx - 8 + Math.sin(now / 300 + p.x) * 2, sy - 8, 16, 2);
        }
        if (S.heat[i] >= WARN_AT)
          DH.sprites.sad(ctx, sx, sy - 46 + Math.sin(now / 280) * 1.6);
        if (S.tono[i] > 0) { // 整い relaxed aura
          const pulse = 0.55 + Math.sin(now / 350 + i) * 0.15;
          const g = ctx.createRadialGradient(sx, sy - 10, 2, sx, sy - 10, 22);
          g.addColorStop(0, `rgba(255,225,170,${0.34 * pulse})`);
          g.addColorStop(1, "rgba(255,225,170,0)");
          ctx.fillStyle = g;
          ctx.fillRect(sx - 22, sy - 32, 44, 44);
        }
      }
      if (S.shake > 0) { // löyly hiss shake — shimmer around the stove
        ctx.fillStyle = `rgba(255,255,255,${S.shake * 0.25})`;
        ctx.fillRect(STOVE.x - 16 - camX, STOVE.y - 24 - camY, 32, 30);
      }
      // action hint (skip when game.js's dispatch list covers us)
      if (!wired) for (const p of players) {
        if (otherActs(p).length) continue;
        const acts = M.interactables(Object.assign({ _self: 1 }, p));
        if (acts.length) {
          ctx.fillStyle = "#ffffffdd"; ctx.font = "bold 11px sans-serif"; ctx.textAlign = "center";
          ctx.fillText("⚡ " + acts[0].label, p.x - camX, p.y - camY - 42);
        }
      }
    },

    // ----- sync boundary -----
    serialize() {
      return JSON.parse(JSON.stringify({
        heat: S.heat, tono: S.tono, stove: S.stove, loylyN: S.loylyN,
        inS: S.inS, inT: S.inT, fx: S.fx,
      }));
    },
    deserialize(d) {
      if (!d) return;
      S.heat = d.heat || S.heat; S.tono = d.tono || S.tono;
      S.stove = d.stove != null ? d.stove : S.stove; S.loylyN = d.loylyN || 0;
      S.inS = d.inS || S.inS; S.inT = d.inT || S.inT; S.fx = d.fx || [];
    },
    remoteAction(name, args) {
      return typeof API[name] === "function" ? API[name].apply(null, args || []) : false;
    },

    enter: API.enter, leave: API.leave, loyly: API.loyly, plunge: API.plunge,
    _S: S, // exposed for debugging/tests
  });

  // ---------- fx drawing ----------
  function drawFx(ctx, f, camX, camY) {
    const t = f.age / f.ttl, x = f.x - camX, y = f.y - camY;
    ctx.save();
    if (f.k === "steam") {
      ctx.globalAlpha = 0.5 * (1 - t);
      ctx.fillStyle = "#e8e8ea";
      ctx.beginPath(); ctx.arc(x, y, (f.sz || 5) * (0.6 + t * 1.4), 0, Math.PI * 2); ctx.fill();
    } else if (f.k === "sweat") {
      ctx.globalAlpha = 0.85 * (1 - t);
      ctx.fillStyle = "#7ec8f0";
      ctx.fillRect(x - 1, y, 2.5, 4);
      ctx.fillStyle = "#c8ecff"; ctx.fillRect(x - 0.5, y, 1, 1.5);
    } else if (f.k === "splash") {
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = "#aee6f8";
      ctx.fillRect(x, y, f.sz || 2, f.sz || 2);
    } else if (f.k === "spark") {
      ctx.globalAlpha = Math.sin(Math.min(1, t) * Math.PI);
      ctx.fillStyle = "#ffe89a";
      const s = f.sz || 3;
      ctx.fillRect(x - s, y - 0.7, s * 2, 1.4); ctx.fillRect(x - 0.7, y - s, 1.4, s * 2);
    } else if (f.k === "heart") {
      ctx.globalAlpha = 1 - t;
      DH.sprites.heart(ctx, x, y, 5);
    }
    ctx.restore();
  }

  // ---------- hut drawing ----------
  function shakeX() { return S.shake > 0 ? Math.sin(performance.now() / 30) * 1.4 * S.shake * 4 : 0; }

  function drawHutBack(camX, camY) {
    const cv = document.getElementById("cv"), ctx = cv.getContext("2d");
    const sh = shakeX();
    const x0 = HUT.x1 * T - camX, top = HUT.y1 * T - camY;
    const winter = gs && gs.season === "winter";

    // roof slab + eave over the north wall row
    ctx.fillStyle = "#4e3524"; ctx.fillRect(x0 - 4 + sh, top - 15, 3 * T + 8, 15);
    ctx.fillStyle = "#5f4230"; ctx.fillRect(x0 - 4 + sh, top - 15, 3 * T + 8, 4);
    ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.fillRect(x0 + sh, top - 3, 3 * T, 3);
    if (winter) { ctx.fillStyle = "#eef4f8"; ctx.fillRect(x0 - 4 + sh, top - 18, 3 * T + 8, 4); }

    // chimney + lazy smoke
    ctx.fillStyle = "#6e4a3a"; ctx.fillRect(x0 + 58 + sh, top - 26, 9, 12);
    ctx.fillStyle = "#523329"; ctx.fillRect(x0 + 57 + sh, top - 28, 11, 3);
    const now = performance.now();
    for (let i = 0; i < 3; i++) {
      const age = (now / 1700 + i / 3) % 1;
      ctx.fillStyle = `rgba(230,230,230,${0.28 * (1 - age)})`;
      ctx.beginPath();
      ctx.arc(x0 + 62 + Math.sin(age * 5 + i) * 5 + sh, top - 30 - age * 30, 2 + age * 5, 0, Math.PI * 2);
      ctx.fill();
    }

    // north + side wall faces (log cabin: horizontal cedar logs)
    ctx.fillStyle = "#8a5a34";
    ctx.fillRect(x0, top, 3 * T, 32);
    ctx.fillRect(x0, top + 30, T, T + 2);                 // west wall (x19,y14)
    ctx.fillRect(x0 + 2 * T, top + 30, T, T + 2);         // east wall (x21,y14)
    ctx.fillStyle = "#74482a";
    for (let r = 0; r < 5; r++) ctx.fillRect(x0, top + 4 + r * 6, 3 * T, 1);
    for (let r = 0; r < 5; r++) { ctx.fillRect(x0, top + 34 + r * 6, T, 1); ctx.fillRect(x0 + 2 * T, top + 34 + r * 6, T, 1); }
    ctx.fillStyle = "rgba(0,0,0,0.14)";
    ctx.fillRect(x0 + T, top + 30, 1, T); ctx.fillRect(x0 + 2 * T, top + 30, 1, T);
    // corner log caps
    ctx.fillStyle = "#6e4024";
    ctx.fillRect(x0 - 1, top + 1, 4, 8); ctx.fillRect(x0 + 3 * T - 3, top + 1, 4, 8);

    // interior back furniture — two-tier cedar bench (west) + stove (east)
    drawBench(ctx, x0 + T + 2, top + 40);
    drawStove(ctx, x0 + 2 * T - 12 + sh, top + 44);
  }

  function drawBench(ctx, x, y) {
    ctx.fillStyle = "#6b4a2c"; ctx.fillRect(x, y + 8, 14, 4);       // legs/back shadow
    ctx.fillStyle = "#c08d55"; ctx.fillRect(x - 1, y + 4, 16, 5);   // top bench seat
    ctx.fillStyle = "#d9a568"; ctx.fillRect(x - 1, y + 4, 16, 1);
    ctx.fillStyle = "#a87847"; ctx.fillRect(x, y + 12, 12, 3);      // lower tier step
  }

  function drawStove(ctx, x, y) {
    const hot = Math.min(1, S.stove / STOVE_CAP);
    ctx.fillStyle = "#3a3a42"; ctx.fillRect(x, y - 8, 12, 14);      // stove body
    ctx.fillStyle = "#2a2a30"; ctx.fillRect(x + 1, y - 5, 10, 3);   // door slit
    ctx.fillStyle = `rgba(255,${140 + hot * 60 | 0},40,${0.35 + hot * 0.6})`;
    ctx.fillRect(x + 3, y - 4, 6, 2);                               // coal glow
    ctx.fillStyle = "#4a4a55"; ctx.fillRect(x + 2, y - 16, 8, 9);   // stone pile
    ctx.fillStyle = "#5a5a66"; ctx.fillRect(x + 3, y - 17, 3, 2); ctx.fillRect(x + 6, y - 15, 3, 2);
    ctx.fillStyle = "#55555f"; ctx.fillRect(x + 5, y - 34, 4, 18);  // chimney pipe up through roof
    if (hot > 0.35) { // heat shimmer
      const o = Math.sin(performance.now() / 200) * 1.5;
      ctx.fillStyle = `rgba(255,190,90,${0.16 * hot})`;
      ctx.fillRect(x - 4 + o, y - 20, 20, 24);
    }
  }

  function drawHutFront(camX, camY) {
    const cv = document.getElementById("cv"), ctx = cv.getContext("2d");
    const x0 = HUT.x1 * T - camX, fy = HUT.y2 * T - camY; // south wall row y=15
    // full-height front walls flanking the door; interior stays visible via the door slot
    for (const tx of [HUT.x1, HUT.x2]) {
      const px = tx * T - camX;
      ctx.fillStyle = "#8a5a34"; ctx.fillRect(px, fy, T, T);
      ctx.fillStyle = "#74482a";
      for (let r = 0; r < 5; r++) ctx.fillRect(px, fy + 4 + r * 6, T, 1);
      ctx.fillStyle = "rgba(0,0,0,0.14)"; ctx.fillRect(px, fy + T - 4, T, 4); // skirting
    }
    // door posts + lintel + hanging SAUNA sign
    const dx = DOOR.tx * T - camX;
    ctx.fillStyle = "#241812"; ctx.fillRect(dx + 3, fy, T - 6, 10); // dark doorway opening
    ctx.fillStyle = "#5a3820";
    ctx.fillRect(dx, fy + 10, 4, 22); ctx.fillRect(dx + T - 4, fy + 10, 4, 22);
    ctx.fillRect(dx - 2, fy + 6, T + 4, 6);
    ctx.fillStyle = "#e8d0a0"; ctx.fillRect(dx + 7, fy + 12, 18, 9); // little sign
    ctx.fillStyle = "#5a3820"; ctx.font = "bold 6px sans-serif"; ctx.textAlign = "center";
    ctx.fillText("SAUNA", dx + 16, fy + 19);
    // lantern glow beside the door
    const lx = dx + T + 6, ly = fy + 8;
    const g = ctx.createRadialGradient(lx, ly, 2, lx, ly, 26);
    g.addColorStop(0, "rgba(255,200,100,0.5)"); g.addColorStop(1, "rgba(255,200,100,0)");
    ctx.fillStyle = g; ctx.fillRect(lx - 26, ly - 26, 52, 52);
    ctx.fillStyle = "#ffd98a"; ctx.fillRect(lx - 2, ly - 3, 5, 6);
    ctx.fillStyle = "#5a3820"; ctx.fillRect(lx - 3, ly - 5, 7, 2);
  }

  function drawInterior(ctx, camX, camY) {
    const px = 20 * T - camX, py = 14 * T - camY;
    ctx.fillStyle = "#7a5232"; ctx.fillRect(px, py, T, T);           // dark cedar floor
    ctx.fillStyle = "#6b4526";
    for (let r = 0; r < 4; r++) ctx.fillRect(px, py + 6 + r * 8, T, 1);
    // wooden threshold on the door tile so the doorway doesn't read as grass
    ctx.fillStyle = "#a87847"; ctx.fillRect(px, py + T, T, T);
    ctx.fillStyle = "#8d6138";
    for (let r = 0; r < 4; r++) ctx.fillRect(px, py + T + 4 + r * 8, T, 1);
    const warm = Math.min(1, S.stove / STOVE_CAP);
    if (warm > 0.25) {
      ctx.fillStyle = `rgba(255,160,60,${0.14 * warm})`;
      ctx.fillRect(px, py, T, T);
    }
  }

  function drawTub(ctx, camX, camY, season) {
    const px = TUB.x1 * T - camX, py = TUB.y1 * T - camY, w = 2 * T, h = 2 * T;
    const now = performance.now();
    // wooden tub rim
    ctx.fillStyle = "#7a5a36"; ctx.fillRect(px - 3, py - 3, w + 6, h + 6);
    ctx.fillStyle = "#9a7444";
    for (let i = 0; i < 4; i++) { ctx.fillRect(px - 3 + i * (w + 6) / 4, py - 3, (w + 6) / 4 - 1, 5); ctx.fillRect(px - 3 + i * (w + 6) / 4, py + h - 2, (w + 6) / 4 - 1, 5); }
    for (let i = 0; i < 4; i++) { ctx.fillRect(px - 3, py + 2 + i * (h - 4) / 4, 5, (h - 4) / 4 - 1); ctx.fillRect(px + w - 2, py + 2 + i * (h - 4) / 4, 5, (h - 4) / 4 - 1); }
    if (season === "winter") { ctx.fillStyle = "#eef4f8"; ctx.fillRect(px - 3, py - 3, w + 6, 3); }
    // icy water
    ctx.fillStyle = season === "winter" ? "#8fd8f0" : "#79c8e8";
    ctx.fillRect(px + 2, py + 2, w - 4, h - 4);
    ctx.fillStyle = "#a8e4f8";
    const o = Math.sin(now / 700);
    ctx.fillRect(px + 8 + o * 3, py + 12, 18, 2); ctx.fillRect(px + 30 - o * 3, py + 34, 18, 2);
    ctx.fillRect(px + 14, py + 46 + o * 2, 14, 2);
    // ripple rings + floating ice chips
    for (let i = 0; i < 2; i++) {
      const ph = ((now / 110 + i * 7) % 14) / 14;
      ctx.strokeStyle = `rgba(255,255,255,${0.3 * (1 - ph)})`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(px + w / 2, py + h / 2, 4 + ph * 16, 2 + ph * 8, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = "#dff4fc";
    ctx.fillRect(px + 12 + o * 2, py + 8, 5, 3); ctx.fillRect(px + 44 - o * 2, py + 26, 4, 3);
    // winter steam wisps off the cold water
    if (season === "winter") {
      for (let i = 0; i < 3; i++) {
        const age = (now / 1900 + i / 3) % 1;
        ctx.fillStyle = `rgba(235,240,244,${0.3 * (1 - age)})`;
        ctx.beginPath();
        ctx.arc(px + 14 + i * 18 + Math.sin(age * 4 + i) * 4, py + 6 - age * 20, 1.5 + age * 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
})();
