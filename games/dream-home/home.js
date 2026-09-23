/* dream-home home module — expansion loans, rooms, decorating, storage, HHA
   (spec F-1,F-3,F-4,F-5,F-6,F-7). Same module contract as garden.js/econ.js:
     DH.home.init(state) / start(state) / update(dt,state)
     DH.home.drawGround(ctx,camX,camY,state) — repaints interior/exterior tiles
     DH.home.collectDraws(draws,camX,camY)   — storage box + decorate easel
     DH.home.drawOverlay(ctx,camX,camY,state)— room label, construction tape
     DH.home.interactables(p) -> [{label,x,y,action}]
     DH.home.serialize()/deserialize(data)/remoteAction(name,args)/offline(offMin)

   F-1 loans: "Home office" lives at the mailbox. Loan tiers: +Room 🪙5000 →
   Loft 🪙15000 → Garden deck 🪙30000. Sign a loan for free, pay it off through
   the mailbox payment menu; a paid-off loan schedules construction for the
   NEXT game-day (update() checks the day rollover; offline() catches players
   who stayed away a full day). world.js owns the map so the footprint never
   grows — expansions are visual: an interior partition, a loft mezzanine band,
   and an exterior deck on the east yard strip.
   F-6 rooms: once +Room is built, a partition with two door gaps divides the
   interior at column x=10; the east half becomes "zuza's room" — its own
   label and its own decoration zone for HHA scoring.
   F-3 wallpaper & flooring: a "Decorate" easel inside the house sells 6
   wallpapers + 6 floors (polka/wood/stripes/sky/cozy/sakura). Starter styles
   are free and match the original look; bought styles stay owned forever and
   repaint the interior via drawGround.
   F-5 exterior: paint palettes (siding + roof + door frame) and door leaf
   styles at the mailbox, drawn over the house area in drawGround.
   F-4 storage: a fixed wooden box inside the house (item id "storage");
   unlimited stash/withdraw through menus — no furniture module needed.
   F-7 HHA: "Get scored" grades the home C..S from placed furniture, zuza's
   room decor, applied styles, expansions, tidiness (weeds via DH.forage when
   present) and organization, then pays coins + happiness once per game-day.

   Net-sync boundary: all state is plain JSON in S. Guests never run update()
   (game.js skips it for guests) — they render deserialize() snapshots;
   mutations are the named API fns exposed via remoteAction(name,args).
   Nothing here needs a tool module — every action works tool-free.
*/
(function () {
  const DH = (window.DH = window.DH || {});
  const T = 32;
  const R = (ctx, x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
  const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ---------- items ----------
  DH.items.def("storage", { name: "Storage box", ico: "📦", cat: "furniture", price: 200 });

  // ---------- world geometry ----------
  const IN_X1 = 4, IN_X2 = 14, IN_Y1 = 3, IN_Y2 = 8;      // interior floor tiles
  const ZROOM_X = 11;                                    // zuza's room: x >= 11
  const DIV_X = 10, DIV_GAPS = { 4: 1, 7: 1 };           // partition column + doorways
  const DIV_SOLID = [3, 5, 6, 8];                        // blocked divider tiles
  const DECK_X = 16, DECK_Y1 = 3, DECK_Y2 = 9;           // east yard strip
  const WIN_N = [5, 7, 10, 12], WIN_S = [5, 7, 11, 13];  // house windows (see world.js)
  const DOOR = { tx: 9, ty: 9 };
  const MAIL = { x: 10 * T + 16, y: 11 * T + 16, r: 46 }; // mailbox tile, yard
  const BOX = { tx: 14, ty: 3 };                          // storage box (NE interior corner)
  const EASEL = { tx: 4, ty: 8 };                         // decorate easel (SW interior corner)
  const DAY_MIN = 6;                                      // ~6 real minutes per game-day

  // ---------- catalogs ----------
  const TIERS = [
    null,
    { name: "+Room", cost: 5000, desc: "a partition adds zuza's room" },
    { name: "Loft", cost: 15000, desc: "a cozy upstairs loft look" },
    { name: "Garden deck", cost: 30000, desc: "a deck facing the garden" },
  ];
  // default styles reproduce the original world's look (skipped at draw time)
  const WALLS_L = [
    { id: "wood", name: "Wood panels", ico: "🪵", cost: 0, bg: "#9c6740", fg: "#8a5733", pat: "panels" },
    { id: "polka", name: "Polka dots", ico: "🔵", cost: 120, bg: "#f0e2ee", fg: "#c878a8", pat: "polka" },
    { id: "stripes", name: "Stripes", ico: "📏", cost: 120, bg: "#e2ead6", fg: "#a4c4a8", pat: "vstripes" },
    { id: "sky", name: "Sky", ico: "☁️", cost: 160, bg: "#aad8f0", fg: "#ffffff", pat: "sky" },
    { id: "cozy", name: "Cozy", ico: "🧸", cost: 160, bg: "#eedcba", fg: "#d8a878", pat: "cozy" },
    { id: "sakura", name: "Sakura", ico: "🌸", cost: 200, bg: "#f2ceda", fg: "#e898b4", pat: "sakura" },
  ];
  const FLOORS_L = [
    { id: "wood", name: "Hardwood", ico: "🪵", cost: 0, bg: "#d9a862", fg: "#b98346", pat: "planks" },
    { id: "polka", name: "Polka tiles", ico: "🔵", cost: 150, bg: "#f0e8da", fg: "#7aa8d8", pat: "polka" },
    { id: "stripes", name: "Stripe boards", ico: "📏", cost: 150, bg: "#dcc9a0", fg: "#bd9e6a", pat: "stripes" },
    { id: "sky", name: "Sky floor", ico: "☁️", cost: 180, bg: "#9cc8e8", fg: "#f4f8ff", pat: "sky" },
    { id: "cozy", name: "Cozy carpet", ico: "🧶", cost: 180, bg: "#c4806e", fg: "#a26050", pat: "cozy" },
    { id: "sakura", name: "Sakura tatami", ico: "🌸", cost: 220, bg: "#e8c6c6", fg: "#d0a0a8", pat: "sakura" },
  ];
  const PAINTS_L = [
    { id: "cedar", name: "Classic cedar", ico: "🏠", cost: 0, side: "#9c6740", sideD: "#8a5733", trim: "#b07c50", roof: "#8d5236", roofD: "#6e3f2a" },
    { id: "barn", name: "Barn red", ico: "🏡", cost: 150, side: "#a84838", sideD: "#8f3628", trim: "#c05a48", roof: "#5a3a4a", roofD: "#452c3a" },
    { id: "sky", name: "Sky blue", ico: "🩵", cost: 150, side: "#7ea8c8", sideD: "#6a94b4", trim: "#9cc0da", roof: "#4a5a7a", roofD: "#3a4a64" },
    { id: "mint", name: "Mint", ico: "🌿", cost: 150, side: "#8ab898", sideD: "#76a484", trim: "#a4d0b0", roof: "#4a6a52", roofD: "#3a5442" },
    { id: "cream", name: "Cream white", ico: "🤍", cost: 200, side: "#e8dcc0", sideD: "#d4c4a4", trim: "#f4ecd8", roof: "#7a5a4a", roofD: "#5f4538" },
  ];
  const DOORS_L = [
    { id: "classic", name: "Open doorway", ico: "🚪", cost: 0 },
    { id: "round", name: "Round door", ico: "🟤", cost: 80 },
    { id: "modern", name: "Modern door", ico: "🪟", cost: 80 },
    { id: "heart", name: "Heart door", ico: "💗", cost: 120 },
  ];
  const byId = list => { const m = {}; list.forEach(d => (m[d.id] = d)); return m; };
  const WALLS = byId(WALLS_L), FLOORS = byId(FLOORS_L), PAINTS = byId(PAINTS_L), DOORS = byId(DOORS_L);
  const KIND_CAT = { wp: WALLS, fl: FLOORS, paint: PAINTS, door: DOORS };
  const KIND_STARTER = { wp: "wood", fl: "wood", paint: "cedar", door: "classic" };

  // ---------- module state (plain JSON only — save bus + net snapshots) ----------
  let gs = null;
  const S = {
    tier: 0,          // owned expansion level 0..3
    loan: null,       // {tier, owed, paid} — active mortgage toward next tier
    pending: 0,       // tier under construction (built when day >= readyDay)
    readyDay: 0,
    wp: "wood", fl: "wood", paint: "cedar", door: "classic",
    own: { wp: ["wood"], fl: ["wood"], paint: ["cedar"], door: ["classic"] },
    box: {},          // storage contents: itemId -> count
    scoreDay: -1, lastScore: 0, lastGrade: "",
  };
  let ctxG = null;
  const alog = (e, d) => { if (DH.alog) DH.alog.add(e, d); };

  // ---------- collision fixtures ----------
  const FIXTURE_TILES = [BOX, EASEL].map(t => t.tx + "," + t.ty);
  const DIV_TILES = DIV_SOLID.map(y => DIV_X + "," + y);
  function syncBlocks() {
    const W = DH.world;
    if (!W || !W.blocked) return;
    FIXTURE_TILES.forEach(k => W.blocked.add(k));
    DIV_TILES.forEach(k => { if (S.tier >= 1) W.blocked.add(k); else W.blocked.delete(k); });
  }

  // ---------- named mutations (remote-callable) ----------
  function takeLoan() {
    const t = TIERS[S.tier + 1];
    if (!t || S.loan || S.pending || !gs) return false;
    S.loan = { tier: S.tier + 1, owed: t.cost, paid: 0 };
    alog("home_loan", t.name);
    DH.toast(`📝 ${t.name} loan signed — pay off 🪙${t.cost} and construction finishes tomorrow!`, 3400);
    return true;
  }

  function payLoan(n) {
    if (!S.loan || !gs) return false;
    const rem = S.loan.owed - S.loan.paid;
    const amt = Math.min(n, rem, Math.floor(gs.coins));
    if (amt <= 0) { DH.toast("Not enough coins 🪙"); return false; }
    gs.coins -= amt;
    S.loan.paid += amt;
    alog("home_pay", amt);
    if (S.loan.paid >= S.loan.owed) {
      const t = TIERS[S.loan.tier];
      S.pending = S.loan.tier;
      S.readyDay = Math.floor(gs.day || 0) + 1;
      S.loan = null;
      DH.toast(`🎉 Loan paid off! ${t.name} — the builders finish tomorrow 🚧`, 3600);
    } else {
      DH.toast(`Paid 🪙${amt} — 🪙${S.loan.owed - S.loan.paid} left on the loan`);
    }
    return true;
  }

  function applyBuild(quiet) {
    if (!S.pending) return;
    S.tier = S.pending;
    S.pending = 0;
    syncBlocks();
    const t = TIERS[S.tier];
    alog("home_built", t.name);
    if (!quiet && t) DH.toast(`🏡 ${t.name} built — ${t.desc}!`, 4000);
  }

  // buy (once) + apply a style: kind in {wp,fl,paint,door}
  function buyStyle(kind, id) {
    const cat = KIND_CAT[kind], d = cat && cat[id];
    if (!d || !gs || !S.own[kind]) return false;
    if (!S.own[kind].includes(id)) {
      if (gs.coins < d.cost) { DH.toast("Not enough coins 🪙"); return false; }
      gs.coins -= d.cost;
      S.own[kind].push(id);
      alog("home_buy", `${kind}:${id}`);
    }
    S[kind] = id;
    alog("home_style", `${kind}:${id}`);
    return true;
  }

  function storeItem(id, n) {
    if (!gs || !DH.items.get(id)) return false;
    n = Math.min(n == null ? 1 : n | 0, DH.inv.count(id));
    if (n <= 0) return false;
    DH.inv.remove(id, n);
    S.box[id] = (S.box[id] || 0) + n;
    alog("home_store", `${id}x${n}`);
    DH.toast(`Stored ${DH.items.label(id)} ×${n} 📦`);
    return true;
  }

  function storeAll() {
    if (!gs) return 0;
    let n = 0;
    (gs.inv || []).slice().forEach(s => {
      if (s && s.id && s.n > 0) {
        const n0 = s.n;              // inv.remove mutates s.n in place — capture first
        DH.inv.remove(s.id, s.n);
        S.box[s.id] = (S.box[s.id] || 0) + n0;
        n += n0;
      }
    });
    if (!n) { DH.toast("Pockets are empty ☹️"); return 0; }
    alog("home_storeall", n);
    DH.toast(`Stored ${n} item${n > 1 ? "s" : ""} 📦`);
    return n;
  }

  function takeItem(id, n) {
    const have = S.box[id] || 0;
    if (!have || !gs) return false;
    n = Math.min(n == null ? have : n | 0, have);
    const got = DH.inv.add(id, n);
    if (got <= 0) { DH.toast("Pockets are full! ☹️"); return false; }
    S.box[id] -= got;
    if (!S.box[id]) delete S.box[id];
    alog("home_take", `${id}x${got}`);
    DH.toast(`Took ${DH.items.label(id)} ×${got} 📤${got < n ? " (pockets full)" : ""}`);
    return got;
  }

  // ---------- F-7 Happy Home score ----------
  function weedCount() {
    const F = DH.forage;
    if (!F) return null; // module not present — tidy by default
    try {
      if (typeof F.weedCount === "function") return F.weedCount() | 0;
      if (Array.isArray(F.weeds)) return F.weeds.length;
      if (F._state && Array.isArray(F._state.weeds)) return F._state.weeds.length;
      if (typeof F.serialize === "function") {
        const d = F.serialize();
        if (d && Array.isArray(d.weeds)) return d.weeds.length;
      }
    } catch (e) {}
    return null;
  }

  function hhaScore() {
    if (!gs) return false;
    const f = DH.furniture && typeof DH.furniture.serialize === "function" ? DH.furniture.serialize() : null;
    const placed = (f && Array.isArray(f.items) ? f.items : []);
    const zuzaItems = placed.filter(it => it && it.x0 >= ZROOM_X).length;
    const weeds = weedCount();
    const parts = [
      { ico: "🪑", label: "Furniture placed", pts: Math.min(80, placed.length * 8) },
      { ico: "💗", label: "zuza's room decorated", pts: Math.min(20, zuzaItems * 4) },
      { ico: "🎨", label: "Wallpaper & flooring", pts: (S.wp !== "wood" ? 12 : 0) + (S.fl !== "wood" ? 12 : 0) },
      { ico: "🏠", label: "Exterior & door", pts: (S.paint !== "cedar" ? 10 : 0) + (S.door !== "classic" ? 6 : 0) },
      { ico: "🏗️", label: "Expansions", pts: S.tier * 15 },
      { ico: "🧹", label: "Tidiness", pts: weeds == null ? 8 : Math.max(0, 15 - weeds * 5) },
      { ico: "📦", label: "Organized storage", pts: Object.keys(S.box).length ? 5 : 0 },
    ];
    const pts = parts.reduce((s, p) => s + p.pts, 0);
    const grade = pts >= 150 ? "S" : pts >= 110 ? "A" : pts >= 70 ? "B" : "C";
    const HAPPY = { S: 14, A: 10, B: 6, C: 3 };
    const today = Math.floor(gs.day || 0);
    const rewardable = today !== S.scoreDay;
    let pay = 0;
    if (rewardable) {
      S.scoreDay = today;
      pay = pts;
      gs.coins += pay;
      gs.happiness += HAPPY[grade];
      alog("home_hha", `${grade}:${pts}`);
    }
    S.lastScore = pts; S.lastGrade = grade;
    const rows = parts.map(p => ({ ico: p.ico, label: `${p.label} — ${p.pts} pts`, disabled: true, cb: () => {} }));
    rows.unshift({
      ico: "🏅", disabled: true, cb: () => {},
      label: `<b>Grade ${grade} — ${pts} pts</b><br><small>${rewardable ? `+🪙${pay} +🏠${HAPPY[grade]} — rescore tomorrow!` : "Reward already claimed today — rescore tomorrow"}</small>`,
    });
    DH.menu.open("🏅 Happy Home score", rows);
    return true;
  }

  // ---------- menus ----------
  function openOffice() {
    const list = [];
    const t = TIERS[S.tier + 1];
    if (S.pending)
      list.push({ ico: "🚧", label: `${TIERS[S.pending].name} — builders finish tomorrow`, disabled: true, cb: () => {} });
    else if (S.loan)
      list.push({ ico: "💰", label: `Pay ${TIERS[S.loan.tier].name} loan — 🪙${S.loan.owed - S.loan.paid} left`, cb: openPay });
    else if (t)
      list.push({ ico: "🏗️", label: `Expand: ${t.name} <small>${t.desc} — loan 🪙${t.cost}</small>`, cb: () => { takeLoan(); openOffice(); } });
    else
      list.push({ ico: "🏡", label: "Fully expanded — dream home complete!", disabled: true, cb: () => {} });
    list.push({ ico: "🎨", label: "Paint exterior", cb: openPaint });
    list.push({ ico: "🚪", label: "Door style", cb: openDoor });
    list.push({ ico: "🏅", label: `Get scored (HHA)${S.lastGrade ? ` — last: ${S.lastGrade}` : ""}`, cb: hhaScore });
    DH.menu.open("🏦 Home office", list);
  }

  function openPay() {
    if (!S.loan) { openOffice(); return; }
    const rem = S.loan.owed - S.loan.paid;
    const pay = n => { payLoan(n); if (S.loan) openPay(); else openOffice(); };
    DH.menu.open(`💰 ${TIERS[S.loan.tier].name} loan — 🪙${rem} left`, [
      { ico: "🪙", label: "Pay 100", cost: 100, disabled: gs.coins < 100, cb: () => pay(100) },
      { ico: "🪙", label: "Pay 500", cost: 500, disabled: gs.coins < 500, cb: () => pay(500) },
      { ico: "🪙", label: "Pay 1,000", cost: 1000, disabled: gs.coins < 1000, cb: () => pay(1000) },
      { ico: "💸", label: `Pay it all — 🪙${rem}`, cost: rem, disabled: gs.coins < rem, cb: () => pay(rem) },
      { ico: "◀️", label: "Back", cb: openOffice },
    ]);
  }

  function styleMenu(kind, title, list, back) {
    const rows = list.map(d => {
      const owned = S.own[kind].includes(d.id), active = S[kind] === d.id;
      return {
        ico: d.ico, cost: owned ? null : d.cost,
        disabled: !owned && (!gs || gs.coins < d.cost),
        label: `${d.name}${active ? " ✓ on" : owned ? " <small>(owned)</small>" : ""}`,
        cb: () => { buyStyle(kind, d.id); styleMenu(kind, title, list, back); },
      };
    });
    rows.push({ ico: "◀️", label: "Back", cb: back });
    DH.menu.open(title, rows);
  }

  const openPaint = () => styleMenu("paint", "🎨 Paint exterior", PAINTS_L, openOffice);
  const openDoor = () => styleMenu("door", "🚪 Door style", DOORS_L, openOffice);
  const openWall = () => styleMenu("wp", "🎨 Wallpaper", WALLS_L, openDecorate);
  const openFloor = () => styleMenu("fl", "🧶 Flooring", FLOORS_L, openDecorate);

  function openDecorate() {
    DH.menu.open("🎨 Decorate", [
      { ico: "🖼️", label: `Wallpaper — ${WALLS[S.wp].name}`, cb: openWall },
      { ico: "🧶", label: `Flooring — ${FLOORS[S.fl].name}`, cb: openFloor },
      { ico: "💗", label: `zuza's room ${S.tier >= 1 ? "(east side)" : "— unlocks with +Room"}`, disabled: true, cb: () => {} },
      { ico: "◀️", label: "Back", cb: () => DH.menu.close() },
    ]);
  }

  function openBox() {
    const total = Object.values(S.box).reduce((s, n) => s + n, 0);
    DH.menu.open(`📦 Storage box — ${total} item${total === 1 ? "" : "s"}`, [
      { ico: "📥", label: "Put items away", cb: openStore },
      { ico: "📦", label: "Put EVERYTHING away", disabled: !(gs && gs.inv && gs.inv.length), cb: () => { storeAll(); openBox(); } },
      { ico: "📤", label: "Take items out", cb: openTake },
    ]);
  }
  function openStore() {
    const rows = (gs.inv || []).map(s => {
      const d = DH.items.get(s.id) || { ico: "📦", name: s.id };
      return { ico: d.ico, label: `${d.name} ×${s.n}`, cb: () => { storeItem(s.id, s.n); openStore(); } };
    });
    if (!rows.length) rows.push({ ico: "🫳", label: "Pockets are empty", disabled: true, cb: () => {} });
    rows.push({ ico: "◀️", label: "Back", cb: openBox });
    DH.menu.open("📥 Put away", rows);
  }
  function openTake() {
    const rows = Object.keys(S.box).map(id => {
      const d = DH.items.get(id) || { ico: "📦", name: id };
      return { ico: d.ico, label: `${d.name} ×${S.box[id]}`, cb: () => { takeItem(id, S.box[id]); openTake(); } };
    });
    if (!rows.length) rows.push({ ico: "🫙", label: "The box is empty", disabled: true, cb: () => {} });
    rows.push({ ico: "◀️", label: "Back", cb: openBox });
    DH.menu.open("📤 Take out", rows);
  }

  // ---------- drawing ----------
  function drawWindow(ctx, px, py) {
    R(ctx, px + 8, py + 9, 16, 15, "#f3e7cf");
    R(ctx, px + 10, py + 11, 12, 11, "#86b8d4");
    R(ctx, px + 15, py + 11, 2, 11, "#f3e7cf");
    R(ctx, px + 10, py + 16, 12, 1, "#f3e7cf");
    R(ctx, px + 7, py + 24, 18, 2, "#d9c9a8");
  }
  function drawSidingTile(ctx, px, py, pal) {
    R(ctx, px, py, T, T, pal.side);
    ctx.fillStyle = pal.sideD;
    for (let r = 0; r < 5; r++) ctx.fillRect(px, py + 5 + r * 6, T, 1);
    R(ctx, px, py + T - 5, T, 5, "rgba(0,0,0,0.12)");
    R(ctx, px, py, T, 3, pal.trim);
  }
  // pattern fill inside a rect for wallpaper/floor styles
  function drawPattern(ctx, px, py, w, h, d) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(px, py, w, h);
    ctx.clip();
    R(ctx, px, py, w, h, d.bg);
    ctx.fillStyle = d.fg;
    switch (d.pat) {
      case "polka":
        for (let j = 0; j * 16 < h + 8; j++)
          for (let i = 0; i * 16 < w + 8; i++) {
            ctx.beginPath();
            ctx.arc(px + 8 + i * 16 + (j % 2) * 8, py + 8 + j * 16, 2.6, 0, 7);
            ctx.fill();
          }
        break;
      case "stripes":
        for (let r = 0; r * 8 < h; r += 2) ctx.fillRect(px, py + r * 8, w, 4);
        break;
      case "vstripes":
        for (let c = 0; c * 8 < w; c += 2) ctx.fillRect(px + c * 8, py, 4, h);
        break;
      case "sky":
        for (let i = 0; i * 22 < w + 16; i++) {
          const cy = py + 7 + (i % 3) * 9;
          ctx.fillRect(px + 4 + i * 22, cy, 10, 4);
          ctx.fillRect(px + 7 + i * 22, cy - 2, 5, 2);
        }
        break;
      case "cozy":
        ctx.strokeStyle = d.fg; ctx.lineWidth = 2;
        ctx.strokeRect(px + 2.5, py + 2.5, w - 5, h - 5);
        ctx.fillRect(px + 10, py + 8, 3, 3); ctx.fillRect(px + 20, py + 20, 3, 3);
        ctx.fillRect(px + 22, py + 9, 2, 2); ctx.fillRect(px + 9, py + 21, 2, 2);
        break;
      case "sakura":
        ctx.fillRect(px, py + 14, w, 2); ctx.fillRect(px + 14, py, 2, h);
        for (let i = 0; i * 20 < w + 10; i++)
          ctx.fillRect(px + 6 + i * 20, py + 6 + (i % 2) * 16, 4, 4);
        break;
      case "planks":
        ctx.fillRect(px, py + 7, w, 1); ctx.fillRect(px, py + 15, w, 1); ctx.fillRect(px, py + 23, w, 1); ctx.fillRect(px, py + 31, w, 1);
        break;
      case "panels":
        ctx.fillRect(px, py + 7, w, 1); ctx.fillRect(px, py + 15, w, 1); ctx.fillRect(px, py + 23, w, 1);
        break;
    }
    ctx.restore();
  }
  function drawFloorTile(ctx, px, py, d) {
    drawPattern(ctx, px, py, T, T, d);
    R(ctx, px, py + T - 1, T, 1, "rgba(0,0,0,0.08)"); // base edge
  }
  function drawWallPanel(ctx, px, py, w, h, d) {
    drawPattern(ctx, px, py, w, h, d);
    R(ctx, px, py + h - 3, w, 3, "rgba(0,0,0,0.16)"); // baseboard shadow
  }

  // F-5 exterior repaint — skipped for the starter palette (world art shows)
  function drawExterior(ctx, camX, camY, pal) {
    // roof band over the top wall row + chimney
    const rx = 3 * T - 2 - camX, rw = 13 * T + 4, ry = 2 * T - 16 - camY;
    R(ctx, rx, ry, rw, 18, pal.roof);
    R(ctx, rx, ry, rw, 3, pal.roofD);
    R(ctx, rx, ry + 15, rw, 3, "rgba(0,0,0,0.25)");
    for (let i = 0; i < 3; i++) R(ctx, rx, ry + 5 + i * 4, rw, 1, pal.roofD);
    R(ctx, 13 * T + 19 - camX, 2 * T - 24 - camY, 11, 17, "#8a4a3a"); // chimney
    R(ctx, 13 * T + 18 - camX, 2 * T - 26 - camY, 13, 4, "#6e352a");
    R(ctx, 13 * T + 19 - camX, 2 * T - 19 - camY, 11, 1, "rgba(0,0,0,0.15)");
    // wall tiles: corners + side exterior strips + south wall face
    drawSidingTile(ctx, 3 * T - camX, 2 * T - camY, pal);
    drawSidingTile(ctx, 15 * T - camX, 2 * T - camY, pal);
    drawSidingTile(ctx, 3 * T - camX, 9 * T - camY, pal);
    drawSidingTile(ctx, 15 * T - camX, 9 * T - camY, pal);
    for (let y = IN_Y1; y <= IN_Y2; y++) {
      drawSidingTile(ctx, 3 * T - camX, y * T - camY, pal);   // west wall
      drawSidingTile(ctx, 15 * T - camX, y * T - camY, pal);  // east wall
    }
    for (let x = IN_X1; x <= IN_X2; x++) {
      if (x === DOOR.tx) continue;
      drawSidingTile(ctx, x * T - camX, 9 * T - camY, pal);   // south face
      if (WIN_S.includes(x)) drawWindow(ctx, x * T - camX, 9 * T - camY);
    }
    // door frame posts (world drew these; repaint covers them)
    R(ctx, 8 * T + T - 3 - camX, 9 * T + 4 - camY, 3, T - 4, pal.sideD);
    R(ctx, 10 * T - camX, 9 * T + 4 - camY, 3, T - 4, pal.sideD);
    // north wall: when wallpaper is the starter "wood", repaint its siding too
    if (S.wp === "wood")
      for (let x = IN_X1; x <= IN_X2; x++) {
        drawSidingTile(ctx, x * T - camX, 2 * T - camY, pal);
        if (WIN_N.includes(x)) drawWindow(ctx, x * T - camX, 2 * T - camY);
      }
  }

  // F-3 interior repaint — floor tiles + wallpaper on the interior wall faces
  function drawInterior(ctx, camX, camY) {
    const fl = FLOORS[S.fl], wp = WALLS[S.wp];
    if (fl.id !== "wood")
      for (let y = IN_Y1; y <= IN_Y2; y++)
        for (let x = IN_X1; x <= IN_X2; x++)
          drawFloorTile(ctx, x * T - camX, y * T - camY, fl);
    if (wp.id !== "wood") {
      for (let x = IN_X1; x <= IN_X2; x++) {  // north wall inner face
        drawWallPanel(ctx, x * T - camX, 2 * T - camY, T, T, wp);
        if (WIN_N.includes(x)) drawWindow(ctx, x * T - camX, 2 * T - camY);
      }
      for (let y = IN_Y1; y <= IN_Y2; y++) {  // side walls' inner strips
        drawWallPanel(ctx, 3 * T + 22 - camX, y * T - camY, 10, T, wp);
        drawWallPanel(ctx, 15 * T - camX, y * T - camY, 10, T, wp);
      }
      for (let x = IN_X1; x <= IN_X2; x++) {  // south wall inner face = thin strip
        if (x === DOOR.tx) continue;
        drawWallPanel(ctx, x * T - camX, 9 * T - camY, T, 6, wp);
      }
    }
  }

  // F-6 partition wall at x=10 with door gaps at y=4,y=7
  function drawDivider(ctx, camX, camY, wp) {
    for (const y of [3, 4, 5, 6, 7, 8]) {
      const px = DIV_X * T - camX, py = y * T - camY;
      if (DIV_GAPS[y]) { // doorway: lintel + threshold + jamb caps
        R(ctx, px - 3, py, 14, 4, "#7a4a2c");
        R(ctx, px - 3, py + T - 4, 14, 4, "#7a4a2c");
        R(ctx, px - 3, py + 4, 3, T - 8, "#8a5a3b");
        continue;
      }
      R(ctx, px - 3, py, 14, T, "#8a5a3b");                  // wall core on the boundary
      R(ctx, px - 3, py, 14, 2, "#a06a42");
      R(ctx, px - 3, py + T - 4, 14, 4, "#6f4327");          // baseboard
      R(ctx, px + 9, py + 2, 2, T - 6, wp.id === "wood" ? "#7a4a2c" : wp.bg); // zuza-side face
      R(ctx, px - 3, py + 2, 2, T - 6, wp.id === "wood" ? "#7a4a2c" : wp.bg); // main-side face
    }
  }

  // F-1 tier 2: loft mezzanine across the north interior
  function drawLoft(ctx, camX, camY) {
    const x0 = 4 * T - camX, x1 = 15 * T - camX;
    const y0 = 3 * T - camY, y1 = 4 * T + 12 - camY;
    R(ctx, x0, y0, x1 - x0, y1 - y0, "#b08148");            // boards
    for (let r = 0; r < 6; r++) R(ctx, x0, y0 + 6 + r * 8, x1 - x0, 1, "#9c6e3c");
    for (let c = 0; c < 11; c++) R(ctx, x0 + 16 + c * 32, y0, 1, y1 - y0, "#9c6e3c");
    R(ctx, x0, y1, x1 - x0, 6, "#7a5328");                   // front beam
    R(ctx, x0, y1 + 6, x1 - x0, 4, "rgba(0,0,0,0.18)");      // cast shadow
    for (let c = 0; c < 6; c++) {                            // railing
      const rx = x0 + 10 + c * 62;
      R(ctx, rx, y1 - 9, 3, 9, "#6f4327");
    }
    R(ctx, x0, y1 - 11, x1 - x0, 3, "#8a5a3b");              // rail top
    const lx = 4 * T + 18 - camX;                            // ladder up the west end
    R(ctx, lx, y1 - 2, 3, 48, "#7a5328"); R(ctx, lx + 13, y1 - 2, 3, 48, "#7a5328");
    for (let i = 0; i < 5; i++) R(ctx, lx, y1 + 4 + i * 9, 16, 2, "#96693a");
  }

  // F-1 tier 3: wooden deck on the east yard strip facing the garden
  function drawDeck(ctx, camX, camY) {
    const px = DECK_X * T - camX;
    for (let y = DECK_Y1; y <= DECK_Y2; y++) {
      const py = y * T - camY;
      R(ctx, px, py, T, T, "#c89a5e");
      R(ctx, px, py, T, 2, "#d8b075");
      R(ctx, px, py + 10, T, 1, "#a87a48"); R(ctx, px, py + 21, T, 1, "#a87a48");
      R(ctx, px + 26, py + 3, 2, 9, "#7a5328");              // east rail posts
      R(ctx, px + 26, py + 18, 2, 9, "#7a5328");
    }
    R(ctx, px + 26, DECK_Y1 * T - camY, 4, (DECK_Y2 - DECK_Y1 + 1) * T, "#96693a"); // rail
    R(ctx, px + 25, DECK_Y1 * T - camY, 6, 3, "#b08a52");
    const sy = 9 * T - camY + 24;                             // steps down to the path
    R(ctx, px + 4, sy, 24, 4, "#b08a52");
    R(ctx, px + 6, sy + 5, 20, 3, "#96693a");
    R(ctx, px + 3, 3 * T - camY + 2, 8, 10, "#a4763f");        // potted plant on the deck
    R(ctx, px + 4, 3 * T - camY + 4, 6, 6, "#8a5f30");
    ctx.fillStyle = "#4fae4f"; ctx.fillRect(px + 3, 3 * T - camY - 2, 8, 5);
  }

  // F-5 door leaf styles ("classic" keeps the open doorway look)
  function drawDoor(ctx, camX, camY) {
    if (S.door === "classic") return;
    const px = DOOR.tx * T - camX, py = DOOR.ty * T - camY;
    if (S.door === "round") {
      R(ctx, px + 5, py + 8, 22, 24, "#6f4327");
      ctx.fillStyle = "#6f4327";
      ctx.beginPath(); ctx.arc(px + 16, py + 9, 11, Math.PI, 0); ctx.fill();
      R(ctx, px + 7, py + 10, 18, 21, "#96693a");
      ctx.fillStyle = "#96693a";
      ctx.beginPath(); ctx.arc(px + 16, py + 10, 8, Math.PI, 0); ctx.fill();
      R(ctx, px + 15, py + 4, 2, 27, "#7a5328");
      R(ctx, px + 20, py + 19, 3, 3, "#e8c860");               // knob
    } else if (S.door === "modern") {
      R(ctx, px + 4, py + 2, 24, 30, "#3a3a44");
      R(ctx, px + 6, py + 4, 20, 26, "#4a5560");
      R(ctx, px + 9, py + 6, 14, 8, "#86b8d4");                // glass
      R(ctx, px + 15, py + 6, 2, 8, "#4a5560");
      R(ctx, px + 22, py + 18, 3, 2, "#cfd8e3");               // handle bar
    } else if (S.door === "heart") {
      R(ctx, px + 5, py + 4, 22, 28, "#e07ba0");
      R(ctx, px + 5, py + 4, 22, 3, "#f09abc");
      R(ctx, px + 7, py + 7, 18, 22, "#d4608e");
      DH.sprites.heart(ctx, px + 16, py + 13, 6, "#fff0f4");
      R(ctx, px + 20, py + 20, 3, 3, "#ffd76b");
    }
  }

  // construction barrier across the affected area while pending
  function drawTape(ctx, camX, camY) {
    if (!S.pending) return;
    const areas = {
      1: { x: DIV_X * T - 4, y: 3 * T, w: 8, h: 6 * T },
      2: { x: 4 * T, y: 3 * T, w: 11 * T, h: 8 },
      3: { x: DECK_X * T, y: 3 * T, w: 8, h: 7 * T },
    };
    const a = areas[S.pending];
    if (!a) return;
    const px = a.x - camX, py = a.y - camY;
    for (let i = 0; i * 10 < a.h; i++)
      R(ctx, px, py + i * 10, a.w, 5, i % 2 ? "#ffd76b" : "#3a3a44");
    ctx.font = "12px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("🚧", px + a.w + 9, py + 10);
  }

  function drawBox(ctx, px, py) {
    R(ctx, px + 4, py + 10, 24, 18, "#8a6438");          // chest body
    R(ctx, px + 4, py + 10, 24, 2, "#b08a52");
    for (let i = 0; i < 2; i++) R(ctx, px + 11 + i * 8, py + 12, 1, 15, "#6e4a2a");
    R(ctx, px + 2, py + 7, 28, 5, "#6e4a2a");            // lid rim
    R(ctx, px + 4, py + 8, 24, 3, "#96693a");            // lid
    R(ctx, px + 14, py + 12, 4, 6, "#e8c860");           // lock
    R(ctx, px + 4, py + 26, 24, 2, "#5f3d22");           // base
  }
  function drawEasel(ctx, px, py) {
    R(ctx, px + 9, py + 4, 14, 15, "#f4ecd8");           // canvas
    R(ctx, px + 9, py + 4, 14, 2, "#d8c8a8");
    R(ctx, px + 11, py + 8, 4, 4, "#e0607e");            // paint blobs
    R(ctx, px + 17, py + 11, 4, 4, "#7ec8e3");
    R(ctx, px + 12, py + 14, 8, 2, "#d8b04a");
    R(ctx, px + 7, py + 19, 3, 11, "#7a5328");           // legs
    R(ctx, px + 22, py + 19, 3, 11, "#7a5328");
    R(ctx, px + 14, py + 21, 4, 9, "#5f3d22");           // rear leg
  }

  // ---------- module contract ----------
  const M = (DH.home = {
    authority: true,
    _S: S, // debug/testing handle

    init(state) {
      gs = state;
      M.authority = !(DH.net && DH.net.online && DH.net.role === "guest");
      syncBlocks();
    },

    start(state) {
      gs = state;
      M.authority = !(DH.net && DH.net.online && DH.net.role === "guest");
      syncBlocks(); // a restored save may already own expansions
    },

    update(dt, state) {
      gs = state;
      if (S.pending && Math.floor(state.day || 0) >= S.readyDay) applyBuild();
    },

    offline(offMin) {
      const parts = [];
      if (S.pending && gs && Math.floor((gs.day || 0) + offMin / DAY_MIN) >= S.readyDay) {
        applyBuild(true);
        parts.push(`the builders finished your ${TIERS[S.tier].name}! 🏗️`);
      }
      return parts;
    },

    interactables(p) {
      if (!gs || !gs.running) return [];
      const out = [];
      const dM = dist2(p.x, p.y, MAIL.x, MAIL.y);
      if (dM < MAIL.r * MAIL.r)
        out.push({ label: `Home office 🏦${S.pending ? " 🚧" : ""}`, x: MAIL.x, y: MAIL.y, d2: dM, action: openOffice });
      const bx = BOX.tx * T + 16, by = BOX.ty * T + 16;
      const dB = dist2(p.x, p.y, bx, by);
      if (dB < 44 * 44)
        out.push({ label: "Storage box 📦", x: bx, y: by, d2: dB, action: openBox });
      const ex = EASEL.tx * T + 16, ey = EASEL.ty * T + 16;
      const dE = dist2(p.x, p.y, ex, ey);
      if (dE < 44 * 44)
        out.push({ label: "Decorate 🎨", x: ex, y: ey, d2: dE, action: openDecorate });
      out.sort((a, b) => a.d2 - b.d2);
      return out;
    },

    drawGround(ctx, camX, camY, state) {
      ctxG = ctx;
      const pal = PAINTS[S.paint] || PAINTS.cedar;
      if (S.paint !== "cedar") drawExterior(ctx, camX, camY, pal);
      drawInterior(ctx, camX, camY);
      if (S.tier >= 2) drawLoft(ctx, camX, camY);
      if (S.tier >= 1) drawDivider(ctx, camX, camY, WALLS[S.wp] || WALLS.wood);
      if (S.tier >= 3) drawDeck(ctx, camX, camY);
      drawTape(ctx, camX, camY);
      drawDoor(ctx, camX, camY);
    },

    collectDraws(draws, camX, camY) {
      if (!ctxG) ctxG = document.getElementById("cv").getContext("2d");
      draws.push({ y: BOX.ty * T + T, fn: () => drawBox(ctxG, BOX.tx * T - camX, BOX.ty * T - camY) });
      draws.push({ y: EASEL.ty * T + T, fn: () => drawEasel(ctxG, EASEL.tx * T - camX, EASEL.ty * T - camY) });
    },

    drawOverlay(ctx, camX, camY, state) {
      ctxG = ctx;
      if (!state || !state.running) return;
      // "zuza's room" caption — only when someone is inside to read it
      if (S.tier >= 1 && (state.players || []).some(p =>
        DH.world.zone(Math.floor(p.x / T), Math.floor(p.y / T)) === "house")) {
        const cx = (ZROOM_X + 2) * T - camX, cy = 8 * T + 20 - camY;
        ctx.font = "bold 9px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillStyle = "rgba(0,0,0,0.30)";
        ctx.fillText("zuza's room ♥", cx + 1, cy + 1);
        ctx.fillStyle = "#f4a8bc";
        ctx.fillText("zuza's room ♥", cx, cy);
      }
    },

    // ----- sync boundary -----
    serialize() {
      return JSON.parse(JSON.stringify({
        tier: S.tier, loan: S.loan, pending: S.pending, readyDay: S.readyDay,
        wp: S.wp, fl: S.fl, paint: S.paint, door: S.door, own: S.own, box: S.box,
        scoreDay: S.scoreDay, lastScore: S.lastScore, lastGrade: S.lastGrade,
      }));
    },
    deserialize(d) {
      if (!d || typeof d !== "object") return;
      if (typeof d.tier === "number") S.tier = clamp(d.tier | 0, 0, 3);
      if (d.loan === null) S.loan = null;
      else if (d.loan && TIERS[d.loan.tier]) {
        S.loan = { tier: d.loan.tier | 0, owed: d.loan.owed | 0, paid: clamp(d.loan.paid | 0, 0, d.loan.owed | 0) };
      }
      if (typeof d.pending === "number") S.pending = clamp(d.pending | 0, 0, 3);
      if (typeof d.readyDay === "number") S.readyDay = d.readyDay;
      if (typeof d.wp === "string" && WALLS[d.wp]) S.wp = d.wp;
      if (typeof d.fl === "string" && FLOORS[d.fl]) S.fl = d.fl;
      if (typeof d.paint === "string" && PAINTS[d.paint]) S.paint = d.paint;
      if (typeof d.door === "string" && DOORS[d.door]) S.door = d.door;
      if (d.own && typeof d.own === "object")
        for (const k of ["wp", "fl", "paint", "door"])
          if (Array.isArray(d.own[k])) {
            const ok = d.own[k].filter(id => KIND_CAT[k][id]);
            if (!ok.includes(KIND_STARTER[k])) ok.push(KIND_STARTER[k]);
            S.own[k] = ok;
          }
      if (d.box && typeof d.box === "object") {
        S.box = {};
        for (const id in d.box) if (DH.items.get(id) && d.box[id] > 0) S.box[id] = d.box[id] | 0;
      }
      if (typeof d.scoreDay === "number") S.scoreDay = d.scoreDay;
      if (typeof d.lastScore === "number") S.lastScore = d.lastScore;
      if (typeof d.lastGrade === "string") S.lastGrade = d.lastGrade;
      syncBlocks();
    },
    remoteAction(name, args) {
      const fn = API[name];
      return typeof fn === "function" ? fn.apply(null, args || []) : false;
    },

    // exposed for remoteAction + console/testing
    takeLoan, payLoan, applyBuild, buyStyle,
    storeItem, storeAll, takeItem, hhaScore,
    openOffice, openDecorate, openBox,
  });

  const API = {
    takeLoan, payLoan, buyStyle, storeItem, storeAll, takeItem, hhaScore,
  };
})();

DH.register("home", DH.home);
