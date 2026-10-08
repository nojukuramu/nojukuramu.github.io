/* render.js — the world in 3D, seen from above at a tilt.
 *
 * Three.js (vendored, the same r160 build Hacks and Magic Sandbox carry),
 * one lit scene, real shadows from a sun that crosses the sky with the
 * day, and a bloom pass so that anything glowing — motes above all — bleeds
 * light into the dark. "See every Glow": every mote is an instance in one of
 * a few InstancedMeshes, shaped by Tier and coloured by Hue, pushed past 1.0
 * so the bloom picks it up.
 *
 * Plots are built once into a merged mesh (ground tiles, rocks, water,
 * plants by Bloom level) and rebuilt only when their Bloom, ownership or
 * tiles change. Contraptions are small models (models.js), one per copy,
 * rebuilt when their Material changes.
 *
 * The 2D overlay canvas on top carries what reads better flat: number pops
 * and plot labels. The camera API is the one the 2D renderer had (cam.x,
 * cam.y in tiles, cam.z in pixels per tile at the centre of the view), so
 * input.js and ui.js never needed to know the world went 3D. */

import * as THREE from "three";
import { EffectComposer } from "../vendor/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "../vendor/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "../vendor/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "../vendor/jsm/postprocessing/OutputPass.js";
import { mergeGeometries } from "../vendor/jsm/utils/BufferGeometryUtils.js";
import { S, RT } from "./state.js";
import { TYPES, HUES, DX, DY, BIOMES, CRITTERS, CONSTELLATIONS, MATERIALS, COMBO_LOOKS } from "./data.js";
import { T, getPlot, plotSize, owned, claimable, tileAt } from "./world.js";
import * as E from "./econ.js";
import { sizeOf } from "./build.js";
import { fmtL } from "./num.js";
import { hash01 } from "./rng.js";
import * as MD from "./models.js";

export const cam = { x: 5, y: 5, z: 44 };
let W = 0, H = 0, DPR = 1;
let renderer, scene, camera, composer, bloom, sun, hemi, ov, octx;
const PITCH = 0.95;   // radians down from the horizon
const FOV = 38;
let quality = "high";

/* ---------- setup ---------- */
export function init(canvas, overlay) {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  scene = new THREE.Scene();
  scene.background = new THREE.Color("#1a1d24");
  scene.fog = new THREE.Fog("#1a1d24", 40, 110);
  camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 400);
  hemi = new THREE.HemisphereLight("#cfe6ff", "#3a3226", 0.9);
  scene.add(hemi);
  sun = new THREE.DirectionalLight("#fff1d6", 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.85, 0.55, 0.82);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  ov = overlay; octx = ov.getContext("2d");
  initMotes(); initFx();
  resize();
  window.addEventListener("resize", resize);
}
export function setQuality(q) {
  quality = q === "low" ? "low" : "high";
  if (!renderer) return;
  renderer.shadowMap.enabled = quality === "high";
  sun.castShadow = quality === "high";
  resize();
}
export function resize() {
  if (!renderer) return;
  W = window.innerWidth; H = window.innerHeight;
  DPR = Math.min(quality === "high" ? 2 : 1.25, window.devicePixelRatio || 1);
  renderer.setPixelRatio(DPR);
  renderer.setSize(W, H, false);
  composer.setPixelRatio(DPR);
  composer.setSize(W, H);
  bloom.resolution.set(W / 2, H / 2);
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
  ov.width = Math.round(W * DPR); ov.height = Math.round(H * DPR);
  ov.style.width = W + "px"; ov.style.height = H + "px";
}
export const size = () => [W, H];

/* ---------- the camera ----------
   cam.z is pixels per tile at the centre of the view, so distance follows
   from the field of view; the camera hangs south of the target, looking
   north and down. */
