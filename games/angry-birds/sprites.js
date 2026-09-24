// All drawing for the slingshot game: koto/zuza birds, pigs, cracked blocks,
// slingshot, parallax background, particles. Canvas vector art (no images).
(() => {
'use strict';
const AB = window.AB = window.AB || {};
const SPR = AB.sprites = {};

const TAU = Math.PI * 2;

// ---------- materials ----------
SPR.MAT = {
  ice:   { fill: '#aee3f5', edge: '#7fc4e8', dark: '#5fa8d3', crack: '#ffffff' },
  wood:  { fill: '#b5793d', edge: '#8a5a28', dark: '#6b421c', crack: '#3d2410' },
  stone: { fill: '#9aa0ad', edge: '#6d7280', dark: '#4c515c', crack: '#2e3238' },
};

SPR.drawBlock = (ctx, b) => {
  const mat = SPR.MAT[b.data.mat] || SPR.MAT.wood;
  ctx.save();
  ctx.translate(b.x, b.y); ctx.rotate(b.angle);
  ctx.beginPath();
  const vs = b.kind.verts;
  ctx.moveTo(vs[0][0], vs[0][1]);
  for (let i = 1; i < vs.length; i++) ctx.lineTo(vs[i][0], vs[i][1]);
  ctx.closePath();
  ctx.fillStyle = mat.fill; ctx.fill();
  ctx.lineWidth = 2.5; ctx.strokeStyle = mat.edge; ctx.stroke();
  // material texture hints
  const xs = vs.map(v => v[0]), ys = vs.map(v => v[1]);
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
  const hw = Math.min(...xs), hh = Math.min(...ys);
  if (b.data.mat === 'wood') {
    ctx.strokeStyle = mat.dark; ctx.lineWidth = 1.2; ctx.globalAlpha = 0.55;
    for (let i = 1; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(hw + 3, hh + h * i / 3 + Math.sin(i * 7) * 1.5);
      ctx.lineTo(hw + w - 3, hh + h * i / 3 + Math.cos(i * 5) * 1.5);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  } else if (b.data.mat === 'ice') {
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.beginPath(); ctx.moveTo(hw + 3, hh + h - 4); ctx.lineTo(hw + w * 0.45, hh + 3); ctx.lineTo(hw + w * 0.7, hh + 3); ctx.lineTo(hw + 8, hh + h - 4); ctx.closePath(); ctx.fill();
  } else {
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    for (let i = 0; i < 3; i++) ctx.fillRect(hw + 4 + i * (w / 3.4), hh + 4 + (i % 2) * (h / 2.4), w / 5, h / 6);
  }
  // crack stages by hp fraction
  const frac = b.hp / b.maxHp;
  if (frac < 0.66) {
    ctx.strokeStyle = mat.crack; ctx.lineWidth = 1.6; ctx.globalAlpha = frac < 0.33 ? 0.95 : 0.7;
    ctx.beginPath();
    ctx.moveTo(hw + w * 0.2, hh + 2); ctx.lineTo(hw + w * 0.45, hh + h * 0.5); ctx.lineTo(hw + w * 0.3, hh + h - 2);
    if (frac < 0.33) {
      ctx.moveTo(hw + w * 0.8, hh + 3); ctx.lineTo(hw + w * 0.55, hh + h * 0.55); ctx.lineTo(hw + w * 0.75, hh + h - 3);
      ctx.moveTo(hw + w * 0.45, hh + h * 0.5); ctx.lineTo(hw + w * 0.62, hh + h * 0.42);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  if (b.hitFlash > 0) { ctx.globalAlpha = Math.min(0.5, b.hitFlash); ctx.fillStyle = '#fff'; ctx.fill(); ctx.globalAlpha = 1; }
  ctx.restore();
};

// ---------- birds (koto & zuza variants) ----------
// kinds: 'koto' (standard) 'koto-dash' 'zuza' (split) 'zuza-bomb'
SPR.BIRD = {
  'koto':      { body: '#3a3f52', belly: '#e8e4da', accent: '#22d3ee', hair: '#14161f', size: 16 },
  'koto-dash': { body: '#3a3f52', belly: '#e8e4da', accent: '#22d3ee', hair: '#14161f', size: 15, visor: true },
  'zuza':      { body: '#4a3038', belly: '#efe4e4', accent: '#ff2d95', hair: '#2c1e24', size: 14, glasses: true },
  'zuza-bomb': { body: '#26262e', belly: '#3a3038', accent: '#a855f7', hair: '#2c1e24', size: 19, glasses: true, fuse: true },
};
SPR.drawBird = (ctx, b) => {
  const def = SPR.BIRD[b.data.kind] || SPR.BIRD.koto;
  const r = b.kind.r;
  ctx.save();
  ctx.translate(b.x, b.y); ctx.rotate(b.angle * 0.35);
  // tail feathers (behind)
  ctx.fillStyle = def.hair;
  ctx.beginPath(); ctx.moveTo(-r * 0.9, -r * 0.15); ctx.lineTo(-r * 1.5, -r * 0.55); ctx.lineTo(-r * 1.35, -r * 0.1); ctx.lineTo(-r * 1.55, r * 0.35); ctx.closePath(); ctx.fill();
  // body
  ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU);
  ctx.fillStyle = def.body; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.stroke();
  // belly
  ctx.beginPath(); ctx.ellipse(0, r * 0.42, r * 0.62, r * 0.5, 0, 0, TAU);
  ctx.fillStyle = def.belly; ctx.fill();
  // hair tuft on top — koto: cyan streak; zuza: magenta streaks
  ctx.strokeStyle = def.hair; ctx.lineWidth = r * 0.22; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-r * 0.3, -r * 0.85); ctx.lineTo(-r * 0.1, -r * 1.25); ctx.stroke();
  ctx.strokeStyle = def.accent; ctx.lineWidth = r * 0.16;
  ctx.beginPath(); ctx.moveTo(r * 0.05, -r * 0.9); ctx.lineTo(r * 0.3, -r * 1.3); ctx.stroke();
  // beak
  ctx.fillStyle = '#f5a623';
  ctx.beginPath(); ctx.moveTo(r * 0.55, -r * 0.05); ctx.lineTo(r * 1.15, r * 0.18); ctx.lineTo(r * 0.55, r * 0.4); ctx.closePath(); ctx.fill();
  // eye / glasses
  if (def.glasses) {
    ctx.fillStyle = '#111';
    ctx.fillRect(r * 0.05, -r * 0.5, r * 0.62, r * 0.34);
    ctx.strokeStyle = def.accent; ctx.lineWidth = 1.5; ctx.strokeRect(r * 0.05, -r * 0.5, r * 0.62, r * 0.34);
  } else {
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(r * 0.3, -r * 0.28, r * 0.26, 0, TAU); ctx.fill();
    ctx.fillStyle = '#14161f'; ctx.beginPath(); ctx.arc(r * 0.38, -r * 0.28, r * 0.13, 0, TAU); ctx.fill();
    if (def.visor) { // dash visor stripe
      ctx.strokeStyle = def.accent; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(-r * 0.5, -r * 0.42); ctx.lineTo(r * 0.75, -r * 0.42); ctx.stroke();
    }
    // angry brow
    ctx.strokeStyle = def.hair; ctx.lineWidth = r * 0.14; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(r * 0.02, -r * 0.62); ctx.lineTo(r * 0.58, -r * 0.42); ctx.stroke();
  }
  if (def.fuse) { // bomb fuse
    ctx.strokeStyle = '#666'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -r * 1.05); ctx.quadraticCurveTo(r * 0.2, -r * 1.5, r * 0.45, -r * 1.45); ctx.stroke();
    ctx.fillStyle = '#ffdd44'; ctx.beginPath(); ctx.arc(r * 0.5, -r * 1.47, 3, 0, TAU); ctx.fill();
  }
  if (b.data.kind === 'koto') { // silver chain
    ctx.strokeStyle = '#c8cdd8'; ctx.lineWidth = 2; ctx.setLineDash([2.5, 2]);
    ctx.beginPath(); ctx.arc(0, r * 0.45, r * 0.5, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
};

// ---------- pigs ----------
SPR.drawPig = (ctx, b) => {
  const r = b.kind.r, v = b.data.variant || 'plain';
  ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.angle * 0.3);
  // ears
  ctx.fillStyle = '#79c144';
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(s * r * 0.55, -r * 0.72, r * 0.28, 0, TAU); ctx.fill(); ctx.strokeStyle = '#4e8f2a'; ctx.lineWidth = 1.5; ctx.stroke(); }
  // body
  ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU);
  ctx.fillStyle = '#8ed158'; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = '#4e8f2a'; ctx.stroke();
  // snout
  ctx.fillStyle = '#b7e389';
  ctx.beginPath(); ctx.ellipse(0, r * 0.12, r * 0.4, r * 0.3, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#4e8f2a'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = '#4e8f2a';
  ctx.beginPath(); ctx.arc(-r * 0.13, r * 0.12, r * 0.06, 0, TAU); ctx.arc(r * 0.13, r * 0.12, r * 0.06, 0, TAU); ctx.fill();
  // eyes
  for (const s of [-1, 1]) {
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(s * r * 0.34, -r * 0.3, r * 0.19, 0, TAU); ctx.fill();
    ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(s * r * 0.34, -r * 0.28, r * 0.09, 0, TAU); ctx.fill();
  }
  if (v === 'helmet') {
    ctx.fillStyle = '#5b6470';
    ctx.beginPath(); ctx.arc(0, -r * 0.15, r * 0.95, Math.PI, TAU); ctx.fill();
    ctx.strokeStyle = '#3a4048'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#8d97a5'; ctx.fillRect(-r * 0.95, -r * 0.28, r * 1.9, r * 0.14);
  } else if (v === 'stash') {
    ctx.fillStyle = '#3a2c20';
    ctx.beginPath(); ctx.ellipse(0, r * 0.52, r * 0.45, r * 0.16, 0, 0, Math.PI); ctx.fill();
  }
  if (b.hitFlash > 0) { ctx.globalAlpha = Math.min(0.6, b.hitFlash); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill(); ctx.globalAlpha = 1; }
  ctx.restore();
};

// ---------- slingshot ----------
SPR.drawSlingBack = (ctx, x, y) => {
  ctx.strokeStyle = '#5a3d22'; ctx.lineWidth = 7; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x, y + 34); ctx.lineTo(x - 4, y - 12); ctx.stroke(); // back fork behind bird
};
SPR.drawSlingFront = (ctx, x, y) => {
  ctx.strokeStyle = '#7a5230'; ctx.lineWidth = 8; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x + 6, y + 34); ctx.lineTo(x + 10, y - 10); ctx.stroke();
  ctx.fillStyle = '#8a5a28'; ctx.fillRect(x - 8, y + 32, 22, 6);
};
SPR.drawBand = (ctx, x1, y1, x2, y2, back) => {
  ctx.strokeStyle = back ? '#3a2a1a' : '#54371c';
  ctx.lineWidth = back ? 4 : 5; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
};

