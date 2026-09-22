/* Air Hockey — chibi pixel portraits on the mallets.
   Same characters as super-koto:
   - koto: black bowl-cut hair with heavy bangs, black tee, silver chain, watch.
   - zuza: very long straight dark-brown hair, black sunglasses, black outfit.
   Each portrait is a 16x16 grid of characters mapped through a palette,
   pre-rendered to a small offscreen canvas once at load. */
window.AH = window.AH || {};

(function () {
  const PAL = {
    '.': null,
    S: '#f0c8a0', // skin
    e: '#241a20', // eyes
    m: '#d4717f', // mouth
    H: '#241a24', // koto hair
    h: '#453245', // koto hair shine
    B: '#35200f', // zuza hair
    b: '#5a3a20', // zuza hair shine
    G: '#12101c', // sunglasses
    T: '#1b1520', // black outfit
    c: '#d8deea', // silver chain
    w: '#e8ecf4', // watch / lens shine
  };

  // koto — bowl-cut bangs, black tee, silver chain, watch on the left wrist
  const KOTO = [
    "..HHHHHHHHHHHH..",
    ".HHHHHHHHHHHHHH.",
    ".HHhHHHHHHHHhHH.",
    "HHHHHHHHHHHHHHHH",
    "HHSHSSSSSSSSHSHH",
    "HSSeSSSSSSSeSSSH",
    "HSSSSSSSSSSSSSSH",
    ".SSSSmmmmSSSSSS.",
    ".SSSSSSSSSSSSSS.",
    ".TTSSSSSSSSSSTT.",
    ".TTTTTTTTTTTTTT.",
    "TTTcTTTTTTTTcTTT",
    "TTTTTcTTTTcTTTTT",
    "SwTTTTTccTTTTTTS",
    ".TTTTTTTTTTTTTT.",
    "..TTTTTTTTTTTT..",
  ];

  // zuza — long dark-brown hair framing the face, black sunglasses, black outfit
  const ZUZA = [
    "....BBBBBBBB....",
    "..BBBBBBBBBBBB..",
    ".BBBbBBBBBBbBBB.",
    "BBBBBBBBBBBBBBBB",
    "BBBSSSSSSSSSSBBB",
    "BBBGGGGGGGGGGBBB",
    "BBBGwGGGGGGGGBBB",
    "BBBSSSSSSSSSSBBB",
    "BBBSSSmmmSSSBBB.",
    "BBBSSSSSSSSSSBB.",
    "BBTSSSSSSSSSSTBB",
    "BBTTTTTTTTTTTTBB",
    "BBTTTTTTTTTTTTBB",
    "BBTTTTTTTTTTTTBB",
    ".BBBTTTTTTTBBB..",
    "................",
  ];

  function mk(rows) {
    const S = 2;
    const c = document.createElement('canvas');
    c.width = rows[0].length * S;
    c.height = rows.length * S;
    const g = c.getContext('2d');
    for (let y = 0; y < rows.length; y++) {
      const row = rows[y];
      for (let x = 0; x < row.length; x++) {
        const col = PAL[row[x]];
        if (!col) continue;
        g.fillStyle = col;
        g.fillRect(x * S, y * S, S, S);
      }
    }
    return c;
  }

  AH.buildCharacters = function () {
    AH.faces = { koto: mk(KOTO), zuza: mk(ZUZA) };
  };

  // mallet: neon accent ring + the character's face on the center knob
  AH.drawMallet = function (g, m) {
    const knob = m.r * 0.62;
    g.shadowBlur = 20;
    g.shadowColor = m.color;
    g.fillStyle = m.color;
    g.beginPath();
    g.arc(m.x, m.y, m.r, 0, Math.PI * 2);
    g.fill();
    g.shadowBlur = 0;

    g.strokeStyle = 'rgba(10,9,20,.35)';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(m.x, m.y, m.r * 0.8, 0, Math.PI * 2);
    g.stroke();

    g.fillStyle = 'rgba(15,14,26,.85)';
    g.beginPath();
    g.arc(m.x, m.y, knob, 0, Math.PI * 2);
    g.fill();

    const face = AH.faces && AH.faces[m.face];
    if (face) {
      g.save();
      g.beginPath();
      g.arc(m.x, m.y, knob - 1, 0, Math.PI * 2);
      g.clip();
      g.imageSmoothingEnabled = false;
      g.drawImage(face, m.x - knob, m.y - knob, knob * 2, knob * 2);
      g.restore();
    }

    g.strokeStyle = 'rgba(255,255,255,.5)';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(m.x, m.y, knob, 0, Math.PI * 2);
    g.stroke();
  };
})();
