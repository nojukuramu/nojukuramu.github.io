/* game.js — the rules of the walk.
 *
 * Pure: no DOM, no three. main.js steps it in slices no longer than a 60 Hz
 * frame and hands the events it leaves to the renderer, the speakers and the
 * screen; tools/validate.js imports it straight into Node and walks whole
 * journeys with an autopilot. The shape is Last Flame's (lastflame/js/game.js):
 * newRun, step(g, dt, input), events, target and prompt.
 *
 * Three meters, none shown unless asked for (design: "gentle survival"):
 *   food    drains slowly, faster when you hurry or shiver; camps hold food,
 *           and fish come up through the holes in the sea ice
 *   warmth  goes toward what the place you are in allows: sun on you or not,
 *           wind, the night coming, a hut, a stove, a fire
 *   fuel    carried in cans; beacons and stoves burn it, the lantern sips it
 * and a meter at zero is a blackout, never a death on Easy (the table in the
 * design document, DIFF in places.js). */

import { surface, heightAt, SEA_ICE_Y, HALF } from "./world.js";
import { buildPlaces, DIFF, CAT, hutLocal, hutAt } from "./places.js";
import { sunDir, dayOf, sunWarmth, nightness, DAY } from "./sun.js";
import { rng } from "./rng.js";

export const EYE = 1.68, PLAYER_R = 0.3;
export const SPEED = { walk: 1.9, brisk: 3.3 };
export const REACH = 2.3;
const LANTERN_BURN = 1 / 1500;      // fuel units a second with the lantern lit: one can lasts 25 minutes
const POST_COST = 0.2, FISH_PER_HOLE = 4;
export const FOOD = { cans: 0.3, rations: 0.45, fish: 0.14, cooked: 0.38 };
const HOLD = { beacon: 2.4, mast: 3.2, stone: 1.1, repair: 3.6, stove: 1.2 };

function ev(g, e) { g.events.push(e); return e; }
function hint(g, key, text, prio) {
  if (g.hinted[key]) return;
  g.hinted[key] = true;
  g.hint = { key, text, t: g.t, prio: prio || 1 };
  ev(g, { type: "hint", text });
}

/* ------------------------------------------------------------------ */
/* A journey                                                          */

/**
 * A new journey on a world already built (world.js; the page builds it in a
 * worker). `o`: { diff, saved }.
 */
export function newRun(W, o) {
  o = o || {};
  const diff = DIFF[o.diff] ? o.diff : "normal";
  const P = buildPlaces(W, diff);
  const base = W.sites[0], bunk = P.huts[base.wake.hut];
  // he wakes by the beds, in the clear floor between them and the door
  const wake = { x: bunk.x, z: bunk.z };
  { const c = Math.cos(bunk.rot), s = Math.sin(bunk.rot), lx = -bunk.w / 2 + 1.1, lz = bunk.d / 2 - 0.75; wake.x = bunk.x + lx * c + lz * s; wake.z = bunk.z - lx * s + lz * c; }
  const g = {
    W, P, diff, D: DIFF[diff], seed: W.seed,
    t: 0, clock: 0, season: 0, sun: sunDir(dayOf(0), 0), state: "play",
    p: {
      x: wake.x, z: wake.z, y: bunk.floor, eye: EYE,
      yaw: bunk.rot, pitch: 0, vx: 0, vz: 0, speed: 0, moving: false, brisk: false, inside: bunk.id,
      warmth: 0.62, food: 0.66, fuel: 0, items: { cans: 0, rations: 0, fish: 0, cooked: 0 },
      keys: { lantern: false, compass: false, map: false, line: false, toolbox: false },
      lantern: false, stepD: 0, foot: 0, weakT: 0, blackouts: 0, stone: false, hold: 0, holdKind: null
    },
    lit: W.beacons.map(() => false),
    stoves: P.huts.map(() => 0),            // seconds of burn left
    doors: P.huts.map(() => 0),             // 0 shut, 1 open
    taken: P.props.map(() => false),
    read: {}, posts: P.posts.map(() => false), cairns: P.cairns.map((c) => c.stones), loose: P.loose.map(() => false),
    masts: P.masts.map((m) => !m.down), radios: {}, holes: P.holes.map(() => FISH_PER_HOLE),
    weather: { wind: 0.3, whiteout: 0, state: "calm", next: 0, end: 0, gust: 0 },
    shade: 0, shadeT: 0, exposure: 1, near: { fire: 0, sea: 0, glacier: 0 },
    progress: 0, lineI: 0, visited: W.sites.map((s, i) => i === 0),
    fishing: null, rare: { done: {}, light: null }, ending: null, crackT: 20,
    hinted: {}, hint: null, events: [], outT: 0,
    stats: { distance: 0, beacons: 0, notes: 0, fish: 0, cairns: 0, posts: 0, masts: 0, blackouts: 0, eaten: 0 }
  };
  // some drums still hold fuel: the base's, the station's, one at each camp
  g.drumFuel = P.props.map((q) => (q.kind === "drum" && q.inside < 0 ? (q.id % 3 === 0 ? 1 : 0) : 0));
  const wr = rng((W.seed ^ 0x77e) >>> 0);
  g.wr = wr;
  g.weather.next = 600 + wr() * 400;
  g.p.yaw = bunk.rot + Math.PI * 0.5;
  if (o.saved) restore(g, o.saved);
  g.sun = sunDir(dayOf(g.clock), g.season);
  return g;
}

/* ------------------------------------------------------------------ */
/* Saving: the journey is long, and a phone gets put down              */

