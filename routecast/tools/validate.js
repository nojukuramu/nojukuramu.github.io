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

  /* groupui.js and pubsui.js reach for elements through their own one-letter
     helpers, so the check above cannot see them — and a typo in one of those
     ids is a button that silently does nothing. The helpers all take the id
     first, and none of them is ever called as a method, which is what the
     leading guard is for (map.on("zoomend") is not an element lookup).

     Event names that happen to look like ids are the only false positive this
     can produce, so they are named rather than pattern-matched away: a list
     that has to be edited when somebody adds a listener is a list somebody
     reads. */
  var EVENT_NAMES = {
    click: 1, change: 1, keydown: 1, keyup: 1, input: 1, focus: 1, blur: 1,
    submit: 1, zoomend: 1, moveend: 1, dragstart: 1, contextmenu: 1,
    pointerdown: 1, pointerup: 1, pointermove: 1, pointercancel: 1,
    pointerenter: 1, pointerleave: 1, touchend: 1, wheel: 1, resize: 1,
    visibilitychange: 1, pageshow: 1, pagehide: 1, beat: 1, thaw: 1,
    hide: 1, show: 1, enabled: 1, open: 1, message: 1, state: 1, closed: 1
  };
  var uiMissing = [];
  ["groupui.js", "pubsui.js"].forEach(function (name) {
    var ui = read("static/js/" + name);
    var r3 = /(^|[^.\w])(?:el|on|show|text)\("([a-z][a-z0-9-]*)"/g, m3;
    while ((m3 = r3.exec(ui))) {
      if (EVENT_NAMES[m3[2]]) continue;
      if (!declared[m3[2]]) uiMissing.push(name + " -> #" + m3[2]);
    }
  });
  check("every id the UI modules reach for exists in index.html",
        uiMissing.length === 0, uiMissing.join(", "));
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

  /* The page tells the rider which version they are on and the worker decides
     which one they actually get. Those two disagreeing is a version line that
     lies, which is worse than not having one — so they are one number. */
  var pageV = /window\.RC_VERSION\s*=\s*"([^"]+)"/.exec(html);
  check("the page declares its version", !!pageV, pageV ? pageV[1] : "no RC_VERSION");
  check("the page and the service worker agree on it",
        !!pageV && !!bumped && pageV[1] === bumped[1],
        (pageV ? pageV[1] : "?") + " vs " + (bumped ? bumped[1] : "?"));

  /* An update that installs itself is the bug this whole mechanism replaces:
     skipWaiting() inside install swaps the code out from under a rider
     mid-ride. The handover must be the page's decision, which is the message
     handler — and the same word the other apps in this repository use. */
  /* Read the CODE, not the prose: the install handler carries a comment
     explaining why skipWaiting() is not there, and a check that cannot tell
     the two apart would fail on its own explanation. */
  var swCode = sw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  /* Every skipWaiting() in the worker must be the one the page asked for. A
     window-based check cannot say that — the install handler and the message
     handler are neighbours — so the test is per occurrence: each one is
     preceded by the "skip-waiting" message it answers. */
  var handovers = swCode.split("skipWaiting");
  var unasked = 0;
  for (var h = 0; h < handovers.length - 1; h++) {
    if (handovers[h].slice(-120).indexOf("skip-waiting") < 0) unasked++;
  }
  check("the service worker never takes over on its own", unasked === 0,
        unasked + " unprompted skipWaiting()");
  check("it hands over when the page asks",
        /addEventListener\("message"[\s\S]{0,160}skip-waiting[\s\S]{0,80}skipWaiting/.test(swCode));
})();

