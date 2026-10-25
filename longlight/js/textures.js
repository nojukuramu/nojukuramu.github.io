/* textures.js — the pictures that are drawn, not downloaded.
 *
 * The land, the huts and everything in them are photographs (Poly Haven and
 * ambientCG, CC0 — assets/textures, assets/models). These are the few things
 * no photograph fits, drawn once into canvases at load: a boot print with
 * its tread, the canvas of a polar tent, a flag faded by a season of sun,
 * a puff of smoke, a snowflake, the sea's ripples. flame() and glow() are
 * lifted whole from Last Flame (lastflame/js/textures.js), as is the shape
 * of this file. */

import * as THREE from "three";
import { rng } from "./rng.js";

function canvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}
function tex(c, srgb, repeat) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 4;
  return t;
}

/* A flame: a soft teardrop, white at the root, orange at the tip. (Last Flame's.) */
export function flame() {
  const W = 64, H = 128, c = canvas(W, H), x = c.getContext("2d");
  const g = x.createRadialGradient(W / 2, H * 0.72, 2, W / 2, H * 0.6, H * 0.5);
  g.addColorStop(0, "rgba(255,250,230,1)"); g.addColorStop(0.25, "rgba(255,200,110,0.95)"); g.addColorStop(0.6, "rgba(255,120,30,0.5)"); g.addColorStop(1, "rgba(255,80,0,0)");
  x.fillStyle = g;
  x.beginPath(); x.moveTo(W / 2, 4); x.bezierCurveTo(W * 0.95, H * 0.55, W * 0.85, H * 0.95, W / 2, H * 0.96); x.bezierCurveTo(W * 0.15, H * 0.95, W * 0.05, H * 0.55, W / 2, 4); x.fill();
  return tex(c, true);
}

/* A round soft glow, for the halo round a flame. (Last Flame's.) */
export function glow() {
  const S = 64, c = canvas(S, S), x = c.getContext("2d");
  const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.3, "rgba(255,255,255,0.35)"); g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g; x.fillRect(0, 0, S, S);
  return tex(c, true);
}

/* A boot print, as depth: a sole and a heel pressed into snow, with the lugs
   of the tread, the edges crumbled. Returned as a normal map (the depth's
   slopes, so the low sun shades the dent the way it shades the land) with
   the print's shape in its alpha. */
export function bootprint() {
  const W = 64, H = 160, c = canvas(W, H), x = c.getContext("2d"), r = rng(41);
  x.fillStyle = "#000"; x.fillRect(0, 0, W, H);
  x.filter = "blur(2px)";
  x.fillStyle = "#fff";
  // the sole and the heel
  x.beginPath(); x.ellipse(W / 2, H * 0.32, W * 0.4, H * 0.25, 0, 0, Math.PI * 2); x.fill();
  x.beginPath(); x.ellipse(W / 2, H * 0.78, W * 0.33, H * 0.17, 0, 0, Math.PI * 2); x.fill();
  x.filter = "none";
  // the lugs stand up out of the bottom of the print
  x.fillStyle = "rgba(0,0,0,0.35)";
  for (let y = 12; y < H * 0.55; y += 9) for (let k = -1; k <= 1; k += 2) x.fillRect(W / 2 + k * 4 - (k < 0 ? 12 : 0) + (r() - 0.5) * 2, y, 12, 4);
  for (let y = H * 0.66; y < H * 0.92; y += 9) x.fillRect(W / 2 - 10, y, 20, 4);
  const d = x.getImageData(0, 0, W, H).data;
  const h = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) h[i] = d[i * 4] / 255;
  const out = x.createImageData(W, H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const at = (a, b) => h[Math.min(H - 1, Math.max(0, b)) * W + Math.min(W - 1, Math.max(0, a))];
    // depth goes down where the print is: the normal leans toward the deeper side
    const dx = (at(i + 1, j) - at(i - 1, j)) * 2.2, dy = (at(i, j + 1) - at(i, j - 1)) * 2.2;
    const l = Math.hypot(dx, dy, 1), k = (j * W + i) * 4;
    out.data[k] = (dx / l * 0.5 + 0.5) * 255;
    out.data[k + 1] = (-dy / l * 0.5 + 0.5) * 255;
    out.data[k + 2] = (1 / l * 0.5 + 0.5) * 255;
    // the rim of the print shows too: the snow pushed up round it
    const rim = Math.min(1, Math.hypot(dx, dy) * 1.4);
    out.data[k + 3] = Math.min(255, (h[j * W + i] * 0.85 + rim * 0.6) * 255);
  }
  x.putImageData(out, 0, 0);
  const t = tex(c, false);
  t.anisotropy = 8;
  return t;
}

