/* brush.js — the world as convex brushes, and a box swept through them.
 *
 * This is how Quake, Half-Life and Source hold their levels, and it is here
 * for the same reason: Source's movement code is written against exactly one
 * question — "if this box moves from here to there, where does it stop, and
 * what did it touch?" — and answering it against convex brushes is exact,
 * cheap, and never lets a box slip through a corner. Bunny hopping, air
 * strafing and surfing all fall out of that answer; none of them is coded.
 *
 * A brush is a set of planes, each with its outside facing away. A point is
 * inside the brush when it is behind every plane. To sweep a box instead of
 * a point, every plane is pushed out by the box's reach along its normal (the
 * Minkowski sum), and the box's centre is traced as a point against that.
 * The algorithm is CM_TraceThroughBrush from the released Quake III source,
 * with the axial "bevel" planes added so boxes do not snag on slanted edges.
 *
 * Pure: no three.js, no DOM. The game, the bots, the hack worker (which gets
 * its own copy of the map so a hack can raycast synchronously) and
 * tools/validate.js all use this one file. */

export const EPS = 0.001;             // Quake's DIST_EPSILON, in metres

/* ---------------------------------------------------------------
   Building brushes
   --------------------------------------------------------------- */
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

/**
 * A brush from its corners and faces. Faces are lists of vertex indices;
 * their winding does not matter — each is turned to face away from the
 * brush's centre, which is always right for a convex solid.
 * `props` travel with the brush: kind (floor, wall, surf, climb, pad …),
 * and for a jump pad its push.
 */
export function makeBrush(verts, faces, props) {
  const c = [0, 0, 0];
  for (const v of verts) { c[0] += v[0]; c[1] += v[1]; c[2] += v[2]; }
  c[0] /= verts.length; c[1] /= verts.length; c[2] /= verts.length;
  const planes = [], outFaces = [];
  for (const f0 of faces) {
    let f = f0.slice();
    // Newell's normal: robust for any planar polygon, whatever its first corner
    let n = [0, 0, 0];
    for (let i = 0; i < f.length; i++) {
      const a = verts[f[i]], b = verts[f[(i + 1) % f.length]];
      n[0] += (a[1] - b[1]) * (a[2] + b[2]);
      n[1] += (a[2] - b[2]) * (a[0] + b[0]);
      n[2] += (a[0] - b[0]) * (a[1] + b[1]);
    }
    n = norm(n);
    const fc = [0, 0, 0];
    for (const i of f) { fc[0] += verts[i][0]; fc[1] += verts[i][1]; fc[2] += verts[i][2]; }
    fc[0] /= f.length; fc[1] /= f.length; fc[2] /= f.length;
    if (dot(n, sub(fc, c)) < 0) { n = [-n[0], -n[1], -n[2]]; f = f.reverse(); }
    planes.push([n[0], n[1], n[2], dot(n, verts[f[0]])]);
    outFaces.push({ idx: f, n });
  }
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const v of verts) for (let k = 0; k < 3; k++) { if (v[k] < min[k]) min[k] = v[k]; if (v[k] > max[k]) max[k] = v[k]; }
  // Axial bevels: without them a box sweeping past a slanted edge is stopped
  // by the edge's plane pushed out into empty air.
  const axial = [[1, 0, 0, max[0]], [-1, 0, 0, -min[0]], [0, 1, 0, max[1]], [0, -1, 0, -min[1]], [0, 0, 1, max[2]], [0, 0, -1, -min[2]]];
  for (const a of axial) if (!planes.some((p) => p[0] * a[0] + p[1] * a[1] + p[2] * a[2] > 0.9999)) planes.push(a);
  const P = new Float64Array(planes.length * 4);
  planes.forEach((p, i) => P.set(p, i * 4));
  return Object.assign({ kind: "wall" }, props || {}, { planes: P, np: planes.length, min, max, verts, faces: outFaces });
}

