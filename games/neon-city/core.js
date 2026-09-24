/* NEON CITY — core: module bus, state, input, camera, save. */
(function () {
  const NC = (window.NC = {
    _mods: [],
    register(name, mod) {
      mod._name = name;
      NC[name] = mod;
      NC._mods.push(mod);
    },
    state: null,
    input: {
      joy: { x: 0, y: 0, mag: 0, active: false, id: null, ox: 0, oy: 0 },
      a: false, b: false, c: false,
      aEdge: false, cEdge: false, bEdge: false,
    },
    canvas: null, ctx: null,
    util: {
      clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
      lerp: (a, b, t) => a + (b - a) * t,
      dist: (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1),
      angTo: (x1, y1, x2, y2) => Math.atan2(y2 - y1, x2 - x1),
      rand: (a, b) => a + Math.random() * (b - a),
      randi: (a, b) => Math.floor(a + Math.random() * (b - a + 1)),
      pick: (arr) => arr[Math.floor(Math.random() * arr.length)],
      wrap: (a, n) => ((a % n) + n) % n,
    },
    toastQueue: [],
    toast(msg, ms = 2200) {
      NC.toastQueue.push({ msg, until: performance.now() + ms });
      if (NC.toastQueue.length > 4) NC.toastQueue.shift();
    },
    shakeAmt: 0,
    shake(amt) { NC.shakeAmt = Math.max(NC.shakeAmt, amt); },
    save: {
      KEY: "neoncity-save",
      now() {
        if (!NC.state || !NC.state.running) return;
        const mods = {};
        for (const m of NC._mods)
          if (m.serialize) { try { mods[m._name] = m.serialize(); } catch (e) {} }
        const s = NC.state;
        const blob = {
          v: 1, savedAt: Date.now(),
          gs: { money: s.players.map((p) => p.money), day: s.day, timeMin: s.timeMin },
          mods,
        };
        try { localStorage.setItem(this.KEY, JSON.stringify(blob)); } catch (e) {}
      },
      restore() {
        try { return JSON.parse(localStorage.getItem(this.KEY) || "null"); } catch (e) { return null; }
      },
      clear() { try { localStorage.removeItem(this.KEY); } catch (e) {} },
      _t: null,
      wire() {
        if (this._t) return;
        this._t = setInterval(() => this.now(), 15000);
        document.addEventListener("visibilitychange", () => { if (document.hidden) this.now(); });
        window.addEventListener("beforeunload", () => this.now());
      },
    },
  });

  // ---------- canvas + input ----------
  NC.setupCanvas = function () {
    const cv = (NC.canvas = document.getElementById("game"));
    NC.ctx = cv.getContext("2d");
    const fit = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.floor(window.innerWidth * dpr);
      cv.height = Math.floor(window.innerHeight * dpr);
      cv.style.width = window.innerWidth + "px";
      cv.style.height = window.innerHeight + "px";
      NC.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      NC.vw = window.innerWidth;
      NC.vh = window.innerHeight;
    };
    fit();
    window.addEventListener("resize", fit);
    window.addEventListener("orientationchange", () => setTimeout(fit, 60));

    const joy = NC.input.joy;
    const onDown = (e) => {
      for (const t of e.changedTouches) {
        const x = t.clientX, y = t.clientY;
        if (x < NC.vw * 0.5 && joy.id === null) {
          joy.id = t.identifier;
          joy.ox = x; joy.oy = y; joy.x = 0; joy.y = 0; joy.mag = 0; joy.active = true;
          const jr = document.getElementById("joy-ring");
          if (jr) { jr.style.left = x - 44 + "px"; jr.style.top = y - 44 + "px"; jr.style.opacity = "1"; }
          const knob = document.getElementById("joy-knob");
          if (knob) { knob.style.left = x - 20 + "px"; knob.style.top = y - 20 + "px"; knob.style.opacity = "1"; }
        }
      }
    };
    const onMove = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === joy.id) {
          let dx = t.clientX - joy.ox, dy = t.clientY - joy.oy;
          const d = Math.hypot(dx, dy), max = 52;
          if (d > max) { dx = (dx / d) * max; dy = (dy / d) * max; }
          joy.x = dx / max; joy.y = dy / max; joy.mag = Math.min(1, d / max);
          const knob = document.getElementById("joy-knob");
          if (knob) { knob.style.left = t.clientX - 20 + "px"; knob.style.top = t.clientY - 20 + "px"; }
          e.preventDefault();
        }
      }
    };
    const onUp = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === joy.id) {
          joy.id = null; joy.x = 0; joy.y = 0; joy.mag = 0; joy.active = false;
          const jr = document.getElementById("joy-ring");
          if (jr) jr.style.opacity = "0.35";
          const knob = document.getElementById("joy-knob");
          if (knob) knob.style.opacity = "0.35";
        }
      }
    };
    cv.addEventListener("touchstart", onDown, { passive: false });
    cv.addEventListener("touchmove", onMove, { passive: false });
    cv.addEventListener("touchend", onUp);
    cv.addEventListener("touchcancel", onUp);
    // buttons are real DOM so iOS taps always land
    const bindBtn = (id, prop, edge) => {
      const el = document.getElementById(id);
      if (!el) return;
      const d = (e) => { e.preventDefault(); NC.input[prop] = true; if (edge) NC.input[edge] = true; };
      const u = (e) => { e.preventDefault(); NC.input[prop] = false; };
      el.addEventListener("touchstart", d, { passive: false });
      el.addEventListener("touchend", u, { passive: false });
      el.addEventListener("touchcancel", u, { passive: false });
      el.addEventListener("mousedown", d);
      el.addEventListener("mouseup", u);
    };
    bindBtn("btn-a", "a", "aEdge");
    bindBtn("btn-b", "b", "bEdge");
    bindBtn("btn-c", "c", "cEdge");
    // keyboard fallback (desktop testing)
    const keys = {};
    window.addEventListener("keydown", (e) => {
      keys[e.key.toLowerCase()] = true;
      if (e.key === "e" || e.key === "Enter") { NC.input.a = true; NC.input.aEdge = true; }
      if (e.key === " ") { NC.input.b = true; NC.input.bEdge = true; e.preventDefault(); }
      if (e.key === "q" || e.key === "Tab") { NC.input.c = true; NC.input.cEdge = true; e.preventDefault(); }
    });
    window.addEventListener("keyup", (e) => {
      keys[e.key.toLowerCase()] = false;
      if (e.key === "e" || e.key === "Enter") NC.input.a = false;
      if (e.key === " ") NC.input.b = false;
      if (e.key === "q" || e.key === "Tab") NC.input.c = false;
    });
    NC.input.keys = keys;
    NC.input.pollKeys = () => {
      const k = keys;
      const jx = (k["d"] || k["arrowright"] ? 1 : 0) - (k["a"] || k["arrowleft"] ? 1 : 0);
      const jy = (k["s"] || k["arrowdown"] ? 1 : 0) - (k["w"] || k["arrowup"] ? 1 : 0);
      if (jx || jy) {
        const m = Math.hypot(jx, jy);
        joy.x = jx / m; joy.y = jy / m; joy.mag = 1; joy.active = true;
      } else if (!joy.id) { joy.x = 0; joy.y = 0; joy.mag = 0; joy.active = false; }
    };
    // block iOS gestures
    document.addEventListener("gesturestart", (e) => e.preventDefault());
    document.addEventListener("dblclick", (e) => e.preventDefault());
  };
})();
