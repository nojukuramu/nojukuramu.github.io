/* render.js — the house in 3D, by lantern light.
 *
 * The renderer setup is Ballzooka's (ballzooka/js/render.js), which is
 * Bloomworks': the same vendored three r160, ACES tone mapping, an
 * UnrealBloomPass so that anything burning bleeds light, and a quality switch
 * that drops shadows and bloom on a slow phone. Everything else is this game's:
 *
 *   - the house is built from the layout: floors, wainscoted walls with a
 *     calado fretwork band along the top of every inner wall, a beamed
 *     ceiling, capiz windows, doors that swing, closets with louvred doors
 *     you can see out through, and Poly Haven furniture placed as the layout
 *     says;
 *   - the light is the lantern in your hand (a point light that throws
 *     shadows, so the furniture's shadows swing as you walk), the five lamps,
 *     lightning through the capiz, and almost nothing else — the eye adapts a
 *     little when you are in the dark, as eyes do;
 *   - one post pass after the tone mapping carries everything the research
 *     calls vague feedback: dread narrows the vignette, drains the colour,
 *     splits it at the edges and makes the picture breathe. No meter.
 *
 * Nothing here changes the game: it reads the state and the events game.js
 * leaves behind. */

import * as THREE from "three";
import { EffectComposer } from "../vendor/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "../vendor/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "../vendor/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "../vendor/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "../vendor/jsm/postprocessing/OutputPass.js";
import { GLTFLoader } from "../vendor/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "../vendor/jsm/utils/BufferGeometryUtils.js";
import { CELL, GW, GH, WALL_H, SOLID_H, DOOR_H, PROPS, WIN_Y0, WIN_Y1, WIN_W, POOL_R } from "./house.js";
import * as T from "./textures.js";
import { makeCreature } from "./creature.js";

const MODELS = ["lantern", "oil_lamp", "sofa", "armchair", "tea_table", "rocking_chair", "grandfather_clock", "screen", "painting", "dining_table", "chair", "china_cabinet", "jug", "bed", "iron_bed", "nightstand", "mirror", "commode", "santo", "candlestick", "bench", "pot", "bucket", "palayok", "table", "stool", "gallinera", "side_table", "sungka", "drawers", "crate", "bookshelf", "vase", "photo"];
export const MODEL_FILES = MODELS.map((m) => "assets/models/" + m + ".glb");
const TEXTURES = ["floor", "plaster", "panels", "ceiling", "tiles", "cabinet", "damaged"];
export const TEXTURE_FILES = TEXTURES.flatMap((t) => ["", "_n", "_arm"].map((s) => "assets/textures/" + t + s + ".webp"));

let renderer, scene, camera, composer, bloom, post, outPass;
let quality = "high", motion = true, scares = "full", fov = 72;
let world = null, wallGroup = null;
const M = {};            // materials
const tpl = {};          // loaded model templates
let loaded = 0, total = 0, ready = false;
let lanternVM, lanternFlame, lanternGlow, lanternLight, hemi, lightning, dust, moon;
const lampLights = [];
let creature = null;
let H = null;            // the handles of the house being drawn: doors, closets, lamps...
let flashT = 0, flashPow = 0, flashes = [], shake = 0, adapt = 0, bob = 0, bobAmp = 0, killT = -1, fadeIn = 0, raise = 0, lean = 0;
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();

/* ------------------------------------------------------------------ */
/* Setup                                                              */

export function init(canvas, onProgress) {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  scene = new THREE.Scene();
  scene.background = new THREE.Color("#010102");
  scene.fog = new THREE.FogExp2("#020203", 0.075);
  camera = new THREE.PerspectiveCamera(fov, 1, 0.04, 60);
  camera.rotation.order = "YXZ";
  scene.add(camera);

  hemi = new THREE.HemisphereLight("#a8bde0", "#3a332c", 0.04);
  scene.add(hemi);
  // lightning: a cold light from outside, through the capiz
  lightning = new THREE.DirectionalLight("#c4d2ff", 0);
  lightning.castShadow = true;
  lightning.shadow.mapSize.set(1024, 1024);
  lightning.shadow.autoUpdate = false;
  Object.assign(lightning.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 70 });
  lightning.shadow.bias = -0.002;
  scene.add(lightning, lightning.target);
  // the front door, at the end: cold light where the way out is. Made now and
  // left dark, so the number of lights never changes (a change recompiles
  // every shader, and that would land on the night's biggest moment)
  moon = new THREE.PointLight("#9fb6ff", 0, 8, 2);
  scene.add(moon);
  for (let i = 0; i < 3; i++) {
    const l = new THREE.PointLight("#ff9a4e", 0, 9, 2);
    l.castShadow = false;
    scene.add(l);
    lampLights.push(l);
  }

  // the lantern in your hand
  lanternVM = new THREE.Group();
  camera.add(lanternVM);
  lanternLight = new THREE.PointLight("#ffa45c", 6, 11, 2);
  lanternLight.castShadow = true;
  lanternLight.shadow.mapSize.set(512, 512);
  lanternLight.shadow.camera.near = 0.08;
  lanternLight.shadow.camera.far = 11;
  lanternLight.shadow.bias = -0.004;
  lanternLight.shadow.radius = 3;
  camera.add(lanternLight);
  const fl = new THREE.SpriteMaterial({ map: T.flame(), color: "#ffffff", blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  lanternFlame = new THREE.Sprite(fl);
  lanternFlame.scale.set(0.022, 0.044, 1);
  lanternGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.glow(), color: "#ff9a40", blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.5 }));
  lanternGlow.scale.set(0.16, 0.16, 1);
  lanternVM.add(lanternFlame, lanternGlow);

  // dust in the air, only ever seen in the lantern's light
  const n = 220, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { pos[i * 3] = (Math.random() - 0.5) * 4; pos[i * 3 + 1] = 0.3 + Math.random() * 2.4; pos[i * 3 + 2] = (Math.random() - 0.5) * 4; }
  const dg = new THREE.BufferGeometry(); dg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  dust = new THREE.Points(dg, new THREE.PointsMaterial({ color: "#ffd2a0", map: T.glow(), size: 0.01, transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending, fog: true }));
  scene.add(dust);

  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.45, 0.82);
  composer.addPass(bloom);
  outPass = new OutputPass();
  composer.addPass(outPass);
  post = new ShaderPass(POST);
  composer.addPass(post);

  materials();
  creature = makeCreature(T);
  scene.add(creature.group);
  load(onProgress);
  resize();
  window.addEventListener("resize", resize);
}

