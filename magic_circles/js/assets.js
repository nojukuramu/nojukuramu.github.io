/* assets.js — Kenney's models, loaded once and drawn many times.
 *
 * Every model is one of Kenney's CC0 kits (assets/CREDITS.md). They are
 * loaded at boot from assets/manifest.json, which tools/manifest.js writes
 * with each model's bounds, and turned into one of two things:
 *
 *   props       baked to a few geometries (one per material), recentred on
 *               their footprint and standing on y = 0, and drawn through
 *               instanced pools: every tree of one kind in the loaded world
 *               is one draw call, however many chunks it is spread across.
 *   characters  the animated ones (the Mini Characters, the Graveyard's
 *               dead, the Mini Dungeon orc) share one rig and one set of
 *               clips — idle, walk, sprint, die, holding-right-shoot … —
 *               so a clone of the scene and an AnimationMixer is all a
 *               creature needs.
 *
 * Magic Sandbox's models.js loads the same way (GLTFLoader, a manifest, a
 * ten-second cut-off so a missing file can never hang the title); the
 * instanced pools are new, because a world that streams in chunks cannot
 * afford a mesh per tree. */

import * as THREE from "three";
import { GLTFLoader } from "../vendor/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "../vendor/examples/jsm/utils/BufferGeometryUtils.js";
import { clone as cloneSkinned } from "../vendor/examples/jsm/utils/SkeletonUtils.js";
import { scene } from "./gfx.js";

const loader = new GLTFLoader();
const PROTOS = {};
let manifest = { models: {} };

export async function loadAssets(onProgress) {
  try { manifest = await (await fetch("assets/manifest.json")).json(); } catch (e) {}
  const entries = Object.entries(manifest.models || {});
  let done = 0;
  const jobs = entries.map(([k, e]) => loader.loadAsync("assets/" + e.file).then((g) => {
    PROTOS[k] = e.animated ? character(k, g, e) : prop(k, g, e);
  }).catch((err) => console.warn("[mcircles] model " + k, err)).then(() => { done++; if (onProgress) onProgress(done / entries.length); }));
  // A missing model must never hang the title: every caller copes without one.
  await Promise.race([Promise.allSettled(jobs), new Promise((r) => setTimeout(r, 15000))]);
}
export const has = (k) => !!PROTOS[k];
export const size = (k) => (PROTOS[k] ? PROTOS[k].size : [1, 1, 1]);

/* Kenney's textured kits share one colour atlas per kit; three's loader
   gives every model its own copy of the material. One per kit keeps the
   number of shader programs, and of state changes, down to a handful. The
   key is the kit (the folder a model sits in), not the texture: the loader
   hands back image bitmaps, which carry no address to tell them apart. */
const sharedMats = new Map();
function shareMaterial(m, kit) {
  const k = kit + ":" + (m.map ? "atlas" : m.color.getHexString()) + (m.transparent ? ":t" : "") + (m.vertexColors ? ":v" : "");
  let s = sharedMats.get(k);
  if (!s) {
    s = m;
    s.metalness = 0; s.roughness = Math.max(0.7, s.roughness || 1);
    if (s.map) { s.map.anisotropy = 4; }
    sharedMats.set(k, s);
  }
  return s;
}

function prop(key, g, e) {
  g.scene.updateMatrixWorld(true);
  const cx = (e.min[0] + e.max[0]) / 2, cz = (e.min[2] + e.max[2]) / 2, y0 = e.min[1];
  const byMat = new Map();
  g.scene.traverse((o) => {
    if (!o.isMesh) return;
    const geo = o.geometry.clone();
    geo.applyMatrix4(o.matrixWorld);
    geo.translate(-cx, -y0, -cz);
    for (const name of Object.keys(geo.attributes)) if (!["position", "normal", "uv"].includes(name)) geo.deleteAttribute(name);
    if (!geo.attributes.uv) geo.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    const mat = shareMaterial(o.material, key.split("/")[0]);
    if (!byMat.has(mat)) byMat.set(mat, []);
    byMat.get(mat).push(geo.index ? geo.toNonIndexed() : geo);
  });
  const parts = [];
  for (const [mat, geos] of byMat) {
    const geo = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    geo.computeBoundingSphere();
    parts.push({ geo, mat });
  }
  return { key, kind: "prop", parts, size: [e.max[0] - e.min[0], e.max[1] - e.min[1], e.max[2] - e.min[2]] };
}

