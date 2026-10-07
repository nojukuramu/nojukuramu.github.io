/* ============================================================
   BURST//DUMP — listening to the song

   Everything the edit knows about a track comes out of `analyze()`: where
   the beats are, which of them start a bar, where the drums hit, what the
   lead line is singing, how the song is built, and how it feels from second
   to second. No DOM and no app state, so it runs the same in the analysis
   worker and under Node in tools/validate.js.

   Why not a neural model
   ----------------------
   The good learned beat and melody trackers (madmom's RNNs, BeatNet, Basic
   Pitch) are either Python only or need a multi-megabyte TensorFlow.js
   runtime plus weights fetched on first use, and take longer than the whole
   pipeline below on a phone. These are the classic MIR algorithms the
   learned ones are measured against, and on the steady-tempo music a photo
   dump is cut to they land within a frame or two:

     onsets    SuperFlux-style spectral flux on a log-mel spectrogram, with a
               frequency max-filter so vibrato does not read as a hit
     tempo     autocorrelation of that flux with a log-normal prior around
               120 BPM, scored with its own multiples against octave errors
     beats     Ellis' dynamic-programming tracker (what librosa ships): the
               best path through the flux that keeps a steady period
     bars      the beat phase where low-end hits and chord changes agree
     melody    harmonic-summation pitch salience over spectral peaks, linked
               into contours and voiced by salience (Melodia, simplified)
     sections  a bar-synchronous self-similarity matrix and Foote's
               checkerboard novelty, boundaries preferred on 4-bar phrases

   The old detector compared low-passed energy with its trailing average.
   That is an onset detector, not a beat tracker: it missed every beat
   without a kick, counted off-beat bass notes as beats, and read the tempo
   off the median gap between whatever it found.

   One streaming pass over the STFT computes everything per frame, so the
   full linear spectrogram is never held in memory.
   ============================================================ */

export const MIR_SR = 22050;
const NFFT = 2048, HOP = 512, NBIN = NFFT / 2 + 1;
const N_MEL = 64, N_MFCC = 13;
// pitch salience: 10-cent bins from A1 (55 Hz)
const SAL_REF = 55, SAL_BINS = 560;
const MEL_LO = 100, MEL_HI = 1250;   // where a lead line is looked for

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* ---------- small numeric helpers ---------- */
function makeFFT(n) {
  const bits = Math.round(Math.log2(n));
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) { let r = 0, x = i; for (let b = 0; b < bits; b++) { r = (r << 1) | (x & 1); x >>= 1; } rev[i] = r; }
  const cs = new Float64Array(n / 2), sn = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) { cs[i] = Math.cos(2 * Math.PI * i / n); sn[i] = -Math.sin(2 * Math.PI * i / n); }
  return function fft(re, im) {
    for (let i = 0; i < n; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const a = i + j, b = a + half;
          const tr = re[b] * cs[k] - im[b] * sn[k], ti = re[b] * sn[k] + im[b] * cs[k];
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        }
      }
    }
  };
}
function movingAverage(a, r) {
  const n = a.length, out = new Float32Array(n);
  let s = 0, lo = 0, hi = -1;
  for (let i = 0; i < n; i++) {
    const L = Math.max(0, i - r), H = Math.min(n - 1, i + r);
    while (hi < H) s += a[++hi];
    while (lo < L) s -= a[lo++];
    out[i] = s / (H - L + 1);
  }
  return out;
}
function percentile(a, p) {
  if (!a.length) return 0;
  const s = Float32Array.from(a).sort();
  return s[clamp(Math.floor((s.length - 1) * p), 0, s.length - 1)];
}
function pnorm(a, lo = 0.05, hi = 0.95) {
  const p0 = percentile(a, lo), p1 = percentile(a, hi), r = Math.max(1e-9, p1 - p0);
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = clamp((a[i] - p0) / r, 0, 1);
  return out;
}
function meanStd(a) {
  let m = 0; for (let i = 0; i < a.length; i++) m += a[i]; m /= Math.max(1, a.length);
  let v = 0; for (let i = 0; i < a.length; i++) v += (a[i] - m) * (a[i] - m);
  return [m, Math.sqrt(v / Math.max(1, a.length - 1))];
}
function median(arr) { if (!arr.length) return 0; const s = Array.from(arr).sort((a, b) => a - b); return s[s.length >> 1]; }
const hz2mel = (f) => 2595 * Math.log10(1 + f / 700);
const mel2hz = (m) => 700 * (Math.pow(10, m / 2595) - 1);

/* Triangular mel filters on magnitude, stored sparse (start bin + weights). */
function melBank(sr) {
  const lo = hz2mel(30), hi = hz2mel(Math.min(8000, sr / 2));
  const pts = []; for (let i = 0; i < N_MEL + 2; i++) pts.push(mel2hz(lo + (hi - lo) * i / (N_MEL + 1)) * NFFT / sr);
  const bank = [];
  for (let m = 0; m < N_MEL; m++) {
    const a = pts[m], b = pts[m + 1], c = pts[m + 2];
    const k0 = Math.max(1, Math.floor(a)), k1 = Math.min(NBIN - 1, Math.ceil(c));
    const w = new Float32Array(k1 - k0 + 1);
    for (let k = k0; k <= k1; k++) w[k - k0] = k <= b ? (k - a) / Math.max(1e-9, b - a) : (c - k) / Math.max(1e-9, c - b);
    for (let i = 0; i < w.length; i++) if (w[i] < 0) w[i] = 0;
    bank.push({ k0, w, hz: mel2hz(lo + (hi - lo) * (m + 1) / (N_MEL + 1)) });
  }
  return bank;
}

