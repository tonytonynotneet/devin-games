/* dream-home npcs module — special NPC visitors & outings (AC spec M-1..M-4).
   Contract with game.js (self-registers via DH.register at the bottom):
     DH.npcs.init(state) / start(state) / update(dt,state)
     DH.npcs.collectDraws(draws, camX, camY) — bulletin, café counter, Terry,
       today's visitors, pond dock + boat, hidden baby turtle
     DH.npcs.drawOverlay(ctx, camX, camY, state) — name tags, bubbles, FX,
       meteor streaks, and the fullscreen Mini-Isle scene when S.trip.active
     DH.npcs.interactables(p) -> [{label,x,y,action}]
     DH.npcs.serialize()/deserialize(data)/remoteAction(name,args)
     DH.npcs.onTrip — boolean flag: true while the day-trip is underway
       (other modules may use it to vary spawns/behaviour)

   M-1 Terry the tanuki — island manager in a suit by the mailbox/bulletin
       board. "Talk" gives rotating contextual tips; "Island services" points
       to shop/museum/bridge fund; "What's new" summarizes the day.
   M-2 Rotating visitors — 1-2 per day seeded by the real date, standing on
       the east path, gone at night: Katrina the fortune cat (daily fortune →
       lucky-charm item), Sahara the camel (mystery wallpaper/rug goods),
       Shelby the turtle (find her hidden baby → reward). Celeste the owl
       appears on seeded meteor-shower nights (or env's meteor nights) to
       teach wishing → star fragment.
   M-3 Café corner — little counter in the yard; "Order coffee" (🪙50, plus
       a rotating daily special) → cup FX + hearts; if a partner or villager
       is nearby they join in → +happiness, "coffee together" alog entry.
   M-4 Day-trip dock — boat at the pond's north shore. "Take a boat trip"
       (🪙200 or a 🎫 tour ticket) sails to Mini Isle: a fullscreen island
       drawn in drawOverlay over the pasture box — palms, coconut nodes, isle
       blooms, isle beetles, a souvenir gull — then "Sail back" returns home.

   Sync boundary: all sim state lives in S (plain JSON). Guests never run
   update(); they render deserialize() snapshots. Timed visuals use wall-clock
   stamps (until/born fields) so they animate without update(). Mutations are
   named API fns reachable via remoteAction(name,args) or host-side actAt.
*/
(function () {
  const DH = (window.DH = window.DH || {});
  const T = 32;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);

  // ---------- tuning ----------
  const INTERACT_R = 40;
  const NIGHT_FROM = 21 * 60, NIGHT_TO = 6 * 60;   // day visitors leave at night
  const OWL_FROM = 18 * 60, OWL_TO = 5 * 60;       // Celeste's hours on meteor nights
  const SAVE_EVERY = 6;
  const COFFEE_COST = 50, TRIP_COST = 200;
  const TOGETHER_R = 110;                          // "coffee together" radius

  // ---------- items ----------
  const E = DH.items.def;
  E("lucky-charm", { name: "Lucky charm", ico: "🍀", cat: "misc", price: 100, stack: 5 });
  E("wall-mystery", { name: "Mystery wallpaper", ico: "🌌", cat: "furniture", price: 180, stack: 5 });
  E("rug-mystery", { name: "Mystery rug", ico: "🧿", cat: "furniture", price: 150, stack: 5 });
  E("bazaar-lamp", { name: "Bazaar lamp", ico: "🏮", cat: "furniture", price: 160, stack: 5 });
  E("silk-cushion", { name: "Silk cushion", ico: "🛋️", cat: "misc", price: 140, stack: 5 });
  E("tour-ticket", { name: "Tour ticket", ico: "🎫", cat: "misc", price: 0, stack: 5 });
  E("coconut", { name: "Coconut", ico: "🥥", cat: "fruit", price: 120 });
  E("isle-flower", { name: "Isle bloom", ico: "🌺", cat: "flower", price: 150 });
  E("isle-beetle", { name: "Isle beetle", ico: "🪲", cat: "bug", price: 200 });
  E("postcard", { name: "Island postcard", ico: "🏝️", cat: "misc", price: 60 });
  E("grass-skirt", { name: "Grass skirt", ico: "👗", cat: "misc", price: 220 });
  E("coffee-beans", { name: "Roasted beans", ico: "🫘", cat: "food", price: 80 });

  // ---------- world spots ----------
  const BULLETIN = { tx: 14, ty: 11 };                        // board fixture (blocked)
  const TERRY = { x: 15 * T + 16, y: 11 * T + 16 };           // stands by the board
  const CAFE = { tx: 19, ty: 11 };                            // counter fixture (blocked)
  const CAFE_PT = { x: CAFE.tx * T + 16, y: CAFE.ty * T + 30 };
  const DOCK = { x: 24 * T + 16, y: 12 * T + 16 };            // north pond shore
  const BOAT = { x: 24 * T + 16, y: 13.55 * T };              // moored on the water
  // visitor anchors along the east path ("yard entrance")
  const ANCHOR = {
    cat: { x: 16 * T + 16, y: 10 * T + 14 },
    camel: { x: 18 * T + 8, y: 10 * T + 14 },
    turtle: { x: 21 * T + 4, y: 11 * T + 16 },
    owl: { x: 13 * T + 20, y: 10 * T + 14 },
  };
  // Mini Isle = the fenced pasture box re-skinned (walkable bounds keep the
  // player on the sand while the island scene paints fullscreen)
  const ISLE = { x0: 105, y0: 393, x1: 279, y1: 535, cx: 192, cy: 464 };
  const SAIL = { x: 192, y: 396 };                            // sail-back point
  const GULL = { x: 245, y: 400 };                            // souvenir stand
  const PALMS = [[122, 418], [268, 425], [138, 548], [252, 546], [196, 330]];
  const BABY_SPOTS = [
    { tx: 1, ty: 6 }, { tx: 28, ty: 11 }, { tx: 29, ty: 9 }, { tx: 1, ty: 16 },
    { tx: 24, ty: 18 }, { tx: 29, ty: 1 }, { tx: 16, ty: 16 }, { tx: 1, ty: 2 },
  ];

  // ---------- seeded helpers ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function dateSeed() { const d = new Date(); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }

  // ---------- module state (plain JSON only) ----------
  let gs = null, ctx2 = null;
  const S = {
    tipIdx: 0,          // Terry's rotating tip pointer
    done: {},           // kind -> dateSeed() for one-shot daily interactions
    wishDay: -1,        // game-day a wish was made
    dayKey: -1,         // real-date key last seen (visitor arrival toast)
    lastDay: -1,        // game-day last seen (housekeeping)
    turtleQ: { day: -1, spot: null, accepted: false, found: false, rewarded: false },
    trip: { active: false, backX: 0, backY: 0, b2X: 0, b2Y: 0, fadeUntil: 0, nodes: [], seedN: 0 },
    nextId: 1,
  };
  const fx = [];                 // view layer only: {k,x,y,vx,vy,born,ttl,c,txt}
  const bub = {};                // view layer speech bubbles: key -> {txt,until}
  const alog = (e, d) => { if (DH.alog) DH.alog.add(e, d); };
  const addHappy = n => { if (gs) gs.happiness = Math.max(0, gs.happiness + n); };
  const isNight = () => gs && (gs.timeMin >= NIGHT_FROM || gs.timeMin < NIGHT_TO);
  const dayStamp = () => Math.floor((gs && gs.day) || 0);

  // ---------- visitor roster (seeded by real date) ----------
  function roster() {
    const r = mulberry32(dateSeed()), pool = ["cat", "camel", "turtle"], out = [];
    const n = r() < 0.5 ? 1 : 2;
    while (out.length < n && pool.length) out.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
    return out;
  }
  function meteorNight() {
    if (DH.env && typeof DH.env.meteor === "function") { try { return !!DH.env.meteor(); } catch (e) {} }
    return mulberry32(dateSeed() + 7)() < 0.38;
  }
  const visHere = kind => !isNight() && roster().includes(kind);
  const owlHere = () => meteorNight() && gs && (gs.timeMin >= OWL_FROM || gs.timeMin < OWL_TO);
  const isDone = kind => S.done[kind] === dateSeed();
  const markDone = kind => { S.done[kind] = dateSeed(); };

  // ---------- FX (wall-clock; guests animate without update()) ----------
  function fxP(k, x, y, o) {
    if (fx.length < 100) fx.push(Object.assign({ k, x, y, vx: 0, vy: -24, born: Date.now(), ttl: 1 }, o));
  }
  function hearts(x, y, n = 2) { for (let i = 0; i < n; i++) fxP("heart", x + rnd(-10, 10), y - 14 + rnd(-6, 0), { ttl: 0.9 }); }
  function sparkles(x, y, n = 6) { for (let i = 0; i < n; i++) fxP("spark", x + rnd(-14, 14), y - rnd(4, 26), { vy: -10, ttl: rnd(0.5, 1) }); }
  function cupAt(x, y) { fxP("cup", x, y - 30, { vy: -4, ttl: 1.9 }); }
  function meteor(x, y) { fxP("meteor", x, y, { vx: -120 - rnd(0, 60), vy: 70 + rnd(0, 40), ttl: 0.9 }); }
  function say(key, txt, ms = 2600) { bub[key] = { txt, until: Date.now() + ms }; }

  // ---------- Terry (M-1) ----------
  const TIPS = [
    "Need coins? Sell your forage and crops at Nook's stall by the door path!",
    "Water the garden every day — thirsty plants wilt and yield less.",
    "A villager with an ❗ above their head has a favor to ask!",
    "Save a little at the shop's ATM — it earns interest while you're away.",
    "Check the bulletin board each day — visitors bring rare goods!",
    "The pond dock sails to Mini Isle! Bring 🪙200 or a tour ticket.",
    "Villagers love gifts that match their tastes — watch the ♥ marks!",
    "Coffee at the corner tastes better with company. Bring a friend!",
    "On starry nights you might spot a shooting star — make a wish!",
    "Big dreams need bells — the bridge fund will open before long!",
  ];
  const SEASON_TIPS = {
    spring: "Spring showers make the flowers sing — plant something pretty!",
    summer: "Warm days! The pond tub and cold drinks are your best friends.",
    autumn: "Mushroom season! Forage under the trees before the frost.",
    winter: "The court freezes over in winter — grab a skate and glide!",
  };
  function openTerry() {
    DH.menu.open("🦝 Terry — island guide", [
      { ico: "💬", label: "Chat", cb: () => API.tip() },
      { ico: "🏝️", label: "Island services", cb: openServices },
      { ico: "📋", label: "What's new today?", cb: () => API.whatsNew() },
    ]);
  }
  function openServices() {
    DH.menu.open("🏝️ Island services", [
      { ico: "🏪", label: "Shop & selling", cb: () => DH.toast("Terry: \"Nook's stall is on the door path — sell your finds, buy seeds!\"", 3400) },
      { ico: "🏛️", label: "Museum & curator", cb: () => DH.toast("Terry: \"The museum plinth sits by the house's SE corner — show it your finds!\"", 3400) },
      { ico: "🌉", label: "Bridge fund", cb: () => DH.toast("Terry: \"Dreaming of bridges and inclines! Save your bells — projects open soon.\"", 3400) },
      { ico: "☕", label: "Café corner", cb: () => DH.toast("Terry: \"The café counter is east of the tent — today's special is on the board.\"", 3400) },
      { ico: "◀️", label: "Back", cb: openTerry },
    ]);
  }
  function openBulletin() {
    DH.menu.open("📋 Bulletin board", [
      { ico: "🎪", label: "Today's visitors", cb: () => API.whatsNew() },
      { ico: "☕", label: `Café special: ${todaySpecial().name}`, cb: () => DH.toast(`The café is pouring ${todaySpecial().name} today — 🪙${todaySpecial().cost}!`, 3200) },
      { ico: "🌠", label: "Meteor forecast", cb: () => DH.toast(meteorNight() ? "The board says: clear skies tonight — watch for shooting stars! 🌠" : "No meteors forecast tonight. Check again tomorrow!", 3200) },
      { ico: "💡", label: "Island tip", cb: () => API.tip() },
    ]);
  }

  // ---------- visitors (M-2) ----------
  const FORTUNES = [
    { luck: "amazing", line: "The stars align — everything you touch today turns a little golden!" },
    { luck: "great", line: "Luck favors the bold — go ask for that favor you've been putting off!" },
    { luck: "good", line: "A small kindness returns to you doubled today." },
    { luck: "calm", line: "Slow and steady — today rewards patience and watering cans." },
    { luck: "mysterious", line: "I see… a hidden shell? A rustling bush? Keep your eyes open!" },
  ];
  const CAMEL_GOODS = ["wall-mystery", "rug-mystery", "bazaar-lamp", "silk-cushion"];
  function camelStock() {
    const r = mulberry32(dateSeed() + 31), pool = CAMEL_GOODS.slice(), out = [];
    while (out.length < 3 && pool.length) out.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
    return out.map(id => ({ id, cost: (DH.items.get(id).price * 2) + 40 }));
  }
  function openCat() {
    const c = ANCHOR.cat;
    const rows = [
      { ico: "🔮", label: isDone("cat") ? "Fortune told — come back tomorrow!" : "Hear my fortune", disabled: isDone("cat"), cb: () => API.fortune() },
      { ico: "💬", label: "Chat", cb: () => DH.toast("Katrina: \"The cards whisper of a couple who built a lovely home…\"", 3200) },
    ];
    DH.menu.open("🐱 Katrina the fortune-teller", rows);
  }
  function openOwl() {
    DH.menu.open("🦉 Celeste the stargazer", [
      { ico: "🔭", label: "What are meteor showers?", cb: () => DH.toast("Celeste: \"When the sky rains light, close your eyes and wish! Fragments fall as gifts.\"", 4200) },
      { ico: "⭐", label: S.wishDay === dayStamp() ? "You already wished tonight" : "Make a wish", disabled: S.wishDay === dayStamp() || !owlHere(), cb: () => API.wish() },
    ]);
  }
  function openCamel() {
    const rows = camelStock().map(g => {
      const d = DH.items.get(g.id);
      return { ico: d.ico, label: `${d.name} <small>(imported!)</small>`, cost: g.cost, disabled: !gs || gs.coins < g.cost, cb: () => { API.buyMystery(g.id, g.cost); openCamel(); } };
    });
    rows.push({ ico: "◀️", label: "Back", cb: () => DH.menu.close() });
    DH.menu.open("🐫 Sahara's mystery goods", rows);
  }
  function openTurtle() {
    const q = S.turtleQ;
    const rows = [
      { ico: "💬", label: "Chat", cb: () => DH.toast("Shelby: \"I swam here for the festival… and my little one wandered off!\"", 3200) },
    ];
    if (q.rewarded && isDone("turtle")) rows.push({ ico: "✅", label: "Baby is safe — thank you again!", disabled: true, cb() {} });
    else if (q.found) rows.push({ ico: "🐢", label: "Here's your baby!", cb: () => API.returnBaby() });
    else if (q.accepted) rows.push({ ico: "🔍", label: "Still looking… (check the map edges!)", cb: () => DH.toast("Shelby: \"Babies love hiding at the edges — cliffs, shore, corners!\"", 3200) });
    else rows.push({ ico: "🔍", label: "I'll find your baby!", cb: () => API.acceptTurtle() });
    DH.menu.open("🐢 Shelby the lost turtle", rows);
  }

  // ---------- café corner (M-3) ----------
  const SPECIALS = [
    { id: "mocha", name: "Mocha", cost: 60 },
    { id: "iced", name: "Iced coffee", cost: 45 },
    { id: "latte", name: "Creamy latte", cost: 70 },
    { id: "brew", name: "Island brew", cost: 55 },
    { id: "doppio", name: "Doppio", cost: 65 },
  ];
  const todaySpecial = () => SPECIALS[Math.floor(mulberry32(dateSeed() + 53)() * SPECIALS.length)];
  function openCafe() {
    const sp = todaySpecial();
    DH.menu.open("☕ Café corner", [
      { ico: "☕", label: "House blend", cost: COFFEE_COST, disabled: !gs || gs.coins < COFFEE_COST, cb: () => API.orderCoffee("blend", COFFEE_COST) },
      { ico: "🌟", label: `Today's special: ${sp.name}`, cost: sp.cost, disabled: !gs || gs.coins < sp.cost, cb: () => API.orderCoffee(sp.id, sp.cost) },
      { ico: "💗", label: "Coffee tastes better together — bring a friend!", disabled: true, cb() {} },
    ]);
  }

  // ---------- day-trip dock (M-4) ----------
  function openDock() {
    const hasT = DH.inv.count("tour-ticket") > 0;
    DH.menu.open("⛵ Mini Isle boat", [
      { ico: "🎫", label: `Sail with a tour ticket ${hasT ? "(have " + DH.inv.count("tour-ticket") + ")" : "(none)"}`, disabled: !hasT, cb: () => API.startTrip(true) },
      { ico: "⛵", label: "Sail — 🪙200", cost: TRIP_COST, disabled: !gs || gs.coins < TRIP_COST, cb: () => API.startTrip(false) },
      { ico: "🏝️", label: "Mini Isle: coconuts, rare blooms & beetles, a souvenir stand!", disabled: true, cb() {} },
    ]);
  }
  function buildNodes() {
    const r = mulberry32(S.trip.seedN * 977 + dateSeed());
    const j = (v, a) => clamp(v + (r() - 0.5) * a, 0, 0);
    const cocos = [[130, 430], [255, 435], [160, 525]];
    const blooms = [[230, 480], [160, 465], [200, 520]];
    const bugs = [[205, 445], [172, 495]];
    const nodes = [];
    cocos.forEach(p => nodes.push({ id: "n" + S.nextId++, k: "coco", x: clamp(p[0] + (r() - 0.5) * 30, ISLE.x0, ISLE.x1), y: clamp(p[1] + (r() - 0.5) * 26, ISLE.y0, ISLE.y1), got: false }));
    blooms.forEach(p => nodes.push({ id: "n" + S.nextId++, k: "bloom", x: clamp(p[0] + (r() - 0.5) * 34, ISLE.x0, ISLE.x1), y: clamp(p[1] + (r() - 0.5) * 30, ISLE.y0, ISLE.y1), got: false }));
    bugs.forEach(p => nodes.push({ id: "n" + S.nextId++, k: "bug", x: clamp(p[0] + (r() - 0.5) * 30, ISLE.x0, ISLE.x1), y: clamp(p[1] + (r() - 0.5) * 30, ISLE.y0, ISLE.y1), got: false }));
    return nodes;
  }
  const NODE_ITEM = { coco: "coconut", bloom: "isle-flower", bug: "isle-beetle" };
  const NODE_LABEL = { coco: "Pick a coconut 🥥", bloom: "Pick an isle bloom 🌺", bug: "Catch an isle beetle 🪲" };
  function openSouvenir() {
    const goods = [
      { id: "tour-ticket", cost: 180 }, { id: "postcard", cost: 60 },
      { id: "grass-skirt", cost: 220 }, { id: "coffee-beans", cost: 90 },
    ];
    const rows = goods.map(g => {
      const d = DH.items.get(g.id);
      return { ico: d.ico, label: d.name, cost: g.cost, disabled: !gs || gs.coins < g.cost, cb: () => { API.buySouvenir(g.id, g.cost); openSouvenir(); } };
    });
    DH.menu.open("🕊️ Skipper's souvenirs", rows);
  }

  // ---------- mutations (named + remote-callable) ----------
  const API = {
    tip() {
      if (!gs) return false;
      const line = Math.random() < 0.35 && gs.season ? SEASON_TIPS[gs.season] || TIPS[0] : TIPS[S.tipIdx++ % TIPS.length];
      say("terry", "…", 1); // clears bubble
      DH.toast(`Terry: "${line}"`, 4200);
      alog("npc_tip", S.tipIdx);
      return true;
    },
    whatsNew() {
      if (!gs) return false;
      const parts = [];
      const v = roster();
      if (v.includes("cat")) parts.push("Katrina the fortune cat");
      if (v.includes("camel")) parts.push("Sahara the camel");
      if (v.includes("turtle")) parts.push("Shelby the turtle");
      let msg = `Terry: "${parts.length ? `Visiting today: ${parts.join(" and ")} — on the east path!` : "Quiet day today — just us!"}`;
      msg += ` Café's pouring ${todaySpecial().name}.`;
      if (meteorNight()) msg += " Clear skies tonight — meteors!\"";
      else msg += "\"";
      DH.toast(msg, 4600);
      return true;
    },
    fortune() {
      if (!gs || isDone("cat")) return false;
      markDone("cat");
      const f = FORTUNES[Math.floor(mulberry32(dateSeed() + 11)() * FORTUNES.length)];
      DH.inv.add("lucky-charm", 1);
      sparkles(ANCHOR.cat.x, ANCHOR.cat.y, 10);
      addHappy(1);
      DH.toast(`Katrina: "${f.line}" (+🍀 lucky charm, ${f.luck} luck)`, 4600);
      alog("npc_fortune", f.luck);
      return true;
    },
    wish() {
      if (!gs || !owlHere() || S.wishDay === dayStamp()) return false;
      S.wishDay = dayStamp();
      if (DH.inv.add("star-frag", 1) <= 0) { DH.toast("Pockets are full — the star waits ☹️"); return false; }
      const p = (gs.players || [])[0];
      if (p) { for (let i = 0; i < 4; i++) meteor(p.x + rnd(-140, 160), p.y - rnd(120, 220)); sparkles(p.x, p.y - 20, 8); }
      addHappy(2);
      DH.toast("You wished on a shooting star… something sparkly fell into your pocket! ⭐", 4200);
      alog("npc_wish");
      return true;
    },
    buyMystery(id, cost) {
      const d = DH.items.get(id);
      if (!d || !gs || isDone("camel") && !camelStock().some(g => g.id === id)) return false;
      if (!camelStock().some(g => g.id === id)) return false;
      if (gs.coins < cost) { DH.toast("Not enough coins 🪙"); return false; }
      if (DH.inv.add(id, 1) <= 0) { DH.toast("Pockets are full! ☹️"); return false; }
      gs.coins -= cost;
      addHappy(1);
      say("camel", "a fine choice…", 2600);
      alog("npc_camel", id);
      DH.toast(`Sahara wraps it in silk: ${d.ico} ${d.name}!`);
      return true;
    },
    acceptTurtle() {
      if (!gs || isDone("turtle")) return false;
      const q = S.turtleQ;
      q.day = dateSeed(); q.accepted = true; q.found = false; q.rewarded = false;
      const r = mulberry32(dateSeed() + 5);
      const spot = BABY_SPOTS[Math.floor(r() * BABY_SPOTS.length)];
      q.spot = { tx: spot.tx, ty: spot.ty };
      DH.toast("Shelby: \"Oh thank you!! She loves hiding at the map's edges — shore, corners, behind things!\"", 4800);
      say("turtle", "please hurry…", 3200);
      alog("npc_turtle_go");
      return true;
    },
    catchBaby() {
      const q = S.turtleQ;
      if (!gs || !q.accepted || q.found || !q.spot) return false;
      q.found = true;
      sparkles(q.spot.tx * T + 16, q.spot.ty * T + 16, 8);
      DH.toast("You scooped up the baby turtle! Bring her back to Shelby 🐢", 3200);
      alog("npc_turtle_found");
      return true;
    },
    returnBaby() {
      const q = S.turtleQ;
      if (!gs || !q.found || q.rewarded) return false;
      q.rewarded = true; q.accepted = false; markDone("turtle");
      gs.coins += 150; DH.inv.add("shell", 1);
      addHappy(4);
      hearts(ANCHOR.turtle.x, ANCHOR.turtle.y, 5);
      DH.toast("Shelby: \"MY BABY!! Thank you so much!!\" +🪙150 +🐚", 4200);
      alog("npc_turtle_done");
      return true;
    },
    orderCoffee(kind, cost) {
      if (!gs) return false;
      if (gs.coins < cost) { DH.toast("Not enough coins 🪙"); return false; }
      gs.coins -= cost;
      const p0 = (gs.players || [])[0];
      const cx = CAFE_PT.x, cy = CAFE_PT.y;
      if (p0) cupAt(p0.x, p0.y);
      hearts(cx, cy - 20, 2);
      // company: nearby partner player or villager joins in
      let company = false;
      const p1 = (gs.players || [])[1];
      if (p1 && dist2(p1.x, p1.y, cx, cy) < TOGETHER_R * TOGETHER_R) { cupAt(p1.x, p1.y); hearts(p1.x, p1.y - 20, 3); company = p1.name || "partner"; }
      if (!company && DH.villagers && DH.villagers._state) {
        const v = (DH.villagers._state.vils || []).find(v2 => dist2(v2.x, v2.y, cx, cy) < 160 * 160);
        if (v) { cupAt(v.x, v.y); hearts(v.x, v.y - 20, 3); company = v.name; }
      }
      const d = kind === "blend" ? { name: "House blend" } : SPECIALS.find(s2 => s2.id === kind) || { name: "coffee" };
      if (company) {
        addHappy(3);
        DH.toast(`☕ ${d.name} with ${company} — coffee time together! 💗`, 3200);
        alog("coffee_together", company);
      } else {
        addHappy(1);
        DH.toast(`☕ A warm ${d.name.toLowerCase()} — mmm, cozy.`, 2600);
        alog("coffee", kind);
      }
      return true;
    },
    startTrip(useTicket) {
      if (!gs || S.trip.active) return false;
      if (useTicket) {
        if (!DH.inv.remove("tour-ticket", 1)) { DH.toast("No tour ticket 🎫"); return false; }
      } else {
        if (gs.coins < TRIP_COST) { DH.toast("Not enough coins 🪙"); return false; }
        gs.coins -= TRIP_COST;
      }
      const ps = gs.players || [];
      S.trip.backX = ps[0] ? ps[0].x : DOCK.x; S.trip.backY = ps[0] ? ps[0].y : DOCK.y;
      S.trip.b2X = ps[1] ? ps[1].x : DOCK.x + 16; S.trip.b2Y = ps[1] ? ps[1].y : DOCK.y;
      S.trip.seedN = (S.trip.seedN + 1) % 997;
      S.trip.nodes = buildNodes();
      S.trip.active = true; M.onTrip = true;
      S.trip.fadeUntil = Date.now() + 1300;
      if (ps[0]) { ps[0].x = 180; ps[0].y = 435; }
      if (ps[1]) { ps[1].x = 208; ps[1].y = 440; }
      DH.toast("⛵ Welcome to Mini Isle! Gather treasures, then sail back.", 4200);
      alog("npc_trip", useTicket ? "ticket" : "coins");
      return true;
    },
    sailBack() {
      if (!gs || !S.trip.active) return false;
      const ps = gs.players || [];
      if (ps[0]) { ps[0].x = S.trip.backX; ps[0].y = S.trip.backY; }
      if (ps[1]) { ps[1].x = DOCK.x + 14; ps[1].y = DOCK.y + 2; }
      const got = S.trip.nodes.filter(n => n.got).length;
      S.trip.active = false; M.onTrip = false;
      S.trip.nodes = [];
      S.trip.fadeUntil = Date.now() + 1100;
      DH.toast(got ? `⛵ Back home — ${got} island treasure${got > 1 ? "s" : ""} gathered!` : "⛵ Back home! The isle will wait for you.", 3400);
      alog("npc_sailback", got);
      return true;
    },
    gather(nodeId) {
      if (!gs || !S.trip.active) return false;
      const n = S.trip.nodes.find(n2 => n2.id === nodeId);
      if (!n || n.got) return false;
      const id = NODE_ITEM[n.k];
      if (DH.inv.add(id, 1) <= 0) { DH.toast("Pockets are full! ☹️"); return false; }
      n.got = true;
      sparkles(n.x, n.y, 7);
      addHappy(1);
      const left = S.trip.nodes.filter(n2 => !n2.got).length;
      DH.toast(`${DH.items.label(id)}! ${left ? `${left} treasures left on the isle` : "the isle is gathered — sail back anytime ⛵"}`, 3000);
      alog("npc_gather", n.k);
      return true;
    },
    buySouvenir(id, cost) {
      const d = DH.items.get(id);
      if (!d || !gs || !S.trip.active) return false;
      if (gs.coins < cost) { DH.toast("Not enough coins 🪙"); return false; }
      if (DH.inv.add(id, 1) <= 0) { DH.toast("Pockets are full! ☹️"); return false; }
      gs.coins -= cost;
      say("gull", "k'kaw! good pick!", 2400);
      alog("npc_souvenir", id);
      DH.toast(`Skipper stamps your souvenir: ${d.ico} ${d.name}!`);
      return true;
    },
  };

  // ---------- new-day housekeeping ----------
  function newDay(ds) {
    // turtle quest times out when her day ends
    if (S.turtleQ.accepted && !S.turtleQ.rewarded && S.turtleQ.day !== dateSeed()) {
      S.turtleQ = { day: -1, spot: null, accepted: false, found: false, rewarded: false };
    }
    // one-shot rolls announce themselves once per real day
    if (S.dayKey !== dateSeed()) {
      S.dayKey = dateSeed();
      const v = roster();
      if (v.length) DH.toast(`🎪 Visitor${v.length > 1 ? "s" : ""} on the east path today — check the bulletin board!`, 4200);
    }
  }

  // ---------- module contract ----------
  const M = (DH.npcs = {
    authority: true,
    _S: S,
    onTrip: false,

    init(state) {
      gs = state;
      M.authority = !(DH.net && DH.net.online && DH.net.role === "guest");
      const W = DH.world;
      W.blocked.add(BULLETIN.tx + "," + BULLETIN.ty);
      W.blocked.add(CAFE.tx + "," + CAFE.ty);
      if (!W._npcsPatched) {
        W._npcsPatched = true;
        const s0 = W.isSolid.bind(W);
        W.isSolid = (tx, ty) => s0(tx, ty) || W.blocked.has(tx + "," + ty);
      }
    },

    start(state) {
      gs = state;
      M.authority = !(DH.net && DH.net.online && DH.net.role === "guest");
      fx.length = 0;
      for (const k in bub) delete bub[k];
      M.onTrip = !!(S.trip && S.trip.active);
    },

    offline(offMin) {
      if (offMin >= 1440 * 3) return []; // days pass but visitors come & go daily
      return [];
    },

    update(dt, state) {
      gs = state;
      if (!M.authority) return;
      const ds = dayStamp();
      if (ds !== S.lastDay) { S.lastDay = ds; newDay(ds); }
      S.saveT = (S.saveT || 0) + dt;
      if (S.saveT >= SAVE_EVERY) { S.saveT = 0; DH.save.now(); }
      // keep trippers on the sand (the gate tile is otherwise walkable)
      if (S.trip.active)
        for (const p of state.players || []) {
          p.x = clamp(p.x, ISLE.x0, ISLE.x1);
          p.y = clamp(p.y, ISLE.y0, ISLE.y1);
        }
    },

    interactables(p) {
      if (!gs || !gs.running) return [];
      const out = [];
      if (S.trip.active) { // Mini Isle surface
        for (const n of S.trip.nodes) {
          if (n.got) continue;
          const d = dist2(p.x, p.y, n.x, n.y);
          if (d < 34 * 34) out.push({ label: NODE_LABEL[n.k], x: n.x, y: n.y, d2: d, action: () => API.gather(n.id) });
        }
        const dG = dist2(p.x, p.y, GULL.x, GULL.y);
        if (dG < 40 * 40) out.push({ label: "Souvenir stand 🕊️", x: GULL.x, y: GULL.y, d2: dG, action: openSouvenir });
        const dS = dist2(p.x, p.y, SAIL.x, SAIL.y);
        if (dS < 46 * 46) out.push({ label: "Sail back ⛵", x: SAIL.x, y: SAIL.y, d2: dS, action: () => API.sailBack() });
        out.sort((a, b) => a.d2 - b.d2);
        return out;
      }
      // Terry + bulletin
      const dT = dist2(p.x, p.y, TERRY.x, TERRY.y);
      if (dT < INTERACT_R * INTERACT_R)
        out.push({ label: "Talk to Terry 🦝", x: TERRY.x, y: TERRY.y, d2: dT, action: openTerry });
      const bx = BULLETIN.tx * T + 16, by = BULLETIN.ty * T + 16;
      const dB = dist2(p.x, p.y, bx, by);
      if (dB < 40 * 40)
        out.push({ label: "Bulletin board 📋", x: bx, y: by, d2: dB, action: openBulletin });
      // café counter
      const dC = dist2(p.x, p.y, CAFE_PT.x, CAFE_PT.y);
      if (dC < 42 * 42)
        out.push({ label: "Café corner ☕", x: CAFE_PT.x, y: CAFE_PT.y, d2: dC, action: openCafe });
      // boat dock
      const dD = dist2(p.x, p.y, DOCK.x, DOCK.y + 14);
      if (dD < 46 * 46)
        out.push({ label: "Boat trip ⛵ (🪙200 / 🎫)", x: DOCK.x, y: DOCK.y, d2: dD, action: openDock });
      // visitors
      for (const kind of ["cat", "camel", "turtle"]) {
        if (!visHere(kind)) continue;
        const a = ANCHOR[kind];
        const d = dist2(p.x, p.y, a.x, a.y);
        if (d >= INTERACT_R * INTERACT_R) continue;
        const label = kind === "cat" ? "Katrina's fortune 🐱" : kind === "camel" ? "Sahara's goods 🐫" : "Talk to Shelby 🐢";
        const fn = kind === "cat" ? openCat : kind === "camel" ? openCamel : openTurtle;
        out.push({ label, x: a.x, y: a.y, d2: d, action: fn });
      }
      if (owlHere()) {
        const a = ANCHOR.owl;
        const d = dist2(p.x, p.y, a.x, a.y);
        if (d < INTERACT_R * INTERACT_R)
          out.push({ label: "Celeste the owl 🦉🌠", x: a.x, y: a.y, d2: d, action: openOwl });
      }
      // hidden baby turtle
      const q = S.turtleQ;
      if (q.accepted && !q.found && q.spot) {
        const cx = q.spot.tx * T + 16, cy = q.spot.ty * T + 16;
        const d = dist2(p.x, p.y, cx, cy);
        if (d < 36 * 36)
          out.push({ label: "Catch the baby turtle 🐢", x: cx, y: cy, d2: d - 1, action: () => API.catchBaby() });
      }
      out.sort((a, b) => a.d2 - b.d2);
      return out;
    },

    collectDraws(draws, camX, camY) {
      if (!ctx2) ctx2 = document.getElementById("cv").getContext("2d");
      draws.push({ y: BULLETIN.ty * T + T, fn: () => drawBulletin(ctx2, BULLETIN.tx * T - camX, BULLETIN.ty * T - camY) });
      draws.push({ y: CAFE.ty * T + T, fn: () => drawCafe(ctx2, CAFE.tx * T - camX, CAFE.ty * T - camY) });
      draws.push({ y: TERRY.y, fn: () => { DH.sprites.shadow(ctx2, TERRY.x - camX, TERRY.y - camY, 16); drawTerry(ctx2, TERRY.x - camX, TERRY.y - camY); } });
      // pond dock + boat
      draws.push({ y: DOCK.y + 6, fn: () => drawDock(ctx2, DOCK.x - camX, DOCK.y - camY) });
      draws.push({ y: BOAT.y + 10, fn: () => drawBoat(ctx2, BOAT.x - camX, BOAT.y - camY) });
      // visitors
      if (visHere("cat")) { const a = ANCHOR.cat; draws.push({ y: a.y, fn: () => { DH.sprites.shadow(ctx2, a.x - camX, a.y - camY, 15); drawFortuneCat(ctx2, a.x - camX, a.y - camY); } }); }
      if (visHere("camel")) { const a = ANCHOR.camel; draws.push({ y: a.y + 4, fn: () => { DH.sprites.shadow(ctx2, a.x - camX, a.y - camY, 26); drawCamel(ctx2, a.x - camX, a.y - camY); } }); }
      if (visHere("turtle")) { const a = ANCHOR.turtle; draws.push({ y: a.y, fn: () => { DH.sprites.shadow(ctx2, a.x - camX, a.y - camY, 14); drawTurtle(ctx2, a.x - camX, a.y - camY, false); } }); }
      if (owlHere()) { const a = ANCHOR.owl; draws.push({ y: a.y, fn: () => { DH.sprites.shadow(ctx2, a.x - camX, a.y - camY, 15); drawOwl(ctx2, a.x - camX, a.y - camY); } }); }
      // hidden baby
      const q = S.turtleQ;
      if (q.accepted && !q.found && q.spot) {
        const cx = q.spot.tx * T + 16, cy = q.spot.ty * T + 16;
        draws.push({ y: cy, fn: () => drawTurtle(ctx2, cx - camX, cy - camY, true) });
      }
    },

    drawOverlay(ctx, camX, camY, state) {
      ctx2 = ctx;
      // ---- fullscreen Mini Isle scene (M-4) ----
      if (S.trip.active) { drawIsle(ctx, camX, camY, state); return; }
      // trip fade veil (works on both ends)
      const fadeLeft = (S.trip.fadeUntil || 0) - Date.now();
      if (fadeLeft > 0) {
        ctx.fillStyle = `rgba(20,40,80,${Math.min(1, fadeLeft / 900)})`;
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      }
      // visitor markers so the day's guests are discoverable
      const tw = Math.sin(Date.now() / 350) * 2;
      ctx.font = "10px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      if (visHere("cat")) ctx.fillText("🔮", ANCHOR.cat.x - camX, ANCHOR.cat.y - 40 + tw - camY);
      if (visHere("camel")) ctx.fillText("🐫", ANCHOR.camel.x - camX, ANCHOR.camel.y - 46 + tw - camY);
      if (visHere("turtle")) ctx.fillText("❓", ANCHOR.turtle.x - camX, ANCHOR.turtle.y - 30 + tw - camY);
      if (owlHere()) ctx.fillText("🌠", ANCHOR.owl.x - camX, ANCHOR.owl.y - 38 + tw - camY);
      // speech bubbles
      drawBubbles(ctx, camX, camY, { terry: TERRY, camel: ANCHOR.camel, turtle: ANCHOR.turtle, gull: GULL });
      // ambient meteors on shower nights
      if (meteorNight() && isNight() && Math.random() < 0.006)
        meteor(rnd(60, ctx.canvas.width + 120), rnd(-10, ctx.canvas.height * 0.3));
      drawFx(ctx, camX, camY);
    },

    // ----- sync boundary -----
    serialize() {
      return JSON.parse(JSON.stringify({
        tipIdx: S.tipIdx, done: S.done, wishDay: S.wishDay, dayKey: S.dayKey,
        lastDay: S.lastDay, turtleQ: S.turtleQ, trip: S.trip, nextId: S.nextId,
      }));
    },
    deserialize(d) {
      if (!d || typeof d !== "object") return;
      if (typeof d.tipIdx === "number") S.tipIdx = d.tipIdx;
      if (d.done && typeof d.done === "object") S.done = d.done;
      if (typeof d.wishDay === "number") S.wishDay = d.wishDay;
      if (typeof d.dayKey === "number") S.dayKey = d.dayKey;
      if (typeof d.lastDay === "number") S.lastDay = d.lastDay;
      if (d.turtleQ && typeof d.turtleQ === "object")
        S.turtleQ = Object.assign({ day: -1, spot: null, accepted: false, found: false, rewarded: false }, d.turtleQ);
      if (d.trip && typeof d.trip === "object") {
        S.trip = Object.assign({ active: false, backX: 0, backY: 0, b2X: 0, b2Y: 0, fadeUntil: 0, nodes: [], seedN: 0 }, d.trip);
        M.onTrip = !!S.trip.active;
      }
      if (typeof d.nextId === "number") S.nextId = d.nextId;
    },
    remoteAction(name, args) {
      return typeof API[name] === "function" ? API[name].apply(null, args || []) : false;
    },

    // exposed API (menus + console/tests)
    tip: API.tip, whatsNew: API.whatsNew, fortune: API.fortune, wish: API.wish,
    buyMystery: API.buyMystery, acceptTurtle: API.acceptTurtle, catchBaby: API.catchBaby,
    returnBaby: API.returnBaby, orderCoffee: API.orderCoffee,
    startTrip: API.startTrip, sailBack: API.sailBack, gather: API.gather, buySouvenir: API.buySouvenir,
    openTerry, openBulletin, openCafe, openDock, openSouvenir, openCat, openOwl, openCamel, openTurtle,
    roster, meteorNight, visHere, owlHere, todaySpecial, camelStock,
  });

  // ---------- drawing ----------
  const R = (ctx, x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };

  function drawBubbles(ctx, camX, camY, spots) {
    const now = Date.now();
    for (const k in bub) {
      const b = bub[k];
      if (!b || b.until < now || !b.txt || !spots[k]) continue;
      const s = spots[k];
      const x = s.x - camX, y = s.y - 44 - camY;
      ctx.font = "bold 8px sans-serif";
      const w = Math.max(20, ctx.measureText(b.txt).width + 8);
      ctx.fillStyle = "#ffffffee";
      ctx.fillRect(x - w / 2, y - 13, w, 13);
      ctx.fillRect(x - w / 2 + 2, y - 15, w - 4, 2);
      ctx.fillRect(x - 2, y, 4, 4);
      ctx.fillStyle = "#4a3a2a"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(b.txt, x, y - 6);
    }
  }
  function drawFx(ctx, camX, camY) {
    const now = Date.now();
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i], age = (now - f.born) / 1000;
      if (age >= f.ttl) { fx.splice(i, 1); continue; }
      const a = 1 - age / f.ttl;
      const x = f.x + f.vx * age - camX, y = f.y + f.vy * age - camY;
      ctx.save(); ctx.globalAlpha = Math.max(0, a);
      if (f.k === "heart") DH.sprites.heart(ctx, x, y, 5);
      else if (f.k === "cup") {
        R(ctx, x - 4, y - 5, 8, 6, "#f4f0e8"); R(ctx, x + 4, y - 4, 3, 4, "#f4f0e8");
        R(ctx, x - 3, y - 4, 6, 2, "#7a5232"); // coffee
        ctx.globalAlpha = a * 0.8;
        ctx.strokeStyle = "#ffffffcc"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x - 1, y - 7); ctx.quadraticCurveTo(x - 3, y - 10, x - 1, y - 13); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x + 2, y - 7); ctx.quadraticCurveTo(x + 4, y - 10, x + 2, y - 13); ctx.stroke();
      } else if (f.k === "meteor") {
        ctx.strokeStyle = "#fff8d8"; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - f.vx * 0.16, y - f.vy * 0.16); ctx.stroke();
        R(ctx, x - 1, y - 1, 2.4, 2.4, "#ffffff");
      } else { // spark
        R(ctx, x - 1.5, y - 1.5, 3, 3, f.c || "#ffe98a");
      }
      ctx.restore();
    }
  }

  // ----- Terry the tanuki in his little suit -----
  function drawTerry(ctx, x, y) {
    const bob = Math.sin(Date.now() / 700) * 1;
    ctx.save(); ctx.translate(x, y + bob);
    // legs
    R(ctx, -5, -6, 4, 6, "#2a3040"); R(ctx, 1, -6, 4, 6, "#2a3040");
    // suit jacket body
    R(ctx, -8, -18, 16, 12, "#2e3a5c");
    R(ctx, -8, -18, 16, 2, "#3d4a70");
    R(ctx, -10, -17, 3, 8, "#2e3a5c"); R(ctx, 7, -17, 3, 8, "#2e3a5c"); // arms
    R(ctx, -3, -18, 6, 10, "#f4f0e8");                                // shirt V
    R(ctx, -1, -16, 2, 6, "#c0392b");                                 // tie
    // head: tanuki tan + dark eye mask + leaf-green ears
    R(ctx, -8, -30, 16, 13, "#b08050");
    R(ctx, -7, -32, 5, 5, "#b08050"); R(ctx, 2, -32, 5, 5, "#b08050"); // ears
    R(ctx, -6, -31, 3, 3, "#57a05b"); R(ctx, 3, -31, 3, 3, "#57a05b"); // leaf inners
    R(ctx, -7, -26, 14, 4, "#4a3524");                                // raccoon mask
    R(ctx, -4, -25, 2, 2, "#1a1a1a"); R(ctx, 2, -25, 2, 2, "#1a1a1a"); // eyes
    R(ctx, -4, -25, 1, 1, "#ffffff88"); R(ctx, 2, -25, 1, 1, "#ffffff88");
    R(ctx, -3, -22, 6, 3, "#d8b088");                                  // muzzle
    R(ctx, -1, -21, 2, 1.5, "#3a2416");                                // nose
    ctx.restore();
  }

  // ----- Katrina: white fortune cat, purple shawl, crystal ball on a stool -----
  function drawFortuneCat(ctx, x, y) {
    const bob = Math.sin(Date.now() / 800 + 1) * 1;
    ctx.save(); ctx.translate(x, y + bob);
    // stool + crystal ball
    R(ctx, 8, -10, 12, 10, "#6e4a2a"); R(ctx, 7, -12, 14, 3, "#8a5f30");
    ctx.fillStyle = "#b8e8ffcc"; ctx.beginPath(); ctx.arc(14, -15, 5, 0, 7); ctx.fill();
    R(ctx, 12, -18, 2, 1.5, "#ffffff");
    // tail
    R(ctx, -11, -9, 3, 7, "#f0ece4");
    // body (purple robe)
    R(ctx, -8, -17, 15, 11, "#5a3a78");
    R(ctx, -8, -17, 15, 2, "#6e4a90");
    // ears + head (white cat)
    R(ctx, -7, -32, 4, 5, "#f0ece4"); R(ctx, 3, -32, 4, 5, "#f0ece4");
    R(ctx, -6, -31, 2, 2, "#e8a0a8"); R(ctx, 4, -31, 2, 2, "#e8a0a8");
    R(ctx, -8, -29, 15, 12, "#f0ece4");
    R(ctx, -8, -29, 15, 3, "#7a4a98");                                // kerchief band
    R(ctx, -4, -25, 2, 2.5, "#2a1a3a"); R(ctx, 2, -25, 2, 2.5, "#2a1a3a");
    R(ctx, -4, -25, 1, 1, "#ffffff88"); R(ctx, 2, -25, 1, 1, "#ffffff88");
    R(ctx, -1, -22, 2, 1.5, "#e09090");                                // nose
    R(ctx, -3, -19, 6, 2, "#f0b8c8");                                  // blush
    ctx.restore();
  }

  // ----- Celeste: round brown owl with big eyes -----
  function drawOwl(ctx, x, y) {
    const bob = Math.sin(Date.now() / 900 + 2) * 1;
    ctx.save(); ctx.translate(x, y + bob);
    R(ctx, -4, -5, 3, 5, "#c08030"); R(ctx, 1, -5, 3, 5, "#c08030");   // feet
    R(ctx, -9, -20, 18, 15, "#7a5a38");                               // round body
    R(ctx, -7, -16, 14, 8, "#a8845a");                                // belly
    R(ctx, -11, -19, 4, 10, "#6a4a2c"); R(ctx, 7, -19, 4, 10, "#6a4a2c"); // wings
    R(ctx, -8, -31, 16, 12, "#7a5a38");                               // head
    R(ctx, -8, -34, 3, 4, "#6a4a2c"); R(ctx, 5, -34, 3, 4, "#6a4a2c"); // ear tufts
    // big round eyes
    ctx.fillStyle = "#f4e8c8"; ctx.beginPath(); ctx.arc(-3.5, -25, 4, 0, 7); ctx.arc(3.5, -25, 4, 0, 7); ctx.fill();
    R(ctx, -4.5, -26, 2.4, 2.4, "#1a1a1a"); R(ctx, 2.2, -26, 2.4, 2.4, "#1a1a1a");
    R(ctx, -4, -26, 1, 1, "#ffffffaa"); R(ctx, 2.6, -26, 1, 1, "#ffffffaa");
    R(ctx, -1.5, -23, 3, 2, "#e0a030");                                // beak
    ctx.restore();
  }

  // ----- Sahara the camel (wider body, hump, rug & tassels) -----
  function drawCamel(ctx, x, y) {
    const bob = Math.sin(Date.now() / 750 + 3) * 1;
    ctx.save(); ctx.translate(x, y + bob);
    // wares rug under feet
    R(ctx, -22, -2, 44, 7, "#a04a68"); R(ctx, -22, -2, 44, 2, "#c06a88"); R(ctx, -22, 4, 44, 1.5, "#7a3a52");
    ctx.font = "8px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("🌌", -14, 1); ctx.fillText("🧿", 0, 1); ctx.fillText("🏮", 14, 1);
    // legs
    R(ctx, -12, -8, 4, 8, "#c89a60"); R(ctx, -6, -8, 4, 8, "#c89a60");
    R(ctx, 4, -8, 4, 8, "#c89a60"); R(ctx, 10, -8, 4, 8, "#c89a60");
    // long body + hump
    R(ctx, -16, -20, 32, 13, "#d8aa6a");
    R(ctx, -8, -26, 12, 8, "#d8aa6a");                                // hump
    R(ctx, -7, -25, 10, 3, "#c08a50");
    // neck + head
    R(ctx, 12, -30, 6, 16, "#d8aa6a");
    R(ctx, 11, -36, 14, 8, "#d8aa6a");
    R(ctx, 22, -33, 4, 3, "#c08a50");                                  // muzzle
    R(ctx, 13, -38, 3, 3, "#c89a60"); R(ctx, 20, -38, 3, 3, "#c89a60"); // ears
    R(ctx, 14, -34, 2, 2, "#1a1a1a");                                  // eye
    R(ctx, 11, -36, 14, 2, "#b05a7a");                                 // bridle band
    ctx.restore();
  }

  // ----- Shelby / baby turtle -----
  function drawTurtle(ctx, x, y, baby) {
    const s = baby ? 0.55 : 1;
    const wob = Math.sin(Date.now() / (baby ? 220 : 650)) * (baby ? 1.6 : 0.8);
    ctx.save(); ctx.translate(x, y + wob); ctx.scale(s, s);
    // flippers
    R(ctx, -11, -5, 5, 4, "#5a9a4a"); R(ctx, 6, -5, 5, 4, "#5a9a4a");
    // shell dome
    ctx.fillStyle = "#3f8f4a";
    ctx.beginPath(); ctx.ellipse(0, -8, 11, 8, 0, Math.PI, 0); ctx.fill();
    R(ctx, -11, -9, 22, 4, "#3f8f4a");
    ctx.fillStyle = "#5ab86a";
    ctx.beginPath(); ctx.ellipse(0, -9, 7, 5, 0, Math.PI, 0); ctx.fill();
    R(ctx, -2, -13, 4, 3, "#8fd89a");                                  // shell shine
    // head poking up
    R(ctx, -4, -22, 8, 8, "#6ab85a");
    R(ctx, -4, -23, 8, 2, "#8fd89a");
    R(ctx, -2.5, -19, 1.6, 1.6, "#1a1a1a"); R(ctx, 1, -19, 1.6, 1.6, "#1a1a1a");
    if (!baby) R(ctx, -1, -15, 2, 1, "#3f7a3a");                       // worried mouth
    ctx.restore();
  }

  // ----- Skipper the souvenir gull (worn on Mini Isle) -----
  function drawGull(ctx, x, y) {
    const bob = Math.sin(Date.now() / 620) * 1.2;
    ctx.save(); ctx.translate(x, y + bob);
    R(ctx, -4, -4, 3, 4, "#e0a030"); R(ctx, 1, -4, 3, 4, "#e0a030");   // feet
    R(ctx, -8, -16, 16, 11, "#f4f6f8");                               // body
    R(ctx, -9, -14, 4, 7, "#c8d0d8"); R(ctx, 6, -14, 4, 7, "#c8d0d8"); // wings
    R(ctx, -6, -25, 12, 10, "#f4f6f8");                               // head
    R(ctx, -6, -27, 12, 3, "#3a6fd8");                                // sailor cap band
    R(ctx, -4, -28, 8, 2, "#3a6fd8");
    R(ctx, -3, -22, 1.8, 1.8, "#1a1a1a"); R(ctx, 1.5, -22, 1.8, 1.8, "#1a1a1a");
    R(ctx, -1, -19, 3, 2, "#f0a030");                                  // beak
    ctx.restore();
  }

  // ----- fixtures -----
  function drawBulletin(ctx, x, y) {
    R(ctx, x + 4, y + 8, 5, 24, "#6e4a2a"); R(ctx, x + 23, y + 8, 5, 24, "#6e4a2a");
    R(ctx, x + 1, y - 6, 30, 18, "#8a5f30");
    R(ctx, x + 3, y - 4, 26, 14, "#c8a060");                            // cork board
    R(ctx, x + 5, y - 2, 5, 6, "#f4f0e8"); R(ctx, x + 12, y - 1, 5, 7, "#ffd9d0");
    R(ctx, x + 19, y - 2, 5, 6, "#d0e8ff"); R(ctx, x + 25, y, 3, 5, "#fff8c9");
    R(ctx, x + 6, y - 3, 2, 2, "#e04848"); R(ctx, x + 13, y - 2, 2, 2, "#3a6fd8"); // pins
    R(ctx, x + 1, y - 8, 30, 3, "#6e4a2a");                             // roof lip
  }
  function drawCafe(ctx, x, y) {
    // two stools in front
    R(ctx, x + 2, y + 22, 9, 3, "#8a5f30"); R(ctx, x + 4, y + 25, 5, 7, "#6e4a2a");
    R(ctx, x + 20, y + 22, 9, 3, "#8a5f30"); R(ctx, x + 22, y + 25, 5, 7, "#6e4a2a");
    // posts + striped awning
    R(ctx, x + 2, y - 18, 3, 42, "#7a5328"); R(ctx, x + 27, y - 18, 3, 42, "#7a5328");
    R(ctx, x - 2, y - 24, 36, 9, "#b05a3a");
    for (let i = 0; i < 4; i++) R(ctx, x + 3 + i * 8, y - 24, 4, 9, "#f4e8d0");
    for (let i = 0; i < 4; i++) { // scalloped edge
      ctx.fillStyle = i % 2 ? "#f4e8d0" : "#b05a3a";
      ctx.beginPath(); ctx.arc(x + 3.5 + i * 8.5, y - 15, 4.4, 0, Math.PI); ctx.fill();
    }
    // counter
    R(ctx, x, y + 8, 32, 5, "#c8975c");
    R(ctx, x + 1, y + 13, 30, 15, "#a0733f");
    R(ctx, x + 1, y + 13, 30, 2, "#c09055");
    R(ctx, x + 4, y + 15, 2, 12, "#7a5527"); R(ctx, x + 14, y + 15, 2, 12, "#7a5527"); R(ctx, x + 24, y + 15, 2, 12, "#7a5527");
    // espresso machine + cups on the counter
    R(ctx, x + 4, y + 1, 9, 8, "#8a9098"); R(ctx, x + 5, y + 3, 7, 3, "#3a4048");
    R(ctx, x + 8, y + 8, 2, 2, "#c8d0d8");
    R(ctx, x + 17, y + 4, 5, 4, "#f4f0e8"); R(ctx, x + 22, y + 5, 2, 2, "#f4f0e8");
    R(ctx, x + 24, y + 4, 5, 4, "#f4f0e8");
    // steam from the machine
    ctx.strokeStyle = "#ffffff88"; ctx.lineWidth = 1;
    const o = Math.sin(Date.now() / 400) * 1.5;
    ctx.beginPath(); ctx.moveTo(x + 8 + o * 0.3, y - 2); ctx.quadraticCurveTo(x + 6 + o, y - 6, x + 8 + o * 0.5, y - 10); ctx.stroke();
    // hanging menu board
    R(ctx, x + 30, y - 12, 10, 9, "#3a3026");
    R(ctx, x + 32, y - 10, 6, 1.2, "#ffd76b"); R(ctx, x + 32, y - 7, 6, 1.2, "#f4f0e8"); R(ctx, x + 32, y - 4, 4, 1.2, "#f4f0e8");
  }
  function drawDock(ctx, x, y) {
    // plank pier: shore tile bottom edge → over the water
    R(ctx, x - 10, y + 8, 20, 34, "#a07840");
    R(ctx, x - 10, y + 8, 20, 2, "#c09858");
    for (let i = 0; i < 4; i++) R(ctx, x - 10, y + 14 + i * 7, 20, 1, "#7a5527");
    R(ctx, x - 11, y + 6, 4, 10, "#6e4a2a"); R(ctx, x + 7, y + 6, 4, 10, "#6e4a2a"); // posts
    R(ctx, x - 11, y + 4, 4, 3, "#96693a"); R(ctx, x + 7, y + 4, 4, 3, "#96693a");
    // small sign
    R(ctx, x + 12, y + 2, 3, 14, "#6e4a2a");
    R(ctx, x + 8, y - 4, 12, 8, "#f4e8d0");
    ctx.fillStyle = "#3a2412"; ctx.font = "bold 5px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("TRIPS", x + 14, y);
  }
  function drawBoat(ctx, x, y) {
    const bob = Math.sin(Date.now() / 640) * 1.6, tilt = Math.sin(Date.now() / 900) * 0.03;
    ctx.save(); ctx.translate(x, y + bob); ctx.rotate(tilt);
    // hull
    R(ctx, -13, -4, 26, 7, "#8a5f30");
    R(ctx, -13, -4, 26, 2, "#a67a45");
    R(ctx, -15, -6, 4, 5, "#8a5f30"); R(ctx, 11, -6, 4, 5, "#8a5f30"); // bow/stern tips
    R(ctx, -13, 3, 26, 2, "#6e4a2a");
    // mast + little sail
    R(ctx, -1, -22, 2, 18, "#5a4020");
    ctx.fillStyle = "#f4f0e8";
    ctx.beginPath(); ctx.moveTo(1, -21); ctx.lineTo(11, -8); ctx.lineTo(1, -8); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#e05b5b";
    ctx.beginPath(); ctx.moveTo(1, -21); ctx.lineTo(6, -15); ctx.lineTo(1, -15); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // ---------- Mini Isle fullscreen scene ----------
  function drawIsle(ctx, camX, camY, state) {
    const now = Date.now();
    const cw = ctx.canvas.width, ch = ctx.canvas.height;
    const W = (wx, wy) => [wx - camX, wy - camY];
    // sea
    ctx.fillStyle = "#2f6fb8"; ctx.fillRect(0, 0, cw, ch);
    ctx.fillStyle = "#3d88c2";
    for (let i = 0; i < 40; i++) {
      const wx = ((i * 137 + now * 0.02) % (cw + 60)) - 30, wy = (i * 89) % ch;
      ctx.globalAlpha = 0.25; ctx.fillRect(wx, wy, 14, 2);
    }
    ctx.globalAlpha = 1;
    // sand island blob (world-anchored ellipse over the pasture box)
    const [icx, icy] = W(ISLE.cx, ISLE.cy);
    ctx.fillStyle = "#e8d9a0";
    ctx.beginPath(); ctx.ellipse(icx, icy, 175, 155, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#f0e2b0";
    ctx.beginPath(); ctx.ellipse(icx, icy, 158, 138, 0, 0, Math.PI * 2); ctx.fill();
    // shoreline wave ring
    const ph = (now % 1800) / 1800;
    ctx.strokeStyle = `rgba(255,255,255,${0.5 * (1 - ph)})`;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(icx, icy, 175 + ph * 18, 155 + ph * 16, 0, 0, Math.PI * 2); ctx.stroke();
    // palms
    for (const [px, py] of PALMS) { const [sx, sy] = W(px, py); drawPalm(ctx, sx, sy); }
    // resource nodes
    for (const n of S.trip.nodes) {
      if (n.got) continue;
      const [nx, ny] = W(n.x, n.y);
      ctx.font = "13px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      const bb = Math.sin(now / 300 + n.x) * 2;
      ctx.fillText(n.k === "coco" ? "🥥" : n.k === "bloom" ? "🌺" : "🪲", nx, ny - 6 + bb);
      ctx.fillStyle = "#00000022"; ctx.fillRect(nx - 5, ny + 3, 10, 2);
    }
    // souvenir gull + his little stand
    {
      const [gx, gy] = W(GULL.x, GULL.y);
      R(ctx, gx - 14, gy - 2, 10, 12, "#8a5f30"); R(ctx, gx - 15, gy - 4, 12, 3, "#c8975c");
      ctx.font = "7px sans-serif"; ctx.textAlign = "center"; ctx.fillText("🎫", gx - 9, gy - 7);
      drawGull(ctx, gx + 8, gy);
    }
    // sail-back boat at the top of the isle
    {
      const [sx, sy] = W(SAIL.x, SAIL.y - 16);
      drawBoat(ctx, sx, sy);
      ctx.font = "bold 9px sans-serif"; ctx.textAlign = "center";
      ctx.fillStyle = "#ffffffcc"; ctx.fillText("⛵ sail back", sx, sy - 30);
    }
    // players on the isle (repainted — the scene covers the world draw)
    for (const p of state.players || []) {
      const sx = p.x - camX, sy = p.y - camY;
      DH.sprites.shadow(ctx, sx, sy);
      DH.sprites.drawPlayer(ctx, { ...p, x: sx, y: sy });
    }
    // HUD ribbon
    const got = S.trip.nodes.filter(n => n.got).length;
    ctx.fillStyle = "#1a1a2ecc"; ctx.fillRect(6, 6, 236, 20);
    ctx.font = "bold 10px sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffe9b0";
    ctx.fillText(`🏝️ Mini Isle  ·  treasures ${got}/${S.trip.nodes.length}  ·  walk to the ⛵ to sail home`, 12, 16);
    // sail fade
    const fadeLeft = (S.trip.fadeUntil || 0) - now;
    if (fadeLeft > 0) {
      ctx.fillStyle = `rgba(20,40,80,${Math.min(1, fadeLeft / 900)})`;
      ctx.fillRect(0, 0, cw, ch);
    }
    drawFx(ctx, camX, camY);
  }
  function drawPalm(ctx, x, y) {
    const sway = Math.sin(Date.now() / 1100 + x) * 2;
    // trunk
    ctx.save(); ctx.translate(x, y); ctx.rotate(sway * 0.01);
    R(ctx, -2, -26, 4, 26, "#9a7040");
    R(ctx, -2, -26, 2, 26, "#b08a52");
    // fronds
    ctx.fillStyle = "#3f9e4d";
    for (let i = 0; i < 5; i++) {
      const a = -0.4 - i * 0.55;
      ctx.save(); ctx.translate(sway * 0.4, -27); ctx.rotate(a);
      ctx.beginPath(); ctx.ellipse(9, 0, 10, 3.4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    // coconuts tucked in the crown
    R(ctx, sway * 0.4 - 3, -27, 3, 3, "#7a5232"); R(ctx, sway * 0.4 + 1, -25, 3, 3, "#7a5232");
    ctx.restore();
  }
})();

DH.register("npcs", DH.npcs);
