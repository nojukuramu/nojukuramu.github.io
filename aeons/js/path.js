/* path.js — A* over tiles, in a window that travels with the search.
 *
 * The map has no size, so the search cannot have a grid the size of the map.
 * It gets a fixed window of WIN x WIN tiles placed over the start and the
 * goal, typed arrays reused between searches, and a stamp per cell instead of
 * clearing them. A goal further away than the window allows is approached in
 * legs: the path to the edge of the window comes back marked `partial`, and
 * the unit asks again when it gets there.
 *
 * The result is string-pulled — waypoints that can see each other skip the
 * ones between — so units walk in straight lines across open ground instead
 * of in the staircase a grid search draws. */

const WIN = 192, CELLS = WIN * WIN, REACH = 84;
const g = new Float32Array(CELLS), f = new Float32Array(CELLS), par = new Int32Array(CELLS);
const seen = new Uint32Array(CELLS), shut = new Uint32Array(CELLS), pst = new Uint32Array(CELLS);
const pv = new Uint8Array(CELLS);
const heap = new Int32Array(CELLS);
let stamp = 0, hn = 0;
const SQ2 = Math.SQRT2;
const DX = [-1, 0, 1, -1, 1, -1, 0, 1], DY = [-1, -1, -1, 0, 0, 1, 1, 1];

function push(i) {
  let k = hn++; heap[k] = i;
  while (k > 0) { const p = (k - 1) >> 1; if (f[heap[p]] <= f[i]) break; heap[k] = heap[p]; k = p; }
  heap[k] = i;
}
function pop() {
  const top = heap[0], last = heap[--hn];
  let k = 0;
  if (hn > 0) {
    for (;;) {
      let c = 2 * k + 1; if (c >= hn) break;
      if (c + 1 < hn && f[heap[c + 1]] < f[heap[c]]) c++;
      if (f[heap[c]] >= f[last]) break;
      heap[k] = heap[c]; k = c;
    }
    heap[k] = last;
  }
  return top;
}

/**
 * world: World; (sx, sy): start tile; goal: { tx, ty } or { rect: { tx, ty, w, h } } (stand next to it)
 * or { near: { tx, ty }, r } (anywhere within r tiles). move: "land" | "naval".
 * Returns { path: [{tx, ty}...], partial, reached } — never null; an unreachable goal gets the
 * closest place the search found.
 */
