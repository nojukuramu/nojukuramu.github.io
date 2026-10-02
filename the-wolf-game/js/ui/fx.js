/* fx.js — the moments, as opposed to the weather.
 *
 * The sky and the village are ambient: they move all the time and nobody is
 * meant to watch them. This file is for the handful of things that happen
 * *once* and ought to land — a phase turning over, a card being dealt, a game
 * being won — and for the rule that keeps everything else from happening more
 * than once.
 *
 *   once(key)     The host rebuilds the whole stage whenever the state moves,
 *                 and a guest rebuilds it whenever a snapshot lands. An
 *                 entrance animation written straight into the markup plays
 *                 again on every one of those, which reads as the page
 *                 refreshing itself under you. Every entrance in the app asks
 *                 this first, keyed by what it is entering (a phase, a round,
 *                 a seat), so it plays the first time and never again.
 *
 *   titleCard()   The phase turning over, said once in big letters across the
 *                 middle of the screen and gone again in two seconds. It sits
 *                 on top of the sweep app.js already throws, and like the sweep
 *                 it takes no input and never blocks a tap.
 *
 *   burst()       Confetti, lifted from karaokenatin/js/fx.js, which took the
 *                 shape from pwg's "confetti burst": one element per piece, a
 *                 CSS animation that reads its path from custom properties, and
 *                 the element removing itself when it lands. What changed is
 *                 the palette, which here is the winning side's colour rather
 *                 than a party, and `rain`, because a wolf victory should come
 *                 down from above rather than be fired up from the corners.
 *
 * Everything here is skipped outright when motion is off — the information is
 * already on screen in the phase bar and the cards, and this is only the
 * flourish on top of it.
 */
(function (global) {
  "use strict";
  var WG = (global.WG = global.WG || {});
  var doc = global.document;

  function reduced() {
    return doc.documentElement.getAttribute("data-motion") === "off" ||
      !!(global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  /* ---------------- once ---------------- */

  var seen = {};
  /** True the first time `key` is asked about, false every time after. */
  function once(key) {
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  }
  /** `cls` the first time `key` is asked about, "" after — for class lists. */
  function enter(cls, key) { return once(key) ? " " + cls : ""; }

  /* ---------------- the title card ---------------- */

  var card = null, cardTimer = null;

  /**
   * opts: { title, sub, icon (a node), tone: "night" | "day" | a team id }
   * A second card arriving while one is up replaces it rather than stacking —
   * a host skipping through phases should see the last one, not a queue.
   */
  function titleCard(opts) {
    if (reduced() || !doc.body) return;
    if (card) { card.remove(); clearTimeout(cardTimer); }
    var tone = opts.tone || "night";
    var root = doc.createElement("div");
    root.className = "title-card tc-" + tone;
    root.setAttribute("aria-hidden", "true");
    var band = doc.createElement("div");
    band.className = "tc-band";
    if (opts.icon) {
      var ic = doc.createElement("div");
      ic.className = "tc-icon";
      ic.appendChild(opts.icon);
      band.appendChild(ic);
    }
    var h = doc.createElement("div");
    h.className = "tc-title";
    h.textContent = opts.title || "";
    band.appendChild(h);
    var rule = doc.createElement("i");
    rule.className = "tc-rule";
    band.appendChild(rule);
    if (opts.sub) {
      var s = doc.createElement("div");
      s.className = "tc-sub";
      s.textContent = opts.sub;
      band.appendChild(s);
    }
    root.appendChild(band);
    doc.body.appendChild(root);
    card = root;
    // animationend is the tidy way out, the timer is the one that always fires
    // — a backgrounded tab can skip the event entirely.
    cardTimer = setTimeout(function () { if (root.parentNode) root.remove(); if (card === root) card = null; }, 2900);
  }

  /* ---------------- confetti ---------------- */

  /* Each side's own colour, a lighter and a darker step of it, and one neutral
   * so the burst does not read as a single flat sheet. */
  var PALETTES = {
    village:  ["#7cb0d0", "#2f6484", "#cfe2f2", "#f2c37c", "#ffffff"],
    werewolf: ["#9e211a", "#e0796f", "#5c1410", "#2a0c0a", "#c4473c"],
    cult:     ["#b294d6", "#7a5896", "#e4d6f2", "#3f2a55", "#f2c37c"],
    solo:     ["#d8b969", "#96762a", "#fff1c6", "#6b5418", "#ffffff"],
    pandemic: ["#9bbf6a", "#5e7d3a", "#d6e8b8", "#2f4020", "#ffffff"]
  };

  function rand(a, b) { return a + Math.random() * (b - a); }

  function layer(host) {
    var l = host.querySelector(":scope > .fx-layer");
    if (!l) {
      l = doc.createElement("div");
      l.className = "fx-layer" + (host === doc.body ? " fx-fixed" : "");
      l.setAttribute("aria-hidden", "true");
      host.appendChild(l);
    }
    return l;
  }

  /**
   * Throw `count` pieces from a point inside `host` (fractions of its size).
   * `aim` is the arc they are thrown across, in multiples of PI: the default
   * is the upper half, and [0.05, 0.95] throws downward for a fall from above.
   */
  function burst(host, opts) {
    if (!host || reduced()) return;
    opts = opts || {};
    var box = host === doc.body
      ? { width: global.innerWidth, height: global.innerHeight }
      : host.getBoundingClientRect();
    if (!box.width || !box.height) return;
    var colours = opts.colours || PALETTES[opts.team] || PALETTES.village;
    var l = layer(host);
    var count = opts.count || 80;
    var ox = (opts.x === undefined ? 0.5 : opts.x) * box.width;
    var oy = (opts.y === undefined ? 0.42 : opts.y) * box.height;
    var spread = opts.spread || Math.min(box.width, 900) * 0.55;
    var frag = doc.createDocumentFragment();

    for (var i = 0; i < count; i++) {
      var p = doc.createElement("i");
      var round = Math.random() < 0.3;
      p.className = "confetti" + (round ? " confetti-dot" : "");
      var aim = opts.aim || [-0.95, -0.05];
      var angle = rand(Math.PI * aim[0], Math.PI * aim[1]);
      var power = rand(0.35, 1) * spread;
      var dur = rand(1.6, 2.8) * (opts.slow || 1);
      p.style.left = (opts.wide ? rand(0, box.width) : ox) + "px";
      p.style.top = oy + "px";
      p.style.background = colours[i % colours.length];
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

  /** Two cannons from the bottom corners, for a side that won by surviving. */
  function cannons(host, team, count) {
    var n = Math.round((count || 140) / 2);
    var reach = (host === doc.body ? global.innerHeight : host.getBoundingClientRect().height) * 1.1;
    burst(host, { team: team, x: 0.04, y: 1, count: n, spread: reach, aim: [-0.46, -0.22] });
    burst(host, { team: team, x: 0.96, y: 1, count: n, spread: reach, aim: [-0.78, -0.54] });
  }

  /** A fall from the top edge, for a side that won by killing. */
  function rain(host, team, count) {
    burst(host, { team: team, y: -0.02, wide: true, count: count || 110, spread: 60,
                  aim: [0.3, 0.7], stagger: 1.4, slow: 1.5 });
  }

  WG.fx = {
    reduced: reduced, once: once, enter: enter,
    titleCard: titleCard, burst: burst, cannons: cannons, rain: rain
  };
})(typeof window !== "undefined" ? window : globalThis);