export function snapshot(g) {
  const p = g.p;
  return {
    v: 1, seed: g.seed, diff: g.diff, t: g.t, clock: g.clock, season: g.season,
    p: { x: p.x, z: p.z, yaw: p.yaw, warmth: p.warmth, food: p.food, fuel: p.fuel, items: p.items, keys: p.keys, lantern: p.lantern, weakT: p.weakT, blackouts: p.blackouts, stone: p.stone },
    lit: g.lit, stoves: g.stoves, doors: g.doors, taken: g.taken, drumFuel: g.drumFuel, read: g.read, posts: g.posts, cairns: g.cairns,
    loose: g.loose, masts: g.masts, radios: g.radios, holes: g.holes, progress: g.progress, visited: g.visited, rare: g.rare.done,
    stats: g.stats, hinted: g.hinted
  };
}
function restore(g, s) {
  if (!s || s.v !== 1 || s.seed !== g.seed) return;
  g.t = s.t; g.clock = s.clock; g.season = s.season;
  Object.assign(g.p, s.p, { vx: 0, vz: 0 });
  for (const k of ["lit", "stoves", "doors", "taken", "drumFuel", "posts", "cairns", "loose", "masts", "holes", "visited"]) if (Array.isArray(s[k]) && s[k].length === g[k].length) g[k] = s[k];
  g.read = s.read || {}; g.radios = s.radios || {}; g.progress = s.progress || 0; g.rare.done = s.rare || {};
  g.stats = Object.assign(g.stats, s.stats || {}); g.hinted = s.hinted || {};
  g.p.y = groundAt(g, g.p.x, g.p.z);
  g.p.inside = hutAt(g.P, g.p.x, g.p.z);
  g.weather.next = g.t + 300;
}

/* ------------------------------------------------------------------ */
/* The ground                                                         */

const _s = {};
/** What you stand on at (x,z): a hut's floor, or the snow. */
export function groundAt(g, x, z) {
  const h = hutAt(g.P, x, z);
  if (h >= 0) return g.P.huts[h].floor;
  return heightAt(g.W, x, z);
}

/* Can a body stand at (x,z)? Open water, the inside of a crack and the
   world's edge say no; walls and furniture are handled by push-out. */
function standable(g, x, z) {
  if (Math.abs(x) > HALF - 30 || Math.abs(z) > HALF - 30) return false;
  if (hutAt(g.P, x, z) >= 0) return true;
  const s = surface(g.W, x, z, _s);
  if (s.water > 0.35) return false;
  if (s.crevasse > 0.3) return false;
  return true;
}

/* Walls and things, as circles and boxes near (x,z). */
function obstacles(g, x, z) {
  const out = [];
  const P = g.P;
  for (const h of P.huts) {
    if (Math.abs(h.x - x) > 14 || Math.abs(h.z - z) > 14) continue;
    const t = 0.08, w = h.w / 2, d = h.d / 2, open = g.doors[h.id] > 0.5;
    const dl = h.door.off - h.door.w / 2, dr = h.door.off + h.door.w / 2;
    // the walls, as boxes in the hut's frame: back, left, right, and the front either side of the door
    out.push({ hut: h, cx: 0, cz: -d, hx: w + t, hz: t });
    out.push({ hut: h, cx: -w, cz: 0, hx: t, hz: d + t });
    out.push({ hut: h, cx: w, cz: 0, hx: t, hz: d + t });
    out.push({ hut: h, cx: (-w + dl) / 2, cz: d, hx: (dl + w) / 2 + t, hz: t });
    out.push({ hut: h, cx: (dr + w) / 2, cz: d, hx: (w - dr) / 2 + t, hz: t });
    if (!open) out.push({ hut: h, cx: h.door.off, cz: d, hx: h.door.w / 2, hz: t });
  }
  for (const q of P.props) {
    if (!q.solid || Math.abs(q.x - x) > 6 || Math.abs(q.z - z) > 6) continue;
    const c = CAT[q.kind];
    if (c.box) out.push({ rot: q.rot, px: q.x, pz: q.z, hx: c.box[0], hz: c.box[1] });
    else if (c.r) out.push({ px: q.x, pz: q.z, r: c.r });
  }
  for (const m of P.masts) if (Math.abs(m.x - x) < 5 && Math.abs(m.z - z) < 5) out.push({ px: m.x, pz: m.z, r: m.kind === "radio" ? 1.3 : 0.25 });
  for (const b of g.W.beacons) if (Math.abs(b.x - x) < 5 && Math.abs(b.z - z) < 5) out.push({ px: b.x, pz: b.z, r: b.big ? 1.6 : 0.75 });
  for (const t of P.tents) if (Math.abs(t.x - x) < 5 && Math.abs(t.z - z) < 5) out.push({ px: t.x, pz: t.z, r: 1.35 });
  for (const s of P.sleds) if (Math.abs(s.x - x) < 5 && Math.abs(s.z - z) < 5) out.push({ rot: s.rot, px: s.x, pz: s.z, hx: 0.5, hz: 1.4 });
  for (const c of P.cairns) if (Math.abs(c.x - x) < 4 && Math.abs(c.z - z) < 4) out.push({ px: c.x, pz: c.z, r: 0.45 });
  for (const q of P.posts) if (Math.abs(q.x - x) < 4 && Math.abs(q.z - z) < 4) out.push({ px: q.x, pz: q.z, r: 0.12 });
  return out;
}

/* Push a circle at (x,z) out of everything in `obs`. */
function pushOut(x, z, r, obs) {
  for (let it = 0; it < 3; it++) {
    for (const o of obs) {
      if (o.r !== undefined) {
        const dx = x - o.px, dz = z - o.pz, d = Math.hypot(dx, dz), m = o.r + r;
        if (d < m && d > 1e-6) { x = o.px + (dx / d) * m; z = o.pz + (dz / d) * m; }
        continue;
      }
      // a box, in its own frame (a hut's walls, or something with a footprint)
      let ox, oz, rot;
      if (o.hut) { const w = o.hut; const c = Math.cos(w.rot), s = Math.sin(w.rot); ox = w.x + o.cx * c + o.cz * s; oz = w.z - o.cx * s + o.cz * c; rot = w.rot; }
      else { ox = o.px; oz = o.pz; rot = o.rot || 0; }
      const c = Math.cos(rot), s = Math.sin(rot), dx = x - ox, dz = z - oz;
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      const qx = Math.max(-o.hx, Math.min(o.hx, lx)), qz = Math.max(-o.hz, Math.min(o.hz, lz));
      const ex = lx - qx, ez = lz - qz, d = Math.hypot(ex, ez);
      if (d >= r) continue;
      if (d < 1e-6) {
        // inside the box: out through the nearest face
        let nlx = lx, nlz = lz;
        if (o.hx - Math.abs(lx) < o.hz - Math.abs(lz)) nlx = (Math.sign(lx) || 1) * (o.hx + r);
        else nlz = (Math.sign(lz) || 1) * (o.hz + r);
        x = ox + nlx * c + nlz * s; z = oz - nlx * s + nlz * c;
        continue;
      }
      const k = r / d, nlx = qx + ex * k, nlz = qz + ez * k;
      x = ox + nlx * c + nlz * s; z = oz - nlx * s + nlz * c;
    }
  }
  return { x, z };
}

