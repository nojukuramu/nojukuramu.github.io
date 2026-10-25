/* audio.js — the half of the game you play with your ears.
 *
 * The shape is Ballzooka's (ballzooka/js/audio.js, which is Bloomworks'): one
 * context made on the first tap, a master gain the settings turn, rate
 * limits, and a synthesised version of every sound that plays until the
 * recording has loaded — so the game is never silent and never waits. What
 * is new is the house:
 *
 *   - everything that happens somewhere is played from there, through an HRTF
 *     panner, and muffled when a wall stands between it and you. The hunter's
 *     footsteps are honest: every one it takes, you can hear, from where it is.
 *   - the beds are layers, faded and never switched: rain on the roof, the
 *     storm round the house, frogs in the field outside, a drone that rises
 *     with the director's stress, a heartbeat whose rate is your fear.
 *   - before the peak, the house goes quiet (the research's "silence at the
 *     right moments"). Then it does not.
 *   - the tiktik: loud when it is far, faint when it is near.
 *   - the house has a sound of its own: everything that happens in it rings
 *     in a tail of wooden room (a reverb made here, not loaded), more in the
 *     big rooms, almost none from inside a closet.
 *   - the storm is at the windows: rain on the capiz and the wind whistling
 *     through the cracks come from the nearest window, water drips where the
 *     sills leak, and lightning close by cracks before it rolls — from the
 *     side the flash came from.
 *   - the end has a score: drums, low strings worrying at a semitone, and a
 *     pitch that climbs forever, all made here and all faster and louder the
 *     nearer the dead are. A chase before that gets the drums alone.
 *
 * Recordings are CC0 or public domain, credited in assets/sounds/CREDITS.md. */

export const SOUNDS = ["break", "breathe", "chime", "clank", "clank2", "click", "closet_close", "closet_open", "crack1", "crack2", "creak1", "creak2", "creak3", "creak4", "creak5", "creak6",
  "door_close", "door_creak_long", "door_open", "door_slam", "drag", "drip1", "drip2", "drip3", "drone1", "drone2", "exhale", "fire", "frogs", "gasp", "growl1", "growl2", "growl3", "growl4", "growl5", "growl6",
  "heart", "howl", "ignite", "latch", "pant", "paper", "rain", "rainglass", "shriek", "sneak1", "sneak2", "sneak3", "sneak4", "step1", "step2", "step3", "step4", "step5", "step6",
  "sting1", "sting2", "sting3", "thunder1", "thunder2", "thunder3", "tick", "tom1", "tom2", "tuko", "wail1", "wail2", "wail3", "whisper1", "whisper2", "whisper3", "whisper4", "whisper5", "whistle", "wind"];
export const SOUND_FILES = SOUNDS.map((s) => "assets/sounds/" + s + ".mp3");

let ac = null, master, world, worldLP, ui, beds, comp, verbSend, verbOut, musBus;
let vol = 0.85, captions = null, occludes = null;
const buf = {};
const last = {};
let loading = false;
const bed = {};
let heartNext = 0, ambT = { creak: 12, howl: 50, tuko: 30, whisper: 8, door: 3 }, lastG = null;

