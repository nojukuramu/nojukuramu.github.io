/* sprites.js — every unit, building and node, drawn with paths, for every era.
 *
 * There are no image files. A soldier is a few shapes chosen by its line and
 * its era — a club and a hide, a gladius and a red tunic, a rifle and a
 * helmet, a blade of light — and the same goes for every building, whose
 * level is the era it is drawn in. Each drawing is made once at twice world
 * size and cached; the renderer only ever blits.
 *
 * Two ways of facing. People, beasts and early siege are drawn side-on and
 * mirrored to face left. Anything seen from above — boats, vehicles from the
 * Age of Steam or Engines, aircraft — is drawn pointing right and rotated.
 *
 * The enemy wears your eras too, in your shapes, with ashen skin and a faint
 * light where the eyes are. Nothing explains that. */

import { mk } from "./terrain.js";
import { ERAS } from "./data.js";

export const SS = 2;   // cache scale
export const TEAM = [
  { main: "#3b78d8", dark: "#1f4686", light: "#9cc4ff" },
  { main: "#c3363c", dark: "#6a161d", light: "#ff8f8a" },
  { main: "#9a9a9a", dark: "#555", light: "#ddd" }
];
const OUT = [
  { body: "#7a5634", trim: "#5a3d22", helm: "", hair: "#3a2614" },
  { body: "#b9a27a", trim: "#b07a3a", helm: "cap", hc: "#b8863b" },
  { body: "#8a2f2a", trim: "#9a9da3", helm: "crest", hc: "#a8acb2" },
  { body: "#9ba3ad", trim: "#7a828c", helm: "great", hc: "#c4c9cf" },
  { body: "#2f3c66", trim: "#d8c890", helm: "tricorn", hc: "#202020" },
  { body: "#7b6a45", trim: "#4f4430", helm: "brodie", hc: "#5c5a40" },
  { body: "#55663e", trim: "#3a4628", helm: "combat", hc: "#46532f" },
  { body: "#dfe4ea", trim: "#9aa6b4", helm: "visor", hc: "#e9edf2", glow: "#62e8ff" },
  { body: "#2a2f45", trim: "#4d5680", helm: "dome", hc: "#3a4060", glow: "#8da7ff" },
  { body: "#efe6ff", trim: "#b9a0f0", helm: "halo", hc: "#f5efff", glow: "#d38bff" }
];
const SKIN = ["#e0b48c", "#c99772", "#a87452", "#8a5a3c"];
const HOLLOW_SKIN = "#a9b0bc";

const cache = new Map();
export function clearCache() { cache.clear(); }
function cached(key, w, h, ox, oy, draw) {
  let s = cache.get(key);
  if (s) return s;
  const c = mk(Math.ceil(w * SS), Math.ceil(h * SS)), x = c.getContext("2d");
  x.scale(SS, SS); x.translate(ox, oy);
  x.lineCap = "round"; x.lineJoin = "round";
  draw(x);
  s = { c, w, h, ox, oy };
  cache.set(key, s);
  return s;
}
/** Blit a cached sprite at world (x, y), optionally mirrored or rotated. */
export function blit(ctx, s, x, y, flip, rot, scale) {
  const k = (scale || 1);
  if (!flip && !rot && k === 1) { ctx.drawImage(s.c, x - s.ox, y - s.oy, s.w, s.h); return; }
  ctx.save(); ctx.translate(x, y);
  if (rot) ctx.rotate(rot);
  if (flip) ctx.scale(-1, 1);
  if (k !== 1) ctx.scale(k, k);
  ctx.drawImage(s.c, -s.ox, -s.oy, s.w, s.h);
  ctx.restore();
}

/* ---------------- small helpers ---------------- */
function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
function fillRR(c, x, y, w, h, r, col) { rr(c, x, y, w, h, r); c.fillStyle = col; c.fill(); }
function circle(c, x, y, r, col) { c.beginPath(); c.arc(x, y, r, 0, 6.2832); c.fillStyle = col; c.fill(); }
function line(c, x0, y0, x1, y1, col, w) { c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.strokeStyle = col; c.lineWidth = w; c.stroke(); }
function glow(c, x, y, r, col, a) {
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, hexA(col, a === undefined ? 0.9 : a)); g.addColorStop(1, hexA(col, 0));
  c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, 6.2832); c.fill();
}
export function hexA(h, a) {
  const n = parseInt(h.slice(1), 16);
  return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
}
export function mix(h1, h2, k) {
  const a = parseInt(h1.slice(1), 16), b = parseInt(h2.slice(1), 16);
  const r = Math.round(((a >> 16) & 255) * (1 - k) + ((b >> 16) & 255) * k), g = Math.round(((a >> 8) & 255) * (1 - k) + ((b >> 8) & 255) * k), bl = Math.round((a & 255) * (1 - k) + (b & 255) * k);
  return "#" + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
}
const shade = (h, k) => mix(h, k > 0 ? "#ffffff" : "#000000", Math.abs(k));
const energy = (e) => ERAS[Math.max(0, Math.min(9, e))].energy;

/* =========================================================================
   People
   ========================================================================= */
/** Which of a line's looks is side-on (mirrored) and which is from above (rotated)? */
export function rotates(line, tier) {
  if (line === "naval" || line === "air") return true;
  if (line === "mounted") return tier >= 5;
  if (line === "siege") return tier >= 6;
  return false;
}

export function unitSprite(u, frame) {
  const tier = u.tier;
  const key = "u|" + (u.hero || u.line) + "|" + tier + "|" + u.team + "|" + frame + "|" + (u.turret ? 1 : 0);
  if (u.hero) return cached(key, 48, 52, 24, 34, (c) => person(c, { era: tier, team: u.team, line: "hero", hero: u.hero, frame }));
  if (u.turret) return cached(key, 40, 40, 20, 24, (c) => turret(c, tier, u.team, frame));
  switch (u.line) {
    case "beast": return cached(key, 60, 50, 30, 34, (c) => beast(c, tier, frame));
    case "mounted": return tier >= 5 ? cached(key, 64, 52, 32, 26, (c) => vehicle(c, tier, u.team, frame)) : cached(key, 56, 52, 28, 36, (c) => rider(c, tier, u.team, frame));
    case "siege": return tier >= 6 ? cached(key, 64, 56, 32, 28, (c) => siegeTop(c, tier, u.team, frame)) : cached(key, 64, 56, 32, 36, (c) => siegeSide(c, tier, u.team, frame));
    case "naval": return cached(key, 84, 52, 42, 26, (c) => ship(c, tier, u.team, frame));
    case "air": return cached(key, 72, 64, 36, 32, (c) => aircraft(c, tier, u.team, frame));
  }
  return cached(key, 44, 46, 22, 32, (c) => person(c, { era: tier, team: u.team, line: u.line, frame }));
}

/** frame: 0..3 walking, 4 striking, 5 working, 6 standing */
function person(c, o) {
  const e = o.era, O = OUT[e], T = TEAM[o.team], hollow = o.team === 1;
  const skin = hollow ? HOLLOW_SKIN : SKIN[(e * 7 + (o.hero ? 3 : 0)) % 4];
  const walk = o.frame < 4 ? o.frame : -1, strike = o.frame === 4 || o.frame === 5;
  const sw = walk >= 0 ? [-1, 0, 1, 0][walk] : 0;
  const bob = walk === 1 || walk === 3 ? -0.8 : 0;
  const hero = o.line === "hero";
  const k = hero ? 1.36 : 1.16;
  c.save(); c.scale(k, k); c.translate(0, bob);
  let body = hollow ? mix(O.body, "#3a3440", 0.35) : O.body;
  if (hero) body = heroBody(o.hero, e, o.team);
  // cape
  if (hero) { c.fillStyle = hollow ? "#41202a" : T.dark; c.beginPath(); c.moveTo(-4, -10); c.quadraticCurveTo(-9 - sw, -2, -7 - sw * 2, 5); c.lineTo(-1, 3); c.closePath(); c.fill(); }
  // legs
  const leg = e >= 7 ? shade(body, -0.25) : e >= 4 ? "#2b2b30" : shade(body, -0.35);
  c.lineWidth = 2.8; c.strokeStyle = leg;
  c.beginPath(); c.moveTo(-1.5, -1); c.lineTo(-1.5 + sw * 3, 7); c.moveTo(1.8, -1); c.lineTo(1.8 - sw * 3, 7); c.stroke();
  c.fillStyle = "#2a1f18"; c.fillRect(-3 + sw * 3, 6.2, 3.2, 1.8); c.fillRect(0.4 - sw * 3, 6.2, 3.2, 1.8);
  // the robe of a sage or a mender hides the legs
  if ((hero && o.hero === "sage") || (o.line === "mender" && e < 7) || e === 9) { c.fillStyle = shade(body, -0.1); c.beginPath(); c.moveTo(-5, -4); c.lineTo(-6.5, 7.5); c.lineTo(6.5, 7.5); c.lineTo(5, -4); c.fill(); }
  // back arm
  c.strokeStyle = shade(body, -0.25); c.lineWidth = 2.6;
  c.beginPath(); c.moveTo(-3, -8); c.lineTo(-4.5 - sw * 1.5, -2); c.stroke();
  // torso
  fillRR(c, -4.6, -11, 9.2, 11, 3, body);
  if (e >= 7 && O.glow) { c.strokeStyle = hexA(O.glow, 0.9); c.lineWidth = 0.9; c.beginPath(); c.moveTo(-3, -8); c.lineTo(3, -8); c.moveTo(0, -10); c.lineTo(0, -2); c.stroke(); }
  // the team's colour, as a sash or a tabard
  c.fillStyle = T.main;
  if (e === 3) { c.fillRect(-2.6, -10.5, 5.2, 10); c.fillStyle = T.light; c.fillRect(-1, -9, 2, 3); }
  else { c.beginPath(); c.moveTo(-4.6, -10); c.lineTo(-2.4, -10.5); c.lineTo(4.6, -2.5); c.lineTo(4.6, -0.3); c.closePath(); c.fill(); }
  if (e === 0) { c.fillStyle = shade(body, 0.2); c.beginPath(); c.moveTo(-4.6, -11); c.lineTo(4.6, -11); c.lineTo(3, -7); c.lineTo(-3, -7); c.fill(); }
  // head
  circle(c, 0.5, -14.2, 3.9, skin);
  if (hollow) { circle(c, 2.6, -14.6, 0.75, "#d9c8ff"); glow(c, 2.6, -14.6, 2.2, "#b48cff", 0.5); }
  else circle(c, 2.6, -14.6, 0.6, "#1a1410");
  helmet(c, hero ? heroHelm(o.hero) : O.helm, hero ? heroHelmColor(o.hero, e, o.team) : O.hc || O.hair, e, T);
  // front arm and what it holds
  const ang = strike ? (o.frame === 5 ? -1.2 : -0.9) : sw * 0.25;
  c.save(); c.translate(3, -8); c.rotate(ang);
  c.strokeStyle = body === "#efe6ff" ? "#d8ccf0" : shade(body, 0.08); c.lineWidth = 2.6;
  c.beginPath(); c.moveTo(0, 0); c.lineTo(2.5, 5); c.stroke();
  c.translate(2.5, 5);
  held(c, hero ? "hero:" + o.hero : o.line, e, T, strike, hollow);
  c.restore();
  // shields go in front
  if (!hero && o.line === "melee" && (e === 2 || e === 3)) shield(c, e, T);
  if (hero && o.hero === "warden") shield(c, Math.max(3, e), T, true);
  if (hero && o.hero === "artificer") { fillRR(c, -7.5, -11, 4, 7, 1.2, e >= 6 ? "#5a6470" : "#6b4a2a"); line(c, -6.5, -11, -7.5, -16, "#888", 0.8); circle(c, -7.5, -16.3, 1, energy(e)); }
  c.restore();
}
function heroBody(h, e, team) {
  const base = { warden: "#8b8f98", huntress: "#3f6a3a", sage: "#5a3f8a", shade: "#26232b", artificer: "#8a6236" }[h];
  if (e >= 7) return mix(base, "#e6ecf2", 0.35);
  return team === 1 ? mix(base, "#3a3440", 0.4) : base;
}
const heroHelm = (h) => ({ warden: "great", huntress: "hood", sage: "hood", shade: "hood", artificer: "goggles" }[h]);
const heroHelmColor = (h, e, team) => ({ warden: "#c4c9cf", huntress: "#2e5230", sage: "#47306e", shade: "#141218", artificer: "#6b4a2a" }[h]);

