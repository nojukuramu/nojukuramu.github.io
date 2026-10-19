/* hunter.js — the one thing in the house.
 *
 * One hunter, one state machine, no behaviour tree — the research's own
 * prescription (README, "Threat and AI a solo dev can build"):
 *
 *   patrol       walks between rooms in a deliberately imperfect order,
 *                stopping to listen; which room comes next is the director's
 *                choice (game.js), not the hunter's;
 *   investigate  goes to the last thing it heard or glimpsed, then searches
 *                round it in passes that tighten each time;
 *   chase        only when it has really seen you; it starts slow and gains
 *                speed for as long as it keeps you in sight, so breaking the
 *                line of sight — a corner, a door shut in its face — is the
 *                way out, and a straight hallway is not;
 *   retreat      after a chase, or when the player has had all they can take,
 *                it goes far away and stays there for the Relax timer;
 *   stare        it cannot follow you into a relit lamp's light (until the
 *                end), so it stops at the edge and looks at you;
 *   rip          it saw you get into that closet.
 *
 * What it knows is only what it sees and hears. The director nudges it
 * toward the part of the house you are in, never to the spot, and it never
 * teleports: every metre it covers, it walks (tools/validate.js checks).
 *
 * Its sounds are honest. Every footstep it makes is played where it is, so
 * the house teaches you to trust your ears. The tiktik call is honest too, in
 * the way the old stories say it is: loud when it is far, faint when it is near.
 *
 * Pure: no DOM, no three.js. */

import { findPath, sees, soundField, heardAt, poolAvoid, nearestFree, cx, cz, cellOf, RES } from "./nav.js";
import { roomAt, CELL, POOL_R } from "./house.js";

export const SPEED = { patrol: 1.25, search: 1.5, investigate: 1.95, pass: 1.45, retreat: 2.3, chase0: 2.7 };
const FOV = { calm: Math.PI / 3, chase: Math.PI * 0.95 };

export function newHunter() {
  return {
    active: false, x: -50, z: -50, yaw: 0, speed: 0, moving: false, state: "absent",
    path: null, pi: 0, goal: null, onArrive: null, wait: 0, look: 0, lookT: 0,
    aware: 0, sees: false, lastSeen: null, lostT: 0, chaseV: 0,
    search: null, sawHide: -1, ripT: 0, doorT: 0, doorId: -1, stareT: 0,
    stepD: 0, tikT: 14, growlT: 4, repathT: 0, visited: {}, room: -1, field: null, fieldT: 0,
    noticeT: 0, lastHeard: null, burnedT: 0, frozen: 0, pass: null, walked: 0
  };
}

const ev = (g, e) => g.events.push(e);
const avoidOf = (g) => poolAvoid(g.G, g.L.lamps, !g.flipped);
const tune = (g) => g.tune;

/* ---------- moving ---------- */

function goTo(g, x, z, then) {
  const h = g.hunter;
  // out of a lamp's light (or out of a pocket the light walls off), any way it can
  let p = h.burnedT > 0 ? null : findPath(g.G, h.x, h.z, x, z, avoidOf(g), 1.2);
  if (!p && (h.burnedT > 0 || inPool(g, h.x, h.z))) p = findPath(g.G, h.x, h.z, x, z, null, 1.2);
  h.path = p; h.pi = 0; h.goal = p ? { x: p[p.length - 1].x, z: p[p.length - 1].z } : null; h.onArrive = then || null;
  return !!p;
}

function inPool(g, x, z) {
  if (g.flipped) return false;
  for (const l of g.L.lamps) if (l.lit && Math.hypot(l.x - x, l.z - z) < POOL_R + 0.3) return true;
  return false;
}