// ---------- background (parallax) ----------
SPR.drawBackground = (ctx, camX, W, H, theme) => {
  const day = theme === 'day';
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, day ? '#79c8f0' : '#0d1030');
  sky.addColorStop(1, day ? '#cdeffb' : '#2a1f52');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
  if (!day) { // stars
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    for (let i = 0; i < 40; i++) {
      const sx = (i * 137.5 - camX * 0.05) % (W + 40), sy = (i * 61.8) % (H * 0.6);
      ctx.fillRect(((sx % (W + 40)) + W + 40) % (W + 40) - 20, sy, 1.6, 1.6);
    }
  }
  // far hills
  ctx.fillStyle = day ? '#8fc98f' : '#1a2140';
  ctx.beginPath(); ctx.moveTo(0, H * 0.75);
  for (let x = 0; x <= W; x += 40) ctx.lineTo(x, H * 0.75 - 30 - Math.sin((x + camX * 0.15) * 0.008) * 26);
  ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.fill();
  // near hills / leaves layer (video: faster when close)
  ctx.fillStyle = day ? '#5aa85a' : '#252c58';
  ctx.beginPath(); ctx.moveTo(0, H * 0.82);
  for (let x = 0; x <= W; x += 30) ctx.lineTo(x, H * 0.82 - 16 - Math.sin((x + camX * 0.35) * 0.014) * 18);
  ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.fill();
};
SPR.drawGround = (ctx, gx, gy, gw, theme) => {
  const day = theme === 'day';
  ctx.fillStyle = day ? '#6fb060' : '#1c2244';
  ctx.fillRect(gx, gy, gw, 900);
  ctx.fillStyle = day ? '#8ed158' : '#2a3168';
  ctx.fillRect(gx, gy, gw, 10);
};

