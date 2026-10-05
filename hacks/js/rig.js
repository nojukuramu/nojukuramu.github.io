/* rig.js — the skinned body, posed from the game's seventeen bones.
 *
 * skeleton.js decides where every joint of a player is; this makes the body
 * model (models.js) stand in that pose, so what you see stays what the
 * hitboxes are. It is retargeting by direction: each model bone is first
 * carried along by its parent, then turned the least it can so that it points
 * where the game's bone points. Carrying first is what keeps a forearm from
 * twisting like a candy wrapper when the arm swings round.
 *
 * Arms and legs are solved again with the model's own lengths (the same
 * two-bone solve skeleton.js uses), aimed at the game's hands and feet, so a
 * hand closes on the grip even though the model's arm is a few centimetres
 * longer than the game's. The head looks where the player aims.
 *
 * Every position here is in the body's own frame: metres, feet on y = 0,
 * facing -z. figures.js and viewmodel.js convert into it. */

import * as THREE from "three";

const DRIVEN = ["Hips", "Spine", "Spine1", "Spine2", "Neck", "Head",
  "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand", "RightShoulder", "RightArm", "RightForeArm", "RightHand",
  "LeftUpLeg", "LeftLeg", "LeftFoot", "RightUpLeg", "RightLeg", "RightFoot"];
const CHILD = { Spine: "Spine1", Spine1: "Spine2", Spine2: "Neck", Neck: "Head", LeftArm: "LeftForeArm", LeftForeArm: "LeftHand", RightArm: "RightForeArm", RightForeArm: "RightHand",
  LeftUpLeg: "LeftLeg", LeftLeg: "LeftFoot", RightUpLeg: "RightLeg", RightLeg: "RightFoot" };

/* What the bind pose says, worked out once per template and shared by every copy. */
const BIND = new WeakMap();
function bindOf(rig) {
  const key = rig.mesh.geometry;
  let B = BIND.get(key);
  if (B) return B;
  rig.root.updateMatrixWorld(true);
  const rootInv = new THREE.Matrix4().copy(rig.root.matrixWorld).invert();
  const wq = {}, wp = {}, lq = {}, lp = {}, rest = {};
  const m = new THREE.Matrix4(), s = new THREE.Vector3();
  for (const n of DRIVEN) {
    const b = rig.b[n];
    m.multiplyMatrices(rootInv, b.matrixWorld);
    wp[n] = new THREE.Vector3(); wq[n] = new THREE.Quaternion();
    m.decompose(wp[n], wq[n], s);
    lq[n] = b.quaternion.clone(); lp[n] = b.position.clone();
  }
  for (const n in CHILD) rest[n] = wp[CHILD[n]].clone().sub(wp[n]).normalize().applyQuaternion(wq[n].clone().invert());
  const len = (a, b) => wp[a].distanceTo(wp[b]);
  // the Hips' parent, should the file ever carry a transform above the skeleton
  const hp = new THREE.Matrix4().multiplyMatrices(rootInv, rig.b.Hips.parent.matrixWorld).invert();
  const hpq = new THREE.Quaternion(); hp.decompose(new THREE.Vector3(), hpq, new THREE.Vector3());
  B = { wq, wp, lq, lp, rest, hipsParentInv: hp, hipsParentInvQ: hpq,
    upperArm: len("LeftArm", "LeftForeArm"), foreArm: len("LeftForeArm", "LeftHand"),
    thigh: len("LeftUpLeg", "LeftLeg"), shin: len("LeftLeg", "LeftFoot"),
    hips: wp.Hips.y };
  BIND.set(key, B);
  return B;
}

export function makeRig(copy) {
  const rig = { root: copy.root, mesh: copy.mesh, b: copy.bones };
  rig.bind = bindOf(rig);
  rig.W = {}; rig.P = {};
  for (const n of DRIVEN) { rig.W[n] = new THREE.Quaternion(); rig.P[n] = new THREE.Vector3(); }
  return rig;
}

/* ---------------------------------------------------------------
   Posing
   --------------------------------------------------------------- */
const qA = new THREE.Quaternion(), qB = new THREE.Quaternion(), qC = new THREE.Quaternion();
const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3(), vD = new THREE.Vector3();
const mB = new THREE.Matrix4();
const X = new THREE.Vector3(1, 0, 0);

/** Carry `n` along with its parent, then turn it to point along `dir` (if given). */
function link(rig, n, parent, dir) {
  const B = rig.bind, W = rig.W, P = rig.P;
  P[n].copy(B.lp[n]).applyQuaternion(W[parent]).add(P[parent]);
  W[n].multiplyQuaternions(W[parent], B.lq[n]);
  if (dir && B.rest[n] && dir.lengthSq() > 1e-10) {
    vC.copy(B.rest[n]).applyQuaternion(W[n]);
    qA.setFromUnitVectors(vC, vD.copy(dir).normalize());
    W[n].premultiply(qA);
  }
}

