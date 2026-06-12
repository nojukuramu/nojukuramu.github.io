/* Pinoy Word Games — game logic
 * Hash-routed mini SPA: #/ (home), #/levels, #/level/N, #/manual.
 * Single-screen layout: lessons/reminders and the win screen are overlays,
 * and input comes from the in-game keyboard (the OS virtual keyboard never
 * opens — the inputs are readonly + inputmode="none").
 *
 * Anti-cheat model (frontend-only):
 *  - The bank ships no answers, only salted SHA-256 hashes per word;
 *    guesses are hashed locally and compared (works offline too).
 *  - Progress must prove itself: each solved entry stores the answer the
 *    player typed, and it is re-verified against the hashes on every boot.
 *    Editing localStorage to "unlocked: 100" does nothing — unlocks are
 *    recomputed from verified solves only.
 */

import { PWG_QUESTIONS, typeLabel } from "./questions.js";
import { loadBank } from "./firebase.js";

/* ---------------- answer hashing (matches mysite/pwg_bank/build.mjs) ------ */

const HASH_SALT = "pwg-v1";

async function sha256Hex(s) {
  const data = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const hashWord = (level, slot, word) => sha256Hex(`${HASH_SALT}|${level}|${slot}|${word}`);

/* ---------------- progress (localStorage, self-proving) ---------------- */

const PROGRESS_KEY = "pwg:v2:progress";

let progress = { unlocked: 1, solved: {} };

function recomputeUnlocked() {
  let n = 1;
  while (progress.solved[n]) n++;
  progress.unlocked = Math.min(n, TOTAL());
}

/* Each stored solve must carry the answer; entries whose answer no longer
 * hashes to the bank's h1/h2 are dropped. */
async function loadAndVerifyProgress() {
  let raw;
  try { raw = JSON.parse(localStorage.getItem(PROGRESS_KEY) || "{}"); } catch (e) { raw = {}; }
  const solved = {};
  const entries = Object.entries(raw.solved && typeof raw.solved === "object" ? raw.solved : {});
  for (const [key, rec] of entries) {
    const lv = parseInt(key, 10);
    const it = bankByLevel.get(lv);
    if (!it || !rec || typeof rec.a !== "string") continue;
    const [g1, g2] = rec.a.split("-").map(normalizeWord);
    if (!g1 || !g2) continue;
    const [c1, c2] = await Promise.all([hashWord(lv, 1, g1), hashWord(lv, 2, g2)]);
    if (c1 === it.h1 && c2 === it.h2) solved[lv] = { ts: rec.ts || Date.now(), a: g1 + " - " + g2 };
  }
  progress = { unlocked: 1, solved };
  recomputeUnlocked();
}

function saveProgress() {
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress)); } catch (e) { /* ok */ }
}

/* ---------------- bank ---------------- */

let bank = PWG_QUESTIONS.slice();          // playable immediately
let bankByLevel = indexBank(bank);
const TOTAL = () => bank.length;

function indexBank(items) {
  const m = new Map();
  for (const it of items) m.set(it.level, it);
  return m;
}

loadBank(PWG_QUESTIONS).then(({ items, source }) => {
  bank = items;
  bankByLevel = indexBank(bank);
  if (source === "cloud") toast("☁️ Na-load ang mga tanong mula sa cloud");
  // refresh home/levels with cloud data, but never disturb an active play
  // session (it would close overlays and wipe typed letters); the fresh
  // bank applies on the next level load
  if (!views.play.classList.contains("active")) route();
}).catch(() => { /* bundled bank already in place */ });

/* ---------------- tiny helpers ---------------- */

const $ = (sel) => document.querySelector(sel);

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2600);
}

function normalizeWord(s) {
  return (s || "")
    .toUpperCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // strip accents, keep base letters
    .replace(/[^A-ZÑ]/g, "");
}

/* ---------------- letter-tile mechanic visualizer ----------------
 * DL = added tiles at the end, BL = removed tiles at the end,
 * KL = swapped positions, BS = inserted tiles in the middle.
 * Blank tiles come from the bank's hint metadata (len/kl/bs) — the
 * answers themselves are not available client-side until solved. */

