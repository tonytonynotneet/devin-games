/* dream-home craft module — DIY workbench, customization, kitchen, stamina.
   Spec IDs: D-1 recipe collection (message bottles via DH.finds, balloon drops,
   gifts), D-2 workbench crafting, D-3 customize/remake color variants,
   D-4 kitchen cooking (dishes are placeable AND edible), D-5 fruit stamina.

   Contract with game.js (same as garden.js / forage.js):
     DH.craft.init(state) / start(state) / update(dt,state)
     DH.craft.collectDraws(draws, camX, camY) / drawOverlay(ctx,camX,camY,state)
     DH.craft.interactables(p) -> [{label,x,y,action}]
     DH.craft.serialize()/deserialize(d)/remoteAction(name,args)/offline(offMin)

   Fixtures: a workbench in the yard just south of the garden (19,10), and a
   kitchen counter inside the house (5,3)-(6,3). Both are world.blocked and
   usable by koto & zuza. Station interactables are tile-whitelist gated so
   they never shadow garden/court/sauna actions on neighboring tiles.
   Recipe cards ("recipe-<id>" items granted by finds.js bottles/parcels) are
   learned from the Recipe book at either station. Material keys may be an
   item id, "@veg" (any veggie), "@cat:<cat>" (any item of that catalog
   category) or "@any:a,b" — resolved live so later-loading modules' items
   (fish from critters.js, flowers from forage.js) qualify. Guests run the
   same UI; actions route through remoteAction ("craft.<fn>") like tools.js.
   Power moves (smash rock, uproot/replant tree) are opt-in via a workbench
   toggle so they never shadow forage.js's own rock/tree interactions.
*/
(function () {
  const DH = (window.DH = window.DH || {});
  const T = 32;
  const II = DH.items;
  const cap = s => s[0].toUpperCase() + s.slice(1);

  // ---------- item defs (registered at file eval; idempotent) ----------
  // veggies — pocket form of garden crops (garden may grant the same ids)
  II.def("carrot",  { name: "Carrot",  ico: "🥕", cat: "food", price: 14 });
  II.def("potato",  { name: "Potato",  ico: "🥔", cat: "food", price: 14 });
  II.def("tomato",  { name: "Tomato",  ico: "🍅", cat: "food", price: 18 });
  II.def("pumpkin", { name: "Pumpkin", ico: "🎃", cat: "food", price: 40 });
  // DIY results — ids match finds.js recipe cards ("recipe-<id>")
  II.def("wooden-chair", { name: "Wooden chair", ico: "🪑", cat: "furniture", price: 60 });
  II.def("log-bench",    { name: "Log bench",    ico: "🪵", cat: "furniture", price: 120 });
  II.def("fountain",     { name: "Fountain",     ico: "⛲", cat: "furniture", price: 520 });
  II.def("hammock",      { name: "Hammock",      ico: "🏖️", cat: "furniture", price: 200 });
  II.def("lantern",      { name: "Lantern",      ico: "🏮", cat: "furniture", price: 180 });
  II.def("birdbath",     { name: "Birdbath",     ico: "🛁", cat: "furniture", price: 220 });
  II.def("swing",        { name: "Swing",        ico: "🛝", cat: "furniture", price: 260 });
  II.def("flower-cart",  { name: "Flower cart",  ico: "🌻", cat: "furniture", price: 280 });
  II.def("stone-table",  { name: "Stone table",  ico: "🪨", cat: "furniture", price: 300 });
  II.def("potted-tree",  { name: "Potted tree",  ico: "🪴", cat: "furniture", price: 0, stack: 10 });
  if (!II.get("axe")) II.def("axe", { name: "Axe", ico: "🪓", cat: "tool", price: 50, stack: 1 });
  // dishes — edible (cat food) AND placeable
  II.def("soup",       { name: "Veggie soup",  ico: "🍲", cat: "food", price: 160 });
  II.def("salad",      { name: "Garden salad", ico: "🥗", cat: "food", price: 140 });
  II.def("fish-grill", { name: "Grilled fish", ico: "🍢", cat: "food", price: 260 });
  II.def("apple-pie",  { name: "Apple pie",    ico: "🥧", cat: "food", price: 320 });

  // veggies that count for "@veg" — cat food only, no trade goods (turnips
  // are an investment item in econ.js — deliberately excluded)
  const VEG = ["carrot", "potato", "tomato", "pumpkin",
               "mushroom", "shroom-brown", "shroom-red", "shroom-truffle"];
  const PANTRY = ["carrot", "potato", "tomato", "pumpkin"];
  const DISHES = ["soup", "salad", "fish-grill", "apple-pie"];

  // ---------- recipe catalog ----------
  // materials keys: item id | "@veg" | "@cat:<cat>" | "@any:a,b,c"
  // tool:{id,tier} grants a tools.js tool when tools are present (else the item)
  const RECIPES = {
    // — workbench (DIY) —
    "wooden-chair": { name: "Wooden chair", result: "wooden-chair", station: "workbench",
                      materials: { wood: 3 } },
    "axe-normal":   { name: "Sturdy axe",   result: "axe",          station: "workbench",
                      materials: { wood: 2, iron: 3 }, tool: { id: "axe", tier: "normal" } },
    "log-bench":    { name: "Log bench",    result: "log-bench",    station: "workbench",
                      materials: { hardwood: 2, wood: 2 } },
    "fountain":     { name: "Fountain",     result: "fountain",     station: "workbench",
                      materials: { stone: 5, clay: 2 } },
    "hammock":      { name: "Hammock",      result: "hammock",      station: "workbench",
                      materials: { softwood: 3, weed: 3 } },
    "lantern":      { name: "Lantern",      result: "lantern",      station: "workbench",
                      materials: { clay: 3 } },
    "birdbath":     { name: "Birdbath",     result: "birdbath",     station: "workbench",
                      materials: { stone: 4 } },
    "swing":        { name: "Swing",        result: "swing",        station: "workbench",
                      materials: { softwood: 4 } },
    "flower-cart":  { name: "Flower cart",  result: "flower-cart",  station: "workbench",
                      materials: { wood: 3, "@cat:flower": 2 } },
    "stone-table":  { name: "Stone table",  result: "stone-table",  station: "workbench",
                      materials: { stone: 3, clay: 1 } },
    // — kitchen (cooking) —
    "soup":         { name: "Veggie soup",  result: "soup",       station: "kitchen",
                      materials: { "@veg": 3 } },
    "salad":        { name: "Garden salad", result: "salad",      station: "kitchen",
                      materials: { "@veg": 2, "@cat:fruit": 1 } },
    "fish-grill":   { name: "Grilled fish", result: "fish-grill", station: "kitchen",
                      materials: { "@cat:fish": 2, "@veg": 1 } },
    "apple-pie":    { name: "Apple pie",    result: "apple-pie",  station: "kitchen",
                      materials: { apple: 3, "@veg": 1 } },
  };
  const STARTER = ["wooden-chair", "axe-normal", "soup", "salad", "fish-grill", "apple-pie"];

  // ---------- stations ----------
  // workbench: yard grass directly below the garden's south edge.
  // Approach is tile-whitelisted so it never shadows garden/court actions.
  const WB = { tx: 19, ty: 10, x: 19 * T + 16, y: 10 * T + 20 };
  const WB_TILES = new Set(["18,10", "20,10", "19,11"]);
  // kitchen counter: NW interior wall of the house, 2 tiles wide.
  const KIT = { tx: 5, ty: 3, x: 6 * T, y: 3 * T + 20 };
  const KIT_TILES = new Set(["4,3", "7,3", "4,4", "5,4", "6,4", "7,4"]);
  const KIT_BLOCK = ["5,3", "6,3"];
  const FIXTURE_TILES = ["19,10", "5,3", "6,3"];
  const COLORS = { red: "#d94f4f", blue: "#4f7fd9", green: "#54a854",
                   yellow: "#d9b44f", purple: "#9a6ad4", pink: "#e07fb0" };
  const NO_REMAKE = new Set(["furni-leaf", "potted-tree"]);
  const STAMINA_CAP = 5;
  const MATURE_AGE = 3 * 24 * 60; // matches forage's mature tree age

  // ---------- state (plain JSON only — save bus + net snapshots) ----------
  let gs = null, C = null;
  const S = {
    recipes: [],          // learned recipe ids
    stamina: 0,           // own energy pips (cap STAMINA_CAP)
    placed: [],           // [{uid,id,tx,ty}] served dishes
    power: false,         // power-move mode (workbench toggle)
    nextUid: 1,
  };
  let fx = [];            // transient timestamp FX — not serialized

  const rnd = (a, b) => a + Math.random() * (b - a);
  const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
  const isGuest = () => !!(DH.net && DH.net.online && DH.net.role === "guest");
  const log = d => { if (DH.alog) DH.alog.add("craft", d); };
  const known = id => S.recipes.includes(id);
  const fstate = () => (DH.forage && DH.forage._S) || null;
  const onTile = (p, set) => set.has(Math.floor(p.x / T) + "," + Math.floor(p.y / T));

  // ---------- fx ----------
  function puff(x, y, n, col) {
    const now = Date.now();
    for (let i = 0; i < n && fx.length < 80; i++)
      fx.push({ k: "puff", x: x + rnd(-10, 10), y: y + rnd(-8, 2), vx: rnd(-18, 18), vy: -22 - rnd(0, 16),
                until: now + 560, ttl: 0.56, col: col || "#efe4c8" });
  }
  function sparks(x, y, n) {
    const now = Date.now();
    for (let i = 0; i < n && fx.length < 80; i++)
      fx.push({ k: "star", x: x + rnd(-12, 12), y: y - rnd(0, 18), vx: 0, vy: -14,
                until: now + rnd(400, 800), ttl: 0.8, col: "#fff3a6" });
  }
  function steam(x, y, n) {
    const now = Date.now();
    for (let i = 0; i < n && fx.length < 80; i++)
      fx.push({ k: "steam", x: x + rnd(-12, 12), y: y - rnd(0, 10), vx: rnd(-4, 4), vy: -20 - rnd(0, 10),
                until: now + rnd(500, 900), ttl: 0.9, col: "#e8f0f5" });
  }

  // ---------- stamina (D-5): unified across craft/tools/forage stores ----------
  function stamina() {
    let m = S.stamina;
    if (DH.tools && typeof DH.tools.stamina === "function") m = Math.max(m, DH.tools.stamina());
    const f = fstate();
    if (f) m = Math.max(m, f.stamina || 0);
    return m;
  }
  function addStamina(n) {
    S.stamina = Math.min(STAMINA_CAP, S.stamina + n);
    if (gs) gs.stamina = Math.min(10, (gs.stamina || 0) + n);        // tools' store
    const f = fstate();
    if (f) f.stamina = Math.min(5, (f.stamina || 0) + n);           // forage's store
  }
  function useStamina() {
    if (stamina() < 1) return false;
    if (S.stamina > 0) S.stamina--;
    if (gs && gs.stamina > 0) gs.stamina--;
    const f = fstate();
    if (f && f.stamina > 0) f.stamina--;
    return true;
  }

  // ---------- material resolution ----------
  function matIds(key) {
    if (key === "@veg") return VEG;
    if (key.startsWith("@cat:")) {
      const c = key.slice(5);
      return Object.values(II.defs).filter(d => d.cat === c).map(d => d.id);
    }
    if (key.startsWith("@any:")) return key.slice(5).split(",").filter(Boolean);
    return [key];
  }
  function matHave(key) {
    if (key[0] === "@") return matIds(key).reduce((s, id) => s + DH.inv.count(id), 0);
    return DH.inv.count(key);
  }
  function matTake(key, n) {
    let left = n;
    for (const id of matIds(key)) {
      while (left > 0 && DH.inv.count(id) > 0) { DH.inv.remove(id, 1); left--; }
      if (!left) break;
    }
    return n - left;
  }
  function matLabel(key) {
    if (key === "@veg") return "veggies";
    if (key.startsWith("@cat:")) return key.slice(5);
    if (key.startsWith("@any:")) return matIds(key).map(id => (II.get(id) || { name: id }).name).join("/");
    const d = II.get(key);
    return d ? `${d.ico} ${d.name}` : key;
  }
  function matsText(r) {
    return Object.entries(r.materials)
      .map(([k, n]) => `${matLabel(k)} ${matHave(k)}/${n}`)
      .join(" · ");
  }
  function canCraft(r) {
    for (const k in r.materials) if (matHave(k) < r.materials[k]) return false;
    return true;
  }
  // would a new unit of `id` fit in pockets? (open stack or free slot)
  function canAdd(id) {
    const d = II.get(id), stack = (d && d.stack) || 20;
    return DH.inv.list().some(s => s.id === id && s.n < stack) ||
           DH.inv.list().length < DH.inv.cap();
  }

  // ---------- guest-safe dispatch (tools.js pattern) ----------
  function act(name, ...args) {
    if (isGuest()) { DH.net.guestAction("craft." + name, args); return undefined; }
    const fn = API[name];
    return typeof fn === "function" ? fn(...args) : false;
  }

  // ---------- actions (named + remote-callable) ----------
  const API = {
    // D-1: learn a recipe from a "recipe-<id>" card in pockets (bottles/parcels)
    learnCard(itemId) {
      const rid = String(itemId || "").replace(/^recipe-/, "");
      const r = RECIPES[rid];
      if (!String(itemId || "").startsWith("recipe-") || !r) { DH.toast("That card is unreadable…"); return false; }
      if (!DH.inv.count(itemId)) return false;
      if (known(rid)) { DH.toast(`Already know ${r.name} — the spare card can be sold`); return false; }
      DH.inv.remove(itemId, 1);
      S.recipes.push(rid);
      sparks(WB.x, WB.y - 20, 6);
      DH.toast(`📖 Learned a recipe: ${r.name}! ${II.get(r.result).ico} (${r.station})`, 2800);
      log("learn:" + rid);
      return true;
    },

    // D-1: gifts — learn a recipe directly (villagers/balloons/tests can grant)
    giftRecipe(id) {
      const r = RECIPES[id];
      if (!r) return false;
      if (known(id)) { DH.toast(`You already know ${r.name}`); return false; }
      S.recipes.push(id);
      DH.toast(`💝 New recipe: ${r.name}! ${II.get(r.result).ico}`, 2600);
      log("gift:" + id);
      return true;
    },

    // D-2 workbench craft + D-4 kitchen cook — one flow, gated by station recipes
    make(rid) {
      const r = RECIPES[rid];
      if (!r || !known(rid)) return false;
      const toolGrant = r.tool && DH.tools && typeof DH.tools.grant === "function";
      if (!toolGrant && !canAdd(r.result)) { DH.toast("Pockets full! 🎒"); return false; }
      if (!canCraft(r)) { DH.toast("Missing materials 🪵"); return false; }
      for (const k in r.materials) matTake(k, r.materials[k]);
      if (toolGrant) {
        DH.tools.grant(r.tool.id, r.tool.tier);
      } else if (DH.inv.add(r.result, 1) <= 0) {
        DH.toast("Pockets full! 🎒"); return false;   // unreachable after canAdd, stays safe
      }
      const d = II.get(r.result);
      if (r.station === "kitchen") { steam(KIT.x, KIT.y - 12, 6); puff(KIT.x, KIT.y - 6, 4); }
      else { sparks(WB.x, WB.y - 16, 7); puff(WB.x, WB.y - 4, 5, "#d8b060"); }
      DH.toast(`${r.station === "kitchen" ? "🍳 Cooked" : "🔨 Crafted"} ${d.name}! ${d.ico}`, 2400);
      gs.happiness += r.station === "kitchen" ? 2 : 3;
      log((r.station === "kitchen" ? "cook:" : "craft:") + rid);
      return true;
    },

    // D-3: recolor a furniture item in pockets into a "<id>~<color>" variant
    remake(id, col) {
      const base = II.get(id);
      if (!base || base.cat !== "furniture" || id.includes("~") ||
          NO_REMAKE.has(id) || !COLORS[col] || !DH.inv.count(id)) return false;
      const vid = id + "~" + col;
      if (!II.get(vid))
        II.def(vid, { name: `${cap(col)} ${base.name}`, ico: base.ico, cat: "furniture",
                      price: (base.price || 0) + 15 });
      if (!canAdd(vid)) { DH.toast("Pockets full! 🎒"); return false; }
      DH.inv.remove(id, 1);
      if (DH.inv.add(vid, 1) <= 0) { DH.inv.add(id, 1); DH.toast("Pockets full! 🎒"); return false; }
      sparks(WB.x, WB.y - 16, 6);
      DH.toast(`🎨 Remade into ${II.get(vid).name}!`, 2400);
      gs.happiness += 1;
      log("remake:" + vid);
      return true;
    },

    // D-5: eat a dish/food/fruit → stamina pips (+2 for cooked dishes)
    eatItem(id) {
      const d = II.get(id);
      if (!d || (d.cat !== "food" && d.cat !== "fruit")) return false;
      if (!DH.inv.remove(id, 1)) return false;
      const pips = DISHES.includes(id) ? 2 : 1;
      addStamina(pips);
      DH.toast(`🍴 Yummy ${d.name}! +${pips} energy (×${stamina()}) — power moves at the workbench`, 2800);
      gs.happiness += 1;
      log("eat:" + id);
      return true;
    },

    // pantry: buy a veggie for coins (garden crops sell as coins today; this
    // is the counter-side produce crate so cooking works from day one)
    buyVeg(id) {
      const d = II.get(id);
      if (!d || !VEG.includes(id)) return false;
      const cost = Math.ceil(d.price * 1.6);
      if (gs.coins < cost) { DH.toast("Not enough bells 🪙"); return false; }
      if (!canAdd(id)) { DH.toast("Pockets full! 🎒"); return false; }
      gs.coins -= cost;
      DH.inv.add(id, 1);
      steam(KIT.x, KIT.y - 8, 3);
      DH.toast(`${d.ico} ${d.name} −🪙${cost}`);
      log("buyveg:" + id);
      return true;
    },

    // D-4: serve a dish onto the tile in front of the player (or the counter)
    placeDish(id, tx, ty) {
      const W = DH.world;
      if (!DISHES.includes(id) || !DH.inv.count(id)) return false;
      const zone = W.zone(tx, ty);
      const t = W.tileAt(tx, ty);
      const counter = KIT_BLOCK.includes(tx + "," + ty);
      if (!counter &&
          ((zone !== "house" && zone !== "yard") ||
           !(t === W.FLOOR || t === W.GRASS || t === W.PATH) || W.isBlocked(tx, ty)))
        return false;
      if (S.placed.some(d => d.tx === tx && d.ty === ty)) return false;
      DH.inv.remove(id, 1);
      S.placed.push({ uid: S.nextUid++, id, tx, ty });
      steam(tx * T + 16, ty * T + 8, 4);
      DH.toast(`🍽️ Served ${II.get(id).name}!`);
      log("serve:" + id);
      return true;
    },
    eatDish(uid) {
      const i = S.placed.findIndex(d => d.uid === uid);
      if (i < 0) return false;
      const d = S.placed[i];
      S.placed.splice(i, 1);
      addStamina(2);
      gs.happiness += 2;
      steam(d.tx * T + 16, d.ty * T + 8, 3);
      DH.toast(`🍴 Shared the ${II.get(d.id).name}! +2 energy (×${stamina()})`);
      log("eat-served:" + d.id);
      return true;
    },
    pickupDish(uid) {
      const i = S.placed.findIndex(d => d.uid === uid);
      if (i < 0) return false;
      const d = S.placed[i];
      if (DH.inv.add(d.id, 1) <= 0) { DH.toast("Pockets full! 🎒"); return false; }
      S.placed.splice(i, 1);
      DH.toast(`Picked up ${II.get(d.id).name}`);
      return true;
    },

    // D-5 power moves (opt-in via the workbench toggle)
    power(on) {
      S.power = on !== false;
      DH.toast(S.power ? "Power moves ON — smack a rock or uproot a tree!" : "Power moves off", 2400);
      return true;
    },
    smashRock(tx, ty) {
      const F = fstate();
      if (!F || stamina() < 1) return false;
      const i = F.rocks.findIndex(r => r.tx === tx && r.ty === ty);
      if (i < 0) return false;
      useStamina();
      F.rocks.splice(i, 1);
      const cx = tx * T + 16, cy = ty * T + 14;
      puff(cx, cy, 8, "#9aa3ad"); sparks(cx, cy - 4, 6);
      const got = [];
      if (DH.inv.add("stone", 2)) got.push("🪨×2");
      if (DH.inv.add("iron", 1)) got.push("⛓️×1");
      if (DH.inv.add("clay", 1)) got.push("🧱×1");
      DH.toast(`💥 Smashed the rock! ${got.join(" ") || "(pockets full)"} · energy ×${stamina()} left`);
      gs.happiness += 2;
      log("smash-rock");
      return true;
    },
    uprootTree(tx, ty) {
      const F = fstate();
      if (!F || stamina() < 1) return false;
      const i = F.trees.findIndex(t => t.tx === tx && t.ty === ty);
      if (i < 0) return false;
      const t = F.trees[i];
      const isStump = t.stump >= 0;
      if (!isStump && !canAdd("potted-tree")) { DH.toast("Pockets full! 🎒"); return false; }
      useStamina();
      F.trees.splice(i, 1);
      DH.world.blocked.delete(tx + "," + ty);
      const cx = tx * T + 16, cy = ty * T + 22;
      puff(cx, cy, 8); sparks(cx, cy - 8, 5);
      if (isStump) {
        DH.inv.add("wood", 1);
        DH.toast(`Dug out the stump! +1 🪵 · energy ×${stamina()} left`);
      } else {
        DH.inv.add("potted-tree", 1);
        DH.toast(`🌳 Uprooted the tree! Replant it while power moves are on · energy ×${stamina()} left`, 2800);
      }
      gs.happiness += 1;
      log("uproot");
      return true;
    },
    plantPotted(tx, ty) {
      const F = fstate(), W = DH.world;
      if (!F || !DH.inv.count("potted-tree")) return false;
      if (W.tileAt(tx, ty) !== W.GRASS || W.zone(tx, ty) !== "yard" || W.isBlocked(tx, ty)) return false;
      if (F.trees.some(t => t.tx === tx && t.ty === ty) || F.rocks.some(r => r.tx === tx && r.ty === ty) ||
          S.placed.some(d => d.tx === tx && d.ty === ty)) return false;
      DH.inv.remove("potted-tree", 1);
      F.trees.push({ tx, ty, kind: "apple", age: MATURE_AGE, fruitReady: false,
                     shakeDay: -1, chop: 0, cd: 0, stump: -1 });
      DH.world.blocked.add(tx + "," + ty);
      sparks(tx * T + 16, ty * T + 12, 6);
      DH.toast("🌳 Tree replanted — it'll settle right in!");
      log("replant");
      return true;
    },
  };

  // ---------- menus ----------
  function recipeRow(rid, back) {
    const r = RECIPES[rid], d = II.get(r.result);
    const ok = known(rid) && canCraft(r);
    return {
      ico: d ? d.ico : "📦",
      label: `${r.name} <small>${matsText(r)}</small>`,
      disabled: !ok,
      cb: () => { act("make", rid); back && back(); },
    };
  }
  function openCraftMenu(back) {
    const rows = Object.keys(RECIPES)
      .filter(id => RECIPES[id].station === "workbench" && known(id))
      .map(id => recipeRow(id, back));
    if (!rows.length)
      rows.push({ ico: "📖", label: "No DIY recipes yet — find recipe cards in bottles", disabled: true });
    rows.push({ ico: "↩️", label: "Back", cb: back });
    DH.menu.open("🔨 Craft DIY", rows);
  }
  function openCookMenu(back) {
    const rows = Object.keys(RECIPES)
      .filter(id => RECIPES[id].station === "kitchen" && known(id))
      .map(id => recipeRow(id, back));
    if (!rows.length)
      rows.push({ ico: "📖", label: "No dishes known yet", disabled: true });
    rows.push({ ico: "↩️", label: "Back", cb: back });
    DH.menu.open("🍳 Cook", rows);
  }
  function openPantry(back) {
    const rows = PANTRY.map(id => {
      const d = II.get(id), cost = Math.ceil(d.price * 1.6);
      return {
        ico: d.ico, label: `${d.name}`, cost,
        disabled: gs.coins < cost,
        cb: () => { act("buyVeg", id); openPantry(back); },
      };
    });
    rows.push({ ico: "↩️", label: "Back", cb: back });
    DH.menu.open("🥬 Pantry", rows);
  }
  function openRemakeMenu(back) {
    const seen = new Set();
    const rows = [];
    for (const s of DH.inv.list()) {
      const d = II.get(s.id);
      if (!d || d.cat !== "furniture" || s.id.includes("~") || NO_REMAKE.has(s.id) || seen.has(s.id)) continue;
      seen.add(s.id);
      rows.push({
        ico: d.ico, label: `${d.name} ×${DH.inv.count(s.id)}`,
        cb: () => openRemakeColor(s.id, back),
      });
    }
    if (!rows.length)
      rows.push({ ico: "🎨", label: "No furniture in pockets to customize", disabled: true });
    rows.push({ ico: "↩️", label: "Back", cb: back });
    DH.menu.open("🎨 Customize", rows);
  }
  function openRemakeColor(id, back) {
    const d = II.get(id);
    const rows = Object.keys(COLORS).map(col => ({
      ico: d.ico,
      label: `<span style="color:${COLORS[col]}">●</span> ${cap(col)} ${d.name}`,
      cb: () => { act("remake", id, col); back && back(); },
    }));
    rows.push({ ico: "↩️", label: "Back", cb: () => openRemakeMenu(back) });
    DH.menu.open(`🎨 Remake ${d.name}`, rows);
  }
  function openServeMenu(back, p) {
    const rows = [];
    for (const id of DISHES) {
      const n = DH.inv.count(id);
      if (!n) continue;
      rows.push({
        ico: II.get(id).ico, label: `${II.get(id).name} ×${n}`,
        cb: () => {
          const DIRV = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
          const v = (p && DIRV[p.dir]) || [0, 0];
          const tx = Math.floor(((p ? p.x : KIT.x) + v[0] * 26) / T);
          const ty = Math.floor(((p ? p.y : KIT.y) + v[1] * 26) / T);
          if (!act("placeDish", id, tx, ty)) DH.toast("Can't set it down there ☹️");
        },
      });
    }
    if (!rows.length)
      rows.push({ ico: "🍽️", label: "No dishes in pockets — cook something!", disabled: true });
    rows.push({ ico: "↩️", label: "Back", cb: back });
    DH.menu.open("🍽️ Serve a dish", rows);
  }
  function openEatMenu(back) {
    const rows = [];
    const seen = new Set();
    for (const s of DH.inv.list()) {
      const d = II.get(s.id);
      if (!d || (d.cat !== "food" && d.cat !== "fruit") || seen.has(s.id)) continue;
      seen.add(s.id);
      const pips = DISHES.includes(s.id) ? 2 : 1;
      rows.push({
        ico: d.ico, label: `${d.name} ×${DH.inv.count(s.id)} <small>+${pips}⚡</small>`,
        cb: () => act("eatItem", s.id),
      });
    }
    if (!rows.length)
      rows.push({ ico: "🍴", label: "Nothing tasty in pockets", disabled: true });
    rows.push({ ico: "↩️", label: "Back", cb: back });
    DH.menu.open(`🍴 Eat · energy ⚡${stamina()}`, rows);
  }
  function openRecipes(back) {
    const rows = [];
    // learnable recipe cards in pockets first (bottles/parcels)
    const seen = new Set();
    for (const s of DH.inv.list()) {
      if (!String(s.id).startsWith("recipe-") || seen.has(s.id)) continue;
      seen.add(s.id);
      const rid = s.id.slice(7), r = RECIPES[rid];
      rows.push({
        ico: "🧾",
        label: r ? `Learn: ${r.name} ${II.get(r.result).ico}` : `Read ${(II.get(s.id) || {}).name || s.id}`,
        disabled: !r || known(rid),
        cb: () => { act("learnCard", s.id); back && back(); },
      });
    }
    for (const rid of Object.keys(RECIPES)) {
      const r = RECIPES[rid], d = II.get(r.result);
      rows.push(known(rid)
        ? { ico: d.ico, label: `${r.name} <small>${r.station}</small>`, disabled: true }
        : { ico: "❔", label: `${r.name} <small>not learned — ${r.station}</small>`, disabled: true });
    }
    rows.push({ ico: "↩️", label: "Back", cb: back });
    DH.menu.open(`📖 Recipe book · ${S.recipes.length}/${Object.keys(RECIPES).length}`, rows);
  }
  function openBench(p) {
    DH.menu.open("🔨 Workbench", [
      { ico: "🔨", label: "Craft DIY", cb: () => openCraftMenu(() => openBench(p)) },
      { ico: "🎨", label: "Customize / Remake", cb: () => openRemakeMenu(() => openBench(p)) },
      { ico: "⚡", label: `Power moves: ${S.power ? "ON" : "OFF"} · energy ⚡${stamina()}`,
        cb: () => { act("power", !S.power); openBench(p); } },
      { ico: "🍽️", label: "Serve a dish", cb: () => openServeMenu(() => openBench(p), p) },
      { ico: "📖", label: "Recipe book", cb: () => openRecipes(() => openBench(p)) },
    ]);
  }
  function openKitchen(p) {
    DH.menu.open("🍳 Kitchen", [
      { ico: "🍳", label: "Cook", cb: () => openCookMenu(() => openKitchen(p)) },
      { ico: "🥬", label: "Pantry · buy veggies", cb: () => openPantry(() => openKitchen(p)) },
      { ico: "🍴", label: `Eat · energy ⚡${stamina()}`, cb: () => openEatMenu(() => openKitchen(p)) },
      { ico: "🍽️", label: "Serve a dish", cb: () => openServeMenu(() => openKitchen(p), p) },
      { ico: "📖", label: "Recipe book", cb: () => openRecipes(() => openKitchen(p)) },
    ]);
  }
  function openDish(d) {
    const item = II.get(d.id);
    DH.menu.open(`${item.ico} ${item.name}`, [
      { ico: "🍴", label: `Eat together · +2⚡`, cb: () => act("eatDish", d.uid) },
      { ico: "🎒", label: "Pick up", cb: () => act("pickupDish", d.uid) },
    ]);
  }

  // ---------- drawing ----------
  function drawWorkbench(ctx, px, py) {
    const R = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(px + x, py + y, w, h); };
    R(3, 12, 26, 6, "#a0733f");                 // top plank
    R(3, 12, 26, 2, "#c8975c");                 // lit edge
    R(5, 18, 4, 12, "#7a5527"); R(23, 18, 4, 12, "#7a5527"); // legs
    R(8, 21, 16, 3, "#8a5f30");                 // cross bar
    R(6, 8, 8, 4, "#d9d9e2");                   // metal vice
    R(9, 6, 3, 3, "#b9c0c7");
    // tools on top: hammer + little plank
    R(17, 7, 7, 3, "#8a5a3b"); R(22, 5, 3, 6, "#5a5a66");
    R(14, 9, 6, 2, "#e8d9a0");
    // saw hanging on the side
    R(26, 14, 4, 9, "#cdd7e2"); R(26, 14, 4, 2, "#6e4a2a");
    ctx.font = "10px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("🔨", px + 16, py + 1 + Math.sin(Date.now() / 700) * 1.5);
  }
  function drawKitchen(ctx, px, py) {
    const R = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(px + x, py + y, w, h); };
    // 2-tile counter: cabinets below, worktop above
    R(2, 12, 60, 18, "#8a5a3b");
    R(2, 12, 60, 4, "#e8e0d0");                  // counter top
    R(4, 18, 24, 10, "#a06a42"); R(36, 18, 24, 10, "#a06a42");
    R(14, 21, 4, 3, "#e8c860"); R(46, 21, 4, 3, "#e8c860"); // handles
    R(32, 16, 2, 14, "#7a4a2a");                 // seam
    // sink + pot + pan on top
    R(6, 9, 12, 4, "#9aa5b3"); R(7, 10, 10, 2, "#7ec8e3");
    R(24, 7, 10, 6, "#4a4a55"); R(26, 5, 6, 2, "#3a3a44");
    R(44, 8, 10, 5, "#22222a"); R(54, 9, 5, 2, "#22222a");   // frying pan + handle
    // steam wisp above the pot
    const w = Math.sin(Date.now() / 500) * 2;
    ctx.fillStyle = "rgba(232,240,245,0.55)";
    ctx.fillRect(px + 27 + w, py - 1, 3, 3); ctx.fillRect(px + 30 - w, py - 6, 3, 3);
    ctx.font = "10px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("🍳", px + 32, py + 1);
  }
  function drawDish(ctx, px, py, d) {
    const cx = px + 16, cy = py + 20;
    ctx.fillStyle = "#00000022";
    ctx.beginPath(); ctx.ellipse(cx, cy + 4, 10, 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#f2f2f5";                                  // plate
    ctx.beginPath(); ctx.ellipse(cx, cy, 10, 4.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#d9d9e2";
    ctx.beginPath(); ctx.ellipse(cx, cy + 1, 8, 3, 0, 0, Math.PI * 2); ctx.fill();
    const food = { soup: "#e8a13c", salad: "#6fae3f", "fish-grill": "#d9894f", "apple-pie": "#e0a050" }[d.id] || "#c9854e";
    ctx.fillStyle = food;
    ctx.beginPath(); ctx.ellipse(cx, cy - 1, 6, 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ffffff99"; ctx.fillRect(cx - 2, cy - 3, 3, 1); // gloss
    const w = Math.sin(Date.now() / 460 + d.uid) * 1.5;
    ctx.fillStyle = "rgba(232,240,245,0.6)";
    ctx.fillRect(cx - 1 + w, cy - 8, 2, 2); ctx.fillRect(cx + 1 - w, cy - 12, 2, 2);
  }
  function drawFx(ctx, f, camX, camY) {
    const now = Date.now();
    const life = (f.until - now) / (f.ttl * 1000);
    if (life <= 0) return;
    const t = 1 - life;
    const x = f.x + f.vx * t * f.ttl - camX, y = f.y + f.vy * t * f.ttl - camY;
    ctx.globalAlpha = Math.max(0, life);
    if (f.k === "star") {
      ctx.fillStyle = f.col;
      ctx.fillRect(x - 1, y - 3, 2, 7); ctx.fillRect(x - 3, y - 1, 7, 2);
    } else if (f.k === "steam") {
      ctx.fillStyle = f.col;
      ctx.beginPath(); ctx.arc(x, y, 2.5 + t * 3, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = f.col;
      ctx.fillRect(x - 2, y - 2, 4 + t * 3, 4 + t * 3);
    }
    ctx.globalAlpha = 1;
  }

  // ---------- module contract ----------
  const M = (DH.craft = {
    authority: true,
    _state: S, // exposed for tests/other modules (e.g. villagers gifting recipes)
    RECIPES,

    stamina, useStamina,                       // D-5 API for other modules
    learned: () => S.recipes.slice(),
    recipeFor: id => RECIPES[id] || null,

    init(state) {
      gs = state;
      M.authority = !(DH.net && DH.net.online && DH.net.role === "guest");
      C = document.getElementById("cv").getContext("2d");
      FIXTURE_TILES.forEach(k => DH.world.blocked.add(k));
    },

    start(state) {
      gs = state;
      M.authority = !(DH.net && DH.net.online && DH.net.role === "guest");
      FIXTURE_TILES.forEach(k => DH.world.blocked.add(k));
      if (!S.seeded) {
        S.seeded = true;
        STARTER.forEach(id => { if (!S.recipes.includes(id)) S.recipes.push(id); });
      }
    },

    update(dt, state) { gs = state; },  // craft sim is event-driven; FX tick in drawOverlay

    interactables(p) {
      if (!gs || !gs.running) return [];
      const out = [];
      const near = (x, y, r) => dist2(p.x, p.y, x, y) < r * r;
      if (onTile(p, WB_TILES) && near(WB.x, WB.y, 58))
        out.push({ pri: 1, label: "🔨 Workbench", x: WB.x, y: WB.y, action: () => openBench(p) });
      if (onTile(p, KIT_TILES))
        out.push({ pri: 1, label: "🍳 Kitchen", x: KIT.x, y: KIT.y - 16, action: () => openKitchen(p) });
      for (const d of S.placed) {
        const x = d.tx * T + 16, y = d.ty * T + 20;
        if (near(x, y, 40)) {
          const item = II.get(d.id);
          out.push({ pri: 0, label: `${item.ico} ${item.name}`, x, y, action: () => openDish(d) });
        }
      }
      // D-5 power moves — opt-in toggle so they never shadow forage's own actions
      const F = fstate();
      if (S.power && F) {
        if (stamina() >= 1) {
          for (const r of F.rocks) {
            const x = r.tx * T + 16, y = r.ty * T + 14;
            if (near(x, y, 50)) out.push({ pri: 0, label: "💥 Smash rock (1 energy)", x, y, action: () => act("smashRock", r.tx, r.ty) });
          }
          for (const t of F.trees) {
            const x = t.tx * T + 16, y = t.ty * T + 22;
            if (near(x, y, 50)) out.push({ pri: 0, label: t.stump >= 0 ? "🌳 Dig up stump (1 energy)" : "🌳 Uproot tree (1 energy)", x, y, action: () => act("uprootTree", t.tx, t.ty) });
          }
        }
        if (DH.inv.count("potted-tree") > 0) {
          const W = DH.world;
          const tx = Math.floor(p.x / T), ty = Math.floor(p.y / T);
          if (W.tileAt(tx, ty) === W.GRASS && W.zone(tx, ty) === "yard" && !W.isBlocked(tx, ty) &&
              !F.trees.some(t => t.tx === tx && t.ty === ty) && !F.rocks.some(r => r.tx === tx && r.ty === ty) &&
              !S.placed.some(d => d.tx === tx && d.ty === ty))
            out.push({ pri: 1, label: "🌱 Plant tree", x: tx * T + 16, y: ty * T + 16, action: () => act("plantPotted", tx, ty) });
        }
      }
      out.sort((a, b) => a.pri - b.pri);
      return out;
    },

    collectDraws(draws, camX, camY) {
      if (!C) C = document.getElementById("cv").getContext("2d");
      draws.push({ y: WB.ty * T + T, fn: () => drawWorkbench(C, WB.tx * T - camX, WB.ty * T - camY) });
      draws.push({ y: KIT.ty * T + T, fn: () => drawKitchen(C, KIT.tx * T - camX, KIT.ty * T - camY) });
      for (const d of S.placed)
        draws.push({ y: d.ty * T + T + 1, fn: () => drawDish(C, d.tx * T - camX, d.ty * T - camY, d) });
    },

    drawOverlay(ctx, camX, camY, state) {
      if (ctx) C = ctx;
      for (const f of fx) drawFx(ctx, f, camX, camY);
      fx = fx.filter(f => f.until > Date.now());
      // energy pips over powered players (shared pool across both)
      const st = stamina();
      if (st > 0 && state && state.players) {
        ctx.font = "bold 10px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        for (const p of state.players) {
          ctx.fillStyle = "#14142ad0";
          ctx.beginPath(); ctx.arc(p.x - camX - 15, p.y - camY - 54, 8, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = "#ffd76b";
          ctx.fillText("⚡" + st, p.x - camX - 15, p.y - camY - 54 + 0.5);
        }
      }
    },

    // ---------- sync boundary ----------
    serialize() {
      return JSON.parse(JSON.stringify({
        recipes: S.recipes, stamina: S.stamina, placed: S.placed,
        power: S.power, seeded: S.seeded, nextUid: S.nextUid,
      }));
    },
    deserialize(d) {
      if (!d) return;
      if (Array.isArray(d.recipes)) S.recipes = d.recipes.filter(id => RECIPES[id]);
      if (typeof d.stamina === "number") S.stamina = Math.min(STAMINA_CAP, d.stamina);
      if (Array.isArray(d.placed))
        S.placed = d.placed.filter(p => p && DISHES.includes(p.id) && p.tx >= 0 && p.ty >= 0);
      if (typeof d.power === "boolean") S.power = d.power;
      if (d.seeded) S.seeded = true;
      else if (!S.recipes.length) {
        S.seeded = true;
        STARTER.forEach(id => { if (!S.recipes.includes(id)) S.recipes.push(id); });
      }
      if (typeof d.nextUid === "number") S.nextUid = d.nextUid;
    },
    remoteAction(name, args) {
      const n = String(name || "").startsWith("craft.") ? name.slice(6) : name;
      const fn = API[n];
      return typeof fn === "function" ? fn.apply(null, args || []) : false;
    },
    offline() { return []; }, // nothing spoils or crafts while away
  });
  Object.assign(M, API); // DH.craft.make(...), eatItem, smashRock, ... for tests + remote use
})();

DH.register("craft", DH.craft);
