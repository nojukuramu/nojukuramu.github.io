#!/usr/bin/env node
/* ============================================================
   The Long Light — validation harness
   `node tools/validate.js`

   Same shape as lastflame/tools/validate.js (which is Ballzooka's). Two
   halves, both of which have to pass before anything ships:

   1. Static checks over the source as text: no emoji, every module parses,
      the page and the service worker carry one version, the worker never
      takes over by itself, everything the game loads is in the worker's
      shell and on disk (and the Full set is not in it), every Packed asset
      has its Full twin, every id the scripts reach for exists, every (i)
      names a topic, every icon named is drawn, every asset is credited, the
      shader lines the patches look for are in the vendored three, and the
      lifted files still say where they came from.

   2. Behaviour checks over the game, imported straight into Node (world.js,
      places.js, sun.js and game.js never touch the DOM): worlds are built
      from a dozen seeds and each must have its base, five camps and the
      last station on flat land; the flagged route must be walkable all the
      way; every site must hold the fuel for its own beacon on every
      difficulty; the sun must circle without setting in high summer and
      be gone at noon by the end; the rules (food, warmth, fuel, blackouts
      on each difficulty) must hold; and an autopilot must walk whole
      journeys, base to East Cape, and see the light answer.

   No dependencies, no build step.
   ============================================================ */
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..");
const failures = [];
let checks = 0;
function ok(name) { checks++; process.stdout.write("  \u2713 " + name + "\n"); }
function fail(name, detail) { checks++; failures.push(name + (detail ? " — " + detail : "")); process.stdout.write("  \u2717 " + name + (detail ? " \u2014 " + detail : "") + "\n"); }
function check(name, cond, detail) { cond ? ok(name) : fail(name, detail); }
function section(t) { process.stdout.write("\n" + t + "\n"); }
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const jsFiles = fs.readdirSync(path.join(ROOT, "js")).filter((f) => f.endsWith(".js")).map((f) => "js/" + f);
const list = (d, ext) => (exists(d) ? fs.readdirSync(path.join(ROOT, d)).filter((f) => f.endsWith(ext)).map((f) => d + "/" + f) : []);
const size = (files) => files.reduce((s, f) => s + fs.statSync(path.join(ROOT, f)).size, 0);
const MB = (b) => (b / 1048576).toFixed(1) + " MB";
const QUICK = process.argv.includes("--quick");

/* ---------- the autopilot ----------
   Knows where everything is (a person has to look), and otherwise plays the
   way the walk asks: the lantern, the compass and the map from the base,
   the fuel and food from every camp, every camp's beacon, then on along the
   flags; it eats when hungry and warms itself at a stove when cold. If this
   reaches East Cape on every difficulty, a person can. */
