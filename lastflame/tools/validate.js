#!/usr/bin/env node
/* ============================================================
   Last Flame — validation harness
   `node tools/validate.js`

   Same shape as ballzooka/tools/validate.js. Two halves, both of which
   have to pass before anything ships:

   1. Static checks over the source as text: no emoji, every module parses,
      the page and the service worker carry one version, the worker never
      takes over by itself, every file the game loads is in the worker's
      shell and on disk, every id the scripts reach for exists, every (i)
      names a topic, every icon named is drawn, every asset is credited, and
      the lifted files still say where they came from.

   2. Behaviour checks over the game, imported straight into Node (house.js,
      nav.js, hunter.js and game.js never touch the DOM): hundreds of houses
      are built and every lamp, closet and the front door must be walkable;
      the house's change at the fifth lamp never traps anyone; the rules
      (oil, light and sight, sound along the floor, the closet rule, the
      lamps' light, the beacon, Relax, the threat ramp, death and waking)
      hold; the hunter never moves faster than it can walk; and a simple
      autopilot must be able to get out of most houses alive.

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
function fail(name, detail) { checks++; failures.push(name + (detail ? " — " + detail : "")); process.stdout.write("  \u2717 " + name + (detail ? " — " + detail : "") + "\n"); }
function check(name, cond, detail) { cond ? ok(name) : fail(name, detail); }
function section(t) { process.stdout.write("\n" + t + "\n"); }
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const jsFiles = fs.readdirSync(path.join(ROOT, "js")).filter((f) => f.endsWith(".js")).map((f) => "js/" + f);
const list = (d, ext) => fs.readdirSync(path.join(ROOT, d)).filter((f) => f.endsWith(ext)).map((f) => d + "/" + f);

/* ---------- the autopilot ----------
   Knows where the lamps are (a person has to find them), and otherwise plays
   the way the rules ask: keep the lantern lit until the end, run to light or
   a closet when chased, hold its breath when it is close, and creep to the
   front door in the dark. If this can get out, a person can. */
function pilot(M, g, mem, dt) {
  const { nav, game } = M;
  const p = g.player, h = g.hunter, L = g.L;
  const inp = { fwd: 0, side: 0, yaw: p.yaw, pitch: 0 };
  const d = h.active ? Math.hypot(h.x - p.x, h.z - p.z) : 99;
  mem.t = (mem.t || 0) + dt;
  if (p.hiding >= 0) {
    mem.hid = (mem.hid || 0) + dt;
    inp.breath = h.active && d < 3.2 && p.breath > 0.15;
    const ghostClose = (g.ghosts || []).some((q) => q.state !== "rise" && Math.hypot(q.x - p.x, q.z - p.z) < 6);
    if (mem.hid > 4 && !ghostClose && (!h.active || (h.state !== "chase" && h.state !== "rip" && d > 7))) { inp.usePress = true; mem.hid = 0; mem.path = null; }
    return inp;
  }
  // the end: lantern out
  if (g.flipped && p.lantern) inp.lanternPress = true;
  if (!g.flipped && !p.lantern && p.oil > 0) inp.lanternPress = true;
  const chased = h.active && (h.state === "chase" || (h.sees && h.aware > 0.5 && d < 7)) && h.state !== "pass" && h.state !== "stare";
  // the end: the ghosts out of the lamps. It does what a person would — runs for the door
  const ghostNear = (g.ghosts || []).some((q) => q.state !== "rise" && Math.hypot(q.x - p.x, q.z - p.z) < 7);
  let goal = null, run = false;
  if (chased && !g.flipped) {
    run = true;
    // a lit lamp's light, before the end, is the safest place there is
    const pool = !g.flipped && L.lamps.filter((l) => l.lit).map((l) => ({ l, dd: Math.hypot(l.front.x - p.x, l.front.z - p.z) })).sort((a, b) => a.dd - b.dd)[0];
    const closet = L.closets.map((c) => ({ c, dd: Math.hypot(c.front.x - p.x, c.front.z - p.z) })).sort((a, b) => a.dd - b.dd)[0];
    if (pool && pool.dd < 6) goal = pool.l.front;
    else if (closet && closet.dd < 1.3 && !h.sees) { inp.yaw = Math.atan2(closet.c.x - p.x, closet.c.z - p.z); inp.usePress = true; return inp; }
    else if (closet && closet.dd < 5) goal = closet.c.front;
    else {
      // away: the room furthest from it
      const hr = M.house.roomAt(L, h.x, h.z), hops = L.graph.hops[Math.max(0, hr)];
      const far = L.rooms.slice().sort((a, b) => hops[b.id] - hops[a.id])[0];
      goal = { x: far.cx, z: far.cz };
    }
    mem.goal = null;
  } else if (L.lamps.some((l) => !l.lit)) {
    if (!(p.lantern && p.oil > 0) && p.oil <= 0) {
      const lit = L.lamps.filter((l) => l.lit).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
      goal = lit ? lit.front : null;
    } else {
      if (!mem.goal || mem.goal.lit) mem.goal = L.lamps.filter((l) => !l.lit).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
      goal = mem.goal.front;
    }
  } else if (g.flipped) {
    const fd = L.doors.find((q) => q.kind === "front");
    goal = { x: fd.x, z: fd.z - 0.6, front: true };
    run = ghostNear || chased;
    inp.crouch = !run && h.active && d < 7;
    // one coming at it, nearer the door than it is: hide if a closet is right
    // there and it is not looking, or else go round the other way
    const gq = (g.ghosts || []).filter((q) => q.state === "chase" || (q.state === "hunt" && Math.hypot(q.x - p.x, q.z - p.z) < 4)).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
    if (gq && Math.hypot(gq.x - p.x, gq.z - p.z) < 6 && (gq.state === "chase" || Math.hypot(gq.x - fd.x, gq.z - fd.z) < Math.hypot(p.x - fd.x, p.z - fd.z))) {
      const closet = L.closets.map((c) => ({ c, dd: Math.hypot(c.front.x - p.x, c.front.z - p.z) })).sort((a, b) => a.dd - b.dd)[0];
      // (a ghost cannot open one, seen or not; it is the hunter it must not be seen by)
      if (closet && closet.dd < 1.3 && !(h.active && h.sees)) { inp.yaw = Math.atan2(closet.c.x - p.x, closet.c.z - p.z); inp.usePress = true; return inp; }
      if (closet && closet.dd < 5) goal = closet.c.front;
      else {
        const gr = M.house.roomAt(L, gq.x, gq.z), hops = L.graph.hops[Math.max(0, gr)];
        const far = L.rooms.slice().sort((a, b) => hops[b.id] - hops[a.id])[0];
        goal = { x: far.cx, z: far.cz };
      }
    }
  }
  if (goal) {
    mem.repath = (mem.repath || 0) - dt;
    if (!mem.path || mem.repath <= 0 || mem.goalKey !== goal.x + "," + goal.z) {
      // at the end it can see them (they glow), and walks round them where it can
      const gs = g.flipped ? g.ghosts.filter((q) => q.state !== "rise") : [];
      const avoid = gs.length ? (c) => { const x = nav.cx(g.G, c), z = nav.cz(g.G, c); let k = 0; for (const q of gs) { const dd = Math.hypot(q.x - x, q.z - z); if (dd < 3.5) k += (3.5 - dd) * 2; } return k; } : null;
      mem.path = nav.findPath(g.G, p.x, p.z, goal.x, goal.z, avoid, 0.5);
      mem.repath = 0.5; mem.goalKey = goal.x + "," + goal.z;
    }
    const path = mem.path;
    if (path && path.length) {
      while (path.length > 1 && Math.hypot(path[0].x - p.x, path[0].z - p.z) < 0.35) path.shift();
      const q = path[0];
      inp.yaw = Math.atan2(q.x - p.x, q.z - p.z);
      inp.fwd = 1; inp.run = run;
      // a shut door in the way: open it
      for (const door of L.doors) if (door.kind === "door" && door.open < 0.5 && !door.sealed && Math.hypot(door.x - p.x, door.z - p.z) < 1.4) { inp.yaw = Math.atan2(door.x - p.x, door.z - p.z); inp.usePress = true; break; }
    }
    // stuck: wiggle
    mem.since = (mem.since || 0) + dt;
    if (mem.since > 2) { if (mem.last && Math.hypot(mem.last.x - p.x, mem.last.z - p.z) < 0.25) { mem.wig = -(mem.wig || 1); inp.side = mem.wig; mem.path = null; } mem.last = { x: p.x, z: p.z }; mem.since = 0; }
  }
  const t = game.target(g);
  // (at the end its lantern stays out: no stopping at a lamp to light it)
  if (t && (t.kind === "lamp" || (t.kind === "borrow" && !g.flipped))) { inp.use = true; inp.fwd = 0; inp.yaw = Math.atan2(t.x - p.x, t.z - p.z); }
  if (t && t.kind === "front" && g.flipped) inp.usePress = true;
  if (t && t.kind === "tin") inp.usePress = true;
  return inp;
}