/* ---------- 1. the streaming pass ---------- */
function frameFeatures(mono, sr, progress) {
  const nFrames = Math.max(1, Math.ceil(mono.length / HOP));
  const fft = makeFFT(NFFT);
  const win = new Float32Array(NFFT);
  for (let i = 0; i < NFFT; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / NFFT);
  const bank = melBank(sr);
  const binHz = sr / NFFT;

  // chroma: each bin 55 Hz..2 kHz shares its power between its two nearest pitch classes
  const cLo = Math.ceil(55 / binHz), cHi = Math.min(NBIN - 1, Math.floor(2000 / binHz));
  const cPc = new Uint8Array(NBIN), cW = new Float32Array(NBIN);
  for (let k = cLo; k <= cHi; k++) {
    const m = 69 + 12 * Math.log2(k * binHz / 440), f = Math.floor(m);
    cPc[k] = ((f % 12) + 12) % 12; cW[k] = 1 - (m - f);
  }
  // DCT-II basis for MFCCs
  const dct = new Float32Array(N_MFCC * N_MEL);
  for (let c = 0; c < N_MFCC; c++) for (let m = 0; m < N_MEL; m++) dct[c * N_MEL + m] = Math.cos(Math.PI * c * (m + 0.5) / N_MEL);

  const logMel = new Float32Array(nFrames * N_MEL);
  const chroma = new Float32Array(nFrames * 12);
  const mfcc = new Float32Array(nFrames * N_MFCC);
  const rms = new Float32Array(nFrames), centroid = new Float32Array(nFrames);
  const flatness = new Float32Array(nFrames), bass = new Float32Array(nFrames);
  const cand = new Float32Array(nFrames * 6);           // up to 3 pitch candidates: [bin, salience] x3
  const harm = new Float32Array(nFrames);               // best salience / total peak amplitude

  const re = new Float32Array(NFFT), im = new Float32Array(NFFT), mag = new Float32Array(NBIN);
  const sal = new Float32Array(SAL_BINS);
  const pkF = new Float32Array(64), pkA = new Float32Array(64);
  let prevF = new Float32Array(64), prevN = 0, curF = new Float32Array(64);
  const half = NFFT / 2, pLo = Math.ceil(60 / binHz), pHi = Math.min(NBIN - 2, Math.floor(5000 / binHz));
  const h80 = []; for (let h = 1; h <= 8; h++) h80.push(Math.pow(0.8, h - 1));

  for (let t = 0; t < nFrames; t++) {
    const start = t * HOP - half;
    let e = 0;
    for (let i = 0; i < NFFT; i++) {
      const s = start + i, v = s >= 0 && s < mono.length ? mono[s] : 0;
      e += v * v; re[i] = v * win[i]; im[i] = 0;
    }
    rms[t] = Math.sqrt(e / NFFT);
    fft(re, im);
    let sumM = 0, sumMF = 0, sumP = 0, sumLn = 0, sumBass = 0, mx = 0;
    for (let k = 0; k < NBIN; k++) {
      const m = Math.sqrt(re[k] * re[k] + im[k] * im[k]); mag[k] = m;
      if (k === 0) continue;
      const p = m * m, f = k * binHz;
      sumM += m; sumMF += m * f; sumP += p; sumLn += Math.log(p + 1e-12);
      if (f < 150) sumBass += p;
      if (m > mx) mx = m;
    }
    centroid[t] = sumM > 1e-9 ? sumMF / sumM : 0;
    flatness[t] = Math.exp(sumLn / (NBIN - 1)) / (sumP / (NBIN - 1) + 1e-12);
    bass[t] = sumBass / (sumP + 1e-12);

    const mo = t * N_MEL;
    for (let b = 0; b < N_MEL; b++) {
      const { k0, w } = bank[b]; let s = 0;
      for (let i = 0; i < w.length; i++) s += w[i] * mag[k0 + i];
      logMel[mo + b] = Math.log10(1 + 100 * s);
    }
    const co = t * N_MFCC;
    for (let c = 0; c < N_MFCC; c++) { let s = 0; for (let m = 0; m < N_MEL; m++) s += dct[c * N_MEL + m] * logMel[mo + m]; mfcc[co + c] = s; }
    const ch = t * 12;
    for (let k = cLo; k <= cHi; k++) { const p = mag[k] * mag[k]; chroma[ch + cPc[k]] += p * cW[k]; chroma[ch + (cPc[k] + 1) % 12] += p * (1 - cW[k]); }

    /* Pitch salience. Peaks are found on the magnitude spectrum, refined by
       parabolic interpolation, and each one votes for every fundamental it
       could be a harmonic of. A peak that was not there a frame ago (a drum
       hit, a consonant) votes at half weight: a cheap stand-in for
       harmonic/percussive separation, which as median filtering would cost
       more than the rest of this pass together. */
    let np = 0;
    const thr = mx * 0.02;
    for (let k = pLo; k <= pHi; k++) {
      const m = mag[k];
      if (m < thr || m <= mag[k - 1] || m < mag[k + 1]) continue;
      const a = Math.log(mag[k - 1] + 1e-12), b = Math.log(m + 1e-12), c = Math.log(mag[k + 1] + 1e-12);
      const den = a - 2 * b + c, p = den !== 0 ? clamp(0.5 * (a - c) / den, -0.5, 0.5) : 0;
      const f = (k + p) * binHz, amp = Math.exp(b - 0.25 * (a - c) * p);
      if (np < 64) { pkF[np] = f; pkA[np] = amp; np++; }
      else { let mi = 0; for (let i = 1; i < 64; i++) if (pkA[i] < pkA[mi]) mi = i; if (amp > pkA[mi]) { pkF[mi] = f; pkA[mi] = amp; } }
    }
    // keep the 20 loudest
    if (np > 20) {
      const idx = Array.from({ length: np }, (_, i) => i).sort((x, y) => pkA[y] - pkA[x]).slice(0, 20);
      const F = idx.map((i) => pkF[i]), A = idx.map((i) => pkA[i]);
      for (let i = 0; i < 20; i++) { pkF[i] = F[i]; pkA[i] = A[i]; }
      np = 20;
    }
    sal.fill(0);
    let ampSum = 0;
    for (let i = 0; i < np; i++) {
      const f = pkF[i];
      let stable = 0.5;
      for (let j = 0; j < prevN; j++) if (Math.abs(prevF[j] - f) < f * 0.03) { stable = 1; break; }
      const a = Math.sqrt(pkA[i]) * stable;
      ampSum += a;
      curF[i] = f;
      for (let h = 1; h <= 8; h++) {
        const f0 = f / h;
        if (f0 < MEL_LO * 0.9) break;
        if (f0 > MEL_HI * 1.05) continue;
        const c = 120 * Math.log2(f0 / SAL_REF), cb = Math.round(c);
        const v = a * h80[h - 1];
        for (let d = -10; d <= 10; d++) {
          const bi = cb + d; if (bi < 0 || bi >= SAL_BINS) continue;
          const x = Math.cos(Math.PI * (bi - c) / 20);
          sal[bi] += v * x * x;
        }
      }
    }
    { const tmp = prevF; prevF = curF; curF = tmp; prevN = np; }
    // three best local maxima inside the melody range
    const b0 = Math.ceil(120 * Math.log2(MEL_LO / SAL_REF)), b1 = Math.min(SAL_BINS - 2, Math.floor(120 * Math.log2(MEL_HI / SAL_REF)));
    let c1 = -1, c2 = -1, c3 = -1;
    for (let b = b0; b <= b1; b++) {
      const v = sal[b];
      if (v <= 0 || v < sal[b - 1] || v <= sal[b + 1]) continue;
      if (c1 < 0 || v > sal[c1]) { c3 = c2; c2 = c1; c1 = b; }
      else if (c2 < 0 || v > sal[c2]) { c3 = c2; c2 = b; }
      else if (c3 < 0 || v > sal[c3]) c3 = b;
    }
    const co6 = t * 6;
    [c1, c2, c3].forEach((b, i) => {
      if (b < 0) return;
      const a = sal[b - 1], m = sal[b], c = sal[b + 1], den = a - 2 * m + c;
      cand[co6 + i * 2] = b + (den !== 0 ? clamp(0.5 * (a - c) / den, -0.5, 0.5) : 0);
      cand[co6 + i * 2 + 1] = m;
    });
    harm[t] = c1 >= 0 && ampSum > 0 ? sal[c1] / ampSum : 0;

    if (progress && (t & 511) === 0) progress(0.05 + 0.6 * t / nFrames);
  }
  return { nFrames, fps: sr / HOP, logMel, chroma, mfcc, rms, centroid, flatness, bass, cand, harm, bank };
}

