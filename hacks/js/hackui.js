/* hackui.js — the hacks panel: your hacks, the editor, the console, the
 * switches a hack makes for itself, and the Learn and API tabs.
 *
 * It opens over the game (H, or the code button), and the game keeps going
 * behind it in multiplayer; alone, it pauses unless you switch that off.
 * Editing never changes a running hack — Run does, so a half-typed line can
 * never be what is steering you. */

import { S, on } from "./state.js";
import { save, newId, MAX_HACKS, cleanHack } from "./save.js";
import * as hackapi from "./hackapi.js";
import { createEditor } from "./editor.js";
import { LESSONS, API, ABOUT_API } from "./hackdocs.js";
import { HACK_RULES } from "./modes.js";
import { icon, hydrateIcons } from "./icons.js";
import { $, escHtml } from "./util.js";
import { codeName } from "./controls.js";
import * as input from "./input.js";

let ed = null, sel = null, open = false, pausedByUs = false, saveTimer = 0;
let shown = null;          // the hack whose code is in the editor right now (null: none yet)
const hackById = (id) => save.data.hacks.find((h) => h.id === id) || null;

export const isOpen = () => open;
export function show(on) {
  if (on === open) return;
  open = on;
  $("hackPanel").hidden = !on;
  document.body.classList.toggle("hacking", on);
  if (on) {
    input.unlock();
    if (S.mode === "play" && S.net.role === "solo" && save.settings.pauseEditing && !S.paused) { S.paused = true; pausedByUs = true; }
    hackapi.start();
    if (!sel || !hackById(sel)) sel = save.data.hacks[0] ? save.data.hacks[0].id : null;
    renderAll();
  } else {
    flushSave();
    if (pausedByUs) { S.paused = false; pausedByUs = false; }
    if (S.mode === "play" && !document.body.classList.contains("menuOpen") && !matchMedia("(pointer: coarse)").matches) input.lock();
  }
}

/* ---------------------------------------------------------------
   The list
   --------------------------------------------------------------- */
function renderList() {
  const box = $("hpList");
  const rows = save.data.hacks.map((h) => {
    const st = hackapi.statusOf(h.id);
    const dot = st.state === "on" ? "on" : st.state === "error" ? "err" : st.state === "loading" ? "wait" : "";
    return '<div class="hrow' + (h.id === sel ? " sel" : "") + '" data-id="' + h.id + '"><i class="dot ' + dot + '"></i><span class="hn">' + escHtml(h.name) + "</span>" +
      '<label class="sw" aria-label="Run ' + escHtml(h.name) + '"><input type="checkbox" data-run="' + h.id + '"' + (h.on ? " checked" : "") + "><span></span></label></div>";
  }).join("");
  box.innerHTML = rows + '<button id="hpNew" class="btn ghost small wide">' + icon("plus") + "New hack</button>" +
    (save.data.hacks.length ? "" : '<p class="muted small">No hacks yet.</p>');
}
function renderRules() {
  const r = hackapi.rules();
  $("hpRules").textContent = "Allowed: " + HACK_RULES[r].name;
  $("hpRules").className = "rules r-" + r;
}

/* ---------------------------------------------------------------
   The editor side
   --------------------------------------------------------------- */
function select(id) {
  flushSave();
  sel = id;
  const h = hackById(id);
  $("hpName").value = h ? h.name : "";
  $("hpName").disabled = !h;
  ed.value = h ? h.code : "";
  shown = h ? h.id : null;
  ed.readOnly(!h);
  const st = h ? hackapi.statusOf(h.id) : null;
  ed.setError(st && st.state === "error" ? st.line : 0);
  renderList(); renderUi(); renderLog(); renderButtons();
}
function renderButtons() {
  const h = hackById(sel);
  const st = h ? hackapi.statusOf(h.id) : { state: "off" };
  $("hpRun").disabled = !h;
  $("hpStop").disabled = !h || st.state === "off";
  $("hpRun").lastChild.textContent = st.state === "on" ? "Run again" : "Run";
}
/* Only ever write the editor's text back to the hack it was loaded from. */
function flushSave() {
  clearTimeout(saveTimer);
  const h = shown && hackById(shown);
  if (h && ed && h.code !== ed.value) { h.code = ed.value.slice(0, 100000); save.commit(); }
}
function runSel() {
  const h = hackById(sel);
  if (!h) return;
  flushSave();
  ed.setError(0);
  hackapi.run(h.id);
}

