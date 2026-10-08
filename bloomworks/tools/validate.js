#!/usr/bin/env node
/* ============================================================
   Bloomworks — validation harness
   `node tools/validate.js`

   Same shape as aeons/tools/validate.js. Two halves, both of which have to
   pass before anything ships:

   1. Static checks over the source as text: no emoji, every module parses,
      the page and the service worker carry one version, the worker never
      takes over by itself, every file the game loads is in the worker's
      shell, every id the scripts reach for exists, every (i) names a topic,
      every icon named anywhere is drawn, the data tables are complete, and
      the lifted files still say where they came from.

   2. Behaviour checks over the game, imported straight into Node (the
      simulation never touches the DOM or WebGL): numbers past 10^308, the
      design's formulas, a factory that sells without losing a mote, fusion,
      stamps, Lucky, Chains, the three resets, Directives, Blueprints,
      offline progress and a save that comes back as it went. It ends by
      letting a simple greedy player run Season 1 and printing how far it got.

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
const near = (a, b, eps) => Math.abs(a - b) <= (eps || 1e-6) * Math.max(1, Math.abs(b));

// localStorage for save.js, in Node
const store = new Map();
global.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
global.btoa = (s) => Buffer.from(s, "binary").toString("base64");
global.atob = (s) => Buffer.from(s, "base64").toString("binary");

(async function main() {
  section("Static: no emoji");
  {
    const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{2B00}-\u{2BFF}]/u;
    const bad = [];
    for (const rel of jsFiles.concat(["index.html", "css/bloomworks.css", "sw.js", "manifest.webmanifest", "tools/validate.js", "tools/e2e.js", "README.md"].filter(exists)))
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
    const pageV = (html.match(/window\.BW_VERSION\s*=\s*"([^"]+)"/) || [])[1];
    const cache = (sw.match(/var CACHE\s*=\s*"bloomworks-v([^"]+)"/) || [])[1];
    check("index.html declares window.BW_VERSION", !!pageV, pageV);
    check("sw.js names its cache bloomworks-v<version>", !!cache, cache);
    check("the two agree", pageV === cache, pageV + " vs " + cache);
    const install = sw.slice(sw.indexOf('addEventListener("install"'), sw.indexOf('addEventListener("message"'));
    check("no skipWaiting() inside install", !/skipWaiting\(\)/.test(install.replace(/\/\*[\s\S]*?\*\//g, "")));
    check('the worker answers "skip-waiting"', /e\.data === "skip-waiting"\) self\.skipWaiting\(\)/.test(sw));
    const up = read("js/update.js");
    check("the page watches updatefound, controllerchange and checks periodically", /updatefound/.test(up) && /controllerchange/.test(up) && /CHECK_MS/.test(up) && /visibilitychange/.test(up) && /"online"/.test(up));
    check("there is an update bar and a manual check", html.includes('id="update-bar"') && /checkNow\(\)/.test(read("js/ui.js")));
  }

  section("Static: the shell");
  {
    const shell = [...sw.matchAll(/"\.\/([^"]*)"/g)].map((m) => m[1]).filter(Boolean);
    const missing = shell.filter((f) => !exists(f));
    check("every file in the shell exists", !missing.length, missing.join(", "));
    const vendor = [];
    (function walk(d) { for (const f of fs.readdirSync(path.join(ROOT, d))) { const r = d + "/" + f; if (fs.statSync(path.join(ROOT, r)).isDirectory()) walk(r); else if (f.endsWith(".js")) vendor.push(r); } })("vendor");
    const loaded = jsFiles.concat(vendor, ["css/bloomworks.css", "manifest.webmanifest", "index.html"]);
    const absent = loaded.filter((f) => !shell.includes(f));
    check("every module, vendored file, the stylesheet and the manifest are in the shell", !absent.length, absent.join(", "));
    const mf = JSON.parse(read("manifest.webmanifest"));
    check("every manifest icon exists and is cached", mf.icons.every((i) => exists(i.src) && shell.includes(i.src)));
    const bad = [];
    for (const rel of jsFiles) for (const m of read(rel).matchAll(/from "(\.\.?\/[^"]+)"/g)) if (!exists(path.join(path.dirname(rel), m[1]))) bad.push(rel + " -> " + m[1]);
    check("every import resolves", !bad.length, bad.join(", "));
    check("three is mapped to the vendored build", /"three":"\.\/vendor\/build\/three\.module\.min\.js"/.test(html));
    check("the vendored three.js carries its licence", exists("vendor/LICENSE-three.txt"));
  }

  section("Static: ids, topics, icons");
  {
    const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
    const wanted = new Set();
    for (const rel of jsFiles) {
      const src = read(rel);
      for (const m of src.matchAll(/getElementById\("([^"]+)"\)/g)) wanted.add(m[1]);
      if (rel === "js/ui.js") for (const m of src.matchAll(/\$\("([^"]+)"\)/g)) wanted.add(m[1]);
    }
    const made = new Set(["updState", "bpImport", "saveCode"]);
    const lost = [...wanted].filter((id) => !ids.has(id) && !made.has(id));
    check("every id the scripts reach for is in index.html", !lost.length, lost.join(", "));
    const { TOPICS } = await imp("js/topics.js");
    const used = new Set();
    for (const src of jsFiles.map(read).concat(html)) for (const m of src.matchAll(/data-info=\\?"([a-z]+)\\?"/g)) used.add(m[1]);
    for (const m of read("js/ui.js").matchAll(/ii\("([a-z]+)"\)/g)) used.add(m[1]);
    for (const m of read("js/ui.js").matchAll(/\["(about)", "(howto)", "(active)", "(offline)", "(privacy)"\]/g)) for (const k of m.slice(1)) used.add(k);
    const noTopic = [...used].filter((k) => !TOPICS[k]);
    check("every (i) names a topic (" + used.size + ")", !noTopic.length, noTopic.join(", "));
    const { ICONS } = await imp("js/icons.js");
    const names = new Set();
    for (const m of html.matchAll(/data-icon="([a-z0-9]+)"/g)) names.add(m[1]);
    for (const src of jsFiles.map(read)) for (const m of src.matchAll(/icon\("([a-z0-9]+)"/g)) names.add(m[1]);
    for (const src of jsFiles.map(read)) for (const m of src.matchAll(/(?:say|notify|toast)\([^;]*?,\s*"[a-z]+",\s*"([a-z0-9]+)"\)/g)) names.add(m[1]);
    const noIcon = [...names].filter((n) => !ICONS[n]);
    check("every icon named anywhere is drawn (" + names.size + ")", !noIcon.length, noIcon.join(", "));
  }

  section("Static: the tables are complete");
  const D = await imp("js/data.js");
  {
    check("24 contraption types in 7 families, plus 8 Wonders", D.CORE_TYPES.length === 24 && new Set(D.CORE_TYPES.map((k) => D.TYPES[k].fam)).size === 7 && D.WONDERS.length === 8, D.CORE_TYPES.length + " / " + D.WONDERS.length);
    const noCost = D.CORE_TYPES.filter((k) => D.TYPES[k].build == null || !D.TYPES[k].unlock);
    check("every type has an unlock and a BuildBase", !noCost.length, noCost.join(", "));
    check("every biome has weather and four critters, one rare", D.BIOME_KEYS.every((b) => D.BIOMES[b].weather.length && Object.values(D.CRITTERS).filter((c) => c.biome === b).length === 4 && Object.values(D.CRITTERS).filter((c) => c.biome === b && c.rare).length === 1));
    check("every rare critter's weather exists", Object.values(D.CRITTERS).every((c) => !c.rare || D.WEATHER[c.rare]));
    check("every World Law leaves a Planet Trait", D.LAW_KEYS.length === 10 && D.LAW_KEYS.every((k) => D.LAWS[k].trait));
    check("9 named Constellations, 6 Trials, 7 Heart Stages, 8 Cosmos nodes", D.CONSTELLATIONS.length === 9 && Object.keys(D.TRIALS).length === 6 && D.HEART_STAGES.length === 7 && D.COSMOS_TREE.length === 8);
    check("8 Workshop upgrades, 8 Mods, 10 Relics, 5 Windfalls summing to 1", Object.keys(D.WORKSHOP).length === 8 && D.MOD_KEYS.length === 8 && D.RELIC_KEYS.length === 10 && near(D.WINDFALLS.reduce((n, w) => n + w.p, 0), 1));
    check("every Specialization is a pair", Object.values(D.SPECS).every((s) => s.length === 2));
    const M = await imp("js/models.js").catch((e) => ({ err: e }));
    check("every buildable type has a model case", (() => { const src = read("js/models.js"); return D.TYPE_KEYS.filter((k) => k !== "track").every((k) => src.includes('"' + k + '"')); })());
    void M;
  }

  section("Static: lifted files say where they came from");
  check("rng.js names Aeons' rng.js", /aeons\/js\/rng\.js/.test(read("js/rng.js")));
  check("update.js names Aeons' update.js", /aeons\/js\/update\.js/.test(read("js/update.js")));
  check("info.js names Aeons' info.js", /aeons\/js\/info\.js/.test(read("js/info.js")));
  check("sw.js names Aeons' sw.js", /aeons\/sw\.js/.test(sw));
  check("icons.js names Aeons' icons.js", /aeons\/js\/icons\.js/.test(read("js/icons.js")));
  {
    const a = read("../aeons/js/rng.js"), b = read("js/rng.js");
    const tail = (s) => s.slice(s.indexOf("/** mulberry32"));
    check("rng.js is Aeons' line for line past its header", tail(a) === tail(b));
    const three = (rel) => fs.readFileSync(path.join(ROOT, rel));
    check("vendor three.js is the same build Hacks carries", three("vendor/build/three.module.min.js").equals(fs.readFileSync(path.join(ROOT, "../hacks/vendor/build/three.module.min.js"))));
  }

  /* ---------------- behaviour ---------------- */
  const num = await imp("js/num.js");
  const st = await imp("js/state.js");
  const W = await imp("js/world.js");
  const E = await imp("js/econ.js");
  const B = await imp("js/build.js");
  const sim = await imp("js/sim.js");
  const game = await imp("js/game.js");
  const goals = await imp("js/goals.js");
  const pr = await imp("js/prestige.js");
  const auto = await imp("js/auto.js");
  const save = await imp("js/save.js");
  const off = await imp("js/offline.js");
  const { S, RT } = st;
  game.onNotify(() => {});

  section("Behaviour: numbers with no ceiling");
  {
    check("lAdd adds", near(num.N(num.lAdd(num.L(2), num.L(3))), 5));
    check("lSub subtracts", near(num.N(num.lSub(num.L(5), num.L(3))), 2));
    check("past 10^308 is fine", near(num.lAdd(400, 400), 400 + Math.log10(2)));
    check("short names: 1.5K, 2M, 1Dc, 1aa, 1ab", num.fmtL(num.L(1500)) === "1.5K" && num.fmtL(num.L(2e6)) === "2M" && num.fmtL(33) === "1Dc" && num.fmtL(36) === "1aa" && num.fmtL(39) === "1ab", [num.fmtL(33), num.fmtL(36), num.fmtL(39)].join(" "));
    check("after zz comes aaa", num.suffix(12 + 676) === "aaa", num.suffix(12 + 676));
    num.setNotation("sci"); const sci = num.fmtL(45 + Math.log10(1.23)); num.setNotation("short");
    check("scientific notation", sci === "1.23e45", sci);
  }

  section("Behaviour: the design's formulas");
  st.newGame(424242);
  {
    check("the first Ring 1 plot costs 900 Glow", near(num.N(W.plotCostL(1, 0, 0)), 900));
    check("the first Ring 3 plot costs 57,600 Glow", near(num.N(W.plotCostL(3, 0, 0)), 57600));
    check("Richness 1.6^r and Node Tier 1 + floor(r/3)", (() => { for (let x = 9; x < 30; x++) { const p = W.getPlot(x, 0); if (p.nodes.length) return near(p.nodes[0].rich, Math.pow(1.6, p.ring)) && p.nodes[0].tier === 1 + Math.floor(p.ring / 3); } return false; })());
    check("the world is the same for the same seed", JSON.stringify(W.genPlot(7, 3, -2, 10)) === JSON.stringify(W.genPlot(7, 3, -2, 10)));
    check("Meadow at home, Anomalies only from Ring 16", W.getPlot(0, 0).biome === "meadow" && [...Array(31).keys()].every((i) => W.getPlot(i - 15, 15).biome !== "anomaly"));
    check("Combo ×1.5 at 100, ×2 at 300, ×3 at 1,500", near(E.comboMul(100), 1.5) && near(E.comboMul(300), 2) && near(E.comboMul(1500), 3));
    check("SeedsEarned at 10^6 Glow is 10", near(num.N(E.seedsFormulaL(6)), 10));
    check("StarsEarned at 10^6 Seeds is 3", near(num.N(E.starsFormulaL(6)), 3));
    check("LevelCost grows ×1.15 for Sources and ×1.20 otherwise", near(num.N(E.levelCostL("wellspring", 1)), 30) && near(num.N(E.levelCostL("polisher", 2)), 45 * 2.2));
    check("the first Wellspring and Hearth are free; Track always 5", E.buildCostL("wellspring") === num.ZERO && E.buildCostL("hearth") === num.ZERO && near(num.N(E.buildCostL("track")), 5));
    check("Prismatic Hue Bonus ×3, secondary ×1.5", near(E.hueBonus(7), 3) && near(E.hueBonus(3), 1.5));
  }

  // A tiny factory in the Home Plot, on clear ground.
  function clearRow(y, x0, x1) { for (let x = x0; x <= x1; x++) for (const yy of [y - 1, y, y + 1]) if (W.tileAt(x, yy) === W.T.rock) { S.season.glow = 30; B.clearRock(x, yy); } }
  function fresh(seed) { st.newGame(seed); for (const k of D.CORE_TYPES) S.meta.discovered.types[k] = 1; S.season.glow = 30; clearRow(5, 0, 9); for (let y = 0; y < 10; y++) clearRow(y, 0, 9); }
  const run = (secs) => { for (let i = 0; i < secs * 30; i++) game.tick(sim.STEP); };
  const countMotes = () => {
    let n = 0;
    for (const c of S.season.copies) { n += (c.m || []).length + (c.inq || []).length + (c.outq || []).length; if (c.bins) for (const t in c.bins) n += c.bins[t].length; }
    return n + RT.flying.length + RT.floating.length + S.season.strays.length;
  };

  section("Behaviour: the mote loop");
  {
    fresh(1001);
    const ws = B.place("wellspring", 1, 5, 0);
    for (let x = 2; x <= 5; x++) B.place("track", x, 5, 0);
    const h = B.place("hearth", 6, 4, 0);
    check("a Wellspring, four Tracks and a Hearth go down", ws && h && S.season.copies.length === 6, B.whyNot("hearth", 6, 4));
    let emitted = 0;
    sim.on("sale", () => {});
    const before = S.meta.stats.sold;
    run(120);
    const sold = S.meta.stats.sold - before;
    check("the Hearth sells motes for Glow", sold > 40 && S.season.glowSeason > 1.5, sold + " sold, " + num.fmtL(S.season.glowSeason));
    check("the Glow rate is measured", RT.rate.perSec > -1, num.fmtL(RT.rate.perSec));
    S.season.glow = 30; const tap = sim.tap(ws);
    check("tapping a Wellspring emits a mote", tap === "emit");
    // No mote is ever lost: block the Hearth and everything waits.
    h.off = true; run(30);
    const held = countMotes();
    run(30);
    check("a blocked line waits and loses nothing", countMotes() >= held && held > 0, held + " vs " + countMotes());
    h.off = false; void emitted;
  }
  {
    fresh(1002);
    S.season.levels.fuser = 50;
    const f = B.place("fuser", 4, 4, 0, { free: true });
    for (let i = 0; i < 4; i++) sim.offer(4, 4, sim.mote(Math.log10(10), 1, i < 2 ? 1 : 2), 0, null);
    sim.act(f, 0);
    const out = f.outq[0];
    check("a Fuser makes one Tier 2 from four Tier 1", out && out.t === 2, out && out.t);
    check("FusedValue = sum × 1.35 (Fusion, 2 Milestones) × 1.5 (Purple)", out && near(num.N(out.v), 40 * (1.25 + 0.1) * 1.5) && out.h === 3, out && num.N(out.v));
    const k = B.place("kiln", 0, 7, 0, { free: true });
    const m = sim.mote(0, 1, 0);
    sim.offer(0, 7, m, 0, null); sim.act(k, 0);
    const once = k.outq.shift();
    sim.offer(0, 7, once, 0, null);
    check("a Kiln stamps once; a stamped mote passes straight through", (once.s & 2) && k.outq[0] === once && k.inq.length === 0);
  }
  {
    fresh(1003);
    S.season.workshop.lens = 2000;    // far past 100% Lucky chance
    const p = B.place("polisher", 3, 5, 0, { free: true });
    const m = sim.mote(0, 1, 0); sim.offer(3, 5, m, 0, null); sim.act(p, 0);
    check("a Lucky hit is ×10 Value per level", m.L >= 1 && near(m.v, Math.log10(1.5 * Math.pow(1.1, 0)) + m.L, 1e-6), m.L + " " + m.v);
    S.season.workshop.lens = 0;
  }
  {
    fresh(1004);
    S.season.glow = 40;
    const c1 = B.place("chime", 3, 3, 0), c2 = B.place("chime", 5, 3, 0);
    const w = B.place("wellspring", 4, 2, 1);
    let chain = null; sim.on("chain", (c) => { chain = c; });
    c1.charge = 20; c2.charge = 6;
    run(1);
    check("a ring charges the next Chime: a Chain of 2", chain && chain.steps >= 2, chain && chain.steps);
    check("a ring gives free actions (a Source emits)", w.outq.length + countMotes() > 0);
    sim.on("chain", (ch) => { goals.featCheck("chain", ch.steps); });
  }

  section("Behaviour: the three resets");
  {
    fresh(2001);
    B.place("wellspring", 1, 5, 0); B.place("track", 2, 5, 0); B.place("hearth", 3, 4, 0);
    S.season.glowSeason = 6.2; S.eclipse.glowSince = 6.2;
    check("the Harvest opens at 1M Glow in one Season", E.harvestReady());
    const n = S.season.copies.length;
    pr.harvest();
    check("a Harvest pays ⌊10 × (L/10^6)^(1/3)⌋ Seeds", near(num.N(S.eclipse.seeds), Math.floor(10 * Math.pow(Math.pow(10, 0.2), 1 / 3))), num.N(S.eclipse.seeds));
    check("copies become Ghosts and Season 2 begins", S.season.copies.length === 0 && S.season.ghosts.length === n && S.seasonNo === 2);
    S.season.glow = 30;
    const g = S.season.ghosts.find((x) => x.type === "wellspring");
    check("a Ghost can be built back", !!auto.buildGhost(g));
    check("each Seed earned gives +5% Glow", near(Math.pow(10, E.globalL()), 1 + 0.05 * num.N(S.eclipse.seedsEarned), 1e-3));
    S.eclipse.seeds = 3;
    check("Seed Tree: a node costs 5 Seeds and needs the one above it", pr.buySeed("fertile") && !pr.seedOpen("sap"));
    S.eclipse.seedsEarned = 6.1; S.world.seedsSince = 6.1;
    check("an Eclipse opens at 1M Seeds", E.eclipseReady());
    pr.doEclipse();
    check("an Eclipse pays Stars and resets Seeds and the tree", E.starsTotal() >= 3 && S.eclipse.seeds === num.ZERO && !S.eclipse.tree.fertile);
    check("Stars go on the Sky; three on The Lantern complete it", ["lantern:0", "lantern:1", "lantern:2"].every((p) => pr.placeStar(p)) && E.constellationOn("lantern"));
    S.world.heart.stage = 7;
    const law = pr.lawChoices()[0];
    check("Genesis makes a Planet, a Law, Stardust and a new world", pr.genesis(law) && S.meta.planets.length === 1 && S.meta.depth === 1 && S.meta.laws[0] === law && num.N(S.meta.stardust) >= 25 && S.world.eclipses === 0);
    check("each Planet is ×3 all Glow", E.globalL() >= Math.log10(3) - 1e-9);
  }

  section("Behaviour: automation, offline, saving");
  {
    fresh(3001);
    S.season.glow = 20;
    B.place("wellspring", 1, 5, 0); B.place("track", 2, 5, 0); B.place("hearth", 3, 4, 0);
    S.seasonNo = 3;
    S.directives.push({ on: true, conds: [{ k: "glowX", x: 1 }], act: { k: "levels", type: "wellspring", amount: 1 }, fired: 0 });
    auto.directivesTick();
    check("a Directive buys Levels when its condition holds", E.level("wellspring") === 2 && S.directives[0].fired === 1);
    const bp = auto.saveBlueprint("Line", 1, 4, 4, 5);
    const code = auto.blueprintCode(bp);
    const back = auto.blueprintFromCode(code);
    check("a Blueprint round-trips through its text code", back && back.parts.length === bp.parts.length && back.w === bp.w);
    check("stamping a Blueprint places Ghosts", auto.stampBlueprint(bp, 1, 1, 1) === bp.parts.length);
    run(60);
    const g0 = S.season.glowSeason;
    S.lastPerSec = RT.rate.perSec;
    const log = off.catchUp(3600);
    check("an hour away pays Glow at the Offline Rate", S.season.glowSeason > g0 && near(num.N(log.glow), num.N(S.lastPerSec) * 3600 * 0.5, 0.02), num.fmtL(log.glow) + " vs " + num.fmtL(S.lastPerSec + Math.log10(1800)));
    check("Golden Moths become Moth Jars, up to 3", S.season.jars >= 1 && S.season.jars <= 3, S.season.jars);
    const raw = save.serialise();
    const copies = S.season.copies.length, glow = S.season.glow, lvl = E.level("wellspring");
    st.newGame(1);
    localStorage.setItem("bloomworks-save-v1", raw);
    check("a save comes back as it went", save.load() && S.season.copies.length === copies && near(S.season.glow, glow) && E.level("wellspring") === lvl && S.season.plots["0,0"].xp !== null);
    check("a save survives -Infinity (zero) values", S.world.starsEarned === num.ZERO);
    check("a save code imports", save.importCode(save.exportCode()) && S.season.copies.length === copies);
  }

  section("Pacing: a greedy player in Season 1 (informational)");
  {
    fresh(4242);
    S.season.glow = num.L(50);
    // A spine of Track along row 5 into a Hearth, Wellsprings above and below it.
    B.place("track", 0, 5, 0, { free: true });
    for (let x = 1; x <= 7; x++) B.place("track", x, 5, 0, { free: true });
    B.place("hearth", 8, 4, 0);
    const slots = [];
    for (let x = 0; x <= 6; x++) { slots.push([x, 4, 1]); slots.push([x, 6, 3]); }
    let t = 0, firstAt = null;
    const marks = {};
    while (t < 2 * 3600) {
      run(5); t += 5;
      for (let k = 0; k < 10; k++) {
        const opts = [];
        const free = slots.find(([x, y]) => !B.copyAt(x, y) && !B.whyNot("wellspring", x, y));
        if (free) opts.push(["ws", E.buildCostL("wellspring")]);
        opts.push(["lvw", E.levelCostL("wellspring", 1)]);
        opts.push(["lvh", E.levelCostL("hearth", 1) + 0.3]);
        if (E.unlocked("polisher") && !S.season.copies.some((c) => c.type === "polisher")) opts.push(["pol", E.buildCostL("polisher")]);
        if (S.season.copies.some((c) => c.type === "polisher")) opts.push(["lvp", E.levelCostL("polisher", 1)]);
        if (E.workshopOpen("polish")) opts.push(["wsp", E.workshopCostL("polish")]);
        opts.sort((a, b) => a[1] - b[1]);
        const [what, cost] = opts[0];
        if (!num.lGte(S.season.glow, cost)) break;
        if (what === "ws") B.place("wellspring", free[0], free[1], free[2]);
        if (what === "lvw") auto.buyLevels("wellspring", 1);
        if (what === "lvh") auto.buyLevels("hearth", 1);
        if (what === "lvp") auto.buyLevels("polisher", 1);
        if (what === "wsp") { S.season.glow = num.lSub(S.season.glow, cost); S.season.workshop.polish = E.ws("polish") + 1; }
        if (what === "pol") { const tr = B.copyAt(7, 5); B.remove(tr); B.place("polisher", 7, 5, 0); }
      }
      if (process.env.BW_TRACE && t % 10 === 0) process.stdout.write("  t" + t + " glow " + num.fmtL(S.season.glow) + " season " + num.fmtL(S.season.glowSeason) + " lv " + JSON.stringify(S.season.levels) + " n " + S.season.copies.length + " rate " + num.fmtL(RT.rate.perSec) + "\n");
      for (const m of [3, 4, 5, 6]) if (!marks[m] && S.season.glowSeason >= m) marks[m] = t;
      if (S.season.glowSeason >= 6) { firstAt = t; break; }
    }
    process.stdout.write("  Glow this Season: " + num.fmtL(S.season.glowSeason) + " after " + num.fmtTime(t) + "; 1K at " + num.fmtTime(marks[3] || 0) + ", 10K at " + num.fmtTime(marks[4] || 0) + ", 100K at " + num.fmtTime(marks[5] || 0) + (firstAt ? ", Harvest ready at " + num.fmtTime(firstAt) : "") + "\n");
    process.stdout.write("  (Wellsprings, a Polisher and Levels only; the design's 44 minutes also uses Kilns, Extractors, plots, Fusers and Chimes.)\n");
    check("a Season with only the opening tools still climbs past 1K Glow", S.season.glowSeason >= 3);
  }

  process.stdout.write("\n" + (failures.length ? failures.length + " of " + checks + " checks FAILED:\n  " + failures.join("\n  ") : checks + "/" + checks + " checks passed") + "\n");
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
