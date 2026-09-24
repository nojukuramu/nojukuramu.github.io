/* menus.js — every screen that stops the game: title, pause, settings,
 * boon cards, death, victory, the grimoire, and the sandbox's panel.
 *
 * One rule for all of them: they pause the world while open, and closing
 * them is always one button or one Escape away. */

import { S, on, emit } from "./state.js";
import { save, DEFAULT_SETTINGS } from "./save.js";
import { icon, hydrateIcons } from "./icons.js";
import * as game from "./game.js";
import * as forge from "./forge.js";
import * as info from "./info.js";
import * as update from "./update.js";
import { setQuality, setShakeEnabled, currentTier } from "./gfx.js";
import { setFlashesEnabled, setNumbersEnabled } from "./fx.js";
import { applyVolumes } from "./audio.js";
import { resetInput } from "./input.js";
import { BOON_BY_ID, ROMAN } from "./boons.js";
import { ELEMENTS, ELEMENT_IDS, FORMS, FORM_IDS, REACTIONS, REACTION_IDS, elementInfo } from "./spellcore.js";
import { fmtTime, escHtml } from "./util.js";

const $ = (id) => document.getElementById(id);
const screens = ["title", "pause", "settings", "boons", "death", "victory", "grimoire"];
let stack = [];

function show(id) {
  for (const s of screens) $("scr-" + s).hidden = s !== id;
  stack = stack.filter((x) => x !== id); stack.push(id);
  syncPause();
  const first = $("scr-" + id).querySelector("button:not([disabled])");
  if (first && !matchMedia("(pointer: coarse)").matches) first.focus({ preventScroll: true });
}
function hideAll() {
  for (const s of screens) $("scr-" + s).hidden = true;
  stack = [];
  syncPause();
}
function back() {
  stack.pop();
  const prev = stack[stack.length - 1];
  if (prev) show(prev); else hideAll();
}
function anyOpen() { return screens.some((s) => !$("scr-" + s).hidden) || forge.isOpen(); }
function syncPause() {
  const was = S.paused;
  S.paused = S.mode !== "title" && anyOpen();
  if (S.paused && !was) resetInput();
  document.body.classList.toggle("paused", S.paused);
}

/* ---------------------------------------------------------------
   Title
   --------------------------------------------------------------- */
function renderTitle() {
  const L = save.data.landing, b = save.data.best;
  $("btnContinue").hidden = !L;
  $("btnContinue").querySelector("small").textContent = L ? "Floor " + L.floor + " · level " + L.level : "";
  $("titleBest").textContent = b.wins ? "Climbed the tower " + b.wins + (b.wins === 1 ? " time" : " times") + (b.time ? " · best " + fmtTime(b.time) : "")
    : b.floor ? "Highest floor: " + b.floor : "";
  $("verLine").textContent = "v" + update.version();
}
export function toTitle() {
  if (forge.isOpen()) forge.closeBook();
  if (S.mode !== "title") game.quitToTitle();
  renderTitle();
  show("title");
  document.body.classList.add("atTitle");
}
function leaveTitle() { document.body.classList.remove("atTitle"); hideAll(); }

/* ---------------------------------------------------------------
   Pause
   --------------------------------------------------------------- */
