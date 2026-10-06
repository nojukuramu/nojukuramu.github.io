/* main.js — boot, the loop, and the glue between the parts.
 *
 * The loop pays out fixed simulation ticks from real time (scaled by the game
 * speed) and draws between them; at most eight ticks a frame, so a phone
 * that stalls skips time rather than freezing to catch up. Sound and the HUD
 * hear about the game through events (state.js) wired here, so neither the
 * simulation nor the renderer has to know they exist. */

import { G, on, emit } from "./state.js";
import { TICK, TILE, ERAS, BUILDINGS, LINES, HEROES, RES_NAME, RANK_NAMES } from "./data.js";
import { newGame, tick } from "./sim.js";
import * as render from "./render.js";
import { view } from "./render.js";
import { initMinimap, drawMinimap } from "./minimap.js";
import * as input from "./input.js";
import * as ui from "./ui.js";
import * as info from "./info.js";
import * as audio from "./audio.js";
import * as update from "./update.js";
import * as orient from "./orient.js";
import * as fx from "./fx.js";
import { settings, saveSlot, loadSlot, listSlots, importJSON } from "./save.js";
import { seedFromString } from "./rng.js";
import { ERA_LINES, HERO_LINES } from "./lore.js";
import { visiblePx } from "./fog.js";

const cv = document.getElementById("view");
const touch = matchMedia("(pointer: coarse)").matches || ("ontouchstart" in window && navigator.maxTouchPoints > 0);
document.body.classList.toggle("touchUI", touch);

/* ---------------- sizes ---------------- */
function resize() {
  orient.apply();
  const s = orient.appSize();
  const dpr = Math.min(settings.quality === "low" || (settings.quality === "auto" && autoLow) ? 1 : 2, window.devicePixelRatio || 1);
  render.resize(s.w, s.h, dpr);
  document.documentElement.style.setProperty("--appH", s.h + "px");
}
let autoLow = false;
function applySettings() {
  view.lights = settings.lights; view.weather = settings.weather;
  const low = settings.quality === "low" || (settings.quality === "auto" && autoLow);
  view.quality = low ? 0.4 : 1; view.hiRes = !low;
  fx.setQuality(view.quality);
  audio.setVolumes(settings);
  resize();
}

/* ---------------- sound, by event ---------------- */
function near(x, y) {
  const c = view.cam, dx = (x - c.x) * c.z, dy = (y - c.y) * c.z, r = Math.hypot(view.W, view.H) * 0.6;
  const d = Math.hypot(dx, dy);
  return d < r ? 1 - (d / r) * 0.6 : Math.max(0, 0.4 - (d - r) / r);
}
const SHOT_SND = { arrow: "arrow", stone: "arrow", bolt: "arrow", spear: "arrow", photon: "plasma", plasma: "plasma", star: "plasma", aether: "plasma", hero: "magic", bolt2: "magic", boulder: "club", shell: "gun", rocket: "gun", missile: "gun", lance: "laser", singularity: "plasma" };
on("hit", (t, dmg, by, kind) => { if (kind === "melee" && by) audio.play(by.tier === 0 && !by.hero ? "club" : "sword", near(t.x, t.y)); });
on("shot", (src, p) => audio.play(SHOT_SND[p.shot] || "arrow", near(src.x, src.y)));
on("tracer", (src, t, shot) => audio.play(shot === "musket" || shot === "bullet" ? "gun" : "laser", near(src.x, src.y)));
on("burst", (x, y) => audio.play("boom", near(x, y)));
on("death", (e) => { if (e.kind === "unit") audio.play("death", near(e.x, e.y) * 0.8); });
on("gathered", (u, r) => { if (u.team === 0) audio.play(r === "wood" ? "chop" : "mine", near(u.x, u.y) * 0.6); });
on("skill", (u) => audio.play("magic", near(u.x, u.y)));
on("healed", (t, h) => { if (h > 5) audio.play("heal", near(t.x, t.y) * 0.5); });
on("trained", (u) => { if (u.team === 0) audio.play("trained", 0.6); });