export function unlock() {
  if (ac) { if (ac.state === "suspended") ac.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ac = new AC();
  comp = ac.createDynamicsCompressor();
  comp.threshold.value = -14; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.25;
  master = ac.createGain(); master.gain.value = vol;
  master.connect(comp); comp.connect(ac.destination);
  // the world goes through a low-pass: a closet, a held breath, the dark
  worldLP = ac.createBiquadFilter(); worldLP.type = "lowpass"; worldLP.frequency.value = 18000; worldLP.Q.value = 0.4;
  world = ac.createGain(); world.connect(worldLP); worldLP.connect(master);
  // the room: a send from everything in the world into a made tail
  verbSend = ac.createGain(); verbSend.gain.value = 0.25;
  const conv = ac.createConvolver(); conv.buffer = roomTail(1.6);
  verbOut = ac.createGain(); verbOut.gain.value = 0.9;
  world.connect(verbSend); verbSend.connect(conv); conv.connect(verbOut); verbOut.connect(worldLP);
  beds = ac.createGain(); beds.connect(worldLP);
  ui = ac.createGain(); ui.connect(master);
  // the score skips the muffling: fear is not something a closet keeps out
  musBus = ac.createGain(); musBus.gain.value = 0; musBus.connect(master);
  loadAll();
}
export const ready = () => !!ac;
export const loadedCount = () => Object.keys(buf).length;
export function setVolume(v) { vol = v; if (master) master.gain.setTargetAtTime(v, ac.currentTime, 0.05); }
export function setCaptions(fn) { captions = fn; }
export function setOccluder(fn) { occludes = fn; }
export function suspend(v) { if (!ac) return; if (v) ac.suspend(); else ac.resume(); }

function loadAll() {
  if (loading) return;
  loading = true;
  for (const n of SOUNDS) {
    fetch("assets/sounds/" + n + ".mp3").then((r) => (r.ok ? r.arrayBuffer() : Promise.reject())).then((a) => new Promise((res, rej) => ac.decodeAudioData(a, res, rej))).then((b) => { buf[n] = b; if (bed[n] === null) startBed(n); }).catch(() => {});
  }
}

/* A wooden room's tail, made rather than recorded. Hacks' impulse
   (hacks/js/audio.js: noise in two channels under a decay), with a handful
   of early reflections off near walls added and a tail that loses its top
   end as it goes, as wood and plaster and furniture swallow it. */
function roomTail(secs) {
  const n = Math.floor(ac.sampleRate * secs), b = ac.createBuffer(2, n, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / ac.sampleRate, k = Math.min(0.92, 0.35 + t * 1.6);
      lp = lp * k + (Math.random() * 2 - 1) * (1 - k);
      d[i] = lp * Math.exp(-t * 4.2) * Math.min(1, t * 300);
    }
    for (const [t, a] of [[0.011, 0.5], [0.019, 0.35], [0.027 + ch * 0.004, 0.3], [0.041, 0.22], [0.058 - ch * 0.006, 0.18]]) d[Math.floor(t * ac.sampleRate)] += a;
  }
  return b;
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
    case "step": case "sneak": { env(0.004, base === "step" ? 0.5 : 0.2, 0.12); const s = nz(500); s.stop(t + 0.2); break; }
    case "creak": { env(0.05, 0.25, 0.6); osc("sawtooth", 180 + Math.random() * 60, 120, 0.7); break; }
    case "heart": { env(0.01, 0.9, 0.18); osc("sine", 62, 40, 0.25); break; }
    case "thunder": { env(0.05, 0.9, 4); const s = nz(220); s.stop(t + 4.5); break; }
    case "growl": { env(0.1, 0.5, 1); osc("sawtooth", 70, 55, 1.1); break; }
    case "shriek": { env(0.02, 0.6, 1.2); osc("sawtooth", 900, 1400, 1.2); break; }
    case "door_slam": case "clank": case "clank2": case "break": { env(0.002, 0.8, 0.25); const s = nz(1800); s.stop(t + 0.3); break; }
    case "door_open": case "door_creak_long": { env(0.1, 0.25, 0.9); osc("sawtooth", 300, 220, 1); break; }
    case "ignite": { env(0.02, 0.5, 0.5); const s = nz(3000, "bandpass"); s.stop(t + 0.6); break; }
    case "sting": { env(0.01, 0.7, 2); osc("sawtooth", 55, 40, 2.2); break; }
    case "wail": { env(0.6, 0.35, 2.5); const o = osc("sine", 330, 260, 3); const v = ac.createOscillator(), vg = ac.createGain(); v.frequency.value = 5; vg.gain.value = 9; v.connect(vg); vg.connect(o.frequency); v.start(t); v.stop(t + 3.2); break; }
    case "drip": { env(0.002, 0.3, 0.08); osc("sine", 1400, 700, 0.1); break; }
    case "tom": { env(0.003, 0.9, 0.5); osc("sine", 90, 42, 0.55); break; }
    case "crack": { env(0.003, 1, 1.8); const s = nz(2600); s.stop(t + 2); break; }
    default: { env(0.005, 0.25, 0.1); const s = nz(1200); s.stop(t + 0.15); }
  }
}

/* ---------- playing ---------- */

/**
 * Play a sound. o: { x, z, y (positional if given), vol, rate, bus: "world"|"ui",
 * gap (seconds this name may not repeat within), when, occluded }
 */
export function play(name, o) {
  if (!ac) return null;
  o = o || {};
  if (o.gap && last[name] && ac.currentTime - last[name] < o.gap) return null;
  last[name] = ac.currentTime;
  const when = ac.currentTime + (o.delay || 0);
  const g = ac.createGain(); g.gain.value = o.vol === undefined ? 1 : o.vol;
  let out = g;
  const dest = o.bus === "ui" ? ui : world;
  if (o.x !== undefined) {
    const p = ac.createPanner();
    p.panningModel = "HRTF"; p.distanceModel = "inverse";
    p.refDistance = o.ref || 1.4; p.rolloffFactor = o.rolloff || 1.1; p.maxDistance = 40;
    setPos(p, o.x, o.y === undefined ? 1.2 : o.y, o.z);
    // through a wall: duller and quieter
    const occ = o.occluded !== undefined ? o.occluded : occludes ? occludes(o.x, o.z) : false;
    if (occ) {
      const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 700;
      g.connect(lp); lp.connect(p); g.gain.value *= 0.7;
    } else g.connect(p);
    p.connect(dest);
    out = p;
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
  synth(name, g, when, o.rate);
  void out;
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
  // skip the encoder's padding at either end so the seam is in the sound
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
  b.g.gain.setTargetAtTime(v, ac.currentTime, tc || 0.6);
}

/* ---------- the tiktik ---------- */
/* Clicks of the tongue, as the stories tell it: the further away it is, the
   louder the call. Played as a dry click train, panned by where it really is. */
function tiktik(x, z, d) {
  const t0 = ac.currentTime;
  const loud = Math.min(0.9, 0.12 + d / 16);
  const p = ac.createStereoPanner ? ac.createStereoPanner() : null;
  const g = ac.createGain(); g.gain.value = loud;
  if (p && lastG) {
    const pl = lastG.player, ang = Math.atan2(x - pl.x, z - pl.z) - pl.yaw;
    p.pan.value = Math.max(-1, Math.min(1, -Math.sin(ang)));
    g.connect(p); p.connect(beds);
  } else g.connect(beds);
  const n = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n * 2; i++) {
    const t = t0 + i * 0.16 + (i % 2) * 0.05;
    const o = ac.createOscillator(), e = ac.createGain(), f = ac.createBiquadFilter();
    o.type = "square"; o.frequency.setValueAtTime(i % 2 ? 1900 : 2400, t); o.frequency.exponentialRampToValueAtTime(700, t + 0.03);
    f.type = "bandpass"; f.frequency.value = 2200; f.Q.value = 2;
    e.gain.setValueAtTime(0.0001, t); e.gain.exponentialRampToValueAtTime(0.5, t + 0.003); e.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(f); f.connect(e); e.connect(g); o.start(t); o.stop(t + 0.07);
  }
}

