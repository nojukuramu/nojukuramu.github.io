/* menus.js — every screen that stops the game: title, a new journey,
 * pause, settings, and the fall.
 *
 * Lifted in shape from Magic Sandbox (magic_sandbox/js/menus.js): a stack of
 * screens, each pausing the world while it is open, and closing always one
 * button or one Escape away — the (i) sheet first, then the spellbook or
 * the map, then a sub-screen, and only then the pause screen itself. */

import { S, on, emit } from "./state.js";
import { save, DEFAULT_SETTINGS, LOOKS } from "./save.js";
import { hydrateIcons } from "./icons.js";
import * as game from "./game.js";
import * as forge from "./forge.js";
import * as map from "./map.js";
import * as info from "./info.js";
import * as update from "./update.js";
import { setQuality, setShakeEnabled, currentTier } from "./gfx.js";
import { setFlashesEnabled, setNumbersEnabled } from "./fx.js";
import { applyVolumes } from "./audio.js";
import { resetInput } from "./input.js";
import { randomSeedText } from "./world.js";

const $ = (id) => document.getElementById(id);
const screens = ["title", "new", "pause", "settings", "death"];
let stack = [];

export function top() { return stack[stack.length - 1] || null; }
export function show(id) {
  for (const s of screens) $("scr-" + s).hidden = s !== id;
  stack = stack.filter((x) => x !== id); stack.push(id);
  syncPause();
  const first = $("scr-" + id).querySelector("button:not([disabled]), input");
  if (first && !matchMedia("(pointer: coarse)").matches) first.focus({ preventScroll: true });
}
export function hideAll() {
  for (const s of screens) $("scr-" + s).hidden = true;
  stack = [];
  syncPause();
}
export function back() {
  stack.pop();
  const prev = stack[stack.length - 1];
  if (prev) show(prev); else hideAll();
}
function anyOpen() { return screens.some((s) => !$("scr-" + s).hidden) || forge.isOpen() || map.isOpen(); }
export function syncPause() {
  const was = S.paused;
  S.paused = S.mode !== "title" && anyOpen();
  if (S.paused && !was) resetInput();
  document.body.classList.toggle("paused", S.paused);
}

/* ---------------------------------------------------------------
   Title
   --------------------------------------------------------------- */
function renderTitle() {
  const J = save.journey, b = save.data.best;
  $("btnContinue").hidden = !J;
  $("btnContinue").querySelector("small").textContent = J ? J.seed + " · level " + J.level + " · rank " + J.rank : "";
  $("titleBest").textContent = b.distance ? "Furthest from home: " + b.distance + " m · Sigils: " + b.sigils : "";
  $("verLine").textContent = "v" + update.version();
}
export function toTitle() {
  if (forge.isOpen()) forge.closeBook();
  map.closeMap();
  if (S.mode === "play") { game.persist(); save.flush(); }
  S.mode = "title";
  emit("title");
  renderTitle();
  show("title");
  document.body.classList.add("atTitle");
}
export function leaveTitle() { document.body.classList.remove("atTitle"); hideAll(); }

/* ---------------------------------------------------------------
   A new journey: a seed, and who walks it
   --------------------------------------------------------------- */
let look = LOOKS[0];
function renderNew() {
  $("seedIn").value = "";
  $("seedIn").placeholder = randomSeedText();
  const box = $("looks");
  box.innerHTML = "";
  LOOKS.forEach((k, i) => {
    const b = document.createElement("button");
    b.className = "lookbtn" + (k === look ? " on" : "");
    b.textContent = ["Ren", "Mira", "Tobin", "Sela"][i];
    b.setAttribute("aria-pressed", k === look ? "true" : "false");
    b.addEventListener("click", () => { look = k; renderNew2(); });
    box.appendChild(b);
  });
}
function renderNew2() { $("looks").querySelectorAll(".lookbtn").forEach((b, i) => { const on = LOOKS[i] === look; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on ? "true" : "false"); }); }
function startNew() {
  const typed = $("seedIn").value.replace(/[^\w\- ]/g, "").trim().slice(0, 32);
  const seed = typed || $("seedIn").placeholder;
  if (save.journey && !confirm("Start a new journey? The one you are on (" + save.journey.seed + ") will be left behind. Your scrolls are kept.")) return;
  const J = save.startJourney(seed, look);
  begin(J);
}
function begin(J) {
  leaveTitle();
  emit("fade", 1);
  setTimeout(() => {
    game.start(J);
    emit("fade", 0);
  }, 30);
}

/* ---------------------------------------------------------------
   Pause, book, map
   --------------------------------------------------------------- */
