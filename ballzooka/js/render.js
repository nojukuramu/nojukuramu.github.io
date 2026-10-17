/* render.js — the field in 3D, drawn with Three.js, and a 2D canvas over
 * it for everything that has to be read: health, damage numbers, banners.
 *
 * The camera sits behind the cannon and looks down the lane, the way the
 * ads film it: the horde comes out of the distance, the gates stand across
 * the lane like doorways, and the stream of balls runs away from you.
 *
 * sim.js stays flat — it is a 400 × 720 field and knows nothing of this —
 * and this file only maps that plane onto the ground: sim x is world X,
 * sim y is world Z, with Z squeezed a little (KZ < KX) so the far end of the
 * lane is not lost to perspective on a phone held upright. Height is
 * decoration: blobs sit on the ground and hop, balls fly at knee height.
 *
 * The setup is Bloomworks' (bloomworks/js/render.js) — the same vendored
 * three r160, ACES tone mapping, one shadowing sun, an UnrealBloomPass that
 * makes anything emissive bleed light, and a quality switch that drops the
 * bloom and the shadows on a slow phone. Balls and sparks are
 * InstancedMeshes, one draw call each however many there are.
 *
 * Juice is still most of this file: nothing here changes a number, it
 * only reads the state and the events sim.js leaves behind. */

import * as THREE from "three";
import { EffectComposer } from "../vendor/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "../vendor/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "../vendor/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "../vendor/jsm/postprocessing/OutputPass.js";
import { W, H, CANNON_Y, LINE_Y, BALL_FX, MAX_BALLS } from "./sim.js";
import { ENEMY, GATE, PICKUP, DROP, CANNONS, BALLS, WORLDS } from "./data.js";

const KX = 0.055, KZ = 0.036;
const wx = (x) => (x - W / 2) * KX;
const wz = (y) => (y - CANNON_Y) * KZ;
const BALL_Y = 0.45;
const FOV = 50;

let renderer = null, scene, camera, composer, bloom, sun, hemi, ov, octx;
let vw = 0, vh = 0, dpr = 1, quality = "high", motion = true;
let camBase = new THREE.Vector3(), camLook = new THREE.Vector3(), fovKick = 0;
let shake = 0, flash = 0, flashColor = "#fff", comboShow = 0, comboN = 0, banner = null;
let cannonSkin = CANNONS.classic, ballSkin = BALLS.classic, worldIdx = -1;
const texts = [], flyers = [], arcs = [];
const tmpV = new THREE.Vector3(), tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpC = new THREE.Color();
const UP = new THREE.Vector3(0, 0, 1);

/* ---------- setup ---------- */
let ground, groundTex, rails = [], lineMesh, dangerMesh, ballsMesh, partsMesh, cannon, ghost;
export function init(canvas, overlay) {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  scene = new THREE.Scene();
  scene.fog = new THREE.Fog("#140e30", 60, 140);
  camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 200);
  hemi = new THREE.HemisphereLight("#e4ddff", "#4a3a70", 1.6);
  scene.add(hemi);
  sun = new THREE.DirectionalLight("#fff4e0", 2.4);
  sun.position.set(6, 22, 6);
  sun.target.position.set(0, 0, -11);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 18, bottom: -18, near: 1, far: 60 });
  sun.shadow.bias = -0.0008;
  scene.add(sun, sun.target);
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.75, 0.5, 0.78);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  ov = overlay; octx = ov.getContext("2d");
  buildStage();
  resize();
  window.addEventListener("resize", resize);
}
export function setQuality(high) {
  quality = high ? "high" : "low";
  if (!renderer) return;
  renderer.shadowMap.enabled = quality === "high";
  sun.castShadow = quality === "high";
  scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
  resize();
}
export function resize() {
  if (!renderer) return;
  vw = window.innerWidth; vh = window.innerHeight;
  dpr = Math.min(quality === "high" ? 2 : 1.25, window.devicePixelRatio || 1);
  renderer.setPixelRatio(dpr);
  renderer.setSize(vw, vh, false);
  composer.setPixelRatio(dpr);
  composer.setSize(vw, vh);
  bloom.resolution.set(vw / 2, vh / 2);
  camera.aspect = vw / vh;
  camera.fov = FOV;
  camera.updateProjectionMatrix();
  ov.width = Math.round(vw * dpr); ov.height = Math.round(vh * dpr);
  ov.style.width = vw + "px"; ov.style.height = vh + "px";
  fitCamera();
}

/* The camera backs away until the whole lane fits — both walls at the
   cannon, both walls at the far end, and the cannon's wheels — then slides
   the picture down so the cannon sits at the foot of the screen. It looks
   from as low as it can while the lane still fills the screen top to
   bottom: low is what the ads do, the horde looming out of the distance.
   A tall phone ends up a little steeper than a wide screen, and on either
   nothing of the lane is ever off screen. */
let pitch = 0.62, camDist = 30;
function fitAt(p) {
  const target = new THREE.Vector3(0, 0, wz(H * 0.45));
  const dir = new THREE.Vector3(0, Math.sin(p), Math.cos(p));
  const pts = [[-14, H], [W + 14, H], [-14, -20], [W + 14, -20], [W / 2, H + 34]].map(([x, y]) => new THREE.Vector3(wx(x), 0, wz(y)));
  const fits = (d) => {
    camera.position.copy(target).addScaledVector(dir, d);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    for (const q of pts) { tmpV.copy(q).project(camera); if (Math.abs(tmpV.x) > 0.98 || tmpV.y < -0.86 || tmpV.y > 0.8 || tmpV.z > 1) return false; }
    return true;
  };
  let lo = 4, hi = 200;
  for (let i = 0; i < 28; i++) { const m = (lo + hi) / 2; if (fits(m)) hi = m; else lo = m; }
  fits(hi);
  tmpV.set(0, 0, wz(-20)).project(camera);
  return { d: hi, top: tmpV.y, target };
}
function fitCamera() {
  camera.clearViewOffset();
  let pick = null;
  for (let p = 0.5; p <= 1.2; p += 0.02) {
    const f = fitAt(p);
    tmpV.set(0, 0, wz(H + 34)).project(camera); const yNear = tmpV.y;
    tmpV.set(wx(-14), 0, wz(-20)).project(camera); const yFar = tmpV.y;
    const shift = Math.min(0, -0.86 - yNear);
    pick = { p, f, shift };
    if (yFar + shift >= 0.6) break;
  }
  pitch = pick.p;
  const f = fitAt(pitch);
  camDist = f.d;
  camBase.copy(camera.position);
  camLook.copy(f.target);
  camera.setViewOffset(vw, vh, 0, pick.shift * vh / 2, vw, vh);
  scene.fog.near = camDist * 0.9;
  scene.fog.far = camDist * 2.6;
}