/* One step of walking: slide along what stops you. */
function move(g, dx, dz) {
  const p = g.p;
  const tryAt = (nx, nz) => {
    if (!standable(g, nx, nz)) return null;
    const h0 = p.y, h1 = groundAt(g, nx, nz), run = Math.hypot(nx - p.x, nz - p.z);
    // a face steeper than about 42 degrees cannot be walked up; a hut's
    // step (the stilts) can, from its door
    if (run > 1e-4 && h1 - h0 > Math.max(0.55, run * 0.9)) return null;
    return { x: nx, z: nz };
  };
  const obs = obstacles(g, p.x + dx, p.z + dz);
  let r = tryAt(p.x + dx, p.z + dz) || tryAt(p.x + dx, p.z) || tryAt(p.x, p.z + dz);
  if (!r) return false;
  r = pushOut(r.x, r.z, PLAYER_R, obs);
  if (!standable(g, r.x, r.z)) return false;
  p.x = r.x; p.z = r.z;
  return true;
}

/* ------------------------------------------------------------------ */
/* The step                                                           */

export function step(g, dt, input) {
  g.events = [];
  input = input || {};
  const p = g.p;
  g.t += dt;
  g.clock += dt;
  seasonStep(g, dt);
  g.sun = sunDir(dayOf(g.clock), g.season, g.sun);
  weatherStep(g, dt);

  if (g.state === "out") { outStep(g, dt); return; }
  if (g.state === "over") return;

  // looking
  p.yaw = input.yaw !== undefined ? input.yaw : p.yaw;
  p.pitch = input.pitch !== undefined ? input.pitch : p.pitch;

  // walking (not while a line is down a hole)
  if (g.fishing && (Math.hypot(input.fwd || 0, input.side || 0) > 0.2)) { g.fishing = null; ev(g, { type: "fishStop" }); }
  if (!g.fishing) walk(g, dt, input);
  else { p.vx = p.vz = 0; p.speed = 0; p.moving = false; }
  p.y = groundAt(g, p.x, p.z);
  p.inside = hutAt(g.P, p.x, p.z, 0.05);

  around(g, dt);
  meters(g, dt);
  use(g, dt, input);
  fishStep(g, dt, input);
  progressStep(g, dt);
  rares(g, dt);
  sounds(g, dt);
  hintsStep(g);
  endingStep(g, dt);
}

function walk(g, dt, input) {
  const p = g.p;
  let mf = input.fwd || 0, ms = input.side || 0;
  const ml = Math.hypot(mf, ms);
  if (ml > 1) { mf /= ml; ms /= ml; }
  p.brisk = !!input.run && mf > 0.1;
  let sp = p.brisk ? SPEED.brisk : SPEED.walk;
  if (p.weakT > 0) { p.weakT -= dt; sp *= 0.72; }
  // uphill is slower; the whiteout makes you careful
  const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
  const wx = (fx * mf - fz * ms), wz = (fz * mf + fx * ms);
  if (ml > 0.05) {
    const ahead = heightAt(g.W, p.x + wx * 1.5, p.z + wz * 1.5) - heightAt(g.W, p.x, p.z);
    const grade = ahead / 1.5;
    if (grade > 0) sp *= Math.max(0.45, 1 - grade * 1.3);
    sp *= 1 - 0.25 * g.weather.whiteout;
  }
  const acc = ml > 0.05 ? 7 : 9;
  p.vx += (wx * sp - p.vx) * Math.min(1, acc * dt);
  p.vz += (wz * sp - p.vz) * Math.min(1, acc * dt);
  const ox = p.x, oz = p.z;
  move(g, p.vx * dt, p.vz * dt);
  const moved = Math.hypot(p.x - ox, p.z - oz);
  p.speed = moved / dt; p.moving = p.speed > 0.3;
  g.stats.distance += moved;
  // steps: each one a sound and, outside, a print in the snow
  p.stepD += moved;
  const stride = p.brisk ? 0.95 : 0.74;
  if (p.stepD >= stride) {
    p.stepD -= stride;
    p.foot ^= 1;
    const s = p.inside >= 0 ? null : surface(g.W, p.x, p.z, _s);
    ev(g, { type: "step", x: p.x, z: p.z, foot: p.foot, yaw: Math.atan2(p.vx, p.vz), brisk: p.brisk, floor: p.inside >= 0, ice: s ? s.seaIce > 0.5 : false, rock: s ? s.rock > 0.5 : false });
  }
}

