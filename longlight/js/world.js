/* world.js — a piece of Antarctica, from a seed.
 *
 * Pure: no DOM, no three. The page builds it once (in a worker, terrain.js),
 * the worker meshes it, game.js walks on it and tools/validate.js builds
 * dozens of them in Node and walks the route of every one.
 *
 * How the land is made — the usual, proven recipe for generated terrain,
 * layered the way the real coast is layered:
 *
 *   1. Rock. Musgrave's ridged multifractal (sharp crests, smooth valleys),
 *      sampled through a domain warp (Quilez) so ridgelines meander, on
 *      Jonas Wagner's simplex noise (vendor/simplex-noise). Then weathered:
 *      Beyer's droplet hydraulic erosion — the method behind Sebastian
 *      Lague's widely copied erosion — cuts gullies down every face, and a
 *      thermal (talus) pass settles what is left steeper than scree lies.
 *   2. Ice. A smooth sheet rising from the coast toward the plateau,
 *      lowered where a glacier runs down to the sea. Rock shows only where
 *      it stands above the ice: nunataks, ridges, the range in the south.
 *      That is how this coast looks — white, with stone poking through it.
 *   3. Sea. North of the coast: fast sea ice with pressure ridges and leads
 *      of black water, open water beyond, tabular bergs frozen into it.
 *   4. Wind. Sastrugi — ridges carved by the katabatic wind, all lying the
 *      same way — and crevasses across the glacier where the ice is pulled.
 *
 * The macro shape (rock, ice, sea, the masks) is baked into a 513² grid at
 * 16 m; everything finer is a function evaluated where it is asked for, so
 * a footprint and the mesh under it agree to the millimetre.
 *
 * Coordinates: metres, x east, z south (north is -z, where the sea is), y up. */

import { createNoise2D } from "../vendor/simplex-noise/simplex-noise.js";
import { rng } from "./rng.js";

export const SIZE = 8192, HALF = SIZE / 2, CELL = 16, N = SIZE / CELL + 1;
export const SEA_ICE_Y = 0.32;      // the top of the fast ice, above the water at 0
export const ROUTE_W = 26;          // half-width of the old flagged route, where the way is kept clear
export const DEFAULT_SEED = 1911;   // Amundsen's year at the Pole; any seed makes a coast

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

/* ------------------------------------------------------------------ */
/* Noise                                                              */

function fbm(n, x, z, oct, lac, gain) {
  let s = 0, a = 1, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) { s += a * n(x * f, z * f); norm += a; a *= gain || 0.5; f *= lac || 2.03; }
  return s / norm;
}
/* Musgrave's ridged multifractal: each octave's ridges are weighted by the
   one before, so crests stay sharp and the lowlands stay quiet. 0..1. */
function ridged(n, x, z, oct) {
  let s = 0, f = 1, a = 1, w = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    let v = 1 - Math.abs(n(x * f, z * f));
    v *= v; v *= w;
    w = clamp(v * 2, 0, 1);
    s += v * a; norm += a;
    f *= 2.1; a *= 0.5;
  }
  return s / norm;
}

/* ------------------------------------------------------------------ */
/* Erosion                                                            */

/* Beyer, "Implementation of a method for hydraulic erosion" (2015): drops
   of rain run downhill with a little inertia, pick up what their speed and
   water can carry, and set it down where they slow. Heights in metres;
   the parameters are Beyer's, scaled to a 16 m grid. */
