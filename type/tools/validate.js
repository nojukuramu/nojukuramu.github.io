#!/usr/bin/env node
/* ============================================================
   Type — validation harness
   `node tools/validate.js`

   Same shape as hacks/tools/validate.js. Two halves, both of which have to
   pass before anything ships:

   1. Static checks over the source as text: no emoji, every module parses,
      the page and the service worker carry one version, the worker never
      takes over by itself, every file the page loads is in the worker's
      shell, every id the scripts reach for exists, every (i) names a topic,
      and the lifted files still say where they came from.

   2. Behaviour checks over the generators and the arithmetic, imported
      straight into Node: every challenge is deterministic for its seed, is
      made only of keys a keyboard has, leaves no template hole unfilled, and
      rarely repeats; Mixed never deals random keys; the conversation is
      well-formed and as rare as promised; the typing maths is right.

   No dependencies, no build step.
   ============================================================ */
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..");
const failures = [];
let checks = 0;

function ok(name) { checks++; process.stdout.write("  \u2713 " + name + "\n"); }
function fail(name, detail) {
  checks++;
  failures.push(name + (detail ? " — " + detail : ""));
  process.stdout.write("  \u2717 " + name + (detail ? " — " + detail : "") + "\n");
}
function check(name, cond, detail) { cond ? ok(name) : fail(name, detail); }
function section(title) { process.stdout.write("\n" + title + "\n"); }
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

function sourceFiles() {
  const out = [];
  (function walk(dir) {
    for (const name of fs.readdirSync(path.join(ROOT, dir))) {
      const rel = path.join(dir, name);
      if (name.startsWith(".")) continue;
      if (fs.statSync(path.join(ROOT, rel)).isDirectory()) { walk(rel); continue; }
      if (/\.(js|css|html|md|webmanifest|svg|json)$/.test(name)) out.push(rel);
    }
  })(".");
  return out;
}
const jsFiles = fs.readdirSync(path.join(ROOT, "js")).filter((f) => f.endsWith(".js")).map((f) => "js/" + f);
const html = read("index.html");
const sw = read("sw.js");
const allJs = jsFiles.map(read).join("\n");

