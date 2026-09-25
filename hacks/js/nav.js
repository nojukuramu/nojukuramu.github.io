/* nav.js — where a bot can go, and how it gets there.
 *
 * Nothing here is placed by hand. The graph is read off the brushes the same
 * way a player learns a map: every flat-enough top surface is sampled on a
 * two-metre grid, and every sample that a standing body fits on is a node.
 * Nodes are then linked by what a body can actually do between them, each
 * link checked with the same box sweeps movement.js moves by:
 *
 *   walk   neighbours on the grid, nothing in the way, ground all along
 *   jump   up to a metre higher, a short hop away
 *   climb  up to five metres higher, with a wall to climb in between
 *   drop   off an edge to anything lower
 *   pad    wherever a jump pad actually throws you — found by simulating it
 *
 * A* over that graph gives a bot its route; the link kinds tell it which
 * button to press on the way. Pure, so tools/validate.js can check that every
 * spawn can reach every other. */

import { trace, ray, newTrace } from "./brush.js";
import { PM, newBody, pmove, TICK, fits } from "./movement.js";

const GRID = 2;
const TR = newTrace();
const HW = PM.halfWidth, HS = PM.standHeight / 2;

function sweepClear(W, a, b, lift) {
  trace(W, a.x, a.y + HS + lift, a.z, b.x, b.y + HS + lift, b.z, HW, HS, HW, TR);
  return TR.fraction === 1 && !TR.startsolid;
}
function groundBelow(W, x, y, z, depth) {
  ray(W, x, y + 0.4, z, x, y - depth, z, TR);
  return TR.fraction < 1 && TR.ny >= PM.walkable ? y + 0.4 - (0.4 + depth) * TR.fraction : null;
}

function insideXZ(poly, x, z) {
  // convex polygon, either winding
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const c = (b[0] - a[0]) * (z - a[2]) - (b[2] - a[2]) * (x - a[0]);
    if (Math.abs(c) < 1e-9) continue;
    const s = c > 0 ? 1 : -1;
    if (!sign) sign = s; else if (s !== sign) return false;
  }
  return true;
}

export function buildNav(W) {
  const nodes = [];
  const key = (x, z) => Math.round(x / GRID) * 100000 + Math.round(z / GRID);
  const cells = new Map();          // grid cell -> nodes (several levels share a cell)
  function add(x, y, z) {
    const k = key(x, z);
    const list = cells.get(k) || [];
    if (list.some((n) => Math.abs(n.y - y) < 1)) return;
    if (!fits(W, x, y + 0.03, z, false)) return;
    const n = { id: nodes.length, x, y, z, links: [], pad: null };
    nodes.push(n); list.push(n); cells.set(k, list);
  }
  // 1. sample every walkable top face
  for (const b of W.brushes) {
    if (b.nonsolid || b.kind === "clip") continue;
    for (const f of b.faces) {
      if (f.n[1] < PM.walkable) continue;
      const poly = f.idx.map((i) => b.verts[i]);
      const d = f.n[0] * poly[0][0] + f.n[1] * poly[0][1] + f.n[2] * poly[0][2];
      // A box standing on a slope rests on its uphill edge, not its centre.
      const lift = HW * (Math.abs(f.n[0]) + Math.abs(f.n[2])) / f.n[1];
      const hy = (x, z) => (d - f.n[0] * x - f.n[2] * z) / f.n[1] + lift;
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const v of poly) { x0 = Math.min(x0, v[0]); x1 = Math.max(x1, v[0]); z0 = Math.min(z0, v[2]); z1 = Math.max(z1, v[2]); }
      let any = false;
      for (let x = Math.ceil((x0 + 0.4) / GRID) * GRID; x <= x1 - 0.4; x += GRID)
        for (let z = Math.ceil((z0 + 0.4) / GRID) * GRID; z <= z1 - 0.4; z += GRID)
          if (insideXZ(poly, x, z)) { add(x, hy(x, z), z); any = true; }
      if (!any && x1 - x0 >= 0.8 && z1 - z0 >= 0.8) {
        const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
        if (insideXZ(poly, cx, cz)) add(cx, hy(cx, cz), cz);
      }
    }
  }
  const near = (n, r) => {
    const out = [], c = Math.ceil(r / GRID);
    const bx = Math.round(n.x / GRID), bz = Math.round(n.z / GRID);
    for (let i = -c; i <= c; i++) for (let j = -c; j <= c; j++) {
      const l = cells.get((bx + i) * 100000 + (bz + j));
      if (l) for (const m of l) if (m !== n) out.push(m);
    }
    return out;
  };
  const link = (a, b, kind, cost) => { if (!a.links.some((l) => l.to === b.id)) a.links.push({ to: b.id, kind, cost }); };

  // 2. walking between neighbours: the ground along the way may rise by a
  // step at a time and never fall away, and a standing box fits above it
  const ground = [];
  const walkable = (a, b, h) => {
    const top = Math.max(a.y, b.y), n = Math.max(2, Math.ceil(h / 0.8));
    let last = a.y;
    for (let i = 1; i <= n; i++) {
      const t = i / n, g = groundBelow(W, a.x + (b.x - a.x) * t, top + 0.6, a.z + (b.z - a.z) * t, top - Math.min(a.y, b.y) + 1.5);
      if (g === null || g - last > PM.stepsize + 0.05 || last - g > 0.6) return false;
      last = g; ground[i] = g;
    }
    return sweepClear(W, { x: a.x, y: top, z: a.z }, { x: b.x, y: top, z: b.z }, PM.stepsize + 0.05);
  };
  for (const a of nodes) {
    // 4.3 m, not just the grid's diagonal: samples are inset from each face's
    // edges, so two brushes that meet can leave their nearest nodes 4 m apart.
    for (const b of near(a, 4.3)) {
      const h = Math.hypot(b.x - a.x, b.z - a.z);
      if (h > 4.3 || Math.abs(b.y - a.y) > 0.45 + h * 0.7) continue;
      if (!walkable(a, b, h)) continue;
      link(a, b, "walk", Math.hypot(h, b.y - a.y));
    }
  }
  // 3. edges: jumps up, climbs, drops
  for (const a of nodes) {
    if (a.links.length >= 8) continue;        // not an edge of anything
    for (const b of near(a, 6)) {
      const h = Math.hypot(b.x - a.x, b.z - a.z), dy = b.y - a.y;
      if (a.links.some((l) => l.to === b.id)) continue;
      if (dy > 0.45 && dy <= 1.0 && h <= 3.2) {
        if (sweepClear(W, a, { x: a.x, y: b.y + 0.2, z: a.z }, 0.05) && sweepClear(W, { x: a.x, y: b.y + 0.2, z: a.z }, { x: b.x, y: b.y + 0.2, z: b.z }, 0)) link(a, b, "jump", h + 1.5);
      } else if (dy > 1.0 && dy <= 5.0 && h <= 3.0) {
        // a wall between us, room to climb it, and room on top
        trace(W, a.x, a.y + 1.1, a.z, b.x, a.y + 1.1, b.z, 0.15, 0.15, 0.15, TR);
        if (TR.fraction === 1 || Math.abs(TR.ny) > 0.35) continue;
        const up = { x: a.x, y: b.y + 0.3, z: a.z };
        if (sweepClear(W, a, up, 0.05) && sweepClear(W, up, { x: b.x, y: b.y + 0.3, z: b.z }, 0)) link(a, b, "climb", h + dy * 1.6);
      } else if (dy < -0.9 && dy > -14 && h <= 5.5) {
        const over = { x: b.x, y: a.y + 0.2, z: b.z };
        if (sweepClear(W, a, over, 0.05) && sweepClear(W, over, { x: b.x, y: b.y + 0.1, z: b.z }, 0)) link(a, b, "drop", h + 1);
      }
    }
  }
  // 4. jump pads: fly one, see where it lands
  for (const b of W.brushes) {
    if (b.kind !== "pad" || !b.push) continue;
    const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
    const body = newBody(cx, b.max[1] + 0.3, cz, 0);
    let flew = false, land = null;
    for (let i = 0; i < 64 * 5 && !land; i++) {
      pmove(W, body, { fwd: 0, side: 0, yaw: 0, pitch: 0, buttons: 0 }, TICK, {});
      if (body.ev.includes("pad")) flew = true;
      else if (flew && body.onGround) land = { x: body.x, y: body.y, z: body.z };
      body.ev.length = 0;
    }
    if (!land) continue;
    const to = closest(nodes, land.x, land.y, land.z, 3);
    if (!to) continue;
    for (const a of nodes) if (a.x >= b.min[0] - 0.5 && a.x <= b.max[0] + 0.5 && a.z >= b.min[2] - 0.5 && a.z <= b.max[2] + 0.5 && Math.abs(a.y - b.max[1]) < 0.5) { a.pad = to.id; link(a, to, "pad", 4); }
  }
  return { nodes, cells, key, near: (x, y, z, r) => closest(nodes, x, y, z, r, cells, key) };
}

