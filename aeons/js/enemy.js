/* enemy.js — phases, and the bases that come with them.
 *
 * There is no last enemy base. A phase is one or more bases somewhere in the
 * mist; when every one of them has fallen the phase is cleared, and after a
 * short breath the next one begins — with more bases, or stronger ones, and
 * sometimes with the border pushed outwards into land nobody has seen. The
 * map has no edge but the one the phases have reached so far.
 *
 * The enemy does not gather. A base has a budget that grows with time and
 * with the phase, and spends it on soldiers from its dens: a garrison that
 * guards it, and waves that walk to the nearest thing of yours. It fights in
 * the era you could have reached by now (data.js enemyEra), so lingering in
 * one era is not safe for long. Its buildings are your buildings, in its
 * colours — that is deliberate, and nothing ever says why. */

import { G, emit } from "./state.js";
import { TILE, CHUNK, LINES, BUILDINGS, DIFFICULTY, ERAS, enemyEra, enemyBoost, eraMul, MAX_ERA } from "./data.js";
import { rng, hash, pick } from "./rng.js";
import { placeBuilding, spawnUnit, kill, rectDist } from "./entities.js";
import { setOrder, moveGroup } from "./units.js";
import { exitPoint } from "./buildings.js";
import { isWalk } from "./world.js";
import { PHASE_LINES, FALL_LINES, MIRROR_LINE, EPILOGUE } from "./lore.js";

let nextBase = 1;

export function initPhases() {
  G.phase = { n: 0, bases: [], startedAt: 0, nextAt: 180, cleared: true, expanded: null, mirror: false };
  nextBase = 1;
}

/* ---------------- a new phase ---------------- */
export function startPhase() {
  const P = G.phase;
  P.n++;
  P.cleared = false; P.startedAt = G.time; P.bases = []; P.expanded = null;
  const r = rng(hash(G.seed, P.n, 99));
  const mirror = G.beaconLit && !P.mirror && !G.complete;
  // the map grows
  if (P.n > 1 && (r() < 0.55 || P.n % 4 === 0 || mirror)) {
    const sides = ["n", "s", "e", "w"], k = 1 + (r() < 0.35 ? 1 : 0), grew = [];
    for (let i = 0; i < k; i++) {
      const side = pick(r, sides), by = 32 + Math.floor(r() * 3) * 16;
      G.world.expand(side, by);
      grew.push(side);
    }
    G.world.ensureAll();
    P.expanded = grew;
    emit("expanded", grew);
  }
  let count = 1;
  if (P.n > 2 && r() < Math.min(0.55, 0.06 * P.n)) count++;
  if (P.n > 9 && r() < 0.3) count++;
  if (P.n > 18 && r() < 0.3) count++;
  if (mirror) count = 1;
  for (let i = 0; i < count; i++) {
    const site = findSite(r, P.expanded);
    if (!site) continue;
    const base = buildBase(site.tx, site.ty, P.n, r, mirror);
    P.bases.push(base.id);
  }
  if (!P.bases.length) {   // nowhere fits: the land opens until somewhere does
    G.world.expand(pick(r, ["n", "s", "e", "w"]), 48); G.world.ensureAll();
    const site = findSite(r, null);
    if (site) P.bases.push(buildBase(site.tx, site.ty, P.n, r, mirror).id);
  }
  if (mirror) P.mirror = true;
  emit("phase", P.n, mirror ? MIRROR_LINE : PHASE_LINES[(P.n - 1) % PHASE_LINES.length], P.bases.map((id) => G.bases.get(id)));
}

