/* main.js — the glue: settings, the frame loop, journeys begun, resumed and
 * ended, the service worker.
 *
 * The shape is Last Flame's (lastflame/js/main.js), which is Ballzooka's:
 * the loop steps game.js in slices no longer than a 60 Hz frame, so a slow
 * phone walks the same walk as a fast one, then hands the events it left to
 * the renderer, the speakers and the screen. What is this game's: the world
 * is built in a worker first (terrain.js) and the journey is saved as it
 * goes, because it is long. */

import * as game from "./game.js";
import * as render from "./render.js";
import * as terrain from "./terrain.js";
import * as audio from "./audio.js";
import * as input from "./input.js";
import * as ui from "./ui.js";
import * as info from "./info.js";
import * as upd from "./update.js";
import { S, load, save, loadJourney, saveJourney, clearJourney } from "./save.js";
import { hydrateIcons } from "./icons.js";
import { DEFAULT_SEED, unpack } from "./world.js";
import { DAY } from "./sun.js";

load();
hydrateIcons();
info.init();
const canvas = document.getElementById("view");
render.init(canvas, () => ui.progress(progress()));

let g = null, W = null, paused = false, overlay = null, frozen = false, lastT = performance.now(), saveT = 20, building = null;
const view = { check: false };

/* A phone gets Fast and anything else Normal, the first time; Unrestrained
   is only ever chosen, never guessed. */
if (S.set.quality === "auto") { S.set.quality = matchMedia("(pointer: coarse)").matches ? "low" : "high"; save(); }
function apply() {
  const s = S.set;
  render.setQuality(s.quality);
  render.setAssets(s.assets, (text) => ui.assetNote(text));
  render.setMotion(s.motion);
  render.setFov(s.fov);
  render.setBrightness(s.bright);
  audio.setVolume(s.volume);
  ui.setCaptions(!!s.captions);
  input.configure({ sens: s.sens, invert: s.invert });
}
apply();
audio.setCaptions((text, dir, quiet) => ui.caption(text, dir, quiet));

/* Loading: the models and surfaces, and the world being built. */
let worldP = 0;
function progress() { return Math.min(render.progress(), W ? 1 : 0.95 * worldP); }

/* Build the world for a seed, unless it is the one already built. */
function world(seed) {
  if (W && W.seed === seed) return Promise.resolve(W);
  if (building && building.seed === seed) return building.p;
  W = null; worldP = 0;
  const stages = { rock: 0.1, erosion: 0.15, ice: 0.6, route: 0.85, done: 1 };
  const p = terrain.build(seed, (stage, f) => {
    const a = stages[stage] || 0, keys = Object.keys(stages), next = stages[keys[keys.indexOf(stage) + 1]] || 1;
    worldP = a + (next - a) * f;
    ui.loadingLine(stage === "erosion" ? "Weathering the mountains… " + Math.round(f * 100) + "%" : stage === "ice" ? "Laying the ice over them…" : stage === "route" ? "Flagging the route…" : "Laying out the coast…");
    ui.progress(progress());
  }).then((w) => { W = w; building = null; ui.progress(progress()); return w; });
  building = { seed, p };
  return p;
}

/* ---------- journeys ---------- */

function journeyInfo() {
  const j = loadJourney();
  return j ? { diff: j.diff, beacons: (j.lit || []).filter(Boolean).length, km: ((j.stats && j.stats.distance) || 0) / 1000, seed: j.seed } : null;
}

async function begin(saved) {
  audio.unlock();
  titleG = null;
  const seed = saved ? saved.seed : (Math.random() * 0xffffffff) >>> 0 || DEFAULT_SEED;
  ui.show("loading");
  await world(seed);
  g = game.newRun(W, { diff: saved ? saved.diff : S.set.diff, saved });
  if (!saved) { clearJourney(); S.stats.journeys++; save(); saveJourney(game.snapshot(g)); }
  render.build(g);
  // let the land round the eye mesh before showing it
  await warm();
  input.setLook(g.p.yaw, g.p.pitch || 0);
  input.setEnabled(true);
  input.lock();
  paused = false; overlay = null;
  ui.hide(); ui.hud(true);
  const touch = input.touchMode() || matchMedia("(pointer: coarse)").matches;
  ui.touchControls(touch);
  document.body.classList.toggle("touch", touch);
  lastT = performance.now();
  saveT = 20;
}
/* A few frames for the terrain workers to fill in the land near the eye. */
function warm() {
  return new Promise((res) => {
    let n = 0;
    const tick = () => {
      render.draw(g, 1 / 60, { fade: 1 });
      const c = terrain.coverage();
      ui.loadingLine("Waking… " + Math.min(99, Math.round((n / 90) * 100)) + "%");
      if ((c.pending === 0 && c.queued === 0 && n > 10) || n > 240) res(); else { n++; requestAnimationFrame(tick); }
    };
    tick();
  });
}

