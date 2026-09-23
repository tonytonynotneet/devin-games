/* dream-home core — module registry + shared save bus.
   Loaded BEFORE every feature module (after sprites.js/world.js).

   Module contract: a feature file ends with
     DH.register("name", DH.name)          // name == property on window.DH
   then the orchestrator auto-dispatches:
     init(state) / start(state) / update(dt,state) /
     drawGround(ctx,camX,camY,state) / collectDraws(draws,camX,camY) /
     drawOverlay(ctx,camX,camY,state) / interactables(player) -> [{label,x,y,r,action}] /
     serialize() -> json / deserialize(data) / remoteAction(name,args)

   Save bus (localStorage 'dreamhome-save'):
     v2 blob = { v:2, savedAt, gs:{happiness,coins,timeMin,day}, mods:{name:serialize()} }
     Modules that persist state expose serialize()/deserialize() and optional
     offline(offMin, res) -> string[] parts for the "while you were away" toast.
     v1 saves ({mod: <animals blob>}) are migrated to mods.animals on load.
     DH.save.now() / DH.save.load() — the registry drives both; modules never
     touch localStorage directly.
*/
(function () {
  const DH = (window.DH = window.DH || {});
  const SAVE_KEY = "dreamhome-save";

  DH._mods = [];
  DH.register = function (name, mod) {
    if (!mod) return mod;
    mod._name = name;
    DH._mods.push(mod);
    return mod;
  };
  DH.modules = () => DH._mods;

  // ---------- shared save ----------
  const save = (DH.save = {
    _gs: null,
    bind(state) { save._gs = state; },

    now() {
      const gs = save._gs;
      if (!gs) return;
      const mods = {};
      for (const m of DH._mods)
        if (m.serialize) { try { mods[m._name] = m.serialize(); } catch (e) {} }
      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify({
          v: 2, savedAt: Date.now(),
          gs: { happiness: gs.happiness, coins: gs.coins, timeMin: gs.timeMin, day: gs.day || 0 },
          mods,
        }));
      } catch (e) {}
    },

    // raw parsed blob (v1 migrated to v2 shape) or null
    load() {
      let d = null;
      try { d = JSON.parse(localStorage.getItem(SAVE_KEY) || "null"); } catch (e) { return null; }
      if (!d) return null;
      if (d.v === 1 && d.mod) d.mods = { animals: d.mod }; // v1 → v2
      if (!d.mods || typeof d.mods !== "object") return null;
      return d;
    },

    // restore gs + each module's slice; returns offline minutes elapsed
    restore(state) {
      const d = save.load();
      if (!d) return 0;
      if (d.gs) {
        if (typeof d.gs.happiness === "number") state.happiness = d.gs.happiness;
        if (typeof d.gs.coins === "number") state.coins = d.gs.coins;
        if (typeof d.gs.timeMin === "number") state.timeMin = d.gs.timeMin;
        if (typeof d.gs.day === "number") state.day = d.gs.day;
      }
      for (const m of DH._mods)
        if (m.deserialize && d.mods[m._name] != null) {
          try { m.deserialize(d.mods[m._name]); } catch (e) {}
        }
      return (Date.now() - (d.savedAt || Date.now())) / 60000;
    },

    // after restore: always let modules apply offline progress (decay/produce);
    // returns summary parts for the "while you were away" toast
    offline(offMin) {
      const parts = [];
      for (const m of DH._mods)
        if (m.offline) {
          try {
            const r = m.offline(offMin);
            if (Array.isArray(r)) parts.push(...r.filter(Boolean));
            else if (typeof r === "string" && r) parts.push(r);
          } catch (e) {}
        }
      return parts;
    },
    offlineSummary(offMin, parts) {
      const hrs = offMin >= 90 ? ` (~${Math.round(offMin / 60)}h away)` : "";
      return `While you were away${hrs}… ${(parts || []).join(" · ") || "all quiet at home"}`;
    },

    clear() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} },

    wire(getAuthority) {
      const persist = () => { if (!getAuthority || getAuthority()) save.now(); };
      document.addEventListener("visibilitychange", () => { if (document.hidden) persist(); });
      window.addEventListener("pagehide", persist);
      window.addEventListener("beforeunload", persist);
    },
  });
})();
