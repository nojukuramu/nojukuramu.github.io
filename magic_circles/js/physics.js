/* physics.js — who bumps into what, on the ground plane.
 *
 * The Phaser build ran Matter.js, a full rigid-body engine, for what is
 * circles sliding on a floor, and most of its README is about the freezes
 * that came of it: NaN velocities poisoning the solver, coincident bodies
 * wedging it, use-after-destroy inside its collision callback. This is the
 * small thing the game actually needed:
 *
 *   colliders  circles and boxes (walls), filed by chunk so a query only
 *              looks at the 3×3 chunks around a point
 *   bodies     the mage and the creatures: circles with a mass, pushed out
 *              of colliders, and pushing the moveable ones (crates,
 *              barrels, rocks) by the ratio of their masses — the old
 *              "Earth bulldozes, a light shot cannot shift a boulder"
 *   shots      a swept test, so a fast Needle cannot step over a wall
 *
 * Every position that comes out of here is checked to be finite; anything
 * that is not is put back where it was, not passed on. */

import { CHUNK, key } from "./world.js";

const byChunk = new Map();

export function addCollider(chunkKey, c) {
  let list = byChunk.get(chunkKey);
  if (!list) byChunk.set(chunkKey, (list = []));
  c.chunkKey = chunkKey;
  if (c.rot !== undefined) { c.cos = Math.cos(c.rot); c.sin = Math.sin(c.rot); }
  c.alive = true;
  list.push(c);
  return c;
}
export function removeCollider(c) {
  c.alive = false;
  const list = byChunk.get(c.chunkKey);
  if (!list) return;
  const i = list.indexOf(c);
  if (i >= 0) list.splice(i, 1);
}
export function dropChunk(chunkKey) { byChunk.delete(chunkKey); }
export function clearAll() { byChunk.clear(); }

/** Every collider in the 3×3 chunks around (x, z). */
export function near(x, z, fn) {
  const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
  for (let i = cx - 1; i <= cx + 1; i++) for (let j = cz - 1; j <= cz + 1; j++) {
    const list = byChunk.get(key(i, j));
    if (!list) continue;
    for (let k = 0; k < list.length; k++) if (fn(list[k]) === false) return;
  }
}

/** Distance from (x, z) to a collider's surface, and the outward normal. */
const out = { d: 0, nx: 0, nz: 0 };
export function surface(c, x, z) {
  if (c.hx !== undefined) {
    const dx = x - c.x, dz = z - c.z;
    const lx = dx * c.cos + dz * c.sin, lz = -dx * c.sin + dz * c.cos;
    const qx = Math.max(-c.hx, Math.min(c.hx, lx)), qz = Math.max(-c.hz, Math.min(c.hz, lz));
    let ex = lx - qx, ez = lz - qz;
    let d = Math.hypot(ex, ez);
    if (d < 1e-6) {
      // inside: leave by the nearest face
      const px = c.hx - Math.abs(lx), pz = c.hz - Math.abs(lz);
      if (px < pz) { ex = Math.sign(lx) || 1; ez = 0; d = -px; } else { ex = 0; ez = Math.sign(lz) || 1; d = -pz; }
    } else { ex /= d; ez /= d; }
    out.d = d; out.nx = ex * c.cos - ez * c.sin; out.nz = ex * c.sin + ez * c.cos;
    return out;
  }
  const dx = x - c.x, dz = z - c.z, m = Math.hypot(dx, dz);
  out.d = m - c.r;
  if (m < 1e-6) { out.nx = 1; out.nz = 0; } else { out.nx = dx / m; out.nz = dz / m; }
  return out;
}

/**
 * Push a body (x, z, r, mass) out of every solid collider it overlaps. A
 * moveable collider is shoved by the share of the overlap its mass loses.
 * Returns true if anything was touched.
 */
export function resolve(b) {
  let touched = false;
  near(b.x, b.z, (c) => {
    if (!c.solid || c === b.ignore) return;
    const s = surface(c, b.x, b.z);
    const pen = b.r - s.d;
    if (pen <= 0) return;
    touched = true;
    if (c.moveable && isFinite(c.mass)) {
      const share = b.mass / (b.mass + c.mass);
      c.x -= s.nx * pen * share; c.z -= s.nz * pen * share;
      c.vx = (c.vx || 0) - s.nx * pen * share * 8; c.vz = (c.vz || 0) - s.nz * pen * share * 8;
      c.moved = true;
      b.x += s.nx * pen * (1 - share); b.z += s.nz * pen * (1 - share);
    } else {
      b.x += s.nx * pen; b.z += s.nz * pen;
      // lose the velocity that was going into the wall
      const vn = (b.vx || 0) * s.nx + (b.vz || 0) * s.nz;
      if (vn < 0 && b.vx !== undefined) { b.vx -= vn * s.nx; b.vz -= vn * s.nz; }
    }
  });
  return touched;
}

/** Moveable props drift to a stop and are kept out of the solid things around them. */
export function stepProps(list, dt) {
  for (const c of list) {
    if (!c.alive || !c.moveable || (!c.vx && !c.vz)) continue;
    const ox = c.x, oz = c.z;
    c.x += c.vx * dt; c.z += c.vz * dt;
    const k = Math.exp(-6 * dt);
    c.vx *= k; c.vz *= k;
    if (Math.abs(c.vx) < 0.02 && Math.abs(c.vz) < 0.02) { c.vx = 0; c.vz = 0; }
    near(c.x, c.z, (o) => {
      if (o === c || !o.solid) return;
      const s = surface(o, c.x, c.z);
      const pen = c.r - s.d;
      if (pen > 0) { c.x += s.nx * pen; c.z += s.nz * pen; if (!o.moveable) { c.vx *= 0.3; c.vz *= 0.3; } }
    });
    if (!isFinite(c.x) || !isFinite(c.z)) { c.x = ox; c.z = oz; c.vx = c.vz = 0; }
    c.moved = true;
  }
}

/** Push a moveable collider directly (a shot, a blast). Heavier things move less. */
export function shove(c, fx, fz, power) {
  if (!c.moveable || !isFinite(c.mass)) return;
  const k = Math.max(0, Math.min(1, ((power || 50) / c.mass - 0.2) / 1.8));
  if (k <= 0) return;
  c.vx = (c.vx || 0) + fx * k; c.vz = (c.vz || 0) + fz * k;
}

/**
 * The first collider a circle of radius r would touch moving from (x0, z0)
 * to (x1, z1), sampled finely enough that nothing thinner than a wall is
 * skipped. Returns { c, x, z } or null. `skip(c)` filters.
 */
export function sweep(x0, z0, x1, z1, r, skip) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const steps = Math.max(1, Math.ceil(len / 0.25));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
    let hit = null;
    near(x, z, (c) => {
      if (!c.solid || (skip && skip(c))) return;
      if (surface(c, x, z).d < r) { hit = c; return false; }
    });
    if (hit) return { c: hit, x, z };
  }
  return null;
}

/** Every collider within `rad` of a point (blasts). */
export function within(x, z, rad, fn) {
  near(x, z, (c) => { if (surface(c, x, z).d < rad) fn(c); });
}

/** Is there a clear straight line from a to b for something of radius r? */
export function clearLine(x0, z0, x1, z1, r) {
  return !sweep(x0, z0, x1, z1, r || 0.2, (c) => c.moveable || c.low);
}

export function stats() {
  let n = 0;
  for (const l of byChunk.values()) n += l.length;
  return { colliders: n, chunks: byChunk.size };
}
