/* dream-home world map — grid, zones, collision, tile rendering.
   Exposes DH.world. Tile size 32px. Map 30x19 tiles (960x608 world px; canvas shows a camera window).

   Rendering layers inside world.draw (all cosmetic; no game-logic state lives here):
     1. tiles + in-tile detail (planks, siding, furrows, ripples)
     2. decor overlay (flowers, mailbox, chimney smoke, lily pads) — non-blocking
     3. ambient (cloud shadows, butterfly, bird)
     4. day/night tint via world.applyDayTint — driven by shared DH.state.timeMin
     5. light pass (window glow, door lamp) drawn over the tint so they read as lit
   Entities (players/animals) are drawn by game.js after world.draw, so they stay
   lit on top of the tinted world — reads as "characters under porch light".
*/
(function () {
  const DH = (window.DH = window.DH || {});
  const T = 32, W = 30, H = 19;

  // tile ids
  const GRASS = 0, FLOOR = 1, WALL = 2, SOIL = 3, WATER = 4, PATH = 5, FENCE = 6, SAND = 7;

  // Layout (rows y=0..18):
  //  - house occupies x 3..15, y 2..9 (walls on border, floor inside, door at bottom middle)
  //  - garden plot x 17..27, y 3..9 (soil)
  //  - pasture/barn x 2..9, y 11..17 (fenced grass)
  //  - pond x 22..27, y 13..17 (water)
  //  - paths connecting door→garden→pasture
  const grid = [];
  for (let y = 0; y < H; y++) {
    const row = [];
    for (let x = 0; x < W; x++) {
      let t = GRASS;
      if (x >= 3 && x <= 15 && y >= 2 && y <= 9) t = (x === 3 || x === 15 || y === 2 || y === 9) ? WALL : FLOOR;
      if (x >= 17 && x <= 27 && y >= 3 && y <= 9) t = SOIL;
      if (x >= 22 && x <= 27 && y >= 13 && y <= 17) t = WATER;
      if (x >= 2 && x <= 9 && y >= 11 && y <= 17) {
        if (x === 2 || x === 9 || y === 11 || y === 17) t = FENCE;
      }
      row.push(t);
    }
    grid.push(row);
  }
  // doors/gaps
  grid[9][9] = FLOOR;            // house front door
  grid[11][5] = GRASS;           // pasture gate
  grid[17][20] = GRASS;          // garden west entrance... (row 17 is fence row for pasture only) adjust below
  // garden entrance on west side
  grid[6][16] = PATH;            // stepping stone into garden (x16 is grass)
  // path from door to garden and pasture
  for (let x = 9; x <= 16; x++) grid[10][x] = PATH;
  grid[10][9] = PATH;
  grid[9][9] = FLOOR;
  for (let y = 10; y <= 11; y++) grid[y][5] = PATH;
  grid[11][5] = PATH;            // pasture gate path

  const SOLID = new Set([WALL, WATER, FENCE]);
  const SOLID_OVERRIDE = new Set(); // "x,y" tiles walkable despite SOLID (gates/doors)
  SOLID_OVERRIDE.add("9,9");   // door
  SOLID_OVERRIDE.add("5,11");  // pasture gate

  const world = {
    T, W, H, GRASS, FLOOR, WALL, SOIL, WATER, PATH, FENCE, SAND,
    grid,
    tileAt(tx, ty) { return tx < 0 || ty < 0 || tx >= W || ty >= H ? WALL : grid[ty][tx]; },
    setTile(tx, ty, t) { if (tx >= 0 && ty >= 0 && tx < W && ty < H) grid[ty][tx] = t; },
    isSolid(tx, ty) {
      if (tx < 0 || ty < 0 || tx >= W || ty >= H) return true;
      if (SOLID_OVERRIDE.has(tx + "," + ty)) return false;
      return SOLID.has(grid[ty][tx]);
    },
    // px-space helpers
    solidAtPx(px, py) { return world.isSolid(Math.floor(px / T), Math.floor(py / T)); },
    canStand(px, py) { // small body box
      const r = 9;
      return !(world.solidAtPx(px - r, py - r) || world.solidAtPx(px + r, py - r) ||
               world.solidAtPx(px - r, py + r) || world.solidAtPx(px + r, py + r));
    },
    zone(tx, ty) {
      if (tx >= 3 && tx <= 15 && ty >= 2 && ty <= 9) return "house";
      if (tx >= 17 && tx <= 27 && ty >= 3 && ty <= 9) return "garden";
      if (tx >= 2 && tx <= 9 && ty >= 11 && ty <= 17) return "pasture";
      if (tx >= 22 && tx <= 27 && ty >= 13 && ty <= 17) return "pond";
      return "yard";
    },
    // extra placed obstacles (furniture etc.) register tile positions here
    blocked: new Set(), // "x,y"
    isBlocked(tx, ty) { return world.isSolid(tx, ty) || world.blocked.has(tx + "," + ty); },
  };

  // ---------- deterministic placement hash (stable decor, no state) ----------
  function h2(x, y) {
    let h = (x * 374761393 + y * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  }

  // ---------- tile drawing ----------
  const COLORS = {
    [GRASS]: "#77c44f", [FLOOR]: "#d9a862", [WALL]: "#9c6740", [SOIL]: "#7a5232",
    [WATER]: "#4a9bd8", [PATH]: "#c9b797", [FENCE]: "#9a7a4a", [SAND]: "#e8d9a0",
  };

  // window tiles on the house walls (front row y=9, back row y=2)
  const WINDOWS = new Set(["5,2", "7,2", "10,2", "12,2", "5,9", "7,9", "11,9", "13,9"]);
  const CHIMNEY = { x: 13, y: 2 };
  const MAILBOX = { x: 10, y: 11 };   // grass tile just below the door path
  const MAT = { x: 9, y: 10 };        // path tile in front of the door
  const LILIES = [[23.4, 14.2], [25.8, 15.6], [24.6, 16.7]];
  const FLOWER_COLORS = ["#ff7fa5", "#ffd94d", "#ffffff", "#c58bff", "#ff9a5c"];

  function isWater(x, y) { return x >= 0 && y >= 0 && x < W && y < H && grid[y][x] === WATER; }

  function drawTile(ctx, x, y, px, py) {
    const t = grid[y][x];
    ctx.fillStyle = COLORS[t];
    ctx.fillRect(px, py, T, T);
    const h = h2(x, y);

    if (t === GRASS) {
      // two-tone patch variation
      if (h < 0.28) { ctx.fillStyle = "rgba(255,255,255,0.05)"; ctx.fillRect(px, py, T, T); }
      else if (h > 0.78) { ctx.fillStyle = "rgba(0,60,0,0.07)"; ctx.fillRect(px, py, T, T); }
      // tufts
      if ((x * 7 + y * 13) % 11 === 0) {
        ctx.fillStyle = "#8fd45f";
        ctx.fillRect(px + 12, py + 14, 3, 5); ctx.fillRect(px + 20, py + 8, 3, 5);
        ctx.fillRect(px + 25, py + 22, 2, 4);
      }
      if (h > 0.62 && h < 0.66) { // darker blade pair
        ctx.fillStyle = "#5fa83e";
        ctx.fillRect(px + 6, py + 20, 2, 6); ctx.fillRect(px + 9, py + 23, 2, 4);
      }
      // sparse flowers / pebbles in the yard only (never inside zones' decor contract)
      if (world.zone(x, y) === "yard") {
        if (h > 0.90 && h < 0.945) {
          const fx = px + 5 + Math.floor(h * 700) % 20, fy = py + 6 + Math.floor(h * 500) % 18;
          ctx.fillStyle = "#3f8f33"; ctx.fillRect(fx + 1, fy + 4, 2, 5);
          ctx.fillStyle = FLOWER_COLORS[Math.floor(h * 50) % FLOWER_COLORS.length];
          ctx.fillRect(fx, fy, 4, 4); ctx.fillRect(fx - 1, fy + 1, 6, 2);
          ctx.fillStyle = "#fff8c9"; ctx.fillRect(fx + 1, fy + 1, 2, 2);
        } else if (h > 0.955) {
          ctx.fillStyle = "#9aa3a8"; ctx.fillRect(px + 8, py + 12, 5, 4);
          ctx.fillStyle = "#b9c0c4"; ctx.fillRect(px + 9, py + 12, 3, 1);
          ctx.fillStyle = "#8b9399"; ctx.fillRect(px + 20, py + 21, 4, 3);
        }
      }
    }

    if (t === FLOOR) {
      // hardwood planks: 4 rows, alternating tone, seam + staggered plank ends
      for (let r = 0; r < 4; r++) {
        const ry = py + r * 8;
        ctx.fillStyle = (r + x) % 2 ? "#d19a52" : "#dcb06c";
        ctx.fillRect(px, ry, T, 8);
        ctx.fillStyle = "#b98346"; ctx.fillRect(px, ry + 7, T, 1);
        const end = ((x * 3 + r * 2) % 4) * 8 + 4;
        ctx.fillRect(px + end, ry, 1, 7);
      }
    }

    if (t === WALL) {
      // clapboard siding
      ctx.fillStyle = "#8a5733";
      for (let r = 0; r < 5; r++) ctx.fillRect(px, py + 5 + r * 6, T, 1);
      ctx.fillStyle = "rgba(0,0,0,0.12)"; ctx.fillRect(px, py + T - 5, T, 5); // skirting
      ctx.fillStyle = "#b07c50"; ctx.fillRect(px, py, T, 3);               // top trim
      if (y === 2) {
        // roof edge overhanging the top wall
        ctx.fillStyle = "#6e3f2a"; ctx.fillRect(px - 1, py - 7, T + 2, 9);
        ctx.fillStyle = "#8d5236"; ctx.fillRect(px - 1, py - 7, T + 2, 3);
        ctx.fillStyle = "#542c1c"; ctx.fillRect(px, py - 1, T, 2); // eave shadow
        ctx.fillStyle = "rgba(0,0,0,0.18)"; ctx.fillRect(px, py + 2, T, 3);
        // chimney
        if (x === CHIMNEY.x) {
          ctx.fillStyle = "#8a4a3a"; ctx.fillRect(px + 19, py - 24, 11, 17);
          ctx.fillStyle = "#6e352a"; ctx.fillRect(px + 18, py - 26, 13, 4);
          ctx.fillStyle = "rgba(0,0,0,0.15)";
          ctx.fillRect(px + 19, py - 19, 11, 1); ctx.fillRect(px + 19, py - 13, 11, 1);
        }
      }
      // windows with frames + sills (drawn over siding)
      if (WINDOWS.has(x + "," + y)) {
        ctx.fillStyle = "#f3e7cf"; ctx.fillRect(px + 8, py + 9, 16, 15);
        ctx.fillStyle = "#86b8d4"; ctx.fillRect(px + 10, py + 11, 12, 11);
        ctx.fillStyle = "#f3e7cf";
        ctx.fillRect(px + 15, py + 11, 2, 11); ctx.fillRect(px + 10, py + 16, 12, 1);
        ctx.fillStyle = "#d9c9a8"; ctx.fillRect(px + 7, py + 24, 18, 2);
      }
      // door frame posts around the door tile
      if (y === 9 && (x === 8 || x === 10)) {
        ctx.fillStyle = "#7a4a2c"; ctx.fillRect(x === 8 ? px + T - 3 : px, py + 4, 3, T - 4);
      }
    }

    if (t === FLOOR && x === 9 && y === 9) { // doorway interior: warm threshold
      ctx.fillStyle = "#c98f4e"; ctx.fillRect(px, py + T - 6, T, 6);
    }

    if (t === SOIL) {
      // tilled furrows + ridges
      ctx.fillStyle = "#5f3d22";
      ctx.fillRect(px, py + 6, T, 3); ctx.fillRect(px, py + 18, T, 3); ctx.fillRect(px, py + 30, T, 2);
      ctx.fillStyle = "#8d6138";
      ctx.fillRect(px, py + 3, T, 1); ctx.fillRect(px, py + 15, T, 1); ctx.fillRect(px, py + 27, T, 1);
      if (h > 0.55) { ctx.fillStyle = "#6b4a2c"; ctx.fillRect(px + Math.floor(h * 20) + 4, py + 11, 3, 2); }
    }

    if (t === WATER) {
      // depth shading toward pond center + sandy shore where water meets land
      const edge = [!isWater(x - 1, y), !isWater(x + 1, y), !isWater(x, y - 1), !isWater(x, y + 1)];
      ctx.fillStyle = "#3d88c2"; ctx.fillRect(px + 3, py + 3, T - 6, T - 6);
      ctx.fillStyle = COLORS[SAND];
      if (edge[0]) ctx.fillRect(px, py, 4, T);
      if (edge[1]) ctx.fillRect(px + T - 4, py, 4, T);
      if (edge[2]) ctx.fillRect(px, py, T, 4);
      if (edge[3]) ctx.fillRect(px, py + T - 4, T, 4);
      // animated ripple ring
      const ph = ((Date.now() / 90 + h * 40) % 14) / 14;
      ctx.strokeStyle = `rgba(255,255,255,${0.22 * (1 - ph)})`;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(px + T / 2, py + T / 2, 4 + ph * 11, 2 + ph * 5, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = "#ffffff30";
      const o = Math.sin(Date.now() / 600 + x * 2 + y) * 3;
      ctx.fillRect(px + 4 + o, py + 9, 12, 2); ctx.fillRect(px + 12 - o, py + 21, 12, 2);
    }

    if (t === PATH) {
      // gravel speckle + soft edge where it meets grass
      ctx.fillStyle = "#b3a180";
      ctx.fillRect(px + 4 + Math.floor(h * 10), py + 6, 3, 2);
      ctx.fillRect(px + 18, py + 20 + Math.floor(h * 6), 3, 2);
      ctx.fillStyle = "#d8c8a8";
      ctx.fillRect(px + 12 + Math.floor(h * 8), py + 12, 3, 2);
      ctx.fillRect(px + 6, py + 24, 3, 2);
      const gL = !x || grid[y][x - 1] === GRASS, gR = x + 1 >= W || grid[y][x + 1] === GRASS;
      const gU = !y || grid[y - 1][x] === GRASS, gD = y + 1 >= H || grid[y + 1][x] === GRASS;
      ctx.fillStyle = "#ab9873";
      if (gL) ctx.fillRect(px, py, 2, T);
      if (gR) ctx.fillRect(px + T - 2, py, 2, T);
      if (gU) ctx.fillRect(px, py, T, 2);
      if (gD) ctx.fillRect(px, py + T - 2, T, 2);
    }

    if (t === FENCE) {
      // rails + chunky post with cap
      ctx.fillStyle = "#8a6438"; ctx.fillRect(px, py + 8, T, 5); ctx.fillRect(px, py + 20, T, 5);
      ctx.fillStyle = "#b08a52"; ctx.fillRect(px, py + 8, T, 1); ctx.fillRect(px, py + 20, T, 1);
      ctx.fillStyle = "rgba(0,0,0,0.12)"; ctx.fillRect(px, py + 13, T, 2); ctx.fillRect(px, py + 25, T, 2);
      ctx.fillStyle = "#7a5328"; ctx.fillRect(px + 12, py + 3, 8, 27);
      ctx.fillStyle = "#96693a"; ctx.fillRect(px + 11, py + 1, 10, 5);
    }
  }

  // ---------- decor overlay (non-blocking) ----------
  function drawDecor(ctx, camX, camY, now) {
    // welcome mat in front of the door
    const mx = MAT.x * T - camX, my = MAT.y * T - camY;
    ctx.fillStyle = "#b5794a"; ctx.fillRect(mx + 7, my + 9, 18, 15);
    ctx.fillStyle = "#8a5a34"; ctx.fillRect(mx + 7, my + 9, 18, 2); ctx.fillRect(mx + 7, my + 22, 18, 2);
    ctx.fillStyle = "#9c6538"; ctx.fillRect(mx + 10, my + 13, 12, 6);

    // mailbox on the grass below the path
    const bx = MAILBOX.x * T - camX, by = MAILBOX.y * T - camY;
    ctx.fillStyle = "#6e4a2a"; ctx.fillRect(bx + 13, by + 14, 4, 17);
    ctx.fillStyle = "#c94f4f"; ctx.fillRect(bx + 6, by + 4, 18, 11);
    ctx.fillStyle = "#a83c3c"; ctx.fillRect(bx + 6, by + 4, 18, 3);
    ctx.fillStyle = "#f2d9d0"; ctx.fillRect(bx + 8, by + 7, 5, 5);
    ctx.fillStyle = "#e8a13c"; ctx.fillRect(bx + 21, by + 2, 3, 6);

    // lily pads on the pond
    for (const [lx, ly] of LILIES) {
      const px = lx * T - camX, py = ly * T - camY;
      ctx.fillStyle = "#3f9e4d";
      ctx.beginPath(); ctx.ellipse(px, py, 9, 5.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#2f7e3c";
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + 9, py - 4); ctx.lineTo(px + 9, py + 2); ctx.fill();
      if (lx === 25.8) { ctx.fillStyle = "#ff9ec4"; ctx.fillRect(px - 3, py - 6, 5, 4); }
    }

    // chimney smoke puffs
    const cx = (CHIMNEY.x + 0.78) * T - camX, cy = CHIMNEY.y * T - 26 - camY;
    for (let i = 0; i < 3; i++) {
      const age = (now / 1600 + i / 3) % 1;
      ctx.fillStyle = `rgba(235,235,235,${0.30 * (1 - age)})`;
      ctx.beginPath();
      ctx.arc(cx + Math.sin(age * 5 + i) * 6, cy - age * 42, 2.5 + age * 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ---------- ambient life ----------
  function drawAmbient(ctx, camX, camY, now, daylight) {
    // drifting cloud shadows
    ctx.fillStyle = "rgba(30,50,30,0.06)";
    for (let i = 0; i < 3; i++) {
      const cx = ((now * 0.012 + i * 340) % (W * T + 420)) - 210 - camX;
      const cy = 90 + i * 170 + Math.sin(now / 4000 + i) * 30 - camY;
      ctx.beginPath(); ctx.ellipse(cx, cy, 130, 42, 0, 0, Math.PI * 2); ctx.fill();
    }
    // butterfly near the garden during daylight
    if (daylight > 0.25 && (now / 1000) % 36 < 14) {
      const bx = 22 * T + Math.sin(now / 900) * 150 - camX;
      const by = 6.3 * T + Math.cos(now / 700) * 55 - camY;
      const flap = Math.abs(Math.sin(now / 55)) * 0.7 + 0.3;
      ctx.fillStyle = "#ffb347";
      ctx.beginPath(); ctx.ellipse(bx - 4, by, 4, 6 * flap, -0.4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(bx + 4, by, 4, 6 * flap, 0.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#5a4632"; ctx.fillRect(bx - 1, by - 5, 2, 10);
    }
    // a bird crosses the top occasionally (daylight only)
    const birdCycle = (now / 1000) % 47;
    if (daylight > 0.25 && birdCycle < 9) {
      const bx2 = ((birdCycle / 9) * (W * T + 240)) - 120 - camX;
      const by2 = 55 + Math.sin(now / 300) * 18 - camY;
      const w = Math.sin(now / 70) * 4;
      ctx.strokeStyle = "rgba(40,40,55,0.8)"; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(bx2 - 7, by2 + w); ctx.quadraticCurveTo(bx2 - 3, by2 - 4, bx2, by2);
      ctx.quadraticCurveTo(bx2 + 3, by2 - 4, bx2 + 7, by2 + w);
      ctx.stroke();
    }
  }

  // ---------- day/night ----------
  // tint keyframes: [timeMin, r, g, b, alpha]
  const TINTS = [
    [0, 12, 20, 60, 0.52], [270, 12, 20, 60, 0.52], [330, 40, 40, 80, 0.35],
    [390, 255, 160, 80, 0.20], [470, 255, 205, 140, 0.08], [660, 255, 250, 230, 0.02],
    [930, 255, 235, 190, 0.04], [1050, 255, 140, 55, 0.16], [1140, 90, 45, 90, 0.32],
    [1230, 14, 22, 64, 0.50], [1440, 12, 20, 60, 0.52],
  ];
  function tintAt(timeMin) {
    const t = ((timeMin % 1440) + 1440) % 1440;
    for (let i = 0; i < TINTS.length - 1; i++) {
      const [t0, r0, g0, b0, a0] = TINTS[i], [t1, r1, g1, b1, a1] = TINTS[i + 1];
      if (t >= t0 && t <= t1) {
        const f = (t - t0) / (t1 - t0 || 1);
        return [r0 + (r1 - r0) * f, g0 + (g1 - g0) * f, b0 + (b1 - b0) * f, a0 + (a1 - a0) * f];
      }
    }
    return TINTS[0].slice(1);
  }

  // Public: apply the time-of-day color grade over the current viewport.
  // world.draw calls this after tiles/decor; entities rendered later stay lit.
  world.applyDayTint = function (ctx, camX, camY, state) {
    const timeMin = state && typeof state.timeMin === "number" ? state.timeMin : 720;
    const [r, g, b, a] = tintAt(timeMin);
    const cw = ctx.canvas.width, ch = ctx.canvas.height;
    if (a > 0.005) {
      ctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},${a})`;
      ctx.fillRect(0, 0, cw, ch);
    }
    return a;
  };

  // warm light drawn over the tint: windows glow, door lamp, moon glints
  function drawLights(ctx, camX, camY, dark) {
    if (dark < 0.14) return;
    for (const key of WINDOWS) {
      const [wx, wy] = key.split(",").map(Number);
      const cx = wx * T + T / 2 - camX, cy = wy * T + 16 - camY;
      if (cx < -40 || cy < -40 || cx > ctx.canvas.width + 40 || cy > ctx.canvas.height + 40) continue;
      const grad = ctx.createRadialGradient(cx, cy, 3, cx, cy, 30);
      grad.addColorStop(0, `rgba(255,195,95,${0.55 * dark * 2})`);
      grad.addColorStop(1, "rgba(255,195,95,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(cx - 30, cy - 30, 60, 60);
      ctx.fillStyle = `rgba(255,214,130,${Math.min(1, dark * 2.2)})`;
      ctx.fillRect(wx * T + 10 - camX, wy * T + 11 - camY, 12, 11);
      ctx.fillStyle = "rgba(120,80,30,0.6)";
      ctx.fillRect(wx * T + 15 - camX, wy * T + 11 - camY, 2, 11);
    }
    // porch lamp by the door
    const dx = 9 * T + T / 2 - camX, dy = 9 * T - 4 - camY;
    const g2 = ctx.createRadialGradient(dx, dy, 2, dx, dy, 36);
    g2.addColorStop(0, `rgba(255,205,110,${0.5 * dark * 2})`);
    g2.addColorStop(1, "rgba(255,205,110,0)");
    ctx.fillStyle = g2; ctx.fillRect(dx - 36, dy - 36, 72, 72);
    ctx.fillStyle = "#ffd98a"; ctx.fillRect(dx - 2, dy - 3, 4, 4);
    // faint moonlight glints on the pond at deep night
    if (dark > 0.4) {
      ctx.fillStyle = `rgba(210,225,255,${(dark - 0.4) * 0.55})`;
      const n = Date.now() / 500;
      for (let i = 0; i < 5; i++) {
        const gx = (23 + i % 3 * 1.8) * T + Math.sin(n + i * 2) * 6 - camX;
        const gy = (14.2 + i * 0.8) * T - camY;
        ctx.fillRect(gx, gy, 8, 2);
      }
    }
  }

  world.draw = function (ctx, camX, camY) {
    const now = Date.now();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      drawTile(ctx, x, y, x * T - camX, y * T - camY);
    }
    drawDecor(ctx, camX, camY, now);
    const st = DH.state;
    const timeMin = st && typeof st.timeMin === "number" ? st.timeMin : 720;
    const isDay = timeMin >= 330 && timeMin <= 1170; // butterfly/bird only in daylight
    drawAmbient(ctx, camX, camY, now, isDay ? 1 : 0);
    const a = world.applyDayTint(ctx, camX, camY, st);
    drawLights(ctx, camX, camY, a);
  };

  DH.world = world;
})();
