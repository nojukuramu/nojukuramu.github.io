/* models.js — every body in the game: loaded props, and built characters.
 *
 * The first version dressed its mage as a pirate captain, its enemies as
 * zombies, pirates and a cyborg — whatever CC0 humanoids existed, recoloured.
 * Nothing read as belonging to the same world. The environment models were
 * good (Kenney's rocks, pines, mushrooms, the chest and the fountain) and are
 * kept; the characters are now built here from primitives, in one style:
 * faceted, flat-shaded, dark bodies stitched with glowing thread. The tower is
 * a loom, and its creatures are what came loose from it.
 *
 * Every character faces +Z in its own space; the game turns it with
 * rotation.y = PI/2 - aim, the same convention as before. */

import * as THREE from "three";
import { GLTFLoader } from "../vendor/examples/jsm/loaders/GLTFLoader.js";
import { TAU, rand } from "./util.js";

/* ---------------------------------------------------------------
   Loaded models
   --------------------------------------------------------------- */
const MODELS = {};
export const TEXTURES = {};
const gltf = new GLTFLoader();
const texLoader = new THREE.TextureLoader();

export async function loadAssets(onProgress) {
  let manifest = { models: {}, textures: {} };
  try { manifest = await (await fetch("assets/manifest.json")).json(); } catch (e) {}
  const m = Object.entries(manifest.models || {}), t = Object.entries(manifest.textures || {});
  const total = m.length + t.length;
  let done = 0;
  const bump = () => { done++; if (onProgress) onProgress(done / Math.max(1, total)); };
  const jobs = [
    ...m.map(([k, e]) => gltf.loadAsync("assets/" + e.file).then((g) => {
      g.scene.updateMatrixWorld(true);
      MODELS[k] = { scene: g.scene, box: e.box, minY: e.minY };
    }).catch(() => {}).then(bump)),
    ...t.map(([k, e]) => texLoader.loadAsync("assets/" + e.file).then((tex) => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.colorSpace = THREE.NoColorSpace;   // grayscale detail, sampled as data
      TEXTURES[k] = tex;
    }).catch(() => {}).then(bump))
  ];
  // A missing model must never hang the title screen: every caller has a
  // procedural fallback, so after ten seconds we go with what arrived.
  await Promise.race([Promise.allSettled(jobs), new Promise((r) => setTimeout(r, 10000))]);
}
export function hasModel(k) { return !!MODELS[k]; }

/** Materials cloned for a floor's tints; the floor frees them when it goes. */
function tintedMaterial(src, opts) {
  if (!opts || (!opts.tint && !opts.lerp && opts.emissive === undefined)) return src;
  const m = src.clone();
  if (opts.lerp) m.color.lerp(new THREE.Color(opts.lerp[0]), opts.lerp[1]);
  if (opts.tint) m.color.multiply(new THREE.Color(opts.tint));
  if (opts.emissive !== undefined) { m.emissive = new THREE.Color(opts.emissive); m.emissiveIntensity = opts.ei === undefined ? 1 : opts.ei; }
  m.userData.floorOwned = true;
  return m;
}

/** A single copy of a loaded model, scaled so its height is `h`. */
export function modelInstance(key, h, opts) {
  const src = MODELS[key];
  if (!src) return null;
  const s = h / src.box[1];
  const inst = src.scene.clone(true);
  inst.scale.setScalar(s);
  inst.position.y = -src.minY * s;
  inst.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true;
    o.material = tintedMaterial(o.material, opts);
  });
  const g = new THREE.Group();
  g.add(inst);
  return g;
}

/**
 * Many copies of a loaded model in a handful of draw calls: one InstancedMesh
 * per sub-mesh. `list` is [{x, z, rot, h}]. A forest of forty pines is two
 * draw calls instead of eighty.
 */
