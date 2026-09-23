/* dream-home island module — island development (spec G-1..G-6).
   Contract with game.js (same as forage.js / furniture.js):
     DH.island.init(state)            – once at load
     DH.island.start(state)           – on each run
     DH.island.update(dt, state)      – host sim only (guests render snapshots)
     DH.island.drawGround(...)        – paved paths, bridge deck, lookout deck
     DH.island.collectDraws(draws, camX, camY) – signs, fences, public works
     DH.island.drawOverlay(...)       – FX, lamp glow, mode ghosts
     DH.island.interactables(p)       – -> [{label,x,y,action}]
     DH.island.serialize()/deserialize(data) / remoteAction(name,args)
     DH.island.offline(offMin)        – "while you were away" parts

   G-1 Construction projects (bridge over the pond narrows, lookout deck):
     fundraising sign near the pond -> donate bells -> next game-day the
     structure appears with confetti + toast. Bridge tiles become walkable
     via a isSolid wrap (same trick furniture/forage use for world.blocked).
   G-2 Relocation: town board "Move something" relocates own-placed flowers,
     yard furniture, and (only with stamina, like tree-digging) own trees.
     Done by editing the other module's serialize() payload and handing it
     back to deserialize() — no edits to those modules.
   G-3 Garden creator: pave mode paints path tiles on yard grass (cap 40),
     fence mode plants fence pieces on tile edges (cap 20, needs a
     "fence" item in pockets, bought at the town board).
   G-4 Public works: donation-funded bench / streetlamps / fountain /
     windmill that appear permanently once funded; lamps glow at night.
   G-5 Island rating: 1-5 stars from flowers, placed furniture, public
     works, villagers (DH.villagers if present) minus weed neglect
     (DH.forage if present). Checked at the town board. 5★ once grants a
     golden-rose item + confetti.
   G-6 Ordinances: one active at a time, persisted, exposed to other
     modules via DH.island.ordinance / .isOrdinance() / .sellPriceMult /
     .timeShiftMin / .flowersNeverWilt. In-module effects: early-bird and
     night-owl pay a small morning/evening happiness bonus; green-thumb
     keeps flowers watered; bells-up raises sellPriceMult for econ.js.
*/
(function () {
  const DH = (window.DH = window.DH || {});
  const T = 32, GDAY = 24 * 60;

  // ---------- fixed world spots ----------
  const BRIDGE_TILES = [[22, 15], [23, 15], [24, 15], [25, 15], [26, 15], [27, 15]]; // pond narrows
  const DECK_TILES = [[28, 17], [29, 17], [28, 18], [29, 18]];                       // lookout deck
  const FUND_SIGN = { tx: 21, ty: 12, r: 48 };   // "bridge fund" sign near the pond
  const BOARD = { tx: 15, ty: 11, r: 48 };       // town board on the path
  // G-4 public works placements (permanent once built)
  const WORKS = {
    bench:    { ico: "🪑", name: "Park bench",   cost: 1500, tiles: [[10, 12]] },
    lamp1:    { ico: "💡", name: "Streetlamp (west)", cost: 1200, tiles: [[6, 10]] },
    lamp2:    { ico: "💡", name: "Streetlamp (pond)", cost: 1200, tiles: [[26, 18]] },
    fountain: { ico: "⛲", name: "Fountain",     cost: 4000, tiles: [[20, 12]] },
    windmill: { ico: "🌬️", name: "Windmill",     cost: 6000, tiles: [[29, 11]] },
  };
  const PROJECTS = {
    bridge: { ico: "🌉", name: "Bridge over the pond", cost: 5000, tiles: BRIDGE_TILES },
    stairs: { ico: "🪜", name: "Stairs to lookout deck", cost: 8000, tiles: DECK_TILES },
  };
  // tiles my structures/signs sit on -> reserved (blocked) so weeds/flowers
  // never spawn under them and players don't walk through them
  const RESERVED = new Set(
    [[FUND_SIGN.tx, FUND_SIGN.ty], [BOARD.tx, BOARD.ty]]
      .concat(BRIDGE_TILES, DECK_TILES)
      .concat(...Object.values(WORKS).map(w => w.tiles))
      .map(t => t.join(","))
  );
  // forage.js forbidden spots (duplicated — we can't import them)
  const FORBID_TILES = new Set([
    "10,11", "11,11", "12,11", "13,11", "14,11", "21,15", "16,5", "5,10", "5,11", "9,10",
  ]);
  const FORBID_RECTS = [[11, 12, 17, 16], [19, 13, 21, 17]]; // court, sauna
  const forbidden = (tx, ty) =>
    FORBID_TILES.has(tx + "," + ty) || FORBID_RECTS.some(r => tx >= r[0] && tx <= r[2] && ty >= r[1] && ty <= r[3]);

  const PATH_CAP = 40, FENCE_CAP = 20, FENCE_COST = 20;
  const DONATE_AMTS = [100, 500, 1000];
  // furniture catalog entries that span 2 tiles (serialize() drops w)
  const WIDE_FURN = new Set(["rug", "table", "sofa", "bed", "bathtub", "piano", "tv"]);

  // ---------- items ----------
  DH.items.def("fence", { name: "Fence", ico: "🚧", cat: "furniture", price: 10, stack: 10 });
  DH.items.def("golden-rose", { name: "Golden rose", ico: "🌹", cat: "flower", price: 1000, stack: 1 });

  // ---------- module state (plain JSON only — save + net payload) ----------
  let gs = null, C = null;
  const S = {
    raised: {},        // projectId/workId -> bells donated
    funded: {},        // id -> true when fully funded
    built: {},         // id -> true once construction finished (next day)
    buildDay: {},      // id -> floor(day) the build completes on
    paved: [],         // ["x,y"] player-painted path tiles
    fences: [],        // [{tx,ty,dir}] fence pieces on tile edges
    ordinance: null,   // "early-bird" | "night-owl" | "bells-up" | "green-thumb" | null
    goldenRose: false, // 5★ reward already granted
    ordDay: -1,        // last game-day the ordinance bonus was paid
    fx: [],            // {k,x,y,vx,vy,age,ttl}
  };
  // view/session layer — never serialized
  let mode = { pid: 0, kind: null, ref: null }; // "pave" | "fence" | "move"
  let cancelBtn = null;
  let saveT = 0;

  const rnd = (a, b) => a + Math.random() * (b - a);
  const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
  const today = () => Math.floor((gs && gs.day) || 0);
  const isNight = () => gs && (gs.timeMin >= 19 * 60 || gs.timeMin < 6 * 60);
  const DIRV = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const alog = (e, d) => { if (DH.alog) DH.alog.add(e, d); };

  function fx(k, x, y, o) { if (S.fx.length < 90) S.fx.push(Object.assign({ k, x, y, vx: 0, vy: -30, age: 0, ttl: 1 }, o)); }
  function confetti(x, y, n = 14) {
    const cols = ["#e05b8a", "#5bc8d0", "#ffd76b", "#8ad05b", "#c58bff", "#ff9a5c"];
    for (let i = 0; i < n; i++)
      fx("conf", x + rnd(-16, 16), y - rnd(4, 22), { vx: rnd(-26, 26), vy: rnd(-46, -18), ttl: rnd(0.7, 1.3), c: cols[i % cols.length], sz: rnd(2, 4) });
  }
  const sparks = (x, y, n = 5) => { for (let i = 0; i < n; i++) fx("spark", x + rnd(-10, 10), y - rnd(2, 16), { vy: -10, ttl: rnd(0.5, 0.8), sz: rnd(2, 3) }); };
  const poof = (x, y) => { for (let i = 0; i < 4; i++) fx("poof", x + rnd(-8, 8), y + rnd(-8, 0), { vy: -12, ttl: 0.5, sz: rnd(3, 5) }); };

  // ---------- world.blocked management (only keys we own) ----------
  const myBlocked = new Set();
  function blockTile(tx, ty) {
    const k = tx + "," + ty;
    if (!myBlocked.has(k)) { myBlocked.add(k); DH.world.blocked.add(k); }
  }
  function unblockTile(tx, ty) {
    const k = tx + "," + ty;
    if (myBlocked.delete(k)) DH.world.blocked.delete(k);
  }
  function rebuildBlocked() {
    for (const k of [...myBlocked]) DH.world.blocked.delete(k);
    myBlocked.clear();
    blockTile(FUND_SIGN.tx, FUND_SIGN.ty);
    blockTile(BOARD.tx, BOARD.ty);
    for (const id in WORKS)
      if (S.built[id]) WORKS[id].tiles.forEach(([tx, ty]) => blockTile(tx, ty));
    if (S.built.stairs) DECK_TILES.forEach(([tx, ty]) => blockTile(tx, ty));
  }
  const bridgeSet = () => new Set(BRIDGE_TILES.map(t => t.join(",")));

  // ---------- helpers reading other modules defensively ----------
  function forageState() {
    try {
      const d = DH.forage && typeof DH.forage.serialize === "function" ? DH.forage.serialize() : null;
      return d && typeof d === "object" ? d : null;
    } catch (e) { return null; }
  }
  function furnitureItems() {
    try {
      const d = DH.furniture && typeof DH.furniture.serialize === "function" ? DH.furniture.serialize() : null;
      return d && Array.isArray(d.items) ? d.items : [];
    } catch (e) { return []; }
  }
  function villagerCount() {
    try {
      const v = DH.villagers;
      if (!v) return 0;
      const d = typeof v.serialize === "function" ? v.serialize() : null;
      if (d && Array.isArray(d.vils)) return d.vils.length;
      if (v._state && Array.isArray(v._state.vils)) return v._state.vils.length;
    } catch (e) {}
    return 0;
  }
  // live forage state (for green-thumb watering) — never required
  function forageLive() { return (DH.forage && DH.forage._S) || null; }
  function stamina() {
    const fs = forageLive();
    return fs && typeof fs.stamina === "number" ? fs.stamina : 0;
  }

  // a grass yard tile free of every other module's occupancy (excluding
  // optional self-kind refs for moves)
  function freeYardTile(tx, ty, exclude) {
    const W = DH.world, k = tx + "," + ty;
    if (W.tileAt(tx, ty) !== W.GRASS || W.zone(tx, ty) !== "yard") return false;
    // tiles the moved entity currently occupies don't count as blocked
    const own = exclude ? ownTiles(exclude) : null;
    if ((W.isBlocked(tx, ty) && !(own && own.has(k))) || forbidden(tx, ty) || RESERVED.has(k)) return false;
    if (S.paved.includes(k)) return false;
    const f = forageState();
    if (f) {
      const kindOf = e => (e.sp !== undefined ? "flower" : e.kind !== undefined ? "tree" : "other");
      const hit = arr => (arr || []).some(e =>
        e && e.tx === tx && e.ty === ty && !(exclude && exclude.kind === kindOf(e) && exclude.tx === tx && exclude.ty === ty));
      if (hit(f.flowers) || hit(f.trees) || hit(f.weeds) || hit(f.rocks)) return false;
      if (f.glow && !f.glow.used && f.glow.tx === tx && f.glow.ty === ty) return false;
    }
    for (const it of furnitureItems()) {
      if (exclude && exclude.kind === "furniture" && it.uid === exclude.uid) continue;
      if (ty === it.y0 && tx >= it.x0 && tx < it.x0 + itemWidth(it)) return false;
    }
    return true;
  }
  function itemWidth(it) {
    // furniture serialize() drops w — recover footprint from the known catalog ids
    return it && WIDE_FURN.has(it.id) ? 2 : 1;
  }
  // tiles a movable currently occupies (for self-overlap moves)
  function ownTiles(m) {
    if (m.kind === "furniture") {
      const it = furnitureItems().find(i => i.uid === m.uid);
      if (!it) return new Set();
      const s = new Set();
      for (let i = 0; i < itemWidth(it); i++) s.add((it.x0 + i) + "," + it.y0);
      return s;
    }
    return new Set([m.tx + "," + m.ty]);
  }

  // ---------- G-1/G-4 projects ----------
  function projectList() { return Object.keys(PROJECTS).map(id => ({ id, ...PROJECTS[id] })); }
  function worksList() { return Object.keys(WORKS).map(id => ({ id, ...WORKS[id] })); }
  function builtCount() { return Object.keys(S.built).filter(id => S.built[id]).length; }

  function donate(id, amt) {
    const spec = PROJECTS[id] || WORKS[id];
    if (!spec || S.built[id]) return false;
    amt = Math.min(amt | 0, gs.coins, spec.cost - (S.raised[id] || 0));
    if (amt <= 0) { DH.toast(S.raised[id] ? "Fully funded! It opens tomorrow 🎉" : "Not enough coins 🪙"); return false; }
    gs.coins -= amt;
    S.raised[id] = (S.raised[id] || 0) + amt;
    if (!S.funded[id] && S.raised[id] >= spec.cost) {
      S.funded[id] = true;
      S.buildDay[id] = today() + 1;
      DH.toast(`${spec.ico} ${spec.name} fully funded — construction tomorrow!`, 3000);
    } else {
      DH.toast(`${spec.ico} ${spec.name}: ${S.raised[id]}/${spec.cost}🪙`);
    }
    alog("island-donate", `${id} ${amt}`);
    if (DH.save) DH.save.now();
    return true;
  }

  function finishBuild(id) {
    const spec = PROJECTS[id] || WORKS[id];
    if (!spec || S.built[id]) return;
    S.built[id] = true;
    rebuildBlocked();
    const [tx, ty] = spec.tiles[0];
    confetti(tx * T + 16, ty * T + 16, 20);
    gs.happiness = Math.max(0, gs.happiness + 6);
    DH.toast(`${spec.ico} ${spec.name} is open! The island feels bigger today 🎉`, 3600);
    alog("island-built", id);
    if (DH.save) DH.save.now();
  }
  function checkBuilds() {
    const d = today();
    for (const id in S.funded)
      if (S.funded[id] && !S.built[id] && S.buildDay[id] <= d) finishBuild(id);
  }

  // ---------- G-3 pave + fence ----------
  function paveToggle(tx, ty) {
    const k = tx + "," + ty;
    const i = S.paved.indexOf(k);
    if (i >= 0) {
      S.paved.splice(i, 1);
      poof(tx * T + 16, ty * T + 16);
      DH.toast("Path removed");
      return true;
    }
    if (S.paved.length >= PATH_CAP) { DH.toast(`Path limit (${PATH_CAP}) — remove some first`); return false; }
    const W = DH.world;
    if (W.tileAt(tx, ty) !== W.GRASS || W.zone(tx, ty) !== "yard" || W.isBlocked(tx, ty) ||
        forbidden(tx, ty) || RESERVED.has(k)) return false;
    S.paved.push(k);
    sparks(tx * T + 16, ty * T + 20, 4);
    DH.toast(`Paved (${S.paved.length}/${PATH_CAP}) ⬜`);
    alog("island-pave", k);
    return true;
  }

  function buyFence() {
    if (gs.coins < FENCE_COST) { DH.toast("Not enough coins 🪙"); return false; }
    if (DH.inv.add("fence", 1) <= 0) { DH.toast("Pockets are full! ☹️"); return false; }
    gs.coins -= FENCE_COST;
    DH.toast(`Bought a fence piece! 🚧 (${DH.inv.count("fence")} in pockets)`);
    return true;
  }
  const fenceAt = (tx, ty, dir) => S.fences.findIndex(f => f.tx === tx && f.ty === ty && f.dir === dir);
  function placeFence(tx, ty, dir) {
    if (S.fences.length >= FENCE_CAP) { DH.toast(`Fence limit (${FENCE_CAP})`); return false; }
    if (DH.inv.count("fence") <= 0) { DH.toast("No fence in pockets — buy one at the board 🚧"); return false; }
    const W = DH.world;
    if (W.zone(tx, ty) !== "yard" || !DIRV[dir] || fenceAt(tx, ty, dir) >= 0) return false;
    const [dx, dy] = DIRV[dir];
    const nx = tx + dx, ny = ty + dy;
    if (nx < 0 || ny < 0 || nx >= W.W || ny >= W.H) return false;
    DH.inv.remove("fence", 1);
    S.fences.push({ tx, ty, dir });
    sparks(tx * T + 16 + dx * 16, ty * T + 16 + dy * 16, 4);
    DH.toast(`Fence placed (${S.fences.length}/${FENCE_CAP}) 🚧`);
    alog("island-fence", `${tx},${ty},${dir}`);
    return true;
  }
  function removeFence(i) {
    const f = S.fences[i];
    if (!f) return false;
    S.fences.splice(i, 1);
    if (DH.inv.add("fence", 1) <= 0) gs.coins += 5; // pockets full -> tiny refund
    poof(f.tx * T + 16, f.ty * T + 16);
    DH.toast("Fence removed 🚧");
    return true;
  }

  // ---------- G-2 relocation ----------
  function movableList() {
    const out = [];
    const f = forageState();
    if (f && Array.isArray(f.flowers))
      f.flowers.forEach(fl => out.push({ kind: "flower", tx: fl.tx, ty: fl.ty, ico: "🌸", label: `Flower (${fl.tx},${fl.ty})` }));
    for (const it of furnitureItems()) {
      const z = DH.world.zone(it.x0, it.y0);
      if (z === "yard") out.push({ kind: "furniture", uid: it.uid, tx: it.x0, ty: it.y0, ico: "🪑", label: `${it.id} (${it.x0},${it.y0})` });
    }
    if (f && Array.isArray(f.trees) && stamina() > 0)
      f.trees.forEach(t => {
        if (DH.world.zone(t.tx, t.ty) === "yard")
          out.push({ kind: "tree", tx: t.tx, ty: t.ty, ico: "🌳", label: `Tree (${t.tx},${t.ty}) · 1⚡` });
      });
    return out;
  }

  function moveApply(m, tx, ty) {
    // validate destination for the moved footprint
    if (m.kind === "furniture") {
      const items = furnitureItems();
      const it = items.find(i => i.uid === m.uid);
      if (!it) return false;
      const w = itemWidth(it);
      for (let i = 0; i < w; i++) if (!freeYardTile(tx + i, ty, m)) return false;
      const data = DH.furniture.serialize();
      const e = data.items.find(i => i.uid === m.uid);
      if (!e) return false;
      e.x0 = tx; e.y0 = ty;
      DH.furniture.deserialize(data);
      poof(tx * T + 16, ty * T + 16);
      DH.toast(`🪑 Moved to (${tx},${ty})`);
      return true;
    }
    if (!freeYardTile(tx, ty, m)) return false;
    const data = DH.forage.serialize();
    if (m.kind === "flower") {
      const fl = (data.flowers || []).find(x => x.tx === m.tx && x.ty === m.ty);
      if (!fl) return false;
      fl.tx = tx; fl.ty = ty;
      DH.forage.deserialize(data);
      poof(tx * T + 16, ty * T + 16);
      DH.toast(`🌸 Flower moved to (${tx},${ty})`);
      return true;
    }
    if (m.kind === "tree") {
      if (stamina() <= 0) { DH.toast("Moving a tree needs energy — eat an apple 🍎"); return false; }
      const t = (data.trees || []).find(x => x.tx === m.tx && x.ty === m.ty);
      if (!t) return false;
      t.tx = tx; t.ty = ty;
      data.stamina = Math.max(0, (data.stamina || 0) - 1);
      DH.forage.deserialize(data);
      poof(tx * T + 16, ty * T + 16);
      DH.toast(`🌳 Tree moved to (${tx},${ty}) — 1⚡ spent`);
      return true;
    }
    return false;
  }

  // ---------- G-5 island rating ----------
  function rating() {
    const f = forageState();
    const flowers = f && Array.isArray(f.flowers) ? f.flowers.length : 0;
    const weeds = f && Array.isArray(f.weeds) ? f.weeds.length : 0;
    const trees = f && Array.isArray(f.trees) ? f.trees.length : 0;
    const furn = furnitureItems().length;
    const works = builtCount();
    const vils = villagerCount();
    let stars = 1;
    const hints = [];
    if (flowers >= 10) stars++; else hints.push(`plant more flowers (${flowers}/10) 🌸`);
    if (furn >= 4) stars++; else hints.push(`place more furniture (${furn}/4) 🪑`);
    if (works >= 4) stars++; else hints.push(`build public works (${works}/4) 🏗️`);
    if (vils >= 5) stars++; else if (DH.villagers) hints.push(`more villagers (${vils}/5) 🐾`);
    else hints.push("make friends — villagers boost the rating 🐾");
    if (trees >= 8) stars += 0; // trees are nice but the yard is small — no star, listed as flavor
    if (weeds > 5) { stars = Math.max(1, stars - 1); hints.push(`pull the weeds (${weeds}!) 🌿`); }
    else if (weeds === 0) hints.push("the yard is weed-free — lovely ✨");
    stars = Math.max(1, Math.min(5, stars));
    return { stars, flowers, weeds, furn, works, vils, hints };
  }

  // ---------- G-6 ordinances ----------
  const ORDINANCES = [
    { id: "early-bird",  ico: "🌅", name: "Early-bird",  desc: "morning bonus · others see shops open earlier" },
    { id: "night-owl",   ico: "🦉", name: "Night-owl",   desc: "evening bonus · others see late hours" },
    { id: "bells-up",    ico: "🪙", name: "Bells-up",    desc: "sell prices +10% (DH.island.sellPriceMult)" },
    { id: "green-thumb", ico: "🌱", name: "Green-thumb", desc: "flowers never wilt — always watered" },
  ];
  function setOrdinance(id) {
    if (id && !ORDINANCES.some(o => o.id === id)) return false;
    S.ordinance = id || null;
    const o = ORDINANCES.find(o => o.id === id);
    DH.toast(o ? `📜 ${o.name} ordinance enacted!` : "📜 Ordinance repealed");
    alog("island-ordinance", id || "none");
    if (DH.save) DH.save.now();
    return true;
  }
  function ordinanceBonus() {
    if (!S.ordinance || !gs) return;
    const t = gs.timeMin, d = today();
    if (S.ordDay === d) return;
    const moving = gs.players && gs.players.some(p => p.moving);
    if (!moving) return;
    if (S.ordinance === "early-bird" && t >= 6 * 60 && t < 9 * 60) {
      S.ordDay = d; gs.happiness += 3;
      DH.toast("🌅 Early-bird bonus! +🏠3 for a productive morning");
    } else if (S.ordinance === "night-owl" && (t >= 18 * 60 && t < 22 * 60)) {
      S.ordDay = d; gs.happiness += 3;
      DH.toast("🦉 Night-owl bonus! +🏠3 for a lively evening");
    }
  }
  function applyGreenThumb() {
    const fs = forageLive();
    if (!fs || !Array.isArray(fs.flowers)) return;
    for (const f of fs.flowers) { f.thirsty = false; f.watered = true; }
  }

  // ---------- placement modes (local UI, like furniture's placing) ----------
  function showCancel(on, label) {
    if (on && !cancelBtn) {
      cancelBtn = document.createElement("button");
      cancelBtn.style.cssText =
        "position:absolute;top:10px;right:10px;z-index:15;background:#c2434d;border:none;color:#fff;" +
        "padding:8px 14px;border-radius:10px;font-weight:700;cursor:pointer;font-size:14px";
      cancelBtn.addEventListener("click", () => cancelMode());
      document.getElementById("stage").appendChild(cancelBtn);
    }
    if (cancelBtn) { cancelBtn.textContent = label || "✖ Cancel"; cancelBtn.classList.toggle("hidden", !on); }
  }
  function startMode(kind, ref, p) {
    mode = { pid: p.pid, kind, ref: ref || null };
    showCancel(true, kind === "move" ? "✖ Stop moving" : kind === "pave" ? "✖ Stop paving" : "✖ Stop fencing");
    const tips = {
      pave: "⬜ Paving: stand on grass, tap A to pave/unpave",
      fence: "🚧 Fencing: face an edge, tap A to place · tap a fence to remove",
      move: "📦 Moving: face the new spot, tap A to place",
    };
    DH.toast(tips[kind], 3200);
  }
  function cancelMode() {
    mode = { pid: 0, kind: null, ref: null };
    showCancel(false);
    DH.toast("Done 👍");
  }
  // tile the player faces (for pave/fence/move targeting)
  function facingTile(p) {
    const d = DIRV[p.dir] || DIRV.down;
    return { tx: Math.floor((p.x + d[0] * 24) / T), ty: Math.floor((p.y + d[1] * 24) / T), dir: p.dir || "down" };
  }

  // ---------- menus ----------
  function openFundMenu() {
    const items = projectList().map(pr => ({
      ico: pr.ico, cost: S.built[pr.id] ? null : Math.max(0, pr.cost - (S.raised[pr.id] || 0)),
      disabled: !!S.built[pr.id] || (S.funded[pr.id] && !S.built[pr.id]),
      label: `${pr.name} — ${S.built[pr.id] ? "open! 🎉" : S.funded[pr.id] ? "opens tomorrow 🏗️" : `${S.raised[pr.id] || 0}/${pr.cost}🪙`}`,
      cb: () => openDonateMenu(pr),
    }));
    items.push({ ico: "🏗️", label: "Public works (bench, lamps, fountain…)", cb: () => openWorksMenu() });
    DH.menu.open("🌉 Bridge fund", items);
  }
  function openDonateMenu(pr) {
    const left = Math.max(0, pr.cost - (S.raised[pr.id] || 0));
    DH.menu.open(`${pr.ico} ${pr.name}`, DONATE_AMTS.map(amt => ({
      ico: "💰", label: `Donate ${amt}🪙`, cost: amt,
      disabled: gs.coins < amt || left <= 0,
      cb: () => act("donate", pr.id, amt),
    })).concat([{
      ico: "💸", label: `Fund the rest (${left}🪙)`,
      cost: left,
      disabled: gs.coins < left || left <= 0,
      cb: () => act("donate", pr.id, left),
    }]));
  }
  function openWorksMenu() {
    DH.menu.open("🏗️ Public works", worksList().map(w => ({
      ico: w.ico, cost: S.built[w.id] ? null : Math.max(0, w.cost - (S.raised[w.id] || 0)),
      disabled: !!S.built[w.id] || (S.funded[w.id] && !S.built[w.id]),
      label: `${w.name} — ${S.built[w.id] ? "built 🎉" : S.funded[w.id] ? "opens tomorrow 🏗️" : `${S.raised[w.id] || 0}/${w.cost}🪙`}`,
      cb: () => openDonateMenu(w),
    })));
  }
  function openBoardMenu(p) {
    DH.menu.open("🏛️ Town board", [
      { ico: "🏗️", label: "Public works fund", cb: () => openWorksMenu() },
      { ico: "⭐", label: "Check island rating", cb: () => openRating() },
      { ico: "📜", label: `Ordinances (${S.ordinance || "none"})`, cb: () => openOrdinances() },
      { ico: "📦", label: "Move something", cb: () => openMovePicker(p) },
      { ico: "⬜", label: `Pave paths (${S.paved.length}/${PATH_CAP})`, cb: () => startMode("pave", null, p) },
      { ico: "🚧", label: `Fences ×${DH.inv.count("fence")} · buy 🪙${FENCE_COST}`, cb: () => openFenceMenu(p) },
    ]);
  }
  function openFenceMenu(p) {
    DH.menu.open("🚧 Fences", [
      { ico: "🚧", label: `Buy a fence · 🪙${FENCE_COST}`, cost: FENCE_COST, disabled: gs.coins < FENCE_COST, cb: () => act("buyFence") },
      { ico: "📍", label: `Place fences (${S.fences.length}/${FENCE_CAP} used)`, disabled: DH.inv.count("fence") <= 0 && !S.fences.length, cb: () => startMode("fence", null, p) },
    ]);
  }
  function openMovePicker(p) {
    const list = movableList();
    if (!list.length) {
      DH.menu.open("📦 Move something", [{ ico: "🌳", label: "Nothing movable — plant flowers or place furniture outside (trees need ⚡)", disabled: true, cb: () => {} }]);
      return;
    }
    DH.menu.open("📦 Move what?", list.map(m => ({
      ico: m.ico, label: m.label, cb: () => startMode("move", m, p),
    })));
  }
  function openRating() {
    const r = rating();
    const stars = "★★★★★".slice(0, r.stars) + "☆☆☆☆☆".slice(0, 5 - r.stars);
    DH.menu.open(`⭐ Island rating: ${stars}`, r.hints.map(h => ({
      ico: h.includes("✨") ? "✨" : "💡", label: h, cb: () => {},
    })).concat([{ ico: "🔄", label: "Rate again later", cb: () => {} }]));
    alog("island-rating", r.stars);
    if (r.stars >= 5 && !S.goldenRose) {
      S.goldenRose = true;
      const got = DH.inv.add("golden-rose", 1);
      confetti(BOARD.tx * T + 16, BOARD.ty * T, 24);
      gs.happiness += 10;
      DH.toast(got
        ? "🌟 A 5-STAR ISLAND! A golden rose was delivered to your pockets 🌹"
        : "🌟 5-STAR ISLAND! (pockets full — golden rose +🪙1000)", 4200);
      if (!got) gs.coins += 1000;
      if (DH.save) DH.save.now();
    }
  }
  function openOrdinances() {
    DH.menu.open("📜 Ordinances", ORDINANCES.map(o => ({
      ico: o.ico,
      label: `${o.name} — ${o.desc}${S.ordinance === o.id ? " · active" : ""}`,
      disabled: S.ordinance === o.id,
      cb: () => act("setOrdinance", o.id),
    })).concat([{ ico: "✖", label: "Repeal current ordinance", disabled: !S.ordinance, cb: () => act("setOrdinance", null) }]));
  }

  // ---------- mutations + guest routing (like tools.js: "island.<fn>") ----------
  const API = {
    donate: (id, amt) => donate(id, amt),
    paveToggle: (tx, ty) => paveToggle(tx, ty),
    buyFence: () => buyFence(),
    placeFence: (tx, ty, dir) => placeFence(tx, ty, dir),
    removeFence: i => removeFence(i),
    moveItem: (kind, ref, tx, ty) => moveApply({ kind, ...(ref || {}) }, tx, ty),
    setOrdinance: id => setOrdinance(id),
  };
  const isGuest = () => !!(DH.net && DH.net.online && DH.net.role === "guest");
  // host/solo runs the mutation now; a remote guest asks the host instead
  function act(name, ...args) {
    if (isGuest()) { DH.net.guestAction("island." + name, args); return undefined; }
    const fn = API[name];
    return typeof fn === "function" ? fn(...args) : false;
  }

  // ---------- drawing ----------
  function drawPaved(ctx, px, py) {
    ctx.fillStyle = "#c9b797"; ctx.fillRect(px + 1, py + 1, T - 2, T - 2);
    ctx.fillStyle = "#b3a180";
    ctx.fillRect(px + 5, py + 7, 4, 2); ctx.fillRect(px + 19, py + 21, 4, 2);
    ctx.fillStyle = "#d8c8a8"; ctx.fillRect(px + 13, py + 13, 3, 2); ctx.fillRect(px + 7, py + 25, 3, 2);
    ctx.strokeStyle = "#ab9873"; ctx.lineWidth = 1;
    ctx.strokeRect(px + 1.5, py + 1.5, T - 3, T - 3);
  }
  function drawBridgeTile(ctx, px, py) {
    ctx.fillStyle = "#a0743f"; ctx.fillRect(px, py + 4, T, T - 8);       // deck over water
    ctx.fillStyle = "#8a5f30";
    for (let i = 0; i < 4; i++) ctx.fillRect(px + i * 8 + 2, py + 4, 1, T - 8); // plank seams
    ctx.fillStyle = "#6e4a2a";
    ctx.fillRect(px, py + 4, T, 2); ctx.fillRect(px, py + T - 6, T, 2);   // rails
    ctx.fillStyle = "#c08a52"; ctx.fillRect(px + 2, py + 2, 3, 4); ctx.fillRect(px + T - 5, py + 2, 3, 4); // posts
  }
  function drawDeckTile(ctx, px, py) {
    ctx.fillStyle = "#8a5f30"; ctx.fillRect(px, py, T, T);
    ctx.fillStyle = "#a0743f";
    for (let i = 0; i < 4; i++) ctx.fillRect(px, py + i * 8 + 2, T, 5);   // planks
    ctx.fillStyle = "#6e4a2a"; ctx.fillRect(px, py + T - 2, T, 2);
  }
  function drawSign(ctx, x, y, ico) {
    ctx.fillStyle = "#6e4a2a"; ctx.fillRect(x - 2, y - 12, 4, 14);
    ctx.fillStyle = "#a0733f"; ctx.fillRect(x - 12, y - 26, 24, 15);
    ctx.fillStyle = "#c09055"; ctx.fillRect(x - 12, y - 26, 24, 2);
    ctx.fillStyle = "#7a5527"; ctx.fillRect(x - 12, y - 13, 24, 2);
    ctx.font = "10px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(ico, x, y - 19);
  }
  function drawFencePiece(ctx, f, camX, camY) {
    // a short fence on the edge between (tx,ty) and the neighbor in dir
    const cx = f.tx * T + 16 - camX, cy = f.ty * T + 16 - camY;
    ctx.save();
    ctx.translate(cx, cy);
    const rot = { up: 0, down: 0, left: 1, right: 1 }[f.dir] || 0;
    ctx.translate((DIRV[f.dir][0] * T) / 2, (DIRV[f.dir][1] * T) / 2);
    if (rot) ctx.rotate(Math.PI / 2);
    ctx.fillStyle = "#8a6438";
    ctx.fillRect(-13, -3, 26, 3); ctx.fillRect(-13, 4, 26, 3);   // rails
    ctx.fillStyle = "#7a5328"; ctx.fillRect(-3, -6, 6, 16);      // post
    ctx.fillStyle = "#96693a"; ctx.fillRect(-4, -8, 8, 4);       // cap
    ctx.restore();
  }
  function drawWork(ctx, id, w, camX, camY, now) {
    const [tx, ty] = w.tiles[0];
    const px = tx * T - camX, py = ty * T - camY;
    switch (id) {
      case "bench":
        ctx.fillStyle = "#8a5a3b"; ctx.fillRect(px + 4, py + 14, 24, 4);
        ctx.fillStyle = "#a06a42"; ctx.fillRect(px + 4, py + 8, 24, 5);
        ctx.fillStyle = "#6f4327"; ctx.fillRect(px + 6, py + 18, 3, 8); ctx.fillRect(px + 23, py + 18, 3, 8);
        break;
      case "lamp1": case "lamp2": {
        const lit = isNight();
        ctx.fillStyle = "#3a3a44"; ctx.fillRect(px + 14, py + 6, 4, 22);
        ctx.fillStyle = "#2a2a33"; ctx.fillRect(px + 10, py + 26, 12, 3);
        ctx.fillStyle = lit ? "#ffd76b" : "#b8a88a"; ctx.fillRect(px + 11, py + 2, 10, 6);
        if (lit) { ctx.fillStyle = "#ffe58a55"; ctx.beginPath(); ctx.arc(px + 16, py + 5, 10, 0, 7); ctx.fill(); }
        break;
      }
      case "fountain": {
        ctx.fillStyle = "#9aa5b3"; ctx.fillRect(px + 2, py + 14, 28, 12);
        ctx.fillStyle = "#7ec8e3"; ctx.fillRect(px + 4, py + 16, 24, 8);
        ctx.fillStyle = "#cfd8e3"; ctx.fillRect(px + 12, py + 4, 8, 12);
        const drip = (now / 300) % 6;
        ctx.fillStyle = "#bfeaff"; ctx.fillRect(px + 15, py + 8 + drip, 2, 3); ctx.fillRect(px + 17, py + 6 + ((drip + 3) % 6), 2, 3);
        break;
      }
      case "windmill": {
        ctx.fillStyle = "#8a5a3b"; ctx.fillRect(px + 8, py + 6, 16, 24);   // tower
        ctx.fillStyle = "#6f4327"; ctx.fillRect(px + 8, py + 6, 16, 3);
        ctx.fillStyle = "#d9cbb8"; ctx.fillRect(px + 13, py - 14, 6, 20);  // mast
        ctx.save();
        ctx.translate(px + 16, py - 12);
        ctx.rotate(now / 1400);
        ctx.fillStyle = "#f0eee4";
        for (let i = 0; i < 4; i++) { ctx.rotate(Math.PI / 2); ctx.fillRect(0, -3, 16, 6); }
        ctx.restore();
        ctx.fillStyle = "#b4552f"; ctx.fillRect(px + 10, py + 2, 12, 4);   // cap
        break;
      }
    }
  }

  // ---------- module ----------
  const M = (DH.island = {
    authority: true,
    _state: S,

    init(state) {
      gs = state;
      C = document.getElementById("cv").getContext("2d");
      M.authority = !(DH.net && DH.net.online && DH.net.role === "guest");
      const W = DH.world;
      if (!W._islandPatched) {
        W._islandPatched = true;
        const s0 = W.isSolid.bind(W);
        const br = bridgeSet();
        W.isSolid = (tx, ty) =>
          (S.built.bridge && br.has(tx + "," + ty)) ? false : s0(tx, ty);
      }
      window.addEventListener("keydown", e => {
        if (e.code === "Escape" && mode.kind) {
          cancelMode();
          if (state.paused) { state.paused = false; document.getElementById("pauseScreen").classList.add("hidden"); }
        }
      });
    },

    start(state) {
      gs = state;
      M.authority = !(DH.net && DH.net.online && DH.net.role === "guest");
      rebuildBlocked();
      saveT = 0;
    },

    update(dt, state) {
      gs = state;
      if (!M.authority) return;
      saveT += dt;
      if (saveT >= 5) { saveT = 0; if (DH.save) DH.save.now(); }
      checkBuilds();
      ordinanceBonus();
      if (S.ordinance === "green-thumb") applyGreenThumb();
    },

    interactables(p) {
      if (!gs || !gs.running) return [];
      const out = [];
      const near = (x, y, r) => dist2(p.x, p.y, x, y) < r * r;

      // active placement modes route the A press
      if (mode.kind && p.pid === mode.pid) {
        const f = facingTile(p);
        const cx = f.tx * T + 16, cy = f.ty * T + 16;
        if (mode.kind === "pave") {
          const on = S.paved.includes(f.tx + "," + f.ty);
          out.push({ label: on ? "Remove paving ⬜" : "Pave here ⬜", x: cx, y: cy, action: () => act("paveToggle", f.tx, f.ty) });
        } else if (mode.kind === "fence") {
          const fi = fenceAt(f.tx, f.ty, f.dir);
          out.push({ label: "Place fence here 🚧", x: cx, y: cy, action: () => act("placeFence", f.tx, f.ty, f.dir) });
          if (fi >= 0) out.push({ label: "Remove fence 🚧", x: cx, y: cy, action: () => act("removeFence", fi) });
        } else if (mode.kind === "move") {
          out.push({
            label: freeYardTile(f.tx, f.ty, mode.ref) ? "Place here 📦" : "Can't place here ☹️",
            x: cx, y: cy,
            action: () => { if (act("moveItem", mode.ref.kind, mode.ref, f.tx, f.ty)) cancelMode(); },
          });
        }
        out.push({ label: "Stop ✖", x: p.x, y: p.y, action: () => cancelMode() });
        return out;
      }

      // standing next to a fence piece -> quick remove
      for (let i = 0; i < S.fences.length; i++) {
        const f = S.fences[i];
        const cx = f.tx * T + 16 + (DIRV[f.dir][0] * T) / 2, cy = f.ty * T + 16 + (DIRV[f.dir][1] * T) / 2;
        if (near(cx, cy, 30)) out.push({ label: "Fence 🚧", x: cx, y: cy, action: () => act("removeFence", i) });
      }

      const fx0 = FUND_SIGN.tx * T + 16, fy0 = FUND_SIGN.ty * T + 16;
      if (near(fx0, fy0, FUND_SIGN.r)) out.push({ label: "Bridge fund 🌉", x: fx0, y: fy0, action: openFundMenu });
      const bx = BOARD.tx * T + 16, by = BOARD.ty * T + 16;
      if (near(bx, by, BOARD.r)) out.push({ label: "Town board 🏛️", x: bx, y: by, action: () => openBoardMenu(p) });

      out.sort((a, b) => dist2(p.x, p.y, a.x, a.y) - dist2(p.x, p.y, b.x, b.y));
      return out;
    },

    drawGround(ctx, camX, camY) {
      for (const k of S.paved) {
        const [tx, ty] = k.split(",").map(Number);
        drawPaved(ctx, tx * T - camX, ty * T - camY);
      }
      if (S.built.bridge)
        for (const [tx, ty] of BRIDGE_TILES) drawBridgeTile(ctx, tx * T - camX, ty * T - camY);
      if (S.built.stairs)
        for (const [tx, ty] of DECK_TILES) drawDeckTile(ctx, tx * T - camX, ty * T - camY);
    },

    collectDraws(draws, camX, camY) {
      if (!C) C = document.getElementById("cv").getContext("2d");
      const now = Date.now();
      draws.push({ y: FUND_SIGN.ty * T + T, fn: () => drawSign(C, FUND_SIGN.tx * T + 16 - camX, FUND_SIGN.ty * T + T - camY, "🌉") });
      draws.push({ y: BOARD.ty * T + T, fn: () => drawSign(C, BOARD.tx * T + 16 - camX, BOARD.ty * T + T - camY, "🏛️") });
      for (const f of S.fences)
        draws.push({ y: f.ty * T + T, fn: () => drawFencePiece(C, f, camX, camY) });
      for (const id in WORKS)
        if (S.built[id]) {
          const [tx, ty] = WORKS[id].tiles[0];
          draws.push({ y: ty * T + T, fn: () => drawWork(C, id, WORKS[id], camX, camY, now) });
        }
    },

    drawOverlay(ctx, camX, camY, state) {
      // FX tick here (not update) so guests animate too
      const now = performance.now();
      const dt = Math.min(0.06, ((now - (M._fxT || now)) / 1000) || 0.016);
      M._fxT = now;
      for (let i = S.fx.length - 1; i >= 0; i--) {
        const f = S.fx[i];
        f.age += dt; f.x += (f.vx || 0) * dt; f.y += (f.vy || 0) * dt; f.vy += 60 * dt; // confetti falls
        if (f.age >= f.ttl) { S.fx[i] = S.fx[S.fx.length - 1]; S.fx.pop(); continue; }
        const a = Math.max(0, 1 - f.age / f.ttl);
        ctx.globalAlpha = a;
        if (f.k === "conf") { ctx.fillStyle = f.c || "#ffd76b"; ctx.fillRect(f.x - camX, f.y - camY, f.sz || 3, f.sz || 3); }
        else if (f.k === "poof") { ctx.fillStyle = "#cfd8e3"; ctx.beginPath(); ctx.arc(f.x - camX, f.y - camY, f.sz || 4, 0, 7); ctx.fill(); }
        else { ctx.fillStyle = "#ffd76b"; ctx.font = "bold 10px sans-serif"; ctx.textAlign = "center"; ctx.fillText("★", f.x - camX, f.y - camY); }
        ctx.globalAlpha = 1;
      }
      // lamp glow pass at night (drawn over the day-tint like world.drawLights)
      if (isNight()) {
        for (const id of ["lamp1", "lamp2"]) {
          if (!S.built[id]) continue;
          const [tx, ty] = WORKS[id].tiles[0];
          const cx = tx * T + 16 - camX, cy = ty * T + 5 - camY;
          const g = ctx.createRadialGradient(cx, cy, 3, cx, cy, 30);
          g.addColorStop(0, "rgba(255,205,110,0.55)");
          g.addColorStop(1, "rgba(255,205,110,0)");
          ctx.fillStyle = g; ctx.fillRect(cx - 30, cy - 30, 60, 60);
        }
      }
      if (!gs || !gs.running) return;
      // placement-mode ghost highlight
      if (mode.kind && state && state.players[mode.pid]) {
        const p = state.players[mode.pid];
        const f = facingTile(p);
        const gx = f.tx * T - camX, gy = f.ty * T - camY;
        let ok = true;
        if (mode.kind === "pave") ok = true;
        else if (mode.kind === "fence") ok = DH.world.zone(f.tx, f.ty) === "yard";
        else if (mode.kind === "move") ok = freeYardTile(f.tx, f.ty, mode.ref);
        ctx.save();
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = ok ? "#3dff7a" : "#ff4d4d";
        ctx.fillRect(gx, gy, T, T);
        ctx.globalAlpha = 0.8;
        ctx.strokeStyle = ok ? "#3dff7a" : "#ff4d4d"; ctx.lineWidth = 2;
        ctx.strokeRect(gx + 1, gy + 1, T - 2, T - 2);
        ctx.restore();
      }
    },

    // ----- sync boundary -----
    serialize() {
      return JSON.parse(JSON.stringify({
        raised: S.raised, funded: S.funded, built: S.built, buildDay: S.buildDay,
        paved: S.paved, fences: S.fences, ordinance: S.ordinance,
        goldenRose: S.goldenRose, ordDay: S.ordDay, fx: S.fx,
      }));
    },
    deserialize(d) {
      if (!d) return;
      if (d.raised) S.raised = d.raised;
      if (d.funded) S.funded = d.funded;
      if (d.built) S.built = d.built;
      if (d.buildDay) S.buildDay = d.buildDay;
      if (Array.isArray(d.paved)) S.paved = d.paved;
      if (Array.isArray(d.fences)) S.fences = d.fences;
      if (d.ordinance !== undefined) S.ordinance = d.ordinance;
      if (d.goldenRose != null) S.goldenRose = !!d.goldenRose;
      if (typeof d.ordDay === "number") S.ordDay = d.ordDay;
      if (Array.isArray(d.fx)) S.fx = d.fx;
      rebuildBlocked();
    },
    remoteAction(name, args) {
      if (typeof name === "string" && name.startsWith("island.")) {
        const fn = API[name.slice(7)];
        if (typeof fn === "function") return fn.apply(null, args || []);
      }
      return false;
    },
    offline(offMin) {
      const parts = [];
      const offG = Math.min(offMin, 12 * 60) * 4; // real min -> game min
      const d = Math.floor((gs && gs.day || 0) + offG / GDAY);
      let built = 0;
      for (const id in S.funded)
        if (S.funded[id] && !S.built[id] && S.buildDay[id] <= d) { S.built[id] = true; built++; }
      if (built) { rebuildBlocked(); parts.push(built === 1 ? "a public work opened 🏗️" : `${built} public works opened 🏗️`); }
      return parts;
    },

    // public API for other modules / tests
    donate, paveToggle, buyFence, placeFence, removeFence, setOrdinance, rating,
    movableList, moveApply, openRating,
    get ordinance() { return S.ordinance; },
    isOrdinance(id) { return S.ordinance === id; },
    get sellPriceMult() { return S.ordinance === "bells-up" ? 1.1 : 1; },
    // minutes to shift shop/event times by (early-bird opens earlier, night-owl later)
    get timeShiftMin() { return S.ordinance === "early-bird" ? -120 : S.ordinance === "night-owl" ? 120 : 0; },
    get flowersNeverWilt() { return S.ordinance === "green-thumb"; },
  });
})();

DH.register("island", DH.island);
