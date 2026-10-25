/* world.js — the seeded, endless world, as data.
 *
 * Everything here is a pure function of the seed and a chunk's coordinates:
 * no DOM, no three.js, no state that depends on where you have been. The
 * same seed always grows the same world, a chunk rebuilt after you walk
 * away and back is the chunk you left, and tools/validate.js imports this
 * straight into Node to hold it to that.
 *
 * What came from the Phaser build (static/js/phaser/world/ChunkManager.js
 * and PathwayRenderer.js), and what changed:
 *
 *   Chunks       still 8×8 cells, now 2 m a cell, so a chunk is 16 m.
 *   Presets      the same 8×8 grids, in presets.js, chosen the same way:
 *                a road passing through wins, then the biome's own presets,
 *                weighted by rarity, then Plains as a fallback.
 *   Biomes       the same twelve, with the same rarities and the same split
 *                into large regions and small patches. The old lookup cut
 *                the map into squares (60 chunks for a region, 10 for a
 *                patch), so every border was a straight line; here each
 *                region and patch grows round a jittered site and the
 *                borders are bent by noise.
 *   Roads        the old network was fifteen landmarks within 30 chunks of
 *                the start and nothing beyond, on a world that never ends.
 *                Now every region of 10×10 chunks has a hub, hubs join
 *                their east and south neighbours most of the time, and a
 *                road runs out, across and in (a Z, not the old staircase).
 *                A waystone stands on every hub.
 *   Structures   the nine multi-chunk structures the Phaser build defined
 *                and never placed are placed: at most one in every 6×6
 *                chunks, only where its biome allows, never across a road.
 *                Four of them (fortress, mage tower, plaza, courtyard) are
 *                great structures, each held by a Warden.
 *
 * Axes: x runs east, z runs south, so a preset's row is z and its column x,
 * exactly as the grids read on the page. */

import { CHUNK_PRESETS, STRUCTURES, STRUCTURE_PARTS } from "./presets.js";

export const CELL = 2;
export const GRID = 8;
export const CHUNK = CELL * GRID;          // 16 m
export const SPAWN_CLEAR = 7;              // metres around the start kept empty
export const REGION = 10;                  // chunks per road region
export const STRUCT_CELL = 6;              // chunks per structure cell

/* ---------------------------------------------------------------
   Biomes. rarity/scale/min/max are the Phaser build's Config.Biomes;
   colours and everything below them are new.
   --------------------------------------------------------------- */
export const BIOMES = {
  Plains:    { rarity: 2.5, scale: "large", min: 4, max: 10, ground: 0x86b24f, alt: 0xa3c45c, path: "dirt",   pack: 0.10, foes: ["prowler"] },
  Forest:    { rarity: 1.5, scale: "large", min: 4, max: 8,  ground: 0x4f8a3c, alt: 0x3f7531, path: "dirt",   pack: 0.20, foes: ["prowler", "brute"] },
  Rocky:     { rarity: 0.8, scale: "large", min: 2, max: 5,  ground: 0x8d8a72, alt: 0x76735f, path: "stone",  pack: 0.18, foes: ["brute", "hexer"] },
  Ruins:     { rarity: 0.5, scale: "small", min: 2, max: 4,  ground: 0x7f8a5a, alt: 0x9a9a78, path: "stone",  pack: 0.34, foes: ["hexer", "prowler", "brute"] },
  Village:   { rarity: 0.5, scale: "small", min: 3, max: 6,  ground: 0x93b25a, alt: 0xb3a26c, path: "cobble", pack: 0.06, foes: ["prowler"] },
  Swamp:     { rarity: 0.6, scale: "large", min: 2, max: 4,  ground: 0x5a6b3a, alt: 0x47552f, path: "dirt",   pack: 0.28, foes: ["wisp", "brute"] },
  Desert:    { rarity: 1.2, scale: "large", min: 3, max: 6,  ground: 0xdcc287, alt: 0xcfae6e, path: "sand",   pack: 0.18, foes: ["prowler", "hexer"] },
  Graveyard: { rarity: 0.4, scale: "small", min: 1, max: 3,  ground: 0x5f6656, alt: 0x51574a, path: "stone",  pack: 0.45, foes: ["wisp", "hexer"] },
  Camp:      { rarity: 0.4, scale: "small", min: 1, max: 2,  ground: 0x9c9a5e, alt: 0x8a7a52, path: "dirt",   pack: 0.50, foes: ["brute", "hexer", "prowler"] },
  Lake:      { rarity: 0.5, scale: "large", min: 2, max: 4,  ground: 0x77ad5b, alt: 0x8fb874, path: "dirt",   pack: 0.08, foes: ["wisp"] },
  Cave:      { rarity: 0.4, scale: "small", min: 2, max: 4,  ground: 0x6b665c, alt: 0x58534b, path: "stone",  pack: 0.32, foes: ["brute", "wisp"] },
  Clearing:  { rarity: 1.5, scale: "small", min: 2, max: 4,  ground: 0x8fbf5a, alt: 0xa6cc6a, path: "dirt",   pack: 0,    foes: [] }
};
export const BIOME_IDS = Object.keys(BIOMES);

