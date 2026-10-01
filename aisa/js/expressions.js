/* ============================================================
   Aisa — expressions and motions

   An expression is a pose of the face held for as long as it is on:
   parameter values the controller blends towards (aisa.js). Her drawn face
   is the "neutral" one - flat brows, a level stare - so neutral is empty.

   A motion is a short performance: keyframed offsets added on top of
   whatever she is already doing, so a nod while smiling stays a smile.
   Keys are [seconds, value]; the curve between two keys is eased.

   Both are plain data, so adding one is adding an entry here.
   ============================================================ */
var AISA = AISA || {};

AISA.expressions = {
  neutral: {},

  happy: {
    ParamEyeLSmile: 0.55, ParamEyeRSmile: 0.55, ParamEyeLAngle: -0.35, ParamEyeRAngle: -0.35,
    ParamBrowLY: 0.35, ParamBrowRY: 0.35, ParamMouthForm: 1, ParamMouthOpenY: 0.3, ParamCheek: 0.25
  },

  joy: {
    ParamEyeLOpen: 0, ParamEyeROpen: 0, ParamEyeLSmile: 1, ParamEyeRSmile: 1,
    ParamEyeLAngle: -0.5, ParamEyeRAngle: -0.5, ParamBrowLY: 0.5, ParamBrowRY: 0.5,
    ParamMouthForm: 1, ParamMouthOpenY: 0.75, ParamCheek: 0.45, ParamAngleY: 4
  },

  sad: {
    ParamEyeLOpen: 0.7, ParamEyeROpen: 0.7, ParamEyeLAngle: -1, ParamEyeRAngle: -1,
    ParamBrowLAngle: -1, ParamBrowRAngle: -1, ParamBrowLY: 0.2, ParamBrowRY: 0.2,
    ParamMouthForm: -0.8, ParamEyeBallY: -0.45, ParamAngleY: -8
  },

  crying: {
    ParamEyeLOpen: 0.5, ParamEyeROpen: 0.5, ParamEyeLAngle: -1, ParamEyeRAngle: -1,
    ParamBrowLAngle: -1, ParamBrowRAngle: -1, ParamBrowLY: 0.4, ParamBrowRY: 0.4,
    ParamMouthForm: -1, ParamMouthOpenY: 0.3, ParamTear: 1, ParamCheek: 0.35,
    ParamEyeBallY: -0.3, ParamAngleY: -6
  },

  angry: {
    ParamEyeLOpen: 0.8, ParamEyeROpen: 0.8, ParamEyeLAngle: 1, ParamEyeRAngle: 1,
    ParamBrowLAngle: 1, ParamBrowRAngle: 1, ParamBrowLY: -0.7, ParamBrowRY: -0.7,
    ParamMouthForm: -0.9, ParamMouthOpenY: 0.12, ParamAnger: 1, ParamAngleY: -5
  },

  annoyed: {
    ParamEyeLOpen: 0.55, ParamEyeROpen: 0.55, ParamEyeLAngle: 0.6, ParamEyeRAngle: 0.6,
    ParamBrowLAngle: 0.7, ParamBrowRAngle: 0.7, ParamBrowLY: -0.4, ParamBrowRY: -0.4,
    ParamMouthForm: -0.6, ParamEyeBallX: -0.5, ParamAngleX: 6
  },

  surprised: {
    ParamEyeLOpen: 1.2, ParamEyeROpen: 1.2, ParamEyeLAngle: -0.4, ParamEyeRAngle: -0.4,
    ParamBrowLY: 1, ParamBrowRY: 1, ParamBrowLAngle: -0.4, ParamBrowRAngle: -0.4,
    ParamMouthForm: -0.1, ParamMouthOpenY: 0.65, ParamAngleY: 4
  },

  scared: {
    ParamEyeLOpen: 1.2, ParamEyeROpen: 1.2, ParamEyeLAngle: -0.8, ParamEyeRAngle: -0.8,
    ParamBrowLAngle: -1, ParamBrowRAngle: -1, ParamBrowLY: 0.7, ParamBrowRY: 0.7,
    ParamMouthForm: -0.7, ParamMouthOpenY: 0.35, ParamGloom: 1, ParamSweat: 1, ParamAngleY: -4
  },

  shy: {
    ParamEyeLOpen: 0.78, ParamEyeROpen: 0.78, ParamEyeLAngle: -0.3, ParamEyeRAngle: -0.3,
    ParamBrowLAngle: -0.5, ParamBrowRAngle: -0.5, ParamEyeBallX: 0.7, ParamEyeBallY: -0.5,
    ParamMouthForm: 0.25, ParamCheek: 1, ParamSweat: 0.5,
    ParamAngleX: -9, ParamAngleY: -7, ParamAngleZ: -5
  },

  sleepy: {
    ParamEyeLOpen: 0.32, ParamEyeROpen: 0.3, ParamEyeLAngle: -0.3, ParamEyeRAngle: -0.3,
    ParamBrowLY: -0.3, ParamBrowRY: -0.3, ParamMouthOpenY: 0.12, ParamMouthForm: -0.1,
    ParamAngleZ: 8, ParamAngleY: -6
  },

  smug: {
    ParamEyeLOpen: 0.62, ParamEyeROpen: 0.78, ParamEyeLSmile: 0.3, ParamEyeRSmile: 0.2,
    ParamBrowLY: 0.5, ParamBrowRY: -0.2, ParamBrowRAngle: 0.4, ParamMouthForm: 0.75,
    ParamEyeBallX: -0.3, ParamAngleZ: -5, ParamAngleY: 4
  },

  pout: {
    ParamEyeLOpen: 0.85, ParamEyeROpen: 0.85, ParamEyeLAngle: 0.5, ParamEyeRAngle: 0.5,
    ParamBrowLAngle: 0.4, ParamBrowRAngle: 0.4, ParamMouthForm: -0.55, ParamCheek: 0.55,
    ParamEyeBallX: 0.4, ParamAngleZ: 6
  },

  confused: {
    ParamEyeLOpen: 1.05, ParamEyeROpen: 0.8, ParamBrowLY: 0.7, ParamBrowRY: -0.4,
    ParamBrowLAngle: -0.6, ParamBrowRAngle: 0.5, ParamMouthForm: -0.35, ParamMouthOpenY: 0.06,
    ParamSweat: 0.8, ParamAngleZ: 12
  },

  wink: {
    ParamEyeLOpen: 0, ParamEyeLSmile: 1, ParamBrowLY: -0.2, ParamBrowRY: 0.4,
    ParamMouthForm: 0.9, ParamMouthOpenY: 0.2, ParamCheek: 0.2, ParamAngleZ: -6
  }
};

