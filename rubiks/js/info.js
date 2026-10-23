/* Rubiks — info sheet
   Lifted from routecast/static/js/info.js. One sheet, one registry.
   Copy lives here, not in the markup. */
"use strict";

var RK = RK || {};

RK.info = (function () {
  var TOPICS = {
    timer: {
      title: "The timer",
      body: "<p>Hold <strong>Space</strong> (or touch and hold on mobile) until the display turns green, then release to start.</p><p>Press Space (or tap) again to stop. The time is recorded with the scramble it was solved on.</p><p>If you need to inspect without starting: the timer only arms when the display is in its resting state.</p>"
    },
    scramble: {
      title: "Scrambles",
      body: "<p>A fresh scramble is generated before every solve, following WCA notation. Hold the cube with white on top and green in front, then execute left to right.</p><p>Tap the refresh button beside the scramble to get a different one without solving.</p>"
    },
    penalties: {
      title: "Penalties",
      body: "<p><strong>+2</strong> adds two seconds to the solve, per WCA rules for a misaligned face within 45 degrees of solved.</p><p><strong>DNF</strong> (Did Not Finish) marks a solve that was not completed or had more than one face misaligned. DNF solves are excluded from means but counted in averages.</p>"
    },
    averages: {
      title: "Averages",
      body: "<p><strong>Ao5 / Ao12 / Ao50 / Ao100</strong> are trimmed means: the best and worst times are dropped, and the rest are averaged. This is how WCA official averages work.</p><p>If more than one solve in the window is DNF, the average is DNF.</p><p><strong>Mean</strong> is the simple average of all non-DNF solves.</p><p><strong>Best</strong> is your single fastest time.</p>"
    },
    puzzle: {
      title: "Puzzle types",
      body: "<p>Switch between 3x3, 2x2 and 4x4. Each puzzle keeps its own session history and statistics.</p><p>Scramble lengths follow WCA guidelines: 20 moves for 3x3, 11 for 2x2, and 44 for 4x4.</p>"
    },
    export: {
      title: "Export",
      body: "<p>Download your solves as a CSV file you can open in any spreadsheet. Includes time, scramble, date and penalty for every solve in the current session.</p>"
    }
  };

  var sheet = null, scrim = null;

  function open(key) {
    var topic = TOPICS[key];
    if (!topic) return;
    if (!sheet) build();
    sheet.querySelector(".info-title").textContent = topic.title;
    sheet.querySelector(".info-body").innerHTML = topic.body;
    sheet.hidden = false;
    scrim.hidden = false;
    sheet.focus();
  }

  function close() {
    if (sheet) sheet.hidden = true;
    if (scrim) scrim.hidden = true;
  }

  function build() {
    scrim = document.createElement("div");
    scrim.className = "info-scrim";
    scrim.hidden = true;
    scrim.addEventListener("click", close);
    document.body.appendChild(scrim);

    sheet = document.createElement("div");
    sheet.className = "info-sheet";
    sheet.hidden = true;
    sheet.tabIndex = -1;
    sheet.innerHTML = '<div class="info-header"><h3 class="info-title"></h3><button class="info-close" aria-label="Close">' + RK.icons.icon("x") + '</button></div><div class="info-body"></div>';
    sheet.querySelector(".info-close").addEventListener("click", close);
    document.body.appendChild(sheet);

    sheet.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { close(); e.preventDefault(); }
    });
  }

  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-info]");
    if (btn) { open(btn.getAttribute("data-info")); e.preventDefault(); }
  });

  return { open: open, close: close, keys: function () { return Object.keys(TOPICS); } };
})();
