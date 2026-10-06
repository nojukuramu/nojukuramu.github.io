/* units.js — what a unit does with its tick.
 *
 * Every unit has one order (G.ents[id].order) and a queue behind it (oq, for
 * shift-clicked plans). An order is a small state machine read every tick:
 * move, attack-move, attack, gather, build, repair, patrol, hold, guard,
 * follow, scout. Paths are asked for, not computed on the spot: the request
 * goes into pathQ and sim.js answers a budgeted number a tick, so a hundred
 * soldiers told to move at once cost a second of latency, not a dropped frame.
 *
 * Champions and possessed units under manual control skip all of this; their
 * tick lives in heroes.js. */

import { G, emit } from "./state.js";
import { TILE, GATHER, GATHER_PER_LEVEL, HAUL_PER_LEVEL, BUILDINGS, LINES } from "./data.js";
import { findPath } from "./path.js";
import { gap, rectDist, findTarget, damage, heal, near, hostile, tileOf, lvl, canHit } from "./entities.js";
import { explored } from "./fog.js";
import { fire } from "./combat.js";
import { completeBuilding } from "./buildings.js";
import { T } from "./world.js";

export const pathQ = [];
const ARRIVE = 5;

/* ---------------- paths ---------------- */
/** goal: { x, y } (a point), { ent } (stand next to a building or node), or { tile: {tx, ty} } (next to a tile). */
export function requestPath(u, goal) {
  u.goal = goal;
  if (u.move === "air") {
    const p = goalPoint(goal);
    u.path = [{ tx: tileOf(p.x), ty: tileOf(p.y), x: p.x, y: p.y }]; u.pi = 0; u.waitPath = false; u.partial = false; u.moving = true;
    return;
  }
  if (!u.waitPath) pathQ.push(u.id);
  u.waitPath = true; u.moving = true;
}
export function goalPoint(goal) {
  if (goal.ent) return { x: goal.ent.x, y: goal.ent.y };
  if (goal.tile) return { x: (goal.tile.tx + 0.5) * TILE, y: (goal.tile.ty + 0.5) * TILE };
  return goal;
}
export function solvePath(u) {
  u.waitPath = false;
  if (u.dead || !u.goal) return;
  const W = G.world;
  let sx = tileOf(u.x), sy = tileOf(u.y);
  if (!W.passable(sx, sy, u.move)) { const o = W.nearestOpen(sx, sy, u.move, 4); if (o) { sx = o.tx; sy = o.ty; } }
  const g = u.goal;
  let goal;
  if (g.ent) goal = { rect: { tx: g.ent.tx, ty: g.ent.ty, w: g.ent.w, h: g.ent.h } };
  else if (g.tile) goal = { rect: { tx: g.tile.tx, ty: g.tile.ty, w: 1, h: 1 } };
  else {
    let gx = tileOf(g.x), gy = tileOf(g.y);
    if (!W.passable(gx, gy, u.move)) { const o = W.nearestOpen(gx, gy, u.move, 6); if (o) { gx = o.tx; gy = o.ty; } }
    goal = { tx: gx, ty: gy };
  }
  const res = findPath(W, sx, sy, goal, u.move, 4500);
  u.path = res.path; u.pi = 0; u.partial = res.partial;
  u.stuck = 0;
}