/* ---------- 2. onsets ---------- */
/* SuperFlux: rise in log-mel energy against the previous frame after a
   3-band maximum filter across frequency, so a note bending by a semitone is
   not mistaken for a new one. Split into three bands as well, which is how a
   hit is later called a kick, a snare or a hat. */
function onsetEnvelopes(F) {
  const { nFrames, logMel, bank } = F;
  const all = new Float32Array(nFrames), low = new Float32Array(nFrames), mid = new Float32Array(nFrames), high = new Float32Array(nFrames);
  const band = bank.map((b) => (b.hz < 160 ? 0 : b.hz < 3000 ? 1 : 2));
  const mf = new Float32Array(N_MEL);
  for (let t = 1; t < nFrames; t++) {
    const p = (t - 1) * N_MEL, c = t * N_MEL;
    for (let b = 0; b < N_MEL; b++) mf[b] = Math.max(logMel[p + b], b > 0 ? logMel[p + b - 1] : 0, b < N_MEL - 1 ? logMel[p + b + 1] : 0);
    let s = 0, s0 = 0, s1 = 0, s2 = 0;
    for (let b = 0; b < N_MEL; b++) {
      const d = logMel[c + b] - mf[b];
      if (d > 0) { s += d; if (band[b] === 0) s0 += d; else if (band[b] === 1) s1 += d; else s2 += d; }
    }
    all[t] = s; low[t] = s0; mid[t] = s1; high[t] = s2;
  }
  return { all, low, mid, high };
}

/* Peak picking for individual hits: a local maximum that clears its local
   average by delta, at least ~70 ms after the last one. */
function pickOnsets(env, fps, F, bands) {
  const n = env.length;
  const p99 = Math.max(1e-9, percentile(env, 0.99));
  const o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = Math.min(1, env[i] / p99);
  const avg = movingAverage(o, Math.round(0.12 * fps));
  const wait = Math.max(1, Math.round(0.07 * fps));
  const out = [];
  let last = -wait;
  const zs = ["low", "mid", "high"].map((k) => { const [m, s] = meanStd(bands[k]); return [m, s || 1]; });
  for (let i = 2; i < n - 2; i++) {
    const v = o[i];
    if (v < avg[i] + 0.06 || v < 0.08) continue;
    if (v < o[i - 1] || v < o[i - 2] || v <= o[i + 1] || v < o[i + 2]) continue;
    if (i - last < wait) continue;
    const z = ["low", "mid", "high"].map((k, j) => (bands[k][i] - zs[j][0]) / zs[j][1]);
    const kind = z[0] >= z[1] && z[0] >= z[2] ? "kick" : z[1] >= z[2] ? "snare" : "hat";
    out.push({ t: i / fps, s: v, kind });
    last = i;
  }
  return out;
}

/* ---------- 3. tempo ---------- */
export function estimateTempo(env, fps) {
  const n = env.length;
  const [m] = meanStd(env);
  const o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = env[i] - m;
  const lagMin = Math.max(2, Math.floor(60 * fps / 260)), lagMax = Math.ceil(60 * fps / 50);
  const L = lagMax * 3 + 2;
  const ac = new Float32Array(L + 1);
  for (let lag = lagMin; lag <= L && lag < n - 1; lag++) {
    let s = 0; for (let i = 0; i + lag < n; i++) s += o[i] * o[i + lag];
    ac[lag] = s / (n - lag);
  }
  const at = (x) => { const i = Math.floor(x), f = x - i; return i + 1 <= L ? ac[i] * (1 - f) + ac[i + 1] * f : 0; };
  let best = -1, bestS = -Infinity;
  const score = new Float32Array(lagMax + 1);
  for (let lag = lagMin; lag <= lagMax; lag++) {
    const bpm = 60 * fps / lag;
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
    // a real beat period also repeats at twice and three times itself
    const s = (Math.max(0, ac[lag]) + 0.5 * Math.max(0, at(lag * 2)) + 0.25 * Math.max(0, at(lag * 3))) * prior;
    score[lag] = s;
    if (s > bestS) { bestS = s; best = lag; }
  }
  if (best < 0 || bestS <= 0) return { bpm: 0, period: 0, confidence: 0 };
  /* Octave: the autocorrelation alone cannot tell 70 from 140 when the
     kick plays every other beat. Of the family {P/2, P, 2P}, take the one in
     80-160 BPM unless another is supported half again as strongly. */
  const sup = (P) => Math.max(0, at(P)) + 0.5 * Math.max(0, at(2 * P));
  const fam = [best / 2, best, best * 2].filter((P) => { const b = 60 * fps / P; return b >= 50 && b <= 220 && P * 2 < L; });
  let pick = fam.find((P) => { const b = 60 * fps / P; return b >= 80 && b < 160; }) || best;
  for (const P of fam) if (P !== pick && sup(P) > 1.5 * sup(pick)) pick = P;
  let lag = pick;
  const li = Math.round(pick);
  if (li > lagMin && li < L - 1) {
    const a = sup(li - 1), b = sup(li), c = sup(li + 1), den = a - 2 * b + c;
    if (den !== 0) lag = li + clamp(0.5 * (a - c) / den, -0.5, 0.5);
  }
  const sorted = Array.from(score.slice(lagMin)).sort((a, b) => a - b);
  const med = sorted[sorted.length >> 1];
  return { bpm: 60 * fps / lag, period: lag, confidence: clamp((bestS - med) / (bestS + 1e-9), 0, 1) };
}

