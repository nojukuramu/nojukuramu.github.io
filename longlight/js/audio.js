/* audio.js — the half of the walk you hear.
 *
 * The shape is Last Flame's (lastflame/js/audio.js), which is Ballzooka's
 * and Bloomworks': one context made on the first tap, a master gain the
 * settings turn, rate limits, a synthesised stand-in for every sound until
 * its recording has loaded, everything that happens somewhere played from
 * there through an HRTF panner, and beds that are layers faded, never
 * switched. What is this game's:
 *
 *   - the wind is the sound of the place, in layers: a breath of it when it
 *     is calm, a steady push when it is up, the roar of a whiteout, a
 *     whistle in every gust, and from the side it is coming from. Inside a
 *     hut it is outside: muffled, and the hut's own sound of wind on sheet.
 *   - footsteps: dry snow crunching, quicker when you hurry, boards indoors;
 *   - the land talks: sea ice cracking somewhere out on the bay, the glacier
 *     groaning, the water at the ice edge; a beacon crackles where it burns;
 *   - music is rare (design: "long stretches with no music at all"): a few
 *     notes of piano now and then, more at a camp, at a beacon, at the end;
 *     generated, never the same twice, from an upright piano sampled by
 *     Simon Dalzell (Versilian's VSCO 2, CC0), and in the long night a cello
 *     section holding a low note under it;
 *   - the radio: static, a sweep through nothing, and once, an old tune
 *     coming through it — Shenandoah, which is older than anyone's copyright,
 *     played on the same piano and pushed through a radio's narrow band.
 *
 * Recordings are CC0, credited in assets/sounds/CREDITS.md and
 * assets/music/CREDITS.md. */

export const SOUNDS = ["breath1", "breath2", "breath3", "bubbles", "canister", "crack1", "crack2", "crack3", "crack4", "door_creak", "door_slam", "eat1", "eat2", "fire_big", "fire_small", "flag",
  "floor1", "floor2", "floor3", "generator", "ignite", "ignite_big", "lid", "lighter", "morse", "paper", "pebbles", "plane", "radio_static", "radio_sweep", "reel", "sea", "sigh", "splash",
  "step1", "step2", "step3", "step4", "step5", "step6", "step7", "step8", "stepq1", "stepq2", "stepq3", "stepq4", "stone1", "stone2", "stone3", "stove_on", "tin",
  "wind_calm", "wind_howl", "wind_inside", "wind_strong", "wind_whistle", "wrapper", "zip"];
export const PIANO = [45, 49, 53, 57, 61, 65, 69, 73, 77, 81, 85];
export const CELLO = [43, 50, 53, 57, 60];
export const SOUND_FILES = SOUNDS.map((s) => "assets/sounds/" + s + ".mp3");
export const MUSIC_FILES = PIANO.map((n) => "assets/music/piano_" + n + ".mp3").concat(CELLO.map((n) => "assets/music/cello_" + n + ".mp3"));

let ac = null, master, world, worldLP, ui, beds, bedsLP, bedPan, comp, room, roomOut, mus, musLP, radioBus;
let vol = 0.85, captions = null;
const buf = {};
const last = {};
const bed = {};
let loading = false, lastG = null;

