#!/usr/bin/env node
/* ============================================================
   Hacks — validation harness
   `node tools/validate.js`

   Same shape as magic_sandbox/tools/validate.js. Two halves, both of which
   have to pass before anything ships:

   1. Static checks over the source as text: no emoji, every module parses,
      the page and the service worker carry one version, the worker never
      takes over by itself, every file the game (and the hack worker) loads
      is in the worker's shell, every id the scripts reach for exists, every
      (i) names a topic, every icon named anywhere is drawn, and the lifted
      files still say where they came from — peer.js is checked line for line
      against KaraokeNatin's.

   2. Behaviour checks over the pure modules, imported straight into Node:
      the brush tracer, Source movement (bunny hop keeps speed, held jump
      does not, air strafing gains, surfing keeps speed, the slide, the
      climb, the wall jump, the lunge, steep slopes slid down rather than
      stuck on, the grapple's rope), the same result at 30, 60, 144 and
      240 frames a second, the arena (with its Skyway and Halo) and its nav
      graph, the weapons (penetration, the Condor, the scopes' zoom, blades
      that hit harder at speed), the skeleton's hitboxes (the nut box among
      them), a match played headless (collateral, nut shot, a hooked bot
      pulled in), the match rules, the save record's cleaning, and
      the hack sandbox itself — run in a child process that stands in for a
      Web Worker — reading everything and writing only itself.

   No dependencies, no build step.
   ============================================================ */
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
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
      if (rel.startsWith("vendor") || name.startsWith(".")) continue;
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
  /* ============================================================
     1. Static checks
     ============================================================ */
  section("Static: no emoji");
  {
    const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{2B00}-\u{2BFF}]/u;
    const bad = [];
    for (const rel of sourceFiles()) read(rel).split("\n").forEach((line, i) => { const m = line.match(EMOJI); if (m) bad.push(rel + ":" + (i + 1) + " " + JSON.stringify(m[0])); });
    check("no emoji or pictographic characters in source", bad.length === 0, bad.slice(0, 8).join(", "));
  }

  section("Static: every module parses");
  for (const rel of jsFiles.concat(["sw.js", "tools/validate.js", "tools/e2e.js", "tools/mp-e2e.js", "tools/broker.js"].filter(exists))) {
    try {
      const module = rel.startsWith("js/") && rel !== "js/peer.js";
      execFileSync(process.execPath, (module ? ["--experimental-default-type=module"] : []).concat(["--check", path.join(ROOT, rel)]), { stdio: "pipe" });
      ok(rel);
    } catch (e) { fail(rel, String(e.stderr || e.message).split("\n").slice(0, 4).join(" ")); }
  }

  section("Static: one version number");
  {
    const pageV = (html.match(/window\.HK_VERSION\s*=\s*"([^"]+)"/) || [])[1];
    const cache = (sw.match(/var CACHE\s*=\s*"hacks-v([^"]+)"/) || [])[1];
    check("index.html declares window.HK_VERSION", !!pageV, pageV);
    check("sw.js names its cache hacks-v<version>", !!cache, cache);
    check("the page and the worker carry the same version", pageV && pageV === cache, pageV + " vs " + cache);
  }

  section("Static: the service worker waits to be asked");
  {
    const install = (sw.match(/addEventListener\("install"[\s\S]*?\n\}\);/) || [""])[0].replace(/\/\*[\s\S]*?\*\//g, "");
    check("no skipWaiting() inside install", !/skipWaiting\s*\(/.test(install));
    check('answers the house "skip-waiting" message', /e\.data === "skip-waiting"\) self\.skipWaiting\(\)/.test(sw));
    check("the page registers sw.js at a stable URL", /register\("sw\.js"\)/.test(allJs));
    check("update.js posts skip-waiting", /postMessage\("skip-waiting"\)/.test(read("js/update.js")));
    check("update.js reloads only on a real controller change", /if \(!hadController \|\| reloading\) return;/.test(read("js/update.js")));
    check("update.js checks on load, every 30 minutes, on return and when online", /CHECK_MS = 30 \* 60 \* 1000/.test(read("js/update.js")) && /visibilitychange/.test(read("js/update.js")) && /"online"/.test(read("js/update.js")));
    check("the page offers the update in a bar with a version line", /id="update-bar"/.test(html) && /id="verLine"/.test(html) && /id="btnCheckUpdate"/.test(html));
  }

  section("Static: the shell has everything the game loads");
  {
    const shell = [...sw.matchAll(/"\.\/([^"]*)"/g)].map((m) => m[1]).filter(Boolean);
    const missing = shell.filter((f) => !exists(f));
    check("every SHELL entry exists on disk", missing.length === 0, missing.join(", "));
    const seen = new Set();
    // the page's modules, and the hack worker's, which the page starts by URL
    const queue = ["js/main.js", "js/hackworker.js"];
    while (queue.length) {
      const rel = queue.shift();
      if (seen.has(rel)) continue;
      seen.add(rel);
      if (!exists(rel)) { fail("import target exists: " + rel); continue; }
      const src = read(rel);
      for (const m of src.matchAll(/(?:import|export)\s[^'"]*?from\s*['"](\.[^'"]+)['"]/g)) queue.push(path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1])));
      // side-effect imports too: peer.js is a classic script lobby.js loads for its global
      for (const m of src.matchAll(/^import\s+['"](\.[^'"]+)['"]/gm)) queue.push(path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1])));
    }
    seen.add("vendor/build/three.module.min.js");
    check("hackapi.js starts the worker by URL", /new Worker\(new URL\("\.\/hackworker\.js", import\.meta\.url\), \{ type: "module" \}\)/.test(read("js/hackapi.js")));
    const notShelled = [...seen].filter((f) => !shell.includes(f));
    check("every module reachable from main.js or the hack worker is in SHELL (" + seen.size + ")", notShelled.length === 0, notShelled.join(", "));
    const orphans = jsFiles.filter((f) => !seen.has(f));
    check("no module in js/ is unused", orphans.length === 0, orphans.join(", "));
    check("the stylesheet is in SHELL", shell.includes("css/game.css"));
    // the models load by URL, not by import, so the walk above cannot see them
    const glbs = fs.readdirSync(path.join(ROOT, "assets/models")).filter((f) => f.endsWith(".glb"));
    const credits = read("assets/models/CREDITS.md");
    check("every model is in SHELL, so the game plays offline", glbs.length > 0 && glbs.every((f) => shell.includes("assets/models/" + f)), glbs.filter((f) => !shell.includes("assets/models/" + f)).join(", "));
    check("every model is credited, with its licence", glbs.every((f) => credits.includes("`" + f + "`")) && /CC0/.test(credits), glbs.filter((f) => !credits.includes("`" + f + "`")).join(", "));
    const msrc = read("js/models.js");
    const asked = JSON.parse((msrc.match(/GUN_FILES = (\[[^\]]+\])/) || [0, "[]"])[1]).concat([...msrc.matchAll(/"assets\/models\/(\w+)\.glb"/g)].map((m) => m[1]));
    check("models.js asks for exactly the models there are", asked.length === glbs.length && asked.every((n) => glbs.includes(n + ".glb")), asked.join(","));
    // the sounds load by URL too
    const sounds = fs.readdirSync(path.join(ROOT, "assets/sounds")).filter((f) => f.endsWith(".mp3"));
    const scred = read("assets/sounds/CREDITS.md");
    const asrc = read("js/audio.js");
    const wanted = JSON.parse("[" + (asrc.match(/SOUND_FILES = \[([\s\S]*?)\];/) || [0, ""])[1].replace(/\s+/g, "") + "]");
    check("audio.js asks for exactly the sounds there are (" + sounds.length + ")", wanted.length === sounds.length && wanted.every((n) => sounds.includes(n + ".mp3")), wanted.filter((n) => !sounds.includes(n + ".mp3")).concat(sounds.filter((f) => !wanted.includes(f.slice(0, -4)))).join(", "));
    check("every sound is in SHELL, so the game plays offline", sounds.every((f) => shell.includes("assets/sounds/" + f)), sounds.filter((f) => !shell.includes("assets/sounds/" + f)).join(", "));
    check("every sound is credited, with its licence", sounds.every((f) => scred.includes("`" + f + "`") || (/^step\d\.mp3$/.test(f) && scred.includes("`step1.mp3` … `step4.mp3`"))) && /CC0/.test(scred) && /CC BY-SA 4\.0/.test(scred), sounds.filter((f) => !scred.includes("`" + f + "`")).join(", "));
    check("the device's voice is only ever a local one", /v\.localService/.test(asrc));
    const mani = JSON.parse(read("manifest.webmanifest"));
    const icons = (mani.icons || []).map((i) => i.src);
    check("manifest icons exist", icons.every(exists), icons.filter((f) => !exists(f)).join(", "));
    check("manifest icons are in SHELL", icons.every((f) => shell.includes(f)));
    check("the vendored three.js is where the import map says", /"three":"\.\/vendor\/build\/three\.module\.min\.js"/.test(html) && exists("vendor/build/three.module.min.js") && exists("vendor/LICENSE-three.txt"));
  }

  section("Static: ids, info topics and icons");
  {
    const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    const wanted = new Set();
    for (const src of jsFiles.map(read)) {
      for (const m of src.matchAll(/(?:\$|getElementById|el)\(\s*"([A-Za-z][\w-]*)"\s*\)/g)) wanted.add(m[1]);
      for (const m of src.matchAll(/\bset\(\s*"([A-Za-z][\w-]*)"\s*,/g)) wanted.add(m[1]);
    }
    const missing = [...wanted].filter((id) => !ids.has(id) && !id.startsWith("scr-"));
    check("every id the scripts reach for is in index.html (" + wanted.size + ")", missing.length === 0, missing.join(", "));
    for (const s of ["title", "play", "loadout", "settings", "pause", "results", "servers", "rooms", "roomset", "room"]) if (!ids.has("scr-" + s)) fail("screen scr-" + s + " exists");
    const info = await imp("js/info.js").catch((e) => { fail("info.js imports in Node", e.message); return null; });
    if (info) {
      const topics = new Set(info.keys());
      const used = new Set([...(html + allJs).matchAll(/data-info="([\w-]+)"/g)].map((m) => m[1]));
      const bad = [...used].filter((k) => !topics.has(k));
      check("every data-info names a topic (" + used.size + " used)", bad.length === 0, bad.join(", "));
    }
    const icons = await imp("js/icons.js");
    const names = new Set(Object.keys(icons.ICONS));
    const usedIcons = new Set([...html.matchAll(/data-icon="(\w+)"/g)].map((m) => m[1]));
    for (const m of allJs.matchAll(/icon\(\s*"(\w+)"/g)) usedIcons.add(m[1]);
    const C = await imp("js/controls.js");
    for (const t of C.TOUCH) usedIcons.add(t.icon);
    const badIcons = [...usedIcons].filter((n) => !names.has(n));
    check("every icon named in the page, the scripts or the touch buttons exists (" + usedIcons.size + ")", badIcons.length === 0, badIcons.join(", "));
    const unbalanced = [...names].filter((n) => { const svg = icons.icon(n); return (svg.match(/<(svg|path|circle)\b/g) || []).length !== (svg.match(/\/>|<\/svg>/g) || []).length; });
    check("every icon is balanced markup", unbalanced.length === 0, unbalanced.join(", "));
  }

  section("Static: what was lifted says so, and stays lifted");
  {
    const peer = read("js/peer.js"), kn = fs.readFileSync(path.join(ROOT, "..", "karaokenatin", "js", "peer.js"), "utf8");
    check("peer.js says where it was lifted from", /Lifted from KaraokeNatin \(karaokenatin\/js\/peer\.js\)/.test(peer));
    check("its own namespace and peer-id prefix", /global\.HKN = global\.HKN/.test(peer) && /"hkx-" \+ normalizeCode/.test(peer) && !/"kn-"/.test(peer));
    const body = (t) => t.slice(t.indexOf("(function (global) {"));
    const undo = body(peer)
      .replace(/HKN/g, "KN").replace(/HK_BROKERS/g, "KN_BROKERS").replace(/"hkxc-"/g, '"knc-"').replace(/"hkx-"/g, '"kn-"').replace(/hkx-<code>/g, "kn-<code>")
      .replace(/"hk_"/g, '"kn_"').replace(/"hk"/g, '"kn"').replace(/"\[hk\] /g, '"[kn] ').replace("var ICE = global.HK_ICE || {", "var ICE = {")
      .replace('\n        self.emit("id-taken", BROKERS.indexOf(cfg), round);', "").replace(", index: BROKERS.indexOf(cfg) }", " }");
    check("and otherwise KaraokeNatin's file, line for line", undo === body(kn), (() => { const a = undo.split("\n"), b = body(kn).split("\n"); const i = a.findIndex((l, k) => l !== b[k]); return "first difference at line " + i + ": " + (a[i] || "").trim().slice(0, 80); })());
    const broker = read("tools/broker.js"), knb = fs.readFileSync(path.join(ROOT, "..", "karaokenatin", "tools", "broker.js"), "utf8");
    const code = (t) => t.slice(t.indexOf('"use strict";'));
    check("the local broker is KaraokeNatin's, code unchanged", /Lifted unchanged from karaokenatin\/tools\/broker\.js/.test(broker) && code(broker) === code(knb));
    check("lobby.js says where it was lifted from", /Lifted from Magic Sandbox's multiplayer/.test(read("js/lobby.js")));
    check("update.js says where it was lifted from", /Lifted from Magic Sandbox \(magic_sandbox\/js\/update\.js\)/.test(read("js/update.js")));
    check("info.js says where it was lifted from", /Lifted from Magic Sandbox \(magic_sandbox\/js\/info\.js\)/.test(read("js/info.js")));
  }

  section("Static: hacks cannot reach out");
  {
    const w = read("js/hackworker.js");
    for (const k of ["fetch", "XMLHttpRequest", "WebSocket", "importScripts", "postMessage", "RTCPeerConnection"]) check("the worker closes " + k + " before any hack runs", new RegExp('"' + k + '"').test(w.slice(0, w.indexOf("const TR ="))));
    check("hack code runs in strict mode", /'"use strict";\\n' \+ msg\.code/.test(w));
    const api = read("js/hackapi.js");
    check("the page applies only input, self, view, drawing and highlights from a reply", !/latest\.(?!input|self|view|draw|hl|n\b)\w+/.test(api.replace(/latest\.n\b/g, "")), (api.match(/latest\.(?!input|self|view|draw|hl|n\b)\w+/g) || []).join(", "));
  }

  /* ============================================================
     2. Behaviour checks
     ============================================================ */
  const BR = await imp("js/brush.js");
  const MV = await imp("js/movement.js");
  const { box, prism, buildWorld, trace, ray } = BR;
  const { newBody, pmove, TICK, B, PM, hspeed, lungeFactor, lookDir } = MV;
  const flat = buildWorld([box(-500, -1, -500, 500, 0, 500, { kind: "floor" }), box(10, 0, -5, 12, 12, 5, { kind: "wall" }), box(-30, 0, -5, -29, 12, 5, { kind: "wall" }), box(-26, 0, -5, -25, 12, 5, { kind: "wall" })]);
  const idle = (yaw) => ({ fwd: 0, side: 0, yaw: yaw || 0, pitch: 0, buttons: 0 });
  function run(p, ticks, cmdf, W, o) { for (let i = 0; i < ticks; i++) { pmove(W || flat, p, cmdf(i, p), TICK, o || {}); p.ev.length = 0; } return p; }

  section("Behaviour: brushes");
  {
    const t = trace(flat, 0, 5, 0, 0, -5, 0, 0.4, 0.9, 0.4);
    check("a box dropped on the floor stops a hull's height above it", Math.abs(t.y - 0.9) < 0.01 && t.ny === 1, t.y);
    check("a ray into a wall stops at the wall", Math.abs(ray(flat, 0, 1, 0, 20, 1, 0).x - 10) < 0.01);
    check("a box that starts inside something says so", trace(flat, 11, 1, 0, 11, 1, 0, 0.1, 0.1, 0.1).startsolid);
    const W = buildWorld([prism([[0, 0], [10, 0], [10, 5]], "z", -5, 5, { kind: "slope" })]);
    const r = ray(W, 5, 10, 0, 5, -1, 0);
    check("a slope's surface is where its plane says", Math.abs(r.y - 2.5) < 0.01 && r.ny > 0.8, r.y);
  }

  section("Behaviour: Source movement");
  {
    const settle = () => run(newBody(0, 0.02, 0, 0), 16, () => idle());
    check("a body settles onto the floor", settle().onGround);
    const walk = run(settle(), 128, () => ({ fwd: 1, side: 0, yaw: 0, pitch: 0, buttons: 0 }));
    check("running tops out at the run speed", Math.abs(hspeed(walk) - PM.run) < 0.01, hspeed(walk));
    const sp = run(settle(), 128, () => ({ fwd: 1, side: 0, yaw: 0, pitch: 0, buttons: B.SPRINT }));
    check("sprinting tops out at the sprint speed", Math.abs(hspeed(sp) - PM.sprint) < 0.01, hspeed(sp));
    let apex = 0;
    run(settle(), 100, (i, p) => { apex = Math.max(apex, p.y); return { fwd: 0, side: 0, yaw: 0, pitch: 0, buttons: i === 2 ? B.JUMP : 0 }; });
    check("a jump reaches about a metre", apex > 0.95 && apex < 1.25, apex.toFixed(3));
    const hop = (mode) => {
      const p = settle(); p.vz = -9;
      run(p, 64 * 5, (i, q) => ({ fwd: 0, side: 0, yaw: 0, pitch: 0, buttons: mode === "hold" ? B.JUMP : mode === "perfect" ? (q.onGround ? B.JUMP : 0) : q.onGround && q.groundTicks >= 3 ? B.JUMP : 0 }));
      return hspeed(p);
    };
    check("a perfect bunny hop keeps every bit of speed", Math.abs(hop("perfect") - 9) < 0.01, hop("perfect"));
    check("holding jump does not hop: friction takes the speed", hop("hold") < 0.5, hop("hold"));
    check("a late jump loses speed on every landing", hop("late") < 6, hop("late"));
    // air strafing: hold one side key and turn at the best angle
    const strafe = (() => {
      const p = settle(); p.vz = -PM.sprint;
      let dir = 1;
      run(p, 64 * 6, (i, q) => {
        if (i % 48 === 0) dir = -dir;
        const vang = Math.atan2(-q.vx, -q.vz), s = Math.max(0.01, hspeed(q));
        const theta = Math.acos(Math.min(1, (PM.aircap - PM.airaccelerate * PM.run * TICK) / s));
        return { fwd: 0, side: -dir, yaw: vang + dir * (Math.PI / 2 - theta), pitch: 0, buttons: q.onGround ? B.JUMP : 0 };
      });
      return hspeed(p);
    })();
    check("air strafing gains speed beyond any ground speed", strafe > PM.sprint * 1.5, strafe.toFixed(2));
    const wStraight = (() => { const p = settle(); p.vz = -9; run(p, 64 * 3, (i, q) => ({ fwd: 1, side: 0, yaw: 0, pitch: 0, buttons: q.onGround ? B.JUMP : 0 })); return hspeed(p); })();
    check("holding W in the air adds nothing past the cap", wStraight <= 9.001, wStraight);
    // surf: a 53-degree ridge
    const SW = buildWorld([box(-500, -60, -500, 500, -59, 500), prism([[-6, -1], [6, -1], [0, 7.5]], "z", -200, 200, { kind: "surf" })]);
    const surfer = newBody(-3.2, 4.2, 150, 0); surfer.vz = -12;
    let grounded = false;
    // holding D pushes into the left face of the ridge, which is what keeps you on it
    run(surfer, 64 * 2, (i, q) => { grounded = grounded || q.onGround; return { fwd: 0, side: 1, yaw: 0, pitch: 0, buttons: 0 }; }, SW);
    check("a surf ramp is never ground", !grounded && surfer.gny === 1);
    check("and sliding along it keeps the speed along it", Math.abs(surfer.vz) > 11.5, surfer.vz.toFixed(2));
    // slide
    const slider = run(settle(), 128, () => ({ fwd: 1, side: 0, yaw: 0, pitch: 0, buttons: B.SPRINT }));
    let slid = 0, peak = 0;
    run(slider, 200, (i, q) => { if (q.sliding) slid++; peak = Math.max(peak, hspeed(q)); return { fwd: 1, side: 0, yaw: 0, pitch: 0, buttons: B.CROUCH }; });
    check("crouching at a sprint slides, with a boost", slid > 40 && peak > PM.sprint + 1, slid + " ticks, peak " + peak.toFixed(2));
    check("and the slide ends in a crouch", !slider.sliding && slider.crouched);
    const sprintCmd = () => ({ fwd: 1, side: 0, yaw: 0, pitch: 0, buttons: B.SPRINT });
    const pushOf = (cd, ncd) => { const q = run(settle(), 128, sprintCmd); q.slideCd = cd; q.slideNudgeCd = ncd; const s0 = hspeed(q); run(q, 1, () => ({ fwd: 1, side: 0, yaw: 0, pitch: 0, buttons: B.CROUCH })); return hspeed(q) - s0; };
    const pushes = [pushOf(0, 0), pushOf(1, 0), pushOf(1, 1)];
    check("a slide gets the boost, or on its cooldown a smaller push, and neither more often than allowed", pushes[0] > 1.6 && pushes[1] > 0.6 && pushes[1] < 1.2 && pushes[2] < 0.1, pushes.map((v) => v.toFixed(2)).join(", "));
    const spam = run(settle(), 128, sprintCmd);
    let spamTop = 0;
    run(spam, 320, (i, q) => { spamTop = Math.max(spamTop, hspeed(q)); return { fwd: 1, side: 0, yaw: 0, pitch: 0, buttons: i % 4 < 2 ? B.CROUCH : B.SPRINT }; });
    check("tapping crouch over and over builds no speed", spamTop < PM.sprint + PM.slideBoost + 0.6, spamTop.toFixed(2) + " (sprint " + PM.sprint + ")");
    const hill = buildWorld([prism([[0, 0], [40, 0], [0, 16]], "z", -5, 5, { kind: "slope" }), box(-500, -1, -500, 500, 0, 500)]);
    const down = newBody(4, 14.6, 0, -Math.PI / 2); down.vx = 7;
    run(down, 20, () => ({ fwd: 1, side: 0, yaw: -Math.PI / 2, pitch: 0, buttons: B.SPRINT }), hill);
    const s0 = hspeed(down);
    run(down, 2, () => ({ fwd: 1, side: 0, yaw: -Math.PI / 2, pitch: 0, buttons: B.CROUCH }), hill);
    run(down, 60, () => ({ fwd: 1, side: 0, yaw: -Math.PI / 2, pitch: 0, buttons: B.CROUCH }), hill);
    check("a slide downhill speeds up", down.sliding && hspeed(down) > s0 + 1, s0.toFixed(2) + " -> " + hspeed(down).toFixed(2));
    // a ramp: crouch from a standstill and it takes you down; it used to freeze you where you crouched
    const ramp = buildWorld([box(-50, -1, -80, 50, 0, 50), prism([[0, 0], [-20, 12], [-20, 0]], "x", -10, 10, { kind: "slope" })]);
    const sitter = newBody(0, 6.6, -10, Math.PI);
    run(sitter, 30, () => idle(Math.PI), ramp);
    run(sitter, 64 * 3, () => ({ fwd: 0, side: 0, yaw: Math.PI, pitch: 0, buttons: B.CROUCH }), ramp);
    check("crouching on a ramp slides you down it, from a standstill", sitter.z > 0 && sitter.y < 0.1, sitter.z.toFixed(2) + ", " + sitter.y.toFixed(2));
    // a slope too steep to stand on: you slide to its foot, crouched or not, never stopping halfway
    for (const deg of [50, 60]) {
      const L = 12 / Math.tan(deg * Math.PI / 180);
      const steep = buildWorld([box(-50, -1, -80, 50, 0, 50), prism([[0, 0], [-L, 12], [-L, 0]], "x", -10, 10, { kind: "surf" })]);
      const res = [0, B.CROUCH].map((btn) => { const q = newBody(0, 6.5, -L / 2, Math.PI); run(q, 64 * 3, () => ({ fwd: 0, side: 0, yaw: Math.PI, pitch: 0, buttons: btn }), steep); return q; });
      check("a " + deg + "° slope is slid down to the floor, standing or crouched", res.every((q) => q.onGround && q.y < 0.1 && q.z > -1), res.map((q) => q.z.toFixed(2) + "/" + q.y.toFixed(2)).join(" "));
    }
    // the grapple's rope: reeled in, it lets go at the hook; across under it, it swings you up the far side
    const HK = MV.HOOK;
    const hooked = (x, y, z, hx, hy, hz) => { const q = newBody(x, y, z, 0); q.hook = HK.ON; q.hx = hx; q.hy = hy; q.hz = hz; q.hLen = Math.hypot(hx - x, hy - y - 0.9, hz - z); return q; };
    const reel = hooked(0, 0.02, 0, 0, 12, -25);
    let done = -1;
    for (let i = 0; i < 64 * 4 && done < 0; i++) { pmove(flat, reel, idle(), TICK, {}); if (reel.ev.includes("hookdone")) done = i; reel.ev.length = 0; }
    check("the grapple reels you in, and lets go by itself at the hook", done > 0 && reel.hook === HK.IDLE && Math.hypot(reel.x, reel.y + 0.9 - 12, reel.z + 25) < 2.6, done + " ticks, at " + [reel.x, reel.y, reel.z].map((v) => v.toFixed(1)).join(","));
    const swing = hooked(-15, 6, 0, 0, 22, 0); swing.vx = 18;
    let swingTop = 0, swingX = -15;
    for (let i = 0; i < 80; i++) { pmove(flat, swing, idle(-Math.PI / 2), TICK, {}); swing.ev.length = 0; if (swing.x > 0) swingTop = Math.max(swingTop, swing.y); swingX = Math.max(swingX, swing.x); }
    check("a rope swings: across under the hook carries you up the far side", swingX > 5 && swingTop > 12, swingX.toFixed(1) + " m across, up to " + swingTop.toFixed(1));
    const yanked = settle();
    for (let i = 0; i < 64; i++) { yanked.yank = [0, 1, -20]; pmove(flat, yanked, idle(), TICK, {}); yanked.ev.length = 0; }
    check("a hook in a body pulls it towards whoever holds it, off its feet", yanked.z < -10 && hspeed(yanked) > 8, yanked.z.toFixed(1));
    // climb
    const cl = newBody(8, 0.02, 0, -Math.PI / 2);
    run(cl, 40, () => ({ fwd: 1, side: 0, yaw: -Math.PI / 2, pitch: 0, buttons: 0 }));
    let top = 0, climbed = false;
    run(cl, 150, (i, q) => { top = Math.max(top, q.y); climbed = climbed || q.climbing; return { fwd: 1, side: 0, yaw: -Math.PI / 2, pitch: 0, buttons: B.JUMP }; });
    check("jumping into a wall and holding climbs it", climbed && top > 3.5, top.toFixed(2));
    // wall jump: along a wall at 8 m/s, tap jump
    const wj = newBody(9.55, 2, -4, Math.PI); wj.vz = 8;
    const ev = [];
    for (let i = 0; i < 3; i++) { pmove(flat, wj, { fwd: 0, side: 0, yaw: Math.PI, pitch: 0, buttons: i === 1 ? B.JUMP : 0 }, TICK, {}); ev.push(...wj.ev); wj.ev.length = 0; }
    check("tapping jump beside a wall kicks off it", ev.includes("walljump") && wj.vx < -5 && wj.vy > 5, wj.vx.toFixed(2));
    check("and keeps the speed along the wall", Math.abs(wj.vz - 8) < 0.01, wj.vz);
    const again = [];
    for (let i = 0; i < 20; i++) { pmove(flat, wj, { fwd: 0, side: 0, yaw: Math.PI, pitch: 0, buttons: i % 2 ? B.JUMP : 0 }, TICK, {}); again.push(...wj.ev); wj.ev.length = 0; wj.x = Math.max(wj.x, 9.5); }
    check("the same wall twice in a row does not count", !again.includes("walljump"));
    // two walls: zigzag up a shaft
    const zz = newBody(-28.9, 1, 0, 0);
    let kicks = 0, zmax = 0;
    for (let i = 0; i < 64 * 3; i++) {
      pmove(flat, zz, { fwd: 0, side: 0, yaw: 0, pitch: 0, buttons: i % 6 === 0 ? B.JUMP : 0 }, TICK, {});
      kicks += zz.ev.filter((e) => e === "walljump").length; zz.ev.length = 0; zmax = Math.max(zmax, zz.y);
    }
    check("a shaft of two walls can be kicked up, wall to wall", kicks >= 3 && zmax > 2.5, kicks + " kicks, " + zmax.toFixed(2) + " m");
    // lunge
    const m = { charge: 0.5, speed: 18, dash: 0.35 };
    const lunge = (pitch) => { const p = settle(); run(p, 64, () => ({ fwd: 0, side: 0, yaw: 0, pitch, buttons: B.LUNGE }), flat, { melee: m }); run(p, 1, () => ({ fwd: 0, side: 0, yaw: 0, pitch, buttons: 0 }), flat, { melee: m }); return p; };
    const up = lunge(1.4), along = lunge(0);
    check("holding lunge on the floor sticks you there", (() => { const p = settle(); run(p, 30, () => ({ fwd: 1, side: 0, yaw: 0, pitch: 0, buttons: B.LUNGE }), flat, { melee: m }); return p.lungeStuck && hspeed(p) === 0; })());
    check("facing away from the surface launches hardest", up.lungePower > 0.9 && along.lungePower < 0.35, up.lungePower.toFixed(2) + " vs " + along.lungePower.toFixed(2));
    check("lungeFactor agrees with the launch", Math.abs(lungeFactor(1, true, 0, 1, 0, lookDir(0, 1.4)) - up.lungePower) < 1e-9);
    const ceil = buildWorld([box(-50, -1, -50, 50, 0, 50), box(-50, 4, -50, 50, 5, 50)]);
    const c = newBody(0, 1.95, 0, 0); c.vy = 5;
    for (let i = 0; i < 20; i++) { pmove(ceil, c, { fwd: 0, side: 0, yaw: 0, pitch: -1.4, buttons: B.LUNGE }, TICK, { melee: m }); c.ev.length = 0; }
    check("a charge against a ceiling sticks you to it", c.lungeStuck && c.lny < -0.9 && c.vy === 0);
    check("without a blade in hand the lunge does nothing", (() => { const p = settle(); run(p, 30, () => ({ fwd: 1, side: 0, yaw: 0, pitch: 0, buttons: B.LUNGE }), flat, { melee: null }); return p.lunge === 0 && !p.lungeStuck && hspeed(p) > 1; })());
    check("a quick tap is a swing, not a lunge", (() => { const p = settle(); run(p, 3, () => ({ fwd: 0, side: 0, yaw: 0, pitch: 0, buttons: B.LUNGE }), flat, { melee: m }); const e = []; pmove(flat, p, idle(), TICK, { melee: m }); e.push(...p.ev); return e.includes("swing"); })());
  }

  section("Behaviour: the same game at any frame rate");
  {
    const { makeClock } = await imp("js/clock.js");
    // five seconds of bunny hopping and strafing, driven through the game's clock at four frame rates
    const play = (fps) => {
      const p = newBody(0, 0.02, 0, 0); p.vz = -7;
      const clock = makeClock(TICK, 16);
      let t = 0, n = 0, at = null;
      const frames = Math.ceil(5.2 * fps);
      for (let f = 0; f < frames; f++) {
        clock.advance(1 / fps, (dt) => {
          t += dt; n++;
          const side = Math.floor(t / 0.6) % 2 ? 1 : -1;
          pmove(flat, p, { fwd: 0, side, yaw: -side * t * 0.8, pitch: 0, buttons: p.onGround ? B.JUMP : 0 }, dt, {});
          p.ev.length = 0;
          if (n === 320) at = { x: p.x, z: p.z, s: hspeed(p) };    // five seconds of ticks
        });
      }
      return at;
    };
    const r = [30, 60, 144, 240].map(play);
    const same = r.every((q) => q && Math.abs(q.x - r[0].x) < 1e-9 && Math.abs(q.z - r[0].z) < 1e-9 && Math.abs(q.s - r[0].s) < 1e-9);
    check("30, 60, 144 and 240 fps put the same body in the same place, at the same speed", same, r.map((q) => q && q.x.toFixed(4) + "," + q.z.toFixed(4)).join(" | "));
    const jitter = (() => { const clock = makeClock(TICK, 16); let n = 0; let seed = 7; for (let i = 0; i < 1000; i++) { seed = (seed * 16807) % 2147483647; clock.advance(0.004 + (seed / 2147483647) * 0.03, () => n++); } return n; })();
    check("an uneven frame rate still pays out one tick per 1/64 s", Math.abs(jitter - Math.floor(((() => { let s = 7, t = 0; for (let i = 0; i < 1000; i++) { s = (s * 16807) % 2147483647; t += 0.004 + (s / 2147483647) * 0.03; } return t; })()) * 64)) <= 1, jitter);
    const slow = (() => { const clock = makeClock(TICK, 16); let n = 0; for (let i = 0; i < 50; i++) clock.advance(0.2, () => n++); return n; })();
    check("five frames a second still plays in real time", slow === 640, slow);
    check("main.js runs the game through that clock", /clock\.advance\(dt, game\.tick\)/.test(read("js/main.js")));
  }

  section("Behaviour: the arena and its bots' map");
  {
    const MAP = await imp("js/map.js");
    const NAV = await imp("js/nav.js");
    const W = MAP.buildMap();
    check("the arena is closed: a lid and four walls", W.brushes.some((b) => b.kind === "clip") && W.min[0] <= -64 && W.max[0] >= 64);
    check("every spawn point is somewhere a body fits", W.spawns.every((s) => MV.fits(W, s.x, s.y, s.z, false)), W.spawns.length);
    check("every kind of place is there: surf, shaft, slope, canopy, pad, and the Skyway, the Halo and kites above them", ["surf", "shaft", "slope", "canopy", "pad", "bridge", "halo", "kite"].every((k) => W.brushes.some((b) => b.kind === k)));
    const surfFaces = W.brushes.filter((b) => b.kind === "surf").flatMap((b) => b.faces).filter((f) => f.n[1] > 0.1);
    check("the surf ridges are too steep to stand on", surfFaces.length > 0 && surfFaces.every((f) => f.n[1] < PM.walkable));
    const pad = W.brushes.find((b) => b.kind === "pad" && b.min[0] > 0 && b.min[2] > 0);
    const flyer = newBody((pad.min[0] + pad.max[0]) / 2, 0.3, (pad.min[2] + pad.max[2]) / 2, 0);
    let flew = false, landed = null;
    for (let i = 0; i < 64 * 4 && !landed; i++) { pmove(W, flyer, idle(), TICK, {}); if (flyer.ev.includes("pad")) flew = true; else if (flew && flyer.onGround) landed = [flyer.y, flyer.groundKind]; flyer.ev.length = 0; }
    check("a jump pad throws you up onto the launch deck", landed && landed[0] > 7, JSON.stringify(landed));
    const t0 = Date.now();
    const nav = NAV.buildNav(W);
    check("the nav graph builds quickly", Date.now() - t0 < 2000, (Date.now() - t0) + " ms, " + nav.nodes.length + " nodes");
    const sp = W.spawns.map((s) => NAV.nearestNode(nav, s.x, s.y, s.z));
    let fails = 0;
    for (const a of sp) for (const b of sp) if (a !== b && !NAV.findPath(nav, a, b)) fails++;
    check("from every spawn, a bot can reach every other", fails === 0, fails + " unreachable pairs");
    const kinds = new Set(nav.nodes.flatMap((n) => n.links.map((l) => l.kind)));
    check("bots know to walk, jump, climb, drop and ride a pad", ["walk", "jump", "climb", "drop", "pad"].every((k) => kinds.has(k)), [...kinds].join(","));
    const high = (y0, y1) => nav.nodes.filter((n) => n.reach && n.y > y0 && n.y < y1).length;
    check("bots can reach the Skyway and the Halo", high(11.5, 12.5) > 150 && high(15.5, 16.5) > 12, high(11.5, 12.5) + " on the Skyway, " + high(15.5, 16.5) + " on the Halo");
    check("and never wander to what only a grapple reaches", nav.nodes.some((n) => !n.reach && n.y > 13.5 && n.y < 14.5));
    const flyFrom = (b) => { const q = newBody((b.min[0] + b.max[0]) / 2, 0.3, (b.min[2] + b.max[2]) / 2, 0); let f = false, l = null; for (let i = 0; i < 64 * 5 && !l; i++) { pmove(W, q, idle(), TICK, {}); if (q.ev.includes("pad")) f = true; else if (f && q.onGround) l = q.groundKind; q.ev.length = 0; } return l; };
    const lands = W.brushes.filter((b) => b.kind === "pad" && b.min[0] > 0 && b.min[2] > 0).map(flyFrom);
    check("pads throw you onto the launch deck, the Skyway and the Halo", lands.includes("block") && lands.includes("bridge") && lands.includes("halo"), lands.join(","));
  }

  section("Behaviour: weapons");
  {
    const WP = await imp("js/weapons.js");
    const g = Object.values(WP.GUNS);
    check("two handguns", g.filter((x) => x.hold === "pistol").length === 2);
    check("two full-auto guns", g.filter((x) => x.auto).length === 2);
    check("one shotgun, two snipers — scoped bolt actions whose rounds fly", g.filter((x) => x.pellets > 1).length === 1 && g.filter((x) => x.projectile).length === 2 && g.filter((x) => x.projectile).every((x) => x.scope && x.bolt && x.projectile.instant > 0));
    check("the Condor kills with one hit anywhere", ["head", "body", "nut", "arm", "leg"].every((p) => WP.damageFor(WP.GUNS.condor, 150, p) >= 100) && WP.GUNS.condor.adsTime > WP.GUNS.talon.adsTime && WP.GUNS.condor.speedMul < WP.GUNS.talon.speedMul);
    check("every gun's rounds go through bodies, losing damage each time, snipers furthest", g.every((x) => x.pen && x.pen[1] < 1) && WP.GUNS.condor.pen[0] >= 3 && WP.GUNS.talon.pen[0] > WP.GUNS.hornet.pen[0]);
    check("a nut shot does more than the body, less than the head", WP.damageFor(WP.GUNS.kestrel, 5, "nut") > WP.damageFor(WP.GUNS.kestrel, 5, "body") && WP.damageFor(WP.GUNS.kestrel, 5, "nut") < WP.damageFor(WP.GUNS.kestrel, 5, "head"));
    check("a blade hits harder the faster you go: nothing extra at a run, twice at 18 m/s", WP.speedBonus(5) === 1 && Math.abs(WP.speedBonus(18) - 2) < 1e-9 && WP.speedBonus(40) === 2.5);
    {
      const S2 = WP.newArms({ primary: "talon", secondary: "wasp", melee: "katana" });
      const b2 = newBody(0, 0, 0, 0); b2.onGround = true;
      for (let i = 0; i < 40; i++) WP.armsTick(S2, { buttons: B.ADS, slot: 0 }, b2, TICK, Math.random, B);
      const z1 = WP.zoomOf(S2);
      WP.armsTick(S2, { buttons: B.ADS | B.ZOOM, slot: 0 }, b2, TICK, Math.random, B);
      const z2 = WP.zoomOf(S2);
      WP.armsTick(S2, { buttons: B.ADS | B.FIRE, slot: 0 }, b2, TICK, Math.random, B);
      WP.armsTick(S2, { buttons: B.ADS, slot: 0 }, b2, TICK, Math.random, B);
      const cyc = WP.boltOf(S2);
      for (let i = 0; i < 100; i++) WP.armsTick(S2, { buttons: 0, slot: 0 }, b2, TICK, Math.random, B);
      check("a scope's second zoom doubles it, and letting go of aim resets it", Math.abs(z2 - z1 * 2) < 1e-9 && S2.zoom === 0, z1 + " -> " + z2);
      check("after a shot the bolt is worked, and boltOf says how far", cyc > 0 && cyc < 0.1 && WP.boltOf(S2) === 0, cyc);
    }
    check("two blades that both lunge, differently", WP.MELEE_IDS.length === 2 && WP.MELEE.katana.charge < WP.MELEE.lancer.charge && WP.MELEE.katana.speed < WP.MELEE.lancer.speed && WP.MELEE.katana.lungeCone > WP.MELEE.lancer.lungeCone);
    check("a headshot does more than a body shot, a limb less", WP.damageFor(WP.GUNS.kestrel, 5, "head") > WP.damageFor(WP.GUNS.kestrel, 5, "body") && WP.damageFor(WP.GUNS.kestrel, 5, "leg") < WP.damageFor(WP.GUNS.kestrel, 5, "body"));
    check("damage falls off with range", WP.damageFor(WP.GUNS.hornet, 50, "body") < WP.damageFor(WP.GUNS.hornet, 5, "body"));
    check("a loadout from storage is cleaned", JSON.stringify(WP.cleanLoadout({ primary: "nope", secondary: "talon", melee: 3 })) === JSON.stringify({ primary: "kestrel", secondary: "talon", melee: "katana" }));
    const A = WP.newArms({ primary: "wasp", secondary: "talon", melee: "lancer" });
    const body = newBody(0, 0, 0, 0); body.onGround = true;
    let r = 0.5; const rng = () => (r = (r * 9301 + 49297) % 233280 / 233280);
    let fired = 0;
    for (let i = 0; i < 64; i++) for (const e of WP.armsTick(A, { buttons: B.FIRE, slot: 0 }, body, TICK, rng, B)) if (e.type === "fire") fired++;
    check("a semi-automatic gun fires once per press", fired === 1, fired);
    fired = 0;
    for (let i = 0; i < 64; i++) for (const e of WP.armsTick(A, { buttons: i % 2 ? B.FIRE : 0, slot: 0 }, body, TICK, rng, B)) if (e.type === "fire") fired++;
    check("and as fast as it cycles when tapped", fired >= 6 && fired <= 8, fired);
    WP.armsTick(A, { buttons: 0, slot: 2 }, body, TICK, rng, B);
    for (let i = 0; i < 40; i++) WP.armsTick(A, { buttons: 0, slot: 0 }, body, TICK, rng, B);
    const shot = WP.armsTick(A, { buttons: B.FIRE, slot: 0 }, body, TICK, rng, B).find((e) => e.type === "fire");
    check("the sniper fires a round that flies", shot && shot.proj && shot.proj.speed > 0);
    check("recoil lifts the view", shot && shot.kick.pitch > 0);
    // slot 4: the grapple. Its trigger is game.js's; here it must neither shoot nor swing
    WP.armsTick(A, { buttons: 0, slot: 4 }, body, TICK, rng, B);
    const gEv = [];
    for (let i = 0; i < 30; i++) gEv.push(...WP.armsTick(A, { buttons: i % 2 ? B.FIRE : 0, slot: 0 }, body, TICK, rng, B));
    check("the grapple is slot 4, and Fire with it out neither shoots nor swings", A.cur === 3 && WP.grappleOut(A) && !gEv.some((e) => e.type === "fire" || e.type === "swing") && WP.holdOf(A) === "pistol", gEv.map((e) => e.type).join());
    WP.armsTick(A, { buttons: 0, slot: -1 }, body, TICK, rng, B);
    check("and the last weapon comes back from it", A.cur === 1, A.cur);
  }

  section("Behaviour: bones and hitboxes");
  {
    const SK = await imp("js/skeleton.js");
    check("seventeen bones", SK.BONES.length === 17);
    check("every link joins two real bones", SK.LINKS.every(([a, b]) => SK.BONES.includes(a) && SK.BONES.includes(b)));
    const bones = SK.pose({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0, vx: 0, vz: 0, onGround: true, eye: 1.62, phase: 0 }, "rifle");
    const head = [bones[SK.BI.head * 3], bones[SK.BI.head * 3 + 1], bones[SK.BI.head * 3 + 2]];
    check("standing, the head is at head height", head[1] > 1.55 && head[1] < 1.8, head[1]);
    const hit = SK.rayBones(bones, head[0], head[1], 10, 0, 0, -1, 50);
    check("a ray at the head hits the head", hit && hit.part === "head", hit && hit.part);
    const body = SK.rayBones(bones, 0, 1.1, 10, 0, 0, -1, 50);
    check("a ray at the chest hits the body", body && body.part === "body", body && body.part);
    check("a ray past the shoulder misses", !SK.rayBones(bones, 0.8, 1.2, 10, 0, 0, -1, 50));
    const crouched = SK.pose({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0, vx: 0, vz: 0, onGround: true, crouched: true, eye: 1.02, phase: 0 }, "rifle");
    check("crouching lowers the head", crouched[SK.BI.head * 3 + 1] < head[1] - 0.2);
    const np = SK.nutPoint(bones);
    const front = SK.rayBones(bones, np[0], np[1], np[2] - 10, 0, 0, 1, 50), back = SK.rayBones(bones, np[0], np[1], np[2] + 10, 0, 0, -1, 50);
    const facing = bones[SK.BI.head * 3 + 2] < 0.5;     // the standing body above faces -z
    const fromFront = facing ? front : back, fromBack = facing ? back : front;
    check("a shot between the legs from the front is a nut shot", fromFront && fromFront.part === "nut", fromFront && fromFront.part);
    check("from behind, however low, it is the body", fromBack && fromBack.part !== "nut", fromBack && fromBack.part);
  }

  section("Behaviour: match rules");
  {
    const MD = await imp("js/modes.js");
    const s = MD.cleanSettings({ mode: "zzz", max: 99, target: -4, hacks: "godmode", bots: "lots", diff: 3, priv: 1 });
    check("junk settings come out valid", s.mode === "ffa" && s.max === MD.MAX_PLAYERS && s.target >= MD.MODES.ffa.target.min && s.hacks === "full" && s.bots === 4 && s.diff === "normal" && s.priv === true, JSON.stringify(s));
    check("three hack rule levels, each allowing more", MD.HACK_RULES.visual.level < MD.HACK_RULES.assist.level && MD.HACK_RULES.assist.level < MD.HACK_RULES.full.level);
    const sc = MD.newScore(3);
    const team = () => 0;
    let res;
    for (let i = 0; i < 3; i++) res = MD.recordKill(sc, "ffa", team, 2, 1);
    check("free for all ends at the kill count", res.over && res.winner === 1 && sc.k[1] === 3 && sc.d[2] === 3);
    const t = MD.newScore(2), teamOf = (id) => (id < 3 ? 0 : 1);
    MD.recordKill(t, "tdm", teamOf, 3, 1); res = MD.recordKill(t, "tdm", teamOf, 4, 2);
    check("team deathmatch counts for the team", res.over && res.winner === 0 && t.tk[0] === 2);
    const ff = MD.newScore(5);
    MD.recordKill(ff, "tdm", teamOf, 2, 1);
    check("no friendly fire, and no score for it", !ff.k[1] && ff.d[2] === 1 && !MD.hostile("tdm", { id: 1, team: 0 }, { id: 2, team: 0 }));
    const fall = MD.newScore(5); MD.recordKill(fall, "ffa", team, 2, null);
    check("a fall is a death with no killer", fall.d[2] === 1 && Object.keys(fall.k).length === 0);
    check("bots fill the room up to the setting", MD.botCount(MD.cleanSettings({ bots: 6 }), 2) === 4 && MD.botCount(MD.cleanSettings({ bots: 1 }), 3) === 0);
    check("a room row from a stranger is cleaned or refused", MD.cleanListing({ code: "abc" }) === null && MD.cleanListing({ code: "ABCDEF", s: { mode: "practice" } }) === null && !!MD.cleanListing({ code: "abcdef", s: {}, n: 3 }));
    check("time runs out to whoever leads", MD.timeUp(Object.assign(MD.newScore(9), { k: { 4: 2, 5: 1 } }), "ffa") === 4);
  }

  section("Behaviour: a match, headless");
  {
    const WP_KATANA_SWING = (await imp("js/weapons.js")).MELEE.katana.swingDmg;
    // game.js is pure enough to play in Node: you and some dummies held still where the checks want them
    const ST = await imp("js/state.js"), G = await imp("js/game.js"), SK = await imp("js/skeleton.js");
    const { S } = ST;
    const feed = [], hits = [], moves = [];
    ST.on("killfeed", (k) => feed.push(k)); ST.on("hit", (a, b, d, i) => hits.push({ by: a, to: b, d, i }));
    ST.on("move", (a, e) => { if (a === S.me) moves.push(e); });
    let cmd = { fwd: 0, side: 0, buttons: 0, slot: 0 };
    G.setLocalCmd(() => Object.assign({}, cmd, { yaw: S.view.yaw, pitch: S.view.pitch }));
    const ticks = (n) => { for (let i = 0; i < n; i++) G.tick(TICK); };
    const put = (a, x, z, yaw) => { const b = a.body; b.x = x; b.y = 0.02; b.z = z; b.vx = b.vy = b.vz = 0; b.yaw = a.aim.yaw = yaw || 0; };
    const aimAt = (p) => { const e = G.eyeOf(S.me); S.view.yaw = Math.atan2(-(p[0] - e[0]), -(p[2] - e[2])); S.view.pitch = Math.atan2(p[1] - e[1], Math.hypot(p[0] - e[0], p[2] - e[2])); };
    const chest = (a) => [a.bones[SK.BI.chest * 3], a.bones[SK.BI.chest * 3 + 1], a.bones[SK.BI.chest * 3 + 2]];
    const match = (primary) => {
      S.net.role = "solo";
      G.startMatch({ mode: "ffa", bots: 4, diff: "normal", target: 25, time: 0, hacks: "full" }, { me: { id: 1, name: "Me", loadout: { primary, secondary: "wasp", melee: "katana" } }, humans: 1 });
      for (const b of S.actors) if (b.kind === "bot") b.passive = true;
      ticks(64);
      // dummies that do not even wander: a body with no speed stands where it is put, legs together
      const list = S.actors.filter((a) => a.kind === "bot");
      for (const b of list) b.body.speedScale = 0;
      return list;
    };
    // Targets that hold perfectly still: bodies owned "elsewhere", posed once, whose damage this test
    // applies the way their owner's machine would when it hears of the hit
    ST.on("netHit", (b, d, by, info) => G.applyDamage(b, d, by, info));
    let nextDummy = 4000;
    const dummy = (x, z, hp) => {
      const a = G.addActor(G.makeActor({ id: nextDummy++, name: "Dummy", kind: "dummy" }));
      a.alive = true; a.hp = hp || 100; put(a, x, z, Math.PI);
      a.bones = SK.pose(G.poseState(a), "rifle", a.bones);
      return a;
    };
    const head = (a) => [a.bones[SK.BI.head * 3], a.bones[SK.BI.head * 3 + 1], a.bones[SK.BI.head * 3 + 2]];
    // 1. one Condor round through three bodies in a line
    let bots = match("condor");
    put(S.me, 0, 34); cmd.buttons = B.ADS; ticks(40);
    const line = [dummy(0, 26), dummy(0, 24), dummy(0, 22)];
    aimAt(head(line[0])); cmd.buttons = B.ADS | B.FIRE; ticks(1); cmd.buttons = 0; ticks(4);
    const mine = hits.filter((h) => h.by === S.me);
    const shots = new Set(mine.map((h) => h.i.shot));
    check("one sniper round goes through three bodies, killing each: a collateral", feed.filter((k) => k.killer === S.me).length === 3 && shots.size === 1 && mine.map((h) => h.i.through).join() === "0,1,2", mine.map((h) => h.d + " " + h.i.part).join(", "));
    G.quit(); feed.length = 0; hits.length = 0;
    // 2. a nut shot
    bots = match("kestrel");
    const v = dummy(0, 30, 10);
    put(S.me, 0, 34); cmd.buttons = B.ADS; ticks(30);      // aimed: a hip shot's spread would land on a thigh as often as not
    aimAt(SK.nutPoint(v.bones)); cmd.buttons = B.ADS | B.FIRE; ticks(1); cmd.buttons = 0; ticks(3);
    check("a kill between the legs is a nut shot, in the kill feed", feed.some((k) => k.killer === S.me && k.nut), JSON.stringify(hits.map((h) => h.i.part)));
    // 3. the grapple catches a body, and each is pulled to the other
    const w = bots[1];
    if (v.alive) G.removeActor(v);
    bots.forEach((b, i) => { if (b !== w) put(b, 50, -50 + i * 4); });
    put(S.me, 0, 34); put(w, 0, 18, 0); ticks(1);
    // the grapple is a gun: with a rifle out its trigger does nothing; drawn, Fire sends the hook
    const ammo0 = S.me.arms.ammo[0];
    aimAt(chest(w)); cmd.buttons = B.HOOK; moves.length = 0; ticks(3);
    check("the grapple does nothing until it is drawn", !moves.includes("hookfire") && S.me.body.hook === 0, moves.join(","));
    cmd.buttons = 0; cmd.slot = 4; ticks(1); cmd.slot = 0;
    aimAt(chest(w)); cmd.buttons = B.FIRE;
    const wz = w.body.z, mz = S.me.body.z;
    for (let i = 0; i < 64 * 2 && !moves.includes("hookdone"); i++) ticks(1);
    cmd.buttons = 0; ticks(1);
    check("a hook catches a body, and pulls you both together until it lets go", moves.includes("hookgrab") && moves.includes("hookdone") && w.body.z > wz + 2 && S.me.body.z < mz - 5, moves.join(",") + " · them " + (w.body.z - wz).toFixed(1) + " m, you " + (S.me.body.z - mz).toFixed(1) + " m");
    check("the grapple is slot 4, and Fire was its trigger, not the rifle's", S.me.arms.cur === 3 && S.me.arms.ammo[0] === ammo0, S.me.arms.ammo[0] + " of " + ammo0);
    // 4. a blade at speed
    cmd.slot = 3; ticks(1); cmd.slot = 0; ticks(30); hits.length = 0;
    put(S.me, 0, 34); put(w, 0, 32.6, Math.PI); w.hp = 100; ticks(1);
    S.view.yaw = 0; S.view.pitch = 0; S.me.body.vz = -16; cmd.buttons = B.MELEE; ticks(1); cmd.buttons = 0;
    const cut = hits.find((h) => h.by === S.me && h.i.melee);
    check("a blade swung at speed cuts deeper", cut && cut.d > WP_KATANA_SWING * 1.4 && cut.i.speedMul > 1.4, cut && cut.d);
    G.quit();
  }

  section("Behaviour: controls and the saved record");
  {
    const C = await imp("js/controls.js");
    const defs = C.ACTIONS.flatMap((a) => a.def.filter(Boolean));
    check("no key is bound twice by default", new Set(defs).size === defs.length, defs.filter((d, i) => defs.indexOf(d) !== i).join(","));
    check("jump can be the wheel, as Source players bhop", C.ACTIONS.find((a) => a.id === "jump").def.includes("WheelDown"));
    check("Escape can never be bound", !C.validCode("Escape") && C.validCode("KeyG"));
    for (const o of ["landscape", "portrait"]) {
      const L = C.TOUCH_LAYOUTS[o];
      check("every touch button has a place when held " + o, C.TOUCH_IDS.every((id) => L[id] && L[id].x > 0 && L[id].x < 1 && L[id].y > 0 && L[id].y < 1));
    }
    // a button under another is one nobody can press or pick up in the editor: the defaults must not do it on any common screen
    for (const [o, w, h] of [["landscape", 844, 390], ["landscape", 740, 360], ["landscape", 667, 375], ["landscape", 1024, 768], ["portrait", 390, 844], ["portrait", 360, 740], ["portrait", 375, 667], ["portrait", 768, 1024]]) {
      const L = C.TOUCH_LAYOUTS[o];
      const c = C.TOUCH_IDS.map((id) => { const q = L[id]; return { id, x: Math.min(Math.max(q.x * w, q.s / 2), w - q.s / 2), y: Math.min(Math.max(q.y * h, q.s / 2), h - q.s / 2), r: q.s / 2 }; });
      const bad = [];
      for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++) if (Math.hypot(c[i].x - c[j].x, c[i].y - c[j].y) < c[i].r + c[j].r) bad.push(c[i].id + "/" + c[j].id);
      check("no two touch buttons start on top of each other, " + o + " " + w + "x" + h, bad.length === 0, bad.join(", "));
    }
    check("every action that can hold or toggle has a mode for keys and for touch", C.MODAL_IDS.every((id) => C.validMode(id, C.KEY_MODES[id]) && C.validMode(id, C.TOUCH_MODES[id])) && C.MODAL_IDS.every((id) => C.ACTION_IDS.includes(id)));
    // save.js reads localStorage at import; give it one to read
    const store = new Map();
    globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
    store.set("hacks:v1", JSON.stringify({
      name: "<b>x</b>", settings: { sens: 999, fov: 10, keyModes: { sprint: "fly", ads: "always", crouch: "mixed" }, touchModes: "nope", crosshair: "red" },
      binds: { jump: ["Escape", "Space"], fire: ["Mouse0", 5] },
      touch: { landscape: { fire: { x: 5, y: -2, s: 1000 } } },
      loadout: { primary: "rocket" },
      hacks: [{ id: "abcd1234", name: "ok", code: "log(1)", on: 1 }, { id: "abcd1234", name: "dupe" }, "junk"],
      solo: { bots: 99, mode: "boss" }
    }));
    const { save } = await imp("js/save.js");
    const d = save.data;
    check("stored settings are clamped, not trusted", d.settings.sens === 10 && d.settings.fov === 70 && d.settings.keyModes.sprint === "hold" && d.settings.crosshair === "#ffffff");
    check("a button mode is kept only where it means something", d.settings.keyModes.crouch === "mixed" && d.settings.keyModes.ads === "hold" && d.settings.touchModes.ads === "toggle");
    check("an Escape bind is dropped", d.binds.jump[0] === "" && d.binds.jump[1] === "Space" && d.binds.fire[1] === "");
    check("a touch button stored off screen is put back on it", d.touch.landscape.fire.x <= 0.97 && d.touch.landscape.fire.y >= 0.03 && d.touch.landscape.fire.s <= 220);
    check("hacks survive, duplicates and junk do not", d.hacks.length === 1 && d.hacks[0].on === true && d.hacks[0].code === "log(1)");
    check("a name cannot carry markup", !/[<>]/.test(d.name));
    check("solo setup is cleaned", d.solo.bots === 11 && d.solo.mode === "ffa");
  }

  section("Behaviour: the lessons");
  {
    const HD = await imp("js/hackdocs.js");
    const bad = [];
    for (const L of HD.LESSONS) { try { new Function("on", "ui", "log", "print", "hack", '"use strict";\n' + L.code); } catch (e) { bad.push(L.id + ": " + e.message); } }
    check("every lesson's code compiles (" + HD.LESSONS.length + ")", bad.length === 0, bad.join("; "));
    check("the starter hack compiles", (() => { try { new Function("on", "ui", "log", "print", "hack", '"use strict";\n' + HD.STARTER); return true; } catch (e) { return false; } })());
    check("lessons have unique ids", new Set(HD.LESSONS.map((l) => l.id)).size === HD.LESSONS.length);
    const api = HD.API.flatMap((s) => s.items.map((i) => i[0])).join(" ");
    for (const k of ["me.setVelocity", "input.yaw", "draw.line3d", "draw.highlight", "screen.toScreen", "world.raycast", "physics.simulate", "vec.angles", "ui.slider", "LINKS"]) check("the API reference covers " + k, api.includes(k));
  }

  section("Behaviour: the hack sandbox");
  {
    // A child process stands in for the Web Worker: `self` with postMessage and
    // message events, and the worker module imported into it.
    const probe = `
      const posted = [];
      const listeners = [];
      globalThis.self = globalThis;
      globalThis.postMessage = (m) => posted.push(JSON.parse(JSON.stringify(m)));
      globalThis.addEventListener = (t, fn) => { if (t === "message") listeners.push(fn); };
      const send = (m) => listeners.forEach((fn) => fn({ data: m }));
      const { buildMap } = await import(${JSON.stringify(pathToFileURL(path.join(ROOT, "js/map.js")).href)});
      const { exportWorld } = await import(${JSON.stringify(pathToFileURL(path.join(ROOT, "js/brush.js")).href)});
      await import(${JSON.stringify(pathToFileURL(path.join(ROOT, "js/hackworker.js")).href)});
      const W = buildMap();
      send({ t: "init", world: exportWorld(W), spawns: W.spawns });
      const z = (x, y, zz) => ({ x, y, z: zz });
      const bones = {}; for (const b of ["pelvis","spine","chest","neck","head","l_shoulder","l_elbow","l_hand","r_shoulder","r_elbow","r_hand","l_hip","l_knee","l_foot","r_hip","r_knee","r_foot"]) bones[b] = z(0, 1.2, -10);
      const me = { id: 1, name: "t", team: 0, bot: false, alive: true, hp: 100, maxHp: 100, position: z(0, 0, 20), velocity: z(0, 0, 0), speed: 0, yaw: 0, pitch: 0, eye: z(0, 1.62, 20), onGround: true, crouched: false, sliding: false, climbing: false, lunge: "idle", bones, kills: 0, deaths: 0, weapon: { melee: false, shots: 0, lastKick: { pitch: 0, yaw: 0 } } };
      const enemy = Object.assign({}, me, { id: 7, name: "e", enemy: true, position: z(0, 0, 10), eye: z(0, 1.62, 10), bones, distance: 10, weapon: { slot: 1 } });
      const snap = (rules, n) => ({ n, time: 1, tick: 64, dt: 1 / 60, rules, me, players: [enemy], projectiles: [], cam: { vp: [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1], w: 800, h: 600, hfov: 90 }, input: { forward: 0, side: 0, yaw: 0, pitch: 0, jump: false, crouch: false, sprint: false, fire: false, aim: false, reload: false, lunge: false, melee: false, slot: 1 }, keys: [], pressed: [], events: [], match: {} });
      const load = (id, code) => send({ t: "load", id, name: id, code });
      load("reads", 'let seen = 0; on("tick", () => { seen = enemies.length; input.fire = true; input.lookAt(enemies[0].bones.head); draw.line(0, 0, 10, 10, "red"); me.setVelocity(1, 2, 3); me.gravityScale = 0.5; view.fov = 110; });');
      load("writes", 'on("tick", () => { enemies[0].hp = 0; });');
      load("net", 'log(typeof fetch, typeof WebSocket, typeof XMLHttpRequest, typeof postMessage, typeof importScripts);');
      load("syntax", 'const a = 1;\\nconst b = ;\\nlog(a);');
      load("sloppy", 'on("tick", () => { oops = 3; });');
      send({ t: "frame", snap: snap("full", 1) });
      send({ t: "frame", snap: snap("visual", 2) });
      console.log(JSON.stringify(posted));
    `;
    const res = spawnSync(process.execPath, ["--input-type=module", "-e", probe], { encoding: "utf8", timeout: 30000 });
    let posted = null;
    try { posted = JSON.parse(res.stdout.trim().split("\n").pop()); } catch (e) { fail("the worker runs outside a browser for testing", (res.stderr || res.stdout).slice(0, 300)); }
    if (posted) {
      const loaded = (id) => posted.find((m) => m.t === "loaded" && m.id === id);
      const outs = posted.filter((m) => m.t === "out");
      const full = outs[0], visual = outs[1];
      check("a hack loads and says what it listens for", loaded("reads") && loaded("reads").ok && loaded("reads").events.includes("tick"));
      check("it can press fire and aim for you (rules: full)", full && full.input.fire === true && typeof full.input.yaw === "number");
      check("it can aim straight at an enemy's head", full && Math.abs(full.input.yaw) < 1e-9 && Math.abs(full.input.pitch - Math.atan2(1.2 - 1.62, 30)) < 1e-9, full && full.input.pitch);
      check("it can draw", full && full.draw.some((d) => d[0] === "l"));
      check("it can change its own body", full && Array.isArray(full.self.vel) && full.self.vel[2] === 3 && full.self.gravityScale === 0.5);
      check("and its own view", full && full.view.fov === 110);
      const wErr = full && full.errors.find((e) => e[0] === "writes");
      check("writing to an enemy is a TypeError, explained", !!wErr && /read only|read-only/.test(wErr[1]) && /only its own inputs/.test(wErr[1]), wErr && wErr[1]);
      const netLog = posted.find((m) => m.t === "loaded" && m.id === "net");
      check("the network and the page are out of reach", netLog && netLog.logs && netLog.logs.some((l) => l[2] === "undefined undefined undefined undefined undefined"), JSON.stringify(netLog && netLog.logs));
      const syn = loaded("syntax");
      check("a syntax error is reported on its line", syn && !syn.ok && syn.line === 2, syn && syn.line);
      const sl = full && full.errors.find((e) => e[0] === "sloppy");
      check("strict mode: an undeclared variable is an error, with a hint", !!sl && /not defined/.test(sl[1]) && /let or const/.test(sl[1]), sl && sl[1]);
      check("under visual-only rules, a hack's buttons are refused", visual && Object.keys(visual.input).length === 0 && !visual.self.vel);
      check("and it is told why", posted.some((m) => (m.logs || []).some((l) => /needs the room's hack rules/.test(l[2]))));
      check("but it may still draw", visual && visual.draw.length > 0);
    }
  }

  /* ============================================================ */
  process.stdout.write("\n" + (checks - failures.length) + "/" + checks + " checks passed\n");
  if (failures.length) { process.stdout.write("\nFailed:\n  " + failures.join("\n  ") + "\n"); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