/* ---------- 4. beats ---------- */
/* Ellis (2007), as librosa implements it: every frame's best predecessor is
   one roughly a period back, scored by onset strength and a penalty on how
   far the gap strays from the period. Backtracking from the strongest late
   frame gives the beat sequence. */
export function trackBeats(env, fps, period, tightness = 100) {
  const n = env.length;
  if (!(period > 0) || n < period * 4) return [];
  const [, sd] = meanStd(env);
  const P = period, R = Math.round(P);
  const g = []; for (let k = -R; k <= R; k++) g.push(Math.exp(-0.5 * Math.pow(k * 32 / P, 2)));
  const local = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let k = -R; k <= R; k++) { const j = i + k; if (j >= 0 && j < n) s += env[j] * g[k + R]; } local[i] = s / (sd || 1); }
  const lo = Math.round(2 * P), hi = Math.max(1, Math.round(P / 2));
  const tx = []; for (let d = lo; d >= hi; d--) tx.push({ d, c: -tightness * Math.pow(Math.log(d / P), 2) });
  const cum = new Float32Array(n), back = new Int32Array(n).fill(-1);
  let mx = 0; for (let i = 0; i < n; i++) if (local[i] > mx) mx = local[i];
  const thresh = 0.01 * mx;
  let first = true;
  for (let i = 0; i < n; i++) {
    let bestV = -Infinity, bestJ = -1;
    for (const { d, c } of tx) { const j = i - d; if (j < 0) continue; const v = cum[j] + c; if (v > bestV) { bestV = v; bestJ = j; } }
    if (bestJ < 0 || (first && local[i] < thresh)) { cum[i] = local[i]; back[i] = -1; }
    else { cum[i] = local[i] + bestV; back[i] = bestJ; }
    if (first && local[i] >= thresh) first = false;
  }
  // last beat: the last local maximum of the cumulative score that is not weak
  const maxes = [];
  for (let i = 1; i < n - 1; i++) if (cum[i] > cum[i - 1] && cum[i] >= cum[i + 1]) maxes.push(i);
  if (!maxes.length) return [];
  const med = median(maxes.map((i) => cum[i]));
  let last = maxes[maxes.length - 1];
  for (let k = maxes.length - 1; k >= 0; k--) if (cum[maxes[k]] > 0.5 * med) { last = maxes[k]; break; }
  const beats = [last];
  while (back[beats[beats.length - 1]] >= 0) beats.push(back[beats[beats.length - 1]]);
  beats.reverse();
  // trim weak beats off both ends (silence before the music starts, a fade)
  const at = beats.map((b) => local[b]);
  const sm = at.map((_, i) => { let s = 0, w = 0; for (let k = -2; k <= 2; k++) { const j = i + k; if (j >= 0 && j < at.length) { const ww = 0.5 - 0.5 * Math.cos(Math.PI * (k + 3) / 3); s += at[j] * ww; w += ww; } } return s / w; });
  const th = 0.5 * Math.sqrt(sm.reduce((a, v) => a + v * v, 0) / sm.length);
  let a = 0, b = beats.length;
  while (a < b && sm[a] <= th) a++;
  while (b > a && sm[b - 1] <= th) b--;
  return beats.slice(a, b);
}

/* ---------- 5. bars ---------- */
/* Which beat of four starts a bar: the phase where low-end hits and chord
   changes both land. Assumes 4/4, which is nearly all of what gets cut into
   a photo dump. */
function barPhase(beatFrames, F, bands) {
  const nb = beatFrames.length;
  if (nb < 8) return { phase: 0, confidence: 0 };
  const lowAt = beatFrames.map((f) => { let m = 0; for (let k = -2; k <= 2; k++) { const j = f + k; if (j >= 0 && j < bands.low.length) m = Math.max(m, bands.low[j]); } return m; });
  const chromaOf = (f0, f1) => { const v = new Float32Array(12); for (let t = f0; t < f1; t++) for (let c = 0; c < 12; c++) v[c] += F.chroma[t * 12 + c]; let s = 0; for (let c = 0; c < 12; c++) s += v[c] * v[c]; s = Math.sqrt(s) || 1; for (let c = 0; c < 12; c++) v[c] /= s; return v; };
  const ch = beatFrames.map((f, i) => chromaOf(f, i + 1 < nb ? beatFrames[i + 1] : Math.min(F.nFrames, f + 20)));
  const change = ch.map((v, i) => { if (!i) return 0; let d = 0; for (let c = 0; c < 12; c++) d += v[c] * ch[i - 1][c]; return 1 - d; });
  const z = (a) => { const [m, s] = meanStd(a); return a.map((v) => (v - m) / (s || 1)); };
  const zl = z(lowAt), zc = z(change);
  const sc = [0, 0, 0, 0], cnt = [0, 0, 0, 0];
  for (let i = 1; i < nb; i++) { sc[i % 4] += zl[i] + 1.3 * zc[i]; cnt[i % 4]++; }
  for (let p = 0; p < 4; p++) sc[p] /= Math.max(1, cnt[p]);
  let best = 0; for (let p = 1; p < 4; p++) if (sc[p] > sc[best]) best = p;
  const others = sc.filter((_, p) => p !== best);
  return { phase: best, confidence: clamp((sc[best] - Math.max(...others)) / 1.5, 0, 1) };
}

