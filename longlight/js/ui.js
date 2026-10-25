/* ui.js — the screens around the walk, and the few words shown during it.
 *
 * The shape is Last Flame's (lastflame/js/ui.js), which is Ballzooka's: one
 * #screen element every menu is drawn into, buttons named by data-act and
 * handled in one place, and the (i) beside anything that needs explaining
 * (info.js). The look is this game's: white and pale blue on a dark that is
 * almost blue, one serif, as little as can be.
 *
 * During the walk there is no HUD (design: "minimal UI; meters hidden or
 * shown only when the player checks"). A line at the top when there is
 * something to learn, a line at the bottom when there is something in reach,
 * and — only while you hold Check — three words for how you are, and the
 * compass if you have found one. The map is the station's own route map:
 * the coast, the flags, the camps and their beacons; it does not know where
 * you are. */

import { S, save } from "./save.js";
import { icon, hydrateIcons } from "./icons.js";
import { DIFF } from "./places.js";
import { CLUES, RADIO, MEMORIES } from "./topics.js";
import { words } from "./game.js";
import * as upd from "./update.js";
import { HALF, CELL } from "./world.js";

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
  upd.onChange(() => { if (current === "settings") show("settings", $("screen").dataset.back); });
}

const info = (key) => '<button class="info" data-info="' + key + '" aria-label="More about this">' + icon("info") + "</button>";
const btn = (act, arg, label, cls, ico, disabled) => '<button class="btn ' + (cls || "") + '" data-act="' + act + '"' + (arg !== null && arg !== undefined ? ' data-arg="' + arg + '"' : "") + (disabled ? " disabled" : "") + ">" + (ico ? icon(ico) : "") + "<span>" + label + "</span></button>";
const seg = (key, opts, topic) => '<div class="row"><div class="lbl">' + opts.label + (topic ? info(topic) : "") + (opts.note !== undefined ? '<small id="' + opts.noteId + '">' + opts.note + "</small>" : "") + '</div><div class="seg">' +
  opts.items.map(([v, l]) => '<button data-act="set" data-arg="' + key + ":" + v + '" class="' + (String(S.set[key]) === String(v) ? "on" : "") + '">' + l + "</button>").join("") + "</div></div>";
const range = (key, label, min, max, step) => '<div class="row"><div class="lbl">' + label + '</div><input type="range" data-range="' + key + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + S.set[key] + '"></div>';
const clock = (s) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? h + " h " + String(m).padStart(2, "0") + " min" : m + " min"; };

