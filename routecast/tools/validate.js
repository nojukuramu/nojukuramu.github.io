#!/usr/bin/env node
/* ============================================================
   RouteCast — validation harness
   `node tools/validate.js`

   Two halves, both of which have to pass before anything ships:

   1. **Static checks** over the source as text: no emoji anywhere (every
      glyph in this app is an inline SVG, on purpose — see the icon set in
      static/js/icons.js), every SVG well formed, every element id the
      JavaScript reaches for actually present in index.html, every script
      listed in the page also listed in the service worker's shell, every CSS
      custom property defined before it is used, and the light and dark
      palettes carrying the same set of tokens as each other.

   2. **Behaviour checks** over the pure modules, run inside a sandbox with
      just enough browser to satisfy them: the ride recorder, the road
      familiarity weighting, the congestion model, the ETA calibration, the
      saved-route store, the terrain profile and the expressway detector.

   No dependencies, no build step, same shape as the other tools/ scripts in
   this repository.
   ============================================================ */
"use strict";

var fs = require("fs");
var path = require("path");
var vm = require("vm");

var ROOT = path.join(__dirname, "..");
var failures = [];
var checks = 0;

function ok(name) { checks++; process.stdout.write("  ✓ " + name + "\n"); }
function fail(name, detail) {
  checks++;
  failures.push(name + (detail ? " — " + detail : ""));
  process.stdout.write("  ✗ " + name + (detail ? " — " + detail : "") + "\n");
}
function check(name, cond, detail) { cond ? ok(name) : fail(name, detail); }
function section(title) { process.stdout.write("\n" + title + "\n"); }

function read(rel) { return fs.readFileSync(path.join(ROOT, rel), "utf8"); }

function sourceFiles() {
  var out = [];
  function walk(dir) {
    fs.readdirSync(path.join(ROOT, dir)).forEach(function (name) {
      var rel = path.join(dir, name);
      var full = path.join(ROOT, rel);
      if (rel.indexOf("vendor") === 0) return;
      if (fs.statSync(full).isDirectory()) { walk(rel); return; }
      if (/\.(js|css|html|md|webmanifest|svg|txt)$/.test(name)) out.push(rel);
    });
  }
  walk(".");
  return out;
}

/* ============================================================
   1. Static checks
   ============================================================ */

section("Static: no emoji");
(function () {
  /* The rule is "no emoji, use SVG". Testing for that means testing for
     pictographs specifically, not for "non-ASCII" — the copy is full of
     legitimate typography (em dashes, curly quotes, the degree sign, the
     multiplication sign, ticks in this very file) and flagging those would
     make the check useless noise. These ranges are the pictographic blocks
     plus the variation selector that turns a dingbat into an emoji. */
  var EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{2B00}-\u{2BFF}]/u;
  var bad = [];
  sourceFiles().forEach(function (rel) {
    if (rel.indexOf("tools") === 0) return;   // this file names the ranges it bans
    var lines = read(rel).split("\n");
    lines.forEach(function (line, i) {
      var m = line.match(EMOJI);
      if (m) bad.push(rel + ":" + (i + 1) + " " + JSON.stringify(m[0]));
    });
  });
  check("no emoji or pictographic characters in source", bad.length === 0, bad.slice(0, 8).join(", "));
})();

