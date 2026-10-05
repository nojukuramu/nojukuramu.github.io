/* render.js — everything you see: the arena, the sky, the light, the
 * effects, and the camera they are seen from.
 *
 * The arena is drawn straight from its brushes: every face becomes triangles
 * in a few merged meshes, coloured by its kind and textured in world space —
 * concrete, metal or the surf's lit grid — with the one-metre grid kept in
 * every surface on purpose, because a grid is how you judge a jump before you
 * make it. A low evening sun casts real shadows across it, and the sky it
 * comes from is also what the metal reflects.
 *
 * Bodies are figures.js's, your own gun and arms viewmodel.js's (a second
 * scene, drawn after this one with the depth cleared, so the gun never sinks
 * into a wall).
 *
 * The canvas is measured, never assumed: the size it is drawn at, the size
 * the HUD centres its crosshair in and the size hacks project into are one
 * number (`view`), read off the canvas itself. On a phone the window's
 * inner height and CSS's 100vh disagree by the address bar, and a canvas
 * sized by one and centred by the other puts the crosshair above the point
 * the shot goes.
 *
 * Three quality tiers, chosen the way Magic Sandbox's gfx.js does it: "auto"
 * starts at high on computers and medium on phones, and steps down once if
 * the frame rate cannot keep up. Low drops the shadows. */

import * as THREE from "three";
import { RoomEnvironment } from "../vendor/jsm/environments/RoomEnvironment.js";
import { S, on } from "./state.js";
import { KINDS } from "./map.js";
import { world, renderPos } from "./game.js";
import { gunOf } from "./weapons.js";
import { ray, newTrace } from "./brush.js";
import { LUNGE, PM } from "./movement.js";
import { save } from "./save.js";
import { clamp, damp } from "./util.js";
import { loadModels } from "./models.js";
import { initFigures, syncFigures, hideFigures, figureQuality, muzzleOf } from "./figures.js";
import { vScene, vCam, updateViewmodel, vmVisible, vmScoped, muzzleWorld } from "./viewmodel.js";
export { vmFire, vmSwing } from "./viewmodel.js";

export const IS_TOUCH = typeof window !== "undefined" && (("ontouchstart" in window) || navigator.maxTouchPoints > 0);

const canvas = document.getElementById("gl");
export const renderer = new THREE.WebGLRenderer({ canvas, antialias: (window.devicePixelRatio || 1) < 2, powerPreference: "high-performance" });
renderer.autoClear = false;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

export const scene = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 600);
camera.rotation.order = "YXZ";

/** The drawing size in CSS pixels: the canvas's own box, which is the HUD's box too. */
export const view = { w: window.innerWidth, h: window.innerHeight };

/* ---------------------------------------------------------------
   Sky and light
   --------------------------------------------------------------- */