/* What is round you: shade from the sun, the wind's reach, fire, the sea. */
function around(g, dt) {
  const p = g.p, W = g.W, sun = g.sun;
  g.shadeT -= dt;
  if (g.shadeT <= 0) {
    g.shadeT = 0.4;
    g.shade = p.inside >= 0 ? 1 : sun.y <= 0.005 ? 1 : shadowed(g, p.x, p.y + 1.2, p.z, sun) ? 1 : 0;
    // the wind: a hut close upwind breaks it, a hut round you stops it
    let ex = 1;
    if (p.inside >= 0) ex = g.doors[p.inside] > 0.5 ? 0.25 : 0;
    else {
      for (const h of g.P.huts) {
        const dx = h.x - p.x, dz = h.z - p.z, d = Math.hypot(dx, dz);
        if (d > 7) continue;
        // upwind: the wind blows along W.wind, so shelter is the other way
        if ((dx * -W.wind.x + dz * -W.wind.z) / (d || 1) > 0.5) ex = Math.min(ex, 0.35 + d * 0.06);
      }
      for (const t of g.P.tents) { const d = Math.hypot(t.x - p.x, t.z - p.z); if (d < 3) ex = Math.min(ex, 0.6); }
    }
    g.exposure = ex;
    // fire: lit beacons near, a stove in the hut you are in
    let fire = 0;
    for (let i = 0; i < W.beacons.length; i++) {
      if (!g.lit[i]) continue;
      const b = W.beacons[i], d = Math.hypot(b.x - p.x, b.z - p.z);
      if (d < 9) fire = Math.max(fire, (1 - d / 9) * (b.big ? 1 : 0.85));
    }
    if (p.inside >= 0 && g.stoves[p.inside] > 0) fire = Math.max(fire, 1);
    else for (let h = 0; h < g.P.huts.length; h++) if (g.stoves[h] > 0) { const H = g.P.huts[h]; const d = Math.hypot(H.x - p.x, H.z - p.z); if (d < 4) fire = Math.max(fire, 0.15); }
    g.near.fire = fire;
    const s = surface(W, p.x, p.z, _s);
    g.near.seaIce = s.seaIce; g.near.glacier = s.gl; g.near.rock = s.rock;
  }
  for (let h = 0; h < g.stoves.length; h++) if (g.stoves[h] > 0) { g.stoves[h] = Math.max(0, g.stoves[h] - dt); if (!g.stoves[h]) ev(g, { type: "stoveOut", hut: h }); }
}

/** Is (x,y,z) in the shadow of the land, or of a hut, toward the sun? */
export function shadowed(g, x, y, z, sun) {
  const W = g.W;
  const hd = Math.hypot(sun.x, sun.z) || 1e-6, tan = sun.y / hd, dx = sun.x / hd, dz = sun.z / hd;
  // the land: march toward the sun, further each step (a mountain 2 km away
  // can shade you at a low sun, a drift a few metres away can too)
  for (let d = 2; d < 2600; d *= 1.32) {
    const px = x + dx * d, pz = z + dz * d;
    if (Math.abs(px) > HALF || Math.abs(pz) > HALF) break;
    if (heightAt(W, px, pz) > y + d * tan) return true;
  }
  // huts within reach of their own shadow
  for (const h of g.P.huts) {
    const top = h.floor + h.h + 0.4, ddx = h.x - x, ddz = h.z - z;
    if (Math.hypot(ddx, ddz) > 4 + (top - y) / Math.max(0.05, tan)) continue;
    // where the ray toward the sun is at the hut's distance, is it under the roof line and over the footprint?
    for (let d = 0.5; d < 40; d += 0.5) {
      const ry = y + d * tan;
      if (ry > top) break;
      const l = hutLocal(h, x + dx * d, z + dz * d);
      if (Math.abs(l.x) < h.w / 2 + 0.1 && Math.abs(l.z) < h.d / 2 + 0.1 && ry > h.floor - 0.6) return true;
    }
  }
  return false;
}

/* The three meters. */
function meters(g, dt) {
  const p = g.p, D = g.D, sun = g.sun, w = g.weather;
  const night = nightness(sun.el);
  let target, tauUp;
  if (p.inside >= 0) {
    const open = g.doors[p.inside] > 0.5;
    target = 0.74 - (open ? 0.18 : 0) - 0.2 * g.season + (g.stoves[p.inside] > 0 ? 0.65 : 0);
    tauUp = g.stoves[p.inside] > 0 ? 40 : 90;
  } else {
    const sunK = sunWarmth(sun.el) * (1 - g.shade) * (1 - w.whiteout);
    target = 0.6 + 0.32 * sunK - 0.42 * w.wind * g.exposure - 0.1 * g.shade * (sun.el > 0 ? 1 : 0) - 0.32 * night - 0.18 * g.season - 0.2 * w.whiteout;
    if (p.brisk) target += 0.07;
    tauUp = 240;
  }
  if (p.food < 0.15) target -= 0.15;
  target += 0.8 * g.near.fire;
  if (g.near.fire > 0) tauUp = Math.min(tauUp, 45);
  const tau = target > p.warmth ? tauUp : D.tauCold * (p.weakT > 0 ? 0.8 : 1);
  p.warmth += (Math.min(1.05, target) - p.warmth) * Math.min(1, dt / tau);
  p.warmth = Math.min(1, p.warmth);
  g.warmTarget = target;
  // food
  let burn = D.drainFood * (p.brisk ? 1.5 : 1) * (p.warmth < 0.35 ? 1.35 : 1);
  p.food = Math.max(0, p.food - burn * dt);
  // the lantern
  if (p.lantern) {
    p.fuel -= LANTERN_BURN * dt;
    if (p.fuel <= 0) { p.fuel = 0; p.lantern = false; ev(g, { type: "lantern", on: false, dry: true }); hint(g, "lanterndry", "The lantern is dry. Fuel keeps it lit."); }
  }
  if (p.warmth <= 0.001 || p.food <= 0.0001) blackout(g, p.warmth <= 0.001 ? "cold" : "hunger");
  if (p.warmth < 0.3 && !g.hinted.cold) hint(g, "cold", "Cold. Out of the wind — a hut, a fire, the sun. [check] to check yourself.", 2);
  if (p.food < 0.25 && !g.hinted.hungry) hint(g, "hungry", "Hungry. [pack] to eat.", 2);
}

/* ------------------------------------------------------------------ */
/* Blackouts                                                          */

function blackout(g, why) {
  if (g.state !== "play") return;
  g.state = "out"; g.outT = 0; g.fishing = null;
  g.p.blackouts++; g.stats.blackouts++;
  g.p.lantern = false;
  ev(g, { type: "blackout", why, memory: g.stats.blackouts - 1 });
}
const OUT_T = 8;
function outStep(g, dt) {
  g.outT += dt;
  if (g.outT < OUT_T) return;
  const p = g.p, diff = g.diff;
  if (diff === "hard" && p.blackouts >= 2) { g.state = "over"; g.lost = true; ev(g, { type: "lost" }); return; }
  // time has passed while he lay there: the sun has moved on
  const lost = diff === "easy" ? 0.1 : diff === "normal" ? 0.22 : 0.15;
  g.clock += DAY * lost;
  if (diff === "easy") { p.warmth = 0.48; p.food = Math.max(p.food, 0.42); }
  else if (diff === "normal") {
    p.warmth = 0.4; p.food = Math.max(p.food, 0.34);
    const lostFuel = Math.ceil(p.fuel / 2 * 10) / 10; p.fuel = Math.max(0, p.fuel - lostFuel);
    const k = Object.keys(p.items).find((x) => p.items[x] > 0);
    if (k) p.items[k]--;
    ev(g, { type: "lostThings", fuel: lostFuel, item: k || null });
  } else { p.warmth = 0.32; p.food = Math.max(p.food, 0.3); p.weakT = 600; }
  g.state = "play";
  ev(g, { type: "wake" });
}

