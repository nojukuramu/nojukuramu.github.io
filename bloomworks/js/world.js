/* world.js — the endless grid of plots.
 *
 * One world seed makes the whole map, so a plot is never stored: it is grown
 * from the seed and its coordinates the first time anything looks at it, and
 * cached. What the player changed — Rocks cleared, Ruins dug, Rocks regrown
 * under Wild Growth — is kept in S.world and laid over the grown plot. The
 * map stays the same for every Season and Eclipse in a world; Genesis makes
 * a new world with a new seed. */

import { S, RT, pk } from "./state.js";
import { hash, hash01, rng, fbm } from "./rng.js";
import { BIOMES, ANOMALY_RULES, PLOT, PLOT_BASE, PLOT_RING, PLOT_SAME, R, Bl, Y } from "./data.js";

export const T = { soil: 0, rock: 1, river: 2, lake: 3, ley: 4, node: 5, vent: 6, ice: 7, crystal: 8, cliff: 9, gap: 10, void: 11, ruins: 12, star: 13 };
export const TILE_NAMES = Object.keys(T);

export const hasLaw = (id) => !!(S.meta && S.meta.laws.includes(id));
export const plotSize = () => (hasLaw("tinyplots") ? 6 : PLOT);
export const ringOf = (px, py) => Math.max(Math.abs(px), Math.abs(py));
export const plotOfTile = (x, y) => { const P = plotSize(); return [Math.floor(x / P), Math.floor(y / P)]; };

function chooseBiome(seed, px, py, r) {
  if (r <= 1) return "meadow";
  const h = hash01(seed, px, py, 31);
  if (r >= 16 && h < 0.4) return "anomaly";
  if (r >= 12 && h < 0.3) return "fringe";
  const c = Object.keys(BIOMES).filter((k) => k !== "anomaly" && k !== "fringe" && BIOMES[k].rings[0] <= r && r <= BIOMES[k].rings[1]);
  // Region noise keeps neighbouring plots in the same biome more often than not.
  const n = (fbm(seed + 77, px * 0.32, py * 0.32, 3) + 1) / 2;
  // The newest biome of this ring gets a little extra room, so it is met.
  const newest = c.filter((k) => BIOMES[k].rings[0] === r);
  if (newest.length && h > 0.75) return newest[Math.floor(hash01(seed, px, py, 32) * newest.length)];
  return c[Math.min(c.length - 1, Math.floor(n * c.length))];
}

function line(tiles, P, r, code, len, avoid) {
  const horiz = r() < 0.5;
  const fixed = 1 + Math.floor(r() * (P - 2));
  const start = Math.floor(r() * Math.max(1, P - len));
  for (let i = start; i < Math.min(P, start + len); i++) {
    const x = horiz ? i : fixed, y = horiz ? fixed : i;
    if (!avoid || tiles[y * P + x] === T.soil) tiles[y * P + x] = code;
  }
}
function blob(tiles, P, r, code, rad) {
  const cx = 1 + Math.floor(r() * (P - 2)), cy = 1 + Math.floor(r() * (P - 2));
  for (let y = 0; y < P; y++) for (let x = 0; x < P; x++)
    if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= rad * rad + r() * 1.5) tiles[y * P + x] = code;
}
function scatter(tiles, P, r, code, n) {
  for (let i = 0; i < n; i++) {
    const j = Math.floor(r() * P * P);
    if (tiles[j] === T.soil) tiles[j] = code;
  }
}
function river(tiles, flow, P, r) {
  // Edge to edge, wandering by one tile at a time; every tile knows which
  // way the water goes.
  const horiz = r() < 0.5, rev = r() < 0.5;
  let c = 2 + Math.floor(r() * (P - 4));
  for (let i = 0; i < P; i++) {
    const a = rev ? P - 1 - i : i;
    const x = horiz ? a : c, y = horiz ? c : a;
    const dir = horiz ? (rev ? 2 : 0) : (rev ? 3 : 1);
    tiles[y * P + x] = T.river; flow[y * P + x] = dir;
    if (i < P - 1 && r() < 0.3) {
      const nc = Math.max(1, Math.min(P - 2, c + (r() < 0.5 ? -1 : 1)));
      if (nc !== c) {
        // a sidestep: the bend tile flows sideways into the new line
        const sd = horiz ? (nc > c ? 1 : 3) : (nc > c ? 0 : 2);
        flow[y * P + x] = sd;
        const x2 = horiz ? a : nc, y2 = horiz ? nc : a;
        tiles[y2 * P + x2] = T.river; flow[y2 * P + x2] = dir;
        c = nc;
      }
    }
  }
}