function place() {
  const dist = H / (2 * Math.tan((FOV * Math.PI) / 360) * cam.z);
  camera.position.set(cam.x, Math.sin(PITCH) * dist, cam.y + Math.cos(PITCH) * dist);
  camera.lookAt(cam.x, 0, cam.y);
  camera.updateMatrixWorld();
}
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
export function toWorld(sx, sy) {
  if (!camera) return [cam.x, cam.y];
  place();
  ndc.set((sx / W) * 2 - 1, -(sy / H) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  if (!ray.ray.intersectPlane(ground, hit)) return [cam.x, cam.y];
  return [hit.x, hit.z];
}
const pv = new THREE.Vector3();
export function toScreen(wx, wy, h) {
  pv.set(wx, h || 0, wy).project(camera);
  return [(pv.x + 1) / 2 * W, (1 - pv.y) / 2 * H, pv.z];
}

/* ---------- plots ---------- */
const chunks = new Map();       // plot key -> { sig, group }
const terrain = new THREE.Group();
let groundMat, glowVMat, waterMat;
function mats() {
  if (groundMat) return;
  groundMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, flatShading: true });
  glowVMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  waterMat = new THREE.MeshStandardMaterial({ color: "#2a6a8a", roughness: 0.08, metalness: 0.35, transparent: true, opacity: 0.85, emissive: "#082436", emissiveIntensity: 0.5 });
}
const tmpC = new THREE.Color();
function colored(geo, col, mx) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.applyMatrix4(mx);
  const n = g.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
  g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  if (g.attributes.uv) g.deleteAttribute("uv");
  return g;
}
const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), SC = new THREE.Vector3(), EU = new THREE.Euler();
function mx(x, y, z, sx, sy, sz, ry, rx) { EU.set(rx || 0, ry || 0, 0); Q.setFromEuler(EU); return M4.compose(V.set(x, y, z), Q, SC.set(sx || 1, sy || 1, sz || 1)).clone(); }
const GEO = {};
function geo() {
  if (GEO.box) return GEO;
  GEO.box = new THREE.BoxGeometry(1, 1, 1);
  GEO.rock = new THREE.DodecahedronGeometry(0.32, 0);
  GEO.cone = new THREE.ConeGeometry(0.3, 0.8, 7);
  GEO.cyl = new THREE.CylinderGeometry(0.05, 0.07, 0.4, 5);
  GEO.ball = new THREE.IcosahedronGeometry(0.3, 0);
  GEO.tuft = new THREE.ConeGeometry(0.06, 0.22, 4);
  GEO.flower = new THREE.IcosahedronGeometry(0.06, 0);
  GEO.crystal = new THREE.OctahedronGeometry(0.22, 0);
  GEO.plane = new THREE.PlaneGeometry(1, 1);
  return GEO;
}
function plotSig(p, bloom, own) {
  const w = S.world, key = p.key;
  return [bloom, own ? 1 : 0, claimable(p.px, p.py) ? 1 : 0, (w.cleared[key] || []).length, w.dug[key] ? 1 : 0, (w.regrown[key] || []).length, S.meteors.map((m) => m.x + ":" + m.y).join(","), w.seed].join("|");
}
function buildChunk(p, bloom, own) {
  mats(); geo();
  const P = p.P, ox = p.px * P, oy = p.py * P;
  const solid = [], glow = [], water = [];
  const B = BIOMES[p.biome];
  const grey = new THREE.Color("#6b6d6a"), biome = new THREE.Color(B.ground);
  const t = own ? Math.min(1, bloom / 4) : 0;
  const lift = own ? 0 : -0.12;
  const r = (x, y, k) => hash01(S.world.seed + 13, x, y, k);
  for (let y = 0; y < P; y++) for (let x = 0; x < P; x++) {
    const wx = ox + x, wy = oy + y, tt = tileAt(wx, wy);
    let h = 0.2, col = tmpC.copy(grey).lerp(biome, t).offsetHSL(0, 0, (r(wx, wy, 2) - 0.5) * 0.016);
    if (!own) col.offsetHSL(0, -0.2, -0.08);
    if (tt === T.river || tt === T.lake) { h = 0.02; col = new THREE.Color("#3a4a52"); water.push(mx(wx + 0.5, 0.12 + lift, wy + 0.5, 1, 1, 1, 0, -Math.PI / 2)); }
    else if (tt === T.cliff) { h = 1.1 + r(wx, wy, 3) * 0.4; col = new THREE.Color("#5a4c40"); }
    else if (tt === T.gap) { h = -2.5; col = new THREE.Color("#0b0d1a"); }
    else if (tt === T.ice) col = new THREE.Color("#d8eef8");
    else if (tt === T.void) { col = new THREE.Color("#1c1228"); glow.push(colored(new THREE.TorusGeometry(0.3, 0.03, 4, 16), new THREE.Color("#c060ff").multiplyScalar(1.6), mx(wx + 0.5, 0.22 + lift, wy + 0.5, 1, 1, 1, 0, Math.PI / 2))); }
    else if (tt === T.ley) {
      // A ley line glows along the way it runs, joined to its neighbours.
      const lc = new THREE.Color("#c48aff").multiplyScalar(own ? 1.3 : 0.6);
      const isL = (a, b) => tileAt(a, b) === T.ley;
      if (isL(wx - 1, wy) || isL(wx + 1, wy)) glow.push(colored(GEO.box, lc, mx(wx + 0.5, 0.21 + lift, wy + 0.5, 1, 0.02, 0.12)));
      if (isL(wx, wy - 1) || isL(wx, wy + 1)) glow.push(colored(GEO.box, lc, mx(wx + 0.5, 0.21 + lift, wy + 0.5, 0.12, 0.02, 1)));
      col = tmpC.offsetHSL(0.05, 0.05, 0.02);
    }
    else if (tt === T.vent) { col = new THREE.Color("#3a2622"); glow.push(colored(new THREE.CylinderGeometry(0.16, 0.16, 0.04, 10), new THREE.Color("#ff6a2a").multiplyScalar(2), mx(wx + 0.5, 0.22 + lift, wy + 0.5))); }
    else if (tt === T.ruins) { col = new THREE.Color("#6e6152"); for (let i = 0; i < 3; i++) solid.push(colored(GEO.box, new THREE.Color("#8a7a66"), mx(wx + 0.2 + r(wx, wy, 10 + i) * 0.6, 0.3 + lift, wy + 0.2 + r(wx, wy, 20 + i) * 0.6, 0.3, 0.2 + r(wx, wy, 30 + i) * 0.3, 0.25, r(wx, wy, 40 + i) * 3))); }
    solid.push(colored(GEO.box, col, mx(wx + 0.5, (h + lift - 0.6) / 2, wy + 0.5, 0.965, h + 0.6, 0.965)));
    if (tt === T.rock) solid.push(colored(GEO.rock, new THREE.Color("#8d887e").offsetHSL(0, 0, (r(wx, wy, 4) - 0.5) * 0.1), mx(wx + 0.5, h + 0.15 + lift, wy + 0.5, 1.2, 0.9, 1.1, r(wx, wy, 5) * 6)));
    if (tt === T.node || tt === T.star) {
      const nd = p.nodes.find((n) => n.x === x && n.y === y);
      const c = tt === T.star ? new THREE.Color("#ffffff") : new THREE.Color(HUES[nd ? nd.hue : 0].col);
      solid.push(colored(GEO.rock, new THREE.Color("#3b3433"), mx(wx + 0.5, h + 0.05 + lift, wy + 0.5, 1.3, 0.5, 1.3)));
      for (let i = 0; i < 3; i++) glow.push(colored(GEO.crystal, c.clone().multiplyScalar(own ? 1.8 : 0.8), mx(wx + 0.3 + i * 0.2, h + 0.3 + lift, wy + 0.4 + (i % 2) * 0.2, 0.7, 1.6 - i * 0.3, 0.7, i)));
    }
    if (tt === T.crystal) for (let i = 0; i < 3; i++) glow.push(colored(GEO.crystal, new THREE.Color("#b892ff").multiplyScalar(own ? 1.6 : 0.7), mx(wx + 0.25 + i * 0.25, h + 0.25 + lift, wy + 0.3 + r(wx, wy, i) * 0.4, 0.6, 1.4 + r(wx, wy, 9 + i), 0.6, i * 0.7, 0.2)));
    if (tt !== T.soil) continue;
    // Bloom on soil: dead trees at 0, then grass, flowers, young trees, bushes, glowing plants.
    if (!own || bloom === 0) {
      if (r(wx, wy, 6) < 0.06) { solid.push(colored(GEO.cyl, new THREE.Color("#4a4440"), mx(wx + 0.5, h + 0.2 + lift, wy + 0.5, 1, 1.4, 1, 0, 0.1))); solid.push(colored(GEO.cyl, new THREE.Color("#4a4440"), mx(wx + 0.58, h + 0.42 + lift, wy + 0.5, 0.6, 0.6, 0.6, 0, -0.8))); }
      continue;
    }
    if (bloom >= 1) for (let i = 0; i < 3; i++) if (r(wx, wy, 50 + i) < 0.55) solid.push(colored(GEO.tuft, new THREE.Color().setHSL(0.27 + r(wx, wy, 60 + i) * 0.06, 0.55, 0.32 + r(wx, wy, 70 + i) * 0.15), mx(wx + 0.15 + r(wx, wy, 80 + i) * 0.7, h + 0.1, wy + 0.15 + r(wx, wy, 90 + i) * 0.7, 1, 0.8 + r(wx, wy, 95) * 0.6, 1)));
    if (bloom >= 2 && r(wx, wy, 7) < 0.3) { const fc = ["#ff8ab0", "#ffe36a", "#ffffff", "#9ab8ff", "#ff9a5a"][Math.floor(r(wx, wy, 8) * 5)]; (bloom >= 5 ? glow : solid).push(colored(GEO.flower, new THREE.Color(fc).multiplyScalar(bloom >= 5 ? 1.6 : 1), mx(wx + 0.2 + r(wx, wy, 11) * 0.6, h + 0.1, wy + 0.2 + r(wx, wy, 12) * 0.6))); }
    if (bloom >= 3 && r(wx, wy, 13) < 0.09) {
      const s = 0.8 + r(wx, wy, 14) * 0.6 + Math.min(1, (bloom - 3) * 0.15);
      solid.push(colored(GEO.cyl, new THREE.Color("#5a3a22"), mx(wx + 0.5, h + 0.2 * s, wy + 0.5, s, s, s)));
      solid.push(colored(GEO.cone, new THREE.Color().setHSL(0.3 + r(wx, wy, 15) * 0.08, 0.5, 0.28), mx(wx + 0.5, h + 0.75 * s, wy + 0.5, s, s, s, r(wx, wy, 16) * 3)));
    }
    if (bloom >= 4 && r(wx, wy, 17) < 0.22) solid.push(colored(GEO.ball, new THREE.Color().setHSL(0.28, 0.45, 0.33), mx(wx + 0.3 + r(wx, wy, 18) * 0.4, h + 0.12, wy + 0.3 + r(wx, wy, 19) * 0.4, 1, 0.6, 1)));
  }
  // a dark bed under the tiles, so the seams between them read as a grid
  solid.push(colored(GEO.box, new THREE.Color(own ? "#2a2c28" : "#1c1d1c"), mx(ox + P / 2, -0.5 + lift, oy + P / 2, P, 0.6, P)));
  const g = new THREE.Group();
  if (solid.length) { const m = new THREE.Mesh(mergeGeometries(solid), groundMat); m.receiveShadow = true; m.castShadow = true; g.add(m); }
  if (glow.length) g.add(new THREE.Mesh(mergeGeometries(glow), glowVMat));
  if (water.length) {
    const wg = mergeGeometries(water.map((m) => GEO.plane.clone().applyMatrix4(m)));
    const wm = new THREE.Mesh(wg, waterMat); wm.receiveShadow = true; g.add(wm);
  }
  // A claimable plot wears a dashed glowing border.
  if (!own && claimable(p.px, p.py)) {
    const pts = [[ox, oy], [ox + P, oy], [ox + P, oy + P], [ox, oy + P], [ox, oy]].map(([a, b]) => new THREE.Vector3(a + (a === ox ? 0.06 : -0.06), 0.16, b + (b === oy ? 0.06 : -0.06)));
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: new THREE.Color("#ffd98a").multiplyScalar(1.5), dashSize: 0.4, gapSize: 0.3, toneMapped: false }));
    line.computeLineDistances(); g.add(line);
  }
  for (const s of solid) s.dispose(); for (const s of glow) s.dispose();
  return g;
}
function disposeGroup(g) { g.traverse((o) => { if (o.geometry && o.isMesh || o.isLine) o.geometry.dispose(); }); }
export function forgetPlots() { for (const [, c] of chunks) { terrain.remove(c.group); disposeGroup(c.group); } chunks.clear(); }
function updateTerrain() {
  if (!terrain.parent) scene.add(terrain);
  const P = plotSize();
  const [a, b] = toWorld(0, 0), [c, d] = toWorld(W, 0), [e, f] = toWorld(0, H), [g, h] = toWorld(W, H);
  const xa = Math.floor(Math.min(a, c, e, g) / P) - 1, xb = Math.floor(Math.max(a, c, e, g) / P) + 1;
  const ya = Math.floor(Math.min(b, d, f, h) / P) - 1, yb = Math.floor(Math.max(b, d, f, h) / P) + 1;
  const want = new Set();
  let built = 0;
  const replay = RT.replay && RT.replay.frame;
  for (let py = ya; py <= yb; py++) for (let px = xa; px <= xb; px++) {
    if ((xb - xa) * (yb - ya) > 600) break;
    const p = getPlot(px, py);
    want.add(p.key);
    const own = replay ? replay.plots[p.key] != null : owned(px, py);
    const bloom = replay ? replay.plots[p.key] || 0 : own ? S.season.plots[p.key].bloom : 0;
    const sig = plotSig(p, bloom, own);
    const cur = chunks.get(p.key);
    if (cur && cur.sig === sig) continue;
    if (built >= (cur ? 2 : 4)) continue;          // spread rebuilds across frames
    built++;
    const grp = buildChunk(p, bloom, own);
    if (cur) {
      if (cur.bloom != null && bloom > cur.bloom && own) bloomBurst(p);
      terrain.remove(cur.group); disposeGroup(cur.group);
    }
    terrain.add(grp);
    chunks.set(p.key, { sig, group: grp, bloom });
  }
  for (const [k, c] of chunks) if (!want.has(k) && chunks.size > 80) { terrain.remove(c.group); disposeGroup(c.group); chunks.delete(k); }
}