/* ------------------------------------------------------------------ */
/* The season: the sun sinks with the journey and with time            */

function seasonStep(g, dt) {
  const D = g.D;
  let target = Math.max(g.t / D.seasonT, g.progress * 0.88);
  const st = g.W.sites[g.W.sites.length - 1];
  const nearEnd = Math.hypot(g.p.x - st.x, g.p.z - st.z) < 900 || g.ending;
  // the last stretch is walked into the long night, whatever the hour
  if (nearEnd) target = 1.12;
  const rate = nearEnd ? 1 / 200 : 1 / 900;
  if (target > g.season) g.season = Math.min(target, g.season + rate * dt);
  g.act = g.season < 0.12 && !g.lit[0] ? 1 : g.season < 0.8 ? 2 : 3;
}

/* ------------------------------------------------------------------ */
/* Weather                                                            */

function weatherStep(g, dt) {
  const w = g.weather, r = g.wr;
  // the wind: slow swells, gusts, harder as the season turns
  const base = 0.22 + 0.16 * Math.sin(g.t / 310) + 0.08 * Math.sin(g.t / 77 + 1.3) + 0.22 * g.season;
  w.gust = Math.max(0, w.gust - dt * 0.5);
  if (r() < dt / 25) { w.gust = 0.25 + r() * 0.25; ev(g, { type: "gust", k: w.gust }); }
  let target = Math.max(0.05, Math.min(1, base + w.gust * 0.6));
  // a whiteout: the wind lifts the snow and the world goes white
  if (w.state === "calm" && g.t > w.next && g.state === "play" && !g.ending && g.t > 420) {
    w.state = "white"; w.end = g.t + 70 + r() * 90;
    ev(g, { type: "whiteout" });
    hint(g, "whiteout", "Whiteout. Keep to the flags, or wait it out somewhere out of the wind.", 2);
  }
  if (w.state === "white") {
    w.whiteout = Math.min(1, w.whiteout + dt / 14);
    target = Math.max(target, 0.88);
    if (g.t > w.end || g.ending) {
      w.state = "clearing";
    }
  } else if (w.state === "clearing") {
    w.whiteout = Math.max(0, w.whiteout - dt / 22);
    if (w.whiteout <= 0) {
      w.state = "calm";
      const gap = g.diff === "easy" ? [1000, 700] : g.diff === "hard" ? [480, 380] : [700, 500];
      w.next = g.t + gap[0] + r() * gap[1];
      // when it clears, the old tracks are gone: the world is new
      ev(g, { type: "clear" });
    }
  }
  w.wind += (target - w.wind) * Math.min(1, dt / 4);
}

/* ------------------------------------------------------------------ */
/* Reaching for things                                                */

/** What is in reach and in front of you, or null. */
export function target(g) {
  const p = g.p, P = g.P;
  if (g.state !== "play") return null;
  const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
  let best = null, bestS = Infinity;
  const consider = (kind, x, z, y, ref, reach) => {
    const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
    if (d > (reach || REACH)) return;
    const along = d > 0.3 ? (dx * fx + dz * fz) / d : 1;
    if (along < 0.45) return;
    // things low or high are reached by looking at them
    const dy = (y === undefined ? p.y + 1 : y) - (p.y + p.eye);
    const want = Math.atan2(dy, Math.max(0.2, d));
    const look = Math.abs(want - p.pitch);
    const s = d * 0.6 + (1 - along) * 4 + look * 1.2;
    if (s < bestS) { bestS = s; best = Object.assign({ kind, x, z, y, d }, ref); }
  };
  for (const q of P.props) {
    if (Math.abs(q.x - p.x) > 3 || Math.abs(q.z - p.z) > 3) continue;
    // in another hut, or outside when you are in: out of reach through the wall
    if ((q.inside >= 0 ? q.inside : -1) !== p.inside && q.inside >= 0) continue;
    const top = q.y + 0.12;
    if (q.item && !g.taken[q.id]) consider("take", q.x, q.z, top, { prop: q.id });
    else if (q.clue && !q.item) consider("read", q.x, q.z, top, { prop: q.id });
    else if (q.radio) consider("radio", q.x, q.z, top + 0.2, { prop: q.id });
    else if (q.stove) consider("stove", q.x, q.z, q.y + 0.7, { prop: q.id, hut: q.inside });
    else if (q.generator) consider("generator", q.x, q.z, q.y + 0.4, { prop: q.id });
    else if (q.kind === "drum" && q.inside < 0 && g.drumFuel[q.id] > 0) consider("drum", q.x, q.z, q.y + 0.8, { prop: q.id });
    else if (q.kind === "bed") consider("rest", q.x, q.z, q.y + 0.5, { prop: q.id, hut: q.inside });
  }
  for (const h of P.huts) {
    if (Math.abs(h.x - p.x) > 10 || Math.abs(h.z - p.z) > 10) continue;
    const c = Math.cos(h.rot), s = Math.sin(h.rot);
    const lx = h.door.off, lz = h.d / 2;
    consider("door", h.x + lx * c + lz * s, h.z - lx * s + lz * c, h.floor + 1.1, { hut: h.id });
  }
  for (let i = 0; i < g.W.beacons.length; i++) {
    const b = g.W.beacons[i];
    if (Math.abs(b.x - p.x) > 5 || Math.abs(b.z - p.z) > 5) continue;
    consider(g.lit[i] ? "warm" : "beacon", b.x, b.z, b.y + 1.2, { beacon: i }, b.big ? 3.4 : 2.6);
  }
  for (const q of P.posts) if (!g.posts[q.id] && Math.abs(q.x - p.x) < 4 && Math.abs(q.z - p.z) < 4) consider("post", q.x, q.z, q.y + 1.9, { post: q.id });
  for (const c of P.cairns) if (Math.abs(c.x - p.x) < 4 && Math.abs(c.z - p.z) < 4 && g.cairns[c.id] < c.full) consider("cairn", c.x, c.z, c.y + 0.3 + g.cairns[c.id] * 0.12, { cairn: c.id });
  if (!p.stone) for (const l of P.loose) if (!g.loose[l.id] && Math.abs(l.x - p.x) < 3 && Math.abs(l.z - p.z) < 3) consider("stone", l.x, l.z, l.y, { loose: l.id });
  for (const h of P.holes) if (Math.abs(h.x - p.x) < 4 && Math.abs(h.z - p.z) < 4) consider("hole", h.x, h.z, h.y, { hole: h.id }, 2.6);
  for (const m of P.masts) if (!g.masts[m.id] && Math.abs(m.x - p.x) < 5 && Math.abs(m.z - p.z) < 5) consider("mast", m.x, m.z, groundAt(g, m.x, m.z) + 0.5, { mast: m.id }, 3);
  for (const s of P.sleds) if (Math.abs(s.x - p.x) < 4 && Math.abs(s.z - p.z) < 4) consider("sled", s.x, s.z, s.y + 0.5, { clue: s.clue });
  return best;
}

