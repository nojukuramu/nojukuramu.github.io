/* ============================================================
   BURST//DUMP — the edit

   A pure function from (photos, settings, song analysis) to a list of cuts,
   each with a style and its parameters. Seeded: the same seed and settings
   always give the same edit. No DOM, so tools/validate.js can run it.

   How music-driven cuts are placed
   --------------------------------
   The old engine had a separate algorithm per rhythm and bent each one
   toward the beat afterwards ("snap to the nearest onset within 35%"). Here
   every music rhythm is the same three steps:

     1. a grid of candidate cut times from the tracked beats: every bar,
        every beat, every eighth, sixteenth, ... down to what the frame rate
        can show
     2. a score for each candidate: coarser grid levels first, louder
        sections denser, a real drum hit or melody note on it worth more
     3. the N best, never closer than a minimum gap

   Taking the top N of one ranking is what makes the density follow the
   song: a chorus reaches eighths before a quiet verse has used every bar,
   and every cut still lands on the grid. With fewer photos the edit keeps
   the strong positions; with more it fills in the subdivisions.
   ============================================================ */

import { plan, present, LEAD_MS } from "./choreo.js";

export const STYLES = ["slam", "pile", "pop", "grid", "strip", "split", "stack", "echo", "slash", "bubble", "mirror", "punch", "quad", "bars", "tape", "xerox"];
export const MUSIC_RHYTHMS = ["song", "beat", "melody", "hits"];

export function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;

/* ---------- feel ---------- */
export function feelActive(cfg, music) { return !!(music && music.curves && cfg.feelOn && cfg.feelAmt > 0); }
export function feelWeights(cfg) {
  return {
    pace: clamp(cfg.feelAmt * cfg.feelPace, 0, 1),
    fx: clamp(cfg.feelAmt * cfg.feelFx, 0, 1),
    style: clamp(cfg.feelAmt * cfg.feelStyle, 0, 1),
    tex: clamp(cfg.feelAmt * cfg.feelTex, 0, 2)
  };
}
function curveAt(c, hop, trackS) {
  const n = c.length; if (!n) return 0;
  const x = trackS / hop, i0 = clamp(Math.floor(x), 0, n - 1), i1 = clamp(i0 + 1, 0, n - 1);
  return lerp(c[i0], c[i1], clamp(x - i0, 0, 1));
}
const scratch = { energy: 0, brightness: 0, percussive: 0, noisiness: 0, bass: 0, melody: 0 };
/* Feel at timeline time tMs. Returns a reused object: read it, do not keep it. */
export function feelAt(cfg, music, tMs) {
  if (!feelActive(cfg, music)) return null;
  const c = music.curves, s = cfg.musicOff + tMs / 1000;
  for (const k of ["energy", "brightness", "percussive", "noisiness", "bass", "melody"]) scratch[k] = curveAt(c[k], c.hop, s);
  return scratch;
}

/* ---------- song sections in timeline time ---------- */
export const SECTION_MOD = {
  low: { flashRun: 0.15, flashRand: 0.01, glitchP: 0.01, runScale: 1.6, stylePref: ["pile", "tape", "stack", "grid", "bubble", "pop"] },
  mid: { flashRun: 0.5, flashRand: 0.03, glitchP: 0.05, runScale: 1.0, stylePref: ["grid", "split", "bars", "pop", "stack", "quad"] },
  build: { flashRun: 0.6, flashRand: 0.04, glitchP: 0.06, runScale: 0.6, stylePref: ["strip", "bars", "split", "echo", "punch", "pop"] },
  peak: { flashRun: 0.8, flashRand: 0.08, glitchP: 0.12, runScale: 0.35, stylePref: ["slam", "punch", "xerox", "echo", "mirror", "slash", "quad", "strip"] }
};
const MOD_DEFAULT = { runScale: 1, flashRun: 0.5, flashRand: 0.03, glitchP: 0.05, styleFilter: null, stylePref: null, sectionKey: null };
const BRIGHT = ["xerox", "strip", "bars", "mirror", "echo", "punch"], DARK = ["pile", "tape", "stack", "pop", "grid"];
const TYPE_W = { low: 0.35, mid: 1, build: 1, peak: 2.2 };

