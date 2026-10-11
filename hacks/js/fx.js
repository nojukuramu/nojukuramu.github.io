/* fx.js — what happens to your eyes: drawn over the picture, under the HUD.
 *
 *   - Slashes. A blade swung at speed leaves an arc across the view: a thin
 *     cold streak when it cuts air, a thick hot one when it lands, with a jolt
 *     of red and lines bursting out from the middle.
 *   - Flashbangs. Not a white screen and a beep. What a flash really does to
 *     an eye: the picture you were looking at when it went off is burned in,
 *     and stays, washed out, while the scene comes back underneath it; where
 *     the flash itself was, the retina is bleached — a dark patch, fringed in
 *     the wrong colours, that stays put wherever you look and heals slowly;
 *     and for a while everything smears, as if several moments were on screen
 *     at once (the last few pictures, kept and laid over the new one). How
 *     much of each depends on how near it was and how squarely you looked at
 *     it (game.js flashAt).
 *   - A blast close by: a warm flash and a dark vignette.
 *   - Inside gas: a sick green haze that pulses.
 *   - Your shield breaking: cracks across the edges, in its colour.
 *
 * render.js calls afterRender() each frame straight after drawing the scene,
 * while the picture is still in the drawing buffer — the only moment a WebGL
 * canvas can be copied without keeping every frame (preserveDrawingBuffer).
 * Everything fades by real time. Nothing here changes the match. */

import * as THREE from "three";
import { S, on } from "./state.js";
import { SHIELD_COLORS } from "./game.js";

let el = null, ctx = null, cw = 0, ch = 0, dpr = 1;
let cam = null;
const pv = new THREE.Vector3();

/* ---------------------------------------------------------------
   Flashbangs
   --------------------------------------------------------------- */
