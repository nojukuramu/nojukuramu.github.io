/* gfx.js — the renderer, the camera, the light, and how much of each a
 * device can afford.
 *
 * Lifted from Magic Sandbox (magic_sandbox/js/gfx.js): quality tiers that
 * step down once by themselves if a device cannot keep up, the tilted
 * follow camera that leans toward where you aim, screen shake as a decaying
 * impulse, the shadow frustum snapped to texels, and screen ↔ ground
 * picking. What is new is the sky: Magic Sandbox's islands float in a fixed
 * theme, and this world has a day. The sun goes round, the light warms at
 * dusk and goes blue at night, and the fog is always the colour of the sky
 * behind it, so the edge of the loaded world is never a line.
 *
 * The camera looks down at about 55° — high enough to read a fight, low
 * enough that a tree is a tree and a wall has a face. That is the 2.5D: the
 * game is played on the ground plane, and drawn in depth.
 *
 * Graphics are The Long Light's three, by the same names and to the same
 * idea (longlight/js/render.js): Fast is a phone, Normal is a computer,
 * Unrestrained holds nothing back. Here each tier is also how far the world
 * is built round you and how much grows in it, so the setting decides what
 * you see as well as how sharply you see it:
 *
 *              pixels  sun shadows        glow  edges  world round you   ground cover
 *   Fast       1×      1024, hard, close  off   —      2 chunks (~40 m)  half
 *   Normal     1.5×    2048, soft         on    —      3 chunks (~56 m)  all of it
 *   Unrestrained every 4096, soft, wide   on    4×     4 chunks (~72 m)  half again
 *
 * A first visit starts at Fast on a touch screen and Normal elsewhere, and
 * steps down once (Normal to Fast) if the device cannot keep up — until you
 * choose a tier yourself, which is then left alone. */

import * as THREE from "three";
import { EffectComposer } from "../vendor/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "../vendor/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "../vendor/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "../vendor/examples/jsm/postprocessing/OutputPass.js";
import { clamp, damp, lerp } from "./util.js";

export const IS_TOUCH = typeof window !== "undefined" && (("ontouchstart" in window) || navigator.maxTouchPoints > 0);

const canvas = document.getElementById("gl");
export const renderer = new THREE.WebGLRenderer({ canvas, antialias: (window.devicePixelRatio || 1) < 2, powerPreference: "high-performance" });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const MAX_ANISO = renderer.capabilities.getMaxAnisotropy();

export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fc6e0);
scene.fog = new THREE.Fog(0x9fc6e0, 40, 90);
export const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 220);

export const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x4a5a32, 1.2);
scene.add(hemi);
export const sun = new THREE.DirectionalLight(0xfff0d8, 2.6);
sun.shadow.camera.left = -30; sun.shadow.camera.right = 30;
sun.shadow.camera.top = 30; sun.shadow.camera.bottom = -30;
sun.shadow.camera.near = 1; sun.shadow.camera.far = 110;
sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);

let composer = null, bloom = null;
export const TIER_IDS = ["fast", "normal", "unrestrained"];
export const TIER_NAMES = { fast: "Fast", normal: "Normal", unrestrained: "Unrestrained" };
let tier = "normal", wanted = "auto";
const TIERS = {
  fast:         { dpr: 1,  map: 1024, soft: false, reach: 22, bloom: false, samples: 0, fog: 1.9, load: 2, decor: 0.5, aniso: 2 },
  normal:       { dpr: 1.5, map: 2048, soft: true, reach: 30, bloom: true,  samples: 0, fog: 2.3, load: 3, decor: 1,   aniso: 4 },
  unrestrained: { dpr: 4,  map: 4096, soft: true,  reach: 44, bloom: true,  samples: 4, fog: 3.0, load: 4, decor: 1.5, aniso: Infinity }
};
/** What the current tier asks of the rest of the game: chunks.js reads load,
 *  terrain.js decor, assets.js and terrain.js aniso. */
export function tierSpec() { const T = TIERS[tier]; return { load: T.load, decor: T.decor, aniso: Math.min(T.aniso, MAX_ANISO) }; }

function buildComposer() {
  if (composer) return;
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: TIERS[tier].samples });
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.55, 0.5, 0.86);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
}

