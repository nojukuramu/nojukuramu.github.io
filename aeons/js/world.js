/* world.js — the ground: an infinite map, made on demand, inside a border that only grows.
 *
 * Tiles are a pure function of the seed (rng.js) and are generated a chunk
 * (16 x 16) at a time, the first time anything looks there. What the player
 * changes — a felled tree, a mine dug out, ground cleared for an enemy base —
 * marks its chunk modified, and only modified chunks are written to a save.
 *
 * The playable area is a rectangle, `bounds`. Past it is the Veil: no tile
 * can be walked, built or seen there, and the renderer draws mist. Phases
 * push the border outwards (enemy.js); nothing ever pulls it back in. */

import { CHUNK, TILE, NODES, TREE_WOOD, START_BOUNDS } from "./data.js";
import { fbm, noise2, hash, rng } from "./rng.js";

export const T = { DEEP: 0, WATER: 1, SAND: 2, GRASS: 3, DIRT: 4, FOREST: 5, ROCK: 6, VEIL: 255 };
export const isWater = (t) => t === T.DEEP || t === T.WATER;
export const isWalk = (t) => t === T.SAND || t === T.GRASS || t === T.DIRT;
const N = CHUNK * CHUNK;
const ckey = (cx, cy) => (cx + 32768) * 65536 + (cy + 32768);

