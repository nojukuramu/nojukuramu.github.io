/* ============================================================
   BURST//DUMP — the page

   Wiring only: settings, the player, the strip under the stage, the panes.
   The edit is js/timeline.js, the drawing js/render.js, the song
   js/audio.js and js/analysis-worker.js, the file js/export.js.

   Every control carries data-k="<setting>" and data-on="<what changes>",
   and one binder handles all of them, so a new switch is one line of HTML.
   Settings (never the photos or the song) are remembered in this browser.
   ============================================================ */
import * as R from "./render.js";
import { buildTimeline, STYLES, MUSIC_RHYTHMS } from "./timeline.js";
import { bestStart } from "./choreo.js";
import * as P from "./photos.js";
import * as AU from "./audio.js";
import * as X from "./export.js";
import * as info from "./info.js";
import * as update from "./update.js";

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fmtT = (ms) => { const s = Math.max(0, ms) / 1000; return Math.floor(s / 60) + ":" + (s % 60).toFixed(1).padStart(4, "0"); };
const fmtMB = (b) => (b / 1048576).toFixed(0) + " MB";
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const STYLE_LABEL = { slam: "full-frame slam", pile: "print pile", pop: "center pop", grid: "grid fill", strip: "strips", split: "split panels", stack: "deck stack", echo: "echo zoom", slash: "diagonal slash", bubble: "sticker dots", mirror: "mirror", punch: "punch zoom", quad: "quad repeat", bars: "bars", tape: "taped snap", xerox: "xerox blast" };
const TYPE_NAME = { low: "quiet", mid: "verse", build: "build", peak: "chorus" };
const TYPE_COLOR = { low: "#5b8cff", mid: "#8b9199", build: "#ffc24b", peak: "#ff5a4d" };

const DEFAULTS = {
  cap: 1000, sample: "even", order: "name", quality: "auto",
  aspect: "9:16", arw: 9, arh: 16, res: "1080", bgMode: "#000000", bgColor: "#0b0c0e", fit: "cover", border: "white",
  rhythm: "accel", lenMode: "fit", pace: 0, hero: true, syncNudge: 0, durS: 30, accel: 2.2, cluster: 16, bpm: 120, holdLast: true, holdMs: 800,
  styles: { slam: true, pile: true, pop: true, grid: true }, chaos: 0.5, runMode: "auto",
  styleRun: { slam: 4, pile: 14, pop: 6, grid: 8, strip: 8, split: 6, stack: 10, echo: 3, slash: 8, bubble: 10, mirror: 3, punch: 4, quad: 3, bars: 8, tape: 10, xerox: 3 },
  pulse: 0.35, drift: true, flash: true, glitch: true, grain: 0.10, vig: 0.35, hud: true, sfx: false, sfxVol: 0.5,
  musicVol: 0.9, musicOff: 0, feelOn: true, feelAmt: 1, feelPace: 1, feelFx: 1, feelStyle: 1, feelTex: 1, melodyLift: 0.5,
  seed: 1337, fps: "60", bitrate: 20
};
const STORE = "burstdump.cfg.v2";
const cfg = JSON.parse(JSON.stringify(DEFAULTS));
try {
  const saved = JSON.parse(localStorage.getItem(STORE) || "null");
  if (saved && typeof saved === "object") for (const k of Object.keys(DEFAULTS)) if (k in saved && k !== "musicOff") cfg[k] = typeof DEFAULTS[k] === "object" ? Object.assign({}, DEFAULTS[k], saved[k]) : saved[k];
} catch (e) {}
cfg.bg = cfg.bgMode === "custom" ? cfg.bgColor : cfg.bgMode;
// settings saved before "fit the photos" existed asked for "fixed" only because it was the default
try { const sv = JSON.parse(localStorage.getItem(STORE) || "null"); if (sv && !("pace" in sv) && sv.lenMode === "fixed") cfg.lenMode = "fit"; } catch (e) {}
let saveT = 0;
function save() { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(STORE, JSON.stringify(cfg)); } catch (e) {} }, 300); }
let rhythmTouched = false;
let lastFile = null;   // the last exported video, for Save again and Share

/* ---------- canvas & edit ---------- */
const cv = $("cv");
R.init(cv, cfg);
let tl = { events: [], D: 0, beats: [], map: { secs: [], fills: [] }, note: "" };
function canvasSize() {
  let a, b;
  if (cfg.aspect === "custom") { a = Math.max(1, +cfg.arw || 1); b = Math.max(1, +cfg.arh || 1); } else [a, b] = cfg.aspect.split(":").map(Number);
  const short = +cfg.res, r = a / b;
  let w, h; if (r >= 1) { h = short; w = Math.round(short * r); } else { w = short; h = Math.round(short / r); }
  w = Math.min(4096, w - w % 2); h = Math.min(4096, h - h % 2);
  R.size(w, h);
}
const song = () => AU.A.analysis;
const hasBeats = () => !!(song() && song().beats && song().beats.length >= 4);
function regen() {
  clearTimeout(regenT);
  tl = buildTimeline(P.state.photos, cfg, song(), { w: cv.width, h: cv.height });
  R.setMusic(song()); R.setTimeline(tl);
  if (player.t > R.endT()) player.t = 0;
  stats(); drawStrip(); renderSongMap();
  if (!player.playing) R.frame(player.t);
}
let regenT = 0;
const scheduleRegen = () => { clearTimeout(regenT); regenT = setTimeout(regen, 160); };

