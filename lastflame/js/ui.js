/* ui.js — the screens around the night, and the few words shown during it.
 *
 * The shape is Ballzooka's (ballzooka/js/ui.js): one #screen element that
 * every menu is drawn into, buttons named by data-act and handled in one
 * place, and the (i) beside anything that needs explaining (info.js). The
 * look is this game's: black, candle-warm, a serif, and as little as can be.
 *
 * During a night there is no HUD — no meter, no map, no number. There is a
 * line at the top when the game has something to teach, a line at the bottom
 * when there is something in reach, captions if you asked for them, and the
 * words for your oil when you lift the lantern to look at it. */

import { S, save } from "./save.js";
import { icon, hydrateIcons } from "./icons.js";
import { FEAR } from "./game.js";
import { NOTES } from "./topics.js";
import * as upd from "./update.js";

const $ = (id) => document.getElementById(id);
let A = {};
let current = null;

export function init(actions) {
  A = actions;
  $("screen").addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b || b.disabled) return;
    const act = b.getAttribute("data-act"), arg = b.getAttribute("data-arg");
    if (ACT[act]) ACT[act](arg, b);
  });
  $("screen").addEventListener("input", (e) => {
    const r = e.target.closest("[data-range]");
    if (!r) return;
    S.set[r.getAttribute("data-range")] = parseFloat(r.value);
    save(); A.apply();
  });
  $("note").addEventListener("click", () => hideNote());
  upd.onChange(() => { if (current === "settings") show("settings"); });
}

const info = (key) => '<button class="info" data-info="' + key + '" aria-label="More about this">' + icon("info") + "</button>";
const btn = (act, arg, label, cls, ico, disabled) => '<button class="btn ' + (cls || "") + '" data-act="' + act + '"' + (arg !== null && arg !== undefined ? ' data-arg="' + arg + '"' : "") + (disabled ? " disabled" : "") + ">" + (ico ? icon(ico) : "") + "<span>" + label + "</span></button>";
const seg = (key, opts, topic) => '<div class="row"><div class="lbl">' + opts.label + (topic ? info(topic) : "") + '</div><div class="seg">' +
  opts.items.map(([v, l]) => '<button data-act="set" data-arg="' + key + ":" + v + '" class="' + (String(S.set[key]) === String(v) ? "on" : "") + '">' + l + "</button>").join("") + "</div></div>";
const range = (key, label, min, max, step) => '<div class="row"><div class="lbl">' + label + '</div><input type="range" data-range="' + key + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + S.set[key] + '"></div>';
const time = (s) => Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");

