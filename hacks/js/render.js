/* render.js — everything you see: the arena, the bodies, your gun, the
 * tracers, and the camera they are seen from.
 *
 * The arena is drawn straight from its brushes: every face becomes two or
 * more triangles in one merged mesh, coloured by its kind and textured with
 * a world-aligned grid — the look of a Source dev map, on purpose, because a
 * one-metre grid is how you judge a jump before you make it. Brush edges are
 * outlined so ledges read at speed.
 *
 * Bodies are mannequins built on skeleton.js's bones: a limb is a cylinder
 * stretched between two of them, so the figure you see is exactly the one
 * the hitboxes and the hack API describe. Your own gun is a second scene
 * drawn over the first with its own camera, so it never clips into walls.
 *
 * Three quality tiers, chosen the way Magic Sandbox's gfx.js does it: "auto"
 * starts at high on computers and medium on phones, and steps down once if
 * the frame rate cannot keep up. */

import * as THREE from "three";
import { S } from "./state.js";
import { KINDS } from "./map.js";
import { BI } from "./skeleton.js";
import { world, owns, renderPos } from "./game.js";
import { GUNS, gunOf } from "./weapons.js";
import { ray, newTrace } from "./brush.js";
import { LUNGE } from "./movement.js";
import { save } from "./save.js";
import { clamp, damp, wrapAngle } from "./util.js";

export const IS_TOUCH = typeof window !== "undefined" && (("ontouchstart" in window) || navigator.maxTouchPoints > 0);

const canvas = document.getElementById("gl");
export const renderer = new THREE.WebGLRenderer({ canvas, antialias: (window.devicePixelRatio || 1) < 2, powerPreference: "high-performance" });
renderer.autoClear = false;
renderer.outputColorSpace = THREE.SRGBColorSpace;

export const scene = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 400);
camera.rotation.order = "YXZ";
const vScene = new THREE.Scene();
const vCam = new THREE.PerspectiveCamera(58, 1, 0.01, 10);

// three.js r160 measures light physically, so these read high next to older code
scene.background = skyTexture();
scene.fog = new THREE.Fog(0x1d2a3a, 110, 300);
scene.add(new THREE.HemisphereLight(0xd8e6ff, 0x3a4250, 2.6));
const sun = new THREE.DirectionalLight(0xfff4e6, 2.6);
sun.position.set(0.45, 1, 0.3);
scene.add(sun);
vScene.add(new THREE.HemisphereLight(0xdde8ff, 0x303848, 2.4));
const vsun = new THREE.DirectionalLight(0xffffff, 1.8);
vsun.position.set(0.3, 1, 0.6);
vScene.add(vsun);

function skyTexture() {
  const c = document.createElement("canvas");
  c.width = 4; c.height = 256;
  const g = c.getContext("2d");
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, "#0b1220"); gr.addColorStop(0.55, "#1d2a3a"); gr.addColorStop(1, "#2b3a4c");
  g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ---------------------------------------------------------------
   Quality
   --------------------------------------------------------------- */
const TIERS = { low: { dpr: 0.75 }, medium: { dpr: 1.25 }, high: { dpr: 2 } };
let tier = "high", wanted = "auto", slowFrames = 0, stepped = false;
export function setQuality(q) {
  wanted = q || "auto";
  tier = wanted === "auto" ? (IS_TOUCH ? "medium" : "high") : wanted;
  stepped = false;
  resize();
}
export const currentTier = () => tier;
function watchFrameRate(dt) {
  if (wanted !== "auto" || stepped) return;
  slowFrames = dt > 1 / 40 ? slowFrames + 1 : Math.max(0, slowFrames - 0.5);
  if (slowFrames > 90) { stepped = true; tier = tier === "high" ? "medium" : "low"; resize(); }
}
export function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, TIERS[tier].dpr));
  renderer.setSize(w, h, false);
  camera.aspect = vCam.aspect = w / h;
  camera.updateProjectionMatrix(); vCam.updateProjectionMatrix();
}

/* ---------------------------------------------------------------
   The arena
   --------------------------------------------------------------- */
function gridTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  g.fillStyle = "#d9dde4"; g.fillRect(0, 0, 256, 256);
  g.fillStyle = "#cfd4dc"; g.fillRect(0, 0, 128, 128); g.fillRect(128, 128, 128, 128);
  g.strokeStyle = "rgba(20,26,36,0.28)"; g.lineWidth = 2;
  for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, 256); g.stroke(); g.beginPath(); g.moveTo(0, i * 64); g.lineTo(256, i * 64); g.stroke(); }
  g.strokeStyle = "rgba(20,26,36,0.5)"; g.lineWidth = 4;
  g.strokeRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let mapGroup = null;
export function buildArena() {
  if (mapGroup) return;
  const W = world();
  mapGroup = new THREE.Group();
  const pos = [], nor = [], uv = [], col = [], padPos = [], padNor = [];
  const edges = [];
  const color = new THREE.Color();
  for (const b of W.brushes) {
    const K = KINDS[b.kind] || KINDS.wall;
    if (K.invisible) continue;
    color.setHex(K.color).convertSRGBToLinear();
    for (const f of b.faces) {
      const n = f.n;
      if (n[1] < -0.9 && b.min[1] <= 0.01) continue;            // undersides nobody sees
      const vs = f.idx.map((i) => b.verts[i]);
      if (vs.every((v) => v[1] <= 0) && b.kind !== "floor") continue;  // below the floor
      const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
      const proj = ay >= ax && ay >= az ? (v) => [v[0] / 4, v[2] / 4] : ax >= az ? (v) => [v[2] / 4, v[1] / 4] : (v) => [v[0] / 4, v[1] / 4];
      const P = b.kind === "pad" ? padPos : pos, N = b.kind === "pad" ? padNor : nor;
      for (let i = 1; i < vs.length - 1; i++) {
        for (const v of [vs[0], vs[i], vs[i + 1]]) {
          P.push(v[0], v[1], v[2]); N.push(n[0], n[1], n[2]);
          if (b.kind !== "pad") { const q = proj(v); uv.push(q[0], q[1]); col.push(color.r, color.g, color.b); }
        }
      }
      for (let i = 0; i < vs.length; i++) { const a = vs[i], c = vs[(i + 1) % vs.length]; edges.push(a[0], a[1], a[2], c[0], c[1], c[2]); }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  mapGroup.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: gridTexture(), vertexColors: true })));
  const pg = new THREE.BufferGeometry();
  pg.setAttribute("position", new THREE.Float32BufferAttribute(padPos, 3));
  pg.setAttribute("normal", new THREE.Float32BufferAttribute(padNor, 3));
  mapGroup.add(new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ color: 0x6dffa0 })));
  const eg = new THREE.BufferGeometry();
  eg.setAttribute("position", new THREE.Float32BufferAttribute(edges, 3));
  mapGroup.add(new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: 0x0a0f18, transparent: true, opacity: 0.55 })));
  scene.add(mapGroup);
}

/* ---------------------------------------------------------------
   Mannequins
   --------------------------------------------------------------- */
const UP = new THREE.Vector3(0, 1, 0);
const cyl = new THREE.CylinderGeometry(1, 1, 1, 8, 1);
const boxG = new THREE.BoxGeometry(1, 1, 1);
const sph = new THREE.SphereGeometry(1, 10, 8);
const bodyMat = new THREE.MeshLambertMaterial({ color: 0xc9cfd9 });
const darkMat = new THREE.MeshLambertMaterial({ color: 0x2a303b });
const LIMBS = [
  ["l_shoulder", "l_elbow", 0.07], ["l_elbow", "l_hand", 0.058], ["r_shoulder", "r_elbow", 0.07], ["r_elbow", "r_hand", 0.058],
  ["l_hip", "l_knee", 0.095], ["l_knee", "l_foot", 0.078], ["r_hip", "r_knee", 0.095], ["r_knee", "r_foot", 0.078],
  ["chest", "neck", 0.06]
];
const figs = new Map();
const xrayMat = new Map();

