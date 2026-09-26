/* audio.js — every sound in the game, synthesised; there are no audio files.
 *
 * The shape is The Wolf Game's sound.js (the-wolf-game/js/ui/sound.js):
 * one context created on the first gesture, a noise-based reverb, noise
 * buffers made once, and recipes rather than recordings. What is added here
 * is a music bed that follows the floor's theme and a percussion layer that
 * comes in when something is actually fighting you and leaves when it stops.
 *
 * Nothing plays before a touch or a key, and the three volume sliders in
 * Settings are the only controls: master, music, effects. */

import { S, on } from "./state.js";
import { save } from "./save.js";

let ctx = null, master, sfxBus, musicBus, verb, verbSend, noiseW, noiseB;
let started = false;

function makeVerb(seconds, decay) {
  const rate = ctx.sampleRate, len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  const c = ctx.createConvolver(); c.buffer = buf; return c;
}
function noiseBuffer(seconds, brown) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2; } else d[i] = w;
  }
  return buf;
}

function start() {
  if (started) { if (ctx && ctx.state === "suspended") ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  started = true;
  ctx = new AC();
  master = ctx.createGain();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.ratio.value = 4;
  master.connect(comp); comp.connect(ctx.destination);
  sfxBus = ctx.createGain(); sfxBus.connect(master);
  musicBus = ctx.createGain(); musicBus.connect(master);
  verb = makeVerb(2.4, 2.6);
  verbSend = ctx.createGain(); verbSend.gain.value = 0.3;
  verbSend.connect(verb); verb.connect(master);
  noiseW = noiseBuffer(2, false); noiseB = noiseBuffer(3, true);
  applyVolumes();
  musicLoop();
}
["pointerdown", "keydown", "touchstart"].forEach((ev) => addEventListener(ev, start, { passive: true }));
document.addEventListener("visibilitychange", () => {
  if (!ctx) return;
  if (document.hidden) ctx.suspend(); else ctx.resume();
});

export function applyVolumes() {
  if (!ctx) return;
  const s = save.settings, t = ctx.currentTime;
  master.gain.setTargetAtTime(s.master, t, 0.05);
  sfxBus.gain.setTargetAtTime(s.sfx * 0.9, t, 0.05);
  musicBus.gain.setTargetAtTime(s.music * 0.5, t, 0.3);
}

/* ---------------------------------------------------------------
   Building blocks
   --------------------------------------------------------------- */
function tone(f0, f1, dur, type, vol, delay, opts) {
  if (!ctx) return;
  opts = opts || {};
  const t = ctx.currentTime + (delay || 0);
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type || "sine";
  o.frequency.setValueAtTime(f0, t);
  if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  if (opts.detune) o.detune.value = opts.detune;
  const a = opts.attack || 0.004;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol || 0.1, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let node = o;
  if (opts.lp) { const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = opts.lp; node.connect(f); node = f; }
  node.connect(g);
  g.connect(opts.bus || sfxBus);
  if (opts.verb) g.connect(verbSend);
  o.start(t); o.stop(t + dur + 0.05);
}
function noise(dur, vol, type, f0, f1, delay, opts) {
  if (!ctx) return;
  opts = opts || {};
  const t = ctx.currentTime + (delay || 0);
  const src = ctx.createBufferSource();
  src.buffer = opts.brown ? noiseB : noiseW;
  src.playbackRate.value = opts.rate || 1;
  const f = ctx.createBiquadFilter();
  f.type = type || "bandpass";
  f.frequency.setValueAtTime(f0 || 1000, t);
  if (f1) f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
  f.Q.value = opts.q || 1;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + (opts.attack || 0.005));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f); f.connect(g); g.connect(opts.bus || sfxBus);
  if (opts.verb) g.connect(verbSend);
  src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
}
const throttle = {};
function gate(key, ms) {
  const now = performance.now();
  if (throttle[key] && now - throttle[key] < ms) return false;
  throttle[key] = now; return true;
}
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16];
const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

/* ---------------------------------------------------------------
   Recipes
   --------------------------------------------------------------- */
