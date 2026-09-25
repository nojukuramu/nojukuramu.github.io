/* bots.js — opponents that fill a room, playing by a player's rules.
 *
 * A bot does exactly what a person does: it produces one command a tick —
 * move keys, buttons, yaw and pitch — and movement.js and weapons.js do the
 * rest. It cannot shoot through walls or turn faster than its difficulty
 * lets it, and it has to see you first (a ray from its eye to your chest,
 * inside its field of view, or because you just shot it).
 *
 * What makes one harder than another is only human-shaped things (modes.js
 * DIFFS): how long it takes to react, how far off its first aim is, how fast
 * it turns, whether it bunny hops, how much it strafes in a fight.
 *
 * Getting around is nav.js's graph: A* to wherever it is going, and the link
 * kinds tell it when to jump, when to climb, and that a pad is a way up. */

import { S } from "./state.js";
import { B, forward, right } from "./movement.js";
import { GUNS } from "./weapons.js";
import { ray, newTrace } from "./brush.js";
import { nearestNode, findPath, linkKind } from "./nav.js";
import { DIFFS } from "./modes.js";
import { BI } from "./skeleton.js";
import { world, nav, isEnemy, eyeOf } from "./game.js";
import { wrapAngle, anglesTo } from "./util.js";

const TR = newTrace();

export function newBrain(a) {
  return { t: 0, target: null, visible: false, lastSeen: null, lastSeenT: -99, reactT: 0, senseT: 0, err: { y: 0, p: 0 },
    path: null, pi: 0, goal: null, goalT: 0, repathT: 0, stuckT: 0, lastPos: null, strafe: 1, strafeT: 0,
    jumpLast: false, fireLast: false, meleeLast: false, crouchT: 0, head: 0.3 };
}
export function reset(a) { Object.assign(a.brain, newBrain(a)); a.brain.head = { easy: 0.1, normal: 0.25, hard: 0.45, insane: 0.7 }[a.diff] || 0.25; }

/* ---------------------------------------------------------------
   Seeing
   --------------------------------------------------------------- */
function chestOf(b) { const i = BI.chest * 3; return [b.bones[i], b.bones[i + 1], b.bones[i + 2]]; }
function canSee(a, b) {
  const e = eyeOf(a), c = chestOf(b);
  ray(world(), e[0], e[1], e[2], c[0], c[1], c[2], TR);
  return TR.fraction === 1;
}
function sense(a, br, D) {
  const e = eyeOf(a);
  const f = forward(a.aim.yaw);
  let best = null, bd = Infinity;
  for (const b of S.actors) {
    if (b === a || !b.alive || !b.heard || !isEnemy(a, b)) continue;
    const dx = b.body.x - e[0], dz = b.body.z - e[2];
    const dist = Math.hypot(dx, b.body.y + 1.2 - e[1], dz);
    const facing = (dx * f[0] + dz * f[2]) / (Math.hypot(dx, dz) || 1) > 0.34;          // ~140° field of view
    const hurtBy = a.lastAttacker === b.id && S.time - a.lastHurt < 2.5;
    if (!(facing || dist < 5 || hurtBy)) continue;
    if (dist > 140 || !canSee(a, b)) continue;
    const score = dist - (b === br.target ? 12 : 0) - (hurtBy ? 15 : 0);
    if (score < bd) { bd = score; best = b; }
  }
  if (best && best !== br.target) {
    br.reactT = D.react * (0.8 + 0.4 * a.rng());
    const k = D.aimErr * 3;
    br.err = { y: (a.rng() - 0.5) * 2 * k, p: (a.rng() - 0.5) * k };
  }
  if (best) { br.target = best; br.visible = true; br.lastSeen = { x: best.body.x, y: best.body.y, z: best.body.z }; br.lastSeenT = S.time; }
  else { br.visible = false; if (br.target && !br.target.alive) br.target = null; }
}

/* ---------------------------------------------------------------
   Thinking
   --------------------------------------------------------------- */
