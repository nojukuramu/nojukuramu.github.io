/* audio.js — every sound in the game, and the announcer.
 *
 * The shape is Magic Sandbox's audio.js (itself The Wolf Game's sound.js):
 * one context created on the first gesture, noise buffers made once, a small
 * noise reverb, and recipes. On top of the recipes are recordings — every
 * gun's shot (and a distant take of it, for somebody else's far away), the
 * reloads, a bolt worked, a pump racked, a blade's cut, footsteps, metal,
 * and an announcer — all free to use, each listed with where it came from in
 * assets/sounds/CREDITS.md. They load in the background after the first
 * gesture; until one has arrived (or if it never does, offline before the
 * first install finished) its recipe plays instead, so the game is never
 * silent and never waits.
 *
 * A sound somebody else makes is panned to where they are and quietened by
 * distance, so a gunfight you cannot see is still a gunfight you can find —
 * and so a hack's "sound ESP" has something to compete with.
 *
 * The announcer (medals.js decides what is worth saying) has its own bus and
 * slider, speaks one line at a time, and the rest of the mix dips under it.
 * The two lines no recording has — "Nut shot" and "Collateral" — are spoken
 * by the device's own voice, but only one that runs on the device: a voice
 * that would send the words to a server says nothing at all.
 *
 * The mix is loud on purpose: a shooter heard on a phone's speaker has to
 * cut through, so everything runs into a compressor, is made up by a good
 * margin and caught by a limiter, rather than being left quiet and safe. A
 * flashbang or a blast at your feet deafens you: a ring, and the world
 * heard through a low-pass that opens again slowly.
 *
 * Nothing plays before a touch or a key. Three sliders in Settings. */

import { S, on } from "./state.js";
import { save } from "./save.js";
import { GUNS } from "./weapons.js";
import { HOOK } from "./movement.js";

let ctx = null, master, sfxBus, voiceBus, verb, verbSend, noiseW, noiseB, deaf;
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
  // squeeze, make up, and catch the peaks: loud, without the clipping a plain gain would give
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18; comp.knee.value = 8; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.22;
  const makeup = ctx.createGain(); makeup.gain.value = 2.1;
  const limit = ctx.createDynamicsCompressor();
  limit.threshold.value = -2; limit.knee.value = 0; limit.ratio.value = 20; limit.attack.value = 0.001; limit.release.value = 0.08;
  master.connect(comp); comp.connect(makeup); makeup.connect(limit); limit.connect(ctx.destination);
  // what deafens: everything but the announcer goes through a low-pass that is wide open until a flash
  deaf = ctx.createBiquadFilter(); deaf.type = "lowpass"; deaf.frequency.value = 20000; deaf.Q.value = 0.5;
  deaf.connect(master);
  sfxBus = ctx.createGain(); sfxBus.connect(deaf);
  voiceBus = ctx.createGain(); voiceBus.connect(master);
  verb = makeVerb(1.6, 3);
  verbSend = ctx.createGain(); verbSend.gain.value = 0.22;
  verbSend.connect(verb); verb.connect(deaf);
  noiseW = noiseBuffer(2, false); noiseB = noiseBuffer(3, true);
  applyVolumes();
  loadSounds();
  reelLoop();
  scrapeLoop();
  primeVoice();
}
["pointerdown", "keydown", "touchstart"].forEach((ev) => addEventListener(ev, start, { passive: true }));
document.addEventListener("visibilitychange", () => { if (!ctx) return; if (document.hidden) ctx.suspend(); else ctx.resume(); });

let duck = 1;
export function applyVolumes() {
  if (!ctx) return;
  const s = save.settings, t = ctx.currentTime;
  master.gain.setTargetAtTime(s.master, t, 0.05);
  sfxBus.gain.setTargetAtTime(s.sfx * 1.15 * duck, t, 0.05);
  voiceBus.gain.setTargetAtTime(s.voice * 1.2, t, 0.05);
}

/* ---------------------------------------------------------------
   Recordings
   --------------------------------------------------------------- */