let flash = null;                 // { k, t, hold, total, world, spot, burn, facing }
const GHOSTS = 6, GHOST_EVERY = 0.07;
const ghosts = [];                // small copies of the last few pictures, oldest first
let ghostAcc = 0, wantBurn = false;
function canvasOf(w, h) { const c = document.createElement("canvas"); c.width = Math.max(2, w | 0); c.height = Math.max(2, h | 0); return c; }
function grab(src, scale) {
  const c = canvasOf(src.width * scale, src.height * scale);
  try { c.getContext("2d").drawImage(src, 0, 0, c.width, c.height); } catch (e) { return null; }
  return c;
}
on("flashed", (e) => {
  // a second flash on a first: whichever burns more
  const k = Math.max(e.k, flash ? flash.k * Math.max(0, 1 - flash.t / flash.total) : 0);
  flash = { k, t: 0, hold: 0.35 + 2.4 * k, total: 2.5 + 7 * k, world: [e.x, e.y, e.z], spot: null, burn: null, facing: e.facing };
  wantBurn = true;
});
function drawFlash(g, w, h, dt, src) {
  const F = flash;
  F.t += dt;
  if (F.t > F.total) { flash = null; ghosts.length = 0; return; }
  if (wantBurn) {
    wantBurn = false;
    F.burn = grab(src, 0.5);
    // where it went off on screen, if it was in front: that is where the retina is bleached
    if (cam && F.facing > -0.1) {
      pv.set(F.world[0], F.world[1], F.world[2]).project(cam);
      if (pv.z < 1 && Math.abs(pv.x) < 1.4 && Math.abs(pv.y) < 1.4) F.spot = { x: (pv.x * 0.5 + 0.5) * w, y: (-pv.y * 0.5 + 0.5) * h };
    }
  }
  // keep the last few pictures, a little apart in time
  ghostAcc += dt;
  if (ghostAcc >= GHOST_EVERY) {
    ghostAcc = 0;
    const c = grab(src, 0.34);
    if (c) { ghosts.push(c); if (ghosts.length > GHOSTS) ghosts.shift(); }
  }
  const k = F.k, t = F.t, after = t - F.hold;
  const white = k * (after < 0 ? 1 : Math.exp(-after * 1.25));
  const burned = k * (after < 0 ? 0.9 : Math.exp(-after * 0.42));
  const smear = k * Math.max(0, 1 - t / (F.total * 0.8));
  // 1. several moments at once: the older pictures laid over the newest, each fainter
  if (smear > 0.02) {
    for (let i = 0; i < ghosts.length - 1; i++) {
      const age = (ghosts.length - 1 - i) / GHOSTS;
      g.globalAlpha = smear * 0.42 * (1 - age * 0.7);
      const j = (1 - age) * 3 * smear;
      g.drawImage(ghosts[i], Math.sin(t * 7 + i) * j, Math.cos(t * 5 + i) * j, w, h);
    }
  }
  // 2. the moment it went off, burned in: washed out, too bright, slowly letting the world through
  if (F.burn && burned > 0.01) {
    g.globalCompositeOperation = "screen";
    g.globalAlpha = Math.min(1, burned);
    try { g.filter = "blur(" + (1 + (1 - burned) * 4).toFixed(1) + "px) saturate(0.35) contrast(1.4)"; } catch (e) { /* no filters here */ }
    g.drawImage(F.burn, 0, 0, w, h);
    try { g.filter = "none"; } catch (e) {}
    g.globalCompositeOperation = "source-over";
  }
  // 3. the white itself
  if (white > 0.005) { g.globalAlpha = Math.min(1, white); g.fillStyle = "#fffdf6"; g.fillRect(0, 0, w, h); }
  // 4. the bleached patch where the flash was: dark at its heart, wrong colours at its rim, healing slowly
  if (F.spot) {
    const heal = Math.exp(-t / (2.6 + 3.5 * k));
    const a = Math.min(1, k * heal * 1.25);
    if (a > 0.01) {
      const R = Math.min(w, h) * (0.07 + 0.11 * k) * (0.75 + 0.25 * heal);
      const blob = (x, y, r, stops, op) => {
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        for (const [s, c] of stops) gr.addColorStop(s, c);
        g.globalCompositeOperation = op; g.fillStyle = gr;
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      };
      const sx = F.spot.x, sy = F.spot.y;
      g.globalAlpha = a;
      // the colours a bleached eye makes up: an inverted core, purple-black, a green and a magenta fringe
      blob(sx, sy, R * 0.9, [[0, "rgba(255,255,255,0.8)"], [0.6, "rgba(255,255,255,0.25)"], [1, "rgba(255,255,255,0)"]], "difference");
      blob(sx, sy, R, [[0, "rgba(28,6,48,1)"], [0.45, "rgba(52,18,86,0.85)"], [0.8, "rgba(90,60,110,0.35)"], [1, "rgba(120,120,120,0)"]], "multiply");
      for (let i = 0; i < 3; i++) {
        const ang = t * (0.35 + i * 0.13) + i * 2.1, off = R * (0.35 + 0.15 * Math.sin(t * 0.7 + i));
        const col = i === 0 ? "rgba(60,255,170," : i === 1 ? "rgba(255,40,190," : "rgba(255,200,40,";
        blob(sx + Math.cos(ang) * off, sy + Math.sin(ang) * off, R * (0.55 - i * 0.08), [[0, col + "0.55)"], [1, col + "0)"]], "screen");
      }
      g.globalCompositeOperation = "source-over";
    }
  }
  g.globalAlpha = 1;
}

/* ---------------------------------------------------------------
   Slashes
   --------------------------------------------------------------- */