/* ---------- contraptions ---------- */
const copyNodes = new Map();      // copy id -> { obj, type, mat, rot }
const copies3d = new THREE.Group();
function matIdx(c) {
  const T0 = TYPES[c.type];
  if (T0.fam === "wonder" || T0.fam === "heart") return 0;
  let idx = Math.min(7, Math.floor(E.level(c.type) / 25));
  // Material waves: a Milestone changes every copy in a ripple from the camera.
  const w = (RT.waves || []).find((x) => x.type === E.lvlKey(c.type));
  if (w && Math.hypot(c.x - cam.x, c.y - cam.y) > w.t * 14) idx = Math.max(0, idx - 1);
  return idx;
}
function syncCopies(list, now, dt) {
  if (!copies3d.parent) scene.add(copies3d);
  const seen = new Set();
  for (const c of list) {
    if (c.type === "track") continue;
    seen.add(c.id);
    const n = sizeOf(c.type), mi = matIdx(c);
    let e = copyNodes.get(c.id);
    if (!e || e.type !== c.type || e.mat !== mi) {
      if (e) copies3d.remove(e.obj);
      const obj = MD.build(c.type, mi, n);
      e = { obj, type: c.type, mat: mi, born: e ? e.born : now };
      copies3d.add(obj); copyNodes.set(c.id, e);
      if (c.type === "worldheart") e.stage = -1;
    }
    const o = e.obj;
    o.position.set(c.x + n / 2, 0.2, c.y + n / 2);
    o.rotation.y = -c.rot * Math.PI / 2;
    // A new copy drops into place.
    const age = now - e.born;
    o.scale.setScalar(age < 0.25 ? 0.6 + 0.4 * (age / 0.25) : 1);
    if (c.tapUntil > S.t) o.position.y += Math.abs(Math.sin(now * 14)) * 0.08;
    animate(c, o, now, dt);
    o.visible = !c.off || Math.sin(now * 4) > -0.6;
  }
  for (const [id, e] of copyNodes) if (!seen.has(id)) { copies3d.remove(e.obj); copyNodes.delete(id); }
}
function animate(c, o, now, dt) {
  const spin = o.getObjectByName("spin");
  const busy = (c.inq && c.inq.length) || (c.outq && c.outq.length) || TYPES[c.type].fam === "source";
  if (spin) spin.rotation.y += dt * (busy ? 4 : 0.6);
  const spx = o.getObjectByName("spinX"); if (spx) spx.rotation.y += dt * 2;
  const spz = o.getObjectByName("spinZ"); if (spz) spz.rotation.z += dt * (c.type === "ferris" ? 0.4 : 1.6);
  for (let i = 0; i < 3; i++) { const r = o.getObjectByName("spin" + i); if (r) r.rotation.z += dt * (0.5 + i * 0.4); const orb = o.getObjectByName("orbit" + i); if (orb) orb.rotation.y += dt * (0.8 - i * 0.2); }
  const pulse = o.getObjectByName("pulse"); if (pulse) pulse.scale.setScalar(1 + 0.15 * Math.sin(now * 5 + c.id));
  const clock = o.getObjectByName("clock"); if (clock) clock.rotation.x = -now * 0.5;
  const sw = o.getObjectByName("swing");
  if (sw) { const rung = c.lastRing && S.t - c.lastRing < 0.8 ? 1 - (S.t - c.lastRing) / 0.8 : 0; sw.rotation.x = Math.sin(now * 18) * 0.5 * rung + (c.type === "engraver" ? Math.sin(now * 6) * 0.3 : 0); }
  const flame = o.getObjectByName("flame");
  if (flame) {
    let lvl = 0; const combo = c.combo || 0;
    for (let i = 0; i < COMBO_LOOKS.length; i++) if (combo >= COMBO_LOOKS[i].at) lvl = i;
    if (c.type === "kiln" || c.type === "nebulakiln") flame.scale.set(1, 0.8 + 0.25 * Math.sin(now * 9 + c.id) * (busy ? 1 : 0.3), 1);
    else {
      const k = 0.55 + lvl * 0.28;
      flame.scale.set(k, k * (1 + 0.12 * Math.sin(now * 11 + c.id)), k);
      if (flame.userData.lvl !== lvl) {
        flame.userData.lvl = lvl;
        const cols = [["#ff7a2a", "#ffb03a"], ["#ff6a1a", "#ffd04a"], ["#ff4a1a", "#fff07a"], ["#3a7aff", "#c8e8ff"], ["#ffffff", "#fff8e0"], ["#c8a0ff", "#ffffff"]][lvl];
        flame.children[0].material = MD.glowMat(cols[0], 2.2 + lvl * 0.3); flame.children[1].material = MD.glowMat(cols[1], 2.8 + lvl * 0.3);
      }
    }
  }
  const aim = o.getObjectByName("aim");
  if (aim && c.type === "sundish") aim.rotation.z = Math.sin(now * 0.2) * 0.2;
  if (c.type === "extractor" && c.k && c.k.node) { const ring = o.getObjectByName("nodeRing"); if (ring && ring.userData.h !== c.k.node.hue) { ring.userData.h = c.k.node.hue; ring.material = MD.glowMat(HUES[c.k.node.hue].col, 2); } }
  if (c.type === "worldheart") { const tree = o.getObjectByName("heartTree"); const st = S.world.heart.stage; if (tree && tree.userData.st !== st) { tree.userData.st = st; MD.heartTree(tree, st); } }
  if (c.type === "chime" || c.type === "echobell") { const p = o.getObjectByName("pulse"); if (p) p.scale.setScalar(0.6 + Math.min(1, (c.charge || 0) / E.chimeNeed(c)) * 0.9); }
}