/* ---------- materials and labels ---------- */
const matCache = new Map();
function std(color, o) {
  const key = color + JSON.stringify(o || {});
  let m = matCache.get(key);
  if (!m) { m = new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.45, metalness: 0.05 }, o || {})); matCache.set(key, m); }
  return m;
}
const labelCache = new Map();
function label(text, color, wPx, hPx) {
  const key = text + "|" + color + "|" + wPx;
  let t = labelCache.get(key);
  if (t) return t;
  const c = document.createElement("canvas");
  c.width = wPx; c.height = hPx;
  const x = c.getContext("2d");
  let size = Math.round(hPx * 0.72);
  x.font = "900 " + size + "px system-ui, sans-serif";
  while (x.measureText(text).width > wPx * 0.92 && size > 10) { size -= 2; x.font = "900 " + size + "px system-ui, sans-serif"; }
  x.textAlign = "center"; x.textBaseline = "middle";
  x.lineWidth = Math.max(6, size * 0.22); x.strokeStyle = "rgba(0,0,0,.7)"; x.lineJoin = "round";
  x.strokeText(text, wPx / 2, hPx / 2 + size * 0.05);
  x.fillStyle = color; x.fillText(text, wPx / 2, hPx / 2 + size * 0.05);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  labelCache.set(key, t);
  return t;
}

/* ---------- the stage: ground, walls, the line ---------- */
function gridTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const x = c.getContext("2d");
  x.fillStyle = "#fff"; x.fillRect(0, 0, 128, 128);
  x.fillStyle = "#c8c8d8"; x.fillRect(0, 0, 128, 3); x.fillRect(0, 0, 3, 128);
  x.fillStyle = "#e4e4ee"; x.fillRect(0, 62, 128, 2); x.fillRect(62, 0, 2, 128);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(5.5, 15.6);
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const sphere = new THREE.SphereGeometry(1, 22, 16), box = new THREE.BoxGeometry(1, 1, 1), cyl = new THREE.CylinderGeometry(1, 1, 1, 18);
function buildStage() {
  groundTex = gridTexture();
  ground = new THREE.Mesh(new THREE.PlaneGeometry(W * KX + 2, 60), new THREE.MeshStandardMaterial({ color: "#3b2c7a", map: groundTex, roughness: 0.85 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, wz(H / 2) - 10);
  ground.receiveShadow = true;
  scene.add(ground);
  const outside = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: "#100a26", roughness: 1 }));
  outside.rotation.x = -Math.PI / 2; outside.position.y = -0.6;
  scene.add(outside);
  for (const s of [-1, 1]) {
    const wall = new THREE.Mesh(box, std("#1c1440"));
    wall.scale.set(0.5, 0.9, 60); wall.position.set(s * (W * KX / 2 + 0.25), 0.25, wz(H / 2) - 10);
    wall.castShadow = wall.receiveShadow = true;
    const trim = new THREE.Mesh(box, new THREE.MeshStandardMaterial({ color: "#000", emissive: "#5b7bff", emissiveIntensity: 1.6 }));
    trim.scale.set(0.12, 0.08, 60); trim.position.set(s * (W * KX / 2 + 0.05), 0.72, wz(H / 2) - 10);
    scene.add(wall, trim);
    rails.push(trim);
  }
  lineMesh = new THREE.Mesh(box, new THREE.MeshStandardMaterial({ color: "#000", emissive: "#ff4d6d", emissiveIntensity: 2 }));
  lineMesh.scale.set(W * KX, 0.05, 0.14); lineMesh.position.set(0, 0.03, wz(LINE_Y));
  scene.add(lineMesh);
  dangerMesh = new THREE.Mesh(new THREE.PlaneGeometry(W * KX, 3), new THREE.MeshBasicMaterial({ color: "#ff1030", transparent: true, opacity: 0, depthWrite: false }));
  dangerMesh.rotation.x = -Math.PI / 2; dangerMesh.position.set(0, 0.02, wz(LINE_Y) - 1.5);
  scene.add(dangerMesh);

  const bm = new THREE.MeshBasicMaterial({ color: "#fff", toneMapped: false });
  ballsMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), bm, MAX_BALLS + 64);
  ballsMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  ballsMesh.setColorAt(0, tmpC.set("#fff"));
  ballsMesh.frustumCulled = false;
  scene.add(ballsMesh);
  partsMesh = new THREE.InstancedMesh(box, new THREE.MeshBasicMaterial({ color: "#fff", toneMapped: false }), PMAX);
  partsMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  partsMesh.setColorAt(0, tmpC.set("#fff"));
  partsMesh.frustumCulled = false;
  scene.add(partsMesh);
  cannon = makeCannon(false); ghost = makeCannon(true);
  scene.add(cannon.root, ghost.root);
}

function applyWorld(i) {
  if (i === worldIdx) return;
  worldIdx = i;
  const wd = WORLDS[i];
  scene.background = new THREE.Color(wd.bot);
  scene.fog.color.set(wd.bot);
  ground.material.color.set(wd.top).lerp(tmpC.set(wd.bot), 0.35).lerp(tmpC.set(wd.grid), 0.1);
  for (const r of rails) r.material.emissive.set(wd.grid);
  lineMesh.material.emissive.set(wd.line);
}

