/* forge.js — the Spellbook: where you draw.
 *
 * The first forge sat three screens deep: craft a crafting table, place it,
 * open it, switch to a tab, craft a parchment, put the parchment in a slot,
 * then draw, then "embed". The drawing itself was the good part and is kept;
 * everything in front of it is gone. The book opens from anywhere with one
 * key or one tap, pauses the game, and every stroke is saved as you make it.
 *
 * What it adds:
 *   - stamps: tap an element to place its perfect shape, for anyone who
 *     would rather not trace a pentagon with a thumb
 *   - tap-to-connect: tap dots one at a time instead of dragging
 *   - Mirror (on by default): anything you add is reflected left-to-right,
 *     so pages come out balanced without thinking about it
 *   - Undo, move a seal by dragging its centre, pinch and wheel zoom
 *   - a live label while you draw ("5 sides · Earth", "Orb") and a little
 *     arena under the readout that keeps firing the page at dummies, so what
 *     a drawing does is shown, not described */

import { S, emit } from "./state.js";
import { save, SLOTS } from "./save.js";
import {
  RING_R, NODES, nodePos, elementForSides, ELEMENTS, FORMS, formForRadius, novaRadius,
  REACTIONS, RANKS, MAX_RANK, SEAL_MIN_R, SEAL_MAX_R, PAGE_R, MAX_NAME, compileSpell, overLimits, rankNeeded,
  emptyLayer, cloneDesign, PRESETS, elementInfo
} from "./spellcore.js";
import { drawDesign, thumbnail, SEAL_COLOR } from "./glyphart.js";
import { icon, hydrateIcons } from "./icons.js";
import { TAU, clamp, escHtml } from "./util.js";

const $ = (id) => document.getElementById(id);
const cv = () => $("page");

const F = {
  open: false, slot: 0, layer: 0, tool: "glyph", mirror: true,
  zoom: 1, panX: 0, panY: 0, scale: 1, cx: 0, cy: 0,
  path: null, tapPath: false, seal: null, moveSeal: null, cursor: null,
  undo: [], pointers: new Map(), pinch: null, label: "", onClose: null, rankOverride: null
};

function rank() {
  if (F.rankOverride) return F.rankOverride;
  if (S.mode === "sandbox") return MAX_RANK;
  if (S.player) return S.player.rank;
  return MAX_RANK;
}
function lim() { return RANKS[rank()]; }
function design() { return save.spell(F.slot); }
function L() { const d = design(); return d.layers[Math.min(F.layer, d.layers.length - 1)]; }
function mods() { return S.player ? S.player.spellMods() : undefined; }

function snapshot() {
  F.undo.push(JSON.stringify(design()));
  if (F.undo.length > 60) F.undo.shift();
}
function commit() {
  save.setSpell(F.slot, design());
  if (S.player) S.player.recompile();
  renderPanel();
  draw();
}
let toastT = 0;
function say(msg) {
  const h = $("pageHint");
  h.textContent = msg; h.classList.add("warn");
  clearTimeout(toastT);
  toastT = setTimeout(() => { h.classList.remove("warn"); hint(); }, 1800);
}
function hint() {
  const h = $("pageHint");
  if (h.classList.contains("warn")) return;
  const t = F.tool;
  h.textContent = t === "glyph" ? (F.tapPath ? "Tap the next dot — tap the first one to close" : "Trace through the dots, or tap a stamp")
    : t === "seal" ? "Drag out a circle — its size is its form"
      : t === "rune" ? "Tap a seal's rim to aim a shot"
        : "Tap anything to rub it out";
}

/* ---------------------------------------------------------------
   Geometry
   --------------------------------------------------------------- */
function fit() {
  const c = cv(), wrap = c.parentElement;
  const w = wrap.clientWidth, h = wrap.clientHeight;
  const dpr = Math.min(2, devicePixelRatio || 1);
  c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
  c.style.width = w + "px"; c.style.height = h + "px";
  F.cx = w / 2; F.cy = h / 2;
  F.scale = Math.min(w, h) / (2 * (RING_R + 70));
}
const zs = () => F.scale * F.zoom;
function toDesign(e) {
  const r = cv().getBoundingClientRect();
  return { x: (e.clientX - r.left - F.cx - F.panX) / zs(), y: (e.clientY - r.top - F.cy - F.panY) / zs() };
}
function nearestNode(p, tol) {
  let best = -1, bd = tol;
  for (let i = 0; i < NODES; i++) { const n = nodePos(i); const d = Math.hypot(n.x - p.x, n.y - p.y); if (d < bd) { bd = d; best = i; } }
  return best;
}
const mirrorNode = (i) => (NODES - i) % NODES;
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

/* ---------------------------------------------------------------
   Adding things
   --------------------------------------------------------------- */