/* Ghosts: the same models in a pale, see-through blue. */
const ghostNodes = new Map();
let ghostMat = null;
function syncGhosts(now) {
  if (!ghostMat) ghostMat = new THREE.MeshBasicMaterial({ color: new THREE.Color("#8ac8ff"), transparent: true, opacity: 0.28 + 0 * now, depthWrite: false });
  const seen = new Set();
  for (const g of RT.replay ? [] : S.season.ghosts) {
    seen.add(g.id);
    let o = ghostNodes.get(g.id);
    if (!o) {
      o = g.type === "track" ? new THREE.Mesh(GEO.box || geo().box, ghostMat) : MD.build(g.type, 0, sizeOf(g.type));
      if (g.type === "track") o.scale.set(1, 0.1, 0.5);
      o.traverse((m) => { if (m.isMesh) { m.material = ghostMat; m.castShadow = false; } });
      copies3d.add(o); ghostNodes.set(g.id, o);
    }
    const n = sizeOf(g.type);
    o.position.set(g.x + n / 2, g.type === "track" ? 0.27 : 0.2, g.y + n / 2);
    o.rotation.y = -g.rot * Math.PI / 2;
  }
  ghostMat.opacity = 0.22 + 0.08 * Math.sin(now * 2);
  for (const [id, o] of ghostNodes) if (!seen.has(id)) { copies3d.remove(o); ghostNodes.delete(id); }
}

/* ---------- Tracks: half-segments, instanced ---------- */
let trackBase, trackTop, trackCap = 0, trackVer = -1;
function syncTracks(list) {
  const tracks = list.filter((c) => c.type === "track");
  let n = 0;
  for (const c of tracks) n += 1 + (c.k && c.k.ins ? Math.max(1, c.k.ins.length) : 1);
  if (!trackBase || n > trackCap) {
    if (trackBase) { scene.remove(trackBase, trackTop); trackBase.dispose(); trackTop.dispose(); }
    trackCap = Math.max(256, n * 2);
    trackBase = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.12, 0.5), new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.6, metalness: 0.3 }), trackCap);
    trackTop = new THREE.InstancedMesh(new THREE.BoxGeometry(0.52, 0.03, 0.1), MD.glowMat("#fff4d0", 0.9), trackCap);
    trackBase.receiveShadow = true; trackBase.castShadow = true;
    scene.add(trackBase, trackTop);
    trackVer = -1;
  }
  const ver = (RT.layoutVersion || 0) + ":" + E.level("track") + ":" + (RT.waves ? RT.waves.length : 0) + ":" + tracks.length;
  if (ver === trackVer && !(RT.waves && RT.waves.length)) return;
  trackVer = ver;
  let i = 0;
  const mat = MATERIALS[Math.min(7, Math.floor(E.level("track") / 25))];
  const col = new THREE.Color(mat.col);
  const seg = (x, y, d, out) => {
    // a half tile from the centre towards side d
    const cx = x + 0.5 + DX[d] * 0.25, cy = y + 0.5 + DY[d] * 0.25;
    M4.compose(V.set(cx, 0.27, cy), Q.setFromEuler(EU.set(0, -d * Math.PI / 2, 0)), SC.set(1, 1, 1));
    trackBase.setMatrixAt(i, M4); trackBase.setColorAt(i, col);
    M4.compose(V.set(cx, 0.33, cy), Q, SC.set(1, 1, out ? 1 : 0.7));
    trackTop.setMatrixAt(i, M4);
    i++;
  };
  for (const c of tracks) {
    // The half towards each feeder, then the half towards where it goes.
    const ins = c.k && c.k.ins && c.k.ins.length ? c.k.ins : [c.rot];
    for (const d of ins) seg(c.x, c.y, (d + 2) & 3, false);
    seg(c.x, c.y, c.rot, true);
  }
  trackBase.count = i; trackTop.count = i;
  trackBase.instanceMatrix.needsUpdate = true; trackTop.instanceMatrix.needsUpdate = true;
  if (trackBase.instanceColor) trackBase.instanceColor.needsUpdate = true;
}

