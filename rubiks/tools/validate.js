#!/usr/bin/env node
/* ============================================================
   Rubiks — validation harness
   `node tools/validate.js`

   Same shape as aeons/tools/validate.js.

   1. No emoji
   2. Every module parses
   3. One version, and a worker that waits
   4. The shell has every file it needs
   5. Every id the scripts reach for is in index.html
   6. Every (i) names a topic
   7. Behaviour: the cube model, the 2x2 solver, scrambles, averages and
      typed times, run in a bare VM context

   No dependencies, no build step.
   ============================================================ */
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const failures = [];
let checks = 0;
function ok(name) { checks++; process.stdout.write("  " + String.fromCodePoint(0x2713) + " " + name + "\n"); }
function fail(name, detail) { checks++; failures.push(name + (detail ? " - " + detail : "")); process.stdout.write("  " + String.fromCodePoint(0x2717) + " " + name + (detail ? " - " + detail : "") + "\n"); }
function check(name, cond, detail) { cond ? ok(name) : fail(name, detail); }
function section(t) { process.stdout.write("\n" + t + "\n"); }
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const jsFiles = fs.readdirSync(path.join(ROOT, "js")).filter((f) => f.endsWith(".js")).map((f) => "js/" + f);

section("Static: no emoji");
{
  const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{2B00}-\u{2BFF}]/u;
  const bad = [];
  for (const rel of jsFiles.concat(["index.html", "css/rubiks.css", "sw.js", "manifest.webmanifest", "tools/validate.js"].filter(exists)))
    read(rel).split("\n").forEach((line, i) => { const m = line.match(EMOJI); if (m) bad.push(rel + ":" + (i + 1)); });
  check("no emoji or pictographic characters in source", !bad.length, bad.slice(0, 8).join(", "));
}

section("Static: every module parses");
for (const rel of jsFiles) {
  const r = spawnSync(process.execPath, ["--check"], { input: read(rel), encoding: "utf8" });
  check(rel + " parses", r.status === 0, (r.stderr || "").split("\n").slice(0, 4).join(" "));
}
{
  const r = spawnSync(process.execPath, ["--check", path.join(ROOT, "sw.js")], { encoding: "utf8" });
  check("sw.js parses", r.status === 0, r.stderr);
}

