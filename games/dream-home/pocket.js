/* dream-home pocket module — Pocket Camp systems (spec O-1,O-2,O-3,O-4,O-6).
   Contract with game.js (self-registers via DH.register at the bottom):
     DH.pocket.init(state) / start(state) / update(dt,state)
     DH.pocket.drawGround(ctx,camX,camY,state) — event meadow + event flowers
     DH.pocket.collectDraws(draws,camX,camY) — project bench, campsite, event board, guest
     DH.pocket.drawOverlay(ctx,camX,camY,state) — request markers, event bugs, FX
     DH.pocket.interactables(p) -> [{label,x,y,action}]
     DH.pocket.serialize()/deserialize(data)/remoteAction(name,args)/offline(offMin)

   O-1 request cycle: every ~30 REAL minutes a villager (or a family pet when
       villagers.js is absent) posts a request — "bring me 2 apples" / "a red
       flower" / "any fish". Max 2 active. Walk up to the requester and tap A:
       fulfill for bells + materials + friendship.
   O-2 craft waiting: the big-project bench (21,10) accepts orders for BIG
       furniture — tagged recipes from craft.js when present, a mini built-in
       list otherwise. Each job takes 1-4 REAL hours, finishes inside update()
       and offline(), and offers "Speed up (50🪙)" for the impatient.
   O-3 amenity invites: setting up the campsite kit (24,11) — or having a
       cafe-style furniture combo (table+chair / sofa+tv) placed in the yard
       via furniture.js — invites a villager to come sit for a while. With no
       villagers module, a mascot guest wanders in instead.
   O-4 3-hour refresh: every 3 real hours the rotation re-rolls a shop-stock
       hint, a visiting-NPC flag and a bonus "request of the hour". Other
       modules read it via DH.pocket.rotation.
   O-6 garden event (monthly): the first week (1st–7th) of each real month is
       the Garden Event — plant event seeds in the meadow strip (x20–25,y12),
       catch the event bugs hovering over bloomed event flowers to earn
       festival petals, and trade petals at the event board for 3 limited
       furniture prizes.

   Sync boundary: all sim state lives in S (plain JSON only). Guests never run
   update(); mutations route through remoteAction("pocket.<fn>") like tools.js.
   Tools optional-dependency: a shovel just widens the event meadow — every
   action works with bare hands.
*/
(function () {
  const DH = (window.DH = window.DH || {});
  const T = 32;
  const II = DH.items;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const cap1 = s => s.charAt(0).toUpperCase() + s.slice(1);
  const now = () => Date.now();

  // ---------- tuning ----------
  const REQ_EVERY = 30 * 60 * 1000;   // O-1: a request every ~30 real minutes
  const REQ_TTL = 55 * 60 * 1000;     // requests expire after ~55 min
  const REQ_MAX = 2;                  // max active (non-bonus) requests
  const ROT_MS = 3 * 3600 * 1000;     // O-4: 3-hour rotation
  const SPEEDUP_COST = 50;            // O-2 speed-up price in coins
  const GUEST_STAY = 10 * 60 * 1000;  // O-3 amenity visitor hangout time
  const GUEST_CD = 6 * 60 * 1000;     // cooldown between visitors
  const GROW_MS = 3 * 60 * 1000;      // O-6 event flower grow time
  const BUG_TTL = 90 * 1000;          // event bug lingers ~90s
  const BUG_MAX = 3;
  const EVENT_SEEDS_PER_DAY = 2;
  const SAVE_EVERY = 8;               // s between autosaves

  // ---------- world fixtures (east yard strip — clear of court/sauna) ----------
  const BENCH = { tx: 22, ty: 10, x: 22 * T + 16, y: 10 * T + 20 }; // big-project bench
  const CAMP = { tx: 24, ty: 11, x: 24 * T + 16, y: 11 * T + 16 };  // campsite kit spot
  const BOARD = { tx: 26, ty: 10, x: 26 * T + 16, y: 10 * T + 16 }; // event board
  const MEADOW = [[20, 12], [21, 12], [22, 12], [23, 12], [24, 12], [25, 12]];
  const BLOCK_TILES = [BENCH, BOARD].map(b => b.tx + "," + b.ty);
  const CAMP_TILE = CAMP.tx + "," + CAMP.ty;

  // ---------- items ----------
  II.def("event-seed", { name: "Event seed", ico: "🌰", cat: "misc", price: 5, stack: 20 });
  II.def("fest-petal", { name: "Festival petal", ico: "🌸", cat: "misc", price: 10, stack: 99 });
  II.def("fest-lantern", { name: "Festival lantern", ico: "🏮", cat: "furniture", price: 220 });
  II.def("fest-arch", { name: "Blossom arch", ico: "🌺", cat: "furniture", price: 380 });
  II.def("fest-stand", { name: "Festival stand", ico: "🎪", cat: "furniture", price: 550 });

  // ---------- state (plain JSON only — save bus + net snapshots) ----------
  let gs = null, C = null;
  const S = {
    reqs: [],            // O-1 {id,aType,aId,name,kind,item,cat,n,txt,exp,bonus}
    nextReqAt: 0,
    jobs: [],            // O-2 {id,item,label,ico,doneAt,ready}
    camp: null,          // O-3 {at} campsite kit set up
    guest: null,         // O-3 visiting npc {name,sp,x,y,mode,wait,until,vil}
    guestCd: 0,          // timestamp when next visitor may arrive
    rot: { slot: -1, shopHint: null, npcVisit: false },  // O-4
    efl: [],             // O-6 event flowers {tx,ty,plantedAt}
    ebugs: [],           // O-6 event bugs {id,tx,ty,until}
    grantStamp: "",      // real-day stamp of last free event-seed grant
    eventForce: null,    // debug/test override for the monthly window
    fx: [],              // {k,x,y,vx,vy,age,ttl,c}
    nextId: 1,
  };
  let saveT = 0;

  const alog = (e, d) => { if (DH.alog) DH.alog.add(e, d); };
  const addHappy = n => { if (gs) gs.happiness = Math.max(0, gs.happiness + n); };
  const isGuestSide = () => !!(DH.net && DH.net.online && DH.net.role === "guest");

  // ---------- fx ----------
  function fx(k, x, y, o) { if (S.fx.length < 80) S.fx.push(Object.assign({ k, x, y, vx: 0, vy: -20, age: 0, ttl: 1, c: "#ffd76b" }, o)); }
  const hearts = (x, y, n = 3) => { for (let i = 0; i < n; i++) fx("heart", x + rnd(-9, 9), y - 14 + rnd(-6, 0), { ttl: 0.9 }); };
  const petals = (x, y, n = 5) => { for (let i = 0; i < n; i++) fx("petal", x + rnd(-10, 10), y - rnd(0, 14), { vx: rnd(-10, 10), vy: rnd(-26, -8), ttl: rnd(0.7, 1.2), c: pick(["#ff9ec4", "#ffc9de", "#ff7fa5"]) }); };

  // ---------- actors: villagers first, family pets as fallback ----------
  function actors() {
    const out = [];
    if (DH.villagers && DH.villagers._state && Array.isArray(DH.villagers._state.vils))
      for (const v of DH.villagers._state.vils)
        out.push({ aType: "vil", aId: v.id, name: v.name, x: v.x, y: v.y, ref: v });
    if (!out.length && DH.animals && DH.animals._state && Array.isArray(DH.animals._state.animals))
      for (const a of DH.animals._state.animals)
        out.push({ aType: "pet", aId: a.id, name: a.name || "Pet", x: a.x, y: a.y, ref: a });
    return out;
  }
  function actorOf(r) { return actors().find(a => a.aType === r.aType && a.aId === r.aId) || null; }

  function addFriendship(r, n) {
    const a = actorOf(r);
    if (!a) return;
    const e = a.ref;
    if (r.aType === "vil") e.hearts = clamp((e.hearts || 0) + n, 0, 10);
    else e.affection = clamp((e.affection || 0) + n * 20, 0, 100);
  }

  // ---------- O-1 request cycle ----------
  const ITEM_ASKS = [["apple", 2], ["wood", 2], ["softwood", 2], ["clay", 1], ["stone", 2], ["shell", 1], ["mushroom", 1], ["egg", 1]];
  const CAT_ASKS = [["fish", 1], ["bug", 1], ["flower", 1], ["fruit", 1], ["sea", 1], ["food", 1]];
  function countCat(cat) {
    return DH.inv.list().reduce((s, sl) => s + ((II.get(sl.id) || {}).cat === cat ? sl.n : 0), 0);
  }
  function removeCat(cat, n) {
    for (const sl of DH.inv.list().slice()) {
      if (n <= 0) break;
      if ((II.get(sl.id) || {}).cat !== cat) continue;
      n -= DH.inv.remove(sl.id, Math.min(sl.n, n));
    }
  }
  function redFlowerCount() {
    return DH.inv.list().reduce((s, sl) => {
      const d = II.get(sl.id) || {};
      return s + (d.cat === "flower" && /-red$/.test(sl.id) ? sl.n : 0);
    }, 0);
  }
  function takeRedFlower() {
    for (const sl of DH.inv.list().slice())
      if ((II.get(sl.id) || {}).cat === "flower" && /-red$/.test(sl.id) && DH.inv.remove(sl.id, 1)) return true;
    return false;
  }
  function makeReq(a, bonus) {
    const t = now(), roll = Math.random();
    const base = { id: "q" + (S.nextId++), aType: a.aType, aId: a.aId, name: a.name, n: 1,
                   exp: bonus ? rotEndsAt() : t + REQ_TTL, bonus: !!bonus };
    if (roll < 0.42) {
      const [item, n] = pick(ITEM_ASKS);
      const d = II.get(item) || { name: item, ico: "📦" };
      return Object.assign(base, { kind: "item", item, n, txt: `${n}× ${d.ico} ${d.name}` });
    }
    if (roll < 0.78) {
      const [cat, n] = pick(CAT_ASKS);
      const label = cat === "sea" ? "sea creature" : cat;
      return Object.assign(base, { kind: "cat", cat, n, txt: `${n}× any ${label}` });
    }
    return Object.assign(base, { kind: "red", txt: "a red flower" });
  }
  function reqReady(r) {
    if (!r) return false;
    if (r.kind === "item") return DH.inv.count(r.item) >= r.n;
    if (r.kind === "cat") return countCat(r.cat) >= r.n;
    if (r.kind === "red") return redFlowerCount() >= 1;
    return false;
  }
  function issueReq(bonus) {
    const live = S.reqs.filter(r => !r.bonus);
    if (!bonus && live.length >= REQ_MAX) return null;
    const pool = actors().filter(a => !S.reqs.some(r => r.aId === a.aId));
    if (!pool.length) return null;
    const r = makeReq(pick(pool), bonus);
    S.reqs.push(r);
    alog(bonus ? "preq_bonus" : "preq", `${r.name}:${r.txt}`);
    if (!bonus) DH.toast(`📋 ${r.name} has a request for you — go say hi!`, 3200);
    else DH.toast(`⭐ Request of the hour: ${r.name} wants ${r.txt}!`, 3200);
    return r;
  }
  function tickRequests() {
    const t = now();
    // expire old requests
    const before = S.reqs.length;
    S.reqs = S.reqs.filter(r => r.exp > t);
    if (S.reqs.length < before) alog("preq_expire", before - S.reqs.length);
    if (t >= S.nextReqAt) {
      S.nextReqAt = t + REQ_EVERY;
      issueReq(false);
    }
  }
  function reqReward(r) {
    const bonus = r.bonus ? 1.5 : 1;
    const bells = Math.round((70 + r.n * 30 + rnd(0, 30)) * bonus);
    gs.coins += bells;
    const mats = ["wood", "softwood", "clay", "stone", "iron"];
    const mat = pick(mats), mn = 1 + (Math.random() < 0.4 ? 1 : 0);
    const got = DH.inv.add(mat, mn);
    addFriendship(r, r.bonus ? 1.2 : 0.8);
    addHappy(2);
    const a = actorOf(r);
    if (a) { hearts(a.x, a.y, 4); }
    DH.toast(`${r.name}: "You're a lifesaver!" +🪙${bells} +${got ? `${II.label(mat)} ×${got}` : "(pockets full)"} ♥`, 4200);
    alog("preq_done", `${r.name}:${r.txt}`);
  }

  // ---------- O-2 craft waiting ----------
  // Big orders are routed through our bench so craft.js stays untouched.
  // When craft.js is present its workbench furniture recipes (price >= 150)
  // become timed jobs; otherwise a small built-in catalog is used.
  const MINI_BIG = [
    { rid: "p-campfire", name: "Campfire", item: "fest-stand", mats: { wood: 3, stone: 2 }, hours: 1 },
    { rid: "p-screen", name: "Bamboo screen", item: "fest-arch", mats: { softwood: 4, clay: 1 }, hours: 2 },
    { rid: "p-lantern", name: "Paper lantern", item: "fest-lantern", mats: { clay: 2, weed: 2 }, hours: 1.5 },
  ];
  function matIds(key) {
    if (key === "@veg") return ["carrot", "potato", "tomato", "pumpkin", "mushroom"];
    if (key.startsWith("@cat:")) {
      const c = key.slice(5);
      return Object.values(II.defs).filter(d => d.cat === c).map(d => d.id);
    }
    if (key.startsWith("@any:")) return key.slice(5).split(",").filter(Boolean);
    return [key];
  }
  const matHave = key => key[0] === "@" ? matIds(key).reduce((s, id) => s + DH.inv.count(id), 0) : DH.inv.count(key);
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
  function bigCatalog() {
    const out = [];
    const hasCraft = DH.craft && DH.craft.RECIPES;
    if (hasCraft) {
      const known = typeof DH.craft.learned === "function" ? DH.craft.learned() : [];
      for (const rid in DH.craft.RECIPES) {
        const r = DH.craft.RECIPES[rid], d = II.get(r.result);
        if (r.station !== "workbench" || !d || d.cat !== "furniture" || (d.price || 0) < 150) continue;
        out.push({
          rid: "craft:" + rid, name: r.name, item: r.result, ico: d.ico,
          mats: r.materials, hours: clamp(1 + (d.price || 0) / 220, 1, 4),
          gated: !known.includes(rid),
        });
      }
    }
    if (!out.length) {
      for (const m of MINI_BIG) {
        const d = II.get(m.item);
        out.push({ rid: m.rid, name: m.name, item: m.item, ico: d ? d.ico : "📦", mats: m.mats, hours: m.hours, gated: false });
      }
    }
    return out;
  }
  function hrsTxt(h) { return h >= 1.98 ? `${Math.round(h)}h` : `${Math.round(h * 60)}min`; }
  function finishJob(j, quiet) {
    const got = DH.inv.add(j.item, 1);
    if (got > 0) {
      S.jobs = S.jobs.filter(x => x !== j);
      if (!quiet) {
        petals(BENCH.x, BENCH.y - 10, 8);
        DH.toast(`🔨✨ ${j.label} is finished! ${j.ico} — a real beauty.`, 3600);
      }
      alog("pjob_done", j.item);
    } else {
      j.ready = true; // pockets full — wait at the bench for pickup
      if (!quiet) DH.toast(`🔨 ${j.label} is done but your pockets are full!`, 3600);
    }
  }
  function tickJobs() {
    const t = now();
    for (const j of S.jobs.slice()) if (j.doneAt <= t && !j.ready) finishJob(j, false);
  }

  // ---------- O-3 amenity invites ----------
  const GUESTS = [
    { name: "Sable", sp: "cat", c: "#7a7a88" }, { name: "Chip", sp: "squirrel", c: "#b07840" },
    { name: "Dot", sp: "deer", c: "#c09058" }, { name: "Teddy", sp: "bear", c: "#9a7040" },
  ];
  // amenity anchor: our campsite kit, or a readable furniture.js combo in the yard
  function amenity() {
    if (S.camp) return { x: CAMP.x, y: CAMP.y, kind: "campsite" };
    if (DH.furniture && typeof DH.furniture.serialize === "function") {
      const its = ((DH.furniture.serialize() || {}).items) || [];
      const yard = its.filter(i => DH.world.zone(i.x0, i.y0) === "yard");
      const has = id => yard.find(i => i.id === id);
      const table = has("table"), chair = has("chair");
      if (table && chair) return { x: (table.x0 + 0.5) * T, y: (table.y0 + 1) * T, kind: "café corner" };
      const sofa = has("sofa"), tv = has("tv");
      if (sofa && tv) return { x: (sofa.x0 + 1) * T, y: (sofa.y0 + 1) * T, kind: "lounge" };
    }
    return null;
  }
  function spawnGuest(am) {
    const vils = (DH.villagers && DH.villagers._state && DH.villagers._state.vils) || [];
    // prefer borrowing a real villager — they come sit at the amenity
    if (vils.length && Math.random() < 0.8) {
      const v = pick(vils);
      v.x = am.x + rnd(-18, 18); v.y = am.y + rnd(-6, 22);
      v.mode = "sit"; v.wait = GUEST_STAY / 1000; v.tx = v.x; v.ty = v.y;
      S.guest = { name: v.name, sp: v.species || "bear", x: v.x, y: v.y, mode: "sit",
                  until: now() + GUEST_STAY, vil: v.id };
      DH.toast(`🏕️ ${v.name} came to hang out at the ${am.kind}!`, 3600);
    } else {
      const g = pick(GUESTS);
      S.guest = { name: g.name, sp: g.sp, c: g.c, x: am.x + rnd(-60, 60), y: am.y + rnd(20, 60),
                  mode: "walk", wait: 0, until: now() + GUEST_STAY, vil: null, tx: am.x + rnd(-14, 14), ty: am.y + rnd(4, 18) };
      DH.toast(`🏕️ A visitor dropped by the ${am.kind} — ${g.name} the ${g.sp}!`, 3600);
    }
    alog("pguest", S.guest.name);
  }
  function tickGuest(dt) {
    const am = amenity();
    if (!S.guest) {
      if (am && now() >= S.guestCd && Math.random() < dt * 0.06) spawnGuest(am);
      return;
    }
    const g = S.guest;
    const v = g.vil && DH.villagers && DH.villagers._state
      ? DH.villagers._state.vils.find(v2 => v2.id === g.vil) : null;
    if (now() >= g.until || !am) { // visit ends — leave a thank-you gift
      if (v) { v.mode = "idle"; v.wait = 1; }
      const pay = 40 + Math.floor(rnd(0, 40));
      gs.coins += pay;
      DH.inv.add(pick(["wood", "clay", "stone"]), 1);
      addHappy(3);
      petals(g.x, g.y, 6);
      DH.toast(`${g.name} loved the ${am ? am.kind : "visit"}! Left a gift: +🪙${pay} +material ♥`, 4000);
      alog("pguest_leave", g.name);
      S.guest = null; S.guestCd = now() + GUEST_CD;
      return;
    }
    if (v) { g.x = v.x; g.y = v.y; g.mode = "sit"; return; } // mirror the borrowed villager
    // mascot guest: wander to the amenity then sit
    if (g.mode === "walk") {
      const dx = g.tx - g.x, dy = g.ty - g.y, d = Math.hypot(dx, dy);
      if (d < 4) { g.mode = "sit"; }
      else {
        const sp = 40 * dt;
        const nx = g.x + dx / d * sp, ny = g.y + dy / d * sp;
        if (DH.world.canStand(nx, g.y)) g.x = nx;
        if (DH.world.canStand(g.x, ny)) g.y = ny;
      }
    } else if (Math.random() < dt * 0.15) { // small reposition while hanging out
      g.mode = "walk"; g.tx = am.x + rnd(-16, 16); g.ty = am.y + rnd(2, 20);
    }
  }

  // ---------- O-4 three-hour rotation ----------
  const rotSlot = () => Math.floor(now() / ROT_MS);
  const rotEndsAt = () => (rotSlot() + 1) * ROT_MS;
  function rollRotation() {
    const s = rotSlot();
    if (S.rot.slot === s) return;
    S.rot.slot = s;
    const pool = Object.values(II.defs).filter(d => d.price > 0 && d.price < 700);
    S.rot.shopHint = pool.length ? pick(pool).id : null;
    S.rot.npcVisit = Math.random() < 0.55;
    S.reqs = S.reqs.filter(r => !r.bonus); // old hour-request lapses with the slot
    S.rot.bonusDone = false; S.rot.bonusTry = 0;
    if (issueReq(true)) S.rot.bonusDone = true;
    alog("prot", `${s}:${S.rot.shopHint || "-"}:${S.rot.npcVisit ? "npc" : "-"}`);
  }
  function tickBonusReq() { // pocket loads before villagers/animals — keep retrying until actors exist
    if (S.rot.bonusDone || S.rot.bonusTry >= 30) return;
    S.rot.bonusTry++;
    if (issueReq(true)) S.rot.bonusDone = true;
  }

  // ---------- O-6 garden event (first full week of each real month) ----------
  function eventOn() {
    if (S.eventForce != null) return !!S.eventForce;
    return new Date().getDate() <= 7;
  }
  function grantSeeds(force) {
    const stamp = new Date().toDateString();
    if (!force && S.grantStamp === stamp) return false;
    S.grantStamp = stamp;
    const got = DH.inv.add("event-seed", EVENT_SEEDS_PER_DAY);
    if (got > 0) DH.toast(`🌸 Garden event! Got ${got} event seed${got > 1 ? "s" : ""} — plant them in the meadow!`, 4000);
    return got > 0;
  }
  function meadowFree(tx, ty) {
    const W = DH.world;
    if (W.zone(tx, ty) !== "yard" || W.tileAt(tx, ty) !== W.GRASS || W.isBlocked(tx, ty)) return false;
    if (S.efl.some(f => f.tx === tx && f.ty === ty)) return false;
    const F = DH.forage && DH.forage._S;
    if (F && F.flowers && F.flowers.some(f => f.tx === tx && f.ty === ty)) return false;
    return true;
  }
  function bloom(f) { return now() - f.plantedAt >= GROW_MS; }
  function tickEvent() {
    if (!eventOn()) return;
    grantSeeds(false);
    // event bugs hover over bloomed event flowers
    const t = now();
    S.ebugs = S.ebugs.filter(b => b.until > t && S.efl.some(f => f.tx === b.tx && f.ty === b.ty && bloom(f)));
    if (S.ebugs.length < BUG_MAX && Math.random() < 0.3) {
      const open = S.efl.filter(f => bloom(f) && !S.ebugs.some(b => b.tx === f.tx && b.ty === f.ty));
      if (open.length) {
        const f = pick(open);
        S.ebugs.push({ id: "eb" + (S.nextId++), tx: f.tx, ty: f.ty, until: t + BUG_TTL });
      }
    }
  }

  // ---------- guest-safe dispatch ----------
  function act(name, ...args) {
    if (isGuestSide()) { DH.net.guestAction("pocket." + name, args); return undefined; }
    const fn = API[name];
    return typeof fn === "function" ? fn(...args) : false;
  }

  // ---------- mutations (named + remote-callable) ----------
  const API = {
    // O-1
    fulfillReq(id) {
      const i = S.reqs.findIndex(r => r.id === id);
      if (i < 0 || !gs) return false;
      const r = S.reqs[i];
      if (!reqReady(r)) { DH.toast(`Still needs: ${r.txt} ☹️`); return false; }
      if (r.kind === "item") DH.inv.remove(r.item, r.n);
      else if (r.kind === "cat") removeCat(r.cat, r.n);
      else takeRedFlower();
      S.reqs.splice(i, 1);
      reqReward(r);
      return true;
    },

    // O-2
    order(rid) {
      const e = bigCatalog().find(x => x.rid === rid);
      if (!e || !gs) return false;
      if (e.gated) { DH.toast("You haven't learned that recipe yet 📖"); return false; }
      if (S.jobs.length >= 3) { DH.toast("The bench is busy — wait for a job to finish!"); return false; }
      for (const k in e.mats) if (matHave(k) < e.mats[k]) { DH.toast(`Missing ${matLabel(k)} 🪵`); return false; }
      for (const k in e.mats) matTake(k, e.mats[k]);
      const hrs = e.hours;
      S.jobs.push({ id: "j" + (S.nextId++), item: e.item, label: e.name, ico: e.ico, doneAt: now() + hrs * 3600 * 1000, ready: false });
      DH.toast(`🔨 ${e.name} ordered — it's a big build, done in ~${hrsTxt(hrs)}. "Ready tomorrow!" ✨`, 4200);
      alog("pjob", e.item);
      return true;
    },
    speedup(jid) {
      const j = S.jobs.find(x => x.id === jid);
      if (!j || j.ready || !gs) return false;
      if (gs.coins < SPEEDUP_COST) { DH.toast("Not enough coins 🪙"); return false; }
      gs.coins -= SPEEDUP_COST;
      j.doneAt = now();
      finishJob(j, false);
      alog("pspeed", j.item);
      return true;
    },
    collect(jid) {
      const j = S.jobs.find(x => x.id === jid);
      if (!j || !j.ready) return false;
      j.ready = false;
      finishJob(j, false);
      return true;
    },

    // O-3
    setupCamp() {
      if (S.camp || !gs) return false;
      if (DH.inv.count("wood") < 3) { DH.toast("Need 3× 🪵 Wood for the campsite kit"); return false; }
      DH.inv.remove("wood", 3);
      S.camp = { at: now() };
      DH.world.blocked.add(CAMP_TILE);
      petals(CAMP.x, CAMP.y, 10);
      addHappy(3);
      DH.toast("🏕️ Campsite set up! Friends may stop by to hang out…", 3600);
      alog("pcamp");
      return true;
    },

    // O-6
    plantSeed(tx, ty) {
      if (!eventOn()) { DH.toast("The garden event isn't on right now 🌸"); return false; }
      if (!MEADOW.some(([mx, my]) => mx === tx && my === ty)) return false;
      if (!meadowFree(tx, ty)) return false;
      if (DH.inv.remove("event-seed", 1) <= 0) { DH.toast("No event seeds — check the board 🌰"); return false; }
      S.efl.push({ tx, ty, plantedAt: now() });
      petals(tx * T + 16, ty * T + 16, 4);
      DH.toast("🌰 Planted an event seed — bloom in ~3min!");
      alog("pseeds", `${tx},${ty}`);
      return true;
    },
    sowAll() { // plant as many seeds as fit the meadow — one-tap phone flow
      let n = 0;
      for (const [tx, ty] of MEADOW)
        if (meadowFree(tx, ty) && DH.inv.count("event-seed") > 0) {
          DH.inv.remove("event-seed", 1);
          S.efl.push({ tx, ty, plantedAt: now() });
          n++;
        }
      if (n) { petals(BOARD.x, BOARD.y, 8); DH.toast(`🌸 Sowed ${n} event seed${n > 1 ? "s" : ""} in the meadow!`); alog("psow", n); }
      else DH.toast("No open meadow spots or no seeds 🌰");
      return n > 0;
    },
    catchBug(bid) {
      const i = S.ebugs.findIndex(b => b.id === bid);
      if (i < 0) return false;
      const b = S.ebugs[i];
      S.ebugs.splice(i, 1);
      const got = DH.inv.add("fest-petal", 2 + (Math.random() < 0.5 ? 1 : 0));
      if (Math.random() < 0.35) DH.inv.add("event-seed", 1);
      petals(b.tx * T + 16, b.ty * T + 8, 8);
      addHappy(2);
      DH.toast(`🦋 Caught a petalbug! +${got} festival petals 🌸`, 2800);
      alog("pbug", got);
      return true;
    },
    pickEventFlower(tx, ty) {
      const i = S.efl.findIndex(f => f.tx === tx && f.ty === ty);
      if (i < 0 || !bloom(S.efl[i])) return false;
      S.efl.splice(i, 1);
      S.ebugs = S.ebugs.filter(b => !(b.tx === tx && b.ty === ty));
      DH.inv.add("fest-petal", 1);
      const gotSeed = Math.random() < 0.5;
      if (gotSeed) DH.inv.add("event-seed", 1); // special flowers drop fresh seeds
      petals(tx * T + 16, ty * T + 12, 8);
      DH.toast("🌸 Picked an event bloom! +1 petal" + (gotSeed ? " +1 seed" : ""));
      alog("pbloom", `${tx},${ty}`);
      return true;
    },
    trade(id) {
      const prize = EVENT_PRIZES.find(p => p.id === id);
      if (!prize || !gs) return false;
      if (DH.inv.count("fest-petal") < prize.cost) { DH.toast("Not enough petals 🌸"); return false; }
      if (DH.inv.add(id, 1) <= 0) { DH.toast("Pockets full! 🎒"); return false; }
      DH.inv.remove("fest-petal", prize.cost);
      petals(BOARD.x, BOARD.y, 10);
      addHappy(3);
      DH.toast(`🎪 Traded for ${prize.name}! ${prize.ico} Limited edition!`, 3200);
      alog("ptrade", id);
      return true;
    },
    greetGuest() {
      const g = S.guest;
      if (!g) return false;
      const lines = [
        `This ${amenity() ? amenity().kind : "spot"} is so cozy — great job!`,
        "I heard this place was friendly. The rumors undersold it!",
        "Pull up a seat — the fire's warm.",
      ];
      DH.toast(`${g.name}: "${pick(lines)}"`, 3200);
      hearts(g.x, g.y, 2);
      return true;
    },
    // debug/testing helpers (also usable by future modules)
    forceEvent(on) { S.eventForce = on == null ? null : !!on; return true; },
    debugRotate() { S.rot.slot = -1; rollRotation(); return S.rot; },
  };

  const EVENT_PRIZES = [
    { id: "fest-lantern", name: "Festival lantern", ico: "🏮", cost: 5 },
    { id: "fest-arch", name: "Blossom arch", ico: "🌺", cost: 10 },
    { id: "fest-stand", name: "Festival stand", ico: "🎪", cost: 15 },
  ];

  // ---------- menus ----------
  function openReqMenu(r, p) {
    const a = actorOf(r);
    const rows = [
      { ico: "📋", label: `Wants: <b>${r.txt}</b> <small>${r.bonus ? "⭐ hour request" : "request"}</small>`, disabled: true, cb() {} },
      { ico: "✅", label: reqReady(r) ? "Hand it over!" : "Not yet — keep looking", disabled: !reqReady(r), cb: () => act("fulfillReq", r.id) },
    ];
    if (r.aType === "vil" && a && DH.villagers && typeof DH.villagers.openVillagerMenu === "function")
      rows.push({ ico: "💬", label: "Chat & more", cb: () => DH.villagers.openVillagerMenu(a.ref, p) });
    DH.menu.open(`📋 ${r.name}'s request`, rows);
  }
  function openBench(p) {
    const t = now(), rows = [];
    const running = S.jobs.filter(j => !j.ready);
    const ready = S.jobs.filter(j => j.ready);
    for (const j of ready)
      rows.push({ ico: "🎁", label: `<b>Collect ${j.label}</b> ${j.ico}`, cb: () => act("collect", j.id) });
    for (const j of running) {
      const left = Math.max(0, j.doneAt - t), mins = Math.ceil(left / 60000);
      rows.push({ ico: j.ico, label: `${j.label} — ${mins >= 60 ? Math.round(mins / 60) + "h" : mins + "min"} left`, disabled: true, cb() {} });
      rows.push({ ico: "⏩", label: `Speed up ${j.label}`, cost: SPEEDUP_COST, disabled: gs.coins < SPEEDUP_COST, cb: () => { act("speedup", j.id); openBench(p); } });
    }
    for (const e of bigCatalog()) {
      const ok = !e.gated && Object.keys(e.mats).every(k => matHave(k) >= e.mats[k]);
      const mats = Object.entries(e.mats).map(([k, n]) => `${matLabel(k)} ${matHave(k)}/${n}`).join(" · ");
      rows.push({
        ico: e.ico,
        label: `${e.name} <small>~${hrsTxt(e.hours)} · ${mats}${e.gated ? " · 🔒recipe" : ""}</small>`,
        disabled: !ok || S.jobs.length >= 3,
        cb: () => { act("order", e.rid); openBench(p); },
      });
    }
    DH.menu.open("🔨 Big-project bench", rows);
  }
  function openCamp(p) {
    if (!S.camp) {
      DH.menu.open("🏕️ Campsite kit", [
        { ico: "🏕️", label: `Set up campsite <small>🪵 Wood ${DH.inv.count("wood")}/3 — friends will visit!</small>`, disabled: DH.inv.count("wood") < 3, cb: () => act("setupCamp") },
        { ico: "💡", label: "Or place a table+chair / sofa+TV in the yard", disabled: true, cb() {} },
      ]);
      return;
    }
    const g = S.guest;
    DH.menu.open("🏕️ Campsite", [
      { ico: "👋", label: g ? `${g.name} is hanging out — say hi up close!` : "Quiet for now… someone may wander in", disabled: true, cb() {} },
      { ico: "💗", label: "Cozy spots attract visitors — keep it lovely!", disabled: true, cb() {} },
    ]);
  }
  function openBoard(p) {
    const petalsN = DH.inv.count("fest-petal"), seedsN = DH.inv.count("event-seed");
    const rows = [];
    if (eventOn()) {
      rows.push({ ico: "🌸", label: `<b>Garden event ON!</b> blooms through the 7th`, disabled: true, cb() {} });
      const claimedToday = S.grantStamp === new Date().toDateString();
      rows.push({ ico: "🌰", label: claimedToday ? `Daily seeds claimed (have ${seedsN})` : `Claim daily seeds (have ${seedsN})`, disabled: claimedToday, cb: () => { grantSeeds(false); openBoard(p); } });
      rows.push({ ico: "🌱", label: `Sow seeds in the meadow <small>(have ${seedsN})</small>`, disabled: seedsN <= 0, cb: () => { act("sowAll"); openBoard(p); } });
      rows.push({ ico: "🦋", label: "Catch petalbugs on bloomed event flowers → 🌸 petals", disabled: true, cb() {} });
      for (const pz of EVENT_PRIZES)
        rows.push({ ico: pz.ico, label: `${pz.name} — 🌸${pz.cost}`, disabled: petalsN < pz.cost, cb: () => { act("trade", pz.id); openBoard(p); } });
    } else {
      rows.push({ ico: "🌸", label: `Garden event: days 1–7 of the month <small>(petals held: ${petalsN})</small>`, disabled: true, cb() {} });
    }
    // O-4 rotation readout — the rumor mill
    const rot = M.rotation();
    const hintD = rot.shopHint ? II.get(rot.shopHint) : null;
    rows.push({ ico: "📻", label: `Rumor: shop wants ${hintD ? hintD.ico + " " + hintD.name : "nothing"} ${rot.npcVisit ? "· a visitor is about!" : ""}`, disabled: true, cb() {} });
    DH.menu.open("🌸 Event board", rows);
  }

  // ---------- drawing ----------
  const R = (ctx, x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
  function drawBench(ctx, px, py) {
    // sawhorse bench with a big blueprint + lantern
    R(ctx, px - 24, py + 8, 48, 5, "#9a6a38");
    R(ctx, px - 20, py + 13, 4, 12, "#7a5527"); R(ctx, px + 16, py + 13, 4, 12, "#7a5527");
    R(ctx, px - 14, py + 2, 16, 8, "#e8e0d0");          // blueprint sheet
    R(ctx, px - 12, py + 4, 12, 1, "#7a9ec8"); R(ctx, px - 12, py + 6, 8, 1, "#7a9ec8");
    R(ctx, px + 6, py + 1, 8, 8, "#4a4a55");            // toolbox
    R(ctx, px + 6, py + 1, 8, 2, "#5a5a66"); R(ctx, px + 8, py - 1, 4, 2, "#6a6a76");
    const hasDone = S.jobs.some(j => j.ready), hasRun = S.jobs.length > 0;
    if (hasRun) {
      ctx.font = "10px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(hasDone ? "🎁" : "⏳", px + 20, py - 8 + Math.sin(Date.now() / 500) * 2);
    }
    ctx.font = "10px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("🔨", px - 4, py - 6 + Math.sin(Date.now() / 700) * 1.5);
  }
  function drawCamp(ctx, px, py) {
    // tent + campfire + log — the amenity anchor
    ctx.fillStyle = "#e87f4a";
    ctx.beginPath(); ctx.moveTo(px - 20, py + 12); ctx.lineTo(px - 4, py - 16); ctx.lineTo(px + 12, py + 12); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#c25f30";
    ctx.beginPath(); ctx.moveTo(px - 11, py + 12); ctx.lineTo(px - 4, py - 16); ctx.lineTo(px + 3, py + 12); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#4a2c14";
    ctx.beginPath(); ctx.moveTo(px - 7, py + 12); ctx.lineTo(px - 4, py - 6); ctx.lineTo(px - 1, py + 12); ctx.closePath(); ctx.fill();
    // campfire right of the tent
    const fx0 = px + 16, fy = py + 8, flick = Math.sin(Date.now() / 130) * 1.5;
    R(ctx, fx0 - 6, fy + 3, 12, 3, "#6e4a2a");
    ctx.fillStyle = "#e8622a";
    ctx.beginPath(); ctx.moveTo(fx0 - 4, fy + 2); ctx.lineTo(fx0, fy - 7 - flick); ctx.lineTo(fx0 + 4, fy + 2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#ffd76b";
    ctx.beginPath(); ctx.moveTo(fx0 - 2, fy + 2); ctx.lineTo(fx0, fy - 3 - flick); ctx.lineTo(fx0 + 2, fy + 2); ctx.closePath(); ctx.fill();
    // log seat
    R(ctx, px - 26, py + 14, 10, 5, "#8a5a3b"); R(ctx, px - 26, py + 14, 10, 2, "#a06a42");
  }
  function drawBoard(ctx, px, py) {
    // festival board — signpost with bunting
    R(ctx, px - 2, py - 6, 4, 20, "#6e4a2a");
    R(ctx, px - 16, py - 22, 32, 17, "#f0e0b8");
    R(ctx, px - 16, py - 22, 32, 3, "#e05b8a");
    ctx.fillStyle = "#5a4a2a"; ctx.font = "bold 7px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("EVENT", px, py - 13);
    const cols = ["#e05b8a", "#ffd76b", "#5bc8d0"];
    for (let i = 0; i < 5; i++) { // bunting flags
      ctx.fillStyle = cols[i % 3];
      ctx.beginPath(); ctx.moveTo(px - 20 + i * 9, py - 4); ctx.lineTo(px - 16 + i * 9, py - 4); ctx.lineTo(px - 18 + i * 9, py + 2 + Math.sin(Date.now() / 300 + i) * 1); ctx.closePath(); ctx.fill();
    }
    ctx.font = "10px sans-serif";
    ctx.fillText(eventOn() ? "🌸" : "🌿", px, py - 30 + Math.sin(Date.now() / 600) * 1.5);
  }
  function drawGuest(ctx, g, x, y) {
    ctx.save(); ctx.translate(x, y);
    if (g.mode === "sit") ctx.scale(1.05, 0.82);
    else if (g.mode === "walk") ctx.translate(0, -Math.abs(Math.sin(Date.now() / 150)) * 1.5);
    const c = g.c || "#9a7040";
    R(ctx, -5, -7, 4, 7, "#5a4a3a"); R(ctx, 1, -7, 4, 7, "#5a4a3a");   // legs
    R(ctx, -8, -18, 16, 12, c);                                        // body
    R(ctx, -6, -18, 12, 5, "#e8d8b8");                                 // belly
    R(ctx, -10, -17, 3, 8, c); R(ctx, 7, -17, 3, 8, c);                // arms
    R(ctx, -8, -30, 16, 13, c);                                        // head
    R(ctx, -8, -33, 4, 5, c); R(ctx, 4, -33, 4, 5, c);                 // ears
    R(ctx, -7, -32, 2, 3, "#e8b8c0"); R(ctx, 5, -32, 2, 3, "#e8b8c0");
    R(ctx, -3, -22, 6, 3, "#f0e0c8");                                  // muzzle
    R(ctx, -4, -26, 2, 3, "#1a1a1a"); R(ctx, 3, -26, 2, 3, "#1a1a1a"); // eyes
    R(ctx, -1, -21, 2, 1, "#6a4a34");                                  // nose
    ctx.restore();
  }
  function drawEFlower(ctx, f, camX, camY) {
    const px = f.tx * T - camX, py = f.ty * T - camY, cx = px + 16;
    ctx.fillStyle = "#3f8f33";
    ctx.fillRect(cx - 1, py + 16, 2, 9); ctx.fillRect(cx - 4, py + 19, 3, 2); ctx.fillRect(cx + 2, py + 17, 3, 2);
    if (!bloom(f)) {
      ctx.fillStyle = "#7ab84a"; ctx.fillRect(cx - 2, py + 13, 4, 4); // bud
      return;
    }
    // event bloom — big pink sparkle flower
    const tw2 = Math.sin(Date.now() / 260 + f.tx + f.ty) * 1.5;
    ctx.fillStyle = "#ff9ec4";
    ctx.fillRect(cx - 5, py + 9 + tw2 * 0.3, 4, 4); ctx.fillRect(cx + 1, py + 9 + tw2 * 0.3, 4, 4);
    ctx.fillRect(cx - 2, py + 6 + tw2 * 0.3, 4, 4); ctx.fillRect(cx - 2, py + 13 + tw2 * 0.3, 4, 4);
    ctx.fillStyle = "#fff8c9"; ctx.fillRect(cx - 1, py + 10, 2, 2);
    ctx.fillStyle = "#ffffff99"; ctx.fillRect(cx + 6, py + 5, 2, 2); ctx.fillRect(cx - 8, py + 8, 1.5, 1.5);
  }
  function drawEBug(ctx, b, camX, camY) {
    const now2 = Date.now();
    const x = b.tx * T + 16 + Math.sin(now2 / 380 + b.tx) * 7 - camX;
    const y = b.ty * T + 6 + Math.cos(now2 / 300 + b.ty) * 5 - camY;
    const flap = Math.abs(Math.sin(now2 / 60)) * 0.7 + 0.3;
    ctx.fillStyle = "#ff8fb8";
    ctx.beginPath(); ctx.ellipse(x - 3, y, 3, 4.5 * flap, -0.4, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + 3, y, 3, 4.5 * flap, 0.4, 0, 7); ctx.fill();
    ctx.fillStyle = "#ffd76b"; ctx.fillRect(x - 3.5, y - 2, 1.5, 1.5); ctx.fillRect(x + 2, y - 2, 1.5, 1.5);
    ctx.fillStyle = "#5a3a4a"; ctx.fillRect(x - 1, y - 4, 2, 8);
  }
  function drawFx(ctx, f, camX, camY) {
    const a = Math.max(0, 1 - f.age / f.ttl), x = f.x - camX, y = f.y - camY;
    ctx.save(); ctx.globalAlpha = a;
    if (f.k === "heart") DH.sprites.heart(ctx, x, y, 5);
    else if (f.k === "petal") { ctx.fillStyle = f.c; ctx.fillRect(x - 2, y - 1.5, 4, 3); }
    else { ctx.fillStyle = f.c; ctx.fillRect(x - 1.5, y - 1.5, 3, 3); }
    ctx.restore();
  }
  function drawBubbleMark(ctx, x, y, txt) { // "!" / "📋" marker bubble
    ctx.fillStyle = "#ffffffee";
    ctx.fillRect(x - 11, y - 16, 22, 16);
    ctx.fillRect(x - 9, y - 18, 18, 2); ctx.fillRect(x - 2, y + 1, 4, 4);
    ctx.font = "bold 10px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = "#e04848"; ctx.fillText(txt, x, y - 8);
  }

  // ---------- module contract ----------
  const M = (DH.pocket = {
    authority: true,
    _state: S,

    rotation() { // O-4 snapshot for npcs/econ to read
      return { slot: S.rot.slot, endsAt: rotEndsAt(), shopHint: S.rot.shopHint, npcVisit: S.rot.npcVisit,
               bonusReq: (S.reqs.find(r => r.bonus) || null) };
    },
    eventOn, amenity,

    init(state) {
      gs = state;
      M.authority = !(DH.net && DH.net.online && DH.net.role === "guest");
      C = document.getElementById("cv").getContext("2d");
      BLOCK_TILES.forEach(k => DH.world.blocked.add(k));
      if (S.camp) DH.world.blocked.add(CAMP_TILE);
      S.nextReqAt = now() + 60 * 1000; // first request ~1min in so it is discoverable
    },

    start(state) {
      gs = state;
      M.authority = !(DH.net && DH.net.online && DH.net.role === "guest");
      BLOCK_TILES.forEach(k => DH.world.blocked.add(k));
      if (S.camp) DH.world.blocked.add(CAMP_TILE);
      S.fx = [];
      if (!S.nextReqAt) S.nextReqAt = now() + 60 * 1000;
      if (M.authority) { rollRotation(); tickJobs(); if (eventOn()) grantSeeds(false); }
      saveT = 0;
    },

    update(dt, state) {
      gs = state;
      for (const f of S.fx) { f.age += dt; f.x += (f.vx || 0) * dt; f.y += (f.vy || 0) * dt; }
      S.fx = S.fx.filter(f => f.age < f.ttl);
      if (!M.authority) return;
      tickRequests();
      tickJobs();
      tickGuest(dt);
      rollRotation();
      tickBonusReq();
      tickEvent();
      saveT += dt;
      if (saveT >= SAVE_EVERY) { saveT = 0; DH.save.now(); }
    },

    offline(offMin) {
      const parts = [];
      const t = now();
      // O-2: timed jobs finish while away
      const done = S.jobs.filter(j => j.doneAt <= t && !j.ready);
      for (const j of done) finishJob(j, true);
      if (done.length) parts.push(`${done.length} big build${done.length > 1 ? "s" : ""} finished 🔨`);
      // O-1: requests cycle while away
      S.reqs = S.reqs.filter(r => r.exp > t);
      if (offMin >= 30) S.nextReqAt = 0; // a fresh request soon after return
      // O-6: event seeds for the day + catch-up flower growth is timestamp-based (free)
      if (eventOn() && offMin >= 20) { const got = DH.inv.add("event-seed", 1); if (got) parts.push("the garden event left a 🌰 seed"); }
      // O-3: a visitor may have swung by
      if (S.guest) { S.guest = null; S.guestCd = t; parts.push("a visitor stopped by the campsite 🏕️"); }
      else if (S.camp && offMin >= 120) { S.guestCd = 0; parts.push("the campsite looks well-loved 🏕️"); }
      return parts;
    },

    interactables(p) {
      if (!gs || !gs.running) return [];
      const out = [], t = now();
      const near = (x, y, r) => dist2(p.x, p.y, x, y) < r * r;
      // fixtures
      if (near(BENCH.x, BENCH.y, 44))
        out.push({ label: `🔨 Big-project bench${S.jobs.some(j => j.ready) ? " 🎁" : S.jobs.length ? " ⏳" : ""}`, x: BENCH.x, y: BENCH.y, d2: dist2(p.x, p.y, BENCH.x, BENCH.y), action: () => openBench(p) });
      if (near(CAMP.x, CAMP.y + 8, 44))
        out.push({ label: S.camp ? "🏕️ Campsite" : "🏕️ Set up campsite", x: CAMP.x, y: CAMP.y, d2: dist2(p.x, p.y, CAMP.x, CAMP.y), action: () => openCamp(p) });
      if (near(BOARD.x, BOARD.y, 46))
        out.push({ label: `🌸 Event board${eventOn() ? " ON!" : ""}`, x: BOARD.x, y: BOARD.y, d2: dist2(p.x, p.y, BOARD.x, BOARD.y), action: () => openBoard(p) });
      // amenity guest
      if (S.guest && !S.guest.vil && near(S.guest.x, S.guest.y, 42))
        out.push({ label: `Say hi to ${S.guest.name} 🏕️`, x: S.guest.x, y: S.guest.y, d2: dist2(p.x, p.y, S.guest.x, S.guest.y), action: () => act("greetGuest") });
      // O-1: active requests ride on their actors (villagers or pets)
      for (const r of S.reqs) {
        const a = actorOf(r);
        if (!a) continue;
        if (near(a.x, a.y, 40))
          out.push({ label: `📋 ${r.name}'s request${reqReady(r) ? " ✅" : ""}${r.bonus ? " ⭐" : ""}`, x: a.x, y: a.y, d2: dist2(p.x, p.y, a.x, a.y) - 1, action: () => openReqMenu(r, p) });
      }
      // O-6: event bugs + blooms
      for (const b of S.ebugs) {
        const bx = b.tx * T + 16, by = b.ty * T + 10;
        if (near(bx, by, 42))
          out.push({ label: "Catch petalbug 🦋", x: bx, y: by, d2: dist2(p.x, p.y, bx, by) - 2, action: () => act("catchBug", b.id) });
      }
      for (const f of S.efl) {
        const fx0 = f.tx * T + 16, fy = f.ty * T + 16;
        if (bloom(f) && near(fx0, fy, 36))
          out.push({ label: "Pick event bloom 🌸", x: fx0, y: fy, d2: dist2(p.x, p.y, fx0, fy), action: () => act("pickEventFlower", f.tx, f.ty) });
      }
      out.sort((a, b) => a.d2 - b.d2);
      return out;
    },

    drawGround(ctx, camX, camY) {
      // event meadow patches while the event runs
      if (eventOn()) {
        for (const [tx, ty] of MEADOW) {
          const px = tx * T - camX, py = ty * T - camY;
          const tw = 0.5 + 0.5 * Math.sin(Date.now() / 800 + tx);
          ctx.fillStyle = `rgba(255,158,196,${0.10 + 0.10 * tw})`;
          ctx.fillRect(px + 2, py + 2, T - 4, T - 4);
          ctx.fillStyle = "#ffd76b";
          if ((tx + ty) % 2) ctx.fillRect(px + 26, py + 6, 2, 2);
        }
      }
      for (const f of S.efl) drawEFlower(ctx, f, camX, camY);
    },

    collectDraws(draws, camX, camY) {
      if (!C) C = document.getElementById("cv").getContext("2d");
      draws.push({ y: BENCH.ty * T + T, fn: () => drawBench(C, BENCH.x - camX, BENCH.y - camY) });
      draws.push({ y: BOARD.ty * T + T, fn: () => drawBoard(C, BOARD.x - camX, BOARD.y - camY) });
      if (S.camp) draws.push({ y: CAMP.ty * T + T, fn: () => drawCamp(C, CAMP.x - camX, CAMP.y - camY) });
      if (S.guest && !S.guest.vil)
        draws.push({ y: S.guest.y, fn: () => { DH.sprites.shadow(C, S.guest.x - camX, S.guest.y - camY, 15); drawGuest(C, S.guest, S.guest.x - camX, S.guest.y - camY); } });
    },

    drawOverlay(ctx, camX, camY, state) {
      if (ctx) C = ctx;
      for (const f of S.fx) drawFx(ctx, f, camX, camY);
      // request markers float over the requester
      for (const r of S.reqs) {
        const a = actorOf(r);
        if (!a) continue;
        drawBubbleMark(ctx, a.x - camX, a.y - camY - 40, r.bonus ? "⭐" : "📋");
      }
      // event bugs flutter over their flowers (world-pinned so guests see them too)
      for (const b of S.ebugs) drawEBug(ctx, b, camX, camY);
      // guest name tag when close
      if (S.guest && !S.guest.vil && state && state.players) {
        const g = S.guest, sx = g.x - camX, sy = g.y - camY;
        const nearP = state.players.some(pp => dist2(pp.x, pp.y, g.x, g.y) < 60 * 60);
        if (nearP) {
          ctx.font = "bold 9px sans-serif"; ctx.textAlign = "center";
          ctx.fillStyle = "#00000066"; ctx.fillText(g.name + " 🏕️", sx + 1, sy - 36);
          ctx.fillStyle = "#ffffffee"; ctx.fillText(g.name + " 🏕️", sx, sy - 37);
        }
      }
    },

    // ----- sync boundary -----
    serialize() {
      return JSON.parse(JSON.stringify({
        reqs: S.reqs, nextReqAt: S.nextReqAt, jobs: S.jobs, camp: S.camp,
        guest: S.guest, guestCd: S.guestCd, rot: S.rot,
        efl: S.efl, ebugs: S.ebugs, grantStamp: S.grantStamp,
        eventForce: S.eventForce, nextId: S.nextId,
      }));
    },
    deserialize(d) {
      if (!d || typeof d !== "object") return;
      if (Array.isArray(d.reqs)) S.reqs = d.reqs.filter(r => r && r.id && r.kind);
      if (typeof d.nextReqAt === "number") S.nextReqAt = d.nextReqAt;
      if (Array.isArray(d.jobs)) S.jobs = d.jobs.filter(j => j && j.item);
      if (d.camp && typeof d.camp === "object") { S.camp = d.camp; DH.world.blocked.add(CAMP_TILE); }
      if (d.guest && typeof d.guest === "object") S.guest = d.guest; else if (d.guest === null) S.guest = null;
      if (typeof d.guestCd === "number") S.guestCd = d.guestCd;
      if (d.rot && typeof d.rot === "object") S.rot = Object.assign({ slot: -1, shopHint: null, npcVisit: false, bonusDone: true, bonusTry: 0 }, d.rot);
      if (Array.isArray(d.efl)) S.efl = d.efl.filter(f => f && typeof f.tx === "number");
      if (Array.isArray(d.ebugs)) S.ebugs = d.ebugs.filter(b => b && b.id);
      if (typeof d.grantStamp === "string") S.grantStamp = d.grantStamp;
      if (d.eventForce !== undefined) S.eventForce = d.eventForce;
      if (typeof d.nextId === "number") S.nextId = d.nextId;
    },
    remoteAction(name, args) {
      const n = String(name || "").startsWith("pocket.") ? name.slice(7) : name;
      const fn = API[n];
      return typeof fn === "function" ? fn.apply(null, args || []) : false;
    },
  });
  Object.assign(M, API); // DH.pocket.order(...), fulfillReq, catchBug, ... for tests + remote use
})();

DH.register("pocket", DH.pocket);