/* A free spot somewhere in a room, out of any lamp's light before the end. */
function spotIn(g, room, r) {
  const rm = g.L.rooms[room], av = avoidOf(g);
  for (let k = 0; k < 20; k++) {
    const x = (rm.x + 0.15 + r() * (rm.w - 0.3)) * CELL, z = (rm.z + 0.15 + r() * (rm.h - 0.3)) * CELL;
    const c = cellOf(g.G, x, z);
    if (g.G.solid[c] || (av && av(c) === Infinity)) continue;
    return { x, z };
  }
  const c = nearestFree(g.G, rm.cx, rm.cz, av);
  return c >= 0 ? { x: cx(g.G, c), z: cz(g.G, c) } : null;
}

function walk(g, dt, v) {
  const h = g.hunter, G = g.G;
  h.moving = false;
  if (!h.path || h.pi >= h.path.length) return true;
  // a shut door ahead: it opens it. Slowly on a patrol, a slam in a chase.
  if (h.doorT > 0) {
    h.doorT -= dt;
    if (h.doorT <= 0) {
      const d = g.L.doors[h.doorId];
      d.open = 1;
      ev(g, { type: "door", id: d.id, open: true, slam: h.state === "chase" || h.state === "rip", who: "hunter" });
      g.noise(d.x, d.z, h.state === "chase" ? 10 : 6, "door", true);
    }
    return false;
  }
  const p = h.path[h.pi];
  const dx = p.x - h.x, dz = p.z - h.z, d = Math.hypot(dx, dz);
  const ux = dx / (d || 1), uz = dz / (d || 1);
  const ahead = cellOf(G, h.x + ux * 0.45, h.z + uz * 0.45);
  const did = G.door[ahead];
  if (did >= 0 && g.L.doors[did].open < 0.5 && G.door[cellOf(G, h.x, h.z)] !== did) {
    h.doorId = did;
    h.doorT = h.state === "chase" || h.state === "rip" ? 0.35 : 0.9;
    ev(g, { type: "doorTry", id: did, who: "hunter", hard: h.doorT < 0.5 });
    return false;
  }
  const step = Math.min(d, v * dt);
  h.x += ux * step; h.z += uz * step;
  h.walked += step;
  h.speed = step / dt;
  h.moving = step > 1e-4;
  if (d > 0.05) turn(h, Math.atan2(ux, uz), dt * (h.state === "chase" ? 9 : 4.5));
  // footsteps: honest, every one of them
  h.stepD += step;
  const stride = v > 3 ? 1.25 : 0.82;
  if (h.stepD >= stride) {
    h.stepD -= stride;
    ev(g, { type: "step", who: "hunter", x: h.x, z: h.z, run: v > 3, v });
  }
  if (d - step < 0.06) {
    h.pi++;
    if (h.pi >= h.path.length) { h.path = null; return true; }
  }
  return false;
}

function turn(h, target, rate) {
  let a = target - h.yaw;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  h.yaw += Math.max(-rate, Math.min(rate, a));
}

/* ---------- senses ---------- */

/* How far it can make you out from: the research's rule 3 — light shows the
   way but widens the hunter's sight. At the end, light is all it sees. */
export function sightRange(g) {
  const p = g.player, T = tune(g);
  let R;
  if (g.flipped && g.inPool) R = 22;
  else if (p.lantern && p.oil > 0) R = 8 + 10 * g.lanternPower;
  else R = p.crouch ? 2.2 : 3.6;
  if (g.hunter.state === "chase") R *= 1.35;
  return R * T.sight;
}

