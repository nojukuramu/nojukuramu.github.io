/* ============================================================
   nojukuramu — the splash

   The logo writes itself: four Poppins outlines, stroked on in turn, then
   flooded with the same gold the sunset uses. It is not only decoration.

   The order matters. Measuring first and animating second is deliberate:
   stroke-dashoffset is a main-thread property, so a scene repainting behind
   the black would starve the one thing anybody can actually see. So the
   burst of real rendering happens while nothing is moving, the verdict sets
   how much drawing this device can afford, the logo is written on a quiet
   main thread, and the scene only starts as the curtain lifts. The gauge
   under the mark is that measurement, not a fake progress bar.

   If this file never loads, a CSS animation clears the splash on its own a
   few seconds in, so a failed script can never leave a black page.
   ============================================================ */
(function (global) {
  "use strict";

  var NJ = (global.NJ = global.NJ || {});
  var reduced = global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var splash = document.getElementById("splash");
  if (!splash) return;

  var ink = splash.querySelector(".splash-ink");
  var glyphs = ink ? Array.prototype.slice.call(ink.children) : [];
  var gauge = document.getElementById("splash-gauge-fill");

  /* How long each letter takes, and how far apart they start. */
  var DRAW = reduced ? 0 : 540;
  var STAGGER = reduced ? 0 : 140;
  var PLATE = reduced ? 0 : 190;         /* the square lands before the first letter */
  var MIN_SHOW = reduced ? 400 : 1150;   /* never blink past too fast to read */
  var MAX_SHOW = 4200;                   /* never hold the page hostage */

  var done = false;
  var started = 0;

  function finish() {
    if (done) return;
    done = true;
    splash.classList.add("gone");
    document.documentElement.classList.add("splashed");
    /* Out of the accessibility tree and off the compositor once it has faded. */
    setTimeout(function () {
      splash.setAttribute("aria-hidden", "true");
      splash.style.display = "none";
    }, 700);
  }

  /* --- the writing --- */
  function write() {
    if (!glyphs.length || reduced) {
      splash.classList.add("writing", "filling", "still", "plated");
      return 0;
    }
    /* Set the starting offset with transitions OFF. Naming a transition in
       the same breath as the value means the *initial* value animates too —
       0 to len — and by the time it is set back to 0 the letter has barely
       moved, so nothing ever appears to be drawn. Values first, flush, then
       arm the transition. */
    glyphs.forEach(function (g) {
      var len;
      try { len = g.getTotalLength(); } catch (e) { len = 900; }
      /* a little slack, so the dash clears the join it started from */
      len = Math.ceil(len) + 4;
      g.style.transition = "none";
      g.style.strokeDasharray = len;
      g.style.strokeDashoffset = len;
    });
    /* Read something layout-dependent to force the style flush; without it
       the two writes are coalesced and there is nothing to transition from. */
    void ink.getBoundingClientRect().width;

    /* the square arrives first, then the word is written inside it */
    splash.classList.add("plated");

    /* The cue comes off this same schedule rather than its own timers, so
       a bell can never land on a letter that has not arrived. */
    if (NJ.ambience && NJ.ambience.logo) {
      var letters = glyphs.map(function (_, i) { return PLATE + i * STAGGER; });
      NJ.ambience.logo({
        plate: 0,
        letters: letters,
        draw: DRAW,
        flood: PLATE + (glyphs.length - 1) * STAGGER + DRAW * 0.55
      });
    }

    glyphs.forEach(function (g, i) {
      g.style.transition = "stroke-dashoffset " + DRAW + "ms cubic-bezier(.62,.03,.32,1) " + (PLATE + i * STAGGER) + "ms";
      g.style.strokeDashoffset = "0";
    });
    splash.classList.add("writing");
    var full = PLATE + (glyphs.length - 1) * STAGGER + DRAW;
    setTimeout(function () { splash.classList.add("filling"); }, full - DRAW * 0.45);
    return full;
  }

  /* `probe` measures and resolves with a quality; `reveal` starts the scene.
     Both are optional — without them this is just a splash. */
  function run(hooks) {
    hooks = hooks || {};
    started = performance.now();

    /* Try to bring the audio clock up now. On a cold load browsers will
       refuse — no gesture has happened — and the cue simply does not play;
       nothing is faked and nothing is queued up to startle anyone later. A
       visitor who moves, scrolls or types before the letters start hands us
       the gesture in time, so these listeners try again, once. */
    if (NJ.ambience && NJ.ambience.ensure) {
      NJ.ambience.ensure();
      var unlock = function () { if (NJ.ambience.ensure) NJ.ambience.ensure(); };
      ["pointermove", "pointerdown", "wheel", "touchstart", "keydown"].forEach(function (ev) {
        document.addEventListener(ev, unlock, { once: true, passive: true });
      });
    }

    if (gauge && !reduced) {
      gauge.style.transition = "transform 420ms cubic-bezier(.3,.7,.3,1)";
      requestAnimationFrame(function () { gauge.style.transform = "scaleX(.55)"; });
    }

    var probe = hooks.probe ? hooks.probe() : Promise.resolve(null);
    /* never wait on a probe that has hung */
    var raced = Promise.race([
      probe,
      new Promise(function (res) { setTimeout(function () { res(null); }, 1800); })
    ]);

    raced.catch(function () { return null; }).then(function (quality) {
      if (quality != null) splash.dataset.quality = (+quality).toFixed(2);
      if (gauge) {
        gauge.style.transition = "transform 320ms cubic-bezier(.22,1,.36,1)";
        gauge.style.transform = "scaleX(1)";
      }

      /* the main thread is free now: write */
      var drawMs = write();
      var wait = Math.max(drawMs + (reduced ? 120 : 360),
                          MIN_SHOW - (performance.now() - started));
      setTimeout(function () {
        if (hooks.reveal) { try { hooks.reveal(); } catch (e) {} }
        finish();
      }, Math.max(0, wait));
    });

    /* Whatever happens — a thrown hook, a stalled promise — the page is
       never left behind a black rectangle, and the scene still starts. */
    setTimeout(function () {
      if (done) return;
      if (hooks.reveal) { try { hooks.reveal(); } catch (e) {} }
      finish();
    }, MAX_SHOW);

    splash.addEventListener("click", skip);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" || e.key === "Enter" || e.key === " ") skip();
    }, { once: true });

    function skip() {
      if (hooks.reveal) { try { hooks.reveal(); } catch (e) {} }
      finish();
    }
  }

  NJ.splash = { run: run, finish: finish };
})(window);
