/* ============================================================
   BURST//DUMP — following the song

   The planner behind the "follow the song" rhythm. It edits the way an
   editor cutting a montage to music does, rather than snapping cuts to
   whatever beat is nearest:

   1. Count in bars and phrases. Music is heard in groups of four bars, and
      a cut feels most natural on a bar line, best of all at the top of a
      phrase. Every section is split into 4-bar phrases from its first
      downbeat, and every cut is placed relative to those.

   2. One pace per phrase. Cutting on every beat because the grid allows
      it reads as mechanical; strong edits hold a steady pattern for a
      phrase and change pace where the music changes: a cut every four or
      two bars in a quiet intro, every bar or half bar in a verse, every
      beat or eighth in a chorus. The pace of a phrase is a power of two
      per bar, so the pattern always divides the bar evenly.

   3. Which beats, not just how many. Within a bar the cuts go where the
      song itself accents: the metrical hierarchy (beat 1, then 3, then 2
      and 4, then the "ands") plus the phrase's own groove, read off where
      its drum hits land and, in calm vocal passages, where the melody
      starts its notes. A backbeat song gets cuts on the snare; a dembow
      gets them on its 3+3+2.

   4. Builds accelerate, breaks hold, drops hit. A build doubles its pace
      bar by bar into the drop; the last half-bar before a chorus rolls; a
      bar where the music stops before a drop holds the photo still; the
      first downbeat of a chorus is always a cut, with the strongest photo
      nearby saved for it.

   5. Exactly N cuts. With a fixed length, the overall pace is searched
      (bisection on one gain, which raises or lowers every phrase together)
      for the most cuts that do not exceed the photos, and the few left over
      go in as pickups at the ends of phrases, the way a drummer fills. With
      "fit the photos" the song decides the pace and the reel ends at the
      end of the phrase where the photos run out.

   6. Picture slightly ahead of sound. People notice sound arriving before
      picture at ~45 ms but picture before sound only at ~125 ms (ITU-R
      BT.1359), and a flash with a click feels simultaneous when the flash
      leads by 10-40 ms. So every cut is put on the last video frame at or
      before the beat less LEAD_MS: on screen 8-25 ms early at 60 fps, never
      late.

   Pure: no DOM, so tools/validate.js runs it against songs whose bars,
   sections and drops are known.
   ============================================================ */

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;

export const LEAD_MS = 8;
const MIN_GAP_MS = 60;          // faster than ~16 cuts a second stops reading as photos
const TYPE_I = { low: 0.15, mid: 0.45, build: 0.55, peak: 0.9 };
// metrical weight of each sixteenth in a 4/4 bar: 1 > 3 > 2,4 > the ands > the e's and a's
const METER = [1, 0.2, 0.4, 0.2, 0.6, 0.2, 0.4, 0.2, 0.8, 0.2, 0.4, 0.2, 0.6, 0.2, 0.4, 0.2];
const metr = (p) => METER[p % 16] - (p >= 16 ? 0.05 : 0);

function curveMean(c, hop, s0, s1) {
  if (!c || !c.length) return 0;
  const i0 = clamp(Math.floor(s0 / hop), 0, c.length - 1), i1 = clamp(Math.ceil(s1 / hop), i0 + 1, c.length);
  let v = 0; for (let i = i0; i < i1; i++) v += c[i];
  return v / (i1 - i0);
}

