/* render.js — the light on the ice.
 *
 * The renderer setup is Last Flame's (lastflame/js/render.js), which is
 * Ballzooka's and Bloomworks': the same vendored three r160, ACES tone
 * mapping, an UnrealBloomPass so the sun on the snow and every fire bleed
 * light, a post pass after the tone mapping that carries how the body feels
 * (there, dread; here, cold), a lantern held low and to the right with its
 * flame and its own light, and a quality switch — here Fast, Normal and
 * Unrestrained — with the textures' resolution as a setting of its own
 * (Packed, or Full: the unshrunk originals, fetched the first time).
 *
 * What is this game's:
 *   - the sun is a real sun (sun.js) and the only clock: its light and
 *     colour come from its height, and its shadows are cascaded shadow maps
 *     (three's CSM, vendored) so a drift at your feet and a mountain 1.5 km
 *     away both throw them; they sweep round you as the day goes round;
 *   - the sky (sky.js) is Preetham's daylight with the polar twilight, the
 *     stars and the aurora over it, and it lights the land: its picture is
 *     the environment every surface reflects and is lit by, renewed as the
 *     sun moves; the fog is its horizon colour, warmer toward the sun;
 *   - the eye adapts: out of the glare into a hut, out of the day into the
 *     long night, the exposure follows slowly, the way eyes do;
 *   - the land is terrain.js; the huts, the beacons, the footprints, the
 *     blowing snow and everything placed are scenery.js.
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
import { CSM } from "../vendor/jsm/csm/CSM.js";
import * as terrain from "./terrain.js";
import * as scenery from "./scenery.js";
import * as T from "./textures.js";
import { makeSky, skyMix, skyColor, twilightColor } from "./sky.js";
import { nightness, DEG } from "./sun.js";
import { MODEL_NAMES } from "./places.js";

export const MODELS = ["alarm_clock", "axe", "bed", "binoculars", "boots", "bucket", "cans", "chair", "clipboard", "clock", "compass", "crate", "crate_open", "desk", "drum", "fish_knife", "generator", "jerrycan", "jerrycan_green", "lantern", "lifebuoy", "lpg", "medical", "notebook", "postcards", "pot", "radio", "rations", "rock_a", "rock_b", "searchlight", "shelves", "spade", "spectacles", "stone_a", "stone_b", "stool", "stove", "suitcase", "table", "thermos", "toolbox"];
export const TEXTURES = ["snow_wind", "snow_soft", "snow_aerial", "rock", "ice", "hut_red", "hut_grey", "planks", "floor", "metal"];
const PATH = { packed: { m: "assets/models/", t: "assets/textures/" }, full: { m: "assets/full/models/", t: "assets/full/textures/" } };

let renderer, scene, camera, composer, bloom, post, outPass, sky, csm = null, hemi, fog;
let quality = "high", assets = "packed", motion = true, fov = 72, bright = 0.5;
let lanternVM, lanternFlame, lanternGlow, lanternLight, roomLight;
const tpl = {};                  // loaded model templates
const lit = new Set();           // every material lit by the sun (CSM must know them all)
const TX = {};                   // name -> { c, n, arm } textures in use
const binds = [];                // where each texture is used: (name, map, set(t))
let loaded = 0, total = 0, ready = false, progressFn = null;
let exposure = 0.6, lastEnvK = -1, envT = 0, pmrem = null, envRT = null, envCube = null, envCam = null, bob = 0, bobAmp = 0, fadeK = 1, frameN = 0;
const FOGU = { fogSunDir: { value: new THREE.Vector3(0, 1, 0) }, fogSunColor: { value: new THREE.Color() } };
const tmpV = new THREE.Vector3(), tmpC = new THREE.Color(), tmpC2 = new THREE.Color(), sunV = new THREE.Vector3();
const col3 = [0, 0, 0], col3b = [0, 0, 0];

/* ------------------------------------------------------------------ */
/* Setup                                                              */