export function think(a, dt) {
  const br = a.brain, D = DIFFS[a.diff] || DIFFS.normal, body = a.body;
  br.t += dt;
  const cmd = { fwd: 0, side: 0, yaw: a.aim.yaw, pitch: a.aim.pitch, buttons: 0, slot: 0 };
  br.senseT -= dt;
  if (br.senseT <= 0 && !a.passive) { br.senseT = 0.1; sense(a, br, D); }
  br.reactT -= dt;
  const tgt = br.visible && br.target && br.target.alive ? br.target : null;
  const dist = tgt ? Math.hypot(tgt.body.x - body.x, tgt.body.y - body.y, tgt.body.z - body.z) : 0;

  // where to go
  let goal = null, sprint = true, fighting = false;
  if (a.passive) { goal = roam(a, br, 18); sprint = false; }
  else if (tgt) {
    fighting = true;
    const g = GUNS[a.arms.slots[a.arms.cur]] || null;
    const want = !g ? 1.5 : g.id === "talon" ? 45 : g.id === "mauler" ? 5 : g.id === "hornet" ? 10 : g.id === "brick" || g.id === "wasp" ? 14 : 20;
    if (dist > want + 6 || !br.visible) goal = { x: tgt.body.x, y: tgt.body.y, z: tgt.body.z };
    else if (dist < want - 4 && g && g.id !== "mauler") goal = away(a, tgt);
    sprint = false;
  } else if (br.lastSeen && S.time - br.lastSeenT < 6) goal = br.lastSeen;
  else goal = roam(a, br, 60);

  // how to get there
  let mx = 0, mz = 0, jump = false, climb = false;
  if (goal) {
    const step = follow(a, br, goal, dt);
    mx = step.x; mz = step.z; jump = step.jump; climb = step.climb;
  }
  if (fighting && D.strafe > 0) {
    // strafe across their aim, changing sides on no rhythm they can learn
    br.strafeT -= dt;
    if (br.strafeT <= 0) { br.strafe = -br.strafe; br.strafeT = 0.35 + a.rng() * 0.9; }
    const r = right(a.aim.yaw);
    mx += r[0] * br.strafe * D.strafe; mz += r[2] * br.strafe * D.strafe;
    if (D.bhop > 0.5 && a.rng() < 0.01) jump = true;
  }

  // where to look
  if (tgt) aimAt(a, br, D, tgt, dt, dist);
  else {
    const want = Math.hypot(mx, mz) > 0.1 ? Math.atan2(-mx, -mz) : a.aim.yaw;
    a.aim.yaw += wrapAngle(want - a.aim.yaw) * Math.min(1, dt * 6);
    a.aim.pitch += (0 - a.aim.pitch) * Math.min(1, dt * 4);
  }
  if (climb) { const want = Math.atan2(-mx, -mz); a.aim.yaw += wrapAngle(want - a.aim.yaw) * Math.min(1, dt * 12); }
  cmd.yaw = a.aim.yaw; cmd.pitch = a.aim.pitch;

  // move keys, relative to where the body faces
  const l = Math.hypot(mx, mz);
  if (l > 0.05) {
    const f = forward(cmd.yaw), r = right(cmd.yaw);
    cmd.fwd = (mx * f[0] + mz * f[2]) / Math.max(1, l);
    cmd.side = (mx * r[0] + mz * r[2]) / Math.max(1, l);
  }
  if (sprint && cmd.fwd > 0.5 && !a.passive) cmd.buttons |= B.SPRINT;

  // bunny hop down long straight runs, if this difficulty knows how
  const hs = Math.hypot(body.vx, body.vz);
  if (!fighting && D.bhop > 0 && br.path && hs > 5 && br.t % 10 < 10 * D.bhop) jump = jump || body.onGround;
  if (climb) { cmd.buttons |= B.JUMP; cmd.fwd = 1; cmd.side = 0; br.jumpLast = true; }
  else if (jump && !br.jumpLast) { cmd.buttons |= B.JUMP; br.jumpLast = true; }
  else br.jumpLast = false;

  // guns
  if (!a.passive) weapons(a, br, D, cmd, tgt, dist);
  return cmd;
}

function roam(a, br, radius) {
  const N = nav().nodes;
  if (!br.goal || br.goalT < S.time || (br.goal && Math.hypot(br.goal.x - a.body.x, br.goal.z - a.body.z) < 2)) {
    for (let i = 0; i < 12; i++) {
      const n = N[Math.floor(a.rng() * N.length)];
      if (Math.hypot(n.x - a.body.x, n.z - a.body.z) < radius) { br.goal = { x: n.x, y: n.y, z: n.z }; break; }
    }
    br.goalT = S.time + 12;
    br.path = null;
  }
  return br.goal;
}
function away(a, t) {
  const dx = a.body.x - t.body.x, dz = a.body.z - t.body.z, l = Math.hypot(dx, dz) || 1;
  return { x: a.body.x + dx / l * 6, y: a.body.y, z: a.body.z + dz / l * 6 };
}