/* ---------- bars, in timeline ms ---------- */
function makeBars(music, off) {
  const beats = music.beats.map((b) => ({ t: (b.t - off) * 1000, s: b.s, down: b.down }));
  const n = beats.length;
  if (n < 4) return [];
  const gaps = []; for (let i = 1; i < n; i++) gaps.push(beats[i].t - beats[i - 1].t);
  const g = gaps.slice().sort((a, b) => a - b)[gaps.length >> 1];
  // downbeat indices; with none marked, every fourth beat
  let downs = []; for (let i = 0; i < n; i++) if (beats[i].down) downs.push(i);
  if (downs.length < 2) { downs = []; for (let i = 0; i < n; i += 4) downs.push(i); }
  // extend before the first downbeat so a start inside the intro still has bars
  const pre = [];
  for (let t = beats[downs[0]].t - 4 * g; t > -4 * g; t -= 4 * g) pre.unshift(t);
  const bars = [];
  for (const t0 of pre) bars.push({ t0, beats: [t0, t0 + g, t0 + 2 * g, t0 + 3 * g], t1: t0 + 4 * g, synthetic: true });
  for (let k = 0; k < downs.length; k++) {
    const a = downs[k], b = k + 1 < downs.length ? downs[k + 1] : Math.min(n, a + 4);
    const bt = beats.slice(a, b).map((x) => x.t);
    while (bt.length < 4 && k + 1 >= downs.length) bt.push(bt[bt.length - 1] + g);   // close the last bar
    const t1 = k + 1 < downs.length ? beats[downs[k + 1]].t : bt[bt.length - 1] + g;
    bars.push({ t0: bt[0], beats: bt, t1 });
  }
  // a bar pre-dating the extension's overlap with the first real bar is dropped
  for (let i = bars.length - 1; i > 0; i--) if (bars[i - 1].t1 > bars[i].t0 + 1) bars.splice(i - 1, 1);
  return bars;
}
/* Time of sixteenth p inside bar b, interpolated within its beat so a
   rushing or dragging drummer is followed, not a metronome. */
function subTime(bar, p) {
  const nb = bar.beats.length, bi = Math.floor(p / 4), f = (p % 4) / 4;
  const a = bar.beats[bi], z = bi + 1 < nb ? bar.beats[bi + 1] : bar.t1;
  return a + (z - a) * f;
}

