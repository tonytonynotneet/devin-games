/* dream-home sprites — chibi pixel characters + shared draw helpers.
   DH.sprites.drawPlayer(ctx, p) draws a walking character at its px pos (origin = feet center).
   p.char is "koto" | "zuza"; p.dir is one of "down","up","left","right"; p.step is anim phase 0..1.
*/
(function () {
  const DH = (window.DH = window.DH || {});
  const SKIN = "#f2c9a0", BLACK = "#241a24", BROWN = "#4a2c14", SHIRT = "#1c1c22";

  function drawChar(ctx, x, y, char, dir, step, scale = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    const bob = Math.sin(step * Math.PI * 2) * 1.2;
    const leg = Math.sin(step * Math.PI * 2) * 2.5;
    ctx.translate(0, bob * -0.5);

    // legs
    ctx.fillStyle = "#2a2a33";
    ctx.fillRect(-6, -8, 5, 8 + (leg > 0 ? leg : 0));
    ctx.fillRect(1, -8, 5, 8 + (leg < 0 ? -leg : 0));
    // body (black outfit)
    ctx.fillStyle = SHIRT;
    ctx.fillRect(-8, -20, 16, 13);
    // arms
    ctx.fillRect(-11, -19, 4, 10);
    ctx.fillRect(7, -19, 4, 10);

    if (char === "zuza") {
      // long dark-brown hair behind + over shoulders
      ctx.fillStyle = BROWN;
      ctx.fillRect(-9, -34, 18, 26);
      ctx.fillStyle = "#5a3a20";
      ctx.fillRect(-9, -22, 3, 14); ctx.fillRect(6, -22, 3, 14);
    }

    // head
    ctx.fillStyle = SKIN;
    ctx.fillRect(-7, -32, 14, 13);

    if (char === "koto") {
      // black bowl cut with heavy bangs
      ctx.fillStyle = BLACK;
      ctx.fillRect(-8, -34, 16, 7);
      ctx.fillRect(-8, -28, 3, 6); ctx.fillRect(5, -28, 3, 6);
      ctx.fillRect(-7, -27, 14, 4); // heavy fringe
    } else {
      // zuza fringe under hair
      ctx.fillStyle = BROWN;
      ctx.fillRect(-8, -34, 16, 5);
    }

    // face
    if (char === "zuza") {
      ctx.fillStyle = "#111";
      ctx.fillRect(-6, -25, 12, 4); // sunglasses band
      ctx.fillStyle = "#ffffff88"; ctx.fillRect(-5, -25, 3, 1);
    } else {
      const look = dir === "left" ? -1.5 : dir === "right" ? 1.5 : 0;
      ctx.fillStyle = "#1a1a1a";
      ctx.fillRect(-4 + look, -25, 2, 3);
      ctx.fillRect(2 + look, -25, 2, 3);
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
    drawPlayer(ctx, p) { drawChar(ctx, p.x, p.y, p.char, p.dir, p.step); },
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
