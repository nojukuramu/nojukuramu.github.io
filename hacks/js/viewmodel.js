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
 * guns stand in, given sights of their own.
 *
 * On top of that, the moves, keyframed the way an animator keys them — a
 * draw that comes up from the hip and overshoots into place, a cut that winds
 * up, whips through and follows on, a throw that reaches back and lets go, a
 * reload in stages (tilt, magazine out, magazine slapped home, the charging
 * handle racked), a gun butt jabbed for a quick melee — and springs for what
 * has weight: every shot kicks the gun back and up and it rings back past
 * level and settles; a landing drops it and it bounces. A blade that lands at
 * speed stops dead for an instant (hit-stop) so the hit is felt. A sniper's
 * bolt is worked after each shot (the scope shakes with it, hud.js), a blade
 * is carried low and forward when you are going fast with it, the gun drops
 * away and both hands go to the ledge when you mantle, and on a wall ride the
 * gun leans off the wall and shivers with it. */

import * as THREE from "three";
import { S } from "./state.js";
import { GUNS, gunOf, boltOf, grappleOut, utilOut } from "./weapons.js";
import { LUNGE, HOOK, mantleOf } from "./movement.js";
import { utilModel } from "./worldfx.js";
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
    const L = id === "condor" ? 0.86 : id === "talon" ? 0.72 : id === "mauler" ? 0.54 : id === "hornet" ? 0.36 : 0.5;
    part(inner, metal, 0.042, 0.06, L * 0.62, 0, 0, -L * 0.25);
    part(inner, dark, 0.022, 0.022, L * 0.45, 0, 0.008, -L * 0.72);
    part(inner, accentVm, 0.043, 0.006, L * 0.5, 0, -0.016, -L * 0.25);
    part(inner, dark, 0.036, 0.1, 0.045, 0, -0.07, 0.02, 0.2);
    part(inner, dark, 0.034, 0.07, 0.14, 0, -0.005, 0.12);
    part(inner, glove, 0.045, 0.06, 0.07, -0.028, -0.045, -L * 0.42);
    part(inner, sleeve, 0.06, 0.06, 0.32, -0.06, -0.09, -L * 0.1);
    if (G.scope) { part(inner, dark, 0.04, 0.04, 0.24, 0, 0.058, -0.14); part(inner, accentVm, 0.042, 0.042, 0.01, 0, 0.058, -0.02); sight = [0, 0.058, -0.02]; }
    else { part(inner, dark, 0.012, 0.022, 0.03, 0, 0.04, -L * 0.05); part(inner, dark, 0.008, 0.02, 0.01, 0, 0.04, -L * 0.85); sight = [0, 0.051, -L * 0.05]; }
    if (id === "mauler") part(inner, dark, 0.05, 0.04, 0.18, 0, -0.035, -L * 0.62);
    if (id === "hornet") part(inner, dark, 0.026, 0.13, 0.036, 0, -0.1, -0.07);
    if (id === "kestrel") part(inner, dark, 0.03, 0.12, 0.05, 0, -0.09, -0.1, 0.25);
    if (id === "condor") { part(inner, dark, 0.05, 0.05, 0.1, 0, 0.008, -L * 0.98); part(inner, dark, 0.012, 0.11, 0.012, 0.03, -0.06, -L * 0.7, 0.4); part(inner, dark, 0.012, 0.11, 0.012, -0.03, -0.06, -L * 0.7, 0.4); }
    muzzle = [0, 0.008, -L * 0.95];
  } else if (id === "grapple") {
    // the grappling gun: a stubby launcher with the hook sitting in its mouth
    part(inner, dark, 0.05, 0.06, 0.2, 0, 0, -0.07);
    part(inner, accentVm, 0.052, 0.012, 0.14, 0, 0.032, -0.07);
    part(inner, metal, 0.034, 0.034, 0.08, 0, 0, -0.2);
    part(inner, metal, 0.07, 0.012, 0.012, 0, 0, -0.245);
    part(inner, dark, 0.032, 0.095, 0.045, 0, -0.07, 0.01, 0.25);
    muzzle = [0, 0, -0.25]; sight = [0, 0.04, 0.02];
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
  if (key.startsWith("u:")) {
    // a grenade or a mine in the hand: the same model that flies, held in the fingers
    if (it) return it;
    const m = utilModel(key.slice(2));
    m.g.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    // a grenade sits big in the fingers; a mine's case would fill the screen at that size
    m.g.scale.setScalar(key === "u:frag" || key === "u:flash" ? 1.15 : 0.7);
    it = { obj: m.g, muzzle: new THREE.Vector3(0, 0.05, -0.05), sight: null, support: null, box: false, util: true };
    it.obj.visible = false; holder.add(it.obj); items[key] = it;
    return it;
  }
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
onModels(() => { for (const k in items) { if (items[k].util) continue; items[k].obj.removeFromParent(); delete items[k]; } V.key = ""; });
const T = { pelvis: new THREE.Vector3(0, 0.955, 0), spine: new THREE.Vector3(0, 1.19, 0.01), chest: new THREE.Vector3(0, 1.41, 0.02), neck: new THREE.Vector3(0, 1.5, 0.02), head: new THREE.Vector3(0, 1.62, 0),
  lHand: new THREE.Vector3(), rHand: new THREE.Vector3(), lElbow: new THREE.Vector3(-0.55, 1.0, 0.25), rElbow: new THREE.Vector3(0.55, 1.0, 0.25), pitch: 0 };
const GRIP_WRIST = new THREE.Vector3(0, -0.045, 0.075), SUPPORT_WRIST = new THREE.Vector3(-0.03, -0.06, 0.045);
// a pistol's hands sit low on the grip, under the slide, so the sights stay clear
const GRIP_WRIST_P = new THREE.Vector3(0.005, -0.075, 0.07), SUPPORT_WRIST_P = new THREE.Vector3(-0.04, -0.085, 0.05);
// a grenade sits in the fingers, not the palm
const GRIP_WRIST_U = new THREE.Vector3(0.01, -0.05, 0.06);
const LEFT_DOWN = new THREE.Vector3(-0.32, -0.6, 0.0);

/* ---------------------------------------------------------------
   Moves: keyframes
   --------------------------------------------------------------- */
/*
 * A move is a track of keys [t, x, y, z, rx, ry, rz, ease] on a 0..1 timeline:
 * offsets from the held pose, in metres and radians. Between two keys the
 * second key's ease shapes the way there: "s" smooth, "o" a fast start that
 * slows (a strike), "i" a slow start that speeds up (a wind-up), "b" past it
 * and back (an overshoot). This is the part that makes it feel like a hit
 * rather than a slide: anticipation, a quick strike, follow-through, settle.
 */
const EASE = {
  s: (k) => k * k * (3 - 2 * k),
  o: (k) => 1 - Math.pow(1 - k, 3),
  i: (k) => k * k * k,
  b: (k) => { const c = 1.9; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); }
};
const MOVES = {
  // up from the hip, a touch past where it settles, and back
  draw: { dur: 0.42, keys: [[0, 0.05, -0.3, 0.1, -1.1, 0.35, 0.7], [0.55, 0, 0.012, -0.012, 0.09, -0.03, -0.05, "o"], [0.78, 0, -0.004, 0.004, -0.02, 0.01, 0.015, "s"], [1, 0, 0, 0, 0, 0, 0, "s"]] },
  // the katana: wound up to the right, whipped through down and across, carried on, recovered
  katana: { dur: 0.44, keys: [[0, 0, 0, 0, 0, 0, 0], [0.22, 0.07, 0.07, 0.05, -0.55, -0.55, -0.65, "i"], [0.42, -0.22, -0.07, -0.13, 1.15, 1.25, 1.3, "o"], [0.62, -0.26, -0.11, -0.08, 1.3, 1.35, 1.4, "s"], [1, 0, 0, 0, 0, 0, 0, "s"]] },
  // the lance: drawn back, driven straight in, held a breath, withdrawn
  lancer: { dur: 0.44, keys: [[0, 0, 0, 0, 0, 0, 0], [0.26, 0.02, -0.02, 0.13, 0.12, 0.08, 0, "i"], [0.44, -0.01, 0.01, -0.32, -0.06, -0.04, 0, "o"], [0.62, -0.01, 0.01, -0.28, -0.04, -0.03, 0, "s"], [1, 0, 0, 0, 0, 0, 0, "s"]] },
  // a gun's quick melee: the butt jabbed forward and across
  bash: { dur: 0.42, keys: [[0, 0, 0, 0, 0, 0, 0], [0.24, 0.04, 0.03, 0.09, -0.25, 0.25, 0.3, "i"], [0.42, -0.07, 0.02, -0.17, 0.25, -0.45, -0.55, "o"], [0.6, -0.06, 0.0, -0.13, 0.2, -0.4, -0.5, "s"], [1, 0, 0, 0, 0, 0, 0, "s"]] },
  // a grenade: reached back over the shoulder, thrown through, the empty hand coming down
  throw: { dur: 0.46, keys: [[0, 0, 0, 0, 0, 0, 0], [0.32, 0.06, 0.13, 0.16, -1.0, 0.2, 0.35, "i"], [0.52, -0.05, -0.04, -0.24, 0.85, -0.15, -0.2, "o"], [0.72, -0.04, -0.16, -0.1, 1.0, -0.1, -0.25, "s"], [1, 0, -0.32, 0.05, 0.4, 0, 0, "s"]] },
  // a quick throw with a gun in hand: the gun ducks out of the way and comes back
  quick: { dur: 0.52, keys: [[0, 0, 0, 0, 0, 0, 0], [0.22, 0.05, -0.17, 0.06, -0.45, 0.25, 0.55, "o"], [0.68, 0.05, -0.17, 0.06, -0.45, 0.25, 0.55, "s"], [1, 0, 0, 0, 0, 0, 0, "b"]] },
  // over a ledge: the gun swung down out of the way while the hands do the work
  mantle: { dur: 1, keys: [[0, 0, 0, 0, 0, 0, 0], [0.25, 0.04, -0.34, 0.1, -0.9, 0.3, 0.6, "o"], [0.8, 0.04, -0.34, 0.1, -0.9, 0.3, 0.6, "s"], [1, 0, 0, 0, 0, 0, 0, "s"]] }
};
/* Reloads, in stages, on the reload's own clock so the hands meet the sounds. Per kind of gun. */
const RELOADS = {
  rifle: [[0, 0, 0, 0, 0, 0, 0], [0.14, 0, -0.05, 0.02, 0.26, 0.1, 0.5, "s"], [0.3, 0, -0.1, 0.03, 0.32, 0.12, 0.62, "o"], [0.52, 0, -0.07, 0.02, 0.3, 0.12, 0.58, "s"],
    [0.6, 0, -0.03, 0.0, 0.22, 0.1, 0.5, "o"], [0.66, 0, -0.055, 0.012, 0.27, 0.11, 0.53, "b"], [0.8, 0.012, -0.02, 0.035, 0.06, -0.15, 0.22, "o"], [0.86, 0.012, -0.012, 0.05, 0.09, -0.2, 0.26, "b"], [1, 0, 0, 0, 0, 0, 0, "s"]],
  pistol: [[0, 0, 0, 0, 0, 0, 0], [0.16, 0, 0.03, 0.03, 0.5, 0.05, 0.3, "s"], [0.32, 0, 0.05, 0.03, 0.62, 0.05, 0.34, "o"], [0.56, 0, 0.03, 0.02, 0.55, 0.05, 0.3, "s"],
    [0.64, 0, 0.06, 0.01, 0.48, 0.04, 0.26, "o"], [0.7, 0, 0.035, 0.02, 0.56, 0.05, 0.3, "b"], [0.84, -0.01, 0.0, 0.05, 0.1, -0.1, 0.05, "o"], [1, 0, 0, 0, 0, 0, 0, "b"]],
  pump: [[0, 0, 0, 0, 0, 0, 0], [0.12, 0.02, -0.06, 0.02, 0.15, -0.25, -0.45, "s"], [0.25, 0.02, -0.05, 0.02, 0.18, -0.25, -0.45, "s"], [0.33, 0.02, -0.075, 0.025, 0.12, -0.25, -0.45, "o"],
    [0.45, 0.02, -0.05, 0.02, 0.18, -0.25, -0.45, "s"], [0.53, 0.02, -0.075, 0.025, 0.12, -0.25, -0.45, "o"], [0.65, 0.02, -0.05, 0.02, 0.18, -0.25, -0.45, "s"], [0.73, 0.02, -0.075, 0.025, 0.12, -0.25, -0.45, "o"],
    [0.82, 0, -0.01, 0.0, 0.02, 0, 0, "s"], [0.88, 0, -0.02, 0.06, 0.05, 0, 0, "o"], [0.94, 0, -0.01, -0.01, 0.0, 0, 0, "b"], [1, 0, 0, 0, 0, 0, 0, "s"]],
  bolt: [[0, 0, 0, 0, 0, 0, 0], [0.15, 0.02, -0.04, 0.02, 0.1, 0.05, -0.45, "s"], [0.25, 0.02, -0.04, 0.05, 0.12, 0.05, -0.5, "o"], [0.45, 0.02, -0.07, 0.04, 0.2, 0.08, -0.42, "s"],
    [0.6, 0.02, -0.035, 0.03, 0.15, 0.06, -0.45, "o"], [0.75, 0.02, -0.04, 0.0, 0.12, 0.05, -0.5, "o"], [0.85, 0.02, -0.03, -0.01, 0.1, 0.04, -0.44, "b"], [1, 0, 0, 0, 0, 0, 0, "s"]],
  cannon: [[0, 0, 0, 0, 0, 0, 0], [0.2, 0.0, 0.06, 0.04, 0.55, 0.05, 0.15, "s"], [0.42, 0.0, 0.08, 0.05, 0.62, 0.05, 0.18, "s"], [0.55, 0.0, 0.05, 0.08, 0.55, 0.05, 0.15, "o"],
    [0.62, 0.0, 0.07, 0.04, 0.6, 0.05, 0.16, "b"], [0.82, 0, 0.02, 0.0, 0.2, 0.0, 0.05, "s"], [1, 0, 0, 0, 0, 0, 0, "b"]]
};
const OUT = [0, 0, 0, 0, 0, 0];
/** Where a track is at k (0..1): eased between the two keys either side. */
function sample(keys, k, out) {
  out = out || OUT;
  let i = 1;
  while (i < keys.length - 1 && keys[i][0] < k) i++;
  const a = keys[i - 1], b = keys[i];
  const span = b[0] - a[0];
  const u = span > 0 ? Math.max(0, Math.min(1, (k - a[0]) / span)) : 1;
  const e = (EASE[b[7] || "s"] || EASE.s)(u);
  for (let j = 0; j < 6; j++) out[j] = a[j + 1] + (b[j + 1] - a[j + 1]) * e;
  return out;
}
const NOW = [0, 0, 0, 0, 0, 0], RL = [0, 0, 0, 0, 0, 0];
let move = null;                // { name, t, dur }
function play(name, dur) { move = { name, t: 0, dur: dur || MOVES[name].dur }; }

