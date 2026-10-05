/* viewmodel.js — your own gun and arms, drawn over the world.
 *
 * They are a second scene with their own camera, drawn after the world with
 * the depth cleared, so a gun never sinks into a wall. That camera is at the
 * eye looking straight ahead, which is what makes aiming down the sights
 * exact: every model's sight line is level (models.js), so putting the sight
 * on this camera's axis puts it in the middle of the screen — where the
 * world camera's axis is, and where the shot goes — whatever the screen's
 * shape and whatever the two fields of view are. The old pose put the sights
 * a few centimetres under the axis; on a wide screen they looked nearly
 * right, on a tall one they pointed at the floor.
 *
 * Kick and sway turn the gun about its sight while aimed, so the front post
 * jumps and settles back onto the target rather than the whole gun sliding
 * off it. The arms are the same body every player has (rig.js), their hands
 * placed on the grip and the handguard. Until the models load, the old box
 * guns stand in, given sights of their own. */

import * as THREE from "three";
import { S } from "./state.js";
import { GUNS, gunOf } from "./weapons.js";
import { LUNGE } from "./movement.js";
import { clamp, damp, wrapAngle } from "./util.js";
import { gunCopy, humanCopy, paint, hasHuman, onModels } from "./models.js";
import { makeRig, poseRig } from "./rig.js";

export const vScene = new THREE.Scene();
export const vCam = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
vScene.add(new THREE.HemisphereLight(0xdde8ff, 0x403a36, 1.2));
const vsun = new THREE.DirectionalLight(0xfff1de, 1.9);
vsun.position.set(0.4, 1, 0.5);
vScene.add(vsun);
const fireLight = new THREE.PointLight(0xffc477, 0, 1.6, 2);
vScene.add(fireLight);

const holder = new THREE.Group();          // where the held thing is; its children are drawn
vScene.add(holder);
const items = {};                          // key -> { obj, muzzle, sight, support, box }

/* ---------------------------------------------------------------
   The old box guns, with sights, for before the models arrive
   --------------------------------------------------------------- */