function erodeHydraulic(map, n, drops, r, report) {
  const inertia = 0.05, capF = 4, minCap = 0.01, erodeS = 0.3, depositS = 0.3, evap = 0.012, gravity = 4, life = 40, R = 3;
  // the brush: every cell within R, weighted by nearness
  const bx = [], bz = [], bw = [];
  let wsum = 0;
  for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
    const d = Math.hypot(dx, dz);
    if (d >= R) continue;
    bx.push(dx); bz.push(dz); bw.push(1 - d / R); wsum += 1 - d / R;
  }
  for (let i = 0; i < bw.length; i++) bw[i] /= wsum;
  const S = 1 / 120;   // metres into the units the parameters expect
  const hg = (x, z) => {
    const ix = x | 0, iz = z | 0, u = x - ix, v = z - iz, k = iz * n + ix;
    const a = map[k], b = map[k + 1], c = map[k + n], d = map[k + n + 1];
    return [(a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v) * S, ((b - a) * (1 - v) + (d - c) * v) * S, ((c - a) * (1 - u) + (d - b) * u) * S];
  };
  for (let k = 0; k < drops; k++) {
    if (report && (k & 4095) === 0) report(k / drops);
    let x = 1 + r() * (n - 3), z = 1 + r() * (n - 3), dx = 0, dz = 0, speed = 1, water = 1, sed = 0;
    for (let t = 0; t < life; t++) {
      const ix = x | 0, iz = z | 0, u = x - ix, v = z - iz, cell = iz * n + ix;
      const [h, gx, gz] = hg(x, z);
      dx = dx * inertia - gx * (1 - inertia);
      dz = dz * inertia - gz * (1 - inertia);
      const len = Math.hypot(dx, dz);
      if (len < 1e-9) break;
      dx /= len; dz /= len;
      x += dx; z += dz;
      if (x < 1 || z < 1 || x >= n - 2 || z >= n - 2) break;
      const dh = hg(x, z)[0] - h;
      const cap = Math.max(-dh * speed * water * capF, minCap);
      if (sed > cap || dh > 0) {
        const amt = dh > 0 ? Math.min(dh, sed) : (sed - cap) * depositS;
        sed -= amt;
        const m = amt / S;
        map[cell] += m * (1 - u) * (1 - v); map[cell + 1] += m * u * (1 - v);
        map[cell + n] += m * (1 - u) * v; map[cell + n + 1] += m * u * v;
      } else {
        const amt = Math.min((cap - sed) * erodeS, -dh);
        for (let b = 0; b < bw.length; b++) {
          const cx = ix + bx[b], cz = iz + bz[b];
          if (cx < 0 || cz < 0 || cx >= n || cz >= n) continue;
          const c = cz * n + cx, take = Math.min(map[c] * S + 10, amt * bw[b]);
          map[c] -= take / S;
          sed += take;
        }
      }
      speed = Math.sqrt(Math.max(0, speed * speed + dh * gravity));
      water *= 1 - evap;
    }
  }
}

/* Thermal weathering: wherever a cell stands higher above a neighbour than
   loose rock will lie (the talus angle), some of it slides down. */
function erodeThermal(map, n, iters, talus) {
  const lim = Math.tan(talus) * CELL;
  const nb = [1, -1, n, -n];
  for (let it = 0; it < iters; it++) {
    for (let z = 1; z < n - 1; z++) for (let x = 1; x < n - 1; x++) {
      const c = z * n + x, h = map[c];
      let maxD = 0, sum = 0;
      for (const o of nb) { const d = h - map[c + o]; if (d > lim) { sum += d - lim; if (d > maxD) maxD = d; } }
      if (!sum) continue;
      const move = 0.25 * (maxD - lim);
      for (const o of nb) { const d = h - map[c + o]; if (d > lim) { const m = move * (d - lim) / sum; map[c] -= m; map[c + o] += m; } }
    }
  }
}

/* ------------------------------------------------------------------ */
/* The world                                                          */

/**
 * Build a world. `report(stage, fraction)` hears how far along it is.
 * Returns the plain-data world: arrays and sites, all transferable.
 */