const SFX = {
  castfire() { noise(0.22, 0.16, "bandpass", 700, 2400, 0, { q: 0.8 }); tone(180, 90, 0.16, "sine", 0.12); },
  castwater() { tone(700, 320, 0.16, "sine", 0.11); tone(1050, 500, 0.12, "sine", 0.05, 0.03); },
  castearth() { tone(140, 55, 0.22, "sine", 0.2); noise(0.18, 0.1, "lowpass", 600, 200); },
  castair() { tone(1300, 2200, 0.14, "sine", 0.05); noise(0.2, 0.08, "highpass", 2500, 5000); },
  castarcane() { tone(660, 440, 0.14, "triangle", 0.08); },
  hit() { if (gate("hit", 35)) { noise(0.06, 0.08, "bandpass", 2500, 1200, 0, { q: 2 }); tone(300, 160, 0.06, "square", 0.03); } },
  kill() { if (gate("kill", 40)) { tone(1800, 700, 0.12, "triangle", 0.07); noise(0.08, 0.1, "highpass", 3000, 1500); } },
  boom(r) { if (gate("boom", 60)) { noise(0.35 + (r || 1) * 0.05, 0.22, "lowpass", 1200, 120, 0, { brown: false }); tone(90, 32, 0.4, "sine", 0.22); } },
  nova() { noise(0.35, 0.14, "bandpass", 400, 3000, 0, { q: 0.7 }); tone(220, 440, 0.25, "triangle", 0.06); },
  zap() { if (gate("zap", 60)) for (let i = 0; i < 5; i++) tone(800 + Math.random() * 2400, 300, 0.03, "square", 0.04, i * 0.018); },
  freeze() { [2093, 2637, 3136].forEach((f, i) => tone(f, f, 0.2, "sine", 0.04, i * 0.03, { verb: true })); },
  hurt() { tone(160, 60, 0.25, "sawtooth", 0.13, 0, { lp: 900 }); noise(0.15, 0.15, "lowpass", 800, 200); },
  dash() { noise(0.2, 0.12, "bandpass", 3000, 600, 0, { q: 0.6 }); },
  xp() { if (gate("xp", 45)) tone(hz(84 + PENTA[Math.floor(Math.random() * 5)]), 0, 0.12, "sine", 0.035); },
  hp() { tone(880, 880, 0.18, "sine", 0.05, 0, { verb: true }); tone(1320, 1320, 0.2, "sine", 0.03, 0.05); },
  mana() { tone(1175, 1175, 0.16, "sine", 0.04, 0, { verb: true }); },
  potion() { tone(523, 784, 0.3, "sine", 0.08, 0, { verb: true }); noise(0.3, 0.05, "bandpass", 1500, 800); },
  level() { [0, 4, 7, 12, 16].forEach((s, i) => tone(hz(72 + s), 0, 0.25, "triangle", 0.07, i * 0.07, { verb: true })); },
  boon() { [0, 7, 12].forEach((s, i) => tone(hz(67 + s), 0, 0.6, "sine", 0.07, i * 0.02, { verb: true })); },
  chest() { [0, 4, 7, 11, 14].forEach((s, i) => tone(hz(79 + s), 0, 0.3, "sine", 0.05, i * 0.05, { verb: true })); },
  shrine() { [0, 4, 7].forEach((s) => tone(hz(60 + s), 0, 1.4, "sine", 0.06, 0, { attack: 0.3, verb: true })); },
  portal() { tone(200, 800, 1.2, "sine", 0.06, 0, { attack: 0.3, verb: true }); [0, 7, 12].forEach((s, i) => tone(hz(64 + s), 0, 1.6, "triangle", 0.05, 0.4 + i * 0.1, { verb: true })); },
  ascend() { noise(1.1, 0.16, "bandpass", 300, 4000, 0, { q: 0.5, attack: 0.3 }); [0, 4, 7, 12].forEach((s, i) => tone(hz(60 + s), 0, 1.2, "sine", 0.06, 0.3 + i * 0.08, { verb: true })); },
  roar() { tone(55, 40, 1.4, "sawtooth", 0.12, 0, { lp: 500, attack: 0.1 }); tone(58, 42, 1.4, "sawtooth", 0.1, 0, { lp: 400, attack: 0.1 }); noise(1.2, 0.12, "lowpass", 300, 120, 0, { brown: true, attack: 0.2 }); },
  slam() { noise(0.5, 0.25, "lowpass", 500, 60, 0, { brown: true }); tone(70, 28, 0.5, "sine", 0.28); },
  enemyFire() { if (gate("efire", 70)) tone(520, 300, 0.1, "triangle", 0.05); },
  warn() { if (gate("warn", 120)) tone(880, 880, 0.08, "square", 0.025); },
  thunder() { noise(2.2, 0.3, "lowpass", 400, 60, 0, { brown: true, attack: 0.02 }); },
  noMana() { if (gate("nomana", 400)) tone(220, 180, 0.12, "sine", 0.06); },
  anchor() { noise(0.9, 0.22, "lowpass", 1500, 80, 0, { brown: true }); [0, 3, 7].forEach((s, i) => tone(hz(50 + s), 0, 1.2, "sawtooth", 0.05, i * 0.03, { lp: 900, verb: true })); },
  rank() { [0, 4, 7, 12, 16, 19].forEach((s, i) => tone(hz(60 + s), 0, 0.9, "triangle", 0.06, i * 0.09, { verb: true })); },
  death() { [0, -3, -7, -12].forEach((s, i) => tone(hz(57 + s), 0, 0.8, "triangle", 0.07, i * 0.22, { verb: true })); },
  victory() { [0, 4, 7, 12, 7, 12, 16, 19].forEach((s, i) => tone(hz(60 + s), 0, 0.5, "triangle", 0.08, i * 0.12, { verb: true })); },
  ui() { tone(1400, 1400, 0.04, "sine", 0.035); },
  trigger() { tone(900, 1500, 0.08, "square", 0.04); noise(0.1, 0.08, "highpass", 3000, 6000); },
  discover() { [0, 7, 12, 19].forEach((s, i) => tone(hz(84 + s), 0, 0.3, "sine", 0.04, i * 0.05, { verb: true })); },
  shield() { tone(600, 1200, 0.3, "sine", 0.04, 0, { verb: true }); },
  bounce() { if (gate("bounce", 50)) tone(1500, 900, 0.05, "sine", 0.03); }
};
export function play(name, a) { if (!ctx || !SFX[name]) return; try { SFX[name](a); } catch (e) {} }

