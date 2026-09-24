/* NEON CITY — sprites: cyberpunk anime koto & zuza + cars + peds, pixel style. */
(function () {
  const NC = window.NC;

  // 12x16 pixel chars drawn scaled 2x => 24x32. Palette per char.
  // koto: black bowl-cut w/ cyan streak, black techwear, silver chain, holo-watch
  // zuza: very long dark-brown hair w/ magenta highlights, sunglasses, black outfit
  const PAL = {
    koto: { hair: "#16181d", hi: "#22d3ee", jacket: "#0f1116", trim: "#22d3ee", skin: "#f0c8a0", legs: "#14161c", acc: "#c0c8d8" },
    zuza: { hair: "#2b1b12", hi: "#ff2d95", jacket: "#121019", trim: "#a855f7", skin: "#f0c8a0", legs: "#131118", acc: "#ff2d95" },
    ped: { hair: "#3b3f4a", hi: "#facc15", jacket: "#2a2f3a", trim: "#64748b", skin: "#e8b98c", legs: "#232733", acc: "#facc15" },
    cop: { hair: "#1e293b", hi: "#60a5fa", jacket: "#1d2d50", trim: "#60a5fa", skin: "#e8b98c", legs: "#16203a", acc: "#ef4444" },
    thug: { hair: "#431407", hi: "#f97316", jacket: "#3a1d0d", trim: "#f97316", skin: "#d9a878", legs: "#291405", acc: "#f97316" },
  };

  // dir: "down"|"up"|"left"|"right"; step 0..1 for leg anim; inCar hides legs
  function drawChar(ctx, x, y, char, dir, step = 0, opts = {}) {
    const p = PAL[char] || PAL.ped;
    const s = 2; // scale
    const bob = step ? Math.sin(step * Math.PI * 2) * 1.2 : 0;
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y + bob));
    // shadow
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath(); ctx.ellipse(0, 15 * s, 8 * s, 3 * s, 0, 0, 7); ctx.fill();
    const px = (u, v, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(u * s, v * s, w * s, h * s); };
    // legs
    if (!opts.inCar) {
      const lOff = step ? Math.sin(step * Math.PI * 2) * 2 : 0;
      px(-4, 10 + lOff * 0.5, 3, 5, p.legs);
      px(1, 10 - lOff * 0.5, 3, 5, p.legs);
      px(-4, 15 + lOff * 0.5, 3, 1, "#05060a");
      px(1, 15 - lOff * 0.5, 3, 1, "#05060a");
    } else {
      px(-4, 12, 8, 3, p.legs);
    }
    // jacket/body
    px(-5, 2, 10, 9, p.jacket);
    px(-5, 2, 10, 1, p.trim);          // neon collar trim
    px(-5, 10, 10, 1, p.trim);         // hem
    // arms
    px(-7, 3 + (step ? Math.sin(step * 6.28) : 0), 2, 6, p.jacket);
    px(5, 3 - (step ? Math.sin(step * 6.28) : 0), 2, 6, p.jacket);
    if (char === "koto") {
      px(4, 8, 2, 2, p.acc);           // holo-watch glow
    }
    if (opts.weapon && opts.weapon !== "fist") {
      ctx.fillStyle = "#0a0c10";
      ctx.fillRect(4 * s, 5 * s, 6 * s, 2 * s);
    }
    // chain for koto
    if (char === "koto") { px(-2, 4, 4, 2, p.acc); }
    // head
    px(-4, -6, 8, 8, p.skin);
    // hair styles
    if (char === "zuza") {
      px(-5, -7, 10, 3, p.hair);          // top
      px(-5, -4, 2, 12, p.hair);          // left fall
      px(3, -4, 2, 12, p.hair);           // right fall
      px(-5, 7, 10, 8, p.hair);           // long back (drawn over jacket)
      px(-5, 7, 10, 1, p.hi);             // neon hair tip
      px(-5, -4, 2, 3, p.hi);             // magenta streaks
      px(3, -4, 2, 3, p.hi);
      // sunglasses
      px(-3, -3, 6, 2, "#05070a");
      px(-3, -3, 6, 1, p.acc);
    } else if (char === "koto") {
      px(-4, -7, 8, 3, p.hair);           // bowl cut top
      px(-5, -5, 10, 3, p.hair);          // bowl sides
      px(-5, -6, 2, 2, p.hi);             // cyan streak
      // eyes
      px(-2, -2, 1, 2, "#101014");
      px(1, -2, 1, 2, "#101014");
    } else {
      px(-4, -7, 8, 3, p.hair);
      px(-2, -2, 1, 2, "#101014");
      px(1, -2, 1, 2, "#101014");
      if (char === "cop") px(-4, -8, 8, 2, p.trim); // cap brim
    }
    // facing indicator (simple eye/face flip skipped; gun shows direction)
    if (dir === "left" || dir === "right") {
      const sx = dir === "left" ? -1 : 1;
      ctx.fillStyle = p.skin;
      ctx.fillRect(sx * 4 * s - s, -2 * s, 2 * s, 2 * s);
    }
    // name tag
    if (opts.name) {
      ctx.fillStyle = opts.nameCol || "#fff";
      ctx.font = "bold 8px monospace";
      ctx.textAlign = "center";
      ctx.fillText(opts.name, 0, -10 * s);
    }
    ctx.restore();
  }

  const CARS = {
    civic:  { w: 34, h: 18, top: 220, cols: ["#f43f5e", "#22d3ee", "#facc15", "#e2e8f0", "#a855f7"] },
    sport:  { w: 38, h: 18, top: 300, cols: ["#f97316", "#ff2d95", "#22d3ee"] },
    taxi:   { w: 34, h: 18, top: 200, cols: ["#facc15"] },
    van:    { w: 40, h: 20, top: 170, cols: ["#64748b", "#94a3b8"] },
    police: { w: 36, h: 18, top: 270, cols: ["#1e3a8a"] },
  };

  function drawCar(ctx, x, y, angle, type, color, opts = {}) {
    const def = CARS[type] || CARS.civic;
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    ctx.rotate(angle);
    const w = def.w, h = def.h;
    // shadow
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.fillRect(-w / 2 - 1, -h / 2 + 2, w + 2, h);
    // body
    ctx.fillStyle = opts.dead ? "#1a1a1a" : color;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    // neon underglow
    ctx.fillStyle = opts.dead ? "#000" : (opts.glow || "#22d3ee");
    ctx.globalAlpha = 0.55;
    ctx.fillRect(-w / 2, h / 2 - 2, w, 2);
    ctx.globalAlpha = 1;
    // cabin
    ctx.fillStyle = "rgba(8,10,16,0.9)";
    ctx.fillRect(-w / 5, -h / 2 + 3, w / 2.6, h - 6);
    // windshield glint
    ctx.fillStyle = "rgba(120,200,255,0.5)";
    ctx.fillRect(w / 8, -h / 2 + 4, 3, h - 8);
    // wheels
    ctx.fillStyle = "#05060a";
    ctx.fillRect(-w / 2 + 3, -h / 2 - 2, 6, 3);
    ctx.fillRect(w / 2 - 9, -h / 2 - 2, 6, 3);
    ctx.fillRect(-w / 2 + 3, h / 2 - 1, 6, 3);
    ctx.fillRect(w / 2 - 9, h / 2 - 1, 6, 3);
    // headlights
    if (!opts.dead) {
      ctx.fillStyle = "#fff7cc";
      ctx.fillRect(w / 2 - 1, -h / 2 + 2, 2, 3);
      ctx.fillRect(w / 2 - 1, h / 2 - 5, 2, 3);
      // headlight cones (subtle)
      ctx.fillStyle = "rgba(255,247,204,0.08)";
      ctx.beginPath();
      ctx.moveTo(w / 2, -h / 2 + 2); ctx.lineTo(w / 2 + 34, -h / 2 - 10); ctx.lineTo(w / 2 + 34, -h / 2 + 8);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(w / 2, h / 2 - 2); ctx.lineTo(w / 2 + 34, h / 2 + 10); ctx.lineTo(w / 2 + 34, h / 2 - 8);
      ctx.fill();
      // taillights
      ctx.fillStyle = "#ff3b3b";
      ctx.fillRect(-w / 2 - 1, -h / 2 + 2, 2, 3);
      ctx.fillRect(-w / 2 - 1, h / 2 - 5, 2, 3);
    }
    if (type === "police") {
      const t = performance.now() / 160;
      ctx.fillStyle = Math.floor(t) % 2 ? "#ff3b3b" : "#60a5fa";
      ctx.fillRect(-4, -h / 2 - 3, 8, 3);
    }
    if (opts.siren) {
      const t = performance.now() / 120;
      ctx.fillStyle = Math.floor(t) % 2 ? "#ff3b3b" : "#22d3ee";
      ctx.globalAlpha = 0.25;
      ctx.beginPath(); ctx.arc(0, 0, 40, 0, 7); ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function drawBullet(ctx, x, y) {
    ctx.fillStyle = "#ffe9a0";
    ctx.beginPath(); ctx.arc(x, y, 2, 0, 7); ctx.fill();
  }
  function drawMoney(ctx, x, y, t) {
    const b = Math.sin(t * 4) * 2;
    ctx.fillStyle = "#34d399";
    ctx.fillRect(x - 5, y - 3 + b, 10, 6);
    ctx.fillStyle = "#0b3d26";
    ctx.font = "bold 7px monospace"; ctx.textAlign = "center";
    ctx.fillText("$", x, y + 2 + b);
  }
  function drawMarker(ctx, x, y, col, t) {
    const r = 18 + Math.sin(t * 3) * 4;
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = col; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.stroke();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.moveTo(x, y - 34); ctx.lineTo(x + 6, y - 24); ctx.lineTo(x - 6, y - 24); ctx.fill();
    ctx.restore();
  }

  NC.sprites = { drawChar, drawCar, drawBullet, drawMoney, drawMarker, PAL, CARS };
})();