// a low sun from the south-west, warm; the sky above it a deepening blue
const SUN_DIR = new THREE.Vector3(-0.45, 0.74, 0.5).normalize();
const SKY = { top: new THREE.Color(0x0b1a33), mid: new THREE.Color(0x2c5a8c), horizon: new THREE.Color(0xe7a27a), ground: new THREE.Color(0x232a33), sun: new THREE.Color(0xffd9a8) };
const FOG = 0x6f7f97;
function skyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: SKY.top }, mid: { value: SKY.mid }, horizon: { value: SKY.horizon }, ground: { value: SKY.ground }, sunColor: { value: SKY.sun }, sunDir: { value: SUN_DIR } },
    vertexShader: "varying vec3 vDir; void main() { vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }",
    fragmentShader: [
      "uniform vec3 top, mid, horizon, ground, sunColor, sunDir; varying vec3 vDir;",
      "void main() {",
      "  vec3 d = normalize(vDir); float h = d.y;",
      "  vec3 c = mix(horizon, mid, smoothstep(-0.02, 0.28, h));",
      "  c = mix(c, top, smoothstep(0.28, 0.95, h));",
      "  c = mix(c, ground, smoothstep(0.0, -0.18, h));",
      "  float s = max(dot(d, sunDir), 0.0);",
      "  c += sunColor * (pow(s, 900.0) * 6.0 + pow(s, 40.0) * 0.35 + pow(s, 6.0) * 0.12);",
      "  gl_FragColor = vec4(c, 1.0);",
      "  #include <tonemapping_fragment>",
      "  #include <colorspace_fragment>",
      "}"].join("\n")
  });
}
const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), skyMaterial());
sky.frustumCulled = false;
sky.renderOrder = -1;
scene.add(sky);
scene.fog = new THREE.Fog(FOG, 120, 420);
// the sky's light, and the warm floor's bounce: what lights the shade under an 18-metre wall
const hemi = new THREE.HemisphereLight(0xe2ebf7, 0x8a7d6c, 3.0);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffe4c4, 3.3);
sun.position.copy(SUN_DIR).multiplyScalar(160);
sun.shadow.camera.left = -72; sun.shadow.camera.right = 72; sun.shadow.camera.top = 72; sun.shadow.camera.bottom = -72;
sun.shadow.camera.near = 20; sun.shadow.camera.far = 340;
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
scene.add(sun); scene.add(sun.target);
// your own shots light the walls around you, for a frame or two
const muzzleLight = new THREE.PointLight(0xffc477, 0, 9, 2);
scene.add(muzzleLight);

/* What metal reflects: the same sky, blurred. The gun's scene gets a studio, so it reads from any angle. */
function environments() {
  const pm = new THREE.PMREMGenerator(renderer);
  const s = new THREE.Scene();
  const m = skyMaterial(); m.side = THREE.BackSide;
  s.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), m));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ color: 0x3a3f47 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -2;
  s.add(floor);
  scene.environment = pm.fromScene(s, 0.04).texture;
  // the gun in your hands sees a soft studio, so its shape reads from any angle
  vScene.environment = pm.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  pm.dispose();
}

/* ---------------------------------------------------------------
   Quality
   --------------------------------------------------------------- */
const TIERS = { low: { dpr: 0.75, shadow: 0 }, medium: { dpr: 1.25, shadow: 1024 }, high: { dpr: 2, shadow: 2048 } };
let tier = "high", wanted = "auto", slowFrames = 0, stepped = false, shadowsOn = null;
export function setQuality(q) {
  wanted = q || "auto";
  tier = wanted === "auto" ? (IS_TOUCH ? "medium" : "high") : wanted;
  stepped = false;
  applyTier();
}
export const currentTier = () => tier;
function applyTier() {
  const sz = TIERS[tier].shadow;
  const want = sz > 0;
  figureQuality(want, tier === "low");
  if (want !== shadowsOn) {
    shadowsOn = want;
    renderer.shadowMap.enabled = want;
    sun.castShadow = want;
    // the shadow switch changes every lit material's shader
    scene.traverse((o) => { if (o.material) for (const m of [].concat(o.material)) m.needsUpdate = true; });
  }
  if (want && sun.shadow.mapSize.x !== sz) {
    sun.shadow.mapSize.set(sz, sz);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  }
  renderer.shadowMap.type = tier === "high" ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  if (mapGroup) for (const m of mapGroup.children) if (m.userData.mats) m.material = tier === "low" ? m.userData.mats.cheap : m.userData.mats.full;
  resize();
}
function watchFrameRate(dt) {
  if (wanted !== "auto" || stepped) return;
  slowFrames = dt > 1 / 40 ? slowFrames + 1 : Math.max(0, slowFrames - 0.5);
  if (slowFrames > 90) { stepped = true; tier = tier === "high" ? "medium" : "low"; applyTier(); }
}
export function resize() {
  const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
  view.w = w; view.h = h;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, TIERS[tier].dpr));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
// an address bar sliding away changes the canvas without always firing a window resize
if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => { if (canvas.clientWidth !== view.w || canvas.clientHeight !== view.h) resize(); }).observe(canvas);