/* ---------- events ---------- */

const CERAMIC = new Set(["palayok", "vase", "jug", "pot_clay"]);
export function feed(events, g) {
  if (!ac) return;
  lastG = g;
  const p = g.player;
  for (const e of events) {
    switch (e.type) {
      case "step":
        if (e.who === "player") {
          if (e.kind === "crouch") play(pickOf("sneak", 4), { vol: 0.16, rate: 0.95 + Math.random() * 0.1 });
          else play(pickOf("step", 6), { vol: e.kind === "run" ? 0.5 : 0.3, rate: (e.tiles ? 1.18 : 1) * (0.94 + Math.random() * 0.12), lp: e.tiles ? undefined : 3500 });
        } else {
          play(pickOf("step", 6), { x: e.x, z: e.z, y: 0.2, vol: e.run ? 1.6 : 1.25, rate: 0.66 + Math.random() * 0.08, ref: 2.2, rolloff: 0.9, lp: 2200 });
          if (Math.random() < 0.18) play(pickOf("creak", 6), { x: e.x, z: e.z, y: 0.1, vol: 0.5, rate: 0.8, gap: 1.5 });
          caption("footsteps", e.x, e.z);
        }
        break;
      case "creak": play(pickOf("creak", 6), { x: e.x, z: e.z, y: 0.05, vol: e.soft ? 0.5 : 1, rate: 0.9 + Math.random() * 0.2 }); caption("floorboard creaks", e.x, e.z, true); break;
      case "kick": {
        const k = g.L.props[e.prop] && g.L.props[e.prop].kind;
        play(CERAMIC.has(k) ? "break" : Math.random() < 0.5 ? "clank" : "clank2", { x: e.x, z: e.z, y: 0.1, vol: 0.9, rate: 0.9 + Math.random() * 0.2 });
        caption("something knocked over", e.x, e.z, true);
        break;
      }
      case "door": {
        const d = g.L.doors[e.id];
        if (e.slam) { play("door_slam", { x: d.x, z: d.z, vol: 1.2 }); caption("a door slams open", d.x, d.z); }
        else if (e.open) play("door_open", { x: d.x, z: d.z, vol: 0.8, rate: 0.9 + Math.random() * 0.2 });
        else play("door_close", { x: d.x, z: d.z, vol: 0.8 });
        if (e.who === "hunter" && !e.slam) caption("a door creaks open", d.x, d.z);
        break;
      }
      case "doorTry": { const d = g.L.doors[e.id]; play("latch", { x: d.x, z: d.z, vol: e.hard ? 1 : 0.6, rate: e.hard ? 1.2 : 0.9 }); break; }
      case "closetIn": play("closet_open", { vol: 0.5 }); play("closet_close", { vol: 0.5, delay: 0.45 }); break;
      case "closetOut": play("closet_open", { vol: 0.45 }); break;
      case "closetRattle": {
        const c = g.L.closets[e.id];
        for (let i = 0; i < 5; i++) play("latch", { x: c.x, z: c.z, vol: 1, rate: 0.8 + Math.random() * 0.4, delay: i * 0.32 + Math.random() * 0.1 });
        play(pickOf("growl", 6), { x: c.x, z: c.z, y: 1.6, vol: 1, delay: 0.3 });
        caption("the closet doors rattle", c.x, c.z);
        break;
      }
      case "spotted": play(pickOf("growl", 6), { x: g.hunter.x, z: g.hunter.z, y: 1.6, vol: 1.1, rate: 1.1 }); play("sting3", { vol: 0.35, rate: 0.8 }); break;
      case "closetRip": { const c = g.L.closets[e.id]; play("door_slam", { x: c.x, z: c.z, vol: 1.4 }); break; }
      case "lightStart": play("click", { vol: 0.25, bus: "ui" }); break;
      case "lampLit": { const l = g.L.lamps[e.id]; play("ignite", { x: l.x, z: l.z, y: l.y + 0.3, vol: 0.9 }); if (e.n < 5) play("sting3", { vol: 0.12, rate: 1.4, delay: 0.4 }); break; }
      case "borrow": { const l = g.L.lamps[e.id]; play("ignite", { x: l.x, z: l.z, y: l.y + 0.3, vol: 0.6 }); break; }
      case "lantern": play("click", { vol: 0.5, bus: "ui", rate: e.on ? 1 : 0.85 }); break;
      case "lanternDie": play("click", { vol: 0.4, bus: "ui", rate: 0.7 }); synth("ignite", ui, ac.currentTime, 0.5); break;
      case "tin": play("clank", { vol: 0.3, rate: 1.4, bus: "ui" }); break;
      case "note": play("paper", { vol: 0.7, bus: "ui" }); break;
      case "heard": play(pickOf("growl", 6), { x: g.hunter.x, z: g.hunter.z, y: 1.7, vol: 0.55, rate: 1.15, gap: 3 }); break;
      case "notice":
        play(pickOf("growl", 6), { x: g.hunter.x, z: g.hunter.z, y: 1.7, vol: 0.8, rate: 1.05, gap: 2 });
        if (e.why === "light") caption("it has seen your light", g.hunter.x, g.hunter.z);
        if (e.why === "door") caption("it has found a door you moved", g.hunter.x, g.hunter.z, true);
        break;
      case "checkCloset": caption("it is going to the closets", e.x, e.z); break;
      case "chase":
        play("sting1", { vol: 0.55 });
        play(pickOf("growl", 6), { x: g.hunter.x, z: g.hunter.z, y: 1.5, vol: 1.4, rate: 0.9 });
        caption("it is coming", g.hunter.x, g.hunter.z);
        break;
      case "lost": play(pickOf("growl", 6), { x: g.hunter.x, z: g.hunter.z, y: 1.6, vol: 0.7, rate: 0.8 }); break;
      case "breath": play(pickOf("growl", 6), { x: e.x, z: e.z, y: 1.7, vol: e.chase ? 1 : 0.45, rate: e.chase ? 1 : 0.75 + Math.random() * 0.15, gap: 1.2 }); if (!e.chase) caption("breathing, close", e.x, e.z); break;
      case "tiktik": tiktik(e.x, e.z, e.d); caption("tik-tik", e.x, e.z); break;
      case "burned": play("shriek", { x: e.x, z: e.z, y: 1.8, vol: 0.8, rate: 1.3 }); caption("a shriek", e.x, e.z); break;
      case "enter": {
        const w = g.L.windows[e.window];
        play("door_slam", { x: w.x, z: w.z, y: 1.8, vol: 1.3, rate: 0.85 });
        play("break", { x: w.x, z: w.z, y: 1.5, vol: 0.4, rate: 0.7, delay: 0.1 });
        caption("a window bangs open", w.x, w.z);
        break;
      }
      case "flicker": synth("ignite", ui, ac.currentTime, 0.4); break;
      case "kill":
        if (lastScares === "full") { play(e.ghost >= 0 ? pickOf("wail", 3) : "shriek", { vol: 1.6, rate: e.ghost >= 0 ? 1.35 : 1 }); play("sting2", { vol: 0.9 }); }
        else play("heart", { vol: 1.2, rate: 0.8 });
        bedGain("drone1", 0, 0.05);
        musicCut();
        break;
      // the dead, out of the lamps: a cry from each lamp as it gives one up
      case "ghostRise": {
        const l = g.L.lamps[e.lamp];
        play(pickOf("wail", 3), { x: e.x, z: e.z, y: 1.4, vol: 1.3, rate: 0.7 + Math.random() * 0.1, delay: e.delay, ref: 3 });
        if (l) play("ignite", { x: l.x, z: l.z, y: l.y + 0.3, vol: 1, rate: 0.5, delay: e.delay });
        caption("a cry, from a lamp", e.x, e.z, false, e.delay);
        break;
      }
      case "ghostChase":
        play(pickOf("wail", 3), { x: e.x, z: e.z, y: 1.6, vol: 1.4, rate: 1.15 + Math.random() * 0.1, ref: 2.5, gap: 1.5 });
        play("sting3", { vol: 0.4, rate: 1.2, gap: 3 });
        caption("it has seen you", e.x, e.z);
        break;
      case "ghostWail":
        play(pickOf("wail", 3), { x: e.x, z: e.z, y: 1.6, vol: e.chase ? 1.1 : 0.8, rate: (e.chase ? 1.05 : 0.8) + Math.random() * 0.1, ref: 2.5 });
        if (e.d < 14) caption("a wail", e.x, e.z, true);
        break;
      case "ghostLost": play(pickOf("whisper", 5), { x: e.x, z: e.z, y: 1.7, vol: 0.9, rate: 0.75 }); break;
      case "respawn": play("exhale", { vol: 0.6 }); break;
      case "lightning": {
        const d = e.thunder || 1.5;
        // from the side the flash came from (render.js aims it, and says where)
        const side = e.az !== undefined ? { x: p.x + Math.sin(e.az) * 25, z: p.z + Math.cos(e.az) * 25, y: 12, ref: 25, rolloff: 0.2, occluded: false } : {};
        if (d < 1.1 && e.power > 0.6) {
          // close: the crack first, then the roll
          play(pickOf("crack", 2), Object.assign({ vol: 0.55 + e.power * 0.6, delay: d * 0.6, rate: 0.95 + Math.random() * 0.1 }, side));
          play(pickOf("thunder", 3), Object.assign({ vol: 0.35 + e.power * 0.3, delay: d + 0.5, rate: 0.85 + Math.random() * 0.15 }, side));
          caption("thunder, close", e.az !== undefined ? side.x : null, side.z, false, d * 0.6);
        } else {
          play(pickOf("thunder", 3), Object.assign({ vol: 0.45 + e.power * 0.6, delay: d, rate: 0.9 + Math.random() * 0.2 }, side));
          if (e.power > 0.7) caption("thunder", e.az !== undefined ? side.x : null, side.z, true, d);
        }
        break;
      }
      case "silence": play("chime", { x: clockAt(g).x, z: clockAt(g).z, y: 1.8, vol: 0.9, delay: 3 }); break;
      case "flip":
        play("thunder1", { vol: 1.4, rate: 0.8, delay: 0.6 });
        play("sting1", { vol: 0.8, rate: 0.9, delay: 0.2 });
        for (let i = 0; i < 3; i++) play("drag", { vol: 0.5, delay: 1.2 + i * 0.9, rate: 0.8 + Math.random() * 0.3, x: p.x + (Math.random() - 0.5) * 12, z: p.z + (Math.random() - 0.5) * 12 });
        break;
      case "scream": play("shriek", { x: e.x, z: e.z, y: 2, vol: 1.6, rate: 0.75, delay: 0.8 }); caption("a scream, far off", e.x, e.z); break;
      case "gasp": play("gasp", { vol: 0.8 }); break;
      case "breathe": play("breathe", { vol: 0.35, gap: 2 }); break;
      case "pant": play("pant", { vol: 0.32, gap: 5.5 }); break;
      case "rattle": play("latch", { vol: 0.8, rate: 0.7 }); play("door_close", { vol: 0.5 }); break;
      case "won": bedGain("drone1", 0, 0.5); bedGain("drone2", 0, 0.5); play("exhale", { vol: 0.8, delay: 0.6 }); musicCut(2.5); break;
      case "turnAway": play(pickOf("growl", 6), { x: g.hunter.x, z: g.hunter.z, y: 1.7, vol: 0.6, rate: 0.7 }); break;
    }
  }
}
let lastScares = "full";
export function setScares(v) { lastScares = v; }
function clockAt(g) {
  const c = g.L.props.find((q) => q.kind === "grandfather_clock");
  return c ? { x: c.x, z: c.z } : { x: g.player.x + 4, z: g.player.z };
}