export function buildWorld(seed, report) {
  seed = (seed >>> 0) || DEFAULT_SEED;
  const say = report || (() => {});
  const r = rng(seed);
  const nCoast = createNoise2D(r), nRock = createNoise2D(r), nWarp = createNoise2D(r), nIce = createNoise2D(r);
  const nSea = createNoise2D(r), nMisc = createNoise2D(r);
  const W = { seed, n: N, cell: CELL, size: SIZE };

  /* The coast: east-west, the sea to the north, with bays and capes. */
  const coastZ = (x) => -2350 + 430 * fbm(nCoast, x / 2900, 0.37, 3) + 150 * fbm(nCoast, x / 700, 7.3, 2);
  // sampled once a cell, so everyone after asks the same line
  const coast = new Float32Array(N);
  for (let i = 0; i < N; i++) coast[i] = coastZ(i * CELL - HALF);
  W.coast = coast;

  /* The route the station's people flagged, west to east along the coast:
     the base, five camps, and the last station on a cape at the far end. */
  const sx = -3050, ex = 3060;
  const route = [];
  route.push({ x: sx, z: coastZ(sx) + 270, kind: "base" });
  for (let i = 1; i <= 5; i++) {
    const x = sx + (ex - sx) * (i / 6) + (r() - 0.5) * 260;
    route.push({ x, z: coastZ(x) + 380 + r() * 620, kind: "camp" });
  }
  route.push({ x: ex, z: coastZ(ex) + 190, kind: "station" });
  // the glacier runs down to the sea between the third and fourth camps
  const gx0 = lerp(route[3].x, route[4].x, 0.45 + r() * 0.1);
  const glacierX = (z) => gx0 + 260 * Math.sin(z / 1100 + seed) + 120 * nMisc(z / 700, 3.1);
  W.glacierX0 = gx0;
  W.GX = new Float32Array(N);
  for (let j = 0; j < N; j++) W.GX[j] = glacierX(j * CELL - HALF);
  // nunataks: a few stone heads near the route, never on it
  const nunataks = [];
  for (let i = 0; i < 9; i++) {
    const a = route[1 + Math.floor(r() * 5)], b = route[route.indexOf(a) + (r() < 0.5 ? -1 : 1)] || a;
    const t = r(), side = r() < 0.5 ? -1 : 1;
    const x = lerp(a.x, b.x, t) + (r() - 0.5) * 300, z = lerp(a.z, b.z, t) + side * (220 + r() * 420);
    nunataks.push({ x, z, r: 120 + r() * 200, h: 40 + r() * 120 });
  }
  W.nunataks = nunataks;

  /* --- rock, eroded --- */
  say("rock", 0);
  const rock = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    const z = j * CELL - HALF;
    for (let i = 0; i < N; i++) {
      const x = i * CELL - HALF, d = z - coast[i];
      // domain warp: the ridges wander instead of lining up with the noise grid
      const qx = fbm(nWarp, x / 2200, z / 2200, 3), qz = fbm(nWarp, x / 2200 + 5.2, z / 2200 + 1.3, 3);
      const wx = x / 1500 + 1.6 * qx, wz = z / 1500 + 1.6 * qz;
      const range = smooth(1300, 2900, d) * (0.65 + 0.35 * fbm(nRock, x / 4000, z / 4000 + 9, 2));
      // massifs first, then ridges on them: peaks gather into ranges
      // instead of every ridge standing the same height
      const massif = smooth(-0.35, 0.55, fbm(nRock, x / 3400 + 2.7, z / 3400 - 1.9, 3));
      let h = (0.3 * massif + 0.7 * massif * ridged(nRock, wx, wz, 6)) * 1500 * range;
      let nun = 0;
      // (they rise from the bed under the ice, so they start 80 m down)
      for (const q of nunataks) { const dd = Math.hypot(x - q.x, z - q.z); if (dd < q.r * 2.2) nun = Math.max(nun, (q.h + 85) * Math.exp(-((dd / q.r) ** 2))); }
      h += nun * (0.6 + 0.55 * ridged(nRock, x / 260 + 3, z / 260, 4));
      // capes: rock under the coast here and there
      const cape = smooth(0.25, 0.7, fbm(nRock, x / 1300 + 11, z / 1300, 3)) * smooth(-120, 0, d) * (1 - smooth(200, 600, d));
      h += cape * 45 * (0.6 + 0.8 * ridged(nRock, x / 300, z / 300 + 4, 3));
      // under it all: the bed the ice sheet rests on
      h += -90 + 0.05 * Math.max(0, d) + (d < 0 ? d * 0.04 : 0);
      // the glacier's valley
      const g = Math.exp(-(((x - glacierX(z)) / 430) ** 2)) * smooth(-900, 200, d);
      h -= g * 520;
      rock[j * N + i] = h;
    }
    if ((j & 31) === 0) say("rock", j / N);
  }
  say("erosion", 0);
  erodeHydraulic(rock, N, 140000, r, (f) => say("erosion", f));
  erodeThermal(rock, N, 6, 0.75);

  /* --- ice, sea and the masks --- */
  say("ice", 0);
  const H = new Float32Array(N * N);      // the surface, metres
  const ROCK = new Float32Array(N * N);   // 0 snow .. 1 bare stone
  const GL = new Float32Array(N * N);     // crevasse country (the glacier's pull)
  const SEA = new Uint8Array(N * N);      // 0 land, 1 fast sea ice, 2 open water
  for (let j = 0; j < N; j++) {
    const z = j * CELL - HALF;
    for (let i = 0; i < N; i++) {
      const x = i * CELL - HALF, d = z - coast[i], k = j * N + i;
      const g = Math.exp(-(((x - glacierX(z)) / 430) ** 2));
      if (d > 0) {
        // the sheet: an ice foot at the shore, then a long rise to the plateau
        let ice = 6 * (1 - Math.exp(-d / 50)) + 34 * (1 - Math.exp(-d / 520)) + 0.058 * Math.max(0, d - 400);
        ice += 26 * fbm(nIce, x / 1900, z / 1900, 3) * smooth(0, 900, d) + 5 * fbm(nIce, x / 420 + 3, z / 420, 2) * smooth(0, 200, d);
        ice -= g * 14 * smooth(0, 600, d);
        const rk = rock[k];
        // where the stone stands above the ice it shows; a soft max keeps the join smooth
        const s = 14, hmax = rk > ice ? rk + s * Math.log1p(Math.exp((ice - rk) / s)) : ice + s * Math.log1p(Math.exp((rk - ice) / s));
        H[k] = hmax;
        // how far the stone stands proud of the ice; whether it is bare is
        // decided below, by how steep it is
        ROCK[k] = smooth(-2, 14, rk - ice);
        // the ice is pulled hardest at the glacier's edges and where it
        // steepens toward the sea: that is where it cracks
        const margin = 1 - Math.abs(g - 0.45) * 2.2;
        GL[k] = clamp(Math.max(margin, g * smooth(-0.1, 0.45, fbm(nMisc, x / 500, z / 500, 2))), 0, 1) * smooth(0.12, 0.3, g) * smooth(60, 400, d) * (1 - smooth(1700, 2500, d));
      } else {
        // the glacier's tongue runs out over the sea
        const tongue = g > 0.45 && d > -700 - 250 * nMisc(x / 600, 1.7) ? 1 : 0;
        // fast ice from the shore, broken by leads, open water past its edge
        const edge = -1150 - 380 * fbm(nSea, x / 1600, 2.2, 3);
        const lead = Math.abs(fbm(nSea, x / 700 + 4, z / 700, 3)) < 0.022 + 0.01 * nMisc(x / 300, z / 300);
        if (rock[k] > 1.5) { H[k] = rock[k]; ROCK[k] = 1; SEA[k] = 0; }
        else if (tongue) { H[k] = 14 + 6 * g + 3 * fbm(nIce, x / 200, z / 200, 2); SEA[k] = 0; GL[k] = g; }
        else if (d > edge && !lead) { H[k] = SEA_ICE_Y; SEA[k] = 1; }
        else { H[k] = -18 + Math.max(d, -400) * 0.06; SEA[k] = 2; }
      }
    }
    if ((j & 31) === 0) say("ice", j / N);
  }

  // Snow lies on anything gentler than about 35 degrees, mountain or not:
  // the stone that shows is the stone too steep to hold it — cliffs, the
  // faces of the nunataks, the gully walls the erosion cut — with the
  // wind-scoured crests bare a little sooner than the hollows.
  for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
    const k = j * N + i;
    if (!ROCK[k]) continue;
    const sl = Math.hypot(H[k + 1] - H[k - 1], H[k + N] - H[k - N]) / (2 * CELL);
    const crest = H[k] - (H[k + 1] + H[k - 1] + H[k + N] + H[k - N]) / 4;
    const bare = smooth(0.42, 0.9, sl + 0.25 * fbm(nMisc, i / 9, j / 9, 2) + clamp(crest / 12, -0.2, 0.3));
    ROCK[k] *= bare;
  }

  W.H = H; W.ROCK = ROCK; W.GL = GL; W.SEA = SEA;
  W.KEEP = new Float32Array(N * N);   // 1 on the flagged route and the sites' pads: quiet, walkable
  W.route = route;
  W.wind = (() => { const a = -Math.PI / 2 + 0.5 + (r() - 0.5) * 0.6; return { x: Math.cos(a), z: Math.sin(a), a }; })();
  // the katabatic wind comes down off the plateau toward the sea: from the
  // south-south-west, so sastrugi run that way
  W.noise = { nIce, nMisc, nSea, nRock };

  say("route", 0);
  placeSites(W, r);
  keepRoute(W);
  bergs(W, r);
  say("done", 1);
  return W;
}