export function mapSections(music, offS, D) {
  const secs = [], fills = [];
  if (!music) return { secs, fills };
  const off = offS * 1000;
  for (const s of music.sections || []) {
    const t0 = s.t0 * 1000 - off, t1 = s.t1 * 1000 - off;
    if (t1 <= 0 || t0 >= D) continue;
    secs.push({ t0: clamp(t0, 0, D), t1: clamp(t1, 0, D), type: s.type, label: s.label, intensity: s.intensity, feel: s.feel, rawT0: t0, rawT1: t1 });
  }
  for (const f of music.fills || []) {
    const t0 = f.t0 * 1000 - off, t1 = f.t1 * 1000 - off;
    if (t1 <= 0 || t0 >= D) continue;
    fills.push({ t0: clamp(t0, 0, D), t1: clamp(t1, 0, D) });
  }
  return { secs, fills };
}
function sectionAt(secs, t) {
  if (!secs.length) return null;
  let best = secs[0], bd = Infinity;
  for (const s of secs) {
    if (t >= s.t0 && t < s.t1) return s;
    const d = t < s.t0 ? s.t0 - t : t - s.t1;
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}
/* How much a moment wants cuts: the section's type, a build ramping up
   across its length, a fill wanting them most of all, bent by the energy
   curve when feel is on. */
function densityAt(t, map, cfg, music) {
  for (const f of map.fills) if (t >= f.t0 && t < f.t1) return 3.2;
  const s = sectionAt(map.secs, t);
  let w = 1;
  if (s) {
    w = TYPE_W[s.type] || 1;
    if (s.type === "build") w = lerp(0.7, 2.2, clamp((t - s.rawT0) / Math.max(1, s.rawT1 - s.rawT0), 0, 1));
  }
  const f = feelAt(cfg, music, t);
  if (f) w = lerp(w, lerp(0.4, 2.4, f.energy), feelWeights(cfg).pace);
  return w;
}

/* ---------- the grid ---------- */
/* Beats in timeline ms, extended at both ends with the median spacing so
   the grid covers [0, D] even where the tracker trimmed a quiet intro. */
export function timelineBeats(music, cfg, D) {
  let src;
  if (music && music.beats && music.beats.length >= 4) {
    src = music.beats.map((b) => ({ t: (b.t - cfg.musicOff) * 1000, s: b.s, down: b.down }));
  } else {
    const iv = 60000 / clamp(cfg.bpm || 120, 40, 240);
    src = []; for (let k = 0; k * iv <= D + iv; k++) src.push({ t: k * iv, s: 0.5, down: k % 4 === 0 });
  }
  if (src.length < 2) return src;
  const gaps = []; for (let i = 1; i < src.length; i++) gaps.push(src[i].t - src[i - 1].t);
  gaps.sort((a, b) => a - b);
  const g = gaps[gaps.length >> 1];
  const out = src.filter((b) => b.t >= -g && b.t <= D + g);
  if (!out.length) return out;
  const downIdx = (arr) => arr.findIndex((b) => b.down);
  while (out[0].t > 0) {
    const di = downIdx(out);
    out.unshift({ t: out[0].t - g, s: 0.3, down: di >= 0 ? (di + 1) % 4 === 0 : false, x: true });
  }
  while (out[out.length - 1].t < D) {
    const last = out.length - 1, di = (() => { for (let i = last; i >= 0; i--) if (out[i].down) return i; return -1; })();
    out.push({ t: out[last].t + g, s: 0.3, down: di >= 0 ? (last + 1 - di) % 4 === 0 : false, x: true });
  }
  return out;
}

function accentAt(onsets, t, win) {
  // onsets sorted; binary search the first >= t-win
  let lo = 0, hi = onsets.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (onsets[m].t < t - win) lo = m + 1; else hi = m; }
  let a = 0;
  for (let i = lo; i < onsets.length && onsets[i].t <= t + win; i++) a = Math.max(a, onsets[i].s);
  return a;
}
// van der Corput: spreads a partially used grid level evenly instead of front-loading it
function vdc(n) { let v = 0, d = 1; while (n) { d *= 2; v += (n & 1) / d; n >>= 1; } return v; }