const slashes = [];
let slashSide = 1;
on("slash", (a, e) => {
  if (a !== S.me) return;
  // the feel is for speed: a cut at a run is just a cut
  if (e.speed < 8 && !(e.hit && e.speed > 6)) return;
  slashSide = -slashSide;
  const fast = Math.min(1, (e.speed - 6) / 14);
  slashes.push({ t: 0, life: e.hit ? 0.34 : 0.24, hit: e.hit, side: slashSide, lance: e.melee === "lancer", k: 0.55 + fast * 0.45 });
  if (e.hit) jolt = 1;
});
let jolt = 0;
function drawSlashes(g, w, h, dt) {
  const cx = w / 2, cy = h / 2, M = Math.min(w, h);
  for (let i = slashes.length - 1; i >= 0; i--) {
    const s = slashes[i];
    s.t += dt;
    const k = s.t / s.life;
    if (k >= 1) { slashes.splice(i, 1); continue; }
    // the edge sweeps fast through the first part of its life; the trail it leaves fades behind it
    const head = Math.min(1, k / 0.38), tail = Math.max(0, (k - 0.12) / 0.88);
    const fade = 1 - Math.pow(k, 2);
    g.save();
    g.translate(cx, cy);
    if (s.lance) {
      // a thrust: a spear of light straight in, and the rings it punches
      const len = M * 0.55 * s.k;
      g.globalCompositeOperation = "lighter";
      g.strokeStyle = s.hit ? "rgba(255,120,70," + fade + ")" : "rgba(190,230,255," + fade * 0.8 + ")";
      g.lineWidth = (s.hit ? 16 : 7) * (1 - k * 0.6);
      g.beginPath(); g.moveTo(0, len * (1 - head)); g.lineTo(0, len * (1 - tail) * 0.2); g.stroke();
      g.restore();
      continue;
    }
    g.rotate(s.side > 0 ? -0.55 : Math.PI + 0.55);
    g.scale(1, s.side > 0 ? 1 : -1);
    const R = M * (s.hit ? 0.5 : 0.44) * s.k;
    const a0 = -2.2, a1 = 0.9, aHead = a0 + (a1 - a0) * head, aTail = a0 + (a1 - a0) * tail * 0.95;
    g.globalCompositeOperation = "lighter";
    // the body of the arc, thick in the middle and pointed at both ends
    const steps = 22;
    for (let j = 0; j < steps; j++) {
      const u0 = j / steps, u1 = (j + 1) / steps;
      const b0 = aTail + (aHead - aTail) * u0, b1 = aTail + (aHead - aTail) * u1;
      const thick = Math.sin(Math.PI * (u0 + u1) / 2);
      g.lineWidth = (s.hit ? 22 : 9) * thick * fade + 0.5;
      g.strokeStyle = s.hit ? "rgba(255," + (90 + 120 * u1 | 0) + ",60," + (0.85 * fade) + ")" : "rgba(170,225,255," + (0.65 * fade * u1) + ")";
      g.beginPath(); g.arc(0, 0, R, b0, b1); g.stroke();
    }
    // the white edge
    g.lineWidth = (s.hit ? 4 : 2) * fade;
    g.strokeStyle = "rgba(255,255,255," + fade + ")";
    g.beginPath(); g.arc(0, 0, R * 1.01, aHead - 0.5, aHead); g.stroke();
    g.restore();
    if (s.hit && k < 0.5) {
      // it landed: lines burst out from the middle
      g.save(); g.translate(cx, cy);
      g.globalCompositeOperation = "lighter";
      g.strokeStyle = "rgba(255,190,140," + (1 - k * 2) * 0.8 + ")"; g.lineWidth = 2;
      for (let j = 0; j < 14; j++) {
        const a = j / 14 * Math.PI * 2 + s.side, r0 = M * (0.06 + k * 0.3), r1 = r0 + M * 0.08 * (1 - k);
        g.beginPath(); g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); g.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); g.stroke();
      }
      g.restore();
    }
  }
  g.globalCompositeOperation = "source-over";
  if (jolt > 0) {
    // the jolt of a hit: red at the edges, for a breath
    const gr = g.createRadialGradient(cx, cy, M * 0.25, cx, cy, M * 0.85);
    gr.addColorStop(0, "rgba(255,40,40,0)"); gr.addColorStop(1, "rgba(255,40,40," + (0.32 * jolt) + ")");
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    jolt = Math.max(0, jolt - dt * 5);
  }
}

/* ---------------------------------------------------------------
   Blasts, gas, a broken shield
   --------------------------------------------------------------- */
