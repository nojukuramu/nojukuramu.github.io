/* theme.js — the room's colour is a readout of the clock.
 *
 * Two jobs. The first is the ordinary one: light, dark or follow the system,
 * remembered across visits and applied before first paint (index.html has the
 * inline half of that).
 *
 * The second is the reason this file exists. Every phase in data/game_flow.json
 * names where the sun is when it starts and where it is when it ends, and this
 * paints the blend, continuously, for as long as the phase runs. A five-minute
 * discussion really does start in morning light and end at noon; voting runs
 * noon to dusk; the verdict drops into night and the night comes back up to
 * dawn. Nobody has to be told the phase is nearly over — the room is already
 * getting dark.
 *
 * The blend is applied to the *whole* base palette, not just a backdrop, which
 * is what stops it reading as a coloured overlay on a white app. Surfaces,
 * lines and ink all move together, so a night screen is a genuinely dark
 * interface rather than a light one behind a filter — and both modes stay
 * inside the same Ash Blue family the whole way round.
 */
(function (global) {
  "use strict";
  var WG = (global.WG = global.WG || {});
  var doc = global.document;

  var KEY = "wg.theme";
  var MOTION = "wg.motion";

  /* The base palette, mirrored from css/theme.css. It lives in both places on
   * purpose: the CSS is what the page looks like with no JavaScript, and this
   * is what gets blended. They are checked against each other by tools/. */
  var BASE = {
    light: {
      bg: "#eaeff4", "bg-2": "#f7fafc", "bg-3": "#dfe7ee", "bg-4": "#d0dae4",
      line: "#c6d2dd", "line-2": "#adbdcc",
      ink: "#141d26", "ink-2": "#4d5f70", "ink-3": "#7a8c9b",
      accent: "#2f6484", "accent-2": "#4a86a8", "accent-ink": "#ffffff"
    },
    dark: {
      bg: "#10161c", "bg-2": "#171f27", "bg-3": "#1e2833", "bg-4": "#27333f",
      line: "#2a3540", "line-2": "#3b4a58",
      ink: "#e9eff4", "ink-2": "#a4b4c2", "ink-3": "#71838f",
      accent: "#7cb0d0", "accent-2": "#9dc6de", "accent-ink": "#0d1319"
    }
  };

  /* How far each token is allowed to be dragged towards the sky. Surfaces move
   * a lot — that is the effect. Ink barely moves, because text that drifts with
   * the light is text you cannot read at dusk. */
  var PULL = {
    bg: 0.92, "bg-2": 0.72, "bg-3": 0.80, "bg-4": 0.66,
    line: 0.55, "line-2": 0.45,
    ink: 0.10, "ink-2": 0.16, "ink-3": 0.22,
    accent: 0.10, "accent-2": 0.10, "accent-ink": 0.0
  };

  var mode = "system";
  var current = null;      // the sky we last painted
  var raf = null;
  var source = null;       // () => state, set by the app

  function hex2(h) {
    h = String(h || "").trim();
    if (h.length === 4) h = "#" + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
    return [parseInt(h.slice(1, 3), 16) || 0, parseInt(h.slice(3, 5), 16) || 0, parseInt(h.slice(5, 7), 16) || 0];
  }
  function toHex(c) {
    return "#" + c.map(function (v) {
      var s = Math.max(0, Math.min(255, Math.round(v))).toString(16);
      return s.length < 2 ? "0" + s : s;
    }).join("");
  }
  function mix(a, b, t) {
    var x = hex2(a), y = hex2(b);
    return toHex([0, 1, 2].map(function (i) { return x[i] + (y[i] - x[i]) * t; }));
  }

  /* ---------------- light / dark ---------------- */

  function prefersDark() {
    return !!(global.matchMedia && global.matchMedia("(prefers-color-scheme: dark)").matches);
  }
  function resolved() { return mode === "system" ? (prefersDark() ? "dark" : "light") : mode; }

  function setMode(next) {
    mode = next === "light" || next === "dark" ? next : "system";
    try { localStorage.setItem(KEY, mode); } catch (e) { /* private window */ }
    if (mode === "system") doc.documentElement.removeAttribute("data-theme");
    else doc.documentElement.setAttribute("data-theme", mode);
    current = null;                 // force a repaint in the new family
    paint();
    fire();
  }

  function cycle() {
    setMode(mode === "system" ? "light" : mode === "light" ? "dark" : "system");
    return mode;
  }

  function setMotion(on) {
    try { localStorage.setItem(MOTION, on ? "on" : "off"); } catch (e) { /* ignore */ }
    if (on) doc.documentElement.removeAttribute("data-motion");
    else doc.documentElement.setAttribute("data-motion", "off");
  }

  var listeners = [];
  function onChange(fn) { listeners.push(fn); }
  function fire() { listeners.forEach(function (f) { try { f(mode, resolved()); } catch (e) { /* ignore */ } }); }

  /* ---------------- the sky ---------------- */

  /** The app hands us a function that returns the live game state, or null. */
  function follow(fn) { source = fn; start(); }

  function paint() {
    var root = doc.documentElement;
    var m = resolved();
    var state = source && source();
    var enabled = !state || !state.config || !state.config.look || state.config.look.timeOfDayTheme !== false;

    var sky;
    if (state && state.phase && enabled && WG.clock && WG.clock.sky) {
      sky = WG.clock.skyAt(state, m);
    } else {
      // No game running: sit at the stop that matches the plain theme, so the
      // home screen is the same Ash Blue as everything else rather than a
      // frozen frame of somebody's night.
      var stop = WG.clock && WG.clock.sky ? WG.clock.sky.stops[m === "dark" ? "night" : "noon"] : null;
      sky = stop ? Object.assign({}, stop[m], { mix: 0, label: "" }) : null;
    }
    if (!sky) return;

    var key = m + "|" + sky.sky1 + sky.sky2 + sky.sky3 + Math.round(sky.mix * 100);
    if (key === current) return;
    current = key;

    var base = BASE[m];
    var tint = sky.tint || sky.sky2;
    var amount = Math.max(0, Math.min(1, sky.mix || 0));

    Object.keys(base).forEach(function (token) {
      var t = amount * (PULL[token] == null ? 0.5 : PULL[token]);
      root.style.setProperty("--" + token, t <= 0 ? base[token] : mix(base[token], tint, t));
    });

    root.style.setProperty("--sky-1", sky.sky1);
    root.style.setProperty("--sky-2", sky.sky2);
    root.style.setProperty("--sky-3", sky.sky3);
    root.style.setProperty("--sky-glow", sky.glow);
    root.style.setProperty("--sky-on", sky.onSky);
    root.style.setProperty("--sky-mix", String(amount));
    root.setAttribute("data-sky", (sky.label || "").toLowerCase().replace(/\s+/g, "-"));

    // The browser chrome joins in, so a phone in standalone mode goes dark with
    // the room instead of keeping a bright bar above a midnight village.
    var meta = doc.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", getComputedStyle(root).getPropertyValue("--bg").trim() || sky.sky2);
  }

  /* One rAF loop for the whole app. It repaints only when the blend has
   * actually moved, so a paused lobby costs a comparison per frame. */
  function start() {
    if (raf) return;
    var tick = function () {
      raf = global.requestAnimationFrame(tick);
      paint();
    };
    raf = global.requestAnimationFrame(tick);
  }

  function init() {
    try { mode = localStorage.getItem(KEY) || "system"; } catch (e) { mode = "system"; }
    if (mode === "light" || mode === "dark") doc.documentElement.setAttribute("data-theme", mode);
    try { if (localStorage.getItem(MOTION) === "off") doc.documentElement.setAttribute("data-motion", "off"); }
    catch (e) { /* ignore */ }
    if (global.matchMedia) {
      var mq = global.matchMedia("(prefers-color-scheme: dark)");
      var onSys = function () { if (mode === "system") { current = null; paint(); fire(); } };
      if (mq.addEventListener) mq.addEventListener("change", onSys);
      else if (mq.addListener) mq.addListener(onSys);
    }
    paint();
    start();
  }

  WG.theme = {
    init: init, follow: follow, paint: paint,
    setMode: setMode, cycle: cycle, onChange: onChange, setMotion: setMotion,
    get mode() { return mode; },
    get resolved() { return resolved(); },
    mix: mix, BASE: BASE
  };
})(typeof window !== "undefined" ? window : globalThis);