function gridCandidates(beats, D, minGap, maxLevel) {
  const out = [];
  for (let i = 0; i < beats.length - 1; i++) {
    const a = beats[i], b = beats[i + 1], gap = b.t - a.t;
    if (a.t >= 0 && a.t < D) out.push({ t: a.t, level: a.down ? 0 : 1, bi: i });
    for (let L = 2; L <= maxLevel; L++) {
      const parts = 1 << (L - 1), step = gap / parts;
      if (step < minGap) break;
      for (let j = 1; j < parts; j += 2) { const t = a.t + j * step; if (t >= 0 && t < D) out.push({ t, level: L, bi: i, j }); }
    }
  }
  return out;
}

/* Greedy top-N under a minimum spacing. `cands` must carry .score. */
function selectTop(cands, N, minGap) {
  const order = cands.slice().sort((a, b) => b.score - a.score || a.t - b.t);
  const taken = [];
  for (const c of order) {
    if (taken.length >= N) break;
    let lo = 0, hi = taken.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (taken[m].t < c.t) lo = m + 1; else hi = m; }
    if ((lo > 0 && c.t - taken[lo - 1].t < minGap) || (lo < taken.length && taken[lo].t - c.t < minGap)) continue;
    taken.splice(lo, 0, c);
  }
  return taken;
}

const RH_THRESH = { beat: 0.5, song: 0.3, melody: 0.5, hits: 0.5 };

function musicCuts(N, D, cfg, music, map, songLen) {
  // two and a half frames: still apart once both are moved onto the frame grid
  const minGap = Math.max(40, 1000 / (cfg.fps || 60) * 2.5);
  const beats = timelineBeats(music, cfg, D);
  if (beats.length < 2) return null;
  const rh = cfg.rhythm;
  const onsets = music ? music.onsets.map((o) => ({ t: (o.t - cfg.musicOff) * 1000, s: o.s, kind: o.kind })).filter((o) => o.t >= 0 && o.t < D) : [];
  const grid = gridCandidates(beats, D, minGap, 7);
  const levelCount = {};
  for (const g of grid) {
    const acc = onsets.length ? accentAt(onsets, g.t, 45) : 0;
    const k = levelCount[g.level] = (levelCount[g.level] || 0) + 1;
    const tie = vdc(k) * 1e-3;
    if (rh === "beat") g.score = Math.pow(2, -g.level) * (1 + 0.6 * acc) + tie;
    else {
      const w = densityAt(g.t, map, cfg, music);
      g.score = w * Math.pow(2, -g.level) * (1 + 0.35 * acc) * (rh === "song" ? 1 : 0.45) + tie;
    }
  }
  let cands = grid;
  if (rh === "melody" && music && music.notes && music.notes.length) {
    const notes = music.notes.map((n) => ({ t: (n.t - cfg.musicOff) * 1000, s: n.s, kind: "note", level: 1 })).filter((n) => n.t >= 0 && n.t < D);
    for (const n of notes) n.score = 1.6 * (0.4 + 0.6 * n.s) * Math.sqrt(densityAt(n.t, map, cfg, music));
    cands = grid.concat(notes);
  } else if (rh === "hits" && onsets.length) {
    const KW = { kick: 1.3, snare: 1.2, hat: 0.75 };
    const hits = onsets.map((o) => ({ t: o.t, kind: o.kind, level: 1, score: 1.4 * (KW[o.kind] || 1) * o.s * Math.sqrt(densityAt(o.t, map, cfg, music)) }));
    cands = grid.concat(hits);
  }
  cands.push({ t: 0, level: 0, score: Infinity });     // the first photo is on screen from the first frame

  let note = "", count = N, Dout = D;
  if (songLen) {
    const ideal = selectTop(cands.filter((c) => c.score >= RH_THRESH[rh]), Infinity, minGap);
    const M = ideal.length;
    if (N >= M) count = Math.min(N, 2 * M);
    else if (N * 2 < M) {
      // too few photos to cover the song at its pace: end early, on a bar
      const cut = ideal[N];
      const bar = beats.find((b) => b.down && b.t >= cut.t);
      Dout = clamp(bar ? bar.t : cut.t, ideal[N - 1].t + minGap, D);
      note = "short";
      return { times: ideal.slice(0, N).map((p) => p.t), D: Dout, note, beats, picks: ideal.slice(0, N) };
    }
  }
  const picks = selectTop(cands, count, minGap);
  if (picks.length < N) note = "surplus";
  return { times: picks.map((p) => p.t), D: Dout, note, beats, picks };
}

