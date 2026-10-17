/* main.js — the glue: input, the frame loop, starting and ending runs,
 * trophies, and the service worker.
 *
 * The loop steps sim.js with the frame's time (cut into pieces no longer
 * than a 60 Hz frame, so a slow phone plays the same game as a fast one),
 * drains the events it left, and hands them to the renderer, the speakers,
 * the vibration motor and the trophy case. */

import * as sim from "./sim.js";
import * as render from "./render.js";
import * as audio from "./audio.js";
import * as ui from "./ui.js";
import * as info from "./info.js";
import * as upd from "./update.js";
import { S, load, save } from "./save.js";
import { MODIFIERS, ACH } from "./data.js";
import { seedFromString } from "./rng.js";
import { hydrateIcons } from "./icons.js";

load();
hydrateIcons();
info.init();
render.init(document.getElementById("view"));

let g = null, paused = false, lastT = performance.now(), idleT = 0, seen = null;
const keys = { left: false, right: false };

/* ---------- settings and skins ---------- */
function applySettings() {
  audio.setSound(S.set.sound);
  audio.setMusic(S.set.music);
  render.setMotion(S.set.motion);
}
function skins() { render.setSkins(S.cannon, S.ball); }
applySettings(); skins();
function haptic(ms) { if (S.set.haptics && navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) { /* not on this device */ } } }

/* ---------- the Daily ---------- */
function dailyInfo() {
  const d = new Date();
  const key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const seed = seedFromString("ballzooka:" + key);
  const mods = Object.keys(MODIFIERS);
  return { key, seed, mod: mods[seed % mods.length] };
}

/* ---------- runs ---------- */
let lastMode = "campaign";
function start(mode) {
  audio.unlock();
  lastMode = mode;
  const o = { mode, meta: S };
  if (mode === "campaign") o.level = S.level;
  if (mode === "daily") { const d = dailyInfo(); o.seed = d.seed; o.modifier = d.mod; }
  g = sim.newRun(o);
  seen = "play";
  S.stats.plays++;
  if (mode === "daily") S.ach.daily || award("daily");
  paused = false;
  render.clear();
  ui.hide(); ui.resetHud(); ui.showHud(true);
  audio.setPlaying(true);
  if (mode === "daily") render.say(MODIFIERS[g.mod].name.toUpperCase(), MODIFIERS[g.mod].line, "#ffd23f");
  else if (mode === "campaign") render.say("LEVEL " + g.level, g.waves[g.waves.length - 1].boss ? "boss level" : "", "#fff");
  else render.say("ENDLESS", "how far can you go", "#fff");
  if (!S.seenHelp) { S.seenHelp = true; save(); ui.toast("Drag anywhere to move. Aim for the green gates."); }
}

/* Coins, stats and bests are banked whenever a run ends, however it ends. */
function bank(mul) {
  if (!g || g.banked) return;
  g.banked = true;
  S.coins += Math.round(g.coins * (mul || 1));
  S.stats.kills += g.kills;
  S.stats.fired += g.fired;
  S.stats.bosses += g.bosses;
  S.stats.peak = Math.max(S.stats.peak, Math.round(g.peakBalls));
  if (g.mode === "endless") { S.best.endless = Math.max(S.best.endless, g.score); S.best.endlessWave = Math.max(S.best.endlessWave, g.wave + 1); }
  if (g.mode === "daily") { const k = dailyInfo().key; S.best.daily[k] = Math.max(S.best.daily[k] || 0, g.score); }
  checkAch();
  save();
}

function won() {
  audio.setPlaying(false);
  audio.sfx.won();
  haptic([30, 40, 30]);
  const st = sim.stars(g);
  S.stars[g.level] = Math.max(S.stars[g.level] || 0, st);
  if (g.level === S.level) S.level++;
  S.cleared = Math.max(S.cleared, g.level);
  if (!g.lostHearts) g.flags.clean = true;
  checkAch();
  save();
  setTimeout(() => { if (g && g.state === "won") { ui.showHud(false); ui.show("won", { g }); } }, 900);
}
function lost() {
  audio.setPlaying(false);
  audio.sfx.lost();
  haptic(120);
  setTimeout(() => { if (g && g.state === "lost") { if (g.mode !== "campaign" || g.revived) bank(); ui.show("lost", { g }); } }, 700);
}

/* ---------- trophies ---------- */
function award(id) {
  if (S.ach[id] || !ACH[id]) return;
  S.ach[id] = Date.now();
  ui.toast('<b>Trophy</b> ' + ACH[id].name);
  audio.sfx.gateUp();
}
function checkAch() {
  if (g) for (const k of Object.keys(g.flags)) if (g.flags[k] && ACH[k]) award(k);
  if (S.stats.bosses >= 5) award("boss5");
  if (S.cleared >= 10) award("level10");
  if (S.cleared >= 25) award("level25");
  if (S.best.endlessWave >= 20) award("endless20");
  if (S.spent >= 2000) award("spender");
  if (S.stats.fired >= 1e6) award("million");
  if (S.stats.peak >= 1000) award("pit");
}

/* ---------- events: sound, touch, trophies ---------- */
function handle(evs) {
  for (const e of evs) {
    switch (e.type) {
      case "shot": audio.sfx.shot(); break;
      case "hit": audio.sfx.hit(); break;
      case "kill": audio.sfx.pop(e.combo); if (e.coins >= 5) audio.sfx.coin(); if (e.boss) audio.sfx.bossDown(); break;
      case "gate": audio.sfx.gate(e.v); break;
      case "gateUp": case "flip": audio.sfx.gateUp(); haptic(15); break;
      case "reveal": audio.sfx.reveal(e.op !== "div"); break;
      case "clang": audio.sfx.clang(); break;
      case "boom": audio.sfx.boom(); break;
      case "breach": audio.sfx.breach(); haptic(60); break;
      case "pickup": audio.sfx.pickup(e.good); haptic(e.good ? 20 : 50); break;
      case "catch": audio.sfx.catch(); haptic(20); break;
      case "bomb": audio.sfx.boom(); haptic(80); break;
      case "fever": audio.sfx.fever(); audio.setFever(true); haptic([20, 30, 20]); break;
      case "feverEnd": audio.setFever(false); break;
      case "boss": audio.sfx.boss(); haptic(100); break;
      case "bossDown": haptic([60, 40, 120]); break;
      case "draft": audio.sfx.draft(); break;
    }
  }
}

