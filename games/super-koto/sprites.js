/* Super Koto — pixel-art sprites.
   Characters are original designs modeled on the couple:
   - koto: black bowl-cut hair with heavy bangs, black tee, silver chain, watch.
   - zuza: very long straight dark-brown hair, black sunglasses, black outfit.
   Each sprite is a grid of characters mapped through a palette,
   pre-rendered to small offscreen canvases (scale 2). */
window.SK = window.SK || {};

(function () {
  const PAL = {
    '.': null,
    // skin / faces
    S: '#f0c8a0', n: '#d8a878', e: '#241a20', m: '#d4717f', x: '#241a20',
    // koto
    H: '#241a24', h: '#453245',
    T: '#1b1520', t: '#2a2130',
    c: '#d8deea', // silver chain
    p: '#313a4d', // pants
    s: '#262029', // shoes
    w: '#e8ecf4', // watch / shines
    // zuza
    B: '#35200f', b: '#5a3a20',
    G: '#12101c', // sunglasses
    d: '#241a28', // zuza shoes / dark trim
    // enemies
    O: '#eba45c', o: '#c47f3e', f: '#7a4c26', r: '#e0705a',
    V: '#7a4a9e', v: '#5c3380', W: '#efe8fa', Y: '#ffd94a',
    P: '#e8607a', q: '#b8405c', // pata wings use W
    // heart powerup / spark
    R: '#ff4a6a', E: '#d42a50',
  };

  const KOTO_IDLE = [
    "..HHHHHHHHHHHH..",
    ".HHHHHHHHHHHHHH.",
    ".HHHhHHHHHHhHHH.",
    ".HHHHHHHHHHHHHH.",
    ".HHHHHHHHHHHHHH.",
    ".HHHHHHHHHHHHHH.",
    "..HHSSSSSSSSHH..",
    "..HHSeSSSeSSHH..",
    "..HHSSSSSSSSHH..",
    "..HHSSmmmSSSHH..",
    "..HHSSSSSSSSHH..",
    ".TTTTTTTTTTTTTT.",
    ".TTTcTTTTTTcTTT.",
    ".TTTTcTTTTcTTTT.",
    ".TTTTTccccTTTTT.",
    ".SSTTTTTTTTSw...",
    ".SSTTTTTTTTSw...",
    "..TTTTTTTTTTTT..",
    "..pppppppppppp..",
    "...pppp..pppp...",
    "...pppp..pppp...",
    "...pppp..pppp...",
    "..sssss..sssss..",
    "..sssss..sssss..",
  ];

  const KOTO_RUN0 = [
    "..HHHHHHHHHHHH..",
    ".HHHHHHHHHHHHHH.",
    ".HHHhHHHHHHhHHH.",
    ".HHHHHHHHHHHHHH.",
    ".HHHHHHHHHHHHHH.",
    ".HHHHHHHHHHHHHH.",
    "..HHSSSSSSSSHH..",
    "..HHSeSSSeSSHH..",
    "..HHSSSSSSSSHH..",
    "..HHSSmmmSSSHH..",
    "..HHSSSSSSSSHH..",
    ".TTTTTTTTTTTTTT.",
    ".TTTcTTTTTTcTTT.",
    ".TTTTcTTTTcTTTT.",
    ".TTTTTccccTTTTT.",
    ".SSTTTTTTTTSw...",
    ".SSTTTTTTTTSw...",
    "..TTTTTTTTTTTT..",
    "..pppppppppppp..",
    ".ppp......pppp..",
    "ppp........ppp..",
    "ppp........ppp..",
    "sss........ssss.",
    "sss........ssss.",
    "................",
  ];

  const KOTO_RUN1 = [
    "..HHHHHHHHHHHH..",
    ".HHHHHHHHHHHHHH.",
    ".HHHhHHHHHHhHHH.",
    ".HHHHHHHHHHHHHH.",
    ".HHHHHHHHHHHHHH.",
    ".HHHHHHHHHHHHHH.",
    "..HHSSSSSSSSHH..",
    "..HHSeSSSeSSHH..",
    "..HHSSSSSSSSHH..",
    "..HHSSmmmSSSHH..",
    "..HHSSSSSSSSHH..",
    ".TTTTTTTTTTTTTT.",
    ".TTTcTTTTTTcTTT.",
    ".TTTTcTTTTcTTTT.",
    ".TTTTTccccTTTTT.",
    ".SSTTTTTTTTSw...",
    ".SSTTTTTTTTSw...",
    "..TTTTTTTTTTTT..",
    "..pppppppppppp..",
    "..pppp......ppp.",
    "..ppp........ppp",
    "..ppp........ppp",
    ".ssss........sss",
    ".ssss........sss",
    "................",
  ];

  const KOTO_JUMP = [
    "..HHHHHHHHHHHH..",
    ".HHHHHHHHHHHHHH.",
    ".HHHhHHHHHHhHHH.",
    ".HHHHHHHHHHHHHH.",
    ".HHHHHHHHHHHHHH.",
    ".HHHHHHHHHHHHHH.",
    "..HHSSSSSSSSHH..",
    "..HHSeSSSeSSHH..",
    "..HHSSSSSSSSHH..",
    "..HHSSmmmSSSHH..",
    "..HHSSSSSSSSHH..",
    ".TTTTTTTTTTTTTT.",
    ".TTTcTTTTTTcTTT.",
    ".TTTTcTTTTcTTTT.",
    ".TTTTTccccTTTTT.",
    ".SSTTTTTTTTSw...",
    ".SSTTTTTTTTSw...",
    "..TTTTTTTTTTTT..",
    "..pppppppppppp..",
    "...pppp..pppp...",
    "..pppp....pppp..",
    "..ppp......ppp..",
    "..ss........ss..",
    "..ss........ss..",
    "................",
  ];

  const KOTO_WAVE = [
    "..HHHHHHHHHHHHSS",
    ".HHHHHHHHHHHHHSS",
    ".HHHhHHHHHHhHHSS",
    ".HHHHHHHHHHHHHSS",
    ".HHHHHHHHHHHHHSS",
    ".HHHHHHHHHHHHHSS",
    "..HHSSSSSSSSHSSS",
    "..HHSeSSSeSSHHSS",
    "..HHSSSSSSSSHHSS",
    "..HHSSmmmSSSHHSS",
    "..HHSSSSSSSSHHSS",
    ".TTTTTTTTTTTTTSS",
    ".TTcTTTTTTTTcTSS",
    ".TTTTcTTTTcTTTSS",
    ".TTTTTccccTTTTSS",
    ".SSTTTTTTTTTTTSS",
    ".SSTTTTTTTTTTTSS",
    "..TTTTTTTTTTTT..",
    "..pppppppppppp..",
    "...pppp..pppp...",
    "...pppp..pppp...",
    "...pppp..pppp...",
    "..sssss..sssss..",
    "..sssss..sssss..",
  ];

  const ZUZA_IDLE = [
    "....BBBBBBBB....",
    "..BBBBBBBBBBBB..",
    ".BBBbBBBBBBbBBB.",
    ".BBBBBBBBBBBBBB.",
    "BBBBSSSSSSSSBBB.",
    "BBBBSSSSSSSSBBB.",
    "BBBBGGGGGGGGBBB.",
    "BBBBGGwGGGGBBB..",
    "BBBBSSSSSSSSBBB.",
    "BBBBSSSmmmSSBBB.",
    "BBBBSSSSSSSSBBB.",
    "BBBBTTTTTTTTBB..",
    "BBBBTTTTTTTTSS..",
    "BBBBTTTTTTTTSS..",
    "BBBBTTTTTTTTSS..",
    "BBBTTTTTTTTTTSS.",
    "BBBTTTTTTTTTTSS.",
    "BBBTTTTTTTTTTT..",
    "BBTTTTTTTTTTTTT.",
    "BBTTTTTTTTTTTTT.",
    "BBBB.SS....SS...",
    "BBBB.SS....SS...",
    "BBB.sss...sss...",
    "BBB.sss...sss...",
    "................",
  ];

  const ZUZA_RUN0 = [
    "....BBBBBBBB....",
    "..BBBBBBBBBBBB..",
    ".BBBbBBBBBBbBBB.",
    ".BBBBBBBBBBBBBB.",
    "BBBBSSSSSSSSBBB.",
    "BBBBSSSSSSSSBBB.",
    "BBBBGGGGGGGGBBB.",
    "BBBBGGwGGGGBBB..",
    "BBBBSSSSSSSSBBB.",
    "BBBBSSSmmmSSBBB.",
    "BBBBSSSSSSSSBBB.",
    "BBBBTTTTTTTTBB..",
    "BBBBTTTTTTTTSS..",
    "BBBBTTTTTTTTSS..",
    "BBBBTTTTTTTTSS..",
    "BBBTTTTTTTTTTSS.",
    "BBBTTTTTTTTTTSS.",
    "BBBTTTTTTTTTTT..",
    "BBTTTTTTTTTTTTT.",
    "BBTTTTTTTTTTTTT.",
    "BB.SS......SS...",
    "B.SS........SS..",
    "B.sss......ssss.",
    "B.sss......ssss.",
    "................",
  ];

  const ZUZA_RUN1 = [
    "....BBBBBBBB....",
    "..BBBBBBBBBBBB..",
    ".BBBbBBBBBBbBBB.",
    ".BBBBBBBBBBBBBB.",
    "BBBBSSSSSSSSBBB.",
    "BBBBSSSSSSSSBBB.",
    "BBBBGGGGGGGGBBB.",
    "BBBBGGwGGGGBBB..",
    "BBBBSSSSSSSSBBB.",
    "BBBBSSSmmmSSBBB.",
    "BBBBSSSSSSSSBBB.",
    "BBBBTTTTTTTTBB..",
    "BBBBTTTTTTTTSS..",
    "BBBBTTTTTTTTSS..",
    "BBBBTTTTTTTTSS..",
    "BBBTTTTTTTTTTSS.",
    "BBBTTTTTTTTTTSS.",
    "BBBTTTTTTTTTTT..",
    "BBTTTTTTTTTTTTT.",
    "BBTTTTTTTTTTTTT.",
    "...SS......SS.BB",
    "..SS........SS.B",
    ".ssss......sss.B",
    ".ssss......sss.B",
    "................",
  ];

  const ZUZA_JUMP = [
    "....BBBBBBBB....",
    "..BBBBBBBBBBBB..",
    ".BBBbBBBBBBbBBB.",
    ".BBBBBBBBBBBBBB.",
    "BBBBSSSSSSSSBBB.",
    "BBBBSSSSSSSSBBB.",
    "BBBBGGGGGGGGBBB.",
    "BBBBGGwGGGGBBB..",
    "BBBBSSSSSSSSBBB.",
    "BBBBSSSmmmSSBBB.",
    "BBBBSSSSSSSSBBB.",
    "BBBBTTTTTTTTBB..",
    "BBBBTTTTTTTTSS..",
    "BBBBTTTTTTTTSS..",
    "BBBBTTTTTTTTSS..",
    "BBBTTTTTTTTTTSS.",
    "BBBTTTTTTTTTTSS.",
    "BBBTTTTTTTTTTT..",
    "BBTTTTTTTTTTTTT.",
    "BBTTTTTTTTTTTTT.",
    "BBB.SS....SS....",
    "BBB.SS....SS....",
    "BB.sss...sss....",
    "BB.sss...sss....",
    "................",
  ];

  const ZUZA_WAVE = [
    "....BBBBBBBB....",
    "..BBBBBBBBBBBB..",
    ".BBBbBBBBBBbBBB.",
    ".BBBBBBBBBBBBBB.",
    "BBBBSSSSSSSSBSS.",
    "BBBBSSSSSSSSBSS.",
    "BBBBGGGGGGGGBSS.",
    "BBBBGGwGGGGBBSS.",
    "BBBBSSSSSSSSBSS.",
    "BBBBSSSmmmSSBSS.",
    "BBBBSSSSSSSSBSS.",
    "BBBBTTTTTTTTBSS.",
    "BBBBTTTTTTTTSSS.",
    "BBBBTTTTTTTTSSS.",
    "BBBBTTTTTTTTSSS.",
    "BBBTTTTTTTTTTSS.",
    "BBBTTTTTTTTTTSS.",
    "BBBTTTTTTTTTTT..",
    "BBTTTTTTTTTTTTT.",
    "BBTTTTTTTTTTTTT.",
    "BBBB.SS....SS...",
    "BBBB.SS....SS...",
    "BBB.sss...sss...",
    "BBB.sss...sss...",
    "................",
  ];

  // ---- enemies (16x16) ----
  const MARU0 = [
    ".....OOOOOO.....",
    "...OOOOOOOOOO...",
    "..OOOOOOOOOOOO..",
    ".OOOOOOOOOOOOOO.",
    ".OOeOOOOOOeOOOO.",
    ".OOOOOOOOOOOOOO.",
    ".OOOrOOOOOrOOOO.",
    "..OOOOOOOOOOOO..",
    "..OOOOOOOOOOOO..",
    "...OOOOOOOOOO...",
    "....OOOOOOOO....",
    "....OOOOOOOO....",
    "....OOO..OOO....",
    "....ff....ff....",
    "...fff....fff...",
    "...fff....fff...",
  ];
  const MARU1 = [
    ".....OOOOOO.....",
    "...OOOOOOOOOO...",
    "..OOOOOOOOOOOO..",
    ".OOOOOOOOOOOOOO.",
    ".OOeOOOOOOeOOOO.",
    ".OOOOOOOOOOOOOO.",
    ".OOOrOOOOOrOOOO.",
    "..OOOOOOOOOOOO..",
    "..OOOOOOOOOOOO..",
    "...OOOOOOOOOO...",
    "....OOOOOOOO....",
    "....OOOOOOOO....",
    "....OOO..OOO....",
    "....ff....ff....",
    "....fff..fff....",
    "....fff..fff....",
  ];

  const TOGE0 = [
    "...W..W..W......",
    "..WWW.WW.WWW....",
    ".VVVVVVVVVVVVVV.",
    "WVVVVVVVVVVVVVVW",
    "WVVYVVVVVVYVVVVW",
    "WVVVVVVVVVVVVVVW",
    "WVVVVVVVVVVVVVVW",
    "WVVVVVVVVVVVVVVW",
    "WVVVVVVVVVVVVVVW",
    "WVVVVVVVVVVVVVVW",
    "WVVVVVVVVVVVVVVW",
    ".VVVVVVVVVVVVVV.",
    "..VVVVVVVVVVVV..",
    "..W..W..W..W....",
    "................",
    "................",
  ];
  const TOGE1 = [
    "......W..W..W...",
    "....WWW.WW.WWW..",
    ".VVVVVVVVVVVVVV.",
    "WVVVVVVVVVVVVVVW",
    "WVVVVYVVVVVVYVVW",
    "WVVVVVVVVVVVVVVW",
    "WVVVVVVVVVVVVVVW",
    "WVVVVVVVVVVVVVVW",
    "WVVVVVVVVVVVVVVW",
    "WVVVVVVVVVVVVVVW",
    "WVVVVVVVVVVVVVVW",
    ".VVVVVVVVVVVVVV.",
    "..VVVVVVVVVVVV..",
    "....W..W..W..W..",
    "................",
    "................",
  ];

  const PATA0 = [
    "..WW........WW..",
    ".WWW........WWW.",
    ".WWW..PPPP..WWW.",
    "..WW.PPPPPP.WW..",
    ".....PePPeP.....",
    ".....PPPPPP.....",
    "....PPPPPPPP....",
    "....PPPPPPPP....",
    ".....PPPPPP.....",
    "......PPPP......",
    ".....pp..pp.....",
    "................",
    "................",
    "................",
    "................",
    "................",
  ];
  const PATA1 = [
    "................",
    "................",
    "......PPPP......",
    ".....PPPPPP.....",
    ".....PePPeP.....",
    ".WW..PPPPPP..WW.",
    ".WWW.PPPPPPPWWWW",
    ".WW..PPPPPP..WW.",
    ".....PPPPPP.....",
    "......PPPP......",
    ".....pp..pp.....",
    "................",
    "................",
    "................",
    "................",
    "................",
  ];

  const HEART = [
    "................",
    "..RRR....RRR....",
    ".RRRRR..RRRRR...",
    ".RRwRRRRRRRRRR..",
    ".RRRRRRRRRRRRR..",
    ".RRRRRRRRRRRRR..",
    "..RRRRRRRRRRR...",
    "..RRRRRRRRRRR...",
    "...RRRRRRRRR....",
    "....RRRRRRR.....",
    ".....RRRRR......",
    "......RRR.......",
    ".......R........",
    "................",
    "................",
    "................",
  ];

  const SPARK = [
    "..RRRR..",
    ".RwRRRR.",
    "RRRRRRRR",
    "RRRRRRRR",
    ".RRRRRR.",
    "..RRRR..",
    "...RR...",
    "........",
  ];

  // dead/sad eyes variant is generated at runtime (same body, x eyes)
  function withEyes(rows, ch) {
    return rows.map(r => r.replace(/e/g, ch));
  }

  function mk(rows, scale) {
    const h = rows.length, w = rows[0].length;
    const c = document.createElement('canvas');
    c.width = w * scale; c.height = h * scale;
    const g = c.getContext('2d');
    for (let y = 0; y < h; y++) {
      const row = rows[y];
      for (let x = 0; x < row.length; x++) {
        const col = PAL[row[x]];
        if (!col) continue;
        g.fillStyle = col;
        g.fillRect(x * scale, y * scale, scale, scale);
      }
    }
    return c;
  }

  SK.buildSprites = function () {
    const S = 2;
    SK.spr = {
      koto: {
        idle: mk(KOTO_IDLE, S),
        run0: mk(KOTO_RUN0, S),
        run1: mk(KOTO_RUN1, S),
        jump: mk(KOTO_JUMP, S),
        dead: mk(withEyes(KOTO_IDLE, 'x'), S),
        wave: mk(KOTO_WAVE, S),
      },
      zuza: {
        idle: mk(ZUZA_IDLE, S),
        run0: mk(ZUZA_RUN0, S),
        run1: mk(ZUZA_RUN1, S),
        jump: mk(ZUZA_JUMP, S),
        dead: mk(ZUZA_IDLE, S),
        wave: mk(ZUZA_WAVE, S),
      },
      maru: [mk(MARU0, S), mk(MARU1, S)],
      toge: [mk(TOGE0, S), mk(TOGE1, S)],
      pata: [mk(PATA0, S), mk(PATA1, S)],
      heart: mk(HEART, S),
      spark: mk(SPARK, S),
    };
  };
})();