/* ---------- motes ---------- */
const LOOKS = 8, MOTE_CAP = 6000;
const moteMeshes = [];
const mColor = new THREE.Color();
function initMotes() {
  const geos = [
    new THREE.IcosahedronGeometry(0.07, 1),     // Spark
    new THREE.IcosahedronGeometry(0.1, 1),      // Orb
    new THREE.OctahedronGeometry(0.12, 0),      // Gem
    new THREE.OctahedronGeometry(0.13, 0),      // Star (stretched below)
    new THREE.IcosahedronGeometry(0.11, 1),     // Comet
    new THREE.IcosahedronGeometry(0.12, 1),     // Nova
    new THREE.IcosahedronGeometry(0.15, 0),     // Nebula
    new THREE.TorusGeometry(0.1, 0.035, 6, 14)  // Galaxy
  ];
  for (let i = 0; i < LOOKS; i++) {
    const m = new THREE.InstancedMesh(geos[i], new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false }), MOTE_CAP);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.setColorAt(0, mColor.set("#fff"));
    m.frustumCulled = false;
    m.count = 0;
    moteMeshes.push(m);
  }
}
const counts = new Array(LOOKS).fill(0);
function hueColor(h, t) {
  if (h === 7) { mColor.setHSL(((t * 0.3) % 1 + 1) % 1, 1, 0.6); return mColor; }
  return mColor.set(HUES[h].col);
}
function putMote(m, x, z, y, now, scale) {
  const look = (m.t - 1) % 8, mesh = moteMeshes[look], i = counts[look];
  if (i >= MOTE_CAP) return;
  counts[look] = i + 1;
  const halo = Math.floor((m.t - 1) / 8);
  let s = 1.45 * (scale || 1) * (1 + Math.min(0.8, halo * 0.18)) * (m.L ? 1.25 + 0.1 * Math.min(m.L, 5) : 1);
  if (look === 5) s *= 1 + 0.25 * Math.sin(now * 8 + m.b);
  EU.set(look === 3 ? 0 : now * 2 + m.b, look === 7 ? now * 3 : now * 1.3 + m.b, 0);
  Q.setFromEuler(EU);
  M4.compose(V.set(x, y + 0.05 * Math.sin(now * 3 + m.b * 7), z), Q, SC.set(s, look === 3 ? s * 1.8 : s, s));
  mesh.setMatrixAt(i, M4);
  hueColor(m.h, now + m.b);
  const k = (m.L ? 3 + m.L * 0.6 : 2.3) + (m.c ? 0.5 : 0);
  mColor.multiplyScalar(k);
  mesh.setColorAt(i, mColor);
}
function trackPos(c, m) {
  const p = m.p || 0, d = m.d == null ? c.rot : m.d, o = c.rot;
  const cx0 = c.x + 0.5, cy0 = c.y + 0.5;
  if (p < 0.5) { const t = p * 2; return [cx0 - DX[d] * 0.5 * (1 - t), cy0 - DY[d] * 0.5 * (1 - t)]; }
  const t = (p - 0.5) * 2; return [cx0 + DX[o] * 0.5 * t, cy0 + DY[o] * 0.5 * t];
}
function drawMotes(now, list) {
  for (const m of moteMeshes) if (!m.parent) scene.add(m);
  counts.fill(0);
  if (!RT.replay) {
    for (const c of RT.tracks || []) for (const m of c.m) { const [x, z] = trackPos(c, m); putMote(m, x, z, 0.5, now); }
    for (const c of RT.actors || []) {
      const all = c.inq.concat(c.outq);
      if (c.bins) for (const t in c.bins) all.push(...c.bins[t]);
      if (!all.length) continue;
      const n = sizeOf(c.type), cx0 = c.x + n / 2, cy0 = c.y + n / 2;
      const lim = Math.min(all.length, 14);
      for (let i = 0; i < lim; i++) {
        const a = (i / Math.max(5, lim)) * Math.PI * 2 + now * (c.type === "ferris" ? 1.2 : 0.8);
        const rr = n * (c.type === "ferris" ? 0.5 : 0.32);
        putMote(all[i], cx0 + Math.cos(a) * rr, cy0 + Math.sin(a) * rr, 0.75 + n * 0.12, now, 0.85);
      }
    }
    for (const f of RT.flying) {
      const t = Math.min(1, f.t / f.dur);
      putMote(f.m, f.x0 + (f.x1 + 0.5 - f.x0) * t, f.y0 + (f.y1 + 0.5 - f.y0) * t, 0.5 + Math.sin(t * Math.PI) * (1.2 + f.dur * 2), now);
    }
    const P = plotSize();
    for (const f of RT.floating) {
      const p = getPlot(Math.floor(f.x / P), Math.floor(f.y / P));
      const d = Math.max(0, p.flow[(f.y - p.py * P) * P + (f.x - p.px * P)]);
      putMote(f.m, f.x + 0.5 + DX[d] * (f.p - 0.5), f.y + 0.5 + DY[d] * (f.p - 0.5), 0.2, now);
    }
    for (const s of S.season.strays || []) putMote(s.m, s.x, s.y, 0.3, now, 0.75 + 0.15 * Math.sin(now * 3 + s.x * 7));
    for (const c of RT.critters || []) if (c.carry) putMote(c.carry, c.x, c.y, 0.55, now, 0.7);
    for (const b of RT.tinkerBots || []) if (b.task && b.task.m && b.task.picked) putMote(b.task.m, b.x, b.y, 0.85, now, 0.7);
  }
  for (let i = 0; i < LOOKS; i++) {
    const m = moteMeshes[i];
    m.count = counts[i];
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }
  void list;
}

/* ---------- critters, Tinkers, the moth ---------- */
const critNodes = new Map(), botNodes = [], small = new THREE.Group();
let mothObj = null;
function syncSmall(now) {
  if (!small.parent) scene.add(small);
  const seen = new Set();
  for (const c of RT.critters || []) {
    seen.add(c.id);
    let o = critNodes.get(c.id);
    const C = CRITTERS[c.kind];
    if (!o) { o = MD.critter(C.col, c.eff === "lucky" || c.eff === "prism" || /moth|bat|wisp|kite|finch|ray|whale/.test(c.kind)); small.add(o); critNodes.set(c.id, o); }
    const hop = c.eff === "stray" ? Math.abs(Math.sin(now * 8 + c.id)) * 0.12 : 0;
    o.position.set(c.x, 0.2 + hop + (o.userData.fly ? 0.6 + Math.sin(now * 3 + c.id) * 0.15 : 0), c.y);
    o.rotation.y = c.face < 0 ? Math.PI : 0;
  }
  for (const [id, o] of critNodes) if (!seen.has(id)) { small.remove(o); critNodes.delete(id); }
  const bots = RT.tinkerBots || [];
  while (botNodes.length < bots.length) { const o = MD.tinker(); small.add(o); botNodes.push(o); }
  while (botNodes.length > bots.length) small.remove(botNodes.pop());
  bots.forEach((b, i) => { const o = botNodes[i]; o.position.set(b.x, 0.2 + Math.abs(Math.sin(now * 10 + i)) * 0.04, b.y); o.rotation.y = b.face < 0 ? Math.PI : 0; o.rotation.z = b.task && b.work > 0 ? Math.sin(now * 30) * 0.1 : 0; });
  if (RT.moth) {
    if (!mothObj) { mothObj = MD.moth(); small.add(mothObj); }
    mothObj.visible = true;
    mothObj.position.set(RT.moth.x, 1.4 + Math.sin(now * 2) * 0.2, RT.moth.y);
    const f = Math.sin(now * 20) * 0.9;
    mothObj.getObjectByName("wl").rotation.y = f; mothObj.getObjectByName("wr").rotation.y = -f;
    mothObj.rotation.x = -Math.PI / 2.4;
  } else if (mothObj) mothObj.visible = false;
}

