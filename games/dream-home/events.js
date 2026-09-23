/* dream-home events module — real-calendar seasonal events (spec L-1..L-5).
   Contract with game.js (same as econ.js/animals.js):
     DH.events.init(state) / start(state) / update(dt,state)
     DH.events.collectDraws(draws,camX,camY)   – decor, arch, stands, spawns (y-sorted)
     DH.events.drawOverlay(ctx,camX,camY,state) – fireworks/confetti/precip/banner chips
     DH.events.interactables(p) -> [{label,x,y,action}]
     DH.events.serialize()/deserialize(d)      – plain-JSON save + net state
     DH.events.remoteAction(name,args)         – guest-callable API

   EVERYTHING keys off the REAL date (new Date()), not game time:
   L-1 Seasonal events: Setsubun 2/3 · Valentine 2/14 · Hinamatsuri 3/3 ·
     Sakura week 4/1-10 · Egg Hunt (Easter wknd) · Tanabata 7/7 · Fireworks
     (Aug weekends) · Halloween 10/31 · Harvest 11/23 · Toy Day 12/24-25 ·
     New Year 12/31-1/3. An active event draws themed decor near the door,
     scatters a limited item in the yard, and offers one themed action on the
     calendar sign. DH.events.current() exposes the active event for econ.
   L-2 Tournaments: Fishing Tourney every 3rd Saturday; Bug Tourney 3rd
     Sunday Jun–Sep. 3-minute timer, deterministic critter shadows, tiered
     bronze/silver/gold trophies.
   L-3 Countdowns: Dec 31 → live midnight fireworks + banner; configurable
     player birthdays via S.birthdays (setters exposed) → confetti + cake +
     letter.
   L-4 First-days: meteorological season starts (3/1,6/1,9/1,12/1) → toast +
     seasonal item; first rain/snow of the season (per-day seeded weather).
   L-5 Anniversaries: S.anniversary (defaults to save-creation day) — every
     100 days & yearly: fireworks, paired hearts, photo-op arch by the door,
     memory-album entry via DH.museum when present.

   Soft deps only: works without tools/critters/museum/econ — guests render
   snapshots and never run update() (host-authoritative like animals.js).
*/
(function () {
  const DH = (window.DH = window.DH || {});
  const T = 32;

  // ---------- item catalog (items.js loads before this file) ----------
  const E = DH.items.def;
  E("lucky-beans", { name: "Lucky beans", ico: "🫘", cat: "material", price: 30 });
  E("choco-heart", { name: "Choco heart", ico: "🍫", cat: "food", price: 60 });
  E("hina-doll", { name: "Hina doll", ico: "🎎", cat: "misc", price: 120 });
  E("sakura-petal", { name: "Sakura petal", ico: "🌸", cat: "material", price: 15 });
  E("easter-egg", { name: "Painted egg", ico: "🐣", cat: "misc", price: 80 });
  E("wish-strip", { name: "Wish strip", ico: "🎋", cat: "material", price: 40 });
  E("sparkler", { name: "Sparkler", ico: "🎇", cat: "misc", price: 50 });
  E("candy", { name: "Candy", ico: "🍬", cat: "food", price: 25 });
  E("harvest-veg", { name: "Harvest veg", ico: "🌽", cat: "food", price: 70 });
  E("toy-present", { name: "Toy present", ico: "🎁", cat: "misc", price: 150 });
  E("shrine-charm", { name: "Shrine charm", ico: "⛩️", cat: "misc", price: 100 });
  E("snowflake", { name: "Snowflake", ico: "❄️", cat: "material", price: 35 });
  E("bamboo-grass", { name: "Bamboo grass", ico: "🌱", cat: "material", price: 45 });
  E("sunflower", { name: "Sunflower", ico: "🌻", cat: "flower", price: 60 });
  E("acorn", { name: "Acorn", ico: "🌰", cat: "material", price: 30 });
  E("trophy-bronze", { name: "Bronze trophy", ico: "🥉", cat: "furniture", price: 300 });
  E("trophy-silver", { name: "Silver trophy", ico: "🥈", cat: "furniture", price: 600 });
  E("trophy-gold", { name: "Gold trophy", ico: "🥇", cat: "furniture", price: 1200 });
  E("birthday-cake", { name: "Birthday cake", ico: "🎂", cat: "food", price: 200 });
  E("letter", { name: "Letter", ico: "💌", cat: "misc", price: 0 });

  // ---------- event table (L-1) ----------
  const EVENTS = [
    { id: "setsubun", name: "Setsubun", ico: "👹", m: 2, d: 3, span: 1, dates: "Feb 3",
      deco: "bunting", item: "lucky-beans", act: "Throw beans 👹",
      msg: "Drive out the demons — throw lucky beans!" },
    { id: "valentine", name: "Valentine's Day", ico: "💝", m: 2, d: 14, span: 1, dates: "Feb 14",
      deco: "hearts", item: "choco-heart", act: "Share chocolate 💝",
      msg: "Love is in the air — share chocolate with your sweetheart!" },
    { id: "hinamatsuri", name: "Hinamatsuri", ico: "🎎", m: 3, d: 3, span: 1, dates: "Mar 3",
      deco: "dolls", item: "hina-doll", act: "Admire the dolls 🎎",
      msg: "Doll festival — admire the hina dolls!" },
    { id: "egghunt", name: "Spring Egg Hunt", ico: "🐣", dates: "Easter weekend",
      deco: "eggs", item: "easter-egg", act: "Hunt eggs 🐣",
      msg: "Painted eggs are hidden in the yard — find them all!" },
    { id: "sakura", name: "Sakura week", ico: "🌸", m: 4, d: 1, span: 10, dates: "Apr 1–10",
      deco: "sakura", item: "sakura-petal", act: "Hanami picnic 🌸",
      msg: "Cherry blossoms are falling — picnic under the petals!" },
    { id: "tanabata", name: "Tanabata", ico: "🎋", m: 7, d: 7, span: 1, dates: "Jul 7",
      deco: "bamboo", item: "wish-strip", act: "Write a wish 🎋",
      msg: "Hang a wish strip on the bamboo for the stars!" },
    { id: "fireworks", name: "Fireworks Night", ico: "🎆", augWeekend: true, dates: "Aug weekends",
      deco: "bunting", item: "sparkler", act: "Light a sparkler 🎇",
      msg: "Fireworks over the pond tonight!" },
    { id: "halloween", name: "Halloween", ico: "🎃", m: 10, d: 31, span: 1, dates: "Oct 31",
      deco: "pumpkins", item: "candy", act: "Trick or treat 🎃",
      msg: "Spooky night — trick or treat for candy!" },
    { id: "harvest", name: "Harvest Festival", ico: "🌽", m: 11, d: 23, span: 1, dates: "Nov 23",
      deco: "harvest", item: "harvest-veg", act: "Share the harvest 🌽",
      msg: "Give thanks for the year's bounty!" },
    { id: "christmas", name: "Toy Day", ico: "🎄", m: 12, d: 24, span: 2, dates: "Dec 24–25",
      deco: "tree", item: "snowflake", act: "Open a present 🎁",
      msg: "Toy Day! Snowflakes drift down and a present waits by the tree." },
    { id: "newyear", name: "New Year", ico: "⛩️", dates: "Dec 31–Jan 3",
      deco: "kadomatsu", item: "shrine-charm", act: "Shrine visit ⛩️",
      msg: "Happy New Year! Time for the first shrine visit." },
  ];

  // ---------- spots ----------
  const DECO = { x: 12 * T + 16, y: 11 * T + 14 };        // calendar sign + event decor (yard)
  const ARCH = { x1: 9 * T - 2, x2: 10 * T + 34, y: 10 * T + 30 }; // photo arch over door path
  const FISH_STAND = { x: 25 * T + 16, y: 12 * T + 14, r: 52 };    // between dock & pedia sign
  const BUG_STAND = { x: 20 * T + 16, y: 10 * T + 16, r: 52 };     // yard in front of garden
  const POND_IN = { x1: 22.4 * T, y1: 13.4 * T, x2: 27.6 * T, y2: 17.6 * T };
  const YARD = { x1: 10 * T, y1: 10.6 * T, x2: 21 * T, y2: 18 * T };
  const HOUSE_FX = { x: 9 * T + 16, y: 10 * T + 8 };      // confetti/fireworks anchor by the door

  // ---------- tuning ----------
  const SPAWN_TGT = 4;          // limited items lying in the yard during an event
  const SPAWN_EVERY = 14;       // seconds between top-ups
  const PICKUP_R = 30;
  const ACT_CD = 20;            // seconds between themed-action uses
  const TOURNEY_LEN = 180;      // 3-minute timer (L-2)
  const TCRIT_TGT = 3;          // live tourney shadows
  const PRIZE = [{ n: 8, id: "trophy-gold" }, { n: 5, id: "trophy-silver" }, { n: 3, id: "trophy-bronze" }];
  const SEASON_FIRST = {
    spring: { m: 3, d: 1, item: "bamboo-grass", ico: "🌸" },
    summer: { m: 6, d: 1, item: "sunflower", ico: "🌻" },
    autumn: { m: 9, d: 1, item: "acorn", ico: "🌰" },
    winter: { m: 12, d: 1, item: "snowflake", ico: "❄️" },
  };
  const BDAY_GIFTS = ["birthday-cake", "letter"];
  const PRESENT_POOL = ["toy-present", "choco-heart", "sparkler", "candy"];

  // ---------- module state (plain JSON — the save/net payload) ----------
  let gs = null;
  const S = {
    createdAt: 0,                    // ms epoch; anniversary default source (L-5)
    anniversary: "",                 // "MM-DD" — settable
    birthdays: { koto: "12-12", zuza: "03-03" }, // L-3 settable
    lastDay: "",                     // last real day processed
    seen: {},                        // "arr:<ev>:<yr>" arrival-toast flags
    firstSeen: {},                   // "<season>-<yr>" first-day flags (L-4)
    precipSeen: {},                  // "rain|snow-<season>-<yr>" first-precip flags (L-4)
    bdayDone: {},                    // "<char>:<yr>" birthday-celebrated flags (L-3)
    nyYear: 0,                       // last celebrated Jan 1 year (L-3)
    annivDone: "",                   // day key of last anniversary celebration (L-5)
    spawns: [],                      // limited ground items [{id,item,x,y}]
    tcrit: [],                       // tourney critters [{id,x0,y0,rx,ry,spd,ph,pts,until}]
    tourney: null,                   // {type,t,score}
    tourneyBest: { fish: 0, bug: 0 },
    fx: [],                          // celebration particles (serialized → guests see them)
    spawnT: 0, actT: 0, tcritT: 0,
    eggDay: "", eggN: 0,             // egg-hunt daily find counter
    nextId: 1,
  };
  let ctx2 = null, saveT = 0;

  // ---------- helpers ----------
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const addHappy = n => { if (gs) gs.happiness = Math.max(0, gs.happiness + n); };
  const pad = n => String(n).padStart(2, "0");
  const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const mmdd = d => `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseMD = s => {
    const m = /^(\d{1,2})-(\d{1,2})$/.exec(s || "");
    if (!m) return null;
    const mo = +m[1], d = +m[2];
    return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? { m: mo, d } : null;
  };
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function album(icon, label) { // J-6 hook (L-5): memory-album entry when museum is around
    if (DH.museum && DH.museum.album) DH.museum.album.push({ icon, label, day: Math.floor((gs && gs.day) || 0) });
  }

  // ---------- real-calendar math ----------
  function easter(y) { // Anonymous Gregorian algorithm → {m,d} of Easter Sunday
    const a = y % 19, b = Math.floor(y / 100), c = y % 100;
    const d4 = Math.floor(b / 4), e2 = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d4 - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e2 + 2 * i - h - k) % 7, mm = Math.floor((a + 11 * h + 22 * l) / 451);
    return { m: Math.floor((h + l - 7 * mm + 114) / 31), d: ((h + l - 7 * mm + 114) % 31) + 1 };
  }
  function metSeason(d) { // meteorological seasons (L-4)
    const m = d.getMonth() + 1;
    return m >= 3 && m <= 5 ? "spring" : m >= 6 && m <= 8 ? "summer" : m >= 9 && m <= 11 ? "autumn" : "winter";
  }
  function weatherFor(d) { // deterministic per-real-day weather (L-4, self-contained)
    const r = mulberry32(d.getFullYear() * 372 + (d.getMonth() + 1) * 31 + d.getDate())();
    if (metSeason(d) === "winter") return r < 0.38 ? "snow" : "clear";
    return r < 0.30 ? "rain" : "clear";
  }
  const isPrecip = w => w === "rain" || w === "snow";
  function eventFor(d) { // active seasonal event on real date d (L-1)
    const m = d.getMonth() + 1, day = d.getDate(), y = d.getFullYear();
    for (const e of EVENTS) {
      if (e.augWeekend) { if (m === 8 && (d.getDay() === 0 || d.getDay() === 6)) return e; continue; }
      if (e.id === "egghunt") {
        const es = easter(y);
        const diff = (new Date(y, m - 1, day) - new Date(y, es.m - 1, es.d)) / 86400000;
        if (diff >= -1 && diff <= 1) return e; // Easter weekend: Sat → Mon
        continue;
      }
      if (e.id === "newyear") { if ((m === 12 && day === 31) || (m === 1 && day <= 3)) return e; continue; }
      const diff = (new Date(y, m - 1, day) - new Date(y, e.m - 1, e.d)) / 86400000;
      if (diff >= 0 && diff < e.span) return e;
    }
    return null;
  }
  function tourneyToday(d) { // "fish" 3rd Sat monthly · "bug" 3rd Sun Jun–Sep (L-2)
    const day = d.getDate(), dow = d.getDay(), m = d.getMonth() + 1;
    if (day >= 15 && day <= 21) {
      if (dow === 6) return "fish";
      if (dow === 0 && m >= 6 && m <= 9) return "bug";
    }
    return null;
  }
  const curEvent = () => eventFor(new Date());
  const curTourneyDay = () => tourneyToday(new Date());
  const daysTogether = () => Math.max(0, Math.floor((Date.now() - (S.createdAt || Date.now())) / 86400000));
  function annivToday(d) { // L-5: yearly MM-DD match or a multiple of 100 days
    const n = daysTogether();
    if (S.anniversary && mmdd(d) === S.anniversary && n > 0) return true;
    return n > 0 && n % 100 === 0;
  }
  const annivLabel = () => {
    const n = daysTogether();
    return S.anniversary && mmdd(new Date()) === S.anniversary && n % 100 !== 0
      ? "our anniversary" : `${n} days together`;
  };

  // ---------- fx (celebratory particles; ambient weather is procedural) ----------
  const fxPush = (k, x, y, o) => { if (S.fx.length < 90) S.fx.push(Object.assign({ k, x, y, vx: 0, vy: 0, age: 0, ttl: 1.2 }, o)); };
  function fireworks(x, y, n = 3) { // L-3/L-5: burst rings
    for (let i = 0; i < n; i++)
      fxPush("fw", x + rnd(-70, 70), y - rnd(20, 70), { ttl: rnd(1.1, 1.7), hue: pick(["#ffd94d", "#ff7fa5", "#8fd0ff", "#c58bff", "#ff9a5c"]), dl: i * 0.22 });
  }
  function confetti(x, y, n = 34) { // L-3 birthdays / L-5 photo
    for (let i = 0; i < n; i++)
      fxPush("conf", x + rnd(-30, 30), y - rnd(0, 26), { vx: rnd(-46, 46), vy: -rnd(20, 80), ttl: rnd(1.6, 2.6), c: pick(["#ff5b7f", "#ffd94d", "#5bd08a", "#5ba3e0", "#c58bff", "#ff9a5c"]), ph: rnd(0, 6) });
  }
  function pairedHearts(x, y, n = 5) { // L-5 paired-heart FX
    for (let i = 0; i < n; i++)
      fxPush("heart2", x + rnd(-26, 26), y - rnd(0, 18), { vy: -rnd(14, 24), ttl: rnd(1.2, 1.9), ph: rnd(0, 6) });
  }
  const sparkle = (x, y, n = 5) => { for (let i = 0; i < n; i++) fxPush("spark", x + rnd(-8, 8), y - rnd(0, 10), { ttl: rnd(0.35, 0.7) }); };

  // ---------- daily processing (host) ----------
  function yardTiles() { // walkable yard tiles for limited-item spawns
    if (!yardTiles._c) {
      const list = [];
      for (let ty = 0; ty < DH.world.H; ty++)
        for (let tx = 0; tx < DH.world.W; tx++)
          if (!DH.world.isSolid(tx, ty) && DH.world.zone(tx, ty) === "yard")
            list.push({ x: tx * T + 16, y: ty * T + 16 });
      yardTiles._c = list;
    }
    return yardTiles._c;
  }
  function spawnLimited(ev) { // scatter the event's limited item (L-1)
    const tiles = yardTiles();
    let guard = 24;
    while (S.spawns.length < SPAWN_TGT && guard-- > 0) {
      const t = pick(tiles);
      if (S.spawns.some(s => dist2(s.x, s.y, t.x, t.y) < 46 * 46)) continue;
      if (dist2(t.x, t.y, DECO.x, DECO.y) < 40 * 40) continue;
      S.spawns.push({ id: "ev" + S.nextId++, item: ev.item, x: t.x + rnd(-7, 7), y: t.y + rnd(-7, 7) });
    }
  }
  function checkDay(dt) { // real-day rollover → all daily events fire once (host only)
    dt = dt || new Date();
    const key = dayKey(dt), y = dt.getFullYear();
    if (S.lastDay === key) return;
    const prevDay = S.lastDay;
    S.lastDay = key;
    const ev = eventFor(dt), m = dt.getMonth() + 1, d = dt.getDate();

    // L-1: event arrival toast + fresh limited spawns
    S.spawns = S.spawns.filter(s => ev && s.item === ev.item); // stale items leave with the event
    if (ev) {
      spawnLimited(ev);
      const flag = "arr:" + ev.id + ":" + y;
      if (!S.seen[flag]) { S.seen[flag] = true; DH.toast(`${ev.ico} ${ev.name}! ${ev.msg}`, 3600); }
    }
    // L-4: first day of a meteorological season → toast + a seasonal gift
    const seas = metSeason(dt), first = SEASON_FIRST[seas];
    if (m === first.m && d === first.d && !S.firstSeen[seas + "-" + y]) {
      S.firstSeen[seas + "-" + y] = true;
      const got = DH.inv ? DH.inv.add(first.item, 1) : 0;
      DH.toast(`${first.ico} First day of ${seas}! ${got ? `Found ${DH.items.label(first.item)}` : "Pockets are full"}`, 3400);
      sparkle(HOUSE_FX.x, HOUSE_FX.y, 6);
    }
    // L-4: first precipitation of the season (self-contained weather)
    const w = weatherFor(dt);
    if (isPrecip(w) && !S.precipSeen[w + "-" + seas + "-" + y]) {
      S.precipSeen[w + "-" + seas + "-" + y] = true;
      DH.toast(w === "snow" ? "❄️ First snow of the season — bundle up!" : `☔ First rain of ${seas} — the garden drinks it up!`, 3200);
    }
    // L-3: player birthdays (configurable via S.birthdays)
    for (const ch of ["koto", "zuza"]) {
      if (S.birthdays[ch] !== mmdd(dt) || S.bdayDone[ch + ":" + y]) continue;
      S.bdayDone[ch + ":" + y] = true;
      const pl = (gs.players || []).find(p => p.char === ch);
      const who = (pl && pl.name) || ch;
      BDAY_GIFTS.forEach(g => DH.inv && DH.inv.add(g, 1));
      confetti(pl ? pl.x : HOUSE_FX.x, pl ? pl.y : HOUSE_FX.y);
      addHappy(10);
      album("🎂", `${who}'s birthday party`);
      DH.toast(`🎂 Happy birthday, ${who}! Cake and a letter for you!`, 3800);
    }
    // L-3: New Year — midnight crossing or first login of Jan 1
    if (m === 1 && d === 1 && S.nyYear !== y) {
      S.nyYear = y;
      fireworks(HOUSE_FX.x, HOUSE_FX.y - 90, 8);
      confetti(HOUSE_FX.x, HOUSE_FX.y, 40);
      addHappy(12);
      album("🎆", `Happy New Year ${y}!`);
      DH.toast(prevDay ? "🎆 Happy New Year!! 🎆" : `🎆 Happy New Year ${y}!`, 4200);
    }
    // L-5: couple anniversary — yearly MM-DD and every 100 days
    if (annivToday(dt) && S.annivDone !== key) {
      S.annivDone = key;
      fireworks(HOUSE_FX.x, HOUSE_FX.y - 80, 6);
      pairedHearts(HOUSE_FX.x, HOUSE_FX.y - 10, 7);
      addHappy(15);
      album("💗", `Anniversary — ${annivLabel()}`);
      DH.toast(`💗 Happy anniversary — ${annivLabel()}! Photo-op by the door 📷`, 4200);
    }
    // L-1 egg-hunt counter is per-day
    if (S.eggDay !== key) { S.eggDay = key; S.eggN = 0; }
  }

  // ---------- actions (remote-callable) ----------
  const API = {
    pickup(sid) { // collect a limited ground item (L-1)
      const it = S.spawns.find(s => s.id === sid);
      if (!it || !gs) return false;
      const got = DH.inv ? DH.inv.add(it.item, 1) : 0;
      if (got <= 0) { DH.toast("Pockets full! 🎒"); return false; }
      S.spawns = S.spawns.filter(s => s !== it);
      sparkle(it.x, it.y, 4);
      addHappy(1);
      if (it.item === "easter-egg") {
        S.eggN++;
        DH.toast(S.eggN >= 5 ? `All the eggs! ${DH.items.label(it.item)} ×${S.eggN} — egg-cellent! 🐣` : `Found a painted egg! (${S.eggN}/5) 🐣`, 2400);
        if (S.eggN === 5) { addHappy(8); fireworks(it.x, it.y - 40, 3); }
      } else DH.toast(`Picked up ${DH.items.label(it.item)}!`);
      return true;
    },
    eventAction() { // the active event's one themed action (L-1)
      const ev = curEvent();
      if (!ev || !gs) return false;
      if (S.actT > 0) { DH.toast("Give it a moment… ⏳"); return false; }
      S.actT = ACT_CD;
      const spot = { x: DECO.x, y: DECO.y };
      addHappy(4);
      if (ev.id === "fireworks") fireworks(spot.x, spot.y - 60, 4);
      else if (ev.id === "halloween" || ev.id === "christmas") { confetti(spot.x, spot.y - 10, 18); }
      else if (ev.id === "valentine" || ev.id === "newyear") pairedHearts(spot.x, spot.y - 10, 4);
      else sparkle(spot.x, spot.y - 12, 7);
      const got = DH.inv ? DH.inv.add(ev.item, 1) : 0;
      DH.toast(got ? `${ev.act.split(" ").slice(1).join(" ")}! +${DH.items.label(ev.item)}` : "Pockets full! 🎒", 2600);
      if (ev.id === "newyear") album("⛩️", "First shrine visit of the year");
      return true;
    },
    joinTourney(type, force) { // L-2: start the 3-minute timer (force = test hook)
      if (!gs || S.tourney || (!force && curTourneyDay() !== type)) return false;
      S.tourney = { type, t: TOURNEY_LEN, score: 0 };
      S.tcrit = [];
      S.tcritT = 0;
      DH.toast(type === "fish" ? "🎣 Fishing Tourney — 3 minutes! Tap shadows at the pond!" : "🦋 Bug Tourney — 3 minutes! Tap bugs in the yard!", 3600);
      return true;
    },
    tourneyCatch(cid) { // L-2: tag a deterministic shadow → points
      const c = S.tcrit.find(x => x.id === cid && x.until == null);
      if (!c || !S.tourney) return false;
      c.until = Date.now() + 5000; // respawns a few seconds later
      S.tourney.score += c.pts;
      const p = critPos(c);
      sparkle(p.x, p.y, 6);
      addHappy(0.5);
      DH.toast(`+${c.pts} pt${c.pts > 1 ? "s" : ""}! Score: ${S.tourney.score}`, 1400);
      return true;
    },
    takePhoto() { // L-5: photo-op under the anniversary arch
      if (!gs || !annivToday(new Date())) return false;
      const cx = (ARCH.x1 + ARCH.x2) / 2;
      pairedHearts(cx, ARCH.y - 30, 6);
      confetti(cx, ARCH.y - 30, 16);
      sparkle(cx, ARCH.y - 34, 8);
      addHappy(6);
      album("📷", `Anniversary photo — ${annivLabel()}`);
      DH.toast(`📷 Anniversary photo! ${annivLabel()} 💗`, 3000);
      return true;
    },
    setBirthday(who, s) { // L-3 setter — "koto"|"zuza", "MM-DD"
      const md = parseMD(s);
      if (!md || (who !== "koto" && who !== "zuza")) { DH.toast("Birthday format: MM-DD"); return false; }
      S.birthdays[who] = `${pad(md.m)}-${pad(md.d)}`;
      DH.toast(`${who}'s birthday set to ${S.birthdays[who]} 🎂`);
      return true;
    },
    setAnniversary(s) { // L-5 setter — "MM-DD"
      const md = parseMD(s);
      if (!md) { DH.toast("Anniversary format: MM-DD"); return false; }
      S.anniversary = `${pad(md.m)}-${pad(md.d)}`;
      DH.toast(`Anniversary set to ${S.anniversary} 💗`);
      return true;
    },
    celebrate(kind) { // shared celebrator (also a test hook)
      if (kind === "fireworks") { fireworks(HOUSE_FX.x, HOUSE_FX.y - 80, 6); return true; }
      if (kind === "confetti") { confetti(HOUSE_FX.x, HOUSE_FX.y); return true; }
      if (kind === "hearts") { pairedHearts(HOUSE_FX.x, HOUSE_FX.y - 10, 6); return true; }
      return false;
    },
  };

  // ---------- tourney sim (host) ----------
  const FISH_SZ = [{ sz: "s", pts: 1, rx: 9, ry: 4 }, { sz: "m", pts: 2, rx: 13, ry: 6 }, { sz: "l", pts: 3, rx: 17, ry: 8 }];
  const BUG_R = [{ pts: 1, c: "#ffd94d" }, { pts: 2, c: "#ff8c3a" }, { pts: 3, c: "#c58bff" }];
  function spawnTcrit() {
    const t = S.tourney;
    if (!t) return;
    const id = "tc" + S.nextId++;
    if (t.type === "fish") {
      const sz = pick(FISH_SZ), cx = rnd(POND_IN.x1 + 20, POND_IN.x2 - 20), cy = rnd(POND_IN.y1 + 10, POND_IN.y2 - 10);
      S.tcrit.push({ id, k: "fish", x0: cx, y0: cy, rx: Math.min(sz.rx + 10, cx - POND_IN.x1, POND_IN.x2 - cx), ry: Math.min(sz.ry + 8, cy - POND_IN.y1, POND_IN.y2 - cy), spd: rnd(0.5, 0.9), ph: rnd(0, 6.28), pts: sz.pts, sz: sz.sz });
    } else {
      const r = pick(BUG_R), cx = rnd(YARD.x1 + 32, YARD.x2 - 32), cy = rnd(YARD.y1 + 30, YARD.y2 - 30);
      S.tcrit.push({ id, k: "bug", x0: cx, y0: cy, rx: rnd(10, 26), ry: rnd(8, 20), spd: rnd(1.1, 1.7), ph: rnd(0, 6.28), pts: r.pts, c: r.c });
    }
  }
  function critPos(c) { // deterministic orbit — identical on host & guests, no pos sync needed
    const a = c.ph + Date.now() / 1000 * c.spd;
    return { x: c.x0 + Math.cos(a) * c.rx, y: c.y0 + Math.sin(a) * c.ry };
  }
  function endTourney() {
    const t = S.tourney;
    S.tourney = null; S.tcrit = [];
    const best = S.tourneyBest;
    if (t.score > (best[t.type] || 0)) best[t.type] = t.score;
    const prize = PRIZE.find(p => t.score >= p.n);
    if (prize) {
      const got = DH.inv ? DH.inv.add(prize.id, 1) : 0;
      if (got > 0) DH.toast(`🏆 ${t.score} pts — ${DH.items.label(prize.id)}!`, 4200);
      else { gs.coins += 150; DH.toast(`🏆 ${t.score} pts — pockets full, +🪙150`, 3600); }
      fireworks(HOUSE_FX.x, HOUSE_FX.y - 70, 4);
      album("🏆", `${t.type === "fish" ? "Fishing" : "Bug"} Tourney — ${t.score} pts`);
    } else DH.toast(`Tourney over — ${t.score} pts (bronze at ${PRIZE[2].n}). Next time! 🎣`, 3600);
    addHappy(prize ? 8 : 2);
  }

  // ---------- menus ----------
  function openCalendar() {
    const ev = curEvent(), rows = [];
    if (ev) rows.push({ ico: ev.ico, label: `<b>${ev.act}</b>`, cb: () => API.eventAction() });
    const ty = curTourneyDay();
    if (ty) rows.push({ ico: "🏆", label: `${ty === "fish" ? "Fishing" : "Bug"} Tourney today — visit the stand!`, cb: () => DH.toast(ty === "fish" ? "The tourney tent is by the pond 🎣" : "The tourney tent is in the yard by the garden 🦋", 3000) });
    if (annivToday(new Date())) rows.push({ ico: "💗", label: `Anniversary photo-op — ${annivLabel()}`, cb: () => DH.toast("Stand under the arch by the door and tap ⚡ 📷", 3200) });
    for (const e of EVENTS)
      rows.push({ ico: e.ico, label: `${e.name} <small>${e.dates}</small>${ev && ev.id === e.id ? " ◀ today" : ""}`, cb: () => DH.toast(`${e.ico} ${e.name} — ${e.msg}`, 3400) });
    rows.push({ ico: "🎣", label: "Fishing Tourney <small>3rd Sat monthly</small>", cb: () => DH.toast("Every 3rd Saturday — 3 minutes, trophies at 3/5/8 pts", 3400) });
    rows.push({ ico: "🦋", label: "Bug Tourney <small>3rd Sun Jun–Sep</small>", cb: () => DH.toast("3rd Sunday of June–September — catch the most!", 3400) });
    rows.push({ ico: "🎂", label: `Birthdays — koto ${S.birthdays.koto} · zuza ${S.birthdays.zuza}`, cb: () => DH.toast(`💗 Anniversary: ${S.anniversary || "—"} (${daysTogether()} days together)`, 3400) });
    DH.menu.open(`📅 Calendar — ${dayKey(new Date())}${ev ? ` · ${ev.ico} ${ev.name}` : ""}`, rows);
  }

  // ---------- module contract ----------
  const M = (DH.events = {
    authority: true,
    _state: S,

    init(state) {
      gs = state;
      ctx2 = document.getElementById("cv").getContext("2d");
      M.authority = !(DH.net && DH.net.online && DH.net.role === "guest");
      DH.world.blocked.add(Math.floor(DECO.x / T) + "," + Math.floor(DECO.y / T));
    },

    start(state) {
      gs = state;
      M.authority = !(DH.net && DH.net.online && DH.net.role === "guest");
      // L-5: anniversary defaults to the day the save was created
      if (!S.createdAt) {
        const blob = DH.save && DH.save.load ? DH.save.load() : null;
        S.createdAt = (blob && blob.savedAt) || Date.now();
      }
      if (!S.anniversary) S.anniversary = mmdd(new Date(S.createdAt));
      saveT = 0;
      if (M.authority) checkDay();
    },

    update(dt, state) {
      gs = state;
      if (!M.authority) return;
      saveT += dt;
      if (saveT > 7) { saveT = 0; DH.save.now(); }
      S.actT = Math.max(0, S.actT - dt);
      checkDay(); // real-date rollover while playing (midnight, event start…)

      // L-1: keep limited items topped up during an event
      S.spawnT -= dt;
      if (S.spawnT <= 0) {
        S.spawnT = SPAWN_EVERY;
        const ev = curEvent();
        if (ev) spawnLimited(ev);
      }

      // L-2: tourney timer + shadow roster
      if (S.tourney) {
        S.tourney.t -= dt;
        if (S.tourney.t <= 0) endTourney();
        else {
          S.tcritT -= dt;
          const live = S.tcrit.filter(c => c.until == null).length;
          if (live < TCRIT_TGT && S.tcritT <= 0) { S.tcritT = 1.2; spawnTcrit(); }
        }
      }
      for (const c of S.tcrit) if (c.until != null && Date.now() >= c.until) c.until = null; // caught critters resurface
    },

    offline() { // L-1/3/5: tell the player what today holds (ran once at start)
      const parts = [], now = new Date(), ev = eventFor(now);
      if (ev) parts.push(`${ev.ico} it's ${ev.name} today`);
      const ty = tourneyToday(now);
      if (ty) parts.push(`🏆 ${ty === "fish" ? "Fishing" : "Bug"} Tourney today`);
      if (annivToday(now)) parts.push("💗 it's your anniversary");
      return parts;
    },

    interactables(p) {
      if (!gs || !gs.running) return [];
      const out = [];
      const now = new Date(), ev = eventFor(now), ty = tourneyToday(now);

      // calendar sign (+ today's themed action, L-1)
      const dC = dist2(p.x, p.y, DECO.x, DECO.y);
      if (ev && dC < 48 * 48)
        out.push({ label: ev.act, x: DECO.x, y: DECO.y, d2: dC, action: () => API.eventAction() });
      if (dC < 80 * 80)
        out.push({ label: "Calendar 📅", x: DECO.x, y: DECO.y, d2: dC * (ev ? 1.6 : 1), action: openCalendar });

      // limited ground items (L-1)
      for (const s of S.spawns) {
        const dd = dist2(p.x, p.y, s.x, s.y);
        if (dd < PICKUP_R * PICKUP_R) {
          const d = DH.items.get(s.item) || { ico: "✨" };
          out.push({ label: `Pick up ${d.ico}`, x: s.x, y: s.y, d2: dd, action: () => API.pickup(s.id) });
        }
      }

      // anniversary arch photo-op (L-5)
      if (annivToday(now)) {
        const cx = (ARCH.x1 + ARCH.x2) / 2, dd = dist2(p.x, p.y, cx, ARCH.y);
        if (dd < 56 * 56)
          out.push({ label: "Anniversary photo 📷", x: cx, y: ARCH.y, d2: dd, action: () => API.takePhoto() });
      }

      // tournaments (L-2)
      if (S.tourney) {
        for (const c of S.tcrit) {
          if (c.until != null) continue;
          const cp = critPos(c), dd = dist2(p.x, p.y, cp.x, cp.y);
          const r = c.k === "fish" ? 92 : 40;
          if (dd < r * r)
            out.push({ label: c.k === "fish" ? `Hook it! 🎣 (+${c.pts})` : `Catch! 🦋 (+${c.pts})`, x: cp.x, y: cp.y, d2: dd, action: () => API.tourneyCatch(c.id) });
        }
      } else if (ty) {
        const st = ty === "fish" ? FISH_STAND : BUG_STAND;
        const dd = dist2(p.x, p.y, st.x, st.y);
        if (dd < st.r * st.r)
          out.push({ label: `${ty === "fish" ? "Fishing 🎣" : "Bug 🦋"} Tourney — join!`, x: st.x, y: st.y, d2: dd, action: () => API.joinTourney(ty) });
      }
      out.sort((a, b) => a.d2 - b.d2);
      return out;
    },

    // ----- drawing -----
    collectDraws(draws, camX, camY) {
      if (!ctx2) ctx2 = document.getElementById("cv").getContext("2d");
      const now = new Date(), ev = eventFor(now), ty = tourneyToday(now);

      draws.push({ y: DECO.y + 10, fn: () => drawCalSign(ctx2, DECO.x - camX, DECO.y - camY, ev) });
      if (ev) draws.push({ y: DECO.y + 24, fn: () => drawDeco(ctx2, ev.deco, DECO.x - camX + 44, DECO.y - camY + 8) });
      if (annivToday(now))
        draws.push({ y: ARCH.y + 6, fn: () => drawArch(ctx2, ARCH.x1 - camX, ARCH.x2 - camX, ARCH.y - camY) });
      if (ty && !S.tourney) {
        const st = ty === "fish" ? FISH_STAND : BUG_STAND;
        draws.push({ y: st.y + 12, fn: () => drawStand(ctx2, st.x - camX, st.y - camY, ty) });
      }
      for (const s of S.spawns)
        draws.push({ y: s.y, fn: () => drawSpawn(ctx2, s, s.x - camX, s.y - camY) });
      for (const c of S.tcrit) {
        if (c.until != null) continue;
        const cp = critPos(c);
        draws.push({ y: cp.y + 2, fn: () => (c.k === "fish" ? drawTFish(ctx2, c, cp.x - camX, cp.y - camY) : drawTBug(ctx2, c, cp.x - camX, cp.y - camY)) });
      }
    },

    drawOverlay(ctx, camX, camY, state) {
      ctx2 = ctx;
      const nowMs = performance.now();
      const dt = Math.min(0.06, ((nowMs - (M._fxT || nowMs)) / 1000) || 0.016);
      M._fxT = nowMs;
      for (let i = S.fx.length - 1; i >= 0; i--) {
        const f = S.fx[i];
        if (f.dl && f.dl > 0) { f.dl -= dt; continue; }
        f.age += dt; f.x += (f.vx || 0) * dt; f.y += (f.vy || 0) * dt;
        if (f.k === "conf") f.vy += 150 * dt;
        if (f.age >= f.ttl) { S.fx[i] = S.fx[S.fx.length - 1]; S.fx.pop(); continue; }
        drawFx(ctx, f, camX, camY);
      }
      if (!gs || !gs.running) return;

      const now = new Date(), ev = eventFor(now), w = weatherFor(now);

      // L-4 ambient precipitation (procedural — identical on both phones)
      if (isPrecip(w)) drawPrecip(ctx, w, camX, camY, nowMs);
      // sakura week: drifting petals (L-1)
      if (ev && ev.deco === "sakura") drawPetals(ctx, camX, camY, nowMs);
      // Aug fireworks night + New Year's Eve: ambient bursts after 18:00 (L-1/L-3)
      if ((ev && ev.id === "fireworks") || (now.getMonth() === 11 && now.getDate() === 31)) {
        if (now.getHours() >= 18 || ev) drawAmbientFireworks(ctx, camX, camY, nowMs);
      }
      // anniversary: drifting paired hearts by the arch (L-5)
      if (annivToday(now)) drawAnnivHearts(ctx, camX, camY, nowMs);

      drawChips(ctx, now, ev, w, state);
    },

    // ----- sync boundary -----
    serialize() {
      return JSON.parse(JSON.stringify({
        createdAt: S.createdAt, anniversary: S.anniversary, birthdays: S.birthdays,
        lastDay: S.lastDay, seen: S.seen, firstSeen: S.firstSeen, precipSeen: S.precipSeen,
        bdayDone: S.bdayDone, nyYear: S.nyYear, annivDone: S.annivDone,
        spawns: S.spawns, tcrit: S.tcrit, tourney: S.tourney, tourneyBest: S.tourneyBest,
        fx: S.fx, eggDay: S.eggDay, eggN: S.eggN, nextId: S.nextId, actT: S.actT,
      }));
    },
    deserialize(d) {
      if (!d) return;
      if (typeof d.createdAt === "number") S.createdAt = d.createdAt;
      if (typeof d.anniversary === "string") S.anniversary = d.anniversary;
      if (d.birthdays && typeof d.birthdays === "object")
        S.birthdays = { koto: d.birthdays.koto || "12-12", zuza: d.birthdays.zuza || "03-03" };
      if (typeof d.lastDay === "string") S.lastDay = d.lastDay;
      for (const k of ["seen", "firstSeen", "precipSeen", "bdayDone"]) if (d[k] && typeof d[k] === "object") S[k] = d[k];
      if (typeof d.nyYear === "number") S.nyYear = d.nyYear;
      if (typeof d.annivDone === "string") S.annivDone = d.annivDone;
      if (Array.isArray(d.spawns)) S.spawns = d.spawns;
      if (Array.isArray(d.tcrit)) S.tcrit = d.tcrit;
      if (d.tourney !== undefined) S.tourney = d.tourney;
      if (d.tourneyBest && typeof d.tourneyBest === "object") S.tourneyBest = d.tourneyBest;
      if (Array.isArray(d.fx)) S.fx = d.fx;
      if (typeof d.eggDay === "string") S.eggDay = d.eggDay;
      if (typeof d.eggN === "number") S.eggN = d.eggN;
      if (typeof d.nextId === "number") S.nextId = d.nextId;
      if (typeof d.actT === "number") S.actT = d.actT;
    },
    remoteAction(name, args) {
      return typeof API[name] === "function" ? API[name].apply(null, args || []) : false;
    },

    // exposed API (interactables + tests + econ reads current())
    current: curEvent,
    tourneyToday: d => tourneyToday(d || new Date()),
    checkDay, eventFor, weatherFor, metSeason, annivToday,
    pickup: API.pickup, eventAction: API.eventAction, joinTourney: API.joinTourney,
    tourneyCatch: API.tourneyCatch, takePhoto: API.takePhoto,
    setBirthday: API.setBirthday, setAnniversary: API.setAnniversary,
    openCalendar, celebrate: API.celebrate,
  });

  // ---------- sprite drawing ----------
  const R = (x, y, w, h, c) => { ctx2.fillStyle = c; ctx2.fillRect(x, y, w, h); };

  function drawCalSign(ctx, x, y, ev) { // year-round calendar board (event days get a flag)
    ctx2 = ctx;
    R(x - 2, y - 12, 4, 14, "#6e4a2a");
    R(x - 12, y - 26, 24, 15, "#a0733f");
    R(x - 12, y - 26, 24, 2, "#c09055");
    R(x - 12, y - 13, 24, 2, "#7a5527");
    ctx.font = "8px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(ev ? ev.ico : "📅", x, y - 18);
  }

  function drawSpawn(ctx, s, x, y) {
    ctx2 = ctx;
    DH.sprites.shadow(ctx, x, y + 4, 12);
    ctx.font = "11px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const tw = Math.sin(Date.now() / 420 + s.x) * 2;
    ctx.fillText((DH.items.get(s.item) || { ico: "✨" }).ico, x, y - 4 + tw);
    ctx.fillStyle = `rgba(255,240,140,${0.5 + 0.5 * Math.sin(Date.now() / 300 + s.y)})`;
    ctx.fillRect(x + 6, y - 12 + tw, 2, 2);
  }

  function drawDeco(ctx, deco, x, y) {
    ctx2 = ctx;
    const now = Date.now();
    switch (deco) {
      case "bunting": { // flag string between two poles (setsubun / fireworks)
        R(x - 26, y - 34, 3, 34, "#7a5328");
        R(x + 24, y - 34, 3, 34, "#7a5328");
        ctx.strokeStyle = "#f4e8d0"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x - 25, y - 32); ctx.quadraticCurveTo(x, y - 24, x + 25, y - 32); ctx.stroke();
        const cols = ["#e04848", "#ffd94d", "#5ba3e0", "#5bd08a"];
        for (let i = 0; i < 5; i++) {
          const t = (i + 0.5) / 5, fx = x - 25 + t * 50, fy = y - 32 + Math.sin(t * Math.PI) * 8;
          ctx.fillStyle = cols[i % 4];
          ctx.beginPath(); ctx.moveTo(fx - 3, fy); ctx.lineTo(fx + 3, fy); ctx.lineTo(fx, fy + 6); ctx.fill();
        }
        break;
      }
      case "hearts": // valentine: heart balloons on strings
        for (let i = 0; i < 3; i++) {
          const hx = x - 16 + i * 16, hy = y - 34 - Math.sin(now / 600 + i) * 2;
          ctx.strokeStyle = "#c9b797"; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(hx, y - 8); ctx.lineTo(hx, hy + 4); ctx.stroke();
          DH.sprites.heart(ctx, hx, hy, 7, i === 1 ? "#ff7fa5" : "#ff5b7f");
        }
        break;
      case "dolls": { // hinamatsuri: 2-tier doll stand
        R(x - 18, y - 4, 36, 4, "#c94f4f");
        R(x - 14, y - 13, 28, 4, "#e07ba0");
        for (let i = 0; i < 2; i++) { // top tier: emperor + empress
          const dx = x - 6 + i * 12;
          R(dx - 3, y - 19, 6, 7, i ? "#e07ba0" : "#5ba3e0");
          R(dx - 2, y - 23, 4, 4, "#f2c9a0");
          R(dx - 3, y - 24, 6, 2, "#241a24");
        }
        for (let i = 0; i < 3; i++) R(x - 12 + i * 10, y - 10, 5, 6, ["#ffd94d", "#5bd08a", "#c58bff"][i]); // court ladies
        break;
      }
      case "sakura": { // cherry tree
        R(x - 3, y - 22, 7, 22, "#7a4a2c");
        R(x - 16, y - 44, 34, 22, "#ffb7d0");
        R(x - 22, y - 36, 44, 12, "#ff9ec4");
        R(x - 12, y - 38, 8, 6, "#ffd0e0"); R(x + 6, y - 42, 8, 5, "#ffd0e0");
        break;
      }
      case "eggs": { // egg basket
        R(x - 9, y - 8, 18, 9, "#a0733f");
        R(x - 9, y - 9, 18, 2, "#c09055");
        ctx.strokeStyle = "#a0733f"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y - 7, 9, Math.PI, 0); ctx.stroke();
        const ec = ["#ff9ec4", "#9ec4ff", "#fff09e"];
        for (let i = 0; i < 3; i++) { R(x - 6 + i * 5, y - 13, 4, 5, ec[i]); }
        break;
      }
      case "bamboo": { // tanabata bamboo with wish strips
        R(x - 1, y - 46, 4, 46, "#5fa83e");
        R(x - 7, y - 40, 10, 2, "#5fa83e"); R(x - 8, y - 28, 12, 2, "#5fa83e"); R(x - 6, y - 16, 9, 2, "#5fa83e");
        R(x - 3, y - 47, 7, 2, "#77c44f");
        const sc = ["#ff9ec4", "#9ec4ff", "#fff09e"];
        for (let i = 0; i < 3; i++) {
          const sw = Math.sin(now / 500 + i * 2) * 1.5;
          R(x - 6 + sw, y - 38 + i * 11, 4, 7, sc[i]);
        }
        break;
      }
      case "pumpkins": // halloween: jack-o-lanterns
        for (let i = 0; i < 3; i++) {
          const px = x - 18 + i * 17, s = i === 1 ? 8 : 6;
          R(px - s, y - s * 2 - 2, s * 2, s * 2, "#e8862a");
          R(px - 1, y - s * 2 - 5, 3, 4, "#4a7a3a");
          R(px - s + 2, y - s * 2 + 2, 3, 3, "#3a2412"); R(px + s - 5, y - s * 2 + 2, 3, 3, "#3a2412"); // eyes
          R(px - 3, y - 5, 6, 2, "#3a2412"); // grin
          R(px - s + 1, y - s - 1, s * 2 - 2, 1, "#c96a1a");
        }
        break;
      case "harvest": { // cornucopia + gourds
        ctx.fillStyle = "#b5763a";
        ctx.beginPath(); ctx.moveTo(x - 16, y - 6); ctx.lineTo(x + 12, y - 12); ctx.lineTo(x + 12, y - 2); ctx.lineTo(x - 16, y); ctx.fill();
        R(x - 18, y - 8, 4, 10, "#8a5a2a");
        R(x + 8, y - 14, 7, 7, "#e8862a"); R(x + 2, y - 11, 6, 6, "#ffd94d"); R(x + 12, y - 8, 5, 5, "#7ab84a");
        break;
      }
      case "tree": { // toy day: christmas tree + gifts
        R(x - 3, y - 6, 6, 6, "#7a4a2c");
        for (let i = 0; i < 3; i++) {
          const w = 26 - i * 7, ty = y - 8 - i * 9;
          R(x - w / 2, ty, w, 8, i % 2 ? "#3f8f33" : "#4f9f43");
        }
        ctx.fillStyle = "#ffd94d";
        R(x - 1, y - 38, 3, 3, "#ffd94d"); // star
        const li = ["#e04848", "#ffd94d", "#5ba3e0"];
        for (let i = 0; i < 6; i++)
          R(x - 10 + (i * 4 + (i % 3) * 3), y - 12 - (i % 3) * 8, 2, 2, li[i % 3]); // lights
        R(x - 12, y - 5, 6, 5, "#e04848"); R(x + 6, y - 5, 6, 5, "#5ba3e0"); // gifts
        break;
      }
      case "kadomatsu": { // new year: pine-and-bamboo gate decoration
        R(x - 8, y - 26, 5, 26, "#b8933a"); R(x + 3, y - 26, 5, 26, "#b8933a");
        R(x - 10, y - 27, 24, 3, "#8a5a2a");
        R(x - 7, y - 31, 3, 6, "#5fa83e"); R(x + 5, y - 33, 3, 8, "#5fa83e"); R(x - 1, y - 35, 3, 10, "#77c44f");
        R(x - 11, y - 10, 22, 3, "#e0c060");
        break;
      }
    }
  }

  function drawArch(ctx, x1, x2, y) { // L-5: flower arch over the door path
    ctx2 = ctx;
    R(x1 - 2, y - 34, 5, 34, "#7a5328");
    R(x2 - 3, y - 34, 5, 34, "#7a5328");
    ctx.strokeStyle = "#5fa83e"; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(x1, y - 30); ctx.quadraticCurveTo((x1 + x2) / 2, y - 52, x2, y - 30); ctx.stroke();
    const cols = ["#ff5b7f", "#ffd94d", "#ff9ec4", "#c58bff"];
    for (let i = 0; i < 7; i++) {
      const t = i / 6, ax = x1 + t * (x2 - x1), ay = y - 30 - Math.sin(t * Math.PI) * 16;
      R(ax - 2, ay - 2, 4, 4, cols[i % 4]);
    }
  }

  function drawStand(ctx, x, y, ty) { // L-2: striped tourney tent
    ctx2 = ctx;
    R(x - 14, y - 26, 4, 28, "#7a5328"); R(x + 10, y - 26, 4, 28, "#7a5328");
    R(x - 18, y - 32, 36, 8, ty === "fish" ? "#5ba3e0" : "#5bd08a");
    for (let i = 0; i < 4; i++) R(x - 18 + i * 9, y - 32, 4.5, 8, "#f4e8d0");
    R(x - 18, y - 34, 36, 3, ty === "fish" ? "#3a7ab0" : "#3a9f5a");
    ctx.font = "9px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(ty === "fish" ? "🎣" : "🦋", x, y - 12);
    ctx.fillStyle = "#3a2412"; ctx.font = "bold 5px sans-serif";
    ctx.fillText("TOURNEY", x, y - 4);
  }

  function drawTFish(ctx, c, x, y) { // golden tourney shadow in the pond
    ctx2 = ctx;
    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = "#1c4a7c";
    const w = c.pts * 4 + 8, h = c.pts * 1.8 + 3;
    ctx.beginPath(); ctx.ellipse(x, y, w, h, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x - w + 2, y); ctx.lineTo(x - w - 5, y - 4); ctx.lineTo(x - w - 5, y + 4); ctx.fill();
    ctx.strokeStyle = "#ffd94d99"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(x, y, w + 2, h + 1.5, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  function drawTBug(ctx, c, x, y) { // tourney bug — flapping wings
    ctx2 = ctx;
    const flap = Math.abs(Math.sin(Date.now() / 90 + c.ph)) * 0.7 + 0.3;
    const yy = y - 14 + Math.sin(Date.now() / 400 + c.ph) * 2;
    ctx.save();
    ctx.fillStyle = c.c || "#ffd94d";
    ctx.fillRect(x - 6 * flap, yy - 4, 5, 7);
    ctx.fillRect(x + 1, yy - 4, 5 * flap, 7);
    ctx.fillStyle = "#3a2a1a"; ctx.fillRect(x - 1, yy - 5, 2, 9);
    ctx.restore();
  }

  // ---------- overlay fx ----------
  function drawFx(ctx, f, camX, camY) {
    const t = f.age / f.ttl, x = f.x - camX, y = f.y - camY;
    ctx.save();
    if (f.k === "fw") { // expanding firework ring
      const r = 4 + t * 34, a = Math.max(0, 1 - t);
      ctx.globalAlpha = a;
      ctx.fillStyle = f.hue || "#ffd94d";
      for (let i = 0; i < 12; i++) {
        const an = (i / 12) * Math.PI * 2 + (f.hue === "#ffd94d" ? 0 : 0.26);
        ctx.fillRect(x + Math.cos(an) * r - 1, y + Math.sin(an) * r - 1, 2.4, 2.4);
      }
      ctx.globalAlpha = a * 0.5;
      ctx.fillStyle = "#ffffff";
      for (let i = 0; i < 6; i++) {
        const an = (i / 6) * Math.PI * 2 + 0.5;
        ctx.fillRect(x + Math.cos(an) * r * 0.55 - 1, y + Math.sin(an) * r * 0.55 - 1, 2, 2);
      }
    } else if (f.k === "conf") {
      ctx.globalAlpha = Math.max(0, 1 - t * t);
      ctx.fillStyle = f.c;
      const fl = Math.sin(f.age * 9 + f.ph);
      ctx.fillRect(x - 1.5, y - 1, 3, 2 + Math.abs(fl) * 2);
    } else if (f.k === "heart2") {
      ctx.globalAlpha = Math.max(0, 1 - t);
      const dx = Math.sin(f.age * 3 + f.ph) * 5;
      DH.sprites.heart(ctx, x + dx - 3, y, 5, "#ff5b7f");
      DH.sprites.heart(ctx, x + dx + 3, y - 2, 5, "#ff9ec4");
    } else if (f.k === "spark") {
      ctx.globalAlpha = Math.sin(Math.min(1, t) * Math.PI);
      ctx.fillStyle = "#ffe89a";
      const s = 3;
      ctx.fillRect(x - s, y - 0.7, s * 2, 1.4); ctx.fillRect(x - 0.7, y - s, 1.4, s * 2);
    }
    ctx.restore();
  }

  function drawPrecip(ctx, w, camX, camY, now) { // L-4: rain streaks / snowflakes
    const vw = ctx.canvas.width, vh = ctx.canvas.height;
    ctx.save();
    const n = w === "snow" ? 46 : 70, spd = w === "snow" ? 26 : 320;
    for (let i = 0; i < n; i++) {
      const hx = ((i * 997) % 1600) / 1600, hy = ((i * 613) % 1600) / 1600;
      const px = (hx * (vw + 80) - 40) + (w === "snow" ? Math.sin(now / 900 + i) * 14 : now / 1000 * -30);
      const py = ((hy * (vh + 120) + now / 1000 * spd) % (vh + 120)) - 60;
      if (w === "snow") {
        ctx.fillStyle = "rgba(245,250,255,0.8)";
        ctx.fillRect(px - ((i % 3) - 1), py, 2.2, 2.2);
      } else {
        ctx.fillStyle = "rgba(170,200,235,0.5)";
        ctx.fillRect(px, py, 1.3, 9);
      }
    }
    ctx.restore();
  }

  function drawPetals(ctx, camX, camY, now) { // L-1 sakura week
    const vw = ctx.canvas.width, vh = ctx.canvas.height;
    ctx.save();
    ctx.fillStyle = "#ffc0d8";
    for (let i = 0; i < 22; i++) {
      const hx = ((i * 887) % 1600) / 1600, hy = ((i * 553) % 1600) / 1600;
      const px = (hx * (vw + 160) + now / 1000 * 22 + Math.sin(now / 700 + i) * 16) % (vw + 160) - 80;
      const py = ((hy * (vh + 100) + now / 1000 * 16) % (vh + 100)) - 50;
      ctx.globalAlpha = 0.75;
      ctx.fillRect(px, py + Math.sin(now / 300 + i) * 2, 3, 2.4);
    }
    ctx.restore();
  }

  function drawAmbientFireworks(ctx, camX, camY, now) { // L-1 Aug nights / L-3 NYE
    const phase = (now % 2600) / 2600, idx = Math.floor(now / 2600);
    const r = mulberry32(idx * 7919);
    const fx = 8 * T + r() * 16 * T - camX, fy = 2 * T + r() * 5 * T - camY;
    if (fx < -60 || fx > ctx.canvas.width + 60) return;
    drawFx(ctx, { k: "fw", x: fx + camX, y: fy + camY, age: phase * 1.5, ttl: 1.5, hue: ["#ffd94d", "#ff7fa5", "#8fd0ff", "#c58bff"][idx % 4] }, camX, camY);
  }

  function drawAnnivHearts(ctx, camX, camY, now) { // L-5 ambient hearts by the arch
    const cx = (ARCH.x1 + ARCH.x2) / 2 - camX;
    for (let i = 0; i < 4; i++) {
      const ph = ((now / 1400 + i * 0.25) % 1);
      ctx.globalAlpha = Math.sin(ph * Math.PI) * 0.8;
      DH.sprites.heart(ctx, cx + Math.sin(i * 2.4) * 18, ARCH.y - 34 - ph * 30 - camY, 4.5, i % 2 ? "#ff5b7f" : "#ff9ec4");
    }
    ctx.globalAlpha = 1;
  }

  function drawChips(ctx, now, ev, w, state) { // top-center status chips
    let txt = null;
    if (S.tourney) {
      const t = Math.max(0, S.tourney.t), mm = Math.floor(t / 60), ss = Math.floor(t % 60);
      txt = `${S.tourney.type === "fish" ? "🎣" : "🦋"} ${mm}:${pad(ss)} · ${S.tourney.score} pt`;
    } else if (now.getMonth() === 11 && now.getDate() === 31 && now.getHours() >= 18) { // L-3 NYE countdown
      const left = new Date(now.getFullYear() + 1, 0, 1) - now;
      const hh = Math.floor(left / 3600000), m2 = Math.floor(left / 60000) % 60, s2 = Math.floor(left / 1000) % 60;
      txt = `🎆 New Year in ${hh}:${pad(m2)}:${pad(s2)}`;
    } else if (ev) txt = `${ev.ico} ${ev.name}`;
    else if (annivToday(now)) txt = `💗 ${annivLabel()}`;
    else if (isPrecip(w)) txt = w === "snow" ? "❄️ Snowy" : "☔ Rainy";
    if (!txt) return;
    ctx.font = "bold 10px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const wpx = ctx.measureText(txt).width + 18;
    const cy = ctx.canvas.height - 24; // bottom-center: stays clear of HUD pills & touch controls
    ctx.fillStyle = "#14142add";
    ctx.beginPath(); ctx.roundRect(ctx.canvas.width / 2 - wpx / 2, cy, wpx, 18, 9); ctx.fill();
    ctx.fillStyle = "#ffe8f0";
    ctx.fillText(txt, ctx.canvas.width / 2, cy + 9.5);
  }

  DH.register("events", M);
})();
