/* terrain.js — the land, drawn: a quadtree of chunks, finer near the eye.
 *
 * Chunked level of detail, the proven way for terrain this big (Ulrich's
 * chunked LOD): the world is one square 16 km a side, cut into four, and
 * four again, eight times, down to 64 m squares with a vertex every metre.
 * Every chunk is the same 65 x 65 grid, so a far one is a few hundred
 * metres of mountain and a near one is the sastrugi under your boots. A
 * chunk is split when the eye is nearer it than its size times K (the
 * Graphics setting), and only once all four children are built, so the
 * land never has a hole in it; skirts hide the seams between levels.
 *
 * The chunks are meshed by workers (worker.js) from the same surface() the
 * feet walk on. The material is three's standard one with the snow taught
 * to it: wind-carved snow normals laid along the katabatic wind (ambientCG
 * Snow008A), soft snow where the wind has not carved it (Snow010A), the
 * big swells of an aerial snow field (Poly Haven), dark rock (Poly Haven's
 * dark_rock) mapped three ways so cliffs are not smeared, snow settling on
 * any ledge flat enough to hold it, blue ice on the sea, the cracks of the
 * glacier going down into blue-black, and a sparkle of single grains that
 * catch the sun — real specular glints, so they are gone in shadow. */

import * as THREE from "three";
import { unpack } from "./world.js";

const SEG = 64, N = SEG + 1, ROOT = 16384, LEAF = 64, MAXL = Math.round(Math.log2(ROOT / LEAF));
// split when nearer than K times a chunk's size: at 1.1 a triangle is about
// three-quarters of a degree across, a dozen pixels on a laptop's screen
const K = { low: 0.8, high: 1.1, ultra: 1.6 };
let quality = "high";
let scene = null, group = null, workers = [], ready = 0, W = null, onWorld = null, mat = null, depthMat = null;
const cache = new Map();         // key -> { mesh, lo, hi, used }
const pending = new Map();       // key -> worker index
const queue = [];
let index = null;
const U = {
  windDir: { value: new THREE.Vector2(0, 1) }, time: { value: 0 },
  snowN: { value: null }, softN: { value: null }, aerC: { value: null }, aerN: { value: null },
  rockC: { value: null }, rockN: { value: null }, rockA: { value: null }, iceC: { value: null }, detail: { value: 1 }
};

/* ------------------------------------------------------------------ */

export function init(sc, textures, lit) {
  scene = sc;
  group = new THREE.Group();
  group.name = "terrain";
  scene.add(group);
  for (const k in textures) setTexture(k, textures[k]);
  mat = material();
  if (lit) lit(mat);
  index = buildIndex();
  const n = Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
  for (let i = 0; i < n; i++) {
    const w = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
    w.onmessage = (e) => message(i, e.data);
    w.busy = 0;
    workers.push(w);
  }
}

/** A texture for one of the terrain's slots (snowN, softN, aerC, aerN, rockC, rockN, rockA, iceC). */
export function setTexture(k, t) { if (U[k]) U[k].value = t; }

let progressFn = null;
/** Make the world from a seed (in the first worker): resolves with it, ready to mesh. */
export function build(seed, progress) {
  progressFn = progress;
  // a new world: the old one's chunks go
  for (const c of cache.values()) { group.remove(c.mesh); c.mesh.geometry.dispose(); }
  cache.clear(); pending.clear(); queue.length = 0; lastShown = new Set(); W = null;
  return new Promise((resolve) => {
    onWorld = resolve;
    workers[0].postMessage({ type: "build", seed });
  });
}

function message(i, m) {
  const w = workers[i];
  if (m.type === "progress") { if (progressFn) progressFn(m.stage, m.f); return; }
  if (m.type === "built") {
    W = unpack(m.world);
    U.windDir.value.set(W.wind.x, W.wind.z);
    // the others get the world too (copies: the page keeps its own)
    for (let k = 1; k < workers.length; k++) {
      const c = Object.assign({}, m.world);
      for (const f of ["H", "ROCK", "GL", "SEA", "KEEP", "coast", "GX"]) c[f] = m.world[f].slice();
      workers[k].postMessage({ type: "world", world: c }, ["H", "ROCK", "GL", "SEA", "KEEP", "coast", "GX"].map((f) => c[f].buffer));
    }
    for (const w of workers) w.busy = 0;
    ready = workers.length;
    if (onWorld) { const f = onWorld; onWorld = null; f(W); }
    return;
  }
  if (m.type === "chunk") {
    w.busy--;
    pending.delete(m.key);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(m.pos, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(m.nrm, 3, true));
    g.setAttribute("aSurf", new THREE.BufferAttribute(m.surf, 4, true));
    g.setIndex(index);
    const size = parseFloat(m.key.split(":")[3]);
    g.boundingBox = new THREE.Box3(new THREE.Vector3(-size / 2, m.lo, -size / 2), new THREE.Vector3(size / 2, m.hi, size / 2));
    g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
    const mesh = new THREE.Mesh(g, mat);
    mesh.position.set(m.cx, 0, m.cz);
    mesh.updateMatrixWorld();
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.customDepthMaterial = depthMat;
    mesh.visible = false;
    group.add(mesh);
    cache.set(m.key, { mesh, lo: m.lo, hi: m.hi, used: performance.now() });
    pump();
  }
}

