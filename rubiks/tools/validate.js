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

process.stdout.write("\n" + (checks - failures.length) + "/" + checks + " checks passed\n");
if (failures.length) { process.stdout.write("\nFailed:\n" + failures.map((f) => "  - " + f).join("\n") + "\n"); process.exit(1); }
