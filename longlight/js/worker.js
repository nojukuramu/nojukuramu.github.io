/* worker.js — builds the world and meshes it, off the page's thread.
 *
 * Two jobs. "build": make the world from a seed (world.js, erosion and all)
 * and send it back. "chunk": one square of terrain at one level of detail —
 * a 65 x 65 grid of heights from the same surface() the feet walk on, its
 * normals from the grid's own differences, what each vertex is made of
 * (stone, sea ice, a crack, sastrugi) and a skirt round the edge that hides
 * the seams between levels. Everything comes back as transferable arrays. */

import { buildWorld, unpack, pack, surface, HALF } from "./world.js";

let W = null;
const SEG = 64;

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === "build") {
    const w = buildWorld(m.seed, (stage, f) => self.postMessage({ type: "progress", stage, f }));
    const P = pack(w);
    W = w;
    // the page gets copies; this worker keeps its own
    const copy = Object.assign({}, P);
    const trans = [];
    for (const k of ["H", "ROCK", "GL", "SEA", "KEEP", "coast", "GX"]) { copy[k] = P[k].slice(); trans.push(copy[k].buffer); }
    self.postMessage({ type: "built", world: copy }, trans);
  } else if (m.type === "world") {
    W = unpack(m.world);
  } else if (m.type === "chunk") {
    if (!W) return;
    const out = chunk(m.x0, m.z0, m.size);
    out.type = "chunk"; out.key = m.key;
    self.postMessage(out, [out.pos.buffer, out.nrm.buffer, out.surf.buffer]);
  }
};

const s = {};
/* One chunk: its square is [x0, x0+size] x [z0, z0+size]. */
function chunk(x0, z0, size) {
  const n = SEG + 1, step = size / SEG;
  // heights with a one-vertex border, for normals that agree across chunk edges
  const G = n + 2, hs = new Float32Array(G * G), sf = new Uint8Array(n * n * 4);
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    const x = x0 + (i - 1) * step, z = z0 + (j - 1) * step;
    surface(W, x, z, s);
    let h = s.h;
    // beyond the edge of the world: the sea to the north, the plateau to the south
    const ex = Math.max(0, Math.abs(x) - HALF), ez = Math.max(0, Math.abs(z) - HALF), e = Math.max(ex, ez);
    if (e > 0) {
      const far = z < -HALF ? -20 : h;
      h = h + (far - h) * Math.min(1, e / 600);
    }
    hs[j * G + i] = h;
    if (i >= 1 && j >= 1 && i <= n && j <= n) {
      const k = ((j - 1) * n + (i - 1)) * 4;
      sf[k] = Math.round(Math.min(1, s.rock) * 255);
      sf[k + 1] = Math.round(Math.min(1, s.seaIce + s.berg * 0.6) * 255);
      sf[k + 2] = Math.round(Math.min(1, s.crevasse) * 255);
      sf[k + 3] = Math.round(Math.min(1, s.sastrugi * 1.6) * 255);
    }
  }
  // the grid, then a skirt: each edge vertex again, dropped down
  const drop = step * 2 + 2;
  const nv = n * n + 4 * n;
  const pos = new Float32Array(nv * 3), nrm = new Int8Array(nv * 3), surf = new Uint8Array(nv * 4);
  const cx = x0 + size / 2, cz = z0 + size / 2;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const v = j * n + i, h = hs[(j + 1) * G + i + 1];
    pos[v * 3] = x0 + i * step - cx; pos[v * 3 + 1] = h; pos[v * 3 + 2] = z0 + j * step - cz;
    const hl = hs[(j + 1) * G + i], hr = hs[(j + 1) * G + i + 2], hd = hs[j * G + i + 1], hu = hs[(j + 2) * G + i + 1];
    let nx = hl - hr, ny = 2 * step, nz = hd - hu;
    const l = Math.hypot(nx, ny, nz);
    nrm[v * 3] = Math.round((nx / l) * 127); nrm[v * 3 + 1] = Math.round((ny / l) * 127); nrm[v * 3 + 2] = Math.round((nz / l) * 127);
    surf.set(sf.subarray(v * 4, v * 4 + 4), v * 4);
  }
  // skirt vertices: edges in order bottom (j=0), top (j=n-1), left (i=0), right (i=n-1)
  let v = n * n;
  const edges = [];
  for (let i = 0; i < n; i++) edges.push(i);                       // j = 0
  for (let i = 0; i < n; i++) edges.push((n - 1) * n + i);         // j = n-1
  for (let j = 0; j < n; j++) edges.push(j * n);                   // i = 0
  for (let j = 0; j < n; j++) edges.push(j * n + n - 1);           // i = n-1
  for (const src of edges) {
    pos[v * 3] = pos[src * 3]; pos[v * 3 + 1] = pos[src * 3 + 1] - drop; pos[v * 3 + 2] = pos[src * 3 + 2];
    nrm[v * 3] = nrm[src * 3]; nrm[v * 3 + 1] = nrm[src * 3 + 1]; nrm[v * 3 + 2] = nrm[src * 3 + 2];
    surf.set(surf.subarray(src * 4, src * 4 + 4), v * 4);
    v++;
  }
  // the lowest and highest point, for culling
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < n * n; k++) { const h = pos[k * 3 + 1]; if (h < lo) lo = h; if (h > hi) hi = h; }
  return { pos, nrm, surf, cx, cz, lo: lo - drop, hi };
}

void pack;