export const world = () => W;
export const isReady = () => !!W;

/* The index of one chunk: the grid, then its skirts, both faces. */
function buildIndex() {
  const ix = [];
  for (let j = 0; j < SEG; j++) for (let i = 0; i < SEG; i++) {
    const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
    ix.push(a, c, b, b, c, d);
  }
  const base = N * N;
  const edge = (k) => [k * N, (k + 1) * N];
  // edges as built by the worker: bottom, top, left, right
  const rows = [[], [], [], []];
  for (let i = 0; i < N; i++) { rows[0].push(i); rows[1].push((N - 1) * N + i); rows[2].push(i * N); rows[3].push(i * N + N - 1); }
  for (let e = 0; e < 4; e++) for (let i = 0; i < SEG; i++) {
    const t0 = rows[e][i], t1 = rows[e][i + 1], s0 = base + e * N + i, s1 = s0 + 1;
    ix.push(t0, s0, t1, t1, s0, s1, t0, t1, s0, t1, s1, s0);
  }
  void edge;
  return new THREE.Uint16BufferAttribute(ix, 1);
}

/* ------------------------------------------------------------------ */
/* Which chunks                                                       */

const key = (l, x0, z0, size) => l + ":" + x0 + ":" + z0 + ":" + size;
const want = [];
const shown = new Set();
let lastShown = new Set();

export function update(eye, groundY) {
  if (!W) return;
  const k = K[quality] || K.high;
  want.length = 0;
  shown.clear();
  const ax = eye.x, az = eye.z, ay = eye.y;
  const visit = (l, x0, z0, size) => {
    const id = key(l, x0, z0, size);
    const c = cache.get(id);
    // nearest point of the square, and height above its lowest ground
    const dx = Math.max(x0 - ax, 0, ax - (x0 + size)), dz = Math.max(z0 - az, 0, az - (z0 + size));
    const dy = c ? Math.max(0, ay - c.hi, c.lo - ay) : Math.max(0, ay - groundY);
    const d = Math.hypot(dx, dz, dy * 0.7);
    if (l < MAXL && d < size * k) {
      const h = size / 2;
      const kids = [[x0, z0], [x0 + h, z0], [x0, z0 + h], [x0 + h, z0 + h]];
      const ok = kids.every(([cx, cz]) => cache.has(key(l + 1, cx, cz, h)));
      if (ok) { for (const [cx, cz] of kids) visit(l + 1, cx, cz, h); return; }
      for (const [cx, cz] of kids) { const kk = key(l + 1, cx, cz, h); if (!cache.has(kk)) want.push({ key: kk, l: l + 1, x0: cx, z0: cz, size: h, d }); }
    }
    if (c) { shown.add(id); c.used = performance.now(); }
    else want.push({ key: id, l, x0, z0, size, d: -1 });
  };
  visit(0, -ROOT / 2, -ROOT / 2, ROOT);
  for (const id of lastShown) if (!shown.has(id)) { const c = cache.get(id); if (c) c.mesh.visible = false; }
  for (const id of shown) cache.get(id).mesh.visible = true;
  lastShown = new Set(shown);
  // coarse first, then nearest
  want.sort((a, b) => a.l - b.l || a.d - b.d);
  queue.length = 0;
  for (const w of want) if (!pending.has(w.key)) queue.push(w);
  pump();
  evict();
}

function pump() {
  if (!ready) return;
  while (queue.length) {
    let wi = -1, low = 3;
    for (let i = 0; i < workers.length; i++) if (workers[i].busy < low) { low = workers[i].busy; wi = i; }
    if (wi < 0) return;
    const q = queue.shift();
    if (pending.has(q.key) || cache.has(q.key)) continue;
    pending.set(q.key, wi);
    workers[wi].busy++;
    workers[wi].postMessage({ type: "chunk", key: q.key, x0: q.x0, z0: q.z0, size: q.size });
  }
}

