/* Pinoy Word Games — game logic
 * Hash-routed mini SPA: #/ (home), #/levels, #/level/N, #/manual.
 * Progress lives in localStorage; the question bank comes from Firestore
 * (front-end only) with the bundled bank as fallback.
 */

import { PWG_QUESTIONS, typeLabel } from "./questions.js";
import { loadBank } from "./firebase.js";

/* ---------------- progress (localStorage) ---------------- */

const PROGRESS_KEY = "pwg:v1:progress";

function loadProgress() {
  try {
    const p = JSON.parse(localStorage.getItem(PROGRESS_KEY) || "{}");
    return {
      unlocked: Math.max(1, p.unlocked | 0),
      solved: p.solved && typeof p.solved === "object" ? p.solved : {}
    };
  } catch (e) {
    return { unlocked: 1, solved: {} };
  }
}

function saveProgress() {
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress)); } catch (e) { /* ok */ }
}

const progress = loadProgress();

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
  route(); // re-render current view with fresh data
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

function splitAnswer(a) {
  const [w1, w2] = a.split("-").map((w) => normalizeWord(w));
  return [w1, w2];
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
  window.scrollTo({ top: 0 });
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
      (!locked ? `<span class="tag">${it.type}</span>` : "") +
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

const w1 = $("#word1");
const w2 = $("#word2");

function renderPlay(level) {
  current = bankByLevel.get(level);
  hintStep = 0;
  $("#play-level").textContent = "Level " + level;
  $("#play-type").textContent = current.type;
  $("#play-kind").textContent = typeLabel(current.type);
  $("#play-clue").textContent = current.q;
  $("#feedback").textContent = "";
  $("#feedback").className = "feedback";
  $("#hint-box").innerHTML = "";
  w1.value = "";
  w2.value = "";
  w1.disabled = w2.disabled = false;
  $("#btn-check").style.display = "";
  $("#btn-hint").style.display = "";

  const solvedBox = $("#solved-box");
  if (progress.solved[level]) {
    // already solved before: show it as solved, allow replay browsing
    const [a1, a2] = splitAnswer(current.a);
    w1.value = a1; w2.value = a2;
    w1.disabled = w2.disabled = true;
    $("#solved-answer").textContent = current.a;
    $("#btn-check").style.display = "none";
    $("#btn-hint").style.display = "none";
    $("#btn-next").textContent = nextLevelOf(level) ? "Susunod na Level →" : "Tapos na lahat! 🏆";
    solvedBox.classList.add("show");
  } else {
    solvedBox.classList.remove("show");
    setTimeout(() => w1.focus(), 50);
  }
}

function nextLevelOf(level) {
  return bankByLevel.has(level + 1) ? level + 1 : null;
}

/* --- TryHackMe-style dash handling: the dash between the two words is fixed.
 * Typing "-" (or "–"/em-dash/space at the end of word 1) jumps to word 2;
 * the character itself is swallowed. Backspace on an empty word 2 hops back. */

w1.addEventListener("beforeinput", (e) => {
  if (e.data && /[-–—]/.test(e.data)) {
    e.preventDefault();
    w2.focus();
  }
});

w2.addEventListener("keydown", (e) => {
  if (e.key === "Backspace" && w2.value === "") {
    e.preventDefault();
    w1.focus();
    const len = w1.value.length;
    w1.setSelectionRange(len, len);
  }
});

// Pasting a full "WORD1 - WORD2" into the first box splits it across both.
w1.addEventListener("paste", (e) => {
  const text = (e.clipboardData || window.clipboardData).getData("text") || "";
  if (text.includes("-")) {
    e.preventDefault();
    const [p1, ...rest] = text.split("-");
    w1.value = normalizeWord(p1);
    w2.value = normalizeWord(rest.join("-"));
    w2.focus();
  }
});

for (const input of [w1, w2]) {
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") checkAnswer();
  });
}

function checkAnswer() {
  if (!current || progress.solved[current.level]) return;
  const [a1, a2] = splitAnswer(current.a);
  const g1 = normalizeWord(w1.value);
  const g2 = normalizeWord(w2.value);
  const fb = $("#feedback");

  if (!g1 || !g2) {
    fb.textContent = "Kumpletuhin ang dalawang salita 🙂";
    fb.className = "feedback no";
    return;
  }

  if (g1 === a1 && g2 === a2) {
    progress.solved[current.level] = { ts: Date.now() };
    progress.unlocked = Math.max(progress.unlocked, Math.min(current.level + 1, TOTAL()));
    saveProgress();
    fb.textContent = "";
    w1.disabled = w2.disabled = true;
    $("#btn-check").style.display = "none";
    $("#btn-hint").style.display = "none";
    $("#solved-answer").textContent = current.a;
    $("#btn-next").textContent = nextLevelOf(current.level) ? "Susunod na Level →" : "Tapos na lahat! 🏆";
    $("#solved-box").classList.add("show");
    celebrate();
  } else if (g1 === a1 || g2 === a2) {
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

$("#btn-next").addEventListener("click", () => {
  const next = nextLevelOf(current.level);
  if (next && next <= progress.unlocked) location.hash = "#/level/" + next;
  else location.hash = "#/levels";
});

/* --- hints: 1) letter counts, 2) first letters --- */
$("#btn-hint").addEventListener("click", () => {
  if (!current) return;
  const [a1, a2] = splitAnswer(current.a);
  const box = $("#hint-box");
  hintStep = Math.min(hintStep + 1, 2);
  let html = "";
  if (hintStep >= 1) {
    html += `<div class="hint-line">💡 Bilang ng letra: <b>${a1.length}</b> — <b>${a2.length}</b></div>`;
  }
  if (hintStep >= 2) {
    html += `<div class="hint-line">💡 Unang letra: <b>${a1[0]}…</b> — <b>${a2[0]}…</b></div>`;
  }
  box.innerHTML = html;
});

/* --- tiny celebration burst --- */
function celebrate() {
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const icons = ["🎉", "✨", "⭐", "🎊", "💛"];
  const rect = $("#solved-box").getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + 20;
  for (let i = 0; i < 14; i++) {
    const s = document.createElement("span");
    s.className = "burst";
    s.textContent = icons[i % icons.length];
    s.style.left = cx + "px";
    s.style.top = cy + "px";
    s.style.setProperty("--bx", Math.round(Math.random() * 320 - 160) + "px");
    s.style.setProperty("--by", Math.round(-60 - Math.random() * 200) + "px");
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 1000);
  }
}

/* ---------------- boot ---------------- */
route();