/* The two-letter codes of presets.js, as things. Rotation is about the
   vertical, 0 = along x (east–west). */
export const OBJECT_CODES = {
  TR: { kind: "tree" }, RK: { kind: "rock" }, CF: { kind: "cliff" },
  WH: { kind: "wall", rot: 0 }, WV: { kind: "wall", rot: Math.PI / 2 },
  WD: { kind: "wall", rot: Math.PI / 4 }, WA: { kind: "wall", rot: -Math.PI / 4 },
  CR: { kind: "crate" }, BR: { kind: "barrel" }, ST: { kind: "stairs" }
};
export const FLOOR_CODES = { ST: "stone", CB: "cobble" };

/* What each kind is to the game: whether it blocks, whether it can be
   pushed, how hard it is to break. Sizes are metres. Same table as the
   Phaser build's Config.Objects, rescaled from pixels (20 px a metre). */
export const KINDS = {
  tree:   { hp: 150, r: 0.55, mass: 500, solid: true,  moveable: false, immortal: false },
  rock:   { hp: 400, r: 0.75, mass: 250, solid: true,  moveable: true,  immortal: false },
  cliff:  { hp: Infinity, r: 1.25, mass: Infinity, solid: true, moveable: false, immortal: true },
  wall:   { hp: Infinity, r: 0, mass: Infinity, solid: true, moveable: false, immortal: true, box: [1.05, 0.32] },
  crate:  { hp: 40,  r: 0.5, mass: 40,  solid: true,  moveable: true,  immortal: false, loot: 0.35 },
  barrel: { hp: 60,  r: 0.45, mass: 60, solid: true,  moveable: true,  immortal: false, loot: 0.3 },
  stairs: { hp: Infinity, r: 0.9, mass: Infinity, solid: false, moveable: false, immortal: true }
};

export const GREAT = { fortress: true, mage_tower: true, central_plaza: true, u_courtyard: true };
export const STRUCTURE_NAMES = {
  fortress: "Fortress", huge_grove: "Old Grove", big_lake: "Still Lake", grand_bridge: "Long Bridge",
  long_market: "Market Row", central_plaza: "Plaza", village_corner: "Hamlet", u_courtyard: "Courtyard",
  mage_tower: "Mage Tower"
};
/* Which Warden holds a great structure, by the biome it stands in. The four
   are the Phaser build's BossConfigs, and the biomes its Themes paired them with. */
export const WARDEN_FOR_BIOME = { Forest: "verdant", Plains: "verdant", Village: "ashfall", Desert: "ashfall", Graveyard: "ashfall", Ruins: "void", Camp: "void", Cave: "depths", Rocky: "depths", Swamp: "depths" };
/* The biomes presets.js lists per structure are all small patches or the
   forest, so placed by those alone the open lands got nothing but bridges.
   These are the other places each one may stand, at a quarter of its weight. */