function helmet(c, kind, col, e, T) {
  switch (kind) {
    case "": c.fillStyle = col; c.beginPath(); c.arc(0.3, -15.2, 4, 3.3, 6.3); c.fill(); c.fillRect(-3.6, -15.5, 2, 4); break;
    case "cap": c.fillStyle = col; c.beginPath(); c.arc(0.4, -15, 4.2, 3.14, 6.28); c.fill(); break;
    case "crest": c.fillStyle = col; c.beginPath(); c.arc(0.4, -15, 4.3, 3.14, 6.28); c.fill(); c.fillRect(-3.9, -15, 1.6, 3.5); c.fillStyle = "#b8282a"; c.beginPath(); c.ellipse(-0.5, -19.4, 4.2, 1.6, -0.2, 0, 6.3); c.fill(); break;
    case "great": c.fillStyle = col; rr(c, -3.6, -19, 8, 8.3, 2); c.fill(); c.fillStyle = "#222"; c.fillRect(0.5, -16, 4, 1.2); break;
    case "tricorn": c.fillStyle = "#e9dcc0"; c.fillRect(-3.5, -15, 7.5, 1.5); c.fillStyle = col; c.beginPath(); c.moveTo(-5, -16.5); c.lineTo(5.5, -16.5); c.lineTo(3, -20); c.lineTo(-2.5, -20); c.closePath(); c.fill(); break;
    case "brodie": c.fillStyle = col; c.beginPath(); c.ellipse(0.4, -16.6, 5.6, 1.6, 0, 0, 6.3); c.fill(); c.beginPath(); c.arc(0.4, -16.6, 3.4, 3.14, 6.28); c.fill(); break;
    case "combat": c.fillStyle = col; c.beginPath(); c.arc(0.3, -15.2, 4.6, 3.0, 6.4); c.fill(); c.fillStyle = shade(col, -0.2); c.fillRect(-4, -15.4, 8.6, 1.2); break;
    case "visor": c.fillStyle = col; c.beginPath(); c.arc(0.4, -14.6, 4.6, 0, 6.3); c.fill(); c.fillStyle = "#14202a"; rr(c, 0.4, -16.4, 4.4, 2.8, 1.2); c.fill(); c.fillStyle = hexA("#62e8ff", 0.95); c.fillRect(1, -15.6, 3.6, 1); break;
    case "dome": c.fillStyle = col; c.beginPath(); c.arc(0.4, -14.6, 4.7, 0, 6.3); c.fill(); c.strokeStyle = "#8da7ff"; c.lineWidth = 1; c.beginPath(); c.arc(0.4, -14.6, 3.4, -1.2, 1.2); c.stroke(); break;
    case "halo": c.strokeStyle = hexA("#ffe9a8", 0.95); c.lineWidth = 1.2; c.beginPath(); c.ellipse(0.4, -20.5, 4.2, 1.4, 0, 0, 6.3); c.stroke(); glow(c, 0.4, -20.5, 5, "#d38bff", 0.35); c.fillStyle = "#f2e8ff"; c.beginPath(); c.arc(0.3, -15.4, 4, 3.3, 6.3); c.fill(); break;
    case "hood": c.fillStyle = col; c.beginPath(); c.moveTo(-4.5, -11); c.quadraticCurveTo(-5, -20, 1, -19.4); c.quadraticCurveTo(5.5, -18.5, 4.8, -13.5); c.lineTo(3.4, -13.5); c.quadraticCurveTo(3.5, -17, 0.5, -17.2); c.quadraticCurveTo(-2.6, -16.5, -2.4, -11); c.closePath(); c.fill(); break;
    case "goggles": c.fillStyle = "#3a2a1a"; c.beginPath(); c.arc(0.3, -15.4, 4, 3.3, 6.3); c.fill(); circle(c, 2.6, -15, 1.5, "#d8b048"); circle(c, 2.6, -15, 0.9, "#9fe8ff"); break;
  }
}
function shield(c, e, T, big) {
  const s = big ? 1.25 : 1;
  c.save(); c.translate(4.5, -6); c.scale(s, s);
  if (e === 2) { fillRR(c, -2, -5.5, 4.5, 11, 1.2, "#a3302c"); c.fillStyle = "#d8b048"; c.fillRect(-0.6, -1, 2, 2); }
  else { c.fillStyle = T.main; c.beginPath(); c.moveTo(-2.6, -5.5); c.lineTo(3.4, -5.5); c.lineTo(3.4, 0); c.quadraticCurveTo(3.2, 4.5, 0.4, 6.2); c.quadraticCurveTo(-2.4, 4.5, -2.6, 0); c.closePath(); c.fill(); c.strokeStyle = "#e4e6ea"; c.lineWidth = 0.8; c.stroke(); c.fillStyle = T.light; c.fillRect(-0.2, -4, 1.2, 8); }
  if (big && e >= 7) { c.strokeStyle = hexA(energy(e), 0.9); c.lineWidth = 1; c.stroke(); }
  c.restore();
}

/** What a hand holds, drawn at the hand, pointing down-forward (rotate to swing). */
function held(c, what, e, T, strike, hollow) {
  const en = hollow ? "#b48cff" : energy(e);
  const wood = "#6e4a2a", steel = "#c7ccd2", dark = "#2d2f33";
  switch (what) {
    case "worker":
      if (e <= 4) { line(c, 0, 0, 3, -9, wood, 1.4); c.fillStyle = e === 0 ? "#8a8278" : steel; c.beginPath(); c.moveTo(2, -10); c.lineTo(6.5, -9); c.lineTo(5.5, -6.5); c.lineTo(2.5, -7.5); c.fill(); }
      else if (e <= 7) { line(c, 0, 0, 2.5, -7, "#9aa2aa", 1.6); c.strokeStyle = "#9aa2aa"; c.lineWidth = 1.4; c.beginPath(); c.arc(3, -8.5, 1.8, 0.5, 5.2); c.stroke(); }
      else { line(c, 0, 0, 2, -6, "#d8dde4", 1.6); glow(c, 2.6, -7.5, 3, en, 0.9); }
      break;
    case "melee":
      if (e === 0) { line(c, 0, 0, 3.5, -10, wood, 2.4); circle(c, 3.8, -10.4, 2.1, "#5a3c20"); }
      else if (e === 1) { line(c, -1, 3, 4, -14, wood, 1.2); c.fillStyle = "#c08a3a"; c.beginPath(); c.moveTo(3.4, -13); c.lineTo(5.2, -17.5); c.lineTo(5.4, -12.6); c.fill(); }
      else if (e <= 3) { line(c, 0, 0, 1, -2, "#5a3c20", 1.8); line(c, 1, -2, 3.5, -11 - (e === 3 ? 2 : 0), steel, 1.7); line(c, -1, -1.5, 3, -2.5, "#d8b048", 1.2); }
      else if (e <= 6) { line(c, -2, 2, 6, -4, e === 6 ? dark : wood, 1.8); line(c, 0, 0.5, 5, -3, e === 6 ? "#444" : "#3b3b3b", 1.1); if (e <= 5) line(c, 6, -4, 9.5, -6.2, steel, 0.9); }
      else if (e === 7) { line(c, 0, 0, 1, -2, "#555", 1.6); line(c, 1, -2, 4, -13, hexA(en, 0.95), 2); glow(c, 2.5, -7.5, 6, en, 0.35); }
      else if (e === 8) { line(c, -2, 4, 5, -16, "#8a92a8", 1.2); line(c, 4, -13, 5.5, -18, hexA(en, 1), 2.2); glow(c, 5, -16, 6, en, 0.45); }
      else { line(c, 0, 0, 4, -14, hexA("#f4e8ff", 0.95), 2.4); glow(c, 2, -7, 8, en, 0.45); }
      break;
    case "ranged":
      if (e === 0) { c.strokeStyle = "#7a6a52"; c.lineWidth = 0.7; c.beginPath(); c.moveTo(0, 0); c.lineTo(-2, 6); c.moveTo(0, 0); c.lineTo(2, 6); c.stroke(); circle(c, 0, 6.5, 1.3, "#8a8278"); }
      else if (e <= 2) { c.strokeStyle = wood; c.lineWidth = 1.3; c.beginPath(); c.arc(-2, -3, e === 2 ? 9 : 7, -1.1, 1.1); c.stroke(); line(c, 1.5, -10.5, 1.5, 4.5, "#e8e0cc", 0.5); }
      else if (e === 3) { line(c, -2, 0, 7, -2, wood, 2); c.strokeStyle = "#4a3a2a"; c.lineWidth = 1.2; c.beginPath(); c.arc(5, -2, 4.5, -1.6, 1.6); c.stroke(); }
      else if (e <= 6) { line(c, -3, 1.5, 10, -3.5, e >= 6 ? dark : wood, 1.6); line(c, 2, -0.5, 11, -3.8, "#3b3b3b", 1); if (e === 6) { fillRR(c, 3, -4, 3.5, 1.5, 0.5, "#222"); } }
      else if (e === 7) { fillRR(c, -2, -3, 12, 3.4, 1, "#d8dde4"); c.fillStyle = hexA(en, 0.95); c.fillRect(1, -2.2, 8, 1.2); glow(c, 10, -1.6, 4, en, 0.7); }
      else if (e === 8) { c.strokeStyle = hexA(en, 0.95); c.lineWidth = 1.6; c.beginPath(); c.arc(-2, -3, 9, -1.1, 1.1); c.stroke(); glow(c, 1, -3, 6, en, 0.4); }
      else { line(c, -1, 6, 3, -13, "#f2eaff", 1.4); glow(c, 3.3, -13.5, 5, "#ffe9a8", 0.9); }
      break;
    case "mender":
      if (e <= 6) { line(c, -1, 6, 2.5, -12, e >= 5 ? "#e8e8e8" : wood, 1.3); glow(c, 2.7, -12.5, 3.4, e >= 5 ? "#ff6b6b" : "#9fe8a0", 0.9); }
      else { line(c, -1, 5, 2, -9, "#e0e6ee", 1.3); glow(c, 2.4, -10, 5, en, 0.9); }
      break;
    case "hero:warden":
      line(c, 0, 0, 3.5, -10, e >= 7 ? "#c7ccd2" : wood, 2); circle(c, 3.8, -10.6, 2.6, e >= 7 ? en : "#9aa0a8");
      break;
    case "hero:huntress":
      c.strokeStyle = e >= 7 ? hexA(en, 1) : wood; c.lineWidth = 1.5; c.beginPath(); c.arc(-2, -3, 10, -1.15, 1.15); c.stroke(); line(c, 2.2, -12, 2.2, 6, "#efe6d0", 0.5);
      if (e >= 7) glow(c, 0, -3, 7, en, 0.35);
      break;
    case "hero:sage":
      line(c, -1, 7, 3, -14, "#5a3c20", 1.4); glow(c, 3.3, -15, 6, en, 0.95); circle(c, 3.3, -15, 1.6, "#ffffff");
      break;
    case "hero:shade":
      line(c, 0, 0, 3, -7, e >= 7 ? hexA(en, 1) : steel, 1.4); line(c, -5, 1, -3, -5, e >= 7 ? hexA(en, 1) : steel, 1.2);
      break;
    case "hero:artificer":
      line(c, 0, 0, 3, -8, "#9aa2aa", 2); c.strokeStyle = "#9aa2aa"; c.lineWidth = 1.6; c.beginPath(); c.arc(3.6, -9.6, 2.2, 0.4, 5.3); c.stroke();
      break;
  }
}

