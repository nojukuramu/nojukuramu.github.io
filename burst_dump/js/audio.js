/* ============================================================
   BURST//DUMP — the song

   Decoding, handing the samples to the analysis worker, and playing the
   track under the preview.

   Playback is an AudioBufferSourceNode, not an <audio> element: the
   element's currentTime is coarse and seeks lazily, so the first version
   nudged it whenever it drifted 80 ms from the picture. Here the audio
   clock is the master and the picture reads it, less the output latency
   the browser reports, so a cut lands when it is heard, Bluetooth included.
   ============================================================ */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export const A = {
  ctx: null, musicGain: null, clickGain: null, dest: null, noise: null,
  buffer: null, file: null, analysis: null, analyzing: false, melodyPending: false,
  src: null, startCtx: 0, startT: 0, playing: false
};
const cache = new Map();            // file key -> analysis, so re-adding a track is instant
let worker = null, jobId = 0;

export function ensureCtx(cfg) {
  if (A.ctx) return A.ctx;
  const C = window.AudioContext || window.webkitAudioContext;
  A.ctx = new C({ latencyHint: "interactive" });
  A.dest = A.ctx.createMediaStreamDestination ? A.ctx.createMediaStreamDestination() : null;
  A.musicGain = A.ctx.createGain(); A.musicGain.gain.value = cfg.musicVol;
  A.musicGain.connect(A.ctx.destination); if (A.dest) A.musicGain.connect(A.dest);
  A.clickGain = A.ctx.createGain(); A.clickGain.gain.value = cfg.sfxVol * 0.5;
  const bp = A.ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 2400; bp.Q.value = 0.9;
  A.clickGain.connect(bp); bp.connect(A.ctx.destination); if (A.dest) bp.connect(A.dest);
  A.noise = noiseBuffer(A.ctx);
  return A.ctx;
}
function noiseBuffer(c) {
  const len = c.sampleRate * 0.03 | 0, b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0);
  let s = 12345; for (let i = 0; i < len; i++) { s = (s * 1103515245 + 12345) >>> 0; d[i] = (s / 2147483648 - 1) * Math.pow(1 - i / len, 2); }
  return b;
}
export function setVolumes(cfg) {
  if (A.musicGain) A.musicGain.gain.value = cfg.musicVol;
  if (A.clickGain) A.clickGain.gain.value = cfg.sfxVol * 0.5;
}

/* ---------- loading & analysis ---------- */
const keyOf = (f) => f.name + "|" + f.size + "|" + f.lastModified;

/* Decodes at 44.1 kHz (what Essentia's beat tracker assumes) with an
   OfflineAudioContext, so no live context is needed before the first tap,
   and hands a mono copy to the worker. Callbacks:
   progress(stage, p), rhythm(result), melody(patch), error(msg). */
export async function load(file, cb) {
  const id = ++jobId;
  stop();
  A.file = file; A.buffer = null; A.analysis = null; A.analyzing = true; A.melodyPending = true;
  const done = () => id === jobId;
  try {
    cb.progress("decode", 0);
    const data = await file.arrayBuffer();
    const C = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const buf = await new Promise((res, rej) => { const p = new C(2, 1, 44100).decodeAudioData(data, res, rej); if (p && p.catch) p.catch(rej); });
    if (!done()) return;
    A.buffer = buf;
    const hit = cache.get(keyOf(file));
    if (hit) { A.analysis = hit; A.analyzing = false; A.melodyPending = false; cb.rhythm(hit, true); cb.melody(null, true); return; }
    const n = buf.length, mono = new Float32Array(n), c0 = buf.getChannelData(0), c1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : null;
    for (let i = 0; i < n; i++) mono[i] = c1 ? (c0[i] + c1[i]) * 0.5 : c0[i];
    if (!worker) worker = new Worker(new URL("./analysis-worker.js", import.meta.url), { type: "module" });
    worker.onmessage = (e) => {
      const m = e.data; if (m.id !== jobId) return;
      if (m.type === "progress") cb.progress(m.stage, m.p);
      else if (m.type === "rhythm") { A.analysis = m.result; A.analyzing = false; cb.rhythm(m.result, false); }
      else if (m.type === "melody") {
        const r = A.analysis; if (!r) return;
        r.notes = m.notes; r.pitch = m.pitch; r.curves.melody = m.melodyCurve; r.melodyEngine = m.melodyEngine;
        m.sectionFeel.forEach((f, i) => { if (r.sections[i]) r.sections[i].feel = f; });
        A.melodyPending = false; cache.set(keyOf(file), r); cb.melody(r, false);
      } else if (m.type === "error") { A.analyzing = false; A.melodyPending = false; cb.error(m.message); }
    };
    worker.onerror = (e) => { if (!done()) return; A.analyzing = false; A.melodyPending = false; cb.error((e && e.message) || "analysis worker failed"); };
    worker.postMessage({ id, mono, sr: 44100 }, [mono.buffer]);
  } catch (err) {
    if (!done()) return;
    A.analyzing = false; A.melodyPending = false;
    cb.error(String((err && err.message) || err));
  }
}
export function clear() {
  jobId++; stop();
  A.buffer = null; A.file = null; A.analysis = null; A.analyzing = false; A.melodyPending = false;
}