function pilot(M, g, mem, dt) {
  const { game, places } = M;
  const p = g.p, P = g.P, W = g.W;
  const inp = { fwd: 0, side: 0, yaw: p.yaw, pitch: 0 };
  mem.t = (mem.t || 0) + dt;
  if (!mem.plan) mem.plan = plan(M, g);
  // eat when hungry, from the pack
  if (p.food < 0.4) for (const k of ["rations", "cans", "fish"]) if (p.items[k] > 0) { game.eat(g, k); break; }
  // light the lantern in the dark, if there is fuel to spare beyond the next beacon
  const dark = g.sun.el < 0.02, owed = mem.plan.some((t) => t.kind === "beacon" && !g.lit[t.beacon]) ? g.D.beacon : 0;
  const want = dark && p.fuel > owed + 0.4;
  if (p.keys.lantern && want !== p.lantern) inp.lanternPress = true;
  // cold: the nearest hut, its stove, a rest
  if (p.warmth < 0.28 && !mem.warming) {
    const h = P.huts.filter((x) => P.props[x.stove]).map((x) => ({ x, d: Math.hypot(x.x - p.x, x.z - p.z) })).sort((a, b) => a.d - b.d)[0];
    if (h && h.d < 260) { mem.warming = true; mem.plan.unshift(...hutVisit(M, g, h.x, "warm")); }
  }
  // indoors with somewhere outdoors to be: out by the door first
  const t0 = mem.plan[0];
  if (t0 && p.inside >= 0 && (t0.kind === "line" || t0.kind === "beacon")) {
    const h = P.huts[p.inside];
    const inside = places.hutWorld(h, h.door.off, h.d / 2 - 0.9), out = places.hutWorld(h, h.door.off, h.d / 2 + 1.4);
    mem.plan.unshift({ kind: "go", x: inside.x, z: inside.z, r: 0.5 }, { kind: "door", hut: h.id }, { kind: "go", x: out.x, z: out.z, r: 0.7 });
  }
  const task = mem.plan[0];
  if (!task) { inp.fwd = 0; return inp; }
  const done = () => { mem.plan.shift(); mem.since = 0; mem.last = null; mem.hold = 0; mem.taskT = mem.bt = mem.st = mem.rt = mem.tt = mem.dt = 0; };
  // nothing a person would keep at for more than a minute (the line excepted: it
  // is long; and a camp's beacon stands on the hill above it, a few minutes' climb)
  mem.taskT = (mem.taskT || 0) + dt;
  if (task.kind !== "line" && mem.taskT > (task.kind === "beacon" ? 300 : 60)) { mem.gaveUp = (mem.gaveUp || 0) + 1; done(); return inp; }
  const goTo = (x, z, r, run) => {
    const d = Math.hypot(x - p.x, z - p.z);
    if (d < (r || 0.6)) return true;
    inp.yaw = Math.atan2(x - p.x, z - p.z); inp.fwd = 1; inp.run = !!run && d > 8;
    // outdoors, bound for somewhere outdoors: round a hut in the way, not through its door
    if (p.inside < 0 && places.hutAt(P, x, z, -0.6) < 0) {
      for (let k = 0; k < 7; k++) {
        const a = inp.yaw + (k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.45);
        const ax = p.x + Math.sin(a) * 2.2, az = p.z + Math.cos(a) * 2.2;
        if (places.hutAt(P, ax, az, -0.7) < 0) { inp.yaw = a; break; }
      }
    }
    // stuck: step sideways a while
    mem.since = (mem.since || 0) + dt;
    if (mem.since > 1.5) { if (mem.last && Math.hypot(mem.last.x - p.x, mem.last.z - p.z) < 0.3) { mem.wig = 1.2; mem.wd = -(mem.wd || 1); } mem.last = { x: p.x, z: p.z }; mem.since = 0; }
    if (mem.wig > 0) { mem.wig -= dt; inp.side = mem.wd; }
    return false;
  };
  const aim = (x, y, z) => { inp.yaw = Math.atan2(x - p.x, z - p.z); inp.pitch = Math.atan2(y - (p.y + p.eye), Math.max(0.2, Math.hypot(x - p.x, z - p.z))); };
  switch (task.kind) {
    case "go": if (goTo(task.x, task.z, task.r, task.run)) done(); break;
    case "line": {
      // along the flags to the next site
      const L = W.line, s = W.sites[task.site], ds = Math.hypot(s.x - p.x, s.z - p.z);
      if (ds < 30) { done(); break; }
      // near the camp, straight for it; otherwise a few flags ahead
      const k = Math.min(L.length - 1, g.lineI + 6), q = ds < 90 ? s : L[k];
      goTo(q.x, q.z, 0.5, true);
      break;
    }
    case "door": {
      const h = P.huts[task.hut];
      // from whichever side of it you are on
      const at = places.hutWorld(h, h.door.off, h.d / 2 + (p.inside === h.id ? -0.8 : 0.9));
      if (g.doors[h.id] > 0.5) { done(); break; }
      if (!goTo(at.x, at.z, 0.4)) break;
      const dp = places.hutWorld(h, h.door.off, h.d / 2);
      aim(dp.x, h.floor + 1.1, dp.z);
      const t = game.target(g);
      if (t && t.kind === "door" && t.hut === h.id) inp.usePress = true;
      else { mem.dt = (mem.dt || 0) + dt; if (mem.dt > 3) { mem.dt = 0; done(); } }
      break;
    }
    case "take": {
      const q = P.props[task.prop];
      if (g.taken[q.id] || !q.item) { done(); break; }
      // within arm's reach is close enough: furniture stands between some of them and the floor
      if (Math.hypot(q.x - p.x, q.z - p.z) > 1.7 && !goTo(q.x, q.z, 1.0)) break;
      aim(q.x, q.y + 0.12, q.z);
      const t = game.target(g);
      // the can beside it first, if that is the one under the hand: a person would
      if (t && t.kind === "take") inp.usePress = true;
      else { mem.tt = (mem.tt || 0) + dt; if (mem.tt > 4) { mem.tt = 0; mem.missed = (mem.missed || 0) + 1; done(); } }
      break;
    }
    case "beacon": {
      const b = W.beacons[task.beacon];
      if (g.lit[task.beacon]) { done(); break; }
      if (p.fuel < g.D.beacon) { done(); break; }
      if (!goTo(b.x + (p.x - b.x) / Math.max(1, Math.hypot(p.x - b.x, p.z - b.z)) * 1.8, b.z + (p.z - b.z) / Math.max(1, Math.hypot(p.x - b.x, p.z - b.z)) * 1.8, 0.8, true)) break;
      aim(b.x, b.y + 1.2, b.z);
      inp.use = true;
      mem.bt = (mem.bt || 0) + dt; if (mem.bt > 8) { mem.bt = 0; done(); }
      break;
    }
    case "stove": {
      const q = P.props[task.prop];
      if (g.stoves[q.inside] > 0 || p.fuel < g.D.stove) { done(); break; }
      if (!goTo(q.x, q.z, 1.3)) break;
      aim(q.x, q.y + 0.7, q.z);
      inp.use = true;
      mem.st = (mem.st || 0) + dt; if (mem.st > 5) { mem.st = 0; done(); }
      break;
    }
    case "rest": {
      const q = P.props[task.prop];
      if (!goTo(q.x, q.z, 1.4)) break;
      aim(q.x, q.y + 0.5, q.z);
      const t = game.target(g);
      if (t && t.kind === "rest") { inp.usePress = true; mem.warming = false; done(); }
      else { mem.rt = (mem.rt || 0) + dt; if (mem.rt > 4) { mem.rt = 0; mem.warming = false; done(); } }
      break;
    }
    case "warmed": mem.warming = false; done(); break;
  }
  return inp;
}
/* Into a hut and out again: what to take, or the stove and a rest. */
function hutVisit(M, g, h, why) {
  const { places } = M, P = g.P;
  const out = places.hutWorld(h, h.door.off, h.d / 2 + 1.4), inside = places.hutWorld(h, h.door.off, h.d / 2 - 0.9);
  const tasks = [{ kind: "go", x: out.x, z: out.z, r: 0.7 }, { kind: "door", hut: h.id }, { kind: "go", x: inside.x, z: inside.z, r: 0.5 }];
  if (why === "warm") {
    const st = P.props[h.stove], bed = P.props.find((q) => q.inside === h.id && q.kind === "bed");
    if (st) tasks.push({ kind: "stove", prop: st.id });
    if (bed) tasks.push({ kind: "rest", prop: bed.id }); else tasks.push({ kind: "warmed" });
  } else for (const q of P.props) if (q.inside === h.id && q.item) tasks.push({ kind: "take", prop: q.id });
  tasks.push({ kind: "go", x: inside.x, z: inside.z, r: 0.5 }, { kind: "go", x: out.x, z: out.z, r: 0.7 });
  return tasks;
}
function plan(M, g) {
  const P = g.P, W = g.W, tasks = [];
  // out of the bunkhouse with the lantern
  const bunk = P.huts[W.sites[0].wake.hut];
  const lan = P.props.find((q) => q.item && q.item.key === "lantern");
  const inside = M.places.hutWorld(bunk, bunk.door.off, bunk.d / 2 - 0.9);
  tasks.push({ kind: "take", prop: lan.id }, { kind: "go", x: inside.x, z: inside.z, r: 0.5 }, { kind: "door", hut: bunk.id });
  for (const s of W.sites) {
    if (s.id > 0) tasks.push({ kind: "line", site: s.id });
    for (const hid of s.huts) {
      const h = P.huts[hid];
      if (P.props.some((q) => q.inside === h.id && q.item)) tasks.push(...hutVisit(M, g, h, "take"));
    }
    const b = W.beacons.find((x) => x.site === s.id);
    if (b) tasks.push({ kind: "beacon", beacon: b.id });
  }
  return tasks;
}