/* ---------- the cannon ---------- */
function makeCannon(isGhost) {
  const root = new THREE.Group();
  const body = std("#3a3f58"), trim = new THREE.MeshStandardMaterial({ color: "#ffd23f", emissive: "#ffd23f", emissiveIntensity: 0.35, roughness: 0.3, metalness: 0.4 });
  const mats = [body, trim];
  const base = new THREE.Mesh(box, body); base.scale.set(2.4, 0.6, 1.5); base.position.y = 0.6;
  const band = new THREE.Mesh(box, trim); band.scale.set(2.5, 0.14, 1.6); band.position.y = 0.92;
  const dome = new THREE.Mesh(sphere, body); dome.scale.set(0.85, 0.7, 0.85); dome.position.y = 0.9;
  const tilt = new THREE.Group(); tilt.position.y = 0;
  tilt.add(base, band, dome);
  const wheels = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const w = new THREE.Mesh(cyl, std("#16121f")); w.scale.set(0.42, 0.3, 0.42); w.rotation.z = Math.PI / 2; w.position.set(sx * 1.25, 0.42, sz * 0.5);
    const hub = new THREE.Mesh(cyl, trim); hub.scale.set(0.16, 0.32, 0.16); hub.rotation.z = Math.PI / 2; hub.position.copy(w.position);
    tilt.add(w, hub); wheels.push(w);
  }
  const barrels = [];
  for (let i = 0; i < 3; i++) {
    const g = new THREE.Group();
    const tube = new THREE.Mesh(cyl, body); tube.scale.set(0.3, 1.9, 0.3); tube.rotation.x = Math.PI / 2; tube.position.z = -0.9;
    const muzzle = new THREE.Mesh(cyl, trim); muzzle.scale.set(0.36, 0.22, 0.36); muzzle.rotation.x = Math.PI / 2; muzzle.position.z = -1.85;
    g.add(tube, muzzle); g.position.y = 1.1; g.rotation.x = 0.12;
    tilt.add(g); barrels.push(g);
  }
  const flashM = new THREE.Mesh(sphere, new THREE.MeshBasicMaterial({ color: "#fff1b0", toneMapped: false, transparent: true }));
  flashM.scale.setScalar(0.35); flashM.position.set(0, 1.35, -2.1);
  tilt.add(flashM);
  root.add(tilt);
  root.traverse((o) => { if (o.isMesh && o !== flashM) { o.castShadow = !isGhost; } });
  if (isGhost) root.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.35; o.material.depthWrite = false; } });
  return { root, tilt, barrels, wheels, flashM, mats: isGhost ? null : mats, ghost: isGhost };
}
function skinCannon(c) {
  if (!c.mats) return;
  const rainbow = cannonSkin.trim === "rainbow";
  c.mats[0].color.set(cannonSkin.body);
  if (!rainbow) { c.mats[1].color.set(cannonSkin.trim); c.mats[1].emissive.set(cannonSkin.trim); }
}
function poseCannon(c, g, x, dt) {
  const k = c.ghost ? null : g.cannon;
  c.root.visible = true;
  c.root.position.set(wx(x), 0, wz(CANNON_Y));
  c.root.scale.setScalar(1.25);
  c.tilt.rotation.z = -g.cannon.tilt * 0.12;
  c.tilt.rotation.x = g.cannon.recoil * 0.08;
  const twin = g.temp && g.temp.twin > 0;
  const thick = 1 + Math.min(1, (g.s.volley - 1) * 0.15);
  c.barrels.forEach((b, i) => {
    b.visible = i === 0 || twin;
    b.position.x = i === 0 ? 0 : i === 1 ? -0.75 : 0.75;
    b.position.z = g.cannon.recoil * 0.35;
    b.scale.set(thick, thick, 1);
  });
  for (const w of c.wheels) w.rotation.x = -x * KX / 0.42;
  c.flashM.visible = motion && g.cannon.recoil > 0.7;
  c.flashM.scale.setScalar(0.25 + g.cannon.recoil * 0.3);
  if (c.mats && cannonSkin.trim === "rainbow") { const h = (performance.now() / 6000) % 1; c.mats[1].color.setHSL(h, 0.9, 0.6); c.mats[1].emissive.setHSL(h, 0.9, 0.5); }
  void k; void dt;
}

/* ---------- enemies ---------- */
const enemyObjs = new Map();
function makeEnemy(e) {
  const E = ENEMY[e.kind] || {};
  const color = e.color || E.color;
  const root = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: e.kind === "gold" ? 0.25 : 0.42, metalness: e.kind === "gold" ? 0.7 : 0.05, emissive: "#000" });
  const body = new THREE.Mesh(sphere, mat); body.castShadow = true;
  root.add(body);
  const white = std("#ffffff", { roughness: 0.2 }), black = std("#16121f", { roughness: 0.2 });
  const eyes = [];
  for (const s of [-1, 1]) {
    const ew = new THREE.Mesh(sphere, white); ew.scale.setScalar(0.24); ew.position.set(s * 0.34, 0.25, 0.82);
    const ep = new THREE.Mesh(sphere, black); ep.scale.setScalar(0.13);
    body.add(ew); root.add(ep); eyes.push({ ew, ep, s });
  }
  const extra = {};
  if (e.kind === "tank") { const h = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 8, 0, Math.PI * 2, 0, Math.PI / 4.5), std("#5a5470", { metalness: 0.6, roughness: 0.3 })); h.scale.setScalar(1.04); body.add(h); }
  if (e.kind === "shield") { const p = new THREE.Mesh(box, std("#cfe0f0", { metalness: 0.6, roughness: 0.3 })); p.scale.set(1.9, 0.8, 0.18); p.position.set(0, -0.15, 1.02); p.castShadow = true; body.add(p); extra.plate = p; }
  if (e.kind === "bomber") {
    const f = new THREE.Mesh(cyl, std("#3a2a20")); f.scale.set(0.07, 0.4, 0.07); f.position.set(0.1, 1.1, 0); f.rotation.z = -0.3; body.add(f);
    const sp = new THREE.Mesh(sphere, new THREE.MeshBasicMaterial({ color: "#ffd23f", toneMapped: false })); sp.scale.setScalar(0.13); sp.position.set(0.2, 1.3, 0); body.add(sp); extra.spark = sp;
  }
  if (e.kind === "healer") { const m = new THREE.MeshBasicMaterial({ color: "#fff", toneMapped: false }); const a = new THREE.Mesh(box, m), b = new THREE.Mesh(box, m); a.scale.set(0.16, 0.55, 0.16); b.scale.set(0.55, 0.16, 0.16); a.position.y = b.position.y = 1.25; body.add(a, b); }
  if (e.boss) {
    const gold = std("#ffd23f", { metalness: 0.8, roughness: 0.25, emissive: "#7a5a00" });
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.6, 0.3, 20, 1, true), gold); ring.position.y = 0.95; body.add(ring);
    for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; const sp = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.38, 8), gold); sp.position.set(Math.cos(a) * 0.55, 1.25, Math.sin(a) * 0.55); body.add(sp); }
  }
  scene.add(root);
  return { root, body, mat, eyes, extra, base: new THREE.Color(color) };
}
function poseEnemy(o, e, g, t) {
  const r = e.r * KX;
  const hop = motion && !e.boss && !(e.frozen > 0 || g.temp.freeze > 0) ? Math.abs(Math.sin(t * 7 + e.id)) * 0.22 * r : 0;
  const sq = motion ? Math.sin(t * 14 + e.id) * 0.06 : 0;
  o.root.position.set(wx(e.x), r + hop, wz(e.y));
  o.body.scale.set(r * (1 + sq), r * (1 - sq), r * (1 + sq));
  const frozen = e.frozen > 0 || g.temp.freeze > 0;
  if (e.flash > 0) o.mat.emissive.set("#ffffff"), o.mat.emissiveIntensity = 1.4;
  else if (frozen) o.mat.emissive.set("#5fd4ff"), o.mat.emissiveIntensity = 0.5;
  else if (e.boss && e.hp < e.maxHp * 0.5) o.mat.emissive.set("#ff2040"), o.mat.emissiveIntensity = 0.25 + 0.2 * Math.sin(t * 10);
  else o.mat.emissiveIntensity = 0;
  // pupils look at the cannon
  const dx = wx(g.cannon.x) - o.root.position.x;
  const lx = Math.max(-1, Math.min(1, dx / 6));
  const blink = ((t + e.id * 0.37) % 3.2) < 0.12;
  for (const ey of o.eyes) {
    ey.ew.scale.set(0.24, blink ? 0.04 : 0.24, 0.24);
    ey.ep.visible = !blink;
    ey.ep.position.set((ey.s * 0.34 + lx * 0.08) * r * (1 + sq), (0.27) * r * (1 - sq), (0.82 + 0.17) * r);
    ey.ep.scale.setScalar(0.13 * r);
  }
  if (o.extra.plate) o.extra.plate.visible = e.armor > 0;
  if (o.extra.spark) o.extra.spark.visible = Math.sin(t * 20) > 0;
}

