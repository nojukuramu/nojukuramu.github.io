/* buildings.js — placing, raising, upgrading and running buildings.
 *
 * Every building has one queue. What can go in it — units, research, a level,
 * the next era, a doctrine, a champion — is listed by actions(b), which the
 * command card draws straight from; the queue itself only knows how long each
 * thing takes and what happens when it is done. Costs are paid when a thing
 * is queued and given back in full if it is cancelled, the way the games this
 * follows do it.
 *
 * A building's level is also the era it is drawn in. Level 1 is a hut of
 * sticks; the same building at level 10 is something else entirely. You can
 * never level a building past the era you have reached. */

import { G, emit } from "./state.js";
import {
  TILE, BUILDINGS, LINES, TECH_CATS, ERAS, DOCTRINES, HEROES, HERO_IDS, MAX_ERA,
  bldCost, levelCost, levelTime, maxLevel, techEra, techCost, techTime, refitCost, refitTime, heroCost
} from "./data.js";
import { canAfford, pay, refund, spawnUnit, spawnHero, placeBuilding, refreshUnit, refreshBuilding, recountSupply, findTarget, lvl } from "./entities.js";
import { explored } from "./fog.js";
import { fire } from "./combat.js";
import { setOrder, moveGroup } from "./units.js";
import { isWater } from "./world.js";

/* ---------------- placement ---------------- */
export function territoryOf(b) { return (BUILDINGS[b.type].territory || 0) + 2 * (b.level - 1); }
export function inTerritory(tx, ty, w, h, team) {
  const cx = (tx + w / 2) * TILE, cy = (ty + h / 2) * TILE;
  for (const b of G.blds) {
    if (b.dead || b.team !== (team || 0) || !BUILDINGS[b.type].territory) continue;
    if (Math.hypot(b.x - cx, b.y - cy) <= territoryOf(b) * TILE) return true;
  }
  return false;
}
/** Snap a building that must stand on a node onto that node. */
export function snap(type, tx, ty) {
  const d = BUILDINGS[type];
  if (!d.onNode) return { tx, ty };
  for (const n of G.world.nodes.values()) {
    if (n.type !== d.onNode) continue;
    if (tx >= n.tx - 1 && ty >= n.ty - 1 && tx <= n.tx + n.w && ty <= n.ty + n.h) return { tx: n.tx, ty: n.ty, node: n };
  }
  return { tx, ty };
}
export function canPlace(type, tx, ty, team) {
  team = team || 0;
  const d = BUILDINGS[type], W = G.world;
  if (team === 0) {
    if (d.first > G.era) return { ok: false, why: "Needs the " + ERAS[d.first].age };
    if (d.unique && G.blds.some((b) => !b.dead && b.team === 0 && b.type === type)) return { ok: false, why: "You can only have one" };
  }
  if (d.onNode) {
    const s = snap(type, tx, ty);
    if (!s.node) return { ok: false, why: "Must stand on a " + (d.onNode === "oil" ? "seep" : "shard") };
    if (s.node.building) return { ok: false, why: "Already tapped" };
    if (team === 0 && !explored(s.node.tx, s.node.ty)) return { ok: false, why: "Not explored" };
    return { ok: true, tx: s.tx, ty: s.ty, node: s.node };
  }
  for (let j = 0; j < d.h; j++) for (let i = 0; i < d.w; i++) {
    if (!W.buildable(tx + i, ty + j)) return { ok: false, why: "Blocked" };
    if (team === 0 && !explored(tx + i, ty + j)) return { ok: false, why: "Not explored" };
  }
  // nothing big may land on top of somebody
  for (const u of G.units) {
    if (u.dead || u.team === team || u.move === "air") continue;
    const ux = Math.floor(u.x / TILE), uy = Math.floor(u.y / TILE);
    if (ux >= tx && uy >= ty && ux < tx + d.w && uy < ty + d.h) return { ok: false, why: "Enemies in the way" };
  }
  if (d.coastal) {
    let water = 0;
    for (let j = -1; j <= d.h; j++) for (let i = -1; i <= d.w; i++) {
      if (i >= 0 && j >= 0 && i < d.w && j < d.h) continue;
      if (isWater(W.terrain(tx + i, ty + j))) water++;
    }
    if (water < 2) return { ok: false, why: "Must touch the water" };
  }
  if (team === 0 && !d.anywhere && !inTerritory(tx, ty, d.w, d.h, 0)) return { ok: false, why: "Outside your borders" };
  return { ok: true, tx, ty };
}

