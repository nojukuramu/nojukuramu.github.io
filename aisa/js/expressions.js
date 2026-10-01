/* ============================================================
   Aisa — expressions and motions

   An expression is a pose of the face held for as long as it is on:
   parameter values the controller blends towards (aisa.js). Her drawn face
   is the "neutral" one - a level, slightly stern stare - so neutral is
   empty. Head angles and gaze in an expression are added to wherever she
   is already looking rather than replacing it.

   A motion is a short performance: keyframed offsets added on top of
   whatever she is already doing, so a nod while smiling stays a smile.
   Keys are [seconds, value], and the curve runs smoothly *through* them
   (aisa.js) rather than stopping at each one, so a key placed before the
   big move is an anticipation and one after it is the follow-through.
   Every track starts and ends at 0.

   Both are plain data, so adding one is adding an entry here.
   ============================================================ */
var AISA = AISA || {};

AISA.expressions = {
  neutral: {},

  happy: {
    ParamEyeLSmile: 0.55, ParamEyeRSmile: 0.55, ParamEyeLAngle: -0.35, ParamEyeRAngle: -0.35,
    ParamBrowLY: 0.4, ParamBrowRY: 0.4, ParamBrowLAngle: -0.45, ParamBrowRAngle: -0.45,
    ParamMouthForm: 1, ParamMouthOpenY: 0.3, ParamCheek: 0.25, ParamAngleY: 2
  },

  joy: {
    ParamEyeLOpen: 0, ParamEyeROpen: 0, ParamEyeLSmile: 1, ParamEyeRSmile: 1,
    ParamEyeLAngle: -0.5, ParamEyeRAngle: -0.5, ParamBrowLY: 0.6, ParamBrowRY: 0.6,
    ParamBrowLAngle: -0.6, ParamBrowRAngle: -0.6,
    ParamMouthForm: 1, ParamMouthOpenY: 0.8, ParamCheek: 0.45, ParamAngleY: 5
  },

  sad: {
    ParamEyeLOpen: 0.72, ParamEyeROpen: 0.72, ParamEyeLAngle: -1, ParamEyeRAngle: -1,
    ParamBrowLAngle: -1, ParamBrowRAngle: -1, ParamBrowLY: 0.45, ParamBrowRY: 0.45,
    ParamMouthForm: -0.8, ParamEyeBallY: -0.45, ParamAngleY: -8
  },

  crying: {
    ParamEyeLOpen: 0.5, ParamEyeROpen: 0.5, ParamEyeLAngle: -1, ParamEyeRAngle: -1,
    ParamBrowLAngle: -1, ParamBrowRAngle: -1, ParamBrowLY: 0.6, ParamBrowRY: 0.6,
    ParamMouthForm: -1, ParamMouthOpenY: 0.35, ParamTear: 1, ParamCheek: 0.35,
    ParamEyeBallY: -0.3, ParamAngleY: -6
  },

  angry: {
    ParamEyeLOpen: 0.82, ParamEyeROpen: 0.82, ParamEyeLAngle: 1, ParamEyeRAngle: 1,
    ParamBrowLAngle: 1, ParamBrowRAngle: 1, ParamBrowLY: -0.8, ParamBrowRY: -0.8,
    ParamMouthForm: -0.9, ParamMouthOpenY: 0.12, ParamAnger: 1, ParamAngleY: -5
  },

  annoyed: {
    ParamEyeLOpen: 0.55, ParamEyeROpen: 0.55, ParamEyeLAngle: 0.6, ParamEyeRAngle: 0.6,
    ParamBrowLAngle: 0.7, ParamBrowRAngle: 0.7, ParamBrowLY: -0.4, ParamBrowRY: -0.4,
    ParamMouthForm: -0.6, ParamEyeBallX: -0.5, ParamAngleX: 6
  },

  surprised: {
    ParamEyeLOpen: 1.2, ParamEyeROpen: 1.2, ParamEyeLAngle: -0.4, ParamEyeRAngle: -0.4,
    ParamBrowLY: 1, ParamBrowRY: 1, ParamBrowLAngle: -0.5, ParamBrowRAngle: -0.5,
    ParamMouthForm: -0.1, ParamMouthOpenY: 0.65, ParamAngleY: 4
  },

  scared: {
    ParamEyeLOpen: 1.2, ParamEyeROpen: 1.2, ParamEyeLAngle: -0.8, ParamEyeRAngle: -0.8,
    ParamBrowLAngle: -1, ParamBrowRAngle: -1, ParamBrowLY: 0.8, ParamBrowRY: 0.8,
    ParamMouthForm: -0.7, ParamMouthOpenY: 0.35, ParamGloom: 1, ParamSweat: 1, ParamAngleY: -4,
    ParamEyeBallX: 0.25
  },

  shy: {
    ParamEyeLOpen: 0.78, ParamEyeROpen: 0.78, ParamEyeLAngle: -0.3, ParamEyeRAngle: -0.3,
    ParamBrowLAngle: -0.6, ParamBrowRAngle: -0.6, ParamBrowLY: 0.2, ParamBrowRY: 0.2,
    ParamEyeBallX: 0.7, ParamEyeBallY: -0.5,
    ParamMouthForm: 0.25, ParamCheek: 1, ParamSweat: 0.5,
    ParamAngleX: -9, ParamAngleY: -7, ParamAngleZ: -5
  },

  sleepy: {
    ParamEyeLOpen: 0.32, ParamEyeROpen: 0.28, ParamEyeLAngle: -0.3, ParamEyeRAngle: -0.3,
    ParamBrowLY: -0.3, ParamBrowRY: -0.3, ParamBrowLAngle: -0.3, ParamBrowRAngle: -0.3,
    ParamMouthOpenY: 0.12, ParamMouthForm: -0.1, ParamAngleZ: 8, ParamAngleY: -6
  },

  smug: {
    ParamEyeLOpen: 0.6, ParamEyeROpen: 0.8, ParamEyeLSmile: 0.3, ParamEyeRSmile: 0.15,
    ParamBrowLY: 0.6, ParamBrowRY: -0.3, ParamBrowLAngle: -0.4, ParamBrowRAngle: 0.5,
    ParamMouthForm: 0.75, ParamEyeBallX: -0.3, ParamAngleZ: -5, ParamAngleY: 4
  },

  pout: {
    ParamEyeLOpen: 0.85, ParamEyeROpen: 0.85, ParamEyeLAngle: 0.5, ParamEyeRAngle: 0.5,
    ParamBrowLAngle: 0.5, ParamBrowRAngle: 0.5, ParamBrowLY: -0.2, ParamBrowRY: -0.2,
    ParamMouthForm: -0.55, ParamCheek: 0.55, ParamEyeBallX: 0.4, ParamAngleZ: 6
  },

  confused: {
    ParamEyeLOpen: 1.05, ParamEyeROpen: 0.8, ParamBrowLY: 0.8, ParamBrowRY: -0.4,
    ParamBrowLAngle: -0.7, ParamBrowRAngle: 0.6, ParamMouthForm: -0.35, ParamMouthOpenY: 0.06,
    ParamSweat: 0.8, ParamAngleZ: 12
  },

  thinking: {
    ParamEyeLOpen: 0.9, ParamEyeROpen: 0.82, ParamEyeBallX: -0.65, ParamEyeBallY: 0.75,
    ParamBrowLY: 0.5, ParamBrowRY: -0.1, ParamBrowLAngle: -0.4, ParamBrowRAngle: 0.2,
    ParamMouthForm: -0.3, ParamAngleX: -6, ParamAngleY: 5, ParamAngleZ: 7
  },

  determined: {
    ParamEyeLOpen: 1.05, ParamEyeROpen: 1.05, ParamEyeLAngle: 0.35, ParamEyeRAngle: 0.35,
    ParamBrowLAngle: 0.7, ParamBrowRAngle: 0.7, ParamBrowLY: -0.3, ParamBrowRY: -0.3,
    ParamMouthForm: 0.2, ParamAngleY: -3
  },

  wink: {
    ParamEyeLOpen: 0, ParamEyeLSmile: 1, ParamBrowLY: -0.2, ParamBrowRY: 0.5,
    ParamBrowRAngle: -0.4, ParamMouthForm: 0.9, ParamMouthOpenY: 0.2, ParamCheek: 0.2, ParamAngleZ: -6
  }
};

