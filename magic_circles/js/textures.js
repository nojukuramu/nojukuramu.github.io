/* textures.js — what is drawn rather than downloaded.
 *
 * Kenney's models are flat colour on purpose, and a photographed ground
 * under them looks like a different game. So the ground's grain, the four
 * kinds of road and the two kinds of floor are painted here on canvases, in
 * the same flat, slightly chunky style, once at boot. The Phaser build
 * painted its floors the same way (BiomeRenderer.js); these are new
 * drawings, sized for a tilted camera instead of a flat one. */

import * as THREE from "three";

function canvas(n) { const c = document.createElement("canvas"); c.width = c.height = n; return c; }
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function tex(c, srgb) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
/** Wrap-around drawing: a blob near an edge is drawn again on the far side, so the tile repeats seamlessly. */
function wrapDraw(n, x, y, r, fn) {
  for (const dx of [-n, 0, n]) for (const dy of [-n, 0, n]) {
    if (x + dx + r < 0 || x + dx - r > n || y + dy + r < 0 || y + dy - r > n) continue;
    fn(x + dx, y + dy);
  }
}

/** Grey grain multiplied over the ground's vertex colours: tufts, pebbles, a little light and shade. */
export function groundDetail() {
  const n = 256, c = canvas(n), g = c.getContext("2d"), r = rng(7);
  g.fillStyle = "#d8d8d8"; g.fillRect(0, 0, n, n);
  for (let i = 0; i < 900; i++) {
    const x = r() * n, y = r() * n, s = 1 + r() * 3.5, v = 170 + r() * 85;
    g.fillStyle = "rgb(" + v + "," + v + "," + v + ")";
    wrapDraw(n, x, y, s, (X, Y) => { g.beginPath(); g.arc(X, Y, s, 0, Math.PI * 2); g.fill(); });
  }
  for (let i = 0; i < 240; i++) {
    const x = r() * n, y = r() * n, l = 3 + r() * 5, v = 150 + r() * 60;
    g.strokeStyle = "rgb(" + v + "," + v + "," + v + ")"; g.lineWidth = 1.3;
    wrapDraw(n, x, y, l, (X, Y) => { g.beginPath(); g.moveTo(X, Y); g.lineTo(X + (r() - 0.5) * 3, Y - l); g.stroke(); });
  }
  return tex(c, true);
}

const PATHS = {
  dirt:   { base: "#a5835a", dark: "#8a6a45", light: "#bf9d6e", kind: "speckle" },
  sand:   { base: "#e3cc93", dark: "#cdb075", light: "#f0dcaa", kind: "ripple" },
  stone:  { base: "#a29d92", dark: "#7e796f", light: "#bdb8ac", kind: "flags" },
  cobble: { base: "#9a948a", dark: "#6f6a62", light: "#b8b2a6", kind: "cobble" }
};
function paintSurface(g, n, P, r) {
  g.fillStyle = P.base; g.fillRect(0, 0, n, n);
  if (P.kind === "speckle" || P.kind === "ripple") {
    for (let i = 0; i < 700; i++) {
      const x = r() * n, y = r() * n, s = 1 + r() * 3;
      g.fillStyle = r() < 0.5 ? P.dark : P.light;
      wrapDraw(n, x, y, s, (X, Y) => { g.beginPath(); g.arc(X, Y, s, 0, Math.PI * 2); g.fill(); });
    }
    if (P.kind === "ripple") {
      g.strokeStyle = P.dark; g.lineWidth = 2; g.globalAlpha = 0.45;
      for (let y = 8; y < n; y += 16) { g.beginPath(); for (let x = 0; x <= n; x += 8) g.lineTo(x, y + Math.sin(x / n * Math.PI * 4) * 3); g.stroke(); }
      g.globalAlpha = 1;
    }
  } else if (P.kind === "flags") {
    // big irregular flagstones with dark joints
    g.fillStyle = P.dark; g.fillRect(0, 0, n, n);
    const cell = n / 4;
    for (let yy = 0; yy < 4; yy++) for (let xx = 0; xx < 4; xx++) {
      const sh = 0.85 + r() * 0.3;
      g.fillStyle = r() < 0.5 ? P.base : P.light;
      g.globalAlpha = sh;
      const off = (yy % 2) * cell / 2;
      wrapDraw(n, xx * cell + off + cell / 2, yy * cell + cell / 2, cell, (X, Y) => {
        g.beginPath(); g.roundRect(X - cell / 2 + 3, Y - cell / 2 + 3, cell - 6, cell - 6, 6); g.fill();
      });
      g.globalAlpha = 1;
    }
  } else if (P.kind === "cobble") {
    g.fillStyle = P.dark; g.fillRect(0, 0, n, n);
    for (let yy = 0; yy < 8; yy++) for (let xx = 0; xx < 8; xx++) {
      const x = xx * n / 8 + n / 16 + (yy % 2) * n / 16, y = yy * n / 8 + n / 16, rr = n / 16 - 2 - r() * 2;
      const v = r();
      g.fillStyle = v < 0.33 ? P.base : v < 0.66 ? P.light : "#a8a196";
      wrapDraw(n, x, y, rr, (X, Y) => { g.beginPath(); g.ellipse(X, Y, rr, rr * (0.8 + r() * 0.2), r(), 0, Math.PI * 2); g.fill(); });
    }
  }
}
const pathCache = {};
export function pathTexture(kind) {
  if (pathCache[kind]) return pathCache[kind];
  const n = 256, c = canvas(n), g = c.getContext("2d");
  paintSurface(g, n, PATHS[kind] || PATHS.dirt, rng(kind.length * 97 + 3));
  return (pathCache[kind] = tex(c, true));
}

const FLOORS = {
  stone:  { base: "#b4aea2", dark: "#77726a", light: "#c9c3b6", kind: "flags" },
  cobble: { base: "#a49d90", dark: "#6c675f", light: "#bfb8ab", kind: "cobble" }
};
const floorCache = {};
export function floorTexture(kind) {
  if (floorCache[kind]) return floorCache[kind];
  const n = 256, c = canvas(n), g = c.getContext("2d");
  paintSurface(g, n, FLOORS[kind] || FLOORS.stone, rng(kind.length * 131 + 11));
  return (floorCache[kind] = tex(c, true));
}

/** A soft white disc for halos and the waystone's glow. */
let glowT = null;
export function glowTexture() {
  if (glowT) return glowT;
  const c = canvas(64), g = c.getContext("2d");
  const gr = g.createRadialGradient(32, 32, 1, 32, 32, 31);
  gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.3, "rgba(255,255,255,0.45)"); gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  glowT = new THREE.CanvasTexture(c);
  return glowT;
}
let shadowT = null;
export function blobTexture() {
  if (shadowT) return shadowT;
  const c = canvas(64), g = c.getContext("2d");
  const gr = g.createRadialGradient(32, 32, 4, 32, 32, 31);
  gr.addColorStop(0, "rgba(0,0,0,0.5)"); gr.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  shadowT = new THREE.CanvasTexture(c);
  return shadowT;
}