/** The player lays a foundation and sends workers to raise it. */
export function startBuilding(type, tx, ty, workers, queue) {
  const c = canPlace(type, tx, ty, 0);
  if (!c.ok) { emit("toast", c.why, "bad"); return null; }
  const cost = bldCost(type);
  if (!pay(cost)) { emit("toast", "Not enough resources", "bad"); return null; }
  const b = placeBuilding(type, c.tx, c.ty, 0, { built: 0, cost });
  if (c.node) { b.node = c.node.id; c.node.building = b.id; }
  for (const u of workers || []) setOrder(u, { t: "build", id: b.id }, queue);
  emit("placed", b);
  return b;
}
/** A line of wall from one tile to another, one stone at a time, as far as the money goes. */
export function wallLine(tx0, ty0, tx1, ty1, workers) {
  const pts = [], dx = Math.abs(tx1 - tx0), dy = Math.abs(ty1 - ty0), n = Math.max(dx, dy);
  for (let i = 0; i <= n; i++) pts.push({ tx: Math.round(tx0 + (tx1 - tx0) * i / (n || 1)), ty: Math.round(ty0 + (ty1 - ty0) * i / (n || 1)) });
  let first = true;
  for (const p of pts) {
    if (!canPlace("wall", p.tx, p.ty, 0).ok || !canAfford(bldCost("wall"))) continue;
    const b = startBuilding("wall", p.tx, p.ty, [], false);
    if (b) { for (const u of workers) setOrder(u, { t: "build", id: b.id }, !first); first = false; }
  }
}

export function completeBuilding(b) {
  b.built = 1;
  if (b.team === 0) { G.stats.built++; recountSupply(); }
  emit("built", b);
}

/* ---------------- what a building offers ---------------- */
const item = (o) => Object.assign({ ok: true, why: "" }, o);
export function nextTechLevel(cat) { return lvl(cat) + 1; }