const EXTRA_BIOMES = {
  fortress: ["Plains", "Rocky", "Desert"], mage_tower: ["Rocky", "Swamp", "Cave"],
  central_plaza: ["Plains"], u_courtyard: ["Desert", "Graveyard", "Plains"],
  long_market: ["Plains", "Desert"], village_corner: ["Plains", "Lake"], grand_bridge: [],
  huge_grove: ["Plains"], big_lake: ["Plains"]
};

/* ---------------------------------------------------------------
   Hashing and noise: integer hashes, so a coordinate a million chunks
   out is as random as one next to the start.
   --------------------------------------------------------------- */
function mix(h) {
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15; h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}
export function hashString(s) {
  let h = 2166136261;
  s = String(s);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return mix(h);
}
/** A float in [0, 1) for (seed, a, b, salt). */
export function rnd(seed, a, b, salt) {
  return mix(seed ^ mix(((a | 0) * 0x27d4eb2d) ^ mix(((b | 0) * 0x165667b1) ^ mix(((salt | 0) + 1) * 0x9e3779b1)))) / 4294967296;
}
const smooth = (t) => t * t * (3 - 2 * t);
function noise2(seed, x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = smooth(xf), v = smooth(yf);
  const a = rnd(seed, xi, yi, 7), b = rnd(seed, xi + 1, yi, 7), c = rnd(seed, xi, yi + 1, 7), d = rnd(seed, xi + 1, yi + 1, 7);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(seed, x, y, oct) {
  let s = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < (oct || 3); i++) { s += noise2(seed + i * 1013, x * f, y * f) * amp; norm += amp; amp *= 0.5; f *= 2; }
  return s / norm;
}
function weighted(list, r) {
  let total = 0;
  for (const it of list) total += it.w;
  let t = r * total;
  for (const it of list) { t -= it.w; if (t <= 0) return it.id; }
  return list[list.length - 1].id;
}

export const key = (cx, cz) => cx + "," + cz;
/** The chunk holding a structure's centre. A centre on a chunk edge belongs
 *  to the chunk west or north of it, which every structure's parts include. */
export const centreChunk = (s) => ({ cx: Math.floor(s.x / CHUNK - 1e-6), cz: Math.floor(s.z / CHUNK - 1e-6) });
export const DIR = { N: 1, E: 2, S: 4, W: 8 };

/* ---------------------------------------------------------------
   createWorld(seedText) → the world for that seed
   --------------------------------------------------------------- */
