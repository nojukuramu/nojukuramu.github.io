/* ============================================================
   RouteCast — the dashboard

   The HUD used to be one fixed strip: a speed and ten tiles in an order
   somebody else chose. That is the right dashboard for exactly one rider.
   The one on a scooter in Manila traffic wants the ETA and the rain; the one
   touring Benguet wants the climb and the sunset; the one with the phone in
   a tank bag wants three numbers big enough to read without leaning over.

   So the dashboard is now three things the rider decides:

     the style   Strip  — the speed and a row of tiles, as it always was.
                 Big    — the speed on a gauge and three tiles, large enough
                          to read at arm's length on a mount.
                 Minimal— the speed and one tile in a corner. The map gets
                          everything else.
     the tiles   which ones, and in what order, separately for navigation
                 and for free drive, because they are different rides.
     the alert   a speed to be warned above. The number turns red and the
                 phone buzzes once — a speed the RIDER chose, because there
                 is no key-less source of speed limits and a made-up limit is
                 worse than none.

   Nothing here works out a value. app.js hands over every tile's value for
   the current mode on each fix; this module only decides which of them are
   on the screen and how they look. That split is what lets a tile be added
   in one place (app.js, where the data is) and chosen in another (here).

   Held down for a moment, the dashboard opens its own settings — the one
   place a rider is going to think "I wish that said something else".
   ============================================================ */
var RC = RC || {};