function makeFigure(a) {
  const g = new THREE.Group();
  const accent = new THREE.MeshLambertMaterial({ color: a.color, emissive: a.color, emissiveIntensity: 0.35 });
  const parts = [];
  const add = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.matrixAutoUpdate = false; g.add(m); parts.push(m); return m; };
  const limbs = LIMBS.map(([p, q, r]) => ({ m: add(cyl, bodyMat), a: BI[p], b: BI[q], r }));
  const torso = add(boxG, bodyMat), belt = add(boxG, accent), head = add(boxG, bodyMat), visor = add(boxG, accent);
  const hands = [add(sph, darkMat), add(sph, darkMat)];
  const feet = [add(boxG, darkMat), add(boxG, darkMat)];
  const pads = [add(boxG, accent), add(boxG, accent)];
  const gun = add(boxG, darkMat);
  // the x-ray copy a hack's highlight() shows through walls
  const xg = new THREE.Group();
  xg.visible = false;
  const xparts = parts.map((p) => { const m = new THREE.Mesh(p.geometry, null); m.matrixAutoUpdate = false; m.renderOrder = 10; xg.add(m); return m; });
  scene.add(g); scene.add(xg);
  const f = { g, accent, limbs, torso, belt, head, visor, hands, feet, pads, gun, parts, xg, xparts, color: a.color, hl: null };
  figs.set(a.id, f);
  return f;
}
function dropFigure(id) {
  const f = figs.get(id);
  if (!f) return;
  scene.remove(f.g); scene.remove(f.xg);
  f.accent.dispose();
  figs.delete(id);
}

const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vD = new THREE.Vector3(), mTmp = new THREE.Matrix4(), qTmp = new THREE.Quaternion(), sTmp = new THREE.Vector3();
const bx = new THREE.Vector3(), by = new THREE.Vector3(), bz = new THREE.Vector3();
function bone(bones, i, v) { return v.set(bones[i * 3], bones[i * 3 + 1], bones[i * 3 + 2]); }
function segment(m, a, b, r) {
  vD.subVectors(b, a);
  const len = vD.length() || 0.001;
  qTmp.setFromUnitVectors(UP, vD.multiplyScalar(1 / len));
  sTmp.set(r, len, r);
  vA.addVectors(a, b).multiplyScalar(0.5);
  m.matrix.compose(vA, qTmp, sTmp);
}
/** A box at `c` whose y axis runs along `yAxis` and whose front faces `fwd`. */
function oriented(m, c, yAxis, fwd, sx, sy, sz) {
  by.copy(yAxis).normalize();
  bz.copy(fwd).addScaledVector(by, -fwd.dot(by)).normalize().negate();
  bx.crossVectors(by, bz);
  mTmp.makeBasis(bx, by, bz);
  mTmp.scale(sTmp.set(sx, sy, sz));
  mTmp.setPosition(c);
  m.matrix.copy(mTmp);
}
const P = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
function poseFigure(f, a) {
  const bn = a.bones;
  for (const L of f.limbs) segment(L.m, bone(bn, L.a, P[0]), bone(bn, L.b, P[1]), L.r);
  const yaw = a.body.yaw, fwd = P[5].set(-Math.sin(yaw), 0, -Math.cos(yaw));
  const chest = bone(bn, BI.chest, P[0]), pelvis = bone(bn, BI.pelvis, P[1]);
  const up = P[2].subVectors(chest, pelvis);
  const mid = P[3].addVectors(chest, pelvis).multiplyScalar(0.5);
  oriented(f.torso, mid, up, fwd, 0.4, up.length() + 0.18, 0.24);
  oriented(f.belt, pelvis, up, fwd, 0.42, 0.08, 0.26);
  const head = bone(bn, BI.head, P[3]);
  const neck = bone(bn, BI.neck, P[4]);
  const hup = P[2].subVectors(head, neck);
  const look = P[4].set(-Math.sin(yaw) * Math.cos(a.body.pitch), Math.sin(a.body.pitch), -Math.cos(yaw) * Math.cos(a.body.pitch));
  oriented(f.head, head, hup, look, 0.25, 0.28, 0.27);
  vA.copy(head).addScaledVector(look, 0.12);
  oriented(f.visor, vA, hup, look, 0.2, 0.07, 0.05);
  for (const [i, side] of [[0, "l"], [1, "r"]]) {
    const h = bone(bn, BI[side + "_hand"], P[0]);
    f.hands[i].matrix.compose(h, qTmp.identity(), sTmp.set(0.06, 0.06, 0.06));
    const ft = bone(bn, BI[side + "_foot"], P[1]);
    vA.copy(ft).addScaledVector(fwd, 0.06); vA.y = Math.max(vA.y, ft.y);
    oriented(f.feet[i], vA, UP, fwd, 0.11, 0.08, 0.26);
    const sh = bone(bn, BI[side + "_shoulder"], P[2]);
    oriented(f.pads[i], sh, up, fwd, 0.14, 0.08, 0.2);
  }
  // what is in the hand, along the aim
  const rh = bone(bn, BI.r_hand, P[0]);
  const g = gunOf(a.arms);
  const long = g ? (g.hold === "pistol" ? 0.22 : g.id === "talon" ? 0.95 : g.id === "mauler" ? 0.7 : 0.6) : a.arms.melee === "lancer" ? 1.7 : 0.95;
  const thick = g ? (g.hold === "pistol" ? 0.05 : 0.07) : 0.025;
  vA.copy(rh).addScaledVector(look, long * 0.4);
  const side = P[1].crossVectors(look, UP).normalize();
  oriented(f.gun, vA, look, side.lengthSq() > 0 ? P[2].crossVectors(side, look) : UP, thick, long, thick * 1.6);
}

