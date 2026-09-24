#!/usr/bin/env node
/* ============================================================
   Magic Sandbox — validation harness
   `node tools/validate.js`

   Same shape as routecast/tools/validate.js and komyut/tools/validate.js.
   Two halves, both of which have to pass before anything ships:

   1. **Static checks** over the source as text: no emoji (every glyph is an
      inline SVG from js/icons.js), every module parses, the page and the
      service worker agree on the version, the worker never takes over by
      itself, every file the game loads is in the worker's shell, every id
      the JavaScript reaches for exists in index.html, every (i) names a
      topic that exists, every icon named anywhere is drawn, and every model
      in assets/ is actually used.

   2. **Behaviour checks** over the pure modules — spellcore.js, boons.js,
      themes.js — imported straight into Node: what the starter pages
      compile to, that every stamp is the element it claims and perfectly
      balanced, that junk from localStorage is refused rather than "fixed",
      that rank limits bite where they should, that every example page
      compiles, and that the tower is ten floors with a heart on top.

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
  failures.push(name + (detail ? " \u2014 " + detail : ""));
  process.stdout.write("  \u2717 " + name + (detail ? " \u2014 " + detail : "") + "\n");
}
function check(name, cond, detail) { cond ? ok(name) : fail(name, detail); }
function section(title) { process.stdout.write("\n" + title + "\n"); }
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

function sourceFiles() {
  const out = [];
  (function walk(dir) {
    for (const name of fs.readdirSync(path.join(ROOT, dir))) {
      const rel = path.join(dir, name);
      if (rel.startsWith("vendor") || rel.startsWith("tools") || name.startsWith(".")) continue;
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
    // Pictographs specifically, not "non-ASCII": the copy uses em dashes,
    // middle dots and the multiplication sign on purpose.
    const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{2B00}-\u{2BFF}]/u;
    const bad = [];
    for (const rel of sourceFiles()) {
      read(rel).split("\n").forEach((line, i) => { const m = line.match(EMOJI); if (m) bad.push(rel + ":" + (i + 1) + " " + JSON.stringify(m[0])); });
    }
    check("no emoji or pictographic characters in source", bad.length === 0, bad.slice(0, 8).join(", "));
  }

  section("Static: every module parses");
  for (const rel of jsFiles.concat(["sw.js", "tools/validate.js", "tools/smoke.js"].filter(exists))) {
    try {
      const args = rel.startsWith("js/") ? ["--experimental-default-type=module", "--check", path.join(ROOT, rel)] : ["--check", path.join(ROOT, rel)];
      execFileSync(process.execPath, args, { stdio: "pipe" });
      ok(rel);
    } catch (e) { fail(rel, String(e.stderr || e.message).split("\n").slice(0, 4).join(" ")); }
  }

  section("Static: one version number");
  {
    const pageV = (html.match(/window\.MS_VERSION\s*=\s*"([^"]+)"/) || [])[1];
    const cache = (sw.match(/var CACHE\s*=\s*"msandbox-v([^"]+)"/) || [])[1];
    check("index.html declares window.MS_VERSION", !!pageV, pageV);
    check("sw.js names its cache msandbox-v<version>", !!cache, cache);
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
  }

  section("Static: the shell has everything the game loads");
  {
    const shell = [...sw.matchAll(/"\.\/([^"]*)"/g)].map((m) => m[1]).filter(Boolean);
    const missing = shell.filter((f) => !exists(f));
    check("every SHELL entry exists on disk", missing.length === 0, missing.join(", "));
    // walk the import graph from main.js, vendor included
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
    check("the stylesheet is in SHELL", shell.includes("css/game.css"));
    const mani = JSON.parse(read("manifest.webmanifest"));
    const icons = (mani.icons || []).map((i) => "assets/" + i.src.replace(/^assets\//, ""));
    check("manifest icons exist", icons.every(exists), icons.filter((f) => !exists(f)).join(", "));
  }

  section("Static: assets");
  {
    const m = JSON.parse(read("assets/manifest.json"));
    const files = Object.values(m.models).map((e) => "assets/" + e.file).concat(Object.values(m.textures).map((e) => "assets/" + e.file));
    check("every asset in the manifest exists", files.every(exists), files.filter((f) => !exists(f)).join(", "));
    const onDisk = fs.readdirSync(path.join(ROOT, "assets/models")).map((f) => "assets/models/" + f);
    const unused = onDisk.filter((f) => !files.includes(f));
    check("no model ships without being loaded", unused.length === 0, unused.join(", "));
    const code = allJs;
    const unreferenced = Object.keys(m.models).filter((k) => !code.includes('"' + k + '"'));
    check("every loaded model is used by name somewhere", unreferenced.length === 0, unreferenced.join(", "));
  }

  section("Static: ids, info topics and icons");
  {
    const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    const wanted = new Set();
    for (const src of jsFiles.map(read)) {
      for (const m of src.matchAll(/(?:\$|getElementById|el)\(\s*"([A-Za-z][\w-]*)"\s*\)/g)) wanted.add(m[1]);
      for (const m of src.matchAll(/set\(\s*"([A-Za-z][\w-]*)"\s*,/g)) wanted.add(m[1]);
    }
    const dynamicPrefixes = ["scr-", "set_"];
    const missing = [...wanted].filter((id) => !ids.has(id) && !dynamicPrefixes.some((p) => id.startsWith(p)));
    check("every id the scripts reach for is in index.html (" + wanted.size + ")", missing.length === 0, missing.join(", "));
    for (const s of ["title", "pause", "settings", "boons", "death", "victory", "grimoire"]) if (!ids.has("scr-" + s)) fail("screen scr-" + s + " exists");
    for (const k of ["master", "music", "sfx", "shake", "numbers", "flashes", "autoAim"]) if (!ids.has("set_" + k)) fail("setting set_" + k + " exists");

    const info = await import(pathToFileURL(path.join(ROOT, "js/info.js")).href).catch((e) => { fail("info.js imports in Node", e.message); return null; });
    if (info) {
      const topics = new Set(info.keys());
      const used = new Set([...(html + allJs).matchAll(/data-info="([\w-]+)"/g)].map((m) => m[1]));
      const bad = [...used].filter((k) => !topics.has(k));
      check("every data-info names a topic (" + used.size + " used)", bad.length === 0, bad.join(", "));
    }
    const icons = await import(pathToFileURL(path.join(ROOT, "js/icons.js")).href);
    const names = new Set(Object.keys(icons.ICONS));
    const usedIcons = new Set([...html.matchAll(/data-icon="(\w+)"/g)].map((m) => m[1]));
    for (const m of allJs.matchAll(/icon\(\s*"(\w+)"/g)) usedIcons.add(m[1]);
    const badIcons = [...usedIcons].filter((n) => !names.has(n));
    check("every icon named in the page or scripts exists (" + usedIcons.size + ")", badIcons.length === 0, badIcons.join(", "));
    // well-formedness: each icon renders as balanced markup
    const unbalanced = [...names].filter((n) => {
      const svg = icons.icon(n);
      const opens = (svg.match(/<(svg|path|circle)\b/g) || []).length;
      const closes = (svg.match(/\/>|<\/svg>/g) || []).length;
      return opens !== closes;
    });
    check("every icon is balanced markup", unbalanced.length === 0, unbalanced.join(", "));
    const { BOONS } = await import(pathToFileURL(path.join(ROOT, "js/boons.js")).href);
    const noIcon = BOONS.filter((b) => !names.has(b.icon)).map((b) => b.id);
    check("every boon has an icon", noIcon.length === 0, noIcon.join(", "));
    const { ELEMENT_IDS, FORM_IDS, REACTION_IDS } = await import(pathToFileURL(path.join(ROOT, "js/spellcore.js")).href);
    const grim = ELEMENT_IDS.concat(["arcane"], FORM_IDS, REACTION_IDS).filter((n) => !names.has(n));
    check("every element, form and reaction has an icon", grim.length === 0, grim.join(", "));
  }

  /* ============================================================
     2. Behaviour checks
     ============================================================ */
  const S = await import(pathToFileURL(path.join(ROOT, "js/spellcore.js")).href);
  const B = await import(pathToFileURL(path.join(ROOT, "js/boons.js")).href);
  const T = await import(pathToFileURL(path.join(ROOT, "js/themes.js")).href);

  section("Behaviour: the grammar");
  check("3 sides is Air, 4 Fire, 5 Earth, 6 Water", S.elementForSides(3) === "air" && S.elementForSides(4) === "fire" && S.elementForSides(5) === "earth" && S.elementForSides(6) === "water");
  check("2 and 7 sides are not glyphs", S.elementForSides(2) === null && S.elementForSides(7) === null);
  for (const id of S.ELEMENT_IDS) {
    const d = { name: "", layers: [{ power: 1, glyphs: [{ nodes: S.ELEMENTS[id].stamp }], seals: [] }] };
    const c = S.compileSpell(d);
    check("the " + id + " stamp is " + id + " and perfectly balanced", c.elements[0] === id && S.balanceOf(d) === 1, c.elements + " " + S.balanceOf(d));
  }
  check("seal sizes read as Needle < Bolt < Orb < Nova", S.formForRadius(30) === "needle" && S.formForRadius(60) === "bolt" && S.formForRadius(100) === "orb" && S.formForRadius(160) === "nova");
  {
    const lop = { name: "", layers: [{ power: 1, glyphs: [{ nodes: [1, 4, 7, 10] }], seals: [{ x: 90, y: 0, r: 40, runes: [] }] }] };
    const c = S.compileSpell(lop);
    check("a lopsided page scatters and hits softer", c.balance < 0.6 && c.spread > 0.1 && c.hitDmg < S.compileSpell(S.starterSpells()[0]).hitDmg * 1.1, "balance " + c.balance.toFixed(2));
  }
  {
    const fan = S.starterSpells()[1];
    const c = S.compileSpell(fan);
    check("each rune is one shot: three runes, three shots", c.totalShots === 3 && c.layers[0].shots[0].dirs.length === 3);
    const top = c.layers[0].shots[0].dirs.find((a) => Math.abs(a) < 1e-9);
    check("a rune at the top of the page fires straight ahead", top !== undefined);
    const nova = S.compileSpell({ name: "", layers: [{ power: 1, glyphs: [], seals: [{ x: 0, y: 0, r: 160, runes: [0, 1, 2] }] }] });
    check("runes on a Nova are ignored", nova.totalShots === 1);
  }
  {
    const steam = S.compileSpell(S.PRESETS.find((p) => p.name === "Steam Lance"));
    check("fire + water reacts as Steam", steam.reactions.includes("steam"));
    const all = S.compileSpell({ name: "", layers: [{ power: 1, glyphs: S.ELEMENT_IDS.map((e) => ({ nodes: S.ELEMENTS[e].stamp })), seals: [] }] });
    check("four elements make all six reactions", all.reactions.length === 6, all.reactions.join(","));
  }
  {
    const payload = S.compileSpell(S.PRESETS.find((p) => p.name === "Cluster Bomb"));
    check("a second layer multiplies: 1 orb carrying 5 needles is 6 shots", payload.totalShots === 6, String(payload.totalShots));
    const inherit = S.compileSpell(S.PRESETS.find((p) => p.name === "Mire Mine"));
    check("a payload page with no glyphs inherits its parent's elements", inherit.layers[1].inherits && inherit.layers[1].elements.includes("water"));
  }
  {
    const starters = S.starterSpells().map((d) => S.compileSpell(d));
    check("the four starters cover all four elements", new Set(starters.flatMap((c) => c.elements)).size === 4);
    check("the four starters cover all four forms", new Set(starters.flatMap((c) => c.forms)).size === 4);
    check("every starter is castable at rank 1", S.starterSpells().every((d) => S.overLimits(d, 1).length === 0));
    check("every starter costs 5-15 mana", starters.every((c) => c.cost >= 5 && c.cost <= 15), starters.map((c) => c.cost).join(","));
    check("costs and cooldowns are positive and bounded", starters.every((c) => c.cooldown >= 0.2 && c.cooldown <= 3));
  }
  {
    const big = { name: "", layers: [{ power: 5, glyphs: [{ nodes: [0, 4, 8] }, { nodes: [0, 3, 6, 9] }, { nodes: [0, 2, 4, 6, 8, 10] }], seals: [{ x: 0, y: 0, r: 30, runes: [0, 1, 2, 3, 4] }] }] };
    const over = S.overLimits(big, 1);
    check("rank 1 refuses three glyphs, power 5 and five runes", over.length >= 3, over.join("; "));
    check("rank 5 accepts it", S.overLimits(big, 5).length === 0, S.overLimits(big, 5).join("; "));
    check("rankNeeded finds the lowest rank that holds a page", S.rankNeeded(big) === 4, String(S.rankNeeded(big)));
    check("every example page compiles and fits some rank", S.PRESETS.every((p) => S.rankNeeded(p) <= S.MAX_RANK && S.compileSpell(p).totalShots > 0));
  }

  section("Behaviour: storage is not trusted");
  {
    const junk = S.normalizeDesign({ name: "x".repeat(100) + "\u0007", layers: [{ power: 99, glyphs: [{ nodes: [0, 1, 2, 3, 4, 5, 6] }, { nodes: [0, 0, 1] }, { nodes: [0, 4, 8] }, "nope"], seals: [{ x: 1e9, y: 0, r: NaN }, { x: 10, y: 10, r: 50, runes: [0, "a", Infinity] }] }, null, {}, {}, {}] });
    check("names are clipped and cleaned", junk.name.length <= S.MAX_NAME && !/[\u0000-\u001f]/.test(junk.name));
    check("a seven-sided and a repeating glyph are dropped, not repaired", junk.layers[0].glyphs.length === 1);
    check("a seal with no radius is dropped", junk.layers[0].seals.length === 1);
    check("non-numeric runes are dropped", junk.layers[0].seals[0].runes.length === 1);
    check("power is clamped", junk.layers[0].power === S.HARD.power);
    check("at most three layers survive", junk.layers.length === S.HARD.layers);
    check("garbage in gives an empty page out", S.isEmptyDesign(S.normalizeDesign("garbage")));
  }

  section("Behaviour: boons");
  {
    const picks = B.rollBoons({}, 3);
    check("three different boons are offered", picks.length === 3 && new Set(picks.map((b) => b.id)).size === 3);
    const maxed = Object.fromEntries(B.BOONS.map((b) => [b.id, b.max]));
    check("a maxed boon is never offered", B.rollBoons(maxed, 3).length === 0);
    const statsRead = B.BOONS.filter((b) => !new RegExp("mods\\." + b.stat + "\\b").test(allJs) && !new RegExp("m\\." + b.stat + "\\b").test(read("js/player.js")));
    check("every boon's stat is read by the game", statsRead.length === 0, statsRead.map((b) => b.id + ":" + b.stat).join(", "));
  }

  section("Behaviour: the tower");
  {
    const kinds = [];
    for (let f = 1; f <= 12; f++) kinds.push(T.floorKind(f));
    check("odd floors are Anchors, even floors Wardens, ten is the Heart", kinds[0] === "anchors" && kinds[1] === "warden" && kinds[9] === "heart" && kinds[10] === "anchors");
    check("each land lasts two floors", T.themeForFloor(1).id === T.themeForFloor(2).id && T.themeForFloor(3).id !== T.themeForFloor(2).id);
    check("floor ten is Stormspire", T.themeForFloor(10).id === "storm");
    check("enemies grow tougher, gently", T.floorScale(1).hp === 1 && T.floorScale(10).hp < 4 && T.floorScale(10).dmg < 2);
    const lim = S.RANKS.slice(1);
    check("each rank holds at least as much as the last", lim.every((r, i) => i === 0 || Object.keys(r).every((k) => r[k] >= lim[i - 1][k])));
  }

  process.stdout.write("\n" + checks + " checks, " + failures.length + " failed\n");
  if (failures.length) { process.stdout.write(failures.map((f) => "  - " + f).join("\n") + "\n"); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