export function instancedModel(key, list, opts) {
  const src = MODELS[key];
  if (!src || !list.length) return null;
  opts = opts || {};
  const group = new THREE.Group();
  const place = new THREE.Matrix4(), tmp = new THREE.Matrix4();
  const q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  src.scene.traverse((o) => {
    if (!o.isMesh) return;
    const im = new THREE.InstancedMesh(o.geometry, tintedMaterial(o.material, opts), list.length);
    im.castShadow = opts.shadow !== false; im.receiveShadow = true;
    list.forEach((it, i) => {
      const s = it.h / src.box[1];
      q.setFromAxisAngle(up, it.rot || 0);
      p.set(it.x, -src.minY * s + (it.y || 0), it.z);
      sc.set(s, s, s);
      place.compose(p, q, sc);
      tmp.multiplyMatrices(place, o.matrixWorld);
      im.setMatrixAt(i, tmp);
      if (it.color) im.setColorAt(i, new THREE.Color(it.color));
    });
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    group.add(im);
  });
  return group;
}

/* ---------------------------------------------------------------
   Shared bits
   --------------------------------------------------------------- */
export function std(color, o) {
  return new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.78, metalness: 0.05, flatShading: true }, o || {}));
}
export function glowMat(color, intensity) {
  return new THREE.MeshStandardMaterial({ color: 0x111111, emissive: color, emissiveIntensity: intensity || 2.5, roughness: 0.5, flatShading: true });
}

/* Geometry shared by every copy of a creature is built once and tagged, so
   freeing a dead enemy frees only what was made for it alone. */
const GEO = {};
function geo(key, make) {
  if (!GEO[key]) { GEO[key] = make(); GEO[key].userData.shared = true; }
  return GEO[key];
}

const shadowTex = (() => {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d");
  const gr = g.createRadialGradient(32, 32, 4, 32, 32, 31);
  gr.addColorStop(0, "rgba(0,0,0,0.55)"); gr.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false });
shadowMat.userData.shared = true;
/** A soft dark disc under a character. Real shadows only exist at medium
 *  quality and up; this keeps everything grounded on low. */
export function blobShadow(r) {
  const m = new THREE.Mesh(geo("blob", () => new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2)), shadowMat);
  m.scale.set(r, 1, r); m.position.y = 0.02; m.renderOrder = 1;
  return m;
}

/* Glowing sprites for cores and halos */
const glowTex = (() => {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d");
  const gr = g.createRadialGradient(32, 32, 1, 32, 32, 31);
  gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.3, "rgba(255,255,255,0.4)"); gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
export function halo(color, size, opacity) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: opacity === undefined ? 0.9 : opacity }));
  s.scale.setScalar(size);
  return s;
}

/* ---------------------------------------------------------------
   The mage
   --------------------------------------------------------------- */