function addGlyph(nodes) {
  const el = elementForSides(nodes.length);
  if (!el) { say("Glyphs have 3 to 6 sides — that one had " + nodes.length); return false; }
  const layer = L();
  const mirrored = nodes.map(mirrorNode);
  const withMirror = F.mirror && !sameSet(mirrored, nodes);
  const need = withMirror ? 2 : 1;
  if (layer.glyphs.length + need > lim().glyphs) {
    if (withMirror && layer.glyphs.length + 1 <= lim().glyphs) { say("Room for one more glyph, not its mirror"); }
    else { say("Rank " + rank() + " holds " + lim().glyphs + " glyphs per layer"); return false; }
  }
  snapshot();
  layer.glyphs.push({ nodes: nodes.slice() });
  if (withMirror && layer.glyphs.length < lim().glyphs && !layer.glyphs.some((g) => sameSet(g.nodes, mirrored))) layer.glyphs.push({ nodes: mirrored });
  emit("ui");
  commit();
  return true;
}
const STAMPS = {
  fire: [[0, 3, 6, 9], [1, 5, 7, 11], [2, 4, 8, 10]],
  air: [[0, 4, 8], [6, 10, 2]],
  water: [[0, 2, 4, 6, 8, 10], [1, 3, 5, 7, 9, 11]],
  earth: [[0, 2, 5, 7, 10], [6, 8, 11, 1, 4]]
};
function stamp(el) {
  const layer = L();
  const variants = STAMPS[el];
  const have = layer.glyphs.filter((g) => elementForSides(g.nodes.length) === el).length;
  const nodes = variants[have % variants.length];
  const was = F.mirror; F.mirror = false;   // stamps are symmetric already
  addGlyph(nodes);
  F.mirror = was;
}
function addSeal(x, y, r) {
  const layer = L();
  const mirror = F.mirror && Math.abs(x) > 12;
  if (layer.seals.length + (mirror ? 2 : 1) > lim().seals) {
    if (!(mirror && layer.seals.length + 1 <= lim().seals)) { say("Rank " + rank() + " holds " + lim().seals + " seals per layer"); return; }
  }
  snapshot();
  layer.seals.push({ x, y, r, runes: [] });
  if (mirror && layer.seals.length < lim().seals) layer.seals.push({ x: -x, y, r, runes: [] });
  emit("ui");
  commit();
}
function toggleRune(seal, a) {
  const step = Math.PI / 12;
  a = Math.round(a / step) * step;
  const near = (list, ang) => list.findIndex((q) => Math.abs(Math.atan2(Math.sin(q - ang), Math.cos(q - ang))) < 0.12);
  const i = near(seal.runes, a);
  snapshot();
  const partner = F.mirror && Math.abs(seal.x) < 12 ? Math.PI - a : null;
  const mirrorSeal = F.mirror && Math.abs(seal.x) >= 12 ? L().seals.find((s) => s !== seal && Math.abs(s.x + seal.x) < 12 && Math.abs(s.y - seal.y) < 12 && Math.abs(s.r - seal.r) < 12) : null;
  if (i >= 0) {
    seal.runes.splice(i, 1);
    if (partner !== null) { const j = near(seal.runes, partner); if (j >= 0) seal.runes.splice(j, 1); }
    if (mirrorSeal) { const j = near(mirrorSeal.runes, Math.PI - a); if (j >= 0) mirrorSeal.runes.splice(j, 1); }
  } else {
    if (formForRadius(seal.r) === "nova") { F.undo.pop(); say("A Nova bursts all around — runes do nothing on it"); return; }
    if (seal.runes.length >= lim().runes) { F.undo.pop(); say("Rank " + rank() + " holds " + lim().runes + " runes per seal"); return; }
    seal.runes.push(a);
    if (partner !== null && near(seal.runes, partner) < 0 && seal.runes.length < lim().runes) seal.runes.push(partner);
    if (mirrorSeal && near(mirrorSeal.runes, Math.PI - a) < 0 && mirrorSeal.runes.length < lim().runes) mirrorSeal.runes.push(Math.PI - a);
  }
  emit("ui");
  commit();
}
function eraseAt(p) {
  const layer = L();
  const tol = 16 / F.zoom + 6;
  for (const s of layer.seals) for (let i = 0; i < s.runes.length; i++) {
    const a = s.runes[i];
    if (Math.hypot(p.x - (s.x + Math.cos(a) * s.r), p.y - (s.y + Math.sin(a) * s.r)) < tol) { snapshot(); s.runes.splice(i, 1); commit(); return; }
  }
  for (let i = layer.seals.length - 1; i >= 0; i--) {
    const s = layer.seals[i];
    const d = Math.hypot(p.x - s.x, p.y - s.y);
    if (Math.abs(d - s.r) < tol || d < Math.min(s.r, 22)) { snapshot(); layer.seals.splice(i, 1); commit(); return; }
  }
  for (let i = layer.glyphs.length - 1; i >= 0; i--) {
    const g = layer.glyphs[i];
    for (let k = 0; k < g.nodes.length; k++) {
      const a = nodePos(g.nodes[k]), b = nodePos(g.nodes[(k + 1) % g.nodes.length]);
      if (segDist(p, a, b) < tol) { snapshot(); layer.glyphs.splice(i, 1); commit(); return; }
    }
  }
}
function segDist(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y;
  const t = clamp(((p.x - a.x) * vx + (p.y - a.y) * vy) / (vx * vx + vy * vy || 1), 0, 1);
  return Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t));
}