/** An axis-aligned box. */
export function box(x0, y0, z0, x1, y1, z1, props) {
  const a = [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)], b = [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)];
  const v = [
    [a[0], a[1], a[2]], [b[0], a[1], a[2]], [b[0], a[1], b[2]], [a[0], a[1], b[2]],
    [a[0], b[1], a[2]], [b[0], b[1], a[2]], [b[0], b[1], b[2]], [a[0], b[1], b[2]]
  ];
  return makeBrush(v, [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [3, 2, 6, 7], [0, 3, 7, 4], [1, 5, 6, 2]], props);
}

/**
 * A convex polygon extruded along an axis. `pts` are [u, v] pairs:
 *   axis "y": u = x, v = z   (a floor plan, extruded upwards from a0 to a1)
 *   axis "x": u = z, v = y   (a cross-section, extruded along x)
 *   axis "z": u = x, v = y   (a cross-section, extruded along z)
 * Ramps, surf ramps, wedges and walls at an angle are all this.
 */
export function prism(pts, axis, a0, a1, props) {
  const at = (u, v, a) => axis === "y" ? [u, a, v] : axis === "x" ? [a, v, u] : [u, v, a];
  const n = pts.length, verts = [];
  for (const p of pts) verts.push(at(p[0], p[1], a0));
  for (const p of pts) verts.push(at(p[0], p[1], a1));
  const faces = [[...Array(n).keys()], [...Array(n).keys()].map((i) => i + n)];
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; faces.push([i, j, j + n, i + n]); }
  return makeBrush(verts, faces, props);
}

/** Move a brush (a copy) by a rotation of quarter turns about the vertical axis through the origin, then an offset. */
export function turned(b, quarter, dx, dz) {
  const q = ((quarter % 4) + 4) % 4;
  const rot = (v) => {
    let x = v[0], z = v[2];
    for (let i = 0; i < q; i++) { const t = x; x = -z; z = t; }
    return [x + (dx || 0), v[1], z + (dz || 0)];
  };
  const props = {};
  for (const k in b) if (!["planes", "np", "min", "max", "verts", "faces"].includes(k)) props[k] = b[k];
  if (props.push) { let x = props.push[0], z = props.push[2]; for (let i = 0; i < q; i++) { const t = x; x = -z; z = t; } props.push = [x, props.push[1], z]; }
  return makeBrush(b.verts.map(rot), b.faces.map((f) => f.idx), props);
}

/* ---------------------------------------------------------------
   A world: the brushes, and a coarse grid over them
   --------------------------------------------------------------- */
const CELL = 8;

export function buildWorld(brushes) {
  const W = { brushes, grid: new Map(), stamp: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  brushes.forEach((b, i) => {
    b.id = i; b.seen = 0;
    for (let k = 0; k < 3; k++) { W.min[k] = Math.min(W.min[k], b.min[k]); W.max[k] = Math.max(W.max[k], b.max[k]); }
    for (let cx = Math.floor(b.min[0] / CELL); cx <= Math.floor(b.max[0] / CELL); cx++)
      for (let cz = Math.floor(b.min[2] / CELL); cz <= Math.floor(b.max[2] / CELL); cz++) {
        const key = cx * 4096 + cz;
        let list = W.grid.get(key);
        if (!list) W.grid.set(key, (list = []));
        list.push(b);
      }
  });
  return W;
}

export function newTrace() {
  return { fraction: 1, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, startsolid: false, allsolid: false, brush: null };
}

/**
 * Sweep a box with half-extents (hx, hy, hz), centred at (sx, sy, sz), to
 * (ex, ey, ez). A ray is a box with no extent. Writes into `tr` and returns
 * it: fraction of the way it got, where its centre stopped, the normal of
 * what it hit, and whether it started (or stayed) inside something.
 */
export function trace(W, sx, sy, sz, ex, ey, ez, hx, hy, hz, tr) {
  tr = tr || newTrace();
  tr.fraction = 1; tr.startsolid = false; tr.allsolid = false; tr.brush = null;
  tr.nx = 0; tr.ny = 0; tr.nz = 0;
  const bx0 = Math.min(sx, ex) - hx - EPS, bx1 = Math.max(sx, ex) + hx + EPS;
  const by0 = Math.min(sy, ey) - hy - EPS, by1 = Math.max(sy, ey) + hy + EPS;
  const bz0 = Math.min(sz, ez) - hz - EPS, bz1 = Math.max(sz, ez) + hz + EPS;
  const cx0 = Math.floor(bx0 / CELL), cx1 = Math.floor(bx1 / CELL), cz0 = Math.floor(bz0 / CELL), cz1 = Math.floor(bz1 / CELL);
  const stamp = ++W.stamp;
  const test = (b) => {
    if (b.seen === stamp) return;
    b.seen = stamp;
    if (b.nonsolid || b.max[0] < bx0 || b.min[0] > bx1 || b.max[1] < by0 || b.min[1] > by1 || b.max[2] < bz0 || b.min[2] > bz1) return;
    clip(b, sx, sy, sz, ex, ey, ez, hx, hy, hz, tr);
  };
  // Long sweeps (a sniper's ray across the map) touch so many cells that
  // walking the list once is quicker than walking the grid.
  if ((cx1 - cx0 + 1) * (cz1 - cz0 + 1) > 24) { for (const b of W.brushes) test(b); }
  else for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) { const l = W.grid.get(cx * 4096 + cz); if (l) for (const b of l) test(b); }
  if (tr.allsolid) tr.fraction = 0;
  const f = tr.fraction;
  tr.x = sx + (ex - sx) * f; tr.y = sy + (ey - sy) * f; tr.z = sz + (ez - sz) * f;
  return tr;
}