export function createWorld(seedText) {
  const seedTextClean = String(seedText == null ? "" : seedText).slice(0, 32);
  const seed = hashString(seedTextClean || "magic circles");
  const large = [], small = [];
  for (const id of BIOME_IDS) {
    if (id === "Clearing") continue;
    (BIOMES[id].scale === "small" ? small : large).push({ id, w: BIOMES[id].rarity });
  }

  /* ----- biomes ----- */
  const LARGE = 8, SMALL = 5;
  // u, v are in chunks; returns a biome id
  function biomeAtChunkUnits(u, v) {
    if (u * u + v * v < 2.6) return "Clearing";
    const wu = u + (fbm(seed + 11, u * 0.16, v * 0.16, 2) - 0.5) * 3.4;
    const wv = v + (fbm(seed + 23, u * 0.16, v * 0.16, 2) - 0.5) * 3.4;
    // small patches first: a patch sits on top of whatever region it is in
    const si = Math.floor(wu / SMALL), sj = Math.floor(wv / SMALL);
    let best = null, bestD = Infinity;
    for (let i = si - 1; i <= si + 1; i++) for (let j = sj - 1; j <= sj + 1; j++) {
      if (rnd(seed, i, j, 101) >= 0.35) continue;
      const id = weighted(small, rnd(seed, i, j, 102));
      const B = BIOMES[id];
      const size = B.min + (B.max - B.min) * rnd(seed, i, j, 103);
      const rad = Math.sqrt(size / Math.PI) * 1.25;
      const px = (i + 0.25 + 0.5 * rnd(seed, i, j, 104)) * SMALL, py = (j + 0.25 + 0.5 * rnd(seed, i, j, 105)) * SMALL;
      const d = Math.hypot(wu - px, wv - py) / rad;
      if (d < 1 && d < bestD) { bestD = d; best = id; }
    }
    if (best) return best;
    const li = Math.floor(wu / LARGE), lj = Math.floor(wv / LARGE);
    let bd = Infinity, bid = "Plains";
    for (let i = li - 1; i <= li + 1; i++) for (let j = lj - 1; j <= lj + 1; j++) {
      const px = (i + 0.15 + 0.7 * rnd(seed, i, j, 201)) * LARGE, py = (j + 0.15 + 0.7 * rnd(seed, i, j, 202)) * LARGE;
      const d = Math.hypot(wu - px, wv - py);
      if (d < bd) { bd = d; bid = weighted(large, rnd(seed, i, j, 203)); }
    }
    return bid;
  }
  /** Biome at a point in metres. */
  function biomeAt(x, z) { return biomeAtChunkUnits(x / CHUNK, z / CHUNK); }
  const biomeCache = new Map();
  function chunkBiome(cx, cz) {
    const k = key(cx, cz);
    let b = biomeCache.get(k);
    if (!b) { b = biomeAtChunkUnits(cx + 0.5, cz + 0.5); if (biomeCache.size > 20000) biomeCache.clear(); biomeCache.set(k, b); }
    return b;
  }

  /* ----- roads ----- */
  const region = (c) => Math.floor((c + REGION / 2) / REGION);
  function hub(rx, rz) {
    if (rx === 0 && rz === 0) return { cx: 0, cz: 0 };
    return {
      cx: rx * REGION - 3 + Math.floor(rnd(seed, rx, rz, 301) * 6),
      cz: rz * REGION - 3 + Math.floor(rnd(seed, rx, rz, 302) * 6)
    };
  }
  // The start always has all four roads, so the first thing you see leads somewhere.
  const touchesOrigin = (ax, az, bx, bz) => (ax === 0 && az === 0) || (bx === 0 && bz === 0);
  const eastRoll = (rx, rz) => touchesOrigin(rx, rz, rx + 1, rz) || rnd(seed, rx, rz, 311) < 0.72;
  const southRoll = (rx, rz) => touchesOrigin(rx, rz, rx, rz + 1) || rnd(seed, rx, rz, 312) < 0.72;
  const hasEast = eastRoll;
  // A hub whose four roads all rolled "no" would be a waystone in a field
  // with no way to it; such a hub keeps its road south.
  const hasSouth = (rx, rz) => southRoll(rx, rz) || (!eastRoll(rx, rz) && !eastRoll(rx - 1, rz) && !southRoll(rx, rz - 1));

  const rasters = new Map();
  /** Every road cell of the edges that start in region (rx, rz): its east and south roads. */
  function regionRaster(rx, rz) {
    const k = key(rx, rz);
    let m = rasters.get(k);
    if (m) return m;
    m = new Map();
    const mark = (cx, cz, d) => { const kk = key(cx, cz); m.set(kk, (m.get(kk) || 0) | d); };
    const step = (x0, z0, x1, z1) => {
      // walk one axis at a time, marking both ends of each step
      let x = x0, z = z0;
      while (x !== x1) { const s = Math.sign(x1 - x); mark(x, z, s > 0 ? DIR.E : DIR.W); x += s; mark(x, z, s > 0 ? DIR.W : DIR.E); }
      while (z !== z1) { const s = Math.sign(z1 - z); mark(x, z, s > 0 ? DIR.S : DIR.N); z += s; mark(x, z, s > 0 ? DIR.N : DIR.S); }
    };
    const A = hub(rx, rz);
    if (hasEast(rx, rz)) {
      const B = hub(rx + 1, rz);
      const mid = A.cx + 1 + Math.floor(rnd(seed, rx, rz, 321) * Math.max(1, B.cx - A.cx - 1));
      step(A.cx, A.cz, mid, A.cz); step(mid, A.cz, mid, B.cz); step(mid, B.cz, B.cx, B.cz);
    }
    if (hasSouth(rx, rz)) {
      const B = hub(rx, rz + 1);
      const mid = A.cz + 1 + Math.floor(rnd(seed, rx, rz, 322) * Math.max(1, B.cz - A.cz - 1));
      step(A.cx, A.cz, A.cx, mid); step(A.cx, mid, B.cx, mid); step(B.cx, mid, B.cx, B.cz);
    }
    if (rasters.size > 4000) rasters.clear();
    rasters.set(k, m);
    return m;
  }
  /** The directions a road leaves chunk (cx, cz) in, as a DIR bitmask. */
  function roadDirs(cx, cz) {
    const rx = region(cx), rz = region(cz), k = key(cx, cz);
    return (regionRaster(rx, rz).get(k) || 0) | (regionRaster(rx - 1, rz).get(k) || 0) | (regionRaster(rx, rz - 1).get(k) || 0);
  }
  function isHub(cx, cz) { const h = hub(region(cx), region(cz)); return h.cx === cx && h.cz === cz; }
  function hubOf(cx, cz) { return hub(region(cx), region(cz)); }

  /* ----- structures ----- */
  const scell = (c) => Math.floor((c + STRUCT_CELL / 2) / STRUCT_CELL);
  const structCache = new Map();
  function structureInCell(i, j) {
    const k = key(i, j);
    if (structCache.has(k)) return structCache.get(k);
    let out = null;
    if (!(i === 0 && j === 0) && rnd(seed, i, j, 401) < 0.6) {
      const biome = chunkBiome(i * STRUCT_CELL, j * STRUCT_CELL);
      const cands = [];
      for (const t of Object.keys(STRUCTURES)) {
        // a Warden's place should be an event, not every other wood
        const w = STRUCTURES[t].rarity * (GREAT[t] ? 0.45 : 1);
        if (STRUCTURES[t].biomes.includes(biome)) cands.push({ id: t, w });
        else if ((EXTRA_BIOMES[t] || []).includes(biome)) cands.push({ id: t, w: w * 0.25 });
      }
      if (cands.length) {
        const type = weighted(cands, rnd(seed, i, j, 402));
        const S = STRUCTURES[type];
        const x0 = i * STRUCT_CELL - STRUCT_CELL / 2, z0 = j * STRUCT_CELL - STRUCT_CELL / 2;
        const ax = x0 + Math.floor(rnd(seed, i, j, 403) * (STRUCT_CELL - S.w + 1));
        const az = z0 + Math.floor(rnd(seed, i, j, 404) * (STRUCT_CELL - S.h + 1));
        let clear = true;
        for (const p of S.parts) {
          const cx = ax + p.dx, cz = az + p.dy;
          if (roadDirs(cx, cz) || isHub(cx, cz) || Math.max(Math.abs(cx), Math.abs(cz)) <= 2) { clear = false; break; }
        }
        if (clear) {
          out = {
            id: "s" + i + "_" + j, type, name: STRUCTURE_NAMES[type] || type, biome, great: !!GREAT[type],
            ax, az, w: S.w, h: S.h,
            x: (ax + S.w / 2) * CHUNK, z: (az + S.h / 2) * CHUNK
          };
          if (out.great) out.warden = WARDEN_FOR_BIOME[biome] || (rnd(seed, i, j, 405) < 0.5 ? "depths" : "void");
        }
      }
    }
    if (structCache.size > 20000) structCache.clear();
    structCache.set(k, out);
    return out;
  }
  /** The structure covering chunk (cx, cz), and which of its parts this chunk is. */
  function structureAt(cx, cz) {
    const s = structureInCell(scell(cx), scell(cz));
    if (!s) return null;
    const dx = cx - s.ax, dy = cz - s.az;
    if (dx < 0 || dy < 0 || dx >= s.w || dy >= s.h) return null;
    const part = STRUCTURES[s.type].parts.find((p) => p.dx === dx && p.dy === dy);
    return part ? { s, preset: part.preset } : null;
  }
  /** Structures whose cells lie within `radius` metres of (x, z), nearest first. */
  function structuresNear(x, z, radius) {
    const out = [];
    const r = Math.ceil(radius / (CHUNK * STRUCT_CELL)) + 1;
    const ci = scell(Math.floor(x / CHUNK)), cj = scell(Math.floor(z / CHUNK));
    for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) {
      const s = structureInCell(i, j);
      if (s && Math.hypot(s.x - x, s.z - z) <= radius) out.push(s);
    }
    out.sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
    return out;
  }
  /** Waystones (road hubs) within `radius` metres. */
  function waystonesNear(x, z, radius) {
    const out = [];
    const r = Math.ceil(radius / (CHUNK * REGION)) + 1;
    const rx0 = region(Math.floor(x / CHUNK)), rz0 = region(Math.floor(z / CHUNK));
    for (let i = rx0 - r; i <= rx0 + r; i++) for (let j = rz0 - r; j <= rz0 + r; j++) {
      const h = hub(i, j);
      const wx = h.cx * CHUNK + CHUNK / 2, wz = h.cz * CHUNK + CHUNK / 2;
      if (Math.hypot(wx - x, wz - z) <= radius) out.push({ id: "w" + h.cx + "_" + h.cz, x: wx, z: wz, cx: h.cx, cz: h.cz });
    }
    return out;
  }

  /* ----- water ----- */
  function isWaterAt(x, z, biome) {
    biome = biome || biomeAt(x, z);
    if (biome === "Lake") return fbm(seed + 51, x / 22, z / 22, 3) > 0.47;
    if (biome === "Swamp") return fbm(seed + 53, x / 9, z / 9, 2) > 0.62;
    return false;
  }

  /** How dangerous the land is at a point: 1 at the start, one more every 150 m. */
  const dangerAt = (x, z) => 1 + Math.floor(Math.hypot(x, z) / 150);

  /* ----- chunks ----- */
  const PATH_TYPE = { 5: "NS", 10: "EW", 15: "CROSS", 3: "NE", 9: "NW", 6: "SE", 12: "SW", 11: "T_N", 14: "T_S", 7: "T_E", 13: "T_W", 1: "NS", 4: "NS", 2: "EW", 8: "EW" };
  const presetList = (pred) => Object.entries(CHUNK_PRESETS).filter(([, p]) => pred(p)).map(([id, p]) => ({ id, w: p.rarity === undefined ? 1 : p.rarity }));
  const byBiome = {};
  for (const b of BIOME_IDS) byBiome[b] = presetList((p) => p.biome === b && (p.rarity === undefined || p.rarity > 0));
  const fallback = presetList((p) => (p.biome === "Plains" || p.biome === "Clearing") && p.rarity > 0);
  const byPath = {};
  for (const t of new Set(Object.values(PATH_TYPE))) byPath[t] = Object.entries(CHUNK_PRESETS).filter(([, p]) => p.pathType === t).map(([id]) => ({ id, w: 1 }));

  /** Which cells of a chunk the road covers: the middle two rows/columns, out to each side it leaves by. */
  function roadCells(mask) {
    const set = new Set();
    if (!mask) return set;
    const add = (r, c) => set.add(r * GRID + c);
    for (const r of [3, 4]) for (const c of [3, 4]) add(r, c);
    for (let i = 0; i < GRID; i++) for (const m of [3, 4]) {
      if ((mask & DIR.N) && i <= 4) add(i, m);
      if ((mask & DIR.S) && i >= 3) add(i, m);
      if ((mask & DIR.E) && i >= 3) add(m, i);
      if ((mask & DIR.W) && i <= 4) add(m, i);
    }
    return set;
  }

  const chunkCache = new Map();
  function chunk(cx, cz) {
    const k = key(cx, cz);
    let C = chunkCache.get(k);
    if (C) return C;
    C = buildChunk(cx, cz);
    if (chunkCache.size > 600) chunkCache.delete(chunkCache.keys().next().value);
    chunkCache.set(k, C);
    return C;
  }

  function buildChunk(cx, cz) {
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    const biome = chunkBiome(cx, cz);
    const road = roadDirs(cx, cz);
    const hubHere = isHub(cx, cz);
    const st = structureAt(cx, cz);
    let presetId, grid;
    if (st) { presetId = st.preset; grid = STRUCTURE_PARTS[st.preset]; }
    else {
      let list = road ? byPath[PATH_TYPE[road]] : null;
      if (!list || !list.length) list = byBiome[biome] && byBiome[biome].length ? byBiome[biome] : fallback;
      presetId = weighted(list, rnd(seed, cx, cz, 999));
      grid = CHUNK_PRESETS[presetId].grid;
    }
    const rc = roadCells(road);
    const water = new Uint8Array(GRID * GRID);
    const floors = [];
    const objects = [];
    const blocked = new Uint8Array(GRID * GRID);
    const S = st ? st.s : null;
    const lakeStructure = S && S.type === "big_lake";

    for (let row = 0; row < GRID; row++) {
      const cells = grid[row].split(" ");
      for (let col = 0; col < GRID; col++) {
        const i = row * GRID + col;
        const [obj, floor] = cells[col].split(":");
        const wx = x0 + col * CELL + CELL / 2, wz = z0 + row * CELL + CELL / 2;
        const onRoad = rc.has(i);
        if (floor && FLOOR_CODES[floor] && !onRoad) floors.push({ i, code: FLOOR_CODES[floor] });
        const def = OBJECT_CODES[obj];
        const nearStart = Math.hypot(wx, wz) < SPAWN_CLEAR;
        const nearHub = hubHere && Math.hypot(wx - (x0 + CHUNK / 2), wz - (z0 + CHUNK / 2)) < 4.5;
        const nearCentre = S && S.great && Math.hypot(wx - S.x, wz - S.z) < 5.5;
        if (!floor && !onRoad && !def && !nearHub) {
          if (lakeStructure ? Math.hypot((wx - S.x) / 1.15, wz - S.z) < 10.5 : (!S && isWaterAt(wx, wz))) water[i] = 1;
        }
        if (!def || onRoad || nearStart || nearHub || nearCentre || water[i]) continue;
        const K = KINDS[def.kind];
        // a little jitter so a grid of trees reads as a wood, never for built things
        const jit = def.kind === "tree" || def.kind === "rock" ? 0.5 : def.kind === "crate" || def.kind === "barrel" ? 0.3 : 0;
        objects.push({
          id: i, kind: def.kind, code: obj,
          x: wx + (rnd(seed, cx * 8 + col, cz * 8 + row, 3) - 0.5) * jit,
          z: wz + (rnd(seed, cx * 8 + col, cz * 8 + row, 4) - 0.5) * jit,
          rot: def.rot !== undefined ? def.rot : rnd(seed, cx * 8 + col, cz * 8 + row, 5) * Math.PI * 2,
          v: rnd(seed, cx * 8 + col, cz * 8 + row, 6),
          s: 0.85 + 0.3 * rnd(seed, cx * 8 + col, cz * 8 + row, 7),
          hp: K.hp
        });
        if (K.solid) blocked[i] = 1;
      }
    }

    const C = {
      cx, cz, key: key(cx, cz), x0, z0, biome, preset: presetId, road, roadCells: rc,
      structure: S, objects, floors, water, danger: dangerAt(x0 + CHUNK / 2, z0 + CHUNK / 2),
      waystone: hubHere ? { id: "w" + cx + "_" + cz, x: x0 + CHUNK / 2, z: z0 + CHUNK / 2 } : null,
      pack: [], chest: null, warden: null, centrepiece: null
    };

    /* where something can stand: not inside an object, not in water */
    const open = [];
    for (let i = 0; i < GRID * GRID; i++) if (!blocked[i] && !water[i]) open.push(i);
    const cellPos = (i) => ({ x: x0 + (i % GRID) * CELL + CELL / 2, z: z0 + Math.floor(i / GRID) * CELL + CELL / 2 });

    /* a structure's chest, and a great structure's centrepiece and Warden, live in the chunk holding its centre */
    if (S) {
      const cc = centreChunk(S);
      if (cc.cx === cx && cc.cz === cz) {
        if (S.great) {
          C.centrepiece = { type: S.type, x: S.x, z: S.z };
          C.warden = { id: S.id, type: S.warden, x: S.x, z: S.z + 6, danger: C.danger };
        } else {
          let best = -1, bd = Infinity;
          for (const i of open) { const p = cellPos(i); const d = Math.hypot(p.x - S.x, p.z - S.z); if (d < bd && !rc.has(i)) { bd = d; best = i; } }
          if (best >= 0) { const p = cellPos(best); C.chest = { id: S.id, x: p.x, z: p.z }; }
        }
      }
    }

    /* a pack of the things that live here, seeded per chunk */
    const B = BIOMES[biome];
    const far = Math.hypot(x0 + CHUNK / 2, z0 + CHUNK / 2) > 44;
    if (far && !hubHere && !C.centrepiece && B.foes.length && rnd(seed, cx, cz, 501) < B.pack * (S ? 1.6 : 1)) {
      const n = Math.min(5, 1 + Math.floor(rnd(seed, cx, cz, 502) * 2) + Math.floor((C.danger - 1) / 2));
      const spots = open.filter((i) => !rc.has(i));
      for (let k = 0; k < n && spots.length; k++) {
        const at = Math.floor(rnd(seed, cx * 31 + k, cz, 503) * spots.length);
        const p = cellPos(spots.splice(at, 1)[0]);
        C.pack.push({ kind: B.foes[Math.floor(rnd(seed, cx, cz * 31 + k, 504) * B.foes.length)], x: p.x, z: p.z });
      }
    }
    if (C.warden) {
      // two of the land's own creatures stand guard
      for (let k = 0; k < 2; k++) C.pack.push({ kind: (B.foes.length ? B.foes : ["brute"])[k % Math.max(1, B.foes.length)], x: S.x + (k ? 4 : -4), z: S.z + 3 });
    }
    return C;
  }

  return {
    seedText: seedTextClean, seed,
    biomeAt, chunkBiome, roadDirs, isHub, hubOf, structureAt, structureInCell, structuresNear, waystonesNear,
    isWaterAt, dangerAt, chunk, roadCells,
    chunkOf: (x, z) => ({ cx: Math.floor(x / CHUNK), cz: Math.floor(z / CHUNK) }),
    /** For tests and the map: forget everything cached. */
    clearCache() { biomeCache.clear(); rasters.clear(); structCache.clear(); chunkCache.clear(); }
  };
}

/** A fresh, readable seed: two words and a number, so it can be read out to someone. */
const WORDS_A = ["amber", "ashen", "bright", "cold", "dusk", "ember", "fallow", "gilded", "hollow", "iron", "jade", "lost", "mossy", "old", "pale", "quiet", "rust", "silver", "sunken", "tidal", "umber", "violet", "wild", "young"];
const WORDS_B = ["vale", "reach", "moor", "fen", "march", "downs", "wold", "heath", "glen", "shore", "weald", "barrow", "cairn", "dale", "ford", "holt", "mere", "ridge", "tor", "wick"];
export function randomSeedText(r) {
  r = r || Math.random;
  return WORDS_A[Math.floor(r() * WORDS_A.length)] + "-" + WORDS_B[Math.floor(r() * WORDS_B.length)] + "-" + (100 + Math.floor(r() * 900));
}