/* ---------- layout helpers (unchanged from the first version) ---------- */
const MAX_RUN = 32;
function sampleRunLen(rng, cfg, st, scale) {
  let base;
  if (cfg.runMode === "perStyle") { base = (cfg.styleRun[st] || 6) * (1 + (rng() - 0.5) * 0.5 * cfg.chaos); }
  else base = lerp(18, 4, cfg.chaos) + rng() * lerp(14, 4, cfg.chaos);
  return clamp(Math.round(base * (scale == null ? 1 : scale)), 1, MAX_RUN);
}
function makeGrid(rng, W, H) {
  const port = H >= W;
  const cols = port ? (rng() < 0.5 ? 2 : 3) : (rng() < 0.5 ? 3 : 4);
  const rows = clamp(Math.round(cols * H / W), 2, 5);
  const cells = []; for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push({ c, r });
  for (let i = cells.length - 1; i > 0; i--) { const j = rng() * (i + 1) | 0; [cells[i], cells[j]] = [cells[j], cells[i]]; }
  return { cols, rows, cells };
}
function makeSplit(rng, W, H) {
  const rects = [{ x: 0, y: 0, w: 1, h: 1 }];
  const M = 3 + (rng() * 3 | 0);
  while (rects.length < M) {
    let bi = 0, ba = -1;
    for (let i = 0; i < rects.length; i++) { const a = rects[i].w * rects[i].h; if (a > ba) { ba = a; bi = i; } }
    const r = rects[bi], ratio = 0.35 + rng() * 0.30, vertical = r.w * W > r.h * H;
    const a = vertical ? { x: r.x, y: r.y, w: r.w * ratio, h: r.h } : { x: r.x, y: r.y, w: r.w, h: r.h * ratio };
    const b = vertical ? { x: r.x + r.w * ratio, y: r.y, w: r.w * (1 - ratio), h: r.h } : { x: r.x, y: r.y + r.h * ratio, w: r.w, h: r.h * (1 - ratio) };
    rects.splice(bi, 1, a, b);
  }
  for (let i = rects.length - 1; i > 0; i--) { const j = rng() * (i + 1) | 0; [rects[i], rects[j]] = [rects[j], rects[i]]; }
  return { rects };
}
export function enabledStyles(cfg) { const s = STYLES.filter((k) => cfg.styles[k]); return s.length ? s : ["slam"]; }

/* ---------- hero shots ---------- */
/* The strongest photos near a big moment are moved onto it: a drop first,
   then the start of each chorus, then chorus phrases. Only within a few
   places of where the photo already was, so a chronological dump stays
   chronological to the eye. photos[i].impact comes from js/photos.js. */
const HERO_WINDOW = 6;
function heroSwap(meta, order, photos) {
  if (!photos.length || photos[0].impact == null) return;
  const rank = (c) => (c.kind === "drop" ? 3 : c.kind === "section" && c.sec && c.sec.type === "peak" ? 2 : c.kind === "phrase" && c.sec && c.sec.type === "peak" ? 1 : 0);
  const heroes = meta.map((c, k) => ({ k, r: rank(c) })).filter((h) => h.r > 0).sort((a, b) => b.r - a.r || a.k - b.k);
  const locked = new Uint8Array(order.length);
  for (const { k } of heroes.slice(0, Math.max(1, Math.floor(order.length / 8)))) {
    if (locked[k]) continue;
    let best = k;
    for (let j = Math.max(0, k - HERO_WINDOW); j <= Math.min(order.length - 1, k + HERO_WINDOW); j++) {
      if (!locked[j] && photos[order[j]].impact > photos[order[best]].impact + 0.05) best = j;
    }
    [order[k], order[best]] = [order[best], order[k]];
    locked[k] = 1;
  }
}

