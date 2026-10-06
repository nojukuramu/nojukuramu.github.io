/* sim.js — one tick of the world, and the start of a new one.
 *
 * Fixed steps of TICK (0.1 s), paid out of real time by main.js and drawn
 * between them with interpolation (u.px/u.py are where a unit was a tick
 * ago). The order inside a tick matters and is written down here once:
 * grid, paths, units, crowding, buildings, shots, lingering skills, the
 * enemy, the automation, the fog, the sweep. Nothing in here touches the
 * page, so tools/validate.js runs whole games in Node with it. */

import { G, emit, on, resetState } from "./state.js";
import { TICK, TILE, LINES, ERAS, eraMul } from "./data.js";
import { World } from "./world.js";
import { rebuildGrid, near, spawnUnit, spawnHero, placeBuilding, recountSupply, kill } from "./entities.js";
import { updateUnit, pathQ, solvePath, tryMove } from "./units.js";
import { updateBuilding } from "./buildings.js";
import { updateProjectiles } from "./combat.js";
import { updateHero, updateZones, manual } from "./heroes.js";
import { updateEnemy, initPhases } from "./enemy.js";
import { updateAuto, defaultAuto } from "./auto.js";
import { updateFog, explored } from "./fog.js";
import { setOrder } from "./units.js";
import { RES } from "./data.js";
import { ERA_LINES, RUIN_FRAGMENTS, BEACON_LINE, EPILOGUE } from "./lore.js";

const PATHS_PER_TICK = 14;

export function newGame(opts) {
  resetState();
  G.seed = (opts && opts.seed) >>> 0 || ((Math.random() * 4294967295) >>> 0);
  G.diff = (opts && opts.diff) || "normal";
  G.world = new World(G.seed);
  G.world.ensureAll();
  G.mode = "play";
  G.auto = defaultAuto();
  G.zones = [];
  G.loreSeen = [];
  for (const l in LINES) G.tiers[l] = LINES[l].first;
  G.res = { gold: 400, wood: 350, stone: 120, oil: 0, aether: 0 };
  const hall = placeBuilding("hall", -2, -2, 0, { built: 1 });
  hall.hp = hall.maxHp;
  for (let i = 0; i < 5; i++) spawnUnit("worker", 0, 0, (-1.5 + i * 0.9) * TILE, 3.2 * TILE);
  spawnHero("warden", 3.5 * TILE, 3 * TILE);
  initPhases();
  recountSupply();
  updateFog();
  codex(ERA_LINES[0], "era");
  emit("newGame");
}

export function codex(text, kind) {
  if (!text) return;
  G.codex.push({ t: G.time, text, kind: kind || "", era: G.era });
  emit("codex", text, kind);
}

/* the Codex fills itself from what happens */
on("era", (e) => codex(ERA_LINES[e], "era"));
on("phase", (n, line) => codex(line, "phase"));
on("baseFell", (b, loot, line) => codex(line, "fall"));
on("built", (b) => {
  if (b.team === 0 && b.type === "beacon") { G.beaconLit = true; codex(BEACON_LINE, "beacon"); emit("beacon"); }
});
on("complete", () => { for (let i = 1; i < EPILOGUE.length; i++) codex(EPILOGUE[i], "end"); });

/* ---------------- the tick ---------------- */
export function tick() {
  const dt = TICK;
  G.tick++; G.time += dt; G.stats.playtime += dt;
  const units = G.units;
  for (let i = 0; i < units.length; i++) { const u = units[i]; u.px = u.x; u.py = u.y; }
  rebuildGrid();

  let n = 0;
  while (pathQ.length && n < PATHS_PER_TICK) { const u = G.ents.get(pathQ.shift()); if (u && !u.dead && u.waitPath) { solvePath(u); n++; } }

  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (u.dead) continue;
    if (u.expire && G.time > u.expire) { kill(u, null); continue; }
    if ((u.hero || u.manual || u.dash) && updateHero(u, dt)) continue;
    updateUnit(u, dt);
  }
  crowd();
  for (let i = 0; i < G.blds.length; i++) if (!G.blds[i].dead) updateBuilding(G.blds[i], dt);
  updateProjectiles(dt);
  updateZones();
  if (G.tick % 10 === 0) { updateEnemy(dt * 10); relics(); }
  updateAuto();
  if (G.tick % 2 === 0) updateFog();
  if (G.tick % 10 === 0) sweep();
  if (G.tick % 300 === 0) sample();   // the ledger's income history, every half minute
}