function caption(text, x, z, quiet, delay) {
  if (!captions) return;
  let dir = "";
  if (x !== null && x !== undefined && lastG) {
    const pl = lastG.player, ang = Math.atan2(x - pl.x, z - pl.z) - pl.yaw;
    const s = Math.sin(ang), c = Math.cos(ang);
    // yaw is measured so that +sin is to the player's left in this frame
    dir = c > 0.7 ? "ahead" : c < -0.7 ? "behind" : s > 0 ? "left" : "right";
  }
  setTimeout(() => captions(text, dir, quiet), (delay || 0) * 1000);
}

/* ---------- every frame: the beds and the listener ---------- */

let heldPrev = false;
export function update(g, dt, cam) {
  if (!ac || !g) return;
  lastG = g;
  const p = g.player, h = g.hunter, t = ac.currentTime;
  // the listener is the camera
  const L = ac.listener;
  const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
  if (L.positionX) {
    L.positionX.value = cam.x; L.positionY.value = cam.y; L.positionZ.value = cam.z;
    L.forwardX.value = fx; L.forwardY.value = 0; L.forwardZ.value = fz; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
  } else { L.setPosition(cam.x, cam.y, cam.z); L.setOrientation(fx, 0, fz, 0, 1, 0); }

  const near = h.active ? Math.max(0, 1 - g.hunterDist / 12) : 0;
  const stress = Math.max(g.dir.stress, near, h.state === "chase" ? 1 : 0);
  const quiet = g.phase === "breather";
  const peak = g.phase === "peak";
  const won = g.state === "won";
  // rain on the roof, the storm, the frogs outside
  bedGain("rain", won ? 0.2 : quiet ? 0.04 : peak ? 0.75 : 0.5, quiet ? 4 : 1.5);
  bedGain("wind", won ? 0.5 : quiet ? 0.02 : (peak ? 0.5 : 0.28) + 0.08 * Math.sin(t * 0.13), 2);
  bedGain("frogs", won ? 0.5 : quiet ? 0 : peak ? 0.05 : 0.11, 2);
  // the drone: the director's stress, made audible
  bedGain("drone1", won || g.state === "caught" ? 0 : 0.04 + 0.42 * stress * stress, 1.2);
  bedGain("drone2", won ? 0 : peak ? 0.3 : quiet ? 0.12 : 0.05 * p.dread, 3);
  // the lantern's flame, close by
  bedGain("fire", g.lanternPower * 0.09 * (p.hiding >= 0 ? 0.5 : 1), 0.2);
  // the clock, if the house has one, ticking where it stands (stopped for the silence)
  const ck = g.L.props.find((q) => q.kind === "grandfather_clock");
  bedGain("tick", ck && !quiet ? Math.max(0, 0.25 * (1 - Math.hypot(ck.x - p.x, ck.z - p.z) / 9)) : 0, 0.5);

  // the heartbeat: rate and loudness from fear
  const fear = Math.max(p.dread * 0.8, near, h.state === "chase" ? 1 : 0, p.holding ? 0.7 : 0);
  if (fear > 0.25 && g.state === "play") {
    if (t >= heartNext) {
      const bpm = 62 + fear * 85;
      play("heart", { vol: 0.15 + fear * 0.6, bus: "ui", rate: 0.9 });
      heartNext = t + 60 / bpm;
    }
  } else heartNext = t + 0.5;

  // the world, muffled: in a closet, holding your breath, deep in the dark
  let cut = 18000;
  if (p.hiding >= 0) cut = 1600;
  if (p.holding) cut = Math.min(cut, 900);
  if (p.dread > 0.6) cut = Math.min(cut, 18000 - (p.dread - 0.6) * 35000);
  if (g.state === "caught") cut = 600;
  worldLP.frequency.setTargetAtTime(Math.max(400, cut), t, 0.15);
  if (heldPrev && !p.holding && p.gaspLock <= 0) play("exhale", { vol: 0.45 });
  heldPrev = p.holding;

  // the room you are in: a big sala rings, a closet barely does
  const rm = g.L.rooms[Math.max(0, roomOf(g, p.x, p.z))];
  verbSend.gain.setTargetAtTime(p.hiding >= 0 ? 0.05 : 0.14 + Math.min(0.22, rm.area * 0.035), t, 0.4);
  storm(g, dt, quiet, won);
  music(g, dt);

  // the house's own noises, and the night outside
  if (g.state !== "play" || quiet) return;
  for (const k in ambT) ambT[k] -= dt;
  if (ambT.creak <= 0) {
    ambT.creak = 10 + Math.random() * 25;
    const a = Math.random() * Math.PI * 2, d = 6 + Math.random() * 8;
    play(pickOf("creak", 6), { x: p.x + Math.sin(a) * d, z: p.z + Math.cos(a) * d, y: 2.8, vol: 0.4, rate: 0.7 + Math.random() * 0.3 });
  }
  if (ambT.howl <= 0) { ambT.howl = 70 + Math.random() * 80; play("howl", { vol: 0.22, lp: 2500, x: p.x + 30, z: p.z - 20 }); }
  if (ambT.tuko <= 0) { ambT.tuko = 40 + Math.random() * 60; play("tuko", { vol: 0.28, x: p.x - 12, z: p.z + 8, y: 3, occluded: true }); }
  // at the end the front door stands open and creaks in the wind: the one
  // sound in the house that is the way out, to steer by in the dark
  if (peak && ambT.door <= 0) {
    ambT.door = 6 + Math.random() * 3;
    const fd = g.L.doors.find((d) => d.kind === "front");
    if (fd) { play("door_creak_long", { x: fd.x, z: fd.z - 0.2, y: 1.4, vol: 0.9, rate: 0.75 + Math.random() * 0.15, ref: 2.5, rolloff: 0.8 }); caption("the front door, creaking in the wind", fd.x, fd.z, true); }
  }
  // at the end it whispers when it is near
  if (peak && h.active && g.hunterDist < 9) {
    if (ambT.whisper <= 0) { ambT.whisper = 2.5 + Math.random() * 3; play(pickOf("whisper", 5), { x: h.x, z: h.z, y: 1.8, vol: 1.2 * (1 - g.hunterDist / 9) + 0.3, rate: 0.85 }); caption("whispering", h.x, h.z); }
  }
}