/* ---------- the edit ---------- */
/* photos: [{ar}], cfg: settings, music: analysis result or null,
   canvas: {w,h}. Returns {events, D, note, map, beats}. */
export function buildTimeline(photos, cfg, music, canvas) {
  const N = photos.length;
  const out = { events: [], D: 0, note: "", map: { secs: [], fills: [] }, beats: [], cuts: 0 };
  if (!N) return out;
  const rng = mulberry32(cfg.seed);
  let rh = cfg.rhythm;
  const hasTrack = !!(music && music.duration > 0);
  const hasBeats = hasTrack && music.beats && music.beats.length >= 4;
  if ((rh === "song" || rh === "melody" || rh === "hits") && !hasBeats) rh = hasTrack ? "uniform" : "accel";
  const songLen = MUSIC_RHYTHMS.includes(rh) && hasBeats && cfg.lenMode === "song";
  let D = songLen ? Math.max(1000, (music.duration - cfg.musicOff) * 1000) : clamp(cfg.durS, 2, 90) * 1000;
  let times = [], photoIdx = null, meta = null, mts = null;

  const pl = rh === "song" && hasBeats ? plan(N, music, cfg) : null;
  if (pl) {
    // follow the song: js/choreo.js plans the cuts bar by bar
    meta = pl.cuts; times = meta.map((c) => c.t); D = Math.max(pl.D, times[times.length - 1] + 1); out.note = pl.note; out.plan = pl.bars;
    if (times.length < N) { const C = times.length; photoIdx = times.map((_, k) => Math.min(N - 1, Math.floor(k * N / C))); }
  }
  else if (rh === "uniform") for (let i = 0; i < N; i++) times.push(i * D / N);
  else if (rh === "accel") for (let i = 0; i < N; i++) times.push(D * Math.pow(i / N, 1 / cfg.accel));
  else if (rh === "decel") for (let i = 0; i < N; i++) times.push(D * Math.pow(i / N, cfg.accel));
  else if (rh === "random") { const g = D / N; for (let i = 0; i < N; i++) times.push(clamp(i * g + (rng() * 2 - 1) * g * 0.45, 0, D - 1)); times.sort((a, b) => a - b); times[0] = 0; }
  else if (rh === "bursts") {
    const sizes = []; let left = N;
    while (left > 0) { const s = Math.min(left, Math.max(3, Math.round(cfg.cluster * (0.6 + rng() * 0.8)))); sizes.push(s); left -= s; }
    let fast = clamp(D * 0.38 / N, 26, 90); if (N * fast > D * 0.92) fast = D * 0.92 / N;
    const pause = Math.max(0, (D - N * fast) / Math.max(1, sizes.length - 1));
    let t = 0;
    for (const s of sizes) { for (let k = 0; k < s; k++) { times.push(t); t += fast * (0.85 + rng() * 0.3); } t += pause * (0.7 + rng() * 0.6); }
    const sc = (D - 1) / Math.max(times[times.length - 1], 1); if (sc < 1) times = times.map((x) => x * sc);
  } else {
    const map = mapSections(hasTrack ? music : null, cfg.musicOff, D);
    const mc = musicCuts(N, D, Object.assign({}, cfg, { rhythm: rh }), hasBeats ? music : null, map, songLen);
    if (mc) {
      mts = mc.times; times = present(mts, cfg); D = Math.max(mc.D, times[times.length - 1] + 1); out.note = mc.note; out.beats = mc.beats.filter((b) => b.t >= 0 && b.t < D);
      if (times.length < N) { const C = times.length; photoIdx = times.map((_, k) => Math.min(N - 1, Math.floor(k * N / C))); }
    } else for (let i = 0; i < N; i++) times.push(i * D / N);
  }
  if (hasTrack) {
    out.map = mapSections(music, cfg.musicOff, D);
    if (!out.beats.length && hasBeats) out.beats = timelineBeats(music, cfg, D).filter((b) => b.t >= 0 && b.t < D);
  }
  // the beat pulse leads its beat by the same margin the cuts do
  const musicBeats = out.beats;
  if (MUSIC_RHYTHMS.includes(rh)) { const sh = (cfg.syncNudge || 0) - LEAD_MS; out.beats = out.beats.map((b) => Object.assign({}, b, { t: b.t + sh })); }
  const map = out.map;
  const sectional = MUSIC_RHYTHMS.includes(rh) && rh !== "beat" && map.secs.length > 0;
  const fa = feelActive(cfg, music), fw = feelWeights(cfg);

  // melody lift: the range of the lead line, so a high note sits high on screen
  let pLo = 0, pHi = 0;
  if (hasTrack && music.pitch && cfg.melodyLift > 0) {
    const v = Array.from(music.pitch).filter((x) => x > 0).sort((a, b) => a - b);
    if (v.length > 20) { pLo = v[Math.floor(v.length * 0.1)]; pHi = v[Math.floor(v.length * 0.9)]; }
  }
  const pitchAt = (t) => { if (!(pHi > pLo)) return -1; const p = curveAt(music.pitch, music.curves.hop, cfg.musicOff + t / 1000); return p > 0 ? clamp((p - pLo) / (pHi - pLo), 0, 1) : -1; };
  const isDown = (t) => { for (const b of musicBeats) { if (Math.abs(b.t - t) < 2) return b.down; if (b.t > t + 2) break; } return false; };

  const modAt = (t) => {
    let m = MOD_DEFAULT;
    if (sectional) {
      let fill = null; for (const f of map.fills) if (t >= f.t0 && t <= f.t1) { fill = f; break; }
      if (fill) {
        const pref = ["slam", "punch"].filter((s) => cfg.styles[s]);
        m = { runScale: 0.1, flashRun: 1, flashRand: 0.3, glitchP: 0.15, styleFilter: pref.length ? pref : null, stylePref: null, sectionKey: "fill@" + fill.t0 };
      } else {
        const s = sectionAt(map.secs, t), sm = SECTION_MOD[s.type] || SECTION_MOD.mid;
        const pref = sm.stylePref.filter((x) => cfg.styles[x]);
        m = { runScale: sm.runScale, flashRun: sm.flashRun, flashRand: sm.flashRand, glitchP: sm.glitchP, styleFilter: null, stylePref: pref.length ? pref : null, sectionKey: s.type + "@" + s.t0 };
      }
    }
    if (!fa) return m;
    const f = feelAt(cfg, music, t);
    m = Object.assign({}, m);
    m.runScale = lerp(m.runScale, lerp(1.7, 0.35, f.energy), fw.pace);
    m.flashRun = lerp(m.flashRun, lerp(0.15, 0.85, f.percussive), fw.fx);
    m.flashRand = lerp(m.flashRand, lerp(0.01, 0.09, f.percussive), fw.fx);
    m.glitchP = lerp(m.glitchP, lerp(0.01, 0.14, Math.max(f.percussive, f.noisiness * 0.85)), fw.fx);
    if (!m.styleFilter) {
      const set = f.brightness >= 0.65 ? BRIGHT : f.brightness <= 0.35 ? DARK : null;
      if (set) { const c = set.filter((s) => cfg.styles[s]); if (c.length && rng() < 0.6 * fw.style) m.stylePref = c; }
    }
    return m;
  };

  /* --- styles & parameters --- */
  const styles = enabledStyles(cfg);
  const W = canvas.w, H = canvas.h;
  let run = 0, st = null, grid = null, gPtr = 0, pileCount = 0, sinceCover = 99;
  let splitL = null, sPtr = 0, stackCount = 0, slashCount = 0, bubCount = 0, tapeCount = 0, runKey = null;
  const music1 = MUSIC_RHYTHMS.includes(rh);
  const order = photoIdx ? photoIdx.slice() : times.map((_, k) => k);
  if (meta && cfg.hero !== false) heroSwap(meta, order, photos);
  const loud = ["slam", "punch", "xerox"].filter((x) => cfg.styles[x]);
  for (let k = 0; k < times.length; k++) {
    const t = times[k], m = meta && meta[k], mt = m ? m.mt : mts ? mts[k] : t;
    let mod = modAt(mt);
    let boundary;
    if (m) {
      // runs turn over on the planner's phrase lines, and a drop opens on a full-frame hit
      boundary = k > 0 && m.newRun;
      if (boundary || k === 0) run = 0;
      if (m.kind === "drop" && loud.length) mod = Object.assign({}, mod, { styleFilter: loud });
    } else {
      boundary = sectional && runKey !== null && mod.sectionKey !== runKey;
      if (boundary) run = 0;
    }
    let runStart = false;
    if (run <= 0) {
      const prev = st;
      const pool = mod.stylePref && rng() < 0.75 ? mod.stylePref : styles;
      const rs = mod.styleFilter || pool;
      if (rs.length === 1) st = rs[0];
      else { let p; do { p = rs[rng() * rs.length | 0]; } while (p === prev && rng() < 0.7); st = p; }
      run = m ? 1e9 : sampleRunLen(rng, cfg, st, mod.runScale); runStart = true; runKey = mod.sectionKey;
      if (st === "grid") { grid = makeGrid(rng, W, H); gPtr = 0; const n = grid.cells.length; run = Math.max(n, Math.ceil(run / n) * n); }
      if (st === "pile") pileCount = 0;
      if (st === "split") { splitL = makeSplit(rng, W, H); sPtr = 0; const n = splitL.rects.length; run = Math.max(n, Math.ceil(run / n) * n); }
      if (st === "stack") stackCount = 0;
      if (st === "slash") slashCount = 0;
      if (st === "bubble") bubCount = 0;
      if (st === "tape") tapeCount = 0;
    }
    const pIdx = order[k];
    const ev = { t, i: pIdx, st, clear: false, covers: false, flash: false, glitch: false, pop: 0, ar: photos[pIdx].ar };
    if (st === "slam") { ev.fit = cfg.fit === "mix" ? (rng() < 0.72 ? "cover" : "contain") : cfg.fit; ev.covers = true; }
    else if (st === "pile") {
      if (runStart && (rng() < 0.55 || sinceCover > 40)) ev.clear = true;
      if (pileCount > 32) { ev.clear = true; pileCount = 0; }
      pileCount++; ev.pop = 90; ev.sc = 0.30 + rng() * 0.28; ev.x = 0.5 + (rng() - 0.5) * 0.72; ev.y = 0.5 + (rng() - 0.5) * 0.72; ev.rot = (rng() - 0.5) * 0.62;
    } else if (st === "pop") { ev.pop = 85; ev.sc = 0.46 + rng() * 0.36; ev.x = 0.5 + (rng() - 0.5) * 0.2; ev.y = 0.5 + (rng() - 0.5) * 0.2; ev.rot = (rng() - 0.5) * 0.12; }
    else if (st === "grid") {
      if (gPtr === 0) { grid = grid || makeGrid(rng, W, H); ev.clear = true; }
      ev.cell = grid.cells[gPtr]; ev.cols = grid.cols; ev.rows = grid.rows;
      gPtr = (gPtr + 1) % grid.cells.length; if (gPtr === 0) grid = makeGrid(rng, W, H);
    } else if (st === "strip") { ev.h = 0.16 + rng() * 0.2; ev.y = rng() * (1 - 0.16); }
    else if (st === "split") {
      if (sPtr === 0) { splitL = splitL || makeSplit(rng, W, H); ev.clear = true; }
      ev.rect = splitL.rects[sPtr]; sPtr = (sPtr + 1) % splitL.rects.length; if (sPtr === 0) splitL = makeSplit(rng, W, H);
    } else if (st === "stack") {
      if (runStart && (rng() < 0.4 || sinceCover > 40)) ev.clear = true;
      if (stackCount > 24) { ev.clear = true; stackCount = 0; }
      stackCount++; ev.pop = 90; ev.sc = 0.78 + rng() * 0.14; ev.x = 0.5 + (rng() - 0.5) * 0.10; ev.y = 0.5 + (rng() - 0.5) * 0.10; ev.rot = (rng() - 0.5) * 0.16;
    } else if (st === "echo") { ev.covers = true; ev.echoN = 2 + (rng() < 0.35 ? 1 : 0); ev.esc = 0.62 + rng() * 0.12; ev.ex = 0.5 + (rng() - 0.5) * 0.16; ev.ey = 0.5 + (rng() - 0.5) * 0.16; ev.erot = (rng() - 0.5) * 0.10; }
    else if (st === "slash") {
      if (runStart && rng() < 0.5) ev.clear = true;
      if (slashCount > 14) { ev.clear = true; slashCount = 0; }
      slashCount++; ev.ang = (rng() < 0.5 ? -1 : 1) * (0.35 + rng() * 0.35); ev.h = 0.18 + rng() * 0.14; ev.off = (rng() - 0.5) * 0.9;
    } else if (st === "bubble") {
      if (runStart && (rng() < 0.5 || sinceCover > 40)) ev.clear = true;
      if (bubCount > 20) { ev.clear = true; bubCount = 0; }
      bubCount++; ev.pop = 90; ev.r = 0.16 + rng() * 0.18; ev.x = 0.5 + (rng() - 0.5) * 0.8; ev.y = 0.5 + (rng() - 0.5) * 0.8; ev.ring = rng() < 0.6;
    } else if (st === "mirror") { ev.covers = true; const m = rng(); ev.mdir = m < 0.45 ? "v" : (m < 0.75 ? "h" : "q"); ev.msh = (rng() - 0.5) * 0.3; }
    else if (st === "punch") { ev.covers = true; ev.zs = 1.8 + rng() * 0.8; ev.zx = 0.2 + rng() * 0.6; ev.zy = 0.2 + rng() * 0.6; }
    else if (st === "quad") { ev.covers = true; ev.qflip = [rng() < 0.5, rng() < 0.5, rng() < 0.5, rng() < 0.5]; }
    else if (st === "bars") { ev.w = 0.14 + rng() * 0.12; ev.x = rng() * (1 - ev.w); }
    else if (st === "tape") {
      if (runStart && (rng() < 0.5 || sinceCover > 40)) ev.clear = true;
      if (tapeCount > 20) { ev.clear = true; tapeCount = 0; }
      tapeCount++; ev.pop = 90; ev.sc = 0.42 + rng() * 0.30; ev.x = 0.5 + (rng() - 0.5) * 0.5; ev.y = 0.5 + (rng() - 0.5) * 0.5; ev.rot = (rng() - 0.5) * 0.35;
    } else if (st === "xerox") ev.covers = true;

    // the lead line lifts placed prints: a high note sits high on the frame
    if (ev.y != null && (st === "pile" || st === "pop" || st === "tape" || st === "bubble" || st === "stack")) {
      const pn = pitchAt(mt);
      if (pn >= 0) ev.y = lerp(ev.y, lerp(0.8, 0.2, pn), clamp(cfg.melodyLift, 0, 1) * (st === "stack" || st === "pop" ? 0.5 : 1));
    }
    if (k === 0) ev.clear = true;
    let flashP = mod.flashRand;
    if (music1 && (m ? m.kind === "phrase" || m.kind === "down" : isDown(mt))) flashP += 0.15 * (fa ? fw.fx : 0.5);
    ev.flash = (runStart && rng() < mod.flashRun) || rng() < flashP || (m ? m.kind === "drop" || m.kind === "section" : boundary);
    if (music1) ev.mt = mt;
    if (m) ev.kind = m.kind;
    if (k === 0) ev.flash = false;   // the first frame is the poster: never a white-out
    ev.glitch = rng() < mod.glitchP;
    sinceCover = (ev.clear || ev.covers) ? 0 : sinceCover + 1;
    if (sinceCover > 55) { ev.clear = true; sinceCover = 0; }
    out.events.push(ev); run--;
  }
  for (let k = 0; k < out.events.length; k++) out.events[k].hold = (k < out.events.length - 1 ? out.events[k + 1].t : D) - out.events[k].t;
  out.D = D;
  out.cuts = out.events.length;
  out.rhythm = rh;
  return out;
}
