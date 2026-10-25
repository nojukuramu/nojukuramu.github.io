/* ghosts.js — what comes out of the lamps at the end.
 *
 * The fifth lamp is the house's last trick. When the breather is over, every
 * lamp you lit is a way in, and the dead of the house come through them: two
 * of them on a Normal night, one on Gentle, three on Merciless. They are not
 * the aswang, and they do not hunt the way it does:
 *
 *   rise   a few seconds coming up out of the lamp's light, in place;
 *   hunt   drawn to the living. Each knows roughly where you are — a guess
 *          that gets better the nearer it is, and is never the spot — and
 *          drifts there, through shut doors as if they were not there;
 *   chase  when it can see you it comes straight at you, faster than you
 *          walk and slower than you run. Lose it round a corner and it goes
 *          back to guessing.
 *
 * What keeps them fair: they come out of the lamps furthest from you; they
 * never know where you are until they see you; a lit lantern is seen from
 * across the house, a dark one from a few steps; they cannot open a closet
 * or see into one, and while you hide their guesses go wide; and every
 * metre they cover they move (tools/validate.js checks, as it does for the
 * hunter). Touch one and you are caught.
 *
 * Pure: no DOM, no three.js. The pathing is nav.js's, as the hunter's is. */

import { findPath, pathLength, sees, nearestFree, cx, cz } from "./nav.js";
import { roomAt, roomPath } from "./house.js";

/* metres a second, metres, seconds */
export const GHOST = { hunt: 1.5, chase: 2.85, rise: 2.8, reach: 0.65, sight: 7, sightLit: 17, sightCrouch: 3.5 };
/* how many, and how fast, for how afraid the player asked to be */
export const GHOSTS = { gentle: { n: 1, pace: 0.88 }, normal: { n: 2, pace: 1 }, merciless: { n: 3, pace: 1.12 } };

const ev = (g, e) => g.events.push(e);
const tuneOf = (g) => GHOSTS[g.fear] || GHOSTS.normal;

/** The lamps furthest from the player, by the walk, for ghosts to come out
    of — but none by the front door or on the rooms between the player and
    it: the way out is never guarded from the start, it is only ever reached
    first or not. */
function lampsFar(g) {
  const p = g.player, ex = g.L.exit;
  const route = new Set(roomPath(g.L, Math.max(0, roomAt(g.L, p.x, p.z)), Math.max(0, roomAt(g.L, ex.x, ex.z))));
  const all = g.L.lamps.filter((l) => l.lit).map((l) => {
    const path = findPath(g.G, p.x, p.z, l.front.x, l.front.z, null, 0);
    return { l, d: path ? pathLength(p.x, p.z, path) : Math.hypot(l.x - p.x, l.z - p.z), bad: Math.hypot(l.x - ex.x, l.z - ex.z) < 7 || route.has(l.room) };
  }).sort((a, b) => (a.bad - b.bad) || (b.d - a.d));
  return all;
}

function placeAt(g, gh, l, k) {
  // spread round the lamp's front when two come out of one lamp
  const a = k * 2.1;
  const c = nearestFree(g.G, l.front.x + Math.sin(a) * 0.5 * (k ? 1 : 0), l.front.z + Math.cos(a) * 0.5 * (k ? 1 : 0));
  gh.x = c >= 0 ? cx(g.G, c) : l.front.x; gh.z = c >= 0 ? cz(g.G, c) : l.front.z;
  gh.yaw = Math.atan2(g.player.x - gh.x, g.player.z - gh.z);
  gh.lamp = l.id;
}

/** They come out of the lamps: called when the house turns. */
export function spawn(g) {
  const far = lampsFar(g), n = tuneOf(g).n;
  g.ghosts = [];
  for (let i = 0; i < n && far.length; i++) {
    const gh = { id: i, x: 0, z: 0, yaw: 0, state: "rise", t: -i * 1.4, path: null, pi: 0, repathT: 0, aim: null, aimT: 0, sees: false, lostT: 0, lastSeen: null, speed: 0, moving: false, walked: 0, wailT: 4 + g.r() * 5, lamp: -1, d: 99 };
    placeAt(g, gh, far[i % far.length].l, Math.floor(i / far.length));
    g.ghosts.push(gh);
    ev(g, { type: "ghostRise", id: gh.id, x: gh.x, z: gh.z, lamp: gh.lamp, delay: Math.max(0, -gh.t) });
  }
}

/** After the player is caught and wakes: back into the lamps far away, to rise again. */
export function placeFar(g) {
  if (!g.ghosts || !g.ghosts.length) return;
  const far = lampsFar(g);
  g.ghosts.forEach((gh, i) => {
    placeAt(g, gh, far[i % far.length].l, Math.floor(i / far.length));
    // a head start: they take their time coming back
    Object.assign(gh, { state: "rise", t: -8 - i * 2, path: null, aim: null, sees: false, lostT: 0, speed: 0, moving: false });
  });
}

function sightOf(g) {
  const p = g.player;
  if (p.lantern && p.oil > 0) return GHOST.sightLit;
  return p.crouch ? GHOST.sightCrouch : GHOST.sight;
}

/* A guess at where the player is: within a few metres, nearer the nearer it
   is, much nearer while the lantern burns, and wide while they hide. Always
   somewhere a body could stand. */
