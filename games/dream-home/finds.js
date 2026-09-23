/* dream-home finds module — daily treasures & discoveries (AC_SPEC B-4,B-10,B-11,B-15).
   Contract with game.js (same as garden.js):
     DH.finds.init(state)                     – called once at load
     DH.finds.start(state)                    – called when a run starts
     DH.finds.update(dt, state)               – per frame (sim; host only)
     DH.finds.drawGround(ctx, camX, camY, st) – dig crack marks (under entities)
     DH.finds.collectDraws(draws, camX, camY) – plinth/bottle/parcels/pickups (depth sort)
     DH.finds.drawOverlay(ctx, camX, camY, st)– sky balloon, sparkles, poof FX
     DH.finds.interactables(p)                – -> [{label,x,y,action}]
     DH.finds.serialize()/deserialize(data)/remoteAction(name,args)/offline(offMin)

   B-4  Fossil digs: 2-3 crack marks spawn on grass each game-day → "Dig up" gives an
        Unassessed fossil (rarely a gyroid). The museum plinth beside the house
        assesses them into named fossils (recorded in DH.finds.assessed for the
        future museum module).
   B-10 Message bottle: once per real day a bottle lands on a pond-shore tile →
        "Pick up" grants a random DIY recipe card (recipe-* items, cat misc).
   B-11 Balloon present: a balloon drifts across the sky every few game-hours →
        "Shoot balloon" (generous hitbox, toy slingshot — no tool required) drops a
        parcel → "Open present" grants a random material/rare/recipe prize.
   B-15 Shore & forest pickups: shells spawn daily along the pond edge; mushrooms
        under the orchard trees in autumn only. Pick up → pockets.

   All persistent state is JSON-plain (S.*) so serialize() round-trips through the
   save bus (mods.finds) and net snapshots. Guests never run update() — they render
   from deserialize() snapshots; FX use absolute timestamps so they animate for
   guests too. Tools module is an optional dependency (shovel improves dig luck).
*/
(function () {
  const DH = (window.DH = window.DH || {});
  const T = 32, DAY = 24 * 60;

  // ---------- item catalog ----------
  const II = DH.items;
  II.def("fossil-un",   { name: "Unassessed fossil", ico: "🦴", cat: "fossil", price: 0, stack: 10 });
  II.def("fossil-fern", { name: "Fossil fern",    ico: "🌿", cat: "fossil", price: 300 });
  II.def("fossil-shark",{ name: "Shark tooth",    ico: "🦷", cat: "fossil", price: 350 });
  II.def("fossil-tri",  { name: "Trilobite",      ico: "🐛", cat: "fossil", price: 450 });
  II.def("fossil-ammon",{ name: "Ammonite",       ico: "🐚", cat: "fossil", price: 500 });
  II.def("fossil-arch", { name: "Archaeopteryx",  ico: "🪶", cat: "fossil", price: 700 });
  II.def("fossil-dino", { name: "Dino egg",       ico: "🥚", cat: "fossil", price: 800 });
  II.def("fossil-rex",  { name: "T. rex skull",   ico: "🦖", cat: "fossil", price: 1100 });
  II.def("fossil-amber",{ name: "Amber",          ico: "🟠", cat: "fossil", price: 1200 });
  II.def("gyroid",      { name: "Gyroid",         ico: "🗿", cat: "misc", price: 828 });
  II.def("shell-conch", { name: "Conch",          ico: "🐚", cat: "sea", price: 45 });
  II.def("shell-coral", { name: "Coral",          ico: "🪸", cat: "sea", price: 60 });
  II.def("shell-star",  { name: "Starfish",       ico: "⭐", cat: "sea", price: 25 });
  II.def("shroom-brown",  { name: "Brown mushroom", ico: "🍄", cat: "food", price: 60 });
  II.def("shroom-red",    { name: "Toadstool",      ico: "🍄", cat: "food", price: 40 });
  II.def("shroom-truffle",{ name: "Truffle",        ico: "🍄", cat: "food", price: 300 });
  const RECIPES = [
    ["fountain", "fountain"], ["hammock", "hammock"], ["log-bench", "log bench"],
    ["lantern", "lantern"], ["birdbath", "birdbath"], ["swing", "swing"],
    ["flower-cart", "flower cart"], ["stone-table", "stone table"],
  ];
  for (const [rid, rname] of RECIPES)
    II.def("recipe-" + rid, { name: "Recipe: " + rname, ico: "🧾", cat: "misc", price: 0 });

  // ---------- loot tables ----------
  const FOSSIL_TABLE = [ // [id, weight] — assessed fossil roll
    ["fossil-fern", 22], ["fossil-shark", 20], ["fossil-tri", 20], ["fossil-ammon", 18],
    ["fossil-arch", 9], ["fossil-dino", 6], ["fossil-rex", 3], ["fossil-amber", 2],
  ];
  const SHELL_TABLE = [ // [id, weight]
    ["shell", 58], ["shell-conch", 20], ["shell-star", 12], ["shell-coral", 10],
  ];
  const SHROOM_TABLE = [ // autumn only
    ["mushroom", 55], ["shroom-brown", 25], ["shroom-red", 15], ["shroom-truffle", 5],
  ];
  const PARCEL_TABLE = [ // [kind, id, n, weight] kind: item|coins
    ["item", "wood", 3, 16], ["item", "softwood", 2, 12], ["item", "hardwood", 2, 10],
    ["item", "stone", 2, 12], ["item", "clay", 2, 10], ["item", "apple", 2, 10],
    ["item", "wool", 1, 6], ["item", "milk", 1, 6], ["item", "iron", 2, 8],
    ["coins", null, 120, 4], ["item", "recipe-rand", 1, 3],
    ["item", "gold", 1, 2], ["item", "star-frag", 1, 1], ["item", "gyroid", 1, 0.6],
  ];
  const BALLOON_COLORS = ["#e35b6a", "#f0a13c", "#5aa5e8", "#7dc95c", "#b57fd6"];

  // ---------- fixed spots ----------
  const PLINTH = { tx: 16, ty: 9 };                     // museum plinth by the house SE corner
  const PLINTH_C = { x: PLINTH.tx * T + 16, y: PLINTH.ty * T + 20, r: 46 };
  // walkable land tiles hugging the pond (x22-27,y13-17 water)
  const SHORE = [];
  for (let x = 22; x <= 27; x++) SHORE.push({ tx: x, ty: 12 }, { tx: x, ty: 18 });
  for (let y = 13; y <= 17; y++) SHORE.push({ tx: 28, ty: y });
  SHORE.push({ tx: 21, ty: 16 }, { tx: 21, ty: 17 });
  // grass tiles under the orchard trees (garden trees live at x28 y3/5/7)
  const MUSH_SPOTS = [
    { tx: 28, ty: 2 }, { tx: 28, ty: 4 }, { tx: 28, ty: 6 }, { tx: 28, ty: 8 },
    { tx: 29, ty: 2 }, { tx: 29, ty: 3 }, { tx: 29, ty: 4 }, { tx: 29, ty: 5 },
    { tx: 29, ty: 6 }, { tx: 29, ty: 7 }, { tx: 29, ty: 8 },
  ];
  // tiles where dig marks may NOT spawn (other modules' structures on grass)
  const NO_DIG = new Set();
  for (let x = 11; x <= 17; x++) for (let y = 11; y <= 16; y++) NO_DIG.add(x + "," + y); // court
  for (let x = 18; x <= 21; x++) for (let y = 12; y <= 17; y++) NO_DIG.add(x + "," + y); // sauna hut/tub
  ["16,9", "10,11", "14,11", "11,11", "12,11", "13,11"].forEach(k => NO_DIG.add(k)); // plinth, mailbox, sign, flowerbed

  // ---------- tuning ----------
  const DIGS_PER_DAY = [2, 3];
  const SHELLS_PER_DAY = [3, 5];
  const SHROOMS_PER_DAY = [3, 4];
  const BALLOON_EVERY = [160, 280];   // game-minutes between balloons (~2.5-4.5 game-hours)
  const BALLOON_SPEED = 15;           // px/s horizontal drift
  const INTERACT_R = 34, BOTTLE_R = 38, PARCEL_R = 38, SHOOT_DX = 80;

  // ---------- module state (plain JSON only) ----------
  let gs = null, ctx2 = null;
  const S = {
    digs: [],        // [{id,tx,ty}] crack marks
    digsDay: -1,     // game-day stamp (floor(state.day))
    picks: [],       // [{id,item,x,y,kind:'shell'|'shroom'}]
    pickDay: -1,
    bottle: null,    // {x,y} | null
    bottleDay: -1,   // real-day stamp (floor(Date.now()/864e5))
    balloon: { active: false, x: 0, y: 0, vx: 0, ph: 0, col: 0, told: false },
    bT: 120,         // game-minutes until next balloon (first: ~30s real)
    parcels: [],     // [{id,x,y}]
    assessed: [],    // fossil item ids discovered so far (museum reads this)
    nextId: 1,
  };
  let lastT = null;
  let fx = [];       // transient poof/sparkle FX — not serialized: {x,y,vx,vy,until,ttl,col}

  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const rint = ([a, b]) => a + Math.floor(Math.random() * (b - a + 1));
  const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
  const weighted = table => {
    let tot = 0; for (const r of table) tot += r[r.length - 1];
    let roll = Math.random() * tot;
    for (const r of table) { roll -= r[r.length - 1]; if (roll <= 0) return r; }
    return table[table.length - 1];
  };
  const hasShovel = () => !!(DH.tools && DH.tools.has && DH.tools.has("shovel"));
  const log = d => { if (DH.alog) DH.alog.add("find", d); };

  function puff(x, y, n, col) {
    const now = Date.now();
    for (let i = 0; i < n; i++)
      fx.push({ x: x + rnd(-9, 9), y: y + rnd(-8, 2), vx: rnd(-16, 16), vy: -20 - rnd(0, 18),
                until: now + 560, ttl: 0.56, col: col || "#efe4c8" });
  }
  function sparkleFX(x, y, n) {
    const now = Date.now();
    for (let i = 0; i < n; i++)
      fx.push({ x: x + rnd(-12, 12), y: y - rnd(0, 18), vx: 0, vy: -12,
                until: now + rnd(400, 800), ttl: 0.8, col: "#fff3a6", star: 1 });
  }

  // ---------- spawn helpers ----------
  function digCandidates() {
    const W = DH.world, out = [];
    for (let ty = 0; ty < W.H; ty++) for (let tx = 0; tx < W.W; tx++) {
      if (W.tileAt(tx, ty) !== W.GRASS) continue;
      const z = W.zone(tx, ty);
      if (z !== "yard" && z !== "pasture") continue;
      if (W.isBlocked(tx, ty) || NO_DIG.has(tx + "," + ty)) continue;
      out.push({ tx, ty });
    }
    return out;
  }

  function spawnDigs() {
    const pool = digCandidates().filter(c => !S.digs.some(d => d.tx === c.tx && d.ty === c.ty));
    const n = Math.min(rint(DIGS_PER_DAY), pool.length);
    for (let i = 0; i < n; i++) {
      const c = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
      S.digs.push({ id: S.nextId++, tx: c.tx, ty: c.ty });
    }
  }

  function spawnPicks() {
    const shore = SHORE.filter(c => !S.picks.some(p => p.x === c.tx * T + 16 && p.y === c.ty * T + 16));
    let n = Math.min(rint(SHELLS_PER_DAY), shore.length);
    for (let i = 0; i < n; i++) {
      const c = shore.splice(Math.floor(Math.random() * shore.length), 1)[0];
      S.picks.push({ id: S.nextId++, item: weighted(SHELL_TABLE)[0], kind: "shell",
                     x: c.tx * T + 16, y: c.ty * T + 16 });
    }
    if (gs && gs.season === "autumn") {
      const mpool = MUSH_SPOTS.filter(c => !S.picks.some(p => p.x === c.tx * T + 16 && p.y === c.ty * T + 16));
      n = Math.min(rint(SHROOMS_PER_DAY), mpool.length);
      for (let i = 0; i < n; i++) {
        const c = mpool.splice(Math.floor(Math.random() * mpool.length), 1)[0];
        S.picks.push({ id: S.nextId++, item: weighted(SHROOM_TABLE)[0], kind: "shroom",
                       x: c.tx * T + 16 + rnd(-4, 4), y: c.ty * T + 16 + rnd(-3, 3) });
      }
    }
  }

  function spawnBottle() {
    const c = pick(SHORE);
    S.bottle = { x: c.tx * T + 16 + rnd(-4, 4), y: c.ty * T + 16 + rnd(-3, 3) };
    log("bottle_ashore");
  }

  function spawnBalloon() {
    const dir = Math.random() < 0.5 ? 1 : -1;
    S.balloon = {
      active: true, told: false,
      x: dir > 0 ? -50 : DH.world.W * T + 50,
      y: rnd(60, 190), vx: dir * BALLOON_SPEED * rnd(0.85, 1.2),
      ph: rnd(0, 6.28), col: Math.floor(Math.random() * BALLOON_COLORS.length),
    };
    log("balloon");
  }

  // ground landing spot for a shot-down parcel: first walkable tile below (x, y)
  function dropSpot(x, y) {
    const W = DH.world, tx = Math.max(0, Math.min(W.W - 1, Math.floor(x / T)));
    for (let ty = Math.max(0, Math.floor(y / T)); ty < W.H; ty++) {
      if (!W.isSolid(tx, ty) && !W.isBlocked(tx, ty)) return { x: tx * T + 16, y: ty * T + 16 };
      // skip sideways off water/hut roofs so parcels stay reachable
      if (W.tileAt(tx, ty) === W.WATER || W.isBlocked(tx, ty)) {
        for (const dx of [-1, 1, -2, 2]) {
          const nx = tx + dx;
          if (nx < 0 || nx >= W.W) continue;
          if (!W.isSolid(nx, ty) && !W.isBlocked(nx, ty)) return { x: nx * T + 16, y: ty * T + 16 };
        }
      }
    }
    return { x: tx * T + 16, y: 12 * T + 16 }; // fallback: mid-yard
  }

  function ensureDaySpawns() {
    if (!gs) return;
    const dayN = Math.floor(gs.day || 0);
    if (S.digsDay !== dayN) { S.digsDay = dayN; S.digs = []; spawnDigs(); }
    if (S.pickDay !== dayN) { S.pickDay = dayN; S.picks = []; spawnPicks(); }
    const rd = Math.floor(Date.now() / 864e5);
    if (S.bottleDay !== rd) { S.bottleDay = rd; if (!S.bottle) spawnBottle(); }
  }

  // ---------- actions (remote-callable) ----------
  function digSpot(id) {
    const i = S.digs.findIndex(d => d.id === id);
    if (i < 0) return false;
    const d = S.digs[i];
    const px = d.tx * T + 16, py = d.ty * T + 16;
    const lucky = hasShovel();
    const itemId = Math.random() < (lucky ? 0.10 : 0.06) ? "gyroid" : "fossil-un";
    if (!DH.inv.add(itemId, 1)) { DH.toast("Pockets full! 🎒"); return false; }
    S.digs.splice(i, 1);
    puff(px, py, 8); sparkleFX(px, py, 3);
    if (itemId === "gyroid") {
      DH.toast("Doot-doot! 🗿 A strange gyroid popped out!", 2600);
      log("dig:gyroid");
    } else {
      DH.toast(`Dug up an unassessed fossil 🦴${lucky ? " (shovel luck)" : ""} — assess it at the plinth`);
      log("dig:fossil");
    }
    gs.happiness += 1;
    return true;
  }

  function pickItem(id) {
    const i = S.picks.findIndex(p => p.id === id);
    if (i < 0) return false;
    const p = S.picks[i];
    if (!DH.inv.add(p.item, 1)) { DH.toast("Pockets full! 🎒"); return false; }
    S.picks.splice(i, 1);
    sparkleFX(p.x, p.y, 4);
    DH.toast(`Picked up ${DH.items.label(p.item)}`);
    log("pickup:" + p.item);
    return true;
  }

  function pickupBottle() {
    if (!S.bottle) return false;
    const [rid] = pick(RECIPES);
    if (!DH.inv.add("recipe-" + rid, 1)) { DH.toast("Pockets full! 🎒"); return false; }
    sparkleFX(S.bottle.x, S.bottle.y, 6);
    DH.toast(`A message in a bottle! 🍾 It's a ${DH.items.label("recipe-" + rid)} card!`, 2800);
    log("bottle:recipe-" + rid);
    S.bottle = null;
    gs.happiness += 1;
    return true;
  }

  function shootBalloon() {
    const b = S.balloon;
    if (!b.active) return false;
    b.active = false;
    const land = dropSpot(b.x, b.y + 20);
    S.parcels.push({ id: S.nextId++, x: land.x, y: land.y });
    puff(b.x, b.y, 10, "#ffd2d8");
    DH.toast("Pop! 🎈 The present is falling…");
    log("shoot");
    return true;
  }

  function openParcel(id) {
    const i = S.parcels.findIndex(p => p.id === id);
    if (i < 0) return false;
    const p = S.parcels[i];
    const row = weighted(PARCEL_TABLE);
    const id2 = row[1] === "recipe-rand" ? "recipe-" + pick(RECIPES)[0] : row[1];
    if (row[0] === "coins") {
      S.parcels.splice(i, 1);
      gs.coins += row[2];
      sparkleFX(p.x, p.y, 6);
      DH.toast(`🎁 Inside: a sack of bells! +🪙${row[2]}`, 2400);
    } else {
      if (!DH.inv.add(id2, row[2])) { DH.toast("Pockets full! 🎒"); return false; }
      S.parcels.splice(i, 1);
      sparkleFX(p.x, p.y, 6);
      DH.toast(`🎁 Inside: ${DH.items.label(id2)} ×${row[2]}!`, 2400);
    }
    puff(p.x, p.y, 6, "#ffe58a");
    log("parcel:" + (row[0] === "coins" ? "bells" : id2));
    gs.happiness += 2;
    return true;
  }

  function assessAll() {
    const n = DH.inv.count("fossil-un");
    if (!n) { DH.toast("No fossils to assess — dig up X marks in the ground 🦴"); return false; }
    const found = [];
    for (let i = 0; i < n; i++) {
      const row = weighted(FOSSIL_TABLE);
      if (!DH.inv.remove("fossil-un", 1)) break;
      if (!DH.inv.add(row[0], 1)) { DH.inv.add("fossil-un", 1); break; } // pockets full mid-way
      found.push(row[0]);
      if (!S.assessed.includes(row[0])) S.assessed.push(row[0]);
    }
    if (!found.length) { DH.toast("Pockets full! 🎒"); return false; }
    const names = found.map(f => DH.items.get(f).name);
    const uniq = [...new Set(names)];
    sparkleFX(PLINTH_C.x, PLINTH_C.y - 16, 8);
    DH.toast(`🔍 Assessed: ${uniq.join(", ")}${found.length > uniq.length ? ` ×${found.length}` : ""}`, 3200);
    log("assess:" + found.join(","));
    gs.happiness += found.length;
    return true;
  }

  const API = { digSpot, pickItem, pickupBottle, shootBalloon, openParcel, assessAll };

  // ---------- drawing ----------
  function drawCrack(ctx, px, py, ph) {
    // disturbed soil patch + X crack + a peeking bone
    ctx.fillStyle = "#6b4a2c";
    ctx.fillRect(px + 9, py + 11, 14, 10);
    ctx.fillRect(px + 11, py + 9, 10, 14);
    ctx.fillStyle = "#4e3320";
    ctx.fillRect(px + 11, py + 13, 3, 2); ctx.fillRect(px + 18, py + 15, 3, 2);
    // X mark
    ctx.fillStyle = "#3a2414";
    ctx.fillRect(px + 11, py + 11, 3, 3); ctx.fillRect(px + 18, py + 18, 3, 3);
    ctx.fillRect(px + 18, py + 11, 3, 3); ctx.fillRect(px + 11, py + 18, 3, 3);
    ctx.fillRect(px + 14, py + 14, 4, 4);
    // bone tip poking out
    ctx.fillStyle = "#e8e0cc";
    ctx.fillRect(px + 14, py + 8, 4, 3); ctx.fillRect(px + 15, py + 7, 2, 1);
    // idle shimmer
    const a = 0.25 + 0.55 * Math.abs(Math.sin(Date.now() / 380 + ph));
    ctx.globalAlpha = a;
    ctx.fillStyle = "#fff3a6";
    ctx.fillRect(px + 22, py + 8, 2, 2); ctx.fillRect(px + 21, py + 9, 4, 1);
    ctx.globalAlpha = 1;
  }

  function drawPlinth(ctx, px, py) {
    // stone pedestal with a little fossil plate on top
    ctx.fillStyle = "#6e757e"; ctx.fillRect(px + 5, py + 26, 22, 4);   // foot
    ctx.fillStyle = "#8d939b"; ctx.fillRect(px + 7, py + 16, 18, 10);  // column
    ctx.fillStyle = "#aab1b9"; ctx.fillRect(px + 7, py + 16, 18, 2);
    ctx.fillStyle = "#7a828c"; ctx.fillRect(px + 9, py + 18, 14, 1); ctx.fillRect(px + 9, py + 22, 14, 1);
    ctx.fillStyle = "#b9c0c7"; ctx.fillRect(px + 5, py + 12, 22, 4);   // cap
    ctx.fillStyle = "#e8dcc0"; ctx.fillRect(px + 10, py + 6, 12, 6);   // fossil slab
    ctx.fillStyle = "#8a7455"; ctx.fillRect(px + 12, py + 8, 8, 2);    // bone imprint
    ctx.fillRect(px + 13, py + 7, 2, 4);
    ctx.font = "9px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("🔍", px + 16, py + 2 + Math.sin(Date.now() / 700) * 1.5);
  }

  function drawBottle(ctx, x, y, now) {
    const bob = Math.sin(now / 480 + x) * 1.6;
    y += bob;
    ctx.fillStyle = "#00000022";
    ctx.beginPath(); ctx.ellipse(x, y + 8, 9, 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#63c9b4";                                   // glass body
    ctx.beginPath(); ctx.ellipse(x, y, 9, 6, -0.3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#8fe0cf";
    ctx.beginPath(); ctx.ellipse(x - 1, y - 2, 6, 3, -0.3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#4aa892"; ctx.fillRect(x + 6, y - 6, 4, 7); // neck
    ctx.fillStyle = "#c9a86a"; ctx.fillRect(x + 7, y - 9, 3, 4); // cork
    ctx.fillStyle = "#fff8e0"; ctx.fillRect(x - 5, y - 2, 7, 4); // letter inside
    ctx.fillStyle = "#d8c898"; ctx.fillRect(x - 4, y - 1, 5, 1);
  }

  function drawShell(ctx, x, y, item) {
    if (item === "shell-conch") {
      ctx.fillStyle = "#f2b38a";
      ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#e08a5a"; ctx.fillRect(x + 3, y - 4, 5, 3); ctx.fillRect(x + 5, y - 6, 3, 3);
      ctx.fillStyle = "#d97b4d"; ctx.fillRect(x - 2, y - 1, 4, 2);
    } else if (item === "shell-coral") {
      ctx.fillStyle = "#ff8a80";
      ctx.fillRect(x - 1, y - 5, 3, 9);
      ctx.fillRect(x - 5, y - 3, 3, 6); ctx.fillRect(x + 3, y - 4, 3, 7);
      ctx.fillRect(x - 6, y - 5, 2, 2); ctx.fillRect(x + 5, y - 6, 2, 2);
      ctx.fillStyle = "#ffa9a0"; ctx.fillRect(x - 1, y - 5, 3, 2);
    } else if (item === "shell-star") {
      ctx.fillStyle = "#ff9a4d";
      ctx.fillRect(x - 1, y - 6, 3, 12); ctx.fillRect(x - 6, y - 1, 12, 3);
      ctx.fillRect(x - 4, y - 4, 2, 2); ctx.fillRect(x + 3, y - 4, 2, 2);
      ctx.fillRect(x - 4, y + 3, 2, 2); ctx.fillRect(x + 3, y + 3, 2, 2);
      ctx.fillStyle = "#ffbe7d"; ctx.fillRect(x - 1, y - 1, 3, 3);
    } else { // shell
      ctx.fillStyle = "#ffb7c5";
      ctx.beginPath(); ctx.arc(x, y + 2, 5, Math.PI, 0); ctx.fill();
      ctx.fillRect(x - 5, y + 2, 10, 3);
      ctx.fillStyle = "#e58ba0";
      ctx.fillRect(x - 3, y - 1, 1, 5); ctx.fillRect(x, y - 3, 1, 7); ctx.fillRect(x + 3, y - 1, 1, 5);
    }
  }

  function drawShroom(ctx, x, y, item) {
    ctx.fillStyle = "#efe4cc"; ctx.fillRect(x - 2, y - 2, 4, 7);  // stem
    const cap = item === "shroom-red" ? "#d94f3d" : item === "shroom-truffle" ? "#6b4a34" : item === "shroom-brown" ? "#a06a3f" : "#c9854e";
    ctx.fillStyle = cap;
    ctx.beginPath(); ctx.arc(x, y - 2, item === "shroom-truffle" ? 5 : 6, Math.PI, 0); ctx.fill();
    ctx.fillRect(x - (item === "shroom-truffle" ? 5 : 6), y - 2, (item === "shroom-truffle" ? 10 : 12), 2);
    if (item === "shroom-red") { ctx.fillStyle = "#ffe8d8"; ctx.fillRect(x - 3, y - 6, 2, 2); ctx.fillRect(x + 1, y - 7, 2, 2); }
    if (item === "shroom-truffle") { ctx.fillStyle = "#8a6647"; ctx.fillRect(x - 3, y - 4, 6, 2); }
  }

  function drawParcel(ctx, x, y, now) {
    const bob = Math.sin(now / 500 + x * 0.3) * 1.2;
    y += bob;
    ctx.fillStyle = "#00000022";
    ctx.beginPath(); ctx.ellipse(x, y + 8, 9, 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#e35b6a"; ctx.fillRect(x - 8, y - 6, 16, 14);
    ctx.fillStyle = "#c94a58"; ctx.fillRect(x - 8, y + 4, 16, 4);
    ctx.fillStyle = "#ffd76b"; ctx.fillRect(x - 1, y - 6, 3, 14); ctx.fillRect(x - 8, y - 1, 16, 3);
    ctx.fillStyle = "#ffe9a8"; ctx.fillRect(x - 2, y - 9, 5, 4);
  }

  function drawBalloon(ctx, x, y, now) {
    const b = S.balloon;
    const bobY = Math.sin(now / 600 + b.ph) * 5;
    const bx = x, by = y + bobY;
    const col = BALLOON_COLORS[b.col % BALLOON_COLORS.length];
    // ground shadow (where it would land)
    ctx.fillStyle = "#00000018";
    ctx.beginPath(); ctx.ellipse(x, by + 92, 12, 3.5, 0, 0, Math.PI * 2); ctx.fill();
    // string + present
    ctx.strokeStyle = "#6a5638"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(bx, by + 12); ctx.lineTo(bx - 2, by + 30); ctx.stroke();
    ctx.fillStyle = "#e35b6a"; ctx.fillRect(bx - 6, by + 28, 11, 10);
    ctx.fillStyle = "#ffd76b"; ctx.fillRect(bx - 1, by + 28, 2, 10); ctx.fillRect(bx - 6, by + 32, 11, 2);
    // envelope
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.ellipse(bx, by, 13, 15, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ffffff55";
    ctx.beginPath(); ctx.ellipse(bx - 4, by - 5, 4, 6, -0.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = col; ctx.fillRect(bx - 3, by + 13, 6, 4); // knot
    ctx.fillStyle = "#00000022"; ctx.fillRect(bx - 3, by + 13, 6, 1);
  }

  function drawSparkle(ctx, x, y, ph) {
    const a = Math.abs(Math.sin(Date.now() / 340 + ph));
    if (a < 0.25) return;
    ctx.globalAlpha = 0.35 + 0.6 * a;
    ctx.fillStyle = "#fff8c9";
    ctx.fillRect(x - 1, y - 3, 2, 7); ctx.fillRect(x - 3, y - 1, 7, 2);
    ctx.globalAlpha = 1;
  }

  // ---------- module contract ----------
  const M = (DH.finds = {
    authority: true,
    _state: S,
    assessed: S.assessed,   // museum module reads this list later

    init(state) {
      gs = state;
      ctx2 = document.getElementById("cv").getContext("2d");
    },

    start(state) {
      gs = state;
      M.authority = !(DH.net && DH.net.online && DH.net.role === "guest");
      if (M.authority) ensureDaySpawns(); // guests get state from host snapshots
      lastT = null;
    },

    update(dt, state) {
      gs = state;
      const now = Date.now();
      fx = fx.filter(f => f.until > now);
      if (!M.authority) return;

      const dm = lastT == null ? 0 : (state.timeMin - lastT + DAY) % DAY;
      lastT = state.timeMin;
      ensureDaySpawns();

      // balloon cadence + drift
      const b = S.balloon;
      S.bT -= dm;
      if (S.bT <= 0 && !b.active) { spawnBalloon(); S.bT = rnd(BALLOON_EVERY[0], BALLOON_EVERY[1]); }
      if (b.active) {
        b.x += b.vx * dt;
        if (b.x < -70 || b.x > DH.world.W * T + 70) b.active = false;
        else if (!b.told && b.x > 40 && b.x < DH.world.W * T - 40) {
          b.told = true;
          DH.toast("🎈 A balloon is drifting overhead — shoot it down!", 2600);
        }
      }
    },

    interactables(p) {
      const out = [];
      for (const d of S.digs) {
        const x = d.tx * T + 16, y = d.ty * T + 16;
        if (dist2(p.x, p.y, x, y) < INTERACT_R * INTERACT_R)
          out.push({ label: "Dig up ⛏️", x, y, action: () => M.digSpot(d.id) });
      }
      for (const p2 of S.picks) {
        if (dist2(p.x, p.y, p2.x, p2.y) < INTERACT_R * INTERACT_R)
          out.push({ label: `Pick up ${DH.items.label(p2.item)}`, x: p2.x, y: p2.y, action: () => M.pickItem(p2.id) });
      }
      if (S.bottle && dist2(p.x, p.y, S.bottle.x, S.bottle.y) < BOTTLE_R * BOTTLE_R)
        out.push({ label: "Pick up bottle 🍾", x: S.bottle.x, y: S.bottle.y, action: () => M.pickupBottle() });
      for (const pc of S.parcels) {
        if (dist2(p.x, p.y, pc.x, pc.y) < PARCEL_R * PARCEL_R)
          out.push({ label: "Open present 🎁", x: pc.x, y: pc.y, action: () => M.openParcel(pc.id) });
      }
      const un = DH.inv ? DH.inv.count("fossil-un") : 0;
      if (dist2(p.x, p.y, PLINTH_C.x, PLINTH_C.y) < PLINTH_C.r * PLINTH_C.r)
        out.push({ label: un ? `Assess fossils ×${un} 🔍` : "Assess fossils 🔍",
                   x: PLINTH_C.x, y: PLINTH_C.y, action: () => M.assessAll() });
      const b = S.balloon;
      if (b.active && Math.abs(p.x - b.x) < SHOOT_DX && p.y - b.y > -30)
        out.push({ label: "Shoot balloon 🎈", x: b.x, y: p.y, action: () => M.shootBalloon() });
      out.sort((a, b2) => dist2(p.x, p.y, a.x, a.y) - dist2(p.x, p.y, b2.x, b2.y));
      return out;
    },

    drawGround(ctx, camX, camY) {
      ctx2 = ctx;
      for (const d of S.digs) drawCrack(ctx, d.tx * T - camX, d.ty * T - camY, d.id);
    },

    collectDraws(draws, camX, camY) {
      if (!ctx2) ctx2 = document.getElementById("cv").getContext("2d");
      const now = Date.now();
      draws.push({ y: PLINTH_C.y, fn: () => drawPlinth(ctx2, PLINTH.tx * T - camX, PLINTH.ty * T - camY) });
      if (S.bottle) {
        const b = S.bottle;
        draws.push({ y: b.y + 10, fn: () => drawBottle(ctx2, b.x - camX, b.y - camY, now) });
      }
      for (const pk of S.picks) {
        const item = pk.item;
        draws.push({ y: pk.y + 8, fn: () => {
          DH.sprites.shadow(ctx2, pk.x - camX, pk.y - camY + 6, 10);
          if (pk.kind === "shroom") drawShroom(ctx2, pk.x - camX, pk.y - camY, item);
          else drawShell(ctx2, pk.x - camX, pk.y - camY, item);
        } });
      }
      for (const pc of S.parcels)
        draws.push({ y: pc.y + 10, fn: () => drawParcel(ctx2, pc.x - camX, pc.y - camY, now) });
    },

    drawOverlay(ctx, camX, camY) {
      ctx2 = ctx;
      const now = Date.now();
      // sky balloon — ignores terrain, drawn over everything
      if (S.balloon.active) drawBalloon(ctx, S.balloon.x - camX, S.balloon.y - camY, now);
      // discoverability shimmer over everything pickable
      for (const d of S.digs) drawSparkle(ctx, d.tx * T + 24 - camX, d.ty * T + 7 - camY, d.id);
      if (S.bottle) drawSparkle(ctx, S.bottle.x - camX, S.bottle.y - 12 - camY, 2);
      for (const pk of S.picks) drawSparkle(ctx, pk.x + 7 - camX, pk.y - 9 - camY, pk.id);
      for (const pc of S.parcels) drawSparkle(ctx, pc.x - camX, pc.y - 13 - camY, pc.id);
      drawSparkle(ctx, PLINTH_C.x + 10 - camX, PLINTH_C.y - 22 - camY, 0.5);
      // poof / sparkle FX (timestamp-based: animates for guests without update())
      for (const f of fx) {
        const life = (f.until - now) / (f.ttl * 1000);
        if (life <= 0) continue;
        const t = 1 - life;
        const x = f.x + f.vx * t * f.ttl - camX, y = f.y + f.vy * t * f.ttl - camY;
        ctx.globalAlpha = Math.max(0, life);
        if (f.star) {
          ctx.fillStyle = f.col;
          ctx.fillRect(x - 1, y - 3, 2, 7); ctx.fillRect(x - 3, y - 1, 7, 2);
        } else {
          ctx.fillStyle = f.col;
          ctx.fillRect(x - 2, y - 2, 4 + t * 3, 4 + t * 3);
        }
        ctx.globalAlpha = 1;
      }
    },

    // ---------- sync boundary ----------
    serialize() {
      return JSON.parse(JSON.stringify({
        digs: S.digs, digsDay: S.digsDay,
        picks: S.picks, pickDay: S.pickDay,
        bottle: S.bottle, bottleDay: S.bottleDay,
        balloon: S.balloon, bT: S.bT,
        parcels: S.parcels, assessed: S.assessed, nextId: S.nextId,
      }));
    },
    deserialize(d) {
      if (!d) return;
      if (Array.isArray(d.digs)) S.digs = d.digs;
      if (typeof d.digsDay === "number") S.digsDay = d.digsDay;
      if (Array.isArray(d.picks)) S.picks = d.picks;
      if (typeof d.pickDay === "number") S.pickDay = d.pickDay;
      if (d.bottle !== undefined) S.bottle = d.bottle;
      if (typeof d.bottleDay === "number") S.bottleDay = d.bottleDay;
      if (d.balloon) S.balloon = Object.assign({ active: false, x: 0, y: 0, vx: 0, ph: 0, col: 0, told: false }, d.balloon);
      if (typeof d.bT === "number") S.bT = d.bT;
      if (Array.isArray(d.parcels)) S.parcels = d.parcels;
      if (Array.isArray(d.assessed)) { S.assessed = d.assessed; M.assessed = S.assessed; }
      if (typeof d.nextId === "number") S.nextId = d.nextId;
    },
    remoteAction(name, args) {
      return typeof API[name] === "function" ? API[name].apply(null, args || []) : false;
    },
    offline(offMin) {
      if (!gs) return [];
      const parts = [];
      const rd = Math.floor(Date.now() / 864e5);
      if (S.bottleDay !== rd) { S.bottleDay = rd; if (!S.bottle) { spawnBottle(); parts.push("a bottle washed ashore 🍾"); } }
      return parts;
    },

    // exposed for remoteAction + console/testing
    digSpot, pickItem, pickupBottle, shootBalloon, openParcel, assessAll,
  });
})();

DH.register("finds", DH.finds);