/* Let go of chunks not drawn for a while once there are too many. */
function evict() {
  const cap = quality === "ultra" ? 1400 : quality === "low" ? 500 : 900;
  if (cache.size <= cap) return;
  const now = performance.now();
  const old = [...cache.entries()].filter(([id, c]) => !shown.has(id) && now - c.used > 8000 && id.split(":")[0] !== "0").sort((a, b) => a[1].used - b[1].used);
  for (let i = 0; i < old.length && cache.size > cap; i++) {
    const [id, c] = old[i];
    group.remove(c.mesh);
    c.mesh.geometry.dispose();
    cache.delete(id);
  }
}

/** Loading: how much of the land round the eye is in. */
export function coverage() {
  let n = 0;
  for (const id of shown) if (+id.split(":")[0] >= MAXL - 2) n++;
  return { shown: shown.size, fine: n, pending: pending.size, queued: queue.length, cached: cache.size };
}

export function setQuality(q) { quality = q; U.detail.value = q === "low" ? 0.6 : 1; if (mat) { mat.defines.TERRAIN_HQ = q === "low" ? 0 : 1; mat.needsUpdate = true; } }
export function tick(t) { U.time.value = t; }
export const meshes = () => group;
export const terrainMaterial = () => mat;

/* ------------------------------------------------------------------ */
/* The snow                                                           */

const VERT_PARS = `
attribute vec4 aSurf;
varying vec4 vSurf;
varying vec3 vW;
`;
const VERT_MAIN = `
vSurf = aSurf;
vW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
`;
const FRAG_PARS = `
uniform sampler2D snowN, softN, aerC, aerN, rockC, rockN, rockA, iceC;
uniform vec2 windDir;
uniform float detail;
varying vec4 vSurf;
varying vec3 vW;
float hash12( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }
float vnoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( hash12( i ), hash12( i + vec2( 1.0, 0.0 ) ), f.x ), mix( hash12( i + vec2( 0.0, 1.0 ) ), hash12( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
// a detail normal laid along a direction: its u runs along dirU
vec3 alongN( sampler2D tex, vec2 p, vec2 dirU, float scale, float k ) {
  vec2 dirV = vec2( dirU.y, - dirU.x );
  vec2 uv = vec2( dot( p, dirU ), dot( p, dirV ) ) / scale;
  vec3 t = texture2D( tex, uv ).xyz * 2.0 - 1.0;
  return ( vec3( dirU.x, 0.0, dirU.y ) * t.x + vec3( dirV.x, 0.0, dirV.y ) * t.y ) * k;
}
// rock, three ways, weighted by which way the face looks
vec3 triW( vec3 n ) { vec3 w = pow( abs( n ), vec3( 4.0 ) ); return w / ( w.x + w.y + w.z ); }
vec3 triC( sampler2D t, vec3 p, vec3 w, float s ) {
  return texture2D( t, p.zy / s ).rgb * w.x + texture2D( t, p.xz / s ).rgb * w.y + texture2D( t, p.xy / s ).rgb * w.z;
}
vec3 triN( sampler2D t, vec3 p, vec3 w, vec3 n, float s ) {
  vec3 a = texture2D( t, p.zy / s ).xyz * 2.0 - 1.0, b = texture2D( t, vec2( p.x, - p.z ) / s ).xyz * 2.0 - 1.0, c = texture2D( t, p.xy / s ).xyz * 2.0 - 1.0;
  return vec3( 0.0, a.y, a.x * sign( n.x ) ) * w.x + vec3( b.x, 0.0, - b.y ) * w.y + vec3( c.x * sign( n.z ), c.y, 0.0 ) * w.z;
}
float tRock, tIce, tCrev, tSnow, tSpark, tRough;
vec3 tN;
`;
/* Everything the surface is, worked out once (before the colour is needed)
   and used by the colour, the roughness and the normal. */
