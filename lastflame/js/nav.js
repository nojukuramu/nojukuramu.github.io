/* nav.js — the house as a grid: where a body can walk, what an eye can see
 * through, and how far a sound travels to reach someone.
 *
 * One grid of quarter-metre cells, built from the layout. Three answers come
 * off it:
 *
 *   walking  — A* for the hunter, through doorways, with a shut door costing
 *              the second it takes to open, and with places it will not go
 *              (a relit lamp's light, until the end) passed in as a cost;
 *   seeing   — a line drawn cell by cell through walls, shut doors and tall
 *              furniture (a closet, a cabinet, a clock) — low things like
 *              tables are looked over;
 *   hearing  — distance measured along the floor, not through the wall: a
 *              sound in the next room is as far as the walk round through
 *              the doorway, and a shut door makes it a few metres further;
 *   light    — the same walk round, but through the air: over the
 *              furniture, never through a wall or a shut door. It is how
 *              far a lamp's glow travels to reach a corner, so the light
 *              that bounces round a room spills out of its doorway and
 *              stops at its walls (render.js draws it).
 *
 * Collision for the player is boxes, not this grid (move() at the bottom), so
 * walking along a wall is smooth rather than stepped.
 *
 * Pure: no DOM, no three.js. */

import { doorBox, roomAt, POOL_R } from "./house.js";

export const RES = 0.25;
export const AGENT_R = 0.3;
const DOOR_SOUND_COST = 4; // metres a shut door adds to a sound's way round

export function buildGrid(L) {
  const nx = Math.ceil(L.W / RES), nz = Math.ceil(L.D / RES);
  const G = { L, nx, nz, solid: new Uint8Array(nx * nz), opaque: new Uint8Array(nx * nz), door: new Int16Array(nx * nz).fill(-1) };
  rebuild(G);
  return G;
}

/** Recompute the grid from the layout (after the house changes). */
export function rebuild(G) {
  const { L, nx, nz } = G;
  G.solid.fill(0); G.opaque.fill(0); G.door.fill(-1);
  const mark = (b, inflate, arr, v) => {
    const i0 = Math.max(0, Math.floor((b.x0 - inflate) / RES)), i1 = Math.min(nx - 1, Math.floor((b.x1 + inflate) / RES));
    const j0 = Math.max(0, Math.floor((b.z0 - inflate) / RES)), j1 = Math.min(nz - 1, Math.floor((b.z1 + inflate) / RES));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      // a cell is blocked when its centre is within the inflated box
      const cx = (i + 0.5) * RES, cz = (j + 0.5) * RES;
      if (cx >= b.x0 - inflate && cx <= b.x1 + inflate && cz >= b.z0 - inflate && cz <= b.z1 + inflate) arr[j * nx + i] = v;
    }
  };
  for (const b of L.blocks) {
    mark(b, AGENT_R, G.solid, 1);
    if (b.tall) mark(b, 0, G.opaque, 1);
  }
  // outside the house is solid too
  for (let i = 0; i < nx; i++) { G.solid[i] = 1; G.solid[(nz - 1) * nx + i] = 1; }
  for (let j = 0; j < nz; j++) { G.solid[j * nx] = 1; G.solid[j * nx + nx - 1] = 1; }
  label(G);
  for (const d of L.doors) {
    if (d.sealed || d.b < 0) continue;
    const b = doorBox(d);
    // the doorway's own cells: walkable, and they remember which door they are
    const i0 = Math.max(0, Math.floor(b.x0 / RES)), i1 = Math.min(nx - 1, Math.floor(b.x1 / RES));
    const j0 = Math.max(0, Math.floor(b.z0 / RES)), j1 = Math.min(nz - 1, Math.floor(b.z1 / RES));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) G.door[j * nx + i] = d.id;
  }
  return G;
}

/* Connected pieces of floor. Furniture can wall off a pocket a body could
   squeeze into but never walk out of; places to go are always picked from
   the biggest piece, which is the house. */