/** One step along the path. Returns "moving", "waiting" or "arrived". */
export function step(u, dt) {
  if (u.waitPath) return "waiting";
  if (!u.path) { u.moving = false; return "arrived"; }
  if (u.pi >= u.path.length) {
    if (u.partial && u.goal) { requestPath(u, u.goal); return "waiting"; }
    // the last stretch: walk to the exact point if there is one
    const g = u.goal && !u.goal.ent && !u.goal.tile ? u.goal : null;
    if (g && Math.hypot(g.x - u.x, g.y - u.y) > ARRIVE && u.move !== "air" && clearLine(u, g.x, g.y)) return walk(u, g.x, g.y, dt, true);
    // next to a building, a node or a tree: close the last few pixels straight on, so a shove never leaves
    // a worker forever one step short of the thing it is working on
    const r = u.goal && (u.goal.ent || (u.goal.tile && { tx: u.goal.tile.tx, ty: u.goal.tile.ty, w: 1, h: 1 }));
    if (r && r.tx !== undefined) {
      const x0 = r.tx * TILE, y0 = r.ty * TILE, px = Math.max(x0, Math.min(x0 + r.w * TILE, u.x)), py = Math.max(y0, Math.min(y0 + r.h * TILE, u.y));
      const d = Math.hypot(px - u.x, py - u.y);
      if (d > u.r + 4 && (u.edgeT = (u.edgeT || 0) + dt) < 3) {
        const st = Math.min(d - u.r - 3, speedOf(u) * dt);
        if (tryMove(u, u.x + (px - u.x) / d * st, u.y + (py - u.y) / d * st)) { u.moving = true; return "moving"; }
      }
    }
    u.edgeT = 0;
    u.moving = false; u.path = null; return "arrived";
  }
  const wp = u.path[u.pi];
  const last = u.pi === u.path.length - 1;
  let wx = wp.x !== undefined ? wp.x : (wp.tx + 0.5) * TILE, wy = wp.y !== undefined ? wp.y : (wp.ty + 0.5) * TILE;
  if (last && u.goal && !u.goal.ent && !u.goal.tile && !u.partial && clearLine(u, u.goal.x, u.goal.y)) { wx = u.goal.x; wy = u.goal.y; }
  const d = Math.hypot(wx - u.x, wy - u.y);
  if (d < (last ? ARRIVE : 10)) { u.pi++; return "moving"; }
  return walk(u, wx, wy, dt, false);
}
function clearLine(u, x, y) {
  if (u.move === "air") return true;
  return G.world.passable(tileOf(x), tileOf(y), u.move);
}
export function speedOf(u) {
  let s = u.st.speed * TILE;
  if (u.slow > G.time) s *= 0.55;
  if (u.buffs.veil > G.time) s *= 1.3;
  if (u.buffs.haste > G.time) s *= 1.25;
  if (u.line === "worker" && u.team === 0) s *= 1 + HAUL_PER_LEVEL * lvl("haul");
  return s;
}
function walk(u, wx, wy, dt, final) {
  const d = Math.hypot(wx - u.x, wy - u.y);
  const st = Math.min(d, speedOf(u) * dt);
  const nx = u.x + (wx - u.x) / d * st, ny = u.y + (wy - u.y) / d * st;
  u.face = Math.atan2(wy - u.y, wx - u.x);
  u.moving = true;
  if (tryMove(u, nx, ny)) { /* moved */ }
  else if (tryMove(u, nx, u.y)) { /* slid */ }
  else if (tryMove(u, u.x, ny)) { /* slid */ }
  else { u.stuck += dt; }
  // stuck: progress measured once a second; three bad seconds and the path is asked for again
  u.lastPos += dt;
  if (u.lastPos > 1) {
    const moved = Math.hypot(u.x - (u.chkX || 0), u.y - (u.chkY || 0));
    u.chkX = u.x; u.chkY = u.y; u.lastPos = 0;
    if (moved < 6) { u.stuck += 1; if (u.stuck > 2.5 && u.goal) { u.stuck = 0; u.tries = (u.tries || 0) + 1; if (u.tries > 3) { u.tries = 0; u.path = null; u.moving = false; return "arrived"; } requestPath(u, u.goal); } }
    else u.tries = 0;
  }
  if (final && d < ARRIVE) { u.moving = false; return "arrived"; }
  return "moving";
}
export function tryMove(u, x, y) {
  if (u.move === "air") { const b = G.world.bounds; if (x < b.x0 * TILE || y < b.y0 * TILE || x >= b.x1 * TILE || y >= b.y1 * TILE) return false; u.x = x; u.y = y; return true; }
  // a body already standing somewhere it should not (shoved, or put there) may always step; otherwise
  // it could never walk back out
  if (!G.world.passable(tileOf(x), tileOf(y), u.move) && G.world.passable(tileOf(u.x), tileOf(u.y), u.move)) return false;
  u.x = x; u.y = y; return true;
}