/** Where the middle joint of a two-bone limb goes: towards `hint`, as skeleton.js bends it. */
function elbow(root, target, l1, l2, hint, out) {
  const d = vA.subVectors(target, root);
  let dl = d.length();
  if (dl > l1 + l2 - 0.001) { d.multiplyScalar((l1 + l2 - 0.001) / dl); dl = l1 + l2 - 0.001; }
  if (dl < 0.02) return out.copy(root).addScaledVector(hint, l1);
  const ax = d.multiplyScalar(1 / dl);
  const a = (l1 * l1 - l2 * l2 + dl * dl) / (2 * dl);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const bend = vB.copy(hint).addScaledVector(ax, -hint.dot(ax));
  if (bend.lengthSq() < 1e-8) bend.set(0, -1, 0);
  bend.normalize();
  return out.copy(root).addScaledVector(ax, a).addScaledVector(bend, h);
}

const E = new THREE.Vector3(), T2 = new THREE.Vector3(), H = new THREE.Vector3();
function limb(rig, side, upper, lower, end, parent, target, hint, l1, l2) {
  link(rig, side + upper, parent, null);
  const root = rig.P[side + upper];
  // the bend: away from the line, towards the hint point
  H.copy(hint).sub(root);
  elbow(root, target, l1, l2, H, E);
  link(rig, side + upper, parent, T2.subVectors(E, root));
  // where the middle joint now is has to be known before the lower bone can be aimed from it
  link(rig, side + lower, side + upper, null);
  link(rig, side + lower, side + upper, T2.subVectors(target, rig.P[side + lower]));
  link(rig, side + end, side + lower, null);
}

/**
 * Pose the body. `t` holds positions in the body's frame — pelvis, spine,
 * chest, neck, head, lHand, rHand, lElbow, rElbow, lFoot, rFoot, lKnee, rKnee
 * (THREE.Vector3) — and pitch, where the head looks. Feet may be left out
 * (the legs then stand as they were bound).
 */
export function poseRig(rig, t) {
  const B = rig.bind, W = rig.W, P = rig.P;
  // the hips: up along the spine, facing forward
  P.Hips.copy(t.pelvis);
  const up = vA.subVectors(t.spine, t.pelvis).normalize();
  const right = vB.crossVectors(up, vC.set(0, 0, 1)).normalize();
  const back = vC.crossVectors(right, up);
  mB.makeBasis(right, up, back);
  W.Hips.setFromRotationMatrix(mB).multiply(B.wq.Hips);
  link(rig, "Spine", "Hips", vD.subVectors(t.chest, t.spine));
  link(rig, "Spine1", "Spine", vD.subVectors(t.chest, t.spine));
  link(rig, "Spine2", "Spine1", vD.subVectors(t.neck, t.chest));
  link(rig, "Neck", "Spine2", vD.subVectors(t.head, t.neck));
  // the head looks where the aim is, whatever the torso is doing
  link(rig, "Head", "Neck", null);
  W.Head.copy(qB.setFromAxisAngle(X, (t.pitch || 0) * 0.85)).multiply(B.wq.Head);
  // arms, from the collarbones
  link(rig, "LeftShoulder", "Spine2", null);
  link(rig, "RightShoulder", "Spine2", null);
  limb(rig, "Left", "Arm", "ForeArm", "Hand", "LeftShoulder", t.lHand, t.lElbow, B.upperArm, B.foreArm);
  limb(rig, "Right", "Arm", "ForeArm", "Hand", "RightShoulder", t.rHand, t.rElbow, B.upperArm, B.foreArm);
  // legs, and feet kept flat and facing forward
  if (t.lFoot) {
    limb(rig, "Left", "UpLeg", "Leg", "Foot", "Hips", t.lFoot, t.lKnee, B.thigh, B.shin);
    limb(rig, "Right", "UpLeg", "Leg", "Foot", "Hips", t.rFoot, t.rKnee, B.thigh, B.shin);
    W.LeftFoot.copy(B.wq.LeftFoot); W.RightFoot.copy(B.wq.RightFoot);
  } else {
    for (const s of ["Left", "Right"]) { link(rig, s + "UpLeg", "Hips", null); link(rig, s + "Leg", s + "UpLeg", null); link(rig, s + "Foot", s + "Leg", null); }
  }
  // world rotations back to each bone's own
  const b = rig.b;
  b.Hips.position.copy(P.Hips).applyMatrix4(B.hipsParentInv);
  b.Hips.quaternion.copy(W.Hips).premultiply(B.hipsParentInvQ);
  for (const n of DRIVEN) {
    if (n === "Hips") continue;
    const parent = b[n].parent;
    const pq = W[parent.name];
    if (!pq) continue;
    b[n].quaternion.copy(qC.copy(pq).invert().multiply(W[n]));
  }
}

/** Where the posed model's bone is, in the body's frame. */
export const rigPoint = (rig, n) => rig.P[n];
export const rigTurn = (rig, n) => rig.W[n];