/** The verb for what is in reach — one line at the bottom of the screen. */
export function prompt(g) {
  const t = target(g);
  if (!t) return null;
  const p = g.p, P = g.P, D = g.D;
  const hold = p.holdKind === t.kind ? p.hold / (HOLD[t.kind] || 1) : 0;
  switch (t.kind) {
    case "take": {
      const q = P.props[t.prop], it = q.item;
      const what = it.type === "fuel" ? "the fuel" : it.type === "food" ? (it.food === "cans" ? "the tins" : "the rations") : it.key === "lantern" ? "the lantern" : it.key === "compass" ? "the compass" : it.key === "map" ? "the route map" : it.key === "line" ? "the fishing line" : it.key === "toolbox" ? "the tools" : "it";
      return { verb: "Take " + what };
    }
    case "read": return { verb: g.read[P.props[t.prop].clue] ? "Read it again" : "Read" };
    case "sled": return { verb: "Look at the sledge" };
    case "radio": { const q = P.props[t.prop]; return { verb: q.broken && !g.radios[q.id] ? (p.keys.toolbox ? "Mend the radio" : "The radio is broken") : "Listen", hold: q.broken && !g.radios[q.id] && p.keys.toolbox, progress: hold, off: q.broken && !g.radios[q.id] && !p.keys.toolbox }; }
    case "stove": return g.stoves[t.hut] > 0 ? { verb: "The stove is burning", off: true } : p.fuel >= D.stove ? { verb: "Light the stove", hold: true, progress: hold } : { verb: "The stove needs fuel", off: true };
    case "generator": return { verb: "Try the generator" };
    case "drum": return { verb: "Drain the drum" };
    case "rest": return { verb: "Rest a while" };
    case "door": return { verb: g.doors[t.hut] > 0.5 ? "Shut the door" : "Open the door" };
    case "beacon": return p.fuel >= D.beacon ? { verb: "Light the beacon", hold: true, progress: hold } : { verb: "The beacon needs " + fuelWords(D.beacon) + " of fuel", off: true };
    case "warm": return { verb: "Warm your hands", off: true };
    case "post": return p.fuel >= POST_COST ? { verb: "Light the lantern" } : { verb: "The lantern needs fuel", off: true };
    case "cairn": return p.stone ? { verb: "Add the stone", hold: true, progress: hold } : { verb: "A cairn. Stones lie about", off: true };
    case "stone": return { verb: "Pick up a stone" };
    case "hole": return !p.keys.line ? { verb: "A hole in the ice", off: true } : g.fishing ? { verb: g.fishing.bite > 0 ? "Pull!" : "Wait…", off: !(g.fishing.bite > 0) } : g.holes[t.hole] > 0 ? { verb: "Fish" } : { verb: "Nothing more here", off: true };
    case "mast": { const m = P.masts[t.mast]; return { verb: m.kind === "flagpole" ? "Raise the flag" : "Raise the mast", hold: true, progress: hold }; }
  }
  return null;
}
const fuelWords = (n) => (n === 1 ? "a can" : n === 2 ? "two cans" : n === 3 ? "three cans" : n + " cans");