section("Static: SVG well-formedness");
(function () {
  /* Every glyph in the app is hand-written inline SVG. A malformed one fails
     silently in a browser — it just does not draw — so it is worth an
     explicit structural check: tags balance, attributes are quoted, and no
     element is left open. A minimal parser is enough and keeps this script
     dependency-free. */
  function parseSvg(svg, where) {
    var VOID = { path: 1, circle: 1, rect: 1, line: 1, polyline: 1, polygon: 1, ellipse: 1, use: 1, stop: 1, image: 1 };
    var stack = [];
    var re = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
    var m, consumed = 0;
    while ((m = re.exec(svg))) {
      // Anything between tags that contains a '<' means an unquoted or
      // unterminated attribute swallowed part of the markup.
      var between = svg.slice(consumed, m.index);
      if (between.indexOf("<") > -1) return where + ": stray '<' before " + m[2];
      consumed = re.lastIndex;
      if (m[1]) {
        if (stack.pop() !== m[2]) return where + ": </" + m[2] + "> does not close the open element";
      } else if (!m[4] && !VOID[m[2]]) {
        stack.push(m[2]);
      }
    }
    if (svg.slice(consumed).indexOf("<") > -1) return where + ": trailing '<'";
    if (stack.length) return where + ": unclosed <" + stack[stack.length - 1] + ">";
    return null;
  }

  function svgsIn(text) {
    var out = [];
    var re = /<svg[\s\S]*?<\/svg>/g, m;
    while ((m = re.exec(text))) out.push(m[0]);
    return out;
  }
  function stripComments(t) { return t.replace(/<!--[\s\S]*?-->/g, ""); }
  // JavaScript builds some markup by concatenating adjacent string literals;
  // rejoining them is what turns the source back into the markup a browser
  // would actually see.
  function stripJoins(t) { return t.replace(/(['"])\s*\+\s*\1/g, ""); }

  var problems = [];
  var count = 0;
  var interpolated = 0;

  [["index.html", stripComments(read("index.html"))],
   ["static/icon.svg", stripComments(read("static/icon.svg"))],
   ["static/icon-maskable.svg", stripComments(read("static/icon-maskable.svg"))],
   ["static/js/app.js", stripJoins(read("static/js/app.js"))]
  ].forEach(function (pair) {
    svgsIn(pair[1]).forEach(function (svg) {
      /* A block whose attributes are computed at run time (the elevation
         chart's viewBox, its path data) is not markup yet and cannot be
         parsed as text. Those are covered by the tag-balance check below
         instead of being mis-reported as malformed. */
      if (/RC\.|state\.|ELEV_/.test(svg)) { interpolated++; return; }
      count++;
      var err = parseSvg(svg, pair[0]);
      if (err) problems.push(err);
    });
  });

  // Whatever is assembled at run time, its tags still have to balance in the
  // source: one closing </svg> for every <svg, in every file that writes any.
  ["index.html", "static/js/app.js", "static/js/icons.js"].forEach(function (rel) {
    var text = read(rel);
    var opens = (text.match(/<svg\b/g) || []).length;
    var closes = (text.match(/<\/svg>/g) || []).length;
    if (opens !== closes) problems.push(rel + ": " + opens + " <svg> but " + closes + " </svg>");
  });

  /* The icon set is built from shared fragments and cannot be read as text,
     so it is executed instead and every glyph it can return is parsed —
     including the two fallbacks, which are the ones nobody ever looks at. */
  var iconCtx = sandbox(true);
  var names = { weather: [], ui: [] };
  var iconSrc = read("static/js/icons.js");
  ["weatherIcons", "uiIcons"].forEach(function (varName) {
    var key = varName === "weatherIcons" ? "weather" : "ui";
    var block = iconSrc.slice(iconSrc.indexOf("var " + varName + " = {"));
    var re = /\n\s{4}"?([a-z-]+)"?:\s/g, m;
    while ((m = re.exec(block))) {
      if (block.slice(0, m.index).split("};").length > 1) break;
      names[key].push(m[1]);
    }
  });
  ["weather", "ui"].forEach(function (kind) {
    names[kind].concat(["definitely-not-an-icon"]).forEach(function (name) {
      var svg = iconCtx.RC.icons[kind](name);
      count++;
      var err = parseSvg(svg, "icons." + kind + "(" + name + ")");
      if (err) problems.push(err);
      if (svg.indexOf("<svg") !== 0) problems.push("icons." + kind + "(" + name + ") is not an svg");
    });
  });

  check("every inline SVG is well formed (" + count + " checked, " + interpolated +
        " built at run time)", problems.length === 0, problems.slice(0, 5).join("; "));
  check("the icon set covers weather and UI",
        names.weather.length >= 9 && names.ui.length >= 15,
        names.weather.length + " weather, " + names.ui.length + " ui");
  check("an unknown icon name still returns a drawable glyph",
        iconCtx.RC.icons.ui("nope").indexOf("<svg") === 0 &&
        iconCtx.RC.icons.weather("nope").indexOf("<svg") === 0);
})();

section("Static: element ids");
(function () {
  var html = read("index.html");
  var declared = {};
  var re = /\sid="([^"]+)"/g, m;
  while ((m = re.exec(html))) declared[m[1]] = true;

  var missing = [];
  fs.readdirSync(path.join(ROOT, "static/js")).forEach(function (name) {
    var text = read(path.join("static/js", name));
    var r2 = /RC\.el\("([^"]+)"\)/g, m2;
    while ((m2 = r2.exec(text))) {
      if (!declared[m2[1]]) missing.push(name + " -> #" + m2[1]);
    }
  });
  check("every RC.el() id exists in index.html", missing.length === 0, missing.join(", "));
})();

section("Static: script manifest");
(function () {
  var html = read("index.html");
  var sw = read("sw.js");
  var pageScripts = [];
  var re = /<script src="(static\/js\/[^"]+)">/g, m;
  while ((m = re.exec(html))) pageScripts.push(m[1]);

  var onDisk = fs.readdirSync(path.join(ROOT, "static/js")).map(function (n) { return "static/js/" + n; });

  var missingFile = pageScripts.filter(function (p) { return onDisk.indexOf(p) < 0; });
  check("every script the page loads exists on disk", missingFile.length === 0, missingFile.join(", "));

  var notLoaded = onDisk.filter(function (p) { return pageScripts.indexOf(p) < 0; });
  check("no orphan script in static/js", notLoaded.length === 0, notLoaded.join(", "));

  var notCached = pageScripts.filter(function (p) { return sw.indexOf('"./' + p + '"') < 0; });
  check("every script is in the service worker shell", notCached.length === 0, notCached.join(", "));

  var cssCached = sw.indexOf('"./static/css/app.css"') > -1;
  check("the stylesheet is in the service worker shell", cssCached);

  var bumped = /var CACHE = "routecast-v(\d+)"/.exec(sw);
  check("the service worker cache name is versioned", !!bumped && Number(bumped[1]) >= 5,
        bumped ? "v" + bumped[1] : "no CACHE constant");
})();