/* ---------- the plan for a window of bars ---------- */
function analyseBars(music, bars, off) {
  const c = music.curves, hop = c.hop;
  const sec = (music.sections || []).map((s) => ({ t0: (s.t0 - off) * 1000, t1: (s.t1 - off) * 1000, type: s.type, label: s.label }));
  const fills = (music.fills || []).map((f) => ({ t0: (f.t0 - off) * 1000, t1: (f.t1 - off) * 1000 }));
  const onsets = (music.onsets || []).map((o) => ({ t: (o.t - off) * 1000, s: o.s, kind: o.kind }));
  const notes = (music.notes || []).map((x) => ({ t: (x.t - off) * 1000, s: x.s == null ? 0.7 : x.s }));
  const KW = { kick: 1, snare: 1.1, hat: 0.55 };
  let oi = 0, ni = 0;
  for (const b of bars) {
    const s0 = off + b.t0 / 1000, s1 = off + b.t1 / 1000;
    b.E = curveMean(c.energy, hop, s0, s1);
    b.P = curveMean(c.percussive, hop, s0, s1);
    b.M = curveMean(c.melody, hop, s0, s1);
    const mid = (b.t0 + b.t1) / 2;
    b.sec = sec.find((s) => mid >= s.t0 && mid < s.t1) || sec.reduce((best, s) => (!best || Math.abs(s.t0 - mid) < Math.abs(best.t0 - mid) ? s : best), null);
    b.fill = fills.some((f) => f.t1 > b.t0 + 1 && f.t0 < b.t1 - 1);
    // groove: the strongest drum hit and the melody note starts near each sixteenth
    const P = b.beats.length * 4;
    b.drum = new Float32Array(P); b.note = new Float32Array(P);
    const tol = Math.min(45, (b.t1 - b.t0) / P * 0.45);
    while (oi < onsets.length && onsets[oi].t < b.t0 - tol) oi++;
    for (let i = oi; i < onsets.length && onsets[i].t < b.t1 + tol; i++) {
      const o = onsets[i];
      for (let p = 0; p < P; p++) if (Math.abs(subTime(b, p) - o.t) <= tol) b.drum[p] = Math.max(b.drum[p], o.s * (KW[o.kind] || 1));
    }
    while (ni < notes.length && notes[ni].t < b.t0 - tol) ni++;
    for (let i = ni; i < notes.length && notes[i].t < b.t1 + tol; i++) {
      const x = notes[i];
      for (let p = 0; p < P; p++) if (Math.abs(subTime(b, p) - x.t) <= tol) b.note[p] = Math.max(b.note[p], 0.4 + 0.6 * x.s);
    }
  }
  // section starts, and how far each bar is into its section
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i], prev = bars[i - 1];
    b.secStart = !prev || prev.sec !== b.sec;
    b.secIdx = b.secStart ? 0 : prev.secIdx + 1;
  }
  for (let i = bars.length - 1; i >= 0; i--) bars[i].secLen = i + 1 < bars.length && bars[i + 1].sec === bars[i].sec ? bars[i + 1].secLen : bars[i].secIdx + 1;
  // drops: the first bar of a chorus that follows something that is not one
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    b.drop = b.secStart && b.sec && b.sec.type === "peak" && i > 0 && bars[i - 1].sec && bars[i - 1].sec.type !== "peak";
  }
  /* breaks: the music stops for a bar or two right before it comes back in
     harder. Measured against what came before and what follows. */
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const before = bars.slice(Math.max(0, i - 4), i), after = bars.slice(i + 1, i + 3);
    if (!before.length || !after.length) continue;
    const eb = before.reduce((a, x) => a + x.E, 0) / before.length, ea = Math.max(...after.map((x) => x.E));
    const nextJump = after[0].drop || (after[0].secStart && after[0].sec && after[0].sec.type !== "low");
    if (b.E < 0.5 * eb && b.E < 0.6 * ea && nextJump && i + 1 < bars.length) b.brk = true;
  }
  for (let i = 0; i < bars.length; i++) if (bars[i].brk && !(bars[i + 1] && (bars[i + 1].brk || bars[i + 1].drop || bars[i + 1].secStart))) bars[i].brk = false;
  // intensity: what kind of section, how loud, how busy
  for (const b of bars) {
    const type = b.sec ? b.sec.type : "mid";
    let ti = TYPE_I[type] != null ? TYPE_I[type] : 0.45;
    if (type === "build") ti = lerp(0.5, 0.95, b.secLen > 1 ? b.secIdx / (b.secLen - 1) : 1);
    b.I = clamp(0.6 * ti + 0.25 * b.E + 0.15 * b.P, 0, 1);
  }
  // phrases: four bars from each section's first downbeat; a lone leftover bar joins the phrase before it
  const phrases = [];
  let cur = null;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (b.secStart || !cur || cur.bars.length === 4) {
      const left = b.secLen - b.secIdx;
      if (cur && !b.secStart && left === 1 && cur.bars.length === 4) { cur.bars.push(b); b.phrase = cur; continue; }
      cur = { bars: [] }; phrases.push(cur);
    }
    cur.bars.push(b); b.phrase = cur;
  }
  for (const ph of phrases) {
    // a bar where the band stops says nothing about the phrase's pace
    const live = ph.bars.filter((b) => !b.brk).length ? ph.bars.filter((b) => !b.brk) : ph.bars;
    ph.I = live.reduce((a, b) => a + b.I, 0) / live.length;
    ph.P = ph.bars.reduce((a, b) => a + b.P, 0) / ph.bars.length;
    ph.M = ph.bars.reduce((a, b) => a + b.M, 0) / ph.bars.length;
    ph.type = ph.bars[0].sec ? ph.bars[0].sec.type : "mid";
    ph.bars.forEach((b, k) => { b.pi = k; b.last = k === ph.bars.length - 1; });
    // the groove of the phrase, averaged over its bars
    const P = 16, gd = new Float32Array(P), gn = new Float32Array(P);
    for (const b of ph.bars) for (let p = 0; p < Math.min(P, b.drum.length); p++) { gd[p] += b.drum[p] / ph.bars.length; gn[p] += b.note[p] / ph.bars.length; }
    const wd = 0.35 + 0.65 * ph.P, wn = 0.9 * ph.M * (1 - 0.6 * ph.P);
    const mx = Math.max(1e-6, ...gd), mn = Math.max(1e-6, ...gn);
    ph.groove = Array.from({ length: P }, (_, p) => (wd * gd[p] / mx + wn * gn[p] / mn) / (wd + wn || 1));
  }
  /* the phrase that runs into a drop accelerates into it, whatever the
     section finder called it: editors step the cuts up bar by bar there */
  for (let k = 0; k + 1 < phrases.length; k++) if (phrases[k + 1].bars[0].drop) phrases[k].ramp = true;
  return phrases;
}

/* Positions (sixteenths) for r cuts in a bar of P sixteenths. The cuts keep
   an even spacing, one per slot, so a bar never bunches up; each slot may
   lean a sixteenth or two (a quarter of its spacing) towards where the
   phrase actually accents, a push onto the "and" or the "a" the way a
   drummer anticipates. The downbeat is always the first cut. */
