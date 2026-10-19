/* textures.js — the pictures that are drawn, not downloaded.
 *
 * The house's surfaces are photographs (Poly Haven, CC0 — assets/textures).
 * These are the things no photograph fits: the capiz shell panes of the
 * windows, the calado fretwork that runs along the top of the inner walls so
 * the rooms can breathe, Lola's handwriting, and the face no one should see
 * twice. All drawn once into canvases at load.
 *
 * Everything here is deterministic (seeded), so the same face looks out of
 * every house. */

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

/* Capiz: squares of flattened windowpane-oyster shell in a wooden lattice.
   Each shell is a little different — milky, with growth rings. */
export function capiz() {
  const W = 256, H = 512, c = canvas(W, H), x = c.getContext("2d"), r = rng(7);
  x.fillStyle = "#2a1a10"; x.fillRect(0, 0, W, H);
  const n = 4, m = 8, cw = W / n, ch = H / m, pad = 5;
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
    const x0 = i * cw + pad, y0 = j * ch + pad, w = cw - pad * 2, h = ch - pad * 2;
    const base = 200 + r() * 30;
    const g = x.createRadialGradient(x0 + w * (0.3 + r() * 0.4), y0 + h * (0.3 + r() * 0.4), 2, x0 + w / 2, y0 + h / 2, w);
    g.addColorStop(0, `rgb(${base + 20},${base + 14},${base})`);
    g.addColorStop(1, `rgb(${base - 40},${base - 44},${base - 50})`);
    x.fillStyle = g; x.fillRect(x0, y0, w, h);
    x.strokeStyle = "rgba(120,100,80,0.25)"; x.lineWidth = 1;
    const cx = x0 + w * r(), cy = y0 + h;
    for (let k = 1; k < 6; k++) { x.beginPath(); x.arc(cx, cy, k * w * 0.22 + r() * 3, Math.PI, Math.PI * 2); x.stroke(); }
  }
  return tex(c, true);
}

/* Calado: a pierced fretwork band. Alpha is the pattern (white = wood). */
export function calado() {
  const W = 512, H = 128, c = canvas(W, H), x = c.getContext("2d");
  x.fillStyle = "#fff"; x.fillRect(0, 0, W, H);
  x.fillStyle = "#000";
  // a repeating motif: a four-petal flower between scrolls
  const unit = 128;
  for (let u = 0; u < W; u += unit) {
    const cx = u + unit / 2, cy = H / 2;
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2 + Math.PI / 4;
      x.beginPath(); x.ellipse(cx + Math.cos(a) * 20, cy + Math.sin(a) * 20, 15, 8, a, 0, Math.PI * 2); x.fill();
    }
    x.beginPath(); x.arc(cx, cy, 6, 0, Math.PI * 2); x.fill();
    for (const s of [-1, 1]) {
      x.beginPath(); x.ellipse(cx + s * 46, cy - 22, 9, 16, s * 0.6, 0, Math.PI * 2); x.fill();
      x.beginPath(); x.ellipse(cx + s * 46, cy + 22, 9, 16, -s * 0.6, 0, Math.PI * 2); x.fill();
    }
    x.fillRect(u + 6, 8, 3, H - 16);
  }
  // a solid rail top and bottom
  x.fillStyle = "#fff"; x.fillRect(0, 0, W, 10); x.fillRect(0, H - 10, W, 10);
  const t = tex(c, false, true);
  return t;
}

/* Paper with a few lines of handwriting on it, for the notes. */
export function paper() {
  const W = 256, H = 320, c = canvas(W, H), x = c.getContext("2d"), r = rng(11);
  x.fillStyle = "#d8ccb0"; x.fillRect(0, 0, W, H);
  for (let k = 0; k < 600; k++) { x.fillStyle = `rgba(110,80,40,${r() * 0.06})`; x.fillRect(r() * W, r() * H, 2 + r() * 6, 2 + r() * 6); }
  x.strokeStyle = "rgba(30,25,60,0.75)"; x.lineWidth = 2;
  for (let ln = 0; ln < 9; ln++) {
    const y = 40 + ln * 28;
    x.beginPath(); x.moveTo(24, y);
    for (let px = 24; px < W - 30 - (ln === 8 ? 90 : 0); px += 6) x.lineTo(px, y + Math.sin(px * 0.5 + ln) * 3 + (r() - 0.5) * 3);
    x.stroke();
  }
  return tex(c, true);
}