function findSite(r, preferSides) {
  const W = G.world, b = W.bounds;
  const mine = G.blds.filter((x) => !x.dead && x.team === 0);
  const minD = 42 + Math.min(40, G.phase.n * 2);
  let best = null, bs = -1e9;
  for (let i = 0; i < 260; i++) {
    const tx = b.x0 + 10 + Math.floor(r() * (b.x1 - b.x0 - 20)), ty = b.y0 + 10 + Math.floor(r() * (b.y1 - b.y0 - 20));
    let dMine = 1e9;
    for (const m of mine) dMine = Math.min(dMine, Math.hypot(m.tx - tx, m.ty - ty));
    if (dMine < minD) continue;
    let dBase = 1e9;
    for (const base of G.bases.values()) if (base.alive) dBase = Math.min(dBase, Math.hypot(base.tx - tx, base.ty - ty));
    if (dBase < 28) continue;
    // mostly dry land, please
    let land = 0;
    for (let j = -7; j <= 7; j += 2) for (let k = -7; k <= 7; k += 2) if (isWalk(W.terrain(tx + k, ty + j)) || W.terrain(tx + k, ty + j) === 5) land++;
    if (land < 40) continue;
    let s = land - Math.abs(dMine - minD - 12) * 0.6 + r() * 10;
    if (preferSides) {
      if (preferSides.includes("n") && ty < b.y0 + 48) s += 30;
      if (preferSides.includes("s") && ty > b.y1 - 48) s += 30;
      if (preferSides.includes("w") && tx < b.x0 + 48) s += 30;
      if (preferSides.includes("e") && tx > b.x1 - 48) s += 30;
    }
    if (s > bs) { bs = s; best = { tx, ty }; }
  }
  return best;
}

/** Lay out a base around (cx, cy). */
function buildBase(cx, cy, n, r, mirror) {
  const W = G.world;
  const era = mirror ? MAX_ERA : enemyEra(n);
  const boost = mirror ? 2.2 : enemyBoost(n);
  const level = Math.min(10, era + 1);
  const base = { id: nextBase++, phase: n, era, boost, tx: cx, ty: cy, x: cx * TILE, y: cy * TILE, blds: [], garrison: [], budget: 40 + 10 * n, alive: true, mirror,
    waveAt: G.time + (n === 1 ? 420 : 200) * DIFFICULTY[G.diff].waveEvery, raidAt: G.time + 240, scoutAt: G.time + 60 };
  G.bases.set(base.id, base);
  // clear the ground: the base's own clearing, and nothing of yours ever under it
  W.clearArea(cx - 9, cy - 9, 19, 19);
  const put = (type, tx, ty) => {
    const d = BUILDINGS[type];
    for (let j = 0; j < d.h; j++) for (let i = 0; i < d.w; i++) if (!W.buildable(tx + i, ty + j)) return null;
    const b = placeBuilding(type, tx, ty, 1, { built: 1, level: Math.max(1, Math.min(10, type === "wall" ? level : level)), base: base.id, boost });
    b.hp = b.maxHp;
    base.blds.push(b.id);
    return b;
  };
  const core = put("hall", cx - 2, cy - 2);
  base.core = core ? core.id : 0;
  const dens = ["barracks"];
  if (era >= 1) dens.push(r() < 0.5 ? "stable" : "workshop");
  if (n >= 6) dens.push("barracks");
  if (era >= 3) dens.push(r() < 0.5 ? "workshop" : "stable");
  if (era >= 6) dens.push("airfield");
  if (mirror) dens.push("barracks", "stable", "workshop", "airfield");
  const ring = [[-7, -2], [4, -2], [-2, -7], [-2, 4], [-7, -7], [4, 4], [4, -7], [-7, 4]];
  let ri = 0;
  for (const d of dens) {
    for (let tries = 0; tries < ring.length; tries++) {
      const [ox, oy] = ring[ri++ % ring.length];
      if (put(d, cx + ox, cy + oy)) break;
    }
  }
  const towers = Math.min(8, 1 + Math.floor(n / 3) + (mirror ? 6 : 0));
  for (let i = 0; i < towers * 3 && base.blds.filter((id) => G.ents.get(id).type === "tower").length < towers; i++) {
    const a = r() * Math.PI * 2, d = 6 + r() * 3;
    put("tower", Math.round(cx + Math.cos(a) * d) - 1, Math.round(cy + Math.sin(a) * d) - 1);
  }
  for (let i = 0; i < 2 + Math.floor(r() * 3); i++) {
    const a = r() * Math.PI * 2, d = 4 + r() * 4;
    put("house", Math.round(cx + Math.cos(a) * d) - 1, Math.round(cy + Math.sin(a) * d) - 1);
  }
  if (n >= 4) {
    // a broken ring of wall, with gaps where the dens open
    for (let k = 0; k < 64; k++) {
      const a = k / 64 * Math.PI * 2;
      if (r() < 0.35) continue;
      put("wall", Math.round(cx + Math.cos(a) * 10), Math.round(cy + Math.sin(a) * 10));
    }
  }
  road(cx, cy, r);
  // a starting garrison, so a base is never found empty
  for (let i = 0; i < 2 + Math.floor(n * 0.8) + (mirror ? 20 : 0); i++) spawnFor(base, true);
  return base;
}

