/* fx.js — everything that flashes, drifts, rings or floats and then goes away.
 *
 * The first version made a new mesh and a new material for every spark, and
 * a busy fight allocated thousands of them a second for the garbage collector
 * to chase. Here every effect comes out of a pool that is built once:
 *
 *   particles  two GPU point clouds (additive glow, and plain dust/smoke),
 *              one draw call each however many sparks are alive
 *   rings      shockwaves, a fixed set of meshes reused in turn
 *   decals     ground markings — attack warnings that fill up as they come
 *              due, and the lingering clouds and pools reactions leave
 *   flashes    a handful of point lights that are always in the scene at
 *              zero brightness, because adding and removing lights makes
 *              three recompile every lit shader mid-fight
 *   numbers    damage numbers, a DOM pool pinned to world positions
 */

import * as THREE from "three";
import { scene, renderer, camera, worldToScreen, onResize } from "./gfx.js";
import { rand, TAU, clamp } from "./util.js";

/* ---------------------------------------------------------------
   The host's tap: in a multiplayer match only the host runs the enemies,
   so every ring, warning and flash they make is copied (net.js sends it on)
   while enemy code is running. A client draws its own spells itself, so
   nothing else is copied. Sparks (emit) are never copied — too many, and
   each end makes its own trails anyway.
   --------------------------------------------------------------- */
let tap = null, tapping = 0;
export function setTap(fn) { tap = fn; }
export function tapBegin() { tapping++; }
export function tapEnd() { tapping = Math.max(0, tapping - 1); }
/** Stop copying for a moment (a death both ends draw); returns what to resume. */
export function tapPause() { const t = tapping; tapping = 0; return t; }
export function tapResume(t) { tapping = t; }
export function isTapping() { return tapping > 0 && !!tap; }
const copy = (name, args) => { if (tapping > 0 && tap) tap(name, Array.prototype.slice.call(args)); };

/* ---------------------------------------------------------------
   Particles
   --------------------------------------------------------------- */
const MAX = 2600;
const tmpColor = new THREE.Color();

function makeCloud(additive) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(MAX * 3), col = new Float32Array(MAX * 4), size = new Float32Array(MAX);
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("size", new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 400 } },
    vertexShader: [
      "attribute float size; attribute vec4 color; varying vec4 vColor; uniform float uScale;",
      "void main(){ vColor = color; vec4 mv = modelViewMatrix * vec4(position, 1.0);",
      "  gl_PointSize = size * uScale / -mv.z; gl_Position = projectionMatrix * mv; }"
    ].join("\n"),
    fragmentShader: [
      "varying vec4 vColor;",
      "void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c) * 2.0;",
      "  float a = " + (additive ? "pow(max(0.0, 1.0 - d), 1.6)" : "smoothstep(1.0, 0.55, d)") + ";",
      "  gl_FragColor = vec4(vColor.rgb, vColor.a * a);",
      "  #include <tonemapping_fragment>",
      "  #include <colorspace_fragment>",
      "}"
    ].join("\n"),
    transparent: true, depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = additive ? 10 : 9;
  scene.add(pts);
  return {
    pts, geo, mat, pos, col, size, n: 0,
    // simulation state, struct-of-arrays
    vx: new Float32Array(MAX), vy: new Float32Array(MAX), vz: new Float32Array(MAX),
    life: new Float32Array(MAX), max: new Float32Array(MAX),
    s0: new Float32Array(MAX), s1: new Float32Array(MAX),
    r: new Float32Array(MAX), g: new Float32Array(MAX), b: new Float32Array(MAX), a: new Float32Array(MAX),
    grav: new Float32Array(MAX), drag: new Float32Array(MAX)
  };
}
const glow = makeCloud(true);
const dust = makeCloud(false);

function syncScale() {
  const h = renderer.getDrawingBufferSize(new THREE.Vector2()).y;
  const s = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  glow.mat.uniforms.uScale.value = s;
  dust.mat.uniforms.uScale.value = s;
}
onResize(syncScale);