/* ---------------------------------------------------------------
   The arena
   --------------------------------------------------------------- */
/* Surfaces are painted on canvases, 4 m to a tile: a base, the 1 m grid, and a 4 m seam,
   with a height map turned into a normal map so the seams catch the low sun. */
function surface(kind) {
  const N = 512, c = document.createElement("canvas");
  c.width = c.height = N;
  const g = c.getContext("2d");
  const h = new Float32Array(N * N);
  // base: concrete is mottled, metal brushed, the surf a dark glass
  const rnd = (() => { let s = kind.length * 977 + 13; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  const base = kind === "metal" ? [204, 209, 216] : kind === "surf" ? [70, 64, 110] : [222, 222, 218];
  g.fillStyle = "rgb(" + base.join(",") + ")"; g.fillRect(0, 0, N, N);
  const blots = kind === "concrete" ? 900 : 260;
  for (let i = 0; i < blots; i++) {
    const x = rnd() * N, y = rnd() * N, r = 4 + rnd() * (kind === "concrete" ? 26 : 10), k = (rnd() - 0.5) * (kind === "concrete" ? 26 : 12);
    g.fillStyle = "rgba(" + (k > 0 ? "255,255,255," : "0,0,0,") + Math.abs(k) / 255 + ")";
    if (kind === "metal") g.fillRect(x, y, r * 6, 1 + rnd() * 2); else { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
  }
  // the grid: a fine line every metre, a groove every four
  const lineA = kind === "surf" ? "rgba(190,170,255,0.55)" : "rgba(30,36,46,0.22)";
  g.strokeStyle = lineA; g.lineWidth = 2;
  for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(i * N / 4, 0); g.lineTo(i * N / 4, N); g.moveTo(0, i * N / 4); g.lineTo(N, i * N / 4); g.stroke(); }
  g.strokeStyle = kind === "surf" ? "rgba(220,205,255,0.9)" : "rgba(22,26,34,0.55)"; g.lineWidth = 5;
  g.strokeRect(0, 0, N, N);
  if (kind !== "surf") {
    g.fillStyle = "rgba(30,34,42,0.5)";
    for (const [x, y] of [[14, 14], [N - 14, 14], [14, N - 14], [N - 14, N - 14]]) { g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill(); }
  }
  // height: grooves along the seams and the metre lines
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const ex = Math.min(x, N - 1 - x), ey = Math.min(y, N - 1 - y);
    const mx = Math.abs((x % (N / 4)) - N / 8) - N / 8 + 1, my = Math.abs((y % (N / 4)) - N / 8) - N / 8 + 1;
    let v = 1;
    if (ex < 4 || ey < 4) v = 0.2 + Math.min(ex, ey) * 0.18;
    else if (mx > -1.5 || my > -1.5) v = 0.75;
    h[y * N + x] = v;
  }
  const nc = document.createElement("canvas");
  nc.width = nc.height = N;
  const ng = nc.getContext("2d"), img = ng.createImageData(N, N);
  const s = kind === "surf" ? 1.2 : 2.4;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const xl = h[y * N + ((x - 1 + N) % N)], xr = h[y * N + ((x + 1) % N)], yu = h[((y - 1 + N) % N) * N + x], yd = h[((y + 1) % N) * N + x];
    let nx = (xl - xr) * s, ny = (yu - yd) * s, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const o = (y * N + x) * 4;
    img.data[o] = (nx * 0.5 + 0.5) * 255; img.data[o + 1] = (ny * 0.5 + 0.5) * 255; img.data[o + 2] = (nz * 0.5 + 0.5) * 255; img.data[o + 3] = 255;
  }
  ng.putImageData(img, 0, 0);
  const tex = (cv, srgb) => {
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return { map: tex(c, true), normalMap: tex(nc, false) };
}
const CLASS = { floor: "concrete", wall: "concrete", block: "concrete", slope: "concrete", crate: "concrete", trim: "metal", shaft: "metal", core: "metal", canopy: "metal", surf: "surf" };

let mapGroup = null;
const pads = [];
export function buildArena() {
  if (mapGroup) return;
  const W = world();
  mapGroup = new THREE.Group();
  const buckets = {};
  const bucket = (k) => (buckets[k] = buckets[k] || { pos: [], nor: [], uv: [], col: [] });
  const padPos = [], padNor = [], edges = [];
  const color = new THREE.Color();
  for (const b of W.brushes) {
    const K = KINDS[b.kind] || KINDS.wall;
    if (K.invisible) continue;
    color.setHex(K.color).convertSRGBToLinear();
    if (b.kind === "pad") pads.push(new THREE.Vector3((b.min[0] + b.max[0]) / 2, b.max[1], (b.min[2] + b.max[2]) / 2));
    const B = b.kind === "pad" ? null : bucket(CLASS[b.kind] || "concrete");
    for (const f of b.faces) {
      const n = f.n;
      if (n[1] < -0.9 && b.min[1] <= 0.01) continue;            // undersides nobody sees
      const vs = f.idx.map((i) => b.verts[i]);
      if (vs.every((v) => v[1] <= 0) && b.kind !== "floor") continue;  // below the floor
      const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
      const proj = ay >= ax && ay >= az ? (v) => [v[0] / 4, v[2] / 4] : ax >= az ? (v) => [v[2] / 4, v[1] / 4] : (v) => [v[0] / 4, v[1] / 4];
      for (let i = 1; i < vs.length - 1; i++) {
        for (const v of [vs[0], vs[i], vs[i + 1]]) {
          if (!B) { padPos.push(v[0], v[1], v[2]); padNor.push(n[0], n[1], n[2]); continue; }
          B.pos.push(v[0], v[1], v[2]); B.nor.push(n[0], n[1], n[2]);
          const q = proj(v); B.uv.push(q[0], q[1]); B.col.push(color.r, color.g, color.b);
        }
      }
      for (let i = 0; i < vs.length; i++) { const a = vs[i], c = vs[(i + 1) % vs.length]; edges.push(a[0], a[1], a[2], c[0], c[1], c[2]); }
    }
  }
  for (const k in buckets) {
    const B = buckets[k];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(B.pos, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(B.nor, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(B.uv, 2));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(B.col, 3));
    const s = surface(k);
    const mat = new THREE.MeshStandardMaterial({
      map: s.map, normalMap: s.normalMap, normalScale: new THREE.Vector2(0.8, 0.8), vertexColors: true,
      roughness: k === "metal" ? 0.5 : k === "surf" ? 0.3 : 0.9, metalness: k === "metal" ? 0.25 : k === "surf" ? 0.1 : 0.0,
      emissive: k === "surf" ? 0x2a1d66 : 0x000000, emissiveIntensity: k === "surf" ? 0.7 : 0, envMapIntensity: k === "concrete" ? 0.25 : 0.6
    });
    if (k === "surf") mat.emissiveMap = s.map;
    // the low tier is for weak phones: the same textures, lit the cheap way, and no shadows
    const cheapMat = new THREE.MeshLambertMaterial({ map: s.map, vertexColors: true, emissive: mat.emissive, emissiveIntensity: mat.emissiveIntensity, emissiveMap: mat.emissiveMap || null });
    const mesh = new THREE.Mesh(geo, tier === "low" ? cheapMat : mat);
    mesh.userData.mats = { full: mat, cheap: cheapMat };
    mesh.receiveShadow = true; mesh.castShadow = true;
    mapGroup.add(mesh);
  }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute("position", new THREE.Float32BufferAttribute(padPos, 3));
  pg.setAttribute("normal", new THREE.Float32BufferAttribute(padNor, 3));
  mapGroup.add(new THREE.Mesh(pg, new THREE.MeshStandardMaterial({ color: 0x3cff8a, emissive: 0x2bff7a, emissiveIntensity: 1.4, roughness: 0.4 })));
  const eg = new THREE.BufferGeometry();
  eg.setAttribute("position", new THREE.Float32BufferAttribute(edges, 3));
  mapGroup.add(new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: 0x0a0f18, transparent: true, opacity: 0.32 })));
  scene.add(mapGroup);
  // a ring of light rising off every jump pad, so they read from across the map
  for (const p of pads) {
    for (let k = 0; k < 2; k++) {
      const r = new THREE.Mesh(ringGeo, ringMat.clone());
      r.rotation.x = -Math.PI / 2; r.position.copy(p); r.userData.k = k * 0.5; r.userData.y0 = p.y;
      scene.add(r); padRings.push(r);
    }
  }
}
const ringGeo = new THREE.RingGeometry(1.15, 1.45, 40);
const ringMat = new THREE.MeshBasicMaterial({ color: 0x5dffa0, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: true });
const padRings = [];
function updatePads(t) {
  for (const r of padRings) {
    const k = ((t * 0.7 + r.userData.k) % 1);
    r.position.y = r.userData.y0 + 0.05 + k * 2.4;
    r.scale.setScalar(1 - k * 0.35);
    r.material.opacity = (1 - k) * 0.55;
  }
}