/** The way they walk: a track from the base towards your hall, cut through wood and rock and forded
    across water, so every base can be reached on foot and every wave has a road to come down. */
function road(cx, cy, r) {
  const W = G.world, home = G.blds.find((b) => !b.dead && b.team === 0 && b.type === "hall") || { tx: 0, ty: 0, w: 0, h: 0 };
  const hx = home.tx + home.w / 2, hy = home.ty + home.h / 2;
  let x = cx, y = cy + 4, wob = r() * 6.28;
  for (let n = 0; n < 600; n++) {
    const d = Math.hypot(hx - x, hy - y);
    if (d < 16) break;
    wob += (r() - 0.5) * 0.5;
    const a = Math.atan2(hy - y, hx - x) + Math.sin(wob) * 0.5;
    x += Math.cos(a); y += Math.sin(a);
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
      const tx = Math.round(x) + i, ty = Math.round(y) + j, t = W.terrain(tx, ty);
      if (W.occ(tx, ty)) continue;
      if (t === 5 || t === 6) W.setTerrain(tx, ty, 4);
      else if (t === 0 || t === 1) W.setTerrain(tx, ty, 2);
    }
  }
}

/* ---------------- running a base ---------------- */
const POINTS = { melee: 1, ranged: 1, mender: 1.3, mounted: 2.2, siege: 3.2, naval: 3, air: 3 };
function spawnFor(base, free) {
  const dens = base.blds.map((id) => G.ents.get(id)).filter((b) => b && !b.dead && BUILDINGS[b.type].trains && b.type !== "hall");
  if (!dens.length) return null;
  const den = dens[Math.floor(Math.random() * dens.length)];
  const lines = BUILDINGS[den.type].trains.filter((l) => LINES[l].first <= base.era && l !== "worker" && !(l === "mender" && Math.random() < 0.6));
  if (!lines.length) return null;
  let line = lines[Math.floor(Math.random() * lines.length)];
  // siege is a third of a garrison at most: a base of nothing but catapults is a wall of splash, not an army
  if (line === "siege") {
    const g = base.garrison.map((id) => G.ents.get(id)).filter((u) => u && !u.dead);
    if (g.filter((u) => u.line === "siege").length > g.length / 3) line = Math.random() < 0.5 ? "melee" : "ranged";
  }
  const cost = POINTS[line] * (1 + 0.12 * base.era);
  if (!free && base.budget < cost) return null;
  if (!free) base.budget -= cost;
  const p = exitPoint(den, LINES[line].move);
  const u = spawnUnit(line, Math.max(LINES[line].first, base.era), 1, p.x, p.y, { base: base.id, boost: base.boost });
  u.hp = u.maxHp;
  base.garrison.push(u.id);
  setOrder(u, { t: "guard", x: base.x + (Math.random() - 0.5) * 6 * TILE, y: base.y + (Math.random() - 0.5) * 6 * TILE });
  return u;
}

