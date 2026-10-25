/* creature.js — the aswang: what you hear for a whole night and see for a
 * second at a time.
 *
 * Built here, not loaded: a tall woman-shape with arms too long for her, in
 * a dress that was white once, hair to the waist hanging over a face that is
 * mostly mouth. Drawn the way Hacks draws its bodies (hacks/js/skeleton.js):
 * a pose is a set of joint positions worked out from what the body is doing
 * — walking, listening, staring, galloping on all fours in a chase — with
 * the same two-bone solve for every elbow and knee, and the meshes are hung
 * between the joints. No animation files: the gait comes from the distance
 * actually walked, so a foot never slides.
 *
 * Lit by nothing of its own. In the dark it is a shape, and two points of
 * eyeshine when your lantern catches them — the research's "brief flashes":
 * the light you carry is the only way you ever see it whole. Where light
 * does fall on it, its edges catch it the way wet skin does (a sheen added
 * to the lighting, in proportion to the light, so it never glows in the
 * dark), and when it is on you its face is a scream.
 *
 * The same body, built with { ghost: true }, is what comes out of the lamps
 * at the end (ghosts.js): a woman in white, floating, her legs gone into the
 * hem of a dress that trails on the floor, seen through — more solid at her
 * edges than in her middle — and lit from inside with a cold light, so that
 * unlike the aswang you see her coming across a dark room. She casts no
 * shadow. She rises out of the lamp's light, drifts with her arms down while
 * she searches, and reaches for you when she has you; a mist comes off her
 * hem as she goes. */

import * as THREE from "three";

const THIGH = 0.5, SHIN = 0.54, UPPER = 0.5, FORE = 0.56;

/* ---- tiny vector helpers on arrays, as in hacks/js/skeleton.js ---- */
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const rotX = (v, a) => { const c = Math.cos(a), s = Math.sin(a); return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c]; };

/* Two-bone IK: where the middle joint goes, bent towards `hint`. Lifted from
   hacks/js/skeleton.js joint(). */
function joint(root, target, l1, l2, hint) {
  let d = sub(target, root);
  let dl = len(d);
  const max = l1 + l2 - 0.001;
  if (dl > max) { d = mul(d, max / dl); target = add(root, d); dl = max; }
  if (dl < 0.02) return add(root, mul(hint, l1));
  const ax = mul(d, 1 / dl);
  const a = (l1 * l1 - l2 * l2 + dl * dl) / (2 * dl);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  let bend = sub(hint, mul(ax, hint[0] * ax[0] + hint[1] * ax[1] + hint[2] * ax[2]));
  const bl = len(bend) || 1;
  bend = mul(bend, 1 / bl);
  return add(add(root, mul(ax, a)), mul(bend, h));
}

/**
 * Pose: joint positions in the body's own frame (metres, feet on y = 0,
 * facing +z, x to its left... we keep x as its right-hand side mirrored by
 * the group's rotation). `s`: { mode, ph, amp, look: [yaw, pitch], tilt, t, reach }.
 */