export function init(canvas, onProgress) {
  progressFn = onProgress;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance", logarithmicDepthBuffer: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = exposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // counted over the whole frame (shadows, the composer's passes), not just its last draw
  renderer.info.autoReset = false;
  scene = new THREE.Scene();
  scene.background = new THREE.Color("#000000");
  fog = new THREE.FogExp2("#c8d4e4", 0.0001);
  scene.fog = fog;
  camera = new THREE.PerspectiveCamera(fov, 1, 0.06, 14000);
  camera.rotation.order = "YXZ";
  scene.add(camera);

  sky = makeSky();
  scene.add(sky.group);
  hemi = new THREE.HemisphereLight("#9fb8e0", "#e8eef6", 0.4);
  scene.add(hemi);
  // the light inside whichever hut you are in (made now and left dark, so
  // the number of lights never changes)
  roomLight = new THREE.PointLight("#e8eef8", 0, 9, 2);
  scene.add(roomLight);

  // the lantern in your hand (Last Flame's, carried the same way)
  lanternVM = new THREE.Group();
  camera.add(lanternVM);
  lanternLight = new THREE.PointLight("#ffa45c", 0, 26, 2);
  lanternLight.castShadow = false;
  lanternLight.shadow.mapSize.set(512, 512);
  lanternLight.shadow.camera.near = 0.08;
  lanternLight.shadow.bias = -0.004;
  lanternLight.shadow.normalBias = 0.015;
  camera.add(lanternLight);
  lanternFlame = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.flame(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
  lanternFlame.scale.set(0.022, 0.044, 1);
  lanternGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.glow(), color: "#ff9a40", blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.5, fog: false }));
  lanternGlow.scale.set(0.16, 0.16, 1);
  lanternVM.add(lanternFlame, lanternGlow);
  lanternVM.visible = false;

  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.55, 0.9);
  composer.addPass(bloom);
  outPass = new OutputPass();
  composer.addPass(outPass);
  post = new ShaderPass(POST);
  composer.addPass(post);
  pmrem = new THREE.PMREMGenerator(renderer);

  loadTextures();
  terrain.init(scene, terrainTextures(), litMaterial);
  scenery.init({ scene, camera, renderer, lit: litMaterial, tex: (n) => TX[n], bind, tpl, glow: T.glow() });
  loadModels(assets, true);
  resize();
  window.addEventListener("resize", resize);
}

/* The post pass: after tone mapping, in display space. Cold narrows the
   picture and takes the colour out of it; at the edge of freezing, frost
   creeps in from the corners; a blackout is the screen going white, then
   dark. (Last Flame's horror pass, turned to the cold.) */