/* ---------- gates and panels ---------- */
const gateObjs = new Map(), pickObjs = new Map();
function gateText(gt) {
  switch (gt.op) {
    case "mul": case "charge": return "×" + gt.v;
    case "div": return "÷" + gt.v;
    case "mystery": return "?";
    default: return gt.op.toUpperCase();
  }
}
function makeGate(gt) {
  const root = new THREE.Group();
  const w = gt.w * KX, h = 2.1;
  const glassM = new THREE.MeshStandardMaterial({ color: "#fff", emissive: "#fff", emissiveIntensity: 0.15, transparent: true, opacity: 0.5, roughness: 0.1, metalness: 0.1, depthWrite: false });
  const glass = new THREE.Mesh(box, glassM); glass.scale.set(w, h, 0.1); glass.position.y = h / 2 + 0.1;
  const frameM = new THREE.MeshStandardMaterial({ color: "#fff", emissive: "#fff", emissiveIntensity: 0.8, roughness: 0.3 });
  const top = new THREE.Mesh(box, frameM); top.scale.set(w + 0.3, 0.16, 0.2); top.position.y = h + 0.18;
  const posts = [-1, 1].map((s) => { const p = new THREE.Mesh(box, frameM); p.scale.set(0.18, h + 0.3, 0.22); p.position.set(s * (w / 2 + 0.08), (h + 0.3) / 2, 0); p.castShadow = true; return p; });
  const lab = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.92, h * 0.8), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, fog: false, color: "#e8e8e8" }));
  lab.position.set(0, h / 2 + 0.1, 0.09);
  lab.renderOrder = 3; // after the glass, or the glass tints the number grey
  const bar = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: "#bfe4ff", toneMapped: false }));
  bar.scale.set(0.001, 0.08, 0.12); bar.position.set(0, 0.24, 0.08);
  root.add(glass, top, ...posts, lab, bar);
  root.rotation.x = -pitch * 0.75; // leaning back toward the camera, so the number reads
  scene.add(root);
  return { root, glassM, frameM, lab, bar, w, text: null, color: null };
}
function poseGate(o, gt, g) {
  const age = g.t - gt.born, k = Math.min(1, age / 0.35);
  const pop = k < 1 ? 1 - Math.pow(1 - k, 3) + Math.sin(k * Math.PI) * 0.25 : 1;
  o.root.position.set(wx(gt.x), 0, wz(gt.y));
  o.root.scale.set(Math.max(0.001, pop), Math.max(0.001, pop), 1);
  let color = gt.op === "mul" && gt.v <= 1 ? "#8a8fa8" : (GATE[gt.op] || GATE.mul).color;
  if (gt.cursed > 0) color = "#ff4dd2";
  if (o.color !== color) { o.color = color; o.glassM.color.set(color); o.glassM.emissive.set(color); o.frameM.color.set(color); o.frameM.emissive.set(color); }
  const text = gateText(gt);
  if (o.text !== text) { o.text = text; o.lab.material.map = label(text, "#ffffff", 256, 128); o.lab.material.needsUpdate = true; }
  o.glassM.emissiveIntensity = gt.flash > 0 ? 0.6 : 0.15;
  o.glassM.opacity = gt.flash > 0 ? 0.65 : 0.5;
  if (gt.op === "charge" && gt.v < 6) { const p = (gt.charge % gt.need) / gt.need; o.bar.visible = true; o.bar.scale.x = Math.max(0.001, o.w * 0.9 * p); o.bar.position.x = -o.w * 0.45 + o.w * 0.45 * p; }
  else o.bar.visible = false;
}
function makePickup() {
  const root = new THREE.Group(), panels = [];
  for (let i = 0; i < 2; i++) {
    const w = (W / 2 - 10) * KX, h = 1.9;
    const m = new THREE.MeshStandardMaterial({ color: "#3fa9ff", emissive: "#3fa9ff", emissiveIntensity: 0.15, transparent: true, opacity: 0.5, depthWrite: false });
    const glass = new THREE.Mesh(box, m); glass.scale.set(w, h, 0.12); glass.position.y = h / 2 + 0.1;
    const fm = new THREE.MeshStandardMaterial({ color: "#3fa9ff", emissive: "#3fa9ff", emissiveIntensity: 0.8 });
    const top = new THREE.Mesh(box, fm); top.scale.set(w, 0.14, 0.18); top.position.y = h + 0.16;
    const bot = new THREE.Mesh(box, fm); bot.scale.set(w, 0.1, 0.18); bot.position.y = 0.08;
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.95, h * 0.75), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, fog: false, color: "#e8e8e8" }));
    lab.position.set(0, h / 2 + 0.1, 0.1);
    lab.renderOrder = 3;
    const g = new THREE.Group(); g.add(glass, top, bot, lab);
    g.position.x = (i === 0 ? -1 : 1) * (W / 4) * KX;
    root.add(g);
    panels.push({ m, fm, lab, text: null, good: null });
  }
  root.rotation.x = -pitch * 0.75; // leaning back toward the camera, so the number reads
  scene.add(root);
  return { root, panels };
}
function posePickup(o, p) {
  o.root.position.set(0, 0, wz(p.y + p.h / 2));
  p.panels.forEach((pan, i) => {
    const O = o.panels[i], good = pan.v >= 0, P = PICKUP[pan.stat];
    if (O.good !== good) { O.good = good; const c = good ? "#3fa9ff" : "#ff4d5e"; O.m.color.set(c); O.m.emissive.set(c); O.fm.color.set(c); O.fm.emissive.set(c); }
    const v = Math.round(pan.v);
    const text = (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v) + P.unit + " " + P.label;
    if (O.text !== text) { O.text = text; O.lab.material.map = label(text, "#ffffff", 512, 128); O.lab.material.needsUpdate = true; }
    O.m.emissiveIntensity = pan.flash > 0 ? 0.6 : 0.15;
  });
}

