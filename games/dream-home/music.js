/* dream-home music module — live shows, players, island tune & flag, TV,
   court scoreboard, morning stretch (AC spec K-1..K-6).
   Contract with game.js (self-registers via DH.register at the bottom):
     DH.music.init(state) / start(state) / update(dt,state)
     DH.music.collectDraws(draws, camX, camY) — stage platform, Toto, music
       board, flag pole, scoreboard sign, placed devices
     DH.music.drawOverlay(ctx, camX, camY, state) — concert FX, stretch game,
       TV program, floating notes/hearts
     DH.music.interactables(p) -> [{label,x,y,action}]
     DH.music.serialize()/deserialize(data)/remoteAction(name,args)/offline(offMin)

   K-1 Saturday live: real-clock Sat 20:00-23:59 → Toto the dog plays the yard
       stage; "Listen"/"Request a song" (Bubblegum Koto / Driver Zuza /
       Starlight Drive) plays an 8-bar WebAudio chiptune loop; listening
       through earns a record-<song> item.
   K-2 Players: 'radio' & 'record-player' items (music shop on the board) get
       set down inside the house and loop acquired records until switched off;
       the playing song is persisted on the device.
   K-3 Island tune & flag: 8-step x 5-pitch composer on the music board; the
       saved melody is the day-start fanfare + villager greeting jingle.
       Flag designer: emblem + 2 colors drawn on the house door pole.
   K-4 TV/radio: 'tv' device (and any furniture 'tv') plays a tiny animated
       program — weather forecast off DH.env when present, else a silly show;
       powered-on radios chime an hourly time signal.
   K-5 Scoreboard sign at the basketball court reads DH.court (defensive).
   K-6 Morning stretch 6:00-9:00 at the plaza: tap-the-beat mini game,
       ~10 beats → happiness + alog; nearby villagers join in.

   Net-sync boundary: sim state is plain JSON in S (devices, tune, flag,
   show, stretch). Guests never run update(); they render deserialize()
   snapshots and hear music via syncAudio() in drawOverlay. Mutations are
   named API fns reachable via remoteAction(name,args) or host-side actAt.
   All audio is synthesized WebAudio (no files) — the AudioContext unlocks on
   the first real input gesture, silently until then.
*/
(function () {
  const DH = (window.DH = window.DH || {});
  const T = 32;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

  // ---------- tuning ----------
  const INTERACT_R = 42;
  const SHOW_START_H = 20;                     // Saturday 20:00-23:59 real time
  const LISTEN_MS = 14000;                     // a full watch → earns the record
  const STRETCH_FROM = 6 * 60, STRETCH_TO = 9 * 60; // game minutes
  const STRETCH_BEATS = 10, BEAT_MS = 720, BEAT_WIN = 250;
  const SAVE_EVERY = 8;
  const DEV_COST = { radio: 300, "record-player": 500, tv: 800 };

  // ---------- world spots ----------
  const STAGE_TILES = [[21, 10], [22, 10]];              // blocked platform tiles
  const STAGE = { x: 21.5 * T, y: 10 * T + 22 };         // Toto's perform spot
  const STAGE_PT = { x: 21.5 * T, y: 11.7 * T };         // listen/gather point
  const BOARD = { tx: 20, ty: 10 };                      // music board (blocked)
  const BOARD_PT = { x: 20 * T + 16, y: 10 * T + 26 };
  const PLAZA = { x: 19 * T, y: 12.5 * T };              // stretch circle, just west of the stage
  const FLAGPOLE = { x: 8 * T + 26, y: 9 * T + 4 };      // house front wall
  const SCORE = { x: 10.5 * T, y: 12.5 * T };            // court scoreboard sign
  const PROTECTED = new Set(["9,8", "9,9", "9,10", "10,9", "10,10", "8,9"]);

  // ---------- items ----------
  const E = DH.items.def;
  E("radio", { name: "Radio", ico: "📻", cat: "furniture", price: DEV_COST.radio, stack: 5 });
  E("record-player", { name: "Record player", ico: "🎶", cat: "furniture", price: DEV_COST["record-player"], stack: 5 });
  E("tv", { name: "TV", ico: "📺", cat: "furniture", price: DEV_COST.tv, stack: 5 });

  // ---------- tunes ----------
  // [beat, midi, len(beats)]; 8 bars of 4 beats = 32 beats each
  const TUNES = {
    bubblegum: {
      name: "Bubblegum Koto", ico: "🫧", bpm: 132,
      lead: [
        [0, 76, 0.5], [0.5, 79, 0.5], [1, 81, 1], [2, 79, 1], [3, 76, 1],
        [4, 74, 0.5], [4.5, 76, 0.5], [5, 74, 1], [6, 72, 2],
        [8, 76, 0.5], [8.5, 79, 0.5], [9, 81, 1], [10, 83, 1], [11, 81, 1],
        [12, 79, 0.5], [12.5, 81, 0.5], [13, 79, 1], [14, 76, 2],
        [16, 81, 0.5], [16.5, 83, 0.5], [17, 84, 1], [18, 81, 1], [19, 79, 1],
        [20, 76, 0.5], [20.5, 79, 0.5], [21, 76, 1], [22, 74, 2],
        [24, 74, 0.5], [24.5, 76, 0.5], [25, 79, 1], [26, 76, 1], [27, 74, 1],
        [28, 72, 1], [29, 74, 0.5], [29.5, 76, 0.5], [30, 79, 2],
      ],
      bass: [
        [0, 48, 1], [1, 55, 1], [2, 48, 1], [3, 55, 1],
        [4, 41, 1], [5, 48, 1], [6, 41, 1], [7, 48, 1],
        [8, 45, 1], [9, 52, 1], [10, 45, 1], [11, 52, 1],
        [12, 43, 1], [13, 50, 1], [14, 43, 1], [15, 50, 1],
        [16, 48, 1], [17, 55, 1], [18, 48, 1], [19, 55, 1],
        [20, 41, 1], [21, 48, 1], [22, 41, 1], [23, 48, 1],
        [24, 43, 1], [25, 50, 1], [26, 43, 1], [27, 50, 1],
        [28, 48, 1], [29, 55, 1], [30, 48, 1], [31, 55, 1],
      ],
    },
    driver: {
      name: "Driver Zuza", ico: "🏎️", bpm: 148,
      lead: [
        [0, 69, 0.5], [0.5, 69, 0.5], [1, 72, 0.5], [1.5, 74, 0.5], [2, 76, 1], [3, 74, 0.5], [3.5, 72, 0.5],
        [4, 69, 0.5], [4.5, 69, 0.5], [5, 72, 0.5], [5.5, 74, 0.5], [6, 76, 1], [7, 79, 1],
        [8, 81, 0.5], [8.5, 79, 0.5], [9, 76, 0.5], [9.5, 74, 0.5], [10, 76, 1], [11, 72, 1],
        [12, 69, 1], [13, 71, 0.5], [13.5, 72, 0.5], [14, 74, 2],
        [16, 76, 0.5], [16.5, 79, 0.5], [17, 81, 1], [18, 79, 0.5], [18.5, 76, 0.5], [19, 74, 1],
        [20, 76, 0.5], [20.5, 81, 0.5], [21, 79, 1], [22, 76, 1], [23, 74, 1],
        [24, 81, 0.5], [24.5, 83, 0.5], [25, 81, 0.5], [25.5, 79, 0.5], [26, 76, 1], [27, 74, 1],
        [28, 72, 0.5], [28.5, 74, 0.5], [29, 76, 1], [30, 69, 1], [31, 69, 1],
      ],
      bass: [
        [0, 45, 0.5], [0.5, 45, 0.5], [1, 45, 0.5], [1.5, 45, 0.5], [2, 48, 0.5], [2.5, 48, 0.5], [3, 45, 1],
        [4, 45, 0.5], [4.5, 45, 0.5], [5, 45, 0.5], [5.5, 45, 0.5], [6, 43, 0.5], [6.5, 43, 0.5], [7, 43, 1],
        [8, 41, 0.5], [8.5, 41, 0.5], [9, 41, 0.5], [9.5, 41, 0.5], [10, 45, 0.5], [10.5, 45, 0.5], [11, 45, 1],
        [12, 45, 0.5], [12.5, 45, 0.5], [13, 47, 0.5], [13.5, 47, 0.5], [14, 48, 2],
        [16, 50, 0.5], [16.5, 50, 0.5], [17, 50, 0.5], [17.5, 50, 0.5], [18, 50, 0.5], [18.5, 50, 0.5], [19, 48, 1],
        [20, 50, 0.5], [20.5, 50, 0.5], [21, 50, 1], [22, 45, 1], [23, 43, 1],
        [24, 41, 0.5], [24.5, 41, 0.5], [25, 41, 0.5], [25.5, 41, 0.5], [26, 45, 0.5], [26.5, 45, 0.5], [27, 45, 1],
        [28, 43, 0.5], [28.5, 43, 0.5], [29, 45, 0.5], [29.5, 45, 0.5], [30, 47, 1], [31, 45, 1],
      ],
    },
    starlight: {
      name: "Starlight Drive", ico: "🌠", bpm: 96,
      lead: [
        [0, 77, 1], [1, 81, 1], [2, 84, 1], [3, 81, 1],
        [4, 76, 1], [5, 79, 1], [6, 83, 1], [7, 79, 1],
        [8, 74, 1], [9, 77, 1], [10, 81, 1], [11, 77, 1],
        [12, 76, 1], [13, 79, 1], [14, 83, 1], [15, 79, 1],
        [16, 77, 1], [17, 81, 1], [18, 84, 1], [19, 88, 1],
        [20, 86, 1], [21, 83, 1], [22, 79, 1], [23, 81, 1],
        [24, 77, 2], [26, 76, 1], [27, 74, 1],
        [28, 72, 2], [30, 77, 1], [31, 81, 1],
      ],
      bass: [
        [0, 41, 2], [2, 48, 2], [4, 36, 2], [6, 43, 2],
        [8, 38, 2], [10, 45, 2], [12, 40, 2], [14, 47, 2],
        [16, 41, 2], [18, 48, 2], [20, 38, 2], [22, 45, 2],
        [24, 43, 2], [26, 40, 2], [28, 41, 2], [30, 48, 2],
      ],
    },
  };
  const SONG_IDS = Object.keys(TUNES);
  SONG_IDS.forEach(id =>
    E("record-" + id, { name: `Record: ${TUNES[id].name}`, ico: "💿", cat: "misc", price: 120, stack: 5 }));

  // island tune pitches (pentatonic, 5 rows) — index 0 = rest
  const PITCHES = [0, 72, 74, 76, 79, 81]; // C5 D5 E5 G5 A5
  const PITCH_LABEL = ["·", "do", "re", "mi", "so", "la"];

  // ---------- module state (plain JSON only — save bus + net snapshots) ----------
  let gs = null;
  const S = {
    tune: [4, 2, 3, 1, 3, 4, 5, 3],         // island tune: 8 steps of PITCHES idx
    flag: { e: "heart", c1: "#e04848", c2: "#fff6e8" },
    devices: [],                             // {uid,id,tx,ty,on,song}
    nextUid: 1,
    got: {},                                 // songId -> real dateKey of last grant
    heard: [],                               // songIds ever played live
    show: { song: null, t0: 0 },             // live stage: current song + wall-clock start
    stretch: { on: false, day: -1, t0: 0, hits: 0, joined: 0, best: 0, lastBeat: -1, hitBeat: -1 },
    lastDay: -1, lastHour: -1,
    greet: {},                               // villager id -> dayStamp jingle played
    courtBest: 0,
  };
  // view layer only
  const fx = [];
  let ctxG = null;
  const ui = { composer: null, flag: null }; // DOM overlay handles
  const devTiles = new Set();                // "tx,ty" my devices block
  let saveT = 0;
  const alog = (e, d) => { if (DH.alog) DH.alog.add(e, d); };
  const addHappy = n => { if (gs) gs.happiness = Math.max(0, gs.happiness + n); };
  const dateKey = () => { const d = new Date(); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); };
  const dayStamp = () => Math.floor((gs && gs.day) || 0);
  const timeMin = () => (gs && typeof gs.timeMin === "number" ? gs.timeMin : 720);
  const liveNow = () => { const d = new Date(); return M._forceLive || (d.getDay() === 6 && d.getHours() >= SHOW_START_H); };
  const stretchHours = () => { const t = timeMin(); return t >= STRETCH_FROM && t < STRETCH_TO; };
  const vils = () => { try { return (DH.villagers && DH.villagers._state && DH.villagers._state.vils) || []; } catch (e) { return []; } };

  // ---------- tiny WebAudio chiptune engine ----------
  const AFX = {
    ctx: null, master: null, loops: {},
    ensure() {
      if (!AFX.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        try {
          AFX.ctx = new AC();
          AFX.master = AFX.ctx.createGain();
          AFX.master.gain.value = 0.5;
          AFX.master.connect(AFX.ctx.destination);
        } catch (e) { return null; }
      }
      if (AFX.ctx.state === "suspended") { try { AFX.ctx.resume(); } catch (e) {} }
      return AFX.ctx;
    },
    tone(freq, t0, dur, wave, vol) {
      const ctx = AFX.ensure(); if (!ctx) return;
      try {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = wave || "square"; o.frequency.value = freq;
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(vol, t0 + 0.012);
        g.gain.setValueAtTime(vol, t0 + Math.max(0.02, dur - 0.04));
        g.gain.linearRampToValueAtTime(0, t0 + dur);
        o.connect(g); g.connect(AFX.master);
        o.start(t0); o.stop(t0 + dur + 0.02);
      } catch (e) {}
    },
    // one-shot sequence: notes = [[beatOffset, midi|0 rest, lenBeats]]
    seq(notes, bpm, wave, vol) {
      const ctx = AFX.ensure(); if (!ctx) return;
      const bs = 60 / bpm, t0 = ctx.currentTime + 0.05;
      for (const [b, m, l] of notes) if (m) AFX.tone(mtof(m), t0 + b * bs, l * bs * 0.92, wave || "triangle", vol || 0.18);
    },
    click() { const ctx = AFX.ensure(); if (!ctx) return; AFX.tone(1560, ctx.currentTime + 0.01, 0.05, "square", 0.10); },
    chime() { const ctx = AFX.ensure(); if (!ctx) return; AFX.tone(1046, ctx.currentTime + 0.01, 0.09, "triangle", 0.2); },
    jingle() { AFX.seq([[0, 79, 0.4], [0.4, 76, 0.4], [0.8, 72, 0.8]], 300, "triangle", 0.2); }, // hourly radio signal
    startLoop(id, songId) {
      AFX.stopLoop(id);
      const ctx = AFX.ensure(); if (!ctx) return;
      const song = songId === "island" ? islandSong() : TUNES[songId];
      if (!song) return;
      const total = Math.max(4, Math.ceil(Math.max(0, ...song.lead.map(n => n[0] + n[2]), ...song.bass.map(n => n[0] + n[2]))), 4);
      const bs = 60 / song.bpm;
      let beat = 0, next = ctx.currentTime + 0.08;
      const timer = setInterval(() => {
        if (!AFX.ctx || ctx.state !== "running") return;
        try {
          while (next < ctx.currentTime + 0.35) {
            const b = beat % total;
            for (const [nb, nm, nl] of song.lead) if (nb === b) AFX.tone(mtof(nm), next, nl * bs * 0.92, "square", 0.15);
            for (const [nb, nm, nl] of song.bass) if (nb === b) AFX.tone(mtof(nm), next, nl * bs * 0.95, "triangle", 0.18);
            beat++; next += bs;
          }
        } catch (e) {}
      }, 110);
      AFX.loops[id] = { stop: () => clearInterval(timer), song: songId };
    },
    stopLoop(id) { const l = AFX.loops[id]; if (l) { try { l.stop(); } catch (e) {} delete AFX.loops[id]; } },
    stopAll() { for (const k in AFX.loops) AFX.stopLoop(k); },
  };
  function islandSong() { // the composed island tune as a loopable 4-bar song
    const lead = [], bass = [];
    S.tune.forEach((p, i) => { if (p) lead.push([i * 2, PITCHES[p] || 72, 1.4]); });
    bass.push([0, 48, 2], [8, 43, 2]);
    return { name: "Island tune", ico: "🎼", bpm: 150, lead, bass, bars: 4 };
  }
  // desired loops: {loopKey -> songId|"island"} — kept running by syncAudio
  function desiredLoops() {
    const want = {};
    if (S.show.song) want.stage = S.show.song;
    for (const d of S.devices) if (d.on && d.id !== "tv") want["dev" + d.uid] = d.song || "island";
    return want;
  }
  function syncAudio() {
    const want = desiredLoops();
    for (const k in AFX.loops) if (!want[k] || want[k] !== AFX.loops[k].song) AFX.stopLoop(k);
    for (const k in want) if (!AFX.loops[k]) AFX.startLoop(k, want[k]);
  }

  // ---------- fx ----------
  function fxP(k, x, y, o) {
    if (fx.length < 110) fx.push(Object.assign({ k, x, y, vx: 0, vy: -22, born: Date.now(), ttl: 1 }, o));
  }
  function notes(x, y, n = 3) { for (let i = 0; i < n; i++) fxP("note", x + rnd(-14, 14), y - rnd(8, 30), { vy: -14 - rnd(0, 14), ttl: rnd(0.8, 1.4), c: pickNoteCol() }); }
  function hearts(x, y, n = 2) { for (let i = 0; i < n; i++) fxP("heart", x + rnd(-10, 10), y - 14 + rnd(-6, 0), { ttl: 0.9 }); }
  function sparkles(x, y, n = 6) { for (let i = 0; i < n; i++) fxP("spark", x + rnd(-14, 14), y - rnd(4, 26), { vy: -10, ttl: rnd(0.5, 1) }); }
  const pickNoteCol = () => ["#ffd76b", "#ff9ec4", "#8ad0ff", "#c58bff"][Math.floor(Math.random() * 4)];

  // ---------- fixture blocking ----------
  function syncBlocked() {
    const W = DH.world;
    if (!W || !W.blocked) return;
    for (const k of devTiles) W.blocked.delete(k);
    devTiles.clear();
    STAGE_TILES.forEach(([tx, ty]) => W.blocked.add(tx + "," + ty));
    W.blocked.add(BOARD.tx + "," + BOARD.ty);
    for (const d of S.devices) {
      const k = d.tx + "," + d.ty;
      devTiles.add(k); W.blocked.add(k);
    }
  }

  // ---------- songs / records ----------
  const ownedSongs = () => SONG_IDS.filter(id => DH.inv.count("record-" + id) > 0);
  function songMenu(cb, back) {
    const rows = SONG_IDS.map(id => ({
      ico: TUNES[id].ico,
      label: `${TUNES[id].name}${ownedSongs().includes(id) ? " 💿" : ""}`,
      cb: () => cb(id),
    }));
    if (back) rows.push({ ico: "◀️", label: "Back", cb: back });
    return rows;
  }

  // ---------- named mutations (remote-callable) ----------
  const API = {
    // K-1 live show
    listen(songId) {
      if (!gs) return false;
      if (!liveNow()) { DH.toast("Toto plays live on Saturday nights, 20:00–24:00 🎤"); return false; }
      const id = SONG_IDS.includes(songId) ? songId : SONG_IDS[Math.floor(dateKey() / 7) % SONG_IDS.length];
      S.show.song = id; S.show.t0 = Date.now();
      if (!S.heard.includes(id)) S.heard.push(id);
      notes(STAGE.x, STAGE.y - 10, 5);
      DH.toast(`🎶 Toto plays "${TUNES[id].name}" — listen a while for the record!`, 3200);
      alog("music_listen", id);
      return true;
    },
    // grant happens in update() once LISTEN_MS has elapsed on the authority side
    request(songId) { return API.listen(songId); },

    // K-3 composer
    setTune(step, pitch) {
      step = step | 0; pitch = pitch | 0;
      if (step < 0 || step > 7 || pitch < 0 || pitch > 5) return false;
      S.tune[step] = pitch;
      return true;
    },
    previewTune() { AFX.seq(S.tune.map((p, i) => [i, PITCHES[p] || 0, 0.8]), 300, "triangle", 0.2); return true; },
    saveTune() {
      AFX.seq(S.tune.map((p, i) => [i, PITCHES[p] || 0, 0.8]), 300, "triangle", 0.2);
      DH.toast("🎼 Island tune saved — it plays each morning and when neighbors say hi!", 3400);
      alog("music_tune", S.tune.join(""));
      if (DH.save) DH.save.now();
      return true;
    },

    // K-3 flag
    setFlag(emblem, c1, c2) {
      if (emblem && FLAG_EMBLEMS[emblem]) S.flag.e = emblem;
      if (c1) S.flag.c1 = c1;
      if (c2) S.flag.c2 = c2;
      sparkles(FLAGPOLE.x + 9, FLAGPOLE.y - 22, 5);
      DH.toast("🚩 New island flag is flying by the door!", 2600);
      alog("music_flag", `${S.flag.e}:${S.flag.c1}`);
      if (DH.save) DH.save.now();
      return true;
    },

    // K-2/K-4 devices
    buyDevice(id) {
      if (!gs || !(id in DEV_COST)) return false;
      if (gs.coins < DEV_COST[id]) { DH.toast("Not enough coins 🪙"); return false; }
      if (DH.inv.add(id, 1) <= 0) { DH.toast("Pockets are full! ☹️"); return false; }
      gs.coins -= DEV_COST[id];
      DH.toast(`${DH.items.label(id)} — pockets! Set it down inside the house 🏠`, 3000);
      alog("music_buy", id);
      return true;
    },
    placeDevice(id, tx, ty) {
      if (!gs || !(id in DEV_COST) || DH.inv.count(id) <= 0) return false;
      if (tx == null || ty == null) {
        const p = (gs.players || [])[0];
        const t = p && placeableTile(p);
        if (!t) { DH.toast("☹️ No room in front of you — face a free floor tile!"); return false; }
        tx = t.tx; ty = t.ty;
      }
      const W = DH.world, k = tx + "," + ty;
      if (W.zone(tx, ty) !== "house") { DH.toast("Devices belong inside the house 🏠"); return false; }
      if (W.isBlocked(tx, ty) || devTiles.has(k) || PROTECTED.has(k)) { DH.toast("☹️ Can't put it there!"); return false; }
      for (const pl of gs.players || []) if (Math.floor(pl.x / T) === tx && Math.floor(pl.y / T) === ty) { DH.toast("☹️ Someone's standing there!"); return false; }
      if (!DH.inv.remove(id, 1)) return false;
      S.devices.push({ uid: S.nextUid++, id, tx, ty, on: false, song: null });
      syncBlocked();
      sparkles(tx * T + 16, ty * T + 16, 8);
      DH.toast(`${DH.items.label(id)} set down!`, 2400);
      alog("music_place", id);
      if (DH.save) DH.save.now();
      return true;
    },
    devicePower(uid) {
      const d = S.devices.find(x => x.uid === uid);
      if (!d || !gs) return false;
      d.on = !d.on;
      if (d.on && d.id !== "tv" && !d.song) d.song = ownedSongs()[0] || "island";
      notes(d.tx * T + 16, d.ty * T + 10, d.on ? 4 : 1);
      if (d.id === "tv" && d.on) API.watchTv();
      DH.toast(`${DH.items.label(d.id)} ${d.on ? "on ▶" : "off ⏸"}`);
      alog("music_power", `${d.id}:${d.on}`);
      syncAudio();
      if (DH.save) DH.save.now();
      return true;
    },
    deviceSong(uid, songId) {
      const d = S.devices.find(x => x.uid === uid);
      if (!d || !gs) return false;
      if (songId !== "island" && !ownedSongs().includes(songId)) { DH.toast("You don't own that record yet 💿"); return false; }
      d.song = songId; d.on = true;
      notes(d.tx * T + 16, d.ty * T + 10, 5);
      DH.toast(`🎶 Now playing: ${songId === "island" ? "Island tune" : TUNES[songId].name}`);
      alog("music_song", songId);
      syncAudio();
      if (DH.save) DH.save.now();
      return true;
    },
    pickUp(uid) {
      const i = S.devices.findIndex(x => x.uid === uid);
      if (i < 0 || !gs) return false;
      const d = S.devices[i];
      if (DH.inv.add(d.id, 1) <= 0) { DH.toast("Pockets are full! ☹️"); return false; }
      S.devices.splice(i, 1);
      syncBlocked(); syncAudio();
      DH.toast(`Picked up ${DH.items.label(d.id)}`);
      alog("music_pickup", d.id);
      return true;
    },
    watchTv() { // K-4 program overlay (view state — not serialized)
      ui.tvUntil = Date.now() + 12000;
      DH.toast("📺 Now showing on the little screen…", 2200);
      alog("music_tv");
      return true;
    },

    // K-6 morning stretch
    stretchStart() {
      if (!gs || !M.authority) return false;
      if (!stretchHours()) { DH.toast("Group stretch runs 6:00–9:00 in the morning 🌅"); return false; }
      if (S.stretch.on) return false;
      S.stretch.on = true; S.stretch.day = dayStamp();
      S.stretch.t0 = Date.now(); S.stretch.hits = 0; S.stretch.joined = 0; S.stretch.lastBeat = -1; S.stretch.hitBeat = -1;
      DH.toast("🙆 Group stretch! Tap A right on the pulse — feel the beat!", 3200);
      alog("music_stretch_start");
      return true;
    },
    stretchTap() {
      if (!gs || !S.stretch.on) return false;
      const beat = Math.floor((Date.now() - S.stretch.t0) / BEAT_MS);
      const phase = (Date.now() - S.stretch.t0) % BEAT_MS;
      const near = Math.min(phase, BEAT_MS - phase) <= BEAT_WIN;
      if (near && beat >= 0 && beat < STRETCH_BEATS && S.stretch.hitBeat !== beat) {
        S.stretch.hitBeat = beat; S.stretch.hits++;
        AFX.chime();
        const p = (gs.players || [])[0];
        if (p) hearts(p.x, p.y - 8, 2);
        fxP("spark", PLAZA.x, PLAZA.y - 30, { ttl: 0.5 });
      }
      return near;
    },
  };
  function stretchFinish() {
    S.stretch.on = false;
    const v = vils().filter(v2 => dist2(v2.x, v2.y, PLAZA.x, PLAZA.y) < 200 * 200);
    S.stretch.joined = v.length;
    v.forEach(v2 => hearts(v2.x, v2.y - 8, 2));
    if (S.stretch.hits > S.stretch.best) S.stretch.best = S.stretch.hits;
    const gain = Math.max(1, Math.min(10, S.stretch.hits));
    addHappy(gain);
    const msg = S.stretch.hits >= 8 ? "Perfect form!" : S.stretch.hits >= 4 ? "Nice stretching!" : "A little rusty — again tomorrow!";
    DH.toast(`🙆 ${msg} ${S.stretch.hits}/${STRETCH_BEATS} beats · +🏠${gain}${v.length ? ` · ${v.length} villager${v.length > 1 ? "s" : ""} joined` : ""}`, 4200);
    alog("music_stretch", `${S.stretch.hits}/${STRETCH_BEATS}`);
    if (DH.save) DH.save.now();
  }

  // ---------- menus ----------
  function openStage() {
    if (!liveNow()) {
      DH.menu.open("🎤 Yard stage", [
        { ico: "🐶", label: "Toto the dog plays LIVE every Saturday 20:00–24:00!", disabled: true, cb() {} },
        { ico: "🎼", label: "Music board", cb: openBoard },
      ]);
      return;
    }
    DH.menu.open("🎤 Toto LIVE on stage!", [
      { ico: "🎧", label: S.show.song ? `Now playing: ${TUNES[S.show.song].name}` : "Listen to the show", cb: () => API.listen(S.show.song || undefined) },
      { ico: "🎵", label: "Request a song", cb: openRequests },
      { ico: "💿", label: `Records earned: ${ownedSongs().length}/${SONG_IDS.length}`, disabled: true, cb() {} },
    ]);
  }
  function openRequests() {
    DH.menu.open("🎵 Request a song", songMenu(id => { API.listen(id); }, openStage));
  }
  function openBoard() {
    DH.menu.open("🎼 Music board", [
      { ico: "🎼", label: "Island tune composer", cb: openComposer },
      { ico: "🚩", label: "Design the island flag", cb: openFlag },
      { ico: "🎛️", label: "Music shop (radio · record player · TV)", cb: openShop },
      { ico: "💿", label: `My records (${ownedSongs().length}/${SONG_IDS.length})`, cb: openRecords },
      { ico: "🐶", label: "Toto live: Saturdays 20:00–24:00 on the stage", disabled: true, cb() {} },
    ]);
  }
  function openShop() {
    const rows = Object.keys(DEV_COST).map(id => {
      const d = DH.items.get(id);
      return { ico: d.ico, label: d.name, cost: DEV_COST[id], disabled: !gs || gs.coins < DEV_COST[id], cb: () => { API.buyDevice(id); openShop(); } };
    });
    rows.push({ ico: "◀️", label: "Back", cb: openBoard });
    DH.menu.open("🎛️ Music shop", rows);
  }
  function openRecords() {
    const rows = SONG_IDS.map(id => ({
      ico: "💿", disabled: true, cb() {},
      label: `${TUNES[id].name} — ${ownedSongs().includes(id) ? "owned 💿" : "hear it live on a Saturday!"}`,
    }));
    rows.push({ ico: "◀️", label: "Back", cb: openBoard });
    DH.menu.open("💿 My records", rows);
  }
  function openDevice(d) {
    const rows = [];
    if (d.id === "tv")
      rows.push({ ico: "📺", label: "Watch a program", cb: () => { API.watchTv(); openDevice(d); } });
    else
      rows.push({ ico: "🎵", label: "Choose a song…", cb: () => openDeviceSongs(d) });
    rows.push({ ico: d.on ? "⏸" : "▶️", label: d.on ? "Switch off" : `Switch on${d.song && d.id !== "tv" ? ` (${d.song === "island" ? "Island tune" : TUNES[d.song].name})` : ""}`, cb: () => { API.devicePower(d.uid); openDevice(d); } });
    rows.push({ ico: "📥", label: "Pick up", cb: () => API.pickUp(d.uid) });
    rows.push({ ico: "◀️", label: "Back", cb: () => DH.menu.close() });
    DH.menu.open(`${DH.items.label(d.id)}${d.on ? " · ON" : ""}`, rows);
  }
  function openDeviceSongs(d) {
    const rows = [{ ico: "🎼", label: "Island tune", cb: () => { API.deviceSong(d.uid, "island"); openDevice(d); } }];
    for (const id of SONG_IDS) {
      const owned = ownedSongs().includes(id);
      rows.push({
        ico: "💿", label: `${TUNES[id].name}${owned ? "" : " (no record)"}`, disabled: !owned,
        cb: () => { API.deviceSong(d.uid, id); openDevice(d); },
      });
    }
    rows.push({ ico: "◀️", label: "Back", cb: () => openDevice(d) });
    DH.menu.open(`🎵 ${DH.items.label(d.id)} — pick a song`, rows);
  }
  function openScores() {
    let c = null;
    try { c = DH.court && DH.court.serialize && DH.court.serialize(); } catch (e) {}
    const rows = [];
    if (c && c.score) {
      const n = (gs && gs.players || []).map(p => p.name);
      rows.push({ ico: "🏀", disabled: true, cb() {}, label: `Last game: ${n[0] || "P1"} ${c.score[0]} — ${c.score[1]} ${n[1] || "P2"}` });
      if (c.solo) rows.push({ ico: "🎯", disabled: true, cb() {}, label: `Solo: ${c.solo.made || 0}/${c.solo.shots || 0} made · best streak ${Math.max(c.solo.streak || 0, S.courtBest)}` });
    } else {
      rows.push({ ico: "🏀", label: "No court module on this island", disabled: true, cb() {} });
    }
    rows.push({ ico: "🏆", label: `All-time streak: ${S.courtBest}`, disabled: true, cb() {} });
    rows.push({ ico: "◀️", label: "Back", cb: () => DH.menu.close() });
    DH.menu.open("🏀 High-score board", rows);
  }

  // ---------- DOM overlays (composer / flag) ----------
  function makeOverlay(id, title) {
    const stage = document.getElementById("stage");
    if (!stage) return null;
    const el = document.createElement("div");
    el.id = id; el.className = "overlay";
    el.innerHTML = `<div class="card menu"><h2>${title}</h2><div class="muBody"></div></div>`;
    stage.appendChild(el);
    return el;
  }
  function overlayOpen(el) {
    if (!el) return;
    el.classList.remove("hidden");
    if (gs) gs.paused = true;
  }
  function overlayClose(el) {
    if (!el) return;
    el.classList.add("hidden");
    if (gs) gs.paused = false;
  }

  // K-3 composer: 8 steps (columns) × 5 pitches (rows, la→do top→bottom)
  function openComposer() {
    if (!ui.composer) {
      const el = makeOverlay("muComposer", "🎼 Island tune composer");
      if (!el) return;
      const body = el.querySelector(".muBody");
      const grid = document.createElement("div");
      grid.style.cssText = "display:grid;grid-template-columns:26px repeat(8,1fr);gap:4px;align-items:center;margin:0 auto 12px;max-width:330px";
      for (let row = 5; row >= 1; row--) {
        const lab = document.createElement("div");
        lab.style.cssText = "font-size:11px;color:#ffd76b;text-align:right";
        lab.textContent = PITCH_LABEL[row];
        grid.appendChild(lab);
        for (let col = 0; col < 8; col++) {
          const c = document.createElement("button");
          c.dataset.col = col; c.dataset.row = row;
          c.style.cssText = "height:26px;border-radius:6px;border:2px solid #34345c;background:#14142a;color:#ffd76b;font-size:13px;cursor:pointer;padding:0";
          c.addEventListener("click", () => {
            const s = c.dataset.col | 0;
            API.setTune(s, S.tune[s] === (c.dataset.row | 0) ? 0 : (c.dataset.row | 0));
            paintGrid(); API.previewStep(s);
          });
          grid.appendChild(c);
        }
      }
      const lab = document.createElement("div");
      lab.style.cssText = "font-size:11px;color:#9aa;text-align:right";
      lab.textContent = "step";
      grid.appendChild(lab);
      for (let col = 0; col < 8; col++) {
        const n = document.createElement("div");
        n.style.cssText = "font-size:10px;color:#889;text-align:center";
        n.textContent = col + 1;
        grid.appendChild(n);
      }
      body.appendChild(grid);
      const row = document.createElement("div");
      row.className = "btns";
      row.style.cssText = "display:flex;gap:8px;justify-content:center;flex-wrap:wrap";
      const mk = (txt, cb) => { const b = document.createElement("button"); b.className = "midbtn"; b.textContent = txt; b.addEventListener("click", cb); row.appendChild(b); };
      mk("▶ Preview", () => API.previewTune());
      mk("🗑 Clear", () => { S.tune = [0, 0, 0, 0, 0, 0, 0, 0]; paintGrid(); });
      mk("✔ Save", () => { API.saveTune(); overlayClose(el); });
      mk("✖ Close", () => overlayClose(el));
      body.appendChild(row);
      const hint = document.createElement("p");
      hint.className = "hint";
      hint.style.cssText = "font-size:11px;color:#889;margin-top:10px";
      hint.textContent = "Tap cells to place notes — one per step. It plays at daybreak and when neighbors greet you.";
      body.appendChild(hint);
      ui.composer = el;
    }
    paintGrid();
    overlayOpen(ui.composer);
  }
  API.previewStep = s => { const p = S.tune[s]; if (p) AFX.seq([[0, PITCHES[p], 0.7]], 240, "triangle", 0.2); };
  function paintGrid() {
    if (!ui.composer) return;
    ui.composer.querySelectorAll("button[data-col]").forEach(c => {
      const on = S.tune[c.dataset.col | 0] === (c.dataset.row | 0);
      c.textContent = on ? "♪" : "";
      c.style.background = on ? "#5a3a78" : "#14142a";
      c.style.borderColor = on ? "#c58bff" : "#34345c";
    });
  }

  // K-3 flag designer: emblem + 2 colors with live canvas preview
  const FLAG_EMBLEMS = { heart: "♥", star: "★", paw: "🐾", flower: "✿" };
  const FLAG_COLS = ["#e04848", "#3a6fd8", "#57a05b", "#ffd76b", "#c58bff", "#f4f0e8", "#2a2a33", "#ff9a5c"];
  function openFlag() {
    if (!ui.flag) {
      const el = makeOverlay("muFlag", "🚩 Island flag designer");
      if (!el) return;
      const body = el.querySelector(".muBody");
      const cvv = document.createElement("canvas");
      cvv.width = 96; cvv.height = 64;
      cvv.style.cssText = "image-rendering:pixelated;background:#1a2a4a;border-radius:8px;margin-bottom:10px";
      body.appendChild(cvv);
      const rowE = document.createElement("div");
      rowE.style.cssText = "display:flex;gap:8px;justify-content:center;margin-bottom:8px";
      for (const k in FLAG_EMBLEMS) {
        const b = document.createElement("button");
        b.className = "midbtn"; b.dataset.em = k; b.style.padding = "7px 12px";
        const ec = document.createElement("canvas");
        ec.width = ec.height = 18; ec.style.cssText = "display:block;margin:0 auto";
        const ec2 = ec.getContext("2d"); ec2.translate(9, 9); drawEmblem(ec2, k, "#fff6e8", 16);
        b.appendChild(ec);
        b.title = k;
        b.addEventListener("click", () => { S.flag.e = k; paintFlag(); });
        rowE.appendChild(b);
      }
      body.appendChild(rowE);
      const mkRow = (which, label) => {
        const lab = document.createElement("div");
        lab.style.cssText = "font-size:11px;color:#9aa;text-align:left;margin:2px 0";
        lab.textContent = label;
        body.appendChild(lab);
        const row = document.createElement("div");
        row.style.cssText = "display:flex;gap:6px;justify-content:center;margin-bottom:8px";
        FLAG_COLS.forEach(c => {
          const b = document.createElement("button");
          b.dataset[which] = c;
          b.style.cssText = `width:26px;height:26px;border-radius:6px;border:2px solid #34345c;background:${c};cursor:pointer`;
          b.addEventListener("click", () => { S.flag[which] = c; paintFlag(); });
          row.appendChild(b);
        });
        body.appendChild(row);
      };
      mkRow("c1", "Field color");
      mkRow("c2", "Emblem color");
      const row = document.createElement("div");
      row.style.cssText = "display:flex;gap:8px;justify-content:center";
      const mk = (txt, cb) => { const b = document.createElement("button"); b.className = "midbtn"; b.textContent = txt; b.addEventListener("click", cb); row.appendChild(b); };
      mk("✔ Fly it!", () => { API.setFlag(); overlayClose(el); });
      mk("✖ Close", () => overlayClose(el));
      body.appendChild(row);
      ui.flag = el;
      ui.flag.cv = cvv;
    }
    paintFlag();
    overlayOpen(ui.flag);
  }
  function paintFlag() {
    if (!ui.flag || !ui.flag.cv) return;
    const c2d = ui.flag.cv.getContext("2d");
    c2d.fillStyle = "#1a2a4a"; c2d.fillRect(0, 0, 96, 64);
    c2d.fillStyle = "#6e4a2a"; c2d.fillRect(16, 8, 4, 52);
    drawFlagCloth(c2d, 20, 10, 68, 34, 0);
    ui.flag.querySelectorAll("button[data-em]").forEach(b => {
      b.style.borderColor = b.dataset.em === S.flag.e ? "#ffd76b" : "#34345c";
    });
  }

  // ---------- flag cloth drawing (shared: world pole + preview) ----------
  function drawFlagCloth(ctx, x, y, w, h, t) {
    const wave = Math.sin((t || Date.now()) / 350) * 2;
    ctx.fillStyle = S.flag.c1;
    ctx.beginPath();
    ctx.moveTo(x, y); ctx.lineTo(x + w, y + wave); ctx.lineTo(x + w, y + h + wave); ctx.lineTo(x, y + h);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.15)"; // hem
    ctx.fillRect(x, y + h - 3 + wave * 0.5, w, 3);
    ctx.save();
    ctx.translate(x + w * 0.45, y + h / 2 + wave * 0.4);
    drawEmblem(ctx, S.flag.e, S.flag.c2, Math.min(w, h) * 0.5);
    ctx.restore();
  }
  function drawEmblem(ctx, e, col, s) {
    ctx.fillStyle = col;
    if (e === "heart") { DH.sprites.heart(ctx, 0, 0, s * 0.55, col); return; }
    if (e === "star") {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? s * 0.22 : s * 0.5, a = -Math.PI / 2 + i * Math.PI / 5;
        ctx[i ? "lineTo" : "moveTo"](Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath(); ctx.fill();
      return;
    }
    if (e === "paw") {
      ctx.beginPath(); ctx.ellipse(0, s * 0.12, s * 0.3, s * 0.26, 0, 0, 7); ctx.fill();
      for (const [dx, dy] of [[-0.3, -0.18], [0, -0.26], [0.3, -0.18]]) {
        ctx.beginPath(); ctx.arc(dx * s, dy * s, s * 0.13, 0, 7); ctx.fill();
      }
      return;
    }
    // flower
    for (let i = 0; i < 5; i++) {
      const a = i * Math.PI * 2 / 5 - Math.PI / 2;
      ctx.beginPath(); ctx.arc(Math.cos(a) * s * 0.26, Math.sin(a) * s * 0.26, s * 0.2, 0, 7); ctx.fill();
    }
    ctx.fillStyle = "#ffd76b";
    ctx.beginPath(); ctx.arc(0, 0, s * 0.16, 0, 7); ctx.fill();
  }

  // ---------- module contract ----------
  const M = (DH.music = {
    authority: true,
    _S: S,

    init(state) {
      gs = state;
      M.authority = !(DH.net && DH.net.online && DH.net.role === "guest");
      const W = DH.world;
      if (!W._musicPatched) {
        W._musicPatched = true;
        const s0 = W.isSolid.bind(W);
        W.isSolid = (tx, ty) => s0(tx, ty) || W.blocked.has(tx + "," + ty);
      }
      syncBlocked();
    },

    start(state) {
      gs = state;
      M.authority = !(DH.net && DH.net.online && DH.net.role === "guest");
      fx.length = 0;
      ui.tvUntil = 0;
      saveT = 0;
      AFX.stopAll();
      syncBlocked();
      // unlock audio on the first real gesture
      if (!M._unlockWired) {
        M._unlockWired = true;
        const un = () => AFX.ensure();
        window.addEventListener("pointerdown", un, { passive: true });
        window.addEventListener("keydown", un);
      }
    },

    offline(offMin) {
      const on = S.devices.filter(d => d.on && d.id !== "tv");
      return on.length ? [`📻 the ${on[0].id === "radio" ? "radio" : "record player"} played on softly`] : [];
    },

    update(dt, state) {
      gs = state;
      if (!M.authority) return;
      const ds = dayStamp();
      if (ds !== S.lastDay) {
        S.lastDay = ds;
        S.greet = {};
        // K-3 day-start fanfare
        API.previewTune();
        fxP("note", PLAZA.x, PLAZA.y - 20, { ttl: 1.4 });
      }
      // K-4 hourly radio time signal (any powered radio)
      const hour = Math.floor(timeMin() / 60);
      if (hour !== S.lastHour) {
        S.lastHour = hour;
        if (S.devices.some(d => d.id === "radio" && d.on)) {
          AFX.jingle();
          S.devices.filter(d => d.id === "radio" && d.on).forEach(d => notes(d.tx * T + 16, d.ty * T + 8, 2));
        }
      }
      // K-1 record grant after a full listen
      if (S.show.song && Date.now() - S.show.t0 >= LISTEN_MS) {
        const id = S.show.song;
        if (S.got[id] !== dateKey()) {
          S.got[id] = dateKey();
          if (DH.inv.add("record-" + id, 1) > 0) {
            DH.toast(`💿 You got the "${TUNES[id].name}" record! Play it at home 🎶`, 4200);
            const p = (state.players || [])[0];
            if (p) { hearts(p.x, p.y - 8, 3); sparkles(p.x, p.y - 14, 6); }
            alog("music_record", id);
          } else DH.toast("Pockets are full — the record stays with Toto ☹️");
        }
        S.show.song = null;
        syncAudio();
      }
      // K-6 stretch beat clock
      if (S.stretch.on) {
        const el = Date.now() - S.stretch.t0;
        const beat = Math.floor(el / BEAT_MS);
        if (beat !== S.stretch.lastBeat && beat < STRETCH_BEATS) { S.stretch.lastBeat = beat; AFX.click(); notes(PLAZA.x + rnd(-30, 30), PLAZA.y - 24, 1); }
        if (el > STRETCH_BEATS * BEAT_MS + 400) stretchFinish();
      }
      // K-5 scoreboard bookkeeping (defensive read of court state)
      try {
        const c = DH.court && DH.court.serialize && DH.court.serialize();
        if (c && c.solo && (c.solo.streak || 0) > S.courtBest) S.courtBest = c.solo.streak;
      } catch (e) {}
      // K-3 villager greeting jingle
      for (const v of vils()) {
        if (v && v.lastTalk === ds && S.greet[v.id] !== ds) {
          S.greet[v.id] = ds;
          AFX.seq(S.tune.map((p, i) => [i * 0.5, PITCHES[p] || 0, 0.4]), 320, "triangle", 0.13);
          notes(v.x, v.y - 18, 3);
        }
      }
      S.saveT = (S.saveT || 0) + dt;
      if (S.saveT >= SAVE_EVERY) { S.saveT = 0; DH.save.now(); }
    },

    interactables(p) {
      if (!gs || !gs.running) return [];
      const out = [];
      // K-1 stage
      const dS = dist2(p.x, p.y, STAGE_PT.x, STAGE_PT.y);
      if (dS < INTERACT_R * INTERACT_R)
        out.push({ label: liveNow() ? "Toto LIVE — listen 🎤" : "Stage — Toto Sat 20:00 🎤", x: STAGE_PT.x, y: STAGE_PT.y, d2: dS, action: openStage });
      // music board
      const dB = dist2(p.x, p.y, BOARD_PT.x, BOARD_PT.y);
      if (dB < 40 * 40)
        out.push({ label: "Music board 🎼", x: BOARD_PT.x, y: BOARD_PT.y, d2: dB, action: openBoard });
      // K-6 stretch
      const dP = dist2(p.x, p.y, PLAZA.x, PLAZA.y);
      if (S.stretch.on) {
        if (dP < 85 * 85) out.push({ label: "🥁 Clap on the beat!", x: PLAZA.x, y: PLAZA.y, d2: dP - 1, action: () => API.stretchTap() });
      } else if (stretchHours() && S.stretch.day !== dayStamp() && dP < 54 * 54) {
        out.push({ label: "🙆 Group stretch", x: PLAZA.x, y: PLAZA.y, d2: dP - 1, action: () => API.stretchStart() });
      }
      // K-5 court scoreboard
      if (DH.court) {
        const dC = dist2(p.x, p.y, SCORE.x, SCORE.y);
        if (dC < 40 * 40) out.push({ label: "High-score board 🏀", x: SCORE.x, y: SCORE.y, d2: dC, action: openScores });
      }
      // K-2/K-4 devices in the house
      const inHouse = DH.world.zone(Math.floor(p.x / T), Math.floor(p.y / T)) === "house";
      for (const d of S.devices) {
        const dx = d.tx * T + 16, dy = d.ty * T + 24;
        const dd = dist2(p.x, p.y, dx, dy);
        if (dd < 40 * 40) {
          const uid = d.uid;
          out.push({ label: `${DH.items.label(d.id)}${d.on ? " ♪" : ""}`, x: dx, y: dy, d2: dd, action: () => { const cur = S.devices.find(x => x.uid === uid); if (cur) openDevice(cur); } });
        }
      }
      if (inHouse && ["radio", "record-player", "tv"].some(id => DH.inv.count(id) > 0)) {
        const t = placeableTile(p);
        if (t) {
          const tx2 = t.tx * T + 16, ty2 = t.ty * T + 24;
          out.push({ label: "Set down music gear 🎵", x: tx2, y: ty2, d2: dist2(p.x, p.y, tx2, ty2) + 30, action: () => openPlaceMenu(t.tx, t.ty) });
        }
      }
      // K-4 furniture-tv interop (music registers early, so this wins the A-slot)
      try {
        const f = DH.furniture && DH.furniture.serialize && DH.furniture.serialize();
        if (f && Array.isArray(f.items)) {
          for (const it of f.items) {
            if (it.id !== "tv") continue;
            const fx2 = (it.x0 + 1) * T, fy2 = (it.y0 + 0.75) * T;
            const dd = dist2(p.x, p.y, fx2, fy2);
            if (dd < 48 * 48)
              out.push({ label: "Watch program 📺", x: fx2, y: fy2, d2: dd - 1, action: () => API.watchTv() });
          }
        }
      } catch (e) {}
      out.sort((a, b) => (a.d2 || 0) - (b.d2 || 0));
      return out;
    },

    collectDraws(draws, camX, camY) {
      if (!ctxG) ctxG = document.getElementById("cv").getContext("2d");
      // stage platform (always present — the yard plaza)
      draws.push({ y: 10 * T + T - 2, fn: () => drawStage(ctxG, STAGE_TILES[0][0] * T - camX, STAGE_TILES[0][1] * T - camY) });
      // music board
      draws.push({ y: BOARD.ty * T + T, fn: () => drawBoard(ctxG, BOARD.tx * T - camX, BOARD.ty * T - camY) });
      // flag pole on the house
      draws.push({ y: 9 * T + 30, fn: () => drawFlagPole(ctxG, FLAGPOLE.x - camX, FLAGPOLE.y - camY) });
      // court scoreboard sign
      if (DH.court) draws.push({ y: SCORE.y, fn: () => drawScoreSign(ctxG, SCORE.x - camX, SCORE.y - camY) });
      // devices
      for (const d of S.devices)
        draws.push({ y: d.ty * T + T, fn: () => drawDevice(ctxG, d, d.tx * T - camX, d.ty * T - camY) });
      // Toto on stage during the show
      if (liveNow())
        draws.push({ y: STAGE.y + 2, fn: () => { DH.sprites.shadow(ctxG, STAGE.x - camX, STAGE.y - camY + 2, 15); drawToto(ctxG, STAGE.x - camX, STAGE.y - camY); } });
    },

    drawOverlay(ctx, camX, camY, state) {
      ctxG = ctx;
      const now = Date.now();
      syncAudio();
      // K-1 concert FX while a song is on
      if (S.show.song) {
        const sx = STAGE.x - camX, sy = STAGE.y - camY;
        const hue = (now / 20) % 360;
        ctx.save();
        ctx.globalAlpha = 0.16;
        ctx.fillStyle = `hsl(${hue},80%,60%)`;
        ctx.beginPath(); ctx.moveTo(sx - 30, sy - 60); ctx.lineTo(sx - 52, sy + 18); ctx.lineTo(sx - 12, sy + 18); ctx.closePath(); ctx.fill();
        ctx.fillStyle = `hsl(${(hue + 120) % 360},80%,60%)`;
        ctx.beginPath(); ctx.moveTo(sx + 30, sy - 60); ctx.lineTo(sx + 52, sy + 18); ctx.lineTo(sx + 12, sy + 18); ctx.closePath(); ctx.fill();
        ctx.restore();
        if (Math.random() < 0.3) notes(STAGE.x + rnd(-24, 24), STAGE.y - rnd(16, 34), 1);
        ctx.font = "bold 10px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillStyle = "#1a1a2ecc";
        const txt = `🔴 LIVE · Toto — ${TUNES[S.show.song].name}`;
        const w = ctx.measureText(txt).width + 14;
        ctx.fillRect(ctx.canvas.width / 2 - w / 2, 30, w, 16);
        ctx.fillStyle = "#ffe9b0";
        ctx.fillText(txt, ctx.canvas.width / 2, 38);
      }
      // K-6 stretch pulse ring + beat dots
      if (S.stretch.on) {
        const el = now - S.stretch.t0;
        const beat = Math.floor(el / BEAT_MS), ph = (el % BEAT_MS) / BEAT_MS;
        const px = PLAZA.x - camX, py = PLAZA.y - camY;
        const r = 26 - ph * 14;
        ctx.strokeStyle = ph < 0.35 ? "#ffd76b" : "#ffffff88";
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(px, py - 20, r, 0, 7); ctx.stroke();
        ctx.fillStyle = "#ffd76b";
        ctx.beginPath(); ctx.arc(px, py - 20, 4, 0, 7); ctx.fill();
        for (let i = 0; i < STRETCH_BEATS; i++) {
          ctx.fillStyle = i < beat ? "#8ad05b" : i === beat ? "#ffd76b" : "#ffffff55";
          ctx.fillRect(px - 40 + i * 9, py - 52, 6, 6);
        }
        // villagers join in
        for (const v of vils())
          if (dist2(v.x, v.y, PLAZA.x, PLAZA.y) < 200 * 200 && Math.random() < 0.05)
            fxP("heart", v.x + rnd(-8, 8), v.y - 20, { ttl: 0.8 });
      }
      // K-4 TV program
      if ((ui.tvUntil || 0) > now) drawTvProgram(ctx, now);
      drawFxAll(ctx, camX, camY, now);
    },

    // ----- sync boundary -----
    serialize() {
      return JSON.parse(JSON.stringify({
        tune: S.tune, flag: S.flag, devices: S.devices, nextUid: S.nextUid,
        got: S.got, heard: S.heard, show: S.show, stretch: S.stretch,
        lastDay: S.lastDay, lastHour: S.lastHour, greet: S.greet, courtBest: S.courtBest,
      }));
    },
    deserialize(d) {
      if (!d || typeof d !== "object") return;
      if (Array.isArray(d.tune) && d.tune.length === 8) S.tune = d.tune.map(n => clamp(n | 0, 0, 5));
      if (d.flag && typeof d.flag === "object")
        S.flag = { e: FLAG_EMBLEMS[d.flag.e] ? d.flag.e : "heart", c1: d.flag.c1 || "#e04848", c2: d.flag.c2 || "#fff6e8" };
      if (Array.isArray(d.devices))
        S.devices = d.devices.filter(x => x && x.id in DEV_COST).map(x => ({ uid: x.uid | 0, id: x.id, tx: x.tx | 0, ty: x.ty | 0, on: !!x.on, song: x.song || null }));
      if (typeof d.nextUid === "number") S.nextUid = Math.max(d.nextUid, S.devices.reduce((m, x) => Math.max(m, x.uid + 1), 1));
      if (d.got && typeof d.got === "object") S.got = d.got;
      if (Array.isArray(d.heard)) S.heard = d.heard.filter(id => SONG_IDS.includes(id));
      if (d.show && typeof d.show === "object") S.show = { song: SONG_IDS.includes(d.show.song) ? d.show.song : null, t0: +d.show.t0 || 0 };
      if (S.show.song) S.show.t0 = Date.now(); // restart the number for a fresh listen
      if (d.stretch && typeof d.stretch === "object")
        S.stretch = Object.assign({ on: false, day: -1, t0: 0, hits: 0, joined: 0, best: 0, lastBeat: -1, hitBeat: -1 }, d.stretch);
      if (S.stretch.on && Math.abs(Date.now() - S.stretch.t0) > 30000) S.stretch.on = false;
      if (typeof d.lastDay === "number") S.lastDay = d.lastDay;
      if (typeof d.lastHour === "number") S.lastHour = d.lastHour;
      if (d.greet && typeof d.greet === "object") S.greet = d.greet;
      if (typeof d.courtBest === "number") S.courtBest = d.courtBest;
      syncBlocked();
    },
    remoteAction(name, args) {
      return typeof API[name] === "function" ? API[name].apply(null, args || []) : false;
    },

    // ----- exposed API (menus + console/tests) -----
    listen: API.listen, request: API.request, setTune: API.setTune, previewTune: API.previewTune,
    saveTune: API.saveTune, setFlag: API.setFlag, buyDevice: API.buyDevice, placeDevice: API.placeDevice,
    devicePower: API.devicePower, deviceSong: API.deviceSong, pickUp: API.pickUp, watchTv: API.watchTv,
    stretchStart: API.stretchStart, stretchTap: API.stretchTap,
    openStage, openBoard, openComposer, openFlag, openShop, openRecords, openDevice, openScores, openPlaceMenu,
    liveNow, ownedSongs, islandSong, syncAudio,
    get forceLive() { return M._forceLive; },
    set forceLive(v) { M._forceLive = v; },
  });
  M._forceLive = false;

  function openPlaceMenu(tx, ty) {
    const rows = ["radio", "record-player", "tv"].filter(id => DH.inv.count(id) > 0).map(id => {
      const d = DH.items.get(id);
      return { ico: d.ico, label: `${d.name} — set down here`, cb: () => API.placeDevice(id, tx, ty) };
    });
    if (!rows.length) rows.push({ ico: "🫳", label: "No devices in pockets — the music shop sells them!", disabled: true, cb() {} });
    DH.menu.open("🎵 Set down music gear", rows);
  }

  const DIRV = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  function facedTile(p) {
    const v = DIRV[p.dir] || DIRV.down;
    return { tx: Math.floor((p.x + v[0] * 26) / T), ty: Math.floor((p.y + v[1] * 26) / T) };
  }
  function placeableTile(p) {
    if (!gs) return null;
    const { tx, ty } = facedTile(p), k = tx + "," + ty;
    if (DH.world.zone(tx, ty) !== "house") return null;
    if (DH.world.isBlocked(tx, ty) || devTiles.has(k) || PROTECTED.has(k)) return null;
    for (const pl of gs.players || []) if (Math.floor(pl.x / T) === tx && Math.floor(pl.y / T) === ty) return null;
    return { tx, ty };
  }

  // ---------- fx draw ----------
  function drawFxAll(ctx, camX, camY, now) {
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i], age = (now - f.born) / 1000;
      if (age >= f.ttl) { fx.splice(i, 1); continue; }
      const a = 1 - age / f.ttl;
      const x = f.x + f.vx * age - camX, y = f.y + f.vy * age - camY;
      ctx.save(); ctx.globalAlpha = Math.max(0, a);
      if (f.k === "heart") DH.sprites.heart(ctx, x, y, 5);
      else if (f.k === "note") {
        ctx.fillStyle = f.c || "#ffd76b";
        ctx.font = "bold 11px sans-serif"; ctx.textAlign = "center";
        ctx.fillText("♪", x, y);
      } else {
        ctx.fillStyle = f.c || "#ffe98a";
        ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
      }
      ctx.restore();
    }
  }

  // ---------- sprites ----------
  const R = (ctx, x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };

  function drawStage(ctx, x, y) {
    // wooden platform over the two tiles + back posts with string lights
    R(ctx, x - 2, y - 14, 3, 15, "#6e4a2a"); R(ctx, x + 63, y - 14, 3, 15, "#6e4a2a"); // posts
    const cols = ["#ffd76b", "#ff9ec4", "#8ad0ff"];
    for (let i = 0; i < 5; i++) {
      const lx = x + 4 + i * 13, ly = y - 12 + Math.sin(i / 4 * Math.PI) * 4;
      R(ctx, lx, ly, 2, 3, cols[i % 3]);
    }
    R(ctx, x - 2, y - 15, 68, 2, "#5a4020"); // light string
    // deck
    R(ctx, x, y + 6, 64, 22, "#b08050");
    R(ctx, x, y + 6, 64, 3, "#c8975c");
    ctx.fillStyle = "#96693a";
    for (let i = 0; i < 7; i++) ctx.fillRect(x + 4 + i * 9, y + 8, 2, 19);
    R(ctx, x, y + 25, 64, 3, "#7a5527"); // front skirt
    // speakers at the corners + mic stand center
    R(ctx, x + 4, y - 2, 8, 8, "#2a2a33"); R(ctx, x + 5, y - 1, 6, 3, "#3a3a44");
    R(ctx, x + 52, y - 2, 8, 8, "#2a2a33"); R(ctx, x + 53, y - 1, 6, 3, "#3a3a44");
    R(ctx, x + 31, y - 6, 2, 12, "#3a3a44"); R(ctx, x + 28, y - 9, 8, 4, "#555c66");
  }

  function drawBoard(ctx, x, y) {
    R(ctx, x + 4, y + 8, 4, 24, "#6e4a2a"); R(ctx, x + 24, y + 8, 4, 24, "#6e4a2a");
    R(ctx, x, y - 6, 32, 18, "#3a4a78");
    R(ctx, x + 2, y - 4, 28, 14, "#4a5f98");
    ctx.fillStyle = "#ffd76b"; ctx.font = "bold 10px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("♪", x + 8, y + 3); ctx.fillText("♫", x + 22, y + 3);
    R(ctx, x + 5, y + 6, 22, 2, "#d8e0f0");
    R(ctx, x, y - 8, 32, 3, "#2a3560");
  }

  function drawScoreSign(ctx, x, y) {
    R(ctx, x - 2, y - 4, 4, 12, "#6e4a2a");
    R(ctx, x - 12, y - 18, 24, 15, "#3a3026");
    R(ctx, x - 10, y - 16, 20, 11, "#4a4238");
    ctx.fillStyle = "#ffd76b"; ctx.font = "bold 6px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("SCORE", x, y - 12);
    R(ctx, x - 8, y - 8, 16, 1.5, "#f4f0e8");
  }

  function drawFlagPole(ctx, x, y) {
    R(ctx, x - 1, y - 34, 2, 34, "#6e4a2a");
    R(ctx, x - 2, y - 36, 4, 3, "#e8c860");
    drawFlagCloth(ctx, x + 1, y - 34, 17, 10, Date.now());
  }

  // Toto the dog: cream dog with floppy brown ears + a little red guitar
  function drawToto(ctx, x, y) {
    const bob = Math.sin(Date.now() / 480) * 1.4;
    const strum = Math.sin(Date.now() / 130) * 1.6;
    ctx.save(); ctx.translate(x, y + bob);
    // feet + tail
    R(ctx, -5, -5, 4, 5, "#c8a068"); R(ctx, 1, -5, 4, 5, "#c8a068");
    R(ctx, -12, -14, 4, 5, "#e8c890"); // tail wag
    // body
    R(ctx, -8, -17, 16, 12, "#e8c890");
    R(ctx, -8, -17, 16, 3, "#f4ddb0");
    // head + floppy ears
    R(ctx, -7, -30, 14, 13, "#e8c890");
    R(ctx, -11, -30, 5, 10, "#8a5f38"); R(ctx, 6, -30, 5, 10, "#8a5f38"); // ears
    R(ctx, -9, -31, 4, 4, "#8a5f38"); R(ctx, 5, -31, 4, 4, "#8a5f38");
    R(ctx, -4, -26, 2, 2.4, "#241a14"); R(ctx, 2, -26, 2, 2.4, "#241a14"); // eyes
    R(ctx, -2, -22, 4, 2, "#5a4028"); R(ctx, -1, -23, 2, 1.4, "#241a14");   // snout+nose
    R(ctx, -3, -18, 6, 2, "#b05a3a");                                     // collar
    // guitar: red body + neck, arm strums
    ctx.save(); ctx.rotate(0.12);
    R(ctx, -10, -12, 9, 8, "#c03a3a"); R(ctx, -10, -12, 9, 2, "#e05b5b");
    R(ctx, -1, -11, 12, 3, "#7a5527"); R(ctx, 9, -12, 4, 5, "#5a4020");
    ctx.restore();
    R(ctx, 6, -14 + strum * 0.5, 4, 8, "#e8c890"); // strumming arm
    ctx.restore();
  }

  // ---------- devices ----------
  function drawDevice(ctx, d, x, y) {
    if (d.id === "radio") {
      R(ctx, x + 6, y + 10, 20, 16, "#a0522d");
      R(ctx, x + 6, y + 10, 20, 3, "#c0714a");
      R(ctx, x + 8, y + 15, 9, 8, "#3a2a22");           // speaker grill
      ctx.strokeStyle = "#222"; ctx.lineWidth = 1;
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(x + 9, y + 16 + i * 2.4); ctx.lineTo(x + 16, y + 16 + i * 2.4); ctx.stroke(); }
      R(ctx, x + 20, y + 16, 4, 4, "#e8c860");           // dial
      R(ctx, x + 23, y + 2, 1.5, 9, "#888");             // antenna
      if (d.on) { R(ctx, x + 20, y + 22, 3, 2, "#7bff9a"); }
    } else if (d.id === "record-player") {
      R(ctx, x + 4, y + 12, 24, 15, "#6e4a2a");
      R(ctx, x + 4, y + 12, 24, 2, "#8a5f30");
      const spin = d.on ? (Date.now() / 240) % (Math.PI * 2) : 0.6;
      ctx.save(); ctx.translate(x + 15, y + 19); ctx.rotate(spin);
      ctx.fillStyle = "#1c1c22"; ctx.beginPath(); ctx.arc(0, 0, 7, 0, 7); ctx.fill();
      ctx.fillStyle = "#e04848"; ctx.beginPath(); ctx.arc(0, 0, 2.4, 0, 7); ctx.fill();
      R(ctx, -1, -7, 2, 14, "#333");                     // groove line
      ctx.restore();
      R(ctx, x + 22, y + 13, 4, 8, "#3a3a44");           // tonearm
    } else { // tv
      R(ctx, x + 6, y + 8, 20, 15, "#2a2a33");
      R(ctx, x + 8, y + 10, 16, 11, d.on ? "#4a6a8a" : "#16161e");
      if (d.on) {
        const s = Math.floor(Date.now() / 260) % 3;
        R(ctx, x + 10 + s * 3, y + 12, 12 - s * 2, 3, "#7ee3ff");
        R(ctx, x + 12, y + 16, 8, 2, "#ffd76b");
      }
      R(ctx, x + 10, y + 23, 12, 3, "#3a3f48");
      R(ctx, x + 13, y + 4, 1.5, 4, "#888"); R(ctx, x + 18, y + 4, 1.5, 4, "#888"); // rabbit ears
    }
    if (d.on && d.id !== "tv" && Math.random() < 0.05) notes(x + 16, y + 8, 1);
  }

  // ---------- K-4 TV program ----------
  function drawTvProgram(ctx, now) {
    const cw = ctx.canvas.width, ch = ctx.canvas.height;
    const w = Math.min(cw * 0.82, 420), h = Math.min(ch * 0.6, 240);
    const x0 = (cw - w) / 2, y0 = (ch - h) / 2 - 10;
    // TV frame
    R(ctx, x0 - 10, y0 - 10, w + 20, h + 20, "#241c14");
    R(ctx, x0 - 10, y0 - 10, w + 20, 4, "#3a2c1e");
    ctx.fillStyle = "#0e1420"; ctx.fillRect(x0, y0, w, h);
    const hasEnv = !!(DH.env && DH.env.weather);
    const title = hasEnv ? "🐶 Weather with Toto" : "🐛 Bug Ballet Hour";
    // sky band
    ctx.fillStyle = hasEnv && (DH.env.weather === "rain" || DH.env.weather === "snow") ? "#2a3a52" : "#3a5a8a";
    ctx.fillRect(x0 + 4, y0 + 4, w - 8, h - 44);
    ctx.fillStyle = "#4a7a4a"; ctx.fillRect(x0 + 4, y0 + h - 60, w - 8, 12); // ground strip
    if (hasEnv) {
      const w2 = DH.env.weather;
      // animated weather icons parading across the sky
      const ico = { sunny: "☀️", cloudy: "☁️", rain: "🌧", snow: "❄️", windy: "🍃" }[w2] || "☀️";
      ctx.font = "18px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(ico, x0 + w / 2, y0 + 34 + Math.sin(now / 500) * 3);
      if (w2 === "rain" || w2 === "snow") {
        ctx.fillStyle = "rgba(200,220,255,0.8)";
        for (let i = 0; i < 12; i++)
          ctx.fillRect(x0 + 10 + ((i * 37 + now * 0.09) % (w - 20)), y0 + 44 + ((i * 23 + now * 0.12) % (h - 110)), 2, w2 === "rain" ? 5 : 3);
      } else if (w2 === "windy") {
        ctx.fillStyle = "rgba(220,255,220,0.7)";
        for (let i = 0; i < 6; i++) {
          const lx = x0 + 14 + ((i * 53 + now * 0.1) % (w - 30));
          const ly = y0 + 40 + (i % 3) * 14 + Math.sin(now / 300 + i) * 4;
          ctx.fillRect(lx, ly, 8, 2); ctx.fillRect(lx + 2, ly - 2, 4, 2);
        }
      } else {
        const sunx = x0 + w - 40;
        ctx.fillStyle = "#ffd76b"; ctx.beginPath(); ctx.arc(sunx, y0 + 26, 10, 0, 7); ctx.fill();
        if (w2 === "cloudy") { ctx.fillStyle = "#e8ecf2"; ctx.fillRect(x0 + 30, y0 + 22, 50, 10); ctx.fillRect(x0 + 42, y0 + 16, 30, 8); }
      }
      // mini anchor-dog at a desk
      drawToto(ctx, x0 + 44, y0 + h - 52);
      R(ctx, x0 + 24, y0 + h - 44, 40, 12, "#7a5527");
      const WINFO = { sunny: "sunny & clear", cloudy: "cloudy", rain: "rain — free flower watering!", snow: "snow — bundle up", windy: "windy — mind your hat" };
      const moon = (() => { try { return DH.env.moonName && DH.env.moonName(); } catch (e) { return null; } })();
      ctx.fillStyle = "#ffe9b0"; ctx.font = "bold 11px sans-serif"; ctx.textAlign = "center";
      ctx.fillText(`Today: ${WINFO[w2] || w2}${moon ? ` · tonight: ${moon} moon` : ""}`, x0 + w / 2, y0 + h - 30);
    } else {
      // silly show: dancing bugs
      for (let i = 0; i < 4; i++) {
        const bx = x0 + 40 + i * ((w - 80) / 3), by = y0 + h - 66 + Math.abs(Math.sin(now / 220 + i * 1.4)) * -14;
        ctx.fillStyle = ["#e05b8a", "#5bc8d0", "#ffd76b", "#8ad05b"][i];
        ctx.beginPath(); ctx.ellipse(bx, by, 6, 7, 0, 0, 7); ctx.fill();
        R(ctx, bx - 1, by - 11, 1.5, 4, "#222"); R(ctx, bx + 2, by - 11, 1.5, 4, "#222");
        ctx.fillStyle = "#222"; ctx.fillRect(bx - 2, by - 3, 1.5, 1.5); ctx.fillRect(bx + 2, by - 3, 1.5, 1.5);
      }
      if (Math.random() < 0.1) notes(x0 + 40 + Math.random() * (w - 80), y0 + h - 80, 1);
      ctx.fillStyle = "#ffe9b0"; ctx.font = "bold 11px sans-serif"; ctx.textAlign = "center";
      ctx.fillText("Four bugs. One stage. No regrets.", x0 + w / 2, y0 + h - 30);
    }
    // title bar + scrolling ticker
    R(ctx, x0 + 4, y0 + h - 22, w - 8, 18, "#14142a");
    ctx.fillStyle = "#8ad0ff"; ctx.font = "bold 9px sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    const tick = `${title}  ·  dream home channel 1  ·  ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}  ·  ★ `.repeat(3);
    const tw = ctx.measureText(tick).width;
    const off = (now * 0.06) % (tw / 3);
    ctx.fillText(tick, x0 + 8 - off, y0 + h - 13);
    ctx.textBaseline = "alphabetic";
  }
})();
DH.register("music", DH.music);