export function currentTier() { return tier; }
export function wantedQuality() { return wanted; }
/** "auto" (the device's pick, which may step down) or one of TIER_IDS. */
export function setQuality(q) {
  wanted = TIER_IDS.includes(q) ? q : "auto";
  const next = wanted === "auto" ? (IS_TOUCH ? "fast" : "normal") : wanted;
  if (next === tier && applied) return;
  tier = next;
  applyTier();
}
let applied = false;
const tierHooks = [];
export function onTier(fn) { tierHooks.push(fn); }
function applyTier() {
  const T = TIERS[tier];
  applied = true;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, T.dpr));
  renderer.shadowMap.enabled = true;
  sun.castShadow = true;
  const type = T.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  const typeChanged = renderer.shadowMap.type !== type;
  renderer.shadowMap.type = type;
  if (sun.shadow.mapSize.x !== T.map) {
    sun.shadow.mapSize.set(T.map, T.map);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  }
  const c = sun.shadow.camera;
  c.left = c.bottom = -T.reach; c.right = c.top = T.reach;
  c.updateProjectionMatrix();
  // The shadow filter is a shader define; three only notices when materials are flagged.
  if (typeChanged) scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); });
  if (T.bloom) buildComposer();
  if (composer) for (const rt of [composer.renderTarget1, composer.renderTarget2]) if (rt.samples !== T.samples) { rt.samples = T.samples; rt.dispose(); }
  resize();
  for (const fn of tierHooks) fn(tier);
}

export function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.fov = camera.aspect < 1 ? 50 : 38;
  camera.updateProjectionMatrix();
  if (composer) {
    const s = renderer.getDrawingBufferSize(new THREE.Vector2());
    composer.setSize(w, h);
    composer.setPixelRatio(renderer.getPixelRatio());
    if (bloom) bloom.resolution.set(s.x / 2, s.y / 2);
  }
  for (const fn of resizeHooks) fn();
}
const resizeHooks = [];
export function onResize(fn) { resizeHooks.push(fn); }
window.addEventListener("resize", resize);

/* Frame-rate watch: step down once when a device is clearly struggling. */
let slowFor = 0, fpsAvg = 60, onDowngrade = null;
export function watchPerformance(cb) { onDowngrade = cb; }
function perf(dt) {
  if (dt <= 0) return;
  fpsAvg = damp(fpsAvg, 1 / dt, 2, dt);
  if (wanted !== "auto" || tier === "fast") return;
  if (fpsAvg < 40) slowFor += dt; else slowFor = Math.max(0, slowFor - dt * 2);
  if (slowFor > 4) {
    slowFor = 0; fpsAvg = 60;
    tier = "fast";
    applyTier();
    if (onDowngrade) onDowngrade(tier);
  }
}
export function fps() { return fpsAvg; }

/* ---------------------------------------------------------------
   The day. t in 0..1: 0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset.
   Keys are blended between, so dusk passes through gold to blue.
   --------------------------------------------------------------- */
const SKY = [
  { t: 0.00, sky: 0x101a30, fog: 0x14203a, sun: 0x8aa0e0, sunI: 0.7,  hemiS: 0x4a64a8, hemiG: 0x1a2218, hemiI: 0.95, exp: 1.1 },
  { t: 0.20, sky: 0x26324f, fog: 0x2c3856, sun: 0x9a9ed0, sunI: 0.75, hemiS: 0x6070a0, hemiG: 0x22281c, hemiI: 1.0,  exp: 1.05 },
  { t: 0.27, sky: 0xf0a878, fog: 0xe8b090, sun: 0xffb070, sunI: 1.6,  hemiS: 0xffd2b0, hemiG: 0x4a4430, hemiI: 0.95, exp: 1.0 },
  { t: 0.36, sky: 0xa8d0ec, fog: 0xb6d6ea, sun: 0xfff0d8, sunI: 2.6,  hemiS: 0xd8ecff, hemiG: 0x50603a, hemiI: 1.15, exp: 1.0 },
  { t: 0.64, sky: 0x9cc8ea, fog: 0xb0d2ea, sun: 0xfff3dc, sunI: 2.6,  hemiS: 0xd8ecff, hemiG: 0x50603a, hemiI: 1.15, exp: 1.0 },
  { t: 0.74, sky: 0xf09060, fog: 0xe89a78, sun: 0xff9850, sunI: 1.5,  hemiS: 0xffc0a0, hemiG: 0x4a3a2a, hemiI: 0.9,  exp: 1.0 },
  { t: 0.81, sky: 0x2d2c50, fog: 0x2f3050, sun: 0x9a90d0, sunI: 0.8,  hemiS: 0x6262a0, hemiG: 0x22221c, hemiI: 1.0,  exp: 1.05 },
  { t: 1.00, sky: 0x101a30, fog: 0x14203a, sun: 0x8aa0e0, sunI: 0.7,  hemiS: 0x4a64a8, hemiG: 0x1a2218, hemiI: 0.95, exp: 1.1 }
];
const ca = new THREE.Color(), cb = new THREE.Color();
const mixHex = (a, b, t, out) => out.copy(ca.setHex(a)).lerp(cb.setHex(b), t);
let dayT = 0.32, night = 0;
/** 0 at noon, 1 in the dead of night, for lamps and enemy spawns. */
export function nightness() { return night; }
export function setDay(t) {
  dayT = ((t % 1) + 1) % 1;
  let i = 0;
  while (i < SKY.length - 2 && SKY[i + 1].t <= dayT) i++;
  const A = SKY[i], B = SKY[i + 1];
  const k = clamp((dayT - A.t) / Math.max(1e-6, B.t - A.t), 0, 1);
  mixHex(A.sky, B.sky, k, scene.background);
  mixHex(A.fog, B.fog, k, scene.fog.color);
  mixHex(A.sun, B.sun, k, sun.color);
  sun.intensity = lerp(A.sunI, B.sunI, k);
  mixHex(A.hemiS, B.hemiS, k, hemi.color);
  mixHex(A.hemiG, B.hemiG, k, hemi.groundColor);
  hemi.intensity = lerp(A.hemiI, B.hemiI, k);
  renderer.toneMappingExposure = lerp(A.exp, B.exp, k);
  night = clamp(1 - sun.intensity / 2.2, 0, 1);
  if (bloom) bloom.strength = 0.45 + night * 0.5;
}
// The sun's direction: east to west through the south, and the moon after it.
function sunOffset() {
  const a = (dayT - 0.25) * Math.PI * 2;           // 0 at sunrise
  const up = Math.sin(a);
  const elev = up > 0 ? up : -up * 0.8;           // the moon takes over below the horizon
  const h = 18 + 30 * elev;
  return { x: -Math.cos(a) * 40, y: h, z: 18 };
}

