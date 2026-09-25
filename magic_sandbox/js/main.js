/* main.js — boot, and the one loop everything runs in.
 *
 * Order of a frame: read input, advance the game (unless a screen has
 * paused it), move the camera, advance effects, update the HUD, render.
 * Two small time tricks sit on top: hit-stop (a few frozen frames when
 * something big dies) and slow motion (a Warden's last breath). Both are
 * measured in real time so they can never stretch a pause. */

import { S, on, online } from "./state.js";
import * as gfx from "./gfx.js";
import * as fx from "./fx.js";
import { loadAssets } from "./models.js";
import { buildWorld } from "./world.js";
import { THEMES } from "./themes.js";
import * as game from "./game.js";
import * as hud from "./hud.js";
import * as forge from "./forge.js";
import * as menus from "./menus.js";
import * as info from "./info.js";
import * as update from "./update.js";
import * as net from "./net.js";
import * as mpui from "./mpui.js";
import * as lobby from "./lobby.js";
import * as audio from "./audio.js";
import { initInput, poll, device } from "./input.js";
import { save } from "./save.js";
import { dist } from "./util.js";

const $ = (id) => document.getElementById(id);

/* ---------------------------------------------------------------
   The title backdrop: an island, slowly circled
   --------------------------------------------------------------- */
let titleAng = 0;
function titleScene() {
  if (S.world) { gfx.scene.remove(S.world.group); S.world.dispose(); }
  const theme = THEMES.sanctum;
  S.world = buildWorld({ floor: 1, seed: 424242, kind: "sandbox", theme });
  gfx.scene.add(S.world.group);
  gfx.applyTheme(theme);
  audio.setSong("title");
}
on("title", titleScene);

/* ---------------------------------------------------------------
   Loop
   --------------------------------------------------------------- */
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const wall = Math.min(1, Math.max(0, (now - last) / 1000));
  const real = Math.min(0.05, wall);
  last = now;
  let dt = real;
  // A room shares one clock: nobody's kill may freeze everybody's frame.
  if (online()) { S.hitstop = 0; S.slowmo = 0; }
  if (S.hitstop > 0) { S.hitstop -= real; dt = 0; }
  else if (S.slowmo > 0) { S.slowmo -= real; dt *= 0.35; }
  const input = poll();
  const P = S.player;

  if (S.mode === "title") {
    titleAng += real * 0.05;
    const r = 20;
    gfx.updateCamera(Math.cos(titleAng) * r * 0.25, Math.sin(titleAng) * r * 0.25, 0, 0, 1.25, real);
    if (S.world) S.world.update(real, now / 1000, gfx.camState.x, gfx.camState.z);
  } else if (P) {
    // The match runs on the wall clock: a slow frame must not make one mage
    // late to their own respawn, or to the room's countdown.
    if (!S.paused) { game.update(dt, input); net.update(wall); }
    // lean the camera toward where you are looking, a little more with a mouse
    let lx = 0, lz = 0;
    if (P.alive) {
      const reach = device === "mouse" ? 1.8 : device === "pad" ? 1.6 : 1.1;
      if (device === "mouse" && input.aimX !== null) {
        const dx = (input.aimX - P.x) * 0.14, dz = (input.aimZ - P.z) * 0.14, m = Math.hypot(dx, dz), k = m > reach ? reach / m : 1;
        lx = dx * k; lz = dz * k;
      } else { lx = Math.cos(P.aim) * reach; lz = Math.sin(P.aim) * reach; }
    }
    let zoom = 1;
    const B = S.boss;
    if (B && B.alive && B.state !== "sleep" && dist(B.x, B.z, P.x, P.z) < 22) zoom = B.type === "heart" ? 1.3 : 1.15;
    // down in a match: watch whoever net.js picked
    const V = !P.alive && S.view ? S.view : P;
    gfx.updateCamera(V.x, V.z, V === P ? lx : 0, V === P ? lz : 0, zoom, real);
  }
  fx.update(S.paused ? 0 : dt);
  hud.update(real);
  audio.tick();
  gfx.render(real);
}

/* ---------------------------------------------------------------
   Boot
   --------------------------------------------------------------- */
async function boot() {
  gfx.setQuality(save.settings.quality);
  gfx.watchPerformance((tier) => { if (S.mode !== "title") hud.toast("Lowered graphics to " + tier + " to keep things smooth", "gear"); });
  info.init();
  hud.init();
  forge.init();
  menus.init();
  mpui.init();
  initInput({ pause: menus.togglePause, book: menus.toggleBook });
  $("gl").addEventListener("pointerdown", (e) => { if (e.pointerType === "touch") document.body.dataset.device = "touch"; });

  await loadAssets((p) => { $("loadBar").style.width = (p * 100).toFixed(0) + "%"; });
  titleScene();
  menus.toTitle();
  requestAnimationFrame(frame);
  const L = $("loading");
  L.classList.add("gone");
  setTimeout(() => L.remove(), 600);

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").then((reg) => update.init(reg, menus.busy)).catch(() => update.init(null));
  } else update.init(null);

  // A test/debug handle, only when asked for — never exposed by default.
  if (location.hash.includes("debug") || localStorage.getItem("msandbox:debug")) {
    window.MS = { S, game, menus, forge, save, gfx, fx, hud, net, mpui, lobby };
  }
}
boot();