(async function main() {
  section("Static: no emoji");
  {
    const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{2B00}-\u{2BFF}]/u;
    const bad = [];
    for (const rel of sourceFiles()) read(rel).split("\n").forEach((line, i) => { const m = line.match(EMOJI); if (m) bad.push(rel + ":" + (i + 1) + " " + JSON.stringify(m[0])); });
    check("no emoji or pictographic characters in source", bad.length === 0, bad.slice(0, 8).join(", "));
  }

  section("Static: every module parses");
  for (const rel of jsFiles.concat(["sw.js", "tools/validate.js", "tools/e2e.js"])) {
    try {
      const module = rel.startsWith("js/");
      execFileSync(process.execPath, (module ? ["--experimental-default-type=module"] : []).concat(["--check", path.join(ROOT, rel)]), { stdio: "pipe" });
      ok(rel);
    } catch (e) { fail(rel, String(e.stderr || e.message).split("\n").slice(0, 4).join(" ")); }
  }

  section("Static: one version number");
  {
    const pageV = (html.match(/window\.TY_VERSION\s*=\s*"([^"]+)"/) || [])[1];
    const cache = (sw.match(/var CACHE\s*=\s*"type-v([^"]+)"/) || [])[1];
    check("index.html declares window.TY_VERSION", !!pageV, pageV);
    check("sw.js names its cache type-v<version>", !!cache, cache);
    check("the page and the worker carry the same version", pageV && pageV === cache, pageV + " vs " + cache);
  }

  section("Static: the service worker waits to be asked");
  {
    const upd = read("js/update.js");
    const install = (sw.match(/addEventListener\("install"[\s\S]*?\n\}\);/) || [""])[0].replace(/\/\*[\s\S]*?\*\//g, "");
    check("no skipWaiting() inside install", !/skipWaiting\s*\(/.test(install));
    check('answers the house "skip-waiting" message', /e\.data === "skip-waiting"\) self\.skipWaiting\(\)/.test(sw));
    check("the page registers sw.js at a stable URL", /register\("sw\.js"\)/.test(allJs));
    check("update.js posts skip-waiting", /postMessage\("skip-waiting"\)/.test(upd));
    check("update.js reloads only on a real controller change", /if \(!hadController \|\| reloading\) return;/.test(upd));
    check("update.js checks on load, every 30 minutes, on return and when online", /CHECK_MS = 30 \* 60 \* 1000/.test(upd) && /visibilitychange/.test(upd) && /"online"/.test(upd));
    check("update.js confirms before reloading a half-typed challenge", /busy\(\) && !window\.confirm/.test(upd));
    check("the page offers the update in a bar with a version line", /id="update-bar"/.test(html) && /id="verLine"/.test(html) && /id="btnCheckUpdate"/.test(html));
    check("update.js and info.js say where they were lifted from", /Lifted from Hacks/.test(upd) && /Lifted from Hacks/.test(read("js/info.js")));
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
      for (const m of read(rel).matchAll(/from\s+"(\.\/[^"]+)"/g)) queue.push("js/" + m[1].slice(2));
    }
    const notCached = [...seen].filter((f) => shell.indexOf(f) < 0);
    check("every module main.js imports (" + seen.size + ") is in the shell", notCached.length === 0, notCached.join(", "));
    const stray = jsFiles.filter((f) => !seen.has(f));
    check("every file in js/ is used", stray.length === 0, stray.join(", "));
    const refs = [...html.matchAll(/(?:href|src)="((?!https?:|#|\.\.)[^"]+)"/g)].map((m) => m[1]).filter((f) => !/^data:/.test(f));
    check("every local file the page names is in the shell", refs.every((f) => shell.indexOf(f.replace(/^\.\//, "")) >= 0 || f === "sw.js"), refs.filter((f) => shell.indexOf(f) < 0).join(", "));
    const manifest = JSON.parse(read("manifest.webmanifest"));
    check("every manifest icon exists", manifest.icons.every((i) => exists(i.src)));
  }

  section("Static: the page and its scripts agree");
  {
    const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
    const wanted = new Set([...allJs.matchAll(/\$\("([^"]+)"\)/g)].map((m) => m[1]).concat([...allJs.matchAll(/getElementById\("([^"]+)"\)/g)].map((m) => m[1])).concat([...allJs.matchAll(/\bel\("([^"]+)"\)/g)].map((m) => m[1])));
    const missing = [...wanted].filter((i) => !ids.has(i));
    check("every element id the scripts look up exists (" + wanted.size + ")", missing.length === 0, missing.join(", "));
    const info = await imp("js/info.js");
    const asked = [...html.matchAll(/data-info="([^"]+)"/g)].map((m) => m[1]);
    const unknown = asked.filter((k) => !info.has(k));
    check("every (i) names a topic (" + asked.length + ")", unknown.length === 0, unknown.join(", "));
    check("the capture box is a textarea that is told not to correct you", /<textarea id="cap"[^>]*autocorrect="off"[^>]*autocapitalize="off"[^>]*spellcheck="false"/.test(html));
  }

  /* ============================================================
     2. Behaviour
     ============================================================ */
  const { generate, CATEGORIES, LENGTHS } = await imp("js/gen.js");
  const { makeRng } = await imp("js/rng.js");
  const eng = await imp("js/engine.js");
  const { LANG, LANG_IDS } = await imp("js/gen-code.js");
  const { classify } = await imp("js/highlight.js");
  const { CONVO_CHANCE, CONVO_COUNT } = await imp("js/convo.js");
  const { SHELF } = await imp("js/gen-text.js");

  section("Generators: same seed, same challenge");
  {
    let same = true;
    for (const cat of CATEGORIES) for (const len of LENGTHS) {
      const a = generate(cat, len, "seed-1"), b = generate(cat, len, "seed-1");
      if (JSON.stringify(a) !== JSON.stringify(b)) same = false;
    }
    check("every category and length is a pure function of its seed", same);
    const diff = new Set(["a", "b", "c", "d", "e"].map((s) => generate("text", "medium", s).text));
    check("different seeds give different text", diff.size === 5);
  }

  section("Generators: only keys a keyboard has");
  {
    const bad = [];
    let n = 0;
    for (const cat of ["text", "terminal", "code", "keys", "all"]) for (const len of LENGTHS) for (let i = 0; i < 300; i++) {
      const ch = generate(cat, len, "v" + i);
      n++;
      const t = ch.text;
      if (!t.length) bad.push(cat + "/" + len + "/" + i + " empty");
      if (/[^\x20-\x7e\n]/.test(t)) bad.push(cat + "/" + len + "/" + i + " non-keyboard " + JSON.stringify(t.match(/[^\x20-\x7e\n]/)[0]));
      if (/[‹›]/.test(t)) bad.push(cat + "/" + len + "/" + i + " unfilled hole");
      if (/ \n|^\s|\s$/.test(t) && ch.kind !== "keys") bad.push(cat + "/" + len + "/" + i + " stray whitespace " + JSON.stringify(t.slice(0, 40)));
      if (ch.kind === "keys" && (/  /.test(t) || /^ | $/.test(t))) bad.push("keys/" + len + "/" + i + " bad spacing");
      if ((ch.kind !== "code" ? /undefined|NaN|\[object/ : /NaN|\[object/).test(t)) bad.push(cat + "/" + len + "/" + i + " leaked a value " + JSON.stringify(t.slice(0, 60)));
    }
    check("(" + n + " challenges) every character is printable ASCII or Enter, with no hole left open", bad.length === 0, bad.slice(0, 5).join("; "));
    const shelfBad = SHELF.filter((s) => /[^\x20-\x7e]/.test(s));
    check("the hand-written sentences are keyboard-only too (" + SHELF.length + ")", shelfBad.length === 0, shelfBad.join(" | "));
  }

  section("Generators: they do not repeat");
  {
    for (const [cat, len, floor] of [["text", "medium", 0.99], ["text", "long", 0.99], ["terminal", "medium", 0.96], ["terminal", "long", 0.99], ["code", "medium", 0.98], ["code", "long", 0.99], ["keys", "medium", 0.999]]) {
      const set = new Set();
      const N = 2000;
      for (let i = 0; i < N; i++) set.add(generate(cat, len, "u" + i).text);
      const ratio = set.size / N;
      check(cat + " " + len + ": " + set.size + " unique in " + N, ratio >= floor, (ratio * 100).toFixed(1) + "% (need " + floor * 100 + "%)");
    }
    const short = new Set();
    for (let i = 0; i < 2000; i++) short.add(generate("terminal", "short", "s" + i).text);
    check("terminal short: at least 1000 different single commands in 2000 (" + short.size + ")", short.size >= 1000);
    const shortCode = new Set();
    for (let i = 0; i < 2000; i++) shortCode.add(generate("code", "short", "s" + i).text);
    check("code short: at least 1500 different snippets in 2000 (" + shortCode.size + ")", shortCode.size >= 1500);
  }

  section("Generators: Mixed");
  {
    const kinds = {};
    for (let i = 0; i < 600; i++) { const k = generate("all", "medium", "m" + i).kind; kinds[k] = (kinds[k] || 0) + 1; }
    check("Mixed deals text, terminal and code", kinds.text > 100 && kinds.terminal > 100 && kinds.code > 100, JSON.stringify(kinds));
    check("Mixed never deals random keys", !kinds.keys && !kinds.convo, JSON.stringify(kinds));
  }

  section("Generators: terminal");
  {
    const shells = {}, sizes = { short: [], medium: [], long: [] };
    for (const len of LENGTHS) for (let i = 0; i < 400; i++) {
      const ch = generate("terminal", len, "t" + i);
      shells[ch.shell] = (shells[ch.shell] || 0) + 1;
      sizes[len].push(ch.lines.length);
      if (ch.lines.some((l) => !l.prompt || !l.cmd)) fail("a terminal line has a prompt and a command", ch.id);
    }
    check("bash, zsh, fish, PowerShell, cmd, Python and SQLite all turn up (" + Object.keys(shells).join(", ") + ")", Object.keys(shells).length === 7);
    check("short is one command", sizes.short.every((n) => n === 1));
    check("medium is a sequence (3 or more)", sizes.medium.every((n) => n >= 3), "min " + Math.min.apply(null, sizes.medium));
    check("long is a longer sequence than medium on average", sizes.long.reduce((a, b) => a + b, 0) / 400 > sizes.medium.reduce((a, b) => a + b, 0) / 400 + 2);
    const cdHolds = (() => {
      for (let i = 0; i < 400; i++) {
        const ch = generate("terminal", "long", "c" + i);
        if (ch.shell !== "bash") continue;
        for (let j = 1; j < ch.lines.length; j++) {
          if (/^cd [a-z]+$/.test(ch.lines[j - 1].cmd) && ch.lines[j].prompt === ch.lines[j - 1].prompt) return false;
        }
      }
      return true;
    })();
    check("the prompt follows cd", cdHolds);
  }

  section("Generators: code");
  {
    const seen = {};
    for (let i = 0; i < 800; i++) { const ch = generate("code", "short", "l" + i); seen[ch.lang] = 1; }
    check("all " + LANG_IDS.length + " languages turn up", Object.keys(seen).length === LANG_IDS.length, Object.keys(seen).length + "");
    let bad = 0;
    for (const id of LANG_IDS) for (let i = 0; i < 40; i++) {
      const ch = generate("code", "long", "k" + i, { lang: id });
      if (ch.lang !== id) bad++;
      // the typed text carries no indentation: every line starts on its first character
      if (ch.text.split("\n").some((l) => /^\s/.test(l))) bad++;
      if (ch.lines.length !== ch.text.split("\n").length) bad++;
    }
    check("forcing a language works, and no typed line starts with indentation", bad === 0, bad + " problems");
    const js = generate("code", "short", "h1", { lang: "javascript" });
    const cls = classify('const x = "hi"; // note', LANG.javascript);
    check("the highlighter finds keywords, strings and comments", cls[0] === "k" && cls[10] === "s" && cls[cls.length - 1] === "c");
    check("indentation survives for display (some line is indented in a long snippet)", (() => { for (let i = 0; i < 20; i++) if (generate("code", "long", "d" + i, { lang: "python" }).lines.some((l) => l.indent > 0)) return true; return false; })());
    void js;
  }

  section("Generators: random keys");
  {
    const lens = LENGTHS.map((len) => generate("keys", len, "q").text.length);
    check("short < medium < long", lens[0] < lens[1] && lens[1] < lens[2], lens.join(","));
    const sets = new Set();
    for (let i = 0; i < 200; i++) sets.add(generate("keys", "medium", "z" + i).mix.join("+"));
    check("the part of the keyboard changes from challenge to challenge (" + sets.size + " mixes)", sets.size >= 8);
  }

  section("The conversation");
  {
    check("it appears one time in ten thousand", CONVO_CHANCE === 0.0001, String(CONVO_CHANCE));
    let normal = 0;
    for (let i = 0; i < 3000; i++) if (generate("text", "medium", "n" + i).kind === "convo") normal++;
    check("3000 ordinary text challenges contain at most 2 conversations (" + normal + ")", normal <= 2);
    let good = true, why = "";
    for (let i = 0; i < 200; i++) {
      const ch = generate("text", "medium", "cv" + i, { forceConvo: true });
      const mine = ch.turns.filter((t) => t.me);
      if (ch.kind !== "convo") { good = false; why = "kind"; }
      else if (ch.turns[0].me) { good = false; why = "starts with the player"; }
      else if (mine.length < 2) { good = false; why = "fewer than two player lines"; }
      else if (ch.turns.some((t) => !t.text || /[‹›]/.test(t.text) || /[^\x20-\x7e]/.test(t.text))) { good = false; why = "bad text"; }
      else if (ch.text !== mine.map((t) => t.text).join("\n")) { good = false; why = "target is not the player's lines"; }
      else if (new Set(ch.turns.filter((t) => !t.me).map((t) => t.who)).size < 2) { good = false; why = "only one other person"; }
    }
    check("every forced conversation has others speaking first, 2+ player lines and 2+ other people (" + CONVO_COUNT + " scripts)", good, why);
    check("?convo wires up to forceConvo in the page", /params\.has\("convo"\)/.test(read("js/main.js")) && /forceConvo/.test(read("js/main.js")));
  }

  section("The typing arithmetic");
  {
    check("a clean 300 characters in a minute is 60 wpm", eng.wpm(300, 60000) === 60);
    check("half a minute doubles it", eng.wpm(300, 30000) === 120);
    check("no time, no division by zero", eng.wpm(10, 0) === 0);
    check("compare marks pending, right and wrong", JSON.stringify(eng.compare("abcd", "abx")) === "[1,1,2,0]");
    check("complete means exactly equal", eng.isComplete("abc", "abc") && !eng.isComplete("abc", "abd") && !eng.isComplete("abc", "ab"));
    const L = eng.makeLedger();
    eng.record(L, "", "a", "abc"); eng.record(L, "a", "ax", "abc"); eng.record(L, "ax", "a", "abc"); eng.record(L, "a", "ab", "abc"); eng.record(L, "ab", "abc", "abc");
    check("keystrokes count right and wrong, and a repaired mistake is a fix", L.keys === 4 && L.right === 3 && L.wrong === 1 && L.fixed === 1, JSON.stringify(L));
    check("accuracy is right keystrokes over all keystrokes", eng.accuracy(L) === 75);
    check("a perfect run is 100 accuracy, an empty one too", eng.accuracy(eng.makeLedger()) === 100);
    check("flat speed is steady, wild speed is not", eng.consistency([50, 50, 50, 50]) === 100 && eng.consistency([10, 90, 10, 90]) < 60);
    check("a paste (many characters at once) is counted key by key", (() => { const l = eng.makeLedger(); eng.record(l, "", "abc", "abc"); return l.keys === 3; })());
  }

  console.log("\n" + (failures.length ? "FAILED — " + failures.length + " of " + checks + " checks\n" + failures.map((f) => "  - " + f).join("\n") : "PASSED — " + checks + "/" + checks + " checks"));
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