/* ---------------------------------------------------------------
   Pointer handling
   --------------------------------------------------------------- */
function down(e) {
  const c = cv();
  try { c.setPointerCapture(e.pointerId); } catch (err) {}
  F.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (F.pointers.size === 2) {
    // a second finger turns any stroke in progress into a pinch
    F.path = null; F.seal = null; F.moveSeal = null; F.tapPath = false;
    const [a, b] = [...F.pointers.values()];
    F.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: F.zoom, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, px: F.panX, py: F.panY };
    draw(); return;
  }
  if (F.pointers.size > 2) return;
  if (e.button === 1 || e.button === 2) { F.panDrag = { x: e.clientX, y: e.clientY, px: F.panX, py: F.panY }; return; }
  const p = toDesign(e);
  F.cursor = p; F.downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
  const tol = 30 / Math.max(0.7, F.zoom);
  if (F.tool === "glyph") {
    const n = nearestNode(p, tol);
    if (F.tapPath && F.path) {
      if (n < 0) { F.path = null; F.tapPath = false; hint(); draw(); return; }
      if (n === F.path[0] && F.path.length >= 3) { const nodes = F.path; F.path = null; F.tapPath = false; addGlyph(nodes); hint(); return; }
      if (!F.path.includes(n)) F.path.push(n);
      F.tapNode = n;
      draw(); return;
    }
    if (n >= 0) { F.path = [n]; F.tapPath = false; }
  } else if (F.tool === "seal") {
    const hit = L().seals.find((s) => Math.hypot(p.x - s.x, p.y - s.y) < Math.max(14, Math.min(24, s.r * 0.4)));
    if (hit) { snapshot(); F.moveSeal = { s: hit, ox: hit.x - p.x, oy: hit.y - p.y, moved: false }; return; }
    let x = p.x, y = p.y;
    if (Math.hypot(x, y) < 16) { x = 0; y = 0; } else if (Math.abs(x) < 10) x = 0;
    if (Math.hypot(x, y) > PAGE_R) { say("Too far off the page"); return; }
    F.seal = { x, y, r: 0 };
  }
  draw();
}
function move(e) {
  if (F.pointers.has(e.pointerId)) F.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (F.pinch && F.pointers.size >= 2) {
    const [a, b] = [...F.pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    zoomTo(clamp(F.pinch.zoom * d / Math.max(1, F.pinch.d), 0.6, 3.5), mx, my);
    F.panX += mx - F.pinch.mx; F.panY += my - F.pinch.my;
    F.pinch.mx = mx; F.pinch.my = my;
    draw(); return;
  }
  if (F.panDrag) { F.panX = F.panDrag.px + e.clientX - F.panDrag.x; F.panY = F.panDrag.py + e.clientY - F.panDrag.y; draw(); return; }
  const p = toDesign(e);
  F.cursor = p;
  if (F.path && !F.tapPath && F.pointers.size) {
    // While dragging, a dot is only picked up when the pointer really passes
    // over it. A 60-degree edge (0 to 2) runs 21 units from the dot it skips,
    // so anything wider than that turned every pentagon into a dodecagon.
    const n = nearestNode(p, Math.min(15, 26 / Math.max(0.7, F.zoom)));
    const last = F.path[F.path.length - 1];
    if (n >= 0 && n !== last) {
      if (n === F.path[0] && F.path.length >= 3) { const nodes = F.path; F.path = null; addGlyph(nodes); hint(); return; }
      if (!F.path.includes(n)) F.path.push(n);
    }
    const sides = F.path.length;
    const el = elementForSides(sides);
    F.label = sides >= 3 ? sides + " sides · " + (el ? ELEMENTS[el].name : "too many") : "";
  } else if (F.seal) {
    F.seal.r = clamp(Math.hypot(p.x - F.seal.x, p.y - F.seal.y), 0, SEAL_MAX_R);
    const f = formForRadius(F.seal.r);
    F.label = F.seal.r >= SEAL_MIN_R ? FORMS[f].name + (f === "nova" ? " · " + novaRadius(F.seal.r).toFixed(1) + " m" : "") : "";
  } else if (F.moveSeal) {
    let x = p.x + F.moveSeal.ox, y = p.y + F.moveSeal.oy;
    if (Math.hypot(x, y) < 14) { x = 0; y = 0; } else if (Math.abs(x) < 8) x = 0;
    if (Math.hypot(x, y) <= PAGE_R) { F.moveSeal.s.x = x; F.moveSeal.s.y = y; F.moveSeal.moved = true; }
  } else F.label = "";
  draw();
}
function up(e) {
  F.pointers.delete(e.pointerId);
  if (F.pinch) { if (F.pointers.size < 2) F.pinch = null; return; }
  if (F.panDrag) { F.panDrag = null; return; }
  const p = toDesign(e);
  const tapped = F.downAt && Math.hypot(e.clientX - F.downAt.x, e.clientY - F.downAt.y) < 8;
  if (F.tool === "glyph" && F.path && !F.tapPath) {
    if (F.path.length === 1 && tapped) { F.tapPath = true; hint(); draw(); return; }   // start tap-to-connect
    if (F.path.length >= 3) { const nodes = F.path; F.path = null; addGlyph(nodes); }
    else F.path = null;
  } else if (F.tool === "seal" && F.seal) {
    const s = F.seal; F.seal = null;
    if (s.r >= SEAL_MIN_R) addSeal(s.x, s.y, s.r);
    else if (tapped) say("Drag outward to size the seal");
  } else if (F.moveSeal) {
    if (!F.moveSeal.moved) F.undo.pop(); else commit();
    F.moveSeal = null;
  } else if (F.tool === "rune" && tapped) {
    const tol = 22 / Math.max(0.7, F.zoom);
    let best = null, bd = tol;
    for (const s of L().seals) { const d = Math.abs(Math.hypot(p.x - s.x, p.y - s.y) - s.r); if (d < bd) { bd = d; best = s; } }
    if (best) toggleRune(best, Math.atan2(p.y - best.y, p.x - best.x));
    else say("Tap on the rim of a seal");
  } else if (F.tool === "erase" && tapped) eraseAt(p);
  F.label = "";
  draw();
}
function zoomTo(z, px, py) {
  const r = cv().getBoundingClientRect();
  const dx = (px - r.left - F.cx - F.panX) / zs(), dy = (py - r.top - F.cy - F.panY) / zs();
  F.zoom = z;
  F.panX = px - r.left - F.cx - dx * zs();
  F.panY = py - r.top - F.cy - dy * zs();
}

/* ---------------------------------------------------------------
   Drawing the page
   --------------------------------------------------------------- */
function draw() {
  if (!F.open) return;
  const c = cv(), g = c.getContext("2d");
  const dpr = c.width / (c.clientWidth || 1);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, c.clientWidth, c.clientHeight);
  const s = zs(), ox = F.cx + F.panX, oy = F.cy + F.panY;
  // the page: a soft disc and the forward axis
  const grd = g.createRadialGradient(ox, oy, 0, ox, oy, (RING_R + 90) * s);
  grd.addColorStop(0, "rgba(201,164,92,0.10)"); grd.addColorStop(1, "rgba(201,164,92,0)");
  g.fillStyle = grd; g.beginPath(); g.arc(ox, oy, (RING_R + 90) * s, 0, TAU); g.fill();
  g.strokeStyle = "rgba(255,255,255,0.07)"; g.lineWidth = 1;
  g.beginPath(); g.moveTo(ox - PAGE_R * s, oy); g.lineTo(ox + PAGE_R * s, oy); g.stroke();
  g.setLineDash(F.mirror ? [6, 6] : []);
  g.strokeStyle = F.mirror ? "rgba(179,157,255,0.35)" : "rgba(255,255,255,0.07)";
  g.beginPath(); g.moveTo(ox, oy - PAGE_R * s); g.lineTo(ox, oy + PAGE_R * s); g.stroke();
  g.setLineDash([]);
  // "forward" marker at the top of the page
  g.fillStyle = "rgba(201,164,92,0.8)";
  g.beginPath(); g.moveTo(ox, oy - (RING_R + 44) * s); g.lineTo(ox - 7, oy - (RING_R + 30) * s); g.lineTo(ox + 7, oy - (RING_R + 30) * s); g.closePath(); g.fill();
  // form guides while sizing a seal
  if (F.seal) {
    g.setLineDash([2, 5]); g.lineWidth = 1;
    for (const id of ["needle", "bolt", "orb"]) {
      g.strokeStyle = "rgba(179,157,255,0.25)";
      g.beginPath(); g.arc(ox + F.seal.x * s, oy + F.seal.y * s, FORMS[id].maxR * s, 0, TAU); g.stroke();
    }
    g.setLineDash([]);
  }
  drawDesign(g, design(), { cx: ox, cy: oy, scale: s, active: F.layer, nodes: true, glow: true, line: 2.2 });
  // seal centre handles in seal mode
  if (F.tool === "seal") {
    g.fillStyle = SEAL_COLOR;
    for (const sl of L().seals) { g.beginPath(); g.arc(ox + sl.x * s, oy + sl.y * s, 5, 0, TAU); g.fill(); }
  }
  // stroke in progress
  if (F.path) {
    g.strokeStyle = "#ffe9b0"; g.lineWidth = 2.5; g.setLineDash([7, 5]);
    g.beginPath();
    F.path.forEach((n, k) => { const q = nodePos(n); k ? g.lineTo(ox + q.x * s, oy + q.y * s) : g.moveTo(ox + q.x * s, oy + q.y * s); });
    if (F.cursor && !F.tapPath) g.lineTo(ox + F.cursor.x * s, oy + F.cursor.y * s);
    g.stroke(); g.setLineDash([]);
    g.fillStyle = "#ffd97a";
    F.path.forEach((n, k) => { const q = nodePos(n); g.beginPath(); g.arc(ox + q.x * s, oy + q.y * s, k ? 7 : 10, 0, TAU); g.fill(); });
  }
  if (F.seal && F.seal.r > 2) {
    const col = F.seal.r >= SEAL_MIN_R ? SEAL_COLOR : "#8fa0ab";
    g.strokeStyle = col; g.lineWidth = 2; g.setLineDash([6, 5]);
    g.beginPath(); g.arc(ox + F.seal.x * s, oy + F.seal.y * s, F.seal.r * s, 0, TAU); g.stroke();
    if (F.mirror && Math.abs(F.seal.x) > 12) { g.globalAlpha = 0.4; g.beginPath(); g.arc(ox - F.seal.x * s, oy + F.seal.y * s, F.seal.r * s, 0, TAU); g.stroke(); g.globalAlpha = 1; }
    g.setLineDash([]);
  }
  // live label by the cursor
  if (F.label && F.cursor) {
    const lx = ox + F.cursor.x * s, ly = oy + F.cursor.y * s - 26;
    g.font = "600 13px system-ui, sans-serif";
    const w = g.measureText(F.label).width + 16;
    g.fillStyle = "rgba(10,14,22,0.85)"; roundRect(g, lx - w / 2, ly - 13, w, 24, 12); g.fill();
    g.fillStyle = "#f2e8d5"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(F.label, lx, ly);
  }
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

/* ---------------------------------------------------------------
   The side panel: slots, layers, power, readout
   --------------------------------------------------------------- */
function renderSlots() {
  const box = $("bookSlots");
  box.innerHTML = "";
  for (let i = 0; i < SLOTS; i++) {
    const b = document.createElement("button");
    b.className = "bslot" + (i === F.slot ? " on" : "");
    b.setAttribute("aria-label", "Page " + (i + 1));
    b.appendChild(thumbnail(save.spell(i), 38));
    const n = document.createElement("span"); n.textContent = i + 1; b.appendChild(n);
    b.onclick = () => { F.slot = i; F.layer = 0; F.undo = []; F.path = null; F.tapPath = false; emit("ui"); renderAll(); };
    box.appendChild(b);
  }
}
function renderPanel() {
  const d = design();
  const c = compileSpell(d, mods());
  const over = overLimits(d, rank(), c);
  // name
  const nameIn = $("spellName");
  if (document.activeElement !== nameIn) nameIn.value = d.name || "";
  nameIn.placeholder = c.autoName;
  // layers
  const lt = $("layerTabs");
  lt.innerHTML = "";
  d.layers.forEach((_, i) => {
    const b = document.createElement("button");
    b.className = "chipbtn" + (i === F.layer ? " on" : "");
    b.textContent = i + 1;
    b.setAttribute("aria-label", "Layer " + (i + 1));
    b.onclick = () => { F.layer = i; F.path = null; renderAll(); };
    lt.appendChild(b);
  });
  if (d.layers.length < lim().layers) {
    const add = document.createElement("button");
    add.className = "chipbtn"; add.innerHTML = icon("plus"); add.setAttribute("aria-label", "Add a layer");
    add.onclick = () => { snapshot(); d.layers.push(emptyLayer()); F.layer = d.layers.length - 1; commit(); renderAll(); };
    lt.appendChild(add);
  }
  if (d.layers.length > 1) {
    const rm = document.createElement("button");
    rm.className = "chipbtn"; rm.innerHTML = icon("minus"); rm.setAttribute("aria-label", "Remove this layer");
    rm.onclick = () => { snapshot(); d.layers.splice(F.layer, 1); F.layer = Math.max(0, F.layer - 1); commit(); renderAll(); };
    lt.appendChild(rm);
  }
  $("layerNote").textContent = d.layers.length > 1 ? (F.layer ? "Bursts out of layer " + F.layer + "'s shots" : "Fires from your staff") : lim().layers > 1 ? "Add a layer to chain a second burst" : "One layer at rank " + rank();
  // power
  const pw = $("power");
  pw.max = lim().power;
  pw.value = L().power;
  pw.disabled = lim().power <= 1;
  $("powerN").textContent = L().power;
  // readout
  const L0 = c.layers[0];
  const els = new Set(); c.layers.forEach((x) => x.elements.forEach((e) => els.add(e)));
  const elHtml = els.size ? [...els].map((e) => '<span class="el" style="color:' + ELEMENTS[e].color + '">' + icon(e) + "</span>").join("") : '<span class="el" style="color:' + elementInfo("arcane").color + '">' + icon("arcane") + "</span>";
  const maxMana = S.player ? S.player.maxMana : 100;
  $("readout").innerHTML =
    '<div class="rname">' + elHtml + "<b>" + escHtml(c.name) + "</b></div>" +
    '<div class="stats">' +
    '<span title="Mana per cast"' + (c.cost > maxMana ? ' class="bad"' : "") + ">" + icon("drop") + c.cost + "</span>" +
    '<span title="Cooldown">' + icon("clock") + c.cooldown.toFixed(2) + "s</span>" +
    '<span title="Damage one cast can deal">' + icon("spark") + (L0 ? Math.round(c.potential) : 0) + "</span>" +
    '<span title="Shots per cast">' + icon("needle") + c.totalShots + "</span>" +
    '<button class="info" data-info="price" aria-label="About cost and cooldown">' + icon("info") + "</button>" +
    "</div>" +
    '<div class="bal"><span>Balance</span><i><b style="width:' + Math.round(c.balance * 100) + '%"></b></i><em>' + Math.round(c.balance * 100) + '%</em><button class="info" data-info="balance" aria-label="About balance">' + icon("info") + "</button></div>" +
    (c.reactions.length ? '<div class="reacts">' + c.reactions.map((r) => '<span style="color:' + REACTIONS[r].color + '">' + icon(r) + REACTIONS[r].name + "</span>").join("") + '<button class="info" data-info="reactions" aria-label="About reactions">' + icon("info") + "</button></div>" : "");
  const warn = [];
  if (over.length) warn.push("Locked until rank " + rankNeeded(d, c) + ": " + over[0]);
  if (c.cost > maxMana) warn.push("Costs " + c.cost + " — more than your " + Math.round(maxMana) + " mana");
  $("bookWarn").textContent = warn.join(" · ");
  $("bookWarn").hidden = !warn.length;
  $("rankLine").innerHTML = "Rank " + rank() + ": " + lim().glyphs + " glyphs, " + lim().seals + " seals, " + lim().runes + " runes, " + lim().layers + (lim().layers > 1 ? " layers" : " layer") +
    ' <button class="info" data-info="rank" aria-label="About circle rank">' + icon("info") + "</button>";
  $("toolMirror").classList.toggle("on", F.mirror);
  document.querySelectorAll("#bookTools [data-tool]").forEach((b) => b.classList.toggle("on", b.dataset.tool === F.tool));
  $("toolUndo").disabled = !F.undo.length;
  renderSlots();
  preview.reset(c);
}
function renderAll() { renderPanel(); draw(); hint(); }

/* ---------------------------------------------------------------
   Preview: the page, fired at three dummies, over and over
   --------------------------------------------------------------- */
const preview = (() => {
  let spell = null, shots = [], rings = [], nextCast = 0.3, raf = 0, last = 0;
  const dummies = [{ x: -3, y: -11 }, { x: 0, y: -15 }, { x: 3.5, y: -9 }];
  function reset(c) { spell = c; shots = []; rings = []; nextCast = 0.3; }
  function fireLayer(li, x, y, heading) {
    const Ly = spell.layers[li];
    if (!Ly) return;
    const fx = Math.cos(heading), fy = Math.sin(heading), rx = -fy, ry = fx;
    const col = Ly.elements[0] ? ELEMENTS[Ly.elements[0]].color : elementInfo("arcane").color;
    for (const s of Ly.shots) {
      const ox = x + rx * s.ox + fx * s.oz, oy = y + ry * s.ox + fy * s.oz;
      if (s.form === "nova") { rings.push({ x: ox, y: oy, r: 0.3, max: s.novaR, t: 0, col, li, heading }); continue; }
      for (const d of s.dirs) {
        const a = heading + d + (li === 0 ? (Math.random() - 0.5) * spell.spread : 0);
        shots.push({ x: ox + (li ? 0 : fx * 0.7), y: oy + (li ? 0 : fy * 0.7), vx: Math.cos(a) * s.speed, vy: Math.sin(a) * s.speed, s, li, trav: 0, col, trail: [] });
      }
    }
  }
  function end(p) {
    if (p.s.splash) rings.push({ x: p.x, y: p.y, r: 0.2, max: p.s.splash, t: 0, col: p.col, splash: true });
    const Ly = spell.layers[p.li];
    for (const r of Ly.reactions) rings.push({ x: p.x, y: p.y, r: 0.2, max: r === "mire" ? 2.5 : 2, t: 0, col: REACTIONS[r].color, zone: true, life: 1.2 });
    if (p.li + 1 < spell.layers.length) fireLayer(p.li + 1, p.x, p.y, Math.atan2(p.vy, p.vx));
  }
  function step(dt) {
    if (!spell || !spell.layers.length) return;
    nextCast -= dt;
    if (nextCast <= 0) { fireLayer(0, 0, 0, -Math.PI / 2); nextCast = Math.max(0.9, spell.cooldown + 0.8); }
    for (let i = shots.length - 1; i >= 0; i--) {
      const p = shots[i];
      p.x += p.vx * dt; p.y += p.vy * dt; p.trav += p.s.speed * dt;
      p.trail.push([p.x, p.y]); if (p.trail.length > 6) p.trail.shift();
      let hit = false;
      for (const d of dummies) if (Math.hypot(p.x - d.x, p.y - d.y) < 0.6 + p.s.radius) { d.flash = 0.15; hit = true; }
      if (p.trav >= p.s.range || (hit && p.s.pierce <= 0)) { end(p); shots.splice(i, 1); }
    }
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      r.t += dt;
      const dur = r.zone ? r.life : 0.3;
      r.r = r.zone ? r.max : r.max * Math.min(1, r.t / 0.3);
      for (const d of dummies) if (Math.hypot(r.x - d.x, r.y - d.y) < r.r + 0.6) d.flash = 0.15;
      if (r.t >= dur) {
        if (!r.splash && !r.zone && r.li + 1 < spell.layers.length) fireLayer(r.li + 1, r.x, r.y, r.heading);
        rings.splice(i, 1);
      }
    }
    for (const d of dummies) d.flash = Math.max(0, (d.flash || 0) - dt);
  }
  function render() {
    const c = $("preview");
    if (!c || !c.clientWidth) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = c.clientWidth, h = c.clientHeight;
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = "#0c1119"; g.fillRect(0, 0, w, h);
    const sc = h / 20, ox = w / 2, oy = h - 12;
    g.strokeStyle = "rgba(255,255,255,0.05)";
    for (let m = 5; m <= 20; m += 5) { g.beginPath(); g.moveTo(0, oy - m * sc); g.lineTo(w, oy - m * sc); g.stroke(); }
    for (const d of dummies) {
      g.fillStyle = d.flash > 0 ? "#fff" : "#c9a86a";
      g.beginPath(); g.arc(ox + d.x * sc, oy + d.y * sc, 0.6 * sc, 0, TAU); g.fill();
    }
    g.globalCompositeOperation = "lighter";
    for (const r of rings) {
      g.strokeStyle = r.col; g.fillStyle = r.col;
      if (r.zone) { g.globalAlpha = 0.25 * (1 - r.t / r.life); g.beginPath(); g.arc(ox + r.x * sc, oy + r.y * sc, r.r * sc, 0, TAU); g.fill(); }
      else { g.globalAlpha = 1 - r.t / 0.3 * 0.6; g.lineWidth = 2; g.beginPath(); g.arc(ox + r.x * sc, oy + r.y * sc, r.r * sc, 0, TAU); g.stroke(); }
    }
    g.globalAlpha = 1;
    for (const p of shots) {
      g.strokeStyle = p.col; g.lineWidth = Math.max(1.5, p.s.radius * sc * 1.4); g.globalAlpha = 0.5;
      g.beginPath(); p.trail.forEach(([x, y], k) => (k ? g.lineTo(ox + x * sc, oy + y * sc) : g.moveTo(ox + x * sc, oy + y * sc))); g.stroke();
      g.globalAlpha = 1; g.fillStyle = p.col;
      g.beginPath(); g.arc(ox + p.x * sc, oy + p.y * sc, Math.max(2, p.s.radius * sc * 1.2), 0, TAU); g.fill();
    }
    g.globalCompositeOperation = "source-over";
    // the caster
    g.fillStyle = "#b39dff";
    g.beginPath(); g.moveTo(ox, oy - 9); g.lineTo(ox - 6, oy + 4); g.lineTo(ox + 6, oy + 4); g.closePath(); g.fill();
  }
  function loop(now) {
    if (!F.open) { raf = 0; return; }
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now;
    step(dt); render();
    raf = requestAnimationFrame(loop);
  }
  return { reset, start() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(loop); } } };
})();