/* ---------- 6. melody ---------- */
/* Candidates are linked frame to frame into pitch contours (a jump of more
   than ~80 cents, or a gap of more than three frames, ends one). Short and
   weak contours are dropped, and where two overlap the stronger one is the
   melody. What survives is segmented into notes. */
function trackMelody(F) {
  const { nFrames, cand, rms, harm, fps } = F;
  const loud = percentile(rms, 0.95) || 1e-9;
  const contours = [];
  let active = [];
  for (let t = 0; t < nFrames; t++) {
    if (rms[t] < loud * 0.04) { active = active.filter((c) => t - c.end <= 3); continue; }
    const cs = [];
    for (let i = 0; i < 3; i++) { const s = cand[t * 6 + i * 2 + 1]; if (s > 0) cs.push({ b: cand[t * 6 + i * 2], s }); }
    if (!cs.length) continue;
    const top = cs[0].s;
    const used = new Set();
    const next = [];
    for (const c of cs) {
      if (c.s < top * 0.5) continue;
      let bestC = null, bd = 9;
      for (const a of active) { if (used.has(a)) continue; const d = Math.abs(a.bins[a.bins.length - 1] - c.b); if (d < bd) { bd = d; bestC = a; } }
      if (bestC) { used.add(bestC); bestC.frames.push(t); bestC.bins.push(c.b); bestC.sal.push(c.s); bestC.end = t; next.push(bestC); }
      else { const nc = { frames: [t], bins: [c.b], sal: [c.s], end: t }; contours.push(nc); next.push(nc); used.add(nc); }
    }
    for (const a of active) if (!used.has(a) && t - a.end <= 3) next.push(a);
    active = next;
  }
  const minLen = Math.round(0.12 * fps);
  let kept = contours.filter((c) => c.frames.length >= minLen);
  for (const c of kept) { let s = 0; for (const v of c.sal) s += v; c.mean = s / c.sal.length; c.total = s; }
  if (kept.length) {
    const ms = kept.map((c) => c.mean), [m, sd] = meanStd(ms);
    kept = kept.filter((c) => c.mean >= m - 0.4 * sd);
  }
  // per frame, the strongest contour wins
  const f0 = new Float32Array(nFrames), own = new Float32Array(nFrames), sal = new Float32Array(nFrames);
  for (const c of kept) {
    const w = c.mean * Math.pow(c.frames.length, 0.3);
    for (let i = 0; i < c.frames.length; i++) { const t = c.frames[i]; if (w > own[t]) { own[t] = w; f0[t] = c.bins[i]; sal[t] = c.sal[i]; } }
  }
  // voicing: the frame has to look harmonic as well as belong to a contour
  const hv = []; for (let t = 0; t < nFrames; t++) if (f0[t] > 0) hv.push(harm[t]);
  const hThr = hv.length ? percentile(hv, 0.15) * 0.8 : 0;
  for (let t = 0; t < nFrames; t++) if (f0[t] > 0 && harm[t] < hThr) f0[t] = 0;

  // notes
  const notes = [];
  const salMax = percentile(sal, 0.98) || 1;
  let cur = null;
  const close = (endT) => {
    if (!cur) return;
    if (endT - cur.t0 >= Math.max(3, Math.round(0.07 * fps))) {
      const bins = cur.bins.slice().sort((a, b) => a - b), mb = bins[bins.length >> 1];
      notes.push({ t: cur.t0 / fps, d: (endT - cur.t0) / fps, midi: Math.round(33 + mb / 10), s: clamp(cur.s / cur.bins.length / salMax, 0, 1) });
    }
    cur = null;
  };
  for (let t = 0; t < nFrames; t++) {
    const b = f0[t];
    if (!b) { if (cur && t - cur.last > 2) close(cur.last + 1); continue; }
    if (cur) {
      const ref = cur.bins.slice(-5).sort((x, y) => x - y)[Math.min(2, cur.bins.length - 1) >> 0];
      const jump = Math.abs(b - ref) > 6 && (t + 1 >= nFrames || !f0[t + 1] || Math.abs(f0[t + 1] - ref) > 6);
      // the same pitch struck again: salience dips and comes back
      const reart = t - cur.t0 > 0.15 * fps && t >= 2 && sal[t] > 1.6 * Math.min(sal[t - 1], sal[t - 2]) && Math.min(sal[t - 1], sal[t - 2]) < 0.6 * cur.s / cur.bins.length;
      if (jump || reart) close(t);
    }
    if (!cur) cur = { t0: t, bins: [], s: 0, last: t };
    cur.bins.push(b); cur.s += sal[t]; cur.last = t;
  }
  if (cur) close(cur.last + 1);
  return { f0, notes };
}

/* ---------- 7. key ---------- */
const KK_MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MIN = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const NOTE = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
function estimateKey(F) {
  const g = new Float64Array(12);
  for (let t = 0; t < F.nFrames; t++) { let s = 0; for (let c = 0; c < 12; c++) s += F.chroma[t * 12 + c]; if (s <= 0) continue; for (let c = 0; c < 12; c++) g[c] += F.chroma[t * 12 + c] / s * F.rms[t]; }
  const corr = (x, y) => { const mx = x.reduce((a, b) => a + b) / 12, my = y.reduce((a, b) => a + b) / 12; let n = 0, dx = 0, dy = 0; for (let i = 0; i < 12; i++) { n += (x[i] - mx) * (y[i] - my); dx += (x[i] - mx) ** 2; dy += (y[i] - my) ** 2; } return n / Math.sqrt(dx * dy || 1); };
  let best = null;
  for (let r = 0; r < 12; r++) for (const [prof, mode] of [[KK_MAJ, "major"], [KK_MIN, "minor"]]) {
    const rot = Array.from({ length: 12 }, (_, i) => prof[(i - r + 12) % 12]);
    const c = corr(Array.from(g), rot);
    if (!best || c > best.c) best = { c, name: NOTE[r] + (mode === "minor" ? "m" : ""), mode, root: r };
  }
  return best && best.c > 0.3 ? { name: best.name, mode: best.mode, root: best.root, confidence: clamp(best.c, 0, 1) } : null;
}

