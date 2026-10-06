/* orient.js — Force landscape, for phones (Settings; on by default).
 *
 * Lifted from Hacks (hacks/js/orient.js), which lifted the lock from ARCO
 * (arco/js/shell.js). Changed: the setting lives in this game's save.js, and
 * the turn is announced on this game's event bus. Everything else is Hacks'.
 *
 * Two layers, because no one of them works everywhere.
 *
 * Where the browser allows it — Android, or the game installed as an app —
 * the screen really is locked sideways: tried on its own first (an installed
 * app may lock without going fullscreen), then after fullscreen, since Chrome
 * honours a lock only in fullscreen. It needs a tap to ask, so it is asked
 * when a game starts and when the setting is turned on.
 *
 * Where it does not — iPhone Safari has neither fullscreen nor a lock, and a
 * phone whose own rotation lock is on never turns at all — the game is
 * turned instead: #app gets a quarter turn, so a phone held upright still
 * plays sideways. Its top is the phone's right-hand edge, the way a phone
 * turned to landscape normally shows it. Everything that reads where a finger
 * is goes through toApp(), so the touch controls follow the turn. */

import { emit } from "./state.js";
import { settings } from "./save.js";

let turned = false;
export const isTurned = () => turned;
const touchDevice = () => matchMedia("(pointer: coarse)").matches || ("ontouchstart" in window && navigator.maxTouchPoints > 0);

/** The game's own width and height: the screen's, swapped while turned. */
export function appSize() { return turned ? { w: window.innerHeight, h: window.innerWidth } : { w: window.innerWidth, h: window.innerHeight }; }
/** A point on the screen (clientX, clientY) as a point in the game's frame. */
export function toApp(x, y) { return turned ? { x: y, y: window.innerWidth - x } : { x, y }; }
/** A rectangle on the screen (getBoundingClientRect) in the game's frame. */
export function appRect(r) {
  if (!turned) return r;
  const W = window.innerWidth;
  return { left: r.top, right: r.bottom, top: W - r.right, bottom: W - r.left, width: r.height, height: r.width };
}

/** Turn the game, or stop turning it, to match the setting and how the phone is held. */
export function apply() {
  const want = !!settings.forceLandscape && touchDevice() && window.innerHeight > window.innerWidth;
  const root = document.documentElement.style;
  root.setProperty("--tw", window.innerHeight + "px");
  root.setProperty("--th", window.innerWidth + "px");
  if (want === turned) return;
  turned = want;
  document.body.classList.toggle("turned", turned);
  emit("turned", turned);
}

/* ---------------------------------------------------------------
   The real lock (lifted from ARCO, arco/js/shell.js)
   --------------------------------------------------------------- */
const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;
function requestFullscreen() {
  const el = document.documentElement;
  const fn = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!fn) return Promise.reject(new Error("no-fullscreen"));
  try { const r = fn.call(el, { navigationUI: "hide" }); return r && r.then ? r : Promise.resolve(); } catch (e) { return Promise.reject(e); }
}
function lockLandscape() {
  const o = screen.orientation;
  if (!o || !o.lock) return Promise.reject(new Error("no-lock"));
  try { const r = o.lock("landscape"); return r && r.then ? r : Promise.resolve(); } catch (e) { return Promise.reject(e); }
}
/** Ask for the real lock. Call it from a tap: browsers refuse fullscreen without one. */
export function lock() {
  if (!settings.forceLandscape || !touchDevice()) return Promise.resolve(false);
  return lockLandscape()
    .catch(() => (fsElement() ? Promise.reject(new Error("refused")) : requestFullscreen().then(lockLandscape)))
    .then(() => true, () => false)
    .then((ok) => { apply(); return ok; });
}
export function unlock() {
  try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch (e) { /* nothing locked */ }
  apply();
}

export function init() {
  addEventListener("resize", apply);
  // some phones report the new size a beat after the turn
  addEventListener("orientationchange", () => setTimeout(apply, 250));
  apply();
}