/* ---------------------------------------------------------------
   Springs: what has weight
   --------------------------------------------------------------- */
/* Six springs, the same six offsets as a key. Stiff and a little under-damped, so a kick rings back past level
   once and settles — the difference between a gun that recoils and one that is merely moved. */
const SPR = { x: [0, 0, 0, 0, 0, 0], v: [0, 0, 0, 0, 0, 0] };
const SPR_K = [300, 340, 380, 420, 300, 300], SPR_C = [20, 22, 22, 21, 18, 18];
function springs(dt) {
  // in a few steps, so a long frame cannot make it blow up
  const n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n;
  for (let s = 0; s < n; s++) for (let j = 0; j < 6; j++) { SPR.v[j] += (-SPR.x[j] * SPR_K[j] - SPR.v[j] * SPR_C[j]) * h; SPR.x[j] += SPR.v[j] * h; }
}
/* Per gun: how hard a shot shoves back (m/s), flips up (rad/s), and twists. */
const KICK = { wasp: [0.9, 9, 2], brick: [1.8, 19, 4], hornet: [0.55, 4.5, 2.5], kestrel: [0.8, 6.5, 2.2], mauler: [2.2, 16, 4], talon: [2.4, 15, 3], condor: [3.2, 21, 5], cannon: [3.6, 22, 6] };