function turret(c, e, team, frame) {
  const T = TEAM[team];
  c.fillStyle = "rgba(0,0,0,0.3)"; c.beginPath(); c.ellipse(0, 6, 10, 4, 0, 0, 6.3); c.fill();
  line(c, -6, 6, 0, -4, "#6a6e74", 2); line(c, 6, 6, 0, -4, "#6a6e74", 2); line(c, 0, 7, 0, -4, "#6a6e74", 2);
  fillRR(c, -6, -10, 12, 8, 3, e >= 7 ? "#dfe4ea" : "#8a7a5a");
  c.fillStyle = T.main; c.fillRect(-6, -6, 12, 1.6);
  line(c, 2, -6.5, 13, -7.5, "#2d2f33", 2.2);
  glow(c, -1, -7, 3, energy(e), 0.9);
}

/* =========================================================================
   Beasts and riders (side-on): chariot, horseman, knight, dragoon
   ========================================================================= */
function rider(c, e, team, frame) {
  const T = TEAM[team], hollow = team === 1;
  const walk = frame < 4 ? frame : 0, strike = frame === 4;
  const gal = [0, 1, 2, 1][walk];
  const horse = hollow ? "#4a4248" : e === 3 ? "#e8e4dc" : e === 4 ? "#3a2a20" : "#7a5236";
  c.fillStyle = "rgba(0,0,0,0.25)"; c.beginPath(); c.ellipse(0, 7, 15, 4, 0, 0, 6.3); c.fill();
  // legs
  c.strokeStyle = shade(horse, -0.3); c.lineWidth = 2.2;
  const lg = (x, ph) => { const a = Math.sin((walk + ph) * 1.57) * 3; c.beginPath(); c.moveTo(x, -2); c.lineTo(x + a, 7); c.stroke(); };
  lg(-9, 0); lg(-6, 2); lg(6, 1); lg(9, 3);
  // body, neck, head
  c.fillStyle = horse; c.beginPath(); c.ellipse(0, -4, 12, 5.2, 0, 0, 6.3); c.fill();
  c.beginPath(); c.moveTo(8, -7); c.lineTo(13, -15); c.lineTo(17, -13.5); c.lineTo(12, -4); c.closePath(); c.fill();
  c.beginPath(); c.ellipse(16.5, -13, 4, 2.3, 0.5, 0, 6.3); c.fill();
  c.fillStyle = shade(horse, -0.45); c.beginPath(); c.moveTo(-12, -6); c.quadraticCurveTo(-17, -4, -15, 2); c.lineTo(-12, -3); c.fill();
  if (hollow) glow(c, 17.2, -14, 2, "#b48cff", 0.8);
  if (e === 1) {   // a chariot: the car and its wheel behind the horse
    fillRR(c, -20, -8, 10, 8, 1.5, "#8a6236"); c.strokeStyle = "#4a321c"; c.lineWidth = 1.6; c.beginPath(); c.arc(-15, 1, 5, 0, 6.3); c.stroke(); line(c, -15, -4, -15, 6, "#4a321c", 1); line(c, -20, 1, -10, 1, "#4a321c", 1);
    line(c, -10, -4, -6, -4, "#4a321c", 1.2);
  }
  if (e === 3) { c.fillStyle = T.main; c.beginPath(); c.moveTo(-11, -7); c.lineTo(10, -7); c.lineTo(9, 1); c.lineTo(-10, 1); c.closePath(); c.fill(); c.fillStyle = T.light; c.fillRect(-2, -6, 3, 6); }
  // the rider
  const rx = e === 1 ? -15 : -1, ry = e === 1 ? -9 : -9;
  c.save(); c.translate(rx, ry - gal * 0.3);
  const O = OUT[e];
  fillRR(c, -3.5, -9, 7, 9, 2.5, hollow ? mix(O.body, "#3a3440", 0.35) : O.body);
  c.fillStyle = T.main; c.fillRect(-3.5, -5, 7, 2);
  circle(c, 0.5, -12, 3.4, hollow ? HOLLOW_SKIN : SKIN[e % 4]);
  if (hollow) circle(c, 2.4, -12.4, 0.7, "#d9c8ff");
  helmet(c, O.helm, O.hc || O.hair, e, T);
  c.save(); c.translate(2.5, -6); c.rotate(strike ? -0.5 : 0.2);
  if (e === 1) line(c, 0, 0, 14, -10, "#6e4a2a", 1.2);
  else if (e === 2) { line(c, 0, 0, 3, -10, "#c7ccd2", 1.6); }
  else if (e === 3) { line(c, -4, 2, 22, -2, "#d8d0c0", 1.8); c.fillStyle = T.main; c.beginPath(); c.moveTo(14, -1.5); c.lineTo(19, -1.8); c.lineTo(15, -4.5); c.fill(); }
  else { line(c, -2, 1, 12, -3, "#4a321c", 1.6); line(c, 2, -0.5, 12, -3.4, "#333", 1); }
  c.restore(); c.restore();
}

/* =========================================================================
   The wild: one four-legged body, dressed differently in every era
   ========================================================================= */
const BEASTS = [
  { body: "#7d7a76", belly: "#b8b2a8", s: 0.9, ears: 1 },                         // wolf
  { body: "#5e4030", belly: "#8a6248", s: 1.0, tusk: 1, bristle: 1 },             // boar
  { body: "#4a3426", belly: "#6e5038", s: 1.25 },                                 // cave bear
  { body: "#3a2c24", belly: "#5e4a3a", s: 1.35, plates: "#8a8a8a" },              // dire bear
  { body: "#3f6a3a", belly: "#a8c070", s: 1.2, tail: 1, spikes: "#d8c060" },      // wyrm
  { body: "#7a4a30", belly: "#a07050", s: 1.25, plates: "#a85a30", rivets: 1 },   // ironback
  { body: "#1e1e24", belly: "#3a3a44", s: 1.05, ears: 1, eye: "#ffcf6b" },        // stalker
  { body: "#dfe4ea", belly: "#9aa6b4", s: 1.1, ears: 1, eye: "#ff4a4a", mech: 1 },// hunter-machine
  { body: "#2a1f45", belly: "#4a3a7a", s: 1.15, ears: 1, eye: "#d38bff", aura: "#8da7ff" }, // void hound
  { body: "#f2ecff", belly: "#c8b8ff", s: 1.25, eye: "#ffffff", aura: "#d38bff", ghost: 1 } // echo beast
];
function beast(c, e, frame) {
  const B = BEASTS[Math.max(0, Math.min(9, e))], s = B.s;
  const walk = frame < 4 ? frame : 0, strike = frame === 4;
  c.save(); c.scale(s, s);
  if (B.aura) glow(c, 0, -6, 18, B.aura, 0.35);
  if (B.ghost) c.globalAlpha = 0.8;
  c.fillStyle = "rgba(0,0,0,0.25)"; c.beginPath(); c.ellipse(0, 7, 13, 3.5, 0, 0, 6.3); c.fill();
  c.strokeStyle = shade(B.body, -0.3); c.lineWidth = 2.6;
  const lg = (x, ph) => { const a = Math.sin((walk + ph) * 1.57) * 2.6; c.beginPath(); c.moveTo(x, -3); c.lineTo(x + a, 7); c.stroke(); };
  lg(-7, 0); lg(-4, 2); lg(5, 1); lg(8, 3);
  if (B.tail) { c.strokeStyle = B.body; c.lineWidth = 3; c.beginPath(); c.moveTo(-9, -5); c.quadraticCurveTo(-18, -4, -21, 2); c.stroke(); }
  else { c.strokeStyle = B.body; c.lineWidth = 2; c.beginPath(); c.moveTo(-9, -6); c.quadraticCurveTo(-14, -9, -15, -4); c.stroke(); }
  c.fillStyle = B.body; c.beginPath(); c.ellipse(0, -5, 10.5, 5.2, 0, 0, 6.3); c.fill();
  c.fillStyle = B.belly; c.beginPath(); c.ellipse(1, -2.6, 7.5, 2.4, 0, 0, 3.14); c.fill();
  // head, lunging forward on a bite
  const hx = strike ? 13 : 11, hy = strike ? -6 : -8;
  c.fillStyle = B.body; c.beginPath(); c.ellipse(hx, hy, 5, 4, 0.2, 0, 6.3); c.fill();
  c.beginPath(); c.moveTo(hx + 2, hy - 1); c.lineTo(hx + 8, hy + 1); c.lineTo(hx + 2, hy + 3); c.fill();
  if (B.ears) { c.beginPath(); c.moveTo(hx - 2, hy - 3); c.lineTo(hx - 1, hy - 8); c.lineTo(hx + 1.5, hy - 3.5); c.fill(); }
  if (B.tusk) { c.strokeStyle = "#efe6d0"; c.lineWidth = 1.2; c.beginPath(); c.moveTo(hx + 6, hy + 2); c.lineTo(hx + 7, hy - 1.5); c.stroke(); }
  if (B.bristle || B.spikes) { c.fillStyle = B.spikes || shade(B.body, -0.35); for (let k = -6; k <= 4; k += 3) { c.beginPath(); c.moveTo(k - 1.5, -9.6); c.lineTo(k, -13.5); c.lineTo(k + 1.5, -9.6); c.fill(); } }
  if (B.plates) { c.fillStyle = B.plates; for (let k = -6; k <= 4; k += 5) fillRR(c, k - 2, -10.5, 4.5, 4, 1, B.plates); if (B.rivets) for (let k = -5; k <= 5; k += 5) circle(c, k, -8.5, 0.6, "#3a2a20"); }
  if (B.mech) { c.strokeStyle = "#9aa6b4"; c.lineWidth = 0.8; c.beginPath(); c.moveTo(-8, -5); c.lineTo(8, -5); c.stroke(); }
  const eye = B.eye || "#1a1410";
  circle(c, hx + 2, hy - 1, 0.9, eye);
  if (B.eye) glow(c, hx + 2, hy - 1, 3, B.eye, 0.7);
  c.restore();
}

/* =========================================================================
   Siege (side-on, then from above)
   ========================================================================= */