/* ---------- effects: rings, sparks, bolts, weather, radiant light ---------- */
const fxGroup = new THREE.Group();
let sparkPts, sparkPos, sparkCol, rainPts, rainPos, rainVel, lightPts, lightPos, lightCol, previewGroup;
const RING_GEO = new THREE.RingGeometry(0.95, 1, 40);
let dotTex = null;
function dot() {
  if (dotTex) return dotTex;
  const c = document.createElement("canvas"); c.width = c.height = 32;
  const g = c.getContext("2d"), gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.4, "rgba(255,255,255,.6)"); gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
  return (dotTex = new THREE.CanvasTexture(c));
}
const ringPool = [];
function initFx() {
  const mk = (n, sz, add) => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.Points(g, new THREE.PointsMaterial({ size: sz, map: dot(), alphaTest: 0.01, vertexColors: true, toneMapped: false, transparent: true, depthWrite: false, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending, sizeAttenuation: true }));
    m.frustumCulled = false;
    return [m, pos, col];
  };
  [sparkPts, sparkPos, sparkCol] = mk(600, 0.16, true);
  [rainPts, rainPos] = mk(1500, 0.07, false);
  rainVel = new Float32Array(1500);
  [lightPts, lightPos, lightCol] = mk(900, 0.13, true);
  previewGroup = new THREE.Group();
  fxGroup.add(sparkPts, rainPts, lightPts, previewGroup);
}
function ringAt(r) {
  let m = ringPool.find((x) => !x.visible);
  if (!m) { m = new THREE.Mesh(RING_GEO, new THREE.MeshBasicMaterial({ color: new THREE.Color("#ffe2a0").multiplyScalar(0.9), toneMapped: false, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })); m.rotation.x = -Math.PI / 2; ringPool.push(m); fxGroup.add(m); }
  m.visible = true;
  return m;
}
const bursts = [];
function bloomBurst(p) { bursts.push({ x: (p.px + 0.5) * p.P, y: (p.py + 0.5) * p.P, t: 0, r: p.P }); }
function stepFx(now, dt) {
  if (!fxGroup.parent) scene.add(fxGroup);
  // chime rings
  for (const r of RT.rings) {
    r.t += dt;
    if (!r.mesh) r.mesh = ringAt(r);
    const k = r.t / 0.7;
    r.mesh.position.set(r.x, 0.45, r.y);
    r.mesh.scale.setScalar(0.2 + k * (r.r + 0.5));
    r.mesh.material.opacity = Math.max(0, 1 - k) * 0.45;
  }
  for (let i = RT.rings.length - 1; i >= 0; i--) if (RT.rings[i].t > 0.7) { RT.rings[i].mesh.visible = false; RT.rings.splice(i, 1); }
  // sparks and Bloom bursts
  let n = 0;
  for (let i = RT.sparks.length - 1; i >= 0; i--) {
    const s = RT.sparks[i]; s.t += dt;
    if (s.t > s.life) { RT.sparks.splice(i, 1); continue; }
    s.x += s.vx * dt; s.y += s.vy * dt; s.vx *= 0.94; s.vy *= 0.94;
    if (n >= 600) continue;
    sparkPos[n * 3] = s.x; sparkPos[n * 3 + 1] = 0.6 + s.t * 1.2; sparkPos[n * 3 + 2] = s.y;
    mColor.set(s.col || "#fff3a0").multiplyScalar(2.5 * (1 - s.t / s.life));
    sparkCol[n * 3] = mColor.r; sparkCol[n * 3 + 1] = mColor.g; sparkCol[n * 3 + 2] = mColor.b;
    n++;
  }
  for (let i = bursts.length - 1; i >= 0; i--) {
    const b = bursts[i]; b.t += dt;
    if (b.t > 1.6) { bursts.splice(i, 1); continue; }
    for (let j = 0; j < 40 && n < 600; j++) {
      const a = j / 40 * Math.PI * 2, rr = b.t / 1.6 * b.r * 0.75;
      sparkPos[n * 3] = b.x + Math.cos(a) * rr; sparkPos[n * 3 + 1] = 0.4 + Math.sin(b.t * 3 + j) * 0.2; sparkPos[n * 3 + 2] = b.y + Math.sin(a) * rr;
      mColor.set("#b8ff8a").multiplyScalar(2 * (1 - b.t / 1.6));
      sparkCol[n * 3] = mColor.r; sparkCol[n * 3 + 1] = mColor.g; sparkCol[n * 3 + 2] = mColor.b; n++;
    }
  }
  sparkPts.geometry.setDrawRange(0, n);
  sparkPts.geometry.attributes.position.needsUpdate = true; sparkPts.geometry.attributes.color.needsUpdate = true;
  // light drifting up from Radiant plots
  let k = 0;
  const P = plotSize();
  for (const key in S.season.plots) {
    const bl = S.season.plots[key].bloom;
    if (bl < 5) continue;
    const [px, py] = key.split(",").map(Number);
    const cnt = Math.min(40, (bl - 4) * 8);
    for (let i = 0; i < cnt && k < 900; i++) {
      const rise = ((now * 0.12 + hash01(px, py, i, 5)) % 1);
      lightPos[k * 3] = px * P + hash01(px, py, i, 3) * P; lightPos[k * 3 + 1] = 0.3 + rise * 2.2; lightPos[k * 3 + 2] = py * P + hash01(px, py, i, 4) * P;
      mColor.setHSL(bl >= 7 ? (i * 0.13 + now * 0.05) % 1 : 0.28, 0.9, 0.7).multiplyScalar(1.8 * (1 - rise));
      lightCol[k * 3] = mColor.r; lightCol[k * 3 + 1] = mColor.g; lightCol[k * 3 + 2] = mColor.b; k++;
    }
  }
  lightPts.geometry.setDrawRange(0, k);
  lightPts.geometry.attributes.position.needsUpdate = true; lightPts.geometry.attributes.color.needsUpdate = true;
  // weather: rain, snow, sand and rift motes over plots in that weather
  let w = 0;
  rainPts.material.size = 0.07;
  const P2 = plotSize();
  const [cx0, cy0] = [Math.floor(cam.x / P2), Math.floor(cam.y / P2)];
  for (let py = cy0 - 2; py <= cy0 + 2; py++) for (let px = cx0 - 2; px <= cx0 + 2; px++) {
    if (!owned(px, py)) continue;
    const kind = E.weatherOf(getPlot(px, py).biome);
    const col = kind === "rain" || kind === "storm" ? "#9ab8ff" : kind === "snow" ? "#ffffff" : kind === "sandstorm" ? "#e0c080" : kind === "rift" ? "#c060ff" : kind === "wind" ? "#e8f0ff" : kind === "aurora" ? "#6affc0" : null;
    if (!col) continue;
    const per = kind === "aurora" ? 60 : 110;
    for (let i = 0; i < per && w < 1500; i++, w++) {
      const seed = px * 977 + py * 131 + i;
      const fx0 = hash01(seed, 1, 2, 3) * P2, fz0 = hash01(seed, 4, 5, 6) * P2;
      let y, x = px * P2 + fx0, z = py * P2 + fz0;
      if (kind === "snow") { y = 6 - ((now * 0.8 + hash01(seed, 7, 8, 9) * 6) % 6); x += Math.sin(now + i) * 0.3; }
      else if (kind === "sandstorm" || kind === "wind") { y = 0.4 + hash01(seed, 7, 8, 9) * 1.5; x = px * P2 + ((fx0 + now * (kind === "wind" ? 5 : 3)) % P2); }
      else if (kind === "aurora") { y = 5 + Math.sin(now * 0.5 + fx0) * 0.6; }
      else if (kind === "rift") { y = 0.3 + ((now * 0.4 + hash01(seed, 7, 8, 9)) % 1) * 2; }
      else y = 7 - ((now * 9 + hash01(seed, 7, 8, 9) * 7) % 7);
      rainPos[w * 3] = x; rainPos[w * 3 + 1] = y; rainPos[w * 3 + 2] = z;
      mColor.set(col).multiplyScalar(kind === "aurora" || kind === "rift" ? 1.6 : 0.9);
      rainPts.geometry.attributes.color.array[w * 3] = mColor.r; rainPts.geometry.attributes.color.array[w * 3 + 1] = mColor.g; rainPts.geometry.attributes.color.array[w * 3 + 2] = mColor.b;
    }
  }
  rainPts.geometry.setDrawRange(0, w);
  rainPts.geometry.attributes.position.needsUpdate = true; rainPts.geometry.attributes.color.needsUpdate = true;
}
/* lightning and meteors: a bright line and a flash */
const boltLines = [];
function stepBolts(dt) {
  for (const b of RT.bolts) {
    b.t += dt;
    if (!b.line) {
      const pts = [];
      if (b.meteor) { pts.push(new THREE.Vector3(b.x - 6, 14, b.y - 9), new THREE.Vector3(b.x, 0.3, b.y)); }
      else { let x = b.x, z = b.y; for (let y = 16; y >= 0.3; y -= 2) { pts.push(new THREE.Vector3(x, y, z)); x = b.x + (Math.random() - 0.5) * 0.8; z = b.y + (Math.random() - 0.5) * 0.8; } pts.push(new THREE.Vector3(b.x, 0.3, b.y)); }
      b.line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: new THREE.Color(b.meteor ? "#ffd8a0" : "#f4f6ff").multiplyScalar(4), toneMapped: false, transparent: true }));
      fxGroup.add(b.line); boltLines.push(b);
      if (!b.meteor) RT.flash = Math.max(RT.flash || 0, 0.35);
    }
    b.line.material.opacity = Math.max(0, 1 - b.t / (b.meteor ? 1.2 : 0.4));
  }
  for (let i = RT.bolts.length - 1; i >= 0; i--) { const b = RT.bolts[i]; if (b.t > (b.meteor ? 1.2 : 0.4)) { fxGroup.remove(b.line); b.line.geometry.dispose(); RT.bolts.splice(i, 1); } }
}

