/* dream-home visits module — multiplayer visiting & co-op extras (AC_SPEC N-1..N-6 + O-5).
   Contract with game.js (same as animals.js):
     DH.visits.init(state)         – called once at load
     DH.visits.start(state)        – called when a run starts
     DH.visits.update(dt, state)   – per frame (host sim only; authority-gated)
     DH.visits.interactables(p)    – -> [{label,x,y,action}] for the action key
     DH.visits.collectDraws(draws, camX, camY) – {y,fn} depth-sorted render
     DH.visits.drawOverlay(ctx, camX, camY, state) – topmost draw (ribbon, ghost, fx)
     DH.visits.serialize()/deserialize(data)   – plain-JSON save + net snapshots
     DH.visits.remoteAction(name, args)        – "visits.<fn>" whitelist only
     DH.visits.offline(offMin)     – "while you were away" parts

   The 2-player PeerJS pairing itself lives in net.js / shared/online.js — this
   file adds the social layer ON TOP and never edits net.js. Instead it wraps
   two public seams at init():
     - net._handle  → adds a tiny "visitsEvent" channel ({type:"visitsEvent",
       n, a}) so the host can push toasts/menus to the guest and the guest can
       flush mail it wrote while offline. Both directions share the channel.
     - DH.tryActionAt → guest presses arrive here; a non-best-friend guest is
       blocked from destructive actions (chop / dig up / hit rock …) and both
       sides get an "ask the host" prompt instead (N-1/N-2 gates).

   N-1 Visit ribbon + role gates: when the partner connects, host sees
   "<zuza> is visiting! 🏡", guest sees "visiting <koto>'s island 🏡", and a
   ribbon stays up while they're together.
   N-2 Best friends: S.friends[char] persists; partner menu toggles it. BFFs
   may use destructive tools; non-BFF guests get "ask host" prompts.
   N-3 Mail & gifts: the mailbox sends a pocket item + template note. Online
   partners get it instantly (event + toast); offline partners' parcels wait in
   S.mailbox[char] and deliver on their next join ("1 gift waiting!"). Letters
   are note-only parcels.
   N-4/O-5 Dream couch: while the partner is away, the couch summons a ghost of
   their last-known position/look that wanders and dreams ("dreaming of zuza…").
   While they're here it just says "<name> is here for real 💗".
   N-5 Co-op handshake: tap A near your partner → "Together 👥" menu → pick a
   thing (pull a weed / lift heavy furniture / sit on the bench) → the partner
   sees "koto wants to do X together — tap A!" → their A accepts and both
   celebrate. Double weed pulls and two-person furniture lifts pay a bonus.
   N-6 Party: "Follow me" makes the partner trail ~1.5 tiles behind (they keep
   control whenever they move). While the party is formed every sale pays a
   +10% "party bonus" (wraps DH.inv.sellAll + DH.econ sell APIs).

   All persistent state is JSON-plain in S so serialize()/deserialize() round
   trips through the 'dreamhome-save' v2 blob and net snapshots untouched.
   Guests never run update(); host authority follows DH.visits.authority.
*/
(function () {
  const DH = (window.DH = window.DH || {});
  const T = 32;

  // ---------- tuning ----------
  const TEAM_R = 62;             // px: close enough to partner for Together actions
  const INVITE_TTL = 7;          // s a co-op invite stays open (partner taps A to accept)
  const MAILBOX = { x: 10 * T + 16, y: 11 * T + 16 }; // matches world.js MAILBOX tile
  const MAIL_R = 48;
  const COUCH = { tx: 4, ty: 3 };                     // dream couch tile inside the house
  const COUCH_R = 44;
  const BENCH = { x: 21 * T + 16, y: 15 * T + 16 };   // pond bench (couple.js date spot)
  const NEAR_TARGET = 96;        // px: how near a weed/furniture/bench must be
  const FOLLOW_FAR = 58, FOLLOW_STOP = 44, FOLLOW_SPEED = 170;
  const GHOST_LIFE = 42;         // s a dream ghost wanders before fading
  const PARTY_BONUS = 0.10;      // +10% sell bonus while a party is formed
  const SIT_T = 3.2;             // s both players stay seated
  const DESTRUCTIVE = /chop|dig up|hit rock|smash|demolish|uproot/i;
  const NOTES = [
    "Thinking of you 💗", "Miss you — come home soon 🏡", "Meet me by the pond 🌅",
    "You make this island better ✨", "Dinner's ready 🍽️", "Good night 🌙",
  ];
  // furniture ids wider than one tile — mirror of furniture.js CATALOG w>=2
  const HEAVY = new Set(["rug", "table", "sofa", "bed", "tv", "bathtub", "piano"]);
  const PROTECTED = new Set(["9,9", "9,8", "9,10", "10,9", "5,10", "5,11", "16,5", "16,6"]);

  // ---------- module state (plain JSON only — it is the sync payload) ----------
  const S = {
    friends: { koto: true, zuza: true }, // N-2: BFF map char -> allowed tools
    mailbox: { koto: [], zuza: [] },     // N-3: parcels [{item,n,note,from,fromName,day}]
    dream: {},                           // N-4: char -> {x,y,dir,char,outfit,day}
    ghost: null,                         // live dream ghost {who,x,y,dir,step,moving,tx,ty,until,wait}
    invite: null,                        // N-5: {kind,from,until,data}
    follow: { on: false, leader: 0 },    // N-6: party follow
    sit: [0, 0],                         // per-player "stay seated" timers
    fx: [],                              // {k,x,y,vy,life,max}
  };
  let gs = null, ctx2 = null;
  // transient view state (not serialized)
  const V = { now: 0, wasDuo: false, wasSynced: false, pend: {} };

  // ---------- helpers ----------
  const rnd = (a, b) => a + Math.random() * (b - a);
  const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
  const net = () => DH.net || {};
  const duoActive = () => {
    const n = net();
    if (!n.online) return false;
    return n.role === "host" ? !!n._duo : !!n._synced;
  };
  const isGuest = () => !!(net().online && net().role === "guest");
  const partnerOf = pid => gs && gs.players && gs.players[1 - pid];
  const myChar = pid => (gs && gs.players[pid] && gs.players[pid].char) || (pid === 0 ? "koto" : "zuza");
  const partnerChar = pid => myChar(1 - pid);
  const pname = pid => (gs && gs.players[pid] && gs.players[pid].name) || myChar(pid);
  const otherName = pid => pname(1 - pid);
  function burst(x, y, n = 6, k = "heart") {
    for (let i = 0; i < n && S.fx.length < 60; i++)
      S.fx.push({ k, x: x + rnd(-12, 12), y: y + rnd(-8, 2), vy: -20 - rnd(0, 14), life: 0.9, max: 0.9 });
  }
  // toast on both screens (host sends the guest a visitsEvent)
  function peerToast(msg, ms) {
    DH.toast(msg, ms);
    if (duoActive()) peerSend("toast", { msg, ms });
  }
  // toast aimed at the partner's screen only (local screen unchanged when remote)
  function notifyOther(pid, msg, ms) {
    if (duoActive() && isHost()) peerSend("toast", { msg, ms });
    else if (!net().online) DH.toast(msg, ms); // solo — same screen anyway
    // a remote guest's own messages flow back through host actions, so nothing else needed
  }
  const isHost = () => !net().online || net().role === "host";

  // ---------- visitsEvent channel (peer event bus, both directions) ----------
  function peerSend(n, a) {
    const nn = net();
    if (nn.send) nn.send({ type: "visitsEvent", n, a });
  }
  const PEER = {
    toast({ msg, ms }) { DH.toast(msg, ms); },
    // a menu built host-side opens locally here; picks travel back as visits.menu
    menu({ m, title, opts }) {
      const def = MENUS[m];
      if (!def) return;
      DH.menu.open(title, (opts || []).map(o => ({
        ico: o.ico, label: o.label, cost: o.cost, disabled: !!o.disabled,
        cb: () => DH.net.guestAction("visits.menu", [m, o.key]),
      })));
    },
    mail({ item, n, note, fromName }) {
      const d = item && DH.items.get(item);
      DH.toast(`🎁 ${fromName} sent you ${d ? d.ico + " " + d.name : "a gift"} — "${note}"`, 3800);
    },
    letter({ note, fromName }) {
      DH.toast(`💌 ${fromName} wrote: "${note}"`, 4200);
    },
  };
  function handlePeer(m) {
    if (m && m.type === "visitsEvent" && PEER[m.n]) {
      try { PEER[m.n](m.a || {}); } catch (e) {}
      return true;
    }
    return false;
  }
  function hookNet() {
    const n = net();
    if (!n._handle || n._visitsHook) return;
    n._visitsHook = 1;
    const h0 = n._handle.bind(n);
    n._handle = m => {
      // guest: the first host snapshot means we just joined — flush mail we
      // queued for the host while playing solo, before applySnapshot replaces S
      const pre = n._synced;
      h0(m);
      if (n.role === "guest" && !pre && n._synced) {
        V.wasSynced = true;
        DH.toast(`visiting ${hostName()}'s island 🏡`, 2600);
        flushOutbound();
      }
      if (n.role === "guest" && !n._synced) V.wasSynced = false;
      handlePeer(m);
    };
  }
  function hostName() {
    const st = net().guestState;
    return (st && st.names && st.names[0]) || "koto";
  }
  // guest → host: forward parcels queued while the host was offline
  function flushOutbound() {
    const box = S.mailbox.koto || [];
    if (!box.length) return;
    for (const p of box) DH.net.guestAction("visits.mail", [p]);
    S.mailbox.koto = [];
  }

  // ---------- invite handshake (N-5) ----------
  const KIND_DESC = {
    weed: { desc: "pull weeds together", ico: "🌿" },
    lift: { desc: "lift furniture together", ico: "🛋️" },
    sit: { desc: "sit together", ico: "🪑" },
  };
  const inviteFresh = () => S.invite && V.now < S.invite.until;

  function sendInvite(pid, kind, data) {
    if (inviteFresh() && S.invite.from === 1 - pid && S.invite.kind === kind)
      return completeInvite(pid); // both chose the same thing — instant sync
    S.invite = { kind, from: pid, until: V.now + INVITE_TTL, data: data || {} };
    DH.toast(`Waiting for ${otherName(pid)}…`, 2200);
    notifyOther(pid, `${pname(pid)} wants to ${KIND_DESC[kind].desc} — tap A near them!`, 3800);
    burst(gs.players[pid].x, gs.players[pid].y - 26, 3, "spark");
    return true;
  }
  function acceptInvite(pid) {
    if (!inviteFresh()) return false;
    if (S.invite.from !== 1 - pid) return false;
    completeInvite(pid);
    return true;
  }
  function completeInvite(pid) {
    const inv = S.invite; S.invite = null;
    const [a, b] = gs.players;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    burst(mid.x, mid.y - 26, 10); burst(mid.x, mid.y - 34, 6, "spark");
    if (inv.kind === "weed") {
      let ok = false;
      try { ok = DH.forage && DH.forage.pullWeed(inv.data.tx, inv.data.ty); } catch (e) {}
      if (ok) {
        DH.inv.add("weed", 1); gs.happiness += 3;
        peerToast("🌿🌿 Double pull! Teamwork bonus +🏠3 +extra weeds");
      } else peerToast("Too slow — the weed is gone 🌿");
    } else if (inv.kind === "lift") {
      peerToast("🛋️ Heave-ho! Pick a direction…", 2400);
      V.pend[inv.from] = { uid: inv.data.uid };
      emitMenu(inv.from, "liftDir");
    } else if (inv.kind === "sit") {
      sitTogether();
    }
    return true;
  }
  function sitTogether() {
    const [a, b] = gs.players;
    a.x = BENCH.x - 14; a.y = BENCH.y + 4; a.dir = "right"; a.moving = false;
    b.x = BENCH.x - 14; b.y = BENCH.y + 22; b.dir = "right"; b.moving = false;
    S.sit = [SIT_T, SIT_T];
    gs.happiness += 4;
    peerToast("🪑 Sitting together by the pond — +🏠4 💗", 2800);
  }

  // ---------- heavy lift: move a w>=2 furniture item one tile ----------
  function heavyItems() {
    try {
      const items = (DH.furniture && DH.furniture.serialize().items) || [];
      return items.filter(it => HEAVY.has(it.id));
    } catch (e) { return []; }
  }
  function nearHeavyItem() {
    const ps = gs.players;
    for (const it of heavyItems()) {
      const cx = (it.x0 + 1) * T, cy = (it.y0 + 0.5) * T;
      if (ps.some(p => dist2(p.x, p.y, cx, cy) < NEAR_TARGET * NEAR_TARGET)) return it;
    }
    return null;
  }
  function liftMove(uid, dx, dy, pid) {
    if (!DH.furniture || !gs) return false;
    const snap = DH.furniture.serialize();
    const it = (snap.items || []).find(i => i.uid === uid);
    if (!it) { DH.toast("It's already gone…"); return false; }
    const w = HEAVY.has(it.id) ? 2 : 1;
    const nx = it.x0 + dx, ny = it.y0 + dy;
    // rebuild the occupied set minus this item, like furniture.canPlaceAt
    const occ = new Set();
    for (const o of snap.items) {
      if (o.uid === uid) continue;
      const ow = HEAVY.has(o.id) ? 2 : 1;
      for (let i = 0; i < ow; i++) occ.add((o.x0 + i) + "," + o.y0);
    }
    for (let i = 0; i < w; i++) {
      const tx = nx + i, ty = ny;
      const z = DH.world.zone(tx, ty);
      if (z !== "house" && z !== "yard") { DH.toast("Can't set it there ☹️"); return false; }
      if (DH.world.isBlocked(tx, ty) && !selfTile(it, w, tx, ty)) { DH.toast("Blocked ☹️"); return false; }
      if (occ.has(tx + "," + ty) || PROTECTED.has(tx + "," + ty)) { DH.toast("Blocked ☹️"); return false; }
      for (const p of gs.players)
        if (Math.floor(p.x / T) === tx && Math.floor(p.y / T) === ty) { DH.toast("You're in the way!"); return false; }
    }
    it.x0 = nx; it.y0 = ny;
    DH.furniture.deserialize(snap);
    const x = (nx + w / 2) * T, y = (ny + 0.5) * T;
    burst(x, y - 14, 8, "spark");
    peerToast(`🛋️ Moved the ${it.id} together — nice teamwork!`, 2600);
    return true;
  }
  function selfTile(it, w, tx, ty) {
    return ty === it.y0 && tx >= it.x0 && tx < it.x0 + w;
  }

  // ---------- mail & gifts (N-3) ----------
  function partnerOnlineFor(char) {
    // solo run: both chars are co-present on this screen
    if (!net().online) return true;
    return duoActive();
  }
  function sendMail(parcel, pid) {
    const to = parcel.to === "koto" || parcel.to === "zuza" ? parcel.to : partnerChar(pid);
    const from = myChar(pid);
    const d = parcel.item && DH.items.get(parcel.item);
    if (parcel.item && !d) return false;
    if (d && DH.inv.remove(parcel.item, 1) <= 0) { DH.toast("You don't have that anymore…"); return false; }
    const p = {
      item: parcel.item || null, n: 1, note: String(parcel.note || "hi 💗").slice(0, 80),
      from, fromName: pname(pid), day: (gs && Math.floor(gs.day)) || 0,
    };
    if (partnerOnlineFor(to)) { deliverParcel(to, p); return true; }
    S.mailbox[to] = S.mailbox[to] || [];
    S.mailbox[to].push(p);
    DH.toast(`📮 Saved for ${to === "koto" ? pname(0) : pname(1)} — delivered when they visit!`, 2800);
    return true;
  }
  // hand a parcel to its recipient: item returns to the shared pockets + toast on their screen
  function deliverParcel(to, p) {
    if (p.item) DH.inv.add(p.item, p.n || 1);
    const toPid = to === "koto" ? 0 : 1;
    const remote = toPid === 1 && net().online && net().role === "host" && duoActive();
    if (p.item) {
      if (remote) peerSend("mail", p);
      else DH.toast(`🎁 ${p.fromName} sent ${pname(toPid)} ${DH.items.label(p.item)} — "${p.note}"`, 3600);
    } else {
      if (remote) peerSend("letter", p);
      else DH.toast(`💌 ${p.fromName} wrote to ${pname(toPid)}: "${p.note}"`, 4000);
    }
  }
  // host: when zuza joins, hand over everything queued for her
  function flushMailbox(char) {
    const box = S.mailbox[char] || [];
    if (!box.length) return;
    S.mailbox[char] = [];
    peerToast(`📮 ${box.length} gift${box.length > 1 ? "s" : ""} waiting at the mailbox!`, 3600);
    box.forEach(p => deliverParcel(char, p));
  }
  function pendingFor(pid) { return (S.mailbox[myChar(pid)] || []).length; }

  // ---------- menus (host-built; reach the guest via visitsEvent) ----------
  // MENUS[id].build(pid) -> {title, opts:[{ico,label,cost,disabled,key}]}
  // MENUS[id].pick(key, pid) -> runs the chosen action (host-side for everyone)
  const MENUS = {
    team: {
      build(pid) {
        const pc = partnerChar(pid);
        const weed = nearWeed();
        const heavy = nearHeavyItem();
        const benchOk = gs.players.every(p => dist2(p.x, p.y, BENCH.x, BENCH.y) < NEAR_TARGET * NEAR_TARGET * 2.4);
        const opts = [];
        if (DH.couple && DH.couple.hug) opts.push({ ico: "🤗", label: `Hug ${otherName(pid)}`, key: "hug" });
        opts.push({ ico: "🌿", label: "Pull weeds together", key: "weed", disabled: !weed });
        opts.push({ ico: "🛋️", label: "Lift furniture together", key: "lift", disabled: !heavy });
        opts.push({ ico: "🪑", label: "Sit on the bench together", key: "sit", disabled: !benchOk });
        opts.push({ ico: "🚩", label: S.follow.on ? "Stop following 💞" : "Follow me — party mode!", key: "follow" });
        opts.push({ ico: "💗", label: `Best friend ${S.friends[pc] ? "ON — tools ok" : "off"}`, key: "bff" });
        return { title: `👥 ${pname(pid)} ♥ ${otherName(pid)}`, opts };
      },
      pick(key, pid) {
        if (key === "hug") return DH.couple && DH.couple.hug(pid);
        if (key === "bff") return toggleBff(pid);
        if (key === "follow") return toggleFollow(pid);
        if (key === "weed") {
          const w = nearWeed();
          return w ? sendInvite(pid, "weed", { tx: w.tx, ty: w.ty }) : false;
        }
        if (key === "lift") {
          const it = nearHeavyItem();
          return it ? sendInvite(pid, "lift", { uid: it.uid }) : false;
        }
        if (key === "sit") return sendInvite(pid, "sit", {});
        return false;
      },
    },
    mailbox: {
      build(pid) {
        const n = pendingFor(pid);
        return {
          title: "📮 Mailbox",
          opts: [
            { ico: "🎁", label: "Send a gift…", key: "gift", disabled: !(gs.inv || []).length },
            { ico: "💌", label: "Write a letter…", key: "letter" },
            { ico: "📬", label: `Check mailbox${n ? ` — ${n} waiting!` : ""}`, key: "check" },
          ],
        };
      },
      pick(key, pid) {
        if (key === "gift") return emitMenu(pid, "giftItem");
        if (key === "letter") return emitMenu(pid, "letterNote");
        if (key === "check") {
          const box = S.mailbox[myChar(pid)] || [];
          if (!box.length) { DH.toast("📭 No mail waiting"); return false; }
          S.mailbox[myChar(pid)] = [];
          box.forEach(p => deliverParcel(myChar(pid), p));
          return true;
        }
        return false;
      },
    },
    giftItem: {
      build(pid) {
        const opts = (gs.inv || []).map(s => {
          const d = DH.items.get(s.id) || { ico: "📦", name: s.id };
          return { ico: d.ico, label: `${d.name} ×${s.n}`, key: s.id };
        });
        return { title: "🎁 Pick a gift", opts };
      },
      pick(key, pid) {
        V.pend[pid] = { item: key };
        return emitMenu(pid, "giftNote");
      },
    },
    giftNote: {
      build(pid) {
        return { title: "💌 Add a note", opts: NOTES.map(n => ({ ico: "💌", label: n, key: n })) };
      },
      pick(key, pid) {
        const item = V.pend[pid] && V.pend[pid].item; V.pend[pid] = null;
        return sendMail({ item, note: key, to: partnerChar(pid) }, pid);
      },
    },
    letterNote: {
      build(pid) {
        return { title: "💌 Write a letter", opts: NOTES.map(n => ({ ico: "💌", label: n, key: n })) };
      },
      pick(key, pid) {
        return sendMail({ item: null, note: key, to: partnerChar(pid) }, pid);
      },
    },
    couch: {
      build(pid) {
        const online = partnerOnlineFor(partnerChar(pid));
        const name = otherName(pid);
        return {
          title: "🛋️ Dream couch",
          opts: [
            online
              ? { ico: "💗", label: `${name} is here for real 💗`, disabled: true, key: "real" }
              : { ico: "🌙", label: `Visit ${name}'s dream…`, key: "dream" },
            { ico: "💤", label: "Rest a while", key: "rest" },
          ],
        };
      },
      pick(key, pid) {
        if (key === "dream") return spawnGhost(pid);
        if (key === "rest") {
          gs.happiness += 1;
          burst(gs.players[pid].x, gs.players[pid].y - 24, 3, "zzz");
          DH.toast("💤 Cozy… +🏠1");
          return true;
        }
        return false;
      },
    },
    liftDir: {
      build(pid) {
        return {
          title: "🛋️ Move it…",
          opts: [
            { ico: "⬅️", label: "Left", key: "-1,0" }, { ico: "➡️", label: "Right", key: "1,0" },
            { ico: "⬆️", label: "Up", key: "0,-1" }, { ico: "⬇️", label: "Down", key: "0,1" },
          ],
        };
      },
      pick(key, pid) {
        const uid = V.pend[pid] && V.pend[pid].uid; V.pend[pid] = null;
        const [dx, dy] = key.split(",").map(Number);
        return liftMove(uid, dx, dy, pid);
      },
    },
  };
  // open a menu for pid — locally when they're on this screen, via event for the remote guest
  function emitMenu(pid, m) {
    const def = MENUS[m] && MENUS[m].build(pid);
    if (!def) return false;
    if (pid === 1 && net().online && net().role === "host" && duoActive()) {
      peerSend("menu", { m, title: def.title, opts: def.opts.map(o => ({ ico: o.ico, label: o.label, cost: o.cost, disabled: !!o.disabled, key: o.key })) });
      return true;
    }
    DH.menu.open(def.title, def.opts.map(o => ({
      ico: o.ico, label: o.label, cost: o.cost, disabled: !!o.disabled,
      cb: () => MENUS[m].pick(o.key, pid),
    })));
    return true;
  }

  function toggleBff(pid) {
    const pc = partnerChar(pid);
    S.friends[pc] = !S.friends[pc];
    const on = S.friends[pc];
    peerToast(on ? `💗 ${otherName(pid)} is a best friend — tools free to use!` : `💔 ${otherName(pid)} is no longer a best friend — tools restricted`, 2800);
    return true;
  }
  function toggleFollow(pid) {
    if (!S.follow.on) {
      S.follow = { on: true, leader: pid };
      peerToast(`🚩 ${pname(pid)} leads — follow the leader! (+10% party sell bonus)`, 3200);
    } else {
      S.follow.on = false;
      peerToast("💞 Party strolling done");
    }
    return true;
  }

  // ---------- dream ghost (N-4 / O-5) ----------
  function spawnGhost(pid) {
    const who = partnerChar(pid);
    const d = S.dream[who];
    const spot = d && DH.world.canStand(d.x, d.y) ? d : { x: gs.players[pid].x, y: gs.players[pid].y, dir: "down" };
    S.ghost = {
      who, x: spot.x, y: spot.y, dir: spot.dir || "down", step: 0, moving: false,
      tx: spot.x, ty: spot.y, wait: 0.4, until: V.now + GHOST_LIFE,
    };
    const zone = d ? DH.world.zone(Math.floor(d.x / T), Math.floor(d.y / T)) : "here";
    peerToast(`🌙 dreaming of ${d && d.name ? d.name : who}… last seen at the ${zone}, day ${d ? d.day : "—"}`, 3600);
    return true;
  }
  function wanderGhost(dt) {
    const g = S.ghost;
    if (!g) return;
    if (g.moving) {
      const dx = g.tx - g.x, dy = g.ty - g.y, d = Math.hypot(dx, dy);
      if (d < 4) { g.moving = false; g.wait = rnd(0.8, 2.4); }
      else {
        const sp = 34 * dt;
        const nx = g.x + (dx / d) * sp, ny = g.y + (dy / d) * sp;
        if (DH.world.canStand(nx, g.y)) g.x = nx;
        if (DH.world.canStand(g.x, ny)) g.y = ny;
        g.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up");
        g.step += dt * 5;
      }
    } else {
      g.wait -= dt;
      if (g.wait <= 0) {
        g.tx = Math.max(40, Math.min(DH.world.W * T - 40, g.x + rnd(-110, 110)));
        g.ty = Math.max(40, Math.min(DH.world.H * T - 40, g.y + rnd(-70, 70)));
        if (DH.world.canStand(g.tx, g.ty)) g.moving = true;
        else g.wait = 0.6;
      }
    }
  }

  // ---------- weeds proximity ----------
  function nearWeed() {
    try {
      const weeds = (DH.forage && DH.forage.serialize().weeds) || [];
      for (const w of weeds) {
        const cx = w.tx * T + 16 + (w.ox || 0), cy = w.ty * T + 16 + (w.oy || 0);
        if (gs.players.some(p => dist2(p.x, p.y, cx, cy) < NEAR_TARGET * NEAR_TARGET)) return w;
      }
    } catch (e) {}
    return null;
  }

  // ---------- init wiring ----------
  function wrapTryActionAt() {
    if (!DH.tryActionAt || DH.tryActionAt._visitsWrap) return;
    const base = DH.tryActionAt;
    const wrapped = function (x, y) {
      if (net().online && net().role === "host" && duoActive()) {
        const guestChar = myChar(1);
        if (!S.friends[guestChar]) {
          const fake = { x, y, pid: 1 };
          let acts = [];
          for (const m of DH._mods) {
            if (!m.interactables) continue;
            try { acts.push(...m.interactables(fake)); } catch (e) {}
          }
          // nearestActions runs acts[0] in module order (no distance sort) —
          // mirror that exactly so we gate the very act that would execute
          const top = acts[0];
          if (top && DESTRUCTIVE.test(top.label)) {
            DH.toast(`${pname(1)} tried “${top.label}” — best friends only 💗`, 2800);
            peerSend("toast", { msg: `Ask ${pname(0)} to add you as a best friend first 💗`, ms: 3400 });
            return false;
          }
        }
      }
      return base(x, y);
    };
    wrapped._visitsWrap = 1;
    DH.tryActionAt = wrapped;
  }
  // +10% party bonus on any sale that puts coins into state.coins
  function wrapSell(obj, fn) {
    if (!obj || typeof obj[fn] !== "function" || obj["__pv_" + fn]) return;
    obj["__pv_" + fn] = 1;
    const base = obj[fn].bind(obj);
    obj[fn] = function (...args) {
      const before = gs ? gs.coins : 0;
      const r = base(...args);
      if (S.follow.on && gs && gs.coins > before) {
        const bonus = Math.max(1, Math.floor((gs.coins - before) * PARTY_BONUS));
        gs.coins += bonus;
        DH.toast(`👥 Party bonus +🪙${bonus}`, 1800);
      }
      return r;
    };
  }
  function wrapSells() {
    wrapSell(DH.inv, "sellAll");
    if (DH.econ) {
      wrapSell(DH.econ, "sellAll"); wrapSell(DH.econ, "sellOne"); wrapSell(DH.econ, "dumpBin");
      wrapSell(DH.econ, "remoteAction"); // guest sales run through here
    }
  }

  // ---------- drawing ----------
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function drawCouch(ctx, x, y) {
    const R = (rx, ry, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x + rx, y + ry, w, h); };
    R(2, 8, 28, 12, "#7a5a8e");           // back
    R(0, 16, 32, 8, "#8e6aa5");           // seat
    R(0, 24, 6, 8, "#5e4470"); R(26, 24, 6, 8, "#5e4470"); // legs
    R(0, 12, 5, 12, "#6a4e80"); R(27, 12, 5, 12, "#6a4e80"); // arms
    R(7, 17, 9, 6, "#c9a5e0"); R(17, 17, 9, 6, "#c9a5e0");  // cushions
    DH.sprites.heart(ctx, x + 16, y + 6, 3.2, "#ff9ec4");   // little moon pillow mark
    ctx.font = "bold 7px sans-serif"; ctx.textAlign = "center";
    ctx.fillStyle = "#e8d8f5"; ctx.fillText("☾", x + 16, y + 8);
  }
  function drawRibbon(ctx, txt) {
    ctx.save();
    ctx.font = "bold 10px sans-serif";
    const w = ctx.measureText(txt).width + 26;
    const x = (ctx.canvas.width - w) / 2, y = 27;
    ctx.fillStyle = "rgba(24,14,34,0.78)"; rr(ctx, x, y, w, 17, 8); ctx.fill();
    ctx.strokeStyle = "rgba(255,158,196,0.7)"; ctx.lineWidth = 1;
    rr(ctx, x + 0.5, y + 0.5, w - 1, 16, 8); ctx.stroke();
    ctx.fillStyle = "#ffd7ea"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(txt, ctx.canvas.width / 2, y + 9);
    ctx.restore();
  }
  function drawSpark(ctx, x, y, s) {
    ctx.fillStyle = "#ffe08a";
    ctx.beginPath();
    ctx.moveTo(x, y - s);
    ctx.quadraticCurveTo(x + s * 0.18, y - s * 0.18, x + s, y);
    ctx.quadraticCurveTo(x + s * 0.18, y + s * 0.18, x, y + s);
    ctx.quadraticCurveTo(x - s * 0.18, y + s * 0.18, x - s, y);
    ctx.quadraticCurveTo(x - s * 0.18, y - s * 0.18, x, y - s);
    ctx.fill();
  }
  function drawZzz(ctx, x, y) {
    ctx.font = "bold 8px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#dfe8ff"; ctx.fillText("z", x + 3, y - 2);
    ctx.font = "bold 6px sans-serif"; ctx.fillText("z", x + 7, y - 7);
  }

  // ---------- module contract ----------
  const M = (DH.visits = {
    authority: true,
    _state: S, // debug/testing handle

    init(state) {
      gs = state;
      ctx2 = document.getElementById("cv").getContext("2d");
      if (DH.world && DH.world.blocked) DH.world.blocked.add(COUCH.tx + "," + COUCH.ty);
      hookNet();
      wrapTryActionAt();
      wrapSells();
    },

    start(state) {
      gs = state;
      M.authority = !(net().online && net().role === "guest");
      S.invite = null; S.ghost = null; S.fx = []; S.sit = [0, 0];
      S.follow = { on: false, leader: 0 };
      V.now = 0; V.wasDuo = false; V.pend = {};
    },

    update(dt, state) {
      gs = state;
      V.now += dt;
      // FX always tick so remote clients still animate
      for (const f of S.fx) { f.y += f.vy * dt; f.life -= dt; }
      S.fx = S.fx.filter(f => f.life > 0);
      if (!M.authority) return;

      // N-1: partner just joined — welcome toast + deliver queued mail
      const duo = net().online && net().role === "host" && !!net()._duo;
      if (duo && !V.wasDuo) {
        DH.toast(`${pname(1)} is visiting! 🏡`, 3000);
        peerSend("toast", { msg: `visiting ${pname(0)}'s island 🏡`, ms: 3000 });
        flushMailbox(myChar(1));
      }
      if (!duo && V.wasDuo) { S.follow.on = false; S.invite = null; }
      V.wasDuo = duo;

      // N-4: keep the partner's last-known spot for the dream couch
      const o = gs.players[1];
      if (o) {
        S.dream[o.char] = {
          x: Math.round(o.x), y: Math.round(o.y), dir: o.dir, char: o.char,
          outfit: o.char, name: o.name, day: Math.floor(gs.day || 0),
        };
      }

      // N-5: invite expiry
      if (S.invite && V.now >= S.invite.until) S.invite = null;

      // N-6: party follow — the follower keeps control while they steer themselves
      if (S.follow.on && gs.players[0] && gs.players[1]) {
        const L = gs.players[S.follow.leader], F = gs.players[1 - S.follow.leader];
        const kin = (DH.inp && DH.inp[F.pid]) || {};
        const steering = kin.l || kin.r || kin.u || kin.d;
        const dx = L.x - F.x, dy = L.y - F.y, d = Math.hypot(dx, dy);
        if (!steering && d > FOLLOW_FAR) {
          const far = d > NEAR_TARGET; // rubber-band: skip collision when way behind
          const sp = Math.min(far ? FOLLOW_SPEED * 3 : FOLLOW_SPEED, (d - FOLLOW_STOP) * 6) * dt;
          const nx = F.x + (dx / d) * sp, ny = F.y + (dy / d) * sp;
          if (far || DH.world.canStand(nx, F.y)) F.x = nx;
          if (far || DH.world.canStand(F.x, ny)) F.y = ny;
          F.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up");
          F.moving = true; F.step += dt * 7;
        }
      }

      // sit timers pin both players while the bench scene plays
      for (const p of gs.players)
        if (S.sit[p.pid] > 0) { S.sit[p.pid] = Math.max(0, S.sit[p.pid] - dt); p.moving = false; }

      // dream ghost wandering
      if (S.ghost && V.now >= S.ghost.until) S.ghost = null;
      else if (S.ghost) wanderGhost(dt);
    },

    interactables(p) {
      if (!gs || !p || p.pid == null) return [];
      const out = [];
      const o = partnerOf(p.pid);
      // N-4/O-5 dream couch
      if (dist2(p.x, p.y, COUCH.tx * T + 16, COUCH.ty * T + 22) < COUCH_R * COUCH_R)
        out.push({ label: "Dream couch 🛋️", x: COUCH.tx * T + 16, y: COUCH.ty * T + 22, action: () => emitMenu(p.pid, "couch") });
      // N-3 mailbox
      if (dist2(p.x, p.y, MAILBOX.x, MAILBOX.y) < MAIL_R * MAIL_R)
        out.push({ label: "Mailbox 📮", x: MAILBOX.x, y: MAILBOX.y, action: () => emitMenu(p.pid, "mailbox") });
      if (!o) return out.sort((a, b) => dist2(p.x, p.y, a.x, a.y) - dist2(p.x, p.y, b.x, b.y));
      // N-5 invites: accept shows at the partner AND at the action target
      if (inviteFresh() && S.invite.from !== p.pid) {
        const inv = S.invite, kd = KIND_DESC[inv.kind];
        let ax = o.x, ay = o.y;
        if (inv.kind === "weed" && inv.data) { ax = inv.data.tx * T + 16; ay = inv.data.ty * T + 16; }
        else if (inv.kind === "lift") {
          const it = heavyItems().find(i => i.uid === inv.data.uid);
          if (it) { ax = (it.x0 + 1) * T; ay = (it.y0 + 0.5) * T; }
        } else if (inv.kind === "sit") { ax = BENCH.x; ay = BENCH.y; }
        if (dist2(p.x, p.y, ax, ay) < NEAR_TARGET * NEAR_TARGET ||
            dist2(p.x, p.y, o.x, o.y) < TEAM_R * TEAM_R)
          out.push({ label: `Accept: ${kd.ico} ${kd.desc} 👥`, x: ax, y: ay, action: () => acceptInvite(p.pid) });
      }
      // partner context menu — couple's "Let go" keeps priority while hands are held
      if (dist2(p.x, p.y, o.x, o.y) < TEAM_R * TEAM_R) {
        let letGo = false;
        try {
          const ca = (DH.couple && DH.couple.interactables(p)) || [];
          letGo = ca.some(a => /let go/i.test(a.label));
        } catch (e) {}
        if (!letGo)
          out.push({ label: "Together 👥", x: o.x, y: o.y, action: () => emitMenu(p.pid, "team") });
      }
      out.sort((a, b) => dist2(p.x, p.y, a.x, a.y) - dist2(p.x, p.y, b.x, b.y));
      return out;
    },

    collectDraws(draws, camX, camY) {
      draws.push({ y: COUCH.ty * T + T, fn: () => drawCouch(ctx2, COUCH.tx * T - camX, COUCH.ty * T - camY) });
      const g = S.ghost;
      if (g) {
        draws.push({
          y: g.y, fn: () => {
            ctx2.save();
            ctx2.globalAlpha = 0.42;
            DH.sprites.shadow(ctx2, g.x - camX, g.y - camY);
            DH.sprites.drawChar(ctx2, g.x - camX, g.y - camY, g.who === "zuza" ? "zuza" : "koto", g.dir, g.moving ? g.step : 0);
            ctx2.restore();
          },
        });
      }
    },

    drawOverlay(ctx, camX, camY, state) {
      ctx2 = ctx;
      if (!state || !state.running) return;
      // N-1 visiting ribbon
      if (duoActive()) {
        const t = net().role === "host"
          ? `${pname(1)} is visiting 🏡`
          : `visiting ${pname(0)}'s island 🏡`;
        drawRibbon(ctx, t);
      } else if (S.follow.on) drawRibbon(ctx, "🚩 party mode");
      // pending-invite bubble over the inviter's partner
      if (inviteFresh()) {
        const src = gs.players[S.invite.from], o = gs.players[1 - S.invite.from];
        if (src && o) {
          const sx = o.x - camX, sy = o.y - 46 - camY + Math.sin(V.now * 5) * 2;
          ctx.font = "bold 13px sans-serif"; ctx.textAlign = "center";
          ctx.fillText("👥", sx, sy);
        }
      }
      // dreaming caption + zzz over the ghost
      const g = S.ghost;
      if (g) {
        const sx = g.x - camX, sy = g.y - camY;
        ctx.font = "bold 9px sans-serif"; ctx.textAlign = "center";
        ctx.fillStyle = "#00000088"; ctx.fillText(`dreaming of ${(S.dream[g.who] && S.dream[g.who].name) || g.who}…`, sx + 1, sy - 39);
        ctx.fillStyle = "#cfe0ff"; ctx.fillText(`dreaming of ${(S.dream[g.who] && S.dream[g.who].name) || g.who}…`, sx, sy - 40);
        drawZzz(ctx, sx, sy - 26);
      }
      // fx
      for (const f of S.fx) {
        ctx.globalAlpha = Math.max(0, f.life / f.max);
        const x = f.x - camX, y = f.y - camY;
        if (f.k === "heart") DH.sprites.heart(ctx, x, y, 5);
        else if (f.k === "spark") drawSpark(ctx, x, y, 5);
        else drawZzz(ctx, x, y);
        ctx.globalAlpha = 1;
      }
    },

    // ---------- sync boundary ----------
    serialize() {
      return JSON.parse(JSON.stringify({
        friends: S.friends, mailbox: S.mailbox, dream: S.dream, ghost: S.ghost,
        invite: S.invite, follow: S.follow, sit: S.sit, fx: S.fx,
      }));
    },
    deserialize(d) {
      if (!d) return;
      if (d.friends && typeof d.friends === "object") S.friends = Object.assign({ koto: true, zuza: true }, d.friends);
      if (d.mailbox && typeof d.mailbox === "object") {
        S.mailbox = { koto: [], zuza: [] };
        for (const k of ["koto", "zuza"]) if (Array.isArray(d.mailbox[k])) S.mailbox[k] = d.mailbox[k];
      }
      if (d.dream && typeof d.dream === "object") S.dream = d.dream;
      S.ghost = d.ghost || null;
      S.invite = d.invite || null;
      S.follow = d.follow && typeof d.follow === "object" ? { on: !!d.follow.on, leader: d.follow.leader | 0 } : { on: false, leader: 0 };
      S.sit = Array.isArray(d.sit) ? d.sit.slice(0, 2) : [0, 0];
      if (Array.isArray(d.fx)) S.fx = d.fx;
    },
    remoteAction(name, args) {
      if (typeof name !== "string" || !name.startsWith("visits.")) return false;
      const n = name.slice(7);
      if (n === "menu" && Array.isArray(args)) return MENUS[args[0]] ? MENUS[args[0]].pick(args[1], 1) : false;
      if (n === "mail" && Array.isArray(args)) return sendMail(args[0] || {}, 1);
      return false;
    },

    offline(offMin) {
      const parts = [];
      const n = (S.mailbox.koto || []).length + (S.mailbox.zuza || []).length;
      if (n) parts.push(`${n} parcel${n > 1 ? "s" : ""} waiting at the mailbox 📮`);
      return parts;
    },

    // exposed for remoteAction + tests/console
    sendInvite, acceptInvite, sendMail, toggleBff, toggleFollow, spawnGhost, liftMove, emitMenu,
  });
})();

DH.register("visits", DH.visits);
