/* Super Koto — WebAudio chiptune-ish SFX. No external assets. */
window.SK = window.SK || {};

(function () {
  let AC = null, master = null, muted = false;

  function ctx() {
    if (!AC) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      AC = new C();
      master = AC.createGain();
      master.gain.value = 0.22;
      master.connect(AC.destination);
    }
    if (AC.state === 'suspended') AC.resume();
    return AC;
  }

  function tone(f0, f1, dur, type, vol, delay) {
    const a = ctx(); if (!a || muted) return;
    const t = a.currentTime + (delay || 0);
    const o = a.createOscillator(), g = a.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol || 0.5, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  function noise(dur, vol, delay, hp) {
    const a = ctx(); if (!a || muted) return;
    const t = a.currentTime + (delay || 0);
    const len = Math.ceil(a.sampleRate * dur);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = a.createBufferSource(); src.buffer = buf;
    const flt = a.createBiquadFilter();
    flt.type = hp ? 'highpass' : 'lowpass';
    flt.frequency.value = hp ? 1800 : 900;
    const g = a.createGain();
    g.gain.setValueAtTime(vol || 0.4, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(flt); flt.connect(g); g.connect(master);
    src.start(t);
  }

  function seq(notes, type, step, vol) {
    notes.forEach((n, i) => { if (n) tone(n, n, step * 0.95, type, vol, i * step); });
  }

  SK.sfx = {
    unlock() { ctx(); },
    get muted() { return muted; },
    toggleMute() { muted = !muted; return muted; },

    jump(big) { tone(big ? 280 : 320, 640, 0.16, 'square', 0.35); },
    coin() { tone(988, 988, 0.07, 'square', 0.35); tone(1319, 1319, 0.22, 'square', 0.35, 0.07); },
    stomp() { noise(0.12, 0.5); tone(220, 60, 0.14, 'triangle', 0.5); },
    bump() { tone(140, 90, 0.09, 'square', 0.4); noise(0.06, 0.25); },
    brick() { noise(0.2, 0.5); tone(300, 80, 0.15, 'sawtooth', 0.3); },
    sprout() { seq([523, 659, 784, 1047], 'square', 0.06, 0.3); },
    power() { seq([523, 659, 784, 1047, 1319, 1568], 'square', 0.07, 0.35); },
    throwIt() { tone(900, 400, 0.1, 'sawtooth', 0.3); },
    hit() { tone(300, 120, 0.25, 'sawtooth', 0.4); },
    kick() { tone(500, 900, 0.09, 'square', 0.35); noise(0.06, 0.3); },
    pop() { tone(400, 900, 0.09, 'sine', 0.4); },
    die() { seq([660, 620, 580, 500, 420, 330, 240], 'triangle', 0.13, 0.4); },
    tick() { tone(1100, 1100, 0.04, 'square', 0.25); },
    flag() {
      seq([392, 523, 659, 784, 1047, 1319], 'square', 0.08, 0.35);
      seq([784, 1047, 1319, 1568], 'triangle', 0.1, 0.25, 0.5);
    },
    clear() {
      seq([523, 659, 784, 1047, 784, 1047, 1319], 'square', 0.12, 0.35);
      seq([262, 330, 392, 523], 'triangle', 0.12, 0.25, 0.36);
    },
    gameover() { seq([392, 370, 349, 330, 262, 220, 196], 'triangle', 0.22, 0.4); },
    win() {
      seq([523, 659, 784, 1047, 1319, 1568, 2093], 'square', 0.11, 0.35);
      seq([262, 330, 392, 523, 659, 784], 'triangle', 0.11, 0.28, 0.3);
    },
    oneUp() { seq([659, 784, 1319, 1047, 1175, 1568], 'square', 0.09, 0.35); },
    pause() { tone(660, 660, 0.07, 'square', 0.3); tone(880, 880, 0.09, 'square', 0.3, 0.08); },
    select() { tone(700, 900, 0.07, 'square', 0.3); },
    bubble() { tone(300, 800, 0.2, 'sine', 0.35); },
  };
})();
