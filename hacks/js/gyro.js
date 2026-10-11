/* gyro.js — aim by turning the phone (Settings, Touch, Gyro aim).
 *
 * The way mobile shooters do it: the phone's rotation rate (devicemotion's
 * rotationRate, degrees a second about the device's own axes) turns your
 * view directly, on top of the touch look. A rate, not an orientation: there
 * is no drift to correct and nothing to calibrate, the view only moves while
 * the phone does, and putting the phone down never spins you round.
 *
 * The device's axes are turned into the screen's — the screen's up for yaw,
 * its right for pitch — by how the screen is turned (screen.orientation's
 * angle), and by orient.js's quarter turn when Force landscape draws the game
 * sideways on an upright screen: then the game's top is the phone's right
 * edge, as if the phone were turned a quarter anticlockwise.
 *
 * Settings: on or off; always, or only while aiming down sights (so it fine
 * tunes a shot and leaves the rest to your thumb); how fast across and up and
 * down, separately; either axis inverted; and a steadiness floor below which
 * a hand's tremor is ignored, faded in rather than cut, so slow aiming still
 * works. It needs no permission on Android; iOS asks, once, from the tap that
 * turns it on (requestPermission must come from a gesture).
 *
 * Nothing leaves the device: the rates are read, used and dropped. */

import { S, on } from "./state.js";
import { save } from "./save.js";
import { turn, playing } from "./input.js";
import { isTurned } from "./orient.js";

let listening = false, granted = null;
let rx = 0, ry = 0, last = 0;          // rates about the screen's right and up, radians a second, smoothed
const DEG = Math.PI / 180;

export const supported = () => typeof window !== "undefined" && "DeviceMotionEvent" in window;
/** iOS keeps motion behind a permission: ask, from a tap. Resolves true if motion will arrive. */
export function ask() {
  const D = window.DeviceMotionEvent;
  if (!D) return Promise.resolve(false);
  if (typeof D.requestPermission !== "function") { granted = true; listen(); return Promise.resolve(true); }
  return D.requestPermission().then((r) => { granted = r === "granted"; if (granted) listen(); return granted; }, () => { granted = false; return false; });
}
export const permission = () => granted;

function screenAngle() {
  if (isTurned()) return 90;
  const o = screen.orientation;
  const a = o && typeof o.angle === "number" ? o.angle : typeof window.orientation === "number" ? window.orientation : 0;
  return ((a % 360) + 360) % 360;
}
function motion(e) {
  const r = e.rotationRate;
  if (!r) return;
  const s = save.settings;
  if (!s.gyro || !playing() || !S.me || !S.me.alive) { rx = ry = 0; return; }
  if (s.gyroMode === "ads" && !(S.me.arms.ads > 0.5)) { rx = ry = 0; return; }
  const now = performance.now();
  // the interval the browser says, else the time since the last one; a long gap (a stall) counts as nothing
  let dt = typeof e.interval === "number" && e.interval > 0 ? (e.interval > 1 ? e.interval / 1000 : e.interval) : (now - last) / 1000;
  last = now;
  if (!(dt > 0) || dt > 0.1) return;
  const beta = (r.beta || 0) * DEG, gamma = (r.gamma || 0) * DEG;
  const th = screenAngle() * DEG, c = Math.cos(th), sn = Math.sin(th);
  // rates about the screen's right (pitch) and up (yaw)
  let wx = beta * c - gamma * sn, wy = beta * sn + gamma * c;
  // a little smoothing, then the steadiness floor: below it, the hand's tremor fades out instead of stopping dead
  rx += (wx - rx) * 0.6; ry += (wy - ry) * 0.6;
  const floor = s.gyroDead * DEG;
  const soft = (w) => { const a = Math.abs(w); return a <= floor ? 0 : Math.sign(w) * (a - floor * floor / a); };
  const yaw = soft(ry) * dt * s.gyroX * (s.gyroInvX ? -1 : 1);
  const pitch = soft(rx) * dt * s.gyroY * (s.gyroInvY ? -1 : 1);
  if (yaw || pitch) turn(yaw, pitch);
}
function listen() {
  if (listening || !supported()) return;
  listening = true;
  addEventListener("devicemotion", motion);
}

export function init() {
  // on Android a saved "on" works straight away; on iOS the permission is asked again by the next tap in a match
  if (save.settings.gyro) {
    const D = window.DeviceMotionEvent;
    if (D && typeof D.requestPermission === "function") {
      const once = () => { removeEventListener("pointerdown", once, true); if (save.settings.gyro) ask(); };
      addEventListener("pointerdown", once, true);
    } else listen();
  }
  on("quit", () => { rx = ry = 0; });
}
