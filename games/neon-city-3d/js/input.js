/* NEON CITY 3D — input: left joystick = move, right-half drag = camera, buttons A/B/C. */
const NC = window.NC;
NC.register('input', {
  joy: { x: 0, y: 0, mag: 0, id: null, ox: 0, oy: 0 },
  cam: { id: null, lx: 0, ly: 0, dx: 0, dy: 0 }, // camera drag deltas (consumed per frame)
  a: false, b: false, c: false,
  aEdge: false, bEdge: false, cEdge: false,
  keys: {},

  init() {
    const cv = document.getElementById('cv3d');
    const joy = this.joy, cam = this.cam;
    const ring = document.getElementById('joy-ring');
    const knob = document.getElementById('joy-knob');
    const placeRing = (x, y) => { ring.style.left = (x - 52) + 'px'; ring.style.top = (y - 52) + 'px'; ring.style.bottom = 'auto'; ring.classList.add('on'); };
    const restRing = () => { ring.style.left = '16px'; ring.style.top = 'auto'; ring.style.bottom = '96px'; ring.classList.remove('on'); };

    const onDown = (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        const x = t.clientX, y = t.clientY;
        if (x < window.innerWidth * 0.5 && joy.id === null) {
          joy.id = t.identifier; joy.ox = x; joy.oy = y;
          joy.x = 0; joy.y = 0; joy.mag = 0;
          placeRing(x, y);
        } else if (x >= window.innerWidth * 0.5 && cam.id === null) {
          cam.id = t.identifier; cam.lx = x; cam.ly = y;
        }
      }
    };
    const onMove = (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier === joy.id) {
          const max = 52;
          let dx = t.clientX - joy.ox, dy = t.clientY - joy.oy;
          const d = Math.hypot(dx, dy);
          if (d > max) { dx *= max / d; dy *= max / d; }
          joy.x = dx / max; joy.y = dy / max; joy.mag = Math.min(1, d / max);
          knob.style.transform = `translate(${dx * 0.55}px,${dy * 0.55}px)`;
        } else if (t.identifier === cam.id) {
          cam.dx += (t.clientX - cam.lx); cam.dy += (t.clientY - cam.ly);
          cam.lx = t.clientX; cam.ly = t.clientY;
        }
      }
    };
    const onUp = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === joy.id) {
          joy.id = null; joy.x = 0; joy.y = 0; joy.mag = 0;
          knob.style.transform = '';
          restRing();
        }
        if (t.identifier === cam.id) cam.id = null;
      }
    };
    cv.addEventListener('touchstart', onDown, { passive: false });
    cv.addEventListener('touchmove', onMove, { passive: false });
    cv.addEventListener('touchend', onUp);
    cv.addEventListener('touchcancel', onUp);

    // mouse fallback: left-half = joy, right-half drag = camera
    cv.addEventListener('mousedown', (e) => {
      if (e.clientX < window.innerWidth * 0.5) {
        joy.id = 'mouse'; joy.ox = e.clientX; joy.oy = e.clientY; joy.x = 0; joy.y = 0; joy.mag = 0;
        placeRing(e.clientX, e.clientY);
      } else { cam.id = 'mouse'; cam.lx = e.clientX; cam.ly = e.clientY; }
    });
    window.addEventListener('mousemove', (e) => {
      if (joy.id === 'mouse') {
        const max = 52;
        let dx = e.clientX - joy.ox, dy = e.clientY - joy.oy;
        const d = Math.hypot(dx, dy);
        if (d > max) { dx *= max / d; dy *= max / d; }
        joy.x = dx / max; joy.y = dy / max; joy.mag = Math.min(1, d / max);
        knob.style.transform = `translate(${dx * 0.55}px,${dy * 0.55}px)`;
      }
      if (cam.id === 'mouse') { cam.dx += e.clientX - cam.lx; cam.dy += e.clientY - cam.ly; cam.lx = e.clientX; cam.ly = e.clientY; }
    });
    window.addEventListener('mouseup', () => {
      if (joy.id === 'mouse') { joy.id = null; joy.x = 0; joy.y = 0; joy.mag = 0; knob.style.transform = ''; restRing(); }
      if (cam.id === 'mouse') cam.id = null;
    });

    // buttons (DOM so iOS taps always land)
    const bind = (id, prop, edge) => {
      const el = document.getElementById(id);
      const d = (e) => { e.preventDefault(); this[prop] = true; this[edge] = true; };
      const u = (e) => { e.preventDefault(); this[prop] = false; };
      el.addEventListener('touchstart', d, { passive: false });
      el.addEventListener('touchend', u, { passive: false });
      el.addEventListener('touchcancel', u, { passive: false });
      el.addEventListener('mousedown', d);
      el.addEventListener('mouseup', u);
      el.addEventListener('mouseleave', u);
    };
    bind('btn-a', 'a', 'aEdge');
    bind('btn-b', 'b', 'bEdge');
    bind('btn-c', 'c', 'cEdge');

    // keyboard
    window.addEventListener('keydown', (e) => {
      this.keys[e.key.toLowerCase()] = true;
      if (e.repeat) return; // holding a key must not re-fire edge triggers
      if (e.key === 'e' || e.key === 'Enter') { this.a = true; this.aEdge = true; }
      if (e.key === ' ') { this.b = true; this.bEdge = true; e.preventDefault(); }
      if (e.key === 'q' || e.key === 'Tab') { this.c = true; this.cEdge = true; e.preventDefault(); }
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.key.toLowerCase()] = false;
      if (e.key === 'e' || e.key === 'Enter') this.a = false;
      if (e.key === ' ') this.b = false;
      if (e.key === 'q' || e.key === 'Tab') this.c = false;
    });
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('dblclick', (e) => e.preventDefault());
  },

  pollKeys() {
    const k = this.keys, joy = this.joy;
    const jx = (k['d'] ? 1 : 0) - (k['a'] ? 1 : 0);
    const jy = (k['s'] ? 1 : 0) - (k['w'] ? 1 : 0);
    if (jx || jy) {
      const m = Math.hypot(jx, jy);
      joy.x = jx / m; joy.y = jy / m; joy.mag = 1;
    } else if (joy.id === null) { joy.x = 0; joy.y = 0; joy.mag = 0; }
    // arrow keys drive the camera
    const cx = (k['arrowright'] ? 1 : 0) - (k['arrowleft'] ? 1 : 0);
    const cy = (k['arrowdown'] ? 1 : 0) - (k['arrowup'] ? 1 : 0);
    if (cx || cy) { this.cam.dx += cx * 6; this.cam.dy += cy * 6; }
  },

  // edges are cleared by main.js at end of frame (endFrame)
  endFrame() {
    this.aEdge = this.bEdge = this.cEdge = false;
  },
});
