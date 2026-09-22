/* dream-home furniture module — catalog shop, placement mode, interactions, render.
   Contract with game.js:
     DH.furniture.init(state)         – called once at load
     DH.furniture.start(state)        – called when a run starts
     DH.furniture.update(dt, state)   – per frame (sim)
     DH.furniture.interactables(p)    – -> [{label,x,y,action}] for the action key
     DH.furniture.collectDraws(draws, camX, camY) – push {y, fn} for depth-sorted render
     DH.furniture.drawOverlay(ctx, camX, camY, state) – optional topmost draw
   Placed furniture adds its tiles to DH.world.blocked ("x,y") and contributes to
   state.happiness. Buying costs state.coins via DH.toast feedback.

   Net-sync boundary (for future online play): all gameplay state is plain JSON
   (M.items = [{uid,id,x0,y0,lit,cd}]). Mutations go through named functions:
     DH.furniture.place(id, tx, ty)   – validate + buy + place (shared coins)
     DH.furniture.remove(tx, ty)      – sell/remove item covering tile
     DH.furniture.use(tx, ty)         – trigger item interaction (sit, sleep, ...)
     DH.furniture.serialize()         -> plain data snapshot
     DH.furniture.deserialize(data)   – restore module state
     DH.furniture.remoteAction(name, args) – apply a guest-initiated action
   Draw closures/particles/DOM are view-layer only and never live inside state.
*/
(function () {
  const DH = (window.DH = window.DH || {});
  const T = 32;
  const R = (ctx, x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };

  // ---------- furniture catalog ----------
  // def: {id, name, ico, cost, w(tiles), happy(place bonus), walkable,
  //       use:{label,happy,fx,msg,morning}, draw(ctx,x,y,it)}
  const CATALOG = [
    { id: "plant", name: "Potted Plant", ico: "🪴", cost: 15, w: 1, happy: 1,
      use: { label: "Water", happy: 1, fx: "drop", msg: "The plant perks up!" },
      draw(ctx, x, y) {
        R(ctx, x + 9, y + 19, 14, 9, "#b4552f"); R(ctx, x + 8, y + 16, 16, 4, "#8f3f22");
        ctx.fillStyle = "#3f9e4d";
        ctx.beginPath(); ctx.ellipse(x + 16, y + 11, 7, 9, 0, 0, 7); ctx.fill();
        ctx.fillStyle = "#57b868";
        ctx.beginPath(); ctx.ellipse(x + 11, y + 13, 4, 6, -0.5, 0, 7); ctx.fill();
        ctx.beginPath(); ctx.ellipse(x + 21, y + 13, 4, 6, 0.5, 0, 7); ctx.fill();
      } },
    { id: "chair", name: "Chair", ico: "🪑", cost: 20, w: 1, happy: 2,
      use: { label: "Sit a while", happy: 1, fx: "heart", msg: "Comfy break!" },
      draw(ctx, x, y) {
        R(ctx, x + 9, y + 4, 14, 12, "#8a5a3b"); R(ctx, x + 11, y + 6, 10, 8, "#a06a42");
        R(ctx, x + 7, y + 16, 18, 5, "#a06a42");
        R(ctx, x + 8, y + 21, 3, 8, "#6f4327"); R(ctx, x + 21, y + 21, 3, 8, "#6f4327");
      } },
    { id: "lamp", name: "Lamp", ico: "💡", cost: 25, w: 1, happy: 2,
      use: { label: "Toggle lamp", happy: 0, fx: "star", msg: "Lamp switched!" },
      draw(ctx, x, y, it) {
        if (it.lit) {
          ctx.fillStyle = "#ffe58a44";
          ctx.beginPath(); ctx.arc(x + 16, y + 10, 17, 0, 7); ctx.fill();
        }
        R(ctx, x + 9, y + 26, 14, 3, "#555c66"); R(ctx, x + 14, y + 12, 4, 15, "#777f8a");
        R(ctx, x + 8, y + 5, 16, 8, it.lit ? "#ffd76b" : "#b8a88a");
        R(ctx, x + 10, y + 3, 12, 3, it.lit ? "#ffe9a0" : "#a3937a");
      } },
    { id: "rug", name: "Cozy Rug", ico: "🟧", cost: 30, w: 2, happy: 2, walkable: true,
      draw(ctx, x, y) {
        R(ctx, x + 2, y + 9, 60, 15, "#b44a5a"); R(ctx, x + 4, y + 11, 56, 11, "#d4707e");
        R(ctx, x + 8, y + 13, 48, 3, "#e8a0aa"); R(ctx, x + 8, y + 17, 48, 3, "#e8a0aa");
        R(ctx, x + 2, y + 7, 60, 2, "#8e3543"); R(ctx, x + 2, y + 24, 60, 2, "#8e3543");
      } },
    { id: "table", name: "Dining Table", ico: "🍽️", cost: 45, w: 2, happy: 3,
      use: { label: "Set the table", happy: 1, fx: "star", msg: "Dinner is served!" },
      draw(ctx, x, y) {
        R(ctx, x + 2, y + 9, 60, 6, "#a06a42"); R(ctx, x + 2, y + 9, 60, 2, "#c08a52");
        R(ctx, x + 6, y + 15, 4, 12, "#6f4327"); R(ctx, x + 54, y + 15, 4, 12, "#6f4327");
        R(ctx, x + 28, y + 5, 8, 4, "#f4f4f4"); R(ctx, x + 30, y + 3, 4, 2, "#7ec8e3");
      } },
    { id: "bookshelf", name: "Bookshelf", ico: "📚", cost: 55, w: 1, happy: 3,
      use: { label: "Read", happy: 1, fx: "note", msg: "What a story!" },
      draw(ctx, x, y) {
        R(ctx, x + 4, y + 2, 24, 27, "#7a4a2a"); R(ctx, x + 6, y + 4, 20, 23, "#5a3618");
        const cols = ["#d44", "#4a6fd4", "#4da454", "#d4a344", "#9a4dd4"];
        for (let s = 0; s < 3; s++) for (let b = 0; b < 4; b++)
          R(ctx, x + 7 + b * 5, y + 5 + s * 8 + (b % 2), 4, 6, cols[(s + b) % 5]);
      } },
    { id: "sofa", name: "Sofa", ico: "🛋️", cost: 60, w: 2, happy: 4,
      use: { label: "Sit a while", happy: 1, fx: "heart", msg: "So soft!" },
      draw(ctx, x, y) {
        R(ctx, x + 2, y + 6, 60, 10, "#4a6fa5"); R(ctx, x + 2, y + 14, 60, 10, "#5a80b8");
        R(ctx, x + 0, y + 9, 6, 16, "#41608f"); R(ctx, x + 58, y + 9, 6, 16, "#41608f");
        R(ctx, x + 10, y + 10, 20, 8, "#6a90c8"); R(ctx, x + 34, y + 10, 20, 8, "#6a90c8");
        R(ctx, x + 6, y + 24, 4, 5, "#3a3a44"); R(ctx, x + 54, y + 24, 4, 5, "#3a3a44");
      } },
    { id: "wardrobe", name: "Wardrobe", ico: "👗", cost: 70, w: 1, happy: 4,
      use: { label: "Try outfits", happy: 1, fx: "star", msg: "Looking sharp!" },
      draw(ctx, x, y) {
        R(ctx, x + 5, y + 2, 22, 28, "#8a5a3b"); R(ctx, x + 5, y + 2, 22, 3, "#a06a42");
        R(ctx, x + 15, y + 5, 2, 23, "#6f4327");
        R(ctx, x + 12, y + 14, 2, 4, "#e8c860"); R(ctx, x + 18, y + 14, 2, 4, "#e8c860");
      } },
    { id: "bed", name: "Comfy Bed", ico: "🛏️", cost: 80, w: 2, happy: 6,
      use: { label: "Sleep until morning", happy: 3, fx: "zzz", msg: "Sweet dreams!", morning: true },
      draw(ctx, x, y) {
        R(ctx, x + 0, y + 6, 4, 18, "#7a4a2a"); R(ctx, x + 0, y + 4, 4, 4, "#8a5a3b");
        R(ctx, x + 4, y + 10, 58, 12, "#7a4a2a");
        R(ctx, x + 5, y + 8, 56, 8, "#f4f4f4");
        R(ctx, x + 7, y + 9, 13, 7, "#ffffff"); R(ctx, x + 9, y + 11, 9, 2, "#e0e0e0");
        R(ctx, x + 26, y + 8, 35, 10, "#e0607e"); R(ctx, x + 26, y + 8, 35, 2, "#f0809a");
      } },
    { id: "stove", name: "Stove", ico: "🍳", cost: 85, w: 1, happy: 5,
      use: { label: "Cook a meal", happy: 2, fx: "steam", msg: "Yummy, hot meal!" },
      draw(ctx, x, y) {
        R(ctx, x + 5, y + 11, 22, 18, "#4a4a55"); R(ctx, x + 5, y + 7, 22, 5, "#3a3a44");
        ctx.fillStyle = "#22222a";
        ctx.beginPath(); ctx.arc(x + 11, y + 9, 3, 0, 7); ctx.fill();
        ctx.beginPath(); ctx.arc(x + 21, y + 9, 3, 0, 7); ctx.fill();
        R(ctx, x + 9, y + 17, 14, 8, "#2a2a33"); R(ctx, x + 11, y + 19, 10, 4, "#5a6a7a");
      } },
    { id: "tv", name: "TV Set", ico: "📺", cost: 90, w: 2, happy: 6,
      use: { label: "Watch TV", happy: 1, fx: "note", msg: "What a show!" },
      draw(ctx, x, y) {
        R(ctx, x + 18, y + 24, 28, 5, "#555c66"); R(ctx, x + 14, y + 29, 36, 2, "#3a3f48");
        R(ctx, x + 6, y + 4, 52, 20, "#16161e"); R(ctx, x + 8, y + 6, 48, 16, "#2a3a4a");
        const s = Math.floor(performance.now() / 300) % 3;
        ctx.fillStyle = ["#3ec6ff", "#7ee3ff", "#2a9bd4"][s];
        R(ctx, x + 12 + s * 4, y + 9, 40 - s * 8, 4, ctx.fillStyle);
        R(ctx, x + 30, y + 0, 2, 4, "#888"); R(ctx, x + 28, y + 0, 6, 2, "#888");
      } },
    { id: "fridge", name: "Fridge", ico: "🧊", cost: 95, w: 1, happy: 5,
      use: { label: "Grab a snack", happy: 2, fx: "heart", msg: "Tasty snack!" },
      draw(ctx, x, y) {
        R(ctx, x + 7, y + 2, 18, 28, "#cfd8e3"); R(ctx, x + 7, y + 2, 18, 3, "#e4ebf3");
        R(ctx, x + 7, y + 13, 18, 2, "#9aa5b3");
        R(ctx, x + 9, y + 6, 2, 6, "#8a93a3"); R(ctx, x + 9, y + 16, 2, 8, "#8a93a3");
        R(ctx, x + 19, y + 7, 3, 3, "#e0607e"); R(ctx, x + 21, y + 16, 3, 3, "#4ecdc4");
      } },
    { id: "bathtub", name: "Bathtub", ico: "🛁", cost: 100, w: 2, happy: 7,
      use: { label: "Take a bath", happy: 2, fx: "bubble", msg: "Bubble time!" },
      draw(ctx, x, y) {
        R(ctx, x + 4, y + 22, 6, 5, "#9aa5b3"); R(ctx, x + 54, y + 22, 6, 5, "#9aa5b3");
        R(ctx, x + 2, y + 12, 60, 12, "#e8ecf2"); R(ctx, x + 0, y + 10, 64, 5, "#f4f7fb");
        R(ctx, x + 4, y + 15, 56, 6, "#7ec8e3");
        ctx.fillStyle = "#bfeaff";
        ctx.beginPath(); ctx.arc(x + 18, y + 15, 2.5, 0, 7); ctx.fill();
        ctx.beginPath(); ctx.arc(x + 42, y + 14, 2, 0, 7); ctx.fill();
      } },
    { id: "piano", name: "Piano", ico: "🎹", cost: 150, w: 2, happy: 10,
      use: { label: "Play", happy: 2, fx: "note", msg: "Beautiful music!" },
      draw(ctx, x, y) {
        R(ctx, x + 4, y + 5, 56, 12, "#1c1c22"); R(ctx, x + 4, y + 5, 56, 3, "#2c2c34");
        R(ctx, x + 8, y + 14, 48, 6, "#f4f4f4");
        ctx.fillStyle = "#111";
        for (let i = 0; i < 7; i++) R(ctx, x + 12 + i * 7, y + 14, 3, 4, "#111");
        R(ctx, x + 8, y + 20, 5, 9, "#14141a"); R(ctx, x + 51, y + 20, 5, 9, "#14141a");
      } },
  ];
  const BYID = {}; CATALOG.forEach(d => (BYID[d.id] = d));

  // ---------- module state — plain JSON only ----------
  const M = {
    items: [],        // {uid, id, x0, y0, lit, cd}
    nextUid: 1,
    placing: null,    // {pid, id} local placement mode — never serialized
  };
  let S = null;       // shared DH.state
  let G = null;       // canvas ctx (view layer)

  // view-layer (derived, not serialized)
  const occupied = new Set();  // "tx,ty" covered by any item (incl. walkable)
  const viewCache = new Map(); // item -> {y,fn} draw entry
  const particles = [];        // {x,y,vx,vy,age,ttl,kind}
  const cam = { x: 0, y: 0 };
  let ghost = null;            // {x0,y0,ok}
  let cancelBtn = null;

  // tiles that furniture must never cover (doors, gates, walkways, catalog sign)
  const PROTECTED = new Set(["9,9", "9,8", "9,10", "10,9", "5,10", "5,11", "16,5", "16,6"]);
  const SIGN = { x: 10 * T + 16, y: 9 * T + 16, r: 46 };
  const DIRV = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const USE_CD = 20; // seconds between uses of one item
  const SELL_RATE = 0.5;

  // ---------- helpers ----------
  const key = (tx, ty) => tx + "," + ty;
  function tilesOf(it) { const d = BYID[it.id], a = []; for (let i = 0; i < d.w; i++) a.push(key(it.x0 + i, it.y0)); return a; }
  function findAt(tx, ty) {
    return M.items.find(it => { const d = BYID[it.id]; return ty === it.y0 && tx >= it.x0 && tx < it.x0 + d.w; });
  }
  function usePoint(it) {
    const d = BYID[it.id];
    return { x: (it.x0 + d.w / 2) * T, y: (it.y0 + 0.75) * T, r: d.w > 1 ? 52 : 44 };
  }
  function registerView(it) {
    viewCache.set(it, { y: (it.y0 + 1) * T, fn: () => drawItem(it) });
  }
  function register(it) {
    const d = BYID[it.id];
    tilesOf(it).forEach(k => { occupied.add(k); if (!d.walkable) DH.world.blocked.add(k); });
    registerView(it);
  }
  function unregister(it) {
    const d = BYID[it.id];
    tilesOf(it).forEach(k => { occupied.delete(k); DH.world.blocked.delete(k); });
    viewCache.delete(it);
  }
  function canPlaceAt(x0, y0, d) {
    const W = DH.world;
    for (let i = 0; i < d.w; i++) {
      const tx = x0 + i, ty = y0, z = W.zone(tx, ty);
      if (z !== "house" && z !== "yard") return false;
      if (W.isBlocked(tx, ty) || occupied.has(key(tx, ty)) || PROTECTED.has(key(tx, ty))) return false;
      for (const p of S.players) if (Math.floor(p.x / T) === tx && Math.floor(p.y / T) === ty) return false;
    }
    return true;
  }
  function canGhostPlace() { return ghost && ghost.ok; }

  function spawnFx(it, fx) {
    const d = BYID[it.id], cx = (it.x0 + d.w / 2) * T, cy = it.y0 * T + 4;
    const n = fx === "zzz" ? 3 : 4;
    for (let i = 0; i < n && particles.length < 40; i++) {
      particles.push({
        x: cx + (Math.random() * 24 - 12), y: cy - Math.random() * 6,
        vx: Math.random() * 12 - 6, vy: -18 - Math.random() * 14,
        age: 0, ttl: 1.2 + Math.random() * 0.5, kind: fx,
      });
    }
  }

  // ---------- named mutations (net-safe API) ----------
  function place(id, x0, y0) {
    const d = BYID[id];
    if (!d || !S) return false;
    if (!canPlaceAt(x0, y0, d)) { DH.toast("☹️ Can't place there!"); return false; }
    if (S.coins < d.cost) { DH.toast("☹️ Not enough coins!"); return false; }
    S.coins -= d.cost;
    const it = { uid: M.nextUid++, id, x0, y0, lit: false, cd: 0 };
    M.items.push(it); register(it);
    S.happiness += d.happy;
    spawnFx(it, "star");
    DH.toast(`${d.ico} Placed ${d.name}! +${d.happy} happiness`);
    return true;
  }

  function remove(tx, ty) {
    const it = findAt(tx, ty);
    if (!it) return false;
    const d = BYID[it.id], i = M.items.indexOf(it);
    unregister(it); M.items.splice(i, 1);
    S.happiness = Math.max(0, S.happiness - d.happy);
    const refund = Math.floor(d.cost * SELL_RATE);
    S.coins += refund;
    DH.toast(`💰 Sold ${d.name} (+🪙${refund})`);
    return true;
  }

  function use(tx, ty) {
    const it = findAt(tx, ty);
    if (!it) return false;
    const d = BYID[it.id];
    if (!d.use) { DH.toast(`${d.ico} ${d.name} — just decorative`); return false; }
    if (it.cd > 0) { DH.toast("☹️ Not ready yet — give it a moment"); return false; }
    it.cd = USE_CD;
    if (d.use.morning) S.timeMin = 8 * 60;
    if (d.id === "lamp") it.lit = !it.lit;
    if (d.use.happy) S.happiness += d.use.happy;
    spawnFx(it, d.use.fx);
    DH.toast(d.use.happy ? `${d.ico} ${d.use.msg} +${d.use.happy} happiness` : `${d.ico} ${d.use.msg}`);
    return true;
  }

  function serialize() {
    return { nextUid: M.nextUid, items: M.items.map(it => ({ ...it })) };
  }
  function deserialize(data) {
    clearAll();
    if (data && Array.isArray(data.items)) {
      for (const raw of data.items) {
        const d = BYID[raw.id];
        if (!d) continue;
        const it = { uid: raw.uid != null ? raw.uid : M.nextUid++, id: raw.id, x0: raw.x0 | 0, y0: raw.y0 | 0, lit: !!raw.lit, cd: +raw.cd || 0 };
        M.items.push(it); register(it);
      }
    }
    M.nextUid = Math.max((data && data.nextUid) || 1, M.items.reduce((m, it) => Math.max(m, it.uid + 1), 1));
  }
  function remoteAction(name, args) {
    const a = args || {};
    if (name === "place") return place(a.id, a.x0, a.y0);
    if (name === "remove") return remove(a.tx, a.ty);
    if (name === "use") return use(a.tx, a.ty);
    if (name === "serialize") return serialize();
    return false;
  }

  function clearAll() {
    for (const it of M.items) unregister(it);
    M.items.length = 0; occupied.clear(); particles.length = 0;
    M.placing = null; ghost = null; showCancel(false);
  }

  // ---------- placement mode (local UI) ----------
  function showCancel(on) {
    if (on && !cancelBtn) {
      cancelBtn = document.createElement("button");
      cancelBtn.textContent = "✖ Cancel";
      cancelBtn.style.cssText =
        "position:absolute;top:10px;right:10px;z-index:15;background:#c2434d;border:none;color:#fff;" +
        "padding:8px 14px;border-radius:10px;font-weight:700;cursor:pointer;font-size:14px";
      cancelBtn.addEventListener("click", () => cancelPlacing());
      document.getElementById("stage").appendChild(cancelBtn);
    }
    if (cancelBtn) cancelBtn.classList.toggle("hidden", !on);
  }
  function beginPlacing(d, p) {
    M.placing = { pid: p.pid, id: d.id };
    showCancel(true);
    DH.toast(`${d.ico} ${d.name}: aim ${p.pid === 0 ? "WASD" : "arrows"} · ${p.pid === 0 ? "F" : "Enter"} places · Esc cancels`, 3000);
  }
  function cancelPlacing() {
    M.placing = null; ghost = null; showCancel(false);
    DH.toast("Placement cancelled");
  }
  function confirmPlacing() {
    if (!M.placing) return;
    const d = BYID[M.placing.id];
    if (ghost && place(d.id, ghost.x0, ghost.y0)) {
      M.placing = null; ghost = null; showCancel(false);
    }
  }

  // ---------- menus ----------
  function openShop(p) {
    DH.menu.open("🪑 Furniture Store", CATALOG.map(d => ({
      ico: d.ico, label: `${d.name} <small>(+${d.happy}😊)</small>`, cost: d.cost,
      cb: () => {
        if (S.coins < d.cost) { DH.toast("☹️ Not enough coins!"); return; }
        beginPlacing(d, p);
      },
    })));
  }
  function openItemMenu(it) {
    const d = BYID[it.id], opts = [];
    if (d.use) opts.push({
      ico: d.ico, label: d.use.happy ? `${d.use.label} (+${d.use.happy}😊)` : d.use.label,
      disabled: it.cd > 0, cb: () => use(it.x0, it.y0),
    });
    opts.push({ ico: "💰", label: `Sell (+🪙${Math.floor(d.cost * SELL_RATE)})`, cb: () => remove(it.x0, it.y0) });
    DH.menu.open(`${d.ico} ${d.name}`, opts);
  }

  // ---------- drawing ----------
  function drawItem(it) {
    const d = BYID[it.id];
    d.draw(G, it.x0 * T - cam.x, it.y0 * T - cam.y, it);
  }
  const SIGN_ENTRY = {
    y: 10 * T,
    fn() {
      const x = 10 * T - cam.x, y = 9 * T - cam.y;
      R(G, x + 13, y + 12, 6, 19, "#6e4b28");
      R(G, x + 2, y + 1, 28, 15, "#a4763f"); R(G, x + 2, y + 1, 28, 3, "#8a5f30");
      R(G, x + 4, y + 5, 24, 8, "#c8975c");
      G.fillStyle = "#3a2412"; G.font = "bold 7px sans-serif"; G.textAlign = "center";
      G.fillText("SHOP", x + 16, y + 12);
    },
  };
  function drawParticle(ctx, pt) {
    const a = Math.max(0, 1 - pt.age / pt.ttl);
    ctx.save(); ctx.globalAlpha = a;
    if (pt.kind === "heart") DH.sprites.heart(ctx, pt.x, pt.y, 6);
    else if (pt.kind === "drop") { ctx.fillStyle = "#5ab4f0"; ctx.beginPath(); ctx.arc(pt.x, pt.y, 3, 0, 7); ctx.fill(); }
    else if (pt.kind === "bubble" || pt.kind === "steam") {
      ctx.strokeStyle = pt.kind === "steam" ? "#cfd8e3" : "#bfeaff"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, 3 + pt.age * 3, 0, 7); ctx.stroke();
    } else {
      ctx.fillStyle = pt.kind === "zzz" ? "#bfeaff" : "#ffd76b";
      ctx.font = "bold 11px sans-serif"; ctx.textAlign = "center";
      ctx.fillText(pt.kind === "zzz" ? "Z" : pt.kind === "note" ? "♪" : "★", pt.x, pt.y);
    }
    ctx.restore();
  }

  // ---------- module contract ----------
  DH.furniture = {
    init(state) {
      S = state;
      G = document.getElementById("cv").getContext("2d");
      // make world.blocked tiles actually impassable (contract promises them to furniture)
      const W = DH.world;
      if (!W._furnPatched) {
        W._furnPatched = true;
        const solid0 = W.isSolid.bind(W);
        W.isSolid = (tx, ty) => solid0(tx, ty) || W.blocked.has(key(tx, ty));
      }
      window.addEventListener("keydown", e => {
        if (e.code === "Escape" && M.placing) {
          cancelPlacing();
          // game.js toggled pause first (its listener was registered earlier) — undo it
          if (S.paused) { S.paused = false; document.getElementById("pauseScreen").classList.add("hidden"); }
        }
      });
    },

    start(state) {
      S = state;
      clearAll();
    },

    update(dt, state) {
      S = state;
      for (const it of M.items) if (it.cd > 0) it.cd = Math.max(0, it.cd - dt);
      for (let i = particles.length - 1; i >= 0; i--) {
        const pt = particles[i];
        pt.age += dt; pt.x += pt.vx * dt; pt.y += pt.vy * dt;
        if (pt.age >= pt.ttl) { particles[i] = particles[particles.length - 1]; particles.pop(); }
      }
      if (M.placing) {
        const d = BYID[M.placing.id], p = S.players[M.placing.pid];
        if (!d || !p) { M.placing = null; ghost = null; showCancel(false); return; }
        const v = DIRV[p.dir] || DIRV.down;
        const fx = Math.floor((p.x + v[0] * 28) / T), fy = Math.floor((p.y + v[1] * 28) / T);
        const x0 = p.dir === "left" ? fx - d.w + 1 : p.dir === "right" ? fx : fx - (d.w >> 1);
        ghost = { x0, y0: fy, ok: canPlaceAt(x0, fy, d) };
      } else ghost = null;
    },

    interactables(p) {
      const out = [];
      if (M.placing) {
        if (p.pid === M.placing.pid) {
          const d = BYID[M.placing.id];
          out.push({
            x: p.x, y: p.y,
            label: canGhostPlace() ? `Place ${d.name} here` : "Can't place here ☹️",
            action: () => confirmPlacing(),
          });
        }
        return out;
      }
      const dsg = (p.x - SIGN.x) ** 2 + (p.y - SIGN.y) ** 2;
      if (dsg < SIGN.r * SIGN.r)
        out.push({ x: SIGN.x, y: SIGN.y, d2: dsg, label: "Furniture catalog", action: () => openShop(p) });
      for (const it of M.items) {
        const up = usePoint(it), dd = (p.x - up.x) ** 2 + (p.y - up.y) ** 2;
        if (dd < up.r * up.r) {
          const uid = it.uid;
          out.push({
            x: up.x, y: up.y, d2: dd, label: BYID[it.id].name,
            action: () => { const cur = M.items.find(i => i.uid === uid); if (cur) openItemMenu(cur); },
          });
        }
      }
      out.sort((a, b) => a.d2 - b.d2);
      return out;
    },

    collectDraws(draws, camX, camY) {
      cam.x = camX; cam.y = camY;
      draws.push(SIGN_ENTRY);
      for (const it of M.items) { const e = viewCache.get(it); if (e) draws.push(e); }
    },

    drawOverlay(ctx, camX, camY, state) {
      for (const pt of particles) drawParticle(ctx, pt);
      if (M.placing && ghost) {
        const d = BYID[M.placing.id];
        const gx = ghost.x0 * T - camX, gy = ghost.y0 * T - camY;
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = ghost.ok ? "#3dff7a" : "#ff4d4d";
        ctx.fillRect(gx, gy, d.w * T, T);
        ctx.globalAlpha = 0.7;
        d.draw(ctx, gx, gy, { lit: true });
        ctx.globalAlpha = 1;
        ctx.strokeStyle = ghost.ok ? "#3dff7a" : "#ff4d4d"; ctx.lineWidth = 2;
        ctx.strokeRect(gx + 1, gy + 1, d.w * T - 2, T - 2);
        ctx.fillStyle = "#ffffffdd"; ctx.font = "bold 10px sans-serif"; ctx.textAlign = "center";
        ctx.fillText(ghost.ok ? "A: place · Esc: cancel" : "blocked ☹️", gx + d.w * T / 2, gy - 4);
        ctx.restore();
      }
    },

    // net-sync boundary
    place, remove, use, serialize, deserialize, remoteAction,
  };
})();