/** Bodies push each other apart, a little each tick; the one standing still gives way. */
function crowd() {
  for (const u of G.units) {
    if (u.dead || u.hidden || u.turret) continue;
    const air = u.move === "air";
    near(u.x, u.y, 40, (o) => {
      if (o.kind !== "unit" || o.id <= u.id || o.dead || o.hidden || (o.move === "air") !== air) return;
      const dx = o.x - u.x, dy = o.y - u.y, d = Math.hypot(dx, dy), min = (u.r + o.r) * (air ? 0.9 : 0.8);
      if (d >= min) return;
      const push = (min - d) * 0.5, nx = d > 0.01 ? dx / d : Math.random() - 0.5, ny = d > 0.01 ? dy / d : Math.random() - 0.5;
      // whoever is busy keeps going; whoever is idle steps aside
      const ku = u.moving && !o.moving ? 0.2 : !u.moving && o.moving ? 0.8 : 0.5;
      if (!u.turret && !(u.manual && u.moving)) tryMove(u, u.x - nx * push * ku * 2, u.y - ny * push * ku * 2);
      if (!o.turret) tryMove(o, o.x + nx * push * (1 - ku) * 2, o.y + ny * push * (1 - ku) * 2);
    });
  }
}

/** A ruin gives up what it holds to whoever walks into it. */
function relics() {
  for (const n of G.world.nodes.values()) {
    if (n.type !== "relic") continue;
    // the first time a far ruin is seen, the things that live round it are there too
    if (!n.camped && explored(n.tx, n.ty)) { n.camped = 1; camp(n); }
    if (n.guards && n.guards.some((id) => { const g = G.ents.get(id); return g && !g.dead; })) continue;
    let finder = null;
    near(n.x, n.y, 3 * TILE, (e) => { if (!finder && e.kind === "unit" && e.team === 0 && !e.dead && Math.hypot(e.x - n.x, e.y - n.y) < 2.6 * TILE) finder = e; });
    if (!finder) continue;
    G.world.removeNode(n);
    const k = eraMul(G.era);
    const reward = { gold: Math.round(120 * k), wood: Math.round(80 * k), stone: Math.round(60 * k) };
    for (const r in reward) G.res[r] += reward[r];
    if (finder.hero) emit("xp", finder, 60 * (1 + G.era));
    const left = RUIN_FRAGMENTS.map((t, i) => i).filter((i) => G.loreSeen.indexOf(i) < 0);
    let text = null;
    if (left.length) { const i = left[Math.floor(Math.random() * left.length)]; G.loreSeen.push(i); text = RUIN_FRAGMENTS[i]; }
    emit("relic", n, finder, reward, text);
    if (text) codex(text, "ruin");
  }
}

function camp(n) {
  const d = Math.hypot(n.tx, n.ty);
  if (d < 24) return;
  const tier = Math.max(0, Math.min(9, G.era - (d < 70 ? 1 : 0) + (d > 220 ? 1 : 0)));
  const count = 2 + Math.floor(Math.min(d, 320) / 90) + (Math.random() < 0.4 ? 1 : 0);
  n.guards = [];
  for (let i = 0; i < count; i++) {
    const a = i / count * 6.28 + Math.random(), r = (2.2 + Math.random() * 1.5) * TILE;
    let x = n.x + Math.cos(a) * r, y = n.y + Math.sin(a) * r;
    const o = G.world.nearestOpen(Math.floor(x / TILE), Math.floor(y / TILE), "land", 4);
    if (!o) continue;
    const u = spawnUnit("beast", tier, 2, (o.tx + 0.5) * TILE, (o.ty + 0.5) * TILE, { boost: 1 + Math.min(0.6, d / 600) });
    u.hp = u.maxHp;
    setOrder(u, { t: "guard", x: n.x, y: n.y });
    n.guards.push(u.id);
  }
  emit("camp", n);
}

/** The ledger's income history: cumulative gathering by resource, every half minute, for two hours. */
function sample() {
  const H = G.history || (G.history = []);
  const rec = { t: Math.round(G.time) };
  for (const r of RES) rec[r] = Math.round((G.stats.byRes || {})[r] || 0);
  H.push(rec);
  if (H.length > 241) H.shift();
}

function sweep() {
  let changed = false;
  for (const e of G.units) if (e.dead) { G.ents.delete(e.id); changed = true; }
  for (const e of G.blds) if (e.dead) { G.ents.delete(e.id); changed = true; }
  if (changed) {
    G.units = G.units.filter((e) => !e.dead);
    G.blds = G.blds.filter((e) => !e.dead);
    G.sel = G.sel.filter((id) => G.ents.has(id));
    for (let i = 0; i < G.groups.length; i++) G.groups[i] = G.groups[i].filter((id) => G.ents.has(id));
  }
  recountSupply();
  if (!G.over && !G.blds.some((b) => !b.dead && b.team === 0) && !G.units.some((u) => !u.dead && u.team === 0 && u.line === "worker")) { G.over = true; emit("defeat"); }
}

export { manual, ERAS };