const POST = {
  uniforms: {
    tDiffuse: { value: null }, time: { value: 0 }, cold: { value: 0 }, frost: { value: 0 }, fade: { value: 1 }, white: { value: 0 },
    grain: { value: 0.025 }, res: { value: new THREE.Vector2(1, 1) }, night: { value: 0 }
  },
  vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float time, cold, frost, fade, white, grain, night; uniform vec2 res;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
    void main(){
      vec2 c = vUv - 0.5;
      vec3 col = texture2D(tDiffuse, vUv).rgb;
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      // cold: the colour goes, toward a blue-grey
      col = mix(col, vec3(l * 0.86, l * 0.93, l * 1.08), cold * 0.55);
      // the night: what little the eye sees, it sees without colour
      col = mix(col, vec3(l * 0.8, l * 0.9, l * 1.12), night * 0.5);
      float d = length(c * vec2(1.0, 0.85));
      col *= mix(1.0, smoothstep(0.85 - cold * 0.3, 0.2, d), 0.55 + cold * 0.3);
      // frost from the corners: crystalline, branching, white-blue
      if (frost > 0.0) {
        vec2 p = vUv * res / 220.0;
        float f = 0.0;
        for (int i = 0; i < 4; i++) { float s = pow(2.0, float(i)); f += abs(vn(p * s * 2.3 + float(i) * 7.1) - 0.5) / s; }
        float edge = smoothstep(0.35, 0.75, d + f * 0.35 - (1.0 - frost) * 0.45);
        col = mix(col, vec3(0.86, 0.92, 1.0) * (0.75 + f * 0.5), edge * 0.85 * frost);
      }
      float n = hash(vUv * res + fract(time * 37.0) * 91.0) - 0.5;
      col += n * (grain + night * 0.04);
      col = mix(col, vec3(0.92, 0.95, 1.0), white);
      col *= 1.0 - fade;
      gl_FragColor = vec4(col, 1.0);
    }`
};

/* ------------------------------------------------------------------ */
/* Materials the sun lights                                           */

/* The aerial perspective: distance turns things to the sky's colour at the
   horizon, warmer toward the sun. One patch for every lit material. */
const FOG_GLSL = `
#ifdef USE_FOG
  float fogK = 1.0 - exp( - fogDensity * vFogDepth );
  vec3 fogDirW = normalize( ( vec4( - vViewPosition, 0.0 ) * viewMatrix ).xyz );
  vec3 fogC = mix( fogColor, fogSunColor, pow( max( dot( fogDirW, fogSunDir ), 0.0 ), 6.0 ) );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogC, clamp( fogK, 0.0, 1.0 ) );
#endif`;
function fogPatch(sh) {
  sh.uniforms.fogSunDir = FOGU.fogSunDir; sh.uniforms.fogSunColor = FOGU.fogSunColor;
  sh.fragmentShader = "uniform vec3 fogSunDir;\nuniform vec3 fogSunColor;\n" + sh.fragmentShader.replace("#include <fog_fragment>", FOG_GLSL);
}

/** Register a material as lit by the sun: CSM, the fog, and its own patch (userData.patch). */
export function litMaterial(m) {
  for (const mat of [].concat(m || [])) {
    if (!mat || !(mat.isMeshStandardMaterial) || lit.has(mat)) continue;
    lit.add(mat);
    wire(mat);
  }
  return m;
}
function wire(mat) {
  if (csm) csm.setupMaterial(mat);
  const csmHook = csm ? mat.onBeforeCompile : null;
  const own = mat.userData.patch;
  mat.onBeforeCompile = (sh, r) => { if (csmHook) csmHook(sh, r); if (own) own(sh); fogPatch(sh); };
  const key = mat.userData.patchKey || "";
  mat.customProgramCacheKey = () => key + "|lit|" + (csm ? csm.cascades : 0);
  mat.needsUpdate = true;
}

/* ------------------------------------------------------------------ */
/* Textures: Packed (what installs) or Full (the originals, on request)  */

function loadTex(url, srgb, onDone) {
  total++;
  const t = new THREE.TextureLoader().load(url, () => { step(); if (onDone) onDone(t); }, undefined, () => { step(); if (onDone) onDone(null); });
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = quality === "ultra" ? renderer.capabilities.getMaxAnisotropy() : quality === "low" ? 2 : 8;
  return t;
}
function loadTextures() {
  for (const n of TEXTURES) {
    const p = PATH[assets].t + n;
    TX[n] = { c: loadTex(p + ".webp", true), n: loadTex(p + "_n.webp", false), arm: loadTex(p + "_arm.webp", false) };
  }
}
/** Use texture `name`'s `map` ("c" | "n" | "arm") through `set(t)` — now, and whenever it changes. */
export function bind(name, map, set) {
  binds.push({ name, map, set });
  set(TX[name][map]);
}
function terrainTextures() {
  const o = {};
  const u = (k, name, map) => bind(name, map, (t) => { o[k] = t; terrain.setTexture(k, t); });
  u("snowN", "snow_wind", "n"); u("softN", "snow_soft", "n"); u("aerC", "snow_aerial", "c"); u("aerN", "snow_aerial", "n");
  u("rockC", "rock", "c"); u("rockN", "rock", "n"); u("rockA", "rock", "arm"); u("iceC", "ice", "c");
  return o;
}