export function unlock() {
  if (ac) { if (ac.state === "suspended") ac.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ac = new AC();
  comp = ac.createDynamicsCompressor();
  comp.threshold.value = -14; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.25;
  master = ac.createGain(); master.gain.value = vol;
  master.connect(comp); comp.connect(ac.destination);
  // the world: everything that happens somewhere. A blackout dulls it
  worldLP = ac.createBiquadFilter(); worldLP.type = "lowpass"; worldLP.frequency.value = 18000; worldLP.Q.value = 0.4;
  world = ac.createGain(); world.connect(worldLP); worldLP.connect(master);
  // a hut's small metal room: a send that only opens indoors
  room = ac.createGain(); room.gain.value = 0;
  const conv = ac.createConvolver(); conv.buffer = roomTail(0.9);
  roomOut = ac.createGain(); roomOut.gain.value = 0.8;
  world.connect(room); room.connect(conv); conv.connect(roomOut); roomOut.connect(worldLP);
  // the beds: the wind and the land, panned by where the wind comes from,
  // muffled through walls
  bedsLP = ac.createBiquadFilter(); bedsLP.type = "lowpass"; bedsLP.frequency.value = 16000;
  bedPan = ac.createStereoPanner ? ac.createStereoPanner() : null;
  beds = ac.createGain();
  if (bedPan) { beds.connect(bedPan); bedPan.connect(bedsLP); } else beds.connect(bedsLP);
  bedsLP.connect(worldLP);
  ui = ac.createGain(); ui.connect(master);
  // music: a long soft hall of its own, made here
  mus = ac.createGain(); mus.gain.value = 0.55;
  musLP = ac.createBiquadFilter(); musLP.type = "lowpass"; musLP.frequency.value = 9000;
  const hall = ac.createConvolver(); hall.buffer = roomTail(4.2, true);
  const hallG = ac.createGain(); hallG.gain.value = 0.55;
  mus.connect(musLP); musLP.connect(master); mus.connect(hall); hall.connect(hallG); hallG.connect(master);
  // a radio's voice: a narrow band, a little crunch
  radioBus = ac.createGain(); radioBus.gain.value = 0.9;
  const hp = ac.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 480;
  const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 2600;
  const sh = ac.createWaveShaper(); sh.curve = crunch();
  radioBus.connect(hp); hp.connect(lp); lp.connect(sh); sh.connect(world);
  loadAll();
}
export const ready = () => !!ac;
export const loadedCount = () => Object.keys(buf).length;
export function setVolume(v) { vol = v; if (master) master.gain.setTargetAtTime(v, ac.currentTime, 0.05); }
export function setCaptions(fn) { captions = fn; }
export function suspend(v) { if (!ac) return; if (v) ac.suspend(); else ac.resume(); }

function loadAll() {
  if (loading) return;
  loading = true;
  const get = (name, url) => fetch(url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject())).then((a) => new Promise((res, rej) => ac.decodeAudioData(a, res, rej))).then((b) => { buf[name] = b; if (bed[name] === null) startBed(name); }).catch(() => {});
  for (const n of SOUNDS) get(n, "assets/sounds/" + n + ".mp3");
  for (const n of PIANO) get("p" + n, "assets/music/piano_" + n + ".mp3");
  for (const n of CELLO) get("c" + n, "assets/music/cello_" + n + ".mp3");
}

/* A room's tail, made rather than recorded (Last Flame's, from Hacks'): noise
   under a decay that loses its top end as it goes. A hut is small, hard and
   bright; the music's hall is long and soft. */
function roomTail(secs, soft) {
  const n = Math.floor(ac.sampleRate * secs), b = ac.createBuffer(2, n, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / ac.sampleRate, k = Math.min(0.95, (soft ? 0.6 : 0.2) + t * (soft ? 0.4 : 1.2));
      lp = lp * k + (Math.random() * 2 - 1) * (1 - k);
      d[i] = lp * Math.exp(-t * (soft ? 1.4 : 6)) * Math.min(1, t * (soft ? 40 : 400));
    }
  }
  return b;
}
function crunch() {
  const c = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const x = i / 128 - 1; c[i] = Math.tanh(x * 2.2) * 0.8; }
  return c;
}

/* ---------- synthesised stand-ins ---------- */
let noiseBuf = null;
function noise() {
  if (noiseBuf) return noiseBuf;
  noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}
