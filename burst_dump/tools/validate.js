#!/usr/bin/env node
/* ============================================================
   BURST//DUMP — validation harness
   `node tools/validate.js`

   Same shape as type/tools/validate.js. Two halves:

   1. Static checks over the source as text: no emoji, every module parses,
      the page and the service worker carry one version, the worker never
      takes over by itself, the shell has everything the page loads, every
      id the scripts reach for exists, every (i) names a topic, every
      control names a real setting, vendored code carries its licence.

   2. Behaviour, imported straight into Node: the song analysis is scored
      against synthetic songs whose beats, bars, notes and sections are
      known (tools/synth.mjs), Essentia's vendored build is run on one of
      them, and the edit is checked for determinism, cuts on the grid,
      density following the song, and the length rules.

   No dependencies, no build step. tools/e2e.js is the browser half.
   ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..");
const failures = [];
function ok(name) { process.stdout.write("  \u2713 " + name + "\n"); }
function fail(name, detail) { failures.push(name + (detail ? " — " + detail : "")); process.stdout.write("  \u2717 " + name + (detail ? " — " + detail : "") + "\n"); }
function check(name, cond, detail) { cond ? ok(name + (detail != null && detail !== "" ? " (" + detail + ")" : "")) : fail(name, String(detail)); }
function section(t) { process.stdout.write("\n" + t + "\n"); }
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

function sourceFiles() {
  const out = [];
  (function walk(dir) {
    for (const name of fs.readdirSync(path.join(ROOT, dir))) {
      const rel = path.join(dir, name);
      if (name.startsWith(".") || rel === "vendor") continue;
      if (fs.statSync(path.join(ROOT, rel)).isDirectory()) { walk(rel); continue; }
      if (/\.(js|mjs|css|html|md|webmanifest|svg|json)$/.test(name)) out.push(rel);
    }
  })(".");
  return out;
}
const jsFiles = fs.readdirSync(path.join(ROOT, "js")).filter((f) => f.endsWith(".js")).map((f) => "js/" + f);
const html = read("index.html"), sw = read("sw.js"), mainSrc = read("js/main.js");
const allJs = jsFiles.map(read).join("\n");

/* beat-tracking style F-measure: each detection matches at most one truth within tol */
function fmeasure(det, tru, tol) {
  const used = new Uint8Array(tru.length); let hit = 0, err = 0;
  for (const d of det) {
    let bi = -1, bd = tol;
    for (let i = 0; i < tru.length; i++) { const e = Math.abs(tru[i] - d); if (e < bd && !used[i]) { bd = e; bi = i; } }
    if (bi >= 0) { used[bi] = 1; hit++; err += bd; }
  }
  const p = hit / Math.max(1, det.length), r = hit / Math.max(1, tru.length);
  return { f: p + r ? 2 * p * r / (p + r) : 0, err: hit ? err / hit : 0 };
}