/** "packed" | "full". `note(text)` hears how the Full download is going. */
let setNote = null, assetJob = 0;
export function setAssets(level, note) {
  if (note) setNote = note;
  level = level === "full" ? "full" : "packed";
  if (level === assets) return;
  assets = level;
  const job = ++assetJob;
  let want = TEXTURES.length * 3 + MODELS.length, got = 0, failed = 0;
  const say = () => { if (setNote && job === assetJob) setNote(got + failed < want ? (level === "full" ? "Full quality: " : "Packed: ") + Math.round((got / want) * 100) + "%" : failed ? "Full quality needs a connection the first time." : ""); };
  say();
  const fresh = {};
  for (const n of TEXTURES) {
    fresh[n] = {};
    for (const [map, suf, srgb] of [["c", "", true], ["n", "_n", false], ["arm", "_arm", false]]) {
      const t = new THREE.TextureLoader().load(PATH[level].t + n + suf + ".webp", () => {
        got++; say();
        if (job !== assetJob) { t.dispose(); return; }
        const old = TX[n][map];
        TX[n][map] = t;
        for (const b of binds) if (b.name === n && b.map === map) b.set(t);
        if (old && old !== t) old.dispose();
      }, undefined, () => { failed++; say(); });
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = quality === "ultra" ? renderer.capabilities.getMaxAnisotropy() : quality === "low" ? 2 : 8;
      fresh[n][map] = t;
    }
  }
  loadModels(level, false, () => { got++; say(); }, () => { failed++; say(); }, job);
}
export const assetLevel = () => assets;

function loadModels(level, first, okFn, failFn, job) {
  const loader = new GLTFLoader();
  const fresh = {};
  let left = MODELS.length;
  for (const m of MODELS) {
    if (first) total++;
    loader.load(PATH[level].m + m + ".glb", (g) => {
      g.scene.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true; o.receiveShadow = true;
        for (const mat of [].concat(o.material)) {
          if (mat.transparent) { mat.depthWrite = false; o.castShadow = false; }
          for (const s of ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap"]) if (mat[s]) mat[s].anisotropy = quality === "low" ? 2 : 8;
        }
        litMaterial(o.material);
      });
      fresh[m] = g.scene;
      if (first) { tpl[m] = g.scene; step(); }
      else if (okFn) okFn();
      if (--left === 0 && !first && job === assetJob) { Object.assign(tpl, fresh); scenery.rebuildProps(); }
    }, undefined, () => { if (first) step(); else if (failFn) failFn(); --left; });
  }
}
function step() { loaded++; if (progressFn) progressFn(loaded / Math.max(1, total)); if (loaded >= total) ready = true; }
export const isReady = () => ready;
export const progress = () => loaded / Math.max(1, total);

/* ------------------------------------------------------------------ */
/* Quality                                                            */

/* Fast is a phone: one shadow cascade close round you, no reflections of
   the sky (it lights the land through the hemisphere instead), no bloom,
   the land's detail pulled in. Normal: three cascades out to half a
   kilometre, the sky as the environment, bloom. Unrestrained holds nothing
   back: four cascades of 4096 out to 1.8 km, so a ridge's shadow reaches
   you across the valley at a low sun; every pixel the screen has, four
   samples at the edges (the composer's own buffers, as Magic Sandbox's high
   tier does), the land at its finest furthest, more snow in the air, the
   sky's light renewed every second. */
