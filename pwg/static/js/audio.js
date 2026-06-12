/* Pinoy Word Games — audio engine (Web Audio API, no external files/CDN)
 *
 * SFX: short synthesized cues (key taps, win arpeggio, etc).
 * BG music: an original composed piece, "Habang Naghihintay ang Salita" —
 * a slow, calming loop in the spirit of Minecraft's piano tracks: music-box
 * piano over warm pads and soft bass, drifting through Am9 → Fmaj7 →
 * Cmaj7 → G6 with humanized timing and a generated convolution reverb.
 * Every pass varies (two melodies, optional arpeggio, occasional quiet
 * pass with no melody at all), so it breathes instead of looping audibly.
 */

let ctx = null;
let masterGain = null;
let _muted = localStorage.getItem("pwg:muted") === "1";

function ensureCtx() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = ctx.createGain();
    masterGain.gain.value = _muted ? 0 : 1;
    masterGain.connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

/* ---------------- SFX ---------------- */

function osc(freq, dur, type = "sine", amp = 0.25, delay = 0) {
  const c = ensureCtx();
  const o = c.createOscillator();
  const g = c.createGain();
  const t0 = c.currentTime + delay;
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(amp, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g);
  g.connect(masterGain);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

export function playKeyTap() {
  if (_muted) return;
  try { osc(900, 0.04, "sine", 0.1); } catch (e) { /* ok */ }
}

export function playDash() {
  if (_muted) return;
  try { osc(660, 0.07, "sine", 0.1); } catch (e) { /* ok */ }
}

export function playBackspace() {
  if (_muted) return;
  try { osc(500, 0.05, "sine", 0.09); } catch (e) { /* ok */ }
}

export function playWrong() {
  if (_muted) return;
  try {
    const c = ensureCtx();
    const o = c.createOscillator();
    const g = c.createGain();
    const t0 = c.currentTime;
    o.type = "sawtooth";
    o.frequency.setValueAtTime(260, t0);
    o.frequency.exponentialRampToValueAtTime(90, t0 + 0.32);
    g.gain.setValueAtTime(0.28, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.38);
    o.connect(g);
    g.connect(masterGain);
    o.start(t0);
    o.stop(t0 + 0.42);
  } catch (e) { /* ok */ }
}

export function playHint() {
  if (_muted) return;
  // Soft sparkle: two quick rising tones
  try {
    osc(440, 0.12, "sine", 0.14);
    osc(880, 0.16, "sine", 0.1, 0.06);
  } catch (e) { /* ok */ }
}

export function playWin() {
  if (_muted) return;
  // Ascending C major arpeggio: C5 E5 G5 C6
  try {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
      osc(f, 0.55, "sine", 0.26, i * 0.09)
    );
  } catch (e) { /* ok */ }
}

export function playGrad() {
  if (_muted) return;
  // Triumphant fanfare: G4 C5 E5 G5 C6 + harmony
  try {
    [392, 523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
      osc(f, 0.55, "triangle", 0.28, i * 0.12)
    );
    // Warm low chord underneath
    osc(130.81, 0.9, "sine", 0.12, 0.05);
    osc(196, 0.9, "sine", 0.08, 0.05);
  } catch (e) { /* ok */ }
}

/* =============== background music: "Habang Naghihintay ang Salita" ======
 * Score is written in MIDI note numbers and beats; one "pass" walks the
 * whole 4-chord progression (8 beats per chord). All instruments are
 * scheduled against an arbitrary destination node, so the same score can
 * play live or render into an OfflineAudioContext (see renderMusicPreview).
 */

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

const BEATS_PER_CHORD = 8;

/* Am9 → Fmaj7 → Cmaj7 → G6 (pads are mid-register voicings) */
const PROG = [
  { bass: 45, pad: [57, 60, 64, 71] },   // A2 | A3 C4 E4 B4
  { bass: 41, pad: [53, 57, 60, 64] },   // F2 | F3 A3 C4 E4
  { bass: 48, pad: [55, 59, 64, 67] },   // C3 | G3 B3 E4 G4
  { bass: 43, pad: [55, 59, 62, 64] }    // G2 | G3 B3 D4 E4
];

/* two melodies per chord: [beat, midi] — set A sings, set B is sparser */
const MELODIES = [
  [ // set A
    [[0, 64], [1.5, 69], [3, 71], [4.5, 72], [6, 71]],
    [[0, 69], [1.5, 72], [3, 76], [5, 72], [6.5, 69]],
    [[0, 71], [1.5, 67], [3, 64], [5, 67], [6.5, 74]],
    [[0, 74], [2, 71], [4, 69], [6, 67]]
  ],
  [ // set B
    [[0, 69], [3, 72], [6, 76]],
    [[1, 76], [4, 72], [6.5, 69]],
    [[0, 76], [3, 71], [6, 67]],
    [[0, 69], [3, 71], [5.5, 74]]
  ]
];

/* music-box piano: sine partials, higher ones decay faster */
function piano(c, dest, midi, t, vel = 1, dur = 3) {
  const f = mtof(midi);
  const partials = [[1, 0.16], [2, 0.05], [3, 0.018]];
  for (const [mult, amp] of partials) {
    const o = c.createOscillator();
    const g = c.createGain();
    const d = dur / mult;
    o.type = "sine";
    o.frequency.value = f * mult;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(amp * vel, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g);
    g.connect(dest);
    o.start(t);
    o.stop(t + d + 0.05);
  }
}