/* The head, wrapped round a sphere: a face on the front (u = 0.25 is where
   three's sphere faces +z), dark scalp everywhere else. Pale, too long, the
   eyes two holes, and a mouth that runs further than a mouth should. */
export function face() {
  const W = 512, H = 256, c = canvas(W, H), x = c.getContext("2d"), r = rng(13);
  x.fillStyle = "#1a1917"; x.fillRect(0, 0, W, H);
  const fx = W * 0.25;
  const g = x.createRadialGradient(fx, H * 0.55, 6, fx, H * 0.58, W * 0.2);
  g.addColorStop(0, "#9c9b90"); g.addColorStop(0.55, "#6f6e65"); g.addColorStop(1, "rgba(26,25,23,1)");
  x.fillStyle = g; x.beginPath(); x.ellipse(fx, H * 0.58, W * 0.16, H * 0.36, 0, 0, Math.PI * 2); x.fill();
  // veins
  x.strokeStyle = "rgba(40,50,70,0.35)"; x.lineWidth = 1;
  for (let k = 0; k < 18; k++) { x.beginPath(); let px = fx + (r() - 0.5) * 120, py = H * (0.3 + r() * 0.5); x.moveTo(px, py); for (let s = 0; s < 5; s++) { px += (r() - 0.5) * 16; py += (r() - 0.3) * 12; x.lineTo(px, py); } x.stroke(); }
  // eyes: deep sockets, then the holes
  for (const sgn of [-1, 1]) {
    const ex = fx + sgn * 30, ey = H * 0.47;
    const sg = x.createRadialGradient(ex, ey, 2, ex, ey, 26);
    sg.addColorStop(0, "rgba(0,0,0,1)"); sg.addColorStop(0.5, "rgba(8,6,6,0.95)"); sg.addColorStop(1, "rgba(30,25,25,0)");
    x.fillStyle = sg; x.beginPath(); x.ellipse(ex, ey, 26, 20, sgn * 0.2, 0, Math.PI * 2); x.fill();
    x.fillStyle = "#000"; x.beginPath(); x.ellipse(ex, ey + 1, 10, 13, 0, 0, Math.PI * 2); x.fill();
  }
  // the mouth, slit wide past where the cheeks are, teeth like splinters
  const my = H * 0.72;
  x.fillStyle = "#0e0605";
  x.beginPath(); x.moveTo(fx - 62, my - 8); x.quadraticCurveTo(fx, my + 26, fx + 62, my - 8); x.quadraticCurveTo(fx, my + 4, fx - 62, my - 8); x.fill();
  x.fillStyle = "#bdb498";
  for (let k = 0; k < 16; k++) { const tx = fx - 46 + k * 6; x.beginPath(); x.moveTo(tx, my + 2); x.lineTo(tx + 2, my + 9 + r() * 6); x.lineTo(tx + 4, my + 2); x.fill(); }
  return tex(c, true);
}

/* Hair: long black strands, some lighter where the lantern would catch
   them; the alpha thins them out into separate locks at the tips. */
export function hair() {
  const W = 256, H = 256, c = canvas(W, H), x = c.getContext("2d"), r = rng(29);
  x.fillStyle = "#151311"; x.fillRect(0, 0, W, H);
  for (let k = 0; k < 220; k++) { const px = r() * W, g = 20 + r() * 45; x.strokeStyle = `rgb(${g},${g * 0.92},${g * 0.85})`; x.lineWidth = 0.6 + r() * 1.4; x.beginPath(); x.moveTo(px, 0); x.bezierCurveTo(px + (r() - 0.5) * 8, H * 0.3, px + (r() - 0.5) * 10, H * 0.7, px + (r() - 0.5) * 14, H); x.stroke(); }
  return tex(c, true, true);
}
export function hairAlpha() {
  const W = 256, H = 256, c = canvas(W, H), x = c.getContext("2d"), r = rng(31);
  x.fillStyle = "#000"; x.fillRect(0, 0, W, H);
  // locks: dense at the root (top, v = 1), thinning and ragged toward the tips
  for (let k = 0; k < 160; k++) {
    const px = r() * W, w = 1.5 + r() * 4, end = H * (0.55 + r() * 0.45);
    const grad = x.createLinearGradient(0, 0, 0, end);
    grad.addColorStop(0, "#fff"); grad.addColorStop(0.85, "#fff"); grad.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = grad;
    x.beginPath(); x.moveTo(px - w, 0); x.lineTo(px + w, 0); x.lineTo(px + w * 0.4 + (r() - 0.5) * 8, end); x.lineTo(px - w * 0.4 + (r() - 0.5) * 8, end); x.fill();
  }
  x.fillStyle = "#fff"; x.fillRect(0, 0, W, H * 0.22);
  return tex(c, false, true);
}

