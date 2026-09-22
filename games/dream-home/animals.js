/* dream-home animals & family module.
   Contract with game.js:
     DH.animals.init(state)         – called once at load
     DH.animals.start(state)        – called when a run starts
     DH.animals.update(dt, state)   – per frame (sim; runs AI only when DH.animals.authority)
     DH.animals.interactables(p)    – -> [{label,x,y,action}] for the action key
     DH.animals.collectDraws(draws, camX, camY) – push {y, fn} for depth-sorted render
     DH.animals.drawOverlay(ctx, camX, camY, state) – topmost draw (markers, hearts FX)

   FAMILY CARE: every member has a condition — full → ok → hungry → starving.
   Starving members flop down, stop playing and drag the home's happiness down.
   Kids also get bored (need play); pets have affection (need petting) — a
   neglected pet avoids players. If more than half the family is unhappy the
   home happiness drains away ("gloom").

   TAMAGOTCHI PERSISTENCE: the whole module state plus shared
   {happiness,coins,timeMin,day} is saved to localStorage ('dreamhome-save')
   every few seconds and when the page hides. On start(), a found save is
   restored and offline decay is applied at a slowed rate (capped at 12h) —
   hunger/boredom advance, affection fades, harvestables mature — followed by a
   "While you were away…" summary toast. A sign board in the yard opens the
   family board (status report + reset save).

   Sync boundary (for future online co-op): ALL gameplay state lives in plain
   JSON-serializable data (S.animals / S.kids / S.items / S.fx). Mutations go
   through named functions exposed on DH.animals — feed(id), pet(id),
   playWith(id), collect(id), wake(id) — callable via
   DH.animals.remoteAction(name, args). serialize()/deserialize(data)
   snapshot/restore the whole module state (the same fields that get persisted).
   Wander AI + production run under DH.animals.authority (host); a client sets
   authority=false and applies deserialize() snapshots.
*/
(function () {
  const DH = (window.DH = window.DH || {});

  // ---------- tuning ----------
  const FEED_COST = 2;
  const HUNGRY_AT = 60;            // hunger level where the food marker shows
  const STARVING_AT = 90;          // lies down, stops playing, drains happiness
  const BORED_AT = 70;             // kid boredom where they sulk
  const NEGLECT_AT = 25;           // pet affection where they start avoiding players
  const HUNGER_RATE = { animal: 0.55, kid: 0.45 }; // per real second
  const BOREDOM_RATE = 0.32;       // kid boredom per real second
  const AFFECTION_DECAY = 0.10;    // pet affection per real second
  const PET_AFFECTION = 22;        // affection gained per pet
  const EGG_EVERY = 100, MILK_EVERY = 140, WOOL_EVERY = 170; // fed seconds to produce
  const EGG_COINS = 4, MILK_COINS = 6, WOOL_COINS = 8;
  const INTERACT_R = 34;
  const NIGHT_FROM = 21 * 60, NIGHT_TO = 6 * 60; // game-minutes of day when family sleeps

  // tamagotchi save
  const SAVE_KEY = "dreamhome-save";
  const SAVE_EVERY = 5;            // seconds between autosaves
  const OFFLINE_CAP_MIN = 12 * 60; // decay capped at 12h away
  const OFFLINE_RATE = 0.02;       // needs advance at 2% of live speed while away
  const OFFLINE_MIN_NOTICE = 2;    // minutes away before decay/summary applies

  // pasture interior (inside the fence): tiles x3..8, y12..16
  const PAST = { x1: 3 * 32 + 10, y1: 12 * 32 + 12, x2: 9 * 32 - 10, y2: 17 * 32 - 10 };
  const DOOR_IN = { x: 9 * 32 + 16, y: 9 * 32 + 16 };
  const DOOR_OUT = { x: 9 * 32 + 16, y: 10 * 32 + 16 };
  const GATE = { x: 5 * 32 + 16, y: 11 * 32 + 16 };   // pasture gate (in fence row)
  const GATE_OUT = { x: 5 * 32 + 16, y: 10 * 32 + 16 };
  const SIGN = { x: 14 * 32 + 16, y: 11 * 32 + 18, r: 46 }; // family board sign in the yard

  // ---------- module state (plain data only) ----------
  let gs = null; // game state ref (coins/happiness/timeMin/day) — not serialized
  const S = { animals: [], kids: [], items: [], fx: [], happy: 0, nextId: 1 };
  let saveT = 0, gloomT = 0, wired = false;

  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
  const clamp01 = v => Math.max(0, Math.min(1, v));

  function hearts(x, y, n = 2) {
    for (let i = 0; i < n; i++)
      S.fx.push({ k: "heart", x: x + rnd(-8, 8), y: y + rnd(-6, 0), vy: -20 - rnd(0, 10), life: 0.9, max: 0.9 });
  }
  function addHappy(n) {
    S.happy += n;
    gs.happiness = Math.max(0, gs.happiness + n);
  }
  const findEntity = id =>
    S.animals.find(a => a.id === id) || S.kids.find(k => k.id === id) || S.items.find(i => i.id === id);

  const isNight = () => gs && (gs.timeMin >= NIGHT_FROM || gs.timeMin < NIGHT_TO);

  // ---------- condition helpers ----------
  // hunger stages: full <30 | ok <60 | hungry <90 | starving >=90
  function starving(e) { return e.hunger >= STARVING_AT; }
  function sulking(e) { return e.kind === "kid" && e.boredom >= 90; }
  function neglected(e) { return e.kind === "animal" && e.affection <= 10; }
  function unhappy(e) { return starving(e) || sulking(e) || neglected(e); }
  // wellness 0..1 feeds the happiness engine (smoothly degrades with needs)
  function wellness(e) {
    const belly = 1 - e.hunger / 100;
    if (e.kind === "kid") return clamp01(Math.min(belly, 1 - e.boredom / 100));
    return clamp01(belly * (0.6 + 0.4 * (e.affection || 0) / 100));
  }
  function down(e) { return e.mode === "sleep" || starving(e); } // lying flat

  function nearestPlayer(x, y) {
    let best = null, bd = Infinity;
    for (const p of (gs && gs.players) || []) {
      const d = dist2(x, y, p.x, p.y);
      if (d < bd) { bd = d; best = p; }
    }
    return best ? { p: best, d2: bd } : null;
  }

  // ---------- household ----------
  const CRITTERS = [
    { species: "dog", name: "Sunny" },
    { species: "cat", name: "Momo", v: 0 }, { species: "cat", name: "Tora", v: 1 }, { species: "cat", name: "Kuro", v: 2 },
    { species: "chicken", name: "Piyo" }, { species: "chicken", name: "Mugi" }, { species: "chicken", name: "Coco" },
    { species: "sheep", name: "Fluffy" }, { species: "sheep", name: "Wooly" },
    { species: "cow", name: "Bessie" }, { species: "cow", name: "Moo" },
  ];
  const SPEED = { dog: 55, cat: 46, chicken: 30, sheep: 32, cow: 26, kid: 50 };
  const KID_NAMES = ["Aki", "Yui", "Ren", "Sora", "Hina", "Mio", "Noa", "Rin", "Emi"];
  const HAIR = ["#241a24", "#4a2c14", "#8a4a2a", "#d8a03c", "#7a4a8a", "#3a5a9a"];
  const SHIRT = ["#e05b5b", "#5b8ae0", "#5bd08a", "#e0b45b", "#a05be0", "#e07ba0", "#5bc8d0", "#8ad05b", "#d08a5b"];

  function freshFamily() {
    S.animals = CRITTERS.map((c, i) => makeAnimal(c.species, c.name, c.v, i + 1));
    S.kids = KID_NAMES.map((n, i) => makeKid(n, i + 1));
    S.items = []; S.fx = []; S.happy = 0; S.nextId = 1;
  }

  function makeAnimal(species, name, v, i) {
    return {
      id: "a" + i, kind: "animal", species, name, v: v || 0,
      x: rnd(PAST.x1, PAST.x2), y: rnd(PAST.y1, PAST.y2), tx: 0, ty: 0,
      dir: 1, step: rnd(0, 1), moving: false, mode: "idle", wait: rnd(0.5, 2.5),
      hunger: rnd(0, 25), affection: rnd(45, 70), prodT: 0, ready: false, petCd: 0,
    };
  }
  function makeKid(name, i) {
    const spot = pick(walkTiles("house"));
    return {
      id: "k" + i, kind: "kid", species: "kid", name,
      x: spot.x + rnd(-6, 6), y: spot.y + rnd(-6, 6), tx: 0, ty: 0, path: [], pathI: 0, stuckT: 0,
      dir: "down", step: rnd(0, 1), moving: false, mode: "idle", wait: rnd(0.5, 2.5),
      hunger: rnd(0, 30), boredom: rnd(10, 35), playT: 0, playCx: 0, playCy: 0, playR: 0, playA: 0, heartT: 0,
      hair: HAIR[i % HAIR.length], shirt: SHIRT[i % SHIRT.length], petCd: 0,
    };
  }
  // backfill fields for entities arriving from old saves / net snapshots
  function fixEntity(e) {
    if (e.kind === "kid" && e.boredom == null) e.boredom = 20;
    if (e.kind === "animal" && e.affection == null) e.affection = 50;
    if (!e.mode) e.mode = "idle";
    if (e.wait == null) e.wait = 1;
    return e;
  }

  // walkable tile centers per zone (computed lazily)
  const zoneTiles = {};
  function walkTiles(zoneName) {
    if (!zoneTiles[zoneName]) {
      const list = [];
      for (let ty = 0; ty < DH.world.H; ty++)
        for (let tx = 0; tx < DH.world.W; tx++)
          if (!DH.world.isSolid(tx, ty) && DH.world.zone(tx, ty) === zoneName)
            list.push({ x: tx * 32 + 16, y: ty * 32 + 16 });
      zoneTiles[zoneName] = list;
    }
    return zoneTiles[zoneName];
  }

  // ---------- mutations (remote-callable, by id) ----------
  const API = {
    feed(id) {
      const e = findEntity(id);
      if (!e || e.kind === "item" || !gs) return false;
      if (gs.coins < FEED_COST) { DH.toast("Not enough coins 🪙"); return false; }
      gs.coins -= FEED_COST;
      e.hunger = 0;
      if (e.mode === "sleep") e.mode = "idle";
      if (e.kind === "kid") e.boredom = Math.max(0, e.boredom - 15); // a fed kid is a calmer kid
      else e.affection = Math.min(100, e.affection + 5);             // feeding builds trust
      e.wait = Math.max(e.wait || 0, 0.4);
      hearts(e.x, e.y - 16, 3);
      addHappy(e.kind === "kid" ? 4 : 2.5);
      DH.toast(`Fed ${e.name}!`);
      return true;
    },
    pet(id) {
      const e = findEntity(id);
      if (!e || e.kind !== "animal") return false;
      if (e.hunger >= HUNGRY_AT) { DH.toast(`${e.name} is hungry — feed first`); return false; }
      if (e.petCd > 0) return false;
      e.petCd = 4;
      if (e.mode === "sleep") { e.mode = "idle"; e.wait = 0.5; }
      e.affection = Math.min(100, e.affection + PET_AFFECTION);
      hearts(e.x, e.y - 14, 2);
      addHappy(1.5);
      DH.toast(`${e.name} loves the attention! ❤`);
      return true;
    },
    playWith(id) {
      const e = findEntity(id);
      if (!e || e.kind !== "kid") return false;
      if (e.hunger >= HUNGRY_AT) { DH.toast(`${e.name} is too hungry to play — feed first`); return false; }
      if (e.petCd > 0) return false;
      e.petCd = 5;
      e.boredom = 0;
      e.mode = "play"; e.playT = 2.6; e.playCx = e.x; e.playCy = e.y;
      e.playR = rnd(10, 15); e.playA = rnd(0, 6.28); e.heartT = 0;
      hearts(e.x, e.y - 18, 3);
      addHappy(6);
      DH.toast(`Played with ${e.name}!`);
      return true;
    },
    wake(id) {
      const e = findEntity(id);
      if (!e || e.kind === "item" || e.mode !== "sleep") return false;
      e.mode = "idle"; e.wait = rnd(0.8, 2);
      hearts(e.x, e.y - 14, 1);
      DH.toast(`${e.name} woke up 💤`);
      return true;
    },
    collect(id) {
      const e = findEntity(id);
      if (!e || !gs) return false;
      if (e.kind === "item") { // egg on the ground
        S.items = S.items.filter(i => i.id !== id);
        gs.coins += EGG_COINS;
        addHappy(1);
        DH.toast(`Collected an egg +${EGG_COINS}🪙`);
        return true;
      }
      if (e.species === "cow" && e.ready) {
        e.ready = false; e.prodT = 0;
        gs.coins += MILK_COINS; addHappy(1.5);
        DH.toast(`Milked ${e.name} +${MILK_COINS}🪙`);
        return true;
      }
      if (e.species === "sheep" && e.ready) {
        e.ready = false; e.prodT = 0;
        gs.coins += WOOL_COINS; addHappy(1.5);
        DH.toast(`Sheared ${e.name} +${WOOL_COINS}🪙`);
        return true;
      }
      return false;
    },
    resetFamily() {
      try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
      freshFamily();
      DH.toast("A fresh family moved in! Save cleared 🐾", 3000);
      return true;
    },
  };

  // ---------- wander AI (host only) ----------
  function wanderAnimal(e, dt) {
    if (e.mode === "sleep") { e.moving = false; return; }
    if (starving(e)) { // too weak — flops down and gives up
      e.mode = "idle"; e.wait = 1; e.moving = false; return;
    }
    if (e.mode === "idle") {
      e.moving = false;
      e.wait -= dt;
      // a neglected pet shies away from approaching players
      if (e.affection <= NEGLECT_AT) {
        const near = nearestPlayer(e.x, e.y);
        if (near && near.d2 < 80 * 80) {
          const dx = e.x - near.p.x, dy = e.y - near.p.y, d = Math.hypot(dx, dy) || 1;
          e.tx = Math.max(PAST.x1, Math.min(PAST.x2, e.x + (dx / d) * 90));
          e.ty = Math.max(PAST.y1, Math.min(PAST.y2, e.y + (dy / d) * 60));
          e.mode = "walk"; e.wait = 0;
        }
      }
      if (e.wait <= 0 && e.mode === "idle") {
        if (isNight() && Math.random() < 0.4) { e.mode = "sleep"; return; }
        e.tx = Math.max(PAST.x1, Math.min(PAST.x2, e.x + rnd(-80, 80)));
        e.ty = Math.max(PAST.y1, Math.min(PAST.y2, e.y + rnd(-50, 50)));
        e.mode = "walk";
      }
      return;
    }
    const dx = e.tx - e.x, dy = e.ty - e.y, d = Math.hypot(dx, dy);
    if (d < 3) { e.mode = "idle"; e.wait = rnd(1, 3.5); e.moving = false; return; }
    const sp = SPEED[e.species] * (e.affection <= NEGLECT_AT ? 1.25 : 1) * dt;
    e.x += (dx / d) * sp; e.y += (dy / d) * sp;
    e.x = Math.max(PAST.x1, Math.min(PAST.x2, e.x));
    e.y = Math.max(PAST.y1, Math.min(PAST.y2, e.y));
    if (Math.abs(dx) > 2) e.dir = dx > 0 ? 1 : -1;
    e.moving = true; e.step += dt * 6;
  }

  function kidZone(e) {
    const z = DH.world.zone(Math.floor(e.x / 32), Math.floor(e.y / 32));
    return z === "house" || z === "pasture" ? z : "yard";
  }
  function kidTarget(e) {
    const cur = kidZone(e);
    // a kid who slid into the pasture can only leave via the gate waypoint
    const dest = cur === "pasture" ? "yard" : Math.random() < 0.22 ? (cur === "house" ? "yard" : "house") : cur;
    let goal = pick(walkTiles(dest));
    for (let i = 0; i < 6; i++) { // prefer nearby targets for natural wandering
      const g = pick(walkTiles(dest));
      if (dist2(g.x, g.y, e.x, e.y) < dist2(goal.x, goal.y, e.x, e.y)) goal = g;
    }
    goal = { x: goal.x + rnd(-8, 8), y: goal.y + rnd(-8, 8) };
    e.path = cur === "pasture" ? [GATE, GATE_OUT, goal] : dest === cur ? [goal] : [DOOR_IN, DOOR_OUT, goal];
    e.pathI = 0; e.stuckT = 0; e.mode = "walk";
  }
  function wanderKid(e, dt) {
    if (e.mode === "sleep") { e.moving = false; return; }
    if (starving(e)) { // flops down — too weak to play
      e.mode = "idle"; e.wait = 1; e.moving = false; return;
    }
    if (e.mode === "play") {
      if (sulking(e)) { e.mode = "idle"; e.wait = 1; e.moving = false; return; } // too gloomy to keep playing
      e.playT -= dt; e.heartT -= dt;
      e.boredom = Math.max(0, e.boredom - dt * 6);
      e.playA += dt * 3.4;
      const nx = e.playCx + Math.cos(e.playA) * e.playR;
      const ny = e.playCy + Math.sin(e.playA) * e.playR * 0.7;
      if (DH.world.canStand(nx, e.y)) e.x = nx;
      if (DH.world.canStand(e.x, ny)) e.y = ny;
      e.dir = Math.cos(e.playA) > 0.3 ? "right" : Math.cos(e.playA) < -0.3 ? "left" : "down";
      e.moving = true; e.step += dt * 9;
      if (e.heartT <= 0) { e.heartT = 0.7; hearts(e.x, e.y - 20, 1); }
      if (e.playT <= 0) { e.mode = "idle"; e.wait = rnd(0.5, 1.5); e.moving = false; }
      return;
    }
    if (e.mode === "idle") {
      e.moving = false;
      e.wait -= dt;
      if (e.wait <= 0) {
        if (isNight() && Math.random() < 0.5) { e.mode = "sleep"; return; }
        if (e.hunger < HUNGRY_AT && e.boredom < BORED_AT && Math.random() < 0.16) {
          e.mode = "play"; e.playT = rnd(2.5, 4.5); e.playCx = e.x; e.playCy = e.y;
          e.playR = rnd(10, 16); e.playA = rnd(0, 6.28); e.heartT = 0;
        } else kidTarget(e);
      }
      return;
    }
    const g = e.path[e.pathI];
    const dx = g.x - e.x, dy = g.y - e.y, d = Math.hypot(dx, dy);
    if (d < 4) {
      e.pathI++; e.stuckT = 0;
      if (e.pathI >= e.path.length) { e.mode = "idle"; e.wait = rnd(0.8, 2.5); e.moving = false; }
      return;
    }
    const sp = SPEED.kid * (e.boredom >= BORED_AT ? 0.45 : 1) * dt; // sulking kids drag their feet
    const nx = e.x + (dx / d) * sp, ny = e.y + (dy / d) * sp;
    let moved = false;
    if (Math.abs(dx) > 1 && DH.world.canStand(nx, e.y)) { e.x = nx; moved = true; }
    if (Math.abs(dy) > 1 && DH.world.canStand(e.x, ny)) { e.y = ny; moved = true; }
    if (!moved) { // slid to a stop on a wall — give up on this waypoint
      e.stuckT += dt;
      if (e.stuckT > 0.35) {
        e.pathI++; e.stuckT = 0;
        if (e.pathI >= e.path.length) { e.mode = "idle"; e.wait = rnd(0.5, 1.5); e.moving = false; }
      }
    }
    e.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up");
    e.moving = true; e.step += dt * 7;
  }

  function produce(e) {
    if (e.species === "chicken") {
      if (S.items.some(i => i.src === e.id)) return; // one egg waiting at a time
      if (S.items.length >= 12) return;              // don't carpet the pasture in eggs
      S.items.push({
        id: "i" + S.nextId++, kind: "item", item: "egg", src: e.id,
        x: Math.max(PAST.x1, Math.min(PAST.x2, e.x + rnd(-20, 20))),
        y: Math.max(PAST.y1, Math.min(PAST.y2, e.y + rnd(-14, 14))),
      });
    } else e.ready = true;
  }

  // ---------- tamagotchi persistence ----------
  function saveNow() {
    if (!gs || !S.animals.length) return;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        v: 1, savedAt: Date.now(), mod: M.serialize(),
        gs: { happiness: gs.happiness, coins: gs.coins, timeMin: gs.timeMin, day: gs.day || 0 },
      }));
    } catch (e) {}
  }
  function loadSave() {
    try {
      const d = JSON.parse(localStorage.getItem(SAVE_KEY) || "null");
      if (!d || !d.mod || !Array.isArray(d.mod.animals) || !d.mod.animals.length) return null;
      return d;
    } catch (e) { return null; }
  }

  // advance needs/production as if the family kept living at a slowed pace
  function applyOffline(offMin) {
    const off = Math.min(offMin, OFFLINE_CAP_MIN) * 60, r = OFFLINE_RATE;
    const res = { eggs: 0, matured: 0, hungry: 0, needCare: 0, missed: null };
    for (const e of S.animals) {
      const preHunger = e.hunger;
      e.hunger = Math.min(100, e.hunger + off * HUNGER_RATE.animal * r);
      e.affection = Math.max(0, (e.affection ?? 50) - off * AFFECTION_DECAY * r);
      e.petCd = 0;
      // harvestables still matured while you were away (if they weren't starving yet)
      const every = e.species === "chicken" ? EGG_EVERY : e.species === "cow" ? MILK_EVERY : e.species === "sheep" ? WOOL_EVERY : 0;
      if (every && preHunger < STARVING_AT && !e.ready) {
        const before = S.items.length;
        e.prodT += off * r;
        if (e.prodT >= every) { e.prodT = 0; produce(e); }
        if (e.species === "chicken") res.eggs += S.items.length - before;
        else if (e.ready) res.matured++;
      }
      if (unhappy(e)) res.needCare++; else if (e.hunger >= HUNGRY_AT) res.hungry++;
    }
    for (const e of S.kids) {
      e.hunger = Math.min(100, e.hunger + off * HUNGER_RATE.kid * r);
      e.boredom = Math.min(100, (e.boredom ?? 0) + off * BOREDOM_RATE * r);
      e.petCd = 0; e.mode = "idle"; e.path = []; e.pathI = 0; e.moving = false;
      if (unhappy(e)) res.needCare++; else if (e.hunger >= HUNGRY_AT) res.hungry++;
    }
    // everyone naps if it's nighttime in-game
    if (isNight())
      for (const e of S.animals.concat(S.kids))
        if (!starving(e)) e.mode = "sleep";
    // your most-attached pet missed you most
    const buddy = S.animals.filter(a => a.species === "dog" || a.species === "cat")
      .sort((a, b) => b.affection - a.affection)[0];
    res.missed = buddy ? buddy.name : null;
    return res;
  }
  function awaySummary(res, offMin) {
    const parts = [];
    if (res.eggs) parts.push(`the chickens laid ${res.eggs} egg${res.eggs > 1 ? "s" : ""}`);
    if (res.matured) parts.push(`${res.matured} ready to collect`);
    if (res.needCare) parts.push(`${res.needCare} need care ☹️`);
    else if (res.hungry) parts.push(`${res.hungry} got hungry`);
    if (res.missed) parts.push(`${res.missed} missed you!`);
    const hrs = offMin >= 90 ? ` (~${Math.round(offMin / 60)}h away)` : "";
    return `While you were away${hrs}… ${parts.join(" · ") || "all quiet at home"}`;
  }
  function familyReport() {
    const all = S.animals.concat(S.kids);
    const un = all.filter(unhappy).length;
    const hungry = all.filter(e => !unhappy(e) && e.hunger >= HUNGRY_AT).length;
    const asleep = all.filter(e => e.mode === "sleep").length;
    return `Family of ${all.length}: ${all.length - un - hungry - asleep} content · ${hungry} hungry · ${un} need care${asleep ? ` · ${asleep} asleep` : ""}`;
  }
  function openFamilyBoard() {
    DH.menu.open("🐾 Family board", [
      { ico: "📋", label: "Family report", cb: () => DH.toast(familyReport(), 4200) },
      { ico: "🧹", label: "Reset family save — a fresh family moves in", cb: () => API.resetFamily() },
    ]);
  }

  // ---------- contract ----------
  const M = (DH.animals = {
    authority: true, // host runs the AI; clients deserialize snapshots
    _state: S,       // debug/testing handle (not part of the sync contract)

    init(state) {
      gs = state;
      // collectDraws fns run before drawOverlay each frame, so grab ctx at init
      ctx2 = document.getElementById("cv").getContext("2d");
      if (!wired) {
        wired = true;
        document.addEventListener("visibilitychange", () => { if (document.hidden && M.authority) saveNow(); });
        window.addEventListener("pagehide", () => { if (M.authority) saveNow(); });
        window.addEventListener("beforeunload", () => { if (M.authority) saveNow(); });
      }
    },

    start(state) {
      gs = state;
      S.fx = [];
      const sv = loadSave();
      if (sv) {
        M.deserialize(sv.mod);
        if (sv.gs) {
          if (typeof sv.gs.happiness === "number") state.happiness = sv.gs.happiness;
          if (typeof sv.gs.coins === "number") state.coins = sv.gs.coins;
          if (typeof sv.gs.timeMin === "number") state.timeMin = sv.gs.timeMin;
          if (typeof sv.gs.day === "number") state.day = sv.gs.day;
        }
        const offMin = (Date.now() - (sv.savedAt || Date.now())) / 60000;
        if (offMin >= OFFLINE_MIN_NOTICE) {
          const res = applyOffline(offMin);
          setTimeout(() => DH.toast(awaySummary(res, offMin), 5600), 900);
        }
      } else freshFamily();
      saveT = 0; gloomT = 0;
    },

    update(dt, state) {
      gs = state;
      // FX always tick so remote clients still animate
      for (const f of S.fx) { f.y += f.vy * dt; f.life -= dt; }
      S.fx = S.fx.filter(f => f.life > 0);
      if (!M.authority) return;

      // autosave
      saveT += dt;
      if (saveT >= SAVE_EVERY) { saveT = 0; saveNow(); }

      const night = isNight();
      for (const e of S.animals) {
        e.hunger = Math.min(100, e.hunger + dt * HUNGER_RATE.animal * (e.mode === "sleep" ? 0.55 : 1));
        e.affection = Math.max(0, e.affection - dt * AFFECTION_DECAY);
        e.petCd = Math.max(0, e.petCd - dt);
        if (!night && e.mode === "sleep") { e.mode = "idle"; e.wait = rnd(0.5, 2); }
        if (e.hunger < HUNGRY_AT && e.mode !== "sleep") {
          const every = e.species === "chicken" ? EGG_EVERY : e.species === "cow" ? MILK_EVERY : e.species === "sheep" ? WOOL_EVERY : 0;
          if (every && !e.ready) { e.prodT += dt; if (e.prodT >= every) { e.prodT = 0; produce(e); } }
        }
        wanderAnimal(e, dt);
      }
      for (const e of S.kids) {
        e.hunger = Math.min(100, e.hunger + dt * HUNGER_RATE.kid * (e.mode === "sleep" ? 0.55 : 1));
        if (e.mode === "sleep") e.boredom = Math.max(0, e.boredom - dt * 2); // rested
        else e.boredom = Math.min(100, e.boredom + dt * BOREDOM_RATE);
        e.petCd = Math.max(0, e.petCd - dt);
        if (!night && e.mode === "sleep") { e.mode = "idle"; e.wait = rnd(0.5, 2); }
        wanderKid(e, dt);
      }

      // happiness engine: drift this module's contribution toward the cared-for
      // target; apply only the delta so other modules compose cleanly. When more
      // than half the family is unhappy the home turns gloomy and drains away.
      let wellK = 0, wellA = 0, un = 0;
      for (const e of S.animals) { wellA += wellness(e); if (unhappy(e)) un++; }
      for (const e of S.kids) { wellK += wellness(e); if (unhappy(e)) un++; }
      const total = S.animals.length + S.kids.length || 1;
      const frac = un / total;
      let target = Math.min(100, wellK * 8 + wellA * 3);
      if (frac > 0.5) target -= 75; else if (frac > 0.3) target -= 30;
      const d = Math.max(-2.5 * dt, Math.min(2.5 * dt, target - S.happy));
      addHappy(d);
      if (frac > 0.5) {
        gloomT -= dt;
        if (gloomT <= 0) { gloomT = 14; DH.toast("The home feels gloomy — the family needs care ☹️", 2800); }
      } else gloomT = 0;
    },

    interactables(p) {
      const out = [];
      const pZone = DH.world.zone(Math.floor(p.x / 32), Math.floor(p.y / 32));
      const inPasture = pZone === "pasture";
      const ds = dist2(p.x, p.y, SIGN.x, SIGN.y);
      if (ds < SIGN.r * SIGN.r)
        out.push({ label: "Family board 🐾", x: SIGN.x, y: SIGN.y, action: openFamilyBoard });
      for (const it of S.items) {
        if (!inPasture) continue; // no reaching through the fence
        if (dist2(p.x, p.y, it.x, it.y) < INTERACT_R * INTERACT_R)
          out.push({ label: `Collect ${it.item}`, x: it.x, y: it.y, action: () => API.collect(it.id) });
      }
      for (const e of S.animals) {
        if (!inPasture) continue;
        if (dist2(p.x, p.y, e.x, e.y) >= INTERACT_R * INTERACT_R) continue;
        if (e.mode === "sleep")
          out.push({ label: `Wake ${e.name} 💤`, x: e.x, y: e.y, action: () => API.wake(e.id) });
        else if (e.hunger >= HUNGRY_AT)
          out.push({ label: `Feed ${e.name} · ${FEED_COST}🪙`, x: e.x, y: e.y, action: () => API.feed(e.id) });
        else if ((e.species === "cow" || e.species === "sheep") && e.ready)
          out.push({ label: `${e.species === "cow" ? "Milk" : "Shear"} ${e.name}`, x: e.x, y: e.y, action: () => API.collect(e.id) });
        else
          out.push({ label: `Pet ${e.name}${e.affection <= NEGLECT_AT ? " 💔" : ""}`, x: e.x, y: e.y, action: () => API.pet(e.id) });
      }
      for (const e of S.kids) {
        if (kidZone(e) === "house" && pZone !== "house") continue; // no reaching through walls
        if (dist2(p.x, p.y, e.x, e.y) >= INTERACT_R * INTERACT_R) continue;
        if (e.mode === "sleep")
          out.push({ label: `Wake ${e.name} 💤`, x: e.x, y: e.y, action: () => API.wake(e.id) });
        else if (e.hunger >= HUNGRY_AT)
          out.push({ label: `Feed ${e.name} · ${FEED_COST}🪙`, x: e.x, y: e.y, action: () => API.feed(e.id) });
        else
          out.push({ label: `Play with ${e.name}${e.boredom >= BORED_AT ? " 🪀" : ""}`, x: e.x, y: e.y, action: () => API.playWith(e.id) });
      }
      out.sort((a, b) => dist2(p.x, p.y, a.x, a.y) - dist2(p.x, p.y, b.x, b.y));
      return out;
    },

    // ----- drawing -----
    collectDraws(draws, camX, camY) {
      const sp = DH.sprites;
      draws.push({ y: SIGN.y + 8, fn: () => drawSign(ctx2, SIGN.x - camX, SIGN.y - camY) });
      for (const it of S.items)
        draws.push({ y: it.y, fn: () => { sp.shadow(ctx2, it.x - camX, it.y - camY, 10); drawEgg(ctx2, it.x - camX, it.y - camY); } });
      for (const e of S.animals)
        draws.push({ y: e.y, fn: () => { sp.shadow(ctx2, e.x - camX, e.y - camY, e.species === "cow" ? 24 : e.species === "chicken" ? 12 : 18); drawAnimal(ctx2, e, e.x - camX, e.y - camY); } });
      for (const e of S.kids)
        draws.push({ y: e.y, fn: () => { sp.shadow(ctx2, e.x - camX, e.y - camY, 14); drawKid(ctx2, e, e.x - camX, e.y - camY); } });
    },

    drawOverlay(ctx, camX, camY, state) {
      ctx2 = ctx;
      const sp = DH.sprites;
      const ents = S.animals.concat(S.kids);
      for (const e of ents) {
        const sx = e.x - camX, sy = e.y - camY;
        const h = e.kind === "kid" ? 26 : e.species === "cow" || e.species === "sheep" ? 18 : e.species === "chicken" ? 15 : 20;
        const bobY = sy - h - 8 + Math.sin(Date.now() / 300 + e.x) * 1.5;
        // floating condition marker (visible at any distance)
        if (e.mode === "sleep") drawZzz(ctx, sx, bobY);
        else if (starving(e) || sulking(e)) sp.sad(ctx, sx, bobY);
        else if (e.hunger >= HUNGRY_AT) drawBowl(ctx, sx, bobY);
        else if (e.ready) drawProduct(ctx, e.species, sx, bobY);
        else if (neglected(e)) sp.heart(ctx, sx, bobY, 5, "#8a8a95"); // gray heart — feeling unloved
        // name + status icon when a player is close enough to interact
        const near = state.players.some(p => dist2(p.x, p.y, e.x, e.y) < 60 * 60);
        if (near) {
          ctx.font = "bold 9px sans-serif"; ctx.textAlign = "center";
          const w = ctx.measureText(e.name).width;
          ctx.fillStyle = "#00000066"; ctx.fillText(e.name, sx + 1, sy - h - 14);
          ctx.fillStyle = unhappy(e) || e.hunger >= HUNGRY_AT ? "#ffd76b" : "#ffffffee";
          ctx.fillText(e.name, sx, sy - h - 15);
          drawStatusIcon(ctx, sx + w / 2 + 9, sy - h - 19, e);
        }
      }
      for (const f of S.fx) {
        ctx.globalAlpha = Math.max(0, f.life / f.max);
        sp.heart(ctx, f.x - camX, f.y - camY, 5);
        ctx.globalAlpha = 1;
      }
    },

    // ----- sync boundary -----
    serialize() {
      return JSON.parse(JSON.stringify({
        animals: S.animals, kids: S.kids, items: S.items, happy: S.happy, nextId: S.nextId,
      }));
    },
    deserialize(data) {
      if (!data) return;
      S.animals = (data.animals || []).map(fixEntity);
      S.kids = (data.kids || []).map(fixEntity);
      S.items = data.items || [];
      S.happy = data.happy || 0;
      S.nextId = data.nextId || 1;
    },
    remoteAction(name, args) {
      return typeof API[name] === "function" ? API[name].apply(null, args || []) : false;
    },

    feed: API.feed, pet: API.pet, playWith: API.playWith, collect: API.collect,
    wake: API.wake, resetFamily: API.resetFamily, saveNow,
  });

  // ---------- sprite drawing ----------
  let ctx2 = null; // set in init(); drawOverlay also refreshes it from its ctx arg
  const R = (x, y, w, h, c) => { ctx2.fillStyle = c; ctx2.fillRect(x, y, w, h); };

  function drawEgg(ctx, x, y) {
    ctx2 = ctx;
    R(x - 3, y - 6, 6, 6, "#f5f2e8"); R(x - 2, y - 7, 4, 1, "#fffdf5");
  }

  function drawProduct(ctx, species, x, y) {
    ctx2 = ctx;
    if (species === "cow") { R(x - 3, y - 4, 6, 7, "#fffdf5"); R(x - 2, y - 5, 4, 1, "#d8e8f0"); }
    else { R(x - 4, y - 4, 8, 7, "#f0eee4"); R(x - 2, y - 5, 4, 1, "#fffdf5"); } // wool puff
  }

  // "feed me" marker — a little food bowl
  function drawBowl(ctx, x, y) {
    ctx2 = ctx;
    R(x - 5, y - 3, 10, 4, "#7a4a2c");
    R(x - 4, y - 4, 8, 1, "#5f3a22");
    R(x - 3, y - 6, 6, 3, "#e0b45b"); // kibble
    R(x - 1, y - 6, 2, 1, "#ffd76b");
  }

  function drawZzz(ctx, x, y) {
    ctx.font = "bold 8px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#dfe8ff";
    ctx.fillText("z", x + 3, y - 2);
    ctx.font = "bold 6px sans-serif";
    ctx.fillText("z", x + 7, y - 7);
  }

  // tiny status icon shown next to the name when a player is nearby
  function drawStatusIcon(ctx, x, y, e) {
    if (e.mode === "sleep") { drawZzz(ctx, x - 2, y + 4); return; }
    if (starving(e) || sulking(e)) { DH.sprites.sad(ctx, x, y, 4.5); return; }
    if (e.hunger >= HUNGRY_AT) { drawBowl(ctx, x, y + 2); return; }
    if (neglected(e)) { DH.sprites.heart(ctx, x, y, 4.5, "#8a8a95"); return; }
    DH.sprites.heart(ctx, x, y, 4.5); // content/loved
  }

  function drawSign(ctx, x, y) {
    ctx2 = ctx;
    R(x - 2, y - 12, 4, 14, "#6e4a2a");            // post
    R(x - 11, y - 24, 22, 13, "#a0733f");          // board
    R(x - 11, y - 24, 22, 2, "#c09055");           // board top edge
    R(x - 11, y - 13, 22, 2, "#7a5527");           // board bottom edge
    DH.sprites.heart(ctx, x, y - 17, 4, "#ff5b7f"); // little painted heart
  }

  function drawAnimal(ctx, e, x, y) {
    ctx2 = ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(e.dir, 1);
    if (down(e)) ctx.scale(1.08, 0.68);           // flopped down — sleeping or starving
    else if (e.moving) ctx.translate(0, -Math.abs(Math.sin(e.step * Math.PI * 2)) * 1.2);
    switch (e.species) {
      case "dog": {
        R(-10, -12, 20, 9, "#e0a840");            // body
        R(4, -9, 6, 5, "#f0d090");                // chest
        R(-8, -4, 3, 4, "#c89030"); R(-2, -4, 3, 4, "#c89030");
        R(4, -4, 3, 4, "#c89030"); R(9, -4, 3, 4, "#c89030"); // legs
        R(6, -19, 10, 9, "#e0a840");              // head
        R(6, -20, 4, 5, "#b07f28"); R(14, -19, 3, 4, "#b07f28"); // floppy ears
        R(14, -14, 4, 3, "#d89838");              // snout
        R(17, -14, 2, 2, "#3a2a18");              // nose
        R(11, -16, 2, 2, "#241a24");              // eye
        const wag = Math.sin(Date.now() / 120 + e.x) > 0 ? 0 : -1;
        R(-14, -13 + wag, 5, 3, "#e0a840");       // tail
        break;
      }
      case "cat": {
        const body = ["#9a9aa5", "#d88a3a", "#2a2a33"][e.v];
        const dark = ["#6a6a75", "#b06a24", "#55555f"][e.v];
        R(-7, -9, 14, 7, body);
        R(-4, -9, 2, 7, dark); R(1, -9, 2, 7, dark); // stripes
        R(-5, -3, 2, 3, dark); R(3, -3, 2, 3, dark); // legs
        R(3, -14, 9, 8, body);                    // head
        R(4, -16, 3, 3, body); R(9, -16, 3, 3, body); // ears
        R(10, -11, 2, 2, "#e8a0a8");              // nose
        R(7, -12, 2, 2, "#1a1a1a");               // eye
        R(-11, -9, 4, 2, body); R(-13, -12, 2, 5, body); // curled tail
        if (e.v === 2) R(4, -6, 4, 4, "#f0eee4"); // kuro's white chest
        break;
      }
      case "chicken": {
        R(-5, -8, 10, 7, "#f5f2e8");              // body
        R(-3, -7, 6, 4, "#e8e0cc");               // wing
        R(-2, -2, 1, 2, "#f0a030"); R(2, -2, 1, 2, "#f0a030"); // legs
        R(2, -13, 6, 5, "#f5f2e8");               // head
        R(3, -15, 4, 2, "#e04848");               // comb
        R(8, -11, 3, 2, "#f0a030");               // beak
        R(4, -12, 1, 1, "#1a1a1a");               // eye
        R(-8, -10, 4, 4, "#f5f2e8");              // tail
        break;
      }
      case "sheep": {
        const wool = "#f0eee4", puff = e.ready ? "#fffdf5" : wool;
        R(-10, -13, 20, 10, wool);                // body
        R(-12, -11, 4, 5, puff); R(8, -11, 4, 5, puff);
        R(-5, -15, 10, 3, puff);                  // fluff bumps
        if (e.ready) { R(-9, -16, 6, 3, puff); R(3, -16, 6, 3, puff); }
        R(-8, -4, 3, 4, "#4a3a30"); R(-2, -4, 3, 4, "#4a3a30");
        R(4, -4, 3, 4, "#4a3a30"); R(9, -4, 3, 4, "#4a3a30");   // legs
        R(7, -13, 7, 7, "#4a3a30");               // face
        R(8, -12, 2, 2, "#f0eee4");               // eye glint
        R(6, -14, 3, 2, "#4a3a30"); R(13, -14, 3, 2, "#4a3a30"); // ears
        break;
      }
      case "cow": {
        R(-11, -13, 22, 10, "#f5f2ea");           // body
        R(-6, -11, 5, 4, "#2a2a33"); R(2, -9, 4, 4, "#2a2a33"); R(-10, -6, 3, 3, "#2a2a33"); // spots
        R(-8, -4, 3, 4, "#d8d0c0"); R(-2, -4, 3, 4, "#d8d0c0");
        R(4, -4, 3, 4, "#d8d0c0"); R(9, -4, 3, 4, "#d8d0c0");   // legs
        R(8, -16, 9, 9, "#f5f2ea");               // head
        R(12, -10, 6, 4, "#e8a8a0");              // snout
        R(8, -18, 3, 2, "#d8c890"); R(15, -18, 3, 2, "#d8c890"); // horns
        R(7, -15, 2, 3, "#d8d0c0"); R(17, -15, 2, 3, "#d8d0c0"); // ears
        R(11, -14, 2, 2, "#1a1a1a");              // eye
        R(-14, -12, 2, 6, "#d8d0c0");             // tail
        if (e.ready) R(2, -4, 6, 4, "#e8a8a0");   // full udder
        break;
      }
    }
    ctx.restore();
  }

  function drawKid(ctx, e, x, y) {
    ctx2 = ctx;
    ctx.save();
    ctx.translate(x, y);
    const bob = Math.sin(e.step * Math.PI * 2) * 1;
    const leg = Math.sin(e.step * Math.PI * 2) * 2;
    if (down(e)) ctx.scale(1.12, 0.62);           // flopped down — asleep or starving
    else ctx.translate(0, bob * -0.4);
    const flip = e.dir === "left" ? -1 : 1;
    ctx.scale(flip, 1);
    // legs
    R(-4, -6, 3, 6 + (leg > 0 ? leg : 0), "#3a3a4a");
    R(1, -6, 3, 6 + (leg < 0 ? -leg : 0), "#3a3a4a");
    // body
    R(-6, -15, 12, 9, e.shirt);
    R(-8, -14, 3, 7, e.shirt); R(5, -14, 3, 7, e.shirt); // arms
    // head
    R(-6, -24, 12, 10, "#f2c9a0");
    R(-7, -26, 14, 5, e.hair);                    // hair cap
    R(-7, -22, 3, 5, e.hair); R(4, -22, 3, 5, e.hair); // side tufts
    const look = e.dir === "right" ? 1 : 0;
    R(-3 + look, -20, 2, 2, "#1a1a1a"); R(2 + look, -20, 2, 2, "#1a1a1a"); // eyes
    R(-1 + look, -16, 3, 1, "#c08060");           // mouth
    ctx.restore();
  }
})();
