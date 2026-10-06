/* entities.js — making things, measuring them, hurting them, and taking them away.
 *
 * A unit and a building are plain objects in G.ents. Their stats are worked
 * out once — when they appear, and again when a research changes them — and
 * kept on the object as `st`, so the hot loop reads numbers, not formulas.
 *
 * The spatial grid is rebuilt every tick. It is the only way anything finds
 * anything else: targets, crowding, splash, auras. */

import { G, emit } from "./state.js";
import { RANKS, RANK_BONUS } from "./data.js";
import { TILE, LINES, TECH_CATS, ATK_PER_LEVEL, ARM_PER_LEVEL, lineStats, BUILDINGS, bldHp, bldArmor, heroStats, HEROES, supplyMax, DIFFICULTY, enemyBoost, RES } from "./data.js";

/* ---------------- research lookups ---------------- */
const ATK_CAT = {}, ARM_CAT = {};
for (const c in TECH_CATS) {
  const t = TECH_CATS[c];
  if (!t.lines) continue;
  for (const l of t.lines) { if (t.kind === "atk") ATK_CAT[l] = c; if (t.kind === "arm") ARM_CAT[l] = c; }
}
export const lvl = (cat) => G.tech[cat] || 0;
export const atkCatOf = (line) => ATK_CAT[line];
export const armCatOf = (line) => ARM_CAT[line];

const RADIUS = { inf: 9, mnt: 13, sie: 14, nav: 17, air: 14 };

/* ---------------- stats ---------------- */
export function refreshUnit(u) {
  let s;
  if (u.hero) {
    u.tier = G.era;   // a champion's gear keeps up with the era by itself
    s = Object.assign(heroStats(u.hero, u.lvl || 1, G.era), { shot: HEROES[u.hero].shot || "", hitsAir: true, minRange: 0, splash: 0, mech: false, air: false, naval: false });
    s.atk *= 1 + ATK_PER_LEVEL * 0.5 * lvl("inf_atk");
  } else {
    s = lineStats(u.line, u.tier);
    if (u.team === 0) {
      if (ATK_CAT[u.line]) s.atk *= 1 + ATK_PER_LEVEL * lvl(ATK_CAT[u.line]);
      s.sight += lvl("optics") >= 2 ? 1 : 0;
    } else {
      const k = u.boost || 1;
      s.atk *= k; s.hp = Math.round(s.hp * k * DIFFICULTY[G.diff].hp);
    }
  }
  if (u.rank) { const k = 1 + RANK_BONUS * u.rank; s.atk *= k; s.hp = Math.round(s.hp * k); }
  s.dmgTaken = 1;
  if (u.team === 0 && !u.hero && ARM_CAT[u.line]) s.dmgTaken = Math.max(0.4, 1 - ARM_PER_LEVEL * lvl(ARM_CAT[u.line]));
  if (u.hero) s.dmgTaken = Math.max(0.5, 1 - ARM_PER_LEVEL * 0.5 * lvl("inf_arm"));
  const ratio = u.maxHp ? u.hp / u.maxHp : 1;
  u.st = s;
  u.maxHp = s.hp;
  u.hp = Math.max(1, Math.min(s.hp, Math.round(s.hp * ratio)));
}

export function refreshBuilding(b) {
  const d = BUILDINGS[b.type];
  const k = b.team === 0 ? 1 + 0.08 * lvl("masonry") : (b.boost || 1) * DIFFICULTY[G.diff].hp;
  const ratio = b.maxHp ? b.hp / b.maxHp : 0.1;
  b.maxHp = Math.round(bldHp(b.type, b.level) * k);
  b.hp = Math.max(1, Math.round(b.maxHp * ratio));
  b.armor = bldArmor(b.type, b.level);
  b.dmgTaken = b.team === 0 ? Math.max(0.5, 1 - 0.02 * lvl("masonry")) : 1;
  b.sight = d.sight + Math.floor(b.level / 3) + (b.team === 0 ? lvl("optics") : 0);
  if (d.attack) {
    const towerK = b.team === 0 ? 1 + ATK_PER_LEVEL * lvl("tower") : (b.boost || 1);
    b.atk = d.attack.atk * Math.pow(1.42, b.level - 1) * towerK;
    b.range = d.attack.range + 0.15 * (b.level - 1) + (b.team === 0 ? 0.3 * lvl("optics") : 0);
    b.cdMax = d.attack.cd;
    b.hitsAir = b.level - 1 >= d.hitsAirFrom;
  }
}

