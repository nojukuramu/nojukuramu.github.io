/* ============================================================
   Aisa — the model

   What every parameter does to which part. All coordinates are in pixels
   of the original 224x512 drawing (art/source.png); the atlas is the same
   picture at four times the size, so 1 here is 4 texels there.

   The deformers, outermost first, are the ones a Cubism rig would have:

     body     ParamBodyAngleX/Y/Z, ParamBreath, ParamBodyY - bends the torso
              about the hips; head, arms and hair ride on it
     head     ParamAngleZ rolls it about the neck; ParamAngleX/Y turn it,
              by moving every point sideways in proportion to how far in
              front of (or behind) the middle of the head it sits - the
              bangs further than the eyes, the eyes further than the cheek,
              the back hair the other way. That parallax is the whole trick
              that makes a flat drawing look like it turned.
     eyes     the lash comes down along a curve, the eyeball is clipped
              under it (rig.js), and a smile raises a lower edge instead
     arms     shoulder, elbow, wrist - each rotates everything beyond it,
              blended over a few pixels at the joint so the sleeve bends
              rather than tearing
     legs     a swing at each hip
     hair     sways from physics (motion.js), stiff at the root and loose
              at the tips

   Sides follow Cubism: L and R are Aisa's own left and right, so her
   left eye (ParamEyeLOpen) is the one on the right of the screen.
   ============================================================ */
var AISA = AISA || {};