function playNight(M, o, maxT) {
  const g = M.game.newRun(o);
  const mem = {};
  const dt = 1 / 30;
  const track = { maxStep: 0, chases: 0, poolBreach: 0, tele: 0, burns: 0, farRips: 0, ghostStep: 0, ghostKills: 0, ghostNights: 0, ghostSpawnNear: 0, checks: 0, farChecks: 0, notice: {} };
  let last = { x: g.hunter.x, z: g.hunter.z, active: g.hunter.active }, lastG = [];
  while (g.t < (maxT || 1500) && g.state !== "won" && g.state !== "dead") {
    const inp = g.state === "play" ? pilot(M, g, mem, dt) : {};
    M.game.step(g, dt, inp);
    const h = g.hunter;
    let jumped = false;
    for (const e of g.events) {
      if (e.type === "chase") track.chases++;
      if (e.type === "burned") track.burns++;
      // a closet is torn open by something standing at it
      if (e.type === "kill" && e.how === "closet") { const c = g.L.closets[g.player.hiding >= 0 ? g.player.hiding : 0]; if (Math.hypot(c.front.x - h.x, c.front.z - h.z) > 1.3) track.farRips++; }
      if (e.type === "enter" || e.type === "respawn") jumped = true;
      if (e.type === "kill" && e.how === "ghost") track.ghostKills++;
      if (e.type === "checkCloset") { track.checks++; const s0 = h.search; if (!s0 || Math.hypot(g.L.closets[e.id].front.x - s0.x, g.L.closets[e.id].front.z - s0.z) > s0.r + 2.6) track.farChecks++; }
      if (e.type === "notice") track.notice[e.why] = (track.notice[e.why] || 0) + 1;
      if (e.type === "ghostRise" && Math.hypot(e.x - g.player.x, e.z - g.player.z) < 6) track.ghostSpawnNear++;
    }
    // the ghosts never move faster than they can, either
    if (g.ghosts.length) track.ghostNights = 1;
    g.ghosts.forEach((q, i) => { const o = lastG[i]; if (o && !jumped && g.state === "play") track.ghostStep = Math.max(track.ghostStep, Math.hypot(q.x - o.x, q.z - o.z) / dt); });
    lastG = g.ghosts.map((q) => ({ x: q.x, z: q.z }));
    if (h.active && last.active && !jumped) {
      const stepD = Math.hypot(h.x - last.x, h.z - last.z);
      track.maxStep = Math.max(track.maxStep, stepD / dt);
    }
    // before the end, it never stands in a relit lamp's light (bar the moment a lamp is lit on top of it)
    if (h.active && !g.flipped && h.burnedT <= 0) for (const l of g.L.lamps) if (l.lit && Math.hypot(l.x - h.x, l.z - h.z) < M.house.POOL_R - 0.35) track.poolBreach++;
    last = { x: h.x, z: h.z, active: h.active };
  }
  return { g, track };
}

