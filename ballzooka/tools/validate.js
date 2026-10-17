#!/usr/bin/env node
/* ============================================================
   Ballzooka — validation harness
   `node tools/validate.js`

   Same shape as bloomworks/tools/validate.js. Two halves, both of which
   have to pass before anything ships:

   1. Static checks over the source as text: no emoji, every module parses,
      the page and the service worker carry one version, the worker never
      takes over by itself, every file the game loads is in the worker's
      shell, every id the scripts reach for exists, every (i) names a topic,
      every icon named anywhere is drawn, every perk is handled, and the
      lifted files still say where they came from.

   2. Behaviour checks over the game, imported straight into Node (sim.js
      never touches the DOM): gates multiply exactly, weight is conserved
      past the ball cap, ÷ gates divide, charge gates climb, panels flip,
      a seed replays the same run, every perk applies, the campaign is
      winnable at the start and needs the shop later, Endless ends, a revive
      works once, and the save comes back as it went. It ends by printing
      how a simple autopilot fares across the campaign.

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

const store = new Map();
global.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };

/* The autopilot: stand under the best gate, take the better panel, and
   step under anything about to reach the line. Deliberately simple — if
   this can clear a level, a person can. */
function pilot(g) {
  let tx = g.cannon.x;
  const p = g.pickups[0];
  if (p && p.y > 330) tx = p.panels[0].v >= p.panels[1].v ? 100 : 300;
  else {
    let best = null, bv = 0;
    for (const gt of g.gates) {
      const v = gt.op === "mul" || gt.op === "charge" ? gt.v + 0.5 : gt.op === "div" ? -1 : gt.op === "mystery" ? 2.6 : 1.5;
      if (v > bv) { bv = v; best = gt; }
    }
    if (best) tx = best.x;
    let low = null;
    for (const e of g.enemies) if (e.kind !== "gold" && (!low || e.y > low.y)) low = e;
    if (low && low.y > 470) tx = low.x;
  }
  g.cannon.tx = tx;
}
function play(sim, o, maxT) {
  const g = sim.newRun(o);
  let t = 0;
  while (t < (maxT || 600) && (g.state === "play" || g.state === "draft")) {
    if (g.state === "draft") sim.choosePerk(g, 0);
    pilot(g); sim.step(g, 1 / 60); t += 1 / 60; g.events.length = 0;
  }
  return { g, t };
}

