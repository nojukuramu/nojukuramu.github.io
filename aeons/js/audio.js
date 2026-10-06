/* audio.js — every sound, synthesised. There are no audio files.
 *
 * A clang is a burst of noise through a ringing band-pass; a bowstring is a
 * falling filtered thump; a gun is a crack and a tail; a laser is a sine
 * diving an octave. They are made on demand from one noise buffer and a few
 * oscillators, attenuated by how far they are from the middle of the screen,
 * and capped so that a battle of three hundred is still a sound and not a
 * wall of it.
 *
 * The music is generative: a slow pad on a scale that belongs to the era,
 * with a sparse line over it. It changes when the era does. */

let ac = null, master = null, sfx = null, mus = null, noise = null, started = false;
let vol = { master: 0.8, sfx: 0.9, music: 0.45 };
const recent = new Map();

export function unlock() {
  if (started) { if (ac && ac.state === "suspended") ac.resume().catch(() => {}); return; }
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    master = ac.createGain(); master.connect(ac.destination);
    const comp = ac.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 6; comp.connect(master);
    sfx = ac.createGain(); sfx.connect(comp);
    mus = ac.createGain(); mus.connect(master);
    noise = ac.createBuffer(1, ac.sampleRate * 1.5, ac.sampleRate);
    const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    started = true;
    apply();
  } catch (e) { ac = null; }
}
export function setVolumes(v) { Object.assign(vol, v); apply(); }
function apply() { if (!ac) return; master.gain.value = vol.master; sfx.gain.value = vol.sfx * 0.7; mus.gain.value = vol.music * 0.35; }

function env(g, t, a, peak, d) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
function noiseHit(t, dur, freq, q, peak, type, dest) {
  const s = ac.createBufferSource(); s.buffer = noise; s.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = ac.createBiquadFilter(); f.type = type || "bandpass"; f.frequency.value = freq; f.Q.value = q || 1;
  const g = ac.createGain(); env(g, t, 0.003, peak, dur);
  s.connect(f); f.connect(g); g.connect(dest || sfx);
  s.start(t, Math.random() * 0.5, dur + 0.05);
}
function tone(t, f0, f1, dur, type, peak, dest) {
  const o = ac.createOscillator(); o.type = type || "sine"; o.frequency.setValueAtTime(f0, t); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ac.createGain(); env(g, t, 0.005, peak, dur);
  o.connect(g); g.connect(dest || sfx); o.start(t); o.stop(t + dur + 0.05);
}

