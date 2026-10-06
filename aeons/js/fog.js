/* fog.js — what you can see, what you have seen, and what you remember.
 *
 * Three states per tile, as in the games this is after: never seen (black),
 * seen before (the ground, and enemy buildings as they were when you last
 * looked), and in sight now (everything, moving). "In sight" is a stamp, not
 * a flag: a tile is visible when its stamp equals the current one, so a new
 * pass never has to clear the whole map — it only has to bump a number.
 *
 * Enemy buildings are remembered as ghosts. A tower you saw, then lost sight
 * of, stays on your map where it was; if it has been destroyed in the dark,
 * you will not know until you look again. */

import { G, emit } from "./state.js";
import { TILE, CHUNK } from "./data.js";

const circles = new Map();
function circle(r) {
  let c = circles.get(r);
  if (c) return c;
  c = [];
  for (let dy = -r; dy <= r; dy++) { const w = Math.floor(Math.sqrt(r * r + r - dy * dy)); c.push(dy, w); }
  circles.set(r, c);
  return c;
}

let newlySeen = 0;
function reveal(x, y, r) {
  const W = G.world, b = W.bounds, s = G.fogStamp;
  const cx = Math.floor(x / TILE), cy = Math.floor(y / TILE), rr = Math.max(1, Math.round(r));
  const c = circle(rr);
  for (let k = 0; k < c.length; k += 2) {
    const ty = cy + c[k], w = c[k + 1];
    if (ty < b.y0 || ty >= b.y1) continue;
    const x0 = Math.max(b.x0, cx - w), x1 = Math.min(b.x1 - 1, cx + w);
    let tx = x0;
    while (tx <= x1) {
      const ch = W.chunkAt(tx, ty), lx = ((tx % CHUNK) + CHUNK) % CHUNK, row = (((ty % CHUNK) + CHUNK) % CHUNK) * CHUNK;
      const end = Math.min(x1, tx + (CHUNK - 1 - lx));
      for (let i = lx + row, n = end - tx; n >= 0; n--, i++) {
        ch.vis[i] = s;
        if (!ch.exp[i]) { ch.exp[i] = 1; ch.expRev = (ch.expRev || 0) + 1; newlySeen++; }
      }
      tx = end + 1;
    }
  }
}

export function visible(tx, ty) {
  if (!G.world.inBounds(tx, ty)) return false;
  const c = G.world.chunkAt(tx, ty);
  return c.vis[G.world.idx(tx, ty)] === G.fogStamp;
}
export function explored(tx, ty) {
  if (!G.world.inBounds(tx, ty)) return false;
  const c = G.world.chunkAt(tx, ty);
  return c.exp[G.world.idx(tx, ty)] === 1;
}
export const visiblePx = (x, y) => visible(Math.floor(x / TILE), Math.floor(y / TILE));
/** Is any tile of a building visible? */
export function bldVisible(b) {
  for (let j = 0; j < b.h; j++) for (let i = 0; i < b.w; i++) if (visible(b.tx + i, b.ty + j)) return true;
  return false;
}
/** Can the player see this thing right now? */
export function seen(e) {
  if (e.team === 0) return true;
  if (e.kind === "bld") return bldVisible(e);
  if (e.buffs && e.buffs.veil > G.time) return false;
  return visiblePx(e.x, e.y);
}

export function updateFog() {
  G.fogStamp++;
  if (G.fogStamp > 65000) {
    for (const c of G.world.chunks.values()) c.vis.fill(0);
    G.fogStamp = 1;
  }
  newlySeen = 0;
  for (const u of G.units) if (!u.dead && u.team === 0) reveal(u.x, u.y, u.st.sight);
  for (const b of G.blds) if (!b.dead && b.team === 0) reveal(b.x, b.y, b.built >= 1 ? b.sight + Math.max(b.w, b.h) / 2 : 2);
  G.temp = G.temp.filter((t) => t.until > G.time);
  for (const t of G.temp) reveal(t.x, t.y, t.r);

  // enemy buildings: seen ones are remembered, and a ghost in sight that is gone is forgotten
  for (const b of G.blds) {
    if (b.dead || b.team === 0) continue;
    if (bldVisible(b)) {
      if (!b.seen) { b.seen = true; emit("spotted", b); }
      G.ghosts.set(b.id, { id: b.id, type: b.type, tx: b.tx, ty: b.ty, w: b.w, h: b.h, level: b.level, team: b.team, hp: b.hp / b.maxHp, built: b.built });
    }
  }
  for (const [id, gh] of G.ghosts) {
    const b = G.ents.get(id);
    if (b && !b.dead) continue;
    if (bldVisible(gh)) G.ghosts.delete(id);
  }
  if (newlySeen) emit("explored", newlySeen);
}

/** Fraction of the inside of the border that has ever been seen. */
export function exploredShare() {
  const b = G.world.bounds;
  let seenN = 0;
  for (const c of G.world.chunks.values()) {
    const x0 = c.cx * CHUNK, y0 = c.cy * CHUNK;
    if (x0 < b.x0 || y0 < b.y0 || x0 >= b.x1 || y0 >= b.y1) continue;
    for (let i = 0; i < c.exp.length; i++) seenN += c.exp[i];
  }
  return seenN / ((b.x1 - b.x0) * (b.y1 - b.y0));
}