function siegeSide(c, e, team, frame) {
  const T = TEAM[team], wood = team === 1 ? "#5a4640" : "#7a5634", woodD = shade(wood, -0.35);
  const fire = frame === 4;
  c.fillStyle = "rgba(0,0,0,0.28)"; c.beginPath(); c.ellipse(0, 7, 20, 5, 0, 0, 6.3); c.fill();
  const wheel = (x, r) => { c.strokeStyle = woodD; c.lineWidth = 2; c.beginPath(); c.arc(x, 3, r, 0, 6.3); c.stroke(); for (let k = 0; k < 4; k++) { const a = k * 0.785 + frame * 0.4; line(c, x + Math.cos(a) * r, 3 + Math.sin(a) * r, x - Math.cos(a) * r, 3 - Math.sin(a) * r, woodD, 0.8); } };
  if (e === 1) {          // ram: a roofed frame and a log
    fillRR(c, -18, -12, 34, 12, 2, wood);
    c.fillStyle = team === 1 ? "#4a3a3a" : "#8a7a5a"; c.beginPath(); c.moveTo(-20, -11); c.lineTo(-2, -22); c.lineTo(18, -11); c.closePath(); c.fill();
    c.strokeStyle = shade(wood, -0.2); c.lineWidth = 0.7; for (let k = -16; k < 16; k += 4) { c.beginPath(); c.moveTo(k, -11); c.lineTo(k + 2, -18); c.stroke(); }
    fillRR(c, 8 + (fire ? 6 : 0), -8, 16, 5, 2.4, "#5a3c20"); circle(c, 24 + (fire ? 6 : 0), -5.5, 3, "#8a8278");
    wheel(-12, 4.5); wheel(10, 4.5);
    c.fillStyle = T.main; c.fillRect(-4, -18, 4, 4);
  } else if (e === 2) {   // onager
    fillRR(c, -16, -5, 32, 6, 1.5, wood);
    line(c, -8, -5, -2, -16, woodD, 2.4); line(c, 4, -5, -2, -16, woodD, 2.4);
    c.save(); c.translate(-2, -12); c.rotate(fire ? -0.4 : 0.9); line(c, 0, 0, -18, 0, wood, 2); circle(c, -18, 0, 3, "#6a5a48"); c.restore();
    wheel(-10, 4); wheel(10, 4); c.fillStyle = T.main; c.fillRect(-15, -4, 4, 3);
  } else if (e === 3) {   // trebuchet
    fillRR(c, -18, -4, 36, 5, 1.5, wood);
    line(c, -10, -4, 0, -30, woodD, 2.6); line(c, 10, -4, 0, -30, woodD, 2.6);
    c.save(); c.translate(0, -28); c.rotate(fire ? -2.2 : 0.75); line(c, -24, 0, 12, 0, wood, 2.2); fillRR(c, 8, -1, 8, 9, 1, "#555"); line(c, -24, 0, -24, 8, "#999", 0.6); c.restore();
    wheel(-12, 3.6); wheel(12, 3.6); c.fillStyle = T.main; c.beginPath(); c.moveTo(0, -30); c.lineTo(0, -38); c.lineTo(6, -35); c.fill();
  } else {                // cannon / field gun
    const gun = e === 4 ? "#3a3a3e" : "#4a5040";
    fillRR(c, -14, -4, 20, 5, 1.5, e === 4 ? wood : "#5a5a48");
    c.save(); c.translate(-2, -6); c.rotate(-0.18 + (fire ? -0.06 : 0)); fillRR(c, -6, -3.2, 26, 6.4, 3, gun); fillRR(c, 18, -3.8, 4, 7.6, 1.5, shade(gun, 0.15)); c.restore();
    wheel(-2, 7);
    if (e === 5) { fillRR(c, -6, -14, 12, 9, 1, "#6b6e58"); }
    if (fire) glow(c, 26, -12, 8, "#ffcf6b", 0.9);
    c.fillStyle = T.main; c.fillRect(-13, -3, 4, 3);
  }
}
function siegeTop(c, e, team, frame) {
  const T = TEAM[team], en = team === 1 ? "#b48cff" : energy(e);
  c.fillStyle = "rgba(0,0,0,0.3)"; rr(c, -22, -12, 46, 28, 6); c.fill();
  if (e === 6) {          // rocket battery: a truck with a rack of tubes
    fillRR(c, -20, -10, 40, 20, 3, "#55663e");
    fillRR(c, 12, -9, 9, 18, 2, "#46532f"); c.fillStyle = "#9fc4d6"; c.fillRect(17, -7, 3, 14);
    fillRR(c, -17, -8, 26, 16, 2, "#3a4628");
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) circle(c, -14 + i * 6.2, -4.5 + j * 4.5, 1.8, "#1d2216");
    c.fillStyle = T.main; c.fillRect(-20, -10, 4, 20);
  } else if (e === 7) {   // missile rig
    fillRR(c, -20, -11, 40, 22, 6, "#dfe4ea");
    fillRR(c, -12, -6, 24, 12, 3, "#c1c9d2"); fillRR(c, -10, -3, 20, 2.5, 1, "#e9edf2"); fillRR(c, -10, 1, 20, 2.5, 1, "#e9edf2");
    c.fillStyle = hexA(en, 0.9); c.fillRect(-20, -1, 40, 2);
    c.fillStyle = T.main; c.fillRect(14, -11, 6, 22);
  } else if (e === 8) {   // lance array: a hovering prism
    glow(c, 0, 0, 22, en, 0.35);
    fillRR(c, -18, -12, 36, 24, 10, "#3b4262");
    c.fillStyle = "#c9d4ff"; c.beginPath(); c.moveTo(-8, -6); c.lineTo(16, 0); c.lineTo(-8, 6); c.closePath(); c.fill();
    glow(c, 14, 0, 7, en, 0.9);
    c.fillStyle = T.main; c.fillRect(-16, -2, 6, 4);
  } else {                // the singularity engine
    c.strokeStyle = hexA(en, 0.8); c.lineWidth = 2; c.beginPath(); c.ellipse(0, 0, 20, 8, (frame & 3) * 0.4, 0, 6.3); c.stroke();
    c.beginPath(); c.ellipse(0, 0, 8, 20, (frame & 3) * 0.4, 0, 6.3); c.stroke();
    circle(c, 0, 0, 7, "#07040e"); glow(c, 0, 0, 12, en, 0.5);
    c.fillStyle = T.main; c.fillRect(-2, -14, 4, 4);
  }
}

/* =========================================================================
   Armour from above
   ========================================================================= */
function vehicle(c, e, team, frame) {
  const T = TEAM[team], en = team === 1 ? "#b48cff" : energy(e), hollow = team === 1;
  c.fillStyle = "rgba(0,0,0,0.3)"; rr(c, -18, -11, 40, 26, 6); c.fill();
  const tread = (y) => { fillRR(c, -17, y, 34, 6, 2, "#22241f"); c.strokeStyle = "#3a3d35"; c.lineWidth = 1; for (let x = -15 + (frame % 2) * 2; x < 16; x += 4) { c.beginPath(); c.moveTo(x, y); c.lineTo(x, y + 6); c.stroke(); } };
  if (e === 5) {
    for (const [x, y] of [[-9, -9], [9, -9], [-9, 9], [9, 9]]) fillRR(c, x - 3.5, y - 2.5, 7, 5, 1.5, "#1f1f1f");
    fillRR(c, -15, -8, 30, 16, 4, hollow ? "#5a4a44" : "#7b6a45"); fillRR(c, 4, -6, 9, 12, 2, "#9fb2b8");
    circle(c, -3, 0, 5, shade(hollow ? "#5a4a44" : "#7b6a45", -0.2)); line(c, -3, 0, 12, 0, "#2b2b2b", 1.8);
    c.fillStyle = T.main; c.fillRect(-15, -8, 4, 16);
  } else if (e === 6) {
    tread(-12); tread(6);
    fillRR(c, -15, -8, 30, 16, 3, hollow ? "#4a4a3e" : "#5d6b44");
    circle(c, -2, 0, 7, hollow ? "#3a3a30" : "#4b5836"); fillRR(c, 3, -1.6, 19, 3.2, 1.4, "#2a2f22");
    c.fillStyle = T.main; c.fillRect(-15, -8, 3, 16);
  } else if (e === 7) {
    glow(c, 0, 0, 20, en, 0.3);
    c.fillStyle = "#dfe4ea"; c.beginPath(); c.moveTo(-17, -10); c.lineTo(14, -8); c.lineTo(19, 0); c.lineTo(14, 8); c.lineTo(-17, 10); c.closePath(); c.fill();
    c.fillStyle = hexA(en, 0.9); c.fillRect(-17, -1, 30, 2);
    circle(c, -3, 0, 6.5, "#c1c9d2"); fillRR(c, 2, -1.5, 18, 3, 1.2, "#5a6470");
    c.fillStyle = T.main; c.fillRect(-17, -10, 4, 20);
  } else if (e === 8) {
    c.strokeStyle = hexA(en, 0.7); c.lineWidth = 2; c.beginPath(); c.ellipse(0, 0, 21, 13, 0, 0, 6.3); c.stroke();
    c.fillStyle = "#3b4262"; c.beginPath(); c.moveTo(-16, -8); c.quadraticCurveTo(10, -12, 20, 0); c.quadraticCurveTo(10, 12, -16, 8); c.closePath(); c.fill();
    circle(c, -2, 0, 6, "#56608c"); fillRR(c, 2, -1.6, 18, 3.2, 1.4, "#c9d4ff"); glow(c, 20, 0, 5, en, 0.9);
    c.fillStyle = T.main; c.fillRect(-15, -3, 5, 6);
  } else {                // the colossus: a walker, seen from above
    c.scale(1.25, 1.25);
    const st = Math.sin(frame * 1.57) * 4;
    fillRR(c, -6 + st, -16, 12, 7, 3, "#cdb6ff"); fillRR(c, -6 - st, 9, 12, 7, 3, "#cdb6ff");
    fillRR(c, -11, -10, 22, 20, 8, "#efe6ff");
    glow(c, 2, 0, 12, en, 0.45); circle(c, 2, 0, 4, "#ffffff");
    fillRR(c, 4, -14, 16, 4, 2, "#9c80e0"); fillRR(c, 4, 10, 16, 4, 2, "#9c80e0");
    c.fillStyle = T.main; c.fillRect(-11, -3, 4, 6);
  }
}

/* =========================================================================
   Ships
   ========================================================================= */
function ship(c, e, team, frame) {
  const T = TEAM[team], hollow = team === 1, en = hollow ? "#b48cff" : energy(e);
  const wood = hollow ? "#5a4640" : "#8a6236";
  const hull = (len, wid, col) => { c.fillStyle = col; c.beginPath(); c.moveTo(-len / 2, -wid / 2); c.lineTo(len / 2 - wid * 0.6, -wid / 2); c.quadraticCurveTo(len / 2 + wid * 0.25, 0, len / 2 - wid * 0.6, wid / 2); c.lineTo(-len / 2, wid / 2); c.quadraticCurveTo(-len / 2 - 3, 0, -len / 2, -wid / 2); c.fill(); };
  c.fillStyle = "rgba(0,10,20,0.25)"; c.beginPath(); c.ellipse(2, 3, 34, 12, 0, 0, 6.3); c.fill();
  if (e === 1) {
    hull(40, 9, wood); c.fillStyle = shade(wood, -0.3); c.fillRect(-16, -2, 30, 4);
    for (let i = 0; i < 4; i++) { circle(c, -12 + i * 7, 0, 2, hollow ? HOLLOW_SKIN : "#c99772"); line(c, -12 + i * 7, 2, -14 + i * 7 + (frame & 1) * 3, 8, wood, 1); }
    c.fillStyle = T.main; c.fillRect(14, -2, 4, 4);
  } else if (e <= 4) {
    const len = e === 2 ? 50 : e === 3 ? 46 : 62, wid = e === 2 ? 12 : e === 3 ? 18 : 20;
    hull(len, wid, wood); c.fillStyle = shade(wood, 0.15); hull(len - 6, wid - 5, shade(wood, 0.1));
    if (e === 2) for (let i = 0; i < 6; i++) { line(c, -18 + i * 6, -6, -20 + i * 6 + (frame & 1) * 2, -12, wood, 1); line(c, -18 + i * 6, 6, -20 + i * 6 + (frame & 1) * 2, 12, wood, 1); }
    const masts = e === 4 ? 3 : 1;
    for (let m = 0; m < masts; m++) {
      const mx = masts === 1 ? 0 : -16 + m * 16;
      c.fillStyle = hollow ? "#8a7a80" : "#f0e8d8"; c.beginPath(); c.moveTo(mx - 3, -wid / 2 - 4); c.quadraticCurveTo(mx + 6, 0, mx - 3, wid / 2 + 4); c.closePath(); c.fill();
      c.strokeStyle = "#6a5a48"; c.lineWidth = 0.6; c.stroke();
      if (m === masts - 1 || masts === 1) { c.fillStyle = T.main; c.fillRect(mx - 3, -3, 3, 6); }
      circle(c, mx - 3, 0, 1.6, "#4a321c");
    }
    if (e === 4) for (let i = 0; i < 4; i++) { c.fillStyle = "#222"; c.fillRect(-18 + i * 10, -wid / 2 - 1.5, 3, 2); c.fillRect(-18 + i * 10, wid / 2 - 0.5, 3, 2); }
  } else if (e <= 6) {
    const col = e === 5 ? "#4a4e54" : "#6d747c";
    hull(e === 5 ? 54 : 70, e === 5 ? 16 : 15, col); fillRR(c, -14, -5, 22, 10, 2, shade(col, 0.2));
    if (e === 5) { circle(c, -2, 0, 3.2, "#2a2a2a"); circle(c, 16, 0, 4, shade(col, -0.2)); line(c, 16, 0, 26, 0, "#222", 2); }
    else { circle(c, 22, 0, 3.6, shade(col, -0.2)); line(c, 22, 0, 32, 0, "#2a2a2a", 1.6); circle(c, -22, 0, 3.4, shade(col, -0.2)); line(c, -22, 0, -12, 0, "#2a2a2a", 1.4); fillRR(c, -4, -2, 6, 4, 1, "#3a3f45"); }
    c.fillStyle = T.main; c.fillRect(-10, -5, 4, 10);
  } else if (e === 7) {
    c.fillStyle = "#2d3138"; c.beginPath(); c.moveTo(-30, -9); c.lineTo(22, -9); c.lineTo(34, 0); c.lineTo(22, 9); c.lineTo(-30, 9); c.lineTo(-26, 0); c.closePath(); c.fill();
    c.fillStyle = "#3b4048"; c.beginPath(); c.moveTo(-10, -5); c.lineTo(8, -5); c.lineTo(14, 0); c.lineTo(8, 5); c.lineTo(-10, 5); c.closePath(); c.fill();
    c.fillStyle = hexA(en, 0.9); c.fillRect(-28, -1, 50, 1.4);
    c.fillStyle = T.main; c.fillRect(-28, -9, 4, 18);
  } else if (e === 8) {
    glow(c, 0, 0, 30, en, 0.25);
    c.fillStyle = "#e9eef3"; c.beginPath(); c.moveTo(-28, -10); c.quadraticCurveTo(10, -14, 34, 0); c.quadraticCurveTo(10, 14, -28, 10); c.closePath(); c.fill();
    fillRR(c, -10, -5, 20, 10, 5, "#9fd8f0"); glow(c, 30, 0, 6, en, 0.9);
    c.fillStyle = T.main; c.fillRect(-26, -3, 5, 6);
  } else {
    glow(c, 0, 0, 36, en, 0.3);
    c.fillStyle = "#2a1f45"; c.beginPath(); c.moveTo(-34, -6); c.quadraticCurveTo(-10, -18, 20, -10); c.quadraticCurveTo(40, 0, 20, 10); c.quadraticCurveTo(-10, 18, -34, 6); c.quadraticCurveTo(-28, 0, -34, -6); c.fill();
    for (let i = 0; i < 5; i++) { c.fillStyle = hexA(en, 0.8); c.beginPath(); c.moveTo(-20 + i * 9, -9); c.lineTo(-16 + i * 9, -16); c.lineTo(-13 + i * 9, -8); c.fill(); }
    circle(c, 22, -3, 2, "#ffffff"); glow(c, 22, -3, 5, en, 0.9);
    c.fillStyle = T.main; c.fillRect(-26, -2, 6, 4);
  }
}

