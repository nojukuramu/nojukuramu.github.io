/* ============================================================
   RouteCast — shared helpers
   Everything hangs off the global RC namespace. No modules, no build step.
   ============================================================ */
var RC = (function () {
  "use strict";

  var RC = {};

  RC.el = function (id) { return document.getElementById(id); };

  /* ---------- formatting ---------- */
  RC.fmtDur = function (seconds) {
    var s = Math.max(0, Math.round(seconds));
    var h = Math.floor(s / 3600);
    var m = Math.round((s - h * 3600) / 60);
    if (m === 60) { h += 1; m = 0; }
    if (h && m) return h + " h " + m + " min";
    if (h) return h + " h";
    return m + " min";
  };

  RC.fmtDist = function (meters, units) {
    if (units === "imperial") {
      var mi = meters / 1609.344;
      if (mi < 0.3) return Math.round(meters * 3.28084) + " ft";
      return (mi < 10 ? mi.toFixed(1) : Math.round(mi)) + " mi";
    }
    var km = meters / 1000;
    if (km < 1) return Math.round(meters) + " m";
    return (km < 10 ? km.toFixed(1) : Math.round(km)) + " km";
  };

  RC.fmtSpeed = function (kmh, units) {
    return units === "imperial"
      ? Math.round(kmh / 1.609344) + " mph"
      : Math.round(kmh) + " km/h";
  };

  RC.fmtTemp = function (c, units) {
    return units === "imperial"
      ? Math.round(c * 9 / 5 + 32) + "°"
      : Math.round(c) + "°";
  };

  RC.fmtTime = function (date) {
    try {
      return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    } catch (e) {
      return date.getHours() + ":" + ("0" + date.getMinutes()).slice(-2);
    }
  };

  RC.fmtDay = function (date) {
    var now = new Date();
    var d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var d1 = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    var diff = Math.round((d1 - d0) / 86400000);
    if (diff === 0) return "Today";
    if (diff === 1) return "Tomorrow";
    if (diff === -1) return "Yesterday";
    try {
      return date.toLocaleDateString([], { weekday: "short", day: "numeric" });
    } catch (e) {
      return d1.toDateString().slice(0, 10);
    }
  };

  /* ---------- geo ---------- */
  RC.haversine = function (a, b) {
    var R = 6371008.8, toRad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * toRad;
    var dLon = (b.lon - a.lon) * toRad;
    var la1 = a.lat * toRad, la2 = b.lat * toRad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  };

  /* Compass bearing from a to b, degrees clockwise from north. */
  RC.bearing = function (a, b) {
    var toRad = Math.PI / 180;
    var la1 = a.lat * toRad, la2 = b.lat * toRad;
    var dLon = (b.lon - a.lon) * toRad;
    var y = Math.sin(dLon) * Math.cos(la2);
    var x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLon);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  };

  /* ---------- which way the vehicle is pointing ----------

     `coords.heading` is the honest answer and a great many phones never give
     it: it is null at a standstill by specification, and null ALWAYS on a
     device with no course-over-ground of its own — which includes most
     laptops, some tablets, and more Android handsets than anyone expects.
     Course-up navigation that waits for it simply never rotates, which is
     exactly what "the compass just locks on north" was.

     So: a rider who is moving has a heading whether or not the chipset says
     so, and two fixes and a clock are all it takes to find it. This is that
     fallback, kept in one place because navigation and free drive both need
     it and must not disagree about which way the bike is pointing.

     The rules are the ones that keep it honest rather than merely available:

     * A step shorter than the fix's own error circle is noise, and noise has
       a uniformly distributed bearing. Below MIN_STEP_M nothing is emitted.
     * Below MIN_KMH the rider is stopped, and a stopped vehicle has no course
       over ground at all — the last known one is held rather than replaced by
       the direction the GPS happened to wander.
     * The result is smoothed on the SHORTEST ARC, so crossing north is a
       two-degree step and not a 358-degree spin.
  */
  RC.courseTracker = function (opts) {
    opts = opts || {};
    var MIN_STEP_M = opts.minStepM == null ? 6 : opts.minStepM;
    var MIN_KMH = opts.minKmh == null ? 3 : opts.minKmh;
    var MAX_GAP_S = opts.maxGapS == null ? 12 : opts.maxGapS;
    var ALPHA = opts.alpha == null ? 0.45 : opts.alpha;

    var last = null;       // the fix the next bearing is measured from
    var heading = null;    // smoothed, degrees clockwise from north
    var fromGps = false;   // was the last answer the chipset's own?

    function norm(d) { return ((d % 360) + 360) % 360; }
    function blend(a, b) {
      var d = norm(b - a);
      if (d > 180) d -= 360;
      return norm(a + d * ALPHA);
    }

    return {
      /* Feed every fix. `gpsHeading` is coords.heading or null; `speedKmh` is
         whatever the caller already worked out. Returns the best heading
         available, or null while there has never been one. */
      push: function (lat, lon, t, gpsHeading, speedKmh) {
        var moving = speedKmh == null || speedKmh >= MIN_KMH;

        if (typeof gpsHeading === "number" && !isNaN(gpsHeading) && moving) {
          // The chipset's own course wins outright, and is not smoothed: it is
          // already filtered, and smoothing it would add lag for nothing.
          heading = norm(gpsHeading);
          fromGps = true;
          last = { lat: lat, lon: lon, t: t };
          return heading;
        }

        if (!last) { last = { lat: lat, lon: lon, t: t }; return heading; }
        var dtS = (t - last.t) / 1000;
        if (!(dtS > 0) || dtS > MAX_GAP_S) { last = { lat: lat, lon: lon, t: t }; return heading; }

        var m = RC.haversine(last, { lat: lat, lon: lon });
        var impliedKmh = (m / dtS) * 3.6;
        if (m < MIN_STEP_M || impliedKmh < MIN_KMH) {
          // Parked, crawling, or drifting. Hold what we had; do not move the
          // anchor either, so a slow crawl accumulates into one real step
          // instead of being thrown away one metre at a time.
          return heading;
        }

        var b = RC.bearing(last, { lat: lat, lon: lon });
        heading = (heading == null || fromGps) ? b : blend(heading, b);
        fromGps = false;
        last = { lat: lat, lon: lon, t: t };
        return heading;
      },

      get: function () { return heading; },
      reset: function () { last = null; heading = null; fromGps = false; }
    };
  };

  /* ---------- storage ---------- */
  RC.store = {
    get: function (key, fallback) {
      try {
        var raw = localStorage.getItem("rc:" + key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    set: function (key, value) {
      try { localStorage.setItem("rc:" + key, JSON.stringify(value)); } catch (e) {}
    }
  };

  /* ---------- fetch ---------- */
  /* `code` is the upstream service's own machine-readable reason — OSRM's
     "InvalidValue", "NoRoute" and friends. Callers that need to tell "the
     parameter I sent is not supported here" apart from "this request is
     wrong" cannot do it from the message, which is written for a human. */
  function HttpError(message, kind, status, code) {
    var e = new Error(message);
    e.kind = kind;
    if (status) e.status = status;
    if (code) e.code = code;
    return e;
  }
  RC.error = HttpError;

  RC.jsonGet = function (url, opts) {
    opts = opts || {};
    var timeout = opts.timeout == null ? 15000 : opts.timeout;
    var retries = opts.retries == null ? 1 : opts.retries;

    function attempt(left) {
      var ctrl = ("AbortController" in window) ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, timeout);
      var outer = opts.signal;
      function relay() { if (ctrl) ctrl.abort(); }
      if (outer) {
        if (outer.aborted) { clearTimeout(timer); return Promise.reject(HttpError("Cancelled", "abort")); }
        outer.addEventListener("abort", relay);
      }

      return fetch(url, { signal: ctrl ? ctrl.signal : undefined, headers: { Accept: "application/json" } })
        .then(function (res) {
          if (!res.ok) {
            // OSRM (and other JSON APIs we call) still send a JSON body on
            // 4xx — e.g. {"code":"InvalidValue","message":"..."} — that
            // callers may need to distinguish "this request/param isn't
            // supported" from an unrelated failure. Attach it when present
            // instead of only surfacing the bare status.
            return res.json().catch(function () { return null; }).then(function (body) {
              var err = HttpError("Service returned " + res.status, "http", res.status);
              if (body) err.body = body;
              throw err;
            });
          }
          return res.json();
        })
        .catch(function (err) {
          if (outer && outer.aborted) throw HttpError("Cancelled", "abort");
          if (err && err.kind) throw err;
          if (err && err.name === "AbortError") throw HttpError("The request timed out.", "timeout");
          if (left > 0) return new Promise(function (r) { setTimeout(r, 700); }).then(function () { return attempt(left - 1); });
          throw HttpError("Could not reach the service. Check your connection.", "network");
        })
        .then(function (v) { clearTimeout(timer); if (outer) outer.removeEventListener("abort", relay); return v; },
              function (e) { clearTimeout(timer); if (outer) outer.removeEventListener("abort", relay); throw e; });
    }
    return attempt(retries);
  };

  /* ---------- serialised queue (rate-limit friendly) ---------- */
  RC.throttleQueue = function (minIntervalMs) {
    var chain = Promise.resolve();
    var last = 0;
    return function (taskFn) {
      chain = chain.then(function () {
        var wait = Math.max(0, minIntervalMs - (Date.now() - last));
        return new Promise(function (r) { setTimeout(r, wait); });
      }).then(function () {
        last = Date.now();
        return taskFn();
      }, function () {
        last = Date.now();
        return taskFn();
      });
      return chain;
    };
  };

  RC.debounce = function (fn, ms) {
    var t;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  };

  /* Ask the browser not to evict our storage under disk pressure, and not
   * to let Safari's ITP wipe it after ~7 days without a visit. It's a
   * heuristic grant, not a promise, so log a denial — otherwise there's no
   * way to tell "the browser said no" apart from "storage really did get
   * cleared" if someone reports data loss later. */
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persisted().then(function (already) {
      if (already) return true;
      return navigator.storage.persist();
    }).then(function (granted) {
      if (!granted) console.warn("[routecast] persistent storage was not granted; saved settings may be evicted by the browser");
    }).catch(function () {});
  }

  RC.clamp = function (v, lo, hi) { return Math.max(lo, Math.min(hi, v)); };

  /* ---------- sub-tabs inside a pane ----------
     A pane that has grown four jobs gets a strip of four buttons instead of
     four screens of scrolling. The markup is the whole contract, so the Ride
     tab and the Pubs tab behave identically and neither owns the idea:

       <div data-subtabs="group"> <button data-sub="riders">…</button> … </div>
       <div data-sub-pane="group:riders"> … </div>

     The pane last chosen is remembered per strip, and a strip whose chosen
     button has been hidden falls back to its first one rather than showing
     an empty pane. */
  RC.subtabs = function (name, onPick) {
    var strip = document.querySelector('[data-subtabs="' + name + '"]');
    var cur = null;
    if (!strip) return { select: function () {}, current: function () { return null; } };

    function select(key, quiet) {
      var btns = strip.querySelectorAll("[data-sub]");
      var ok = false;
      for (var i = 0; i < btns.length; i++) {
        if (btns[i].getAttribute("data-sub") === key && !btns[i].hidden) ok = true;
      }
      if (!ok && btns.length) key = btns[0].getAttribute("data-sub");
      cur = key;
      for (var j = 0; j < btns.length; j++) {
        var on = btns[j].getAttribute("data-sub") === key;
        btns[j].setAttribute("aria-selected", on ? "true" : "false");
        btns[j].tabIndex = on ? 0 : -1;
      }
      var panes = document.querySelectorAll('[data-sub-pane^="' + name + ':"]');
      for (var k = 0; k < panes.length; k++) {
        panes[k].hidden = panes[k].getAttribute("data-sub-pane") !== name + ":" + key;
      }
      RC.store.set("sub:" + name, key);
      if (!quiet && typeof onPick === "function") onPick(key);
    }

    strip.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest("[data-sub]") : null;
      if (b) select(b.getAttribute("data-sub"));
    });
    // Arrow keys walk the strip, as a tab list should.
    strip.addEventListener("keydown", function (e) {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      var btns = Array.prototype.filter.call(strip.querySelectorAll("[data-sub]"), function (b) { return !b.hidden; });
      var at = -1;
      for (var i = 0; i < btns.length; i++) if (btns[i].getAttribute("data-sub") === cur) at = i;
      var next = btns[(at + (e.key === "ArrowRight" ? 1 : btns.length - 1)) % btns.length];
      if (!next) return;
      e.preventDefault();
      select(next.getAttribute("data-sub"));
      next.focus();
    });

    select(RC.store.get("sub:" + name, null), true);
    return { select: select, current: function () { return cur; } };
  };

  RC.escapeHtml = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };

  return RC;
})();
