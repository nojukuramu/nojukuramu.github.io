/* fx.js — sparks, smoke, fire, dust, tracers, blasts and the weather.
 *
 * None of this is simulation. It listens to the events the simulation emits
 * (state.js) and makes something to look at: a clang's sparks, an arrow's
 * puff of dust, a shell's blast ring, a building's smoke as it burns down.
 * It runs on real time, not game time, so pausing freezes the battle but the
 * smoke still drifts — and it is capped, so a thousand arrows never cost more
 * than a few thousand particles. */

import { G, on } from "./state.js";
import { TILE, ERAS, BUILDINGS } from "./data.js";
import { seen, visiblePx } from "./fog.js";
import { hexA } from "./sprites.js";

const MAX = 2600;
export const parts = [];
export const decals = [];
export const tracers = [];
export const rings = [];
export const texts = [];
export const flashes = [];   // brief lights, for the night
let quality = 1;
export function setQuality(q) { quality = q; }

function P(o) {
  if (parts.length >= MAX * quality) return;
  parts.push(Object.assign({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, g: 0, life: 1, max: 1, size: 2, grow: 0, col: "#fff", kind: "spark", drag: 0.98, add: false }, o));
}
const rnd = (a, b) => a + Math.random() * (b - a);
const energy = (e) => ERAS[Math.max(0, Math.min(9, e || 0))].energy;

export function smoke(x, y, n, col, big) {
  for (let i = 0; i < n; i++) P({ x: x + rnd(-6, 6), y: y + rnd(-4, 4), z: rnd(0, 6), vx: rnd(-6, 6), vy: rnd(-4, 2), vz: rnd(14, 26), life: rnd(1.2, 2.4), size: rnd(4, 7) * (big ? 1.8 : 1), grow: 6, col: col || "#5a5650", kind: "smoke", drag: 0.97 });
}
export function sparks(x, y, n, col, speed) {
  for (let i = 0; i < n; i++) { const a = rnd(0, 6.28), s = rnd(20, 70) * (speed || 1); P({ x, y, z: rnd(4, 12), vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.6, vz: rnd(10, 50), g: 160, life: rnd(0.2, 0.5), size: rnd(1, 2), col: col || "#ffd27a", kind: "spark", add: true }); }
}
export function dust(x, y, n, col) {
  for (let i = 0; i < n; i++) { const a = rnd(0, 6.28), s = rnd(8, 30); P({ x, y, z: 1, vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.6, vz: rnd(4, 14), g: 20, life: rnd(0.4, 0.9), size: rnd(2, 4), grow: 5, col: col || "#b8a07a", kind: "smoke", drag: 0.92 }); }
}
export function debris(x, y, n, col) {
  for (let i = 0; i < n; i++) { const a = rnd(0, 6.28), s = rnd(30, 110); P({ x, y, z: rnd(4, 20), vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.6, vz: rnd(40, 120), g: 300, life: rnd(0.6, 1.2), size: rnd(1.5, 3.5), col: col || "#6a5a48", kind: "debris", bounce: true }); }
}
export function blast(x, y, r, col, era) {
  const c = col || (era >= 7 ? energy(era) : "#ffb347");
  rings.push({ x, y, r0: r * 0.2, r1: r, t: 0, max: 0.35, col: c });
  for (let i = 0; i < 10 + r / 4; i++) { const a = rnd(0, 6.28), s = rnd(20, 90); P({ x, y, z: rnd(2, 10), vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.6, vz: rnd(10, 50), g: 40, life: rnd(0.25, 0.5), size: rnd(4, 8), grow: -6, col: c, kind: "fire", add: true }); }
  smoke(x, y, 6 + r / 8, era >= 7 ? "#3a3a5a" : "#4a4440", true);
  flashes.push({ x, y, r: r * 3, t: 0, max: 0.3, col: c });
}
export function magic(x, y, col, n) {
  for (let i = 0; i < (n || 14); i++) { const a = rnd(0, 6.28), s = rnd(10, 50); P({ x, y, z: rnd(4, 16), vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.6, vz: rnd(10, 40), life: rnd(0.4, 0.9), size: rnd(1.5, 3), col, kind: "glow", add: true, drag: 0.94 }); }
}
export function column(x, y, col) {
  for (let i = 0; i < 26; i++) P({ x: x + rnd(-8, 8), y: y + rnd(-4, 4), z: rnd(0, 10), vz: rnd(30, 90), life: rnd(0.8, 1.6), size: rnd(1.5, 3), col, kind: "glow", add: true, drag: 0.99 });
}
export function float(x, y, text, col) { texts.push({ x, y, text, col, t: 0, max: 1.2 }); }
export function fireOn(x, y, k) {
  P({ x: x + rnd(-8, 8), y: y + rnd(-4, 4), z: rnd(4, 14), vx: rnd(-4, 4), vy: rnd(-2, 2), vz: rnd(18, 32), life: rnd(0.3, 0.6), size: rnd(3, 6) * k, grow: -4, col: Math.random() < 0.5 ? "#ff8a2a" : "#ffd27a", kind: "fire", add: true });
  if (Math.random() < 0.4) smoke(x, y - 10, 1, "#3a3633");
}