/* Find somewhere flat, near (x,z), on snow, for something to stand. */
function flatSpot(W, x, z, reach, r) {
  let best = null, bestS = Infinity;
  for (let t = 0; t < 140; t++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * reach;
    const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
    const m = macroAt(W, px, pz);
    if (m.sea || m.rock > 0.15 || m.gl > 0.15) continue;
    const s = slopeMacro(W, px, pz) * 6 + d / reach;
    if (s < bestS) { bestS = s; best = { x: px, z: pz }; }
  }
  return best || { x, z };
}
function highSpot(W, x, z, r0, r1, r) {
  let best = null, bestH = -Infinity;
  for (let t = 0; t < 160; t++) {
    const a = r() * Math.PI * 2, d = r0 + r() * (r1 - r0);
    const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
    const m = macroAt(W, px, pz);
    if (m.sea || m.rock > 0.35 || m.gl > 0.1) continue;
    if (slopeMacro(W, px, pz) > 0.32) continue;
    const h = m.h - d * 0.03;
    if (h > bestH) { bestH = h; best = { x: px, z: pz }; }
  }
  return best || { x: x + r0, z };
}

/* The sites: where the people were, and where the beacons wait. */
function placeSites(W, r) {
  const sites = [], beacons = [], pois = [];
  W.route.forEach((p, i) => {
    const at = flatSpot(W, p.x, p.z, p.kind === "camp" ? 220 : 120, r);
    p.x = at.x; p.z = at.z;
    const pad = p.kind === "station" ? 70 : p.kind === "base" ? 60 : 34;
    sites.push({ id: i, kind: p.kind, x: p.x, z: p.z, pad, y: 0, rot: Math.atan2(W.wind.x, W.wind.z) + (r() - 0.5) * 0.5 });
  });
  // every site but the station has its beacon on the nearest rise; the
  // station's beacon is its own tower
  for (const s of sites) {
    if (s.kind === "station") { beacons.push({ id: beacons.length, site: s.id, x: s.x + 18, z: s.z - 22, big: true }); continue; }
    const b = highSpot(W, s.x, s.z, s.kind === "base" ? 110 : 120, 260, r);
    beacons.push({ id: beacons.length, site: s.id, x: b.x, z: b.z, big: false });
  }
  // and three more, on hills between camps, for anyone who wants to climb
  for (let k = 0; k < 3; k++) {
    const i = 1 + Math.floor(r() * 4), a = sites[i], b = sites[i + 1];
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    const h = highSpot(W, mx, mz, 160, 420, r);
    if (beacons.some((q) => Math.hypot(q.x - h.x, q.z - h.z) < 250)) continue;
    beacons.push({ id: beacons.length, site: -1, x: h.x, z: h.z, big: false });
  }
  W.sites = sites; W.beacons = beacons; W.pois = pois;
}