/* The horror pass: after tone mapping, in display space. */
const POST = {
  uniforms: {
    tDiffuse: { value: null }, time: { value: 0 }, dread: { value: 0 }, chroma: { value: 0 }, vign: { value: 0 },
    grain: { value: 0.05 }, flash: { value: 0 }, fade: { value: 0 }, red: { value: 0 }, desat: { value: 0 }, res: { value: new THREE.Vector2(1, 1) }, blue: { value: 0 }
  },
  vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float time, dread, chroma, vign, grain, flash, fade, red, desat, blue; uniform vec2 res;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5;
      // dread: the picture breathes, a slow barrel in and out
      float br = dread * 0.035 * (0.55 + 0.45 * sin(time * 1.6));
      vec2 uv = 0.5 + c * (1.0 - br * dot(c, c) * 4.0);
      float ca = chroma * 0.012 * length(c);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + c * ca).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - c * ca).b;
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, vec3(l), desat);
      // the eye in the dark: what little there is goes blue-grey
      col = mix(col, vec3(l * 0.75, l * 0.85, l * 1.15), blue);
      float d = length(c * vec2(1.0, 0.85));
      float v = smoothstep(0.78 - vign * 0.3, 0.18 - vign * 0.12, d);
      col *= mix(1.0, v, 0.9);
      float n = hash(vUv * res + fract(time * 37.0) * 91.0) - 0.5;
      col += n * grain;
      col = mix(col, vec3(0.45, 0.0, 0.0) * (0.5 + l), red);
      col += vec3(0.85, 0.9, 1.0) * flash;
      col *= 1.0 - fade;
      gl_FragColor = vec4(col, 1.0);
    }`
};

function loadTex(name, srgb, repeat) {
  const t = new THREE.TextureLoader().load("assets/textures/" + name + ".webp", () => step(), undefined, () => step());
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (repeat) t.repeat.set(repeat, repeat);
  total++;
  return t;
}
let progressFn = null;
function step() { loaded++; if (progressFn) progressFn(loaded / Math.max(1, total)); if (loaded >= total) { ready = true; if (progressFn) progressFn(1); } }

function pbr(name, color, rough) {
  // arm: ambient occlusion in red, roughness in green
  const arm = loadTex(name + "_arm");
  return new THREE.MeshStandardMaterial({
    map: loadTex(name, true), normalMap: loadTex(name + "_n"), aoMap: arm, roughnessMap: arm,
    color: color || "#ffffff", roughness: rough === undefined ? 1 : rough, metalness: 0, normalScale: new THREE.Vector2(1, 1)
  });
}

function materials() {
  M.floor = pbr("floor", "#c9b8a8");
  M.tiles = pbr("tiles", "#d8c0b0");
  M.plaster = pbr("plaster", "#cfc6b6");
  M.damaged = pbr("damaged", "#c0b7a4");
  M.panels = pbr("panels", "#a89080");
  M.ceiling = pbr("ceiling", "#8d7866");
  M.cabinet = pbr("cabinet", "#b49a86");
  M.trim = new THREE.MeshStandardMaterial({ color: "#2c1a0f", roughness: 0.7, map: M.cabinet.map });
  M.calado = new THREE.MeshStandardMaterial({ color: "#5a3a24", map: M.cabinet.map, alphaMap: T.calado(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8 });
  M.capiz = new THREE.MeshStandardMaterial({ map: T.capiz(), color: "#d8d0bf", roughness: 0.55, emissive: new THREE.Color("#9fb4ff"), emissiveIntensity: 0, side: THREE.DoubleSide });
  M.paper = new THREE.MeshStandardMaterial({ map: T.paper(), roughness: 0.9, side: THREE.DoubleSide });
  M.tin = new THREE.MeshStandardMaterial({ color: "#7a2e1c", roughness: 0.55, metalness: 0.6 });
  M.tinCap = new THREE.MeshStandardMaterial({ color: "#b8a070", roughness: 0.4, metalness: 0.8 });
  M.brass = new THREE.MeshStandardMaterial({ color: "#b08a40", roughness: 0.35, metalness: 0.9 });
  M.board = new THREE.MeshStandardMaterial({ color: "#6e5640", map: M.cabinet.map, roughness: 0.9 });
  M.rubble = new THREE.MeshStandardMaterial({ color: "#8a8070", map: M.damaged.map, roughness: 1 });
  M.dark = new THREE.MeshStandardMaterial({ color: "#050403", roughness: 1 });
  M.globe = new THREE.MeshBasicMaterial({ color: "#ffb36b", transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false });
  M.flame = new THREE.SpriteMaterial({ map: T.flame(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  M.glow = new THREE.SpriteMaterial({ map: T.glow(), color: "#ff8a35", blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55 });
}

function load(onProgress) {
  progressFn = onProgress;
  const loader = new GLTFLoader();
  for (const m of MODELS) {
    total++;
    loader.load("assets/models/" + m + ".glb", (g) => {
      g.scene.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true; o.receiveShadow = true;
        for (const mat of [].concat(o.material)) { if (mat.transparent) { mat.depthWrite = false; o.castShadow = false; } mat.envMapIntensity = 0; }
      });
      tpl[m] = g.scene;
      step();
    }, undefined, () => step());
  }
}
export const isReady = () => ready;
export const progress = () => loaded / Math.max(1, total);

export function setQuality(q) {
  quality = q;
  if (!renderer) return;
  const hi = q === "high";
  renderer.shadowMap.enabled = hi;
  lanternLight.castShadow = hi;
  lightning.castShadow = hi;
  bloom.enabled = hi;
  scene.traverse((o) => { if (o.material) for (const m of [].concat(o.material)) m.needsUpdate = true; });
  resize();
}
export function setMotion(v) { motion = !!v; }
export function setScares(v) { scares = v; }
export function setFov(v) { fov = v; if (camera) { camera.fov = fov; camera.updateProjectionMatrix(); } }
export function setBrightness(v) { if (renderer) renderer.toneMappingExposure = 0.8 + v * 0.5; }

export function resize() {
  if (!renderer) return;
  const w = window.innerWidth, h = window.innerHeight;
  const dpr = Math.min(quality === "high" ? 1.75 : 1, window.devicePixelRatio || 1);
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  composer.setPixelRatio(dpr);
  composer.setSize(w, h);
  bloom.resolution.set(w / 2, h / 2);
  post.uniforms.res.value.set(w * dpr, h * dpr);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  placeLantern();
}

/* The lantern sits low and to the right; on a tall phone it moves in so it stays on screen. */
function placeLantern() {
  if (!lanternVM) return;
  const a = camera.aspect;
  lanternVM.userData.home = new THREE.Vector3(a < 0.8 ? 0.11 : 0.22, -0.24, -0.5);
}

/* ------------------------------------------------------------------ */
/* Geometry helpers: boxes with world-space UVs, merged per material  */

class Acc {
  constructor() { this.p = []; this.n = []; this.u = []; }
  quad(a, b, c, d, n, ua, ub, uc, ud) {
    for (const [v, uv] of [[a, ua], [b, ub], [c, uc], [a, ua], [c, uc], [d, ud]]) { this.p.push(v[0], v[1], v[2]); this.n.push(n[0], n[1], n[2]); this.u.push(uv[0], uv[1]); }
  }
  /* A box, UVs in metres divided by `s` (the texture's size in metres). skip: faces to leave out. */
  box(x0, y0, z0, x1, y1, z1, s, skip) {
    skip = skip || "";
    const k = 1 / (s || 1);
    if (!skip.includes("+x")) this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], [-z1 * k, y0 * k], [-z0 * k, y0 * k], [-z0 * k, y1 * k], [-z1 * k, y1 * k]);
    if (!skip.includes("-x")) this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], [z0 * k, y0 * k], [z1 * k, y0 * k], [z1 * k, y1 * k], [z0 * k, y1 * k]);
    if (!skip.includes("+z")) this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], [x0 * k, y0 * k], [x1 * k, y0 * k], [x1 * k, y1 * k], [x0 * k, y1 * k]);
    if (!skip.includes("-z")) this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], [-x1 * k, y0 * k], [-x0 * k, y0 * k], [-x0 * k, y1 * k], [-x1 * k, y1 * k]);
    if (!skip.includes("+y")) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], [x0 * k, -z1 * k], [x1 * k, -z1 * k], [x1 * k, -z0 * k], [x0 * k, -z0 * k]);
    if (!skip.includes("-y")) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], [x0 * k, z0 * k], [x1 * k, z0 * k], [x1 * k, z1 * k], [x0 * k, z1 * k]);
  }
  geo() {
    if (!this.p.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.u, 2));
    return g;
  }
}

/* Accumulators per material per 8 m chunk, so the lantern's shadow pass only
   draws the chunks near it. */
function chunker() {
  const m = new Map();
  return {
    at(mat, x, z) {
      const k = mat + ":" + Math.floor(x / 8) + "," + Math.floor(z / 8);
      if (!m.has(k)) m.set(k, { mat, acc: new Acc() });
      return m.get(k).acc;
    },
    meshes(group, opts) {
      for (const { mat, acc } of m.values()) {
        const g = acc.geo();
        if (!g) continue;
        const mesh = new THREE.Mesh(g, M[mat]);
        mesh.castShadow = opts.cast !== false; mesh.receiveShadow = true;
        group.add(mesh);
      }
    }
  };
}

/* ------------------------------------------------------------------ */
/* Building the house                                                 */

export function build(g) {
  if (world) { scene.remove(world); dispose(world); }
  world = new THREE.Group();
  scene.add(world);
  const L = g.L;
  H = { doors: [], closets: [], lamps: [], props: [], tins: [], notes: [], windows: [], kicks: [], boards: [] };

  // floors and ceilings, one quad each per room, and the beams
  const fc = chunker();
  for (const rm of L.rooms) {
    const x0 = rm.x * CELL, z0 = rm.z * CELL, x1 = (rm.x + rm.w) * CELL, z1 = (rm.z + rm.h) * CELL;
    fc.at(rm.floor === "tiles" ? "tiles" : "floor", rm.cx, rm.cz).box(x0, -0.1, z0, x1, 0, z1, rm.floor === "tiles" ? 1.4 : 2.2, "+x-x+z-z-y");
    fc.at("ceiling", rm.cx, rm.cz).box(x0, WALL_H, z0, x1, WALL_H + 0.1, z1, 2.4, "+x-x+z-z+y");
    // beams across the shorter way
    const alongX = rm.w <= rm.h;
    const span = alongX ? x1 - x0 : z1 - z0, run = alongX ? z1 - z0 : x1 - x0;
    for (let t = 1.3; t < run - 0.5; t += 1.45) {
      if (alongX) fc.at("trim", rm.cx, rm.cz).box(x0, WALL_H - 0.2, z0 + t - 0.08, x1, WALL_H, z0 + t + 0.08, 1.5);
      else fc.at("trim", rm.cx, rm.cz).box(x0 + t - 0.08, WALL_H - 0.2, z0, x0 + t + 0.08, WALL_H, z1, 1.5);
    }
    void span;
  }
  const floors = new THREE.Group();
  fc.meshes(floors, { cast: false });
  world.add(floors);
  buildWalls(L);

  // doors
  for (const d of L.doors) H.doors[d.id] = makeDoor(L, d);
  // windows
  for (const w of L.windows) H.windows[w.id] = makeWindow(w);
  // furniture
  for (const p of L.props) {
    if (p.kind === "closet" || p.gone) continue;
    const o = propMesh(p.kind);
    o.position.set(p.x, p.y, p.z);
    o.rotation.y = p.rot;
    world.add(o);
    H.props[p.id] = o;
    if (p.kind === "grandfather_clock") H.clock = o;
  }
  for (const c of L.closets) H.closets[c.id] = makeCloset(c);
  // lamps
  for (const l of L.lamps) H.lamps[l.id] = makeLamp(l);
  for (const t of L.tins) {
    const o = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.15, 14), M.tin);
    body.position.y = 0.075;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.03, 8), M.tinCap);
    cap.position.set(0.025, 0.16, 0);
    o.add(body, cap);
    o.position.set(t.x, t.y, t.z);
    o.traverse((m) => { if (m.isMesh) m.castShadow = true; });
    world.add(o);
    H.tins[t.id] = o;
  }
  for (const n of L.notes) {
    const o = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.19), M.paper);
    o.rotation.x = -Math.PI / 2; o.rotation.z = n.rot;
    o.position.set(n.x, n.y + 0.004, n.z);
    o.receiveShadow = true;
    world.add(o);
    H.notes[n.id] = o;
  }
  creature.reset();
  // the moon, and every flash of lightning, come from one side of the house,
  // low enough to fall through the capiz onto the floor
  lightning.position.set(L.W / 2 + 24, 12, L.D / 2 + 17);
  lightning.target.position.set(L.W / 2, 0, L.D / 2);
  lightning.target.updateMatrixWorld();
  lightning.shadow.needsUpdate = true;
  killT = -1; fadeIn = 1;
  // compile every shader now, the creature's included, so its first
  // appearance is a fright and not a stutter
  creature.group.visible = true;
  try { renderer.compile(scene, camera); } catch (e) { /* compiled lazily instead */ }
  creature.group.visible = false;
}

function dispose(o) {
  o.traverse((m) => { if (m.isMesh && m.geometry && !m.userData.shared) m.geometry.dispose(); });
}

/* Walls: every run, cut round its doorways and windows, panelled to a metre,
   plastered above, with a chair rail, a skirting board, and — on the inside
   walls — the calado band from the top of the plaster to the ceiling. */
function buildWalls(L) {
  if (wallGroup) { world.remove(wallGroup); dispose(wallGroup); }
  wallGroup = new THREE.Group();
  const ch = chunker();
  const WAIN = 1.0;
  for (const w of L.walls) {
    const top = w.ext ? WALL_H : SOLID_H;
    const t = w.t, half = t / 2;
    // the pieces of this run: [a, b, y0, y1]
    const pieces = [];
    let a = w.a - (w.ext ? half : 0);
    const end = w.b + (w.ext ? half : 0);
    for (const h of w.holes) {
      if (h.a > a) pieces.push([a, h.a, 0, top]);
      if (h.window !== undefined) { pieces.push([h.a, h.b, 0, h.y0]); pieces.push([h.a, h.b, h.y1, top]); }
      else pieces.push([h.a, h.b, h.y1, top]);
      a = h.b;
    }
    if (end > a) pieces.push([a, end, 0, top]);
    const mx = w.v ? w.c : (w.a + w.b) / 2, mz = w.v ? (w.a + w.b) / 2 : w.c;
    const plasterKind = L.seed % 3 === 0 && !w.ext ? "damaged" : "plaster";
    for (const [p0, p1, y0, y1] of pieces) {
      if (p1 - p0 < 0.005 || y1 - y0 < 0.005) continue;
      const B = (y0b, y1b, mat, s, grow) => {
        const g2 = grow || 0;
        if (w.v) ch.at(mat, mx, mz).box(w.c - half - g2, y0b, p0, w.c + half + g2, y1b, p1, s);
        else ch.at(mat, mx, mz).box(p0, y0b, w.c - half - g2, p1, y1b, w.c + half + g2, s);
      };
      // panelling below the rail, plaster above
      if (y0 < WAIN) B(y0, Math.min(WAIN, y1), "panels", 1.3);
      if (y1 > WAIN) B(Math.max(WAIN, y0), y1, plasterKind, 2.6);
      if (y0 <= 0.001) B(0, 0.12, "trim", 1, 0.012);
      if (y0 < WAIN && y1 > WAIN) B(WAIN - 0.03, WAIN + 0.03, "trim", 1, 0.015);
    }
    // frames round every doorway and window
    for (const h of w.holes) {
      const g2 = 0.02, fw = 0.08;
      const box = (p0, p1, y0, y1) => { if (w.v) ch.at("trim", mx, mz).box(w.c - half - g2, y0, p0, w.c + half + g2, y1, p1, 1); else ch.at("trim", mx, mz).box(p0, y0, w.c - half - g2, p1, y1, w.c + half + g2, 1); };
      if (h.door !== undefined && L.doors[h.door].kind === "broken") continue;
      box(h.a - fw, h.a, h.y0, h.y1 + fw);
      box(h.b, h.b + fw, h.y0, h.y1 + fw);
      box(h.a - fw, h.b + fw, h.y1, h.y1 + fw);
      if (h.window !== undefined) box(h.a - fw, h.b + fw, h.y0 - 0.05, h.y0);
    }
    // calado above the inner walls
    if (!w.ext) {
      const len = w.b - w.a;
      const geo = new THREE.PlaneGeometry(len, WALL_H - SOLID_H);
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * len + w.a) / 2.8, uv.getY(i));
      const mesh = new THREE.Mesh(geo, M.calado);
      mesh.position.set(w.v ? w.c : (w.a + w.b) / 2, (SOLID_H + WALL_H) / 2, w.v ? (w.a + w.b) / 2 : w.c);
      if (w.v) mesh.rotation.y = Math.PI / 2;
      mesh.castShadow = true;
      wallGroup.add(mesh);
      // and a beam along the top of the solid wall under it
      if (w.v) ch.at("trim", mx, mz).box(w.c - half - 0.02, SOLID_H, w.a, w.c + half + 0.02, SOLID_H + 0.07, w.b, 1);
      else ch.at("trim", mx, mz).box(w.a, SOLID_H, w.c - half - 0.02, w.b, SOLID_H + 0.07, w.c + half + 0.02, 1);
    }
  }
  // boards across sealed doorways, broken plaster round new holes
  for (const d of L.doors) {
    if (d.sealed) sealVisual(d, ch);
    if (d.kind === "broken") brokenVisual(d, ch);
  }
  ch.meshes(wallGroup, {});
  world.add(wallGroup);
}

function sealVisual(d, ch) {
  const half = 0.09, seed = d.id * 7;
  for (const side of [-1, 1]) for (let k = 0; k < 4; k++) {
    const y = 0.4 + k * 0.5 + ((seed + k) % 3) * 0.05;
    const tilt = (((seed + k * 3) % 5) - 2) * 0.06;
    const g = new THREE.BoxGeometry(d.w + 0.35, 0.16, 0.035);
    const m = new THREE.Mesh(g, M.board);
    m.position.set(d.x + (d.v ? side * half : 0), y, d.z + (d.v ? 0 : side * half));
    m.rotation.set(0, d.v ? Math.PI / 2 : 0, tilt);
    m.castShadow = true;
    wallGroup.add(m);
  }
  void ch;
}

function brokenVisual(d, ch) {
  // jagged plaster round the hole and rubble on the floor either side
  const r = (k) => ((Math.sin(d.id * 91.7 + k * 12.3) + 1) / 2);
  for (let k = 0; k < 10; k++) {
    const along = (r(k) - 0.5) * (d.w + 0.6), y = r(k + 20) * 0.25;
    const side = k % 2 ? 1 : -1, off = 0.25 + r(k + 40) * 0.6;
    const s = 0.06 + r(k + 60) * 0.12;
    const x = d.v ? d.x + side * off : d.x + along, z = d.v ? d.z + along : d.z + side * off;
    ch.at("rubble", x, z).box(x - s, y, z - s * 0.8, x + s, y + s * 0.7, z + s * 0.8, 0.5);
  }
}

function makeDoor(L, d) {
  if (d.kind !== "door" && d.kind !== "front") return null;
  const grp = new THREE.Group();
  const front = d.kind === "front";
  const leaves = front ? 2 : 1;
  const lw = (d.w - 0.04) / leaves, lh = front ? 2.46 : DOOR_H - 0.02;
  const out = [];
  // which side does it swing to: into room a
  const ra = L.rooms[d.a];
  const side = d.v ? (ra.cx < d.x ? -1 : 1) : (ra.cz < d.z ? -1 : 1);
  for (let i = 0; i < leaves; i++) {
    const pivot = new THREE.Group();
    const leaf = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(lw, lh, 0.05), M.cabinet);
    body.castShadow = true; body.receiveShadow = true;
    // panels: a raised frame on each face
    for (const s of [-1, 1]) {
      const pf = new THREE.Mesh(new THREE.BoxGeometry(lw * 0.7, lh * 0.36, 0.012), M.trim);
      pf.position.set(0, lh * 0.2, s * 0.03);
      const pf2 = pf.clone(); pf2.position.y = -lh * 0.22;
      leaf.add(pf, pf2);
    }
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), M.brass);
    knob.position.set(lw / 2 - 0.09, -0.12, 0.05);
    const knob2 = knob.clone(); knob2.position.z = -0.05;
    leaf.add(body, knob, knob2);
    const dir = i === 0 ? 1 : -1;
    leaf.position.set(dir * lw / 2, lh / 2, 0);
    if (dir < 0) leaf.rotation.y = Math.PI;
    pivot.add(leaf);
    const hingeAt = -d.w / 2 + 0.02 + (i === 0 ? 0 : d.w - 0.04);
    pivot.position.set(d.v ? 0 : hingeAt, 0, d.v ? hingeAt : 0);
    if (d.v) pivot.rotation.y = -Math.PI / 2;
    grp.add(pivot);
    // open means swung into room a: worked out from which way a turn about y carries the leaf
    out.push({ pivot, base: pivot.rotation.y, dir: dir * (d.v ? side : -side) });
  }
  grp.position.set(d.x, 0, d.z);
  world.add(grp);
  return { grp, leaves: out, a: d.open, v: d.v };
}

function makeWindow(w) {
  const grp = new THREE.Group();
  const sash = (WIN_W - 0.06) / 2, hgt = WIN_Y1 - WIN_Y0 - 0.04;
  const panes = [];
  for (let i = 0; i < 2; i++) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(sash, hgt), M.capiz);
    p.position.set((i ? 1 : -1) * sash / 2, (WIN_Y0 + WIN_Y1) / 2, i ? 0.025 : -0.025);
    p.castShadow = false; p.receiveShadow = true;
    grp.add(p);
    panes.push(p);
    // the sash frame
    const fr = new THREE.Mesh(new THREE.BoxGeometry(sash, 0.05, 0.05), M.trim);
    fr.position.set(p.position.x, WIN_Y0 + 0.02, p.position.z); grp.add(fr);
    const fr2 = fr.clone(); fr2.position.y = WIN_Y1 - 0.02; grp.add(fr2);
  }
  grp.position.set(w.x, 0, w.z);
  if (w.v) grp.rotation.y = Math.PI / 2;
  world.add(grp);
  return { grp, panes, open: 0 };
}

/* The aparador: a tall wardrobe with louvred doors — you can see out between
   the slats, and so can the lantern's light, if you leave it burning. */
const CL = { w: 1.1, d: 0.62, h: 2.15 };
let closetGeo = null;
function closetGeometry() {
  if (closetGeo) return closetGeo;
  const body = new Acc(), t = 0.03, { w, d, h } = CL;
  body.box(-w / 2, 0.08, -d / 2, w / 2, 0.08 + t, d / 2, 1);              // floor
  body.box(-w / 2, h - t, -d / 2, w / 2, h, d / 2, 1);                    // top
  body.box(-w / 2 - 0.03, h, -d / 2 - 0.03, w / 2 + 0.03, h + 0.08, d / 2 + 0.04, 1); // crown
  body.box(-w / 2, 0.08, -d / 2, -w / 2 + t, h, d / 2, 1);                // sides
  body.box(w / 2 - t, 0.08, -d / 2, w / 2, h, d / 2, 1);
  body.box(-w / 2, 0.08, -d / 2, w / 2, h, -d / 2 + t, 1);                // back
  for (const [fx, fz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) body.box(fx * (w / 2 - 0.05) - 0.03, 0, fz * (d / 2 - 0.05) - 0.03, fx * (w / 2 - 0.05) + 0.03, 0.08, fz * (d / 2 - 0.05) + 0.03, 1);
  // one door: stiles, rails, and slats at an angle
  const dw = w / 2 - 0.02, dh = h - 0.2;
  const door = [];
  const frame = new Acc();
  frame.box(0, 0, -0.012, 0.06, dh, 0.012, 1);
  frame.box(dw - 0.06, 0, -0.012, dw, dh, 0.012, 1);
  frame.box(0, 0, -0.012, dw, 0.08, 0.012, 1);
  frame.box(0, dh - 0.08, -0.012, dw, dh, 0.012, 1);
  frame.box(0, dh * 0.48, -0.012, dw, dh * 0.48 + 0.06, 0.012, 1);
  door.push(frame.geo());
  // slats far enough apart, and flat enough, that an eye pressed to them sees the room
  for (let y = 0.11; y < dh - 0.1; y += 0.085) {
    if (Math.abs(y - dh * 0.5) < 0.05) continue;
    const s = new THREE.BoxGeometry(dw - 0.12, 0.045, 0.008);
    s.rotateX(-0.5);
    s.translate(dw / 2, y, 0);
    door.push(s);
  }
  closetGeo = { body: body.geo(), door: mergeGeometries(door.map((g) => g.index ? g.toNonIndexed() : g)) };
  return closetGeo;
}

function makeCloset(c) {
  const geo = closetGeometry();
  const grp = new THREE.Group();
  const body = new THREE.Mesh(geo.body, M.cabinet);
  body.castShadow = body.receiveShadow = true; body.userData.shared = true;
  grp.add(body);
  const doors = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    const m = new THREE.Mesh(geo.door, M.cabinet);
    m.castShadow = m.receiveShadow = true; m.userData.shared = true;
    if (s < 0) { m.position.x = 0; } else { m.scale.x = -1; }
    pivot.add(m);
    pivot.position.set(s * (CL.w / 2 - 0.02), 0.14, CL.d / 2 + 0.015);
    if (s < 0) pivot.position.x = -(CL.w / 2 - 0.02);
    grp.add(pivot);
    doors.push({ pivot, s });
  }
  grp.position.set(c.x, 0, c.z);
  grp.rotation.y = c.rot;
  world.add(grp);
  return { grp, doors, open: 0, target: 0, rattle: 0 };
}

function makeLamp(l) {
  const grp = new THREE.Group();
  const m = propMesh("oil_lamp");
  grp.add(m);
  let flameMesh = null, fy = 0.42;
  m.traverse((o) => { if (o.isMesh && /flame/i.test(o.name + (o.material && o.material.name))) flameMesh = o; });
  if (flameMesh) {
    flameMesh.visible = false;
    m.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(flameMesh);
    fy = (b.min.y + b.max.y) / 2;
  }
  const f = new THREE.Sprite(M.flame.clone());
  f.scale.set(0.03, 0.06, 1); f.position.y = fy; f.visible = false;
  const glow = new THREE.Sprite(M.glow.clone());
  glow.scale.set(0.5, 0.5, 1); glow.position.y = fy; glow.visible = false;
  grp.add(f, glow);
  grp.position.set(l.x, l.y, l.z);
  world.add(grp);
  return { grp, flame: f, glow, fy, lit: false, flare: 0, flameMesh };
}

function propMesh(kind) {
  const t = tpl[kind];
  if (t) {
    const c = t.clone(true);
    c.traverse((o) => { if (o.isMesh) o.userData.shared = true; });
    return c;
  }
  // until (or unless) the model arrives: a box its size
  const P = PROPS[kind] || { w: 0.3, d: 0.3, h: 0.3 };
  const m = new THREE.Mesh(new THREE.BoxGeometry(P.w, P.h, Math.max(0.02, P.d)), M.cabinet);
  m.position.y = P.wall ? 0 : P.h / 2;
  m.castShadow = true;
  const grp = new THREE.Group(); grp.add(m);
  return grp;
}

/* ------------------------------------------------------------------ */
/* Events                                                             */

export function feed(events, g) {
  for (const e of events) {
    switch (e.type) {
      case "lightning": flashes.push({ t: 0, pow: e.power, side: Math.random(), placed: false }); break;
      case "kick": {
        const o = H.props[e.prop];
        if (o) { const dl = Math.hypot(e.dx, e.dz) || 1; H.kicks.push({ o, vx: e.dx / dl * 0.9, vz: e.dz / dl * 0.9, spin: (Math.random() - 0.5) * 6, t: 0.35 }); }
        break;
      }
      case "lampLit": { const h = H.lamps[e.id]; if (h) { h.lit = true; h.flare = 1; } break; }
      case "closetIn": case "closetOut": { const c = H.closets[e.id]; if (c) { c.open = 1; c.target = 0; } break; }
      case "closetRattle": { const c = H.closets[e.id]; if (c) c.rattle = 2.3; break; }
      case "closetRip": { const c = H.closets[e.id]; if (c) { c.open = 1.6; c.target = 1; c.rattle = 0; } shake = 1; break; }
      case "kill": killT = 0; shake = scares === "full" ? 1.4 : 0; break;
      case "respawn": killT = -1; fadeIn = 1; creature.reset(); break;
      case "flip": {
        buildWalls(g.L);
        for (const id of e.changes.moved) { const p = g.L.props[id], o = H.props[id]; if (o) o.rotation.y = p.rot; }
        for (const id of e.changes.sealed) { const d = H.doors[id]; if (d) d.a = 0; }
        for (const h of H.lamps) if (h) h.flare = 1.5;
        lightning.shadow.needsUpdate = true;
        break;
      }
      case "enter": { const w = H.windows[e.window]; if (w) w.open = 1; break; }
      case "flicker": lanternFlick = 1.4; break;
      case "chase": shake = Math.max(shake, 0.25); break;
    }
  }
}
let lanternFlick = 0, flashNow = 0;

/* ------------------------------------------------------------------ */
/* The frame                                                          */

export function draw(g, dt, view) {
  if (!renderer) return;
  const t = performance.now() / 1000;
  post.uniforms.time.value = t;
  if (!g || !H) { composer.render(); return; }
  const p = g.player, h = g.hunter;
  view = view || {};

  // --- camera ---
  const hiding = p.hiding >= 0;
  const c = hiding ? g.L.closets[p.hiding] : null;
  let yaw = p.yaw, pitch = p.pitch;
  let ex = p.x, ez = p.z, ey = p.eye;
  if (hiding) { ex = c.x + c.n[0] * 0.05; ez = c.z + c.n[1] * 0.05; ey = 1.52; }
  const moving = !hiding && p.moving;
  const sp = p.speed || 0;
  bob += dt * (sp > 3 ? 11 : 7.5) * (moving ? 1 : 0);
  bobAmp += ((moving ? Math.min(1, sp / 4.3) : 0) - bobAmp) * Math.min(1, dt * 6);
  const bobY = motion ? Math.sin(bob * 2) * 0.028 * bobAmp : 0, bobX = motion ? Math.cos(bob) * 0.02 * bobAmp : 0;
  lean += (((view.leanIn || 0)) - lean) * Math.min(1, dt * 8);
  shake = Math.max(0, shake - dt * 1.6);
  const sh = motion ? shake * shake * 0.06 : 0;
  camera.position.set(ex + Math.cos(yaw) * bobX * -1, ey + bobY + (Math.random() - 0.5) * sh, ez + Math.sin(yaw) * bobX + (Math.random() - 0.5) * sh);
  camera.rotation.set(pitch + (Math.random() - 0.5) * sh * 0.5, yaw + Math.PI, (motion ? bobX * 0.6 : 0) + lean * 0.05);
  camera.near = hiding ? 0.02 : 0.04;
  camera.updateProjectionMatrix();

  // --- the lantern ---
  const power = g.lanternPower;
  lanternFlick = Math.max(0, lanternFlick - dt);
  const near = h.active ? Math.max(0, 1 - g.hunterDist / 9) : 0;
  // it gutters when the thing is near: one honest tell among others
  const flick = 1 + 0.06 * Math.sin(t * 13.1) + 0.05 * Math.sin(t * 23.7 + 1.3) + (Math.random() - 0.5) * 0.08 + (near > 0.2 ? (Math.random() - 0.5) * near * 0.9 : 0) + (lanternFlick > 0 ? (Math.random() - 0.5) * 1.6 : 0);
  const lit = power > 0;
  const home = lanternVM.userData.home || new THREE.Vector3(0.24, -0.3, -0.52);
  raise += ((view.raise ? 1 : 0) + (g.act ? 0.7 : 0) - raise) * Math.min(1, dt * 6);
  const sway = motion ? Math.sin(bob) * 0.02 * bobAmp : 0;
  lanternVM.visible = (!hiding || lit) && !view.title;
  lanternVM.position.set(home.x - raise * 0.12 + sway, home.y + raise * 0.14 + bobY * 0.5 + (hiding ? -0.12 : 0), home.z + raise * 0.08);
  lanternVM.rotation.set(0, 0.25 - raise * 0.2, -sway * 2);
  if (tpl.lantern && !lanternVM.userData.model) {
    const m = tpl.lantern.clone(true);
    m.scale.setScalar(0.95);
    m.position.y = -0.15;
    m.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = false; o.receiveShadow = false;
      // the globe: the flame shows through it, warm, instead of a lit-up shell
      // and the brass: unlit by the point light sitting inside it, which would
      // blow it out white; a dark metal, the flame and its glow do the rest
      if (/glass/i.test(o.name + (o.material && o.material.name))) o.material = M.globe;
      else o.material = new THREE.MeshBasicMaterial({ map: o.material.map || null, color: "#4a3a2a" });
    });
    lanternVM.add(m);
    lanternVM.userData.model = m;
  }
  lanternFlame.position.set(0, -0.15 + 0.115, 0);
  lanternGlow.position.copy(lanternFlame.position);
  lanternFlame.visible = lit;
  lanternGlow.visible = lit;
  const fs = 0.6 + 0.4 * power;
  lanternFlame.scale.set(0.02 * fs * flick, 0.042 * fs * (0.9 + 0.2 * flick), 1);
  lanternGlow.material.opacity = 0.45 * power * flick;
  tmpV.set(lanternVM.position.x, lanternVM.position.y - 0.03, lanternVM.position.z);
  lanternLight.position.copy(tmpV);
  lanternLight.intensity = lit ? 7.5 * power * power * Math.max(0.2, flick) * (hiding ? 0.4 : 1) : 0;
  lanternLight.distance = 4 + 8 * power;

  // --- lamps ---
  const litLamps = [];
  for (const l of g.L.lamps) {
    const hl = H.lamps[l.id];
    if (!hl) continue;
    hl.flare = Math.max(0, hl.flare - dt * 0.8);
    const on = l.lit;
    hl.flame.visible = on; hl.glow.visible = on;
    if (hl.flameMesh) hl.flameMesh.visible = false;
    if (on) {
      const f = 1 + 0.07 * Math.sin(t * 11 + l.id * 3) + (Math.random() - 0.5) * 0.06;
      const big = 1 + hl.flare * 1.5 + (g.flipped ? 0.25 : 0);
      hl.flame.scale.set(0.03 * f * big, 0.065 * f * big, 1);
      hl.glow.material.opacity = 0.45 * f * Math.min(2, big);
      litLamps.push({ l, d: Math.hypot(l.x - camera.position.x, l.z - camera.position.z), f, big });
    }
  }
  litLamps.sort((a, b) => a.d - b.d);
  for (let i = 0; i < lampLights.length; i++) {
    const L = lampLights[i], q = litLamps[i];
    if (!q) { L.intensity = 0; continue; }
    L.position.set(q.l.x, q.l.y + H.lamps[q.l.id].fy + 0.05, q.l.z);
    L.intensity = 8 * q.f * q.big * (g.flipped ? 1.3 : 1);
    L.distance = POOL_R * 3.2;
    L.color.set(g.flipped ? "#ff7a3a" : "#ff9a4e");
  }

  // --- the way out, once it is open ---
  const fd = g.L.doors.find((d) => d.kind === "front");
  if (fd && !fd.locked) {
    moon.position.set(fd.x, 1.6, fd.z + 0.9);
    moon.intensity += ((2.2 + flashNow * 6) - moon.intensity) * Math.min(1, dt * 2);
  } else moon.intensity = 0;

  // --- the dark, and eyes getting used to it ---
  const dark = !lit && !(g.inPool && !g.flipped);
  adapt += ((dark ? 1 : 0) - adapt) * Math.min(1, dt * (dark ? 0.12 : 1.5));
  // grey and colourless (the post pass takes the colour out as you adapt),
  // but enough to make out a doorway, a table, a shape standing still
  hemi.intensity = 0.04 + adapt * (g.flipped ? 2.3 : 1.7);

  // --- lightning ---
  let flash = 0;
  for (let i = flashes.length - 1; i >= 0; i--) {
    const f = flashes[i];
    f.t += dt;
    // a double stroke: a flash, a gap, a brighter one, a fade
    const k = f.t < 0.06 ? f.t / 0.06 : f.t < 0.12 ? 0.25 : f.t < 0.18 ? 1 : Math.max(0, 1 - (f.t - 0.18) / 0.5);
    flash = Math.max(flash, k * f.pow);
    if (f.t > 0.8) flashes.splice(i, 1);
  }
  // between flashes the same light is the moon through the capiz: it only
  // gets in where the windows let it (with shadows), so it stays faint without them
  const moonBase = quality === "high" ? 0.35 : 0.05;
  lightning.intensity = moonBase + flash * (quality === "high" ? 4 : 1.6);
  flashNow = flash;
  if (flash > 0.02 && quality === "high") lightning.shadow.needsUpdate = true;
  M.capiz.emissiveIntensity = flash * 1.6 + 0.04 + adapt * 0.08;

  // --- doors, closets, kicked things ---
  for (const d of g.L.doors) {
    const hd = H.doors[d.id];
    if (!hd) continue;
    const target = d.sealed ? 0 : d.kind === "front" ? (d.locked ? 0 : 0.12 + (g.state === "won" ? 0.9 : 0)) : d.open;
    hd.a += (target - hd.a) * Math.min(1, dt * (d.open > 0.5 && h.state === "chase" ? 14 : 5));
    for (const lf of hd.leaves) lf.pivot.rotation.y = lf.base + lf.dir * hd.a * 1.65;
  }
  for (const cl of H.closets) {
    if (!cl) continue;
    cl.open = Math.max(cl.target, cl.open - dt * 1.4);
    const a = Math.min(1.5, cl.open) * 1.0;
    let rat = 0;
    if (cl.rattle > 0) { cl.rattle -= dt; rat = (Math.sin(t * 40) * 0.5 + (Math.random() - 0.5)) * 0.08; }
    for (const d of cl.doors) d.pivot.rotation.y = d.s < 0 ? -a - Math.abs(rat) : a + Math.abs(rat);
  }
  for (let i = H.kicks.length - 1; i >= 0; i--) {
    const k = H.kicks[i];
    k.t -= dt;
    k.o.position.x += k.vx * dt; k.o.position.z += k.vz * dt;
    k.o.rotation.y += k.spin * dt;
    k.vx *= 0.9; k.vz *= 0.9;
    if (k.t <= 0) H.kicks.splice(i, 1);
  }
  for (const tn of g.L.tins) if (H.tins[tn.id]) H.tins[tn.id].visible = !tn.taken;
  if (H.clock) H.clock.traverse((o) => { if (o.name && /MinuteHand/.test(o.name)) o.rotation.z = -t * 0.02; if (o.name && /HourHand/.test(o.name)) o.rotation.z = -t * 0.002 - 1.6; });
  for (const w of H.windows) if (w && w.open > 0) { w.open = Math.max(0.5, w.open - dt * 0.3); w.panes[0].position.x = -((WIN_W - 0.06) / 4) - w.open * 0.35; }

  // --- the hunter ---
  creature.update(h, dt, { t, camera, flash, lanternPower: power, kill: killT, scares, killedBy: g.state === "caught" });

  // --- dust follows the lantern ---
  dust.position.set(camera.position.x, 0, camera.position.z);
  dust.material.opacity = 0.18 * power;
  dust.rotation.y += dt * 0.01;

  // --- the post pass: dread and death ---
  const dread = p.dread;
  const chase = h.state === "chase" ? 1 : 0;
  const U = post.uniforms;
  U.dread.value = motion ? dread : dread * 0.3;
  U.vign.value = Math.min(1, dread * 0.8 + chase * 0.4 + (hiding ? 0.55 : 0) + (p.holding ? 0.3 : 0));
  U.chroma.value = dread * 0.8 + chase * 0.8 + near * 0.6;
  U.desat.value = Math.min(0.75, dread * 0.6 + (g.flipped ? 0.15 : 0));
  U.blue.value = adapt * 0.6;
  U.grain.value = 0.045 + dread * 0.05 + (quality === "high" ? 0 : -0.015);
  U.flash.value = flash * 0.05 + (killT >= 0 && killT < 0.08 && scares === "full" ? 0.6 : 0);
  if (killT >= 0) {
    killT += dt;
    U.red.value = scares === "full" ? Math.min(0.5, killT * 1.5) : 0;
    U.fade.value = Math.min(1, scares === "full" ? Math.max(0, (killT - 0.85) * 3) : killT * 2.5);
  } else {
    fadeIn = Math.max(0, fadeIn - dt * 0.7);
    U.red.value = 0;
    U.fade.value = fadeIn * fadeIn + (g.state === "won" ? 0 : 0);
  }
  composer.render();
}

/* The title screen: the empty caida, the lantern on the floor, rain. */
export function drawIdle(dt) {
  if (!renderer) return;
  post.uniforms.time.value = performance.now() / 1000;
  post.uniforms.fade.value = 0.35;
  composer.render();
}

export function setFade(v) { if (post) post.uniforms.fade.value = v; }

/* Where the thing is on screen, for captions: -1 left .. 1 right, and behind. */
export function bearing(x, z) {
  tmpV2.set(x, 1.5, z).project(camera);
  return { x: tmpV2.x, behind: tmpV2.z > 1 };
}

export function stats() { return renderer ? { calls: renderer.info.render.calls, tris: renderer.info.render.triangles, geos: renderer.info.memory.geometries, tex: renderer.info.memory.textures } : null; }
export const three = () => ({ renderer, scene, camera });
