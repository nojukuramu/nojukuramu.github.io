/* ============================================================
   KomyutApp — shared helpers

   Lifted from routecast/static/js/util.js with the namespace changed from
   RC to KM, the formatters this app needs added (fares, vote counts,
   "how long ago"), and the parts RouteCast alone needs (course tracking,
   ride recording) left behind. The fetch helper, the throttle queue, the
   storage wrapper and the HTML escaper are the RouteCast originals: same
   behaviour, same error `kind` vocabulary, so anyone who has read one has
   read the other.
   ============================================================ */
var KM = (function () {
  "use strict";

  var KM = {};

  KM.el = function (id) { return document.getElementById(id); };

  /* ---------- formatting ---------- */
  KM.fmtDur = function (seconds) {
    var s = Math.max(0, Math.round(seconds));
    var h = Math.floor(s / 3600);
    var m = Math.round((s - h * 3600) / 60);
    if (m === 60) { h += 1; m = 0; }
    if (h && m) return h + " h " + m + " min";
    if (h) return h + " h";
    return m + " min";
  };

  KM.fmtDist = function (meters) {
    var km = meters / 1000;
    if (km < 1) return Math.round(meters) + " m";
    return (km < 10 ? km.toFixed(1) : Math.round(km)) + " km";
  };

  /* A fare range, in whatever currency the route was filed under. Routes
     built abroad carry their own code, so this never assumes pesos. */
  KM.fmtFare = function (min, max, currency) {
    var cur = currency || "PHP";
    var sym = cur === "PHP" ? "₱" : (cur === "USD" ? "$" : (cur === "EUR" ? "€" : cur + " "));
    if (min == null && max == null) return "";
    if (min != null && max != null && Math.abs(max - min) > 0.005) {
      return sym + KM.fmtMoney(min) + "–" + KM.fmtMoney(max);
    }
    return sym + KM.fmtMoney(min == null ? max : min);
  };

  KM.fmtMoney = function (n) {
    var v = Number(n);
    if (!isFinite(v)) return "0";
    return (Math.round(v * 100) % 100 === 0) ? String(Math.round(v)) : v.toFixed(2);
  };

  KM.fmtCount = function (n) {
    var v = Number(n) || 0;
    if (Math.abs(v) < 1000) return String(v);
    if (Math.abs(v) < 1000000) return (v / 1000).toFixed(v % 1000 === 0 ? 0 : 1) + "k";
    return (v / 1000000).toFixed(1) + "M";
  };

  KM.fmtTime = function (date) {
    try {
      return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    } catch (e) {
      return date.getHours() + ":" + ("0" + date.getMinutes()).slice(-2);
    }
  };

  /* "3 days ago". Deliberately coarse past a week: a comment's exact minute
     three months later is noise, and the date is what people actually read. */
  KM.fmtAgo = function (input) {
    var d = (input instanceof Date) ? input : new Date(input);
    if (isNaN(d.getTime())) return "";
    var s = (Date.now() - d.getTime()) / 1000;
    if (s < 45) return "just now";
    if (s < 90) return "a minute ago";
    if (s < 3600) return Math.round(s / 60) + " min ago";
    if (s < 7200) return "an hour ago";
    if (s < 86400) return Math.round(s / 3600) + " h ago";
    if (s < 172800) return "yesterday";
    if (s < 604800) return Math.round(s / 86400) + " days ago";
    try { return d.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" }); }
    catch (e) { return d.toDateString().slice(4); }
  };

  /* ---------- geo ---------- */
  KM.haversine = function (a, b) {
    var R = 6371008.8, toRad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * toRad;
    var dLon = (b.lon - a.lon) * toRad;
    var la1 = a.lat * toRad, la2 = b.lat * toRad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  };

  KM.bearing = function (a, b) {
    var toRad = Math.PI / 180;
    var la1 = a.lat * toRad, la2 = b.lat * toRad;
    var dLon = (b.lon - a.lon) * toRad;
    var y = Math.sin(dLon) * Math.cos(la2);
    var x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLon);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  };

  /* Metres per degree of longitude at this latitude. Used everywhere a
     bounding box in degrees has to mean a distance on the ground. */
  KM.lonScale = function (lat) { return Math.cos(lat * Math.PI / 180); };

  /* The point on segment a->b nearest p, and how far off it is. Returned in
     the same {lat,lon} shape everything else here uses. This is the whole
     primitive the journey planner stands on: "does this route come near
     enough to walk to" is this function asked once per segment. */
  KM.nearestOnSegment = function (p, a, b) {
    var s = KM.lonScale(p.lat);
    var ax = a.lon * s, ay = a.lat, bx = b.lon * s, by = b.lat;
    var px = p.lon * s, py = p.lat;
    var dx = bx - ax, dy = by - ay;
    var len2 = dx * dx + dy * dy;
    var t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    var pt = { lat: ay + dy * t, lon: (ax + dx * t) / s };
    return { point: pt, t: t, distance: KM.haversine(p, pt) };
  };

  /* ---------- storage ---------- */
  KM.store = {
    get: function (key, fallback) {
      try {
        var raw = localStorage.getItem("km:" + key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    set: function (key, value) {
      try { localStorage.setItem("km:" + key, JSON.stringify(value)); } catch (e) {}
    },
    remove: function (key) {
      try { localStorage.removeItem("km:" + key); } catch (e) {}
    }
  };

  /* ---------- fetch ---------- */
  /* `kind` is the machine-readable reason a caller can branch on; `code` is
     the upstream service's own word for it (OSRM's "NoRoute", PostgREST's
     "23505"), because a message written for a human cannot be branched on. */
  function HttpError(message, kind, status, code) {
    var e = new Error(message);
    e.kind = kind;
    if (status) e.status = status;
    if (code) e.code = code;
    return e;
  }
  KM.error = HttpError;

  KM.jsonGet = function (url, opts) {
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
  KM.throttleQueue = function (minIntervalMs) {
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

  KM.debounce = function (fn, ms) {
    var t;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  };

  KM.clamp = function (v, lo, hi) { return Math.max(lo, Math.min(hi, v)); };

  /* The last line of defence, not the first. Every string that came off the
     network goes into the DOM through textContent; this exists for the two
     or three places that build a fragment of markup, and for the validation
     harness to point at. */
  KM.escapeHtml = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };

  /* ---------- the one place markup enters the DOM ----------

     Every icon in this app is an inline SVG string, and putting one on the
     page means assigning to innerHTML. That is also exactly the operation
     that turns a route name written by a stranger into executable markup,
     so it happens in one function and nowhere else: tools/validate.js
     refuses to let any other module assign to innerHTML at all.

     `name` is looked up in the icon set, which is a table of constants in
     static/js/icons.js. A name that is not in it returns a neutral glyph,
     so there is no path from an unknown name to an empty page — and no
     path from any string to anything but one of those constants. */
  KM.glyph = function (el, name, kind) {
    if (!el) return el;
    el.innerHTML = kind === "ride" ? KM.icons.ride(name)
                 : kind === "weather" ? KM.icons.weather(name)
                 : KM.icons.ui(name);
    return el;
  };

  /* Build an element and fill it with TEXT. Used everywhere a list of
     community content is rendered, precisely so that no such list is ever
     assembled by string concatenation. */
  KM.mk = function (tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = String(text);
    return n;
  };

  return KM;
})();