export function buildMage() {
  const root = new THREE.Group();
  root.add(blobShadow(0.75));
  const body = new THREE.Group(); root.add(body);
  const robe = std(0x3d3f94), robeDark = std(0x2a2b6b), brass = std(0xc9a45c, { metalness: 0.5, roughness: 0.45 });
  const face = std(0x17142a), wood = std(0x6b4a2c);
  const add = (parent, g, m, x, y, z) => { const mesh = new THREE.Mesh(g, m); mesh.position.set(x, y, z); mesh.castShadow = true; parent.add(mesh); return mesh; };
  add(body, new THREE.CylinderGeometry(0.26, 0.6, 1.05, 8), robe, 0, 0.53, 0);
  add(body, new THREE.CylinderGeometry(0.62, 0.62, 0.08, 8), brass, 0, 0.05, 0);
  add(body, new THREE.CylinderGeometry(0.31, 0.33, 0.07, 8), brass, 0, 0.8, 0);
  add(body, new THREE.ConeGeometry(0.5, 0.42, 8), robeDark, 0, 1.12, 0);
  add(body, new THREE.IcosahedronGeometry(0.22, 1), face, 0, 1.3, 0.02);
  const eyeM = glowMat(0xc9b8ff, 3);
  add(body, new THREE.SphereGeometry(0.035, 6, 4), eyeM, 0.075, 1.31, 0.2);
  add(body, new THREE.SphereGeometry(0.035, 6, 4), eyeM, -0.075, 1.31, 0.2);
  // the hat: three stacked frusta, each tipped back, so it droops like felt
  const hat = new THREE.Group(); hat.position.set(0, 1.4, 0); body.add(hat);
  add(hat, new THREE.CylinderGeometry(0.54, 0.54, 0.05, 12), robeDark, 0, 0, 0);
  add(hat, new THREE.CylinderGeometry(0.3, 0.32, 0.09, 10), brass, 0, 0.06, 0);
  add(hat, new THREE.CylinderGeometry(0.19, 0.3, 0.36, 9), robe, 0, 0.26, 0);
  const tip = new THREE.Group(); tip.position.set(0, 0.44, -0.02); tip.rotation.x = -0.35; hat.add(tip);
  add(tip, new THREE.CylinderGeometry(0.09, 0.19, 0.3, 9), robe, 0, 0.13, 0);
  const tip2 = new THREE.Group(); tip2.position.set(0, 0.27, 0); tip2.rotation.x = -0.55; tip.add(tip2);
  add(tip2, new THREE.ConeGeometry(0.09, 0.28, 9), robe, 0, 0.13, 0);
  add(tip2, new THREE.SphereGeometry(0.05, 6, 4), glowMat(0xffd97a, 2.5), 0, 0.28, 0);
  // staff arm
  const arm = new THREE.Group(); arm.position.set(0.3, 1.02, 0.02); body.add(arm);
  const sleeve = add(arm, new THREE.CylinderGeometry(0.07, 0.12, 0.46, 6), robe, 0, -0.18, 0.08);
  sleeve.rotation.x = 0.6;
  const staff = new THREE.Group(); staff.position.set(0.06, -0.36, 0.3); arm.add(staff);
  add(staff, new THREE.CylinderGeometry(0.032, 0.045, 1.55, 6), wood, 0, 0.2, 0);
  const crown = add(staff, new THREE.TorusGeometry(0.12, 0.022, 5, 10), brass, 0, 1.02, 0);
  crown.rotation.y = Math.PI / 2;
  const orbMat = glowMat(0xb39dff, 3);
  const orb = add(staff, new THREE.IcosahedronGeometry(0.1, 1), orbMat, 0, 1.02, 0);
  const orbHalo = halo(0xb39dff, 1.1, 0.8); orbHalo.position.set(0, 1.02, 0); staff.add(orbHalo);
  // off hand
  const hand = add(body, new THREE.CylinderGeometry(0.07, 0.11, 0.42, 6), robe, -0.3, 0.86, 0.06);
  hand.rotation.z = -0.25;
  // the circle at your feet (texture is set by the player whenever the selected spell changes)
  const circleMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
  const circle = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6).rotateX(-Math.PI / 2), circleMat);
  circle.position.y = 0.05; circle.renderOrder = 4; root.add(circle);
  return { root, body, hat, tip, arm, staff, orb, orbMat, orbHalo, circle, circleMat, mats: [robe, robeDark, face] };
}

/* ---------------------------------------------------------------
   The Unravelled
   --------------------------------------------------------------- */
