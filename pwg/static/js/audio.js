/* Pinoy Word Games — audio engine (Web Audio API, no external files/CDN) */

let ctx = null;
let masterGain = null;
let bgRunning = false;
let bgTimer = null;
let _muted = localStorage.getItem("pwg:muted") === "1";

// C major pentatonic (two octaves) for ambient notes
const PENTATONIC = [130.81, 164.81, 196, 261.63, 329.63, 392, 523.25, 659.25, 783.99];

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

/* ---- background ambient music: soft pentatonic notes ---- */

function ambientNote() {
  if (!bgRunning) return;
  if (_muted) {
    bgTimer = setTimeout(ambientNote, 5000);
    return;
  }
  try {
    const c = ensureCtx();
    const freq = PENTATONIC[Math.floor(Math.random() * PENTATONIC.length)];
    const o = c.createOscillator();
    const g = c.createGain();
    const t0 = c.currentTime;
    o.type = "sine";
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.042, t0 + 0.35);
    g.gain.setValueAtTime(0.042, t0 + 1.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 3.0);
    o.connect(g);
    g.connect(masterGain);
    o.start(t0);
    o.stop(t0 + 3.2);

    // Occasionally add a harmony note a fifth above
    if (Math.random() < 0.35) {
      osc(freq * 1.5, 2.4, "sine", 0.02, 0.15);
    }
  } catch (e) { /* ok */ }
  bgTimer = setTimeout(ambientNote, 3800 + Math.random() * 4200);
}

export function startBgMusic() {
  if (bgRunning) return;
  bgRunning = true;
  ambientNote();
}

export function stopBgMusic() {
  bgRunning = false;
  if (bgTimer) { clearTimeout(bgTimer); bgTimer = null; }
}

export function toggleMute() {
  _muted = !_muted;
  localStorage.setItem("pwg:muted", _muted ? "1" : "0");
  if (ctx && masterGain) {
    masterGain.gain.cancelScheduledValues(ctx.currentTime);
    masterGain.gain.setTargetAtTime(_muted ? 0 : 1, ctx.currentTime, 0.06);
  }
  // If unmuting, restart ambient loop
  if (!_muted && !bgRunning) startBgMusic();
  return _muted;
}

export function isMuted() { return _muted; }