function kindOf(type) { return (/(DL|BL|KL|BS)$/.exec(type) || [])[1]; }

function decorateRows(row1, row2, type, klPos, bsIdx) {
  const kind = kindOf(type);
  if (kind === "DL") {
    for (let i = row1.length; i < row2.length; i++) row2[i].cls = "add";
  } else if (kind === "BL") {
    for (let i = row2.length; i < row1.length; i++) row1[i].cls = "cut";
  } else if (kind === "KL") {
    for (const p of klPos || []) {
      if (row1[p]) row1[p].cls = "swap";
      if (row2[p]) row2[p].cls = "swap";
    }
  } else if (kind === "BS" && typeof bsIdx === "number") {
    for (let i = bsIdx; i < bsIdx + (row2.length - row1.length); i++) {
      if (row2[i]) row2[i].cls = "ins";
    }
  }
  return [row1, row2];
}

const blankRow = (n) => Array.from({ length: n }, () => ({ ch: "", cls: "" }));
const wordRow = (w) => w.split("").map((ch) => ({ ch, cls: "" }));

/* blank tiles for an unsolved level, from hint metadata */
function rowsFromMeta(it) {
  return decorateRows(blankRow(it.len[0]), blankRow(it.len[1]), it.type, it.kl, it.bs);
}

/* revealed tiles from known words (tutorial examples, win screen, replays) */
function rowsFromWords(a1, a2, type) {
  let kl = [], bs;
  const kind = kindOf(type);
  if (kind === "KL") {
    for (let i = 0; i < a1.length; i++) if (a1[i] !== a2[i]) kl.push(i);
  } else if (kind === "BS") {
    const valid = [];
    for (let p = 1; p < a1.length; p++) {
      if (a2.startsWith(a1.slice(0, p)) && a2.endsWith(a1.slice(p))) valid.push(p);
    }
    const mid = a1.length / 2;
    bs = valid.length ? valid.reduce((b, x) => Math.abs(x - mid) < Math.abs(b - mid) ? x : b) : undefined;
  }
  return decorateRows(wordRow(a1), wordRow(a2), type, kl, bs);
}

function tilesHTML(rows) {
  const row = (tiles) => '<div class="tiles">' +
    tiles.map((t) => `<b class="tile ${t.cls}">${t.ch}</b>`).join("") +
    "</div>";
  return `<div class="tiles-wrap">${row(rows[0])}<span class="tiles-arrow">→</span>${row(rows[1])}</div>`;
}

function tilesFromAnswer(answer, type) {
  const [a1, a2] = answer.split("-").map(normalizeWord);
  return tilesHTML(rowsFromWords(a1, a2, type));
}

/* ---------------- floating cozy bits ---------------- */

(function makeFloaties() {
  const icons = ["☁️", "🌤", "🍃", "⭐", "🌸", "☕", "🪁", "🐦"];
  const host = $("#floaties");
  const n = 10;
  let html = "";
  for (let i = 0; i < n; i++) {
    const icon = icons[i % icons.length];
    const left = Math.round(Math.random() * 92) + 2;
    const top = Math.round(Math.random() * 88) + 4;
    const dur = (18 + Math.random() * 16).toFixed(1);
    const delay = (-Math.random() * 20).toFixed(1);
    const dx = Math.round(Math.random() * 80 - 40);
    const dy = Math.round(-30 - Math.random() * 60);
    html += `<span class="floaty" style="left:${left}%;top:${top}%;--dur:${dur}s;--delay:${delay}s;--dx:${dx}px;--dy:${dy}px">${icon}</span>`;
  }
  host.innerHTML = html;
})();

/* ---------------- routing ---------------- */

const views = {
  home: $("#view-home"),
  levels: $("#view-levels"),
  play: $("#view-play"),
  manual: $("#view-manual")
};

function show(name) {
  for (const key of Object.keys(views)) views[key].classList.toggle("active", key === name);
  if (name !== "play") closeOverlays();
}