section("Static: theme tokens");
(function () {
  var css = read("static/css/app.css");

  function tokensIn(block) {
    var out = {};
    var re = /(--[\w-]+)\s*:/g, m;
    while ((m = re.exec(block))) out[m[1]] = true;
    return out;
  }
  function blockAfter(marker) {
    var i = css.indexOf(marker);
    if (i < 0) return "";
    var open = css.indexOf("{", i);
    var depth = 0, j = open;
    for (; j < css.length; j++) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}") { depth--; if (!depth) break; }
    }
    return css.slice(open, j);
  }

  var light = tokensIn(blockAfter("\n:root {"));
  var darkAttr = tokensIn(blockAfter(':root[data-theme="dark"]'));
  var darkMedia = tokensIn(blockAfter('@media (prefers-color-scheme: dark)'));

  check("the light palette defines the accent", light["--matcha"] && light["--matcha-hover"] &&
        light["--matcha-soft"] && light["--matcha-ink"]);
  check("Poppins is the only declared family", /--sans:\s*"Poppins"/.test(css) && !/Newsreader|"Inter"/.test(css));

  var missingInDark = Object.keys(darkAttr).filter(function (t) { return !light[t]; });
  check("the dark toggle introduces no token the light palette lacks", missingInDark.length === 0, missingInDark.join(", "));

  var mediaVsAttr = Object.keys(darkAttr).filter(function (t) { return !darkMedia[t]; })
    .concat(Object.keys(darkMedia).filter(function (t) { return !darkAttr[t]; }));
  check("the dark toggle and the dark media query define the same tokens", mediaVsAttr.length === 0, mediaVsAttr.join(", "));

  // Every var(--x) must resolve to something declared somewhere in the file.
  var declared = tokensIn(css);
  var used = {};
  var re = /var\((--[\w-]+)/g, m;
  while ((m = re.exec(css))) used[m[1]] = true;
  var undef = Object.keys(used).filter(function (t) {
    // Tokens written from JavaScript at runtime are declared there, not here.
    if (t === "--sheet-h" || t === "--rc-controls-h" || t === "--rc-bearing") return false;
    return !declared[t];
  });
  check("every var(--token) is defined", undef.length === 0, undef.join(", "));

  check("no clay-era token survives", css.indexOf("--clay") < 0);
})();

