/* NEON CITY — world: procedural neon city, collision, spawn points, minimap. */
(function () {
  const NC = window.NC;
  const U = NC.util;

  // Grid: blocks of buildings separated by streets.
  // Street spacing 320px, road width 88px, block interior ~232px.
  const ROAD = 96, BLOCK = 240, PITCH = ROAD + BLOCK;
  const COLS = 9, ROWS = 7; // => W=9*336+96=3120, H=7*336+96=2448
  const W = COLS * PITCH + ROAD, H = ROWS * PITCH + ROAD;

  const NEON = ["#ff2d95", "#22d3ee", "#a855f7", "#facc15", "#34d399", "#f97316"];
  const SIGNS = ["BAR", "CLUB", "HOTEL", "RAMEN", "寿司", "LOVE", "XXX", "SHOP",
    "カラオケ", "パチンコ", "HOTEL", "GIRLS", "24H", "LIVE", "NOVA", "ZAZA"];

  const buildings = [], props = [], signs = [];
  let hospital = null, policeStation = null;

  function mulberry(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function genCity() {
    const rng = mulberry(20260924);
    buildings.length = 0; props.length = 0; signs.length = 0;
    for (let bx = 0; bx < COLS; bx++) {
      for (let by = 0; by < ROWS; by++) {
        const ox = ROAD + bx * PITCH, oy = ROAD + by * PITCH;
        // 30%: one big building; 70%: 2x2 small buildings w/ alley gaps
        const roll = rng();
        const addB = (x, y, w, h, big) => {
          const hue = 200 + Math.floor(rng() * 160);
          const b = {
            x, y, w, h,
            col: `hsl(${hue},18%,${8 + Math.floor(rng() * 7)}%)`,
            edge: NEON[Math.floor(rng() * NEON.length)],
            lit: [], big: !!big,
          };
          const litN = Math.floor(w * h / 900);
          for (let i = 0; i < litN; i++)
            b.lit.push([Math.floor(rng() * (w - 8)), Math.floor(rng() * (h - 8)), rng() < 0.3 ? NEON[Math.floor(rng() * 6)] : "#ffd9a0"]);
          buildings.push(b);
          // neon sign on street-facing edge
          if (rng() < 0.75) {
            const side = Math.floor(rng() * 4);
            let sx = x, sy = y;
            if (side === 0) { sx = x + w / 2; sy = y - 6; }
            else if (side === 1) { sx = x + w + 6; sy = y + h / 2; }
            else if (side === 2) { sx = x + w / 2; sy = y + h + 6; }
            else { sx = x - 6; sy = y + h / 2; }
            signs.push({
              x: sx, y: sy, side,
              text: SIGNS[Math.floor(rng() * SIGNS.length)],
              col: NEON[Math.floor(rng() * NEON.length)],
              v: side === 1 || side === 3, // vertical text on left/right edges
            });
          }
        };
        if (roll < 0.3) {
          addB(ox + 12, oy + 12, BLOCK - 24, BLOCK - 24, true);
        } else {
          const g = 26; // alley gap
          const w2 = (BLOCK - 24 - g) / 2;
          addB(ox + 12, oy + 12, w2, w2);
          addB(ox + 12 + w2 + g, oy + 12, w2, w2);
          addB(ox + 12, oy + 12 + w2 + g, w2, w2);
          addB(ox + 12 + w2 + g, oy + 12 + w2 + g, w2, w2);
        }
        // props on sidewalk edge: puddles, cones, neon strips
        const nProps = 1 + Math.floor(rng() * 3);
        for (let i = 0; i < nProps; i++) {
          props.push({
            x: ox - 10 + rng() * (BLOCK + 20),
            y: oy - 10 + rng() * (BLOCK + 20),
            kind: rng() < 0.45 ? "puddle" : rng() < 0.5 ? "cone" : "trash",
            c: NEON[Math.floor(rng() * 6)],
          });
        }
      }
    }
    // landmarks: hospital (block 1,1), police station (block COLS-2, ROWS-2)
    hospital = { x: ROAD + 1 * PITCH + 60, y: ROAD + 1 * PITCH + 40 };
    policeStation = { x: ROAD + (COLS - 2) * PITCH + 60, y: ROAD + (ROWS - 2) * PITCH + 40 };
    buildings.push({
      x: ROAD + 1 * PITCH + 12, y: ROAD + 1 * PITCH + 12, w: 96, h: 60,
      col: "#12202a", edge: "#22d3ee", lit: [], big: true, label: "HOSPITAL", lc: "#ff5d5d",
    });
    buildings.push({
      x: ROAD + (COLS - 2) * PITCH + 12, y: ROAD + (ROWS - 2) * PITCH + 12, w: 96, h: 60,
      col: "#181a2e", edge: "#60a5fa", lit: [], big: true, label: "POLICE", lc: "#60a5fa",
    });
  }

  function solidAt(x, y, r = 10) {
    if (x < r || y < r || x > W - r || y > H - r) return true;
    for (const b of buildings) {
      if (x + r > b.x && x - r < b.x + b.w && y + r > b.y && y - r < b.y + b.h) return true;
    }
    return false;
  }
  function onRoad(x, y) {
    const fx = U.wrap(x, PITCH), fy = U.wrap(y, PITCH);
    return fx < ROAD || fy < ROAD; // within road band of grid cell
  }
  function blockAt(x, y) { return onRoad(x, y) ? null : { x: x - U.wrap(x, PITCH), y: y - U.wrap(y, PITCH) }; }
  function randomRoad() {
    const rng = Math.random;
    const horiz = rng() < 0.5;
    if (horiz) {
      const ry = Math.floor(rng() * (ROWS + 1)) * PITCH + ROAD / 2;
      return { x: rng() * W, y: ry + (rng() - 0.5) * (ROAD - 30) };
    }
    const rx = Math.floor(rng() * (COLS + 1)) * PITCH + ROAD / 2;
    return { x: rx + (rng() - 0.5) * (ROAD - 30), y: rng() * H };
  }
  function randomSidewalk() {
    const rng = Math.random;
    const bx = Math.floor(rng() * COLS), by = Math.floor(rng() * ROWS);
    // sidewalk = 12px ring just inside block edge
    const ox = ROAD + bx * PITCH, oy = ROAD + by * PITCH;
    const side = Math.floor(rng() * 4);
    if (side === 0) return { x: ox + 6, y: oy + rng() * BLOCK };
    if (side === 1) return { x: ox + BLOCK - 6, y: oy + rng() * BLOCK };
    if (side === 2) return { x: ox + rng() * BLOCK, y: oy + 6 };
    return { x: ox + rng() * BLOCK, y: oy + BLOCK - 6 };
  }
  function nearestRoadTo(x, y) {
    // snap to nearest street center
    const bx = Math.floor(x / PITCH), by = Math.floor(y / PITCH);
    const cxs = [bx * PITCH + ROAD / 2, (bx + 1) * PITCH + ROAD / 2];
    const cys = [by * PITCH + ROAD / 2, (by + 1) * PITCH + ROAD / 2];
    let best = { x: cxs[0], y: cys[0], d: 1e9 };
    for (const cx of cxs) for (const cy of cys) {
      const d = U.dist(x, y, cx, cy);
      if (d < best.d) best = { x: cx, y: cy, d };
    }
    return best;
  }

  // ---------- render ----------
  function drawUnder(ctx, cam) {
    const { vw, vh } = NC;
    const x0 = Math.max(0, cam.x - 60), y0 = Math.max(0, cam.y - 60);
    const x1 = Math.min(W, cam.x + vw + 60), y1 = Math.min(H, cam.y + vh + 60);
    // base asphalt + sidewalk
    ctx.fillStyle = "#0c0c14";
    ctx.fillRect(cam.x, cam.y, vw, vh);
    // sidewalks: fill block interiors first
    ctx.fillStyle = "#17171f";
    const bx0 = Math.max(0, Math.floor((x0 - ROAD) / PITCH)), bx1 = Math.min(COLS - 1, Math.floor(x1 / PITCH));
    const by0 = Math.max(0, Math.floor((y0 - ROAD) / PITCH)), by1 = Math.min(ROWS - 1, Math.floor(y1 / PITCH));
    for (let bx = bx0; bx <= bx1; bx++)
      for (let by = by0; by <= by1; by++) {
        const ox = ROAD + bx * PITCH, oy = ROAD + by * PITCH;
        ctx.fillRect(ox, oy, BLOCK, BLOCK);
      }
    // lane dashes on roads
    ctx.strokeStyle = "rgba(250,204,21,0.28)";
    ctx.lineWidth = 2;
    ctx.setLineDash([14, 18]);
    ctx.beginPath();
    for (let i = 0; i <= COLS; i++) {
      const x = i * PITCH + ROAD / 2;
      if (x > x0 - 40 && x < x1 + 40) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
    }
    for (let j = 0; j <= ROWS; j++) {
      const y = j * PITCH + ROAD / 2;
      if (y > y0 - 40 && y < y1 + 40) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
    }
    ctx.stroke();
    ctx.setLineDash([]);
    // crosswalk stripes at intersections (sparse)
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    for (let i = bx0; i <= bx1 + 1 && i <= COLS; i++)
      for (let j = by0; j <= by1 + 1 && j <= ROWS; j++) {
        const ix = i * PITCH + ROAD, iy = j * PITCH + ROAD;
        if (ix > x0 && ix < x1 && iy > y0 && iy < y1) {
          for (let s = 0; s < 4; s++) ctx.fillRect(ix - 70 + s * 34, iy - 6, 20, 5);
        }
      }
    // props
    for (const p of props) {
      if (p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) continue;
      if (p.kind === "puddle") {
        ctx.fillStyle = "rgba(34,211,238,0.10)";
        ctx.beginPath(); ctx.ellipse(p.x, p.y, 16, 9, 0, 0, 7); ctx.fill();
        ctx.fillStyle = p.c + "22";
        ctx.fillRect(p.x - 8, p.y - 2, 16, 2);
      } else if (p.kind === "cone") {
        ctx.fillStyle = "#f97316";
        ctx.beginPath(); ctx.moveTo(p.x, p.y - 7); ctx.lineTo(p.x + 5, p.y + 5); ctx.lineTo(p.x - 5, p.y + 5); ctx.fill();
      } else {
        ctx.fillStyle = "#334155";
        ctx.fillRect(p.x - 4, p.y - 4, 8, 8);
      }
    }
    // buildings
    for (const b of buildings) {
      if (b.x > x1 || b.x + b.w < x0 || b.y > y1 || b.y + b.h < y0) continue;
      // shadow rim
      ctx.fillStyle = "#000";
      ctx.fillRect(b.x - 3, b.y - 3, b.w + 6, b.h + 6);
      ctx.fillStyle = b.col;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      // neon edge
      ctx.strokeStyle = b.edge;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.8;
      ctx.strokeRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2);
      ctx.globalAlpha = 1;
      // lit windows
      for (const L of b.lit) {
        ctx.fillStyle = L[2];
        ctx.globalAlpha = 0.75;
        ctx.fillRect(b.x + 4 + L[0], b.y + 4 + L[1], 5, 7);
      }
      ctx.globalAlpha = 1;
      if (b.label) {
        ctx.fillStyle = b.lc;
        ctx.font = "bold 11px monospace";
        ctx.textAlign = "center";
        ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 4);
      }
    }
    // neon signs — glow pass
    const t = performance.now() / 1000;
    for (const s of signs) {
      if (s.x < x0 - 40 || s.x > x1 + 40 || s.y < y0 - 40 || s.y > y1 + 40) continue;
      const flick = 0.75 + 0.25 * Math.sin(t * 6 + s.x);
      ctx.save();
      ctx.shadowColor = s.col; ctx.shadowBlur = 12;
      ctx.fillStyle = s.col;
      ctx.globalAlpha = flick;
      ctx.font = "bold 13px monospace";
      ctx.textAlign = "center";
      if (s.v) {
        ctx.translate(s.x, s.y); ctx.rotate(Math.PI / 2);
        ctx.fillText(s.text, 0, 0);
      } else ctx.fillText(s.text, s.x, s.y);
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    // landmark markers
    ctx.font = "11px monospace"; ctx.textAlign = "center";
    ctx.fillStyle = "#ff5d5d"; ctx.fillText("HOSPITAL", hospital.x + 36, hospital.y - 10);
    ctx.fillStyle = "#60a5fa"; ctx.fillText("POLICE", policeStation.x + 36, policeStation.y - 10);
  }

  function minimap(ctx) {
    // draws a 96px-wide minimap into ctx at screen coords (caller positions)
    const mw = 110, mh = Math.round(mw * (H / W));
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = "#0c0c14";
    ctx.fillRect(0, 0, mw, mh);
    ctx.fillStyle = "#23232e";
    for (const b of buildings) {
      ctx.fillRect((b.x / W) * mw, (b.y / H) * mh, Math.max(1, (b.w / W) * mw), Math.max(1, (b.h / H) * mh));
    }
    ctx.restore();
    return { mw, mh };
  }

  genCity();
  NC.register("world", {
    W, H, ROAD, PITCH, COLS, ROWS, buildings, props, signs,
    hospital, policeStation,
    solidAt, onRoad, blockAt, randomRoad, randomSidewalk, nearestRoadTo,
    drawUnder,
    init() {}, start() {},
    update() {},
    minimap,
    serialize() { return null; },
    deserialize() {},
  });
})();
