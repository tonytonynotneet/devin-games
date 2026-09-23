/* dream-home misc module — ambient life, seasonal moments, arrival & departure
   (AC spec A-1/A-2 deepening + P-5).
   Contract with game.js (self-registers via DH.register at the bottom):
     DH.misc.init(state) / start(state) / update(dt,state)
     DH.misc.collectDraws(draws, camX, camY) — leaf piles, snowballs, snowman
     DH.misc.drawOverlay(ctx, camX, camY, state) — ambient particles, audio
       scheduler, arrival sequence, speech bubbles, FX
     DH.misc.interactables(p) -> [{label,x,y,action}]
     DH.misc.serialize()/deserialize(data)/remoteAction(name,args)/offline(offMin)

   A-1 ambient life driven by shared state.timeMin: butterflies wander by day,
   fireflies glow over summer dusks, snowflakes settle in winter, an owl hoots
   at night, a cicada chorus sings summer afternoons, and a birdsong jingle
   plays at dawn. Live flags publish on DH.misc.ambient for other modules.
   A-2 seasonal moments: sakura petals drift all spring; autumn drops leaf
   piles to kick (sometimes a 🍁 maple-leaf hides inside); winter snowballs
   can be rolled together — two big ones touching fuse into a snowman that
   greets passers-by for ~2 game days before melting away; summer cicadas.
   P-5 arrival & departure: once per save (S.arrived) the first load plays a
   plane-landing stripe + "Welcome to Dream Home" card + Terry greeting
   queue instead of an instant spawn; when the partner disconnects a
   "<name> waved goodbye 👋" toast + wave FX marks the moment.

   Net-sync boundary: sim state is plain JSON in S (arrived, piles, balls,
   snowman). Guests never run update(); ambient particles, audio and the
   arrival card are wall-clock-driven inside drawOverlay so both phones
   see/hear them. Mutations are named API fns via remoteAction(name,args).
*/
(function () {
  const DH = (window.DH = window.DH || {});
  const T = 32;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);

  // ---------- tuning ----------
  const INTERACT_R = 36;
  const PILES_PER_DAY = 3;          // autumn leaf piles
  const BALLS_PER_DAY = 2;          // winter snowballs lying in the yard
  const BALL_GROW = 1.3, BALL_MAX = 13, BALL_MIN_MERGE = 9;
  const MERGE_R = 14;               // bonus px beyond r1+r2 to fuse two balls
  const SNOWMAN_DAYS = 2;           // game days a snowman sticks around
  const SAVE_EVERY = 6;
  const AR_DUR = 6.6;               // arrival sequence seconds (landing + card)
  const SNOW_GREETS = [
    "hello hello!! ☃️", "snow day, huh?", "brrr-illiant weather!",
    "i'm only visiting — nice to meet you!", "cold hands, warm heart!", "☃️ hiii!",
  ];

  // ---------- items ----------
  const E = DH.items && DH.items.def;
  if (E) E("maple-leaf", { name: "Maple leaf", ico: "🍁", cat: "material", price: 8 });

  // ---------- module state (plain JSON — save bus + net snapshots) ----------
  let gs = null;
  const S = {
    arrived: false,   // P-5: welcome sequence already played for this save
    leafPiles: [],    // autumn: {id,x,y}
    snowballs: [],    // winter: {id,x,y,r}
    snowman: null,    // {id,x,y,bornDay,meltDay} | null
    nextId: 1,
    lastDay: -1,
  };
  const alog = (e, d) => { if (DH.alog) DH.alog.add(e, d); };
  const addHappy = n => { if (gs) gs.happiness = Math.max(0, gs.happiness + n); };
  const dayStamp = () => Math.floor((gs && gs.day) || 0);
  const timeMin = () => (gs && typeof gs.timeMin === "number" ? gs.timeMin : 720);
  const season = () => (gs && gs.season) || "spring";

  // ---------- view layer (not serialized) ----------
  const fx = [];            // {k,x,y,vx,vy,born,ttl}
  const bub = {};           // key -> {txt,until} speech bubbles
  let ctx2 = null, saveT = 0;
  const AR = { t0: 0 };     // arrival sequence wall-clock start
  const TQ = { list: [], at: 0 }; // Terry greeting toast queue
  let prevDuo = false, prevGuestOn = false;
  let nextGreet = 0, nextHoot = 0, nextCicada = 0, lastTm = -1, birdDay = -1, hintT = 0;

  // live ambient flags for other modules (A-1)
  const AMB = {
    season: "spring", daypart: "day", night: false,
    petals: false, butterflies: false, fireflies: false,
    snow: false, leafDrift: false, cicadas: false, owls: false,
  };

  // ---------- tiny WebAudio (self-contained; unlocks on first gesture) ----------
  const AU = {
    ctx: null, master: null,
    ensure() {
      if (!AU.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        try {
          AU.ctx = new AC();
          AU.master = AU.ctx.createGain();
          AU.master.gain.value = 0.4;
          AU.master.connect(AU.ctx.destination);
        } catch (e) { return null; }
      }
      if (AU.ctx.state === "suspended") { try { AU.ctx.resume(); } catch (e) {} }
      return AU.ctx;
    },
    tone(f, t0, dur, wave, vol) {
      const ctx = AU.ensure(); if (!ctx) return;
      try {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = wave || "sine"; o.frequency.value = f;
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(vol, t0 + 0.015);
        g.gain.setValueAtTime(vol, t0 + Math.max(0.03, dur - 0.05));
        g.gain.linearRampToValueAtTime(0, t0 + dur);
        o.connect(g); g.connect(AU.master);
        o.start(t0); o.stop(t0 + dur + 0.02);
      } catch (e) {}
    },
    hoot() { // soft "hoo… hoo-hoo" — night owl
      const c = AU.ensure(); if (!c) return;
      const t0 = c.currentTime + 0.03;
      AU.tone(392, t0, 0.22, "sine", 0.09);
      AU.tone(349, t0 + 0.38, 0.16, "sine", 0.08);
      AU.tone(330, t0 + 0.62, 0.34, "sine", 0.09);
    },
    cicada() { // summer "min-min" — a bright pulse train with a falling tail
      const c = AU.ensure(); if (!c) return;
      const t0 = c.currentTime + 0.03;
      for (let i = 0; i < 9; i++)
        AU.tone(4300 + i * 55, t0 + i * 0.12, 0.07, "sawtooth", 0.028);
      AU.tone(3700, t0 + 1.1, 0.3, "sawtooth", 0.022);
    },
    birdsong() { // dawn jingle — cheerful chirps
      const c = AU.ensure(); if (!c) return;
      const t0 = c.currentTime + 0.04, bs = 60 / 340;
      const notes = [[0, 84, .16], [.22, 88, .16], [.44, 86, .2], [.72, 91, .34], [1.2, 88, .18], [1.5, 84, .5]];
      for (const [b, m, l] of notes) {
        const f = 440 * Math.pow(2, (m - 69) / 12);
        AU.tone(f, t0 + b * bs, l * bs, "triangle", 0.15);
      }
    },
  };

  // ---------- FX (wall-clock; guests animate without update()) ----------
  function fxP(k, x, y, o) {
    if (fx.length < 90) fx.push(Object.assign({ k, x, y, vx: 0, vy: -22, born: Date.now(), ttl: 1 }, o));
  }
  function hearts(x, y, n = 2) { for (let i = 0; i < n; i++) fxP("heart", x + rnd(-10, 10), y - 14 + rnd(-6, 0), { ttl: 0.9 }); }
  function sparkles(x, y, n = 6) { for (let i = 0; i < n; i++) fxP("spark", x + rnd(-16, 16), y - rnd(2, 26), { vy: -10, ttl: rnd(0.5, 1) }); }
  function leafBurst(x, y, n = 10) { for (let i = 0; i < n; i++) fxP("leaf", x + rnd(-10, 10), y - rnd(0, 8), { vx: rnd(-46, 46), vy: rnd(-60, -14), ttl: rnd(0.7, 1.2), c: pick(["#d18a2e", "#c2541e", "#e8a03c", "#a8622a"]) }); }
  function puff(x, y) { for (let i = 0; i < 4; i++) fxP("puff", x + rnd(-8, 8), y - rnd(0, 6), { vx: rnd(-14, 14), vy: rnd(-26, -8), ttl: rnd(0.4, 0.7) }); }
  function waveFx(x, y) { fxP("wave", x, y, { vy: -16, ttl: 1.6 }); }
  function say(key, txt, ms = 2600) { bub[key] = { txt, until: Date.now() + ms }; }

  // ---------- toast queue (Terry greetings etc.) ----------
  function queueToasts(msgs, firstDelay = 300) {
    TQ.list.push(...msgs);
    if (!TQ.at) TQ.at = Date.now() + firstDelay;
  }
  function pumpToasts() {
    if (TQ.list.length && Date.now() >= TQ.at) {
      DH.toast(TQ.list.shift(), 3400);
      TQ.at = TQ.list.length ? Date.now() + 3800 : 0;
    }
  }

  // ---------- P-5 arrival ----------
  function beginArrival() {
    S.arrived = true;
    AR.t0 = Date.now();
    alog("misc_arrive");
    if (DH.save) DH.save.now();
  }
  function afterArrival() {
    const ps = (gs && gs.players) || [];
    const n0 = (ps[0] && ps[0].name) || "koto", n1 = (ps[1] && ps[1].name) || "zuza";
    queueToasts([
      `Terry: "Welcome to Dream Home, ${n0} & ${n1}! I'm Terry — your island guide 🦝"`,
      `Terry: "Drag to walk, tap A to act. This island is yours now — enjoy!"`,
      `Terry: "Find me by the bulletin board if you need anything. Have a dreamy day!"`,
    ]);
  }

  // ---------- P-5 departure (partner disconnect) ----------
  function depart() {
    const idx = M.authority ? 1 : 0;
    const p = (gs && gs.players || [])[idx];
    const nm = (p && p.name) || (idx ? "zuza" : "koto");
    DH.toast(`${nm} waved goodbye 👋`, 3600);
    if (p) waveFx(p.x, p.y - 26);
    alog("misc_bye", nm);
  }
  function pollNet() {
    const n = DH.net;
    if (!n) return;
    if (n.role === "host") {
      const duo = n.online && !!n._duo;
      if (prevDuo && !duo) depart();
      prevDuo = duo;
    } else if (n.role === "guest") {
      const on = n.online && !!n._synced;
      if (prevGuestOn && !on) depart();
      prevGuestOn = on;
    }
  }

  // ---------- yard spots ----------
  const yardCache = [];
  function yardTiles() {
    if (!yardCache.length) {
      const W = DH.world;
      for (let ty = 0; ty < W.H; ty++)
        for (let tx = 0; tx < W.W; tx++)
          if (W.zone(tx, ty) === "yard" && !W.isSolid(tx, ty))
            yardCache.push({ x: tx * T + 16, y: ty * T + 16 });
    }
    return yardCache;
  }
  function freeYardSpot() {
    const ts = yardTiles();
    if (!ts.length) return null;
    const t = pick(ts);
    return { x: t.x + rnd(-6, 6), y: t.y + rnd(-6, 6) };
  }
  function spawnPiles() {
    S.leafPiles = [];
    for (let i = 0; i < PILES_PER_DAY; i++) {
      const s = freeYardSpot();
      if (s) S.leafPiles.push(Object.assign({ id: "l" + S.nextId++ }, s));
    }
  }
  function topUpSnowballs() {
    while (S.snowballs.length < BALLS_PER_DAY) {
      const s = freeYardSpot();
      if (!s) break;
      S.snowballs.push(Object.assign({ id: "b" + S.nextId++, r: 7 }, s));
    }
  }
  function newDay() {
    const sn = season();
    if (sn === "autumn") spawnPiles();
    if (sn === "winter" && !S.snowman) topUpSnowballs();
  }

  // ---------- mutations (named + remote-callable) ----------
  const API = {
    kickPile(id) {
      const i = S.leafPiles.findIndex(p => p.id === id);
      if (i < 0 || !gs) return false;
      const p = S.leafPiles[i];
      S.leafPiles.splice(i, 1);
      leafBurst(p.x, p.y, 12);
      addHappy(0.5);
      const r = Math.random();
      let msg = "🍂 Whoooosh — leaves everywhere!";
      if (r < 0.30 && DH.inv.add("maple-leaf", 1) > 0)
        msg = "🍁 A pretty maple leaf fell into your pocket!";
      else if (r < 0.38 && DH.items.get("acorn") && DH.inv.add("acorn", 1) > 0)
        msg = "🌰 An acorn was hiding in the pile!";
      DH.toast(msg, 2400);
      alog("misc_kick");
      return true;
    },
    rollSnow(id, px, py) {
      const b = S.snowballs.find(b2 => b2.id === id);
      if (!b || !gs) return false;
      let dx = px == null ? 0 : b.x - px, dy = py == null ? 0 : b.y - py;
      const d = Math.hypot(dx, dy) || 1;
      dx /= d; dy /= d;
      const nx = b.x + dx * 15, ny = b.y + dy * 15;
      if (DH.world.canStand(nx, b.y)) b.x = nx;
      if (DH.world.canStand(b.x, ny)) b.y = ny;
      b.r = Math.min(BALL_MAX, b.r + BALL_GROW);
      puff(b.x, b.y);
      const o = S.snowballs.find(b2 => b2 !== b && dist2(b2.x, b2.y, b.x, b.y) < (b.r + b2.r + MERGE_R) * (b.r + b2.r + MERGE_R));
      if (o) {
        if (b.r >= BALL_MIN_MERGE && o.r >= BALL_MIN_MERGE) {
          S.snowman = { id: "s" + S.nextId++, x: (b.x + o.x) / 2, y: (b.y + o.y) / 2, bornDay: gs.day || 0, meltDay: (gs.day || 0) + SNOWMAN_DAYS };
          S.snowballs = S.snowballs.filter(b2 => b2 !== b && b2 !== o);
          sparkles(S.snowman.x, S.snowman.y - 18, 12);
          addHappy(3);
          say("snowman", "hello!! ☃️", 3200);
          DH.toast("⛄ You built a snowman! It'll keep you company for a couple of days.", 3800);
          alog("misc_snowman");
          if (DH.save) DH.save.now();
        } else if (Date.now() - hintT > 6000) {
          hintT = Date.now();
          DH.toast("Keep rolling — both snowballs need to be bigger! ⛄", 2600);
        }
      }
      return true;
    },
    greetSnowman() {
      const m = S.snowman;
      if (!m || !gs) return false;
      say("snowman", pick(SNOW_GREETS), 3200);
      hearts(m.x, m.y - 30, 2);
      addHappy(0.5);
      alog("misc_greet");
      return true;
    },
    arrival() { beginArrival(); return true; }, // replay/debug hook
  };

  // ---------- ambient scheduler (wall-clock; runs on host + guest) ----------
  function ambientTick() {
    const t = timeMin(), now = Date.now(), sn = season();
    AMB.season = sn;
    AMB.night = t >= 21 * 60 || t < 5 * 60;
    AMB.daypart = t < 330 ? "night" : t < 660 ? "morning" : t < 1050 ? "day" : t < 1140 ? "evening" : "night";
    AMB.petals = sn === "spring";
    AMB.butterflies = sn !== "winter" && t >= 6 * 60 && t < 18 * 60;
    AMB.fireflies = sn === "summer" && (t >= 19.5 * 60 || t < 4 * 60);
    AMB.snow = sn === "winter";
    AMB.leafDrift = sn === "autumn";
    AMB.owls = AMB.night;
    AMB.cicadas = sn === "summer" && t >= 8 * 60 && t < 19 * 60;
    if (!gs || !gs.running || gs.paused) { lastTm = t; return; }
    if (AMB.owls && now > nextHoot) { nextHoot = now + rnd(18000, 36000); AU.hoot(); }
    if (AMB.cicadas && now > nextCicada) { nextCicada = now + rnd(4000, 9000); AU.cicada(); }
    if (lastTm >= 0 && lastTm < 360 && t >= 360 && birdDay !== dayStamp()) {
      birdDay = dayStamp(); AU.birdsong();
    }
    lastTm = t;
  }

  // ---------- module contract ----------
  const M = (DH.misc = {
    authority: true,
    _S: S,
    ambient: AMB,   // A-1: live ambient flags other modules may read

    init(state) {
      gs = state;
      M.authority = !(DH.net && DH.net.online && DH.net.role === "guest");
      // tap anywhere skips the arrival card
      const cv = document.getElementById("cv");
      if (cv && !cv._miscTap) {
        cv._miscTap = 1;
        cv.addEventListener("pointerdown", () => { if (AR.t0) AR.t0 = Date.now() - (AR_DUR + 0.05) * 1000; });
      }
    },

    start(state) {
      gs = state;
      M.authority = !(DH.net && DH.net.online && DH.net.role === "guest");
      fx.length = 0;
      for (const k in bub) delete bub[k];
      prevDuo = !!(DH.net && DH.net.online && DH.net.role === "host" && DH.net._duo);
      prevGuestOn = !!(DH.net && DH.net.online && DH.net.role === "guest" && DH.net._synced);
      saveT = 0;
      if (!S.arrived) beginArrival(); // P-5: first load for this save
    },

    update(dt, state) {
      gs = state;
      pollNet();
      pumpToasts();
      if (!M.authority) return;
      saveT += dt;
      if (saveT >= SAVE_EVERY) { saveT = 0; DH.save.now(); }
      const ds = dayStamp();
      if (ds !== S.lastDay) { S.lastDay = ds; newDay(); }
      // season housekeeping (idempotent, cheap)
      const sn = season();
      if (sn !== "autumn" && S.leafPiles.length) S.leafPiles = [];
      if (sn !== "winter") {
        if (S.snowballs.length) S.snowballs = [];
        if (S.snowman) { S.snowman = null; DH.toast("⛄ the snowman waved goodbye until next winter…", 3200); }
      }
      // snowman melt (game-day clock)
      if (S.snowman && gs.day >= S.snowman.meltDay) {
        S.snowman = null;
        DH.toast("⛄ the snowman melted away… see you next snowfall!", 3400);
        alog("misc_melt");
      }
    },

    offline(offMin) {
      const parts = [];
      if (offMin >= 720) { // half a real day away — seasonal folk move on
        if (S.snowman) { S.snowman = null; parts.push("the snowman melted ⛄"); }
        if (S.leafPiles.length) { S.leafPiles = []; parts.push("the leaf piles blew away 🍂"); }
        if (S.snowballs.length) S.snowballs = [];
      }
      return parts;
    },

    interactables(p) {
      const out = [];
      if (!gs || !gs.running) return out;
      for (const lp of S.leafPiles) {
        const d = dist2(p.x, p.y, lp.x, lp.y);
        if (d < INTERACT_R * INTERACT_R)
          out.push({ label: "Kick leaves 🍂", x: lp.x, y: lp.y, d2: d, action: () => API.kickPile(lp.id) });
      }
      for (const b of S.snowballs) {
        const d = dist2(p.x, p.y, b.x, b.y);
        if (d < 38 * 38)
          out.push({ label: "Roll snowball ⛄", x: b.x, y: b.y, d2: d, action: () => API.rollSnow(b.id, p.x, p.y) });
      }
      if (S.snowman) {
        const m = S.snowman, d = dist2(p.x, p.y, m.x, m.y);
        if (d < 46 * 46)
          out.push({ label: "Say hi to the snowman ⛄", x: m.x, y: m.y, d2: d, action: () => API.greetSnowman() });
      }
      out.sort((a, b) => a.d2 - b.d2);
      return out;
    },

    collectDraws(draws, camX, camY) {
      if (!ctx2) ctx2 = document.getElementById("cv").getContext("2d");
      for (const lp of S.leafPiles)
        draws.push({ y: lp.y + 4, fn: () => drawPile(ctx2, lp.x - camX, lp.y - camY) });
      for (const b of S.snowballs)
        draws.push({ y: b.y + 4, fn: () => { DH.sprites.shadow(ctx2, b.x - camX, b.y - camY, b.r * 1.6); drawSnowball(ctx2, b.x - camX, b.y - camY, b.r); } });
      if (S.snowman) {
        const m = S.snowman;
        draws.push({ y: m.y + 6, fn: () => { DH.sprites.shadow(ctx2, m.x - camX, m.y - camY, 22); drawSnowman(ctx2, m, m.x - camX, m.y - camY); } });
      }
    },

    drawOverlay(ctx, camX, camY, state) {
      ctx2 = ctx;
      ambientTick();
      pollNet();     // guests never get update() — poll the link here
      pumpToasts();
      if (!gs || !gs.running) return;
      const now = Date.now();
      drawAmbientFx(ctx, camX, camY, now);
      // ambient snowman greeting when a player wanders close
      if (S.snowman && now > nextGreet &&
          (gs.players || []).some(p => dist2(p.x, p.y, S.snowman.x, S.snowman.y) < 70 * 70)) {
        nextGreet = now + rnd(15000, 24000);
        say("snowman", pick(SNOW_GREETS), 3000);
        if (Math.random() < 0.5) hearts(S.snowman.x, S.snowman.y - 30, 1);
      }
      drawBubbles(ctx, camX, camY);
      drawFx(ctx, camX, camY);
      if (AR.t0) drawArrival(ctx, now);
    },

    // ----- sync boundary -----
    serialize() {
      return JSON.parse(JSON.stringify({
        arrived: S.arrived, leafPiles: S.leafPiles, snowballs: S.snowballs,
        snowman: S.snowman, nextId: S.nextId, lastDay: S.lastDay,
      }));
    },
    deserialize(d) {
      if (!d || typeof d !== "object") return;
      if (typeof d.arrived === "boolean") S.arrived = d.arrived;
      if (Array.isArray(d.leafPiles)) S.leafPiles = d.leafPiles.filter(p => p && typeof p.x === "number");
      if (Array.isArray(d.snowballs)) S.snowballs = d.snowballs.filter(b => b && typeof b.x === "number" && typeof b.r === "number");
      if ("snowman" in d)
        S.snowman = d.snowman ? Object.assign({ id: "s0", x: 0, y: 0, bornDay: 0, meltDay: 0 }, d.snowman) : null;
      if (typeof d.nextId === "number") S.nextId = d.nextId;
      if (typeof d.lastDay === "number") S.lastDay = d.lastDay;
    },
    remoteAction(name, args) {
      return typeof API[name] === "function" ? API[name].apply(null, args || []) : false;
    },

    // exposed API (menus + console/tests)
    kickPile: API.kickPile, rollSnow: API.rollSnow, greetSnowman: API.greetSnowman,
    arrival: API.arrival, spawnPiles, topUpSnowballs,
  });

  // ---------- drawing ----------
  const R = (ctx, x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawPile(ctx, x, y) {
    R(ctx, x - 13, y - 7, 26, 7, "#8a5a28");
    R(ctx, x - 10, y - 10, 20, 4, "#a86a2e");
    R(ctx, x - 7, y - 12, 14, 3, "#c27a30");
    R(ctx, x - 11, y - 9, 4, 2, "#d18a2e"); R(ctx, x + 7, y - 8, 4, 2, "#c2541e");
    R(ctx, x - 3, y - 13, 4, 2, "#e8a03c"); R(ctx, x + 4, y - 6, 3, 2, "#d18a2e");
    R(ctx, x - 8, y - 5, 3, 2, "#c2541e"); R(ctx, x + 10, y - 4, 3, 2, "#e8a03c");
  }

  function drawSnowball(ctx, x, y, r) {
    R(ctx, x - r, y - r * 0.9, r * 2, r * 1.6, "#eef4fd");
    R(ctx, x - r + 1, y - r * 0.9, r * 2 - 2, 3, "#fbfdff");
    R(ctx, x - r, y + r * 0.45, r * 2, 3, "#cfdeee");
  }

  function drawSnowman(ctx, m, x, y) {
    const left = m.meltDay - ((gs && gs.day) || 0);
    const melt = clamp(1 - left / 0.6, 0, 1); // 0 = fresh, →1 melting
    const sq = 1 - melt * 0.5;
    if (melt > 0.1) { // melt puddle
      ctx.fillStyle = `rgba(190,215,235,${0.7 * melt})`;
      ctx.beginPath(); ctx.ellipse(x, y + 1, 16 + melt * 8, 4, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, sq);
    const tint = melt > 0.5 ? "#e2ecf6" : "#f4f8ff";
    R(ctx, -12, -14, 24, 14, tint);                    // bottom ball
    R(ctx, -12, -3, 24, 3, "#d4e2f0");                 // base shade
    R(ctx, -8, -26, 16, 13, "#f8fbff");                // head
    R(ctx, -8, -26, 16, 3, "#ffffff");                 // head lit edge
    R(ctx, -4, -23, 2, 2, "#241a24"); R(ctx, 2, -23, 2, 2, "#241a24"); // eyes
    R(ctx, -1, -20, 6, 2, "#e8862a");                  // carrot nose
    R(ctx, -7, -15, 14, 3, "#e04848"); R(ctx, 3, -15, 4, 9, "#c23c3c"); // scarf
    R(ctx, -1, -10, 2, 2, "#241a24"); R(ctx, -1, -6, 2, 2, "#241a24");  // buttons
    ctx.strokeStyle = "#6e4a2a"; ctx.lineWidth = 2;    // stick arms
    ctx.beginPath();
    ctx.moveTo(-12, -12); ctx.lineTo(-20, -18 - melt * -4);
    ctx.moveTo(12, -12); ctx.lineTo(20, -18);
    ctx.stroke();
    ctx.restore();
  }

  function drawBubbles(ctx, camX, camY) {
    const now = Date.now();
    const spots = { snowman: S.snowman };
    for (const k in bub) {
      const b = bub[k], s = spots[k];
      if (!b || b.until < now || !b.txt || !s) continue;
      const x = s.x - camX, y = s.y - 48 - camY;
      ctx.font = "bold 8px sans-serif";
      const w = Math.max(20, ctx.measureText(b.txt).width + 8);
      ctx.fillStyle = "#ffffffee";
      ctx.fillRect(x - w / 2, y - 13, w, 13);
      ctx.fillRect(x - w / 2 + 2, y - 15, w - 4, 2);
      ctx.fillRect(x - 2, y, 4, 4);
      ctx.fillStyle = "#4a3a2a"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(b.txt, x, y - 6);
      ctx.textBaseline = "alphabetic";
    }
  }

  function drawFx(ctx, camX, camY) {
    const now = Date.now();
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i], age = (now - f.born) / 1000;
      if (age >= f.ttl) { fx.splice(i, 1); continue; }
      const a = 1 - age / f.ttl;
      const x = f.x + f.vx * age - camX, y = f.y + f.vy * age - camY;
      ctx.save(); ctx.globalAlpha = Math.max(0, a);
      if (f.k === "heart") DH.sprites.heart(ctx, x, y, 5);
      else if (f.k === "spark") {
        ctx.fillStyle = "#ffe89a";
        R(ctx, x - 3, y - 0.7, 6, 1.4, "#ffe89a"); R(ctx, x - 0.7, y - 3, 1.4, 6, "#ffe89a");
      } else if (f.k === "leaf") {
        R(ctx, x - 2, y - 1, 4, 2, f.c || "#d18a2e");
        R(ctx, x - 1, y - 2, 2, 3, f.c || "#d18a2e");
      } else if (f.k === "puff") {
        ctx.fillStyle = "rgba(235,242,252,0.8)";
        ctx.beginPath(); ctx.arc(x, y, 3 + age * 4, 0, Math.PI * 2); ctx.fill();
      } else if (f.k === "wave") {
        ctx.font = "14px sans-serif"; ctx.textAlign = "center";
        ctx.fillText("👋", x, y - age * 8);
      }
      ctx.restore();
    }
  }

  // ---------- ambient particles (procedural — identical on both phones) ----------
  function drawAmbientFx(ctx, camX, camY, now) {
    const vw = ctx.canvas.width, vh = ctx.canvas.height;
    ctx.save();
    // A-2 spring: sakura petals drifting (lighter than sakura-week's shower)
    if (AMB.petals) {
      ctx.fillStyle = "#ffc7dd";
      for (let i = 0; i < 15; i++) {
        const hx = ((i * 887) % 1600) / 1600, hy = ((i * 553) % 1600) / 1600;
        const px = (hx * (vw + 140) + now / 1000 * 18 + Math.sin(now / 800 + i) * 18) % (vw + 140) - 70;
        const py = ((hy * (vh + 90) + now / 1000 * 13) % (vh + 90)) - 45;
        ctx.globalAlpha = 0.6;
        ctx.fillRect(px, py + Math.sin(now / 320 + i) * 2, 2.6, 2);
      }
      ctx.globalAlpha = 1;
    }
    // A-1 butterflies by day (supplements the world's lone garden butterfly)
    if (AMB.butterflies) {
      const B = [
        { cx: 13 * T, cy: 12 * T, c: "#8fd0ff", ph: 0 },
        { cx: 24.5 * T, cy: 10.5 * T, c: "#ff9ec4", ph: 2.2 },
        { cx: 19 * T, cy: 14.5 * T, c: "#ffd76b", ph: 4.4 },
      ];
      for (const b of B) {
        const bx = b.cx + Math.sin(now / 1500 + b.ph) * 76 - camX;
        const by = b.cy + Math.cos(now / 1150 + b.ph * 1.3) * 44 - camY;
        const flap = Math.abs(Math.sin(now / 60 + b.ph)) * 0.7 + 0.3;
        ctx.fillStyle = b.c;
        ctx.beginPath(); ctx.ellipse(bx - 3.5, by, 3.5, 5 * flap, -0.4, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(bx + 3.5, by, 3.5, 5 * flap, 0.4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#4a3a2a"; ctx.fillRect(bx - 0.8, by - 4, 1.6, 8);
      }
    }
    // A-1 fireflies at summer dusk/night — glowing wanderers by pond + yard
    if (AMB.fireflies) {
      for (let i = 0; i < 15; i++) {
        const hx = ((i * 733) % 1600) / 1600, hy = ((i * 457) % 1600) / 1600;
        const pond = i % 3 === 0;
        const bx = pond ? 22 * T + hx * 7 * T : 10 * T + hx * 18 * T;
        const by = pond ? 13 * T + hy * 5 * T : 11 * T + hy * 7 * T;
        const gx = bx + Math.sin(now / 900 + i * 2.1) * 15 - camX;
        const gy = by + Math.cos(now / 750 + i * 1.4) * 10 - camY;
        const glow = 0.3 + 0.7 * Math.abs(Math.sin(now / 480 + i * 2.3));
        ctx.globalAlpha = glow * 0.35;
        ctx.fillStyle = "#eaffa0";
        ctx.beginPath(); ctx.arc(gx, gy, 3.4, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = glow;
        ctx.fillRect(gx - 1, gy - 1, 2, 2);
      }
      ctx.globalAlpha = 1;
    }
    // A-1/A-2 winter: sparse flakes settling + glints where they land
    if (AMB.snow) {
      for (let i = 0; i < 18; i++) {
        const hx = ((i * 997) % 1600) / 1600, hy = ((i * 613) % 1600) / 1600;
        const px = (hx * (vw + 80) - 40) + Math.sin(now / 1100 + i) * 12;
        const py = ((hy * (vh + 100) + now / 1000 * 15) % (vh + 100)) - 50;
        ctx.fillStyle = "rgba(245,250,255,0.65)";
        ctx.fillRect(px, py, 2, 2);
      }
      for (let i = 0; i < 8; i++) { // settled glints
        const hx = ((i * 389) % 1600) / 1600;
        const gx = hx * vw, gy = vh * 0.55 + ((i * 211) % 400) / 400 * vh * 0.4;
        ctx.globalAlpha = 0.15 + 0.35 * Math.abs(Math.sin(now / 700 + i * 1.7));
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(gx, gy, 2, 2);
      }
      ctx.globalAlpha = 1;
    }
    // A-2 autumn: occasional leaves fluttering past
    if (AMB.leafDrift) {
      for (let i = 0; i < 9; i++) {
        const hx = ((i * 677) % 1600) / 1600, hy = ((i * 439) % 1600) / 1600;
        const px = (hx * (vw + 120) + now / 1000 * 26 + Math.sin(now / 500 + i * 2) * 22) % (vw + 120) - 60;
        const py = ((hy * (vh + 80) + now / 1000 * 17) % (vh + 80)) - 40;
        ctx.fillStyle = ["#d18a2e", "#c2541e", "#a8622a"][i % 3];
        ctx.globalAlpha = 0.8;
        ctx.fillRect(px, py, 3, 2);
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  // ---------- P-5 arrival sequence (canvas overlay, wall-clock) ----------
  function drawPlane(ctx, x, y, s) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    R(ctx, -30, -8, 52, 14, "#f2f4f8");                 // fuselage
    R(ctx, -30, -8, 52, 4, "#d4dae6");
    R(ctx, 18, -6, 10, 10, "#e04848");                  // nose
    R(ctx, -38, -14, 12, 10, "#e04848");                // tail fin
    R(ctx, -36, -4, 10, 6, "#d4dae6");                  // tail wing
    R(ctx, -8, -19, 14, 11, "#d4dae6");                 // top wing
    R(ctx, -6, -21, 10, 3, "#f2f4f8");
    R(ctx, -4, 6, 16, 8, "#d4dae6");                    // bottom wing
    for (let i = 0; i < 5; i++) R(ctx, -24 + i * 8, -4, 4, 3, "#5a7ab8"); // windows
    ctx.fillStyle = "rgba(200,210,225,0.85)";
    ctx.fillRect(24, -12, 3, 20);                       // prop blur
    ctx.restore();
  }

  function drawArrival(ctx, now) {
    const el = (now - AR.t0) / 1000;
    const cw = ctx.canvas.width, ch = ctx.canvas.height;
    if (el >= AR_DUR) { AR.t0 = 0; afterArrival(); return; }
    if (el < 3) {
      // --- phase 1: plane landing (3s) ---
      const g = ctx.createLinearGradient(0, 0, 0, ch);
      g.addColorStop(0, "#1c2a52"); g.addColorStop(0.62, "#5a7ab8"); g.addColorStop(1, "#ffd9a0");
      ctx.fillStyle = g; ctx.fillRect(0, 0, cw, ch);
      // clouds
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      for (let i = 0; i < 4; i++) {
        const cx = ((i * 240 + now * 0.02) % (cw + 160)) - 80;
        ctx.fillRect(cx, 30 + i * 26, 46, 9); ctx.fillRect(cx + 8, 24 + i * 26, 26, 7);
      }
      // runway
      const ry = ch * 0.72;
      ctx.fillStyle = "#3a3f4a"; ctx.fillRect(0, ry, cw, ch - ry);
      ctx.fillStyle = "#2c3038"; ctx.fillRect(0, ry, cw, 3);
      const dashV = Math.max(0, 3 - el); // stripes rush by, easing to a stop
      ctx.fillStyle = "#ffe9b0";
      for (let i = 0; i < 10; i++) {
        const sx = ((i * 90 - now * 0.09 * dashV * dashV) % (cw + 90) + cw + 90) % (cw + 90) - 45;
        ctx.fillRect(sx, ry + (ch - ry) / 2 - 3, 40, 6);
      }
      // the plane eases down onto the runway
      const k = Math.min(1, el / 2.6);
      const ease = 1 - Math.pow(1 - k, 3);
      const px = cw * 0.86 - ease * cw * 0.36;
      const py = ch * 0.10 + ease * (ry - ch * 0.10 - 14);
      drawPlane(ctx, px, py, 1 + (1 - k) * 0.35);
      if (k >= 1 && Math.random() < 0.4) {
        ctx.fillStyle = "rgba(230,235,245,0.5)";
        ctx.fillRect(px - 30 - Math.random() * 20, ry + 2, 8, 3);
      }
      ctx.fillStyle = "#ffffffcc"; ctx.font = "bold 11px sans-serif"; ctx.textAlign = "center";
      ctx.fillText("✈️ arriving at Dream Home…", cw / 2, ch - 16);
    } else {
      // --- phase 2: welcome card ---
      const k2 = Math.min(1, (el - 3) / 0.5);
      const fade = el > AR_DUR - 0.6 ? Math.max(0, (AR_DUR - el) / 0.6) : 1;
      ctx.fillStyle = `rgba(16,18,38,${0.62 * fade})`;
      ctx.fillRect(0, 0, cw, ch);
      const sc = 0.6 + 0.4 * (1 - Math.pow(1 - k2, 3));
      ctx.save();
      ctx.translate(cw / 2, ch / 2);
      ctx.scale(sc, sc);
      ctx.globalAlpha = fade;
      const w = Math.min(300, cw * 0.84), h = 126;
      ctx.fillStyle = "#23233d";
      roundRect(ctx, -w / 2, -h / 2, w, h, 16); ctx.fill();
      ctx.strokeStyle = "#ffd76b"; ctx.lineWidth = 3;
      roundRect(ctx, -w / 2 + 4, -h / 2 + 4, w - 8, h - 8, 12); ctx.stroke();
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = "#ffe9b0"; ctx.font = "bold 17px sans-serif";
      ctx.fillText("🏡 Welcome to", 0, -36);
      ctx.fillStyle = "#ffffff"; ctx.font = "bold 26px sans-serif";
      ctx.fillText("Dream Home", 0, -8);
      const ps = (gs && gs.players) || [];
      const n0 = (ps[0] && ps[0].name) || "koto", n1 = (ps[1] && ps[1].name) || "zuza";
      ctx.fillStyle = "#b9c4e8"; ctx.font = "12px sans-serif";
      ctx.fillText(`${n0} & ${n1}'s island getaway`, 0, 20);
      ctx.fillStyle = "#8fd0ff"; ctx.font = "11px sans-serif";
      ctx.fillText("✈️ arrived · day 1", 0, 42);
      ctx.restore();
      ctx.globalAlpha = 1;
    }
  }
})();

DH.register("misc", DH.misc);
