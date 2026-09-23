/* dream-home forage module — Animal Crossing field work.
   Spec IDs: B-1 shake trees, B-2 fruit planting, B-3 rocks, B-8 wood chopping,
   B-9 weeds, B-12 glowing spot / money tree, B-13 flowers + hybrids.

   Contract with game.js (same as garden.js / animals.js):
     DH.forage.init(state)          – once at load
     DH.forage.start(state)         – on each run (seeds fixtures if no save)
     DH.forage.update(dt, state)    – per frame (host sim only; guests never call it)
     DH.forage.drawGround(...)      – flat layer (weeds, flowers, glow spot)
     DH.forage.collectDraws(draws, camX, camY) – {y,fn} depth-sorted (trees, rocks)
     DH.forage.drawOverlay(...)     – FX, thirst/harvest markers, bee swarms
     DH.forage.interactables(p)     – -> [{label,x,y,action}] for the action key
     DH.forage.serialize()/deserialize(data)   – plain-JSON save + net snapshots
     DH.forage.remoteAction(name, args)        – remote-callable mutations
     DH.forage.offline(offMin)      – overnight progress for the away report
     DH.forage.stumps()             – -> [{x,y}] stump pixels for critters.js

   Clocks: state.timeMin/game-day drives tree growth, shake cooldowns, rock
   hits and flower mornings. The real calendar day (Date) picks the daily
   money rock + glowing spot, so they reset at real midnight like AC.
   Tools are an optional dependency: a shovel only sweetens rock odds —
   every action works bare-handed.
*/
(function () {
  const DH = (window.DH = window.DH || {});
  const T = 32, GDAY = 24 * 60;                 // game-minutes per day
  const REALDAY = () => Math.floor(Date.now() / 864e5);
  const today = () => Math.floor((gs && gs.day) || 0);

  // ---------- tuning ----------
  const INTERACT_R = 46;
  const YOUNG_AT = 1 * GDAY, MATURE_AT = 3 * GDAY;  // sapling -> young -> mature
  const CHOP_HITS = 3, STUMP_SPAN = GDAY;           // hits to fell; stump lasts 1 day
  const CHOP_CD = 0.45;                             // seconds between axe swings
  const ROCK_HITS_MAX = 3;
  const MONEY_PAYOUT = [100, 200, 300, 400, 500];   // per-hit escalating bells
  const WEED_CAP = 12, WEED_EVERY = 20, WEED_GLOOM = 9;
  const STING_T = 1.6, STING_DRAG = 0.45;           // bee sting: % of move kept
  const STAMINA_CAP = 5;
  const FLOWER_COST = 8, HYBRID_P = 0.4;
  const OFFLINE_CAP = 12 * 60;                      // real minutes of offline sim

  // ---------- item defs (registered at file eval; idempotent) ----------
  const SPECIES = {
    rose:  { ico: "🌹", hybrids: { "red+white": "pink", "red+yellow": "orange", "white+yellow": "purple" } },
    tulip: { ico: "🌷", hybrids: { "red+white": "pink", "red+yellow": "orange", "white+yellow": "black" } },
    pansy: { ico: "🌼", hybrids: { "red+yellow": "orange", "red+white": "pink", "white+yellow": "blue" } },
  };
  const BASE_COLORS = ["red", "white", "yellow"];
  const FLOWER_HEX = {
    red: "#e04848", white: "#f5f2e8", yellow: "#ffd94d", pink: "#ff9ec4",
    orange: "#f6a13c", purple: "#c58bff", black: "#4a4a55", blue: "#6ba3e8",
  };
  const cap = s => s[0].toUpperCase() + s.slice(1);
  const flowerName = (sp, col) => `${cap(col)} ${sp}`;
  const flowerId = (sp, col) => `${sp}-${col}`;
  for (const sp of Object.keys(SPECIES)) {
    for (const col of Object.keys(FLOWER_HEX)) {
      const hybrid = !BASE_COLORS.includes(col);
      if (hybrid && !Object.values(SPECIES[sp].hybrids).includes(col)) continue;
      DH.items.def(flowerId(sp, col), {
        name: flowerName(sp, col), ico: SPECIES[sp].ico,
        cat: "flower", price: hybrid ? 120 : 40, stack: 10,
      });
    }
  }
  DH.items.def("furni-leaf", { name: "Furniture leaf", ico: "🍃", cat: "furniture", price: 80 });

  // ---------- world fixtures ----------
  const BASE_TREES = [
    { tx: 1, ty: 2 }, { tx: 1, ty: 7 }, { tx: 16, ty: 2 }, { tx: 16, ty: 8 },
    { tx: 25, ty: 1 }, { tx: 28, ty: 10 }, { tx: 18, ty: 18 }, { tx: 24, ty: 18 },
  ];
  const BASE_ROCKS = [{ tx: 1, ty: 11 }, { tx: 16, ty: 1 }, { tx: 18, ty: 17 }, { tx: 28, ty: 12 }];
  // tiles forage never builds on: mailbox, flowerbed row, family board, crate,
  // bench, pasture gate approach, door mat
  const FORBID_TILES = new Set([
    "10,11", "11,11", "12,11", "13,11", "14,11", "21,15", "16,5", "5,10", "5,11", "9,10",
  ]);
  const FORBID_RECTS = [[11, 12, 17, 16], [19, 13, 21, 17]]; // court, sauna + tub
  const inRect = (tx, ty, r) => tx >= r[0] && tx <= r[2] && ty >= r[1] && ty <= r[3];
  const forbidden = (tx, ty) =>
    FORBID_TILES.has(tx + "," + ty) || FORBID_RECTS.some(r => inRect(tx, ty, r));

  // ---------- state (plain JSON only — it is the save + sync payload) ----------
  let gs = null, C = null;
  const S = {
    trees: [], rocks: [], weeds: [], flowers: [],
    glow: null,           // {day,tx,ty,used}
    moneyDay: -1, moneyIdx: 0,
    stamina: 0,
    sting: [{ t: 0, px: 0, py: 0 }, { t: 0, px: 0, py: 0 }],
    fx: [],               // {k,x,y,vx,vy,age,ttl,sz,pid,a}
    seeded: false, weedAcc: 8, lastDay: -1, now: 0, toastCD: 0,
  };
  let lastT = null;

  const rnd = (a, b) => a + Math.random() * (b - a);
  const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
  const mature = t => t.age >= MATURE_AT;
  const alog = d => { if (DH.alog) DH.alog.add("forage", d); };

  // ---------- fx ----------
  function fx(k, x, y, o) { if (S.fx.length < 80) S.fx.push(Object.assign({ k, x, y, vx: 0, vy: 0, age: 0, ttl: 1 }, o)); }
  const leafBurst = (x, y, n = 6) => { for (let i = 0; i < n; i++) fx("leaf", x + rnd(-14, 14), y + rnd(-8, 4), { vx: rnd(-18, 18), vy: rnd(-14, 30), ttl: rnd(0.6, 1.1), sz: rnd(2, 3.5) }); };
  const sparks = (x, y, n = 5) => { for (let i = 0; i < n; i++) fx("spark", x + rnd(-12, 12), y - rnd(2, 20), { vy: -8, ttl: rnd(0.5, 0.9), sz: rnd(2, 4) }); };
  const coinFx = (x, y) => fx("coin", x, y - 18, { vy: -26, ttl: 0.8, sz: 4 });
  const poof = (x, y) => { for (let i = 0; i < 4; i++) fx("poof", x + rnd(-8, 8), y + rnd(-8, 0), { vy: -12, ttl: 0.5, sz: rnd(3, 5) }); };
  function beeSwarm(pid) {
    const p = gs.players[pid];
    if (!p) return;
    const st = S.sting[pid];
    st.t = STING_T; st.px = p.x; st.py = p.y;
    for (let i = 0; i < 6; i++) fx("bee", p.x, p.y - 24, { pid, a: i / 6 * Math.PI * 2, r: rnd(10, 16), ttl: STING_T + rnd(0, 0.8) });
    DH.toast("🐝 A beehive! You got stung ☹️", 2600);
    alog("bee-sting");
  }

  // ---------- occupancy ----------
  const treeAt = (tx, ty) => S.trees.find(t => t.tx === tx && t.ty === ty) || null;
  const rockAt = (tx, ty) => S.rocks.findIndex(r => r.tx === tx && r.ty === ty);
  const weedAt = (tx, ty) => S.weeds.findIndex(w => w.tx === tx && w.ty === ty);
  const flowerAt = (tx, ty) => S.flowers.findIndex(f => f.tx === tx && f.ty === ty);
  const occupied = (tx, ty) =>
    treeAt(tx, ty) || rockAt(tx, ty) >= 0 || weedAt(tx, ty) >= 0 || flowerAt(tx, ty) >= 0 ||
    (S.glow && !S.glow.used && S.glow.tx === tx && S.glow.ty === ty);
  // a tile anything may be built/grown on
  function freeGrass(tx, ty) {
    const W = DH.world;
    return W.tileAt(tx, ty) === W.GRASS && W.zone(tx, ty) === "yard" &&
      !W.isBlocked(tx, ty) && !forbidden(tx, ty) && !occupied(tx, ty);
  }
  // where weeds/glow may spawn: freeGrass but weeds also count as tiles to keep sparse
  const weedOK = (tx, ty) => freeGrass(tx, ty);
  function randomFreeTile() {
    const tries = [];
    for (let i = 0; i < 60; i++) {
      const tx = 1 + Math.floor(Math.random() * (DH.world.W - 2));
      const ty = 1 + Math.floor(Math.random() * (DH.world.H - 2));
      if (weedOK(tx, ty)) tries.push({ tx, ty });
    }
    return tries.length ? tries[Math.floor(Math.random() * tries.length)] : null;
  }
  function reconcileBlocked() {
    for (const t of S.trees) {
      const k = t.tx + "," + t.ty;
      if (t.stump >= 0) DH.world.blocked.delete(k);
      else DH.world.blocked.add(k);
    }
  }

  // ---------- daily rolls ----------
  function dailyCheck() {
    const rd = REALDAY();
    if (S.moneyDay !== rd) {
      S.moneyDay = rd;
      S.moneyIdx = S.rocks.length ? Math.floor(Math.random() * S.rocks.length) : 0;
    }
    for (const r of S.rocks)
      if (r.day !== rd) { r.day = rd; r.hits = 0; r.max = 1 + Math.floor(Math.random() * ROCK_HITS_MAX); }
    if (!S.glow || S.glow.day !== rd) {
      const t = randomFreeTile();
      S.glow = t ? { day: rd, tx: t.tx, ty: t.ty, used: 0 } : { day: rd, tx: -1, ty: -1, used: 1 };
    }
  }
  // glow stays interactive until dug/buried or its tile is taken over
  function glowClear() {
    const g = S.glow, W = DH.world;
    if (!g || g.used) return false;
    return W.tileAt(g.tx, g.ty) === W.GRASS && W.zone(g.tx, g.ty) === "yard" &&
      !W.isBlocked(g.tx, g.ty) && !forbidden(g.tx, g.ty) &&
      !treeAt(g.tx, g.ty) && rockAt(g.tx, g.ty) < 0 &&
      flowerAt(g.tx, g.ty) < 0 && weedAt(g.tx, g.ty) < 0;
  }

  // game-morning: new floor(gs.day) — thirst, blooms, hybrids, fresh fruit
  function morningTick(gd, report) {
    for (const f of S.flowers) if (!f.bloomed && gd - f.plantDay >= 1) f.bloomed = true;
    const n = hybridRoll();
    for (const f of S.flowers) { f.thirsty = true; f.watered = false; }
    for (const t of S.trees) if (t.stump < 0 && mature(t)) t.fruitReady = true;
    if (report && n > 0) report.push(`${n} hybrid flower${n > 1 ? "s" : ""} bloomed overnight`);
    if (!report && n > 0) DH.toast("✨ A hybrid flower appeared!", 2600);
    return n;
  }
  // watered adjacent same-species different-color pairs -> spawn hybrid neighbor
  function hybridRoll() {
    let n = 0;
    const done = new Set();
    for (let i = 0; i < S.flowers.length; i++) {
      const a = S.flowers[i];
      if (!a.watered || !a.bloomed) continue;
      for (let j = i + 1; j < S.flowers.length; j++) {
        const b = S.flowers[j];
        if (!b.watered || !b.bloomed || b.sp !== a.sp || b.col === a.col) continue;
        if (Math.abs(a.tx - b.tx) + Math.abs(a.ty - b.ty) !== 1) continue;
        const pairKey = i + ":" + j;
        if (done.has(pairKey) || Math.random() >= HYBRID_P) continue;
        done.add(pairKey);
        const cols = [a.col, b.col].sort();
        const key = cols[0] === cols[1] ? cols[0] + "+" + cols[1] : null;
        const hybrid = SPECIES[a.sp].hybrids[[a.col, b.col].join("+")] ||
          SPECIES[a.sp].hybrids[[b.col, a.col].join("+")] ||
          (key && SPECIES[a.sp].hybrids[key]);
        if (!hybrid) continue;
        const spot = [[a.tx, a.ty], [b.tx, b.ty]]
          .flatMap(([x, y]) => [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]])
          .find(([x, y]) => freeGrass(x, y));
        if (!spot) continue;
        S.flowers.push({
          tx: spot[0], ty: spot[1], sp: a.sp, col: hybrid,
          plantDay: today(), bloomed: true, thirsty: true, watered: false,
        });
        n++;
        alog("hybrid-" + flowerId(a.sp, hybrid));
      }
    }
    return n;
  }

  // ---------- actions (named + remote-callable) ----------
  const API = {
    shakeTree(tx, ty) {
      const t = treeAt(tx, ty);
      if (!t || t.stump >= 0 || !mature(t) || t.shakeDay === today()) return false;
      t.shakeDay = today();
      const cx = t.tx * T + 16, cy = t.ty * T + 20;
      leafBurst(cx, cy + 6, 8);
      if (t.kind === "money" && t.fruitReady) {
        t.fruitReady = false; t.kind = "apple";     // yields once, then a normal tree
        gs.coins += 300;
        coinFx(cx, cy); sparks(cx, cy, 7);
        DH.toast("💰💰💰 Bell bags! +300🪙");
        alog("money-shake");
        return true;
      }
      const roll = Math.random();
      if (roll < 0.06) {
        t.fruitReady = false;
        beeSwarm(nearestPid(cx, cy));
      } else if (roll < 0.14) {
        if (DH.inv.add("furni-leaf") > 0) DH.toast("🍃 A furniture leaf fell into your pocket!");
        else DH.toast("Pockets full! 🍃");
        sparks(cx, cy - 8, 4);
      } else if (roll < 0.30) {
        gs.coins += 100; coinFx(cx, cy);
        DH.toast("💰 A bell bag fell out! +100🪙");
      } else if (t.fruitReady) {
        const want = 1 + (Math.random() < 0.5 ? 1 : 0);
        const got = DH.inv.add("apple", want);
        DH.toast(got ? `🍎 ${got} apple${got > 1 ? "s" : ""} fell!` : "Pockets full! 🍎");
        leafBurst(cx, cy + 10, 4);
      } else {
        DH.toast("Just leaves today 🍃");
      }
      t.fruitReady = false;
      alog("shake");
      return true;
    },

    chopTree(tx, ty) {
      const t = treeAt(tx, ty);
      if (!t || t.stump >= 0 || !mature(t) || (t.cd || 0) > S.now) return false;
      t.cd = S.now + CHOP_CD;
      t.chop = (t.chop || 0) + 1;
      const roll = Math.random();
      const mat = roll < 0.45 ? "wood" : roll < 0.8 ? "softwood" : "hardwood";
      const got = DH.inv.add(mat, 1);
      const cx = t.tx * T + 16, cy = t.ty * T + 22;
      leafBurst(cx, cy - 4, 4); sparks(cx, cy, 3);
      if (t.chop >= CHOP_HITS) {
        t.stump = 0; t.chop = 0; t.fruitReady = false;
        DH.world.blocked.delete(tx + "," + ty);
        poof(cx, cy);
        DH.toast("Timber! 🪵 A stump remains");
      } else {
        DH.toast(got ? `${DH.items.label(mat)} +1 (${t.chop}/${CHOP_HITS})` : "Pockets full! 🪵");
      }
      alog("chop");
      return true;
    },

    digUp(tx, ty) {
      const i = S.trees.findIndex(t => t.tx === tx && t.ty === ty);
      if (i < 0 || S.stamina <= 0) return false;
      const t = S.trees[i];
      S.trees.splice(i, 1);
      S.stamina--;
      DH.world.blocked.delete(tx + "," + ty);
      const got = DH.inv.add("wood", 1);
      poof(tx * T + 16, ty * T + 22); sparks(tx * T + 16, ty * T + 10, 4);
      DH.toast(`Dug up the tree! ${got ? "+1 🪵" : "(pockets full)"} · ${S.stamina} energy left`);
      alog("dig-tree");
      return true;
    },

    plantApple(tx, ty) {
      if (DH.inv.count("apple") <= 0 || !freeGrass(tx, ty)) return false;
      DH.inv.remove("apple", 1);
      S.trees.push({
        tx, ty, kind: "apple", age: 0, fruitReady: false,
        shakeDay: -1, chop: 0, cd: 0, stump: -1,
      });
      DH.world.blocked.add(tx + "," + ty);
      sparks(tx * T + 16, ty * T + 12, 4);
      DH.toast("🌱 Planted an apple — a tree will grow!");
      alog("plant-apple");
      return true;
    },

    eatApple() {
      if (DH.inv.count("apple") <= 0 || S.stamina >= STAMINA_CAP) return false;
      DH.inv.remove("apple", 1);
      S.stamina++;
      DH.toast(`🍎 Yummy! +1 energy — you can dig up a whole tree (${S.stamina})`);
      alog("eat");
      return true;
    },

    hitRock(idx) {
      const r = S.rocks[idx];
      if (!r) return false;
      dailyCheck();
      if (r.hits >= r.max) { DH.toast("This rock is tapped out for today"); return false; }
      r.hits++;
      const cx = r.tx * T + 16, cy = r.ty * T + 14;
      sparks(cx, cy, 5);
      if (idx === S.moneyIdx && S.moneyDay === REALDAY()) {
        const amt = MONEY_PAYOUT[Math.min(r.hits - 1, MONEY_PAYOUT.length - 1)];
        gs.coins += amt; coinFx(cx, cy);
        DH.toast(`💰 The money rock! +${amt}🪙`);
      } else {
        const lucky = DH.tools && typeof DH.tools.has === "function" && DH.tools.has("shovel");
        const roll = Math.random();
        const mat = roll < (lucky ? 0.06 : 0.03) ? "gold"
          : roll < (lucky ? 0.28 : 0.20) ? "iron"
          : roll < 0.55 ? "clay" : "stone";
        const got = DH.inv.add(mat, 1);
        DH.toast(got ? `${DH.items.label(mat)} +1` : "Pockets full! 🪨");
      }
      if (r.hits >= r.max) DH.toast("The rock is tapped out for today");
      alog("rock");
      return true;
    },

    pullWeed(tx, ty) {
      const i = weedAt(tx, ty);
      if (i < 0) return false;
      const w = S.weeds[i];
      S.weeds.splice(i, 1);
      DH.inv.add("weed", 1);
      gs.happiness += 1.5;
      leafBurst(w.tx * T + 16, w.ty * T + 20, 4);
      DH.toast("🌿 Pulled a weed +🏠1");
      alog("weed");
      return true;
    },

    digSpot() {
      if (!S.glow || S.glow.used) return false;
      S.glow.used = 1;
      gs.coins += 100;
      coinFx(S.glow.tx * T + 16, S.glow.ty * T + 16); sparks(S.glow.tx * T + 16, S.glow.ty * T + 10, 6);
      DH.toast("💰 +100🪙 buried treasure!");
      alog("dig-spot");
      return true;
    },

    burySpot() {
      if (!S.glow || S.glow.used || gs.coins < 100) return false;
      S.glow.used = 1;
      gs.coins -= 100;
      const { tx, ty } = S.glow;
      S.trees.push({
        tx, ty, kind: "money", age: 0, fruitReady: false,
        shakeDay: -1, chop: 0, cd: 0, stump: -1,
      });
      DH.world.blocked.add(tx + "," + ty);
      sparks(tx * T + 16, ty * T + 10, 6);
      DH.toast("🌱💰 Buried 100🪙 — a money tree will grow!");
      alog("bury-bells");
      return true;
    },

    plantFlower(tx, ty, sp, col) {
      if (!SPECIES[sp] || !BASE_COLORS.includes(col)) return false;
      if (gs.coins < FLOWER_COST) { DH.toast("Not enough coins 🪙"); return false; }
      if (!freeGrass(tx, ty)) return false;
      gs.coins -= FLOWER_COST;
      S.flowers.push({
        tx, ty, sp, col, plantDay: today(),
        bloomed: false, thirsty: true, watered: false,
      });
      sparks(tx * T + 16, ty * T + 12, 4);
      DH.toast(`${SPECIES[sp].ico} Planted ${flowerName(sp, col)} seeds`);
      alog("plant-flower");
      return true;
    },

    waterFlower(tx, ty) {
      const i = flowerAt(tx, ty);
      if (i < 0 || !S.flowers[i].thirsty) return false;
      const f = S.flowers[i];
      f.thirsty = false; f.watered = true;
      const cx = tx * T + 16, cy = ty * T + 16;
      fx("splash", cx, cy, { vy: -14, ttl: 0.5, sz: 3 });
      DH.toast("💧 Watered!");
      alog("water");
      return true;
    },

    pickFlower(tx, ty) {
      const i = flowerAt(tx, ty);
      if (i < 0 || !S.flowers[i].bloomed) return false;
      const f = S.flowers[i];
      S.flowers.splice(i, 1);
      const got = DH.inv.add(flowerId(f.sp, f.col), 1);
      sparks(tx * T + 16, ty * T + 12, 4);
      gs.happiness += 1;
      DH.toast(got ? `${SPECIES[f.sp].ico} Picked a ${flowerName(f.sp, f.col)}!` : "Pockets full! 🌸");
      alog("pick-flower");
      return true;
    },
  };
  function nearestPid(x, y) {
    let best = 0, bd = Infinity;
    for (const p of gs.players) {
      const d = dist2(x, y, p.x, p.y);
      if (d < bd) { bd = d; best = p.pid || 0; }
    }
    return best;
  }

  // ---------- weeds ----------
  function trySpawnWeed() {
    if (S.weeds.length >= WEED_CAP) return;
    const t = randomFreeTile();
    if (!t) return;
    S.weeds.push({ tx: t.tx, ty: t.ty, ox: rnd(-6, 6), oy: rnd(-4, 4), v: Math.random() < 0.3 ? 1 : 0 });
  }

  // ---------- menus ----------
  function openGlow() {
    DH.menu.open("✨ Glowing spot", [
      { ico: "⛏️", label: "Dig it up · +100🪙", cb: () => API.digSpot() },
      { ico: "💰", label: "Bury 100🪙 · grow a money tree", cost: 100, disabled: gs.coins < 100, cb: () => API.burySpot() },
    ]);
  }
  function openTreeMenu(t) {
    const name = t.stump >= 0 ? "🪵 Stump" : t.kind === "money" ? "💰 Money tree" : !mature(t) ? "🌱 Young tree" : "🌳 Apple tree";
    const items = [];
    const canShake = t.stump < 0 && mature(t) && t.shakeDay !== today();
    items.push({
      ico: "🍎", label: t.shakeDay === today() ? "Shaken (done today)" : t.kind === "money" ? "Shake · bell bags!" : "Shake tree",
      disabled: !canShake, cb: () => API.shakeTree(t.tx, t.ty),
    });
    if (t.stump < 0 && mature(t)) {
      items.push({
        ico: "🪓", label: `Chop tree (${t.chop || 0}/${CHOP_HITS}) · wood`,
        cb: () => API.chopTree(t.tx, t.ty),
      });
    }
    items.push({
      ico: "⚡", label: `Dig up ${t.stump >= 0 ? "stump" : "tree"} · uses 1 energy`,
      disabled: S.stamina <= 0, cb: () => API.digUp(t.tx, t.ty),
    });
    DH.menu.open(name, items);
  }
  function openFlowerMenu(f) {
    const name = `${SPECIES[f.sp].ico} ${flowerName(f.sp, f.col)}`;
    const items = [];
    if (f.bloomed) items.push({ ico: SPECIES[f.sp].ico, label: "Pick flower", cb: () => API.pickFlower(f.tx, f.ty) });
    items.push({ ico: "💧", label: "Water", disabled: !f.thirsty, cb: () => API.waterFlower(f.tx, f.ty) });
    DH.menu.open(name, items);
  }
  function openSeedMenu(tx, ty, sp) {
    DH.menu.open(`${SPECIES[sp].ico} ${cap(sp)} seeds · 🪙${FLOWER_COST}`, BASE_COLORS.map(col => ({
      ico: SPECIES[sp].ico,
      label: `${cap(col)} ${sp}`, cost: FLOWER_COST,
      disabled: gs.coins < FLOWER_COST,
      cb: () => API.plantFlower(tx, ty, sp, col),
    })));
  }
  function openPlantMenu(tx, ty) {
    const items = [];
    const apples = DH.inv.count("apple");
    if (apples > 0) {
      items.push({ ico: "🍎", label: `Plant apple ×${apples}`, cb: () => API.plantApple(tx, ty) });
      items.push({ ico: "🍴", label: `Eat apple · +1 energy (${S.stamina})`, cb: () => { API.eatApple(); } });
    }
    for (const sp of Object.keys(SPECIES))
      items.push({ ico: SPECIES[sp].ico, label: `${cap(sp)} seeds · 🪙${FLOWER_COST}`, cb: () => openSeedMenu(tx, ty, sp) });
    if (!items.length) { DH.toast("Nothing to plant — collect an apple first 🍎"); return; }
    DH.menu.open("🌱 Pocket garden", items);
  }

  // ---------- module contract ----------
  const M = (DH.forage = {
    authority: true,
    _S: S, // exposed for debugging/tests

    init(state) {
      gs = state;
      M.authority = !(DH.net && DH.net.online && DH.net.role === "guest");
      C = document.getElementById("cv").getContext("2d");
      const W = DH.world;
      if (!W._blockPatched) {                 // same trick sauna/furniture use
        W._blockPatched = true;
        const s0 = W.isSolid.bind(W);
        W.isSolid = (tx, ty) => s0(tx, ty) || W.blocked.has(tx + "," + ty);
      }
    },

    start(state) {
      gs = state;
      M.authority = !(DH.net && DH.net.online && DH.net.role === "guest");
      if (!S.seeded) {
        S.seeded = true;
        BASE_TREES.forEach(({ tx, ty }) => S.trees.push({
          tx, ty, kind: "apple", age: MATURE_AT, fruitReady: true,
          shakeDay: -1, chop: 0, cd: 0, stump: -1,
        }));
        BASE_ROCKS.forEach(({ tx, ty }) => S.rocks.push({ tx, ty, day: -1, hits: 0, max: ROCK_HITS_MAX }));
        // a friendly starter bed so day-1 has something to pull
        [[2, 10], [17, 11], [27, 12]].forEach(([tx, ty]) => {
          if (weedOK(tx, ty)) S.weeds.push({ tx, ty, ox: rnd(-6, 6), oy: rnd(-4, 4), v: 0 });
        });
      }
      reconcileBlocked();
      lastT = null;
      dailyCheck();
    },

    update(dt, state) {
      gs = state; S.now += dt;
      // FX tick lives in drawOverlay so guests animate too
      if (!M.authority) return;
      const dm = lastT == null ? 0 : (state.timeMin - lastT + GDAY) % GDAY;
      lastT = state.timeMin;
      if (dm > 0) {
        for (const t of S.trees) {
          if (t.stump >= 0) {
            t.stump += dm;
            if (t.stump >= STUMP_SPAN) {           // regrow into a fresh mature tree
              t.stump = -1; t.age = MATURE_AT; t.fruitReady = false;
              DH.world.blocked.add(t.tx + "," + t.ty);
              poof(t.tx * T + 16, t.ty * T + 18);
            }
          } else {
            const wasM = mature(t);
            t.age += dm;
            if (!wasM && mature(t)) t.fruitReady = true;
          }
        }
      }
      // game-day rollover -> morning
      const gd = today();
      if (S.lastDay < 0) S.lastDay = gd;
      if (gd > S.lastDay) { S.lastDay = gd; morningTick(gd, null); }
      // real-day rollover -> money rock + glowing spot
      dailyCheck();
      // weeds creep in
      S.weedAcc += dt;
      if (S.weedAcc >= WEED_EVERY) { S.weedAcc = 0; trySpawnWeed(); }
      // an overgrown yard nags at the home's happiness
      if (S.weeds.length >= WEED_GLOOM) {
        gs.happiness = Math.max(0, gs.happiness - 0.02 * dt);
        S.toastCD -= dt;
        if (S.toastCD <= 0) { S.toastCD = 28; DH.toast("Weeds are taking over the yard 🌿☹️"); }
      } else S.toastCD = 0;
      // bee stings damp movement briefly
      for (const p of state.players) {
        const st = S.sting[p.pid];
        if (!st || st.t <= 0) continue;
        st.t -= dt;
        p.x = st.px + (p.x - st.px) * STING_DRAG;
        p.y = st.py + (p.y - st.py) * STING_DRAG;
        st.px = p.x; st.py = p.y;
      }
    },

    interactables(p) {
      if (!gs || !gs.running) return [];
      const out = [];
      const near = (x, y, r) => dist2(p.x, p.y, x, y) < r * r;
      // glowing spot — rare, daily
      if (S.glow && !S.glow.used && glowClear()) {
        const gx = S.glow.tx * T + 16, gy = S.glow.ty * T + 16;
        if (near(gx, gy, 40)) out.push({ pri: 0, label: "✨ Glowing spot", x: gx, y: gy, action: openGlow });
      }
      for (const w of S.weeds) {
        const cx = w.tx * T + 16, cy = w.ty * T + 16;
        if (near(cx, cy, 38)) out.push({ pri: 1, label: "Pull weeds 🌿", x: cx, y: cy, action: () => API.pullWeed(w.tx, w.ty) });
      }
      for (const t of S.trees) {
        const cx = t.tx * T + 16, cy = t.ty * T + 22;
        if (!near(cx, cy, 48)) continue;
        if (t.stump >= 0) {
          if (S.stamina > 0)
            out.push({ pri: 1, label: "Dig up stump ⚡", x: cx, y: cy, action: () => API.digUp(t.tx, t.ty) });
        } else {
          const label = t.kind === "money" ? "💰 Money tree" : mature(t) ? "🌳 Apple tree" : "🌱 Sapling";
          out.push({ pri: 1, label, x: cx, y: cy, action: () => openTreeMenu(t) });
        }
      }
      for (let i = 0; i < S.rocks.length; i++) {
        const r = S.rocks[i];
        if (r.day !== REALDAY() || r.hits >= r.max) continue;
        const cx = r.tx * T + 16, cy = r.ty * T + 14;
        if (near(cx, cy, 46)) out.push({ pri: 1, label: "Hit rock ⛏️", x: cx, y: cy, action: () => API.hitRock(i) });
      }
      for (const f of S.flowers) {
        const cx = f.tx * T + 16, cy = f.ty * T + 16;
        if (!near(cx, cy, 38)) continue;
        const sp = SPECIES[f.sp];
        if (f.bloomed && f.thirsty) out.push({ pri: 1, label: `${sp.ico} ${flowerName(f.sp, f.col)}`, x: cx, y: cy, action: () => openFlowerMenu(f) });
        else if (f.thirsty) out.push({ pri: 1, label: `Water ${sp.ico}`, x: cx, y: cy, action: () => API.waterFlower(f.tx, f.ty) });
        else if (f.bloomed) out.push({ pri: 1, label: `Pick ${sp.ico}`, x: cx, y: cy, action: () => API.pickFlower(f.tx, f.ty) });
      }
      // standing on open grass -> plant / snack menu
      const tx = Math.floor(p.x / T), ty = Math.floor(p.y / T);
      const W = DH.world;
      if (W.tileAt(tx, ty) === W.GRASS && W.zone(tx, ty) === "yard" &&
          !forbidden(tx, ty) && !occupied(tx, ty) && !W.isSolid(tx, ty)) {
        out.push({ pri: 2, label: "🌱 Pocket garden", x: tx * T + 16, y: ty * T + 16, action: () => openPlantMenu(tx, ty) });
      }
      out.sort((a, b) => (a.pri - b.pri) || (dist2(p.x, p.y, a.x, a.y) - dist2(p.x, p.y, b.x, b.y)));
      return out;
    },

    // ----- drawing -----
    drawGround(ctx, camX, camY) {
      // glowing spot — shimmering gold crack
      if (S.glow && !S.glow.used && glowClear()) {
        const gx = S.glow.tx * T - camX, gy = S.glow.ty * T - camY;
        const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 260);
        ctx.fillStyle = `rgba(255,215,90,${0.25 + 0.35 * pulse})`;
        ctx.beginPath(); ctx.ellipse(gx + 16, gy + 18, 8 + pulse * 3, 4 + pulse, 0, 0, Math.PI * 2); ctx.fill();
        drawStar(ctx, gx + 16, gy + 16, 4 + pulse * 2, "#ffe89a");
      }
      // weeds — ragged tufts
      for (const w of S.weeds) {
        const wx = w.tx * T + 16 + w.ox - camX, wy = w.ty * T + 22 + w.oy - camY;
        ctx.fillStyle = "#4f8f33";
        ctx.fillRect(wx - 5, wy - 6, 2, 7); ctx.fillRect(wx - 1, wy - 8, 2, 9); ctx.fillRect(wx + 3, wy - 5, 2, 6);
        ctx.fillStyle = "#6fae3f";
        ctx.fillRect(wx - 4, wy - 4, 2, 2); ctx.fillRect(wx + 2, wy - 6, 2, 2);
        if (w.v) { ctx.fillStyle = "#d8e8b8"; ctx.fillRect(wx - 1, wy - 11, 2, 2); }
      }
      // flowers
      for (const f of S.flowers) {
        const fx0 = f.tx * T - camX, fy0 = f.ty * T - camY, cx = fx0 + 16;
        ctx.fillStyle = "#3f8f33";
        ctx.fillRect(cx - 1, fy0 + 16, 2, 9);
        ctx.fillRect(cx - 4, fy0 + 19, 3, 2);
        if (!f.bloomed) {
          ctx.fillStyle = "#4f9e4d"; ctx.fillRect(cx - 2, fy0 + 13, 4, 4); // closed bud
        } else {
          const hex = FLOWER_HEX[f.col] || "#ffffff";
          const droop = f.thirsty ? 2 : 0;
          ctx.fillStyle = hex;
          ctx.fillRect(cx - 4, fy0 + 10 + droop, 3, 3); ctx.fillRect(cx + 1, fy0 + 10 + droop, 3, 3);
          ctx.fillRect(cx - 2, fy0 + 8 + droop, 4, 3); ctx.fillRect(cx - 1, fy0 + 12 + droop, 2, 2);
          ctx.fillStyle = "#fff8c9"; ctx.fillRect(cx - 1, fy0 + 10 + droop, 2, 2);
        }
      }
    },

    collectDraws(draws, camX, camY) {
      if (!C) C = document.getElementById("cv").getContext("2d");
      for (const r of S.rocks) {
        const px = r.tx * T - camX, py = r.ty * T - camY;
        draws.push({ y: r.ty * T + 28, fn: () => drawRock(C, px, py) });
      }
      for (const t of S.trees) {
        const px = t.tx * T - camX, py = t.ty * T - camY;
        draws.push({ y: t.ty * T + 30, fn: () => drawTree(C, px, py, t) });
      }
    },

    drawOverlay(ctx, camX, camY, state) {
      // FX tick here (not update) so remote guests animate from snapshots
      const now = performance.now();
      const dt = Math.min(0.06, ((now - (M._fxT || now)) / 1000) || 0.016);
      M._fxT = now;
      for (let i = S.fx.length - 1; i >= 0; i--) {
        const f = S.fx[i];
        f.age += dt;
        if (f.k === "bee" && state && state.players[f.pid]) {
          f.a += dt * 9;
          const p = state.players[f.pid];
          f.x = p.x + Math.cos(f.a) * f.r;
          f.y = p.y - 26 + Math.sin(f.a) * f.r * 0.6;
        } else {
          f.x += (f.vx || 0) * dt; f.y += (f.vy || 0) * dt;
        }
        if (f.age >= f.ttl) { S.fx[i] = S.fx[S.fx.length - 1]; S.fx.pop(); continue; }
        drawFx(ctx, f, camX, camY);
      }
      if (!gs || !gs.running) return;
      // thirsty markers + ready-to-pick sparkle
      ctx.font = "9px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      const tw = 0.5 + 0.5 * Math.sin(Date.now() / 200);
      for (const f of S.flowers) {
        const x = f.tx * T + 22 - camX, y = f.ty * T + 6 - camY;
        if (f.thirsty) ctx.fillText("💧", x, y);
        else if (f.bloomed) { ctx.globalAlpha = 0.4 + 0.6 * tw; ctx.fillText("✨", x, y); ctx.globalAlpha = 1; }
      }
      // sting wobble marker
      for (const p of state.players) {
        const st = S.sting[p.pid];
        if (st && st.t > 0) DH.sprites.sad(ctx, p.x - camX, p.y - 44 + Math.sin(Date.now() / 200) * 2, 6);
      }
    },

    // ----- sync boundary -----
    serialize() {
      return JSON.parse(JSON.stringify({
        trees: S.trees, rocks: S.rocks, weeds: S.weeds, flowers: S.flowers,
        glow: S.glow, moneyDay: S.moneyDay, moneyIdx: S.moneyIdx,
        stamina: S.stamina, sting: S.sting, fx: S.fx,
        seeded: S.seeded, weedAcc: S.weedAcc, lastDay: S.lastDay,
      }));
    },
    deserialize(d) {
      if (!d) return;
      if (Array.isArray(d.trees))
        S.trees = d.trees.map(t => Object.assign({ tx: 0, ty: 0, kind: "apple", age: 0, fruitReady: false, shakeDay: -1, chop: 0, cd: 0, stump: -1 }, t));
      if (Array.isArray(d.rocks))
        S.rocks = d.rocks.map(r => Object.assign({ tx: 0, ty: 0, day: -1, hits: 0, max: ROCK_HITS_MAX }, r));
      if (Array.isArray(d.weeds))
        S.weeds = d.weeds.map(w => Object.assign({ tx: 0, ty: 0, ox: 0, oy: 0, v: 0 }, w));
      if (Array.isArray(d.flowers))
        S.flowers = d.flowers.map(f => Object.assign({ tx: 0, ty: 0, sp: "rose", col: "red", plantDay: 0, bloomed: false, thirsty: true, watered: false }, f));
      if (d.glow && typeof d.glow === "object") S.glow = d.glow;
      if (typeof d.moneyDay === "number") S.moneyDay = d.moneyDay;
      if (typeof d.moneyIdx === "number") S.moneyIdx = d.moneyIdx;
      if (typeof d.stamina === "number") S.stamina = d.stamina;
      if (Array.isArray(d.sting)) S.sting = d.sting;
      if (Array.isArray(d.fx)) S.fx = d.fx;
      if (d.seeded) S.seeded = true;
      if (typeof d.weedAcc === "number") S.weedAcc = d.weedAcc;
      if (typeof d.lastDay === "number") S.lastDay = d.lastDay;
      reconcileBlocked();
    },
    remoteAction(name, args) {
      const fn = API[name];
      return typeof fn === "function" ? fn.apply(null, args || []) : false;
    },

    // overnight / away progress for the "while you were away" report
    offline(offMin) {
      const parts = [];
      const offGm = Math.min(offMin, OFFLINE_CAP) * 4; // 4 game-min per real min
      let matured = 0;
      for (const t of S.trees) {
        if (t.stump >= 0) {
          t.stump += offGm;
          if (t.stump >= STUMP_SPAN) { t.stump = -1; t.age = MATURE_AT; t.fruitReady = false; }
        } else {
          const wasM = mature(t);
          t.age += offGm;
          if (!wasM && mature(t)) { t.fruitReady = true; matured++; }
        }
      }
      reconcileBlocked();
      if (offMin >= 120) {                      // at least a morning passed
        const report = [];
        for (const f of S.flowers) if (!f.bloomed) f.bloomed = true;
        morningTick(today() + 1, report);
        parts.push(...report);
        // weeds had all night to spread
        const nWeeds = Math.min(WEED_CAP - S.weeds.length, 1 + Math.floor(offMin / 90));
        for (let i = 0; i < nWeeds; i++) trySpawnWeed();
        if (nWeeds > 0) parts.push(`${nWeeds} weed${nWeeds > 1 ? "s" : ""} sprouted`);
      }
      if (matured) parts.push(`${matured} fruit tree${matured > 1 ? "s" : ""} matured`);
      return parts;
    },

    // beetle spawn markers for critters.js (px centers)
    stumps() {
      return S.trees.filter(t => t.stump >= 0).map(t => ({ x: t.tx * T + 16, y: t.ty * T + 24 }));
    },
  });
  Object.assign(M, API); // DH.forage.shakeTree(...) etc. for tests + remote use

  // ---------- sprites (self-contained pixel art) ----------
  function drawStar(ctx, x, y, s, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y - s);
    ctx.quadraticCurveTo(x + s * 0.2, y - s * 0.2, x + s, y);
    ctx.quadraticCurveTo(x + s * 0.2, y + s * 0.2, x, y + s);
    ctx.quadraticCurveTo(x - s * 0.2, y + s * 0.2, x - s, y);
    ctx.quadraticCurveTo(x - s * 0.2, y - s * 0.2, x, y - s);
    ctx.fill();
  }
  function drawFx(ctx, f, camX, camY) {
    const t = f.age / f.ttl, x = f.x - camX, y = f.y - camY;
    ctx.save();
    if (f.k === "leaf") {
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = "#5fa83e";
      ctx.fillRect(x, y, f.sz || 2.5, (f.sz || 2.5) * 0.7);
    } else if (f.k === "spark") {
      ctx.globalAlpha = Math.sin(Math.min(1, t) * Math.PI);
      drawStar(ctx, x, y, f.sz || 3, "#ffe89a");
    } else if (f.k === "coin") {
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = "#ffd94d"; ctx.fillRect(x - 3, y - 3, 6, 6);
      ctx.fillStyle = "#e8a13c"; ctx.fillRect(x - 3, y - 3, 6, 1);
      ctx.fillStyle = "#fff3b0"; ctx.fillRect(x - 1, y - 1, 2, 2);
    } else if (f.k === "poof") {
      ctx.globalAlpha = 0.55 * (1 - t);
      ctx.fillStyle = "#d8d4c8";
      ctx.beginPath(); ctx.arc(x, y, (f.sz || 4) * (0.5 + t), 0, Math.PI * 2); ctx.fill();
    } else if (f.k === "splash") {
      ctx.globalAlpha = 0.8 * (1 - t);
      ctx.fillStyle = "#7ec8f0"; ctx.fillRect(x - 4, y, 2, 3); ctx.fillRect(x - 1, y - 3, 2, 3); ctx.fillRect(x + 3, y, 2, 3);
    } else if (f.k === "bee") {
      ctx.globalAlpha = Math.min(1, (f.ttl - f.age) * 3);
      ctx.fillStyle = "#3a3020"; ctx.fillRect(x - 1.5, y - 1, 3, 2.5);
      ctx.fillStyle = "#ffd94d"; ctx.fillRect(x - 0.5, y - 1, 1, 2.5);
      ctx.fillStyle = "rgba(255,255,255,0.7)"; ctx.fillRect(x - 1, y - 3, 2, 1.5);
    }
    ctx.restore();
  }
  function drawTree(ctx, px, py, t) {
    const cx = px + 16;
    if (t.stump >= 0) { // stump: rings + tiny beetle notch for critters to find
      ctx.fillStyle = "#6f4327"; ctx.fillRect(cx - 6, py + 18, 12, 10);
      ctx.fillStyle = "#a07845"; ctx.fillRect(cx - 5, py + 17, 10, 4);
      ctx.fillStyle = "#7a5328"; ctx.fillRect(cx - 2, py + 18, 4, 2);
      ctx.fillStyle = "#3a2a18"; ctx.fillRect(cx + 3, py + 22, 2, 2);
      return;
    }
    const sway = Math.sin(Date.now() / 900 + t.tx * 1.7 + t.ty) * 1.2;
    if (t.age < YOUNG_AT) { // sapling
      ctx.fillStyle = "#7a4a26"; ctx.fillRect(cx - 1, py + 18, 2, 10);
      ctx.fillStyle = "#4fae4f";
      ctx.fillRect(cx - 4, py + 12, 4, 4); ctx.fillRect(cx + 1, py + 10, 4, 4);
      return;
    }
    const young = t.age < MATURE_AT;
    ctx.fillStyle = "#6f4327";
    ctx.fillRect(cx - (young ? 2 : 3), py + 12, young ? 4 : 6, young ? 14 : 18);
    const r = young ? 8 : 12;
    const cy = young ? py + 10 : py + 8;
    ctx.fillStyle = t.kind === "money" ? "#3f8f4d" : "#2f7a34";
    ctx.beginPath();
    ctx.arc(cx + sway, cy, r, 0, Math.PI * 2);
    ctx.arc(cx - 8 + sway, cy + (young ? 5 : 7), r * 0.6, 0, Math.PI * 2);
    ctx.arc(cx + 8 + sway, cy + (young ? 5 : 7), r * 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = t.kind === "money" ? "#4fae5d" : "#3f9e44";
    ctx.beginPath(); ctx.arc(cx - 3 + sway, cy - 4, r * 0.5, 0, Math.PI * 2); ctx.fill();
    if (t.fruitReady) {
      if (t.kind === "money") { // bell bags
        ctx.fillStyle = "#ffd94d";
        [[-6, 7], [6, 4], [0, 12]].forEach(o => {
          ctx.fillRect(cx + o[0] + sway - 3, cy + o[1] - 3, 6, 7);
          ctx.fillStyle = "#e8a13c"; ctx.fillRect(cx + o[0] + sway - 2, cy + o[1] - 4, 4, 2);
          ctx.fillStyle = "#ffd94d";
        });
      } else {
        ctx.fillStyle = "#e23b3b";
        [[-6, 8], [6, 5], [0, 14]].forEach(o => {
          ctx.beginPath(); ctx.arc(cx + o[0] + sway, cy + o[1], 2.4, 0, Math.PI * 2); ctx.fill();
        });
      }
    }
  }
  function drawRock(ctx, px, py) {
    const cx = px + 16;
    ctx.fillStyle = "#8b9399";
    ctx.beginPath(); ctx.ellipse(cx, py + 20, 12, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#aab2b8";
    ctx.beginPath(); ctx.ellipse(cx - 2, py + 17, 9, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#7d858c";
    ctx.fillRect(cx - 1, py + 16, 1, 5); ctx.fillRect(cx + 3, py + 19, 4, 1);
    ctx.fillStyle = "#5f8a3c"; ctx.fillRect(cx - 9, py + 22, 3, 2); // moss fleck
  }
})();

DH.register("forage", DH.forage);