const roomOf = (g, x, z) => { const i = Math.floor(x / g.L.CELL), j = Math.floor(z / g.L.CELL); return i < 0 || j < 0 || i >= g.L.GW || j >= g.L.GH ? -1 : g.L.cellRoom[j * g.L.GW + i]; };

/* ---------- the storm at the windows ---------- */
/* A spot: one looping recording that sits at a place in the house and
   follows the nearest window, so the rain on the capiz and the wind in the
   cracks are always beside you on the side they really are. */
const spots = {};
function spot(name) {
  if (spots[name] !== undefined) return spots[name];
  if (!buf[name]) return null;
  const s = ac.createBufferSource(), g = ac.createGain(), p = ac.createPanner();
  s.buffer = buf[name]; s.loop = true; s.loopStart = 0.06; s.loopEnd = buf[name].duration - 0.06;
  p.panningModel = "HRTF"; p.distanceModel = "inverse"; p.refDistance = 1.2; p.rolloffFactor = 1.4; p.maxDistance = 30;
  g.gain.value = 0;
  s.connect(g); g.connect(p); p.connect(world);
  s.start(ac.currentTime, Math.random() * (buf[name].duration - 1));
  return (spots[name] = { p, g, x: null, z: null });
}
function spotAt(sp, x, y, z, v, t) {
  if (!sp) return;
  // glide, so walking past one window to the next is a move, not a jump
  if (sp.x === null) { sp.x = x; sp.z = z; } else { sp.x += (x - sp.x) * 0.08; sp.z += (z - sp.z) * 0.08; }
  setPos(sp.p, sp.x, y, sp.z);
  sp.g.gain.setTargetAtTime(v, t, 0.5);
}
let leaks = null, leaksOf = null;
function storm(g, dt, quiet, won) {
  const p = g.player, t = ac.currentTime, L = g.L;
  let w = null, wd = Infinity;
  for (const q of L.windows) { const d = Math.hypot(q.x - p.x, q.z - p.z); if (d < wd) { wd = d; w = q; } }
  const gust = 0.6 + 0.4 * Math.sin(t * 0.21) * Math.sin(t * 0.07 + 1);
  const wet = won ? 0.2 : quiet ? 0.05 : g.phase === "peak" ? 1 : 0.75;
  if (w) {
    const ix = w.x - w.n[0] * 0.2, iz = w.z - w.n[1] * 0.2;
    spotAt(spot("rainglass"), ix, 1.7, iz, 0.55 * wet, t);
    spotAt(spot("whistle"), ix, 2.2, iz, (quiet ? 0 : 0.32 * gust) * (won ? 0.3 : 1), t);
  }
  // where the sills leak: a drip now and then, under a few of the windows
  if (leaksOf !== L) {
    leaksOf = L;
    leaks = L.windows.filter((q, i) => ((L.seed >>> (i % 24)) & 1) === 1).slice(0, 4).map((q) => ({ x: q.x - q.n[0] * 0.35, z: q.z - q.n[1] * 0.35, t: Math.random() * 2 }));
  }
  if (quiet && g.phaseT > 4) return;
  for (const k of leaks) {
    k.t -= dt;
    if (k.t > 0) continue;
    k.t = 1.1 + Math.random() * 1.6;
    if (Math.hypot(k.x - p.x, k.z - p.z) < 9) play(pickOf("drip", 3), { x: k.x, z: k.z, y: 0.05, vol: 0.5, rate: 0.9 + Math.random() * 0.25, ref: 0.8 });
  }
}

