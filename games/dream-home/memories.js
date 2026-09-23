/* dream-home memories module — camera, photo album & placeable markers
   (AC_SPEC P-2 camera · J-6 album · P-3 markers).
   Contract with game.js (same as animals.js):
     DH.memories.init(state)         – called once at load (HUD chip + DOM overlays)
     DH.memories.start(state)        – called when a run starts (grants the camera)
     DH.memories.update(dt, state)   – per frame (host/solo sim; FX is timestamp-driven)
     DH.memories.interactables(p)    – -> [{label,x,y,action}] for the A button
     DH.memories.collectDraws(draws, camX, camY) – push {y,fn} depth-sorted sprites
     DH.memories.drawOverlay(ctx, camX, camY, state) – photo frame, torch glow, flash
     DH.memories.serialize()/deserialize(data)/remoteAction(name,args)

   P-2 CAMERA: a 📷 HUD chip opens the memories menu. With a "camera" item in
   pockets (granted once on first run) "Photo mode" hides the HUD chrome and
   shows a live viewfinder: rule-of-thirds frame, x1/x2 zoom, 4 filters
   (normal/warm/cool/mono — canvas tint overlays). The A button snaps: the
   current canvas region is copied into an offscreen canvas, downscaled to
   48x32 and stored as a dataURL (album capped at 24, oldest evicted), with a
   flash + shutter-sound FX.
   J-6 ALBUM: "Album" opens a grid of thumbnails; tap for fullscreen + auto
   caption ("Day 12, spring, evening" + zone/filter/weather tags), delete, and
   a share placeholder (copies the dataURL). DH.museum.album entries (if the
   museum module is present) render as badge cards at the top.
   P-3 MARKERS: flag/signpost/heart-stone items (bought at the marker shop)
   place on free yard/house tiles — they render in world, persist through the
   save bus and are removable (item refunded to pockets). Up to 8 "torch"
   markers glow at night.

   Sync boundary: all persistent state is plain JSON in S.* and round-trips
   mods.memories + net snapshots. Guests never run update(); their UI actions
   travel as net.guestAction("memories.<fn>", args) -> remoteAction.
   No other module is required — museum/tools hooks are optional deps.
*/
(function () {
  const DH = (window.DH = window.DH || {});
  const T = 32;

  // ---------- tuning ----------
  const ALBUM_CAP = 24;
  const CAMERA_COST = 120;
  const TORCH_MAX = 8;
  const INTERACT_R = 40;
  const NIGHT_FROM = 21 * 60, NIGHT_TO = 5 * 60; // matches env.js dayparts
  const PHOTO_W = 48, PHOTO_H = 32;

  const MARKER_DEFS = [
    { id: "flag",        name: "Flag",        ico: "🚩", cost: 20 },
    { id: "signpost",    name: "Signpost",    ico: "🪧", cost: 30 },
    { id: "heart-stone", name: "Heart stone", ico: "💗", cost: 45 },
    { id: "torch",       name: "Torch",       ico: "🔥", cost: 35 },
  ];
  const MK = {};
  MARKER_DEFS.forEach(m => {
    MK[m.id] = m;
    DH.items.def(m.id, { name: m.name, ico: m.ico, cat: "furniture", price: m.cost, stack: 8 });
  });
  DH.items.def("camera", { name: "Camera", ico: "📷", cat: "tool", price: 0, stack: 1 });

  const FILTERS = [
    { id: "normal", name: "Normal", tint: null },
    { id: "warm",   name: "Warm",   tint: "rgba(255,170,70,0.22)" },
    { id: "cool",   name: "Cool",   tint: "rgba(80,150,255,0.20)" },
    { id: "mono",   name: "Mono",   tint: null, mono: true },
  ];
  const ZONE_LABEL = { house: "Home", yard: "Yard", garden: "Garden", pasture: "Pasture", pond: "Pond" };
  const PLACE_ZONES = { yard: 1, house: 1 };
  const DIRV = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

  // ---------- module state (plain JSON only) ----------
  let gs = null;
  const S = {
    photos: [],   // [{id,img,cap,day,season,phase,zone,filter}]
    markers: [],  // [{id,mk,tx,ty}]
    granted: 0,   // camera granted once
    nextId: 1,
  };
  let ctx2 = null;               // draw ctx cached for collectDraws fns
  let cvEl = null;               // main game canvas
  const photo = { on: false, zoom: 1, filter: 0, flashUntil: 0 }; // transient UI state

  const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
  const isGuest = () => !!(DH.net && DH.net.online && DH.net.role === "guest");
  const log = d => { if (DH.alog) DH.alog.add("mem", d); };
  const timeMin = () => (gs && typeof gs.timeMin === "number" ? gs.timeMin : 720);
  const isNight = () => { const t = timeMin(); return t >= NIGHT_FROM || t < NIGHT_TO; };
  const season = () => (gs && gs.season) || ["spring", "summer", "autumn", "winter"][Math.floor((gs && gs.day || 0) / 2) % 4];
  function phase() {
    const t = timeMin();
    if (t >= 5 * 60 && t < 12 * 60) return "morning";
    if (t < 17 * 60) return "afternoon";
    if (t < 21 * 60) return "evening";
    return "night";
  }
  const hasCamera = () => !!DH.inv && DH.inv.count("camera") > 0;
  const markerAt = (tx, ty) => S.markers.find(m => m.tx === tx && m.ty === ty) || null;
  const torchCount = () => S.markers.filter(m => m.mk === "torch").length;
  function canPlace(tx, ty) {
    const W = DH.world;
    return !W.isSolid(tx, ty) && !W.isBlocked(tx, ty) &&
      !markerAt(tx, ty) && PLACE_ZONES[W.zone(tx, ty)];
  }

  // ---------- shutter sound (tiny WebAudio synth) ----------
  let AC = null;
  function shutter() {
    try {
      AC = AC || new (window.AudioContext || window.webkitAudioContext)();
      if (AC.state === "suspended") AC.resume();
      const t = AC.currentTime;
      const buf = AC.createBuffer(1, Math.floor(AC.sampleRate * 0.07), AC.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      const src = AC.createBufferSource(); src.buffer = buf;
      const g = AC.createGain();
      g.gain.setValueAtTime(0.22, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      src.connect(g); g.connect(AC.destination); src.start(t);
      const o = AC.createOscillator(); o.type = "square"; o.frequency.value = 1700;
      const g2 = AC.createGain();
      g2.gain.setValueAtTime(0.07, t); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      o.connect(g2); g2.connect(AC.destination); o.start(t); o.stop(t + 0.06);
    } catch (e) {}
  }

  // ---------- remote-callable actions (host executes, guests via memories.*) ----------
  const API = {
    addPhoto(p) {
      if (!p || typeof p.img !== "string" || !p.img.length || p.img.length > 300000) return false;
      S.photos.push({
        id: S.nextId++, img: p.img,
        cap: typeof p.cap === "string" ? p.cap : "",
        day: p.day | 0, season: p.season || "", phase: p.phase || "",
        zone: p.zone || "", filter: p.filter || "normal",
      });
      while (S.photos.length > ALBUM_CAP) S.photos.shift();
      if (DH.save) DH.save.now();
      log("photo:" + S.photos.length);
      return true;
    },
    deletePhoto(id) {
      const i = S.photos.findIndex(p => p.id === id);
      if (i < 0) return false;
      S.photos.splice(i, 1);
      if (DH.save) DH.save.now();
      log("photo_del");
      return true;
    },
    buyCamera() {
      if (!gs || hasCamera()) return false;
      if (gs.coins < CAMERA_COST) { DH.toast(`Not enough coins — need 🪙${CAMERA_COST}`); return false; }
      if (!DH.inv.add("camera", 1)) { DH.toast("Pockets are full! 🎒"); return false; }
      gs.coins -= CAMERA_COST;
      DH.toast("Bought a camera! 📷 Say cheese!");
      log("camera_buy");
      return true;
    },
    buyMarker(id) {
      const d = MK[id];
      if (!gs || !d) return false;
      if (gs.coins < d.cost) { DH.toast(`Not enough coins — need 🪙${d.cost}`); return false; }
      if (!DH.inv.add(id, 1)) { DH.toast("Pockets are full! 🎒"); return false; }
      gs.coins -= d.cost;
      DH.toast(`Bought ${d.name} ${d.ico} — stand on a free tile and press A to place it!`, 2600);
      log("marker_buy:" + id);
      return true;
    },
    placeMarker(id, tx, ty) {
      const d = MK[id];
      if (!gs || !d || !DH.inv.count(id)) return false;
      if (!canPlace(tx | 0, ty | 0)) { DH.toast("Can't place that here 🪨"); return false; }
      if (id === "torch" && torchCount() >= TORCH_MAX) { DH.toast(`Only ${TORCH_MAX} torches can stand at once 🔥`); return false; }
      DH.inv.remove(id, 1);
      S.markers.push({ id: S.nextId++, mk: id, tx: tx | 0, ty: ty | 0 });
      DH.toast(`Placed ${d.name} ${d.ico}`);
      if (DH.save) DH.save.now();
      log("marker_put:" + id);
      return true;
    },
    removeMarker(id) {
      const i = S.markers.findIndex(m => m.id === id);
      if (i < 0) return false;
      const m = S.markers.splice(i, 1)[0];
      const d = MK[m.mk];
      if (d) DH.inv.add(m.mk, 1); // back to pockets (lost only if pockets are full)
      DH.toast(`Took up ${d ? d.name : "marker"} ${d ? d.ico : ""}`);
      if (DH.save) DH.save.now();
      log("marker_up:" + m.mk);
      return true;
    },
  };

  // route a UI action: host/solo runs it now, guests ask the host via remoteAction
  function act(name, ...args) {
    if (isGuest()) { DH.net.guestAction("memories." + name, args); return undefined; }
    const fn = API[name];
    return typeof fn === "function" ? fn(...args) : false;
  }

  // ---------- photo capture ----------
  // 3:2 region centered on the canvas — this is exactly what gets stored.
  function shotRect() {
    const W = cvEl.width, H = cvEl.height;
    let w = Math.min(W, H * 1.5), h = w / 1.5;
    let x = (W - w) / 2, y = (H - h) / 2;
    if (photo.zoom === 2) { x += w / 4; y += h / 4; w /= 2; h /= 2; }
    return { x, y, w, h };
  }
  function capture() {
    if (!cvEl) cvEl = document.getElementById("cv");
    if (!cvEl) return null;
    const r = shotRect();
    const off = document.createElement("canvas");
    off.width = PHOTO_W; off.height = PHOTO_H;
    const oc = off.getContext("2d");
    const f = FILTERS[photo.filter];
    try { if (f.mono) oc.filter = "grayscale(1)"; } catch (e) {}
    oc.imageSmoothingEnabled = true;
    oc.drawImage(cvEl, r.x, r.y, r.w, r.h, 0, 0, PHOTO_W, PHOTO_H);
    try { oc.filter = "none"; } catch (e) {}
    if (f.tint) { oc.fillStyle = f.tint; oc.fillRect(0, 0, PHOTO_W, PHOTO_H); }
    if (f.mono) { oc.fillStyle = "rgba(70,70,80,0.10)"; oc.fillRect(0, 0, PHOTO_W, PHOTO_H); }
    try { return off.toDataURL("image/png"); } catch (e) { return null; }
  }
  function photoCaption(p, zone) {
    const parts = [`Day ${Math.floor(gs.day || 0) + 1}`, season(), phase()];
    const tags = [];
    if (ZONE_LABEL[zone]) tags.push(ZONE_LABEL[zone]);
    if (DH.env && DH.env.weather && DH.env.weather !== "sunny") tags.push(DH.env.weather);
    return { cap: parts.join(", "), tags };
  }
  function takePhoto(p) {
    if (!hasCamera()) { DH.toast("You need a camera — buy one in the 📷 menu!"); return false; }
    const img = capture();
    if (!img) { DH.toast("Couldn't take the photo ☹️"); return false; }
    const zone = p ? DH.world.zone(Math.floor(p.x / T), Math.floor(p.y / T)) : "yard";
    const { cap, tags } = photoCaption(p, zone);
    const ph = {
      img, cap: cap + (tags.length ? " — " + tags.join(" · ") : ""),
      day: Math.floor(gs.day || 0) + 1, season: season(), phase: phase(),
      zone, filter: FILTERS[photo.filter].id,
    };
    if (isGuest()) DH.net.guestAction("memories.addPhoto", [ph]);
    else API.addPhoto(ph);
    photo.flashUntil = Date.now() + 260;
    shutter();
    DH.toast("📸 Saved to album!");
    log("snap:" + (ph.zone || "?"));
    return true;
  }

  // ---------- DOM: HUD chip + photo controls + album ----------
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
    if (isGuest() || !gs) return;
    gs.paused = true;
    const ps = document.getElementById("pauseScreen");
    if (ps) ps.classList.add("hidden");
  }

  // --- photo mode controls (visible only while framing a shot) ---
  let photoUI = null;
  function photoControls() {
    if (photoUI) return photoUI;
    const o = document.createElement("div");
    o.className = "hidden";
    o.style.cssText = "position:absolute;top:104px;left:50%;transform:translateX(-50%);" +
      "display:flex;gap:8px;z-index:21;align-items:center";
    const mk = (label, title, cb) => {
      const b = document.createElement("button");
      b.className = "chip";
      b.style.cssText = "cursor:pointer;border:none;font-family:inherit;font-size:15px;padding:8px 14px";
      b.innerHTML = label; b.title = title;
      b.addEventListener("click", cb);
      o.appendChild(b);
      return b;
    };
    photoUI = { el: o };
    photoUI.zoom = mk("🔍 ×1", "Zoom in/out", () => { photo.zoom = photo.zoom === 1 ? 2 : 1; refreshPhotoButtons(); });
    photoUI.filter = mk("🎞 Normal", "Cycle filter", () => { photo.filter = (photo.filter + 1) % FILTERS.length; refreshPhotoButtons(); });
    const snap = mk("📸", "Take photo", () => takePhoto(gs && gs.players && gs.players[0]));
    snap.style.fontSize = "20px"; snap.style.padding = "10px 20px";
    mk("✕", "Exit photo mode", () => M.exitPhotoMode());
    document.getElementById("stage").appendChild(o);
    return photoUI;
  }
  function refreshPhotoButtons() {
    if (!photoUI) return;
    photoUI.zoom.innerHTML = `🔍 ×${photo.zoom}`;
    photoUI.filter.innerHTML = `🎞 ${FILTERS[photo.filter].name}`;
  }

  // --- album overlay ---
  let albumEl = null, refreshH = null;
  function albumUI() {
    if (albumEl) return albumEl;
    const o = document.createElement("div");
    o.className = "overlay hidden";
    o.style.zIndex = "19"; // under #toast(20), over touchLayer(15)
    o.innerHTML =
      '<div class="card" style="max-width:520px">' +
        '<h2>🖼 Album <span class="alcap" style="font-size:14px;opacity:.7"></span></h2>' +
        '<div class="almile" style="display:flex;gap:8px;overflow-x:auto;padding:4px 2px 8px"></div>' +
        '<div class="algrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(86px,1fr));gap:8px;max-height:44vh;overflow-y:auto"></div>' +
        '<div style="display:flex;gap:8px;justify-content:center;margin-top:12px">' +
          '<button class="midbtn alc">📷 Photo mode</button>' +
          '<button class="midbtn alx">Close</button>' +
        '</div>' +
      '</div>';
    o.addEventListener("click", e => { if (e.target === o) closeAlbum(); });
    o.querySelector(".alx").addEventListener("click", closeAlbum);
    o.querySelector(".alc").addEventListener("click", () => { closeAlbum(); M.enterPhotoMode(); });
    document.getElementById("stage").appendChild(o);
    albumEl = o;
    return o;
  }
  function renderAlbum() {
    if (!albumEl || !gs) return;
    albumEl.querySelector(".alcap").textContent = `${S.photos.length}/${ALBUM_CAP}`;
    const miles = (DH.museum && Array.isArray(DH.museum.album)) ? DH.museum.album : [];
    const mrow = albumEl.querySelector(".almile");
    mrow.innerHTML = "";
    mrow.style.display = miles.length ? "flex" : "none";
    miles.slice(-12).reverse().forEach(e => {
      const c = document.createElement("div");
      c.style.cssText = "flex:0 0 96px;background:#2a2440;border:1px solid #ffd76b55;border-radius:10px;" +
        "padding:8px 6px;text-align:center;font-size:10px;line-height:1.35";
      c.innerHTML = `<div style="font-size:22px">${e.icon || "⭐"}</div>` +
        `<div style="opacity:.9">${e.label || ""}</div><div style="opacity:.55">day ${e.day}</div>`;
      mrow.appendChild(c);
    });
    const grid = albumEl.querySelector(".algrid");
    grid.innerHTML = "";
    if (!S.photos.length)
      grid.innerHTML = '<div class="hint" style="grid-column:1/-1;padding:16px">No photos yet — enter photo mode and press 📸!</div>';
    S.photos.slice().reverse().forEach(p => {
      const c = document.createElement("div");
      c.style.cssText = "background:#14142a;border-radius:10px;padding:6px;text-align:center;cursor:pointer";
      const i = document.createElement("img");
      i.src = p.img; i.alt = p.cap || "photo";
      i.style.cssText = "width:100%;aspect-ratio:3/2;image-rendering:pixelated;border-radius:6px;background:#000";
      const t = document.createElement("div");
      t.style.cssText = "font-size:10px;opacity:.75;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
      t.textContent = p.cap || `Day ${p.day}`;
      c.appendChild(i); c.appendChild(t);
      c.addEventListener("click", () => openViewer(p.id));
      grid.appendChild(c);
    });
  }
  function openAlbum() {
    if (!gs || !gs.running) { DH.toast("Start playing first!"); return; }
    albumUI().classList.remove("hidden");
    pauseForUI();
    renderAlbum();
    clearInterval(refreshH);
    refreshH = setInterval(renderAlbum, 600); // picks up net snapshots on guests
    log("album_open");
  }
  function closeAlbum() {
    if (albumEl) albumEl.classList.add("hidden");
    clearInterval(refreshH);
    closeViewer();
    if (gs && !isGuest()) gs.paused = false;
  }

  // --- fullscreen photo viewer ---
  let viewerEl = null;
  function viewerUI() {
    if (viewerEl) return viewerEl;
    const o = document.createElement("div");
    o.className = "overlay hidden";
    o.style.zIndex = "21";
    o.innerHTML =
      '<div class="card" style="max-width:420px">' +
        '<img class="vwimg" style="width:100%;image-rendering:pixelated;border-radius:10px;background:#000">' +
        '<div class="vwcap hint" style="margin:10px 0 14px"></div>' +
        '<div style="display:flex;gap:8px;justify-content:center">' +
          '<button class="midbtn vws">📤 Share</button>' +
          '<button class="midbtn vwd">🗑 Delete</button>' +
          '<button class="midbtn vwx">◀️ Back</button>' +
        '</div>' +
      '</div>';
    o.addEventListener("click", e => { if (e.target === o) closeViewer(); });
    o.querySelector(".vwx").addEventListener("click", closeViewer);
    document.getElementById("stage").appendChild(o);
    viewerEl = o;
    return o;
  }
  function openViewer(id) {
    const p = S.photos.find(x => x.id === id);
    if (!p) return;
    const o = viewerUI();
    o._pid = id;
    o.querySelector(".vwimg").src = p.img;
    const f = (FILTERS.find(x => x.id === p.filter) || FILTERS[0]).name;
    o.querySelector(".vwcap").textContent = `${p.cap || "A memory"} · ${f} filter`;
    o.querySelector(".vws").onclick = () => {
      const done = () => DH.toast("Photo copied! Paste it anywhere 📤", 2400);
      if (navigator.clipboard && navigator.clipboard.writeText)
        navigator.clipboard.writeText(p.img).then(done, () => DH.toast("Couldn't copy ☹️"));
      else DH.toast(p.img.slice(0, 60) + "…", 3600);
      log("share");
    };
    o.querySelector(".vwd").onclick = () => { act("deletePhoto", id); closeViewer(); renderAlbum(); };
    o.classList.remove("hidden");
  }
  function closeViewer() { if (viewerEl) viewerEl.classList.add("hidden"); }

  // ---------- menus ----------
  function openMenu() {
    if (!gs || !gs.running) { DH.toast("Start playing first!"); return; }
    const rows = [];
    if (hasCamera()) {
      rows.push({ ico: "📸", label: `Photo mode — ${FILTERS[photo.filter].name} · ×${photo.zoom}`, cb: () => M.enterPhotoMode() });
    } else {
      rows.push({ ico: "📷", label: `Buy a camera — snap memories`, cost: CAMERA_COST, disabled: gs.coins < CAMERA_COST, cb: () => { act("buyCamera"); } });
    }
    rows.push({ ico: "🖼", label: `Album · ${S.photos.length} photo${S.photos.length === 1 ? "" : "s"}`, cb: openAlbum });
    rows.push({ ico: "🚩", label: "Marker shop — flags, stones, torches", cb: openMarkerShop });
    rows.push({ ico: "◀️", label: "Back", cb: () => {} });
    DH.menu.open("📷 Memories", rows);
  }
  function openMarkerShop() {
    const rows = MARKER_DEFS.map(d => ({
      ico: d.ico, cost: d.cost, disabled: gs.coins < d.cost,
      label: `${d.name} · place on a free tile${d.id === "torch" ? ` (${torchCount()}/${TORCH_MAX} lit)` : ""}`,
      cb: () => { act("buyMarker", d.id); openMarkerShop(); },
    }));
    rows.push({ ico: "◀️", label: "Back", cb: openMenu });
    DH.menu.open("🚩 Marker shop", rows);
  }
  function openPlaceMenu(tx, ty) {
    const held = MARKER_DEFS.filter(d => DH.inv.count(d.id) > 0);
    if (!held.length) { DH.toast("No markers in pockets — visit the 📷 marker shop!"); return; }
    DH.menu.open("🚩 Place marker", held.map(d => ({
      ico: d.ico, label: `${d.name} ×${DH.inv.count(d.id)}`,
      cb: () => act("placeMarker", d.id, tx, ty),
    })).concat([{ ico: "◀️", label: "Back", cb: () => {} }]));
  }

  // ---------- module contract ----------
  const M = (DH.memories = {
    authority: true,
    _state: S, // debug/testing handle (not part of the sync contract)

    openMenu, openAlbum, takePhoto,

    init(state) {
      gs = state;
      cvEl = document.getElementById("cv");
      makeChip("📷", "Memories — camera, album, markers", openMenu);
      photoControls();
      window.addEventListener("keydown", e => {
        if (photo.on && e.code === "Escape") {
          M.exitPhotoMode();
          // game.js's handler already ran and toggled pause on — undo it
          if (gs) gs.paused = false;
          const ps = document.getElementById("pauseScreen");
          if (ps) ps.classList.add("hidden");
        }
      });
    },

    start(state) {
      gs = state;
      M.authority = !(DH.net && DH.net.online && DH.net.role === "guest");
      M.exitPhotoMode();
      closeAlbum();
      if (!S.granted) { // P-2: the camera arrives on the first morning
        S.granted = 1;
        if (DH.inv.add("camera", 1) && M.authority)
          DH.toast("📷 A camera arrived in the mail — tap 📷 up top to snap memories!", 3600);
        log("camera_grant");
      }
    },

    enterPhotoMode() {
      if (!gs || !gs.running) return;
      if (!hasCamera()) {
        if (gs.coins >= CAMERA_COST) {
          act("buyCamera");
          // guests: the camera arrives with the next host snapshot — tap again
          if (!hasCamera()) { DH.toast("Camera ordered — tap 📷 again in a moment 📷"); return; }
        } else { DH.toast(`You need a camera — 🪙${CAMERA_COST} in the 📷 menu`); return; }
      }
      if (DH.menu) DH.menu.close();
      closeAlbum();
      photo.on = true;
      refreshPhotoButtons();
      photoControls().el.classList.remove("hidden");
      const hud = document.getElementById("hud");
      if (hud) hud.style.display = "none"; // hide UI chrome for a clean shot
      DH.toast("📷 Photo mode — move to aim · A or 📸 to snap · ✕ to exit", 2600);
      log("photo_on");
    },
    exitPhotoMode() {
      photo.on = false;
      if (photoUI) photoUI.el.classList.add("hidden");
      const hud = document.getElementById("hud");
      if (hud) hud.style.display = "";
    },

    update(dt, state) {
      gs = state;
      // FX is timestamp-driven (flash) so guests animate too — nothing to tick.
    },

    interactables(p) {
      if (photo.on)
        return [{ label: "📸 Take photo", x: p.x, y: p.y, action: () => takePhoto(p) }];
      const out = [];
      for (const m of S.markers) {
        const cx = m.tx * T + 16, cy = m.ty * T + 16;
        if (dist2(p.x, p.y, cx, cy) < INTERACT_R * INTERACT_R) {
          const d = MK[m.mk];
          out.push({ label: `Take up ${d ? d.name : "marker"} ${d ? d.ico : "🚩"}`, x: cx, y: cy, action: () => act("removeMarker", m.id) });
        }
      }
      // place on the tile being faced (or the tile stood on), when pockets hold markers
      const d = DIRV[p.dir] || [0, 0];
      const tx0 = Math.floor(p.x / T), ty0 = Math.floor(p.y / T);
      let tx = tx0 + d[0], ty = ty0 + d[1];
      if (!canPlace(tx, ty)) { tx = tx0; ty = ty0; }
      if (canPlace(tx, ty) && MARKER_DEFS.some(mk => DH.inv.count(mk.id) > 0))
        out.push({ label: "Place marker 🚩", x: tx * T + 16, y: ty * T + 16, action: () => openPlaceMenu(tx, ty) });
      out.sort((a, b) => dist2(p.x, p.y, a.x, a.y) - dist2(p.x, p.y, b.x, b.y));
      return out;
    },

    collectDraws(draws, camX, camY) {
      if (!ctx2) ctx2 = document.getElementById("cv").getContext("2d");
      for (const m of S.markers) {
        const px = m.tx * T - camX, py = m.ty * T - camY;
        draws.push({ y: m.ty * T + T, fn: () => drawMarker(ctx2, m, px, py) });
      }
    },

    drawOverlay(ctx, camX, camY, state) {
      ctx2 = ctx;
      const now = Date.now();
      // torch glow after dark
      if (isNight()) {
        for (const m of S.markers) {
          if (m.mk !== "torch") continue;
          const cx = m.tx * T + 16 - camX, cy = m.ty * T + 8 - camY;
          const fl = 0.85 + Math.sin(now / 140 + m.id * 3) * 0.15;
          const g = ctx.createRadialGradient(cx, cy, 4, cx, cy, 46);
          g.addColorStop(0, `rgba(255,190,90,${0.55 * fl})`);
          g.addColorStop(1, "rgba(255,160,60,0)");
          ctx.fillStyle = g;
          ctx.fillRect(cx - 46, cy - 46, 92, 92);
        }
      }
      // photo-mode viewfinder
      if (photo.on && cvEl) {
        const r = shotRect(), W = ctx.canvas.width, H = ctx.canvas.height;
        ctx.fillStyle = "rgba(8,8,18,0.55)";
        ctx.fillRect(0, 0, W, r.y); ctx.fillRect(0, r.y + r.h, W, H - r.y - r.h);
        ctx.fillRect(0, r.y, r.x, r.h); ctx.fillRect(r.x + r.w, r.y, W - r.x - r.w, r.h);
        const f = FILTERS[photo.filter];
        if (f.tint) { ctx.fillStyle = f.tint; ctx.fillRect(r.x, r.y, r.w, r.h); }
        if (f.mono) { ctx.fillStyle = "rgba(190,190,200,0.20)"; ctx.fillRect(r.x, r.y, r.w, r.h); }
        // thirds grid
        ctx.strokeStyle = "rgba(255,255,255,0.28)"; ctx.lineWidth = 1;
        for (let i = 1; i < 3; i++) {
          ctx.beginPath(); ctx.moveTo(r.x + r.w * i / 3, r.y); ctx.lineTo(r.x + r.w * i / 3, r.y + r.h); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(r.x, r.y + r.h * i / 3); ctx.lineTo(r.x + r.w, r.y + r.h * i / 3); ctx.stroke();
        }
        // corner brackets
        ctx.strokeStyle = "#ffffffee"; ctx.lineWidth = 3;
        const b = 14;
        [[r.x, r.y, 1, 1], [r.x + r.w, r.y, -1, 1], [r.x, r.y + r.h, 1, -1], [r.x + r.w, r.y + r.h, -1, -1]].forEach(([cx, cy, dx, dy]) => {
          ctx.beginPath(); ctx.moveTo(cx + dx * b, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + dy * b); ctx.stroke();
        });
        ctx.font = "bold 12px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
        ctx.fillStyle = "#00000088"; ctx.fillText(`×${photo.zoom} · ${f.name} · 📸 or A to snap`, W / 2 + 1, r.y + r.h + 21);
        ctx.fillStyle = "#ffffffdd"; ctx.fillText(`×${photo.zoom} · ${f.name} · 📸 or A to snap`, W / 2, r.y + r.h + 20);
      }
      // flash FX
      if (now < photo.flashUntil) {
        ctx.fillStyle = `rgba(255,255,255,${(photo.flashUntil - now) / 260})`;
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      }
    },

    // ---------- sync boundary ----------
    serialize() {
      return JSON.parse(JSON.stringify({ photos: S.photos, markers: S.markers, granted: S.granted, nextId: S.nextId }));
    },
    deserialize(d) {
      if (!d) return;
      if (Array.isArray(d.photos))
        S.photos = d.photos.filter(p => p && typeof p.img === "string").slice(-ALBUM_CAP);
      if (Array.isArray(d.markers))
        S.markers = d.markers.filter(m => m && MK[m.mk] && typeof m.tx === "number" && typeof m.ty === "number");
      if (typeof d.granted === "number") S.granted = d.granted;
      if (typeof d.nextId === "number") S.nextId = d.nextId;
    },
    remoteAction(name, args) {
      if (typeof name === "string" && name.startsWith("memories.")) {
        const fn = API[name.slice(9)];
        if (typeof fn === "function") return fn.apply(null, args || []);
      }
      return false;
    },
    offline() { return []; }, // memories don't change while away
  });

  // ---------- marker sprites (pixel-art, consistent with world.js style) ----------
  function drawMarker(ctx, m, px, py) {
    const cx = px + T / 2, base = py + T - 4;
    const R = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
    DH.sprites.shadow(ctx, cx, base, 14);
    switch (m.mk) {
      case "flag": {
        R(cx - 1, base - 25, 2, 25, "#7a4a2a");                    // pole
        R(cx - 2, base - 27, 4, 3, "#c8a050");                    // knob
        for (let i = 0; i < 4; i++)                             // pennant
          R(cx + 1, base - 25 + i * 2, 11 - i * 3, 2, "#e04848");
        R(cx + 1, base - 25, 11, 1, "#ff7a70");
        break;
      }
      case "signpost": {
        R(cx - 2, base - 18, 4, 18, "#7a4a2a");                   // post
        R(cx - 10, base - 24, 17, 8, "#a0733f");                  // board
        R(cx + 7, base - 22, 3, 4, "#a0733f");                    // arrow tip
        R(cx - 10, base - 24, 17, 1, "#c09055");                  // top edge
        R(cx - 8, base - 21, 12, 1, "#7a5527");                   // engraving
        R(cx - 8, base - 19, 9, 1, "#7a5527");
        R(cx - 2, base - 16, 4, 2, "#8a5a34");
        break;
      }
      case "heart-stone": {
        R(cx - 8, base - 10, 16, 10, "#9aa3ad");                  // stone body
        R(cx - 6, base - 12, 12, 3, "#b9c0c4");                   // crown
        R(cx - 8, base - 2, 16, 2, "#7d868e");                    // base shade
        R(cx - 5, base - 10, 3, 2, "#8b9399");                    // crack chip
        DH.sprites.heart(ctx, cx + 1, base - 8, 4.5, "#ff7fa5");  // carved heart
        break;
      }
      case "torch": {
        R(cx - 2, base - 15, 4, 15, "#6e4a2a");                   // stake
        R(cx - 3, base - 17, 6, 3, "#c8a050");                    // wrap
        const fl = Math.sin(Date.now() / 110 + m.id * 7);         // flame flicker
        R(cx - 3, base - 23, 6, 6, "#ff8a2a");                    // outer flame
        R(cx - 2 + (fl > 0 ? 1 : 0), base - 26, 4, 5, "#ffb23a"); // mid flame
        R(cx - 1, base - 22, 2, 3, "#fff0a0");                    // hot core
        break;
      }
    }
  }
})();

DH.register("memories", DH.memories);