const Q = {
  low: { cascades: 1, size: 1024, far: 90, dpr: 1, bloom: false, env: 0, samples: 0, pcf: THREE.PCFShadowMap, lanternShadow: false },
  high: { cascades: 3, size: 2048, far: 520, dpr: 1.5, bloom: true, env: 3, samples: 0, pcf: THREE.PCFSoftShadowMap, lanternShadow: true },
  ultra: { cascades: 4, size: 4096, far: 1800, dpr: 3, bloom: true, env: 1, samples: 4, pcf: THREE.PCFSoftShadowMap, lanternShadow: true }
};
export function setQuality(q) {
  quality = Q[q] ? q : "high";
  if (!renderer) return;
  const c = Q[quality];
  renderer.shadowMap.type = c.pcf;
  if (csm) { csm.remove(); csm.dispose(); }
  csm = new CSM({ camera, parent: scene, cascades: c.cascades, maxFar: c.far, shadowMapSize: c.size, lightDirection: new THREE.Vector3(0, -1, 0), lightIntensity: 0, mode: "practical", lightMargin: c.cascades > 1 ? 600 : 120, shadowBias: -0.00012, lightFar: 5000, lightNear: 1 });
  csm.fade = c.cascades > 1;
  for (const l of csm.lights) { l.shadow.normalBias = c.cascades > 1 ? 0.06 : 0.03; l.shadow.radius = 2; }
  for (const m of lit) wire(m);
  bloom.enabled = c.bloom;
  for (const rt of [composer.renderTarget1, composer.renderTarget2]) if (rt.samples !== c.samples) { rt.samples = c.samples; rt.dispose(); }
  lanternLight.castShadow = c.lanternShadow;
  if (!c.env) { scene.environment = null; if (envRT) { envRT.dispose(); envRT = null; } }
  envT = 0;
  terrain.setQuality(quality);
  scenery.setQuality(quality);
  const aniso = quality === "ultra" ? renderer.capabilities.getMaxAnisotropy() : quality === "low" ? 2 : 8;
  for (const n in TX) for (const k in TX[n]) { const t = TX[n][k]; if (t && t.anisotropy !== aniso) { t.anisotropy = aniso; t.needsUpdate = true; } }
  resize();
}
export function setMotion(v) { motion = !!v; }
export function setFov(v) { fov = v; if (camera) { camera.fov = fov; camera.updateProjectionMatrix(); if (csm) csm.updateFrustums(); } }
export function setBrightness(v) { bright = v; }

export function resize() {
  if (!renderer) return;
  const w = window.innerWidth, h = window.innerHeight;
  const dpr = Math.min(Q[quality].dpr, window.devicePixelRatio || 1);
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  composer.setPixelRatio(dpr);
  composer.setSize(w, h);
  bloom.resolution.set(w / 2, h / 2);
  post.uniforms.res.value.set(w * dpr, h * dpr);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (csm) csm.updateFrustums();
  lanternVM.userData.home = new THREE.Vector3(camera.aspect < 0.8 ? 0.11 : 0.22, -0.24, -0.5);
}

/* ------------------------------------------------------------------ */
/* A journey                                                          */

export function build(g) {
  scenery.build(g);
  fadeK = 1;
  envT = 0;
}
export function feed(events, g) { scenery.feed(events, g); for (const e of events) if (e.type === "wake") fadeK = 1; }

/* ------------------------------------------------------------------ */
/* The frame                                                          */

/* Sun light: its colour and strength by its height, through the air. */
function sunLight(el, out) {
  const d = el / DEG;
  // reddening near the horizon: blue goes first, then green
  const k = Math.max(0, Math.min(1, (d + 1) / 25));
  out.setRGB(1.0, 0.55 + 0.42 * Math.pow(k, 0.6), 0.28 + 0.66 * Math.pow(k, 0.85));
  // a low sun is still strong: it is the long path through the air that
  // reddens it, and the snow takes it at a slant (that is what turns it orange)
  const strength = d <= -1.5 ? 0 : Math.pow(Math.min(1, (d + 1.5) / 9), 0.9);
  return strength;
}

