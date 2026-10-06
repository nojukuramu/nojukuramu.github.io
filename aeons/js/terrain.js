/* terrain.js — the ground, painted a chunk at a time.
 *
 * Tiles are squares in the simulation and should never look like it. Each
 * chunk is painted per pixel from a blend of its tiles: every material (dry
 * land, deep water, rock, sand, dirt, forest floor) is a field interpolated
 * between tile centres and cut against a noise texture, so coasts wander,
 * rock has a bevel the light catches, and grass fades into sand instead of
 * stopping at a grid line. Trees, cliff faces and tufts are drawn on top.
 *
 * Water is left transparent here. Under the chunks the renderer lays an
 * animated water pattern, and the chunk's shallow tint and foam sit over it —
 * which is how a whole ocean moves for the price of two pattern fills.
 *
 * Two resolutions: a cheap one made immediately for anything on screen, and a
 * full one made a few per frame. A chunk that changes (a tree felled) is
 * repainted, never patched. */

import { CHUNK, TILE } from "./data.js";
import { T, isWater } from "./world.js";
import { hash, rng } from "./rng.js";

/* ---------------- noise tables, tileable, made once ---------------- */
const NS = 256;
function table(seed, freq) {
  const r = rng(seed), g = freq, lat = new Float32Array(g * g);
  for (let i = 0; i < lat.length; i++) lat[i] = r() * 2 - 1;
  const out = new Float32Array(NS * NS), cell = NS / g;
  for (let y = 0; y < NS; y++) for (let x = 0; x < NS; x++) {
    const fx = x / cell, fy = y / cell, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = lat[(y0 % g) * g + (x0 % g)], b = lat[(y0 % g) * g + ((x0 + 1) % g)], c = lat[((y0 + 1) % g) * g + (x0 % g)], d = lat[((y0 + 1) % g) * g + ((x0 + 1) % g)];
    out[y * NS + x] = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }
  return out;
}
const N1 = table(11, 16), N2 = table(23, 64), N3 = table(37, 128);
const nAt = (tab, x, y) => tab[((y & 255) << 8) | (x & 255)];

/* ---------------- palettes: [temperate, dry, cold] ---------------- */
const GROUND = [[86, 128, 56], [160, 148, 88], [208, 218, 222]];
const FLOOR = [[48, 82, 38], [118, 110, 62], [150, 170, 172]];
const SAND = [[212, 194, 138], [226, 204, 148], [186, 192, 192]];
const DIRT = [[124, 96, 64], [148, 114, 78], [132, 124, 116]];
const ROCK = [[116, 112, 106], [148, 126, 102], [126, 132, 140]];
const SHALLOW = [70, 170, 168];

export class Terrain {
  constructor(world) {
    this.w = world;
    this.hi = new Map(); this.lo = new Map(); this.queue = [];
    this.queued = new Set();
    this.stamp = 0;
  }
  key(cx, cy) { return cx * 100003 + cy; }
  invalidate(cx, cy) {
    const k = this.key(cx, cy);
    const h = this.hi.get(k); if (h) h.stale = true;
    const l = this.lo.get(k); if (l) l.stale = true;
  }
  /** Best picture of a chunk available now. Asks for a better one if it can. */
  get(cx, cy, wantHi) {
    const k = this.key(cx, cy);
    this.stamp++;
    let lo = this.lo.get(k);
    if (!lo || (lo.stale && !this.busyLo)) {
      lo = { c: this.paint(cx, cy, 8, lo && lo.c), stale: false, used: this.stamp };
      this.lo.set(k, lo);
      if (this.lo.size > 420) this.evict(this.lo, 300);
    }
    lo.used = this.stamp;
    if (wantHi) {
      const hi = this.hi.get(k);
      if (hi) { hi.used = this.stamp; if (hi.stale) this.ask(cx, cy); if (!hi.stale || hi.c) return hi.c; }
      else this.ask(cx, cy);
    }
    return lo.c;
  }
  ask(cx, cy) { const k = this.key(cx, cy); if (!this.queued.has(k)) { this.queued.add(k); this.queue.push([cx, cy]); } }
  /** Paint queued full-resolution chunks for up to `ms` milliseconds. */
  pump(ms) {
    const t0 = performance.now();
    while (this.queue.length && performance.now() - t0 < ms) {
      const [cx, cy] = this.queue.shift(), k = this.key(cx, cy);
      this.queued.delete(k);
      const old = this.hi.get(k);
      this.hi.set(k, { c: this.paint(cx, cy, TILE, old && old.c), stale: false, used: this.stamp });
      if (this.hi.size > 44) this.evict(this.hi, 34);
    }
  }
  evict(map, keep) {
    const arr = [...map.entries()].sort((a, b) => a[1].used - b[1].used);
    for (let i = 0; i < arr.length - keep; i++) map.delete(arr[i][0]);
  }