function guess(g, gh, d) {
  const p = g.player, lit = p.lantern && p.oil > 0;
  // hidden long enough, and they lose the thread: anywhere in the house
  if (p.hiding >= 0 && p.hideT > 8) {
    const rm = g.L.rooms[Math.floor(g.r() * g.L.rooms.length)];
    const c = nearestFree(g.G, rm.cx + (g.r() - 0.5) * 2, rm.cz + (g.r() - 0.5) * 2);
    if (c >= 0) return { x: cx(g.G, c), z: cz(g.G, c) };
  }
  const err = p.hiding >= 0 ? 7 : lit ? Math.min(3, 1 + d * 0.1) : Math.min(8, 1.6 + d * 0.35);
  for (let k = 0; k < 12; k++) {
    const a = g.r() * Math.PI * 2, r = err * Math.sqrt(g.r());
    const c = nearestFree(g.G, p.x + Math.sin(a) * r, p.z + Math.cos(a) * r);
    if (c >= 0) return { x: cx(g.G, c), z: cz(g.G, c) };
  }
  return { x: p.x, z: p.z };
}

function turn(gh, target, rate) {
  let a = target - gh.yaw;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  gh.yaw += Math.max(-rate, Math.min(rate, a));
}

/* Along its path, through anything a door could shut. */
function drift(gh, dt, v) {
  gh.moving = false; gh.speed = 0;
  if (!gh.path || gh.pi >= gh.path.length) return true;
  let left = v * dt, moved = 0;
  while (left > 1e-6 && gh.pi < gh.path.length) {
    const q = gh.path[gh.pi], dx = q.x - gh.x, dz = q.z - gh.z, d = Math.hypot(dx, dz);
    if (d < 1e-4) { gh.pi++; continue; }
    const s = Math.min(d, left);
    gh.x += (dx / d) * s; gh.z += (dz / d) * s;
    left -= s; moved += s;
    turn(gh, Math.atan2(dx, dz), dt * 6);
    if (s >= d - 1e-6) gh.pi++;
  }
  gh.walked += moved;
  gh.speed = moved / dt;
  gh.moving = moved > 1e-4;
  return gh.pi >= gh.path.length;
}

export function step(g, dt) {
  if (!g.ghosts || !g.ghosts.length) { g.ghostDist = 99; return; }
  const p = g.player, pace = tuneOf(g).pace;
  let nearest = 99;
  for (const gh of g.ghosts) {
    gh.t += dt;
    const dx = p.x - gh.x, dz = p.z - gh.z, d = Math.hypot(dx, dz);
    gh.d = d;
    if (gh.state === "rise") {
      gh.moving = false; gh.speed = 0;
      turn(gh, Math.atan2(dx, dz), dt * 2);
      if (gh.t >= GHOST.rise) { gh.state = "hunt"; gh.aim = null; ev(g, { type: "ghostWake", id: gh.id, x: gh.x, z: gh.z }); }
      continue;
    }
    nearest = Math.min(nearest, d);
    // the touch
    if (g.state === "play" && p.hiding < 0 && d < GHOST.reach) { g.caught("ghost", gh); return; }
    // sight: it has to be able to see you, and a lantern is seen from far
    gh.sees = p.hiding < 0 && d < sightOf(g) && sees(g.G, gh.x, gh.z, p.x, p.z);
    if (gh.sees) {
      if (gh.state !== "chase") { gh.state = "chase"; gh.repathT = 0; ev(g, { type: "ghostChase", id: gh.id, x: gh.x, z: gh.z }); }
      gh.lostT = 0; gh.lastSeen = { x: p.x, z: p.z };
    } else if (gh.state === "chase") {
      gh.lostT += dt;
      if (gh.lostT > 1.6) { gh.state = "hunt"; gh.aim = gh.lastSeen; gh.aimT = 3; gh.repathT = 0; ev(g, { type: "ghostLost", id: gh.id, x: gh.x, z: gh.z }); }
    }
    // where it goes
    gh.repathT -= dt; gh.aimT -= dt;
    if (gh.state === "hunt" && (!gh.aim || gh.aimT <= 0)) { gh.aim = guess(g, gh, d); gh.aimT = 3 + g.r() * 2.5; gh.repathT = 0; }
    if (gh.repathT <= 0 || !gh.path) {
      const to = gh.state === "chase" ? (gh.sees ? p : gh.lastSeen) : gh.aim;
      gh.path = findPath(g.G, gh.x, gh.z, to.x, to.z, null, 0);
      gh.pi = 0;
      gh.repathT = gh.state === "chase" ? 0.3 : 1.5;
    }
    const arrived = drift(gh, dt, (gh.state === "chase" ? GHOST.chase : GHOST.hunt) * pace);
    // there and nobody: it waits a moment, then guesses again
    if (arrived && gh.state === "hunt") { gh.path = null; gh.aimT = Math.min(gh.aimT, 0.8); }
    // a cry now and then, from where it is
    gh.wailT -= dt;
    if (gh.wailT <= 0) { gh.wailT = (gh.state === "chase" ? 3.5 : 7) + g.r() * 6; ev(g, { type: "ghostWail", id: gh.id, x: gh.x, z: gh.z, d, chase: gh.state === "chase" }); }
  }
  g.ghostDist = nearest;
}