/* ---------- 8. structure ---------- */
function structure(F, beatsF, phase, onsets, duration, loudDb) {
  const fps = F.fps;
  // bars: from the downbeats if there is a beat, else fixed 2 s blocks
  let barF = [];
  if (beatsF.length >= 16) {
    for (let i = phase; i < beatsF.length; i += 4) barF.push(beatsF[i]);
    const last = beatsF.length - 1;
    const per = barF.length > 1 ? (barF[barF.length - 1] - barF[0]) / (barF.length - 1) : 4 * (beatsF[last] - beatsF[0]) / last;
    barF.push(Math.min(F.nFrames, Math.round(barF[barF.length - 1] + per)));
  } else {
    const step = Math.round(2 * fps); for (let f = 0; f < F.nFrames; f += step) barF.push(f); barF.push(F.nFrames);
  }
  const B = barF.length - 1;
  if (B < 4) return { sections: [{ t0: 0, t1: duration, type: "mid", label: "A", intensity: 0.5 }], fills: [], bars: barF.map((f) => f / fps) };

  const oT = onsets.map((o) => o.t * fps);
  const feat = [];
  for (let i = 0; i < B; i++) {
    const f0 = barF[i], f1 = Math.max(f0 + 1, barF[i + 1]);
    const c = new Float32Array(12), m = new Float32Array(N_MFCC - 1);
    let l = 0;
    for (let t = f0; t < f1; t++) {
      for (let k = 0; k < 12; k++) c[k] += F.chroma[t * 12 + k];
      for (let k = 1; k < N_MFCC; k++) m[k - 1] += F.mfcc[t * N_MFCC + k];
      l += loudDb[t];
    }
    let s = 0; for (let k = 0; k < 12; k++) s += c[k] * c[k]; s = Math.sqrt(s) || 1; for (let k = 0; k < 12; k++) c[k] /= s;
    for (let k = 0; k < m.length; k++) m[k] /= (f1 - f0);
    let dens = 0; for (const t of oT) if (t >= f0 && t < f1) dens++;
    feat.push({ c, m, l: l / (f1 - f0), dens: dens / ((f1 - f0) / fps) });
  }
  // z-score the timbre dimensions so no single coefficient dominates
  for (let k = 0; k < N_MFCC - 1; k++) {
    const [mm, sd] = meanStd(feat.map((f) => f.m[k]));
    for (const f of feat) f.m[k] = (f.m[k] - mm) / (sd || 1);
  }
  const cos = (a, b) => { let d = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return d / Math.sqrt(na * nb || 1); };
  const simOf = (a, b) => 0.4 * cos(a.c, b.c) + 0.35 * (cos(a.m, b.m) + 1) / 2 + 0.25 * Math.exp(-Math.abs(a.l - b.l) / 6);
  const S = new Float32Array(B * B);
  for (let i = 0; i < B; i++) for (let j = i; j < B; j++) { const v = simOf(feat[i], feat[j]); S[i * B + j] = v; S[j * B + i] = v; }

  // Foote novelty: a checkerboard kernel slid down the diagonal
  const w = B >= 24 ? 4 : 2;
  const nov = new Float32Array(B);
  for (let i = 1; i < B; i++) {
    let s = 0, ws = 0;
    for (let a = -w; a < w; a++) for (let b = -w; b < w; b++) {
      const x = i + a, y = i + b; if (x < 0 || y < 0 || x >= B || y >= B) continue;
      const gw = Math.exp(-((a + 0.5) ** 2 + (b + 0.5) ** 2) / (2 * (w * 0.6) ** 2));
      const sg = ((a < 0) === (b < 0)) ? 1 : -1;
      s += sg * gw * S[x * B + y]; ws += gw;
    }
    // a step in loudness is a boundary even where the harmony carries on
    const prevL = feat.slice(Math.max(0, i - 2), i).reduce((a, f) => a + f.l, 0) / Math.min(2, i);
    const nextL = feat.slice(i, i + 2).reduce((a, f) => a + f.l, 0) / Math.min(2, B - i);
    nov[i] = Math.max(0, s / (ws || 1)) + Math.abs(nextL - prevL) / 30;
  }
  // threshold from the interior only: the first and last bars (a fade, a
  // silent tail) spike the curve and would hide every real boundary
  const [nm, ns] = meanStd(nov.slice(2, Math.max(3, B - 2)));
  const minGap = B >= 32 ? 4 : 2;
  const cands = [];
  for (let i = 2; i < B - 1; i++) {
    let isMax = true; for (let k = -2; k <= 2; k++) if (k && nov[i + k] > nov[i]) isMax = false;
    if (!isMax || nov[i] < nm + 0.25 * ns) continue;
    const bonus = i % 4 === 0 ? 1.35 : i % 2 === 0 ? 1.1 : 1;
    cands.push({ i, s: nov[i] * bonus });
  }
  cands.sort((a, b) => b.s - a.s);
  const bounds = [];
  for (const c of cands) if (bounds.every((b) => Math.abs(b - c.i) >= minGap)) bounds.push(c.i);
  bounds.sort((a, b) => a - b);
  const edges = [0, ...bounds, B];

  // per-section level, density and slope, normalised over the bars
  // scale over the bars that have music in them; silence is simply 0
  const ls = feat.map((f) => f.l), lmax = Math.max(...ls), live = ls.filter((l) => l > lmax - 40);
  const l0 = percentile(live, 0.05), l1 = percentile(live, 0.95);
  const Lb = ls.map((l) => clamp((l - l0) / Math.max(1e-6, l1 - l0), 0, 1)), Db = pnorm(feat.map((f) => f.dens), 0.05, 0.9);
  const secs = [];
  for (let k = 0; k < edges.length - 1; k++) {
    const i0 = edges[k], i1 = edges[k + 1];
    let L = 0, D = 0; for (let i = i0; i < i1; i++) { L += Lb[i]; D += Db[i]; }
    L /= (i1 - i0); D /= (i1 - i0);
    const head = Math.min(2, i1 - i0);
    let a = 0, b = 0; for (let i = 0; i < head; i++) { a += Lb[i0 + i]; b += Lb[i1 - 1 - i]; }
    const mc = new Float32Array(12), mm = new Float32Array(N_MFCC - 1);
    for (let i = i0; i < i1; i++) { for (let q = 0; q < 12; q++) mc[q] += feat[i].c[q]; for (let q = 0; q < mm.length; q++) mm[q] += feat[i].m[q]; }
    secs.push({ i0, i1, L, D, slope: (b - a) / head, score: 0.65 * L + 0.35 * D, proto: { c: mc, m: mm.map((v) => v / (i1 - i0)), l: L * 40 } });
  }
  // labels: a section that sounds like an earlier one gets its letter
  const protos = [];
  for (const s of secs) {
    let lab = -1, best = 0.88;
    protos.forEach((p, j) => { const v = 0.55 * cos(s.proto.c, p.c) + 0.45 * (cos(s.proto.m, p.m) + 1) / 2; if (v > best) { best = v; lab = j; } });
    if (lab < 0) { protos.push(s.proto); lab = protos.length - 1; }
    s.label = String.fromCharCode(65 + Math.min(25, lab));
  }
  // types
  const byLabel = {};
  for (const s of secs) (byLabel[s.label] = byLabel[s.label] || []).push(s);
  let chorus = null, chorusScore = -1;
  for (const [lab, list] of Object.entries(byLabel)) {
    if (list.length < 2) continue;
    const m = list.reduce((a, s) => a + s.score, 0) / list.length;
    if (m > chorusScore) { chorusScore = m; chorus = lab; }
  }
  const maxScore = Math.max(...secs.map((s) => s.score));
  secs.forEach((s, k) => {
    const next = secs[k + 1];
    if (s.score >= 0.66 || (s.label === chorus && chorusScore >= 0.5 && s.score >= maxScore - 0.2) || (s.score >= maxScore - 0.05 && s.score >= 0.45)) s.type = "peak";
    else if (next && next.score > s.score + 0.12 && (s.slope > 0.1 || s.D > 0.5) && s.score >= 0.2) s.type = "build";
    else if (s.score < 0.3) s.type = "low";
    else s.type = "mid";
  });

  // fills: a busy last half-bar leading into a peak
  const halfCounts = [];
  for (let i = 0; i < B; i++) {
    const mid = (barF[i] + barF[i + 1]) / 2;
    halfCounts.push(oT.filter((t) => t >= mid && t < barF[i + 1]).length);
  }
  const medHalf = Math.max(1, median(halfCounts));
  const fills = [];
  secs.forEach((s, k) => {
    if (!k || s.type !== "peak" || secs[k - 1].type === "peak") return;
    const i = s.i0 - 1; if (i < 0) return;
    if (halfCounts[i] >= Math.max(3, medHalf * 1.5)) fills.push({ t0: ((barF[i] + barF[i + 1]) / 2) / fps, t1: barF[s.i0] / fps });
  });

  const tOf = (i) => (i <= 0 ? 0 : i >= B ? duration : barF[i] / fps);
  return {
    sections: secs.map((s) => ({ t0: tOf(s.i0), t1: tOf(s.i1), type: s.type, label: s.label, intensity: clamp(s.score, 0, 1), bars: s.i1 - s.i0 })),
    fills,
    bars: barF.slice(0, B).map((f) => f / fps)
  };
}