export function show(name, data) {
  current = name;
  const el = $("screen");
  el.className = "s-" + name;
  el.hidden = false;
  let h = "";
  switch (name) {
    case "title": {
      const p = A.progress ? A.progress() : 1, done = p >= 1;
      const j = A.journey ? A.journey() : null;
      h = `<div class="title">
        <div class="mark">${icon("beacon", "big")}</div>
        <h1>The Long Light</h1>
        <p class="line">A quiet walk across Antarctica, lighting beacons for anyone out there.</p>
        <div class="col">
          ${j ? btn("resume", null, done ? "Go on walking" : "Opening… " + Math.round(p * 100) + "%", "primary big", "walk", !done) : ""}
          ${btn("newrun", null, j ? "A new journey" : done ? "Begin" : "Opening… " + Math.round(p * 100) + "%", j ? "" : "primary big", j ? "" : "walk", !done)}
          <div class="pair">${btn("settings", null, "Settings", "ghost", "gear")}${btn("help", null, "How to play", "ghost", "info")}</div>
        </div>
        ${j ? '<p class="small dim">' + j.beacons + (j.beacons === 1 ? " beacon" : " beacons") + " lit · " + (j.km).toFixed(1) + " km walked · " + DIFF[j.diff].label + "</p>" : ""}
        <p class="small">${icon("headphones")} Best with headphones.</p>
        ${S.stats.arrived ? '<p class="small dim">' + S.stats.arrived + (S.stats.arrived === 1 ? " journey" : " journeys") + " to the end</p>" : ""}
        <button class="about" data-info="about">About this game</button>
      </div>`;
      break;
    }
    case "newrun":
      h = `<div class="card">
        <div class="head"><h2>A new journey</h2><button class="ibtn" data-act="toTitle" aria-label="Back">${icon("close")}</button></div>
        <p class="dim">A new stretch of coast, a new route. ${data && data.replacing ? "The walk under way is left behind." : ""}</p>
        ${seg("diff", { label: "Difficulty", items: Object.entries(DIFF).map(([k, v]) => [k, v.label]) }, "diff")}
        <p class="small dim" id="diffLine">${diffLine(S.set.diff)}</p>
        <div class="col">${btn("begin", null, "Wake up", "primary", "walk")}</div>
      </div>`;
      el.dataset.back = "newrun";
      break;
    case "pause":
      h = `<div class="card">
        <h2>Paused</h2>
        <p class="dim">${data && data.line ? data.line : ""}</p>
        <div class="col">${btn("resume", null, "Go on", "primary", "play")}${btn("settings", "pause", "Settings", "", "gear")}${btn("help", null, "How to play", "ghost", "info")}${btn("quit", null, "Leave (the walk is saved)", "ghost", "home")}</div>
      </div>`;
      break;
    case "settings": {
      const u = upd.state();
      h = `<div class="card wide">
        <div class="head"><h2>Settings</h2><button class="ibtn" data-act="back" aria-label="Back">${icon("close")}</button></div>
        ${seg("quality", { label: "Graphics", items: [["low", "Fast"], ["high", "Normal"], ["ultra", "Unrestrained"]] }, "quality")}
        ${seg("assets", { label: "Textures and models", items: [["packed", "Packed"], ["full", "Full quality"]], note: assetLine, noteId: "assetState" }, "assets")}
        ${seg("motion", { label: "Head bob", items: [[true, "On"], [false, "Off"]] }, "motion")}
        ${seg("captions", { label: "Sound captions", items: [[false, "Off"], [true, "On"]] }, "captions")}
        ${seg("invert", { label: "Invert looking up", items: [[false, "Off"], [true, "On"]] })}
        ${range("sens", "Look speed", 0.3, 2.5, 0.05)}
        ${range("fov", "Field of view", 60, 95, 1)}
        ${range("bright", "Brightness", 0, 1, 0.05)}
        ${range("volume", "Volume", 0, 1, 0.05)}
        <h3>Version ${info("update")}</h3>
        <div class="row"><div class="lbl">The Long Light ${u.version}<small id="updState">${u.ready ? "A new version is ready." : u.supported ? "Checked every 30 minutes." : "Updates need the installed app."}</small></div>
        ${u.ready ? btn("updApply", null, "Reload", "small primary") : btn("updCheck", null, "Check for updates", "small")}</div>
        <p class="small dim">Your walk is saved as you go ${info("save")}</p>
      </div>`;
      el.dataset.back = data || el.dataset.back || "title";
      break;
    }
    case "pack": {
      const g = data.g, p = g.p, w = words(g);
      const food = [["cans", "Tins", "can"], ["rations", "Rations", "can"], ["fish", "Fish", "fish"]].filter(([k]) => p.items[k] > 0);
      const keys = [["lantern", "Lantern", "lantern"], ["compass", "Compass", "compass"], ["map", "Route map", "map"], ["line", "Fishing line", "fish"], ["toolbox", "Tools", "gear"]].filter(([k]) => p.keys[k]);
      const read = Object.keys(g.read).filter((k) => CLUES[k]);
      h = `<div class="card wide">
        <div class="head"><h2>Pack</h2><button class="ibtn" data-act="closePack" aria-label="Close">${icon("close")}</button></div>
        <p class="dim">${w.warmth} ${w.food} ${w.fuel} ${info("survival")}</p>
        <h3>Food</h3>
        ${food.length ? food.map(([k, l, ic]) => '<div class="row"><div class="lbl">' + icon(ic) + " " + l + " <small>" + p.items[k] + "</small></div>" + btn("eat", k, k === "fish" && g.near.fire > 0.2 ? "Cook and eat one" : "Eat one", "small") + "</div>").join("") : '<p class="small dim">Nothing to eat.</p>'}
        <h3>Carried</h3>
        <p class="small">${keys.length ? keys.map(([, l, ic]) => '<span class="chip">' + icon(ic) + l + "</span>").join(" ") : "Nothing yet."}</p>
        ${read.length ? "<h3>Found</h3><div class=\"found\">" + read.map((k) => '<button class="link" data-act="clue" data-arg="' + k + '">' + CLUES[k].title + "</button>").join("") + "</div>" : ""}
      </div>`;
      break;
    }
    case "map":
      h = `<div class="card map">
        <div class="head"><h2>Route map</h2><button class="ibtn" data-act="closeMap" aria-label="Close">${icon("close")}</button></div>
        <canvas id="mapCanvas" width="900" height="560"></canvas>
        <p class="small dim">Coast Base to East Cape. Follow the flags. The map does not know where you are.</p>
      </div>`;
      break;
    case "over": {
      const g = data.g, st = g.stats, days = Math.max(1, Math.round((g.clock / 1200) * 10) / 10);
      const detours = st.cairns + st.posts + st.masts + (st.fish ? 1 : 0);
      if (g.won) h = `<div class="card center ending">
        <div class="mark">${icon("beacon", "big")}</div>
        <h2>The light answered.</h2>
        <p class="line">Out over the sea, far off, one light, holding steady. He never learned who lit it.</p>
        <div class="stats">
          <div><b>${st.beacons}</b><small>${st.beacons === 1 ? "beacon" : "beacons"} lit</small></div>
          <div><b>${(st.distance / 1000).toFixed(1)} km</b><small>walked</small></div>
          <div><b>${days}</b><small>turns of the sun</small></div>
          <div><b>${st.notes}</b><small>things found</small></div>
          ${detours ? "<div><b>" + detours + "</b><small>detours taken</small></div>" : ""}
        </div>
        <div class="col">${btn("newrun", null, "Another coast", "primary", "walk")}${btn("toTitle", null, "Title", "ghost", "home")}</div>
      </div>`;
      else h = `<div class="card center">
        <div class="mark">${icon("snow", "big")}</div>
        <h2>The cold kept him.</h2>
        <p class="line">${st.beacons} ${st.beacons === 1 ? "beacon" : "beacons"} burning behind him, ${(st.distance / 1000).toFixed(1)} km from the base.</p>
        <div class="col">${btn("newrun", null, "Another coast", "primary", "walk")}${btn("toTitle", null, "Title", "ghost", "home")}</div>
      </div>`;
      break;
    }
    case "loading":
      h = `<div class="title loading"><div class="mark">${icon("snow", "big")}</div><p class="line" id="loadLine">${data || "Laying out the coast…"}</p></div>`;
      break;
  }
  el.innerHTML = h;
  hydrateIcons(el);
  if (name === "map" && data && data.g) drawMap($("mapCanvas"), data.g);
}

