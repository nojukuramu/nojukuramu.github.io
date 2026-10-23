/* Rubiks — info sheet
   Lifted from routecast/static/js/info.js. One sheet, one registry.
   Copy lives here, not in the markup. */
"use strict";

var RK = RK || {};

RK.info = (function () {
  var TOPICS = {
    timer: {
      title: "The timer",
      body: "<p>Hold <strong>Space</strong> (or touch and hold the timer on a phone). The time turns red while you hold, then green once it is armed. Let go to start.</p><p>Press <strong>any key</strong>, or tap <strong>anywhere</strong>, to stop. Escape throws a running solve away.</p><p>While a solve is running, everything but the time fades out and stops reacting, so a stray tap cannot switch events mid-solve.</p><p>After a solve, the buttons under the time set +2 or DNF, add a note, or delete it. Tap any solve in the session list for its scramble and details.</p>"
    },
    keys: {
      title: "Keyboard shortcuts",
      body: "<p><strong>Space</strong> hold and release to start, press to stop. With inspection on, the first press starts the countdown.</p><p><strong>Any key</strong> stops a running solve. <strong>Escape</strong> cancels arming, inspection or a running solve.</p><p><strong>Alt+1 / Alt+2 / Alt+3</strong> set the last solve to no penalty, +2 or DNF.</p><p><strong>Alt+Z</strong> deletes the last solve (with undo). <strong>Alt+N</strong> gives a new scramble.</p>"
    },
    scramble: {
      title: "Scrambles",
      body: "<p>Hold the cube with <strong>white on top and green in front</strong>, then turn it left to right. A letter alone is a clockwise quarter turn of that face as you look at it; <strong>'</strong> is anticlockwise, <strong>2</strong> is a half turn.</p><p><strong>Rw</strong> turns the outer two layers together; <strong>3Rw</strong> turns three.</p><p>2x2 scrambles are <strong>random-state</strong>, the way the WCA makes them: a position is picked uniformly and solved backwards, so every position is equally likely. Larger cubes use random moves at the lengths csTimer uses.</p><p>The preview shows what the cube should look like once scrambled, so you can check before you start.</p>"
    },
    preview: {
      title: "Scramble preview",
      body: "<p>The cube unfolded after the scramble: top face above, then left, front, right and back in a row, bottom face below. White on top and green in front, as you hold it.</p><p>If your cube does not match, a move went wrong. Fix it before you start; a solve on a different scramble is not comparable.</p><p>Previews are drawn for the cubes. Pyraminx, Skewb and Megaminx have scrambles but no preview.</p>"
    },
    inspection: {
      title: "WCA inspection",
      body: "<p>Competitions give you <strong>15 seconds</strong> to look at the cube before starting. With inspection on, the first press starts a countdown; hold and release as usual to start the solve.</p><p>A judge calls out <strong>8 seconds</strong> and <strong>12 seconds</strong>; the timer does too, by voice or beep.</p><p>Starting between 15 and 17 seconds adds <strong>+2</strong>. Starting after 17 is a <strong>DNF</strong>. Both are applied for you, and you can change them afterwards.</p>"
    },
    hold: {
      title: "Hold to arm",
      body: "<p>How long you hold before the timer is ready. A stackmat needs about half a second; most online timers use 0.3s.</p><p>A short hold stops a twitch from starting the clock. <strong>None</strong> arms the moment you press.</p>"
    },
    typing: {
      title: "Typing times",
      body: "<p>For times from a stackmat or another timer. Type and press Enter.</p><p><strong>1234</strong> is 12.34, <strong>12345</strong> is 1:23.45. <strong>12.34</strong> and <strong>1:02.5</strong> mean what they say. Add <strong>+</strong> at the end for +2, or type <strong>DNF</strong>.</p><p>Each typed time is saved with the scramble shown, like a timed solve.</p>"
    },
    target: {
      title: "Target time",
      body: "<p>Set the time you are working towards, say 20 seconds. It shows as a dashed line on the trend, and the session shows what share of your solves beat it.</p><p>Leave it empty to hide both.</p>"
    },
    penalties: {
      title: "Penalties",
      body: "<p><strong>+2</strong> adds two seconds. In competition it is given for a face off by up to 45 degrees at the end, or for starting late in inspection.</p><p><strong>DNF</strong> (did not finish) is a solve that did not count: unsolved, a face off by more than 45 degrees, or inspection over 17 seconds.</p><p>A DNF is left out of the mean. In an average it counts as the slowest solve, so an Ao5 survives one DNF and not two.</p>"
    },
    averages: {
      title: "Averages",
      body: "<p><strong>Ao5</strong> and <strong>Ao12</strong> drop the fastest and slowest solve and average the rest. This is how the WCA ranks averages.</p><p><strong>Ao50</strong> and <strong>Ao100</strong> drop the fastest and slowest 5% (3 and 5 each side). <strong>Mo3</strong> is a plain mean of three.</p><p>An average is DNF when it has more DNFs than it drops.</p><p><strong>&sigma;</strong> is the standard deviation of your times: lower means more consistent. Tap any average to see its solves, with the dropped ones in brackets, ready to copy.</p>"
    },
    puzzle: {
      title: "Events",
      body: "<p>Each event keeps its own history and statistics. Switching is safe: nothing is lost.</p><p>3x3 One-Handed uses 3x3 scrambles but keeps separate times, since mixing them would spoil both averages.</p>"
    },
    export: {
      title: "Your data",
      body: "<p>Every solve is kept in this browser on this device, and nothing is sent anywhere. That also means clearing site data, or a different browser, starts from nothing.</p><p><strong>Back up all</strong> saves every event to one file. <strong>Restore</strong> reads that file back in, here or on another device. Restoring the same file twice does not duplicate solves.</p><p><strong>CSV</strong> saves the current event as a spreadsheet: time, penalty, rolling averages, scramble, date and note.</p>"
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