on("cast", (c) => play("cast" + (c.elements[0] || "arcane")));
on("hitEnemy", () => play("hit"));
on("kill", (e) => play(e.type === "anchor" ? "anchor" : "kill"));
on("boom", (r) => play("boom", r));
on("nova", () => play("nova"));
on("zap", () => play("zap"));
on("freeze", () => play("freeze"));
on("playerHurt", () => play("hurt"));
on("dash", () => play("dash"));
on("pickup", (t) => play(t === "xp" ? "xp" : t === "hp" ? "hp" : t === "mana" ? "mana" : t === "potion" ? "potion" : "rank"));
on("potion", () => play("potion"));
on("levelUp", () => play("level"));
on("boonTaken", () => play("boon"));
on("chest", () => play("chest"));
on("shrine", () => play("shrine"));
on("portalOpen", () => play("portal"));
on("ascend", () => play("ascend"));
on("bossIntro", () => play("roar"));
on("bossPhase", () => play("roar"));
on("slam", () => play("slam"));
on("impact", () => play("boom", 0.5));
on("lances", () => play("slam"));
on("enemyFire", () => play("enemyFire"));
on("bossFire", () => play("enemyFire"));
on("thunder", () => play("thunder"));
on("noMana", () => play("noMana"));
on("denied", () => play("noMana"));
on("rankUp", () => play("rank"));
on("attune", () => play("rank"));
on("playerDied", () => play("death"));
on("victory", () => play("victory"));
on("trigger", () => play("trigger"));
on("payload", () => play("trigger"));
on("discover", () => play("discover"));
on("shield", () => play("shield"));
on("bounce", () => play("bounce"));
on("lunge", () => play("warn"));
on("ui", () => play("ui"));

/* ---------------------------------------------------------------
   Music: a slow pad, a sparse pluck, a bass, and drums for fights.
   One progression per theme; the scheduler looks a little ahead so
   a stalled frame never makes the music stumble.
   --------------------------------------------------------------- */
const SONGS = {
  title:   { root: 53, prog: [[0, 4, 7], [-3, 0, 4], [-7, -3, 0], [-5, -1, 2]], scale: [0, 2, 4, 7, 9], bpm: 76, bright: 1400 },
  verdant: { root: 50, prog: [[0, 3, 7], [-2, 2, 5], [-4, 0, 3], [-2, 2, 5]], scale: [0, 2, 3, 5, 7, 9, 10], bpm: 92, bright: 1600 },
  sanctum: { root: 53, prog: [[0, 4, 7], [4, 7, 11], [5, 9, 12], [7, 11, 14]], scale: [0, 2, 4, 7, 9], bpm: 84, bright: 1500 },
  ember:   { root: 52, prog: [[0, 3, 7], [1, 5, 8], [0, 3, 7], [-2, 2, 5]], scale: [0, 1, 3, 5, 7, 8, 10], bpm: 104, bright: 1100 },
  frost:   { root: 57, prog: [[0, 3, 7], [-4, 0, 3], [-9, -5, -2], [-2, 2, 5]], scale: [0, 2, 3, 7, 8], bpm: 80, bright: 2200 },
  void:    { root: 49, prog: [[0, 3, 7], [-4, 0, 3], [-3, 1, 4], [-1, 3, 6]], scale: [0, 1, 3, 6, 7, 10], bpm: 88, bright: 900 },
  storm:   { root: 47, prog: [[0, 3, 7], [-4, -1, 3], [3, 7, 10], [-2, 2, 5]], scale: [0, 2, 3, 5, 7, 8, 10], bpm: 112, bright: 1300 }
};
let song = SONGS.title, nextBar = 0, bar = 0, nextBeat = 0, beat = 0, intensity = 0, targetIntensity = 0, nextPluck = 0;
let songId = "title";

