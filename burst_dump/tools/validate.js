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
      if (ev.length !== n) bad.push(`${rhythm}/${n}: ${ev.length} cuts`);
      if (ev[0].t !== 0) bad.push(`${rhythm}/${n}: first cut at ${ev[0].t}`);
      for (let i = 1; i < ev.length; i++) if (ev[i].t < ev[i - 1].t || ev[i].t >= tl.D) { bad.push(`${rhythm}/${n}: cut ${i} out of order or past the end`); break; }
      if (T.MUSIC_RHYTHMS.includes(rhythm)) for (let i = 1; i < ev.length; i++) if (ev[i].t - ev[i - 1].t < 29.9) { bad.push(`${rhythm}/${n}: cuts ${(ev[i].t - ev[i - 1].t).toFixed(1)} ms apart`); break; }
      if (ev.some((e) => !T.STYLES.includes(e.st))) bad.push(`${rhythm}/${n}: unknown style`);
    }
    check("every rhythm: one cut per photo, the first at 0, in order, inside the reel, 30 ms apart at least", bad.length === 0, bad.slice(0, 4).join("; "));
    // on the grid
    const tl = T.buildTimeline(photos(120), base, music, cv);
    const beats = T.timelineBeats(music, base, tl.D);
    const grid = [];
    for (let i = 0; i < beats.length - 1; i++) for (let j = 0; j < 16; j++) grid.push(beats[i].t + j / 16 * (beats[i + 1].t - beats[i].t));
    // the first cut is pinned to 0 so a photo is on screen from the first frame
    const off = tl.events.slice(1).filter((e) => !grid.some((g) => Math.abs(g - e.t) < 1));
    check("follow the song: every cut is on the beat grid", off.length === 0, off.length + " off-grid");
    // density follows the sections
    const span = Object.assign({}, base, { musicOff: 0, durS: 90 });
    const tl2 = T.buildTimeline(photos(150), span, music, cv);
    const dens2 = (type) => { let n = 0, d = 0; for (const s of tl2.map.secs.filter((x) => x.type === type)) { d += s.t1 - s.t0; n += tl2.events.filter((e) => e.t >= s.t0 && e.t < s.t1).length; } return d ? n / d * 1000 : 0; };
    check("follow the song: the chorus is cut faster than the quiet parts", dens2("peak") > 2 * dens2("low"), dens2("peak").toFixed(1) + "/s vs " + dens2("low").toFixed(1) + "/s");
    const song = Object.assign({}, base, { lenMode: "song", musicOff: 0 });
    const few = T.buildTimeline(photos(20), song, music, cv), many = T.buildTimeline(photos(1000), song, music, cv), fit = T.buildTimeline(photos(300), song, music, cv);
    check("let the song decide: too few photos end early, on a bar", few.note === "short" && few.D < music.duration * 1000 && music.bars.some((b) => Math.abs(b * 1000 - few.D) < 2), (few.D / 1000).toFixed(1) + " s");
    check("let the song decide: too many photos are sampled evenly", many.note === "surplus" && many.events.length < 1000 && many.events[many.events.length - 1].i > 900);
    check("let the song decide: otherwise the reel runs the whole song", !fit.note && Math.abs(fit.D - music.duration * 1000) < 1, (fit.D / 1000).toFixed(1) + " s");
    const none = T.buildTimeline(photos(30), base, null, cv);
    check("follow the song with no song falls back to accelerate", none.events.length === 30 && none.rhythm === "accel");
    const manual = T.buildTimeline(photos(30), Object.assign({}, base, { rhythm: "beat", bpm: 100 }), null, cv);
    check("on the beat with no song uses the typed BPM", manual.events.every((e) => Math.abs((e.t / 150) - Math.round(e.t / 150)) < 0.01), manual.events.slice(0, 4).map((e) => e.t).join(","));
    const lift = T.buildTimeline(photos(200), Object.assign({}, base, { rhythm: "melody", styles: { pile: true }, melodyLift: 1, feelOn: false }), music, cv);
    const pts = lift.events.map((e) => [music.pitch[Math.round((base.musicOff + e.t / 1000) / music.curves.hop)] || 0, e.y]).filter((p) => p[0] > 0);
    const ps = pts.map((p) => p[0]).sort((a, b) => a - b), q1 = ps[Math.floor(ps.length / 3)], q2 = ps[Math.floor(ps.length * 2 / 3)];
    const hiY = pts.filter((p) => p[0] > q2).map((p) => p[1]), loY = pts.filter((p) => p[0] < q1).map((p) => p[1]);
    const avg = (a) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
    check("melody lift: prints sit higher for high notes", hiY.length > 3 && loY.length > 3 && avg(hiY) < avg(loY), avg(hiY).toFixed(2) + " vs " + avg(loY).toFixed(2));
  }

  process.stdout.write(failures.length ? `\n${failures.length} failed\n` : "\nall checks passed\n");
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