AISA.model = (function () {
  "use strict";

  // ---- parameters: id, min, max, default, group, label -----------------
  var PARAMS = [
    ["ParamAngleX", -30, 30, 0, "Head", "Turn"],
    ["ParamAngleY", -30, 30, 0, "Head", "Nod"],
    ["ParamAngleZ", -30, 30, 0, "Head", "Tilt"],
    ["ParamEyeLOpen", 0, 1.2, 1, "Eyes", "Left open"],
    ["ParamEyeROpen", 0, 1.2, 1, "Eyes", "Right open"],
    ["ParamEyeLSmile", 0, 1, 0, "Eyes", "Left smile"],
    ["ParamEyeRSmile", 0, 1, 0, "Eyes", "Right smile"],
    ["ParamEyeLAngle", -1, 1, 0, "Eyes", "Left lid slant"],
    ["ParamEyeRAngle", -1, 1, 0, "Eyes", "Right lid slant"],
    ["ParamEyeBallX", -1, 1, 0, "Eyes", "Look x"],
    ["ParamEyeBallY", -1, 1, 0, "Eyes", "Look y"],
    ["ParamBrowLY", -1, 1, 0, "Brows", "Left height"],
    ["ParamBrowRY", -1, 1, 0, "Brows", "Right height"],
    ["ParamBrowLAngle", -1, 1, 0, "Brows", "Left slant"],
    ["ParamBrowRAngle", -1, 1, 0, "Brows", "Right slant"],
    ["ParamMouthForm", -1, 1, 0, "Mouth", "Form"],
    ["ParamMouthOpenY", 0, 1, 0, "Mouth", "Open"],
    ["ParamCheek", 0, 1, 0, "Face", "Blush"],
    ["ParamTear", 0, 1, 0, "Face", "Tears"],
    ["ParamSweat", 0, 1, 0, "Face", "Sweat"],
    ["ParamAnger", 0, 1, 0, "Face", "Anger mark"],
    ["ParamGloom", 0, 1, 0, "Face", "Gloom"],
    ["ParamBodyAngleX", -10, 10, 0, "Body", "Turn"],
    ["ParamBodyAngleY", -10, 10, 0, "Body", "Lean"],
    ["ParamBodyAngleZ", -10, 10, 0, "Body", "Tilt"],
    ["ParamBreath", 0, 1, 0, "Body", "Breath"],
    ["ParamBodyY", -30, 30, 0, "Body", "Lift"],
    ["ParamArmLA", -30, 180, 0, "Arms", "Left shoulder"],
    ["ParamArmLB", -120, 150, 0, "Arms", "Left elbow"],
    ["ParamHandL", -60, 60, 0, "Arms", "Left wrist"],
    ["ParamArmRA", -30, 180, 0, "Arms", "Right shoulder"],
    ["ParamArmRB", -120, 150, 0, "Arms", "Right elbow"],
    ["ParamHandR", -60, 60, 0, "Arms", "Right wrist"],
    ["ParamLegL", -30, 30, 0, "Legs", "Left swing"],
    ["ParamLegR", -30, 30, 0, "Legs", "Right swing"],
    ["ParamHairFront", -1, 1, 0, "Hair", "Bangs"],
    ["ParamHairSide", -1, 1, 0, "Hair", "Side locks"],
    ["ParamHairBack", -1, 1, 0, "Hair", "Back"],
    ["ParamHairTail", -1, 1, 0, "Hair", "Ponytail"],
    ["ParamAhoge", -1, 1, 0, "Hair", "Ahoge"],
    ["ParamSkirt", -1, 1, 0, "Hair", "Skirt"]
  ].map(function (p) {
    return { id: p[0], min: p[1], max: p[2], def: p[3], group: p[4], label: p[5] };
  });

  // ---- landmarks on the drawing --------------------------------------
  var HIP = [120, 352], NECK = [122, 244], HC = [127, 205];
  var FACE_Z = 40, FACE_RX = 55, FACE_RY = 60;
  // the whole head, hair and all, as one ball: how far in front of its
  // middle each point of the hair sits. Parts that meet - bangs and side
  // locks, the ahoge and the crown, the ponytail and its tie - take their
  // depth from the same ball, so they turn together where they join
  // instead of sliding apart.
  var HEAD = [122, 186], HEAD_RX = 64, HEAD_RY = 66, HEAD_Z = 40;
  var TIE = [61, 145], AHOGE = [116, 130];
  var ARM = {
    // elbows sit just below the cuffs: a joint inside the cuff would fold
    // the cuff's own outline into the bend
    R: { s: [96, 262], e: [84.5, 301], w: [75, 320] },
    L: { s: [146, 259], e: [157, 301], w: [163, 318] }
  };
  // hips, not the hem: the thigh above the sock is painted in up to here
  // (tools/parts_def.py), so a swinging leg pivots inside the skirt
  var LEG = { R: [100, 344], L: [137, 344] };
  // the lash's lower edge (tools/parts_def.py LID_EDGE), the middle of the
  // lash, how far it reaches, and the bottom of the iris
  var EYE = {
    R: { lid: "lidR", ball: "ballR", brow: "browR",
         edge: [[87.2, 193.6], [90, 195.0], [96, 194.7], [104, 195.3], [110, 196.0], [113.6, 197.6], [116.6, 199.8], [120.6, 199.6], [122.8, 200.4]],
         c: [103.6, 206.2], rx: 10.2, ry: 14.4, lc: 104, hw: 17, bottom: 220.8, brow: [110.5, 189.6], side: 1 },
    L: { lid: "lidL", ball: "ballL", brow: "browL",
         edge: [[137.6, 197.8], [143, 197.8], [150, 195.6], [158, 194.6], [166.6, 193.8]],
         c: [148.2, 205.6], rx: 9.0, ry: 14.0, lc: 152, hw: 14.5, bottom: 219.9, brow: [147.5, 189], side: -1 }
  };
  var MOUTH = [130.4, 233.7];

  // ---- small maths -----------------------------------------------------
  var D2R = Math.PI / 180;
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function sq(v) { return v * v; }
  function smooth(a, b, v) { var t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function bump(v, a, b) { var m = (a + b) / 2, h = (b - a) / 2, t = 1 - Math.abs(v - m) / h; return t <= 0 ? 0 : t * t * (3 - 2 * t); }
  function edgeAt(e, x) {
    if (x <= e[0][0]) return e[0][1];
    for (var i = 1; i < e.length; i++) {
      if (x <= e[i][0]) return e[i - 1][1] + (e[i][1] - e[i - 1][1]) * (x - e[i - 1][0]) / (e[i][0] - e[i - 1][0]);
    }
    return e[e.length - 1][1];
  }

  /* One scratch point. Every deformer reads and writes X, Y in place: a
     frame moves several thousand vertices through five or six of these,
     and an object per step would be garbage the phone has to collect. */
  var X = 0, Y = 0;

  function rotate(cx, cy, c, s) {
    var dx = X - cx, dy = Y - cy;
    X = cx + dx * c - dy * s; Y = cy + dx * s + dy * c;
  }

  // ---- body -------------------------------------------------------------
  var HIPX = HIP[0], HIPY = HIP[1], TORSO_H = 1 / (HIP[1] - NECK[1]);
  function torso(st) {
    var h = (HIPY - Y) * TORSO_H;
    h = h < 0 ? 0 : h > 1.25 ? 1.25 : h;
    X += st.bx * 0.32 * h;
    Y -= st.by * 0.22 * h;
    if (Y > 246 && Y < 304 && st.breath) {
      var w = bump(Y, 246, 304);
      Y -= st.breath * 0.9 * w; X += (X - 122) * st.breath * 0.012 * w;
    }
    var dx = X - HIPX, dy = Y - HIPY;
    X = HIPX + dx * st.bzc - dy * st.bzs;
    Y = HIPY + dx * st.bzs + dy * st.bzc - st.lift;
  }
  // something attached to the torso at `a` rides it rigidly: the anchor's
  // displacement plus the body's rotation, without the torso's bending
  function rigid(st, a, ad) {
    var dx = X - a[0], dy = Y - a[1];
    X = ad[0] + dx * st.bzc - dy * st.bzs; Y = ad[1] + dx * st.bzs + dy * st.bzc;
  }
  function anchor(st, a, out) { X = a[0]; Y = a[1]; torso(st); out[0] = X; out[1] = Y; return out; }

  // ---- head -------------------------------------------------------------
  function faceZ(x, y) {
    var u = (x - HC[0]) / FACE_RX, v = (y - HC[1]) / FACE_RY, k = 1 - u * u - v * v;
    return k > 0 ? FACE_Z * Math.sqrt(k) : 0;
  }
  function headZ(x, y) {
    var u = (x - HEAD[0]) / HEAD_RX, v = (y - HEAD[1]) / HEAD_RY, k = 1 - u * u - v * v;
    return k > 0 ? HEAD_Z * Math.sqrt(k) : 0;
  }
  var HCX = HC[0], HCY = HC[1], NKX = NECK[0], NKY = NECK[1];
  function head(st, z) {
    // turn and nod about the middle of the head, then the roll and the
    // body's tilt together as one rotation about the neck (st.hc, st.hs:
    // their angles summed in prepare), then carried to where the neck is
    var x = HCX + (X - HCX) * st.yc + z * st.ys - NKX;
    var y = HCY + (Y - HCY) * st.pc - z * st.ps - NKY;
    X = st.neck[0] + x * st.hc - y * st.hs;
    Y = st.neck[1] + x * st.hs + y * st.hc;
  }

  // ---- eyes -------------------------------------------------------------
  function lidShift(e, x) {
    var E = edgeAt(e.edge, x), u = clamp((x - e.lc) / e.hw, -1.2, 1.2);
    var closed = e.bottom - 1.4 - 3.2 * u * u;     // a gentle closed curve
    var smile = e.bottom - 9 + 5.5 * u * u;        // the ^ of a laughing eye
    var target = closed + (smile - closed) * e.s;
    return (target - E) * e.t - e.over * 5;
  }
  function lid(st, e) {
    Y += lidShift(e, X);
    rotate(e.lc, e.edge[0][1] / 2 + e.edge[e.edge.length - 1][1] / 2, e.ac, e.as);
  }
  var EYE_ST = { R: Object.create(EYE.R), L: Object.create(EYE.L) };
  var PID = {
    R: { open: "ParamEyeROpen", smile: "ParamEyeRSmile", angle: "ParamEyeRAngle", by: "ParamBrowRY", ba: "ParamBrowRAngle" },
    L: { open: "ParamEyeLOpen", smile: "ParamEyeLSmile", angle: "ParamEyeLAngle", by: "ParamBrowLY", ba: "ParamBrowLAngle" }
  };
  function eyeState(v, k) {
    var e = EYE[k], id = PID[k], open = v[id.open], s = v[id.smile];
    var a = v[id.angle] * 9 * D2R * e.side;
    // the strokes are short, so they need to turn a long way to read: at
    // -1 the inner end comes up past level, at +1 it digs down
    var by = v[id.by], ba = v[id.ba] * 20 * D2R * e.side;
    var st = EYE_ST[k];
    st.t = 1 - clamp(open, 0, 1);
    st.over = Math.max(0, open - 1);
    st.s = clamp(s, 0, 1);
    st.ac = Math.cos(a); st.as = Math.sin(a);
    st.bc = Math.cos(ba); st.bs = Math.sin(ba);
    st.by = by;
    st.gx = v.ParamEyeBallX * 1.8; st.gy = -v.ParamEyeBallY * 1.4;
    return st;
  }

  // ---- arms and legs ----------------------------------------------------
  /* A turn by a small angle without Math.cos and Math.sin: a hair sway or
     a leg swing is a few tenths of a radian, where the series is exact to
     a millionth, and it runs once for every vertex of the part. */
  function rotSmall(cx, cy, a) {
    var a2 = a * a, c = 1 - a2 * (0.5 - a2 / 24), s = a * (1 - a2 * (1 / 6 - a2 / 120));
    rotate(cx, cy, c, s);
  }
  function rotW(cx, cy, a, w, c, s) {
    // w is 1 for most of a limb, so the whole-angle cos and sin made once
    // a frame serve; only the blend at a joint needs its own
    if (w >= 1) rotate(cx, cy, c, s);
    else rotate(cx, cy, Math.cos(a * w), Math.sin(a * w));
  }
  var ARM_AXIS = {};
  ["R", "L"].forEach(function (k) {
    var a = ARM[k], ax = a.w[0] - a.s[0], ay = a.w[1] - a.s[1], len = Math.sqrt(ax * ax + ay * ay);
    ARM_AXIS[k] = { ax: ax / len, ay: ay / len, len: len,
                    le: (a.e[0] - a.s[0]) * ax / len + (a.e[1] - a.s[1]) * ay / len };
  });
  // The sleeve turns with the arm as one piece, like a puppet's: only the
  // strip right at the shoulder bends. Bent over a longer stretch, the
  // sleeve's top outline was dragged out into a black ribbon.
  function armWeights(k, x, y, out) {
    var a = ARM[k], q = ARM_AXIS[k], along = (x - a.s[0]) * q.ax + (y - a.s[1]) * q.ay;
    out[1] = smooth(q.len - 3, q.len + 2, along);
    out[2] = smooth(q.le - 2.5, q.le + 2.5, along);
    out[3] = smooth(-7, 0, along);
  }
  function arm(st, k) {
    var a = ARM[k], r = st.arm[k];
    if (W1 > 0 && r.w) rotW(a.w[0], a.w[1], r.w, W1, r.wc, r.ws);
    if (W2 > 0 && r.e) rotW(a.e[0], a.e[1], r.e, W2, r.ec, r.es);
    if (W3 > 0 && r.s) rotW(a.s[0], a.s[1], r.s, W3, r.sc, r.ss);
    rigid(st, a.s, k === "R" ? st.sr : st.sl);
  }
  // weights of a sleeve's gusset: the arm's own three joint weights, and in
  // the fourth how much of the arm each vertex follows - all of it at the
  // crease, none of it under the bodice
  function gussetPre(k, nearX, farX, fullY0, fullY1) {
    return function (x, y, o) {
      armWeights(k, x, y, o);
      o[4] = smooth(farX, nearX, x);
      // her left sleeve is drawn three-quarter on, so the drawing shows only
      // a crescent of a tube whose body is behind her chest: below the
      // shoulder that body goes with the arm entirely
      if (fullY0 != null) o[4] = Math.max(o[4], smooth(fullY0, fullY1, y));
    };
  }
  function gusset(st, k) {
    var x0 = X, y0 = Y;
    arm(st, k);
    var ax = X, ay = Y;
    X = x0; Y = y0; torso(st);
    X += (ax - X) * W4; Y += (ay - Y) * W4;
  }
  function leg(st, k) {
    var p = LEG[k], r = st.leg[k] * W1;
    if (r) rotSmall(p[0], p[1], r);
    Y -= st.lift;
  }

  // ---- per part -------------------------------------------------------
  /* Each part is two functions. `pre` runs once per vertex, on the rest
     position, and works out what depends only on where the vertex was
     drawn - its depth in the head, how far down a lock it is, how much of
     a joint it is - into Z and W1..W4. `run` runs every frame and uses
     them. Live2D bakes its weights the same way; recomputed every frame,
     the square roots and smoothsteps cost more than all the moving. */
  var Z = 0, W1 = 0, W2 = 0, W3 = 0, W4 = 0;
  var TMP = [0, 0, 0, 0, 0];
  function zOnly(f) { return function (x, y, o) { o[0] = f(x, y); }; }
  function faceAt(k) { return zOnly(function (x, y) { return faceZ(x, y) + k; }); }
  function onHead(st) { head(st, Z); }

  var PARTS = {
    hairBack: {
      // behind the head, except over the crown: there the back of the head
      // and the top of the bangs are one outline, at one depth, and must
      // stay one when she turns or nods
      pre: function (x, y, o) {
        var kz = smooth(140, 175, y);
        o[0] = headZ(x, y) * 1.15 * (1 - kz) - 10 * kz;
        o[1] = smooth(232, 330, y);
        o[2] = 1 - 0.7 * smooth(238, 315, y);
      },
      run: function (st) {
        var y0 = Y, x0;
        X += st.hairBack * 7 * W1;
        x0 = X;
        head(st, Z);
        var hx = X, hy = Y;
        X = x0; Y = y0; rigid(st, NECK, st.neck);
        // the long hair rests on her back: the head drags its root, the
        // shoulders carry its length
        X += (hx - X) * W2; Y += (hy - Y) * W2;
      }
    },
    ponytail: {
      // level with the crown at the tie, falling behind the head along its
      // length
      pre: function (x, y, o) {
        var d = Math.sqrt(sq(x - TIE[0]) + sq(y - TIE[1]));
        o[0] = -9 * clamp(d / 45, 0, 1);
        o[1] = 14 * D2R * Math.pow(clamp(d / 70, 0, 1), 1.2);
      },
      run: function (st) {
        var a = st.tail * W1;
        if (a) rotSmall(TIE[0], TIE[1], a);
        head(st, Z);
      }
    },
    legR: { pre: legPre("R"), run: function (st) { leg(st, "R"); } },
    legL: { pre: legPre("L"), run: function (st) { leg(st, "L"); } },
    shoeR: { pre: legPre("R"), run: function (st) { leg(st, "R"); } },
    shoeL: { pre: legPre("L"), run: function (st) { leg(st, "L"); } },
    dress: {
      pre: function (x, y, o) {
        o[1] = smooth(296, 360, y);
        o[2] = smooth(318, 360, y);
        o[3] = Math.exp(-sq((x - LEG.R[0]) / 13));
        o[4] = Math.exp(-sq((x - LEG.L[0]) / 13));
      },
      run: function (st) {
        X += st.skirt * 2.6 * W1;
        // a leg swinging out carries the hem over it a little way with it
        if (W2 > 0 && (st.leg.R || st.leg.L)) {
          X -= (st.leg.R * W3 + st.leg.L * W4) * 9 * W2;
          Y -= (Math.abs(st.leg.R) * W3 + Math.abs(st.leg.L) * W4) * 5 * W2;
        }
        torso(st);
      }
    },
    armR: { pre: function (x, y, o) { armWeights("R", x, y, o); }, run: function (st) { arm(st, "R"); } },
    armL: { pre: function (x, y, o) { armWeights("L", x, y, o); }, run: function (st) { arm(st, "L"); } },
    // The underside of each sleeve (tools/parts_def.py). Hers right: a small
    // wedge of fabric tucked under the bodice's armhole. Its edge by the crease goes
    // where the arm goes; its edge under the bodice stays with the torso; the
    // mesh between stretches, which is what the fabric at an armpit does when
    // an arm is raised. At rest it is wholly under the cap and the dress.
    sleeveR: { pre: gussetPre("R", 100.5, 106), run: function (st) { gusset(st, "R"); } },
    sleeveL: { pre: gussetPre("L", 146.7, 141.2, 258, 268), run: function (st) { gusset(st, "L"); } },
    neck: {
      // the top of the neck goes with the chin, so the shadow under it
      // stays under it and the neck stretches as she looks up
      pre: function (x, y, o) { o[1] = smooth(250, 236, y) * 0.85; },
      run: function (st) {
        var x0 = X, y0 = Y;
        torso(st);
        if (W1 > 0) {
          var tx = X, ty = Y;
          X = x0; Y = y0; head(st, 0);
          X = tx + (X - tx) * W1; Y = ty + (Y - ty) * W1;
        }
      }
    },
    collar: { run: torso },
    ear: { pre: zOnly(function (x, y) { return headZ(x, y) - 4; }), run: onHead },
    face: { pre: faceAt(0), run: onHead },
    mouth: { pre: faceAt(2), run: onHead },
    blush: { pre: faceAt(1), run: onHead },
    tears: { pre: faceAt(3), run: onHead },
    gloom: { pre: faceAt(4), run: onHead },
    lowerLid: { pre: faceAt(3), run: onHead },
    ballR: { pre: faceAt(3), run: function (st) { X += st.eyeR.gx; Y += st.eyeR.gy; head(st, Z); } },
    ballL: { pre: faceAt(3), run: function (st) { X += st.eyeL.gx; Y += st.eyeL.gy; head(st, Z); } },
    lidR: { pre: faceAt(4), run: function (st) { lid(st, st.eyeR); head(st, Z); } },
    lidL: { pre: faceAt(4), run: function (st) { lid(st, st.eyeL); head(st, Z); } },
    browR: { pre: faceAt(5), run: function (st) { brow(st, st.eyeR); head(st, Z); } },
    browL: { pre: faceAt(5), run: function (st) { brow(st, st.eyeL); head(st, Z); } },
    sideR: { pre: sidePre, run: sideRun },
    sideL: { pre: sidePre, run: sideRun },
    sweat: { pre: zOnly(function () { return 14; }), run: function (st) { Y += st.sweat * 2; head(st, Z); } },
    frontHair: {
      pre: function (x, y, o) { o[0] = headZ(x, y) * 1.15; o[1] = smooth(150, 187, y); },
      run: function (st) { X += st.hairFront * 2.2 * W1; head(st, Z); }
    },
    ahoge: {
      // rooted at the crown's own depth, so the root stays put on a turn
      pre: function (x, y, o) {
        var d = clamp(Math.sqrt(sq(x - AHOGE[0]) + sq(y - AHOGE[1])) / 30, 0, 1);
        o[0] = 24 + 8 * d; o[1] = 20 * D2R * d;
      },
      run: function (st) {
        var a = st.ahoge * W1;
        if (a) rotSmall(AHOGE[0], AHOGE[1], a);
        head(st, Z);
      }
    },
    anger: { pre: zOnly(function () { return 26; }), run: onHead }
  };
  function legPre(k) { return function (x, y, o) { o[1] = smooth(LEG[k][1] - 2, LEG[k][1] + 12, y); }; }
  function sidePre(x, y, o) { o[0] = Math.max(headZ(x, y) * 0.9, 12); o[1] = Math.pow(smooth(160, 256, y), 1.3); }
  function sideRun(st) { X += st.hairSide * 4.5 * W1; head(st, Z); }
  function brow(st, e) {
    // the crease follows the lid a little as it closes
    Y += -e.by * 3.0 + e.t * 2.0 * (1 - e.s) - e.s * 1.2 - e.over * 6;
    rotate(e.brow[0], e.brow[1], e.bc, e.bs);
  }

  // ---- drawn parts ----------------------------------------------------
  var SPRITES = [
    { id: "mouth", x: MOUTH[0] - 8, y: MOUTH[1] - 6, w: 16, h: 14, res: 10, cell: 2,
      key: function (v) { return Math.round(v.ParamMouthForm * 60) * 1000 + Math.round(v.ParamMouthOpenY * 60); },
      draw: drawMouth },
    { id: "blush", x: 86, y: 213, w: 80, h: 18, res: 6, draw: drawBlush },
    { id: "tears", x: 88, y: 212, w: 76, h: 34, res: 6, draw: drawTears },
    { id: "gloom", x: 88, y: 166, w: 80, h: 38, res: 6, draw: drawGloom },
    { id: "sweat", x: 168, y: 158, w: 14, h: 22, res: 10, cell: 7, draw: drawSweat },
    { id: "anger", x: 146, y: 132, w: 20, h: 20, res: 10, cell: 10, draw: drawAnger },
    { id: "lowerLid", x: 88, y: 196, w: 80, h: 28, res: 8, cell: 3,
      key: function (v) {
        return ((Math.round(v.ParamEyeROpen * 50) * 64 + Math.round(v.ParamEyeRSmile * 50)) * 64 +
                Math.round(v.ParamEyeLOpen * 50)) * 64 + Math.round(v.ParamEyeLSmile * 50);
      },
      draw: drawLowerLids }
  ];

  /* A smiling eye is closed from below by the cheek (eyeClip, below). Cut
     off with nothing there, the iris looks sliced; so the cheek's edge is
     drawn, as a fine lower lid, fading in as the smile does. */
  function lidLine(e) { return smooth(0.12, 0.55, e.s * (1 - e.t)); }
  var LID_TMP = { R: Object.create(EYE.R), L: Object.create(EYE.L) };
  function drawLowerLids(g, v) {
    ["R", "L"].forEach(function (k) {
      var e = LID_TMP[k];
      e.s = clamp(v[PID[k].smile], 0, 1); e.t = 1 - clamp(v[PID[k].open], 0, 1);
      var a = lidLine(e);
      if (a <= 0.01) return;
      var y0 = lowerEdge(e, e.c[0]), dy = (y0 - e.c[1]) / e.ry;
      var hx = e.rx * Math.sqrt(Math.max(0, 1 - dy * dy)) + 0.8;
      g.globalAlpha = a;
      g.strokeStyle = "#3b1a1d"; g.lineWidth = 0.6; g.lineCap = "round";
      g.beginPath();
      for (var i = 0; i <= 12; i++) {
        var x = e.c[0] - hx + 2 * hx * i / 12, y = lowerEdge(e, x) + 0.15;
        if (i) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.stroke();
    });
    g.globalAlpha = 1;
  }

  /* The drawn mouth is a soft dot a pixel and a half wide, so that is
     where every shape starts from. Closed, the dot is pulled into a smile
     or a frown. Open, it is four curves round a dark mouth with a tongue
     in it: an "o" when the form is level, a wide "D" when smiling, and the
     other way up when not - corners pinched where a smile pulls them, round
     where an "o" has none. */
  function drawMouth(g, v) {
    var f = clamp(v.ParamMouthForm, -1, 1), o = clamp(v.ParamMouthOpenY, 0, 1);
    var cx = MOUTH[0], cy = MOUTH[1], fp = Math.max(f, 0), fn = Math.max(-f, 0);
    g.lineCap = "round"; g.lineJoin = "round";
    if (o < 0.05) {
      var k = smooth(0.06, 0.3, Math.abs(f)), w0 = 2.2 + 3.2 * fp + 1.8 * fn;
      if (k < 1) {
        g.globalAlpha = 1 - k;
        g.fillStyle = "#733232";
        g.beginPath(); g.ellipse(cx, cy, 1.05, 0.62, 0, 0, Math.PI * 2); g.fill();
      }
      if (k > 0) {
        var ey = cy - 0.9 * f, my = cy + 1.1 * f;
        g.globalAlpha = k;
        g.strokeStyle = "#4e2125"; g.lineWidth = 0.55;
        g.beginPath();
        g.moveTo(cx - w0 / 2, ey);
        g.bezierCurveTo(cx - w0 / 4, my, cx + w0 / 4, my, cx + w0 / 2, ey);
        g.stroke();
      }
      g.globalAlpha = 1;
      return;
    }
    // opening from closed: the first sliver of open mouth grows out of the
    // closed shape instead of popping in at full size
    var open = smooth(0.05, 1, o);
    var w = 2.4 + 3.4 * fp + 1.0 * fn + 1.8 * open * (1 - 0.4 * fp);
    var h = 0.9 + 4.6 * open;
    var yc = cy - 0.7 * fp * (0.6 + 0.4 * open) + 0.6 * fn;            // the corners
    var yt = cy - 0.15 - h * (0.42 * (1 - fp) + 0.08 * fp) - fn * h * 0.25; // top of the upper lip
    var yb = cy + h * (0.58 * (1 - fn) + 0.3 * fn) + 0.4 * fp;          // bottom of the lower lip
    var round = 0.55 * (1 - 0.7 * fp);                                   // 0 = pinched corners
    var lx = cx - w / 2, rx = cx + w / 2;
    var path = function () {
      g.beginPath();
      g.moveTo(lx, yc);
      g.bezierCurveTo(lx, yc + (yt - yc) * round, cx - w * 0.3, yt, cx, yt);
      g.bezierCurveTo(cx + w * 0.3, yt, rx, yc + (yt - yc) * round, rx, yc);
      g.bezierCurveTo(rx, yc + (yb - yc) * (round + 0.25), cx + w * 0.32, yb, cx, yb);
      g.bezierCurveTo(cx - w * 0.32, yb, lx, yc + (yb - yc) * (round + 0.25), lx, yc);
      g.closePath();
    };
    path(); g.fillStyle = "#6b1d27"; g.fill();
    if (h > 1.6) {
      g.save(); path(); g.clip();
      g.globalAlpha = smooth(1.6, 3, h);
      g.fillStyle = "#df7f88";
      g.beginPath(); g.ellipse(cx, yb - h * 0.08, w * 0.34, h * 0.34, 0, 0, Math.PI * 2); g.fill();
      g.restore();
    }
    path(); g.strokeStyle = "#3a1216"; g.lineWidth = 0.45; g.stroke();
  }

  function drawBlush(g) {
    [[99, 223.5], [154, 222.5]].forEach(function (c) {
      var r = g.createRadialGradient(c[0], c[1], 0, c[0], c[1], 7.5);
      r.addColorStop(0, "rgba(255,120,130,0.55)");
      r.addColorStop(1, "rgba(255,120,130,0)");
      g.save(); g.translate(c[0], c[1]); g.scale(1, 0.45); g.translate(-c[0], -c[1]);
      g.fillStyle = r; g.beginPath(); g.arc(c[0], c[1], 7.5, 0, Math.PI * 2); g.fill();
      g.restore();
      g.strokeStyle = "rgba(214,72,92,0.75)"; g.lineWidth = 0.45; g.lineCap = "round";
      for (var i = -1; i <= 1; i++) {
        g.beginPath(); g.moveTo(c[0] + i * 2.4 - 0.9, c[1] + 1.4); g.lineTo(c[0] + i * 2.4 + 0.9, c[1] - 1.4); g.stroke();
      }
    });
  }

  function drawTears(g) {
    [[98.5, 219.5, -1], [152.5, 218.5, 1]].forEach(function (c) {
      var x = c[0], y = c[1], s = c[2];
      g.fillStyle = "rgba(160,215,255,0.8)";
      g.beginPath();
      g.moveTo(x - 1.1, y);
      g.bezierCurveTo(x - 1.4 + s * 0.3, y + 6, x - 1.0 - s * 0.4, y + 11, x + s * 0.3, y + 16);
      g.bezierCurveTo(x + 0.9 - s * 0.4, y + 11, x + 1.4 + s * 0.3, y + 6, x + 1.1, y);
      g.closePath(); g.fill();
      g.strokeStyle = "rgba(255,255,255,0.85)"; g.lineWidth = 0.35;
      g.beginPath(); g.moveTo(x - 0.3, y + 2); g.quadraticCurveTo(x - 0.6 + s * 0.3, y + 7, x - 0.2, y + 10); g.stroke();
      // welling along the lower lid, thickest where the stream leaves it
      g.strokeStyle = "rgba(170,222,255,0.9)"; g.lineWidth = 0.9;
      g.beginPath(); g.moveTo(x - s * 4.5, y - 1.6); g.quadraticCurveTo(x - s * 1.5, y + 0.4, x, y + 0.2); g.stroke();
    });
  }

  /* The manga shadow of dread: a wash of blue-violet down from the bangs
     with vertical hatching through it. */
  function drawGloom(g) {
    var wash = g.createLinearGradient(0, 166, 0, 200);
    wash.addColorStop(0, "rgba(80,70,140,0.42)");
    wash.addColorStop(1, "rgba(80,70,140,0)");
    g.fillStyle = wash; g.fillRect(88, 166, 80, 36);
    var xs = [92, 97, 102, 107, 112, 117, 122, 127, 132, 137, 142, 147, 152, 157, 162];
    xs.forEach(function (x, i) {
      var len = 14 + ((i * 7) % 5) * 3.4;
      var lg = g.createLinearGradient(0, 167, 0, 167 + len);
      lg.addColorStop(0, "rgba(55,45,100,0.9)");
      lg.addColorStop(1, "rgba(55,45,100,0)");
      g.strokeStyle = lg; g.lineWidth = 0.8; g.lineCap = "round";
      g.beginPath(); g.moveTo(x, 167); g.lineTo(x, 167 + len); g.stroke();
    });
  }

  function drawSweat(g) {
    var x = 175, y = 163;
    g.beginPath();
    g.moveTo(x, y);
    g.bezierCurveTo(x + 1.4, y + 4, x + 3.6, y + 7, x + 3.6, y + 9.6);
    g.arc(x, y + 9.6, 3.6, 0, Math.PI);
    g.bezierCurveTo(x - 3.6, y + 7, x - 1.4, y + 4, x, y);
    g.closePath();
    g.fillStyle = "#c9ebff"; g.fill();
    g.strokeStyle = "#3b6e98"; g.lineWidth = 0.55; g.stroke();
    g.fillStyle = "#ffffff";
    g.beginPath(); g.ellipse(x - 1.3, y + 9.4, 0.7, 1.4, -0.3, 0, Math.PI * 2); g.fill();
  }

  function drawAnger(g) {
    var cx = 156, cy = 142, r = 3.4, gap = 1.1;
    g.strokeStyle = "#e3343c"; g.lineWidth = 1.25; g.lineCap = "round";
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (q) {
      var ox = cx + q[0] * gap, oy = cy + q[1] * gap;
      g.beginPath();
      g.moveTo(ox + q[0] * r, oy);
      g.quadraticCurveTo(ox, oy, ox, oy + q[1] * r);
      g.stroke();
    });
  }

  // ---- what the renderer asks for -------------------------------------
  var BASE = ["hairBack", "ponytail", "legR", "legL", "shoeR", "shoeL", "sleeveR", "sleeveL", "dress", "armR", "armL", "neck", "collar",
              "ear", "face", "blush", "mouth", "ballR", "ballL", "lowerLid", "lidR", "lidL", "browR", "browL", "gloom", "tears",
              "sideR", "sideL", "sweat", "frontHair", "ahoge", "anger"];

  // one state object of one shape, filled in place every frame
  var st = {
    v: null, yc: 1, ys: 0, pc: 1, ps: 0, rc: 1, rs: 0, bzc: 1, bzs: 0, hc: 1, hs: 0, bx: 0, by: 0, breath: 0, lift: 0,
    neck: [0, 0], sr: [0, 0], sl: [0, 0],
    arm: { R: armState(), L: armState() }, leg: { R: 0, L: 0 },
    hairBack: 0, hairSide: 0, hairFront: 0, tail: 0, ahoge: 0, skirt: 0, sweat: 0,
    eyeR: null, eyeL: null, clipR: null, clipL: null
  };
  function armState() { return { s: 0, e: 0, w: 0, sc: 1, ss: 0, ec: 1, es: 0, wc: 1, ws: 0 }; }
  function armSet(r, s, e, w) {
    r.s = s; r.e = e; r.w = w;
    r.sc = Math.cos(s); r.ss = Math.sin(s); r.ec = Math.cos(e); r.es = Math.sin(e); r.wc = Math.cos(w); r.ws = Math.sin(w);
  }
  var CLIP = {
    R: { origin: EYE.R.c, top: new Float32Array(16), bot: new Float32Array(16) },
    L: { origin: EYE.L.c, top: new Float32Array(16), bot: new Float32Array(16) }
  };

  function prepare(v) {
    st.v = v;
    var yaw = v.ParamAngleX * 0.4 * D2R, pitch = v.ParamAngleY * 0.35 * D2R, roll = v.ParamAngleZ * 0.5 * D2R;
    st.yc = Math.cos(yaw); st.ys = Math.sin(yaw);
    st.pc = Math.cos(pitch); st.ps = Math.sin(pitch);
    st.rc = Math.cos(roll); st.rs = Math.sin(roll);
    var bz = v.ParamBodyAngleZ * 0.6 * D2R;
    st.bzc = Math.cos(bz); st.bzs = Math.sin(bz);
    st.hc = Math.cos(roll + bz); st.hs = Math.sin(roll + bz);
    st.bx = v.ParamBodyAngleX; st.by = v.ParamBodyAngleY;
    st.breath = v.ParamBreath; st.lift = v.ParamBodyY;
    anchor(st, NECK, st.neck);
    anchor(st, ARM.R.s, st.sr);
    anchor(st, ARM.L.s, st.sl);
    // raising is outward for both arms, so the right arm (screen left)
    // turns the other way round from the left
    armSet(st.arm.R, v.ParamArmRA * D2R, v.ParamArmRB * D2R, v.ParamHandR * D2R);
    armSet(st.arm.L, -v.ParamArmLA * D2R, -v.ParamArmLB * D2R, -v.ParamHandL * D2R);
    st.hairBack = v.ParamHairBack; st.hairSide = v.ParamHairSide; st.hairFront = v.ParamHairFront;
    st.tail = v.ParamHairTail; st.ahoge = v.ParamAhoge; st.skirt = v.ParamSkirt; st.sweat = v.ParamSweat;
    st.leg.R = v.ParamLegR * 0.8 * D2R; st.leg.L = -v.ParamLegL * 0.8 * D2R;
    st.eyeR = eyeState(v, "R");
    st.eyeL = eyeState(v, "L");
    st.clipR = eyeClip(st, st.eyeR, CLIP.R);
    st.clipL = eyeClip(st, st.eyeL, CLIP.L);
    return st;
  }

  /* The edges the eyeball is clipped against, in the same deformed space
     as the eyeball itself: the lash's lower edge (pulled 0.7 into the lash,
     so its soft bottom still sits over iris) pushed through the lid's own
     deformers, and a lower edge that a smile pushes up. */
  function lowerEdge(e, x) {
    var u = clamp((x - e.lc) / e.hw, -1.2, 1.2);
    return e.bottom + 4 + (-12 + 4 * u * u) * e.s * (1 - e.t);
  }
  function eyeClip(st, e, c) {
    var top = c.top, bot = c.bot;
    var x0 = e.edge[0][0], x1 = e.edge[e.edge.length - 1][0];
    var ox = e.c[0], oy = e.c[1];
    for (var i = 0; i < 8; i++) {
      var x = x0 + (x1 - x0) * i / 7;
      X = x; Y = edgeAt(e.edge, x) - 0.7;
      lid(st, e); head(st, faceZ(x, Y) + 4);
      top[i * 2] = X - ox; top[i * 2 + 1] = Y - oy;
      X = x; Y = lowerEdge(e, x);
      head(st, faceZ(X, Y) + 3);
      bot[i * 2] = X - ox; bot[i * 2 + 1] = Y - oy;
    }
    return c;
  }

  /* The baked values for a mesh, made the first time it is deformed and
     kept with it. */
  var BAKED = typeof WeakMap === "function" ? new WeakMap() : null;
  function bake(id, rest) {
    var p = PARTS[id], n = rest.length / 2, b = new Float32Array(n * 5);
    if (p.pre) {
      for (var i = 0; i < n; i++) {
        TMP[0] = TMP[1] = TMP[2] = TMP[3] = TMP[4] = 0;
        p.pre(rest[i * 2], rest[i * 2 + 1], TMP);
        for (var k = 0; k < 5; k++) b[i * 5 + k] = TMP[k];
      }
    }
    return b;
  }
  function deform(id, rest, out, s) {
    var f = PARTS[id].run, b = BAKED && BAKED.get(rest);
    if (!b) { b = bake(id, rest); if (BAKED) BAKED.set(rest, b); }
    for (var i = 0, j = 0, n = rest.length; i < n; i += 2, j += 5) {
      X = rest[i]; Y = rest[i + 1];
      Z = b[j]; W1 = b[j + 1]; W2 = b[j + 2]; W3 = b[j + 3]; W4 = b[j + 4];
      f(s);
      out[i] = X; out[i + 1] = Y;
    }
  }

  /* An arm raised past level comes in front of the hair beside her face.
     Four possible orders, built once. */
  var ORDERS = {};
  function orderFor(r, l) {
    var key = (r ? 1 : 0) + (l ? 2 : 0);
    if (ORDERS[key]) return ORDERS[key];
    var o = BASE.slice();
    if (r) { o.splice(o.indexOf("armR"), 1); o.splice(o.indexOf("frontHair"), 0, "armR"); }
    if (l) { o.splice(o.indexOf("armL"), 1); o.splice(o.indexOf("frontHair"), 0, "armL"); }
    return (ORDERS[key] = o);
  }
  function order(s) { return orderFor(s.v.ParamArmRA > 95, s.v.ParamArmLA > 95); }

  function alpha(id, s) {
    var v = s.v;
    switch (id) {
      case "ballR": return 1 - smooth(0.82, 1, s.eyeR.t);
      case "ballL": return 1 - smooth(0.82, 1, s.eyeL.t);
      case "blush": return v.ParamCheek;
      case "tears": return v.ParamTear;
      case "gloom": return v.ParamGloom;
      case "sweat": return v.ParamSweat;
      case "anger": return v.ParamAnger;
      case "lowerLid": return lidLine(s.eyeR) > 0.01 || lidLine(s.eyeL) > 0.01 ? 1 : 0;
      default: return 1;
    }
  }

  function clip(id, s) {
    if (id === "ballR") return s.clipR;
    if (id === "ballL") return s.clipL;
    return null;
  }

  return {
    params: PARAMS,
    parts: {
      ballR: { cell: 2 }, ballL: { cell: 2 }, lidR: { cell: 1.5 }, lidL: { cell: 1.5 },
      browR: { cell: 2 }, browL: { cell: 2 }, armR: { cell: 3 }, armL: { cell: 3 }, sleeveR: { cell: 3 }, sleeveL: { cell: 3 },
      face: { cell: 4 }, frontHair: { cell: 4 }, ahoge: { cell: 3 }, ponytail: { cell: 4 },
      sideR: { cell: 4 }, sideL: { cell: 4 }, legR: { cell: 4 }, legL: { cell: 4 }
    },
    sprites: SPRITES,
    // the part of the drawing worth looking at: x 0..224, y 70..450
    frame: { cx: 112, cy: 262, w: 240, h: 392 },
    landmarks: { hip: HIP, neck: NECK, head: HC, mouth: MOUTH, eyes: { R: EYE.R.c, L: EYE.L.c },
                 lids: { R: EYE.R.edge, L: EYE.L.edge } },
    prepare: prepare,
    deform: deform,
    order: order,
    alpha: alpha,
    clip: clip
  };
})();