/* The switches a hack made for itself (ui.toggle, ui.slider …). */
function renderUi() {
  const box = $("hpUi");
  const st = sel ? hackapi.statusOf(sel) : null;
  const ctl = st && st.state === "on" && Array.isArray(st.ui) ? st.ui : [];
  box.hidden = !ctl.length;
  box.innerHTML = ctl.map((c, i) => {
    const id = "hu" + i, lab = escHtml(c.label);
    if (c.kind === "toggle") return '<label class="tog small"><input type="checkbox" data-ui="' + i + '"' + (c.value ? " checked" : "") + "><span>" + lab + "</span></label>";
    if (c.kind === "slider") return '<div class="setrow small"><label for="' + id + '">' + lab + ' <b class="num">' + fmtNum(c.value) + '</b></label><input type="range" id="' + id + '" data-ui="' + i + '" min="' + c.min + '" max="' + c.max + '" step="' + c.step + '" value="' + c.value + '"></div>';
    if (c.kind === "key") return '<div class="setrow small"><label>' + lab + '</label><button class="key" data-ui="' + i + '">' + escHtml(codeName(c.value)) + "</button></div>";
    if (c.kind === "color") return '<div class="setrow small"><label for="' + id + '">' + lab + '</label><input type="color" id="' + id + '" data-ui="' + i + '" value="' + escHtml(c.value) + '"></div>';
    return "";
  }).join("");
}
const fmtNum = (v) => (Math.abs(v) >= 10 || Number.isInteger(v) ? String(Math.round(v * 10) / 10) : v.toFixed(2));
function uiChange(el, commit) {
  const st = hackapi.statusOf(sel);
  const c = st && st.ui && st.ui[+el.dataset.ui];
  if (!c) return;
  let v = c.kind === "toggle" ? el.checked : c.kind === "slider" ? +el.value : el.value;
  if (c.kind === "slider") { const b = el.parentElement.querySelector(".num"); if (b) b.textContent = fmtNum(v); }
  if (commit || c.kind !== "slider") hackapi.setUi(sel, c.label, v); else { c.value = v; hackapi.setUi(sel, c.label, v); }
}

/* ---------------------------------------------------------------
   The console
   --------------------------------------------------------------- */
let logDirty = false;
function renderLog() {
  logDirty = false;
  const box = $("hpLog");
  const lines = hackapi.logs.filter((l) => !l.id || l.id === sel).slice(-150);
  box.innerHTML = lines.map((l) => '<div class="ll ' + l.kind + '">' + escHtml(l.text) + "</div>").join("") || '<div class="ll muted">Nothing yet. log(…) writes here.</div>';
  box.scrollTop = box.scrollHeight;
  const st = sel ? hackapi.statusOf(sel) : null;
  $("hpPerf").textContent = st && st.state === "on" && st.perf != null ? st.perf.toFixed(2) + " ms a frame" : "";
}

/* ---------------------------------------------------------------
   Learn and API
   --------------------------------------------------------------- */
function renderLearn() {
  $("hpLearn").innerHTML = '<h2>Learn to code by writing hacks</h2><p class="muted">Each lesson is a working hack and the idea behind it. Open one, read it, run it, then change it.</p>' +
    LESSONS.map((L) => '<article class="lesson' + (save.data.lessons.includes(L.id) ? " done" : "") + '"><h3>' + escHtml(L.title) + '</h3><p class="learns">' + escHtml(L.learn) + "</p>" + L.body +
      '<pre class="code">' + escHtml(L.code) + '</pre><button class="btn primary small" data-lesson="' + L.id + '">' + icon("code") + "Open as a new hack</button></article>").join("");
}
function renderApi() {
  $("hpApi").innerHTML = "<h2>What a hack can use</h2>" + ABOUT_API + API.map((sec) => "<h3>" + escHtml(sec.name) + '</h3><dl class="api">' +
    sec.items.map(([k, v]) => "<dt><code>" + escHtml(k) + "</code></dt><dd>" + escHtml(v) + "</dd>").join("") + "</dl>").join("");
}
function tab(name) {
  document.querySelectorAll("#hpTabs button").forEach((b) => b.classList.toggle("on", b.dataset.htab === name));
  document.querySelectorAll("#hackPanel [data-hpane]").forEach((p) => { p.hidden = p.dataset.hpane !== name; });
  $("hpList").hidden = name !== "code";
}

/* ---------------------------------------------------------------
   Making, copying, removing
   --------------------------------------------------------------- */
function add(name, code, on) {
  if (save.data.hacks.length >= MAX_HACKS) { alert("You have " + MAX_HACKS + " hacks — delete one to make room."); return null; }
  let n = name, k = 2;
  while (save.data.hacks.some((h) => h.name === n)) n = name + " " + k++;
  const h = { id: newId(), name: n.slice(0, 32), code, on: false };
  save.data.hacks.push(h);
  save.commit();
  select(h.id);
  if (on) runSel();
  return h;
}
function more(act) {
  $("hpMenu").hidden = true;
  const h = hackById(sel);
  if (!h) return;
  flushSave();
  if (act === "dup") add(h.name + " copy", h.code, false);
  else if (act === "copy") { try { navigator.clipboard.writeText(h.code); hackapi.log(h.id, "info", "Code copied"); } catch (e) { hackapi.log(h.id, "warn", "The clipboard is not available here"); } }
  else if (act === "export") {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([h.code], { type: "text/javascript" }));
    a.download = h.name.replace(/[^\w-]+/g, "_") + ".js";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  } else if (act === "import") $("hpFile").click();
  else if (act === "delete") {
    if (!confirm("Delete " + h.name + "? Save it as a file first if you might want it back.")) return;
    hackapi.stop(h.id);
    save.data.hacks = save.data.hacks.filter((x) => x.id !== h.id);
    shown = null;
    save.commit();
    sel = save.data.hacks[0] ? save.data.hacks[0].id : null;
    select(sel);
  }
}