function follow(a, br, goal, dt) {
  const body = a.body, G = nav(), N = G.nodes;
  const out = { x: 0, z: 0, jump: false, climb: false };
  br.repathT -= dt;
  const moved = br.goalKey !== Math.round(goal.x) + "," + Math.round(goal.z);
  if (!br.path || br.repathT <= 0 || (moved && br.repathT < 1.2)) {
    br.goalKey = Math.round(goal.x) + "," + Math.round(goal.z);
    const from = nearestNode(G, body.x, body.y, body.z), to = nearestNode(G, goal.x, goal.y, goal.z);
    br.path = findPath(G, from, to);
    br.pi = 1;
    br.repathT = 1.4 + a.rng();
    if (!br.path) { out.x = goal.x - body.x; out.z = goal.z - body.z; normalize(out); return out; }
  }
  // advance past waypoints we have reached
  while (br.pi < br.path.length) {
    const n = N[br.path[br.pi]];
    const h = Math.hypot(n.x - body.x, n.z - body.z);
    if (h < 1.1 && Math.abs(n.y - body.y) < 1.8) br.pi++;
    else break;
  }
  if (br.pi >= br.path.length) { out.x = goal.x - body.x; out.z = goal.z - body.z; if (Math.hypot(out.x, out.z) < 0.8) { out.x = out.z = 0; } normalize(out); return out; }
  const n = N[br.path[br.pi]];
  const kind = br.pi > 0 ? linkKind(G, br.path[br.pi - 1], br.path[br.pi]) : "walk";
  out.x = n.x - body.x; out.z = n.z - body.z;
  const h = Math.hypot(out.x, out.z);
  normalize(out);
  if (kind === "jump" && h < 2.4 && body.onGround) out.jump = true;
  if (kind === "climb" && h < 2.2) out.climb = true;
  // stuck: jump, and think again
  br.stuckT += dt;
  if (br.stuckT > 1) {
    const p = br.lastPos;
    if (p && Math.hypot(body.x - p.x, body.z - p.z) < 0.6) { out.jump = true; br.repathT = 0; }
    br.lastPos = { x: body.x, z: body.z };
    br.stuckT = 0;
  }
  return out;
}
function normalize(o) { const l = Math.hypot(o.x, o.z); if (l > 1e-6) { o.x /= l; o.z /= l; } }

/* ---------------------------------------------------------------
   Aiming and shooting
   --------------------------------------------------------------- */
function aimAt(a, br, D, t, dt, dist) {
  const e = eyeOf(a);
  const bone = a.rng() < br.head ? "head" : "chest";
  const i = BI[bone] * 3;
  let x = t.bones[i], y = t.bones[i + 1], z = t.bones[i + 2];
  const g = GUNS[a.arms.slots[a.arms.cur]];
  if (g && g.projectile) {
    // lead the target, and hold over for the drop
    const tt = dist / g.projectile.speed;
    x += t.body.vx * tt; z += t.body.vz * tt; y += (t.body.onGround ? 0 : t.body.vy * tt) + 0.5 * g.projectile.gravity * tt * tt;
  }
  const want = anglesTo(e[0], e[1], e[2], x, y, z);
  br.err.y *= Math.exp(-dt * 2.5); br.err.p *= Math.exp(-dt * 2.5);
  const k = Math.min(1, D.turn * dt);
  a.aim.yaw += wrapAngle(want.yaw + br.err.y - a.aim.yaw) * k;
  a.aim.pitch += (want.pitch + br.err.p - a.aim.pitch) * k;
  br.aimErr = Math.hypot(wrapAngle(want.yaw - a.aim.yaw), want.pitch - a.aim.pitch);
}

function weapons(a, br, D, cmd, t, dist) {
  const A = a.arms;
  if (t) {
    const guns = A.slots.map((id) => GUNS[id]);
    let pick = 0;
    const score = (g, i) => (A.ammo[i] > 0 ? 0 : -50) + (g.id === "talon" ? (dist > 30 ? 30 : -20) : 0) + (g.id === "mauler" ? (dist < 9 ? 30 : -25) : 0) + (g.auto ? 8 : 0) + (g.id === "brick" && dist > 12 ? 5 : 0);
    pick = score(guns[1], 1) > score(guns[0], 0) ? 1 : 0;
    if (A.cur !== pick && A.swapT <= 0 && A.cur < 2) cmd.slot = pick + 1;
    if (A.cur === 2) cmd.slot = pick + 1;
    const g = guns[A.cur] || null;
    if (dist < 2.2 && D.react < 0.4 && !br.meleeLast) { cmd.buttons |= B.MELEE; br.meleeLast = true; return; }
    br.meleeLast = false;
    if (!g) return;
    if (g.id === "talon" || dist > 25) cmd.buttons |= B.ADS;
    const tol = Math.atan2(g.pellets ? 1.2 : 0.35, Math.max(1, dist)) + (g.pellets ? 0.05 : 0);
    if (br.reactT <= 0 && br.aimErr < tol) {
      if (g.auto) cmd.buttons |= B.FIRE;
      else if (!br.fireLast) { cmd.buttons |= B.FIRE; br.fireLast = true; return; }
    }
    br.fireLast = false;
  } else {
    // quiet moment: top up the gun in hand
    const g = GUNS[A.slots[A.cur]];
    if (g && A.cur < 2 && A.ammo[A.cur] < g.mag * 0.5 && A.reloadT <= 0) cmd.buttons |= B.RELOAD;
    br.fireLast = false;
  }
}