// ---------- particles ----------
SPR.makeParticles = () => ({ list: [] });
SPR.burst = (P, x, y, col, n = 10, spread = 260) => {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, s = (0.3 + Math.random() * 0.7) * spread;
    P.list.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 80, life: 0.5 + Math.random() * 0.5, t: 0, col, r: 2 + Math.random() * 3 });
  }
};
SPR.debris = (P, x, y, mat) => SPR.burst(P, x, y, (SPR.MAT[mat] || SPR.MAT.wood).fill, 12, 300);
SPR.updateParticles = (P, dt, G) => {
  for (const p of P.list) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += G * 0.5 * dt; }
  P.list = P.list.filter(p => p.t < p.life);
};
SPR.drawParticles = (ctx, P) => {
  for (const p of P.list) {
    ctx.globalAlpha = Math.max(0, 1 - p.t / p.life);
    ctx.fillStyle = p.col;
    ctx.fillRect(p.x - p.r / 2, p.y - p.r / 2, p.r, p.r);
  }
  ctx.globalAlpha = 1;
};

// smoke trail marks
SPR.trail = (P, x, y) => {
  P.list.push({ x, y, vx: 0, vy: -6, life: 1.4, t: 0.6, col: 'rgba(255,255,255,0.5)', r: 3.5 });
};

// ---------- HUD icons ----------
SPR.drawBirdIcon = (ctx, x, y, kind, dim) => {
  const def = SPR.BIRD[kind] || SPR.BIRD.koto;
  ctx.globalAlpha = dim ? 0.35 : 1;
  ctx.beginPath(); ctx.arc(x, y, 11, 0, TAU); ctx.fillStyle = def.body; ctx.fill();
  ctx.strokeStyle = def.accent; ctx.lineWidth = 2; ctx.stroke();
  ctx.beginPath(); ctx.arc(x + 3, y - 2, 2.5, 0, TAU); ctx.fillStyle = '#fff'; ctx.fill();
  ctx.globalAlpha = 1;
};
})();