function journey(M, W, diff, maxT) {
  const g = M.game.newRun(W, { diff });
  const mem = {};
  const dt = 1 / 20;
  const track = { stuck: 0, maxSpeed: 0, out: 0, walls: 0 };
  let last = { x: g.p.x, z: g.p.z };
  while (g.t < (maxT || 7200) && g.state !== "over") {
    const inp = g.state === "play" ? pilot(M, g, mem, dt) : {};
    M.game.step(g, dt, inp);
    const sp = Math.hypot(g.p.x - last.x, g.p.z - last.z) / dt;
    if (g.state === "play") track.maxSpeed = Math.max(track.maxSpeed, sp);
    last = { x: g.p.x, z: g.p.z };
    for (const e of g.events) if (e.type === "blackout") track.out++;
  }
  return { g, track, mem };
}

/* Is the ground at (x,z) somewhere a body can stand? (game.js's rule, here
   so the route can be checked without walking it) */
function standable(M, W, x, z) {
  const s = M.world.surface(W, x, z);
  return s.water < 0.35 && s.crevasse < 0.3;
}

(async function main() {
  section("Static: no emoji");
  {
    const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{2B00}-\u{2BFF}]/u;
    const bad = [];
    for (const rel of jsFiles.concat(["index.html", "css/longlight.css", "sw.js", "manifest.webmanifest", "tools/validate.js", "tools/e2e.js", "README.md", "assets/models/CREDITS.md", "assets/sounds/CREDITS.md", "assets/textures/CREDITS.md", "assets/music/CREDITS.md"].filter(exists)))
      read(rel).split("\n").forEach((line, i) => { if (EMOJI.test(line)) bad.push(rel + ":" + (i + 1)); });
    check("no emoji or pictographic characters in source", !bad.length, bad.slice(0, 8).join(", "));
  }

  section("Static: every module parses");
  for (const rel of jsFiles) {
    const r = spawnSync(process.execPath, ["--input-type=module", "--check"], { input: read(rel), encoding: "utf8" });
    check(rel + " parses", r.status === 0, (r.stderr || "").split("\n").slice(0, 4).join(" "));
  }
  for (const rel of ["sw.js", "tools/e2e.js"].filter(exists)) {
    const r = spawnSync(process.execPath, ["--check", path.join(ROOT, rel)], { encoding: "utf8" });
    check(rel + " parses", r.status === 0, r.stderr);
  }

  section("Static: one version, and a worker that waits");
  const html = read("index.html"), sw = read("sw.js");
  {
    const pageV = (html.match(/window\.LL_VERSION\s*=\s*"([^"]+)"/) || [])[1];
    const cache = (sw.match(/var CACHE\s*=\s*"longlight-v([^"]+)"/) || [])[1];
    check("index.html declares window.LL_VERSION", !!pageV, pageV);
    check("sw.js names its cache longlight-v<version>", !!cache, cache);
    check("the two agree", pageV === cache, pageV + " vs " + cache);
    const install = sw.slice(sw.indexOf('addEventListener("install"'), sw.indexOf('addEventListener("message"'));
    check("no skipWaiting() inside install", !/skipWaiting\(\)/.test(install.replace(/\/\*[\s\S]*?\*\//g, "")));
    check('the worker answers "skip-waiting"', /e\.data === "skip-waiting"\) self\.skipWaiting\(\)/.test(sw));
    const upd = read("js/update.js");
    check("the page posts skip-waiting to a waiting worker", /postMessage\("skip-waiting"\)/.test(upd));
    check("the page reloads on controllerchange, only after a first controller", /controllerchange/.test(upd) && /hadController/.test(upd));
    check("the page checks periodically, on visibility and on online", /setInterval/.test(upd) && /visibilitychange/.test(upd) && /"online"/.test(upd));
    check("a journey under way is confirmed before reloading", /busy\(\) && !window\.confirm/.test(upd));
    check("index.html has the update bar", /id="update-bar"/.test(html) && /id="update-go"/.test(html) && /id="update-later"/.test(html));
    check("settings carry the version and a manual check", /updCheck/.test(read("js/ui.js")) && /Check for updates/.test(read("js/ui.js")));
  }

  section("Static: the worker's shell holds everything the game loads, and not the Full set");
  {
    const shell = [...sw.matchAll(/"\.\/([^"]*)"/g)].map((m) => m[1]).filter(Boolean);
    const missing = shell.filter((f) => !exists(f));
    check("every shell entry exists (" + shell.length + ")", !missing.length, missing.join(", "));
    const need = jsFiles.concat(["css/longlight.css", "manifest.webmanifest", "index.html"]);
    const absent = need.filter((f) => !shell.includes(f));
    check("every script, the stylesheet and the manifest are in the shell", !absent.length, absent.join(", "));
    const vendor = [];
    (function walk(d) { for (const f of fs.readdirSync(path.join(ROOT, d))) { const rel = d + "/" + f; if (fs.statSync(path.join(ROOT, rel)).isDirectory()) walk(rel); else if (rel.endsWith(".js")) vendor.push(rel); } })("vendor");
    const unvendored = vendor.filter((f) => !shell.includes(f));
    check("every vendored script is in the shell (" + vendor.length + ")", vendor.length && !unvendored.length, unvendored.join(", "));
    const assets = list("assets/models", ".glb").concat(list("assets/textures", ".webp"), list("assets/sounds", ".mp3"), list("assets/music", ".mp3"));
    const unshelled = assets.filter((f) => !shell.includes(f));
    check("every Packed model, surface, sound and sample is in the shell (" + assets.length + ")", !unshelled.length, unshelled.join(", "));
    const full = shell.filter((f) => /assets\/full\//.test(f));
    check("the Full set is not in the shell, so an install stays small", !full.length, full.slice(0, 3).join(", "));
    // what the code names, from the text (render.js and audio.js need a browser)
    const rsrc = read("js/render.js"), asrc = read("js/audio.js");
    const models = JSON.parse("[" + (rsrc.match(/export const MODELS = \[([^\]]*)\]/) || [])[1] + "]");
    const textures = JSON.parse("[" + (rsrc.match(/export const TEXTURES = \[([^\]]*)\]/) || [])[1] + "]");
    const sounds = JSON.parse("[" + (asrc.match(/export const SOUNDS = \[([^\]]*)\]/) || [])[1].replace(/\s+/g, "") + "]");
    const piano = JSON.parse("[" + (asrc.match(/export const PIANO = \[([^\]]*)\]/) || [])[1] + "]");
    const cello = JSON.parse("[" + (asrc.match(/export const CELLO = \[([^\]]*)\]/) || [])[1] + "]");
    const want = models.map((m) => "assets/models/" + m + ".glb").concat(textures.flatMap((t) => ["", "_n", "_arm"].map((s) => "assets/textures/" + t + s + ".webp")), sounds.map((s) => "assets/sounds/" + s + ".mp3"), piano.map((n) => "assets/music/piano_" + n + ".mp3"), cello.map((n) => "assets/music/cello_" + n + ".mp3"));
    const notThere = want.filter((f) => !exists(f));
    check("every model, texture, sound and sample the code names exists (" + want.length + ")", !notThere.length, notThere.join(", "));
    const unused = assets.filter((f) => !want.includes(f));
    check("no asset on disk that the code never loads", !unused.length, unused.join(", "));
    const { MODEL_NAMES } = await imp("js/places.js");
    const unplaced = MODEL_NAMES.filter((m) => !models.includes(m) && m !== "lantern");
    check("every model places.js knows is one render.js loads", !unplaced.length && MODEL_NAMES.every((m) => models.includes(m)), unplaced.join(", "));
    const twins = want.filter((f) => /assets\/(models|textures)\//.test(f)).map((f) => f.replace("assets/", "assets/full/")).filter((f) => !exists(f));
    check("every Packed model and surface has its Full twin", !twins.length, twins.slice(0, 5).join(", "));
    const extra = list("assets/full/models", ".glb").concat(list("assets/full/textures", ".webp")).filter((f) => !exists(f.replace("assets/full/", "assets/")));
    check("and the Full set holds nothing the Packed set does not", !extra.length, extra.join(", "));
    const packed = size(assets), fullB = size(list("assets/full/models", ".glb").concat(list("assets/full/textures", ".webp")));
    check("the Packed assets stay under 16 MB (" + MB(packed) + ")", packed < 16 * 1048576);
    check("the Full set stays under 40 MB (" + MB(fullB) + ")", fullB < 40 * 1048576);
    // Full really is fuller: bigger, file for file, for the surfaces
    const smaller = textures.filter((t) => fs.statSync(path.join(ROOT, "assets/full/textures/" + t + "_n.webp")).size <= fs.statSync(path.join(ROOT, "assets/textures/" + t + "_n.webp")).size);
    check("every Full surface is more than its Packed one", !smaller.length, smaller.join(", "));
    const alphaOf = (f) => { const b = fs.readFileSync(path.join(ROOT, f)); return b.toString("latin1", 12, 16) === "VP8X" && (b[20] & 0x10) !== 0; };
    const flat = textures.flatMap((t) => ["assets/textures/" + t + "_n.webp", "assets/full/textures/" + t + "_n.webp"]).filter((f) => exists(f) && !alphaOf(f));
    check("every surface's normal map carries its height in its alpha, Packed and Full", !flat.length, flat.join(", "));
    check("index.html maps \"three\" to the vendored build", /"three":"\.\/vendor\/build\/three\.module\.min\.js"/.test(html));
    // terrain.js, render.js and scenery.js patch three's shaders by finding lines in them
    const three = read("vendor/build/three.module.min.js");
    const lines = ["#include <map_fragment>", "#include <roughnessmap_fragment>", "#include <normal_fragment_maps>", "#include <project_vertex>", "#include <fog_fragment>", "#include <begin_vertex>", "#include <alphamap_fragment>", "vFogDepth", "varying vec3 vViewPosition;"];
    const lost = lines.filter((l) => !three.includes(l));
    check("the shader patches find every line they patch in the vendored three", !lost.length, lost.join(" | "));
    check("and the sky's fade finds its line in the vendored Sky", read("vendor/jsm/objects/Sky.js").includes("gl_FragColor = vec4( retColor, 1.0 );"));
    const man = JSON.parse(read("manifest.webmanifest"));
    const icons = man.icons.map((i) => i.src).filter((s) => !exists(s));
    check("every manifest icon exists", !icons.length, icons.join(", "));
    check("every manifest icon is in the shell", man.icons.every((i) => shell.includes(i.src)));
  }

  section("Static: ids, topics, icons, words, credits, provenance");
  {
    const src = jsFiles.map(read).join("\n");
    const htmlIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    const used = new Set([...src.matchAll(/(?:getElementById|\$)\("([A-Za-z][\w-]*)"\)/g)].map((m) => m[1]));
    const dynamic = new Set(["updState", "assetState", "mapCanvas", "loadLine", "diffLine"]);
    const missing = [...used].filter((id) => !htmlIds.has(id) && !dynamic.has(id));
    check("every id the scripts reach for is in index.html (" + used.size + ")", !missing.length, missing.join(", "));
    const { TOPICS, CLUES, RADIO, MEMORIES } = await imp("js/topics.js");
    const infos = new Set([...(html + src).matchAll(/data-info="(\w+)"/g)].map((m) => m[1]).concat([...src.matchAll(/info\("(\w+)"\)/g)].map((m) => m[1])));
    const noTopic = [...infos].filter((k) => !TOPICS[k]);
    check("every (i) names a topic (" + infos.size + ")", !noTopic.length, noTopic.join(", "));
    const clueIds = new Set([...read("js/places.js").matchAll(/clue: "(\w+)"/g)].map((m) => m[1]).concat([...read("js/places.js").matchAll(/clue\(\w+, "(\w+)",/g)].map((m) => m[1]), ["camp1", "camp2", "camp3", "camp4", "camp5", "generator", "radio_dead"]));
    const noClue = [...clueIds].filter((k) => !CLUES[k]);
    check("every clue the world places has its words (" + clueIds.size + ")", !noClue.length, noClue.join(", "));
    check("every radio has its words", ["default", "song", "morse", "mended"].every((k) => RADIO[k]));
    check("a memory for every blackout a Hard journey can have, and more", MEMORIES.length >= 3);
    const { ICONS } = await imp("js/icons.js");
    const named = new Set([...(html + src).matchAll(/data-icon="(\w+)"/g)].map((m) => m[1]).concat([...src.matchAll(/icon\("(\w+)"/g)].map((m) => m[1]), [...src.matchAll(/\["\w+", "[^"]+", "(\w+)"\]/g)].map((m) => m[1])));
    const undrawn = [...named].filter((k) => !ICONS[k]);
    check("every icon named is drawn (" + named.size + ")", !undrawn.length, undrawn.join(", "));
    for (const [dir, ext] of [["assets/models", ".glb"], ["assets/textures", ".webp"], ["assets/sounds", ".mp3"], ["assets/music", ".mp3"]]) {
      const cr = exists(dir + "/CREDITS.md") ? read(dir + "/CREDITS.md") : "";
      const files = list(dir, ext).map((f) => path.basename(f));
      const unc = files.filter((f) => !cr.includes("`" + f + "`") && !cr.includes("`" + f.replace(/(_n|_arm)?\.webp$/, "") + "`"));
      check(dir + "/CREDITS.md credits every file (" + files.length + ")", cr && !unc.length, unc.slice(0, 6).join(", "));
    }
    const lifted = { "js/update.js": "lastflame/js/update.js", "js/info.js": "lastflame/js/info.js", "js/icons.js": "lastflame/js/icons.js", "js/rng.js": "ballzooka/js/rng.js", "js/save.js": "lastflame/js/save.js", "sw.js": "lastflame/sw.js", "js/render.js": "lastflame/js/render.js", "js/audio.js": "lastflame/js/audio.js", "js/input.js": "lastflame/js/input.js", "js/ui.js": "lastflame/js/ui.js", "js/main.js": "lastflame/js/main.js", "js/scenery.js": "lastflame/js/render.js", "js/textures.js": "lastflame/js/textures.js" };
    for (const [f, from] of Object.entries(lifted)) check(f + " says it was lifted from " + from, read(f).includes(from));
    check("no API keys or outside requests in the scripts", !/https?:\/\/(?!creativecommons)/.test(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")));
  }

  section("Behaviour: worlds");
  const world = await imp("js/world.js");
  const places = await imp("js/places.js");
  const sun = await imp("js/sun.js");
  const game = await imp("js/game.js");
  const M = { world, places, sun, game };
  const seeds = QUICK ? [1911, 77] : [1911, 7, 77, 1234, 4242, 90210, 31337, 2026];
  const worlds = [];
  {
    let ms = 0;
    const bad = { sites: [], land: [], flat: [], beacons: [], route: [], reach: [] };
    for (const s of seeds) {
      const t0 = Date.now();
      const W = world.buildWorld(s);
      ms += Date.now() - t0;
      worlds.push(W);
      const kinds = W.sites.map((x) => x.kind).join(",");
      if (kinds !== "base,camp,camp,camp,camp,camp,station") bad.sites.push(s + ":" + kinds);
      for (const st of W.sites) {
        const q = world.surface(W, st.x, st.z);
        if (q.water > 0 || q.seaIce > 0.5 || q.crevasse > 0) bad.land.push(s + ":" + st.kind + st.id);
        // the pad: level enough for huts, all round
        let worst = 0;
        for (let a = 0; a < 16; a++) { const r = st.pad * 0.7, x = st.x + Math.cos(a) * r, z = st.z + Math.sin(a) * r; worst = Math.max(worst, Math.abs(world.heightAt(W, x, z) - st.y)); }
        if (worst > 2.5) bad.flat.push(s + ":" + st.kind + st.id + " " + worst.toFixed(1) + "m");
      }
      if (W.beacons.length < 7) bad.beacons.push(s + ":" + W.beacons.length);
      for (const b of W.beacons) if (!standable(M, W, b.x, b.z)) bad.beacons.push(s + ":beacon" + b.id);
      // the flagged route: every two metres can be stood on, and no step of it is a wall
      let prev = null, steep = 0;
      for (let i = 1; i < W.line.length; i++) {
        const a = W.line[i - 1], c = W.line[i], n = Math.ceil(Math.hypot(c.x - a.x, c.z - a.z) / 2);
        for (let k = 0; k < n; k++) {
          const x = a.x + (c.x - a.x) * k / n, z = a.z + (c.z - a.z) * k / n, h = world.heightAt(W, x, z);
          if (!standable(M, W, x, z)) { bad.route.push(s + ":" + Math.round(x) + "," + Math.round(z)); break; }
          if (prev && (h - prev.h) / Math.max(0.5, Math.hypot(x - prev.x, z - prev.z)) > 0.8) steep++;
          prev = { x, z, h };
        }
      }
      if (steep) bad.route.push(s + ": " + steep + " steps steeper than a sledge is hauled");
    }
    check(seeds.length + " worlds build (" + Math.round(ms / seeds.length) + " ms each)", worlds.length === seeds.length);
    check("each has its base, five camps and the last station, in order", !bad.sites.length, bad.sites.join(" | "));
    check("every site stands on land, not on the sea or a crack", !bad.land.length, bad.land.slice(0, 5).join(", "));
    check("every site's pad is level enough for its huts", !bad.flat.length, bad.flat.slice(0, 5).join(", "));
    check("at least seven beacons, every one on ground you can stand on", !bad.beacons.length, bad.beacons.slice(0, 5).join(", "));
    check("the flagged route can be walked the whole way", !bad.route.length, bad.route.slice(0, 5).join(", "));
    const a = world.buildWorld(4242), b = world.buildWorld(4242);
    check("a seed builds the same world twice", a.H.every((v, i) => v === b.H[i]) && JSON.stringify(a.sites) === JSON.stringify(b.sites));
    const P1 = world.pack(a), U = world.unpack(Object.assign({}, P1));
    let same = true;
    for (let i = 0; i < 400; i++) { const x = (i * 97.3) % 6000 - 3000, z = (i * 53.1) % 3000 - 2600; if (world.heightAt(a, x, z) !== world.heightAt(U, x, z)) { same = false; break; } }
    check("a world sent to a worker samples to the same heights there", same);
    // the land: snow mostly, stone where it is steep, some sea, a glacier with cracks
    const W = worlds[0];
    let rock = 0, sea = 0, crev = 0, n = 0;
    for (let i = 0; i < 4000; i++) { const x = ((i * 7919) % 8000) - 4000, z = ((i * 104729) % 8000) - 4000, q = world.surface(W, x, z); n++; if (q.rock > 0.5) rock++; if (q.water > 0.5 || q.seaIce > 0.5) sea++; }
    for (let i = 0; i < 4000; i++) { const x = W.glacierX0 + ((i * 31) % 800) - 400, z = W.sites[3].z + ((i * 17) % 1400) - 300; if (world.surface(W, x, z).crevasse > 0.3) crev++; }
    check("the land is mostly snow, with bare stone (" + (rock / n * 100).toFixed(0) + "%) and sea (" + (sea / n * 100).toFixed(0) + "%)", rock / n > 0.03 && rock / n < 0.4 && sea / n > 0.15 && sea / n < 0.5);
    check("the glacier is cracked (" + crev + " of 4000 samples in an open crevasse)", crev > 40 && crev < 2000);
  }

  section("Behaviour: what the people left");
  {
    const bad = { fuel: [], huts: [], keys: [], inside: [] };
    for (const W of worlds) for (const diff of ["easy", "normal", "hard"]) {
      const P = places.buildPlaces(W, diff), D = places.DIFF[diff];
      for (const s of W.sites) {
        const fuel = P.props.filter((q) => q.item && q.item.type === "fuel" && s.huts.includes(q.inside)).reduce((a, q) => a + q.item.n, 0);
        if (fuel < D.beacon) bad.fuel.push(W.seed + ":" + diff + ":" + s.kind + s.id + " " + fuel + "<" + D.beacon);
      }
      // nothing placed inside a hut is outside its walls
      for (const q of P.props) if (q.inside >= 0) { const h = P.huts[q.inside], l = places.hutLocal(h, q.x, q.z); if (Math.abs(l.x) > h.w / 2 || Math.abs(l.z) > h.d / 2) bad.inside.push(W.seed + ":" + q.kind); }
      for (const h of P.huts) if (!(h.floor > world.heightAt(W, h.x, h.z) - 0.01)) bad.huts.push(W.seed + ":hut" + h.id);
      for (const k of ["lantern", "compass", "map", "line", "toolbox"]) if (!P.props.some((q) => q.item && q.item.key === k)) bad.keys.push(W.seed + ":" + k);
    }
    check("every site holds the fuel for its own beacon, on every difficulty", !bad.fuel.length, bad.fuel.slice(0, 6).join(", "));
    check("everything placed in a hut is inside its walls", !bad.inside.length, bad.inside.slice(0, 5).join(", "));
    check("no hut's floor is under the snow", !bad.huts.length, bad.huts.slice(0, 5).join(", "));
    check("the base holds the lantern, the compass, the map, the line and the tools", !bad.keys.length, bad.keys.join(", "));
    const e = places.buildPlaces(worlds[0], "easy"), h = places.buildPlaces(worlds[0], "hard");
    const cnt = (P, t) => P.props.filter((q) => q.item && q.item.type === t).length;
    check("supplies: common on Easy, scarce on Hard (" + cnt(e, "fuel") + "/" + cnt(e, "food") + " vs " + cnt(h, "fuel") + "/" + cnt(h, "food") + ")", cnt(e, "fuel") > cnt(h, "fuel") && cnt(e, "food") > cnt(h, "food"));
  }

  section("Behaviour: the sun is the clock");
  {
    let lowest = 9, highest = -9;
    for (let d = 0; d < 1; d += 0.01) { const s = sun.sunDir(d, 0); lowest = Math.min(lowest, s.el); highest = Math.max(highest, s.el); }
    check("in high summer it never sets (" + (lowest / sun.DEG).toFixed(1) + "° at its lowest, " + (highest / sun.DEG).toFixed(1) + "° at noon)", lowest > 5 * sun.DEG && highest < 45 * sun.DEG);
    check("noon is in the north, midnight in the south", sun.sunDir(0.5, 0).z < -0.5 && sun.sunDir(0, 0).z > 0.5);
    check("it goes all the way round: east in the morning, west in the evening", sun.sunDir(0.25, 0).x > 0.5 && sun.sunDir(0.75, 0).x < -0.5);
    const c = sun.circle(0.5);
    check("by the middle of the journey the midnight sun touches the horizon (" + (c.midnight / sun.DEG).toFixed(1) + "°)", Math.abs(c.midnight / sun.DEG) < 4);
    check("and at the end it does not rise at noon", sun.circle(1).noon < 0 && sun.circle(1.12).noon < -4 * sun.DEG);
    // shadows: the sun behind a hut puts you in its shadow
    const g = game.newRun(worlds[0], { diff: "normal" });
    const hh = g.P.huts[0];
    const s0 = sun.sunDir(0.5, 0.6);
    const fx = hh.x - s0.x / Math.hypot(s0.x, s0.z) * (hh.d / 2 + 1.2), fz = hh.z - s0.z / Math.hypot(s0.x, s0.z) * (hh.d / 2 + 1.2);
    check("a hut between you and a low sun shades you", game.shadowed(g, fx, game.groundAt(g, fx, fz) + 1.2, fz, s0));
    check("and out in the open the sun is on you", !game.shadowed(g, hh.x + 60 * s0.x / Math.hypot(s0.x, s0.z), game.groundAt(g, hh.x + 60 * s0.x, hh.z + 60 * s0.z) + 1.5, hh.z + 60 * s0.z / Math.hypot(s0.x, s0.z), sun.sunDir(0.5, 0)));
  }

  section("Behaviour: food, warmth, fuel");
  {
    const W = worlds[0];
    const outside = (g) => { const s = W.sites[1]; const q = W.line[Math.floor(W.line.length * 0.3)]; g.p.x = q.x; g.p.z = q.z; g.p.inside = -1; void s; };
    // food drains slowly, faster hurrying
    const g1 = game.newRun(W, { diff: "normal" }); outside(g1);
    const f0 = g1.p.food;
    for (let i = 0; i < 20 * 60; i++) game.step(g1, 1 / 20, { yaw: g1.p.yaw });
    const still = f0 - g1.p.food;
    const g2 = game.newRun(W, { diff: "normal" }); outside(g2);
    for (let i = 0; i < 20 * 60; i++) game.step(g2, 1 / 20, { yaw: g2.lineI ? 1.57 : 1.57, fwd: 1, run: true });
    const ran = f0 - g2.p.food;
    check("food drains slowly: a minute standing costs " + (still * 100).toFixed(1) + "%", still > 0.008 && still < 0.03);
    check("hurrying costs more (" + (ran * 100).toFixed(1) + "% a minute)", ran > still * 1.2);
    // warmth: the stove in a hut warms; the night outside in the wind chills
    const g3 = game.newRun(W, { diff: "normal" });
    const hb = g3.P.huts[W.sites[0].wake.hut];
    g3.p.warmth = 0.3; g3.stoves[hb.id] = 900;
    for (let i = 0; i < 20 * 60; i++) game.step(g3, 1 / 20, { yaw: g3.p.yaw });
    check("a lit stove warms you (" + g3.p.warmth.toFixed(2) + " after a minute from 0.30)", g3.p.warmth > 0.6);
    const g4 = game.newRun(W, { diff: "normal" }); outside(g4);
    g4.season = 1; g4.D = Object.assign({}, g4.D, { seasonT: 1e9 }); g4.clock = 0; g4.weather.wind = 0.9;
    const w0 = g4.p.warmth;
    for (let i = 0; i < 20 * 120; i++) { g4.weather.next = 1e9; game.step(g4, 1 / 20, { yaw: g4.p.yaw }); }
    check("the polar night chills you, gently (" + w0.toFixed(2) + " -> " + g4.p.warmth.toFixed(2) + " in two minutes)", g4.p.warmth < w0 - 0.05 && g4.p.warmth > 0.05);
    // a beacon burns its fuel
    const g5 = game.newRun(W, { diff: "normal" });
    const b = W.beacons[0];
    g5.p.x = b.x + 1.8; g5.p.z = b.z; g5.p.inside = -1; g5.p.fuel = 2.5;
    for (let i = 0; i < 20 * 4; i++) game.step(g5, 1 / 20, { yaw: Math.atan2(b.x - g5.p.x, b.z - g5.p.z), pitch: Math.atan2(b.y + 1.2 - (g5.p.y + g5.p.eye), 1.8), use: true });
    check("holding a light to a beacon lights it, for two cans on Normal", g5.lit[0] && Math.abs(g5.p.fuel - 0.5) < 1e-6);
    check("and a lit beacon warms whoever stands by it", (() => { g5.p.warmth = 0.2; for (let i = 0; i < 20 * 40; i++) game.step(g5, 1 / 20, { yaw: 0 }); return g5.p.warmth > 0.45; })());
    // blackouts, by difficulty
    const out = (diff) => {
      const g = game.newRun(W, { diff }); outside(g);
      g.p.fuel = 3; g.p.items.cans = 2;
      const clock0 = g.clock;
      g.p.warmth = 0.0005;
      for (let i = 0; i < 20 * 12; i++) game.step(g, 1 / 20, {});
      const first = { state: g.state, fuel: g.p.fuel, cans: g.p.items.cans, lost: g.clock - clock0 - 12, weak: g.p.weakT > 0 };
      g.p.warmth = 0.0005;
      for (let i = 0; i < 20 * 12; i++) game.step(g, 1 / 20, {});
      return { first, second: g.state };
    };
    const e = out("easy"), n = out("normal"), h = out("hard");
    check("Easy: wake where you fell, a little later, with everything", e.first.state === "play" && e.first.fuel === 3 && e.first.cans === 2 && e.first.lost > 0 && e.second === "play");
    check("Normal: wake having lost time and some of what you carried", n.first.state === "play" && n.first.fuel < 3 && n.first.lost > e.first.lost && n.second === "play");
    check("Hard: wake weak; a second blackout ends the walk", h.first.state === "play" && h.first.weak && h.second === "over");
    // the lantern sips fuel; a whiteout comes and goes, and clears the old tracks
    const g6 = game.newRun(W, { diff: "normal" }); outside(g6);
    g6.p.keys.lantern = true; g6.p.fuel = 1;
    game.step(g6, 1 / 20, { lanternPress: true });
    for (let i = 0; i < 20 * 60; i++) game.step(g6, 1 / 20, {});
    check("the lantern burns a can in about 25 minutes (" + ((1 - g6.p.fuel) * 100).toFixed(1) + "% in one)", g6.p.lantern && 1 - g6.p.fuel > 0.03 && 1 - g6.p.fuel < 0.05);
    const g7 = game.newRun(W, { diff: "normal" }); outside(g7);
    g7.t = 500; g7.weather.next = 501;
    let white = false, cleared = false;
    for (let i = 0; i < 20 * 400 && !cleared; i++) { game.step(g7, 1 / 20, {}); for (const ev of g7.events) { if (ev.type === "whiteout") white = true; if (ev.type === "clear") cleared = true; } }
    check("a whiteout comes and clears again, and when it clears the tracks are gone", white && cleared);
  }

  section("Behaviour: whole journeys, base to East Cape");
  {
    const runs = QUICK ? [["normal", 0]] : [["easy", 0], ["normal", 0], ["hard", 0], ["normal", 1], ["hard", 2], ["normal", 3]];
    const res = [];
    for (const [diff, wi] of runs) {
      const W = worlds[wi];
      const t0 = Date.now();
      const r = journey(M, W, diff, 9000);
      const g = r.g;
      res.push({ diff, seed: W.seed, won: !!g.won, lost: !!g.lost, t: g.t, beacons: g.stats.beacons, km: g.stats.distance / 1000, out: r.track.out, maxSpeed: r.track.maxSpeed, ms: Date.now() - t0, missed: r.mem.missed || 0, left: (r.mem.plan || []).length, at: Math.round(g.progress * 100) });
    }
    for (const r of res) process.stdout.write("    " + r.diff.padEnd(6) + " seed " + String(r.seed).padEnd(6) + (r.won ? " arrived" : r.lost ? " lost   " : " stuck  ") + " in " + (r.t / 60).toFixed(0) + " min, " + r.km.toFixed(1) + " km, " + r.beacons + " beacons, " + r.out + " blackouts, " + r.at + "% along, " + r.left + " tasks left (" + r.ms + " ms)\n");
    check("every journey reaches East Cape and the light answers", res.every((r) => r.won), res.filter((r) => !r.won).map((r) => r.diff + ":" + r.seed + " at " + r.at + "%").join(", "));
    check("and lights every camp's beacon on the way", res.every((r) => r.beacons >= 7), res.map((r) => r.beacons).join(","));
    check("nobody walks faster than a man can hurry (" + Math.max(...res.map((r) => r.maxSpeed)).toFixed(2) + " m/s)", res.every((r) => r.maxSpeed <= game.SPEED.brisk + 0.15));
    check("a walk takes an hour or two of play, not ten minutes and not five hours", res.every((r) => r.t > 40 * 60 && r.t < 150 * 60), res.map((r) => (r.t / 60).toFixed(0)).join(","));
    check("Easy is never ended by the cold", res.filter((r) => r.diff === "easy").every((r) => !r.lost));
  }

  section("Behaviour: saving a journey");
  {
    const W = worlds[0];
    const g = game.newRun(W, { diff: "hard" });
    g.p.x += 3; g.p.fuel = 2.5; g.lit[0] = true; g.read.map = true; g.t = 999; g.clock = 1500; g.season = 0.4;
    const s = JSON.parse(JSON.stringify(game.snapshot(g)));
    const h = game.newRun(W, { diff: s.diff, saved: s });
    check("a journey saved and restored is the same journey", h.diff === "hard" && h.p.fuel === 2.5 && h.lit[0] && h.read.map && h.t === 999 && h.clock === 1500 && h.season === 0.4 && Math.abs(h.p.x - g.p.x) < 1e-9);
    const other = game.newRun(worlds[1], { diff: "normal", saved: s });
    check("and a save is never laid over a different coast", !other.lit[0] && other.t === 0);
  }

  process.stdout.write("\n" + (checks - failures.length) + " of " + checks + " checks passed\n");
  if (failures.length) { process.stdout.write("\nFailures:\n" + failures.map((f) => "  - " + f).join("\n") + "\n"); process.exit(1); }
})();