/* =========================================================================
   Aircraft
   ========================================================================= */
function aircraft(c, e, team, frame) {
  const T = TEAM[team], en = team === 1 ? "#b48cff" : energy(e);
  if (e <= 6) {           // gunship
    fillRR(c, -14, -6, 26, 12, 6, team === 1 ? "#4a4a3e" : "#55663e"); fillRR(c, -30, -2, 18, 4, 2, "#46532f"); fillRR(c, -32, -6, 4, 12, 1, "#3a4628");
    c.fillStyle = "#9fc4d6"; c.beginPath(); c.ellipse(8, 0, 4, 4.5, 0, 0, 6.3); c.fill();
    c.fillStyle = T.main; c.fillRect(-8, -6, 4, 12);
    c.strokeStyle = "rgba(40,40,40,0.75)"; c.lineWidth = 2.2;
    const a = frame * 0.8; for (let k = 0; k < 2; k++) { const b = a + k * 1.57; c.beginPath(); c.moveTo(-2 + Math.cos(b) * 24, Math.sin(b) * 24); c.lineTo(-2 - Math.cos(b) * 24, -Math.sin(b) * 24); c.stroke(); }
    c.fillStyle = "rgba(60,60,60,0.12)"; c.beginPath(); c.arc(-2, 0, 24, 0, 6.3); c.fill();
  } else if (e === 7) {   // interceptor
    c.fillStyle = "#c1c9d2"; c.beginPath(); c.moveTo(26, 0); c.lineTo(-10, -22); c.lineTo(-16, -22); c.lineTo(-8, -4); c.lineTo(-20, -4); c.lineTo(-24, -10); c.lineTo(-26, 0); c.lineTo(-24, 10); c.lineTo(-20, 4); c.lineTo(-8, 4); c.lineTo(-16, 22); c.lineTo(-10, 22); c.closePath(); c.fill();
    fillRR(c, 4, -2.5, 12, 5, 2.5, "#2a3a48"); c.fillStyle = T.main; c.fillRect(-14, -18, 4, 6); c.fillRect(-14, 12, 4, 6);
    glow(c, -26, 0, 7, en, 0.9);
  } else if (e === 8) {   // starfighter
    c.fillStyle = "#3b4262"; c.beginPath(); c.moveTo(28, 0); c.lineTo(-6, -8); c.lineTo(-20, -26); c.lineTo(-14, -6); c.lineTo(-22, 0); c.lineTo(-14, 6); c.lineTo(-20, 26); c.lineTo(-6, 8); c.closePath(); c.fill();
    c.strokeStyle = hexA(en, 0.9); c.lineWidth = 1; c.stroke();
    glow(c, -22, 0, 8, en, 0.9); glow(c, -19, -22, 4, en, 0.8); glow(c, -19, 22, 4, en, 0.8);
    c.fillStyle = T.main; c.fillRect(-6, -2, 6, 4);
  } else {                // seraph
    glow(c, 0, 0, 30, en, 0.3);
    const flap = Math.sin(frame * 1.57) * 0.25;
    for (const s of [-1, 1]) { c.save(); c.scale(1, s); c.rotate(flap); c.fillStyle = hexA("#f5efff", 0.92); c.beginPath(); c.moveTo(0, -2); c.quadraticCurveTo(-6, -24, -26, -30); c.quadraticCurveTo(-14, -14, -18, -4); c.closePath(); c.fill(); c.restore(); }
    fillRR(c, -8, -3.5, 22, 7, 3.5, "#efe6ff"); glow(c, 12, 0, 6, "#ffe9a8", 0.95);
    c.fillStyle = T.main; c.fillRect(-6, -1.5, 5, 3);
  }
}

/* =========================================================================
   Buildings. (0, 0) is the footprint's top-left; height grows upwards.
   ========================================================================= */
const STY = [
  { wall: "#8b6a43", wallD: "#5f4529", roof: "#c9a55a", roofD: "#97773a", kind: "hut" },
  { wall: "#c8a274", wallD: "#9a774c", roof: "#dcbf92", roofD: "#b8966a", kind: "flat", beam: "#6b4a2a" },
  { wall: "#ddd0b4", wallD: "#ad9f84", roof: "#c0573a", roofD: "#86361f", kind: "gable" },
  { wall: "#a9a59c", wallD: "#7b776f", roof: "#4c5d7c", roofD: "#313d57", kind: "gable", crenel: true },
  { wall: "#bba68c", wallD: "#8b7963", roof: "#3d3c43", roofD: "#25242a", kind: "gable" },
  { wall: "#a2503a", wallD: "#733527", roof: "#6b6e72", roofD: "#4b4e52", kind: "saw" },
  { wall: "#aeb2b6", wallD: "#7c8084", roof: "#8f9398", roofD: "#6d7176", kind: "modern" },
  { wall: "#e9eef3", wallD: "#b8c1cb", roof: "#f5f8fb", roofD: "#d3dbe3", kind: "panel", glass: "#49c8e8" },
  { wall: "#3b4262", wallD: "#262c44", roof: "#5a6492", roofD: "#3b4466", kind: "dome", glow: "#8da7ff" },
  { wall: "#e8dcff", wallD: "#ad9adb", roof: "#d2bcff", roofD: "#9c80e0", kind: "crystal", glow: "#d38bff" }
];
function style(e, team) {
  const s = STY[e];
  if (team !== 1) return s;
  // the enemy builds what you build, in ash and rust, with a light that should not be there
  return Object.assign({}, s, { wall: mix(s.wall, "#3c3238", 0.42), wallD: mix(s.wallD, "#241c22", 0.45), roof: mix(s.roof, "#5a1e26", 0.45), roofD: mix(s.roofD, "#2e0e14", 0.5), glass: "#b48cff", glow: "#b48cff" });
}
export const HEIGHT = { hall: 46, house: 22, barracks: 30, lumber: 18, mine: 18, forge: 28, tower: 62, wall: 16, outpost: 28, altar: 24, academy: 34, stable: 24, workshop: 28, shipyard: 22, airfield: 18, radar: 26, derrick: 22, siphon: 26, beacon: 120 };
const HEAD = 130;   // room above the footprint for tall things

export function buildingSprite(b, era) {
  const e = Math.max(0, Math.min(9, era));
  const key = "b|" + b.type + "|" + e + "|" + b.team;
  const W = b.w * 32, H = b.h * 32;
  return cached(key, W + 24, H + HEAD + 16, 12, HEAD, (c) => building(c, b.type, e, b.team, W, H));
}