/* ---------- player ---------- */
const player = { t: 0, playing: false, last: 0, loop: true, exporting: null, rt: null, cancel: false };
function play(fromGesture) {
  if (!tl.events.length || player.exporting === "fast") return;
  if (fromGesture) { const c = AU.ensureCtx(cfg); if (c.resume) c.resume(); }
  else if (AU.A.buffer && !(AU.A.ctx && AU.A.ctx.state === "running")) return;  // no sound without a tap; do not start mute
  if (player.t >= R.endT()) player.t = 0;
  player.playing = true; player.last = performance.now();
  AU.play(player.t, cfg, R.endT());
  setPlayIcon();
}
function pause() { player.playing = false; AU.stop(); setPlayIcon(); }
function seek(t) {
  player.t = clamp(t, 0, R.endT()); R.invalidate();
  if (player.playing) AU.play(player.t, cfg, R.endT());
  R.frame(player.t); transport();
}
function setPlayIcon() { $("playBtn").innerHTML = `<svg><use href="#i-${player.playing ? "pause" : "play"}"/></svg>`; $("playBtn").setAttribute("aria-label", player.playing ? "Pause" : "Play"); }
function tick(now) {
  requestAnimationFrame(tick);
  if (player.exporting === "fast") { player.last = now; return; }
  if (player.playing) {
    const at = AU.nowMs();
    player.t = at != null ? at : player.t + (player.exporting ? now - player.last : Math.min(now - player.last, 100));
    const end = R.endT();
    if (player.t >= end && tl.D > 0) {
      if (player.exporting === "rt") { finishRealtime(); }
      else if (player.loop) { player.t = 0; R.invalidate(); AU.play(0, cfg, R.endT()); }
      else { player.t = end; pause(); }
    }
  }
  player.last = now;
  const crossed = R.frame(player.t);
  if (crossed && player.playing) AU.click(cfg);
  transport();
}
function transport() {
  const end = R.endT() || 1, sc = $("scrub");
  if (document.activeElement !== sc) sc.value = Math.round(player.t / end * 1000);
  $("tlabel").textContent = `${fmtT(player.t)} / ${fmtT(end)}`;
  const a = song(), d = a ? a.duration : AU.A.buffer ? AU.A.buffer.duration : 0;
  if (d > 0) $("stripHead").style.left = clamp((cfg.musicOff + player.t / 1000) / d, 0, 1) * 100 + "%";
}

/* ---------- stats ---------- */
function stats() {
  const N = P.state.photos.length;
  $("lcdN").textContent = String(N).padStart(4, "0");
  const ready = N > 0 && !player.exporting;
  $("exportBtn").disabled = !ready; $("exportBtn2").disabled = !N && !player.exporting;
  if (!N || !tl.events.length) { $("lcdD").textContent = "--.-s"; $("lcdR").textContent = "--.-/s"; $("timeStat").textContent = ""; }
  else {
    const D = tl.D, M = tl.events.length, rate = M / (D / 1000);
    $("lcdD").textContent = (D / 1000).toFixed(1) + "s"; $("lcdR").textContent = rate.toFixed(1) + "/s";
    const note = tl.note === "short" ? " · ended early, not enough photos for the song's pace" : tl.note === "surplus" ? ` · ${M} of ${N} photos: more would blur the song` : "";
    $("timeStat").innerHTML = `<b>${M}</b> cuts · <b>${(D / 1000).toFixed(1)}s</b> · <b>${Math.round(D / M)}</b> ms a cut${note}`;
    if (document.activeElement !== $("pps")) $("pps").value = rate.toFixed(1);
  }
  const a = song();
  $("lcdB").textContent = a && a.bpm ? String(Math.round(a.bpm)) : cfg.rhythm === "beat" ? String(cfg.bpm) : "---";
  // the last export's result stays until something new is exported
  if (!player.exporting && !lastFile) $("exportStat").textContent = N ? `A ${Math.round(R.endT() / 1000)} s reel, ${tl.events.length} cuts.` : "Add photos first.";
  $("empty").hidden = N > 0 || P.state.decoding;
}

