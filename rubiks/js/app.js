/* Rubiks — application state and wiring
 *
 * Owns the one copy of the session (event, solves, summary, settings) and
 * every write to it. panels.js draws from state(); timer.js reports presses.
 *
 * Input: Space on a keyboard, touch-and-hold on the timer area, any key or
 * any tap anywhere to stop. While a solve is under way the rest of the page
 * fades out and stops taking input, so a stray tap cannot switch events or
 * open a sheet mid-solve. */
"use strict";

var RK = RK || {};

RK.app = (function () {
  var $ = function (id) { return document.getElementById(id); };

  var S = { event: "3x3", solves: [], sum: null, settings: null, scramble: "" };
  var last = -1;          // the solve the quick actions under the timer act on
  var pointerId = null;
  var finalShown = null;  // what the display shows when nothing is running

  function ev() { return RK.scramble.event(S.event); }
  function fmt(ms) { return RK.stats.formatTime(ms, S.settings.decimals); }

  function init() {
    S.settings = RK.store.settings();
    var saved = RK.store.get("puzzle", "3x3");
    S.event = RK.scramble.event(saved).id;
    load();

    RK.sheets.init();
    RK.panels.init();
    RK.follow.init();
    applySettings();
    setupTimer();
    setupKeys();
    setupPointer();
    setupActions();
    newScramble();
    showTime(0);
    render();

    $("version-num").textContent = "v" + (window.RK_VERSION || "?");
    $("btn-check-update").addEventListener("click", function () {
      var el = $("version-num");
      el.textContent = "Checking...";
      RK.update.check().then(function (r) {
        el.textContent = r === "current" ? "Up to date" : r === "ready" ? "Update ready" : r === "offline" ? "Offline" : "v" + (window.RK_VERSION || "?");
        setTimeout(function () { el.textContent = "v" + (window.RK_VERSION || "?"); }, 2500);
      });
    });

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").then(function (reg) {
        RK.update.init(reg);
      }).catch(function () {});
    }
  }

  function load() {
    S.solves = RK.store.solves(S.event);
    S.sum = RK.stats.summary(S.solves);
  }

  function render() {
    $("event-name").textContent = ev().short;
    RK.panels.renderSide();
    RK.panels.refreshStats();
    renderSub();
  }

  /* ---------------------------------------------------------------
     Scramble and preview
     --------------------------------------------------------------- */
  function newScramble() {
    S.scramble = RK.scramble.format(RK.scramble.generate(S.event));
    var el = $("scramble");
    el.textContent = "";
    var moves = S.scramble.split(" ");
    el.setAttribute("data-len", moves.length > 60 ? "xl" : moves.length > 30 ? "l" : "s");
    /* One span per move so a line never breaks inside "3Rw2". */
    S.scramble.split("\n").forEach(function (line, li) {
      if (li) el.appendChild(document.createElement("br"));
      line.split(" ").forEach(function (m) {
        var sp = document.createElement("span");
        sp.textContent = m;
        el.appendChild(sp);
        el.appendChild(document.createTextNode(" "));
      });
    });
    updatePreview();
  }

  function updatePreview() {
    var p = $("preview"), n = ev().n;
    $("btn-follow").hidden = !n;
    if (!S.settings.preview || !n) { p.hidden = true; p.innerHTML = ""; return; }
    p.hidden = false;
    p.innerHTML = RK.cube.svg(n, S.scramble);
  }

  /* ---------------------------------------------------------------
     The display
     --------------------------------------------------------------- */
  function setDisplay(main, frac) {
    var t = $("time");
    t.querySelector(".t-main").textContent = main;
    t.querySelector(".t-frac").textContent = frac || "";
  }

  function showTime(ms) {
    var s = fmt(ms), dot = s.lastIndexOf(".");
    setDisplay(s.slice(0, dot), s.slice(dot));
  }

  function showFinal(solve) {
    if (!solve) { finalShown = null; showTime(0); return; }
    finalShown = solve;
    if (solve.penalty === "DNF") { setDisplay("DNF", "(" + fmt(solve.time) + ")"); return; }
    var s = fmt(RK.stats.effectiveTime(solve)), dot = s.lastIndexOf(".");
    setDisplay(s.slice(0, dot), s.slice(dot) + (solve.penalty === "+2" ? "+" : ""));
  }

  function renderSub() {
    var sub = $("timer-sub"), sum = S.sum, h = "";
    if (sum.cur[5] != null) {
      h = "<span>Ao5 <strong>" + fmt(sum.cur[5]) + "</strong></span>";
      if (sum.cur[12] != null) h += "<span>Ao12 <strong>" + fmt(sum.cur[12]) + "</strong></span>";
    } else {
      var touch = window.matchMedia && matchMedia("(pointer: coarse)").matches;
      if (S.settings.input === "typing") h = "<span>Type a time and press Enter</span>";
      else if (S.settings.inspection) h = "<span>" + (touch ? "Tap" : "Press Space") + " to start inspection</span>";
      else h = "<span>" + (touch ? "Touch and hold" : "Hold Space") + ", release to start</span>";
    }
    sub.innerHTML = h;
  }

  function showLastActions() {
    var box = $("last-actions"), s = S.solves[last];
    if (!s) { box.hidden = true; return; }
    box.hidden = false;
    box.querySelectorAll("[data-last]").forEach(function (b) {
      var k = b.getAttribute("data-last");
      b.classList.toggle("on", (k === "ok" && !s.penalty) || k === s.penalty);
    });
  }

  function showPB(list) {
    var el = $("pb");
    if (!list.length) { el.hidden = true; return; }
    el.textContent = "New best " + (list.length > 1 ? list.slice(0, -1).join(", ") + " and " + list[list.length - 1] : list[0]);
    el.hidden = false;
  }

  /* ---------------------------------------------------------------
     Timer
     --------------------------------------------------------------- */
  function setupTimer() {
    RK.timer.onTick(function (ms) {
      if (S.settings.hideRunning) return;
      var s = RK.stats.formatTime(ms, 2), dot = s.lastIndexOf(".");
      /* Hundredths while running: thousandths flicker too fast to read and
         cost a repaint for nothing. The final time gets full precision. */
      setDisplay(s.slice(0, dot), s.slice(dot, dot + 2));
    });

    RK.timer.onInspect(function (e) {
      if (e > 17000) setDisplay("DNF", "");
      else if (e > 15000) setDisplay("+2", "");
      else setDisplay(String(15 - Math.floor(e / 1000)), "");
    });

    RK.timer.onAlert(function (sec) { RK.sound.alert(S.settings.alerts, sec); });

    RK.timer.onChange(function (state, ms) {
      document.body.setAttribute("data-state", state);
      document.body.classList.toggle("busy", RK.timer.busy());
      switch (state) {
        case "inspecting":
          $("last-actions").hidden = true;
          $("pb").hidden = true;
          break;
        case "holding":
        case "ready":
          if (!RK.timer.inspecting()) showTime(0);
          break;
        case "running":
          $("last-actions").hidden = true;
          $("pb").hidden = true;
          if (S.settings.hideRunning) setDisplay("Solve", "");
          else showTime(0);
          break;
        case "stopped":
          record(ms, RK.timer.inspPenalty());
          break;
        case "idle":
          showFinal(finalShown);
          break;
      }
    });
  }

  function record(ms, penalty) {
    addSolve({ time: Math.round(ms), scramble: S.scramble, date: Date.now(), penalty: penalty || null });
  }

  function addSolve(solve) {
    var before = S.sum;
    S.solves = RK.store.addSolve(S.event, solve);
    if (S.solves.saved === false) RK.sheets.toast("This browser would not save the solve: storage is full or blocked");
    S.sum = RK.stats.summary(S.solves);
    last = S.solves.length - 1;
    showFinal(solve);
    showLastActions();
    showPB(RK.stats.newBests(before, S.sum));
    newScramble();
    render();
  }

  /* ---------------------------------------------------------------
     Actions on solves (also called from panels.js)
     --------------------------------------------------------------- */
  function setPenalty(idx, p) {
    if (!S.solves[idx]) return;
    S.solves = RK.store.updateSolve(S.event, idx, { penalty: p });
    S.sum = RK.stats.summary(S.solves);
    if (idx === last) { showFinal(S.solves[idx]); showLastActions(); }
    render();
  }

  function setComment(idx, text) {
    if (!S.solves[idx]) return;
    S.solves = RK.store.updateSolve(S.event, idx, { comment: text || undefined });
    RK.panels.renderSide();
  }

  function deleteSolve(idx) {
    var removed = S.solves[idx];
    if (!removed) return;
    var ev0 = S.event;
    S.solves = RK.store.removeSolve(S.event, idx);
    S.sum = RK.stats.summary(S.solves);
    if (idx === last) { last = -1; $("last-actions").hidden = true; $("pb").hidden = true; showFinal(null); }
    else if (idx < last) last--;
    render();
    RK.sheets.toast("Solve " + (idx + 1) + " deleted", function () {
      if (S.event !== ev0) return;
      S.solves = RK.store.insertSolve(S.event, idx, removed);
      S.sum = RK.stats.summary(S.solves);
      render();
    });
  }

  function setEvent(id) {
    if (RK.timer.busy()) return;
    S.event = RK.scramble.event(id).id;
    RK.store.set("puzzle", S.event);
    RK.timer.cancel();
    last = -1;
    $("last-actions").hidden = true;
    $("pb").hidden = true;
    RK.panels.resetList();
    load();
    newScramble();
    showFinal(null);
    render();
  }

  function saveSettings(partial) {
    for (var k in partial) S.settings[k] = partial[k];
    RK.store.saveSettings(S.settings);
    applySettings();
    updatePreview();
    if (finalShown) showFinal(finalShown); else showTime(0);
    render();
  }

  function applySettings() {
    var s = S.settings;
    RK.timer.configure({ holdMs: s.holdMs, inspection: s.inspection });
    RK.wake.set(s.wake);
    var root = document.documentElement;
    if (s.theme === "dark" || s.theme === "light") root.setAttribute("data-theme", s.theme);
    else root.removeAttribute("data-theme");
    var typing = s.input === "typing";
    $("typing").hidden = !typing;
    $("time").hidden = typing;
    document.body.classList.toggle("typing-mode", typing);
  }

  /* ---------------------------------------------------------------
     Typing mode: csTimer's rules, so muscle memory carries over.
     "1234" is 12.34, "12345" is 1:23.45, "12.34" and "1:02.5" mean what
     they say, a trailing "+" is +2, "DNF" is DNF.
     --------------------------------------------------------------- */
  function parseTyped(raw) {
    var v = String(raw || "").trim().toUpperCase().replace(",", ".");
    if (!v) return null;
    if (v === "DNF" || v === "D") return { time: 0, penalty: "DNF" };
    var pen = null;
    if (/\+$/.test(v)) { pen = "+2"; v = v.slice(0, -1).trim(); }
    var ms;
    if (/^\d+$/.test(v)) {
      var d = v.padStart(3, "0");
      var cents = +d.slice(-2), rest = d.slice(0, -2);
      var secs = +rest.slice(-2), mins = +(rest.slice(0, -2) || 0);
      ms = (mins * 60 + secs) * 1000 + cents * 10;
    } else {
      var m = /^(?:(\d+):)?(\d+(?:\.\d+)?)$/.exec(v);
      if (!m) return null;
      ms = Math.round(((+m[1] || 0) * 60 + parseFloat(m[2])) * 1000);
    }
    if (!(ms > 0) || ms > 3600000 * 3) return null;
    return { time: ms, penalty: pen };
  }

  /* ---------------------------------------------------------------
     Keyboard
     --------------------------------------------------------------- */
  function setupKeys() {
    document.addEventListener("keydown", function (e) {
      if (RK.sheets.isOpen()) {
        /* info.js closes its own sheet on Escape and marks the event; only
           an Escape it did not take closes the sheet underneath. */
        if (e.key === "Escape" && !e.defaultPrevented) {
          var info = document.querySelector(".info-sheet");
          if (info && !info.hidden) RK.info.close(); else RK.sheets.close();
        }
        return;
      }
      var tag = e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      var state = RK.timer.state();

      if (state === "running") {
        e.preventDefault();
        if (e.key === "Escape") { RK.timer.cancel(); RK.sheets.toast("Solve discarded"); return; }
        if (!e.repeat) RK.timer.down();
        return;
      }
      if (e.code === "Space" || e.key === " ") {
        e.preventDefault();
        /* A focused button would otherwise take this Space as a click on
           release: v1 toggled +2 on whatever solve had been clicked last. */
        if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
        if (S.settings.input === "typing") return;
        if (!e.repeat) { RK.sound.prime(S.settings.alerts); RK.wake.nudge(); RK.timer.down(); }
        return;
      }
      if (e.key === "Escape" && RK.timer.busy()) { RK.timer.cancel(); return; }
      if (RK.timer.busy() || !e.altKey) return;
      var idx = S.solves.length - 1;
      switch (e.code) {
        case "Digit1": e.preventDefault(); setPenalty(idx, null); break;
        case "Digit2": e.preventDefault(); setPenalty(idx, "+2"); break;
        case "Digit3": e.preventDefault(); setPenalty(idx, "DNF"); break;
        case "KeyZ": e.preventDefault(); deleteSolve(idx); break;
        case "KeyN": e.preventDefault(); newScramble(); break;
      }
    });

    document.addEventListener("keyup", function (e) {
      if (e.code === "Space" || e.key === " ") {
        if (RK.sheets.isOpen()) return;
        var tag = e.target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        e.preventDefault();
        RK.timer.up();
      }
    });

    window.addEventListener("blur", function () { RK.timer.disarm(); });
  }

  /* ---------------------------------------------------------------
     Touch and mouse, through Pointer Events so a finger and a mouse are
     one code path. Starting needs the timer area; stopping takes a press
     anywhere, because a solver's hand comes down wherever it lands.
     --------------------------------------------------------------- */
  function setupPointer() {
    document.addEventListener("pointerdown", function (e) {
      if (RK.sheets.isOpen() || S.settings.input === "typing") return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (RK.timer.state() === "running") { e.preventDefault(); RK.timer.down(); return; }
      var zone = e.target.closest("#timer-area");
      if (!RK.timer.busy() && (!zone || e.target.closest("button, input, form, a"))) return;
      e.preventDefault();
      pointerId = e.pointerId;
      RK.sound.prime(S.settings.alerts);
      RK.wake.nudge();
      RK.timer.down();
    }, { passive: false });

    document.addEventListener("pointerup", function (e) {
      if (pointerId === null || e.pointerId !== pointerId) return;
      pointerId = null;
      RK.timer.up();
    });

    document.addEventListener("pointercancel", function (e) {
      if (pointerId === null || e.pointerId !== pointerId) return;
      pointerId = null;
      RK.timer.disarm();
    });

    /* iOS shows a magnifier on a long press without this. */
    $("timer-area").addEventListener("contextmenu", function (e) { e.preventDefault(); });
  }

  /* ---------------------------------------------------------------
     Buttons
     --------------------------------------------------------------- */
  function setupActions() {
    $("btn-new-scramble").addEventListener("click", newScramble);
    $("btn-copy-scramble").addEventListener("click", function () { RK.panels.copy(S.scramble); });
    $("btn-event").addEventListener("click", RK.panels.openEvents);
    $("btn-stats").addEventListener("click", RK.panels.openStats);
    $("btn-stats-top").addEventListener("click", RK.panels.openStats);
    $("btn-settings").addEventListener("click", RK.panels.openSettings);
    $("session-peek").addEventListener("click", RK.sheets.openSide);
    function follow() { RK.follow.open(S.scramble, ev().n); }
    $("preview").addEventListener("click", follow);
    $("btn-follow").addEventListener("click", follow);

    $("last-actions").addEventListener("click", function (e) {
      var b = e.target.closest("[data-last]");
      if (!b || last < 0) return;
      var k = b.getAttribute("data-last");
      if (k === "delete") deleteSolve(last);
      else if (k === "note") RK.panels.openSolve(last);
      else setPenalty(last, k === "ok" ? null : k);
      b.blur();
    });

    $("btn-clear").addEventListener("click", function () {
      if (!S.solves.length) return;
      if (!confirm("Delete all " + S.solves.length + " " + ev().name + " solves? A backup from Settings can bring them back; nothing else can.")) return;
      RK.store.clearSolves(S.event);
      last = -1;
      $("last-actions").hidden = true;
      load();
      showFinal(null);
      render();
    });

    $("typing").addEventListener("submit", function (e) {
      e.preventDefault();
      var input = $("typing-input"), t = parseTyped(input.value);
      if (!t) { RK.sheets.toast("Could not read that time"); return; }
      input.value = "";
      addSolve({ time: t.time, scramble: S.scramble, date: Date.now(), penalty: t.penalty });
    });

    $("btn-export").addEventListener("click", exportCSV);
    $("btn-backup").addEventListener("click", backup);
    $("restore-file").addEventListener("change", restore);
  }

  /* ---------------------------------------------------------------
     Files out and in
     --------------------------------------------------------------- */
  function download(name, text, type) {
    var blob = new Blob([text], { type: type });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function exportCSV() {
    if (!S.solves.length) { RK.sheets.toast("No " + ev().name + " solves to export"); return; }
    var q = function (s) { return '"' + String(s || "").replace(/"/g, '""').replace(/\n/g, " ") + '"'; };
    var lines = ["#,Time,Penalty,Raw ms,Ao5,Ao12,Scramble,Date,Note"];
    S.solves.forEach(function (s, i) {
      lines.push([i + 1, RK.stats.formatTime(RK.stats.effectiveTime(s), 3), s.penalty || "", s.time,
        RK.stats.formatTime(S.sum.roll[5][i], 3), RK.stats.formatTime(S.sum.roll[12][i], 3),
        q(s.scramble), new Date(s.date).toISOString(), q(s.comment)].join(","));
    });
    download("rubiks-" + S.event + "-" + new Date().toISOString().slice(0, 10) + ".csv", lines.join("\n"), "text/csv");
  }

  function backup() {
    var data = RK.store.backup(RK.scramble.EVENTS.map(function (e) { return e.id; }));
    var n = 0;
    for (var k in data.events) n += data.events[k].length;
    if (!n) { RK.sheets.toast("Nothing to back up yet"); return; }
    download("rubiks-backup-" + new Date().toISOString().slice(0, 10) + ".json", JSON.stringify(data), "application/json");
  }

  function restore(e) {
    var f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    var r = new FileReader();
    r.onload = function () {
      try {
        var added = RK.store.restore(JSON.parse(r.result), RK.scramble.EVENTS.map(function (x) { return x.id; }));
        load();
        render();
        RK.sheets.toast(added ? "Restored " + added + " solve" + (added === 1 ? "" : "s") : "Nothing new in that backup");
      } catch (err) {
        RK.sheets.toast("That file is not a Rubiks backup");
      }
    };
    r.readAsText(f);
  }

  return {
    init: init,
    state: function () { return S; },
    setPenalty: setPenalty,
    setComment: setComment,
    deleteSolve: deleteSolve,
    setEvent: setEvent,
    saveSettings: saveSettings,
    parseTyped: parseTyped
  };
})();

document.addEventListener("DOMContentLoaded", RK.app.init);