function part(parent, g, m, x, y, z, shadow) {
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(x || 0, y || 0, z || 0);
  if (shadow !== false) mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

/**
 * buildEnemy(type, accent) → { root, body, parts, flash: [materials] }
 * `accent` is the floor's thread colour; every creature's glow uses it, so a
 * Frost floor's knots burn ice-blue and an Ember floor's burn orange.
 */
export function buildEnemy(type, accent) {
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const flash = [];
  const shell = (c) => { const m = std(c); flash.push(m); return m; };
  const thread = (i) => { const m = glowMat(accent, i || 2.2); flash.push(m); return m; };
  const P = {};
  if (type === "mote") {
    root.add(blobShadow(0.35));
    const core = part(body, geo("moteCore", () => new THREE.IcosahedronGeometry(0.22, 0)), thread(3), 0, 0.9, 0);
    P.core = core;
    const wingG = geo("moteWing", () => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0.55, 0.05, -0.18, 0.42, 0, 0.22], 3));
      g.computeVertexNormals(); return g;
    });
    const wm = new THREE.MeshStandardMaterial({ color: 0x221a2e, emissive: accent, emissiveIntensity: 0.6, side: THREE.DoubleSide, transparent: true, opacity: 0.85, flatShading: true });
    flash.push(wm);
    P.wl = part(body, wingG, wm, 0.08, 0.92, 0, false);
    P.wr = part(body, wingG, wm, -0.08, 0.92, 0, false); P.wr.scale.x = -1;
    const mh = halo(accent, 1.3, 0.55); mh.position.y = 0.9; body.add(mh);
  } else if (type === "knot") {
    root.add(blobShadow(0.7));
    const ball = new THREE.Group(); ball.position.y = 0.62; body.add(ball); P.ball = ball;
    part(ball, geo("knotCore", () => new THREE.IcosahedronGeometry(0.5, 0)), shell(0x2d2233), 0, 0, 0);
    const spikeG = geo("knotSpike", () => new THREE.ConeGeometry(0.12, 0.42, 5).translate(0, 0.21, 0));
    const tip = thread(2);
    const ico = new THREE.IcosahedronGeometry(0.46, 0).attributes.position;
    const seen = new Set();
    for (let i = 0; i < ico.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(ico, i);
      const key = v.toArray().map((x) => x.toFixed(2)).join();
      if (seen.has(key)) continue; seen.add(key);
      const s = part(ball, spikeG, tip, v.x, v.y, v.z);
      s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.clone().normalize());
    }
    P.eye = part(body, geo("eye", () => new THREE.SphereGeometry(0.11, 8, 6)), glowMat(0xfff2c0, 3), 0, 0.7, 0.45);
  } else if (type === "spindle") {
    root.add(blobShadow(0.6));
    const sp = new THREE.Group(); sp.position.y = 1.15; body.add(sp); P.spindle = sp;
    const wood = shell(0x3a2c3e);
    part(sp, geo("spUp", () => new THREE.ConeGeometry(0.34, 0.8, 6).translate(0, 0.4, 0)), wood);
    part(sp, geo("spDn", () => new THREE.ConeGeometry(0.34, 0.8, 6).rotateX(Math.PI).translate(0, -0.4, 0)), wood);
    P.core = part(sp, geo("spCore", () => new THREE.OctahedronGeometry(0.2, 0)), thread(3.2), 0, 0, 0.26);
    const rg = geo("spRing", () => new THREE.TorusGeometry(0.46, 0.035, 5, 20));
    P.r1 = part(sp, rg, thread(2.2), 0, 0.15, 0); P.r1.rotation.x = Math.PI / 2;
    P.r2 = part(sp, rg, thread(2.2), 0, -0.15, 0); P.r2.rotation.x = Math.PI / 2; P.r2.scale.setScalar(0.8);
    P.halo = halo(accent, 1.8, 0.35); P.halo.position.set(0, 0, 0.26); sp.add(P.halo);
  } else if (type === "golem") {
    root.add(blobShadow(1.25));
    const stone = shell(0x4a4550), dark = shell(0x302c36);
    P.torso = new THREE.Group(); P.torso.position.y = 1.15; body.add(P.torso);
    part(P.torso, geo("gTorso", () => new THREE.BoxGeometry(1.3, 1.1, 0.95)), stone, 0, 0, 0);
    part(P.torso, geo("gHead", () => new THREE.BoxGeometry(0.62, 0.48, 0.55)), dark, 0, 0.72, 0.12);
    part(P.torso, geo("gSlit", () => new THREE.BoxGeometry(0.42, 0.08, 0.06)), thread(3), 0, 0.74, 0.41, false);
    part(P.torso, geo("gCrack", () => new THREE.BoxGeometry(0.08, 0.7, 0.06)), thread(1.8), 0.22, 0.02, 0.49, false);
    part(P.torso, geo("gCrack2", () => new THREE.BoxGeometry(0.5, 0.07, 0.06)), thread(1.8), -0.1, -0.2, 0.49, false);
    const armG = geo("gArm", () => new THREE.BoxGeometry(0.4, 1.05, 0.44).translate(0, -0.45, 0));
    P.al = new THREE.Group(); P.al.position.set(0.86, 0.35, 0); P.torso.add(P.al); part(P.al, armG, stone);
    P.ar = new THREE.Group(); P.ar.position.set(-0.86, 0.35, 0); P.torso.add(P.ar); part(P.ar, armG, stone);
    const legG = geo("gLeg", () => new THREE.BoxGeometry(0.42, 0.62, 0.46).translate(0, -0.31, 0));
    P.ll = new THREE.Group(); P.ll.position.set(0.34, 0.62, 0); body.add(P.ll); part(P.ll, legG, dark);
    P.lr = new THREE.Group(); P.lr.position.set(-0.34, 0.62, 0); body.add(P.lr); part(P.lr, legG, dark);
  } else if (type === "weaver") {
    root.add(blobShadow(0.55));
    const cloth = shell(0x2b2238);
    P.robe = part(body, geo("wRobe", () => new THREE.ConeGeometry(0.42, 1.5, 7).translate(0, 0.75, 0)), cloth, 0, 0.35, 0);
    part(body, geo("wHood", () => new THREE.IcosahedronGeometry(0.24, 0)), cloth, 0, 1.95, 0);
    part(body, geo("wFace", () => new THREE.SphereGeometry(0.07, 6, 4)), thread(3.5), 0, 1.95, 0.18, false);
    P.loom = new THREE.Group(); P.loom.position.y = 2.45; body.add(P.loom);
    const lr = part(P.loom, geo("wLoom", () => new THREE.TorusGeometry(0.5, 0.03, 4, 6)), thread(2.4), 0, 0, 0);
    lr.rotation.x = Math.PI / 2;
    for (let i = 0; i < 3; i++) {
      const bar = part(P.loom, geo("wBar", () => new THREE.CylinderGeometry(0.012, 0.012, 1, 4)), thread(1.6), 0, 0, 0, false);
      bar.rotation.set(Math.PI / 2, 0, i * Math.PI / 3);
    }
    P.halo = halo(accent, 2.4, 0.4); P.halo.position.y = 2.45; body.add(P.halo);
  } else if (type === "geode") {
    root.add(blobShadow(0.9));
    const rockM = shell(0x3a3548);
    part(body, geo("geoRock", () => new THREE.IcosahedronGeometry(0.62, 0)), rockM, 0, 0.3, 0);
    const cm = new THREE.MeshStandardMaterial({ color: 0x2a4a8a, emissive: 0x4fb4ff, emissiveIntensity: 1.6, roughness: 0.2, flatShading: true });
    flash.push(cm);
    const cg = geo("geoCrystal", () => new THREE.CylinderGeometry(0, 0.2, 1.1, 5).translate(0, 0.55, 0));
    [[0, 0.3, 0, 0, 0], [0.3, 0.2, 0.1, 0.5, 0.2], [-0.25, 0.2, -0.15, -0.45, -0.3], [0.05, 0.2, -0.3, 0.2, -0.5]].forEach(([x, y, z, rz, rx], i) => {
      const c = part(body, cg, cm, x, y, z); c.rotation.set(rx, i, rz); c.scale.setScalar(i ? 0.7 : 1);
    });
    P.halo = halo(0x4fb4ff, 2.4, 0.5); P.halo.position.y = 0.8; body.add(P.halo);
  } else if (type === "dummy") {
    root.add(blobShadow(0.6));
    const wood = shell(0x7a5634), straw = shell(0xc9a86a);
    part(body, geo("dPost", () => new THREE.CylinderGeometry(0.08, 0.1, 1.9, 6)), wood, 0, 0.95, 0);
    part(body, geo("dBody", () => new THREE.CylinderGeometry(0.34, 0.38, 0.95, 8)), straw, 0, 1.15, 0);
    part(body, geo("dHead", () => new THREE.IcosahedronGeometry(0.24, 0)), straw, 0, 1.85, 0);
    const bar = part(body, geo("dBar", () => new THREE.CylinderGeometry(0.05, 0.05, 1.4, 5)), wood, 0, 1.4, 0);
    bar.rotation.z = Math.PI / 2;
    part(body, geo("dTarget", () => new THREE.TorusGeometry(0.2, 0.05, 5, 16)), glowMat(0xe05555, 1.4), 0, 1.2, 0.36, false);
  }
  return { root, body, parts: P, flash };
}