export function show(name, data) {
  current = name;
  const el = $("screen");
  el.className = "s-" + name;
  el.hidden = false;
  let h = "";
  switch (name) {
    case "title": {
      const p = A.progress ? A.progress() : 1;
      const done = p >= 1;
      h = `<div class="title">
        <div class="mark">${icon("flame", "big")}</div>
        <h1>Last Flame</h1>
        <p class="sub">Huling Ilaw</p>
        <p class="line">A typhoon. A brownout. Five lamps, and something in Lola's house.</p>
        <div class="col">
          ${btn("begin", null, done ? "Begin the night" : "Opening the house… " + Math.round(p * 100) + "%", "primary big", "lantern", !done)}
          <div class="pair">${btn("settings", null, "Settings", "ghost", "gear")}${btn("help", null, "How to play", "ghost", "info")}</div>
        </div>
        <p class="small">${icon("headphones")} Best with headphones, in the dark.</p>
        ${S.stats.nights ? '<p class="small dim">' + S.stats.escaped + " of " + S.stats.nights + " nights survived" + (S.stats.best ? " · fastest " + time(S.stats.best) : "") + "</p>" : ""}
        <button class="about" data-info="about">About this game</button>
      </div>`;
      break;
    }
    case "pause":
      h = `<div class="card">
        <h2>Paused</h2>
        <p class="dim">${data && data.lit !== undefined ? data.lit + " of 5 lamps burning" : ""}</p>
        <div class="col">${btn("resume", null, "Go on", "primary", "play")}${btn("settings", "pause", "Settings", "", "gear")}${btn("help", null, "How to play", "ghost", "info")}${btn("quit", null, "Leave the house", "ghost", "home")}</div>
      </div>`;
      break;
    case "settings": {
      const u = upd.state();
      h = `<div class="card wide">
        <div class="head"><h2>Settings</h2><button class="ibtn" data-act="back" aria-label="Back">${icon("close")}</button></div>
        ${seg("fear", { label: "How afraid", items: Object.entries(FEAR).map(([k, v]) => [k, v.label]) }, "fear")}
        ${seg("mode", { label: "When it catches you", items: [["lola", "Lola's Rules"], ["onenight", "One Night"]] }, "mode")}
        ${seg("scares", { label: "Jump scares", items: [["full", "Full"], ["reduced", "Reduced"]] }, "scares")}
        ${seg("motion", { label: "Head bob and shaking", items: [[true, "On"], [false, "Off"]] }, "motion")}
        ${seg("captions", { label: "Sound captions", items: [[false, "Off"], [true, "On"]] }, "captions")}
        ${seg("crouchToggle", { label: "Crouch", items: [[true, "Toggle"], [false, "Hold"]] })}
        ${seg("invert", { label: "Invert looking up", items: [[false, "Off"], [true, "On"]] })}
        ${range("sens", "Look speed", 0.3, 2.5, 0.05)}
        ${range("fov", "Field of view", 60, 95, 1)}
        ${range("bright", "Brightness", 0, 1, 0.05)}
        ${range("volume", "Volume", 0, 1, 0.05)}
        ${seg("quality", { label: "Graphics", items: [["auto", "Auto"], ["high", "Shadows"], ["low", "Fast"]] }, "quality")}
        <h3>Version ${info("update")}</h3>
        <div class="row"><div class="lbl">Last Flame ${u.version}<small id="updState">${u.ready ? "A new version is ready." : u.supported ? "Checked every 30 minutes." : "Updates need the installed app."}</small></div>
        ${u.ready ? btn("updApply", null, "Reload", "small primary") : btn("updCheck", null, "Check for updates", "small")}</div>
      </div>`;
      el.dataset.back = data || "title";
      break;
    }
    case "won": {
      const st = data.stats;
      h = `<div class="card center">
        <div class="mark dawn">${icon("moon", "big")}</div>
        <h2>You got out.</h2>
        <p class="line">The rain thinned to nothing, and somewhere a rooster started up.</p>
        <div class="stats">
          <div><b>${time(st.time)}</b><small>the night</small></div>
          <div><b>${st.deaths}</b><small>${st.deaths === 1 ? "time caught" : "times caught"}</small></div>
          <div><b>${st.hides}</b><small>${st.hides === 1 ? "time hidden" : "times hidden"}</small></div>
          <div><b>${st.notes}/3</b><small>notes found</small></div>
        </div>
        <div class="col">${btn("again", null, "Another night", "primary", "lantern")}${btn("toTitle", null, "Title", "ghost", "home")}</div>
      </div>`;
      break;
    }
    case "dead":
      h = `<div class="card center">
        <div class="mark red">${icon("skull", "big")}</div>
        <h2>The night took you.</h2>
        <p class="line">${data.lit} of 5 lamps were burning.</p>
        <div class="col">${btn("again", null, "A new night", "primary", "lantern")}${btn("toTitle", null, "Title", "ghost", "home")}</div>
      </div>`;
      break;
  }
  el.innerHTML = h;
  hydrateIcons(el);
}

export function hide() { current = null; $("screen").hidden = true; $("screen").innerHTML = ""; }
export const showing = () => current;

const ACT = {
  begin: () => A.begin(),
  settings: (from) => show("settings", from || current || "title"),
  help: () => A.info("play"),
  back: () => { const b = $("screen").dataset.back || "title"; if (b === "pause") show("pause", A.pauseData()); else show("title"); },
  resume: () => A.resume(),
  quit: () => { if (window.confirm("Leave the house? Tonight's lamps go out.")) A.quit(); },
  again: () => A.again(),
  toTitle: () => A.quit(),
  set: (arg) => {
    const [k, v] = arg.split(":");
    S.set[k] = v === "true" ? true : v === "false" ? false : v;
    save(); A.apply();
    show("settings", $("screen").dataset.back);
  },
  updCheck: () => { const st = $("updState"); if (st) st.textContent = "Checking…"; upd.checkNow().then((r) => { const s2 = $("updState"); if (s2) s2.textContent = r === "ready" ? "A new version is ready." : r === "current" ? "You are up to date." : r === "downloading" ? "Downloading a new version…" : r === "offline" ? "Offline: could not check." : "Updates need the installed app."; }); },
  updApply: () => upd.apply()
};