export function positions(r, P, groove, lambda) {
  if (r >= P) return Array.from({ length: P }, (_, p) => p);
  const sp = P / r, h = Math.floor(sp / 4), out = [0];
  const score = (p) => metr(p) + lambda * (groove[p % 16] || 0);
  for (let j = 1; j < r; j++) {
    const c = Math.round(j * sp);
    let best = c, bs = score(c) + 1e-3;          // ties stay on the grid
    for (let p = c - h; p <= c + h; p++) {
      if (p <= out[out.length - 1] || p >= P) continue;
      const v = score(p); if (v > bs) { bs = v; best = p; }
    }
    out.push(best);
  }
  return out;
}

/* The level (log2 of cuts per bar) each bar plays at, for a given overall
   gain. -2 = a cut every four bars ... 4 = every sixteenth. */
function levels(phrases, gain) {
  for (const ph of phrases) {
    const x = 1 + 3.2 * (ph.I - 0.5) + gain;
    for (const b of ph.bars) {
      const dur = b.t1 - b.t0, P = b.beats.length * 4;
      /* The densest a bar may get also depends on how intense it is: a quiet
         intro at sixteenths reads as noise, not as a photo dump. With more
         photos than that allows, the reel shows an even sample instead of
         flattening every section to the same machine-gun pace. */
      const cap = Math.min(Math.log2(P), Math.floor(Math.log2(dur / MIN_GAP_MS)), Math.round(1.8 + 2.8 * b.I));
      let L;
      if (ph.type === "build" || ph.ramp) {
        // a build accelerates bar by bar, never slowing on the way up
        L = Math.round(1 + 3.2 * (b.I - 0.5) + gain + b.pi * 0.5);
        const prev = ph.bars[b.pi - 1];
        if (prev && prev.L != null && L < prev.L) L = prev.L;
      } else L = Math.round(x);
      b.L = clamp(L, -2, cap);
      b.cap = cap;
    }
  }
}

/* The cuts for a window of bars [0, nBars) at a gain. */
function cutsAt(phrases, bars, nBars, gain) {
  levels(phrases, gain);
  const out = [];
  for (let i = 0; i < nBars; i++) {
    const b = bars[i], ph = b.phrase;
    if (b.t1 <= 0) continue;
    const lambda = 0.6 + 0.6 * ph.P;
    const add = (p, kind, pri) => { const t = subTime(b, p); if (t >= -1) out.push({ mt: Math.max(0, t), bar: i, p, kind, pri, b }); };
    if (b.brk) continue;                                   // the music stopped: hold the picture
    let L = b.L;
    const forced = b.secStart || b.drop;
    if (L <= 0) {
      const every = 1 << -L;
      if (b.pi % every === 0 || forced) add(0, b.drop ? "drop" : b.secStart ? "section" : b.pi === 0 ? "phrase" : "down", 3);
    } else {
      const P = b.beats.length * 4;
      for (const p of positions(1 << L, P, ph.groove, lambda)) add(p, p === 0 ? (b.drop ? "drop" : b.secStart ? "section" : b.pi === 0 ? "phrase" : "down") : p % 4 === 0 ? "beat" : "off", p === 0 ? 3 : 1);
    }
    // the half bar before a drop rolls at twice the pace
    const next = bars[i + 1];
    if (next && (next.drop || (b.fill && next.secStart)) && b.last && !b.brk) {
      const P = b.beats.length * 4, r = Math.min(1 << (Math.max(L, 1) + 1), 1 << b.cap);
      for (const p of positions(r, P, ph.groove, lambda)) if (p >= P / 2 && !out.some((c) => c.bar === i && c.p === p)) add(p, "fill", 0.5);
    }
  }
  return out;
}

/* Next-level candidates for the few cuts left over after the gain search:
   pickups, weighted to the last bar of a phrase, the end of the bar, a real
   hit, and the busier phrases. */
function extras(bars, nBars, taken) {
  const have = new Set(taken.map((c) => c.bar + ":" + c.p)), out = [];
  for (let i = 0; i < nBars; i++) {
    const b = bars[i], ph = b.phrase;
    if (b.brk || b.t1 <= 0) continue;
    const P = b.beats.length * 4, r = Math.min(1 << Math.max(0, b.L + 1), 1 << b.cap);
    const cand = b.L < 0 ? [0] : positions(r, P, ph.groove, 0.6 + 0.6 * ph.P);
    for (const p of cand) {
      if (have.has(i + ":" + p)) continue;
      const t = subTime(b, p); if (t < 0) continue;
      const pri = 0.5 * ph.I + (b.last ? 0.6 : 0) + (p >= P - 4 ? 0.3 : 0) + 0.5 * (b.drum[p] || 0) + 0.02 * b.pi + metr(p) * 0.2;
      out.push({ mt: t, bar: i, p, kind: p === 0 ? "down" : "pickup", pri, b });
    }
  }
  return out.sort((a, b) => b.pri - a.pri);
}

