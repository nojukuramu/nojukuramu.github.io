/* fx.js — confetti, and nothing else that needs a canvas.
 *
 * The shape is pwg's "confetti burst" (pwg/static/css/pwg.css, .burst): one
 * absolutely placed element per piece, a CSS animation that reads its path
 * from custom properties, and the element removing itself when it lands. pwg
 * throws emoji; this repository draws no emoji, so the pieces are small
 * coloured paper strips and circles instead, and they fall rather than fade
 * — confetti that goes up and never comes down reads as a firework.
 *
 * A canvas would allow more pieces, but a karaoke card never needs more than
 * a couple of hundred, the DOM version survives fullscreen with no resize
 * handling, and it costs nothing when nobody is celebrating.
 */
(function (global) {
  "use strict";

  var KN = (global.KN = global.KN || {});

  // The dark theme's neon, plus the gold the scores already use.
  var COLOURS = ["#ff4fa6", "#b36bff", "#7c4dff", "#f5c451", "#4fd6a2", "#ffffff", "#ff7cc0"];

  function reducedMotion() {
    return !!(global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  function rand(a, b) { return a + Math.random() * (b - a); }

  /** The layer pieces fly in: one per host element, created on first use. */
  function layer(host) {
    var l = host.querySelector(":scope > .fx-layer");
    if (!l) {
      l = document.createElement("div");
      // On the page itself it has to follow the viewport, not the document.
      l.className = "fx-layer" + (host === document.body ? " fx-fixed" : "");
      l.setAttribute("aria-hidden", "true");
      host.appendChild(l);
    }
    return l;
  }

  /**
   * Throw `count` pieces from a point inside `host` (fractions of its size;
   * the default is the middle, a little above centre). `spread` is how wide
   * the throw goes in pixels; pieces rise, turn, and then fall off the bottom.
   */
  function confetti(host, opts) {
    if (!host || reducedMotion()) return;
    opts = opts || {};
    var box = host === document.body
      ? { width: global.innerWidth, height: global.innerHeight }
      : host.getBoundingClientRect();
    if (!box.width || !box.height) return;
    var l = layer(host);
    var count = opts.count || 80;
    var ox = (opts.x === undefined ? 0.5 : opts.x) * box.width;
    var oy = (opts.y === undefined ? 0.42 : opts.y) * box.height;
    var spread = opts.spread || Math.min(box.width, 900) * 0.55;
    var frag = document.createDocumentFragment();

    for (var i = 0; i < count; i++) {
      var p = document.createElement("i");
      var round = Math.random() < 0.3;
      p.className = "confetti" + (round ? " confetti-dot" : "");
      var aim = opts.aim || [-0.95, -0.05];                  // upward half
      var angle = rand(Math.PI * aim[0], Math.PI * aim[1]);
      var power = rand(0.35, 1) * spread;
      var dur = rand(1.6, 2.8);
      p.style.left = ox + "px";
      p.style.top = oy + "px";
      p.style.background = COLOURS[i % COLOURS.length];
      p.style.setProperty("--cx", (Math.cos(angle) * power).toFixed(1) + "px");
      p.style.setProperty("--cy", (Math.sin(angle) * power * 0.8).toFixed(1) + "px");
      p.style.setProperty("--fall", (box.height - oy + 60).toFixed(0) + "px");
      p.style.setProperty("--drift", rand(-60, 60).toFixed(0) + "px");
      p.style.setProperty("--spin", rand(-900, 900).toFixed(0) + "deg");
      p.style.setProperty("--dur", dur.toFixed(2) + "s");
      p.style.animationDelay = rand(0, opts.stagger || 0.12).toFixed(2) + "s";
      p.addEventListener("animationend", function () { this.remove(); });
      frag.appendChild(p);
    }
    l.appendChild(frag);
  }

  /** Two cannons from the bottom corners — for the scores worth a cheer. */
  function cannons(host, count) {
    var n = Math.round((count || 140) / 2);
    var reach = (host === document.body ? global.innerHeight : host.getBoundingClientRect().height) * 1.1;
    confetti(host, { x: 0.04, y: 1, count: n, spread: reach, aim: [-0.46, -0.22] });
    confetti(host, { x: 0.96, y: 1, count: n, spread: reach, aim: [-0.78, -0.54] });
  }

  /** Clear any pieces still flying — a card being taken down mid-burst. */
  function clear(host) {
    var l = host && host.querySelector(":scope > .fx-layer");
    if (l) l.innerHTML = "";
  }

  KN.fx = { confetti: confetti, cannons: cannons, clear: clear };
})(typeof window !== "undefined" ? window : globalThis);
