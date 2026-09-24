/* NEON CITY — game: boot, loop, camera, draw pipeline, title, save/net glue. */
(function () {
  const NC = window.NC;
  const U = NC.util;

  const qs = new URLSearchParams(location.search);
  const AUTOSTART = qs.get("play") === "1";
  const AS = qs.get("as"); // "koto" | "zuza" | null

  function newState() {
    const spawn = NC.world.randomRoad();
    const s = {
      running: true, day: 1, timeMin: 22 * 60, // night city
      players: [NC.player.mkPlayer("koto", spawn.x, spawn.y)],
      cam: { x: spawn.x, y: spawn.y, zoom: 1 },
      playSolo: true,
    };
    return s;
  }

  NC.me = () => {
    const s = NC.state;
    if (!s) return null;
    if (AS === "zuza" && s.players[1]) return s.players[1];
    return s.players[0];
  };

  function addZuza() {
    const s = NC.state;
    if (s.players.length > 1) return;
    const p0 = s.players[0];
    const p = NC.player.mkPlayer("zuza", p0.x + 26, p0.y);
    p.money = p0.money;
    s.players.push(p);
    NC.toast("zuza joined — partner in crime 🖤", 2600);
  }

  function start() {
    NC.state = newState();
    const saved = NC.save.restore();
    for (const m of NC._mods) m.init && m.init(NC.state);
    if (saved && saved.v === 1) {
      const p0 = NC.state.players[0];
      p0.money = saved.gs.money[0] || 0;
      NC.state.day = saved.gs.day || 1;
      NC.state.timeMin = saved.gs.timeMin;
      for (const m of NC._mods)
        if (m.deserialize && saved.mods && saved.mods[m._name])
          try { m.deserialize(saved.mods[m._name]); } catch (e) {}
      NC.toast("Save restored", 1600);
    }
    if (AS === "zuza" || qs.get("duo") === "1") addZuza();
    for (const m of NC._mods) m.start && m.start(NC.state);
    NC.save.wire();
    if (NC.net) NC.net.connect && NC.net.connect(AS);
  }

  // ---------- camera ----------
  function camUpdate(dt) {
    const s = NC.state, cam = s.cam;
    let tx, ty;
    const me = NC.me();
    if (s.players.length > 1 && !s.playSolo) {
      const [a, b] = s.players;
      tx = (a.x + b.x) / 2; ty = (a.y + b.y) / 2;
      const spread = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
      cam.zoom = U.clamp(1.15 - spread / 1600, 0.62, 1.15);
    } else {
      tx = me.x; ty = me.y;
      const inCar = me.inCar;
      cam.zoom = U.lerp(cam.zoom, inCar ? 0.85 : 1.05, dt * 2);
      // lookahead toward move dir
      if (inCar) { tx += Math.cos(inCar.angle) * 60; ty += Math.sin(inCar.angle) * 60; }
      else { tx += Math.cos(me.angle) * 20; ty += Math.sin(me.angle) * 20; }
    }
    cam.x = U.lerp(cam.x, tx - (NC.vw / 2) / cam.zoom, Math.min(1, dt * 5));
    cam.y = U.lerp(cam.y, ty - (NC.vh / 2) / cam.zoom, Math.min(1, dt * 5));
    cam.x = U.clamp(cam.x, 0, NC.world.W - NC.vw / cam.zoom);
    cam.y = U.clamp(cam.y, 0, NC.world.H - NC.vh / cam.zoom);
  }

  // ---------- draw ----------
  function draw() {
    const s = NC.state, ctx = NC.ctx, cam = s.cam;
    ctx.save();
    ctx.scale(cam.zoom, cam.zoom);
    // screen shake
    if (NC.shakeAmt > 0.4) {
      ctx.translate(U.rand(-NC.shakeAmt, NC.shakeAmt), U.rand(-NC.shakeAmt, NC.shakeAmt));
    }
    ctx.translate(-cam.x, -cam.y);
    // vignette handled screen-space later
    for (const m of NC._mods) m.drawUnder && m.drawUnder(ctx, cam, s);
    const draws = [];
    for (const m of NC._mods) m.collectDraws && m.collectDraws(draws, cam.x, cam.y, s);
    draws.sort((a, b) => a.y - b.y);
    for (const d of draws) d.fn(ctx);
    for (const m of NC._mods) m.drawOver && m.drawOver(ctx, cam, s);
    ctx.restore();
    // darkness overlay for night vibe
    ctx.fillStyle = "rgba(8,8,20,0.30)";
    ctx.fillRect(0, 0, NC.vw, NC.vh);
    // light halo around players
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const p of s.players) {
      const sx = (p.x - cam.x) * cam.zoom, sy = (p.y - cam.y) * cam.zoom;
      const g = ctx.createRadialGradient(sx, sy, 8, sx, sy, 150 * cam.zoom);
      g.addColorStop(0, "rgba(60,90,140,0.35)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(sx, sy, 150 * cam.zoom, 0, 7); ctx.fill();
    }
    ctx.restore();
    // HUD modules
    for (const m of NC._mods) m.drawHUD && m.drawHUD(ctx, s);
    // toasts
    drawToasts(ctx);
    // vignette
    const vg = ctx.createRadialGradient(NC.vw / 2, NC.vh / 2, NC.vh * 0.35, NC.vw / 2, NC.vh / 2, NC.vh * 0.85);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.45)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, NC.vw, NC.vh);
  }

  function drawToasts(ctx) {
    const now = performance.now();
    NC.toastQueue = NC.toastQueue.filter((t) => t.until > now);
    ctx.textAlign = "center";
    NC.toastQueue.forEach((t, i) => {
      const a = Math.min(1, (t.until - now) / 400);
      ctx.globalAlpha = a;
      ctx.fillStyle = "rgba(10,10,22,0.85)";
      const w = ctx.measureText(t.msg).width + 28;
      const y = 74 + i * 30;
      ctx.fillRect(NC.vw / 2 - w / 2 - 8, y - 16, w + 16, 24);
      ctx.strokeStyle = "#22d3ee55"; ctx.strokeRect(NC.vw / 2 - w / 2 - 8, y - 16, w + 16, 24);
      ctx.fillStyle = "#e2e8f0";
      ctx.font = "bold 13px monospace";
      ctx.fillText(t.msg, NC.vw / 2, y);
      ctx.globalAlpha = 1;
    });
  }

  // ---------- loop ----------
  let last = 0;
  function loop(t) {
    const dt = Math.min(0.05, (t - last) / 1000 || 0.016);
    last = t;
    const s = NC.state;
    if (s && s.running) {
      NC.input.pollKeys();
      NC.shakeAmt = Math.max(0, NC.shakeAmt - dt * 30);
      s.timeMin += dt * 4; // 1 game min ~15s real
      for (const m of NC._mods) m.update && m.update(dt, s);
      camUpdate(dt);
      NC.input.aEdge = NC.input.bEdge = NC.input.cEdge = false; // consume edges
      draw();
    }
    requestAnimationFrame(loop);
  }

  // ---------- boot ----------
  function boot() {
    NC.setupCanvas();
    const startEl = document.getElementById("start");
    if (AUTOSTART) {
      startEl.style.display = "none";
      document.getElementById("gameui").style.display = "block";
      start();
    } else {
      document.getElementById("btn-start").addEventListener("click", () => {
        startEl.style.display = "none";
        document.getElementById("gameui").style.display = "block";
        start();
      });
    }
    requestAnimationFrame(loop);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