/* ---------------------------------------------------------------
   Presets
   --------------------------------------------------------------- */
function openPresets() {
  const box = $("presetList");
  box.innerHTML = "";
  PRESETS.forEach((p) => {
    const need = rankNeeded(p);
    const b = document.createElement("button");
    b.className = "preset";
    b.appendChild(thumbnail(p, 44));
    const t = document.createElement("span");
    t.innerHTML = "<b>" + escHtml(p.name) + "</b><small>" + (need > rank() ? "Needs rank " + need : compileSpell(p).autoName) + "</small>";
    b.appendChild(t);
    b.onclick = () => {
      snapshot();
      const d = cloneDesign(p);
      save.setSpell(F.slot, d);
      F.layer = 0;
      $("presets").hidden = true;
      commit(); renderAll();
    };
    box.appendChild(b);
  });
  $("presets").hidden = false;
}

/* ---------------------------------------------------------------
   Open / close
   --------------------------------------------------------------- */
export function openBook(slot) {
  if (F.open) return;
  F.open = true;
  if (slot !== undefined) F.slot = slot;
  else if (S.player) F.slot = S.player.selected;
  F.layer = 0; F.undo = []; F.path = null; F.tapPath = false; F.zoom = 1; F.panX = F.panY = 0;
  $("book").hidden = false;
  requestAnimationFrame(() => { fit(); renderAll(); preview.start(); });
  emit("bookOpened");
}
export function closeBook() {
  if (!F.open) return;
  F.open = false;
  $("book").hidden = true;
  $("presets").hidden = true;
  save.flush();
  if (S.player) S.player.recompile();
  emit("bookClosed");
}
export function isOpen() { return F.open; }