function label(G) {
  const { nx, nz } = G, N = nx * nz;
  const lab = G.label || (G.label = new Int32Array(N));
  lab.fill(0);
  let next = 0, bestN = 0;
  const stack = [];
  for (let c0 = 0; c0 < N; c0++) {
    if (G.solid[c0] || lab[c0]) continue;
    next++; let n = 0;
    lab[c0] = next; stack.push(c0);
    while (stack.length) {
      const c = stack.pop(); n++;
      const i = c % nx, j = (c / nx) | 0;
      for (let k = 0; k < 8; k++) {
        const ni = i + DI[k], nj = j + DJ[k];
        if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue;
        const m = nj * nx + ni;
        if (G.solid[m] || lab[m]) continue;
        if (DI[k] && DJ[k] && (G.solid[j * nx + ni] || G.solid[nj * nx + i])) continue;
        lab[m] = next; stack.push(m);
      }
    }
    if (n > bestN) { bestN = n; G.main = next; }
  }
}

export const cellOf = (G, x, z) => {
  const i = Math.min(G.nx - 1, Math.max(0, Math.floor(x / RES))), j = Math.min(G.nz - 1, Math.max(0, Math.floor(z / RES)));
  return j * G.nx + i;
};
export const cx = (G, c) => ((c % G.nx) + 0.5) * RES;
export const cz = (G, c) => (Math.floor(c / G.nx) + 0.5) * RES;

function doorShut(G, c) {
  const d = G.door[c];
  return d >= 0 && G.L.doors[d].open < 0.5;
}

/** Is there a clear line of sight between two points (eye height assumed)? */
export function sees(G, x0, z0, x1, z1) {
  // DDA through the grid: every cell the segment crosses
  let i = Math.floor(x0 / RES), j = Math.floor(z0 / RES);
  const ie = Math.floor(x1 / RES), je = Math.floor(z1 / RES);
  const dx = x1 - x0, dz = z1 - z0;
  const si = dx > 0 ? 1 : -1, sj = dz > 0 ? 1 : -1;
  const tdx = dx !== 0 ? Math.abs(RES / dx) : Infinity, tdz = dz !== 0 ? Math.abs(RES / dz) : Infinity;
  let tx = dx !== 0 ? ((si > 0 ? (i + 1) * RES : i * RES) - x0) / dx : Infinity;
  let tz = dz !== 0 ? ((sj > 0 ? (j + 1) * RES : j * RES) - z0) / dz : Infinity;
  for (let n = 0; n < 400; n++) {
    if (i < 0 || j < 0 || i >= G.nx || j >= G.nz) return false;
    const c = j * G.nx + i;
    if (G.opaque[c] || doorShut(G, c)) {
      // the eye's own cell and the target's own cell never block: you can
      // see a man standing against a wall
      if (!(i === Math.floor(x0 / RES) && j === Math.floor(z0 / RES)) && !(i === ie && j === je)) return false;
    }
    if (i === ie && j === je) return true;
    if (tx < tz) { tx += tdx; i += si; } else { tz += tdz; j += sj; }
  }
  return true;
}

/** Can a body walk straight from one point to the other? (For smoothing paths.) */
function walkable(G, x0, z0, x1, z1, avoid) {
  const d = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(d / (RES * 0.5));
  for (let k = 0; k <= n; k++) {
    const t = k / (n || 1), c = cellOf(G, x0 + (x1 - x0) * t, z0 + (z1 - z0) * t);
    if (G.solid[c] || doorShut(G, c) || (avoid && avoid(c) === Infinity)) return false;
  }
  return true;
}

/* ---------- A* ---------- */

class Heap {
  constructor() { this.a = []; this.p = []; }
  push(v, pr) { const a = this.a, p = this.p; a.push(v); p.push(pr); let i = a.length - 1; while (i > 0) { const q = (i - 1) >> 1; if (p[q] <= pr) break; a[i] = a[q]; p[i] = p[q]; i = q; } a[i] = v; p[i] = pr; }
  pop() {
    const a = this.a, p = this.p, top = a[0], lv = a.pop(), lp = p.pop();
    if (a.length) {
      let i = 0; const n = a.length;
      for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && p[c + 1] < p[c]) c++; if (p[c] >= lp) break; a[i] = a[c]; p[i] = p[c]; i = c; }
      a[i] = lv; p[i] = lp;
    }
    return top;
  }
  get size() { return this.a.length; }
}