function pose(s) {
  const ph = s.ph, t = s.t;
  const P = {};
  const amp = s.amp;
  if (s.mode === "run") {
    // on all fours: the long arms are front legs
    const lean = 1.15;
    const pelvis = [0, 0.95 + Math.abs(Math.sin(ph)) * 0.08, -0.35];
    const up = (v) => add(pelvis, rotX(v, lean));
    P.pelvis = pelvis; P.chest = up([0, 0.6, 0]); P.neck = up([0, 0.78, 0]);
    P.head = add(P.neck, [0, 0.12, 0.16]);
    P.lSh = up([-0.19, 0.56, 0]); P.rSh = up([0.19, 0.56, 0]);
    P.lHip = add(pelvis, [-0.12, -0.03, 0]); P.rHip = add(pelvis, [0.12, -0.03, 0]);
    const g = (o, k) => Math.max(0, Math.sin(ph + o)) * k;
    P.lHand = [-0.22, 0.05 + g(0, 0.3), P.chest[2] + 0.35 + Math.cos(ph) * 0.45];
    P.rHand = [0.22, 0.05 + g(0.6, 0.3), P.chest[2] + 0.35 + Math.cos(ph + 0.6) * 0.45];
    P.lFoot = [-0.16, 0.06 + g(Math.PI, 0.25), -0.35 + Math.cos(ph + Math.PI) * 0.5];
    P.rFoot = [0.16, 0.06 + g(Math.PI + 0.6, 0.25), -0.35 + Math.cos(ph + Math.PI + 0.6) * 0.5];
    P.lElb = joint(P.lSh, P.lHand, UPPER, FORE, [-0.3, 0.2, -1]);
    P.rElb = joint(P.rSh, P.rHand, UPPER, FORE, [0.3, 0.2, -1]);
    P.lKnee = joint(P.lHip, P.lFoot, THIGH, SHIN, [-0.2, 0.3, 1]);
    P.rKnee = joint(P.rHip, P.rFoot, THIGH, SHIN, [0.2, 0.3, 1]);
    P.headDir = [0, 0.15, 1];
    return P;
  }
  // upright: hunched, the head pushed forward and down
  let lean = 0.42 + amp * 0.12, pelvisY = 1.0 + Math.abs(Math.sin(ph)) * 0.035 * amp;
  if (s.mode === "stare") { lean = 0.18; pelvisY = 1.03 + Math.sin(t * 1.1) * 0.01; }
  if (s.mode === "kill") { lean = 0.6; pelvisY = 0.95; }
  if (s.mode === "rip") { lean = 0.3; pelvisY = 1.0; }
  if (s.mode === "flinch") { lean = -0.25; pelvisY = 0.98; }
  if (s.mode === "drift" || s.mode === "rise") { lean = 0.12; pelvisY = 1.02; }
  if (s.mode === "reach") { lean = 0.32; pelvisY = 1.0; }
  const pelvis = [0, pelvisY, 0];
  const up = (v) => add(pelvis, rotX(v, lean));
  P.pelvis = pelvis; P.chest = up([0, 0.66, 0]); P.neck = up([0, 0.84, 0.05]);
  P.head = add(P.neck, rotX([0, 0.13, 0.16], -lean * 0.2));
  P.lSh = up([-0.19, 0.62, 0]); P.rSh = up([0.19, 0.62, 0]);
  P.lHip = [-0.11, pelvisY - 0.03, 0]; P.rHip = [0.11, pelvisY - 0.03, 0];
  // feet
  const st = 0.42 * amp, lift = 0.16 * amp;
  P.lFoot = [-0.13, 0.05 + Math.max(0, Math.cos(ph)) * lift, Math.sin(ph) * st];
  P.rFoot = [0.13, 0.05 + Math.max(0, Math.cos(ph + Math.PI)) * lift, Math.sin(ph + Math.PI) * st];
  // hands: dangling past the knees, swinging a little behind the legs
  const swing = (o) => Math.sin(ph + o - 0.5) * 0.18 * amp;
  P.lHand = [-0.26, 0.42, P.chest[2] * 0.6 + swing(Math.PI)];
  P.rHand = [0.26, 0.42 + Math.sin(t * 0.7) * 0.01, P.chest[2] * 0.6 + swing(0)];
  if (s.mode === "stare") { P.rHand = [0.3, 0.5, 0.15]; P.lHand = [-0.22, 0.44, 0.05]; }
  if (s.mode === "rip" || s.mode === "kill") {
    const r = s.mode === "kill" ? 0.75 : 0.6;
    P.lHand = up([-0.32, 0.55, r + Math.sin(t * 30) * 0.03]);
    P.rHand = up([0.32, 0.6, r + Math.cos(t * 27) * 0.03]);
  }
  if (s.mode === "flinch") { P.lHand = up([-0.12, 0.85, 0.3]); P.rHand = up([0.14, 0.9, 0.28]); }
  // the dead: arms hanging as she drifts; held out to you when she has you
  if (s.mode === "drift" || s.mode === "rise") { P.lHand = [-0.25, 0.46, 0.04 + Math.sin(t * 0.9) * 0.03]; P.rHand = [0.25, 0.47, 0.04 + Math.sin(t * 0.9 + 1) * 0.03]; }
  if (s.mode === "reach") { P.lHand = up([-0.17, 0.66, 0.66 + Math.sin(t * 7) * 0.04]); P.rHand = up([0.17, 0.7, 0.64 + Math.cos(t * 6.3) * 0.04]); }
  P.lElb = joint(P.lSh, P.lHand, UPPER, FORE, [-0.5, -0.2, -0.8]);
  P.rElb = joint(P.rSh, P.rHand, UPPER, FORE, [0.5, -0.2, -0.8]);
  P.lKnee = joint(P.lHip, P.lFoot, THIGH, SHIN, [0, 0.1, 1]);
  P.rKnee = joint(P.rHip, P.rFoot, THIGH, SHIN, [0, 0.1, 1]);
  P.headDir = [0, -0.25, 1];
  return P;
}