function use(g, dt, input) {
  const p = g.p;
  if (input.lanternPress) {
    if (!p.keys.lantern) { /* nothing to light */ }
    else if (p.fuel <= 0) { hint(g, "lanternfuel", "The lantern needs fuel."); }
    else { p.lantern = !p.lantern; ev(g, { type: "lantern", on: p.lantern }); }
  }
  const t = target(g);
  const held = !!input.use;
  // hold-to-do things
  const holdKinds = { beacon: 1, mast: 1, cairn: 1, stove: 1, radio: 1 };
  if (t && holdKinds[t.kind] && held) {
    const pr = prompt(g);
    if (pr && pr.hold && !pr.off) {
      if (p.holdKind !== t.kind) { p.holdKind = t.kind; p.hold = 0; ev(g, { type: "holdStart", kind: t.kind }); }
      p.hold += dt;
      const need = t.kind === "radio" ? HOLD.repair : HOLD[t.kind];
      if (p.hold >= need) { p.hold = 0; p.holdKind = null; finish(g, t); }
      return;
    }
  }
  if (!held) { p.hold = 0; p.holdKind = null; }
  if (!input.usePress || !t) return;
  const P = g.P;
  switch (t.kind) {
    case "take": {
      const q = P.props[t.prop], it = q.item;
      g.taken[q.id] = true;
      if (it.type === "fuel") { p.fuel += it.n; ev(g, { type: "take", what: "fuel", x: q.x, z: q.z }); hint(g, "fuel1", "Fuel. The beacons burn it, and stoves, and the lantern."); }
      else if (it.type === "food") { p.items[it.food]++; ev(g, { type: "take", what: "food", x: q.x, z: q.z }); }
      else { p.keys[it.key] = true; ev(g, { type: "take", what: it.key, x: q.x, z: q.z }); if (it.key === "map") readClue(g, "map"); if (it.key === "lantern") hint(g, "lantern", "[lantern] lights the lantern. It burns fuel."); if (it.key === "line") hint(g, "line", "A fishing line. The holes in the sea ice."); if (it.key === "compass") hint(g, "compass", "A compass. [check] shows it."); if (it.key === "toolbox") hint(g, "tools", "Tools. Something out there may want mending."); }
      break;
    }
    case "read": readClue(g, P.props[t.prop].clue); break;
    case "sled": readClue(g, t.clue); break;
    case "radio": radio(g, P.props[t.prop]); break;
    case "generator": ev(g, { type: "generator" }); readClue(g, "generator"); break;
    case "drum": { const n = g.drumFuel[t.prop]; g.drumFuel[t.prop] = 0; p.fuel += n; ev(g, { type: "take", what: "fuel", x: t.x, z: t.z, drum: true }); break; }
    case "rest": rest(g, t.hut); break;
    case "door": g.doors[t.hut] = g.doors[t.hut] > 0.5 ? 0 : 1; ev(g, { type: "door", hut: t.hut, open: g.doors[t.hut] > 0.5 }); break;
    case "post": if (p.fuel >= POST_COST) { p.fuel -= POST_COST; g.posts[t.post] = true; g.stats.posts++; ev(g, { type: "postLit", post: t.post }); } break;
    case "stone": g.loose[t.loose] = true; p.stone = true; ev(g, { type: "stoneUp", loose: t.loose }); hint(g, "stone", "Carry it to the cairn."); break;
    case "hole": if (p.keys.line && !g.fishing && g.holes[t.hole] > 0) { g.fishing = { hole: t.hole, t: 0, wait: 5 + g.wr() * 12, bite: 0 }; ev(g, { type: "fishStart", hole: t.hole }); hint(g, "fish", "Wait for the tug, then [interact]."); } break;
  }
}

/* The end of a held action. */
function finish(g, t) {
  const p = g.p, D = g.D, P = g.P;
  if (t.kind === "beacon") {
    p.fuel = Math.max(0, p.fuel - D.beacon);
    g.lit[t.beacon] = true; g.stats.beacons++;
    const b = g.W.beacons[t.beacon];
    ev(g, { type: "beaconLit", beacon: t.beacon, x: b.x, z: b.z, big: b.big });
    if (g.stats.beacons === 1) hint(g, "beacon1", "The first light. The flags lead east, camp to camp.", 3);
    if (b.big) startEnding(g);
  } else if (t.kind === "stove") {
    p.fuel = Math.max(0, p.fuel - D.stove);
    g.stoves[t.hut] = 900;
    ev(g, { type: "stoveLit", hut: t.hut });
  } else if (t.kind === "mast") {
    g.masts[t.mast] = true; g.stats.masts++;
    ev(g, { type: "mastUp", mast: t.mast });
  } else if (t.kind === "cairn") {
    p.stone = false; g.cairns[t.cairn]++;
    ev(g, { type: "stoneDown", cairn: t.cairn, n: g.cairns[t.cairn] });
    if (g.cairns[t.cairn] >= P.cairns[t.cairn].full) { g.stats.cairns++; ev(g, { type: "cairnDone", cairn: t.cairn }); }
  } else if (t.kind === "radio") {
    g.radios[t.prop] = true;
    ev(g, { type: "radioMended", prop: t.prop });
    radio(g, P.props[t.prop]);
  }
}

function readClue(g, id) {
  if (!id) return;
  const first = !g.read[id];
  g.read[id] = true;
  if (first) g.stats.notes++;
  ev(g, { type: "read", id, first });
}

function radio(g, q) {
  if (q.broken && !g.radios[q.id]) { ev(g, { type: "read", id: "radio_dead", first: false }); return; }
  const site = g.P.huts[q.inside] ? g.P.huts[q.inside].site : -1;
  let rare = null;
  for (const r of g.P.rares) if (!g.rare.done[r.id] && ((r.kind === "song" && r.site === site) || (r.kind === "morse" && q.morse))) rare = r;
  if (rare) { g.rare.done[rare.id] = true; ev(g, { type: "rare", kind: rare.kind, x: q.x, z: q.z }); }
  ev(g, { type: "radio", prop: q.id, site, rare: rare ? rare.kind : null, x: q.x, z: q.z });
}

function rest(g, hut) {
  const p = g.p;
  const warm = g.stoves[hut] > 0;
  // the sun goes a fifth of the way round while he sleeps
  g.clock += DAY * 0.2;
  p.food = Math.max(0.05, p.food - 0.06);
  p.warmth = Math.max(p.warmth, warm ? 0.95 : 0.6);
  if (g.stoves[hut] > 0) g.stoves[hut] = Math.max(1, g.stoves[hut] - 240);
  ev(g, { type: "rest", warm });
}

/** Eat one of what you carry: "cans" | "rations" | "fish" | "cooked". */
export function eat(g, kind) {
  const p = g.p;
  if (!p.items[kind]) return false;
  // a raw fish is barely food; near a fire it is cooked first
  if (kind === "fish" && g.near.fire > 0.2) kind = "cookedNow";
  if (kind === "cookedNow") { p.items.fish--; p.food = Math.min(1, p.food + FOOD.cooked); }
  else { p.items[kind]--; p.food = Math.min(1, p.food + FOOD[kind]); }
  g.stats.eaten++;
  ev(g, { type: "eat", kind });
  return true;
}

/* ------------------------------------------------------------------ */
/* Fishing                                                            */

