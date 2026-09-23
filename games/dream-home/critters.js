/* dream-home critters module — fishing, bug net, pond diving + critterpedia.
   Specs: B-5 (pond fishing: cast → shadow nibble → timed reel), B-6 (bugs with
   a swing net), B-7 (pond diving for sea creatures), J-2 (critterpedia board).

   Contract with game.js (same as other modules):
     DH.critters.init(state) / start(state) / update(dt,state)
     DH.critters.drawGround(ctx,camX,camY,state)   – pond surface (fish shadows,
       bobber, bubbles, dock) drawn under entities
     DH.critters.collectDraws(draws,camX,camY)     – critterpedia sign (y-sorted)
     DH.critters.drawOverlay(ctx,camX,camY,state)  – fx, nibble "!", net swoosh,
       swimmer waterline
     DH.critters.interactables(p) -> [{label,x,y,action}]
     DH.critters.serialize()/deserialize(d)        – plain-JSON save+net state
     DH.critters.remoteAction(name,args)           – guest-callable API
     DH.critters.offline(offMin) -> []             – ambient world, nothing decays

   Pond = water tiles x22..27, y13..17. Fishing works from shore tiles around it
   EXCEPT the west column (tx<22) so it never shadows sauna's plunge-pool action.
   "Dive in" lives on a small dock drawn at tile (24,12); the critterpedia sign
   sits at (26,12). Spawn tables gate on state.timeMin + state.season; spawns
   refresh on day change and species despawn when their window closes.

   Swimming: DH.world.canStand is wrapped once (in init) so water near a flagged
   swimmer is standable for them. Anyone who ends up standing on water is
   auto-flagged swimming and must reach shore to climb out — guests inherit the
   flag through module snapshots and never run update() (host-authoritative,
   same pattern as animals.js).
*/
(function () {
  const DH = (window.DH = window.DH || {});
  const T = 32;

  // ---------- layout ----------
  const POND = { x1: 22 * T, y1: 13 * T, x2: 28 * T, y2: 18 * T };        // water px rect
  const POND_IN = { x1: POND.x1 + 8, y1: POND.y1 + 8, x2: POND.x2 - 8, y2: POND.y2 - 8 };
  const DOCK = { tx: 24, ty: 12 };                                       // dive spot (north shore)
  const DOCK_P = { x: DOCK.tx * T + 16, y: DOCK.ty * T + 16 };
  const SIGN = { x: 26 * T + 16, y: 12 * T + 18, r: 48 };                // critterpedia board

  // ---------- tuning ----------
  const FISH_TGT = 4, FISH_TGT_NIGHT = 3;
  const BUG_TGT = 5, BUG_TGT_NIGHT = 3;
  const BUB_TGT = 4;
  const LURE_R = 84;          // fish notices a bobber within this range
  const BITE_T = 0.95;        // nibble window (seconds)
  const NET_REACH = 30;       // net tip offset ahead of the player
  const NET_R = 27;           // catch radius at net tip
  const SCARE_R = 80;         // missed swing scatters bugs within this
  const SWIM_K = 0.45;        // fraction of normal move speed while swimming
  const BUB_R = 30;           // dive-catch radius
  const JUNK_CH = 0.07;       // chance a "fish" is an old boot / can
  const NIGHT_FROM = 21 * 60, NIGHT_TO = 6 * 60;
  const DAY = 24 * 60;

  // ---------- catalogs (registered into DH.items at load) ----------
  // hrs = [from,to] game-minutes, may wrap midnight; null = all day.
  // ssn = season list; null = all year. w = spawn weight. sz = shadow size.
  const FISH = [
    { id: "fish-crucian",  name: "Crucian Carp",  ico: "🐟", price: 25,   sz: "s",   w: 26, hrs: null,        ssn: null },
    { id: "fish-carp",     name: "Carp",          ico: "🐟", price: 60,   sz: "m",   w: 20, hrs: null,        ssn: null },
    { id: "fish-bluegill", name: "Bluegill",      ico: "🐟", price: 45,   sz: "s",   w: 20, hrs: [540, 960],  ssn: null },
    { id: "fish-bass",     name: "Black Bass",    ico: "🐟", price: 130,  sz: "m",   w: 13, hrs: null,        ssn: null },
    { id: "fish-smelt",    name: "Pond Smelt",    ico: "🐟", price: 50,   sz: "s",   w: 16, hrs: null,        ssn: ["autumn", "winter"] },
    { id: "fish-catfish",  name: "Catfish",       ico: "🐟", price: 140,  sz: "m",   w: 11, hrs: [960, 540],  ssn: ["summer", "autumn"] },
    { id: "fish-eel",      name: "Eel",           ico: "🐍", price: 180,  sz: "l",   w: 7,  hrs: [1020, 240], ssn: ["summer", "autumn"] },
    { id: "fish-salmon",   name: "Salmon",        ico: "🐟", price: 200,  sz: "m",   w: 9,  hrs: null,        ssn: ["autumn"] },
    { id: "fish-koi",      name: "Koi",           ico: "🎏", price: 400,  sz: "l",   w: 5,  hrs: [960, 600],  ssn: null },
    { id: "fish-goldfish", name: "Goldfish",      ico: "🐠", price: 380,  sz: "s",   w: 4,  hrs: null,        ssn: null },
    { id: "fish-sturgeon", name: "Sturgeon",      ico: "🦈", price: 1500, sz: "fin", w: 2,  hrs: [360, 1140], ssn: ["autumn", "winter"] },
    { id: "fish-frog",     name: "Frog",          ico: "🐸", price: 90,   sz: "s",   w: 8,  hrs: [600, 1200], ssn: ["spring", "summer"] },
  ];
  // zones: yard (south lawn), garden (flowerbeds), pond (over the water edge)
  const BUGS = [
    { id: "bug-butterfly", name: "Common Butterfly",  ico: "🦋", price: 30,  w: 24, zones: ["yard", "garden"],  hrs: [360, 1080],  ssn: ["spring", "summer", "autumn"], spd: 26, sh: "butter", c: "#f2f2f2" },
    { id: "bug-yellowfly", name: "Yellow Butterfly",  ico: "🦋", price: 45,  w: 18, zones: ["yard", "garden"],  hrs: [330, 1080],  ssn: null,                           spd: 28, sh: "butter", c: "#ffd94d" },
    { id: "bug-monarch",   name: "Monarch",           ico: "🦋", price: 140, w: 8,  zones: ["garden", "yard"],  hrs: [360, 1020],  ssn: ["autumn"],                     spd: 30, sh: "butter", c: "#ff8c3a" },
    { id: "bug-dragonfly", name: "Red Dragonfly",     ico: "🪰", price: 180, w: 8,  zones: ["pond"],            hrs: [480, 1140],  ssn: ["summer", "autumn"],           spd: 64, sh: "dragon", c: "#e05b5b" },
    { id: "bug-darner",    name: "Darner Dragonfly",  ico: "🪰", price: 230, w: 6,  zones: ["pond"],            hrs: [480, 1080],  ssn: null,                           spd: 70, sh: "dragon", c: "#5ba3e0" },
    { id: "bug-honeybee",  name: "Honeybee",          ico: "🐝", price: 100, w: 12, zones: ["garden", "yard"],  hrs: [480, 1080],  ssn: ["spring", "summer"],           spd: 40, sh: "fly",    c: "#e8c33a" },
    { id: "bug-ladybug",   name: "Ladybug",           ico: "🐞", price: 60,  w: 14, zones: ["garden", "yard"],  hrs: [480, 1020],  ssn: ["spring"],                     spd: 20, sh: "beetle", c: "#e04848" },
    { id: "bug-firefly",   name: "Firefly",           ico: "✨", price: 300, w: 6,  zones: ["pond", "yard"],    hrs: [1140, 240],  ssn: ["summer"],                     spd: 22, sh: "firefly", c: "#4a4a2a" },
    { id: "bug-cricket",   name: "Cricket",           ico: "🦗", price: 90,  w: 16, zones: ["yard"],            hrs: [1080, 330],  ssn: ["autumn"],                     spd: 36, sh: "hopper", c: "#5a7a3a" },
    { id: "bug-stag",      name: "Stag Beetle",       ico: "🪲", price: 500, w: 4,  zones: ["yard"],            hrs: [1080, 360],  ssn: ["summer"],                     spd: 18, sh: "beetle", c: "#3a2a3a" },
    { id: "bug-hopper",    name: "Grasshopper",       ico: "🦗", price: 80,  w: 14, zones: ["yard", "garden"],  hrs: [480, 1140],  ssn: ["summer", "autumn"],           spd: 46, sh: "hopper", c: "#7ab84a" },
  ];
  const SEA = [
    { id: "sea-clam",     name: "Freshwater Clam", ico: "🦪", price: 100, w: 30 },
    { id: "sea-snail",    name: "Pond Snail",      ico: "🐌", price: 60,  w: 26 },
    { id: "sea-crayfish", name: "Crayfish",        ico: "🦞", price: 160, w: 18 },
    { id: "sea-beetle",   name: "Diving Beetle",   ico: "🪲", price: 140, w: 12 },
    { id: "sea-oyster",   name: "Pearl Oyster",    ico: "🦪", price: 800, w: 4 },
    { id: "sea-turtle",   name: "Softshell Turtle",ico: "🐢", price: 600, w: 5 },
  ];
  const JUNK = [
    { id: "junk-boot", name: "Old Boot",  ico: "🥾", price: 5, junk: true },
    { id: "junk-can",  name: "Empty Can", ico: "🥫", price: 3, junk: true },
  ];
  const ALL_SP = FISH.concat(BUGS, SEA);
  const SP_BY_ID = {}; ALL_SP.concat(JUNK).forEach(s => (SP_BY_ID[s.id] = s));

  // ---------- module state (plain JSON only — it IS the save/net payload) ----------
  let gs = null;
  const S = {
    fish: [],     // {id,sp,x,y,tx,ty,wait,mode,lure,fade}
    bugs: [],     // {id,sp,x,y,tx,ty,wait,mode,step,fade}
    bub: [],      // {id,sp,x,y,ttl,ph}
    fx: [],       // {k,x,y,vx,vy,age,ttl,sz}
    fishing: {},  // pid -> {st:"wait"|"nibble",bx,by,fish,t,nibT,px,py,ping}
    swim: {},     // pid -> true
    swing: {},    // pid -> {t,dir}
    swingCd: {},  // pid -> cooldown
    caught: {},   // species id -> count (critterpedia)
    dayN: -1, nextId: 1, spawnT: 0, bugT: 0, bubT: 0,
  };
  const _pm = {}; // pid -> last-frame pos for swim slow (transient, not saved)
  let saveT = 0, ctx2 = null;

  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const isNight = () => gs && (gs.timeMin >= NIGHT_FROM || gs.timeMin < NIGHT_TO);
  const addHappy = n => { if (gs) gs.happiness = Math.max(0, gs.happiness + n); };
  const DIRV = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

  function fx(k, x, y, o) { if (S.fx.length < 80) S.fx.push(Object.assign({ k, x, y, vx: 0, vy: 0, age: 0, ttl: 1 }, o)); }
  const splashFx = (x, y, n = 8) => { for (let i = 0; i < n; i++) fx("splash", x + rnd(-7, 7), y - 3, { vx: rnd(-48, 48), vy: -50 - rnd(0, 44), ttl: rnd(0.3, 0.55), sz: rnd(1.5, 3) }); };
  const rippleFx = (x, y) => fx("ripple", x, y, { ttl: 0.8 });
  const sparkleFx = (x, y, n = 5) => { for (let i = 0; i < n; i++) fx("spark", x + rnd(-10, 10), y - rnd(2, 18), { vy: -10, ttl: rnd(0.4, 0.8), sz: rnd(2, 3.5) }); };
  const bubFx = (x, y) => fx("fbub", x, y, { vy: -16, ttl: rnd(0.5, 0.9), sz: rnd(1.5, 3) });

  // ---------- item catalog ----------
  ALL_SP.concat(JUNK).forEach(s => {
    DH.items && DH.items.def(s.id, { name: s.name, ico: s.ico, cat: s.id.startsWith("fish") ? "fish" : s.id.startsWith("bug") ? "bug" : s.id.startsWith("sea") ? "sea" : "misc", price: s.price });
  });

  // ---------- spawn rules ----------
  function active(sp, timeMin, season) {
    if (sp.hrs) {
      const [a, b] = sp.hrs;
      const on = a < b ? timeMin >= a && timeMin < b : timeMin >= a || timeMin < b;
      if (!on) return false;
    }
    if (sp.ssn && !sp.ssn.includes(season)) return false;
    return true;
  }
  function weighted(table, timeMin, season) {
    const live = table.filter(s => active(s, timeMin, season));
    if (!live.length) return null;
    let tot = 0; for (const s of live) tot += s.w;
    let r = Math.random() * tot;
    for (const s of live) { r -= s.w; if (r <= 0) return s; }
    return live[live.length - 1];
  }

  const BUG_HOME = {
    pond:   { x1: 21 * T, y1: 12 * T, x2: 29 * T, y2: 19 * T },
    garden: { x1: 17 * T, y1: 3 * T,  x2: 28 * T, y2: 10 * T },
    yard:   { x1: 2 * T,  y1: 10 * T, x2: 21 * T, y2: 18 * T },
  };

  function spawnFish() {
    const sp = weighted(FISH, gs.timeMin, gs.season);
    if (!sp) return;
    S.fish.push({
      id: "f" + S.nextId++, sp: sp.id,
      x: rnd(POND_IN.x1, POND_IN.x2), y: rnd(POND_IN.y1, POND_IN.y2),
      tx: 0, ty: 0, wait: rnd(0.4, 2), mode: "idle", lure: null, fade: 0,
    });
  }
  function spawnBug() {
    const sp = weighted(BUGS, gs.timeMin, gs.season);
    if (!sp) return;
    const home = BUG_HOME[pick(sp.zones)];
    S.bugs.push({
      id: "b" + S.nextId++, sp: sp.id, home,
      x: rnd(home.x1 + 8, home.x2 - 8), y: rnd(home.y1 + 8, home.y2 - 8),
      tx: 0, ty: 0, wait: rnd(0.3, 1.5), mode: "idle", step: rnd(0, 1), fade: 0,
    });
  }
  function spawnBub() {
    const sp = weighted(SEA, gs.timeMin, gs.season);
    if (!sp) return;
    S.bub.push({
      id: "s" + S.nextId++, sp: sp.id,
      x: rnd(POND_IN.x1, POND_IN.x2), y: rnd(POND_IN.y1 + 6, POND_IN.y2),
      ttl: rnd(9, 15), ph: rnd(0, 6),
    });
  }

  const fishById = id => S.fish.find(f => f.id === id);
  const bugById = id => S.bugs.find(b => b.id === id);
  const bubById = id => S.bub.find(b => b.id === id);

  // ---------- world helpers ----------
  const tileAt = (tx, ty) => DH.world.tileAt(tx, ty);
  const isWaterPx = (x, y) => tileAt(Math.floor(x / T), Math.floor(y / T)) === DH.world.WATER;
  // shore tile: standable land next to pond water; west column (tx<22) excluded —
  // it faces sauna's plunge pool, whose interactable keeps priority there.
  function isShore(tx, ty) {
    if (tx < 22) return false;
    if (DH.world.isSolid(tx, ty) || tileAt(tx, ty) === DH.world.WATER) return false;
    return tileAt(tx + 1, ty) === DH.world.WATER || tileAt(tx - 1, ty) === DH.world.WATER ||
           tileAt(tx, ty + 1) === DH.world.WATER || tileAt(tx, ty - 1) === DH.world.WATER;
  }
  function shoreTileOf(p) {
    const tx = Math.floor(p.x / T), ty = Math.floor(p.y / T);
    return isShore(tx, ty) ? { tx, ty } : null;
  }
  function castSpot(p) {
    const d = DIRV[p.dir] || [0, 1];
    const tx = Math.floor(p.x / T), ty = Math.floor(p.y / T);
    for (let i = 1; i <= 3; i++) {
      const wx = tx + d[0] * i, wy = ty + d[1] * i;
      if (tileAt(wx, wy) === DH.world.WATER) return { x: wx * T + 16, y: wy * T + 16 };
      if (tileAt(wx, wy) !== DH.world.WATER && DH.world.isSolid(wx, wy)) break;
    }
    let best = null, bd = 1e9;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (tileAt(tx + dx, ty + dy) !== DH.world.WATER) continue;
      const dd = dist2(p.x, p.y, (tx + dx) * T + 16, (ty + dy) * T + 16);
      if (dd < bd) { bd = dd; best = { x: (tx + dx) * T + 16, y: (ty + dy) * T + 16 }; }
    }
    return best;
  }
  function nearestLandTile(x, y, r) {
    const tx = Math.floor(x / T), ty = Math.floor(y / T);
    let best = null, bd = 1e9;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const wx = tx + dx, wy = ty + dy;
      if (DH.world.isSolid(wx, wy) || tileAt(wx, wy) === DH.world.WATER) continue;
      const dd = dist2(x, y, wx * T + 16, wy * T + 16);
      if (dd < bd) { bd = dd; best = { x: wx * T + 16, y: wy * T + 16 }; }
    }
    return best;
  }

  // ---------- critterpedia ----------
  function markCaught(id) { S.caught[id] = (S.caught[id] || 0) + 1; }
  function caughtIn(table) { return table.filter(s => S.caught[s.id]).length; }
  function hrsTxt(sp) {
    if (!sp.hrs) return "all day";
    const f = m => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
    return `${f(sp.hrs[0])}–${f(sp.hrs[1])}`;
  }
  function spDesc(sp) {
    const bits = [hrsTxt(sp), sp.ssn ? sp.ssn.join("/") : "all seasons", `sells 🪙${sp.price}`];
    return bits.join(" · ");
  }
  function openCat(title, table) {
    const rows = table.map(sp => S.caught[sp.id]
      ? { ico: sp.ico, label: `${sp.name}${S.caught[sp.id] > 1 ? " ×" + S.caught[sp.id] : ""} · 🪙${sp.price}`, cb: () => DH.toast(`${sp.ico} ${sp.name} — ${spDesc(sp)}`, 3800) }
      : { ico: "❓", label: "??????", cb: () => DH.toast("Not caught yet — watch the time & season!") });
    rows.push({ ico: "◀", label: "Back", cb: openPedia });
    DH.menu.open(title, rows);
  }
  function openPedia() {
    const tot = ALL_SP.length, got = ALL_SP.filter(s => S.caught[s.id]).length;
    DH.menu.open(`📖 Critterpedia — ${got}/${tot}`, [
      { ico: "🐟", label: `Fish — ${caughtIn(FISH)}/${FISH.length}`, cb: () => openCat("🐟 Fish", FISH) },
      { ico: "🦋", label: `Bugs — ${caughtIn(BUGS)}/${BUGS.length}`, cb: () => openCat("🦋 Bugs", BUGS) },
      { ico: "🫧", label: `Pond finds — ${caughtIn(SEA)}/${SEA.length}`, cb: () => openCat("🫧 Pond finds", SEA) },
    ]);
  }

  // ---------- actions (remote-callable; pid = acting player) ----------
  const API = {
    cast(pid) {
      const p = gs && gs.players[pid];
      if (!p || S.fishing[pid] || S.swim[pid]) return false;
      const spot = castSpot(p);
      if (!spot) { DH.toast("No water to cast to"); return false; }
      S.fishing[pid] = { st: "wait", bx: spot.x, by: spot.y, fish: null, t: 0, nibT: 0, px: p.x, py: p.y, ping: 0 };
      splashFx(spot.x, spot.y, 5); rippleFx(spot.x, spot.y);
      const near = S.fish.some(f => f.mode !== "flee" && dist2(f.x, f.y, spot.x, spot.y) < LURE_R * LURE_R);
      if (!near) DH.toast("Hmm, nothing nearby — cast near a shadow 🎣");
      return true;
    },
    reel(pid) {
      const fs = S.fishing[pid], p = gs && gs.players[pid];
      if (!fs || !p) return false;
      delete S.fishing[pid];
      if (fs.st === "nibble") return catchFish(pid, fs);
      // reeled too early — nothing on the line, nearby fish scatter
      const f = fishById(fs.fish);
      if (f) { f.mode = "flee"; f.fade = 1.1; }
      splashFx(fs.bx, fs.by, 4);
      DH.toast("Reeled in — nothing 🎣");
      return true;
    },
    swing(pid) {
      const p = gs && gs.players[pid];
      if (!p || S.swim[pid] || S.fishing[pid] || S.swingCd[pid] > 0) return false;
      S.swingCd[pid] = 0.55;
      S.swing[pid] = { t: 0.35, dir: p.dir || "down" };
      const d = DIRV[S.swing[pid].dir];
      const nx = p.x + d[0] * NET_REACH, ny = p.y + d[1] * NET_REACH;
      let best = null, bd = 1e9;
      for (const b of S.bugs) {
        if (b.mode === "flee") continue;
        const dd = dist2(nx, ny, b.x, b.y);
        if (dd < NET_R * NET_R && dd < bd) { bd = dd; best = b; }
      }
      if (best) {
        const sp = SP_BY_ID[best.sp];
        const got = DH.inv ? DH.inv.add(best.sp, 1) : 0;
        if (got > 0) {
          markCaught(best.sp); addHappy(1.5);
          sparkleFx(best.x, best.y, 6);
          DH.toast(`Caught a ${sp.name}! ${sp.ico}`);
          DH.alog && DH.alog.add("catch", best.sp);
          S.bugs = S.bugs.filter(b => b !== best);
        } else {
          DH.toast("Pockets full — it escaped! 🎒");
          best.mode = "flee"; best.fade = 1; best.vx = d[0] * 60; best.vy = d[1] * 60 - 30;
        }
      } else {
        DH.toast("Missed!");
        for (const b of S.bugs) {
          if (b.mode === "flee" || dist2(p.x, p.y, b.x, b.y) > SCARE_R * SCARE_R) continue;
          const dx = b.x - p.x, dy = b.y - p.y, m = Math.hypot(dx, dy) || 1;
          b.mode = "flee"; b.fade = 1; b.vx = dx / m * 70; b.vy = dy / m * 70 - 24;
        }
      }
      return true;
    },
    dive(pid) {
      const p = gs && gs.players[pid];
      if (!p || S.swim[pid] || S.fishing[pid]) return false;
      // dive spot: water tile the player faces, else the tile off the dock
      let spot = null;
      const d = DIRV[p.dir] || [0, 1];
      const tx = Math.floor(p.x / T), ty = Math.floor(p.y / T);
      for (let i = 1; i <= 2 && !spot; i++) {
        if (tileAt(tx + d[0] * i, ty + d[1] * i) === DH.world.WATER)
          spot = { x: (tx + d[0] * i) * T + 16, y: (ty + d[1] * i) * T + 16 };
      }
      if (!spot) spot = { x: DOCK.tx * T + 16, y: (DOCK.ty + 1) * T + 16 };
      S.swim[pid] = true; _pm[pid] = { x: spot.x, y: spot.y };
      p.x = spot.x; p.y = spot.y; p.dir = "down"; p.moving = false;
      splashFx(p.x, p.y, 14); rippleFx(p.x, p.y);
      DH.toast(`${p.name} dove in! 🤿`);
      DH.alog && DH.alog.add("dive");
      // the splash startles a nibbling fish
      for (const k in S.fishing) {
        const fs = S.fishing[k];
        if (fs && fs.fish && dist2(fs.bx, fs.by, p.x, p.y) < 70 * 70) {
          const f = fishById(fs.fish);
          if (f) { f.mode = "flee"; f.fade = 1.1; f.lure = null; }
          if (fs.st === "nibble") { fs.st = "wait"; fs.fish = null; }
        }
      }
      return true;
    },
    catchSea(pid, bid) {
      const p = gs && gs.players[pid];
      if (!p || !S.swim[pid]) return false;
      const b = bid ? bubById(bid) : null;
      if (!b) return false;
      const sp = SP_BY_ID[b.sp];
      const got = DH.inv ? DH.inv.add(b.sp, 1) : 0;
      if (got > 0) {
        markCaught(b.sp); addHappy(1.5);
        splashFx(b.x, b.y, 6); sparkleFx(b.x, b.y - 6, 5);
        DH.toast(`Caught a ${sp.name}! ${sp.ico}`);
        DH.alog && DH.alog.add("catch", b.sp);
        S.bub = S.bub.filter(x => x !== b);
      } else DH.toast("Pockets full! 🎒");
      return true;
    },
    climbOut(pid) {
      const p = gs && gs.players[pid];
      if (!p || !S.swim[pid]) return false;
      const land = nearestLandTile(p.x, p.y, 2) || { x: p.x, y: p.y - T };
      p.x = land.x; p.y = land.y; p.dir = "down"; p.moving = false;
      S.swim[pid] = false; delete _pm[pid];
      splashFx(p.x, p.y, 6);
      return true;
    },
    openPedia() { openPedia(); return true; },
  };

  function catchFish(pid, fs) {
    const f = fishById(fs.fish);
    const junk = Math.random() < JUNK_CH;
    const sp = junk || !f ? pick(JUNK) : SP_BY_ID[f.sp];
    const got = DH.inv ? DH.inv.add(sp.id, 1) : 0;
    if (got > 0) {
      if (!sp.junk) markCaught(sp.id);
      addHappy(sp.junk ? 0.5 : 2);
      splashFx(fs.bx, fs.by, 10); sparkleFx(fs.bx, fs.by - 6, 6);
      DH.toast(sp.junk ? `Caught an ${sp.name}… it can be recycled! ${sp.ico}` : `Caught a ${sp.name}! ${sp.ico}`);
      DH.alog && DH.alog.add("catch", sp.id);
      if (f) S.fish = S.fish.filter(x => x !== f);
    } else {
      DH.toast("Pockets full — it got away! 🎒");
      if (f) { f.mode = "flee"; f.fade = 1.1; f.lure = null; }
    }
    return true;
  }

  function exitSwim(pid) {
    const p = gs.players[pid];
    S.swim[pid] = false; delete _pm[pid];
    if (p) { splashFx(p.x, p.y, 5); }
  }

  // ---------- entity sim ----------
  function moveToward(e, sp, dt) {
    const dx = e.tx - e.x, dy = e.ty - e.y, d = Math.hypot(dx, dy);
    if (d < 3) return true;
    e.x += (dx / d) * sp * dt; e.y += (dy / d) * sp * dt;
    return false;
  }
  function simFish(f, dt) {
    const sp = SP_BY_ID[f.sp];
    if (f.mode === "flee") {
      f.fade -= dt;
      f.y += 14 * dt;
      return;
    }
    if (!active(sp, gs.timeMin, gs.season)) { f.mode = "flee"; f.fade = 1.4; return; }
    // lured toward a bobber?
    let bob = null;
    for (const k in S.fishing) {
      const fs = S.fishing[k];
      if (fs && fs.fish === f.id) bob = fs;
    }
    if (bob) {
      f.tx = bob.bx; f.ty = bob.by;
      if (dist2(f.x, f.y, bob.bx, bob.by) < 7 * 7) {
        f.x = bob.bx; f.y = bob.by;
        if (bob.st === "wait") { bob.st = "nibble"; bob.nibT = BITE_T; }
      } else moveToward(f, 55, dt);
      return;
    }
    f.wait -= dt;
    if (f.mode === "idle" && f.wait <= 0) {
      f.tx = clamp(f.x + rnd(-90, 90), POND_IN.x1, POND_IN.x2);
      f.ty = clamp(f.y + rnd(-50, 50), POND_IN.y1, POND_IN.y2);
      f.mode = "swim";
    } else if (f.mode === "swim" && moveToward(f, 26, dt)) {
      f.mode = "idle"; f.wait = rnd(0.8, 3);
    }
  }
  function simBug(b, dt) {
    const sp = SP_BY_ID[b.sp];
    if (b.mode === "flee") {
      b.fade -= dt;
      b.x += (b.vx || 0) * dt; b.y += (b.vy || 0) * dt;
      return;
    }
    if (!active(sp, gs.timeMin, gs.season)) {
      b.mode = "flee"; b.fade = 1.1;
      b.vx = rnd(-30, 30); b.vy = -60;
      return;
    }
    b.step += dt * (b.mode === "move" ? 3 : 1);
    b.wait -= dt;
    const h = b.home;
    if (b.mode === "idle" && b.wait <= 0) {
      b.tx = clamp(b.x + rnd(-90, 90), h.x1 + 6, h.x2 - 6);
      b.ty = clamp(b.y + rnd(-56, 56), h.y1 + 6, h.y2 - 6);
      b.mode = "move";
    } else if (b.mode === "move") {
      const hop = sp.sh === "hopper" ? (Math.sin(b.step * 6) > -0.2 ? 1 : 0.15) : 1; // hoppers burst
      if (moveToward(b, sp.spd * hop, dt)) { b.mode = "idle"; b.wait = rnd(0.6, 2.4); }
    }
  }

  // ---------- module contract ----------
  const M = (DH.critters = {
    authority: true,
    _state: S,

    init(state) {
      gs = state;
      ctx2 = document.getElementById("cv").getContext("2d");
      const W = DH.world;
      if (!W._critterPatched) {                    // swimmers may stand on water
        W._critterPatched = true;
        const c0 = W.canStand.bind(W);
        W.canStand = (px, py) => {
          if (c0(px, py)) return true;
          let near = false;
          for (const pid in S.swim) {
            if (!S.swim[pid]) continue;
            const pl = gs && gs.players[pid];
            if (pl && Math.abs(pl.x - px) < 12 && Math.abs(pl.y - py) < 12) { near = true; break; }
          }
          if (!near) return false;
          // for a swimmer: water corners float; real walls still block
          for (const [dx, dy] of [[-9, -9], [9, -9], [-9, 9], [9, 9]]) {
            const ctx = Math.floor((px + dx) / T), cty = Math.floor((py + dy) / T);
            const t = W.tileAt(ctx, cty);
            if (t === W.WATER) continue;
            if (W.isSolid(ctx, cty)) return false;
          }
          return true;
        };
      }
    },

    start(state) {
      gs = state;
      S.fx = []; S.fishing = {}; S.swim = {}; S.swing = {}; S.swingCd = {};
      for (const k in _pm) delete _pm[k];
      S.dayN = Math.floor(state.day || 0);
      if (!S.fish.length) for (let i = 0; i < 3; i++) spawnFish();
      if (!S.bugs.length) for (let i = 0; i < 4; i++) spawnBug();
      saveT = 0;
    },

    offline() { return []; }, // ambient world — critters don't accumulate

    update(dt, state) {
      gs = state;
      saveT += dt;
      if (saveT > 7) { saveT = 0; DH.save.now(); }

      // day rollover → ambient refresh (old stock scoots off, new spawns arrive)
      const dayN = Math.floor(state.day || 0);
      if (S.dayN !== dayN) {
        S.dayN = dayN;
        for (const f of S.fish) if (f.mode !== "flee") { f.mode = "flee"; f.fade = 1.6; }
        for (const b of S.bugs) if (b.mode !== "flee") { b.mode = "flee"; b.fade = 1.4; b.vx = rnd(-40, 40); b.vy = -70; }
      }

      // ---- players: swim flag maintenance + slowed movement ----
      for (const [pid, p] of state.players.entries()) {
        if (S.swim[pid]) {
          const pm = _pm[pid];
          if (pm) { p.x = pm.x + (p.x - pm.x) * SWIM_K; p.y = pm.y + (p.y - pm.y) * SWIM_K; }
          _pm[pid] = { x: p.x, y: p.y };
          if (!isWaterPx(p.x, p.y)) exitSwim(pid);              // reached shore
          else if (Math.random() < dt * 1.6) bubFx(p.x + rnd(-5, 5), p.y - 16);
        } else if (isWaterPx(p.x, p.y)) {                       // ended up on water
          S.swim[pid] = true; _pm[pid] = { x: p.x, y: p.y };
          splashFx(p.x, p.y, 8);
        }
        S.swingCd[pid] = Math.max(0, (S.swingCd[pid] || 0) - dt);
        const sw = S.swing[pid];
        if (sw && (sw.t -= dt) <= 0) delete S.swing[pid];
      }
      if (!M.authority) return;

      // ---- fishing ----
      for (const pid in S.fishing) {
        const fs = S.fishing[pid], p = state.players[pid];
        if (!fs || !p) { delete S.fishing[pid]; continue; }
        if (S.swim[pid] || dist2(p.x, p.y, fs.px, fs.py) > 15 * 15) {  // walked off → line retracts
          const f = fishById(fs.fish); if (f) f.lure = null;
          delete S.fishing[pid];
          continue;
        }
        fs.t += dt;
        if (fs.st === "wait") {
          if (!fs.fish) {
            // lure the nearest free shadow
            let best = null, bd = LURE_R * LURE_R;
            for (const f of S.fish) {
              if (f.mode === "flee" || f.lure != null) continue;
              const dd = dist2(f.x, f.y, fs.bx, fs.by);
              if (dd < bd) { bd = dd; best = f; }
            }
            if (best) { best.lure = +pid; fs.fish = best.id; }
          } else {
            const f = fishById(fs.fish);
            if (!f || f.mode === "flee") { fs.fish = null; if (f) f.lure = null; }
          }
        } else if (fs.st === "nibble") {
          fs.nibT -= dt;
          fs.ping -= dt;
          if (fs.ping <= 0) { fs.ping = 0.24; rippleFx(fs.bx, fs.by); }
          if (fs.nibT <= 0) {                             // missed the window
            const f = fishById(fs.fish);
            if (f) { f.mode = "flee"; f.fade = 1.1; f.lure = null; }
            delete S.fishing[pid];
            splashFx(fs.bx, fs.by, 6);
            DH.toast("It got away… 🐟");
          }
        }
      }

      // ---- entities ----
      for (const f of S.fish) simFish(f, dt);
      S.fish = S.fish.filter(f => f.mode !== "flee" || f.fade > 0);
      for (const b of S.bugs) simBug(b, dt);
      S.bugs = S.bugs.filter(b => b.mode !== "flee" || b.fade > 0);
      for (const b of S.bub) b.ttl -= dt;
      S.bub = S.bub.filter(b => b.ttl > 0);

      // ---- spawners ----
      S.spawnT -= dt;
      if (S.spawnT <= 0) {
        S.spawnT = 2.5;
        const tgt = isNight() ? FISH_TGT_NIGHT : FISH_TGT;
        if (S.fish.length < tgt) spawnFish();
      }
      S.bugT -= dt;
      if (S.bugT <= 0) {
        S.bugT = 3.2;
        const tgt = isNight() ? BUG_TGT_NIGHT : BUG_TGT;
        if (S.bugs.length < tgt) spawnBug();
      }
      const swimming = Object.keys(S.swim).some(k => S.swim[k]);
      S.bubT -= dt;
      if (S.bubT <= 0) {
        S.bubT = 1.4;
        if (swimming && S.bub.length < BUB_TGT) spawnBub();
      }
    },

    interactables(p) {
      if (!gs || !gs.running) return [];
      const out = [], pid = p.pid || 0;
      const fs = S.fishing[pid];
      if (fs) {
        out.push({ label: fs.st === "nibble" ? "❗ Reel in!" : "Reel in 🎣", x: fs.bx, y: fs.by, action: () => API.reel(pid) });
        return out;
      }
      if (S.swim[pid]) {
        let bb = null, bd = BUB_R * BUB_R;
        for (const b of S.bub) {
          const dd = dist2(p.x, p.y, b.x, b.y);
          if (dd < bd) { bd = dd; bb = b; }
        }
        if (bb) out.push({ label: "Catch! 🫧", x: bb.x, y: bb.y, action: () => API.catchSea(pid, bb.id) });
        const land = nearestLandTile(p.x, p.y, 1);
        if (land && dist2(p.x, p.y, land.x, land.y) < 44 * 44)
          out.push({ label: "Climb out 🏖️", x: land.x, y: land.y, action: () => API.climbOut(pid) });
        out.sort((a, b) => dist2(p.x, p.y, a.x, a.y) - dist2(p.x, p.y, b.x, b.y));
        return out;
      }
      const sh = shoreTileOf(p);
      if (sh) {
        const spot = castSpot(p);
        if (spot) out.push({ label: "Cast line 🎣", x: spot.x, y: spot.y, action: () => API.cast(pid) });
        if (dist2(p.x, p.y, DOCK_P.x, DOCK_P.y) < 40 * 40)
          out.push({ label: "Dive in 🤿", x: DOCK_P.x, y: DOCK_P.y, action: () => API.dive(pid) });
      }
      let nb = null, nbd = 52 * 52;
      for (const b of S.bugs) {
        if (b.mode === "flee") continue;
        const dd = dist2(p.x, p.y, b.x, b.y);
        if (dd < nbd) { nbd = dd; nb = b; }
      }
      if (nb) {
        const sp = SP_BY_ID[nb.sp];
        out.push({ label: `Catch ${sp.name} ${sp.ico}`, x: nb.x, y: nb.y, action: () => API.swing(pid) });
      }
      if (dist2(p.x, p.y, SIGN.x, SIGN.y) < SIGN.r * SIGN.r)
        out.push({ label: "Critterpedia 📖", x: SIGN.x, y: SIGN.y, action: () => API.openPedia() });
      out.sort((a, b) => dist2(p.x, p.y, a.x, a.y) - dist2(p.x, p.y, b.x, b.y));
      return out;
    },

    // ----- drawing -----
    drawGround(ctx, camX, camY, state) {
      ctx2 = ctx;
      drawDock(ctx, DOCK.tx * T - camX, DOCK.ty * T - camY);
      const now = Date.now();
      for (const f of S.fish) drawShadow(ctx, f, f.x - camX, f.y - camY, now);
      for (const b of S.bub) drawBubble(ctx, b, b.x - camX, b.y - camY, now);
      for (const pid in S.fishing) {
        const fs = S.fishing[pid];
        if (!fs) continue;
        const p = state.players[pid];
        const bx = fs.bx - camX, by = fs.by - camY;
        if (p) { // rod line from player to bobber
          ctx.strokeStyle = "#2a2a33cc"; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(p.x - camX, p.y - camY - 20); ctx.lineTo(bx, by); ctx.stroke();
        }
        const bob = Math.sin(now / 240 + fs.bx) * 1.4;
        ctx.fillStyle = fs.st === "nibble" ? "#e04848" : "#f5f2e8";
        ctx.beginPath(); ctx.arc(bx, by - 4 + bob, 3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#e04848";
        ctx.beginPath(); ctx.arc(bx, by - 7 + bob, 2.2, 0, Math.PI * 2); ctx.fill();
      }
      for (const f of S.fx) if (f.k === "ripple") {
        const t = f.age / f.ttl, x = f.x - camX, y = f.y - camY;
        ctx.strokeStyle = `rgba(255,255,255,${0.5 * (1 - t)})`;
        ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.ellipse(x, y, 3 + t * 16, 1.5 + t * 8, 0, 0, Math.PI * 2); ctx.stroke();
      }
    },

    collectDraws(draws, camX, camY) {
      if (!ctx2) return;
      draws.push({ y: SIGN.y + 6, fn: () => drawPediaSign(ctx2, SIGN.x - camX, SIGN.y - camY) });
      for (const b of S.bugs)
        draws.push({ y: b.y, fn: () => drawBug(ctx2, b, b.x - camX, b.y - camY) });
    },

    drawOverlay(ctx, camX, camY, state) {
      ctx2 = ctx;
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
      // swimmers: waterline + dive bubbles
      for (const [pid, p] of state.players.entries()) {
        if (!S.swim[pid]) continue;
        const sx = p.x - camX, sy = p.y - camY;
        ctx.fillStyle = "rgba(80,160,215,0.55)";
        ctx.fillRect(sx - 9, sy - 9, 18, 10);
        ctx.fillStyle = "rgba(255,255,255,0.4)";
        ctx.fillRect(sx - 9 + Math.sin(now / 280 + p.x) * 2, sy - 9, 18, 2);
      }
      // net swoosh
      for (const pid in S.swing) {
        const sw = S.swing[pid], p = state.players[pid];
        if (!sw || !p) continue;
        const t = 1 - sw.t / 0.35;
        const d = DIRV[sw.dir] || [0, 1];
        const ang = Math.atan2(d[1], d[0]);
        const sx = p.x - camX, sy = p.y - camY - 10;
        ctx.strokeStyle = `rgba(230,240,255,${0.85 * (1 - t)})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sx, sy, 8 + t * 26, ang - 0.9 + t * 0.6, ang + 0.9 + t * 0.6);
        ctx.stroke();
        ctx.fillStyle = `rgba(255,255,255,${0.5 * (1 - t)})`;
        ctx.beginPath();
        ctx.arc(sx + d[0] * (10 + t * 24), sy + d[1] * (10 + t * 24), 3, 0, Math.PI * 2);
        ctx.fill();
      }
      // nibble "!"
      for (const pid in S.fishing) {
        const fs = S.fishing[pid];
        if (!fs || fs.st !== "nibble") continue;
        const bx = fs.bx - camX, by = fs.by - camY;
        const s = 1 + Math.sin(now / 70) * 0.12;
        ctx.font = `bold ${Math.round(15 * s)}px sans-serif`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillStyle = "#ffd94d";
        ctx.fillText("!", bx, by - 20);
      }
    },

    // ----- sync boundary -----
    serialize() {
      return JSON.parse(JSON.stringify({
        fish: S.fish, bugs: S.bugs, bub: S.bub, fx: S.fx,
        fishing: S.fishing, swim: S.swim, caught: S.caught,
        dayN: S.dayN, nextId: S.nextId,
      }));
    },
    deserialize(d) {
      if (!d) return;
      if (Array.isArray(d.fish)) S.fish = d.fish;
      if (Array.isArray(d.bugs)) S.bugs = d.bugs;
      if (Array.isArray(d.bub)) S.bub = d.bub;
      if (Array.isArray(d.fx)) S.fx = d.fx;
      if (d.fishing) S.fishing = d.fishing;
      if (d.swim) S.swim = d.swim;
      if (d.caught) S.caught = d.caught;
      if (d.dayN != null) S.dayN = d.dayN;
      if (d.nextId != null) S.nextId = d.nextId;
    },
    remoteAction(name, args) {
      return typeof API[name] === "function" ? API[name].apply(null, args || []) : false;
    },

    cast: API.cast, reel: API.reel, swing: API.swing, dive: API.dive,
    catchSea: API.catchSea, climbOut: API.climbOut, openPedia,
  });

  // ---------- fx / sprite drawing ----------
  const R = (x, y, w, h, c) => { ctx2.fillStyle = c; ctx2.fillRect(x, y, w, h); };

  function drawFx(ctx, f, camX, camY) {
    const t = f.age / f.ttl, x = f.x - camX, y = f.y - camY;
    ctx.save();
    if (f.k === "splash") {
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = "#aee6f8";
      ctx.fillRect(x, y, f.sz || 2, f.sz || 2);
    } else if (f.k === "ripple") {
      ctx.globalAlpha = 0; // ripples are drawn in drawGround (under entities)
    } else if (f.k === "spark") {
      ctx.globalAlpha = Math.sin(Math.min(1, t) * Math.PI);
      ctx.fillStyle = "#ffe89a";
      const s = f.sz || 3;
      ctx.fillRect(x - s, y - 0.7, s * 2, 1.4); ctx.fillRect(x - 0.7, y - s, 1.4, s * 2);
    } else if (f.k === "fbub") {
      ctx.globalAlpha = 0.7 * (1 - t);
      ctx.strokeStyle = "#dff2ff"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, y, f.sz || 2, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  const SH_SZ = { s: [9, 3.6], m: [15, 5.5], l: [21, 7.5], fin: [18, 6.5] };
  function drawShadow(ctx, f, x, y, now) {
    const sp = SP_BY_ID[f.sp] || {};
    const [w, h] = SH_SZ[sp.sz || "m"];
    const wig = Math.sin(now / 260 + f.x) * 1.6;
    const a = f.mode === "flee" ? Math.max(0, f.fade / 1.2) : 0.75;
    ctx.save();
    ctx.globalAlpha = Math.min(0.85, a);
    ctx.fillStyle = "#16395c";
    ctx.beginPath(); ctx.ellipse(x, y, w, h, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); // tail
    ctx.moveTo(x - w + 2, y); ctx.lineTo(x - w - 4, y - 3); ctx.lineTo(x - w - 4, y + 3); ctx.fill();
    if (sp.sz === "fin") { // dorsal fin pokes the surface
      ctx.beginPath();
      ctx.moveTo(x - 2 + wig * 0.4, y - h + 1); ctx.lineTo(x + 2 + wig * 0.4, y - h - 5); ctx.lineTo(x + 5 + wig * 0.4, y - h + 1);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawBubble(ctx, b, x, y, now) {
    const fade = Math.min(1, b.ttl / 1.5);
    ctx.save();
    ctx.globalAlpha = 0.5 * fade;
    ctx.fillStyle = "#123252"; // hidden critter shape under the bubbles
    ctx.beginPath(); ctx.ellipse(x, y + 5, 7, 3.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.85 * fade;
    ctx.strokeStyle = "#e8f6ff"; ctx.lineWidth = 1.2;
    const wob = Math.sin(now / 300 + b.ph) * 2;
    ctx.beginPath(); ctx.arc(x + wob, y, 2.6, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(x - wob + 3, y - 5, 1.8, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  function drawBug(ctx, b, x, y) {
    const sp = SP_BY_ID[b.sp] || {};
    ctx2 = ctx;
    const flap = Math.abs(Math.sin(b.step * 6 + b.x)) * 0.7 + 0.3;
    const bob = Math.sin(b.step * 2.4) * 2;
    const yy = y - 12 + bob;
    ctx.save();
    if (b.mode === "flee") ctx.globalAlpha = Math.max(0, b.fade);
    ctx.translate(x, yy);
    switch (sp.sh) {
      case "butter":
        ctx.fillStyle = sp.c;
        ctx.fillRect(-6 * flap, -4, 5, 7); ctx.fillRect(1 + (6 * flap - 5) * -1 + 1, -4, 5, 7);
        ctx.fillStyle = "#3a2a1a"; ctx.fillRect(-1, -5, 2, 9);
        break;
      case "dragon":
        ctx.fillStyle = "#eaf4ffcc";
        ctx.fillRect(-6 * flap, -5, 6, 2); ctx.fillRect(0, -5, 6 * flap, 2);
        ctx.fillStyle = sp.c; ctx.fillRect(-1, -3, 2, 12); ctx.fillRect(-2, -4, 4, 3);
        break;
      case "fly":
        ctx.fillStyle = "#eaf4ffcc";
        ctx.fillRect(-4 * flap, -6, 4, 3); ctx.fillRect(0, -6, 4 * flap, 3);
        ctx.fillStyle = sp.c; ctx.fillRect(-3, -3, 6, 6);
        ctx.fillStyle = "#241a24"; ctx.fillRect(-3, -1, 6, 1); ctx.fillRect(-3, 1, 6, 1);
        break;
      case "firefly": {
        ctx.fillStyle = sp.c; ctx.fillRect(-3, -3, 6, 6);
        const glow = 0.4 + 0.6 * Math.abs(Math.sin(Date.now() / 400 + b.x));
        ctx.fillStyle = `rgba(255,240,140,${glow})`;
        ctx.fillRect(-2, 2, 4, 3);
        break;
      }
      case "hopper":
        ctx.fillStyle = sp.c;
        ctx.fillRect(-4, -4, 8, 6); ctx.fillRect(-7, 0, 4, 2); ctx.fillRect(3, 1, 5, 2);
        ctx.fillStyle = "#1a2412"; ctx.fillRect(2, -3, 1, 1);
        break;
      default: // beetle
        ctx.fillStyle = sp.c;
        ctx.fillRect(-4, -5, 8, 8);
        ctx.fillStyle = "#241a24"; ctx.fillRect(-4, -5, 8, 2); ctx.fillRect(-1, -3, 2, 6);
    }
    ctx.restore();
  }

  function drawPediaSign(ctx, x, y) {
    ctx2 = ctx;
    R(x - 2, y - 12, 4, 14, "#6e4a2a");              // post
    R(x - 12, y - 27, 24, 16, "#a0733f");            // board
    R(x - 12, y - 27, 24, 2, "#c09055");             // top edge
    R(x - 12, y - 13, 24, 2, "#7a5527");             // bottom edge
    // tiny painted fish + butterfly
    R(x - 9, y - 23, 6, 4, "#4a9bd8"); R(x - 3, y - 22, 2, 2, "#4a9bd8");
    R(x + 2, y - 24, 3, 4, "#ff8c3a"); R(x + 6, y - 24, 3, 4, "#ff8c3a");
    R(x + 4, y - 25, 2, 6, "#3a2a1a");
  }

  function drawDock(ctx, px, py) {
    ctx.fillStyle = "#7a5328"; ctx.fillRect(px + 3, py + 15, 26, 30);  // shadow/edge
    ctx.fillStyle = "#a0733f"; ctx.fillRect(px + 3, py + 13, 26, 30);  // planks
    ctx.fillStyle = "#8a5f34";
    for (let i = 0; i < 4; i++) ctx.fillRect(px + 3, py + 13 + i * 8, 26, 2);
    ctx.fillStyle = "#5f3d22"; ctx.fillRect(px + 4, py + 39, 4, 5); ctx.fillRect(px + 24, py + 39, 4, 5); // posts
  }
})();

DH.register("critters", DH.critters);
