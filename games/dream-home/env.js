/* dream-home env module — sky, weather, time-of-day, moon (spec A-3..A-6).
   Contract with game.js (same as animals.js/econ.js):
     DH.env.init(state)         – called once at load
     DH.env.start(state)        – called when a run starts
     DH.env.update(dt, state)   – per frame (sim under authority)
     DH.env.interactables(p)    – -> [{label,x,y,action}] for the action key
     DH.env.collectDraws(draws, camX, camY) – bulletin board + star fragments
     DH.env.drawOverlay(ctx, camX, camY, state) – sky band, weather FX, moon
     DH.env.serialize()/deserialize(data)/remoteAction(name, args)

   A-3 Weather: one forecast per REAL day (seeded like econ's hot item):
     sunny | cloudy | rain | windy | snow (snow only while season === "winter").
     Rain draws streaks + a gloom tint + puddle sparkles, auto-waters forage
     flowers (via DH.forage._S, optional dependency) and raises
     DH.env.rainBonus so critters/fishing can read a catch-rate hint.
   A-4 Meteor showers: ~10% of real nights (seeded) a shower streaks shooting
     stars across the sky. Press A while a star streaks ("Make a wish ⭐") —
     next game day a ⭐ Star fragment washes up at the yard's edge. Winter
     nights occasionally get aurora curtains instead.
   A-5 Daily rhythm: morning/afternoon/evening/night dayparts drive subtle
     sky-band tints in drawOverlay off shared state.timeMin (no second clock).
     A bulletin board in the yard posts shop hours + the current phase.
     DH.env.isOpenHours() is the helper econ (or any module) can read.
   A-6 Moon: real lunar phase computed from the date, drawn per phase
     (new/crescent/half/gibbous/full); full moons glow and get a toast.

   Net-sync boundary: all sim state is plain JSON in S (weather, wishes,
   fragments). Sky FX are view-layer only, animated inside drawOverlay so
   guests render them too without running update(). Guests trigger wishes
   through remoteAction("wish", [x, y]).
*/
(function () {
  const DH = (window.DH = window.DH || {});
  const T = 32;
  const R = (ctx, x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
  const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp01 = v => Math.max(0, Math.min(1, v));

  // ---------- tuning ----------
  const SHOP_OPEN = 8 * 60, SHOP_CLOSE = 21 * 60;      // game-minutes
  const NIGHT_FROM = 21 * 60, NIGHT_TO = 5 * 60;       // night daypart
  const SHOWER_P = 0.10;                                // ~1 in 10 real nights
  const AURORA_P = 0.18;                                // of winter nights
  const MAX_WISHES = 3;                                 // per shower night
  const MAX_FRAGS = 6;                                  // uncollected on the ground
  const BOARD = { tx: 12, ty: 11 };                     // bulletin board tile
  const BOARD_PT = { x: 12 * T + 16, y: 11 * T + 16, r: 42 };
  const FRAG_R = 30;

  // ---------- module state (plain JSON only — save bus + net snapshots) ----------
  let gs = null;
  const S = {
    dateKey: 0,        // real-date seed the weather belongs to
    weather: "sunny",  // sunny|cloudy|rain|snow|windy
    lastDay: -1,       // last seen floor(state.day) — game-day change detect
    lastPhase: "",     // last announced daypart
    wishDay: -1,       // game day wishes were last counted for
    wishN: 0,          // wishes made that day/night
    pending: 0,        // fragments owed next morning
    frags: [],         // [{x,y}] uncollected star fragments
    showerToast: 0,    // dateKey already announced for (avoid repeats)
    moonToast: 0,      // dateKey of last full-moon toast
  };
  const fx = { drops: [], flakes: [], leaves: [], streaks: [], sparkle: 0, t: 0 };
  let bootToastAt = 0; // local only — one "today's forecast" toast per session

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function dateSeed(off = 0) {
    const d = new Date(Date.now() + off * 86400000);
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  }
  function alog(e, d) { if (DH.alog) DH.alog.add(e, d); }
  function addHappy(n) { if (gs) gs.happiness = Math.max(0, gs.happiness + n); }

  // ---------- time helpers (shared clock: state.timeMin) ----------
  const timeMin = () => (gs && typeof gs.timeMin === "number" ? gs.timeMin : 720);
  const season = () => (gs && gs.season) || ["spring", "summer", "autumn", "winter"][Math.floor((gs && gs.day || 0) / 2) % 4];
  const isNight = t => { t = t == null ? timeMin() : t; return t >= NIGHT_FROM || t < NIGHT_TO; };
  function phase(t) {
    t = t == null ? timeMin() : ((t % 1440) + 1440) % 1440;
    if (t >= 5 * 60 && t < 12 * 60) return "morning";
    if (t < 17 * 60) return "afternoon";
    if (t < 21 * 60) return "evening";
    return "night";
  }
  function isOpenHours(t) { t = t == null ? timeMin() : t; return t >= SHOP_OPEN && t < SHOP_CLOSE; }
  const nightProg = () => ((timeMin() - NIGHT_FROM + 1440) % 1440) / ((1440 - NIGHT_FROM + NIGHT_TO) % 1440 || 480);

  // ---------- A-3 weather ----------
  const WINFO = {
    sunny: { ico: "☀️", line: "sunny and clear" },
    cloudy: { ico: "☁️", line: "cloudy" },
    rain: { ico: "☔", line: "rainy — no need to water the flowers" },
    snow: { ico: "❄️", line: "snowy — bundle up" },
    windy: { ico: "🍃", line: "windy" },
  };
  function rollWeather(key, seas) {
    const v = mulberry32((key ^ 0x9e3779) | 0)();
    if (seas === "winter") {
      if (v < 0.28) return "sunny";
      if (v < 0.52) return "cloudy";
      if (v < 0.80) return "snow";
      return "windy";
    }
    if (v < 0.42) return "sunny";
    if (v < 0.64) return "cloudy";
    if (v < 0.84) return "rain";
    return "windy";
  }
  function ensureWeather() {
    const key = dateSeed();
    if (S.dateKey === key) return;
    S.dateKey = key;
    let w = rollWeather(key, season());
    if (w === "snow" && season() !== "winter") w = "rain"; // season-gated
    if (w !== S.weather) { S.weather = w; }
    rainWatered = false;
  }
  let rainWatered = false, rainWaterT = 0;
  // rain → flowers auto-watered (forage is an optional dependency)
  function rainWaterFlowers() {
    if (S.weather !== "rain" || rainWatered) return;
    rainWatered = true;
    const fs = DH.forage && DH.forage._S && DH.forage._S.flowers;
    if (!fs) return;
    let n = 0;
    for (const f of fs) if (f && f.thirsty) { f.thirsty = false; f.watered = true; n++; }
    if (n) { DH.toast(`The rain watered ${n} flower${n > 1 ? "s" : ""} 💧`); alog("env_rainwater", n); }
  }

  // ---------- A-4 showers / aurora / moon ----------
  const showerNight = key => mulberry32((key ^ 0x51ce57) | 0)() < SHOWER_P;
  const auroraNight = key => mulberry32((key ^ 0xa0b0a) | 0)() < AURORA_P;
  const clearSky = () => S.weather !== "rain" && S.weather !== "snow";
  const showerActive = () => isNight() && clearSky() && showerNight(S.dateKey || dateSeed());
  const auroraActive = () => isNight() && clearSky() && season() === "winter" && auroraNight(S.dateKey || dateSeed());
  function moonPhase() { // 0=new, 0.5=full — real synodic cycle
    const synodic = 29.53058867;
    const days = (Date.now() - Date.UTC(2000, 0, 6, 18, 14)) / 86400000;
    return (((days % synodic) + synodic) % synodic) / synodic;
  }
  const MOON_NAMES = ["New moon", "Waxing crescent", "Half moon", "Waxing gibbous", "Full moon", "Waning gibbous", "Half moon", "Waning crescent"];
  const MOON_ICO = ["🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗", "🌘"];
  const moonName = p => MOON_NAMES[Math.round(p * 8) % 8];
  const moonIco = p => MOON_ICO[Math.round(p * 8) % 8];
  const moonIllum = p => (1 - Math.cos(p * Math.PI * 2)) / 2;

  // ---------- yard-edge tiles (star fragments wash up here) ----------
  let _edge = null;
  function edgeTiles() {
    if (_edge) return _edge;
    const W = DH.world, out = [];
    for (let ty = 0; ty < W.H; ty++) for (let tx = 0; tx < W.W; tx++) {
      if (ty < W.H - 2 && tx < W.W - 2) continue; // rim rows + right rim only
      if (W.isSolid(tx, ty) || W.blocked.has(tx + "," + ty)) continue;
      out.push({ x: tx * T + 16, y: ty * T + 16 });
    }
    return (_edge = out.length ? out : [{ x: 29 * T + 16, y: 10 * T + 16 }]);
  }
  function spawnFrag(seed) {
    const tiles = edgeTiles();
    const r = mulberry32((S.dateKey ^ (seed * 7919)) | 0);
    for (let i = 0; i < 8; i++) {
      const t = tiles[Math.floor(r() * tiles.length)];
      if (!S.frags.some(f => dist2(f.x, f.y, t.x, t.y) < 40 * 40)) {
        S.frags.push({ x: t.x + (r() - 0.5) * 10, y: t.y + (r() - 0.5) * 10 });
        return;
      }
    }
    const t = tiles[0];
    S.frags.push({ x: t.x, y: t.y });
  }

  // ---------- mutations (remote-callable) ----------
  const API = {
    wish(x, y) {
      if (!gs) return false;
      if (!showerActive()) { DH.toast("No shooting stars right now 🌠"); return false; }
      const di = Math.floor(gs.day || 0);
      if (S.wishDay !== di) { S.wishDay = di; S.wishN = 0; }
      if (S.wishN >= MAX_WISHES) { DH.toast("That's enough wishes for one night ⭐"); return false; }
      S.wishN++; S.pending++;
      wishFx(typeof x === "number" ? x : null, typeof y === "number" ? y : null);
      addHappy(2);
      alog("env_wish", S.wishN);
      DH.toast("You wished on a shooting star… 🌠");
      return true;
    },
    collectFrag(i) {
      const f = S.frags[i];
      if (!f || !gs) return false;
      if (DH.inv.add("star-frag", 1) <= 0) { DH.toast("Pockets are full! ☹️"); return false; }
      S.frags.splice(i, 1);
      burstFx(f.x, f.y);
      addHappy(2);
      alog("env_frag");
      DH.toast("Picked up a ⭐ Star fragment!");
      return true;
    },
  };

  // ---------- view-layer FX (local only; guests animate via drawOverlay) ----------
  function wishFx(x, y) {
    for (let i = 0; i < 10; i++)
      fx.streaks.push({ k: "spark", x: (x || (gs.players[0] && gs.players[0].x) || 480) + rnd(-12, 12), y: (y || (gs.players[0] && gs.players[0].y) || 300) - 18 + rnd(-8, 4), vx: rnd(-14, 14), vy: rnd(-26, -6), life: rnd(0.5, 0.9), max: 0.9 });
  }
  function burstFx(x, y) {
    for (let i = 0; i < 8; i++)
      fx.streaks.push({ k: "spark", x: x + rnd(-8, 8), y: y - 8 + rnd(-6, 2), vx: rnd(-10, 10), vy: rnd(-22, -8), life: rnd(0.4, 0.7), max: 0.7 });
  }
  function tickFx(dt, cw, ch) {
    fx.t += dt;
    const windy = S.weather === "windy";
    // rain streaks
    if (S.weather === "rain" || S.weather === "snow") {
      const want = S.weather === "rain" ? 80 : 46;
      while (fx.drops.length < want) fx.drops.push({ x: rnd(0, cw), y: rnd(-ch, 0), v: rnd(200, 320) });
      for (const d of fx.drops) { d.y += d.v * dt; d.x += (windy ? 60 : 18) * dt; if (d.y > ch + 8) { d.y = rnd(-30, -4); d.x = rnd(0, cw); } }
    } else fx.drops.length = 0;
    if (S.weather === "snow") {
      while (fx.flakes.length < 60) fx.flakes.push({ x: rnd(0, cw), y: rnd(-ch, 0), v: rnd(24, 46), ph: rnd(0, 6.28) });
      for (const f of fx.flakes) { f.y += f.v * dt; f.x += Math.sin(fx.t * 1.6 + f.ph) * 16 * dt; if (f.y > ch + 4) { f.y = rnd(-20, -2); f.x = rnd(0, cw); } }
    } else fx.flakes.length = 0;
    // leaves on windy days
    if (windy) {
      while (fx.leaves.length < 14) fx.leaves.push({ x: rnd(-40, cw), y: rnd(20, ch), v: rnd(90, 160), ph: rnd(0, 6.28), c: ["#8fd45f", "#e0a840", "#c07a4a"][Math.floor(rnd(0, 3))] });
      for (const l of fx.leaves) { l.x += l.v * dt; l.y += Math.sin(fx.t * 5 + l.ph) * 30 * dt; if (l.x > cw + 20) { l.x = rnd(-60, -10); l.y = rnd(20, ch); } }
    } else fx.leaves.length = 0;
    // shooting stars — often during a shower, rarely on any clear night
    fx.sparkle -= dt;
    if (isNight() && clearSky() && fx.sparkle <= 0) {
      fx.sparkle = showerActive() ? rnd(1.4, 3.4) : rnd(18, 40);
      fx.streaks.push({ k: "star", x: rnd(cw * 0.15, cw * 0.95), y: rnd(8, ch * 0.28), vx: -rnd(140, 220), vy: rnd(50, 90), life: 0.85, max: 0.85 });
    }
    for (let i = fx.streaks.length - 1; i >= 0; i--) {
      const s = fx.streaks[i];
      s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
      if (s.life <= 0) fx.streaks.splice(i, 1);
    }
  }

  // ---------- day announcements ----------
  function onNewDay(di) {
    S.lastDay = di;
    if (S.pending > 0) {
      const n = Math.min(S.pending, MAX_FRAGS - S.frags.length);
      for (let i = 0; i < n; i++) spawnFrag(S.pending + i);
      S.pending = 0;
      if (n > 0) setTimeout(() => DH.toast(`⭐ ${n === 1 ? "A star fragment" : `${n} star fragments`} washed up at the edge of the yard!`, 4200), 2600);
    }
  }
  function onPhase(ph, t) {
    S.lastPhase = ph;
    const hh = `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
    const w = WINFO[S.weather] || WINFO.sunny;
    if (ph === "morning") DH.toast(`☀️ Good morning! Today looks ${w.line} (${hh})`, 3600);
    else if (ph === "afternoon") DH.toast(`🌤 Afternoon drift — ${w.ico} ${w.line.split("—")[0].trim()} (${hh})`, 3000);
    else if (ph === "evening") DH.toast(`🌆 Evening glow (${hh})`, 3000);
    else {
      if (S.moonToast !== S.dateKey && moonIllum(moonPhase()) > 0.94) {
        S.moonToast = S.dateKey;
        DH.toast("🌕 Full moon tonight — the sky is glowing!", 3600);
      } else if (showerActive() && S.showerToast !== S.dateKey) {
        S.showerToast = S.dateKey;
        DH.toast("☄️ Meteor shower tonight — watch the sky and make a wish!", 4200);
      } else if (auroraActive() && S.showerToast !== S.dateKey) {
        S.showerToast = S.dateKey;
        DH.toast("🌌 The aurora is dancing tonight!", 3600);
      } else DH.toast(`🌙 Night falls (${hh})`, 2800);
    }
    alog("env_phase", ph);
  }

  // ---------- bulletin board ----------
  function openBoard() {
    const t = timeMin(), p = moonPhase(), w = WINFO[S.weather] || WINFO.sunny;
    const hh = `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
    const list = [
      { ico: w.ico, label: `Weather: <b>${S.weather}</b> — ${w.line}`, disabled: true, cb: () => {} },
      { ico: "🕐", label: `Now: <b>${phase()}</b> · ${hh}`, disabled: true, cb: () => {} },
      { ico: "🏪", label: isOpenHours() ? `Shops close at 21:00 — open now` : `Shop hours 8:00–21:00 — closed`, disabled: true, cb: () => {} },
      { ico: moonIco(p), label: `Moon: ${moonName(p)}`, disabled: true, cb: () => {} },
    ];
    if (showerNight(S.dateKey || dateSeed()))
      list.push({ ico: "☄️", label: clearSky() ? "Meteor shower expected tonight!" : "Meteor shower tonight — if the sky clears", disabled: true, cb: () => {} });
    if (season() === "winter" && auroraNight(S.dateKey || dateSeed()))
      list.push({ ico: "🌌", label: "Aurora forecast tonight!", disabled: true, cb: () => {} });
    if (S.frags.length)
      list.push({ ico: "⭐", label: `Rumor: ${S.frags.length} star fragment${S.frags.length > 1 ? "s" : ""} at the yard's edge`, disabled: true, cb: () => {} });
    DH.menu.open("📋 Bulletin board", list);
  }

  // ---------- drawing ----------
  function drawBoard(ctx, x, y) {
    R(ctx, x - 2, y - 10, 4, 12, "#6e4a2a");            // post
    R(ctx, x - 12, y - 26, 24, 17, "#a0733f");          // board
    R(ctx, x - 12, y - 26, 24, 2, "#c09055");
    R(ctx, x - 12, y - 11, 24, 2, "#7a5527");
    R(ctx, x - 10, y - 24, 20, 13, "#d9c9a8");          // pinned notes
    R(ctx, x - 8, y - 22, 6, 5, "#f4e8d0"); R(ctx, x - 1, y - 22, 7, 4, "#e8d0d0");
    R(ctx, x - 8, y - 15, 8, 4, "#d0e0f0"); R(ctx, x + 2, y - 16, 6, 5, "#f0e0b0");
    R(ctx, x - 8, y - 22, 2, 2, "#c94f4f");             // pin
  }
  function drawFrag(ctx, x, y) {
    const tw = 0.75 + Math.sin(Date.now() / 220 + x) * 0.25;
    ctx.save(); ctx.globalAlpha = tw;
    R(ctx, x - 2, y - 12, 4, 3, "#ffd94d");             // star: 5-point chunky
    R(ctx, x - 4, y - 9, 8, 4, "#ffd94d");
    R(ctx, x - 3, y - 5, 6, 3, "#f0b83a");
    R(ctx, x - 2, y - 11, 1, 1, "#fff8c9");
    ctx.restore();
    // soft glow
    const g = ctx.createRadialGradient(x, y - 8, 1, x, y - 8, 14);
    g.addColorStop(0, "rgba(255,220,120,0.35)"); g.addColorStop(1, "rgba(255,220,120,0)");
    ctx.fillStyle = g; ctx.fillRect(x - 14, y - 22, 28, 28);
  }

  // sky band colors per daypart [r,g,b,alpha]
  const SKY = {
    morning: [255, 190, 140, 0.16], afternoon: [120, 190, 255, 0.10],
    evening: [255, 120, 80, 0.18], night: [18, 28, 80, 0.30],
  };
  function skyTint() {
    if (S.weather === "rain") return [60, 75, 100, isNight() ? 0.34 : 0.26];
    if (S.weather === "snow") return [200, 210, 228, isNight() ? 0.30 : 0.20];
    if (S.weather === "cloudy") return [140, 155, 175, isNight() ? 0.30 : 0.18];
    const k = SKY[phase()];
    return k;
  }

  function drawSky(ctx, cw, ch) {
    const [r, g, b, a] = skyTint();
    const band = Math.min(ch * 0.30, 120);
    // vertical fade: tint strongest at top
    const grad = ctx.createLinearGradient(0, 0, 0, band);
    grad.addColorStop(0, `rgba(${r | 0},${g | 0},${b | 0},${a})`);
    grad.addColorStop(1, `rgba(${r | 0},${g | 0},${b | 0},0)`);
    ctx.fillStyle = grad; ctx.fillRect(0, 0, cw, band);
    // whole-scene weather gloom (subtle, rain/cloudy only)
    if (S.weather === "rain") { ctx.fillStyle = "rgba(35,50,80,0.10)"; ctx.fillRect(0, 0, cw, ch); }
    else if (S.weather === "cloudy") { ctx.fillStyle = "rgba(90,100,120,0.05)"; ctx.fillRect(0, 0, cw, ch); }

    // stars on clear nights
    if (isNight() && clearSky()) {
      const r0 = mulberry32(777);
      ctx.fillStyle = "#fff8e0";
      for (let i = 0; i < 46; i++) {
        const sx = r0() * cw, sy = r0() * band * 0.9;
        const tw = Math.sin(fx.t * 2 + i * 1.7) > -0.3 ? 1 : 0.4;
        ctx.globalAlpha = 0.5 * tw + (showerActive() ? 0.25 : 0);
        ctx.fillRect(sx | 0, sy | 0, i % 7 === 0 ? 2 : 1, i % 7 === 0 ? 2 : 1);
      }
      ctx.globalAlpha = 1;
    }
    // aurora curtains — rare winter nights
    if (auroraActive()) {
      for (let i = 0; i < 3; i++) {
        const cx = cw * (0.2 + i * 0.3) + Math.sin(fx.t * 0.5 + i * 2) * 26;
        const hgt = band * (0.85 + i * 0.14);
        const ag = ctx.createLinearGradient(0, 0, 0, hgt);
        const hue = i === 1 ? "140,255,170" : "90,220,200";
        ag.addColorStop(0, `rgba(${hue},${0.42 + Math.sin(fx.t * 0.9 + i) * 0.12})`);
        ag.addColorStop(1, `rgba(${hue},0)`);
        ctx.fillStyle = ag;
        ctx.beginPath();
        ctx.moveTo(cx - 34 - Math.sin(fx.t * 0.7 + i) * 8, 0);
        ctx.quadraticCurveTo(cx + Math.sin(fx.t * 0.6 + i) * 14, hgt * 0.5, cx - 10, hgt);
        ctx.lineTo(cx + 44, hgt);
        ctx.quadraticCurveTo(cx + 20, hgt * 0.5, cx + 34, 0);
        ctx.fill();
      }
    }
    // moon — real phase, arcs across the night sky
    if (isNight() && clearSky()) drawMoon(ctx, cw, ch);
    // drifting clouds — denser + darker when cloudy/rainy
    drawClouds(ctx, cw, band);
    // shooting-star streaks
    for (const s of fx.streaks) {
      if (s.k !== "star") continue;
      const a = clamp01(s.life / s.max);
      ctx.strokeStyle = `rgba(255,244,200,${a})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x - s.vx * 0.22, s.y - s.vy * 0.22); ctx.stroke();
      ctx.fillStyle = `rgba(255,252,230,${a})`;
      ctx.beginPath(); ctx.arc(s.x, s.y, 2.2, 0, Math.PI * 2); ctx.fill();
    }
  }
  function drawMoon(ctx, cw, ch) {
    const p = moonPhase(), prog = clamp01(nightProg());
    const mx = cw * (0.12 + prog * 0.76), my = Math.min(ch * 0.16, 92) - Math.sin(prog * Math.PI) * Math.min(ch * 0.07, 36);
    const rad = 13, ill = moonIllum(p);
    if (ill > 0.94) { // full-moon glow
      const g = ctx.createRadialGradient(mx, my, rad, mx, my, 52);
      g.addColorStop(0, "rgba(240,235,200,0.34)"); g.addColorStop(1, "rgba(240,235,200,0)");
      ctx.fillStyle = g; ctx.fillRect(mx - 52, my - 52, 104, 104);
    }
    // pixel disc: lit cells vs shadow cells by phase terminator
    const bx = Math.cos(2 * Math.PI * p) * rad;
    for (let gy = -rad; gy <= rad; gy++) for (let gx = -rad; gx <= rad; gx++) {
      if (gx * gx + gy * gy > rad * rad) continue;
      const lit = p <= 0.5 ? gx > bx : gx < -bx;
      if (lit) {
        // craters on a few lit cells
        const cr = mulberry32(gx * 31 + gy * 57 + 7)() < 0.07;
        ctx.fillStyle = cr ? "#cfc9ae" : "#f5efce";
      } else ctx.fillStyle = "rgba(30,38,80,0.85)";
      ctx.fillRect(mx + gx * 1.35, my + gy * 1.35, 1.5, 1.5);
    }
  }
  function drawClouds(ctx, cw, band) {
    const w = S.weather;
    const n = w === "rain" ? 5 : w === "cloudy" ? 4 : w === "snow" ? 4 : w === "windy" ? 3 : 1;
    const speed = w === "windy" ? 26 : 9;
    for (let i = 0; i < n; i++) {
      const r0 = mulberry32(i * 97 + 3);
      const cx = ((fx.t * speed + r0() * (cw + 320)) % (cw + 320)) - 160;
      const cy = 14 + r0() * (band * 0.55);
      const s = 0.8 + r0() * 0.9;
      ctx.fillStyle = w === "rain" ? "rgba(80,92,115,0.55)" : w === "cloudy" || w === "snow" ? "rgba(200,208,220,0.42)" : "rgba(245,248,255,0.5)";
      ctx.beginPath();
      ctx.ellipse(cx, cy, 46 * s, 13 * s, 0, 0, Math.PI * 2); ctx.fill();
      ctx.ellipse(cx - 24 * s, cy + 5 * s, 26 * s, 9 * s, 0, 0, Math.PI * 2); ctx.fill();
      ctx.ellipse(cx + 26 * s, cy + 4 * s, 24 * s, 8 * s, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
  function drawPrecip(ctx, cw, ch) {
    if (S.weather === "rain") {
      ctx.strokeStyle = "rgba(170,205,255,0.55)"; ctx.lineWidth = 1;
      ctx.beginPath();
      for (const d of fx.drops) { ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - 2, d.y + 9); }
      ctx.stroke();
      // puddle sparkles along the bottom
      const r0 = mulberry32(4242);
      for (let i = 0; i < 3; i++) {
        const px = r0() * cw, py = ch - 10 - r0() * 22;
        ctx.fillStyle = "rgba(140,180,230,0.22)";
        ctx.beginPath(); ctx.ellipse(px, py, 26, 5, 0, 0, Math.PI * 2); ctx.fill();
        if (Math.sin(fx.t * 3 + i * 2.4) > 0.4) { ctx.fillStyle = "rgba(230,244,255,0.7)"; ctx.fillRect(px - 6 + i * 6, py - 1, 3, 1); }
      }
    }
    if (S.weather === "snow") {
      ctx.fillStyle = "rgba(245,250,255,0.85)";
      for (const f of fx.flakes) ctx.fillRect(f.x | 0, f.y | 0, 2, 2);
    }
    for (const l of fx.leaves) {
      ctx.fillStyle = l.c;
      ctx.fillRect(l.x | 0, l.y | 0, 3, 2);
      ctx.fillRect(l.x + 1 | 0, l.y - 1 | 0, 1, 1);
    }
  }

  // ---------- module contract ----------
  const M = (DH.env = {
    authority: true,
    _S: S, // debug/testing handle

    init(state) {
      gs = state;
      M.authority = !(DH.net && DH.net.online && DH.net.role === "guest");
    },
    start(state) {
      gs = state;
      M.authority = !(DH.net && DH.net.online && DH.net.role === "guest");
      ensureWeather();
      if (S.lastDay < 0) S.lastDay = Math.floor(state.day || 0);
      S.lastPhase = phase(); // silent — no toast on entry
      if (!bootToastAt) {
        bootToastAt = Date.now();
        setTimeout(() => {
          if (gs && gs.running) {
            const w = WINFO[S.weather] || WINFO.sunny;
            DH.toast(`${w.ico} Today's forecast: ${w.line}`, 3600);
          }
        }, 5400);
      }
    },

    update(dt, state) {
      gs = state;
      ensureWeather();
      if (!M.authority) return;
      const di = Math.floor(state.day || 0);
      if (di !== S.lastDay) onNewDay(di);
      const t = timeMin(), ph = phase(t);
      if (ph !== S.lastPhase) onPhase(ph, t);
      // rain keeps topping up flower moisture every few seconds
      if (S.weather === "rain") {
        rainWaterT += dt;
        if (rainWaterT > 6) { rainWaterT = 0; rainWatered = false; rainWaterFlowers(); }
      }
    },

    // shared-bus hook: weather re-rolls on real date anyway — nothing decays
    offline() { ensureWeather(); return []; },

    interactables(p) {
      if (!gs || !gs.running) return [];
      const out = [];
      const dB = dist2(p.x, p.y, BOARD_PT.x, BOARD_PT.y);
      if (dB < BOARD_PT.r * BOARD_PT.r)
        out.push({ label: "Bulletin board 📋", x: BOARD_PT.x, y: BOARD_PT.y, d2: dB, action: openBoard });
      for (let i = 0; i < S.frags.length; i++) {
        const f = S.frags[i], d = dist2(p.x, p.y, f.x, f.y);
        if (d < FRAG_R * FRAG_R)
          out.push({ label: "Pick up ⭐ Star fragment", x: f.x, y: f.y, d2: d, action: () => API.collectFrag(i) });
      }
      // wish on a live shooting star — outdoors only, while it streaks
      const inHouse = DH.world.zone(Math.floor(p.x / T), Math.floor(p.y / T)) === "house";
      if (!inHouse && showerActive() && fx.streaks.some(s => s.k === "star"))
        out.push({ label: "Make a wish ⭐", x: p.x, y: p.y, d2: 0, action: () => API.wish(p.x, p.y) });
      out.sort((a, b) => (a.d2 || 0) - (b.d2 || 0));
      return out;
    },

    collectDraws(draws, camX, camY) {
      if (!ctxG) ctxG = document.getElementById("cv").getContext("2d");
      draws.push({ y: BOARD_PT.y + 4, fn: () => drawBoard(ctxG, BOARD_PT.x - camX, BOARD_PT.y - camY) });
      for (const f of S.frags)
        draws.push({ y: f.y, fn: () => drawFrag(ctxG, f.x - camX, f.y - camY) });
    },

    drawOverlay(ctx, camX, camY, state) {
      ctxG = ctx;
      const now = performance.now();
      const dt = Math.min(0.05, (now - (fx._last || now)) / 1000) || 0.016;
      fx._last = now;
      tickFx(dt, ctx.canvas.width, ctx.canvas.height);
      drawSky(ctx, ctx.canvas.width, ctx.canvas.height);
      drawPrecip(ctx, ctx.canvas.width, ctx.canvas.height);
      // wish/burst sparkles in world space
      for (const s of fx.streaks) {
        if (s.k !== "spark") continue;
        ctx.globalAlpha = clamp01(s.life / s.max);
        ctx.fillStyle = "#ffe98a";
        ctx.fillRect(s.x - camX - 1, s.y - camY - 1, 3, 3);
        ctx.globalAlpha = 1;
      }
    },

    // ----- sync boundary -----
    serialize() {
      return JSON.parse(JSON.stringify({
        dateKey: S.dateKey, weather: S.weather, lastDay: S.lastDay, lastPhase: S.lastPhase,
        wishDay: S.wishDay, wishN: S.wishN, pending: S.pending, frags: S.frags,
        showerToast: S.showerToast, moonToast: S.moonToast,
      }));
    },
    deserialize(d) {
      if (!d) return;
      if (typeof d.dateKey === "number") S.dateKey = d.dateKey;
      if (typeof d.weather === "string") S.weather = d.weather;
      if (typeof d.lastDay === "number") S.lastDay = d.lastDay;
      if (typeof d.lastPhase === "string") S.lastPhase = d.lastPhase;
      if (typeof d.wishDay === "number") S.wishDay = d.wishDay;
      if (typeof d.wishN === "number") S.wishN = d.wishN;
      if (typeof d.pending === "number") S.pending = d.pending;
      if (Array.isArray(d.frags)) S.frags = d.frags.filter(f => f && typeof f.x === "number" && typeof f.y === "number");
      if (typeof d.showerToast === "number") S.showerToast = d.showerToast;
      if (typeof d.moonToast === "number") S.moonToast = d.moonToast;
    },
    remoteAction(name, args) {
      return typeof API[name] === "function" ? API[name].apply(null, args || []) : false;
    },

    // ----- exposed helpers (forage/critters/econ may read) -----
    get weather() { return S.weather; },
    get rainBonus() { return S.weather === "rain"; },
    get phase() { return phase(); },
    phase, isNight, isOpenHours, showerActive, auroraActive, moonPhase, moonName, moonIco,
    wish: API.wish, collectFrag: API.collectFrag,
  });

  let ctxG = null;
})();

DH.register("env", DH.env);