/* ---------------- orders ---------------- */
export function setOrder(u, order, queue) {
  if (queue && u.order.t !== "idle") { u.oq.push(order); return; }
  u.oq.length = queue ? u.oq.length : 0;
  start(u, order);
}
function start(u, order) {
  u.order = order; u.tgt = 0; u.gs = ""; u.gt = 0; u.idleT = 0; u.hidden = false;
  u.path = null; u.waitPath = false;
  if (order.t === "move" || order.t === "amove") requestPath(u, { x: order.x, y: order.y });
  if (order.t === "patrol") requestPath(u, { x: order.bx, y: order.by });
  if (order.t === "idle" || order.t === "hold") { u.home = { x: u.x, y: u.y }; u.moving = false; }
  if (order.t === "guard") u.home = { x: order.x, y: order.y };
}
export function next(u) {
  if (u.oq.length) start(u, u.oq.shift());
  else start(u, { t: "idle" });
}
export function stop(u) { u.oq.length = 0; start(u, { t: "idle" }); }

/** Spread a group's destinations around one point, nearest unit to nearest slot. */
export function formation(units, x, y) {
  const n = units.length;
  if (n === 1) return [{ x, y }];
  const sp = 24 + Math.max(...units.map((u) => u.r)) * 0.9;
  const slots = [];
  const cols = Math.ceil(Math.sqrt(n));
  for (let i = 0; i < n; i++) {
    const c = i % cols, r = Math.floor(i / cols);
    slots.push({ x: x + (c - (cols - 1) / 2) * sp, y: y + (r - (Math.ceil(n / cols) - 1) / 2) * sp });
  }
  const cx = units.reduce((a, u) => a + u.x, 0) / n, cy = units.reduce((a, u) => a + u.y, 0) / n;
  const ang = Math.atan2(y - cy, x - cx) + Math.PI / 2, ca = Math.cos(ang), sa = Math.sin(ang);
  for (const s of slots) { const dx = s.x - x, dy = s.y - y; s.x = x + dx * ca - dy * sa; s.y = y + dx * sa + dy * ca; }
  const out = new Array(n), used = new Array(n).fill(false);
  const order = units.map((u, i) => i).sort((a, b) => Math.hypot(units[b].x - x, units[b].y - y) - Math.hypot(units[a].x - x, units[a].y - y));
  for (const i of order) {
    let bi = 0, bd = 1e18;
    for (let k = 0; k < n; k++) if (!used[k]) { const d = Math.hypot(slots[k].x - units[i].x, slots[k].y - units[i].y); if (d < bd) { bd = d; bi = k; } }
    used[bi] = true; out[i] = slots[bi];
  }
  return out;
}

/* ---------------- the tick ---------------- */
export function updateUnit(u, dt) {
  if (u.cd > 0) u.cd -= dt * atkRate(u);
  if (u.atkAnim > 0) u.atkAnim -= dt;
  if (u.stun > G.time) { u.moving = false; return; }
  const o = u.order;
  switch (o.t) {
    case "idle": idle(u, dt); break;
    case "move": if (step(u, dt) === "arrived") next(u); break;
    case "amove": amove(u, dt, o.x, o.y, () => next(u)); break;
    case "attack": {
      const t = G.ents.get(o.id);
      if (!t || t.dead || (t.kind === "unit" && t.hidden)) { next(u); break; }
      fight(u, t, dt, true);
      break;
    }
    case "gather": gather(u, dt); break;
    case "build": build(u, dt); break;
    case "repair": repair(u, dt); break;
    case "return": returnCargo(u, dt, () => next(u)); break;
    case "patrol": amove(u, dt, o.bx, o.by, () => { const ax = o.ax, ay = o.ay; o.ax = o.bx; o.ay = o.by; o.bx = ax; o.by = ay; requestPath(u, { x: o.bx, y: o.by }); }); break;
    case "hold": hold(u, dt); break;
    case "guard": guard(u, dt); break;
    case "follow": {
      const t = G.ents.get(o.id);
      if (!t || t.dead) { next(u); break; }
      if (Math.hypot(t.x - u.x, t.y - u.y) > 3 * TILE) { if (!u.moving || (u.chaseT = (u.chaseT || 0) - dt) < 0) { u.chaseT = 1; requestPath(u, { x: t.x, y: t.y }); } step(u, dt); }
      else { u.moving = false; if (u.stance !== "hold") acquire(u, dt, u.st.sight * TILE); }
      break;
    }
    case "scout": scout(u, dt); break;
    default: next(u);
  }
}

export function atkRate(u) {
  let k = 1;
  if (u.buffs.rally > G.time) k *= 1.3;
  if (u.buffs.overclock > G.time) k *= 1.6;
  return k;
}
const isFighter = (u) => u.line !== "worker" || u.hero;