/** An Anchor: a knot of thread the size of a tree, holding the floor shut. */
export function buildAnchor(accent) {
  const root = new THREE.Group();
  root.add(blobShadow(2.2));
  const flash = [];
  const rock = std(0x39343f); flash.push(rock);
  const base = part(root, new THREE.CylinderGeometry(1.1, 1.6, 0.9, 7), rock, 0, 0.45, 0);
  base.receiveShadow = true;
  const knotM = glowMat(accent, 2.2); flash.push(knotM);
  const knot = part(root, new THREE.TorusKnotGeometry(0.85, 0.2, 90, 8, 2, 3), knotM, 0, 3, 0);
  const cage = part(root, new THREE.IcosahedronGeometry(1.45, 0), new THREE.MeshStandardMaterial({ color: 0x221c2a, wireframe: true, emissive: accent, emissiveIntensity: 0.8 }), 0, 3, 0, false);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.35, 14, 8, 1, true),
    new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  beam.position.y = 10; root.add(beam);
  const h = halo(accent, 6, 0.5); h.position.y = 3; root.add(h);
  return { root, knot, cage, beam, halo: h, flash };
}

/* ---------------------------------------------------------------
   Bosses
   --------------------------------------------------------------- */
export function buildWarden(accent) {
  const root = new THREE.Group();
  root.add(blobShadow(2.2));
  const body = new THREE.Group(); root.add(body);
  const flash = [];
  const robe = std(0x231d2c); flash.push(robe);
  const trim = glowMat(accent, 2.2); flash.push(trim);
  const brass = std(0xc9a45c, { metalness: 0.6, roughness: 0.4 }); flash.push(brass);
  part(body, new THREE.CylinderGeometry(0.7, 1.7, 2.6, 8), robe, 0, 1.3, 0);
  part(body, new THREE.CylinderGeometry(1.72, 1.72, 0.1, 8), trim, 0, 0.1, 0, false);
  part(body, new THREE.ConeGeometry(1.25, 0.9, 8), robe, 0, 2.75, 0);
  const mask = part(body, new THREE.CylinderGeometry(0.46, 0.4, 0.2, 6), std(0xd9cdb5), 0, 3.3, 0.35);
  mask.rotation.x = Math.PI / 2;
  const eyeM = glowMat(accent, 4); flash.push(eyeM);
  part(body, new THREE.BoxGeometry(0.14, 0.05, 0.05), eyeM, 0.15, 3.36, 0.46, false);
  part(body, new THREE.BoxGeometry(0.14, 0.05, 0.05), eyeM, -0.15, 3.36, 0.46, false);
  const crown = new THREE.Group(); crown.position.y = 3.75; body.add(crown);
  const cr = part(crown, new THREE.TorusGeometry(0.55, 0.07, 5, 16), brass, 0, 0, 0);
  cr.rotation.x = Math.PI / 2;
  for (let i = 0; i < 7; i++) {
    const a = i / 7 * TAU;
    part(crown, new THREE.ConeGeometry(0.08, 0.4, 4), brass, Math.cos(a) * 0.55, 0.2, Math.sin(a) * 0.55);
  }
  const hands = [];
  for (const side of [1, -1]) {
    const hnd = new THREE.Group(); hnd.position.set(side * 1.7, 1.9, 0.6); body.add(hnd);
    part(hnd, new THREE.OctahedronGeometry(0.34, 0), robe);
    part(hnd, new THREE.OctahedronGeometry(0.16, 0), trim, 0, 0, 0.2, false);
    hands.push(hnd);
  }
  const shards = new THREE.Group(); shards.position.y = 1.8; root.add(shards);
  for (let i = 0; i < 6; i++) {
    const s = part(shards, new THREE.OctahedronGeometry(0.22, 0), trim, 0, 0, 0, false);
    s.scale.set(0.7, 1.6, 0.7);
    s.userData.a = i / 6 * TAU;
  }
  const h = halo(accent, 7, 0.28); h.position.y = 2.2; root.add(h);
  return { root, body, crown, hands, shards, halo: h, flash };
}