function closest(nodes, x, y, z, r, cells, key) {
  let best = null, bd = Infinity;
  const consider = (n) => {
    const d = (n.x - x) ** 2 + ((n.y - y) * 2) ** 2 + (n.z - z) ** 2;
    if (d < bd) { bd = d; best = n; }
  };
  if (cells) {
    const c = Math.ceil((r || 4) / GRID), bx = Math.round(x / GRID), bz = Math.round(z / GRID);
    for (let i = -c; i <= c; i++) for (let j = -c; j <= c; j++) { const l = cells.get((bx + i) * 100000 + (bz + j)); if (l) l.forEach(consider); }
  } else nodes.forEach(consider);
  return bd <= (r || 4) ** 2 * 4 ? best : null;
}

/** The nearest node, searching wider if the first ring is empty. */
export function nearestNode(nav, x, y, z) {
  return nav.near(x, y, z, 3) || nav.near(x, y, z, 8) || closest(nav.nodes, x, y, z, 64);
}

/* ---------------------------------------------------------------
   A* with a binary heap
   --------------------------------------------------------------- */
export function findPath(nav, from, to) {
  if (!from || !to) return null;
  if (from === to) return [from.id];
  const N = nav.nodes;
  const g = new Map([[from.id, 0]]), came = new Map(), closed = new Set();
  const h = (n) => Math.hypot(n.x - to.x, n.y - to.y, n.z - to.z);
  const heap = [[h(from), from.id]];
  const push = (e) => { heap.push(e); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } }
    return top;
  };
  let steps = 0;
  while (heap.length && steps++ < 20000) {
    const [, id] = pop();
    if (id === to.id) {
      const out = [id];
      let c = id;
      while (came.has(c)) { c = came.get(c); out.push(c); }
      return out.reverse();
    }
    if (closed.has(id)) continue;
    closed.add(id);
    const gn = g.get(id);
    for (const l of N[id].links) {
      if (closed.has(l.to)) continue;
      const ng = gn + l.cost;
      if (ng < (g.has(l.to) ? g.get(l.to) : Infinity)) { g.set(l.to, ng); came.set(l.to, id); push([ng + h(N[l.to]), l.to]); }
    }
  }
  return null;
}

/** The kind of the link from node a to node b ("walk" if they are not linked). */
export function linkKind(nav, a, b) {
  const l = nav.nodes[a].links.find((x) => x.to === b);
  return l ? l.kind : "walk";
}