/* ---------- the score ---------- */
/* Made, not recorded, so it can follow the night: a tom pattern, a low
   string figure that worries at a semitone, and a Shepard tone that climbs
   and never arrives. It is silent until something is after you; the end
   has all of it, faster and louder the nearer the nearest of them is. The
   scheduling is Ballzooka's musicTick (ballzooka/js/audio.js): each frame,
   every beat due in the next moment is set on the audio clock, so the
   tempo holds however uneven the frames are. */
const M = { next: 0, step: 0, level: 0, rise: null, phase: 0 };
function music(g, dt) {
  const t = ac.currentTime, h = g.hunter;
  // out: whatever fade musicCut() began is left to finish
  if (g.state === "won" || g.state === "dead") { M.level = 0; riser(0, 0, dt, t); return; }
  const fin = g.flipped && g.state === "play";
  const chase = !g.flipped && g.state === "play" && h.active && h.state === "chase";
  const near = Math.max(fin ? Math.max(0, 1 - (g.ghostDist || 99) / 14) : 0, h.active && h.state === "chase" ? Math.max(0, 1 - g.hunterDist / 14) : 0);
  const want = fin ? 0.55 + 0.45 * near : chase ? 0.35 + 0.25 * near : 0;
  M.level += (want - M.level) * Math.min(1, dt * (want > M.level ? 2 : 0.6));
  musBus.gain.setTargetAtTime(M.level * 0.6, t, 0.2);
  riser(fin ? M.level : 0, near, dt, t);
  if (M.level < 0.02) { M.next = t + 0.05; M.step = 0; return; }
  const bpm = fin ? 116 + 36 * near : 100 + 20 * near, eighth = 30 / bpm;
  if (M.next < t) M.next = t + 0.02;
  while (M.next < t + 0.12) { beat(M.step, M.next, fin, near); M.next += eighth; M.step++; }
}
/* one eighth of the bar */
function beat(s, when, fin, near) {
  const i = s % 16, lvl = M.level;
  // drums: one-and-a-half bars of something that will not let up
  const hits = fin ? (near > 0.55 ? [0, 3, 6, 8, 10, 11, 14] : [0, 3, 6, 8, 11, 14]) : [0, 6, 8, 14];
  if (hits.includes(i)) {
    const big = i === 0 || i === 8;
    hit(big ? "tom2" : "tom1", when, (big ? 0.9 : 0.6) * lvl, big ? 0.9 : 1.05 + (i % 3) * 0.04);
  }
  if (!fin) return;
  // the strings: D, D, E-flat, D ... and up a minor third at the turn
  const semi = [0, 0, 1, 0, 0, 0, 1, 3][i % 8] + (s % 64 >= 48 ? 1 : 0);
  bow(73.42 * Math.pow(2, semi / 12), when, 30 / 116 * 0.95, 0.16 * lvl, near);
  // a stab on the bar, now and then: a dissonant cluster high up
  if (i === 0 && s % 32 === 0) stab(when, 0.08 + 0.12 * near);
}
function hit(name, when, vol, rate) {
  const b = buf[name];
  const g = ac.createGain(); g.gain.value = vol; g.connect(musBus);
  if (b) { const s = ac.createBufferSource(); s.buffer = b; s.playbackRate.value = rate; s.connect(g); s.start(when); }
  else synth("tom", g, when, rate);
}
function bow(f, when, len, vol, near) {
  const g = ac.createGain(), lp = ac.createBiquadFilter();
  lp.type = "lowpass"; lp.frequency.value = 500 + 1400 * near; lp.Q.value = 3;
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(vol, when + 0.015);
  g.gain.exponentialRampToValueAtTime(vol * 0.5, when + len * 0.6);
  g.gain.exponentialRampToValueAtTime(0.0001, when + len + 0.08);
  lp.connect(g); g.connect(musBus);
  for (const c of [-7, 7]) {
    const o = ac.createOscillator(); o.type = "sawtooth"; o.frequency.value = f; o.detune.value = c;
    o.connect(lp); o.start(when); o.stop(when + len + 0.12);
  }
}
function stab(when, vol) {
  const g = ac.createGain(), bp = ac.createBiquadFilter();
  bp.type = "bandpass"; bp.frequency.value = 1900; bp.Q.value = 1.2;
  g.gain.setValueAtTime(0.0001, when); g.gain.exponentialRampToValueAtTime(vol, when + 0.4); g.gain.exponentialRampToValueAtTime(0.0001, when + 2.6);
  bp.connect(g); g.connect(musBus);
  for (const f of [1567, 1661, 1760, 2349]) {
    const o = ac.createOscillator(); o.type = "sawtooth"; o.frequency.value = f;
    const v = ac.createOscillator(), vg = ac.createGain(); v.frequency.value = 6 + Math.random() * 2; vg.gain.value = f * 0.012; v.connect(vg); vg.connect(o.frequency);
    o.connect(bp); o.start(when); o.stop(when + 2.7); v.start(when); v.stop(when + 2.7);
  }
}
/* The Shepard–Risset climb: six sines an octave apart, sliding up together
   and fading in at the bottom and out at the top, so it rises for ever. */