/* The flagged route: a corridor kept walkable — no crevasse across it, no
   stone, no slope steeper than a sledge can be hauled up — and the pads
   the huts stand on, levelled. Done on the macro grid, so the fine detail
   is quiet there too (detail() reads KEEP). */
function keepRoute(W) {
  const { H, ROCK, GL, KEEP, n } = W;
  const S = W.sites;
  // a smooth line between the sites, a point every 20 m
  const line = [];
  for (let i = 0; i < S.length - 1; i++) {
    const a = S[i], b = S[i + 1], len = Math.hypot(b.x - a.x, b.z - a.z), steps = Math.ceil(len / 20);
    // a gentle bow, so the route is not a ruler line
    const nx = -(b.z - a.z) / len, nz = (b.x - a.x) / len, bow = (W.seed % 7 - 3) * 18 + (i % 2 ? 60 : -60);
    for (let k = 0; k < steps; k++) {
      const t = k / steps, s = Math.sin(t * Math.PI) * bow;
      line.push({ x: lerp(a.x, b.x, t) + nx * s, z: lerp(a.z, b.z, t) + nz * s, seg: i });
    }
  }
  line.push({ x: S[S.length - 1].x, z: S[S.length - 1].z, seg: S.length - 2 });
  // its height: the ground along it, smoothed over 200 m so it never climbs a wall
  const raw = line.map((p) => macroAt(W, p.x, p.z).h);
  const hl = raw.map((_, i) => { let s = 0, c = 0; for (let k = -10; k <= 10; k++) { const v = raw[i + k]; if (v !== undefined) { s += v; c++; } } return s / c; });
  line.forEach((p, i) => { p.y = Math.max(hl[i], 1.5); });
  W.line = line;
  // every macro cell near it: pulled toward the smoothed line
  const near = new Float32Array(n * n).fill(1e9), toward = new Float32Array(n * n);
  for (const p of line) {
    const i0 = Math.floor((p.x + HALF) / CELL), j0 = Math.floor((p.z + HALF) / CELL), R = 6;
    for (let j = j0 - R; j <= j0 + R; j++) for (let i = i0 - R; i <= i0 + R; i++) {
      if (i < 0 || j < 0 || i >= n || j >= n) continue;
      const x = i * CELL - HALF, z = j * CELL - HALF, d = Math.hypot(x - p.x, z - p.z), k = j * n + i;
      if (d < near[k]) { near[k] = d; toward[k] = p.y; }
    }
  }
  for (let k = 0; k < n * n; k++) {
    if (near[k] > 1e8) continue;
    const w = 1 - smooth(ROUTE_W, ROUTE_W + 70, near[k]);
    if (w <= 0) continue;
    H[k] = lerp(H[k], toward[k], w * 0.9);
    ROCK[k] *= 1 - w; GL[k] *= 1 - w;
    if (W.SEA[k]) { W.SEA[k] = 0; H[k] = Math.max(H[k], toward[k]); }
    KEEP[k] = Math.max(KEEP[k], w);
  }
  // the pads
  for (const s of S) {
    const h = Math.max(1.5, macroAt(W, s.x, s.z).h);
    s.y = h;
    const i0 = Math.floor((s.x + HALF) / CELL), j0 = Math.floor((s.z + HALF) / CELL), R = Math.ceil((s.pad + 60) / CELL);
    for (let j = j0 - R; j <= j0 + R; j++) for (let i = i0 - R; i <= i0 + R; i++) {
      if (i < 0 || j < 0 || i >= n || j >= n) continue;
      const x = i * CELL - HALF, z = j * CELL - HALF, d = Math.hypot(x - s.x, z - s.z), k = j * n + i;
      const w = 1 - smooth(s.pad, s.pad + 55, d);
      if (w <= 0) continue;
      H[k] = lerp(H[k], h, w); ROCK[k] *= 1 - w; GL[k] *= 1 - w;
      if (W.SEA[k]) W.SEA[k] = 0;
      KEEP[k] = Math.max(KEEP[k], w);
    }
  }
  // the beacons' hilltops: levelled a little, and clear
  for (const b of W.beacons) {
    const h = macroAt(W, b.x, b.z).h;
    const i0 = Math.floor((b.x + HALF) / CELL), j0 = Math.floor((b.z + HALF) / CELL);
    for (let j = j0 - 3; j <= j0 + 3; j++) for (let i = i0 - 3; i <= i0 + 3; i++) {
      if (i < 0 || j < 0 || i >= n || j >= n) continue;
      const x = i * CELL - HALF, z = j * CELL - HALF, d = Math.hypot(x - b.x, z - b.z), k = j * n + i;
      const w = 1 - smooth(10, 40, d);
      H[k] = lerp(H[k], h, w * 0.8); GL[k] *= 1 - w; ROCK[k] *= 1 - w * 0.7;
      KEEP[k] = Math.max(KEEP[k], w * 0.7);
    }
    b.y = macroAt(W, b.x, b.z).h;
  }
}

