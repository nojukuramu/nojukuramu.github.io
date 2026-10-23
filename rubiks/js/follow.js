/* Rubiks — follow the scramble, one move at a time
 *
 * The sheet starts from a solved cube and walks the scramble: step with the
 * buttons or the arrow keys, play it at the pace you turn, or tap a move to
 * jump there. The caption names the next move in words, so "R'" reads as
 * "right face, anticlockwise" for anyone still learning the notation.
 *
 * Without WebGL (or if Three.js will not load) the same controls step a flat
 * net instead: less pretty, still enough to follow. */
"use strict";

var RK = RK || {};

RK.follow = (function () {
  var $ = function (id) { return document.getElementById(id); };
  var SPEEDS = { slow: 650, normal: 340, fast: 170 };
  var FACE = { U: "top", D: "bottom", R: "right", L: "left", F: "front", B: "back" };

  var view = null, pending = null, flat = false;
  var n = 3, moves = [], idx = 0, playing = false, speed = "normal";

  function sheetOpen() { return RK.sheets.current() === $("sheet-follow"); }

  /* "Rw'" -> "Right two layers, anticlockwise". */
  function describe(tok) {
    var mv = RK.cube.parse(tok);
    if (!mv) return tok;
    var what = FACE[mv.face] + (mv.depth === 1 ? " face" : " " + ["", "", "two", "three"][mv.depth] + " layers");
    var how = mv.turns === 2 ? "half turn" : mv.turns === 1 ? "clockwise" : "anticlockwise";
    return what.charAt(0).toUpperCase() + what.slice(1) + ", " + how;
  }

  function ensureView() {
    if (view) return Promise.resolve(view);
    if (flat) return Promise.reject();
    if (!pending) {
      pending = RK.cube3d.create($("follow-stage")).then(function (v) { view = v; return v; }, function (e) {
        flat = true;
        pending = null;
        throw e;
      });
    }
    return pending;
  }

  function open(scramble, size) {
    if (!size) return;
    stop();
    n = size;
    moves = String(scramble || "").split(/\s+/).filter(Boolean);
    idx = 0;
    speed = RK.store.get("followSpeed", "normal");
    if (!SPEEDS[speed]) speed = "normal";
    RK.sheets.open("follow");
    $("follow-stage").classList.add("loading");
    renderUI();
    ensureView().then(function (v) {
      $("follow-stage").classList.remove("loading", "flat");
      v.setup(n, moves.slice(0, idx).join(" "));
      v.resetView();
      v.resize();
    }, function () {
      $("follow-stage").classList.remove("loading");
      $("follow-stage").classList.add("flat");
      drawFlat();
    });
  }

  function drawFlat() {
    var stage = $("follow-stage"), net = stage.querySelector(".follow-flat");
    if (!net) { net = document.createElement("div"); net.className = "follow-flat"; stage.appendChild(net); }
    net.innerHTML = RK.cube.svg(n, moves.slice(0, idx).join(" "));
  }

  function renderUI() {
    var len = moves.length;
    $("follow-progress").textContent = idx + " / " + len;
    var cap = $("follow-caption");
    cap.textContent = "";
    var strong = document.createElement("strong"), rest = document.createElement("span");
    if (idx >= len) {
      strong.textContent = "Scrambled.";
      rest.textContent = " Your cube should look like this now.";
    } else {
      strong.textContent = (idx ? "Next: " : "Start: ") + moves[idx];
      rest.textContent = "  " + describe(moves[idx]);
    }
    cap.appendChild(strong); cap.appendChild(rest);

    var box = $("follow-moves");
    if (box.childElementCount !== len) {
      box.textContent = "";
      moves.forEach(function (m, i) {
        var b = document.createElement("button");
        b.textContent = m;
        b.setAttribute("data-k", i + 1);
        b.title = describe(m);
        box.appendChild(b);
      });
    }
    for (var i = 0; i < box.children.length; i++) {
      var c = box.children[i];
      c.classList.toggle("done", i < idx);
      c.classList.toggle("next", i === idx);
    }
    var nx = box.children[idx] || box.children[idx - 1];
    if (nx && nx.scrollIntoView) try { nx.scrollIntoView({ block: "nearest", inline: "nearest" }); } catch (e) {}

    $("follow-prev").disabled = $("follow-start").disabled = idx <= 0;
    $("follow-next").disabled = $("follow-end").disabled = idx >= len;
    $("follow-play").classList.toggle("on", playing);
    $("follow-play").setAttribute("aria-label", playing ? "Pause" : "Play");
    document.querySelectorAll("#follow-speed button").forEach(function (b) { b.classList.toggle("on", b.value === speed); });
  }

  function step(dir) {
    var len = moves.length;
    if ((dir > 0 && idx >= len) || (dir < 0 && idx <= 0)) return Promise.resolve();
    var tok = dir > 0 ? moves[idx] : moves[idx - 1];
    idx += dir;
    renderUI();
    if (!view) { if (flat) drawFlat(); return Promise.resolve(); }
    /* Reduced motion: the layer snaps instead of sweeping; the caption and
       the chips still say which move it was. */
    var still = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    return view.turn(tok, dir, still ? 1 : SPEEDS[speed]);
  }

  function jump(k) {
    stop();
    idx = Math.max(0, Math.min(moves.length, k));
    if (view) view.setup(n, moves.slice(0, idx).join(" "));
    else if (flat) drawFlat();
    renderUI();
  }

  /* Plays at the chosen pace, with a beat between moves so a hand can
     keep up; stops by itself at the end or when the sheet closes. */
  function play() {
    if (idx >= moves.length) jump(0);
    playing = true;
    renderUI();
    (function next() {
      if (!playing || !sheetOpen()) { stop(); return; }
      if (idx >= moves.length) { stop(); return; }
      step(1).then(function () { setTimeout(next, Math.round(SPEEDS[speed] * 0.6)); });
    })();
  }

  function stop() {
    if (!playing) return;
    playing = false;
    if ($("follow-play")) renderUI();
  }

  function init() {
    $("follow-prev").addEventListener("click", function () { stop(); step(-1); });
    $("follow-next").addEventListener("click", function () { stop(); step(1); });
    $("follow-start").addEventListener("click", function () { jump(0); });
    $("follow-end").addEventListener("click", function () { jump(moves.length); });
    $("follow-play").addEventListener("click", function () { if (playing) stop(); else play(); });
    $("follow-moves").addEventListener("click", function (e) {
      var b = e.target.closest("[data-k]");
      if (b) jump(+b.getAttribute("data-k"));
    });
    $("follow-speed").addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      speed = b.value;
      RK.store.set("followSpeed", speed);
      renderUI();
    });
    $("follow-view").addEventListener("click", function () { if (view) view.resetView(); });

    document.addEventListener("keydown", function (e) {
      if (!sheetOpen() || e.defaultPrevented) return;
      var info = document.querySelector(".info-sheet");
      if (info && !info.hidden) return;
      var tag = e.target.tagName;
      if (e.key === "ArrowRight") { e.preventDefault(); stop(); step(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); stop(); step(-1); }
      else if (e.key === "Home") { e.preventDefault(); jump(0); }
      else if (e.key === "End") { e.preventDefault(); jump(moves.length); }
      else if ((e.code === "Space" || e.key === " ") && tag !== "BUTTON" && tag !== "INPUT") {
        e.preventDefault();
        if (playing) stop(); else play();
      }
    });
  }

  return {
    init: init,
    open: open,
    describe: describe,
    /* For the browser test. */
    state: function () { return { idx: idx, len: moves.length, flat: flat, model: view ? view.model() : null, busy: view ? view.busy() : false }; }
  };
})();