/* ---------- placement preview, from ui.preview() ---------- */
const prevMats = {};
function previewMat(col) { if (!prevMats[col]) prevMats[col] = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false }); return prevMats[col]; }
function drawPreview(ui) {
  while (previewGroup.children.length) previewGroup.remove(previewGroup.children[0]);
  const rects = ui && ui.preview ? ui.preview() : [];
  for (const r of rects) {
    const m = new THREE.Mesh(GEO.box || geo().box, previewMat(r.col));
    m.position.set(r.x + r.w / 2, 0.24 + (r.lift || 0), r.y + r.h / 2);
    m.scale.set(r.w - 0.04, r.thin ? 0.02 : 0.08, r.h - 0.04);
    previewGroup.add(m);
  }
  // The selected copy wears a soft ring.
  if (RT.selected && RT.byId.has(RT.selected.id)) {
    const c = RT.selected, n = sizeOf(c.type);
    const m = new THREE.Mesh(GEO.box, previewMat("#ffe08a"));
    m.position.set(c.x + n / 2, 0.21, c.y + n / 2); m.scale.set(n + 0.1, 0.02, n + 0.1);
    previewGroup.add(m);
  }
}

/* ---------- day, night, light ---------- */
const lightPool = [];
const skyDay = new THREE.Color("#9fc4e8"), skyDusk = new THREE.Color("#e89a6a"), skyNight = new THREE.Color("#0a0f22"), tmpSky = new THREE.Color();
function lighting(now) {
  const phase = E.dayPhase();                       // 0 midnight, 0.5 noon
  const sunUp = Math.sin((phase - 0.25) * Math.PI * 2);   // 1 at noon, -1 at midnight
  const day = RT.eclipseShow > 0 ? 0 : Math.max(0, Math.min(1, sunUp * 1.6 + 0.35));
  const dusk = Math.max(0, 1 - Math.abs(sunUp) * 3) * (RT.eclipseShow > 0 ? 0 : 1);
  const a = (phase - 0.25) * Math.PI * 2;
  sun.position.set(cam.x + Math.cos(a) * 30, 25 + Math.max(0, Math.sin(a)) * 25, cam.y + 12);
  sun.target.position.set(cam.x, 0, cam.y);
  sun.color.set(day > 0.1 ? "#fff1d6" : "#9ab8ff").lerp(new THREE.Color("#ffb070"), dusk * 0.6);
  sun.intensity = 0.25 + day * 2.2 + (RT.flash || 0) * 6;
  hemi.intensity = 0.16 + day * 0.84;
  hemi.color.set(day > 0.3 ? "#cfe6ff" : "#4a62b8");
  hemi.groundColor.set(day > 0.3 ? "#3a3226" : "#0a0c1a");
  tmpSky.copy(skyNight).lerp(skyDay, day).lerp(skyDusk, dusk * 0.5);
  // Fog follows the weather where the camera looks.
  const P = plotSize(), w = E.weatherOf(getPlot(Math.floor(cam.x / P), Math.floor(cam.y / P)).biome);
  const fogCol = tmpSky.clone().multiplyScalar(0.35);
  if (w === "fog") fogCol.lerp(new THREE.Color("#c8d0d8"), 0.6 * (0.3 + day));
  if (w === "sandstorm") fogCol.lerp(new THREE.Color("#c8a060"), 0.6);
  if (w === "heatwave") fogCol.lerp(new THREE.Color("#a06040"), 0.25);
  scene.background.copy(fogCol);
  scene.fog.color.copy(fogCol);
  const span = H / cam.z;
  scene.fog.near = span * (w === "fog" || w === "sandstorm" ? 0.9 : 1.6);
  scene.fog.far = span * (w === "fog" || w === "sandstorm" ? 2.6 : 4.2);
  // shadows cover what is on screen
  const sc = sun.shadow.camera, half = Math.min(60, span * 0.9);
  sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half; sc.near = 1; sc.far = 140; sc.updateProjectionMatrix();
  renderer.toneMappingExposure = 1.0;
  bloom.strength = 0.65 + (1 - day) * 0.55 + (E.rushOn() ? 0.3 : 0);
  // At night the Lanterns and Hearths nearest the camera cast real light.
  const lit = [];
  if (day < 0.6) for (const c of RT.actors || []) if (c.type === "lantern" || TYPES[c.type].fam === "hearth" || c.type === "moonwell") lit.push(c);
  lit.sort((p, q) => Math.hypot(p.x - cam.x, p.y - cam.y) - Math.hypot(q.x - cam.x, q.y - cam.y));
  for (let i = 0; i < 6; i++) {
    let L = lightPool[i];
    if (!L) { L = new THREE.PointLight("#ffc87a", 0, 7, 1.6); lightPool.push(L); scene.add(L); }
    const c = lit[i];
    if (!c) { L.intensity = 0; continue; }
    const n = sizeOf(c.type);
    L.position.set(c.x + n / 2, 1.3, c.y + n / 2);
    L.color.set(c.type === "moonwell" ? "#7ab8ff" : "#ffc07a");
    L.intensity = (1 - day) * (c.type === "lantern" ? 5 : 3.5) * (E.rushOn() ? 1.4 : 1);
  }
  void now;
}

/* ---------- the frame ---------- */
let lastNow = 0;
export function frame(nowMs, ui) {
  if (!renderer) return;
  const now = nowMs / 1000;
  const dt = Math.min(0.1, now - (lastNow || now)); lastNow = now;
  if (RT.waves) for (let i = RT.waves.length - 1; i >= 0; i--) { RT.waves[i].t += dt; if (RT.waves[i].t > 8) RT.waves.splice(i, 1); }
  place();
  const replay = RT.replay && RT.replay.frame;
  const list = replay ? replay.copies.map(([type, x, y, rot], i) => ({ id: -1 - i, type, x, y, rot, inq: [], outq: [], k: { ins: [] }, mods: [] })) : S.season.copies;
  updateTerrain();
  syncCopies(list, now, dt);
  syncGhosts(now);
  syncTracks(list);
  drawMotes(now, list);
  syncSmall(now);
  stepFx(now, dt);
  stepBolts(dt);
  drawPreview(ui);
  lighting(now);
  if (RT.flash > 0) RT.flash = Math.max(0, RT.flash - dt * 2);
  if (quality === "high") composer.render(); else renderer.render(scene, camera);
  drawOverlay(now, dt);
}

