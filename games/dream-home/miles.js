/* dream-home miles module — Nook Miles milestones + island tours (AC spec E-4, E-5).
   Contract with game.js (self-registers via DH.register at the bottom):
     DH.miles.init(state) / start(state) / update(dt,state)
     DH.miles.collectDraws(draws, camX, camY) — Nook Stop terminal, tour jetty+raft
     DH.miles.drawOverlay(ctx, camX, camY, state) — miles chip, fade veil, and the
       fullscreen tour-island scene while S.tour.active
     DH.miles.interactables(p) -> [{label,x,y,action}]
     DH.miles.serialize()/deserialize(data)/remoteAction(name,args)
     DH.miles.onTrip-style flag: DH.miles.onTour — true while a tour is underway
       (npcs.js exposes M.onTrip the same way; we avoid starting while it sails).
     DH.miles.hairUnlocked() -> bool (fashion.js reads this for the hair pack).

   E-4 Nook Miles: S.miles is a second currency earned ONLY by finishing
   milestones (~25-stamp card, auto-awarded with a "Milestone! +N miles" toast).
   Progress is detected defensively in update() every few seconds: new DH.alog
   entries (timestamp cursor, survives save/reload) plus cheap module state reads
   (coins delta, museum donations, island rating, visit mailbox queue).

   E-5 Miles shop & tours: the green Nook Stop terminal beside the mailbox
   redeems miles for a tour ticket (2000mi), pocket upgrade (+10 slots, 5000mi),
   unique furniture (nook-sign, island-flag) and the hairstyles pack flag.
   The jetty on the pond's south shore sails to one of three random mini-isles —
   bamboo grove, money-rock isle, rare-bloom isle — for a 3-minute free gather,
   then back to the jetty with the loot.

   Sync boundary: all sim state lives in S (plain JSON). Guests never run
   update(); they render deserialize() snapshots. Timed visuals use wall-clock
   fields (until/fadeUntil/born) so they animate without update(). Mutations are
   named API fns reachable via remoteAction("miles.<name>", args).
*/
(function () {
  const DH = (window.DH = window.DH || {});
  const T = 32;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
  const R = (ctx, x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };

  // ---------- items ----------
  const E = DH.items.def;
  E("tour-ticket", { name: "Tour ticket", ico: "🎫", cat: "misc", price: 0, stack: 5 });
  E("nook-sign", { name: "Nook sign", ico: "🪧", cat: "furniture", price: 400, stack: 5 });
  E("island-flag", { name: "Island flag", ico: "🚩", cat: "furniture", price: 400, stack: 5 });
  E("bamboo-shoot", { name: "Bamboo shoot", ico: "🎍", cat: "material", price: 250 });
  E("rare-rose", { name: "Blue rose", ico: "🌹", cat: "flower", price: 400 });
  E("gold-mum", { name: "Gold mum", ico: "🏵️", cat: "flower", price: 450 });
  E("blue-orchid", { name: "Purple orchid", ico: "🌸", cat: "flower", price: 500 });

  // ---------- world spots ----------
  const NOOK = { tx: 10, ty: 12 };                          // terminal, just under the mailbox
  const MAILBOX_PT = { x: 10 * T + 16, y: 11 * T + 16 };    // world.js mailbox decor tile
  const JETTY = { x: 25 * T + 16, y: 18 * T + 10 };         // stand point, pond south shore
  const RAFT = { x: 25 * T + 16, y: 17.45 * T };            // moored on the water
  // tour isle = pasture box re-skinned, painted fullscreen like npcs' Mini Isle
  const ISLE = { x0: 105, y0: 393, x1: 279, y1: 535, cx: 192, cy: 464 };
  const SAIL = { x: 192, y: 398 };
  const TOUR_MS = 3 * 60 * 1000;

  // ---------- shop ----------
  const TICKET_MI = 2000, POCKET_MI = 5000, FURN_MI = 800, HAIR_MI = 2400;

  // ---------- module state (plain JSON only) ----------
  let gs = null, ctx2 = null;
  const S = {
    miles: 0,
    done: {},            // achievement key -> game-day stamp
    stats: {             // cumulative counters (host-tracked)
      fish: 0, catches: 0, weeds: 0, fossils: 0, hybrids: 0, photos: 0,
      letters: 0, gifts: 0, donations: 0, crafts: 0, cooks: 0, sells: 0,
      tours: 0, pets: 0, harvests: 0, quests: 0, wishes: 0,
      coinsEarned: 0, maxStars: 0,
    },
    seenT: 0, seenN: 0,  // DH.alog scan cursor (timestamp + ordinal within that second)
    lastCoins: -1,       // coins-delta tracker
    mailSeen: 0,         // visits mailbox pending-parcel tracker
    streak: 0, lastPlay: "", daysN: 0,
    flags: { hair: 0 },  // unlocks readable by other modules (fashion)
    tour: { active: false, arche: "", until: 0, backX: 0, backY: 0, b2X: 0, b2Y: 0, nodes: [], fadeUntil: 0 },
    nextId: 1,
  };
  const fx = [];   // view-only sparks {x,y,born,ttl}
  const alog = (e, d) => { if (DH.alog) DH.alog.add(e, d); };
  const isGuest = () => !!(DH.net && DH.net.online && DH.net.role === "guest");
  const dayStamp = () => Math.floor((gs && gs.day) || 0);

  // ---------- milestones (E-4) ----------
  // each: get() -> [current, needed]
  const ACH = [
    { k: "fish1", ico: "🎣", name: "First catch!", desc: "Catch a fish", mi: 200, get: () => [S.stats.fish, 1] },
    { k: "fish15", ico: "🐟", name: "Angler", desc: "Catch 15 fish", mi: 500, get: () => [S.stats.fish, 15] },
    { k: "crit20", ico: "🦋", name: "Critter collector", desc: "Catch 20 critters", mi: 400, get: () => [S.stats.catches, 20] },
    { k: "weed50", ico: "🌿", name: "Weed warrior", desc: "Pull 50 weeds", mi: 500, get: () => [S.stats.weeds, 50] },
    { k: "fossil10", ico: "🦴", name: "Fossil hunter", desc: "Dig up 10 fossils", mi: 500, get: () => [S.stats.fossils, 10] },
    { k: "hybrid1", ico: "🌷", name: "Hybrid hero", desc: "Bloom a hybrid flower", mi: 500, get: () => [S.stats.hybrids, 1] },
    { k: "photo1", ico: "📷", name: "Say cheese!", desc: "Take a photo", mi: 200, get: () => [S.stats.photos, 1] },
    { k: "letter1", ico: "💌", name: "Pen pal", desc: "Send a letter", mi: 200, get: () => [S.stats.letters, 1] },
    { k: "gift1", ico: "🎁", name: "Gift giver", desc: "Give a gift", mi: 200, get: () => [S.stats.gifts, 1] },
    { k: "gift5", ico: "🎀", name: "Generous soul", desc: "Give 5 gifts", mi: 500, get: () => [S.stats.gifts, 5] },
    { k: "star5", ico: "⭐", name: "Five-star home", desc: "Reach a 5★ island rating", mi: 1500, get: () => [S.stats.maxStars, 5] },
    { k: "bell10k", ico: "💰", name: "Bell saver", desc: "Earn 10,000 bells total", mi: 800, get: () => [S.stats.coinsEarned, 10000] },
    { k: "bell100k", ico: "👑", name: "Bell-ionaire", desc: "Earn 100,000 bells total", mi: 1500, get: () => [S.stats.coinsEarned, 100000] },
    { k: "streak3", ico: "📅", name: "Regular resident", desc: "Play 3 days in a row", mi: 300, get: () => [S.streak, 3] },
    { k: "streak7", ico: "🗓️", name: "Island native", desc: "Play 7 days in a row", mi: 700, get: () => [S.streak, 7] },
    { k: "don5", ico: "🏛️", name: "Curator's friend", desc: "Donate 5 exhibits", mi: 400, get: () => [S.stats.donations, 5] },
    { k: "craft10", ico: "🔨", name: "DIY fan", desc: "Craft 10 things", mi: 400, get: () => [S.stats.crafts, 10] },
    { k: "cook5", ico: "🍳", name: "Home chef", desc: "Cook 5 dishes", mi: 300, get: () => [S.stats.cooks, 5] },
    { k: "sell30", ico: "🏪", name: "Market regular", desc: "Make 30 sales", mi: 400, get: () => [S.stats.sells, 30] },
    { k: "tour1", ico: "🏝️", name: "Island hopper", desc: "Finish an island tour", mi: 300, get: () => [S.stats.tours, 1] },
    { k: "tour5", ico: "⛵", name: "Tour veteran", desc: "Finish 5 island tours", mi: 800, get: () => [S.stats.tours, 5] },
    { k: "pet15", ico: "🐾", name: "Animal pal", desc: "Care for animals 15 times", mi: 400, get: () => [S.stats.pets, 15] },
    { k: "harv20", ico: "🥕", name: "Farmhand", desc: "Harvest or pick 20 times", mi: 400, get: () => [S.stats.harvests, 20] },
    { k: "quest5", ico: "📦", name: "Helpful neighbor", desc: "Finish 5 favors", mi: 500, get: () => [S.stats.quests, 5] },
    { k: "wish3", ico: "🌠", name: "Stargazer", desc: "Wish on 3 shooting stars", mi: 400, get: () => [S.stats.wishes, 3] },
  ];

  // alog event -> stat counters
  function onAlog(e) {
    const st = S.stats, ev = e.e, d = e.d;
    if (ev === "catch") {
      st.catches++;
      const it = DH.items.get(d);
      if (it && it.cat === "fish") st.fish++;
    }
    else if (ev === "dive") st.catches++;
    else if (ev === "weed") st.weeds++;
    else if (ev === "find" && typeof d === "string" && d.indexOf("dig:fossil") === 0) st.fossils++;
    else if (typeof ev === "string" && ev.indexOf("hybrid-") === 0) st.hybrids++;
    else if (ev === "mem" && typeof d === "string" && (d.indexOf("photo:") === 0 || d.indexOf("snap:") === 0)) st.photos++;
    else if (ev === "vletter") st.letters++;
    else if (ev === "vgift" || ev === "vdeliver") st.gifts++;
    else if (ev === "vquestdone" || ev === "vvilla") st.quests++;
    else if (ev === "craft" && typeof d === "string") {
      if (d.indexOf("craft:") === 0 || d.indexOf("remake:") === 0) st.crafts++;
      else if (d.indexOf("cook:") === 0) st.cooks++;
    }
    else if (ev === "econ_sell" || ev === "econ_sellall" || ev === "econ_bin") st.sells++;
    else if (ev === "env_wish" || ev === "npc_wish") st.wishes++;
    else if (ev === "island-rating" && typeof d === "number" && d > st.maxStars) st.maxStars = d;
    else if ((ev === "act" || ev === "act2") && typeof d === "string") {
      // action-label events (animals/garden don't log their own)
      if (/^(pet|feed|milk|shear|play with|collect)\b/i.test(d)) st.pets++;
      else if (/^(harvest|pick)\b/i.test(d) && !/^pick up/i.test(d)) st.harvests++;
    }
  }

  function scanAlog() {
    if (!DH.alog || !DH.alog.dump) return;
    const buf = DH.alog.dump(240) || [];
    let ord = 0;
    for (const e of buf) {
      if (!e || typeof e.t !== "number" || e.t < S.seenT) continue;
      if (e.t === S.seenT) { ord++; if (ord <= S.seenN) continue; }
      else { S.seenT = e.t; ord = 1; S.seenN = 0; }
      try { onAlog(e); } catch (err) {}
      S.seenN = ord;
    }
  }

  // cheap state polls — sources the alog can't see
  function pollStats() {
    const st = S.stats;
    if (S.lastCoins == null || S.lastCoins < 0) S.lastCoins = gs.coins;
    if (gs.coins > S.lastCoins) st.coinsEarned += gs.coins - S.lastCoins;
    S.lastCoins = gs.coins;
    try { // museum donation counter
      const d = DH.museum && DH.museum._state && DH.museum._state.stats;
      if (d && d.donations > st.donations) st.donations = d.donations;
    } catch (e) {}
    try { // island rating (G-5)
      if (DH.island && DH.island.rating) {
        const r = DH.island.rating();
        if (r && r.stars > st.maxStars) st.maxStars = r.stars;
      }
    } catch (e) {}
    try { // partner mail queued in the visits mailbox = a sent letter/gift
      const mb = (DH.visits && DH.visits._state && DH.visits._state.mailbox) || {};
      const box = (mb.koto || []).concat(mb.zuza || []);
      if (box.length > S.mailSeen) {
        for (const p of box.slice(S.mailSeen)) { if (p && p.item) st.gifts++; else st.letters++; }
      }
      S.mailSeen = box.length;
    } catch (e) {}
  }

  function sparkles(x, y, n) {
    for (let i = 0; i < (n || 7); i++)
      if (fx.length < 80) fx.push({ x: x + rnd(-16, 16), y: y - rnd(2, 26), born: Date.now(), ttl: rnd(0.5, 1.1) });
  }

  function award(a) {
    S.done[a.k] = dayStamp();
    S.miles += a.mi;
    const p = (gs.players || [])[0];
    if (p) sparkles(p.x, p.y - 10, 10);
    DH.toast(`Milestone! ${a.name} +${a.mi} miles ${a.ico}`, 3400);
    alog("milestone", a.k);
    DH.save.now();
  }

  function checkAch() {
    for (const a of ACH) {
      if (S.done[a.k]) continue;
      let cur = 0, need = 1;
      try { [cur, need] = a.get(); } catch (e) { continue; }
      if (cur >= need) award(a);
    }
  }

  function dayCheck() {
    const today = new Date().toDateString();
    if (S.lastPlay === today) return;
    const yest = new Date(Date.now() - 864e5).toDateString();
    S.streak = (S.lastPlay === yest) ? (S.streak || 0) + 1 : 1;
    S.lastPlay = today; S.daysN = (S.daysN || 0) + 1;
  }

  // ---------- stamp card overlay (DOM, like memories' album) ----------
  let cardEl = null, cardTimer = null;
  function cardUI() {
    if (cardEl) return cardEl;
    const o = document.createElement("div");
    o.className = "overlay hidden";
    o.style.zIndex = "19"; // under #toast(20), over touchLayer(15)
    o.innerHTML =
      '<div class="card" style="max-width:560px">' +
        '<h2>🍃 Nook Miles <span class="mibal" style="font-size:14px;opacity:.75"></span></h2>' +
        '<div class="migrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:8px;max-height:52vh;overflow-y:auto"></div>' +
        '<div style="margin-top:12px"><button class="midbtn mix">Close</button></div>' +
      '</div>';
    o.addEventListener("click", e => { if (e.target === o) closeStamps(); });
    o.querySelector(".mix").addEventListener("click", closeStamps);
    document.getElementById("stage").appendChild(o);
    cardEl = o;
    return o;
  }
  function renderStamps() {
    if (!cardEl || !gs) return;
    cardEl.querySelector(".mibal").textContent = `· ${S.miles} miles · ${Object.keys(S.done).length}/${ACH.length} stamped`;
    const grid = cardEl.querySelector(".migrid");
    grid.innerHTML = "";
    for (const a of ACH) {
      const done = S.done[a.k] != null;
      let cur = 0, need = 1;
      try { [cur, need] = a.get(); } catch (e) {}
      const c = document.createElement("div");
      c.style.cssText = "border-radius:10px;padding:8px 6px;text-align:center;font-size:10px;line-height:1.35;" +
        (done ? "background:#1d3a24;border:1px solid #57a05b;box-shadow:inset 0 0 0 1px #ffe98a33"
              : "background:#14142a;border:1px solid #ffffff14;opacity:.85");
      const prog = done ? `<div style="color:#9fe0a8">STAMPED · day ${S.done[a.k]}</div>`
                        : `<div style="opacity:.6">${Math.min(cur, need)}/${need}</div>`;
      c.innerHTML =
        `<div style="font-size:22px;${done ? "" : "filter:grayscale(.7);opacity:.75"}">${a.ico}</div>` +
        `<div style="font-weight:700;font-size:11px">${a.name}</div>` +
        `<div style="opacity:.6">${a.desc}</div>` + prog +
        `<div style="color:#9fe0a8;font-weight:700">${a.mi} mi</div>`;
      grid.appendChild(c);
    }
  }
  function openStamps() {
    if (!gs || !gs.running) { DH.toast("Start playing first!"); return; }
    cardUI().classList.remove("hidden");
    if (!isGuest()) gs.paused = true;
    renderStamps();
    clearInterval(cardTimer);
    cardTimer = setInterval(renderStamps, 700); // picks up host snapshots on guests
    alog("miles_card");
  }
  function closeStamps() {
    if (cardEl) cardEl.classList.add("hidden");
    clearInterval(cardTimer);
    if (gs && !isGuest()) gs.paused = false;
  }

  // ---------- Nook Stop menu (miles shop, E-4) ----------
  function openNook() {
    if (!gs) return;
    const cap = gs.pocketCap || 20;
    DH.menu.open(`🏧 Nook Stop · ${S.miles} mi`, [
      { ico: "⭐", label: `Stamp card · ${Object.keys(S.done).length}/${ACH.length} stamped`, cb: openStamps },
      { ico: "🎫", label: `Tour ticket · 2000mi (have ${DH.inv.count("tour-ticket")})`, disabled: S.miles < TICKET_MI, cb: () => act("buyTicket") },
      { ico: "🎒", label: cap >= 40 ? "Pockets maxed (40 slots)" : `Pocket upgrade → ${cap + 10} slots · 5000mi`, disabled: S.miles < POCKET_MI || cap >= 40, cb: () => act("buyPockets") },
      { ico: "🪧", label: "Nook sign · 800mi", disabled: S.miles < FURN_MI, cb: () => act("buyItem", "nook-sign") },
      { ico: "🚩", label: "Island flag · 800mi", disabled: S.miles < FURN_MI, cb: () => act("buyItem", "island-flag") },
      { ico: "💇", label: S.flags.hair ? "Hairstyles pack — owned" : "Hairstyles pack · 2400mi", disabled: S.miles < HAIR_MI || !!S.flags.hair, cb: () => act("buyHair") },
      { ico: "🍃", label: "Miles come from milestones — check the stamp card!", disabled: true, cb() {} },
    ]);
    alog("miles_shop");
  }

  // ---------- island tours (E-5) ----------
  const ARCHES = [
    { id: "bamboo", name: "Bamboo Grove", sand: "#cfe0a0", sand2: "#dcebb4", sea: "#2f8fb8", deco: "bamboo" },
    { id: "money", name: "Money Rock Isle", sand: "#d8d0bc", sand2: "#e6dec9", sea: "#2f6fb8", deco: "rocks" },
    { id: "flower", name: "Rare Bloom Isle", sand: "#eed4dc", sand2: "#f6e2e8", sea: "#3d88c2", deco: "flowers" },
  ];
  const NODE_LABEL = { shoot: "Dig bamboo shoot 🎍", rock: "Strike money rock ⛏️", bloom: "Pick rare bloom 🌺" };
  const BLOOM_ITEMS = ["rare-rose", "gold-mum", "blue-orchid"];

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function buildNodes(arche, seed) {
    const r = mulberry32(seed * 977 + 13);
    const kind = arche === "bamboo" ? "shoot" : arche === "money" ? "rock" : "bloom";
    const nodes = [];
    // scatter in the isle ellipse
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + r() * 0.7;
      const rx = 60 + r() * 90, ry = 45 + r() * 70;
      nodes.push({
        id: "t" + S.nextId++, k: kind, got: false,
        x: clamp(ISLE.cx + Math.cos(a) * rx, ISLE.x0 + 14, ISLE.x1 - 14),
        y: clamp(ISLE.cy + Math.sin(a) * ry, ISLE.y0 + 24, ISLE.y1 - 10),
      });
    }
    // money isle bonus: one chunky "mother lode" rock
    if (arche === "money") nodes.push({ id: "t" + S.nextId++, k: "lode", got: false, x: ISLE.cx, y: ISLE.cy - 30 });
    return nodes;
  }

  function openTourMenu() {
    const n = DH.inv.count("tour-ticket");
    DH.menu.open("⛵ Island tour", [
      { ico: "🎫", label: `Set sail — 1 tour ticket (have ${n})`, disabled: n < 1, cb: () => act("startTour") },
      { ico: "🏝️", label: "Bamboo grove · money-rock isle · rare-bloom isle — one awaits!", disabled: true, cb() {} },
      { ico: "🏧", label: "Tickets cost 2000mi at the Nook Stop by the mailbox", disabled: true, cb() {} },
    ]);
  }

  // ---------- mutations (named + remote-callable) ----------
  const API = {
    buyTicket() {
      if (!gs || S.miles < TICKET_MI) { DH.toast("Not enough miles 🍃"); return false; }
      if (DH.inv.add("tour-ticket", 1) <= 0) { DH.toast("Pockets are full! ☹️"); return false; }
      S.miles -= TICKET_MI;
      DH.toast("🎫 Tour ticket! The jetty on the pond's south shore awaits ⛵", 3200);
      alog("miles_buy", "ticket");
      DH.save.now();
      return true;
    },
    buyPockets() {
      const cap = gs && gs.pocketCap || 20;
      if (!gs || cap >= 40) { DH.toast("Pockets already maxed! 🎒"); return false; }
      if (S.miles < POCKET_MI) { DH.toast("Not enough miles 🍃"); return false; }
      S.miles -= POCKET_MI;
      gs.pocketCap = cap + 10; // same field tools.upgrade bumps (items.js reads gs.pocketCap)
      DH.toast(`Pockets expanded to ${gs.pocketCap} slots! 🎒✨`, 2800);
      alog("miles_buy", "pockets:" + gs.pocketCap);
      DH.save.now();
      return true;
    },
    buyItem(id) {
      const d = DH.items.get(id);
      if (!gs || !d || (id !== "nook-sign" && id !== "island-flag")) return false;
      if (S.miles < FURN_MI) { DH.toast("Not enough miles 🍃"); return false; }
      if (DH.inv.add(id, 1) <= 0) { DH.toast("Pockets are full! ☹️"); return false; }
      S.miles -= FURN_MI;
      DH.toast(`Redeemed: ${d.ico} ${d.name}! Find it in your pockets 🎒`, 2800);
      alog("miles_buy", id);
      DH.save.now();
      return true;
    },
    buyHair() {
      if (!gs || S.flags.hair) { DH.toast("Already unlocked! 💇"); return false; }
      if (S.miles < HAIR_MI) { DH.toast("Not enough miles 🍃"); return false; }
      S.miles -= HAIR_MI;
      S.flags.hair = 1;
      DH.toast("💇 Hairstyles unlocked! (fashion mirror can style you now)", 3200);
      alog("miles_buy", "hair");
      DH.save.now();
      return true;
    },
    startTour() {
      if (!gs || S.tour.active) return false;
      if (DH.npcs && DH.npcs.onTrip) { DH.toast("The boat is already out — wait for it to return ⛵"); return false; }
      if (DH.inv.remove("tour-ticket", 1) <= 0) { DH.toast("You need a tour ticket 🎫 — redeem miles at the Nook Stop!"); return false; }
      const arche = ARCHES[Math.floor(Math.random() * ARCHES.length)];
      const ps = gs.players || [];
      S.tour.backX = ps[0] ? ps[0].x : JETTY.x; S.tour.backY = ps[0] ? ps[0].y : JETTY.y;
      S.tour.b2X = ps[1] ? ps[1].x : JETTY.x + 16; S.tour.b2Y = ps[1] ? ps[1].y : JETTY.y;
      S.tour.arche = arche.id;
      S.tour.nodes = buildNodes(arche.id, (S.stats.tours + 1) * 31 + dayStamp());
      S.tour.until = Date.now() + TOUR_MS;
      S.tour.fadeUntil = Date.now() + 1300;
      S.tour.active = true; M.onTour = true;
      if (ps[0]) { ps[0].x = 180; ps[0].y = 438; }
      if (ps[1]) { ps[1].x = 210; ps[1].y = 444; }
      DH.toast(`⛵ Welcome to ${arche.name}! Gather freely — 3 minutes on the clock.`, 4400);
      alog("miles_tour", arche.id);
      return true;
    },
    sailBack(reason) {
      if (!gs || !S.tour.active) return false;
      const ps = gs.players || [];
      if (ps[0]) { ps[0].x = S.tour.backX; ps[0].y = S.tour.backY; }
      if (ps[1]) { ps[1].x = S.tour.b2X; ps[1].y = S.tour.b2Y + 14; }
      const got = S.tour.nodes.filter(n => n.got).length;
      const arche = (ARCHES.find(a => a.id === S.tour.arche) || ARCHES[0]).name;
      S.tour.active = false; M.onTour = false;
      S.tour.nodes = [];
      S.tour.fadeUntil = Date.now() + 1100;
      S.stats.tours++;
      DH.toast(reason === "time"
        ? `⛵ Time's up — sailed home from ${arche} with ${got} find${got === 1 ? "" : "s"}!`
        : `⛵ Back home — ${got} island find${got === 1 ? "" : "s"} gathered!`, 3600);
      alog("miles_sailback", got);
      checkAch();
      DH.save.now();
      return true;
    },
    gather(nodeId) {
      if (!gs || !S.tour.active) return false;
      const n = S.tour.nodes.find(n2 => n2.id === nodeId);
      if (!n || n.got) return false;
      let msg = "";
      if (n.k === "shoot") {
        if (DH.inv.add("bamboo-shoot", 1) <= 0) { DH.toast("Pockets are full! ☹️"); return false; }
        msg = "🎍 Bamboo shoot!";
      } else if (n.k === "rock" || n.k === "lode") {
        const bell = n.k === "lode" ? Math.round(rnd(600, 900)) : Math.round(rnd(90, 320));
        gs.coins += bell;
        msg = `⛏️ +🪙${bell}!`;
        if (n.k === "lode" || Math.random() < 0.18) {
          if (DH.inv.add("gold", 1) > 0) msg += " a gold nugget gleams ✨";
        }
      } else if (n.k === "bloom") {
        const id = pick(BLOOM_ITEMS);
        if (DH.inv.add(id, 1) <= 0) { DH.toast("Pockets are full! ☹️"); return false; }
        msg = `${DH.items.label(id)}!`;
      }
      n.got = true;
      sparkles(n.x, n.y, 7);
      const left = S.tour.nodes.filter(n2 => !n2.got).length;
      DH.toast(`${msg} ${left ? `${left} finds left` : "isle gathered clean — sail back anytime ⛵"}`, 3000);
      alog("miles_gather", n.k);
      return true;
    },
  };

  // route a UI action: host/solo runs it now, guests ask the host via remoteAction
  function act(name, ...args) {
    if (isGuest()) { DH.net.guestAction("miles." + name, args); return undefined; }
    return typeof API[name] === "function" ? API[name](...args) : false;
  }

  // ---------- module contract ----------
  const M = (DH.miles = {
    authority: true,
    _state: S, // debug/testing handle
    onTour: false,

    init(state) {
      gs = state;
      M.authority = !(DH.net && DH.net.online && DH.net.role === "guest");
      const W = DH.world;
      if (W && W.blocked) W.blocked.add(NOOK.tx + "," + NOOK.ty);
      if (W && !W._milesPatched) {
        W._milesPatched = true;
        const s0 = W.isSolid.bind(W);
        W.isSolid = (tx, ty) => s0(tx, ty) || W.blocked.has(tx + "," + ty);
      }
    },

    start(state) {
      gs = state;
      M.authority = !(DH.net && DH.net.online && DH.net.role === "guest");
      fx.length = 0;
      if (S.lastCoins < 0) S.lastCoins = gs.coins;
      M.onTour = !!(S.tour && S.tour.active);
    },

    update(dt, state) {
      gs = state;
      if (!M.authority) return;
      dayCheck();
      // keep trippers on the sand
      if (S.tour.active) {
        for (const p of state.players || []) {
          p.x = clamp(p.x, ISLE.x0, ISLE.x1);
          p.y = clamp(p.y, ISLE.y0, ISLE.y1);
        }
        if (Date.now() >= S.tour.until) API.sailBack("time");
      }
      S.scanT = (S.scanT || 0) + dt;
      if (S.scanT >= 2.5) {
        S.scanT = 0;
        scanAlog();
        pollStats();
        checkAch();
      }
      S.saveT = (S.saveT || 0) + dt;
      if (S.saveT >= 8) { S.saveT = 0; DH.save.now(); }
    },

    interactables(p) {
      if (!gs || !gs.running || !p) return [];
      const out = [];
      if (S.tour.active) {
        for (const n of S.tour.nodes) {
          if (n.got) continue;
          const d = dist2(p.x, p.y, n.x, n.y);
          if (d < 36 * 36)
            out.push({ label: n.k === "lode" ? "Strike the mother lode ⛏️" : NODE_LABEL[n.k], x: n.x, y: n.y, d2: d, action: () => act("gather", n.id) });
        }
        const dS = dist2(p.x, p.y, SAIL.x, SAIL.y);
        if (dS < 48 * 48) out.push({ label: "Sail back ⛵", x: SAIL.x, y: SAIL.y, d2: dS, action: () => act("sailBack") });
        out.sort((a, b) => a.d2 - b.d2);
        return out;
      }
      // Nook Stop — defer to the mailbox when the player is clearly nearer to it
      const nx = NOOK.tx * T + 16, ny = NOOK.ty * T + 16;
      const dN = dist2(p.x, p.y, nx, ny);
      if (dN < 44 * 44) {
        const dM = dist2(p.x, p.y, MAILBOX_PT.x, MAILBOX_PT.y);
        if (dN <= dM + 12 * 12) out.push({ label: "Nook Stop 🏧", x: nx, y: ny, d2: dN, action: openNook });
      }
      // tour jetty (pond south shore)
      const dJ = dist2(p.x, p.y, JETTY.x, JETTY.y);
      if (dJ < 52 * 52)
        out.push({ label: "Island tour 🎫", x: JETTY.x, y: JETTY.y, d2: dJ, action: openTourMenu });
      out.sort((a, b) => a.d2 - b.d2);
      return out;
    },

    collectDraws(draws, camX, camY) {
      if (!ctx2) ctx2 = document.getElementById("cv").getContext("2d");
      draws.push({ y: NOOK.ty * T + T, fn: () => drawNookStop(ctx2, NOOK.tx * T - camX, NOOK.ty * T - camY) });
      draws.push({ y: 18 * T + 14, fn: () => drawJetty(ctx2, JETTY.x - camX, 18 * T - camY) });
      draws.push({ y: RAFT.y + 8, fn: () => drawRaft(ctx2, RAFT.x - camX, RAFT.y - camY) });
    },

    drawOverlay(ctx, camX, camY, state) {
      ctx2 = ctx;
      // ---- fullscreen tour-island scene (E-5) ----
      if (S.tour.active) {
        if (!(DH.npcs && DH.npcs.onTrip)) drawTour(ctx, camX, camY, state);
        return;
      }
      // sail fade veil (both ends)
      const fadeLeft = (S.tour.fadeUntil || 0) - Date.now();
      if (fadeLeft > 0) {
        ctx.fillStyle = `rgba(20,40,80,${Math.min(1, fadeLeft / 900)})`;
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      }
      // miles chip (bottom-left)
      if (state && state.running) {
        ctx.font = "bold 11px sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
        const txt = `🍃 ${S.miles}`;
        const w = ctx.measureText(txt).width + 18;
        ctx.fillStyle = "#14142acc"; // chip bg
        ctx.fillRect(8, ctx.canvas.height - 30, w, 22);
        ctx.fillStyle = "#57a05b"; ctx.fillRect(8, ctx.canvas.height - 30, 3, 22);
        ctx.fillStyle = "#9fe0a8";
        ctx.fillText(txt, 16, ctx.canvas.height - 19);
      }
      // fx sparks
      const now = Date.now();
      ctx.font = "10px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      for (let i = fx.length - 1; i >= 0; i--) {
        const f = fx[i], age = (now - f.born) / 1000;
        if (age >= f.ttl) { fx.splice(i, 1); continue; }
        ctx.globalAlpha = Math.max(0, 1 - age / f.ttl);
        ctx.fillText("✨", f.x - camX, f.y - camY - age * 26);
        ctx.globalAlpha = 1;
      }
    },

    // ---------- sync boundary ----------
    serialize() {
      return JSON.parse(JSON.stringify({
        miles: S.miles, done: S.done, stats: S.stats,
        seenT: S.seenT, seenN: S.seenN, mailSeen: S.mailSeen,
        streak: S.streak, lastPlay: S.lastPlay, daysN: S.daysN,
        flags: S.flags, tour: S.tour, nextId: S.nextId,
      }));
    },
    deserialize(d) {
      if (!d || typeof d !== "object") return;
      if (typeof d.miles === "number") S.miles = Math.max(0, Math.floor(d.miles));
      if (d.done && typeof d.done === "object") S.done = d.done;
      if (d.stats && typeof d.stats === "object")
        for (const k in S.stats) if (typeof d.stats[k] === "number") S.stats[k] = d.stats[k];
      if (typeof d.seenT === "number") S.seenT = d.seenT;
      if (typeof d.seenN === "number") S.seenN = d.seenN;
      if (typeof d.mailSeen === "number") S.mailSeen = d.mailSeen;
      if (typeof d.streak === "number") S.streak = d.streak;
      if (typeof d.lastPlay === "string") S.lastPlay = d.lastPlay;
      if (typeof d.daysN === "number") S.daysN = d.daysN;
      if (d.flags && typeof d.flags === "object") S.flags = Object.assign({ hair: 0 }, d.flags);
      if (d.tour && typeof d.tour === "object") {
        S.tour = Object.assign({ active: false, arche: "", until: 0, backX: 0, backY: 0, b2X: 0, b2Y: 0, nodes: [], fadeUntil: 0 }, d.tour);
        M.onTour = !!S.tour.active;
      }
      if (typeof d.nextId === "number") S.nextId = d.nextId;
    },
    remoteAction(name, args) {
      if (typeof name !== "string" || !name.startsWith("miles.")) return false;
      const n = name.slice(6);
      return typeof API[n] === "function" ? API[n].apply(null, args || []) : false;
    },
    offline() { return []; },

    // exposed API (menus + tests + other modules)
    buyTicket: API.buyTicket, buyPockets: API.buyPockets, buyItem: API.buyItem,
    buyHair: API.buyHair, startTour: API.startTour, sailBack: API.sailBack, gather: API.gather,
    openNook, openStamps, openTourMenu, closeStamps,
    hairUnlocked: () => !!S.flags.hair,
    addMiles(n) { S.miles += Math.max(0, n | 0); }, // test/reward hook
  });

  // ---------- drawing ----------
  function drawNookStop(ctx, x, y) {
    // little green ATM terminal on a wooden base
    R(ctx, x + 9, y + 22, 14, 9, "#6e4a2a");                      // pedestal
    R(ctx, x + 7, y + 29, 18, 3, "#5a3d22");                      // foot
    R(ctx, x + 4, y - 2, 24, 25, "#2f9e57");                      // body
    R(ctx, x + 4, y - 2, 24, 3, "#4ec97a");                       // top edge light
    R(ctx, x + 4, y + 20, 24, 3, "#1f7a40");                      // bottom shade
    R(ctx, x + 7, y + 2, 18, 10, "#cfe8ff");                      // screen
    R(ctx, x + 8, y + 3, 16, 2, "#3a6fd8");                       // screen title bar
    R(ctx, x + 9, y + 6, 11, 1.4, "#8ab8e8");                     // screen text lines
    R(ctx, x + 9, y + 8.5, 14, 1.4, "#8ab8e8");
    R(ctx, x + 7, y + 14, 7, 2.4, "#ffd76b");                     // card slot
    R(ctx, x + 22, y + 14, 3, 3, "#e04848");                      // big button
    R(ctx, x + 17, y + 14, 4, 2.4, "#2a5a3a");                    // keypad hint
    // leaf emblem + glow
    R(ctx, x + 14, y - 4, 4, 2, "#b8f0c8"); R(ctx, x + 15, y - 6, 2, 2, "#b8f0c8");
    const blink = (Date.now() / 800) % 2 < 1;
    if (blink) R(ctx, x + 25, y + 1, 2, 2, "#ffe98a");            // status LED
  }

  function drawJetty(ctx, x, y) {
    // plank jetty stub on the pond's south shore + TOURS sign
    R(ctx, x - 9, y - 18, 18, 16, "#a07840");
    R(ctx, x - 9, y - 18, 18, 2, "#c09858");
    for (let i = 0; i < 3; i++) R(ctx, x - 9, y - 13 + i * 6, 18, 1, "#7a5527");
    R(ctx, x - 10, y - 8, 3, 9, "#6e4a2a"); R(ctx, x + 7, y - 8, 3, 9, "#6e4a2a"); // posts
    R(ctx, x - 11, y - 10, 4, 3, "#96693a"); R(ctx, x + 7, y - 10, 4, 3, "#96693a");
    // sign
    R(ctx, x + 13, y - 4, 3, 16, "#6e4a2a");
    R(ctx, x + 8, y - 11, 14, 9, "#f4e8d0");
    ctx.fillStyle = "#3a2412"; ctx.font = "bold 5px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("TOURS", x + 15, y - 6.5);
    ctx.font = "7px sans-serif"; ctx.fillText("🎫", x + 15, y - 2);
  }

  function drawRaft(ctx, x, y) {
    const bob = Math.sin(Date.now() / 620) * 1.4, tilt = Math.sin(Date.now() / 900) * 0.04;
    ctx.save(); ctx.translate(x, y + bob); ctx.rotate(tilt);
    // log raft
    for (let i = 0; i < 4; i++) R(ctx, -12 + i * 6, -3, 5, 8, i % 2 ? "#96683c" : "#a67a45");
    R(ctx, -12, -3, 23, 2, "#7a5527");
    R(ctx, -12, 3, 23, 2, "#6e4a2a");
    // mast + pennant
    R(ctx, -1, -20, 2, 17, "#5a4020");
    ctx.fillStyle = "#e05b5b";
    ctx.beginPath(); ctx.moveTo(1, -20); ctx.lineTo(10, -16); ctx.lineTo(1, -12); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // ---------- tour-isle fullscreen scene ----------
  function drawDeco(ctx, camX, camY, arche, now) {
    const W = (wx, wy) => [wx - camX, wy - camY];
    if (arche.deco === "bamboo") {
      const r = mulberry32(77);
      for (let i = 0; i < 7; i++) {
        const bx = ISLE.x0 + 12 + r() * (ISLE.x1 - ISLE.x0 - 24), by = ISLE.y0 + 20 + r() * 34;
        const [sx, sy] = W(bx, by);
        const sway = Math.sin(now / 900 + i) * 1.2;
        R(ctx, sx - 1 + sway * 0.4, sy - 34, 3, 34, "#5aa84f");
        R(ctx, sx - 1 + sway * 0.4, sy - 22, 3, 1.5, "#3f7a38");
        R(ctx, sx - 1 + sway * 0.4, sy - 12, 3, 1.5, "#3f7a38");
        R(ctx, sx - 5 + sway, sy - 36, 5, 3, "#6ec25f"); R(ctx, sx + 1 + sway, sy - 30, 5, 3, "#6ec25f");
      }
    } else if (arche.deco === "rocks") {
      const spots = [[ISLE.x0 + 26, ISLE.y0 + 40], [ISLE.x1 - 30, ISLE.y0 + 60], [ISLE.x0 + 40, ISLE.y1 - 26], [ISLE.x1 - 40, ISLE.y1 - 40]];
      for (const [bx, by] of spots) {
        const [sx, sy] = W(bx, by);
        R(ctx, sx - 7, sy - 6, 14, 8, "#8a9098"); R(ctx, sx - 5, sy - 8, 10, 3, "#a8b0b8");
        R(ctx, sx - 4, sy - 3, 3, 2, "#6a7078");
      }
    } else {
      const r = mulberry32(55);
      for (let i = 0; i < 12; i++) {
        const bx = ISLE.x0 + 10 + r() * (ISLE.x1 - ISLE.x0 - 20), by = ISLE.y0 + 16 + r() * (ISLE.y1 - ISLE.y0 - 30);
        const [sx, sy] = W(bx, by);
        R(ctx, sx, sy - 4, 2, 5, "#3f8f33");
        ctx.fillStyle = pick(["#ff7fa5", "#c58bff", "#ffd94d", "#9fd8ff"]);
        ctx.fillRect(sx - 2, sy - 7, 5, 4); ctx.fillRect(sx - 3, sy - 6, 7, 2);
      }
    }
  }

  function drawTour(ctx, camX, camY, state) {
    const now = Date.now();
    const cw = ctx.canvas.width, ch = ctx.canvas.height;
    const W = (wx, wy) => [wx - camX, wy - camY];
    const arche = ARCHES.find(a => a.id === S.tour.arche) || ARCHES[0];
    // sea
    ctx.fillStyle = arche.sea; ctx.fillRect(0, 0, cw, ch);
    ctx.fillStyle = "#ffffff";
    for (let i = 0; i < 40; i++) {
      const wx = ((i * 137 + now * 0.02) % (cw + 60)) - 30, wy = (i * 89) % ch;
      ctx.globalAlpha = 0.22; ctx.fillRect(wx, wy, 14, 2);
    }
    ctx.globalAlpha = 1;
    // island blob
    const [icx, icy] = W(ISLE.cx, ISLE.cy);
    ctx.fillStyle = arche.sand;
    ctx.beginPath(); ctx.ellipse(icx, icy, 175, 155, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = arche.sand2;
    ctx.beginPath(); ctx.ellipse(icx, icy, 158, 138, 0, 0, Math.PI * 2); ctx.fill();
    // shoreline ring
    const ph = (now % 1800) / 1800;
    ctx.strokeStyle = `rgba(255,255,255,${0.5 * (1 - ph)})`; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(icx, icy, 175 + ph * 18, 155 + ph * 16, 0, 0, Math.PI * 2); ctx.stroke();
    drawDeco(ctx, camX, camY, arche, now);
    // nodes
    ctx.font = "14px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (const n of S.tour.nodes) {
      if (n.got) continue;
      const [nx, ny] = W(n.x, n.y);
      const bb = Math.sin(now / 300 + n.x) * 2;
      if (n.k === "rock" || n.k === "lode") {
        const s = n.k === "lode" ? 1.5 : 1;
        ctx.save(); ctx.translate(nx, ny); ctx.scale(s, s);
        R(ctx, -7, -6, 14, 8, "#8a9098"); R(ctx, -5, -8, 10, 3, "#b8c0c8");
        R(ctx, -3, -4, 3, 2, "#ffd76b"); R(ctx, 2, -2, 2, 2, "#ffd76b");
        ctx.restore();
      } else {
        ctx.fillText(n.k === "shoot" ? "🎍" : "🌺", nx, ny - 6 + bb);
      }
      ctx.fillStyle = "#00000022"; ctx.fillRect(nx - 5, ny + 3, 10, 2);
    }
    // sail-back raft at the top of the isle
    {
      const [sx, sy] = W(SAIL.x, SAIL.y - 14);
      drawRaft(ctx, sx, sy);
      ctx.font = "bold 9px sans-serif"; ctx.textAlign = "center";
      ctx.fillStyle = "#ffffffcc"; ctx.fillText("⛵ sail back", sx, sy - 30);
    }
    // players on the isle (repainted — the scene covers the world draw)
    for (const p of state.players || []) {
      const sx = p.x - camX, sy = p.y - camY;
      DH.sprites.shadow(ctx, sx, sy);
      DH.sprites.drawPlayer(ctx, { ...p, x: sx, y: sy });
    }
    // HUD ribbon: name + countdown + loot
    const left = Math.max(0, (S.tour.until || 0) - now);
    const mm = Math.floor(left / 60000), ss = Math.floor((left % 60000) / 1000);
    const got = S.tour.nodes.filter(n => n.got).length;
    ctx.fillStyle = "#1a1a2ecc"; ctx.fillRect(6, 6, 252, 20);
    ctx.font = "bold 10px sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffe9b0";
    ctx.fillText(`🏝️ ${arche.name} · ⏱ ${mm}:${String(ss).padStart(2, "0")} · loot ${got}/${S.tour.nodes.length} · ⛵ to sail home`, 12, 16);
    // fade veil
    const fadeLeft = (S.tour.fadeUntil || 0) - now;
    if (fadeLeft > 0) {
      ctx.fillStyle = `rgba(20,40,80,${Math.min(1, fadeLeft / 900)})`;
      ctx.fillRect(0, 0, cw, ch);
    }
  }
})();

DH.register("miles", DH.miles);