function perceive(g, dt) {
  const h = g.hunter, p = g.player;
  const dx = p.x - h.x, dz = p.z - h.z, d = Math.hypot(dx, dz);
  g.hunterDist = d;
  h.sees = false;
  if (p.hiding < 0 && g.state === "play") {
    const R = sightRange(g);
    if (d < R) {
      let ang = Math.atan2(dx, dz) - h.yaw;
      while (ang > Math.PI) ang -= Math.PI * 2;
      while (ang < -Math.PI) ang += Math.PI * 2;
      const fov = h.state === "chase" ? FOV.chase : FOV.calm;
      if ((Math.abs(ang) < fov || d < 1.4) && sees(g.G, h.x, h.z, p.x, p.z)) h.sees = true;
    }
    if (h.sees) {
      const k = (0.9 + 2.8 * Math.max(0, 1 - d / R)) * (p.lantern && p.oil > 0 ? 1.4 : 1) * tune(g).detect;
      h.aware = Math.min(1.2, h.aware + k * dt);
      h.lastSeen = { x: p.x, z: p.z, t: g.t };
    } else h.aware = Math.max(0, h.aware - 0.3 * dt);
  } else if (p.hiding >= 0) {
    h.aware = Math.max(0, h.aware - 0.3 * dt);
    // a lantern left burning in a closet shines out through the slats: it
    // takes a moment of looking to make that out, and the first visit is a
    // lesson, not a trap
    const c = g.L.closets[p.hiding];
    const glowing = p.lantern && p.oil > 0 && d < 9 && h.sawHide < 0 && h.state !== "pass" && h.state !== "stare" && h.state !== "retreat" && sees(g.G, h.x, h.z, c.front.x, c.front.z);
    h.glowT = glowing ? (h.glowT || 0) + dt : 0;
    if (h.glowT > 1.2) { h.sawHide = c.id; h.glowT = 0; ev(g, { type: "notice", why: "glow" }); }
  }
  // the end: a lit lantern is a beacon it always knows
  if (g.flipped && p.lantern && p.oil > 0 && p.hiding < 0 && g.litT > 1.2) h.lastSeen = { x: p.x, z: p.z, t: g.t, beacon: true };
}

/** A noise was made at (x,z), audible r metres along the floor. */
export function hear(g, x, z, r, kind) {
  const h = g.hunter;
  if (!h.active || h.state === "chase" || h.state === "rip" || h.state === "retreat" && kind !== "gasp") return false;
  if (!h.field || g.t - h.fieldT > 0.3) { h.field = soundField(g.G, h.x, h.z, 18); h.fieldT = g.t; }
  const pd = heardAt(g.G, h.field, x, z);
  if (pd > r) return false;
  // a gasp from inside a closet is a closet it now knows about
  if (kind === "gasp" && g.player.hiding >= 0) {
    h.sawHide = g.player.hiding;
    ev(g, { type: "heard", x, z, kind });
    return true;
  }
  if (h.state === "pass" || h.state === "stare") return false;
  // louder news replaces quieter news
  if (h.state === "investigate" && h.lastHeard && h.lastHeard.r > r && g.t - h.lastHeard.t < 4) return false;
  h.lastHeard = { x, z, r, t: g.t };
  ev(g, { type: "heard", x, z, kind });
  investigate(g, x, z, 3.5);
  return true;
}

/* ---------- states ---------- */

function setState(g, s) {
  const h = g.hunter;
  if (h.state === s) return;
  const was = h.state;
  h.state = s;
  ev(g, { type: "hstate", from: was, to: s });
}

export function investigate(g, x, z, radius) {
  const h = g.hunter;
  setState(g, "investigate");
  h.beacon = false;
  h.search = { x, z, r: radius || 3.5, passes: 3, at: null };
  h.wait = 0;
  goTo(g, x, z, () => searchNext(g));
}

function searchNext(g) {
  const h = g.hunter, s = h.search;
  if (!s || s.passes <= 0) { patrolNext(g); return; }
  s.passes--;
  h.wait = 1.4 + g.r() * 1.8;
  h.lookT = 0;
  const r = g.r;
  for (let k = 0; k < 10; k++) {
    const a = r() * Math.PI * 2, dd = s.r * (0.4 + 0.6 * r());
    const x = s.x + Math.sin(a) * dd, z = s.z + Math.cos(a) * dd;
    const c = cellOf(g.G, x, z);
    if (g.G.solid[c]) continue;
    s.at = { x, z };
    break;
  }
  s.r = Math.max(1.2, s.r - 1.1);
}

export function patrolNext(g) {
  const h = g.hunter;
  if (g.dir.relaxT > 0) { retreat(g); return; }
  setState(g, "patrol");
  const room = g.pickRoom();
  h.visited[room] = g.t;
  const s = spotIn(g, room, g.r);
  h.wait = 0;
  if (!s || !goTo(g, s.x, s.z, () => { h.wait = 2 + g.r() * 3.5; h.lookT = 0; })) h.wait = 1;
}