AISA.motions = {
  nod: {
    ParamAngleY: [[0, 0], [0.18, -14], [0.4, 4], [0.6, -8], [0.85, 0]],
    ParamBodyAngleY: [[0, 0], [0.2, -2], [0.6, -1], [0.85, 0]]
  },

  shake: {
    ParamAngleX: [[0, 0], [0.15, -16], [0.4, 16], [0.65, -12], [0.9, 8], [1.1, 0]],
    ParamBodyAngleX: [[0, 0], [0.4, 2], [0.9, -1], [1.1, 0]]
  },

  tilt: {
    ParamAngleZ: [[0, 0], [0.4, 14], [1.6, 14], [2.0, 0]],
    ParamEyeBallX: [[0, 0], [0.4, 0.3], [1.6, 0.3], [2.0, 0]]
  },

  wave: {
    // a chibi arm is short: raised any higher, the hand waves in front of
    // her face instead of beside it
    ParamArmRA: [[0, 0], [0.35, 105], [2.65, 105], [3.0, 0]],
    ParamArmRB: [[0, 0], [0.35, 45], [0.6, 22], [0.85, 68], [1.1, 22], [1.35, 68], [1.6, 22],
                 [1.85, 68], [2.1, 22], [2.35, 45], [2.65, 45], [3.0, 0]],
    ParamHandR: [[0, 0], [0.35, 10], [2.65, 10], [3.0, 0]],
    ParamAngleZ: [[0, 0], [0.4, -6], [2.6, -6], [3.0, 0]],
    ParamBodyAngleZ: [[0, 0], [0.4, -3], [2.6, -3], [3.0, 0]]
  },

  bow: {
    ParamAngleY: [[0, 0], [0.5, -20], [1.3, -20], [1.8, 0]],
    ParamBodyAngleY: [[0, 0], [0.5, -8], [1.3, -8], [1.8, 0]],
    ParamEyeLOpen: [[0, 0], [0.5, -0.8], [1.3, -0.8], [1.8, 0]],
    ParamEyeROpen: [[0, 0], [0.5, -0.8], [1.3, -0.8], [1.8, 0]]
  },

  hop: {
    ParamBodyY: [[0, 0], [0.12, -3], [0.35, 16], [0.55, 0], [0.65, -2], [0.8, 0]],
    ParamArmRA: [[0, 0], [0.35, 18], [0.6, 0]],
    ParamArmLA: [[0, 0], [0.35, 18], [0.6, 0]],
    ParamLegR: [[0, 0], [0.35, 8], [0.55, 0]],
    ParamLegL: [[0, 0], [0.35, 8], [0.55, 0]]
  },

  cheer: {
    ParamArmRA: [[0, 0], [0.3, 115], [1.6, 115], [2.0, 0]],
    ParamArmLA: [[0, 0], [0.3, 115], [1.6, 115], [2.0, 0]],
    ParamArmRB: [[0, 0], [0.3, 45], [1.6, 45], [2.0, 0]],
    ParamArmLB: [[0, 0], [0.3, 45], [1.6, 45], [2.0, 0]],
    ParamBodyY: [[0, 0], [0.3, 8], [0.5, 0], [0.8, 8], [1.0, 0]]
  },

  shrug: {
    ParamArmRA: [[0, 0], [0.35, 25], [1.3, 25], [1.7, 0]],
    ParamArmLA: [[0, 0], [0.35, 25], [1.3, 25], [1.7, 0]],
    ParamArmRB: [[0, 0], [0.35, 70], [1.3, 70], [1.7, 0]],
    ParamArmLB: [[0, 0], [0.35, 70], [1.3, 70], [1.7, 0]],
    ParamHandR: [[0, 0], [0.35, 30], [1.3, 30], [1.7, 0]],
    ParamHandL: [[0, 0], [0.35, 30], [1.3, 30], [1.7, 0]],
    ParamAngleZ: [[0, 0], [0.35, 8], [1.3, 8], [1.7, 0]],
    ParamBrowLY: [[0, 0], [0.35, 0.6], [1.3, 0.6], [1.7, 0]],
    ParamBrowRY: [[0, 0], [0.35, 0.6], [1.3, 0.6], [1.7, 0]]
  },

  lookAround: {
    ParamAngleX: [[0, 0], [0.6, -20], [1.4, -20], [2.0, 18], [2.8, 18], [3.3, 0]],
    ParamEyeBallX: [[0, 0], [0.5, -0.8], [1.4, -0.8], [1.9, 0.8], [2.8, 0.8], [3.3, 0]],
    ParamBodyAngleX: [[0, 0], [0.6, -3], [1.4, -3], [2.0, 3], [2.8, 3], [3.3, 0]]
  },

  sigh: {
    ParamAngleY: [[0, 0], [0.6, 6], [1.4, -8], [2.2, 0]],
    ParamEyeLOpen: [[0, 0], [0.6, 0], [1.0, -0.6], [1.8, -0.6], [2.2, 0]],
    ParamEyeROpen: [[0, 0], [0.6, 0], [1.0, -0.6], [1.8, -0.6], [2.2, 0]],
    ParamBreath: [[0, 0], [0.6, 0.6], [1.4, -0.4], [2.2, 0]],
    ParamMouthOpenY: [[0, 0], [0.9, 0.3], [1.5, 0.05], [2.2, 0]]
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
   head tilts. hz is how fast it swings, damp how soon it settles. */
AISA.physics = [
  { out: "ParamHairFront", hz: 2.6, damp: 0.25, gain: 1.4,
    in: { ParamAngleX: 0.035, ParamAngleZ: 0.02, ParamBodyAngleX: 0.05 }, hang: {} },
  { out: "ParamHairSide", hz: 1.8, damp: 0.18, gain: 1.6,
    in: { ParamAngleX: 0.04, ParamAngleZ: 0.03, ParamBodyAngleX: 0.06, ParamBodyAngleZ: 0.04 },
    hang: { ParamAngleZ: 0.012, ParamBodyAngleZ: 0.02 } },
  { out: "ParamHairBack", hz: 1.3, damp: 0.15, gain: 1.6,
    in: { ParamAngleX: 0.03, ParamAngleZ: 0.03, ParamBodyAngleX: 0.07, ParamBodyAngleZ: 0.05 },
    hang: { ParamBodyAngleZ: 0.03 } },
  { out: "ParamHairTail", hz: 1.1, damp: 0.12, gain: 1.8,
    in: { ParamAngleX: 0.03, ParamAngleZ: 0.04, ParamBodyAngleX: 0.05, ParamBodyAngleZ: 0.05, ParamBodyY: 0.02 },
    hang: { ParamAngleZ: 0.02, ParamBodyAngleZ: 0.03 } },
  { out: "ParamAhoge", hz: 3.2, damp: 0.12, gain: 1.6,
    in: { ParamAngleX: 0.05, ParamAngleY: 0.04, ParamAngleZ: 0.05, ParamBodyY: 0.05 }, hang: {} },
  { out: "ParamSkirt", hz: 2.0, damp: 0.2, gain: 1.4,
    in: { ParamBodyAngleX: 0.06, ParamBodyAngleZ: 0.06, ParamBodyY: 0.03, ParamLegR: -0.02, ParamLegL: 0.02 },
    hang: {} }
];
