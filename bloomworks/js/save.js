/* save.js — one save, in this browser's localStorage, and as a text code.
 *
 * S is written whole. Two things need care: L-numbers are -Infinity at zero,
 * which JSON cannot hold, so they travel as a marker string; and each copy's
 * `k` layout cache is rebuilt on load, never written. Motes in the air or on
 * a river are runtime only, so they are written down as Strays — no mote is
 * ever lost, not even to a save. */

import { S, RT, resetRuntime } from "./state.js";
import { rebuildLayout } from "./build.js";

const KEY = "bloomworks-save-v1";
const NEG = "\u0000-inf";

function replacer(key, value) {
  if (value === -Infinity) return NEG;
  if (key === "k" && value && typeof value === "object") return undefined;
  if (key === "target" || key === "claimed") return undefined;
  return value;
}
function reviver(key, value) { return value === NEG ? -Infinity : value; }

export function serialise() {
  S.savedAt = Date.now();
  S.lastPerSec = RT.rate.perSec;
  const pending = [];
  for (const f of RT.flying) pending.push({ x: f.x1, y: f.y1, m: f.m });
  for (const f of RT.floating) pending.push({ x: f.x, y: f.y, m: f.m });
  S.pending = pending;
  const out = JSON.stringify(S, replacer);
  delete S.pending;
  return out;
}

export function save() {
  try { localStorage.setItem(KEY, serialise()); return true; } catch (e) { return false; }
}

export function hasSave() { try { return !!localStorage.getItem(KEY); } catch (e) { return false; } }

function adopt(o) {
  if (!o || typeof o !== "object" || !o.meta || !o.season || !o.world || !o.eclipse) return false;
  for (const k of Object.keys(S)) delete S[k];
  Object.assign(S, o);
  resetRuntime();
  const strays = S.season.strays || (S.season.strays = []);
  for (const p of S.pending || []) strays.push({ x: p.x + 0.5, y: p.y + 0.5, m: p.m, plot: Math.floor(p.x / 10) + "," + Math.floor(p.y / 10) });
  delete S.pending;
  RT.layoutDirty = true;
  rebuildLayout();
  return true;
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return false;
    return adopt(JSON.parse(raw, reviver));
  } catch (e) { return false; }
}

export function wipe() { try { localStorage.removeItem(KEY); } catch (e) { /* nothing to wipe */ } }

/** A save as text, to keep anywhere or move to another device. */
export function exportCode() {
  return "BWSAVE1:" + btoa(unescape(encodeURIComponent(serialise())));
}
export function importCode(code) {
  const m = String(code || "").trim().match(/^BWSAVE1:([A-Za-z0-9+/=\s]+)$/);
  if (!m) return false;
  try { return adopt(JSON.parse(decodeURIComponent(escape(atob(m[1].replace(/\s+/g, "")))), reviver)); } catch (e) { return false; }
}