/* ---------- input ---------- */
const view = document.getElementById("view");
let drag = null;
view.addEventListener("pointerdown", (e) => {
  audio.unlock();
  if (!g || g.state !== "play" || paused) return;
  const w = render.toWorld(e.clientX, e.clientY);
  drag = { id: e.pointerId, sx: w.x, cx: g.cannon.tx, mouse: e.pointerType === "mouse" };
  if (drag.mouse) g.cannon.tx = w.x;
  try { view.setPointerCapture(e.pointerId); } catch (err) { /* old browsers */ }
});
view.addEventListener("pointermove", (e) => {
  if (!g || g.state !== "play" || paused) return;
  const w = render.toWorld(e.clientX, e.clientY);
  // A mouse points at where the cannon should be. A finger would hide the
  // cannon under itself, so a drag moves it relative to where it started.
  if (e.pointerType === "mouse") { g.cannon.tx = w.x; return; }
  if (drag && drag.id === e.pointerId) g.cannon.tx = Math.max(22, Math.min(sim.W - 22, drag.cx + (w.x - drag.sx) * 1.25));
});
const endDrag = (e) => { if (drag && drag.id === e.pointerId) drag = null; };
view.addEventListener("pointerup", endDrag);
view.addEventListener("pointercancel", endDrag);
window.addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") keys.left = true;
  else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") keys.right = true;
  else if ((e.key === "Escape" || e.key === "p" || e.key === "P") && !info.isOpen()) { if (g && g.state === "play" && !paused) pause(); else if (paused) resume(); }
  else if ((e.key === "1" || e.key === "2" || e.key === "3") && g && g.state === "draft") pickPerk(+e.key - 1);
  else return;
  e.preventDefault();
});
window.addEventListener("keyup", (e) => {
  if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") keys.left = false;
  if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") keys.right = false;
});
document.addEventListener("visibilitychange", () => { if (document.hidden) { if (g && g.state === "play" && !paused) pause(); save(); } });
window.addEventListener("pagehide", () => save());

function pause() { if (!g || paused || g.state !== "play") return; paused = true; audio.setPlaying(false); ui.show("pause", g); }
function resume() { if (!paused) return; paused = false; audio.setPlaying(true); ui.hide(); lastT = performance.now(); }
function pickPerk(i) { if (sim.choosePerk(g, i)) { audio.sfx.pick(); haptic(15); ui.hide(); } }

ui.init({
  start, pause, resume, haptic, applySettings, skins, dailyInfo, checkAch,
  progress: (gg) => gg.mode === "campaign" ? sim.progress(gg) : (gg.wave % 10 + (gg.queue.length ? 0.3 : 0.9)) / 10,
  perk: pickPerk,
  reroll: () => { if (sim.reroll(g)) { audio.sfx.click(); ui.show("draft", g); } },
  restart: () => { if (g && !g.banked && g.state !== "won") bank(); paused = false; start(lastMode); },
  quit: () => { if (g && !g.banked && g.state !== "won") bank(); g = null; paused = false; audio.setPlaying(false); ui.showHud(false); ui.show("title"); },
  revive: () => { if (sim.revive(g)) { audio.setPlaying(true); audio.sfx.fever(); award("revive"); ui.hide(); ui.showHud(true); } },
  collect: (m) => { if (m >= 5) award("wheel"); bank(m); audio.sfx.buy(); },
  preview: () => {}
});

/* ---------- the loop ---------- */
function frame(now) {
  let dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  if (g) {
    if (keys.left || keys.right) g.cannon.tx = Math.max(22, Math.min(sim.W - 22, g.cannon.x + (keys.right ? 1 : -1) * 60));
    if (g.state === "play" && !paused) {
      let left = dt;
      while (left > 0 && g.state === "play") { const h = Math.min(1 / 60, left); sim.step(g, h); left -= h; }
    }
    // React to the state changing, wherever the change came from (a step,
    // a revive, a perk picked by key), exactly once per change.
    if (g.state !== seen) {
      seen = g.state;
      if (g.state === "draft") ui.show("draft", g);
      else if (g.state === "won") won();
      else if (g.state === "lost") lost();
    }
    const evs = g.events; g.events = [];
    render.feed(evs, g);
    handle(evs);
    if (g.flags && Object.keys(g.flags).some((k) => g.flags[k] && ACH[k] && !S.ach[k])) checkAch();
    render.draw(g, paused || g.state === "draft" ? 0 : dt);
    ui.hud(g);
  } else {
    idleT += dt;
    render.drawIdle(idleT, dt);
  }
  audio.musicTick();
  requestAnimationFrame(frame);
}
ui.show("title");
requestAnimationFrame(frame);

/* ---------- updates ---------- */
const busy = () => !!(g && (g.state === "play" || g.state === "draft"));
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").then((reg) => upd.init(reg, busy, () => Promise.resolve(save()))).catch(() => upd.init(null, busy, () => Promise.resolve(save())));
} else upd.init(null, busy, () => Promise.resolve(save()));

// For tools/e2e.js: a window into the running game.
window.__bz = { sim, S, get g() { return g; }, start, ui };