const FRAG_SURFACE = `
{
  vec3 gN = normalize( ( vec4( normalize( vNormal ), 0.0 ) * viewMatrix ).xyz );
  float dist = length( vW - cameraPosition );
  float near = smoothstep( 140.0, 12.0, dist ) * detail;
  float mid = smoothstep( 1600.0, 200.0, dist );
  vec3 rw = triW( gN );
  // stone shows where the world says it does, less where a ledge is flat enough to hold snow
  tRock = vSurf.x * ( 1.0 - 0.75 * smoothstep( 0.72, 0.93, gN.y ) );
  tCrev = vSurf.z;
  float seaIce = vSurf.y;
  // blue ice: wind-scoured patches on the sea ice
  float scour = smoothstep( 0.6, 0.78, vnoise( vW.xz / 55.0 ) * 0.7 + vnoise( vW.xz / 13.0 ) * 0.3 );
  tIce = seaIce * scour * 0.8;
  tSnow = 1.0 - max( tRock, tIce );
  // the normal: wind-carved snow along the wind, soft snow across it, the
  // field's swells at a distance, and the stone's own faces
  vec3 n = gN;
  float sas = vSurf.w;
  n += alongN( snowN, vW.xz, windDir, 6.5, ( 0.5 + 0.9 * sas ) * near ) * tSnow;
  n += alongN( softN, vW.xz, vec2( 0.8, 0.6 ), 3.2, 0.45 * near * ( 1.0 - sas ) ) * tSnow;
  n += alongN( aerN, vW.xz, windDir, 70.0, 0.6 * mid ) * ( 1.0 - tRock );
  n += triN( rockN, vW, rw, gN, 7.0 ) * tRock * ( 0.4 + 0.8 * near );
  // single grains of snow, turned to catch the light
  vec2 cell = floor( vW.xz * 34.0 );
  float h = hash12( cell );
  tSpark = step( 0.988, h ) * smoothstep( 24.0, 3.0, dist ) * tSnow * detail;
  // tilted a little, never away from the sky, so a grain only ever adds a glint
  n += ( vec3( hash12( cell + 7.1 ), 0.0, hash12( cell + 3.3 ) ) - vec3( 0.5, 0.0, 0.5 ) ) * tSpark * 0.5;
  tN = normalize( n );
  tRough = mix( 0.82, 0.55, sas ) ;
}
`;
const FRAG_MAP = `
{
  vec3 rw = triW( tN );
  vec3 snowC = vec3( 0.88, 0.91, 0.96 );
  // the snow field's own variation, faint: older snow, wind crust
  float v = texture2D( aerC, vW.xz / 320.0 ).r;
  snowC *= 0.92 + 0.16 * v;
  // scoured sea ice: blue-white, its cracks and bubbles showing through
  vec3 iceC2 = mix( vec3( 0.6, 0.76, 0.9 ), texture2D( iceC, vW.xz / 9.0 ).rgb * vec3( 0.8, 1.05, 1.3 ), 0.45 );
  vec3 rockCol = triC( rockC, vW, rw, 7.0 ) * 1.25;
  vec3 col = mix( snowC, iceC2, tIce );
  col = mix( col, rockCol, tRock );
  // a crack: the walls go blue, then black
  col = mix( col, vec3( 0.02, 0.07, 0.13 ), tCrev );
  diffuseColor.rgb *= col;
}
`;
const FRAG_ROUGH = `
float roughnessFactor = roughness;
{
  vec3 rw = triW( tN );
  float rr = ( texture2D( rockA, vW.zy / 7.0 ).g * rw.x + texture2D( rockA, vW.xz / 7.0 ).g * rw.y + texture2D( rockA, vW.xy / 7.0 ).g * rw.z );
  roughnessFactor = mix( tRough, 0.12, tIce );
  roughnessFactor = mix( roughnessFactor, rr, tRock );
  roughnessFactor = mix( roughnessFactor, 0.05, tSpark );
  roughnessFactor = mix( roughnessFactor, 0.9, tCrev );
}
`;
const FRAG_NORMAL = `
normal = normalize( ( viewMatrix * vec4( tN, 0.0 ) ).xyz );
`;

function material() {
  const m = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.8, metalness: 0 });
  m.defines = { TERRAIN_HQ: 1 };
  m.userData.patch = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = VERT_PARS + sh.vertexShader.replace("#include <project_vertex>", "#include <project_vertex>\n" + VERT_MAIN);
    sh.fragmentShader = FRAG_PARS + sh.fragmentShader
      .replace("#include <map_fragment>", FRAG_SURFACE + FRAG_MAP)
      .replace("#include <roughnessmap_fragment>", FRAG_ROUGH)
      .replace("#include <normal_fragment_maps>", FRAG_NORMAL);
  };
  m.userData.patchKey = "terrain";
  m.onBeforeCompile = m.userData.patch;
  m.customProgramCacheKey = () => "terrain";
  depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  return m;
}

/** For tools/: the cache, to count. */
export const _debug = () => ({ cache, pending, queue, workers });