export function hide() { current = null; $("screen").hidden = true; $("screen").innerHTML = ""; }
export const showing = () => current;
export function loadingLine(text) { const el = $("loadLine"); if (el) el.textContent = text; }
const diffLine = (d) => ({ easy: "Slow drain, plenty lying about, a can a beacon. Never ends the walk.", normal: "Slow drain, fair supplies, two cans a beacon. Black out and lose time and things.", hard: "Moderate drain, scarce supplies, three cans a beacon. A second blackout ends it." })[d] || "";

const ACT = {
  newrun: () => show("newrun", { replacing: A.journey && A.journey() }),
  begin: () => A.begin(),
  settings: (from) => show("settings", from || current || "title"),
  help: () => A.info("play"),
  back: () => { const b = $("screen").dataset.back || "title"; if (b === "pause") show("pause", A.pauseData()); else if (b === "newrun") show("newrun"); else show("title"); },
  resume: () => A.resume(),
  quit: () => A.quit(),
  toTitle: () => A.toTitle(),
  closePack: () => A.closeOverlay(),
  closeMap: () => A.closeOverlay(),
  eat: (k) => A.eat(k),
  clue: (k) => note("clue", k),
  set: (arg) => {
    const [k, v] = arg.split(":");
    S.set[k] = v === "true" ? true : v === "false" ? false : v;
    save(); A.apply();
    if (current === "newrun") { show("newrun", { replacing: A.journey && A.journey() }); return; }
    show("settings", $("screen").dataset.back);
  },
  updCheck: () => { const st = $("updState"); if (st) st.textContent = "Checking…"; upd.checkNow().then((r) => { const s2 = $("updState"); if (s2) s2.textContent = r === "ready" ? "A new version is ready." : r === "current" ? "You are up to date." : r === "downloading" ? "Downloading a new version…" : r === "offline" ? "Offline: could not check." : "Updates need the installed app."; }); },
  updApply: () => upd.apply()
};