/* ---------- settings binder ---------- */
const VAL_FMT = { pace: (v) => (+v === 0 ? "the song's" : (v > 0 ? "+" : "") + v), syncNudge: (v) => (+v === 0 ? "0 ms" : (v > 0 ? "+" : "") + v + " ms"), durS: (v) => v + "s", accel: (v) => (+v).toFixed(1) + "×", cluster: (v) => v, bitrate: (v) => v + " Mbps", grain: (v) => (+v).toFixed(2), vig: (v) => (+v).toFixed(2) };
function showVal(k) { document.querySelectorAll(`[data-v="${k}"]`).forEach((el) => { el.textContent = (VAL_FMT[k] || ((v) => (+v).toFixed(2)))(cfg[k]); }); }
function setControl(el) {
  const k = el.dataset.k;
  if (el.classList.contains("tgl")) { el.classList.toggle("on", !!cfg[k]); el.setAttribute("aria-pressed", String(!!cfg[k])); }
  else el.value = cfg[k];
  showVal(k);
}
const ON = {
  none() {},
  regen: scheduleRegen,
  render() { R.invalidate(); if (!player.playing) R.frame(player.t); },
  size() { canvasSize(); refreshVisibility(); scheduleRegen(); refreshFormat(); },
  rhythm() { rhythmTouched = true; refreshVisibility(); scheduleRegen(); },
  length() { R.invalidate(); transport(); drawStrip(); },
  vol() { AU.setVolumes(cfg); refreshFormat(); },
  offset() { setOffset(cfg.musicOff, true); },
  bg() { cfg.bg = cfg.bgMode === "custom" ? cfg.bgColor : cfg.bgMode;
// settings saved before "fit the photos" existed asked for "fixed" only because it was the default
try { const sv = JSON.parse(localStorage.getItem(STORE) || "null"); if (sv && !("pace" in sv) && sv.lenMode === "fixed") cfg.lenMode = "fit"; } catch (e) {} refreshVisibility(); R.invalidate(); if (!player.playing) R.frame(player.t); },
  sfx() { if (cfg.sfx) AU.ensureCtx(cfg); refreshFormat(); },
  fmt() { refreshFormat(); },
  runs() { renderRuns(); scheduleRegen(); },
  redecode() { if (P.state.files.length) decode(); }
};
document.querySelectorAll("[data-k]").forEach((el) => {
  setControl(el);
  const k = el.dataset.k, on = ON[el.dataset.on] || ON.none;
  if (el.classList.contains("tgl")) el.addEventListener("click", () => { cfg[k] = !cfg[k]; setControl(el); on(); save(); });
  else el.addEventListener(el.tagName === "SELECT" ? "change" : "input", () => {
    const num = el.type === "range" || el.type === "number";
    if (num) { const v = parseFloat(el.value); if (!isFinite(v)) return; cfg[k] = v; } else cfg[k] = el.value;
    showVal(k); on(); save();
  });
});
function refreshVisibility() {
  const songish = MUSIC_RHYTHMS.includes(cfg.rhythm) && hasBeats();
  // "fit the photos" is the follow-the-song planner's; the other music rhythms read it as fixed
  const fitOn = cfg.lenMode === "fit" && cfg.rhythm === "song";
  const show = {
    songish, fixedlen: !(songish && (cfg.lenMode === "song" || fitOn)), pace: songish && fitOn, songOnly: songish && cfg.rhythm === "song", accel: cfg.rhythm === "accel" || cfg.rhythm === "decel",
    bursts: cfg.rhythm === "bursts", bpm: cfg.rhythm === "beat" && !hasBeats(), customAR: cfg.aspect === "custom"
  };
  document.querySelectorAll("[data-show]").forEach((el) => { el.hidden = !show[el.dataset.show]; });
  $("bgColor").hidden = cfg.bgMode !== "custom";
  for (const v of ["song", "melody", "hits"]) $("rhythm").querySelector(`option[value=${v}]`).disabled = !hasBeats();
}
$("pps").addEventListener("change", () => {
  const p = parseFloat($("pps").value), N = P.state.photos.length;
  if (p > 0 && N) { cfg.durS = clamp(Math.round(N / p), 3, 90); setControl($("durS")); save(); regen(); }
});

/* ---------- styles ---------- */
function renderChips() {
  $("styleChips").innerHTML = STYLES.map((s) => `<button class="chip${cfg.styles[s] ? " on" : ""}" data-s="${s}" aria-pressed="${!!cfg.styles[s]}">${STYLE_LABEL[s]}</button>`).join("");
}
$("styleChips").addEventListener("click", (e) => {
  const b = e.target.closest(".chip"); if (!b) return;
  const s = b.dataset.s; cfg.styles[s] = !cfg.styles[s];
  b.classList.toggle("on", cfg.styles[s]); b.setAttribute("aria-pressed", String(cfg.styles[s]));
  renderRuns(); save(); scheduleRegen();
});
function renderRuns() {
  const w = $("styleRunList");
  w.hidden = cfg.runMode !== "perStyle";
  if (w.hidden) return;
  const on = STYLES.filter((s) => cfg.styles[s]);
  w.innerHTML = on.length ? on.map((s) => `<label class="srItem">${STYLE_LABEL[s]}<input type="number" min="1" max="32" value="${cfg.styleRun[s]}" data-s="${s}"></label>`).join("") : '<span class="line dim">No styles lit: full-frame slam it is.</span>';
}
$("styleRunList").addEventListener("input", (e) => {
  const i = e.target.closest("input"); if (!i) return;
  cfg.styleRun[i.dataset.s] = clamp(parseInt(i.value, 10) || 1, 1, 32); save(); scheduleRegen();
});
function reroll() { cfg.seed = (Math.random() * 1e9) | 0; setControl($("seed")); save(); regen(); seek(0); if (!player.playing) play(true); }
$("rerollBtn").onclick = reroll; $("rerollBtn2").onclick = reroll;