export function init() {
  const c = cv();
  c.addEventListener("pointerdown", down);
  c.addEventListener("pointermove", move);
  c.addEventListener("pointerup", up);
  c.addEventListener("pointercancel", (e) => { F.pointers.delete(e.pointerId); F.pinch = null; F.path = F.tapPath ? F.path : null; F.seal = null; draw(); });
  c.addEventListener("contextmenu", (e) => e.preventDefault());
  c.addEventListener("wheel", (e) => { e.preventDefault(); zoomTo(clamp(F.zoom * Math.pow(1.0015, -e.deltaY), 0.6, 3.5), e.clientX, e.clientY); draw(); }, { passive: false });
  c.addEventListener("dblclick", () => { F.zoom = 1; F.panX = F.panY = 0; draw(); });
  document.querySelectorAll("#bookTools [data-tool]").forEach((b) => b.addEventListener("click", () => { F.tool = b.dataset.tool; F.path = null; F.tapPath = false; emit("ui"); renderPanel(); hint(); draw(); }));
  document.querySelectorAll("#stamps [data-el]").forEach((b) => b.addEventListener("click", () => { F.tool = "glyph"; stamp(b.dataset.el); renderPanel(); hint(); }));
  $("toolMirror").addEventListener("click", () => { F.mirror = !F.mirror; emit("ui"); renderPanel(); draw(); });
  $("toolUndo").addEventListener("click", undo);
  $("toolClear").addEventListener("click", () => { const l = L(); if (!l.glyphs.length && !l.seals.length) return; snapshot(); l.glyphs = []; l.seals = []; commit(); renderAll(); });
  $("toolView").addEventListener("click", () => { F.zoom = 1; F.panX = F.panY = 0; draw(); });
  $("power").addEventListener("input", (e) => { const v = clamp(+e.target.value | 0, 1, lim().power); if (v !== L().power) { snapshot(); L().power = v; commit(); } });
  $("spellName").addEventListener("input", (e) => { design().name = e.target.value.slice(0, MAX_NAME); save.setSpell(F.slot, design()); if (S.player) S.player.recompile(); renderPanel(); });
  $("spellName").addEventListener("keydown", (e) => { if (e.key === "Enter") e.target.blur(); });
  $("bookClose").addEventListener("click", () => { if (F.onClose) F.onClose(); else closeBook(); });
  $("bookPresets").addEventListener("click", openPresets);
  $("presetsClose").addEventListener("click", () => { $("presets").hidden = true; });
  addEventListener("keydown", (e) => {
    if (!F.open) return;
    if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ") { e.preventDefault(); undo(); }
    if (e.target && e.target.tagName === "INPUT") return;
    const map = { KeyG: "glyph", KeyS: "seal", KeyR: "rune", KeyX: "erase" };
    if (map[e.code]) { F.tool = map[e.code]; renderPanel(); hint(); draw(); }
    if (e.code === "KeyM") { F.mirror = !F.mirror; renderPanel(); draw(); }
  });
  addEventListener("resize", () => { if (F.open) { fit(); draw(); } });
  hydrateIcons($("book"));
}
function undo() {
  const prev = F.undo.pop();
  if (!prev) return;
  save.setSpell(F.slot, JSON.parse(prev));
  F.layer = Math.min(F.layer, design().layers.length - 1);
  if (S.player) S.player.recompile();
  renderAll();
}
export function setCloseHandler(fn) { F.onClose = fn; }