export const SOUND_FILES = [
  "wasp", "wasp_far", "brick", "brick_far", "hornet", "hornet_far", "kestrel", "kestrel_far", "mauler", "mauler_far",
  "talon", "talon_far", "condor", "condor_far",
  "reload_mag", "reload_rifle", "pump", "rack", "shell", "clip", "bolt",
  "slice", "slice2", "draw", "chop", "step1", "step2", "step3", "step4", "clank", "dink", "yelp", "grunt",
  "vo_fight", "vo_team_deathmatch", "vo_first_blood", "vo_double_kill", "vo_triple_kill", "vo_multi_kill",
  "vo_rampage", "vo_dominating", "vo_unstoppable", "vo_annihilation", "vo_headshot", "vo_killshot", "vo_precision_kill",
  "vo_revenge_kill", "vo_combo_breaker", "vo_final_round", "vo_round_winner", "vo_flawless_victory", "vo_game_over",
  "cannon", "explode", "crunch", "shield_hit", "shield_break", "shield_charge", "shield_full", "bounce", "gas", "beep", "zap", "punch", "grab", "buy", "deny"
];
const buf = {};
function loadSounds() {
  for (const name of SOUND_FILES) {
    fetch("assets/sounds/" + name + ".mp3")
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
      // the callback form too: older Safari has no promise from decodeAudioData
      .then((ab) => new Promise((res, rej) => ctx.decodeAudioData(ab, res, rej)))
      .then((b) => { buf[name] = b; })
      .catch(() => { /* its recipe stands in */ });
  }
}
/** Play a recording, if it has arrived. False when it has not, so the caller can fall back to a recipe. */
function sample(name, vol, rate, delay, bus) {
  const b = buf[name];
  if (!b) return false;
  const src = ctx.createBufferSource();
  src.buffer = b;
  src.playbackRate.value = rate || 1;
  const g = ctx.createGain();
  g.gain.value = vol;
  src.connect(g); g.connect(bus || out || sfxBus);
  src.start(ctx.currentTime + (delay || 0));
  return b.duration / (rate || 1);
}
const vary = (k) => 1 + (Math.random() - 0.5) * 2 * (k || 0.04);

/* ---------------------------------------------------------------
   Building blocks: a tone, a burst of filtered noise, and where it is
   --------------------------------------------------------------- */
let out = null;         // the node recipes connect to: the bus, or a panner for somebody else's sound
let outDist = 0;        // how far that somebody is, for picking the distant take of a gunshot
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
  node.connect(g); g.connect(opts.bus || out || sfxBus);
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
  src.connect(f); f.connect(g); g.connect(opts.bus || out || sfxBus);
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
  outDist = d;
  const g = ctx.createGain();
  g.gain.value = Math.min(1, 8 / (d + 4));
  const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  if (p) {
    const ang = Math.atan2(dx, dz) - Math.atan2(-Math.sin(S.cam.yaw), -Math.cos(S.cam.yaw));
    p.pan.value = Math.max(-1, Math.min(1, -Math.sin(ang)));
    g.connect(p); p.connect(sfxBus);
  } else g.connect(sfxBus);
  setTimeout(() => { try { g.disconnect(); if (p) p.disconnect(); } catch (e) {} }, 6000);
  return g;
}

/* ---------------------------------------------------------------
   Recipes
   --------------------------------------------------------------- */
/* The synthesised guns: what plays until the recordings arrive. */
const GUN_SYNTH = {
  wasp:    () => { noise(0.1, 0.3, "bandpass", 2600, 900, 0, { q: 0.9 }); tone(260, 90, 0.08, "square", 0.08, 0, { lp: 1600 }); },
  brick:   () => { noise(0.3, 0.45, "lowpass", 2400, 200, 0, { verb: true }); tone(120, 45, 0.25, "sine", 0.35); },
  hornet:  () => { noise(0.06, 0.24, "bandpass", 3200, 1400, 0, { q: 1.1 }); tone(320, 140, 0.05, "square", 0.05, 0, { lp: 1800 }); },
  kestrel: () => { noise(0.11, 0.32, "bandpass", 1800, 600, 0, { q: 0.8 }); tone(170, 70, 0.1, "sine", 0.2); },
  mauler:  () => { noise(0.35, 0.5, "lowpass", 1800, 150, 0, { verb: true }); tone(90, 40, 0.3, "sine", 0.4); noise(0.12, 0.12, "bandpass", 900, 500, 0.32, { q: 3 }); },
  talon:   () => { noise(0.5, 0.55, "lowpass", 3500, 120, 0, { verb: true }); tone(80, 30, 0.45, "sine", 0.45); tone(1800, 600, 0.08, "square", 0.04); },
  condor:  () => { noise(0.7, 0.6, "lowpass", 3000, 90, 0, { verb: true }); tone(60, 24, 0.6, "sine", 0.55); tone(1400, 400, 0.1, "square", 0.05); },
  cannon:  () => { noise(0.5, 0.6, "lowpass", 900, 60, 0, { verb: true, brown: true }); tone(70, 28, 0.5, "sine", 0.6); }
};
/* How loud each gun's recording sits in the mix (they are all normalised to the same peak), and how much
   of a low thump is laid under your own shot so a heavy gun is felt as well as heard. */