export function draw(g, dt, view) {
  if (!renderer) return;
  renderer.info.reset();
  view = view || {};
  const t = performance.now() / 1000;
  post.uniforms.time.value = t;
  frameN++;
  const p = g.p, sun = g.sun;
  sunV.set(sun.x, sun.y, sun.z);

  // --- the camera: eye height, a little bob when walking ---
  const sp = p.speed || 0, moving = p.moving && g.state === "play";
  bob += dt * (sp > 2.6 ? 9.5 : 7) * (moving ? 1 : 0);
  bobAmp += ((moving ? Math.min(1, sp / 3) : 0) - bobAmp) * Math.min(1, dt * 5);
  const bobY = motion ? Math.sin(bob * 2) * 0.035 * bobAmp : 0, bobX = motion ? Math.cos(bob) * 0.022 * bobAmp : 0;
  const outK = g.state === "out" ? Math.min(1, g.outT / 1.2) : 0;
  camera.position.set(p.x - Math.cos(p.yaw) * bobX, p.y + p.eye + bobY - outK * 1.2, p.z + Math.sin(p.yaw) * bobX);
  camera.rotation.set(p.pitch - outK * 0.5, p.yaw + Math.PI, (motion ? bobX * 0.5 : 0) + outK * 0.6);
  camera.updateMatrixWorld();

  // --- the sky and the sun ---
  const mix = skyMix(sun.el);
  mix.aurora = view.title ? 1 : Math.max(0, Math.min(1, (g.season - 0.72) * 5)) * mix.night;
  sky.update(sun, mix, t, camera.position, renderer.getPixelRatio());
  const strength = sunLight(sun.el, tmpC);
  const cloud = 1 - 0.85 * g.weather.whiteout;
  const sunI = 4.6 * strength * cloud;
  if (csm) {
    csm.lightDirection.copy(sunV).negate();
    for (const l of csm.lights) { l.color.copy(tmpC); l.intensity = sunI; }
    csm.update();
  }
  renderer.shadowMap.autoUpdate = sunI > 0.01;
  FOGU.fogSunDir.value.copy(sunV);

  // the sky's colour overhead and at the horizon, from the same model it is drawn with
  const hz = horizon(sun, mix);
  // the fog: thin as Antarctic air on a clear day, a wall in a whiteout,
  // a haze when the wind lifts the snow
  const wo = g.weather.whiteout, wind = g.weather.wind;
  const dens = 0.00005 + 0.00035 * Math.max(0, wind - 0.45) + wo * wo * 0.11;
  fog.density = dens;
  const white = tmpV.set(0.82, 0.85, 0.9).multiplyScalar(0.25 + 0.75 * Math.min(1, strength + 0.15));
  fog.color.setRGB(hz.h[0], hz.h[1], hz.h[2]).lerp(new THREE.Color(white.x, white.y, white.z), wo);
  FOGU.fogSunColor.value.setRGB(hz.s[0], hz.s[1], hz.s[2]).lerp(fog.color, wo);
  // the hemisphere: the sky above, the snow's bounce below. On Fast it
  // stands in for the environment, so it is stronger
  const env = Q[quality].env > 0;
  const night = nightness(sun.el);
  hemi.color.setRGB(hz.z[0], hz.z[1], hz.z[2]).multiplyScalar(1 / Math.max(0.0001, Math.max(hz.z[0], hz.z[1], hz.z[2])));
  // under the stars the snow still shows to eyes that have waited: a floor
  // of cold light, green-tinged when the aurora is up
  hemi.color.lerp(tmpC2.setRGB(0.6 - mix.aurora * 0.06, 0.7 + mix.aurora * 0.08, 0.95 - mix.aurora * 0.05), night);
  hemi.groundColor.setRGB(0.92, 0.95, 1.0);
  const skyAvg = Math.max((hz.z[0] + hz.z[1] + hz.z[2]) / 3, 0.0005);
  const indoor = p.inside >= 0 ? 0.25 : 1;
  hemi.intensity = ((env ? 0.35 : 1.4) * Math.min(1.2, skyAvg * 1.6 + 0.02) + night * (0.16 + 0.12 * mix.aurora)) * indoor + wo * 0.6 * strength;
  // the sky as the light on everything: re-photographed as the sun moves
  envT -= dt;
  if (env && envT <= 0) {
    envT = Q[quality].env;
    TIME.env = performance.now();
    const old = envRT;
    // the sky is smooth: photographed small, then blurred for each roughness
    if (!envCube) { envCube = new THREE.WebGLCubeRenderTarget(64, { type: THREE.HalfFloatType }); envCam = new THREE.CubeCamera(0.1, 200, envCube); }
    envCam.update(renderer, sky.envScene);
    envRT = pmrem.fromCubemap(envCube.texture, envRT && false);
    scene.environment = envRT.texture;
    if (old) old.dispose();
    TIME.env = performance.now() - TIME.env;
  }
  // indoors, the sky reaches in only by the windows and the door
  const envK = p.inside >= 0 ? 0.3 : 1;
  if (envK !== lastEnvK) { lastEnvK = envK; for (const m of lit) m.envMapIntensity = envK; }

  // inside a hut: the daylight that gets in by the windows and the door,
  // bounced round the walls
  const hut = p.inside >= 0 ? g.P.huts[p.inside] : null;
  const dayIn = (strength * cloud * 0.7 + skyAvg * 0.9) * (hut && g.doors[hut.id] > 0.5 ? 1.5 : 1);
  if (hut) { roomLight.position.set(hut.x, hut.floor + 2.1, hut.z); roomLight.intensity = 6 * dayIn + 0.15; } else roomLight.intensity = 0;

  // --- the eye: exposure follows the light, slowly into the dark ---
  // what reaches the snow: the sun across it, the sky over it, the stars
  let lum = 0.29 * sunI * Math.max(0.05, sun.y) + 0.85 * skyAvg + night * 0.01;
  if (hut) lum = lum * 0.3 + 0.05 * dayIn + 0.01;
  let want = 0.72 / Math.max(0.06, lum);
  // the eye opens only so far: the night stays night, the snow under the
  // stars is seen by the starlight on it (the hemisphere's floor, above)
  want = Math.max(0.35, Math.min(want, 2.4 + 1.6 * (1 - night)));
  if (p.lantern) want = Math.min(want, 4.5);
  want *= 0.75 + bright * 0.5;
  const rate = want > exposure ? 0.22 : 0.9;
  exposure += (want - exposure) * Math.min(1, dt * rate);
  renderer.toneMappingExposure = exposure;

  // --- the lantern ---
  lantern(g, dt, view, t);

  // --- the land and everything on it ---
  let tm = performance.now();
  terrain.update(camera.position, p.y);
  terrain.tick(t);
  TIME.terrain = performance.now() - tm; tm = performance.now();
  scenery.draw(g, dt, { camera, sun, strength, night, wind, wo, exposure, t, view });
  TIME.scenery = performance.now() - tm;

  // --- the post pass: how the body feels ---
  const U = post.uniforms;
  const cold = Math.max(0, Math.min(1, (0.55 - p.warmth) / 0.5));
  U.cold.value = cold;
  U.frost.value = Math.max(0, Math.min(1, (0.25 - p.warmth) / 0.22));
  U.night.value = night * (p.lantern ? 0.5 : 1);
  U.grain.value = 0.015 + night * 0.012;
  if (g.state === "out") { fadeK = Math.min(1, fadeK + dt * 0.8); U.white.value = Math.max(0, 0.6 - g.outT * 0.4); }
  else { fadeK = Math.max(0, fadeK - dt * 0.6); U.white.value = 0; }
  const endFade = g.ending ? Math.max(0, Math.min(1, (g.ending.t - 46) / 10)) : 0;
  U.fade.value = Math.max(fadeK * fadeK, endFade, view.fade || 0);
  tm = performance.now();
  composer.render();
  TIME.render = performance.now() - tm;
}
/* How long the last frame's parts took, for tools/e2e.js. */
export const TIME = { env: 0, terrain: 0, scenery: 0, render: 0 };