function renderAll() { renderRules(); renderList(); select(sel); renderLearn(); renderApi(); }

/* ---------------------------------------------------------------
   Wiring
   --------------------------------------------------------------- */
export function init() {
  hydrateIcons($("hackPanel"));
  ed = createEditor($("editor"), { onRun: runSel, onChange: () => { clearTimeout(saveTimer); saveTimer = setTimeout(flushSave, 600); } });
  on("toggleHacks", () => show(!open));
  on("openHacks", () => show(true));
  on("closeHacks", () => show(false));
  $("hpClose").addEventListener("click", () => show(false));
  $("hpTabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) tab(b.dataset.htab); });
  $("hpList").addEventListener("click", (e) => {
    if (e.target.closest("#hpNew")) { add("New hack", "// What will this one do?\n\non(\"draw\", () => {\n  \n});\n", false); ed.focus(); return; }
    if (e.target.closest(".sw")) return;
    const row = e.target.closest(".hrow");
    if (row) select(row.dataset.id);
  });
  $("hpList").addEventListener("change", (e) => {
    const id = e.target.dataset && e.target.dataset.run;
    if (!id) return;
    if (id === sel) flushSave();
    if (e.target.checked) hackapi.run(id); else hackapi.stop(id);
  });
  $("hpName").addEventListener("input", (e) => {
    const h = hackById(sel);
    if (!h) return;
    h.name = cleanHack({ id: h.id, name: e.target.value, code: "" }, 0).name;
    save.commit();
    const row = document.querySelector('.hrow[data-id="' + h.id + '"] .hn');
    if (row) row.textContent = h.name;
  });
  $("hpRun").addEventListener("click", runSel);
  $("hpStop").addEventListener("click", () => { if (sel) hackapi.stop(sel); });
  $("hpMore").addEventListener("click", () => { $("hpMenu").hidden = !$("hpMenu").hidden; });
  $("hpMenu").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) more(b.dataset.act); });
  $("hpClear").addEventListener("click", () => { hackapi.logs.length = 0; renderLog(); });
  $("hpFile").addEventListener("change", async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f || f.size > 100000) { if (f) alert("That file is larger than a hack can be (100 KB)."); return; }
    const text = await f.text();
    add(f.name.replace(/\.(js|txt)$/i, "").slice(0, 32) || "Imported", text, false);
  });
  $("hpUi").addEventListener("input", (e) => { if (e.target.dataset.ui != null && e.target.type === "range") uiChange(e.target, false); });
  $("hpUi").addEventListener("change", (e) => { if (e.target.dataset.ui != null) uiChange(e.target, true); });
  $("hpUi").addEventListener("click", async (e) => {
    const b = e.target.closest("button.key");
    if (!b) return;
    const st = hackapi.statusOf(sel), c = st.ui[+b.dataset.ui];
    $("bindWhat").textContent = c.label;
    $("bindCapture").hidden = false;
    const code = await input.captureBind();
    $("bindCapture").hidden = true;
    if (code === null) return;
    hackapi.setUi(sel, c.label, code);
    renderUi();
  });
  $("hpLearn").addEventListener("click", (e) => {
    const b = e.target.closest("[data-lesson]");
    if (!b) return;
    const L = LESSONS.find((x) => x.id === b.dataset.lesson);
    if (!save.data.lessons.includes(L.id)) { save.data.lessons.push(L.id); save.commit(); }
    tab("code");
    add(L.title.replace(/^\d+ · /, ""), L.code, true);
  });
  on("hacksChanged", () => {
    if (!open) return;
    renderList(); renderButtons(); renderUi(); renderRules();
    const st = sel ? hackapi.statusOf(sel) : null;
    ed.setError(st && st.state === "error" ? st.line : 0);
    logDirty = true;
  });
  on("hackLog", () => { logDirty = true; });
  setInterval(() => { if (open && logDirty) renderLog(); else if (open) { const st = sel ? hackapi.statusOf(sel) : null; $("hpPerf").textContent = st && st.state === "on" && st.perf != null ? st.perf.toFixed(2) + " ms a frame" : ""; } }, 250);
  on("matchStart", () => { if (open) renderRules(); });
  addEventListener("pagehide", flushSave);
}