/** name, and how near the middle of the screen it is (1 = right there, 0 = off screen). */
export function play(name, near) {
  if (!ac || vol.sfx <= 0 || vol.master <= 0) return;
  const k = near === undefined ? 1 : near;
  if (k < 0.05) return;
  // the same sound twice in a few milliseconds is one sound
  const now = ac.currentTime, last = recent.get(name) || 0;
  const gap = { sword: 0.05, arrow: 0.06, gun: 0.04, boom: 0.08, chop: 0.12, mine: 0.15, death: 0.08 }[name] || 0.03;
  if (now - last < gap) return;
  recent.set(name, now);
  const t = now + 0.005, v = Math.min(1, k);
  switch (name) {
    case "click": tone(t, 1400, 900, 0.04, "triangle", 0.08 * v); break;
    case "select": tone(t, 660, 990, 0.07, "triangle", 0.1 * v); break;
    case "ack": tone(t, 520, 780, 0.08, "square", 0.04 * v); tone(t + 0.07, 780, 0, 0.08, "triangle", 0.06 * v); break;
    case "error": tone(t, 220, 160, 0.16, "square", 0.05 * v); break;
    case "sword": noiseHit(t, 0.12, 3200 + Math.random() * 1500, 8, 0.25 * v); tone(t, 1800 + Math.random() * 600, 1200, 0.15, "triangle", 0.04 * v); break;
    case "club": noiseHit(t, 0.08, 600, 2, 0.3 * v, "lowpass"); break;
    case "arrow": noiseHit(t, 0.12, 1600, 3, 0.12 * v); tone(t, 300, 120, 0.06, "triangle", 0.06 * v); break;
    case "gun": noiseHit(t, 0.04, 2400, 0.7, 0.35 * v, "highpass"); noiseHit(t + 0.01, 0.22, 500, 0.8, 0.18 * v, "lowpass"); break;
    case "laser": tone(t, 1600, 400, 0.14, "sawtooth", 0.05 * v); tone(t, 2400, 800, 0.1, "sine", 0.05 * v); break;
    case "plasma": tone(t, 600, 200, 0.22, "sawtooth", 0.05 * v); noiseHit(t, 0.15, 900, 3, 0.08 * v); break;
    case "boom": noiseHit(t, 0.6, 180, 0.7, 0.55 * v, "lowpass"); tone(t, 90, 40, 0.5, "sine", 0.35 * v); break;
    case "chop": noiseHit(t, 0.06, 900, 4, 0.18 * v); tone(t, 260, 180, 0.05, "triangle", 0.06 * v); break;
    case "mine": noiseHit(t, 0.05, 4200, 10, 0.12 * v); tone(t, 2600, 2400, 0.12, "sine", 0.03 * v); break;
    case "build": noiseHit(t, 0.07, 700, 3, 0.16 * v); break;
    case "done": [523, 659, 784].forEach((f, i) => tone(t + i * 0.08, f, 0, 0.3, "triangle", 0.08 * v)); break;
    case "trained": tone(t, 392, 523, 0.12, "triangle", 0.08 * v); break;
    case "coin": tone(t, 1320, 1760, 0.08, "sine", 0.05 * v); break;
    case "death": noiseHit(t, 0.2, 400, 1.5, 0.12 * v, "lowpass"); break;
    case "magic": tone(t, 880, 1760, 0.25, "sine", 0.07 * v); tone(t + 0.04, 1320, 2640, 0.2, "sine", 0.04 * v); break;
    case "heal": tone(t, 660, 990, 0.3, "sine", 0.05 * v); break;
    case "alert": tone(t, 880, 0, 0.14, "square", 0.07); tone(t + 0.18, 660, 0, 0.18, "square", 0.07); break;
    case "phase": [196, 247, 294, 392].forEach((f, i) => tone(t + i * 0.14, f, 0, 0.9, "sawtooth", 0.04)); noiseHit(t, 1.2, 300, 0.5, 0.06, "lowpass"); break;
    case "era": [262, 330, 392, 523, 659].forEach((f, i) => tone(t + i * 0.12, f, 0, 1.2, "triangle", 0.08)); break;
    case "fall": [392, 330, 262, 196].forEach((f, i) => tone(t + i * 0.16, f, 0, 0.7, "triangle", 0.07)); break;
    case "level": [523, 784, 1047].forEach((f, i) => tone(t + i * 0.07, f, 0, 0.35, "sine", 0.07 * v)); break;
    case "relic": [440, 554, 659, 880].forEach((f, i) => tone(t + i * 0.1, f, 0, 0.8, "sine", 0.06)); break;
  }
}

/* ---------------- music ---------------- */
const SCALES = [
  [0, 3, 5, 7, 10], [0, 2, 3, 7, 8], [0, 2, 3, 5, 7, 8, 10], [0, 2, 4, 5, 7, 9, 11], [0, 2, 3, 5, 7, 9, 10],
  [0, 2, 4, 7, 9], [0, 3, 5, 6, 7, 10], [0, 2, 4, 6, 7, 9, 11], [0, 2, 4, 6, 8, 10], [0, 1, 5, 7, 8]
];
const ROOT = [45, 47, 43, 48, 46, 41, 44, 49, 42, 40];
let era = 0, nextNote = 0, chordAt = 0, timer = 0, pad = [];
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
export function setEra(e) { era = e; chordAt = 0; }
export function music() {
  if (!ac || vol.music <= 0) return;
  const t = ac.currentTime;
  if (t >= chordAt) {
    for (const p of pad) { try { p.g.gain.setTargetAtTime(0.0001, t, 1.2); p.o.stop(t + 4); } catch (e) {} }
    pad = [];
    const S = SCALES[era], r = ROOT[era], deg = [0, 2, 4, 3, 5][Math.floor(Math.random() * 5)] % S.length;
    for (const off of [0, 2, 4]) {
      const s = S[(deg + off) % S.length] + 12 * Math.floor((deg + off) / S.length);
      const o = ac.createOscillator(); o.type = era >= 7 ? "sine" : "sawtooth"; o.frequency.value = mtof(r + s); o.detune.value = (Math.random() - 0.5) * 12;
      const f = ac.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 500 + era * 90; f.Q.value = 0.5;
      const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06, t + 3);
      o.connect(f); f.connect(g); g.connect(mus); o.start(t);
      pad.push({ o, g });
    }
    chordAt = t + 9 + Math.random() * 5;
  }
  if (t >= nextNote) {
    const S = SCALES[era], m = ROOT[era] + 24 + S[Math.floor(Math.random() * S.length)];
    tone(t, mtof(m), 0, 1.6, era >= 7 ? "sine" : "triangle", 0.035, mus);
    nextNote = t + 1.4 + Math.random() * 3.2;
  }
}
export const ready = () => !!ac;