export function buildHeart(accent) {
  const root = new THREE.Group();
  root.add(blobShadow(3));
  const flash = [];
  const coreM = glowMat(accent, 3); flash.push(coreM);
  const shellM = std(0x1d1826, { metalness: 0.3, roughness: 0.4 }); flash.push(shellM);
  const core = part(root, new THREE.IcosahedronGeometry(1.2, 1), coreM, 0, 3.2, 0);
  const cage = part(root, new THREE.IcosahedronGeometry(1.7, 0), shellM, 0, 3.2, 0);
  cage.material = shellM.clone(); cage.material.wireframe = true; flash.push(cage.material);
  const rings = [];
  const brass = std(0xc9a45c, { metalness: 0.7, roughness: 0.35 }); flash.push(brass);
  for (let i = 0; i < 3; i++) {
    const r = part(root, new THREE.TorusGeometry(2.3 + i * 0.45, 0.08, 6, 40), brass, 0, 3.2, 0);
    r.rotation.set(rand(0, TAU), rand(0, TAU), 0);
    rings.push(r);
  }
  const shards = new THREE.Group(); shards.position.y = 3.2; root.add(shards);
  for (let i = 0; i < 8; i++) {
    const s = part(shards, new THREE.OctahedronGeometry(0.3, 0), coreM, 0, 0, 0, false);
    s.scale.set(0.6, 1.8, 0.6); s.userData.a = i / 8 * TAU;
  }
  const h = halo(accent, 10, 0.4); h.position.y = 3.2; root.add(h);
  return { root, core, cage, rings, shards, halo: h, flash };
}