function building(c, type, e, team, W, H) {
  const S = style(e, team), T = TEAM[team];
  const h = HEIGHT[type] * (1 + e * 0.04);
  // ground: a patch of trodden earth, then paving as the eras go
  const gc = e <= 1 ? [96, 76, 50, 0.45] : e <= 4 ? [124, 116, 104, 0.55] : e <= 7 ? [142, 146, 152, 0.62] : [150, 140, 190, 0.3];
  const gg = c.createRadialGradient(W / 2, H * 0.55, Math.min(W, H) * 0.2, W / 2, H * 0.55, Math.max(W, H) * 0.62);
  gg.addColorStop(0, "rgba(" + gc[0] + "," + gc[1] + "," + gc[2] + "," + gc[3] + ")"); gg.addColorStop(0.75, "rgba(" + gc[0] + "," + gc[1] + "," + gc[2] + "," + gc[3] * 0.6 + ")"); gg.addColorStop(1, "rgba(" + gc[0] + "," + gc[1] + "," + gc[2] + ",0)");
  c.fillStyle = gg; c.beginPath(); c.ellipse(W / 2, H * 0.55, W * 0.62, H * 0.6, 0, 0, 6.3); c.fill();
  if (e >= 2) { c.fillStyle = "rgba(" + gc[0] + "," + gc[1] + "," + gc[2] + "," + Math.min(0.9, gc[3] + 0.25) + ")"; rr(c, 3, 4, W - 6, H - 6, e >= 5 ? 3 : 8); c.fill(); }
  // the shadow the sun throws to the bottom right
  // no shadow baked in: render.js casts one from wherever the sun is
  const B = (x, y, w, d, hh, opt) => block(c, x, y, w, d, hh, S, T, e, opt || {});
  switch (type) {
    case "hall":
      if (e === 0) { hut(c, W * 0.3, H * 0.42, 22, 26, S, T); hut(c, W * 0.72, H * 0.4, 18, 22, S, T); hut(c, W * 0.5, H * 0.72, 30, 34, S, T, true); fire(c, W * 0.5, H * 0.94); }
      else { B(8, 22, W - 16, H - 26, h * 0.6, { door: true }); B(W * 0.28, 4, W * 0.44, H * 0.5, h, { door: false, flag: true }); if (e >= 3) { B(2, 8, 14, 22, h * 0.8, { tower: true }); B(W - 16, 8, 14, 22, h * 0.8, { tower: true }); } }
      break;
    case "house":
      if (e === 0) hut(c, W / 2, H * 0.62, 22, 24, S, T, true);
      else B(5, 8, W - 10, H - 12, h, { door: true, chimney: e >= 2 && e <= 5 });
      break;
    case "barracks":
      if (e === 0) { hut(c, W * 0.36, H * 0.48, 26, 28, S, T); palisade(c, W * 0.6, H * 0.3, W * 0.36, H * 0.6); dummy(c, W * 0.78, H * 0.62); }
      else { B(4, 6, W * 0.62, H - 10, h, { door: true, banner: true }); c.fillStyle = "rgba(110,90,60,0.35)"; c.fillRect(W * 0.68, H * 0.2, W * 0.3, H * 0.75); dummy(c, W * 0.82, H * 0.55); rack(c, W * 0.76, H * 0.32, e); }
      break;
    case "lumber":
      if (e <= 4) { shed(c, 4, 10, W * 0.55, H - 14, h, S, T); logs(c, W * 0.72, H * 0.7, e); }
      else { B(4, 6, W * 0.6, H - 10, h, { door: true }); logs(c, W * 0.78, H * 0.72, e); }
      break;
    case "mine":
      if (e <= 4) { shed(c, 4, 10, W * 0.55, H - 14, h, S, T); ore(c, W * 0.74, H * 0.68); cart(c, W * 0.5, H * 0.86); }
      else { B(4, 6, W * 0.55, H - 10, h, { door: true }); ore(c, W * 0.76, H * 0.7); }
      break;
    case "forge":
      if (e === 0) { hut(c, W * 0.38, H * 0.5, 28, 30, S, T); fire(c, W * 0.75, H * 0.72); c.fillStyle = "#555"; c.fillRect(W * 0.62, H * 0.82, 10, 5); }
      else { B(4, 6, W - 10, H - 10, h, { door: true }); chimney(c, W * 0.74, 10 - h, e, true); c.fillStyle = "#3a3a3e"; fillRR(c, W * 0.12, H - 10, 12, 6, 1.5, "#3a3a3e"); }
      break;
    case "tower": tower(c, W, H, e, S, T, h); break;
    case "outpost":
      palisade(c, 2, 4, W - 4, H - 6, e);
      if (e <= 1) { fire(c, W / 2, H * 0.6); hut(c, W * 0.5, H * 0.45, 18, 20, S, T); }
      else B(W * 0.3, H * 0.2, W * 0.4, H * 0.5, h, { flag: true, door: true });
      break;
    case "altar":
      c.fillStyle = shade(S.wall, -0.1); rr(c, 6, H * 0.38, W - 12, H * 0.56, 4); c.fill();
      c.fillStyle = S.wall; rr(c, 10, H * 0.3, W - 20, H * 0.5, 3); c.fill();
      obelisk(c, W / 2, H * 0.52, e, S, T, h);
      fire(c, 12, H * 0.82); fire(c, W - 12, H * 0.82);
      break;
    case "academy":
      if (e === 0) { for (let k = 0; k < 8; k++) { const a = k / 8 * 6.28; standing(c, W / 2 + Math.cos(a) * W * 0.36, H * 0.56 + Math.sin(a) * H * 0.3, S); } fire(c, W / 2, H * 0.62); }
      else { B(4, 10, W - 8, H - 14, h * 0.75, { door: true, cupola: true }); }
      break;
    case "stable":
      B(4, 6, W * 0.58, H - 10, h, { door: true, wide: e >= 5 });
      fence(c, W * 0.64, H * 0.18, W * 0.34, H * 0.76, e);
      if (e <= 4) { c.fillStyle = "#d8b860"; fillRR(c, W * 0.74, H * 0.6, 9, 6, 2, "#d8b860"); }
      break;
    case "workshop":
      B(4, 6, W * 0.62, H - 10, h, { door: true, wide: true });
      crane(c, W * 0.82, H * 0.82, e);
      break;
    case "shipyard":
      B(6, 6, W - 12, H * 0.62, h, { door: true, wide: true });
      c.fillStyle = e <= 4 ? "#7a5634" : "#7c8084"; c.fillRect(4, H * 0.7, W - 8, H * 0.24);
      crane(c, W * 0.8, H * 0.62, e);
      break;
    case "airfield":
      c.fillStyle = "#5a5e62"; c.fillRect(2, H * 0.55, W - 4, H * 0.4);
      c.fillStyle = "#e8e8e0"; for (let x = 10; x < W - 10; x += 16) c.fillRect(x, H * 0.74, 9, 2);
      hangar(c, 6, 8, W * 0.6, H * 0.42, S, T, e);
      B(W * 0.72, 8, W * 0.22, H * 0.36, h * 1.6, { tower: true });
      break;
    case "radar":
      B(6, 12, W - 12, H - 16, h * 0.6, { door: true });
      break;
    case "derrick":
      c.fillStyle = "rgba(10,10,10,0.6)"; c.beginPath(); c.ellipse(W / 2, H * 0.6, W * 0.4, H * 0.3, 0, 0, 6.3); c.fill();
      fillRR(c, 4, H * 0.66, W - 8, H * 0.28, 2, S.wallD);
      break;
    case "siphon":
      for (let k = 0; k < 4; k++) { const a = k * 1.57 + 0.78; line(c, W / 2 + Math.cos(a) * W * 0.4, H * 0.62 + Math.sin(a) * H * 0.3, W / 2, H * 0.5 - h * 0.8, S.wallD, 3); }
      break;
    case "beacon":
      c.fillStyle = S.wallD; rr(c, 4, H * 0.3, W - 8, H * 0.66, 6); c.fill();
      c.fillStyle = S.wall; rr(c, 14, H * 0.22, W - 28, H * 0.56, 5); c.fill();
      c.fillStyle = S.roof; rr(c, 26, H * 0.18, W - 52, H * 0.46, 4); c.fill();
      c.fillStyle = "#f5efff"; c.beginPath(); c.moveTo(W / 2 - 9, H * 0.42); c.lineTo(W / 2, H * 0.42 - h); c.lineTo(W / 2 + 9, H * 0.42); c.closePath(); c.fill();
      glow(c, W / 2, H * 0.42 - h, 26, "#ffe9a8", 0.9);
      break;
  }
}

