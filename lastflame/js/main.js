/* main.js — the glue: settings, the frame loop, starting and ending nights,
 * and the service worker.
 *
 * The shape is Ballzooka's (ballzooka/js/main.js). The loop steps game.js in
 * slices no longer than a 60 Hz frame, so a slow phone plays the same night
 * as a fast one, then hands the events it left to the renderer, the speakers
 * and the screen. */

import * as game from "./game.js";
import * as render from "./render.js";
import * as audio from "./audio.js";
import * as input from "./input.js";
import * as ui from "./ui.js";
import * as info from "./info.js";
import * as upd from "./update.js";
import { S, load, save } from "./save.js";
import { hydrateIcons } from "./icons.js";
import { sees } from "./nav.js";

load();
hydrateIcons();
info.init();
const canvas = document.getElementById("view");
render.init(canvas, (p) => ui.progress(p));

let g = null, paused = false, frozen = false, lastT = performance.now(), seenState = null, view = { raise: false };

function apply() {
  const s = S.set;
  render.setQuality(s.quality);
  render.setMotion(s.motion);
  render.setScares(s.scares);
  render.setFov(s.fov);
  render.setBrightness(s.bright);
  audio.setVolume(s.volume);
  audio.setScares(s.scares);
  ui.setCaptions(!!s.captions);
  input.configure({ sens: s.sens, invert: s.invert, crouchToggle: s.crouchToggle });
}
apply();
audio.setCaptions((text, dir, quiet) => ui.caption(text, dir, quiet));
audio.setOccluder((x, z) => (g ? !sees(g.G, g.player.x, g.player.z, x, z) : false));

/* ---------- nights ---------- */

function begin(seed) {
  audio.unlock();
  g = game.newRun({ seed, mode: S.set.mode, fear: S.set.fear });
  render.build(g);
  input.setLook(g.player.yaw, 0);
  input.resetCrouch();
  input.setEnabled(true);
  input.lock();
  paused = false; seenState = "play";
  S.stats.nights++; save();
  ui.hide(); ui.hud(true);
  const touch = input.touchMode() || matchMedia("(pointer: coarse)").matches;
  ui.touchControls(touch);
  document.body.classList.toggle("touch", touch);
  ui.hint(g.hint && g.hint.text, input.touchMode());
  lastT = performance.now();
}

function end() {
  input.setEnabled(false);
  input.unlock();
  ui.hud(false);
  ui.hideNote();
}

function pause() {
  if (!g || paused || g.state !== "play") return;
  paused = true;
  input.setEnabled(false);
  input.unlock();
  audio.suspend(true);
  ui.show("pause", { lit: g.lit });
}
function resume() {
  if (!paused) return;
  paused = false;
  ui.hide();
  audio.suspend(false);
  input.setEnabled(true);
  input.lock();
  lastT = performance.now();
}

ui.init({
  begin: () => begin(),
  again: () => begin(),
  resume,
  quit: () => { end(); g = null; paused = false; audio.suspend(false); audio.quietAll(); ui.show("title"); audio.title(); },
  apply,
  info: (k) => info.open(k),
  progress: () => render.progress(),
  pauseData: () => ({ lit: g ? g.lit : 0 })
});

input.init({ canvas, pause, lock: () => {} });

// on-screen buttons for touch
for (const [id, name] of [["use", "use"], ["btn-breath", "breath"], ["btn-lantern", "lantern"], ["btn-crouch", "crouch"], ["btn-raise", "raise"]]) {
  const b = document.getElementById(id);
  const down = (e) => { e.preventDefault(); audio.unlock(); input.button(name, true); };
  const up = (e) => { e.preventDefault(); input.button(name, false); };
  b.addEventListener("touchstart", down, { passive: false });
  b.addEventListener("touchend", up, { passive: false });
  b.addEventListener("touchcancel", up, { passive: false });
  b.addEventListener("mousedown", down);
  b.addEventListener("mouseup", up);
}
document.getElementById("btn-pause").addEventListener("click", () => pause());
document.addEventListener("visibilitychange", () => { if (document.hidden) { pause(); save(); } });
window.addEventListener("pagehide", () => save());
window.addEventListener("pointerdown", () => audio.unlock(), { once: true });
window.addEventListener("keydown", () => audio.unlock(), { once: true });

/* ---------- events to the screen ---------- */

function handle(evs) {
  for (const e of evs) {
    switch (e.type) {
      case "hint": ui.hint(e.text, input.touchMode()); break;
      case "note": ui.note(e.id); break;
      case "closetIn": case "closetOut": input.setLook(g.player.yaw, 0); break;
      case "respawn": input.setLook(g.player.yaw, 0); break;
      case "lampLit": S.stats.lampsLit++; break;
    }
  }
}

/* ---------- the loop ---------- */

function frame(now) {
  let dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  // tools only: the night held still; whoever froze it draws it
  if (frozen) { requestAnimationFrame(frame); return; }
  if (g) {
    if (!paused) {
      const inp = input.read();
      if (inp.pause && g.state === "play") { pause(); }
      else {
        if (g.player.hiding >= 0) { const c = g.L.closets[g.player.hiding]; input.clampYaw(c.rot, 0.65); const lk = input.getLook(); inp.yaw = lk.yaw; inp.pitch = Math.max(-0.5, Math.min(0.4, lk.pitch)); }
        view.raise = inp.raise;
        let left = dt;
        const all = [];
        while (left > 1e-6 && (g.state === "play" || g.state === "caught")) {
          const h = Math.min(1 / 60, left);
          game.step(g, h, inp);
          all.push(...g.events);
          // presses happen once, not once per slice
          inp.usePress = false; inp.lanternPress = false;
          left -= h;
        }
        render.feed(all, g);
        audio.feed(all, g);
        handle(all);
      }
    }
    if (g.state !== seenState) {
      seenState = g.state;
      if (g.state === "won") won();
      else if (g.state === "dead") dead();
    }
    view.prompt = game.prompt(g);
    view.touch = input.touchMode();
    render.draw(g, paused ? 0 : dt, view);
    if (!paused) audio.update(g, dt, render.three().camera.position);
    ui.frame(g, view);
  } else {
    render.drawIdle(dt);
  }
  requestAnimationFrame(frame);
}

function won() {
  const st = g.stats;
  S.stats.escaped++;
  S.stats.deaths += st.deaths;
  if (!S.stats.best || st.time < S.stats.best) S.stats.best = Math.round(st.time);
  save();
  setTimeout(() => { if (g && g.state === "won") { end(); ui.show("won", { stats: st }); } }, 2600);
}
function dead() {
  S.stats.deaths += g.stats.deaths;
  save();
  setTimeout(() => { if (g && g.state === "dead") { end(); ui.show("dead", { lit: g.lit }); } }, 400);
}

ui.show("title");
requestAnimationFrame(frame);

/* ---------- updates ---------- */
const busy = () => !!(g && (g.state === "play" || g.state === "caught"));
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").then((reg) => upd.init(reg, busy, () => Promise.resolve(save()))).catch(() => upd.init(null, busy, () => Promise.resolve(save())));
} else upd.init(null, busy, () => Promise.resolve(save()));

// For tools/e2e.js: a window into the running night.
window.__lf = { game, render, S, get g() { return g; }, begin, pause, resume, input, audio, freeze: (v) => { frozen = !!v; lastT = performance.now(); } };
