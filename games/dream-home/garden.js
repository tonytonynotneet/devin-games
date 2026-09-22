/* dream-home garden module — soil plots, seed shop, orchard trees, flowerbed.
   Contract with game.js (same as furniture.js):
     DH.garden.init(state)         – called once at load
     DH.garden.start(state)        – called when a run starts (resets garden)
     DH.garden.update(dt, state)   – per frame (sim)
     DH.garden.interactables(p)    – -> [{label,x,y,action}] for the action key
     DH.garden.collectDraws(draws, camX, camY) – push {y, fn} for depth-sorted render
     DH.garden.drawOverlay(ctx, camX, camY, state) – topmost markers (thirst/wilt/ripe)
   Garden zone: DH.world.zone(tx,ty) === "garden"; soil tiles are DH.world.SOIL.
   Crop growth is driven by state.timeMin (game minutes). Unwatered crops wilt
   and yield less; harvesting pays state.coins + state.happiness.
   Net-sync boundary: all gameplay state is plain JSON data (serialize /
   deserialize) and every mutation is a named function callable through
   DH.garden.remoteAction(name, args) for a future relay layer.
*/
(function () {
  const DH = (window.DH = window.DH || {});
  const T = 32, DAY = 24 * 60;

  // ---------- catalog ----------
  // grow = game-minutes of moisture to ripen; sell/happy = harvest yield
  const CROPS = [
    { id: "carrot",    name: "Carrot",    ico: "🥕", cost: 5,  grow: 60,  sell: 14, happy: 2 },
    { id: "tomato",    name: "Tomato",    ico: "🍅", cost: 8,  grow: 90,  sell: 22, happy: 3 },
    { id: "tulip",     name: "Tulip",     ico: "🌷", cost: 6,  grow: 70,  sell: 16, happy: 4, flower: true },
    { id: "sunflower", name: "Sunflower", ico: "🌻", cost: 10, grow: 100, sell: 24, happy: 5, flower: true },
    { id: "pumpkin",   name: "Pumpkin",   ico: "🎃", cost: 15, grow: 150, sell: 42, happy: 5 },
    { id: "melon",     name: "Melon",     ico: "🍉", cost: 18, grow: 180, sell: 55, happy: 6 },
  ];
  const BY_ID = {}; CROPS.forEach(c => (BY_ID[c.id] = c));
  const SAPLING = { id: "sapling", name: "Apple Sapling", ico: "🌱", cost: 25 };

  const WATER_SPAN = 110;   // game-minutes of moisture per watering
  const WILT_AFTER = 25;    // dry game-minutes before a plant wilts
  const MATURE = 80;        // game-minutes for a sapling to become a tree
  const FRUIT_EVERY = 140;  // game-minutes for a mature tree to regrow fruit

  const TREE_KINDS = {
    apple:  { fruit: "apples",   ico: "🍎", color: "#e23b3b", coins: 10, happy: 3 },
    cherry: { fruit: "cherries", ico: "🍒", color: "#d6255c", coins: 12, happy: 3 },
    peach:  { fruit: "peaches",  ico: "🍑", color: "#f6a13c", coins: 12, happy: 4 },
  };

  const CRATE = { tx: 16, ty: 5 };                    // seed shop at garden west edge
  const BED_TILES = [[10, 11], [11, 11], [12, 11], [13, 11]]; // flowerbed along the path
  const BASE_TREES = [
    { tx: 28, ty: 3, kind: "apple",  age: MATURE, fruit: true },
    { tx: 28, ty: 5, kind: "cherry", age: MATURE, fruit: false },
    { tx: 28, ty: 7, kind: "peach",  age: MATURE, fruit: true },
  ];
  const DIRV = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const BED_SET = new Set(BED_TILES.map(t => t.join(",")));

  // ---------- state (plain JSON-serializable only — no functions/DOM refs) ----------
  let state = null;
  let C = null;     // shared 2d context (game.js calls draw fns with no args)
  let plots = {};   // "x,y" -> {tx,ty,crop,growth,moist,dry,wilted,damaged}
  let beds = {};    // "x,y" -> slot (pre-tilled, flowers only)
  let trees = [];   // [{tx,ty,kind,age,fruit,t}]
  let seeds = {};   // seedId -> count
  let lastT = null, wiltCD = 0;

  function newSlot(tx, ty) {
    return { tx, ty, crop: null, growth: 0, moist: 0, dry: 0, wilted: false, damaged: false };
  }

  function treeAt(tx, ty) {
    for (const t of trees) if (t.tx === tx && t.ty === ty) return t;
    return null;
  }

  // ---------- mutations (named + remote-callable; each returns true on success) ----------
  function till(tx, ty) {
    const W = DH.world, k = tx + "," + ty;
    if (W.zone(tx, ty) !== "garden" || W.tileAt(tx, ty) !== W.SOIL || plots[k]) return false;
    plots[k] = newSlot(tx, ty);
    DH.toast("Soil tilled — plant a seed! ⛏️");
    return true;
  }

  function plant(tx, ty, cropId) {
    const k = tx + "," + ty, c = BY_ID[cropId];
    const slot = plots[k] || beds[k];
    if (!c || !slot || slot.crop || !(seeds[cropId] > 0)) return false;
    if (beds[k] && !c.flower) return false;           // flowerbed takes flowers only
    seeds[cropId]--;
    slot.crop = cropId; slot.growth = 0; slot.moist = 0; slot.dry = 0;
    slot.wilted = false; slot.damaged = false;
    DH.toast(`Planted ${c.name} ${c.ico}`);
    return true;
  }

  function water(tx, ty) {
    const slot = plots[tx + "," + ty] || beds[tx + "," + ty];
    if (!slot || !slot.crop || slot.growth >= 1) return false;
    slot.moist = WATER_SPAN; slot.dry = 0;
    if (slot.wilted) { slot.wilted = false; DH.toast("Revived — but yield is reduced 🥀"); }
    else DH.toast("Watered 💧");
    return true;
  }

  function harvest(tx, ty) {
    const k = tx + "," + ty, slot = plots[k] || beds[k];
    if (!slot || !slot.crop || slot.growth < 1) return false;
    const c = BY_ID[slot.crop], mult = slot.damaged ? 0.5 : 1;
    const coins = Math.max(1, Math.round(c.sell * mult));
    const happy = Math.max(1, Math.round(c.happy * mult));
    const wilted = slot.damaged;
    state.coins += coins; state.happiness += happy;
    slot.crop = null; slot.growth = 0; slot.moist = 0; slot.dry = 0;
    slot.wilted = false; slot.damaged = false;
    DH.toast(`${wilted ? "Wilted " : ""}${c.name} +🪙${coins} +🏠${happy}`);
    return true;
  }

  function buySeed(seedId) {
    const item = seedId === "sapling" ? SAPLING : BY_ID[seedId];
    if (!item || state.coins < item.cost) return false;
    state.coins -= item.cost;
    seeds[seedId] = (seeds[seedId] || 0) + 1;
    DH.toast(`Bought ${item.name}! ${item.ico}`);
    return true;
  }

  function plantTree(tx, ty) {
    const W = DH.world;
    if (!(seeds.sapling > 0)) return false;
    if (W.tileAt(tx, ty) !== W.GRASS || W.zone(tx, ty) !== "yard") return false;
    if (treeAt(tx, ty) || BED_SET.has(tx + "," + ty)) return false;
    if (tx === CRATE.tx && ty === CRATE.ty) return false;
    seeds.sapling--;
    trees.push({ tx, ty, kind: "apple", age: 0, fruit: false, t: 0 });
    DH.toast("Sapling planted — it'll take a while 🌱");
    return true;
  }

  function pickFruit(tx, ty) {
    const t = treeAt(tx, ty);
    if (!t || !t.fruit) return false;
    const kind = TREE_KINDS[t.kind];
    t.fruit = false; t.t = 0;
    state.coins += kind.coins; state.happiness += kind.happy;
    DH.toast(`Picked ${kind.fruit} ${kind.ico} +🪙${kind.coins} +🏠${kind.happy}`);
    return true;
  }

  // ---------- sim ----------
  function stepSlot(s, dm) {
    if (!s.crop || s.growth >= 1) return;
    const c = BY_ID[s.crop];
    if (s.moist > 0) {
      s.moist -= dm;
      s.growth = Math.min(1, s.growth + dm / c.grow);
      s.dry = 0;
    } else {
      s.dry += dm;
      if (!s.wilted && s.dry > WILT_AFTER) {
        s.wilted = true; s.damaged = true;
        if (wiltCD <= 0) { DH.toast("Crops are wilting — water them! 💧"); wiltCD = 8; }
      }
    }
  }

  // ---------- menus ----------
  function openShop() {
    const items = CROPS.map(c => ({
      ico: c.ico, cost: c.cost, disabled: state.coins < c.cost,
      label: `${c.name} · sells 🪙${c.sell} · ~${+(c.grow / 60).toFixed(1)}h`,
      cb: () => buySeed(c.id),
    }));
    items.push({
      ico: SAPLING.ico, cost: SAPLING.cost, disabled: state.coins < SAPLING.cost,
      label: `${SAPLING.name} · plant on grass`, cb: () => buySeed("sapling"),
    });
    DH.menu.open("🌱 Seed Shop", items);
  }

  function openPlantMenu(slot, flowerOnly) {
    const owned = CROPS.filter(c => seeds[c.id] > 0 && (!flowerOnly || c.flower));
    if (!owned.length) {
      DH.toast(flowerOnly ? "No flower seeds — buy some at the crate 📦" : "No seeds — buy some at the crate 📦");
      return;
    }
    DH.menu.open(flowerOnly ? "🌸 Plant flowers" : "🌱 Plant seed", owned.map(c => ({
      ico: c.ico, label: `${c.name} ×${seeds[c.id]}`,
      cb: () => plant(slot.tx, slot.ty, c.id),
    })));
  }

  // ---------- per-tile action resolution ----------
  function tileAction(tx, ty) {
    const W = DH.world, k = tx + "," + ty;
    const px = tx * T + T / 2, py = ty * T + T / 2;
    const bed = beds[k];
    if (bed) {
      if (bed.crop && bed.growth >= 1) {
        const c = BY_ID[bed.crop];
        return { pri: 0, label: `Pick ${c.name} ${c.ico}`, x: px, y: py, action: () => harvest(tx, ty) };
      }
      if (bed.crop) {
        return { pri: 1, label: bed.wilted ? "Water (revive) 💧" : `Water ${BY_ID[bed.crop].name} 💧`, x: px, y: py, action: () => water(tx, ty) };
      }
      return { pri: 1, label: "Plant flowers 🌸", x: px, y: py, action: () => openPlantMenu(bed, true) };
    }
    const plot = plots[k];
    if (plot) {
      if (plot.crop && plot.growth >= 1) {
        const c = BY_ID[plot.crop];
        return { pri: 0, label: `Harvest ${c.name} ${c.ico}`, x: px, y: py, action: () => harvest(tx, ty) };
      }
      if (plot.crop) {
        return { pri: 1, label: plot.wilted ? "Water (revive) 💧" : `Water ${BY_ID[plot.crop].name} 💧`, x: px, y: py, action: () => water(tx, ty) };
      }
      return { pri: 1, label: "Plant seed 🌱", x: px, y: py, action: () => openPlantMenu(plot, false) };
    }
    if (W.zone(tx, ty) === "garden" && W.tileAt(tx, ty) === W.SOIL) {
      return { pri: 3, label: "Till soil ⛏️", x: px, y: py, action: () => till(tx, ty) };
    }
    const t = treeAt(tx, ty);
    if (t && t.fruit) {
      const kind = TREE_KINDS[t.kind];
      return { pri: 0, label: `Pick ${kind.fruit} ${kind.ico}`, x: px, y: py, action: () => pickFruit(tx, ty) };
    }
    return null;
  }

  function saplingSpot(tx, ty) {
    const W = DH.world;
    return seeds.sapling > 0 &&
      W.tileAt(tx, ty) === W.GRASS && W.zone(tx, ty) === "yard" &&
      !treeAt(tx, ty) && !BED_SET.has(tx + "," + ty) &&
      !(tx === CRATE.tx && ty === CRATE.ty);
  }

  // ---------- drawing ----------
  function drawSlot(ctx, px, py, s, isBed) {
    if (isBed) {
      ctx.fillStyle = "#7d5a35"; ctx.fillRect(px + 1, py + 5, T - 2, T - 7);
      ctx.fillStyle = "#9a9a9a";
      ctx.fillRect(px + 2, py + 4, 5, 3); ctx.fillRect(px + T - 7, py + 4, 5, 3);
      ctx.fillRect(px + 2, py + T - 4, 5, 3); ctx.fillRect(px + T - 7, py + T - 4, 5, 3);
      if (!s.crop) { ctx.fillStyle = "#68492a"; ctx.fillRect(px + 9, py + 13, 4, 4); ctx.fillRect(px + 20, py + 19, 4, 4); }
    } else {
      ctx.fillStyle = "#4a2f18"; // tilled furrows
      ctx.fillRect(px + 3, py + 5, T - 6, 3); ctx.fillRect(px + 3, py + 15, T - 6, 3); ctx.fillRect(px + 3, py + 25, T - 6, 3);
    }
    if (s.moist > 0 && s.crop) { ctx.fillStyle = "#3a6bd133"; ctx.fillRect(px + 2, py + 2, T - 4, T - 4); }
    if (!s.crop) return;
    const cx = px + T / 2, base = py + T - 5;
    if (s.growth >= 1) {
      const bob = Math.sin(Date.now() / 300 + s.tx * 2 + s.ty) * 2;
      ctx.font = "20px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(BY_ID[s.crop].ico, cx, py + 14 + bob);
      return;
    }
    const h = 4 + s.growth * 14;
    ctx.fillStyle = s.wilted ? "#8a7a3a" : "#3f9e3f";
    ctx.fillRect(cx - 1, base - h, 2, h);
    ctx.fillRect(cx - 5, base - h * 0.55, 4, 2);
    ctx.fillRect(cx + 1, base - h * 0.75, 4, 2);
    if (s.growth > 0.55) {
      ctx.fillStyle = s.wilted ? "#a09040" : "#ffd34d";
      ctx.fillRect(cx - 2, base - h - 4, 4, 4);
    }
  }

  function drawTree(ctx, px, py, t) {
    const cx = px + T / 2;
    if (t.age < MATURE) { // sapling
      ctx.fillStyle = "#7a4a26"; ctx.fillRect(cx - 1, py + 16, 2, 12);
      ctx.fillStyle = "#4fae4f"; ctx.fillRect(cx - 4, py + 10, 8, 6);
      return;
    }
    ctx.fillStyle = "#6f4327"; ctx.fillRect(cx - 3, py + 12, 6, 18);
    ctx.fillStyle = "#2f7a34";
    ctx.beginPath();
    ctx.arc(cx, py + 8, 12, 0, Math.PI * 2);
    ctx.arc(cx - 8, py + 15, 7, 0, Math.PI * 2);
    ctx.arc(cx + 8, py + 15, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#3f9e44";
    ctx.beginPath(); ctx.arc(cx - 3, py + 4, 6, 0, Math.PI * 2); ctx.fill();
    if (t.fruit) {
      ctx.fillStyle = TREE_KINDS[t.kind].color;
      [[-6, 8], [6, 5], [0, 14]].forEach(o => {
        ctx.beginPath(); ctx.arc(cx + o[0], py + o[1], 2.4, 0, Math.PI * 2); ctx.fill();
      });
    }
  }

  function drawCrate(ctx, px, py) {
    ctx.fillStyle = "#a0733f"; ctx.fillRect(px + 4, py + 10, 24, 18);
    ctx.strokeStyle = "#7a5527"; ctx.lineWidth = 2;
    ctx.strokeRect(px + 4, py + 10, 24, 18);
    ctx.beginPath(); ctx.moveTo(px + 4, py + 19); ctx.lineTo(px + 28, py + 19); ctx.stroke();
    ctx.font = "12px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("🌱", px + 16, py + 15);
  }

  // ---------- module contract ----------
  DH.garden = {
    init(s) { state = s; },

    start(s) {
      state = s;
      plots = {}; beds = {}; seeds = { carrot: 2, tulip: 1 };
      BED_TILES.forEach(([tx, ty]) => (beds[tx + "," + ty] = newSlot(tx, ty)));
      trees = BASE_TREES.map(t => ({ tx: t.tx, ty: t.ty, kind: t.kind, age: t.age, fruit: t.fruit, t: 0 }));
      lastT = null; wiltCD = 0;
    },

    update(dt, s) {
      state = s;
      if (wiltCD > 0) wiltCD -= dt;
      const dm = lastT == null ? 0 : (s.timeMin - lastT + DAY) % DAY;
      lastT = s.timeMin;
      if (!dm) return;
      for (const k in plots) stepSlot(plots[k], dm);
      for (const k in beds) stepSlot(beds[k], dm);
      for (const t of trees) {
        t.age += dm;
        if (t.age >= MATURE && !t.fruit) {
          t.t += dm;
          if (t.t >= FRUIT_EVERY) { t.fruit = true; t.t = 0; }
        }
      }
    },

    interactables(p) {
      const tx = Math.floor(p.x / T), ty = Math.floor(p.y / T);
      const d = DIRV[p.dir] || [0, 0];
      const cands = [];
      for (const t of [{ tx, ty }, { tx: tx + d[0], ty: ty + d[1] }]) {
        const a = tileAction(t.tx, t.ty);
        if (a) cands.push(a);
        if (saplingSpot(t.tx, t.ty)) {
          cands.push({ pri: 4, label: "Plant sapling 🌱", x: t.tx * T + 16, y: t.ty * T + 16, action: () => plantTree(t.tx, t.ty) });
        }
      }
      const cdx = p.x - (CRATE.tx * T + 16), cdy = p.y - (CRATE.ty * T + 16);
      if (cdx * cdx + cdy * cdy < 52 * 52) {
        cands.push({ pri: 2, label: "Seed Shop 🌱", x: CRATE.tx * T + 16, y: CRATE.ty * T + 16, action: openShop });
      }
      if (!cands.length) return [];
      cands.sort((a, b) => a.pri - b.pri);
      return [cands[0]];
    },

    collectDraws(draws, camX, camY) {
      if (!C) C = document.getElementById("cv").getContext("2d");
      const cratePy = CRATE.ty * T - camY;
      draws.push({ y: CRATE.ty * T + T, fn: () => drawCrate(C, CRATE.tx * T - camX, cratePy) });
      for (const k in beds) {
        const s = beds[k];
        draws.push({ y: s.ty * T + T, fn: () => drawSlot(C, s.tx * T - camX, s.ty * T - camY, s, true) });
      }
      for (const k in plots) {
        const s = plots[k];
        draws.push({ y: s.ty * T + T - 2, fn: () => drawSlot(C, s.tx * T - camX, s.ty * T - camY, s, false) });
      }
      for (const t of trees) {
        draws.push({ y: t.ty * T + T, fn: () => drawTree(C, t.tx * T - camX, t.ty * T - camY, t) });
      }
    },

    drawOverlay(ctx, camX, camY) {
      if (!ctx) return;
      const mark = s => {
        if (!s.crop || s.growth >= 1) return;
        const x = s.tx * T + 16 - camX, y = s.ty * T + 6 - camY;
        if (s.wilted) DH.sprites.sad(ctx, x, y);
        else if (s.moist <= 0) {
          ctx.font = "9px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText("💧", x, y);
        }
      };
      for (const k in plots) mark(plots[k]);
      for (const k in beds) mark(beds[k]);
      // sparkle over ripe crops
      ctx.font = "10px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      const tw = 0.5 + 0.5 * Math.sin(Date.now() / 200);
      const ripe = s => {
        if (s.crop && s.growth >= 1) {
          ctx.globalAlpha = 0.4 + 0.6 * tw;
          ctx.fillText("✨", s.tx * T + 26 - camX, s.ty * T + 6 - camY);
          ctx.globalAlpha = 1;
        }
      };
      for (const k in plots) ripe(plots[k]);
      for (const k in beds) ripe(beds[k]);
    },

    // ---------- net-sync boundary ----------
    serialize() {
      return { plots, beds, trees, seeds };
    },
    deserialize(data) {
      if (!data) return;
      plots = data.plots || {};
      beds = data.beds || {};
      trees = data.trees || [];
      seeds = data.seeds || {};
      BED_TILES.forEach(([tx, ty]) => { if (!beds[tx + "," + ty]) beds[tx + "," + ty] = newSlot(tx, ty); });
    },
    till, plant, water, harvest, buySeed, plantTree, pickFruit,
    remoteAction(name, args) {
      const fn = DH.garden[name];
      return typeof fn === "function" ? fn.apply(null, args || []) : false;
    },
  };
})();