  /* ---------------- painting ---------------- */
  paint(cx, cy, S, reuse) {
    const W = this.w, P = CHUNK + 2, x0 = cx * CHUNK, y0 = cy * CHUNK;
    // the chunk's tiles and a one-tile border, as material fields
    const land = new Float32Array(P * P), deep = new Float32Array(P * P), rock = new Float32Array(P * P), sand = new Float32Array(P * P), dirt = new Float32Array(P * P), forest = new Float32Array(P * P);
    const bio = new Uint8Array(P * P), tt = new Uint8Array(P * P);
    for (let j = 0; j < P; j++) for (let i = 0; i < P; i++) {
      const tx = x0 + i - 1, ty = y0 + j - 1, k = j * P + i;
      let t = W.inBounds(tx, ty) ? W.terrain(tx, ty) : W.natural(tx, ty);
      tt[k] = t;
      land[k] = isWater(t) ? 0 : 1; deep[k] = t === T.DEEP ? 1 : 0; rock[k] = t === T.ROCK ? 1 : 0;
      sand[k] = t === T.SAND ? 1 : 0; dirt[k] = t === T.DIRT ? 1 : 0; forest[k] = t === T.FOREST ? 1 : 0;
      bio[k] = W.biome(tx, ty);
    }
    const size = CHUNK * S;
    const cv = reuse && reuse.width === size ? reuse : mk(size, size);
    const ctx = cv.getContext("2d");
    const img = ctx.createImageData(size, size), px = img.data;
    const step = TILE / S;
    for (let py = 0; py < size; py++) {
      const wy = y0 * TILE + py * step, fy = wy / TILE - 0.5 - y0 + 1, j0 = Math.floor(fy), v = fy - j0;
      for (let pxx = 0; pxx < size; pxx++) {
        const wx = x0 * TILE + pxx * step, fx = wx / TILE - 0.5 - x0 + 1, i0 = Math.floor(fx), u = fx - i0;
        const a = j0 * P + i0, b = a + 1, c = a + P, d = c + 1;
        const wa = (1 - u) * (1 - v), wb = u * (1 - v), wc = (1 - u) * v, wd = u * v;
        const bl = (f) => f[a] * wa + f[b] * wb + f[c] * wc + f[d] * wd;
        const iwx = wx | 0, iwy = wy | 0;
        const n1 = nAt(N1, iwx, iwy), n2 = nAt(N2, iwx, iwy), n3 = nAt(N3, iwx * 2, iwy * 2);
        const L = bl(land) + n1 * 0.2 + n2 * 0.06;
        const o = (py * size + pxx) * 4;
        // the nearest corner decides the biome; noise blurs the line between them
        const bc = bio[(u + n2 * 0.3 > 0.5 ? (v + n1 * 0.3 > 0.5 ? d : b) : (v + n1 * 0.3 > 0.5 ? c : a))];
        if (L < 0.5) {
          const depth = 0.5 - L, D = bl(deep);
          let al = Math.max(0, 1 - depth * 4.2) * (1 - D * 0.7);
          let r = SHALLOW[0], g = SHALLOW[1], bb = SHALLOW[2];
          if (L > 0.42) { const k = (L - 0.42) / 0.08; r += (SAND[bc][0] - r) * k * 0.6; g += (SAND[bc][1] - g) * k * 0.6; bb += (SAND[bc][2] - bb) * k * 0.6; al = Math.max(al, 0.55 + k * 0.4); }
          // a line of foam where the waves break
          const foam = L > 0.455 && L < 0.485 && n3 > -0.2 ? 0.55 + n3 * 0.3 : 0;
          if (foam) { r += (240 - r) * foam; g += (248 - g) * foam; bb += (246 - bb) * foam; al = Math.max(al, foam); }
          if (bc === 2 && depth < 0.12 && n2 > 0.25) { r = 214; g = 230; bb = 236; al = 0.9; }   // ice at a cold shore
          px[o] = r; px[o + 1] = g; px[o + 2] = bb; px[o + 3] = al * 235;
          continue;
        }
        const G0 = GROUND[bc];
        let r = G0[0], g = G0[1], bb = G0[2];
        const F = bl(forest);
        if (F > 0.05) { const k = Math.min(1, F * 1.3) * 0.85; const f = FLOOR[bc]; r += (f[0] - r) * k; g += (f[1] - g) * k; bb += (f[2] - bb) * k; }
        const Sd = bl(sand) + n1 * 0.22;
        let sk = smooth(0.42, 0.58, Sd) + (L < 0.58 ? (0.58 - L) / 0.08 : 0);
        if (sk > 0) { sk = Math.min(1, sk); const s = SAND[bc]; r += (s[0] - r) * sk; g += (s[1] - g) * sk; bb += (s[2] - bb) * sk; }
        const Dt = bl(dirt) + n2 * 0.25 + n1 * 0.1;
        const dk = smooth(0.4, 0.6, Dt);
        if (dk > 0) { const s = DIRT[bc]; r += (s[0] - r) * dk; g += (s[1] - g) * dk; bb += (s[2] - bb) * dk; }
        const R = bl(rock) + n1 * 0.16 + n3 * 0.04;
        if (R > 0.45) {
          const k = smooth(0.45, 0.55, R), s = ROCK[bc];
          // the light comes from the top left; the slope of the rock field is the bevel
          const gx = (rock[b] - rock[a]) * (1 - v) + (rock[d] - rock[c]) * v, gy = (rock[c] - rock[a]) * (1 - u) + (rock[d] - rock[b]) * u;
          const lit = 1 + (gx + gy) * 0.22 * (R < 0.8 ? 1 : 0.3) + n2 * 0.12 + (n3 > 0.55 ? -0.18 : 0);
          const snow = bc === 2 ? smooth(0.7, 0.9, R + n2 * 0.3) * 0.7 : 0;
          r += (s[0] * lit - r) * k; g += (s[1] * lit - g) * k; bb += (s[2] * lit - bb) * k;
          if (snow) { r += (236 - r) * snow; g += (240 - g) * snow; bb += (244 - bb) * snow; }
        }
        const grain = 1 + n2 * 0.06 + n3 * 0.05;
        px[o] = clamp8(r * grain); px[o + 1] = clamp8(g * grain); px[o + 2] = clamp8(bb * grain); px[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    this.details(ctx, cx, cy, S, tt, bio, P);
    return cv;
  }

  /** Trees, cliffs, tufts: drawn with paths over the painted ground. */
  details(ctx, cx, cy, S, tt, bio, P) {
    const W = this.w, x0 = cx * CHUNK, y0 = cy * CHUNK, k = S / TILE, seed = W.seed;
    ctx.save();
    ctx.scale(k, k);
    const hi = S >= 16;
    // cliff faces: the south edge of rock that drops to open ground
    for (let j = 0; j < CHUNK; j++) for (let i = 0; i < CHUNK; i++) {
      const t = tt[(j + 1) * P + i + 1], below = tt[(j + 2) * P + i + 1];
      const lx = i * TILE, ly = j * TILE;
      if (t === T.ROCK && below !== T.ROCK) {
        const b = bio[(j + 1) * P + i + 1];
        const g = ctx.createLinearGradient(0, ly + 18, 0, ly + 34);
        g.addColorStop(0, b === 1 ? "rgba(92,72,54,0.95)" : b === 2 ? "rgba(84,92,104,0.95)" : "rgba(70,66,62,0.95)");
        g.addColorStop(1, "rgba(30,26,24,0.0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(lx - 1, ly + 20 + (hash(seed, x0 + i, y0 + j, 3) & 3));
        for (let s = 1; s <= 4; s++) ctx.lineTo(lx + s * 8.5, ly + 18 + (hash(seed, x0 + i, y0 + j, 3 + s) & 5));
        ctx.lineTo(lx + 33, ly + 34); ctx.lineTo(lx - 1, ly + 34); ctx.fill();
      }
      if (hi && (t === T.GRASS) && (hash(seed, x0 + i, y0 + j, 5) & 7) < 3) {
        const b = bio[(j + 1) * P + i + 1], h = hash(seed, x0 + i, y0 + j, 6);
        ctx.strokeStyle = b === 0 ? "rgba(40,78,28,0.55)" : b === 1 ? "rgba(110,96,50,0.6)" : "rgba(150,166,170,0.6)";
        ctx.lineWidth = 1.2;
        for (let q = 0; q < 3; q++) {
          const gx = lx + 4 + ((h >> (q * 4)) & 15) * 1.5, gy = ly + 6 + ((h >> (q * 4 + 2)) & 15) * 1.4;
          ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx - 1.5, gy - 4); ctx.moveTo(gx + 1, gy); ctx.lineTo(gx + 2.5, gy - 3.5); ctx.stroke();
        }
        if (b === 0 && (h & 31) === 7) { ctx.fillStyle = ["#f0d65a", "#f3f0ea", "#d97fa8", "#8fb7f0"][(h >> 8) & 3]; for (let q = 0; q < 3; q++) { ctx.beginPath(); ctx.arc(lx + 8 + ((h >> (10 + q * 3)) & 7) * 2.5, ly + 8 + ((h >> (13 + q * 3)) & 7) * 2.4, 1.3, 0, 6.3); ctx.fill(); } }
      }
      if (hi && t === T.DIRT && (hash(seed, x0 + i, y0 + j, 8) & 7) === 1) {
        ctx.fillStyle = "rgba(60,50,40,0.35)";
        const h = hash(seed, x0 + i, y0 + j, 9);
        ctx.beginPath(); ctx.ellipse(lx + 8 + (h & 15), ly + 10 + ((h >> 4) & 15), 2.5, 1.6, 0, 0, 6.3); ctx.fill();
      }
    }
    // trees, including those whose crowns lean in from a neighbouring chunk, back to front
    const trees = [];
    for (let j = 0; j < P; j++) for (let i = 0; i < P; i++) {
      if (tt[j * P + i] !== T.FOREST) continue;
      const tx = x0 + i - 1, ty = y0 + j - 1, h = hash(seed, tx, ty, 11);
      const n = (h & 3) === 0 ? 2 : 1;
      for (let q = 0; q < n; q++) {
        const hh = hash(seed, tx, ty, 12 + q);
        trees.push({ x: (i - 1) * TILE + 6 + (hh & 15) * 1.3, y: (j - 1) * TILE + 6 + ((hh >> 4) & 15) * 1.3, r: (n === 2 ? 10 : 13) + ((hh >> 8) & 7) * 0.7, b: bio[j * P + i], h: hh });
      }
    }
    trees.sort((a, b) => a.y - b.y);
    for (const t of trees) { ctx.fillStyle = "rgba(10,20,8,0.32)"; ctx.beginPath(); ctx.ellipse(t.x + 5, t.y + 6, t.r * 1.05, t.r * 0.7, 0.3, 0, 6.3); ctx.fill(); }
    for (const t of trees) tree(ctx, t, hi);
    ctx.restore();
  }
}

function tree(ctx, t, hi) {
  const { x, y, r, b, h } = t;
  if (b === 2) {          // pine, under snow
    for (let k = 0; k < 3; k++) {
      const rr = r * (1 - k * 0.27);
      ctx.fillStyle = k === 0 ? "#1f3a2c" : k === 1 ? "#284a36" : "#335c42";
      star(ctx, x, y - k * 2, rr, 7, 0.62, h * 0.01 + k);
      ctx.fill();
    }
    if (hi) { ctx.fillStyle = "rgba(240,246,250,0.85)"; star(ctx, x - 1, y - 6, r * 0.32, 6, 0.6, h); ctx.fill(); }
    return;
  }
  if (b === 1) {          // flat-topped, olive, wide
    ctx.fillStyle = "#4a5a2a";
    ctx.beginPath(); ctx.ellipse(x, y, r * 1.15, r * 0.8, 0, 0, 6.3); ctx.fill();
    const g = ctx.createRadialGradient(x - r * 0.4, y - r * 0.4, 1, x, y, r * 1.1);
    g.addColorStop(0, "#9aa25a"); g.addColorStop(1, "#56662e");
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x - 1, y - 2, r, r * 0.7, 0, 0, 6.3); ctx.fill();
    return;
  }
  // broadleaf: a few overlapping crowns, lit from the top left
  const lobes = 3 + (h & 1);
  for (let k = 0; k < lobes; k++) {
    const a = (k / lobes) * 6.28 + (h & 7);
    const lx = x + Math.cos(a) * r * 0.38, ly = y + Math.sin(a) * r * 0.32, lr = r * 0.66;
    const g = ctx.createRadialGradient(lx - lr * 0.45, ly - lr * 0.5, 1, lx, ly, lr);
    g.addColorStop(0, "#7fb24e"); g.addColorStop(0.55, "#4b8434"); g.addColorStop(1, "#2a5222");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(lx, ly, lr, 0, 6.3); ctx.fill();
  }
  if (hi && (h & 15) === 3) { ctx.fillStyle = "#d6464a"; for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.arc(x - 5 + ((h >> (k * 3)) & 7) * 1.4, y - 5 + ((h >> (k * 3 + 1)) & 7) * 1.4, 1.2, 0, 6.3); ctx.fill(); } }
}
function star(ctx, x, y, r, n, inner, rot) {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = rot + i * Math.PI / n, rr = i & 1 ? r * inner : r;
    i ? ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
}
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp8 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);
export function mk(w, h) {
  if (typeof OffscreenCanvas !== "undefined" && typeof document === "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas"); c.width = w; c.height = h; return c;
}

