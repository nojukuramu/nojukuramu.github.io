/* input.js — keys, mouse and wheel in; one command per tick out.
 *
 * Every action is looked up through the player's binds (controls.js, stored
 * by save.js), two per action, so nothing about the keyboard is hard-coded
 * but Escape — which always opens the menu, because a player must always
 * have a way out that no bind can take away.
 *
 * The mouse turns your view directly (Source's m_yaw 0.022 degrees per
 * count, times your sensitivity), and the view is what each tick's command
 * carries. The wheel produces presses one tick long with a released tick
 * between them, so a wheel bound to jump is a fresh press every notch — the
 * way Source players bunny hop by hand.
 *
 * Touch (touch.js) feeds the same command through `touchState`. */

import { S, emit } from "./state.js";
import { save } from "./save.js";
import { ACTIONS } from "./controls.js";
import { B } from "./movement.js";
import { clamp } from "./util.js";

const down = new Set();              // codes held right now
const edges = new Set();             // actions pressed since the last command
let wheelQueue = [];                 // actions, one press per notch
let wheelNow = null, wheelGap = false;
let sprintOn = false, crouchOn = false;
let capture = null;                  // the settings screen, waiting for a key
export const touchState = { fwd: 0, side: 0, held: new Set(), taps: new Set() };

const actionFor = (code) => { const out = []; const b = save.data.binds; for (const a of ACTIONS) if (b[a.id] && (b[a.id][0] === code || b[a.id][1] === code)) out.push(a.id); return out; };
function held(action) {
  const b = save.data.binds[action];
  if (!b) return false;
  return (b[0] && down.has(b[0])) || (b[1] && down.has(b[1])) || touchState.held.has(action) || wheelNow === action;
}

export const locked = () => document.pointerLockElement === document.getElementById("gl");
export function lock() {
  const c = document.getElementById("gl");
  if (!c.requestPointerLock || locked()) return;
  try { const p = c.requestPointerLock({ unadjustedMovement: true }); if (p && p.catch) p.catch(() => { try { c.requestPointerLock(); } catch (e) {} }); } catch (e) { try { c.requestPointerLock(); } catch (e2) {} }
}
export function unlock() { if (locked()) document.exitPointerLock(); }

/** Is the game taking input right now (not a menu, not the editor)? */
export const playing = () => S.mode === "play" && !document.body.classList.contains("menuOpen") && !document.body.classList.contains("hacking");

function press(code) {
  if (capture) return;
  if (down.has(code)) return;
  down.add(code);
  if (!playing()) return;
  for (const a of actionFor(code)) {
    edges.add(a);
    if (a === "sprint" && save.settings.sprintMode === "toggle") sprintOn = !sprintOn;
    if (a === "crouch" && save.settings.crouchMode === "toggle") crouchOn = !crouchOn;
    if (a === "hacks") emit("toggleHacks");
    if (a === "score") emit("scoreboard", true);
  }
  emit("hackKey", code);
}
function release(code) {
  if (!down.delete(code)) return;
  for (const a of actionFor(code)) if (a === "score") emit("scoreboard", false);
}

/** Touch buttons press actions directly. */
export function touchPress(action) {
  if (!playing()) { if (action === "menu") emit("menu"); return; }
  edges.add(action);
  if (action === "sprint") sprintOn = !sprintOn;
  if (action === "crouch" && save.settings.crouchMode === "toggle") crouchOn = !crouchOn;
  if (action === "hacks") emit("toggleHacks");
  if (action === "menu") emit("menu");
  if (action === "score") emit("scoreboard", true);
}
export function touchRelease(action) { if (action === "score") emit("scoreboard", false); }

/* ---------------------------------------------------------------
   The command for one tick
   --------------------------------------------------------------- */
