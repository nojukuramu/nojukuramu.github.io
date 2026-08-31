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
  function HttpError(message, kind, status) {
    var e = new Error(message);
    e.kind = kind;
    if (status) e.status = status;
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

  RC.escapeHtml = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };

  return RC;
})();
