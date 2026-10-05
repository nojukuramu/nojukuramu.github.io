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
import { createEditor, highlight } from "./editor.js";
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
/* Learn is one lesson at a time beside the list of all of them — the old page stacked fourteen
 * lessons and their code into one scroll, which nobody can find their place in. The lesson you
 * were on is remembered for as long as the page is open; a fresh visit starts at the first one
 * you have not opened yet. */
let lessonId = null;
const splitTitle = (t) => { const m = /^(\d+) · (.*)$/.exec(t); return m ? [m[1], m[2]] : ["", t]; };
function renderLearn() {
  const done = save.data.lessons;
  if (!LESSONS.some((L) => L.id === lessonId)) lessonId = (LESSONS.find((L) => !done.includes(L.id)) || LESSONS[0]).id;
  const i = LESSONS.findIndex((L) => L.id === lessonId), L = LESSONS[i];
  const nDone = LESSONS.filter((x) => done.includes(x.id)).length;
  const nav = LESSONS.map((x) => {
    const [n, t] = splitTitle(x.title);
    const cls = (x.id === lessonId ? " on" : "") + (done.includes(x.id) ? " done" : "");
    return '<button class="lrow' + cls + '" data-goto="' + x.id + '"' + (x.id === lessonId ? ' aria-current="true"' : "") + '><b class="lnum">' + (done.includes(x.id) ? icon("check") : n) + '</b><span class="lt">' + escHtml(t) + "</span></button>";
  }).join("");
  const [num, title] = splitTitle(L.title);
  const prev = LESSONS[i - 1], next = LESSONS[i + 1];
  const pager = (x, dir) => x ? '<button class="btn ghost small" data-goto="' + x.id + '">' + (dir < 0 ? icon("prev") : "") + '<span>' + escHtml(splitTitle(x.title)[1]) + "</span>" + (dir > 0 ? icon("next") : "") + "</button>" : "<span></span>";
  $("hpLearn").innerHTML =
    '<div class="learn">' +
      '<nav class="lnav" aria-label="Lessons"><p class="lprog"><b>' + nDone + "</b> of " + LESSONS.length + ' opened<i style="--p:' + (nDone / LESSONS.length).toFixed(3) + '"></i></p><div class="lrows">' + nav + "</div></nav>" +
      '<div class="lscroll"><article class="lesson">' +
        '<p class="lkick">Lesson ' + num + " of " + LESSONS.length + " · " + escHtml(L.learn) + "</p>" +
        "<h2>" + escHtml(title) + "</h2>" +
        '<div class="lbody">' + L.body + "</div>" +
        '<div class="lcode"><div class="lcode-head"><span class="mono">' + escHtml(L.id) + '.js</span><button class="linkbtn" data-copy="' + L.id + '">' + icon("copy") + "Copy</button></div>" +
          '<pre class="code">' + highlight(L.code) + "</pre></div>" +
        '<div class="lact"><button class="btn primary" data-lesson="' + L.id + '">' + icon("play") + "Open and run it</button></div>" +
        '<div class="lpager">' + pager(prev, -1) + pager(next, 1) + "</div>" +
      "</article></div>" +
    "</div>";
  const on = $("hpLearn").querySelector(".lrow.on");
  if (on && on.scrollIntoView) on.scrollIntoView({ block: "nearest", inline: "nearest" });
}
function gotoLesson(id) {
  lessonId = id;
  renderLearn();
  const pane = document.querySelector('#hackPanel [data-hpane="learn"]');
  if (pane) pane.scrollTop = 0;
  const art = $("hpLearn").querySelector(".lscroll");
  if (art) art.scrollTop = 0;
}
/* The API is long, so it can be filtered: a word narrows every section to the lines that mention it. */
function renderApi() {
  $("hpApi").innerHTML = '<div class="apidoc"><h2>What a hack can use</h2>' + ABOUT_API +
    '<label class="apifind">' + icon("search") + '<input id="hpApiFind" class="txt" type="search" placeholder="Filter, e.g. bones, aim, draw" autocomplete="off" spellcheck="false" aria-label="Filter the API"></label>' +
    API.map((sec) => '<section class="apisec"><h3>' + escHtml(sec.name) + '</h3><dl class="api">' +
      sec.items.map(([k, v]) => '<div class="apiitem"><dt><code>' + escHtml(k) + "</code></dt><dd>" + escHtml(v) + "</dd></div>").join("") + "</dl></section>").join("") +
    '<p class="muted apinone" hidden>Nothing matches that.</p></div>';
}
function filterApi(q) {
  q = q.trim().toLowerCase();
  let any = false;
  document.querySelectorAll("#hpApi .apisec").forEach((sec) => {
    let n = 0;
    sec.querySelectorAll(".apiitem").forEach((it) => { const hit = !q || it.textContent.toLowerCase().includes(q); it.hidden = !hit; if (hit) n++; });
    sec.hidden = !n; if (n) any = true;
  });
  const none = document.querySelector("#hpApi .apinone");
  if (none) none.hidden = any;
}
function tab(name) {
  document.querySelectorAll("#hpTabs button").forEach((b) => b.classList.toggle("on", b.dataset.htab === name));
  document.querySelectorAll("#hackPanel [data-hpane]").forEach((p) => { p.hidden = p.dataset.hpane !== name; });
  $("hpList").hidden = name !== "code";
  if (name === "learn") renderLearn();
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
    const go = e.target.closest("[data-goto]");
    if (go) { gotoLesson(go.dataset.goto); return; }
    const cp = e.target.closest("[data-copy]");
    if (cp) {
      const L = LESSONS.find((x) => x.id === cp.dataset.copy);
      try { navigator.clipboard.writeText(L.code).then(() => { cp.lastChild.textContent = "Copied"; setTimeout(() => { cp.lastChild.textContent = "Copy"; }, 1400); }, () => {}); } catch (err) { /* no clipboard here */ }
      return;
    }
    const b = e.target.closest("[data-lesson]");
    if (!b) return;
    const L = LESSONS.find((x) => x.id === b.dataset.lesson);
    if (!save.data.lessons.includes(L.id)) { save.data.lessons.push(L.id); save.commit(); }
    tab("code");
    add(L.title.replace(/^\d+ · /, ""), L.code, true);
  });
  $("hpApi").addEventListener("input", (e) => { if (e.target.id === "hpApiFind") filterApi(e.target.value); });
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