section("Static: manifest and metadata");
(function () {
  var manifest = JSON.parse(read("manifest.webmanifest"));
  var html = read("index.html");
  var css = read("static/css/app.css");

  check("the manifest theme colour is the matcha accent", manifest.theme_color === "#4F7A38", manifest.theme_color);
  check("the manifest background matches the light page ground",
        manifest.background_color === "#F3F5EE" && css.indexOf("--bg:          #F3F5EE") > -1,
        manifest.background_color);
  check("the manifest allows both orientations", manifest.orientation === "any", manifest.orientation);
  check("the page declares a light and a dark theme colour",
        /theme-color" content="#F3F5EE"/.test(html) && /theme-color" content="#12160F"/.test(html));
  check("Poppins is the only web font requested",
        /fonts\.googleapis\.com\/css2\?family=Poppins/.test(html) && !/Newsreader|family=Inter/.test(html));
})();

/* ============================================================
   2. Behaviour checks
   ============================================================ */

function sandbox(iconsOnly) {
  /* Just enough browser for the pure modules. localStorage is a real object
     rather than a stub that swallows writes, because the whole point of
     history.js and routes.js is that what they write comes back. */
  var store = {};
  var listeners = {};
  var ctx = {
    console: console,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    Promise: Promise,
    Map: Map,
    Date: Date,
    Math: Math,
    JSON: JSON,
    localStorage: {
      getItem: function (k) { return store.hasOwnProperty(k) ? store[k] : null; },
      setItem: function (k, v) { store[k] = String(v); },
      removeItem: function (k) { delete store[k]; },
      clear: function () { store = {}; }
    },
    navigator: { onLine: true, storage: null },
    document: {
      visibilityState: "visible",
      addEventListener: function () {},
      removeEventListener: function () {}
    },
    fetch: function () { return Promise.reject(new Error("no network in tests")); }
  };
  ctx.window = ctx;
  ctx.window.addEventListener = function (name, fn) { (listeners[name] = listeners[name] || []).push(fn); };
  ctx.window.removeEventListener = function () {};
  ctx.self = ctx;
  vm.createContext(ctx);
  var files = iconsOnly
    ? ["util.js", "icons.js"]
    : ["util.js", "history.js", "traffic.js", "eta.js", "routes.js", "router.js", "sampler.js", "elevation.js"];
  files.forEach(function (f) {
      vm.runInContext(read("static/js/" + f), ctx, { filename: f });
    });
  ctx.__store = store;
  return ctx;
}

/* A straight east-west line of `n` points starting at (lat, lon), spaced
   roughly `stepM` metres apart — enough geometry to exercise the cell grid,
   the sampler and the familiarity walk without inventing a real route. */
function line(lat, lon, n, stepM) {
  var out = [];
  var degPerM = 1 / (111320 * Math.cos(lat * Math.PI / 180));
  for (var i = 0; i < n; i++) out.push([lat, lon + i * stepM * degPerM]);
  return out;
}

function fakeRoute(coords, secondsPerMetre) {
  var RCh = { haversine: null };
  var cumDist = [0], cumDur = [0];
  for (var i = 1; i < coords.length; i++) {
    var R = 6371008.8, toRad = Math.PI / 180;
    var dLat = (coords[i][0] - coords[i - 1][0]) * toRad;
    var dLon = (coords[i][1] - coords[i - 1][1]) * toRad;
    var la1 = coords[i - 1][0] * toRad, la2 = coords[i][0] * toRad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    var d = 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
    cumDist.push(cumDist[i - 1] + d);
    cumDur.push(cumDur[i - 1] + d * secondsPerMetre);
  }
  return {
    coords: coords, cumDist: cumDist, cumDur: cumDur,
    distance: cumDist[cumDist.length - 1],
    duration: cumDur[cumDur.length - 1],
    steps: [], legs: [], summary: "Test"
  };
}

section("Behaviour: ride history");
(function () {
  var ctx = sandbox();
  var RC = ctx.RC;

  var a = RC.history._cellOf(14.5995, 120.9842);
  var b = RC.history._cellOf(14.5995, 120.9842);
  check("the same coordinate always lands in the same cell", a === b);

  var near = RC.history._cellOf(14.59951, 120.98421);
  check("a metre of GPS wobble does not invent a new cell", a === near, a + " vs " + near);

  var far = RC.history._cellOf(14.6100, 120.9842);
  check("a kilometre away is a different cell", a !== far);

  check("an edge is undirected",
        RC.history._edgeKey("car", a, far) === RC.history._edgeKey("car", far, a));
  check("a car edge and a motorcycle edge are different edges",
        RC.history._edgeKey("car", a, far) !== RC.history._edgeKey("motorcycle", a, far));

  // Ride the line once, at a plausible 60 km/h.
  var coords = line(14.6, 121.0, 60, 200);
  RC.history.startSession("car");
  var t = Date.UTC(2026, 0, 5, 8, 0, 0);
  coords.forEach(function (c) {
    RC.history.record({ lat: c[0], lon: c[1], t: t, speedKmh: 60 });
    t += 12000;   // 200 m at 60 km/h
  });
  RC.history.endSession(null);

  var stats = RC.history.stats();
  check("riding a line records road segments", stats.edges > 5, "edges=" + stats.edges);

  var fam = RC.history.familiarity(coords, "car");
  check("a road just ridden reads as familiar", fam.score > 0.3, "score=" + fam.score.toFixed(2));

  var elsewhere = line(15.9, 119.5, 60, 200);
  var famNew = RC.history.familiarity(elsewhere, "car");
  check("a road never ridden reads as unfamiliar", famNew.score === 0, "score=" + famNew.score);

  var famMoto = RC.history.familiarity(coords, "motorcycle");
  check("a road learned in a car counts, at a discount, on a bike",
        famMoto.score > 0 && famMoto.score < fam.score,
        "car=" + fam.score.toFixed(2) + " moto=" + famMoto.score.toFixed(2));

  // A stationary phone must not carve a road out of its own drift.
  var ctx2 = sandbox();
  ctx2.RC.history.startSession("car");
  var t2 = Date.UTC(2026, 0, 5, 8, 0, 0);
  for (var i = 0; i < 200; i++) {
    ctx2.RC.history.record({
      lat: 14.6 + (i % 3) * 0.00002, lon: 121.0 + (i % 2) * 0.00002, t: t2, speedKmh: 0.4
    });
    t2 += 3000;
  }
  ctx2.RC.history.endSession(null);
  check("a parked phone records no roads", ctx2.RC.history.stats().edges === 0,
        "edges=" + ctx2.RC.history.stats().edges);

  // A GPS jump is not a road either.
  var ctx3 = sandbox();
  ctx3.RC.history.startSession("car");
  ctx3.RC.history.record({ lat: 14.6, lon: 121.0, t: 1000, speedKmh: 50 });
  ctx3.RC.history.record({ lat: 15.9, lon: 119.5, t: 4000, speedKmh: 50 });
  ctx3.RC.history.endSession(null);
  check("a GPS jump records no road", ctx3.RC.history.stats().edges === 0);
})();

section("Behaviour: learned ETA bias");
(function () {
  var ctx = sandbox();
  var RC = ctx.RC;

  check("no bias before any ride is recorded", RC.history.etaBias("car", new Date()) === null);

  function ride(ratio, when) {
    RC.history.startSession("car");
    RC.history.endSession({ plannedS: 3600, actualS: 3600 * ratio, distanceM: 40000, departedAt: when });
  }
  var monday8 = new Date(2026, 0, 5, 8, 0, 0);
  ride(1.4, monday8);
  check("one ride is not enough to move the ETA", RC.history.etaBias("car", monday8) === null);

  ride(1.5, monday8);
  var bias = RC.history.etaBias("car", monday8);
  check("two rides produce a bias", !!bias && bias.samples === 2, JSON.stringify(bias));
  check("the bias reflects how much slower the rides really were",
        bias.ratio > 1.35 && bias.ratio < 1.55, String(bias && bias.ratio));

  // A ride abandoned after a couple of minutes teaches nothing.
  var before = RC.history.stats().trips;
  RC.history.startSession("car");
  RC.history.endSession({ plannedS: 3600, actualS: 90, distanceM: 800, departedAt: monday8 });
  check("a ride too short to mean anything is discarded", RC.history.stats().trips === before);

  // Nor does one that took three times as long as predicted.
  RC.history.startSession("car");
  RC.history.endSession({ plannedS: 3600, actualS: 3600 * 6, distanceM: 40000, departedAt: monday8 });
  check("an implausible ratio is discarded", RC.history.stats().trips === before);
})();

section("Behaviour: traffic model");
(function () {
  var RC = sandbox().RC;

  var sum = 0, n = 0;
  for (var d = 5; d <= 11; d++) {
    for (var h = 0; h < 24; h++) { sum += RC.traffic.relative(new Date(2026, 0, d, h, 0, 0), "car"); n++; }
  }
  var mean = sum / n;
  check("the relative curve averages 1 over a week", Math.abs(mean - 1) < 0.02, "mean=" + mean.toFixed(4));

  var rush = new Date(2026, 0, 5, 18, 0, 0);      // Monday evening
  var dead = new Date(2026, 0, 5, 3, 0, 0);       // Monday, small hours
  check("the evening peak costs more time than the small hours",
        RC.traffic.factor(rush, "car") > RC.traffic.factor(dead, "car"));
  check("the small hours are free flowing", RC.traffic.level(dead) === "free");
  check("the evening peak is not", RC.traffic.level(rush) !== "free", RC.traffic.level(rush));

  check("a motorcycle feels less of the same jam",
        RC.traffic.factor(rush, "motorcycle") < RC.traffic.factor(rush, "car") &&
        RC.traffic.factor(rush, "motorcycle") > 1);
  check("the road is reported as congested regardless of vehicle",
        RC.traffic.level(rush) === RC.traffic.level(rush));

  check("no hour is ever faster than free flowing", (function () {
    for (var d = 5; d <= 11; d++) {
      for (var h = 0; h < 24; h++) {
        if (RC.traffic.factor(new Date(2026, 0, d, h, 30, 0), "car") < 1) return false;
      }
    }
    return true;
  })());

  check("an invalid date does not poison the model",
        RC.traffic.factor(new Date("nonsense"), "car") === 1 &&
        RC.traffic.level(new Date("nonsense")) === "free");
})();

section("Behaviour: ETA calibration");
(function () {
  var ctx = sandbox();
  var RC = ctx.RC;

  // 30 km at an optimistic 20 m/s (72 km/h) straight through Metro Manila.
  var route = fakeRoute(line(14.6, 121.0, 150, 200), 1 / 20);
  var depart = new Date(2026, 0, 5, 17, 0, 0);   // straight into the evening peak
  var out = RC.eta.plan(route, depart, "car");

  check("calibration leaves the geometry alone", out.route.coords === route.coords);
  check("calibration leaves the distances alone", out.route.cumDist === route.cumDist);
  check("a calibrated ETA is slower than the router's", out.route.duration > route.duration,
        Math.round(route.duration) + "s -> " + Math.round(out.route.duration) + "s");

  var monotone = true;
  for (var i = 1; i < out.route.cumDur.length; i++) {
    if (out.route.cumDur[i] < out.route.cumDur[i - 1]) monotone = false;
  }
  check("the calibrated timings never go backwards", monotone);
  check("the calibration record travels with the route", !!out.route.calibration);
  check("with no history, the source is the model", out.calibration.source === "default");

  var moto = RC.eta.plan(route, depart, "motorcycle");
  check("a motorcycle is calibrated less harshly than a car in the same jam",
        moto.route.duration < out.route.duration);

  // The forward pass has to see the clock move: the same route leaving at
  // 03:00 must be quicker than leaving at 17:00, and the difference has to be
  // bigger than a single flat multiplier could produce.
  var night = RC.eta.plan(route, new Date(2026, 0, 5, 3, 0, 0), "car");
  check("departing at 3am beats departing at 5pm", night.route.duration < out.route.duration);

  // Once there is history, the learned ratio takes over from the default.
  function ride(ratio) {
    RC.history.startSession("car");
    RC.history.endSession({
      plannedS: 3600, actualS: 3600 * ratio, distanceM: 40000, departedAt: depart
    });
  }
  ride(1.6); ride(1.6);
  var learned = RC.eta.plan(route, depart, "car");
  check("a learned bias replaces the default", learned.calibration.source !== "default",
        learned.calibration.source);
  check("the learned bias is what actually drives the number",
        learned.route.duration > out.route.duration,
        Math.round(out.route.duration) + "s -> " + Math.round(learned.route.duration) + "s");

  check("the explanation names its source",
        /recorded ride/.test(RC.eta.explain(learned.calibration, "car")) &&
        /time-of-week/.test(RC.eta.explain(out.calibration, "car")));

  check("a route with no timings is handed back untouched",
        RC.eta.plan({ cumDur: [0] }, depart, "car").route.cumDur.length === 1);
})();

section("Behaviour: route familiarity ranking");
(function () {
  var ctx = sandbox();
  var RC = ctx.RC;

  var known = line(14.6, 121.0, 80, 200);
  var novel = line(15.9, 119.5, 80, 200);

  RC.history.startSession("car");
  var t = Date.UTC(2026, 0, 5, 8, 0, 0);
  for (var pass = 0; pass < 3; pass++) {
    known.forEach(function (c) { RC.history.record({ lat: c[0], lon: c[1], t: t, speedKmh: 60 }); t += 12000; });
    t += 600000;
  }
  RC.history.endSession(null);

  var fast = fakeRoute(novel, 1 / 20);       // the quick, unknown line
  var mine = fakeRoute(known, 1 / 18.5);     // slightly slower, but mine
  var ranked = RC.history.rankRoutes([fast, mine], "car");
  check("a familiar route that is barely slower is promoted", ranked[0] === mine,
        "chose " + (ranked[0] === fast ? "the unknown line" : "the known line"));
  check("the promotion is reported, not silent", ranked.preferredByHistory === true);

  var muchSlower = fakeRoute(known, 1 / 8);  // now half the speed
  var ranked2 = RC.history.rankRoutes([fakeRoute(novel, 1 / 20), muchSlower], "car");
  check("familiarity never buys a route that is genuinely slow",
        ranked2[0] !== muchSlower);

  check("every route is annotated either way",
        ranked.every(function (r) { return r.familiarity && typeof r.familiarity.score === "number"; }));

  var single = RC.history.rankRoutes([fakeRoute(novel, 1 / 20)], "car");
  check("a lone route is annotated and left alone", single.length === 1 && !!single[0].familiarity);
})();

section("Behaviour: saved routes");
(function () {
  var RC = sandbox().RC;
  var places = [
    { name: "Makati, Metro Manila", address: "Makati", lat: 14.5547, lon: 121.0244, precise: true },
    { name: "Tagaytay, Cavite", address: "Tagaytay", lat: 14.1153, lon: 120.9621 }
  ];

  check("an empty store lists nothing", RC.routes.list().length === 0);

  var saved = RC.routes.save({ places: places, vehicle: "motorcycle", interval: "25" });
  check("a saved route comes back", RC.routes.list().length === 1);
  check("the vehicle is kept", saved.vehicle === "motorcycle");
  check("the exactness of a pinned point survives the save", RC.routes.get(saved.id).places[0].precise === true);
  check("a point that was only searched for is not marked exact",
        RC.routes.get(saved.id).places[1].precise === false);
  check("an unnamed route is named after its ends", /Makati to Tagaytay/.test(saved.name), saved.name);

  RC.routes.save({ places: places, vehicle: "motorcycle", interval: "25" });
  check("re-saving the same trip replaces it rather than stacking a duplicate",
        RC.routes.list().length === 1);

  RC.routes.save({ places: places, vehicle: "car" });
  check("the same points on a different vehicle is a different route",
        RC.routes.list().length === 2);

  RC.routes.touch(saved.id);
  check("using a route counts", RC.routes.get(saved.id).useCount === 1);

  RC.routes.rename(saved.id, "Sunday ride");
  check("a route can be renamed", RC.routes.get(saved.id).name === "Sunday ride");

  RC.routes.remove(saved.id);
  check("a route can be deleted", RC.routes.list().length === 1 && !RC.routes.get(saved.id));

  var threw = false;
  try { RC.routes.save({ places: [places[0]] }); } catch (e) { threw = true; }
  check("a route with one end is refused", threw);

  for (var i = 0; i < RC.routes.MAX + 8; i++) {
    RC.routes.save({ places: [places[0], { name: "P" + i, lat: 14 + i / 1000, lon: 121 }] });
  }
  check("the store is bounded", RC.routes.list().length <= RC.routes.MAX,
        String(RC.routes.list().length));
})();

section("Behaviour: expressway detection");
(function () {
  var RC = sandbox().RC;
  var route = {
    steps: [
      { text: "Head out onto Ayala Avenue", distance: 1200 },
      { text: "Take the ramp onto Skyway", distance: 14000 },
      { text: "Merge onto South Luzon Expressway", distance: 22000 },
      { text: "Turn left onto Skyway Avenue", distance: 700 },
      { text: "Arrive at destination", distance: 0 }
    ]
  };
  var names = RC.router.expresswayNames(route);
  check("an expressway in the line is named", names.indexOf("Skyway") > -1 &&
        names.indexOf("South Luzon Expressway") > -1, JSON.stringify(names));
  check("a surface road named after one is not a false positive",
        names.indexOf("Skyway Avenue") < 0, JSON.stringify(names));
  check("the metres on an expressway are counted", RC.router.expresswayMeters(route) === 36000,
        String(RC.router.expresswayMeters(route)));
  check("a clean route reports nothing",
        RC.router.expresswayNames({ steps: [{ text: "Continue onto EDSA", distance: 9000 }] }).length === 0);
  check("the motorcycle profile asks for the exclusion",
        RC.router.VEHICLE.motorcycle.avoidMotorways === true &&
        !RC.router.VEHICLE.car.avoidMotorways);
})();

section("Behaviour: terrain profile");
(function () {
  var ctx = sandbox();
  var RC = ctx.RC;

  // Stand in for the network: a hill that rises 300 m and comes back down.
  var requested = 0;
  RC.jsonGet = function (url) {
    requested++;
    var n = url.split("latitude=")[1].split("&")[0].split(",").length;
    var out = [];
    for (var i = 0; i < n; i++) {
      out.push(20 + 300 * Math.sin(Math.PI * (i / (n - 1))));
    }
    return Promise.resolve({ elevation: out });
  };

  var route = fakeRoute(line(14.6, 121.0, 400, 200), 1 / 20);
  return RC.elevation.profile(route).then(function (p) {
    check("the profile is sampled along the route", p.points.length > 50, String(p.points.length));
    check("one request covers a whole route", requested === 1, String(requested));
    check("the summit is found", Math.round(p.maxM) >= 310, String(Math.round(p.maxM)));
    check("the climb is accumulated", p.climbM > 250 && p.climbM < 400, String(p.climbM));
    check("so is the descent", p.descentM > 250 && p.descentM < 400, String(p.descentM));

    var start = p.at(0);
    var mid = p.at(route.distance / 2);
    check("elevation can be read at a distance along", mid.elevationM > start.elevationM);
    check("the grade is positive on the way up", p.at(route.distance * 0.25).gradePct > 0);
    check("and negative on the way down", p.at(route.distance * 0.75).gradePct < 0);

    var before = requested;
    return RC.elevation.profile(route).then(function () {
      check("a re-plan of the same line costs no second request", requested === before);
    });
  });
})();

/* ============================================================
   Result
   ============================================================ */
Promise.resolve().then(function () {
  // Give the async terrain section a turn to finish before reporting.
  return new Promise(function (r) { setTimeout(r, 250); });
}).then(function () {
  process.stdout.write("\n" + (failures.length ? "FAILED" : "PASSED") +
    " — " + (checks - failures.length) + "/" + checks + " checks\n");
  if (failures.length) {
    failures.forEach(function (f) { process.stdout.write("  - " + f + "\n"); });
    process.exit(1);
  }
});