/** Nearest thing of yours to a point — not a wall, unless walls are all there is. */
function nearestMine(x, y) {
  let best = null, bd = 1e18;
  for (const b of G.blds) {
    if (b.dead || b.team !== 0) continue;
    const d = rectDist(x, y, b) + (b.type === "wall" ? 4000 : 0);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

export function updateEnemy(dt) {
  const P = G.phase;
  if (!P) return;
  if (P.cleared) {
    if (G.time >= P.nextAt) startPhase();
    return;
  }
  const D = DIFFICULTY[G.diff];
  let anyAlive = false;
  for (const id of P.bases) {
    const base = G.bases.get(id);
    if (!base || !base.alive) continue;
    const blds = base.blds.map((i) => G.ents.get(i)).filter((b) => b && !b.dead);
    const standing = blds.filter((b) => b.type !== "wall" && b.type !== "house");
    if (!standing.length) { fall(base, blds); continue; }
    anyAlive = true;
    base.garrison = base.garrison.filter((uid) => { const u = G.ents.get(uid); return u && !u.dead; });
    const dens = standing.filter((b) => BUILDINGS[b.type].trains && b.type !== "hall").length;
    base.budget += dt * (0.5 + 0.22 * base.phase) * D.budget * (0.6 + 0.4 * dens) * (base.mirror ? 2 : 1);
    const cap = Math.min(70, 3 + 3 * base.phase);
    if (base.garrison.length < cap) spawnFor(base, false);

    // somebody is hitting the base: everyone at home answers
    const hit = standing.find((b) => G.time - b.lastHit < 3 && b.lastBy);
    if (hit) {
      const by = G.ents.get(hit.lastBy);
      if (by && !by.dead) for (const uid of base.garrison) {
        const u = G.ents.get(uid);
        if (u && u.order.t === "guard" && Math.hypot(u.x - base.x, u.y - base.y) < 14 * TILE) setOrder(u, { t: "attack", id: by.id });
      }
    }
    // a wave
    if (G.time >= base.waveAt) {
      base.waveAt = G.time + Math.max(80, 250 - 5 * base.phase) * D.waveEvery;
      const home = base.garrison.map((i) => G.ents.get(i)).filter((u) => u && u.order.t === "guard");
      const keep = Math.max(2, Math.floor(home.length * 0.3));
      const go = home.slice(keep);
      const tgt = nearestMine(base.x, base.y);
      if (go.length && tgt) {
        moveGroup(go, tgt.x, tgt.y, "amove");
        base.garrison = base.garrison.filter((i) => !go.some((u) => u.id === i));
        emit("wave", base, go.length, tgt);
      }
    }
    // a raid on whoever is working out in the open
    if (G.time >= base.raidAt && base.phase >= 2) {
      base.raidAt = G.time + 180 + Math.random() * 120;
      const fast = base.garrison.map((i) => G.ents.get(i)).filter((u) => u && u.order.t === "guard" && (u.line === "mounted" || u.line === "ranged")).slice(0, 2 + Math.floor(base.phase / 5));
      const workers = G.units.filter((u) => !u.dead && u.team === 0 && u.line === "worker" && !u.hidden);
      if (fast.length && workers.length) {
        workers.sort((a, b) => Math.hypot(a.x - base.x, a.y - base.y) - Math.hypot(b.x - base.x, b.y - base.y));
        const w = workers[0];
        moveGroup(fast, w.x, w.y, "amove");
        base.garrison = base.garrison.filter((i) => !fast.some((u) => u.id === i));
      }
    }
    // a scout, now and then, walking towards you
    if (G.time >= base.scoutAt) {
      base.scoutAt = G.time + 150;
      const s = base.garrison.map((i) => G.ents.get(i)).find((u) => u && u.order.t === "guard");
      const tgt = nearestMine(base.x, base.y);
      if (s && tgt) { const k = 0.4 + Math.random() * 0.4; setOrder(s, { t: "amove", x: base.x + (tgt.x - base.x) * k + (Math.random() - 0.5) * 400, y: base.y + (tgt.y - base.y) * k + (Math.random() - 0.5) * 400 }); base.garrison = base.garrison.filter((i) => i !== s.id); }
    }
  }
  // stragglers from fallen bases keep walking at you
  if (G.tick % 50 === 0) {
    for (const u of G.units) {
      if (u.dead || u.team !== 1 || u.order.t !== "idle") continue;
      const tgt = nearestMine(u.x, u.y);
      if (tgt) setOrder(u, { t: "amove", x: tgt.x, y: tgt.y });
    }
  }
  if (!anyAlive && P.bases.length) clearPhase();
}

function fall(base, rest) {
  base.alive = false;
  for (const b of rest) kill(b, null);   // the walls come down with it
  // the spoils: a share of what the base was worth
  const k = eraMul(base.era) * (1 + 0.1 * base.phase);
  const loot = { gold: Math.round(220 * k), wood: Math.round(160 * k), stone: Math.round(120 * k) };
  if (base.era >= 5) loot.oil = Math.round(60 * k / 4);
  if (base.era >= 8) loot.aether = Math.round(20 * k / 12);
  for (const r in loot) G.res[r] += loot[r];
  emit("baseFell", base, loot, base.mirror ? EPILOGUE[0] : FALL_LINES[(base.id - 1) % FALL_LINES.length]);
  if (base.mirror) { G.complete = true; emit("complete"); }
}
function clearPhase() {
  const P = G.phase;
  P.cleared = true;
  P.nextAt = G.time + 30;
  G.stats.phases++;
  emit("phaseClear", P.n);
}
export function liveBases() { return G.phase ? G.phase.bases.map((id) => G.bases.get(id)).filter((b) => b && b.alive) : []; }
export { ERAS, CHUNK };