/* ---------------------------------------------------------------
   Tracers, sparks, holes, rounds in flight
   --------------------------------------------------------------- */
const cyl = new THREE.CylinderGeometry(1, 1, 1, 6, 1);
const UP = new THREE.Vector3(0, 1, 0);
const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3(), vD = new THREE.Vector3(), qTmp = new THREE.Quaternion(), sTmp = new THREE.Vector3();
function segment(m, a, b, r) {
  vD.subVectors(b, a);
  const len = vD.length() || 0.001;
  qTmp.setFromUnitVectors(UP, vD.multiplyScalar(1 / len));
  sTmp.set(r, len, r);
  vA.addVectors(a, b).multiplyScalar(0.5);
  m.matrix.compose(vA, qTmp, sTmp);
}
const TRACERS = [];
const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffd98a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
for (let i = 0; i < 40; i++) { const m = new THREE.Mesh(cyl, tracerMat.clone()); m.visible = false; m.matrixAutoUpdate = false; m.frustumCulled = false; scene.add(m); TRACERS.push({ m, t: 0 }); }
let tracerI = 0;
const muzzleTmp = new THREE.Vector3();
/** A tracer from `from` to `to`. Yours start at your gun's muzzle as your screen shows it; anybody else's at theirs. */
export function tracer(from, to, color, mine, who) {
  const T = TRACERS[tracerI++ % TRACERS.length];
  if (mine && muzzleWorld(camera, muzzleTmp)) vB.copy(muzzleTmp);
  else if (!mine && who != null && muzzleOf(who, muzzleTmp)) vB.copy(muzzleTmp);
  else vB.set(from[0], from[1], from[2]);
  segment(T.m, vB, vC.set(to[0], to[1], to[2]), 0.01);
  T.m.material.color.setHex(color || 0xffd98a);
  T.m.visible = true; T.t = 0.08;
  if (mine) { muzzleLight.position.copy(camera.position); muzzleLight.intensity = 14; }
}
const SPARKS = 400;
const sparkGeo = new THREE.BufferGeometry();
const sparkPos = new Float32Array(SPARKS * 3), sparkCol = new Float32Array(SPARKS * 3);
const sparkVel = new Float32Array(SPARKS * 3), sparkLife = new Float32Array(SPARKS);
sparkGeo.setAttribute("position", new THREE.BufferAttribute(sparkPos, 3));
sparkGeo.setAttribute("color", new THREE.BufferAttribute(sparkCol, 3));
const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({ size: 0.07, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
sparks.frustumCulled = false;
scene.add(sparks);
let sparkI = 0;
export function burst(x, y, z, n, color, speed) {
  const c = new THREE.Color(color || 0xffd070);
  for (let k = 0; k < n; k++) {
    const i = sparkI++ % SPARKS;
    sparkPos[i * 3] = x; sparkPos[i * 3 + 1] = y; sparkPos[i * 3 + 2] = z;
    const s = (speed || 4) * (0.3 + Math.random());
    sparkVel[i * 3] = (Math.random() - 0.5) * s; sparkVel[i * 3 + 1] = Math.random() * s; sparkVel[i * 3 + 2] = (Math.random() - 0.5) * s;
    sparkCol[i * 3] = c.r; sparkCol[i * 3 + 1] = c.g; sparkCol[i * 3 + 2] = c.b;
    sparkLife[i] = 0.35 + Math.random() * 0.3;
  }
}
/* Puffs: dust off a wall, a red mist off a body. Soft sprites that grow and fade. */
const puffTex = (() => {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d"), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, "rgba(255,255,255,0.9)"); r.addColorStop(0.5, "rgba(255,255,255,0.35)"); r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
const PUFFS = [];
for (let i = 0; i < 48; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, transparent: true, depthWrite: false, opacity: 0 })); s.visible = false; scene.add(s); PUFFS.push({ s, t: 0, life: 1, grow: 1, vy: 0 }); }
let puffI = 0;
export function puff(x, y, z, color, size, life) {
  const P = PUFFS[puffI++ % PUFFS.length];
  P.s.position.set(x, y, z); P.s.material.color.setHex(color); P.s.visible = true;
  P.t = 0; P.life = life || 0.5; P.size = size || 0.4; P.vy = 0.4;
}
/* Holes where shots meet walls: a pool of small dark discs laid on the surface. */
const holeTex = (() => {
  const c = document.createElement("canvas"); c.width = c.height = 32;
  const g = c.getContext("2d"), r = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  r.addColorStop(0, "rgba(8,8,10,1)"); r.addColorStop(0.35, "rgba(20,20,24,0.95)"); r.addColorStop(0.55, "rgba(40,40,46,0.5)"); r.addColorStop(1, "rgba(60,60,66,0)");
  g.fillStyle = r; g.fillRect(0, 0, 32, 32);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
const HOLES = [];
const holeMat = new THREE.MeshBasicMaterial({ map: holeTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
const holeGeo = new THREE.PlaneGeometry(0.11, 0.11);
for (let i = 0; i < 90; i++) { const m = new THREE.Mesh(holeGeo, holeMat.clone()); m.visible = false; scene.add(m); HOLES.push({ m, t: 0 }); }
let holeI = 0;
const nTmp = new THREE.Vector3(), Z = new THREE.Vector3(0, 0, 1);
export function hole(x, y, z, nx, ny, nz) {
  if (!(nx || ny || nz)) return;
  const H = HOLES[holeI++ % HOLES.length];
  nTmp.set(nx, ny, nz).normalize();
  H.m.position.set(x, y, z).addScaledVector(nTmp, 0.005);
  H.m.quaternion.setFromUnitVectors(Z, nTmp);
  H.m.rotateZ(Math.random() * 6.28);
  H.m.scale.setScalar(0.7 + Math.random() * 0.6);
  H.m.visible = true; H.t = 12; H.m.material.opacity = 1;
}
function updateEffects(dt) {
  for (const T of TRACERS) if (T.m.visible) { T.t -= dt; T.m.material.opacity = Math.max(0, T.t / 0.08) * 0.85; if (T.t <= 0) T.m.visible = false; }
  for (let i = 0; i < SPARKS; i++) {
    if (sparkLife[i] <= 0) { sparkPos[i * 3 + 1] = -999; continue; }
    sparkLife[i] -= dt;
    sparkVel[i * 3 + 1] -= 12 * dt;
    sparkPos[i * 3] += sparkVel[i * 3] * dt; sparkPos[i * 3 + 1] += sparkVel[i * 3 + 1] * dt; sparkPos[i * 3 + 2] += sparkVel[i * 3 + 2] * dt;
  }
  sparkGeo.attributes.position.needsUpdate = true;
  sparkGeo.attributes.color.needsUpdate = true;
  for (const P of PUFFS) {
    if (!P.s.visible) continue;
    P.t += dt;
    const k = P.t / P.life;
    if (k >= 1) { P.s.visible = false; continue; }
    P.s.scale.setScalar(P.size * (0.5 + k * 1.2));
    P.s.position.y += P.vy * dt;
    P.s.material.opacity = (1 - k) * 0.7;
  }
  for (const H of HOLES) if (H.m.visible) { H.t -= dt; if (H.t < 2) H.m.material.opacity = Math.max(0, H.t / 2); if (H.t <= 0) H.m.visible = false; }
  muzzleLight.intensity = Math.max(0, muzzleLight.intensity - dt * 220);
}
const rounds = [];
const roundMat = new THREE.MeshBasicMaterial({ color: 0xfff1c0, fog: false });
const sph = new THREE.SphereGeometry(1, 8, 6);
function updateRounds() {
  while (rounds.length < S.projectiles.length) { const m = new THREE.Mesh(sph, roundMat); m.scale.setScalar(0.05); scene.add(m); rounds.push(m); }
  rounds.forEach((m, i) => {
    const p = S.projectiles[i];
    m.visible = !!p;
    if (p) m.position.set(p.x, p.y, p.z);
  });
}

/* ---------------------------------------------------------------
   The camera
   --------------------------------------------------------------- */
const cam = { punch: 0, dip: 0, fovAdd: 0, slide: 0, slideKick: 0 };
export function landDip(v) { cam.dip = Math.min(0.25, cam.dip + v * 0.02); }
export function punch(p) { cam.punch += p; }
/** A horizontal field of view, as Source measures it, for this screen's shape. */
function vfov(hdeg) {
  const aspect = Math.max(1.25, camera.aspect);
  return 2 * Math.atan(Math.tan(hdeg * Math.PI / 360) / aspect) * 180 / Math.PI;
}
function placeCamera(alpha, dt) {
  const a = S.me;
  if (!a) return;
  const hv = S.hackView || {};
  const target = !a.alive && S.spectate ? S.spectate : a;
  const p = renderPos(target, alpha);
  const b = target.body;
  cam.dip = damp(cam.dip, 0, 9, dt);
  cam.punch = damp(cam.punch, 0, 12, dt);
  const eye = p[1] + b.eye - cam.dip;
  const hs = Math.hypot(b.vx, b.vz);
  const yaw = target === a ? S.view.yaw : target.body.yaw, pitch = target === a ? S.view.pitch : target.body.pitch;
  camera.rotation.set(pitch + cam.punch, yaw, damp(camera.rotation.z, a.body.sliding ? 0.06 : 0, 8, dt));
  const third = hv.thirdPerson || !a.alive;
  if (third) {
    const f = [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
    const dist = 3.2;
    const W = world();
    const t = camTrace(W, p[0], eye, p[2], p[0] - f[0] * dist, eye - f[1] * dist + 0.4, p[2] - f[2] * dist);
    camera.position.set(p[0] + (t.x - p[0]) * 0.92, eye + (t.y - eye) * 0.92, p[2] + (t.z - p[2]) * 0.92);
  } else camera.position.set(p[0], eye, p[2]);
  const base = hv.fov || save.settings.fov;
  const A = a.arms, g = gunOf(A);
  const zoom = g ? 1 + (g.adsZoom - 1) * A.ads : 1;
  cam.fovAdd = damp(cam.fovAdd, (a.body.sprinting ? 4 : 0) + clamp((hs - 8) * 0.7, 0, 12) + (a.body.lunge === LUNGE.DASH ? 6 : 0), 5, dt);
  // a slide widens the view by how fast it is going: quickly in, slowly back out, with a kick as it starts
  const slideWant = b.sliding ? clamp(3 + (hs - PM.slideStart) * 1.2, 3, 16) : 0;
  cam.slide = damp(cam.slide, slideWant, slideWant > cam.slide ? 10 : 3, dt);
  cam.slideKick = Math.max(0, cam.slideKick - dt * 3);
  const widen = save.settings.fovFx ? Math.min(24, cam.fovAdd + cam.slide + cam.slideKick * 5) : 0;
  camera.fov = vfov((base + widen * (1 - A.ads)) / zoom);
  camera.updateProjectionMatrix();
  S.cam.x = camera.position.x; S.cam.y = camera.position.y; S.cam.z = camera.position.z;
  S.cam.yaw = yaw; S.cam.pitch = pitch; S.cam.fov = camera.fov;
  S.cam.zoom = zoom;
}
const TT = newTrace();
function camTrace(W, x0, y0, z0, x1, y1, z1) { ray(W, x0, y0, z0, x1, y1, z1, TT); return TT; }

/* ---------------------------------------------------------------
   Projection, for tags, the hack overlay and the hack API
   --------------------------------------------------------------- */
const pv = new THREE.Vector3();
const vpm = new THREE.Matrix4();
export function worldToScreen(x, y, z, out) {
  out = out || {};
  pv.set(x, y, z).project(camera);
  const w = view.w, h = view.h;
  out.x = (pv.x * 0.5 + 0.5) * w; out.y = (-pv.y * 0.5 + 0.5) * h;
  out.behind = pv.z > 1 || pv.z < -1;
  out.visible = !out.behind && out.x >= 0 && out.x <= w && out.y >= 0 && out.y <= h;
  return out;
}
/** The view-projection matrix (column-major, as three.js stores it). */
export function viewProjection() {
  camera.updateMatrixWorld();
  vpm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  return Array.from(vpm.elements);
}

/* ---------------------------------------------------------------
   A frame
   --------------------------------------------------------------- */
let booted = false, clockT = 0;
function boot() {
  booted = true;
  initFigures(scene);
  environments();
  loadModels();
  on("tracer", (a, o, h) => { if (h.world && h.nx !== undefined) { hole(h.x, h.y, h.z, h.nx, h.ny, h.nz); puff(h.x + h.nx * 0.05, h.y + h.ny * 0.05, h.z + h.nz * 0.05, 0xb9b2a6, 0.35, 0.45); } else if (h.actor) puff(h.x, h.y, h.z, 0xb3202a, 0.3, 0.35); });
  on("move", (a, ev) => { if (a === S.me && ev === "slide") cam.slideKick = 1; });
  on("impact", (p, h) => { if (h.world && h.nx !== undefined) hole(h.x, h.y, h.z, h.nx, h.ny, h.nz); puff(h.x, h.y, h.z, h.actor ? 0xb3202a : 0xb9b2a6, 0.6, 0.6); });
}
export function frame(alpha, dt) {
  if (!booted) boot();
  watchFrameRate(dt);
  clockT += dt;
  if (!mapGroup) buildArena();
  placeCamera(alpha, dt);
  syncFigures(alpha, dt);
  updateViewmodel(dt, camera.aspect, S.cam.zoom || 1);
  updateEffects(dt);
  updateRounds();
  updatePads(clockT);
  sky.position.copy(camera.position);
  renderer.clear();
  renderer.render(scene, camera);
  if (vmVisible) {
    renderer.clearDepth();
    renderer.render(vScene, vCam);
  }
  S.cam.scoped = vmScoped;
}
/** Title screen: a slow orbit over the arena. */
export function idle(t, dt) {
  if (!booted) boot();
  if (!mapGroup) buildArena();
  clockT += dt;
  const r = 70;
  camera.position.set(Math.sin(t * 0.05) * r, 34, Math.cos(t * 0.05) * r);
  camera.rotation.set(-0.42, t * 0.05, 0);
  camera.fov = vfov(90); camera.updateProjectionMatrix();
  hideFigures();
  updateEffects(dt);
  updatePads(clockT);
  sky.position.copy(camera.position);
  renderer.clear();
  renderer.render(scene, camera);
}
