// Tiny WebAudio sfx — no assets. Lazily created on first user gesture.
(() => {
'use strict';
const AB = window.AB = window.AB || {};
let AC = null;
const ac = () => AC || (AC = new (window.AudioContext || window.webkitAudioContext)());
const env = (t0, a, d, v) => { const g = ac().createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(v, t0 + a); g.gain.exponentialRampToValueAtTime(0.001, t0 + a + d); return g; };
const osc = (type, f0, f1, t, d, v = 0.2) => {
  const o = ac().createOscillator(), g = env(t, 0.005, d, v);
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + d);
  o.connect(g).connect(ac().destination); o.start(t); o.stop(t + d + 0.05);
};
const noise = (t, d, v = 0.25, f = 900) => {
  const sr = ac().sampleRate, buf = ac().createBuffer(1, sr * d, sr);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / ch.length);
  const src = ac().createBufferSource(); src.buffer = buf;
  const fl = ac().createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = f;
  const g = env(t, 0.002, d, v);
  src.connect(fl).connect(g).connect(ac().destination); src.start(t);
};
const now = () => ac().currentTime;

AB.sfx = {
  unlock() { try { ac().resume && ac().resume(); } catch (e) {} },
  launch() { try { const t = now(); osc('triangle', 320, 90, t, 0.18, 0.22); noise(t, 0.08, 0.08, 3000); } catch (e) {} },
  dash() { try { osc('sawtooth', 300, 900, now(), 0.16, 0.14); } catch (e) {} },
  split() { try { const t = now(); osc('square', 500, 700, t, 0.07, 0.1); osc('square', 620, 850, t + 0.05, 0.07, 0.1); osc('square', 740, 1000, t + 0.1, 0.08, 0.1); } catch (e) {} },
  thud() { try { noise(now(), 0.07, 0.14, 500); } catch (e) {} },
  crack() { try { const t = now(); noise(t, 0.05, 0.2, 2400); noise(t + 0.03, 0.06, 0.16, 1600); } catch (e) {} },
  woodbreak() { try { const t = now(); noise(t, 0.16, 0.3, 1200); osc('triangle', 200, 80, t, 0.12, 0.2); } catch (e) {} },
  pop() { try { const t = now(); osc('square', 700, 220, t, 0.16, 0.18); osc('sine', 1200, 400, t + 0.02, 0.1, 0.08); } catch (e) {} },
  boom() { try { const t = now(); noise(t, 0.7, 0.5, 700); osc('sine', 120, 30, t, 0.6, 0.5); noise(t + 0.05, 0.4, 0.3, 2500); } catch (e) {} },
  win() { try { const t = now(); [523, 659, 784, 1047].forEach((f, i) => osc('square', f, f, t + i * 0.11, 0.14, 0.14)); } catch (e) {} },
  fail() { try { const t = now(); [392, 330, 262].forEach((f, i) => osc('sawtooth', f, f * 0.9, t + i * 0.16, 0.18, 0.12)); } catch (e) {} },
  star() { try { const t = now(); osc('sine', 880, 1320, t, 0.18, 0.15); osc('sine', 1320, 1760, t + 0.09, 0.22, 0.12); } catch (e) {} },
};
})();
