/* menus.js — every screen that is not the game: the title, the solo setup,
 * the loadout, settings (with key binding), pause and results.
 *
 * The same rules as Magic Sandbox's menus: one stack of screens, one Escape
 * that goes back a step, one line of copy per thing and the rest behind an
 * (i). mpui.js adds the multiplayer screens to the same stack and may guard
 * Escape (a room is left with its own button, never by accident). */

import { S, on, emit } from "./state.js";
import { save } from "./save.js";
import { ACTIONS, codeName } from "./controls.js";
import { GUNS, GUN_IDS, MELEE, MELEE_IDS } from "./weapons.js";
import { MODES, DIFFS, DIFF_IDS } from "./modes.js";
import { hydrateIcons } from "./icons.js";
import { $, escHtml } from "./util.js";
import * as input from "./input.js";
import * as touch from "./touch.js";
import * as info from "./info.js";
import * as audio from "./audio.js";
import * as render from "./render.js";
import * as update from "./update.js";
import { boardHtml } from "./hud.js";

const stack = [];
let hooks = { escapeGuard: () => false, inRoom: () => false, pause: () => {} };
export function setHooks(h) { hooks = Object.assign(hooks, h); }

/* ---------------------------------------------------------------
   The stack
   --------------------------------------------------------------- */
function paint() {
  document.querySelectorAll("#menus .screen").forEach((s) => { s.hidden = true; });
  const t = stack[stack.length - 1];
  if (t) $("scr-" + t).hidden = false;
  document.body.classList.toggle("menuOpen", stack.length > 0);
  document.body.classList.toggle("atTitle", t === "title");
  $("menus").hidden = !stack.length;
}
export function show(id) {
  if (stack[stack.length - 1] === id) return;
  stack.push(id);
  if (id === "settings") renderSettings();
  if (id === "loadout") renderLoadout();
  if (id === "play") renderPlay();
  if (id === "pause") renderPause();
  paint();
  if (S.mode === "play") input.unlock();
}
export function back() {
  stack.pop();
  paint();
  if (!stack.length && S.mode === "play") resume();
}
export const isShown = (id) => stack[stack.length - 1] === id;
export const top = () => stack[stack.length - 1] || null;
export function toTitle() {
  stack.length = 0;
  stack.push("title");
  paint();
}
export function leaveTitle() { stack.length = 0; paint(); }
export function closeAll() { stack.length = 0; paint(); }

/* ---------------------------------------------------------------
   In a match: pause and resume
   --------------------------------------------------------------- */
function soloish() { return S.net.role === "solo"; }
export function pause() {
  if (S.mode !== "play" || stack.length) return;
  if (soloish()) S.paused = true;
  show("pause");
}
export function resume() {
  stack.length = 0; paint();
  if (S.mode !== "play") return;
  S.paused = false;
  if (!touch.isTouch()) input.lock();
}
function renderPause() {
  const m = S.match;
  $("pauseStats").textContent = m ? MODES[m.mode].name + (hooks.inRoom() ? " · online" : soloish() ? " · paused" : "") : "";
  $("pauseBoard").innerHTML = boardHtml();
  hooks.pause();
}

/* ---------------------------------------------------------------
   Solo setup
   --------------------------------------------------------------- */
function renderPlay() {
  const so = save.data.solo;
  if (so.mode === "practice") so.mode = "ffa";
  $("spMode").innerHTML = ["ffa", "tdm"].map((id) => '<button data-v="' + id + '" class="' + (so.mode === id ? "on" : "") + '">' + MODES[id].short + "</button>").join("");
  $("spDiff").innerHTML = DIFF_IDS.map((id) => '<button data-v="' + id + '" class="' + (so.diff === id ? "on" : "") + '">' + DIFFS[id].name + "</button>").join("");
  $("spBots").value = Math.max(1, so.bots); $("spBotsN").textContent = Math.max(1, so.bots);
  const T = MODES[so.mode].target;
  $("spTarget").min = T.min; $("spTarget").max = T.max; $("spTarget").step = T.step;
  if (so.target < T.min || so.target > T.max) so.target = T.def;
  $("spTarget").value = so.target; $("spTargetN").textContent = so.target;
}

/* ---------------------------------------------------------------
   Loadout
   --------------------------------------------------------------- */