/* ------------------------------------------------------------------ */

/* The two looks, as additions to three's lighting: `patch` on a material is
   run when its shader is built (render.js composes it with its own bounce
   light), and the uniforms are the creature's own. */
const SHEEN_GLSL = `
{
  float crF = pow( 1.0 - saturate( dot( normal, geometryViewDir ) ), 3.0 );
  outgoingLight += crF * crRim * ( reflectedLight.directDiffuse + reflectedLight.indirectDiffuse ) * vec3( 2.4, 2.7, 3.0 );
}`;
const GHOST_GLSL = `
{
  float crF = pow( 1.0 - saturate( abs( dot( normal, geometryViewDir ) ) ), 2.2 );
  outgoingLight += crGlow * ( 0.22 + crF * 1.5 ) * crFade;
  diffuseColor.a *= mix( 0.22 + 0.78 * crF, 1.0, crSolid ) * crFade;
}`;

export function makeCreature(T, opts) {
  const ghost = !!(opts && opts.ghost);
  const group = new THREE.Group();
  group.visible = false;
  const U = { crRim: { value: 0.55 }, crGlow: { value: new THREE.Color("#9db4e0") }, crFade: { value: 1 }, crSolid: { value: 0 } };
  // the sheen is for skin; hair and cloth are not wet, and the dead get their look everywhere
  const look = (m, wet) => {
    if (!ghost && !wet) return m;
    m.userData.patchKey = ghost ? "ghost" : "sheen";
    m.userData.patch = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.fragmentShader = (ghost ? "uniform vec3 crGlow;\nuniform float crFade;\nuniform float crSolid;\n" : "uniform float crRim;\n") + sh.fragmentShader.replace("#include <opaque_fragment>", (ghost ? GHOST_GLSL : SHEEN_GLSL) + "\n#include <opaque_fragment>");
    };
    if (ghost) Object.assign(m, { transparent: true, depthWrite: false });
    return m;
  };
  // dark and wet: under a lantern it is a shape with highlights on it, not a
  // doll. The dead are pale and see-through, and their dress is white.
  const skin = look(new THREE.MeshStandardMaterial({ color: ghost ? "#c9d2dc" : "#55544c", map: T.skin(), roughness: 0.34, metalness: 0, opacity: ghost ? 0.7 : 1 }), true);
  const dark = look(new THREE.MeshStandardMaterial({ color: "#2a2724", roughness: 0.8 }));
  const clothMat = look(new THREE.MeshStandardMaterial({ map: T.cloth(), color: ghost ? "#e4e7ec" : "#6a645a", alphaMap: T.clothAlpha(), alphaTest: ghost ? 0.25 : 0.5, side: THREE.DoubleSide, roughness: 0.95, opacity: ghost ? 0.75 : 1 }));
  const faceTex = ghost ? T.ghostFace() : T.face(), screamTex = ghost ? faceTex : T.faceScream();
  const faceMat = look(new THREE.MeshStandardMaterial({ map: faceTex, color: ghost ? "#dfe4ea" : "#a9a89f", roughness: 0.72, opacity: ghost ? 0.9 : 1 }), true);

  // a limb: a tapered cylinder from 0 to 1 along y, stretched between joints
  const limbs = [];
  const limb = (rA, rB, mat) => {
    const g = new THREE.CylinderGeometry(rB, rA, 1, 9, 1);
    g.translate(0, 0.5, 0);
    const m = new THREE.Mesh(g, mat || skin);
    m.castShadow = true;
    group.add(m);
    limbs.push(m);
    return m;
  };
  const ball = (r, mat) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), mat || skin); m.castShadow = true; group.add(m); return m; };
  const parts = {
    spine: limb(0.11, 0.15), neck: limb(0.045, 0.038),
    lUp: limb(0.045, 0.034), lFo: limb(0.034, 0.024), rUp: limb(0.045, 0.034), rFo: limb(0.034, 0.024),
    lTh: limb(0.065, 0.045), lSh: limb(0.045, 0.03), rTh: limb(0.065, 0.045), rSh: limb(0.045, 0.03),
    pelvis: ball(0.13), chest: ball(0.16), lSho: ball(0.05), rSho: ball(0.05), lElb: ball(0.035), rElb: ball(0.035), lKn: ball(0.045), rKn: ball(0.045)
  };
  parts.pelvis.scale.set(1.05, 0.75, 0.8);
  parts.chest.scale.set(1.0, 0.85, 0.65);
  // hands: long fingers, curled
  const hand = () => {
    const h = new THREE.Group();
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.03), skin);
    palm.position.y = -0.05; h.add(palm);
    for (let k = 0; k < 4; k++) {
      const f = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.011, 0.2, 5), skin);
      f.geometry.translate(0, -0.1, 0);
      f.position.set(-0.03 + k * 0.02, -0.1, 0);
      f.rotation.x = 0.35 + k * 0.05;
      f.rotation.z = (k - 1.5) * 0.08;
      h.add(f);
    }
    h.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    group.add(h);
    return h;
  };
  const lHand = hand(), rHand = hand();
  // feet
  const foot = () => { const f = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.045, 0.22), dark); f.castShadow = true; group.add(f); return f; };
  const lFoot = foot(), rFoot = foot();
  // the head: one long skull with the face painted round its front, and a
  // cap of hair over the crown that the curtains hang from
  const head = new THREE.Group();
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.125, 20, 14), faceMat);
  skull.scale.set(0.92, 1.32, 1.05);
  const eyes = [];
  for (const sx of [-1, 1]) {
    const e = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.glow(), color: ghost ? "#cfe0ff" : "#ffe2a0", blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    e.scale.set(0.05, 0.05, 1);
    e.position.set(sx * 0.045, 0.026, 0.124);
    head.add(e);
    eyes.push(e);
  }
  head.add(skull);
  head.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  group.add(head);

  // hair: curtains of strands, not strands. A long fall down the back and
  // sides, and two hanging over the face with a slit between them. Each is
  // rings from the scalp down, and each ring lags the one above it, so the
  // hair swings when the head turns and trails when it moves.
  const hairMat = look(new THREE.MeshStandardMaterial({ color: "#0d0c0b", map: T.hair(), alphaMap: T.hairAlpha(), alphaTest: 0.38, side: THREE.DoubleSide, roughness: 0.7, opacity: ghost ? 0.95 : 1 }));
  const curtain = (a0, a1, cols, rings, seg, r0, flare, len) => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array((cols + 1) * rings * 3), uv = new Float32Array((cols + 1) * rings * 2), idx = [];
    for (let k = 0; k < rings; k++) for (let c = 0; c <= cols; c++) { const i = k * (cols + 1) + c; uv[i * 2] = c / cols * len; uv[i * 2 + 1] = 1 - k / (rings - 1); }
    for (let k = 0; k < rings - 1; k++) for (let c = 0; c < cols; c++) { const i = k * (cols + 1) + c; idx.push(i, i + cols + 1, i + 1, i + 1, i + cols + 1, i + cols + 2); }
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, hairMat);
    m.frustumCulled = false; m.castShadow = true;
    return { m, g, pos, a0, a1, cols, rings, seg, r0, flare, c: [], init: false };
  };
  const curtains = [
    curtain(Math.PI * 0.32, Math.PI * 1.68, 18, 9, 0.085, 0.135, 0.02, 3),
    curtain(-Math.PI * 0.34, -Math.PI * 0.045, 5, 7, 0.08, 0.13, 0.012, 0.8),
    curtain(Math.PI * 0.045, Math.PI * 0.34, 5, 7, 0.08, 0.13, 0.012, 0.8)
  ];
  const hair = new THREE.Group();
  for (const c of curtains) hair.add(c.m);
  const scalp = new THREE.Mesh(new THREE.SphereGeometry(0.138, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.42), hairMat);
  scalp.scale.set(0.95, 1.32, 1.08);
  head.add(scalp);
  // the hair hangs in the world, so it lives outside the body's group
  const hairRoot = new THREE.Group();
  hairRoot.add(hair);

  // the dress: rings from the chest to below the knee
  const RS = 16, RR = 6;
  const dressGeo = new THREE.CylinderGeometry(1, 1, 1, RS, RR - 1, true);
  const dress = new THREE.Mesh(dressGeo, clothMat);
  dress.castShadow = true;
  dress.frustumCulled = false;
  group.add(dress);

  // the dead: legs gone into the hem, and no shadow on anything
  if (ghost) {
    // (and what would show through her as a mannequin's insides)
    for (const k of ["lTh", "lSh", "rTh", "rSh", "lKn", "rKn", "spine", "pelvis"]) parts[k].visible = false;
    lFoot.visible = rFoot.visible = false;
    for (const o of [group, hairRoot]) o.traverse((m) => { if (m.isMesh) m.castShadow = false; });
    group.renderOrder = hairRoot.renderOrder = 3;
  }
  // and a mist off the hem as she moves: soft points that rise and fade
  const MIST = ghost ? 48 : 0;
  const mistPos = new Float32Array(Math.max(1, MIST) * 3), mist = [];
  const mistGeo = new THREE.BufferGeometry();
  mistGeo.setAttribute("position", new THREE.BufferAttribute(mistPos, 3));
  const mistPts = new THREE.Points(mistGeo, new THREE.PointsMaterial({ map: T.glow(), color: "#a8bcdc", size: 0.35, transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending }));
  mistPts.frustumCulled = false; mistPts.visible = ghost;
  hairRoot.add(mistPts);
  for (let i = 0; i < MIST; i++) mist.push({ life: 0, x: 0, y: -99, z: 0, vx: 0, vy: 0, vz: 0 });

  let simInit = false, twitchT = 0, twitch = [0, 0, 0], phase = 0, lastWalked = 0, eyeK = 0, wasActive = false, flick = 0;
  const tmp = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0);

  function place(m, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], l = Math.hypot(dx, dy, dz) || 1e-4;
    m.position.set(a[0], a[1], a[2]);
    tmp.set(dx / l, dy / l, dz / l);
    tmpQ.setFromUnitVectors(UP, tmp);
    m.quaternion.copy(tmpQ);
    m.scale.set(1, l, 1);
  }

  function update(h, dt, ctx) {
    const show = h.active && h.state !== "absent";
    group.visible = show;
    hair.visible = show;
    mistPts.visible = show && ghost;
    if (!show) { wasActive = false; return; }
    if (!hairRoot.parent && group.parent) group.parent.add(hairRoot);
    const t = ctx.t;
    // the gait follows the distance walked
    const dw = h.walked - lastWalked; lastWalked = h.walked;
    const running = h.state === "chase" && h.speed > 3.3;
    phase += dw * (running ? 2.6 : 3.4);
    const amp = Math.min(1, (h.speed || 0) / 1.4) * (h.moving ? 1 : 0);
    let mode = running ? "run" : "walk";
    if (h.state === "stare") mode = "stare";
    if (h.state === "rip" && h.ripT > 0) mode = "rip";
    if (h.burnedT > 4.5) mode = "flinch";
    if (ghost) mode = h.state === "chase" ? "reach" : h.state === "rise" ? "rise" : "drift";
    if (ctx.killedBy && ctx.kill >= 0) mode = "kill";
    const P = pose({ mode, ph: phase, amp, t });
    // the face it shows you at the end is a scream
    const want = mode === "kill" ? screamTex : faceTex;
    if (faceMat.map !== want) faceMat.map = want;
    // and when she has you, she is not see-through any more
    U.crSolid.value = mode === "kill" ? 0.85 : 0;

    // where it stands; at the kill, right in front of you
    let gx = h.x, gz = h.z, gy = 0, gyaw = h.yaw;
    if (mode === "kill" && ctx.scares === "full") {
      // the face comes at you: placed so the head lands in front of the eyes,
      // rushing in from a metre to a hand's breadth in the first fifth of a second
      const cam = ctx.camera, fwd = new THREE.Vector3(); cam.getWorldDirection(fwd);
      fwd.y = 0; fwd.normalize();
      // (not closer than the lantern in your hand, or the face is lit from behind)
      const k = Math.min(1, ctx.kill / 0.2), dist = 1.15 - k * 0.5;
      gyaw = Math.atan2(-fwd.x, -fwd.z);
      const s0 = Math.sin(gyaw), c0 = Math.cos(gyaw);
      const hx = P.head[0] * c0 + P.head[2] * s0, hz = -P.head[0] * s0 + P.head[2] * c0;
      gx = cam.position.x + fwd.x * dist - hx; gz = cam.position.z + fwd.z * dist - hz;
      gy = cam.position.y - 0.06 - P.head[1];
    } else if (mode === "kill") { group.visible = false; hair.visible = false; mistPts.visible = false; return; }
    else if (ghost) {
      // she floats a hand above the floor, and comes up out of the lamp's light
      // into it; she is never quite steady, and now and then nearly not there
      const k = Math.min(1, Math.max(0, h.riseK === undefined ? 1 : h.riseK)), e = k * k * (3 - 2 * k);
      gy = 0.07 + Math.sin(t * 1.6 + h.x) * 0.035 - (1 - e) * 1.75;
      flick = Math.max(0, flick - dt);
      if (flick <= 0 && Math.random() < dt * 0.6) flick = 0.08 + Math.random() * 0.12;
      U.crFade.value = e * (0.85 + 0.15 * Math.sin(t * 13 + h.z * 3)) * (flick > 0 ? 0.25 : 1);
    }
    if (ghost && mode === "kill") U.crFade.value = 1;
    // at the kill the hair over the face parts
    curtains[1].m.visible = curtains[2].m.visible = mode !== "kill";
    group.position.set(gx, gy, gz);
    group.rotation.y = gyaw;
    group.updateMatrixWorld(true);

    // limbs between joints
    place(parts.spine, P.pelvis, P.chest); place(parts.neck, P.chest, P.head);
    place(parts.lUp, P.lSh, P.lElb); place(parts.lFo, P.lElb, P.lHand);
    place(parts.rUp, P.rSh, P.rElb); place(parts.rFo, P.rElb, P.rHand);
    place(parts.lTh, P.lHip, P.lKnee); place(parts.lSh, P.lKnee, P.lFoot);
    place(parts.rTh, P.rHip, P.rKnee); place(parts.rSh, P.rKnee, P.rFoot);
    parts.pelvis.position.set(...P.pelvis); parts.chest.position.set(...add(P.chest, [0, -0.08, 0]));
    parts.lSho.position.set(...P.lSh); parts.rSho.position.set(...P.rSh);
    parts.lElb.position.set(...P.lElb); parts.rElb.position.set(...P.rElb);
    parts.lKn.position.set(...P.lKnee); parts.rKn.position.set(...P.rKnee);
    parts.chest.rotation.x = mode === "run" ? 1.1 : 0.3;
    for (const [hd, at, from] of [[lHand, P.lHand, P.lElb], [rHand, P.rHand, P.rElb]]) {
      hd.position.set(...at);
      const d = sub(at, from); tmp.set(d[0], d[1], d[2]).normalize();
      hd.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), tmp);
    }
    lFoot.position.set(P.lFoot[0], 0.03 + P.lFoot[1] - 0.05, P.lFoot[2] + 0.05);
    rFoot.position.set(P.rFoot[0], 0.03 + P.rFoot[1] - 0.05, P.rFoot[2] + 0.05);

    // the head: twitches, a tilt no neck should allow, and it looks at you
    twitchT -= dt;
    if (twitchT <= 0) {
      twitchT = 0.6 + Math.random() * 2.2;
      twitch = [(Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 1.1];
    }
    head.position.set(...P.head);
    const toCam = new THREE.Vector3().copy(ctx.camera.position).sub(group.localToWorld(new THREE.Vector3(...P.head)));
    const local = toCam.clone().applyQuaternion(group.quaternion.clone().invert());
    const watching = ghost || h.sees || h.state === "stare" || h.state === "chase" || mode === "kill";
    let ry = watching ? Math.atan2(local.x, local.z) : twitch[0] * 0.6 + Math.sin(t * 0.5) * 0.4;
    ry = Math.max(-1.4, Math.min(1.4, ry));
    const rx = watching ? -Math.atan2(local.y, Math.hypot(local.x, local.z)) * 0.8 : 0.35 + twitch[1] * 0.4;
    const rz = mode === "stare" ? 0.75 + Math.sin(t * 0.8) * 0.05 : mode === "run" ? 0 : twitch[2] * 0.45;
    const snap = Math.min(1, dt * (watching ? 6 : 14));
    head.rotation.order = "YXZ";
    head.rotation.y += (ry - head.rotation.y) * snap;
    head.rotation.x += (rx - head.rotation.x) * snap;
    head.rotation.z += (rz - head.rotation.z) * snap;
    if (mode === "run") head.rotation.x = -0.6;

    // eyeshine: only when your light is on its face
    const facing = Math.cos(head.rotation.y - Math.atan2(local.x, local.z));
    const dist = toCam.length();
    const shine = Math.max(0, facing) * Math.max(0, 1 - dist / 14) * (0.25 + ctx.lanternPower) + ctx.flash * 0.8;
    eyeK += (shine - eyeK) * Math.min(1, dt * 10);
    // up close they are pinpoints, deep in the sockets
    for (const e of eyes) { e.material.opacity = Math.min(1, eyeK * 1.4); e.scale.setScalar(mode === "kill" ? 0.012 : 0.035 + eyeK * 0.03); }
    // hers are two cold points in the dark of her eyes, always
    if (ghost) for (const e of eyes) { e.material.opacity = 0.55 * U.crFade.value; e.scale.setScalar(mode === "kill" ? 0.01 : 0.022); }

    // the dress: rings from the chest down past the knees
    const pos = dressGeo.attributes.position;
    const knees = mul(add(P.lKnee, P.rKnee), 0.5);
    const rings = [
      [add(P.chest, [0, -0.05, -0.02]), 0.16, 0.12],
      [add(P.chest, [0, -0.25, -0.02]), 0.14, 0.11],
      [add(P.pelvis, [0, 0.12, 0]), 0.15, 0.12],
      [add(P.pelvis, [0, -0.08, 0]), 0.19, 0.15],
      [add(mul(add(P.pelvis, knees), 0.5), [0, -0.05, 0]), 0.22, 0.19],
      [add(knees, [0, -0.3, 0]), 0.27, 0.24]
    ];
    if (mode === "run") { rings[4][0] = add(P.pelvis, [0, -0.2, -0.15]); rings[5][0] = add(P.pelvis, [0, -0.32, -0.3]); }
    // hers falls to the floor and trails behind her as she goes
    if (ghost && mode !== "kill") {
      const trail = 0.1 + (h.speed || 0) * 0.09;
      rings[4] = [add(P.pelvis, [0, -0.5, -trail * 0.4]), 0.25, 0.22];
      rings[5] = [[0, 0.02 - gy, -trail], 0.33, 0.3];
    }
    const sway = Math.sin(phase) * 0.04 * amp + Math.sin(t * 1.3) * 0.015;
    for (let r = 0; r < RR; r++) {
      const [c, rx2, rz2] = rings[RR - 1 - r];
      for (let k = 0; k <= RS; k++) {
        const a = (k / RS) * Math.PI * 2;
        const i = r * (RS + 1) + k;
        const flare = r === 0 ? 1 + Math.sin(a * 5 + t * 2) * 0.06 : 1;
        pos.setXYZ(i, c[0] + Math.sin(a) * rx2 * flare, c[1], c[2] + Math.cos(a) * rz2 * flare + (r <= 1 ? sway : 0));
      }
    }
    pos.needsUpdate = true;
    dressGeo.computeVertexNormals();

    // hair: each curtain's rings follow the one above, late
    head.updateMatrixWorld(true);
    const reset = !simInit || !wasActive;
    wasActive = true;
    const hq = head.getWorldQuaternion(new THREE.Quaternion());
    const hpos = new THREE.Vector3().setFromMatrixPosition(head.matrixWorld);
    const fwdH = new THREE.Vector3(0, 0, 1).applyQuaternion(hq); fwdH.y = 0; fwdH.normalize();
    const fwdB = new THREE.Vector3(Math.sin(gyaw), 0, Math.cos(gyaw));
    const top = new THREE.Vector3(0, 0.07, -0.01).applyQuaternion(hq).add(hpos);
    for (const C of curtains) {
      for (let k = 0; k < C.rings; k++) {
        const target = k === 0 ? top.clone() : C.c[k - 1].clone().add(new THREE.Vector3(0, -C.seg, 0)).addScaledVector(fwdB, C === curtains[0] ? -0.012 : 0.006);
        if (reset || !C.c[k]) C.c[k] = target.clone();
        else C.c[k].lerp(target, k === 0 ? 1 : 1 - Math.exp(-dt * (26 - k * 2.2)));
        // never through the chest
        if (C !== curtains[0] && k > 2) { const ch = group.localToWorld(new THREE.Vector3(...P.chest)); const dz = (C.c[k].x - ch.x) * fwdB.x + (C.c[k].z - ch.z) * fwdB.z; if (dz < 0.12) C.c[k].addScaledVector(fwdB, 0.12 - dz); }
      }
      const pos = C.pos;
      for (let k = 0; k < C.rings; k++) {
        const t2 = k / (C.rings - 1);
        const f = new THREE.Vector3().copy(fwdH).lerp(fwdB, t2).normalize();
        const right = new THREE.Vector3(f.z, 0, -f.x);
        const r = C.r0 + C.flare * k;
        for (let c = 0; c <= C.cols; c++) {
          const a = C.a0 + (C.a1 - C.a0) * (c / C.cols);
          const i = (k * (C.cols + 1) + c) * 3;
          const ca = Math.cos(a), sa = Math.sin(a);
          // a little ragged: strands of different lengths and a slow stir
          const stir = Math.sin(t * 1.7 + c * 1.3 + k) * 0.006 * k;
          pos[i] = C.c[k].x + f.x * ca * r + right.x * sa * r + stir;
          pos[i + 1] = C.c[k].y - (k ? Math.abs(Math.sin(c * 7.1)) * 0.03 * t2 : 0);
          pos[i + 2] = C.c[k].z + f.z * ca * r + right.z * sa * r;
        }
      }
      C.g.attributes.position.needsUpdate = true;
      C.g.computeVertexNormals();
    }
    simInit = true;

    // the mist: points shed from the hem, rising and falling behind
    if (ghost) {
      const hem = group.localToWorld(new THREE.Vector3(...rings[5][0]));
      const fade = U.crFade.value;
      for (let i = 0; i < MIST; i++) {
        const m = mist[i];
        m.life -= dt;
        if (m.life <= 0) {
          const a = Math.random() * Math.PI * 2;
          m.life = 1 + Math.random() * 1.4;
          m.x = hem.x + Math.sin(a) * 0.3; m.y = hem.y + Math.random() * 0.25; m.z = hem.z + Math.cos(a) * 0.3;
          m.vx = (Math.random() - 0.5) * 0.15; m.vy = 0.1 + Math.random() * 0.25; m.vz = (Math.random() - 0.5) * 0.15;
        }
        m.x += m.vx * dt; m.y += m.vy * dt; m.z += m.vz * dt;
        mistPos[i * 3] = m.x; mistPos[i * 3 + 1] = m.y; mistPos[i * 3 + 2] = m.z;
      }
      mistGeo.attributes.position.needsUpdate = true;
      mistPts.material.opacity = 0.13 * fade;
    }
  }

  function reset() { simInit = false; wasActive = false; lastWalked = 0; phase = 0; }

  return { group, update, reset, hairRoot, ghost };
}