/* ---------------------------------------------------------------
   Every frame
   --------------------------------------------------------------- */
const V = { bob: 0, swayX: 0, swayY: 0, lastYaw: 0, lastPitch: 0, flashT: 0, swing: 0, swapT: 0, key: "", sprint: 0, air: 0, slide: 0, rush: 0, rushT: 0, hook: 0, stop: 0, wasGround: true, ride: 0, climb: 0, mantle: 0 };
export function vmFire(e) {
  const k = KICK[e.gun] || [1, 8, 2], ads = S.me ? S.me.arms.ads : 0;
  SPR.v[2] += k[0]; SPR.v[3] += k[1] * (1 - ads * 0.45);
  SPR.v[4] += (Math.random() - 0.5) * k[2]; SPR.v[5] += (Math.random() - 0.5) * k[2] * 1.4;
  SPR.v[1] += k[0] * 0.15;
  V.flashT = 0.055;
}
/* A cut: the keyed swing for the blade in hand, or a jab with a gun's butt. */
export function vmSwing() {
  V.swing = 1;
  const A = S.me && S.me.arms;
  if (!A) return;
  play(A.cur === 2 ? (A.melee === "lancer" ? "lancer" : "katana") : "bash");
}
/** A cut that landed at speed: everything stops for an instant, then carries on harder. */
export function vmHitStop(k) { V.stop = 0.05 + 0.04 * (k || 1); SPR.v[3] -= 4; SPR.v[2] -= 0.8; }
export function vmThrow(quick) { play(quick ? "quick" : "throw"); }
export function vmLand(v) { SPR.v[1] -= Math.min(1.6, v * 0.09); SPR.v[3] -= Math.min(4, v * 0.25); }
export function vmJump() { SPR.v[1] -= 0.45; SPR.v[3] += 1.5; }
/* The grapple in the left hand: a stubby launcher, drawn only while its rope is out. */
const launcher = new THREE.Group();
part(launcher, dark, 0.05, 0.05, 0.16, 0, 0, -0.04);
part(launcher, accentVm, 0.052, 0.012, 0.1, 0, 0.026, -0.04);
part(launcher, metal, 0.03, 0.03, 0.05, 0, 0, -0.14);
launcher.visible = false;
vScene.add(launcher);
const HOOK_HAND = new THREE.Vector3(-0.17, -0.13, -0.42);   // where the launcher's mouth sits, in the eye's frame
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

