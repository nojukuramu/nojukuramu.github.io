/* ============================================================
   BURST//DUMP — the analysis worker

   Off the main thread so a four-minute song never freezes the preview. Two
   messages go back for every track:

     "rhythm"  beats, bars, hits, sections, feel — what the edit needs
     "melody"  the lead line and its notes, which take longer and refine
               the "melody" rhythm and the print lift when they arrive

   Essentia.js (vendor/essentia, AGPL-3.0, Music Technology Group, UPF) does
   the beat tracking (RhythmExtractor2013, the "degara" method: within a
   frame of "multifeature" on steady music at a fifth of the cost) and the
   melody (PredominantPitchMelodia over an equal-loudness filter, segmented
   into notes by PitchContourSegmentation). It is imported on first use, so
   the 2.5 MB is only fetched by somebody who adds a song.

   js/mir.js does everything else, and all of it when Essentia cannot load
   (no WebAssembly, an old engine, not enough memory): the result says which
   engine produced it.
   ============================================================ */
import { analyzeRhythm, melodyFallback, attachMelody, halve, MIR_SR } from "./mir.js";

let essP = null;
function essentia() {
  if (!essP) {
    essP = Promise.all([import("../vendor/essentia/essentia-wasm.es.js"), import("../vendor/essentia/essentia.js-core.es.js")])
      .then(([w, c]) => new c.default(w.EssentiaWASM))
      .catch(() => null);
  }
  return essP;
}

const free = (...v) => { for (const x of v) { try { if (x && x.delete) x.delete(); } catch (e) {} } };

self.onmessage = async (e) => {
  const { id, mono, sr, skipEssentia } = e.data;
  const post = (type, extra, transfer) => self.postMessage(Object.assign({ type, id }, extra), transfer || []);
  try {
    post("progress", { stage: "rhythm", p: 0.02 });
    const ess = skipEssentia ? null : await essentia();
    let beats = null, bpm = 0, confidence = null;
    if (ess && sr === 44100) {
      try {
        const v = ess.arrayToVector(mono);
        const r = ess.RhythmExtractor2013(v, 208, "degara", 40);
        beats = Array.from(ess.vectorToArray(r.ticks));
        bpm = r.bpm;
        free(v, r.ticks, r.estimates, r.bpmIntervals);
      } catch (err) { beats = null; }
    }
    post("progress", { stage: "rhythm", p: 0.3 });
    const mono22 = sr === 44100 ? halve(mono) : mono;
    const { result, ctx } = analyzeRhythm(mono22, sr === 44100 ? MIR_SR : sr, { beats, bpm, confidence, progress: (p) => post("progress", { stage: "rhythm", p: 0.3 + p * 0.65 }) });
    post("rhythm", { result });

    post("progress", { stage: "melody", p: 0 });
    let mel = null, engine = "own";
    if (ess && sr === 44100) {
      try {
        const v = ess.arrayToVector(mono);
        const eq = ess.EqualLoudness(v, 44100).signal;
        const m = ess.PredominantPitchMelodia(eq, 10, 3, 2048, false, 0.8, 512, 1, 40, 1250, 100, 80, 20, 0.9, 0.9, 27.5, 55, 44100, 100, false, 0.2);
        const seg = ess.PitchContourSegmentation(m.pitch, eq, 512, 0.07, 60, -2, 44100, 440);
        const on = ess.vectorToArray(seg.onset), du = ess.vectorToArray(seg.duration), mp = ess.vectorToArray(seg.MIDIpitch);
        const notes = Array.from(on, (t, i) => ({ t, d: du[i], midi: mp[i] }));
        mel = { f0Hz: ess.vectorToArray(m.pitch), hopS: 512 / 44100, notes };
        engine = "essentia";
        free(v, eq, m.pitch, m.pitchConfidence, seg.onset, seg.duration, seg.MIDIpitch);
      } catch (err) { mel = null; }
    }
    if (!mel) mel = melodyFallback(ctx);
    attachMelody(result, mel, engine);
    post("melody", { notes: result.notes, pitch: result.pitch, melodyCurve: result.curves.melody, sectionFeel: result.sections.map((s) => s.feel), melodyEngine: engine });
  } catch (err) {
    post("error", { message: String((err && err.message) || err) });
  }
};