RC.hud = (function (global) {
  "use strict";

  var STYLES = ["strip", "big", "mini"];
  var STYLE_NOTES = {
    strip: "The speed and a row of tiles. Swipe the row for more.",
    big: "The speed on a gauge and your first three tiles, large.",
    mini: "The speed and your first tile, tucked into a corner."
  };
  var LIMIT = { strip: 99, big: 3, mini: 1 };

  /* Every tile the dashboard can show. `modes` says which rides produce a
     value for it; `labels` overrides the label per ride where the same
     reading means something different ("Sky ahead" is the next checkpoint,
     "Sky here" is where you are). The order here is the default order. */
  var PODS = [
    { id: "left",     label: "Left",     modes: "nav",      hint: "distance still to go" },
    { id: "arrive",   label: "Arrive",   modes: "nav",      hint: "live arrival time" },
    { id: "time",     label: "Time",     modes: "nav",      hint: "riding time left" },
    { id: "distance", label: "Distance", modes: "free",     hint: "ridden so far" },
    { id: "elapsed",  label: "Elapsed",  modes: "nav free", hint: "since you set off" },
    { id: "moving",   label: "Moving",   modes: "free",     hint: "time actually moving" },
    { id: "sky",      label: "Sky",      labels: { nav: "Sky ahead", free: "Sky here" }, modes: "nav free",
      hint: "the forecast you are riding into" },
    { id: "rain",     label: "Rain",     modes: "nav free", hint: "when the next rain arrives" },
    { id: "wind",     label: "Wind",     modes: "nav free", hint: "where it hits you, and how hard" },
    { id: "average",  label: "Average",  modes: "nav free", hint: "average while moving" },
    { id: "top",      label: "Top",      modes: "nav free", hint: "top speed this ride" },
    { id: "elev",     label: "Elev",     modes: "nav free", hint: "height above the sea" },
    { id: "grade",    label: "Grade",    modes: "nav",      hint: "how steep the road is here" },
    { id: "climb",    label: "Climb",    modes: "free",     hint: "total climbed this ride" },
    { id: "sun",      label: "Sun",      labels: { nav: "Sunset", free: "Sunset" }, modes: "nav free",
      hint: "the next sunset or sunrise" },
    { id: "traffic",  label: "Traffic",  modes: "nav free", hint: "how busy this hour usually is" },
    { id: "heading",  label: "Heading",  modes: "nav free", hint: "the way you are pointing" },
    { id: "clock",    label: "Clock",    modes: "nav free", hint: "the time now" },
    { id: "battery",  label: "Battery",  modes: "nav free", hint: "this phone, where it will say" },
    { id: "gps",      label: "GPS",      modes: "nav free", hint: "how good the fix is" }
  ];

  /* What a rider gets before choosing anything: the dashboard each ride
     type always had, with Rain and Wind joining right after the sky. */
  var DEFAULTS = {
    nav: ["left", "arrive", "time", "sky", "rain", "wind", "elapsed", "average", "elev", "grade", "traffic", "gps"],
    free: ["distance", "elapsed", "moving", "average", "top", "sky", "rain", "wind", "elev", "climb", "traffic", "gps"]
  };

  var ALERT_KMH = [30, 40, 50, 60, 70, 80, 90, 100, 110, 120];
  var ALERT_MPH = [20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75];

  var cfg = null;
  var bridge = null;
  var mode = null;               // "nav" | "free" | null
  var podKeys = "";
  var podEls = {};
  var shown = null;              // the number on the speedometer right now
  var tween = null;
  var over = false;
  var editMode = "nav";          // which ride's tiles the chooser is showing
  var lastValues = null;         // the last fix's tiles, to redraw a new style at once
  var lastSpeed = null;

  function byId(id) {
    for (var i = 0; i < PODS.length; i++) if (PODS[i].id === id) return PODS[i];
    return null;
  }

  function inMode(p, m) { return (" " + p.modes + " ").indexOf(" " + m + " ") > -1; }

  function defaults(m) { return (DEFAULTS[m] || []).slice(); }

  function load() {
    var s = RC.store.get("hud", null) || {};
    cfg = {
      style: STYLES.indexOf(s.style) > -1 ? s.style : "strip",
      pods: { nav: clean(s.pods && s.pods.nav, "nav"), free: clean(s.pods && s.pods.free, "free") },
      alertKmh: typeof s.alertKmh === "number" && s.alertKmh > 0 ? s.alertKmh : 0
    };
  }

  // A stored list may name a tile that no longer exists; it is dropped
  // rather than drawn as an empty box.
  function clean(list, m) {
    if (!list || !list.length) return defaults(m);
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var p = byId(list[i]);
      if (p && inMode(p, m) && out.indexOf(p.id) < 0) out.push(p.id);
    }
    return out;
  }

  function persist() { RC.store.set("hud", cfg); }

  function labelOf(p, m) { return (p.labels && p.labels[m]) || p.label; }

  function units() { return bridge && bridge.units ? bridge.units() : "metric"; }

  function calm() {
    if (RC.power && RC.power.saving()) return true;
    try {
      if (global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches) return true;
      if (document.visibilityState === "hidden") return true;
    } catch (e) {}
    return false;
  }

  /* ---------------------------------------------------------
     The tiles
     --------------------------------------------------------- */
  function visible() {
    if (!mode) return [];
    var ids = cfg.pods[mode] || [];
    return ids.slice(0, LIMIT[cfg.style] || 99);
  }

  function renderPods(values) {
    var wrap = RC.el("hud-pods");
    if (!wrap) return;
    var ids = visible();
    var keys = cfg.style + "|" + ids.join("|");
    /* Rebuilt only when the SET changes; otherwise values are written in
       place. Rebuilding ten elements four times a second under a moving map
       is how a dashboard starts dropping frames. */
    if (keys !== podKeys) {
      var html = "";
      for (var i = 0; i < ids.length; i++) {
        var p = byId(ids[i]);
        html += '<div class="rc-pod" data-k="' + p.id + '" style="--i:' + i + '">' +
                  '<span class="rc-pod-k">' + RC.escapeHtml(labelOf(p, mode)) + "</span>" +
                  '<span class="rc-pod-v"></span>' +
                "</div>";
      }
      wrap.innerHTML = html;
      podKeys = keys;
      podEls = {};
      var nodes = wrap.querySelectorAll(".rc-pod");
      for (var n = 0; n < nodes.length; n++) {
        podEls[nodes[n].getAttribute("data-k")] = {
          pod: nodes[n], k: nodes[n].querySelector(".rc-pod-k"), v: nodes[n].querySelector(".rc-pod-v"),
          last: null, cls: ""
        };
      }
      if (bridge && bridge.onLayout) bridge.onLayout();
    }
    for (var j = 0; j < ids.length; j++) {
      var el = podEls[ids[j]];
      if (!el) continue;
      var def = values[ids[j]] || {};
      var body = def.html != null ? "h:" + def.html : "t:" + (def.v == null ? "—" : def.v);
      if (body !== el.last) {
        el.last = body;
        if (def.html != null) el.v.innerHTML = def.html;
        else el.v.textContent = def.v == null ? "—" : def.v;
      }
      if (def.label && el.k.textContent !== def.label) el.k.textContent = def.label;
      var cls = "rc-pod" + (def.level ? " is-" + def.level : "");
      if (cls !== el.cls) { el.cls = cls; el.pod.className = cls; }
    }
  }

  /* ---------------------------------------------------------
     The speedometer
     --------------------------------------------------------- */
  function writeSpeed(v) {
    var el = RC.el("hud-speed");
    if (!el) return;
    var txt = String(Math.round(v));
    if (el.textContent !== txt) el.textContent = txt;
  }

  /* The number rolls to the new speed instead of jumping — over less than
     half a second, and only while there is somebody to see it. A step of
     forty is a GPS glitch or a stop, and is shown as it is. */
  function rollTo(v) {
    if (tween) { cancelTween(); }
    if (shown == null || calm() || Math.abs(v - shown) > 40 || !global.requestAnimationFrame) {
      shown = v;
      writeSpeed(v);
      return;
    }
    var from = shown, t0 = 0, DUR = 420;
    tween = { id: 0 };
    var me = tween;
    function step(ts) {
      if (tween !== me) return;
      if (!t0) t0 = ts;
      var k = Math.min(1, (ts - t0) / DUR);
      var e = 1 - Math.pow(1 - k, 3);
      shown = from + (v - from) * e;
      writeSpeed(shown);
      if (k < 1) me.id = global.requestAnimationFrame(step);
      else tween = null;
    }
    me.id = global.requestAnimationFrame(step);
  }

  function cancelTween() {
    if (tween && global.cancelAnimationFrame) { try { global.cancelAnimationFrame(tween.id); } catch (e) {} }
    tween = null;
  }

  function gauge(kmh) {
    var fill = RC.el("hud-gauge");
    if (!fill) return;
    var top = cfg.alertKmh > 0 ? cfg.alertKmh * 1.25 : 140;
    var f = kmh == null ? 0 : RC.clamp(kmh / top, 0, 1);
    // The arc is three quarters of a circle; 100 is its whole length (pathLength).
    fill.style.strokeDashoffset = (75 - f * 75).toFixed(1);
  }

  function limitText(kmh) {
    return units() === "imperial" ? Math.round(kmh / 1.609344) + " miles an hour" : Math.round(kmh) + " kilometres an hour";
  }

  function alertCheck(kmh) {
    var box = RC.el("hud-speed-box");
    var lim = cfg.alertKmh;
    var now = over;
    // Two thresholds, or a speed sitting on the limit flickers red and white.
    if (!lim || kmh == null) now = false;
    else if (!over && kmh > lim + 1) now = true;
    else if (over && kmh < lim - 2) now = false;
    if (now === over) return;
    over = now;
    if (box) box.setAttribute("data-over", over ? "yes" : "no");
    if (over && RC.guide) RC.guide.speeding(limitText(lim));
  }

  function renderSpeed(kmh) {
    var el = RC.el("hud-speed");
    var unit = RC.el("hud-speed-unit");
    if (!el) return;
    var u = units();
    if (unit) unit.textContent = u === "imperial" ? "mph" : "km/h";
    if (kmh == null) {
      cancelTween();
      shown = null;
      el.textContent = "no fix";
      el.setAttribute("data-empty", "yes");
      gauge(null);
      alertCheck(null);
      return;
    }
    el.removeAttribute("data-empty");
    rollTo(u === "imperial" ? kmh / 1.609344 : kmh);
    gauge(kmh);
    alertCheck(kmh);
  }

  /* ---------------------------------------------------------
     Holding the dashboard opens its settings
     --------------------------------------------------------- */
  function wireHold() {
    var hud = RC.el("hud");
    if (!hud) return;
    var timer = null, start = null;
    function clear() { if (timer) { clearTimeout(timer); timer = null; } start = null; hud.classList.remove("is-holding"); }
    hud.addEventListener("pointerdown", function (e) {
      if (e.button != null && e.button !== 0) return;
      start = { x: e.clientX, y: e.clientY };
      hud.classList.add("is-holding");
      timer = setTimeout(function () {
        timer = null;
        hud.classList.remove("is-holding");
        if (RC.guide) RC.guide.buzz(30);
        if (bridge && bridge.openSettings) bridge.openSettings();
      }, 650);
    });
    hud.addEventListener("pointermove", function (e) {
      // A swipe along the tiles is scrolling them, not holding.
      if (start && (Math.abs(e.clientX - start.x) > 10 || Math.abs(e.clientY - start.y) > 10)) clear();
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach(function (ev) { hud.addEventListener(ev, clear); });
    hud.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  }

  /* ---------------------------------------------------------
     The chooser, in the You tab
     --------------------------------------------------------- */
  var UP_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6.5 14.5 5.5-5.5 5.5 5.5"/></svg>';

  function renderSettings() {
    var segs = document.querySelectorAll("[data-hud-style]");
    for (var i = 0; i < segs.length; i++) {
      segs[i].setAttribute("aria-pressed", segs[i].getAttribute("data-hud-style") === cfg.style ? "true" : "false");
    }
    var note = RC.el("hud-style-note");
    if (note) note.textContent = STYLE_NOTES[cfg.style];

    var tabs = document.querySelectorAll("[data-hud-mode]");
    for (var t = 0; t < tabs.length; t++) {
      tabs[t].setAttribute("aria-pressed", tabs[t].getAttribute("data-hud-mode") === editMode ? "true" : "false");
    }

    var list = RC.el("hud-pod-list");
    if (list) {
      var on = cfg.pods[editMode];
      var limit = LIMIT[cfg.style] || 99;
      var html = "";
      var rows = on.concat(PODS.filter(function (p) { return inMode(p, editMode) && on.indexOf(p.id) < 0; })
                               .map(function (p) { return p.id; }));
      for (var r = 0; r < rows.length; r++) {
        var p = byId(rows[r]);
        var idx = on.indexOf(p.id);
        var isOn = idx > -1;
        // Past the style's limit a tile is chosen but not shown; say so.
        var hidden = isOn && idx >= limit;
        html += '<div class="rc-podrow' + (isOn ? " is-on" : "") + (hidden ? " is-over" : "") + '">' +
          '<label class="rc-podrow-main">' +
            '<input type="checkbox" data-pod="' + p.id + '"' + (isOn ? " checked" : "") + " />" +
            '<span class="rc-podrow-text"><b>' + RC.escapeHtml(labelOf(p, editMode)) + "</b>" +
            "<i>" + RC.escapeHtml(hidden ? "chosen — past what this style shows" : p.hint) + "</i></span>" +
          "</label>" +
          (isOn && idx > 0
            ? '<button type="button" class="rc-podrow-up" data-pod-up="' + p.id + '" aria-label="Move ' +
              RC.escapeHtml(labelOf(p, editMode)) + ' earlier" title="Earlier">' + UP_SVG + "</button>"
            : '<span class="rc-podrow-up is-blank" aria-hidden="true"></span>') +
        "</div>";
      }
      list.innerHTML = html;
    }

    var sel = RC.el("speed-alert");
    if (sel) {
      var u = units();
      var opts = u === "imperial" ? ALERT_MPH : ALERT_KMH;
      var toKmh = u === "imperial" ? 1.609344 : 1;
      var best = "0", bestGap = Infinity;
      var oh = '<option value="0">Never</option>';
      for (var o = 0; o < opts.length; o++) {
        var kmh = Math.round(opts[o] * toKmh * 10) / 10;
        oh += '<option value="' + kmh + '">' + opts[o] + (u === "imperial" ? " mph" : " km/h") + "</option>";
        var gap = Math.abs(kmh - cfg.alertKmh);
        if (cfg.alertKmh > 0 && gap < bestGap) { bestGap = gap; best = String(kmh); }
      }
      sel.innerHTML = oh;
      sel.value = best;
    }
  }

  function wireSettings() {
    var panel = RC.el("dash-panel");
    if (!panel) return;
    panel.addEventListener("click", function (e) {
      var s = e.target.closest ? e.target.closest("[data-hud-style]") : null;
      if (s) { api.setStyle(s.getAttribute("data-hud-style")); return; }
      var m = e.target.closest ? e.target.closest("[data-hud-mode]") : null;
      if (m) { editMode = m.getAttribute("data-hud-mode"); renderSettings(); return; }
      var up = e.target.closest ? e.target.closest("[data-pod-up]") : null;
      if (up) {
        var id = up.getAttribute("data-pod-up");
        var list = cfg.pods[editMode], i = list.indexOf(id);
        if (i > 0) { list.splice(i, 1); list.splice(i - 1, 0, id); changed(); }
      }
    });
    panel.addEventListener("change", function (e) {
      var box = e.target;
      if (box && box.getAttribute && box.getAttribute("data-pod")) {
        var id = box.getAttribute("data-pod"), list = cfg.pods[editMode];
        var at = list.indexOf(id);
        if (box.checked && at < 0) list.push(id);
        if (!box.checked && at > -1) list.splice(at, 1);
        changed();
        return;
      }
      if (box && box.id === "speed-alert") {
        cfg.alertKmh = parseFloat(box.value) || 0;
        persist();
        over = false;
        var sb = RC.el("hud-speed-box");
        if (sb) sb.setAttribute("data-over", "no");
      }
    });
  }

  /* A choice made mid-ride shows at once, from the last fix's values,
     rather than on the next fix a second later. */
  function changed() {
    persist();
    podKeys = "";
    renderSettings();
    if (mode && lastValues) renderPods(lastValues);
    if (bridge && bridge.onChange) bridge.onChange();
  }

  var api = {
    init: function (b) {
      bridge = b || {};
      load();
      var hud = RC.el("hud");
      if (hud) hud.setAttribute("data-style", cfg.style);
      document.documentElement.setAttribute("data-hud", cfg.style);
      wireHold();
      wireSettings();
      renderSettings();
    },

    /** "nav", "free" or null — which ride's tiles are on the screen. */
    setMode: function (m) {
      mode = m === "nav" || m === "free" ? m : null;
      podKeys = "";
      lastValues = null;
      over = false;
      shown = null;
      cancelTween();
      var box = RC.el("hud-speed-box");
      if (box) box.setAttribute("data-over", "no");
    },

    /** One fix's worth: the speed, and every tile's value for this mode. */
    render: function (speedKmh, values) {
      lastValues = values || {};
      lastSpeed = speedKmh;
      renderSpeed(speedKmh);
      renderPods(lastValues);
    },

    style: function () { return cfg.style; },
    setStyle: function (s) {
      if (STYLES.indexOf(s) < 0) return cfg.style;
      cfg.style = s;
      var hud = RC.el("hud");
      if (hud) hud.setAttribute("data-style", s);
      document.documentElement.setAttribute("data-hud", s);
      changed();
      return s;
    },

    pods: function (m) { return (cfg.pods[m] || []).slice(); },
    setPods: function (m, ids) {
      if (!cfg.pods[m]) return [];
      cfg.pods[m] = clean(ids, m);
      changed();
      return cfg.pods[m].slice();
    },

    alertKmh: function () { return cfg.alertKmh; },
    isOver: function () { return over; },

    renderSettings: renderSettings,
    // Units changed: the alert list is in the rider's units.
    refresh: function () { renderSettings(); podKeys = ""; },

    PODS: PODS,
    STYLES: STYLES
  };

  return api;
})(typeof window !== "undefined" ? window : globalThis);