/* ---------------------------------------------------------------
   Portal: a ring of standing stones around a swirling pool
   --------------------------------------------------------------- */
export function buildPortal(accent) {
  const root = new THREE.Group();
  const stoneM = std(0x55505c);
  const runeM = glowMat(accent, 0.2);
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * TAU;
    const s = part(root, new THREE.BoxGeometry(0.5, 1.3 + (i % 2) * 0.5, 0.4), stoneM, Math.cos(a) * 2.6, 0.65 + (i % 2) * 0.25, Math.sin(a) * 2.6);
    s.rotation.y = -a;
    s.receiveShadow = true;
    const r = part(root, new THREE.BoxGeometry(0.08, 0.5, 0.05), runeM, Math.cos(a) * 2.38, 0.9, Math.sin(a) * 2.38, false);
    r.rotation.y = -a + Math.PI / 2;
  }
  const poolMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(accent) }, uOn: { value: 0 } },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: [
      "uniform float uTime; uniform vec3 uColor; uniform float uOn; varying vec2 vUv;",
      "void main(){ vec2 p = vUv * 2.0 - 1.0; float d = length(p); if (d > 1.0) discard;",
      "  float a = atan(p.y, p.x); float sw = sin(a * 5.0 + d * 12.0 - uTime * 3.0) * 0.5 + 0.5;",
      "  float core = 1.0 - d; float v = mix(0.15, 1.0, uOn) * (core * 0.8 + sw * 0.35 * core + smoothstep(0.8, 1.0, d) * 0.6);",
      "  gl_FragColor = vec4(uColor * v * mix(0.5, 2.2, uOn), mix(0.35, 0.95, uOn) * (0.3 + 0.7 * v));",
      "  #include <tonemapping_fragment>",
      "  #include <colorspace_fragment>",
      "}"].join("\n"),
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
  });
  const pool = new THREE.Mesh(new THREE.CircleGeometry(2.1, 40).rotateX(-Math.PI / 2), poolMat);
  pool.position.y = 0.06; root.add(pool);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.1, 16, 24, 1, true),
    new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  beam.position.y = 8; root.add(beam);
  return { root, poolMat, beam, runeM };
}