export function actions(b) {
  const out = [];
  if (b.team !== 0 || b.dead) return out;
  const d = BUILDINGS[b.type];
  if (b.built < 1) { out.push(item({ id: "cancelBuild", kind: "cancel", label: "Cancel", icon: "close", hot: "Escape" })); return out; }
  // units
  for (const line of d.trains || []) {
    const L = LINES[line];
    if (L.first > G.era) continue;
    const tier = tierOf(line);
    const cost = L.cost(tier);
    out.push(item({ id: "train:" + line, kind: "unit", line, tier, label: L.names[tier], cost: clean(cost), time: L.time, ok: canAfford(cost) && G.supply.used + L.supply <= G.supply.cap,
      why: G.supply.used + L.supply > G.supply.cap ? "Needs supply: build houses" : canAfford(cost) ? "" : "Not enough resources", line2: L.blurb }));
  }
  // refits: the next version of each line this building trains
  for (const line of d.trains || []) {
    const L = LINES[line];
    const cur = tierOf(line);
    if (L.first > G.era || cur >= G.era) continue;
    const e = cur + 1, key = "refit:" + line;
    const cost = refitCost(line, e);
    out.push(item({ id: key, kind: "refit", line, tier: e, label: "Train " + L.names[e] + "s", cost, time: refitTime(line, e), ok: canAfford(cost) && !G.researching[key], why: G.researching[key] ? "Already underway" : canAfford(cost) ? "" : "Not enough resources", line2: "Every " + L.names[cur] + " you have becomes one." }));
  }
  // research
  for (const cat in TECH_CATS) {
    const c = TECH_CATS[cat];
    if (c.at !== b.type) continue;
    if ((c.first || 0) > G.era) continue;
    const L = nextTechLevel(cat), key = "tech:" + cat;
    if (L > c.max) continue;
    const era = techEra(cat, L), cost = techCost(cat, L);
    const ok = era <= G.era && canAfford(cost) && !G.researching[key];
    out.push(item({ id: key, kind: "tech", cat, level: L, label: c.name + " " + roman(L), icon: c.icon, cost, time: techTime(cat, L), ok,
      why: G.researching[key] ? "Already underway" : era > G.era ? "Needs the " + ERAS[era].age : canAfford(cost) ? "" : "Not enough resources", line2: techLine(cat) }));
  }
  // champions
  if (b.type === "altar") {
    for (const id of HERO_IDS) {
      const h = G.heroes[id], key = "hero:" + id, H = HEROES[id];
      if (h && !h.dead && h.uid) continue;
      const revive = !!(h && h.dead);
      const cost = revive ? half(heroCost(G.era)) : heroCost(G.era);
      out.push(item({ id: key, kind: "hero", hero: id, label: (revive ? "Revive " : "Call ") + H.name, cost, time: revive ? 30 + 3 * (h.lvl || 1) : 45, ok: canAfford(cost) && !G.researching[key],
        why: G.researching[key] ? "Already underway" : canAfford(cost) ? "" : "Not enough resources", line2: H.role + ". " + H.blurb }));
    }
  }
  // doctrines
  if (b.type === "academy") {
    for (const id in DOCTRINES) {
      if (G.doctrines[id]) continue;
      const D = DOCTRINES[id], key = "doc:" + id;
      out.push(item({ id: key, kind: "doc", doc: id, label: D.name, icon: D.icon, cost: D.cost, time: D.time, ok: D.era <= G.era && canAfford(D.cost) && !G.researching[key],
        why: G.researching[key] ? "Already underway" : D.era > G.era ? "Needs the " + ERAS[D.era].age : canAfford(D.cost) ? "" : "Not enough resources", line2: D.line }));
    }
  }
  // the next era
  if (b.type === "hall" && G.era < MAX_ERA) {
    const E = ERAS[G.era + 1], key = "era";
    const need = maxLevel(G.era);
    const why = G.researching[key] ? "Already underway" : b.level < need ? "Raise the " + d.names[b.level - 1] + " to level " + need + " first" :
      G.stats.phases < E.adv.phases ? "Clear " + E.adv.phases + " phases first (" + G.stats.phases + " so far)" : canAfford(E.adv.cost) ? "" : "Not enough resources";
    out.push(item({ id: key, kind: "era", label: E.age, icon: "era", cost: E.adv.cost, time: E.adv.time, ok: !why, why, line2: "Leave the " + ERAS[G.era].age + " behind." }));
  }
  // the building's own level
  if (!d.noLevel && b.level < 10) {
    const L = b.level + 1, cost = levelCost(b.type, L), cap = maxLevel(G.era);
    const busy = b.q.some((it) => it.k === "level");
    const why = busy ? "Already underway" : L > cap ? "Needs the " + ERAS[L - 1].age : canAfford(cost) ? "" : "Not enough resources";
    out.push(item({ id: "level", kind: "level", label: "Raise to " + (d.names[L - 1] || d.names[d.names.length - 1]), icon: "up", cost, time: levelTime(b.type, L), ok: !why, why, line2: "Level " + L + ": tougher" + (d.attack ? ", deadlier" : "") + (d.territory ? ", wider borders" : "") + (d.supply ? ", more supply" : "") + (d.trains ? ", faster" : "") + "." }));
  }
  if (d.trains && d.trains.length) out.push(item({ id: "loop", kind: "toggle", label: b.loop ? "Repeat: on" : "Repeat: off", icon: "repeat", on: b.loop, line2: "Keep training the last unit while you can pay for it." }));
  if (d.trains && d.trains.length || d.drop) out.push(item({ id: "rally", kind: "rally", label: "Rally point", icon: "flag", line2: "Where new units go. On a resource, workers start gathering it." }));
  return out;
}
function techLine(cat) {
  const c = TECH_CATS[cat];
  switch (c.kind) {
    case "atk": return "+10% damage for " + c.lines.filter((l) => l !== "worker").map((l) => LINES[l].names[Math.max(LINES[l].first, tierOf(l))] || l).join(", ") + ".";
    case "arm": return "Takes 2.5% less damage, each level.";
    case "tower": return "+10% tower and fort damage.";
    case "gather": return "+12% " + c.res + " carried each trip.";
    case "haul": return "Workers walk faster and carry more.";
    case "masonry": return "Buildings are tougher.";
    case "optics": return "Buildings see further; towers reach further.";
  }
  return "";
}
const half = (c) => { const o = {}; for (const r in c) o[r] = Math.round(c[r] / 2); return o; };
const clean = (c) => { const o = {}; for (const r in c) if (c[r]) o[r] = Math.round(c[r]); return o; };
export function roman(n) {
  const R = [["X", 10], ["IX", 9], ["V", 5], ["IV", 4], ["I", 1]];
  let s = ""; for (const [k, v] of R) while (n >= v) { s += k; n -= v; }
  return s;
}
export function tierOf(line) {
  const L = LINES[line];
  return Math.min(G.era, Math.max(L.first, G.tiers[line] !== undefined ? G.tiers[line] : L.first));
}

