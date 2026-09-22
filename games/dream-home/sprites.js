/* dream-home sprites — chibi pixel characters + shared draw helpers.
   DH.sprites.drawPlayer(ctx, p) draws a walking character at its px pos (origin = feet center).
   p.char is "koto" | "zuza"; p.dir is one of "down","up","left","right"; p.step is anim phase 0..1.
*/
(function () {
  const DH = (window.DH = window.DH || {});
  const SKIN = "#f2c9a0", SKIN_D = "#d9a878", BLACK = "#241a24", BROWN = "#4a2c14", SHIRT = "#1c1c22";

  function drawChar(ctx, x, y, char, dir, step, scale = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    const bob = Math.sin(step * Math.PI * 2) * 1.2;              // walk bounce
    const idle = Math.sin(Date.now() / 520 + x * 0.11) * 0.7;    // breathing when idle
    const leg = Math.sin(step * Math.PI * 2) * 2.5;              // leg swing
    const arm = Math.sin(step * Math.PI * 2) * 1.8;              // arms counter-swing
    const facingUp = dir === "up";
    ctx.translate(0, (bob + idle) * -0.5);

    // legs + shoes
    ctx.fillStyle = "#2a2a33";
    ctx.fillRect(-6, -8, 5, 8 + (leg > 0 ? leg : 0));
    ctx.fillRect(1, -8, 5, 8 + (leg < 0 ? -leg : 0));
    ctx.fillStyle = "#15151c";
    ctx.fillRect(-6, -2 + Math.max(0, leg), 5, 2);
    ctx.fillRect(1, -2 + Math.max(0, -leg), 5, 2);

    // body (black outfit) + hem highlight
    ctx.fillStyle = SHIRT;
    ctx.fillRect(-8, -20, 16, 13);
    ctx.fillStyle = "#2e2e3a"; ctx.fillRect(-8, -20, 16, 2);
    ctx.fillStyle = "#121218"; ctx.fillRect(-8, -9, 16, 2);
    // arms swing opposite to the legs
    ctx.fillStyle = SHIRT;
    ctx.fillRect(-11, -19 + arm * 0.6, 4, 10);
    ctx.fillRect(7, -19 - arm * 0.6, 4, 10);
    ctx.fillStyle = SKIN;
    ctx.fillRect(-11, -10 + arm * 0.6, 4, 2);  // hands
    ctx.fillRect(7, -10 - arm * 0.6, 4, 2);

    if (char === "zuza") {
      // very long straight dark-brown hair — falls behind back and over shoulders
      ctx.fillStyle = BROWN;
      ctx.fillRect(-9, -34, 18, 26);
      ctx.fillStyle = "#5a3a20";
      ctx.fillRect(-9, -22, 3, 14); ctx.fillRect(6, -22, 3, 14);
      ctx.fillStyle = "#6a4526"; ctx.fillRect(-7, -32, 2, 22);   // highlight strand
    }

    // head
    ctx.fillStyle = SKIN;
    ctx.fillRect(-7, -32, 14, 13);
    ctx.fillStyle = SKIN_D; ctx.fillRect(-7, -21, 14, 2);        // jaw/neck shadow
    ctx.fillStyle = "#ffe0bb"; ctx.fillRect(-6, -31, 5, 2);      // top-lit edge

    if (char === "koto") {
      // black bowl cut with heavy bangs
      ctx.fillStyle = BLACK;
      ctx.fillRect(-8, -34, 16, 7);
      ctx.fillRect(-8, -28, 3, 6); ctx.fillRect(5, -28, 3, 6);
      ctx.fillRect(-7, -27, 14, 4); // heavy fringe
      ctx.fillStyle = "#3a2e3d"; ctx.fillRect(-6, -33, 6, 2);    // hair shine
      if (facingUp) ctx.fillRect(-8, -27, 16, 9);                // back of the cut
    } else {
      // zuza fringe under hair
      ctx.fillStyle = BROWN;
      ctx.fillRect(-8, -34, 16, 5);
      if (facingUp) ctx.fillRect(-8, -29, 16, 11);               // hair covers face
    }

    // face (hidden when facing away)
    if (!facingUp) {
      if (char === "zuza") {
        ctx.fillStyle = "#111";
        ctx.fillRect(-6, -25, 12, 4); // sunglasses band
        ctx.fillStyle = "#ffffff88"; ctx.fillRect(-5, -25, 3, 1);
        ctx.fillRect(-6, -21, 12, 1); // frame edge
      } else {
        const look = dir === "left" ? -1.5 : dir === "right" ? 1.5 : 0;
        ctx.fillStyle = "#1a1a1a";
        ctx.fillRect(-4 + look, -25, 2, 3);
        ctx.fillRect(2 + look, -25, 2, 3);
        ctx.fillStyle = "#ffffff66"; ctx.fillRect(-4 + look, -25, 1, 1);
        ctx.fillRect(2 + look, -25, 1, 1);
      }
      ctx.fillStyle = "#e0a878"; ctx.fillRect(-1, -21, 2, 1);    // tiny nose/mouth shade
    }

    if (char === "koto") {
      // silver chain + watch
      ctx.strokeStyle = "#d9d9e2"; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(0, -14, 4, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
      ctx.fillStyle = "#e8e8f0"; ctx.fillRect(-11, -11, 3, 3);
      ctx.fillStyle = "#555"; ctx.fillRect(-11, -12, 3, 1);
    }
    ctx.restore();
  }

  DH.sprites = {
    drawPlayer(ctx, p) { drawChar(ctx, p.x, p.y, p.char, p.dir, p.moving === false ? 0 : p.step); },
    drawChar,
    // small helpers for other modules
    heart(ctx, x, y, s = 6, color = "#ff5b7f") {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x, y + s * 0.35);
      ctx.bezierCurveTo(x - s, y - s * 0.5, x - s * 0.4, y - s * 1.15, x, y - s * 0.45);
      ctx.bezierCurveTo(x + s * 0.4, y - s * 1.15, x + s, y - s * 0.5, x, y + s * 0.35);
      ctx.fill();
    },
    sad(ctx, x, y, s = 7) { // ☹️-style bubble marker
      ctx.fillStyle = "#ffd76b";
      ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#4a3a1a";
      ctx.fillRect(x - s * 0.45, y - s * 0.35, 1.5, 1.5);
      ctx.fillRect(x + s * 0.35, y - s * 0.35, 1.5, 1.5);
      ctx.beginPath(); ctx.arc(x, y + s * 0.75, s * 0.4, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
      ctx.strokeStyle = "#4a3a1a"; ctx.stroke();
    },
    shadow(ctx, x, y, w = 18) {
      ctx.fillStyle = "#00000028";
      ctx.beginPath(); ctx.ellipse(x, y, w / 2, w / 5, 0, 0, Math.PI * 2); ctx.fill();
    },
  };
})();
