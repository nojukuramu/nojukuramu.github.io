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

/* ---------------- letter-tile mechanic visualizer ----------------
 * Renders the two answer words as tile rows with the mechanic highlighted:
 * DL = added tiles at the end, BL = removed tiles at the end,
 * KL = swapped positions, BS = inserted tiles in the middle.
 * With revealed=false the tiles stay blank, so it teaches the *shape*
 * of the answer without giving the letters away. */

function mechanicRows(a1, a2, type) {
  const kind = (/(DL|BL|KL|BS)$/.exec(type) || [])[1];
  const row1 = a1.split("").map((ch) => ({ ch, cls: "" }));
  const row2 = a2.split("").map((ch) => ({ ch, cls: "" }));
  if (kind === "DL") {
    for (let i = a1.length; i < a2.length; i++) row2[i].cls = "add";
  } else if (kind === "BL") {
    for (let i = a2.length; i < a1.length; i++) row1[i].cls = "cut";
  } else if (kind === "KL") {
    for (let i = 0; i < a1.length; i++) {
      if (a1[i] !== a2[i]) { row1[i].cls = "swap"; row2[i].cls = "swap"; }
    }
  } else if (kind === "BS") {
    // several splits can be valid (K+ALAP+ATI vs KA+LAPA+TI) — show the most
    // balanced one, which matches how the clues are meant to be read
    const valid = [];
    for (let p = 1; p < a1.length; p++) {
      if (a2.startsWith(a1.slice(0, p)) && a2.endsWith(a1.slice(p))) valid.push(p);
    }
    if (valid.length) {
      const mid = a1.length / 2;
      const p = valid.reduce((best, x) => Math.abs(x - mid) < Math.abs(best - mid) ? x : best);
      for (let i = p; i < p + (a2.length - a1.length); i++) row2[i].cls = "ins";
    }
  }
  return [row1, row2];
}

function tilesHTML(answer, type, revealed) {
  const [a1, a2] = splitAnswer(answer);
  const [row1, row2] = mechanicRows(a1, a2, type);
  const row = (tiles) => '<div class="tiles">' +
    tiles.map((t) => `<b class="tile ${t.cls}">${revealed ? t.ch : ""}</b>`).join("") +
    "</div>";
  return `<div class="tiles-wrap">${row(row1)}<span class="tiles-arrow">→</span>${row(row2)}</div>`;
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

function renderTutorial() {
  const box = $("#tut-box");
  if (current.tut) {
    const t = current.tut;
    let html = `<div class="tut-label">📚 TUTORIAL</div><h3>${t.title}</h3><p>${t.text}</p>`;
    if (t.example) {
      html += `<div class="tut-example">` +
        `<div class="tut-eq">Q: ${t.example.q}</div>` +
        tilesHTML(t.example.a, current.type, true) +
        `<div class="tut-ea">A: <b>${t.example.a}</b></div>` +
        `<p class="tut-note">${t.example.note}</p>` +
        `</div>`;
    }
    box.innerHTML = html;
    box.style.display = "";
  } else if (current.tip) {
    box.innerHTML = `<div class="tut-label">📌 PAALALA</div><p>${current.tip}</p>`;
    box.style.display = "";
  } else {
    box.innerHTML = "";
    box.style.display = "none";
  }
}

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
  renderTutorial();
  // Tutorial levels get the answer-shape tiles for free (that's hint step 1,
  // so the 💡 button goes straight to first letters there).
  if (current.tut || current.tip) {
    hintStep = 1;
    $("#hint-box").innerHTML =
      `<div class="hint-line">Hugis ng sagot:</div>` + tilesHTML(current.a, current.type, false);
  }
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
    $("#solved-title").textContent = "⭐ Nasagot mo na ito!";
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
    $("#solved-title").textContent = (current.tut && current.tut.grad)
      ? "🎓 Pasado ka! Tapos na ang tutorial — handa ka na sa totoong laban!"
      : "🎉 Tama!";
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

/* --- hints: 1) answer-shape tiles, 2) first letters --- */
$("#btn-hint").addEventListener("click", () => {
  if (!current) return;
  const [a1, a2] = splitAnswer(current.a);
  const box = $("#hint-box");
  hintStep = Math.min(hintStep + 1, 2);
  let html = "";
  if (hintStep >= 1) {
    html += `<div class="hint-line">💡 Hugis ng sagot:</div>` + tilesHTML(current.a, current.type, false);
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