function syncFigures(alpha) {
  const seen = new Set();
  const third = S.hackView && S.hackView.thirdPerson;
  for (const a of S.actors) {
    seen.add(a.id);
    let f = figs.get(a.id);
    if (!f) f = makeFigure(a);
    if (f.color !== a.color) { f.accent.color.setHex(a.color); f.accent.emissive.setHex(a.color); f.color = a.color; }
    const mine = a === S.me && !third && !(S.me && !S.me.alive);
    const vis = a.alive && a.heard && !mine;
    f.g.visible = vis;
    if (!vis) { f.xg.visible = false; continue; }
    if (owns(a)) {
      // draw between ticks: shift the tick's bones by how far the body has come
      const p = renderPos(a, alpha);
      const dx = p[0] - a.body.x, dy = p[1] - a.body.y, dz = p[2] - a.body.z;
      f.g.position.set(dx, dy, dz);
    } else f.g.position.set(0, 0, 0);
    poseFigure(f, a);
    for (const m of f.parts) m.matrixWorldNeedsUpdate = true;
    const hl = S.highlights && S.highlights.get(a.id);
    if (hl) {
      let mat = xrayMat.get(hl);
      if (!mat) { mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(hl), transparent: true, opacity: 0.5, depthTest: false, depthWrite: false }); xrayMat.set(hl, mat); }
      f.xg.visible = true;
      f.xg.position.copy(f.g.position);
      f.parts.forEach((p, i) => { f.xparts[i].matrix.copy(p.matrix); f.xparts[i].material = mat; });
    } else f.xg.visible = false;
  }
  for (const id of [...figs.keys()]) if (!seen.has(id)) dropFigure(id);
}

/* ---------------------------------------------------------------
   Your gun
   --------------------------------------------------------------- */