(async function main() {
  section("Static: no emoji");
  {
    const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{2B00}-\u{2BFF}]/u;
    const bad = [];
    for (const rel of jsFiles.concat(["index.html", "css/lastflame.css", "sw.js", "manifest.webmanifest", "tools/validate.js", "tools/e2e.js", "README.md", "assets/models/CREDITS.md", "assets/sounds/CREDITS.md", "assets/textures/CREDITS.md"].filter(exists)))
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
    const pageV = (html.match(/window\.LF_VERSION\s*=\s*"([^"]+)"/) || [])[1];
    const cache = (sw.match(/var CACHE\s*=\s*"lastflame-v([^"]+)"/) || [])[1];
    check("index.html declares window.LF_VERSION", !!pageV, pageV);
    check("sw.js names its cache lastflame-v<version>", !!cache, cache);
    check("the two agree", pageV === cache, pageV + " vs " + cache);
    const install = sw.slice(sw.indexOf('addEventListener("install"'), sw.indexOf('addEventListener("message"'));
    check("no skipWaiting() inside install", !/skipWaiting\(\)/.test(install.replace(/\/\*[\s\S]*?\*\//g, "")));
    check('the worker answers "skip-waiting"', /e\.data === "skip-waiting"\) self\.skipWaiting\(\)/.test(sw));
    const upd = read("js/update.js");
    check("the page posts skip-waiting to a waiting worker", /postMessage\("skip-waiting"\)/.test(upd));
    check("the page reloads on controllerchange, only after a first controller", /controllerchange/.test(upd) && /hadController/.test(upd));
    check("the page checks periodically, on visibility and on online", /setInterval/.test(upd) && /visibilitychange/.test(upd) && /"online"/.test(upd));
    check("a night in progress is confirmed before reloading", /busy\(\) && !window\.confirm/.test(upd));
    check("index.html has the update bar", /id="update-bar"/.test(html) && /id="update-go"/.test(html) && /id="update-later"/.test(html));
    check("settings carry the version and a manual check", /updCheck/.test(read("js/ui.js")) && /Check for updates/.test(read("js/ui.js")));
  }

  section("Static: the worker's shell holds everything the game loads");
  {
    const shell = [...sw.matchAll(/"\.\/([^"]*)"/g)].map((m) => m[1]).filter(Boolean);
    const missing = shell.filter((f) => !exists(f));
    check("every shell entry exists (" + shell.length + ")", !missing.length, missing.join(", "));
    const need = jsFiles.concat(["css/lastflame.css", "manifest.webmanifest", "index.html"]);
    const absent = need.filter((f) => !shell.includes(f));
    check("every script, the stylesheet and the manifest are in the shell", !absent.length, absent.join(", "));
    const vendor = [];
    (function walk(d) { for (const f of fs.readdirSync(path.join(ROOT, d))) { const rel = d + "/" + f; if (fs.statSync(path.join(ROOT, rel)).isDirectory()) walk(rel); else if (rel.endsWith(".js")) vendor.push(rel); } })("vendor");
    const unvendored = vendor.filter((f) => !shell.includes(f));
    check("every vendored script is in the shell (" + vendor.length + ")", vendor.length && !unvendored.length, unvendored.join(", "));
    const assets = list("assets/models", ".glb").concat(list("assets/textures", ".webp"), list("assets/sounds", ".mp3"));
    const unshelledA = assets.filter((f) => !shell.includes(f));
    check("every model, surface and sound is in the shell (" + assets.length + ")", !unshelledA.length, unshelledA.join(", "));
    const render = await imp("js/render.js").catch(() => null);
    // render.js needs a browser to run, so its lists are read from the text
    const rsrc = read("js/render.js"), asrc = read("js/audio.js");
    const models = JSON.parse("[" + (rsrc.match(/const MODELS = \[([^\]]*)\]/) || [])[1] + "]");
    const textures = JSON.parse("[" + (rsrc.match(/const TEXTURES = \[([^\]]*)\]/) || [])[1] + "]");
    const sounds = JSON.parse("[" + (asrc.match(/export const SOUNDS = \[([^\]]*)\]/) || [])[1].replace(/\s+/g, "") + "]");
    void render;
    const want = models.map((m) => "assets/models/" + m + ".glb").concat(textures.flatMap((t) => ["", "_n", "_arm"].map((s) => "assets/textures/" + t + s + ".webp")), sounds.map((s) => "assets/sounds/" + s + ".mp3"));
    const notThere = want.filter((f) => !exists(f));
    check("every model, texture and sound the code names exists (" + want.length + ")", !notThere.length, notThere.join(", "));
    const unused = assets.filter((f) => !want.includes(f));
    check("no asset on disk that the code never loads", !unused.length, unused.join(", "));
    check("index.html maps \"three\" to the vendored build", /"three":"\.\/vendor\/build\/three\.module\.min\.js"/.test(html));
    // render.js and creature.js patch three's shaders by finding lines in them:
    // if three is ever updated and a line moves, the patch would quietly do nothing
    const three = read("vendor/build/three.module.min.js");
    const lines = ["#include <lights_fragment_maps>", "#include <envmap_physical_pars_fragment>", "#include <opaque_fragment>", "reflectVec = inverseTransformDirection( reflectVec, viewMatrix );", "vec3 radiance = vec3( 0.0 );", "vec3 iblIrradiance = vec3( 0.0 );"];
    const lost = lines.filter((l) => !three.includes(l));
    check("the shader patches find every line they patch in the vendored three", !lost.length, lost.join(" | "));
    const man = JSON.parse(read("manifest.webmanifest"));
    const icons = man.icons.map((i) => i.src).filter((s) => !exists(s));
    check("every manifest icon exists", !icons.length, icons.join(", "));
    const unshelled = man.icons.map((i) => i.src).filter((s) => !shell.includes(s));
    check("every manifest icon is in the shell", !unshelled.length, unshelled.join(", "));
    const big = assets.reduce((s, f) => s + fs.statSync(path.join(ROOT, f)).size, 0);
    check("the assets stay under 8 MB (" + (big / 1048576).toFixed(1) + " MB)", big < 8 * 1048576);
    // the Original textures: on disk, named as the code asks for them, and not
    // in the shell — they are fetched only when chosen, and kept after
    const orig = textures.flatMap((t) => ["", "_n", "_arm"].map((s) => "assets/textures/original/" + t + s + ".webp"));
    const noOrig = orig.filter((f) => !exists(f));
    check("every surface has its Original (" + orig.length + ")", !noOrig.length, noOrig.join(", "));
    const ix = exists("assets/models/original/index.json") ? JSON.parse(read("assets/models/original/index.json")) : {};
    const ixFiles = Object.values(ix), onDisk = list("assets/models/original", ".webp").map((f) => path.basename(f));
    check("the furniture's Original index names only files that are there (" + ixFiles.length + ")", ixFiles.length > 0 && ixFiles.every((f) => onDisk.includes(f)));
    check("and every file there is in it", onDisk.every((f) => ixFiles.includes(f)), onDisk.filter((f) => !ixFiles.includes(f)).join(", "));
    // every picture in every model is either in it, or is one of the few kept as shipped
    const glbImages = [];
    for (const f of list("assets/models", ".glb")) {
      const b = fs.readFileSync(path.join(ROOT, f)), n = b.readUInt32LE(12), j = JSON.parse(b.slice(20, 20 + n).toString("utf8"));
      for (const im of j.images || []) glbImages.push(im.name);
    }
    const covered = glbImages.filter((n) => ix[n]).length;
    check("almost every furniture texture has its Original (" + covered + "/" + glbImages.length + ")", covered >= glbImages.length - 2 && Object.keys(ix).every((n) => glbImages.includes(n)));
    const inShell = shell.filter((f) => /\/original\//.test(f));
    check("the Original set is not in the shell, so an install stays small", !inShell.length, inShell.slice(0, 3).join(", "));
    const origBytes = orig.filter(exists).concat(list("assets/models/original", ".webp")).reduce((s, f) => s + fs.statSync(path.join(ROOT, f)).size, 0);
    check("the Original set stays under 24 MB (" + (origBytes / 1048576).toFixed(1) + " MB)", origBytes < 24 * 1048576);
  }

  section("Static: ids, topics, icons, credits, provenance");
  {
    const src = jsFiles.map(read).join("\n");
    const htmlIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    const used = new Set([...src.matchAll(/(?:getElementById|\$)\("([A-Za-z][\w-]*)"\)/g)].map((m) => m[1]));
    const dynamic = new Set(["updState", "texState"]);
    const missing = [...used].filter((id) => !htmlIds.has(id) && !dynamic.has(id));
    check("every id the scripts reach for is in index.html (" + used.size + ")", !missing.length, missing.join(", "));
    const { TOPICS, NOTES } = await imp("js/topics.js");
    const infos = new Set([...(html + src).matchAll(/data-info="(\w+)"/g)].map((m) => m[1]).concat([...src.matchAll(/info\("(\w+)"\)/g)].map((m) => m[1])));
    const noTopic = [...infos].filter((k) => !TOPICS[k]);
    check("every (i) names a topic (" + infos.size + ")", !noTopic.length, noTopic.join(", "));
    check("three notes, as the house places three", NOTES.length === 3);
    const { ICONS } = await imp("js/icons.js");
    const named = new Set([...(html + src).matchAll(/data-icon="(\w+)"/g)].map((m) => m[1]).concat([...src.matchAll(/icon\("(\w+)"/g)].map((m) => m[1])));
    const undrawn = [...named].filter((k) => !ICONS[k]);
    check("every icon named is drawn (" + named.size + ")", !undrawn.length, undrawn.join(", "));
    for (const [dir, ext] of [["assets/models", ".glb"], ["assets/textures", ".webp"], ["assets/sounds", ".mp3"]]) {
      const cr = exists(dir + "/CREDITS.md") ? read(dir + "/CREDITS.md") : "";
      const files = list(dir, ext).map((f) => path.basename(f));
      const unc = files.filter((f) => !cr.includes("`" + f + "`") && !cr.includes("`" + f.replace(/(_n|_arm)?\.webp$/, "") + "`"));
      check(dir + "/CREDITS.md credits every file (" + files.length + ")", cr && !unc.length, unc.slice(0, 6).join(", "));
    }
    const lifted = { "js/update.js": "ballzooka/js/update.js", "js/info.js": "ballzooka/js/info.js", "js/icons.js": "ballzooka/js/icons.js", "js/rng.js": "ballzooka/js/rng.js", "js/save.js": "ballzooka/js/save.js", "sw.js": "ballzooka/sw.js", "js/render.js": "ballzooka/js/render.js", "js/audio.js": "ballzooka/js/audio.js", "js/creature.js": "hacks/js/skeleton.js" };
    for (const [f, from] of Object.entries(lifted)) check(f + " says it was lifted from " + from, read(f).includes(from));
    check("no API keys or outside requests in the scripts", !/https?:\/\/(?!creativecommons)/.test(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")));
  }

  section("Behaviour: houses");
  const house = await imp("js/house.js");
  const nav = await imp("js/nav.js");
  const hunt = await imp("js/hunter.js");
  const game = await imp("js/game.js");
  const ghosts = await imp("js/ghosts.js");
  const { rng } = await imp("js/rng.js");
  const M = { house, nav, hunt, game };
  {
    const N = 250, bad = { gen: 0, lamps: 0, rooms: 0, first: 0, closets: 0, caidaCloset: 0, reach: [], loops: 0 };
    const t0 = Date.now();
    for (let s = 0; s < N; s++) {
      let L;
      try { L = house.generate(s * 977 + 3); } catch (e) { bad.gen++; continue; }
      const G = nav.buildGrid(L);
      if (L.lamps.length !== 5) bad.lamps++;
      if (new Set(L.lamps.map((l) => l.room)).size !== 5) bad.rooms++;
      if (L.rooms[L.lamps[0].room].type !== "caida" || Math.hypot(L.lamps[0].x - L.start.x, L.lamps[0].z - L.start.z) > 6.8) bad.first++;
      if (L.closets.length < 5) bad.closets++;
      if (!L.closets.some((c) => L.rooms[c.room].type === "caida")) bad.caidaCloset++;
      if (L.loops < 2) bad.loops++;
      const spots = L.lamps.map((l) => ["lamp " + l.id, l.front]).concat(L.closets.map((c) => ["closet " + c.id, c.front]), [["exit", L.exit]]);
      for (const [name, at] of spots) if (!nav.findPath(G, L.start.x, L.start.z, at.x, at.z, null, 0.5)) bad.reach.push(L.seed + ":" + name);
      if (house.cutOff(L).length) bad.reach.push(L.seed + ":doorway");
    }
    const ms = Date.now() - t0;
    check(N + " houses build (" + Math.round(ms / N) + " ms each)", !bad.gen, bad.gen + " failed");
    check("every house has five lamps, in five different rooms", !bad.lamps && !bad.rooms, bad.lamps + " / " + bad.rooms);
    check("the first lamp is in the caida, a few steps from the front door", !bad.first, bad.first + " houses");
    check("at least five closets, and one in the caida for the first visit", !bad.closets && !bad.caidaCloset, bad.closets + " / " + bad.caidaCloset);
    check("at least two loops in every house (a way round it)", !bad.loops, bad.loops + " houses");
    check("every lamp, closet, doorway and the front door can be walked to", !bad.reach.length, bad.reach.slice(0, 5).join(", "));
    const a = JSON.stringify(house.generate(12345).props), b = JSON.stringify(house.generate(12345).props);
    check("a seed builds the same house twice", a === b);
  }

  section("Behaviour: the house changes at the fifth lamp, and never traps anyone");
  {
    let sealed = 0, trapped = [];
    for (let s = 0; s < 120; s++) {
      const L = house.generate(s * 31 + 7);
      const ch = house.alter(L, L.lamps[4].room, rng(s), null);
      if (ch.sealed.length) sealed++;
      const G = nav.buildGrid(L);
      if (!house.connected(L)) trapped.push(L.seed + ":disconnected");
      for (const l of L.lamps) if (!nav.findPath(G, l.front.x, l.front.z, L.exit.x, L.exit.z, null, 0.5)) trapped.push(L.seed + ":lamp" + l.id);
    }
    check("from every lamp, the front door can still be reached", !trapped.length, trapped.slice(0, 5).join(", "));
    check("most houses board up a doorway on the way back (" + sealed + "/120)", sealed > 90);
  }

  section("Behaviour: light goes round, never through");
  {
    // a lit lamp's glow (render.js's bounce light) reaches a spot in another
    // room no sooner than the walk through one of its own doorways
    let bad = 0, shutBad = 0, n = 0, reached = 0;
    for (let s = 0; s < 40; s++) {
      const L = house.generate(s * 53 + 11), A = nav.airGrid(L);
      for (const l of L.lamps) {
        const f = nav.lightField(A, l.x, l.z, 30), mine = l.room;
        const ways = L.doors.filter((d) => (d.a === mine || d.b === mine) && !d.sealed && d.open > 0.5);
        for (let c = 0; c < f.length; c++) {
          if (A.wall[c] || A.shut[c] || f[c] === Infinity) continue;
          const x = (c % A.nx + 0.5) * nav.RES, z = (Math.floor(c / A.nx) + 0.5) * nav.RES, r = house.roomAt(L, x, z);
          if (r === mine || r < 0) continue;
          n++; reached++;
          const via = Math.min(...ways.map((d) => Math.hypot(d.x - l.x, d.z - l.z) + Math.hypot(x - d.x, z - d.z)));
          if (f[c] < via - 0.9) bad++;
        }
        // with every door of its room shut and no open arch, it stays in the room
        const arches = L.doors.some((d) => (d.a === mine || d.b === mine) && d.kind !== "door" && !d.sealed);
        if (!arches) {
          const saved = L.doors.map((d) => d.open);
          for (const d of L.doors) if (d.a === mine || d.b === mine) d.open = 0;
          nav.airDoors(A);
          const g2 = nav.lightField(A, l.x, l.z, 40);
          for (let c = 0; c < g2.length; c++) {
            if (A.wall[c] || A.shut[c] || g2[c] === Infinity) continue;
            const x = (c % A.nx + 0.5) * nav.RES, z = (Math.floor(c / A.nx) + 0.5) * nav.RES, r = house.roomAt(L, x, z);
            if (r !== mine && r >= 0) { shutBad++; break; }
          }
          L.doors.forEach((d, i) => { d.open = saved[i]; });
          nav.airDoors(A);
        }
      }
    }
    check("a lamp's light leaves its room only through a doorway (" + reached + " spots reached next door)", !bad && reached > 1000, bad + " spots lit through a wall");
    check("and a shut door keeps it in", !shutBad, shutBad + " lamps leaked");
  }

  section("Behaviour: the rules");
  {
    // oil: burns lit, faster running, not at all with the wick down
    const g1 = game.newRun({ seed: 5, skipIntro: true });
    const o0 = g1.player.oil;
    for (let i = 0; i < 300; i++) game.step(g1, 1 / 30, { yaw: g1.player.yaw });
    const still = o0 - g1.player.oil;
    const g2 = game.newRun({ seed: 5, skipIntro: true });
    for (let i = 0; i < 300; i++) game.step(g2, 1 / 30, { yaw: g2.player.yaw, fwd: 1, run: true });
    const ran = o0 - g2.player.oil;
    const g3 = game.newRun({ seed: 5, skipIntro: true });
    game.step(g3, 1 / 30, { lanternPress: true });
    for (let i = 0; i < 300; i++) game.step(g3, 1 / 30, {});
    check("oil burns while lit (" + still.toFixed(3) + " in 10 s)", still > 0.04 && still < 0.08);
    check("running burns it faster", ran > still * 1.3, ran.toFixed(3));
    check("a wick turned down burns nothing", Math.abs(o0 - 1 / 175 / 30 - g3.player.oil) < 0.002, (o0 - g3.player.oil).toFixed(4));
    // lighting a lamp gives oil back, once
    const g = game.newRun({ seed: 9 });
    const l = g.L.lamps[0], p = g.player;
    p.x = l.front.x; p.z = l.front.z;
    const before = p.oil;
    for (let i = 0; i < 40; i++) game.step(g, 1 / 30, { yaw: Math.atan2(l.x - p.x, l.z - p.z), use: true });
    check("holding the flame to a lamp lights it", l.lit && g.lit === 1);
    check("and gives oil back", p.oil > before + 0.3, before.toFixed(2) + " -> " + p.oil.toFixed(2));
    // light and sight
    const gs = game.newRun({ seed: 2, skipIntro: true });
    gs.hunter.active = true; gs.hunter.state = "patrol";
    gs.lanternPower = 1; gs.player.lantern = true;
    const lit = hunt.sightRange(gs);
    gs.player.lantern = false;
    const darkR = hunt.sightRange(gs);
    gs.player.crouch = true;
    const crouchR = hunt.sightRange(gs);
    check("a lit lantern is seen from far (" + lit.toFixed(1) + " m)", lit > 14);
    check("in the dark it has to be close (" + darkR.toFixed(1) + " m, crouched " + crouchR.toFixed(1) + " m)", darkR < 4 && crouchR < darkR);
    // sound along the floor
    const gh = game.newRun({ seed: 3, skipIntro: true });
    const hh = gh.hunter; hh.active = true; hh.state = "patrol";
    const rm = gh.L.rooms.find((x) => x.type === "sala");
    hh.x = rm.cx; hh.z = rm.cz;
    const N = game.NOISE;
    const field = nav.soundField(gh.G, hh.x, hh.z, 30);
    // find floor 6–8 m away along the floor
    let spot = null;
    for (let c = 0; c < field.length && !spot; c++) if (field[c] > 6 && field[c] < 7.5 && !gh.G.solid[c]) spot = { x: nav.cx(gh.G, c), z: nav.cz(gh.G, c) };
    const heardRun = hunt.hear(gh, spot.x, spot.z, N.run, "step");
    hh.state = "patrol";
    const heardCrouch = hunt.hear(gh, spot.x, spot.z, N.crouch, "step");
    const heardWalk = hunt.hear(gh, spot.x, spot.z, N.walk, "step");
    check("running is heard from 6–7 m along the floor", heardRun);
    check("creeping and walking are not", !heardCrouch && !heardWalk);
    // through a wall it is the walk round that counts
    let farThroughWall = 0, n = 0;
    const hroom = house.roomAt(gh.L, hh.x, hh.z);
    for (let c = 0; c < field.length; c++) {
      if (gh.G.solid[c] || field[c] === Infinity) continue;
      const x = nav.cx(gh.G, c), z = nav.cz(gh.G, c), st = Math.hypot(x - hh.x, z - hh.z);
      if (house.roomAt(gh.L, x, z) === hroom || st > 5) continue;
      n++; if (field[c] > st * 1.4) farThroughWall++;
    }
    check("a sound behind a wall travels the long way round (" + farThroughWall + " of " + n + " spots next door)", farThroughWall > n * 0.3 && n > 20);
    // the closet rule
    const gc = game.newRun({ seed: 11, skipIntro: true });
    const c0 = gc.L.closets[0], pc = gc.player, hc = gc.hunter;
    hc.active = true; hc.state = "patrol"; hc.x = gc.L.rooms[gc.L.rooms.length - 1].cx; hc.z = gc.L.rooms[gc.L.rooms.length - 1].cz;
    pc.x = c0.front.x; pc.z = c0.front.z; pc.lantern = false;
    game.step(gc, 1 / 30, { yaw: Math.atan2(c0.x - pc.x, c0.z - pc.z), usePress: true });
    check("stepping into a closet hides you", pc.hiding === c0.id);
    check("unseen, it does not know where you went", hc.sawHide < 0);
    const gc2 = game.newRun({ seed: 11, skipIntro: true });
    const p2 = gc2.player, h2 = gc2.hunter, c2 = gc2.L.closets[0];
    p2.x = c2.front.x; p2.z = c2.front.z;
    h2.active = true; h2.state = "chase"; h2.x = c2.front.x + c2.n[0] * 2.5; h2.z = c2.front.z + c2.n[1] * 2.5; h2.sees = true;
    game.step(gc2, 1 / 30, { yaw: Math.atan2(c2.x - p2.x, c2.z - p2.z), usePress: true });
    let ripped = false;
    for (let i = 0; i < 30 * 12 && gc2.state === "play"; i++) game.step(gc2, 1 / 30, {});
    ripped = gc2.state === "caught" || gc2.stats.deaths > 0;
    check("seen going in, it tears the closet open", h2.sawHide === c2.id || ripped);
    check("and that is the end of hiding", ripped);
    // relit lamps keep it out, and Lola's Rules wakes you by the last one
    check("waking in Lola's Rules puts you back in play", (function () { for (let i = 0; i < 30 * 4; i++) game.step(gc2, 1 / 30, {}); return gc2.state === "play"; })());
    const gd = game.newRun({ seed: 11, skipIntro: true, mode: "onenight" });
    gd.hunter.active = true; gd.hunter.state = "chase"; gd.hunter.x = gd.player.x + 0.3; gd.hunter.z = gd.player.z;
    for (let i = 0; i < 30 * 4; i++) game.step(gd, 1 / 30, {});
    check("in One Night, caught is the end", gd.state === "dead");
    // the threat climbs with every lamp
    const gt = game.newRun({ seed: 4, skipIntro: true });
    gt.hunter.active = true;
    game.step(gt, 1 / 30, {}); const T0 = gt.dir.T;
    gt.lit = 3; game.step(gt, 1 / 30, {}); const T3 = gt.dir.T;
    check("the threat level climbs with the lamps (" + T0 + " -> " + T3 + ")", T3 >= T0 + 9);
    // Relax: after it, it walks away and does not come for noises
    const gr = game.newRun({ seed: 6, skipIntro: true });
    const hr = gr.hunter; hr.active = true; hr.x = gr.L.rooms[3].cx; hr.z = gr.L.rooms[3].cz;
    gr.relax();
    check("Relax sends it away", hr.state === "retreat" && gr.dir.relaxT > 20);
    check("and while it retreats, a footstep does not bring it back", !hunt.hear(gr, hr.x + 1, hr.z, 9, "step"));
    // the end: the house turns, the door opens, the lantern is a beacon
    const gf = game.newRun({ seed: 8, skipIntro: true });
    for (const lp of gf.L.lamps) { lp.lit = true; lp.refilled = true; }
    gf.lit = 4; gf.lastLamp = 3;
    gf.player.x = gf.L.lamps[3].front.x; gf.player.z = gf.L.lamps[3].front.z;
    gf.L.lamps[4].lit = false; gf.lit = 4;
    const l4 = gf.L.lamps[4];
    gf.player.x = l4.front.x; gf.player.z = l4.front.z;
    for (let i = 0; i < 40; i++) game.step(gf, 1 / 30, { yaw: Math.atan2(l4.x - gf.player.x, l4.z - gf.player.z), use: true });
    check("the fifth lamp brings the breather", gf.phase === "breather");
    for (let i = 0; i < 30 * 40 && !gf.flipped; i++) game.step(gf, 1 / 30, {});
    const fd = gf.L.doors.find((d) => d.kind === "front");
    check("then the house turns: the peak, and the front door unlocked", gf.flipped && gf.phase === "peak" && !fd.locked);
    gf.player.lantern = true; gf.player.oil = 0.5;
    for (let i = 0; i < 60; i++) game.step(gf, 1 / 30, {});
    check("a lit lantern at the end is a beacon it knows", gf.hunter.lastSeen && gf.hunter.lastSeen.beacon);
  }

  section("Behaviour: what it does with what it knows");
  {
    // a search round a closet door it heard shut: sometimes it opens one, the nearest
    let n = 0, opened = 0, near = 0;
    for (let s = 0; s < 40; s++) {
      const g = game.newRun({ seed: 300 + s, skipIntro: true }), h = g.hunter, c = g.L.closets[s % g.L.closets.length];
      const rm = g.L.rooms[(c.room + 3) % g.L.rooms.length];
      Object.assign(h, { active: true, x: rm.cx, z: rm.cz });
      const free = nav.nearestFree(g.G, h.x, h.z); h.x = nav.cx(g.G, free); h.z = nav.cz(g.G, free);
      // the player out of it: hidden, dark, in the closet furthest away
      const far = g.L.closets.slice().sort((a, b) => Math.hypot(b.x - c.x, b.z - c.z) - Math.hypot(a.x - c.x, a.z - c.z))[0];
      Object.assign(g.player, { x: far.inside.x, z: far.inside.z, hiding: far.id, lantern: false, dread: 0 });
      g.dir.relaxT = 0;
      hunt.investigate(g, c.front.x, c.front.z, 3, { closet: true });
      n++;
      for (let i = 0; i < 30 * 40 && h.state !== "patrol"; i++) {
        game.step(g, 1 / 30, { yaw: g.player.yaw });
        for (const e of g.events) if (e.type === "checkCloset") { opened++; if (Math.hypot(g.L.closets[e.id].front.x - c.front.x, g.L.closets[e.id].front.z - c.front.z) < 5.6) near++; }
      }
    }
    check("a search round a closet it heard sometimes ends at one (" + opened + "/" + n + ")", opened > n * 0.15 && opened < n * 0.6);
    check("and it is one near where it was looking", near === opened);
    // your lantern, round a corner: it sees the light on the walls and comes
    let tried = 0, light = 0;
    for (let s = 0; s < 40; s++) {
      const g = game.newRun({ seed: 100 + s, skipIntro: true }), L = g.L, p = g.player, h = g.hunter;
      const d = L.doors.find((q) => q.kind === "arch" && q.b >= 0);
      if (!d) continue;
      const ra = L.rooms[d.a], nA = d.v ? [Math.sign(ra.cx - d.x), 0] : [0, Math.sign(ra.cz - d.z)], side = d.v ? [0, 1] : [1, 0];
      const hc = nav.nearestFree(g.G, d.x + nA[0] * 3.5, d.z + nA[1] * 3.5);
      let pc = -1;
      for (const sg of [1, -1]) { const c = nav.nearestFree(g.G, d.x - nA[0] * 1.2 + side[0] * 1.7 * sg, d.z - nA[1] * 1.2 + side[1] * 1.7 * sg); if (c >= 0 && hc >= 0 && !nav.sees(g.G, nav.cx(g.G, hc), nav.cz(g.G, hc), nav.cx(g.G, c), nav.cz(g.G, c))) { pc = c; break; } }
      if (hc < 0 || pc < 0) continue;
      tried++;
      Object.assign(h, { active: true, state: "patrol", x: nav.cx(g.G, hc), z: nav.cz(g.G, hc), path: null, wait: 99 });
      h.yaw = Math.atan2(d.x - h.x, d.z - h.z);
      p.x = nav.cx(g.G, pc); p.z = nav.cz(g.G, pc); p.lantern = true; p.oil = 0.9; g.dir.relaxT = 0;
      let why = null;
      for (let i = 0; i < 30 * 5 && !why; i++) { game.step(g, 1 / 30, { yaw: p.yaw }); for (const e of g.events) if (e.type === "notice") why = e.why; }
      if (why === "light") light++;
    }
    check("it sees your lantern's light round a corner, and comes (" + light + " of " + tried + " corners)", tried >= 5 && light >= 2);
  }

  section("Behaviour: the first visit is a lesson, not a trap");
  {
    // light the first lamp, then either hide (lantern still lit — nobody has said not to yet)
    // or stand in plain sight; either way the first visit must end with you alive
    const intro = (seed, hide) => {
      const g = game.newRun({ seed });
      const p = g.player, L = g.L, l0 = L.lamps[0], cl = L.closets.find((c) => L.rooms[c.room].type === "caida");
      p.x = l0.front.x; p.z = l0.front.z;
      let hidden = false, sawPass = false;
      for (let i = 0; i < 30 * 70 && g.state === "play"; i++) {
        const inp = { yaw: p.yaw };
        if (!l0.lit) { inp.yaw = Math.atan2(l0.x - p.x, l0.z - p.z); inp.use = true; }
        else if (g.hints.hide && hide && !hidden) { p.x = cl.front.x; p.z = cl.front.z; inp.yaw = Math.atan2(cl.x - p.x, cl.z - p.z); inp.usePress = true; hidden = true; }
        else if (!hide && g.hunter.active) inp.yaw = Math.atan2(g.hunter.x - p.x, g.hunter.z - p.z);
        game.step(g, 1 / 30, inp);
        if (g.hunter.state === "pass") sawPass = true;
        if (g.flags.passDone && g.t > 50) break;
      }
      return { g, sawPass };
    };
    let fine = 0, passed = 0, n = 0;
    for (let s = 1; s <= 12; s++) for (const hide of [true, false]) {
      const { g, sawPass } = intro(s * 101, hide);
      n++; if (sawPass) passed++;
      if (g.stats.deaths === 0 && g.flags.passDone) fine++;
    }
    check("it comes in for the first visit every time (" + passed + "/" + n + ")", passed === n);
    check("and leaves you alive, hidden with a lit lantern or standing in its sight (" + fine + "/" + n + ")", fine === n);
  }

  section("Behaviour: whole nights, played by the autopilot");
  {
    const N = 24;
    let won = 0, deaths = 0, maxStep = 0, breaches = 0, chases = 0, burns = 0, farRips = 0, ghostStep = 0, ghostKills = 0, ghostNights = 0, ghostNear = 0, checks = 0, farChecks = 0;
    const notice = {};
    const times = [];
    for (let s = 0; s < N; s++) {
      const { g, track } = playNight(M, { seed: 7000 + s * 13, mode: "lola" }, 1500);
      if (g.state === "won") { won++; times.push(g.t); }
      deaths += g.stats.deaths;
      maxStep = Math.max(maxStep, track.maxStep);
      breaches += track.poolBreach;
      chases += track.chases;
      burns += track.burns;
      farRips += track.farRips;
      ghostStep = Math.max(ghostStep, track.ghostStep); ghostKills += track.ghostKills; ghostNights += track.ghostNights; ghostNear += track.ghostSpawnNear;
      checks += track.checks; farChecks += track.farChecks;
      for (const k in track.notice) notice[k] = (notice[k] || 0) + track.notice[k];
    }
    times.sort((a, b) => a - b);
    const med = times.length ? times[Math.floor(times.length / 2)] : 0;
    check("the autopilot gets out of most houses (" + won + "/" + N + ")", won >= N * 0.75);
    check("it never moves faster than it can run (" + maxStep.toFixed(2) + " m/s)", maxStep <= game.FEAR.normal.vmax + 0.05);
    check("before the end, it never walks into a relit lamp's light", breaches === 0, breaches + " frames");
    check("a night has chases in it (" + (chases / N).toFixed(1) + " a night)", chases / N >= 0.5);
    check("it is rarely caught in a lamp's light, and never stuck there (" + (burns / N).toFixed(2) + " burns a night)", burns / N < 1);
    check("a closet is only ever torn open by something standing at it", farRips === 0, farRips + " from a distance");
    check("the end brings the ghosts out of the lamps (" + ghostNights + "/" + N + " nights)", ghostNights >= won);
    check("a ghost never moves faster than its chase (" + ghostStep.toFixed(2) + " m/s)", ghostStep <= ghosts.GHOST.chase * ghosts.GHOSTS.merciless.pace + 0.05);
    check("no ghost comes out of a lamp right beside you", ghostNear === 0, ghostNear + " times");
    check("the ghosts catch people, sometimes (" + ghostKills + " in " + N + " nights)", ghostKills > 0);
    check("a closet it guesses at is always one near where it was searching", farChecks === 0, farChecks + " far away");
    process.stdout.write("    autopilot: " + won + "/" + N + " escaped, " + (deaths / N).toFixed(1) + " deaths a night, median " + Math.round(med) + " s\n");
    // the same seed and the same hands: the same night
    const a = playNight(M, { seed: 4242 }, 400).g, b = playNight(M, { seed: 4242 }, 400).g;
    check("a night replays exactly from its seed", a.t === b.t && a.lit === b.lit && Math.abs(a.hunter.x - b.hunter.x) < 1e-9);
  }

  process.stdout.write("\n" + (failures.length ? failures.length + " of " + checks + " checks failed" : "All " + checks + " checks passed") + "\n");
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
