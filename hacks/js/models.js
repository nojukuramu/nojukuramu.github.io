/* models.js — the guns, the blades and the body, loaded once from assets/models.
 *
 * Everything there is CC0 (assets/models/CREDITS.md), converted for this game
 * so that nothing has to be fitted at runtime: metres, the barrel along -Z,
 * the grip at the origin, and empty nodes where the muzzle, the sight and
 * the other hand go. The sight line is level by construction, which is what
 * lets viewmodel.js put it exactly on the camera's axis — where the shot goes —
 * on any screen.
 *
 * Loading is in the background and nothing waits for it: until a model has
 * arrived (or if it never does, offline before the first install finished)
 * the renderer keeps drawing the box-built versions it always had.
 *
 * The body is one skinned mesh with an eight-band texture atlas; paint()
 * makes each player's own, so a shirt is a team or a player colour and the
 * skin and hair vary from one player to the next. */

import * as THREE from "three";
import { GLTFLoader } from "../vendor/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "../vendor/jsm/utils/SkeletonUtils.js";
import { mulberry32 } from "./util.js";

const GUN_FILES = ["kestrel", "hornet", "wasp", "brick", "mauler", "talon", "katana", "lancer"];
/* Guns with no file of their own: another model, bigger and in a darker finish. The Condor is the Talon's
   rifle grown to a .50 — its anchors scale with it, so its scope still sits on the axis when aimed. */
const DERIVED = { condor: { from: "talon", scale: 1.16, tint: 0x5a5e52 } };
const M = { guns: {}, human: null };
let started = false, loaded = 0;
const listeners = [];

export const modelsReady = () => loaded === GUN_FILES.length + 1;
export function onModels(fn) { listeners.push(fn); }

/** One template per file: the scene, and the anchors as plain vectors. */
function template(id, scene) {
  const anchor = (n) => { const o = scene.getObjectByName(n); return o ? o.position.clone() : null; };
  scene.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    for (const m of [].concat(o.material)) { m.envMapIntensity = 0.7; if (m.name === "Blade") m.envMapIntensity = 1.3; }
  });
  return { id, scene, muzzle: anchor("muzzle") || new THREE.Vector3(0, 0, -0.5), sight: anchor("sight"), support: anchor("support") };
}

export function loadModels() {
  if (started) return;
  started = true;
  const loader = new GLTFLoader();
  const done = () => { loaded++; if (modelsReady()) listeners.forEach((f) => f()); };
  for (const id of GUN_FILES) {
    loader.load("assets/models/" + id + ".glb", (g) => { M.guns[id] = template(id, g.scene); derive(id); done(); }, undefined, () => { /* keep the boxes */ });
  }
  loader.load("assets/models/human.glb", (g) => {
    const body = g.scene.getObjectByName("Body");
    if (body) { M.human = g.scene; done(); }
  }, undefined, () => { /* keep the mannequins */ });
}

function derive(from) {
  for (const id in DERIVED) {
    const d = DERIVED[id], t = M.guns[from];
    if (d.from !== from || !t) continue;
    const inner = t.scene.clone(true);
    const tint = new THREE.Color(d.tint);
    const tinted = (m) => { const c = m.clone(); if (c.color) c.color.multiply(tint).multiplyScalar(1.6); return c; };
    inner.traverse((o) => { if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map(tinted) : tinted(o.material); });
    const scene = new THREE.Group();
    inner.scale.setScalar(d.scale);
    scene.add(inner);
    const k = (v) => (v ? v.clone().multiplyScalar(d.scale) : null);
    M.guns[id] = { id, scene, muzzle: k(t.muzzle), sight: k(t.sight), support: k(t.support) };
  }
}

/* Things with no file at all, built here: the cannon and the grappling gun. Same conventions as the
   files — metres, the barrel along -Z, the grip at the origin, a level sight line — so the viewmodel
   aims them and a body holds them exactly as it does the others. */