function route() {
  const hash = location.hash || "#/";
  const mLevel = /^#\/level\/(\d+)$/.exec(hash);
  if (mLevel) {
    const lv = parseInt(mLevel[1], 10);
    if (bankByLevel.has(lv) && lv <= progress.unlocked) {
      renderPlay(lv);
      show("play");
      return;
    }
    location.hash = "#/levels";
    return;
  }
  if (hash === "#/levels") { renderLevels(); show("levels"); return; }
  if (hash === "#/manual") { show("manual"); return; }
  renderHome();
  show("home");
}

window.addEventListener("hashchange", route);

document.addEventListener("click", (e) => {
  const go = e.target.closest("[data-go]");
  if (go) location.hash = go.getAttribute("data-go");
});

/* ---------------- overlays ---------------- */

function closeOverlays() {
  $("#overlay-tut").classList.remove("show");
  $("#overlay-win").classList.remove("show");
}

// backdrop tap closes the lesson overlay (win overlay needs a button choice)
$("#overlay-tut").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) $("#overlay-tut").classList.remove("show");
});
$("#btn-tut-close").addEventListener("click", () => $("#overlay-tut").classList.remove("show"));

function openLessonOverlay() {
  if (!current || (!current.tut && !current.tip)) return;
  let html = "";
  if (current.tut) {
    const t = current.tut;
    html = `<div class="tut-label">📚 TUTORIAL</div><h3>${t.title}</h3><p>${t.text}</p>`;
    if (t.example) {
      html += `<div class="tut-example">` +
        `<div class="tut-eq">Q: ${t.example.q}</div>` +
        tilesFromAnswer(t.example.a, current.type) +
        `<div class="tut-ea">A: <b>${t.example.a}</b></div>` +
        `<p class="tut-note">${t.example.note}</p>` +
        `</div>`;
    }
  } else {
    html = `<div class="tut-label">📌 PAALALA</div><p>${current.tip}</p>`;
  }
  $("#tut-content").innerHTML = html;
  $("#overlay-tut").classList.add("show");
}

$("#btn-lesson").addEventListener("click", openLessonOverlay);

function openWinOverlay(opts) {
  $("#win-title").textContent = opts.title;
  $("#win-answer").textContent = opts.answer;
  $("#win-tiles").innerHTML = tilesFromAnswer(opts.answer, opts.type);
  $("#win-sub").textContent = opts.sub || "";
  $("#btn-win-next").textContent = opts.hasNext ? "Susunod →" : "🏆 Tapos na lahat!";
  $("#overlay-win").classList.add("show");
}

$("#btn-win-levels").addEventListener("click", () => {
  closeOverlays();
  location.hash = "#/levels";
});
$("#btn-win-next").addEventListener("click", () => {
  closeOverlays();
  const next = current && bankByLevel.has(current.level + 1) ? current.level + 1 : null;
  if (next && next <= progress.unlocked) location.hash = "#/level/" + next;
  else location.hash = "#/levels";
});

/* ---------------- home ---------------- */

function renderHome() {
  const solvedCount = Object.keys(progress.solved).length;
  const el = $("#home-progress");
  el.textContent = solvedCount
    ? `★ ${solvedCount}/${TOTAL()} level ang nasagot mo na — tuloy lang!`
    : "Simulan natin sa Level 1 — kayang-kaya mo 'yan! 💪";
}

$("#btn-play").addEventListener("click", () => {
  const next = Math.min(progress.unlocked, TOTAL());
  location.hash = "#/level/" + next;
});
$("#btn-levels").addEventListener("click", () => { location.hash = "#/levels"; });
$("#nav-manual").addEventListener("click", () => { location.hash = "#/manual"; });

// Daily Questions is intentionally disabled (coming soon)
$("#btn-daily").addEventListener("click", (e) => {
  e.preventDefault();
  toast("📅 Daily Questions — malapit na! ✨");
});

/* ---------------- levels grid ---------------- */