/* ---------------- making ---------------- */
export function spawnUnit(line, tier, team, x, y, extra) {
  const L = LINES[line];
  const u = {
    id: G.nextId++, kind: "unit", line, tier, team, hero: null, x, y, px: x, py: y, r: RADIUS[L.cls], cls: L.cls, move: L.move,
    hp: 1, maxHp: 0, st: null, order: { t: "idle" }, oq: [], path: null, pi: 0, goal: null, want: null, waitPath: false, partial: false,
    tgt: 0, cd: Math.random() * 0.5, face: Math.random() * 6.28, anim: Math.random() * 10, moving: false, atkAnim: 0,
    carry: null, gs: "", gt: 0, stance: "aggr", manual: false, buffs: {}, stun: 0, idleT: 0, lastHit: -99, hidden: false,
    base: 0, scan: Math.random() * 0.5, stuck: 0, lastPos: 0, home: null, xp: 0, lvl: 1, dead: false, boost: 1, sel: false
  };
  if (extra) Object.assign(u, extra);
  refreshUnit(u);
  u.hp = u.maxHp;
  G.ents.set(u.id, u); G.units.push(u);
  return u;
}

export function spawnHero(id, x, y) {
  const u = spawnUnit("melee", G.era, 0, x, y, { hero: id, lvl: 1, r: 11, cls: "inf" });
  const h = G.heroes[id] || (G.heroes[id] = { lvl: 1, xp: 0, mode: "auto" });
  u.lvl = h.lvl; u.xp = h.xp; u.skcd = [0, 0, 0, 0]; u.manual = h.mode === "manual";
  refreshUnit(u); u.hp = u.maxHp;
  h.uid = u.id; h.dead = false;
  return u;
}

export function placeBuilding(type, tx, ty, team, extra) {
  const d = BUILDINGS[type];
  const b = {
    id: G.nextId++, kind: "bld", type, team, tx, ty, w: d.w, h: d.h, x: (tx + d.w / 2) * TILE, y: (ty + d.h / 2) * TILE,
    r: Math.max(d.w, d.h) * TILE * 0.5, level: 1, hp: 1, maxHp: 0, built: 0, q: [], qt: 0, loop: false, rally: null,
    cd: 0, tgt: 0, base: 0, node: 0, dead: false, lastHit: -99, bThis: 0, sel: false, boost: 1, seen: false, prod: 0
  };
  if (extra) Object.assign(b, extra);
  refreshBuilding(b);
  if (b.built >= 1) b.hp = b.maxHp; else b.hp = Math.max(1, Math.round(b.maxHp * 0.1));
  G.world.occupyArea(tx, ty, d.w, d.h, b.id);
  G.ents.set(b.id, b); G.blds.push(b);
  // anything standing where the walls go steps aside
  for (const u of G.units) {
    if (u.dead || u.move === "air") continue;
    const utx = Math.floor(u.x / TILE), uty = Math.floor(u.y / TILE);
    if (utx >= tx && uty >= ty && utx < tx + d.w && uty < ty + d.h) nudgeOut(u);
  }
  return b;
}

export function nudgeOut(u) {
  const o = G.world.nearestOpen(Math.floor(u.x / TILE), Math.floor(u.y / TILE), u.move, 10);
  if (o) { u.x = u.px = (o.tx + 0.5) * TILE; u.y = u.py = (o.ty + 0.5) * TILE; }
}

/* ---------------- measuring ---------------- */
/** Distance between two things' edges, in world pixels. */
export function gap(a, b) {
  if (b.kind === "bld" || b.kind === "node") return Math.max(0, rectDist(a.x, a.y, b) - (a.r || 0));
  if (a.kind === "bld") return Math.max(0, rectDist(b.x, b.y, a) - (b.r || 0));
  return Math.max(0, Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r);
}
export function rectDist(x, y, b) {
  const x0 = b.tx * TILE, y0 = b.ty * TILE, x1 = x0 + b.w * TILE, y1 = y0 + b.h * TILE;
  const dx = x < x0 ? x0 - x : x > x1 ? x - x1 : 0, dy = y < y0 ? y0 - y : y > y1 ? y - y1 : 0;
  return Math.hypot(dx, dy);
}
export const tileOf = (v) => Math.floor(v / TILE);