function end() {
  input.setEnabled(false);
  input.unlock();
  ui.hud(false);
  ui.hideNote();
}
function store() { if (g && (g.state === "play" || g.state === "out")) saveJourney(game.snapshot(g)); }

function pause() {
  if (!g || paused || overlay || (g.state !== "play" && g.state !== "out")) return;
  paused = true;
  store();
  input.setEnabled(false);
  input.unlock();
  audio.suspend(true);
  ui.show("pause", { line: pauseLine() });
}
function pauseLine() {
  if (!g) return "";
  const n = g.stats.beacons, km = (g.stats.distance / 1000).toFixed(1);
  return n + (n === 1 ? " beacon" : " beacons") + " lit · " + km + " km";
}
function resume() {
  if (!g && loadJourney()) { begin(loadJourney()); return; }
  if (!paused) return;
  paused = false;
  ui.hide();
  audio.suspend(false);
  input.setEnabled(true);
  input.lock();
  lastT = performance.now();
}
/* The pack and the map: the walk holds still while they are open. */
function openOverlay(name) {
  if (!g || g.state !== "play") return;
  overlay = name;
  input.setEnabled(false);
  input.unlock();
  ui.show(name, { g });
}
function closeOverlay() {
  if (!overlay) return;
  overlay = null;
  ui.hide();
  input.setEnabled(true);
  input.lock();
  lastT = performance.now();
}

ui.init({
  begin: () => begin(null),
  resume,
  quit: () => { store(); end(); g = null; paused = false; audio.suspend(false); audio.quietAll(); ui.show("title"); },
  toTitle: () => { end(); g = null; paused = false; overlay = null; audio.suspend(false); audio.quietAll(); ui.show("title"); },
  apply,
  info: (k) => info.open(k),
  progress,
  journey: journeyInfo,
  pauseData: () => ({ line: pauseLine() }),
  closeOverlay,
  eat: (k) => { if (g && game.eat(g, k)) { audio.feed(g.events, g); g.events = []; ui.show("pack", { g }); } }
});

input.init({ canvas, pause, lock: () => {} });

