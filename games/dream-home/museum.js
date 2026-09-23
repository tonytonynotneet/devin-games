/* dream-home museum module — "the Perch" museum: donations, wings, catalog
   record, art & fakes (Rascal the fox), milestones + memory album.
   Implements AC_SPEC J-1 (museum/wings/donations), J-3 (catalog record),
   J-4 (art vendor + fakes), J-5 (milestones), J-6 (memory album hook).

   Contract with game.js (same as other modules):
     DH.museum.init(state)            – once at load: item defs, blocked tiles
     DH.museum.start(state)           – each run start: authority + transient reset
     DH.museum.update(dt, state)      – host-only sim (catalog scan, milestones,
                                        blocked-tile upkeep); guests skip via
                                        this.authority like animals.js
     DH.museum.interactables(p)       – -> [{label,x,y,r,action}] door + Rascal
     DH.museum.collectDraws(draws,camX,camY) – depth-sorted facade + Rascal
     DH.museum.drawOverlay(ctx,camX,camY,state) – FX + wing-view backdrop
     serialize()/deserialize(data)/remoteAction(name,args) – save + net sync

   Plot: the far-west corridor — the suggested SW corner (x1-6/y13-18) is taken
   by the pasture fence, so the museum claims tiles x0-2/y4-8 (blocked) with
   the door on its south face at x1 (approach via corridor x0-2/y9-10) plus a
   signpost at x0/y10. Rascal squats on the lawn nearby (~x3.5/y10.5).

   Soft reads (all typeof-guarded; modules are independent):
     DH.critters._state.caught  – which fish/bug/sea species the players know
     DH.finds.assessed          – fossil ids cleared for donation
     DH.furniture.serialize()   – placed furniture ids feed the catalog record
     DH.alog.dump()             – bell-earning events feed the milestone
   Exposed hooks: DH.museum.record(itemId), DH.museum.donate(id),
   DH.museum.gift(n), DH.museum.album (J-6 [{icon,label,day}]).
*/
(function () {
  const DH = (window.DH = window.DH || {});
  const T = 32;
  const R = (ctx, x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x | 0, y | 0, Math.ceil(w), Math.ceil(h)); };
  const rnd = (a, b) => a + Math.random() * (b - a);
  const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
  const mulberry32 = s => () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

  // ---------- layout ----------
  const PLOT = [];                                    // blocked footprint tiles
  for (let x = 0; x <= 2; x++) for (let y = 4; y <= 8; y++) PLOT.push(x + "," + y);
  PLOT.push("0,10");                                  // signpost tile
  const DOOR = { x: 1 * T + 16, y: 9 * T + 14, r: 50 };
  const RASCAL_AT = { x: 3.6 * T, y: 10.5 * T, r: 46 };
  const FACADE_Y = 301;                               // depth-sort key (base)
  const RASCAL_EVERY = 4, RASCAL_ON = 2;              // here when day%4===2

  // ---------- wings + art (J-1 / J-4) ----------
  const WINGS = {
    fish: { ico: "🐟", name: "Fish" },
    bug: { ico: "🦋", name: "Bugs" },
    sea: { ico: "🫧", name: "Sea" },
    fossil: { ico: "🦴", name: "Fossils" },
    art: { ico: "🖼️", name: "Art" },
  };
  const ART = [
    { id: "art-mona", name: "Fancy Painting", ico: "🖼️", cost: 420, real: "a gentle smile that seems to follow you", fake: "the lady's smile looks a little… off" },
    { id: "art-starry", name: "Twinkling Painting", ico: "🌌", cost: 480, real: "a sleepy village beneath swirling stars", fake: "the stars all swirl the wrong way" },
    { id: "art-pearl", name: "Pearly Painting", ico: "🖼️", cost: 390, real: "a girl with a shining pearl earring", fake: "her pearl earring is missing" },
    { id: "art-wave", name: "Great Painting", ico: "🌊", cost: 450, real: "a great wave curling off the coast", fake: "the wave looks more like a claw" },
    { id: "art-hunter", name: "Hunter's Painting", ico: "🖼️", cost: 360, real: "a hunter with his faithful dog at heel", fake: "the hunter's dog has no tail" },
    { id: "art-tea", name: "Calm Painting", ico: "🍵", cost: 330, real: "a tea ceremony, everything perfectly still", fake: "the teapot pours upward" },
  ];

  // ---------- module state (plain JSON only) ----------
  let gs = null;
  const S = {
    donated: { fish: {}, bug: {}, sea: {}, fossil: {}, art: {} }, // wing -> itemId -> n
    seen: {},                 // J-3 catalog record: itemId|"furn:"+id -> true
    stats: { donations: 0, gifts: 0, bells: 0 },
    miles: {},                // milestone key -> {done:1, day}
    album: [],                // J-6: [{icon,label,day}]
    rascal: { day: -1, stock: [] }, // stock: [{id,fk,sold}]
    fx: [],                   // {k,x,y,t0,ttl} — timestamped so guests animate
  };
  let viewWing = null;        // transient: which wing backdrop is up (not saved)
  let scanT = 0, mileT = 0, keepT = 0;

  const toast = (m, ms) => { if (DH.toast) DH.toast(m, ms); };
  const addHappy = n => { if (gs) gs.happiness = Math.max(0, gs.happiness + n); };
  const dayNow = () => Math.floor((gs && gs.day) || 0);
  const fx = (k, x, y, o) => { if (S.fx.length < 48) S.fx.push(Object.assign({ k, x, y, t0: Date.now(), ttl: 1.2 }, o)); };
  const heartsAt = (x, y, n) => { for (let i = 0; i < n; i++) fx("heart", x + rnd(-16, 16), y + rnd(-6, 4), { ttl: rnd(0.8, 1.4), dx: rnd(-10, 10) }); };
  const sparkleAt = (x, y, n) => { for (let i = 0; i < n; i++) fx("spark", x + rnd(-18, 18), y + rnd(-18, 4), { ttl: rnd(0.5, 1.0) }); };

  function albumPush(e) {
    S.album.push({ icon: e.icon, label: e.label, day: dayNow() });
    if (S.album.length > 80) S.album.splice(0, S.album.length - 80);
  }
  function record(id) { if (id) S.seen[id] = true; }

  // ---------- shared reads (soft deps) ----------
  const caughtMap = () => (DH.critters && DH.critters._state && DH.critters._state.caught) || {};
  const assessedList = () => (DH.finds && Array.isArray(DH.finds.assessed) && DH.finds.assessed) || [];
  function knownInWing(id, w) { // species is "known" if players caught/assessed/seen it
    if (w === "fossil") return assessedList().includes(id);
    if (w === "art") return !!S.seen[id];
    return !!caughtMap()[id];
  }
  const wingSpecies = w => Object.values(DH.items.defs || {})
    .filter(d => d.cat === w && !d.id.endsWith("-fk") && d.id !== "fossil-un")
    .map(d => d.id)
    .sort();
  const donatedIn = w => Object.keys(S.donated[w] || {}).length;

  // J-1: donateable pocket stacks = fish/bug/sea + assessed fossils + art
  function donateable() {
    const out = [];
    for (const s of DH.inv.list()) {
      const d = DH.items.get(s.id);
      if (!d || !WINGS[d.cat] || s.id === "fossil-un") continue;
      if (d.cat === "fossil" && !assessedList().includes(s.id)) continue;
      out.push(s);
    }
    return out;
  }

  // ---------- actions (remote-callable) ----------
  const API = {
    donate(id) {
      if (!M.authority) { if (DH.net) DH.net.send({ type: "act", name: "donate", args: [id] }); toast("The curator will take a look…"); return true; }
      const stack = DH.inv.list().find(s => s.id === id);
      const d = DH.items.get(id);
      if (!stack || !d) { toast("Nothing to donate."); return false; }
      if (id.endsWith("-fk")) { // J-4: appraisal reveals fakes
        toast("🔍 The curator squints… it's a FAKE! Can't exhibit it — sell it for pennies.", 2600);
        sparkleAt(DOOR.x, DOOR.y - 20, 4);
        return false;
      }
      if (!donateable().some(s => s.id === id)) { toast("The museum can't take that."); return false; }
      if (!DH.inv.remove(id, 1)) return false;
      const w = d.cat;
      const first = !S.donated[w][id];
      S.donated[w][id] = (S.donated[w][id] || 0) + 1;
      S.stats.donations++;
      record(id);
      heartsAt(DOOR.x, DOOR.y - 24, first ? 9 : 3); // J-1: first-of-species extra hearts
      sparkleAt(DOOR.x, DOOR.y - 24, first ? 6 : 2);
      addHappy(first ? 5 : 2);
      toast(first ? `🦉 "A ${d.name}! A brand-new exhibit!" +5❤` : `Donated a ${d.name} — the curator bows.`, 2200);
      albumPush({ icon: d.ico, label: `Donated a ${d.name} to the ${WINGS[w].name} wing` });
      checkMiles();
      return true;
    },
    buyArt(id) {
      if (!M.authority) { if (DH.net) DH.net.send({ type: "act", name: "buyArt", args: [id] }); toast("Rascal wraps it up…"); return true; }
      const st = rascalStock().find(s => s.id === id);
      const a = ART.find(x => x.id === id);
      if (!st || st.sold || !a) return false;
      if (gs.coins < a.cost) { toast("Not enough bells."); return false; }
      const itemId = st.fk ? id + "-fk" : id;
      if (!DH.inv.add(itemId, 1)) { toast("Pockets are full."); return false; }
      gs.coins -= a.cost;
      st.sold = 1;
      record(id);
      toast("Rascal grins. “Pleasure doing business.”", 1800);
      return true;
    },
    record(id) { record(id); return true; },
    gift(n) { S.stats.gifts += Math.max(0, n | 0 || 1); checkMiles(); return true; }, // J-5 hook
  };

  // ---------- J-5 milestones ----------
  const countCaught = cat => Object.entries(caughtMap())
    .reduce((s, [id, n]) => s + (((DH.items.get(id) || {}).cat === cat) ? (n | 0) : 0), 0);
  const EARN_FIXED = { "money-shake": 300, shake: 100, "dig-spot": 100, "bury-bells": 100 };
  const EARN_VALUE = { econ_sellall: 1, econ_bin: 1, econ_interest: 1 };
  const MILES = [
    { k: "don1", ico: "🦉", title: "First curator", need: 1, reward: 5, get: () => S.stats.donations },
    { k: "don10", ico: "🎁", title: "Generous donor", need: 10, reward: 15, get: () => S.stats.donations },
    { k: "don25", ico: "🏛️", title: "Museum patron", need: 25, reward: 40, get: () => S.stats.donations },
    { k: "fish5", ico: "🎣", title: "Pond angler", need: 5, reward: 10, get: () => countCaught("fish") },
    { k: "bug8", ico: "🦋", title: "Bug whisperer", need: 8, reward: 10, get: () => countCaught("bug") },
    { k: "sea4", ico: "🫧", title: "Deep diver", need: 4, reward: 10, get: () => countCaught("sea") },
    { k: "fossil3", ico: "🦴", title: "Fossil hunter", need: 3, reward: 15, get: () => assessedList().length },
    { k: "art2", ico: "🖼️", title: "Art lover", need: 2, reward: 20, get: () => donatedIn("art") },
    { k: "bells", ico: "💰", title: "Bell bags", need: 1500, reward: 15, get: () => S.stats.bells },
    { k: "gift3", ico: "💝", title: "Gift giver", need: 3, reward: 10, get: () => S.stats.gifts },
  ];
  function checkMiles() {
    for (const m of MILES) {
      if (S.miles[m.k] && S.miles[m.k].done) continue;
      if ((m.get() | 0) >= m.need) {
        S.miles[m.k] = { done: 1, day: dayNow() };
        addHappy(m.reward);
        heartsAt(DOOR.x, DOOR.y - 40, 10);
        toast(`⭐ Milestone: ${m.title}! +${m.reward}❤`, 2400);
        albumPush({ icon: "⭐", label: `Milestone: ${m.title}` });
      }
    }
  }
  function scanBells() { // J-5: bells earned, estimated from the alog buffer
    if (!DH.alog || !DH.alog.dump) return;
    let sum = 0;
    for (const e of DH.alog.dump(240) || []) {
      if (EARN_VALUE[e.e] && typeof e.d === "number") sum += e.d;
      else if (EARN_FIXED[e.e]) sum += EARN_FIXED[e.e];
    }
    if (sum > S.stats.bells) S.stats.bells = sum;
  }
  function scanSeen() { // J-3: pockets + placed furniture feed the catalog record
    for (const s of DH.inv.list()) if (s && s.id) S.seen[s.id] = true;
    if (DH.furniture && typeof DH.furniture.serialize === "function") {
      try { ((DH.furniture.serialize() || {}).items || []).forEach(it => { if (it && it.id) S.seen["furn:" + it.id] = true; }); } catch (e) { /* furniture mid-tick */ }
    }
  }

  // ---------- J-4: Rascal's stock ----------
  const rascalHere = () => dayNow() % RASCAL_EVERY === RASCAL_ON;
  function rascalStock() {
    const day = dayNow();
    if (S.rascal.day !== day) {
      const rng = mulberry32(day * 7919 + 41);
      const pool = ART.slice();
      const stock = [];
      for (let i = 0; i < 2 && pool.length; i++) {
        const a = pool.splice(Math.floor(rng() * pool.length), 1)[0];
        stock.push({ id: a.id, fk: rng() < 0.55, sold: 0 });
      }
      if (stock.length && stock.every(s => s.fk)) stock[0].fk = false; // one real piece per visit
      S.rascal = { day, stock };
    }
    return S.rascal.stock;
  }

  // ---------- menus (overlay "interior" — J-1 wing view) ----------
  function openMuseum() {
    const total = Object.keys(WINGS).reduce((s, w) => s + donatedIn(w), 0);
    DH.menu.open("🏛️ The Perch — Museum", [
      { ico: "🦉", label: "Donate to the museum", cb: openDonate },
      { ico: "🏛️", label: `Explore the wings · ${total} exhibits`, cb: openWings },
      { ico: "📖", label: `Collection catalog · ${Object.keys(S.seen).length} seen`, cb: openCatalog },
      { ico: "⭐", label: `Milestones · ${Object.keys(S.miles).length}/${MILES.length}`, cb: openMiles },
      { ico: "📷", label: `Memory album · ${S.album.length}`, cb: openAlbum },
      { ico: "◀️", label: "Back", cb: () => {} },
    ]);
  }
  function openDonate() {
    const rows = donateable().map(s => {
      const d = DH.items.get(s.id);
      const held = d.cat !== "art" && (S.donated[d.cat][s.id] || 0) > 0;
      return { ico: d.ico, label: `${d.name} ×${s.n}${held ? " — in the museum" : ""}`, cb: () => { API.donate(s.id); openDonate(); } };
    });
    if (!rows.length) rows.push({ ico: "🕳️", label: "Pockets hold nothing to donate", disabled: true });
    rows.push({ ico: "◀️", label: "Back", cb: openMuseum });
    DH.menu.open("🦉 Donate — the curator waits", rows);
  }
  function openWings() {
    const rows = Object.keys(WINGS).map(w => ({
      ico: WINGS[w].ico,
      label: `${WINGS[w].name} wing — ${donatedIn(w)}/${wingSpecies(w).length}`,
      cb: () => openWing(w),
    }));
    rows.push({ ico: "◀️", label: "Back", cb: openMuseum });
    DH.menu.open("🏛️ Museum wings", rows);
  }
  function openWing(w) {
    viewWing = w;
    const rows = wingSpecies(w).map(id => {
      const d = DH.items.get(id);
      const n = S.donated[w][id] || 0;
      if (n > 0) return { ico: d.ico, label: `${d.name} — on display${n > 1 ? " ×" + n : ""}`, cb: () => toast(`"${d.name}" — a prized exhibit.`) };
      if (knownInWing(id, w)) return { ico: "▫️", label: `empty vitrine — donate a ${d.name}`, cb: () => toast("An empty vitrine waits for a donation.") };
      return { ico: "·", label: "· · ·", disabled: true };
    });
    if (!rows.length) rows.push({ ico: "🕳️", label: "This wing is still being built", disabled: true });
    rows.push({ ico: "◀️", label: "Back to wings", cb: () => { viewWing = null; openWings(); } });
    DH.menu.open(`${WINGS[w].ico} ${WINGS[w].name} wing`, rows);
  }
  const pretty = id => id.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  function openCatalog() { // J-3
    const ids = Object.keys(S.seen).sort();
    const rows = ids.slice(-60).map(id => {
      if (id.startsWith("furn:")) return { ico: "🪑", label: pretty(id.slice(5)), cb: () => toast(pretty(id.slice(5)) + " — furniture") };
      const d = DH.items.get(id);
      return d
        ? { ico: d.ico, label: d.name, cb: () => toast(`${d.name} — ${d.cat}`) }
        : { ico: "❔", label: pretty(id), cb: () => {} };
    });
    if (!rows.length) rows.push({ ico: "🕳️", label: "Nothing cataloged yet", disabled: true });
    rows.push({ ico: "◀️", label: "Back", cb: openMuseum });
    DH.menu.open(`📖 Catalog — ${ids.length} recorded`, rows);
  }
  function openMiles() { // J-5
    const rows = MILES.map(m => {
      const done = S.miles[m.k] && S.miles[m.k].done;
      const v = Math.min(m.get() | 0, m.need);
      const bar = "▓".repeat(Math.round(v / m.need * 6)) + "░".repeat(6 - Math.round(v / m.need * 6));
      return {
        ico: done ? "★" : m.ico,
        label: `${m.title} — ${done ? `done! (+${m.reward}❤, day ${S.miles[m.k].day})` : `${bar} ${v}/${m.need}`}`,
        cb: () => toast(done ? `${m.title} earned on day ${S.miles[m.k].day}.` : `${m.title}: ${v}/${m.need} — reward +${m.reward}❤`, 2000),
      };
    });
    rows.push({ ico: "◀️", label: "Back", cb: openMuseum });
    DH.menu.open("⭐ Milestones", rows);
  }
  function openAlbum() { // J-6
    const rows = S.album.slice(-40).reverse()
      .map(e => ({ ico: e.icon, label: `${e.label} — day ${e.day}`, cb: () => {} }));
    if (!rows.length) rows.push({ ico: "🕳️", label: "No memories yet — donate something!", disabled: true });
    rows.push({ ico: "◀️", label: "Back", cb: openMuseum });
    DH.menu.open("📷 Memory album", rows);
  }
  function openRascal() { // J-4
    rascalStock();
    const rows = S.rascal.stock.map(st => {
      const a = ART.find(x => x.id === st.id);
      if (st.sold) return { ico: "▫️", label: `${a.name} — sold`, disabled: true };
      return { ico: a.ico, label: `${a.name} — inspect first…`, cost: a.cost, disabled: gs.coins < a.cost, cb: () => openArtInspect(st) };
    });
    rows.push({ ico: "◀️", label: "Leave", cb: () => {} });
    DH.menu.open("🦊 Rascal's gallery — “No refunds, dear.”", rows);
  }
  function openArtInspect(st) {
    const a = ART.find(x => x.id === st.id);
    DH.menu.open(`${a.ico} ${a.name}`, [
      { ico: "🔍", label: `It's ${st.fk ? a.fake : a.real}.`, disabled: true },
      { ico: "🪙", label: `Buy it — ${a.cost} bells`, cost: a.cost, disabled: gs.coins < a.cost, cb: () => { API.buyArt(st.id); openRascal(); } },
      { ico: "◀️", label: "Back", cb: openRascal },
    ]);
  }

  // ---------- drawing ----------
  function drawFacade(ctx, camX, camY) {
    const x = -6 - camX, top = 140 - camY;   // facade slightly overhangs the west edge
    const w = 106, base = 301 - camY;
    // steps (in front of the door, down onto corridor y9)
    R(ctx, x + 30, base, 44, 4, "#c8bb9a"); R(ctx, x + 34, base + 4, 36, 4, "#b8ab8c"); R(ctx, x + 38, base + 8, 28, 4, "#a89a7c");
    // pediment (gable)
    ctx.fillStyle = "#6e5f86";
    ctx.beginPath(); ctx.moveTo(x - 2, top + 40); ctx.lineTo(x + w / 2, top); ctx.lineTo(x + w + 2, top + 40); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#544a66"; ctx.fillRect(x - 2, top + 38, w + 4, 4);
    ctx.fillStyle = "#8a7ba6"; ctx.fillRect(x + 4, top + 34, w - 8, 3);
    // owl emblem in the gable
    ctx.fillStyle = "#d8b23a"; ctx.beginPath(); ctx.arc(x + w / 2, top + 26, 9, 0, 7); ctx.fill();
    ctx.fillStyle = "#6e5f86"; ctx.font = "9px sans-serif"; ctx.textAlign = "center";
    ctx.fillText("🦉", x + w / 2, top + 29);
    // frieze + name
    R(ctx, x, top + 42, w, 13, "#463e58");
    ctx.fillStyle = "#f2e9d4"; ctx.font = "bold 7px sans-serif"; ctx.textAlign = "center";
    ctx.fillText("M U S E U M", x + w / 2, top + 51);
    // colonnade wall
    R(ctx, x + 2, top + 55, w - 4, base - (top + 55), "#e8dfc8");
    for (let y = top + 60; y < base - 10; y += 9) R(ctx, x + 2, y, w - 4, 1, "#d8cbaa");
    // banners flanking the door (fish / fossil)
    R(ctx, x + 24, top + 60, 11, 34, "#3d5a8c"); R(ctx, x + 24, top + 92, 11, 3, "#2c4470");
    R(ctx, x + 24, top + 94, 4, 4, "#3d5a8c"); R(ctx, x + 31, top + 94, 4, 4, "#3d5a8c");
    ctx.fillStyle = "#eef4ff"; ctx.beginPath(); ctx.ellipse(x + 29, top + 74, 3.5, 2.2, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x + 32, top + 74); ctx.lineTo(x + 35, top + 71); ctx.lineTo(x + 35, top + 77); ctx.fill();
    R(ctx, x + 71, top + 60, 11, 34, "#6a4a8c"); R(ctx, x + 71, top + 92, 11, 3, "#523770");
    R(ctx, x + 71, top + 94, 4, 4, "#6a4a8c"); R(ctx, x + 78, top + 94, 4, 4, "#6a4a8c");
    R(ctx, x + 74, top + 72, 5, 5, "#f2e9d4"); R(ctx, x + 76, top + 76, 3, 8, "#f2e9d4"); R(ctx, x + 73, top + 83, 5, 3, "#f2e9d4"); R(ctx, x + 78, top + 83, 3, 3, "#f2e9d4");
    // windows with warm interior light
    for (const wx of [x + 11, x + 84]) {
      R(ctx, wx, top + 70, 10, 30, "#ffd87a"); R(ctx, wx, top + 70, 10, 30, "#0000");
      ctx.strokeStyle = "#8a6a3a"; ctx.lineWidth = 1.5; ctx.strokeRect(wx, top + 70, 10, 30);
      R(ctx, wx + 4, top + 70, 2, 30, "#8a6a3a"); R(ctx, wx, top + 83, 10, 2, "#8a6a3a");
    }
    // columns
    for (const cx of [x + 4, x + 36, x + 64, x + 94]) {
      R(ctx, cx - 4, top + 58, 8, base - top - 62, "#f4ecd6");
      R(ctx, cx + 2, top + 58, 2, base - top - 62, "#cfc0a0");
      R(ctx, cx - 6, top + 55, 12, 4, "#f4ecd6"); R(ctx, cx - 6, base - 8, 12, 4, "#d8cbaa");
    }
    // double door
    R(ctx, x + 43, top + 92, 20, base - (top + 92), "#3a2a1a");
    R(ctx, x + 45, top + 95, 16, base - top - 99, "#5a3a22");
    R(ctx, x + 52, top + 95, 2, base - top - 99, "#3a2a1a");
    R(ctx, x + 49, top + 118, 2, 3, "#d8b23a"); R(ctx, x + 55, top + 118, 2, 3, "#d8b23a");
    R(ctx, x + 41, top + 88, 24, 4, "#463e58");
    // base plinth
    R(ctx, x - 2, base - 4, w + 4, 4, "#b8ab8c");
    // night lantern glow at the door
    const night = gs && (gs.timeMin > 18 * 60 || gs.timeMin < 6 * 60);
    if (night) {
      const g = ctx.createRadialGradient(x + 53, top + 108, 4, x + 53, top + 108, 46);
      g.addColorStop(0, "rgba(255,200,110,0.35)"); g.addColorStop(1, "rgba(255,200,110,0)");
      ctx.fillStyle = g; ctx.fillRect(x, top + 60, w, 90);
    }
  }
  function drawSign(ctx, camX, camY) { // signpost at corridor mouth (tile 0,10)
    const x = 16 - camX, y = 10 * T + 26 - camY;
    R(ctx, x - 2, y - 14, 4, 14, "#6a4a2e");
    R(ctx, x - 11, y - 26, 22, 13, "#8a6a42");
    ctx.strokeStyle = "#5a3c22"; ctx.lineWidth = 1; ctx.strokeRect(x - 11, y - 26, 22, 13);
    ctx.fillStyle = "#fff"; ctx.font = "8px sans-serif"; ctx.textAlign = "center";
    ctx.fillText("🏛️", x - 4, y - 16); R(ctx, x + 2, y - 21, 6, 2, "#fff");
  }
  function drawRascal(ctx, camX, camY, now) {
    const x = RASCAL_AT.x - camX, y = RASCAL_AT.y - camY;
    const bob = Math.sin(now / 420) * 1.2;
    // blanket of wares beside him
    R(ctx, x + 12, y + 6, 30, 10, "#8c3a5a");
    for (const fx0 of [x + 15, x + 27]) { R(ctx, fx0, y + 1, 9, 7, "#6a4a2e"); R(ctx, fx0 + 1.5, y + 2.5, 6, 4, "#d8cbaa"); }
    // tail
    ctx.fillStyle = "#c86f28"; ctx.beginPath();
    ctx.ellipse(x - 11, y - 6 + bob * 0.4, 9, 4.5, -0.5, 0, 7); ctx.fill();
    ctx.fillStyle = "#f4e8d4"; ctx.beginPath(); ctx.ellipse(x - 17, y - 10 + bob * 0.4, 4, 3, -0.5, 0, 7); ctx.fill();
    // body + cloak
    R(ctx, x - 7, y - 20 + bob, 14, 20, "#d07a2e");
    R(ctx, x - 7, y - 20 + bob, 14, 6, "#7a4a9a");
    R(ctx, x - 4, y - 14 + bob, 8, 12, "#f4e8d4");
    // head + ears + shifty eyes
    R(ctx, x - 8, y - 32 + bob, 16, 12, "#d07a2e");
    ctx.fillStyle = "#d07a2e";
    ctx.beginPath(); ctx.moveTo(x - 8, y - 30 + bob); ctx.lineTo(x - 6, y - 38 + bob); ctx.lineTo(x - 2, y - 30 + bob); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x + 2, y - 30 + bob); ctx.lineTo(x + 6, y - 38 + bob); ctx.lineTo(x + 8, y - 30 + bob); ctx.fill();
    R(ctx, x - 4, y - 24 + bob, 8, 4, "#f4e8d4");
    R(ctx, x - 4, y - 28 + bob, 3, 2, "#2a1a12"); R(ctx, x + 2, y - 28 + bob, 3, 2, "#2a1a12");
    R(ctx, x - 1, y - 21 + bob, 2, 2, "#2a1a12");
    // feet
    R(ctx, x - 6, y, 5, 3, "#3a2a1a"); R(ctx, x + 1, y, 5, 3, "#3a2a1a");
    // "psst" bubble
    if (Math.sin(now / 900) > -0.4) {
      ctx.fillStyle = "#fffffff0"; ctx.beginPath(); ctx.ellipse(x + 4, y - 46 + bob, 9, 6, 0, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x + 1, y - 41 + bob); ctx.lineTo(x - 2, y - 36 + bob); ctx.lineTo(x + 5, y - 41 + bob); ctx.fill();
      ctx.fillStyle = "#4a3a5c"; ctx.font = "bold 7px sans-serif"; ctx.textAlign = "center";
      ctx.fillText("psst", x + 4, y - 43 + bob);
    }
  }
  function drawWingBackdrop(ctx, w) { // menu-based wing view: dim the world, light vitrines
    const cv = ctx.canvas;
    ctx.fillStyle = "rgba(18,14,26,0.86)"; ctx.fillRect(0, 0, cv.width, cv.height);
    const ids = wingSpecies(w);
    const shown = ids.filter(id => S.donated[w][id] > 0).slice(-6);
    const n = Math.max(shown.length, 3);
    const cw = cv.width / n;
    shown.forEach((id, i) => {
      const d = DH.items.get(id);
      const x = cw * (i + 0.5), y = cv.height - 46;
      const g = ctx.createRadialGradient(x, y - 18, 2, x, y - 18, 30);
      g.addColorStop(0, "rgba(255,220,140,0.5)"); g.addColorStop(1, "rgba(255,220,140,0)");
      ctx.fillStyle = g; ctx.fillRect(x - 30, y - 48, 60, 50);
      R(ctx, x - 13, y - 12, 26, 14, "#4a4258"); R(ctx, x - 15, y - 14, 30, 3, "#6a5f80");
      ctx.font = "16px sans-serif"; ctx.textAlign = "center";
      ctx.fillText(d ? d.ico : "❔", x, y - 18);
      R(ctx, x - 11, y + 1, 22, 7, "#2c2438");
      ctx.fillStyle = "#d8cbaa"; ctx.font = "5px sans-serif";
      ctx.fillText((d ? d.name : id).slice(0, 12), x, y + 6.5);
    });
  }
  function drawFx(ctx, camX, camY, now) {
    for (const f of S.fx) {
      const age = (now - f.t0) / 1000;
      if (age < 0 || age > f.ttl) continue;
      const k = age / f.ttl;
      const x = f.x - camX + (f.dx || 0) * k, y = f.y - camY - 26 * k;
      if (f.k === "heart") {
        if (DH.sprites && DH.sprites.heart) DH.sprites.heart(ctx, x, y, 6 + 2 * (1 - k), `rgba(255,110,140,${1 - k * 0.6})`);
      } else {
        ctx.fillStyle = `rgba(255,230,150,${1 - k})`;
        ctx.fillRect(x - 1.5, y - 1.5, 3, 3); ctx.fillRect(x - 0.5, y - 3.5, 1, 7); ctx.fillRect(x - 3.5, y - 0.5, 7, 1);
      }
    }
    if (M.authority) S.fx = S.fx.filter(f => (now - f.t0) / 1000 < f.ttl + 0.5);
  }

  // ---------- module ----------
  const M = (DH.museum = {
    init(state) {
      gs = state;
      // item defs for art (idempotent — load order is before critters/finds)
      for (const a of ART) {
        if (!DH.items.get(a.id)) DH.items.def(a.id, { name: a.name, ico: a.ico, cat: "art", price: 60 });
        if (!DH.items.get(a.id + "-fk")) DH.items.def(a.id + "-fk", { name: a.name, ico: a.ico, cat: "art", price: 5 });
      }
      // footprint: block the facade tiles + signpost
      if (DH.world && DH.world.blocked) {
        PLOT.forEach(k => DH.world.blocked.add(k));
        if (!DH.world._museumPatched) {
          DH.world._museumPatched = true;
          const s0 = DH.world.isSolid.bind(DH.world);
          DH.world.isSolid = (tx, ty) => s0(tx, ty) || DH.world.blocked.has(tx + "," + ty);
        }
      }
    },
    start(state) {
      gs = state;
      this.authority = !(DH.net && DH.net.online && DH.net.role === "guest");
      S.fx = S.fx.filter(f => (Date.now() - f.t0) / 1000 < f.ttl);
      viewWing = null;
      if (this.authority) { rascalStock(); }
    },
    update(dt, state) {
      gs = state;
      if (!this.authority) return;
      keepT += dt;
      if (keepT > 5 && DH.world && DH.world.blocked) { keepT = 0; PLOT.forEach(k => DH.world.blocked.add(k)); }
      scanT += dt;
      if (scanT > 2) { scanT = 0; scanSeen(); scanBells(); }
      mileT += dt;
      if (mileT > 1) { mileT = 0; checkMiles(); }
    },
    interactables(p) {
      const out = [];
      if (dist2(p.x, p.y, DOOR.x, DOOR.y) < DOOR.r * DOOR.r)
        out.push({ label: "Museum 🏛️", x: DOOR.x, y: DOOR.y, r: DOOR.r, action: openMuseum });
      if (rascalHere() && dist2(p.x, p.y, RASCAL_AT.x, RASCAL_AT.y) < RASCAL_AT.r * RASCAL_AT.r)
        out.push({ label: "Rascal's art 🦊", x: RASCAL_AT.x, y: RASCAL_AT.y, r: RASCAL_AT.r, action: openRascal });
      return out;
    },
    collectDraws(draws, camX, camY) {
      if (!ctx2) ctx2 = document.getElementById("cv").getContext("2d");
      draws.push({ y: FACADE_Y, fn: () => drawFacade(ctx2, camX, camY) });
      draws.push({ y: 10 * T + 28, fn: () => drawSign(ctx2, camX, camY) });
      if (rascalHere()) draws.push({ y: RASCAL_AT.y + 4, fn: () => drawRascal(ctx2, camX, camY, Date.now()) });
    },
    drawOverlay(ctx, camX, camY, state) {
      gs = state;
      if (viewWing) {
        const ms = typeof document !== "undefined" && document.getElementById("menuScreen");
        if (!ms || ms.classList.contains("hidden")) viewWing = null;
        else drawWingBackdrop(ctx, viewWing);
      }
      drawFx(ctx, camX, camY, Date.now());
    },
    serialize() {
      return JSON.parse(JSON.stringify({
        donated: S.donated, seen: S.seen, stats: S.stats,
        miles: S.miles, album: S.album, rascal: S.rascal, fx: S.fx,
      }));
    },
    deserialize(d) {
      if (!d || typeof d !== "object") return;
      if (d.donated && typeof d.donated === "object") for (const w of Object.keys(WINGS)) Object.assign(S.donated[w], d.donated[w] || {});
      if (d.seen && typeof d.seen === "object") Object.assign(S.seen, d.seen);
      if (d.stats && typeof d.stats === "object") Object.assign(S.stats, d.stats);
      if (d.miles && typeof d.miles === "object") Object.assign(S.miles, d.miles);
      if (Array.isArray(d.album)) S.album = d.album.filter(e => e && typeof e.label === "string");
      if (d.rascal && Array.isArray(d.rascal.stock)) S.rascal = d.rascal;
      if (Array.isArray(d.fx)) S.fx = d.fx.filter(f => f && typeof f.t0 === "number");
    },
    remoteAction(name, args) { return typeof API[name] === "function" ? API[name].apply(null, args || []) : false; },
    offline() { return []; },
    // exposed API
    record, donate: id => API.donate(id), gift: n => API.gift(n), openMuseum,
    _state: S,
  });
  let ctx2 = null;
  Object.defineProperty(M, "album", { get: () => S.album }); // J-6 hook

  DH.register("museum", M);
})();
