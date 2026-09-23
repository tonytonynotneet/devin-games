/* dream-home couple module — koto & zuza's bond.
   Purpose: 恋人としての仲を深める — shared actions, gifts, date spots, an
   affection meter, and little celebrations as the pair grows closer.

   Contract with game.js (same as other modules):
     DH.couple.init(state)         – once at load
     DH.couple.start(state)        – on each new run (resets the bond)
     DH.couple.update(dt, state)   – per frame (host sim only)
     DH.couple.interactables(p)    – -> [{label,x,y,action}]
     DH.couple.collectDraws(draws, camX, camY) – {y,fn} depth-sorted draws
     DH.couple.drawGround(ctx,camX,camY,state) / drawOverlay(...)
     DH.couple.serialize()/deserialize(data)   – plain-JSON net snapshots
     DH.couple.remoteAction(name, args)        – remote-callable mutations

   Wiring notes:
   - game.js routes the action key through furniture/garden/animals only, so
     init() hooks couple's interactables into that chain — same monkey-patch
     style furniture.js uses for world.isSolid.
   - garden/animals interactables are instrumented so both players doing the
     same chore within 2s triggers the "In sync!" bonus.
   - net.js only serializes furniture/garden/animals; init() patches net.send /
     applySnapshot / _handle so affection, hands and fx sync too (guests stay
     view-only; host still simulates).
*/
(function () {
  const DH = (window.DH = window.DH || {});
  const T = 32;

  // ---------- tuning ----------
  const NEAR_R = 46;            // px: close enough for together actions
  const LEASH = 95;             // px: hand-holding slips beyond this
  const HOLD_DIST = 34;         // px: desired hand-in-hand distance
  const HUG = { aff: 6, t: 1.4, cd: 4 };
  const HIFI = { aff: 3, t: 0.7, cd: 2 };
  const GIFT = { cost: 15, aff: 10, happy: 2, cd: 3 };
  const HANDS = { t: 10, affPerSec: 1.2, endAff: 2, cd: 8 };
  const DATE = { aff: 15, happy: 8, t: 2.6, cd: 25, r: 64 };
  const SYNC = { aff: 4, window: 2, cd: 6 };
  const DECAY_AFTER = 15;       // s of no couple interaction before decay
  const DECAY_RATE = 0.22;      // aff/sec
  const HAPPY_TICK = 0.0012;    // happiness/sec per affection point
  const MILESTONES = [
    [25, "First spark 💘"], [50, "Sweethearts 💕"],
    [75, "Power couple 💖"], [100, "Soulmates 💞"],
  ];
  const GIFTS = [
    ["🌹", "a rose"], ["🍫", "some chocolate"], ["💌", "a love letter"],
    ["🧸", "a teddy bear"], ["🍰", "a slice of cake"], ["💐", "a bouquet"],
    ["🎀", "a ribbon"], ["🍓", "some strawberries"],
  ];
  const BENCH = { tx: 21, ty: 15 }; // pond-side bench date spot (fixed)
  const REMOTE_OK = new Set(["hug", "highfive", "gift", "holdHands", "letGo", "date"]);

  // ---------- state (plain JSON only — it is the sync payload) ----------
  const M = {
    aff: 0, now: 0, lastTouch: -99,
    ms: {},                                  // milestone threshold -> fired
    cds: { hug: 0, hifi: 0, gift: 0, hands: 0, date: 0 },
    spotCd: { bench: 0, tv: 0 },
    busy: [0, 0],                            // per-player freeze timers
    fr: [{ x: 0, y: 0 }, { x: 0, y: 0 }],    // frozen positions while busy
    pose: { t: 0, kind: "" },                // overlay flourish while busy
    hands: { on: false, t: 0, leader: 0, fxT: 0 },
    scene: 0, flashAt: 0, flash: 0,          // date scene + photo flash
    syncCd: 0, ambT: 0,
    lastAct: [{ k: "", t: -99 }, { k: "", t: -99 }],
    fx: [],                                  // {k,x,y,vx,vy,age,ttl,txt}
  };
  let gs = null, G = null;
  let tvCache = { t: -1, spot: null }; // view-layer cache, not serialized

  // ---------- helpers ----------
  const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
  const mid = () => {
    const [a, b] = gs.players;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };
  function freeze(t) {
    for (const p of gs.players) { M.busy[p.pid] = t; M.fr[p.pid].x = p.x; M.fr[p.pid].y = p.y; }
  }
  function faceEachOther() {
    const [a, b] = gs.players;
    a.dir = a.x < b.x ? "right" : "left";
    b.dir = a.dir === "right" ? "left" : "right";
  }
  function burst(x, y, n, kind = "heart", txt = "") {
    for (let i = 0; i < n && M.fx.length < 70; i++)
      M.fx.push({
        k: kind, txt,
        x: x + Math.random() * 26 - 13, y: y + Math.random() * 10 - 5,
        vx: Math.random() * 16 - 8, vy: -24 - Math.random() * 20,
        age: 0, ttl: 0.9 + Math.random() * 0.6,
      });
  }
  function heartShower() {
    for (const p of gs.players) burst(p.x, p.y - 24, 9);
    const m = mid(); burst(m.x, m.y - 30, 7, "spark");
  }
  function addAff(n) {
    M.aff = Math.min(100, M.aff + n);
    M.lastTouch = M.now;
    for (const [v, msg] of MILESTONES)
      if (M.aff >= v && !M.ms[v]) { M.ms[v] = 1; DH.toast(msg, 2800); heartShower(); }
  }
  function trySync() {
    if (M.syncCd > 0) return;
    M.syncCd = SYNC.cd;
    const m = mid();
    burst(m.x, m.y - 30, 7, "spark");
    DH.toast(`In sync! ✨ +${SYNC.aff}💗`);
    addAff(SYNC.aff);
  }
  function noteActivity(pid, kind) {
    if (!kind || pid == null || !gs || !gs.players[1 - pid]) return;
    const prev = M.lastAct[1 - pid];
    if (prev.k === kind && M.now - prev.t <= SYNC.window) trySync();
    M.lastAct[pid] = { k: kind, t: M.now };
  }

  // ---------- date spots ----------
  function spots() {
    const list = [{ id: "bench", name: "pond bench", x: BENCH.tx * T + 16, y: BENCH.ty * T + 16 }];
    if (tvCache.t < M.now - 0.5) { // refresh the TV spot at most twice a second
      tvCache = { t: M.now, spot: null };
      try {
        const items = (DH.furniture && DH.furniture.serialize().items) || [];
        const tv = items.find(i => i.id === "tv");
        if (tv) tvCache.spot = { id: "tv", name: "TV", x: (tv.x0 + 1) * T, y: (tv.y0 + 1) * T + 10 };
      } catch (e) { /* furniture mid-reset */ }
    }
    if (tvCache.spot) list.push(tvCache.spot);
    return list;
  }
  function nearSpot(p, s) { return dist2(p.x, p.y, s.x, s.y) < DATE.r * DATE.r; }

  // ---------- named mutations (remote-callable) ----------
  function hug(pid) {
    if (!gs || M.cds.hug > 0) return false;
    const [a, b] = gs.players; if (!a || !b) return false;
    M.cds.hug = HUG.cd; M.hands.on = false;
    freeze(HUG.t); faceEachOther(); M.pose = { t: HUG.t, kind: "hug" };
    const m = mid(); burst(m.x, m.y - 24, 14);
    DH.toast(`🤗 ${a.name} hugs ${b.name} — so warm! +${HUG.aff}💗`);
    addAff(HUG.aff);
    return true;
  }
  function highfive(pid) {
    if (!gs || M.cds.hifi > 0) return false;
    const [a, b] = gs.players; if (!a || !b) return false;
    M.cds.hifi = HIFI.cd; M.hands.on = false;
    freeze(HIFI.t); faceEachOther(); M.pose = { t: HIFI.t, kind: "hifi" };
    const m = mid(); burst(m.x, m.y - 26, 8, "spark");
    DH.toast(`✋ High-five! +${HIFI.aff}💗`);
    addAff(HIFI.aff);
    return true;
  }
  function gift(pid) {
    if (!gs || M.cds.gift > 0) return false;
    const [a, b] = gs.players; if (!a || !b) return false;
    if (gs.coins < GIFT.cost) { DH.toast("Not enough coins 🪙"); return false; }
    gs.coins -= GIFT.cost;
    M.cds.gift = GIFT.cd; M.hands.on = false;
    freeze(0.8); faceEachOther(); M.pose = { t: 0.8, kind: "gift" };
    const [ico, name] = GIFTS[Math.floor(Math.random() * GIFTS.length)];
    const o = gs.players[1 - pid];
    burst(o.x, o.y - 26, 8);
    M.fx.push({ k: "gift", txt: ico, x: o.x, y: o.y - 34, vx: 0, vy: -16, age: 0, ttl: 1.6 });
    DH.toast(`🎁 ${a.name} gave ${b.name} ${name}! +${GIFT.aff}💗`);
    addAff(GIFT.aff); gs.happiness += GIFT.happy;
    return true;
  }
  function holdHands(pid) {
    if (!gs || M.cds.hands > 0 || M.hands.on) return false;
    const [a, b] = gs.players; if (!a || !b) return false;
    M.cds.hands = HANDS.cd; M.hands = { on: true, t: HANDS.t, leader: pid, fxT: 0 };
    const m = mid(); burst(m.x, m.y - 20, 4);
    DH.toast("🫶 Holding hands — stay close!");
    return true;
  }
  function letGo() {
    if (!M.hands.on) return false;
    M.hands.on = false;
    DH.toast("💞 Hands free");
    return true;
  }
  function date(spot) {
    if (!gs || M.scene > 0 || M.spotCd[spot.id] > 0) return false;
    const [a, b] = gs.players; if (!a || !b) return false;
    M.spotCd[spot.id] = DATE.cd; M.cds.date = DATE.cd;
    M.scene = DATE.t; M.flashAt = M.now + 1.1; M.hands.on = false;
    freeze(DATE.t); faceEachOther(); M.pose = { t: DATE.t, kind: "date" };
    const m = mid();
    burst(m.x, m.y - 18, 12); burst(m.x, m.y - 34, 10, "spark");
    DH.toast(`💕 Date at the ${spot.name}! +${DATE.aff}💗`);
    addAff(DATE.aff); gs.happiness += DATE.happy;
    return true;
  }

  // ---------- together menu ----------
  function openLove(pid) {
    const p = gs.players[pid], o = gs.players[1 - pid];
    DH.menu.open(`💗 ${p.name} ♥ ${o.name}`, [
      { ico: "🤗", label: `Hug (+${HUG.aff}💗)`, disabled: M.cds.hug > 0, cb: () => hug(pid) },
      { ico: "✋", label: `High-five (+${HIFI.aff}💗)`, disabled: M.cds.hifi > 0, cb: () => highfive(pid) },
      { ico: "🎁", label: `Give a gift (+${GIFT.aff}💗)`, cost: GIFT.cost, disabled: gs.coins < GIFT.cost || M.cds.gift > 0, cb: () => gift(pid) },
      { ico: "🫶", label: `Hold hands (~${HANDS.t}s of 💗)`, disabled: M.hands.on || M.cds.hands > 0, cb: () => holdHands(pid) },
    ]);
  }

  // ---------- wiring (init-time hooks) ----------
  const SYNC_KINDS = [
    [/^water/i, "water"], [/^feed/i, "feed"], [/^pet/i, "pet"],
    [/^play/i, "play"], [/^harvest/i, "harvest"], [/^pick/i, "pick"],
    [/^plant/i, "plant"], [/^till/i, "till"], [/^milk/i, "milk"],
    [/^shear/i, "shear"], [/^collect/i, "collect"],
  ];
  function kindOf(label) {
    for (const [re, k] of SYNC_KINDS) if (re.test(label)) return k;
    return null;
  }
  function instrument(mod) {
    if (!mod || mod._syncd || !mod.interactables) return;
    mod._syncd = 1;
    const base = mod.interactables.bind(mod);
    mod.interactables = p => base(p).map(a => {
      const kind = kindOf(a.label), fn = a.action;
      return { ...a, action: () => { const r = fn(); if (r !== false) noteActivity(p.pid, kind); return r; } };
    });
  }
  function hookDispatch() {
    for (const m of [DH.furniture, DH.garden, DH.animals]) {
      if (m && m.interactables && !m._coupleHook) {
        m._coupleHook = 1;
        const base = m.interactables.bind(m);
        m.interactables = p => DH.couple.interactables(p).concat(base(p));
        return;
      }
    }
  }
  function hookNet() {
    const net = DH.net;
    if (!net || net._coupleHook) return;
    net._coupleHook = 1;
    const send0 = net.send.bind(net);
    net.send = o => {
      if (o && o.type === "state" && o.snap) o.snap.couple = DH.couple.serialize();
      return send0(o);
    };
    const app0 = net.applySnapshot.bind(net);
    net.applySnapshot = () => {
      const r = app0();
      const c = net.guestState && net.guestState.snap && net.guestState.snap.couple;
      if (c) DH.couple.deserialize(c);
      return r;
    };
    const h0 = net._handle.bind(net);
    net._handle = m => {
      h0(m);
      if (net.role === "host" && m && m.type === "act") DH.couple.remoteAction(m.name, m.args);
    };
  }

  // ---------- drawing ----------
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function drawSpark(ctx, x, y, s) { // 4-point sparkle (no emoji dependency)
    ctx.fillStyle = "#ffe08a";
    ctx.beginPath();
    ctx.moveTo(x, y - s);
    ctx.quadraticCurveTo(x + s * 0.18, y - s * 0.18, x + s, y);
    ctx.quadraticCurveTo(x + s * 0.18, y + s * 0.18, x, y + s);
    ctx.quadraticCurveTo(x - s * 0.18, y + s * 0.18, x - s, y);
    ctx.quadraticCurveTo(x - s * 0.18, y - s * 0.18, x, y - s);
    ctx.fill();
  }
  function drawBench(ctx, px, py) { // wooden bench facing the pond (east)
    ctx.fillStyle = "#8a5a3b"; ctx.fillRect(px + 5, py + 4, 5, 14);   // backrest
    ctx.fillStyle = "#a06a42"; ctx.fillRect(px + 4, py + 3, 7, 3);
    ctx.fillStyle = "#6f4327"; ctx.fillRect(px + 5, py + 9, 5, 2);     // slat gap
    ctx.fillStyle = "#a06a42"; ctx.fillRect(px + 5, py + 16, 23, 5);   // seat
    ctx.fillStyle = "#c08a52"; ctx.fillRect(px + 5, py + 16, 23, 1);
    ctx.fillStyle = "#6f4327"; ctx.fillRect(px + 7, py + 21, 4, 9);    // legs
    ctx.fillRect(px + 22, py + 21, 4, 9);
    // a little carved heart on the backrest
    DH.sprites.heart(ctx, px + 7.5, py + 7.5, 2.6, "#e0607e");
  }
  function drawMeter(ctx) {
    const w = 116, h = 15, x = (ctx.canvas.width - w) / 2, y = 6;
    ctx.save();
    ctx.fillStyle = "rgba(24,10,18,0.55)"; rr(ctx, x, y, w, h, 7); ctx.fill();
    if (M.aff > 0.5) {
      ctx.fillStyle = "#ff5b7f";
      rr(ctx, x + 2, y + 2, Math.max(4, (w - 4) * M.aff / 100), h - 4, 5); ctx.fill();
    }
    ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = 1;
    rr(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 7); ctx.stroke();
    DH.sprites.heart(ctx, x - 9, y + h / 2 + 1, 6);
    ctx.font = "bold 9px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = "#00000088"; ctx.fillText(Math.round(M.aff) + "", x + w / 2 + 0.5, y + h / 2 + 1);
    ctx.fillStyle = "#ffffff"; ctx.fillText(Math.round(M.aff) + "", x + w / 2, y + h / 2);
    ctx.restore();
  }
  function drawLink(ctx, camX, camY) {
    const [a, b] = gs.players;
    ctx.save();
    ctx.strokeStyle = "rgba(255,120,160,0.75)"; ctx.lineWidth = 2; ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(a.x - camX, a.y - 16 - camY); ctx.lineTo(b.x - camX, b.y - 16 - camY);
    ctx.stroke(); ctx.setLineDash([]);
    const m = mid();
    const s = 4 + Math.sin(Date.now() / 200) * 0.8;
    DH.sprites.heart(ctx, m.x - camX, m.y - 18 - camY, s);
    ctx.restore();
  }

  // ---------- module contract ----------
  DH.couple = {
    init(s) {
      gs = s;
      G = document.getElementById("cv").getContext("2d");
      if (DH.world && DH.world.blocked) DH.world.blocked.add(BENCH.tx + "," + BENCH.ty);
      hookDispatch();
      instrument(DH.garden); instrument(DH.animals);
      hookNet();
    },

    start(s) {
      gs = s;
      M.aff = 0; M.now = 0; M.lastTouch = -99; M.ms = {};
      M.cds = { hug: 0, hifi: 0, gift: 0, hands: 0, date: 0 };
      M.spotCd = { bench: 0, tv: 0 };
      M.busy = [0, 0]; M.pose = { t: 0, kind: "" };
      M.hands = { on: false, t: 0, leader: 0, fxT: 0 };
      M.scene = 0; M.flashAt = 0; M.flash = 0;
      M.syncCd = 0; M.ambT = 0;
      M.lastAct = [{ k: "", t: -99 }, { k: "", t: -99 }];
      M.fx.length = 0;
    },

    update(dt, s) {
      gs = s; M.now += dt;
      for (const k in M.cds) if (M.cds[k] > 0) M.cds[k] -= dt;
      for (const k in M.spotCd) if (M.spotCd[k] > 0) M.spotCd[k] -= dt;
      if (M.syncCd > 0) M.syncCd -= dt;
      if (M.pose.t > 0) M.pose.t -= dt;
      if (M.flash > 0) M.flash -= dt * 2.2;
      if (M.scene > 0) {
        M.scene -= dt;
        if (M.flashAt && M.now >= M.flashAt) { M.flash = 0.55; M.flashAt = 0; }
      }
      const [a, b] = s.players;
      if (a && b) {
        for (const p of [a, b]) {
          if (M.busy[p.pid] > 0) {
            M.busy[p.pid] = Math.max(0, M.busy[p.pid] - dt);
            p.x = M.fr[p.pid].x; p.y = M.fr[p.pid].y; p.moving = false;
          }
        }
        if (M.hands.on) {
          const H = M.hands;
          H.t -= dt; H.fxT -= dt;
          // whoever is moving leads the stroll
          if (a.moving !== b.moving) H.leader = a.moving ? a.pid : b.pid;
          const L = s.players[H.leader], F = s.players[1 - H.leader];
          const dx = L.x - F.x, dy = L.y - F.y, d = Math.hypot(dx, dy) || 1;
          if (d > LEASH) { H.on = false; DH.toast("🫶 Hands slipped — too far!"); }
          else {
            if (d > HOLD_DIST) {
              const sp = Math.min(160, (d - HOLD_DIST) * 6) * dt;
              const nx = F.x + (dx / d) * sp, ny = F.y + (dy / d) * sp;
              if (DH.world.canStand(nx, F.y)) F.x = nx;
              if (DH.world.canStand(F.x, ny)) F.y = ny;
              F.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up");
              F.moving = true; F.step += dt * 6;
            }
            addAff(HANDS.affPerSec * dt);
            s.happiness += 0.1 * dt;
            if (H.fxT <= 0) { H.fxT = 0.8; const m = mid(); burst(m.x, m.y - 20, 1); }
            if (H.t <= 0) { H.on = false; DH.toast("🫶 Lovely walk together!"); addAff(HANDS.endAff); }
          }
        }
        // ambient closeness sparkle — a hint, no affection
        if (!M.hands.on && !M.busy[0] && !M.busy[1] &&
            dist2(a.x, a.y, b.x, b.y) < NEAR_R * NEAR_R && M.now > M.ambT) {
          M.ambT = M.now + 1.8;
          const m = mid(); burst(m.x, m.y - 26, 1);
        }
        // sauna sync — only if the sauna module exposes a sweat check
        const sn = DH.sauna;
        if (sn && typeof sn.sweating === "function" && sn.sweating(0) && sn.sweating(1)) trySync();
      }
      if (M.now - M.lastTouch > DECAY_AFTER) M.aff = Math.max(0, M.aff - DECAY_RATE * dt);
      s.happiness += M.aff * HAPPY_TICK * dt;
      for (let i = M.fx.length - 1; i >= 0; i--) {
        const f = M.fx[i];
        f.age += dt; f.x += f.vx * dt; f.y += f.vy * dt;
        if (f.age >= f.ttl) { M.fx[i] = M.fx[M.fx.length - 1]; M.fx.pop(); }
      }
    },

    interactables(p) {
      if (!gs || !p || p.pid == null) return [];
      const o = gs.players[1 - p.pid];
      if (!o) return [];
      const acts = [];
      if (!M.scene && !M.busy[0] && !M.busy[1]) {
        for (const s of spots()) {
          if (M.spotCd[s.id] > 0) continue;
          if (nearSpot(p, s) && nearSpot(o, s))
            acts.push({ label: "Date 💕", x: s.x, y: s.y, action: () => date(s) });
        }
      }
      if (M.hands.on) acts.push({ label: "Let go 💞", x: o.x, y: o.y, action: letGo });
      else if (!M.busy[p.pid] && dist2(p.x, p.y, o.x, o.y) < NEAR_R * NEAR_R)
        acts.push({ label: "Together 💗", x: o.x, y: o.y, action: () => openLove(p.pid) });
      return acts;
    },

    collectDraws(draws, camX, camY) {
      const bx = BENCH.tx * T - camX, by = BENCH.ty * T - camY;
      draws.push({ y: (BENCH.ty + 1) * T, fn: () => drawBench(G, bx, by) });
    },

    drawGround(ctx, camX, camY) {
      const tw = 0.5 + 0.5 * Math.sin(Date.now() / 400);
      for (const s of spots()) {
        const x = s.x - camX, y = s.y - camY;
        if (x < -50 || y < -50 || x > ctx.canvas.width + 50 || y > ctx.canvas.height + 50) continue;
        ctx.globalAlpha = 0.10 + 0.08 * tw;
        ctx.strokeStyle = "#ff7ba0"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, 20 + tw * 3, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
      }
    },

    drawOverlay(ctx, camX, camY, s) {
      if (!s || !s.running) return;
      drawMeter(ctx);
      const [a, b] = s.players;
      if (a && b) {
        if (M.hands.on) drawLink(ctx, camX, camY);
        if (M.pose.t > 0) {
          const m = mid(), sx = m.x - camX, sy = m.y - 30 - camY;
          if (M.pose.kind === "hug" || M.pose.kind === "date")
            DH.sprites.heart(ctx, sx, sy, 9 + Math.sin(Date.now() / 130) * 1.6);
          else if (M.pose.kind === "hifi") drawSpark(ctx, sx, sy, 10);
        }
      }
      for (const f of M.fx) {
        const a2 = Math.max(0, 1 - f.age / f.ttl);
        ctx.globalAlpha = a2;
        const x = f.x - camX, y = f.y - camY;
        if (f.k === "heart") DH.sprites.heart(ctx, x, y, 5.5);
        else if (f.k === "spark") drawSpark(ctx, x, y, 5);
        else { ctx.font = "14px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(f.txt, x, y); }
        ctx.globalAlpha = 1;
      }
      if (M.flash > 0) {
        ctx.fillStyle = `rgba(255,255,255,${Math.min(0.85, M.flash)})`;
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      }
    },

    // ---------- net-sync boundary ----------
    hug, highfive, gift, holdHands, letGo, date,
    serialize() {
      return JSON.parse(JSON.stringify({
        aff: M.aff, now: M.now, lastTouch: M.lastTouch, ms: M.ms,
        cds: M.cds, spotCd: M.spotCd, busy: M.busy, fr: M.fr, pose: M.pose,
        hands: M.hands, scene: M.scene, syncCd: M.syncCd, lastAct: M.lastAct, fx: M.fx,
      }));
    },
    deserialize(d) {
      if (!d) return;
      if (typeof d.aff === "number") M.aff = d.aff;
      if (typeof d.now === "number") M.now = d.now;
      if (typeof d.lastTouch === "number") M.lastTouch = d.lastTouch;
      if (d.ms) M.ms = d.ms;
      if (d.cds) M.cds = d.cds;
      if (d.spotCd) M.spotCd = d.spotCd;
      if (d.busy) M.busy = d.busy;
      if (d.fr) M.fr = d.fr;
      if (d.pose) M.pose = d.pose;
      if (d.hands) M.hands = d.hands;
      if (typeof d.scene === "number") M.scene = d.scene;
      if (typeof d.syncCd === "number") M.syncCd = d.syncCd;
      if (d.lastAct) M.lastAct = d.lastAct;
      if (d.fx) M.fx = d.fx;
    },
    remoteAction(name, args) {
      const fn = DH.couple[name];
      return REMOTE_OK.has(name) && typeof fn === "function" ? fn.apply(null, args || []) : false;
    },
  };
})();

DH.register("couple", DH.couple);