const PROC = {
  cannon() {
    const g = new THREE.Group();
    const iron = new THREE.MeshStandardMaterial({ color: 0x2b2f35, roughness: 0.42, metalness: 0.75 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xb58a3c, roughness: 0.35, metalness: 0.85 });
    const grip = new THREE.MeshStandardMaterial({ color: 0x3a2a1e, roughness: 0.8 });
    const cyl = (r0, r1, l, mat, z, y) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, l, 18), mat); m.rotation.x = Math.PI / 2; m.position.set(0, y || 0.03, z); g.add(m); return m; };
    cyl(0.036, 0.046, 0.56, iron, -0.24);
    cyl(0.05, 0.05, 0.035, brass, -0.505);
    cyl(0.049, 0.049, 0.025, brass, -0.08);
    const breech = new THREE.Mesh(new THREE.SphereGeometry(0.052, 16, 12), iron); breech.position.set(0, 0.03, 0.04); g.add(breech);
    const box = (sx, sy, sz, mat, x, y, z, rx) => { const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat); m.position.set(x, y, z); if (rx) m.rotation.x = rx; g.add(m); return m; };
    box(0.034, 0.1, 0.045, grip, 0, -0.06, 0.02, 0.25);
    box(0.03, 0.08, 0.04, grip, 0, -0.05, -0.27, -0.1);
    box(0.012, 0.02, 0.012, brass, 0, 0.087, 0.0);
    box(0.008, 0.018, 0.008, brass, 0, 0.087, -0.46);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return { id: "cannon", scene: g, muzzle: new THREE.Vector3(0, 0.03, -0.53), sight: new THREE.Vector3(0, 0.096, 0.0), support: new THREE.Vector3(0, -0.02, -0.27) };
  },
  grapple() {
    const g = new THREE.Group();
    const body = new THREE.MeshStandardMaterial({ color: 0x252a31, roughness: 0.5, metalness: 0.5 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x9aa4b2, roughness: 0.3, metalness: 0.85 });
    const glow = new THREE.MeshStandardMaterial({ color: 0x39c6e8, emissive: 0x1a7f99, emissiveIntensity: 0.8 });
    const box = (sx, sy, sz, mat, x, y, z, rx) => { const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat); m.position.set(x, y, z); if (rx) m.rotation.x = rx; g.add(m); return m; };
    box(0.05, 0.06, 0.2, body, 0, 0, -0.07);
    box(0.052, 0.012, 0.14, glow, 0, 0.032, -0.07);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.09, 12), steel); barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0, -0.21); g.add(barrel);
    for (let i = 0; i < 3; i++) { const t = box(0.008, 0.008, 0.05, steel, 0, 0, -0.27); t.rotation.z = i * Math.PI * 2 / 3; t.position.set(Math.cos(i * 2.1) * 0.02, Math.sin(i * 2.1) * 0.02, -0.265); }
    box(0.032, 0.095, 0.045, body, 0, -0.07, 0.01, 0.25);
    box(0.01, 0.014, 0.01, steel, 0, 0.045, 0.0);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return { id: "grapple", scene: g, muzzle: new THREE.Vector3(0, 0, -0.28), sight: new THREE.Vector3(0, 0.052, 0.0), support: null };
  }
};

export const gunTemplate = (id) => M.guns[id] || null;
/** A copy of a gun or blade: shared geometry and materials, its own transform. */
export function gunCopy(id) {
  if (!M.guns[id] && PROC[id]) M.guns[id] = PROC[id]();
  const t = M.guns[id];
  if (!t) return null;
  const g = t.scene.clone(true);
  return { obj: g, t };
}

/* ---------------------------------------------------------------
   The body
   --------------------------------------------------------------- */
export const hasHuman = () => !!M.human;
/** A posable copy of the body: its root, the skinned mesh, and its bones by name. */
export function humanCopy() {
  if (!M.human) return null;
  const root = cloneSkinned(M.human);
  let mesh = null;
  const bones = {};
  root.traverse((o) => { if (o.isSkinnedMesh) mesh = o; if (o.isBone) bones[o.name] = o; });
  mesh.frustumCulled = false;     // the bind pose's bounds say nothing about a slide or a lunge
  return { root, mesh, bones };
}

/* The atlas: eight horizontal bands, top to bottom, that the converted body's UVs point into. */
const BANDS = ["skin", "eyes", "hair", "top", "trousers", "boots", "gloves", "spare"];   // spare: the sleeves
const SKINS = ["#f1c7a0", "#e0ac83", "#c68a62", "#a86f4c", "#7f5238", "#5c3b28"];
const HAIRS = ["#1d1a17", "#3b2a1c", "#6b4a2b", "#a07a45", "#d3b06d", "#8c3a22", "#cfd3d8", "#262b33"];
const TROUSERS = ["#2a2f38", "#323a2c", "#3a3530", "#232831"];
const hex = (c) => "#" + c.toString(16).padStart(6, "0");

/** A player's own texture: their colour on the shirt, a skin and hair picked from their id. */
export function paint(color, seed) {
  const rnd = mulberry32((seed | 0) * 2654435761);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const sleeve = new THREE.Color(color).lerp(new THREE.Color(0x1c2128), 0.7);
  const fill = { skin: pick(SKINS), eyes: "#15171a", hair: pick(HAIRS), top: hex(color), trousers: pick(TROUSERS), boots: "#15171b", gloves: "#20242b", spare: "#" + sleeve.getHexString() };
  const c = document.createElement("canvas");
  c.width = 4; c.height = 32;
  const g = c.getContext("2d");
  BANDS.forEach((b, i) => { g.fillStyle = fill[b]; g.fillRect(0, i * 4, 4, 4); });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
}