/* ---------- 9. the whole thing ---------- */
/* Two halves, because the melody is the slow part and nothing else waits on
   it: analyzeRhythm() returns everything but the lead line, and the caller
   attaches a melody afterwards, from Essentia or from melodyFallback().

   mono: Float32Array at `sr` (MIR_SR expected). opts.beats: beat times in
   seconds from a better tracker (Essentia), used instead of trackBeats when
   given. All times returned are seconds, track-relative. */
export function analyzeRhythm(mono, sr = MIR_SR, opts = {}) {
  const progress = opts.progress;
  const duration = mono.length / sr;
  const F = frameFeatures(mono, sr, progress && ((p) => progress(p * 0.9)));
  const fps = F.fps;
  const bands = onsetEnvelopes(F);
  const onsets = pickOnsets(bands.all, fps, F, bands);
  let beatsF, bpm = 0, tempoConfidence = 0, engine = "own";
  if (opts.beats && opts.beats.length >= 8) {
    engine = "essentia";
    beatsF = Array.from(opts.beats, (t) => clamp(Math.round(t * fps), 0, F.nFrames - 1));
    tempoConfidence = opts.confidence != null ? opts.confidence : 1;
  } else {
    const tempo = estimateTempo(bands.all, fps);
    beatsF = tempo.period ? trackBeats(bands.all, fps, tempo.period) : [];
    tempoConfidence = tempo.confidence;
    // a handful of beats from a beatless track is noise, not a groove
    if (beatsF.length < 8 || tempo.confidence < 0.05) beatsF = [];
  }
  if (beatsF.length >= 2) {
    // the span over the count, not the median gap, which is quantised to frames
    bpm = 60 * fps * (beatsF.length - 1) / Math.max(1, beatsF[beatsF.length - 1] - beatsF[0]);
    if (opts.bpm > 0 && Math.abs(opts.bpm - bpm) / bpm < 0.08) bpm = opts.bpm;
  }
  const bp = barPhase(beatsF, F, bands);

  /* Loudness in dB, floored 45 dB under the loud parts: a few bars of
     digital silence at -100 dB would otherwise stretch the scale so far that
     every bar of actual music reads as the chorus. */
  const loudDb = new Float32Array(F.nFrames);
  for (let t = 0; t < F.nFrames; t++) loudDb[t] = 20 * Math.log10(F.rms[t] + 1e-5);
  const floor = percentile(loudDb, 0.95) - 45;
  for (let t = 0; t < F.nFrames; t++) if (loudDb[t] < floor) loudDb[t] = floor;
  const st = structure(F, beatsF, bp.phase, onsets, duration, loudDb);

  // beat strength: the onset envelope at each beat, 0..1
  const p95 = percentile(bands.all, 0.95) || 1;
  const exact = opts.beats && engine === "essentia" ? opts.beats : null;
  const beats = beatsF.map((f, i) => {
    let m = 0; for (let k = -1; k <= 1; k++) { const j = f + k; if (j >= 0 && j < F.nFrames) m = Math.max(m, bands.all[j]); }
    const d = i >= bp.phase ? (i - bp.phase) % 4 === 0 : (bp.phase - i) % 4 === 0;
    return { t: exact ? exact[i] : f / fps, s: clamp(m / p95, 0, 1), down: d };
  });

  // feel curves on a 0.1 s grid
  const hopS = 0.1, nC = Math.max(1, Math.ceil(duration / hopS));
  const resample = (a, smoothS) => {
    const sm = movingAverage(a, Math.max(1, Math.round(smoothS * fps)));
    const out = new Float32Array(nC);
    for (let i = 0; i < nC; i++) out[i] = sm[clamp(Math.round(i * hopS * fps), 0, F.nFrames - 1)];
    return out;
  };
  const curves = {
    hop: hopS, n: nC,
    energy: pnorm(resample(loudDb, 1)),
    brightness: pnorm(resample(F.centroid, 2)),
    percussive: pnorm(resample(bands.all, 0.5)),
    noisiness: pnorm(resample(F.flatness, 2)),
    bass: pnorm(resample(F.bass, 2)),
    melody: new Float32Array(nC)
  };
  for (const s of st.sections) s.feel = sectionFeel(curves, s);

  // waveform for the strip
  const nPk = 1200, peaks = new Float32Array(nPk), per = mono.length / nPk;
  let pmx = 1e-9;
  for (let b = 0; b < nPk; b++) { let m = 0; const e = Math.min(mono.length, Math.floor((b + 1) * per)); for (let i = Math.floor(b * per); i < e; i++) { const v = Math.abs(mono[i]); if (v > m) m = v; } peaks[b] = m; if (m > pmx) pmx = m; }
  for (let b = 0; b < nPk; b++) peaks[b] /= pmx;

  if (progress) progress(1);
  const result = {
    duration, engine, bpm: Math.round(bpm * 10) / 10, tempoConfidence, meter: 4, barConfidence: bp.confidence,
    key: estimateKey(F),
    beats, bars: beats.filter((b) => b.down).map((b) => b.t),
    onsets, notes: [], melodyEngine: null,
    sections: st.sections, fills: st.fills,
    curves, pitch: new Float32Array(nC), peaks
  };
  return { result, ctx: { F } };
}