section("Static: one version, and a worker that waits");
const html = read("index.html"), sw = read("sw.js");
{
  const pageV = (html.match(/window\.RK_VERSION\s*=\s*"([^"]+)"/) || [])[1];
  const cache = (sw.match(/var VERSION\s*=\s*"rubiks-v([^"]+)"/) || [])[1];
  check("index.html declares window.RK_VERSION", !!pageV, pageV);
  check('sw.js names its cache rubiks-v<version>', !!cache, cache);
  check("the two agree", pageV === cache, pageV + " vs " + cache);
  const install = sw.slice(sw.indexOf('addEventListener("install"'), sw.indexOf('addEventListener("message"'));
  check("no skipWaiting() inside install", !/skipWaiting\(\)/.test(install.replace(/\/\*[\s\S]*?\*\//g, "")));
  check('the worker answers "skip-waiting"', /e\.data === "skip-waiting"\) self\.skipWaiting\(\)/.test(sw));
  const up = read("js/update.js");
  check("the page watches updatefound, controllerchange and checks periodically", /updatefound/.test(up) && /controllerchange/.test(up) && /CHECK_MS/.test(up) && /visibilitychange/.test(up) && /"online"/.test(up));
  check("there is an update bar and a manual check", html.includes('id="update-bar"') && html.includes('btn-check-update'));
}

section("Static: the shell");
{
  const shellRaw = [...sw.matchAll(/"\.\/([^"]*)"/g)].map((m) => m[1]).filter(Boolean);
  const stripQ = (s) => s.replace(/\?.*$/, "");
  const shell = shellRaw.map(stripQ);
  const missing = shell.filter((f) => !exists(f));
  check("every file in the shell exists", !missing.length, missing.join(", "));
  const loaded = jsFiles.concat(["css/rubiks.css", "manifest.webmanifest", "index.html"]);
  const absent = loaded.filter((f) => !shell.includes(f));
  check("every module, the stylesheet and the manifest are in the shell", !absent.length, absent.join(", "));
  const mf = JSON.parse(read("manifest.webmanifest"));
  const icons = mf.icons.map((i) => i.src).filter((s) => !exists(s));
  check("every manifest icon exists", !icons.length, icons.join(", "));
}

section("Static: ids and topics");
{
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  const wanted = new Set();
  for (const rel of jsFiles) {
    const src = read(rel);
    for (const m of src.matchAll(/getElementById\("([^"]+)"\)/g)) wanted.add(m[1]);
    for (const m of src.matchAll(/\$\("([^"]+)"\)/g)) wanted.add(m[1]);
  }
  const lost = [...wanted].filter((id) => !ids.has(id));
  check("every id the scripts reach for is in index.html", !lost.length, lost.join(", "));

  const topicSrc = read("js/info.js");
  const topics = new Set([...topicSrc.matchAll(/^\s+(\w+):\s*\{/gm)].map((m) => m[1]));
  const used = new Set();
  for (const src of jsFiles.map(read).concat([html])) for (const m of src.matchAll(/data-info="([^"]+)"/g)) used.add(m[1]);
  const noTopic = [...used].filter((k) => !topics.has(k));
  check("every (i) names a topic", !noTopic.length, noTopic.join(", "));
}

section("Static: every script the page loads exists, at the shell's version");
{
  const assetV = (sw.match(/var ASSET_V\s*=\s*"([^"]+)"/) || [])[1];
  const srcs = [...html.matchAll(/<script src="([^"?]+)\?v=([^"]+)"/g)];
  check("every <script src> exists", srcs.every((m) => exists(m[1])), srcs.filter((m) => !exists(m[1])).map((m) => m[1]).join(", "));
  check("every module in js/ is loaded by index.html", jsFiles.every((f) => srcs.some((m) => m[1] === f)), jsFiles.filter((f) => !srcs.some((m) => m[1] === f)).join(", "));
  const links = [...html.matchAll(/(?:src|href)="[^"]+\?v=([^"]+)"/g)].map((m) => m[1]);
  check("every ?v= in index.html matches the worker's ASSET_V", links.length && links.every((v) => v === assetV), [...new Set(links)].join(",") + " vs " + assetV);
}

section("Behaviour");
{
  const vm = require("vm");
  const noop = () => {};
  const ctx = vm.createContext({
    console, Math, JSON, Date, Int8Array, setTimeout, clearTimeout,
    performance: { now: () => Date.now() },
    requestAnimationFrame: noop, cancelAnimationFrame: noop,
    document: { addEventListener: noop }, window: {}, navigator: {}
  });
  for (const f of ["cube", "solver222", "scramble", "stats", "store", "app"]) vm.runInContext(read("js/" + f + ".js"), ctx, { filename: f + ".js" });
  const RK = vm.runInContext("RK", ctx);
  const C = RK.cube;

  /* Any face turned four times is home: catches a wrong rotation axis. */
  let bad = [];
  for (const n of [2, 3, 4, 5, 6, 7]) for (const m of ["U", "D", "R", "L", "F", "B", "Rw", "Uw", "3Fw"]) {
    const mv = C.parse(m);
    if (mv.depth > n / 2 && n > 2) continue;
    if (!C.isSolved(C.apply(C.solved(n), [m, m, m, m].join(" ")))) bad.push(n + ":" + m);
  }
  check("every turn, four times, is the identity on 2x2 to 7x7", !bad.length, bad.join(" "));
  check("(R U R' U') x6 is the identity, x1 is not", C.isSolved(C.apply(C.solved(3), "R U R' U' ".repeat(6))) && !C.isSolved(C.apply(C.solved(3), "R U R' U'")));
  const f = C.faces(C.apply(C.solved(3), "R"));
  check("R takes the front's right column to the top (white on top, green in front)", f.U.every((row) => row[2] === "F") && f.F.every((row) => row[2] === "D"));

  /* Every NxN scramble parses, and undoing it lands on solved. */
  const inv = (t) => t.endsWith("2") ? t : t.endsWith("'") ? t.slice(0, -1) : t + "'";
  bad = [];
  for (const e of RK.scramble.EVENTS) {
    for (let k = 0; k < 5; k++) {
      const moves = RK.scramble.format(RK.scramble.generate(e.id)).split(/\s+/);
      if (!moves.length || moves.some((m) => !m)) { bad.push(e.id + ": empty move"); break; }
      if (!e.n) continue;
      if (moves.some((m) => !C.parse(m))) { bad.push(e.id + ": " + moves.find((m) => !C.parse(m))); break; }
      const back = moves.slice().reverse().map(inv).join(" ");
      if (!C.isSolved(C.apply(C.apply(C.solved(e.n), moves.join(" ")), back))) { bad.push(e.id + ": inverse"); break; }
    }
  }
  check("every event scrambles, and cube scrambles parse and invert", !bad.length, bad.join("; "));
  const third = RK.scramble.format(RK.scramble.generate("3x3")).split(" ");
  const AX = { U: 0, D: 0, R: 1, L: 1, F: 2, B: 2 };
  let redundant = 0;
  for (let i = 1; i < third.length; i++) if (third[i][0] === third[i - 1][0]) redundant++;
  for (let i = 2; i < third.length; i++) if (third[i][0] === third[i - 2][0] && AX[third[i][0]] === AX[third[i - 1][0]]) redundant++;
  check("3x3 scrambles never turn a face twice in a row, or R L R", !redundant, third.join(" "));

  /* The 2x2 solver's cubie tables agree with the sticker model. */
  bad = 0;
  const FS = ["U", "R", "F"], PW = ["", "2", "'"];
  for (let i = 0; i < 60; i++) {
    const mv = [];
    for (let k = 0; k < 14; k++) mv.push(FS[Math.floor(Math.random() * 3)] + PW[Math.floor(Math.random() * 3)]);
    const st = RK.solver222.stateOf(mv), sol = RK.solver222.solve(st.p, st.o);
    if (sol.length > 11 || !C.isSolved(C.apply(C.solved(2), mv.concat(sol).join(" ")))) bad++;
  }
  check("2x2 solver solutions solve the sticker model (60 random states)", !bad, bad + " failed");
  const s2 = RK.solver222.scramble();
  check("2x2 random-state scrambles are 4 to 11 moves", s2.length >= 4 && s2.length <= 11, s2.join(" "));

  /* Averages, against hand-worked values. */
  const T = RK.stats, sv = (t, p) => ({ time: t, penalty: p || null, date: 0 });
  check("Ao5 drops best and worst", T.average([sv(10000), sv(11000), sv(12000), sv(13000), sv(14000)]) === 12000);
  check("Ao5 survives one DNF and not two", T.average([sv(10000), sv(11000), sv(12000), sv(1, "DNF"), sv(14000)]) === 12333 && T.average([sv(10000), sv(1, "DNF"), sv(12000), sv(1, "DNF"), sv(14000)]) === Infinity);
  check("Mo3 trims nothing; +2 counts", T.average([sv(10000), sv(9000, "+2"), sv(12000)]) === 11000 && T.average([sv(1), sv(1, "DNF"), sv(1)]) === Infinity);
  const hundred = Array.from({ length: 100 }, (_, i) => sv(10000 + i * 100));
  check("Ao100 drops five each side", T.average(hundred) === Math.round(hundred.slice(5, 95).reduce((a, s) => a + s.time, 0) / 90));
  const mix = Array.from({ length: 300 }, (_, i) => sv(5000 + ((i * 7919) % 9000), i % 17 === 0 ? "DNF" : i % 23 === 0 ? "+2" : null));
  bad = 0;
  for (const n of T.WINDOWS) { const r = T.rolling(mix, n); for (let i = 1; i <= mix.length; i++) if (r[i - 1] !== T.aoN(mix, n, i)) bad++; }
  check("the sliding rolling average equals the slice-and-sort one", !bad, bad + " differ");
  check("times truncate, as the WCA does", T.formatTime(12349) === "12.34" && T.formatTime(65432) === "1:05.43" && T.formatTime(65432, 3) === "1:05.432" && T.formatTime(Infinity) === "DNF");

  /* Typed times: csTimer's rules. */
  const P = RK.app.parseTyped, eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  check("typed times read the way csTimer reads them",
    eq(P("1234"), { time: 12340, penalty: null }) && eq(P("12345"), { time: 83450, penalty: null }) &&
    eq(P("12.34"), { time: 12340, penalty: null }) && eq(P("1:02.5"), { time: 62500, penalty: null }) &&
    eq(P("9.87+"), { time: 9870, penalty: "+2" }) && eq(P("dnf"), { time: 0, penalty: "DNF" }) && P("abc") === null && P("") === null);
}

process.stdout.write("\n" + (checks - failures.length) + "/" + checks + " checks passed\n");
if (failures.length) { process.stdout.write("\nFailed:\n" + failures.map((f) => "  - " + f).join("\n") + "\n"); process.exit(1); }