/** A box seen from the front and above: a wall face, and a roof in the era's style. */
function block(c, x, y, w, d, h, S, T, e, o) {
  const fy = y + d;                 // the front edge on the ground
  // front wall
  c.fillStyle = S.wallD; c.fillRect(x, fy - h, w, h);
  c.fillStyle = S.wall; c.fillRect(x, fy - h, w, Math.min(h, 3));
  // courses of brick, timber, panels, by era
  c.strokeStyle = "rgba(0,0,0,0.12)"; c.lineWidth = 0.8;
  if (e === 1 || e === 2 || e === 3 || e === 5) for (let yy = fy - h + 6; yy < fy; yy += 5) { c.beginPath(); c.moveTo(x, yy); c.lineTo(x + w, yy); c.stroke(); }
  // windows: dark by day; the renderer lights them at night
  const win = S.glass ? S.glass : e >= 6 ? "#5a7a8a" : "#2a2420";
  if (h > 16) {
    const rows = e >= 6 ? Math.max(1, Math.floor((h - 10) / 9)) : 1, cols = Math.max(1, Math.floor(w / 12));
    for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
      const wx = x + (k + 0.5) * (w / cols) - 2.5, wy = fy - h + 6 + r * 9;
      if (o.door && r === rows - 1 && k === Math.floor(cols / 2)) continue;
      c.fillStyle = win; e >= 7 ? c.fillRect(wx - 1, wy, 7, 4) : c.fillRect(wx, wy, 5, 5);
    }
    if (e === 7) { c.fillStyle = hexA(S.glass, 0.9); c.fillRect(x, fy - h + 3, w, 2); }
  }
  if (o.door) { const dw = o.wide ? Math.min(18, w * 0.4) : 7; c.fillStyle = e >= 6 ? "#3a4048" : "#3a2a1c"; c.fillRect(x + w / 2 - dw / 2, fy - 10, dw, 10); if (e <= 4) { c.fillStyle = "#6b4a2a"; c.fillRect(x + w / 2 - dw / 2, fy - 10, dw, 1.5); } }
  // roof (the top face, raised by h)
  const ry = y - h, rd = d;
  if (S.kind === "gable" || S.kind === "hut") {
    c.fillStyle = S.roof; c.fillRect(x - 2, ry, w + 4, rd * 0.5);
    c.fillStyle = S.roofD; c.fillRect(x - 2, ry + rd * 0.5, w + 4, rd * 0.5);
    c.strokeStyle = "rgba(0,0,0,0.15)"; c.lineWidth = 0.8;
    for (let yy = ry + 4; yy < ry + rd; yy += 4) { c.beginPath(); c.moveTo(x - 2, yy); c.lineTo(x + w + 2, yy); c.stroke(); }
    line(c, x - 2, ry + rd * 0.5, x + w + 2, ry + rd * 0.5, shade(S.roof, 0.25), 1.2);
  } else if (S.kind === "flat") {
    c.fillStyle = S.roof; c.fillRect(x, ry, w, rd);
    c.strokeStyle = shade(S.roof, -0.15); c.lineWidth = 2; c.strokeRect(x + 1, ry + 1, w - 2, rd - 2);
    c.fillStyle = S.beam; for (let k = x + 4; k < x + w; k += 7) c.fillRect(k, fy - h - 2, 2, 3);
  } else if (S.kind === "saw") {
    c.fillStyle = S.roofD; c.fillRect(x, ry, w, rd);
    c.fillStyle = S.roof; for (let yy = ry; yy < ry + rd - 2; yy += 7) { c.beginPath(); c.moveTo(x, yy + 7); c.lineTo(x + w, yy + 7); c.lineTo(x + w, yy + 2); c.lineTo(x, yy); c.fill(); }
  } else if (S.kind === "modern") {
    c.fillStyle = S.roof; c.fillRect(x, ry, w, rd); c.strokeStyle = S.roofD; c.lineWidth = 2; c.strokeRect(x + 1, ry + 1, w - 2, rd - 2);
    fillRR(c, x + w * 0.2, ry + rd * 0.3, 7, 5, 1, "#c8ccd0"); fillRR(c, x + w * 0.6, ry + rd * 0.45, 6, 6, 1, "#a8acb0");
  } else if (S.kind === "panel") {
    fillRR(c, x, ry, w, rd, 4, S.roof); c.fillStyle = S.roofD; c.fillRect(x + 3, ry + rd * 0.5, w - 6, 1.5);
    c.fillStyle = hexA(S.glass, 0.6); c.fillRect(x + w * 0.15, ry + rd * 0.2, w * 0.3, rd * 0.2);
  } else if (S.kind === "dome") {
    c.fillStyle = S.roofD; c.fillRect(x, ry + rd * 0.3, w, rd * 0.7);
    const g = c.createRadialGradient(x + w * 0.4, ry + rd * 0.25, 2, x + w / 2, ry + rd * 0.5, Math.max(w, rd) * 0.6);
    g.addColorStop(0, shade(S.roof, 0.35)); g.addColorStop(1, S.roofD);
    c.fillStyle = g; c.beginPath(); c.ellipse(x + w / 2, ry + rd * 0.5, w / 2, rd * 0.55, 0, 0, 6.3); c.fill();
    c.strokeStyle = hexA(S.glow, 0.85); c.lineWidth = 1.3; c.beginPath(); c.ellipse(x + w / 2, ry + rd * 0.55, w * 0.42, rd * 0.38, 0, 0, 6.3); c.stroke();
  } else if (S.kind === "crystal") {
    c.fillStyle = S.roofD; c.fillRect(x, ry + rd * 0.4, w, rd * 0.6);
    c.fillStyle = S.roof; c.beginPath(); c.moveTo(x, ry + rd * 0.5); c.lineTo(x + w / 2, ry - rd * 0.4); c.lineTo(x + w, ry + rd * 0.5); c.lineTo(x + w / 2, ry + rd); c.closePath(); c.fill();
    c.fillStyle = hexA("#ffffff", 0.35); c.beginPath(); c.moveTo(x + w * 0.2, ry + rd * 0.4); c.lineTo(x + w / 2, ry - rd * 0.3); c.lineTo(x + w * 0.48, ry + rd * 0.5); c.fill();
    glow(c, x + w / 2, ry - rd * 0.3, 10, S.glow, 0.6);
  }
  if (S.crenel || o.tower) { c.fillStyle = shade(S.wall, -0.05); for (let k = x; k < x + w - 2; k += 6) c.fillRect(k, ry - 3, 3.5, 4); }
  if (o.chimney) chimney(c, x + w * 0.75, ry + 2, e, false);
  if (o.cupola) { const g = c.createRadialGradient(x + w / 2 - 3, ry - 4, 1, x + w / 2, ry, 12); g.addColorStop(0, shade(S.roof, 0.4)); g.addColorStop(1, S.roofD); c.fillStyle = g; c.beginPath(); c.ellipse(x + w / 2, ry + rd * 0.35, 11, 9, 0, 3.14, 6.28); c.fill(); }
  if (o.flag) { line(c, x + w / 2, ry, x + w / 2, ry - 22, "#6a6a6a", 1.4); c.fillStyle = T.main; c.beginPath(); c.moveTo(x + w / 2, ry - 22); c.lineTo(x + w / 2 + 12, ry - 19); c.lineTo(x + w / 2, ry - 15); c.fill(); }
  if (o.banner) { c.fillStyle = T.main; c.fillRect(x + w - 9, fy - h + 2, 6, Math.min(16, h - 4)); c.fillStyle = T.light; c.fillRect(x + w - 7.5, fy - h + 5, 3, 3); }
}
function hut(c, x, y, w, h, S, T, flag) {
  c.fillStyle = "rgba(0,0,0,0.25)"; c.beginPath(); c.ellipse(x + 4, y + 2, w * 0.55, w * 0.25, 0, 0, 6.3); c.fill();
  c.fillStyle = S.wallD; c.beginPath(); c.ellipse(x, y, w / 2, w * 0.22, 0, 0, 3.14); c.lineTo(x - w / 2, y - h * 0.35); c.lineTo(x + w / 2, y - h * 0.35); c.fill();
  c.fillStyle = "#3a2a1c"; c.fillRect(x - 3, y - 8, 6, 8);
  const g = c.createLinearGradient(x - w / 2, 0, x + w / 2, 0); g.addColorStop(0, shade(S.roof, 0.2)); g.addColorStop(1, S.roofD);
  c.fillStyle = g; c.beginPath(); c.moveTo(x - w / 2 - 3, y - h * 0.35); c.quadraticCurveTo(x, y - h * 0.2, x + w / 2 + 3, y - h * 0.35); c.lineTo(x, y - h * 1.1); c.closePath(); c.fill();
  c.strokeStyle = "rgba(80,60,20,0.35)"; c.lineWidth = 0.7; for (let k = -3; k <= 3; k++) { c.beginPath(); c.moveTo(x, y - h * 1.1); c.lineTo(x + k * w / 7, y - h * 0.32); c.stroke(); }
  if (flag) { line(c, x, y - h * 1.1, x, y - h * 1.1 - 10, "#5a3c20", 1.2); c.fillStyle = T.main; c.beginPath(); c.moveTo(x, y - h * 1.1 - 10); c.lineTo(x + 8, y - h * 1.1 - 8); c.lineTo(x, y - h * 1.1 - 5); c.fill(); }
}
function shed(c, x, y, w, d, h, S, T) {
  c.fillStyle = S.wallD; c.fillRect(x, y + d - h, 2.5, h); c.fillRect(x + w - 2.5, y + d - h, 2.5, h);
  c.fillStyle = "rgba(0,0,0,0.3)"; c.fillRect(x + 2.5, y + d - h, w - 5, h);
  c.fillStyle = S.roof; c.fillRect(x - 2, y - h, w + 4, d * 0.55); c.fillStyle = S.roofD; c.fillRect(x - 2, y - h + d * 0.55, w + 4, d * 0.2);
  c.fillStyle = T.main; c.fillRect(x + 2, y - h + 2, 4, 6);
}
function fire(c, x, y) {
  c.fillStyle = "#3a2a1c"; for (let k = 0; k < 4; k++) { c.save(); c.translate(x, y); c.rotate(k * 0.8); c.fillRect(-5, -1, 10, 2); c.restore(); }
  glow(c, x, y - 3, 7, "#ff9a3c", 0.85); circle(c, x, y - 3, 2, "#ffe7a0");
}
function palisade(c, x, y, w, h, e) {
  const col = (e || 0) <= 1 ? "#7a5634" : (e || 0) <= 4 ? "#8a8478" : "#7c8084";
  c.strokeStyle = col; c.lineWidth = 3;
  c.beginPath(); c.rect(x + 2, y + 2, w - 4, h - 4); c.stroke();
  c.fillStyle = shade(col, 0.2);
  for (let k = x + 2; k < x + w - 2; k += 5) { c.beginPath(); c.moveTo(k - 2, y + 2); c.lineTo(k, y - 3); c.lineTo(k + 2, y + 2); c.fill(); }
}
function dummy(c, x, y) { line(c, x, y + 4, x, y - 10, "#6b4a2a", 1.6); line(c, x - 5, y - 6, x + 5, y - 6, "#6b4a2a", 1.4); circle(c, x, y - 12, 3, "#c8a868"); }
function rack(c, x, y, e) { line(c, x - 6, y + 6, x - 6, y - 6, "#6b4a2a", 1.4); line(c, x + 6, y + 6, x + 6, y - 6, "#6b4a2a", 1.4); for (let k = -4; k <= 4; k += 3) line(c, x + k, y + 5, x + k + 1, y - 10, e >= 4 ? "#333" : "#c7ccd2", 1); }
function logs(c, x, y, e) { for (let r = 0; r < 3; r++) for (let k = 0; k < 3 - r; k++) { const lx = x - 8 + k * 7 + r * 3.5, ly = y - r * 5.5; fillRR(c, lx - 10, ly - 3, 14, 6, 3, "#8a6236"); circle(c, lx + 3, ly, 2.8, "#d8b880"); circle(c, lx + 3, ly, 1.2, "#a8804c"); } }
function ore(c, x, y) { const P = [[-6, 2, 6], [4, 3, 5], [0, -4, 6], [8, -3, 4]]; for (const [dx, dy, r] of P) { circle(c, x + dx, y + dy, r, "#7a756e"); circle(c, x + dx - r * 0.3, y + dy - r * 0.3, r * 0.4, "#9a958e"); } circle(c, x - 2, y - 1, 1.6, "#f4d03f"); circle(c, x + 6, y + 1, 1.3, "#f4d03f"); }
function cart(c, x, y) { line(c, x - 14, y + 3, x + 14, y + 3, "#555", 1); fillRR(c, x - 6, y - 5, 12, 7, 1.5, "#6b4a2a"); circle(c, x - 4, y + 3, 2, "#333"); circle(c, x + 4, y + 3, 2, "#333"); circle(c, x, y - 5, 2.5, "#f4d03f"); }
function chimney(c, x, y, e, hot) {
  const big = e >= 5;
  fillRR(c, x - (big ? 4 : 3), y - (big ? 26 : 12), big ? 8 : 6, big ? 28 : 14, 1, e >= 5 ? "#7c3a2a" : "#6a6058");
  if (hot) glow(c, x, y - (big ? 26 : 12), 7, "#ff9a3c", 0.7);
}
function standing(c, x, y, S) { fillRR(c, x - 3, y - 12, 6, 14, 1.5, "#8a8478"); c.fillStyle = "#a8a298"; c.fillRect(x - 3, y - 12, 6, 3); }
function fence(c, x, y, w, h, e) { c.strokeStyle = e >= 5 ? "#8c9094" : "#7a5634"; c.lineWidth = 1.4; c.strokeRect(x, y, w, h); for (let k = x; k <= x + w; k += 6) line(c, k, y + h, k, y + h - 5, c.strokeStyle, 1.4); }
function crane(c, x, y, e) { const col = e >= 5 ? "#d8a83a" : "#6b4a2a"; line(c, x, y, x, y - 40, col, 2.2); line(c, x, y - 40, x - 22, y - 36, col, 1.8); line(c, x - 20, y - 36, x - 20, y - 20, "#888", 0.7); if (e <= 4) { c.strokeStyle = "#6b4a2a"; c.lineWidth = 1.5; c.beginPath(); c.arc(x - 8, y - 6, 6, 0, 6.3); c.stroke(); for (let k = 0; k < 6; k++) { const a = k * 1.05; line(c, x - 8, y - 6, x - 8 + Math.cos(a) * 6, y - 6 + Math.sin(a) * 6, "#6b4a2a", 0.8); } } }
function hangar(c, x, y, w, d, S, T, e) {
  const g = c.createLinearGradient(0, y, 0, y + d); g.addColorStop(0, shade(S.roof, 0.3)); g.addColorStop(1, S.roofD);
  c.fillStyle = g; c.beginPath(); c.moveTo(x, y + d); c.quadraticCurveTo(x, y - 10, x + w / 2, y - 12); c.quadraticCurveTo(x + w, y - 10, x + w, y + d); c.fill();
  c.fillStyle = "#2a2e34"; c.fillRect(x + w * 0.25, y + d - 14, w * 0.5, 14); c.fillStyle = T.main; c.fillRect(x + 4, y + d - 6, 6, 4);
}
function obelisk(c, x, y, e, S, T, h) {
  if (e === 0) { fillRR(c, x - 6, y - 26, 12, 28, 4, "#8a8478"); c.fillStyle = "#c8a868"; c.beginPath(); c.arc(x, y - 16, 3, 0, 6.3); c.fill(); return; }
  if (e <= 4) { c.fillStyle = S.wall; c.fillRect(x - 6, y - 4, 12, 6); c.fillStyle = shade(S.wall, 0.1); c.beginPath(); c.moveTo(x - 4, y - 4); c.lineTo(x - 2.5, y - h - 14); c.lineTo(x + 2.5, y - h - 14); c.lineTo(x + 4, y - 4); c.fill(); c.fillStyle = T.main; c.fillRect(x - 1.5, y - h, 3, 8); return; }
  c.fillStyle = S.wallD; c.fillRect(x - 6, y - 4, 12, 6);
  c.fillStyle = S.roof; c.beginPath(); c.moveTo(x - 5, y - 6); c.lineTo(x, y - h - 20); c.lineTo(x + 5, y - 6); c.fill();
  glow(c, x, y - h - 10, 10, S.glow || energy(e), 0.7);
}
function tower(c, W, H, e, S, T, h) {
  const cx = W / 2, fy = H - 6;
  if (e === 0) {          // a post on stilts
    for (const dx of [-9, 9]) line(c, cx + dx, fy, cx + dx * 0.6, fy - h * 0.75, "#5a3c20", 2.4);
    line(c, cx - 9, fy - 10, cx + 9, fy - 24, "#5a3c20", 1.2);
    fillRR(c, cx - 13, fy - h * 0.82, 26, 7, 1, "#7a5634"); hutRoof(c, cx, fy - h * 0.82, 30, 18, S); return;
  }
  if (e <= 3) {           // a round tower, wood then stone
    const col = e === 1 ? "#8a6236" : S.wall;
    const g = c.createLinearGradient(cx - 11, 0, cx + 11, 0); g.addColorStop(0, shade(col, 0.15)); g.addColorStop(1, shade(col, -0.3));
    c.fillStyle = g; c.fillRect(cx - 11, fy - h, 22, h);
    c.fillStyle = "#2a2420"; c.fillRect(cx - 2, fy - h * 0.6, 4, 7);
    if (e === 3) { c.fillStyle = shade(col, 0.1); for (let k = -12; k < 12; k += 6) c.fillRect(cx + k, fy - h - 4, 4, 5); }
    c.fillStyle = e === 3 ? S.roof : "#8a6236"; c.beginPath(); c.moveTo(cx - 15, fy - h - (e === 3 ? 3 : 0)); c.lineTo(cx, fy - h - 26); c.lineTo(cx + 15, fy - h - (e === 3 ? 3 : 0)); c.fill();
    line(c, cx, fy - h - 26, cx, fy - h - 34, "#555", 1); c.fillStyle = T.main; c.beginPath(); c.moveTo(cx, fy - h - 34); c.lineTo(cx + 8, fy - h - 32); c.lineTo(cx, fy - h - 30); c.fill();
    return;
  }
  if (e === 4) { fillRR(c, cx - 16, fy - h * 0.6, 32, h * 0.6, 4, S.wall); c.fillStyle = S.roofD; c.fillRect(cx - 16, fy - h * 0.6, 32, 5); fillRR(c, cx - 3, fy - h * 0.6 - 6, 18, 6, 3, "#2d2f33"); c.fillStyle = T.main; c.fillRect(cx - 14, fy - 12, 5, 8); return; }
  if (e === 5) { fillRR(c, cx - 18, fy - 22, 36, 22, 8, "#8a8a7a"); c.fillStyle = "#1c1c1c"; c.fillRect(cx - 12, fy - 15, 24, 3); c.fillStyle = T.main; c.fillRect(cx - 4, fy - 6, 8, 4); return; }
  if (e === 6) { fillRR(c, cx - 14, fy - 20, 28, 20, 3, S.wall); fillRR(c, cx - 10, fy - 34, 20, 14, 2, "#5d6b44"); for (let k = 0; k < 2; k++) for (let j = 0; j < 2; j++) circle(c, cx - 4 + k * 8, fy - 30 + j * 6, 2, "#1d2216"); c.fillStyle = T.main; c.fillRect(cx - 14, fy - 6, 28, 3); return; }
  if (e === 7) { fillRR(c, cx - 8, fy - h, 16, h, 6, S.wall); c.fillStyle = S.glass; c.fillRect(cx - 8, fy - h * 0.55, 16, 3); circle(c, cx, fy - h - 4, 7, "#d3dbe3"); glow(c, cx, fy - h - 4, 9, "#62e8ff", 0.8); c.fillStyle = T.main; c.fillRect(cx - 8, fy - 10, 16, 3); return; }
  if (e === 8) { c.fillStyle = S.wall; c.beginPath(); c.moveTo(cx - 10, fy); c.lineTo(cx - 3, fy - h - 16); c.lineTo(cx + 3, fy - h - 16); c.lineTo(cx + 10, fy); c.fill(); for (let k = 0; k < 3; k++) { c.strokeStyle = hexA(S.glow, 0.8); c.lineWidth = 1.2; c.beginPath(); c.ellipse(cx, fy - h * (0.3 + k * 0.28), 9 - k * 2, 3, 0, 0, 6.3); c.stroke(); } glow(c, cx, fy - h - 16, 10, S.glow, 0.9); return; }
  c.fillStyle = S.wallD; c.beginPath(); c.ellipse(cx, fy - 4, 14, 5, 0, 0, 6.3); c.fill();
  c.fillStyle = S.roof; c.beginPath(); c.moveTo(cx, fy - h - 20); c.lineTo(cx + 9, fy - h * 0.6); c.lineTo(cx, fy - h * 0.25); c.lineTo(cx - 9, fy - h * 0.6); c.closePath(); c.fill();
  glow(c, cx, fy - h * 0.6, 18, S.glow, 0.55);
}
function hutRoof(c, x, y, w, h, S) { c.fillStyle = S.roof; c.beginPath(); c.moveTo(x - w / 2, y); c.lineTo(x, y - h); c.lineTo(x + w / 2, y); c.fill(); }