/* ---------- during the night ---------- */

let hintT = 0, captionsOn = false;
export function hud(on) { $("hud").hidden = !on; document.body.classList.toggle("playing", !!on); }
export function touchControls(on) { $("touch").hidden = !on; }

/* [interact] and friends become the key, or the button, the player has. */
function keysFor(text, touch) {
  const K = touch ? { interact: "the hand", lantern: "the lantern", crouch: "the crouch button", breath: "the breath button" } : { interact: "E", lantern: "F", crouch: "C", breath: "Space" };
  return text.replace(/\[(\w+)\]/g, (m, k) => '<span class="key">' + (K[k] || k) + "</span>");
}
export function hint(text, touch) {
  const el = $("hint");
  if (!text) { el.classList.remove("in"); return; }
  el.innerHTML = keysFor(text, touch);
  el.classList.add("in");
  hintT = performance.now();
}
export function frame(g, view) {
  const p = g.player;
  // the line at the bottom: what is in reach
  const pr = view.prompt;
  const el = $("prompt");
  if (pr && g.state === "play") {
    el.hidden = false;
    $("prompt-verb").innerHTML = (view.touch ? "" : '<span class="key">E</span> ') + pr.verb;
    const ring = $("prompt-ring");
    ring.style.display = pr.hold ? "" : "none";
    ring.style.setProperty("--p", Math.min(1, pr.progress || 0));
    $("use").classList.add("live");
  } else { el.hidden = true; $("use").classList.remove("live"); }
  if (g.hint === null && performance.now() - hintT > 400) $("hint").classList.remove("in");
  // the oil, in words, when you lift the lantern to look
  const ow = $("oilword");
  if (view.raise && g.state === "play") {
    const o = p.oil;
    ow.textContent = !p.lantern && o > 0 ? "The wick is turned down." : o <= 0 ? "Dry." : o > 0.75 ? "Nearly full." : o > 0.5 ? "More than half." : o > 0.3 ? "Less than half." : o > 0.12 ? "Getting low." : "Almost gone.";
    ow.classList.add("in");
  } else ow.classList.remove("in");
  $("crosshair").hidden = g.state !== "play" || p.hiding >= 0;
  $("btn-breath").classList.toggle("on", !!p.holding);
  $("btn-crouch").classList.toggle("on", !!p.crouch);
  $("btn-lantern").classList.toggle("on", !!(p.lantern && p.oil > 0));
  $("hud").classList.toggle("hiding", p.hiding >= 0);
}

export function note(i) {
  const n = NOTES[i];
  if (!n) return;
  $("note-title").textContent = n.title;
  $("note-body").innerHTML = n.body;
  $("note").hidden = false;
  clearTimeout(note.t);
  note.t = setTimeout(hideNote, 9000);
}
export function hideNote() { $("note").hidden = true; }

export function setCaptions(on) { captionsOn = on; if (!on) $("captions").innerHTML = ""; }
export function caption(text, dir, quiet) {
  if (!captionsOn) return;
  const box = $("captions");
  const d = document.createElement("div");
  d.className = "cap" + (quiet ? " quiet" : "");
  d.innerHTML = (dir ? '<span class="dir">' + (dir === "left" ? "&larr;" : dir === "right" ? "&rarr;" : dir === "behind" ? "&darr;" : "&uarr;") + "</span> " : "") + text;
  box.appendChild(d);
  while (box.children.length > 3) box.removeChild(box.firstChild);
  setTimeout(() => { if (d.parentNode) d.parentNode.removeChild(d); }, 3200);
}

export function progress(p) { if (current === "title") { const b = document.querySelector('[data-act="begin"]'); if (b) { b.disabled = p < 1; b.querySelector("span").textContent = p < 1 ? "Opening the house… " + Math.round(p * 100) + "%" : "Begin the night"; } } }