AISA.motions = {
  nod: {
    ParamAngleY: [[0, 0], [0.12, 3], [0.32, -13], [0.5, 2], [0.68, -6], [0.9, 0]],
    ParamBodyAngleY: [[0, 0], [0.32, -2], [0.7, -0.5], [0.9, 0]],
    ParamEyeLOpen: [[0, 0], [0.3, -0.25], [0.55, 0], [0.9, 0]],
    ParamEyeROpen: [[0, 0], [0.3, -0.25], [0.55, 0], [0.9, 0]]
  },

  shake: {
    ParamAngleX: [[0, 0], [0.14, -15], [0.38, 14], [0.6, -11], [0.8, 7], [1.0, -2], [1.15, 0]],
    ParamAngleZ: [[0, 0], [0.14, 2], [0.38, -2], [0.6, 1.5], [0.8, -1], [1.15, 0]],
    ParamBodyAngleX: [[0, 0], [0.38, 2], [0.8, -1], [1.15, 0]],
    ParamEyeLOpen: [[0, 0], [0.2, -0.2], [0.9, -0.2], [1.15, 0]],
    ParamEyeROpen: [[0, 0], [0.2, -0.2], [0.9, -0.2], [1.15, 0]]
  },

  tilt: {
    ParamAngleZ: [[0, 0], [0.35, 15], [0.5, 13], [1.6, 13], [2.0, 0]],
    ParamAngleX: [[0, 0], [0.35, 4], [1.6, 4], [2.0, 0]],
    ParamEyeBallX: [[0, 0], [0.3, 0.3], [1.6, 0.3], [2.0, 0]],
    ParamBrowLY: [[0, 0], [0.35, 0.4], [1.6, 0.4], [2.0, 0]]
  },

  wave: {
    // a chibi arm is short: raised any higher, the hand waves in front of
    // her face instead of beside it
    ParamArmRA: [[0, 0], [0.1, -6], [0.4, 108], [0.5, 104], [2.6, 104], [2.9, -4], [3.1, 0]],
    ParamArmRB: [[0, 0], [0.4, 40], [0.62, 18], [0.86, 64], [1.1, 18], [1.34, 64], [1.58, 18],
                 [1.82, 64], [2.06, 18], [2.3, 50], [2.6, 45], [2.9, 4], [3.1, 0]],
    ParamHandR: [[0, 0], [0.4, 8], [0.62, -12], [0.86, 20], [1.1, -12], [1.34, 20], [1.58, -12],
                 [1.82, 20], [2.06, -12], [2.3, 10], [2.9, 0], [3.1, 0]],
    ParamAngleZ: [[0, 0], [0.45, -6], [2.6, -6], [3.0, 0]],
    ParamAngleX: [[0, 0], [0.5, -4], [2.6, -4], [3.0, 0]],
    ParamBodyAngleZ: [[0, 0], [0.45, -3], [2.6, -3], [3.0, 0]],
    ParamMouthForm: [[0, 0], [0.4, 0.5], [2.6, 0.5], [3.0, 0]]
  },

  bow: {
    ParamAngleY: [[0, 0], [0.15, 3], [0.6, -22], [1.4, -22], [1.85, 2], [2.1, 0]],
    ParamBodyAngleY: [[0, 0], [0.6, -9], [1.4, -9], [1.9, 0.5], [2.1, 0]],
    ParamEyeLOpen: [[0, 0], [0.5, -0.85], [1.45, -0.85], [1.9, 0], [2.1, 0]],
    ParamEyeROpen: [[0, 0], [0.5, -0.85], [1.45, -0.85], [1.9, 0], [2.1, 0]],
    ParamArmRA: [[0, 0], [0.6, -12], [1.4, -12], [2.0, 0]],
    ParamArmLA: [[0, 0], [0.6, -12], [1.4, -12], [2.0, 0]],
    ParamArmRB: [[0, 0], [0.6, -25], [1.4, -25], [2.0, 0]],
    ParamArmLB: [[0, 0], [0.6, -25], [1.4, -25], [2.0, 0]]
  },

  hop: {
    // crouch, spring, hang, land soft
    ParamBodyY: [[0, 0], [0.14, -4], [0.36, 18], [0.52, 4], [0.62, -3], [0.78, 0.6], [0.9, 0]],
    ParamAngleY: [[0, 0], [0.14, -4], [0.36, 5], [0.62, -3], [0.9, 0]],
    ParamArmRA: [[0, 0], [0.14, -10], [0.36, 30], [0.6, -4], [0.9, 0]],
    ParamArmLA: [[0, 0], [0.14, -10], [0.36, 30], [0.6, -4], [0.9, 0]],
    ParamLegR: [[0, 0], [0.3, 7], [0.5, 2], [0.62, 0]],
    ParamLegL: [[0, 0], [0.3, 7], [0.5, 2], [0.62, 0]],
    ParamEyeLOpen: [[0, 0], [0.6, -0.3], [0.8, 0]],
    ParamEyeROpen: [[0, 0], [0.6, -0.3], [0.8, 0]]
  },

  cheer: {
    ParamArmRA: [[0, 0], [0.12, -8], [0.35, 115], [0.55, 106], [0.75, 120], [0.95, 108], [1.6, 115], [1.9, -4], [2.1, 0]],
    ParamArmLA: [[0, 0], [0.12, -8], [0.35, 115], [0.55, 106], [0.75, 120], [0.95, 108], [1.6, 115], [1.9, -4], [2.1, 0]],
    ParamArmRB: [[0, 0], [0.35, 45], [1.6, 45], [2.0, 0]],
    ParamArmLB: [[0, 0], [0.35, 45], [1.6, 45], [2.0, 0]],
    ParamBodyY: [[0, 0], [0.12, -3], [0.35, 8], [0.55, 0], [0.75, 8], [0.95, 0], [2.1, 0]],
    ParamMouthForm: [[0, 0], [0.3, 0.8], [1.6, 0.8], [2.0, 0]],
    ParamMouthOpenY: [[0, 0], [0.3, 0.6], [1.6, 0.6], [2.0, 0]],
    ParamEyeLSmile: [[0, 0], [0.3, 0.8], [1.6, 0.8], [2.0, 0]],
    ParamEyeRSmile: [[0, 0], [0.3, 0.8], [1.6, 0.8], [2.0, 0]]
  },

  shrug: {
    ParamArmRA: [[0, 0], [0.35, 25], [1.3, 25], [1.7, 0]],
    ParamArmLA: [[0, 0], [0.35, 25], [1.3, 25], [1.7, 0]],
    ParamArmRB: [[0, 0], [0.35, 70], [1.3, 70], [1.7, 0]],
    ParamArmLB: [[0, 0], [0.35, 70], [1.3, 70], [1.7, 0]],
    ParamHandR: [[0, 0], [0.35, 30], [1.3, 30], [1.7, 0]],
    ParamHandL: [[0, 0], [0.35, 30], [1.3, 30], [1.7, 0]],
    ParamBodyY: [[0, 0], [0.3, 2.5], [1.3, 2.5], [1.7, 0]],
    ParamAngleZ: [[0, 0], [0.35, 8], [1.3, 8], [1.7, 0]],
    ParamBrowLY: [[0, 0], [0.35, 0.6], [1.3, 0.6], [1.7, 0]],
    ParamBrowRY: [[0, 0], [0.35, 0.6], [1.3, 0.6], [1.7, 0]],
    ParamEyeLOpen: [[0, 0], [0.35, -0.3], [1.3, -0.3], [1.7, 0]],
    ParamEyeROpen: [[0, 0], [0.35, -0.3], [1.3, -0.3], [1.7, 0]],
    ParamMouthForm: [[0, 0], [0.35, -0.3], [1.3, -0.3], [1.7, 0]]
  },

  lookAround: {
    // the eyes go first and the head follows them
    ParamEyeBallX: [[0, 0], [0.3, -0.9], [1.3, -0.8], [1.6, 0.9], [2.7, 0.8], [3.1, 0], [3.3, 0]],
    ParamAngleX: [[0, 0], [0.6, -20], [1.4, -20], [2.0, 18], [2.8, 18], [3.3, 0]],
    ParamAngleZ: [[0, 0], [0.6, 3], [1.4, 3], [2.0, -3], [2.8, -3], [3.3, 0]],
    ParamBodyAngleX: [[0, 0], [0.7, -3], [1.4, -3], [2.1, 3], [2.8, 3], [3.3, 0]]
  },

  sigh: {
    ParamBreath: [[0, 0], [0.7, 0.7], [1.5, -0.5], [2.3, 0]],
    ParamAngleY: [[0, 0], [0.7, 5], [1.5, -9], [2.3, 0]],
    ParamArmRA: [[0, 0], [0.7, 4], [1.5, -3], [2.3, 0]],
    ParamArmLA: [[0, 0], [0.7, 4], [1.5, -3], [2.3, 0]],
    ParamEyeLOpen: [[0, 0], [0.7, 0], [1.0, -0.6], [1.8, -0.6], [2.3, 0]],
    ParamEyeROpen: [[0, 0], [0.7, 0], [1.0, -0.6], [1.8, -0.6], [2.3, 0]],
    ParamMouthOpenY: [[0, 0], [0.9, 0.3], [1.5, 0.05], [2.3, 0]]
  },

  laugh: {
    ParamAngleY: [[0, 0], [0.15, 6], [0.3, 3], [0.45, 6], [0.6, 3], [0.75, 6], [0.9, 3], [1.2, 2], [1.5, 0]],
    ParamBodyY: [[0, 0], [0.15, 1.5], [0.3, 0], [0.45, 1.5], [0.6, 0], [0.75, 1.5], [0.9, 0], [1.5, 0]],
    ParamAngleZ: [[0, 0], [0.3, -4], [1.2, -4], [1.5, 0]],
    ParamEyeLSmile: [[0, 0], [0.15, 1], [1.2, 1], [1.5, 0]],
    ParamEyeRSmile: [[0, 0], [0.15, 1], [1.2, 1], [1.5, 0]],
    ParamEyeLOpen: [[0, 0], [0.15, -1], [1.2, -1], [1.5, 0]],
    ParamEyeROpen: [[0, 0], [0.15, -1], [1.2, -1], [1.5, 0]],
    ParamMouthForm: [[0, 0], [0.15, 1], [1.2, 1], [1.5, 0]],
    ParamMouthOpenY: [[0, 0], [0.15, 0.8], [0.3, 0.5], [0.45, 0.8], [0.6, 0.5], [0.75, 0.8], [0.9, 0.5], [1.2, 0.3], [1.5, 0]],
    ParamCheek: [[0, 0], [0.2, 0.4], [1.2, 0.4], [1.5, 0]]
  },

  jolt: {
    // startled: a small jump, eyes wide, arms flinch up, then settle
    ParamBodyY: [[0, 0], [0.08, 6], [0.25, 1], [0.6, 0]],
    ParamAngleY: [[0, 0], [0.08, 5], [0.3, -2], [0.6, 0]],
    ParamArmRA: [[0, 0], [0.08, 22], [0.25, 14], [0.9, 0]],
    ParamArmLA: [[0, 0], [0.08, 22], [0.25, 14], [0.9, 0]],
    ParamArmRB: [[0, 0], [0.08, 30], [0.9, 0]],
    ParamArmLB: [[0, 0], [0.08, 30], [0.9, 0]],
    ParamEyeLOpen: [[0, 0], [0.06, 0.25], [0.7, 0.2], [1.0, 0]],
    ParamEyeROpen: [[0, 0], [0.06, 0.25], [0.7, 0.2], [1.0, 0]],
    ParamBrowLY: [[0, 0], [0.06, 0.9], [0.7, 0.6], [1.0, 0]],
    ParamBrowRY: [[0, 0], [0.06, 0.9], [0.7, 0.6], [1.0, 0]],
    ParamMouthOpenY: [[0, 0], [0.08, 0.4], [0.6, 0.2], [1.0, 0]]
  },

  sway: {
    loop: true,
    ParamAngleZ: [[0, 0], [0.6, 7], [1.8, -7], [2.4, 0]],
    ParamBodyAngleZ: [[0, 0], [0.6, 5], [1.8, -5], [2.4, 0]],
    ParamBodyAngleX: [[0, 0], [0.6, -3], [1.8, 3], [2.4, 0]],
    ParamArmRA: [[0, 0], [0.6, 12], [1.8, 4], [2.4, 0]],
    ParamArmLA: [[0, 0], [0.6, 4], [1.8, 12], [2.4, 0]]
  }
};