section("Static: the info sheet");
(function () {
  var html = read("index.html");
  var info = read("static/js/info.js");

  /* Every (i) in the page has to name a topic that exists, or it is a button
     that opens nothing — and the copy lives in one file precisely so that a
     rename cannot quietly orphan half of them. */
  var topics = {};
  var rt = /^\s{4}"?([a-z][a-z-]*)"?:\s*\{\s*$/gm, mt;
  while ((mt = rt.exec(info))) topics[mt[1]] = true;
  check("the registry holds topics", Object.keys(topics).length >= 8,
        Object.keys(topics).length + " found");

  var used = [];
  var ru = /data-info="([^"]+)"/g, mu;
  while ((mu = ru.exec(html))) used.push(mu[1]);
  check("the page uses the info sheet", used.length >= 8, used.length + " buttons");

  var orphan = used.filter(function (k) { return !topics[k]; });
  check("every (i) names a topic that exists", orphan.length === 0, orphan.join(", "));

  var unused = Object.keys(topics).filter(function (k) { return used.indexOf(k) < 0; });
  check("no topic is unreachable", unused.length === 0, unused.join(", "));

  /* The point of the exercise: the pane says one line and the sheet says the
     rest. A hint that has grown back into a paragraph is a regression. */
  var long = [];
  var rp = /<p class="rc-field-hint"[^>]*>([\s\S]*?)<\/p>/g, mp;
  while ((mp = rp.exec(html))) {
    var t = mp[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (t.length > 110) long.push(t.slice(0, 60) + "…");
  }
  check("no hint in the panel has grown back into a paragraph",
        long.length === 0, long.join(" | "));
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
    // --rider is each group-ride member's own colour, written onto their marker
    // by groupui.js from the room's palette; --pub is the same idea for a
    // stranger on the public road, written by pubsui.js.
    if (t === "--rider" || t === "--pub") return false;
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
    navigator: { onLine: true, storage: null, geolocation: null, wakeLock: null, mediaDevices: null },
    setInterval: function () { return 0; },
    clearInterval: function () {},
    Uint8Array: Uint8Array,
    Blob: typeof Blob === "function" ? Blob : function () {},
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
    : ["util.js", "coords.js", "history.js", "traffic.js", "eta.js", "routes.js", "marks.js",
       "router.js", "sampler.js", "elevation.js", "free.js", "rejoin.js", "qr.js",
       "peer.js", "group.js", "pubs.js"];
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

section("Behaviour: coordinate parsing");
(function () {
  var RC = sandbox().RC;
  function near(got, lat, lon) {
    return got && Math.abs(got.lat - lat) < 1e-4 && Math.abs(got.lon - lon) < 1e-4;
  }

  check("a decimal pair is a coordinate", near(RC.coords.parse("14.5995, 120.9842"), 14.5995, 120.9842));
  check("so is one separated by a space", near(RC.coords.parse("14.5995 120.9842"), 14.5995, 120.9842));
  check("a southern/western pair keeps its signs", near(RC.coords.parse("-33.8688, 151.2093"), -33.8688, 151.2093));
  check("hemisphere letters are read", near(RC.coords.parse("14.5995N, 120.9842E"), 14.5995, 120.9842));
  check("and reversed hemisphere letters too", near(RC.coords.parse("S33.8688 E151.2093"), -33.8688, 151.2093));
  check("degrees, minutes and seconds are read",
        near(RC.coords.parse("14\u00B035'58.2\"N 120\u00B059'3.1\"E"), 14.5995, 120.98419));
  check("a geo: URI is read", near(RC.coords.parse("geo:14.5995,120.9842"), 14.5995, 120.9842));
  check("a maps link with an @pair is read",
        near(RC.coords.parse("https://www.google.com/maps/@14.5995,120.9842,15z"), 14.5995, 120.9842));
  check("an OpenStreetMap permalink is read",
        near(RC.coords.parse("https://www.openstreetmap.org/#map=15/14.5995/120.9842"), 14.5995, 120.9842));

  // The whole point: a street address must NOT be mistaken for a position.
  check("a street address is not a coordinate", RC.coords.parse("5 Ayala Avenue, Makati") === null);
  check("a bare place name is not a coordinate", RC.coords.parse("Tagaytay") === null);
  check("an out-of-range pair is refused", RC.coords.parse("95.1, 200.4") === null);
  check("empty input is refused", RC.coords.parse("   ") === null && RC.coords.parse(null) === null);
  check("a coordinate formats back to a metre", RC.coords.format(14.599512, 120.984219) === "14.59951, 120.98422");
})();

section("Behaviour: marks");
(function () {
  var RC = sandbox().RC;
  check("an empty store lists no marks", RC.marks.list().length === 0);

  var home = RC.marks.save({ name: "Home gate", lat: 14.5995, lon: 120.9842 });
  check("a mark comes back", RC.marks.list().length === 1 && RC.marks.get(home.id).name === "Home gate");
  check("a mark is exact by construction", RC.marks.toPlace(RC.marks.get(home.id)).precise === true);

  RC.marks.save({ name: "Home", lat: 14.599501, lon: 120.984201 });
  check("the same spot renames rather than duplicating",
        RC.marks.list().length === 1 && RC.marks.list()[0].name === "Home", String(RC.marks.list().length));

  RC.marks.save({ name: "The fork", lat: 14.7, lon: 121.1 });
  check("a different spot is a different mark", RC.marks.list().length === 2);

  check("a mark can be found by name", RC.marks.find("fork").length === 1);
  check("nothing matches nonsense", RC.marks.find("zzzz").length === 0);
  check("the nearest mark is found within range",
        (RC.marks.nearest(14.59952, 120.98421, 60) || {}).name === "Home");
  check("and not found outside it", RC.marks.nearest(14.8, 121.4, 60) === null);

  var threw = false;
  try { RC.marks.save({ name: "Nowhere" }); } catch (e) { threw = true; }
  check("a mark without a coordinate is refused", threw);

  for (var i = 0; i < RC.marks.MAX + 5; i++) RC.marks.save({ name: "P" + i, lat: 10 + i / 500, lon: 121 });
  check("the mark store is bounded", RC.marks.list().length <= RC.marks.MAX, String(RC.marks.list().length));
})();

section("Behaviour: expressway detection reads refs too");
(function () {
  var RC = sandbox().RC;
  // OSRM routinely names an expressway step after the surface road it
  // parallels and puts the expressway only in `ref`. Reading one field
  // missed the road entirely.
  var route = {
    steps: [
      { text: "Continue onto Governor's Drive", ref: "NLEX", distance: 9000 },
      { text: "Continue onto EDSA", ref: "C-4", distance: 4000 }
    ]
  };
  check("an expressway carried only in the ref is caught",
        RC.router.expresswayNames(route).indexOf("NLEX") > -1,
        JSON.stringify(RC.router.expresswayNames(route)));
  check("an ordinary ref is not a false positive",
        RC.router.expresswayNames(route).length === 1);
  check("the metres are counted from the ref as well",
        RC.router.expresswayMeters(route) === 9000, String(RC.router.expresswayMeters(route)));
  check("the motorcycle exclusion is a ladder, strictest first",
        RC.router.VEHICLE.motorcycle.exclude[0] === "motorway,toll" &&
        RC.router.VEHICLE.motorcycle.exclude[1] === "motorway" &&
        RC.router.VEHICLE.motorcycle.exclude[2] === null,
        JSON.stringify(RC.router.VEHICLE.motorcycle.exclude));
})();

section("Behaviour: free driving odometer");
(function () {
  var RC = sandbox().RC;
  var accept = RC.free._acceptStep;
  var a = { lat: 14.6, lon: 121.0 };
  var b = { lat: 14.6, lon: 121.0009 };   // ~97 m east

  check("an ordinary step is counted", accept(a, b, 5, 8) > 80);
  check("a parked phone's jitter is not",
        accept(a, { lat: 14.600002, lon: 121.000002 }, 5, 8) === 0);
  check("a step inside the fix's own error circle is not",
        accept(a, b, 5, 300) === 0);
  check("a vague fix cannot move the odometer at all",
        accept(a, { lat: 14.61, lon: 121.0 }, 30, 500) === 0);
  check("a teleport is not",
        accept(a, { lat: 15.6, lon: 121.0 }, 2, 8) === 0);
  check("a step with no elapsed time is not", accept(a, b, 0, 8) === 0);
  check("a free ride is not recording before it starts", RC.free.isActive() === false);
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


section("Behaviour: rejoining a planned route");
(function () {
  var RC = sandbox().RC;
  var J = RC.rejoin;

  /* A planned line due north, 0.05 degrees of latitude long (about 5.5 km),
     and a rider a touch over a kilometre east of the middle of it. */
  var planned = [];
  for (var i = 0; i <= 10; i++) planned.push([14.0 + i * 0.005, 121.0]);
  var from = { lat: 14.02, lon: 121.01 };

  var near = J.nearestOn(planned, from.lat, from.lon);
  check("the nearest point on the line is found abeam, not at a vertex",
        Math.abs(near.lat - 14.02) < 1e-6 && Math.abs(near.lon - 121.0) < 1e-6,
        JSON.stringify([near.lat, near.lon]));
  check("its distance is the perpendicular one", near.distM > 1000 && near.distM < 1150,
        String(Math.round(near.distM)));
  check("and it knows how far along the line it sits",
        near.alongM > 2100 && near.alongM < 2300, String(Math.round(near.alongM)));

  var cum = J.cumulative(planned);
  check("the line's length is accumulated", cum[cum.length - 1] > 5400 && cum[cum.length - 1] < 5700,
        String(Math.round(cum[cum.length - 1])));

  check("a point on the line is not off it", J.distanceToLine(planned, 14.03, 121.0) < 1);

  // A straight line simplifies to its two ends; a kink survives.
  check("a straight line simplifies to its endpoints", J.simplify(planned, 12).length === 2,
        String(J.simplify(planned, 12).length));
  var kinked = [[14.0, 121.0], [14.0, 121.02], [14.02, 121.02]];
  check("a corner is never simplified away", J.simplify(kinked, 12).length === 3);
  check("simplify keeps the first and last point",
        J.simplify(planned, 12)[0][0] === 14.0 &&
        J.simplify(planned, 12)[1][0] === planned[planned.length - 1][0]);

  var packed = J.compact([[14.123456789, 121.987654321]]);
  check("coordinates are rounded to about a metre",
        packed[0][0] === 14.12346 && packed[0][1] === 121.98765, JSON.stringify(packed[0]));

  check("a line laid over the planned one is not off the corridor",
        J.offCorridorMeters(planned, planned) === 0);
  var parallel = planned.map(function (c) { return [c[0], c[1] + 0.01]; });
  check("a line a kilometre to the side is entirely off it",
        J.offCorridorMeters(parallel, planned) > 5000,
        String(Math.round(J.offCorridorMeters(parallel, planned))));

  /* stopsAhead: the middle stop is behind a rider two thirds of the way up
     the line; the destination never is. */
  var plan = {
    coords: planned,
    stops: [{ lat: 14.01, lon: 121.0, name: "Fuel" }, { lat: 14.05, lon: 121.0, name: "End" }]
  };
  var ahead = J.stopsAhead(plan, { lat: 14.035, lon: 121.001 });
  check("a stop already passed drops off the list", ahead.length === 1 && ahead[0].name === "End",
        JSON.stringify(ahead.map(function (s) { return s.name; })));
  var allAhead = J.stopsAhead(plan, { lat: 14.001, lon: 121.001 });
  check("stops still ahead stay on it", allAhead.length === 2);

  /* The suggestion itself, against a router that answers with the polyline
     through the waypoints it was given. Three asks: to the stop, back to the
     line, and through the line to the stop. */
  var asks = [];
  function fakeRouter(waypoints) {
    asks.push(waypoints.length);
    var coords = waypoints.map(function (w) { return [w.lat, w.lon]; });
    var d = 0;
    for (var k = 1; k < coords.length; k++) {
      d += J.metres(coords[k - 1][0], coords[k - 1][1], coords[k][0], coords[k][1]);
    }
    return Promise.resolve([{ coords: coords, distance: d, duration: d / 12 }]);
  }

  return J.suggest({ from: from, planned: plan, router: fakeRouter }).then(function (list) {
    check("three kinds of way back are offered", list.length === 3,
          list.map(function (c) { return c.kind; }).join(", "));
    var kinds = list.map(function (c) { return c.kind; }).sort().join(",");
    check("they are a stop, a rejoin and an optimised one", kinds === "optimised,rejoin,stop", kinds);
    check("exactly one is recommended",
          list.filter(function (c) { return c.recommended; }).length === 1);
    check("the recommendation is the best scoring one", list[0].recommended === true &&
          list[0].score <= list[1].score && list[1].score <= list[2].score);
    check("every candidate carries its own id",
          list[0].id !== list[1].id && list[1].id !== list[2].id);
    check("the router was asked once per candidate", asks.length === 3, asks.join(","));
    check("the optimised one routes through a via", asks.indexOf(3) > -1, asks.join(","));
    check("time off the planned corridor is measured",
          list.every(function (c) { return typeof c.offCorridorM === "number"; }));

    // Two candidates that turn out to be the same road are one candidate.
    function sameRouter() {
      return Promise.resolve([{ coords: [[14.02, 121.01], [14.05, 121.0]], distance: 4000, duration: 400 }]);
    }
    return J.suggest({ from: from, planned: plan, router: sameRouter }).then(function (dup) {
      check("the same road is never offered twice under two names", dup.length < 3,
            String(dup.length));
      return J.suggest({ from: from, planned: null, router: fakeRouter });
    }).then(function (none) {
      check("no planned route means nothing to rejoin", none.length === 0);
    });
  });
})();

section("Behaviour: what the group ride accepts off the wire");
(function () {
  var RC = sandbox().RC;
  var G = RC.group;

  check("a name is trimmed, de-newlined and capped",
        G._clean.name("  Ka\nrl\t Rider with a very long name indeed  ").length <= G.NAME_MAX &&
        G._clean.name("A\nB") === "A B", JSON.stringify(G._clean.name("A\nB")));
  check("an invisible-character name is not a name",
        G._clean.name("​​") === "", JSON.stringify(G._clean.name("​​")));
  check("chat is capped at the advertised length",
        G._clean.text(new Array(600).join("x")).length === G.CHAT_MAX);

  check("a fix off the wire needs two real numbers",
        G._clean.fix({ lat: "abc", lon: 1 }) === null && G._clean.fix(null) === null);
  check("a coordinate outside the globe is refused",
        G._clean.fix({ lat: 91, lon: 0 }) === null && G._clean.fix({ lat: 0, lon: 181 }) === null);
  var fix = G._clean.fix({ lat: 14, lon: 121, speedKmh: 9000, courseDeg: -90, at: 8.64e15 });
  check("an impossible speed is clamped", fix.speedKmh === 400, String(fix.speedKmh));
  check("a heading is normalised into the circle", fix.courseDeg === 270, String(fix.courseDeg));
  check("the timestamp is ours, not the sender's", fix.at > 1.6e12 && fix.at < 4e12, String(fix.at));

  /* A planned route on the wire: simplified, rounded, stops kept. A straight
     line of a thousand points is two. */
  var line = [];
  for (var i = 0; i < 1000; i++) line.push([14 + i * 0.0001, 121.000000123]);
  var packed = G._packPlan({
    coords: line, distance: 11000, duration: 900,
    stops: [{ lat: 14.09999, lon: 121.0000001, name: "End\nof it" }],
    vehicle: "motorcycle"
  }, "Host");
  check("a shared route is simplified before it is sent", packed.coords.length < 10,
        String(packed.coords.length));
  check("and rounded on the way out", String(packed.coords[0][1]).length <= 10,
        String(packed.coords[0][1]));
  check("its stops survive, names cleaned", packed.stops.length === 1 &&
        packed.stops[0].name === "End of it", JSON.stringify(packed.stops[0]));
  check("the vehicle rides along with it", packed.vehicle === "motorcycle");
  check("a shared route carries an id", typeof packed.id === "string" && packed.id.length > 4);
  check("nonsense for a vehicle falls back to a car",
        G._packPlan({ coords: line, stops: [], vehicle: "hovercraft" }, "Host").vehicle === "car");

  check("the room is not active until one is opened", G.isActive() === false);
  check("a room that does not exist has no planned route", G.planned() === null);
  check("host-only controls refuse to act outside a room",
        G.setPlanned({ coords: line }) === false && G.kick("nobody") === false &&
        G.setApproval(true) === false);
})();

section("Behaviour: the SDP the voice path rewrites");
(function () {
  var RC = sandbox().RC;
  var tune = RC.net._tuneSdp;

  var offer = [
    "v=0", "o=- 1 2 IN IP4 127.0.0.1", "s=-", "t=0 0",
    "a=group:BUNDLE 0 1",
    "m=application 9 UDP/DTLS/SCTP webrtc-datachannel", "c=IN IP4 0.0.0.0",
    "a=mid:0", "a=sctp-port:5000",
    "m=audio 9 UDP/TLS/RTP/SAVPF 111 63", "c=IN IP4 0.0.0.0",
    "a=mid:1", "a=sendrecv",
    "a=rtpmap:111 opus/48000/2",
    "a=fmtp:111 minptime=10;useinbandfec=1",
    "a=rtpmap:63 red/48000/2", "a=fmtp:63 111/111",
    "a=ssrc:123 cname:abc", ""
  ].join("\r\n");

  var out = tune(offer);

  check("loss is repaired forward, never by waiting for a resend",
        /useinbandfec=1/.test(out));
  check("a quiet rider costs the uplink nothing", /usedtx=1/.test(out));
  check("voice is capped at wideband, not full band",
        /maxplaybackrate=16000/.test(out) && /maxaveragebitrate=24000/.test(out));
  check("packets are 20 ms, stated once", (out.match(/a=ptime:20/g) || []).length === 1);

  // The description has to survive the rewrite as a *description*: a stray
  // blank line or a dropped final CRLF is rejected wholesale by the browser,
  // and the symptom is a room nobody can join rather than a room nobody can
  // hear.
  var lines = out.split("\r\n");
  check("no blank line is opened mid-description",
        lines.slice(0, -1).every(function (l) { return l.length > 0; }));
  check("the trailing newline survives", out.slice(-2) === "\r\n");
  check("another codec's parameters are left alone", out.indexOf("a=fmtp:63 111/111") > 0);
  check("an audioless description is returned untouched",
        tune("v=0\r\nm=application 9 x\r\n") === "v=0\r\nm=application 9 x\r\n");
  check("nothing to rewrite is not an error", tune("") === "" && tune(null) === null);

  // Rewriting twice happens for real: an answer we tuned comes back through
  // the same path on a re-offer.
  check("rewriting an already-rewritten description is a no-op", tune(out) === out);
})();

section("Behaviour: the QR code a room is joined by");
(function () {
  var QR = sandbox().RC.qr;

  /* Total codewords and remainder bits per version (ISO/IEC 18004 table 1).
     These came across from KaraokeNatin with the encoder, because they are
     what caught the one real bug it ever had: alignment patterns wrongly
     omitted where they cross the timing lines, which silently shifted every
     data module from version 7 up — producing a symbol that looks perfectly
     convincing and decodes to nothing. */
  var TOTAL = {
    1: 26, 2: 44, 3: 70, 4: 100, 5: 134, 6: 172, 7: 196, 8: 242, 9: 292, 10: 346, 11: 404,
    12: 466, 13: 532, 14: 581, 15: 655, 16: 733, 17: 815, 18: 901, 19: 991, 20: 1085,
    21: 1156, 22: 1258, 23: 1364, 24: 1474, 25: 1588
  };
  function remainder(v) { return v === 1 ? 0 : v <= 6 ? 7 : v <= 13 ? 0 : v <= 20 ? 3 : 4; }

  var countOk = true;
  for (var v = 1; v <= QR.MAX_VERSION; v++) {
    var grid = QR._internal.makeMatrix(v);
    var free = 0;
    for (var y = 0; y < grid.size; y++) {
      for (var x = 0; x < grid.size; x++) if (!grid.reserved[y][x]) free++;
    }
    if (free !== TOTAL[v] * 8 + remainder(v)) countOk = false;
  }
  check("every version leaves exactly the standard number of data modules", countOk);

  var blockOk = true;
  ["L", "M"].forEach(function (ecc) {
    for (var v2 = 1; v2 <= QR.MAX_VERSION; v2++) {
      var b = QR._internal.BLOCKS[ecc][v2];
      var blocks = b[1] + b[3];
      if (b[1] * b[2] + b[3] * b[4] + blocks * b[0] !== TOTAL[v2]) blockOk = false;
    }
  });
  check("block layouts account for every codeword", blockOk);

  var invite = "https://nojukuramu.github.io/routecast/?ride=RIDE42";
  var sym = QR.encode(invite, { ecc: "M" });

  /* A reader finds the symbol by its three corners and nothing else. */
  function finderAt(m, ox, oy) {
    var want = ["1111111", "1000001", "1011101", "1011101", "1011101", "1000001", "1111111"];
    for (var yy = 0; yy < 7; yy++) {
      for (var xx = 0; xx < 7; xx++) {
        if ((m[oy + yy][ox + xx] ? "1" : "0") !== want[yy][xx]) return false;
      }
    }
    return true;
  }
  check("finder patterns are intact in all three corners",
        finderAt(sym.modules, 0, 0) &&
        finderAt(sym.modules, sym.size - 7, 0) &&
        finderAt(sym.modules, 0, sym.size - 7));

  var timingOk = true;
  for (var i = 8; i < sym.size - 8; i++) {
    if (sym.modules[6][i] !== (i % 2 === 0)) timingOk = false;
    if (sym.modules[i][6] !== (i % 2 === 0)) timingOk = false;
  }
  check("timing patterns alternate across the symbol", timingOk);

  /* The whole point is a code somebody reads off a screen at arm's length in
     a car park. A big version is a dense symbol, and a dense symbol needs the
     phone closer than the situation allows. */
  check("a ride invite fits in version 4 or smaller at ECC M",
        sym.version <= 4, "version " + sym.version);

  var CAPACITY_M = {
    1: 14, 2: 26, 3: 42, 4: 62, 5: 84, 6: 106, 7: 122, 8: 152, 9: 180, 10: 213, 11: 251,
    12: 287, 13: 331, 14: 362, 15: 412, 16: 450, 17: 504, 18: 560, 19: 624, 20: 666,
    21: 711, 22: 779, 23: 857, 24: 911, 25: 997
  };
  var capOk = true;
  for (var v3 = 1; v3 <= QR.MAX_VERSION; v3++) {
    if (QR.encode(new Array(CAPACITY_M[v3] + 1).join("a"), { ecc: "M" }).version > v3) capOk = false;
  }
  check("version selection matches byte-mode capacities at ECC M", capOk);

  var threw = false;
  try {
    QR.encode(new Array(CAPACITY_M[QR.MAX_VERSION] + 41).join("x"), { ecc: "M" });
  } catch (e) { threw = true; }
  check("an oversized payload fails loudly rather than drawing nonsense", threw);
})();

section("Behaviour: what a scanned code is allowed to mean");
(function () {
  /* codeFromScan lives in groupui.js, which needs a whole Leaflet map to load.
     The rule it encodes is small and worth pinning on its own: a camera is
     pointed at whatever happens to be in front of it, so what comes back is a
     stranger's claim in exactly the way a message off the wire is. */
  var src = read("static/js/groupui.js");
  var m = /function codeFromScan\(raw\) \{[\s\S]*?\n  \}/.exec(src);
  check("the scanner has a single place where it decides what it read", !!m);
  if (!m) return;

  // Lifted out of the file and given the one collaborator it uses, so the rule
  // is checked as it is actually written rather than as a copy of it.
  var codeFromScan = new Function("RC", m[0] + "\nreturn codeFromScan;")({
    net: { normalizeCode: function (c) {
      return String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    } }
  });

  check("a full invite link yields its code",
        codeFromScan("https://nojukuramu.github.io/routecast/?ride=RIDE42") === "RIDE42");
  check("a bare six-character code is accepted", codeFromScan("ride42") === "RIDE42");
  check("the code is normalised the same way a typed one is",
        codeFromScan("  ride42  ") === "RIDE42");
  check("a link with the code among other parameters still works",
        codeFromScan("https://example.test/routecast/?utm=x&ride=ABC123&z=1") === "ABC123");

  // The failures matter more than the successes here: a rider pointing a
  // camera around a car park must not be dropped into a stranger's room by a
  // poster, a wifi code or a URL that merely contains six characters.
  check("an unrelated URL is not a room", codeFromScan("https://example.test/") === "");
  check("a longer word is not a code", codeFromScan("MOTORCYCLES") === "");
  check("free text is not a code", codeFromScan("Cafe Wifi: password123") === "");
  check("nothing scanned is nothing joined",
        codeFromScan("") === "" && codeFromScan(null) === "");
})();


section("Behaviour: which way the vehicle is pointing");
(function () {
  /* The bug this exists to stop coming back: course-up rotation that never
     rotated, because `coords.heading` is null on a great many devices and
     nothing downstream had a second opinion. */
  var RC = sandbox().RC;

  var t = RC.courseTracker();
  check("no heading before any fix", t.get() === null);

  // Due north, 20 m a second, with a chipset that reports no heading at all.
  var lat = 14.6, lon = 121.0, step = 20 / 111320;
  var at = 1000;
  t.push(lat, lon, at, null, 72);
  for (var i = 1; i < 6; i++) {
    at += 1000;
    t.push(lat + i * step, lon, at, null, 72);
  }
  var north = t.get();
  check("a moving vehicle has a heading even with no GPS course", north !== null);
  check("and that heading is the way it is going",
        north !== null && (north < 8 || north > 352), "got " + north);

  // Turn east and keep going; the smoothing should follow round.
  var lat2 = lat + 6 * step, lon2 = lon;
  var eStep = 20 / (111320 * Math.cos(lat2 * Math.PI / 180));
  for (var j = 1; j < 14; j++) {
    at += 1000;
    t.push(lat2, lon2 + j * eStep, at, null, 72);
  }
  var east = t.get();
  check("a turn is followed", east > 60 && east < 120, "got " + east);

  // A parked phone drifting a metre at a time must not invent a direction.
  var parked = RC.courseTracker();
  parked.push(14.6, 121.0, 1000, null, 0);
  parked.push(14.600002, 121.000002, 2000, null, 0);
  parked.push(14.599998, 120.999997, 3000, null, 0);
  check("a parked phone has no course", parked.get() === null);

  // The chipset's own course, when it has one, wins outright and is not
  // smoothed: it is already filtered, and smoothing it only adds lag.
  var gps = RC.courseTracker();
  gps.push(14.6, 121.0, 1000, 217.5, 80);
  check("a reported GPS course is used as given", gps.get() === 217.5, "got " + gps.get());

  // Crossing north is a short step, not a 358-degree spin.
  check("the shortest arc is taken across north",
        Math.abs(RC.bearing({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })) < 0.01);
  var west = RC.bearing({ lat: 0, lon: 0 }, { lat: 0, lon: -1 });
  check("a bearing is degrees clockwise from north", Math.abs(west - 270) < 0.01, "got " + west);
})();

section("Behaviour: the heat map's reading of the record");
(function () {
  var RC = sandbox().RC;

  RC.history.startSession("motorcycle");
  var coords = line(14.6, 121.0, 40, 60);
  var t = Date.now() - 3600000;
  for (var i = 0; i < coords.length; i++) {
    RC.history.record({ lat: coords[i][0], lon: coords[i][1], t: t + i * 6000, speedKmh: 36 });
  }
  RC.history.endSession(null);

  var segs = RC.history.segments();
  check("the recorded roads come back as geometry", segs.length > 3, "segments=" + segs.length);

  var ok = segs.every(function (s) {
    return s.a && s.b && s.a.length === 2 && s.b.length === 2 &&
           isFinite(s.a[0]) && isFinite(s.a[1]) && isFinite(s.b[0]) && isFinite(s.b[1]);
  });
  check("every segment has two real ends", ok);

  var near = segs.every(function (s) {
    return Math.abs(s.a[0] - 14.6) < 0.2 && Math.abs(s.a[1] - 121.0) < 0.3;
  });
  check("and they are where the ride was", near);

  var speeds = segs.filter(function (s) { return s.kmh != null; });
  check("each one knows how fast it was ridden", speeds.length === segs.length);
  var plausible = speeds.every(function (s) { return s.kmh > 20 && s.kmh < 60; });
  check("at about the speed it was actually ridden", plausible,
        speeds.length ? "first=" + speeds[0].kmh.toFixed(1) : "none");

  check("a motorcycle ride is recorded against the motorcycle",
        segs.every(function (s) { return s.vehicle === "motorcycle"; }));
  check("filtering by the other vehicle finds nothing",
        RC.history.segments({ vehicle: "car" }).length === 0);

  var sum = RC.history.heatSummary();
  check("the summary counts what the segments hold", sum.segments === segs.length);
  check("and adds up the distance", sum.meters > 1000, "m=" + Math.round(sum.meters));
  check("and knows the overall pace", sum.kmh > 20 && sum.kmh < 60, "kmh=" + sum.kmh);

  // Riding the same road twice must reinforce one segment, not invent two:
  // the whole heat map is built on that being true.
  var before = RC.history.segments().length;
  RC.history.startSession("motorcycle");
  var t2 = Date.now();
  for (var j = 0; j < coords.length; j++) {
    RC.history.record({ lat: coords[j][0], lon: coords[j][1], t: t2 + j * 6000, speedKmh: 36 });
  }
  RC.history.endSession(null);
  var after = RC.history.segments();
  check("riding a road again does not duplicate it", after.length === before,
        before + " then " + after.length);
  check("it makes it hotter instead",
        after.some(function (s) { return s.uses > 1; }));
})();

section("Behaviour: what a PUB is allowed to be");
(function () {
  var RC = sandbox().RC;
  var area = RC.pubs._areaCode;

  check("an area code is six characters", area(14.6, 121.0).length === 6);

  /* The one property the whole scheme rests on: two riders in the same region
     compute the same code without having spoken, and riders in different
     regions do not. */
  check("two riders in the same area agree on it",
        area(14.60, 121.00) === area(14.95, 121.40));
  check("a different region is a different area",
        area(14.6, 121.0) !== area(35.6, 139.7));
  check("so is the cell next door",
        area(14.6, 121.0) !== area(16.6, 121.0));

  /* And the one that keeps PUBs away from private rides: ride codes are drawn
     from an alphabet with no 0, 1, I or O in it, so a code starting with one
     of those can never be somebody's room. */
  check("an area code cannot be mistaken for a ride", area(14.6, 121.0).charAt(0) === "0");
  check("a PUB code is recognised as one", RC.pubs.isPubCode(area(14.6, 121.0)));
  check("a ride code is not a PUB", !RC.pubs.isPubCode("QWERTY"));
  check("an area is not a room", !RC.pubs.isRoomCode(area(14.6, 121.0)));
  check("a room code is", RC.pubs.isRoomCode("1ABCDE"));

  // The antipodes and the poles are where a cell index goes wrong quietly.
  check("the date line has an area", area(0, 179.9).length === 6 && area(0, -179.9).length === 6);
  check("so do the poles", area(-89.9, 0).length === 6 && area(89.9, 0).length === 6);

  /* Everything off the wire is a stranger's claim. */
  var clean = RC.pubs._clean;
  check("a name is capped", clean.name(new Array(80).join("x")).length <= 22);
  check("control characters never reach a public map",
        clean.name("a\u0000b\u2028c") === "a b c", JSON.stringify(clean.name("a\u0000b\u2028c")));
  check("an empty name stays empty", clean.name("   ") === "");
  check("a message is capped", clean.text(new Array(600).join("y")).length <= 280);

  check("a fix at the bottom of the sea is refused", clean.fix({ lat: 999, lon: 0 }) === null);
  check("a fix with no coordinates is refused", clean.fix({ name: "x" }) === null);
  check("a plausible fix is kept", !!clean.fix({ lat: 14.6, lon: 121.0 }));
  check("a stranger cannot claim to be travelling at Mach 3",
        clean.fix({ lat: 14.6, lon: 121.0, speedKmh: 99999 }).speedKmh === 400);
  check("nor to be facing 900 degrees",
        clean.fix({ lat: 14.6, lon: 121.0, courseDeg: 905 }).courseDeg === 185);

  /* What is broadcast is deliberately blunter than what is known. */
  var blunt = clean.blunt;
  check("a shared position is rounded before it leaves the phone",
        blunt(14.59952345) === 14.5995, "got " + blunt(14.59952345));
  check("rounding is to about ten metres, not to a suburb",
        Math.abs(blunt(14.59952345) - 14.59952345) < 0.0001);
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
