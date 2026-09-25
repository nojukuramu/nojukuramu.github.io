/* audio.js — every sound in the game, synthesised; there are no audio files.
 *
 * The shape is Magic Sandbox's audio.js (itself The Wolf Game's sound.js):
 * one context created on the first gesture, noise buffers made once, a small
 * noise reverb, and recipes rather than recordings. What is added here is
 * position: a sound somebody else makes is panned to where they are and
 * quietened by distance, so a gunfight you cannot see is still a gunfight
 * you can find — and so a hack's "sound ESP" has something to compete with.
 *
 * Nothing plays before a touch or a key. Two sliders in Settings. */

import { S, on } from "./state.js";
import { save } from "./save.js";

let ctx = null, master, sfxBus, verb, verbSend, noiseW, noiseB;
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
  comp.threshold.value = -12; comp.ratio.value = 5;
  master.connect(comp); comp.connect(ctx.destination);
  sfxBus = ctx.createGain(); sfxBus.connect(master);
  verb = makeVerb(1.6, 3);
  verbSend = ctx.createGain(); verbSend.gain.value = 0.22;
  verbSend.connect(verb); verb.connect(master);
  noiseW = noiseBuffer(2, false); noiseB = noiseBuffer(3, true);
  applyVolumes();
}
["pointerdown", "keydown", "touchstart"].forEach((ev) => addEventListener(ev, start, { passive: true }));
document.addEventListener("visibilitychange", () => { if (!ctx) return; if (document.hidden) ctx.suspend(); else ctx.resume(); });

export function applyVolumes() {
  if (!ctx) return;
  const s = save.settings, t = ctx.currentTime;
  master.gain.setTargetAtTime(s.master, t, 0.05);
  sfxBus.gain.setTargetAtTime(s.sfx * 0.9, t, 0.05);
}

/* ---------------------------------------------------------------
   Building blocks: a tone, a burst of filtered noise, and where it is
   --------------------------------------------------------------- */
let out = null;         // the node recipes connect to: the bus, or a panner for somebody else's sound
function tone(f0, f1, dur, type, vol, delay, opts) {
  opts = opts || {};
  const t = ctx.currentTime + (delay || 0);
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type || "sine";
  o.frequency.setValueAtTime(f0, t);
  if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol || 0.1, t + (opts.attack || 0.004));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let node = o;
  if (opts.lp) { const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = opts.lp; node.connect(f); node = f; }
  node.connect(g); g.connect(out || sfxBus);
  if (opts.verb) g.connect(verbSend);
  o.start(t); o.stop(t + dur + 0.05);
}
function noise(dur, vol, type, f0, f1, delay, opts) {
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
  g.gain.exponentialRampToValueAtTime(vol, t + (opts.attack || 0.003));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f); f.connect(g); g.connect(out || sfxBus);
  if (opts.verb) g.connect(verbSend);
  src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
}
const throttle = {};
function gate(key, ms) {
  const now = performance.now();
  if (throttle[key] && now - throttle[key] < ms) return false;
  throttle[key] = now; return true;
}

/* Somebody else's sound: panned by where they are from where you look, and
   quieter with distance (an inverse falloff that never quite reaches zero). */
function at(a) {
  if (!a || a === S.me || !S.me) return null;
  const dx = a.body.x - S.cam.x, dz = a.body.z - S.cam.z;
  const d = Math.hypot(dx, a.body.y - S.cam.y, dz);
  const g = ctx.createGain();
  g.gain.value = Math.min(1, 6 / (d + 4));
  const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  if (p) {
    const ang = Math.atan2(dx, dz) - Math.atan2(-Math.sin(S.cam.yaw), -Math.cos(S.cam.yaw));
    p.pan.value = Math.max(-1, Math.min(1, -Math.sin(ang)));
    g.connect(p); p.connect(sfxBus);
  } else g.connect(sfxBus);
  setTimeout(() => { try { g.disconnect(); if (p) p.disconnect(); } catch (e) {} }, 2500);
  return g;
}

/* ---------------------------------------------------------------
   Recipes
   --------------------------------------------------------------- */