/* Tabular bergs, calved from the shelf and frozen into the sea. Analytic,
   so their cliffs stay sharp at any distance (bergAt, below). */
function bergs(W, r) {
  const out = [];
  for (let t = 0; t < 60 && out.length < 14; t++) {
    const x = -HALF + 300 + r() * (SIZE - 600);
    const cz = W.coast[Math.round((x + HALF) / CELL)];
    const z = cz - 500 - r() * 1500;
    if (z < -HALF + 300) continue;
    if (out.some((b) => Math.hypot(b.x - x, b.z - z) < 500)) continue;
    if (W.line.some((p) => Math.hypot(p.x - x, p.z - z) < 260)) continue;
    out.push({ x, z, a: 60 + r() * 140, b: 40 + r() * 90, rot: r() * Math.PI, h: 18 + r() * 26 });
  }
  W.bergs = out;
}

/* ------------------------------------------------------------------ */
/* Sampling                                                           */

/* The macro grid, bilinear. */
export function macroAt(W, x, z) {
  const n = W.n, fx = clamp((x + HALF) / CELL, 0, n - 1.001), fz = clamp((z + HALF) / CELL, 0, n - 1.001);
  const i = fx | 0, j = fz | 0, u = fx - i, v = fz - j, k = j * n + i;
  const bl = (A) => A[k] * (1 - u) * (1 - v) + A[k + 1] * u * (1 - v) + A[k + n] * (1 - u) * v + A[k + n + 1] * u * v;
  const s = W.SEA[k] | W.SEA[k + 1] | W.SEA[k + n] | W.SEA[k + n + 1];
  return { h: bl(W.H), rock: bl(W.ROCK), gl: bl(W.GL), keep: bl(W.KEEP), sea: s ? 1 : 0 };
}
function slopeMacro(W, x, z) {
  const a = macroAt(W, x - CELL, z).h, b = macroAt(W, x + CELL, z).h, c = macroAt(W, x, z - CELL).h, d = macroAt(W, x, z + CELL).h;
  return Math.hypot(b - a, d - c) / (2 * CELL);
}