const boxG = new THREE.BoxGeometry(1, 1, 1);
const metal = new THREE.MeshStandardMaterial({ color: 0x3a4250, roughness: 0.5, metalness: 0.4 });
const dark = new THREE.MeshStandardMaterial({ color: 0x1b2029, roughness: 0.6, metalness: 0.2 });
const glove = new THREE.MeshStandardMaterial({ color: 0x2e3542, roughness: 0.8 });
const sleeve = new THREE.MeshStandardMaterial({ color: 0x4b5668, roughness: 0.8 });
const accentVm = new THREE.MeshStandardMaterial({ color: 0x39c6e8, emissive: 0x1a7f99, emissiveIntensity: 0.6 });
const bladeMat = new THREE.MeshStandardMaterial({ color: 0xe6edf5, roughness: 0.2, metalness: 0.9 });
function part(g, mat, sx, sy, sz, x, y, z, rx) {
  const m = new THREE.Mesh(boxG, mat);
  m.scale.set(sx, sy, sz); m.position.set(x, y, z);
  if (rx) m.rotation.x = rx;
  g.add(m);
  return m;
}
function boxItem(id) {
  const inner = new THREE.Group(), g = new THREE.Group();
  inner.scale.setScalar(0.72);
  g.add(inner);
  const G = GUNS[id];
  let muzzle, sight = null, support = null;
  part(inner, glove, 0.045, 0.075, 0.065, 0, -0.07, 0.02, -0.3);
  part(inner, sleeve, 0.065, 0.065, 0.3, 0.015, -0.1, 0.19);
  if (G && G.hold === "pistol") {
    const L = id === "brick" ? 0.24 : 0.18;
    part(inner, metal, 0.036, 0.05, L, 0, 0, -L / 2 + 0.03);
    part(inner, dark, 0.032, 0.095, 0.045, 0, -0.06, 0.012, 0.25);
    part(inner, accentVm, 0.037, 0.006, L * 0.7, 0, -0.012, -L / 2 + 0.03);
    part(inner, dark, 0.008, 0.012, 0.012, 0, 0.031, -L + 0.05);
    if (id === "brick") part(inner, metal, 0.052, 0.052, 0.06, 0, -0.004, -0.03);
    muzzle = [0, 0.005, -L + 0.02]; sight = [0, 0.031, 0.02];
  } else if (G) {
    const L = id === "talon" ? 0.72 : id === "mauler" ? 0.54 : id === "hornet" ? 0.36 : 0.5;
    part(inner, metal, 0.042, 0.06, L * 0.62, 0, 0, -L * 0.25);
    part(inner, dark, 0.022, 0.022, L * 0.45, 0, 0.008, -L * 0.72);
    part(inner, accentVm, 0.043, 0.006, L * 0.5, 0, -0.016, -L * 0.25);
    part(inner, dark, 0.036, 0.1, 0.045, 0, -0.07, 0.02, 0.2);
    part(inner, dark, 0.034, 0.07, 0.14, 0, -0.005, 0.12);
    part(inner, glove, 0.045, 0.06, 0.07, -0.028, -0.045, -L * 0.42);
    part(inner, sleeve, 0.06, 0.06, 0.32, -0.06, -0.09, -L * 0.1);
    if (id === "talon") { part(inner, dark, 0.04, 0.04, 0.24, 0, 0.058, -0.14); part(inner, accentVm, 0.042, 0.042, 0.01, 0, 0.058, -0.02); sight = [0, 0.058, -0.02]; }
    else { part(inner, dark, 0.012, 0.022, 0.03, 0, 0.04, -L * 0.05); part(inner, dark, 0.008, 0.02, 0.01, 0, 0.04, -L * 0.85); sight = [0, 0.051, -L * 0.05]; }
    if (id === "mauler") part(inner, dark, 0.05, 0.04, 0.18, 0, -0.035, -L * 0.62);
    if (id === "hornet") part(inner, dark, 0.026, 0.13, 0.036, 0, -0.1, -0.07);
    if (id === "kestrel") part(inner, dark, 0.03, 0.12, 0.05, 0, -0.09, -0.1, 0.25);
    muzzle = [0, 0.008, -L * 0.95];
  } else if (id === "katana") {
    part(inner, dark, 0.03, 0.03, 0.2, 0, -0.03, 0.02);
    part(inner, accentVm, 0.08, 0.012, 0.03, 0, -0.03, -0.09);
    part(inner, bladeMat, 0.012, 0.035, 0.7, 0, -0.02, -0.45);
    muzzle = [0, 0, -0.8];
  } else {
    part(inner, dark, 0.03, 0.03, 0.9, 0, -0.03, -0.2);
    part(inner, accentVm, 0.05, 0.05, 0.05, 0, -0.03, -0.66);
    part(inner, bladeMat, 0.02, 0.06, 0.28, 0, -0.03, -0.82);
    muzzle = [0, 0, -0.95];
  }
  const v = (a) => (a ? new THREE.Vector3(a[0], a[1], a[2]).multiplyScalar(0.72) : null);
  return { obj: g, muzzle: v(muzzle), sight: v(sight), support: v(support), box: true };
}
function itemFor(key) {
  let it = items[key];
  const want = !!gunCopy(key) ? "model" : "box";
  if (it && (it.box ? "box" : "model") === want) return it;
  if (it) it.obj.removeFromParent();
  if (want === "model") {
    const c = gunCopy(key);
    c.obj.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    it = { obj: c.obj, muzzle: c.t.muzzle, sight: c.t.sight, support: c.t.support, box: false };
  } else it = boxItem(key);
  it.obj.visible = false;
  holder.add(it.obj);
  items[key] = it;
  return it;
}

/* ---------------------------------------------------------------
   Arms
   --------------------------------------------------------------- */
