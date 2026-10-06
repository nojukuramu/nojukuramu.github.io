/* figures.js — everybody else's body, as you see it.
 *
 * Each player is the CC0 body from models.js, posed every frame by rig.js
 * from the seventeen bones skeleton.js computed — the same points the
 * hitboxes and the hack API use, so a head you can see is a head you can
 * hit. Their shirt is their colour, a band of light across the eyes is too,
 * and the gun or blade in their hand is the one they are holding.
 *
 * Until the models have loaded (or if they never do) a player is the
 * mannequin this game always drew: limbs as cylinders stretched between two
 * bones. Both kinds carry an x-ray copy that a hack's highlight() shows
 * through walls. */

import * as THREE from "three";
import { S, on } from "./state.js";
import { BI } from "./skeleton.js";
import { owns, renderPos } from "./game.js";
import { GUNS, gunOf } from "./weapons.js";
import { LUNGE } from "./movement.js";
import { humanCopy, gunCopy, paint, hasHuman, onModels } from "./models.js";
import { makeRig, poseRig, rigPoint } from "./rig.js";

let scene = null, shadows = false, cheap = false;
const figs = new Map();
const xrayMat = new Map();
const DIE_T = 1.6;

export function initFigures(sc) {
  scene = sc;
  // the models arrive after the first match may have started: rebuild everyone as a body
  onModels(() => { for (const id of [...figs.keys()]) dropFigure(id); });
  on("hit", (a, b) => { const f = b && figs.get(b.id); if (f) f.flash = 0.16; });
  on("fired", (a) => { const f = figs.get(a.id); if (f) f.muzzleT = 0.06; });
}
/* A flash at the muzzle of whatever somebody is holding, the frame they fire. */
const flashTex = (() => {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, "rgba(255,250,230,1)"); r.addColorStop(0.3, "rgba(255,200,110,0.85)"); r.addColorStop(1, "rgba(255,140,40,0)");
  g.fillStyle = r; g.beginPath();
  for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2, rr = i % 2 ? 13 : 32; g.lineTo(32 + Math.cos(a) * rr, 32 + Math.sin(a) * rr); }
  g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
const flashMat = new THREE.SpriteMaterial({ map: flashTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
function muzzleFlash(f, dt) {
  const H = f.held;
  if (!f.flashSprite) { f.flashSprite = new THREE.Sprite(flashMat); f.flashSprite.visible = false; }
  f.muzzleT = Math.max(0, (f.muzzleT || 0) - dt);
  const on = f.muzzleT > 0 && H && H.obj && !!GUNS[H.key];
  if (on && f.flashSprite.parent !== H.obj) H.obj.add(f.flashSprite);
  f.flashSprite.visible = !!on;
  if (on) { f.flashSprite.position.copy(H.t.muzzle); f.flashSprite.scale.setScalar(0.32 + Math.random() * 0.18); f.flashSprite.material.rotation = Math.random() * 6.28; }
}
const mzTmp = new THREE.Vector3();
/** Where somebody's muzzle is in the world, if their body is drawn with a gun in its hand. */
export function muzzleOf(id, out) {
  const f = figs.get(id);
  if (!f || f.kind !== "human" || !f.g.visible || !f.held.obj || !GUNS[f.held.key]) return null;
  f.held.obj.updateWorldMatrix(true, false);
  return out.copy(f.held.t.muzzle).applyMatrix4(f.held.obj.matrixWorld);
}
/** Shadows on or off; and on the low tier, bodies lit the cheap way (rebuilt, since the material changes). */
export function figureQuality(on, low) {
  shadows = on;
  if (low !== cheap) { cheap = low; for (const id of [...figs.keys()]) dropFigure(id); return; }
  for (const f of figs.values()) f.g.traverse((o) => { if (o.isMesh && !o.userData.xray && !o.userData.glow) o.castShadow = on; });
}
function xray(hl) {
  let mat = xrayMat.get(hl);
  if (!mat) { mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(hl), transparent: true, opacity: 0.5, depthTest: false, depthWrite: false }); xrayMat.set(hl, mat); }
  return mat;
}

/* ---------------------------------------------------------------
   The body
   --------------------------------------------------------------- */