/** One particle. `c` is a hex colour or THREE.Color; sizes are world units. */
export function emit(x, y, z, vx, vy, vz, life, s0, s1, c, alpha, grav, drag, plain) {
  const P = plain ? dust : glow;
  if (P.n >= MAX) return;
  const i = P.n++;
  P.pos[i * 3] = x; P.pos[i * 3 + 1] = y; P.pos[i * 3 + 2] = z;
  P.vx[i] = vx; P.vy[i] = vy; P.vz[i] = vz;
  P.life[i] = life; P.max[i] = life;
  P.s0[i] = s0; P.s1[i] = s1 === undefined ? s0 * 0.2 : s1;
  if (typeof c === "number") tmpColor.setHex(c); else tmpColor.copy(c);
  P.r[i] = tmpColor.r; P.g[i] = tmpColor.g; P.b[i] = tmpColor.b;
  P.a[i] = alpha === undefined ? 1 : alpha;
  P.grav[i] = grav || 0; P.drag[i] = drag || 0;
}

/** A spray of sparks, the workhorse for hits and deaths. */
export function burst(x, y, z, c, n, speed, opts) {
  copy("burst", arguments);
  opts = opts || {};
  const up = opts.up === undefined ? 1 : opts.up;
  for (let i = 0; i < n; i++) {
    const a = rand(0, TAU), v = rand(speed * 0.35, speed), e = rand(-0.2, 1) * up;
    emit(x, y, z, Math.cos(a) * v, e * v * 0.8 + rand(0.5, 2) * up, Math.sin(a) * v,
      rand(0.3, 0.7) * (opts.life || 1), (opts.size || 0.35) * rand(0.7, 1.3), 0.02, c,
      opts.alpha === undefined ? 1 : opts.alpha, opts.grav === undefined ? 12 : opts.grav, opts.drag || 1.5, opts.plain);
  }
}

function stepCloud(P, dt) {
  let i = 0;
  while (i < P.n) {
    P.life[i] -= dt;
    if (P.life[i] <= 0) {
      // swap-remove: the last live particle takes this slot
      const j = --P.n;
      if (i !== j) {
        P.pos[i * 3] = P.pos[j * 3]; P.pos[i * 3 + 1] = P.pos[j * 3 + 1]; P.pos[i * 3 + 2] = P.pos[j * 3 + 2];
        P.vx[i] = P.vx[j]; P.vy[i] = P.vy[j]; P.vz[i] = P.vz[j];
        P.life[i] = P.life[j]; P.max[i] = P.max[j]; P.s0[i] = P.s0[j]; P.s1[i] = P.s1[j];
        P.r[i] = P.r[j]; P.g[i] = P.g[j]; P.b[i] = P.b[j]; P.a[i] = P.a[j];
        P.grav[i] = P.grav[j]; P.drag[i] = P.drag[j];
      }
      continue;
    }
    const k = Math.exp(-P.drag[i] * dt);
    P.vx[i] *= k; P.vz[i] *= k; P.vy[i] = P.vy[i] * k - P.grav[i] * dt;
    P.pos[i * 3] += P.vx[i] * dt;
    let y = P.pos[i * 3 + 1] + P.vy[i] * dt;
    if (y < 0.05 && P.grav[i] > 0) { y = 0.05; P.vy[i] *= -0.3; P.vx[i] *= 0.6; P.vz[i] *= 0.6; }
    P.pos[i * 3 + 1] = y;
    P.pos[i * 3 + 2] += P.vz[i] * dt;
    const t = 1 - P.life[i] / P.max[i];
    P.size[i] = P.s0[i] + (P.s1[i] - P.s0[i]) * t;
    const fade = Math.min(1, P.life[i] * 4) * Math.min(1, (P.max[i] - P.life[i]) * 30 + 0.2);
    P.col[i * 4] = P.r[i]; P.col[i * 4 + 1] = P.g[i]; P.col[i * 4 + 2] = P.b[i]; P.col[i * 4 + 3] = P.a[i] * fade;
    i++;
  }
  P.geo.setDrawRange(0, P.n);
  P.geo.attributes.position.needsUpdate = true;
  P.geo.attributes.color.needsUpdate = true;
  P.geo.attributes.size.needsUpdate = true;
}

