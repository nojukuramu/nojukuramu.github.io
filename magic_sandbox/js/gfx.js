/* gfx.js — the renderer, the camera, the lights, and how much of each a
 * device can afford.
 *
 * Three quality tiers, because the same page has to run on a gaming laptop
 * and on a three-year-old phone:
 *
 *   low     no shadows, no bloom, a reduced pixel ratio
 *   medium  soft sun shadows, no bloom
 *   high    shadows plus bloom, so spells actually glow
 *
 * "Auto" picks medium on touch devices and high elsewhere, then watches the
 * frame rate and steps down once if the device cannot keep up — a game that
 * stutters is worse than a game with fewer shadows, and nobody should have to
 * find a settings page to learn that. */

import * as THREE from "three";
import { EffectComposer } from "../vendor/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "../vendor/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "../vendor/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "../vendor/examples/jsm/postprocessing/OutputPass.js";
import { clamp, damp } from "./util.js";

export const IS_TOUCH = typeof window !== "undefined" && (("ontouchstart" in window) || navigator.maxTouchPoints > 0);

const canvas = document.getElementById("gl");
export const renderer = new THREE.WebGLRenderer({ canvas, antialias: (window.devicePixelRatio || 1) < 2, powerPreference: "high-performance" });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

export const scene = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 260);

export const hemi = new THREE.HemisphereLight(0xbfd6ff, 0x2a3320, 1.1);
scene.add(hemi);
export const sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
sun.shadow.camera.left = -24; sun.shadow.camera.right = 24;
sun.shadow.camera.top = 24; sun.shadow.camera.bottom = -24;
sun.shadow.camera.near = 1; sun.shadow.camera.far = 90;
sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
export const ambient = new THREE.AmbientLight(0xffffff, 0.15);
scene.add(ambient);

let composer = null, bloom = null;
let tier = "medium", wanted = "auto";
const TIERS = {
  low:    { dpr: 0.85, shadows: false, bloom: false, map: 0 },
  medium: { dpr: 1.5,  shadows: true,  bloom: false, map: 1024 },
  high:   { dpr: 2,    shadows: true,  bloom: true,  map: 2048 }
};

function buildComposer() {
  if (composer) return;
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.75, 0.55, 0.82);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
}

export function currentTier() { return tier; }
export function wantedQuality() { return wanted; }

export function setQuality(q) {
  wanted = q || "auto";
  tier = wanted === "auto" ? (IS_TOUCH ? "medium" : "high") : wanted;
  applyTier();
}

function applyTier() {
  const T = TIERS[tier];
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, T.dpr));
  const hadShadows = renderer.shadowMap.enabled;
  renderer.shadowMap.enabled = T.shadows;
  sun.castShadow = T.shadows;
  if (T.shadows && sun.shadow.mapSize.x !== T.map) {
    sun.shadow.mapSize.set(T.map, T.map);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  }
  // Toggling shadows changes every lit shader's defines; three only notices
  // when materials are flagged, so flag them.
  if (hadShadows !== T.shadows) scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); });
  if (T.bloom) buildComposer();
  resize();
}

export function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.fov = camera.aspect < 1 ? 52 : 40;
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

/* ---------------------------------------------------------------
   Frame-rate watch: step down once when a device is clearly struggling.
   --------------------------------------------------------------- */
let slowFor = 0, fpsAvg = 60, onDowngrade = null;
export function watchPerformance(cb) { onDowngrade = cb; }
function perf(dt) {
  if (dt <= 0) return;
  fpsAvg = damp(fpsAvg, 1 / dt, 2, dt);
  if (wanted !== "auto" || tier === "low") return;
  if (fpsAvg < (tier === "high" ? 45 : 36)) slowFor += dt; else slowFor = Math.max(0, slowFor - dt * 2);
  if (slowFor > 4) {
    slowFor = 0; fpsAvg = 60;
    tier = tier === "high" ? "medium" : "low";
    applyTier();
    if (onDowngrade) onDowngrade(tier);
  }
}
export function fps() { return fpsAvg; }

/* ---------------------------------------------------------------
   Camera: a tilted top-down follow that leans toward where you aim, eases
   out a little for bosses, and takes screen shake as a decaying impulse.
   --------------------------------------------------------------- */
const cam = { x: 0, z: 0, zoom: 1, shake: 0, kickX: 0, kickZ: 0, pitch: 0.98 };
export const camState = cam;
export let shakeEnabled = true;
export function setShakeEnabled(v) { shakeEnabled = v; }
export function addShake(s) { if (shakeEnabled) cam.shake = Math.min(1.4, cam.shake + s); }
export function kick(ang, s) { if (!shakeEnabled) return; cam.kickX -= Math.cos(ang) * s; cam.kickZ -= Math.sin(ang) * s; }

function baseDistance() {
  const v = THREE.MathUtils.degToRad(camera.fov / 2);
  const h = Math.atan(Math.tan(v) * camera.aspect);
  return clamp(Math.max(11 / Math.tan(h), 8.5 / Math.tan(v)), 20, 36);
}

export function snapCamera(x, z) { cam.x = x; cam.z = z; }

export function updateCamera(tx, tz, leadX, leadZ, zoom, dt) {
  cam.x = damp(cam.x, tx + leadX, 6, dt);
  cam.z = damp(cam.z, tz + leadZ, 6, dt);
  cam.zoom = damp(cam.zoom, zoom, 2.5, dt);
  cam.shake = Math.max(0, cam.shake - dt * 2.6);
  cam.kickX = damp(cam.kickX, 0, 14, dt);
  cam.kickZ = damp(cam.kickZ, 0, 14, dt);
  const s = cam.shake * cam.shake;
  const sx = (Math.random() - 0.5) * s * 1.2, sz = (Math.random() - 0.5) * s * 1.2;
  const d = baseDistance() * cam.zoom;
  const cx = cam.x + sx + cam.kickX, cz = cam.z + sz + cam.kickZ;
  camera.position.set(cx, Math.sin(cam.pitch) * d, cz + Math.cos(cam.pitch) * d);
  camera.lookAt(cx, 0, cz);
  // Fog starts just past the ground under the camera, so the arena is always
  // clear and only the drop beyond the island's edge fades into the abyss.
  if (scene.fog) { scene.fog.near = d * 1.12; scene.fog.far = d * 2.7; }
  // The shadow frustum follows the view, snapped to whole shadow texels so
  // the edges do not crawl as you walk.
  const texel = 48 / (sun.shadow.mapSize.x || 1024);
  const fx = Math.round(cam.x / texel) * texel, fz = Math.round(cam.z / texel) * texel;
  sun.target.position.set(fx, 0, fz);
  sun.position.set(fx - 14, 32, fz + 10);
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

export function applyTheme(T) {
  scene.background = new THREE.Color(T.sky);
  scene.fog = new THREE.Fog(T.sky, 34, 95);
  hemi.color.setHex(T.hemiSky); hemi.groundColor.setHex(T.hemiGround); hemi.intensity = T.hemiI;
  sun.color.setHex(T.sun); sun.intensity = T.sunI;
  ambient.color.setHex(T.hemiSky); ambient.intensity = 0.12;
  renderer.toneMappingExposure = T.exposure || 1.05;
  if (bloom) bloom.strength = T.bloom || 0.75;
}