/* How the Full download is coming along: one line under the setting. */
let assetLine = "";
export function assetNote(text) { assetLine = text || ""; const el = $("assetState"); if (el) el.textContent = assetLine; }

/* ---------- the map ---------- */

function drawMap(cv, g) {
  const x = cv.getContext("2d"), W = g.W, w = cv.width, hh = cv.height;
  // the part of the world the route is in, with a margin
  const xs = W.sites.map((s) => s.x), zs = W.sites.map((s) => s.z);
  const x0 = Math.min(...xs) - 500, x1 = Math.max(...xs) + 500, z0 = Math.min(...zs) - 900, z1 = Math.max(...zs) + 700;
  const sc = Math.min(w / (x1 - x0), hh / (z1 - z0));
  const X = (v) => (v - x0) * sc + (w - (x1 - x0) * sc) / 2, Z = (v) => (v - z0) * sc + (hh - (z1 - z0) * sc) / 2;
  x.fillStyle = "#e9e4d8"; x.fillRect(0, 0, w, hh);
  // the land, from the world's own grid: sea hatched, rock shaded
  const n = W.n;
  for (let j = 0; j < n; j += 2) for (let i = 0; i < n; i += 2) {
    const wx = i * CELL - HALF, wz = j * CELL - HALF;
    if (wx < x0 || wx > x1 || wz < z0 || wz > z1) continue;
    const k = j * n + i, sea = W.SEA[k], rk = W.ROCK[k];
    if (sea === 2) x.fillStyle = "rgba(60,80,110,0.55)";
    else if (sea === 1) x.fillStyle = "rgba(120,150,180,0.22)";
    else if (rk > 0.4) x.fillStyle = "rgba(70,60,55,0.45)";
    else continue;
    x.fillRect(X(wx), Z(wz), CELL * 2 * sc + 0.6, CELL * 2 * sc + 0.6);
  }
  // the coast
  x.strokeStyle = "rgba(40,50,70,0.8)"; x.lineWidth = 1.4; x.beginPath();
  for (let i = 0; i < n; i++) { const wx = i * CELL - HALF; if (wx < x0 || wx > x1) continue; const px = X(wx), pz = Z(W.coast[i]); if (wx === x0 || i === 0) x.moveTo(px, pz); else x.lineTo(px, pz); }
  x.stroke();
  // the flag line
  x.strokeStyle = "#8a2a20"; x.lineWidth = 1.6; x.setLineDash([5, 5]); x.beginPath();
  W.line.forEach((p, i) => { if (i % 3) return; if (i === 0) x.moveTo(X(p.x), Z(p.z)); else x.lineTo(X(p.x), Z(p.z)); });
  x.stroke(); x.setLineDash([]);
  // beacons: a triangle, filled once lit
  for (let i = 0; i < W.beacons.length; i++) {
    const b = W.beacons[i], px = X(b.x), pz = Z(b.z);
    x.beginPath(); x.moveTo(px, pz - 7); x.lineTo(px + 6, pz + 4); x.lineTo(px - 6, pz + 4); x.closePath();
    x.fillStyle = g.lit[i] ? "#d26a1c" : "rgba(0,0,0,0)"; x.fill();
    x.strokeStyle = "#3a2a20"; x.lineWidth = 1.2; x.stroke();
  }
  // the camps
  const names = ["Coast Base", "Camp One", "Camp Two", "Camp Three", "Camp Four", "Camp Five", "East Cape"];
  x.font = "italic 15px Georgia, serif";
  W.sites.forEach((s, i) => {
    const px = X(s.x), pz = Z(s.z);
    x.fillStyle = "#2b2420"; x.fillRect(px - 4, pz - 4, 8, 8);
    x.fillText(names[i] || "", px + 8, pz + (i % 2 ? 18 : -8));
  });
  // a north arrow, and the glacier's warning
  x.fillStyle = "#2b2420"; x.font = "bold 16px Georgia, serif"; x.fillText("N", w - 34, 30);
  x.beginPath(); x.moveTo(w - 28, 36); x.lineTo(w - 22, 56); x.lineTo(w - 28, 52); x.lineTo(w - 34, 56); x.closePath(); x.fill();
  x.font = "italic 13px Georgia, serif"; x.fillStyle = "rgba(40,30,25,0.8)";
  x.fillText("glacier — keep to the flags", X(W.glacierX0) - 70, Z((W.sites[3].z + W.sites[4].z) / 2) + 46);
}