/* ---------- drops ---------- */
const dropObjs = new Map();
const dropGeo = { rapid: new THREE.OctahedronGeometry(1), mega: new THREE.SphereGeometry(1, 16, 12), twin: new THREE.CylinderGeometry(0.7, 0.7, 1.4, 6), freeze: new THREE.IcosahedronGeometry(1), bomb: new THREE.SphereGeometry(1, 16, 12), heart: new THREE.TorusKnotGeometry(0.6, 0.25, 48, 8) };
function makeDrop(d) {
  const D = DROP[d.kind];
  const m = new THREE.Mesh(dropGeo[d.kind], new THREE.MeshStandardMaterial({ color: D.color, emissive: D.color, emissiveIntensity: 0.8, roughness: 0.3, metalness: 0.3 }));
  m.scale.setScalar(0.42); m.castShadow = true;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.05, 6, 24), new THREE.MeshBasicMaterial({ color: "#fff", toneMapped: false }));
  const root = new THREE.Group(); root.add(m, ring);
  scene.add(root);
  return { root, m, ring };
}

/* ---------- sparks and rings ---------- */
const PMAX = 900;
const parts = [];
const ringPool = [], rings = [];
function burst(x, y, color, n, speed, size, up) {
  const c = new THREE.Color(color);
  for (let i = 0; i < n && parts.length < PMAX; i++) {
    const a = Math.random() * 6.283, v = speed * (0.4 + Math.random() * 0.8);
    parts.push({ x: wx(x), y: 0.6 + Math.random() * 0.5, z: wz(y), vx: Math.cos(a) * v, vy: (up || 5) * (0.5 + Math.random()), vz: Math.sin(a) * v, life: 0, max: 0.45 + Math.random() * 0.5, size: size * (0.6 + Math.random() * 0.8), c });
  }
}
function ring(x, y, r0, r1, dur, color, fill, delay) {
  let o = ringPool.pop();
  if (!o) {
    o = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 40), new THREE.MeshBasicMaterial({ color: "#fff", transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
    o.rotation.x = -Math.PI / 2;
    o.userData.fillGeo = new THREE.CircleGeometry(1, 40); o.userData.ringGeo = o.geometry;
  }
  o.geometry = fill ? o.userData.fillGeo : o.userData.ringGeo;
  o.material.color.set(color);
  o.position.set(wx(x), 0.08, wz(y));
  o.visible = true;
  scene.add(o);
  rings.push({ o, r0: r0 * KX, r1: r1 * KX, dur, life: -(delay || 0), fill });
}

/* ---------- the overlay: things to read ---------- */
function screenOf(x, y, h) {
  tmpV.set(wx(x), h || 0, wz(y)).project(camera);
  return { x: (tmpV.x + 1) / 2 * vw, y: (1 - tmpV.y) / 2 * vh, behind: tmpV.z > 1 };
}
function pop(x, y, text, color, size, life, h) {
  if (texts.length > 80) texts.shift();
  const s = screenOf(x, y, h == null ? 1.6 : h);
  const t = { x: s.x, y: s.y, vy: -60, life: 0, max: life || 0.8, text, color: color || "#fff", size: size || 16 };
  texts.push(t);
  return t;
}

/* ---------- public ---------- */
export function setMotion(v) { motion = !!v; }
export function setSkins(cid, bid) {
  cannonSkin = CANNONS[cid] || CANNONS.classic;
  ballSkin = BALLS[bid] || BALLS.classic;
  if (cannon) skinCannon(cannon);
}
export function clear() {
  texts.length = flyers.length = arcs.length = 0; shake = flash = 0; banner = null; comboShow = 0;
  parts.length = 0;
  for (const r of rings) { r.o.visible = false; ringPool.push(r.o); }
  rings.length = 0;
  for (const m of [enemyObjs, gateObjs, pickObjs, dropObjs]) { for (const o of m.values()) scene.remove(o.root); m.clear(); }
}
export function say(text, sub, color) { banner = { text, sub: sub || "", color: color || "#fff", life: 0, max: 1.8 }; }
export function kick(n) { if (motion) shake = Math.max(shake, n); }

/** A point on the screen, as a point on the sim's field (through the ground). */
const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), ndc = new THREE.Vector2(), hit = new THREE.Vector3();
export function toWorld(px, py) {
  if (!camera) return { x: W / 2, y: CANNON_Y };
  ndc.set(px / vw * 2 - 1, -(py / vh) * 2 + 1);
  camera.position.copy(camBase); camera.lookAt(camLook);
  ray.setFromCamera(ndc, camera);
  if (!ray.ray.intersectPlane(plane, hit)) return { x: W / 2, y: CANNON_Y };
  return { x: hit.x / KX + W / 2, y: hit.z / KZ + CANNON_Y };
}

export function fmt(n) {
  n = Math.max(0, n);
  if (n < 10 && n % 1) return n.toFixed(1).replace(/\.0$/, "");
  if (n < 1000) return String(Math.ceil(n));
  const u = ["K", "M", "B", "T", "Qa", "Qi", "Sx", "Sp"];
  let i = -1;
  while (n >= 1000 && i < u.length - 1) { n /= 1000; i++; }
  return (n < 10 ? n.toFixed(1).replace(/\.0$/, "") : Math.floor(n)) + u[i];
}