/** Lightning: a jagged run of short-lived sparks between two points. Thick
 *  enough to read at a glance, which a one-pixel WebGL line never is. */
export function bolt(x0, y0, z0, x1, y1, z1, c) {
  copy("bolt", arguments);
  const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
  const n = Math.max(4, Math.ceil(len * 2.2));
  let px = x0, py = y0, pz = z0;
  for (let i = 1; i <= n; i++) {
    const t = i / n, j = i === n ? 0 : 0.45;
    const x = x0 + (x1 - x0) * t + (Math.random() - 0.5) * j;
    const y = y0 + (y1 - y0) * t + (Math.random() - 0.5) * j;
    const z = z0 + (z1 - z0) * t + (Math.random() - 0.5) * j;
    for (let k = 0; k < 3; k++) {
      const u = k / 3;
      emit(px + (x - px) * u, py + (y - py) * u, pz + (z - pz) * u, 0, 0, 0, 0.16, 0.34, 0.2, c, 1, 0, 0);
    }
    px = x; py = y; pz = z;
  }
}

/* ---------------------------------------------------------------
   Rings (shockwaves)
   --------------------------------------------------------------- */
const ringGeo = new THREE.RingGeometry(0.86, 1, 56);
ringGeo.rotateX(-Math.PI / 2);
const rings = [];
for (let i = 0; i < 28; i++) {
  const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  m.visible = false; m.renderOrder = 8; scene.add(m);
  rings.push({ m, t: 0, dur: 1, r0: 0, r1: 1, a: 1 });
}
let ringNext = 0;
export function ring(x, z, c, r0, r1, dur, y, alpha) {
  copy("ring", arguments);
  const R = rings[ringNext]; ringNext = (ringNext + 1) % rings.length;
  R.m.material.color.set(c);
  R.m.position.set(x, y === undefined ? 0.12 : y, z);
  R.t = 0; R.dur = dur; R.r0 = r0; R.r1 = r1; R.a = alpha === undefined ? 1 : alpha;
  R.m.visible = true;
}

/* ---------------------------------------------------------------
   Decals: warnings and lingering ground effects
   --------------------------------------------------------------- */
const decalGeo = new THREE.PlaneGeometry(2, 2);
decalGeo.rotateX(-Math.PI / 2);
const decalVS = "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }";
const decalFS = [
  "uniform vec3 uColor; uniform float uProgress; uniform float uOpacity; uniform float uShape; uniform float uTime;",
  "varying vec2 vUv;",
  "void main(){",
  "  vec2 p = vUv * 2.0 - 1.0; float a = 0.0;",
  "  if (uShape < 0.5) {",                       // circle warning: rim + filling disc
  "    float d = length(p); if (d > 1.0) discard;",
  "    float rim = smoothstep(0.84, 0.93, d) * (1.0 - smoothstep(0.96, 1.0, d));",
  "    float fill = (1.0 - smoothstep(uProgress - 0.03, uProgress, d)) * 0.45;",
  "    a = max(rim, fill + 0.1);",
  "  } else if (uShape < 1.5) {",                // lane warning: fills from the near end
  "    float e = max(abs(p.x), abs(p.y)); if (e > 1.0) discard;",
  "    float rim = smoothstep(0.8, 0.95, abs(p.x));",
  "    float fill = step(vUv.y, uProgress) * 0.45;",
  "    a = max(rim * 0.9, fill + 0.1);",
  "  } else {",                                  // lingering zone: soft, breathing
  "    float d = length(p); if (d > 1.0) discard;",
  "    float n = 0.75 + 0.25 * sin(uTime * 3.0 + d * 9.0 + atan(p.y, p.x) * 3.0);",
  "    a = (1.0 - d * d) * 0.55 * n + smoothstep(0.85, 0.97, d) * (1.0 - smoothstep(0.97, 1.0, d)) * 0.5;",
  "  }",
  "  gl_FragColor = vec4(uColor, a * uOpacity);",
  "  #include <tonemapping_fragment>",
  "  #include <colorspace_fragment>",
  "}"
].join("\n");
const decals = [];
for (let i = 0; i < 48; i++) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color() }, uProgress: { value: 0 }, uOpacity: { value: 1 }, uShape: { value: 0 }, uTime: { value: 0 } },
    vertexShader: decalVS, fragmentShader: decalFS, transparent: true, depthWrite: false,
    blending: THREE.NormalBlending
  });
  const m = new THREE.Mesh(decalGeo, mat);
  m.visible = false; m.renderOrder = 3; scene.add(m);
  decals.push({ m, mat, busy: false, t: 0, dur: 1, fadeIn: 0.12 });
}