const visorGeo = new THREE.BoxGeometry(1, 1, 1);
function makeHuman(a) {
  const c = humanCopy();
  const rig = makeRig(c);
  const mat = cheap ? new THREE.MeshLambertMaterial({ map: paint(a.color, a.id) }) : new THREE.MeshStandardMaterial({ map: paint(a.color, a.id), roughness: 0.78, metalness: 0.04 });
  c.mesh.material = mat;
  c.mesh.castShadow = shadows;
  // a band of light across the eyes, in the player's colour: it reads at any distance
  const visorMat = new THREE.MeshStandardMaterial({ color: 0x0c1016, emissive: a.color, emissiveIntensity: 2.2, roughness: 0.25, metalness: 0.3 });
  const visor = new THREE.Mesh(visorGeo, visorMat);
  const B = rig.bind;
  const headInv = B.wq.Head.clone().invert();
  visor.position.set(0, 1.685, -0.085).sub(B.wp.Head).applyQuaternion(headInv);
  visor.quaternion.copy(headInv);
  visor.scale.set(0.17, 0.042, 0.05);
  visor.castShadow = false; visor.userData.glow = true;
  c.bones.Head.add(visor);
  // the x-ray copy: the same skin, on the same skeleton, drawn over everything
  const xm = new THREE.SkinnedMesh(c.mesh.geometry, xray("#ffffff"));
  xm.bind(c.mesh.skeleton, c.mesh.bindMatrix);
  xm.position.copy(c.mesh.position); xm.quaternion.copy(c.mesh.quaternion); xm.scale.copy(c.mesh.scale);
  xm.frustumCulled = false; xm.renderOrder = 10; xm.visible = false; xm.userData.xray = true;
  c.mesh.parent.add(xm);
  const g = new THREE.Group();
  g.add(c.root);
  scene.add(g);
  return { kind: "human", g, rig, mat, visorMat, xm, color: a.color, seed: a.id, held: { key: "", obj: null, t: null }, flash: 0, dieT: -1, wasAlive: a.alive };
}

/* Pose targets in the body's frame, made from the game's bones. */
const T = { pelvis: new THREE.Vector3(), spine: new THREE.Vector3(), chest: new THREE.Vector3(), neck: new THREE.Vector3(), head: new THREE.Vector3(),
  lHand: new THREE.Vector3(), rHand: new THREE.Vector3(), lElbow: new THREE.Vector3(), rElbow: new THREE.Vector3(),
  lFoot: new THREE.Vector3(), rFoot: new THREE.Vector3(), lKnee: new THREE.Vector3(), rKnee: new THREE.Vector3(), pitch: 0 };
const gq = new THREE.Quaternion(), gp = new THREE.Vector3(), tmp = new THREE.Vector3(), X = new THREE.Vector3(1, 0, 0);
function localBone(a, i, out) {
  const bn = a.bones, b = a.body, cy = Math.cos(b.yaw), sy = Math.sin(b.yaw);
  const dx = bn[i * 3] - b.x, dz = bn[i * 3 + 2] - b.z;
  return out.set(dx * cy - dz * sy, bn[i * 3 + 1] - b.y, dx * sy + dz * cy);
}
/* Where a wrist sits relative to the point the hand closes on, in the held thing's own frame. */
const GRIP_WRIST = new THREE.Vector3(0, -0.04, 0.075), SUPPORT_WRIST = new THREE.Vector3(-0.03, -0.055, 0.045);
function holdFor(f, a) {
  const A = a.arms, g = gunOf(A);
  // the grapple has no model of its own: an empty hand, held out like a pistol (holdOf)
  const key = g ? g.id : A.cur === 3 ? "grapple" : A.melee;
  const H = f.held;
  if (H.key !== key) {
    if (H.obj) H.obj.removeFromParent();
    const c = gunCopy(key);
    H.key = key; H.obj = c ? c.obj : null; H.t = c ? c.t : null;
    if (H.obj) { H.obj.traverse((o) => { if (o.isMesh) o.castShadow = shadows; }); f.g.children[0].add(H.obj); }
  }
  return g;
}
function poseHuman(f, a) {
  for (const [k, n] of [["pelvis", "pelvis"], ["spine", "spine"], ["chest", "chest"], ["neck", "neck"], ["head", "head"], ["lElbow", "l_elbow"], ["rElbow", "r_elbow"],
    ["lFoot", "l_foot"], ["rFoot", "r_foot"], ["lKnee", "l_knee"], ["rKnee", "r_knee"], ["lHand", "l_hand"], ["rHand", "r_hand"]]) localBone(a, BI[n], T[k]);
  const pitch = a.body.pitch || 0;
  T.pitch = pitch;
  const g = holdFor(f, a);
  const H = f.held, body = a.body;
  if (H.obj) {
    // the gun lies along the aim with its grip in the right hand; a blade is held up, or swung
    let tilt = 0;
    if (!g) {
      const sw = a.arms.swingT > 0 ? Math.sin((1 - a.arms.swingT / 0.25) * Math.PI) : 0;
      tilt = a.arms.melee === "lancer" ? -0.15 : 0.95 - sw * 1.6;
      if (body.lunge === LUNGE.DASH) tilt = 0;
      if (body.lunge === LUNGE.CHARGE) tilt = 0.4;
    }
    gq.setFromAxisAngle(X, pitch + tilt);
    gp.copy(T.rHand);
    if (body.climbing) { gq.setFromAxisAngle(X, -1.2); }
    H.obj.position.copy(gp); H.obj.quaternion.copy(gq);
    T.rHand.copy(GRIP_WRIST).applyQuaternion(gq).add(gp);
    if (H.t.support && !body.climbing) T.lHand.copy(H.t.support).add(SUPPORT_WRIST).applyQuaternion(gq).add(gp);
    H.obj.visible = true;
  }
  poseRig(f.rig, T);
  // a standing body's legs are a few centimetres shorter than the game's: let it settle onto its feet
  const lf = rigPoint(f.rig, "LeftFoot"), rf = rigPoint(f.rig, "RightFoot");
  const drop = Math.max(0, Math.min(lf.y - T.lFoot.y, rf.y - T.rFoot.y));
  f.g.children[0].position.y = a.body.y - Math.min(0.06, drop);
}