/* ---------------- water and mist, as patterns ---------------- */
export function waterTile() {
  const c = mk(NS, NS), x = c.getContext("2d"), img = x.createImageData(NS, NS), p = img.data;
  for (let j = 0; j < NS; j++) for (let i = 0; i < NS; i++) {
    const a = nAt(N1, i, j), b = nAt(N2, i * 1, j * 1), caustic = Math.pow(1 - Math.abs(nAt(N2, i + 40, j + 13) + nAt(N1, i * 2, j * 2) * 0.5), 9);
    const o = (j * NS + i) * 4;
    p[o] = 22 + a * 8 + caustic * 60; p[o + 1] = 70 + a * 12 + b * 6 + caustic * 80; p[o + 2] = 104 + a * 14 + caustic * 70; p[o + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  return c;
}
export function shimmerTile() {
  const c = mk(NS, NS), x = c.getContext("2d"), img = x.createImageData(NS, NS), p = img.data;
  for (let j = 0; j < NS; j++) for (let i = 0; i < NS; i++) {
    const v = Math.pow(Math.max(0, 1 - Math.abs(nAt(N3, i, j) * 1.6 + nAt(N2, i, j) * 0.4)), 14);
    const o = (j * NS + i) * 4;
    p[o] = 200; p[o + 1] = 240; p[o + 2] = 255; p[o + 3] = v * 150;
  }
  x.putImageData(img, 0, 0);
  return c;
}
export function mistTile() {
  const c = mk(NS, NS), x = c.getContext("2d"), img = x.createImageData(NS, NS), p = img.data;
  for (let j = 0; j < NS; j++) for (let i = 0; i < NS; i++) {
    const v = (nAt(N1, i, j) * 0.6 + nAt(N2, i, j) * 0.3 + nAt(N3, i, j) * 0.1) * 0.5 + 0.5;
    const o = (j * NS + i) * 4;
    p[o] = 40 + v * 50; p[o + 1] = 30 + v * 36; p[o + 2] = 60 + v * 70; p[o + 3] = 120 + v * 135;
  }
  x.putImageData(img, 0, 0);
  return c;
}
export function cloudTile() {
  const c = mk(NS, NS), x = c.getContext("2d"), img = x.createImageData(NS, NS), p = img.data;
  for (let j = 0; j < NS; j++) for (let i = 0; i < NS; i++) {
    const v = nAt(N1, i, j) * 0.7 + nAt(N2, i, j) * 0.3;
    const o = (j * NS + i) * 4;
    p[o] = 0; p[o + 1] = 6; p[o + 2] = 18; p[o + 3] = smooth(0.05, 0.45, v) * 255;
  }
  x.putImageData(img, 0, 0);
  return c;
}