const GUN_SOUND = {
  wasp:    () => { noise(0.1, 0.3, "bandpass", 2600, 900, 0, { q: 0.9 }); tone(260, 90, 0.08, "square", 0.08, 0, { lp: 1600 }); },
  brick:   () => { noise(0.3, 0.45, "lowpass", 2400, 200, 0, { verb: true }); tone(120, 45, 0.25, "sine", 0.35); },
  hornet:  () => { noise(0.06, 0.24, "bandpass", 3200, 1400, 0, { q: 1.1 }); tone(320, 140, 0.05, "square", 0.05, 0, { lp: 1800 }); },
  kestrel: () => { noise(0.11, 0.32, "bandpass", 1800, 600, 0, { q: 0.8 }); tone(170, 70, 0.1, "sine", 0.2); },
  mauler:  () => { noise(0.35, 0.5, "lowpass", 1800, 150, 0, { verb: true }); tone(90, 40, 0.3, "sine", 0.4); noise(0.12, 0.12, "bandpass", 900, 500, 0.32, { q: 3 }); },
  talon:   () => { noise(0.5, 0.55, "lowpass", 3500, 120, 0, { verb: true }); tone(80, 30, 0.45, "sine", 0.45); tone(1800, 600, 0.08, "square", 0.04); }
};
const SFX = {
  dry() { tone(1600, 1600, 0.03, "square", 0.04); },
  reload() { noise(0.05, 0.08, "bandpass", 2500, 2000, 0, { q: 5 }); noise(0.05, 0.1, "bandpass", 1800, 1600, 0.35, { q: 5 }); },
  reloaded() { noise(0.06, 0.12, "bandpass", 2200, 1400, 0, { q: 4 }); },
  swap() { noise(0.08, 0.06, "bandpass", 1500, 2500, 0, { q: 2 }); },
  swing() { noise(0.18, 0.16, "bandpass", 1200, 4000, 0, { q: 0.7 }); },
  hit() { if (gate("hit", 30)) tone(1900, 1900, 0.035, "square", 0.05); },
  head() { tone(2600, 2600, 0.12, "sine", 0.12, 0, { verb: true }); tone(3900, 3900, 0.08, "sine", 0.04); },
  kill() { [0, 5, 10].forEach((s, i) => tone(880 * Math.pow(2, s / 12), 0, 0.14, "triangle", 0.07, i * 0.05)); },
  hurt() { if (gate("hurt", 60)) { tone(140, 60, 0.2, "sawtooth", 0.1, 0, { lp: 700 }); noise(0.12, 0.14, "lowpass", 700, 200); } },
  death() { [0, -4, -9].forEach((s, i) => tone(330 * Math.pow(2, s / 12), 0, 0.5, "triangle", 0.07, i * 0.16, { verb: true })); },
  step() { if (gate("step" + (out ? "o" : ""), 70)) noise(0.05, 0.06, "lowpass", 900, 300); },
  jump() { noise(0.1, 0.05, "lowpass", 600, 200); },
  land(v) { noise(0.14, Math.min(0.3, 0.05 + (v || 0) * 0.018), "lowpass", 500, 90, 0, { brown: true }); },
  walljump() { noise(0.2, 0.14, "bandpass", 700, 2600, 0, { q: 0.7 }); tone(220, 440, 0.1, "triangle", 0.04); },
  climb() { noise(0.3, 0.06, "bandpass", 400, 900, 0, { q: 1.5 }); },
  mantle() { noise(0.15, 0.08, "lowpass", 800, 300); },
  slide() { noise(0.6, 0.1, "bandpass", 500, 250, 0, { q: 0.6, attack: 0.03 }); },
  stick() { tone(90, 60, 0.12, "sine", 0.2); noise(0.08, 0.12, "lowpass", 1200, 300); },
  lunge() { noise(0.35, 0.22, "bandpass", 500, 3200, 0, { q: 0.6 }); tone(180, 520, 0.25, "sawtooth", 0.05, 0, { lp: 1500 }); },
  pad() { tone(160, 640, 0.35, "sine", 0.18, 0, { verb: true }); noise(0.25, 0.1, "bandpass", 600, 2400, 0, { q: 0.8 }); },
  ui() { tone(1400, 1400, 0.04, "sine", 0.035); },
  win() { [0, 4, 7, 12, 16].forEach((s, i) => tone(523 * Math.pow(2, s / 12), 0, 0.4, "triangle", 0.08, i * 0.1, { verb: true })); }
};
export function play(name, a, who) {
  if (!ctx) return;
  const r = SFX[name] || GUN_SOUND[name];
  if (!r) return;
  try { out = who ? at(who) : null; r(a); } catch (e) { /* a sound is only a sound */ } finally { out = null; }
}

/* ---------------------------------------------------------------
   Listening
   --------------------------------------------------------------- */
let stepAcc = new Map();
export function tickSteps(dt) {
  if (!ctx) return;
  for (const a of S.actors) {
    if (!a.alive || !a.body.onGround || a.body.sliding || a.body.crouched) continue;
    const hs = Math.hypot(a.body.vx, a.body.vz);
    if (hs < 2.5) continue;
    const acc = (stepAcc.get(a.id) || 0) + hs * dt;
    if (acc > 2.1) { stepAcc.set(a.id, 0); play("step", 0, a === S.me ? null : a); } else stepAcc.set(a.id, acc);
  }
}
on("fired", (a, e) => play(e.gun, 0, a === S.me ? null : a));
on("arms", (a, e) => { if (e.type === "fire") return; if (e.type === "swing") play("swing", 0, a === S.me ? null : a); else if (a === S.me) play(e.type); });
on("move", (a, ev) => {
  const who = a === S.me ? null : a;
  if (ev === "land") play("land", a.body.landSpeed, who);
  else if (SFX[ev]) play(ev, 0, who);
});
on("hit", (a, b, dmg, info) => { if (a === S.me) play(info && info.part === "head" ? "head" : "hit"); });
on("hurt", (b) => { if (b === S.me) play("hurt"); });
on("died", (b) => { if (b === S.me) play("death"); });
on("killfeed", (k) => { if (k.killer === S.me && k.victim !== S.me) play("kill"); });
on("matchEnd", (m) => { if (S.me && (m.mode === "tdm" ? m.winner === S.me.team : m.winner === S.me.id)) play("win"); });
on("ui", () => play("ui"));
