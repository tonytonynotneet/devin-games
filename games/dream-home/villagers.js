/* dream-home villagers module — animal villager social sim (AC spec H-1..H-10).
   Contract with game.js (self-registers via DH.register at the bottom):
     DH.villagers.init(state) / start(state) / update(dt,state)
     DH.villagers.collectDraws(draws, camX, camY) — villagers, tent, letterbox
     DH.villagers.drawOverlay(ctx, camX, camY, state) — name tags, ! bubbles,
       speech bubbles, emote bubbles, hearts/confetti FX
     DH.villagers.interactables(p) -> [{label,x,y,action}]
     DH.villagers.serialize()/deserialize(data)/remoteAction(name,args)
     DH.villagers.offline(offMin) -> [summary parts]

   Layered ON TOP of animals.js (family pets in the pasture) — these are
   wandering villager NPCs in the yard & garden with their own social loop:

   H-1 personalities — 4 starters (Momo rabbit/genki, Gonta bear/lazy,
       Suzume bird/bigsis, Ken fox/exe); wander AI: stroll/stop/sit/sniff
       flowers/chat bubbles.
   H-2 friendship — per-villager hearts 0-10 (talk daily, gifts, quests).
       High friendship → their portrait item + they teach a reaction.
   H-3 gifts — "Give a gift" menu picks a pocket item; category match vs
       likes/dislikes → joy/meh/dislike reaction, friendship delta, gift back.
   H-4 requests — "!" bubble → "What's up?" → mini-quest (bring items /
       catch a bug / deliver a parcel). Rewards bells/hearts; expires daily.
   H-5 birthdays — each villager has a birthday in the 8-day year; party hat,
       confetti, special line, gifts give bonus hearts.
   H-6 letters — letterbox next to the mailbox: write (villager + template +
       optional gift) → next day a reply letter arrives (+friendship).
   H-7 move-in/out — a camper pitches the yard tent every few days; invite
       them to stay (roster cap 6). Ignored villagers warn, then move away.
   H-8 dialogue — rotating pools per personality + time/season/weather-aware
       lines, gossip about the roster, reactions to the recent play log.
   H-9 reactions — villagers flash emote bubbles (♥/!/😂/💢/💤); learned
       reactions let the PLAYER show the same bubble via "React".
   H-10 dream-villa job — weekly, one villager asks for 2 themed-category
       items for their dream room; scored via their likes.

   Sync boundary: all sim state lives in S (plain JSON). Guests never run
   update(); they render deserialize() snapshots. Mutations are named API
   fns reachable via remoteAction(name,args) (or host-side actAt dispatch).
*/
(function () {
  const DH = (window.DH = window.DH || {});
  const T = 32;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const cap1 = s => s.charAt(0).toUpperCase() + s.slice(1);

  // ---------- tuning ----------
  const INTERACT_R = 36;
  const SPEED = 36;               // px/s villager stroll
  const MAX_ROSTER = 6;
  const YEAR = 8;                 // game-days per calendar "year" (2d x 4 seasons)
  const CAMP_MOD = 3, CAMP_ON = 1;      // camper visits on dayStamp % 3 === 1
  const VILLA_MOD = 7, VILLA_ON = 4;    // dream-villa wish on dayStamp % 7 === 4
  const QUEST_CHANCE = 0.35;      // per villager per day
  const NIGHT_FROM = 21 * 60, NIGHT_TO = 6 * 60;
  const SAVE_EVERY = 6;           // s between autosaves
  const DAY_MIN = 6;              // real minutes per game-day (game.js pacing)
  const RX_TEACH = 6;             // hearts to learn a reaction
  const PIC_HEARTS = 8;           // hearts to receive a portrait

  // ---------- cast ----------
  // personalities: genki | exe | bigsis | lazy — bday is the day-in-year (0-7)
  const CAST = [
    { name: "Momo",   species: "rabbit",   per: "genki",  phrase: "poing!",  hobby: "dancing",    likes: ["flower", "fruit"],    dislikes: ["material"], bday: 1 },
    { name: "Gonta",  species: "bear",     per: "lazy",   phrase: "hm-hm…",   hobby: "napping",    likes: ["food", "material"],  dislikes: ["bug"],      bday: 3 },
    { name: "Suzume", species: "bird",     per: "bigsis", phrase: "chirp!",   hobby: "singing",    likes: ["flower", "fish"],    dislikes: ["sea"],      bday: 5 },
    { name: "Ken",    species: "fox",      per: "exe",    phrase: "yah!",     hobby: "training",   likes: ["fish", "bug"],       dislikes: ["flower"],   bday: 7 },
  ];
  const CAMPERS = [
    { name: "Tama",  species: "squirrel", per: "genki",  phrase: "nut!",    hobby: "collecting", likes: ["material", "food"], dislikes: ["sea"],      bday: 0 },
    { name: "Petal", species: "deer",     per: "bigsis", phrase: "softly…", hobby: "gardening",  likes: ["flower", "bug"],    dislikes: ["fish"],     bday: 2 },
    { name: "Rocky", species: "penguin",  per: "lazy",   phrase: "waddle…", hobby: "snacking",   likes: ["fish", "sea"],      dislikes: ["material"], bday: 4 },
    { name: "Kiki",  species: "cat",      per: "exe",    phrase: "me-YOW!", hobby: "exploring",  likes: ["bug", "food"],      dislikes: ["flower"],   bday: 6 },
  ];
  const SPECIES_ICO = { rabbit: "🐰", bear: "🐻", bird: "🐦", fox: "🦊", squirrel: "🐿️", deer: "🦌", penguin: "🐧", cat: "🐱" };
  const RX_OF = { genki: "joy", exe: "wow", bigsis: "love", lazy: "zzz" };
  const RX_LABEL = { joy: "😂 Joy", wow: "❗ Wow", love: "❤️ Love", zzz: "💤 Sleepy" };

  // ---------- world fixtures ----------
  const TENT = { x: 17 * T + 16, y: 11 * T + 16 };   // campsite, east yard gap (clear of court/sauna)
  const BOX = { x: 13 * T + 16, y: 11 * T + 16 };    // letterbox by the door path
  const HOME_MAIL = { x: 10 * T + 16, y: 11 * T + 16 }; // home.js mailbox (don't collide)

  // ---------- module state (plain JSON only) ----------
  let gs = null;
  const S = {
    vils: [],      // villager entities (see makeVillager)
    camper: null,  // today's camper entity or null
    campDay: -1,   // dayStamp the camper is here for
    mail: [],      // reply letters waiting at the letterbox {id,from,text,gift}
    outbox: [],    // sent letters awaiting next day {id,toId,text,gift,replyDay}
    learned: [],   // reaction ids the player has learned
    fx: [],        // {k,x,y,vx,vy,age,ttl,c}
    pfx: {},       // pid -> {k,t} player-shown reaction bubble
    dayStamp: -1,
    nextId: 1,
  };
  let saveT = 0, ctx2 = null;
  const alog = (e, d) => { if (DH.alog) DH.alog.add(e, d); };
  const isNight = () => gs && (gs.timeMin >= NIGHT_FROM || gs.timeMin < NIGHT_TO);
  const dayStamp = () => Math.floor((gs && gs.day) || 0);
  const isBday = v => v.bday === dayStamp() % YEAR;
  const addHappy = n => { if (gs) gs.happiness = Math.max(0, gs.happiness + n); };
  const findV = id => S.vils.find(v => v.id === id) || (S.camper && S.camper.id === id ? S.camper : null);

  // ---------- items ----------
  DH.items.def("parcel", { name: "Parcel", ico: "📦", cat: "misc", price: 0, stack: 5 });
  function defPortrait(v) {
    const id = "pic-" + v.id;
    if (!DH.items.get(id)) DH.items.def(id, { name: `${v.name}'s portrait`, ico: "🖼️", cat: "furniture", price: 120, stack: 1 });
  }

  // ---------- walkable tiles ----------
  const zoneTiles = {};
  function walkTiles(zone) {
    if (!zoneTiles[zone]) {
      const list = [];
      for (let ty = 0; ty < DH.world.H; ty++)
        for (let tx = 0; tx < DH.world.W; tx++)
          if (!DH.world.isSolid(tx, ty) && DH.world.zone(tx, ty) === zone)
            list.push({ x: tx * T + 16, y: ty * T + 16 });
      zoneTiles[zone] = list;
    }
    return zoneTiles[zone];
  }
  function zoneOf(x, y) { return DH.world.zone(Math.floor(x / T), Math.floor(y / T)); }

  // ---------- entities ----------
  function makeVillager(def, id) {
    const zone = Math.random() < 0.62 ? "yard" : "garden";
    const spot = pick(walkTiles(zone));
    return {
      id, name: def.name, species: def.species, per: def.per, phrase: def.phrase,
      hobby: def.hobby, likes: def.likes.slice(), dislikes: def.dislikes.slice(),
      bday: def.bday, hearts: 2,
      x: spot.x + rnd(-8, 8), y: spot.y + rnd(-8, 8), tx: 0, ty: 0,
      dir: "down", step: rnd(0, 1), moving: false, mode: "idle", wait: rnd(0.5, 2), stuckT: 0,
      talkDay: -1, offer: null, quest: null, pic: false, rxTaught: false,
      lastTalk: 0, moveIn: 0, warnDay: -1, bub: null, em: null,
    };
  }
  function fixV(v) { // backfill for old saves / snapshots
    if (v.hearts == null) v.hearts = 2;
    if (v.talkDay == null) v.talkDay = -1;
    if (v.lastTalk == null) v.lastTalk = 0;
    if (v.moveIn == null) v.moveIn = 0;
    if (v.warnDay == null) v.warnDay = -1;
    if (v.bday == null) v.bday = 0;
    if (!v.likes) v.likes = [];
    if (!v.dislikes) v.dislikes = [];
    if (v.offer === undefined) v.offer = null;
    if (v.quest === undefined) v.quest = null;
    if (v.pic == null) v.pic = false;
    if (v.rxTaught == null) v.rxTaught = false;
    if (!v.mode) v.mode = "idle";
    if (v.wait == null) v.wait = 1;
    if (v.stuckT == null) v.stuckT = 0;
    return v;
  }
  function freshRoster() {
    S.vils = CAST.map((d, i) => makeVillager(d, "v" + (i + 1)));
    S.nextId = CAST.length + 1;
    S.camper = null; S.campDay = -1;
    S.mail = []; S.outbox = []; S.learned = []; S.fx = []; S.pfx = {};
  }

  // ---------- FX ----------
  function fx(k, x, y, o) { if (S.fx.length < 90) S.fx.push(Object.assign({ k, x, y, vx: 0, vy: -22, age: 0, ttl: 1 }, o)); }
  function hearts(x, y, n = 2) { for (let i = 0; i < n; i++) fx("heart", x + rnd(-9, 9), y - 14 + rnd(-6, 0), { ttl: 0.9 }); }
  function confetti(x, y, n = 14) {
    const cols = ["#e05b8a", "#5bc8d0", "#ffd76b", "#8ad05b", "#c58bff", "#ff9a5c"];
    for (let i = 0; i < n; i++)
      fx("conf", x + rnd(-16, 16), y - 30 + rnd(-10, 6), { vx: rnd(-14, 14), vy: rnd(-30, -8), ttl: rnd(0.9, 1.6), c: pick(cols) });
  }
  function emote(v, k, t = 2.4) { v.em = { k, t }; }
  function bubble(v, txt, t = 2.8) { v.bub = { txt, t }; }

  // ---------- dialogue pools (H-8) ----------
  const LINES = {
    genki: [
      "I did a hundred jumps before breakfast! Wanna see?!",
      "Today feels like a GREAT day for a little dance party!",
      "I found the shiniest rock ever! I gave it to a snail.",
      "Race you to the garden fence! Okay — you win, you're SO fast!",
    ],
    exe: [
      "Three more laps around the yard! My legs are LEGENDARY!",
      "A fox's gotta train! You should try morning stretches!",
      "I counted all the clouds today. Twelve. TWELVE!",
      "Someday I'm gonna catch that pond fish with my bare paws!",
    ],
    bigsis: [
      "You're doing great, sweetie. Don't overwork yourself.",
      "If anyone gives you trouble, you send them to me.",
      "I watered a few flowers on my stroll. Free of charge.",
      "This village feels like home. You built that, you two.",
    ],
    lazy: [
      "I was gonna weed the garden… but the grass was SO comfy.",
      "Had a dream about a giant apple. Woke up hungry.",
      "Slow and steady wins the nap… wait, that's not it.",
      "The pond looks extra sparkly today. Nice place to sit.",
    ],
  };
  const TIME_LINES = {
    morning: ["Morning already?! The air smells like possibilities!", "G'morning! The dew on the grass is SO sparkly."],
    day: ["The sun feels nice on my fur.", "Perfect weather for a wander, right?"],
    evening: ["The sky's all orange and pink — pretty, huh?", "Evening walks are the best walks."],
    night: ["*yawn*… the stars are out. Don't stay up too late!", "Shh… the whole village is sleepy tonight."],
  };
  const SEASON_LINES = {
    spring: ["The flowers smell AMAZING this time of year!", "Spring makes me want to sing. No, really — cover your ears."],
    summer: ["It's SO warm… perfect for cold lemonade.", "The bugs are singing all day. Free concert!"],
    autumn: ["The leaves are turning! I found a golden one.", "Autumn snacks hit different. Mushroom season!"],
    winter: ["Brrr! My ears are freezing — but it sure is pretty.", "Snowy grass is the crunchiest grass."],
  };
  const GOSSIP = [
    v => `Have you talked to ${v.name} lately? ${cap1(v.per === "lazy" ? "They looked extra sleepy today." : "they're up to something fun.")}`,
    v => `${v.name} and I were chatting by the pond — good times, ${pickPhrase(v)}.`,
    v => `I think ${v.name} secretly loves it here. Don't tell them I said that!`,
  ];
  const BDAY_SELF = ["It's MY BIRTHDAY!! I can't stop smiling!!", "You remembered? Of course you did — best day EVER!"];
  const BDAY_OTHER = v => `Psst — it's ${v.name}'s birthday today! Bring them something nice!`;
  const CAMPER_LINES = ["Just camping for a bit — this place has great vibes!", "Wow, a real village! The tent view is lovely."];

  function pickPhrase(v) { return v.phrase || "…"; }
  function recentEventLine() {
    if (!DH.alog) return null;
    const ev = DH.alog.dump(8).filter(e => e.e === "act" || e.e === "act2").pop();
    if (!ev || !ev.d) return null;
    const what = String(ev.d).replace(/ ·.*$/, "");
    return `I saw you "${what.toLowerCase()}" earlier — you're always busy, huh?`;
  }
  function chatLine(v) {
    if (isBday(v)) return pick(BDAY_SELF);
    const r = Math.random();
    if (r < 0.22 && S.vils.length > 1) {
      const others = S.vils.filter(o => o.id !== v.id);
      if (others.length) {
        const o = pick(others);
        if (isBday(o) && Math.random() < 0.5) return BDAY_OTHER(o);
        return pick(GOSSIP)(o);
      }
    }
    if (r < 0.40) {
      const t = gs ? gs.timeMin : 720;
      const slot = t >= 1230 || t < 330 ? "night" : t >= 1050 ? "evening" : t < 660 ? "morning" : "day";
      return pick(TIME_LINES[slot]);
    }
    if (r < 0.58 && gs && gs.season) return pick(SEASON_LINES[gs.season] || SEASON_LINES.spring);
    if (r < 0.68) { const ev = recentEventLine(); if (ev) return ev; }
    return pick(LINES[v.per] || LINES.lazy);
  }

  // ---------- quests (H-4) ----------
  const BRING_POOL = ["apple", "shell", "mushroom", "wood", "clay"];
  const CAT_POOL = ["bug", "fish", "flower", "sea", "food", "material", "fruit"];
  function makeQuest(v) {
    const roll = Math.random();
    if (roll < 0.4) {
      const item = pick(BRING_POOL);
      return { t: "bring", item, n: Math.random() < 0.4 ? 2 : 1, exp: dayStamp() + 1 };
    }
    if (roll < 0.75) {
      const cat = pick(CAT_POOL.concat(v.likes));
      return { t: "bring", cat, n: cat === "bug" || cat === "fish" ? 1 : 2, exp: dayStamp() + 1 };
    }
    const others = S.vils.filter(o => o.id !== v.id);
    if (!others.length) return { t: "bring", item: pick(BRING_POOL), n: 1, exp: dayStamp() + 1 };
    const to = pick(others);
    return { t: "deliver", to: to.id, exp: dayStamp() + 1 };
  }
  const ROOM_THEMES = { sea: "beach", fish: "seaside", bug: "bug museum", flower: "garden", food: "kitchen", fruit: "orchard café", material: "workshop", furniture: "showroom", misc: "cozy" };
  function questText(q, fromV) {
    if (!q) return "";
    if (q.t === "bring") {
      if (q.cat && q.villa) return `bring 2× ${q.cat} things for my dream ${ROOM_THEMES[q.cat] || q.cat} room!`;
      if (q.cat) return `bring ${q.n}× any ${q.cat === "sea" ? "sea creature" : q.cat} item`;
      const d = DH.items.get(q.item) || { name: q.item, ico: "📦" };
      return `bring ${q.n}× ${d.ico} ${d.name}`;
    }
    const to = findV(q.to);
    return `deliver a 📦 parcel to ${to ? to.name : "a friend"} (for ${fromV ? fromV.name : "?"})`;
  }
  function questReady(v) {
    const q = v.quest;
    if (!q || q.t !== "bring") return false;
    if (q.cat) return countCat(q.cat) >= q.n;
    return DH.inv.count(q.item) >= q.n;
  }
  function countCat(cat) {
    return DH.inv.list().reduce((s, sl) => s + ((DH.items.get(sl.id) || {}).cat === cat ? sl.n : 0), 0);
  }

  // ---------- villager menu ----------
  function openVillagerMenu(v, p) {
    const rows = [];
    if (v.quest && questReady(v))
      rows.push({ ico: "✅", label: `Here's what you asked for!`, cb: () => API.completeQuest(v.id) });
    const parcelTo = S.vils.find(o => o.quest && o.quest.t === "deliver" && o.quest.to === v.id);
    if (parcelTo && DH.inv.count("parcel") > 0)
      rows.push({ ico: "📦", label: `Deliver ${parcelTo.name}'s parcel`, cb: () => API.deliver(parcelTo.id, v.id) });
    if (v.offer)
      rows.push({ ico: "❗", label: "What's up?", cb: () => API.acceptQuest(v.id) });
    rows.push({ ico: "💬", label: "Chat", cb: () => API.talk(v.id) });
    rows.push({ ico: "🎁", label: "Give a gift", cb: () => openGiftMenu(v) });
    if (S.learned.length)
      rows.push({ ico: "🎭", label: "React", cb: () => openReactMenu(p) });
    const heartsN = Math.floor(v.hearts || 0);
    rows.push({ ico: "💗", label: `Friendship ${"♥".repeat(Math.min(10, heartsN)) || "—"} ${v.hearts.toFixed(1)}/10`, disabled: true, cb() {} });
    const tag = (isBday(v) ? " 🎂" : "") + (v.mode === "sleep" ? " 💤" : "");
    DH.menu.open(`${SPECIES_ICO[v.species] || "🐾"} ${v.name}${tag}`, rows);
  }

  function openGiftMenu(v) {
    const list = DH.inv.list();
    if (!list.length) { DH.toast("Your pockets are empty — grab something first! 🎁"); return; }
    const rows = list.map(sl => {
      const d = DH.items.get(sl.id) || { name: sl.id, ico: "📦", cat: "misc", price: 0 };
      const mark = v.likes.includes(d.cat) ? " ♥" : v.dislikes.includes(d.cat) ? " 💢" : "";
      return { ico: d.ico, label: `${d.name} ×${sl.n}${mark}`, cb: () => API.giveGift(v.id, sl.id) };
    });
    DH.menu.open(`🎁 Gift for ${v.name}`, rows);
  }

  function openReactMenu(p) {
    DH.menu.open("🎭 React!", S.learned.map(k => ({
      ico: "✨", label: RX_LABEL[k] || k,
      cb: () => API.react(p.pid, k),
    })));
  }

  function openCamperMenu(c) {
    const rows = [
      { ico: "💬", label: "Chat", cb: () => DH.toast(`${c.name}: "${pick(CAMPER_LINES)} ${c.phrase}"`, 3200) },
      { ico: "🏡", label: `Ask ${c.name} to move in`, cb: () => API.inviteCamper() },
    ];
    DH.menu.open(`⛺ ${SPECIES_ICO[c.species] || "🐾"} ${c.name} (camper)`, rows);
  }

  // ---------- letterbox (H-6) ----------
  const LETTER_TPL = [
    "Thinking of you! Stay awesome.",
    "Thanks for being a great neighbor!",
    "Let's be friends forever, okay?",
    "Your smile makes my whole day!",
    "Come wander the garden with me sometime!",
  ];
  const REPLIES = {
    genki: ["OMG OMG a LETTER!! For ME?! Best!! Day!! EVER!!", "I read it out loud to the flowers — they loved it too!!"],
    exe: ["A letter! From YOU! I did fifty push-ups to celebrate!!", "Your letter is now my training motivation. Frame-worthy!"],
    bigsis: ["That's so sweet of you, hon. You've got a good heart.", "Aww. I'm keeping this one in my pocket forever."],
    lazy: ["thanks for the letter… I read it twice, then napped on it", "a letter! wow… I'll reply with snacks someday…"],
  };
  function openLetterbox() {
    const rows = [];
    if (S.mail.length)
      rows.push({ ico: "📮", label: `<b>Read mail</b> — ${S.mail.length} waiting!`, cb: openMail });
    rows.push({ ico: "✉️", label: "Write a letter", cb: pickLetterVillager });
    rows.push({ ico: "📬", label: `${S.outbox.length} sent · replies tomorrow`, disabled: true, cb() {} });
    DH.menu.open("💌 Letter box", rows);
  }
  function pickLetterVillager() {
    if (!S.vils.length) { DH.toast("No villagers to write to!"); return; }
    DH.menu.open("✉️ To whom?", S.vils.map(v => ({
      ico: SPECIES_ICO[v.species] || "🐾", label: v.name,
      cb: () => pickLetterTpl(v),
    })));
  }
  function pickLetterTpl(v) {
    DH.menu.open(`✉️ To ${v.name}`, LETTER_TPL.map(t => ({
      ico: "📝", label: `"${t}"`, cb: () => pickLetterGift(v, t),
    })));
  }
  function pickLetterGift(v, text) {
    const rows = DH.inv.list().map(sl => {
      const d = DH.items.get(sl.id) || { name: sl.id, ico: "📦" };
      return { ico: d.ico, label: `Attach ${d.name} ×${sl.n}`, cb: () => API.writeLetter(v.id, text, sl.id) };
    });
    rows.unshift({ ico: "✉️", label: "<b>No gift — just the letter</b>", cb: () => API.writeLetter(v.id, text, null) });
    DH.menu.open("🎀 Attach a gift?", rows);
  }
  function openMail() {
    const rows = S.mail.map(l => {
      const from = findV(l.from) || { name: "?" };
      return { ico: "💌", label: `From ${from.name}`, cb: () => API.readLetter(l.id) };
    });
    if (!rows.length) { DH.toast("No mail today 📭"); return; }
    DH.menu.open("📬 You've got mail!", rows);
  }

  // ---------- mutations (remote-callable API) ----------
  const API = {
    talk(id) {
      const v = findV(id);
      if (!v || !gs) return false;
      const ds = dayStamp();
      if (v.talkDay !== ds) {
        v.talkDay = ds; v.lastTalk = ds; v.warnDay = -1;
        addHearts(v, 1);
      }
      if (v.mode === "sleep") { v.mode = "idle"; v.wait = rnd(1, 2); }
      v.em = null; v.bub = null;
      const line = chatLine(v);
      DH.toast(`${v.name}: "${line} ${v.phrase}"`, 3600);
      alog("vchat", v.name);
      // high friendship perks (H-2/H-9): portrait + signature reaction
      if (v.hearts >= RX_TEACH && !v.rxTaught) {
        v.rxTaught = true;
        const rx = RX_OF[v.per] || "joy";
        if (!S.learned.includes(rx)) S.learned.push(rx);
        emote(v, "love", 3);
        DH.toast(`${v.name} taught you the ${RX_LABEL[rx]} reaction! 🎭`, 3400);
      }
      if (v.hearts >= PIC_HEARTS && !v.pic) {
        v.pic = true;
        defPortrait(v);
        DH.inv.add("pic-" + v.id, 1);
        hearts(v.x, v.y, 4);
        DH.toast(`${v.name} gave you their portrait! 🖼️`, 3400);
      }
      return true;
    },

    giveGift(id, itemId) {
      const v = findV(id);
      if (!v || !gs) return false;
      const d = DH.items.get(itemId) || { name: itemId, ico: "📦", cat: "misc", price: 0 };
      if (!DH.inv.remove(itemId, 1)) { DH.toast("You don't have that anymore!"); return false; }
      const bday = isBday(v);
      let delta, em;
      if (v.likes.includes(d.cat)) { delta = 2; em = "love"; }
      else if (v.dislikes.includes(d.cat)) { delta = -0.5; em = "mad"; }
      else { delta = 0.5; em = "wow"; }
      if (bday) delta += 2;
      addHearts(v, delta);
      emote(v, em, 2.6);
      addHappy(bday ? 2 : 1);
      const taste = em === "love" ? "LOVES it!" : em === "mad" ? "…not really their taste ☹️" : "likes it!";
      DH.toast(`${v.name} ${taste}${bday ? " Birthday bonus! 🎂" : ""}`, 2800);
      alog("vgift", `${v.name}:${d.cat}`);
      if (em === "love" && Math.random() < 0.3) {
        const back = pick(Object.values(DH.items.defs).filter(x => v.likes.includes(x.cat) && x.price > 0 && x.id !== itemId));
        if (back && DH.inv.add(back.id, 1)) DH.toast(`${v.name} gave you ${back.ico} ${back.name} back! 🎀`, 2800);
      }
      return true;
    },

    acceptQuest(id) {
      const v = findV(id);
      if (!v || !v.offer) return false;
      v.quest = v.offer; v.offer = null;
      if (v.quest.t === "deliver") DH.inv.add("parcel", 1);
      emote(v, "wow", 2);
      DH.toast(`${v.name}: "Could you ${questText(v.quest, v)}? ${v.phrase}"`, 4200);
      alog("vquest", v.name);
      return true;
    },

    completeQuest(id) {
      const v = findV(id);
      if (!v || !v.quest || !questReady(v)) return false;
      const q = v.quest, villa = !!q.villa;
      if (q.cat) removeCat(q.cat, q.n); else DH.inv.remove(q.item, q.n);
      v.quest = null;
      addHearts(v, villa ? 3 : 2);
      const pay = villa ? 260 : 90;
      gs.coins += pay;
      addHappy(2);
      emote(v, "joy", 3); hearts(v.x, v.y, 3);
      DH.toast(villa
        ? `${v.name}: "My dream room is coming true! Thank you!!" +🪙${pay}`
        : `${v.name}: "You did it!! You're the best!" +🪙${pay}`, 3600);
      alog(villa ? "vvilla" : "vquestdone", v.name);
      return true;
    },

    deliver(fromId, toId) {
      const from = findV(fromId), to = findV(toId);
      if (!from || !to || !from.quest || from.quest.t !== "deliver") return false;
      if (!DH.inv.remove("parcel", 1)) return false;
      from.quest = null;
      addHearts(from, 2); addHearts(to, 1.5);
      gs.coins += 120;
      addHappy(2);
      emote(to, "love", 2.6); hearts(to.x, to.y, 3);
      DH.toast(`${to.name}: "Ooh, a parcel from ${from.name}?!" +🪙120`, 3400);
      alog("vdeliver", `${from.name}→${to.name}`);
      return true;
    },

    writeLetter(toId, text, giftId) {
      const v = findV(toId);
      if (!v || !gs) return false;
      if (giftId && !DH.inv.remove(giftId, 1)) { DH.toast("You don't have that anymore!"); return false; }
      S.outbox.push({ id: "l" + (S.nextId++), toId, text, gift: giftId || null, replyDay: dayStamp() + 1 });
      DH.toast(`Letter sent to ${v.name}! 💌 They'll write back tomorrow.`, 3000);
      alog("vletter", v.name);
      return true;
    },

    readLetter(id) {
      const i = S.mail.findIndex(l => l.id === id);
      if (i < 0) return false;
      const l = S.mail.splice(i, 1)[0];
      const from = findV(l.from) || { name: "an old friend", phrase: "" };
      let extra = "";
      if (l.gift) extra = ` (they kept the gift close ♥)`;
      if (l.back && DH.inv.add(l.back, 1)) {
        const d = DH.items.get(l.back) || { name: l.back };
        extra += ` Attached: ${d.ico} ${d.name}!`;
      }
      DH.toast(`💌 ${from.name}: "${l.text}"${extra}`, 5200);
      alog("vmail", from.name);
      return true;
    },

    inviteCamper() {
      const c = S.camper;
      if (!c) return false;
      if (S.vils.length >= MAX_ROSTER) { DH.toast("The village is full right now!"); return false; }
      c.hearts = 2; c.moveIn = dayStamp(); c.lastTalk = dayStamp();
      S.vils.push(c); S.camper = null; S.campDay = -1;
      confetti(c.x, c.y, 18); emote(c, "joy", 3);
      addHappy(4);
      DH.toast(`🎉 ${c.name} moved in! Say hi when you see them!`, 4000);
      alog("vmovein", c.name);
      return true;
    },

    react(pid, k) {
      if (!S.learned.includes(k)) return false;
      const p = (gs.players || [])[pid] || gs.players[0];
      if (!p) return false;
      S.pfx[pid] = { k, t: 2.4, x: p.x, y: p.y };
      return true;
    },
  };

  function addHearts(v, n) { v.hearts = clamp((v.hearts || 0) + n, 0, 10); }
  function removeCat(cat, n) {
    for (const sl of DH.inv.list().slice()) {
      if (n <= 0) break;
      const d = DH.items.get(sl.id) || {};
      if (d.cat !== cat) continue;
      n -= DH.inv.remove(sl.id, Math.min(sl.n, n));
    }
  }

  // ---------- new-day housekeeping ----------
  function newDay(ds) {
    // expire quests & offers (H-4: one game-day to finish)
    for (const v of S.vils) {
      v.offer = null;
      if (v.quest && (v.quest.exp || 0) <= ds) {
        v.quest = null;
        DH.toast(`${v.name}'s request slipped by… maybe next time 🍃`, 3000);
        addHearts(v, -0.5);
      }
    }
    // letters arrive (H-6)
    const due = S.outbox.filter(l => l.replyDay <= ds);
    S.outbox = S.outbox.filter(l => l.replyDay > ds);
    for (const l of due) {
      const v = findV(l.toId);
      const giftHearts = l.gift && v ? (v.likes.includes((DH.items.get(l.gift) || {}).cat) ? 2 : 1) : 0;
      if (v) addHearts(v, 1 + giftHearts);
      const back = Math.random() < 0.3 ? pick(["apple", "shell", "mushroom"]) : null;
      S.mail.push({ id: "r" + (S.nextId++), from: l.toId, text: pick(REPLIES[(v && v.per) || "lazy"]), gift: !!l.gift, back });
    }
    if (due.length) DH.toast(`📬 ${due.length} letter${due.length > 1 ? "s" : ""} arrived at the letterbox!`, 3600);

    // camper visit (H-7)
    if (S.campDay !== ds) { S.camper = null; S.campDay = -1; }
    if (ds % CAMP_MOD === CAMP_ON && S.vils.length < MAX_ROSTER && !S.camper && Math.random() < 0.7)
      spawnCamper(ds);

    // birthdays (H-5)
    for (const v of S.vils)
      if (isBday(v)) {
        confetti(v.x, v.y, 20); emote(v, "joy", 4);
        DH.toast(`🎂 It's ${v.name}'s birthday! Give them a gift for bonus friendship!`, 4200);
      }

    // dream-villa job (H-10): weekly themed wishlist
    if (ds % VILLA_MOD === VILLA_ON && S.vils.length) {
      const v = pick(S.vils);
      if (!v.offer && !v.quest) {
        const cat = pick(v.likes.length ? v.likes : ["misc"]);
        v.offer = { t: "bring", cat, n: 2, exp: ds + 1, villa: true };
      }
    }
    // ordinary daily requests (H-4)
    for (const v of S.vils)
      if (!v.offer && !v.quest && v.hearts < 9.5 && Math.random() < QUEST_CHANCE)
        v.offer = makeQuest(v);

    // gentle neglect → move-out (H-7)
    for (const v of S.vils.slice()) {
      if (v.hearts > 1 || v.moveIn + 3 > ds) continue;
      if (v.warnDay < 0) {
        v.warnDay = ds;
        DH.toast(`💭 ${v.name} seems a little lonely lately… go say hi?`, 4200);
      } else if (ds >= v.warnDay + 3 && S.vils.length > 1) {
        S.vils = S.vils.filter(o => o.id !== v.id);
        DH.toast(`${v.name} moved away to a new adventure… maybe you'll meet again 🍃`, 4800);
        alog("vmoveout", v.name);
      }
    }
  }

  function spawnCamper(ds) {
    const pool = CAMPERS.filter(c => !S.vils.some(v => v.name === c.name));
    if (!pool.length) return;
    const def = pick(pool);
    const c = makeVillager(def, "v" + (S.nextId++));
    c.x = TENT.x + rnd(-30, 30); c.y = TENT.y + rnd(-8, 24);
    c.camp = true;
    S.camper = c; S.campDay = ds;
    DH.toast(`⛺ A camper is visiting the yard tent — go say hi!`, 4200);
    alog("vcamper", def.name);
  }

  // ---------- wander AI (host only) ----------
  function wanderV(v, dt, home) {
    if (v.mode === "sleep") { v.moving = false; return; }
    if (v.mode === "sit" || v.mode === "sniff") {
      v.moving = false; v.wait -= dt;
      if (v.mode === "sniff" && Math.random() < dt * 0.8) emote(v, "love", 1.6);
      if (v.wait <= 0) { v.mode = "idle"; v.wait = rnd(0.6, 2); }
      return;
    }
    if (v.mode === "idle") {
      v.moving = false; v.wait -= dt;
      if (v.wait > 0) return;
      // choose next activity
      if (isNight() && Math.random() < (v.camp || home ? 0.35 : 0.3)) { v.mode = "sleep"; return; }
      if (!v.camp && Math.random() < 0.14) { v.mode = "sit"; v.wait = rnd(3, 6); return; }
      if (!v.camp && zoneOf(v.x, v.y) === "garden" && Math.random() < 0.3) { v.mode = "sniff"; v.wait = rnd(2, 4); return; }
      // pick a target — campers stay near the tent; villagers roam yard+garden
      if (v.camp) {
        v.tx = TENT.x + rnd(-70, 70); v.ty = TENT.y + rnd(-20, 60);
      } else {
        const cur = zoneOf(v.x, v.y);
        const dest = Math.random() < 0.66 ? cur : (cur === "yard" ? "garden" : "yard");
        const tiles = walkTiles(dest === "pasture" || dest === "pond" || dest === "house" ? "yard" : dest);
        let goal = pick(tiles);
        for (let i = 0; i < 5; i++) { const g = pick(tiles); if (dist2(g.x, g.y, v.x, v.y) < dist2(goal.x, goal.y, v.x, v.y)) goal = g; }
        v.tx = goal.x + rnd(-9, 9); v.ty = goal.y + rnd(-9, 9);
      }
      v.mode = "walk"; v.stuckT = 0;
      if (Math.random() < 0.2) bubble(v, v.phrase, 2.2);
      return;
    }
    // mode === "walk"
    const dx = v.tx - v.x, dy = v.ty - v.y, d = Math.hypot(dx, dy);
    if (d < 4) { v.mode = "idle"; v.wait = rnd(1, 3.5); v.moving = false; return; }
    const sp = SPEED * dt;
    const nx = v.x + (dx / d) * sp, ny = v.y + (dy / d) * sp;
    let moved = false;
    if (DH.world.canStand(nx, v.y)) { v.x = nx; moved = true; }
    if (DH.world.canStand(v.x, ny)) { v.y = ny; moved = true; }
    if (!moved) {
      v.stuckT += dt;
      if (v.stuckT > 0.4) { v.mode = "idle"; v.wait = rnd(0.5, 1.5); v.moving = false; }
    }
    v.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up");
    v.moving = true; v.step += dt * 6;
  }

  // ---------- contract ----------
  const M = (DH.villagers = {
    authority: true,
    _state: S,

    init(state) {
      gs = state;
      M.authority = !(DH.net && DH.net.online && DH.net.role === "guest");
      ctx2 = document.getElementById("cv").getContext("2d");
    },

    start(state) {
      gs = state;
      M.authority = !(DH.net && DH.net.online && DH.net.role === "guest");
      S.fx = []; S.pfx = {};
      if (!S.vils.length) freshRoster();
      for (const v of S.vils) defPortrait(v);
      saveT = 0;
    },

    offline(offMin) {
      const parts = [];
      const offDays = Math.floor(offMin / DAY_MIN);
      if (offDays >= 1 && S.outbox.length) {
        const ds = dayStamp();
        const due = S.outbox.filter(l => l.replyDay <= ds + offDays);
        if (due.length) {
          S.outbox = S.outbox.filter(l => l.replyDay > ds + offDays);
          for (const l of due)
            S.mail.push({ id: "r" + (S.nextId++), from: l.toId, text: pick(REPLIES.lazy), gift: !!l.gift, back: null });
          parts.push(`${due.length} letter${due.length > 1 ? "s" : ""} arrived 💌`);
        }
      }
      if (S.vils.length) parts.push(`${pick(S.vils).name} wondered where you were 🐾`);
      return parts;
    },

    update(dt, state) {
      gs = state;
      // FX + bubbles always tick (guests render snapshots but stay lively)
      for (const f of S.fx) { f.age += dt; f.x += f.vx * dt; f.y += f.vy * dt; if (f.k === "conf") f.vy += 26 * dt; }
      S.fx = S.fx.filter(f => f.age < f.ttl);
      for (const v of S.vils.concat(S.camper ? [S.camper] : [])) {
        if (v.bub && (v.bub.t -= dt) <= 0) v.bub = null;
        if (v.em && (v.em.t -= dt) <= 0) v.em = null;
      }
      for (const k in S.pfx) { const e = S.pfx[k]; if ((e.t -= dt) <= 0) delete S.pfx[k]; }
      if (!M.authority) return;

      const ds = dayStamp();
      if (ds !== S.dayStamp) { S.dayStamp = ds; newDay(ds); }

      saveT += dt;
      if (saveT >= SAVE_EVERY) { saveT = 0; DH.save.now(); }

      for (const v of S.vils) wanderV(v, dt, false);
      if (S.camper) wanderV(S.camper, dt, true);
    },

    interactables(p) {
      const out = [];
      // letterbox — placed east of home.js's mailbox so neither shadows the other
      const dB = dist2(p.x, p.y, BOX.x, BOX.y);
      if (dB < 40 * 40)
        out.push({ label: `Letter box 📮${S.mail.length ? " ×" + S.mail.length : ""}`, x: BOX.x, y: BOX.y, d2: dB, action: openLetterbox });
      if (S.camper) {
        const c = S.camper;
        const dC = dist2(p.x, p.y, c.x, c.y);
        if (dC < INTERACT_R * INTERACT_R)
          out.push({ label: `Say hi to ${c.name} ⛺`, x: c.x, y: c.y, d2: dC, action: () => openCamperMenu(c) });
      }
      for (const v of S.vils) {
        const d = dist2(p.x, p.y, v.x, v.y);
        if (d >= INTERACT_R * INTERACT_R) continue;
        const mark = v.offer ? " ❗" : isBday(v) ? " 🎂" : v.mode === "sleep" ? " 💤" : "";
        out.push({ label: `Talk to ${v.name}${mark}`, x: v.x, y: v.y, d2: d, action: () => openVillagerMenu(v, p) });
      }
      out.sort((a, b) => a.d2 - b.d2);
      return out;
    },

    collectDraws(draws, camX, camY) {
      draws.push({ y: TENT.y + 10, fn: () => drawTent(ctx2, TENT.x - camX, TENT.y - camY) });
      draws.push({ y: BOX.y + 10, fn: () => drawLetterbox(ctx2, BOX.x - camX, BOX.y - camY, S.mail.length > 0) });
      for (const v of S.vils)
        draws.push({ y: v.y, fn: () => { DH.sprites.shadow(ctx2, v.x - camX, v.y - camY, 16); drawVillager(ctx2, v, v.x - camX, v.y - camY); } });
      if (S.camper) {
        const c = S.camper;
        draws.push({ y: c.y, fn: () => { DH.sprites.shadow(ctx2, c.x - camX, c.y - camY, 16); drawVillager(ctx2, c, c.x - camX, c.y - camY); } });
      }
    },

    drawOverlay(ctx, camX, camY, state) {
      ctx2 = ctx;
      const all = S.vils.concat(S.camper ? [S.camper] : []);
      for (const v of all) {
        const sx = v.x - camX, sy = v.y - camY;
        const topY = sy - 36;
        if (v.mode === "sleep") drawZzz(ctx, sx, topY);
        else if (v.em) drawEmote(ctx, sx, topY - 2, v.em.k);
        else if (v.offer) drawEmote(ctx, sx, topY - 2, "!");
        else if (v.bub) drawSpeech(ctx, sx, topY - 2, v.bub.txt);
        else if (isBday(v)) drawEmote(ctx, sx, topY - 2, "bday");
        const near = (state.players || []).some(pp => dist2(pp.x, pp.y, v.x, v.y) < 58 * 58);
        if (near) {
          ctx.font = "bold 9px sans-serif"; ctx.textAlign = "center";
          ctx.fillStyle = "#00000066"; ctx.fillText(v.name, sx + 1, topY - 9);
          ctx.fillStyle = "#ffffffee"; ctx.fillText(v.name, sx, topY - 10);
        }
      }
      // player reaction bubbles (H-9)
      for (const k in S.pfx) {
        const e = S.pfx[k], p = (state.players || [])[k];
        if (p) { e.x = p.x; e.y = p.y; }
        drawEmote(ctx, e.x - camX, e.y - camY - 38, e.k);
      }
      for (const f of S.fx) {
        const a = Math.max(0, 1 - f.age / f.ttl);
        ctx.save(); ctx.globalAlpha = a;
        if (f.k === "heart") DH.sprites.heart(ctx, f.x - camX, f.y - camY, 5);
        else { ctx.fillStyle = f.c || "#ffd76b"; ctx.fillRect(f.x - camX - 1.5, f.y - camY - 1.5, 3, 3); }
        ctx.restore();
      }
    },

    // ----- sync boundary -----
    serialize() {
      return JSON.parse(JSON.stringify({
        vils: S.vils, camper: S.camper, campDay: S.campDay,
        mail: S.mail, outbox: S.outbox, learned: S.learned,
        dayStamp: S.dayStamp, nextId: S.nextId,
      }));
    },
    deserialize(d) {
      if (!d || typeof d !== "object") return;
      if (Array.isArray(d.vils)) S.vils = d.vils.map(fixV);
      S.camper = d.camper ? fixV(d.camper) : null;
      if (typeof d.campDay === "number") S.campDay = d.campDay;
      if (Array.isArray(d.mail)) S.mail = d.mail;
      if (Array.isArray(d.outbox)) S.outbox = d.outbox;
      if (Array.isArray(d.learned)) S.learned = d.learned;
      if (typeof d.dayStamp === "number") S.dayStamp = d.dayStamp;
      if (typeof d.nextId === "number") S.nextId = d.nextId;
      for (const v of S.vils) defPortrait(v);
    },
    remoteAction(name, args) {
      const fn = API[name];
      return typeof fn === "function" ? fn.apply(null, args || []) : false;
    },

    // exposed for remoteAction + console/testing
    talk: API.talk, giveGift: API.giveGift, acceptQuest: API.acceptQuest,
    completeQuest: API.completeQuest, deliver: API.deliver, react: API.react,
    writeLetter: API.writeLetter, readLetter: API.readLetter, inviteCamper: API.inviteCamper,
    openVillagerMenu, openLetterbox, spawnCamper, newDay,
  });

  // ---------- drawing ----------
  const R = (ctx, x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };

  // chibi villager base + species features (flat fills, ~30px tall, feet at 0,0)
  function drawVillager(ctx, v, x, y) {
    ctx.save(); ctx.translate(x, y);
    if (v.mode === "sleep") ctx.scale(1.1, 0.72);
    else if (v.mode === "sit" || v.mode === "sniff") ctx.scale(1.04, 0.84);
    else if (v.moving) ctx.translate(0, -Math.abs(Math.sin(v.step * Math.PI * 2)) * 1.4);
    ctx.scale(v.dir === "left" ? -1 : 1, 1);
    switch (v.species) {
      case "rabbit": drawRabbit(ctx); break;
      case "bear": drawBear(ctx); break;
      case "bird": drawBird(ctx); break;
      case "fox": drawFox(ctx); break;
      case "squirrel": drawSquirrel(ctx); break;
      case "deer": drawDeer(ctx); break;
      case "penguin": drawPenguin(ctx); break;
      case "cat": drawCat(ctx); break;
      default: drawBear(ctx);
    }
    if (isBday(v)) { // party hat
      ctx.fillStyle = "#e05b8a";
      ctx.beginPath(); ctx.moveTo(-4, -31); ctx.lineTo(4, -31); ctx.lineTo(0, -40); ctx.closePath(); ctx.fill();
      R(ctx, -1, -41, 2, 2, "#ffd76b"); R(ctx, -2, -34, 1.5, 1.5, "#ffd76b"); R(ctx, 1, -30, 1.5, 1.5, "#5bc8d0");
    }
    ctx.restore();
  }

  function chibi(ctx, body, belly, leg) {
    R(ctx, -5, -7, 4, 7, leg); R(ctx, 1, -7, 4, 7, leg);          // legs
    R(ctx, -8, -18, 16, 12, body);                                // body
    R(ctx, -6, -18, 12, 5, belly);                                // chest patch
    R(ctx, -10, -17, 3, 8, body); R(ctx, 7, -17, 3, 8, body);     // arms
    R(ctx, -8, -30, 16, 13, body);                                // head
    R(ctx, -3, -22, 6, 3, belly);                                 // muzzle
    R(ctx, -4, -26, 2, 3, "#1a1a1a"); R(ctx, 3, -26, 2, 3, "#1a1a1a"); // eyes
    R(ctx, -4, -26, 1, 1, "#ffffff88"); R(ctx, 3, -26, 1, 1, "#ffffff88");
    R(ctx, -1, -21, 2, 1, "#8a5a44");                             // nose
  }
  function drawRabbit(ctx) {
    R(ctx, -6, -38, 4, 9, "#f4f0ea"); R(ctx, 2, -38, 4, 9, "#f4f0ea");   // long ears
    R(ctx, -5, -36, 2, 5, "#f0b8c8"); R(ctx, 3, -36, 2, 5, "#f0b8c8");
    chibi(ctx, "#f4f0ea", "#ffffff", "#d8d0c8");
    R(ctx, -9, -10, 3, 3, "#ffffff");                                    // cotton tail
  }
  function drawBear(ctx) {
    R(ctx, -8, -32, 5, 5, "#8a5f38"); R(ctx, 3, -32, 5, 5, "#8a5f38");   // round ears
    R(ctx, -7, -31, 3, 3, "#b08050"); R(ctx, 4, -31, 3, 3, "#b08050");
    chibi(ctx, "#b08050", "#e0c8a0", "#7a5530");
  }
  function drawBird(ctx) {
    R(ctx, -2, -34, 4, 5, "#5ba3e0");                                    // head tuft
    chibi(ctx, "#7ec8e3", "#f4f8fa", "#e0a030");
    R(ctx, -1, -22, 3, 2, "#f0a030");                                    // beak over muzzle
    R(ctx, -10, -16, 3, 6, "#5ba3e0"); R(ctx, 7, -16, 3, 6, "#5ba3e0");  // wings
  }
  function drawFox(ctx) {
    R(ctx, -8, -34, 4, 6, "#c06828"); R(ctx, 4, -34, 4, 6, "#c06828");   // pointy ears
    chibi(ctx, "#e8893a", "#f8f0e0", "#8a5020");
    R(ctx, -4, -23, 8, 4, "#f8f0e0");                                    // muzzle
    R(ctx, 9, -12, 6, 5, "#e8893a"); R(ctx, 13, -12, 2, 3, "#f8f0e0");   // fluffy tail
  }
  function drawSquirrel(ctx) {
    R(ctx, -7, -33, 4, 5, "#c08048"); R(ctx, 3, -33, 4, 5, "#c08048");
    chibi(ctx, "#c08048", "#f0d8b0", "#8a5a30");
    R(ctx, -14, -18, 5, 12, "#a06838"); R(ctx, -14, -20, 5, 4, "#c08048"); // big tail
  }
  function drawDeer(ctx) {
    R(ctx, -8, -33, 4, 5, "#a07848"); R(ctx, 4, -33, 4, 5, "#a07848");   // ears
    R(ctx, -7, -37, 2, 4, "#7a5527"); R(ctx, 5, -37, 2, 4, "#7a5527");   // antlers
    R(ctx, -8, -35, 3, 2, "#7a5527"); R(ctx, 5, -35, 3, 2, "#7a5527");
    chibi(ctx, "#c8a068", "#f0e0c0", "#8a6a40");
    R(ctx, -9, -9, 3, 3, "#f0e0c0");                                     // tail
  }
  function drawPenguin(ctx) {
    chibi(ctx, "#3a4a5a", "#f4f8fa", "#e0a030");
    R(ctx, -4, -24, 8, 5, "#f4f8fa");                                    // face patch
    R(ctx, -1, -21, 2, 2, "#f0a030");                                    // beak
    R(ctx, -10, -16, 3, 7, "#2a3644"); R(ctx, 7, -16, 3, 7, "#2a3644");   // flippers
  }
  function drawCat(ctx) {
    R(ctx, -8, -33, 4, 5, "#787888"); R(ctx, 4, -33, 4, 5, "#787888");   // ears
    R(ctx, -7, -32, 2, 2, "#e8a0a8"); R(ctx, 5, -32, 2, 2, "#e8a0a8");
    chibi(ctx, "#9a9aa5", "#e8e8ec", "#6a6a75");
    R(ctx, 9, -11, 3, 6, "#9a9aa5");                                     // tail
    R(ctx, -6, -23, 2, 1, "#5a5a65"); R(ctx, 4, -23, 2, 1, "#5a5a65");    // whisker marks
  }

  // campsite tent — striped A-frame
  function drawTent(ctx, x, y) {
    ctx.fillStyle = "#e8b04a";
    ctx.beginPath(); ctx.moveTo(x - 26, y); ctx.lineTo(x, y - 30); ctx.lineTo(x + 26, y); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#c88a30";
    ctx.beginPath(); ctx.moveTo(x - 14, y); ctx.lineTo(x, y - 30); ctx.lineTo(x + 14, y); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#5a4020"; // open flap
    ctx.beginPath(); ctx.moveTo(x - 6, y); ctx.lineTo(x, y - 16); ctx.lineTo(x + 6, y); ctx.closePath(); ctx.fill();
    R(ctx, x - 28, y - 2, 56, 3, "#9a6a28");          // ground skirt
    R(ctx, x - 1, y - 32, 2, 5, "#7a5527");           // flag pole
    R(ctx, x + 1, y - 32, 7, 4, "#e05b5b");           // flag
  }

  // blue letterbox on a post (flag up = mail waiting)
  function drawLetterbox(ctx, x, y, flag) {
    R(ctx, x - 2, y - 12, 4, 14, "#6e4a2a");
    R(ctx, x - 8, y - 22, 16, 11, "#3a6fd8");
    R(ctx, x - 8, y - 22, 16, 3, "#5a8fe8");
    R(ctx, x - 8, y - 13, 16, 2, "#2a55b0");
    R(ctx, x - 5, y - 19, 6, 4, "#f2d9d0");           // envelope slit
    R(ctx, x + 5, y - 27, 2, 6, "#888");              // flag pole
    if (flag) R(ctx, x + 5, y - 27, 6, 4, "#e04848"); // raised flag
    else R(ctx, x + 5, y - 23, 5, 3, "#b0b8c0");
  }

  // ---------- bubbles ----------
  function bubbleBase(ctx, x, y, w, h) {
    ctx.fillStyle = "#ffffffee";
    ctx.fillRect(x - w / 2, y - h, w, h);
    ctx.fillRect(x - w / 2 + 2, y - h - 2, w - 4, 2);
    ctx.fillRect(x - w / 2 + 2, y, w - 4, 2);
    ctx.fillRect(x - 2, y + 2, 4, 4);                  // tail
  }
  function drawEmote(ctx, x, y, k) {
    bubbleBase(ctx, x, y, 22, 16);
    if (k === "love" || k === "bday") DH.sprites.heart(ctx, x, y - 7, 5.5);
    else if (k === "!") { R(ctx, x - 1.5, y - 13, 3, 7, "#e04848"); R(ctx, x - 1.5, y - 4, 3, 3, "#e04848"); }
    else if (k === "wow") { R(ctx, x - 1.5, y - 13, 3, 7, "#3a6fd8"); R(ctx, x - 1.5, y - 4, 3, 3, "#3a6fd8"); }
    else if (k === "joy") {
      ctx.fillStyle = "#ffd76b"; ctx.beginPath(); ctx.arc(x, y - 8, 5, 0, 7); ctx.fill();
      R(ctx, x - 3, y - 10, 2, 1.5, "#5a3a1a"); R(ctx, x + 1, y - 10, 2, 1.5, "#5a3a1a");
      ctx.beginPath(); ctx.arc(x, y - 7, 3, 0, Math.PI); ctx.fill();
      ctx.fillStyle = "#7ec8e3"; ctx.beginPath(); ctx.arc(x + 6, y - 11, 1.8, 0, 7); ctx.fill();
    }
    else if (k === "mad") {
      ctx.fillStyle = "#e04848";
      for (const [ox, oy] of [[0, -14], [6, -9], [0, -4], [-6, -9]]) {
        ctx.beginPath(); ctx.arc(x + ox, y + oy, 2.4, 0, 7); ctx.fill();
      }
    }
    else if (k === "zzz") drawZzz(ctx, x - 2, y);
    else if (k === "?") { ctx.fillStyle = "#8a8a95"; ctx.font = "bold 10px sans-serif"; ctx.textAlign = "center"; ctx.fillText("?", x, y - 4); }
  }
  function drawSpeech(ctx, x, y, txt) {
    ctx.font = "bold 8px sans-serif";
    const w = Math.max(20, ctx.measureText(txt).width + 8);
    bubbleBase(ctx, x, y, w, 13);
    ctx.fillStyle = "#4a3a2a"; ctx.textAlign = "center";
    ctx.fillText(txt, x, y - 4);
  }
  function drawZzz(ctx, x, y) {
    ctx.font = "bold 8px sans-serif"; ctx.textAlign = "center";
    ctx.fillStyle = "#dfe8ff";
    ctx.fillText("z", x + 3, y - 2);
    ctx.font = "bold 6px sans-serif";
    ctx.fillText("z", x + 7, y - 7);
  }
})();

DH.register("villagers", DH.villagers);
