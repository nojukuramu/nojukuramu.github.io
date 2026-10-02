/* ============================================================
   nojukuramu — the intro

   The page opens the way a lens does. It starts behind a shut iris —
   nine blades, wider than the screen's diagonal, with the mark sitting on
   them — and after a breath the shutter goes and the blades swing open on
   the hero. The same iris, at a smaller size, is behind the glass of the
   lens the hero turns into, so the first thing the page does is show the
   thing it will keep doing.

   The motion is computed each frame from the clock, not left to CSS, so a
   stalled frame is dropped rather than late, and a click or a key at any
   point hurries it straight to the opening.

   It never holds the page hostage. If this file never loads, a CSS
   animation clears the overlay on its own a few seconds in. Once it has
   loaded it stands that animation down and keeps the same promise with a
   timer of its own. Under prefers-reduced-motion there is no intro at all.
   ============================================================ */
(function (global) {
  "use strict";

  var NJ = (global.NJ = global.NJ || {});
  var reduced = global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var intro = document.getElementById("intro");
  if (!intro) return;

  /* The hero's words wait under `.opening` and rise on `.splashed`, so they
     arrive as the blades part instead of finishing unseen behind them. */
  var docEl = document.documentElement;
  docEl.classList.add("opening");
  intro.classList.add("managed");

  var svg = document.getElementById("intro-iris");
  var markHost = document.getElementById("intro-mark");
  var src = document.querySelector(".site-header .brand-mark svg");
  if (src && markHost && !markHost.firstChild) markHost.appendChild(src.cloneNode(true));

  var HOLD = 820;      /* the mark on the shut blades */
  var OPEN = 780;      /* the blades swinging open */
  var HURRY = 380;     /* the opening, when someone is in a hurry */
  var CLOSE = 360;     /* shutting again, for a replay */
  var R = 1000;

  var listeners = [];
  var raf = 0, t0 = 0, plan = null, fired = false, done = false;
  var safety = setTimeout(finish, 5000);
  var iris = null;

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function outCubic(p) { return 1 - Math.pow(1 - p, 3); }
  function inOut(p) { return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; }

  function finish() {
    clearTimeout(safety);
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    unlisten();
    intro.classList.add("done");
    docEl.classList.add("splashed");
    if (done) return;
    done = true;
    for (var i = 0; i < listeners.length; i++) { try { listeners[i](); } catch (e) {} }
  }

  if (reduced || !NJ.iris || !svg) { finish(); NJ.intro = { onDone: function (fn) { fn(); }, replay: function () {} }; return; }

  iris = NJ.iris.create(svg, { radius: R, tone: "intro", hideOpen: true });
  intro.classList.add("built");

  /* plan: { close: ms to shut first (0 on load), hold, open } */
  function frame(now) {
    raf = 0;
    if (!t0) t0 = now;
    var t = now - t0;
    var c = plan.close, h = plan.hold, o = plan.open;
    var open, mark;
    if (t < c) {
      var pc = inOut(clamp(t / c, 0, 1));
      open = 1 - pc;
      mark = pc;
    } else if (t < c + h) {
      open = 0;
      mark = 1;
    } else {
      if (!fired) { fired = true; if (NJ.sound) NJ.sound.shutter(); }
      var po = clamp((t - c - h) / o, 0, 1);
      /* a hair of hesitation, then the blades go */
      open = po < 0.06 ? 0 : outCubic((po - 0.06) / 0.94);
      mark = 1 - clamp(po * 3, 0, 1);
      if (po >= 1) { iris.set(1, 0); finish(); return; }
    }
    iris.set(open, (1 - open) * 0.9);
    intro.style.setProperty("--mark", mark.toFixed(3));
    if (t > c + h * 0.5) docEl.classList.add("splashed");
    raf = requestAnimationFrame(frame);
  }

  function run(p) {
    plan = p;
    t0 = 0; fired = false;
    if (!raf) raf = requestAnimationFrame(frame);
  }

  /* Anything at all from the visitor hurries it to the opening. */
  function hurry() {
    if (!plan || done) return;
    var now = performance.now();
    var t = t0 ? now - t0 : 0;
    var c = plan.close, h = plan.hold;
    if (t >= c + h) return;
    plan = { close: 0, hold: 0, open: HURRY };
    t0 = now;
  }
  function onKey(e) {
    if (e.key === "Escape" || e.key === "Enter" || e.key === " ") hurry();
  }
  function listen() {
    intro.addEventListener("pointerdown", hurry);
    global.addEventListener("keydown", onKey);
    global.addEventListener("wheel", hurry, { passive: true });
    global.addEventListener("touchmove", hurry, { passive: true });
  }
  function unlisten() {
    intro.removeEventListener("pointerdown", hurry);
    global.removeEventListener("keydown", onKey);
    global.removeEventListener("wheel", hurry);
    global.removeEventListener("touchmove", hurry);
  }

  listen();
  run({ close: 0, hold: HOLD, open: OPEN });

  NJ.intro = {
    onDone: function (fn) { if (done) fn(); else listeners.push(fn); },
    /* from the search palette: shut, a breath, open — and since it was a
       click, it has its sound */
    replay: function () {
      clearTimeout(safety);
      safety = setTimeout(finish, 5000);
      intro.classList.remove("done");
      done = false;
      listen();
      run({ close: CLOSE, hold: HOLD * 0.7, open: OPEN });
    }
  };
})(window);
