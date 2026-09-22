/* dream-home world map — grid, zones, collision, tile rendering.
   Exposes DH.world. Tile size 32px. Map 30x19 tiles (960x608 world px; canvas shows a camera window).
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

  // ---------- tile drawing ----------
  const COLORS = {
    [GRASS]: "#79c64e", [FLOOR]: "#d9b06a", [WALL]: "#8a5a3b", [SOIL]: "#6b4a2c",
    [WATER]: "#4a9bd8", [PATH]: "#c9b797", [FENCE]: "#9a7a4a", [SAND]: "#e8d9a0",
  };
  world.draw = function (ctx, camX, camY) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const t = grid[y][x];
      const px = x * T - camX, py = y * T - camY;
      ctx.fillStyle = COLORS[t];
      ctx.fillRect(px, py, T, T);
      if (t === GRASS && (x * 7 + y * 13) % 11 === 0) {
        ctx.fillStyle = "#8fd45f"; ctx.fillRect(px + 12, py + 14, 3, 5); ctx.fillRect(px + 20, py + 8, 3, 5);
      }
      if (t === WALL) {
        ctx.fillStyle = "#6f4327"; ctx.fillRect(px, py + T - 6, T, 6);
        ctx.fillStyle = "#a06a42"; ctx.fillRect(px, py, T, 4);
      }
      if (t === WATER) {
        ctx.fillStyle = "#ffffff33";
        const o = Math.sin(Date.now() / 600 + x * 2 + y) * 3;
        ctx.fillRect(px + 4 + o, py + 10, 14, 2); ctx.fillRect(px + 10 - o, py + 20, 14, 2);
      }
      if (t === FENCE) {
        ctx.fillStyle = "#7a5c33"; ctx.fillRect(px, py + 6, T, 5); ctx.fillRect(px, py + 20, T, 5);
      }
      if (t === SOIL) {
        ctx.fillStyle = "#5a3c22"; ctx.fillRect(px + 2, py + 8, T - 4, 3); ctx.fillRect(px + 2, py + 20, T - 4, 3);
      }
    }
  };

  DH.world = world;
})();
