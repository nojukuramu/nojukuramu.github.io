/* ============================================================
   RouteCast — guidance: what the app says, and when

   A navigator you have to look at is a navigator you look at while
   riding. Everything the rider needs from the screen in the moment — the
   next turn, the rain ahead, the speed they asked to be warned about, the
   two hours they have been in the saddle — can be SAID instead, and on a
   phone in a jacket pocket with a helmet speaker, said is the only way it
   arrives at all.

   What it speaks through
   ----------------------
   The browser's own speech synthesis: no key, no network, no library, and
   every browser worth riding with already has it. The helper is lifted from
   KaraokeNatin's `speak()` (karaokenatin/js/app.js), which learned the same
   two lessons first: voices differ wildly so every line has to read well
   flat, and a browser with the API missing simply gets the screen without
   the voice. What is new here is priority — a turn that is happening NOW
   interrupts a weather note, and a weather note never interrupts a turn.

   When it speaks
   --------------
   A turn is announced twice at most: once far out (about twenty seconds
   away at the current speed, so a lane change has time to happen) and once
   as it arrives (about seven seconds). "Continue onto" steps are only said
   the second time, because a road changing its name is not a thing anybody
   needs to be told a kilometre early. The distances scale with speed: the
   same turn is called earlier on a highway than in a barangay.

   And it buzzes, where the phone can: a short double pulse as a turn
   arrives, which is the one signal that gets through gloves, a helmet and
   an engine. iOS cannot vibrate from a web page; it simply stays silent.

   Everything is off the moment the rider says so, from the speaker in the
   turn banner, and nothing here ever makes a network request.
   ============================================================ */
var RC = RC || {};