/* ---------------- the HUD's news ---------------- */
let lastAlertSound = -99, lastIdleToast = -99, lastContactToast = -99;
on("alert", (a) => {
  if (G.time - lastAlertSound > 8) { audio.play("alert"); lastAlertSound = G.time; ui.toast("Under attack: " + (a.what || "something of yours"), "bad"); }
});
on("built", (b) => { if (b.team !== 0) return; audio.play("done", 0.8); ui.toast(ui.nameOf(b) + " is finished", "good"); });
on("researched", (cat, L) => { audio.play("done", 0.8); });
on("finished", (b, it) => {
  if (b.team !== 0 || it.k === "unit") return;
  if (it.k === "tech" || it.k === "refit" || it.k === "doc" || it.k === "level") ui.toast(({ tech: "Research done", refit: "Retrained", doc: "Doctrine learned", level: "Raised" })[it.k] + ": " + (it.k === "level" ? ui.nameOf(b) : it.k === "doc" ? it.doc : ""), "good");
});
on("doctrine", (id) => ui.toast("Doctrine learned. Its switch is in Automation.", "good"));
on("levelup", (b) => audio.play("level", near(b.x, b.y)));
on("heroLevel", (u) => audio.play("level", near(u.x, u.y)));
on("hero", (u, revived) => { ui.toast(HEROES[u.hero].name + ": " + HERO_LINES[u.hero].call, "lore"); audio.play("relic"); });
on("era", (e) => { audio.play("era"); audio.setEra(e); ui.banner(ERAS[e].age, ERA_LINES[e], "era"); });
on("phase", (n, line, bases) => {
  audio.play("phase");
  ui.banner("Phase " + n, line, "phase");
  // a rumour of where: a wide ring, not a point
  for (const b of bases) render.ping(b.x + (Math.random() - 0.5) * 18 * TILE, b.y + (Math.random() - 0.5) * 18 * TILE, "#c08cff", 16 * TILE, 8);
});
on("phaseClear", (n) => { ui.banner("Phase " + n + " cleared", "The mist is still. It will not stay so.", "clear"); });
on("baseFell", (b, loot, line) => { audio.play("fall"); ui.toast("A base falls. " + Object.keys(loot).map((r) => "+" + loot[r] + " " + RES_NAME[r].toLowerCase()).join(", "), "good"); ui.toast(line, "lore"); });
on("expanded", (sides) => ui.toast("The mist draws back to the " + sides.map((s) => ({ n: "north", s: "south", e: "east", w: "west" })[s]).filter((v, i, a) => a.indexOf(v) === i).join(" and "), "lore"));
on("relic", (n, finder, reward, text) => { audio.play("relic"); ui.toast("A ruin: +" + reward.gold + " gold, +" + reward.wood + " wood, +" + reward.stone + " stone", "good"); if (text) ui.toast(text, "lore"); });
on("noWork", (u, r) => { if (u.team === 0 && G.time - lastIdleToast > 15) { lastIdleToast = G.time; ui.toast("A worker found no " + r + " nearby", "info"); } });
on("contact", (c) => { if (G.time - lastContactToast > 20) { lastContactToast = G.time; ui.toast("Contact: " + c.n + " enemies", "bad"); render.ping(c.x, c.y, "#ff6a6a", 60, 3); } });
on("spotted", (b) => { if (b.type === "hall") { ui.toast("An enemy hall, found", "good"); render.ping(b.x, b.y, "#ff6a6a", 80, 4); } });
on("scan", (x, y) => render.ping(x, y, "#62e8ff", 14 * TILE, 3));
on("beacon", () => ui.banner("The Beacon", "Something on the other side has seen it.", "era"));
on("defeat", () => ui.openPanel("defeat"));
on("wake", (c) => { audio.play("alert"); ui.banner("Paused", c.n + " enemies near home. Press play when you are ready.", "phase"); view.cam.x = c.x; view.cam.y = c.y; render.clampCam(); render.ping(c.x, c.y, "#ff6a6a", 80, 6); });
on("rank", (u) => { if (u.team === 0) { audio.play("level", near(u.x, u.y) * 0.6); if (u.rank >= 3) ui.toast("A " + ui.nameOf(u) + " is now " + RANK_NAMES[u.rank], "good"); } });
on("camp", (n) => { ui.toast("Something lives by that ruin", "info"); });
on("complete", () => setTimeout(() => ui.openPanel("complete"), 2500));
on("togglePause", () => { G.paused = !G.paused; });
on("cycleSpeed", () => { const S = [1, 1.5, 2, 3]; G.speed = S[(S.indexOf(G.speed) + 1) % S.length]; settings.speed = G.speed; ui.toast("Speed " + G.speed + "x", "info"); });
on("jumpAlert", () => { const a = G.intel.alerts[G.intel.alerts.length - 1]; if (a) { view.cam.x = a.x; view.cam.y = a.y; render.clampCam(); render.ping(a.x, a.y, "#ff6a6a", 40, 2); } });