function clip(b, sx, sy, sz, ex, ey, ez, hx, hy, hz, tr) {
  let enter = -1, leave = 1, hit = -1, getout = false, startout = false;
  const P = b.planes;
  for (let i = 0; i < b.np; i++) {
    const o = i * 4, nx = P[o], ny = P[o + 1], nz = P[o + 2];
    const d = P[o + 3] + (nx < 0 ? -nx : nx) * hx + (ny < 0 ? -ny : ny) * hy + (nz < 0 ? -nz : nz) * hz;
    const d1 = nx * sx + ny * sy + nz * sz - d;
    const d2 = nx * ex + ny * ey + nz * ez - d;
    if (d2 > 0) getout = true;
    if (d1 > 0) startout = true;
    // wholly in front of this face: the sweep never enters the brush
    if (d1 > 0 && (d2 >= EPS || d2 >= d1)) return;
    if (d1 <= 0 && d2 <= 0) continue;
    if (d1 > d2) {
      let f = (d1 - EPS) / (d1 - d2);
      if (f < 0) f = 0;
      if (f > enter) { enter = f; hit = i; }
    } else {
      let f = (d1 + EPS) / (d1 - d2);
      if (f > 1) f = 1;
      if (f < leave) leave = f;
    }
  }
  if (!startout) {
    // Started inside. Moving out again is allowed, so a box that ends up
    // wedged by a rounding error can always walk free.
    tr.startsolid = true;
    if (!getout) { tr.allsolid = true; tr.fraction = 0; tr.brush = b; }
    return;
  }
  if (enter < leave && enter > -1 && enter < tr.fraction) {
    tr.fraction = enter < 0 ? 0 : enter;
    tr.brush = b;
    tr.nx = P[hit * 4]; tr.ny = P[hit * 4 + 1]; tr.nz = P[hit * 4 + 2];
  }
}

/** Is a box at this centre inside anything? */
export function solidAt(W, x, y, z, hx, hy, hz, tr) {
  tr = trace(W, x, y, z, x, y, z, hx, hy, hz, tr);
  return tr.startsolid;
}

/** A ray: the same sweep with no extent. */
export function ray(W, sx, sy, sz, ex, ey, ez, tr) {
  return trace(W, sx, sy, sz, ex, ey, ez, 0, 0, 0, tr);
}

/* ---------------------------------------------------------------
   For the hack worker: the map as plain data and back
   --------------------------------------------------------------- */
export function exportWorld(W) {
  return W.brushes.map((b) => ({ p: Array.from(b.planes), min: b.min, max: b.max, kind: b.kind, nonsolid: !!b.nonsolid }));
}
export function importWorld(list) {
  return buildWorld(list.map((d) => ({ planes: Float64Array.from(d.p), np: d.p.length / 4, min: d.min, max: d.max, kind: d.kind, nonsolid: d.nonsolid })));
}