function synth(name, dest, when, rate) {
  const t = when || ac.currentTime;
  const g = ac.createGain(); g.connect(dest);
  const env = (a, peak, d) => { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); };
  const nz = (cut, type) => { const s = ac.createBufferSource(); s.buffer = noise(); const f = ac.createBiquadFilter(); f.type = type || "lowpass"; f.frequency.value = cut; s.connect(f); f.connect(g); s.start(t, Math.random()); return s; };
  const osc = (type, f0, f1, d) => { const o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0 * (rate || 1), t); if (f1) o.frequency.exponentialRampToValueAtTime(f1 * (rate || 1), t + d); o.connect(g); o.start(t); o.stop(t + d + 0.1); return o; };
  const base = name.replace(/\d+$/, "");
  switch (base) {
    case "step": case "stepq": { env(0.004, 0.35, 0.14); const s = nz(1800, "bandpass"); s.stop(t + 0.2); break; }
    case "floor": { env(0.003, 0.4, 0.1); const s = nz(400); s.stop(t + 0.15); break; }
    case "crack": { env(0.003, 0.8, 1.2); const s = nz(1500); s.stop(t + 1.4); break; }
    case "stone": case "tin": case "lid": case "canister": { env(0.002, 0.5, 0.15); const s = nz(2600, "bandpass"); s.stop(t + 0.2); break; }
    case "ignite": case "ignite_big": case "lighter": case "stove_on": { env(0.02, 0.5, 0.6); const s = nz(3000, "bandpass"); s.stop(t + 0.7); break; }
    case "door_slam": { env(0.002, 0.8, 0.3); const s = nz(900); s.stop(t + 0.35); break; }
    case "door_creak": { env(0.1, 0.25, 0.9); osc("sawtooth", 320, 210, 1); break; }
    case "splash": { env(0.01, 0.5, 0.5); const s = nz(2000); s.stop(t + 0.6); break; }
    default: { env(0.005, 0.2, 0.12); const s = nz(1200); s.stop(t + 0.15); }
  }
}

/* ---------- playing ---------- */

/** Play a sound. o: { x, y, z (positional), vol, rate, bus: "world"|"ui"|"radio", gap, delay, lp, ref, rolloff, max } */
export function play(name, o) {
  if (!ac) return null;
  o = o || {};
  if (o.gap && last[name] && ac.currentTime - last[name] < o.gap) return null;
  last[name] = ac.currentTime;
  const when = ac.currentTime + (o.delay || 0);
  const g = ac.createGain(); g.gain.value = o.vol === undefined ? 1 : o.vol;
  const dest = o.bus === "ui" ? ui : o.bus === "radio" ? radioBus : o.bus === "music" ? mus : world;
  if (o.x !== undefined) {
    const p = ac.createPanner();
    p.panningModel = "HRTF"; p.distanceModel = "inverse";
    p.refDistance = o.ref || 1.5; p.rolloffFactor = o.rolloff || 1; p.maxDistance = o.max || 2000;
    setPos(p, o.x, o.y === undefined ? 1.2 : o.y, o.z);
    g.connect(p); p.connect(dest);
  } else g.connect(dest);
  const b = buf[name];
  if (b) {
    const s = ac.createBufferSource();
    s.buffer = b;
    s.playbackRate.value = o.rate || 1;
    if (o.lp) { const f = ac.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = o.lp; s.connect(f); f.connect(g); } else s.connect(g);
    s.start(when, o.offset || 0);
    return s;
  }
  if (!/^[pc]\d/.test(name)) synth(name, g, when, o.rate);
  return null;
}
function setPos(p, x, y, z) {
  if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; } else p.setPosition(x, y, z);
}
const pickOf = (base, n) => base + (1 + Math.floor(Math.random() * n));

/* ---------- beds: loops, faded, never switched ---------- */
function startBed(name) {
  if (!ac) return;
  if (!buf[name]) { bed[name] = null; return; }
  const s = ac.createBufferSource();
  s.buffer = buf[name]; s.loop = true;
  s.loopStart = 0.06; s.loopEnd = buf[name].duration - 0.06;
  const g = ac.createGain(); g.gain.value = 0;
  s.connect(g); g.connect(beds);
  s.start(ac.currentTime, Math.random() * (buf[name].duration - 1));
  bed[name] = { s, g };
}
function bedGain(name, v, tc) {
  if (!ac) return;
  if (bed[name] === undefined) startBed(name);
  const b = bed[name];
  if (!b) return;
  b.g.gain.setTargetAtTime(v, ac.currentTime, tc || 0.8);
}

