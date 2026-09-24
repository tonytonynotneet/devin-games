// Level definitions. Ground surface is GY=600 in world space; structures are
// described as height-above-ground ("base") so stacking reads naturally.
// Shapes: 'sq' 40x40, 'pl' 22x78 pillar, 'plh' 78x22 short beam,
// 'beam' 118x22 beam (spans an ~80px pillar gap + overhang), 'tri' 46x40 roof.
(() => {
'use strict';
const AB = window.AB = window.AB || {};

const GY = 600;
const DIM = { sq: [40, 40], pl: [22, 78], plh: [78, 22], beam: [118, 22], tri: [46, 40] };
const S = (mat, shape, x, base, ang = 0) => {
  const [w, h] = DIM[shape];
  return { mat, shape, x, base, w, h, ang };
};
const P = (x, base, variant = 'plain') => ({ x, base, variant });

AB.LEVELS = [
  {
    name: 'FIRST FLING', theme: 'day',
    birds: ['koto', 'koto', 'koto'],
    blocks: [
      S('wood', 'pl', 770, 0), S('wood', 'pl', 850, 0),   // pillars 80 apart
      S('wood', 'beam', 810, 78),                        // 116-wide beam over both tops
    ],
    pigs: [P(810, 0)],
    stars: [15000, 22000, 32000],
  },
  {
    name: 'ICE BREAKER', theme: 'day',
    birds: ['koto', 'zuza', 'koto'],
    blocks: [
      S('ice', 'pl', 720, 0), S('ice', 'pl', 780, 0), S('ice', 'plh', 750, 78),
      S('wood', 'pl', 880, 0), S('wood', 'pl', 940, 0), S('wood', 'plh', 910, 78),
      S('ice', 'sq', 910, 100),
    ],
    pigs: [P(750, 0), P(910, 0)],
    stars: [20000, 30000, 42000],
  },
  {
    name: 'WOOD FORT', theme: 'day',
    birds: ['koto', 'koto-dash', 'koto', 'zuza'],
    blocks: [
      S('wood', 'pl', 790, 0), S('wood', 'pl', 870, 0),
      S('wood', 'beam', 830, 78),
      S('wood', 'pl', 800, 100), S('wood', 'pl', 860, 100),
      S('wood', 'plh', 830, 178),
      S('wood', 'tri', 830, 200),
      S('ice', 'pl', 680, 0), S('ice', 'plh', 715, 78),
    ],
    pigs: [P(830, 0), P(830, 100, 'helmet'), P(715, 0)],
    stars: [28000, 40000, 55000],
  },
  {
    name: 'STONE COLD', theme: 'day',
    birds: ['zuza-bomb', 'koto-dash', 'koto', 'zuza'],
    blocks: [
      S('stone', 'pl', 790, 0), S('stone', 'pl', 870, 0),
      S('stone', 'beam', 830, 78),
      S('ice', 'pl', 800, 100), S('ice', 'pl', 860, 100),
      S('wood', 'plh', 830, 178),
      S('stone', 'sq', 700, 0), S('stone', 'sq', 960, 0),
    ],
    pigs: [P(830, 0), P(830, 100), P(960, 40)],
    stars: [26000, 40000, 56000],
  },
  {
    name: 'SKYLINE', theme: 'night',
    birds: ['koto-dash', 'zuza', 'koto', 'zuza-bomb'],
    blocks: [
      // west tower
      S('wood', 'pl', 720, 0), S('wood', 'pl', 720, 78), S('ice', 'sq', 720, 156),
      // east tower
      S('wood', 'pl', 920, 0), S('wood', 'pl', 920, 78), S('ice', 'sq', 920, 156),
      // low middle hut
      S('ice', 'pl', 790, 0), S('ice', 'pl', 850, 0), S('ice', 'plh', 820, 78),
    ],
    pigs: [P(820, 0), P(720, 196), P(920, 196)],
    stars: [34000, 50000, 68000],
  },
  {
    name: "CLERK'S OFFICE", theme: 'day',
    birds: ['koto', 'koto-dash', 'zuza', 'zuza-bomb'],
    blocks: [
      S('stone', 'pl', 750, 0), S('stone', 'pl', 850, 0),   // wide lobby
      S('wood', 'beam', 800, 78),                          // beam covers both tops (711-889 vs tops 739-861)
      S('wood', 'pl', 765, 100), S('wood', 'pl', 835, 100),
      S('wood', 'plh', 800, 178),
      S('ice', 'pl', 780, 200), S('ice', 'pl', 820, 200),
      S('stone', 'plh', 800, 278),
      // annex
      S('ice', 'pl', 960, 0), S('ice', 'pl', 1020, 0), S('wood', 'plh', 990, 78),
    ],
    pigs: [P(800, 0), P(800, 100, 'helmet'), P(800, 200, 'stash'), P(990, 0)],
    stars: [40000, 58000, 78000],
  },
  {
    name: 'TWIN TOWERS', theme: 'day',
    birds: ['zuza', 'koto-dash', 'zuza-bomb', 'koto', 'koto'],
    blocks: [
      // west fort
      S('stone', 'pl', 700, 0), S('stone', 'pl', 780, 0),
      S('wood', 'beam', 740, 78),
      S('ice', 'sq', 740, 100),
      // east fort
      S('wood', 'pl', 960, 0), S('wood', 'pl', 960, 78),
      S('ice', 'pl', 1020, 0), S('ice', 'pl', 1020, 78),
      S('stone', 'beam', 990, 156),
      // center bunker
      S('stone', 'sq', 870, 0), S('ice', 'sq', 870, 40),
    ],
    pigs: [P(740, 0), P(740, 140, 'helmet'), P(870, 80), P(990, 0), P(990, 100)],
    stars: [42000, 62000, 85000],
  },
  {
    name: 'FINAL FORTRESS', theme: 'night',
    birds: ['koto', 'koto-dash', 'zuza', 'zuza-bomb', 'koto'],
    blocks: [
      // castle: 3 stone pillars + 2 stone beams
      S('stone', 'pl', 740, 0), S('stone', 'pl', 820, 0), S('stone', 'pl', 900, 0),
      S('stone', 'beam', 780, 78), S('stone', 'beam', 860, 78),
      // wood upper floor
      S('wood', 'pl', 780, 100), S('wood', 'pl', 860, 100),
      S('wood', 'beam', 820, 178),
      // ice crown
      S('ice', 'pl', 790, 200), S('ice', 'pl', 850, 200),
      S('stone', 'plh', 820, 278),
      S('wood', 'tri', 820, 300),
      // flanks
      S('ice', 'pl', 660, 0), S('ice', 'sq', 660, 78),
      S('wood', 'pl', 990, 0), S('ice', 'sq', 990, 78),
      // rampart
      S('wood', 'pl', 1090, 0), S('wood', 'pl', 1090, 78), S('ice', 'plh', 1090, 156),
    ],
    pigs: [P(780, 0), P(860, 0), P(820, 100, 'helmet'), P(820, 200, 'stash'), P(990, 0), P(1090, 0, 'helmet')],
    stars: [55000, 80000, 110000],
  },
];

// ---------- generated levels 9-100: 10 tiers of rising difficulty ----------
// Deterministic (seeded) so everyone plays the same 100 stages.
const mulberry = s => () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (r, a) => a[(r() * a.length) | 0];
const LV_NAME_A = ['NEON', 'PIGGY', 'SKY', 'RUSTY', 'TWIN', 'LUCKY', 'CYBER', 'MISTY', 'STONE', 'GLASS'];
const LV_NAME_B = ['ALLEY', 'HUT', 'TOWER', 'YARD', 'FORT', 'BRIDGE', 'DEN', 'SPIRE', 'WALL', 'KEEP'];

// one "fort": two pillars + cap per floor (100px per floor), optional roof.
function genFort(r, x, floors, matBase, matTop, caps, roof) {
  const bl = [];
  for (let f = 0; f < floors; f++) {
    const m = f === 0 ? matBase : (r() < 0.5 ? matBase : matTop);
    bl.push(S(m, 'pl', x - 40, f * 100), S(m, 'pl', x + 40, f * 100));
    bl.push(S(pick(r, caps), 'beam', x, f * 100 + 78));
    if (f > 0 && r() < 0.4) bl.push(S(matTop, 'sq', x + (r() < 0.5 ? -40 : 40), f * 100));
  }
  const topBase = floors * 100;
  if (roof === 'tri') bl.push(S(matTop, 'tri', x, topBase));
  else if (roof === 'sq') bl.push(S(matTop, 'sq', x, topBase));
  return bl;
}

for (let g = 0; g < 92; g++) {
  const r = mulberry(9917 + g * 131);
  const tier = Math.min(9, (g * 10 / 92) | 0);
  const x0 = 700 + tier * 15 + ((r() * 40) | 0);
  const blocks = [], pigs = [];
  // material pools grow harder with tier
  const mats = tier < 1 ? ['wood', 'ice'] : tier < 3 ? ['wood', 'wood', 'ice'] : tier < 5 ? ['stone', 'wood', 'wood'] : ['stone', 'stone', 'wood'];
  const matBase = tier < 3 ? 'wood' : 'stone';
  const nForts = 1 + (tier >= 2 ? 1 : 0) + (tier >= 5 ? 1 : 0);
  let x = x0;
  for (let fi = 0; fi < nForts; fi++) {
    const floors = Math.min(4, 1 + ((tier / 2.5) | 0) + (r() < 0.35 ? 1 : 0));
    const mT = pick(r, mats);
    const roof = r() < 0.55 ? 'tri' : (r() < 0.5 ? 'sq' : 'none');
    blocks.push(...genFort(r, x, floors, fi === 0 ? matBase : pick(r, mats), mT, mats, roof));
    // pigs inside this fort: ground floor always on higher tiers, upper floors sometimes
    pigs.push(P(x, 0, r() < tier * 0.12 ? 'helmet' : 'plain'));
    for (let f = 1; f < floors; f++) {
      if (r() < 0.35 + tier * 0.06) pigs.push(P(x, f * 100, r() < tier * 0.1 ? 'helmet' : (r() < 0.15 ? 'stash' : 'plain')));
    }
    if (r() < 0.3 && floors >= 2 && roof !== 'none') pigs.push(P(x, floors * 100, 'plain')); // rooftop pig
    x += 200 + ((r() * 70) | 0);
  }
  // annex walls / bunkers between forts on later tiers
  if (tier >= 3) {
    const ax = x0 + 100 + ((r() * 60) | 0);
    blocks.push(S(pick(r, mats), 'sq', ax, 0));
    const two = r() < 0.5;
    if (two) blocks.push(S(pick(r, mats), 'sq', ax, 40));
    if (r() < 0.35 + tier * 0.05) pigs.push(P(ax, two ? 80 : 0));
  }
  if (tier >= 6) { // far outpost pillar + pig
    const ox = x + 60 + ((r() * 60) | 0);
    blocks.push(S('stone', 'pl', ox, 0), S(pick(r, mats), 'pl', ox, 78), S(pick(r, mats), 'plh', ox, 156));
    pigs.push(P(ox, 178, 'helmet'));
  }
  // bird roster: 3 early -> 5 late; unlock dash/bomb progressively
  const nBirds = Math.min(5, 3 + ((tier / 2.5) | 0));
  const birdPool = tier < 2 ? ['koto', 'koto', 'zuza', 'koto-dash']
    : tier < 5 ? ['koto', 'koto-dash', 'zuza', 'zuza-bomb', 'koto']
    : ['koto', 'koto-dash', 'zuza', 'zuza-bomb', 'zuza-bomb'];
  const birds = [];
  for (let i = 0; i < nBirds; i++) birds.push(i === nBirds - 1 && tier >= 2 ? 'zuza-bomb' : pick(r, birdPool));
  const pigScore = pigs.length * 4500;
  const s1 = 9000 + pigScore + tier * 800;
  AB.LEVELS.push({
    name: `${pick(r, LV_NAME_A)} ${pick(r, LV_NAME_B)}`,
    theme: (tier >= 4 && g % 3 === 0) || g % 7 === 6 ? 'night' : 'day',
    birds, blocks, pigs,
    stars: [s1, (s1 * 1.55) | 0, (s1 * 2.2) | 0],
  });
}

// convert def -> spawnable bodies data (world coords)
AB.buildLevel = (i) => {
  const L = AB.LEVELS[i];
  const blocks = L.blocks.map(b => {
    const h = b.shape === 'sq' ? b.w : b.h;
    return { ...b, y: GY - b.base - h / 2 - 0.6 }; // hair of air so stacks start clean
  });
  const pigs = L.pigs.map(p => ({ ...p, y: GY - p.base - 18.6 }));
  return { ...L, blocks, pigs, gy: GY };
};
})();