let taps = [];
$("tapBtn").onclick = () => {
  const n = performance.now();
  if (taps.length && n - taps[taps.length - 1] > 2000) taps = [];
  taps.push(n); if (taps.length > 6) taps.shift();
  if (taps.length >= 3) { cfg.bpm = clamp(Math.round(60000 / ((taps[taps.length - 1] - taps[0]) / (taps.length - 1))), 40, 240); setControl($("bpm")); save(); scheduleRegen(); }
};

/* ---------- photos ---------- */
function ingest(files) {
  const { imgs, skipped } = P.images(files);
  if (!imgs.length) { $("loadStat").innerHTML = '<span class="err">No photos this browser can open in there.</span> RAW and HEIC are skipped.'; return; }
  P.state.files = imgs; P.state.fails = [];
  $("loadStat").textContent = `${imgs.length} photos found${skipped ? `, ${skipped} other files skipped` : ""}. Decoding…`;
  decode();
}
async function decode() {
  pause();
  tl = { events: [], D: 0, beats: [], map: { secs: [], fills: [] } }; R.setTimeline(tl);
  ["pickBtn", "pickFilesBtn", "reloadBtn", "emptyPick"].forEach((id) => { $(id).disabled = true; });
  $("photoProg").hidden = false; $("empty").hidden = true;
  try {
    const ok = await P.decodeAll(cfg, (d, n) => { $("photoProg").firstElementChild.style.width = (d / n * 100) + "%"; $("loadStat").textContent = `Decoding ${d} of ${n}…`; });
    if (!ok) return;
    R.setPhotos(P.state.photos);
    photoStat(); renderThumbs(); regen(); seek(0); play(false);
  } catch (err) {
    $("loadStat").innerHTML = `<span class="err">Decoding stopped: ${esc((err && err.message) || err)}.</span> Try a lower quality or fewer photos.`;
  } finally {
    $("photoProg").hidden = true;
    ["pickBtn", "pickFilesBtn", "emptyPick"].forEach((id) => { $(id).disabled = false; });
    $("reloadBtn").disabled = !P.state.files.length;
    stats();
  }
}
function photoStat() {
  const n = P.state.photos.length, b = P.bytes(), f = P.state.fails.length;
  $("loadStat").innerHTML = n ? `<b>${n}</b> photos at up to ${P.state.maxDim}px · ${fmtMB(b)} in memory${f ? ` · <span class="warn">${f} would not open</span>` : ""}${b > 2.3e9 ? ' · <span class="warn">heavy, try a lower quality</span>' : ""}` : "No photos yet. Or drop a folder anywhere.";
}
const THUMBS = 300;   // a thousand DOM thumbnails would itself stall a phone
function renderThumbs() {
  const w = $("photoMgmt"), ph = P.state.photos;
  let html = "";
  if (P.state.fails.length) html += `<div class="failRow"><span class="warn">${P.state.fails.length} would not open:</span> ${P.state.fails.slice(0, 5).map(esc).join(", ")}${P.state.fails.length > 5 ? ` and ${P.state.fails.length - 5} more` : ""} <button class="mini" id="retryFail">Try again</button></div>`;
  const shown = Math.min(ph.length, THUMBS);
  if (shown) {
    html += '<div class="pgrid">' + Array.from({ length: shown }, (_, i) => `<div class="pthumb"><canvas width="64" height="64"></canvas><button class="pdel" data-i="${i}" aria-label="Remove ${esc(ph[i].name)}"><svg><use href="#i-close"/></svg></button></div>`).join("") + "</div>";
    if (ph.length > THUMBS) html += `<p class="line dim">The first ${THUMBS} of ${ph.length} shown.</p>`;
  }
  w.innerHTML = html;
  w.querySelectorAll(".pthumb canvas").forEach((c, i) => { const p = ph[i]; if (!p) return; const [sx, sy, sw, sh] = R.coverSrc(p.bmp, 64, 64); c.getContext("2d").drawImage(p.bmp, sx, sy, sw, sh, 0, 0, 64, 64); });
  const rf = w.querySelector("#retryFail");
  if (rf) rf.onclick = async () => { rf.disabled = true; await P.retryFailed(); R.setPhotos(P.state.photos); photoStat(); renderThumbs(); regen(); };
}
$("photoMgmt").addEventListener("click", (e) => {
  const b = e.target.closest(".pdel"); if (!b) return;
  P.remove(+b.dataset.i); R.setPhotos(P.state.photos); photoStat(); renderThumbs(); regen(); seek(0);
});
const coarse = matchMedia("(pointer: coarse)").matches;
$("pickBtn").onclick = () => $("folderInput").click();
$("pickFilesBtn").onclick = () => $("filesInput").click();
// phones have no folders to pick: the photo library is the picker there
$("emptyPick").onclick = () => $(coarse ? "filesInput" : "folderInput").click();
$("folderInput").onchange = (e) => { ingest([...e.target.files]); e.target.value = ""; };
$("filesInput").onchange = (e) => { ingest([...e.target.files]); e.target.value = ""; };
$("reloadBtn").onclick = () => { if (P.state.files.length && !P.state.decoding) decode(); };