function idle(u, dt) {
  u.idleT += dt;
  u.moving = false;
  if (u.line === "mender" && !u.hero) { mend(u, dt); return; }
  if (!u.home) u.home = { x: u.x, y: u.y };
  if (u.stance === "scout" && isFighter(u)) { start(u, { t: "scout" }); return; }
  const leash = 9 * TILE;
  if (u.tgt) {
    const t = G.ents.get(u.tgt);
    if (t && !t.dead && Math.hypot(u.x - u.home.x, u.y - u.home.y) < leash) { fight(u, t, dt, u.stance !== "hold"); return; }
    u.tgt = 0;
    if (Math.hypot(u.x - u.home.x, u.y - u.home.y) > TILE) { requestPath(u, { x: u.home.x, y: u.home.y }); }
  }
  if (u.moving || u.waitPath) { step(u, dt); }
  // workers fight back when struck; soldiers look for trouble
  if (!isFighter(u) && G.time - u.lastHit > 3) return;
  if (u.stance === "hold") { hold(u, dt); return; }
  acquire(u, dt, u.st.sight * TILE);
}
/** Look around now and then; a target found becomes u.tgt. */
function acquire(u, dt, radius) {
  u.scan -= dt;
  if (u.scan > 0) return null;
  u.scan = 0.4 + Math.random() * 0.2;
  const t = findTarget(u, radius);
  if (t) u.tgt = t.id;
  return t;
}

function amove(u, dt, x, y, done) {
  if (u.tgt) {
    const t = G.ents.get(u.tgt);
    if (t && !t.dead && !(t.kind === "unit" && t.hidden) && gap(u, t) < (u.st.sight + 3) * TILE) { fight(u, t, dt, true); return; }
    u.tgt = 0; requestPath(u, { x, y });
  }
  if (u.line === "mender" && !u.hero && mend(u, dt)) return;
  if (acquire(u, dt, u.st.sight * TILE)) return;
  if (step(u, dt) === "arrived") {
    // an attack-move that ends near enemies is not over: look a little further before standing down
    const t = findTarget(u, (u.st.sight + 6) * TILE);
    if (t) { u.tgt = t.id; return; }
    done();
  }
}
function hold(u, dt) {
  u.moving = false;
  const t = u.tgt && G.ents.get(u.tgt);
  if (t && !t.dead && gap(u, t) <= u.st.range * TILE + 4) { fight(u, t, dt, false); return; }
  u.tgt = 0;
  u.scan -= dt;
  if (u.scan <= 0) { u.scan = 0.3; const f = findTarget(u, u.st.range * TILE + 2); if (f) u.tgt = f.id; }
}
function guard(u, dt) {
  const o = u.order;
  const t = u.tgt && G.ents.get(u.tgt);
  if (t && !t.dead && Math.hypot(t.x - o.x, t.y - o.y) < 10 * TILE) { fight(u, t, dt, true); return; }
  u.tgt = 0;
  if (Math.hypot(u.x - o.x, u.y - o.y) > 2 * TILE) { if (!u.moving && !u.waitPath) requestPath(u, { x: o.x, y: o.y }); step(u, dt); }
  else u.moving = false;
  acquire(u, dt, u.st.sight * TILE);
}

/** Close on a target and hit it. chase=false: only hit what is already in reach. */
export function fight(u, t, dt, chase) {
  const st = u.st;
  if (!canHit(st, t)) { u.tgt = 0; if (u.order.t === "attack") next(u); return; }
  const d = gap(u, t);
  const reach = st.range * TILE + (st.range < 1.5 ? 6 : 0);
  if (d <= reach && !(st.minRange && d < st.minRange * TILE)) {
    u.moving = false; u.path = null;
    u.face = Math.atan2(t.y - u.y, t.x - u.x);
    if (u.cd <= 0) { strike(u, t); u.cd = st.cd; }
    return;
  }
  if (!chase) return;
  u.chaseT = (u.chaseT || 0) - dt;
  const gp = t.kind === "bld" ? null : u.goal && !u.goal.ent ? u.goal : null;
  if (u.chaseT <= 0 || (!u.moving && !u.waitPath) || (gp && Math.hypot(gp.x - t.x, gp.y - t.y) > 2 * TILE)) {
    u.chaseT = 0.8;
    requestPath(u, t.kind === "bld" ? { ent: t } : { x: t.x, y: t.y });
  }
  step(u, dt);
}