/* ---------------- the grid ---------------- */
const CELL = 128;
let grid = new Map();
const gk = (cx, cy) => (cx + 50000) * 100000 + (cy + 50000);
export function rebuildGrid() {
  grid = new Map();
  const add = (k, e) => { let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(e); };
  for (const u of G.units) if (!u.dead && !u.hidden) add(gk(Math.floor(u.x / CELL), Math.floor(u.y / CELL)), u);
  for (const b of G.blds) {
    if (b.dead) continue;
    const x0 = Math.floor(b.tx * TILE / CELL), y0 = Math.floor(b.ty * TILE / CELL), x1 = Math.floor(((b.tx + b.w) * TILE - 1) / CELL), y1 = Math.floor(((b.ty + b.h) * TILE - 1) / CELL);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) add(gk(x, y), b);
  }
}
/** Call fn(e) for everything whose cell is within r of (x, y). fn returning true stops. */
export function near(x, y, r, fn) {
  const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL), y0 = Math.floor((y - r) / CELL), y1 = Math.floor((y + r) / CELL);
  const seenB = x1 > x0 || y1 > y0 ? new Set() : null;
  for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
    const a = grid.get(gk(cx, cy));
    if (!a) continue;
    for (let i = 0; i < a.length; i++) {
      const e = a[i];
      if (e.kind === "bld" && seenB) { if (seenB.has(e.id)) continue; seenB.add(e.id); }
      if (fn(e)) return;
    }
  }
}

/** Is `t` something `a` may fight? */
export function hostile(a, t) {
  // team 2 is the wild: it fights everyone, and everyone may fight it
  return t && !t.dead && t.team !== a.team && !(t.kind === "unit" && t.hidden);
}
export function canHit(st, t) {
  if (t.kind === "unit" && t.st.air) return !!st.hitsAir;
  return true;
}

/** The best target near (x, y) for a fighter with these stats. Units that fight back come first. */
export function findTarget(a, radiusPx, opts) {
  let best = null, bs = 1e18;
  const st = a.st || a;
  near(a.x, a.y, radiusPx + 96, (e) => {
    if (!hostile(a, e) || !canHit(st, e)) return false;
    if (e.kind === "unit" && e.buffs.veil > G.time) return false;
    if (opts && opts.bldOnly && e.kind !== "bld") return false;
    if (st.siegeMeleeOnly && e.kind !== "bld") return false;
    if (a.team === 0 && opts && opts.visibleOnly && !opts.visibleOnly(e)) return false;
    const d = gap(a, e);
    if (d > radiusPx) return false;
    if (st.minRange && d < st.minRange * TILE) return false;
    let score = d;
    if (e.kind === "bld") score += e.type === "wall" ? 900 : BUILDINGS[e.type].attack ? 60 : 400;
    else if (e.line === "worker") score += 120;
    if (e.taunt > G.time) score -= 2000;
    if (score < bs) { bs = score; best = e; }
    return false;
  });
  return best;
}

/* ---------------- hurting ---------------- */
/** The one way anything loses health. Returns the damage done. */
export function damage(t, amount, by, kind) {
  if (!t || t.dead) return 0;
  let armor = t.kind === "bld" ? t.armor : t.st.armor;
  let dmg = Math.max(amount * 0.12, amount - armor);
  dmg *= t.kind === "bld" ? t.dmgTaken : t.st.dmgTaken;
  if (t.kind === "unit") {
    if (t.buffs.bulwark > G.time) dmg *= 0.3;
    if (t.buffs.rally > G.time) dmg *= 0.8;
    if (t.buffs.marked > G.time) dmg *= 1.4;
  }
  if (by && by.st && by.st.vsBld && t.kind === "bld") dmg *= by.st.vsBld;
  else if (by && by.st && by.st.vsBld && t.kind === "unit") dmg *= 0.7;   // siege is for walls; soldiers scatter
  dmg *= 0.88 + Math.random() * 0.12;
  t.hp -= dmg;
  t.lastHit = G.time;
  if (by) t.lastBy = by.id;
  emit("hit", t, dmg, by, kind);
  if (t.hp <= 0) kill(t, by);
  return dmg;
}
export function heal(t, amount, by) {
  if (!t || t.dead || t.hp >= t.maxHp) return 0;
  const h = Math.min(amount, t.maxHp - t.hp);
  t.hp += h;
  emit("healed", t, h, by);
  return h;
}