/* ---------- music ---------- */
const songBtns = ["musicBtn", "emptySong", "stripAdd", "musicReplace"];
songBtns.forEach((id) => { $(id).onclick = () => $("musicInput").click(); });
$("musicInput").onchange = (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) loadSong(f); };
const isAudio = (f) => (f.type && f.type.startsWith("audio/")) || /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|weba)$/i.test(f.name);
let analysisStart = 0;
function loadSong(file) {
  pause();
  AU.ensureCtx(cfg);
  cfg.musicOff = 0; setControl($("musicOff"));
  $("noSong").hidden = true; $("songCard").hidden = false; $("songName").textContent = file.name;
  $("songTags").innerHTML = ""; $("songProg").hidden = false; $("songMap").innerHTML = "";
  $("songStat").textContent = "Decoding…";
  wavePeaks = null; analysisStart = performance.now();
  drawStrip();
  AU.load(file, {
    progress(stage, p) {
      const total = stage === "decode" ? 0 : stage === "rhythm" ? p * 0.8 : 0.8 + p * 0.2;
      $("songProg").firstElementChild.style.width = Math.round(total * 100) + "%";
      if (stage === "decode") $("songStat").textContent = "Decoding…";
      else if (stage === "rhythm") $("songStat").textContent = "Finding the beats, bars and sections…";
      if (!wavePeaks && AU.A.buffer) { wavePeaks = peaksOf(AU.A.buffer); drawStrip(); }
    },
    rhythm(a, cached) {
      $("songProg").hidden = !AU.A.melodyPending;
      if (!wavePeaks) wavePeaks = a.peaks;
      // a song with a beat is what the music rhythms are for; switch unless the rhythm was chosen by hand
      if (a.beats.length >= 4 && !rhythmTouched && !MUSIC_RHYTHMS.includes(cfg.rhythm)) { cfg.rhythm = "song"; setControl($("rhythm")); save(); }
      if (!(a.beats.length >= 4) && MUSIC_RHYTHMS.includes(cfg.rhythm) && cfg.rhythm !== "beat") { cfg.rhythm = "accel"; setControl($("rhythm")); }
      songCard(); refreshVisibility(); refreshFormat(); regen(); seek(0);
      $("songStat").textContent = songLine(a, cached);
    },
    melody(a, cached) {
      $("songProg").hidden = true;
      songCard();
      $("songStat").textContent = songLine(song(), cached);
      if (cfg.rhythm === "melody" || cfg.melodyLift > 0) scheduleRegen();
      drawStrip();
    },
    error(msg) {
      $("songProg").hidden = true;
      $("songStat").innerHTML = `<span class="warn">Could not read this song: ${esc(msg)}.</span> Try an MP3, M4A or WAV.`;
      refreshVisibility(); drawStrip();
    }
  });
}
function songLine(a, cached) {
  if (!a) return "";
  const secs = a.sections.length, hits = a.onsets.length;
  const t = cached ? "Read before" : `Read in ${((performance.now() - analysisStart) / 1000).toFixed(1)} s`;
  if (a.beats.length < 4) return `${t}. No steady beat found: a free-time rhythm suits this one.`;
  return `${t} · ${secs} section${secs === 1 ? "" : "s"} · ${hits} drum hits${AU.A.melodyPending ? " · melody next…" : ` · ${a.notes.length} melody notes`}`;
}
function songCard() {
  const a = song(); if (!a) return;
  const tags = [];
  if (a.bpm) tags.push(`<span class="tag">${Math.round(a.bpm)} BPM</span>`);
  if (a.key) tags.push(`<span class="tag">${esc(a.key.name)}</span>`);
  if (a.beats.length >= 4) tags.push(`<span class="tag soft">4/4</span>`);
  tags.push(`<span class="tag soft">${fmtT(a.duration * 1000).replace(/\.\d$/, "")}</span>`);
  tags.push(`<span class="tag soft">${a.engine === "essentia" ? "Essentia" : "built-in"}</span>`);
  tags.push(AU.A.melodyPending ? '<span class="tag pend">melody…</span>' : `<span class="tag soft">melody: ${a.melodyEngine === "essentia" ? "Melodia" : "built-in"}</span>`);
  $("songTags").innerHTML = tags.join("");
}
$("musicClear").onclick = () => {
  pause(); AU.clear(); wavePeaks = null;
  $("noSong").hidden = false; $("songCard").hidden = true; $("songMap").innerHTML = "";
  if (MUSIC_RHYTHMS.includes(cfg.rhythm) && cfg.rhythm !== "beat") { cfg.rhythm = "accel"; setControl($("rhythm")); }
  cfg.musicOff = 0; setControl($("musicOff"));
  refreshVisibility(); refreshFormat(); regen(); seek(0);
};
function maxOff() {
  const a = song(), d = a ? a.duration : AU.A.buffer ? AU.A.buffer.duration : 0;
  if (!(d > 0)) return 0;
  if (MUSIC_RHYTHMS.includes(cfg.rhythm) && (cfg.lenMode === "song" || (cfg.lenMode === "fit" && cfg.rhythm === "song")) && hasBeats()) return Math.max(0, d - 5);
  return Math.max(0, d - Math.min(R.endT(), d * 1000) / 1000);
}
/* With a music rhythm the reel starts on a bar line, so its first cut is a
   downbeat: the nearest one within half a bar of where it was put. */