export function feed(events, g) {
  for (const e of events) {
    switch (e.type) {
      case "hit": {
        const big = e.crit;
        let t = null;
        for (let i = texts.length - 1; i >= 0 && i >= texts.length - 24; i--) if (texts[i].id === e.id && texts[i].life < 0.25 && !texts[i].crit) { t = texts[i]; break; }
        if (t && !big) { t.sum += e.d; t.text = fmt(t.sum); t.life = Math.min(t.life, 0.1); t.size = Math.min(26, 13 + Math.log10(1 + t.sum) * 2.5); }
        else { t = pop(e.x + (Math.random() - 0.5) * 16, e.y, fmt(e.d), big ? "#ffd23f" : "#fff", big ? 20 : 13, big ? 0.9 : 0.6, 2); t.id = e.id; t.sum = e.d; t.crit = big; }
        break;
      }
      case "kill": {
        burst(e.x, e.y, e.color, e.boss ? 80 : 14 + Math.min(10, e.r / 2), e.boss ? 9 : 4.5, e.boss ? 0.32 : 0.16, e.boss ? 12 : 6);
        ring(e.x, e.y, e.r, e.r * (e.boss ? 5 : 2.6), e.boss ? 0.7 : 0.32, e.color);
        const s = screenOf(e.x, e.y, 1);
        for (let i = 0; i < Math.min(6, Math.ceil(e.coins / 3)); i++) flyers.push({ x: s.x, y: s.y, vx: (Math.random() - 0.5) * 220, vy: -160 - Math.random() * 160, life: 0 });
        if (e.combo >= 5 && e.combo % 5 === 0) { comboN = e.combo; comboShow = 1; }
        kick(e.boss ? 1.2 : 0.08);
        break;
      }
      case "boom": burst(e.x, e.y, "#ff8a3d", 22, 6, 0.2, 8); ring(e.x, e.y, 8, e.r, 0.35, "#ffb36b", true); kick(0.35); break;
      case "split": burst(e.x, e.y, e.color, 50, 8, 0.3, 10); kick(0.8); say("IT SPLIT!", "", e.color); break;
      case "gate": if (Math.random() < 0.35 && (e.op === "mul" || e.op === "charge") && e.v > 1) pop(e.x + (Math.random() - 0.5) * 40, e.y, "×" + e.v, GATE.mul.color, 14, 0.5, 2.2); break;
      case "gateUp": pop(e.x, e.y, "×" + e.v + "!", "#7fd0ff", 22, 1, 2.4); burst(e.x, e.y, "#7fd0ff", 16, 4, 0.14); break;
      case "reveal": pop(e.x, e.y, e.op === "mul" ? "×" + e.v + (e.v >= 10 ? " JACKPOT!" : "!") : e.op === "div" ? "÷" + e.v + " oops" : e.op.toUpperCase() + "!", e.v >= 10 ? "#ffd23f" : "#e0b8ff", e.v >= 10 ? 26 : 20, 1.3, 2.4); burst(e.x, e.y, "#c58bff", 24, 5, 0.16); if (e.v >= 10) { flash = 0.5; flashColor = "#ffd23f"; kick(0.6); } break;
      case "flip": pop(e.x, e.y, "FLIPPED!", "#7fd0ff", 22, 1.1, 2); burst(e.x, e.y, "#7fd0ff", 26, 5, 0.16); break;
      case "pickup": pop(e.x, CANNON_Y, (e.v > 0 ? "+" : "") + Math.round(e.v) + PICKUP[e.stat].unit + " " + PICKUP[e.stat].label, e.good ? "#7fd0ff" : "#ff6b7a", 22, 1.3, 3); if (e.good) burst(e.x, CANNON_Y - 20, "#7fd0ff", 30, 5, 0.16, 8); else kick(0.5); break;
      case "breach": kick(0.9); flash = 0.4; flashColor = "#ff2040"; pop(e.x, e.y, "-" + e.harm, "#ff4d5e", 24, 1, 1.5); burst(e.x, e.y, "#ff2040", 20, 5, 0.18); break;
      case "escape": pop(e.x, e.y, "it got away", "#ffd23f", 13, 1); break;
      case "fever": say("FEVER!", "double fire rate", "#ff5df0"); flash = 0.35; flashColor = "#ff5df0"; kick(0.5); fovKick = 6; break;
      case "boss": say("BOSS", g.enemies.length ? g.enemies[g.enemies.length - 1].name : "", "#ff4d6d"); kick(0.7); break;
      case "bossDown": say("BOSS DOWN!", "", "#ffd23f"); flash = 0.7; flashColor = "#fff"; fovKick = -6; break;
      case "wall": pop(e.x, e.y + 60, "WALL!", "#a58cff", 22, 1); break;
      case "curse": pop(e.x, e.y, "CURSED", "#ff6bd2", 20, 1.2, 2.4); burst(e.x, e.y, "#ff6bd2", 24, 4, 0.16); break;
      case "uncurse": pop(e.x, e.y, "back to normal", "#9cff6b", 13, 1, 2.4); break;
      case "heal": ring(e.x, e.y, 10, 90, 0.6, "#9cff6b"); break;
      case "shieldBreak": pop(e.x, e.y, "SHIELD BROKEN", "#62c7ff", 14, 0.9, 2); burst(e.x, e.y + 10, "#cfe9ff", 14, 4, 0.16); break;
      case "catch": pop(e.x, CANNON_Y, DROP[e.kind].name.toUpperCase() + "!", DROP[e.kind].color, 20, 1.1, 3); burst(e.x, CANNON_Y, DROP[e.kind].color, 26, 5, 0.16, 8); break;
      case "bomb": flash = 0.6; flashColor = "#ffb36b"; kick(1); for (let i = 0; i < 7; i++) ring(Math.random() * W, 60 + Math.random() * 460, 10, 130, 0.5, "#ff8a3d", true, i * 0.05); break;
      case "arc": arcs.push({ pts: e.pts.map(([x, y]) => screenOf(x, y, 1)), life: 0 }); break;
      case "wave": if (e.n > 1) say(e.of ? "WAVE " + e.n + " / " + e.of : "WAVE " + e.n, "", "#fff"); break;
      case "won": say("CLEARED!", "", "#9cff6b"); break;
      case "revive": say("BACK IN IT", "", "#9cff6b"); flash = 0.4; flashColor = "#9cff6b"; break;
    }
  }
}

/* ---------- a frame ---------- */
function sync(map, list, make, keep) {
  for (const it of list) { let o = map.get(it.id); if (!o) { o = make(it); map.set(it.id, o); } o.seen = true; keep(o, it); }
  for (const [id, o] of map) { if (!o.seen) { scene.remove(o.root); map.delete(id); } else o.seen = false; }
}

function drawBalls(g) {
  const balls = g.balls, n = Math.min(balls.length, MAX_BALLS + 64);
  const rainbow = ballSkin.fill === "rainbow", hueBase = (performance.now() / 3000) % 1;
  const base = new THREE.Color(rainbow ? "#fff" : ballSkin.fill);
  const fire = new THREE.Color("#ffb347"), gold = new THREE.Color("#ffe066"), ice = new THREE.Color("#bff4ff");
  const mega = g.temp && g.temp.mega > 0 ? 1.4 : 1;
  for (let i = 0; i < n; i++) {
    const b = balls[i];
    const r = b.r * KX * 0.7 * (1 + Math.min(1.6, Math.log10(Math.max(1, b.n)) * 0.45)) * mega;
    const dx = b.vx * KX, dz = b.vy * KZ, l = Math.hypot(dx, dz) || 1;
    tmpV.set(dx / l, 0, dz / l);
    tmpQ.setFromUnitVectors(UP, tmpV);
    tmpS.set(r, r, motion ? r * 1.9 : r);
    tmpM.compose(tmpV.set(wx(b.x), BALL_Y + r * 0.4, wz(b.y)), tmpQ, tmpS);
    ballsMesh.setMatrixAt(i, tmpM);
    if (b.fx & BALL_FX.FIRE) tmpC.copy(fire); else if (b.fx & BALL_FX.GOLD) tmpC.copy(gold); else if (b.fx & BALL_FX.ICE) tmpC.copy(ice);
    else if (rainbow) tmpC.setHSL((hueBase + i * 0.02) % 1, 0.95, 0.65); else tmpC.copy(base);
    ballsMesh.setColorAt(i, tmpC.multiplyScalar(1.6));
  }
  ballsMesh.count = n;
  ballsMesh.instanceMatrix.needsUpdate = true;
  if (ballsMesh.instanceColor) ballsMesh.instanceColor.needsUpdate = true;
}