export function strike(u, t) {
  const st = u.st;
  u.atkAnim = 0.25;
  if (u.line === "mender" && !u.hero && t.team === u.team) { heal(t, st.atk * 1.6, u); emit("mend", u, t); return; }
  let dmg = st.atk;
  if (u.buffs.tumble > G.time) { dmg *= 2; u.buffs.tumble = 0; }
  if (st.shot || (u.hero && st.range > 1.5)) fire(u, t, dmg);
  else { damage(t, dmg, u, "melee"); emit("swing", u, t); }
}

/** Menders: the most hurt ally in sight gets a hand. */
function mend(u, dt) {
  u.scan -= dt;
  let t = u.tgt && G.ents.get(u.tgt);
  if (!t || t.dead || t.team !== u.team || t.hp >= t.maxHp) {
    t = null;
    if (u.scan > 0) return false;
    u.scan = 0.5;
    let worst = 0.98;
    near(u.x, u.y, u.st.sight * TILE, (e) => {
      if (e.kind !== "unit" || e.team !== u.team || e.dead || e === u || e.st.mech) return;
      const k = e.hp / e.maxHp;
      if (k < worst) { worst = k; t = e; }
    });
    u.tgt = t ? t.id : 0;
    if (!t) return false;
  }
  fight(u, t, dt, true);
  return true;
}