let arms = null;                           // { rig, mat, color, seed }
const EYE = new THREE.Vector3(0, 1.68, -0.09);  // the body's eye, in its own frame
function armsFor(a) {
  if (!hasHuman()) return null;
  if (!arms) {
    const c = humanCopy();
    const rig = makeRig(c);
    const mat = new THREE.MeshStandardMaterial({ map: paint(a.color, a.id), roughness: 0.8 });
    c.mesh.material = mat;
    c.root.position.copy(EYE).negate();
    // the camera is inside this head: fold the head and neck away to nothing
    c.bones.Neck.scale.setScalar(0.0001);
    // and your own hands a touch smaller than life: this close they would fill the screen
    c.bones.LeftHand.scale.setScalar(0.82); c.bones.RightHand.scale.setScalar(0.82);
    vScene.add(c.root);
    arms = { rig, mat, color: a.color, seed: a.id, root: c.root };
  }
  if (arms.color !== a.color || arms.seed !== a.id) { arms.mat.map.dispose(); arms.mat.map = paint(a.color, a.id); arms.color = a.color; arms.seed = a.id; }
  return arms;
}
onModels(() => { for (const k in items) { items[k].obj.removeFromParent(); delete items[k]; } V.key = ""; });
const T = { pelvis: new THREE.Vector3(0, 0.955, 0), spine: new THREE.Vector3(0, 1.19, 0.01), chest: new THREE.Vector3(0, 1.41, 0.02), neck: new THREE.Vector3(0, 1.5, 0.02), head: new THREE.Vector3(0, 1.62, 0),
  lHand: new THREE.Vector3(), rHand: new THREE.Vector3(), lElbow: new THREE.Vector3(-0.55, 1.0, 0.25), rElbow: new THREE.Vector3(0.55, 1.0, 0.25), pitch: 0 };
const GRIP_WRIST = new THREE.Vector3(0, -0.045, 0.075), SUPPORT_WRIST = new THREE.Vector3(-0.03, -0.06, 0.045);
// a pistol's hands sit low on the grip, under the slide, so the sights stay clear
const GRIP_WRIST_P = new THREE.Vector3(0.005, -0.075, 0.07), SUPPORT_WRIST_P = new THREE.Vector3(-0.04, -0.085, 0.05);
const LEFT_DOWN = new THREE.Vector3(-0.32, -0.6, 0.0);

/* ---------------------------------------------------------------
   Every frame
   --------------------------------------------------------------- */
const V = { bob: 0, kick: 0, swayX: 0, swayY: 0, lastYaw: 0, lastPitch: 0, flashT: 0, swing: 0, swapT: 0, key: "", sprint: 0, air: 0 };
export function vmFire(e) {
  const id = GUNS[e.gun] && GUNS[e.gun].id;
  V.kick = Math.min(1, V.kick + (id === "talon" || id === "brick" || id === "mauler" ? 1 : 0.45));
  V.flashT = 0.055;
}
export function vmSwing() { V.swing = 1; }
const flashTex = (() => {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, "rgba(255,250,230,1)"); r.addColorStop(0.25, "rgba(255,210,120,0.9)"); r.addColorStop(1, "rgba(255,140,40,0)");
  g.fillStyle = r; g.beginPath();
  for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2, rr = i % 2 ? 12 : 32; g.lineTo(32 + Math.cos(a) * rr, 32 + Math.sin(a) * rr); }
  g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
vScene.add(flash);

const pivot = new THREE.Vector3(), q = new THREE.Quaternion(), e3 = new THREE.Euler(0, 0, 0, "YXZ"), tmp = new THREE.Vector3();
const mz = new THREE.Vector3();
export let vmVisible = false, vmScoped = false;
let current = null;

/* The gun's own field of view: a fixed vertical one on a screen wider than 5:4, so the gun is the
   same size on any monitor, and a fixed horizontal one on anything narrower, so a phone held upright
   still has the gun in frame instead of off its right edge. */
