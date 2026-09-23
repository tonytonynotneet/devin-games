/* dream-home fashion module — Able Sisters, dress-up, My Design, makeovers
   and couple looks (spec I-1..I-5).
   Contract with game.js (same as econ.js/animals.js):
     DH.fashion.init(state)         – called once at load
     DH.fashion.start(state)        – called when a run starts
     DH.fashion.drawGround(ctx,camX,camY,state)   – painted tiles
     DH.fashion.collectDraws(draws, camX, camY)   – kiosk/vanity/mannequin/flag
     DH.fashion.interactables(p)    – -> [{label,x,y,action}] for the action key
     DH.fashion.serialize()/deserialize(data)/remoteAction(name,args)

   I-1 Dress-up: equip slots {hat,top,acc}; wearables are cat 'wear' items with
   wear:{slot,pal,shape}; S.outfits={koto:{},zuza:{}} persists + net-syncs.
   I-2 Able Sisters kiosk in the yard (tiles 16-18,11): daily rotating stock of
   4 wearables + a mannequin wearing today's picks; vanity mirror beside it.
   I-3 My Design: 16x16 pixel editor overlay (8 colors, paint/erase/fill/clear)
   -> designs apply to a custom tee, a ground tile, the house flag, face paint.
   I-4 Makeover at the vanity: hairstyle (4), hair color (5), skin tone (3) for
   YOUR char (host=koto, guest=zuza; solo edits either via a who-submenu).
   I-5 Couple look: 3 coordinated presets equip both players for a small fee.

   Rendering trick: init wraps DH.sprites.drawPlayer so hats/tops/accessories
   (and non-default makeovers) draw inside the player sprite's own bob/idle
   space — correct depth-sorting for free (couple.js patching precedent).
   Net-sync boundary: all sim state is plain JSON (S). Guests never run
   update() — host snapshots arrive via deserialize(); guest UI opens locally
   through a hooked "fa_open" message and mutates via remoteAction("fashion.*").
   Nothing here requires a tool module — every action works tool-free.
*/
(function () {
  const DH = (window.DH = window.DH || {});
  const T = 32;
  const R = (ctx, x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
  const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
  const isGuest = () => !!(DH.net && DH.net.online && DH.net.role === "guest");
  const isHostNet = () => !!(DH.net && DH.net.online && DH.net.role === "host");
  const alog = (e, d) => { if (DH.alog) DH.alog.add(e, d); };
  const SHIRT = "#1c1c22";

  // ---------- wearables (registered at file eval; items.js loads first) ----------
  // wear:{slot:"hat"|"top"|"acc", pal:[main,accent], shape} — ids are w-*
  // prefixed because econ.js already owns cap/tee/scarf.
  const E = DH.items.def;
  const WEAR = (id, name, ico, slot, shape, pal, price) =>
    E(id, { name, ico, cat: "wear", price, wear: { slot, shape, pal } });
  // hats
  WEAR("w-cap-red",     "Red cap",      "🧢", "hat", "cap",       ["#e04848", "#a02828"], 80);
  WEAR("w-cap-blue",    "Blue cap",     "🧢", "hat", "cap",       ["#4a7ad0", "#2a4a90"], 80);
  WEAR("w-beanie",      "Cozy beanie",  "🧶", "hat", "beanie",    ["#e08040", "#b05828"], 90);
  WEAR("w-strawhat",    "Straw hat",    "👒", "hat", "straw",     ["#e0c060", "#a08430"], 110);
  WEAR("w-bow",         "Ribbon bow",   "🎀", "hat", "bow",       ["#e07ba0", "#b04070"], 70);
  WEAR("w-flowercrown", "Flower crown", "🌸", "hat", "flowercrown", ["#ff7fa5", "#5fae4e"], 120);
  WEAR("w-wizard",      "Wizard hat",   "🧙", "hat", "wizard",    ["#5b4a8a", "#ffd94d"], 150);
  WEAR("w-crown",       "Royal crown",  "👑", "hat", "crown",     ["#ffd94d", "#e04848"], 400);
  // tops
  WEAR("w-tee-red",     "Red tee",      "👕", "top", "tee",       ["#e04848", "#ffffff"], 60);
  WEAR("w-tee-mint",    "Mint tee",     "👕", "top", "tee",       ["#5bd08a", "#ffffff"], 60);
  WEAR("w-tee-rose",    "Rose tee",     "👕", "top", "tee",       ["#e07ba0", "#ffffff"], 60);
  WEAR("w-tee-sky",     "Sky tee",      "👕", "top", "tee",       ["#5b8ae0", "#ffffff"], 60);
  WEAR("w-dress",       "Sun dress",    "👗", "top", "dress",     ["#ffd94d", "#e04848"], 180);
  WEAR("w-hoodie",      "Cozy hoodie",  "🧥", "top", "hoodie",    ["#7a7a9a", "#4a4a6a"], 140);
  WEAR("w-sweater",     "Knit sweater", "🧶", "top", "sweater",   ["#c96a4a", "#ffd94d"], 120);
  WEAR("w-tee-custom",  "Custom tee",   "👕", "top", "custom",    ["#f4f0e8", "#c8c0d0"], 100);
  // accessories
  WEAR("w-glasses",     "Round glasses", "🤓", "acc", "glasses",   ["#3a2e3d"], 50);
  WEAR("w-sunglasses",  "Sunglasses",   "🕶️", "acc", "sunglasses", ["#1a1a22"], 80);
  WEAR("w-scarf",       "Wool scarf",   "🧣", "acc", "scarf",     ["#e04848", "#ffd94d"], 90);
  WEAR("w-bowtie",      "Bow tie",      "🎀", "acc", "bowtie",    ["#3a5a9a", "#f4f0e8"], 60);
  WEAR("w-facepaint",   "Face paint",   "🎨", "acc", "facepaint", ["#e07ba0"], 40);

  // daily stock pool — custom-tee/facepaint come from My Design, not the rack
  const STOCK_POOL = [
    "w-cap-red", "w-cap-blue", "w-beanie", "w-strawhat", "w-bow", "w-flowercrown",
    "w-wizard", "w-crown", "w-tee-red", "w-tee-mint", "w-tee-rose", "w-tee-sky",
    "w-dress", "w-hoodie", "w-sweater", "w-glasses", "w-sunglasses", "w-scarf",
    "w-bowtie",
  ];

  // ---------- world spots ----------
  const VANITY = { tx: 16, ty: 11 };                    // makeover mirror (blocked)
  const KIOSK = { tx: 17, ty: 11 };                     // tiles 17,11 + 18,11 (blocked)
  const MANNE = { tx: 18, ty: 12 };                     // display figure (blocked)
  const FLAG = { tx: 12, ty: 9 };                       // house wall, beside a window
  const KIOSK_PT = { x: 18 * T, y: 12 * T + 8, r: 46 };
  const VANITY_PT = { x: VANITY.tx * T + 16, y: 12 * T + 8, r: 38 };
  const MANNE_PT = { x: MANNE.tx * T + 16, y: 13 * T + 8, r: 38 };

  // ---------- looks ----------
  const HAIRSTYLES = ["bowl", "long", "bun", "spiky"];
  const HAIR_NAMES = { bowl: "Bowl cut", long: "Long & straight", bun: "Top bun", spiky: "Spiky" };
  const HAIRCS = [
    { c: "#241a24", hi: "#3a2e3d", n: "Black" },
    { c: "#4a2c14", hi: "#6a4526", n: "Brown" },
    { c: "#d8a03c", hi: "#f0c060", n: "Honey blond" },
    { c: "#e07ba0", hi: "#f0a8c8", n: "Pink" },
    { c: "#3a5a9a", hi: "#5a7ac0", n: "Blue" },
  ];
  const SKINS = [
    { m: "#f6d8b4", d: "#e0b890", n: "Light" },
    { m: "#f2c9a0", d: "#d9a878", n: "Warm" },
    { m: "#c98d5e", d: "#a06838", n: "Deep" },
  ];
  const DEF_LOOK = {
    koto: { hair: "bowl", hairC: 0, skin: 1 },
    zuza: { hair: "long", hairC: 1, skin: 1 },
  };

  // ---------- My Design palette ----------
  const PAL = ["#241a24", "#f4f0e8", "#e04848", "#e08a3c", "#ffd94d", "#5bd08a", "#5b8ae0", "#e07ba0"];
  const MAX_DESIGNS = 8, MAX_TILES = 24;

  // ---------- module state (plain JSON — save bus + net snapshots) ----------
  let gs = null;
  const S = {
    closet: [],                          // owned wearable ids
    outfits: { koto: {}, zuza: {} },     // char -> {hat?,top?,acc?} = {id,d?}
    looks: {},                           // char -> {hair,hairC,skin} (only when customized)
    designs: [],                         // [{name,cells:[256 x -1..7]}]
    paintTiles: [],                      // [{tx,ty,d}]
    flag: -1,                            // design index flying on the house
    seeded: false,                       // starter wardrobe granted
  };
  let ctxG = null;                       // captured draw ctx (collectDraws)
  const dcache = {};                     // design idx -> 16x16 offscreen canvas

  function getLook(char) { return S.looks[char] || DEF_LOOK[char] || DEF_LOOK.koto; }
  function customLook(char) {
    const l = S.looks[char], d = DEF_LOOK[char];
    return !!(l && d && (l.hair !== d.hair || l.hairC !== d.hairC || l.skin !== d.skin));
  }
  function outfitOf(char) {
    if (!S.outfits[char]) S.outfits[char] = {};
    return S.outfits[char];
  }
  function wearDef(o) { const d = o && DH.items.get(o.id); return d && d.wear ? d : null; }

  // ---------- daily stock (seeded by the real date, same trick as econ) ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function dateSeed() { const d = new Date(); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }
  function todayStock() {
    const r = mulberry32(dateSeed() + 7777), pool = STOCK_POOL.slice(), out = [];
    while (out.length < 4 && pool.length) out.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
    return out;
  }
  const buyCost = id => Math.ceil(((DH.items.get(id) || {}).price || 0) * 1.5);
  function addHappy(n) { if (gs) gs.happiness = Math.max(0, gs.happiness + n); }
  function closetAdd(id) { if (id && !S.closet.includes(id)) S.closet.push(id); }
  function playerOf(char) { return (gs && gs.players || []).find(p => p.char === char); }

  // ---------- design canvases ----------
  function designCanvas(i) {
    if (dcache[i]) return dcache[i];
    const d = S.designs[i];
    if (!d) return null;
    const c = document.createElement("canvas"); c.width = 16; c.height = 16;
    const x = c.getContext("2d");
    d.cells.forEach((v, k) => {
      if (v < 0 || !PAL[v]) return;
      x.fillStyle = PAL[v]; x.fillRect(k % 16, (k / 16) | 0, 1, 1);
    });
    dcache[i] = c;
    return c;
  }
  function clearDcache() { for (const k of Object.keys(dcache)) delete dcache[k]; }

  // ---------- mutations (named + remote-callable via "fashion.<fn>") ----------
  const API = {
    buyWear(id) { // Able Sisters daily rack
      const d = DH.items.get(id);
      if (!d || !d.wear || !gs) return false;
      const cost = buyCost(id);
      if (gs.coins < cost) { DH.toast("Not enough coins 🪙"); return false; }
      if (DH.inv.add(id, 1) <= 0) { DH.toast("Pockets are full! ☹️"); return false; }
      gs.coins -= cost;
      closetAdd(id);
      addHappy(cost >= 200 ? 2 : 1);
      alog("fashion_buy", id);
      DH.toast(`Bought ${d.name}! ${d.ico}`);
      return true;
    },
    equip(char, id, d) { // I-1 — d = design index for custom shapes
      const def = wearDef({ id });
      if (!def || !S.outfits || !(char in S.outfits)) return false;
      if (def.wear.shape !== "custom" && def.wear.shape !== "facepaint" && !S.closet.includes(id))
        closetAdd(id); // generous wardrobe: pocket items auto-register in the closet
      const slot = def.wear.slot, out = outfitOf(char);
      const same = out[slot] && out[slot].id === id && (out[slot].d ?? null) === (d ?? null);
      if (same) { delete out[slot]; DH.toast(`${char} took off ${def.name}`); }
      else {
        out[slot] = d != null ? { id, d } : { id };
        addHappy(0.5);
        DH.toast(`${char} put on ${def.name} ${def.ico}`);
      }
      alog("fashion_equip", `${char}:${id}`);
      return true;
    },
    unequip(char, slot) {
      const out = S.outfits && S.outfits[char];
      if (!out || !out[slot]) return false;
      delete out[slot];
      DH.toast(`${char} removed it`);
      return true;
    },
    setLook(char, part, val) { // I-4 makeover
      if (!(char in S.outfits)) return false;
      const l = Object.assign({}, DEF_LOOK[char], S.looks[char]);
      if (part === "hair" && HAIRSTYLES.includes(val)) l.hair = val;
      else if (part === "hairC" && HAIRCS[val]) l.hairC = val;
      else if (part === "skin" && SKINS[val]) l.skin = val;
      else return false;
      S.looks[char] = l;
      addHappy(0.5);
      alog("fashion_look", `${char}:${part}=${val}`);
      DH.toast(`${char} got a makeover! ✨`);
      return true;
    },
    saveDesign(cells, idx) { // I-3
      if (!Array.isArray(cells) || cells.length !== 256) return false;
      if (!cells.every(v => typeof v === "number" && v >= -1 && v < PAL.length)) return false;
      idx = idx | 0;
      if (idx >= 0 && idx < S.designs.length) {
        S.designs[idx].cells = cells.slice();
        clearDcache();
        DH.toast(`${S.designs[idx].name} updated! 🎨`);
      } else {
        if (S.designs.length >= MAX_DESIGNS) { DH.toast("Design book is full — delete one first ☹️"); return false; }
        S.designs.push({ name: `Design ${S.designs.length + 1}`, cells: cells.slice() });
        clearDcache();
        DH.toast("Design saved! 🎨");
      }
      addHappy(1);
      alog("fashion_design", S.designs.length);
      return true;
    },
    delDesign(idx) {
      idx = idx | 0;
      if (!S.designs[idx]) return false;
      S.designs.splice(idx, 1);
      clearDcache();
      S.paintTiles = S.paintTiles.filter(t => t.d !== idx)
        .map(t => (t.d > idx ? Object.assign(t, { d: t.d - 1 }) : t));
      if (S.flag === idx) S.flag = -1; else if (S.flag > idx) S.flag--;
      for (const ch of ["koto", "zuza"]) {
        const out = S.outfits[ch] || {};
        for (const slot of ["hat", "top", "acc"])
          if (out[slot] && out[slot].d != null) {
            if (out[slot].d === idx) delete out[slot];
            else if (out[slot].d > idx) out[slot].d--;
          }
      }
      DH.toast("Design deleted 🗑");
      return true;
    },
    applyDesign(char, kind, d) { // I-3 — wear a design / paint the world with it
      d = d | 0;
      if (!S.designs[d]) return false;
      if (kind === "tee") {
        closetAdd("w-tee-custom");
        return API.equip(char, "w-tee-custom", d);
      }
      if (kind === "face") {
        closetAdd("w-facepaint");
        return API.equip(char, "w-facepaint", d);
      }
      if (kind === "flag") {
        S.flag = d;
        DH.toast("New house flag! 🚩");
        alog("fashion_flag", d);
        return true;
      }
      if (kind === "tile") {
        const p = playerOf(char);
        if (!p) return false;
        const tx = Math.floor(p.x / T), ty = Math.floor(p.y / T);
        const old = S.paintTiles.find(t => t.tx === tx && t.ty === ty);
        if (old) old.d = d;
        else { S.paintTiles.push({ tx, ty, d }); if (S.paintTiles.length > MAX_TILES) S.paintTiles.shift(); }
        DH.toast("Painted the ground! 🎨");
        alog("fashion_tile", `${tx},${ty}`);
        return true;
      }
      return false;
    },
    coupleLook(i) { // I-5 — coordinated outfits for both, small fee
      i = i | 0;
      const pre = COUPLE_PRESETS[i];
      if (!pre || !gs) return false;
      if (gs.coins < pre.fee) { DH.toast(`Not enough coins — couple look costs 🪙${pre.fee}`); return false; }
      gs.coins -= pre.fee;
      const set = pre.build(gs);
      for (const ch of ["koto", "zuza"]) {
        for (const slot of ["hat", "top", "acc"]) {
          const o = set[ch][slot];
          if (!o) continue;
          closetAdd(o.id);
          outfitOf(ch)[slot] = o.d != null ? { id: o.id, d: o.d } : { id: o.id };
        }
      }
      addHappy(2);
      alog("fashion_couple", pre.name);
      DH.toast(`${pre.name} on! You two look adorable 💞`);
      return true;
    },
  };

  // I-5 presets — coordinated pairs, grant + equip on both chars
  const COUPLE_PRESETS = [
    {
      name: "Twin tees", ico: "👕", fee: 40, desc: "matching tees, one per season color",
      build(gs2) {
        const tee = { spring: "w-tee-mint", summer: "w-tee-sky", autumn: "w-tee-rose", winter: "w-tee-red" }[gs2.season] || "w-tee-mint";
        return { koto: { top: { id: tee } }, zuza: { top: { id: tee } } };
      },
    },
    {
      name: "His & hers", ico: "🎀", fee: 40, desc: "bow tie for koto, ribbon bow for zuza",
      build() { return { koto: { acc: { id: "w-bowtie" } }, zuza: { hat: { id: "w-bow" } } }; },
    },
    {
      name: "Seasonal set", ico: "🍂", fee: 60, desc: "hat + top themed on the season",
      build(gs2) {
        const map = {
          spring: { hat: "w-flowercrown", top: "w-tee-mint" },
          summer: { hat: "w-strawhat", top: "w-tee-sky" },
          autumn: { hat: "w-beanie", top: "w-sweater" },
          winter: { hat: "w-beanie", top: "w-sweater" },
        };
        const s = map[gs2.season] || map.spring;
        return { koto: { hat: { id: s.hat }, top: { id: s.top } }, zuza: { hat: { id: s.hat }, top: { id: s.top } } };
      },
    },
  ];

  // guest-safe dispatch: guests forward to the host via remoteAction
  function act(name, ...args) {
    if (isGuest()) { DH.net.guestAction("fashion." + name, args); return undefined; }
    const fn = API[name];
    return typeof fn === "function" ? fn(...args) : false;
  }
  const reopen = fn => (isGuest() ? setTimeout(fn, 450) : fn());
  function menuOpen(title, items) {
    DH.menu.open(title, items);
    if (isGuest() && gs) gs.paused = false; // guests keep streaming host snapshots while browsing
  }

  // guest-only char: guests always edit zuza; solo offers a who-submenu; host edits koto
  function editableChars() {
    if (isGuest()) return ["zuza"];
    if (isHostNet()) return ["koto"];
    return ["koto", "zuza"];
  }
  const charOf = p => (p && p.char) || "zuza";

  // ---------- menus ----------
  function openKiosk(char) {
    menuOpen("🧵 Able Sisters", [
      { ico: "🛍️", label: `Shop <small>(today's rack)</small>`, cb: () => openShop(char) },
      { ico: "👔", label: `Dress up <small>(${char}'s wardrobe)</small>`, cb: () => openDressUp(char) },
      { ico: "💇", label: "Makeover <small>(hair · color · skin)</small>", cb: () => openMakeover(isGuest() || isHostNet() ? char : null) },
      { ico: "💑", label: "Couple look <small>(both of you!)</small>", cb: () => openCouple(char) },
      { ico: "🎨", label: `My Design <small>(${S.designs.length}/${MAX_DESIGNS})</small>`, cb: () => openDesignMenu(char) },
    ]);
  }

  function openShop(char) {
    const list = todayStock().map(id => {
      const d = DH.items.get(id), cost = buyCost(id);
      const owned = S.closet.includes(id) ? " <small>(owned)</small>" : "";
      return {
        ico: d.ico, cost, disabled: gs.coins < cost,
        label: `${d.name} <small>${d.wear.slot}</small>${owned}`,
        cb: () => { act("buyWear", id); reopen(() => openShop(char)); },
      };
    });
    list.push({ ico: "◀️", label: "Back", cb: () => openKiosk(char) });
    menuOpen("🛍️ Able Sisters — today", list);
  }

  function openDressUp(char) {
    const out = outfitOf(char);
    const slotRow = (slot, ico, name) => {
      const o = out[slot], d = wearDef(o);
      const dn = o && o.d != null && S.designs[o.d] ? " · " + S.designs[o.d].name : "";
      const cur = d ? `${d.ico} ${d.name}${dn}` : "<small>—</small>";
      return { ico, label: `${name} — ${cur}`, cb: () => openSlot(char, slot, name) };
    };
    menuOpen(`👔 Dress up — ${char}`, [
      slotRow("hat", "🎩", "Hat"),
      slotRow("top", "👕", "Top"),
      slotRow("acc", "🕶️", "Accessory"),
      { ico: "◀️", label: "Back", cb: () => openKiosk(char) },
    ]);
  }

  function openSlot(char, slot, name) {
    const out = outfitOf(char), cur = out[slot];
    const list = [{ ico: "🚫", label: "<i>nothing</i>", disabled: !cur, cb: () => { act("unequip", char, slot); reopen(() => openDressUp(char)); } }];
    S.closet.forEach(id => {
      const d = DH.items.get(id);
      if (!d || !d.wear || d.wear.slot !== slot) return;
      if (d.wear.shape === "custom" || d.wear.shape === "facepaint") {
        // design-bound wearables expand to one row per saved design
        if (!S.designs.length) {
          list.push({ ico: d.ico, label: `${d.name} <small>(needs a design)</small>`, disabled: true, cb: () => {} });
        } else S.designs.forEach((des, i) => {
          const on = cur && cur.id === id && cur.d === i;
          list.push({
            ico: d.ico, label: `${on ? "✔ " : ""}${d.name} <small>${des.name}</small>`,
            cb: () => { act("equip", char, id, i); reopen(() => openSlot(char, slot, name)); },
          });
        });
        return;
      }
      const on = cur && cur.id === id;
      list.push({
        ico: d.ico, label: `${on ? "✔ " : ""}${d.name}`,
        cb: () => { act("equip", char, id); reopen(() => openSlot(char, slot, name)); },
      });
    });
    list.push({ ico: "◀️", label: "Back", cb: () => openDressUp(char) });
    menuOpen(`${name} — ${char}`, list);
  }

  function openMakeover(char) {
    if (!char && editableChars().length > 1) {
      return menuOpen("💇 Makeover — who?", editableChars().map(c => ({
        ico: c === "koto" ? "🧑" : "👩", label: c, cb: () => openMakeover(c),
      })).concat([{ ico: "◀️", label: "Back", cb: () => openKiosk("koto") }]));
    }
    char = char || editableChars()[0];
    const l = getLook(char);
    menuOpen(`💇 Makeover — ${char}`, [
      { ico: "💇", label: `Hairstyle — <b>${HAIR_NAMES[l.hair]}</b>`, cb: () => openHairStyle(char) },
      { ico: "🎨", label: `Hair color — <b>${HAIRCS[l.hairC].n}</b>`, cb: () => openHairColor(char) },
      { ico: "✋", label: `Skin tone — <b>${SKINS[l.skin].n}</b>`, cb: () => openSkin(char) },
      { ico: "↩️", label: "Back to default look", cb: () => { for (const k of ["hair", "hairC", "skin"]) act("setLook", char, k, DEF_LOOK[char][k]); reopen(() => openMakeover(char)); } },
      { ico: "◀️", label: "Back", cb: () => openKiosk(char) },
    ]);
  }
  function openHairStyle(char) {
    const l = getLook(char);
    menuOpen(`💇 Hairstyle — ${char}`, HAIRSTYLES.map(h => ({
      ico: l.hair === h ? "✔" : "💇", label: HAIR_NAMES[h],
      cb: () => { act("setLook", char, "hair", h); reopen(() => openMakeover(char)); },
    })).concat([{ ico: "◀️", label: "Back", cb: () => openMakeover(char) }]));
  }
  function openHairColor(char) {
    const l = getLook(char);
    menuOpen(`🎨 Hair color — ${char}`, HAIRCS.map((h, i) => ({
      ico: l.hairC === i ? "✔" : "🟪", label: h.n,
      cb: () => { act("setLook", char, "hairC", i); reopen(() => openMakeover(char)); },
    })).concat([{ ico: "◀️", label: "Back", cb: () => openMakeover(char) }]));
  }
  function openSkin(char) {
    const l = getLook(char);
    menuOpen(`✋ Skin tone — ${char}`, SKINS.map((s, i) => ({
      ico: l.skin === i ? "✔" : "🟫", label: s.n,
      cb: () => { act("setLook", char, "skin", i); reopen(() => openMakeover(char)); },
    })).concat([{ ico: "◀️", label: "Back", cb: () => openMakeover(char) }]));
  }

  function openCouple(char) {
    const list = COUPLE_PRESETS.map((p, i) => ({
      ico: p.ico, cost: p.fee, disabled: gs.coins < p.fee,
      label: `${p.name} <small>${p.desc}</small>`,
      cb: () => { act("coupleLook", i); reopen(() => openKiosk(char)); },
    }));
    list.push({ ico: "◀️", label: "Back", cb: () => openKiosk(char) });
    menuOpen("💑 Couple look", list);
  }

  function openDesignMenu(char) {
    const list = [{
      ico: "✏️", label: "<b>New design</b> <small>(16×16 pixel editor)</small>",
      disabled: S.designs.length >= MAX_DESIGNS, cb: () => openEditor(char, -1),
    }];
    S.designs.forEach((d, i) => list.push({
      ico: "🖼️", label: d.name,
      cb: () => openDesignUse(char, i),
    }));
    list.push({ ico: "◀️", label: "Back", cb: () => openKiosk(char) });
    menuOpen("🎨 My Design", list);
  }
  function openDesignUse(char, i) {
    const d = S.designs[i];
    if (!d) return openDesignMenu(char);
    menuOpen(`🖼️ ${d.name}`, [
      { ico: "👕", label: "Wear as custom tee", cb: () => { act("applyDesign", char, "tee", i); reopen(() => openKiosk(char)); } },
      { ico: "🎨", label: "Wear as face paint", cb: () => { act("applyDesign", char, "face", i); reopen(() => openKiosk(char)); } },
      { ico: "⬜", label: "Paint the tile under me", cb: () => { act("applyDesign", char, "tile", i); reopen(() => openDesignMenu(char)); } },
      { ico: "🚩", label: "Fly as house flag", cb: () => { act("applyDesign", char, "flag", i); reopen(() => openDesignMenu(char)); } },
      { ico: "✏️", label: "Edit", cb: () => openEditor(char, i) },
      { ico: "🗑️", label: "Delete", cb: () => { act("delDesign", i); reopen(() => openDesignMenu(char)); } },
      { ico: "◀️", label: "Back", cb: () => openDesignMenu(char) },
    ]);
  }

  // ---------- My Design editor (I-3) — DOM overlay, fat touch cells ----------
  let dsg = null; // {el,cv,ctx,cells,idx,char,color,tool}
  function editorUI() {
    if (dsg) return dsg;
    const o = document.createElement("div");
    o.id = "dsgUI"; o.className = "overlay hidden"; o.style.zIndex = "19";
    o.innerHTML =
      '<div class="card" style="max-width:420px;text-align:center;padding:12px;max-height:96vh;overflow-y:auto">' +
        '<h2 style="margin:0 0 6px">🎨 My Design</h2>' +
        '<canvas class="dsgcv" width="288" height="288" style="width:min(288px,calc(100vh - 196px));' +
          'height:min(288px,calc(100vh - 196px));' +
          'border-radius:8px;background:#241a24;touch-action:none;image-rendering:pixelated"></canvas>' +
        '<div class="dsgpal" style="display:flex;gap:6px;justify-content:center;margin:10px 0 6px;flex-wrap:wrap"></div>' +
        '<div class="dsgtools" style="display:flex;gap:6px;justify-content:center;margin-bottom:10px"></div>' +
        '<div class="btns" style="display:flex;gap:8px;justify-content:center">' +
          '<button class="bigbtn dsgdone">✔ Save</button>' +
          '<button class="midbtn dsgx">Cancel</button>' +
        '</div>' +
      '</div>';
    document.getElementById("stage").appendChild(o);
    const cv = o.querySelector(".dsgcv"), cx = cv.getContext("2d");
    const palBox = o.querySelector(".dsgpal"), toolBox = o.querySelector(".dsgtools");
    dsg = { el: o, cv, ctx: cx, cells: new Array(256).fill(-1), idx: -1, char: "koto", color: 2, tool: "paint" };

    const mark = () => {
      palBox.querySelectorAll("button").forEach(b => {
        b.style.outline = (+b.dataset.c === dsg.color ? "3px solid #fff" : "2px solid #0006");
      });
      toolBox.querySelectorAll("button[data-tool]").forEach(b => {
        b.style.background = b.dataset.tool === dsg.tool ? "#4a4a80" : "#14142a";
      });
    };
    PAL.forEach((c, i) => {
      const b = document.createElement("button");
      b.dataset.c = i; b.title = c;
      b.style.cssText = `width:36px;height:36px;border-radius:8px;border:none;background:${c};cursor:pointer`;
      b.addEventListener("click", () => { dsg.color = i; dsg.tool = "paint"; mark(); });
      palBox.appendChild(b);
    });
    [{ t: "erase", i: "🧽", n: "Eraser" }, { t: "fill", i: "🪣", n: "Fill" }].forEach(t => {
      const b = document.createElement("button");
      b.dataset.tool = t.t; b.className = "midbtn"; b.style.padding = "6px 10px";
      b.textContent = `${t.i} ${t.n}`;
      b.addEventListener("click", () => { dsg.tool = t.t; mark(); });
      toolBox.appendChild(b);
    });
    const clr = document.createElement("button");
    clr.className = "midbtn"; clr.style.padding = "6px 10px"; clr.textContent = "🗑 Clear";
    clr.addEventListener("click", () => { dsg.cells.fill(-1); drawEditor(); });
    toolBox.appendChild(clr);

    // paint strokes — pointer capture so drags keep painting off-canvas-edge-safe
    let painting = false;
    const cellAt = e => {
      const r = cv.getBoundingClientRect();
      const x = Math.floor((e.clientX - r.left) / r.width * 16), y = Math.floor((e.clientY - r.top) / r.height * 16);
      return (x < 0 || y < 0 || x > 15 || y > 15) ? -1 : y * 16 + x;
    };
    const applyAt = e => {
      const c = cellAt(e);
      if (c < 0) return;
      if (dsg.tool === "fill") {
        const from = dsg.cells[c], to = dsg.color;
        if (from !== to) { // BFS flood
          const q = [c]; dsg.cells[c] = to;
          while (q.length) {
            const k = q.pop(), kx = k % 16, ky = (k / 16) | 0;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const nx = kx + dx, ny = ky + dy;
              if (nx < 0 || ny < 0 || nx > 15 || ny > 15) continue;
              const n = ny * 16 + nx;
              if (dsg.cells[n] === from) { dsg.cells[n] = to; q.push(n); }
            }
          }
        }
      } else dsg.cells[c] = dsg.tool === "erase" ? -1 : dsg.color;
      drawEditor();
    };
    cv.addEventListener("pointerdown", e => { e.preventDefault(); painting = true; cv.setPointerCapture(e.pointerId); applyAt(e); });
    cv.addEventListener("pointermove", e => { if (painting && dsg.tool !== "fill") applyAt(e); });
    const up = () => { painting = false; };
    cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
    o.addEventListener("click", e => { if (e.target === o) closeEditor(); });
    o.querySelector(".dsgx").addEventListener("click", closeEditor);
    o.querySelector(".dsgdone").addEventListener("click", () => {
      const idx = dsg.idx;
      act("saveDesign", dsg.cells.slice(), idx);
      closeEditor();
      reopen(() => openDesignMenu(dsg.char));
    });
    dsg.mark = mark;
    return dsg;
  }
  function drawEditor() {
    const x = dsg.ctx;
    x.clearRect(0, 0, 288, 288);
    x.fillStyle = "#241a24"; x.fillRect(0, 0, 288, 288);
    for (let i = 0; i < 256; i++) {
      const v = dsg.cells[i];
      if (v >= 0) { x.fillStyle = PAL[v]; x.fillRect((i % 16) * 18, ((i / 16) | 0) * 18, 18, 18); }
    }
    x.strokeStyle = "rgba(255,255,255,0.07)";
    for (let g = 1; g < 16; g++) {
      x.beginPath(); x.moveTo(g * 18, 0); x.lineTo(g * 18, 288); x.stroke();
      x.beginPath(); x.moveTo(0, g * 18); x.lineTo(288, g * 18); x.stroke();
    }
  }
  function openEditor(char, idx) {
    editorUI();
    dsg.char = char; dsg.idx = idx | 0; dsg.tool = "paint"; dsg.color = 2;
    const src = idx >= 0 && S.designs[idx] ? S.designs[idx].cells : null;
    dsg.cells = src ? src.slice() : new Array(256).fill(-1);
    dsg.el.classList.remove("hidden");
    if (gs && !isGuest()) gs.paused = true;
    drawEditor(); dsg.mark();
  }
  function closeEditor() {
    if (dsg) dsg.el.classList.add("hidden");
    if (gs && !isGuest()) gs.paused = false;
  }

  // ---------- outfit + look rendering ----------
  // piece painters draw in drawChar body space (origin = feet center, after bob)
  const PIECES = {
    // hats
    cap(ctx, pal) {
      R(ctx, -8, -37, 16, 6, pal[0]); R(ctx, -8, -32, 16, 1, pal[1]);
      R(ctx, -9, -33, 3, 2, pal[1]); R(ctx, 6, -33, 3, 2, pal[1]); // side brims
      R(ctx, -2, -38, 4, 2, pal[1]);                              // button
    },
    beanie(ctx, pal) {
      R(ctx, -8, -36, 16, 6, pal[0]); R(ctx, -8, -32, 16, 3, pal[1]);
      R(ctx, -8, -36, 16, 1, pal[1]); R(ctx, -2, -40, 4, 4, "#f4f0e8"); // fold + pompom
    },
    straw(ctx, pal) {
      R(ctx, -10, -34, 20, 3, pal[0]); R(ctx, -6, -38, 12, 5, pal[0]);
      R(ctx, -6, -34, 12, 1, pal[1]);
    },
    crown(ctx, pal) {
      R(ctx, -7, -37, 14, 4, pal[0]);
      R(ctx, -7, -40, 3, 3, pal[0]); R(ctx, -1.5, -40, 3, 3, pal[0]); R(ctx, 4, -40, 3, 3, pal[0]);
      R(ctx, -1, -36, 2, 2, pal[1]);
    },
    bow(ctx, pal) {
      R(ctx, -10, -36, 7, 6, pal[0]); R(ctx, 3, -36, 7, 6, pal[0]);
      R(ctx, -8, -34, 3, 2, pal[1]); R(ctx, 5, -34, 3, 2, pal[1]);
      R(ctx, -2, -35, 4, 4, pal[1]);
    },
    flowercrown(ctx, pal) {
      const fl = [pal[0], "#ffd94d", "#f4f0e8", pal[0]];
      R(ctx, -8, -33, 16, 1, pal[1]);
      for (let i = 0; i < 4; i++) R(ctx, -7 + i * 4, -35, 3, 3, fl[i]);
      R(ctx, -9, -34, 2, 2, pal[1]); R(ctx, 7, -34, 2, 2, pal[1]);
    },
    wizard(ctx, pal) {
      R(ctx, -4, -44, 8, 6, pal[0]); R(ctx, -5, -38, 10, 4, pal[0]);
      R(ctx, -10, -35, 20, 3, pal[0]);
      R(ctx, -1, -42, 2, 2, pal[1]); R(ctx, 2, -39, 2, 2, pal[1]);
    },
    // tops
    tee(ctx, pal) {
      R(ctx, -8, -20, 16, 13, pal[0]);
      R(ctx, -11, -19, 4, 6, pal[0]); R(ctx, 7, -19, 4, 6, pal[0]); // sleeves
      R(ctx, -3, -20, 6, 2, pal[1]);                              // collar
      R(ctx, -8, -9, 16, 1, pal[1]);                              // hem
    },
    dress(ctx, pal) {
      R(ctx, -8, -20, 16, 10, pal[0]);
      R(ctx, -9, -10, 18, 4, pal[0]); R(ctx, -9, -7, 18, 1, pal[1]); // skirt + hem
      R(ctx, -6, -20, 3, 2, pal[1]); R(ctx, 3, -20, 3, 2, pal[1]);   // straps
      R(ctx, -11, -19, 4, 5, pal[0]); R(ctx, 7, -19, 4, 5, pal[0]);  // sleeves
    },
    hoodie(ctx, pal) {
      R(ctx, -8, -20, 16, 13, pal[0]);
      R(ctx, -9, -22, 18, 4, pal[1]);                              // hood bump
      R(ctx, -11, -19, 4, 7, pal[0]); R(ctx, 7, -19, 4, 7, pal[0]);
      R(ctx, -4, -12, 8, 4, pal[1]);                               // pocket
      R(ctx, -2, -19, 1, 3, "#f4f0e8"); R(ctx, 1, -19, 1, 3, "#f4f0e8");
    },
    sweater(ctx, pal) {
      R(ctx, -8, -20, 16, 13, pal[0]);
      R(ctx, -11, -19, 4, 7, pal[0]); R(ctx, 7, -19, 4, 7, pal[0]);
      R(ctx, -8, -17, 16, 2, pal[1]); R(ctx, -8, -12, 16, 2, pal[1]); // knit stripes
      R(ctx, -4, -20, 8, 2, pal[1]);                                // collar
    },
    custom(ctx, pal, d) { // I-3: design becomes the shirt front
      R(ctx, -8, -20, 16, 13, pal[0]);
      R(ctx, -11, -19, 4, 6, pal[0]); R(ctx, 7, -19, 4, 6, pal[0]);
      R(ctx, -3, -20, 6, 2, pal[1]); R(ctx, -8, -9, 16, 1, pal[1]);
      const c = designCanvas(d);
      if (c) ctx.drawImage(c, 0, 0, 16, 16, -6, -19, 12, 11);
      else { R(ctx, -6, -19, 12, 11, pal[1]); }
    },
    // accessories (only drawn facing camera; scarf/bowtie draw from behind too)
    glasses(ctx, pal, d, up) {
      if (up) return;
      R(ctx, -6, -25, 4, 1, pal[0]); R(ctx, -6, -22, 4, 1, pal[0]);
      R(ctx, -6, -25, 1, 4, pal[0]); R(ctx, -3, -25, 1, 4, pal[0]);
      R(ctx, 2, -25, 4, 1, pal[0]); R(ctx, 2, -22, 4, 1, pal[0]);
      R(ctx, 2, -25, 1, 4, pal[0]); R(ctx, 5, -25, 1, 4, pal[0]);
      R(ctx, -1, -24, 2, 1, pal[0]);                              // bridge
    },
    sunglasses(ctx, pal, d, up) {
      if (up) return;
      R(ctx, -6, -25, 12, 4, pal[0]);
      R(ctx, -5, -25, 3, 1, "#ffffff88"); R(ctx, -6, -21, 12, 1, pal[0]);
    },
    scarf(ctx, pal) {
      R(ctx, -8, -20, 16, 4, pal[0]);                             // wrap
      R(ctx, -8, -16, 4, 7, pal[0]); R(ctx, -8, -14, 4, 2, pal[1]); // tail + stripe
      R(ctx, -8, -9, 4, 1, pal[1]);
    },
    bowtie(ctx, pal) {
      R(ctx, -5, -21, 4, 4, pal[0]); R(ctx, 1, -21, 4, 4, pal[0]);
      R(ctx, -1, -20, 2, 3, pal[1]);
    },
    facepaint(ctx, pal, d, up) {
      if (up) return;
      const c = designCanvas(d);
      if (c) { ctx.drawImage(c, 0, 0, 16, 16, -6, -25, 5, 5); ctx.drawImage(c, 0, 0, 16, 16, 1, -25, 5, 5); }
      else { R(ctx, -6, -25, 5, 2, pal[0]); R(ctx, 1, -25, 5, 2, pal[0]); }
    },
  };
  function drawOutfit(ctx, char, up) {
    const out = S.outfits[char];
    if (!out) return;
    for (const slot of ["top", "acc", "hat"]) {
      const o = out[slot], d = wearDef(o);
      if (!d) continue;
      const fn = PIECES[d.wear.shape];
      if (fn) fn(ctx, d.wear.pal || [], o.d, up);
    }
  }

  // full re-render for customized looks (replicates sprites.js drawChar math)
  function drawSelf(ctx, p, look, out) {
    const x = p.x, y = p.y, dir = p.dir, char = p.char;
    const step = p.moving === false ? 0 : p.step;
    const sk = SKINS[look.skin] || SKINS[1];
    const hc = HAIRCS[look.hairC] || HAIRCS[0];
    ctx.save(); ctx.translate(x, y);
    const bob = Math.sin(step * Math.PI * 2) * 1.2;
    const idle = Math.sin(Date.now() / 520 + x * 0.11) * 0.7;
    const leg = Math.sin(step * Math.PI * 2) * 2.5;
    const arm = Math.sin(step * Math.PI * 2) * 1.8;
    const facingUp = dir === "up";
    ctx.translate(0, (bob + idle) * -0.5);
    // legs + shoes (same as drawChar)
    R(ctx, -6, -8, 5, 8 + (leg > 0 ? leg : 0), "#2a2a33");
    R(ctx, 1, -8, 5, 8 + (leg < 0 ? -leg : 0), "#2a2a33");
    R(ctx, -6, -2 + Math.max(0, leg), 5, 2, "#15151c");
    R(ctx, 1, -2 + Math.max(0, -leg), 5, 2, "#15151c");
    // body + arms + hands
    R(ctx, -8, -20, 16, 13, SHIRT);
    R(ctx, -8, -20, 16, 2, "#2e2e3a"); R(ctx, -8, -9, 16, 2, "#121218");
    R(ctx, -11, -19 + arm * 0.6, 4, 10, SHIRT); R(ctx, 7, -19 - arm * 0.6, 4, 10, SHIRT);
    R(ctx, -11, -10 + arm * 0.6, 4, 2, sk.m); R(ctx, 7, -10 - arm * 0.6, 4, 2, sk.m);
    // hair behind the body for the long style
    if (look.hair === "long") {
      R(ctx, -9, -34, 18, 26, hc.c);
      R(ctx, -9, -22, 3, 14, hc.hi); R(ctx, 6, -22, 3, 14, hc.hi);
      R(ctx, -7, -32, 2, 22, hc.hi);
    }
    // head
    R(ctx, -7, -32, 14, 13, sk.m);
    R(ctx, -7, -21, 14, 2, sk.d);
    R(ctx, -6, -31, 5, 2, "#ffe0bb");
    // hair (top) by style
    if (look.hair === "bowl") {
      R(ctx, -8, -34, 16, 7, hc.c);
      R(ctx, -8, -28, 3, 6, hc.c); R(ctx, 5, -28, 3, 6, hc.c);
      R(ctx, -7, -27, 14, 4, hc.c);
      R(ctx, -6, -33, 6, 2, hc.hi);
      if (facingUp) R(ctx, -8, -27, 16, 9, hc.c);
    } else if (look.hair === "long") {
      R(ctx, -8, -34, 16, 5, hc.c);
      if (facingUp) R(ctx, -8, -29, 16, 11, hc.c);
    } else if (look.hair === "bun") {
      R(ctx, -8, -34, 16, 6, hc.c);
      R(ctx, -7, -28, 14, 3, hc.c);                  // fringe
      R(ctx, -8, -26, 2, 5, hc.c); R(ctx, 6, -26, 2, 5, hc.c); // wisps
      R(ctx, -4, -40, 8, 7, hc.c);                   // bun
      R(ctx, -2, -34, 4, 2, hc.hi);                  // tie
      R(ctx, -2, -39, 4, 2, hc.hi);
      if (facingUp) R(ctx, -8, -28, 16, 10, hc.c);
    } else { // spiky
      R(ctx, -8, -33, 16, 5, hc.c);
      R(ctx, -8, -36, 3, 4, hc.c); R(ctx, -4, -38, 3, 6, hc.c);
      R(ctx, 0, -36, 3, 4, hc.c); R(ctx, 4, -37, 3, 5, hc.c);
      R(ctx, -7, -29, 14, 2, hc.c);
      if (facingUp) R(ctx, -8, -28, 16, 10, hc.c);
    }
    // face
    if (!facingUp) {
      const lk = dir === "left" ? -1.5 : dir === "right" ? 1.5 : 0;
      R(ctx, -4 + lk, -25, 2, 3, "#1a1a1a"); R(ctx, 2 + lk, -25, 2, 3, "#1a1a1a");
      R(ctx, -4 + lk, -25, 1, 1, "#ffffff66"); R(ctx, 2 + lk, -25, 1, 1, "#ffffff66");
      R(ctx, -1, -21, 2, 1, "#e0a878");
    }
    if (char === "koto") { // his signature chain + watch survive the makeover
      ctx.strokeStyle = "#d9d9e2"; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(0, -14, 4, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
      R(ctx, -11, -11, 3, 3, "#e8e8f0"); R(ctx, -11, -12, 3, 1, "#555");
    }
    if (out) drawOutfit(ctx, char, facingUp);
    ctx.restore();
  }

  // patched player draw: outfits overlay the stock sprite; custom looks re-render
  function drawPlayerStyled(ctx, p, orig) {
    const char = p.char;
    const out = S.outfits && S.outfits[char];
    const hasOut = out && (out.hat || out.top || out.acc);
    if (customLook(char)) { drawSelf(ctx, p, getLook(char), out); return; }
    orig(ctx, p);
    if (!hasOut) return;
    const step = p.moving === false ? 0 : p.step;
    const bob = Math.sin(step * Math.PI * 2) * 1.2;
    const idle = Math.sin(Date.now() / 520 + p.x * 0.11) * 0.7;
    ctx.save(); ctx.translate(p.x, p.y); ctx.translate(0, (bob + idle) * -0.5);
    drawOutfit(ctx, char, p.dir === "up");
    ctx.restore();
  }
  function patchSprites() {
    const sp = DH.sprites;
    if (!sp || sp._fashionPatched) return;
    sp._fashionPatched = 1;
    const orig = sp.drawPlayer.bind(sp);
    sp.drawPlayer = (ctx, p) => drawPlayerStyled(ctx, p, orig);
  }

  // ---------- scenery sprites ----------
  function drawHedgehog(ctx, x, y, flip) { // yarn sister behind the counter
    ctx.save(); ctx.translate(x, y); if (flip) ctx.scale(-1, 1);
    R(ctx, -5, -8, 10, 8, "#3a4a6a");                       // spiky back
    R(ctx, -6, -9, 2, 2, "#3a4a6a"); R(ctx, -2, -10, 2, 2, "#3a4a6a");
    R(ctx, 2, -10, 2, 2, "#3a4a6a"); R(ctx, 5, -9, 2, 2, "#3a4a6a");
    R(ctx, -4, -6, 8, 6, "#e8c090");                        // face
    R(ctx, -3, -5, 1, 1, "#1a1a1a"); R(ctx, 1, -5, 1, 1, "#1a1a1a");
    R(ctx, 3, -4, 2, 2, "#c96a6a");                         // nose
    R(ctx, -4, 0, 8, 2, "#f4f0e8");                         // apron edge
    ctx.restore();
  }
  function drawKiosk(ctx, px, py) {
    const now = Date.now();
    R(ctx, px - 4, py + 26, 72, 8, "#b98d55");              // plank pad
    R(ctx, px - 4, py + 26, 72, 2, "#d0a86a");
    R(ctx, px + 4, py - 12, 4, 42, "#7a5328");              // posts
    R(ctx, px + 56, py - 12, 4, 42, "#7a5328");
    R(ctx, px - 2, py - 20, 68, 10, "#e07ba0");             // pastel awning
    for (let i = 0; i < 4; i++) R(ctx, px + 6 + i * 16, py - 20, 8, 10, "#f8f0e0");
    R(ctx, px - 2, py - 22, 68, 3, "#c05878");
    for (let i = 0; i < 5; i++) {                           // scallops
      ctx.fillStyle = i % 2 ? "#f8f0e0" : "#e07ba0";
      ctx.beginPath(); ctx.arc(px + 5 + i * 13.5, py - 10, 6.5, 0, Math.PI); ctx.fill();
    }
    // counter + stitched front panel
    R(ctx, px, py + 10, 64, 6, "#c8975c");
    R(ctx, px + 2, py + 16, 60, 18, "#f0e6d2");
    R(ctx, px + 2, py + 16, 60, 2, "#c09055");
    for (let i = 0; i < 3; i++) {
      R(ctx, px + 12 + i * 18, py + 20, 6, 6, "#e07ba0");   // fabric swatches
      R(ctx, px + 13 + i * 18, py + 21, 4, 2, "#c05878");
    }
    ctx.fillStyle = "#8a3a5a"; ctx.font = "bold 8px sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("ABLE", px + 32, py + 31);
    // goods on the counter: yarn balls + folded tees
    ctx.fillStyle = "#e07ba0"; ctx.beginPath(); ctx.arc(px + 12, py + 6, 4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#c05878"; ctx.beginPath(); ctx.moveTo(px + 10, py + 4); ctx.lineTo(px + 15, py + 8); ctx.stroke();
    ctx.fillStyle = "#5bd08a"; ctx.beginPath(); ctx.arc(px + 20, py + 7, 3.4, 0, Math.PI * 2); ctx.fill();
    R(ctx, px + 42, py + 3, 10, 4, "#5b8ae0"); R(ctx, px + 43, py + 5, 8, 4, "#ffd94d");
    drawHedgehog(ctx, px + 20, py + 10, false);             // Sable + Mabel
    drawHedgehog(ctx, px + 44, py + 10, true);
    // hanging sign sways
    const sw = Math.sin(now / 900) * 1.5;
    ctx.save(); ctx.translate(px + 32 + sw, py - 28);
    R(ctx, -12, -4, 24, 9, "#f0e6d2"); R(ctx, -12, -4, 24, 2, "#c05878");
    ctx.fillStyle = "#8a3a5a"; ctx.font = "bold 6px sans-serif";
    ctx.fillText("SISTERS", 0, 1);
    ctx.restore();
  }
  function drawVanity(ctx, px, py) {
    R(ctx, px + 2, py + 12, 28, 18, "#8a5a3b");             // dresser
    R(ctx, px, py + 9, 32, 5, "#a06a42");
    R(ctx, px + 4, py + 15, 10, 6, "#6f4327"); R(ctx, px + 18, py + 15, 10, 6, "#6f4327");
    R(ctx, px + 8, py + 17, 2, 2, "#e8c860"); R(ctx, px + 22, py + 17, 2, 2, "#e8c860");
    R(ctx, px + 9, py - 10, 14, 19, "#6f4327");             // mirror frame
    R(ctx, px + 11, py - 8, 10, 15, "#bcd8e8");             // glass
    const tw = Date.now() / 600;
    R(ctx, px + 13, py - 6 + Math.sin(tw) * 1.5, 3, 5, "#ffffffaa"); // glint drift
    R(ctx, px + 13, py + 6, 6, 3, "#e07ba0");               // lipstick on the dresser
  }
  function drawMannequin(ctx, px, py, camX, camY) {
    R(ctx, px + 13, py + 24, 6, 3, "#6f4327");              // base
    R(ctx, px + 15, py + 6, 2, 19, "#8a6438");              // pole
    // a mini me wearing today's picks
    const stock = todayStock();
    const out = {};
    const top = stock.map(id => DH.items.get(id)).find(d => d && d.wear.slot === "top");
    const hat = stock.map(id => DH.items.get(id)).find(d => d && d.wear.slot === "hat");
    const acc = stock.map(id => DH.items.get(id)).find(d => d && d.wear.slot === "acc");
    if (top) out.top = { id: top.id }; if (hat) out.hat = { id: hat.id }; if (acc) out.acc = { id: acc.id };
    drawSelf(ctx, { x: px + 16, y: py + 26, dir: "down", step: 0, moving: false, char: "zuza" },
      { hair: "bun", hairC: 1, skin: 0 }, out);
  }
  function drawFlag(ctx, px, py) {
    if (S.flag < 0 || !S.designs[S.flag]) return;
    const c = designCanvas(S.flag);
    if (!c) return;
    const now = Date.now();
    R(ctx, px + 14, py + 2, 18, 2, "#7a4a2c");              // bracket rod
    R(ctx, px + 15, py + 4, 2, 2, "#7a4a2c");
    for (let i = 0; i < 4; i++)                           // waving strips
      ctx.drawImage(c, i * 4, 0, 4, 16, px + 17 + i * 4, py + 4 + Math.sin(now / 280 + i) * 1.4, 4, 13);
  }

  // ---------- module contract ----------
  const M = (DH.fashion = {
    authority: true,
    _S: S,

    init(state) {
      gs = state;
      M.authority = !isGuest();
      const W = DH.world;
      [VANITY, KIOSK, { tx: KIOSK.tx + 1, ty: KIOSK.ty }, MANNE].forEach(t =>
        W.blocked.add(t.tx + "," + t.ty));
      if (!W._fashionPatched) { // same blocked-tiles trick as econ/furniture
        W._fashionPatched = 1;
        const s0 = W.isSolid.bind(W);
        W.isSolid = (tx, ty) => s0(tx, ty) || W.blocked.has(tx + "," + ty);
      }
      patchSprites();
      hookNet();
    },

    start(state) {
      gs = state;
      M.authority = !isGuest();
      S.outfits = S.outfits || { koto: {}, zuza: {} };
      S.outfits.koto = S.outfits.koto || {}; S.outfits.zuza = S.outfits.zuza || {};
      if (!S.seeded && M.authority) { // starter wardrobe + a heart design to play with
        S.seeded = true;
        closetAdd("w-cap-red"); closetAdd("w-tee-mint");
        S.designs.push({ name: "Heart", cells: heartDesign() });
      }
    },

    drawGround(ctx, camX, camY, state) {
      ctxG = ctx;
      if (!S.paintTiles.length) return;
      ctx.save(); ctx.globalAlpha = 0.85;
      for (const t of S.paintTiles) {
        const c = designCanvas(t.d);
        if (c) ctx.drawImage(c, t.tx * T - camX, t.ty * T - camY, T, T);
      }
      ctx.restore();
    },

    interactables(p) {
      if (!gs || !gs.running) return [];
      const out = [];
      const guestDriven = p && p.pid === 1 && !p.char && isHostNet(); // actAt fake p
      const kick = m => (guestDriven
        ? () => DH.net.send({ type: "fa_open", m })                   // open on the guest's phone
        : () => openKiosk(charOf(p)));
      const dK = dist2(p.x, p.y, KIOSK_PT.x, KIOSK_PT.y);
      if (dK < KIOSK_PT.r * KIOSK_PT.r)
        out.push({ label: "Able Sisters 🧵", x: KIOSK_PT.x, y: KIOSK_PT.y, d2: dK, action: kick("kiosk") });
      const dV = dist2(p.x, p.y, VANITY_PT.x, VANITY_PT.y);
      if (dV < VANITY_PT.r * VANITY_PT.r)
        out.push({
          label: "Makeover 💇", x: VANITY_PT.x, y: VANITY_PT.y, d2: dV,
          action: guestDriven ? () => DH.net.send({ type: "fa_open", m: "makeover" })
                              : () => openMakeover(p && p.char ? charOf(p) : null),
        });
      const dM = dist2(p.x, p.y, MANNE_PT.x, MANNE_PT.y);
      if (dM < MANNE_PT.r * MANNE_PT.r)
        out.push({
          label: "Mannequin 👗", x: MANNE_PT.x, y: MANNE_PT.y, d2: dM,
          action: () => {
            const names = todayStock().map(id => DH.items.label(id)).join(", ");
            DH.toast(`Mannequin wears today's rack: ${names} 🧵`, 3200);
          },
        });
      out.sort((a, b) => a.d2 - b.d2);
      return out;
    },

    collectDraws(draws, camX, camY) {
      if (!ctxG) ctxG = document.getElementById("cv").getContext("2d");
      draws.push({ y: (KIOSK.ty + 1) * T, fn: () => drawKiosk(ctxG, KIOSK.tx * T - camX, KIOSK.ty * T - camY) });
      draws.push({ y: (VANITY.ty + 1) * T - 1, fn: () => drawVanity(ctxG, VANITY.tx * T - camX, VANITY.ty * T - camY) });
      draws.push({ y: (MANNE.ty + 1) * T - 2, fn: () => drawMannequin(ctxG, MANNE.tx * T - camX, MANNE.ty * T - camY) });
      draws.push({ y: FLAG.ty * T + 10, fn: () => drawFlag(ctxG, FLAG.tx * T - camX, FLAG.ty * T - camY) });
    },

    // ----- sync boundary -----
    serialize() {
      return JSON.parse(JSON.stringify({
        closet: S.closet, outfits: S.outfits, looks: S.looks,
        designs: S.designs, paintTiles: S.paintTiles, flag: S.flag, seeded: S.seeded,
      }));
    },
    deserialize(d) {
      if (!d) return;
      if (Array.isArray(d.closet)) S.closet = d.closet.filter(x => typeof x === "string");
      if (d.outfits && typeof d.outfits === "object") {
        for (const ch of ["koto", "zuza"]) {
          const o = d.outfits[ch];
          if (o && typeof o === "object") {
            const clean = {};
            for (const slot of ["hat", "top", "acc"])
              if (o[slot] && typeof o[slot].id === "string")
                clean[slot] = o[slot].d != null ? { id: o[slot].id, d: o[slot].d | 0 } : { id: o[slot].id };
            S.outfits[ch] = clean;
          }
        }
      }
      if (d.looks && typeof d.looks === "object") {
        for (const ch of ["koto", "zuza"]) {
          const l = d.looks[ch];
          if (l && HAIRSTYLES.includes(l.hair) && HAIRCS[l.hairC] && SKINS[l.skin])
            S.looks[ch] = { hair: l.hair, hairC: l.hairC | 0, skin: l.skin | 0 };
        }
      }
      if (Array.isArray(d.designs)) {
        S.designs = d.designs.filter(x => x && Array.isArray(x.cells) && x.cells.length === 256)
          .slice(0, MAX_DESIGNS).map((x, i) => ({ name: String(x.name || `Design ${i + 1}`), cells: x.cells.map(v => (v | 0) >= -1 && v < PAL.length ? v | 0 : -1) }));
        clearDcache();
      }
      if (Array.isArray(d.paintTiles))
        S.paintTiles = d.paintTiles.filter(t => t && typeof t.tx === "number" && typeof t.ty === "number" && typeof t.d === "number").slice(-MAX_TILES);
      if (typeof d.flag === "number") S.flag = d.flag | 0;
      if (typeof d.seeded === "boolean") S.seeded = d.seeded;
    },
    remoteAction(name, args) {
      const n = String(name || "").startsWith("fashion.") ? name.slice(8) : name;
      const fn = API[n];
      return typeof fn === "function" ? fn.apply(null, args || []) : false;
    },
    offline() { return []; }, // fashion doesn't decay while away

    // exposed for menus + tests
    buyWear: API.buyWear, equip: API.equip, unequip: API.unequip, setLook: API.setLook,
    saveDesign: API.saveDesign, delDesign: API.delDesign, applyDesign: API.applyDesign,
    coupleLook: API.coupleLook,
    openKiosk, openShop, openDressUp, openMakeover, openCouple, openDesignMenu, openEditor,
    todayStock, editableChars,
  });

  // starter heart design (16x16, palette index 2 = red)
  function heartDesign() {
    const art = [
      ".....XX..XX.......",
      "....XXXX.XXXX.....",
      "...XXXXXXXXXXX....",
      "...XXXXXXXXXXX....",
      "...XXXXXXXXXXX....",
      "....XXXXXXXXX.....",
      ".....XXXXXXX......",
      "......XXXXX.......",
      ".......XXX........",
      "........X.........",
    ];
    const cells = new Array(256).fill(-1);
    art.forEach((row, y) => {
      for (let x = 0; x < 16 && x < row.length; x++)
        if (row[x] === "X") cells[(y + 2) * 16 + x] = 2;
    });
    return cells;
  }

  // guest-side menu plumbing: the host relays "open your kiosk menu" after actAt
  function openGuestMenu(m) {
    if (!isGuest()) return;
    if (m === "makeover") openMakeover("zuza");
    else openKiosk("zuza");
  }
  function hookNet() {
    const net = DH.net;
    if (!net || net._fashionHook) return;
    net._fashionHook = 1;
    const h0 = net._handle.bind(net);
    net._handle = m => {
      h0(m);
      if (net.role === "guest" && m && m.type === "fa_open") {
        try { openGuestMenu(m.m); } catch (e) {}
      }
    };
  }
})();

DH.register("fashion", DH.fashion);