const GUN_MIX = { wasp: [0.6, 0.06], brick: [0.85, 0.35], hornet: [0.48, 0.04], kestrel: [0.58, 0.14], mauler: [0.85, 0.4], talon: [0.88, 0.4], condor: [1, 0.6], cannon: [1, 0.7] };
function gunshot(id) {
  const far = !!out && outDist > 28 && !!buf[id + "_far"];
  const m = GUN_MIX[id] || [0.5, 0];
  const auto = GUNS[id] && GUNS[id].auto;
  if (sample(id + (far ? "_far" : ""), m[0] * (far ? 1.6 : 1), vary(auto ? 0.05 : 0.025) * (id === "cannon" ? 0.9 : 1))) {
    if (!out && m[1]) tone(110, 38, 0.22 + m[1] * 0.3, "sine", m[1]);
    if (!far && (id === "condor" || id === "talon" || id === "mauler" || id === "brick" || id === "cannon")) noise(0.6, 0.08, "lowpass", 1200, 200, 0.02, { verb: true });
    if (id === "cannon" && !out) noise(0.25, 0.18, "bandpass", 1800, 400, 0.01, { q: 0.8 });
  } else GUN_SYNTH[id]();
  // the gun works itself after the shot: a pump racked, a bolt thrown — yours, or theirs if close
  const G = GUNS[id];
  if (G && G.pump && (!out || outDist < 20)) sample("pump", out ? 0.25 : 0.4, 1, 0.32) || noise(0.12, 0.12, "bandpass", 900, 500, 0.32, { q: 3 });
  if (G && G.bolt && (!out || outDist < 20)) sample("bolt", out ? 0.25 : 0.45, id === "condor" ? 0.82 : 1.05, id === "condor" ? 0.42 : 0.3) || noise(0.08, 0.1, "bandpass", 1700, 1300, 0.35, { q: 5 });
}
function reloadSound(id) {
  const G = GUNS[id];
  if (!G) return;
  const T = G.reload;
  if (G.pump) {
    // shells in one at a time, then the rack
    const n = Math.min(4, G.mag);
    for (let i = 0; i < n; i++) sample("shell", 0.45, vary(0.05), 0.25 + i * (T - 0.9) / n) || noise(0.05, 0.08, "bandpass", 2500, 2000, 0.25 + i * 0.4, { q: 5 });
    sample("rack", 0.55, 1, T - 0.6);
  } else if (G.bolt) {
    sample("bolt", 0.45, 0.95, 0.1); sample("clip", 0.55, 0.9, T * 0.55); sample("bolt", 0.45, 1.05, T - 0.65);
  } else if (id === "cannon") {
    // a ball rolled into the breech, and the breech slammed shut
    sample("bounce", 0.5, 0.6, T * 0.45) || noise(0.1, 0.12, "lowpass", 900, 200, T * 0.45);
    sample("clank", 0.55, 0.7, T * 0.62); sample("rack", 0.5, 0.8, T - 0.45);
  } else if (!sample(G.hold === "pistol" || id === "hornet" ? "reload_mag" : "reload_rifle", 0.5, Math.min(1.25, 1.5 / T) * (G.hold === "pistol" ? 1 : 0.95), 0.05)) {
    noise(0.05, 0.08, "bandpass", 2500, 2000, 0, { q: 5 }); noise(0.05, 0.1, "bandpass", 1800, 1600, 0.35, { q: 5 });
  }
}
const SFX = {
  dry() { tone(1600, 1600, 0.03, "square", 0.04); },
  reloaded() { sample("clip", 0.35, 1.1) || noise(0.06, 0.12, "bandpass", 2200, 1400, 0, { q: 4 }); },
  swap() { noise(0.08, 0.06, "bandpass", 1500, 2500, 0, { q: 2 }); },
  draw() { sample("draw", 0.7) || noise(0.12, 0.08, "bandpass", 2500, 5000, 0, { q: 2 }); },
  swing() { noise(0.18, 0.16, "bandpass", 1200, 4000, 0, { q: 0.7 }); },
  cut(k) { sample(k > 1.6 ? "chop" : Math.random() < 0.5 ? "slice" : "slice2", 0.55 + Math.min(0.3, (k - 1) * 0.3), vary(0.06) * (k > 1.6 ? 0.85 : 1)) || noise(0.12, 0.2, "bandpass", 3000, 900, 0, { q: 1.2 }); },
  hit() { if (gate("hit", 30)) { tone(1900, 1900, 0.035, "square", 0.08); noise(0.03, 0.08, "bandpass", 3000, 2000, 0, { q: 2 }); } },
  head() { sample("dink", 0.4, vary(0.03)) || tone(2600, 2600, 0.12, "sine", 0.12, 0, { verb: true }); tone(3900, 3900, 0.08, "sine", 0.04); },
  nut() { sample("dink", 0.45, 1.6) || tone(3200, 3200, 0.1, "sine", 0.1); tone(1500, 2600, 0.12, "sine", 0.05, 0.03); },
  yelp() { sample("yelp", 0.7, vary(0.08)) || tone(900, 1500, 0.25, "sawtooth", 0.05, 0, { lp: 2400 }); },
  /* a kill rings a little higher for each one that came quickly after the last */
  kill(q) {
    const up = Math.min(4, Math.max(0, (q || 1) - 1)) * 2;
    [0, 5, 10].forEach((s, i) => tone(880 * Math.pow(2, (s + up) / 12), 0, 0.16, "triangle", 0.08, i * 0.05));
    if (q >= 2) tone(1760 * Math.pow(2, up / 12), 0, 0.3, "sine", 0.05, 0.16, { verb: true });
  },
  hurt() { if (gate("hurt", 60)) { tone(140, 60, 0.2, "sawtooth", 0.14, 0, { lp: 700 }); noise(0.12, 0.2, "lowpass", 700, 200); } },
  death() { [0, -4, -9].forEach((s, i) => tone(330 * Math.pow(2, s / 12), 0, 0.5, "triangle", 0.07, i * 0.16, { verb: true })); },
  grunt() { sample("grunt", 0.6, vary(0.12)); },
  step() { if (gate("step" + (out ? "o" : ""), 70)) sample("step" + (1 + Math.floor(Math.random() * 4)), out ? 0.7 : 0.34, vary(0.08)) || noise(0.05, 0.06, "lowpass", 900, 300); },
  jump() { noise(0.1, 0.05, "lowpass", 600, 200); },
  land(v) { noise(0.14, Math.min(0.3, 0.05 + (v || 0) * 0.018), "lowpass", 500, 90, 0, { brown: true }); if (v > 9) sample("step1", Math.min(0.5, v * 0.03), 0.8); },
  walljump() { noise(0.2, 0.14, "bandpass", 700, 2600, 0, { q: 0.7 }); tone(220, 440, 0.1, "triangle", 0.04); },
  climb() { noise(0.3, 0.06, "bandpass", 400, 900, 0, { q: 1.5 }); sample("grab", 0.5, vary(0.1)); },
  // over a ledge: the hands slap onto it, the body hauls up
  mantle() { sample("grab", 0.7, 0.9) || noise(0.08, 0.12, "lowpass", 900, 300); noise(0.35, 0.07, "bandpass", 500, 1400, 0.06, { q: 1.2 }); },
  ledgeup() { sample("step" + (1 + Math.floor(Math.random() * 4)), out ? 0.5 : 0.4, 0.85); },
  wallslide() { sample("grab", 0.45, 0.7); noise(0.2, 0.08, "bandpass", 2200, 900, 0, { q: 1 }); },
  wallslideend() {},
  slide() { noise(0.6, 0.1, "bandpass", 500, 250, 0, { q: 0.6, attack: 0.03 }); },
  stick() { tone(90, 60, 0.12, "sine", 0.2); noise(0.08, 0.12, "lowpass", 1200, 300); },
  lunge() { noise(0.35, 0.22, "bandpass", 500, 3200, 0, { q: 0.6 }); tone(180, 520, 0.25, "sawtooth", 0.05, 0, { lp: 1500 }); },
  pad() { tone(160, 640, 0.35, "sine", 0.18, 0, { verb: true }); noise(0.25, 0.1, "bandpass", 600, 2400, 0, { q: 0.8 }); },
  // the grapple: a pneumatic thump out, metal when it bites, a zip when the line goes slack
  hookfire() { noise(0.12, 0.25, "lowpass", 1400, 200); tone(140, 70, 0.1, "sine", 0.2); noise(0.3, 0.07, "bandpass", 2600, 5200, 0.02, { q: 2 }); },
  hookhit() { sample("clank", 0.45, vary(0.05)) || tone(1300, 900, 0.15, "square", 0.05, 0, { lp: 3000 }); },
  hookgrab() { sample("chop", 0.6, 0.8) || noise(0.1, 0.2, "lowpass", 1000, 200); tone(300, 140, 0.15, "sawtooth", 0.06, 0, { lp: 1200 }); },
  hookdone() { noise(0.18, 0.1, "bandpass", 3000, 900, 0, { q: 1.5 }); },
  hookoff() { noise(0.14, 0.06, "bandpass", 2400, 900, 0, { q: 1.5 }); },
  hookmiss() { noise(0.14, 0.05, "bandpass", 2000, 700, 0, { q: 1.5 }); },
  zoom() { tone(2200, 2600, 0.05, "sine", 0.03); noise(0.05, 0.04, "bandpass", 3500, 3000, 0, { q: 6 }); },
  /* a blade at speed: a whoosh with weight in it when it cuts air; a heavy, wet impact when it lands */
  slashMiss(k) { noise(0.28, 0.32 * k, "bandpass", 900, 4200, 0, { q: 0.6 }); noise(0.2, 0.18 * k, "highpass", 3000, 6000, 0.02, { q: 0.5 }); tone(300, 900, 0.18, "sawtooth", 0.04 * k, 0, { lp: 1800 }); },
  slashHit(k) { sample("punch", 0.9, vary(0.06) * 0.95); sample("chop", 0.8, 0.8); tone(90, 40, 0.3, "sine", 0.5 * k); noise(0.4, 0.15, "lowpass", 2500, 200, 0.02, { verb: true }); },
  /* blasts: the crack, the body of it, the low end you feel; further off, only the rumble arrives */
  explode(r) {
    const far = out && outDist > 30;
    if (!far) sample("crunch", 0.9, vary(0.06)) || noise(0.3, 0.5, "bandpass", 2400, 600, 0, { q: 0.7 });
    sample("explode", far ? 1.4 : 1, vary(0.08) * (far ? 0.8 : 1)) || noise(1.2, 0.7, "lowpass", 1400, 60, 0, { verb: true, brown: true });
    tone(60, 22, 0.9, "sine", far ? 0.3 : 0.8);
    noise(1.4, 0.15, "lowpass", 700, 80, 0.05, { verb: true, brown: true });
  },
  flashbang() { sample("crunch", 1, 1.6) || noise(0.15, 0.8, "highpass", 3000, 6000, 0); noise(0.08, 0.6, "bandpass", 5000, 2000, 0, { q: 0.6 }); tone(1800, 1200, 0.12, "square", 0.08); },
  bounce(v) { if (gate("bounce" + (out ? "o" : ""), 60)) sample("bounce", Math.min(0.8, 0.2 + v * 0.05), vary(0.1) * 1.3) || tone(900, 700, 0.05, "square", 0.04); },
  thrown() { noise(0.18, 0.12, "bandpass", 700, 2400, 0, { q: 0.8 }); tone(1400, 1400, 0.02, "square", 0.03, 0.02); },
  mineSet() { sample("clank", 0.5, 1.4) || tone(1200, 900, 0.06, "square", 0.05); },
  mineArmed() { sample("beep", 0.6, 1) || tone(1800, 1800, 0.06, "sine", 0.08); tone(2400, 2400, 0.06, "sine", 0.06, 0.12); },
  trip() { sample("zap", 0.7, 0.8); },
  gasOut() { sample("gas", 0.8, vary(0.05)) || noise(2.4, 0.3, "highpass", 1500, 900, 0, { attack: 0.05 }); },
  restock() { tone(1300, 1300, 0.05, "sine", 0.05); tone(1750, 1750, 0.06, "sine", 0.05, 0.06); },
  /* shields: the crackle of a round on one, the shatter as it goes, the charge humming back, the chime when full */
  shieldHit(lvl) { if (gate("shh" + (out ? "o" : ""), 40)) sample("shield_hit", 0.55, (0.9 + 0.12 * (lvl || 1)) * vary(0.05)) || tone(2600, 2000, 0.05, "square", 0.04); },
  shieldBreak() { sample("shield_break", 1, vary(0.04)) || noise(0.35, 0.5, "highpass", 2500, 4000, 0); tone(220, 70, 0.35, "sawtooth", 0.12, 0, { lp: 1500 }); tone(80, 35, 0.4, "sine", 0.4); },
  shieldCharge() { sample("shield_charge", 0.6, 1) || tone(300, 900, 0.8, "sine", 0.06, 0, { attack: 0.2 }); },
  shieldFull() { sample("shield_full", 0.6, 1.1) || tone(1600, 2200, 0.12, "sine", 0.06); },
  shieldUp(lvl) { sample("shield_full", 0.9, 0.8 + 0.1 * lvl); tone(660 * Math.pow(2, lvl / 12), 0, 0.35, "triangle", 0.12, 0.05, { verb: true }); tone(990 * Math.pow(2, lvl / 12), 0, 0.4, "triangle", 0.1, 0.15, { verb: true }); },
  buy() { sample("buy", 0.6, 1.1) || tone(1200, 1500, 0.06, "sine", 0.06); },
  deny() { sample("deny", 0.6) || tone(300, 200, 0.12, "square", 0.05); },
  ui() { tone(1400, 1400, 0.04, "sine", 0.035); },
  win() { [0, 4, 7, 12, 16].forEach((s, i) => tone(523 * Math.pow(2, s / 12), 0, 0.4, "triangle", 0.08, i * 0.1, { verb: true })); }
};
export function play(name, a, who) {
  if (!ctx) return;
  const r = SFX[name] || (GUN_SYNTH[name] ? () => gunshot(name) : null);
  if (!r) return;
  try { outDist = 0; out = who ? at(who) : null; r(a); } catch (e) { /* a sound is only a sound */ } finally { out = null; }
}