/* ---------------------------------------------------------------
   Camera
   --------------------------------------------------------------- */
const cam = { x: 0, z: 0, zoom: 1, shake: 0, kickX: 0, kickZ: 0, pitch: 0.96 };
export const camState = cam;
export let shakeEnabled = true;
export function setShakeEnabled(v) { shakeEnabled = v; }
export function addShake(s) { if (shakeEnabled) cam.shake = Math.min(1.4, cam.shake + s); }
export function kick(ang, s) { if (!shakeEnabled) return; cam.kickX -= Math.cos(ang) * s; cam.kickZ -= Math.sin(ang) * s; }
let userZoom = 1;
export function setUserZoom(z) { userZoom = clamp(z, 0.7, 1.45); }
export function getUserZoom() { return userZoom; }

function baseDistance() {
  const v = THREE.MathUtils.degToRad(camera.fov / 2);
  const h = Math.atan(Math.tan(v) * camera.aspect);
  return clamp(Math.max(13 / Math.tan(h), 10 / Math.tan(v)), 22, 40);
}
export function snapCamera(x, z) { cam.x = x; cam.z = z; }
export function updateCamera(tx, tz, leadX, leadZ, zoom, dt) {
  cam.x = damp(cam.x, tx + leadX, 6, dt);
  cam.z = damp(cam.z, tz + leadZ, 6, dt);
  cam.zoom = damp(cam.zoom, zoom * userZoom, 2.5, dt);
  cam.shake = Math.max(0, cam.shake - dt * 2.6);
  cam.kickX = damp(cam.kickX, 0, 14, dt);
  cam.kickZ = damp(cam.kickZ, 0, 14, dt);
  const s = cam.shake * cam.shake;
  const sx = (Math.random() - 0.5) * s * 1.2, sz = (Math.random() - 0.5) * s * 1.2;
  const d = baseDistance() * cam.zoom;
  const cx = cam.x + sx + cam.kickX, cz = cam.z + sz + cam.kickZ;
  camera.position.set(cx, Math.sin(cam.pitch) * d, cz + Math.cos(cam.pitch) * d);
  camera.lookAt(cx, 0, cz);
  // the loaded world ends where the tier says; the fog takes it before then
  const T = TIERS[tier];
  scene.fog.near = d * (T.fog > 2.5 ? 1.4 : 1.05); scene.fog.far = d * T.fog;
  camera.far = d * (T.fog + 0.2); camera.updateProjectionMatrix();
  const texel = (2 * T.reach) / (sun.shadow.mapSize.x || 1024);
  const fx = Math.round(cam.x / texel) * texel, fz = Math.round((cam.z - 4) / texel) * texel;
  const o = sunOffset();
  sun.target.position.set(fx, 0, fz);
  sun.position.set(fx + o.x, o.y, fz + o.z);
}

export function render(dt) {
  perf(dt);
  if (TIERS[tier].bloom && composer) composer.render(dt);
  else renderer.render(scene, camera);
}

/* Screen ↔ world on the ground plane, for mouse aim and damage numbers. */
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const v3 = new THREE.Vector3();
export function screenToGround(px, py, y) {
  ndc.set((px / window.innerWidth) * 2 - 1, -(py / window.innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const o = ray.ray.origin, d = ray.ray.direction;
  if (Math.abs(d.y) < 1e-5) return null;
  const t = ((y || 0) - o.y) / d.y;
  return { x: o.x + d.x * t, z: o.z + d.z * t };
}
export function worldToScreen(x, y, z, out) {
  v3.set(x, y, z).project(camera);
  out = out || {};
  out.x = (v3.x + 1) / 2 * window.innerWidth;
  out.y = (1 - v3.y) / 2 * window.innerHeight;
  out.behind = v3.z > 1;
  return out;
}
setDay(0.32);