/* A loop that sits somewhere: a beacon's fire. */
const spots = new Map();
function spot(key, name, x, y, z, v) {
  if (!ac || !buf[name]) return;
  let s = spots.get(key);
  if (!s) {
    const src = ac.createBufferSource(); src.buffer = buf[name]; src.loop = true; src.loopStart = 0.06; src.loopEnd = buf[name].duration - 0.06;
    const g = ac.createGain(); g.gain.value = 0;
    const p = ac.createPanner(); p.panningModel = "HRTF"; p.distanceModel = "inverse"; p.refDistance = 3; p.rolloffFactor = 1.2; p.maxDistance = 400;
    setPos(p, x, y, z);
    src.connect(g); g.connect(p); p.connect(world);
    src.start(ac.currentTime, Math.random() * (buf[name].duration - 1));
    s = { src, g, p, seen: 0 };
    spots.set(key, s);
  }
  s.g.gain.setTargetAtTime(v, ac.currentTime, 0.5);
  s.seen = ac.currentTime;
}
function sweepSpots() {
  for (const [k, s] of spots) if (ac.currentTime - s.seen > 2) { s.g.gain.setTargetAtTime(0, ac.currentTime, 0.3); if (ac.currentTime - s.seen > 4) { try { s.src.stop(); } catch (e) { /* stopped */ } spots.delete(k); } }
}

/* ---------- music: a few notes, now and then ---------- */

/* D minor's notes, with the ninth: E. The piano plays phrases of four to
   nine of them, slowly, with the pedal down; lower as the journey goes on. */
const MODE = [62, 64, 65, 69, 72, 74, 76, 77, 81, 84];
let nextPhrase = 140, phraseOn = false, droneOn = 0, droneNext = 0;
function note(n, when, v, bus) {
  // the nearest sample, and the playback rate that makes it this note
  let s = PIANO[0];
  for (const k of PIANO) if (Math.abs(k - n) < Math.abs(s - n)) s = k;
  play("p" + s, { rate: Math.pow(2, (n - s) / 12), vol: v, delay: when, bus: bus || "music" });
}
/** A phrase: `mood` 0 (quiet, high) .. 1 (low, the long night). */
export function phrase(mood, big) {
  if (!ac) return;
  phraseOn = true;
  const n = big ? 9 + Math.floor(Math.random() * 4) : 4 + Math.floor(Math.random() * 5);
  const shift = mood > 0.6 ? -12 : mood > 0.3 ? -5 : 0;
  let i = 3 + Math.floor(Math.random() * 4), t = 0.2;
  for (let k = 0; k < n; k++) {
    i = Math.max(0, Math.min(MODE.length - 1, i + (Math.random() < 0.5 ? -1 : 1) * (1 + Math.floor(Math.random() * 2))));
    const nn = MODE[i] + shift;
    note(nn, t, 0.32 + Math.random() * 0.12);
    // now and then a low fifth under it
    if (Math.random() < 0.3) note(nn - 12 - (Math.random() < 0.5 ? 0 : 5), t + 0.02, 0.18);
    t += 1.1 + Math.random() * 1.6 + (k === n - 2 ? 1.2 : 0);
  }
  setTimeout(() => { phraseOn = false; }, t * 1000);
}
/* The cello under the long night: sustained notes laid over each other, so
   it holds as long as it is wanted. */