function renderLevels() {
  const grid = $("#level-grid");
  const solvedCount = Object.keys(progress.solved).length;
  $("#levels-meta").textContent = `★ ${solvedCount}/${TOTAL()}`;
  let html = "";
  for (const it of bank) {
    const lv = it.level;
    const solved = !!progress.solved[lv];
    const locked = lv > progress.unlocked;
    const cls = solved ? "solved" : (locked ? "locked" : (lv === progress.unlocked ? "current" : ""));
    html += `<button class="lvl ${cls}" data-level="${lv}" ${locked ? "disabled" : ""} aria-label="Level ${lv}${locked ? " (naka-lock)" : ""}">` +
      (locked ? "🔒" : lv) +
      "</button>";
  }
  grid.innerHTML = html;
}

$("#level-grid").addEventListener("click", (e) => {
  const btn = e.target.closest(".lvl");
  if (!btn || btn.disabled) return;
  location.hash = "#/level/" + btn.dataset.level;
});

/* ---------------- play ---------------- */

let current = null;   // current question object
let hintStep = 0;
let checking = false; // guard against double-submits while hashing
const seenLessons = new Set(); // auto-open each lesson once per visit

const w1 = $("#word1");
const w2 = $("#word2");
let active = w1;      // which word box the keyboard types into

function setActive(input) {
  active = input;
  w1.classList.toggle("active", input === w1);
  w2.classList.toggle("active", input === w2);
}

w1.addEventListener("click", () => { if (!w1.disabled) setActive(w1); });
w2.addEventListener("click", () => { if (!w2.disabled) setActive(w2); });

function renderPlay(level) {
  current = bankByLevel.get(level);
  hintStep = 0;
  checking = false;
  $("#play-level").textContent = "Level " + level;
  $("#play-type").textContent = current.type;
  $("#play-kind").textContent = typeLabel(current.type);
  $("#play-clue").textContent = current.q;
  $("#feedback").textContent = "";
  $("#feedback").className = "feedback";
  $("#hint-box").innerHTML = "";
  $("#btn-lesson").style.display = (current.tut || current.tip) ? "" : "none";
  closeOverlays();

  // Tutorial levels get the answer-shape tiles for free (that's hint step 1,
  // so the 💡 button goes straight to first letters there).
  if (current.tut || current.tip) {
    hintStep = 1;
    $("#hint-box").innerHTML =
      `<div class="hint-line">Hugis ng sagot:</div>` + tilesHTML(rowsFromMeta(current));
  }

  const rec = progress.solved[level];
  w1.value = "";
  w2.value = "";
  w1.disabled = w2.disabled = !!rec;
  $("#kb").style.display = rec ? "none" : "";
  $("#solved-bar").classList.toggle("show", !!rec);

  if (rec) {
    // the verified answer the player earned, stored in their progress
    const [a1, a2] = rec.a.split("-").map(normalizeWord);
    w1.value = a1; w2.value = a2;
    w1.classList.remove("active"); w2.classList.remove("active");
    $("#btn-next-inline").textContent = bankByLevel.has(level + 1) ? "Susunod →" : "🏆 Tapos!";
  } else {
    setActive(w1);
    // lessons & reminders appear as an overlay, once per level per visit
    if ((current.tut || current.tip) && !seenLessons.has(level)) {
      seenLessons.add(level);
      openLessonOverlay();
    }
  }
}

$("#btn-next-inline").addEventListener("click", () => {
  const next = current && bankByLevel.has(current.level + 1) ? current.level + 1 : null;
  if (next && next <= progress.unlocked) location.hash = "#/level/" + next;
  else location.hash = "#/levels";
});

/* --- in-game keyboard (the OS virtual keyboard stays closed) --- */

const MAX_WORD_LEN = 14;

function typeChar(ch) {
  if (!current || progress.solved[current.level]) return;
  if (active.value.length < MAX_WORD_LEN) {
    active.value += ch;
    $("#feedback").textContent = "";
    $("#feedback").className = "feedback";
  }
}

function doDash() {
  // the dash between the words is fixed; "-" just hops to the other box
  if (!current || progress.solved[current.level]) return;
  setActive(active === w1 ? w2 : w1);
}

function doBackspace() {
  if (!current || progress.solved[current.level]) return;
  if (active.value) {
    active.value = active.value.slice(0, -1);
  } else if (active === w2) {
    setActive(w1);
    w1.value = w1.value.slice(0, -1);
  }
}

