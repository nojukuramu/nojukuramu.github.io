/* ============================================================
   BURST//DUMP — a song with the answers written down

   Builds a small pop arrangement (kick, snare, hats, bass, chord pads, a
   lead line) at a known tempo, with known bars, notes and sections, so
   tools/validate.js can score js/mir.js against ground truth instead of
   eyeballing it, and tools/e2e.js can feed the page a real WAV.

   Deterministic for a given seed.
   ============================================================ */

export function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

const PROG = [[48, 52, 55], [43, 47, 50], [45, 48, 52], [41, 45, 48]];   // C  G  Am  F
const SCALE = [60, 62, 64, 65, 67, 69, 71, 72];

export const DEFAULT_FORM = [
  { kind: "intro", bars: 8 },
  { kind: "verse", bars: 8 },
  { kind: "build", bars: 4 },
  { kind: "chorus", bars: 8 },
  { kind: "verse", bars: 8 },
  { kind: "chorus", bars: 8 },
  { kind: "outro", bars: 4 }
];

export function synthSong(opts = {}) {
  const sr = opts.sr || 22050, bpm = opts.bpm || 120, form = opts.form || DEFAULT_FORM;
  const lead = opts.lead !== false, offset = opts.offset || 0.5;
  const rng = mulberry32(opts.seed || 7);
  const beat = 60 / bpm, bar = 4 * beat;
  const totalBars = form.reduce((a, s) => a + s.bars, 0);
  const dur = offset + totalBars * bar + 2;
  const out = new Float32Array(Math.ceil(dur * sr));
  const truth = { bpm, beats: [], downbeats: [], notes: [], sections: [] };

  const add = (t0, gen, len, gain) => {
    const s0 = Math.round(t0 * sr), n = Math.round(len * sr);
    for (let i = 0; i < n && s0 + i < out.length; i++) out[s0 + i] += gen(i / sr, i) * gain;
  };
  const kick = (t, g) => add(t, (x) => { const f = 45 + 80 * Math.exp(-x * 30); return Math.sin(2 * Math.PI * f * x) * Math.exp(-x * 14); }, 0.3, g);
  const snare = (t, g) => add(t, (x) => ((rng() * 2 - 1) * 0.8 + 0.4 * Math.sin(2 * Math.PI * 190 * x)) * Math.exp(-x * 22), 0.2, g);
  let hp = 0;
  const hat = (t, g) => add(t, () => { const v = rng() * 2 - 1, d = v - hp; hp = v; return d * 0.5; }, 0.03, g);
  const crash = (t, g) => add(t, (x) => (rng() * 2 - 1) * Math.exp(-x * 2.5), 1.2, g);
  const tone = (t, midi, len, g, harmonics) => {
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    add(t, (x) => {
      let s = 0;
      for (let h = 1; h <= harmonics; h++) if (f * h < sr / 2) s += Math.sin(2 * Math.PI * f * h * x) / h;
      const env = Math.min(1, x / 0.01) * Math.min(1, (len - x) / 0.03);
      return s * env;
    }, len, g);
  };

  let t = offset, barIdx = 0;
  for (const sec of form) {
    truth.sections.push({ t0: t, t1: t + sec.bars * bar, kind: sec.kind });
    for (let b = 0; b < sec.bars; b++, barIdx++) {
      const t0 = t + b * bar;
      const chord = PROG[barIdx % 4];
      const lvl = sec.kind === "intro" || sec.kind === "outro" ? 0.35 : sec.kind === "build" ? 0.55 + 0.35 * b / sec.bars : sec.kind === "chorus" ? 1 : 0.6;
      // pads: a chord per bar, so harmony changes on the downbeat
      for (const m of chord) tone(t0, m, bar * 0.98, 0.05 * lvl, 4);
      for (let k = 0; k < 4; k++) {
        const tb = t0 + k * beat;
        truth.beats.push(tb);
        if (k === 0) truth.downbeats.push(tb);
        tone(tb, chord[0] - 12, beat * 0.85, 0.16 * lvl, 3);
        if (sec.kind === "outro") continue;
        if (sec.kind === "intro") { if (k === 0) kick(tb, 0.5 * lvl); hat(tb, 0.15 * lvl); continue; }
        if (sec.kind === "chorus" || k === 0 || k === 2) kick(tb, 0.9 * lvl * (k === 0 ? 1.15 : 1));
        if (k === 1 || k === 3) snare(tb, 0.35 * lvl);
        const hs = sec.kind === "chorus" ? 4 : 2;
        for (let h = 0; h < hs; h++) hat(tb + h * beat / hs, 0.12 * lvl);
        // the build ends on a snare roll into the chorus
        if (sec.kind === "build" && b === sec.bars - 1 && k >= 2) for (let r = 1; r < 4; r++) snare(tb + r * beat / 4, 0.3 * lvl);
      }
      if (sec.kind === "chorus" && b === 0) crash(t0, 0.15);
      // lead line: quarter and eighth notes off the scale
      if (lead && (sec.kind === "verse" || sec.kind === "chorus")) {
        let pos = 0;
        while (pos < 4 - 1e-6) {
          const len = rng() < 0.6 ? 1 : 0.5;
          const midi = SCALE[(rng() * SCALE.length) | 0] + (sec.kind === "chorus" ? 12 : 0);
          const nt = t0 + pos * beat, nd = len * beat * 0.9;
          tone(nt, midi, nd, 0.11 * lvl, 10);
          truth.notes.push({ t: nt, d: nd, midi });
          pos += len;
        }
      }
    }
    t += sec.bars * bar;
  }
  let mx = 0; for (let i = 0; i < out.length; i++) mx = Math.max(mx, Math.abs(out[i]));
  for (let i = 0; i < out.length; i++) out[i] = out[i] / mx * 0.9;
  truth.duration = dur;
  return { mono: out, sr, truth };
}

/* 16-bit PCM WAV, mono or stereo, as a Uint8Array */
export function wav(mono, sr) {
  const n = mono.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const s = (o, str) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
  s(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); s(8, "WAVE"); s(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true);
  v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); s(36, "data"); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, Math.round(mono[i] * 32767))), true);
  return new Uint8Array(buf);
}