RC.guide = (function (global) {
  "use strict";

  var DEFAULTS = { voice: true, buzz: true, breakMin: 120 };

  var FAR_S = 20, NEAR_S = 7;            // seconds ahead at the current speed
  var FAR_MIN_M = 250, FAR_MAX_M = 1200;
  var NEAR_MIN_M = 70, NEAR_MAX_M = 260;
  var WX_AHEAD_M = 10000;                // warn about weather this far out
  var SPEED_REPEAT_MS = 60000;           // one speed warning a minute, at most

  var settings = null;
  var bridge = null;
  var announced = {};                    // step index -> { far, near }
  var warnedWx = {};                     // checkpoint key -> true
  var nextBreakS = 0;
  var lastSpeedWarnAt = 0;
  var active = false;
  var mode = null;

  function load() {
    var s = RC.store.get("guide", null) || {};
    settings = {
      voice: s.voice == null ? DEFAULTS.voice : !!s.voice,
      buzz: s.buzz == null ? DEFAULTS.buzz : !!s.buzz,
      breakMin: typeof s.breakMin === "number" ? s.breakMin : DEFAULTS.breakMin
    };
  }

  function persist() { RC.store.set("guide", settings); }

  function units() { return bridge && bridge.units ? bridge.units() : "metric"; }

  /* ---------------------------------------------------------
     Speaking and buzzing
     --------------------------------------------------------- */
  function synth() {
    var s = global.speechSynthesis;
    return (s && typeof global.SpeechSynthesisUtterance === "function") ? s : null;
  }

  function say(text, opts) {
    opts = opts || {};
    if (!settings.voice || !text) return false;
    var s = synth();
    if (!s) return false;
    try {
      // A turn happening now outranks anything already being said.
      if (opts.urgent) s.cancel();
      var u = new global.SpeechSynthesisUtterance(text);
      u.rate = 1.02;
      u.pitch = 1;
      u.volume = 1;
      try { u.lang = document.documentElement.lang || "en"; } catch (e) {}
      s.speak(u);
      return true;
    } catch (e) { return false; }
  }

  function buzz(pattern) {
    if (!settings.buzz) return false;
    var nav = global.navigator;
    if (!nav || typeof nav.vibrate !== "function") return false;
    try { return nav.vibrate(pattern); } catch (e) { return false; }
  }

  /* iOS will not let a page speak until it has spoken once inside a user
     gesture. The tap that starts a ride is that gesture, so the voice is
     woken there — with nothing audible — and is ready by the first turn. */
  function prime() {
    if (!settings.voice) return;
    var s = synth();
    if (!s) return;
    try {
      var u = new global.SpeechSynthesisUtterance(" ");
      u.volume = 0;
      s.speak(u);
    } catch (e) {}
  }

  /* ---------------------------------------------------------
     Words
     --------------------------------------------------------- */

  /* Distances the way a person says them: "three hundred metres", not
     "two hundred and eighty-seven". Rounded coarser the further out it is,
     because nobody is counting metres a kilometre from a junction. */
  function spokenDistance(m, u) {
    u = u || units();
    if (u === "imperial") {
      var ft = m * 3.28084;
      if (ft < 1000) {
        var r = ft < 300 ? Math.max(50, Math.round(ft / 50) * 50) : Math.round(ft / 100) * 100;
        return r + " feet";
      }
      var mi = m / 1609.344;
      if (mi < 0.35) return "a quarter of a mile";
      if (mi < 0.65) return "half a mile";
      var ms = mi < 10 ? (Math.round(mi * 10) / 10) : Math.round(mi);
      return ms + (ms === 1 ? " mile" : " miles");
    }
    if (m < 1000) {
      var mm = m < 100 ? Math.max(10, Math.round(m / 10) * 10)
        : m < 500 ? Math.round(m / 50) * 50 : Math.round(m / 100) * 100;
      if (mm >= 1000) return "1 kilometre";
      return mm + " metres";
    }
    var km = m / 1000;
    var ks = km < 10 ? (Math.round(km * 10) / 10) : Math.round(km);
    return ks + (ks === 1 ? " kilometre" : " kilometres");
  }

  function lowerFirst(t) { return t ? t.charAt(0).toLowerCase() + t.slice(1) : t; }

  /* OSRM's manoeuvre, reduced to the handful of arrows a road sign has. */
  function kind(step) {
    if (!step) return "straight";
    var type = step.type || "", mod = step.modifier || "";
    var left = mod.indexOf("left") > -1, right = mod.indexOf("right") > -1;
    if (type === "arrive") return "arrive";
    if (type === "depart") return "depart";
    if (/roundabout|rotary/.test(type)) {
      return left ? "roundabout-left" : (mod === "straight" ? "roundabout-straight" : "roundabout");
    }
    if (type === "merge") return "merge";
    if (type === "fork") return left ? "fork-left" : right ? "fork-right" : "straight";
    if (type === "on ramp" || type === "off ramp") return left ? "ramp-left" : "ramp-right";
    if (mod === "uturn") return "uturn";
    if (mod === "sharp right") return "sharp-right";
    if (mod === "sharp left") return "sharp-left";
    if (mod === "slight right") return "slight-right";
    if (mod === "slight left") return "slight-left";
    if (right) return "right";
    if (left) return "left";
    return "straight";
  }

  function glyph(step) { return RC.icons.turn(kind(step)); }

  /* A step that only renames the road, or carries straight on, is not worth
     a far-out announcement: it is worth one line as it arrives, if that. */
  function minor(step) {
    var t = step && step.type;
    return (t === "continue" || t === "new name" || t === "notification") && kind(step) === "straight";
  }

  function phraseFar(step, distM) {
    return "In " + spokenDistance(distM) + ", " + lowerFirst(step.text) + ".";
  }

  function phraseNow(step) {
    var line = step.text + ".";
    var then = step.then;
    // Two manoeuvres close together are one instruction.
    if (then && then.gapM < 150 && then.type !== "arrive") {
      line = step.text + ", then " + lowerFirst(then.text) + ".";
    }
    return line;
  }

  /* ---------------------------------------------------------
     The ride
     --------------------------------------------------------- */
  function begin(opts) {
    opts = opts || {};
    active = true;
    mode = opts.mode || "nav";
    announced = {};
    warnedWx = {};
    lastSpeedWarnAt = 0;
    nextBreakS = settings.breakMin > 0 ? settings.breakMin * 60 : 0;
    prime();
  }

  /* keep: let a sentence already under way finish — "you have arrived" is
     said as the ride ends, and cutting it off mid-word would be silly. */
  function end(opts) {
    active = false;
    mode = null;
    announced = {};
    warnedWx = {};
    if (opts && opts.keep) return;
    var s = synth();
    if (s) { try { s.cancel(); } catch (e) {} }
  }

  /* Said once, on the first fix, when there is a route to describe. */
  function introduce(dest, remainingM, etaText) {
    if (!dest) return;
    // A place set by coordinate is named by its coordinate, and nobody wants
    // fourteen point six four zero zero zero read into their helmet.
    if (/^\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*$/.test(dest)) dest = "your destination";
    say("Heading to " + dest + ". " + spokenDistance(remainingM) +
        (etaText ? ", arriving about " + etaText : "") + ".");
  }

  function turns(ns) {
    var step = ns.nextStep;
    if (!step || step.type === "depart") return;
    var v = ns.displaySpeedKmh != null ? ns.displaySpeedKmh : (ns.speedKmh != null ? ns.speedKmh : 30);
    var mps = Math.max(v, 15) / 3.6;
    var far = RC.clamp(mps * FAR_S, FAR_MIN_M, FAR_MAX_M);
    var near = RC.clamp(mps * NEAR_S, NEAR_MIN_M, NEAR_MAX_M);
    var rec = announced[step.index] || (announced[step.index] = {});
    var d = step.distanceM;

    if (step.type === "arrive") return;     // arrival has its own line

    if (d <= near && !rec.near) {
      rec.near = rec.far = true;
      if (minor(step) && !(step.then && step.then.gapM < 150)) return;
      say(phraseNow(step), { urgent: true });
      if (!minor(step)) buzz([80, 70, 80]);
    } else if (d <= far && d > near + 60 && !rec.far) {
      rec.far = true;
      if (!minor(step)) say(phraseFar(step, d));
    }
  }

  /* Caution or danger at the next checkpoint, said once per checkpoint while
     it is still far enough away to do something about it. */
  function weatherAhead(ns, vehicle) {
    var cp = ns.nextCheckpoint;
    if (!cp || !cp.wx || cp.wx.outOfRange) return;
    if (!(ns.distanceToNextM > 0 && ns.distanceToNextM < WX_AHEAD_M)) return;
    var key = Math.round(cp.distance);
    if (warnedWx[key]) return;
    var level = RC.risk.score(cp.wx, vehicle).level;
    if (level !== "caution" && level !== "danger") return;
    warnedWx[key] = true;
    var sky = RC.weather.describe(cp.wx.code, cp.wx.isDay).text;
    say((level === "danger" ? "Warning. " : "Heads up. ") + sky + " ahead, in about " +
        spokenDistance(ns.distanceToNextM) + ".");
    buzz(level === "danger" ? [200, 100, 200, 100, 200] : [160, 90, 160]);
    if (bridge && bridge.toast) bridge.toast(sky + " ahead — " + RC.fmtDist(ns.distanceToNextM, units()), level);
  }

  /* A break reminder is a question, not an order: said once per interval
     of riding time, and shown as one line that goes away on its own. */
  function breaks(elapsedS) {
    if (!settings.breakMin || !nextBreakS || !(elapsedS >= nextBreakS)) return;
    var h = Math.floor(elapsedS / 3600), m = Math.round((elapsedS - h * 3600) / 60);
    var span = h ? (h + (h === 1 ? " hour" : " hours") + (m >= 10 ? " " + m + " minutes" : "")) : m + " minutes";
    nextBreakS += settings.breakMin * 60;
    say("You have been riding for " + span + ". A break would not hurt.");
    buzz([120, 80, 120]);
    if (bridge && bridge.toast) bridge.toast(RC.fmtDur(elapsedS) + " on the road — time for a break?", "watch");
  }

  var api = {
    init: function (b) {
      bridge = b || {};
      load();
    },

    kind: kind,
    glyph: glyph,
    spokenDistance: spokenDistance,
    phraseFar: phraseFar,
    phraseNow: phraseNow,

    begin: begin,
    end: end,
    introduce: introduce,
    isActive: function () { return active; },

    nav: function (ns, vehicle) {
      if (!active || !ns) return;
      turns(ns);
      weatherAhead(ns, vehicle);
      breaks(ns.elapsedS);
    },

    free: function (fs) {
      if (!active || !fs) return;
      breaks(fs.elapsedS);
    },

    arrived: function (name) {
      say(name ? "You have arrived at " + name + "." : "You have arrived.", { urgent: true });
      buzz([90, 60, 90, 60, 220]);
    },

    rerouting: function () { say("Finding a new route.", { urgent: true }); },

    /* A reroute numbers its steps from zero again, so what was announced for
       the old line says nothing about the new one. */
    routeChanged: function () { announced = {}; },

    /* Crossing the speed the rider asked to be warned about. Once per
       crossing, and never more than once a minute. */
    speeding: function (limitText) {
      var now = Date.now();
      if (now - lastSpeedWarnAt < SPEED_REPEAT_MS) return;
      lastSpeedWarnAt = now;
      buzz([60, 50, 60, 50, 60]);
      say("Speed. Over " + limitText + ".", { urgent: false });
    },

    say: say,
    buzz: buzz,
    prime: prime,

    canSpeak: function () { return !!synth(); },
    canBuzz: function () { return !!(global.navigator && typeof global.navigator.vibrate === "function"); },

    settings: function () {
      return { voice: settings.voice, buzz: settings.buzz, breakMin: settings.breakMin };
    },

    set: function (key, value) {
      if (!settings.hasOwnProperty(key)) return api.settings();
      settings[key] = key === "breakMin" ? (Math.max(0, value | 0)) : !!value;
      persist();
      if (key === "voice" && !settings.voice) {
        var s = synth();
        if (s) { try { s.cancel(); } catch (e) {} }
      }
      if (key === "breakMin" && active) nextBreakS = settings.breakMin > 0 ? settings.breakMin * 60 : 0;
      if (bridge && bridge.onChange) { try { bridge.onChange(api.settings()); } catch (e) {} }
      return api.settings();
    }
  };

  load();
  return api;
})(typeof window !== "undefined" ? window : globalThis);
