/* main.js — boot, and the loop.
 *
 * Everything runs on real elapsed time, never on "a frame". The simulation
 * is paid out of that time in fixed ticks (clock.js; movement.js TICK, 64 a
 * second) and the screen is drawn between them, so the physics is identical
 * on a 30 fps phone and a 240 Hz monitor. Everything drawn per frame — the
 * camera, the gun's sway and bob, effects, the HUD — is scaled by the
 * frame's delta time. Each frame, in order:
 *
 *   1. the hacks' last reply is applied to your body and view (hackapi)
 *   2. as many ticks as the clock owes: your command (keys, touch, then the
 *      hacks on top), bots, shots, deaths
 *   3. the network sends what changed (net)
 *   4. the scene, the hack overlay and the HUD are drawn
 *   5. the hacks are told what the frame looked like, for next time */

import { S, on, emit } from "./state.js";
import { save } from "./save.js";
import { TICK } from "./movement.js";
import { makeClock } from "./clock.js";
import { cleanName } from "./modes.js";
import * as game from "./game.js";
import * as render from "./render.js";
import * as input from "./input.js";
import * as touch from "./touch.js";
import * as hud from "./hud.js";
import * as menus from "./menus.js";
import * as info from "./info.js";
import * as update from "./update.js";
import * as hackapi from "./hackapi.js";
import * as hackui from "./hackui.js";
import * as audio from "./audio.js";
import * as net from "./net.js";
import * as mpui from "./mpui.js";
import * as lobby from "./lobby.js";

if (!cleanName(save.data.name)) { save.data.name = "Player " + Math.floor(100 + Math.random() * 900); save.commit(); }

render.setQuality(save.settings.quality);
addEventListener("resize", render.resize);
info.init();
input.init();
touch.init();
hud.init();
menus.init();
hackui.init();
mpui.init();
game.setLocalCmd(() => hackapi.patch(input.buildCmd()));

/* ---------------------------------------------------------------
   Starting and leaving a match
   --------------------------------------------------------------- */
function enterMatch() {
  menus.leaveTitle();
  hud.show(true);
  touch.show(true);
  hackapi.start();
  if (!touch.isTouch()) input.lock();
}
on("startSolo", (opts) => {
  S.net.role = "solo";
  S.lastSolo = opts;
  // practice brings four dummies that wander and never shoot: something for an ESP or an aimbot to find
  // a room's "bots" fills it to that many players; alone, the slider means that many bots
  const settings = { mode: opts.mode, bots: opts.mode === "practice" ? 4 : Math.max(1, opts.bots | 0) + 1, diff: opts.diff || "normal", target: opts.target, time: opts.mode === "practice" ? 0 : 10, hacks: "full" };
  S.topSpeed = 0;
  game.startMatch(settings, { me: { id: 1, name: save.data.name, team: 0, loadout: save.data.loadout }, humans: 1 });
  enterMatch();
});
on("netMatch", enterMatch);
on("quitMatch", () => {
  game.quit();
  hud.show(false);
  touch.show(false);
  input.unlock();
  menus.toTitle();
});

/* ---------------------------------------------------------------
   The loop
   --------------------------------------------------------------- */
// up to a quarter of a second of ticks per frame: a 5 fps device still plays in real time
const clock = makeClock(TICK, 16);
let last = performance.now(), alpha = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.25, Math.max(0, (now - last) / 1000));
  last = now;
  if (S.mode === "play" && S.match) {
    hackapi.beforeTicks();
    if (!S.paused) alpha = clock.advance(dt, game.tick);
    net.update(dt);
    audio.tickSteps(dt);
    render.frame(alpha, dt);
    hackapi.drawOverlay();
    hud.update(dt);
    hackapi.afterFrame(dt);
  } else {
    render.idle(now / 1000, dt);
  }
}
requestAnimationFrame(frame);

/* ---------------------------------------------------------------
   Effects that only listen
   --------------------------------------------------------------- */
on("tracer", (a, o, h, gun) => {
  // your own tracer starts at your gun, not your eye
  const from = a === S.me ? [o[0] + Math.cos(S.view.yaw) * 0.12, o[1] - 0.12, o[2] - Math.sin(S.view.yaw) * 0.12] : [a.bones[30], a.bones[31], a.bones[32]];
  render.tracer(from, [h.x, h.y, h.z], h.actor ? 0xff9a7a : 0xffd98a);
  if (h.actor) render.burst(h.x, h.y, h.z, 6, 0xff5f5f, 3);
  else if (h.world) render.burst(h.x, h.y, h.z, 4, 0xffd070, 3);
});
on("impact", (p, h) => render.burst(h.x, h.y, h.z, h.actor ? 10 : 6, h.actor ? 0xff5f5f : 0xffe0a0, 4));
on("fired", (a, e) => { if (a === S.me) render.vmFire(a, e); });
on("arms", (a, e) => { if (a === S.me && e.type === "swing") render.vmSwing(); });
on("move", (a, ev) => {
  if (a !== S.me) return;
  if (ev === "land") render.landDip(a.body.landSpeed);
  if (ev === "pad") render.burst(a.body.x, a.body.y, a.body.z, 20, 0x6dffa0, 6);
});
on("died", (b) => { if (b.alive === false) render.burst(b.body.x, b.body.y + 1, b.body.z, 24, 0xff5f5f, 5); });
on("matchEnd", () => input.unlock());

/* ---------------------------------------------------------------
   Installable, and never stuck on an old version
   --------------------------------------------------------------- */
const busy = () => S.mode === "play" && !!S.match && !S.match.over;
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").then((reg) => update.init(reg, busy)).catch(() => update.init(null, busy));
} else update.init(null, busy);

menus.toTitle();
emit("booted");
// tools/e2e.js drives the game through this; nobody else sees it
try { if (localStorage.getItem("hacks:debug") === "1") window.HK_DEBUG = { S, game, hackapi, save, render, lobby, mpui, net }; } catch (e) { /* storage blocked */ }
