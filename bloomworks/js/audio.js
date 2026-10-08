/* audio.js — every sound, synthesised. There are no audio files.
 *
 * Chimes play a pentatonic scale set by their tile, so a Chain is a melody.
 * Sale ticks rise in pitch with Combo. A Supernova gets its own sound. The
 * music is a slow pentatonic arpeggio that speeds up during a Rush. Nothing
 * plays until the first tap (browsers insist), and every call is cheap to
 * skip: sound is never worth a dropped frame, so sale ticks are rate-limited. */

import { PENTATONIC } from "./data.js";

let ac = null, master = null, musicGain = null, on = true, musicOn = false;
let lastSale = 0, rushing = false, nextBeat = 0, beat = 0;

export function unlock() {
  if (ac) { if (ac.state === "suspended") ac.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ac = new AC();
  master = ac.createGain(); master.gain.value = on ? 0.5 : 0; master.connect(ac.destination);
  musicGain = ac.createGain(); musicGain.gain.value = musicOn ? 0.18 : 0; musicGain.connect(master);
}
export function setSound(v) { on = !!v; if (master) master.gain.value = on ? 0.5 : 0; }
export function setMusic(v) { musicOn = !!v; if (musicGain) musicGain.gain.value = musicOn ? 0.18 : 0; }
export function setRush(v) { rushing = !!v; }

const freq = (semi) => 523.25 * Math.pow(2, semi / 12);
function tone(f, dur, type, vol, dest, when) {
  if (!ac || !on) return;
  const t = when || ac.currentTime;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type || "sine"; o.frequency.value = f;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol || 0.2, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(dest || master);
  o.start(t); o.stop(t + dur + 0.05);
}

export const sound = {
  chime(note, step) {
    const semi = PENTATONIC[note % 5] + 12 * Math.min(2, Math.floor((step || 1) / 6));
    tone(freq(semi), 1.2, "sine", 0.16);
    tone(freq(semi + 12), 0.6, "triangle", 0.05);
  },
  sale(combo, lucky) {
    if (!ac) return;
    const now = ac.currentTime;
    if (now - lastSale < 0.06 && !lucky) return;
    lastSale = now;
    const lift = Math.min(24, Math.log2(1 + (combo || 0) / 10) * 3);
    tone(freq(-12 + lift), 0.08, "triangle", 0.05);
    if (lucky) tone(freq(lift + 7 * Math.min(3, lucky)), 0.3, "sine", 0.1);
  },
  supernova() {
    if (!ac) return;
    [0, 4, 7, 12, 16].forEach((s, i) => tone(freq(s), 1.6, "sine", 0.12, null, ac.currentTime + i * 0.05));
  },
  thunder() {
    if (!ac || !on) return;
    const n = ac.createBufferSource(), len = ac.sampleRate * 1.2, buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
    n.buffer = buf;
    const f = ac.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 400;
    const g = ac.createGain(); g.gain.value = 0.25;
    n.connect(f); f.connect(g); g.connect(master); n.start();
  },
  milestone() { if (!ac) return; [0, 7, 12].forEach((s, i) => tone(freq(s), 0.5, "triangle", 0.1, null, ac.currentTime + i * 0.08)); },
  chord() { if (!ac) return; [0, 4, 9].forEach((s) => tone(freq(s - 12), 1.4, "sine", 0.05)); },
  click() { tone(880, 0.04, "square", 0.03); },
  moth() { if (!ac) return; [12, 16, 19, 24].forEach((s, i) => tone(freq(s), 0.25, "sine", 0.07, null, ac.currentTime + i * 0.06)); }
};

/** Called every frame: schedules the music a beat ahead. */
export function musicTick() {
  if (!ac || !musicOn || !on) return;
  const now = ac.currentTime;
  if (nextBeat < now) nextBeat = now + 0.05;
  const spb = rushing ? 0.18 : 0.42;
  while (nextBeat < now + 0.3) {
    const pat = [0, 2, 4, 1, 3, 4, 2, 0];
    const semi = PENTATONIC[pat[beat % 8]] - 12 + (beat % 16 >= 8 ? 5 : 0);
    tone(freq(semi), spb * 2.2, "sine", 0.4, musicGain, nextBeat);
    if (beat % 4 === 0) tone(freq(semi - 12), spb * 4, "triangle", 0.3, musicGain, nextBeat);
    beat++; nextBeat += spb;
  }
}