function riser(vol, near, dt, t) {
  if (!M.rise && vol <= 0.01) return;
  if (!M.rise) {
    const out = ac.createGain(); out.gain.value = 0; out.connect(musBus);
    M.rise = { out, o: [] };
    for (let k = 0; k < 6; k++) { const o = ac.createOscillator(), g = ac.createGain(); o.type = "triangle"; g.gain.value = 0; o.connect(g); g.connect(out); o.start(); M.rise.o.push({ o, g, k }); }
  }
  M.rise.out.gain.setTargetAtTime(vol * 0.11, t, 0.4);
  M.phase = (M.phase + dt * (0.06 + 0.1 * near)) % 1;
  for (const q of M.rise.o) {
    const oct = q.k + M.phase, f = 55 * Math.pow(2, oct), x = (oct - 3) / 1.4;
    q.o.frequency.setTargetAtTime(f, t, 0.03);
    q.g.gain.setTargetAtTime(Math.exp(-x * x), t, 0.05);
  }
  if (vol <= 0.01 && M.level < 0.01) { for (const q of M.rise.o) q.o.stop(); M.rise.out.disconnect(); M.rise = null; }
}
function musicCut(secs) {
  if (!ac) return;
  M.level = 0;
  musBus.gain.cancelScheduledValues(ac.currentTime);
  musBus.gain.setTargetAtTime(0, ac.currentTime, secs ? secs / 3 : 0.05);
}

export function quietAll() { for (const k in bed) if (bed[k]) bed[k].g.gain.setTargetAtTime(0, ac.currentTime, 0.3); for (const k in spots) if (spots[k]) spots[k].g.gain.setTargetAtTime(0, ac.currentTime, 0.3); musicCut(); }

/* The title: rain and the storm, nothing else. */
export function title() {
  if (!ac) return;
  musicCut();
  bedGain("rain", 0.45, 1); bedGain("wind", 0.22, 1); bedGain("frogs", 0.08, 1);
  for (const k of ["drone1", "drone2", "fire", "tick"]) bedGain(k, 0, 0.5);
}