/* Nearest walkable cell to a point, searching outward a few rings. */
export function nearestFree(G, x, z, avoid) {
  const c0 = cellOf(G, x, z);
  const ok = (c) => !G.solid[c] && G.label[c] === G.main && (!avoid || avoid(c) !== Infinity);
  if (ok(c0)) return c0;
  const i0 = c0 % G.nx, j0 = Math.floor(c0 / G.nx);
  // the same room first: the nearest free floor to a lamp on a table against
  // a wall is in front of the table, not through the wall behind it
  const room = roomAt(G.L, x, z);
  for (let rad = 1; rad < 14; rad++) {
    let best = -1, bd = Infinity;
    for (let dj = -rad; dj <= rad; dj++) for (let di = -rad; di <= rad; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== rad) continue;
      const i = i0 + di, j = j0 + dj;
      if (i < 0 || j < 0 || i >= G.nx || j >= G.nz) continue;
      const c = j * G.nx + i;
      if (!ok(c)) continue;
      const d = di * di + dj * dj + (roomAt(G.L, (i + 0.5) * RES, (j + 0.5) * RES) === room ? 0 : 1000);
      if (d < bd) { bd = d; best = c; }
    }
    if (best >= 0 && bd < 1000) return best;
    if (best >= 0 && rad > 6) return best;
  }
  return -1;
}

/**
 * A path from (x0,z0) to (x1,z1) as a list of points, or null.
 * `avoid(c)` may return an extra cost for a cell, or Infinity to forbid it.
 * Shut doors are passable at `doorCost` metres extra: the hunter opens them.
 */
export function findPath(G, x0, z0, x1, z1, avoid, doorCost) {
  const s = nearestFree(G, x0, z0, avoid), e = nearestFree(G, x1, z1, avoid);
  if (s < 0 || e < 0) return null;
  if (s === e) return [{ x: x1, z: z1 }];
  const nx = G.nx, N = G.nx * G.nz;
  const gS = G._g || (G._g = new Float32Array(N)), from = G._f || (G._f = new Int32Array(N)), stamp = G._s || (G._s = new Uint32Array(N));
  G._stamp = (G._stamp || 0) + 1;
  const st = G._stamp;
  const ei = e % nx, ej = Math.floor(e / nx);
  const h = (c) => { const di = Math.abs((c % nx) - ei), dj = Math.abs(Math.floor(c / nx) - ej); return (Math.max(di, dj) + 0.4142 * Math.min(di, dj)) * RES; };
  const open = new Heap();
  gS[s] = 0; from[s] = -1; stamp[s] = st;
  open.push(s, h(s));
  const closed = G._c || (G._c = new Uint32Array(N));
  let found = false, iter = 0;
  while (open.size && iter++ < 40000) {
    const c = open.pop();
    if (closed[c] === st) continue;
    closed[c] = st;
    if (c === e) { found = true; break; }
    const i = c % nx, j = Math.floor(c / nx);
    for (let k = 0; k < 8; k++) {
      const di = DI[k], dj = DJ[k];
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= nx || nj >= G.nz) continue;
      const n = nj * nx + ni;
      if (G.solid[n] || closed[n] === st) continue;
      // no cutting a corner past a solid cell
      if (di && dj && (G.solid[j * nx + ni] || G.solid[nj * nx + i])) continue;
      let cost = (di && dj ? 1.4142 : 1) * RES;
      if (avoid) { const a = avoid(n); if (a === Infinity) continue; cost += a; }
      if (doorShut(G, n) && G.door[c] !== G.door[n]) cost += doorCost === undefined ? 1.5 : doorCost;
      const ng = gS[c] + cost;
      if (stamp[n] === st && ng >= gS[n]) continue;
      stamp[n] = st; gS[n] = ng; from[n] = c;
      open.push(n, ng + h(n));
    }
  }
  if (!found) return null;
  const cells = [];
  for (let c = e; c >= 0; c = from[c]) cells.push(c);
  cells.reverse();
  // string-pull: keep a point only when the straight walk to the next one is blocked
  const pts = cells.map((c) => ({ x: cx(G, c), z: cz(G, c), c }));
  const out = [];
  let a = 0;
  while (a < pts.length - 1) {
    let b = pts.length - 1;
    while (b > a + 1 && !walkable(G, pts[a].x, pts[a].z, pts[b].x, pts[b].z, avoid)) b--;
    // a doorway is always a point of its own, so the walker knows a door is next
    for (let k = a + 1; k <= b; k++) if (G.door[pts[k].c] >= 0) { b = k; break; }
    out.push(pts[b]);
    a = b;
  }
  if (out.length) {
    // end at the asked-for point itself, unless it is in a wall or in light it may not enter
    const tc = cellOf(G, x1, z1);
    out[out.length - 1] = G.solid[tc] || (avoid && avoid(tc) === Infinity) ? pts[pts.length - 1] : { x: x1, z: z1, c: e };
  }
  return out;
}
const DI = [1, -1, 0, 0, 1, 1, -1, -1], DJ = [0, 0, 1, -1, 1, -1, 1, -1];