function reloadTrack(g) { return g.id === "cannon" ? RELOADS.cannon : g.pump ? RELOADS.pump : g.bolt ? RELOADS.bolt : g.hold === "pistol" ? RELOADS.pistol : RELOADS.rifle; }

export function updateViewmodel(dt, aspect, zoom) {
  const a = S.me;
  const third = S.hackView && S.hackView.thirdPerson;
  if (!a || !a.alive || third) { holder.visible = false; launcher.visible = false; if (arms) arms.root.visible = false; flash.material.opacity = 0; fireLight.intensity = 0; vmVisible = false; vmScoped = false; move = null; return; }
  const A = a.arms, g = gunOf(A), grapple = grappleOut(A), util = utilOut(A), blade = !g && !grapple && !util;
  const key = g ? g.id : grapple ? "grapple" : util ? "u:" + A.util : A.melee;
  const it = itemFor(key);
  if (key !== V.key) { for (const k in items) items[k].obj.visible = false; V.key = key; V.swapT = 1; play("draw"); }
  it.obj.visible = true;
  current = it;
  holder.visible = true;
  const body = a.body;
  // hit-stop: a cut that lands at speed freezes the hands for an instant
  V.stop = Math.max(0, V.stop - dt);
  const adt = V.stop > 0 ? dt * 0.08 : dt;
  const hs = Math.hypot(body.vx, body.vz);
  V.bob += adt * (body.onGround ? hs * 1.3 : 0);
  const bobAmt = body.onGround && !body.sliding ? Math.min(1, hs / 7) : 0;
  const inv = dt > 0 ? 1 / dt : 0;
  const dy = wrapAngle(S.view.yaw - V.lastYaw) * inv, dp = (S.view.pitch - V.lastPitch) * inv;
  V.lastYaw = S.view.yaw; V.lastPitch = S.view.pitch;
  V.swayX = damp(V.swayX, clamp(dy * 0.02, -0.07, 0.07), 10, dt);
  V.swayY = damp(V.swayY, clamp(-dp * 0.02, -0.07, 0.07), 10, dt);
  V.swing = Math.max(0, V.swing - adt * 3.2);
  V.swapT = Math.max(0, V.swapT - dt * 4);
  V.sprint = damp(V.sprint, body.sprinting && !A.ads ? 1 : 0, 10, dt);
  V.air = damp(V.air, body.onGround ? 0 : clamp(-body.vy * 0.04, -0.6, 0.6), 8, dt);
  // a landing or a take-off rings through the springs
  if (body.onGround && !V.wasGround) vmLand(Math.max(0, body.landSpeed || 0));
  V.wasGround = body.onGround;
  springs(adt);
  const ads = A.ads, hip = 1 - ads;
  const pistol = (g && g.hold === "pistol") || grapple;
  // a blade carried at speed: low, back and pointed ahead, the faster the more (and it is a lunge too)
  const speed3 = Math.hypot(body.vx, body.vy, body.vz);
  V.rush = damp(V.rush, blade && (speed3 > 8 || body.lunge === LUNGE.DASH) ? clamp((speed3 - 8) / 8, body.lunge === LUNGE.DASH ? 0.7 : 0, 1) : 0, 8, dt);
  V.rushT += dt * (8 + speed3);
  // the off-hand launcher: the grapple in your hands draws its own rope, so this is only for a rope that outlives the swap by a tick
  V.hook = damp(V.hook, body.hook !== HOOK.IDLE && !grapple ? 1 : 0, 14, dt);

  // where the grip is, hip and aimed; aimed puts the sight on the axis at a little distance from the eye
  let hx, hy, hz;
  if (blade) { hx = A.melee === "lancer" ? 0.2 : 0.24; hy = A.melee === "lancer" ? -0.24 : -0.3; hz = A.melee === "lancer" ? -0.2 : -0.42; }
  else if (util) { hx = 0.2; hy = -0.2; hz = -0.36; }
  else if (pistol) { hx = 0.16; hy = -0.17; hz = -0.42; }
  else if (g && g.id === "cannon") { hx = 0.19; hy = -0.2; hz = -0.36; }
  else { hx = 0.15; hy = -0.17; hz = -0.33; }
  let x = hx, y = hy, z = hz;
  if (g && it.sight) {
    const relief = pistol ? 0.46 : g.scope ? 0.11 : g.id === "cannon" ? 0.3 : 0.22;
    const ax = -it.sight.x, ay = -it.sight.y, az = -relief - it.sight.z;
    x = hx + (ax - hx) * ads; y = hy + (ay - hy) * ads; z = hz + (az - hz) * ads;
  }
  const b = hip * 0.85 * bobAmt + 0.15 * bobAmt;
  x += Math.sin(V.bob) * 0.011 * b * hip - V.swayX * (1 - ads * 0.92);
  y += Math.abs(Math.cos(V.bob)) * 0.009 * b - V.swayY * (1 - ads * 0.92) + V.air * 0.05 * hip;
  let rx = 0, ry = 0.04 * hip, rz = 0;
  // the springs: a shot's kick, a landing's drop
  x += SPR.x[0] * 0.3; y += SPR.x[1] * 0.5 * (1 - ads * 0.6); z += SPR.x[2] * 0.3;
  rx += SPR.x[3] * 0.15 * (1 - ads * 0.5); ry += SPR.x[4] * 0.3; rz += SPR.x[5] * 0.3;
  // the move being played, keyed
  if (move) {
    move.t += adt;
    const k = Math.min(1, move.t / move.dur);
    const m = sample(MOVES[move.name].keys, k, NOW);
    const w = move.name === "draw" ? 1 - ads * 0.5 : 1;
    x += m[0] * w; y += m[1] * w; z += m[2] * w; rx += m[3] * w; ry += m[4] * w; rz += m[5] * w;
    if (k >= 1) move = null;
  }
  if (A.reloadT > 0 && g) {
    const m = sample(reloadTrack(g), Math.min(1, 1 - A.reloadT / g.reload), RL);
    x += m[0]; y += m[1]; z += m[2]; rx += m[3]; ry += m[4]; rz += m[5];
  }
  // working a bolt: after the kick settles, the rifle rolls over to the right hand, is racked, and comes back
  const bolt = boltOf(A);
  if (bolt > 0 && g && g.bolt) {
    const k = bolt < 0.15 ? 0 : Math.sin(Math.min(1, (bolt - 0.15) / 0.75) * Math.PI);
    const rack = Math.sin(Math.min(1, (bolt - 0.3) / 0.4) * Math.PI * 2) * (bolt > 0.3 && bolt < 0.7 ? 1 : 0);
    rz -= 0.42 * k * g.bolt; y -= 0.035 * k; x += 0.02 * k; z += 0.025 * rack * g.bolt; rx += 0.06 * rack;
  }
  // sliding, the gun drops and leans in
  V.slide = damp(V.slide, body.sliding ? 1 : 0, 10, dt);
  if (V.slide > 0.001) { x -= 0.025 * V.slide * hip; y -= 0.04 * V.slide * hip; rz += 0.32 * V.slide * hip; }
  // riding a wall: the gun leans off it and shivers with the scrape
  const right = [Math.cos(body.yaw), -Math.sin(body.yaw)];
  const side = body.wallSlide ? (body.wsnx * right[0] + body.wsnz * right[1] < 0 ? 1 : -1) : 0;
  V.ride = damp(V.ride, side, 10, dt);
  if (Math.abs(V.ride) > 0.01) {
    const jit = Math.sin(performance.now() / 17) * 0.0025 * Math.abs(V.ride);
    x -= 0.03 * V.ride; rz += 0.22 * V.ride; y += jit; x += jit;
  }
  if (V.sprint > 0) { x += 0.03 * V.sprint; y -= 0.05 * V.sprint; rz += 0.45 * V.sprint; rx -= 0.15 * V.sprint; ry += 0.35 * V.sprint; }
  // climbing: the gun put away down the side while the hands go hand over hand up the wall
  V.climb = damp(V.climb, body.climbing ? 1 : 0, 12, dt);
  const mk = mantleOf(body);
  V.mantle = damp(V.mantle, body.mantle ? 1 : 0, body.mantle ? 18 : 8, dt);
  const away = Math.max(V.climb, V.mantle);
  if (away > 0.01) { x += 0.04 * away; y -= 0.36 * away; z += 0.1 * away; rx -= 0.9 * away; ry += 0.3 * away; rz += 0.6 * away; }
  if (blade) {
    // blades: held up; a charge draws back; a lunge thrusts (a swing is the keyed move above)
    if (A.melee === "lancer") { rx += -0.08; ry += -0.06; }
    else { rx += 0.62; ry += -0.18; rz += 0.42; }
    if (body.lunge === LUNGE.CHARGE) { z += 0.08 + 0.1 * body.lungeCharge; rx += 0.3 * body.lungeCharge; x += 0.03; x += Math.sin(performance.now() / 23) * 0.002 * body.lungeCharge; }
    if (body.lunge === LUNGE.DASH) { z -= 0.2; rx = A.melee === "lancer" ? 0 : 0.2; }
    if (V.rush > 0.01) {
      // the charge: the katana drawn back along the side, edge forward; the lance couched and levelled
      const s = V.swing > 0 ? Math.sin((1 - V.swing) * Math.PI) : 0;
      const j = Math.sin(V.rushT) * 0.012 * V.rush, r = V.rush * (1 - s);
      if (A.melee === "lancer") { y -= 0.04 * r; z -= 0.08 * r; rx -= 0.1 * r; x -= 0.05 * r; }
      else { x += 0.04 * r; y -= 0.07 * r; z += 0.05 * r; rx -= 0.55 * r; ry -= 0.25 * r; rz -= 0.35 * r; }
      x += j; y += j * 0.6;
    }
  }
  // turn about the sight while aimed, about the grip otherwise
  if (it.sight) pivot.copy(it.sight).multiplyScalar(ads); else pivot.set(0, 0, 0);
  e3.set(rx, ry, rz);
  q.setFromEuler(e3);
  holder.quaternion.copy(q);
  holder.position.set(x, y, z).add(pivot).sub(tmp.copy(pivot).applyQuaternion(q));
  // a grenade just thrown leaves an empty hand until the next comes up
  if (it.util) it.obj.visible = A.utilN > 0 && !(move && move.name === "throw" && move.t / move.dur > 0.5);

  // the field of view: a little narrower aimed, and never letting a tall screen crop the gun
  vCam.aspect = aspect;
  vCam.fov = vmFov(aspect) / Math.max(1, zoom * 0.25 + 0.75);
  vCam.updateProjectionMatrix();

  // the grapple: the launcher comes up in the left hand while the rope is out
  launcher.visible = V.hook > 0.05;
  if (launcher.visible) {
    launcher.position.copy(HOOK_HAND).add(tmp.set(-0.08, -0.18, 0.12).multiplyScalar(1 - V.hook));
    launcher.rotation.set(0.05, 0.08, 0.2 * (1 - V.hook));
  }

  // the arms: hands on the grip and the handguard (or the magazine, mid-reload)
  const R = armsFor(a);
  if (R) {
    R.root.visible = true;
    T.rHand.copy(util ? GRIP_WRIST_U : pistol ? GRIP_WRIST_P : GRIP_WRIST).applyQuaternion(q).add(holder.position).add(EYE);
    if (it.support) {
      tmp.copy(it.support);
      if (A.reloadT > 0 && g) {
        // the support hand goes for the magazine in the middle of the reload, and comes back with it
        const f = 1 - A.reloadT / g.reload, k = f < 0.2 ? f / 0.2 : f < 0.65 ? 1 : Math.max(0, 1 - (f - 0.65) / 0.2);
        tmp.lerp(new THREE.Vector3(0, -0.12, it.support.z * 0.4), Math.sin(k * Math.PI / 2));
      }
      T.lHand.copy(tmp).add(pistol ? SUPPORT_WRIST_P : SUPPORT_WRIST).applyQuaternion(q).add(holder.position).add(EYE);
    } else if (blade && A.melee === "lancer") T.lHand.set(0, 0, -0.38).applyQuaternion(q).add(holder.position).add(EYE);
    else T.lHand.copy(LEFT_DOWN).add(EYE);
    // the left hand leaves whatever it held for the grapple
    if (V.hook > 0.05) T.lHand.lerp(tmp.copy(launcher.position).add(SUPPORT_WRIST).add(EYE), V.hook);
    if (away > 0.01) {
      // climbing, the hands go hand over hand; over a ledge, both are planted on it and push down as you rise
      const ph = performance.now() / 160;
      const cl = V.climb * (1 - V.mantle);
      const reach = mk > 0 ? -0.05 - 0.55 * Math.min(1, mk * 1.4) : 0;
      const lh = new THREE.Vector3(-0.24, 0.05 + reach + Math.sin(ph) * 0.12 * cl, -0.46).add(EYE);
      const rh = new THREE.Vector3(0.24, 0.05 + reach - Math.sin(ph) * 0.12 * cl, -0.46).add(EYE);
      T.lHand.lerp(lh, away); T.rHand.lerp(rh, away);
    }
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
    flash.scale.setScalar((g.id === "condor" || g.id === "cannon" ? 0.27 : g.scope || g.id === "mauler" ? 0.2 : pistol ? 0.1 : 0.13) * (0.85 + Math.random() * 0.4));
    fireLight.position.copy(flash.position);
    fireLight.intensity = 1.6;
  } else { flash.material.opacity = 0; fireLight.intensity = 0; }
  vmScoped = !!(g && g.scope && ads > 0.9);
  vmVisible = !vmScoped;
}

/** Where the grapple's rope leaves your hand, as a point in the world, for drawing the rope from it. */
const hk = new THREE.Vector3();
export function hookHandWorld(camera, out) {
  // the grappling gun in your hands: the rope leaves its muzzle
  if (S.me && grappleOut(S.me.arms)) return muzzleWorld(camera, out);
  if (!vmVisible || !launcher.visible) return null;
  hk.set(HOOK_HAND.x, HOOK_HAND.y, HOOK_HAND.z - 0.12).project(vCam);
  hk.z = tmp.set(0, 0, -0.6).applyMatrix4(camera.projectionMatrix).z;
  return out.copy(hk).unproject(camera);
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

/** Where the held gun's sight is on screen, in -1..1 (0, 0 is the centre), for tools/e2e.js. */
export function sightOnScreen() {
  if (!current || !current.sight || !holder.visible) return null;
  holder.updateMatrixWorld(true);
  const p = mz.copy(current.sight).applyMatrix4(current.obj.matrixWorld).project(vCam);
  return { x: p.x, y: p.y };
}