function character(key, g, e) {
  g.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; o.frustumCulled = false; o.material = shareMaterial(o.material, key.split("/")[0]); } });
  const clips = {};
  for (const c of g.animations) clips[c.name] = c;
  return { key, kind: "character", scene: g.scene, clips, size: [e.max[0] - e.min[0], e.max[1] - e.min[1], e.max[2] - e.min[2]] };
}

/* ---------------------------------------------------------------
   Characters
   --------------------------------------------------------------- */
/**
 * A copy of an animated model, `h` metres tall, with its mixer.
 * Returns { root, model, play(name, fade, once), update(dt), nodes } or null.
 * `nodes` holds the rig's parts by name (head, arm-right…) so a hat or a
 * staff can be hung on them.
 */
export function makeCharacter(key, h, opts) {
  const P = PROTOS[key];
  if (!P || P.kind !== "character") return null;
  opts = opts || {};
  const root = new THREE.Group();
  // The Mini Characters are skinned; a plain clone would leave every copy
  // bound to the first one's skeleton.
  const model = cloneSkinned(P.scene);
  const s = h / Math.max(0.01, P.size[1]);
  model.scale.setScalar(s);
  if (opts.tint || opts.emissive !== undefined) {
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.material = o.material.clone();
      if (opts.tint) o.material.color.multiply(new THREE.Color(opts.tint));
      if (opts.emissive !== undefined) { o.material.emissive = new THREE.Color(opts.emissive); o.material.emissiveIntensity = opts.ei || 0.4; }
      if (opts.opacity !== undefined) { o.material.transparent = true; o.material.opacity = opts.opacity; o.material.depthWrite = false; }
      o.material.userData.owned = true;
    });
  }
  root.add(model);
  const nodes = {};
  model.traverse((o) => { if (o.name) nodes[o.name] = o; });
  const mixer = new THREE.AnimationMixer(model);
  const actions = {};
  let current = null;
  function play(name, fade, once) {
    const clip = P.clips[name];
    if (!clip) return null;
    let a = actions[name];
    if (!a) { a = actions[name] = mixer.clipAction(clip); }
    if (current === a && !once) return a;
    a.reset();
    a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    a.clampWhenFinished = !!once;
    a.enabled = true;
    a.setEffectiveWeight(1);
    if (current && current !== a) a.crossFadeFrom(current, fade === undefined ? 0.15 : fade, false);
    a.play();
    current = a;
    return a;
  }
  return {
    root, model, nodes, mixer, play,
    setSpeed(v) { if (current) current.timeScale = v; },
    update(dt) { mixer.update(dt); },
    dispose() {
      mixer.stopAllAction();
      model.traverse((o) => { if (o.isMesh && o.material.userData.owned) o.material.dispose(); });
    }
  };
}

/* ---------------------------------------------------------------
   Instanced props
   --------------------------------------------------------------- */
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const pools = new Map();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const _c = new THREE.Color();

class Pool {
  constructor(P, cap, shadow) {
    this.P = P; this.cap = cap; this.used = 0; this.free = [];
    this.meshes = P.parts.map((part) => {
      const im = new THREE.InstancedMesh(part.geo, part.mat, cap);
      im.count = 0;
      im.castShadow = shadow; im.receiveShadow = true;
      im.frustumCulled = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.setColorAt(0, _c.setRGB(1, 1, 1));
      scene.add(im);
      return im;
    });
  }
  add(matrix) {
    let i;
    if (this.free.length) i = this.free.pop();
    else if (this.used < this.cap) i = this.used++;
    else return -1;
    for (const im of this.meshes) {
      im.setMatrixAt(i, matrix);
      im.setColorAt(i, _c.setRGB(1, 1, 1));
      im.count = Math.max(im.count, this.used);
      im.instanceMatrix.needsUpdate = true;
      im.instanceColor.needsUpdate = true;
    }
    return i;
  }
  set(i, matrix) { for (const im of this.meshes) { im.setMatrixAt(i, matrix); im.instanceMatrix.needsUpdate = true; } }
  tint(i, r, g, b) { for (const im of this.meshes) { im.setColorAt(i, _c.setRGB(r, g, b)); im.instanceColor.needsUpdate = true; } }
  remove(i) {
    if (i < 0) return;
    this.set(i, ZERO);
    this.free.push(i);
    // shrink the drawn range when the top of it empties
    while (this.used > 0 && this.free.includes(this.used - 1)) { this.free.splice(this.free.indexOf(this.used - 1), 1); this.used--; }
    for (const im of this.meshes) im.count = this.used;
  }
}

