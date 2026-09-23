/* dream-home tools module — pockets UI, tool ring, durability & tiers (AC_SPEC C-1..C-5).
   Contract with game.js (same as finds.js):
     DH.tools.init(state)                     – called once at load (builds HUD chips + DOM overlays)
     DH.tools.start(state)                    – called when a run starts (grants flimsy starter set)
     DH.tools.drawOverlay(ctx, camX, camY, st)– equipped marker over heads + swing/break FX
     DH.tools.interactables(p)                – -> [{label,x,y,action}] (axe chop demo, slingshot)
     DH.tools.serialize()/deserialize(data)/remoteAction(name,args)

   C-1/C-2 TOOLS & TIERS: shovel/axe/rod/net/can/slingshot, tiers flimsy/normal/
     silver/gold (20/40/60/100 uses). Every use() consumes 1 durability; at 0 the
     tool breaks (shard FX + toast). Cross-module API:
       DH.tools.has(id)         – owns a working copy of that tool
       DH.tools.use(id,x,y)     – consume 1 use; false when absent/broken
       DH.tools.equipped        – equipped tool id ("" none); assignable by id
       DH.tools.grant(id,tier)  – add a tool to the belt
       DH.tools.durability(id)  – {uses,max} of the equipped/first copy
   C-3 POCKETS: 🎒 HUD chip opens a full-screen grid of state.inv slots; tapping
     an item offers Eat (food/fruit → +1 gs.stamina — a flag forage.js consumes
     via DH.tools.eatStamina()), Open (bell-bag → +🪙100), Sell, Drop.
   C-5 TOOL RING: 🧰 HUD chip (shows the equipped icon) opens a horizontally
     scrollable belt of owned tools; tap to equip/unequip.
   C-4 POCKET UPGRADE: inside the ring, 🪙800 then 🪙3000 raises gs.pocketCap
     20→30→40 (items.js inv.cap() already reads gs.pocketCap; its own save
     slice persists it).

   All persistent state is JSON-plain (S.*) and round-trips mods.tools + net
   snapshots. Guests never run update(); their UI actions travel as
   net.guestAction("tools.<fn>", args) → this module's remoteAction.
   No other module is required — finds.js/garden.js hooks are optional deps.
*/
(function () {
  const DH = (window.DH = window.DH || {});
  const T = 32;

  // ---------- tool catalog ----------
  const TOOL_DEFS = [
    { id: "shovel",    name: "Shovel",       ico: "⛏️" },
    { id: "axe",       name: "Axe",          ico: "🪓" },
    { id: "rod",       name: "Fishing Rod",  ico: "🎣" },
    { id: "net",       name: "Net",          ico: "🥅" },
    { id: "can",       name: "Watering Can", ico: "🚿" },
    { id: "slingshot", name: "Slingshot",    ico: "🏹" },
  ];
  const TOOL_BY_ID = {};
  TOOL_DEFS.forEach(t => {
    TOOL_BY_ID[t.id] = t;
    DH.items.def(t.id, { name: t.name, ico: t.ico, cat: "tool", price: 50, stack: 1 });
  });

  // C-1/C-2 tiers — durability per tier
  const TIERS = {
    flimsy: { label: "Flimsy", uses: 20,  col: "#a8a890" },
    normal: { label: "",       uses: 40,  col: "#d9a862" },
    silver: { label: "Silver", uses: 60,  col: "#cdd7e2" },
    gold:   { label: "Golden", uses: 100, col: "#ffd94d" },
  };
  const TIER_ORD = ["flimsy", "normal", "silver", "gold"];
  const toolName = t => ((TIERS[t.tier] || TIERS.flimsy).label + " " + (TOOL_BY_ID[t.id] || { name: t.id }).name).trim();
  const toolIco = t => (TOOL_BY_ID[t.id] || { ico: "🔧" }).ico;

  const POCKET_COSTS = { 20: 800, 30: 3000, 40: 0 }; // cap -> next upgrade cost
  const STAMINA_MAX = 10;
  const TREES = [{ tx: 28, ty: 3 }, { tx: 28, ty: 5 }, { tx: 28, ty: 7 }]; // garden orchard
  const INTERACT_R = 52, SHOOT_DX = 90;

  // ---------- module state (plain JSON only) ----------
  let gs = null;
  const S = {
    tools: [],     // [{uid,id,tier,uses}]
    equipped: 0,   // uid of equipped tool (0 = none)
    granted: 0,    // flimsy starter set already given
    nextUid: 1,
  };
  let fx = []; // transient timestamp FX (not serialized): {k,x,y,vx,vy,until,ttl,col}

  // DOM handles (built lazily)
  let chipPk = null, chipTl = null, pocketsEl = null, toolsEl = null;
  let selSlot = -1, refreshH = null;

  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
  const isGuest = () => !!(DH.net && DH.net.online && DH.net.role === "guest");
  const log = d => { if (DH.alog) DH.alog.add("tools", d); };
  const equippedTool = () => S.tools.find(t => t.uid === S.equipped) || null;

  // ---------- FX ----------
  function swingFX(x, y) { // axe chop: wood chips + slash arc
    const t = Date.now();
    for (let i = 0; i < 7; i++)
      fx.push({ k: "chip", x: x + rnd(-9, 9), y: y - 14 + rnd(-8, 4), vx: rnd(-42, 42), vy: -42 - rnd(0, 30), until: t + 520, ttl: 0.52, col: i % 2 ? "#a0733f" : "#d8b060" });
    fx.push({ k: "slash", x, y: y - 16, until: t + 240, ttl: 0.24 });
  }
  function crackFX(x, y) { // tool break: grey shard burst
    const t = Date.now();
    for (let i = 0; i < 9; i++)
      fx.push({ k: "chip", x: x + rnd(-6, 6), y: y - 20 + rnd(-6, 4), vx: rnd(-52, 52), vy: -58 - rnd(0, 26), until: t + 650, ttl: 0.65, col: i % 3 ? "#9aa3ad" : "#eef0f5" });
  }
  function popFX(x, y) { // slingshot hit confetti
    const t = Date.now();
    for (let i = 0; i < 9; i++)
      fx.push({ k: "chip", x: x + rnd(-8, 8), y: y + rnd(-8, 8), vx: rnd(-46, 46), vy: rnd(-44, 8), until: t + 540, ttl: 0.54, col: pick(["#ffd76b", "#ff8aa0", "#8ae0ff", "#ffffff"]) });
  }

  // ---------- remote-callable actions (host executes, guests via tools.*) ----------
  const API = {
    grant(id, tier) { // also public API — adds a tool to the belt
      const d = TOOL_BY_ID[id], tr = TIERS[tier] ? tier : "flimsy";
      if (!d) return false;
      const t = { uid: S.nextUid++, id, tier: tr, uses: TIERS[tr].uses };
      S.tools.push(t);
      log("grant:" + id + "/" + tr);
      return true;
    },
    equip(uid) { // uid 0/negative = unequip
      const t = S.tools.find(t2 => t2.uid === uid && t2.uses > 0);
      S.equipped = t ? t.uid : 0;
      if (t) { DH.toast(`Equipped ${toolName(t)} ${toolIco(t)}`); log("equip:" + t.id); }
      else log("equip:none");
      return true;
    },
    eat(id) { // C-3: food/fruit → stamina flag (forage consumes it later)
      const d = DH.items.get(id);
      if (!d || (d.cat !== "food" && d.cat !== "fruit")) return false;
      if (!DH.inv.remove(id, 1)) return false;
      gs.stamina = Math.min(STAMINA_MAX, (gs.stamina || 0) + 1);
      DH.toast(`Ate ${d.name} ${d.ico} — +1 stamina ⚡ (strong for one good dig)`);
      log("eat:" + id);
      return true;
    },
    redeem(id) { // bell bag → coins
      if (id !== "bell-bag" || !DH.inv.count(id)) return false;
      DH.inv.remove(id, 1);
      gs.coins += 100;
      DH.toast("Opened a bell bag! +🪙100");
      log("redeem:bell-bag");
      return true;
    },
    read(id) { // recipe cards: flavor until craft.js lands
      if (!/^recipe-/.test(id) || !DH.inv.count(id)) return false;
      DH.toast(`🧾 ${DH.items.label(id)} — keep it for the workbench (coming soon)`, 2600);
      return true;
    },
    sell(id) {
      const d = DH.items.get(id), price = d ? d.price : 0;
      if (!price || !DH.inv.count(id)) { DH.toast("Can't sell that"); return false; }
      DH.inv.remove(id, 1);
      gs.coins += price;
      DH.toast(`Sold ${d.name} ${d.ico} +🪙${price}`);
      log("sell:" + id);
      return true;
    },
    drop(id) {
      if (!DH.inv.remove(id, 1)) return false;
      DH.toast(`Dropped ${DH.items.label(id)}`);
      log("drop:" + id);
      return true;
    },
    upgrade() { // C-4: pocket expansion 20→30→40
      const cap = gs.pocketCap || 20;
      const cost = POCKET_COSTS[cap];
      if (!cost) { DH.toast("Pockets already maxed! 🎒"); return false; }
      if (gs.coins < cost) { DH.toast(`Not enough coins — need 🪙${cost}`); return false; }
      gs.coins -= cost;
      gs.pocketCap = cap + 10;
      DH.toast(`Pockets expanded to ${gs.pocketCap} slots! 🎒✨`, 2600);
      log("pockets:" + gs.pocketCap);
      return true;
    },
  };

  // route a UI action: host/solo runs it now, guests ask the host via remoteAction
  function act(name, ...args) {
    if (isGuest()) { DH.net.guestAction("tools." + name, args); return undefined; }
    const fn = API[name];
    const r = typeof fn === "function" ? fn(...args) : false;
    refreshPanels();
    return r;
  }

  // ---------- demo tool uses (harmless until forage/critters land) ----------
  function chopTree(tx, ty) {
    const x = tx * T + 16, y = ty * T + 16;
    if (!M.use("axe", x, y)) { DH.toast("You need an axe 🪓"); return false; }
    swingFX(x, y);
    DH.toast("Whack! 🪓 The tree rustles…");
    log("chop");
    return true;
  }
  function shootSlingshot() {
    const b = DH.finds && DH.finds._state && DH.finds._state.balloon;
    if (!b || !b.active) { DH.toast("Nothing to shoot at…"); return false; }
    if (!M.use("slingshot", b.x, b.y)) { DH.toast("Your slingshot is broken!"); return false; }
    popFX(b.x, b.y);
    return DH.finds.shootBalloon();
  }

  // ---------- DOM: HUD chips + overlays ----------
  function makeChip(ico, title, cb) {
    const b = document.createElement("button");
    b.className = "chip";
    b.style.cssText = "cursor:pointer;border:none;font-family:inherit;font-size:15px";
    b.innerHTML = ico;
    b.title = title;
    b.addEventListener("click", cb);
    document.getElementById("hud").appendChild(b);
    return b;
  }

  function pauseForUI() {
    if (isGuest() || !gs) return; // guests keep applying host snapshots while browsing
    gs.paused = true;
    const ps = document.getElementById("pauseScreen");
    if (ps) ps.classList.add("hidden");
  }
  function closePanels() {
    if (pocketsEl) pocketsEl.classList.add("hidden");
    if (toolsEl) toolsEl.classList.add("hidden");
    clearInterval(refreshH);
    selSlot = -1;
    if (gs && !isGuest()) gs.paused = false;
  }
  function refreshPanels() {
    if (pocketsEl && !pocketsEl.classList.contains("hidden")) renderPockets();
    if (toolsEl && !toolsEl.classList.contains("hidden")) renderTools();
  }
  function armRefresh() { // picks up host snapshots for guests / external changes
    clearInterval(refreshH);
    refreshH = setInterval(refreshPanels, 400);
  }

  function pocketsUI() {
    if (pocketsEl) return pocketsEl;
    const o = document.createElement("div");
    o.id = "pocketsUI";
    o.className = "overlay hidden";
    o.style.zIndex = "19"; // under #toast(20) so feedback stays visible, over touchLayer(15)
    o.innerHTML =
      '<div class="card" style="max-width:460px">' +
        '<h2>🎒 Pockets <span class="pkcap" style="font-size:14px;opacity:.7"></span></h2>' +
        '<div class="pkgrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(64px,1fr));gap:8px;max-height:38vh;overflow-y:auto"></div>' +
        '<div class="pksel hint" style="min-height:36px;margin:8px 0 4px"></div>' +
        '<div class="pkacts" style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-bottom:12px"></div>' +
        '<div style="display:flex;gap:8px;justify-content:center">' +
          '<button class="midbtn pkt">🧰 Tools</button>' +
          '<button class="midbtn pkx">Close</button>' +
        '</div>' +
      '</div>';
    o.addEventListener("click", e => { if (e.target === o) closePanels(); });
    o.querySelector(".pkx").addEventListener("click", closePanels);
    o.querySelector(".pkt").addEventListener("click", () => { closePanels(); openTools(); });
    document.getElementById("stage").appendChild(o);
    pocketsEl = o;
    return o;
  }

  function renderPockets() {
    if (!pocketsEl || !gs) return;
    const inv = DH.inv.list(), cap = DH.inv.cap();
    if (selSlot >= inv.length) selSlot = -1;
    pocketsEl.querySelector(".pkcap").textContent = `${inv.length}/${cap} slots`;
    const grid = pocketsEl.querySelector(".pkgrid");
    grid.innerHTML = "";
    const cells = Math.max(cap, inv.length);
    for (let i = 0; i < cells; i++) {
      const s = inv[i];
      const c = document.createElement("div");
      c.style.cssText = "background:#14142a;border:2px solid " + (selSlot === i ? "#4ecdc4" : "transparent") +
        ";border-radius:10px;padding:8px 4px;text-align:center;font-size:12px;min-height:58px";
      if (s) {
        const d = DH.items.get(s.id) || { ico: "📦", name: s.id };
        c.style.cursor = "pointer";
        c.innerHTML = `<div style="font-size:22px">${d.ico}</div><div style="opacity:.85">${s.n > 1 ? "×" + s.n : "&nbsp;"}</div>`;
        c.title = d.name;
        c.addEventListener("click", () => { selSlot = i; renderPockets(); });
      } else {
        c.innerHTML = '<div style="font-size:20px;opacity:.15">·</div><div>&nbsp;</div>';
      }
      grid.appendChild(c);
    }
    const selEl = pocketsEl.querySelector(".pksel"), acts = pocketsEl.querySelector(".pkacts");
    acts.innerHTML = "";
    const sel = inv[selSlot];
    if (!sel) { selEl.textContent = "Tap a slot — eat, open, sell, or drop what you're carrying."; return; }
    const d = DH.items.get(sel.id) || { name: sel.id, ico: "📦", cat: "misc", price: 0 };
    selEl.innerHTML = `<b>${d.ico} ${d.name}</b> <span style="opacity:.65">${d.cat}${d.price ? " · sells for 🪙" + d.price : " · not sellable"}</span>`;
    const mk = (label, fn) => {
      const b = document.createElement("button");
      b.className = "midbtn"; b.style.padding = "7px 14px"; b.textContent = label;
      b.addEventListener("click", fn);
      acts.appendChild(b);
    };
    if (d.cat === "food" || d.cat === "fruit") mk("🍽 Eat", () => act("eat", sel.id));
    if (sel.id === "bell-bag") mk("💰 Open", () => act("redeem", sel.id));
    if (/^recipe-/.test(sel.id)) mk("📖 Read", () => act("read", sel.id));
    if (d.price > 0) mk(`🪙 Sell ×1`, () => act("sell", sel.id));
    mk("🕳 Drop ×1", () => act("drop", sel.id));
  }

  function openPockets() {
    if (!gs || !gs.running) { DH.toast("Start playing first!"); return; }
    pocketsUI().classList.remove("hidden");
    pauseForUI();
    selSlot = -1;
    renderPockets();
    armRefresh();
    log("pockets_open");
  }

  function toolsUI() {
    if (toolsEl) return toolsEl;
    const o = document.createElement("div");
    o.id = "toolsUI";
    o.className = "overlay hidden";
    o.style.zIndex = "19"; // under #toast(20) so feedback stays visible, over touchLayer(15)
    o.innerHTML =
      '<div class="card" style="max-width:460px">' +
        '<h2>🧰 Tool Ring</h2>' +
        '<div class="tlrow" style="display:flex;gap:10px;overflow-x:auto;padding:6px 2px 10px"></div>' +
        '<div class="tlup" style="margin:6px 0 12px"></div>' +
        '<div style="display:flex;gap:8px;justify-content:center">' +
          '<button class="midbtn tlp">🎒 Pockets</button>' +
          '<button class="midbtn tlx">Close</button>' +
        '</div>' +
      '</div>';
    o.addEventListener("click", e => { if (e.target === o) closePanels(); });
    o.querySelector(".tlx").addEventListener("click", closePanels);
    o.querySelector(".tlp").addEventListener("click", () => { closePanels(); openPockets(); });
    document.getElementById("stage").appendChild(o);
    toolsEl = o;
    return o;
  }

  function renderTools() {
    if (!toolsEl || !gs) return;
    const row = toolsEl.querySelector(".tlrow");
    row.innerHTML = "";
    const list = S.tools.slice().sort((a, b) =>
      TOOL_DEFS.findIndex(t => t.id === a.id) - TOOL_DEFS.findIndex(t => t.id === b.id) ||
      TIER_ORD.indexOf(a.tier) - TIER_ORD.indexOf(b.tier));
    if (!list.length)
      row.innerHTML = '<div class="hint" style="margin:auto;padding:14px">No tools yet.</div>';
    for (const t of list) {
      const tr = TIERS[t.tier] || TIERS.flimsy;
      const card = document.createElement("div");
      card.style.cssText = "flex:0 0 104px;background:#14142a;border:2px solid " +
        (t.uid === S.equipped ? "#4ecdc4" : "transparent") +
        ";border-radius:12px;padding:10px 6px;text-align:center;cursor:pointer";
      card.innerHTML =
        `<div style="font-size:26px">${toolIco(t)}</div>` +
        `<div style="font-size:12px;font-weight:600">${toolName(t)}</div>` +
        `<div style="height:5px;background:#33334a;border-radius:3px;margin:6px 6px 2px"><div style="height:5px;border-radius:3px;width:${Math.round(100 * t.uses / tr.uses)}%;background:${tr.col}"></div></div>` +
        `<div style="font-size:10px;opacity:.7">${t.uses}/${tr.uses}</div>` +
        (t.uid === S.equipped ? '<div style="font-size:10px;color:#4ecdc4;font-weight:700">equipped ✓</div>' : '<div style="font-size:10px;opacity:.4">tap to equip</div>');
      card.addEventListener("click", () => act("equip", t.uid === S.equipped ? 0 : t.uid));
      row.appendChild(card);
    }
    // C-4 pocket upgrade inside the tools menu
    const up = toolsEl.querySelector(".tlup");
    up.innerHTML = "";
    const cap = gs.pocketCap || 20, cost = POCKET_COSTS[cap];
    const ub = document.createElement("button");
    ub.className = "midbtn";
    ub.style.width = "100%";
    if (cost) {
      ub.innerHTML = `🎒 Pocket upgrade → ${cap + 10} slots · 🪙${cost}`;
      if (gs.coins < cost) { ub.disabled = true; ub.style.opacity = 0.55; }
      else ub.addEventListener("click", () => act("upgrade"));
    } else {
      ub.innerHTML = `🎒 Pockets maxed (${cap} slots)`;
      ub.disabled = true; ub.style.opacity = 0.55;
    }
    up.appendChild(ub);
  }

  function openTools() {
    if (!gs || !gs.running) { DH.toast("Start playing first!"); return; }
    toolsUI().classList.remove("hidden");
    pauseForUI();
    renderTools();
    armRefresh();
    log("tools_open");
  }

  function refreshChip() { // keep the 🧰 chip showing the equipped icon
    if (!chipTl) return;
    const eq = equippedTool();
    const cur = eq ? toolIco(eq) : "🧰";
    if (chipTl._cur !== cur) { chipTl._cur = cur; chipTl.innerHTML = cur; chipTl.title = eq ? `Tools — ${toolName(eq)} equipped` : "Tools"; }
  }

  // ---------- module contract ----------
  const M = (DH.tools = {
    authority: true,
    _state: S,

    // cross-module tool API
    get equipped() { const t = equippedTool(); return t ? t.id : ""; },
    set equipped(id) { const t = S.tools.find(t2 => t2.id === id && t2.uses > 0); S.equipped = t ? t.uid : 0; },
    equippedTool,
    has(id) { return S.tools.some(t => t.id === id && t.uses > 0); },
    use(id, x, y) { // consume 1 durability; false when absent/broken
      let t = equippedTool();
      if (!t || t.id !== id) t = S.tools.find(t2 => t2.id === id && t2.uses > 0);
      if (!t || t.uses <= 0) return false;
      t.uses--;
      if (t.uses <= 0) {
        S.tools = S.tools.filter(t2 => t2 !== t);
        if (S.equipped === t.uid) S.equipped = 0;
        const px = x != null ? x : (gs && gs.players && gs.players[0] ? gs.players[0].x : 480);
        const py = y != null ? y : (gs && gs.players && gs.players[0] ? gs.players[0].y : 300);
        crackFX(px, py);
        DH.toast(`💔 Your ${toolName(t)} broke!`, 2400);
        log("broke:" + t.id);
        refreshChip();
      }
      refreshPanels();
      return true;
    },
    durability(id) {
      const t = equippedTool() && equippedTool().id === id ? equippedTool() : S.tools.find(t2 => t2.id === id);
      return t ? { uses: t.uses, max: (TIERS[t.tier] || TIERS.flimsy).uses, tier: t.tier } : null;
    },
    grant(id, tier) { return API.grant(id, tier); },
    // stamina flag produced by eating (C-3) — forage/craft modules spend it
    stamina() { return (gs && gs.stamina) || 0; },
    eatStamina() { if (gs && gs.stamina > 0) { gs.stamina--; return true; } return false; },

    openPockets, openTools, // console/testing + future phone UI entry points

    init(state) {
      gs = state;
      chipPk = makeChip("🎒", "Pockets", openPockets);
      chipTl = makeChip("🧰", "Tools", openTools);
      refreshChip();
    },

    start(state) {
      gs = state;
      M.authority = !(DH.net && DH.net.online && DH.net.role === "guest");
      gs.pocketCap = gs.pocketCap || 20;
      closePanels();
      fx = [];
      if (!S.granted) { // C-1: basic flimsy set on first start
        S.granted = 1;
        TOOL_DEFS.forEach(t => API.grant(t.id, "flimsy"));
        if (M.authority) DH.toast("🧰 You got a flimsy tool set — tap 🧰 up top to equip!", 3600);
        log("starter_set");
      }
      refreshChip();
    },

    interactables(p) {
      const out = [];
      const eq = equippedTool();
      if (!eq) return out;
      if (eq.id === "axe") { // demo: chop the orchard trees (harmless)
        for (const tr of TREES) {
          const x = tr.tx * T + 16, y = tr.ty * T + 16;
          if (dist2(p.x, p.y, x, y) < INTERACT_R * INTERACT_R)
            out.push({ label: "Chop tree 🪓", x, y, action: () => chopTree(tr.tx, tr.ty) });
        }
      }
      if (eq.id === "slingshot" && DH.finds && DH.finds._state) { // demo: pop balloons
        const b = DH.finds._state.balloon;
        if (b && b.active && Math.abs(p.x - b.x) < SHOOT_DX && p.y - b.y > -30)
          out.push({ label: "Fire slingshot 🏹", x: b.x, y: p.y, action: shootSlingshot });
      }
      return out;
    },

    drawOverlay(ctx, camX, camY, state) {
      const now = Date.now();
      const eq = equippedTool();
      if (eq && state && state.players) { // equipped marker above heads
        for (const p of state.players) {
          const x = p.x - camX + 15, y = p.y - camY - 42;
          ctx.fillStyle = "#14142ad0";
          ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = "#ffffff55"; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.stroke();
          ctx.font = "9px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText(toolIco(eq), x, y + 0.5);
        }
      }
      for (const f of fx) {
        const life = (f.until - now) / (f.ttl * 1000);
        if (life <= 0) continue;
        const pr = 1 - life;
        const x = f.x + (f.vx || 0) * pr * f.ttl - camX;
        const y = f.y + (f.vy || 0) * pr * f.ttl - camY;
        ctx.globalAlpha = Math.max(0, life);
        if (f.k === "slash") {
          ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(x, y, 10 + pr * 9, -0.6 - pr, 0.9 - pr); ctx.stroke();
        } else {
          ctx.fillStyle = f.col;
          ctx.fillRect(x - 2, y - 2, 4, 4);
        }
        ctx.globalAlpha = 1;
      }
      fx = fx.filter(f => f.until > now);
      refreshChip();
    },

    // ---------- sync boundary ----------
    serialize() {
      return JSON.parse(JSON.stringify({ tools: S.tools, eq: S.equipped, granted: S.granted, nextUid: S.nextUid }));
    },
    deserialize(d) {
      if (!d) return;
      if (Array.isArray(d.tools)) S.tools = d.tools.filter(t => t && TOOL_BY_ID[t.id] && TIERS[t.tier]);
      if (typeof d.eq === "number") S.equipped = d.eq;
      if (typeof d.granted === "number") S.granted = d.granted;
      if (typeof d.nextUid === "number") S.nextUid = d.nextUid;
      if (!S.tools.some(t => t.uid === S.equipped)) S.equipped = 0;
      refreshChip();
      refreshPanels();
    },
    remoteAction(name, args) {
      if (typeof name === "string" && name.startsWith("tools.")) {
        const fn = API[name.slice(6)];
        if (typeof fn === "function") return fn.apply(null, args || []);
      }
      return false;
    },
    offline() { return []; }, // tools don't decay while away
  });
})();

DH.register("tools", DH.tools);