export function retreat(g) {
  const h = g.hunter;
  setState(g, "retreat");
  const pr = roomAt(g.L, g.player.x, g.player.z);
  const hops = g.L.graph.hops[pr >= 0 ? pr : 0];
  const order = g.L.rooms.filter((rm) => hops[rm.id] < Infinity).map((rm) => ({ id: rm.id, s: hops[rm.id] + g.r() * 0.8 + (rm.id === h.room ? -0.5 : 0) })).sort((a, b) => b.s - a.s);
  h.wait = 0;
  // the furthest room it can actually walk to
  for (const o of order) {
    const s = spotIn(g, o.id, g.r);
    if (s && goTo(g, s.x, s.z, () => { h.wait = 3; })) return;
  }
  h.wait = 2;
}

export function chase(g) {
  const h = g.hunter;
  if (h.state !== "chase") {
    setState(g, "chase");
    h.chaseV = SPEED.chase0;
    h.lostT = 0;
    ev(g, { type: "chase" });
  }
}

function stare(g, t) {
  const h = g.hunter;
  setState(g, "stare");
  h.stareT = t; h.path = null;
}

/* ---------- the step ---------- */

export function step(g, dt) {
  const h = g.hunter;
  if (!h.active) return;
  const p = g.player;
  h.room = roomAt(g.L, h.x, h.z);
  perceive(g, dt);
  const d = g.hunterDist;
  const inLight = g.inPool && !g.flipped;

  // a lamp lit right where it stands burns it: it shrieks and backs off
  if (!g.flipped && h.burnedT <= 0) {
    for (const l of g.L.lamps) if (l.lit && Math.hypot(l.x - h.x, l.z - h.z) < POOL_R - 0.3) {
      h.burnedT = 6; ev(g, { type: "burned", x: h.x, z: h.z });
      h.aware = 0; retreat(g); break;
    }
  }
  if (h.burnedT > 0) h.burnedT -= dt;

  // caught
  if (g.state === "play" && d < 0.85 && p.hiding < 0 && (h.state === "chase" || h.state === "investigate" || h.state === "patrol" || h.state === "search") && !inLight) {
    g.caught("touch");
    return;
  }

  // what it sees changes what it is doing
  if (h.sees && h.state !== "rip" && h.state !== "retreat" && h.state !== "pass" && h.state !== "stare") {
    if (h.aware >= 1) {
      if (inLight) stare(g, 2.5 + g.r() * 1.5);
      else chase(g);
    } else if (h.aware >= 0.35 && h.state !== "chase" && h.noticeT <= 0) {
      // something moved over there: it stops and turns to look
      h.noticeT = 1.5;
      h.frozen = 0.55;
      ev(g, { type: "notice", why: "sight" });
      investigate(g, p.x, p.z, 2.5);
    }
  }
  if (h.state === "pass" && h.sees && h.aware >= 1 && !h.pass.sighted) {
    // seen during the first pass: it stops and looks at you, and that is all
    h.pass.sighted = true; h.pass.seenNow = true;
    stare(g, 2.4);
    h.pass.resume = true;
    g.flags.seenInPass = true;
  }
  if (h.noticeT > 0) h.noticeT -= dt;

  // the beacon at the end: it comes straight for a lit lantern
  if (g.flipped && h.lastSeen && h.lastSeen.beacon && g.t - h.lastSeen.t < 0.2 && h.state !== "chase" && h.state !== "rip") {
    if (h.state !== "investigate" || !h.search || Math.hypot(h.search.x - p.x, h.search.z - p.z) > 2) investigate(g, p.x, p.z, 2);
    h.beacon = true;
  }

  if (h.frozen > 0) { h.frozen -= dt; turn(h, Math.atan2(p.x - h.x, p.z - h.z), dt * 5); h.moving = false; return; }

  switch (h.state) {
    case "chase": {
      // it saw you get into that closet: straight there
      if (h.sawHide >= 0) { setState(g, "rip"); h.path = null; h.goalCloset = -1; break; }
      if (h.sees) { h.lostT = 0; h.chaseV = Math.min(tune(g).vmax, h.chaseV + 0.42 * dt); }
      else { h.lostT += dt; h.chaseV = Math.max(SPEED.chase0, h.chaseV - 0.6 * dt); }
      if (inLight) { stare(g, 2.5 + g.r() * 1.5); break; }
      if (h.lostT > 2.2) {
        ev(g, { type: "lost" });
        const ls = h.lastSeen || { x: p.x, z: p.z };
        h.aware = 0.3;
        investigate(g, ls.x, ls.z, 3.5);
        if (g.dir.wantRelax) { g.dir.wantRelax = false; g.relax(); }
        break;
      }
      h.repathT -= dt;
      const tgt = h.sees ? p : h.lastSeen || p;
      if (h.repathT <= 0 || !h.path) { h.repathT = 0.25; goTo(g, tgt.x, tgt.z); }
      walk(g, dt, h.chaseV);
      break;
    }
    case "rip": {
      if (h.ripT > 0) {
        // the closet it is at, not whichever one you are in now
        const c = g.L.closets[h.ripId];
        h.ripT -= dt;
        turn(h, Math.atan2(c.x - h.x, c.z - h.z), dt * 6);
        if (h.ripT <= 0) {
          ev(g, { type: "closetRip", id: c.id });
          if (p.hiding === c.id) { g.caught("closet"); return; }
          h.sawHide = -1;
          investigate(g, c.front.x, c.front.z, 3);
        }
        break;
      }
      const c = g.L.closets[h.sawHide];
      if (!h.path || h.goalCloset !== c.id) {
        h.goalCloset = c.id;
        // it cannot get to it (a lamp's light is in the way): it gives up on it
        if (!goTo(g, c.front.x, c.front.z)) { h.sawHide = -1; investigate(g, c.front.x, c.front.z, 3); break; }
      }
      walk(g, dt, Math.max(SPEED.investigate, h.chaseV || 0));
      if (Math.hypot(c.front.x - h.x, c.front.z - h.z) < 1.0) {
        h.path = null; h.ripId = c.id;
        h.ripT = 1.6 + g.r() * 0.7;
        ev(g, { type: "closetRattle", id: c.id });
      } else if (!h.path) h.goalCloset = -1;
      break;
    }
    case "stare": {
      h.moving = false;
      turn(h, Math.atan2(p.x - h.x, p.z - h.z), dt * 6);
      h.stareT -= dt;
      if (h.stareT <= 0) {
        if (h.pass && h.pass.resume) {
          // a flash, and it is leaving — fast if it saw you, unhurried if it did not
          const fast = h.pass.seenNow;
          h.pass.resume = false; h.pass.seenNow = false;
          setState(g, "pass");
          if (fast) ev(g, { type: "lightning", power: 1, thunder: 0.4, scripted: true });
          h.passFast = fast;
          goTo(g, h.pass.out.x, h.pass.out.z, () => passDone(g));
        }
        else { ev(g, { type: "turnAway" }); g.relax(); }
      }
      break;
    }
    case "pass": {
      if (walk(g, dt, h.passFast ? 2.6 : SPEED.pass) && h.onArrive) { const f = h.onArrive; h.onArrive = null; f(); }
      break;
    }
    default: {
      // a closet it knows about is the first thing it goes to — unless it is
      // walking away for its Relax, and then it has let you go
      if (h.sawHide >= 0 && h.state === "retreat") h.sawHide = -1;
      if (h.sawHide >= 0 && h.state !== "rip") { setState(g, "rip"); h.path = null; h.goalCloset = -1; break; }
      if (h.wait > 0) {
        h.wait -= dt; h.moving = false;
        // listening: the head goes one way, then the other
        h.lookT += dt;
        turn(h, h.yaw + Math.sin(h.lookT * 1.3) * 0.9, dt * 1.6);
        if (h.wait <= 0) {
          if (h.state === "investigate" && h.search) {
            if (h.search.at) { const a = h.search.at; h.search.at = null; goTo(g, a.x, a.z, () => searchNext(g)); }
            else patrolNext(g);
          } else if (h.state === "retreat") {
            if (g.dir.relaxT > 0) h.wait = 2 + g.r() * 2; else patrolNext(g);
          } else patrolNext(g);
        }
        break;
      }
      const v = h.state === "investigate" ? SPEED.investigate * (h.beacon ? 1.35 : 1) : h.state === "retreat" ? SPEED.retreat : SPEED.patrol * (g.flipped ? 1.25 : 1);
      if (!h.path) { if (h.state === "investigate" && h.search && h.search.at) { const a = h.search.at; h.search.at = null; goTo(g, a.x, a.z, () => searchNext(g)); } else if (h.state === "investigate" && h.search) searchNext(g); else if (h.state === "retreat") { h.wait = 2; } else patrolNext(g); break; }
      if (walk(g, dt, v)) { const f = h.onArrive; h.onArrive = null; if (f) f(); else h.wait = 1; }
    }
  }

  // calls and breath: the tiktik far off, a wet breath close by
  if (h.state !== "chase" && h.state !== "rip") {
    h.tikT -= dt;
    if (h.tikT <= 0) { h.tikT = 13 + g.r() * 16; if (d > 7) ev(g, { type: "tiktik", x: h.x, z: h.z, d }); }
  }
  h.growlT -= dt;
  if (h.growlT <= 0) { h.growlT = h.state === "chase" ? 1.6 + g.r() : 3 + g.r() * 4; if (d < 9) ev(g, { type: "breath", x: h.x, z: h.z, chase: h.state === "chase" }); }
}