/* Tent canvas: heavy cotton, sun-bleached, with seams. */
export function canvasCloth(color) {
  const W = 256, H = 256, c = canvas(W, H), x = c.getContext("2d"), r = rng(color === "orange" ? 3 : 5);
  x.fillStyle = color === "orange" ? "#c4652a" : "#c9a43a"; x.fillRect(0, 0, W, H);
  // the weave
  for (let i = 0; i < 4000; i++) { x.fillStyle = `rgba(${r() < 0.5 ? "255,255,255" : "0,0,0"},${0.03 + r() * 0.05})`; x.fillRect(r() * W, r() * H, 1 + r() * 2, 1); }
  // seams, darker, every panel
  x.strokeStyle = "rgba(60,30,10,0.35)"; x.lineWidth = 3;
  for (let k = 0; k < W; k += 64) { x.beginPath(); x.moveTo(k + 2, 0); x.lineTo(k + 2, H); x.stroke(); }
  // bleached toward the top, stained near the snow
  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "rgba(255,250,235,0.25)"); g.addColorStop(0.8, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(50,40,30,0.25)");
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  return tex(c, true, true);
}

/* A route flag: nylon on a bamboo stake, a season of sun on it. */
export function flagCloth(color) {
  const W = 64, H = 48, c = canvas(W, H), x = c.getContext("2d"), r = rng(color === "red" ? 11 : 13);
  x.fillStyle = color === "red" ? "#a8322a" : "#2f6b3b"; x.fillRect(0, 0, W, H);
  for (let i = 0; i < 300; i++) { x.fillStyle = `rgba(255,255,255,${r() * 0.08})`; x.fillRect(r() * W, r() * H, 2, 2); }
  // frayed at the fly end
  x.globalCompositeOperation = "destination-out";
  for (let y = 0; y < H; y += 3) { x.fillRect(W - r() * 9, y, 10, 2); }
  return tex(c, true);
}

/* A puff of smoke: soft, lumpy, grey. */
export function smoke() {
  const S = 64, c = canvas(S, S), x = c.getContext("2d"), r = rng(23);
  for (let k = 0; k < 9; k++) {
    const cx = S / 2 + (r() - 0.5) * S * 0.35, cy = S / 2 + (r() - 0.5) * S * 0.35, rr = S * (0.18 + r() * 0.16);
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, rr);
    g.addColorStop(0, "rgba(255,255,255,0.35)"); g.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = g; x.fillRect(0, 0, S, S);
  }
  return tex(c, true);
}

/* A snowflake, at the size it is ever seen: a soft dot. */
export function flake() {
  const S = 32, c = canvas(S, S), x = c.getContext("2d");
  const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.4, "rgba(255,255,255,0.5)"); g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g; x.fillRect(0, 0, S, S);
  return tex(c, true);
}

/* The sea's ripples: a tiling normal map of a few wave trains. */
export function ripples() {
  const S = 256, c = canvas(S, S), x = c.getContext("2d"), r = rng(31);
  const waves = [];
  for (let k = 0; k < 9; k++) waves.push({ fx: Math.round((r() - 0.5) * 12), fy: Math.round((r() - 0.5) * 12) || 1, a: 0.3 + r() * 0.7, p: r() * 6.28 });
  const img = x.createImageData(S, S);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    let dx = 0, dy = 0;
    for (const w of waves) {
      const ph = ((w.fx * i + w.fy * j) / S) * Math.PI * 2 + w.p;
      const d = Math.cos(ph) * w.a;
      dx += d * w.fx * 0.05; dy += d * w.fy * 0.05;
    }
    const l = Math.hypot(dx, dy, 1), k = (j * S + i) * 4;
    img.data[k] = (dx / l * 0.5 + 0.5) * 255; img.data[k + 1] = (dy / l * 0.5 + 0.5) * 255; img.data[k + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[k + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  return tex(c, false, true);
}

/* A slush ring: the edge of a hole kept open in the sea ice. */
export function slush() {
  const S = 128, c = canvas(S, S), x = c.getContext("2d"), r = rng(37);
  x.clearRect(0, 0, S, S);
  for (let k = 0; k < 220; k++) {
    const a = r() * Math.PI * 2, d = S * (0.36 + r() * 0.12);
    x.fillStyle = `rgba(${220 + r() * 35},${230 + r() * 25},255,${0.3 + r() * 0.5})`;
    x.beginPath(); x.arc(S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, 2 + r() * 5, 0, Math.PI * 2); x.fill();
  }
  return tex(c, true);
}