export function togglePause() {
  if (info.isOpen()) { info.close(); return; }
  if (forge.isOpen()) { closeBookHere(); return; }
  if (map.isOpen()) { map.closeMap(); syncPause(); return; }
  if (S.mode === "title") { if (stack.length > 1) back(); return; }
  if (!$("scr-death").hidden) return;
  if (stack.length) { back(); return; }
  renderPause();
  show("pause");
}
function closeBookHere() {
  forge.closeBook();
  syncPause();
  if (S.mode === "title") show("title");
}
function renderPause() {
  const P = S.player, J = game.journey();
  $("pauseStats").textContent = P && J ? "Level " + P.level + " · rank " + P.rank + " · " + Math.round(Math.hypot(P.x, P.z)) + " m from where you began · " + J.sigils.length + (J.sigils.length === 1 ? " Sigil" : " Sigils") : "";
  $("pauseSeed").textContent = J ? "Seed: " + J.seed : "";
}
export function toggleBook() {
  if (!$("scr-death").hidden) return;
  if (info.isOpen()) info.close();
  if (forge.isOpen()) { closeBookHere(); return; }
  map.closeMap();
  hideAll();
  forge.openBook();
  syncPause();
}
export function toggleMap() {
  if (S.mode !== "play" || !$("scr-death").hidden) return;
  if (info.isOpen()) info.close();
  if (map.isOpen()) { map.closeMap(); syncPause(); return; }
  if (forge.isOpen()) forge.closeBook();
  hideAll();
  map.openMap();
  syncPause();
}

/* ---------------------------------------------------------------
   Settings
   --------------------------------------------------------------- */
function renderSettings() {
  const s = save.settings;
  $("setQuality").value = s.quality;
  $("qualityNow").textContent = s.quality === "auto" ? "now " + currentTier() : "";
  for (const k of ["master", "music", "sfx"]) $("set_" + k).value = Math.round(s[k] * 100);
  for (const k of ["shake", "numbers", "flashes", "autoAim"]) $("set_" + k).checked = s[k];
  $("setVersion").textContent = "Version " + update.version();
}
function applySettings() {
  const s = save.settings;
  setQuality(s.quality);
  setShakeEnabled(s.shake);
  setFlashesEnabled(s.flashes);
  setNumbersEnabled(s.numbers);
  applyVolumes();
}

/* ---------------------------------------------------------------
   Falling
   --------------------------------------------------------------- */
let deathT = 0;
on("playerDied", (by) => {
  clearTimeout(deathT);
  deathT = setTimeout(() => {
    const P = S.player;
    if (!P || P.alive) return;
    $("deathBy").textContent = "Brought down by " + by + ", " + Math.round(Math.hypot(P.x, P.z)) + " m from where you began.";
    show("death");
  }, 1800);
});

/* ---------------------------------------------------------------
   Wiring
   --------------------------------------------------------------- */
const click = (id, fn) => $(id).addEventListener("click", (e) => { emit("ui"); fn(e); });

export function init() {
  hydrateIcons(document);
  click("btnContinue", () => { if (save.journey) begin(save.journey); });
  click("btnNew", () => { renderNew(); show("new"); });
  click("btnNewGo", startNew);
  click("btnNewBack", back);
  $("seedIn").addEventListener("keydown", (e) => { if (e.key === "Enter") startNew(); });
  click("btnBookTitle", () => { hideAll(); forge.openBook(0); });
  click("btnSettingsTitle", () => { renderSettings(); show("settings"); });
  click("btnResume", () => togglePause());
  click("btnPauseBook", () => { hideAll(); forge.openBook(); syncPause(); });
  click("btnPauseMap", () => { hideAll(); map.openMap(); syncPause(); });
  click("btnPauseSettings", () => { renderSettings(); show("settings"); });
  click("btnQuit", () => { toTitle(); });
  click("btnSettingsBack", back);
  click("btnWake", () => { hideAll(); game.wake(); });
  click("btnDeathTitle", () => toTitle());
  click("btnPause", () => togglePause());
  click("btnBook", () => toggleBook());
  click("btnMap", () => toggleMap());
  $("setQuality").addEventListener("change", (e) => { save.settings.quality = e.target.value; save.commit(); applySettings(); renderSettings(); });
  for (const k of ["master", "music", "sfx"]) $("set_" + k).addEventListener("input", (e) => { save.settings[k] = +e.target.value / 100; save.commit(); applyVolumes(); });
  for (const k of ["shake", "numbers", "flashes", "autoAim"]) $("set_" + k).addEventListener("change", (e) => { save.settings[k] = e.target.checked; save.commit(); applySettings(); });
  click("btnCheckUpdate", async () => {
    const out = $("updateStatus");
    out.textContent = "Checking…";
    const r = await update.checkNow();
    out.textContent = { ready: "A new version is ready", downloading: "Downloading a new version…", current: "You have the latest version", offline: "Offline — try again later", unsupported: "Updates are handled by your browser here" }[r] || "";
  });
  click("btnResetAll", () => {
    if (!confirm("Erase your scrolls, settings and the journey you are on? This cannot be undone.")) return;
    const playing = S.mode === "play";
    save.resetAll();
    Object.assign(save.settings, DEFAULT_SETTINGS);
    applySettings(); renderSettings();
    if (playing) toTitle(); else renderTitle();
  });
  forge.setCloseHandler(closeBookHere);
  on("bookClosed", () => syncPause());
  on("bookOpened", () => syncPause());
  on("mapClosed", () => syncPause());
  applySettings();
}

/** The update prompt asks before reloading in the middle of a journey. */
export function busy() { return S.mode === "play" && !!S.player && S.enemies.some((e) => e.alive && !e.dormant && e.state !== "idle"); }
