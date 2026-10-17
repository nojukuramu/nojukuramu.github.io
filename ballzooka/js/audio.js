/* audio.js — every sound, synthesised. There are no audio files.
 *
 * The shape is Bloomworks' audio.js (bloomworks/js/audio.js): one context
 * made on the first tap, a master gain the settings switch, a tone() helper,
 * and rate limits so a thousand balls never become a thousand oscillators.
 * Changed: the sounds, which are this game's — pops that climb in pitch with
 * the combo, a gate "bling", a breach thud — and the music, a four-on-the-
 * floor loop that doubles its tempo during Fever. */

let ac = null, master = null, musicGain = null, on = true, musicOn = true, fever = false, playing = false;
let nextBeat = 0, beat = 0;
const last = {};

export function unlock() {
  if (ac) { if (ac.state === "suspended") ac.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ac = new AC();
  master = ac.createGain(); master.gain.value = on ? 0.5 : 0; master.connect(ac.destination);
  musicGain = ac.createGain(); musicGain.gain.value = musicOn ? 0.16 : 0; musicGain.connect(master);
}
export function setSound(v) { on = !!v; if (master) master.gain.value = on ? 0.5 : 0; }
export function setMusic(v) { musicOn = !!v; if (musicGain) musicGain.gain.value = musicOn ? 0.16 : 0; }
export function setFever(v) { fever = !!v; }
export function setPlaying(v) { playing = !!v; }

const freq = (semi) => 440 * Math.pow(2, semi / 12);
function gate(name, gap) {
  if (!ac || !on) return false;
  const now = ac.currentTime;
  if (last[name] && now - last[name] < gap) return false;
  last[name] = now;
  return true;
}
function tone(f, dur, type, vol, dest, when, slide) {
  if (!ac || !on) return;
  const t = when || ac.currentTime;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type || "sine"; o.frequency.setValueAtTime(f, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, f * slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol || 0.2, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(dest || master);
  o.start(t); o.stop(t + dur + 0.05);
}
let noiseBuf = null;
function noise(dur, vol, cutoff, when) {
  if (!ac || !on) return;
  if (!noiseBuf) {
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = when || ac.currentTime;
  const n = ac.createBufferSource(); n.buffer = noiseBuf;
  const f = ac.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = cutoff || 1200;
  const g = ac.createGain();
  g.gain.setValueAtTime(vol || 0.2, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  n.connect(f); f.connect(g); g.connect(master);
  n.start(t, Math.random() * 0.5); n.stop(t + dur + 0.05);
}

export const sfx = {
  shot() { if (gate("shot", 0.07)) tone(freq(-5 + Math.random() * 2), 0.05, "square", 0.025, null, null, 0.5); },
  hit() { if (gate("hit", 0.035)) tone(freq(10 + Math.random() * 6), 0.04, "triangle", 0.04); },
  pop(combo) { if (gate("pop", 0.03)) { const s = Math.min(24, (combo || 0) * 0.5); tone(freq(3 + s), 0.09, "sine", 0.14, null, null, 1.8); } },
  gate(v) { if (gate("gate", 0.09)) tone(freq(12 + Math.min(12, (v || 2) * 2)), 0.08, "sine", 0.05); },
  gateUp() { if (!gate("gateUp", 0.1)) return; [0, 7, 12].forEach((s, i) => tone(freq(12 + s), 0.12, "triangle", 0.08, null, ac.currentTime + i * 0.05)); },
  clang() { if (gate("clang", 0.06)) tone(freq(19), 0.06, "square", 0.03, null, null, 0.7); },
  boom() { if (gate("boom", 0.06)) { noise(0.35, 0.3, 700); tone(70, 0.3, "sine", 0.25, null, null, 0.4); } },
  coin() { if (gate("coin", 0.05)) { tone(freq(19), 0.06, "square", 0.03); tone(freq(24), 0.12, "square", 0.03, null, ac.currentTime + 0.05); } },
  breach() { if (!gate("breach", 0.1)) return; tone(110, 0.35, "sawtooth", 0.15, null, null, 0.35); noise(0.3, 0.2, 400); },
  pickup(good) { if (!gate("pickup", 0.1)) return; (good ? [0, 4, 7, 12] : [7, 3, 0, -5]).forEach((s, i) => tone(freq(s + 5), 0.14, good ? "triangle" : "sawtooth", 0.08, null, ac.currentTime + i * 0.06)); },
  catch() { if (!gate("catch", 0.1)) return; [0, 5, 9, 12, 17].forEach((s, i) => tone(freq(s + 7), 0.1, "triangle", 0.07, null, ac.currentTime + i * 0.035)); },
  fever() { if (!ac || !on) return; [0, 4, 7, 11, 14, 19, 24].forEach((s, i) => tone(freq(s), 0.18, "square", 0.05, null, ac.currentTime + i * 0.04)); },
  boss() { if (!ac || !on) return; tone(55, 1.2, "sawtooth", 0.18, null, null, 0.8); tone(58, 1.2, "sawtooth", 0.12, null, null, 0.8); },
  bossDown() { if (!ac || !on) return; noise(1.2, 0.35, 500); [0, 4, 7, 12, 16, 19, 24].forEach((s, i) => tone(freq(s), 0.4, "triangle", 0.09, null, ac.currentTime + 0.3 + i * 0.07)); },
  won() { if (!ac || !on) return; [0, 4, 7, 12, 7, 12, 16, 24].forEach((s, i) => tone(freq(s), 0.22, "square", 0.05, null, ac.currentTime + i * 0.09)); },
  lost() { if (!ac || !on) return; [7, 6, 5, 4, 0].forEach((s, i) => tone(freq(s - 5), 0.3, "sawtooth", 0.06, null, ac.currentTime + i * 0.18)); },
  draft() { if (!ac || !on) return; [0, 12].forEach((s, i) => tone(freq(s + 12), 0.25, "sine", 0.08, null, ac.currentTime + i * 0.08)); },
  pick() { if (!ac || !on) return; tone(freq(19), 0.12, "triangle", 0.1); tone(freq(24), 0.2, "triangle", 0.08, null, ac.currentTime + 0.06); },
  reveal(good) { if (!ac || !on) return; (good ? [0, 7, 12, 19, 24] : [0, -1, -2]).forEach((s, i) => tone(freq(s + 12), 0.15, "triangle", 0.08, null, ac.currentTime + i * 0.06)); },
  tick() { tone(freq(24), 0.03, "square", 0.025); },
  click() { tone(freq(14), 0.04, "triangle", 0.05); },
  buy() { if (!ac || !on) return; [0, 7, 12].forEach((s, i) => tone(freq(s + 12), 0.1, "square", 0.04, null, ac.currentTime + i * 0.05)); },
  nope() { tone(150, 0.12, "square", 0.05, null, null, 0.7); }
};

/** Called every frame: schedules the music a beat ahead. Four on the
    floor, a bass that walks a minor pentatonic, and hats; Fever doubles
    the tempo and lifts the key. */
export function musicTick() {
  if (!ac || !musicOn || !on || !playing) return;
  const now = ac.currentTime;
  if (nextBeat < now) nextBeat = now + 0.05;
  const spb = fever ? 0.15 : 0.24;
  const bass = [0, 0, 3, 0, 5, 3, 7, 5];
  while (nextBeat < now + 0.25) {
    const t = nextBeat, lift = fever ? 5 : 0;
    if (beat % 2 === 0) tone(90, 0.16, "sine", 0.9, musicGain, t, 0.35);
    tone(freq(-24 + bass[Math.floor(beat / 2) % 8] + lift), spb * 0.9, "triangle", 0.45, musicGain, t);
    if (beat % 2 === 1) noiseHat(t);
    if (beat % 16 === 14) tone(freq(lift + bass[(beat >> 1) % 8]), spb * 2, "square", 0.08, musicGain, t);
    beat++; nextBeat += spb;
  }
}
function noiseHat(t) {
  if (!noiseBuf) noise(0.001, 0.0001, 100);
  const n = ac.createBufferSource(); n.buffer = noiseBuf;
  const f = ac.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 7000;
  const g = ac.createGain(); g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  n.connect(f); f.connect(g); g.connect(musicGain); n.start(t, Math.random() * 0.5); n.stop(t + 0.06);
}
