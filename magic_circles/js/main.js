/* main.js — boot, and the one loop everything runs in.
 *
 * Shape lifted from Magic Sandbox (magic_sandbox/js/main.js): read input,
 * advance the game unless a screen has paused it, move the camera, advance
 * effects, update the HUD, render. Hit-stop (a few frozen frames when a
 * Warden falls) is measured in real time so it can never stretch a pause.
 * The title is the world itself — a seed's first clearing, slowly circled,
 * with nobody in it. */

import { S, on } from "./state.js";
import * as gfx from "./gfx.js";
import * as fx from "./fx.js";
import { loadAssets, setAnisotropy as modelAniso } from "./assets.js";
import * as game from "./game.js";
import * as chunks from "./chunks.js";
import * as phys from "./physics.js";
import * as hud from "./hud.js";
import * as forge from "./forge.js";
import * as map from "./map.js";
import * as menus from "./menus.js";
import * as info from "./info.js";
import * as update from "./update.js";
import * as audio from "./audio.js";
import { tickWater, setAnisotropy as groundAniso } from "./terrain.js";
import { initInput, poll, device } from "./input.js";
import { save } from "./save.js";
import { randomSeedText } from "./world.js";

const $ = (id) => document.getElementById(id);

/* The title backdrop: somewhere new each time, circled at dusk or dawn. */
let titleAng = 0;
function titleScene() {
  game.titleWorld(save.journey ? save.journey.seed : randomSeedText());
  S.day = Math.random() < 0.5 ? 0.3 : 0.72;
  gfx.setDay(S.day);
  gfx.snapCamera(0, 0);
  audio.setSong("title");
}
on("title", titleScene);

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const real = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  let dt = real;
  if (S.hitstop > 0) { S.hitstop -= real; dt = 0; }
  const input = poll();
  const P = S.player;
  if (S.mode === "title") {
    titleAng += real * 0.04;
    gfx.updateCamera(Math.cos(titleAng) * 9, Math.sin(titleAng) * 9, 0, 0, 1.3, real);
    chunks.update(gfx.camState.x, gfx.camState.z, real);
  } else if (P) {
    if (!S.paused) game.update(dt, input);
    let lx = 0, lz = 0;
    if (P.alive) {
      const reach = device === "mouse" ? 2.2 : device === "pad" ? 1.8 : 1.2;
      if (device === "mouse" && input.aimX !== null) {
        const dx = (input.aimX - P.x) * 0.16, dz = (input.aimZ - P.z) * 0.16, m = Math.hypot(dx, dz), k = m > reach ? reach / m : 1;
        lx = dx * k; lz = dz * k;
      } else { lx = Math.cos(P.aim) * reach; lz = Math.sin(P.aim) * reach; }
    }
    const B = S.boss;
    const zoom = B && B.alive && !B.dormant ? 1.18 : 1;
    gfx.updateCamera(P.x, P.z, lx, lz, zoom, real);
  }
  tickWater(now / 1000);
  fx.update(S.paused ? 0 : dt);
  hud.update(real);
  audio.tick();
  gfx.render(real);
}

async function boot() {
  // A new tier reaches past the renderer: the world round you is built again
  // to its reach and ground cover, and every texture takes its sharpness.
  gfx.onTier(() => {
    const a = gfx.tierSpec().aniso;
    modelAniso(a); groundAniso(a);
    const P = S.player;
    if (S.mode === "play" && P) chunks.rebuild(P.x, P.z);
    else if (S.mode === "title") chunks.rebuild(gfx.camState.x, gfx.camState.z);
  });
  gfx.setQuality(save.settings.quality);
  gfx.watchPerformance((tier) => { if (S.mode !== "title") hud.toast("Graphics lowered to " + gfx.TIER_NAMES[tier] + " to keep things smooth", "gear"); });
  info.init();
  hud.init();
  forge.init();
  map.init();
  menus.init();
  initInput({ pause: menus.togglePause, book: menus.toggleBook, map: menus.toggleMap });

  await loadAssets((p) => { $("loadBar").style.width = (p * 100).toFixed(0) + "%"; });
  menus.toTitle();      // which raises the title's world (on "title" above)
  requestAnimationFrame(frame);
  const L = $("loading");
  L.classList.add("gone");
  setTimeout(() => L.remove(), 600);

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").then((reg) => update.init(reg, menus.busy)).catch(() => update.init(null));
  } else update.init(null);

  // A test/debug handle, only when asked for — never exposed by default.
  if (location.hash.includes("debug") || localStorage.getItem("mcircles:debug")) {
    window.MC = { S, game, menus, forge, map, save, gfx, fx, hud, chunks, phys };
  }
}
boot();