(async function main() {
  section("Static: no emoji");
  {
    const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{2B00}-\u{2BFF}\u{25A0}-\u{25FF}]/u;
    const bad = [];
    for (const rel of sourceFiles()) read(rel).split("\n").forEach((line, i) => { const m = line.match(EMOJI); if (m) bad.push(rel + ":" + (i + 1) + " " + JSON.stringify(m[0])); });
    check("no emoji or pictographic glyphs in source (every icon is an SVG)", bad.length === 0, bad.slice(0, 8).join(", "));
  }

  section("Static: every module parses");
  for (const rel of jsFiles.concat(["sw.js", "tools/validate.js", "tools/e2e.js", "tools/synth.mjs"])) {
    try {
      const module = rel.startsWith("js/") || rel.endsWith(".mjs");
      execFileSync(process.execPath, (module ? ["--experimental-default-type=module"] : []).concat(["--check", path.join(ROOT, rel)]), { stdio: "pipe" });
      ok(rel);
    } catch (e) { fail(rel, String(e.stderr || e.message).split("\n").slice(0, 4).join(" ")); }
  }

  section("Static: one version number");
  {
    const pageV = (html.match(/window\.BD_VERSION\s*=\s*"([^"]+)"/) || [])[1];
    const cache = (sw.match(/var CACHE\s*=\s*"burstdump-v([^"]+)"/) || [])[1];
    check("index.html declares window.BD_VERSION", !!pageV, pageV);
    check("sw.js names its cache burstdump-v<version>", !!cache, cache);
    check("the page and the worker carry the same version", pageV && pageV === cache, pageV + " vs " + cache);
  }

  section("Static: the service worker waits to be asked");
  {
    const upd = read("js/update.js");
    const install = (sw.match(/addEventListener\("install"[\s\S]*?\n\}\);/) || [""])[0].replace(/\/\*[\s\S]*?\*\//g, "");
    check("no skipWaiting() inside install", install && !/skipWaiting\s*\(/.test(install));
    check('answers the house "skip-waiting" message', /e\.data === "skip-waiting"\) self\.skipWaiting\(\)/.test(sw));
    check("the page registers sw.js", /register\("sw\.js"\)/.test(mainSrc));
    check("update.js posts skip-waiting", /postMessage\("skip-waiting"\)/.test(upd));
    check("update.js reloads only on a real controller change", /if \(!hadController \|\| reloading\) return;/.test(upd));
    check("update.js checks on load, every 30 minutes, on return and when online", /CHECK_MS = 30 \* 60 \* 1000/.test(upd) && /visibilitychange/.test(upd) && /"online"/.test(upd));
    check("update.js confirms before reloading during an export", /busy\(\) && !window\.confirm/.test(upd) && /const busy = \(\) => !!player\.exporting/.test(mainSrc));
    check("the page offers the update in a bar, with a version line", /id="update-bar"/.test(html) && /id="verLine"/.test(html) && /id="btnCheckUpdate"/.test(html));
    check("update.js and info.js say where they were lifted from", /Lifted from Type/.test(upd) && /Lifted from Type/.test(read("js/info.js")));
    check("the worker keeps Essentia's cache across updates", /k === CACHE \|\| k === VENDOR/.test(sw));
  }

  section("Static: the shell has everything the page loads");
  {
    const shell = [...sw.matchAll(/"\.\/([^"]*)"/g)].map((m) => m[1]).filter(Boolean);
    const missing = shell.filter((f) => !exists(f));
    check("every SHELL entry exists on disk", missing.length === 0, missing.join(", "));
    const seen = new Set(), queue = ["js/main.js"];
    while (queue.length) {
      const rel = queue.shift();
      if (seen.has(rel)) continue;
      seen.add(rel);
      const src = read(rel), dir = path.dirname(rel);
      for (const m of src.matchAll(/(?:from\s+|import\s+)"(\.\.?\/[^"]+)"/g)) queue.push(path.join(dir, m[1]));
      for (const m of src.matchAll(/new URL\("(\.\/[^"]+)", import\.meta\.url\)/g)) queue.push(path.join(dir, m[1]));
    }
    const notCached = [...seen].filter((f) => shell.indexOf(f) < 0);
    check("every module the page reaches (" + seen.size + ") is in the shell", notCached.length === 0, notCached.join(", "));
    const stray = jsFiles.filter((f) => !seen.has(f));
    check("every file in js/ is used", stray.length === 0, stray.join(", "));
    const refs = [...html.matchAll(/(?:href|src)="((?!https?:|#|data:)[^"]+)"/g)].map((m) => m[1]);
    const unshelled = refs.filter((f) => shell.indexOf(f.replace(/^\.\//, "")) < 0);
    check("every local file the page names is in the shell", unshelled.length === 0, unshelled.join(", "));
    const manifest = JSON.parse(read("manifest.webmanifest"));
    check("every manifest icon exists", manifest.icons.every((i) => exists(i.src)));
    const ess = ["vendor/essentia/essentia-wasm.es.js", "vendor/essentia/essentia.js-core.es.js"];
    check("Essentia is vendored, and left out of the shell (fetched on first song)", ess.every(exists) && ess.every((f) => shell.indexOf(f) < 0));
    check("vendored code carries its licence", exists("vendor/LICENSE-mp4-muxer.txt") && exists("vendor/essentia/LICENSE-essentia.txt") && /AFFERO/.test(read("vendor/essentia/LICENSE-essentia.txt")));
  }

  section("Static: the page and its scripts agree");
  {
    const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
    const wanted = new Set([...allJs.matchAll(/\$\("([^"]+)"\)/g)].map((m) => m[1]).concat([...allJs.matchAll(/\bel\("([^"]+)"\)/g)].map((m) => m[1])));
    const missing = [...wanted].filter((i) => !ids.has(i));
    check("every element id the scripts look up exists (" + wanted.size + ")", missing.length === 0, missing.join(", "));
    const info = await imp("js/info.js");
    const asked = [...html.matchAll(/data-info="([^"]+)"/g)].map((m) => m[1]);
    const unknown = asked.filter((k) => !info.has(k));
    check("every (i) names a topic (" + asked.length + ")", unknown.length === 0, unknown.join(", "));
    const defaults = mainSrc.slice(mainSrc.indexOf("const DEFAULTS"), mainSrc.indexOf("const STORE"));
    const keys = [...html.matchAll(/data-k="([^"]+)"/g)].map((m) => m[1]);
    const noKey = keys.filter((k) => !new RegExp("\\b" + k + ":").test(defaults));
    check("every control names a setting with a default (" + keys.length + ")", noKey.length === 0, noKey.join(", "));
    const onBlock = mainSrc.slice(mainSrc.indexOf("const ON = {"), mainSrc.indexOf("document.querySelectorAll(\"[data-k]\")"));
    const ons = [...new Set([...html.matchAll(/data-on="([^"]+)"/g)].map((m) => m[1]))];
    const noOn = ons.filter((o) => !new RegExp("\\n  " + o + "[(:]").test(onBlock));
    check("every control's data-on names a handler", noOn.length === 0, noOn.join(", "));
    const shows = [...new Set([...html.matchAll(/data-show="([^"]+)"/g)].map((m) => m[1]))];
    const noShow = shows.filter((s) => !new RegExp("\\b" + s + "[:,]").test(mainSrc.slice(mainSrc.indexOf("function refreshVisibility"))));
    check("every conditional row has a rule", noShow.length === 0, noShow.join(", "));
  }

  /* ============================================================
     2. Behaviour
     ============================================================ */
  const synth = await imp("tools/synth.mjs");
  const mir = await imp("js/mir.js");
  const T = await imp("js/timeline.js");

  section("Analysis (built-in fallback) against songs with known answers");
  const songs = {};
  for (const bpm of [92, 120, 140, 174]) {
    const s = synth.synthSong({ bpm, seed: bpm });
    const t0 = Date.now();
    const r = mir.analyze(s.mono, s.sr);
    const ms = Date.now() - t0;
    songs[bpm] = { s, r };
    const octave = Math.abs(r.bpm * 2 - bpm) / bpm < 0.02;
    const exact = Math.abs(r.bpm - bpm) / bpm < 0.02;
    // the fallback may read a fast song at half time: the grid is still every other beat
    if (bpm >= 160) check(`${bpm} BPM: tempo right or exactly half`, exact || octave, r.bpm);
    else check(`${bpm} BPM: tempo within 2%`, exact, r.bpm);
    // at half time either every odd or every even beat is right
    const bf = octave
      ? [0, 1].map((par) => fmeasure(r.beats.map((b) => b.t), s.truth.beats.filter((_, i) => i % 2 === par), 0.07)).sort((a, b) => b.f - a.f)[0]
      : fmeasure(r.beats.map((b) => b.t), s.truth.beats, 0.07);
    check(`${bpm} BPM: beats F-measure at least 0.9, under 30 ms off`, bf.f >= 0.9 && bf.err < 0.03, bf.f.toFixed(2) + ", " + (bf.err * 1000).toFixed(0) + " ms");
    if (exact) { const df = fmeasure(r.bars, s.truth.downbeats, 0.07); check(`${bpm} BPM: bars start on the downbeat`, df.f >= 0.85, df.f.toFixed(2)); }
    const nf = fmeasure(r.notes.map((n) => n.t), s.truth.notes.map((n) => n.t), 0.06);
    let pc = 0, pn = 0; for (const n of r.notes) { const t = s.truth.notes.find((x) => Math.abs(x.t - n.t) < 0.06); if (t) { pn++; if (t.midi === n.midi) pc++; } }
    check(`${bpm} BPM: melody notes found (F at least 0.55) and pitched (60% exact)`, nf.f >= 0.55 && pc / Math.max(1, pn) >= 0.6, nf.f.toFixed(2) + ", " + (pc / Math.max(1, pn) * 100).toFixed(0) + "%");
    const chorusStarts = s.truth.sections.filter((x) => x.kind === "chorus").map((x) => x.t0);
    const bar = 240 / bpm;
    const peaksAt = chorusStarts.every((c) => r.sections.some((x) => x.type === "peak" && Math.abs(x.t0 - c) <= bar + 0.6));
    check(`${bpm} BPM: every chorus starts a "chorus" section within a bar`, peaksAt, r.sections.map((x) => x.type + "@" + x.t0.toFixed(1)).join(" "));
    check(`${bpm} BPM: the intro reads as quiet`, r.sections[0].type === "low", r.sections[0].type);
    check(`${bpm} BPM: ${s.truth.duration.toFixed(0)} s analysed in under 4 s`, ms < 4000, ms + " ms");
  }
  {
    const r = songs[120].r, k = r.key && r.key.name;
    check("the key of a C major song reads as C (or its relative, Am)", k === "C" || k === "Am", k);
    check("a fill is found in the snare roll into the first chorus", r.fills.some((f) => Math.abs(f.t1 - songs[120].s.truth.sections[3].t0) < 0.6), JSON.stringify(r.fills));
    const silent = mir.analyze(new Float32Array(22050 * 10), 22050);
    check("ten seconds of silence: no beats, one section, no crash", silent.beats.length === 0 && silent.sections.length >= 1);
    const sine = new Float32Array(22050 * 4), hi = new Float32Array(22050 * 4);
    for (let i = 0; i < sine.length; i++) { sine[i] = Math.sin(2 * Math.PI * 1000 * i / 44100); hi[i] = Math.sin(2 * Math.PI * 19000 * i / 44100); }
    const rms = (a) => Math.sqrt(a.slice(1000, -1000).reduce((s, v) => s + v * v, 0) / (a.length - 2000));
    const pass = rms(mir.halve(sine)) / rms(sine), stop = rms(mir.halve(hi)) / rms(hi);
    check("2:1 decimation keeps 1 kHz and removes 19 kHz", pass > 0.95 && stop < 0.1, pass.toFixed(2) + " / " + stop.toFixed(3));
  }

  section("Essentia, the vendored build");
  {
    // the browser ES build, run in a context that looks like a worker
    const src = read("vendor/essentia/essentia-wasm.es.js").replace(/export\s*\{\s*Module as EssentiaWASM\s*\};?/, "globalThis.EssentiaWASM = Module;");
    const ctx = { importScripts() {}, WebAssembly, console, performance, TextDecoder, setTimeout, clearTimeout, location: { href: "file:///x" } };
    ctx.self = ctx; ctx.globalThis = ctx; vm.createContext(ctx);
    let ess = null;
    try { vm.runInContext(src, ctx); ess = new ((await imp("vendor/essentia/essentia.js-core.es.js")).default)(ctx.EssentiaWASM); } catch (e) { fail("Essentia loads", e.message); }
    if (ess) {
      ok("Essentia " + ess.version + " loads");
      const s = synth.synthSong({ bpm: 128, seed: 9, sr: 44100, form: [{ kind: "verse", bars: 8 }, { kind: "chorus", bars: 8 }] });
      const v = ess.arrayToVector(s.mono);
      const r = ess.RhythmExtractor2013(v, 208, "degara", 40);
      const beats = Array.from(ess.vectorToArray(r.ticks));
      const bf = fmeasure(beats, s.truth.beats, 0.07);
      check("RhythmExtractor2013 tracks a 128 BPM song (F at least 0.95, under 15 ms off)", Math.abs(r.bpm - 128) < 1 && bf.f >= 0.95 && bf.err < 0.015, r.bpm.toFixed(1) + " BPM, F " + bf.f.toFixed(2) + ", " + (bf.err * 1000).toFixed(0) + " ms");
      const { result } = mir.analyzeRhythm(mir.halve(s.mono), 22050, { beats, bpm: r.bpm });
      check("its beats carry through the rest of the analysis", result.engine === "essentia" && result.beats.length === beats.length && result.bars.length >= 14, result.bars.length + " bars");
    }
  }

  section("The edit");
  {
    const music = songs[120].r;
    const base = { seed: 1337, rhythm: "song", lenMode: "fixed", durS: 30, accel: 2.2, cluster: 16, bpm: 120, styles: Object.fromEntries(T.STYLES.map((s) => [s, true])), chaos: 0.5, runMode: "auto", styleRun: {}, fit: "mix", feelOn: true, feelAmt: 1, feelPace: 1, feelFx: 1, feelStyle: 1, feelTex: 1, melodyLift: 0.5, musicOff: 10, fps: 60 };
    const photos = (n) => Array.from({ length: n }, (_, i) => ({ ar: i % 3 ? 1.5 : 0.667 }));
    const cv = { w: 1080, h: 1920 };
    const det = JSON.stringify(T.buildTimeline(photos(80), base, music, cv).events) === JSON.stringify(T.buildTimeline(photos(80), base, music, cv).events);
    check("the same seed and settings give the same edit", det);
    check("another seed gives another edit", JSON.stringify(T.buildTimeline(photos(80), Object.assign({}, base, { seed: 7 }), music, cv).events) !== JSON.stringify(T.buildTimeline(photos(80), base, music, cv).events));
    const bad = [];
    for (const rhythm of ["accel", "decel", "uniform", "bursts", "random", "beat", "song", "melody", "hits"]) for (const n of [12, 80, 400]) {
      const tl = T.buildTimeline(photos(n), Object.assign({}, base, { rhythm }), music, cv), ev = tl.events;
      // fewer cuts only when the edit says why: more photos than the music can take
      if (ev.length !== n && !(tl.note === "surplus" && ev.length < n)) bad.push(`${rhythm}/${n}: ${ev.length} cuts`);
      if (ev[0].t !== 0) bad.push(`${rhythm}/${n}: first cut at ${ev[0].t}`);
      for (let i = 1; i < ev.length; i++) if (ev[i].t < ev[i - 1].t || ev[i].t >= tl.D) { bad.push(`${rhythm}/${n}: cut ${i} out of order or past the end`); break; }
      if (T.MUSIC_RHYTHMS.includes(rhythm)) for (let i = 1; i < ev.length; i++) if (ev[i].t - ev[i - 1].t < 29.9) { bad.push(`${rhythm}/${n}: cuts ${(ev[i].t - ev[i - 1].t).toFixed(1)} ms apart`); break; }
      if (ev.some((e) => !T.STYLES.includes(e.st))) bad.push(`${rhythm}/${n}: unknown style`);
    }
    check("every rhythm: one cut per photo (or an announced sample), the first at 0, in order, inside the reel, 30 ms apart at least", bad.length === 0, bad.slice(0, 4).join("; "));
    // on the grid, by musical time (what is shown leads it by a frame or so)
    const tl = T.buildTimeline(photos(120), base, music, cv);
    const beats = T.timelineBeats(music, base, tl.D);
    const grid = [];
    for (let i = 0; i < beats.length - 1; i++) for (let j = 0; j < 16; j++) grid.push(beats[i].t + j / 16 * (beats[i + 1].t - beats[i].t));
    const off = tl.events.filter((e) => e.kind !== "start").filter((e) => !grid.some((g) => Math.abs(g - e.mt) < 1));
    check("follow the song: every cut is on the beat grid", off.length === 0, off.length + " off-grid");
    // density follows the sections
    const span = Object.assign({}, base, { musicOff: 0, durS: 90 });
    const tl2 = T.buildTimeline(photos(150), span, music, cv);
    const dens2 = (type) => { let n = 0, d = 0; for (const s of tl2.map.secs.filter((x) => x.type === type)) { d += s.t1 - s.t0; n += tl2.events.filter((e) => e.t >= s.t0 && e.t < s.t1).length; } return d ? n / d * 1000 : 0; };
    check("follow the song: the chorus is cut faster than the quiet parts", dens2("peak") > 2 * dens2("low"), dens2("peak").toFixed(1) + "/s vs " + dens2("low").toFixed(1) + "/s");
    const song = Object.assign({}, base, { rhythm: "beat", lenMode: "song", musicOff: 0 });
    const few = T.buildTimeline(photos(20), song, music, cv), many = T.buildTimeline(photos(1000), song, music, cv), fit = T.buildTimeline(photos(300), song, music, cv);
    check("on the beat, the whole song: too few photos end early, on a bar", few.note === "short" && few.D < music.duration * 1000 && music.bars.some((b) => Math.abs(b * 1000 - few.D) < 2), (few.D / 1000).toFixed(1) + " s");
    check("on the beat, the whole song: too many photos are sampled evenly", many.note === "surplus" && many.events.length < 1000 && many.events[many.events.length - 1].i > 900);
    check("on the beat, the whole song: otherwise the reel runs the whole song", !fit.note && Math.abs(fit.D - music.duration * 1000) < 1, (fit.D / 1000).toFixed(1) + " s");
    const none = T.buildTimeline(photos(30), base, null, cv);
    check("follow the song with no song falls back to accelerate", none.events.length === 30 && none.rhythm === "accel");
    const manual = T.buildTimeline(photos(30), Object.assign({}, base, { rhythm: "beat", bpm: 100 }), null, cv);
    check("on the beat with no song uses the typed BPM", manual.events.every((e) => Math.abs((e.mt / 150) - Math.round(e.mt / 150)) < 0.01), manual.events.slice(0, 4).map((e) => e.mt).join(","));
    const lift = T.buildTimeline(photos(200), Object.assign({}, base, { rhythm: "melody", styles: { pile: true }, melodyLift: 1, feelOn: false }), music, cv);
    const pts = lift.events.map((e) => [music.pitch[Math.round((base.musicOff + e.t / 1000) / music.curves.hop)] || 0, e.y]).filter((p) => p[0] > 0);
    const ps = pts.map((p) => p[0]).sort((a, b) => a - b), q1 = ps[Math.floor(ps.length / 3)], q2 = ps[Math.floor(ps.length * 2 / 3)];
    const hiY = pts.filter((p) => p[0] > q2).map((p) => p[1]), loY = pts.filter((p) => p[0] < q1).map((p) => p[1]);
    const avg = (a) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
    check("melody lift: prints sit higher for high notes", hiY.length > 3 && loY.length > 3 && avg(hiY) < avg(loY), avg(hiY).toFixed(2) + " vs " + avg(loY).toFixed(2));
  }

  section("Following the song (js/choreo.js)");
  {
    const C = await imp("js/choreo.js");
    const cv = { w: 1080, h: 1920 };
    const base = { seed: 3, rhythm: "song", lenMode: "fit", pace: 0, hero: true, syncNudge: 0, durS: 30, accel: 2.2, cluster: 16, bpm: 120, styles: Object.fromEntries(T.STYLES.map((s) => [s, true])), chaos: 0.5, runMode: "auto", styleRun: {}, fit: "mix", feelOn: true, feelAmt: 1, feelPace: 1, feelFx: 1, feelStyle: 1, feelTex: 1, melodyLift: 0.5, musicOff: 0, fps: 60 };
    const photos = (n, hero) => Array.from({ length: n }, (_, i) => ({ ar: 1.5, impact: i === hero ? 1 : 0.2 + (i * 37 % 7) / 100 }));
    const music = songs[120].r, truth = songs[120].s.truth;
    const at = (ms) => ms / 1000;

    // timing: never late, at most a frame and the lead early, at 60 and 30 fps, for every music rhythm
    const lateBad = [];
    for (const fps of [60, 30]) for (const rhythm of ["song", "beat", "melody", "hits"]) for (const nudge of [0, 40]) {
      const tl = T.buildTimeline(photos(150), Object.assign({}, base, { rhythm, fps, syncNudge: nudge, lenMode: rhythm === "song" ? "fit" : "fixed" }), music, cv);
      const frame = 1000 / fps;
      for (const e of tl.events.slice(1)) {
        const lead = e.mt + nudge - e.t;
        if (lead < C.LEAD_MS - 0.01 || lead > C.LEAD_MS + frame + 0.01) { lateBad.push(`${rhythm}@${fps}fps nudge ${nudge}: ${lead.toFixed(1)} ms`); break; }
        if (Math.abs(e.t / frame - Math.round(e.t / frame)) > 1e-6) { lateBad.push(`${rhythm}@${fps}: off the frame grid`); break; }
      }
    }
    check("every cut is on a video frame, " + C.LEAD_MS + " ms to a frame ahead of its beat, never behind (+ the nudge)", lateBad.length === 0, lateBad.slice(0, 3).join("; "));

    // the analysis is on time to begin with
    const signedMed = (det, tru) => { const e = []; for (const d of det) { let b = 1; for (const t of tru) if (Math.abs(t - d) < Math.abs(b)) b = d - t; if (Math.abs(b) < 0.07) e.push(b); } e.sort((a, b) => a - b); return e[e.length >> 1] * 1000; };
    const bias = signedMed(music.beats.map((b) => b.t), truth.beats), obias = signedMed(music.onsets.map((o) => o.t), truth.beats);
    check("beats and drum hits are not early or late on average (within 5 ms)", Math.abs(bias) < 5 && Math.abs(obias) < 5, bias.toFixed(1) + " / " + obias.toFixed(1) + " ms");

    // exactly N in every length mode, when the song can take them
    const exact = [];
    for (const lenMode of ["fit", "fixed", "song"]) for (const n of [10, 60, 150, 260]) {
      const tl = T.buildTimeline(photos(n), Object.assign({}, base, { lenMode }), music, cv);
      if (tl.events.length !== n && !(n > 60 && tl.note === "surplus")) exact.push(`${lenMode}/${n}: ${tl.events.length}`);
    }
    check("one cut per photo in fit, fixed and whole-song lengths (or an announced sample, past what the music takes)", exact.length === 0, exact.join(", "));
    const cram = T.buildTimeline(photos(300), Object.assign({}, base, { lenMode: "fixed", durS: 20 }), music, cv);
    check("cramming 300 photos into the quiet intro shows a sample, not a blur", cram.note === "surplus" && cram.plan.every((b) => b.type !== "low" || b.L <= 2), cram.events.length + " shown");

    // fit: few photos make a short reel ending on a phrase line; more make a longer one
    const f20 = T.buildTimeline(photos(20), base, music, cv), f90 = T.buildTimeline(photos(90), base, music, cv);
    const barEnds = f20.plan.map((b) => b.t1);
    check("fit the photos: the reel ends on a bar line, at the end of a phrase", Math.abs(f20.D - barEnds[barEnds.length - 1]) < 0.01 && (f20.plan.length % 4 === 0 || f20.plan.length % 4 === 1), (f20.D / 1000).toFixed(2) + " s, " + f20.plan.length + " bars");
    check("fit the photos: more photos, a longer reel", f90.D > f20.D, (f20.D / 1000).toFixed(1) + " s, then " + (f90.D / 1000).toFixed(1) + " s");
    const slow = T.buildTimeline(photos(90), Object.assign({}, base, { pace: -1 }), music, cv), fast = T.buildTimeline(photos(90), Object.assign({}, base, { pace: 1 }), music, cv);
    check("pace: calmer uses more of the song, busier less", slow.D > f90.D && fast.D < f90.D, [slow, f90, fast].map((x) => (x.D / 1000).toFixed(1)).join(" > ") + " s");

    // one pattern per phrase: every bar of a steady phrase has the same cuts in the same places
    const tl = T.buildTimeline(photos(200), Object.assign({}, base, { lenMode: "song" }), music, cv);
    const byBar = new Map();
    for (const e of tl.events) { if (e.kind === "start" || e.kind === "pickup" || e.kind === "fill") continue; const bi = tl.plan.findIndex((b) => e.mt >= b.t0 - 0.5 && e.mt < b.t1 - 0.5); if (bi < 0) continue; const b = tl.plan[bi]; (byBar.get(bi) || byBar.set(bi, []).get(bi)).push(Math.round((e.mt - b.t0) / (b.t1 - b.t0) * 16)); }
    let phrasesOk = 0, phrasesAll = 0;
    let ph = [];
    const flush = () => { if (ph.length >= 2 && ph[0].L >= 0 && ph.every((b) => b.L === ph[0].L && !b.brk)) { phrasesAll++; const pats = ph.map((b) => JSON.stringify(byBar.get(tl.plan.indexOf(b)) || [])); if (pats.every((x) => x === pats[0])) phrasesOk++; } ph = []; };
    for (const b of tl.plan) { if (b.phraseStart) flush(); if (b.t0 >= 0) ph.push(b); } flush();
    check("one pattern per phrase: steady phrases repeat the same cuts every bar (pickups aside)", phrasesAll > 3 && phrasesOk / phrasesAll >= 0.85, phrasesOk + " of " + phrasesAll);

    // the pace changes with the music: level per bar is never higher in the quiet intro than in a chorus
    const lv = (t) => tl.plan.filter((b) => b.type === t).map((b) => b.L);
    const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
    check("the chorus is cut at least twice as fast as the intro", mean(lv("peak")) >= mean(lv("low")) + 1, mean(lv("low")).toFixed(1) + " vs " + mean(lv("peak")).toFixed(1) + " (log2 cuts per bar)");

    // every section and every drop starts with a cut, on its downbeat
    const secStarts = music.sections.slice(1).map((s) => s.t0 * 1000);
    const missing = secStarts.filter((t) => !tl.events.some((e) => Math.abs(e.mt - t) < 2));
    check("every section opens with a cut on its downbeat", missing.length === 0, missing.map((t) => at(t).toFixed(1)).join(","));
    const drops = tl.events.filter((e) => e.kind === "drop");
    const chorusStarts = truth.sections.filter((s) => s.kind === "chorus").map((s) => s.t0 * 1000);
    check("every chorus that follows something quieter opens on a drop: a flash, full frame", drops.length === chorusStarts.length && drops.every((e) => e.flash && ["slam", "punch", "xerox"].includes(e.st)) && chorusStarts.every((t) => drops.some((e) => Math.abs(e.mt - t) < 30)), drops.map((e) => at(e.mt).toFixed(2) + " " + e.st).join(", "));

    // style changes land on phrase lines
    const runStarts = [];
    for (let k = 1; k < tl.events.length; k++) if (tl.events[k].st !== tl.events[k - 1].st) runStarts.push(tl.events[k]);
    const onLine = runStarts.filter((e) => tl.plan.some((b) => Math.abs(b.t0 - e.mt) < 2));
    check("layouts change on bar lines, not mid-bar", runStarts.length > 3 && onLine.length === runStarts.length, onLine.length + " of " + runStarts.length);

    // breaks hold, the run-up accelerates, the drop hits
    const form = [{ kind: "intro", bars: 4 }, { kind: "verse", bars: 8 }, { kind: "build", bars: 3 }, { kind: "break", bars: 1 }, { kind: "chorus", bars: 8 }, { kind: "verse", bars: 4 }];
    const sb = synth.synthSong({ bpm: 128, seed: 4, form }), mb = mir.analyze(sb.mono, sb.sr);
    const brk = sb.truth.sections.find((x) => x.kind === "break"), cho = sb.truth.sections.find((x) => x.kind === "chorus");
    const tb = T.buildTimeline(photos(120, 58), Object.assign({}, base, { lenMode: "song" }), mb, cv);
    const inBreak = tb.events.filter((e) => e.mt > brk.t0 * 1000 + 20 && e.mt < brk.t1 * 1000 - 20).length;
    check("a bar where the band stops holds the picture", inBreak === 0 && tb.plan.some((b) => b.brk), inBreak + " cuts in the break");
    const dropEv = tb.events.find((e) => e.kind === "drop");
    check("the drop after the break is a cut, on the beat (within 25 ms)", dropEv && Math.abs(dropEv.mt - cho.t0 * 1000) < 25, dropEv && at(dropEv.mt).toFixed(3) + " vs " + cho.t0.toFixed(3));
    const runUp = tb.plan.filter((b) => b.t1 <= brk.t0 * 1000 + 5).slice(-3).map((b) => b.L);
    check("the bars before the drop never slow down", runUp.every((l, i) => !i || l >= runUp[i - 1]) && runUp[runUp.length - 1] > runUp[0] - 0.5, runUp.join(" "));
    check("hero shots: the most striking photo nearby lands on the drop", dropEv && dropEv.i === 58, dropEv && "photo " + dropEv.i);
    const plain = T.buildTimeline(photos(120, 58), Object.assign({}, base, { lenMode: "song", hero: false }), mb, cv);
    check("hero shots off: photos stay in order", plain.events.every((e, k) => e.i === k));

    // groove: a strong off-beat accent pulls a two-a-bar pattern onto it
    const flat = new Array(16).fill(0), synco = flat.slice(); synco[6] = 1; synco[14] = 1;
    check("groove: with no accents, two cuts a bar fall on beats 1 and 3", JSON.stringify(C.positions(2, 16, flat, 1)) === "[0,8]", JSON.stringify(C.positions(2, 16, flat, 1)));
    check("groove: a syncopated accent moves the second cut onto it", C.positions(2, 16, synco, 1.2)[1] === 6 || C.positions(2, 16, synco, 1.2)[1] === 14, JSON.stringify(C.positions(2, 16, synco, 1.2)));
    check("groove: four a bar with no accents are the four beats", JSON.stringify(C.positions(4, 16, flat, 1)) === "[0,4,8,12]");

    // best part: a 30 s reel opens before the first chorus, not in the intro
    const bs = C.bestStart(music, 30), firstChorus = music.sections.find((s) => s.type === "peak");
    check("best part: starts on a bar, reaching the chorus early", music.bars.some((b) => Math.abs(b - bs) < 0.01) && bs <= firstChorus.t0 && firstChorus.t0 - bs <= 15, bs.toFixed(1) + " s, chorus at " + firstChorus.t0.toFixed(1) + " s");
  }

  process.stdout.write(failures.length ? `\n${failures.length} failed\n` : "\nall checks passed\n");
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