/* ---------------------------------------------------------------
   Deafened: a ring, and the world through a closing low-pass
   --------------------------------------------------------------- */
/* k 0..1. The ring is a high sine that fades over seconds; the low-pass drops to a muffle at once and
   opens again more slowly than it shut, which is the part that makes it feel like ears, not a filter. */
function deafen(k, secs) {
  if (!ctx || !deaf) return;
  const t = ctx.currentTime, f = deaf.frequency;
  f.cancelScheduledValues(t);
  f.setValueAtTime(Math.min(f.value, 20000), t);
  f.exponentialRampToValueAtTime(Math.max(250, 1800 * (1 - k) + 250), t + 0.04);
  f.setValueAtTime(Math.max(250, 1800 * (1 - k) + 250), t + secs * 0.35);
  f.exponentialRampToValueAtTime(20000, t + secs);
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = "sine"; o.frequency.value = 3400 + Math.random() * 600;
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16 * k, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + secs);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + secs + 0.1);
}

/* ---------------------------------------------------------------
   The announcer: one line at a time, the mix dipping under it
   --------------------------------------------------------------- */
const queue = [];
let speaking = false, speakT = 0;
function announce(lines) {
  if (!ctx || !save.settings.voice) return;
  for (const l of lines) if (queue.length < 3) queue.push(l);
  if (!speaking) next();
}
function next() {
  const line = queue.shift();
  if (!line) { speaking = false; duck = 1; applyVolumes(); return; }
  speaking = true;
  let dur = 0;
  if (line[0] === "!") dur = say(line.slice(1));
  else dur = sample("vo_" + line, 1, 1, 0, voiceBus) || 0;
  if (!dur) { next(); return; }
  duck = 0.6; applyVolumes();
  clearTimeout(speakT);
  speakT = setTimeout(next, (dur + 0.08) * 1000);
}
/* The lines no recording has: the device's own voice, deepened — and only a voice that runs on the device.
   synth() and primeVoice() are RouteCast's (routecast/static/js/guide.js synth and prime): iOS will not let
   a page speak until it has spoken once inside a gesture, so the first gesture — the one that starts the
   audio — says nothing, silently, and the voice is ready by the first kill. Asking for the voices there
   also wakes the browsers that deliver them late. */
