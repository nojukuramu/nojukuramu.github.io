#!/usr/bin/env node
/* ============================================================
   Aeons — validation harness
   `node tools/validate.js`

   Same shape as hacks/tools/validate.js. Two halves, both of which have to
   pass before anything ships:

   1. Static checks over the source as text: no emoji, every module parses,
      the page and the service worker carry one version, the worker never
      takes over by itself, every file the game loads is in the worker's
      shell, every id the scripts reach for exists, every (i) names a topic,
      every icon named anywhere is drawn, and the lifted files still say
      where they came from.

   2. Behaviour checks over the simulation, imported straight into Node: the
      world is the same for the same seed, paths go round things, the data
      tables are complete for every era, workers gather, buildings obey the
      border, a base falls and the phase turns, the border grows, an era is
      reached and a line retrained, a champion casts and levels, a unit is
      driven by hand, the automation does its jobs, the fog remembers, and a
      save comes back as it went. It ends by printing what maxing everything
      costs, which is the number the fourteen-hour pacing is set against.

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

(async function main() {
  section("Static: no emoji");
  {
    const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{2B00}-\u{2BFF}]/u;
    const bad = [];
    for (const rel of jsFiles.concat(["index.html", "css/aeons.css", "sw.js", "manifest.webmanifest", "tools/validate.js", "tools/e2e.js"].filter(exists)))
      read(rel).split("\n").forEach((line, i) => { const m = line.match(EMOJI); if (m) bad.push(rel + ":" + (i + 1)); });
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
    const pageV = (html.match(/window\.AE_VERSION\s*=\s*"([^"]+)"/) || [])[1];
    const cache = (sw.match(/var CACHE\s*=\s*"aeons-v([^"]+)"/) || [])[1];
    check("index.html declares window.AE_VERSION", !!pageV, pageV);
    check("sw.js names its cache aeons-v<version>", !!cache, cache);
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
    const loaded = jsFiles.concat(["css/aeons.css", "manifest.webmanifest", "index.html"]);
    const absent = loaded.filter((f) => !shell.includes(f));
    check("every module, the stylesheet and the manifest are in the shell", !absent.length, absent.join(", "));
    const mf = JSON.parse(read("manifest.webmanifest"));
    const icons = mf.icons.map((i) => i.src).filter((s) => !exists(s));
    check("every manifest icon exists", !icons.length, icons.join(", "));
    check("every manifest icon is cached", mf.icons.every((i) => shell.includes(i.src)));
    // every import resolves to a file
    const bad = [];
    for (const rel of jsFiles) for (const m of read(rel).matchAll(/from "\.\/([^"]+)"/g)) if (!exists("js/" + m[1])) bad.push(rel + " -> " + m[1]);
    check("every import resolves", !bad.length, bad.join(", "));
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
    // ids the scripts write into the page themselves
    const made = new Set(["slots", "importFile", "updState"]);
    const lost = [...wanted].filter((id) => !ids.has(id) && !made.has(id) && !/^res-/.test(id));
    check("every id the scripts reach for is in index.html", !lost.length, lost.join(", "));
    const info = await imp("js/info.js");
    const topics = new Set(info.keys());
    const used = new Set();
    for (const src of jsFiles.map(read).concat(html)) for (const m of src.matchAll(/data-info=\\?"([a-z]+)\\?"/g)) used.add(m[1]);
    const noTopic = [...used].filter((k) => !topics.has(k));
    check("every (i) names a topic", !noTopic.length, noTopic.join(", "));
    check("there are topics to name", used.size >= 8, String(used.size));
    const { ICONS } = await imp("js/icons.js");
    const names = new Set();
    for (const m of html.matchAll(/data-icon="([a-z0-9]+)"/g)) names.add(m[1]);
    for (const src of jsFiles.map(read)) for (const m of src.matchAll(/icon\("([a-z0-9]+)"/g)) names.add(m[1]);
    const D = await imp("js/data.js");
    for (const c in D.TECH_CATS) names.add(D.TECH_CATS[c].icon);
    for (const d in D.DOCTRINES) names.add(D.DOCTRINES[d].icon);
    for (const h in D.HEROES) for (const s of D.HEROES[h].skills) names.add(s.id);
    for (const r of D.RES) names.add(r);
    const noIcon = [...names].filter((n) => !ICONS[n]);
    check("every icon named anywhere is drawn (" + names.size + ")", !noIcon.length, noIcon.join(", "));
  }

  section("Static: lifted files say where they came from");
  check("orient.js names Hacks' orient.js", /hacks\/js\/orient\.js/.test(read("js/orient.js")));
  check("update.js names Hacks' update.js", /hacks\/js\/update\.js/.test(read("js/update.js")));
  check("info.js names Hacks' info.js", /hacks\/js\/info\.js/.test(read("js/info.js")));
  {
    const a = read("../hacks/js/orient.js"), b = read("js/orient.js");
    const tail = (s) => s.slice(s.indexOf("let turned")).replace(/save\.settings/g, "settings");
    check("orient.js is Hacks' line for line past its imports", tail(a) === tail(b));
  }

  /* ======================================================================
     Behaviour
     ====================================================================== */
  // the simulation's sparks of chance (damage spread, which den spawns) are made repeatable for the test
  { let a = 20250601; Math.random = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const D = await imp("js/data.js");
  const { G, on } = await imp("js/state.js");
  const sim = await imp("js/sim.js");
  const W = await imp("js/world.js");
  const { findPath } = await imp("js/path.js");
  const E = await imp("js/entities.js");
  const U = await imp("js/units.js");
  const B = await imp("js/buildings.js");
  const H = await imp("js/heroes.js");
  const S = await imp("js/save.js");
  const F = await imp("js/fog.js");
  const hallOf = () => G.blds.find((b) => !b.dead && b.team === 0 && b.type === "hall");
  // the waves keep coming while the test looks at other things; home is kept standing so it can
  const run = (n) => { for (let i = 0; i < n; i++) { sim.tick(); if (i % 40 === 0 && G.phase && G.phase.n > 0) for (const b of G.blds) if (b.team === 0 && !b.dead && b.built >= 1) b.hp = b.maxHp; } };

  section("Data: every era has what it needs");
  {
    let bad = [];
    for (const id in D.LINES) { const L = D.LINES[id]; for (let e = L.first; e <= 9; e++) if (!L.names[e]) bad.push(id + "@" + e); }
    check("every unit line is named in every era it exists in", !bad.length, bad.join(", "));
    bad = [];
    for (const id in D.BUILDINGS) { const b = D.BUILDINGS[id]; for (let e = b.first; e <= 9; e++) if (!b.names[e]) bad.push(id + "@" + e); }
    check("every building is named in every era it exists in", !bad.length, bad.join(", "));
    let inc = true; for (let e = 2; e <= 9; e++) if (D.ERAS[e].adv.phases <= D.ERAS[e - 1].adv.phases) inc = false;
    check("each era asks for more phases than the last", inc);
    check("the last era asks for 27 phases", D.ERAS[9].adv.phases === 27);
    let mono = true; for (const c in D.TECH_CATS) for (let L = 2; L <= D.TECH_CATS[c].max; L++) if (D.techEra(c, L) < D.techEra(c, L - 1) || D.techEra(c, L) > 9) mono = false;
    check("research opens era by era, never past the last", mono);
    check("every doctrine opens by the last era", Object.values(D.DOCTRINES).every((d) => d.era <= 9));
    check("every champion has four skills", Object.values(D.HEROES).every((h) => h.skills.length === 4));
    const s0 = D.lineStats("melee", 0), s9 = D.lineStats("melee", 9);
    check("an Aether Blade is far stronger than a Clubber", s9.atk > s0.atk * 15 && s9.hp > s0.hp * 15);
    check("enemies fight in the era you could have reached", D.enemyEra(1) === 0 && D.enemyEra(2) === 1 && D.enemyEra(28) === 9);
  }

  section("World: made from the seed");
  {
    const a = new W.World(42), b = new W.World(42), c = new W.World(43);
    let same = true, diff = false;
    for (let y = -40; y < 40; y += 3) for (let x = -40; x < 40; x += 3) { if (a.terrain(x, y) !== b.terrain(x, y)) same = false; if (a.terrain(x, y) !== c.terrain(x, y)) diff = true; }
    check("the same seed makes the same land", same);
    check("another seed makes other land", diff);
    let dry = true; for (let y = -7; y <= 7; y++) for (let x = -7; x <= 7; x++) if (x * x + y * y < 49 && !W.isWalk(a.terrain(x, y))) dry = false;
    check("home is a dry clearing", dry);
    a.ensureAll();
    const gold = [...a.nodes.values()].find((n) => n.type === "gold" && Math.hypot(n.tx, n.ty) < 14);
    check("there is gold near home", !!gold);
    check("there is wood near home", !!a.nearestTree(0, 0, 18));
    check("past the border is the Veil", a.terrain(200, 0) === W.T.VEIL && !a.passable(200, 0, "air"));
    const before = a.bounds.x1; a.expand("e", 20);
    check("the border grows by whole chunks", a.bounds.x1 === before + 32);
  }

  section("Paths");
  {
    const w = new W.World(7);
    for (let y = -10; y < 10; y++) for (let x = -10; x < 10; x++) w.setTerrain(x, y, W.T.GRASS);
    for (let y = -8; y <= 8; y++) w.setTerrain(0, y, W.T.ROCK);
    const r = findPath(w, -4, 0, { tx: 4, ty: 0 }, "land");
    const last = r.path[r.path.length - 1];
    check("a path goes round a wall", r.reached && last.tx === 4 && last.ty === 0, JSON.stringify(last));
    check("and is string-pulled to a few waypoints", r.path.length <= 4, String(r.path.length));
    const far = findPath(w, 0, -9, { tx: 300, ty: 0 }, "land");
    check("a goal past the window comes back partial", far.partial);
  }

  section("A game, headless");
  sim.newGame({ seed: 1234 });
  {
    check("it begins with a hall, five workers and a champion", !!hallOf() && G.units.filter((u) => u.line === "worker").length === 5 && G.units.some((u) => u.hero === "warden"));
    const start = G.res.gold + G.res.wood;
    const ws = G.units.filter((u) => u.line === "worker");
    const gold = [...G.world.nodes.values()].find((n) => n.type === "gold" && Math.hypot(n.x, n.y) < 600);
    U.smart(ws.slice(0, 3), gold.x, gold.y, gold, null);
    U.smart(ws.slice(3), 0, 0, null, G.world.nearestTree(0, 0, 20));
    run(1200);
    check("workers gather gold and wood (" + (G.res.gold + G.res.wood - start) + " in two minutes)", G.res.gold + G.res.wood - start > 500);
    check("the border keeps most buildings at home", !B.canPlace("barracks", 50, 50, 0).ok);
    let far = null;
    for (let y = 40; y < 60 && !far; y++) for (let x = 40; x < 60 && !far; x++) { let open = true; for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) if (!G.world.buildable(x + i, y + j)) open = false; if (open) far = { x, y }; }
    check("an outpost can go anywhere explored, but not in the dark", far && B.canPlace("outpost", far.x, far.y, 0).why === "Not explored");
    check("only one hall", !B.canPlace("hall", 6, 6, 0).ok);
    const spot = (await imp("js/auto.js")).findSpot("barracks", hallOf());
    const bar = B.startBuilding("barracks", spot.tx, spot.ty, [ws[3]]);
    run(700);
    check("a worker raises a barracks", bar && bar.built >= 1);
    G.res.gold += 1000; G.res.wood += 1000;
    const cap0 = G.supply.used;
    B.act(bar, "train:melee"); B.act(bar, "train:ranged");
    check("queued units take supply at once", G.supply.used === cap0 + 2);
    run(400);
    check("and come out of the barracks", G.units.filter((u) => u.team === 0 && (u.line === "melee" || u.line === "ranged") && !u.hero).length === 2);
    const n0 = G.units.length;
    B.act(bar, "train:melee"); B.cancel(bar, 0);
    check("a cancelled unit refunds and frees supply", G.supply.used === cap0 + 2 && G.units.length === n0);
  }

  section("Phases");
  {
    let phases = [], fell = 0, expanded = 0;
    on("phase", (n) => phases.push(n)); on("baseFell", () => fell++); on("expanded", () => expanded++);
    // a garrison at home, so the waves that come while the test is away have something to meet
    for (let i = 0; i < 16; i++) { const g = E.spawnUnit(i % 2 ? "ranged" : "melee", 4, 0, (i % 4) * 24 - 40, 120 + Math.floor(i / 4) * 24); U.setOrder(g, { t: "hold" }); g.stance = "hold"; }
    hallOf().hp = hallOf().maxHp *= 20;
    run(1900);
    check("a phase begins after a breath", G.phase.n >= 1);
    const base = [...G.bases.values()][0];
    check("its base is far from home", Math.hypot(base.tx, base.ty) > 40);
    check("its buildings are yours, in its colours", base.blds.map((id) => G.ents.get(id)).some((b) => b.type === "hall" && b.team === 1));
    // the test plays the war with overwhelming armies; it is checking that phases turn, not balance
    for (let round = 0; round < 12 && G.stats.phases < 4; round++) {
      const live = [...G.bases.values()].filter((b) => b.alive);
      for (const bs of live) {
        const army = [];
        for (let i = 0; i < 24; i++) army.push(E.spawnUnit(i % 3 ? "melee" : "siege", Math.min(9, G.era + 3), 0, bs.x + (i % 6) * 20 - 200, bs.y + Math.floor(i / 6) * 20 + 200));
        U.moveGroup(army, bs.x, bs.y, "amove");
      }
      for (let i = 0; i < 3000 && G.phase && !G.phase.cleared; i++) { sim.tick(); if (i % 50 === 0 && hallOf()) hallOf().hp = hallOf().maxHp; }
      run(320);
    }
    check("bases fall and phases are cleared (" + G.stats.phases + ")", G.stats.phases >= 4 && fell >= 4);
    check("a new phase begins after each (" + G.phase.n + ")", G.phase.n >= 5);
    check("the map has grown", expanded >= 1 && G.world.bounds.x1 - G.world.bounds.x0 + G.world.bounds.y1 - G.world.bounds.y0 > 256);
    check("later phases fight in a later era", [...G.bases.values()].some((b) => b.era >= 1));
  }

  // a ceasefire for the rest of the checks: they look at other things than war
  for (const u of G.units) if (u.team === 1) E.kill(u, null);
  G.phase.cleared = true; G.phase.nextAt = 1e12;
  if (!hallOf()) E.placeBuilding("hall", -2, -2, 0, { built: 1 });
  section("Eras, levels and retraining");
  {
    G.res.gold = G.res.wood = G.res.stone = G.res.oil = G.res.aether = 1e7;
    const hall = hallOf();
    const before = G.era;
    B.act(hall, "era"); run(700);
    check("with a phase cleared, the next era is reached", G.era === before + 1);
    B.act(hall, "level"); run(1700);
    check("the hall is raised a level (" + hall.level + ")", hall.level === 2);
    const bar = G.blds.find((b) => b.type === "barracks" && b.team === 0 && !b.dead) || E.placeBuilding("barracks", hall.tx + 8, hall.ty - 12, 0, { built: 1 });
    const old = E.spawnUnit("melee", 0, 0, hall.x, hall.y + 140);
    const hp0 = old.maxHp;
    B.act(bar, "refit:melee"); run(600);
    check("retraining turns every Clubber into a Spearman", old.tier === 1 && old.maxHp > hp0 && B.tierOf("melee") === 1);
    const forge = E.placeBuilding("forge", hall.tx - 12, hall.ty - 12, 0, { built: 1 });
    const atk0 = old.st.atk;
    B.act(forge, "tech:inf_atk"); run(400);
    check("a forge level makes foot soldiers hit harder", G.tech.inf_atk === 1 && old.st.atk > atk0);
  }

  section("Champions");
  {
    const w = G.units.find((u) => u.hero === "warden" && !u.dead) || E.spawnHero("warden", hallOf().x, hallOf().y + 100);
    const foe = E.spawnUnit("melee", 0, 1, w.x + 40, w.y);
    E.rebuildGrid();
    w.skcd = [0, 0, 0, 0];
    const ok1 = H.cast(w, 0);
    check("Shield Bash lands and stuns", ok1 && foe.stun > G.time && foe.hp < foe.maxHp);
    check("and goes on cooldown", w.skcd[0] > 0 && !H.cast(w, 0));
    check("the fourth skill waits for level 6", !H.cast(w, 3));
    const l0 = w.lvl;
    for (let i = 0; i < 30; i++) (await imp("js/state.js")).emit("xp", w, 500);
    check("a champion levels from experience (" + w.lvl + ")", w.lvl > l0);
    H.possess(w);
    const x0 = w.x;
    H.manual.mx = 1; H.manual.my = 0;
    run(10);
    check("taken in hand, it walks where the stick points", w.x > x0 + 40 && w.manual);
    H.manual.mx = 0;
    H.release();
    check("and lets go", !w.manual && !H.controlled());
  }

  section("Automation");
  {
    G.doctrines.foreman = true; G.doctrines.quarter = true;
    const w = G.units.find((u) => u.team === 0 && u.line === "worker" && !u.dead) || E.spawnUnit("worker", G.era, 0, hallOf().x, hallOf().y + 100);
    U.stop(w); w.carry = null;
    run(60);
    check("Foremen send an idle worker to work", w.order.t !== "idle", JSON.stringify([w.order, w.idleT, w.manual, w.dead, w.hidden, G.auto.foreman]));
    const houses = G.blds.filter((b) => b.team === 0 && b.type === "house").length;
    G.supply.cap = G.supply.used + 1;
    for (const b of G.blds) if (b.team === 0 && b.type === "house") b.dead = true;
    E.recountSupply();
    const hallN = hallOf();
    if (hallN) { G.supply.used = G.supply.cap - 1; }
    let raised = false;
    on("placed", (b) => { if (b.type === "house") raised = true; });
    for (let i = 0; i < 60 && !raised; i++) { G.supply.used = Math.max(G.supply.used, G.supply.cap - 1); sim.tick(); }
    check("Quartermasters raise a house before supply runs out", raised || houses < 0);
  }

  section("Veterans, the wild, and marching together");
  {
    const home = hallOf();
    const vet = E.spawnUnit("melee", 3, 0, home.x + 200, home.y + 200);
    const atk0 = vet.st.atk;
    for (let i = 0; i < 3; i++) { const f = E.spawnUnit("melee", 0, 1, vet.x + 20, vet.y); E.kill(f, vet); }
    check("three kills make a Blooded soldier, who hits harder", vet.rank === 1 && vet.st.atk > atk0 * 1.05);
    // a ruin out in the wild, seen for the first time
    const W0 = G.world;
    let spot = null;
    for (let r = 30; r < 60 && !spot; r += 2) for (let a = 0; a < 6.28 && !spot; a += 0.4) { const tx = Math.round(Math.cos(a) * r), ty = Math.round(Math.sin(a) * r); if (W0.inBounds(tx, ty) && W0.canPlaceNode(tx, ty, 2, 2)) spot = { tx, ty }; }
    const ruin = W0.addNode("relic", spot.tx, spot.ty, 40);
    G.temp.push({ x: ruin.x, y: ruin.y, r: 6, until: G.time + 1 });
    run(12);
    const guards = (ruin.guards || []).map((id) => G.ents.get(id)).filter(Boolean);
    check("a far ruin, once seen, has beasts round it (" + guards.length + ")", guards.length >= 2 && guards.every((g) => g.team === 2 && g.line === "beast"));
    const finder = E.spawnUnit("melee", 9, 0, ruin.x + 40, ruin.y);
    finder.st.dmgTaken = 0;
    run(12);
    check("its ruin cannot be taken while they live", W0.nodes.has(ruin.id));
    for (const g of guards) E.kill(g, finder);
    run(30);
    check("and gives itself up once they are gone", !W0.nodes.has(ruin.id));
    E.kill(finder, null);
    const fast = E.spawnUnit("mounted", 1, 0, home.x + 150, home.y + 150), slow = E.spawnUnit("siege", 1, 0, home.x + 170, home.y + 150);
    U.moveGroup([fast, slow], home.x + 600, home.y + 150, "move");
    check("a group marches at the pace of its slowest", fast.order.gs && Math.abs(U.speedOf(fast) - U.speedOf(slow)) < U.speedOf(slow) * 0.06);
    U.stop(fast); U.stop(slow);
  }

  section("Squads and the new doctrines");
  {
    const SQ = await imp("js/squads.js"), AU = await imp("js/auto.js");
    const home = hallOf();
    const sol = [];
    for (let i = 0; i < 4; i++) sol.push(E.spawnUnit("melee", 1, 0, home.x + 300 + i * 20, home.y + 260));
    const sq = SQ.create(sol, "defend");
    sq.anchor = { x: home.x - 200, y: home.y + 200 }; sq.size = 6;
    run(80);
    check("a defending squad goes to its place", sol.every((u) => Math.hypot(u.x - sq.anchor.x, u.y - sq.anchor.y) < 7 * D.TILE));
    G.doctrines.captains = true;
    const bar = G.blds.find((b) => b.type === "barracks" && b.team === 0 && !b.dead) || E.placeBuilding("barracks", home.tx + 8, home.ty - 12, 0, { built: 1 });
    G.res.gold += 5000; G.res.wood += 5000;
    E.recountSupply(); G.supply.cap = Math.max(G.supply.cap, G.supply.used + 20);
    B.act(bar, "train:melee");
    run(250);
    check("with Captains, a new soldier joins the squad short of its number", sq.ids.length === 5);
    G.doctrines.masons = true;
    const spot = AU.findSpot("house", home);
    const hut = E.placeBuilding("house", spot.tx, spot.ty, 0, { built: 1 });
    E.kill(hut, null);
    run(300);
    check("Masons raise a destroyed house again where it stood", G.blds.some((b) => !b.dead && b.type === "house" && b.tx === spot.tx && b.ty === spot.ty));
    // room to train: supply is recounted from houses every second, so the test builds them
    for (let i = 0; i < 8; i++) { const sp = AU.findSpot("house", home); if (sp) E.placeBuilding("house", sp.tx, sp.ty, 0, { built: 1, level: 2 }); }
    // the earlier sections' armies stop counting against supply, so there is room to train
    for (const u of G.units) if (u.team === 0 && u.line !== "worker" && !u.hero && !sq.ids.includes(u.id)) u.free = true;
    E.recountSupply();
    G.doctrines.standing = true; G.auto.standing = true; G.auto.army.target = AU.armySupply() + 6;
    for (const b of G.blds) if (b.team === 0) b.q.length = 0;
    E.recountSupply(); G.supply.cap = Math.max(G.supply.cap, G.supply.used + 20);
    run(25);
    check("Standing Army keeps the barracks training", G.blds.some((b) => b.team === 0 && !b.dead && b.q.some((it) => it.k === "unit" && it.line !== "worker")));
    G.auto.standing = false;
    G.doctrines.rebirth = true;
    const altar = E.placeBuilding("altar", home.tx - 14, home.ty + 8, 0, { built: 1 });
    const w = G.units.find((u) => u.hero && !u.dead) || E.spawnHero("warden", home.x, home.y + 120);
    E.kill(w, null);
    run(25);
    check("Rebirth calls a fallen champion back", altar.q.some((it) => it.k === "hero"));
    const need = AU.demand();
    check("the realm can say what it is waiting for", typeof need.gold === "number" && need.gold >= 0);
  }

  section("Fog");
  {
    check("ground near home has been seen", F.explored(0, 0));
    const b = G.world.bounds;
    check("the far corner of the map has not", !F.explored(b.x1 - 2, b.y1 - 2) || !F.explored(b.x0 + 1, b.y1 - 2));
    const live = [...G.bases.values()].find((x) => x.alive && x.blds.some((id) => G.ents.get(id) && !G.ents.get(id).dead));
    if (live) {
      const core = live.blds.map((id) => G.ents.get(id)).find((b) => b && !b.dead);
      G.temp.push({ x: core.x, y: core.y, r: 6, until: G.time + 0.5 });
      run(4);
      check("an enemy hall in sight is remembered", G.ghosts.has(core.id));
      run(20);
      check("and still remembered out of sight", G.ghosts.has(core.id) && !F.bldVisible(core));
    } else ok("(no live base to look at)");
  }

  section("Saves");
  {
    const a = S.serialize();
    const txt = JSON.stringify(a);
    S.deserialize(JSON.parse(txt));
    const b = S.serialize();
    check("a save is small enough (" + Math.round(txt.length / 1024) + " KB)", txt.length < 2e6);
    check("units come back", a.units.length === b.units.length);
    check("buildings come back", a.blds.length === b.blds.length);
    check("resources, era, research and phase come back", JSON.stringify([a.res, a.era, a.tech, a.tiers, a.phase.n]) === JSON.stringify([b.res, b.era, b.tech, b.tiers, b.phase.n]));
    check("squads come back", JSON.stringify((a.squads || []).map((q) => [q.name, q.role, q.ids.length])) === JSON.stringify((b.squads || []).map((q) => [q.name, q.role, q.ids.length])) && (a.squads || []).length > 0);
    check("ranks come back", a.units.filter((u) => u.rank).length === b.units.filter((u) => u.rank).length && a.units.some((u) => u.rank));
    check("what was explored comes back", JSON.stringify(a.world.explored) === JSON.stringify(b.world.explored));
    check("felled trees stay felled", JSON.stringify(a.world.chunks) === JSON.stringify(b.world.chunks));
    let threw = null; try { run(300); } catch (e) { threw = e; }
    check("and the game goes on", !threw, threw && threw.message);
    let refused = false; try { S.deserialize({ v: 999 }); } catch (e) { refused = true; }
    check("a save from an unknown version is refused, not half-read", refused);
  }

  section("Pacing: what maxing everything costs");
  {
    let total = 0, secs = 0;
    const add = (c) => { for (const r in c) total += c[r] || 0; };
    for (let e = 1; e <= 9; e++) { add(D.ERAS[e].adv.cost); secs += D.ERAS[e].adv.time; }
    for (const c in D.TECH_CATS) for (let L = 1; L <= D.TECH_CATS[c].max; L++) { add(D.techCost(c, L)); secs += D.techTime(c, L); }
    for (const l of D.TRAINED) for (let e = D.LINES[l].first + 1; e <= 9; e++) { add(D.refitCost(l, e)); secs += D.refitTime(l, e); }
    for (const d in D.DOCTRINES) { add(D.DOCTRINES[d].cost); secs += D.DOCTRINES[d].time; }
    const realm = ["hall", "barracks", "forge", "lumber", "mine", "academy", "altar", "stable", "workshop", "shipyard", "airfield", "tower", "tower", "tower", "outpost", "outpost", "house", "house", "house", "house", "house", "house"];
    for (const t of realm) for (let L = 2; L <= 10; L++) if (D.BUILDINGS[t].first < L) add(D.levelCost(t, L));
    add(D.bldCost("beacon"));
    process.stdout.write("  resources to max a modest realm: " + Math.round(total / 1e6 * 10) / 10 + "M; research queued end to end: " + Math.round(secs / 3600 * 10) / 10 + " h\n");
    process.stdout.write("  phases to the last era: " + D.ERAS[9].adv.phases + " (at ~25 min a phase, about " + Math.round(D.ERAS[9].adv.phases * 25 / 60) + " h)\n");
    check("maxing everything is a long road (between 2M and 20M resources)", total > 2e6 && total < 2e7, String(total));
  }

  process.stdout.write("\n" + (checks - failures.length) + "/" + checks + " checks passed\n");
  if (failures.length) { process.stdout.write("\nFailed:\n" + failures.map((f) => "  - " + f).join("\n") + "\n"); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
