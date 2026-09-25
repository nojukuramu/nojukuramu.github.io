/* skeleton.js — seventeen bones, where they are, and what a bullet hits.
 *
 * Every body in the game is posed from its movement state alone: where it is,
 * which way it faces and aims, how fast it is going and whether it is
 * crouched, sliding, climbing, in the air or lunging. No animation files, no
 * network traffic for limbs — every screen poses a body the same way from the
 * same few numbers, so the bones a hack reads, the limbs the renderer draws
 * and the hitboxes a shot is tested against are one set of points.
 *
 * Legs and arms are two-bone chains solved analytically (the knee or elbow
 * goes where the two lengths meet, bent the way a knee or elbow bends).
 *
 * Pure. Exported to the hack worker too, as the documented list of bones and
 * the pairs that make a stick figure — the "bone ESP" lesson draws LINKS. */

export const BONES = [
  "pelvis", "spine", "chest", "neck", "head",
  "l_shoulder", "l_elbow", "l_hand", "r_shoulder", "r_elbow", "r_hand",
  "l_hip", "l_knee", "l_foot", "r_hip", "r_knee", "r_foot"
];
export const BI = Object.fromEntries(BONES.map((b, i) => [b, i]));

/** Pairs of bones that make the stick figure. */
export const LINKS = [
  ["pelvis", "spine"], ["spine", "chest"], ["chest", "neck"], ["neck", "head"],
  ["chest", "l_shoulder"], ["l_shoulder", "l_elbow"], ["l_elbow", "l_hand"],
  ["chest", "r_shoulder"], ["r_shoulder", "r_elbow"], ["r_elbow", "r_hand"],
  ["pelvis", "l_hip"], ["l_hip", "l_knee"], ["l_knee", "l_foot"],
  ["pelvis", "r_hip"], ["r_hip", "r_knee"], ["r_knee", "r_foot"]
];

/** Hitboxes: capsules between two bones (the same bone twice is a sphere). */
export const HITBOXES = [
  { a: "head", b: "head", r: 0.15, part: "head" },
  { a: "neck", b: "neck", r: 0.09, part: "body" },
  { a: "chest", b: "pelvis", r: 0.2, part: "body" },
  { a: "l_shoulder", b: "l_elbow", r: 0.075, part: "arm" },
  { a: "l_elbow", b: "l_hand", r: 0.065, part: "arm" },
  { a: "r_shoulder", b: "r_elbow", r: 0.075, part: "arm" },
  { a: "r_elbow", b: "r_hand", r: 0.065, part: "arm" },
  { a: "l_hip", b: "l_knee", r: 0.1, part: "leg" },
  { a: "l_knee", b: "l_foot", r: 0.085, part: "leg" },
  { a: "r_hip", b: "r_knee", r: 0.1, part: "leg" },
  { a: "r_knee", b: "r_foot", r: 0.085, part: "leg" }
].map((h) => Object.assign(h, { ai: BI[h.a], bi: BI[h.b] }));

const THIGH = 0.46, SHIN = 0.46, UPPER = 0.29, FORE = 0.28;

/* ---------------------------------------------------------------
   Posing
   --------------------------------------------------------------- */