function synth() {
  const s = typeof speechSynthesis !== "undefined" ? speechSynthesis : null;
  return s && typeof SpeechSynthesisUtterance === "function" ? s : null;
}
function primeVoice() {
  const sp = synth();
  if (!sp) return;
  try { sp.getVoices(); const u = new SpeechSynthesisUtterance(" "); u.volume = 0; sp.speak(u); } catch (e) { /* no voice */ }
}
function say(text) {
  const sp = synth();
  const voice = sp && sp.getVoices().filter((v) => v.localService && /^en/i.test(v.lang))[0];
  if (!voice) return 0;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.voice = voice; u.lang = voice.lang; u.pitch = 0.55; u.rate = 0.92;
    u.volume = Math.min(1, save.settings.master * save.settings.voice);
    sp.cancel(); sp.speak(u);
    tone(70, 40, 0.5, "sine", 0.2, 0, { bus: voiceBus }); noise(0.4, 0.12, "lowpass", 2400, 200, 0, { bus: voiceBus, verb: true });
  } catch (e) { return 0; }
  return 0.25 + text.length * 0.065;
}
on("announce", announce);
on("quit", () => { if (deaf && ctx) { deaf.frequency.cancelScheduledValues(ctx.currentTime); deaf.frequency.setValueAtTime(20000, ctx.currentTime); } queue.length = 0; clearTimeout(speakT); speaking = false; duck = 1; applyVolumes(); try { const sp = synth(); if (sp) sp.cancel(); } catch (e) { /* none */ } });