/** A ground marking. shape: 0 circle warning, 1 lane warning, 2 lingering zone.
 *  For a lane, (x, z) is its near end, `ang` its direction and `len` its length.
 *  Returns a handle the caller may move or end early; it frees itself at `dur`. */
export function decal(shape, x, z, radius, c, dur, opts) {
  copy("decal", arguments);
  opts = opts || {};
  const D = decals.find((d) => !d.busy);
  if (!D) return null;
  D.busy = true; D.t = 0; D.dur = dur; D.fill = opts.fill !== false;
  D.mat.uniforms.uColor.value.set(c);
  D.mat.uniforms.uShape.value = shape;
  D.mat.uniforms.uProgress.value = 0;
  D.mat.uniforms.uOpacity.value = 0;
  D.maxOpacity = opts.opacity === undefined ? (shape === 2 ? 0.8 : 0.85) : opts.opacity;
  D.m.visible = true;
  D.m.rotation.set(0, 0, 0);
  if (shape === 1) {
    const len = opts.len || 8;
    D.m.scale.set(radius, 1, len / 2);
    D.m.rotation.y = -opts.ang - Math.PI / 2;
    // plane's local +z is its "far" end after this rotation; centre it along the lane
    D.m.position.set(x + Math.cos(opts.ang) * len / 2, 0.05, z + Math.sin(opts.ang) * len / 2);
  } else {
    D.m.scale.set(radius, 1, radius);
    D.m.position.set(x, shape === 2 ? 0.04 : 0.06, z);
  }
  D.handle = { end: () => { D.t = Math.max(D.t, D.dur - 0.15); }, get alive() { return D.busy; } };
  return D.handle;
}

/* ---------------------------------------------------------------
   Flash lights
   --------------------------------------------------------------- */
const flashes = [];
for (let i = 0; i < 4; i++) {
  const L = new THREE.PointLight(0xffffff, 0, 12, 2);
  L.position.set(0, -50, 0); scene.add(L);
  flashes.push({ L, t: 0, dur: 1, peak: 0 });
}
export let flashesEnabled = true;
export function setFlashesEnabled(v) { flashesEnabled = v; }
export function flash(x, y, z, c, peak, dur, range) {
  copy("flash", arguments);
  let F = flashes[0];
  for (const f of flashes) if (f.L.intensity < F.L.intensity) F = f;
  F.L.color.set(c); F.L.position.set(x, y, z); F.L.distance = range || 12;
  F.t = 0; F.dur = dur || 0.25; F.peak = flashesEnabled ? peak : peak * 0.35;
  F.L.intensity = F.peak;
}

/* ---------------------------------------------------------------
   Damage numbers
   --------------------------------------------------------------- */
