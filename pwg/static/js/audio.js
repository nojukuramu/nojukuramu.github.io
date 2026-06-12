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
 *
 * The melody is performed, not sequenced: phrase-level rubato, per-note
 * timing/velocity wobble, velocity that follows the pitch contour, and a
 * chance of grace notes, soft echoes, passing tones, and pickup runs.
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

/* A natural-minor / C-major pitch set, for ornaments and passing tones */
const SCALE = [45, 47, 48, 50, 52, 53, 55, 57, 59, 60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81];

function scaleStep(midi, dir) {
  const i = SCALE.indexOf(midi);
  if (i < 0) return midi + dir;
  return SCALE[Math.min(SCALE.length - 1, Math.max(0, i + dir))];
}

/* three melodies per chord: [beat, midi] */
const MELODIES = [
  [ // set A — singing
    [[0, 64], [1.5, 69], [3, 71], [4.5, 72], [6, 71]],
    [[0, 69], [1.5, 72], [3, 76], [5, 72], [6.5, 69]],
    [[0, 71], [1.5, 67], [3, 64], [5, 67], [6.5, 74]],
    [[0, 74], [2, 71], [4, 69], [6, 67]]
  ],
  [ // set B — sparse, lets the pads speak
    [[0, 69], [3, 72], [6, 76]],
    [[1, 76], [4, 72], [6.5, 69]],
    [[0, 76], [3, 71], [6, 67]],
    [[0, 69], [3, 71], [5.5, 74]]
  ],
  [ // set C — lyrical descent, ends suspended into the next pass
    [[0, 76], [2, 74], [3.5, 72], [5, 71], [6.5, 72]],
    [[0, 72], [2, 69], [4, 67], [5.5, 64]],
    [[0, 64], [1.5, 67], [3, 71], [4.5, 72], [6, 74]],
    [[0, 71], [2, 74], [4, 76], [6, 74]]
  ]
];

/* felt piano: soft attack, slightly chorused fundamental, dark partials
 * whose brightness follows the velocity — quiet notes are rounder */
function piano(c, dest, midi, t, vel = 1, dur = 4.5) {
  t = Math.max(t, 0.01); // ornaments may aim before the render/context start
  const det = (Math.random() - 0.5) * 5; // ±2.5 cents, never twice the same
  const f = mtof(midi) * Math.pow(2, det / 1200);
  const attack = 0.055 + (1 - Math.min(vel, 1)) * 0.07;
  const partials = [
    [0.9985, 0.1], [1.0015, 0.1],         // chorused fundamental
    [2, 0.042 * vel], [3, 0.011 * vel]    // overtones fade with soft touch
  ];
  for (const [mult, amp] of partials) {
    const o = c.createOscillator();
    const g = c.createGain();
    const d = dur / Math.max(1, Math.floor(mult));
    o.type = "sine";
    o.frequency.value = f * mult;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(amp * vel, t + attack);
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
  g.gain.linearRampToValueAtTime(0.09, t + 0.14);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(dest);
  o.start(t);
  o.stop(t + dur + 0.05);
}

/* one chord's melody, performed: rubato curve, contour-following velocity,
 * and dice rolls for grace notes, echoes, and passing tones */
function performPhrase(c, dest, phrase, t, beat, rng, octave, baseVel) {
  // breathe across the bar: push a hair early mid-phrase, settle at the end
  const rubato = (b) => beat * 0.06 * Math.sin((b / BEATS_PER_CHORD) * Math.PI * 2);
  for (let i = 0; i < phrase.length; i++) {
    const [b, m] = phrase[i];
    const midi = m + octave;
    let vel = baseVel * (0.72 + 0.22 * ((midi - 64 - octave) / 12)) * (0.85 + rng() * 0.3);
    vel = Math.min(1, Math.max(0.35, vel));
    const tt = t + b * beat + rubato(b) + (rng() - 0.5) * 0.055;

    if (rng() < 0.16) { // grace note leaning into the main tone
      piano(c, dest, scaleStep(midi, rng() < 0.65 ? -1 : 1), tt - beat * 0.16, vel * 0.38, 1.8);
    }
    piano(c, dest, midi, tt, vel);
    if (rng() < 0.13) { // soft echo of the same note
      piano(c, dest, midi, tt + beat * 0.9, vel * 0.4, 3.2);
    }
    const nxt = phrase[i + 1];
    if (nxt && rng() < 0.3) { // walk a passing tone toward the next note
      const gap = nxt[1] + octave - midi;
      if (Math.abs(gap) >= 3 && Math.abs(gap) <= 5) {
        const tm = t + ((b + nxt[0]) / 2) * beat + (rng() - 0.5) * 0.04;
        piano(c, dest, scaleStep(midi, gap > 0 ? 1 : -1), tm, vel * 0.5, 2.6);
      }
    }
  }
}

/* schedule one full pass of the progression at t0; returns its duration */
function scheduleMusicPass(c, dest, t0, rng = Math.random) {
  const beat = 0.86 + rng() * 0.08;          // gentle tempo drift per pass
  const chordDur = BEATS_PER_CHORD * beat;
  const quiet = rng() < 0.28;                // breathing pass: pads only
  const melody = MELODIES[Math.floor(rng() * MELODIES.length)];
  const octave = !quiet && rng() < 0.12 ? 12 : 0; // rare sparkle pass, up high
  const baseVel = octave ? 0.6 : 0.85;
  const human = () => (rng() - 0.5) * 0.04;

  // occasional pickup run rising into the first phrase
  if (!quiet && rng() < 0.22) {
    const first = melody[0][0][1] + octave;
    for (let i = 3; i >= 1; i--) {
      let p = first;
      for (let k = 0; k < i; k++) p = scaleStep(p, -1);
      piano(c, dest, p, Math.max(0.01, t0 - i * beat * 0.22), 0.3, 2);
    }
  }

  for (let ci = 0; ci < PROG.length; ci++) {
    const t = t0 + ci * chordDur;
    const chord = PROG[ci];
    pad(c, dest, chord.pad, t, chordDur * 1.12);   // slight overlap = no seams
    bass(c, dest, chord.bass, t + 0.02, chordDur * 0.95);

    if (!quiet) performPhrase(c, dest, melody[ci], t, beat, rng, octave, baseVel);

    // soft broken-chord undercurrent, sometimes, with a lazy lilt
    if (rng() < (quiet ? 0.7 : 0.4)) {
      chord.pad.forEach((m, i) => {
        const lilt = i % 2 ? beat * 0.09 : 0;
        piano(c, dest, m, t + (0.5 + i * 1.75) * beat + lilt + human(), 0.26, 2.4);
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
    musicGain.gain.setTargetAtTime(1.05, c.currentTime, 1.2); // gentle fade in
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
  out.gain.value = 1.05;
  out.connect(c.destination);
  const input = makeMusicChain(c, out);
  let t = 0.1;
  while (t < seconds) t += scheduleMusicPass(c, input, t);
  return c.startRendering();
}