/* ---------------- workers ---------------- */
export function carryAmount(u, res) {
  const base = GATHER[res].carry;
  return Math.round(base * (1 + GATHER_PER_LEVEL * lvl(res)) * (1 + HAUL_PER_LEVEL * lvl("haul")) * (1 + 0.25 * u.tier));
}
export function nearestDrop(u, res) {
  let best = null, bd = 1e18;
  for (const b of G.blds) {
    if (b.dead || b.team !== u.team || b.built < 1) continue;
    const d = BUILDINGS[b.type].drop;
    if (!d || d.indexOf(res) < 0) continue;
    const dist = rectDist(u.x, u.y, b);
    if (dist < bd) { bd = dist; best = b; }
  }
  return best;
}
function gather(u, dt) {
  const o = u.order;
  if (u.carry && (u.carry.r !== o.res || u.gs === "ret")) { u.gs = "ret"; returnCargo(u, dt, () => { u.gs = ""; }); return; }
  if (u.gs === "" || u.gs === "to") {
    // what are we going to, and is it still there?
    let tgt = null;
    if (o.node) {
      const n = G.world.nodes.get(o.node);
      if (!n || n.amount <= 0) {
        const alt = nearestNode(u, o.res, 14);
        if (!alt) { next(u); emit("noWork", u, o.res); return; }
        o.node = alt.id; tgt = alt; u.gs = "";
      } else tgt = n;
    } else {
      if (G.world.terrain(o.tx, o.ty) !== T.FOREST) {
        const t = G.world.nearestTree(o.tx, o.ty, 10);
        if (!t) { next(u); emit("noWork", u, "wood"); return; }
        o.tx = t.tx; o.ty = t.ty; u.gs = "";
      }
    }
    if (u.gs === "") { u.gs = "to"; requestPath(u, tgt ? { ent: tgt } : { tile: { tx: o.tx, ty: o.ty } }); }
    const close = tgt ? gap(u, tgt) < TILE * 0.8 : rectDist(u.x, u.y, { tx: o.tx, ty: o.ty, w: 1, h: 1 }) < TILE * 1.0;
    if (close) { u.gs = "work"; u.gt = 0; u.moving = false; u.path = null; if (tgt && o.res === "gold") u.hidden = true; return; }
    if (step(u, dt) === "arrived" && !u.waitPath) {
      // the path ended short: someone is in the way, or it cannot be reached
      u.fails = (u.fails || 0) + 1;
      if (u.fails > 3) { u.fails = 0; if (!o.node) { const t = G.world.nearestTree(o.tx, o.ty, 10, (x, y) => x === o.tx && y === o.ty); if (t) { o.tx = t.tx; o.ty = t.ty; } } }
      u.gs = "";
    }
    return;
  }
  if (u.gs === "work") {
    u.gt += dt;
    u.atkAnim = (u.gt % 0.8) < 0.2 ? 0.2 : 0;
    if (!o.node) u.face = Math.atan2((o.ty + 0.5) * TILE - u.y, (o.tx + 0.5) * TILE - u.x);
    if (u.gt < GATHER[o.res].time) return;
    const want = carryAmount(u, o.res);
    let got = 0;
    if (o.node) {
      const n = G.world.nodes.get(o.node);
      if (n) { got = Math.min(want, n.amount); n.amount -= got; n.taken += got; if (n.amount <= 0) { G.world.removeNode(n); emit("depleted", n); } }
    } else {
      got = G.world.chop(o.tx, o.ty, Math.ceil(want / 3)) * 3;
      if (got > want) got = want;
    }
    u.hidden = false;
    if (u.hidden === false && o.node && o.res === "gold") emit("leaveMine", u);
    if (got <= 0) { u.gs = ""; return; }
    u.carry = { r: o.res, n: got };
    u.gs = "ret";
    emit("gathered", u, o.res);
  }
}
function nearestNode(u, res, maxTiles) {
  let best = null, bd = maxTiles * TILE;
  for (const n of G.world.nodes.values()) {
    if (n.type !== res || n.amount <= 0) continue;
    const d = Math.hypot(n.x - u.x, n.y - u.y);
    if (d < bd && explored(n.tx, n.ty)) { bd = d; best = n; }
  }
  return best;
}
function returnCargo(u, dt, done) {
  if (!u.carry) { done(); return; }
  let b = u.dropId && G.ents.get(u.dropId);
  if (!b || b.dead || b.built < 1 || !BUILDINGS[b.type].drop || BUILDINGS[b.type].drop.indexOf(u.carry.r) < 0) {
    b = nearestDrop(u, u.carry.r);
    if (!b) { if (u.order.t === "gather") next(u); else done(); u.moving = false; return; }
    u.dropId = b.id; requestPath(u, { ent: b });
  }
  if (gap(u, b) < TILE * 0.8) {
    G.res[u.carry.r] += u.carry.n;
    if (u.team === 0) G.stats.gathered += u.carry.n;
    emit("deposit", u, b, u.carry);
    u.carry = null; u.dropId = 0; u.path = null;
    done();
    return;
  }
  if (!u.moving && !u.waitPath) requestPath(u, { ent: b });
  step(u, dt);
}
function build(u, dt) {
  const b = G.ents.get(u.order.id);
  if (!b || b.dead || b.built >= 1) { afterBuild(u, b); return; }
  if (gap(u, b) < TILE * 0.8) {
    u.moving = false; u.path = null;
    u.face = Math.atan2(b.y - u.y, b.x - u.x);
    u.atkAnim = (G.time % 0.6) < 0.15 ? 0.2 : 0;
    const d = BUILDINGS[b.type], k = b.bThis ? 0.6 : 1;
    b.bThis++;
    const inc = dt / d.time * k * (1 + 0.15 * u.tier);
    b.built = Math.min(1, b.built + inc);
    b.hp = Math.min(b.maxHp, b.hp + b.maxHp * 0.9 * inc);
    if (b.built >= 1) { completeBuilding(b); afterBuild(u, b); }
    return;
  }
  if (!u.moving && !u.waitPath) requestPath(u, { ent: b });
  step(u, dt);
}
/** A worker who finishes a drop-off goes to work next to it, as in the games this follows. */
function afterBuild(u, b) {
  if (u.oq.length) { next(u); return; }
  if (b && !b.dead && b.team === u.team) {
    const drop = BUILDINGS[b.type].drop;
    if (drop && b.type !== "hall") {
      const res = drop.indexOf("wood") >= 0 && b.type !== "mine" ? "wood" : "gold";
      if (res === "wood") { const t = G.world.nearestTree(tileOf(b.x), tileOf(b.y), 12); if (t) { start(u, { t: "gather", res: "wood", tx: t.tx, ty: t.ty }); return; } }
      else { const n = nearestNode(u, "gold", 14) || nearestNode(u, "stone", 14); if (n) { start(u, { t: "gather", res: n.type, node: n.id }); return; } }
    }
  }
  next(u);
}
function repair(u, dt) {
  const b = G.ents.get(u.order.id);
  if (!b || b.dead || b.hp >= b.maxHp || b.built < 1) { next(u); return; }
  if (gap(u, b) < TILE * 0.8) {
    u.moving = false; u.path = null;
    u.atkAnim = (G.time % 0.6) < 0.15 ? 0.2 : 0;
    b.hp = Math.min(b.maxHp, b.hp + b.maxHp * dt / (BUILDINGS[b.type].time * 1.6));
    return;
  }
  if (!u.moving && !u.waitPath) requestPath(u, { ent: b });
  step(u, dt);
}