export function setSong(id) {
  if (!SONGS[id] || id === songId) return;
  songId = id; song = SONGS[id];
  if (ctx) { nextBar = Math.max(nextBar, ctx.currentTime + 0.5); bar = 0; }
}
export function setIntensity(v) { targetIntensity = v; }

function padChord(t, notes, len) {
  for (const n of notes) {
    for (const det of [-7, 7]) {
      const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
      o.type = "sawtooth"; o.frequency.value = hz(song.root + n); o.detune.value = det;
      f.type = "lowpass"; f.frequency.value = song.bright * 0.5; f.Q.value = 0.6;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.022, t + len * 0.35);
      g.gain.linearRampToValueAtTime(0.0001, t + len * 1.05);
      o.connect(f); f.connect(g); g.connect(musicBus); g.connect(verbSend);
      o.start(t); o.stop(t + len * 1.1);
    }
  }
  const b = ctx.createOscillator(), bg = ctx.createGain();
  b.type = "sine"; b.frequency.value = hz(song.root + notes[0] - 24);
  bg.gain.setValueAtTime(0.0001, t); bg.gain.linearRampToValueAtTime(0.06, t + 0.4); bg.gain.linearRampToValueAtTime(0.0001, t + len);
  b.connect(bg); bg.connect(musicBus); b.start(t); b.stop(t + len + 0.1);
}
function pluck(t, midi, vol) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = "triangle"; o.frequency.value = hz(midi);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
  o.connect(g); g.connect(musicBus); g.connect(verbSend);
  o.start(t); o.stop(t + 1);
}
function kick(t, vol) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.14);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
  o.connect(g); g.connect(musicBus); o.start(t); o.stop(t + 0.25);
}
function hat(t, vol) {
  const s = ctx.createBufferSource(); s.buffer = noiseW;
  const f = ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 7000;
  const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  s.connect(f); f.connect(g); g.connect(musicBus); s.start(t, Math.random()); s.stop(t + 0.06);
}

function musicLoop() {
  setInterval(() => {
    if (!ctx || ctx.state !== "running" || save.settings.music <= 0.001) return;
    const now = ctx.currentTime, ahead = now + 0.4;
    intensity += (targetIntensity - intensity) * 0.08;
    const spb = 60 / song.bpm, barLen = spb * 8;
    if (nextBar < now) nextBar = now + 0.1;
    while (nextBar < ahead) {
      padChord(nextBar, song.prog[bar % song.prog.length], barLen);
      bar++; nextBar += barLen;
    }
    if (nextPluck < now) nextPluck = now + 0.2;
    while (nextPluck < ahead) {
      if (Math.random() < 0.55) {
        const chord = song.prog[(bar + song.prog.length - 1) % song.prog.length];
        const deg = song.scale[Math.floor(Math.random() * song.scale.length)];
        pluck(nextPluck, song.root + 12 + (Math.random() < 0.5 ? deg : chord[Math.floor(Math.random() * 3)] + 12), 0.03 + intensity * 0.01);
      }
      nextPluck += spb * (Math.random() < 0.5 ? 1 : 2);
    }
    if (nextBeat < now) nextBeat = now + 0.05;
    while (nextBeat < ahead) {
      if (intensity > 0.08) {
        const b8 = beat % 8;
        if (b8 === 0 || b8 === 4 || (intensity > 0.6 && b8 === 6)) kick(nextBeat, 0.16 * intensity);
        if (b8 % 2 === 1) hat(nextBeat, 0.035 * intensity);
        if (intensity > 0.5 && b8 === 3) hat(nextBeat, 0.02 * intensity);
      }
      beat++; nextBeat += spb / 2;
    }
  }, 100);
}

/* The game tells us how tense things are; music follows. */
on("title", () => { setSong("title"); setIntensity(0); });
on("floorStart", (floor, theme) => setSong(theme.id === "sanctum" ? "sanctum" : theme.id));
export function tick() {
  if (S.mode === "title" || !S.player) { setIntensity(0); return; }
  let n = 0;
  for (const e of S.enemies) if (e.alive && e.aggro && e.type !== "anchor" && e.type !== "dummy" && e.type !== "geode") n++;
  const boss = S.boss && S.boss.alive && S.boss.state !== "sleep";
  setIntensity(boss ? 1 : Math.min(0.85, n * 0.14));
}