let heat = 0;
on("explosion", (e) => {
  if (!cam) return;
  const d = Math.hypot(e.x - cam.position.x, e.y - cam.position.y, e.z - cam.position.z);
  heat = Math.max(heat, Math.min(1, 1.3 - d / (e.r * 2)));
});
let cracks = null;
on("shieldBreak", (b) => {
  if (b !== S.me) return;
  const lines = [];
  for (let i = 0; i < 9; i++) {
    // from an edge, inwards, in a few jagged steps
    const side = i % 4, u = Math.random();
    let x = side === 0 ? u : side === 1 ? 1 : side === 2 ? u : 0, y = side === 0 ? 0 : side === 1 ? u : side === 2 ? 1 : u;
    const pts = [[x, y]];
    const ix = 0.5 - x, iy = 0.5 - y;
    for (let j = 0; j < 4; j++) { x += ix * (0.08 + Math.random() * 0.08) + (Math.random() - 0.5) * 0.05; y += iy * (0.08 + Math.random() * 0.08) + (Math.random() - 0.5) * 0.05; pts.push([x, y]); }
    lines.push(pts);
  }
  cracks = { t: 0, lines, color: SHIELD_COLORS[Math.max(0, (b.shieldLevel || 1) - 1)] };
});
function gasHere() {
  const me = S.me;
  if (!me || !me.alive || !S.clouds) return 0;
  let k = 0;
  for (const c of S.clouds) {
    const r = c.r * Math.min(1, 0.35 + c.t * 1.2), fade = Math.min(1, (c.life - c.t) / 2);
    const d = Math.hypot(me.body.x - c.x, me.body.y + 1.4 - c.y, me.body.z - c.z);
    if (d < r) k = Math.max(k, (1 - d / r * 0.5) * fade);
  }
  return k;
}
let gas = 0;
function drawRest(g, w, h, dt) {
  const M = Math.min(w, h), cx = w / 2, cy = h / 2;
  if (heat > 0.01) {
    const gr = g.createRadialGradient(cx, cy, M * 0.1, cx, cy, M * 0.9);
    gr.addColorStop(0, "rgba(255,200,120," + heat * 0.35 + ")"); gr.addColorStop(1, "rgba(40,20,10," + heat * 0.55 + ")");
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    heat = Math.max(0, heat - dt * 2.8);
  }
  gas = gas + (gasHere() - gas) * Math.min(1, dt * 4);
  if (gas > 0.01) {
    const pulse = 0.8 + 0.2 * Math.sin(performance.now() / 260);
    const gr = g.createRadialGradient(cx, cy, M * 0.15, cx, cy, M * 0.8);
    gr.addColorStop(0, "rgba(150,200,40," + gas * 0.12 * pulse + ")"); gr.addColorStop(1, "rgba(70,110,10," + gas * 0.6 * pulse + ")");
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }
  if (cracks) {
    cracks.t += dt;
    const a = Math.max(0, 1 - cracks.t / 0.7);
    if (a <= 0) cracks = null;
    else {
      g.strokeStyle = cracks.color; g.globalAlpha = a; g.lineWidth = 2.5; g.lineJoin = "miter";
      g.shadowColor = cracks.color; g.shadowBlur = 8;
      for (const L of cracks.lines) { g.beginPath(); L.forEach(([x, y], i) => (i ? g.lineTo(x * w, y * h) : g.moveTo(x * w, y * h))); g.stroke(); }
      g.shadowBlur = 0; g.globalAlpha = 1;
    }
  }
}

/* ---------------------------------------------------------------
   Each frame
   --------------------------------------------------------------- */
/** Straight after the scene is drawn: copy what a flash needs, then draw this frame's effects. */
export function afterRender(src, dt, camera) {
  if (camera) cam = camera;
  if (!el) { el = document.getElementById("fx"); if (!el) return; ctx = el.getContext("2d"); }
  const w = src.clientWidth || window.innerWidth, h = src.clientHeight || window.innerHeight, r = Math.min(1.5, window.devicePixelRatio || 1);
  const busy = flash || slashes.length || jolt > 0 || heat > 0.01 || gas > 0.01 || cracks || gasHere() > 0;
  if (!busy) { if (cw) { ctx.clearRect(0, 0, el.width, el.height); cw = 0; } return; }
  if (w !== cw || h !== ch || r !== dpr) { cw = w; ch = h; dpr = r; el.width = Math.round(w * r); el.height = Math.round(h * r); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (flash) drawFlash(ctx, w, h, dt, src);
  drawSlashes(ctx, w, h, dt);
  drawRest(ctx, w, h, dt);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
}
/** How blind you are right now, 0..1, for the hack API and the HUD. */
export function blindness() { if (!flash) return 0; const after = flash.t - flash.hold; return flash.k * (after < 0 ? 1 : Math.exp(-after * 1.25)); }
on("quit", () => { flash = null; ghosts.length = 0; slashes.length = 0; heat = 0; gas = 0; cracks = null; jolt = 0; });
on("spawn", (a) => { if (a === S.me) { flash = null; ghosts.length = 0; cracks = null; } });
