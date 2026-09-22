/* dream-home orchestrator — input, loop, camera, HUD, modal menu, pause.
   Modules (furniture/garden/animals) plug in through the DH.<name> contract
   described in each stub file. This file owns: players, shared state, loop,
   interaction dispatch, HUD, menus, touch pads.
*/
(function () {
  const DH = (window.DH = window.DH || {});
  const $ = id => document.getElementById(id);
  const cv = $("cv"), ctx = cv.getContext("2d");
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
  const inp = [{ l: 0, r: 0, u: 0, d: 0, a: 0, aEdge: 0 }, { l: 0, r: 0, u: 0, d: 0, a: 0, aEdge: 0 }];
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

  document.querySelectorAll(".tbtn").forEach(btn => {
    const pi = +btn.dataset.p, key = btn.dataset.k;
    const on = e => { e.preventDefault(); const k = inp[pi]; if (key === "a" && !k.a) k.aEdge = 1; k[key] = 1; btn.classList.add("on"); };
    const off = e => { e.preventDefault(); inp[pi][key] = 0; btn.classList.remove("on"); };
    btn.addEventListener("pointerdown", on);
    btn.addEventListener("pointerup", off);
    btn.addEventListener("pointercancel", off);
    btn.addEventListener("pointerleave", off);
  });
  if (("ontouchstart" in window) || navigator.maxTouchPoints > 0) $("touchLayer").classList.remove("hidden");

  // ---------- camera ----------
  let camX = 0, camY = 0;
  function updateCamera() {
    const ps = state.players;
    const mx = ps.reduce((s, p) => s + p.x, 0) / ps.length;
    const my = ps.reduce((s, p) => s + p.y, 0) / ps.length;
    camX += (mx - cv.width / 2 - camX) * 0.08;
    camY += (my - cv.height / 2 - camY) * 0.08;
    const W = DH.world;
    camX = Math.max(0, Math.min(camX, W.W * W.T - cv.width));
    camY = Math.max(0, Math.min(camY, W.H * W.T - cv.height));
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
    const acts = nearestActions(p);
    if (acts.length) acts[0].action();
  }

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
  const modules = [DH.furniture, DH.garden, DH.animals].filter(Boolean);
  modules.forEach(m => m.init && m.init(state));

  // ---------- loop ----------
  let last = 0;
  function frame(t) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (t - last) / 1000) || 0.016;
    last = t;
    if (!state.running || state.paused) { if (state.running) render(dt); return; }

    state.timeMin = (state.timeMin + dt * 4) % (24 * 60); // 4 min/day (dt*4 => 4 min per real sec? tune: 360/day)
    for (const p of state.players) {
      movePlayer(p, inp[p.pid], dt);
      if (inp[p.pid].aEdge) { inp[p.pid].aEdge = 0; tryAction(p); }
    }
    modules.forEach(m => m.update && m.update(dt, state));
    updateCamera();
    render(dt);
    hud();
  }

  function render(dt) {
    const W = DH.world;
    ctx.clearRect(0, 0, cv.width, cv.height);
    W.draw(ctx, camX, camY);
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
  $("btnResume").addEventListener("click", () => togglePause(false));
  $("btnQuit").addEventListener("click", () => {
    state.running = false; state.paused = false;
    $("pauseScreen").classList.add("hidden"); $("titleScreen").classList.remove("hidden");
  });

  $("btnStart").addEventListener("click", () => {
    state.players = [
      makePlayer(0, "koto", $("name1").value || "koto", 9 * 32 + 16, 8 * 32),
      makePlayer(1, "zuza", $("name2").value || "zuza", 10 * 32 + 16, 8 * 32),
    ];
    $("hudP1").textContent = state.players[0].name;
    $("hudP2").textContent = state.players[1].name;
    modules.forEach(m => m.start && m.start(state));
    $("titleScreen").classList.add("hidden");
    state.running = true; state.paused = false;
    DH.toast("Welcome home! 🏡");
  });

  requestAnimationFrame(frame);
})();