/* Pendulums behind the hair and the skirt. Each one hangs from an anchor
   that moves with the head and body (`in`: parameter weights); the part is
   displaced by how far the bob lags behind it, so hair trails a turn and
   swings past when the head stops. `hang` keeps hair hanging down when the
   head tilts. hz is how fast it swings, damp how soon it settles: the long
   back hair and the ponytail are slow and loose, the ahoge quick and
   springy. */
AISA.physics = [
  { out: "ParamHairFront", hz: 2.6, damp: 0.25, gain: 1.4,
    in: { ParamAngleX: 0.035, ParamAngleZ: 0.02, ParamBodyAngleX: 0.05, ParamBodyY: 0.015 }, hang: {} },
  { out: "ParamHairSide", hz: 1.8, damp: 0.18, gain: 1.6,
    in: { ParamAngleX: 0.04, ParamAngleZ: 0.03, ParamBodyAngleX: 0.06, ParamBodyAngleZ: 0.04, ParamBodyY: 0.02 },
    hang: { ParamAngleZ: 0.012, ParamBodyAngleZ: 0.02 } },
  { out: "ParamHairBack", hz: 1.3, damp: 0.15, gain: 1.6,
    in: { ParamAngleX: 0.03, ParamAngleZ: 0.03, ParamBodyAngleX: 0.07, ParamBodyAngleZ: 0.05, ParamBodyY: 0.02 },
    hang: { ParamBodyAngleZ: 0.03 } },
  { out: "ParamHairTail", hz: 1.1, damp: 0.12, gain: 1.8,
    in: { ParamAngleX: 0.03, ParamAngleZ: 0.04, ParamBodyAngleX: 0.05, ParamBodyAngleZ: 0.05, ParamBodyY: 0.03 },
    hang: { ParamAngleZ: 0.02, ParamBodyAngleZ: 0.03 } },
  { out: "ParamAhoge", hz: 3.2, damp: 0.1, gain: 1.6,
    in: { ParamAngleX: 0.05, ParamAngleY: 0.04, ParamAngleZ: 0.05, ParamBodyY: 0.06 }, hang: {} },
  { out: "ParamSkirt", hz: 2.0, damp: 0.2, gain: 1.4,
    in: { ParamBodyAngleX: 0.06, ParamBodyAngleZ: 0.06, ParamBodyY: 0.03, ParamLegR: -0.02, ParamLegL: 0.02 },
    hang: {} }
];