(async function main() {
  section("Static: no emoji");
  {
    const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{2B00}-\u{2BFF}]/u;
    const bad = [];
    for (const rel of jsFiles.concat(["index.html", "css/ballzooka.css", "sw.js", "manifest.webmanifest", "tools/validate.js", "tools/e2e.js", "README.md"].filter(exists)))
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
    const pageV = (html.match(/window\.BZ_VERSION\s*=\s*"([^"]+)"/) || [])[1];
    const cache = (sw.match(/var CACHE\s*=\s*"ballzooka-v([^"]+)"/) || [])[1];
    check("index.html declares window.BZ_VERSION", !!pageV, pageV);
    check("sw.js names its cache ballzooka-v<version>", !!cache, cache);
    check("the two agree", pageV === cache, pageV + " vs " + cache);
    const install = sw.slice(sw.indexOf('addEventListener("install"'), sw.indexOf('addEventListener("message"'));
    check("no skipWaiting() inside install", !/skipWaiting\(\)/.test(install.replace(/\/\*[\s\S]*?\*\//g, "")));
    check('the worker answers "skip-waiting"', /e\.data === "skip-waiting"\) self\.skipWaiting\(\)/.test(sw));
    const upd = read("js/update.js");
    check("the page posts skip-waiting to a waiting worker", /postMessage\("skip-waiting"\)/.test(upd));
    check("the page reloads on controllerchange, only after a first controller", /controllerchange/.test(upd) && /hadController/.test(upd));
    check("the page checks periodically, on visibility and on online", /setInterval/.test(upd) && /visibilitychange/.test(upd) && /"online"/.test(upd));
    check("index.html has the update bar", /id="update-bar"/.test(html) && /id="update-go"/.test(html) && /id="update-later"/.test(html));
    check("settings carry the version and a manual check", /updCheck/.test(read("js/ui.js")) && /Check for updates/.test(read("js/ui.js")));
  }

  section("Static: the worker's shell holds everything the game loads");
  {
    const shell = [...sw.matchAll(/"\.\/([^"]*)"/g)].map((m) => m[1]).filter(Boolean);
    const missing = shell.filter((f) => !exists(f));
    check("every shell entry exists (" + shell.length + ")", !missing.length, missing.join(", "));
    const need = jsFiles.concat(["css/ballzooka.css", "manifest.webmanifest", "index.html"]);
    const absent = need.filter((f) => !shell.includes(f));
    check("every script, the stylesheet and the manifest are in the shell", !absent.length, absent.join(", "));
    const man = JSON.parse(read("manifest.webmanifest"));
    const icons = man.icons.map((i) => i.src).filter((s) => !exists(s));
    check("every manifest icon exists", !icons.length, icons.join(", "));
    const unshelled = man.icons.map((i) => i.src).filter((s) => !shell.includes(s));
    check("every manifest icon is in the shell", !unshelled.length, unshelled.join(", "));
  }

  section("Static: ids, topics and icons");
  {
    const src = jsFiles.map(read).join("\n");
    const htmlIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    const madeIds = new Set([...src.matchAll(/id=\\?"([A-Za-z][\w-]*)\\?"/g)].map((m) => m[1]));
    const wanted = new Set([...src.matchAll(/(?:\$|getElementById|el)\("([A-Za-z][\w-]*)"\)/g)].map((m) => m[1]));
    const lost = [...wanted].filter((id) => !htmlIds.has(id) && !madeIds.has(id));
    check("every id a script reaches for exists (" + wanted.size + ")", !lost.length, lost.join(", "));

    const { TOPICS } = await imp("js/topics.js");
    const infoKeys = new Set([...(html + src).matchAll(/data-info="([^"]+)"/g)].map((m) => m[1]).concat([...src.matchAll(/\binfo\("([^"]+)"\)/g)].map((m) => m[1])));
    const noTopic = [...infoKeys].filter((k) => /^\w+$/.test(k) && !TOPICS[k]);
    check("every (i) names a topic (" + infoKeys.size + ")", !noTopic.length, noTopic.join(", "));
    const bodies = Object.keys(TOPICS).filter((k) => { try { const b = TOPICS[k].body; return !(typeof b === "function" ? b() : b); } catch (e) { return true; } });
    check("every topic renders a body", !bodies.length, bodies.join(", "));

    const { ICONS } = await imp("js/icons.js");
    const D = await imp("js/data.js");
    const named = new Set([...html.matchAll(/data-icon="([^"]+)"/g)].map((m) => m[1]).concat([...src.matchAll(/\bicon\("([^"]+)"/g)].map((m) => m[1])));
    for (const t of [D.PERKS, D.UPGRADES]) for (const k of Object.keys(t)) named.add(t[k].icon);
    const undrawn = [...named].filter((n) => !ICONS[n]);
    check("every icon named anywhere is drawn (" + named.size + ")", !undrawn.length, undrawn.join(", "));
  }

  section("Static: data is complete");
  const D = await imp("js/data.js");
  {
    const simSrc = read("js/sim.js");
    const unhandled = Object.keys(D.PERKS).filter((k) => !simSrc.includes('case "' + k + '"'));
    check("every perk has a case in choosePerk", !unhandled.length, unhandled.join(", "));
    const flags = [...simSrc.matchAll(/g\.flags\.(\w+)\s*=/g)].map((m) => m[1]).filter((k) => !D.ACH[k]);
    check("every flag the game raises is a trophy", !flags.length, flags.join(", "));
    const skinAch = Object.values(D.CANNONS).concat(Object.values(D.BALLS)).filter((o) => o.ach && !D.ACH[o.ach]).map((o) => o.name);
    check("every trophy-locked skin names a real trophy", !skinAch.length, skinAch.join(", "));
    const e = Object.keys(D.ENEMY).filter((k) => { const x = D.ENEMY[k]; return !(x.hp > 0 && x.r > 0 && x.v > 0 && x.color && x.name && x.line); });
    check("every enemy is fully described", !e.length, e.join(", "));
    check("every boss in the rotation is described", D.BOSS_ORDER.every((k) => D.BOSS[k] && D.BOSS[k].name));
    const gateOps = [...simSrc.matchAll(/op: "(\w+)"/g)].map((m) => m[1]).filter((k) => !D.GATE[k]);
    check("every gate the game lays has a colour and a line", !gateOps.length, gateOps.join(", "));
    let mono = true;
    for (const id of Object.keys(D.UPGRADES)) for (let l = 0; l < D.UPGRADES[id].max; l++) if (D.upgradeCost(id, l + 1) <= D.upgradeCost(id, l)) mono = false;
    check("every upgrade costs more each level", mono);
    const lines = [].concat(...[D.PERKS, D.UPGRADES, D.ENEMY, D.ACH, D.DROP, D.MODIFIERS].map((t) => Object.values(t).map((o) => o.line))).filter((l) => !l || l.length > 70);
    check("every in-game line is one short line (70 characters at most)", !lines.length, lines.join(" | "));
  }

  section("Static: lifted files say where they came from");
  {
    check("js/update.js names bloomworks/js/update.js", /bloomworks\/js\/update\.js/.test(read("js/update.js")));
    check("js/info.js names bloomworks/js/info.js", /bloomworks\/js\/info\.js/.test(read("js/info.js")));
    check("js/rng.js names bloomworks/js/rng.js", /bloomworks\/js\/rng\.js/.test(read("js/rng.js")));
    check("js/icons.js names bloomworks/js/icons.js", /bloomworks\/js\/icons\.js/.test(read("js/icons.js")));
    check("js/audio.js names bloomworks/js/audio.js", /bloomworks\/js\/audio\.js/.test(read("js/audio.js")));
    check("sw.js names bloomworks/sw.js", /bloomworks\/sw\.js/.test(sw));
    check("sim.js never calls Math.random() except to pick a seed", (read("js/sim.js").replace(/\/\*[\s\S]*?\*\//g, "").match(/Math\.random\(\)/g) || []).length === 1);
  }

  section("Behaviour: gates");
  const sim = await imp("js/sim.js");
  // A bench: a run with its waves taken away, so nothing re-lays the gates
  // or sends anything down while a test is measuring.
  const bench = (seed) => { const g = sim.newRun({ seed, meta: {} }); g.waves = []; g.gates = []; g.enemies = []; g.queue = []; g.pickups = []; g.s.rate = 0.0001; g.cannon.cool = 99; return g; };
  {
    const g = bench(7);
    const gate = (op, v, y) => ({ id: 900 + y, bit: 1 << (y % 30), x: 200, bx: 200, y, w: 400, h: 18, op, v, charge: 0, need: 4, cnt: 0, amp: 0, born: 0, flash: 0, hits: 0 });
    g.gates.push(gate("mul", 3, 400), gate("mul", 2, 300));
    g.balls.push({ x: 200, y: 500, px: 200, py: 500, vx: 0, vy: -500, n: 1, r: 5, mask: 0, fx: 0, pierce: 0, bounce: 0, rubber: 0, last: 0, dead: false });
    for (let i = 0; i < 30; i++) sim.step(g, 1 / 60);
    check("one ball through ×3 then ×2 is six balls", Math.abs(g.ballCount - 6) < 1e-9, g.ballCount);

    const h = bench(8);
    h.gates.push(gate("mul", 5, 400), gate("mul", 5, 300), gate("mul", 5, 200));
    for (let i = 0; i < 40; i++) h.balls.push({ x: 200, y: 500, px: 200, py: 500, vx: 0, vy: -500, n: 1, r: 5, mask: 0, fx: 0, pierce: 0, bounce: 0, rubber: 0, last: 0, dead: false });
    for (let i = 0; i < 38; i++) sim.step(h, 1 / 60);
    check("past the ball cap, weight is conserved: 40 × 125 = 5000", Math.abs(h.ballCount - 5000) < 1e-6, h.ballCount);
    check("and the objects stay within MAX_BALLS", h.balls.length <= sim.MAX_BALLS, h.balls.length);

    const d = bench(9);
    d.gates = [gate("div", 2, 400)];
    for (let i = 0; i < 10; i++) d.balls.push({ x: 200, y: 500, px: 200, py: 500, vx: 0, vy: -500, n: 1, r: 5, mask: 0, fx: 0, pierce: 0, bounce: 0, rubber: 0, last: 0, dead: false });
    for (let i = 0; i < 20; i++) sim.step(d, 1 / 60);
    check("ten balls through ÷2 are five", d.ballCount === 5, d.ballCount);

    const c = bench(10);
    const cg = gate("charge", 1, 400); c.gates = [cg];
    for (let i = 0; i < 12; i++) c.balls.push({ x: 200, y: 500 + i * 3, px: 200, py: 500, vx: 0, vy: -500, n: 1, r: 5, mask: 0, fx: 0, pierce: 0, bounce: 0, rubber: 0, last: 0, dead: false });
    for (let i = 0; i < 30; i++) sim.step(c, 1 / 60);
    check("a charge gate climbs as it is shot through (12 balls, 4 a step → ×4)", cg.v === 4, cg.v);

    const p = bench(11);
    p.pickups = [{ id: 1, y: 300, h: 38, vy: 0, panels: [{ stat: "dmg", v: -10, x0: 0, x1: 200, min: -40, max: 100, flash: 0 }, { stat: "rate", v: 10, x0: 200, x1: 400, min: -40, max: 100, flash: 0 }] }];
    for (let i = 0; i < 20; i++) p.balls.push({ x: 100, y: 400 + i * 2, px: 100, py: 400, vx: 0, vy: -500, n: 1, r: 5, mask: 0, fx: 0, pierce: 0, bounce: 0, rubber: 0, last: 0, dead: false });
    for (let i = 0; i < 20; i++) sim.step(p, 1 / 60);
    check("shooting a red panel flips it blue", p.pickups[0].panels[0].v > 0 && p.flags.flip, p.pickups[0].panels[0].v);
    check("the panel took the balls", p.ballCount === 0, p.ballCount);
    const dmg0 = p.s.dmg;
    p.cannon.x = 100; p.pickups[0].vy = 2000;
    for (let i = 0; i < 30; i++) sim.step(p, 1 / 60);
    check("driving under it applies it", p.s.dmg > dmg0 && !p.pickups.length, dmg0 + " → " + p.s.dmg);
  }

  section("Behaviour: runs");
  {
    const a = play(sim, { seed: 4242, level: 4, meta: {} }), b = play(sim, { seed: 4242, level: 4, meta: {} });
    check("a seed replays the same run", a.g.kills === b.g.kills && a.g.coins === b.g.coins && a.g.state === b.g.state && a.t === b.t, a.g.kills + "/" + b.g.kills);

    let perkErr = null;
    try {
      const g = sim.newRun({ seed: 5, level: 6, meta: {} });
      for (const k of Object.keys(D.PERKS)) { g.state = "draft"; g.draft = [k]; sim.choosePerk(g, 0); }
      for (let i = 0; i < 60 * 40 && g.state !== "lost" && g.state !== "won"; i++) { if (g.state === "draft") sim.choosePerk(g, 0); pilot(g); sim.step(g, 1 / 60); }
    } catch (e) { perkErr = e.stack; }
    check("every perk at once runs 40 seconds without an error", !perkErr, perkErr);

    const early = [1, 2, 3].map((L) => play(sim, { seed: 100 + L, level: L, meta: {} }).g.state);
    check("levels 1–3 are cleared by the autopilot with an empty shop", early.every((s) => s === "won"), early.join(","));
    const tenBare = [0, 1, 2].map((i) => play(sim, { seed: 200 + i, level: 12, meta: {} }).g.state).filter((s) => s === "won").length;
    const tenShop = [0, 1, 2].map((i) => play(sim, { seed: 200 + i, level: 12, meta: { upg: { rate: 12, dmg: 12, volley: 2, crit: 4 } } }).g.state).filter((s) => s === "won").length;
    check("level 12 wants the shop: the bare cannon fails more than an upgraded one", tenShop > tenBare, "bare " + tenBare + "/3, upgraded " + tenShop + "/3");
    const boss = play(sim, { seed: 31, level: 5, meta: { upg: { rate: 8, dmg: 8 } } });
    check("a boss level ends with the boss gone", boss.g.state !== "won" || (boss.g.bosses >= 1 && !boss.g.enemies.some((e) => e.boss)), boss.g.state + ", bosses " + boss.g.bosses);

    const end = play(sim, { mode: "endless", seed: 77, meta: {} }, 1800);
    check("Endless ends within half an hour with an empty shop", end.g.state === "lost", "wave " + (end.g.wave + 1) + " after " + Math.round(end.t) + " s");
    check("Endless pays half", end.g.s.coinMul === 0.5, end.g.s.coinMul);

    const r = sim.newRun({ seed: 3, level: 3, meta: {} });
    r.state = "lost"; r.hearts = 0;
    const once = sim.revive(r), twice = (r.state = "lost", sim.revive(r));
    check("a revive works once per level", once && !twice && r.hearts >= 1);

    const mods = Object.keys(D.MODIFIERS).every((m) => { try { const g = sim.newRun({ mode: "daily", seed: 9, modifier: m, meta: {} }); for (let i = 0; i < 600; i++) { if (g.state === "draft") sim.choosePerk(g, 0); sim.step(g, 1 / 60); } return true; } catch (e) { return false; } });
    check("every Daily twist runs", mods);
  }

  section("Behaviour: the save");
  {
    const save = await imp("js/save.js");
    save.S.coins = 1234; save.S.upg.rate = 3; save.S.ach.first = 1; save.S.owned.balls.push("candy");
    save.save();
    save.S.coins = 0; save.S.upg.rate = 0;
    check("load() reads it back", save.load() && save.S.coins === 1234 && save.S.upg.rate === 3 && save.S.owned.balls.includes("candy"));
    save.wipe();
    check("wipe() starts over", save.S.coins === 0 && !save.S.upg.rate && save.S.level === 1 && !store.size);
  }

  section("The campaign, by autopilot (for information)");
  {
    const rows = [];
    for (const [label, upg] of [["empty shop", {}], ["Fire rate 8, Damage 8", { rate: 8, dmg: 8 }], ["16 / 16, 3 barrels", { rate: 16, dmg: 16, volley: 3, crit: 6 }]]) {
      let reached = 0;
      for (let L = 1; L <= 40; L++) { const r = play(sim, { seed: 9000 + L, level: L, meta: { upg } }); if (r.g.state !== "won") break; reached = L; }
      rows.push("  " + label + ": clears levels 1–" + reached);
    }
    process.stdout.write(rows.join("\n") + "\n");
  }

  process.stdout.write("\n" + (checks - failures.length) + " / " + checks + " checks passed\n");
  if (failures.length) { process.stdout.write("\nFailed:\n  " + failures.join("\n  ") + "\n"); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