/* A tiny local frame: x right, y up, z back (forward is -z). */
function rotX(v, a) { const c = Math.cos(a), s = Math.sin(a); return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c]; }
function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function subv(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function scale(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }
function len(a) { return Math.hypot(a[0], a[1], a[2]); }

/* Two-bone IK: where the middle joint goes, bent towards `hint`. */
function joint(root, target, l1, l2, hint) {
  let d = subv(target, root);
  let dl = len(d);
  const max = l1 + l2 - 0.001;
  if (dl > max) { d = scale(d, max / dl); target = add(root, d); dl = max; }
  if (dl < 0.02) return add(root, scale(hint, l1));
  const ax = scale(d, 1 / dl);
  // along the axis to the foot of the perpendicular, then out along the bend
  const a = (l1 * l1 - l2 * l2 + dl * dl) / (2 * dl);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  let bend = subv(hint, scale(ax, hint[0] * ax[0] + hint[1] * ax[1] + hint[2] * ax[2]));
  const bl = len(bend) || 1;
  bend = scale(bend, 1 / bl);
  return add(add(root, scale(ax, a)), scale(bend, h));
}

/**
 * Pose a body. `s` is anything with x, y, z, yaw, pitch, vx, vz, onGround,
 * crouched, sliding, climbing, lunge (0 idle, 1 charging, 2 dashing), eye,
 * and an animation phase `phase` (radians, advanced by whoever owns it).
 * `hold` is "rifle", "pistol", "melee" or "lance". Writes 17 × 3 numbers.
 */
export function pose(s, hold, out) {
  out = out || new Float32Array(BONES.length * 3);
  const yaw = s.yaw, cy = Math.cos(yaw), sy = Math.sin(yaw);
  // velocity in the body's own frame
  const vr = s.vx * cy - s.vz * sy;       // along right
  const vb = s.vx * sy + s.vz * cy;       // along back (+z local)
  const speed = Math.hypot(s.vx, s.vz);
  const amp = Math.min(1, speed / 6.5);
  const crouch = s.sliding ? 0 : Math.max(0, Math.min(1, (1.62 - (s.eye || 1.62)) / 0.6));
  const air = !s.onGround && !s.climbing;
  const ph = s.phase || 0;

  let pelvisY = 0.95 - crouch * 0.33 + (s.onGround ? Math.abs(Math.sin(ph)) * 0.04 * amp : 0);
  let lean = 0.08 * amp * (vb < 0 ? 1 : -0.5) + crouch * 0.25;
  if (s.sliding) { pelvisY = 0.42; lean = -0.35; }
  if (s.lunge === 1) { pelvisY = Math.min(pelvisY, 0.7); lean = 0.35; }
  if (s.lunge === 2) lean = 0.5;
  const pelvis = [0, pelvisY, 0];
  const up = (v) => add(pelvis, rotX(v, -lean));
  const spine = up([0, 0.24, 0]), chest = up([0, 0.46, 0]), neck = up([0, 0.62, 0]);
  const head = add(up([0, 0.76, 0]), [0, 0, -Math.sin(s.pitch || 0) * 0.04]);
  const lSh = up([-0.2, 0.52, 0]), rSh = up([0.2, 0.52, 0]);
  const lHip = [-0.11, pelvisY - 0.04, 0], rHip = [0.11, pelvisY - 0.04, 0];

  // feet
  let lF, rF;
  const dl = speed > 0.3 ? [vr / speed, vb / speed] : [0, 0];
  if (s.sliding) { lF = [-0.14, 0.1, -0.78]; rF = [0.14, 0.14, -0.15]; }
  else if (s.climbing) {
    const k = Math.sin(ph * 1.6);
    lF = [-0.14, pelvisY - 0.55 + k * 0.2, -0.28]; rF = [0.14, pelvisY - 0.55 - k * 0.2, -0.28];
  } else if (air) {
    lF = [-0.14, pelvisY - 0.72, -0.18]; rF = [0.14, pelvisY - 0.62, 0.2];
  } else {
    const st = 0.42 * amp, lift = 0.22 * amp;
    const a = Math.sin(ph), b = Math.sin(ph + Math.PI);
    lF = [-0.13 + dl[0] * a * st, 0.06 + Math.max(0, Math.cos(ph)) * lift, dl[1] * a * st - crouch * 0.12];
    rF = [0.13 + dl[0] * b * st, 0.06 + Math.max(0, Math.cos(ph + Math.PI)) * lift, dl[1] * b * st + crouch * 0.1];
  }
  const knee = [0, 0.2, -1];
  const lK = joint(lHip, lF, THIGH, SHIN, knee), rK = joint(rHip, rF, THIGH, SHIN, knee);

  // hands: on the gun, rotated with the aim about the shoulders
  // the aim is the eye's, whatever the torso is doing
  const shC = [0, lSh[1], lSh[2]];
  const aimAt = (v) => add(shC, rotX(v, s.pitch || 0));
  let lH, rH;
  if (s.climbing) {
    const k = Math.sin(ph * 1.6);
    lH = up([-0.22, 0.95 + k * 0.12, -0.32]); rH = up([0.22, 0.95 - k * 0.12, -0.32]);
  } else if (s.lunge === 2) {
    rH = aimAt([0.12, -0.02, -0.62]); lH = up([-0.3, 0.25, 0.1]);
  } else if (s.lunge === 1) {
    rH = up([0.28, 0.2, 0.18]); lH = up([-0.2, 0.3, -0.2]);
  } else if (hold === "pistol") {
    rH = aimAt([0.05, -0.02, -0.5]); lH = aimAt([-0.02, -0.05, -0.46]);
  } else if (hold === "melee" || hold === "lance") {
    rH = aimAt([0.22, -0.2, -0.32]); lH = aimAt([0.02, -0.24, -0.26]);
  } else {
    rH = aimAt([0.12, -0.07, -0.34]); lH = aimAt([-0.03, -0.04, -0.6]);
  }
  const lE = joint(lSh, lH, UPPER, FORE, [-0.6, -0.8, 0.2]), rE = joint(rSh, rH, UPPER, FORE, [0.6, -0.8, 0.2]);

  const local = [pelvis, spine, chest, neck, head, lSh, lE, lH, rSh, rE, rH, lHip, lK, lF, rHip, rK, rF];
  for (let i = 0; i < local.length; i++) {
    const v = local[i];
    out[i * 3] = s.x + v[0] * cy + v[2] * sy;
    out[i * 3 + 1] = s.y + v[1];
    out[i * 3 + 2] = s.z - v[0] * sy + v[2] * cy;
  }
  return out;
}

/** Advance a walk cycle by the ground covered. One stride is 1.25 m. */
export function stepPhase(phase, speed, dt, onGround) {
  return phase + (onGround ? speed : 2.5) * dt * Math.PI / 1.25;
}

/* ---------------------------------------------------------------
   What a ray hits
   --------------------------------------------------------------- */
/**
 * The first hitbox a ray from o along unit d meets within maxT, as
 * { t, part, box } or null. Closest points between the ray and each capsule's
 * axis; close enough to count, and the entry point backed off along the ray.
 */
export function rayBones(bones, ox, oy, oz, dx, dy, dz, maxT) {
  let best = null;
  for (const h of HITBOXES) {
    const ax = bones[h.ai * 3], ay = bones[h.ai * 3 + 1], az = bones[h.ai * 3 + 2];
    const ux = bones[h.bi * 3] - ax, uy = bones[h.bi * 3 + 1] - ay, uz = bones[h.bi * 3 + 2] - az;
    const wx = ox - ax, wy = oy - ay, wz = oz - az;
    const a = ux * ux + uy * uy + uz * uz;             // |u|²
    const b = ux * dx + uy * dy + uz * dz;             // u·d
    const c = wx * ux + wy * uy + wz * uz;             // w·u
    const e = wx * dx + wy * dy + wz * dz;             // w·d
    let t, sa;
    if (a < 1e-8) { sa = 0; t = -e; }
    else {
      const den = a - b * b;                          // |d|² = 1
      sa = den > 1e-8 ? (c - b * e) / den : 0;
      sa = Math.max(0, Math.min(1, sa));
      t = sa * b - e;
    }
    if (t < 0 || t > maxT) continue;
    const px = ox + dx * t - (ax + ux * sa), py = oy + dy * t - (ay + uy * sa), pz = oz + dz * t - (az + uz * sa);
    const d2 = px * px + py * py + pz * pz;
    if (d2 > h.r * h.r) continue;
    const te = Math.max(0, t - Math.sqrt(h.r * h.r - d2));
    if (!best || te < best.t) best = { t: te, part: h.part, box: h.a };
  }
  return best;
}

/** Bones as { name: {x, y, z} }, for the hack API. */
export function bonesObject(bones) {
  const o = {};
  for (let i = 0; i < BONES.length; i++) o[BONES[i]] = { x: +bones[i * 3].toFixed(3), y: +bones[i * 3 + 1].toFixed(3), z: +bones[i * 3 + 2].toFixed(3) };
  return o;
}