export function kill(e, by) {
  if (e.dead) return;
  e.dead = true; e.hp = 0;
  if (e.kind === "bld") {
    G.world.freeArea(e.tx, e.ty, e.w, e.h, e.id);
    for (const it of e.q) if (it.k === "unit") G.supply.used -= LINES[it.line].supply;
    for (const k in G.researching) if (G.researching[k] === e.id) delete G.researching[k];
    if (e.node) { const n = G.world.nodes.get(e.node); if (n) { n.building = 0; G.world.occupyArea(n.tx, n.ty, n.w, n.h, n.id); } }
  } else {
    if (e.hero && e.team === 0) {
      const h = G.heroes[e.hero];
      if (h) { h.dead = true; h.uid = 0; h.lvl = e.lvl; h.xp = e.xp; h.diedAt = G.time; }
    }
  }
  if (e.team === 0) G.stats.lost++; else if (by && by.team === 0) G.stats.killed++;
  // a soldier who keeps killing becomes a veteran, and stronger for it
  if (by && by.kind === "unit" && !by.dead && !by.hero && !by.turret && by.team !== e.team) {
    by.kills = (by.kills || 0) + (e.kind === "bld" ? 2 : 1);
    const r = RANKS.filter((k) => by.kills >= k).length;
    if (r > (by.rank || 0)) { by.rank = r; refreshUnit(by); by.hp = Math.min(by.maxHp, by.hp + by.maxHp * 0.25); emit("rank", by); }
  }
  if (by && e.team !== by.team) giveXp(e, by);
  emit("death", e, by);
}

/** Champions near a kill learn from it. */
function giveXp(victim, by) {
  const value = victim.kind === "bld" ? 40 + 10 * victim.level : victim.hero ? 200 : 8 + 4 * (victim.tier || 0) * (LINES[victim.line] ? LINES[victim.line].supply : 1);
  for (const id in G.heroes) {
    const h = G.heroes[id], u = h.uid && G.ents.get(h.uid);
    if (!u || u.dead || u.team !== by.team) continue;
    const d = Math.hypot(u.x - victim.x, u.y - victim.y);
    if (u === by || d < 10 * TILE) emit("xp", u, u === by ? value : value * 0.5);
  }
}

/* ---------------- money ---------------- */
export function canAfford(cost) { for (const r in cost) if ((cost[r] || 0) > G.res[r] + 1e-6) return false; return true; }
export function pay(cost) { if (!canAfford(cost)) return false; for (const r in cost) G.res[r] -= cost[r] || 0; return true; }
export function refund(cost, k) { for (const r in cost) G.res[r] += Math.floor((cost[r] || 0) * (k === undefined ? 1 : k)); }
export function lacking(cost) {
  const out = [];
  for (const r of RES) if ((cost[r] || 0) > G.res[r]) out.push(r);
  return out;
}

/* ---------------- supply ---------------- */
export function recountSupply() {
  let cap = 0, used = 0;
  for (const b of G.blds) {
    if (b.dead || b.team !== 0) continue;
    const d = BUILDINGS[b.type];
    if (b.built >= 1 && d.supply) cap += d.supply + (d.supplyPerLevel || 2) * (b.level - 1);
    if (b.built >= 1 && b.type === "outpost") cap += 4;
    for (const it of b.q) if (it.k === "unit") used += LINES[it.line].supply;
  }
  for (const u of G.units) if (!u.dead && u.team === 0 && !u.hero && !u.free) used += LINES[u.line].supply;
  G.supply.cap = Math.min(cap, supplyMax(G.era));
  G.supply.used = used;
}

/** Player buildings of a type, finished. */
export function own(type) { return G.blds.filter((b) => !b.dead && b.team === 0 && b.type === type && b.built >= 1); }
export function enemyBoostFor(p) { return enemyBoost(p); }