function drone(dt) {
  if (droneOn <= 0.01) return;
  droneNext -= dt;
  if (droneNext > 0) return;
  droneNext = 5.5;
  for (const n of [50, 57]) {
    const src = ac.createBufferSource();
    const b = buf["c" + n];
    if (!b) continue;
    src.buffer = b;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.16 * droneOn, ac.currentTime + 2.5);
    g.gain.setTargetAtTime(0.0001, ac.currentTime + 6, 1.2);
    src.connect(g); g.connect(mus);
    src.start(ac.currentTime, 0.6);
    src.stop(ac.currentTime + 9);
  }
}

/* Shenandoah, first two lines: an old song through an old radio. */
const SHENANDOAH = [[62, 1], [67, 0.5], [67, 0.5], [67, 1.5], [69, 0.5], [71, 0.5], [72, 0.5], [76, 2], [74, 1.5], [71, 0.5], [72, 0.5], [71, 0.5], [69, 0.5], [67, 1], [69, 0.5], [71, 2.5],
  [67, 0.5], [71, 0.5], [74, 1], [74, 0.5], [74, 0.5], [76, 1.5], [74, 0.5], [71, 0.5], [74, 1.5], [71, 0.5], [69, 0.5], [67, 1], [69, 0.5], [67, 3]];
function radioSong() {
  let t = 1.8;
  for (const [n, d] of SHENANDOAH) { note(n - 2, t, 0.8, "radio"); t += d * 0.62; }
  play("radio_static", { bus: "radio", vol: 0.4 });
}

/* ---------- events ---------- */

