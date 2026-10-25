#!/usr/bin/env node
/* ============================================================
   Magic Circles — validation harness
   `node tools/validate.js`

   Same shape as magic_sandbox/tools/validate.js (and RouteCast's before it).
   Two halves, both of which have to pass before anything ships:

   1. Static checks over the source as text: no emoji, every module parses,
      the page and the service worker agree on the version, the worker never
      takes over by itself, every file the game loads is in the shell, every
      id the scripts reach for is in index.html, every (i) names a topic,
      every icon named is drawn, every lifted file says where it came from,
      and the models on disk, the manifest and the code agree.

   2. Behaviour checks over the pure modules — world.js and spellcore.js —
      imported straight into Node: the same seed grows the same world and a
      different one a different world; roads agree from both sides and every
      hub carries a waystone; structures never cross a road and only stand
      where their biome allows; every preset is 8×8 and every code in it
      means something; the start is clear; chunks are cheap to build; the
      predator cycle eats what it should and only that; the spectrum covers
      every kind; the starters and examples compile to what they claim; junk
      from localStorage is refused rather than "fixed"; and rank limits bite.

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
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

function sourceFiles() {
  const out = [];
  (function walk(dir) {
    for (const name of fs.readdirSync(path.join(ROOT, dir))) {
      const rel = path.join(dir, name);
      if (rel.startsWith("vendor") || rel.startsWith("assets") || name.startsWith(".")) continue;
      if (fs.statSync(path.join(ROOT, rel)).isDirectory()) { walk(rel); continue; }
      if (/\.(js|css|html|md|webmanifest|json)$/.test(name)) out.push(rel);
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
    // Pictographs specifically: the copy uses em dashes, middle dots, ▸ and × on purpose.
    const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{2B00}-\u{2BFF}]/u;
    const bad = [];
    for (const rel of sourceFiles()) read(rel).split("\n").forEach((line, i) => { const m = line.match(EMOJI); if (m) bad.push(rel + ":" + (i + 1) + " " + JSON.stringify(m[0])); });
    check("no emoji or pictographic characters in source", bad.length === 0, bad.slice(0, 8).join(", "));
  }

  section("Static: every module parses");
  for (const rel of jsFiles.concat(["sw.js", "tools/validate.js", "tools/manifest.js", "tools/e2e.js"].filter(exists))) {
    try {
      const args = rel.startsWith("js/") ? ["--experimental-default-type=module", "--check", path.join(ROOT, rel)] : ["--check", path.join(ROOT, rel)];
      execFileSync(process.execPath, args, { stdio: "pipe" });
      ok(rel);
    } catch (e) { fail(rel, String(e.stderr || e.message).split("\n").slice(0, 4).join(" ")); }
  }

  section("Static: one version number");
  {
    const pageV = (html.match(/window\.MC_VERSION\s*=\s*"([^"]+)"/) || [])[1];
    const cache = (sw.match(/var CACHE\s*=\s*"mcircles-v([^"]+)"/) || [])[1];
    check("index.html declares window.MC_VERSION", !!pageV, pageV);
    check("sw.js names its cache mcircles-v<version>", !!cache, cache);
    check("the page and the worker carry the same version", pageV && pageV === cache, pageV + " vs " + cache);
  }

  section("Static: the worker waits to be asked");
  {
    const install = (sw.match(/addEventListener\("install"[\s\S]*?\n\}\);/) || [""])[0].replace(/\/\*[\s\S]*?\*\//g, "");
    check("no skipWaiting() inside install", !/skipWaiting\s*\(/.test(install));
    check('answers the house "skip-waiting" message', /e\.data === "skip-waiting"\) self\.skipWaiting\(\)/.test(sw));
    check("page registers sw.js at a stable URL", /register\("sw\.js"\)/.test(allJs));
    check("update.js posts skip-waiting", /postMessage\("skip-waiting"\)/.test(read("js/update.js")));
    check("update.js reloads only on a real controller change", /if \(!hadController \|\| reloading\) return;/.test(read("js/update.js")));
    check("update.js checks every 30 minutes, on visibility and on reconnect", /CHECK_MS = 30 \* 60 \* 1000/.test(read("js/update.js")) && /visibilitychange/.test(read("js/update.js")) && /"online"/.test(read("js/update.js")));
    check("a reload mid-fight is confirmed first", /busy\(\) && !window\.confirm/.test(read("js/update.js")));
    check("Settings has the version and Check for updates", /id="setVersion"/.test(html) && /id="btnCheckUpdate"/.test(html));
    check("the update bar is on the page", /id="update-bar"/.test(html) && /id="update-go"/.test(html) && /id="update-later"/.test(html));
  }

  section("Static: the shell has everything the game loads");
  {
    const shell = [...sw.matchAll(/"\.\/([^"]*)"/g)].map((m) => m[1]).filter(Boolean);
    const missing = shell.filter((f) => !exists(f));
    check("every SHELL entry exists on disk", missing.length === 0, missing.join(", "));
    const seen = new Set();
    const queue = ["js/main.js"];
    while (queue.length) {
      const rel = queue.shift();
      if (seen.has(rel)) continue;
      seen.add(rel);
      if (!exists(rel)) { fail("import target exists: " + rel); continue; }
      const src = read(rel);
      for (const m of src.matchAll(/(?:import|export)\s[^'"]*?from\s*['"](\.[^'"]+)['"]/g)) queue.push(path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1])));
    }
    seen.add("vendor/build/three.module.min.js");
    const notShelled = [...seen].filter((f) => !shell.includes(f));
    check("every module reachable from main.js is in SHELL (" + seen.size + ")", notShelled.length === 0, notShelled.join(", "));
    const orphans = jsFiles.filter((f) => !seen.has(f));
    check("no module in js/ is unused", orphans.length === 0, orphans.join(", "));
    const vendored = [];
    (function walk(d) { for (const n of fs.readdirSync(path.join(ROOT, d))) { const r = d + "/" + n; if (fs.statSync(path.join(ROOT, r)).isDirectory()) walk(r); else if (r.endsWith(".js")) vendored.push(r); } })("vendor");
    const deadVendor = vendored.filter((f) => !seen.has(f));
    check("every vendored script is used", deadVendor.length === 0, deadVendor.join(", "));
    check("the stylesheet is in SHELL", shell.includes("css/game.css"));
    check("the model manifest is in SHELL", shell.includes("assets/manifest.json"));
    const mani = JSON.parse(read("manifest.webmanifest"));
    check("manifest icons exist", (mani.icons || []).every((i) => exists(i.src)), "");
    check("manifest starts at the folder, not the old phaser.html", mani.start_url === "./");
    check("no script or style comes from a CDN", !/<script[^>]+src="https?:/.test(html) && !/<link[^>]+href="https?:\/\/(?!buymeacoffee)/.test(html));
    check("phaser.html sends old installs to the game", /location\.replace\("\.\/"\)/.test(read("phaser.html")));
  }

  section("Static: models");
  {
    const m = JSON.parse(read("assets/manifest.json"));
    const files = Object.values(m.models).map((e) => "assets/" + e.file);
    check("every model in the manifest exists", files.every(exists), files.filter((f) => !exists(f)).join(", "));
    const onDisk = [];
    for (const kit of fs.readdirSync(path.join(ROOT, "assets/models"))) for (const f of fs.readdirSync(path.join(ROOT, "assets/models", kit))) if (f.endsWith(".glb")) onDisk.push("assets/models/" + kit + "/" + f);
    const unlisted = onDisk.filter((f) => !files.includes(f));
    check("no model ships without being in the manifest (" + onDisk.length + ")", unlisted.length === 0, unlisted.join(", ") + " — run node tools/manifest.js");
    const unreferenced = Object.keys(m.models).filter((k) => !allJs.includes('"' + k + '"'));
    check("every model is used by name somewhere", unreferenced.length === 0, unreferenced.join(", "));
    // and the other way: every model the code names is shipped
    const named = new Set([...allJs.matchAll(/"((?:nature|town|grave|castle|survival|dungeon|people)\/[\w-]+)"/g)].map((x) => x[1]));
    const absent = [...named].filter((k) => !m.models[k]);
    check("every model the code names is shipped (" + named.size + ")", absent.length === 0, absent.join(", "));
    const textured = fs.readdirSync(path.join(ROOT, "assets/models")).filter((k) => fs.existsSync(path.join(ROOT, "assets/models", k, "Textures")));
    check("every textured kit carries its colour map", textured.every((k) => exists("assets/models/" + k + "/Textures/colormap.png")), textured.join(", "));
    check("assets/CREDITS.md names every kit", fs.readdirSync(path.join(ROOT, "assets/models")).every((k) => read("assets/CREDITS.md").includes("models/" + k)));
    const fresh = require(path.join(ROOT, "tools/manifest.js")).build();
    check("assets/manifest.json is what tools/manifest.js would write", JSON.stringify(fresh) === JSON.stringify(m), "run node tools/manifest.js");
  }

  section("Static: ids, info topics and icons");
  {
    const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    const wanted = new Set();
    for (const src of jsFiles.map(read)) {
      for (const m of src.matchAll(/(?:\$|getElementById|el)\(\s*"([A-Za-z][\w-]*)"\s*\)/g)) wanted.add(m[1]);
      for (const m of src.matchAll(/set\(\s*"([A-Za-z][\w-]*)"\s*,/g)) wanted.add(m[1]);
    }
    const dynamicPrefixes = ["scr-", "set_", "mp_", "mpn_", "mpw_"];
    const missing = [...wanted].filter((id) => !ids.has(id) && !dynamicPrefixes.some((p) => id.startsWith(p)));
    check("every id the scripts reach for is in index.html (" + wanted.size + ")", missing.length === 0, missing.join(", "));
    for (const s of ["title", "new", "pause", "settings", "death"]) if (!ids.has("scr-" + s)) fail("screen scr-" + s + " exists");
    for (const k of ["master", "music", "sfx", "shake", "numbers", "flashes", "autoAim"]) if (!ids.has("set_" + k)) fail("setting set_" + k + " exists");
    for (const e of ["air", "fire", "earth", "water"]) for (const p of ["mp_", "mpn_", "mpw_"]) if (!ids.has(p + e)) fail("element gauge " + p + e + " exists");
    const { TOPICS } = await load("js/topics.js");
    const used = new Set([...(html + allJs).matchAll(/data-info="([\w-]+)"/g)].map((m) => m[1]));
    const bad = [...used].filter((k) => !TOPICS[k]);
    check("every data-info names a topic (" + used.size + " used)", bad.length === 0, bad.join(", "));
    const icons = await load("js/icons.js");
    const names = new Set(Object.keys(icons.ICONS));
    const usedIcons = new Set([...html.matchAll(/data-icon="(\w+)"/g)].map((m) => m[1]));
    for (const m of allJs.matchAll(/icon\(\s*"(\w+)"/g)) usedIcons.add(m[1]);
    for (const m of allJs.matchAll(/toast\("[^"]*",\s*"(\w+)"\)/g)) usedIcons.add(m[1]);
    for (const m of allJs.matchAll(/s\.great \? "(\w+)" : "(\w+)"/g)) { usedIcons.add(m[1]); usedIcons.add(m[2]); }
    const badIcons = [...usedIcons].filter((n) => !names.has(n));
    check("every icon named in the page or scripts exists (" + usedIcons.size + ")", badIcons.length === 0, badIcons.join(", "));
    const unbalanced = [...names].filter((n) => {
      const svg = icons.icon(n);
      return (svg.match(/<(svg|path|circle)\b/g) || []).length !== (svg.match(/\/>|<\/svg>/g) || []).length;
    });
    check("every icon is balanced markup", unbalanced.length === 0, unbalanced.join(", "));
  }

  section("Static: lifted files say where they came from");
  {
    const LIFTED = {
      "js/update.js": "magic_sandbox/js/update.js", "js/info.js": "lastflame/js/info.js", "js/icons.js": "magic_sandbox/js/icons.js",
      "js/fx.js": "magic_sandbox/js/fx.js", "js/input.js": "magic_sandbox/js/input.js", "js/audio.js": "magic_sandbox/js/audio.js",
      "js/glyphart.js": "magic_sandbox/js/glyphart.js", "js/forge.js": "magic_sandbox/js/forge.js", "js/gfx.js": "magic_sandbox/js/gfx.js",
      "js/save.js": "magic_sandbox/js/save.js", "js/state.js": "magic_sandbox/js/state.js", "js/hud.js": "magic_sandbox/js/hud.js",
      "js/menus.js": "magic_sandbox/js/menus.js", "js/main.js": "magic_sandbox/js/main.js", "js/player.js": "magic_sandbox/js/player.js",
      "js/spellcore.js": "magic_sandbox/js/spellcore.js", "css/game.css": "magic_sandbox/css/game.css", "sw.js": "magic_sandbox/sw.js",
      "js/presets.js": "ChunkPresets.js", "js/world.js": "ChunkManager.js"
    };
    for (const [file, src] of Object.entries(LIFTED)) {
      const head = read(file).slice(0, 2400);
      check(file + " names " + src, head.includes(src.replace(/^.*\//, "")) || head.includes(src), "");
    }
  }

  /* ============================================================
     2. Behaviour: the world
     ============================================================ */
  const W = await load("js/world.js");
  const P = await load("js/presets.js");

  section("Behaviour: presets");
  {
    const all = Object.entries(P.CHUNK_PRESETS).map(([k, p]) => [k, p.grid]).concat(Object.entries(P.STRUCTURE_PARTS));
    const badShape = all.filter(([, g]) => g.length !== 8 || g.some((r) => r.split(" ").length !== 8)).map(([k]) => k);
    check("every preset grid is 8 × 8 (" + all.length + ")", badShape.length === 0, badShape.join(", "));
    const codes = new Set();
    for (const [, g] of all) for (const r of g) for (const c of r.split(" ")) codes.add(c);
    const unknown = [...codes].filter((c) => { const [o, f] = c.split(":"); return !(o === ".." || W.OBJECT_CODES[o]) || (f && !W.FLOOR_CODES[f]); });
    check("every cell code means something", unknown.length === 0, unknown.join(", "));
    const parts = Object.values(P.STRUCTURES).flatMap((s) => s.parts.map((p) => p.preset));
    check("every structure's parts exist", parts.every((p) => P.STRUCTURE_PARTS[p]), parts.filter((p) => !P.STRUCTURE_PARTS[p]).join(", "));
    check("every structure fits a structure cell", Object.values(P.STRUCTURES).every((s) => s.w <= W.STRUCT_CELL && s.h <= W.STRUCT_CELL));
    const paths = ["NS", "EW", "CROSS", "NE", "NW", "SE", "SW", "T_N", "T_S", "T_E", "T_W"];
    check("there is a road preset for every way a road can run", paths.every((t) => Object.values(P.CHUNK_PRESETS).some((p) => p.pathType === t)));
  }

  section("Behaviour: seeded and endless");
  {
    const a = W.createWorld("amber-vale-123"), b = W.createWorld("amber-vale-123"), c = W.createWorld("cold-fen-404");
    const sig = (w, cx, cz) => { const C = w.chunk(cx, cz); return C.biome + C.preset + C.road + C.objects.map((o) => o.kind + o.x.toFixed(2) + o.z.toFixed(2)).join() + C.pack.map((p) => p.kind).join(); };
    const coords = [[0, 0], [5, -3], [-40, 12], [123, 456], [-2000, 1999]];
    check("the same seed grows the same chunks", coords.every(([x, z]) => sig(a, x, z) === sig(b, x, z)));
    let differ = 0;
    for (let i = -20; i < 20; i++) if (sig(a, i, 7) !== sig(c, i, 7)) differ++;
    check("a different seed grows a different world (" + differ + " of 40 differ)", differ > 25);
    a.clearCache();
    check("a chunk rebuilt from scratch is the chunk it was", coords.every(([x, z]) => sig(a, x, z) === sig(b, x, z)));
    const far = a.chunk(-90000, 70000);
    check("a chunk a million metres out is a real chunk", far.objects.length >= 0 && W.BIOMES[far.biome] && isFinite(far.danger) && far.danger > 1000);
  }

  section("Behaviour: roads, waystones, structures, the start");
  {
    let asym = 0, structOnRoad = 0, wrongBiome = 0, hubsNoRoad = 0, hubs = 0, structs = new Map(), objsNearStart = 0, water = 0, packs = 0, chests = 0, wardens = 0;
    const biomes = {};
    for (const seed of ["amber-vale-123", "cold-fen-404", "x", ""]) {
      const w = W.createWorld(seed);
      for (let cx = -32; cx < 32; cx++) for (let cz = -32; cz < 32; cz++) {
        const d = w.roadDirs(cx, cz);
        if ((d & W.DIR.E) && !(w.roadDirs(cx + 1, cz) & W.DIR.W)) asym++;
        if ((d & W.DIR.S) && !(w.roadDirs(cx, cz + 1) & W.DIR.N)) asym++;
        const C = w.chunk(cx, cz);
        biomes[C.biome] = (biomes[C.biome] || 0) + 1;
        if (C.waystone) { hubs++; if (!C.road) hubsNoRoad++; }
        if (C.structure) {
          structs.set(seed + C.structure.id, C.structure);
          if (C.road) structOnRoad++;
        }
        for (const o of C.objects) if (Math.hypot(o.x, o.z) < W.SPAWN_CLEAR) objsNearStart++;
        water += C.water.reduce((s, v) => s + v, 0);
        packs += C.pack.length; if (C.chest) chests++;
      }
      const origin = w.chunk(0, 0);
      check("seed " + JSON.stringify(seed) + ": a waystone at the start, with roads all four ways", !!origin.waystone && origin.road === 15);
    }
    check("roads agree from both sides", asym === 0, asym + " one-sided steps");
    check("every waystone stands on a road (" + hubs + ")", hubsNoRoad === 0, hubsNoRoad + " without");
    check("no structure crosses a road (" + structs.size + " structures)", structOnRoad === 0);
    check("nothing stands within " + W.SPAWN_CLEAR + " m of the start", objsNearStart === 0, objsNearStart + " objects");
    const types = new Set([...structs.values()].map((s) => s.type));
    check("every kind of structure is placed somewhere (" + types.size + " of " + Object.keys(P.STRUCTURES).length + ")", types.size === Object.keys(P.STRUCTURES).length, [...types].join(", "));
    const greats = [...structs.values()].filter((s) => s.great);
    for (const [k, s] of structs) {
      if (!s.great) continue;
      const w = W.createWorld(k.slice(0, k.length - s.id.length));
      const cc = W.centreChunk(s);
      const C = w.chunk(cc.cx, cc.cz);
      if (C.warden && C.warden.id === s.id && C.centrepiece) wardens++;
    }
    check("every great structure has a Warden that exists", greats.length > 0 && greats.every((s) => ["verdant", "ashfall", "depths", "void"].includes(s.warden)));
    check("every great structure's centre chunk holds its Warden (" + wardens + ")", wardens === greats.length, wardens + " vs " + greats.length);
    check("lands that should have water do (" + water + " cells)", water > 0);
    check("there are creatures, and chests (" + packs + ", " + chests + ")", packs > 100 && chests > 0);
    const order = Object.entries(biomes).sort((x, y) => y[1] - x[1]).map((e) => e[0]);
    check("every biome appears (" + Object.keys(biomes).length + ")", Object.keys(biomes).length === W.BIOME_IDS.length, Object.keys(biomes).join(", "));
    check("Plains or Forest is the commonest land, as the rarities say", order[0] === "Plains" || order[0] === "Forest", order.slice(0, 3).join(", "));
    const w0 = W.createWorld("amber-vale-123");
    check("danger rises with distance", w0.dangerAt(0, 0) === 1 && w0.dangerAt(400, 0) > w0.dangerAt(100, 0));
  }

  section("Behaviour: chunks are cheap");
  {
    const w = W.createWorld("speed-test");
    const t0 = process.hrtime.bigint();
    let n = 0;
    for (let cx = 0; cx < 40; cx++) for (let cz = 0; cz < 40; cz++) { w.chunk(cx + 300, cz - 700); n++; }
    const ms = Number(process.hrtime.bigint() - t0) / 1e6 / n;
    check("a chunk builds in under 1.5 ms on average (" + ms.toFixed(3) + " ms)", ms < 1.5);
  }

  /* ============================================================
     3. Behaviour: the spells
     ============================================================ */
  const S = await load("js/spellcore.js");
  const glyph = (el) => ({ nodes: S.ELEMENTS[el].stamp.slice() });
  const page = (glyphs, seals, power) => ({ name: "", layers: [{ power: power || 1, glyphs: glyphs.map(glyph), seals: seals || [{ x: 0, y: 0, r: 40, runes: [] }] }] });

  section("Behaviour: elements and predators");
  {
    check("every stamp is the element it claims", S.ELEMENT_IDS.every((e) => S.elementForSides(S.ELEMENTS[e].stamp.length) === e));
    check("Water eats Fire beneath it", S.compileSpell(page(["fire", "water"])).elements.length === 0);
    check("Fire beneath Water survives the other way round", S.compileSpell(page(["water", "fire"])).elements.join() === "water,fire");
    check("Fire eats Earth, Earth eats Air, Air eats Water", ["fire:earth", "earth:air", "air:water"].every((p) => { const [pred, prey] = p.split(":"); return S.compileSpell(page([prey, pred])).elements.length === 0; }));
    check("the same element never eats itself", S.ELEMENT_IDS.every((e) => S.compileSpell(page([e, e])).elements.length === 2));
    const q = S.compileSpell(page(["fire", "water"]));
    check("an eaten pair is reported, not hidden", q.quenched.length === 2 && q.quenched[0].el === "fire" && q.quenched[1].el === "water");
    check("an eaten pair still costs its mana", q.cost.fire > 0 && q.cost.water > 0);
    const dropped = S.compileSpell(page(["fire", "water"]), { drop: new Set(["water"]) });
    check("a glyph you cannot pay for is left out before the stack is read", dropped.elements.join() === "fire" && dropped.cost.water === 0);
    check("nothing on the page at all throws the grey bolt", S.compileSpell(S.emptyDesign()).fallback);
  }

  section("Behaviour: the spectrum");
  {
    const seen = new Set();
    for (let p = 50; p <= 2000; p += 25) for (let r = S.SEAL_MIN_R; r <= S.SEAL_MAX_R; r += 4) seen.add(S.spectrumFor(p, r));
    check("every spectrum is reachable (" + seen.size + " of " + S.SPECTRUM_IDS.length + ")", S.SPECTRUM_IDS.every((k) => seen.has(k)), S.SPECTRUM_IDS.filter((k) => !seen.has(k)).join(", "));
    check("more power at the same size is never blunter", [30, 60, 120].every((r) => {
      const order = ["CANNON", "BOULDER", "BURST", "WAVE", "DART", "BEAM", "LANCE", "NEEDLE"];
      let last = -1;
      for (let p = 75; p <= 1200; p += 25) { const k = S.spectrumFor(p, r); const i = order.indexOf(k); if (i < 0) continue; if (i < last) return false; last = i; }
      return true;
    }));
    const st = S.starterSpells().slice(0, 4).map((d) => S.compileSpell(d).layers[0].shots[0].spectrum);
    check("the four starters are four different spectra (" + st.join(", ") + ")", new Set(st).size === 4);
    const chain = S.compileSpell(S.PRESETS.find((p) => p.name === "Cannon to Needles"));
    check("a Cannon can burst into Needles", chain.layers[0].shots[0].spectrum === "CANNON" && chain.layers[1].shots[0].spectrum === "NEEDLE", chain.layers.map((L) => L.shots[0].spectrum).join(" > "));
    check("a payload multiplies the shots", chain.totalShots === 1 + 5);
  }

  section("Behaviour: tiers, cost and examples");
  {
    const small = S.compileSpell(page(["fire"])), big = S.compileSpell(page(["fire"], [{ x: 0, y: 0, r: 200, runes: [] }], 4));
    check("a bigger page is a higher tier, slower and dearer", big.tierIndex > small.tierIndex && big.cooldown > small.cooldown && big.cost.fire > small.cost.fire);
    check("no page casts faster than the minimum cooldown", S.compileSpell(page([])).cooldown >= S.MIN_COOLDOWN);
    const all = S.starterSpells().concat(S.PRESETS);
    check("every starter and example compiles to finite numbers", all.every((d) => { const c = S.compileSpell(d); return isFinite(c.cooldown) && isFinite(c.volley) && c.layers.every((L) => L.shots.every((s) => isFinite(s.dmg) && isFinite(s.speed))); }));
    check("the starters fit circle rank 1", S.starterSpells().every((d) => S.rankNeeded(d) === 1));
    check("every example fits some rank", S.PRESETS.every((d) => isFinite(S.rankNeeded(d))));
    check("there are eight scrolls", S.starterSpells().length === S.SLOTS && S.SLOTS === 8);
  }

  section("Behaviour: what comes back from storage");
  {
    const junk = S.normalizeDesign({ name: "<b>x</b>\u0007", layers: [{ power: 99, glyphs: [{ nodes: [0, 0, 1] }, { nodes: [0, 3, 6, 9] }, { nodes: [0, 1] }, "x"], seals: [{ x: 9e9, y: 0, r: 2, runes: [] }, { x: 0, y: 0, r: 40, runes: [NaN, 1] }] }, { power: 7, glyphs: [], seals: [] }] });
    check("a glyph with repeated, too few or junk nodes is dropped", junk.layers[0].glyphs.length === 1);
    check("a seal too small is raised to the smallest, a far one pulled back onto the page", junk.layers[0].seals[0].r === S.SEAL_MIN_R && junk.layers[0].seals[0].x === S.PAGE_R);
    check("a rune that is not a number is dropped", junk.layers[0].seals[1].runes.length === 1);
    check("power is clamped, and only the first layer carries it", junk.layers[0].power === S.HARD.power && junk.layers[1].power === 1);
    check("a name loses its markup and control characters", !/[<>\u0007]/.test(junk.name));
    check("nonsense is an empty page, not an error", S.isEmptyDesign(S.normalizeDesign("nonsense")) && S.isEmptyDesign(S.normalizeDesign(null)));
    const over = S.overLimits(page(["fire", "fire", "fire", "fire"], null, 5), 1);
    check("rank 1 refuses four glyphs and power ×5", over.length >= 2, over.join("; "));
  }

  process.stdout.write("\n" + (checks - failures.length) + " of " + checks + " checks passed\n");
  if (failures.length) { process.stdout.write("\nFailed:\n  " + failures.join("\n  ") + "\n"); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