/* Catmull-Rom across the 16 m grid: bilinear would leave a crease every
   cell, and on snow at a low sun every crease is a line. */
function cubic(p0, p1, p2, p3, t) {
  return p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
}
function bicubic(A, n, fx, fz) {
  const i = fx | 0, j = fz | 0, u = fx - i, v = fz - j;
  const row = (jj) => {
    const r = clamp(jj, 0, n - 1) * n;
    return cubic(A[r + clamp(i - 1, 0, n - 1)], A[r + i], A[r + clamp(i + 1, 0, n - 1)], A[r + clamp(i + 2, 0, n - 1)], u);
  };
  return cubic(row(j - 1), row(j), row(j + 1), row(j + 2), v);
}

const hash2 = (x, z) => { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); };

/* Crevasses. The glacier flows north to the sea, and where it is pulled
   apart it cracks across the flow: sets of near-parallel cracks, bent by
   the ice's own unevenness, opening and closing along their length; near
   its edges, where the sides drag, they turn to chevrons pointing upstream.
   Returns 0 (none) .. 1 (an open crack). */
export function crevasse(W, x, z, gl) {
  if (gl < 0.12) return 0;
  const { nMisc, nIce } = W.noise;
  const j = clamp(Math.round((z + HALF) / CELL), 0, W.n - 1), xc = W.GX ? W.GX[j] : 0;
  const off = x - xc, side = off < 0 ? -1 : 1;
  const edge = smooth(150, 380, Math.abs(off));
  const warp = 16 * nMisc(x / 150, z / 150) + 5 * nMisc(x / 45 + 9, z / 45);
  const spacing = 13 + 5 * nIce(x / 520 + 2, z / 520);
  const ph = (z + warp + side * 0.9 * off * edge) / spacing;
  const line = Math.round(ph), f = Math.abs(ph - line) * spacing;
  const width = 0.6 + 1.7 * gl;
  // each crack is a segment: it runs a while, pinches shut, opens again
  const open = smooth(-0.15, 0.35, nMisc(x / 38 + line * 3.71, line * 1.37 + z / 400));
  return smooth(width, width * 0.25, f) * open * smooth(0.12, 0.45, gl);
}

/* An iceberg's top, or -Infinity where there is none. */
function bergAt(W, x, z) {
  let best = -Infinity;
  for (const b of W.bergs) {
    const dx = x - b.x, dz = z - b.z;
    if (Math.abs(dx) > b.a + 30 || Math.abs(dz) > b.a + 30) continue;
    const c = Math.cos(b.rot), s = Math.sin(b.rot), u = (dx * c - dz * s) / b.a, v = (dx * s + dz * c) / b.b;
    // a rounded slab: a superellipse, with a crumbling rim
    const e = Math.pow(Math.abs(u) ** 4 + Math.abs(v) ** 4, 0.25) + 0.06 * W.noise.nMisc(x / 18, z / 18);
    if (e > 1.06) continue;
    const top = b.h + 1.5 * W.noise.nIce(x / 60, z / 60) - 8 * smooth(0.9, 1.06, e) - 40 * smooth(0.985, 1.06, e);
    if (top > best) best = top;
  }
  return best;
}

/**
 * The ground at (x,z): height, and what it is made of. The one function
 * the mesh, the feet and the validator all share. `out` is reused.
 */