/* ---------------- starting, loading, leaving ---------------- */
function enter() {
  render.setWorld(G.world);
  const hall = G.blds.find((b) => !b.dead && b.team === 0 && b.type === "hall") || G.blds.find((b) => b.team === 0) || G.units.find((u) => u.team === 0);
  if (hall) { view.cam.x = hall.x; view.cam.y = hall.y + 40; }
  view.cam.z = touch ? 0.95 : 1.1;
  render.clampCam();
  G.speed = settings.speed || 1;
  ui.hideTitle(); ui.closePanel();
  audio.setEra(G.era);
  orient.lock();
  lastSave = performance.now();
}
on("startGame", (opts) => {
  const seed = opts.seedTxt ? (/^\d+$/.test(opts.seedTxt) ? +opts.seedTxt >>> 0 : seedFromString(opts.seedTxt)) : 0;
  newGame({ seed, diff: opts.diff });
  enter();
  ui.banner(ERAS[0].age, ERA_LINES[0], "era");
  setTimeout(() => { if (G.mode === "play" && settings.hints) ui.toast("Tap a worker, then a tree or the gold vein. The (i) in the menu explains the rest.", "info"); }, 4500);
});
on("loadSlot", (slot) => {
  loadSlot(slot).then(() => { enter(); ui.toast("Welcome back. " + ERAS[G.era].age + ", phase " + (G.phase ? G.phase.n : 0) + ".", "info"); }, (e) => ui.toast(e.message || "Could not load", "bad"));
});
on("importSave", (txt) => { try { importJSON(txt); enter(); ui.toast("Imported", "good"); } catch (e) { ui.toast("That file is not a save: " + e.message, "bad"); } });
on("quit", () => { autosave().finally(() => toTitle()); });
on("toTitle", () => toTitle());
function toTitle() { G.mode = "title"; G.paused = false; listSlots().then((l) => ui.showTitle(!!l.find((s) => s.slot === "auto" && s.meta)), () => ui.showTitle(false)); }

let lastSave = 0, saving = false;
function autosave() {
  if (G.mode !== "play" || G.over || saving) return Promise.resolve();
  saving = true;
  return saveSlot("auto").catch(() => {}).finally(() => { saving = false; lastSave = performance.now(); });
}
document.addEventListener("visibilitychange", () => { if (document.hidden && settings.autosave) autosave(); });
window.addEventListener("pagehide", () => { if (settings.autosave) autosave(); });

/* ---------------- the loop ---------------- */
let acc = 0, last = performance.now(), mmT = 0, musT = 0, slow = 1 / 60, slowT = 0;
function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (G.mode === "play") {
    if (!G.paused && !ui.panelPauses()) {
      acc += dt * G.speed;
      let n = 0;
      while (acc >= TICK && n < 8) { tick(); acc -= TICK; n++; }
      if (n === 8) acc = 0;
    }
    const k = Math.min(1, acc / TICK);
    input.setAlpha(k);
    input.update(dt);
    render.follow();
    render.frame(k, dt);
    mmT -= dt; if (mmT <= 0) { mmT = 0.25; drawMinimap(); }
    ui.frame(dt);
    if (settings.autosave && performance.now() - lastSave > 60000) autosave();
    // "auto" detail: a phone that cannot keep up for a few seconds gets the lighter picture, once
    slow = slow * 0.97 + dt * 0.03; slowT += dt;
    if (settings.quality === "auto" && !autoLow && slowT > 6 && slow > 1 / 26) { autoLow = true; applySettings(); ui.toast("Detail lowered to keep up. Settings can raise it.", "info"); }
  } else {
    // the title: the world turns slowly behind it, if there is one to show
    if (G.world) { view.cam.x += dt * 14; render.frame(1, dt); }
  }
  musT -= dt; if (musT <= 0) { musT = 0.5; audio.music(); }
  requestAnimationFrame(loop);
}

/* ---------------- boot ---------------- */
render.init(cv);
initMinimap(document.getElementById("minimap"));
orient.init();
info.init();
ui.init();
input.init();
applySettings();
on("settings", applySettings);
on("turned", resize);
window.addEventListener("resize", resize);
document.addEventListener("pointerdown", () => audio.unlock(), { capture: true });

const busy = () => G.mode === "play" && !G.over;
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").then((reg) => update.init(reg, busy, autosave)).catch(() => update.init(null, busy, autosave));
} else update.init(null, busy, autosave);

toTitle();
requestAnimationFrame(loop);
// tools/e2e.js drives the game through this; nobody else sees it
try { if (localStorage.getItem("aeons:debug") === "1") window.AE_DEBUG = { G, emit, view, render, input, ui, tick }; } catch (e) { /* storage blocked */ }
export { BUILDINGS, LINES, visiblePx };