export function findPath(world, sx, sy, goal, move, maxNodes) {
  stamp++;
  if (stamp > 0xfffffff0) { stamp = 1; seen.fill(0); shut.fill(0); pst.fill(0); }
  maxNodes = maxNodes || 5000;
  let gx, gy, rect = goal.rect || null, nearR = goal.near ? goal.r || 1 : 0;
  if (rect) { gx = rect.tx + rect.w / 2 - 0.5; gy = rect.ty + rect.h / 2 - 0.5; }
  else if (goal.near) { gx = goal.near.tx; gy = goal.near.ty; }
  else { gx = goal.tx; gy = goal.ty; }

  // too far for one window: aim at a waypoint on the way, and say so
  let partial = false, ax = gx, ay = gy;
  const dx = gx - sx, dy = gy - sy, dist = Math.hypot(dx, dy);
  if (dist > REACH) { ax = Math.round(sx + dx / dist * REACH); ay = Math.round(sy + dy / dist * REACH); partial = true; rect = null; nearR = 6; }
  const ox = Math.round((sx + ax) / 2) - (WIN >> 1), oy = Math.round((sy + ay) / 2) - (WIN >> 1);

  const open = (x, y) => {
    const lx = x - ox, ly = y - oy;
    if (lx < 0 || ly < 0 || lx >= WIN || ly >= WIN) return false;
    const i = ly * WIN + lx;
    if (pst[i] !== stamp) { pst[i] = stamp; pv[i] = world.passable(x, y, move) ? 1 : 0; }
    return pv[i] === 1;
  };
  const hdist = (x, y) => {
    let tx = ax, ty = ay;
    if (rect) { tx = Math.max(rect.tx, Math.min(rect.tx + rect.w - 1, x)); ty = Math.max(rect.ty, Math.min(rect.ty + rect.h - 1, y)); }
    const ddx = Math.abs(x - tx), ddy = Math.abs(y - ty);
    return Math.max(ddx, ddy) + (SQ2 - 1) * Math.min(ddx, ddy);
  };
  const isGoal = (x, y) => {
    if (rect) return x >= rect.tx - 1 && y >= rect.ty - 1 && x <= rect.tx + rect.w && y <= rect.ty + rect.h;
    if (nearR) return Math.hypot(x - ax, y - ay) <= nearR;
    return x === ax && y === ay;
  };

  const si = (sy - oy) * WIN + (sx - ox);
  hn = 0;
  g[si] = 0; f[si] = hdist(sx, sy); par[si] = -1; seen[si] = stamp; push(si);
  let best = si, bestH = f[si], found = -1, n = 0;
  while (hn > 0 && n < maxNodes) {
    const cur = pop();
    if (shut[cur] === stamp) continue;
    shut[cur] = stamp; n++;
    const cx = (cur % WIN) + ox, cy = ((cur / WIN) | 0) + oy;
    if (isGoal(cx, cy)) { found = cur; break; }
    const h = f[cur] - g[cur];
    if (h < bestH) { bestH = h; best = cur; }
    for (let d = 0; d < 8; d++) {
      const ddx = DX[d], ddy = DY[d];
      const nx = cx + ddx, ny = cy + ddy;
      if (!open(nx, ny)) continue;
      const diag = ddx !== 0 && ddy !== 0;
      if (diag && (!open(cx + ddx, cy) || !open(cx, cy + ddy))) continue;   // no cutting corners
      const ni = (ny - oy) * WIN + (nx - ox);
      if (shut[ni] === stamp) continue;
      const ng = g[cur] + (diag ? SQ2 : 1);
      if (seen[ni] === stamp && ng >= g[ni]) continue;
      seen[ni] = stamp; g[ni] = ng; f[ni] = ng + hdist(nx, ny); par[ni] = cur;
      push(ni);
    }
  }
  const end = found >= 0 ? found : best;
  const raw = [];
  for (let i = end; i !== -1 && i !== si; i = par[i]) raw.push({ tx: (i % WIN) + ox, ty: ((i / WIN) | 0) + oy });
  raw.reverse();
  return { path: smooth(sx, sy, raw, open), partial, reached: found >= 0 && !partial };
}

/** Drop every waypoint the one before it can already see. */
function smooth(sx, sy, raw, open) {
  if (raw.length < 3) return raw;
  const out = [];
  let ax = sx, ay = sy, i = 0;
  while (i < raw.length) {
    let j = raw.length - 1;
    for (; j > i; j--) if (sight(ax, ay, raw[j].tx, raw[j].ty, open)) break;
    out.push(raw[j]);
    ax = raw[j].tx; ay = raw[j].ty; i = j + 1;
  }
  return out;
}
/** Every tile a straight walk between two tile centres would touch, all open. */
export function sight(x0, y0, x1, y1, open) {
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = x1 > x0 ? 1 : -1, sy = y1 > y0 ? 1 : -1;
  let x = x0, y = y0, n = 1 + dx + dy, err = dx - dy;
  const ddx = dx * 2, ddy = dy * 2;
  for (; n > 0; n--) {
    if (!open(x, y)) return false;
    if (err > 0) { x += sx; err -= ddy; } else if (err < 0) { y += sy; err += ddx; } else { // exactly through a corner: both sides must be open
      if (!open(x + sx, y) || !open(x, y + sy)) return false;
      x += sx; y += sy; err += ddx - ddy; n--;
    }
  }
  return true;
}