function stepFx(dt) {
  let n = 0;
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]; p.life += dt;
    if (p.life >= p.max || p.y < -0.5) { parts.splice(i, 1); continue; }
    p.vy -= 22 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    if (p.y < 0.05 && p.vy < 0) { p.y = 0.05; p.vy *= -0.4; p.vx *= 0.7; p.vz *= 0.7; }
  }
  for (const p of parts) {
    const s = p.size * (1 - p.life / p.max);
    tmpQ.setFromAxisAngle(tmpV.set(0.6, 1, 0.3).normalize(), p.life * 9);
    tmpM.compose(tmpV.set(p.x, p.y, p.z), tmpQ, tmpS.set(s, s, s));
    partsMesh.setMatrixAt(n, tmpM);
    partsMesh.setColorAt(n, tmpC.copy(p.c).multiplyScalar(1.5));
    n++;
  }
  partsMesh.count = n;
  partsMesh.instanceMatrix.needsUpdate = true;
  if (partsMesh.instanceColor) partsMesh.instanceColor.needsUpdate = true;
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i]; r.life += dt;
    if (r.life < 0) { r.o.visible = false; continue; }
    r.o.visible = true;
    const k = r.life / r.dur;
    if (k >= 1) { r.o.visible = false; scene.remove(r.o); ringPool.push(r.o); rings.splice(i, 1); continue; }
    const rad = r.r0 + (r.r1 - r.r0) * (1 - Math.pow(1 - k, 3));
    r.o.scale.set(rad, rad, rad);
    r.o.material.opacity = (1 - k) * (r.fill ? 0.5 : 0.9);
  }
}

function rr(x, y, w, h, r) { octx.beginPath(); octx.roundRect(x, y, w, h, r); }
function drawOverlay(g, dt) {
  const c = octx;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, vw, vh);
  c.textAlign = "center"; c.textBaseline = "middle";
  if (g) {
    // health over every blob, and a shield count on the Knights
    for (const e of g.enemies) {
      if (e.boss) continue;
      const s = screenOf(e.x, e.y, e.r * KX * 2.3 + 0.2);
      if (s.behind) continue;
      const size = Math.max(11, Math.min(20, e.r * 0.9 * (vh / 900)));
      c.font = "900 " + Math.round(size) + "px system-ui, sans-serif";
      const hp = fmt(Math.ceil(e.hp)) + (e.armor > 0 ? "" : "");
      c.lineWidth = 3.5; c.strokeStyle = "rgba(0,0,0,.65)"; c.strokeText(hp, s.x, s.y);
      c.fillStyle = "#fff"; c.fillText(hp, s.x, s.y);
      if (e.armor > 0) {
        const t = String(e.armor), tw = c.measureText(t).width;
        const sx = s.x + size * 0.4 + tw;
        c.fillStyle = "#cfe0f0"; rr(sx - tw / 2 - 4, s.y - size / 2, tw + 8, size, 4); c.fill();
        c.fillStyle = "#2a3a50"; c.fillText(t, sx, s.y + 1);
      }
    }
    for (const d of g.drops) {
      const s = screenOf(d.x, d.y, 1.4);
      c.font = "800 11px system-ui, sans-serif"; c.lineWidth = 3; c.strokeStyle = "rgba(0,0,0,.6)";
      c.strokeText(DROP[d.kind].name, s.x, s.y); c.fillStyle = DROP[d.kind].color; c.fillText(DROP[d.kind].name, s.x, s.y);
    }
    drawBossBar(g);
  }
  for (let i = arcs.length - 1; i >= 0; i--) {
    const a = arcs[i]; a.life += dt;
    if (a.life > 0.18) { arcs.splice(i, 1); continue; }
    c.strokeStyle = "#cfe9ff"; c.lineWidth = 2.5; c.globalAlpha = 1 - a.life / 0.18;
    c.beginPath();
    const p0 = a.pts[0];
    for (let j = 1; j < a.pts.length; j++) {
      const p1 = a.pts[j];
      c.moveTo(p0.x, p0.y);
      for (let s = 1; s <= 4; s++) c.lineTo(p0.x + (p1.x - p0.x) * s / 4 + (s < 4 ? (Math.random() - 0.5) * 16 : 0), p0.y + (p1.y - p0.y) * s / 4 + (s < 4 ? (Math.random() - 0.5) * 16 : 0));
    }
    c.stroke(); c.globalAlpha = 1;
  }
  for (let i = flyers.length - 1; i >= 0; i--) {
    const f = flyers[i]; f.life += dt;
    if (f.life > 0.9) { flyers.splice(i, 1); continue; }
    if (f.life > 0.25) { f.vx += (Math.min(vw, 480 + (vw - 480) / 2) - 40 - f.x) * dt * 9; f.vy += (24 - f.y) * dt * 9; }
    f.x += f.vx * dt; f.y += f.vy * dt; f.vx *= 0.92; f.vy *= 0.92;
    c.fillStyle = "#ffd23f"; c.beginPath(); c.ellipse(f.x, f.y, 5 * Math.abs(Math.cos(f.life * 14)) + 1, 5, 0, 0, 6.283); c.fill();
  }
  for (let i = texts.length - 1; i >= 0; i--) {
    const t = texts[i]; t.life += dt;
    if (t.life >= t.max) { texts.splice(i, 1); continue; }
    t.y += t.vy * dt; t.vy *= 0.94;
    const k = t.life / t.max, popk = t.life < 0.1 ? 1 + (1 - t.life / 0.1) * 0.5 : 1;
    c.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
    c.font = "900 " + Math.round(t.size * popk) + "px system-ui, sans-serif";
    c.lineWidth = 4; c.strokeStyle = "rgba(0,0,0,.6)"; c.strokeText(t.text, t.x, t.y);
    c.fillStyle = t.color; c.fillText(t.text, t.x, t.y);
  }
  c.globalAlpha = 1;
  const cx = vw / 2;
  if (comboShow > 0) {
    comboShow -= dt * 0.9;
    const k = Math.max(0, comboShow);
    c.save(); c.globalAlpha = Math.min(1, k * 2);
    c.translate(cx, vh * 0.2); const s = 1 + (1 - k) * 0.15 + (k > 0.9 ? (k - 0.9) * 4 : 0); c.scale(s, s);
    c.font = "italic 900 30px system-ui, sans-serif";
    c.lineWidth = 6; c.strokeStyle = "rgba(0,0,0,.5)"; c.strokeText(comboN + " COMBO", 0, 0);
    c.fillStyle = comboN >= 50 ? "#ff5df0" : comboN >= 20 ? "#ffd23f" : "#fff"; c.fillText(comboN + " COMBO", 0, 0);
    c.restore();
  }
  if (banner) {
    banner.life += dt;
    const k = banner.life / banner.max;
    if (k >= 1) banner = null;
    else {
      const inK = Math.min(1, banner.life / 0.18), out = k > 0.8 ? (1 - k) / 0.2 : 1;
      c.save(); c.globalAlpha = out; c.translate(cx, vh * 0.36);
      const s = (inK < 1 ? 2.2 - 1.2 * inK : 1) * Math.min(1, vw / 420); c.scale(s, s);
      c.font = "italic 900 46px system-ui, sans-serif";
      c.lineWidth = 8; c.strokeStyle = "rgba(0,0,0,.55)"; c.strokeText(banner.text, 0, 0);
      c.fillStyle = banner.color; c.fillText(banner.text, 0, 0);
      if (banner.sub) { c.font = "800 16px system-ui, sans-serif"; c.lineWidth = 4; c.strokeText(banner.sub, 0, 36); c.fillStyle = "#fff"; c.fillText(banner.sub, 0, 36); }
      c.restore();
    }
  }
  if (g && g.feverT > 0) {
    const hue = (performance.now() / 4) % 360;
    c.strokeStyle = "hsl(" + hue + ",100%,62%)"; c.lineWidth = 8; c.globalAlpha = 0.6 + 0.3 * Math.sin(performance.now() / 70);
    c.strokeRect(4, 4, vw - 8, vh - 8); c.globalAlpha = 1;
  }
  if (g && g.temp && g.temp.freeze > 0) { c.fillStyle = "rgba(160,230,255,.12)"; c.fillRect(0, 0, vw, vh); }
  if (g && g.slowmo > 0) { const gr = c.createRadialGradient(vw / 2, vh / 2, vh * 0.2, vw / 2, vh / 2, vh * 0.75); gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(1, "rgba(0,0,0,.5)"); c.fillStyle = gr; c.fillRect(0, 0, vw, vh); }
  if (flash > 0) { c.globalAlpha = Math.min(0.6, flash); c.fillStyle = flashColor; c.fillRect(0, 0, vw, vh); c.globalAlpha = 1; flash -= dt * 2.2; }
}
function drawBossBar(g) {
  const bosses = g.enemies.filter((e) => e.boss);
  if (!bosses.length) return;
  let hp = 0, max = 0;
  for (const b of bosses) { hp += Math.max(0, b.hp); max += b.maxHp; }
  const w = Math.min(320, vw - 80), x = (vw - w) / 2, y = 112;
  const c = octx;
  c.fillStyle = "rgba(0,0,0,.55)"; rr(x - 2, y - 2, w + 4, 14, 7); c.fill();
  c.fillStyle = bosses[0].color; rr(x, y, Math.max(0, w * hp / max), 10, 5); c.fill();
  c.font = "800 12px system-ui, sans-serif"; c.textBaseline = "bottom";
  c.fillStyle = "#fff"; c.fillText(bosses[0].name + "  " + fmt(hp), vw / 2, y - 3);
  c.textBaseline = "middle";
}