/* ---------------- listening ---------------- */
const SHOT_COL = { stone: "#8a8278", arrow: "#d8c8a0", bolt: "#c8c8c8", spear: "#d8c8a0", musket: "#ffe0a0", bullet: "#ffe7a0", rail: "#62e8ff", laser: "#62e8ff", photon: "#9fd0ff", plasma: "#8da7ff", ion: "#8da7ff", lance: "#c9d4ff", star: "#ffe9a8", aether: "#d38bff", singularity: "#d38bff", hero: "#ffffff", bolt2: "#ffffff", shell: "#ffcf6b", rocket: "#ffcf6b", missile: "#ffcf6b", boulder: "#8a8278", ember: "#ff9a3c" };
export const shotColor = (s) => SHOT_COL[s] || "#fff";
const inView = (x, y) => visiblePx(x, y);

export function init() {
  on("hit", (t, dmg, by, kind) => {
    if (!inView(t.x, t.y)) return;
    if (t.kind === "bld") { if (Math.random() < 0.5) { sparks(t.x + rnd(-t.w * 10, t.w * 10), t.y + rnd(-t.h * 8, t.h * 4), 3, "#c8b090"); dust(t.x, t.y, 1, "#8a7a68"); } }
    else if (kind === "melee") sparks(t.x, t.y - 6, 4, t.st.mech ? "#ffd27a" : "#e0d0c0");
    else sparks(t.x, t.y - 6, 2, "#ffcf9a", 0.6);
    if (t.hero || (by && by.hero)) float(t.x, t.y - 22, Math.round(dmg), by && by.team === 0 ? "#ffe9a8" : "#ff8a86");
  });
  on("healed", (t, h) => { if (inView(t.x, t.y) && h > 2) { magic(t.x, t.y - 4, "#9fe8a0", 4); } });
  on("death", (e) => {
    if (!inView(e.x, e.y) && e.team !== 0) return;
    if (e.kind === "bld") {
      const r = Math.max(e.w, e.h) * 16;
      blast(e.x, e.y, r, null, e.level - 1);
      debris(e.x, e.y, 30, e.level <= 2 ? "#6a4a2a" : "#7a7670");
      decals.push({ x: e.x, y: e.y, w: e.w * 32, h: e.h * 32, t: 0, max: 90, kind: "rubble", era: e.level - 1 });
    } else {
      if (e.st && (e.st.mech || e.st.air)) { blast(e.x, e.y, 24, null, e.tier); debris(e.x, e.y, 10, "#3a3a3a"); decals.push({ x: e.x, y: e.y, r: 14, t: 0, max: 40, kind: "scorch" }); }
      else { dust(e.x, e.y, 5, "#8a7a6a"); decals.push({ x: e.x, y: e.y, r: 7, t: 0, max: 20, kind: "fallen", team: e.team }); }
    }
  });
  on("tracer", (src, t, shot) => {
    if (!inView(t.x, t.y) && !inView(src.x, src.y)) return;
    tracers.push({ x0: src.x, y0: src.y - (src.kind === "bld" ? 24 : 8), x1: t.x + rnd(-3, 3), y1: t.y - 6 + rnd(-3, 3), t: 0, max: shot === "laser" || shot === "rail" || shot === "ion" ? 0.18 : 0.07, col: shotColor(shot), w: shot === "rail" || shot === "ion" ? 2.4 : shot === "laser" ? 1.8 : 1.1 });
    if (shot === "musket" || shot === "bullet") { smoke(src.x + Math.cos(src.face || 0) * 10, src.y - 8, 1, "#c8c4bc"); flashes.push({ x: src.x, y: src.y, r: 40, t: 0, max: 0.08, col: "#ffd27a" }); }
    else flashes.push({ x: src.x, y: src.y, r: 50, t: 0, max: 0.15, col: shotColor(shot) });
  });
  on("burst", (x, y, r, src) => { if (inView(x, y)) blast(x, y, r, null, src && src.tier !== undefined ? src.tier : G.era); });
  on("impact", (p, t) => {
    if (!inView(p.x, p.y)) return;
    if (p.lob && !p.splash) dust(p.x, p.y, 4);
    else if (p.shot === "arrow" || p.shot === "stone" || p.shot === "spear") { if (!t) dust(p.x, p.y, 2); }
    else if (p.shot === "hero" || p.shot === "bolt2") magic(p.x, p.y, energy(G.era), 8);
  });
  on("shot", (src, p) => { if ((p.shot === "shell" || p.shot === "boulder" || p.shot === "rocket") && inView(src.x, src.y)) { smoke(src.x, src.y - 8, 3, "#8a8680"); if (p.shot === "shell") flashes.push({ x: src.x, y: src.y, r: 60, t: 0, max: 0.12, col: "#ffcf6b" }); } });
  on("skill", (u, S, aim) => {
    const col = energy(G.era);
    magic(u.x, u.y - 8, col, 16);
    if (aim && aim.x !== undefined && S.aim === "ground") rings.push({ x: aim.x, y: aim.y, r0: 4, r1: (S.radius || 1.5) * TILE, t: 0, max: 0.4, col });
    if (S.id === "rally" || S.id === "overclock" || S.id === "mend" || S.id === "pulse") rings.push({ x: u.x, y: u.y, r0: 6, r1: S.range * TILE, t: 0, max: 0.5, col: S.id === "mend" ? "#9fe8a0" : col });
    if (S.id === "bulwark") rings.push({ x: u.x, y: u.y, r0: 20, r1: 6, t: 0, max: 0.4, col: "#ffe9a8" });
  });
  on("zoneHit", (z) => { if (z.kind === "cataclysm") { blast(z.x, z.y, z.r, energy(G.era), G.era); shake(8); } });
  on("blink", (u, x, y) => { magic(x, y, energy(G.era), 18); magic(u.x, u.y, energy(G.era), 18); });
  on("built", (b) => { if (b.team === 0) { dust(b.x, b.y + b.h * 12, 14, "#c8b08a"); rings.push({ x: b.x, y: b.y, r0: 10, r1: b.w * 24, t: 0, max: 0.5, col: "#ffffff" }); } });
  on("levelup", (b) => { column(b.x, b.y, "#ffe9a8"); });
  on("heroLevel", (u) => { column(u.x, u.y, "#ffe9a8"); float(u.x, u.y - 30, "Level " + u.lvl, "#ffe9a8"); });
  on("gathered", (u, r) => { if (r === "wood" && inView(u.x, u.y)) debris(u.x + Math.cos(u.face) * 10, u.y, 3, "#c8a068"); });
  on("deposit", (u, b, c) => { if (u.team === 0 && inView(b.x, b.y) && Math.random() < 0.35) float(b.x + rnd(-10, 10), b.y - b.h * 14, "+" + c.n, c.r === "gold" ? "#f4d03f" : c.r === "wood" ? "#c8a068" : "#c0c4c8"); });
  on("relic", (n) => { column(n.x, n.y, "#9fe8d0"); });
  on("depleted", (n) => { dust(n.x, n.y, 20, "#9a948a"); });
  on("trained", (u) => { if (u.team === 0) dust(u.x, u.y, 4); });
  on("era", () => { eraFlash = 1; });
  on("possess", () => {});
}
export let eraFlash = 0;
export let shakeAmt = 0;
export function shake(k) { shakeAmt = Math.max(shakeAmt, k); }

