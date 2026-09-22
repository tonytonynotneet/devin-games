/* Super Koto — level data.
   Levels are authored with a tiny grid painter (all layouts are hand-placed).
   Legend: X ground · B brick · ? block(coin) · M block(heart charm) · u used
           S stone · d pipe · C coin · m maru · g toge(spiky) · f pata(flyer)
           s start · F flag pole · z waiting partner                            */
window.SK = window.SK || {};

(function () {
  const ROWS = 16, GROUND = 14;

  function Grid(w) {
    this.w = w; this.h = ROWS;
    this.g = [];
    for (let y = 0; y < ROWS; y++) this.g.push(new Array(w).fill(' '));
  }
  Grid.prototype.set = function (x, y, c) {
    if (x >= 0 && x < this.w && y >= 0 && y < this.h) this.g[y][x] = c;
  };
  Grid.prototype.fill = function (x, y, w, h, c) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c);
  };
  Grid.prototype.ground = function (x0, x1, top) {
    this.fill(x0, top, x1 - x0 + 1, this.h - top, 'X');
  };
  Grid.prototype.pipe = function (x, top, ht) {
    this.fill(x, top - ht, 2, ht, 'd');
  };
  Grid.prototype.row = function (y, x, str) {
    for (let i = 0; i < str.length; i++) this.set(x + i, y, str[i]);
  };
  Grid.prototype.coins = function (x, y, n) {
    for (let i = 0; i < n; i++) this.set(x + i, y, 'C');
  };
  Grid.prototype.coinArc = function (x, y, n) {
    for (let i = 0; i < n; i++) {
      const t = n <= 1 ? 0 : i / (n - 1);
      const dy = Math.round(Math.sin(t * Math.PI) * 2);
      this.set(x + i, y - dy, 'C');
    }
  };
  // staircase of stone blocks: dir>0 rises left→right, dir<0 descends
  Grid.prototype.stairs = function (x, top, maxH, dir, ch) {
    ch = ch || 'S';
    for (let i = 0; i < maxH; i++) {
      const col = dir > 0 ? x + i : x - i;
      this.fill(col, top - 1 - i, 1, i + 1, ch);
    }
  };

  function emit(g, name, sub, time, sky) {
    const level = {
      name, sub, time, sky,
      w: g.w, h: g.h, grid: g.g,
      enemies: [], coinsSpawn: [],
      spawn: { x: 4 * 32, y: 13 * 32 },
      flag: { x: 0, y: 0 }, wait: null,
    };
    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < g.w; x++) {
        const c = g.g[y][x];
        if (c === 's') { level.spawn = { x: x * 32 + 6, y: (y + 1) * 32 - 44 }; g.g[y][x] = ' '; }
        else if (c === 'F') { level.flag = { x: x * 32 + 13, y: y * 32 }; g.g[y][x] = ' '; }
        else if (c === 'z') { level.wait = { x: x * 32, y: (y + 1) * 32 }; g.g[y][x] = ' '; }
        else if (c === 'm' || c === 'g' || c === 'f') {
          level.enemies.push({ t: c, x: x * 32 + 3, y: y * 32 });
          g.g[y][x] = ' ';
        }
      }
    }
    return level;
  }

  /* ---------------- Level 1 — Meadow Run (gentle) ---------------- */
  function level1() {
    const g = new Grid(190);
    g.ground(0, 49, GROUND);
    g.ground(53, 100, GROUND);
    g.ground(105, 189, GROUND);
    g.set(4, 13, 's');

    g.row(10, 15, '?BMB?');
    g.pipe(24, GROUND, 2);
    g.set(33, 13, 'm'); g.set(38, 13, 'm');
    g.row(10, 42, 'B?B');
    g.coinArc(47, 11, 6);                    // over the first gap

    g.pipe(57, GROUND, 3);
    g.set(62, 13, 'm'); g.set(66, 13, 'm');
    g.pipe(72, GROUND, 4);
    g.row(10, 78, '?');
    g.coins(81, 11, 5);
    g.set(85, 13, 'g');                      // first spiky friend — walk past it!
    g.pipe(89, GROUND, 3);
    g.row(10, 94, 'B?B?B');
    g.coinArc(100, 11, 5);                   // over second gap

    // stone hop-steps
    g.set(112, 13, 'S'); g.set(115, 12, 'S'); g.fill(115, 13, 1, 1, 'S');
    g.set(118, 11, 'S'); g.fill(118, 12, 1, 2, 'S');
    g.coins(112, 9, 4);
    g.set(122, 10, 'f');
    g.set(126, 13, 'm'); g.set(130, 13, 'm');
    g.row(10, 134, 'B?MB?');
    g.pipe(140, GROUND, 4);
    g.set(146, 13, 'g');
    g.row(10, 150, 'BBBB');
    g.coins(151, 8, 4);
    g.set(156, 13, 'm');

    // up-stairs then the flag
    g.stairs(165, GROUND, 4, +1);
    g.set(178, 13, 'F');
    g.set(181, 13, 'z');
    return emit(g, 'World 1-1', 'Meadow Run — warm up those legs!', 300,
      { top: '#6ec6f5', bot: '#c8ecff', far: '#9fd8b4', near: '#5cb878' });
  }

  /* ---------------- Level 2 — Pipe Hills (medium) ---------------- */
  function level2() {
    const g = new Grid(228);
    g.ground(0, 39, GROUND);
    g.ground(44, 79, GROUND);
    g.ground(84, 129, GROUND);
    g.ground(142, 199, GROUND);
    g.ground(204, 227, GROUND);
    g.set(4, 13, 's');

    g.row(10, 13, '?BMB?');
    g.pipe(21, GROUND, 2);
    g.pipe(27, GROUND, 3);
    g.set(31, 13, 'm');
    g.pipe(35, GROUND, 4);
    g.coinArc(39, 11, 6);                    // gap 40-43

    g.row(10, 48, '?B?B');
    g.set(52, 13, 'm'); g.set(56, 13, 'm');
    g.pipe(61, GROUND, 5);
    g.set(67, 13, 'g');
    g.row(10, 71, 'BMB');
    g.pipe(76, GROUND, 3);
    g.coinArc(79, 11, 5);                    // gap 80-83

    g.set(87, 13, 'm'); g.set(91, 13, 'm');
    g.set(96, 9, 'f');
    g.row(10, 100, 'B?B?B');
    g.set(104, 13, 'g');
    // floating stone ledge with goodies
    g.fill(110, 10, 6, 1, 'S');
    g.coins(110, 8, 6);
    g.pipe(118, GROUND, 3);
    g.set(122, 13, 'm'); g.set(125, 13, 'g');

    // THE BIG GAP 130-141 — stepping stones only
    g.set(131, 12, 'S'); g.set(134, 10, 'S'); g.set(137, 12, 'S'); g.set(140, 10, 'S');
    g.coins(131, 9, 3); g.coins(137, 9, 3);
    g.set(135, 6, 'f');

    g.pipe(146, GROUND, 3);
    g.pipe(153, GROUND, 5);
    g.set(150, 13, 'm');
    g.set(159, 13, 'g'); g.set(163, 13, 'm');
    g.row(10, 167, '?M?');
    g.set(172, 9, 'f');
    g.pipe(176, GROUND, 4);
    g.row(10, 182, 'BBBMB');
    g.set(188, 13, 'g'); g.set(192, 13, 'm');
    g.coins(183, 8, 5);
    g.coinArc(199, 11, 5);                   // gap 200-203

    g.stairs(206, GROUND, 5, +1);
    g.set(219, 13, 'F');
    g.set(222, 13, 'z');
    return emit(g, 'World 1-2', 'Pipe Hills — mind the big gap!', 320,
      { top: '#f7a35c', bot: '#ffe3b8', far: '#e8b48a', near: '#c98850' });
  }

  /* ---------------- Level 3 — Spiky Summit (hard) ---------------- */
  function level3() {
    const g = new Grid(258);
    g.ground(0, 29, GROUND);
    g.ground(35, 64, GROUND);
    g.ground(70, 99, GROUND);
    g.ground(109, 154, GROUND);
    g.ground(160, 199, GROUND);
    g.ground(210, 257, GROUND);
    g.set(4, 13, 's');

    g.row(10, 11, '?M?');
    g.pipe(17, GROUND, 3);
    g.set(22, 13, 'm'); g.set(26, 13, 'g');
    g.coinArc(30, 11, 5);                    // gap 30-34

    // low brick ceiling with a spiky guard below — stay low!
    g.fill(38, 9, 9, 1, 'B');
    g.set(40, 13, 'g');
    g.set(48, 13, 'm');
    g.pipe(53, GROUND, 4);
    g.set(58, 13, 'm'); g.set(61, 13, 'm');
    g.coinArc(65, 11, 5);                    // gap 65-69
    g.set(66, 8, 'f');

    g.row(10, 74, 'B?MB?');
    g.pipe(81, GROUND, 2);
    g.pipe(87, GROUND, 5);
    g.coins(88, 7, 3);
    g.set(92, 13, 'g'); g.set(96, 13, 'g');
    // BIG GAP 100-108: stones
    g.set(101, 11, 'S'); g.set(104, 9, 'S'); g.set(107, 11, 'S');
    g.set(104, 5, 'f');
    g.coins(100, 8, 3); g.coins(106, 8, 3);

    g.row(10, 112, 'M');
    // brick corridor — marus trapped under it
    g.fill(116, 9, 9, 1, 'B');
    g.set(118, 13, 'm'); g.set(122, 13, 'm');
    g.set(127, 13, 'g');
    g.pipe(131, GROUND, 3);
    g.pipe(138, GROUND, 6);
    g.set(144, 9, 'f');
    g.row(10, 148, '?B?');
    g.set(151, 13, 'm');
    g.coinArc(155, 11, 5);                   // gap 155-159

    g.set(163, 13, 'm'); g.set(167, 13, 'm'); g.set(171, 13, 'g');
    g.stairs(175, GROUND, 3, +1);
    g.row(10, 180, '?M?');
    g.pipe(186, GROUND, 4);
    g.set(192, 9, 'f');
    g.set(195, 13, 'g');
    // BIG GAP 200-209: stones
    g.set(201, 12, 'S'); g.set(204, 10, 'S'); g.set(207, 12, 'S');
    g.set(204, 6, 'f');
    g.coins(200, 8, 3); g.coins(206, 8, 3);

    // final gauntlet
    g.set(213, 13, 'g'); g.set(217, 13, 'm'); g.set(221, 13, 'g');
    g.row(10, 225, '?M?');
    g.pipe(231, GROUND, 3);
    g.set(236, 13, 'm'); g.set(239, 13, 'm');
    g.stairs(242, GROUND, 4, +1);
    g.set(250, 13, 'F');
    g.set(253, 13, 'z');
    return emit(g, 'World 1-3', 'Spiky Summit — the whole gang is here!', 340,
      { top: '#7a5fc0', bot: '#d8c8f8', far: '#a08cc8', near: '#7860a8' });
  }

  SK.levels = [level1(), level2(), level3()];
})();