/* ---------- the flat layer: pops and labels ---------- */
function drawOverlay(now, dt) {
  const g = octx;
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  g.clearRect(0, 0, W, H);
  const P = plotSize();
  // claim labels on the plots you can claim next
  if (cam.z > 9 && !RT.replay) {
    g.textAlign = "center";
    for (const key in S.season.plots) {
      const [a, b] = key.split(",").map(Number);
      for (const [c, d] of [[a + 1, b], [a - 1, b], [a, b + 1], [a, b - 1]]) {
        if (owned(c, d)) continue;
        const [sx, sy, sz] = toScreen((c + 0.5) * P, (d + 0.5) * P, 0.3);
        if (sz > 1 || sx < -80 || sy < -40 || sx > W + 80 || sy > H + 40) continue;
        const p = getPlot(c, d);
        g.font = "600 13px system-ui, sans-serif";
        g.fillStyle = "rgba(10,12,18,.55)"; g.beginPath(); g.roundRect ? g.roundRect(sx - 62, sy - 26, 124, 42, 10) : g.rect(sx - 62, sy - 26, 124, 42); g.fill();
        g.fillStyle = "#f4ecd8"; g.fillText(BIOMES[p.biome].name, sx, sy - 8);
        g.fillStyle = "#ffd98a"; g.fillText("Claim " + fmtL(E.claimCostL(c, d)), sx, sy + 9);
      }
    }
    // ruins being dug or waiting
    for (const key in S.season.plots) {
      const [a, b] = key.split(",").map(Number), p = getPlot(a, b);
      const has = (p.ruins && !S.world.dug[key]) || S.hiddenRuins[key];
      if (!has) continue;
      const rx = p.ruins && !S.world.dug[key] ? a * P + p.ruins.x + 1.5 : a * P + P / 2, ry = p.ruins && !S.world.dug[key] ? b * P + p.ruins.y + 1.5 : b * P + P / 2;
      const [sx, sy] = toScreen(rx, ry, 0.8);
      const dig = S.ruins[key];
      g.strokeStyle = "rgba(0,0,0,.5)"; g.lineWidth = 6; g.beginPath(); g.arc(sx, sy, 14, 0, 7); g.stroke();
      g.strokeStyle = "#e8c070"; g.lineWidth = 4;
      g.beginPath(); g.arc(sx, sy, 14, -1.57, -1.57 + 6.283 * (dig ? 1 - dig.left / dig.total : S.hiddenRuins[key] ? 1 : 0.02)); g.stroke();
    }
  }
  // number pops
  g.textAlign = "center";
  for (let i = RT.pops.length - 1; i >= 0; i--) {
    const p = RT.pops[i]; p.t += dt;
    if (p.t > 1.4) { RT.pops.splice(i, 1); continue; }
    const [sx, sy] = toScreen(p.x, p.y + 0.4, 1.2 + p.t * 1.2);
    g.globalAlpha = Math.min(1, 2 - p.t * 1.4);
    g.font = "800 " + (p.big ? 18 : 13) + "px system-ui, sans-serif";
    g.lineWidth = 3.5; g.strokeStyle = "rgba(0,0,0,.65)"; g.strokeText(p.text, sx, sy);
    g.fillStyle = p.col || "#fff1c8"; g.fillText(p.text, sx, sy);
  }
  g.globalAlpha = 1;
  if (RT.flash > 0) { g.fillStyle = "rgba(255,255,255," + Math.min(0.6, RT.flash) + ")"; g.fillRect(0, 0, W, H); }
  if (E.rushOn()) { const gr = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.7); gr.addColorStop(0, "rgba(255,180,80,0)"); gr.addColorStop(1, "rgba(255,180,80,.22)"); g.fillStyle = gr; g.fillRect(0, 0, W, H); }
  void now;
}

/* ---------- thumbnails of the 3D models, for the panels ---------- */
let thumbR = null, thumbScene = null, thumbCam = null;
const urls = new Map();
export function spriteURL(type, matIdx) {
  const key = type + ":" + (matIdx || 0);
  let u = urls.get(key);
  if (u != null) return u;
  try {
    if (!thumbR) {
      const c = document.createElement("canvas"); c.width = c.height = 96;
      thumbR = new THREE.WebGLRenderer({ canvas: c, alpha: true, antialias: true, preserveDrawingBuffer: true });
      thumbR.outputColorSpace = THREE.SRGBColorSpace; thumbR.toneMapping = THREE.ACESFilmicToneMapping;
      thumbScene = new THREE.Scene();
      thumbScene.add(new THREE.HemisphereLight("#ffffff", "#404040", 1.6));
      const d = new THREE.DirectionalLight("#fff4e0", 2.4); d.position.set(3, 6, 4); thumbScene.add(d);
      thumbCam = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    }
    const n = TYPES[type].size;
    let obj;
    if (type === "track") {
      obj = new THREE.Group();
      const b = new THREE.Mesh(new THREE.BoxGeometry(1, 0.12, 0.5), MD.metal(matIdx || 0)); b.position.y = 0.06;
      const t = new THREE.Mesh(new THREE.BoxGeometry(1, 0.03, 0.1), MD.glowMat("#fff4d0", 0.9)); t.position.y = 0.13;
      obj.add(b, t);
    } else obj = MD.build(type, matIdx || 0, n);
    if (type === "worldheart") MD.heartTree(obj.getObjectByName("heartTree"), 3);
    const flame = obj.getObjectByName("flame"); if (flame) flame.scale.setScalar(0.7);
    thumbScene.add(obj);
    const box3 = new THREE.Box3().setFromObject(obj), c3 = box3.getCenter(new THREE.Vector3()), sz = box3.getSize(new THREE.Vector3()).length();
    thumbCam.position.set(c3.x + sz * 1.3, c3.y + sz * 1.25, c3.z + sz * 1.6);
    thumbCam.lookAt(c3);
    thumbR.render(thumbScene, thumbCam);
    u = thumbR.domElement.toDataURL();
    thumbScene.remove(obj);
  } catch (e) { u = ""; }
  urls.set(key, u);
  return u;
}

/** Fixed Star Points for a named Constellation on a w×h chart (the Sky panel). */
export function skyPoints(i, w, h) {
  const C = CONSTELLATIONS[i];
  const cols = 3, col = i % cols, row = Math.floor(i / cols);
  const cx0 = (col + 0.5) / cols * w, cy0 = (row + 0.5) / 3 * h;
  const out = [];
  for (let j = 0; j < C.stars + 3; j++) {
    const a = hash01(17, i, j, 1) * 6.283, d = 0.25 + hash01(17, i, j, 2) * 0.75;
    const sx = j < C.stars ? (j / Math.max(1, C.stars - 1) - 0.5) * 0.7 : (hash01(17, i, j, 3) - 0.5) * 0.9;
    out.push([cx0 + (sx + Math.cos(a) * d * 0.12) * (w / cols), cy0 + (Math.sin(a) * d * 0.32 + (j < C.stars ? Math.sin(j * 1.3) * 0.12 : 0.3 * (hash01(17, i, j, 4) - 0.5))) * (h / 3)]);
  }
  return out;
}