export function feed(events, g) {
  if (!ac) return;
  lastG = g;
  const p = g.p;
  for (const e of events) {
    switch (e.type) {
      case "step":
        if (e.floor) play(pickOf("floor", 3), { vol: 0.35, rate: 0.95 + Math.random() * 0.1 });
        else if (e.brisk) play(pickOf("stepq", 4), { vol: 0.42, rate: (e.ice ? 1.15 : 1) * (0.92 + Math.random() * 0.14) });
        else play(pickOf("step", 8), { vol: e.rock ? 0.25 : 0.34, rate: (e.ice ? 1.12 : e.rock ? 1.3 : 1) * (0.92 + Math.random() * 0.14) });
        break;
      case "take":
        if (e.what === "fuel") play(e.drum ? "lid" : "canister", { vol: 0.6 });
        else if (e.what === "food") play("tin", { vol: 0.6 });
        else play("zip", { vol: 0.5 });
        break;
      case "read": play("paper", { vol: 0.6, bus: "ui" }); break;
      case "door": { const h = g.P.huts[e.hut]; play(e.open ? "door_creak" : "door_slam", { x: h.x, z: h.z, y: h.floor + 1, vol: e.open ? 0.7 : 0.6, rate: 0.9 + Math.random() * 0.2 }); break; }
      case "beaconLit": play("ignite_big", { x: e.x, z: e.z, y: 3, vol: 1.2, ref: 4 }); if (g.stats.beacons === 1 || e.big) setTimeout(() => phrase(g.season, true), 4000); else if (Math.random() < 0.6) setTimeout(() => phrase(g.season), 5000); break;
      case "stoveLit": play("stove_on", { vol: 0.6 }); play("lighter", { vol: 0.5, delay: 0.3 }); break;
      case "lantern": play("lighter", { vol: e.on ? 0.5 : 0.3, rate: e.on ? 1 : 0.8 }); if (e.on) play("ignite", { vol: 0.35, delay: 0.35 }); break;
      case "postLit": play("lighter", { vol: 0.5 }); play("ignite", { vol: 0.5, delay: 0.35 }); break;
      case "stoneUp": play(pickOf("stone", 3), { vol: 0.6 }); play("pebbles", { vol: 0.3, delay: 0.1 }); break;
      case "stoneDown": play(pickOf("stone", 3), { vol: 0.8, rate: 0.85 }); break;
      case "cairnDone": setTimeout(() => phrase(g.season), 1500); break;
      case "mastUp": play("canister", { vol: 0.6, rate: 0.6 }); play("lid", { vol: 0.5, delay: 1.6, rate: 0.7 }); break;
      case "radioMended": play("radio_sweep", { bus: "radio", vol: 0.8 }); break;
      case "radio":
        play("radio_sweep", { bus: "radio", vol: 0.7 });
        play("radio_static", { bus: "radio", vol: 0.6, delay: 1.2 });
        if (e.rare === "song") radioSong();
        if (e.rare === "morse") { play("morse", { bus: "radio", vol: 0.5, delay: 3 }); play("morse", { bus: "radio", vol: 0.35, delay: 7.5 }); }
        break;
      case "generator": play("generator", { vol: 0.8 }); break;
      case "fishStart": play("splash", { vol: 0.3, rate: 1.3 }); break;
      case "fishBite": play("splash", { vol: 0.7 }); play("reel", { vol: 0.5, delay: 0.1 }); break;
      case "fishCaught": play("splash", { vol: 0.9, rate: 0.9 }); break;
      case "eat": play(e.kind === "rations" ? "wrapper" : "tin", { vol: 0.5 }); play(pickOf("eat", 2), { vol: 0.6, delay: 0.6 }); break;
      case "crack": play(pickOf("crack", 4), { x: e.x, z: e.z, y: 0, vol: e.big ? 3 : 1.6, rate: e.big ? 0.45 : 0.7 + Math.random() * 0.3, ref: 25, rolloff: 0.6, lp: e.big ? 900 : 2400 }); caption(e.big ? "the ice booms, far off" : "ice cracking, far off", e.x, e.z, true); break;
      case "gust": play("wind_whistle", { vol: 0.25 * e.k, gap: 4, offset: Math.random() * 20 }); break;
      case "whiteout": caption("the wind rises; the world goes white"); break;
      case "blackout": play("sigh", { vol: 0.6, rate: 0.85 }); worldLP.frequency.setTargetAtTime(400, ac.currentTime, 1.5); break;
      case "wake": worldLP.frequency.setTargetAtTime(18000, ac.currentTime, 2); play(pickOf("breath", 3), { vol: 0.5 }); break;
      case "rest": play("sigh", { vol: 0.4 }); break;
      case "arrive": if (e.kind !== "base") setTimeout(() => phrase(g.season), 2500); break;
      case "rare":
        if (e.kind === "engine") {
          // far off, and from one side: a drone that might be an engine, or the wind
          const x = p.x + Math.cos(e.az) * 2000, z = p.z + Math.sin(e.az) * 2000;
          play("plane", { x, z, y: 300, vol: 6, lp: 700, ref: 400, rolloff: 1, max: 5000 });
          caption("something, far off — an engine? the wind?", x, z, true);
        }
        if (e.kind === "light") setTimeout(() => phrase(Math.min(1, g.season + 0.3)), 3000);
        break;
      case "endingStart": droneOn = 1; setTimeout(() => phrase(1, true), 6000); break;
      case "answer": setTimeout(() => phrase(0.2, true), 1500); break;
    }
  }
}

/* ---------- every frame ---------- */