/* ---------- playback ---------- */
function latency() { const c = A.ctx; return c ? clamp((c.outputLatency || c.baseLatency || 0), 0, 0.4) : 0; }
/* How long the song fades over at the end of the reel: the hold on the last
   photo when there is one, so the reel ends rather than being cut off mid-bar. */
const fadeS = (cfg) => clamp((cfg.holdLast ? cfg.holdMs : 0) / 1000, 0.25, 1.5);
/* Plays from timeline tMs; endMs, when given, is where the reel ends and the
   music has faded out. */
export function play(tMs, cfg, endMs) {
  stop();
  A.playing = true; A.startT = tMs;
  if (!A.ctx) return;
  A.startCtx = A.ctx.currentTime + 0.03;
  const off = cfg.musicOff + tMs / 1000;
  if (A.buffer && off < A.buffer.duration) {
    const s = A.ctx.createBufferSource(); s.buffer = A.buffer;
    const g = A.ctx.createGain(); s.connect(g); g.connect(A.musicGain);
    if (endMs > tMs) {
      const end = A.startCtx + (endMs - tMs) / 1000, f = fadeS(cfg), from = end - f;
      const g0 = from >= A.startCtx ? 1 : clamp((end - A.startCtx) / f, 0, 1);
      g.gain.setValueAtTime(g0, A.startCtx);
      if (from > A.startCtx) g.gain.setValueAtTime(1, from);
      g.gain.linearRampToValueAtTime(0, end);
    }
    s.start(A.startCtx, Math.max(0, off)); A.src = s;
  }
}
export function stop() {
  A.playing = false;
  if (A.src) { try { A.src.stop(); } catch (e) {} try { A.src.disconnect(); } catch (e) {} A.src = null; }
}
/* Timeline ms that is being heard right now, or null without a clock. */
export function nowMs() {
  if (!A.playing || !A.ctx || !A.src) return null;
  return A.startT + Math.max(0, A.ctx.currentTime - A.startCtx - latency()) * 1000;
}
let lastClick = 0;
export function click(cfg) {
  if (!cfg.sfx || !A.ctx) return;
  const now = performance.now(); if (now - lastClick < 24) return; lastClick = now;
  const s = A.ctx.createBufferSource(); s.buffer = A.noise; s.connect(A.clickGain); s.start();
}

/* ---------- the export mix ---------- */
/* The whole soundtrack rendered offline, faster than real time: the song
   from the chosen start, and a shutter click on every cut, exactly where
   the cut is (the live preview can only click when a frame is drawn). */
export async function renderMix(cfg, cutsMs, totalMs, sampleRate = 48000) {
  const C = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const len = Math.ceil(totalMs / 1000 * sampleRate);
  const oc = new C(2, Math.max(1, len), sampleRate);
  if (A.buffer && cfg.musicVol > 0) {
    const g = oc.createGain(); g.connect(oc.destination);
    const end = totalMs / 1000, f = fadeS(cfg);
    g.gain.setValueAtTime(cfg.musicVol, 0);
    g.gain.setValueAtTime(cfg.musicVol, Math.max(0, end - f));
    g.gain.linearRampToValueAtTime(0, end);
    const s = oc.createBufferSource(); s.buffer = A.buffer; s.connect(g);
    if (cfg.musicOff < A.buffer.duration) s.start(0, cfg.musicOff);
  }
  if (cfg.sfx && cfg.sfxVol > 0) {
    const nb = noiseBuffer(oc);
    const g = oc.createGain(); g.gain.value = cfg.sfxVol * 0.5;
    const bp = oc.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 2400; bp.Q.value = 0.9;
    g.connect(bp); bp.connect(oc.destination);
    let last = -1e9;
    for (const t of cutsMs) { if (t - last < 24) continue; last = t; const s = oc.createBufferSource(); s.buffer = nb; s.connect(g); s.start(t / 1000); }
  }
  return oc.startRendering();
}
export const hasSound = (cfg) => !!(A.buffer && cfg.musicVol > 0) || !!cfg.sfx;
