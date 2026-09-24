/* glyphart.js — draws a spell design onto any 2D canvas.
 *
 * One drawing routine, four places it appears: the forge page you edit, the
 * thumbnails on the spell bar, the circle that lights up under your feet
 * when you cast, and the preset list. Same lines everywhere, so the spell on
 * the bar is recognisably the page you drew. */

import { RING_R, NODES, nodePos, elementForSides, ELEMENTS, formForRadius } from "./spellcore.js";
import { TAU } from "./util.js";

export const SEAL_COLOR = "#b39dff";
export const RING_COLOR = "#c9a45c";

/**
 * drawDesign(ctx, design, {
 *   cx, cy, scale,          where the page centre is and design→px scale
 *   active,                 index of the layer drawn at full strength (others ghosted)
 *   nodes: bool,            draw the twelve dots
 *   glow: bool,             canvas shadow glow (costly; off for thumbnails)
 *   line: number,           base line width in px
 *   mono: css colour        draw everything in one colour (the floor circle)
 * })
 */
export function drawDesign(ctx, design, o) {
  const s = o.scale, lw = o.line || 2;
  ctx.save();
  ctx.translate(o.cx, o.cy);
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  const layers = design.layers || [];
  const order = layers.map((_, i) => i).filter((i) => i !== o.active);
  if (o.active !== undefined && o.active >= 0 && o.active < layers.length) order.push(o.active);
  for (const li of order) {
    const L = layers[li];
    const act = o.active === undefined || li === o.active;
    ctx.globalAlpha = act ? 1 : 0.28;
    // the ring
    ctx.strokeStyle = o.mono || RING_COLOR;
    ctx.globalAlpha = (act ? 1 : 0.28) * (o.mono ? 0.9 : 0.55);
    ctx.lineWidth = lw * 0.8;
    ctx.beginPath(); ctx.arc(0, 0, RING_R * s, 0, TAU); ctx.stroke();
    if (o.outer) { ctx.lineWidth = lw * 0.5; ctx.beginPath(); ctx.arc(0, 0, (RING_R + 14) * s, 0, TAU); ctx.stroke(); }
    ctx.globalAlpha = act ? 1 : 0.28;
    // glyphs
    for (const g of L.glyphs) {
      const el = elementForSides(g.nodes.length);
      const col = o.mono || (el ? ELEMENTS[el].color : "#fff");
      ctx.strokeStyle = col;
      ctx.fillStyle = o.mono ? "rgba(0,0,0,0)" : col + "26";
      ctx.lineWidth = lw * 1.4;
      if (o.glow && act) { ctx.shadowColor = col; ctx.shadowBlur = 12; }
      ctx.beginPath();
      g.nodes.forEach((n, k) => { const p = nodePos(n); k ? ctx.lineTo(p.x * s, p.y * s) : ctx.moveTo(p.x * s, p.y * s); });
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0;
    }
    // seals and runes
    for (const c of L.seals) {
      const col = o.mono || SEAL_COLOR;
      ctx.strokeStyle = col; ctx.fillStyle = col;
      ctx.lineWidth = lw * 1.1;
      if (o.glow && act) { ctx.shadowColor = col; ctx.shadowBlur = 10; }
      ctx.beginPath(); ctx.arc(c.x * s, c.y * s, c.r * s, 0, TAU); ctx.stroke();
      if (formForRadius(c.r) === "nova") {
        ctx.setLineDash([4 * lw, 3 * lw]);
        ctx.beginPath(); ctx.arc(c.x * s, c.y * s, c.r * s * 0.78, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
      }
      for (const a of c.runes) {
        const rx = c.x + Math.cos(a) * c.r, ry = c.y + Math.sin(a) * c.r;
        const ex = c.x + Math.cos(a) * (c.r + 16), ey = c.y + Math.sin(a) * (c.r + 16);
        ctx.beginPath(); ctx.moveTo(rx * s, ry * s); ctx.lineTo(ex * s, ey * s); ctx.stroke();
        ctx.beginPath(); ctx.arc(rx * s, ry * s, Math.max(1.5, 5 * s), 0, TAU); ctx.fill();
      }
      ctx.shadowBlur = 0;
    }
    if (o.nodes && act) {
      ctx.fillStyle = o.mono || "#e8ddc8";
      for (let i = 0; i < NODES; i++) { const p = nodePos(i); ctx.beginPath(); ctx.arc(p.x * s, p.y * s, 4.5 * Math.max(0.6, s), 0, TAU); ctx.fill(); }
    }
  }
  ctx.restore();
}

/** Fit the whole design (ring plus anything drawn outside it) into a box. */
export function fitScale(design, px) {
  let ext = RING_R + 8;
  for (const L of design.layers || []) for (const c of L.seals) ext = Math.max(ext, Math.hypot(c.x, c.y) + c.r + 18);
  return px / 2 / ext;
}

/** A small square thumbnail as a data URL — cached by the caller. */
export function thumbnail(design, px) {
  const cv = document.createElement("canvas");
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = cv.height = Math.round(px * dpr);
  const ctx = cv.getContext("2d");
  ctx.scale(dpr, dpr);
  drawDesign(ctx, design, { cx: px / 2, cy: px / 2, scale: fitScale(design, px), line: 1.3 });
  return cv;
}