function snapToBar(s) {
  const a = song();
  if (!a || !a.bars || a.bars.length < 2 || !MUSIC_RHYTHMS.includes(cfg.rhythm)) return s;
  let best = s, d = Infinity;
  for (const b of a.bars) { const e = Math.abs(b - s); if (e < d) { d = e; best = b; } }
  const bar = (a.bars[a.bars.length - 1] - a.bars[0]) / (a.bars.length - 1);
  return d <= bar / 2 ? best : s;
}
function setOffset(s, fromInput) {
  cfg.musicOff = clamp(snapToBar(Math.max(0, +s || 0)), 0, maxOff());
  if (!fromInput || document.activeElement !== $("musicOff")) $("musicOff").value = cfg.musicOff.toFixed(1);
  save(); drawStrip();
  if (player.playing) AU.play(player.t, cfg, R.endT());
  scheduleRegen();
}
function renderSongMap() {
  const a = song(), w = $("songMap");
  if (!a || !a.sections.length) { w.innerHTML = ""; return; }
  const s0 = cfg.musicOff, s1 = cfg.musicOff + R.endT() / 1000;
  w.innerHTML = a.sections.map((s, i) => `<button class="sm${s.t1 > s0 && s.t0 < s1 ? " on" : ""}" data-i="${i}" title="Start the reel here"><i style="background:${TYPE_COLOR[s.type]}"></i><b>${s.label}</b><span class="ty">${TYPE_NAME[s.type]}</span><span class="tm">${fmtT(s.t0 * 1000).replace(/\.\d$/, "")} – ${fmtT(s.t1 * 1000).replace(/\.\d$/, "")}</span></button>`).join("");
}
$("bestBtn").onclick = () => {
  const a = song(); if (!a) return;
  const fit = cfg.rhythm === "song" && cfg.lenMode === "fit";
  setOffset(bestStart(a, fit || !tl.D ? 30 : R.endT() / 1000)); regen(); seek(0);
};
$("songMap").addEventListener("click", (e) => {
  const b = e.target.closest(".sm"); if (!b) return;
  const s = song().sections[+b.dataset.i]; if (!s) return;
  setOffset(s.t0); regen(); seek(0);
});

/* ---------- the strip ---------- */
let wavePeaks = null;
function peaksOf(buf) {
  const d = buf.getChannelData(0), n = 1200, per = d.length / n, out = new Float32Array(n);
  let mx = 1e-9;
  for (let b = 0; b < n; b++) { let m = 0; const e = Math.min(d.length, Math.floor((b + 1) * per)); for (let i = Math.floor(b * per); i < e; i += 4) { const v = Math.abs(d[i]); if (v > m) m = v; } out[b] = m; if (m > mx) mx = m; }
  for (let b = 0; b < n; b++) out[b] /= mx;
  return out;
}
function drawStrip() {
  const a = song(), dur = a ? a.duration : AU.A.buffer ? AU.A.buffer.duration : 0;
  const has = dur > 0 || !!AU.A.file;
  $("stripAdd").hidden = has; $("stripWin").hidden = !(dur > 0); $("stripHead").hidden = !(dur > 0);
  const c = $("stripCv"), W = Math.max(1, c.clientWidth), H = Math.max(1, c.clientHeight), dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
  const g = c.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  if (!(dur > 0)) return;
  const x = (s) => s / dur * W;
  if (a) for (const s of a.sections) { g.fillStyle = TYPE_COLOR[s.type] + "26"; g.fillRect(x(s.t0), 0, Math.max(1, x(s.t1) - x(s.t0)), H); }
  if (a) for (const f of a.fills) { g.fillStyle = "#ff5a4d55"; g.fillRect(x(f.t0), 0, Math.max(1, x(f.t1) - x(f.t0)), 4); }
  if (wavePeaks) {
    const n = wavePeaks.length, mid = H / 2; g.fillStyle = "#565c64";
    for (let i = 0; i < n; i++) { const bh = Math.max(0.5, wavePeaks[i] * H * 0.38); g.fillRect(i / n * W, mid - bh, Math.max(1, W / n), bh * 2); }
  }
  if (a && a.beats.length) {
    for (const b of a.beats) { g.fillStyle = b.down ? "#e9e7e2aa" : "#8b919955"; const h = b.down ? 7 : 4; g.fillRect(x(b.t), H - h, 1, h); }
  }
  if (a && a.pitch && !AU.A.melodyPending) {
    const p = a.pitch, hop = a.curves.hop; let lo = 127, hi = 0;
    for (const v of p) if (v > 0) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (hi > lo) {
      g.strokeStyle = "#ffc24bcc"; g.lineWidth = 1.2; g.beginPath(); let pen = false;
      for (let i = 0; i < p.length; i++) { if (!(p[i] > 0)) { pen = false; continue; } const X = x(i * hop), Y = 6 + (1 - (p[i] - lo) / (hi - lo)) * (H - 16); if (pen) g.lineTo(X, Y); else g.moveTo(X, Y); pen = true; }
      g.stroke();
    }
  }
  // the cuts, where they land in the song
  g.fillStyle = "#ff3b30";
  for (const e of tl.events) { const s = cfg.musicOff + (e.mt != null ? e.mt : e.t) / 1000; if (s <= dur) g.fillRect(x(s) - 0.5, 0, 1, 6); }
  const left = cfg.musicOff / dur, width = Math.min(R.endT() / 1000, dur - cfg.musicOff) / dur;
  $("stripWin").style.left = left * 100 + "%"; $("stripWin").style.width = Math.max(0, width) * 100 + "%";
  transport();
}
(function stripDrag() {
  const s = $("strip"); let drag = null;
  const durOf = () => { const a = song(); return a ? a.duration : AU.A.buffer ? AU.A.buffer.duration : 0; };
  s.addEventListener("pointerdown", (e) => {
    const d = durOf(); if (!(d > 0) || e.target.closest("#stripAdd")) return;
    const r = s.getBoundingClientRect(), at = (e.clientX - r.left) / r.width * d;
    const winEnd = cfg.musicOff + R.endT() / 1000;
    drag = { grab: at >= cfg.musicOff && at <= winEnd ? at - cfg.musicOff : 0 };
    s.setPointerCapture(e.pointerId);
    setOffset(at - drag.grab);
  });
  s.addEventListener("pointermove", (e) => {
    if (!drag) return; const d = durOf(), r = s.getBoundingClientRect();
    setOffset((e.clientX - r.left) / r.width * d - drag.grab);
  });
  const end = () => { if (drag) { drag = null; regen(); } };
  s.addEventListener("pointerup", end); s.addEventListener("pointercancel", end);
  let rt = 0; addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(drawStrip, 120); });
})();

