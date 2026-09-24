/* world.js — one floor of the tower: a floating island, and what grows on it.
 *
 * The first version's floors were flat squares boxed in by walls, with props
 * scattered at random and none of them solid. Here each floor is an island
 * hanging in the tower's dark, with a coastline you can see the drop past,
 * and its trees, rocks and crystals are solid: they stop you, they stop the
 * enemies, and they stop shots from both sides. Cover is a tactic now.
 *
 * Props grow in clumps rather than evenly, so a floor has groves to duck
 * into and clearings to fight in, and dirt paths wear in between the places
 * you are meant to go — the start, the objectives, the portal.
 *
 * Everything is generated from a seed. Rebuilding a floor from the same seed
 * gives the same island, which is what "retry this floor" relies on. */

import * as THREE from "three";
import { mergeGeometries } from "../vendor/examples/jsm/utils/BufferGeometryUtils.js";
import { TAU, clamp, lerp, dist, mulberry32, valueNoise, fbm } from "./util.js";
import { instancedModel, modelInstance, hasModel, std, glowMat, TEXTURES } from "./models.js";
import * as fx from "./fx.js";

/* ---------------------------------------------------------------
   Shared procedural prop geometry (built once, reused every floor)
   --------------------------------------------------------------- */
let PROPS = null;
function propGeos() {
  if (PROPS) return PROPS;
  const blob = (r, x, y, z) => new THREE.IcosahedronGeometry(r, 0).translate(x, y, z);
  const strip = (g) => { g.deleteAttribute("uv"); return g.index ? g.toNonIndexed() : g; };
  PROPS = {
    trunk: strip(new THREE.CylinderGeometry(0.12, 0.2, 1.4, 6).translate(0, 0.7, 0)),
    canopy: mergeGeometries([blob(0.9, 0, 1.9, 0), blob(0.7, 0.55, 1.6, 0.2), blob(0.65, -0.45, 1.7, -0.3), blob(0.55, 0.1, 2.45, 0.1)].map(strip)),
    crystal: mergeGeometries([
      new THREE.CylinderGeometry(0, 0.28, 1.6, 5).translate(0, 0.8, 0),
      new THREE.CylinderGeometry(0, 0.2, 1.1, 5).rotateZ(0.35).translate(0.28, 0.5, 0.05),
      new THREE.CylinderGeometry(0, 0.18, 0.9, 5).rotateZ(-0.4).rotateY(1.2).translate(-0.22, 0.42, -0.12)
    ].map(strip)),
    deadTree: mergeGeometries([
      new THREE.CylinderGeometry(0.07, 0.18, 2.4, 5).translate(0, 1.2, 0),
      new THREE.CylinderGeometry(0.03, 0.08, 1.1, 4).translate(0, 0.55, 0).rotateZ(0.8).translate(0, 1.4, 0),
      new THREE.CylinderGeometry(0.03, 0.07, 0.9, 4).translate(0, 0.45, 0).rotateZ(-0.9).translate(0, 1.8, 0),
      new THREE.CylinderGeometry(0.02, 0.05, 0.7, 4).translate(0, 0.35, 0).rotateX(0.9).translate(0, 2.0, 0)
    ].map(strip)),
    column: mergeGeometries([
      new THREE.CylinderGeometry(0.42, 0.42, 2.6, 8).translate(0, 1.5, 0),
      new THREE.BoxGeometry(1.05, 0.22, 1.05).translate(0, 0.11, 0),
      new THREE.BoxGeometry(0.95, 0.18, 0.95).translate(0, 2.88, 0)
    ].map(strip)),
    spike: mergeGeometries([
      new THREE.ConeGeometry(0.3, 1.9, 5).translate(0, 0.95, 0),
      new THREE.ConeGeometry(0.2, 1.2, 5).rotateZ(0.3).translate(0.3, 0.55, 0.1),
      new THREE.ConeGeometry(0.18, 1.0, 5).rotateZ(-0.35).translate(-0.28, 0.5, -0.1)
    ].map(strip)),
    tuft: (() => {
      const pos = [];
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU + 0.3, r = 0.12, h = 0.35 + (i % 2) * 0.12;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        pos.push(x - 0.04, 0, z, x + 0.04, 0, z, x * 1.6, h, z * 1.6);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.computeVertexNormals();
      return g;
    })(),
    flower: mergeGeometries([
      new THREE.CylinderGeometry(0.015, 0.015, 0.3, 3).translate(0, 0.15, 0),
      new THREE.IcosahedronGeometry(0.07, 0).translate(0, 0.32, 0)
    ].map(strip)),
    cube: new THREE.BoxGeometry(1, 1, 1)
  };
  return PROPS;
}