function card(kind, id, name, cls, on, stats) {
  return '<button class="card' + (on ? " on" : "") + '" data-kind="' + kind + '" data-id="' + id + '"><b>' + escHtml(name) + '</b><small>' + escHtml(cls) + "</small>" + (stats ? '<span class="stats">' + stats + "</span>" : "") + "</button>";
}
function gunStats(g) {
  const bar = (v) => '<i style="--v:' + Math.max(0.05, Math.min(1, v)).toFixed(2) + '"></i>';
  const dps = g.dmg * (g.pellets || 1) * g.rpm / 60;
  return bar(g.dmg * (g.pellets || 1) / 100) + bar(dps / 250) + bar(1 - g.spread[0] / 7);
}
function renderLoadout() {
  const L = save.data.loadout;
  const guns = (slot) => GUN_IDS.map((id) => card(slot, id, GUNS[id].name, GUNS[id].cls, L[slot] === id, gunStats(GUNS[id]))).join("");
  $("loPrimary").innerHTML = guns("primary");
  $("loSecondary").innerHTML = guns("secondary");
  $("loMelee").innerHTML = MELEE_IDS.map((id) => card("melee", id, MELEE[id].name, id === "katana" ? "Fast charge, wide cut" : "Slow charge, long reach", L.melee === id)).join("");
}
function pickLoadout(kind, id) {
  const L = save.data.loadout;
  if (kind !== "melee" && L[kind === "primary" ? "secondary" : "primary"] === id) L[kind === "primary" ? "secondary" : "primary"] = L[kind];
  L[kind] = id;
  save.commit();
  renderLoadout();
  if (S.me) S.me.loadout = Object.assign({}, L);
  emit("loadout", L);
}

/* ---------------------------------------------------------------
   Settings
   --------------------------------------------------------------- */
