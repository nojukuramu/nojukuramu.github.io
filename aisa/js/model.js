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
  var TIE = [61, 145], AHOGE = [116, 130];
  var ARM = {
    // elbows sit just below the cuffs: a joint inside the cuff would fold
    // the cuff's own outline into the bend
    R: { s: [96, 262], e: [84.5, 301], w: [75, 320] },
    L: { s: [146, 259], e: [157, 301], w: [163, 318] }
  };
  var LEG = { R: [100, 352], L: [137, 352] };
  // the lash's lower edge (tools/parts_def.py LID_EDGE), the middle of the
  // lash, how far it reaches, and the bottom of the iris
  var EYE = {
    R: { lid: "lidR", ball: "ballR", brow: "browR",
         edge: [[87.2, 193.6], [90, 195.0], [96, 194.7], [104, 195.3], [110, 196.0], [113.6, 197.6], [116.6, 199.8], [120.6, 199.6]],
         c: [103.6, 206.2], lc: 104, hw: 17, bottom: 220.8, brow: [104.5, 188], side: 1 },
    L: { lid: "lidL", ball: "ballL", brow: "browL",
         edge: [[137.6, 197.8], [143, 197.8], [150, 195.6], [158, 194.6], [166.6, 193.8]],
         c: [148.2, 205.6], lc: 152, hw: 14.5, bottom: 219.9, brow: [151.5, 188], side: -1 }
  };
  var MOUTH = [130.4, 233.7];

  // ---- small maths -----------------------------------------------------
  var D2R = Math.PI / 180;
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
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
  function torso(st) {
    var h = clamp((HIP[1] - Y) / (HIP[1] - NECK[1]), 0, 1.25);
    X += st.bx * 0.32 * h;
    Y -= st.by * 0.22 * h;
    var w = bump(Y, 246, 304);
    if (w > 0) { Y -= st.breath * 0.9 * w; X += (X - 122) * st.breath * 0.012 * w; }
    rotate(HIP[0], HIP[1], st.bzc, st.bzs);
    Y -= st.lift;
  }
  // something attached to the torso at `a` rides it rigidly: the anchor's
  // displacement plus the body's rotation, without the torso's bending
  function rigid(st, a, ad) {
    var dx = X - a[0], dy = Y - a[1];
    X = ad[0] + dx * st.bzc - dy * st.bzs; Y = ad[1] + dx * st.bzs + dy * st.bzc;
  }
  function anchor(st, a) { X = a[0]; Y = a[1]; torso(st); return [X, Y]; }

  // ---- head -------------------------------------------------------------
  function faceZ(x, y) {
    var u = (x - HC[0]) / FACE_RX, v = (y - HC[1]) / FACE_RY, k = 1 - u * u - v * v;
    return k > 0 ? FACE_Z * Math.sqrt(k) : 0;
  }
  function head(st, z) {
    var dx = X - HC[0], dy = Y - HC[1];
    X = HC[0] + dx * st.yc + z * st.ys;
    Y = HC[1] + dy * st.pc - z * st.ps;
    rotate(NECK[0], NECK[1], st.rc, st.rs);
    rigid(st, NECK, st.neck);
  }

  // ---- eyes -------------------------------------------------------------
  function lidShift(e, x) {
    var E = edgeAt(e.edge, x), u = clamp((x - e.lc) / e.hw, -1.2, 1.2);
    var closed = e.bottom - 1.4 - 3.2 * u * u;     // a gentle closed curve
    var smile = e.bottom - 9 + 5.5 * u * u;        // the ^ of a laughing eye
    var target = closed + (smile - closed) * e.s;
    return (target - E) * e.t - e.over * 7;
  }
  function lid(st, e) {
    Y += lidShift(e, X);
    rotate(e.lc, e.edge[0][1] / 2 + e.edge[e.edge.length - 1][1] / 2, e.ac, e.as);
  }
  function eyeState(v, k) {
    var e = EYE[k], open = v["ParamEye" + k + "Open"], s = v["ParamEye" + k + "Smile"];
    var a = v["ParamEye" + k + "Angle"] * 9 * D2R * e.side;
    var by = v["ParamBrow" + k + "Y"], ba = v["ParamBrow" + k + "Angle"] * 11 * D2R * e.side;
    var st = Object.create(e);
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
  function arm(st, k) {
    var a = ARM[k], ax = a.w[0] - a.s[0], ay = a.w[1] - a.s[1], len = Math.sqrt(ax * ax + ay * ay);
    ax /= len; ay /= len;
    var along = (X - a.s[0]) * ax + (Y - a.s[1]) * ay;
    var le = (a.e[0] - a.s[0]) * ax + (a.e[1] - a.s[1]) * ay;
    var r = st.arm[k];
    var ww = smooth(len - 3, len + 2, along), we = smooth(le - 2.5, le + 2.5, along), ws = smooth(-5, 6, along);
    if (ww > 0) rotate(a.w[0], a.w[1], Math.cos(r.w * ww), Math.sin(r.w * ww));
    if (we > 0) rotate(a.e[0], a.e[1], Math.cos(r.e * we), Math.sin(r.e * we));
    if (ws > 0) rotate(a.s[0], a.s[1], Math.cos(r.s * ws), Math.sin(r.s * ws));
    rigid(st, a.s, st[k === "R" ? "sr" : "sl"]);
  }
  function leg(st, k) {
    var p = LEG[k], w = smooth(p[1] - 2, p[1] + 9, Y), r = st.leg[k] * w;
    if (r) rotate(p[0], p[1], Math.cos(r), Math.sin(r));
    Y -= st.lift;
  }

  // ---- per part -------------------------------------------------------
  var DEFORM = {
    hairBack: function (st) {
      var y0 = Y, x0;
      X += st.v.ParamHairBack * 7 * smooth(232, 330, Y);
      x0 = X;
      head(st, -12);
      var hx = X, hy = Y;
      X = x0; Y = y0; rigid(st, NECK, st.neck);
      // the long hair rests on her back: the head drags its root, the
      // shoulders carry its length
      var k = 1 - 0.7 * smooth(238, 315, y0);
      X += (hx - X) * k; Y += (hy - Y) * k;
    },
    ponytail: function (st) {
      var dx = X - TIE[0], dy = Y - TIE[1], d = Math.sqrt(dx * dx + dy * dy);
      var a = st.v.ParamHairTail * 14 * D2R * Math.pow(clamp(d / 70, 0, 1), 1.2);
      if (a) rotate(TIE[0], TIE[1], Math.cos(a), Math.sin(a));
      head(st, -10);
    },
    legR: function (st) { leg(st, "R"); },
    legL: function (st) { leg(st, "L"); },
    shoeR: function (st) { leg(st, "R"); },
    shoeL: function (st) { leg(st, "L"); },
    dress: function (st) {
      X += st.v.ParamSkirt * 2.6 * smooth(296, 360, Y);
      torso(st);
    },
    armR: function (st) { arm(st, "R"); },
    armL: function (st) { arm(st, "L"); },
    neck: torso,
    collar: torso,
    ear: function (st) { head(st, -4); },
    face: function (st) { head(st, faceZ(X, Y)); },
    mouth: function (st) { head(st, faceZ(X, Y) + 2); },
    blush: function (st) { head(st, faceZ(X, Y) + 1); },
    tears: function (st) { head(st, faceZ(X, Y) + 3); },
    gloom: function (st) { head(st, faceZ(X, Y) + 4); },
    ballR: function (st) { var e = st.eyeR; X += e.gx; Y += e.gy; head(st, faceZ(X, Y) + 3); },
    ballL: function (st) { var e = st.eyeL; X += e.gx; Y += e.gy; head(st, faceZ(X, Y) + 3); },
    lidR: function (st) { lid(st, st.eyeR); head(st, faceZ(X, Y) + 4); },
    lidL: function (st) { lid(st, st.eyeL); head(st, faceZ(X, Y) + 4); },
    browR: function (st) { brow(st, st.eyeR); head(st, faceZ(X, Y) + 5); },
    browL: function (st) { brow(st, st.eyeL); head(st, faceZ(X, Y) + 5); },
    sideR: function (st) { side(st); head(st, 14); },
    sideL: function (st) { side(st); head(st, 14); },
    sweat: function (st) { Y += st.v.ParamSweat * 2; head(st, 14); },
    frontHair: function (st) {
      X += st.v.ParamHairFront * 2.2 * smooth(150, 187, Y);
      head(st, faceZ(X, Y) * 0.9 + 9);
    },
    ahoge: function (st) {
      var dx = X - AHOGE[0], dy = Y - AHOGE[1], d = Math.sqrt(dx * dx + dy * dy);
      var a = st.v.ParamAhoge * 20 * D2R * clamp(d / 30, 0, 1);
      if (a) rotate(AHOGE[0], AHOGE[1], Math.cos(a), Math.sin(a));
      head(st, 24);
    },
    anger: function (st) { head(st, 20); }
  };
  function side(st) {
    X += st.v.ParamHairSide * 4.5 * Math.pow(smooth(160, 256, Y), 1.3);
  }
  function brow(st, e) {
    // the crease follows the lid a little as it closes
    Y += -e.by * 2.4 + e.t * 2.0 * (1 - e.s) - e.s * 1.2 - e.over * 7;
    rotate(e.brow[0], e.brow[1], e.bc, e.bs);
  }

  // ---- drawn parts ----------------------------------------------------
  var SPRITES = [
    { id: "mouth", x: MOUTH[0] - 8, y: MOUTH[1] - 6, w: 16, h: 12, res: 10, cell: 2,
      key: function (v) { return Math.round(v.ParamMouthForm * 60) + ":" + Math.round(v.ParamMouthOpenY * 60); },
      draw: drawMouth },
    { id: "blush", x: 86, y: 213, w: 80, h: 18, res: 6, draw: drawBlush },
    { id: "tears", x: 88, y: 212, w: 76, h: 34, res: 6, draw: drawTears },
    { id: "gloom", x: 88, y: 166, w: 80, h: 38, res: 6, draw: drawGloom },
    { id: "sweat", x: 168, y: 158, w: 14, h: 22, res: 10, cell: 7, draw: drawSweat },
    { id: "anger", x: 146, y: 132, w: 20, h: 20, res: 10, cell: 10, draw: drawAnger }
  ];

  /* The drawn mouth is a soft dot a pixel and a half wide, so that is
     where every shape starts from: a smile or a frown is that dot pulled
     into a curve, an open mouth is the curve parted. */
  function drawMouth(g, v) {
    var f = v.ParamMouthForm, o = v.ParamMouthOpenY, cx = MOUTH[0], cy = MOUTH[1];
    var w = 2.2 + 2.8 * Math.max(f, 0) + 1.4 * Math.max(-f, 0) + 2.6 * o;
    var ey = cy - 0.7 * f, lx = cx - w / 2, rx = cx + w / 2;
    g.lineCap = "round"; g.lineJoin = "round";
    if (o < 0.04) {
      var k = smooth(0.08, 0.35, Math.abs(f));
      if (k < 1) {
        g.globalAlpha = 1 - k;
        g.fillStyle = "#733232";
        g.beginPath(); g.ellipse(cx, cy, 1.05, 0.62, 0, 0, Math.PI * 2); g.fill();
      }
      if (k > 0) {
        g.globalAlpha = k;
        g.strokeStyle = "#5e2626"; g.lineWidth = 0.6;
        g.beginPath(); g.moveTo(lx, ey); g.quadraticCurveTo(cx, cy + f * 1.5, rx, ey); g.stroke();
      }
      g.globalAlpha = 1;
      return;
    }
    var depth = 0.9 + 5.4 * o;
    var path = function () {
      g.beginPath();
      g.moveTo(lx, ey);
      g.quadraticCurveTo(cx, cy - 0.4 + f * 0.9, rx, ey);
      g.quadraticCurveTo(cx + w * 0.1, cy + depth + f * 1.3, cx, cy + depth * 0.95 + f * 1.1);
      g.quadraticCurveTo(cx - w * 0.1, cy + depth + f * 1.3, lx, ey);
      g.closePath();
    };
    path(); g.fillStyle = "#7a2630"; g.fill();
    g.save(); path(); g.clip();
    g.fillStyle = "#d9727a";
    g.beginPath(); g.ellipse(cx, cy + depth * 0.95 + f * 1.1, w * 0.3, depth * 0.38, 0, 0, Math.PI * 2); g.fill();
    g.restore();
    path(); g.strokeStyle = "#3d1318"; g.lineWidth = 0.5; g.stroke();
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

  function drawGloom(g) {
    var xs = [93, 99, 105, 111, 117, 123, 129, 135, 141, 147, 153, 159];
    xs.forEach(function (x, i) {
      var len = 16 + ((i * 7) % 5) * 3.2;
      var lg = g.createLinearGradient(0, 168, 0, 168 + len);
      lg.addColorStop(0, "rgba(70,60,110,0.75)");
      lg.addColorStop(1, "rgba(70,60,110,0)");
      g.strokeStyle = lg; g.lineWidth = 0.7; g.lineCap = "round";
      g.beginPath(); g.moveTo(x, 168); g.lineTo(x, 168 + len); g.stroke();
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
  var BASE = ["hairBack", "ponytail", "legR", "legL", "shoeR", "shoeL", "dress", "armR", "armL", "neck", "collar",
              "ear", "face", "blush", "mouth", "ballR", "ballL", "lidR", "lidL", "browR", "browL", "gloom", "tears",
              "sideR", "sideL", "sweat", "frontHair", "ahoge", "anger"];

  var st = { v: null };

  function prepare(v) {
    st.v = v;
    var yaw = v.ParamAngleX * 0.4 * D2R, pitch = v.ParamAngleY * 0.35 * D2R, roll = v.ParamAngleZ * 0.5 * D2R;
    st.yc = Math.cos(yaw); st.ys = Math.sin(yaw);
    st.pc = Math.cos(pitch); st.ps = Math.sin(pitch);
    st.rc = Math.cos(roll); st.rs = Math.sin(roll);
    var bz = v.ParamBodyAngleZ * 0.6 * D2R;
    st.bzc = Math.cos(bz); st.bzs = Math.sin(bz);
    st.bx = v.ParamBodyAngleX; st.by = v.ParamBodyAngleY;
    st.breath = v.ParamBreath; st.lift = v.ParamBodyY;
    st.neck = anchor(st, NECK);
    st.sr = anchor(st, ARM.R.s);
    st.sl = anchor(st, ARM.L.s);
    // raising is outward for both arms, so the right arm (screen left)
    // turns the other way round from the left
    st.arm = {
      R: { s: v.ParamArmRA * D2R, e: v.ParamArmRB * D2R, w: v.ParamHandR * D2R },
      L: { s: -v.ParamArmLA * D2R, e: -v.ParamArmLB * D2R, w: -v.ParamHandL * D2R }
    };
    st.leg = { R: v.ParamLegR * 0.8 * D2R, L: -v.ParamLegL * 0.8 * D2R };
    st.eyeR = eyeState(v, "R");
    st.eyeL = eyeState(v, "L");
    st.clipR = eyeClip(st, st.eyeR, "lidR", "ballR");
    st.clipL = eyeClip(st, st.eyeL, "lidL", "ballL");
    return st;
  }

  /* The edges the eyeball is clipped against, in the same deformed space
     as the eyeball itself: the lash's lower edge (pulled 0.7 into the lash,
     so its soft bottom still sits over iris) pushed through the lid's own
     deformers, and a lower edge that a smile pushes up. */
  function eyeClip(st, e, lidId, ballId) {
    var top = new Float32Array(16), bot = new Float32Array(16);
    var x0 = e.edge[0][0], x1 = e.edge[e.edge.length - 1][0];
    var ox = e.c[0], oy = e.c[1];
    for (var i = 0; i < 8; i++) {
      var x = x0 + (x1 - x0) * i / 7;
      X = x; Y = edgeAt(e.edge, x) - 0.7;
      DEFORM[lidId](st);
      top[i * 2] = X - ox; top[i * 2 + 1] = Y - oy;
      var u = clamp((x - e.lc) / e.hw, -1.2, 1.2);
      X = x; Y = e.bottom + 4 + (e.bottom - 8 + 4 * u * u - e.bottom - 4) * e.s * (1 - e.t);
      head(st, faceZ(X, Y) + 3);
      bot[i * 2] = X - ox; bot[i * 2 + 1] = Y - oy;
    }
    return { origin: [ox, oy], top: top, bot: bot };
  }

  function deform(id, rest, out, s) {
    var f = DEFORM[id];
    for (var i = 0, n = rest.length; i < n; i += 2) {
      X = rest[i]; Y = rest[i + 1];
      f(s);
      out[i] = X; out[i + 1] = Y;
    }
  }

  function order(s) {
    var o = BASE.slice();
    // an arm raised past level comes in front of the hair beside her face
    [["armR", s.v.ParamArmRA], ["armL", s.v.ParamArmLA]].forEach(function (a) {
      if (a[1] > 95) { o.splice(o.indexOf(a[0]), 1); o.splice(o.indexOf("frontHair"), 0, a[0]); }
    });
    return o;
  }

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
      browR: { cell: 2 }, browL: { cell: 2 }, armR: { cell: 3 }, armL: { cell: 3 },
      face: { cell: 4 }, frontHair: { cell: 4 }, ahoge: { cell: 3 }, ponytail: { cell: 4 },
      sideR: { cell: 4 }, sideL: { cell: 4 }, legR: { cell: 4 }, legL: { cell: 4 }
    },
    sprites: SPRITES,
    // the part of the drawing worth looking at: x 0..224, y 70..450
    frame: { cx: 112, cy: 262, w: 240, h: 392 },
    landmarks: { hip: HIP, neck: NECK, head: HC, mouth: MOUTH, eyes: { R: EYE.R.c, L: EYE.L.c } },
    prepare: prepare,
    deform: deform,
    order: order,
    alpha: alpha,
    clip: clip
  };
})();