/* ---------------- scouting ---------------- */
function scout(u, dt) {
  const t = u.tgt && G.ents.get(u.tgt);
  if (t && !t.dead && isFighter(u) && u.line !== "worker" && gap(u, t) < u.st.sight * TILE && t.kind === "unit") { fight(u, t, dt, true); return; }
  u.tgt = 0;
  if (!u.goal || (!u.moving && !u.waitPath)) {
    const p = scoutTarget(u);
    if (!p) { start(u, { t: "idle" }); return; }
    requestPath(u, p);
  }
  if (step(u, dt) === "arrived") u.goal = null;
  if (u.line !== "worker") acquire(u, dt, u.st.range * TILE + TILE);
}
export function scoutTarget(u) {
  const b = G.world.bounds;
  let best = null, bs = -1e18;
  for (let i = 0; i < 28; i++) {
    const a = Math.random() * Math.PI * 2, r = (8 + Math.random() * 26) * TILE;
    const x = u.x + Math.cos(a) * r, y = u.y + Math.sin(a) * r, tx = tileOf(x), ty = tileOf(y);
    if (tx < b.x0 + 1 || ty < b.y0 + 1 || tx >= b.x1 - 1 || ty >= b.y1 - 1) continue;
    if (u.move !== "air" && !G.world.passable(tx, ty, u.move)) continue;
    let s = explored(tx, ty) ? -400 : 400;
    s += Math.cos(a - u.face) * 120;           // keep going roughly the same way
    for (const gh of G.ghosts.values()) if (BUILDINGS[gh.type].attack && Math.hypot((gh.tx + 1) * TILE - x, (gh.ty + 1) * TILE - y) < 9 * TILE) s -= 1000;
    if (s > bs) { bs = s; best = { x, y }; }
  }
  return best;
}

/* ---------------- commands from the player ---------------- */
/** The right click: decide, for each unit, what clicking on that means. */
export function smart(units, x, y, ent, tree, queue) {
  const ground = [];
  for (const u of units) {
    if (u.dead || u.team !== 0) continue;
    u.manualCmd = 0;
    if (ent && ent.kind === "unit" && ent.team !== 0) { setOrder(u, { t: "attack", id: ent.id }, queue); continue; }
    if (ent && ent.kind === "bld" && ent.team !== 0) { setOrder(u, { t: "attack", id: ent.id }, queue); continue; }
    if (u.line === "worker" && !u.hero) {
      if (ent && ent.kind === "node" && (ent.type === "gold" || ent.type === "stone")) { setOrder(u, { t: "gather", res: ent.type, node: ent.id }, queue); continue; }
      if (tree) { setOrder(u, { t: "gather", res: "wood", tx: tree.tx, ty: tree.ty }, queue); continue; }
      if (ent && ent.kind === "bld" && ent.team === 0 && ent.built < 1) { setOrder(u, { t: "build", id: ent.id }, queue); continue; }
      if (ent && ent.kind === "bld" && ent.team === 0 && ent.hp < ent.maxHp) { setOrder(u, { t: "repair", id: ent.id }, queue); continue; }
      if (ent && ent.kind === "bld" && ent.team === 0 && u.carry && BUILDINGS[ent.type].drop && BUILDINGS[ent.type].drop.indexOf(u.carry.r) >= 0) { u.dropId = ent.id; setOrder(u, { t: "return" }, queue); continue; }
    }
    if (ent && ent.kind === "unit" && ent.team === 0 && ent !== u) { setOrder(u, { t: "follow", id: ent.id }, queue); continue; }
    ground.push(u);
  }
  if (ground.length) moveGroup(ground, x, y, "move", queue);
}
export function moveGroup(units, x, y, t, queue) {
  const slots = formation(units, x, y);
  units.forEach((u, i) => setOrder(u, { t, x: slots[i].x, y: slots[i].y }, queue));
}
export function patrol(units, x, y) {
  for (const u of units) setOrder(u, { t: "patrol", ax: u.x, ay: u.y, bx: x, by: y });
}
export function isMilitary(u) { return !u.dead && u.line !== "worker" && !u.free; }
export { LINES, hostile };
