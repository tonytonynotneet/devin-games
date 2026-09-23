/* dream-home phone module — the in-game NookPhone.
   Implements AC_SPEC P-1 (phone home-screen / central menu), P-4 (sleep = save
   ritual), P-6 (tutorial week).

   Contract with game.js:
     DH.phone.init(state)        – builds HUD chip + DOM overlays (once at load)
     DH.phone.start(state)       – called when a run starts
     DH.phone.update(dt,state)   – host-only sim: tutorial step tracking
     DH.phone.interactables(p)   – bed → "Sleep until tomorrow" ritual
     DH.phone.serialize()/deserialize(d)/remoteAction(name,args)

   P-1 PHONE: a persistent 📱 chip in the HUD (next to ❓) opens a rounded pixel
   phone overlay with an app grid — Map (live minimap), Critterpedia, Catalog,
   Milestones, Album, Island rating, Settings. Every app is defensive: when its
   backing module is absent the app shows a "not installed" stub.

   P-4 SLEEP: standing by a bed offers "Sleep until tomorrow". Sleeping does NOT
   skip time (the clock is real-time AC-style); it runs the save ritual —
   "Today at home" summary card → DH.save.now() → good-night card → dimmed
   standby screen ("Zzz — tap to wake") → tap to resume. Records lastSleep day.

   P-6 TUTORIAL WEEK: the first 3 game-days show a dismissible banner with the
   next unfinished lesson (shake a tree / sell something / gift your partner)
   and 3-star progress. Done-ness is detected from DH.alog + coin delta + the
   couple module's gift pose.

   Everything is DOM (HUD chip, phone overlay, sleep overlay, tutorial banner) —
   no world-space drawing, so drawGround/collectDraws are omitted. All state
   lives in S (plain JSON; round-trips through mods.phone and net snapshots).
   UI is host/guest agnostic; sim + save run only under M.authority.
*/
(function () {
  const DH = (window.DH = window.DH || {});
  const T = 32;

  // ---------- module state (plain JSON only) ----------
  const S = {
    tut: { done: [false, false, false], dis: [false, false, false], cel: false },
    sleep: { day: -1, at: 0, count: 0 }, // lastSleep game-day / real ts / times slept
    settings: { muted: false },
    base: null, // coins baseline for the "sell something" tutorial step
  };
  let gs = null; // shared DH.state — not serialized

  // ---------- runtime-only (never serialized) ----------
  const RT = { t0: 0, gifts: 0, hearts: 0, lastPose: "", lastCdsGift: 0 };
  let phoneEl = null, sleepEl = null, tutEl = null, tutTxt = null, tutStars = null;
  let mapTimer = 0, statusTimer = 0, tutCheckT = 0;
  let phoneOpen = false, sleepOpen = false;
  const isGuest = () => DH.net && DH.net.online && DH.net.role === "guest";

  const el = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };

  // ---------- injected styles (kept inside this module) ----------
  function injectCss() {
    const st = el("style");
    st.textContent = `
      #phoneOv { position: absolute; inset: 0; z-index: 26; display: flex; align-items: center;
                 justify-content: center; background: rgba(8,8,20,.72); }
      #phoneOv.hidden { display: none !important; }
      .phFrame { width: min(330px, 90vw); height: min(610px, 88%); background: #10101c;
                 border: 5px solid #04040a; border-radius: 36px; padding: 10px;
                 box-shadow: 0 0 0 3px #2b2b45, 0 18px 44px #000b; display: flex; flex-direction: column; }
      .phScr { flex: 1; min-height: 0; background: linear-gradient(180deg,#2c4a38,#1d2c2a);
               border-radius: 24px; display: flex; flex-direction: column; overflow: hidden; }
      .phStatus { display: flex; justify-content: space-between; padding: 7px 14px;
                  font-size: 12px; font-weight: 700; color: #dff3e4; background: #00000033; }
      .phBody { flex: 1; overflow-y: auto; padding: 14px 12px; }
      .phGrid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
      .phApp { background: #ffffff14; border: 2px solid #ffffff22; border-radius: 14px;
               padding: 14px 4px 10px; text-align: center; color: #eef; cursor: pointer;
               font-size: 12px; font-weight: 600; line-height: 1.2; }
      .phApp:active { background: #ffffff30; }
      .phApp .ic { font-size: 30px; display: block; margin-bottom: 6px; }
      .phBar { display: flex; justify-content: space-between; align-items: center;
               padding: 8px 12px; background: #00000040; }
      .phBtn { background: #ffffff22; border: none; color: #fff; border-radius: 12px;
               padding: 9px 18px; font-size: 14px; font-weight: 700; cursor: pointer; }
      .phBtn.warn { background: #c2434d; }
      .phCard { background: #00000030; border-radius: 12px; padding: 12px; color: #e8f4ea;
                font-size: 13px; line-height: 1.55; }
      .phCard h3 { font-size: 15px; margin-bottom: 8px; color: #fff; }
      .phRow { display: flex; justify-content: space-between; gap: 8px; padding: 6px 0;
               border-bottom: 1px solid #ffffff12; align-items: center; }
      .phRow:last-child { border-bottom: none; }
      .phMap { display: block; margin: 0 auto; image-rendering: pixelated;
               border-radius: 8px; border: 2px solid #ffffff22; }
      .phCap { text-align: center; font-size: 11px; opacity: .75; margin-top: 8px; }

      #sleepOv { position: absolute; inset: 0; z-index: 26; display: flex; align-items: center;
                 justify-content: center; background: rgba(6,6,18,.86); }
      #sleepOv.hidden { display: none !important; }
      .slCard { background: #23233d; border-radius: 16px; padding: 24px 26px; text-align: center;
                max-width: 420px; width: 90%; }
      .slCard h2 { font-size: 22px; margin-bottom: 12px; }
      .slRow { display: flex; justify-content: space-between; padding: 5px 0;
               border-bottom: 1px solid #ffffff12; font-size: 14px; }
      .slRow:last-of-type { border-bottom: none; }
      .slBtns { display: flex; gap: 10px; justify-content: center; margin-top: 16px; flex-wrap: wrap; }
      .slZzz { font-size: 40px; letter-spacing: 6px; }

      #tutBanner { position: absolute; top: 52px; left: 50%; transform: translateX(-50%);
                   z-index: 17; background: #14142ae6; border: 2px solid #ffd76b55;
                   border-radius: 14px; padding: 8px 10px 8px 14px; display: flex; gap: 8px;
                   align-items: center; max-width: 88vw; font-size: 13px; font-weight: 600;
                   color: #fff; box-shadow: 0 4px 14px #0006; }
      #tutBanner.hidden { display: none !important; }
      #tutBanner .tutStars { color: #ffd76b; letter-spacing: 2px; white-space: nowrap; }
      #tutBanner button { background: #ffffff22; border: none; color: #fff; border-radius: 8px;
                          padding: 4px 9px; font-size: 13px; cursor: pointer; }
    `;
    document.head.appendChild(st);
  }

  // ---------- HUD chip (📱 next to ❓) ----------
  function makeChip() {
    const b = el("button", "chip", "📱");
    b.id = "btnPhone";
    b.title = "Phone — map, catalog, settings";
    b.style.cssText = "cursor:pointer;border:none;font-family:inherit;font-size:15px";
    b.addEventListener("click", () => openPhone());
    const hud = document.getElementById("hud");
    const fb = document.getElementById("btnFb");
    hud.insertBefore(b, fb || null); // lands right after ❓
    return b;
  }

  function pauseForUI() {
    if (isGuest() || !gs || !gs.running) return;
    gs.paused = true;
    const ps = document.getElementById("pauseScreen");
    if (ps) ps.classList.add("hidden");
  }
  function unpause() {
    if (!gs || !gs.running) return;
    const menuOpen = !document.getElementById("menuScreen").classList.contains("hidden");
    if (!menuOpen && !phoneOpen && !sleepOpen) gs.paused = false;
  }

  // ---------- P-1: the phone ----------
  const APPS = [
    { k: "map",      ic: "🗺️", label: "Map" },
    { k: "critters", ic: "📖", label: "Critterpedia" },
    { k: "catalog",  ic: "🛍️", label: "Catalog" },
    { k: "miles",    ic: "⭐", label: "Milestones" },
    { k: "album",    ic: "🖼️", label: "Album" },
    { k: "rating",   ic: "🏝️", label: "Island rating" },
    { k: "sleep",    ic: "😴", label: "Sleep" },
    { k: "settings", ic: "⚙️", label: "Settings" },
  ];

  function phoneUI() {
    if (phoneEl) return phoneEl;
    const ov = el("div", "hidden");
    ov.id = "phoneOv";
    ov.innerHTML =
      '<div class="phFrame">' +
        '<div class="phScr">' +
          '<div class="phStatus"><span class="phClock">8:00</span><span>DreamPhone</span><span class="phStat2">📶 🔋</span></div>' +
          '<div class="phBody"></div>' +
          '<div class="phBar">' +
            '<button class="phBtn phHome">◀ Home</button>' +
            '<span class="phDay" style="font-size:12px;opacity:.8"></span>' +
            '<button class="phBtn phClose">✕</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    ov.addEventListener("click", e => { if (e.target === ov) closePhone(); });
    ov.querySelector(".phClose").addEventListener("click", closePhone);
    ov.querySelector(".phHome").addEventListener("click", () => showScreen("home"));
    document.getElementById("stage").appendChild(ov);
    phoneEl = ov;
    return ov;
  }

  function openPhone() {
    const ov = phoneUI();
    phoneOpen = true;
    ov.classList.remove("hidden");
    pauseForUI();
    showScreen("home");
    clearInterval(statusTimer);
    statusTimer = setInterval(refreshStatus, 1000);
    refreshStatus();
    if (DH.alog) DH.alog.add("phone", "open");
  }
  function closePhone() {
    if (!phoneEl) return;
    phoneOpen = false;
    phoneEl.classList.add("hidden");
    clearInterval(statusTimer); clearInterval(mapTimer); mapTimer = 0;
    unpause();
  }
  function refreshStatus() {
    if (!phoneEl || !gs) return;
    const hh = Math.round(gs.timeMin || 480);
    phoneEl.querySelector(".phClock").textContent =
      `${String(Math.floor(hh / 60)).padStart(2, "0")}:${String(hh % 60).padStart(2, "0")}`;
    phoneEl.querySelector(".phDay").textContent =
      `day ${Math.floor(gs.day || 0) + 1} · 🪙${Math.floor(gs.coins || 0)}`;
  }

  function showScreen(name) {
    const body = phoneEl.querySelector(".phBody");
    clearInterval(mapTimer); mapTimer = 0;
    body.innerHTML = "";
    if (name === "home") return renderHome(body);
    if (name === "map") return renderMap(body);
    if (name === "settings") return renderSettings(body);
    if (name === "sleep") { closePhone(); return startSleep(); }
    const stub = (label, desc) => {
      const c = el("div", "phCard", `<h3>${label}</h3><p>${desc}</p>`);
      body.appendChild(c);
    };
    const jump = fn => { closePhone(); fn(); };
    switch (name) {
      case "critters":
        if (DH.critters && DH.critters.openPedia) jump(() => DH.critters.openPedia());
        else stub("📖 Critterpedia", "Not installed on this island yet — the critters module isn't loaded.");
        break;
      case "catalog":
        if (DH.econ && DH.econ.openShop) jump(() => DH.econ.openShop());
        else stub("🛍️ Catalog", "Not installed yet — Nook hasn't set up shop here.");
        break;
      case "miles":
        if (DH.museum && DH.museum.openMuseum) jump(() => DH.museum.openMuseum());
        else stub("⭐ Milestones", "Not installed yet — the museum is still under construction.");
        break;
      case "album":
        if (DH.memories && DH.memories.openAlbum) jump(() => DH.memories.openAlbum());
        else if (DH.memories && DH.memories.openMenu) jump(() => DH.memories.openMenu());
        else stub("🖼️ Album", "Not installed yet — no memories to look back on.");
        break;
      case "rating":
        if (DH.island && DH.island.openRating) jump(() => DH.island.openRating());
        else stub("🏝️ Island rating", "Not installed yet — nobody is scoring this island.");
        break;
    }
  }

  function renderHome(body) {
    const grid = el("div", "phGrid");
    APPS.forEach(a => {
      const b = el("button", "phApp", `<span class="ic">${a.ic}</span>${a.label}`);
      b.addEventListener("click", () => showScreen(a.k));
      grid.appendChild(b);
    });
    body.appendChild(grid);
    const tip = el("div", "phCap", "your pocket island companion — everything lives here");
    body.appendChild(tip);
  }

  // ---------- Map app: scaled world + player dots + zone labels ----------
  const MAP_COLORS = { 0: "#77c44f", 1: "#d9a862", 2: "#9c6740", 3: "#7a5232", 4: "#4a9bd8", 5: "#c9b797", 6: "#9a7a4a", 7: "#e8d9a0" };
  const MAP_LABELS = [
    { t: "HOME", x: 9.5, y: 5.6 }, { t: "GARDEN", x: 22, y: 6 },
    { t: "PASTURE", x: 5.5, y: 14 }, { t: "POND", x: 24.5, y: 15 },
  ];
  function renderMap(body) {
    const W = DH.world;
    if (!W) { body.appendChild(el("div", "phCard", "<h3>🗺️ Map</h3><p>The world is still loading…</p>")); return; }
    const scale = 9; // px per tile → 270x171
    const cv = el("canvas", "phMap");
    cv.width = W.W * scale; cv.height = W.H * scale;
    body.appendChild(cv);
    body.appendChild(el("div", "phCap", "🟢 koto · 🌸 zuza — live positions"));
    const c = cv.getContext("2d");
    const paint = () => {
      c.imageSmoothingEnabled = false;
      for (let y = 0; y < W.H; y++) for (let x = 0; x < W.W; x++) {
        c.fillStyle = MAP_COLORS[W.tileAt(x, y)] || "#77c44f";
        c.fillRect(x * scale, y * scale, scale, scale);
      }
      c.font = "bold 6px sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
      for (const l of MAP_LABELS) {
        const lx = l.x * scale, ly = l.y * scale;
        c.fillStyle = "#00000088"; c.fillText(l.t, lx + 0.5, ly + 0.5);
        c.fillStyle = "#ffffffee"; c.fillText(l.t, lx, ly);
      }
      (gs && gs.players || []).forEach((p, i) => {
        const px = p.x / T * scale, py = p.y / T * scale;
        c.fillStyle = i === 0 ? "#4ecdc4" : "#ff6b9d";
        c.beginPath(); c.arc(px, py, 3, 0, Math.PI * 2); c.fill();
        c.strokeStyle = "#fff"; c.lineWidth = 1; c.stroke();
      });
    };
    paint();
    mapTimer = setInterval(paint, 400);
  }

  // ---------- Settings app ----------
  function renderSettings(body) {
    const c = el("div", "phCard");
    c.appendChild(el("h3", null, "⚙️ Settings"));
    const muteRow = el("div", "phRow", `<span>Sounds</span>`);
    const muteBtn = el("button", "phBtn", S.settings.muted ? "🔇 Muted" : "🔊 On");
    muteBtn.addEventListener("click", () => {
      S.settings.muted = !S.settings.muted;
      applyMute();
      muteBtn.textContent = S.settings.muted ? "🔇 Muted" : "🔊 On";
      DH.toast(S.settings.muted ? "Sounds muted 🔇" : "Sounds on 🔊");
    });
    muteRow.appendChild(muteBtn); c.appendChild(muteRow);

    const saveRow = el("div", "phRow", `<span>Progress</span>`);
    const saveBtn = el("button", "phBtn", "💾 Save now");
    saveBtn.addEventListener("click", () => {
      if (!isGuest()) DH.save.now();
      DH.toast("Saved ✓");
      if (DH.alog) DH.alog.add("phone", "quicksave");
    });
    saveRow.appendChild(saveBtn); c.appendChild(saveRow);

    const tutRow = el("div", "phRow", `<span>Tutorial stars</span>`);
    tutRow.appendChild(el("span", "tutStars", starStr()));
    c.appendChild(tutRow);

    const rstRow = el("div", "phRow", `<span>Start over</span>`);
    const rstBtn = el("button", "phBtn warn", "🗑 Reset save");
    rstBtn._armed = false;
    rstBtn.addEventListener("click", () => {
      if (!rstBtn._armed) { // confirm inline: first tap arms, second erases
        rstBtn._armed = true;
        rstBtn.textContent = "⚠️ Tap again to erase";
        setTimeout(() => { if (rstBtn.isConnected) { rstBtn._armed = false; rstBtn.textContent = "🗑 Reset save"; } }, 3000);
        return;
      }
      DH.save.clear();
      try { localStorage.removeItem("dreamhome-analytics"); } catch (e) {}
      c.innerHTML = "<h3>Save erased</h3><p>A fresh island awaits…</p>";
      setTimeout(() => location.reload(), 900);
    });
    rstRow.appendChild(rstBtn); c.appendChild(rstRow);
    body.appendChild(c);
  }

  // ---------- mute (patches AudioContext so module synths stay quiet) ----------
  let acSeen = null;
  function patchAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC || AC._dhPhonePatched) return;
    acSeen = new Set();
    const Orig = AC;
    const Wrapped = function (...a) {
      const c = new Orig(...a);
      acSeen.add(c);
      if (S.settings.muted && c.suspend) c.suspend().catch(() => {});
      return c;
    };
    Wrapped.prototype = Orig.prototype;
    try { Object.setPrototypeOf(Wrapped, Orig); } catch (e) {}
    window.AudioContext = Wrapped;
    if (window.webkitAudioContext) window.webkitAudioContext = Wrapped;
    Wrapped._dhPhonePatched = true;
  }
  function applyMute() {
    patchAudio();
    DH.muted = S.settings.muted;
    if (acSeen) for (const c of acSeen) {
      try { (S.settings.muted ? c.suspend() : c.resume()).catch(() => {}); } catch (e) {}
    }
  }

  // ---------- P-4: sleep = save ritual ----------
  function beds() {
    if (!DH.furniture || !DH.furniture.serialize) return [];
    const items = (DH.furniture.serialize() || {}).items || [];
    return items.filter(it => it && it.id === "bed")
      .map(it => ({ it, x: (it.x0 + 1) * T, y: (it.y0 + 0.75) * T, r: 54 }));
  }

  function todaySummary() {
    // highlights of this day, from the shared activity log + live couple signals
    const since = RT.t0;
    let catches = 0, forages = 0, vgifts = 0, bells = 0;
    if (DH.alog && DH.alog.dump) {
      for (const e of DH.alog.dump(240)) {
        if (e.t < since) continue;
        if (e.e === "catch") catches++;
        else if (e.e === "forage") forages++;
        else if (e.e === "vgift") vgifts++;
        else if (e.e === "econ_sellall" || e.e === "econ_bin") bells += +e.d || 0;
        else if (e.e === "econ_sell") {
          const m = /^(.*) x(\d+)$/.exec(e.d || "");
          if (m) { const d = DH.items.get(m[1]); bells += (d ? d.price : 0) * (+m[2]); }
        }
      }
    }
    return { catches, forages, bells, gifts: vgifts + RT.gifts, hearts: RT.hearts };
  }

  function sleepUI() {
    if (sleepEl) return sleepEl;
    const ov = el("div", "hidden");
    ov.id = "sleepOv";
    ov.innerHTML = '<div class="slCard"></div>';
    document.getElementById("stage").appendChild(ov);
    sleepEl = ov;
    return ov;
  }

  function startSleep() {
    const ov = sleepUI();
    sleepOpen = true;
    ov.classList.remove("hidden");
    pauseForUI();
    const card = ov.querySelector(".slCard");
    const s = todaySummary();
    const rows = [];
    if (s.catches) rows.push(["🎣 Critters caught", "×" + s.catches]);
    if (s.forages) rows.push(["🌿 Foraged", "×" + s.forages]);
    if (s.bells) rows.push(["🪙 Bells earned", "+" + s.bells]);
    if (s.gifts) rows.push(["🎁 Gifts given", "×" + s.gifts]);
    if (s.hearts) rows.push(["💗 Sweet moments", "×" + s.hearts]);
    rows.push(["🏠 Home happiness", Math.round(gs.happiness)]);
    const list = rows.map(r => `<div class="slRow"><span>${r[0]}</span><b>${r[1]}</b></div>`).join("");
    card.innerHTML =
      `<h2>🌙 Today at home</h2>` +
      (rows.length > 1 ? list : '<p style="opacity:.8;font-size:14px">a quiet day — the island kept breathing.</p>' + list) +
      `<div class="slBtns">` +
        `<button class="bigbtn slGo">😴 Sleep — good night</button>` +
        `<button class="midbtn slSave">💾 Just save</button>` +
        `<button class="midbtn slNo">Not yet</button>` +
      `</div>`;
    card.querySelector(".slNo").addEventListener("click", wake);
    card.querySelector(".slSave").addEventListener("click", () => {
      if (!isGuest()) DH.save.now();
      DH.toast("Saved ✓");
      wake();
    });
    card.querySelector(".slGo").addEventListener("click", goodNight);
    if (DH.alog) DH.alog.add("phone", "sleep_card");
  }

  function goodNight() {
    if (!isGuest()) DH.save.now();
    S.sleep = { day: Math.floor(gs.day || 0), at: Date.now(), count: (S.sleep.count || 0) + 1 };
    const card = sleepEl.querySelector(".slCard");
    const names = (gs.players || []).map(p => p.name).join(" & ") || "you two";
    card.innerHTML =
      `<h2>🌙 Good night, ${names}</h2>` +
      `<p style="font-size:14px;opacity:.85">progress saved ✓ · sleep tight</p>` +
      `<div class="slBtns"><button class="bigbtn slZ">Turn off the light</button></div>`;
    card.querySelector(".slZ").addEventListener("click", standby);
  }

  function standby() {
    const card = sleepEl.querySelector(".slCard");
    card.innerHTML =
      `<div class="slZzz">Z&nbsp;z&nbsp;z</div>` +
      `<p style="margin-top:14px;font-size:15px">— tap to wake —</p>`;
    const wakeH = e => { e.preventDefault(); wake(); };
    sleepEl._wakeH = wakeH;
    sleepEl.addEventListener("pointerdown", wakeH, { once: true });
  }

  function wake() {
    sleepOpen = false;
    if (sleepEl) {
      sleepEl.classList.add("hidden");
      if (sleepEl._wakeH) { sleepEl.removeEventListener("pointerdown", sleepEl._wakeH); sleepEl._wakeH = null; }
    }
    RT.t0 = Math.floor(Date.now() / 1000); RT.gifts = 0; RT.hearts = 0;
    unpause();
    DH.toast("Good morning ☀️");
  }

  // ---------- P-6: tutorial week ----------
  const TUT = [
    { hint: "🌳 Day 1: walk to a tree and press A to shake it" },
    { hint: "🏪 Day 2: sell something at the shop sign" },
    { hint: "🎁 Day 3: stand by your partner and give a gift" },
  ];
  function starStr() {
    const n = S.tut.done.filter(Boolean).length;
    return "★".repeat(n) + "☆".repeat(3 - n);
  }
  function alogHas(pred) {
    if (!DH.alog || !DH.alog.dump) return false;
    return DH.alog.dump(240).some(pred);
  }
  function tutDone(i) {
    if (i === 0) return alogHas(e => e.e === "forage" && /shake/.test(e.d || ""));
    if (i === 1) return (S.base != null && gs && gs.coins > S.base) ||
      alogHas(e => /^econ_(sell|bin)/.test(e.e || ""));
    if (i === 2) {
      const cs = coupleState();
      return RT.gifts > 0 || alogHas(e => /gift/.test(e.e || "") || /gift/i.test(e.d || "")) ||
        !!(cs && cs.cds && cs.cds.gift > 0);
    }
    return false;
  }
  function tutBanner() {
    if (tutEl) return tutEl;
    tutEl = el("div", "hidden");
    tutEl.id = "tutBanner";
    tutTxt = el("span"); tutStars = el("span", "tutStars");
    const x = el("button", null, "✕"); x.title = "Dismiss this tip";
    x.addEventListener("click", () => {
      const i = curStep();
      if (i >= 0) S.tut.dis[i] = true;
      refreshTut();
    });
    tutEl.appendChild(tutTxt); tutEl.appendChild(tutStars); tutEl.appendChild(x);
    document.getElementById("stage").appendChild(tutEl);
    return tutEl;
  }
  function curStep() {
    for (let i = 0; i < TUT.length; i++) if (!S.tut.done[i] && !S.tut.dis[i]) return i;
    return -1;
  }
  function refreshTut() {
    tutBanner();
    const day = Math.floor((gs && gs.day) || 0);
    const i = gs && gs.running && day < 3 ? curStep() : -1;
    if (i < 0) { tutEl.classList.add("hidden"); return; }
    tutTxt.textContent = TUT[i].hint;
    tutStars.textContent = starStr();
    tutEl.classList.remove("hidden");
  }
  function checkTutorial() {
    if (!gs || !gs.running || (gs.day || 0) >= 3) { refreshTut(); return; }
    let changed = false;
    for (let i = 0; i < TUT.length; i++) {
      if (S.tut.done[i] || !tutDone(i)) continue;
      S.tut.done[i] = true; S.tut.dis[i] = false; changed = true;
      DH.toast(`⭐ Lesson learned! ${starStr()}`, 2200);
      if (DH.alog) DH.alog.add("phone", "tut" + i);
    }
    if (changed && S.tut.done.every(Boolean) && !S.tut.cel) {
      S.tut.cel = true;
      DH.toast("🌟 Tutorial week complete — the island is yours!", 3600);
    }
    refreshTut();
  }

  // watch the couple module's pose for gifts/heart moments (no alog there);
  // its state is internal — serialize() is the read window
  function coupleState() {
    try { return DH.couple && DH.couple.serialize ? DH.couple.serialize() : null; } catch (e) { return null; }
  }
  function watchCouple() {
    const c = coupleState();
    if (!c || !c.pose) return;
    const kind = c.pose.t > 0 ? c.pose.kind : "";
    if (kind && kind !== RT.lastPose) {
      if (kind === "gift") RT.gifts++;
      if (["hug", "hifi", "gift", "date", "hands"].indexOf(kind) >= 0) RT.hearts++;
    }
    RT.lastPose = kind;
  }

  // ---------- module contract ----------
  const M = (DH.phone = {
    authority: true,
    _state: S, // debug/testing handle (not part of the sync contract)

    init(state) {
      gs = state;
      injectCss();
      makeChip();
      tutBanner();
      patchAudio();
      window.addEventListener("keydown", e => {
        if (e.code !== "Escape") return;
        // game.js toggles pause first (its listener was registered earlier) —
        // while a phone overlay is up, Esc closes it instead of pausing.
        if (phoneOpen) closePhone();
        else if (sleepOpen) wake();
      });
    },

    start(state) {
      gs = state;
      M.authority = !(DH.net && DH.net.online && DH.net.role === "guest");
      RT.t0 = Math.floor(Date.now() / 1000); RT.gifts = 0; RT.hearts = 0; RT.lastPose = "";
      if (S.base == null) S.base = gs.coins || 0;
      applyMute();
      refreshTut();
    },

    offline() { return []; }, // the phone just slept through it too

    update(dt, state) {
      gs = state;
      if (!M.authority) return;
      watchCouple();
      tutCheckT += dt;
      if (tutCheckT >= 0.5) { tutCheckT = 0; checkTutorial(); }
    },

    interactables(p) {
      if (!gs || !(gs.players || []).length) return [];
      const out = [];
      const pZone = DH.world && DH.world.zone(Math.floor(p.x / T), Math.floor(p.y / T));
      if (pZone !== "house") return out; // beds live indoors
      for (const b of beds()) {
        const dd = (p.x - b.x) * (p.x - b.x) + (p.y - b.y) * (p.y - b.y);
        if (dd < b.r * b.r) {
          const it = b.it;
          out.push({
            label: "Sleep until tomorrow 😴", x: b.x, y: b.y,
            action: () => {
              const rows = [
                { ico: "😴", label: "Sleep until tomorrow — save & rest", cb: () => startSleep() },
              ];
              if (DH.furniture && DH.furniture.use)
                rows.push({ ico: "🌙", label: "Just nap — skip to morning (+3😊)", cb: () => DH.furniture.use(it.x0, it.y0) });
              if (DH.furniture && DH.furniture.remove)
                rows.push({ ico: "💰", label: "Sell the bed", cb: () => DH.furniture.remove(it.x0, it.y0) });
              DH.menu.open("🛏️ Comfy Bed", rows);
            },
          });
        }
      }
      return out;
    },

    serialize() {
      return JSON.parse(JSON.stringify({ tut: S.tut, sleep: S.sleep, settings: S.settings, base: S.base }));
    },
    deserialize(d) {
      if (!d || typeof d !== "object") return;
      if (d.tut && typeof d.tut === "object") {
        if (Array.isArray(d.tut.done)) d.tut.done.forEach((v, i) => { if (i < 3) S.tut.done[i] = !!v; });
        if (Array.isArray(d.tut.dis)) d.tut.dis.forEach((v, i) => { if (i < 3) S.tut.dis[i] = !!v; });
        S.tut.cel = !!d.tut.cel;
      }
      if (d.sleep && typeof d.sleep === "object") {
        if (typeof d.sleep.day === "number") S.sleep.day = d.sleep.day;
        if (typeof d.sleep.at === "number") S.sleep.at = d.sleep.at;
        if (typeof d.sleep.count === "number") S.sleep.count = d.sleep.count;
      }
      if (d.settings && typeof d.settings === "object") S.settings.muted = !!d.settings.muted;
      if (d.base != null) S.base = d.base;
      refreshTut();
    },

    remoteAction(name, args) {
      const a = args || [];
      if (name === "sleep") { startSleep(); return true; }
      if (name === "wake") { wake(); return true; }
      if (name === "mute") { S.settings.muted = !!a[0]; applyMute(); return true; }
      return false;
    },

    // public API for other modules / tests
    open: openPhone, close: closePhone, sleepNow: startSleep, wake,
    setMuted(v) { S.settings.muted = !!v; applyMute(); },
  });
})();

DH.register("phone", DH.phone);