export class World {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.chunks = new Map();
    this.nodes = new Map();        // id (negative) -> node
    this.nextNode = -1;
    this.bounds = { x0: -START_BOUNDS, y0: -START_BOUNDS, x1: START_BOUNDS, y1: START_BOUNDS };
    this.version = 0;              // bumps whenever passability changes, so cached paths can tell
    this.onChange = null;          // (cx, cy) a chunk's picture changed
  }

  inBounds(tx, ty) { const b = this.bounds; return tx >= b.x0 && ty >= b.y0 && tx < b.x1 && ty < b.y1; }

  chunk(cx, cy) {
    const k = ckey(cx, cy);
    let c = this.chunks.get(k);
    if (!c) { c = this.gen(cx, cy, true); this.chunks.set(k, c); }
    return c;
  }
  chunkAt(tx, ty) { return this.chunk(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK)); }
  idx(tx, ty) { return (((ty % CHUNK) + CHUNK) % CHUNK) * CHUNK + (((tx % CHUNK) + CHUNK) % CHUNK); }

  terrain(tx, ty) {
    if (!this.inBounds(tx, ty)) return T.VEIL;
    return this.chunkAt(tx, ty).t[this.idx(tx, ty)];
  }
  occ(tx, ty) {
    if (!this.inBounds(tx, ty)) return 0;
    return this.chunkAt(tx, ty).occ[this.idx(tx, ty)];
  }
  /** Can a body that moves this way stand on this tile? */
  passable(tx, ty, move) {
    if (!this.inBounds(tx, ty)) return false;
    if (move === "air") return true;
    const c = this.chunkAt(tx, ty), i = this.idx(tx, ty), t = c.t[i];
    if (c.occ[i]) return false;
    return move === "naval" ? isWater(t) : isWalk(t);
  }
  /** The terrain alone, ignoring buildings: can a building of this kind go here? */
  buildable(tx, ty) {
    if (!this.inBounds(tx, ty)) return false;
    const c = this.chunkAt(tx, ty), i = this.idx(tx, ty);
    return !c.occ[i] && isWalk(c.t[i]);
  }

  /* ---------------- generation ---------------- */
  /** The natural tile at (tx, ty), before anybody touched it. */
  natural(tx, ty) {
    const s = this.seed, d = Math.hypot(tx, ty);
    const raw = fbm(s, tx * 0.017, ty * 0.017, 5) * 1.15;
    const e = raw + 0.75 * Math.exp(-(d * d) / (22 * 22));      // home is always dry land, never under rock
    const m = fbm(s + 77, tx * 0.05, ty * 0.05, 3);
    const ridge = Math.abs(noise2(s + 313, tx * 0.035, ty * 0.035));
    if (d < 8) return T.GRASS;                                    // the clearing your hearth stands in
    if (d > 11 && d < 17) {                                       // and the wood beside it
      const a = Math.atan2(ty, tx);
      if (a > -2.2 && a < -1.1) return (hash(s, tx, ty) & 7) ? T.FOREST : T.GRASS;
    }
    if (e < -0.36) return T.DEEP;
    if (e < -0.2) return T.WATER;
    if (e < -0.13) return T.SAND;
    if (d > 16 && (raw > 0.5 || (ridge < 0.045 && raw > 0.18))) return T.ROCK;
    if (m > 0.16) return T.FOREST;
    if (m < -0.42) return T.DIRT;
    return T.GRASS;
  }

  gen(cx, cy, withNodes) {
    const c = { cx, cy, t: new Uint8Array(N), wood: new Uint8Array(N), occ: new Int32Array(N), exp: new Uint8Array(N), vis: new Uint16Array(N), mod: false, rev: 0 };
    const x0 = cx * CHUNK, y0 = cy * CHUNK;
    for (let j = 0; j < CHUNK; j++) for (let i = 0; i < CHUNK; i++) {
      const t = this.natural(x0 + i, y0 + j), k = j * CHUNK + i;
      c.t[k] = t;
      if (t === T.FOREST) c.wood[k] = TREE_WOOD;
    }
    this.chunks.set(ckey(cx, cy), c);
    if (withNodes) this.genNodes(c);
    return c;
  }

  /** Each chunk rolls once for each kind of node; the dice are the seed and the chunk. */
  genNodes(c) {
    const r = rng(hash(this.seed, c.cx, c.cy, 7));
    const x0 = c.cx * CHUNK, y0 = c.cy * CHUNK, dc = Math.hypot(x0 + 8, y0 + 8);
    const home = dc < 26;
    const rolls = [["gold", home ? 0 : 0.2], ["stone", home ? 0 : 0.2], ["oil", 0.09], ["aether", dc > 90 ? 0.05 : 0.0], ["relic", dc > 30 ? 0.07 : 0]];
    for (const [type, p] of rolls) {
      if (r() >= p) { r(); r(); continue; }
      const def = NODES[type], tx = x0 + 1 + Math.floor(r() * (CHUNK - def.w - 1)), ty = y0 + 1 + Math.floor(r() * (CHUNK - def.h - 1));
      if (this.canPlaceNode(tx, ty, def.w, def.h)) this.addNode(type, tx, ty, dc);
    }
    if (c.cx === 0 && c.cy === 0) this.addNode("gold", 9, 2, 0);
    if (c.cx === -1 && c.cy === 0) this.addNode("stone", -11, 4, 0);
    if (c.cx === 0 && c.cy === -1) this.addNode("stone", 4, -12, 0);
  }
  canPlaceNode(tx, ty, w, h) {
    for (let j = -1; j <= h; j++) for (let i = -1; i <= w; i++) {
      const x = tx + i, y = ty + j;
      const c = this.chunks.get(ckey(Math.floor(x / CHUNK), Math.floor(y / CHUNK)));
      const t = c ? c.t[this.idx(x, y)] : this.natural(x, y);
      if (c && c.occ[this.idx(x, y)]) return false;
      if (j >= 0 && j < h && i >= 0 && i < w && !(isWalk(t) || t === T.FOREST)) return false;
    }
    return Math.hypot(tx, ty) > 7;
  }
  addNode(type, tx, ty, dist, amount) {
    const def = NODES[type];
    const n = { id: this.nextNode--, kind: "node", type, tx, ty, w: def.w, h: def.h, x: (tx + def.w / 2) * TILE, y: (ty + def.h / 2) * TILE,
      amount: amount !== undefined ? amount : type === "gold" ? Math.round(3000 + dist * 14) : type === "stone" ? Math.round(2200 + dist * 9) : type === "relic" ? 1 : 0,
      max: 0, taken: 0, inside: 0, building: 0 };
    n.max = n.amount;
    // the ground under a node is cleared, without counting as a change: it is how the seed made it
    for (let j = 0; j < def.h; j++) for (let i = 0; i < def.w; i++) {
      const c = this.chunkAt(tx + i, ty + j), k = this.idx(tx + i, ty + j);
      if (c.t[k] === T.FOREST) { c.t[k] = T.GRASS; c.wood[k] = 0; }
      c.occ[k] = n.id;
    }
    this.nodes.set(n.id, n);
    return n;
  }
  removeNode(n) {
    this.freeArea(n.tx, n.ty, n.w, n.h, n.id);
    this.nodes.delete(n.id);
    for (let j = 0; j < n.h; j++) for (let i = 0; i < n.w; i++) this.setTerrain(n.tx + i, n.ty + j, T.DIRT);
  }

  /* ---------------- changes ---------------- */
  setTerrain(tx, ty, t) {
    if (!this.inBounds(tx, ty)) return;
    const c = this.chunkAt(tx, ty), k = this.idx(tx, ty);
    if (c.t[k] === t) return;
    c.t[k] = t; c.wood[k] = t === T.FOREST ? TREE_WOOD : 0;
    this.touch(c);
  }
  touch(c) {
    c.mod = true; c.rev++; this.version++;
    if (this.onChange) this.onChange(c.cx, c.cy);
  }
  /** Take wood from a tree; a tree with nothing left becomes a stump in the dirt. */
  chop(tx, ty, amount) {
    if (this.terrain(tx, ty) !== T.FOREST) return 0;
    const c = this.chunkAt(tx, ty), k = this.idx(tx, ty);
    const got = Math.min(amount, c.wood[k]);
    c.wood[k] -= got;
    c.mod = true;
    if (c.wood[k] <= 0) { c.t[k] = T.DIRT; this.touch(c); }
    return got;
  }
  occupyArea(tx, ty, w, h, id) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      if (!this.inBounds(tx + i, ty + j)) continue;
      const c = this.chunkAt(tx + i, ty + j); c.occ[this.idx(tx + i, ty + j)] = id;
    }
    this.version++;
  }
  freeArea(tx, ty, w, h, id) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      if (!this.inBounds(tx + i, ty + j)) continue;
      const c = this.chunkAt(tx + i, ty + j), k = this.idx(tx + i, ty + j);
      if (c.occ[k] === id) c.occ[k] = 0;
    }
    this.version++;
  }
  /** Clear ground for something to stand on (an enemy base): forest, rock and shallows become dirt. */
  clearArea(tx, ty, w, h) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const t = this.terrain(tx + i, ty + j);
      if (t === T.FOREST || t === T.ROCK || t === T.WATER || t === T.SAND) this.setTerrain(tx + i, ty + j, T.DIRT);
    }
  }

  /** Nearest tree to a point, searched outwards in rings. */
  nearestTree(tx, ty, maxR, skip) {
    for (let r = 0; r <= maxR; r++) {
      let best = null, bd = 1e9;
      for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
        const x = tx + i, y = ty + j;
        if (this.terrain(x, y) !== T.FOREST) continue;
        if (skip && skip(x, y)) continue;
        if (!this.hasOpenSide(x, y)) continue;
        const d = i * i + j * j;
        if (d < bd) { bd = d; best = { tx: x, ty: y }; }
      }
      if (best) return best;
    }
    return null;
  }
  hasOpenSide(tx, ty) {
    return this.passable(tx + 1, ty, "land") || this.passable(tx - 1, ty, "land") || this.passable(tx, ty + 1, "land") || this.passable(tx, ty - 1, "land");
  }
  /** Nearest walkable tile to a point (for something that finds itself inside a wall). */
  nearestOpen(tx, ty, move, maxR) {
    for (let r = 0; r <= (maxR || 12); r++) {
      for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
        if (this.passable(tx + i, ty + j, move)) return { tx: tx + i, ty: ty + j };
      }
    }
    return null;
  }

  /** Grow the border. side: "n" | "s" | "e" | "w"; by: tiles, rounded up to whole chunks. */
  expand(side, by) {
    by = Math.ceil(by / CHUNK) * CHUNK;
    const b = this.bounds;
    if (side === "n") b.y0 -= by; else if (side === "s") b.y1 += by; else if (side === "w") b.x0 -= by; else b.x1 += by;
    this.version++;
  }
  /** Make every chunk inside the border exist (so its nodes are rolled). */
  ensureAll() {
    const b = this.bounds;
    for (let cy = Math.floor(b.y0 / CHUNK); cy < Math.ceil(b.y1 / CHUNK); cy++)
      for (let cx = Math.floor(b.x0 / CHUNK); cx < Math.ceil(b.x1 / CHUNK); cx++) this.chunk(cx, cy);
  }
  /** A biome for colour only: 0 temperate, 1 dry, 2 cold. */
  biome(tx, ty) {
    const v = fbm(this.seed + 911, tx * 0.006, ty * 0.006, 2);
    return v > 0.28 ? 1 : v < -0.3 ? 2 : 0;
  }
}