/* ---------- export ---------- */
let support = null;
async function refreshFormat() {
  const br = cfg.bitrate * 1e6;
  support = await X.fastSupport(cv.width, cv.height, +cfg.fps, br, AU.hasSound(cfg)).catch(() => null);
  const mime = X.pickMime();
  $("fmtLine").textContent = support ? `Fast · ${support.label}` : mime ? `Real time · ${mime.includes("mp4") ? "MP4" : "WebM"}` : "This browser cannot export video.";
  $("lcdF").textContent = support ? "MP4" : mime ? (mime.includes("mp4") ? "MP4" : "WEBM") : "N/A";
}
function exportUI(on, text) {
  $("recDot").hidden = !on; if (text) $("recText").textContent = text;
  $("exportBtn2").innerHTML = on ? '<svg><use href="#i-close"/></svg>Stop' : '<svg><use href="#i-rec"/></svg>Export the reel';
  $("exportBtn2").disabled = false; $("exportBtn").disabled = on || !P.state.photos.length;
  $("expProg").hidden = !on;
}
const prog = (p) => { $("expProg").firstElementChild.style.width = Math.round(p * 100) + "%"; $("recText").textContent = "EXPORT " + Math.round(p * 100) + "%"; };
async function exportReel() {
  if (player.exporting) { player.cancel = true; if (player.exporting === "rt") finishRealtime(true); return; }
  if (!P.state.photos.length) return;
  pause();
  await refreshFormat();
  const fps = +cfg.fps, total = R.endT();
  player.cancel = false; $("exportDone").hidden = true;
  if (support) {
    player.exporting = "fast"; exportUI(true, "EXPORT 0%");
    const t0 = performance.now();
    try {
      let mix = null;
      if (AU.hasSound(cfg)) { $("exportStat").textContent = "Mixing the soundtrack…"; mix = await AU.renderMix(cfg, tl.events.map((e) => e.t), total); }
      $("exportStat").textContent = "Encoding…";
      R.invalidate();
      const blob = await X.exportFast({ support, canvas: cv, fps, totalMs: total, draw: (t) => R.frame(t), mix, progress: prog, cancelled: () => player.cancel });
      if (blob) done(blob, "mp4", `in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
      else $("exportStat").textContent = "Stopped.";
    } catch (err) {
      $("exportStat").innerHTML = `<span class="err">The encoder stopped: ${esc((err && err.message) || err)}.</span> Trying again at a lower resolution or bitrate usually works.`;
    } finally { player.exporting = null; exportUI(false); R.invalidate(); seek(0); stats(); }
    return;
  }
  // real time
  try {
    const ctx = AU.ensureCtx(cfg); if (ctx.resume) await ctx.resume();
    const track = AU.hasSound(cfg) && AU.A.dest ? AU.A.dest.stream.getAudioTracks()[0] : null;
    player.rt = X.startRecorder(cv, fps, cfg.bitrate * 1e6, track);
  } catch (err) { $("exportStat").innerHTML = `<span class="err">${esc((err && err.message) || err)}</span>`; return; }
  player.exporting = "rt"; player.loopWas = player.loop; player.loop = false; player.rtStart = performance.now();
  exportUI(true, "REC");
  $("exportStat").textContent = "Recording in real time. Keep this tab in front until it finishes.";
  R.invalidate(); seek(0); play(true);
}
async function finishRealtime(cancelled) {
  if (player.exporting !== "rt") return;
  const rec = player.rt, wall = performance.now() - player.rtStart;
  pause(); player.exporting = null; player.loop = player.loopWas; player.rt = null; exportUI(false);
  try {
    const blob = await rec.stop(wall);
    if (cancelled) $("exportStat").textContent = "Stopped.";
    else done(blob, rec.ext, "in real time");
  } catch (err) { $("exportStat").innerHTML = `<span class="err">${esc((err && err.message) || err)}</span>`; }
  stats();
}
function done(blob, ext, how) {
  const name = `burstdump_${cv.width}x${cv.height}_${Math.round(tl.D / 1000)}s.${ext}`;
  lastFile = new File([blob], name, { type: blob.type });
  download(lastFile);
  $("exportStat").innerHTML = `Saved <b>${esc(name)}</b> · ${fmtMB(blob.size)} · ${how}`;
  $("exportDone").hidden = false;
  try { $("shareBtn").hidden = !(navigator.canShare && navigator.canShare({ files: [lastFile] })); } catch (e) { $("shareBtn").hidden = true; }
}
function download(f) {
  const url = URL.createObjectURL(f), a = document.createElement("a");
  a.href = url; a.download = f.name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
$("exportBtn").onclick = () => { selectTab("export"); exportReel(); };
$("exportBtn2").onclick = exportReel;
$("saveAgain").onclick = () => { if (lastFile) download(lastFile); };
$("shareBtn").onclick = () => { if (lastFile) navigator.share({ files: [lastFile], title: "BURST//DUMP" }).catch(() => {}); };
document.addEventListener("visibilitychange", () => {
  if (document.hidden && player.exporting === "rt") $("exportStat").innerHTML = '<span class="warn">This tab went to the background while recording: the video may stutter there.</span>';
});

/* ---------- transport & keys ---------- */
$("playBtn").onclick = () => (player.playing ? pause() : play(true));
$("loopBtn").onclick = (e) => { player.loop = !player.loop; e.currentTarget.classList.toggle("on", player.loop); e.currentTarget.setAttribute("aria-pressed", String(player.loop)); };
$("scrub").addEventListener("input", (e) => seek(e.target.value / 1000 * R.endT()));
$("fsBtn").onclick = () => { const el = $("canvasWrap"); if (document.fullscreenElement) document.exitFullscreen(); else if (el.requestFullscreen) el.requestFullscreen().catch(() => {}); };
cv.addEventListener("dblclick", () => $("fsBtn").click());
addEventListener("keydown", (e) => {
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) || info.isOpen() || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.code === "Space") { e.preventDefault(); player.playing ? pause() : play(true); }
  else if (e.key === "f" || e.key === "F") $("fsBtn").click();
  else if (e.key === "r" || e.key === "R") reroll();
  else if (e.key === "e" || e.key === "E") { if (!$("exportBtn").disabled) $("exportBtn").click(); }
  else if (e.key === "ArrowLeft") seek(player.t - 1000);
  else if (e.key === "ArrowRight") seek(player.t + 1000);
});

/* ---------- tabs ---------- */
function selectTab(name) {
  document.querySelectorAll("#tabs [role=tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
  document.querySelectorAll(".pane").forEach((p) => { p.hidden = p.dataset.pane !== name; });
  $("panes").scrollTop = 0;
  try { localStorage.setItem("burstdump.tab", name); } catch (e) {}
}
$("tabs").addEventListener("click", (e) => { const b = e.target.closest("[role=tab]"); if (b) selectTab(b.dataset.tab); });

/* ---------- drag & drop ---------- */
let depth = 0;
addEventListener("dragenter", (e) => { e.preventDefault(); depth++; $("dropOverlay").hidden = false; });
addEventListener("dragleave", (e) => { e.preventDefault(); if (--depth <= 0) { depth = 0; $("dropOverlay").hidden = true; } });
addEventListener("dragover", (e) => e.preventDefault());
addEventListener("drop", async (e) => {
  e.preventDefault(); depth = 0; $("dropOverlay").hidden = true;
  const files = await P.filesFromDrop(e.dataTransfer);
  const audio = files.find(isAudio);
  const imgs = files.filter((f) => !isAudio(f));
  if (audio) loadSong(audio);
  if (P.images(imgs).imgs.length) ingest(imgs);
});

/* ---------- start ---------- */
renderChips(); renderRuns();
canvasSize(); R.clear(); refreshVisibility(); stats(); drawStrip(); refreshFormat();
try { const t = localStorage.getItem("burstdump.tab"); if (t && document.querySelector(`[data-pane="${t}"]`)) selectTab(t); } catch (e) {}
setPlayIcon();
requestAnimationFrame((t) => { player.last = t; tick(t); });

info.init();
$("verLine").textContent = "Version " + update.version();
$("btnCheckUpdate").onclick = async () => {
  const b = $("btnCheckUpdate"); b.disabled = true; b.textContent = "Checking…";
  const r = await update.checkNow();
  b.disabled = false;
  b.textContent = { ready: "Update ready, reload", downloading: "Downloading…", current: "Up to date", offline: "Offline", unsupported: "Not installed" }[r] || "Check for updates";
  if (r === "ready") b.onclick = () => update.apply();
};
const busy = () => !!player.exporting;
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").then((reg) => update.init(reg, busy)).catch(() => update.init(null, busy));
} else update.init(null, busy);

// for tools/e2e.js
window.__bd = { cfg, player, tl: () => tl, song, photos: () => P.state.photos, regen, support: () => support };