const vm = new THREE.Group();
vm.scale.setScalar(0.72);
vScene.add(vm);
const vmModels = {};
const metal = new THREE.MeshLambertMaterial({ color: 0x3a4250 });
const dark = new THREE.MeshLambertMaterial({ color: 0x1b2029 });
const glove = new THREE.MeshLambertMaterial({ color: 0x2e3542 });
const sleeve = new THREE.MeshLambertMaterial({ color: 0x4b5668 });
const accentVm = new THREE.MeshLambertMaterial({ color: 0x39c6e8, emissive: 0x1a7f99, emissiveIntensity: 0.5 });
const bladeMat = new THREE.MeshLambertMaterial({ color: 0xe6edf5, emissive: 0x88a0b8, emissiveIntensity: 0.25 });
function part(g, mat, sx, sy, sz, x, y, z, rx) {
  const m = new THREE.Mesh(boxG, mat);
  m.scale.set(sx, sy, sz); m.position.set(x, y, z);
  if (rx) m.rotation.x = rx;
  g.add(m);
  return m;
}
function gunModel(id) {
  const g = new THREE.Group();
  const G = GUNS[id];
  // the hand on the grip, and a sleeve running back out of view
  part(g, glove, 0.045, 0.075, 0.065, 0, -0.07, 0.02, -0.3);
  part(g, sleeve, 0.065, 0.065, 0.3, 0.015, -0.1, 0.19);
  if (G.hold === "pistol") {
    const L = id === "brick" ? 0.24 : 0.18;
    part(g, metal, 0.036, 0.05, L, 0, 0, -L / 2 + 0.03);
    part(g, dark, 0.032, 0.095, 0.045, 0, -0.06, 0.012, 0.25);
    part(g, accentVm, 0.037, 0.006, L * 0.7, 0, -0.012, -L / 2 + 0.03);
    part(g, dark, 0.008, 0.012, 0.012, 0, 0.031, -L + 0.05);
    if (id === "brick") part(g, metal, 0.052, 0.052, 0.06, 0, -0.004, -0.03);
    g.userData.muzzle = new THREE.Vector3(0, 0.005, -L + 0.02);
  } else {
    const L = id === "talon" ? 0.72 : id === "mauler" ? 0.54 : id === "hornet" ? 0.36 : 0.5;
    part(g, metal, 0.042, 0.06, L * 0.62, 0, 0, -L * 0.25);                  // receiver
    part(g, dark, 0.022, 0.022, L * 0.45, 0, 0.008, -L * 0.72);               // barrel
    part(g, accentVm, 0.043, 0.006, L * 0.5, 0, -0.016, -L * 0.25);           // a stripe down the side
    part(g, dark, 0.036, 0.1, 0.045, 0, -0.07, 0.02, 0.2);                   // grip
    part(g, dark, 0.034, 0.07, 0.14, 0, -0.005, 0.12);                        // stock
    part(g, glove, 0.045, 0.06, 0.07, -0.028, -0.045, -L * 0.42);             // the other hand
    part(g, sleeve, 0.06, 0.06, 0.32, -0.06, -0.09, -L * 0.1);
    if (id === "talon") { part(g, dark, 0.04, 0.04, 0.24, 0, 0.058, -0.14); part(g, accentVm, 0.042, 0.042, 0.01, 0, 0.058, -0.02); }
    else part(g, dark, 0.012, 0.022, 0.03, 0, 0.04, -L * 0.05);               // a rear sight
    if (id === "mauler") part(g, dark, 0.05, 0.04, 0.18, 0, -0.035, -L * 0.62);
    if (id === "hornet") part(g, dark, 0.026, 0.13, 0.036, 0, -0.1, -0.07);
    if (id === "kestrel") part(g, dark, 0.03, 0.12, 0.05, 0, -0.09, -0.1, 0.25);
    g.userData.muzzle = new THREE.Vector3(0, 0.008, -L * 0.95);
  }
  return g;
}
function meleeModel(id) {
  const g = new THREE.Group();
  part(g, glove, 0.05, 0.08, 0.07, 0, -0.07, 0.02, -0.3);
  part(g, sleeve, 0.07, 0.07, 0.3, 0.02, -0.1, 0.2);
  if (id === "katana") {
    part(g, dark, 0.03, 0.03, 0.2, 0, -0.03, 0.02);
    part(g, accentVm, 0.08, 0.012, 0.03, 0, -0.03, -0.09);
    part(g, bladeMat, 0.012, 0.035, 0.7, 0, -0.02, -0.45);
  } else {
    part(g, dark, 0.03, 0.03, 0.9, 0, -0.03, -0.2);
    part(g, accentVm, 0.05, 0.05, 0.05, 0, -0.03, -0.66);
    part(g, bladeMat, 0.02, 0.06, 0.28, 0, -0.03, -0.82);
  }
  g.userData.muzzle = new THREE.Vector3(0, 0, -0.6);
  return g;
}
function vmModel(key) {
  if (!vmModels[key]) {
    const m = GUNS[key] ? gunModel(key) : meleeModel(key);
    m.visible = false;
    vm.add(m);
    vmModels[key] = m;
  }
  return vmModels[key];
}
const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.12), new THREE.MeshBasicMaterial({ color: 0xffe6a0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
vScene.add(flash);
const V = { bob: 0, kick: 0, kickR: 0, swayX: 0, swayY: 0, lastYaw: 0, lastPitch: 0, flashT: 0, swing: 0, reload: 0, swapT: 0, key: "" };
export function vmFire(a, e) { V.kick = Math.min(1, V.kick + (GUNS[e.gun].id === "talon" || GUNS[e.gun].id === "brick" || GUNS[e.gun].id === "mauler" ? 1 : 0.45)); V.flashT = 0.05; }
export function vmSwing() { V.swing = 1; }

function updateViewmodel(dt) {
  const a = S.me;
  const third = S.hackView && S.hackView.thirdPerson;
  if (!a || !a.alive || third) { vm.visible = false; flash.material.opacity = 0; return; }
  vm.visible = true;
  const A = a.arms, g = gunOf(A);
  const key = g ? g.id : A.melee;
  if (key !== V.key) { for (const k in vmModels) vmModels[k].visible = false; V.key = key; V.swapT = 1; }
  const model = vmModel(key);
  model.visible = true;
  const body = a.body;
  const hs = Math.hypot(body.vx, body.vz);
  V.bob += dt * (body.onGround ? hs * 1.35 : 0);
  const bobAmt = body.onGround && !body.sliding ? Math.min(1, hs / 7) : 0;
  // sway follows how fast you turn (radians a second), not how far you turned this frame
  const inv = dt > 0 ? 1 / dt : 0;
  const dy = wrapAngle(S.view.yaw - V.lastYaw) * inv, dp = (S.view.pitch - V.lastPitch) * inv;
  V.lastYaw = S.view.yaw; V.lastPitch = S.view.pitch;
  V.swayX = damp(V.swayX, clamp(dy * 0.022, -0.06, 0.06), 10, dt);
  V.swayY = damp(V.swayY, clamp(-dp * 0.022, -0.06, 0.06), 10, dt);
  V.kick = damp(V.kick, 0, 14, dt);
  V.swing = Math.max(0, V.swing - dt * 3.2);
  V.swapT = Math.max(0, V.swapT - dt * 4);
  const ads = A.ads;
  const hip = g ? (g.hold === "pistol" ? [0.15, -0.14, -0.34] : [0.17, -0.155, -0.32]) : [0.19, -0.18, -0.36];
  const aim = g ? (g.hold === "pistol" ? [0, -0.066, -0.3] : [0, -0.058, -0.26]) : hip;
  let x = hip[0] + (aim[0] - hip[0]) * ads, y = hip[1] + (aim[1] - hip[1]) * ads, z = hip[2] + (aim[2] - hip[2]) * ads;
  const b = (1 - ads * 0.85) * bobAmt;
  x += Math.sin(V.bob) * 0.012 * b - V.swayX * (1 - ads);
  y += Math.abs(Math.cos(V.bob)) * 0.01 * b - V.swayY * (1 - ads) - V.swapT * 0.25;
  z += V.kick * 0.06;
  if (A.reloadT > 0) y -= 0.12 * Math.sin(Math.min(1, (g ? 1 - A.reloadT / g.reload : 0)) * Math.PI);
  if (body.sprinting) { x += 0.04; y -= 0.03; }
  vm.position.set(x, y, z);
  let rx = V.kick * 0.18 * (1 - ads * 0.6), ry = 0, rz = body.sprinting ? 0.35 : 0;
  if (!g) {
    // blades: a swing sweeps across; a charge draws back; a lunge thrusts
    const s = V.swing > 0 ? Math.sin((1 - V.swing) * Math.PI) : 0;
    ry = s * 1.4 - 0.2; rz += -s * 0.8;
    if (body.lunge === LUNGE.CHARGE) { vm.position.z += 0.08 + 0.1 * body.lungeCharge; rx -= 0.3 * body.lungeCharge; vm.position.x += 0.03; }
    if (body.lunge === LUNGE.DASH) { vm.position.z -= 0.18; rx = -0.1; }
  }
  vm.rotation.set(rx, ry, rz);
  V.flashT -= dt;
  if (V.flashT > 0 && model.userData.muzzle) {
    flash.position.copy(model.userData.muzzle).applyMatrix4(model.matrixWorld);
    flash.rotation.z = Math.random() * 3;
    flash.material.opacity = 0.9;
    flash.scale.setScalar(g && g.id === "talon" ? 2.2 : 1 + Math.random() * 0.5);
  } else flash.material.opacity = 0;
}

/* ---------------------------------------------------------------
   Tracers, sparks, rounds in flight
   --------------------------------------------------------------- */
const TRACERS = [];
const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffd98a, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
for (let i = 0; i < 40; i++) { const m = new THREE.Mesh(cyl, tracerMat.clone()); m.visible = false; m.matrixAutoUpdate = false; scene.add(m); TRACERS.push({ m, t: 0 }); }
let tracerI = 0;
export function tracer(from, to, color) {
  const T = TRACERS[tracerI++ % TRACERS.length];
  segment(T.m, vA.set(from[0], from[1], from[2]), vB.set(to[0], to[1], to[2]), 0.012);
  T.m.material.color.setHex(color || 0xffd98a);
  T.m.visible = true; T.t = 0.09;
}
const SPARKS = 320;
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
function updateEffects(dt) {
  for (const T of TRACERS) if (T.m.visible) { T.t -= dt; T.m.material.opacity = Math.max(0, T.t / 0.09) * 0.8; if (T.t <= 0) T.m.visible = false; }
  for (let i = 0; i < SPARKS; i++) {
    if (sparkLife[i] <= 0) { sparkPos[i * 3 + 1] = -999; continue; }
    sparkLife[i] -= dt;
    sparkVel[i * 3 + 1] -= 12 * dt;
    sparkPos[i * 3] += sparkVel[i * 3] * dt; sparkPos[i * 3 + 1] += sparkVel[i * 3 + 1] * dt; sparkPos[i * 3 + 2] += sparkVel[i * 3 + 2] * dt;
  }
  sparkGeo.attributes.position.needsUpdate = true;
  sparkGeo.attributes.color.needsUpdate = true;
}
const rounds = [];
const roundMat = new THREE.MeshBasicMaterial({ color: 0xfff1c0 });
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
const cam = { punch: 0, dip: 0, roll: 0, fovAdd: 0 };
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
  camera.fov = vfov((base + cam.fovAdd) / zoom);
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
  const w = window.innerWidth, h = window.innerHeight;
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
export function frame(alpha, dt) {
  watchFrameRate(dt);
  if (!mapGroup) buildArena();
  placeCamera(alpha, dt);
  syncFigures(alpha);
  updateViewmodel(dt);
  updateEffects(dt);
  updateRounds();
  renderer.clear();
  renderer.render(scene, camera);
  if (vm.visible) {
    renderer.clearDepth();
    vCam.fov = 58 / Math.max(1, (S.cam.zoom || 1) * 0.35 + 0.65);
    vCam.updateProjectionMatrix();
    const g = S.me && gunOf(S.me.arms);
    const scoped = g && g.id === "talon" && S.me.arms.ads > 0.9;
    if (!scoped) renderer.render(vScene, vCam);
  }
}
/** Title screen: a slow orbit over the arena. */
export function idle(t, dt) {
  if (!mapGroup) buildArena();
  const r = 70;
  camera.position.set(Math.sin(t * 0.05) * r, 34, Math.cos(t * 0.05) * r);
  camera.rotation.set(-0.42, t * 0.05, 0);
  camera.fov = vfov(90); camera.updateProjectionMatrix();
  for (const f of figs.values()) { f.g.visible = false; f.xg.visible = false; }
  vm.visible = false;
  updateEffects(dt);
  renderer.clear();
  renderer.render(scene, camera);
}