const VM_FOV = 62;
function vmFov(aspect) {
  if (aspect >= 1.25) return VM_FOV;
  return 2 * Math.atan(Math.tan(VM_FOV * Math.PI / 360) * 1.25 / aspect) * 180 / Math.PI;
}

export function updateViewmodel(dt, aspect, zoom) {
  const a = S.me;
  const third = S.hackView && S.hackView.thirdPerson;
  if (!a || !a.alive || third) { holder.visible = false; if (arms) arms.root.visible = false; flash.material.opacity = 0; fireLight.intensity = 0; vmVisible = false; return; }
  const A = a.arms, g = gunOf(A);
  const key = g ? g.id : A.melee;
  const it = itemFor(key);
  if (key !== V.key) { for (const k in items) items[k].obj.visible = false; V.key = key; V.swapT = 1; }
  it.obj.visible = true;
  current = it;
  holder.visible = true;
  const body = a.body;
  const hs = Math.hypot(body.vx, body.vz);
  V.bob += dt * (body.onGround ? hs * 1.3 : 0);
  const bobAmt = body.onGround && !body.sliding ? Math.min(1, hs / 7) : 0;
  const inv = dt > 0 ? 1 / dt : 0;
  const dy = wrapAngle(S.view.yaw - V.lastYaw) * inv, dp = (S.view.pitch - V.lastPitch) * inv;
  V.lastYaw = S.view.yaw; V.lastPitch = S.view.pitch;
  V.swayX = damp(V.swayX, clamp(dy * 0.02, -0.07, 0.07), 10, dt);
  V.swayY = damp(V.swayY, clamp(-dp * 0.02, -0.07, 0.07), 10, dt);
  V.kick = damp(V.kick, 0, 13, dt);
  V.swing = Math.max(0, V.swing - dt * 3.2);
  V.swapT = Math.max(0, V.swapT - dt * 4);
  V.sprint = damp(V.sprint, body.sprinting && !A.ads ? 1 : 0, 10, dt);
  V.air = damp(V.air, body.onGround ? 0 : clamp(-body.vy * 0.04, -0.6, 0.6), 8, dt);
  const ads = A.ads, hip = 1 - ads;
  const pistol = g && g.hold === "pistol";

  // where the grip is, hip and aimed; aimed puts the sight on the axis at a little distance from the eye
  let hx, hy, hz;
  if (!g) { hx = A.melee === "lancer" ? 0.2 : 0.24; hy = A.melee === "lancer" ? -0.24 : -0.3; hz = A.melee === "lancer" ? -0.2 : -0.42; }
  else if (pistol) { hx = 0.16; hy = -0.17; hz = -0.42; }
  else { hx = 0.15; hy = -0.17; hz = -0.33; }
  let x = hx, y = hy, z = hz;
  if (g && it.sight) {
    const relief = pistol ? 0.46 : g.id === "talon" ? 0.11 : 0.22;
    const ax = -it.sight.x, ay = -it.sight.y, az = -relief - it.sight.z;
    x = hx + (ax - hx) * ads; y = hy + (ay - hy) * ads; z = hz + (az - hz) * ads;
  }
  const b = hip * 0.85 * bobAmt + 0.15 * bobAmt;
  x += Math.sin(V.bob) * 0.011 * b * hip - V.swayX * (1 - ads * 0.92);
  y += Math.abs(Math.cos(V.bob)) * 0.009 * b - V.swayY * (1 - ads * 0.92) - V.swapT * 0.28 + V.air * 0.05 * hip;
  z += V.kick * (pistol ? 0.035 : 0.05);
  let rx = V.kick * 0.13 * (1 - ads * 0.65), ry = 0.04 * hip, rz = 0;
  if (A.reloadT > 0 && g) {
    const k = Math.sin(Math.min(1, 1 - A.reloadT / g.reload) * Math.PI);
    y -= 0.08 * k; rz += 0.55 * k; rx += 0.25 * k;
  }
  if (V.sprint > 0) { x += 0.03 * V.sprint; y -= 0.05 * V.sprint; rz += 0.45 * V.sprint; rx -= 0.15 * V.sprint; ry += 0.35 * V.sprint; }
  if (!g) {
    // blades: held up; a swing sweeps across; a charge draws back; a lunge thrusts
    const s = V.swing > 0 ? Math.sin((1 - V.swing) * Math.PI) : 0;
    if (A.melee === "lancer") { rx += -0.08; ry += -0.06 + s * 0.5; z -= s * 0.25; }
    else { rx += 0.62 - s * 1.3; ry += s * 1.2 - 0.18; rz += 0.42 - s * 1.2; x -= s * 0.14; }
    if (body.lunge === LUNGE.CHARGE) { z += 0.08 + 0.1 * body.lungeCharge; rx += 0.3 * body.lungeCharge; x += 0.03; }
    if (body.lunge === LUNGE.DASH) { z -= 0.2; rx = A.melee === "lancer" ? 0 : 0.2; }
  }
  // turn about the sight while aimed, about the grip otherwise
  if (it.sight) pivot.copy(it.sight).multiplyScalar(ads); else pivot.set(0, 0, 0);
  e3.set(rx, ry, rz);
  q.setFromEuler(e3);
  holder.quaternion.copy(q);
  holder.position.set(x, y, z).add(pivot).sub(tmp.copy(pivot).applyQuaternion(q));

  // the field of view: a little narrower aimed, and never letting a tall screen crop the gun
  vCam.aspect = aspect;
  vCam.fov = vmFov(aspect) / Math.max(1, zoom * 0.25 + 0.75);
  vCam.updateProjectionMatrix();

  // the arms: hands on the grip and the handguard (or the magazine, mid-reload)
  const R = armsFor(a);
  if (R) {
    R.root.visible = true;
    T.rHand.copy(pistol ? GRIP_WRIST_P : GRIP_WRIST).applyQuaternion(q).add(holder.position).add(EYE);
    if (it.support) {
      tmp.copy(it.support);
      if (A.reloadT > 0 && g) { const k = Math.sin(Math.min(1, 1 - A.reloadT / g.reload) * Math.PI); tmp.lerp(new THREE.Vector3(0, -0.12, it.support.z * 0.4), k); }
      T.lHand.copy(tmp).add(pistol ? SUPPORT_WRIST_P : SUPPORT_WRIST).applyQuaternion(q).add(holder.position).add(EYE);
    } else if (!g && A.melee === "lancer") T.lHand.set(0, 0, -0.38).applyQuaternion(q).add(holder.position).add(EYE);
    else T.lHand.copy(LEFT_DOWN).add(EYE);
    poseRig(R.rig, T);
    // the box guns bring their own glove and sleeve
    R.root.visible = !it.box;
  }

  // the flash, and a little light on the gun
  V.flashT -= dt;
  if (V.flashT > 0 && g) {
    holder.updateMatrixWorld(true);
    flash.position.copy(it.muzzle).applyMatrix4(it.obj.matrixWorld);
    flash.material.rotation = Math.random() * 6.28;
    flash.material.opacity = 1;
    flash.scale.setScalar((g.id === "talon" || g.id === "mauler" ? 0.2 : pistol ? 0.1 : 0.13) * (0.85 + Math.random() * 0.4));
    fireLight.position.copy(flash.position);
    fireLight.intensity = 1.6;
  } else { flash.material.opacity = 0; fireLight.intensity = 0; }
  vmScoped = !!(g && g.id === "talon" && ads > 0.9);
  vmVisible = !vmScoped;
}

/** Where your muzzle is on screen, as a point in the world half a metre out, for your own tracers. */
export function muzzleWorld(camera, out) {
  if (!current || !vmVisible) return null;
  holder.updateMatrixWorld(true);
  mz.copy(current.muzzle).applyMatrix4(current.obj.matrixWorld).project(vCam);
  const d = tmp.set(0, 0, -0.6).applyMatrix4(camera.projectionMatrix).z;
  mz.z = d;
  return out.copy(mz).unproject(camera);
}