$("#kb").addEventListener("click", (e) => {
  const key = e.target.closest(".key[data-k]");
  if (!key) return;
  const k = key.dataset.k;
  if (k === "back") doBackspace();
  else if (k === "-") doDash();
  else typeChar(k);
});

// physical keyboard still works on desktop
document.addEventListener("keydown", (e) => {
  if (!views.play.classList.contains("active")) return;
  if ($("#overlay-tut").classList.contains("show")) {
    if (e.key === "Enter" || e.key === "Escape") $("#overlay-tut").classList.remove("show");
    return;
  }
  if ($("#overlay-win").classList.contains("show")) {
    if (e.key === "Enter") $("#btn-win-next").click();
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === "Enter") { checkAnswer(); return; }
  if (e.key === "Backspace") { e.preventDefault(); doBackspace(); return; }
  if (/^[-–—]$/.test(e.key)) { e.preventDefault(); doDash(); return; }
  if (e.key === "ArrowLeft") { setActive(w1); return; }
  if (e.key === "ArrowRight") { setActive(w2); return; }
  const ch = normalizeWord(e.key);
  if (ch.length === 1) { e.preventDefault(); typeChar(ch); }
});

// pasting "WORD1 - WORD2" anywhere on the play screen fills both boxes
document.addEventListener("paste", (e) => {
  if (!views.play.classList.contains("active")) return;
  if (!current || progress.solved[current.level]) return;
  const text = (e.clipboardData || window.clipboardData).getData("text") || "";
  if (!text) return;
  e.preventDefault();
  if (text.includes("-")) {
    const [p1, ...rest] = text.split("-");
    w1.value = normalizeWord(p1).slice(0, MAX_WORD_LEN);
    w2.value = normalizeWord(rest.join("-")).slice(0, MAX_WORD_LEN);
    setActive(w2);
  } else {
    active.value = normalizeWord(text).slice(0, MAX_WORD_LEN);
  }
});

/* --- checking (guesses are hashed; the answer never exists in the code) --- */

async function checkAnswer() {
  if (!current || progress.solved[current.level] || checking) return;
  const g1 = normalizeWord(w1.value);
  const g2 = normalizeWord(w2.value);
  const fb = $("#feedback");

  if (!g1 || !g2) {
    fb.textContent = "Kumpletuhin ang dalawang salita 🙂";
    fb.className = "feedback no";
    return;
  }

  checking = true;
  let ok1 = false, ok2 = false;
  try {
    const [c1, c2] = await Promise.all([
      hashWord(current.level, 1, g1),
      hashWord(current.level, 2, g2)
    ]);
    ok1 = c1 === current.h1;
    ok2 = c2 === current.h2;
  } catch (e) {
    checking = false;
    toast("⚠️ Kailangan ng secure (https) na koneksyon para makapaglaro");
    return;
  }
  checking = false;

  if (ok1 && ok2) {
    const isGrad = !!(current.tut && current.tut.grad);
    const answer = g1 + " - " + g2;
    progress.solved[current.level] = { ts: Date.now(), a: answer };
    recomputeUnlocked();
    saveProgress();
    fb.textContent = "";
    w1.disabled = w2.disabled = true;
    $("#kb").style.display = "none";
    openWinOverlay({
      title: isGrad ? "🎓 Pasado ka!" : "🎉 Tama!",
      answer,
      type: current.type,
      sub: isGrad ? "Tapos na ang tutorial — handa ka na sa totoong laban!" : "",
      hasNext: bankByLevel.has(current.level + 1)
    });
    celebrate();
  } else if (ok1 || ok2) {
    fb.textContent = "Malapit na! Tama na ang isang salita 👀";
    fb.className = "feedback no";
  } else {
    fb.textContent = "Hindi pa tama — subukan muli! 💭";
    fb.className = "feedback no";
    $(".answer-row").classList.remove("shake");
    void $(".answer-row").offsetWidth;
    $(".answer-row").classList.add("shake");
  }
}

$("#btn-check").addEventListener("click", checkAnswer);