let musicT = 0;
export function update(g, dt, cam) {
  if (!ac || !g) return;
  const l = ac.listener, p = g.p;
  // the listener: where the eye is, facing where it faces
  const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
  if (l.positionX) { l.positionX.value = cam.x; l.positionY.value = cam.y; l.positionZ.value = cam.z; l.forwardX.value = fx; l.forwardY.value = 0; l.forwardZ.value = fz; l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0; }
  else { l.setPosition(cam.x, cam.y, cam.z); l.setOrientation(fx, 0, fz, 0, 1, 0); }
  const w = g.weather, inside = p.inside >= 0, out = g.state === "out";
  const k = w.wind, wo = w.whiteout;
  // the wind's layers
  bedGain("wind_calm", (inside ? 0.15 : 0.5) * (1 - k * 0.6) + 0.05);
  bedGain("wind_strong", (inside ? 0.25 : 0.85) * Math.max(0, k - 0.3) * 1.3);
  bedGain("wind_howl", (inside ? 0.3 : 1) * wo * 0.9);
  bedGain("wind_inside", inside ? 0.35 + k * 0.6 : 0);
  bedsLP.frequency.setTargetAtTime(inside ? (g.doors[p.inside] > 0.5 ? 1800 : 600) : out ? 500 : 16000, ac.currentTime, 0.3);
  room.gain.setTargetAtTime(inside ? 0.35 : 0, ac.currentTime, 0.2);
  // it comes from upwind: louder in the ear that faces it
  if (bedPan) { const a = Math.atan2(-g.W.wind.x, -g.W.wind.z) - p.yaw; bedPan.pan.setTargetAtTime(inside ? 0 : Math.max(-0.6, Math.min(0.6, -Math.sin(a) * 0.6)), ac.currentTime, 0.4); }
  // flags and masts snapping near you; the sea at the ice edge
  let flagK = 0;
  for (const f of g.P.flags) { const d = Math.hypot(f.x - p.x, f.z - p.z); if (d < 14) flagK = Math.max(flagK, 1 - d / 14); }
  bedGain("flag", inside ? 0 : flagK * (0.15 + k * 0.5));
  let sea = 0;
  for (const h of g.P.holes) { const d = Math.hypot(h.x - p.x, h.z - p.z); if (d < 8) sea = Math.max(sea, 1 - d / 8); }
  bedGain("bubbles", inside ? 0 : sea * 0.4 + (g.fishing ? 0.3 : 0));
  bedGain("sea", inside ? 0 : g.near.seaIce > 0.5 ? 0.08 + k * 0.1 : 0);
  // fires where they burn, and the stove in the hut you are in
  for (let i = 0; i < g.W.beacons.length; i++) {
    if (!g.lit[i]) continue;
    const b = g.W.beacons[i];
    if (Math.hypot(b.x - p.x, b.z - p.z) < 120) spot("b" + i, "fire_big", b.x, (b.y || 0) + 3, b.z, b.big ? 1.6 : 1);
  }
  bedGain("fire_small", inside && g.stoves[p.inside] > 0 ? 0.35 : 0);
  sweepSpots();
  // music: rarely, on its own
  musicT += dt;
  if (!phraseOn && musicT > nextPhrase && !out) { musicT = 0; nextPhrase = 200 + Math.random() * 260; if (Math.random() < 0.7) phrase(g.season); }
  droneOn = g.season > 0.85 || g.ending ? Math.min(1, droneOn + dt / 20) : Math.max(0, droneOn - dt / 20);
  drone(dt);
  // a breath on cold hands, when you stop out in the cold
  if (!inside && !p.moving && p.warmth < 0.4 && g.state === "play") play(pickOf("breath", 3), { vol: 0.35, gap: 14 });
}

/** The title: wind, and now and then a note. */
export function title(dt) {
  if (!ac) return;
  bedGain("wind_calm", 0.45); bedGain("wind_strong", 0.12); bedGain("wind_howl", 0); bedGain("wind_inside", 0); bedGain("flag", 0); bedGain("bubbles", 0); bedGain("sea", 0); bedGain("fire_small", 0);
  bedsLP.frequency.setTargetAtTime(9000, ac.currentTime, 0.5);
  musicT += dt || 0;
  if (!phraseOn && musicT > 18) { musicT = 0; phrase(0.4); }
}
export function quietAll() { if (!ac) return; for (const n in bed) if (bed[n]) bed[n].g.gain.setTargetAtTime(0, ac.currentTime, 0.3); droneOn = 0; }

function caption(text, x, z, quiet) {
  if (!captions || !lastG) return;
  let dir = null;
  if (x !== undefined) {
    const p = lastG.p, a = Math.atan2(x - p.x, z - p.z) - p.yaw, s = Math.sin(a), c = Math.cos(a);
    dir = c < -0.5 ? "behind" : s > 0.4 ? "left" : s < -0.4 ? "right" : "ahead";
  }
  captions(text, dir, quiet);
}