/** Path length along a path from (x,z). */
export function pathLength(x, z, path) {
  let d = 0, px = x, pz = z;
  for (const p of path) { d += Math.hypot(p.x - px, p.z - pz); px = p.x; pz = p.z; }
  return d;
}

/**
 * Distances along the floor from one point to everywhere within `max` metres:
 * how far a sound made there has to travel to reach each cell. Dijkstra over
 * the walkable cells, with a shut door adding a few metres.
 */
export function soundField(G, x, z, max) {
  const N = G.nx * G.nz, nx = G.nx;
  const f = new Float32Array(N).fill(Infinity);
  const s = nearestFree(G, x, z);
  if (s < 0) return f;
  f[s] = 0;
  const open = new Heap();
  open.push(s, 0);
  while (open.size) {
    const c = open.pop(), dc = f[c];
    if (dc > max) break;
    const i = c % nx, j = Math.floor(c / nx);
    for (let k = 0; k < 8; k++) {
      const ni = i + DI[k], nj = j + DJ[k];
      if (ni < 0 || nj < 0 || ni >= nx || nj >= G.nz) continue;
      const n = nj * nx + ni;
      if (G.solid[n]) continue;
      if (DI[k] && DJ[k] && (G.solid[j * nx + ni] || G.solid[nj * nx + i])) continue;
      let nd = dc + (DI[k] && DJ[k] ? 1.4142 : 1) * RES;
      if (doorShut(G, n) && G.door[c] !== G.door[n]) nd += DOOR_SOUND_COST;
      if (nd < f[n]) { f[n] = nd; open.push(n, nd); }
    }
  }
  return f;
}

/** How far a sound at (x,z) travels to reach the field's source, by the floor. */
export function heardAt(G, field, x, z) {
  const c = cellOf(G, x, z);
  if (field[c] < Infinity) return field[c];
  const n = nearestFree(G, x, z);
  return n >= 0 ? field[n] : Infinity;
}

/** Cells within a relit lamp's light, before the end: the hunter keeps out. */
export function poolAvoid(G, lamps, active) {
  if (!active) return null;
  const lit = lamps.filter((l) => l.lit);
  if (!lit.length) return null;
  const R2 = POOL_R * POOL_R;
  return (c) => {
    const x = cx(G, c), z = cz(G, c);
    for (const l of lit) if ((x - l.x) * (x - l.x) + (z - l.z) * (z - l.z) < R2) return Infinity;
    return 0;
  };
}

/* ---------- light ---------- */

/**
 * The air of the house on the same quarter-metre cells: what light can
 * cross. Only walls stop it — not furniture, which it goes over — and shut
 * doors, which are kept apart so a door swinging costs a few cells, not the
 * whole grid. Walls are thickened by half a cell so even the thinnest one
 * is two cells of solid that light cannot squeeze between.
 */
export function airGrid(L) {
  const nx = Math.ceil(L.W / RES), nz = Math.ceil(L.D / RES), N = nx * nz;
  const A = { L, nx, nz, wall: new Uint8Array(N), shut: new Uint8Array(N), doors: [], key: "" };
  const cells = (b, inflate, fn) => {
    const i0 = Math.max(0, Math.floor((b.x0 - inflate) / RES)), i1 = Math.min(nx - 1, Math.floor((b.x1 + inflate) / RES));
    const j0 = Math.max(0, Math.floor((b.z0 - inflate) / RES)), j1 = Math.min(nz - 1, Math.floor((b.z1 + inflate) / RES));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = (i + 0.5) * RES, z = (j + 0.5) * RES;
      if (x >= b.x0 - inflate && x <= b.x1 + inflate && z >= b.z0 - inflate && z <= b.z1 + inflate) fn(j * nx + i);
    }
  };
  for (const b of L.blocks) if (b.wall) cells(b, RES / 2, (c) => { A.wall[c] = 1; });
  for (const d of L.doors) {
    if (d.sealed || (d.kind !== "door" && d.kind !== "front")) continue;
    const list = [];
    cells(doorBox(d), RES / 2, (c) => list.push(c));
    A.doors.push({ id: d.id, cells: list });
  }
  airDoors(A);
  return A;
}