/* Skin: grey, mottled, with the veins showing. */
export function skin() {
  const W = 256, H = 256, c = canvas(W, H), x = c.getContext("2d"), r = rng(23);
  x.fillStyle = "#9a988c"; x.fillRect(0, 0, W, H);
  for (let k = 0; k < 500; k++) { x.fillStyle = `rgba(${50 + r() * 40},${55 + r() * 40},${60 + r() * 30},${r() * 0.12})`; x.beginPath(); x.arc(r() * W, r() * H, 2 + r() * 14, 0, Math.PI * 2); x.fill(); }
  x.strokeStyle = "rgba(50,60,85,0.35)"; x.lineWidth = 1;
  for (let k = 0; k < 40; k++) { x.beginPath(); let px = r() * W, py = r() * H; x.moveTo(px, py); for (let s = 0; s < 8; s++) { px += (r() - 0.5) * 26; py += (r() - 0.2) * 20; x.lineTo(px, py); } x.stroke(); }
  return tex(c, true, true);
}

/* Cloth: a dirty white dress with a torn hem. Alpha cuts the tatters. */
export function cloth() {
  const W = 256, H = 256, c = canvas(W, H), x = c.getContext("2d"), r = rng(17);
  x.fillStyle = "#b9b2a0"; x.fillRect(0, 0, W, H);
  for (let k = 0; k < 900; k++) { x.fillStyle = `rgba(${60 + r() * 40},${50 + r() * 30},${30 + r() * 20},${r() * 0.12})`; x.fillRect(r() * W, r() * H, 1 + r() * 12, 1 + r() * 30); }
  // stains, darker toward the hem
  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "rgba(40,30,20,0)"); g.addColorStop(1, "rgba(40,28,18,0.55)");
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  return tex(c, true, true);
}
export function clothAlpha() {
  const W = 256, H = 256, c = canvas(W, H), x = c.getContext("2d"), r = rng(19);
  x.fillStyle = "#fff"; x.fillRect(0, 0, W, H);
  x.fillStyle = "#000";
  // a ragged hem: long tears up from the bottom, and a few holes
  for (let px = 0; px < W; px += 6 + r() * 9) {
    const h = 20 + r() * 110;
    x.beginPath(); x.moveTo(px, H); x.lineTo(px + 2 + r() * 5, H - h); x.lineTo(px + 6 + r() * 8, H); x.fill();
  }
  for (let k = 0; k < 9; k++) { x.beginPath(); x.ellipse(r() * W, H * 0.4 + r() * H * 0.5, 3 + r() * 8, 4 + r() * 12, r() * 3, 0, Math.PI * 2); x.fill(); }
  return tex(c, false, true);
}

/* A flame: a soft teardrop, white at the root, orange at the tip. */
export function flame() {
  const W = 64, H = 128, c = canvas(W, H), x = c.getContext("2d");
  const g = x.createRadialGradient(W / 2, H * 0.72, 2, W / 2, H * 0.6, H * 0.5);
  g.addColorStop(0, "rgba(255,250,230,1)"); g.addColorStop(0.25, "rgba(255,200,110,0.95)"); g.addColorStop(0.6, "rgba(255,120,30,0.5)"); g.addColorStop(1, "rgba(255,80,0,0)");
  x.fillStyle = g;
  x.beginPath(); x.moveTo(W / 2, 4); x.bezierCurveTo(W * 0.95, H * 0.55, W * 0.85, H * 0.95, W / 2, H * 0.96); x.bezierCurveTo(W * 0.15, H * 0.95, W * 0.05, H * 0.55, W / 2, 4); x.fill();
  return tex(c, true);
}

/* A round soft glow, for the halo round a flame and the eyeshine. */
export function glow() {
  const S = 64, c = canvas(S, S), x = c.getContext("2d");
  const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.3, "rgba(255,255,255,0.35)"); g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g; x.fillRect(0, 0, S, S);
  return tex(c, true);
}