// on-screen buttons for touch
for (const [id, name] of [["use", "use"], ["btn-lantern", "lantern"], ["btn-check", "check"], ["btn-pack", "pack"], ["btn-map", "map"]]) {
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
document.addEventListener("visibilitychange", () => { if (document.hidden) { pause(); store(); save(); } });
window.addEventListener("pagehide", () => { store(); save(); });
window.addEventListener("pointerdown", () => audio.unlock(), { once: true });
window.addEventListener("keydown", (e) => {
  audio.unlock();
  // the pack and the map close with the keys that opened them
  if (overlay && (e.code === "Tab" || e.code === "KeyI" || e.code === "KeyM" || e.code === "Escape")) { e.preventDefault(); closeOverlay(); }
});

/* ---------- events to the screen ---------- */

function handle(evs) {
  for (const e of evs) {
    switch (e.type) {
      case "hint": ui.hint(e.text, input.touchMode()); break;
      case "read": ui.note("clue", e.id); break;
      case "radio": {
        const q = g.P.props[e.prop];
        ui.note("radio", e.rare || (q.broken && g.radios[q.id] ? "mended" : "default"));
        break;
      }
      case "blackout": ui.note("memory", e.memory); break;
      case "lostThings": if (e.fuel || e.item) ui.hint("Some of what he carried is gone.", input.touchMode()); break;
      case "rest": ui.hint(e.warm ? "He sleeps by the stove. The sun has moved on." : "He sleeps a little, cold. The sun has moved on.", input.touchMode()); break;
      case "beaconLit": S.stats.beacons++; save(); break;
      case "eat": break;
    }
  }
}

/* ---------- the loop ---------- */

function frame(now) {
  let dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  if (frozen) { requestAnimationFrame(frame); return; }
  if (g) {
    if (!paused && !overlay) {
      const inp = input.read(dt);
      if (inp.pause && g.state === "play") pause();
      else if (inp.packPress && g.state === "play") openOverlay("pack");
      else if (inp.mapPress && g.state === "play" && g.p.keys.map) openOverlay("map");
      else {
        // a note on the paper is put down by the next press
        if (ui.noteOpen() && inp.usePress) { ui.hideNote(); inp.usePress = false; }
        view.check = inp.check;
        let left = dt;
        const all = [];
        while (left > 1e-6 && (g.state === "play" || g.state === "out")) {
          const h = Math.min(1 / 60, left);
          game.step(g, h, inp);
          all.push(...g.events);
          inp.usePress = false; inp.lanternPress = false;
          left -= h;
        }
        render.feed(all, g);
        audio.feed(all, g);
        handle(all);
      }
      saveT -= dt;
      if (saveT <= 0) { saveT = 20; store(); }
    }
    if (g.state === "over" && !g.shown) {
      g.shown = true;
      clearJourney();
      if (g.won) { S.stats.arrived++; S.stats.km += g.stats.distance / 1000; save(); }
      setTimeout(() => { if (g && g.state === "over") { end(); ui.show("over", { g }); } }, g.won ? 600 : 2500);
    }
    view.prompt = game.prompt(g);
    view.touch = input.touchMode();
    view.overlay = overlay;
    render.draw(g, paused || overlay ? 0 : dt, view);
    if (!paused) audio.update(g, dt, render.three().camera.position);
    ui.frame(g, view);
  } else {
    if (!titleG && W && render.isReady()) titleScene();
    if (titleG) titleFrame(dt); else render.drawIdle(dt);
    audio.title(dt);
  }
  requestAnimationFrame(frame);
}

/* The title: the coast at the base, late in the day, the sun low and the
   first beacon burning on its rise; the eye turns slowly along the coast. */
let titleG = null, titleT = 0;
function titleScene() {
  titleG = game.newRun(W, { diff: "normal" });
  const b = W.beacons[0], base = W.sites[0], p = titleG.p;
  titleG.lit[0] = true;
  p.x = b.x + (base.x - b.x) * 0.25 + 30; p.z = b.z + (base.z - b.z) * 0.25 + 12;
  p.inside = -1; p.y = game.groundAt(titleG, p.x, p.z);
  p.yaw = Math.atan2(b.x - p.x, b.z - p.z) + 0.6; p.pitch = 0.02;
  titleG.base = p.yaw;
  // late, and late in the season: a long low light
  titleG.clock = DAY * 0.86 - DAY * 0.36; titleG.season = 0.55;
  titleG.weather.wind = 0.35;
  render.build(titleG);
}
function titleFrame(dt) {
  titleT += dt;
  const p = titleG.p;
  p.yaw = titleG.base + Math.sin(titleT * 0.04) * 0.35;
  titleG.clock += dt * 6;
  titleG.sun = game.sunNow(titleG);
  render.draw(titleG, dt, { title: true });
}

/* ---------- start ---------- */

ui.show("title");
// the world for the walk under way, or for the title's first coast
{ const j = loadJourney(); world(j ? j.seed : DEFAULT_SEED); }
requestAnimationFrame(frame);

/* ---------- updates ---------- */
const busy = () => !!(g && (g.state === "play" || g.state === "out"));
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").then((reg) => upd.init(reg, busy, () => Promise.resolve(store()))).catch(() => upd.init(null, busy, () => Promise.resolve(store())));
} else upd.init(null, busy, () => Promise.resolve(store()));

// For tools/e2e.js: a window into the running walk.
window.__ll = { game, render, terrain, audio, S, get g() { return g; }, get W() { return W; }, get titleG() { return titleG; }, begin, pause, resume, input, ui, freeze: (v) => { frozen = !!v; lastT = performance.now(); }, unpack };
