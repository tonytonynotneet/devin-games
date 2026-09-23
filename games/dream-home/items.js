/* dream-home items — shared item catalog + pocket inventory.
   Foundation for every AC-style system (forage/craft/shop/museum/villagers).

   Item catalog: DH.items.def("wood", {name, ico, cat, price, desc})
     cat: material|fruit|fish|bug|sea|fossil|flower|food|tool|furniture|misc
     price: sell value in coins (0 = not sellable)
   Inventory lives on DH.state.inv = [{id,n}] so it serializes with the save
   bus and net snapshots. Pockets are capped (C-3/C-4: expandable).

   DH.register("items", DH.items) at the bottom.
*/
(function () {
  const DH = (window.DH = window.DH || {});
  let gs = null;

  const items = (DH.items = {
    defs: {},
    def(id, spec) { items.defs[id] = Object.assign({ id, ico: "📦", cat: "misc", price: 0, stack: 20 }, spec || {}); return items.defs[id]; },
    get(id) { return items.defs[id]; },
    byCat(cat) { return Object.values(items.defs).filter(d => d.cat === cat); },
    label(id) { const d = items.defs[id]; return d ? `${d.ico} ${d.name}` : id; },
  });

  // ---------- pocket inventory ----------
  const inv = (DH.inv = {
    CAP: 20, // pocket slots; capacity upgrades raise this
    cap() { return (gs && gs.pocketCap) || inv.CAP; },
    list() { return (gs && gs.inv) || []; },
    count(id) { return inv.list().reduce((s, s2) => s + (s2.id === id ? s2.n : 0), 0); },
    add(id, n = 1) {
      if (!gs) return 0;
      gs.inv = gs.inv || [];
      const d = items.get(id); const stack = (d && d.stack) || 20;
      let left = n;
      for (const s of gs.inv) {
        if (s.id === id && s.n < stack) { const t = Math.min(stack - s.n, left); s.n += t; left -= t; }
      }
      while (left > 0 && gs.inv.length < inv.cap()) {
        const t = Math.min(stack, left); gs.inv.push({ id, n: t }); left -= t;
      }
      return n - left; // amount actually added
    },
    remove(id, n = 1) {
      if (!gs || !gs.inv) return 0;
      let left = n;
      for (let i = gs.inv.length - 1; i >= 0 && left > 0; i--) {
        const s = gs.inv[i];
        if (s.id !== id) continue;
        const t = Math.min(s.n, left); s.n -= t; left -= t;
        if (!s.n) gs.inv.splice(i, 1);
      }
      return n - left;
    },
    // total sell value; empties pockets of sellable cats when sell=true
    sellValue(ids) {
      return (ids || inv.list().map(s => s.id)).reduce((v, id) => v + (items.get(id) || { price: 0 }).price * inv.count(id), 0);
    },
    sellAll() {
      let v = 0;
      (gs && gs.inv ? gs.inv.slice() : []).forEach(s => {
        const p = (items.get(s.id) || { price: 0 }).price;
        if (p > 0) { v += p * s.n; inv.remove(s.id, s.n); }
      });
      return v;
    },
  });

  // ---------- starter catalog (shared items; modules add their own) ----------
  items.def("wood", { name: "Wood", ico: "🪵", cat: "material", price: 15 });
  items.def("softwood", { name: "Softwood", ico: "🌲", cat: "material", price: 15 });
  items.def("hardwood", { name: "Hardwood", ico: "🌳", cat: "material", price: 15 });
  items.def("stone", { name: "Stone", ico: "🪨", cat: "material", price: 20 });
  items.def("clay", { name: "Clay", ico: "🧱", cat: "material", price: 25 });
  items.def("iron", { name: "Iron nugget", ico: "⛓️", cat: "material", price: 60 });
  items.def("gold", { name: "Gold nugget", ico: "🪙", cat: "material", price: 300 });
  items.def("apple", { name: "Apple", ico: "🍎", cat: "fruit", price: 100 });
  items.def("bell-bag", { name: "Bell bag", ico: "💰", cat: "misc", price: 0 });
  items.def("weed", { name: "Weeds", ico: "🌿", cat: "material", price: 5 });
  items.def("egg", { name: "Egg", ico: "🥚", cat: "food", price: 40 });
  items.def("milk", { name: "Milk", ico: "🥛", cat: "food", price: 90 });
  items.def("wool", { name: "Wool", ico: "🧶", cat: "material", price: 70 });
  items.def("shell", { name: "Shell", ico: "🐚", cat: "misc", price: 30 });
  items.def("mushroom", { name: "Mushroom", ico: "🍄", cat: "food", price: 80 });
  items.def("star-frag", { name: "Star fragment", ico: "⭐", cat: "material", price: 250 });

  const M = (DH.itemsMod = {
    _name: "items",
    init(state) { gs = state; state.inv = state.inv || []; },
    start(state) { gs = state; state.inv = state.inv || []; },
    serialize() { return { inv: gs && gs.inv || [], pocketCap: gs && gs.pocketCap }; },
    deserialize(d) {
      if (!gs) return;
      if (Array.isArray(d.inv)) gs.inv = d.inv.filter(s => s && items.defs[s.id] || (s && s.id));
      if (d.pocketCap) gs.pocketCap = d.pocketCap;
    },
  });
  DH.register("items", M);
})();