/* ---------- arriving and the scripted first pass ---------- */

/** It comes in through a window, far from the player. */
export function enter(g, from) {
  const h = g.hunter;
  const w = from;
  const n = w.n;
  h.x = w.x - n[0] * 0.9; h.z = w.z - n[1] * 0.9;
  const c = nearestFree(g.G, h.x, h.z);
  if (c >= 0) { h.x = cx(g.G, c); h.z = cz(g.G, c); }
  h.yaw = Math.atan2(-n[0], -n[1]);
  h.active = true;
  ev(g, { type: "enter", window: w.id, x: h.x, z: h.z });
}

/* The one minute of scripting the research allows: it comes in, walks through
   the room you are in or the one beside it, and leaves without touching you. */
export function startPass(g, win, via, out) {
  const h = g.hunter;
  enter(g, win);
  h.pass = { via, out, sighted: false, seenNow: false, resume: false };
  setState(g, "pass");
  h.passFast = false;
  goTo(g, via.x, via.z, () => {
    h.wait = 0;
    // it stops, listens, and goes
    if (h.state !== "pass") return;
    stare(g, 2.2);
    h.pass.resume = true;
  });
}

function passDone(g) {
  const h = g.hunter;
  h.pass = null; h.passFast = false;
  g.passDone();
}

/** Put it somewhere far, quietly: after the player dies (a cut, not a teleport in play). */
export function placeFar(g) {
  const h = g.hunter;
  const pr = roomAt(g.L, g.player.x, g.player.z);
  const hops = g.L.graph.hops[pr >= 0 ? pr : 0];
  let best = 0, bs = -1;
  for (const rm of g.L.rooms) { const sc = hops[rm.id] + g.r(); if (hops[rm.id] < Infinity && sc > bs) { bs = sc; best = rm.id; } }
  const s = spotIn(g, best, g.r) || { x: g.L.rooms[best].cx, z: g.L.rooms[best].cz };
  h.x = s.x; h.z = s.z; h.path = null; h.aware = 0; h.sawHide = -1; h.chaseV = 0; h.wait = 3;
  h.doorT = 0; h.doorId = -1; h.ripT = 0; h.burnedT = 0;
  setState(g, "retreat");
}

export { RES };
