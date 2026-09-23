/* dream-home orchestrator — input, loop, camera, HUD, modal menu, pause.
   Modules (furniture/garden/animals) plug in through the DH.<name> contract
   described in each stub file. This file owns: players, shared state, loop,
   interaction dispatch, HUD, menus, touch pads.
*/
(function () {
  const DH = (window.DH = window.DH || {});
  const $ = id => document.getElementById(id);
  const cv = $("cv"), ctx = cv.getContext("2d");
  function fitCanvas() {
    const r = $("stage").getBoundingClientRect();
    const asp = (r.width || window.innerWidth) / Math.max(1, r.height || window.innerHeight);
    cv.width = Math.round(540 * Math.max(asp, 1));
    cv.height = Math.round(540 * Math.max(1 / asp, 1));
  }
  window.addEventListener("resize", fitCanvas);
  window.addEventListener("orientationchange", () => { setTimeout(fitCanvas, 150); setTimeout(fitCanvas, 450); });
  // block iOS Safari page zoom (it ignores user-scalable=no) — the game canvas
  // sizes itself, so the page must never be zoomed
  ["gesturestart", "gesturechange", "gestureend"].forEach(ev =>
    document.addEventListener(ev, e => e.preventDefault(), { passive: false }));
  document.addEventListener("dblclick", e => e.preventDefault(), { passive: false });
  fitCanvas();
  ctx.imageSmoothingEnabled = false;

  // ---------- shared state ----------
  const state = (DH.state = {
    running: false, paused: false,
    happiness: 0, coins: 50,
    timeMin: 8 * 60,          // minutes since midnight; full day = 4 real minutes
    players: [], notifications: [],
  });

  function makePlayer(i, char, name, x, y) {
    return { pid: i, char, name, x, y, vx: 0, vy: 0, dir: "down", step: 0, moving: false };
  }

  // ---------- input ----------
  const inp = (DH.inp = [{ l: 0, r: 0, u: 0, d: 0, a: 0, aEdge: 0 }, { l: 0, r: 0, u: 0, d: 0, a: 0, aEdge: 0 }]);
  const KEYMAP = {
    KeyA: [0, "l"], KeyD: [0, "r"], KeyW: [0, "u"], KeyS: [0, "d"], KeyF: [0, "a"], Space: [0, "a"],
    ArrowLeft: [1, "l"], ArrowRight: [1, "r"], ArrowUp: [1, "u"], ArrowDown: [1, "d"], Enter: [1, "a"],
  };
  window.addEventListener("keydown", e => {
    if (e.repeat) return;
    const m = KEYMAP[e.code];
    if (m) { const k = inp[m[0]]; if (!k[m[1]]) k.aEdge = m[1] === "a" ? 1 : k.aEdge; k[m[1]] = 1; e.preventDefault(); }
    if (e.code === "Escape" || e.code === "KeyP") togglePause();
  });
  window.addEventListener("keyup", e => { const m = KEYMAP[e.code]; if (m) inp[m[0]][m[1]] = 0; });

  // single virtual joystick — drag anywhere in the zone, direction = drag vector
  (function () {
    const zone = $("stickZone"), base = $("stickBase"), knob = $("stickKnob");
    if (!zone) return;
    const DEAD = 14, R = 34;
    let pid = null, ox = 0, oy = 0;
    const setVec = (vx, vy) => {
      const k = inp[0];
      k.l = vx < -DEAD ? 1 : 0; k.r = vx > DEAD ? 1 : 0;
      k.u = vy < -DEAD ? 1 : 0; k.d = vy > DEAD ? 1 : 0;
    };
    zone.addEventListener("pointerdown", e => {
      e.preventDefault(); pid = e.pointerId; zone.setPointerCapture(pid);
      const r = zone.getBoundingClientRect();
      ox = e.clientX - r.left; oy = e.clientY - r.top;
      base.classList.remove("hidden");
      base.style.left = ox + "px"; base.style.top = oy + "px";
      knob.style.transform = "translate(0px,0px)";
      setVec(0, 0);
    });
    zone.addEventListener("pointermove", e => {
      if (e.pointerId !== pid) return;
      const r = zone.getBoundingClientRect();
      let vx = e.clientX - r.left - ox, vy = e.clientY - r.top - oy;
      const m = Math.hypot(vx, vy), c = Math.min(m, R);
      if (m) { vx = vx / m * c; vy = vy / m * c; }
      knob.style.transform = `translate(${vx}px,${vy}px)`;
      setVec(e.clientX - r.left - ox, e.clientY - r.top - oy);
    });
    const end = e => {
      if (e.pointerId !== pid) return;
      pid = null; base.classList.add("hidden"); setVec(0, 0);
    };
    zone.addEventListener("pointerup", end);
    zone.addEventListener("pointercancel", end);
    const a = $("btnA");
    if (a) {
      const on = e => { e.preventDefault(); const k = inp[0]; if (!k.a) k.aEdge = 1; k.a = 1; a.classList.add("on"); };
      const off = e => { e.preventDefault(); inp[0].a = 0; a.classList.remove("on"); };
      a.addEventListener("pointerdown", on);
      a.addEventListener("pointerup", off);
      a.addEventListener("pointercancel", off);
      a.addEventListener("pointerleave", off);
    }
  })();
  if (("ontouchstart" in window) || navigator.maxTouchPoints > 0) $("touchLayer").classList.remove("hidden");

  // ---------- camera ----------
  let camX = 0, camY = 0;
  function updateCamera() {
    // solo on a per-player link → camera follows only your own character
    const net = DH.net;
    const duo = net && net.online && (net.role === "host" ? net._duo : net._synced);
    const meIdx = asWho === "zuza" ? 1 : asWho === "koto" ? 0 : -1;
    const ps = (meIdx >= 0 && !duo && state.players[meIdx]) ? [state.players[meIdx]] : state.players;
    const mx = ps.reduce((s, p) => s + p.x, 0) / ps.length;
    const my = ps.reduce((s, p) => s + p.y, 0) / ps.length;
    camX += (mx - cv.width / 2 - camX) * 0.08;
    camY += (my - cv.height / 2 - camY) * 0.08;
    const W = DH.world;
    const wW = W.W * W.T, wH = W.H * W.T;
    // viewport larger than the world → center the world instead of clamping
    camX = cv.width >= wW ? (wW - cv.width) / 2 : Math.max(0, Math.min(camX, wW - cv.width));
    camY = cv.height >= wH ? (wH - cv.height) / 2 : Math.max(0, Math.min(camY, wH - cv.height));
  }

  // ---------- movement ----------
  function movePlayer(p, k, dt) {
    const sp = 130; // px/s
    let dx = (k.r ? 1 : 0) - (k.l ? 1 : 0), dy = (k.d ? 1 : 0) - (k.u ? 1 : 0);
    if (dx && dy) { dx *= 0.707; dy *= 0.707; }
    p.moving = !!(dx || dy);
    if (p.moving) {
      p.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up");
      p.step += dt * 6;
    }
    const W = DH.world;
    const nx = p.x + dx * sp * dt;
    if (W.canStand(nx, p.y)) p.x = nx;
    const ny = p.y + dy * sp * dt;
    if (W.canStand(p.x, ny)) p.y = ny;
  }

  // ---------- interactions ----------
  // Each module may expose interactables(p) -> [{label, x, y, r, action}] and the
  // game shows a context menu with the action key.
  function nearestActions(p) {
    const acts = [];
    for (const mod of [DH.furniture, DH.garden, DH.animals]) {
      if (mod && mod.interactables) acts.push(...mod.interactables(p));
    }
    return acts;
  }
  function tryAction(p) {
    if (DH.net && DH.net.online && DH.net.role === "guest") {
      // guest asks the host to perform the action at its position
      DH.net.send({ type: "actAt", x: p.x, y: p.y });
      return;
    }
    const acts = nearestActions(p);
    if (acts.length) acts[0].action();
  }
  // host-side: run the nearest action for a remote player's position
  DH.tryActionAt = function (x, y) {
    const acts = nearestActions({ x, y, pid: 1 });
    if (acts.length) acts[0].action();
  };

  // ---------- menu modal ----------
  const menu = (DH.menu = {
    open(title, items) { // items: [{ico,label,cost,disabled,cb}]
      $("menuTitle").textContent = title;
      const box = $("menuItems");
      box.innerHTML = "";
      items.forEach(it => {
        const el = document.createElement("div");
        el.className = "item" + (it.disabled ? " dis" : "");
        el.innerHTML = `<span class="ico">${it.ico}</span>${it.label}` + (it.cost != null ? `<div class="cost">🪙${it.cost}</div>` : "");
        if (!it.disabled) el.addEventListener("click", () => { menu.close(); it.cb(); });
        box.appendChild(el);
      });
      $("menuScreen").classList.remove("hidden");
      state.paused = true; $("pauseScreen").classList.add("hidden");
    },
    close() { $("menuScreen").classList.add("hidden"); state.paused = false; },
  });
  $("menuClose").addEventListener("click", menu.close);

  DH.toast = function (msg, ms = 1600) {
    const t = $("toast"); t.textContent = msg; t.classList.remove("hidden");
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.add("hidden"), ms);
  };

  // ---------- modules ----------
  const modules = [
    ["furniture", DH.furniture], ["garden", DH.garden], ["animals", DH.animals],
    ["court", DH.court], ["sauna", DH.sauna], ["couple", DH.couple],
  ].filter(([_, m]) => m).map(([n, m]) => (m._name = n, m));
  modules.forEach(m => m.init && m.init(state));

  // ---------- loop ----------
  let last = 0;
  function frame(t) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (t - last) / 1000) || 0.016;
    last = t;
    if (!state.running || state.paused) { if (state.running) render(dt); return; }

    state.timeMin = (state.timeMin + dt * 4) % (24 * 60); // ~6 real min per day
    const net = DH.net;
    const guest = net && net.online && net.role === "guest";
    const asZuza = !guest && asWho === "zuza"; // zuza's link solo: she controls P2
    const NOKEYS = { l: 0, r: 0, u: 0, d: 0 };
    for (const p of state.players) {
      // online guest / solo-as-zuza drives P2 with local (P1-mapped) input
      const mine2 = guest || asZuza;
      const k = mine2 ? (p.pid === 1 ? inp[0] : NOKEYS) : inp[p.pid];
      movePlayer(p, k, dt);
      const edge = mine2 ? (p.pid === 1 ? inp[0].aEdge : 0) : inp[p.pid].aEdge;
      if (edge) {
        if (mine2) inp[0].aEdge = 0; else inp[p.pid].aEdge = 0;
        tryAction(p);
      }
    }
    if (net && net.online) {
      if (net.role === "host") net.hostTick(dt);
      else { net.guestSendInput(inp[0]); net.applySnapshot(); net.applyPositions(); }
    }
    if (!guest) modules.forEach(m => m.update && m.update(dt, state));
    // seasons: 1 season = 2 game days; spring→summer→autumn→winter→…
    state.day = (state.day || 0) + dt * 4 / (24 * 60);
    state.season = ["spring", "summer", "autumn", "winter"][Math.floor(state.day / 2) % 4];
    updateCamera();
    render(dt);
    hud();
  }

  function render(dt) {
    const W = DH.world;
    ctx.clearRect(0, 0, cv.width, cv.height);
    W.draw(ctx, camX, camY);
    modules.forEach(m => m.drawGround && m.drawGround(ctx, camX, camY, state));
    // depth-sorted draws: module entities + players by y
    const draws = [];
    modules.forEach(m => m.collectDraws && m.collectDraws(draws, camX, camY));
    state.players.forEach(p => draws.push({ y: p.y, fn: () => { DH.sprites.shadow(ctx, p.x - camX, p.y - camY); DH.sprites.drawPlayer(ctx, { ...p, x: p.x - camX, y: p.y - camY }); } }));
    draws.sort((a, b) => a.y - b.y).forEach(d => d.fn());
    modules.forEach(m => m.drawOverlay && m.drawOverlay(ctx, camX, camY, state));
    // interaction hint
    for (const p of state.players) {
      const acts = nearestActions(p);
      if (acts.length) {
        ctx.fillStyle = "#ffffffdd"; ctx.font = "bold 11px sans-serif"; ctx.textAlign = "center";
        ctx.fillText("⚡ " + acts[0].label, p.x - camX, p.y - camY - 42);
      }
    }
  }

  function hud() {
    const hh = Math.round(state.timeMin);
    $("hudHappy").textContent = Math.round(state.happiness);
    $("hudCoins").textContent = Math.floor(state.coins);
    $("hudTime").textContent = `${String(Math.floor(hh / 60)).padStart(2, "0")}:${String(hh % 60).padStart(2, "0")}`;
  }

  // ---------- pause/title ----------
  function togglePause(force) {
    if (!state.running) return;
    state.paused = force === true ? true : !state.paused;
    $("pauseScreen").classList.toggle("hidden", !state.paused);
    $("menuScreen").classList.add("hidden");
  }
  $("btnPause").addEventListener("click", () => togglePause());
  const btnHelp = $("btnHelp");
  if (btnHelp) {
    btnHelp.addEventListener("click", () => $("helpScreen").classList.remove("hidden"));
    $("btnHelpClose").addEventListener("click", () => $("helpScreen").classList.add("hidden"));
  }
  $("btnResume").addEventListener("click", () => togglePause(false));
  $("btnQuit").addEventListener("click", () => {
    state.running = false; state.paused = false;
    $("pauseScreen").classList.add("hidden"); $("titleScreen").classList.remove("hidden");
  });

  function startRun(names) {
    state.players = [
      makePlayer(0, "koto", names[0] || "koto", 9 * 32 + 16, 8 * 32),
      makePlayer(1, "zuza", names[1] || "zuza", 10 * 32 + 16, 8 * 32),
    ];
    $("hudP1").textContent = state.players[0].name;
    $("hudP2").textContent = state.players[1].name;
    modules.forEach(m => m.start && m.start(state));
    $("titleScreen").classList.add("hidden");
    state.running = true; state.paused = false;
    DH.toast("Welcome home! 🏡 Drag left side to move · tap A to act · ❓ for rules", 4000);
  }
  DH.startRun = startRun; // net.js calls this for the guest side

  $("btnStart").addEventListener("click", () => {
    startRun([$("name1").value, $("name2").value]);
  });

  // online auto-pair: first on the URL hosts (P1/koto), second is guest (P2/zuza)
  const btnOnline = $("btnOnline");
  if (btnOnline) btnOnline.addEventListener("click", () => {
    if (!DH.net || !window.DGOnline) { DH.toast("Online unavailable"); return; }
    btnOnline.disabled = true; btnOnline.textContent = "🌐 Connecting…";
    DH.net.connect(role => {
      if (role === "host") {
        btnOnline.textContent = "🌐 Waiting for partner…";
        startRun([$("name1").value || "koto", $("name2").value || "zuza"]);
        DH.toast("You are koto. Waiting for your partner…");
      } else {
        DH.net.send({ type: "hello" });
        DH.toast("Connected! You are zuza 💗");
      }
    });
  });

  // ?play or ?play=1 → jump straight into the game, skipping the title screen.
  // ?as=koto → online host (P1), ?as=zuza → online guest (P2); pair links auto-connect.
  const asWho = new URLSearchParams(location.search).get("as");
  if ((asWho === "koto" || asWho === "zuza") && DH.net && window.DGOnline) {
    const want = asWho === "koto" ? "host" : "guest";
    const names = [$("name1").value || "koto", $("name2").value || "zuza"];
    if (want === "guest") startRun(names); // zuza plays solo right away; upgrades to co-op when koto connects
    DH.toast(asWho === "koto" ? "Connecting… you're koto 🏠" : "Playing solo — koto can join anytime 💗");
    DH.net.connect(want, role => {
      if (role === "host") {
        startRun(names);
        DH.toast("You're koto. Waiting for zuza…");
      } else if (role === "guest") {
        DH.toast(state.running ? "koto joined — playing together 💗" : "You're zuza 💗");
        DH.net.send({ type: "hello" });
      } else if (!state.running) {
        startRun(names); // relay unreachable → solo fallback so the link still plays
      }
    });
  } else if (/[?&]play\b/.test(location.search)) {
    startRun([$("name1").value || "koto", $("name2").value || "zuza"]);
  }

  requestAnimationFrame(frame);
})();