/* How many of each a loaded world can hold. Generous: a pool that runs out
   only means a few far props go undrawn until something nearer frees one. */
const CAP_DEFAULT = 600;
const CAPS = { "nature/grass": 3000, "nature/grass_large": 2000, "nature/grass_leafs": 1500, "nature/flower_redA": 900, "nature/flower_yellowA": 900, "nature/flower_purpleA": 900, "nature/rock_smallA": 900, "nature/rock_smallC": 900 };
const NO_SHADOW = /grass|flower|lily|rock_small|mushroom/;
function pool(key) {
  let p = pools.get(key);
  if (!p) {
    const P = PROTOS[key];
    if (!P || P.kind !== "prop") return null;
    p = new Pool(P, CAPS[key] || CAP_DEFAULT, !NO_SHADOW.test(key));
    pools.set(key, p);
  }
  return p;
}

/** A handle on one placed prop: move it, tint it, take it away. */
export class Placed {
  constructor(key, p, i, x, y, z, rot, sx, sy, sz) {
    this.key = key; this.p = p; this.i = i;
    this.x = x; this.y = y; this.z = z; this.rot = rot; this.sx = sx; this.sy = sy; this.sz = sz;
  }
  update() {
    if (this.i < 0) return;
    _q.setFromAxisAngle(_up, this.rot);
    _p.set(this.x, this.y, this.z); _s.set(this.sx, this.sy, this.sz);
    this.p.set(this.i, _m.compose(_p, _q, _s));
  }
  tint(r, g, b) { if (this.i >= 0) this.p.tint(this.i, r, g, b); }
  remove() { if (this.i >= 0) { this.p.remove(this.i); this.i = -1; } }
}

/**
 * Place a prop. `fit` sizes it: { h } for a height in metres, { w } for its
 * widest footprint, { s } for a plain scale of the model's own units.
 * `stretch` is an extra [x, y, z] factor (walls are stretched to a cell).
 */
export function place(key, x, z, rot, fit, y, stretch) {
  const p = pool(key);
  if (!p) return null;
  const sz = p.P.size;
  let s = 1;
  if (fit && fit.h) s = fit.h / Math.max(0.01, sz[1]);
  else if (fit && fit.w) s = fit.w / Math.max(0.01, Math.max(sz[0], sz[2]));
  else if (fit && fit.s) s = fit.s;
  const st = stretch || [1, 1, 1];
  _q.setFromAxisAngle(_up, rot || 0);
  _p.set(x, y || 0, z); _s.set(s * st[0], s * st[1], s * st[2]);
  const i = p.add(_m.compose(_p, _q, _s));
  if (i < 0) return null;
  return new Placed(key, p, i, x, y || 0, z, rot || 0, s * st[0], s * st[1], s * st[2]);
}

/** One ordinary mesh copy of a prop, for the few things that move on their own (a chest lid, a spinning sigil). */
export function single(key, fit) {
  const P = PROTOS[key];
  if (!P || P.kind !== "prop") return null;
  const g = new THREE.Group();
  let s = 1;
  if (fit && fit.h) s = fit.h / Math.max(0.01, P.size[1]);
  else if (fit && fit.w) s = fit.w / Math.max(0.01, Math.max(P.size[0], P.size[2]));
  for (const part of P.parts) {
    const m = new THREE.Mesh(part.geo, part.mat);
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
  }
  g.scale.setScalar(s);
  const wrap = new THREE.Group();
  wrap.add(g);
  return wrap;
}

export function poolStats() {
  let n = 0, draws = 0;
  for (const p of pools.values()) { n += p.used - p.free.length; draws += p.meshes.length; }
  return { instances: n, draws, pools: pools.size };
}