export function togglePause() {
  if (S.mode === "title" || S.over) return;
  if (info.isOpen()) { info.close(); return; }
  if (forge.isOpen()) { forge.closeBook(); syncPause(); return; }
  if (!$("scr-boons").hidden) return;                 // a choice must be made
  if (stack.length) { back(); return; }
  renderPause();
  show("pause");
}
function renderPause() {
  const P = S.player;
  const list = P ? Object.keys(P.boons) : [];
  $("pauseBoons").innerHTML = list.length
    ? list.map((id) => { const b = BOON_BY_ID[id]; return '<span class="boonchip" title="' + escHtml(b.text) + '">' + icon(b.icon) + escHtml(b.name) + (P.boons[id] > 1 ? " " + ROMAN[P.boons[id]] : "") + "</span>"; }).join("")
    : '<span class="muted">No boons yet</span>';
  $("pauseStats").textContent = S.mode === "sandbox" ? "Sandbox" : "Floor " + S.floor + " · level " + (P ? P.level : 1) + " · rank " + (P ? P.rank : 1) + " · " + fmtTime(S.runTime);
  $("btnRestartLanding").hidden = S.mode !== "run" || !save.data.landing;
  $("sandboxOpts").hidden = S.mode !== "sandbox";
  $("optInfMana").checked = S.sandbox.infiniteMana;
  $("optNoDeath").checked = S.sandbox.noDeath;
}
export function toggleBook() {
  if (S.over || !$("scr-boons").hidden) return;
  if (info.isOpen()) info.close();
  if (forge.isOpen()) { forge.closeBook(); syncPause(); return; }
  forge.openBook();
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
   Boon cards
   --------------------------------------------------------------- */
on("offerBoons", (choices, source) => {
  const P = S.player;
  $("boonsTitle").textContent = source === "chest" ? "The chest holds three threads" : source === "warden" ? "The Warden's gift" : "Level " + P.level;
  $("boonsSub").textContent = "Choose one";
  const box = $("boonCards");
  box.innerHTML = "";
  choices.forEach((b, i) => {
    const have = P.boons[b.id] || 0;
    const card = document.createElement("button");
    card.className = "card r" + b.rarity;
    card.innerHTML = '<span class="cico">' + icon(b.icon) + '</span><b>' + escHtml(b.name) + (have ? " " + ROMAN[have + 1] : "") + '</b><span class="ctext">' + escHtml(b.text) + '</span><kbd class="ckey">' + (i + 1) + "</kbd>";
    card.addEventListener("click", () => pickBoon(b.id));
    box.appendChild(card);
  });
  box.dataset.ids = choices.map((b) => b.id).join(",");
  show("boons");
});
function pickBoon(id) {
  game.takeBoon(id);
  hideAll();
  $("boonCards").dataset.ids = "";
}

/* ---------------------------------------------------------------
   Death and victory
   --------------------------------------------------------------- */
on("deathScreen", (by) => {
  const P = S.player, L = save.data.landing;
  $("deathBy").textContent = "Undone by " + (by || "the dark") + " on floor " + S.floor + ".";
  $("deathStats").innerHTML = stat("Level", P.level) + stat("Kills", S.kills) + stat("Time", fmtTime(S.runTime)) + stat("Best", "Floor " + save.data.best.floor);
  $("btnRetry").hidden = !L;
  $("btnRetry").querySelector("span").textContent = L ? "Try again from floor " + L.floor : "";
  show("death");
});
on("victory", () => {
  const P = S.player;
  $("winStats").innerHTML = stat("Time", fmtTime(S.runTime)) + stat("Level", P.level) + stat("Kills", S.kills) + stat("Climbs", save.data.best.wins);
  show("victory");
});
const stat = (k, v) => '<div class="stat"><small>' + k + "</small><b>" + escHtml(String(v)) + "</b></div>";

/* ---------------------------------------------------------------
   Grimoire
   --------------------------------------------------------------- */
function renderGrimoire() {
  const g = save.data.grimoire;
  const row = (kind, ids, get, col) => ids.map((id) => {
    const known = g[kind].includes(id);
    const d = get(id);
    return '<div class="gitem' + (known ? "" : " unknown") + '" style="--c:' + (col ? col(id) : "#e8ddc8") + '">' + icon(known ? id : "lock") +
      "<b>" + (known ? escHtml(d.name) : "???") + "</b>" + (known && d.desc ? "<small>" + escHtml(d.desc) + "</small>" : kind === "reactions" && !known ? "<small>" + escHtml(REACTIONS[id].pair.map((e) => ELEMENTS[e].name).join(" + ")) + "?</small>" : "") + "</div>";
  }).join("");
  const total = ELEMENT_IDS.length + 1 + FORM_IDS.length + REACTION_IDS.length;
  const found = g.elements.length + g.forms.length + g.reactions.length;
  $("grimCount").textContent = found + " of " + total + " found";
  $("grimBody").innerHTML =
    '<h3>Elements <button class="info" data-info="elements" aria-label="About elements">' + icon("info") + "</button></h3><div class=\"grow\">" + row("elements", ELEMENT_IDS.concat(["arcane"]), (id) => elementInfo(id), (id) => elementInfo(id).color) + "</div>" +
    '<h3>Forms <button class="info" data-info="forms" aria-label="About forms">' + icon("info") + "</button></h3><div class=\"grow\">" + row("forms", FORM_IDS, (id) => FORMS[id]) + "</div>" +
    '<h3>Reactions <button class="info" data-info="reactions" aria-label="About reactions">' + icon("info") + "</button></h3><div class=\"grow\">" + row("reactions", REACTION_IDS, (id) => REACTIONS[id], (id) => REACTIONS[id].color) + "</div>";
}

/* ---------------------------------------------------------------
   Sandbox panel
   --------------------------------------------------------------- */
function renderSandboxPanel() {
  const box = $("sandboxPanel");
  const kinds = [["mote", "Motes"], ["knot", "Knot"], ["spindle", "Spindle"], ["golem", "Golem"], ["weaver", "Weaver"], ["warden", "Warden"]];
  box.innerHTML = kinds.map(([k, n]) => '<button data-spawn="' + k + '">' + escHtml(n) + "</button>").join("") + '<button data-clear="1" class="ghost">' + icon("trash") + "Clear</button>";
  box.querySelectorAll("[data-spawn]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); game.sandboxSpawn(b.dataset.spawn); emit("ui"); }));
  box.querySelector("[data-clear]").addEventListener("click", (e) => { e.stopPropagation(); game.sandboxClear(); emit("ui"); });
}

/* ---------------------------------------------------------------
   Wiring
   --------------------------------------------------------------- */
const click = (id, fn) => $(id).addEventListener("click", (e) => { emit("ui"); fn(e); });

export function init() {
  hydrateIcons(document);
  click("btnNew", () => {
    if (save.data.landing && !confirm("Start over from floor 1? Your saved landing on floor " + save.data.landing.floor + " will be replaced.")) return;
    save.clearLanding(); leaveTitle(); game.startRun(false);
  });
  click("btnContinue", () => { leaveTitle(); game.startRun(true); });
  click("btnSandbox", () => { leaveTitle(); game.startSandbox(); renderSandboxPanel(); });
  click("btnBookTitle", () => { hideAll(); forge.openBook(0); });
  click("btnGrimoire", () => { renderGrimoire(); show("grimoire"); });
  click("btnSettingsTitle", () => { renderSettings(); show("settings"); });
  click("btnResume", () => togglePause());
  click("btnPauseBook", () => { hideAll(); forge.openBook(); syncPause(); });
  click("btnPauseSettings", () => { renderSettings(); show("settings"); });
  click("btnPauseGrimoire", () => { renderGrimoire(); show("grimoire"); });
  click("btnQuit", () => { if (S.mode === "run" && !confirm("Leave this climb? You can continue later from your last landing.")) return; toTitle(); });
  click("btnRestartLanding", () => { if (!confirm("Go back to your landing on floor " + save.data.landing.floor + "?")) return; hideAll(); game.startRun(true); });
  click("btnSettingsBack", back);
  click("btnGrimBack", back);
  click("btnRetry", () => { hideAll(); game.startRun(true); });
  click("btnDeathTitle", () => toTitle());
  click("btnEndless", () => { hideAll(); game.continueEndless(); });
  click("btnWinTitle", () => toTitle());
  click("btnPause", () => togglePause());
  click("btnBook", () => toggleBook());
  $("optInfMana").addEventListener("change", (e) => { S.sandbox.infiniteMana = e.target.checked; });
  $("optNoDeath").addEventListener("change", (e) => { S.sandbox.noDeath = e.target.checked; });
  // settings
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
    if (!confirm("Erase your spellbook, grimoire, settings and saved landing? This cannot be undone.")) return;
    save.resetAll();
    Object.assign(save.settings, DEFAULT_SETTINGS);
    applySettings(); renderSettings(); renderTitle();
    if (S.player) S.player.recompile();
  });
  forge.setCloseHandler(() => { forge.closeBook(); syncPause(); if (S.mode === "title") show("title"); });
  addEventListener("keydown", (e) => {
    if (!$("scr-boons").hidden) {
      const d = /^Digit([1-3])$/.exec(e.code);
      const ids = ($("boonCards").dataset.ids || "").split(",").filter(Boolean);
      if (d && ids[+d[1] - 1]) pickBoon(ids[+d[1] - 1]);
    }
  });
  on("bookClosed", () => syncPause());
  on("bookOpened", () => syncPause());
  applySettings();
}

export function busy() { return S.mode === "run" && !S.over; }