function withGap(list, add, k) {
  const sorted = list.slice().sort((a, b) => a.mt - b.mt);
  const ts = sorted.map((c) => c.mt);
  let added = 0;
  for (const c of add) {
    if (added >= k) break;
    let lo = 0, hi = ts.length; while (lo < hi) { const m = (lo + hi) >> 1; if (ts[m] < c.mt) lo = m + 1; else hi = m; }
    if ((lo > 0 && c.mt - ts[lo - 1] < MIN_GAP_MS) || (lo < ts.length && ts[lo] - c.mt < MIN_GAP_MS)) continue;
    ts.splice(lo, 0, c.mt); sorted.splice(lo, 0, c); added++;
  }
  return sorted;
}

/* Exactly N cuts across bars [0, nBars): the largest gain that does not
   overshoot, then pickups for the rest. */
function solve(phrases, bars, nBars, N) {
  const count = (g) => cutsAt(phrases, bars, nBars, g).length;
  let lo = -8, hi = 6;
  if (count(hi) <= N) { const c = cutsAt(phrases, bars, nBars, hi); return { cuts: c.sort((a, b) => a.mt - b.mt), gain: hi, short: N - c.length }; }
  if (count(lo) > N) {
    // too few photos for this stretch even at a cut per phrase: keep the strongest
    const c = cutsAt(phrases, bars, nBars, lo).sort((a, b) => b.pri - a.pri || a.mt - b.mt).slice(0, N);
    return { cuts: c.sort((a, b) => a.mt - b.mt), gain: lo, short: 0 };
  }
  for (let it = 0; it < 24; it++) { const m = (lo + hi) / 2; if (count(m) <= N) lo = m; else hi = m; }
  const base = cutsAt(phrases, bars, nBars, lo);
  const cuts = withGap(base, extras(bars, nBars, base), N - base.length);
  return { cuts, gain: lo, short: 0 };
}

/* When each cut is shown: on the last video frame at or before its musical
   time less LEAD_MS (and the user's nudge), so the picture is never late.
   The first cut is the first frame. Shared by every music rhythm. */
export function present(mts, cfg) {
  const frame = 1000 / (cfg.fps || 60), nudge = cfg.syncNudge || 0, out = new Array(mts.length);
  let prev = -Infinity;
  for (let k = 0; k < mts.length; k++) {
    let t = Math.floor((mts[k] - LEAD_MS + nudge) / frame + 1e-6) * frame;
    if (k === 0) t = 0;
    if (t <= prev) t = prev + frame;
    out[k] = Math.max(0, t); prev = out[k];
  }
  return out;
}

/* ---------- the whole plan ---------- */
/* N photos; music: analysis; cfg: musicOff (s), lenMode "fit"|"fixed"|"song",
   durS, pace (-2..2), fps, syncNudge (ms). Returns null when the song has
   no bars to follow. */