/* ---------------- the frame ---------------- */
export function update(dt) {
  for (const p of parts) {
    p.life -= dt;
    p.vx *= p.drag; p.vy *= p.drag;
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vz -= p.g * dt; p.z += p.vz * dt;
    if (p.z < 0) { if (p.bounce) { p.z = 0; p.vz *= -0.35; p.vx *= 0.6; p.vy *= 0.6; } else p.z = 0; }
    p.size = Math.max(0.3, p.size + p.grow * dt);
  }
  let w = 0; for (let i = 0; i < parts.length; i++) if (parts[i].life > 0) parts[w++] = parts[i]; parts.length = w;
  for (const a of [tracers, rings, texts, flashes]) { for (const t of a) t.t += dt; for (let i = a.length - 1; i >= 0; i--) if (a[i].t >= a[i].max) a.splice(i, 1); }
  for (const d of decals) d.t += dt;
  for (let i = decals.length - 1; i >= 0; i--) if (decals[i].t >= decals[i].max) decals.splice(i, 1);
  if (decals.length > 300) decals.splice(0, decals.length - 300);
  eraFlash = Math.max(0, eraFlash - dt * 0.6);
  shakeAmt = Math.max(0, shakeAmt - dt * 20);
}

export function drawDecals(ctx, x0, y0, x1, y1) {
  for (const d of decals) {
    if (d.x < x0 - 80 || d.x > x1 + 80 || d.y < y0 - 80 || d.y > y1 + 80) continue;
    const a = Math.min(1, (d.max - d.t) / 6);
    ctx.globalAlpha = a;
    if (d.kind === "rubble") {
      ctx.fillStyle = "rgba(40,34,30,0.55)"; ctx.beginPath(); ctx.ellipse(d.x, d.y, d.w * 0.5, d.h * 0.45, 0, 0, 6.3); ctx.fill();
      ctx.fillStyle = d.era <= 2 ? "#5a4028" : "#6a6660";
      for (let i = 0; i < 12; i++) { const k = (i * 7919) % 100 / 100, j = (i * 104729) % 100 / 100; ctx.fillRect(d.x - d.w * 0.4 + k * d.w * 0.8, d.y - d.h * 0.35 + j * d.h * 0.7, 4 + (i % 3) * 2, 3); }
    } else if (d.kind === "scorch") {
      const g = ctx.createRadialGradient(d.x, d.y, 1, d.x, d.y, d.r * 1.6); g.addColorStop(0, "rgba(20,16,14,0.7)"); g.addColorStop(1, "rgba(20,16,14,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(d.x, d.y, d.r * 1.6, 0, 6.3); ctx.fill();
    } else if (d.kind === "fallen") {
      ctx.fillStyle = d.team === 1 ? "rgba(90,70,110,0.45)" : "rgba(70,50,40,0.4)"; ctx.beginPath(); ctx.ellipse(d.x, d.y + 2, d.r * 1.3, d.r * 0.5, 0.3, 0, 6.3); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

export function drawParts(ctx, x0, y0, x1, y1, zoom) {
  for (const p of parts) {
    if (p.x < x0 - 40 || p.x > x1 + 40 || p.y < y0 - 60 || p.y > y1 + 60) continue;
    const k = Math.max(0, p.life / p.max);
    ctx.globalCompositeOperation = p.add ? "lighter" : "source-over";
    if (p.kind === "smoke") { ctx.globalAlpha = Math.min(0.5, k * 0.55); ctx.fillStyle = p.col; ctx.beginPath(); ctx.arc(p.x, p.y - p.z, p.size, 0, 6.3); ctx.fill(); }
    else if (p.kind === "fire" || p.kind === "glow") { ctx.globalAlpha = Math.min(1, k * 1.4); ctx.fillStyle = p.col; ctx.beginPath(); ctx.arc(p.x, p.y - p.z, p.size, 0, 6.3); ctx.fill(); }
    else { ctx.globalAlpha = Math.min(1, k * 2); ctx.fillStyle = p.col; ctx.fillRect(p.x - p.size / 2, p.y - p.z - p.size / 2, p.size, p.size); }
  }
  ctx.globalCompositeOperation = "source-over";
  for (const t of tracers) {
    const k = 1 - t.t / t.max;
    ctx.globalAlpha = k; ctx.strokeStyle = t.col; ctx.lineWidth = t.w; ctx.globalCompositeOperation = "lighter";
    ctx.beginPath(); ctx.moveTo(t.x0, t.y0); ctx.lineTo(t.x1, t.y1); ctx.stroke();
    if (t.w > 1.5) { ctx.lineWidth = t.w * 3; ctx.globalAlpha = k * 0.25; ctx.stroke(); }
  }
  ctx.globalCompositeOperation = "source-over";
  for (const r of rings) {
    const k = r.t / r.max, rad = r.r0 + (r.r1 - r.r0) * k;
    ctx.globalAlpha = (1 - k) * 0.8; ctx.strokeStyle = r.col; ctx.lineWidth = 2.5 * (1 - k) + 0.5;
    ctx.beginPath(); ctx.ellipse(r.x, r.y, rad, rad * 0.62, 0, 0, 6.3); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.font = "600 " + Math.round(11 / Math.max(0.6, zoom)) + "px system-ui, sans-serif"; ctx.textAlign = "center";
  for (const t of texts) {
    const k = t.t / t.max;
    ctx.globalAlpha = 1 - k * k; ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillText(t.text, t.x + 1, t.y - k * 18 + 1);
    ctx.fillStyle = t.col; ctx.fillText(t.text, t.x, t.y - k * 18);
  }
  ctx.globalAlpha = 1;
}

/* ---------------- weather ---------------- */
export const weather = { kind: "clear", k: 0, next: 120, drops: [] };
export function updateWeather(dt, biome, W, H, on) {
  weather.next -= dt;
  if (weather.next <= 0) {
    weather.next = 150 + Math.random() * 240;
    const r = Math.random();
    weather.kind = !on ? "clear" : r < 0.55 ? "clear" : biome === 2 ? "snow" : biome === 1 ? (r < 0.75 ? "clear" : "dust") : "rain";
  }
  const want = weather.kind === "clear" ? 0 : 1;
  weather.k += (want - weather.k) * Math.min(1, dt * 0.3);
  const n = Math.floor(weather.k * (weather.kind === "rain" ? 160 : 110) * quality);
  while (weather.drops.length < n) weather.drops.push({ x: Math.random() * W, y: Math.random() * H, s: 0.5 + Math.random() });
  if (weather.drops.length > n) weather.drops.length = n;
  for (const d of weather.drops) {
    if (weather.kind === "rain") { d.x -= 120 * dt * d.s; d.y += 700 * dt * d.s; }
    else if (weather.kind === "snow") { d.x += Math.sin(d.y * 0.02 + d.s * 5) * 20 * dt; d.y += 40 * dt * d.s; }
    else { d.x += 220 * dt * d.s; d.y += Math.sin(d.x * 0.01) * 20 * dt; }
    if (d.y > H) { d.y = -10; d.x = Math.random() * W; } if (d.x < -10) d.x = W; if (d.x > W + 10) d.x = 0;
  }
}
export function drawWeather(ctx, W, H) {
  if (weather.k < 0.02) return;
  if (weather.kind === "rain") {
    ctx.strokeStyle = "rgba(180,200,230,0.35)"; ctx.lineWidth = 1;
    ctx.beginPath(); for (const d of weather.drops) { ctx.moveTo(d.x, d.y); ctx.lineTo(d.x + 3 * d.s, d.y - 14 * d.s); } ctx.stroke();
    ctx.fillStyle = "rgba(20,30,50," + 0.12 * weather.k + ")"; ctx.fillRect(0, 0, W, H);
  } else if (weather.kind === "snow") {
    ctx.fillStyle = "rgba(240,246,255,0.8)"; for (const d of weather.drops) { ctx.beginPath(); ctx.arc(d.x, d.y, 1.2 * d.s + 0.4, 0, 6.3); ctx.fill(); }
  } else {
    ctx.fillStyle = "rgba(200,170,120," + 0.08 * weather.k + ")"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(220,190,140,0.4)"; for (const d of weather.drops) ctx.fillRect(d.x, d.y, 2 * d.s, 1);
  }
}
export { hexA, BUILDINGS, seen };