/* ---------------------------------------------------------------
   The mannequin, for before the models arrive
   --------------------------------------------------------------- */
const UP = new THREE.Vector3(0, 1, 0);
const cyl = new THREE.CylinderGeometry(1, 1, 1, 8, 1);
const boxG = new THREE.BoxGeometry(1, 1, 1);
const sph = new THREE.SphereGeometry(1, 10, 8);
const bodyMat = new THREE.MeshStandardMaterial({ color: 0xc9cfd9, roughness: 0.7 });
const darkMat = new THREE.MeshStandardMaterial({ color: 0x2a303b, roughness: 0.6 });
const LIMBS = [
  ["l_shoulder", "l_elbow", 0.07], ["l_elbow", "l_hand", 0.058], ["r_shoulder", "r_elbow", 0.07], ["r_elbow", "r_hand", 0.058],
  ["l_hip", "l_knee", 0.095], ["l_knee", "l_foot", 0.078], ["r_hip", "r_knee", 0.095], ["r_knee", "r_foot", 0.078],
  ["chest", "neck", 0.06]
];
function makeMannequin(a) {
  const g = new THREE.Group();
  const accent = new THREE.MeshStandardMaterial({ color: a.color, emissive: a.color, emissiveIntensity: 0.35, roughness: 0.6 });
  const parts = [];
  const add = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.matrixAutoUpdate = false; m.castShadow = shadows; g.add(m); parts.push(m); return m; };
  const limbs = LIMBS.map(([p, q, r]) => ({ m: add(cyl, bodyMat), a: BI[p], b: BI[q], r }));
  const torso = add(boxG, bodyMat), belt = add(boxG, accent), head = add(boxG, bodyMat), visor = add(boxG, accent);
  const hands = [add(sph, darkMat), add(sph, darkMat)];
  const feet = [add(boxG, darkMat), add(boxG, darkMat)];
  const pads = [add(boxG, accent), add(boxG, accent)];
  const gun = add(boxG, darkMat);
  const xg = new THREE.Group();
  xg.visible = false;
  const xparts = parts.map((p) => { const m = new THREE.Mesh(p.geometry, null); m.matrixAutoUpdate = false; m.renderOrder = 10; m.userData.xray = true; xg.add(m); return m; });
  scene.add(g); scene.add(xg);
  return { kind: "box", g, accent, limbs, torso, belt, head, visor, hands, feet, pads, gun, parts, xg, xparts, color: a.color, flash: 0, dieT: -1, wasAlive: a.alive };
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
function poseMannequin(f, a) {
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
  const rh = bone(bn, BI.r_hand, P[0]);
  const g = gunOf(a.arms);
  const grapple = a.arms.cur === 3;
  const long = g ? (g.hold === "pistol" ? 0.22 : g.id === "talon" ? 0.95 : g.id === "mauler" ? 0.7 : 0.6) : grapple ? 0.26 : a.arms.melee === "lancer" ? 1.7 : 0.95;
  const thick = g ? (g.hold === "pistol" ? 0.05 : 0.07) : grapple ? 0.06 : 0.025;
  vA.copy(rh).addScaledVector(look, long * 0.4);
  const side = P[1].crossVectors(look, UP).normalize();
  oriented(f.gun, vA, look, side.lengthSq() > 0 ? P[2].crossVectors(side, look) : UP, thick, long, thick * 1.6);
}