function sectionFeel(curves, s) {
  const hopS = curves.hop, nC = curves.n;
  const meanOver = (c) => { const i0 = clamp(Math.floor(s.t0 / hopS), 0, nC - 1), i1 = clamp(Math.ceil(s.t1 / hopS), i0 + 1, nC); let v = 0; for (let i = i0; i < i1; i++) v += c[i]; return v / (i1 - i0); };
  return { energy: meanOver(curves.energy), brightness: meanOver(curves.brightness), percussive: meanOver(curves.percussive), noisiness: meanOver(curves.noisiness), melody: meanOver(curves.melody) };
}

/* The dependency-free melody, from the salience candidates the rhythm pass
   already kept. Returns {f0Hz, hopS, notes} like the Essentia path does. */
export function melodyFallback(ctx) {
  const m = trackMelody(ctx.F);
  const f0Hz = new Float32Array(m.f0.length);
  for (let t = 0; t < f0Hz.length; t++) f0Hz[t] = m.f0[t] > 0 ? SAL_REF * Math.pow(2, m.f0[t] / 120) : 0;
  return { f0Hz, hopS: 1 / ctx.F.fps, notes: m.notes };
}

/* Folds a melody (pitch track in Hz at hopS, 0 = unvoiced, plus notes) into
   a rhythm result: the presence curve, the pitch curve, section means. */
export function attachMelody(result, mel, engine) {
  const c = result.curves, hopS = c.hop, nC = c.n;
  const n = mel.f0Hz.length;
  const voiced = new Float32Array(nC), pitch = new Float32Array(nC);
  for (let i = 0; i < nC; i++) {
    const j0 = clamp(Math.floor(i * hopS / mel.hopS), 0, n - 1), j1 = clamp(Math.ceil((i + 1) * hopS / mel.hopS), j0 + 1, n);
    let v = 0, ps = []; for (let j = j0; j < j1; j++) if (mel.f0Hz[j] > 0) { v++; ps.push(69 + 12 * Math.log2(mel.f0Hz[j] / 440)); }
    voiced[i] = v / (j1 - j0);
    pitch[i] = ps.length ? median(ps) : 0;
  }
  c.melody = movingAverage(voiced, Math.round(1 / hopS));
  result.pitch = pitch;
  result.notes = mel.notes.filter((x) => x.d >= 0.06).map((x) => ({ t: x.t, d: x.d, midi: Math.round(x.midi), s: x.s == null ? 0.7 : x.s }));
  result.melodyEngine = engine;
  for (const s of result.sections) s.feel = sectionFeel(c, s);
  return result;
}

/* Everything in one call, own DSP only: what tools/validate.js measures and
   what the worker falls back to when Essentia will not load. */
export function analyze(mono, sr = MIR_SR, progress) {
  const { result, ctx } = analyzeRhythm(mono, sr, { progress });
  return attachMelody(result, melodyFallback(ctx), "own");
}

/* 2:1 decimation behind a 31-tap windowed-sinc low-pass, for handing the
   44.1 kHz signal Essentia wants to the 22.05 kHz pass above. */
export function halve(x) {
  const N = 31, M = (N - 1) / 2, h = new Float32Array(N);
  let sum = 0;
  for (let i = 0; i < N; i++) { const k = i - M, w = 0.42 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)) + 0.08 * Math.cos(4 * Math.PI * i / (N - 1)); h[i] = (k === 0 ? 0.45 : Math.sin(Math.PI * 0.45 * k) / (Math.PI * k)) * w; sum += h[i]; }
  for (let i = 0; i < N; i++) h[i] /= sum;
  const out = new Float32Array(Math.floor(x.length / 2));
  for (let o = 0; o < out.length; o++) {
    const c = o * 2; let s = 0;
    for (let i = 0; i < N; i++) { const j = c + i - M; if (j >= 0 && j < x.length) s += x[j] * h[i]; }
    out[o] = s;
  }
  return out;
}