/* ---------- during the walk ---------- */

let hintT = 0, captionsOn = false;
export function hud(on) { $("hud").hidden = !on; document.body.classList.toggle("playing", !!on); }
export function touchControls(on) { $("touch").hidden = !on; }

/* [interact] and friends become the key, or the button, the player has. */
function keysFor(text, touch) {
  const K = touch ? { interact: "the hand", lantern: "the lantern", check: "the body button", pack: "the pack", map: "the map" } : { interact: "E", lantern: "F", check: "Q", pack: "Tab", map: "M" };
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
  const p = g.p;
  const pr = view.prompt;
  const el = $("prompt");
  if (pr && g.state === "play" && !view.overlay) {
    el.hidden = false;
    el.classList.toggle("off", !!pr.off);
    $("prompt-verb").innerHTML = (view.touch || pr.off ? "" : '<span class="key">E</span> ') + pr.verb;
    const ring = $("prompt-ring");
    ring.style.display = pr.hold ? "" : "none";
    ring.style.setProperty("--p", Math.min(1, pr.progress || 0));
    $("use").classList.toggle("live", !pr.off);
  } else { el.hidden = true; $("use").classList.remove("live"); }
  if (performance.now() - hintT > 8000) $("hint").classList.remove("in");
  // checking yourself: three words, and the compass if you have one
  const ck = $("check");
  const checking = view.check && g.state === "play";
  ck.classList.toggle("in", checking);
  if (checking) {
    const w = words(g);
    $("check-words").innerHTML = "<span>" + w.warmth + "</span><span>" + w.food + "</span><span>" + w.fuel + "</span>";
    const cmp = $("compass");
    cmp.hidden = !p.keys.compass;
    if (p.keys.compass) {
      const bearing = ((Math.atan2(Math.sin(p.yaw), -Math.cos(p.yaw)) * 180) / Math.PI + 360) % 360;
      $("compass-strip").style.transform = "translateX(" + (-bearing * 2) + "px)";
    }
  }
  $("crosshair").hidden = g.state !== "play" || !!view.overlay;
  $("btn-lantern").hidden = !p.keys.lantern;
  $("btn-lantern").classList.toggle("on", !!p.lantern);
  $("btn-map").hidden = !p.keys.map;
}

/* A thing found, or a radio's words, or a memory: on paper, until tapped. */
export function note(kind, id) {
  let n = null;
  if (kind === "clue") n = CLUES[id];
  else if (kind === "radio") n = RADIO[id] || RADIO.default;
  else if (kind === "memory") n = { title: "", body: "<p>" + (MEMORIES[id % MEMORIES.length]) + "</p>" };
  if (!n) return;
  $("note").className = kind === "memory" ? "memory" : "";
  $("note-title").textContent = n.title;
  $("note-body").innerHTML = n.body;
  $("note").hidden = false;
  clearTimeout(note.t);
  note.t = setTimeout(hideNote, kind === "memory" ? 7000 : 14000);
}
export function hideNote() { $("note").hidden = true; }
export const noteOpen = () => !$("note").hidden;

export function setCaptions(on) { captionsOn = on; if (!on) $("captions").innerHTML = ""; }
export function caption(text, dir, quiet) {
  if (!captionsOn) return;
  const box = $("captions");
  const d = document.createElement("div");
  d.className = "cap" + (quiet ? " quiet" : "");
  d.innerHTML = (dir ? '<span class="dir">' + (dir === "left" ? "&larr;" : dir === "right" ? "&rarr;" : dir === "behind" ? "&darr;" : "&uarr;") + "</span> " : "") + text;
  box.appendChild(d);
  while (box.children.length > 3) box.removeChild(box.firstChild);
  setTimeout(() => { if (d.parentNode) d.parentNode.removeChild(d); }, 3600);
}

export function progress(p) {
  if (current !== "title") return;
  // done: the title again, with its real buttons
  if (p >= 1) { if (document.querySelector("#screen [disabled]")) show("title"); return; }
  for (const b of document.querySelectorAll('[data-act="newrun"],[data-act="resume"]')) {
    b.disabled = true;
    b.querySelector("span").textContent = "Opening… " + Math.round(p * 100) + "%";
  }
}
