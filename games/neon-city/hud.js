/* NEON CITY — hud: screen-space HUD + big overlays (WASTED/BUSTED), kill feed. */
(function () {
  const NC = window.NC;
  const U = NC.util;

  const CYAN = "#22d3ee", PINK = "#ff2d95", GOLD = "#facc15", GREEN = "#34d399";
  const FEED_MS = 4500, OV_MS = 2200;

  let feedItems = [];        // {msg, until}
  let overlay = null;        // {kind, t0, until, loss}

  function feed(msg) {
    feedItems.push({ msg, until: performance.now() + FEED_MS });
    while (feedItems.length > 3) feedItems.shift();
  }

  const isGuest = () => NC.net && NC.net.isGuest && NC.net.isGuest();

  function wasted(p) {
    if (!p._respawnT) feed(p.char + " — WASTED");
    overlay = { kind: "wasted", t0: performance.now(), until: performance.now() + OV_MS, loss: p.money - Math.floor(p.money * 0.9) };
    if (isGuest()) return;
    if (p._respawnT) return;
    p.dead = true;
    NC.shake(9);
    p._respawnT = setTimeout(() => {
      p._respawnT = null;
      p.money = Math.floor(p.money * 0.9);
      NC.player.spawnPlayer(p);
    }, OV_MS);
  }

  function busted(p) {
    if (!p._respawnT) feed(p.char + " — BUSTED");
    overlay = { kind: "busted", t0: performance.now(), until: performance.now() + OV_MS, loss: Math.min(Math.floor(p.money * 0.2), 200) };
    if (isGuest()) return;
    if (p._respawnT) return;
    p.busted = true; // spawnPlayer reads this to pick the police station
    NC.shake(6);
    p._respawnT = setTimeout(() => {
      p._respawnT = null;
      p.money = Math.max(0, p.money - Math.min(Math.floor(p.money * 0.2), 200));
      p.weapon = "fist"; p.weapons = { fist: true };
      NC.player.spawnPlayer(p);
    }, OV_MS);
  }

  // ---------- little canvas helpers ----------
  function rrect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function star(ctx, x, y, r, col) {
    ctx.fillStyle = col;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 === 0 ? r : r * 0.42;
      const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }
  function panel(ctx, x, y, w, h) {
    rrect(ctx, x, y, w, h, 6);
    ctx.fillStyle = "rgba(8,10,20,0.72)";
    ctx.fill();
    ctx.strokeStyle = "rgba(34,211,238,0.35)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // ---------- pieces ----------
  function drawCard(ctx, me) {
    const x = 12, y = 12, w = 152, h = 68;
    panel(ctx, x, y, w, h);
    ctx.textAlign = "left";
    // money
    ctx.font = "bold 15px monospace";
    ctx.fillStyle = GREEN;
    ctx.fillText("$" + (me.money || 0).toLocaleString("en-US"), x + 9, y + 18);
    // hp bar
    const bw = 134, bh = 7, bx = x + 9, by = y + 25;
    ctx.fillStyle = "#5b1220";
    ctx.fillRect(bx, by, bw, bh);
    const frac = U.clamp((me.hp || 0) / (me.maxHp || 100), 0, 1);
    ctx.fillStyle = frac > 0.3 ? GREEN : "#f87171";
    ctx.fillRect(bx, by, bw * frac, bh);
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
    // weapon
    ctx.font = "bold 10px monospace";
    ctx.fillStyle = "#e2e8f0";
    const wtxt = me.weapon === "fist" ? "FISTS" : me.weapon.toUpperCase() + " " + ((me.ammo && me.ammo[me.weapon]) || 0);
    ctx.fillText(wtxt, x + 9, y + 45);
    ctx.fillStyle = "#64748b";
    ctx.textAlign = "right";
    ctx.fillText(Math.ceil(me.hp) + "/" + me.maxHp, x + w - 9, y + 45);
    ctx.textAlign = "left";
    // stars — flash at 6Hz while any cop is alive
    const copsAlive = NC.people && NC.people.cops && NC.people.cops.some((c) => !c.dead);
    const flash = !copsAlive || Math.floor(performance.now() / 1000 * 6) % 2 === 0;
    ctx.globalAlpha = flash ? 1 : 0.35;
    for (let i = 0; i < 6; i++) {
      const filled = i < (me.stars || 0);
      star(ctx, x + 16 + i * 15, y + 58, 6, filled ? GOLD : "rgba(250,204,21,0.22)");
    }
    ctx.globalAlpha = 1;
    return h;
  }

  function drawMinimap(ctx, state) {
    const mw = 110;
    ctx.save();
    ctx.translate(NC.vw - mw - 12, 12);
    const { mw: w, mh: h } = NC.world.minimap(ctx);
    ctx.strokeStyle = "rgba(34,211,238,0.45)";
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
    const sx = w / NC.world.W, sy = h / NC.world.H;
    // landmarks
    ctx.font = "bold 9px monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = "#ff5d5d";
    ctx.fillText("H", NC.world.hospital.x * sx, NC.world.hospital.y * sy + 3);
    ctx.fillStyle = "#60a5fa";
    ctx.fillText("P", NC.world.policeStation.x * sx, NC.world.policeStation.y * sy + 3);
    // mission markers
    if (NC.missions && NC.missions.markers) {
      ctx.fillStyle = GOLD;
      for (const m of NC.missions.markers()) {
        ctx.beginPath(); ctx.arc(m.x * sx, m.y * sy, 2.5, 0, 7); ctx.fill();
      }
    }
    // cops
    if (NC.people && NC.people.cops) {
      ctx.fillStyle = "#60a5fa";
      for (const c of NC.people.cops) {
        if (c.dead) continue;
        ctx.beginPath(); ctx.arc(c.x * sx, c.y * sy, 2, 0, 7); ctx.fill();
      }
    }
    // players — koto cyan, zuza magenta
    for (const p of state.players) {
      ctx.fillStyle = p.char === "koto" ? CYAN : PINK;
      ctx.beginPath(); ctx.arc(p.x * sx, p.y * sy, 3, 0, 7); ctx.fill();
      if (p === NC.me()) {
        ctx.strokeStyle = "#fff";
        ctx.beginPath(); ctx.arc(p.x * sx, p.y * sy, 4.5, 0, 7); ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawObjective(ctx) {
    if (!NC.missions || !NC.missions.current) return;
    const txt = NC.missions.current();
    if (!txt) return;
    ctx.font = "bold 11px monospace";
    ctx.textAlign = "center";
    const tw = ctx.measureText(txt).width + 22;
    panel(ctx, NC.vw / 2 - tw / 2, 12, tw, 20);
    ctx.fillStyle = GOLD;
    ctx.fillText(txt, NC.vw / 2, 26);
  }

  function drawAPrompt(ctx, state) {
    const me = NC.me();
    if (!me || me.dead || me.busted) return;
    let label = null;
    if (me.inCar) {
      label = "Exit car";
    } else {
      let best = null, bd = 1e9;
      for (const m of NC._mods) {
        if (!m.interactables) continue;
        for (const it of m.interactables(state) || []) {
          const d = U.dist(me.x, me.y, it.x, it.y);
          if (d < (it.r || 40) && d < bd) { bd = d; best = it.label; }
        }
      }
      if (best) label = best;
      else if (NC.cars && NC.cars.nearestCar && NC.cars.nearestCar(me.x, me.y, 36)) label = "Enter car";
    }
    if (!label) return;
    ctx.font = "bold 13px monospace";
    const tw = ctx.measureText(label).width;
    const bw = tw + 46, bh = 30, bx = NC.vw / 2 - bw / 2, by = NC.vh - 108;
    panel(ctx, bx, by, bw, bh);
    // circled A
    ctx.fillStyle = CYAN;
    ctx.beginPath(); ctx.arc(bx + 17, by + bh / 2, 9, 0, 7); ctx.fill();
    ctx.fillStyle = "#06070d";
    ctx.textAlign = "center";
    ctx.fillText("A", bx + 17, by + bh / 2 + 4);
    ctx.fillStyle = "#e2e8f0";
    ctx.textAlign = "left";
    ctx.fillText(label, bx + 32, by + bh / 2 + 4);
  }

  function drawFeed(ctx) {
    const now = performance.now();
    feedItems = feedItems.filter((f) => f.until > now);
    ctx.font = "bold 10px monospace";
    ctx.textAlign = "left";
    feedItems.forEach((f, i) => {
      const a = Math.min(1, (f.until - now) / 600);
      const y = NC.vh - 132 - (feedItems.length - 1 - i) * 15;
      ctx.globalAlpha = a * 0.9;
      ctx.fillStyle = "#94a3b8";
      ctx.fillText(f.msg, 14, y);
    });
    ctx.globalAlpha = 1;
  }

  function drawOverlay(ctx) {
    if (!overlay) return;
    const now = performance.now();
    if (now > overlay.until) { overlay = null; return; }
    const left = overlay.until - now;
    const a = Math.min(1, left / 800); // fade in last 0.8s
    const col = overlay.kind === "wasted" ? "#ef2d3e" : "#60a5fa";
    ctx.globalAlpha = 0.5 * a;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, NC.vw, NC.vh);
    ctx.globalAlpha = a;
    ctx.save();
    ctx.shadowColor = col;
    ctx.shadowBlur = 18;
    ctx.fillStyle = col;
    ctx.textAlign = "center";
    // pixel-blocky big title
    const fs = Math.min(64, Math.floor(NC.vw / 9));
    ctx.font = "900 " + fs + "px monospace";
    ctx.fillText(overlay.kind === "wasted" ? "WASTED" : "BUSTED", NC.vw / 2, NC.vh / 2);
    ctx.restore();
    if (overlay.loss > 0) {
      ctx.globalAlpha = a;
      ctx.fillStyle = "#e2e8f0";
      ctx.font = "bold 14px monospace";
      ctx.textAlign = "center";
      ctx.fillText("-$" + overlay.loss, NC.vw / 2, NC.vh / 2 + fs * 0.7);
    }
    ctx.globalAlpha = 1;
  }

  function drawHUD(ctx, state) {
    const me = NC.me();
    ctx.save();
    if (me) drawCard(ctx, me);
    drawMinimap(ctx, state);
    drawObjective(ctx);
    drawAPrompt(ctx, state);
    drawFeed(ctx);
    drawOverlay(ctx);
    ctx.restore();
  }

  NC.hud = {
    // module hooks
    init() {},
    start() { NC.toast("Find a car — walk up and press A", 3000); },
    update() {},
    drawHUD,
    interactables() { return []; },
    serialize() { return null; },
    deserialize() {},
    // public API (spec: NC.hud.toast/wasted/busted/shake + feed)
    toast: (msg, ms) => NC.toast(msg, ms),
    shake: (a) => NC.shake(a),
    wasted, busted, feed,
  };
  NC.register("hud", NC.hud);
})();