/** A plot, grown from the seed. Pure: the same arguments, the same plot. */
export function genPlot(seed, px, py, P) {
  const r = rng(hash(seed, px, py, 7));
  const ring = ringOf(px, py);
  const biome = chooseBiome(seed, px, py, ring);
  const tiles = new Uint8Array(P * P), flow = new Int8Array(P * P).fill(-1);
  const home = px === 0 && py === 0;
  const B = BIOMES[biome];
  const sc = P / PLOT;
  if (home) {
    scatter(tiles, P, r, T.rock, 3);
    line(tiles, P, r, T.ley, 3, true);
  } else {
    if (biome === "meadow") { if (r() < 0.45) river(tiles, flow, P, r); if (r() < 0.6) line(tiles, P, r, T.ley, 4 + Math.floor(r() * 4), true); }
    if (biome === "ember") scatter(tiles, P, r, T.vent, Math.round((3 + r() * 3) * sc));
    if (biome === "tide") { if (r() < 0.75) river(tiles, flow, P, r); blob(tiles, P, r, T.lake, 1 + Math.floor(r() * 2 * sc)); }
    if (biome === "dune") for (let i = 0; i < 3; i++) blob(tiles, P, r, T.rock, 1);
    if (biome === "frost") { blob(tiles, P, r, T.ice, 2 * sc); blob(tiles, P, r, T.ice, 1); }
    if (biome === "highland") line(tiles, P, r, T.cliff, P, false);
    if (biome === "crystal") scatter(tiles, P, r, T.crystal, Math.round((4 + r() * 5) * sc));
    if (biome === "sky") line(tiles, P, r, T.gap, P, false);
    if (biome === "fringe") scatter(tiles, P, r, T.void, Math.round(P * P * 0.3));
    if (biome === "anomaly") {
      const kinds = [T.vent, T.ice, T.crystal, T.void, T.ley, T.lake];
      for (let i = 0; i < 4; i++) scatter(tiles, P, r, kinds[Math.floor(r() * kinds.length)], Math.round(4 * sc));
    }
    scatter(tiles, P, r, T.rock, Math.round(P * P * 0.05));
  }
  if (hasLaw("archipelago") && !home) {
    for (let i = 0; i < P; i++) { tiles[i] = T.lake; tiles[(P - 1) * P + i] = T.lake; tiles[i * P] = T.lake; tiles[i * P + P - 1] = T.lake; }
  }
  // Nodes: none at home; Rings 1-2 average one; farther out up to three.
  const nodes = [];
  if (!home) {
    let n = ring <= 2 ? (r() < 0.75 ? 1 : r() < 0.5 ? 0 : 2) : Math.floor(r() * 3.2) + (ring > 6 ? 1 : 0);
    n = Math.min(3, n);
    for (let tries = 0; nodes.length < n && tries < 40; tries++) {
      const x = 1 + Math.floor(r() * (P - 2)), y = 1 + Math.floor(r() * (P - 2));
      if (tiles[y * P + x] !== T.soil) continue;
      let hue = B.hues[Math.floor(r() * B.hues.length)];
      if (biome === "sky" && r() > 0.2) hue = [R, Bl, Y][Math.floor(r() * 3)];
      tiles[y * P + x] = T.node;
      nodes.push({ x, y, hue, tier: 1 + Math.floor(ring / 3), rich: Math.pow(1.6, ring) });
    }
  }
  // Ruins: about one plot in six.
  let ruins = null;
  if (!home && hash01(seed, px, py, 11) < 1 / 6 && P >= 6) {
    const rx = 1 + Math.floor(r() * (P - 4)), ry = 1 + Math.floor(r() * (P - 4));
    for (let y = ry; y < ry + 3; y++) for (let x = rx; x < rx + 3; x++) tiles[y * P + x] = T.ruins;
    ruins = { x: rx, y: ry };
    for (const nd of nodes.slice()) if (nd.x >= rx && nd.x < rx + 3 && nd.y >= ry && nd.y < ry + 3) nodes.splice(nodes.indexOf(nd), 1);
  }
  // Anomaly plots: two rules, and one more every 8 Rings.
  const rules = [];
  if (biome === "anomaly") {
    const want = 2 + Math.floor((ring - 16) / 8);
    for (let tries = 0; rules.length < want && tries < 50; tries++) {
      const pick = ANOMALY_RULES[Math.floor(r() * ANOMALY_RULES.length)].id;
      if (!rules.includes(pick)) rules.push(pick);
    }
  }
  let hasRiver = false;
  for (let i = 0; i < tiles.length; i++) if (tiles[i] === T.river) { hasRiver = true; break; }
  return { px, py, key: pk(px, py), ring, biome, tiles, flow, nodes, ruins, rules, P, hasRiver };
}