export function plan(N, music, cfg) {
  if (!music || !music.beats || music.beats.length < 8 || N < 1) return null;
  const off = cfg.musicOff || 0;
  const bars = makeBars(music, off);
  const songEnd = (music.duration - off) * 1000;
  const usable = bars.filter((b) => b.t1 > 0 && b.t0 < songEnd - 1);
  if (usable.length < 2) return null;
  // the window starts at the first bar that reaches into the reel
  const first = bars.indexOf(usable[0]);
  const win = bars.slice(first);
  const phrases = analyseBars(music, win, off);
  const lastBar = win.findIndex((b) => b.t1 > songEnd + 1);
  const maxBars = lastBar < 0 ? win.length : Math.max(1, lastBar);
  const pace = clamp(cfg.pace || 0, -3, 3);

  let nBars, note = "", result;
  if (cfg.lenMode === "fixed") {
    // end on the bar line nearest the asked-for length
    const D = clamp(cfg.durS, 2, 600) * 1000;
    nBars = 1; let best = Infinity;
    for (let i = 1; i <= maxBars; i++) { const e = Math.abs(win[i - 1].t1 - D); if (e < best) { best = e; nBars = i; } }
    result = solve(phrases, win, nBars, N);
  } else if (cfg.lenMode === "song") {
    nBars = maxBars;
    result = solve(phrases, win, nBars, N);
  } else {
    /* fit the photos: the song sets the pace (shifted by the pace control);
       the reel runs until the photos are used up, then on to the end of
       that phrase. */
    const all = cutsAt(phrases, win, maxBars, pace).sort((a, b) => a.mt - b.mt);
    if (all.length >= N) {
      const at = all[N - 1].bar;
      const ph = win[at].phrase;
      nBars = win.indexOf(ph.bars[ph.bars.length - 1]) + 1;
      // a reel shorter than two bars is a flash, not an edit
      nBars = Math.max(nBars, Math.min(maxBars, 2));
    } else nBars = maxBars;
    result = solve(phrases, win, nBars, N);
  }
  if (result.short > 0) note = "surplus";
  // the reel ends on the bar line after the last bar
  const D = Math.min(win[nBars - 1].t1, Math.max(songEnd, win[0].t1));
  if (cfg.lenMode !== "fixed" && nBars === maxBars && N > result.cuts.length) note = "surplus";

  /* A reel that starts between bar lines still needs a photo on its first
     frame. Rather than drag the first musical cut back to 0, add a cut
     there and give up the weakest cut elsewhere, so the count stays N. */
  const frame = 1000 / (cfg.fps || 60);
  let cuts = result.cuts;
  if (cuts.length && cuts[0].mt > LEAD_MS + frame) {
    if (cuts.length >= N) {
      let wi = -1; for (let k = 1; k < cuts.length; k++) if (wi < 0 || cuts[k].pri < cuts[wi].pri) wi = k;
      if (wi > 0) cuts.splice(wi, 1);
    }
    cuts.unshift({ mt: 0, bar: cuts[0].bar, p: -1, kind: "start", pri: 0, b: win[0] });
  }
  const shown = present(cuts.map((c) => c.mt), cfg);
  cuts.forEach((c, k) => { c.t = shown[k]; });
  // style runs turn over on phrase lines, more often with chaos
  const every = (cfg.chaos || 0) >= 0.67 ? 1 : (cfg.chaos || 0) >= 0.34 ? 2 : 4;
  let lastBarSeen = -1;
  for (const c of cuts) {
    c.newRun = c.bar !== lastBarSeen && (c.b.pi === 0 || c.b.secStart || c.b.pi % every === 0);
    lastBarSeen = c.bar;
    c.sec = c.b.sec; c.I = c.b.I; c.phraseI = c.b.phrase.I;
  }
  return {
    cuts, D, note, gain: result.gain,
    bars: win.slice(0, nBars).map((b) => ({ t0: b.t0, t1: b.t1, L: b.L, brk: !!b.brk, drop: !!b.drop, I: b.I, type: b.sec ? b.sec.type : "mid", phraseStart: b.pi === 0 }))
  };
}

/* The best place to start a reel of lenS seconds: a section or phrase start
   whose window is loud, with a bonus for reaching a drop early, the way
   short-video apps open on the hook. Returns seconds. */
export function bestStart(music, lenS) {
  if (!music || !music.sections || !music.sections.length) return 0;
  const c = music.curves, hop = c.hop, dur = music.duration;
  const len = Math.min(lenS, dur);
  const bars = music.bars && music.bars.length ? music.bars : [];
  const cands = new Set(music.sections.map((s) => s.t0));
  for (const s of music.sections) {
    const inSec = bars.filter((t) => t >= s.t0 - 0.05 && t < s.t1 - 0.05);
    for (let i = 4; i < inSec.length; i += 4) cands.add(inSec[i]);
  }
  let best = 0, bestS = -Infinity;
  for (const s of cands) {
    if (s + len > dur + 0.01) continue;
    let score = curveMean(c.energy, hop, s, s + len);
    const drop = music.sections.find((x) => x.type === "peak" && x.t0 >= s && x.t0 <= s + len * 0.5);
    if (drop) score += 0.3 * (1 - (drop.t0 - s) / Math.max(1, len * 0.5)) + 0.1;
    if (music.sections.some((x) => Math.abs(x.t0 - s) < 0.05)) score += 0.05;
    if (score > bestS) { bestS = score; best = s; }
  }
  return best;
}