function fishStep(g, dt, input) {
  const f = g.fishing;
  if (!f) return;
  const p = g.p, h = g.P.holes[f.hole];
  if (Math.hypot(h.x - p.x, h.z - p.z) > 3.2) { g.fishing = null; ev(g, { type: "fishStop" }); return; }
  f.t += dt;
  if (f.bite > 0) {
    f.bite -= dt;
    if (input.usePress) {
      g.holes[f.hole]--; p.items.fish++; g.stats.fish++;
      ev(g, { type: "fishCaught", hole: f.hole, x: h.x, z: h.z });
      g.fishing = null;
      hint(g, "fishcook", "Raw, it is barely food. Near a fire it cooks.");
      return;
    }
    if (f.bite <= 0) { f.wait = f.t + 4 + g.wr() * 10; ev(g, { type: "fishMiss" }); }
  } else if (f.t >= f.wait) {
    f.bite = 1.4;
    ev(g, { type: "fishBite", x: h.x, z: h.z });
  }
}

/* ------------------------------------------------------------------ */
/* How far along                                                      */

function progressStep(g, dt) {
  const p = g.p, L = g.W.line;
  // the nearest point of the flag line, searched near the last one
  let bi = g.lineI, bd = Infinity;
  const lo = Math.max(0, g.lineI - 40), hi = Math.min(L.length - 1, g.lineI + 40);
  for (let i = lo; i <= hi; i++) { const d = Math.hypot(L[i].x - p.x, L[i].z - p.z); if (d < bd) { bd = d; bi = i; } }
  // lost the line entirely (a long detour): search all of it, now and then
  if (bd > 300 && (g.t % 5) < dt) for (let i = 0; i < L.length; i += 4) { const d = Math.hypot(L[i].x - p.x, L[i].z - p.z); if (d < bd) { bd = d; bi = i; } }
  g.lineI = bi;
  g.offLine = bd;
  if (bd < 400) g.progress = Math.max(g.progress, bi / (L.length - 1));
  for (const s of g.W.sites) {
    if (g.visited[s.id]) continue;
    if (Math.hypot(s.x - p.x, s.z - p.z) < s.pad + 10) { g.visited[s.id] = true; ev(g, { type: "arrive", site: s.id, kind: s.kind }); }
  }
}

/* ------------------------------------------------------------------ */
/* Rare moments: about one an hour, and never twice                    */

function rares(g, dt) {
  const p = g.p;
  for (const r of g.P.rares) {
    if (g.rare.done[r.id]) continue;
    if (r.kind === "light") {
      const dim = g.sun.el < 0.1 || g.weather.whiteout > 0.5;
      if (Math.hypot(r.tx - p.x, r.tz - p.z) < 160 && dim && g.weather.whiteout < 0.2) {
        g.rare.done[r.id] = true;
        g.rare.light = { x: r.x, y: r.y, z: r.z, t: 0, from: { x: p.x, z: p.z } };
        ev(g, { type: "rare", kind: "light", x: r.x, z: r.z });
      }
    } else if (r.kind === "engine") {
      if (g.season > 0.3 && g.season < 0.75 && g.t > 1500 && g.weather.wind < 0.4 && p.inside < 0 && g.wr() < dt / 400) {
        g.rare.done[r.id] = true;
        ev(g, { type: "rare", kind: "engine", az: g.wr() * Math.PI * 2 });
      }
    }
  }
  const L = g.rare.light;
  if (L) {
    L.t += dt;
    // it is gone the moment you go toward it, or after a minute
    if (L.t > 70 || Math.hypot(L.from.x - p.x, L.from.z - p.z) > 250) { g.rare.light = null; ev(g, { type: "rareGone" }); }
  }
}

/* The land's own sounds: ice cracking out on the sea, the glacier groaning. */
function sounds(g, dt) {
  g.crackT -= dt;
  if (g.crackT > 0) return;
  const r = g.wr, p = g.p;
  const ice = g.near.seaIce > 0.5 || g.near.glacier > 0.2;
  g.crackT = (ice ? 10 : 30) + r() * (ice ? 30 : 70);
  const a = r() * Math.PI * 2, d = 40 + r() * 600;
  ev(g, { type: "crack", x: p.x + Math.cos(a) * d, z: p.z + Math.sin(a) * d, big: r() < 0.25 });
}

/* ------------------------------------------------------------------ */
/* Hints: one line, only the first time                               */

function hintsStep(g) {
  const p = g.p;
  if (g.t > 1.5 && !g.hinted.start) hint(g, "start", "Cold, and quiet. Look around. [interact] takes and reads things.");
  if (p.keys.map && g.lit.every((x) => !x) && p.fuel >= g.D.beacon) hint(g, "beaconwhere", "There is a beacon on the rise above the base. [map] shows the way.", 2);
  if (g.sun.el < 0.02 && p.keys.lantern && !p.lantern && p.fuel > 0) hint(g, "dark", "Dark. [lantern] for the lantern.", 2);
  if (g.hint && g.t - g.hint.t > 9) g.hint = null;
}

/* ------------------------------------------------------------------ */
/* The end                                                            */

function startEnding(g) {
  if (g.ending) return;
  g.ending = { t: 0, answered: false };
  ev(g, { type: "endingStart" });
}
function endingStep(g, dt) {
  const e = g.ending;
  if (!e) return;
  e.t += dt;
  if (!e.answered && e.t > 22) { e.answered = true; ev(g, { type: "answer", x: g.P.answer.x, z: g.P.answer.z }); }
  if (e.t > 58 && g.state === "play") { g.state = "over"; g.won = true; ev(g, { type: "over" }); }
}

/** The sun for a journey's clock and season (the title turns the clock by hand). */
export function sunNow(g) { return sunDir(dayOf(g.clock), g.season, g.sun); }

/** For the HUD when the player checks: the meters, in words. */
export function words(g) {
  const p = g.p;
  const w = p.warmth > 0.8 ? "Warm enough." : p.warmth > 0.6 ? "A little cold." : p.warmth > 0.4 ? "Cold." : p.warmth > 0.2 ? "Very cold. Shivering." : "Freezing.";
  const f = p.food > 0.75 ? "Not hungry." : p.food > 0.5 ? "Could eat." : p.food > 0.3 ? "Hungry." : p.food > 0.12 ? "Very hungry." : "Starving.";
  const fu = p.fuel <= 0.05 ? "No fuel." : p.fuel < 1 ? "A little fuel." : p.fuel < 2 ? "A can of fuel." : Math.floor(p.fuel) + " cans of fuel.";
  return { warmth: w, food: f, fuel: fu };
}