function seg(el, v) { el.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.v === v)); }
function renderSettings() {
  const s = save.settings;
  const num = (id, v, d) => { $(id).value = v; $(id + "N").textContent = (+v).toFixed(d); };
  num("stSens", s.sens, 1); num("stAds", s.adsSens, 2); num("stFov", s.fov, 0);
  num("stMaster", s.master, 2); num("stSfx", s.sfx, 2); num("stTouchLook", s.touchLook, 2);
  $("stInvert").checked = s.invertY; $("stPauseEdit").checked = s.pauseEditing;
  $("stSpeed").checked = s.showSpeed; $("stFps").checked = s.showFps; $("stTouchSprint").checked = s.touchAutoSprint;
  $("stCross").value = s.crosshair;
  seg($("stSprint"), s.sprintMode); seg($("stCrouch"), s.crouchMode); seg($("stQuality"), s.quality);
  renderBinds();
}
function renderBinds() {
  const b = save.data.binds;
  $("bindList").innerHTML = ACTIONS.map((a) => '<div class="bind"><span>' + escHtml(a.label) + "</span>" +
    [0, 1].map((i) => '<button class="key' + (b[a.id][i] ? "" : " empty") + '" data-act="' + a.id + '" data-i="' + i + '">' + escHtml(codeName(b[a.id][i])) + "</button>").join("") + "</div>").join("");
}
async function rebind(act, i) {
  const a = ACTIONS.find((x) => x.id === act);
  $("bindWhat").textContent = a.label;
  $("bindCapture").hidden = false;
  const code = await input.captureBind();
  $("bindCapture").hidden = true;
  if (code === null) return;
  const b = save.data.binds;
  // a key does one thing: take it off anything else first
  if (code) for (const id in b) for (let k = 0; k < 2; k++) if (b[id][k] === code) b[id][k] = "";
  b[act][i] = code;
  save.commit();
  renderBinds();
}
function tab(name) {
  document.querySelectorAll("#setTabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
  document.querySelectorAll("#scr-settings .tabpane").forEach((p) => { p.hidden = p.dataset.pane !== name; });
}

/* ---------------------------------------------------------------
   Results
   --------------------------------------------------------------- */
export function showResults(m) {
  const M = MODES[m.mode];
  let title = "", sub = "", win = false;
  if (M.teams) {
    win = S.me && m.winner === S.me.team;
    title = m.winner === -1 || m.winner == null ? "A draw" : ["Cyan", "Orange"][m.winner] + " win";
    sub = win ? "Your side took it" : "The other side took it";
  } else {
    const w = S.actors.find((a) => a.id === m.winner);
    win = S.me && m.winner === S.me.id;
    title = win ? "You win" : w ? w.name + " wins" : "Time";
    sub = M.target ? "First to " + m.settings.target : "";
  }
  $("resTitle").textContent = title;
  $("resTitle").className = win ? "gold" : "";
  $("resSub").textContent = sub + (S.topSpeed ? " · your top speed " + S.topSpeed.toFixed(1) + " m/s" : "");
  $("resBoard").innerHTML = boardHtml();
  const room = hooks.inRoom();
  $("btnResAgain").hidden = room;
  $("btnResBack").hidden = !room;
  input.unlock();
  stack.length = 0;
  show("results");
}

/* ---------------------------------------------------------------
   Wiring
   --------------------------------------------------------------- */
const click = (id, fn) => $(id).addEventListener("click", (e) => { emit("ui"); fn(e); });

export function init() {
  hydrateIcons(document);
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("[data-back]");
    if (b) { emit("ui"); back(); }
  });
  addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !$("bindCapture").hidden || info.isOpen()) return;
    if (document.body.classList.contains("hacking")) { emit("closeHacks"); return; }
    if (touch.isEditing()) { touch.edit(false); return; }
    const t = top();
    if (!t) { pause(); return; }
    if (t === "title" || hooks.escapeGuard(t)) return;
    back();
  });
  on("menu", () => { if (!stack.length) pause(); });
  // title
  click("btnPlay", () => show("play"));
  click("btnPractice", () => emit("startSolo", { mode: "practice", bots: 0 }));
  click("btnLoadout", () => show("loadout"));
  click("btnSettings", () => show("settings"));
  click("btnHacksTitle", () => emit("openHacks"));
  $("verLine").textContent = "Version " + update.version();
  click("btnCheckUpdate", async () => {
    const r = await update.checkNow();
    emit("toastTitle", r);
    $("btnCheckUpdate").textContent = r === "ready" ? "Update ready" : r === "current" ? "Up to date" : r === "offline" ? "Offline" : r === "downloading" ? "Downloading…" : "Check for updates";
  });
  // solo setup
  $("spMode").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; save.data.solo.mode = b.dataset.v; save.data.solo.target = MODES[b.dataset.v].target.def; save.commit(); renderPlay(); });
  $("spDiff").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; save.data.solo.diff = b.dataset.v; save.commit(); renderPlay(); });
  $("spBots").addEventListener("input", (e) => { save.data.solo.bots = +e.target.value; $("spBotsN").textContent = e.target.value; });
  $("spTarget").addEventListener("input", (e) => { save.data.solo.target = +e.target.value; $("spTargetN").textContent = e.target.value; });
  $("spBots").addEventListener("change", () => save.commit());
  $("spTarget").addEventListener("change", () => save.commit());
  click("btnPlayGo", () => emit("startSolo", Object.assign({}, save.data.solo)));
  // loadout
  $("scr-loadout").addEventListener("click", (e) => { const c = e.target.closest(".card"); if (c) { emit("ui"); pickLoadout(c.dataset.kind, c.dataset.id); } });
  // settings
  $("setTabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) tab(b.dataset.tab); });
  const range = (id, key, d, after) => $(id).addEventListener("input", (e) => { save.settings[key] = +e.target.value; $(id + "N").textContent = (+e.target.value).toFixed(d); if (after) after(); save.commit(); });
  range("stSens", "sens", 1); range("stAds", "adsSens", 2); range("stFov", "fov", 0); range("stTouchLook", "touchLook", 2);
  range("stMaster", "master", 2, audio.applyVolumes); range("stSfx", "sfx", 2, audio.applyVolumes);
  const tog = (id, key) => $(id).addEventListener("change", (e) => { save.settings[key] = e.target.checked; save.commit(); });
  tog("stInvert", "invertY"); tog("stPauseEdit", "pauseEditing"); tog("stSpeed", "showSpeed"); tog("stFps", "showFps"); tog("stTouchSprint", "touchAutoSprint");
  $("stCross").addEventListener("input", (e) => { save.settings.crosshair = e.target.value; save.commit(); });
  const segSet = (id, key, after) => $(id).addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; save.settings[key] = b.dataset.v; save.commit(); seg($(id), b.dataset.v); if (after) after(b.dataset.v); });
  segSet("stSprint", "sprintMode"); segSet("stCrouch", "crouchMode"); segSet("stQuality", "quality", (q) => render.setQuality(q));
  $("bindList").addEventListener("click", (e) => { const b = e.target.closest(".key"); if (b) rebind(b.dataset.act, +b.dataset.i); });
  click("btnResetKeys", () => { if (confirm("Put every key back the way it started?")) { save.resetBinds(); renderBinds(); } });
  click("btnEditTouch", () => { closeAll(); touch.edit(true); });
  on("touchEditDone", () => { if (S.mode === "play") pause(); else { toTitle(); show("settings"); tab("touch"); } });
  // pause
  click("btnResume", resume);
  click("btnPauseHacks", () => { closeAll(); emit("openHacks"); });
  click("btnPauseLoadout", () => show("loadout"));
  click("btnPauseSettings", () => show("settings"));
  click("btnQuit", () => {
    if (hooks.inRoom()) { emit("mpLeave"); return; }
    emit("quitMatch");
  });
  // results
  click("btnResAgain", () => emit("startSolo", S.lastSolo || Object.assign({}, save.data.solo)));
  click("btnResLeave", () => { if (hooks.inRoom()) emit("mpLeave"); else emit("quitMatch"); });
  on("matchEnd", (m) => setTimeout(() => { if (S.match === m) showResults(m); }, 1400));
}