/* ---------------------------------------------------------------
   Every frame
   --------------------------------------------------------------- */
function makeFigure(a) { const f = hasHuman() ? makeHuman(a) : makeMannequin(a); figs.set(a.id, f); return f; }
function dropFigure(id) {
  const f = figs.get(id);
  if (!f) return;
  f.g.removeFromParent();
  if (f.xg) f.xg.removeFromParent();
  if (f.kind === "box") f.accent.dispose();
  else { f.mat.map.dispose(); f.mat.dispose(); f.visorMat.dispose(); }
  figs.delete(id);
}
function setColor(f, c) {
  f.color = c;
  if (f.kind === "box") { f.accent.color.setHex(c); f.accent.emissive.setHex(c); return; }
  f.mat.map.dispose();
  f.mat.map = paint(c, f.seed);
  f.visorMat.emissive.setHex(c);
}

export function syncFigures(alpha, dt) {
  const seen = new Set();
  const third = S.hackView && S.hackView.thirdPerson;
  for (const a of S.actors) {
    seen.add(a.id);
    let f = figs.get(a.id);
    if (!f) f = makeFigure(a);
    if (f.color !== a.color) setColor(f, a.color);
    const mine = a === S.me && !third && !(S.me && !S.me.alive);
    // a death leaves the body for a moment, falling, before it goes
    if (f.wasAlive && !a.alive) f.dieT = 0;
    if (a.alive) f.dieT = -1;
    f.wasAlive = a.alive;
    const dying = !a.alive && f.dieT >= 0 && f.dieT < DIE_T && a !== S.me;
    const vis = (a.alive || dying) && a.heard && !mine;
    f.g.visible = vis;
    if (!vis) { if (f.xg) f.xg.visible = false; if (f.xm) f.xm.visible = false; continue; }
    if (owns(a) && a.alive) {
      const p = renderPos(a, alpha);
      f.g.position.set(p[0] - a.body.x, p[1] - a.body.y, p[2] - a.body.z);
    } else if (a.alive) f.g.position.set(0, 0, 0);
    if (f.kind === "human") {
      if (a.alive) {
        f.g.children[0].position.set(a.body.x, a.body.y, a.body.z);
        f.g.children[0].rotation.set(0, a.body.yaw, 0, "YXZ");
        poseHuman(f, a);
      } else {
        // fall back, from the feet, and sink once down
        f.dieT += dt;
        const k = Math.min(1, f.dieT / 0.45);
        f.g.children[0].rotation.x = Math.PI / 2 * 0.92 * k * k;
        f.g.children[0].position.y = a.body.y - Math.max(0, f.dieT - 1.0) * 0.6;
      }
      muzzleFlash(f, dt);
      f.flash = Math.max(0, f.flash - dt);
      f.mat.emissive.setRGB(1, 0.25, 0.2);
      f.mat.emissiveIntensity = f.flash > 0 ? f.flash * 7 : 0;
      const hl = S.highlights && S.highlights.get(a.id);
      f.xm.visible = !!hl && a.alive;
      if (hl) f.xm.material = xray(hl);
    } else {
      if (!a.alive) { f.g.visible = false; continue; }
      poseMannequin(f, a);
      for (const m of f.parts) m.matrixWorldNeedsUpdate = true;
      const hl = S.highlights && S.highlights.get(a.id);
      if (hl) {
        f.xg.visible = true;
        f.xg.position.copy(f.g.position);
        f.parts.forEach((p, i) => { f.xparts[i].matrix.copy(p.matrix); f.xparts[i].material = xray(hl); });
      } else f.xg.visible = false;
    }
  }
  for (const id of [...figs.keys()]) if (!seen.has(id)) dropFigure(id);
}
export function hideFigures() { for (const f of figs.values()) { f.g.visible = false; if (f.xg) f.xg.visible = false; } }
export const figureCount = () => figs.size;
export const figureKinds = () => [...figs.values()].map((f) => f.kind);
/** One player's figure, for tools/e2e.js to check a body stands where its bones are. */
export const figureOf = (id) => figs.get(id) || null;