export function buildCmd() {
  // the wheel: one tick pressed, one tick released, per notch
  if (wheelGap) { wheelNow = null; wheelGap = false; }
  else if (wheelNow) { wheelNow = null; wheelGap = true; }
  else if (wheelQueue.length) { wheelNow = wheelQueue.shift(); edges.add(wheelNow); }

  const fwd = clamp((held("forward") ? 1 : 0) - (held("back") ? 1 : 0) + touchState.fwd, -1, 1);
  const side = clamp((held("right") ? 1 : 0) - (held("left") ? 1 : 0) + touchState.side, -1, 1);
  let b = 0;
  if (held("jump")) b |= B.JUMP;
  const crouch = save.settings.crouchMode === "toggle" ? crouchOn : held("crouch");
  if (crouch) b |= B.CROUCH;
  const sm = save.settings.sprintMode;
  if (sm === "auto" || (sm === "toggle" || touchState.sprintToggle ? sprintOn : held("sprint")) || touchState.autoSprint) b |= B.SPRINT;
  if (fwd <= 0) sprintOn = false;            // a toggled sprint ends when you stop running
  if (held("fire")) b |= B.FIRE;
  if (held("ads")) b |= B.ADS;
  if (held("reload")) b |= B.RELOAD;
  if (held("lunge")) b |= B.LUNGE;
  if (held("melee")) b |= B.MELEE;
  // with the blade in hand, aiming is lunging
  if (S.me && S.me.arms.cur === 2 && (b & B.ADS)) b |= B.LUNGE;
  let slot = 0;
  if (edges.has("slot1")) slot = 1;
  else if (edges.has("slot2")) slot = 2;
  else if (edges.has("slot3")) slot = 3;
  else if (edges.has("last")) slot = -1;
  else if (edges.has("next") && S.me) slot = ((S.me.arms.cur + 1) % 3) + 1;
  edges.clear();
  return { fwd, side, yaw: S.view.yaw, pitch: S.view.pitch, buttons: b, slot };
}
/** What the player is holding now, for the hack API's `input` (before any hack changes it). */
export function heldCodes() { return [...down]; }

/* ---------------------------------------------------------------
   Looking
   --------------------------------------------------------------- */
const DEG = Math.PI / 180;
export function look(dx, dy, scale) {
  const a = S.me;
  let k = save.settings.sens * 0.022 * DEG * (scale || 1);
  if (a && a.arms) {
    const zoom = S.cam.zoom || 1;
    k *= 1 + (save.settings.adsSens / zoom - 1) * a.arms.ads;
  }
  S.view.yaw -= dx * k;
  S.view.pitch = clamp(S.view.pitch - dy * k * (save.settings.invertY ? -1 : 1), -1.55, 1.55);
}

/* ---------------------------------------------------------------
   Rebinding (the settings screen)
   --------------------------------------------------------------- */
/** Resolves with a code, "" to clear, or null if cancelled. */
export function captureBind() {
  return new Promise((resolve) => { capture = resolve; });
}
function captured(code) { const r = capture; capture = null; r(code); }

/* ---------------------------------------------------------------
   Wiring
   --------------------------------------------------------------- */
export function init() {
  const gl = document.getElementById("gl");
  addEventListener("keydown", (e) => {
    if (capture) {
      e.preventDefault();
      if (e.code === "Escape") captured(null);
      else if (e.code === "Backspace") captured("");
      else captured(e.code);
      return;
    }
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
    if (e.code === "Escape") return;          // menus.js owns Escape
    if (e.repeat) { if (playing()) e.preventDefault(); return; }
    if (playing() && (e.code === "Tab" || e.code === "Space" || e.ctrlKey || e.code.startsWith("Arrow") || e.code === "Backquote")) e.preventDefault();
    press(e.code);
  });
  addEventListener("keyup", (e) => release(e.code));
  addEventListener("blur", () => { for (const c of [...down]) release(c); });
  gl.addEventListener("mousedown", (e) => {
    if (capture) return;
    if (S.mode === "play" && playing() && !locked() && !matchMedia("(pointer: coarse)").matches) { lock(); return; }
    press("Mouse" + e.button);
  });
  addEventListener("mousedown", (e) => {
    if (capture) { e.preventDefault(); captured("Mouse" + e.button); return; }
    if (e.target !== gl && locked()) press("Mouse" + e.button);
  }, true);
  addEventListener("mouseup", (e) => release("Mouse" + e.button));
  addEventListener("contextmenu", (e) => { if (S.mode === "play" && (locked() || e.target === gl)) e.preventDefault(); });
  addEventListener("mousemove", (e) => { if (locked() && playing()) look(e.movementX || 0, e.movementY || 0); });
  addEventListener("wheel", (e) => {
    const code = e.deltaY < 0 ? "WheelUp" : "WheelDown";
    if (capture) { e.preventDefault(); captured(code); return; }
    if (!locked() || !playing()) return;
    e.preventDefault();
    for (const a of actionFor(code)) if (wheelQueue.length < 6) wheelQueue.push(a);
  }, { passive: false });
  document.addEventListener("pointerlockchange", () => {
    // Escape releases the pointer before any key event arrives: that is the menu.
    if (!locked() && playing()) emit("menu");
    for (const c of [...down]) release(c);
  });
}