/* warm pad: detuned triangles through a gentle lowpass, slow swell */
function pad(c, dest, midis, t, dur) {
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 750;
  lp.Q.value = 0.3;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.05, t + dur * 0.35);
  g.gain.setValueAtTime(0.05, t + dur * 0.7);
  g.gain.linearRampToValueAtTime(0.0001, t + dur);
  lp.connect(g);
  g.connect(dest);
  for (const m of midis) {
    for (const det of [-4, 4]) {
      const o = c.createOscillator();
      const og = c.createGain();
      o.type = "triangle";
      o.frequency.value = mtof(m);
      o.detune.value = det;
      og.gain.value = 1 / (midis.length * 2);
      o.connect(og);
      og.connect(lp);
      o.start(t);
      o.stop(t + dur + 0.1);
    }
  }
}

function bass(c, dest, midi, t, dur) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = "sine";
  o.frequency.value = mtof(midi);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.09, t + 0.06);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(dest);
  o.start(t);
  o.stop(t + dur + 0.05);
}

/* schedule one full pass of the progression at t0; returns its duration */
function scheduleMusicPass(c, dest, t0, rng = Math.random) {
  const beat = 0.82 + rng() * 0.06;          // gentle tempo drift per pass
  const chordDur = BEATS_PER_CHORD * beat;
  const quiet = rng() < 0.28;                // breathing pass: pads only
  const melody = MELODIES[rng() < 0.5 ? 0 : 1];
  const human = () => (rng() - 0.5) * 0.03;

  for (let ci = 0; ci < PROG.length; ci++) {
    const t = t0 + ci * chordDur;
    const chord = PROG[ci];
    pad(c, dest, chord.pad, t, chordDur * 1.12);   // slight overlap = no seams
    bass(c, dest, chord.bass, t + 0.02, chordDur * 0.95);

    if (!quiet) {
      for (const [b, midi] of melody[ci]) {
        piano(c, dest, midi, t + b * beat + human(), 0.8 + rng() * 0.25, 3);
      }
    }
    // soft broken-chord undercurrent, sometimes
    if (rng() < (quiet ? 0.7 : 0.45)) {
      chord.pad.forEach((m, i) => {
        piano(c, dest, m, t + (0.5 + i * 1.75) * beat + human(), 0.3, 2.2);
      });
    }
  }
  return PROG.length * chordDur;
}

/* dry + generated-impulse convolution reverb */
function makeIR(c, seconds, decayPow) {
  const rate = c.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = c.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decayPow);
    }
  }
  return buf;
}

function makeMusicChain(c, dest) {
  const input = c.createGain();
  const dry = c.createGain();
  const wet = c.createGain();
  const conv = c.createConvolver();
  dry.gain.value = 0.6;
  wet.gain.value = 0.5;
  conv.buffer = makeIR(c, 2.6, 2.6);
  input.connect(dry); dry.connect(dest);
  input.connect(conv); conv.connect(wet); wet.connect(dest);
  return input;
}

/* --- live playback: lookahead scheduler, one pass at a time --- */

let bgRunning = false;
let bgTimer = null;
let musicGain = null;   // fade in/out + future volume control
let musicIn = null;     // reverb chain input
let nextPassAt = 0;

function bgTick() {
  if (!bgRunning) return;
  const c = ensureCtx();
  // keep ~4s of music scheduled ahead (survives background-tab throttling)
  if (nextPassAt - c.currentTime < 4) {
    nextPassAt = Math.max(nextPassAt, c.currentTime + 0.15);
    nextPassAt += scheduleMusicPass(c, musicIn, nextPassAt);
  }
}

export function startBgMusic() {
  if (bgRunning) return;
  try {
    const c = ensureCtx();
    if (!musicGain) {
      musicGain = c.createGain();
      musicGain.gain.value = 0;
      musicGain.connect(masterGain);
      musicIn = makeMusicChain(c, musicGain);
    }
    bgRunning = true;
    musicGain.gain.cancelScheduledValues(c.currentTime);
    musicGain.gain.setTargetAtTime(0.9, c.currentTime, 1.2); // gentle fade in
    nextPassAt = c.currentTime + 0.2;
    bgTick();
    bgTimer = setInterval(bgTick, 500);
  } catch (e) { /* no audio — game still playable */ }
}

export function stopBgMusic() {
  bgRunning = false;
  if (bgTimer) { clearInterval(bgTimer); bgTimer = null; }
  if (ctx && musicGain) {
    musicGain.gain.cancelScheduledValues(ctx.currentTime);
    musicGain.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
  }
}

export function toggleMute() {
  _muted = !_muted;
  localStorage.setItem("pwg:muted", _muted ? "1" : "0");
  if (ctx && masterGain) {
    masterGain.gain.cancelScheduledValues(ctx.currentTime);
    masterGain.gain.setTargetAtTime(_muted ? 0 : 1, ctx.currentTime, 0.06);
  }
  if (_muted) stopBgMusic();
  else startBgMusic();
  return _muted;
}

export function isMuted() { return _muted; }

/* render N seconds of the piece offline (dev/preview; not used in-game) */
export async function renderMusicPreview(seconds = 30, sampleRate = 44100) {
  const c = new OfflineAudioContext(2, Math.ceil(sampleRate * seconds), sampleRate);
  const out = c.createGain();
  out.gain.value = 0.9;
  out.connect(c.destination);
  const input = makeMusicChain(c, out);
  let t = 0.1;
  while (t < seconds) t += scheduleMusicPass(c, input, t);
  return c.startRendering();
}