/** Walls are drawn tile by tile, joined to their neighbours. */
export function drawWall(ctx, tx, ty, era, team, n) {
  const S = style(Math.max(0, Math.min(9, era)), team), x = tx * 32, y = ty * 32, h = 14 + era * 0.6;
  const col = era === 0 ? "#7a5634" : S.wall, colD = era === 0 ? "#5a3c20" : S.wallD;
  const x0 = x + (n.w ? 0 : 6), x1 = x + 32 - (n.e ? 0 : 6), y0 = y + (n.n ? 0 : 8), y1 = y + 32 - (n.s ? 0 : 6);
  if (era >= 7) {
    ctx.fillStyle = hexA(era === 7 ? "#62e8ff" : S.glow || "#8da7ff", 0.35); ctx.fillRect(x0, y0 - h, x1 - x0, y1 - y0);
    ctx.strokeStyle = hexA(era === 7 ? "#62e8ff" : S.glow || "#8da7ff", 0.9); ctx.lineWidth = 1.2; ctx.strokeRect(x0, y0 - h, x1 - x0, y1 - y0 + h);
    return;
  }
  ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.fillRect(x0 + 3, y1 - 2, x1 - x0, 5);
  ctx.fillStyle = colD; ctx.fillRect(x0, y1 - h, x1 - x0, h);
  ctx.fillStyle = col; ctx.fillRect(x0, y0 - h, x1 - x0, y1 - y0);
  if (era === 0) { ctx.fillStyle = shade(col, 0.15); for (let k = x0; k < x1; k += 5) { ctx.beginPath(); ctx.moveTo(k, y0 - h); ctx.lineTo(k + 2.5, y0 - h - 5); ctx.lineTo(k + 5, y0 - h); ctx.fill(); } }
  else if (era >= 2 && era <= 4) { ctx.fillStyle = shade(col, 0.12); for (let k = x0; k < x1 - 2; k += 7) ctx.fillRect(k, y0 - h - 4, 4, 4); }
  ctx.strokeStyle = "rgba(0,0,0,0.15)"; ctx.lineWidth = 0.8; ctx.strokeRect(x0 + 0.5, y0 - h + 0.5, x1 - x0 - 1, y1 - y0 - 1);
}

/* =========================================================================
   Nodes
   ========================================================================= */
export function nodeSprite(n, k) {
  const q = n.type === "gold" || n.type === "stone" ? Math.max(1, Math.min(3, Math.ceil(k * 3))) : 3;
  const key = "n|" + n.type + "|" + q;
  const W = n.w * 32, H = n.h * 32;
  return cached(key, W + 20, H + 50, 10, 40, (c) => node(c, n.type, W, H, q));
}
function node(c, type, W, H, q) {
  const cx = W / 2, cy = H / 2;
  if (type === "gold") {
    c.fillStyle = "rgba(0,0,0,0.3)"; c.beginPath(); c.ellipse(cx + 5, cy + 10, W * 0.45, H * 0.3, 0, 0, 6.3); c.fill();
    const s = 0.6 + q * 0.14;
    const P = [[-16, 6, 14], [12, 8, 13], [0, -6, 18], [-6, 14, 10], [18, -6, 9]];
    for (const [dx, dy, r] of P) {
      const g = c.createRadialGradient(cx + dx * s - r * 0.4, cy + dy * s - r * 0.5, 1, cx + dx * s, cy + dy * s, r * s);
      g.addColorStop(0, "#a49a8e"); g.addColorStop(1, "#5c554d");
      c.fillStyle = g; c.beginPath(); c.arc(cx + dx * s, cy + dy * s, r * s, 0, 6.3); c.fill();
    }
    c.fillStyle = "#2a2420"; c.beginPath(); c.ellipse(cx, cy + 6 * s, 7, 6, 0, 3.14, 6.28); c.lineTo(cx + 7, cy + 10 * s); c.lineTo(cx - 7, cy + 10 * s); c.fill();
    for (let i = 0; i < 9; i++) { const a = i * 2.4, r = 6 + (i * 7) % 16; circle(c, cx + Math.cos(a) * r * s, cy - 2 + Math.sin(a) * r * 0.7 * s, 1.8, "#f4d03f"); }
    glow(c, cx - 6, cy - 8, 6, "#ffe680", 0.6);
  } else if (type === "stone") {
    c.fillStyle = "rgba(0,0,0,0.3)"; c.beginPath(); c.ellipse(cx + 4, cy + 8, W * 0.45, H * 0.3, 0, 0, 6.3); c.fill();
    const s = 0.6 + q * 0.14;
    for (const [dx, dy, r] of [[-9, 4, 11], [8, 6, 10], [0, -7, 12], [10, -6, 7]]) {
      c.fillStyle = "#8e9196"; c.beginPath(); c.moveTo(cx + (dx - r) * s, cy + (dy + r * 0.6) * s); c.lineTo(cx + (dx - r * 0.6) * s, cy + (dy - r) * s); c.lineTo(cx + (dx + r * 0.7) * s, cy + (dy - r * 0.8) * s); c.lineTo(cx + (dx + r) * s, cy + (dy + r * 0.6) * s); c.closePath(); c.fill();
      c.fillStyle = "#b6b9be"; c.beginPath(); c.moveTo(cx + (dx - r * 0.6) * s, cy + (dy - r) * s); c.lineTo(cx + (dx + r * 0.7) * s, cy + (dy - r * 0.8) * s); c.lineTo(cx + dx * s, cy + dy * s); c.fill();
    }
  } else if (type === "oil") {
    c.fillStyle = "#0c0a0c"; c.beginPath(); c.ellipse(cx, cy + 4, W * 0.42, H * 0.3, 0, 0, 6.3); c.fill();
    const g = c.createLinearGradient(cx - 20, cy, cx + 20, cy + 8); g.addColorStop(0, "rgba(120,60,200,0.35)"); g.addColorStop(0.5, "rgba(60,200,180,0.25)"); g.addColorStop(1, "rgba(220,180,60,0.3)");
    c.fillStyle = g; c.beginPath(); c.ellipse(cx - 2, cy + 2, W * 0.3, H * 0.16, 0.2, 0, 6.3); c.fill();
  } else if (type === "aether") {
    glow(c, cx, cy, 30, "#d38bff", 0.45);
    for (const [dx, dy, hh, r] of [[0, 0, 30, 6], [-9, 6, 18, 4], [10, 5, 22, 5], [3, 10, 12, 3.5]]) {
      c.fillStyle = "#e8d4ff"; c.beginPath(); c.moveTo(cx + dx - r, cy + dy); c.lineTo(cx + dx, cy + dy - hh); c.lineTo(cx + dx + r, cy + dy); c.lineTo(cx + dx, cy + dy + r * 0.8); c.closePath(); c.fill();
      c.fillStyle = "#a56cf0"; c.beginPath(); c.moveTo(cx + dx, cy + dy - hh); c.lineTo(cx + dx + r, cy + dy); c.lineTo(cx + dx, cy + dy + r * 0.8); c.fill();
    }
  } else if (type === "relic") {
    c.fillStyle = "rgba(90,96,80,0.5)"; c.beginPath(); c.ellipse(cx, cy + 4, W * 0.46, H * 0.36, 0, 0, 6.3); c.fill();
    for (let k = 0; k < 6; k++) {
      const a = k / 6 * 6.28, x = cx + Math.cos(a) * W * 0.34, y = cy + Math.sin(a) * H * 0.26, h = k % 2 ? 8 : 18;
      fillRR(c, x - 3, y - h, 6, h + 2, 1.5, "#9a968a"); c.fillStyle = "#6a8048"; c.fillRect(x - 3, y - h, 6, 2.5);
    }
    c.strokeStyle = hexA("#9fe8d0", 0.7); c.lineWidth = 1; c.beginPath(); c.arc(cx, cy + 2, 6, 0, 6.3); c.moveTo(cx - 4, cy + 2); c.lineTo(cx + 4, cy + 2); c.stroke();
    glow(c, cx, cy + 2, 10, "#9fe8d0", 0.35);
  }
}

/** A small picture of a unit or building for the HUD, as a data URL. */
const portraits = new Map();
export function portrait(kind, id, era, team, hero) {
  const key = kind + "|" + id + "|" + era + "|" + team + "|" + (hero || "");
  let p = portraits.get(key);
  if (p) return p;
  const size = 64, c = mk(size, size), x = c.getContext("2d");
  if (kind === "unit") {
    const s = unitSprite({ line: id, tier: era, team, hero }, 6);
    const k = Math.min(size / s.w, size / s.h) * (hero ? 1.25 : rotates(id, era) ? 1.1 : 1.5);
    x.translate(size / 2, size * (rotates(id, era) ? 0.5 : 0.62)); x.scale(k, k);
    x.drawImage(s.c, -s.ox, -s.oy, s.w, s.h);
  } else {
    const d = { type: id, w: 2, h: 2, team };
    const big = { hall: 4, barracks: 3, forge: 3, outpost: 3, altar: 3, academy: 3, stable: 3, workshop: 3, shipyard: 3, airfield: 4, beacon: 5 }[id] || 2;
    d.w = d.h = id === "wall" ? 1 : big;
    const s = buildingSprite(d, era);
    // fit the footprint and the height above it, whichever is the tighter
    const tall = (HEIGHT[id] || 20) * (1 + era * 0.04) + 24;
    const k = Math.min(size * 0.92 / (d.w * 32), size * 0.92 / (d.h * 32 + tall));
    x.translate(size / 2 - d.w * 16 * k, size * 0.96 - d.h * 32 * k); x.scale(k, k);
    if (id === "wall") { drawWall(x, 0, 0, era, team, { n: 0, s: 0, e: 0, w: 0 }); }
    else x.drawImage(s.c, -s.ox, -s.oy, s.w, s.h);
  }
  p = c.toDataURL ? c.toDataURL() : "";
  portraits.set(key, p);
  return p;
}
