/* ============================================================
   Aisa — the info sheet

   The shape of routecast/static/js/info.js, with Aisa's topics: one sheet,
   one scrim, one registry, clicks delegated from the document so any
   button carrying data-info="<key>" opens its topic. The panel says one
   line about anything; the explanation lives here, one tap away.
   ============================================================ */
var AISA = AISA || {};

AISA.info = (function () {
  "use strict";

  var TOPICS = {
    api: {
      title: "Driving her from code",
      body:
        "<p>Everything the panel does goes through one object, <code>window.Aisa</code>. " +
        "Nothing is attached to it yet - no tracker, no voice, no chat. It is the socket " +
        "those plug into.</p>" +
        "<pre>await Aisa.ready;\n\n" +
        "Aisa.expression(\"happy\");          // or { mix: true, weight: 0.5 }\n" +
        "Aisa.play(\"wave\");                 // resolves when it ends\n" +
        "Aisa.lookAt(0.4, 0.2);             // -1..1, +x right, +y up\n" +
        "Aisa.lookAtPoint(e.clientX, e.clientY);\n" +
        "Aisa.blink();\n" +
        "Aisa.mouth({ open: 0.6, form: 1 });\n" +
        "Aisa.speak(level);                 // lip-sync: 0..1, every frame\n" +
        "Aisa.head({ x: 15, y: -5, z: 8 });  // degrees\n" +
        "Aisa.arm(\"right\", { shoulder: 140, elbow: 30, wrist: 10 });\n" +
        "Aisa.leg(\"left\", 12);\n" +
        "Aisa.set(\"ParamCheek\", 1);         // any parameter by id\n" +
        "Aisa.auto({ idle: false });        // blink, breath, idle, physics\n" +
        "Aisa.on(\"frame\", function (values, dt) { ... });</pre>" +
        "<p><b>left</b> and <b>right</b> are hers, as in Live2D: her right arm is the one on " +
        "the left of the screen.</p>" +
        "<p>The parameter ids are Live2D's standard ones, so a face tracker that already " +
        "outputs <code>ParamAngleX</code>, <code>ParamEyeLOpen</code> and the rest can feed " +
        "<code>Aisa.set()</code> as it is. <code>README.md</code> beside this page lists " +
        "every call.</p>"
    },

    expressions: {
      title: "Expressions",
      body:
        "<p>An expression is a held pose of the face. Picking one fades the last one out " +
        "and this one in over a third of a second.</p>" +
        "<p>Her own drawing is <b>neutral</b> - a level stare - so neutral changes nothing. " +
        "Expressions sit on top of the parameters, so a raised arm or a turned head stays " +
        "where it is while her face changes.</p>"
    },

    motions: {
      title: "Motions",
      body:
        "<p>A motion is a short performance - a nod, a wave, a hop - added on top of " +
        "whatever she is already doing, so nodding while smiling is still a smile.</p>" +
        "<p>Each is a few keyframes in <code>js/expressions.js</code>; adding one is adding " +
        "an entry there.</p>"
    },

    auto: {
      title: "Looking alive",
      body:
        "<p><b>Blink</b> every two to six seconds, sometimes twice. <b>Breath</b> lifts her " +
        "chest and shoulders. <b>Idle</b> lets her head and body drift and her eyes wander " +
        "a little, so she is never a still picture.</p>" +
        "<p><b>Physics</b> swings the hair and the skirt after a movement and lets them " +
        "settle. <b>Follow pointer</b> turns her to look at the mouse or a finger - a test " +
        "of the look-at socket, not a feature.</p>"
    },

    params: {
      title: "Parameters",
      body:
        "<p>Every slider is one parameter of the rig, the value <code>Aisa.set()</code> " +
        "holds. What she shows is that plus the expression, any motion and the live " +
        "behaviours - the number on the right is what she is showing now.</p>" +
        "<p>Angles are degrees. Eyes open from 0 to 1, and to 1.2 for wide. Shoulders go " +
        "from 0 hanging to 180 straight up; elbows and wrists bend outward when positive " +
        "and fold in when negative.</p>"
    }
  };

  var sheet = null, scrim = null, titleEl = null, bodyEl = null, lastFocus = null;
  function el(id) { return document.getElementById(id); }

  function ensure() {
    if (sheet) return true;
    sheet = el("info-sheet"); scrim = el("info-scrim");
    titleEl = el("info-title"); bodyEl = el("info-body");
    return !!(sheet && titleEl && bodyEl);
  }

  function open(key) {
    if (!ensure()) return false;
    var topic = TOPICS[key];
    if (!topic) return false;
    try { lastFocus = document.activeElement; } catch (e) { lastFocus = null; }
    titleEl.textContent = topic.title;
    bodyEl.innerHTML = topic.body;
    sheet.hidden = false;
    if (scrim) scrim.hidden = false;
    var close = el("info-close");
    if (close && close.focus) { try { close.focus(); } catch (e) {} }
    return true;
  }

  function close() {
    if (!ensure() || sheet.hidden) return false;
    sheet.hidden = true;
    if (scrim) scrim.hidden = true;
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
    lastFocus = null;
    return true;
  }

  function init() {
    if (!ensure()) return;
    el("info-close").addEventListener("click", close);
    if (scrim) scrim.addEventListener("click", close);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
    document.addEventListener("click", function (e) {
      var btn = e.target && e.target.closest ? e.target.closest("[data-info]") : null;
      if (!btn) return;
      e.preventDefault();
      open(btn.getAttribute("data-info"));
    });
  }

  return {
    init: init, open: open, close: close,
    has: function (key) { return !!TOPICS[key]; },
    keys: function () { return Object.keys(TOPICS); }
  };
})();
