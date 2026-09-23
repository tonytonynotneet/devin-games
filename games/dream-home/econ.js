/* dream-home econ module — bells economy (spec E-2,E-3,E-6,E-7,E-8,E-9).
   Contract with game.js (same as garden.js/animals.js):
     DH.econ.init(state)         – called once at load
     DH.econ.start(state)        – called when a run starts
     DH.econ.update(dt, state)   – per frame (sim under authority)
     DH.econ.interactables(p)    – -> [{label,x,y,action}] for the action key
     DH.econ.collectDraws(draws, camX, camY) – depth-sorted stall/bin/merchant
     DH.econ.drawOverlay(ctx, camX, camY, state) – coin-shower FX + merchant marker
     DH.econ.serialize()/deserialize(data)/remoteAction(name, args)

   E-2 Nook's shop: stall beside the front-door mat (tiles 7,10 + 8,10). BUY =
   ~6-item daily stock (seeded by the real date) of registered items; SELL =
   per-pocket rows + sell-all, with one real-day "hot item" paying 2x.
   E-3 Turnips: Sunday morning the shop sells turnips (🪙90-110); the sell
   rate random-walks twice per game-day Mon–Sat within 50-200% of the buy
   price; unsold turnips rot when the next Sunday rolls in.
   E-6 ATM inside the shop: deposit/withdraw; +0.5% interest per real day away
   (applied in offline()).
   E-7 Catalog: every item ever held (owned set) reorderable at price*1.5,
   delivered instantly to pockets.
   E-8 Sell bin: wooden dump bin next to the stall — empties sellable pockets
   for DH.inv value minus a 20% fee, with a coin-shower FX.
   E-9 Visiting merchant: every 3rd game-day Rover stands on the path selling
   3 rare goods that never appear in shop stock.

   Net-sync boundary: all sim state is plain JSON (S). Guests never run
   update() — host snapshots arrive via deserialize(); mutations are named
   functions on API and callable via remoteAction(name,args).
   Nothing here requires a tool module — every action works tool-free.
*/
(function () {
  const DH = (window.DH = window.DH || {});
  const T = 32;
  const R = (ctx, x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
  const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
  const rnd = (a, b) => a + Math.random() * (b - a);

  // ---------- items (registered once at file eval; items.js loads first) ----------
  const E = DH.items.def;
  E("seedpack", { name: "Seed pack", ico: "🌱", cat: "misc", price: 25 });
  E("vase", { name: "Flower vase", ico: "🏺", cat: "furniture", price: 60 });
  E("clock", { name: "Wall clock", ico: "🕰️", cat: "furniture", price: 90 });
  E("mirror", { name: "Hand mirror", ico: "🪞", cat: "furniture", price: 80 });
  E("candle", { name: "Candle", ico: "🕯️", cat: "furniture", price: 40 });
  E("picture", { name: "Framed photo", ico: "🖼️", cat: "furniture", price: 110 });
  E("cap", { name: "Baseball cap", ico: "🧢", cat: "misc", price: 45 });
  E("tee", { name: "Pocket tee", ico: "👕", cat: "misc", price: 60 });
  E("scarf", { name: "Wool scarf", ico: "🧣", cat: "misc", price: 75 });
  E("jam", { name: "Berry jam", ico: "🍯", cat: "food", price: 35 });
  E("juice", { name: "Apple juice", ico: "🧃", cat: "food", price: 15 });
  E("turnip", { name: "Turnips", ico: "🥬", cat: "misc", price: 0, stack: 999 });
  // merchant-only rare goods — never in daily stock
  E("ruby", { name: "Ruby", ico: "💎", cat: "misc", price: 400 });
  E("statue", { name: "Garden statue", ico: "🗿", cat: "furniture", price: 500 });
  E("kimono", { name: "Silk kimono", ico: "👘", cat: "misc", price: 350 });
  E("painting", { name: "Oil painting", ico: "🎨", cat: "furniture", price: 450 });
  E("crystal", { name: "Crystal ball", ico: "🔮", cat: "misc", price: 600 });

  // ---------- stock tables ----------
  // buyCost is the shop price; item def price stays the sell value
  const STOCK_POOL = [
    { id: "seedpack", cost: 40 }, { id: "vase", cost: 120 }, { id: "clock", cost: 180 },
    { id: "mirror", cost: 160 }, { id: "candle", cost: 80 }, { id: "picture", cost: 220 },
    { id: "cap", cost: 90 }, { id: "tee", cost: 120 }, { id: "scarf", cost: 150 },
    { id: "jam", cost: 70 }, { id: "juice", cost: 30 },
  ];
  const RARE_POOL = [
    { id: "ruby", cost: 800 }, { id: "statue", cost: 1000 }, { id: "kimono", cost: 700 },
    { id: "painting", cost: 900 }, { id: "crystal", cost: 1200 },
  ];

  // ---------- world spots ----------
  const STALL = { tx: 7, ty: 10 };                 // tiles 7,10 + 8,10 (blocked)
  const SHOP_PT = { x: 8 * T, y: 11 * T + 4, r: 60 };   // front of the stall
  const BIN_PT = { x: 6 * T + 16, y: 10 * T + 22, r: 42 };
  const MERCH = { x: 11 * T + 16, y: 10 * T + 14, r: 46 }; // path tile, yard zone

  // ---------- helpers ----------
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
    const r = mulberry32(dateSeed()), pool = STOCK_POOL.slice(), out = [];
    while (out.length < 6 && pool.length) out.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
    return out;
  }
  let _hotDay = -1, _hotId = null;
  function hotId() { // one real-day "hot item" pays double
    const d = dateSeed();
    if (_hotDay !== d) {
      _hotDay = d;
      const sellable = Object.values(DH.items.defs).filter(x => x.price > 0);
      _hotId = sellable[Math.floor(mulberry32(d)() * sellable.length)].id;
    }
    return _hotId;
  }
  function sellUnit(id) { // price for ONE of id at the shop counter right now
    if (id === "turnip") return S.tpPrice | 0;
    const d = DH.items.get(id);
    const p = d ? d.price : 0;
    return p > 0 ? p * (id === hotId() ? 2 : 1) : 0;
  }
  const dayIdx = () => Math.floor((gs && gs.day) || 0);
  const isSunday = () => dayIdx() % 7 === 0;
  const sundayMorning = () => isSunday() && gs.timeMin < 12 * 60;
  const merchantHere = () => dayIdx() % 3 === 0;

  function merchantGoods() {
    const r = mulberry32(Math.floor(dayIdx() / 3) * 7919 + 13), pool = RARE_POOL.slice(), out = [];
    while (out.length < 3 && pool.length) out.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
    return out;
  }

  // ---------- module state (plain JSON only — serialized for save + net) ----------
  let gs = null;
  const S = {
    bank: 0,        // ATM savings balance
    owned: [],      // catalog: every item id ever held in pockets
    tpBuy: 0,       // this Sunday's turnip buy price
    tpPrice: 0,     // current turnip sell price (random walk)
    lastDay: -1,    // last seen floor(state.day) — new-day detection
    lastSlot: -1,   // last price slot (2 per game-day)
  };
  const fx = [];    // view layer: coin-shower particles — never serialized

  function coinFx(x, y, n) {
    for (let i = 0; i < n && fx.length < 40; i++)
      fx.push({ x: x + rnd(-14, 14), y: y - rnd(0, 18), vy: -30 - rnd(0, 40), vx: rnd(-10, 10), age: 0, ttl: 1 + rnd(0, 0.5) });
  }
  function addHappy(n) { if (gs) gs.happiness = Math.max(0, gs.happiness + n); }
  function bigBuyHappy(cost) { if (cost >= 300) addHappy(2); else if (cost >= 100) addHappy(1); }
  function alog(e, d) { if (DH.alog) DH.alog.add(e, d); }
  function own(id) { if (id && !S.owned.includes(id)) S.owned.push(id); } // catalog tracks "ever held"
  // the bin mirrors DH.inv.sellAll(): raw item price only, no hot bonus —
  // and turnips never go in the bin (they sell at the counter rate)
  function binUnit(id) { const d = DH.items.get(id); return id === "turnip" ? 0 : (d ? d.price : 0); }

  // ---------- mutations (named + remote-callable) ----------
  const API = {
    buy(id, cost) { // shop stock purchase
      const d = DH.items.get(id);
      if (!d || !gs) return false;
      if (gs.coins < cost) { DH.toast("Not enough coins 🪙"); return false; }
      if (DH.inv.add(id, 1) <= 0) { DH.toast("Pockets are full! ☹️"); return false; }
      gs.coins -= cost; bigBuyHappy(cost);
      own(id);
      alog("econ_buy", id);
      DH.toast(`Bought ${d.name}! ${d.ico}`);
      return true;
    },
    sellOne(id) { // sell every pocket copy of one item at today's rate
      if (!gs) return false;
      const n = DH.inv.count(id); if (!n) return false;
      const unit = sellUnit(id);
      if (unit <= 0) { DH.toast("Nook won't buy that ☹️"); return false; }
      DH.inv.remove(id, n);
      const v = unit * n; gs.coins += v;
      coinFx(SHOP_PT.x, SHOP_PT.y - 20, 6);
      alog("econ_sell", `${id} x${n}`);
      DH.toast(`Sold ${DH.items.label(id)} +🪙${v}${id === hotId() ? " 🔥hot!" : ""}`);
      return true;
    },
    sellAll() { // counter: empty every sellable pocket (incl. turnips at rate)
      if (!gs) return 0;
      let v = 0;
      (gs.inv || []).slice().forEach(s => {
        const u = sellUnit(s.id);
        if (u > 0) { v += u * s.n; DH.inv.remove(s.id, s.n); }
      });
      if (!v) { DH.toast("Nothing to sell ☹️"); return 0; }
      gs.coins += v; addHappy(1);
      coinFx(SHOP_PT.x, SHOP_PT.y - 20, 10);
      alog("econ_sellall", v);
      DH.toast(`Sold everything +🪙${v}`);
      return v;
    },
    dumpBin() { // E-8 sell bin: sellable pockets minus a 20% fee
      if (!gs) return 0;
      let v = 0, keptTurnips = false;
      (gs.inv || []).slice().forEach(s => {
        const u = binUnit(s.id);
        if (u > 0) { v += u * s.n; DH.inv.remove(s.id, s.n); }
        else if (s.id === "turnip") keptTurnips = true;
      });
      if (!v) { DH.toast(keptTurnips ? "Turnips don't go in the bin — sell at the counter 🥬" : "Bin is empty — nothing sellable ☹️"); return 0; }
      const pay = Math.floor(v * 0.8); gs.coins += pay;
      coinFx(BIN_PT.x, BIN_PT.y - 8, 12);
      alog("econ_bin", pay);
      DH.toast(`Bin dumped +🪙${pay} (20% handling fee)${keptTurnips ? " · turnips stay out" : ""}`);
      return pay;
    },
    buyTurnips(n) { // E-3 Sunday-morning stalk market
      if (!gs) return false;
      if (!sundayMorning()) { DH.toast("Turnips only sell Sunday mornings 🥬"); return false; }
      const cost = S.tpBuy * n;
      if (gs.coins < cost) { DH.toast("Not enough coins 🪙"); return false; }
      const got = DH.inv.add("turnip", n);
      if (got <= 0) { DH.toast("Pockets are full! ☹️"); return false; }
      gs.coins -= S.tpBuy * got;
      own("turnip");
      alog("econ_turnip_buy", `${got}@${S.tpBuy}`);
      DH.toast(`Bought ${got} turnips @ 🪙${S.tpBuy} — sell before next Sunday!`);
      return true;
    },
    deposit(n) {
      if (!gs) return false;
      const amt = Math.min(n, Math.floor(gs.coins));
      if (amt <= 0) { DH.toast("No coins to deposit 🪙"); return false; }
      gs.coins -= amt; S.bank += amt;
      alog("econ_dep", amt);
      DH.toast(`Deposited 🪙${amt} — savings: 🪙${S.bank}`);
      return true;
    },
    withdraw(n) {
      if (!gs) return false;
      const amt = Math.min(n, S.bank);
      if (amt <= 0) { DH.toast("Savings are empty 🏧"); return false; }
      S.bank -= amt; gs.coins += amt;
      alog("econ_wd", amt);
      DH.toast(`Withdrew 🪙${amt} — savings: 🪙${S.bank}`);
      return true;
    },
    order(id) { // E-7 catalog reorder at 1.5x price, instant delivery
      const d = DH.items.get(id);
      if (!d || !gs || !S.owned.includes(id)) return false;
      const cost = Math.ceil(d.price * 1.5);
      if (cost <= 0) { DH.toast("Not orderable ☹️"); return false; }
      if (gs.coins < cost) { DH.toast("Not enough coins 🪙"); return false; }
      if (DH.inv.add(id, 1) <= 0) { DH.toast("Pockets are full! ☹️"); return false; }
      gs.coins -= cost; bigBuyHappy(cost);
      own(id);
      alog("econ_order", id);
      DH.toast(`Reordered ${d.name} — delivered! 📦`);
      return true;
    },
    buyMerchant(id, cost) { // E-9 rare goods
      const d = DH.items.get(id);
      if (!d || !gs || !merchantHere()) return false;
      if (!merchantGoods().some(g => g.id === id)) return false;
      if (gs.coins < cost) { DH.toast("Not enough coins 🪙"); return false; }
      if (DH.inv.add(id, 1) <= 0) { DH.toast("Pockets are full! ☹️"); return false; }
      gs.coins -= cost; bigBuyHappy(cost);
      own(id);
      coinFx(MERCH.x, MERCH.y - 18, 5);
      alog("econ_merch", id);
      DH.toast(`Rover is pleased! Bought ${d.name} ${d.ico}`);
      return true;
    },
  };

  // ---------- menus ----------
  function openShop() {
    const list = [
      { ico: "🛒", label: `Buy goods <small>(today's stock)</small>`, cb: openBuy },
      { ico: "💰", label: `Sell items <small>(🔥 ${DH.items.label(hotId())} pays ×2)</small>`, cb: openSell },
      { ico: "🏧", label: `ATM — savings 🪙${S.bank}`, cb: openATM },
      { ico: "📖", label: `Catalog — reorder owned (${S.owned.length})`, cb: openCatalog },
    ];
    if (sundayMorning())
      list.splice(1, 0, { ico: "🥬", label: `Turnips! 🪙${S.tpBuy} each <small>(Sunday only)</small>`, cb: openTurnipBuy });
    else if (DH.inv.count("turnip") > 0)
      list.splice(1, 0, { ico: "🥬", label: `Turnip rate today: 🪙${S.tpPrice} each`, cb: openSell });
    DH.menu.open("🏪 Nook's shop", list);
  }

  function openBuy() {
    const list = todayStock().map(s => {
      const d = DH.items.get(s.id);
      return { ico: d.ico, label: d.name, cost: s.cost, disabled: gs.coins < s.cost, cb: () => { API.buy(s.id, s.cost); openBuy(); } };
    });
    list.push({ ico: "◀️", label: "Back", cb: openShop });
    DH.menu.open("🛒 Nook's — today's goods", list);
  }

  function openSell() {
    const seen = {}, list = [];
    (gs.inv || []).forEach(s => { if (!seen[s.id]) seen[s.id] = true; });
    for (const id of Object.keys(seen)) {
      const n = DH.inv.count(id), u = sellUnit(id), d = DH.items.get(id) || { ico: "📦", name: id };
      list.push({
        ico: d.ico, disabled: u <= 0,
        label: `${d.name} ×${n} — +🪙${u * n}${id === hotId() ? " 🔥" : ""}${id === "turnip" ? " @rate" : ""}`,
        cb: () => { API.sellOne(id); openSell(); },
      });
    }
    list.unshift({
      ico: "💰", label: `<b>Sell everything</b> — +🪙${sellAllValue()}`,
      disabled: sellAllValue() <= 0, cb: () => { API.sellAll(); openSell(); },
    });
    list.push({ ico: "◀️", label: "Back", cb: openShop });
    DH.menu.open("💰 Sell to Nook", list);
  }
  function sellAllValue() {
    let v = 0;
    ((gs && gs.inv) || []).forEach(s => { const u = sellUnit(s.id); if (u > 0) v += u * s.n; });
    return v;
  }

  function openATM() {
    DH.menu.open(`🏧 ATM — savings 🪙${S.bank}`, [
      { ico: "📥", label: "Deposit 🪙50", disabled: gs.coins < 50, cb: () => { API.deposit(50); openATM(); } },
      { ico: "📥", label: "Deposit 🪙500", disabled: gs.coins < 500, cb: () => { API.deposit(500); openATM(); } },
      { ico: "📥", label: "Deposit all coins", disabled: gs.coins < 1, cb: () => { API.deposit(gs.coins); openATM(); } },
      { ico: "📤", label: "Withdraw 🪙50", disabled: S.bank < 50, cb: () => { API.withdraw(50); openATM(); } },
      { ico: "📤", label: "Withdraw 🪙500", disabled: S.bank < 500, cb: () => { API.withdraw(500); openATM(); } },
      { ico: "📤", label: "Withdraw all", disabled: S.bank < 1, cb: () => { API.withdraw(S.bank); openATM(); } },
      { ico: "◀️", label: "Back", cb: openShop },
    ]);
  }

  function openCatalog() {
    const orderable = S.owned.filter(id => (DH.items.get(id) || { price: 0 }).price > 0);
    const list = orderable.map(id => {
      const d = DH.items.get(id), cost = Math.ceil(d.price * 1.5);
      return { ico: d.ico, label: `${d.name} <small>(1.5×)</small>`, cost, disabled: gs.coins < cost, cb: () => { API.order(id); openCatalog(); } };
    });
    if (!list.length) list.push({ ico: "📖", label: "Nothing owned yet — buy something first!", disabled: true, cb: () => {} });
    list.push({ ico: "◀️", label: "Back", cb: openShop });
    DH.menu.open("📖 Nook catalog", list);
  }

  function openTurnipBuy() {
    const held = DH.inv.count("turnip");
    DH.menu.open(`🥬 Turnips @ 🪙${S.tpBuy} each (held ${held})`, [
      { ico: "🥬", label: "Buy 1 turnip", cost: S.tpBuy, disabled: gs.coins < S.tpBuy, cb: () => { API.buyTurnips(1); openTurnipBuy(); } },
      { ico: "🥬", label: "Buy 10 turnips", cost: S.tpBuy * 10, disabled: gs.coins < S.tpBuy * 10, cb: () => { API.buyTurnips(10); openTurnipBuy(); } },
      { ico: "◀️", label: "Back", cb: openShop },
    ]);
  }

  function openMerchant() {
    const list = merchantGoods().map(g => {
      const d = DH.items.get(g.id);
      return { ico: d.ico, label: `${d.name} <small>(rare!)</small>`, cost: g.cost, disabled: gs.coins < g.cost, cb: () => { API.buyMerchant(g.id, g.cost); openMerchant(); } };
    });
    list.push({ ico: "◀️", label: "Back", cb: () => DH.menu.close() });
    DH.menu.open("🧳 Rover's rare goods", list);
  }

  // ---------- drawing ----------
  function drawStall(ctx, px, py) {
    const now = Date.now();
    // plank deck pad under the stall
    R(ctx, px - 4, py + 22, 72, 12, "#b98d55");
    R(ctx, px - 4, py + 22, 72, 2, "#d0a86a");
    for (let i = 0; i < 3; i++) R(ctx, px + 6 + i * 20, py + 24, 1, 9, "#96693a");
    // back posts + striped awning
    R(ctx, px + 4, py - 16, 4, 40, "#7a5328");
    R(ctx, px + 56, py - 16, 4, 40, "#7a5328");
    R(ctx, px - 2, py - 22, 68, 10, "#c94f4f");
    for (let i = 0; i < 4; i++) R(ctx, px + 6 + i * 16, py - 22, 8, 10, "#f4e8d0");
    R(ctx, px - 2, py - 24, 68, 3, "#8d3232");
    // scalloped awning edge
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = i % 2 ? "#f4e8d0" : "#c94f4f";
      ctx.beginPath(); ctx.arc(px + 5 + i * 13.5, py - 12, 6.5, 0, Math.PI); ctx.fill();
    }
    // counter: top slab + panelled front
    R(ctx, px, py + 8, 64, 6, "#c8975c");
    R(ctx, px + 2, py + 14, 60, 20, "#a0733f");
    R(ctx, px + 2, py + 14, 60, 2, "#c09055");
    for (let i = 0; i < 3; i++) R(ctx, px + 12 + i * 18, py + 16, 2, 16, "#7a5527");
    R(ctx, px + 2, py + 32, 60, 2, "#6e4a2a");
    // "SHOP" painted on the counter
    ctx.fillStyle = "#3a2412"; ctx.font = "bold 8px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("NOOK", px + 32, py + 24);
    // goods on the counter
    R(ctx, px + 8, py + 2, 10, 7, "#d8b04a"); R(ctx, px + 9, py + 1, 8, 2, "#b08a32"); // crate of fruit
    R(ctx, px + 24, py + 1, 8, 8, "#7ec8e3");                                            // jar
    R(ctx, px + 40, py + 2, 12, 6, "#e07ba0"); R(ctx, px + 44, py, 4, 2, "#c05a80");     // folded cloth
    // hot-item poster on the right post
    const hot = DH.items.get(hotId());
    R(ctx, px + 60, py - 10, 16, 16, "#f4e8d0");
    R(ctx, px + 60, py - 10, 16, 2, "#c94f4f");
    ctx.font = "9px sans-serif"; ctx.fillText("🔥", px + 64, py + 1);
    if (hot) { ctx.font = "8px sans-serif"; ctx.fillText(hot.ico, px + 71, py + 1); }
    // hanging shop sign sways a little
    const sw = Math.sin(now / 900) * 1.5;
    ctx.save(); ctx.translate(px + 32 + sw, py - 30);
    R(ctx, -10, -4, 20, 8, "#a4763f"); R(ctx, -10, -4, 20, 2, "#8a5f30");
    ctx.fillStyle = "#3a2412"; ctx.font = "bold 6px sans-serif";
    ctx.fillText("SHOP", 0, 0.5);
    ctx.restore();
  }

  function drawBin(ctx, px, py) {
    // wooden sell bin — open top, coin slot, beside the stall
    R(ctx, px + 6, py + 12, 20, 20, "#8a6438");
    R(ctx, px + 4, py + 9, 24, 5, "#6e4a2a");          // rim
    R(ctx, px + 8, py + 10, 16, 3, "#3a2412");          // dark opening
    R(ctx, px + 6, py + 12, 20, 2, "#b08a52");
    for (let i = 0; i < 2; i++) R(ctx, px + 12 + i * 8, py + 15, 1, 15, "#6e4a2a");
    R(ctx, px + 13, py + 4, 6, 5, "#e8c860");           // coin peeking out
    ctx.fillStyle = "#3a2412"; ctx.font = "bold 6px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("SELL", px + 16, py + 24);
  }

  function drawMerchant(ctx, x, y) {
    const bob = Math.sin(Date.now() / 700) * 1;
    ctx.save(); ctx.translate(x, y + bob);
    // wares mat under his feet
    R(ctx, -18, -3, 40, 9, "#b05a7a");
    R(ctx, -18, -3, 40, 2, "#d47a9a"); R(ctx, -18, 4, 40, 2, "#8a3a5a");
    const g = merchantGoods();
    ctx.font = "8px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    g.forEach((it, i) => ctx.fillText(DH.items.get(it.id).ico, -12 + i * 13, 1));
    // legs
    R(ctx, -5, -6, 4, 6, "#3a3a4a"); R(ctx, 2, -6, 4, 6, "#3a3a4a");
    // teal coat + arms
    R(ctx, -7, -18, 14, 12, "#3a8a7a");
    R(ctx, -9, -17, 3, 9, "#2f7a6a"); R(ctx, 7, -17, 3, 9, "#2f7a6a");
    R(ctx, -7, -18, 14, 2, "#55aa9a");
    // big backpack bump
    R(ctx, 7, -20, 7, 12, "#8a5a3b"); R(ctx, 8, -22, 5, 3, "#a06a42");
    // head
    R(ctx, -6, -27, 12, 9, "#f2c9a0");
    R(ctx, -4, -24, 2, 2, "#1a1a1a"); R(ctx, 2, -24, 2, 2, "#1a1a1a");
    R(ctx, -1, -20, 3, 1, "#c08060");
    // straw hat
    R(ctx, -10, -29, 20, 3, "#e0c060");
    R(ctx, -6, -33, 12, 5, "#e0c060");
    R(ctx, -6, -29, 12, 1, "#b09040");
    ctx.restore();
  }

  function drawCoinFx(ctx, f, camX, camY) {
    const a = Math.max(0, 1 - f.age / f.ttl), x = f.x - camX, y = f.y - camY;
    ctx.save(); ctx.globalAlpha = a;
    ctx.fillStyle = "#e8c860";
    ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#b8933a"; ctx.fillRect(x - 1, y - 1.5, 2, 3);
    ctx.restore();
  }

  // ---------- day/slot transitions ----------
  function onNewDay(di) {
    S.lastDay = di;
    if (di % 7 === 0) { // Sunday rolls in
      const held = DH.inv.count("turnip");
      if (held > 0) {
        DH.inv.remove("turnip", held);
        DH.toast("Your turnips rotted! 🥬☹️", 3200);
        alog("econ_rot", held);
      }
      S.tpBuy = 90 + Math.floor(Math.random() * 21); // 🪙90–110
      S.tpPrice = S.tpBuy;
      alog("econ_sunday", S.tpBuy);
    }
  }
  function rollPrice() {
    const lo = Math.round(S.tpBuy * 0.5), hi = Math.round(S.tpBuy * 2);
    S.tpPrice = Math.max(lo, Math.min(hi, Math.round(S.tpPrice * (0.6 + Math.random() * 1.1))));
  }

  // ---------- module contract ----------
  const M = (DH.econ = {
    authority: true,
    _S: S, // debug/testing handle

    init(state) {
      gs = state;
      M.authority = !(DH.net && DH.net.online && DH.net.role === "guest");
      const W = DH.world;
      W.blocked.add(STALL.tx + "," + STALL.ty);
      W.blocked.add((STALL.tx + 1) + "," + STALL.ty);
      if (!W._econPatched) { // same trick furniture uses for world.blocked
        W._econPatched = true;
        const s0 = W.isSolid.bind(W);
        W.isSolid = (tx, ty) => s0(tx, ty) || W.blocked.has(tx + "," + ty);
      }
    },

    start(state) {
      gs = state;
      M.authority = !(DH.net && DH.net.online && DH.net.role === "guest");
      fx.length = 0;
      // fresh run: roll today (covers a brand-new Sunday morning's turnip price)
      if (S.lastDay < 0) onNewDay(dayIdx());
    },

    update(dt, state) {
      gs = state;
      // coin FX always tick so guests still animate
      for (let i = fx.length - 1; i >= 0; i--) {
        const f = fx[i];
        f.age += dt; f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 110 * dt;
        if (f.age >= f.ttl) { fx[i] = fx[fx.length - 1]; fx.pop(); }
      }
      if (!M.authority) return;

      // catalog: track everything that ever lands in pockets
      for (const s of state.inv || []) if (s && s.id) own(s.id);

      const di = Math.floor(state.day || 0);
      if (di !== S.lastDay) onNewDay(di);

      // turnip prices re-roll twice per game-day, Mon–Sat only
      const slot = di * 2 + (state.timeMin >= 12 * 60 ? 1 : 0);
      if (slot !== S.lastSlot) {
        S.lastSlot = slot;
        if (di % 7 !== 0 && S.tpBuy > 0) rollPrice();
      }
    },

    // shared-bus hook: savings interest while away (+0.5% per real day)
    offline(offMin) {
      const days = Math.floor(offMin / 1440);
      if (days < 1 || S.bank <= 0) return [];
      const interest = Math.round(S.bank * 0.005 * days);
      if (interest <= 0) return [];
      S.bank += interest;
      alog("econ_interest", interest);
      return [`your savings earned 🪙${interest} interest`];
    },

    interactables(p) {
      if (!gs || !gs.running) return [];
      const out = [];
      const dS = dist2(p.x, p.y, SHOP_PT.x, SHOP_PT.y);
      if (dS < SHOP_PT.r * SHOP_PT.r)
        out.push({ label: "Nook's shop 🏪", x: SHOP_PT.x, y: SHOP_PT.y, d2: dS, action: openShop });
      const dB = dist2(p.x, p.y, BIN_PT.x, BIN_PT.y);
      if (dB < BIN_PT.r * BIN_PT.r)
        out.push({ label: "Sell bin 🗑️ (20% fee)", x: BIN_PT.x, y: BIN_PT.y, d2: dB, action: () => API.dumpBin() });
      if (merchantHere()) {
        const dM = dist2(p.x, p.y, MERCH.x, MERCH.y);
        if (dM < MERCH.r * MERCH.r)
          out.push({ label: "Rover's rare goods 🧳", x: MERCH.x, y: MERCH.y, d2: dM, action: openMerchant });
      }
      out.sort((a, b) => a.d2 - b.d2);
      return out;
    },

    collectDraws(draws, camX, camY) {
      if (!ctxG) ctxG = document.getElementById("cv").getContext("2d");
      draws.push({ y: STALL.ty * T + T, fn: () => drawStall(ctxG, STALL.tx * T - camX, STALL.ty * T - camY) });
      draws.push({ y: 10 * T + T - 1, fn: () => drawBin(ctxG, 6 * T - camX, 10 * T - camY) });
      if (merchantHere())
        draws.push({ y: MERCH.y + 8, fn: () => { DH.sprites.shadow(ctxG, MERCH.x - camX, MERCH.y - camY + 6, 16); drawMerchant(ctxG, MERCH.x - camX, MERCH.y - camY); } });
    },

    drawOverlay(ctx, camX, camY, state) {
      ctxG = ctx;
      for (const f of fx) drawCoinFx(ctx, f, camX, camY);
      if (!state || !state.running) return;
      if (merchantHere()) { // floating marker so the visit is discoverable
        const tw = Math.sin(Date.now() / 350) * 2;
        ctx.font = "11px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText("🧳", MERCH.x - camX, MERCH.y - 40 + tw - camY);
      }
    },

    // ----- sync boundary -----
    serialize() {
      return JSON.parse(JSON.stringify({
        bank: S.bank, owned: S.owned, tpBuy: S.tpBuy, tpPrice: S.tpPrice,
        lastDay: S.lastDay, lastSlot: S.lastSlot,
      }));
    },
    deserialize(d) {
      if (!d) return;
      if (typeof d.bank === "number") S.bank = d.bank;
      if (Array.isArray(d.owned)) S.owned = d.owned.filter(x => typeof x === "string");
      if (typeof d.tpBuy === "number") S.tpBuy = d.tpBuy;
      if (typeof d.tpPrice === "number") S.tpPrice = d.tpPrice;
      if (typeof d.lastDay === "number") S.lastDay = d.lastDay;
      if (typeof d.lastSlot === "number") S.lastSlot = d.lastSlot;
    },
    remoteAction(name, args) {
      return typeof API[name] === "function" ? API[name].apply(null, args || []) : false;
    },

    // exposed API (menus + tests)
    buy: API.buy, sellOne: API.sellOne, sellAll: API.sellAll, dumpBin: API.dumpBin,
    buyTurnips: API.buyTurnips, deposit: API.deposit, withdraw: API.withdraw,
    order: API.order, buyMerchant: API.buyMerchant,
    openShop, todayStock, hotId, merchantGoods,
  });

  let ctxG = null;
})();

DH.register("econ", DH.econ);