function instancedGeo(g, mat, list, shadow) {
  if (!list.length) return null;
  const im = new THREE.InstancedMesh(g, mat, list.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const e = new THREE.Euler();
  list.forEach((it, i) => {
    e.set(it.tx || 0, it.rot || 0, it.tz || 0);
    q.setFromEuler(e);
    p.set(it.x, it.y || 0, it.z);
    s.set(it.s, it.sy || it.s, it.s);
    m.compose(p, q, s);
    im.setMatrixAt(i, m);
    if (it.color !== undefined) im.setColorAt(i, new THREE.Color(it.color));
  });
  im.instanceMatrix.needsUpdate = true;
  im.castShadow = shadow !== false; im.receiveShadow = true;
  im.computeBoundingSphere();
  return im;
}

/* ---------------------------------------------------------------
   Layout
   --------------------------------------------------------------- */
const TABLE = 256;

export function buildWorld(opts) {
  const { floor, seed, kind, theme: T } = opts;
  const rng = mulberry32(seed);
  const noise = valueNoise(seed & 0xffff);
  const sandbox = kind === "sandbox";
  const R = sandbox ? 24 : clamp(29 + floor * 1.4, 29, 44);

  /* coastline: a wobbly ellipse, never so wobbly that it pinches shut */
  const k = [rng() * TAU, rng() * TAU, rng() * TAU, rng() * TAU];
  const radii = new Float32Array(TABLE);
  for (let i = 0; i < TABLE; i++) {
    const a = i / TABLE * TAU;
    radii[i] = R * (1 + 0.09 * Math.sin(2 * a + k[0]) + 0.06 * Math.sin(3 * a + k[1]) + 0.035 * Math.sin(5 * a + k[2]) + 0.02 * Math.sin(9 * a + k[3]));
  }
  function radiusAt(a) {
    let u = (a / TAU) % 1; if (u < 0) u += 1;
    const f = u * TABLE, i = Math.floor(f) % TABLE, j = (i + 1) % TABLE;
    return lerp(radii[i], radii[j], f - Math.floor(f));
  }
  const inside = (x, z, m) => Math.hypot(x, z) < radiusAt(Math.atan2(z, x)) - (m || 0);
  const polar = (a, t) => { const r = radiusAt(a) * t; return { x: Math.cos(a) * r, z: Math.sin(a) * r }; };

  const spawnA = rng() * TAU;
  const spawn = polar(spawnA, sandbox ? 0.25 : 0.8);
  const portalA = spawnA + Math.PI + (rng() - 0.5) * 0.6;
  const portal = sandbox ? null : polar(portalA, 0.74);
  let arena = null;
  if (kind === "warden" || kind === "heart") {
    const c = polar(portalA, 0.3);
    arena = { x: c.x, z: c.z, r: kind === "heart" ? 13 : 11.5 };
  }

  const reserved = [];     // {x, z, r}: keep props out
  const reserve = (p, r) => { if (p) reserved.push({ x: p.x, z: p.z, r }); };
  reserve(spawn, 7);
  reserve(portal, 5.5);
  if (arena) reserve(arena, arena.r + 1.5);
  const free = (x, z, r) => inside(x, z, r + 1.5) && reserved.every((q) => dist(x, z, q.x, q.z) > q.r + r);

  function findSpot(r, tries, test) {
    for (let t = 0; t < (tries || 80); t++) {
      const a = rng() * TAU, u = Math.sqrt(rng()) * 0.9;
      const p = polar(a, u);
      if (free(p.x, p.z, r) && (!test || test(p))) return p;
    }
    return null;
  }

  const anchors = [];
  if (kind === "anchors") {
    for (let i = 0; i < 3; i++) {
      const p = findSpot(3, 200, (q) => dist(q.x, q.z, spawn.x, spawn.z) > R * 0.55 &&
        anchors.every((o) => dist(q.x, q.z, o.x, o.z) > R * 0.6));
      const fallback = polar(portalA + (i - 1) * 1.3, 0.55);
      const pp = p || fallback;
      anchors.push(pp); reserve(pp, 5);
    }
  }
  const shrines = [];
  if (!sandbox) for (let i = 0; i < (floor % 2 === 1 ? 2 : 1); i++) { const p = findSpot(2.5, 120, (q) => dist(q.x, q.z, spawn.x, spawn.z) > 12); if (p) { shrines.push(p); reserve(p, 3.5); } }
  const chests = [];
  if (!sandbox) for (let i = 0; i < 2 + (rng() < 0.5 ? 1 : 0); i++) { const p = findSpot(1.5, 120, (q) => dist(q.x, q.z, spawn.x, spawn.z) > 10); if (p) { chests.push(p); reserve(p, 2.5); } }
  const geodes = [];
  if (!sandbox) for (let i = 0; i < 4 + Math.floor(rng() * 3); i++) { const p = findSpot(1.2, 80); if (p) { geodes.push(p); reserve(p, 2); } }
  const camps = [];
  if (!sandbox) {
    const n = Math.min(10, 5 + Math.floor(floor * 0.6));
    for (let i = 0; i < n; i++) {
      const p = findSpot(2, 200, (q) => dist(q.x, q.z, spawn.x, spawn.z) > 17 && camps.every((o) => dist(q.x, q.z, o.x, o.z) > 9) &&
        (!arena || dist(q.x, q.z, arena.x, arena.z) > arena.r + 5));
      if (p) camps.push(p);
    }
  }
  const dummies = [];
  if (sandbox) {
    for (let i = 0; i < 5; i++) {
      const a = spawnA + Math.PI + (i - 2) * 0.32;
      const p = { x: spawn.x + Math.cos(a) * 13, z: spawn.z + Math.sin(a) * 13 };
      dummies.push(p); reserve(p, 2.5);
    }
  }

  /* paths: dirt worn between the places you are sent */
  const pathPts = [];
  const trail = (a, b) => {
    if (!a || !b) return;
    const n = Math.ceil(dist(a.x, a.z, b.x, b.z) / 2);
    const nx = -(b.z - a.z), nz = b.x - a.x, nl = Math.hypot(nx, nz) || 1;
    for (let i = 0; i <= n; i++) {
      const t = i / n, w = Math.sin(t * Math.PI) * (noise(t * 3 + seed % 7, 0.5) - 0.5) * 7;
      pathPts.push({ x: lerp(a.x, b.x, t) + nx / nl * w, z: lerp(a.z, b.z, t) + nz / nl * w });
    }
  };
  const hub = arena || { x: 0, z: 0 };
  trail(spawn, hub); trail(hub, portal);
  anchors.forEach((p) => trail(hub, p));
  shrines.forEach((p) => trail(spawn, p));
  const pathD = (x, z) => { let d = 1e9; for (const p of pathPts) d = Math.min(d, (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z)); return Math.sqrt(d); };

  /* ---------------------------------------------------------------
     Meshes
     --------------------------------------------------------------- */
  const group = new THREE.Group();
  const owned = [];   // geometries/materials to free when the floor goes
  const own = (x) => { owned.push(x); return x; };

  // Ground: a polar grid out to the coastline, with a small bevelled lip.
  const RINGS = 30, SEG = 160;
  const pos = [], col = [], uv = [], idx = [];
  const cA = new THREE.Color(T.ground), cB = new THREE.Color(T.ground2), cD = new THREE.Color(T.dirt), cE = new THREE.Color(T.edge);
  const c = new THREE.Color();
  for (let r = 0; r <= RINGS + 1; r++) {
    const t = r <= RINGS ? Math.sqrt(r / RINGS) : 1;
    for (let s = 0; s < SEG; s++) {
      const a = s / SEG * TAU;
      const rr = radiusAt(a) * t + (r > RINGS ? 0.35 : 0);
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      const y = r > RINGS ? -0.35 : 0;
      pos.push(x, y, z); uv.push(x / 7, z / 7);
      const n = fbm(noise, x * 0.09 + 11, z * 0.09 + 5, 3);
      c.copy(cA).lerp(cB, clamp((n - 0.35) * 2.2, 0, 1));
      const pd = pathD(x, z);
      if (pd < 2.4) c.lerp(cD, clamp((2.4 - pd) / 1.4, 0, 1) * 0.85);
      if (t > 0.94) c.lerp(cE, clamp((t - 0.94) / 0.06, 0, 1) * 0.6);
      if (arena) { const ad = dist(x, z, arena.x, arena.z); if (Math.abs(ad - arena.r) < 0.5) c.lerp(new THREE.Color(T.accent), 0.25); }
      col.push(c.r, c.g, c.b);
    }
  }
  for (let r = 0; r <= RINGS; r++) for (let s = 0; s < SEG; s++) {
    const a = r * SEG + s, b = r * SEG + (s + 1) % SEG, d = (r + 1) * SEG + s, e = (r + 1) * SEG + (s + 1) % SEG;
    // wound so the faces point up (+y) when seen from above
    if (r === 0) { idx.push(a, e, d); continue; }
    idx.push(a, b, d, b, e, d);
  }
  const gGeo = own(new THREE.BufferGeometry());
  gGeo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  gGeo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  gGeo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  gGeo.setIndex(idx);
  gGeo.computeVertexNormals();
  const tex = TEXTURES[{ verdant: "ground-grass", sanctum: "ground-grass", ember: "ground-lava", frost: "ground-snow", void: "ground-void", storm: "ground-stone" }[T.id]];
  const gMat = own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, map: tex || null }));
  if (tex) {
    // The detail tiles are grayscale with a mean around 0.54. Used as a plain
    // map they would darken and flatten the painted colours, so they only
    // modulate them, around 1.
    gMat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace("#include <map_fragment>",
        "#ifdef USE_MAP\n vec4 texelColor = texture2D( map, vMapUv );\n diffuseColor.rgb *= mix(1.0, texelColor.r * 1.85, 0.5);\n#endif");
    };
  }
  const ground = new THREE.Mesh(gGeo, gMat);
  ground.receiveShadow = true;
  group.add(ground);

  // Cliffs: the island's underside, tapering into a jagged root.
  {
    const ROWS = 7, cp = [], cc = [], ci = [];
    const top = new THREE.Color(T.cliff), bot = new THREE.Color(T.cliffDark);
    for (let r = 0; r <= ROWS; r++) {
      const u = r / ROWS;
      for (let s = 0; s < SEG; s++) {
        const a = s / SEG * TAU;
        const jag = (noise(s * 0.35, r * 1.7 + 3) - 0.5) * (1.2 + u * 2);
        const rr = (radiusAt(a) + 0.35) * (1 - 0.55 * Math.pow(u, 1.3)) + jag;
        const y = -0.35 - u * (7 + noise(s * 0.2, 9) * 6);
        cp.push(Math.cos(a) * rr, y, Math.sin(a) * rr);
        c.copy(top).lerp(bot, u * 0.9 + (Math.sin(y * 2.4) * 0.5 + 0.5) * 0.12);
        cc.push(c.r, c.g, c.b);
      }
    }
    for (let r = 0; r < ROWS; r++) for (let s = 0; s < SEG; s++) {
      const a = r * SEG + s, b = r * SEG + (s + 1) % SEG, d = (r + 1) * SEG + s, e = (r + 1) * SEG + (s + 1) % SEG;
      ci.push(a, b, d, b, e, d);
    }
    const cg = own(new THREE.BufferGeometry());
    cg.setAttribute("position", new THREE.Float32BufferAttribute(cp, 3));
    cg.setAttribute("color", new THREE.Float32BufferAttribute(cc, 3));
    cg.setIndex(ci);
    const cgn = own(cg.toNonIndexed()); cgn.computeVertexNormals();
    const cliff = new THREE.Mesh(cgn, own(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 })));
    group.add(cliff);
  }

  // Floating debris beyond the edge, for depth.
  {
    const list = [];
    for (let i = 0; i < 16; i++) {
      const a = rng() * TAU, rr = radiusAt(a) + 6 + rng() * 14;
      list.push({ x: Math.cos(a) * rr, y: -3 - rng() * 12, z: Math.sin(a) * rr, s: 0.6 + rng() * 1.8, rot: rng() * TAU, tx: rng(), tz: rng() });
    }
    const im = instancedGeo(own(new THREE.IcosahedronGeometry(1, 0)), own(std(T.cliff)), list, false);
    if (im) group.add(im);
  }

  /* ---------------------------------------------------------------
     Props, in clumps, with colliders
     --------------------------------------------------------------- */
  const colliders = [];
  const placed = [];
  const room = (x, z, r) => free(x, z, r) && placed.every((p) => dist(x, z, p.x, p.z) > p.r + r + 0.6);
  const bins = {};
  const put = (bin, x, z, r, item) => {
    placed.push({ x, z, r });
    if (r > 0) colliders.push({ x, z, r });
    (bins[bin] = bins[bin] || []).push(Object.assign({ x, z }, item));
  };
  const G = propGeos();

  const bigKinds = {
    verdant: [["pine", 0.45], ["broad", 0.3], ["rock", 0.25]],
    sanctum: [["pine", 0.4], ["broad", 0.4], ["rock", 0.2]],
    ember:   [["rockDark", 0.45], ["crystal", 0.3], ["dead", 0.25]],
    frost:   [["pineSnow", 0.5], ["rockIce", 0.25], ["spike", 0.25]],
    void:    [["crystal", 0.4], ["column", 0.3], ["rockDark", 0.3]],
    storm:   [["column", 0.3], ["dead", 0.3], ["rock", 0.25], ["tower", 0.15]]
  }[T.id];
  const pickKind = () => { let r = rng(); for (const [k, w] of bigKinds) { r -= w; if (r <= 0) return k; } return bigKinds[0][0]; };

  const clumps = sandbox ? 7 : Math.round(R * 0.34);
  for (let i = 0; i < clumps; i++) {
    const cpos = findSpot(2, 60);
    if (!cpos) continue;
    const n = 3 + Math.floor(rng() * 6), spreadR = 2.5 + rng() * 4.5;
    const main = pickKind();
    for (let j = 0; j < n; j++) {
      const a = rng() * TAU, d = Math.sqrt(rng()) * spreadR;
      const x = cpos.x + Math.cos(a) * d, z = cpos.z + Math.sin(a) * d;
      const kind = rng() < 0.75 ? main : pickKind();
      const s = 0.75 + rng() * 0.6;
      const cr = { pine: 0.5, pineSnow: 0.5, broad: 0.75, rock: 0.75, rockDark: 0.75, rockIce: 0.75, crystal: 0.6, dead: 0.35, column: 0.5, spike: 0.55, tower: 1.35 }[kind] * s;
      if (!room(x, z, cr)) continue;
      put(kind, x, z, cr, { s, rot: rng() * TAU });
    }
  }
  // lone props so the open ground is not bald
  for (let i = 0; i < R * 0.5; i++) {
    const p = findSpot(1, 20);
    if (!p) continue;
    const kind = pickKind(), s = 0.6 + rng() * 0.4;
    if (room(p.x, p.z, 0.6 * s)) put(kind, p.x, p.z, 0.6 * s, { s, rot: rng() * TAU });
  }

  // decoration without colliders: bushes, tufts, flowers, mushrooms
  const deco = (bin, n, test) => {
    for (let i = 0; i < n; i++) {
      const a = rng() * TAU, u = Math.sqrt(rng()) * 0.96;
      const p = polar(a, u);
      if (!inside(p.x, p.z, 0.6) || pathD(p.x, p.z) < 1.2) continue;
      if (test && !test(p)) continue;
      (bins[bin] = bins[bin] || []).push({ x: p.x, z: p.z, s: 0.7 + rng() * 0.6, rot: rng() * TAU });
    }
  };
  const green = T.id === "verdant" || T.id === "sanctum";
  if (green) { deco("bush", R * 1.2); deco("tuft", R * 16); deco("flower", R * 4); deco("mush", R * 0.6); }
  if (T.id === "frost") { deco("tuft", R * 4); deco("iceShard", R * 0.8); }
  if (T.id === "ember") { deco("tuft", R * 3); deco("ember", R * 1.4); }
  if (T.id === "void") { deco("tuft", R * 5); deco("mush", R * 1.2); deco("floatCube", 14); }
  if (T.id === "storm") { deco("tuft", R * 7); deco("bush", R * 0.4); }

  // pines and rocks come from the loaded Kenney models; the rest is built here
  const add = (o) => { if (o) group.add(o); };
  const toModel = (list, h0, h1) => list.map((p) => ({ x: p.x, z: p.z, rot: p.rot, h: lerp(h0, h1, (p.s - 0.6) / 0.8) }));
  const splitHalf = (list) => [list.filter((_, i) => i % 2 === 0), list.filter((_, i) => i % 2 === 1)];
  if (bins.pine) { const [a, b] = splitHalf(bins.pine); add(instancedModel("tree-pine-a", toModel(a, 2.6, 4.4))); add(instancedModel("tree-b", toModel(b, 2.6, 4.6))); }
  if (bins.pineSnow) { const [a, b] = splitHalf(bins.pineSnow); const o = { lerp: [0xe8f4ff, 0.55] }; add(instancedModel("tree-pine-a", toModel(a, 2.4, 4.2), o)); add(instancedModel("tree-b", toModel(b, 2.4, 4.2), o)); }
  const rocks = (list, opts) => {
    if (!list) return;
    const keys = ["rock-a", "rock-b", "rock-c", "rock-large"].filter(hasModel);
    if (!keys.length) { add(instancedGeo(own(new THREE.IcosahedronGeometry(0.8, 0)), own(std(T.cliff)), list.map((p) => ({ x: p.x, z: p.z, y: 0.4, s: p.s * 1.1, rot: p.rot })))); return; }
    keys.forEach((k, ki) => add(instancedModel(k, toModel(list.filter((_, i) => i % keys.length === ki), 1.1, 2.2), opts)));
  };
  rocks(bins.rock);
  rocks(bins.rockDark, { tint: T.id === "ember" ? 0x6a4a44 : 0x5a5070 });
  rocks(bins.rockIce, { lerp: [0xcfe6ff, 0.45] });
  if (bins.broad) {
    add(instancedGeo(G.trunk, own(std(0x6b4a2c)), bins.broad.map((p) => ({ x: p.x, z: p.z, s: p.s * 1.1, rot: p.rot }))));
    add(instancedGeo(G.canopy, own(std(0xffffff)), bins.broad.map((p) => ({ x: p.x, z: p.z, s: p.s * 1.1, rot: p.rot, color: new THREE.Color(T.id === "sanctum" ? 0x7aa83c : 0x4f8a36).offsetHSL((rng() - 0.5) * 0.04, 0, (rng() - 0.5) * 0.08) }))));
  }
  if (bins.crystal) {
    const cm = own(new THREE.MeshStandardMaterial({ color: T.id === "void" ? 0x6a4aa8 : 0x8a3a1c, emissive: T.id === "void" ? 0xb07aff : 0xff7a2a, emissiveIntensity: 0.9, roughness: 0.3, flatShading: true }));
    add(instancedGeo(G.crystal, cm, bins.crystal.map((p) => ({ x: p.x, z: p.z, s: p.s * 1.2, rot: p.rot }))));
  }
  if (bins.dead) add(instancedGeo(G.deadTree, own(std(T.id === "ember" ? 0x2a1c18 : 0x3e3a36)), bins.dead.map((p) => ({ x: p.x, z: p.z, s: p.s * 1.1, rot: p.rot, tz: (rng() - 0.5) * 0.15 }))));
  if (bins.column) {
    add(instancedGeo(G.column, own(std(T.id === "void" ? 0x4a4064 : 0x7c8190)), bins.column.map((p) => ({ x: p.x, z: p.z, s: 0.8, sy: 0.35 + p.s * 0.55, rot: p.rot }))));
  }
  if (bins.spike) add(instancedGeo(G.spike, own(new THREE.MeshStandardMaterial({ color: 0xbfe6ff, emissive: 0x3fb0ff, emissiveIntensity: 0.25, roughness: 0.2, flatShading: true, transparent: true, opacity: 0.92 })), bins.spike.map((p) => ({ x: p.x, z: p.z, s: p.s * 1.1, rot: p.rot }))));
  if (bins.tower) bins.tower.forEach((p) => { const m = modelInstance("pillar", 3.4 + p.s, { tint: 0x9aa2b4 }); if (m) { m.position.set(p.x, 0, p.z); m.rotation.y = p.rot; group.add(m); } });
  if (bins.bush) { const [a, b] = splitHalf(bins.bush); const o = T.id === "storm" ? { tint: 0x8a9070 } : undefined; add(instancedModel("grass-a", toModel(a, 0.5, 0.9), o)); add(instancedModel("grass-b", toModel(b, 0.6, 1.1), o)); }
  if (bins.mush) {
    const o = T.id === "void" ? { emissive: 0x9a5cff, ei: 0.7 } : undefined;
    const [a, b] = splitHalf(bins.mush); add(instancedModel("mushroom-a", toModel(a, 0.3, 0.6), o)); add(instancedModel("mushroom-b", toModel(b, 0.3, 0.6), o));
  }
  if (bins.tuft) add(instancedGeo(G.tuft, own(new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: 1 })), bins.tuft.map((p) => ({ x: p.x, z: p.z, s: p.s * 1.3, rot: p.rot, color: new THREE.Color(T.grass).offsetHSL(0, 0, (rng() - 0.5) * 0.12) })), false));
  if (bins.flower) add(instancedGeo(G.flower, own(std(0xffffff, { emissive: 0x222222 })), bins.flower.map((p) => ({ x: p.x, z: p.z, s: p.s, rot: p.rot, color: [0xffd35a, 0xff8fb3, 0xe8e4ff, 0x9fd0ff][Math.floor(rng() * 4)] })), false));
  if (bins.iceShard) add(instancedGeo(G.spike, own(new THREE.MeshStandardMaterial({ color: 0xdff2ff, roughness: 0.2, flatShading: true })), bins.iceShard.map((p) => ({ x: p.x, z: p.z, s: p.s * 0.35, rot: p.rot })), false));
  if (bins.ember) {
    const em = own(glowMat(0xff6a1a, 1.6));
    add(instancedGeo(own(new THREE.CircleGeometry(0.5, 6).rotateX(-Math.PI / 2)), em, bins.ember.map((p) => ({ x: p.x, y: 0.02, z: p.z, s: p.s * 0.9, sy: 1, rot: p.rot })), false));
  }
  const floaters = [];
  if (bins.floatCube) {
    const fm = own(new THREE.MeshStandardMaterial({ color: 0x2a2244, emissive: 0x8a5cff, emissiveIntensity: 0.5, flatShading: true }));
    bins.floatCube.forEach((p) => {
      const m = new THREE.Mesh(G.cube, fm);
      m.position.set(p.x, 1.5 + rng() * 2, p.z); m.scale.setScalar(0.3 + rng() * 0.5); m.rotation.set(rng() * 3, rng() * 3, 0);
      m.castShadow = true;
      m.userData.base = m.position.y; m.userData.ph = rng() * TAU;
      group.add(m); floaters.push(m);
    });
  }

  /* Collider lookup: a coarse grid, since there are a few hundred colliders
     and several hundred shots and bodies asking about them every frame. */
  const CELL = 4, off = R * 1.25;
  const grid = new Map();
  const cellKey = (cx, cz) => cx * 4096 + cz;
  colliders.forEach((col) => {
    const x0 = Math.floor((col.x - col.r + off) / CELL), x1 = Math.floor((col.x + col.r + off) / CELL);
    const z0 = Math.floor((col.z - col.r + off) / CELL), z1 = Math.floor((col.z + col.r + off) / CELL);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const k2 = cellKey(cx, cz);
      if (!grid.has(k2)) grid.set(k2, []);
      grid.get(k2).push(col);
    }
  });
  const dynamic = [];   // colliders that come and go (geodes, anchors)
  function near(x, z) {
    const cell = grid.get(cellKey(Math.floor((x + off) / CELL), Math.floor((z + off) / CELL)));
    return cell;
  }
  function hitCollider(x, z, r) {
    const cell = near(x, z);
    if (cell) for (const col of cell) if ((col.x - x) * (col.x - x) + (col.z - z) * (col.z - z) < (col.r + r) * (col.r + r)) return col;
    for (const col of dynamic) if (col.on && (col.x - x) * (col.x - x) + (col.z - z) * (col.z - z) < (col.r + r) * (col.r + r)) return col;
    return null;
  }
  /** Push a body out of anything solid and back onto the island. */
  function resolve(b, r, noDynamic) {
    for (let pass = 0; pass < 2; pass++) {
      const cell = near(b.x, b.z);
      if (cell) for (const col of cell) push(b, col, r);
      if (!noDynamic) for (const col of dynamic) if (col.on) push(b, col, r);
    }
    const a = Math.atan2(b.z, b.x), lim = radiusAt(a) - 0.9 - r * 0.5, d = Math.hypot(b.x, b.z);
    if (d > lim) { b.x *= lim / d; b.z *= lim / d; return true; }
    return false;
  }
  function push(b, col, r) {
    const dx = b.x - col.x, dz = b.z - col.z, min = col.r + r;
    const d2 = dx * dx + dz * dz;
    if (d2 >= min * min) return;
    const d = Math.sqrt(d2) || 0.001;
    b.x = col.x + dx / d * min; b.z = col.z + dz / d * min;
  }
  function addDynamic(x, z, r) { const col = { x, z, r, on: true }; dynamic.push(col); return col; }
  /** Straight-line check for line of sight, sampled every half metre. */
  function clearLine(x0, z0, x1, z1) {
    const n = Math.ceil(dist(x0, z0, x1, z1) / 0.5);
    for (let i = 1; i < n; i++) { const t = i / n; if (hitCollider(lerp(x0, x1, t), lerp(z0, z1, t), 0.1)) return false; }
    return true;
  }

  /* explored map for the minimap */
  const MAP = 64, explored = new Uint8Array(MAP * MAP);
  const mapExt = R * 1.2;
  function reveal(x, z, r) {
    const cx = (x + mapExt) / (2 * mapExt) * MAP, cz = (z + mapExt) / (2 * mapExt) * MAP, cr = r / (2 * mapExt) * MAP;
    for (let j = Math.max(0, Math.floor(cz - cr)); j <= Math.min(MAP - 1, Math.ceil(cz + cr)); j++)
      for (let i = Math.max(0, Math.floor(cx - cr)); i <= Math.min(MAP - 1, Math.ceil(cx + cr)); i++)
        if ((i - cx) * (i - cx) + (j - cz) * (j - cz) <= cr * cr) explored[j * MAP + i] = 1;
  }
  function isExplored(x, z) {
    const i = Math.floor((x + mapExt) / (2 * mapExt) * MAP), j = Math.floor((z + mapExt) / (2 * mapExt) * MAP);
    return i >= 0 && j >= 0 && i < MAP && j < MAP && explored[j * MAP + i] === 1;
  }

  /* ---------------------------------------------------------------
     Weather and ambience
     --------------------------------------------------------------- */
  let rain = null;
  if (T.weather === "rain") {
    const N = 420, rp = new Float32Array(N * 6);
    const rg = own(new THREE.BufferGeometry());
    rg.setAttribute("position", new THREE.BufferAttribute(rp, 3).setUsage(THREE.DynamicDrawUsage));
    const rm = own(new THREE.LineBasicMaterial({ color: 0x9fb6d8, transparent: true, opacity: 0.35, depthWrite: false }));
    const lines = new THREE.LineSegments(rg, rm);
    lines.frustumCulled = false;
    group.add(lines);
    const drops = [];
    for (let i = 0; i < N; i++) drops.push({ x: 0, y: -1, z: 0, v: 0 });
    rain = { rp, rg, drops };
  }
  let emitAcc = 0, lightningT = 6 + rng() * 10;
  let lightning = 0;

  function update(dt, time, cx, cz) {
    for (const m of floaters) {
      m.position.y = m.userData.base + Math.sin(time * 0.8 + m.userData.ph) * 0.35;
      m.rotation.y += dt * 0.3; m.rotation.x += dt * 0.15;
    }
    emitAcc += dt;
    const W = T.weather;
    const rate = W === "snow" ? 70 : W === "embers" ? 34 : W === "rain" ? 0 : W === "motes" ? 22 : 14;
    while (emitAcc > 1 / Math.max(1, rate) && rate) {
      emitAcc -= 1 / rate;
      const x = cx + (Math.random() - 0.5) * 44, z = cz + (Math.random() - 0.5) * 34;
      if (W === "snow") fx.emit(x, 9 + Math.random() * 4, z, 0.6 + Math.random() * 0.4, -2 - Math.random(), 0.2, 5, 0.13, 0.1, 0xffffff, 0.85, 0, 0, true);
      else if (W === "embers") { if (inside(x, z)) fx.emit(x, 0.2, z, (Math.random() - 0.5) * 0.6, 1 + Math.random() * 1.6, (Math.random() - 0.5) * 0.6, 2.4, 0.12, 0.02, 0xff7a2a, 1, -0.1, 0.4); }
      else if (W === "motes") { if (inside(x, z)) fx.emit(x, 0.3 + Math.random() * 2, z, 0, 0.35 + Math.random() * 0.3, 0, 4, 0.16, 0.05, 0xb58cff, 0.8, 0, 0); }
      else if (inside(x, z)) fx.emit(x, 0.4 + Math.random() * 2.2, z, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.4, 3.5, 0.1, 0.1, 0xe8ff9a, 0.75, 0, 0);
    }
    if (rain) {
      const { rp, drops } = rain;
      drops.forEach((d, i) => {
        d.y -= d.v * dt;
        d.x += 3 * dt;
        if (d.y < 0) {
          if (d.v && inside(d.x, d.z) && Math.random() < 0.15) fx.emit(d.x, 0.08, d.z, 0, 0.8, 0, 0.18, 0.12, 0.02, 0x9fb6d8, 0.6, 5, 0, true);
          d.x = cx + (Math.random() - 0.5) * 46 - 4; d.z = cz + (Math.random() - 0.5) * 36; d.y = 6 + Math.random() * 12; d.v = 22 + Math.random() * 6;
        }
        rp[i * 6] = d.x; rp[i * 6 + 1] = d.y; rp[i * 6 + 2] = d.z;
        rp[i * 6 + 3] = d.x - 0.15; rp[i * 6 + 4] = d.y + 0.9; rp[i * 6 + 5] = d.z;
      });
      rain.rg.attributes.position.needsUpdate = true;
      lightningT -= dt;
      if (lightningT <= 0) { lightningT = 7 + Math.random() * 12; lightning = 1; if (world.onThunder) world.onThunder(); }
    }
    lightning = Math.max(0, lightning - dt * 3.5);
  }

  function dispose() {
    group.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
      if (o.material && o.material.userData && o.material.userData.floorOwned) o.material.dispose();
    });
    owned.forEach((x) => x.dispose && x.dispose());
  }

  const world = {
    theme: T, floor, kind, seed, R, radiusAt, inside, spawn, portal, arena, anchors, shrines, chests, geodes, camps, dummies,
    group, colliders, hitCollider, resolve, addDynamic, clearLine, update, dispose,
    reveal, isExplored, mapExt, get lightning() { return lightning; }, onThunder: null
  };
  return world;
}