/* The sky's colour at the zenith (z), the horizon away from the sun (h) and
   toward it (s): the Preetham model plus the twilight dome, as drawn. */
const dH = { x: 0, y: 0.02, z: 0 }, dZ = { x: 0, y: 1, z: 0 };
function horizon(sun, mix) {
  const s = sun, hl = Math.hypot(s.x, s.z) || 1;
  const add = (d, out) => { skyColor(d, s, out); twilightColor(d, s, mix, col3b); for (let i = 0; i < 3; i++) out[i] += col3b[i]; return out; };
  const z = add(dZ, [0, 0, 0]);
  // the horizon all round: four directions, averaged
  const h = [0, 0, 0];
  for (const a of [0, 1.57, 3.14, 4.71]) { dH.x = Math.cos(a); dH.z = Math.sin(a); add(dH, col3); for (let i = 0; i < 3; i++) h[i] += col3[i] / 4; }
  dH.x = s.x / hl; dH.z = s.z / hl;
  const sc = add(dH, [0, 0, 0]);
  return { z, h, s: sc };
}

function lantern(g, dt, view, t) {
  const p = g.p;
  const show = p.keys.lantern && p.lantern && !view.title && g.state === "play";
  lanternVM.visible = show;
  if (tpl.lantern && !lanternVM.userData.model) {
    const m = tpl.lantern.clone(true);
    m.scale.setScalar(0.95);
    m.position.y = -0.15;
    m.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = false; o.receiveShadow = false;
      if (/glass/i.test(o.name + (o.material && o.material.name))) o.material = new THREE.MeshBasicMaterial({ color: "#ffb36b", transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false });
      else o.material = new THREE.MeshBasicMaterial({ map: o.material.map || null, color: "#4a3a2a" });
    });
    lanternVM.add(m);
    lanternVM.userData.model = m;
  }
  const home = lanternVM.userData.home || new THREE.Vector3(0.22, -0.24, -0.5);
  const sway = motion ? Math.sin(bob) * 0.02 * bobAmp : 0;
  lanternVM.position.set(home.x + sway, home.y + (motion ? Math.sin(bob * 2) * 0.01 * bobAmp : 0), home.z);
  lanternVM.rotation.set(0, 0.25, -sway * 2);
  const flick = 1 + 0.06 * Math.sin(t * 13.1) + 0.05 * Math.sin(t * 23.7 + 1.3) + (Math.random() - 0.5) * 0.08 + g.weather.gust * (Math.random() - 0.5) * 0.6;
  lanternFlame.position.set(0, -0.035, 0);
  lanternGlow.position.copy(lanternFlame.position);
  lanternFlame.scale.set(0.02 * flick, 0.042 * (0.9 + 0.2 * flick), 1);
  lanternGlow.material.opacity = 0.45 * flick;
  lanternLight.position.set(lanternVM.position.x, lanternVM.position.y - 0.03, lanternVM.position.z);
  lanternLight.intensity = show ? 5 * Math.max(0.3, flick) : 0;
}

export function drawIdle(dt) {
  if (!renderer) return;
  post.uniforms.time.value = performance.now() / 1000;
  post.uniforms.fade.value = 1;
  composer.render();
}

export function stats() { return renderer ? { calls: renderer.info.render.calls, tris: renderer.info.render.triangles, geos: renderer.info.memory.geometries, tex: renderer.info.memory.textures, terrain: terrain.coverage() } : null; }
export const three = () => ({ renderer, scene, camera, csm });
export const _debug = () => ({ lit, TX, tpl, Q, csm, composer });
void MODEL_NAMES;
