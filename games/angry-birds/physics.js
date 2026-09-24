// Compact rigid-body engine for the slingshot game — circles + convex polygons,
// sequential impulse with warm starting, friction/restitution, sleep islands.
// Units: pixels, seconds, radians. y points down.
(() => {
'use strict';
const PH = {};
let NEXT_ID = 1;

PH.circle = (x, y, r, opts = {}) => body('circle', x, y, { r }, opts);
PH.poly = (x, y, verts, opts = {}) => body('poly', x, y, { verts }, opts);
PH.box = (x, y, w, h, opts = {}) => {
  const hw = w / 2, hh = h / 2;
  return body('poly', x, y, { verts: [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]] }, opts);
};
PH.tri = (x, y, w, h, opts = {}) =>
  body('poly', x, y, { verts: [[-w / 2, h / 2], [w / 2, h / 2], [0, -h / 2]] }, opts);

function body(kind, x, y, shape, o) {
  const b = {
    id: NEXT_ID++, kind: shape, x, y,
    angle: o.angle || 0, vx: 0, vy: 0, va: 0,
    invM: 0, invI: 0,
    restitution: o.restitution ?? 0.05,
    friction: o.friction ?? 0.5,
    stat: !!o.stat,
    tag: o.tag || 'body',
    hp: o.hp ?? 10, maxHp: o.hp ?? 10,
    threshold: o.threshold ?? 0,      // impulse barrier subtracted from damage
    dmgScale: o.dmgScale ?? 1,
    score: o.score ?? 0,
    asleep: false, sleepT: 0,
    dead: false, fixed: !!o.stat,
    data: o.data || null,
    hitFlash: 0,
  };
  if (!b.stat) {
    let m, I;
    if (kind === 'circle') {
      m = (o.density ?? 0.0016) * Math.PI * shape.r * shape.r;
      I = 0.5 * m * shape.r * shape.r;
    } else {
      let area = 0;
      for (let i = 0; i < shape.verts.length; i++) {
        const [x1, y1] = shape.verts[i], [x2, y2] = shape.verts[(i + 1) % shape.verts.length];
        area += x1 * y2 - x2 * y1;
      }
      m = (o.density ?? 0.0012) * Math.abs(area) / 2;
      // inertia approx: bounding box
      let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
      for (const [vx, vy] of shape.verts) {
        minx = Math.min(minx, vx); maxx = Math.max(maxx, vx);
        miny = Math.min(miny, vy); maxy = Math.max(maxy, vy);
      }
      I = m * ((maxx - minx) ** 2 + (maxy - miny) ** 2) / 12;
    }
    b.invM = 1 / m; b.invI = 1 / I;
    b.mass = m;
  } else b.mass = 0;
  return b;
}

// ---------- geometry ----------
const cross = (ax, ay, bx, by) => ax * by - ay * bx;
function vertW(b, i) {
  const [lx, ly] = b.kind.verts[i], c = Math.cos(b.angle), s = Math.sin(b.angle);
  return [b.x + lx * c - ly * s, b.y + lx * s + ly * c];
}
function normalW(b, i) { // outward normal of edge i->i+1 (verts CCW in local frame, y-down => edge order)
  const [x1, y1] = vertW(b, i), [x2, y2] = vertW(b, (i + 1) % b.kind.verts.length);
  const ex = x2 - x1, ey = y2 - y1, len = Math.hypot(ex, ey) || 1;
  // for CCW winding with y-down screen coords outward normal is (ey,-ex)
  return [ey / len, -ex / len];
}
function support(b, dx, dy) { // farthest point index along dir
  let best = -1e18, bi = 0;
  for (let i = 0; i < b.kind.verts.length; i++) {
    const [x, y] = vertW(b, i), d = x * dx + y * dy;
    if (d > best) { best = d; bi = i; }
  }
  return bi;
}

// ---------- manifolds ----------
function collideCircleCircle(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, r = a.kind.r + b.kind.r;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return null;
  const d = Math.sqrt(d2) || 0.001;
  const nx = dx / d, ny = dy / d;
  return mk(a, b, nx, ny, [[a.x + nx * a.kind.r, a.y + ny * a.kind.r, d - r]]);
}
function collideCirclePoly(c, p) {
  // circle c vs poly p; normal points c->p
  const ca = Math.cos(-p.angle), sa = Math.sin(-p.angle);
  const cx = (c.x - p.x) * ca - (c.y - p.y) * sa;
  const cy = (c.x - p.x) * sa + (c.y - p.y) * ca;
  // max penetration face
  let sep = -1e18, face = 0;
  for (let i = 0; i < p.kind.verts.length; i++) {
    const [x1, y1] = p.kind.verts[i], [x2, y2] = p.kind.verts[(i + 1) % p.kind.verts.length];
    const ex = x2 - x1, ey = y2 - y1, el = Math.hypot(ex, ey) || 1;
    const nx = ey / el, ny = -ex / el;
    const s = nx * (cx - x1) + ny * (cy - y1);
    if (s > c.kind.r) return null;
    if (s > sep) { sep = s; face = i; }
  }
  const [x1, y1] = p.kind.verts[face], [x2, y2] = p.kind.verts[(face + 1) % p.kind.verts.length];
  if (sep < 1e-4) { // circle center inside poly
    const [nx, ny] = normalW(p, face);
    return mk(c, p, nx, ny, [[c.x, c.y, sep - c.kind.r]]);
  }
  // vertex regions: closest endpoint of the max-sep face
  const d1 = (cx - x1) ** 2 + (cy - y1) ** 2, d2 = (cx - x2) ** 2 + (cy - y2) ** 2;
  const cA = Math.cos(p.angle), sA = Math.sin(p.angle);
  const toW = (lx0, ly0) => [p.x + lx0 * cA - ly0 * sA, p.y + lx0 * sA + ly0 * cA];
  if (d1 <= c.kind.r * c.kind.r && (cx - x1) * (x2 - x1) + (cy - y1) * (y2 - y1) <= 0) {
    const [wx, wy] = toW(x1, y1);
    const dd = Math.sqrt(d1) || 0.001, nx = (c.x - wx) / -dd, ny = (c.y - wy) / -dd;
    return mk(c, p, nx, ny, [[wx, wy, dd - c.kind.r]]);
  }
  if (d2 <= c.kind.r * c.kind.r && (cx - x2) * (x2 - x1) + (cy - y2) * (y2 - y1) >= 0) {
    const [wx, wy] = toW(x2, y2);
    const dd = Math.sqrt(d2) || 0.001, nx = (c.x - wx) / -dd, ny = (c.y - wy) / -dd;
    return mk(c, p, nx, ny, [[wx, wy, dd - c.kind.r]]);
  }
  if (sep <= c.kind.r) {
    const [nx0, ny0] = normalW(p, face);
    return mk(c, p, nx0, ny0, [[c.x - nx0 * 0, c.y - ny0 * 0, sep - c.kind.r]]);
  }
  return null;
}
function collidePolyPoly(a, b) {
  // find axis of least penetration for a's normals and b's normals
  let sepA = -1e18, faceA = 0, sepB = -1e18, faceB = 0;
  for (let i = 0; i < a.kind.verts.length; i++) {
    const [nx, ny] = normalW(a, i);
    const [vx, vy] = vertW(a, i);
    const bi = support(b, -nx, -ny), [bx, by] = vertW(b, bi);
    const s = nx * (bx - vx) + ny * (by - vy);
    if (s > 0) return null;
    if (s > sepA) { sepA = s; faceA = i; }
  }
  for (let i = 0; i < b.kind.verts.length; i++) {
    const [nx, ny] = normalW(b, i);
    const [vx, vy] = vertW(b, i);
    const ai = support(a, -nx, -ny), [ax, ay] = vertW(a, ai);
    const s = nx * (ax - vx) + ny * (ay - vy);
    if (s > 0) return null;
    if (s > sepB) { sepB = s; faceB = i; }
  }
  let ref, inc, refFace, flip;
  if (sepB > sepA * 0.95) { ref = b; inc = a; refFace = faceB; flip = true; }
  else { ref = a; inc = b; refFace = faceA; flip = false; }
  const [rnX, rnY] = normalW(ref, refFace);
  // incident edge: most anti-parallel face of inc
  let incFace = 0, minDot = 1e18;
  for (let i = 0; i < inc.kind.verts.length; i++) {
    const [nx, ny] = normalW(inc, i);
    const d = nx * rnX + ny * rnY;
    if (d < minDot) { minDot = d; incFace = i; }
  }
  const [rv1x, rv1y] = vertW(ref, refFace), [rv2x, rv2y] = vertW(ref, (refFace + 1) % ref.kind.verts.length);
  let p1 = vertW(inc, incFace), p2 = vertW(inc, (incFace + 1) % inc.kind.verts.length);
  const tx = rv2x - rv1x, ty = rv2y - rv1y, tl = Math.hypot(tx, ty) || 1, tx2 = tx / tl, ty2 = ty / tl;
  const fOff = rnX * rv1x + rnY * rv1y;
  // clip segment [p1,p2] to the two side planes of the reference face
  function clip(pA, pB, nx2, ny2, off) {
    const dA = nx2 * pA[0] + ny2 * pA[1] - off, dB = nx2 * pB[0] + ny2 * pB[1] - off;
    const out = [];
    if (dA <= 0) out.push(pA);
    if (dB <= 0) out.push(pB);
    if (dA * dB < 0) {
      const t = dA / (dA - dB);
      out.push([pA[0] + (pB[0] - pA[0]) * t, pA[1] + (pB[1] - pA[1]) * t]);
    }
    return out;
  }
  let pts = clip(p1, p2, -tx2, -ty2, -(rv1x * tx2 + rv1y * ty2));
  if (pts.length < 2) return null;
  pts = clip(pts[0], pts[1], tx2, ty2, rv2x * tx2 + rv2y * ty2);
  if (pts.length < 2) return null;
  const contacts = [];
  for (const [px, py] of pts) {
    const sep = rnX * px + rnY * py - fOff;
    if (sep <= 0) contacts.push([px, py, sep]);
  }
  if (!contacts.length) return null;
  return mk(a, b, flip ? -rnX : rnX, flip ? -rnY : rnY, contacts);
}
function mk(a, b, nx, ny, pts) {
  return { a, b, nx, ny, pts: pts.map(p => ({ px: p[0], py: p[1], sep: p[2], jn: 0, jt: 0 })) };
}

// ---------- world ----------
PH.makeWorld = (gravity = 1500) => ({
  gravity, bodies: [], contacts: new Map(), onImpact: null, impacts: new Map(),
});
PH.add = (w, b) => { w.bodies.push(b); return b; };
PH.remove = (w, b) => { b.dead = true; };

// collideCirclePoly(c,p) returns normal pointing p->c (out of the polygon).
// Solver convention: n points a->b and positive impulse pushes b along +n.
function manifoldFor(a, b) {
  if (a.kind.r !== undefined && b.kind.r !== undefined) return collideCircleCircle(a, b);
  if (a.kind.r !== undefined) { // a circle, b poly: p->c = b->a, flip to a->b
    const m = collideCirclePoly(a, b);
    if (m) { m.nx = -m.nx; m.ny = -m.ny; }
    return m;
  }
  if (b.kind.r !== undefined) { // a poly, b circle: p->c = a->b already; only fix a/b bookkeeping
    const m = collideCirclePoly(b, a);
    if (m) { m.a = a; m.b = b; }
    return m;
  }
  return collidePolyPoly(a, b);
}

PH.step = (w, dt) => {
  const SLOP = 0.5, BETA = 0.14, VITER = 10;
  const bodies = w.bodies;
  const next = new Map();
  // broad+narrow (O(n^2) — fine for <300 bodies)
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i];
    if (a.dead) continue;
    for (let j = i + 1; j < bodies.length; j++) {
      const b = bodies[j];
      if (b.dead) continue;
      if (a.invM === 0 && b.invM === 0) continue;
      if (a.asleep && b.asleep) continue;
      // quick AABB reject
      const ra = a.kind.r !== undefined ? a.kind.r : polyRadius(a);
      const rb = b.kind.r !== undefined ? b.kind.r : polyRadius(b);
      if (Math.abs(a.x - b.x) > ra + rb + 4 || Math.abs(a.y - b.y) > ra + rb + 4) continue;
      const m = manifoldFor(a, b);
      if (!m) continue;
      const key = a.id < b.id ? a.id + ':' + b.id : b.id + ':' + a.id;
      const old = w.contacts.get(key);
      if (old) { // warm starting carry-over by proximity
        for (const p of m.pts) {
          for (const q of old.pts) {
            if ((p.px - q.px) ** 2 + (p.py - q.py) ** 2 < 16) { p.jn = q.jn; p.jt = q.jt; break; }
          }
        }
      }
      // wake check: fast relative approach or deep penetration wakes the sleeper
      const rel = Math.hypot(a.vx - b.vx, a.vy - b.vy);
      const deep = m.pts.some(p => p.sep < -3);
      if (a.asleep && (rel > 40 || deep)) { a.asleep = false; a.sleepT = 0; }
      if (b.asleep && (rel > 40 || deep)) { b.asleep = false; b.sleepT = 0; }
      next.set(key, m);
    }
  }
  w.contacts = next;

  // apply impulses
  const applyImp = (m, p, jx, jy) => {
    const rax = p.px - m.a.x, ray = p.py - m.a.y;
    const rbx = p.px - m.b.x, rby = p.py - m.b.y;
    if (m.a.invM > 0 && !m.a.asleep) { m.a.vx -= jx * m.a.invM; m.a.vy -= jy * m.a.invM; m.a.va -= (rax * jy - ray * jx) * m.a.invI; }
    if (m.b.invM > 0 && !m.b.asleep) { m.b.vx += jx * m.b.invM; m.b.vy += jy * m.b.invM; m.b.va += (rbx * jy - rby * jx) * m.b.invI; }
  };
  const velAt = (m, p) => {
    const rax = p.px - m.a.x, ray = p.py - m.a.y;
    const rbx = p.px - m.b.x, rby = p.py - m.b.y;
    return [m.b.vx + m.b.va * -rby - (m.a.vx + m.a.va * -ray),
            m.b.vy + m.b.va * rbx - (m.a.vy + m.a.va * rax)];
  };
  const massN = (m, p) => {
    const rax = p.px - m.a.x, ray = p.py - m.a.y;
    const rbx = p.px - m.b.x, rby = p.py - m.b.y;
    const ran = rax * m.ny - ray * m.nx, rbn = rbx * m.ny - rby * m.nx;
    return m.a.invM + m.b.invM + m.a.invI * ran * ran + m.b.invI * rbn * rbn;
  };
  const massT = (m, p) => {
    const rax = p.px - m.a.x, ray = p.py - m.a.y;
    const rbx = p.px - m.b.x, rby = p.py - m.b.y;
    const tx = -m.ny, ty = m.nx;
    const rat = rax * ty - ray * tx, rbt = rbx * ty - rby * tx;
    return m.a.invM + m.b.invM + m.a.invI * rat * rat + m.b.invI * rbt * rbt;
  };

  // precompute + warm start + restitution bias
  for (const m of w.contacts.values()) {
    const e = Math.min(m.a.restitution, m.b.restitution);
    for (const p of m.pts) {
      p.mn = massN(m, p) || 1; p.mt = massT(m, p) || 1;
      const [vnx] = [velAt(m, p)];
      const vn0 = vnx[0] * m.nx + vnx[1] * m.ny;
      p.bias = Math.max(BETA / dt * Math.min(0, p.sep + SLOP), -e * vn0);
      p.vn0 = Math.max(0, -vn0); // approach speed at first contact (0 while resting)
      if (p.jn || p.jt) applyImp(m, p, p.jn * m.nx + p.jt * -m.ny, p.jn * m.ny + p.jt * m.nx);
    }
  }
  // velocity iterations
  for (let it = 0; it < VITER; it++) {
    for (const m of w.contacts.values()) {
      const mu = Math.sqrt(m.a.friction * m.b.friction);
      for (const p of m.pts) {
        // friction
        const [tvx, tvy] = velAt(m, p);
        const vt = tvx * -m.ny + tvy * m.nx;
        let djt = -vt / p.mt;
        const maxF = mu * p.jn;
        const jt0 = p.jt;
        p.jt = Math.max(-maxF, Math.min(maxF, jt0 + djt));
        djt = p.jt - jt0;
        applyImp(m, p, djt * -m.ny, djt * m.nx);
        // normal
        const [nvx, nvy] = velAt(m, p);
        const vn = nvx * m.nx + nvy * m.ny;
        let djn = -(vn - p.bias) / p.mn;
        const jn0 = p.jn;
        p.jn = Math.max(0, jn0 + djn);
        djn = p.jn - jn0;
        applyImp(m, p, djn * m.nx, djn * m.ny);
      }
    }
  }
  // record impact speeds (max approach velocity per body) — damage keys on
  // impact velocity, not resting impulse, so structures don't grind down
  w.impacts.clear();
  for (const m of w.contacts.values()) {
    for (const p of m.pts) {
      const vn = p.vn0 || 0;
      if (vn <= 0) continue;
      for (const bd of [m.a, m.b]) {
        if (bd.invM === 0) continue;
        const cur = w.impacts.get(bd.id) || 0;
        if (vn > cur) w.impacts.set(bd.id, vn);
      }
    }
  }
  if (w.onImpact) for (const [id, vn] of w.impacts) {
    const b = bodies.find(x => x.id === id);
    if (b && !b.dead && vn > (b.threshold || 0)) w.onImpact(b, vn);
  }
  // integrate
  for (const b of bodies) {
    if (b.dead || b.stat || b.asleep) continue;
    b.vy += w.gravity * dt;
    b.vx *= 0.9995; b.va *= 0.999;
    b.x += b.vx * dt; b.y += b.vy * dt; b.angle += b.va * dt;
  }
  // sleep islands (union-find over touching dynamic bodies)
  const parent = new Map();
  const find = x => { let r = x; while (parent.get(r) !== r) r = parent.get(r); parent.set(x, r); return r; };
  const uni = (a, b) => parent.set(find(a), find(b));
  for (const b of bodies) if (!b.dead && !b.stat && !b.asleep) parent.set(b.id, b.id);
  for (const m of w.contacts.values()) {
    if (m.a.invM > 0 && !m.a.asleep && m.b.invM > 0 && !m.b.asleep) uni(m.a.id, m.b.id);
    else if (m.a.invM > 0 && !m.a.asleep && (m.b.stat || m.b.asleep)) { /* grounded island ok */ }
  }
  for (const b of bodies) {
    if (b.dead || b.stat || b.asleep) continue;
    const sp = Math.hypot(b.vx, b.vy);
    if (sp < 7 && Math.abs(b.va) < 0.25) b.sleepT += dt; else b.sleepT = 0;
    if (b.sleepT > 0.55) {
      // all awake members of its island must be sleepy too
      const root = find(b.id);
      let all = true;
      for (const o of bodies) {
        if (o.dead || o.stat || o.asleep || o === b) continue;
        if (parent.has(o.id) && find(o.id) === root && o.sleepT <= 0.55) { all = false; break; }
      }
      if (all) {
        for (const o of bodies) {
          if (o.dead || o.stat || o === b) continue;
          if (parent.has(o.id) && find(o.id) === root) { o.asleep = true; o.vx = o.vy = o.va = 0; }
        }
        b.asleep = true; b.vx = b.vy = b.va = 0;
      }
    }
  }
};

function polyRadius(b) {
  let r = 0;
  for (const [x, y] of b.kind.verts) r = Math.max(r, Math.hypot(x, y));
  return r;
}
PH.polyRadius = polyRadius;

// radial explosion: impulse + impact damage
PH.explode = (w, x, y, R, power, dmg) => {
  for (const b of w.bodies) {
    if (b.dead || b.stat) continue;
    const dx = b.x - x, dy = b.y - y, d = Math.hypot(dx, dy);
    if (d > R) continue;
    b.asleep = false; b.sleepT = 0;
    const f = 1 - d / R;
    const nx = dx / (d || 1), ny = dy / (d || 1);
    const imp = power * f * (b.mass || 1);
    b.vx += nx * imp * b.invM; b.vy += ny * imp * b.invM;
    b.va += (Math.random() - 0.5) * f * 3;
    if (w.onImpact && dmg > 0) w.onImpact(b, (b.threshold || 0) + dmg * f, true);
  }
};

window.PH = PH;
})();