/* ---------------------------------------------------------------
   Listening
   --------------------------------------------------------------- */
let stepAcc = new Map();
/* The reel: a hum on your own rope while it pulls, rising with how fast it is bringing you in. */
let reel = null;
function reelLoop() {
  const src = ctx.createBufferSource(); src.buffer = noiseB; src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 420; f.Q.value = 3;
  const g = ctx.createGain(); g.gain.value = 0;
  src.connect(f); f.connect(g); g.connect(sfxBus); src.start();
  reel = { f, g };
}
/* A wall ride's scrape: a loop of filtered noise under your own ride, louder and brighter the faster. */
let scrape = null;
function scrapeLoop() {
  const src = ctx.createBufferSource(); src.buffer = noiseW; src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 1400; f.Q.value = 0.9;
  const g = ctx.createGain(); g.gain.value = 0;
  src.connect(f); f.connect(g); g.connect(sfxBus); src.start();
  scrape = { f, g };
}
export function tickSteps(dt) {
  if (!ctx) return;
  if (scrape && S.me) {
    const b = S.me.body, on = S.me.alive && b.wallSlide, v = Math.hypot(b.vx, b.vz), t = ctx.currentTime;
    scrape.g.gain.setTargetAtTime(on ? Math.min(0.3, 0.08 + v * 0.015) : 0, t, on ? 0.04 : 0.1);
    scrape.f.frequency.setTargetAtTime(900 + v * 110, t, 0.08);
  }
  for (const a of S.actors) {
    if (!a.alive || !a.body.onGround || a.body.sliding || a.body.crouched) continue;
    const hs = Math.hypot(a.body.vx, a.body.vz);
    if (hs < 2.5) continue;
    const acc = (stepAcc.get(a.id) || 0) + hs * dt;
    if (acc > 2.1) { stepAcc.set(a.id, 0); play("step", 0, a === S.me ? null : a); } else stepAcc.set(a.id, acc);
  }
  if (reel && S.me) {
    const b = S.me.body, on = S.me.alive && b.hook === HOOK.ON;
    const v = on ? Math.hypot(b.vx, b.vy, b.vz) : 0, t = ctx.currentTime;
    reel.g.gain.setTargetAtTime(on ? Math.min(0.35, 0.08 + v * 0.012) : 0, t, 0.05);
    reel.f.frequency.setTargetAtTime(300 + v * 28, t, 0.08);
  }
}
const whoOf = (a) => (a === S.me ? null : a);
on("fired", (a, e) => play(e.gun, 0, whoOf(a)));
on("arms", (a, e) => {
  if (e.type === "fire") return;
  if (e.type === "swing") play("swing", 0, whoOf(a));
  else if (a !== S.me) return;
  else if (e.type === "reload") { if (ctx) { try { out = null; reloadSound(e.gun); } catch (x) { /* only a sound */ } } }
  else if (e.type === "swap") play(e.slot === 2 ? "draw" : "swap");
  else if (e.type === "throw") return;
  else play(e.type);
});
on("move", (a, ev) => {
  const who = whoOf(a);
  if (ev === "land") play("land", a.body.landSpeed, who);
  else if (SFX[ev]) play(ev, 0, who);
});
on("hit", (a, b, dmg, info) => {
  if (a !== S.me || b === S.me) return;
  const part = info && info.part;
  if (info && info.melee) play("cut", info.speedMul || 1);
  // a round on a shield crackles; one that breaks it shatters; flesh is the tick it always was
  if (info && info.sh) { play("shieldHit", info.sh); if (info.shBreak) play("shieldBreak", 0, b); }
  else play(part === "head" ? "head" : part === "nut" ? "nut" : "hit");
  if (part === "nut") play("yelp", 0, b);
});
on("hurt", (b, dmg, by, info) => {
  if (b !== S.me) return;
  if (info && info.shield > 0 && !info.shieldBroke) play("shieldHit", b.shieldLevel);
  else play("hurt");
  if (info && info.part === "nut") play("yelp");
});
on("shieldBreak", (b) => { if (b === S.me) play("shieldBreak"); });
on("shieldCharge", (a) => { if (a === S.me) play("shieldCharge"); });
on("shieldFull", (a) => { if (a === S.me) play("shieldFull"); });
on("shieldUp", (a, lvl) => { if (a === S.me) play("shieldUp", lvl); });
on("slash", (a, e) => { if (a === S.me && e.speed > 8) play(e.hit ? "slashHit" : "slashMiss", Math.min(1.4, 0.6 + e.speed / 25)); });
/* a blast: heard from where it was, and deafening near enough */
on("explosion", (e) => {
  if (!ctx) return;
  play("explode", e.r, { body: { x: e.x, y: e.y, z: e.z } });
  const d = Math.hypot(e.x - S.cam.x, e.y - S.cam.y, e.z - S.cam.z);
  if (d < e.r * 1.6) deafen(Math.min(0.75, 1.2 - d / (e.r * 1.6)), 1.2 + 1.5 * (1 - d / (e.r * 1.6)));
});
on("flashbang", (e) => { if (ctx) play("flashbang", 0, { body: { x: e.x, y: e.y, z: e.z } }); });
on("flashed", (e) => deafen(Math.min(1, 0.4 + e.k * 0.7), 2 + e.k * 5));
on("thrown", (th) => play("thrown", 0, whoOf(actorOf(th.owner))));
on("bounce", (th, v) => play("bounce", v, { body: { x: th.x, y: th.y, z: th.z } }));
on("mineSet", (th) => play("mineSet", 0, { body: { x: th.x, y: th.y, z: th.z } }));
on("mineArmed", (th) => play("mineArmed", 0, { body: { x: th.x, y: th.y, z: th.z } }));
on("gasCloud", (c) => play("gasOut", 0, { body: { x: c.x, y: c.y, z: c.z } }));
on("boom", (th) => { if (th.kind === "trip") play("trip", 0, { body: { x: th.x, y: th.y, z: th.z } }); });
on("buy", (ok) => play(ok ? "buy" : "deny"));
const actorOf = (id) => S.actors.find((x) => x.id === id) || null;
on("died", (b) => { if (b === S.me) play("death"); else play("grunt", 0, b); });
on("medals", (m) => play("kill", m.quick));
on("matchEnd", (m) => { if (S.me && (m.mode === "tdm" ? m.winner === S.me.team : m.winner === S.me.id)) play("win"); });
on("ui", () => play("ui"));