/* ---------------- doing it ---------------- */
export function act(b, id) {
  const a = actions(b).find((x) => x.id === id);
  if (!a) return false;
  if (a.kind === "cancel") { cancelBuild(b); return true; }
  if (a.kind === "toggle") { b.loop = !b.loop; emit("changed", b); return true; }
  if (a.kind === "rally") { emit("wantRally", b); return true; }
  if (!a.ok) { emit("toast", a.why || "Not now", "bad"); return false; }
  if (!pay(a.cost)) { emit("toast", "Not enough resources", "bad"); return false; }
  const it = { k: a.kind, cost: a.cost, time: a.time };
  if (a.kind === "unit") { it.line = a.line; G.supply.used += LINES[a.line].supply; }
  if (a.kind === "tech") { it.cat = a.cat; it.L = a.level; G.researching[id] = b.id; }
  if (a.kind === "refit") { it.line = a.line; it.e = a.tier; G.researching[id] = b.id; }
  if (a.kind === "hero") { it.hero = a.hero; G.researching[id] = b.id; }
  if (a.kind === "doc") { it.doc = a.doc; G.researching[id] = b.id; }
  if (a.kind === "era") G.researching.era = b.id;
  it.key = id;
  b.q.push(it);
  if (b.q.length > 8) { cancel(b, b.q.length - 1); emit("toast", "The queue is full", "bad"); return false; }
  emit("queued", b, it);
  return true;
}
export function cancel(b, i) {
  const it = b.q[i];
  if (!it) return;
  b.q.splice(i, 1);
  if (i === 0) b.qt = 0;
  refund(it.cost);
  if (it.k === "unit") G.supply.used -= LINES[it.line].supply;
  if (it.key && G.researching[it.key] === b.id) delete G.researching[it.key];
  emit("changed", b);
}
export function cancelBuild(b) {
  if (b.built >= 1) return;
  refund(b.cost || bldCost(b.type), 0.75);
  b.dead = true;
  G.world.freeArea(b.tx, b.ty, b.w, b.h, b.id);
  if (b.node) { const n = G.world.nodes.get(b.node); if (n) { n.building = 0; G.world.occupyArea(n.tx, n.ty, n.w, n.h, n.id); } }
  emit("death", b, null);
}

/* ---------------- the tick ---------------- */
export function updateBuilding(b, dt) {
  b.bThis = 0;
  if (b.built < 1) return;
  const d = BUILDINGS[b.type];
  // production
  if (b.q.length && b.team === 0) {
    const it = b.q[0];
    b.qt += dt * (1 + 0.08 * (b.level - 1));
    if (b.qt >= it.time) { b.q.shift(); b.qt = 0; finish(b, it); }
  }
  if (d.produces && b.team === 0) {
    for (const r in d.produces) {
      const k = d.produces[r] * (1 + 0.35 * (b.level - 1)) * dt;
      G.res[r] += k; b.prod = (b.prod || 0) + k;
    }
  }
  // towers
  if (d.attack) {
    b.cd -= dt;
    if (b.cd <= 0) {
      let t = b.tgt && G.ents.get(b.tgt);
      const rangePx = b.range * TILE;
      const st = { hitsAir: b.hitsAir, shot: d.shots[Math.min(9, b.level - 1)] };
      if (!t || t.dead || dist(b, t) > rangePx + t.r || (t.st && t.st.air && !b.hitsAir)) { t = findTarget({ x: b.x, y: b.y, team: b.team, r: b.r * 0.5, st }, rangePx); b.tgt = t ? t.id : 0; }
      if (t) {
        const shot = st.shot;
        fire({ x: b.x, y: b.y - 20, team: b.team, id: b.id, kind: "bld", level: b.level, st: { shot, splash: shot === "shell" || shot === "missile" ? 0.7 : 0 }, dead: false }, t, b.atk);
        b.cd = b.cdMax; b.fired = G.time;
      } else b.cd = 0.4;
    }
  }
}
function dist(b, t) { return Math.hypot(b.x - t.x, b.y - t.y) - b.r * 0.5; }