/** Shut doors into the air grid. Returns true when anything changed. */
export function airDoors(A) {
  const key = A.doors.map((q) => (A.L.doors[q.id].open < 0.5 ? 1 : 0)).join("");
  if (key === A.key) return false;
  A.key = key;
  A.shut.fill(0);
  for (const q of A.doors) if (A.L.doors[q.id].open < 0.5) for (const c of q.cells) A.shut[c] = 1;
  return true;
}

/**
 * How far light from (x,z) travels through the air to every cell within
 * `max` metres: Dijkstra, as soundField, with walls and shut doors solid.
 * The cells inside a wall take the distance of the open floor on their own
 * side, so a surface sampled just in front of a wall reads its own room.
 */
export function lightField(A, x, z, max, out) {
  const { nx, nz } = A, N = nx * nz;
  const f = out || new Float32Array(N);
  f.fill(Infinity);
  const blocked = (c) => A.wall[c] || A.shut[c];
  let s = Math.min(nx - 1, Math.max(0, Math.floor(x / RES))) + Math.min(nz - 1, Math.max(0, Math.floor(z / RES))) * nx;
  if (blocked(s)) {
    // a light against a wall: start from the nearest open cell
    const i0 = s % nx, j0 = Math.floor(s / nx);
    let best = -1, bd = Infinity;
    for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) {
      const i = i0 + di, j = j0 + dj;
      if (i < 0 || j < 0 || i >= nx || j >= nz || blocked(j * nx + i)) continue;
      const dd = di * di + dj * dj;
      if (dd < bd) { bd = dd; best = j * nx + i; }
    }
    if (best < 0) return f;
    s = best;
  }
  f[s] = 0;
  const open = new Heap();
  open.push(s, 0);
  while (open.size) {
    const c = open.pop(), dc = f[c];
    if (dc > max) break;
    const i = c % nx, j = Math.floor(c / nx);
    for (let k = 0; k < 8; k++) {
      const ni = i + DI[k], nj = j + DJ[k];
      if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue;
      const n = nj * nx + ni;
      if (blocked(n)) continue;
      if (DI[k] && DJ[k] && (blocked(j * nx + ni) || blocked(nj * nx + i))) continue;
      const nd = dc + (DI[k] && DJ[k] ? 1.4142 : 1) * RES;
      if (nd < f[n]) { f[n] = nd; open.push(n, nd); }
    }
  }
  // wall cells: the nearest open floor's distance, from one side only
  for (let c = 0; c < N; c++) {
    if (!blocked(c)) continue;
    const i = c % nx, j = Math.floor(c / nx);
    let m = Infinity;
    for (let k = 0; k < 4; k++) {
      const ni = i + DI[k], nj = j + DJ[k];
      if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue;
      const n = nj * nx + ni;
      if (!blocked(n) && f[n] < m) m = f[n];
    }
    f[c] = m + RES;
  }
  return f;
}

/* ---------- the player's body ---------- */

/**
 * Move a circle of radius r from (x,z) by (dx,dz) against boxes, sliding along
 * whatever it meets: small steps, each followed by pushing the circle out of
 * anything it overlaps along the shortest way out. That rounds corners and
 * doorjambs instead of catching on them, and a step never exceeds a tenth of
 * a metre, so nothing as thick as a wall can be stepped through.
 */
export function move(x, z, dx, dz, r, boxes) {
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.1));
  for (let s = 0; s <= steps; s++) {
    if (s) { x += dx / steps; z += dz / steps; }
    for (let it = 0; it < 4; it++) {
      let moved = false;
      for (const b of boxes) {
        const nx = Math.max(b.x0, Math.min(x, b.x1)), nz = Math.max(b.z0, Math.min(z, b.z1));
        const ox = x - nx, oz = z - nz, d2 = ox * ox + oz * oz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-12) { const d = Math.sqrt(d2), k = (r - d) / d + 1e-6; x += ox * k; z += oz * k; }
        else {
          // centre inside the box (a door shut on someone): out by the nearest face
          const l = x - b.x0, rr = b.x1 - x, t = z - b.z0, bb = b.z1 - z, m = Math.min(l, rr, t, bb);
          if (m === l) x = b.x0 - r; else if (m === rr) x = b.x1 + r; else if (m === t) z = b.z0 - r; else z = b.z1 + r;
        }
        moved = true;
      }
      if (!moved) break;
    }
  }
  return { x, z };
}