const numLayer = document.getElementById("numbers");
const nums = [];
for (let i = 0; i < 36; i++) {
  const el = document.createElement("div");
  el.className = "dnum"; el.style.display = "none";
  numLayer.appendChild(el);
  nums.push({ el, t: 0, dur: 0.8, x: 0, y: 0, z: 0, busy: false, dx: 0 });
}
let numNext = 0;
export let numbersEnabled = true;
export function setNumbersEnabled(v) { numbersEnabled = v; }
export function number(x, y, z, text, cls) {
  copy("number", arguments);
  if (!numbersEnabled && cls !== "heal" && cls !== "info") return;
  const N = nums[numNext]; numNext = (numNext + 1) % nums.length;
  N.el.textContent = text;
  N.el.className = "dnum" + (cls ? " " + cls : "");
  N.x = x; N.y = y; N.z = z; N.t = 0; N.dur = cls === "info" ? 1.4 : 0.85; N.busy = true; N.dx = rand(-14, 14);
  N.el.style.display = "block";
}

/* ---------------------------------------------------------------
   Per frame
   --------------------------------------------------------------- */
let clock = 0;
const scr = {};
export function update(dt) {
  clock += dt;
  stepCloud(glow, dt);
  stepCloud(dust, dt);
  for (const R of rings) {
    if (!R.m.visible) continue;
    R.t += dt;
    const t = R.t / R.dur;
    if (t >= 1) { R.m.visible = false; continue; }
    const e = 1 - Math.pow(1 - t, 3);
    const r = R.r0 + (R.r1 - R.r0) * e;
    R.m.scale.set(r, 1, r);
    R.m.material.opacity = R.a * (1 - t);
  }
  for (const D of decals) {
    if (!D.busy) continue;
    D.t += dt;
    const u = D.mat.uniforms;
    u.uTime.value = clock;
    u.uProgress.value = D.fill ? clamp(D.t / D.dur, 0, 1) : 1;
    const fin = clamp(D.t / D.fadeIn, 0, 1), fout = clamp((D.dur - D.t) / 0.15, 0, 1);
    u.uOpacity.value = D.maxOpacity * Math.min(fin, fout);
    if (D.t >= D.dur) { D.busy = false; D.m.visible = false; }
  }
  for (const F of flashes) {
    if (F.L.intensity <= 0) continue;
    F.t += dt;
    F.L.intensity = F.t >= F.dur ? 0 : F.peak * Math.pow(1 - F.t / F.dur, 2);
  }
  for (const N of nums) {
    if (!N.busy) continue;
    N.t += dt;
    if (N.t >= N.dur) { N.busy = false; N.el.style.display = "none"; continue; }
    worldToScreen(N.x, N.y, N.z, scr);
    const t = N.t / N.dur;
    const lift = 46 * (1 - Math.pow(1 - t, 2));
    const pop = t < 0.12 ? 0.6 + t / 0.12 * 0.55 : 1.15 - Math.min(0.15, (t - 0.12) * 0.5);
    N.el.style.transform = "translate3d(" + (scr.x + N.dx * t).toFixed(1) + "px," + (scr.y - lift).toFixed(1) + "px,0) translate(-50%,-50%) scale(" + pop.toFixed(3) + ")";
    N.el.style.opacity = t > 0.7 ? ((1 - t) / 0.3).toFixed(2) : "1";
  }
}

export function clearAll() {
  glow.n = 0; dust.n = 0;
  glow.geo.setDrawRange(0, 0); dust.geo.setDrawRange(0, 0);
  for (const R of rings) R.m.visible = false;
  for (const D of decals) { D.busy = false; D.m.visible = false; }
  for (const F of flashes) F.L.intensity = 0;
  for (const N of nums) { N.busy = false; N.el.style.display = "none"; }
}

export function particleCount() { return glow.n + dust.n; }
syncScale();
