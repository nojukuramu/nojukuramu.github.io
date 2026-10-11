/* worldfx.js — what blasts, grenades, mines and gas look like in the world.
 *
 * game.js decides what a throwable does and where a blast goes off; this only
 * draws it: a fireball that blooms and burns out, the flash that lights the
 * walls for a frame, a shock ring along the floor, smoke that rolls up, a
 * scorch left behind; grenades tumbling in flight, mines stuck to the walls
 * with their light blinking once armed, a tripmine's beam, a gas mine's cloud.
 *
 * The same split as render.js's tracers and sparks: pooled meshes, nothing
 * allocated per frame, and every effect fades by real time (dt), never by
 * frames. render.js boots it with its scene and its spark and puff makers. */

import * as THREE from "three";
import { S, on } from "./state.js";
import { UTILS } from "./weapons.js";
import { beamOf, world } from "./game.js";
import { ray, newTrace } from "./brush.js";

let scene = null, fx = null;
const TR = newTrace();

/* ---------------------------------------------------------------
   Textures, made once
   --------------------------------------------------------------- */
function radial(stops, size) {
  const c = document.createElement("canvas");
  c.width = c.height = size || 128;
  const g = c.getContext("2d"), h = c.width / 2, r = g.createRadialGradient(h, h, 0, h, h, h);
  for (const [k, col] of stops) r.addColorStop(k, col);
  g.fillStyle = r; g.fillRect(0, 0, c.width, c.height);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
let fireTex, ringTex, scorchTex, smokeTex;
function textures() {
  fireTex = radial([[0, "rgba(255,255,240,1)"], [0.18, "rgba(255,226,140,0.95)"], [0.45, "rgba(255,130,40,0.75)"], [0.75, "rgba(170,40,10,0.3)"], [1, "rgba(60,10,0,0)"]]);
  ringTex = (() => {
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const g = c.getContext("2d"), r = g.createRadialGradient(64, 64, 40, 64, 64, 64);
    r.addColorStop(0, "rgba(255,255,255,0)"); r.addColorStop(0.7, "rgba(255,230,200,0.75)"); r.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = r; g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();
  scorchTex = radial([[0, "rgba(10,8,8,0.95)"], [0.45, "rgba(25,20,18,0.7)"], [0.8, "rgba(40,34,30,0.25)"], [1, "rgba(40,34,30,0)"]], 64);
  smokeTex = radial([[0, "rgba(255,255,255,0.85)"], [0.45, "rgba(255,255,255,0.4)"], [1, "rgba(255,255,255,0)"]], 64);
}

/* ---------------------------------------------------------------
   Blasts
   --------------------------------------------------------------- */
const BLASTS = [], SCORCH = [];
let blastI = 0, scorchI = 0;
const light = new THREE.PointLight(0xffb060, 0, 30, 2);
function blastPool() {
  for (let i = 0; i < 8; i++) {
    const fire = new THREE.Sprite(new THREE.SpriteMaterial({ map: fireTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: fireTex, color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    const ring = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: ringTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    for (const o of [fire, core, ring]) { o.visible = false; scene.add(o); }
    BLASTS.push({ fire, core, ring, t: 1, life: 1, r: 1, kind: "" });
  }
  const geo = new THREE.PlaneGeometry(1, 1);
  for (let i = 0; i < 24; i++) {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: scorchTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    m.visible = false; scene.add(m); SCORCH.push({ m, t: 0 });
  }
  scene.add(light);
}
const nV = new THREE.Vector3(), Zf = new THREE.Vector3(0, 0, 1);
/** A blast at a point: fire, light, a ring on the ground if it is near one, smoke, sparks and a scorch. */
export function blast(x, y, z, r, kind) {
  const B = BLASTS[blastI++ % BLASTS.length];
  const flash = kind === "flash";
  B.t = 0; B.life = flash ? 0.35 : 0.55; B.r = r; B.kind = kind;
  B.fire.position.set(x, y, z); B.core.position.set(x, y, z);
  B.fire.material.color.setHex(flash ? 0xe8f0ff : 0xffffff);
  B.fire.visible = B.core.visible = true;
  light.position.set(x, y + 0.5, z);
  light.color.setHex(flash ? 0xeef4ff : 0xffa24a);
  light.intensity = flash ? 420 : 160; light.distance = r * (flash ? 8 : 5);
  // the floor under it: a ring of dust along it, and a scorch on it
  ray(world(), x, y + 0.2, z, x, y - 2.2, z, TR);
  if (TR.fraction < 1) {
    const gy = y + 0.2 - TR.fraction * 2.4;
    B.ring.position.set(x, gy + 0.05, z); B.ring.visible = true; B.ring.scale.setScalar(0.1);
    if (!flash) {
      const D = SCORCH[scorchI++ % SCORCH.length];
      nV.set(TR.nx, TR.ny, TR.nz).normalize();
      D.m.position.set(TR.x, TR.y, TR.z).addScaledVector(nV, 0.01);
      D.m.quaternion.setFromUnitVectors(Zf, nV); D.m.rotateZ(Math.random() * 6.28);
      D.m.scale.setScalar(r * (0.55 + Math.random() * 0.2));
      D.m.visible = true; D.t = 20; D.m.material.opacity = 1;
    }
  } else B.ring.visible = false;
  if (flash) { fx.burst(x, y, z, 60, 0xffffff, 10); return; }
  fx.burst(x, y, z, 70, 0xffb040, 11);
  fx.burst(x, y, z, 30, 0xff6020, 6);
  for (let i = 0; i < 9; i++) {
    const a = Math.random() * 6.28, d = Math.random() * r * 0.35;
    fx.puff(x + Math.cos(a) * d, y + Math.random() * 0.8, z + Math.sin(a) * d, i < 3 ? 0x3b3632 : 0x6d665e, r * (0.32 + Math.random() * 0.25), 1.4 + Math.random() * 1.2);
  }
}
function updateBlasts(dt) {
  for (const B of BLASTS) {
    if (B.t >= B.life) { B.fire.visible = B.core.visible = B.ring.visible = false; continue; }
    B.t += dt;
    const k = Math.min(1, B.t / B.life);
    // a quick bloom, then a slower burn-out: ease out on the size, the light gone first
    const grow = 1 - Math.pow(1 - k, 3);
    B.fire.scale.setScalar(B.r * (0.35 + 1.15 * grow));
    B.fire.material.opacity = Math.pow(1 - k, 1.6);
    B.fire.material.rotation += dt * 1.5;
    B.core.scale.setScalar(B.r * 0.5 * (1 - k * 0.5));
    B.core.material.opacity = Math.max(0, 1 - k * 4);
    if (B.ring.visible) { B.ring.scale.setScalar(B.r * 2.6 * grow + 0.1); B.ring.material.opacity = (1 - k) * 0.8; }
  }
  light.intensity = Math.max(0, light.intensity - dt * 900);
  for (const D of SCORCH) if (D.m.visible) { D.t -= dt; if (D.t < 4) D.m.material.opacity = Math.max(0, D.t / 4); if (D.t <= 0) D.m.visible = false; }
}

/* ---------------------------------------------------------------
   Throwables
   --------------------------------------------------------------- */
const objs = new Map();             // throwable id -> { g, lamp, beam, kind }
const dark = new THREE.MeshStandardMaterial({ color: 0x2c3326, roughness: 0.6, metalness: 0.4 });
const steel = new THREE.MeshStandardMaterial({ color: 0x8c949e, roughness: 0.35, metalness: 0.8 });
const caseMat = new THREE.MeshStandardMaterial({ color: 0x2a2e34, roughness: 0.5, metalness: 0.5 });
const gasMat = new THREE.MeshStandardMaterial({ color: 0x9fbf2c, roughness: 0.55, metalness: 0.2 });
const beamMat = new THREE.MeshBasicMaterial({ color: 0xff2a3a, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false });
const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 12), sphGeo = new THREE.SphereGeometry(1, 12, 10), beamGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1);
function lampMat(c) { return new THREE.MeshStandardMaterial({ color: 0x111111, emissive: c, emissiveIntensity: 0, roughness: 0.3 }); }
function mesh(geo, mat, sx, sy, sz, x, y, z) { const m = new THREE.Mesh(geo, mat); m.scale.set(sx, sy, sz); m.position.set(x || 0, y || 0, z || 0); m.castShadow = true; return m; }
/** A model for one kind of utility: also the one held in your hand (viewmodel.js) and theirs (figures.js). */
export function utilModel(kind) {
  const g = new THREE.Group();
  let lamp = null;
  if (kind === "frag") {
    g.add(mesh(sphGeo, dark, 0.062, 0.07, 0.062));
    g.add(mesh(cylGeo, steel, 0.02, 0.035, 0.02, 0, 0.075, 0));
    g.add(mesh(cylGeo, steel, 0.006, 0.05, 0.016, 0.026, 0.06, 0));
  } else if (kind === "flash") {
    g.add(mesh(cylGeo, steel, 0.038, 0.13, 0.038));
    g.add(mesh(cylGeo, new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.4 }), 0.039, 0.025, 0.039, 0, 0.02, 0));
    g.add(mesh(cylGeo, steel, 0.015, 0.03, 0.015, 0, 0.08, 0));
  } else if (kind === "trip") {
    g.add(mesh(cylGeo, caseMat, 0.1, 0.035, 0.1));
    lamp = mesh(cylGeo, lampMat(0xff2a3a), 0.025, 0.02, 0.025, 0, 0.025, 0);
    g.add(lamp);
  } else {
    g.add(mesh(cylGeo, gasMat, 0.07, 0.14, 0.07, 0, 0.07, 0));
    g.add(mesh(cylGeo, caseMat, 0.09, 0.02, 0.09));
    lamp = mesh(sphGeo, lampMat(0x8dff3a), 0.02, 0.02, 0.02, 0, 0.15, 0);
    g.add(lamp);
  }
  return { g, lamp };
}
const UP = new THREE.Vector3(0, 1, 0), tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
function updateThrowables(dt, alpha) {
  const seen = new Set();
  const t = performance.now() / 1000;
  for (const th of S.throwables || []) {
    if (th.done) continue;
    seen.add(th.id);
    let o = objs.get(th.id);
    if (!o) {
      const m = utilModel(th.kind);
      o = { g: m.g, lamp: m.lamp, beam: null, kind: th.kind, spin: new THREE.Vector3(Math.random() * 9, Math.random() * 9, Math.random() * 9) };
      if (th.kind === "trip") { o.beam = new THREE.Mesh(beamGeo, beamMat); o.beam.matrixAutoUpdate = false; o.beam.frustumCulled = false; o.beam.visible = false; scene.add(o.beam); }
      scene.add(o.g); objs.set(th.id, o);
    }
    o.g.position.set(th.px + (th.x - th.px) * alpha, th.py + (th.y - th.py) * alpha, th.pz + (th.z - th.pz) * alpha);
    if (th.stuck) o.g.quaternion.setFromUnitVectors(UP, tmpV.set(th.nx, th.ny, th.nz));
    else if (!th.resting) { o.g.rotation.x += o.spin.x * dt; o.g.rotation.y += o.spin.y * dt; o.g.rotation.z += o.spin.z * dt; }
    // a mine's light: off while it arms, then a slow blink; a grenade's fuse has none
    const U = UTILS[th.kind];
    if (o.lamp) o.lamp.material.emissiveIntensity = th.stuck ? (th.armed || th.t >= U.arm ? (Math.sin(t * 6 + th.id) > 0.2 ? 4 : 0.6) : 0.3) : 0;
    if (o.beam) {
      const on = th.stuck && (th.armed || th.t >= U.arm);
      o.beam.visible = on;
      if (on) {
        const len = beamOf(th);
        o.beam.matrix.compose(tmpV.set(th.x + th.nx * len / 2, th.y + th.ny * len / 2, th.z + th.nz * len / 2), tmpQ.setFromUnitVectors(UP, nV.set(th.nx, th.ny, th.nz)), new THREE.Vector3(0.006, len, 0.006));
        o.beam.material.opacity = 0.55 + Math.sin(t * 20) * 0.1;
      }
    }
  }
  for (const [id, o] of objs) if (!seen.has(id)) { o.g.removeFromParent(); if (o.beam) o.beam.removeFromParent(); objs.delete(id); }
}

/* ---------------------------------------------------------------
   Gas
   --------------------------------------------------------------- */
const clouds = new Map();           // cloud id -> { sprites: [{ s, a, d, h, sp }] }
const gasSpriteMat = () => new THREE.SpriteMaterial({ map: smokeTex, color: 0x9fd23a, transparent: true, depthWrite: false, opacity: 0 });
function updateClouds(dt) {
  const seen = new Set();
  for (const c of S.clouds || []) {
    seen.add(c.id);
    let C = clouds.get(c.id);
    if (!C) {
      C = { sprites: [] };
      for (let i = 0; i < 18; i++) {
        const s = new THREE.Sprite(gasSpriteMat());
        scene.add(s);
        C.sprites.push({ s, a: Math.random() * 6.28, d: Math.sqrt(Math.random()), h: Math.random(), sp: (Math.random() - 0.5) * 0.6, size: 1.6 + Math.random() * 1.6 });
      }
      clouds.set(c.id, C);
    }
    // rolls out over a second, hangs, and thins away over its last two
    const grow = Math.min(1, 0.35 + c.t * 1.2), fade = Math.min(1, (c.life - c.t) / 2, c.t * 3);
    for (const P of C.sprites) {
      P.a += P.sp * dt;
      const r = c.r * grow * P.d;
      P.s.position.set(c.x + Math.cos(P.a) * r, c.y - 0.5 + P.h * c.r * 0.7 * grow, c.z + Math.sin(P.a) * r);
      P.s.scale.setScalar(P.size * (0.6 + grow * 0.6));
      P.s.material.opacity = 0.38 * fade;
      P.s.material.rotation += P.sp * dt;
    }
  }
  for (const [id, C] of clouds) if (!seen.has(id)) { for (const P of C.sprites) { P.s.removeFromParent(); P.s.material.dispose(); } clouds.delete(id); }
}

/* ---------------------------------------------------------------
   Wall rides: sparks off the wall where the shoulder meets it
   --------------------------------------------------------------- */
let sparkAcc = 0;
function updateRides(dt) {
  sparkAcc += dt;
  if (sparkAcc < 1 / 40) return;
  sparkAcc = 0;
  for (const a of S.actors) {
    const b = a.body;
    if (!a.alive || !b.wallSlide || !a.heard) continue;
    const x = b.x - b.wsnx * 0.42, z = b.z - b.wsnz * 0.42;
    fx.burst(x, b.y + 0.35 + Math.random() * 0.4, z, 3, Math.random() < 0.5 ? 0xffc060 : 0xfff0c0, 3);
    if (Math.random() < 0.25) fx.puff(x, b.y + 0.2, z, 0x9a948a, 0.3, 0.5);
  }
}

/* ---------------------------------------------------------------
   Wiring
   --------------------------------------------------------------- */
export function initWorldFx(sc, helpers) {
  scene = sc; fx = helpers;
  textures();
  blastPool();
  on("explosion", (e) => blast(e.x, e.y, e.z, e.r, e.weapon));
  on("flashbang", (e) => blast(e.x, e.y, e.z, 3, "flash"));
  on("quit", () => { for (const [id, o] of objs) { o.g.removeFromParent(); if (o.beam) o.beam.removeFromParent(); objs.delete(id); } });
}
export function updateWorldFx(dt, alpha) {
  updateBlasts(dt);
  updateThrowables(dt, alpha);
  updateClouds(dt);
  updateRides(dt);
}