function finish(b, it) {
  if (it.key && G.researching[it.key] === b.id) delete G.researching[it.key];
  switch (it.k) {
    case "unit": {
      G.supply.used -= LINES[it.line].supply;
      const u = trainOut(b, it.line);
      if (u && b.loop) {
        const L = LINES[it.line], cost = L.cost(tierOf(it.line));
        if (canAfford(cost) && G.supply.used + L.supply <= G.supply.cap) act(b, "train:" + it.line);
      }
      break;
    }
    case "tech": G.tech[it.cat] = it.L; refreshAll(); emit("researched", it.cat, it.L); break;
    case "refit": {
      G.tiers[it.line] = it.e;
      for (const u of G.units) if (!u.dead && u.team === 0 && u.line === it.line && !u.hero && u.tier < it.e) { u.tier = it.e; refreshUnit(u); }
      emit("refit", it.line, it.e);
      break;
    }
    case "level": b.level++; refreshBuilding(b); b.hp = Math.min(b.maxHp, b.hp + b.maxHp * 0.25); recountSupply(); emit("levelup", b); break;
    case "era": advanceEra(); break;
    case "doc": G.doctrines[it.doc] = true; emit("doctrine", it.doc); break;
    case "hero": {
      const p = exitPoint(b, "land");
      const u = spawnHero(it.hero, p.x, p.y);
      emit("hero", u, !!(G.heroes[it.hero].diedAt));
      if (b.rally) setOrder(u, { t: "move", x: b.rally.x, y: b.rally.y });
      break;
    }
  }
  emit("finished", b, it);
}
export function advanceEra() {
  G.era = Math.min(MAX_ERA, G.era + 1);
  for (const u of G.units) if (!u.dead && u.hero && u.team === 0) refreshUnit(u);
  recountSupply();
  emit("era", G.era);
}
export function refreshAll() {
  for (const u of G.units) if (!u.dead && u.team === 0 && !u.turret) refreshUnit(u);
  for (const b of G.blds) if (!b.dead && b.team === 0) refreshBuilding(b);
}

/** A free place beside a building for something new to stand. */
export function exitPoint(b, move) {
  const W = G.world;
  const cands = [];
  for (let i = -1; i <= b.w; i++) { cands.push([b.tx + i, b.ty + b.h]); cands.push([b.tx + i, b.ty - 1]); }
  for (let j = 0; j < b.h; j++) { cands.push([b.tx - 1, b.ty + j]); cands.push([b.tx + b.w, b.ty + j]); }
  for (const [tx, ty] of cands) if (W.passable(tx, ty, move)) return { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
  const o = W.nearestOpen(b.tx + (b.w >> 1), b.ty + b.h, move, 10);
  return o ? { x: (o.tx + 0.5) * TILE, y: (o.ty + 0.5) * TILE } : { x: b.x, y: b.y + b.h * TILE * 0.6 };
}
function trainOut(b, line) {
  const L = LINES[line];
  const p = exitPoint(b, L.move);
  const u = spawnUnit(line, tierOf(line), 0, p.x + (Math.random() - 0.5) * 6, p.y + (Math.random() - 0.5) * 6);
  G.supply.used += L.supply;
  emit("trained", u, b);
  sendToRally(u, b);
  return u;
}
export function sendToRally(u, b) {
  const r = b.rally;
  if (u.line === "worker") {
    if (r && r.node) { const n = G.world.nodes.get(r.node); if (n) { setOrder(u, { t: "gather", res: n.type, node: n.id }); return; } }
    if (r && r.tree) { setOrder(u, { t: "gather", res: "wood", tx: r.tree.tx, ty: r.tree.ty }); return; }
    if (r) setOrder(u, { t: "move", x: r.x, y: r.y });
    return;
  }
  const m = G.doctrines.logistics && G.auto && G.auto.muster;
  if (r) moveGroup([u], r.x, r.y, "amove");
  else if (m) moveGroup([u], m.x, m.y, "amove");
}