/* --- hints: 1) answer-shape tiles, 2) first letters (from hint metadata) --- */
$("#btn-hint").addEventListener("click", () => {
  if (!current || progress.solved[current.level]) return;
  const box = $("#hint-box");
  hintStep = Math.min(hintStep + 1, 2);
  let html = "";
  if (hintStep >= 1) {
    html += `<div class="hint-line">💡 Hugis ng sagot:</div>` + tilesHTML(rowsFromMeta(current));
  }
  if (hintStep >= 2 && current.f) {
    html += `<div class="hint-line">💡 Unang letra: <b>${current.f[0]}…</b> — <b>${current.f[1]}…</b></div>`;
  }
  box.innerHTML = html;
});

/* --- tiny celebration burst --- */
function celebrate() {
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const icons = ["🎉", "✨", "⭐", "🎊", "💛"];
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  for (let i = 0; i < 14; i++) {
    const s = document.createElement("span");
    s.className = "burst";
    s.textContent = icons[i % icons.length];
    s.style.left = cx + "px";
    s.style.top = cy + "px";
    s.style.setProperty("--bx", Math.round(Math.random() * 360 - 180) + "px");
    s.style.setProperty("--by", Math.round(-80 - Math.random() * 240) + "px");
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 1000);
  }
}

/* ---------------- PWA: install button + offline cache ---------------- */

let installPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
  $("#btn-install").style.display = "";
});
$("#btn-install").addEventListener("click", async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $("#btn-install").style.display = "none";
});
window.addEventListener("appinstalled", () => {
  $("#btn-install").style.display = "none";
  toast("🏠 Na-install ang Pinoy Word Games!");
});

/* ---------------- Sync Up: pull the latest version ----------------
 * Installed PWAs keep serving the cached app shell, so we (a) auto-check for
 * a new service worker on every load and when the app regains focus, (b) nudge
 * the player with a dot on the Sync Up button when one is ready, and (c) let
 * Sync Up activate the waiting worker and reload into the fresh version. */

const btnSync = $("#btn-sync");
let swReg = null;
let userTriggeredSync = false;

function markUpdateReady() {
  btnSync.classList.add("has-update");
  btnSync.title = "May bagong bersyon — pindutin para mag-update";
  toast("✨ May bagong bersyon — pindutin ang Sync Up");
}

function watchRegistration(reg) {
  swReg = reg;
  // a worker already waiting from a previous visit
  if (reg.waiting && navigator.serviceWorker.controller) markUpdateReady();
  reg.addEventListener("updatefound", () => {
    const incoming = reg.installing;
    if (!incoming) return;
    incoming.addEventListener("statechange", () => {
      // "installed" + an existing controller == update (not first install)
      if (incoming.state === "installed" && navigator.serviceWorker.controller) markUpdateReady();
    });
  });
}

async function syncUp() {
  btnSync.classList.add("syncing");
  toast("🔄 Sina-sync sa pinakabago…");
  try {
    if (swReg) {
      await swReg.update();
      if (swReg.waiting) {
        // hand off to controllerchange, which reloads us into the new version
        userTriggeredSync = true;
        swReg.waiting.postMessage({ type: "SKIP_WAITING" });
        return;
      }
    }
  } catch (e) { /* fall through to a plain reload */ }
  // already current (or no service worker): a reload still re-pulls assets
  setTimeout(() => location.reload(), 300);
}

btnSync.addEventListener("click", syncUp);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    // ignore the first-install clients.claim(); only reload when the player
    // chose to sync, so we never interrupt play unexpectedly
    if (!userTriggeredSync) return;
    location.reload();
  });
  navigator.serviceWorker.register("sw.js").then((reg) => {
    watchRegistration(reg);
    reg.update().catch(() => {});                 // auto-check on load
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") reg.update().catch(() => {});
    });
  }).catch(() => { /* offline play is a bonus */ });
}

/* ---------------- boot: verify stored progress, then route ---------------- */
loadAndVerifyProgress().then(() => {
  saveProgress(); // persist the cleaned-up state
  route();
}).catch(() => {
  // crypto unavailable (non-https) — start locked at level 1
  route();
});
