/* Rubiks — main application wiring */
"use strict";

var RK = RK || {};

RK.app = (function () {
  var $ = function (id) { return document.getElementById(id); };
  var fmt = RK.stats.formatTime;

  var puzzle = "3x3";
  var currentScramble = [];
  var solves = [];
  var lastSolveTime = 0;

  /* ---------------------------------------------------------------
     DOM references
     --------------------------------------------------------------- */
  var elTime, elScramble, elState, elList, elStatsGrid;
  var elAo5, elAo12, elMean, elBest, elCount;
  var elPuzzleBtns, elTimerArea;

  function init() {
    elTime = $("time");
    elScramble = $("scramble");
    elState = $("timer-area");
    elList = $("solve-list");
    elStatsGrid = $("stats-grid");
    elAo5 = $("stat-ao5");
    elAo12 = $("stat-ao12");
    elMean = $("stat-mean");
    elBest = $("stat-best");
    elCount = $("stat-count");
    elTimerArea = $("timer-area");

    puzzle = RK.store.get("puzzle", "3x3");
    solves = RK.store.solves(puzzle);

    setupPuzzleSelector();
    setupTimer();
    setupKeys();
    setupTouch();
    setupActions();
    newScramble();
    renderStats();
    renderList();
    highlightPuzzle();

    $("version-num").textContent = "v" + (window.RK_VERSION || "?");
    $("btn-check-update").addEventListener("click", function () {
      RK.update.check().then(function (r) {
        if (r === "current") {
          var el = $("version-num");
          el.textContent = "Up to date";
          setTimeout(function () { el.textContent = "v" + (window.RK_VERSION || "?"); }, 2000);
        }
      });
    });

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").then(function (reg) {
        RK.update.init(reg);
      }).catch(function () {});
    }
  }

  /* ---------------------------------------------------------------
     Puzzle selector
     --------------------------------------------------------------- */
  function setupPuzzleSelector() {
    var btns = document.querySelectorAll("[data-puzzle]");
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener("click", function () {
        setPuzzle(this.getAttribute("data-puzzle"));
      });
    }
  }

  function setPuzzle(p) {
    puzzle = p;
    RK.store.set("puzzle", p);
    solves = RK.store.solves(puzzle);
    RK.timer.reset();
    RK.timer.setIdle();
    elTime.textContent = "0.00";
    elTimerArea.setAttribute("data-state", "idle");
    newScramble();
    renderStats();
    renderList();
    highlightPuzzle();
  }

  function highlightPuzzle() {
    var btns = document.querySelectorAll("[data-puzzle]");
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle("active", btns[i].getAttribute("data-puzzle") === puzzle);
    }
  }

  /* ---------------------------------------------------------------
     Scramble
     --------------------------------------------------------------- */
  function newScramble() {
    currentScramble = RK.scramble.generate(puzzle);
    elScramble.textContent = RK.scramble.format(currentScramble);
  }

  /* ---------------------------------------------------------------
     Timer wiring
     --------------------------------------------------------------- */
  function setupTimer() {
    RK.timer.onTick(function (ms) {
      elTime.textContent = fmt(ms);
    });

    RK.timer.onChange(function (state, ms) {
      elTimerArea.setAttribute("data-state", state);
      switch (state) {
        case "holding":
          elTime.textContent = "0.00";
          break;
        case "ready":
          elTime.textContent = "0.00";
          break;
        case "running":
          elScramble.textContent = "Solving...";
          break;
        case "stopped":
          lastSolveTime = ms;
          elTime.textContent = fmt(ms);
          recordSolve(ms);
          break;
        case "idle":
          break;
      }
    });
  }

  function recordSolve(ms) {
    var solve = {
      time: Math.round(ms),
      scramble: RK.scramble.format(currentScramble),
      date: Date.now(),
      penalty: null
    };
    solves = RK.store.addSolve(puzzle, solve);
    renderStats();
    renderList();
    newScramble();
    RK.timer.setIdle();
  }

  /* ---------------------------------------------------------------
     Keyboard
     --------------------------------------------------------------- */
  function setupKeys() {
    document.addEventListener("keydown", function (e) {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (e.code === "Space" || e.key === " ") {
        e.preventDefault();
        if (!e.repeat) RK.timer.down();
      }
      if (e.key === "Escape") {
        RK.timer.reset();
        elTime.textContent = "0.00";
        elTimerArea.setAttribute("data-state", "idle");
        newScramble();
      }
    });

    document.addEventListener("keyup", function (e) {
      if (e.code === "Space" || e.key === " ") {
        e.preventDefault();
        RK.timer.up();
      }
    });
  }

  /* ---------------------------------------------------------------
     Touch (mobile)
     --------------------------------------------------------------- */
  function setupTouch() {
    var area = $("timer-touch");

    area.addEventListener("touchstart", function (e) {
      e.preventDefault();
      RK.timer.down();
    }, { passive: false });

    area.addEventListener("touchend", function (e) {
      e.preventDefault();
      RK.timer.up();
    }, { passive: false });

    area.addEventListener("mousedown", function (e) {
      if (e.button === 0) {
        e.preventDefault();
        RK.timer.down();
      }
    });

    area.addEventListener("mouseup", function (e) {
      if (e.button === 0) {
        e.preventDefault();
        RK.timer.up();
      }
    });
  }

  /* ---------------------------------------------------------------
     Solve list actions
     --------------------------------------------------------------- */
  function setupActions() {
    $("btn-new-scramble").addEventListener("click", function () {
      newScramble();
    });

    $("btn-clear").addEventListener("click", function () {
      if (!solves.length) return;
      if (!confirm("Clear all " + solves.length + " solves for " + puzzle + "?")) return;
      RK.store.clearSolves(puzzle);
      solves = [];
      renderStats();
      renderList();
    });

    $("btn-export").addEventListener("click", exportCSV);

    elList.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-action]");
      if (!btn) return;
      var idx = parseInt(btn.closest("[data-idx]").getAttribute("data-idx"), 10);
      var action = btn.getAttribute("data-action");

      if (action === "delete") {
        solves = RK.store.removeSolve(puzzle, idx);
      } else if (action === "plus2") {
        var s = solves[idx];
        var next = s.penalty === "+2" ? null : "+2";
        solves = RK.store.updateSolve(puzzle, idx, { penalty: next });
      } else if (action === "dnf") {
        var s2 = solves[idx];
        var next2 = s2.penalty === "DNF" ? null : "DNF";
        solves = RK.store.updateSolve(puzzle, idx, { penalty: next2 });
      }
      renderStats();
      renderList();
    });
  }

  /* ---------------------------------------------------------------
     Rendering
     --------------------------------------------------------------- */
  function renderStats() {
    var s = RK.stats.summary(solves);
    elAo5.textContent = s.ao5 !== null ? fmt(s.ao5) : "-";
    elAo12.textContent = s.ao12 !== null ? fmt(s.ao12) : "-";
    elMean.textContent = s.mean !== null ? fmt(s.mean) : "-";
    elBest.textContent = s.best !== null ? fmt(s.best) : "-";
    elCount.textContent = s.count;

    var bestAo5El = $("stat-best-ao5");
    var bestAo12El = $("stat-best-ao12");
    if (bestAo5El) bestAo5El.textContent = s.bestAo5 !== null ? fmt(s.bestAo5) : "-";
    if (bestAo12El) bestAo12El.textContent = s.bestAo12 !== null ? fmt(s.bestAo12) : "-";
  }

  function renderList() {
    if (!solves.length) {
      elList.innerHTML = '<div class="empty">No solves yet</div>';
      return;
    }
    var html = "";
    for (var i = solves.length - 1; i >= 0; i--) {
      var s = solves[i];
      var t = RK.stats.effectiveTime(s);
      var display = s.penalty === "DNF" ? "DNF" : fmt(t);
      var penClass = s.penalty ? " pen-" + (s.penalty === "+2" ? "plus2" : "dnf") : "";
      html += '<div class="solve-row' + penClass + '" data-idx="' + i + '">'
        + '<span class="solve-num">' + (i + 1) + '.</span>'
        + '<span class="solve-time">' + display + '</span>'
        + '<span class="solve-scramble">' + escHtml(s.scramble) + '</span>'
        + '<span class="solve-actions">'
        + '<button data-action="plus2" class="act-btn' + (s.penalty === "+2" ? " on" : "") + '" title="+2 penalty">+2</button>'
        + '<button data-action="dnf" class="act-btn' + (s.penalty === "DNF" ? " on" : "") + '" title="DNF">DNF</button>'
        + '<button data-action="delete" class="act-btn act-del" title="Delete">' + RK.icons.icon("trash") + '</button>'
        + '</span>'
        + '</div>';
    }
    elList.innerHTML = html;
  }

  function escHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  /* ---------------------------------------------------------------
     Export
     --------------------------------------------------------------- */
  function exportCSV() {
    if (!solves.length) return;
    var lines = ["#,Time,Penalty,Scramble,Date"];
    for (var i = 0; i < solves.length; i++) {
      var s = solves[i];
      var t = RK.stats.effectiveTime(s);
      lines.push((i + 1) + "," + fmt(t) + "," + (s.penalty || "") + ",\"" + s.scramble.replace(/"/g, '""') + "\"," + new Date(s.date).toISOString());
    }
    var blob = new Blob([lines.join("\n")], { type: "text/csv" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "rubiks-" + puzzle + "-" + new Date().toISOString().slice(0, 10) + ".csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return { init: init };
})();

document.addEventListener("DOMContentLoaded", RK.app.init);