let scroll = 0;
export function draw(g, dt) {
  if (!renderer) return;
  const t = performance.now() / 1000;
  const wi = Math.floor((((g && g.mode) ? (g.mode === "campaign" ? g.level : 1 + Math.floor((g.wave || 0) / 5) * 5) : 1) - 1) / 5) % WORLDS.length;
  applyWorld(wi);
  // the floor rolls toward you, so a still cannon still feels fast
  scroll += dt * (g && g.feverT > 0 ? 3.2 : 1.1);
  groundTex.offset.y = scroll;
  let danger = 0;
  if (g) for (const e of g.enemies) danger = Math.max(danger, 1 - (LINE_Y - e.y) / 120);
  danger = Math.max(0, Math.min(1, danger));
  dangerMesh.material.opacity = danger * 0.35 * (0.6 + 0.4 * Math.sin(t * 11));
  lineMesh.material.emissiveIntensity = 1.5 + danger * 3 * (0.5 + 0.5 * Math.sin(t * 11));

  if (g) {
    sync(gateObjs, g.gates, makeGate, (o, gt) => poseGate(o, gt, g));
    sync(pickObjs, g.pickups, makePickup, (o, p) => posePickup(o, p));
    sync(enemyObjs, g.enemies, makeEnemy, (o, e) => poseEnemy(o, e, g, t));
    sync(dropObjs, g.drops, makeDrop, (o, d) => { o.root.position.set(wx(d.x), 0.7 + Math.sin(t * 5 + d.id) * 0.15, wz(d.y)); o.m.rotation.set(t * 2, t * 3, 0); o.ring.rotation.set(Math.PI / 2 + Math.sin(t * 3) * 0.3, 0, t * 2); });
    drawBalls(g);
    poseCannon(cannon, g, g.cannon.x, dt);
    const mirror = g.s.mirror && Math.abs(W - 2 * g.cannon.x) > 24;
    ghost.root.visible = !!mirror;
    if (mirror) poseCannon(ghost, g, W - g.cannon.x, dt);
  }
  stepFx(dt);

  // camera: shake, and a punch of field of view on the big moments
  fovKick *= Math.pow(0.04, dt);
  camera.fov = FOV + fovKick + (g && g.feverT > 0 ? 3 : 0);
  camera.updateProjectionMatrix();
  camera.position.copy(camBase);
  if (shake > 0) { camera.position.x += (Math.random() - 0.5) * shake; camera.position.y += (Math.random() - 0.5) * shake; shake = Math.max(0, shake - dt * 3); }
  camera.lookAt(camLook);
  if (quality === "high") composer.render(); else renderer.render(scene, camera);
  drawOverlay(g, dt);
}

/* The title screen: the cannon swaying and firing into an empty lane. */
const idleBalls = [];
export function drawIdle(t, dt) {
  const x = W / 2 + Math.sin(t * 0.8) * 110;
  const fake = {
    t, mode: "campaign", level: 1, wave: 0, cannon: { x, tilt: Math.cos(t * 0.8) * 0.5, recoil: (t * 3) % 1 },
    s: { volley: 3, mirror: 0 }, temp: { twin: 0, freeze: 0, mega: 0 }, enemies: [], gates: [], pickups: [], drops: [], balls: idleBalls, feverT: 0, slowmo: 0
  };
  idleBalls.length = 0;
  for (let i = 0; i < 60; i++) {
    const p = (t * 0.7 + i / 60) % 1;
    const bx = W / 2 + Math.sin((t - p * 1.4) * 0.8) * 110 + Math.sin(i * 12.9) * 40 * p;
    idleBalls.push({ x: bx, y: CANNON_Y - 30 - p * (CANNON_Y + 40), vx: 0, vy: -500, n: p > 0.45 ? 3 : 1, r: 5, fx: 0 });
  }
  draw(fake, dt);
}