export function surface(W, x, z, out) {
  out = out || {};
  const n = W.n, fx = clamp((x + HALF) / CELL, 0, n - 1.001), fz = clamp((z + HALF) / CELL, 0, n - 1.001);
  const i = fx | 0, j = fz | 0, u = fx - i, v = fz - j, k = j * n + i;
  const bl = (A) => A[k] * (1 - u) * (1 - v) + A[k + 1] * u * (1 - v) + A[k + n] * (1 - u) * v + A[k + n + 1] * u * v;
  let h = bicubic(W.H, n, fx, fz);
  const rock = bl(W.ROCK), gl = bl(W.GL), keep = bl(W.KEEP);
  const s00 = W.SEA[k], s10 = W.SEA[k + 1], s01 = W.SEA[k + n], s11 = W.SEA[k + n + 1];
  const sea = (s00 === 2 ? 1 - u : 0) * (1 - v) + (s10 === 2 ? u : 0) * (1 - v) + (s01 === 2 ? 1 - u : 0) * v + (s11 === 2 ? u : 0) * v; // open water, 0..1
  const ice = (s00 === 1 ? (1 - u) * (1 - v) : 0) + (s10 === 1 ? u * (1 - v) : 0) + (s01 === 1 ? (1 - u) * v : 0) + (s11 === 1 ? u * v : 0);
  const { nIce, nMisc, nRock } = W.noise;
  const quiet = 1 - keep * 0.85;
  let cr = 0, sas = 0;
  if (ice > 0.5 || sea > 0.5) {
    // the sea: flat fast ice, ridges where floes were pushed together, and
    // the black water of the leads beside it
    if (sea > 0.5) h = Math.min(h, -1.2);
    else {
      const ridge = Math.max(0, 1 - Math.abs(nIce(x / 90, z / 90)) * 9);
      h = SEA_ICE_Y + ridge * ridge * (0.8 + 0.8 * nMisc(x / 7, z / 7)) + 0.05 * nMisc(x / 3, z / 3);
    }
  } else {
    // snow: long swells, then the wind's own grain
    const snow = 1 - rock;
    h += (1.4 * nIce(x / 95, z / 95) + 0.5 * nIce(x / 33 + 7, z / 33) + 0.16 * nMisc(x / 11, z / 11)) * snow * quiet;
    // sastrugi: sharp-crested ridges lying along the wind, in patches
    const wx = W.wind.x, wz = W.wind.z;
    const along = x * wx + z * wz, across = -x * wz + z * wx;
    const patch = smooth(-0.2, 0.5, nMisc(x / 260 + 40, z / 260));
    const sr = 1 - Math.abs(nIce(along / 16, across / 2.4));
    sas = sr * sr * sr * patch * snow;
    h += sas * 0.32 * quiet;
    // stone: broken faces and loose blocks
    if (rock > 0.02) h += rock * (3.2 * (Math.abs(nRock(x / 40, z / 40)) - 0.3) + 1.1 * nRock(x / 13 + 5, z / 13) + 0.35 * nMisc(x / 4, z / 4));
    // the glacier's cracks
    cr = crevasse(W, x, z, gl * quiet);
    // a crack's walls go down further than anyone could see; the mesh takes
    // them a few metres, the colour does the rest (terrain.js)
    if (cr > 0) h -= cr * 4;
  }
  const berg = W.bergs.length ? bergAt(W, x, z) : -Infinity;
  let isBerg = 0;
  if (berg > h) { h = berg; isBerg = 1; }
  out.h = h; out.rock = isBerg ? 0 : rock; out.gl = gl; out.keep = keep; out.crevasse = cr;
  out.seaIce = isBerg ? 0 : ice; out.water = isBerg ? 0 : sea; out.sastrugi = sas; out.berg = isBerg;
  return out;
}

const _s = {};
export const heightAt = (W, x, z) => surface(W, x, z, _s).h;

/** Normal by central differences, `e` metres apart. */
export function normalAt(W, x, z, e, out) {
  e = e || 0.5;
  const a = heightAt(W, x - e, z), b = heightAt(W, x + e, z), c = heightAt(W, x, z - e), d = heightAt(W, x, z + e);
  out = out || {};
  let nx = a - b, ny = 2 * e, nz = c - d;
  const l = Math.hypot(nx, ny, nz);
  out.x = nx / l; out.y = ny / l; out.z = nz / l;
  return out;
}

/** The fields the worker needs, as transferables. */
export function pack(W) {
  return {
    seed: W.seed, n: W.n, H: W.H, ROCK: W.ROCK, GL: W.GL, SEA: W.SEA, KEEP: W.KEEP, coast: W.coast,
    GX: W.GX, route: W.route, sites: W.sites, beacons: W.beacons, pois: W.pois, line: W.line, bergs: W.bergs, wind: W.wind, nunataks: W.nunataks, glacierX0: W.glacierX0
  };
}
/** Rebuild a world from pack() on the other side: the noise is seeded again, the arrays are as sent. */
export function unpack(P) {
  const r = rng(P.seed);
  // the noise functions are made in the same order as buildWorld makes them
  createNoise2D(r); const nRock = createNoise2D(r); createNoise2D(r); const nIce = createNoise2D(r);
  const nSea = createNoise2D(r), nMisc = createNoise2D(r);
  return Object.assign({ cell: CELL, size: SIZE }, P, { noise: { nIce, nMisc, nSea, nRock } });
}