export function getPlot(px, py) {
  const key = pk(px, py);
  let p = RT.plotCache.get(key);
  if (!p) { p = genPlot(S.world.seed, px, py, plotSize()); RT.plotCache.set(key, p); }
  return p;
}
export const plotAt = (x, y) => { const [px, py] = plotOfTile(x, y); return getPlot(px, py); };

/** The tile at a world position, with everything the player changed laid over it. */
export function tileAt(x, y) {
  const P = plotSize();
  const px = Math.floor(x / P), py = Math.floor(y / P);
  const p = getPlot(px, py);
  const li = (y - py * P) * P + (x - px * P);
  let t = p.tiles[li];
  const w = S.world;
  if (t === T.rock && w.cleared && w.cleared[p.key] && w.cleared[p.key].includes(li)) t = T.soil;
  if (t === T.ruins && w.dug && w.dug[p.key]) t = T.soil;
  if (t === T.soil && w.regrown && w.regrown[p.key] && w.regrown[p.key].includes(li)) t = T.rock;
  if ((t === T.soil || t === T.ley) && S.meteors.length) for (const m of S.meteors) if (m.x === x && m.y === y && m.until > S.t) return T.star;
  return t;
}
export const localIndex = (x, y) => { const P = plotSize(); const px = Math.floor(x / P), py = Math.floor(y / P); return (y - py * P) * P + (x - px * P); };
export function riverFlow(x, y) { const p = plotAt(x, y); return p.flow[localIndex(x, y)]; }
export function nodeAt(x, y) {
  const p = plotAt(x, y), P = p.P;
  const lx = x - p.px * P, ly = y - p.py * P;
  for (const n of p.nodes) if (n.x === lx && n.y === ly) return n;
  for (const m of S.meteors) if (m.x === x && m.y === y && m.until > S.t) return { hue: m.hue, tier: m.tier, rich: m.rich, star: true };
  return null;
}

export const owned = (px, py) => !!S.season.plots[pk(px, py)];
export const ownedTile = (x, y) => { const [px, py] = plotOfTile(x, y); return owned(px, py); };

export function claimable(px, py) {
  if (owned(px, py)) return false;
  return owned(px + 1, py) || owned(px - 1, py) || owned(px, py + 1) || owned(px, py - 1);
}
export function ownedInRing(r) {
  let n = 0;
  for (const k in S.season.plots) { const [a, b] = k.split(",").map(Number); if (ringOf(a, b) === r) n++; }
  return n;
}
export function plotsOwned() { return Object.keys(S.season.plots).length; }
export function ownedPlots() { return Object.keys(S.season.plots).map((k) => { const [a, b] = k.split(",").map(Number); return getPlot(a, b); }); }

/** PlotCost = 900 × 8^(r-1) × 1.25^m, times the discounts, as an L-number. */
export function plotCostL(px, py, discountL) {
  const r = ringOf(px, py);
  return Math.log10(PLOT_BASE) + (r - 1) * Math.log10(PLOT_RING) + ownedInRing(r) * Math.log10(PLOT_SAME) + (discountL || 0);
}

export function neighbours(px, py) { return [[px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]]; }
export function frontier() {
  const out = new Map();
  for (const k in S.season.plots) {
    const [a, b] = k.split(",").map(Number);
    for (const [c, d] of neighbours(a, b)) if (!owned(c, d)) out.set(pk(c, d), [c, d]);
  }
  return [...out.values()];
}
