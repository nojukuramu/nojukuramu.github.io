#!/usr/bin/env node
/* ============================================================
   KomyutApp — validation harness
   `node tools/validate.js`

   Three halves, and all of them have to pass before anything ships.

   1. **Static checks** over the source as text: no emoji, every inline SVG
      well formed, every element id the JavaScript reaches for present in
      index.html, every script listed in the page also listed in the
      service worker's shell, the page and the worker agreeing about the
      version, every CSS custom property defined before it is used, and the
      light and dark palettes carrying the same tokens.

   2. **Security checks**, which is the half this app has that RouteCast
      does not, because this is the first thing in the repository where one
      stranger's typing is shown to another. They are the mechanical half
      of the promise: no renderer assigns community text to innerHTML, the
      Content-Security-Policy is present and forbids inline script, no
      service-role key is anywhere near the repository, and the limits
      sanitize.js applies match the CHECK constraints in the schema.

   3. **Behaviour checks** over the pure modules, run in a sandbox with
      just enough browser to satisfy them: the sanitiser, the reliability
      model, the PostgREST filter quoting, the polyline maths, and the
      journey planner finding a transfer on a fixture.

   No dependencies, no build step, same shape as routecast/tools/validate.js.
   ============================================================ */
"use strict";

var fs = require("fs");
var path = require("path");
var vm = require("vm");

var ROOT = path.join(__dirname, "..");
var failures = [];
var checks = 0;
/* Almost everything here is synchronous. The one check that cannot be — a
   promise rejection — parks itself here and is awaited before the tally. */
var pending = [];

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
      if (/\.(js|css|html|md|webmanifest|svg|sql|txt)$/.test(name)) out.push(rel);
    });
  }
  walk(".");
  return out;
}

var HTML = read("index.html");
var SW = read("sw.js");

/* ============================================================
   1. Static
   ============================================================ */

section("Static: no emoji");
(function () {
  /* The rule is "no emoji, use SVG". Testing for that means testing for
     pictographs specifically, not for "non-ASCII": the copy is full of
     legitimate typography and flagging an em dash would make the check
     useless noise. */
  var EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{2B00}-\u{2BFF}]/u;
  var bad = [];
  sourceFiles().forEach(function (rel) {
    if (rel.indexOf("tools") === 0) return;   // this file names the ranges it bans
    read(rel).split("\n").forEach(function (line, i) {
      var m = line.match(EMOJI);
      if (m) bad.push(rel + ":" + (i + 1) + " " + JSON.stringify(m[0]));
    });
  });
  check("no emoji or pictographic characters in source", bad.length === 0, bad.slice(0, 8).join(", "));
})();

section("Static: SVG well-formedness");
(function () {
  /* A malformed inline SVG fails silently in a browser — it simply does
     not draw — so a structural check is worth having. Tags balance,
     attributes are quoted, nothing is left open. */
  var files = ["static/js/icons.js", "index.html", "static/icon.svg"];
  var problems = [];
  var count = 0;

  files.forEach(function (rel) {
    var src = read(rel);
    var re = /<svg\b[\s\S]*?<\/svg>/g;
    var m;
    while ((m = re.exec(src))) {
      count++;
      var frag = m[0];
      var stack = [];
      var tag = /<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g;
      var t;
      while ((t = tag.exec(frag))) {
        var closing = t[1] === "/";
        var name = t[2];
        var selfClose = t[4] === "/";
        var attrs = t[3];
        /* Every attribute value must be quoted; an unquoted one with a
           space in it silently swallows the next attribute. */
        var a = /([\w:-]+)\s*=\s*([^\s">]+)/g, am;
        while ((am = a.exec(attrs))) {
          problems.push(rel + ": unquoted attribute " + am[1] + " on <" + name + ">");
        }
        if (selfClose) continue;
        if (closing) {
          if (stack.pop() !== name) problems.push(rel + ": <" + name + "> closes out of order");
        } else {
          stack.push(name);
        }
      }
      if (stack.length) problems.push(rel + ": <" + stack.join("><") + "> left open");
    }
  });

  check("every inline SVG is well formed (" + count + " checked)", problems.length === 0,
    problems.slice(0, 6).join("; "));

  var iconsSrc = read("static/js/icons.js");
  var sandbox = makeSandbox(["static/js/icons.js"]);
  var icons = sandbox.KM.icons;
  check("the icon set covers rides, interface and weather",
    icons.rideNames().length >= 9 && icons.uiNames().length >= 20 && icons.weatherNames().length >= 9,
    icons.rideNames().length + " / " + icons.uiNames().length + " / " + icons.weatherNames().length);
  check("every route type has a glyph",
    makeSandbox(["static/js/icons.js", "static/js/transit.js"]).KM.transit.TYPES.every(function (t) {
      return icons.rideNames().indexOf(t.icon) !== -1;
    }), "a type names an icon that is not drawn");
  check("an unknown icon name still returns a drawable glyph",
    /<svg/.test(icons.ui("nonesuch")) && /<svg/.test(icons.ride("nonesuch")));
  check("the icons file itself declares no emoji", !/[\u{1F300}-\u{1FAFF}]/u.test(iconsSrc));
})();

section("Static: the page and the code agree");
(function () {
  var ids = {};
  var re = /\bid="([^"]+)"/g, m;
  while ((m = re.exec(HTML))) ids[m[1]] = true;

  var missing = [];
  fs.readdirSync(path.join(ROOT, "static/js")).forEach(function (name) {
    if (!/\.js$/.test(name)) return;
    var src = read(path.join("static/js", name));
    var r = /KM\.el\(\s*"([^"]+)"\s*\)/g, k;
    while ((k = r.exec(src))) {
      if (!ids[k[1]]) missing.push(name + " reaches for #" + k[1]);
    }
  });
  check("every KM.el() id exists in index.html", missing.length === 0, missing.join(", "));

  var scripts = [];
  var s = /<script src="([^"]+)"><\/script>/g, sm;
  while ((sm = s.exec(HTML))) scripts.push(sm[1]);

  var missingFile = scripts.filter(function (p) { return !fs.existsSync(path.join(ROOT, p)); });
  check("every script the page loads exists on disk", missingFile.length === 0, missingFile.join(", "));

  var loaded = {};
  scripts.forEach(function (p) { loaded[p.replace(/^\.\//, "")] = true; });
  var orphans = fs.readdirSync(path.join(ROOT, "static/js")).filter(function (n) {
    return /\.js$/.test(n) && !loaded["static/js/" + n];
  });
  check("no orphan script in static/js", orphans.length === 0, orphans.join(", "));

  var notCached = scripts.filter(function (p) {
    if (p.indexOf("vendor") !== -1) return SW.indexOf(p.replace(/^\.\//, "")) === -1;
    return SW.indexOf("./" + p) === -1;
  });
  check("every script is in the service worker shell", notCached.length === 0, notCached.join(", "));
  check("the stylesheet is in the service worker shell", SW.indexOf("./static/css/app.css") !== -1);
  check("the manifest is in the service worker shell", SW.indexOf("./manifest.webmanifest") !== -1);

  /* Every file named in the shell has to exist, or install() rejects and
     the app never caches anything at all. */
  var shellMissing = [];
  var sh = /"\.\/([^"]*)"/g, shm;
  while ((shm = sh.exec(SW.slice(SW.indexOf("var SHELL"), SW.indexOf("self.addEventListener"))))) {
    if (shm[1] && !fs.existsSync(path.join(ROOT, shm[1]))) shellMissing.push(shm[1]);
  }
  check("every file in the shell exists", shellMissing.length === 0, shellMissing.join(", "));

  /* A vendored library nobody loads is a megabyte in somebody's clone and
     a licence to keep up to date for nothing. This caught a copy of
     MapLibre that came along with RouteCast's vendor/ directory. */
  var vendorUnused = [];
  (function walkVendor(dir) {
    fs.readdirSync(path.join(ROOT, dir)).forEach(function (name) {
      var rel = path.join(dir, name);
      if (fs.statSync(path.join(ROOT, rel)).isDirectory()) return walkVendor(rel);
      if (!/\.(js|css)$/.test(name)) return;      // images are referenced by the CSS
      if (HTML.indexOf(rel) === -1 && SW.indexOf(rel) === -1) vendorUnused.push(rel);
    });
  })("vendor");
  check("no vendored library is carried without being loaded",
    vendorUnused.length === 0, vendorUnused.join(", "));
})();

section("Static: updates");
(function () {
  var boot = read("static/js/boot.js");
  var pageV = boot.match(/KM_VERSION\s*=\s*"([^"]+)"/);
  var swV = SW.match(/CACHE\s*=\s*"komyut-v([^"]+)"/);
  check("the page declares its version", !!pageV, pageV ? pageV[1] : "no KM_VERSION");
  check("the service worker cache name is versioned", !!swV);
  check("the page and the service worker agree on it",
    !!(pageV && swV && pageV[1] === swV[1]),
    pageV && swV ? pageV[1] + " vs " + swV[1] : "");

  /* The whole point of the pattern: a new build must NOT take over on its
     own. skipWaiting is allowed in exactly one place — the message
     handler that answers the page. */
  /* Comments are stripped first: the install handler carries a comment
     explaining why skipWaiting() is NOT there, and a check a comment can
     fool is a check that passes for the wrong reason. */
  function stripComments(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  }
  var bareSw = stripComments(SW);
  var installBlock = bareSw.slice(bareSw.indexOf('addEventListener("install"'), bareSw.indexOf('addEventListener("message"'));
  check("the service worker never takes over on its own",
    installBlock.indexOf("skipWaiting") === -1,
    "skipWaiting() inside install");
  check("it hands over when the page asks",
    /e\.data === "skip-waiting"[\s\S]{0,40}skipWaiting\(\)/.test(SW));
  check("the message word matches the rest of the repository",
    SW.indexOf('"skip-waiting"') !== -1);

  var upd = read("static/js/update.js");
  check("the page watches the registration",
    /updatefound/.test(upd) && /statechange/.test(upd) && /controllerchange/.test(upd));
  check("the first worker claiming a page is not treated as an update",
    /hadController/.test(upd));
  check("the page rechecks periodically", /setInterval/.test(upd) && /visibilitychange/.test(upd));
  check("there is a bar to offer it", HTML.indexOf('id="update-bar"') !== -1);
  check("and a manual check somewhere permanent", HTML.indexOf('id="update-check"') !== -1);

  /* Live data must never be served from the cache. */
  check("the worker only caches its own origin",
    /url\.origin !== self\.location\.origin/.test(SW));
})();

section("Static: the info sheet");
(function () {
  var sandbox = makeSandbox(["static/js/info.js"], { needDom: true });
  var topics = sandbox.KM.info.keys();
  check("the registry holds topics", topics.length >= 8, topics.length + " topics");

  var used = [];
  var re = /data-info="([^"]+)"/g, m;
  while ((m = re.exec(HTML))) used.push(m[1]);
  /* The detail view and the planner add more at runtime, so the source of
     those is searched too. */
  fs.readdirSync(path.join(ROOT, "static/js")).forEach(function (n) {
    if (!/\.js$/.test(n) || n === "info.js") return;
    var s = read(path.join("static/js", n));
    var r = /setAttribute\("data-info",\s*"([^"]+)"\)/g, k;
    while ((k = r.exec(s))) used.push(k[1]);
  });

  var orphan = used.filter(function (k) { return topics.indexOf(k) === -1; });
  check("every (i) names a topic that exists", orphan.length === 0, orphan.join(", "));

  var unused = topics.filter(function (k) { return used.indexOf(k) === -1; });
  check("no topic is unreachable", unused.length === 0, unused.join(", "));

  /* The house rule: a hint under a control is ONE short line; the
     paragraph goes behind the (i). */
  var longHints = [];
  var h = /<p class="km-hint">([\s\S]*?)<\/p>/g, hm;
  while ((hm = h.exec(HTML))) {
    var text = hm[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    if (text.length > 120) longHints.push(text.slice(0, 50) + "…");
  }
  check("no hint in the panel has grown back into a paragraph",
    longHints.length === 0, longHints.join(" | "));
})();

section("Static: the stylesheet");
(function () {
  var css = read("static/css/app.css");

  /* Custom properties: every var(--x) must have a --x: somewhere, or it
     silently falls back to nothing and a colour disappears. */
  var defined = {};
  var d = /(--[\w-]+)\s*:/g, dm;
  while ((dm = d.exec(css))) defined[dm[1]] = true;
  /* --mark is set inline by map.js on each marker. */
  defined["--mark"] = true;

  var undef = [];
  var u = /var\((--[\w-]+)/g, um;
  while ((um = u.exec(css))) {
    if (!defined[um[1]] && undef.indexOf(um[1]) === -1) undef.push(um[1]);
  }
  check("every CSS custom property is defined before it is used",
    undef.length === 0, undef.join(", "));

  /* Light and dark must carry the SAME set of tokens. A half-translated
     palette is how a dark theme ends up with one white card in it. */
  function tokensIn(startMarker) {
    var i = css.indexOf(startMarker);
    if (i === -1) return null;
    var open = css.indexOf("{", i);
    var depth = 0, j = open;
    for (; j < css.length; j++) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}") { depth--; if (!depth) break; }
    }
    var block = css.slice(open, j);
    var out = {};
    var t = /(--[\w-]+)\s*:/g, tm;
    while ((tm = t.exec(block))) out[tm[1]] = true;
    return out;
  }

  var light = tokensIn(":root {");
  var dark = tokensIn(':root[data-theme="dark"] {');
  check("both palettes exist", !!light && !!dark);
  if (light && dark) {
    var onlyDark = Object.keys(dark).filter(function (k) { return !light[k]; });
    var missingDark = Object.keys(light).filter(function (k) {
      /* Geometry, fonts and easing are not colours and are not restated. */
      return !dark[k] && !/^--(gut|safe-|rail-|tabs-|sheet-|radius|ease|sans|mono)/.test(k);
    });
    check("the dark palette redefines every colour the light one has",
      missingDark.length === 0, missingDark.join(", "));
    check("the dark palette invents no token of its own",
      onlyDark.length === 0, onlyDark.join(", "));
  }

  check("the map is dimmed rather than inverted in the dark theme",
    /\.leaflet-tile[\s\S]{0,200}filter:\s*brightness/.test(css),
    "an inverted map makes water look like land");

  /* Mobile first means the narrow layout is the unqualified one. */
  var firstMedia = css.indexOf("@media (min-width");
  var firstRule = css.indexOf(".km-app");
  check("the narrow layout is the default, not a media query",
    firstRule !== -1 && (firstMedia === -1 || firstRule < firstMedia));

  check("a tap target is at least 44px", /min-height:\s*44px/.test(css));

  /* The browser's [hidden] rule is the least specific rule there is, so any
     class that sets a display beats it. Several here do. */
  check("the hidden attribute actually hides",
    /\[hidden\]\s*\{\s*display:\s*none\s*!important/.test(css),
    "a class that sets display would otherwise beat the browser's own rule");
})();

/* ============================================================
   2. Security
   ============================================================ */

section("Security: nothing off the network becomes markup");
(function () {
  /* The rule, and it is mechanical rather than a habit: markup enters the
     DOM in exactly ONE function, KM.glyph in util.js, and what it puts
     there can only ever be one of the constants in icons.js. Everything
     else — every route name, description, place name, handle and comment
     — reaches the page through textContent.

     Two assignments are exempt and named here rather than pattern-matched,
     so adding a third is a deliberate act:
       util.js  — KM.glyph itself
       info.js  — the info sheet's body, whose copy is written in info.js
                  and never comes off the network. */
  var EXEMPT = { "util.js": 1, "info.js": 1 };
  var offenders = [];
  fs.readdirSync(path.join(ROOT, "static/js")).forEach(function (name) {
    if (!/\.js$/.test(name)) return;
    var src = read(path.join("static/js", name));
    src.split("\n").forEach(function (line, i) {
      if (!/\.innerHTML\s*=/.test(line)) return;
      if (EXEMPT[name]) return;
      offenders.push(name + ":" + (i + 1) + " " + line.trim().slice(0, 60));
    });
  });
  check("only KM.glyph and the info sheet assign to innerHTML",
    offenders.length === 0, offenders.join(" | "));

  var util = read("static/js/util.js");
  var glyph = util.slice(util.indexOf("KM.glyph = function"), util.indexOf("KM.mk = function"));
  check("KM.glyph can only ever emit an icon constant",
    /KM\.icons\.ride\(name\)/.test(glyph) &&
    /KM\.icons\.weather\(name\)/.test(glyph) &&
    /KM\.icons\.ui\(name\)/.test(glyph) &&
    glyph.indexOf("+") === -1,
    "nothing is concatenated into it, so nothing but a table lookup reaches the DOM");

  var infoSrc = read("static/js/info.js");
  check("the info sheet's copy is written in the info sheet",
    /bodyEl\.innerHTML = topic\.body/.test(infoSrc) &&
    infoSrc.indexOf("TOPICS = {") !== -1);

  /* map.js builds one fragment of markup for a Leaflet divIcon. It must
     not be able to carry a route name into it. */
  var mapSrc = read("static/js/map.js");
  var divIcon = mapSrc.slice(mapSrc.indexOf("function dot("), mapSrc.indexOf("function fit("));
  check("the map's one built fragment carries no free text",
    /opts\.title \? String\(opts\.title\) : undefined/.test(divIcon) &&
    divIcon.indexOf("opts.title +") === -1 &&
    divIcon.indexOf("opts.name") === -1,
    "a title goes through Leaflet's own attribute setter, not into HTML");
  check("the one thing interpolated into that fragment is a number or a letter",
    /opts\.text != null \? String\(opts\.text\)/.test(divIcon));

  /* Community text is rendered as text and must be allowed to wrap, or one
     long word is a horizontal scrollbar for everybody. */
  check("long community text is allowed to break",
    /overflow-wrap:\s*anywhere/.test(read("static/css/app.css")));

  /* And the renderers must actually put text on the page as text — either
     through KM.mk, which sets textContent, or through textContent itself. */
  var renderers = ["ui.js", "detail.js", "browse.js", "planner.js", "finder.js", "account.js"];
  var noText = renderers.filter(function (n) {
    var src = read(path.join("static/js", n));
    return !/KM\.mk\(/.test(src) && !/\.textContent\s*=/.test(src);
  });
  check("every module that renders community content builds it as text",
    noText.length === 0, noText.join(", "));
})();

section("Security: the policy on the page");
(function () {
  var csp = HTML.match(/http-equiv="Content-Security-Policy"\s+content="([\s\S]*?)"/);
  check("index.html carries a Content-Security-Policy", !!csp);
  if (!csp) return;
  var p = csp[1].replace(/\s+/g, " ");

  check("the default is to allow nothing", /default-src 'none'/.test(p));
  check("script comes only from this origin", /script-src 'self'(?!.*unsafe)/.test(p.split(";")[1] || p));
  check("no inline script is permitted anywhere",
    !/script-src[^;]*unsafe-inline/.test(p) && !/script-src[^;]*unsafe-eval/.test(p));
  check("objects and frames are off", /object-src 'none'/.test(p) && /frame-src 'none'/.test(p));
  check("a <base> tag cannot repoint the page", /base-uri 'self'/.test(p));
  check("the services it may talk to are named",
    /connect-src[^;]*supabase/.test(p) && /connect-src[^;]*open-meteo/.test(p) &&
    /connect-src[^;]*nominatim/.test(p) && /connect-src[^;]*osrm/.test(p));

  /* The policy is worth nothing if the page then carries an inline script
     or an inline handler. */
  /* The comments in index.html talk ABOUT <script>, so they come out
     before the page is searched for one. */
  var bareHtml = HTML.replace(/<!--[\s\S]*?-->/g, " ");
  check("the page carries no inline <script> block",
    !/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/.test(bareHtml),
    "an inline script would be blocked by the policy it sits under");
  var handlers = bareHtml.match(/\son[a-z]+\s*=/gi);
  check("the page carries no inline event handlers", !handlers, handlers ? handlers.join(" ") : "");
})();

section("Security: no secrets, and no room for one");
(function () {
  var bad = [];
  sourceFiles().forEach(function (rel) {
    if (rel.indexOf("tools") === 0) return;
    var src = read(rel);
    if (/service_role/.test(src) && rel !== "static/js/config.js" && rel !== "README.md") {
      bad.push(rel + " mentions service_role");
    }
    /* A JWT in the source is either a service key or a session token, and
       neither belongs in a repository. The anon key is also a JWT, so the
       check is that config.js is EMPTY in the repository rather than that
       no JWT exists — see below. */
    if (rel !== "static/js/config.js" && /eyJ[A-Za-z0-9_-]{20,}\.eyJ/.test(src)) {
      bad.push(rel + " contains what looks like a JWT");
    }
  });
  check("no token is committed anywhere in the source", bad.length === 0, bad.join(", "));

  var cfg = read("static/js/config.js");
  check("config.js explains why a publishable key is not a secret",
    /anon key/i.test(cfg) && /Row Level Security|RLS/i.test(cfg));
  check("config.js warns against the service role key", /service_role/.test(cfg));
  check("the app still runs without a database configured", /ready\s*=\s*function/.test(cfg));

  /* config.js is the one file allowed to carry a key, so it is the one
     file that gets looked at properly. A publishable key is fine here; a
     service key or a session token is a leak, and the two are told apart
     by shape rather than by trusting whoever pasted it. */
  var url = (cfg.match(/SUPABASE_URL:\s*"([^"]*)"/) || [])[1] || "";
  var anon = (cfg.match(/SUPABASE_ANON_KEY:\s*"([^"]*)"/) || [])[1] || "";
  check("the project URL is blank or a Supabase https URL",
    url === "" || /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url), url);
  check("the key is blank, or publishable, and never a secret one",
    anon === "" ||
    (/^sb_publishable_[A-Za-z0-9_-]+$/.test(anon)) ||
    (/^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\./.test(anon) &&
     Buffer.from(anon.split(".")[1], "base64").toString().indexOf("service_role") === -1),
    anon ? anon.slice(0, 18) + "\u2026" : "blank");
  /* The VALUES, not the prose: the comments in config.js name the secret
     key prefix precisely in order to warn about it, and a check that a
     warning can trip is a check that gets deleted. */
  var literals = (cfg.match(/:\s*"([^"]*)"/g) || []).join(" ");
  check("no value in config.js is a secret key",
    !/sb_secret_|service_role/.test(literals),
    "sb_secret_ / service_role bypasses every policy in the schema");
  check("the CSP allows the origin the config names",
    url === "" || /connect-src[^;]*supabase\.co/.test(HTML.replace(/\s+/g, " ")));

  /* Every module that talks to the database must go through KM.supa, so
     there is one place the token is attached and one place to audit. */
  var direct = [];
  fs.readdirSync(path.join(ROOT, "static/js")).forEach(function (n) {
    if (!/\.js$/.test(n) || n === "supa.js" || n === "config.js") return;
    var s = read(path.join("static/js", n));
    if (/SUPABASE_ANON_KEY|\/rest\/v1|\/auth\/v1/.test(s)) direct.push(n);
  });
  check("only supa.js speaks to the database directly", direct.length === 0, direct.join(", "));
})();

section("Security: the client and the database agree");
(function () {
  var sql = read("supabase/schema.sql");
  var sandbox = makeSandbox(["static/js/sanitize.js"]);
  var L = sandbox.KM.sanitize.LIMITS;

  function constraint(re) { return re.test(sql); }

  check("row level security is on for every table",
    (sql.match(/enable row level security/g) || []).length >= 6,
    (sql.match(/enable row level security/g) || []).length + " tables");

  check("a signed-out visitor can only read",
    /create policy routes_insert[\s\S]{0,120}auth\.uid\(\) is not null/.test(sql));
  check("a route is pinned to its author",
    /routes_insert[\s\S]{0,160}author_id = auth\.uid\(\)/.test(sql));
  check("vote counts are not writable",
    /new\.upvotes\s*:=\s*old\.upvotes/.test(sql));
  check("the validated tag is refused to non-moderators",
    /only a moderator can change the validated tag/.test(sql));
  check("the search function takes its arguments as parameters",
    /create or replace function public\.search_routes\(/.test(sql) &&
    !/execute\s+format/.test(sql),
    "no dynamic SQL anywhere in the schema");
  check("a vote is one atomic call",
    /create or replace function public\.cast_route_vote/.test(sql) &&
    /on conflict \(route_id, user_id\) do update/.test(sql));
  check("negative votes are pushed down in the ranking",
    /least\(3\.0, ln\(1 \+ greatest\(-r\.score, 0\)\)/.test(sql));
  check("anon is granted no write anywhere",
    !/grant (insert|update|delete)[^;]*to[^;]*\banon\b/.test(sql));

  /* The limits sanitize.js applies are only useful if the database
     enforces the same ones; otherwise a client that skips the sanitiser
     writes whatever it likes. */
  check("the route name limit matches the schema",
    constraint(new RegExp("name_len\\s+check \\(char_length\\(name\\) between 3 and " + L.routeName + "\\)")),
    "client says " + L.routeName);
  check("the description limit matches the schema",
    constraint(new RegExp("desc_len[\\s\\S]{0,120}<= " + L.routeDescription)),
    "client says " + L.routeDescription);
  check("the comment limit matches the schema",
    constraint(new RegExp("body_len\\s+check \\(char_length\\(body\\) between 1 and " + L.comment + "\\)")),
    "client says " + L.comment);
  check("the place-name limit matches the schema",
    constraint(new RegExp("origin_len\\s+check \\(char_length\\(origin_name\\) between 1 and " + L.placeName + "\\)")),
    "client says " + L.placeName);
  check("the stop count limit matches the schema",
    constraint(new RegExp("jsonb_array_length\\(stops\\) between " + L.stopsMin + " and " + L.stopsMax)),
    "client says " + L.stopsMin + ".." + L.stopsMax);
  check("the handle shape matches the schema",
    /handle ~ '\^\[a-z\]\[a-z0-9_\]\{2,23\}\$'/.test(sql),
    "client allows " + L.handleMin + ".." + L.handle);

  /* Every route type the client offers must be one the database accepts,
     or filing it fails with a constraint violation nobody can read. */
  var types = makeSandbox(["static/js/transit.js"]).KM.transit.ids();
  var inSql = (sql.match(/route_type in \(([\s\S]*?)\)/) || [])[1] || "";
  var missing = types.filter(function (t) { return inSql.indexOf("'" + t + "'") === -1; });
  check("every route type the app offers is allowed by the database",
    missing.length === 0, missing.join(", "));
})();

/* ============================================================
   3. Behaviour
   ============================================================ */

function makeSandbox(files, opts) {
  opts = opts || {};
  var store = {};
  var sandbox = {
    console: console,
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    setInterval: function () { return 0; }, clearInterval: function () {},
    Promise: Promise, Map: Map, Set: Set, Date: Date, Math: Math, JSON: JSON,
    localStorage: {
      getItem: function (k) { return k in store ? store[k] : null; },
      setItem: function (k, v) { store[k] = String(v); },
      removeItem: function (k) { delete store[k]; }
    },
    navigator: { storage: null, geolocation: null },
    fetch: function () { return Promise.reject(new Error("no network in the harness")); },
    document: opts.needDom ? {
      getElementById: function () { return null; },
      addEventListener: function () {},
      querySelectorAll: function () { return []; },
      createElement: function () { return { style: {}, classList: { add: function () {}, toggle: function () {} }, appendChild: function () {}, setAttribute: function () {} }; }
    } : undefined,
    matchMedia: function () { return { matches: false }; }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read("static/js/util.js"), sandbox, { filename: "util.js" });
  files.forEach(function (f) {
    vm.runInContext(read(f), sandbox, { filename: f });
  });
  return sandbox;
}

section("Behaviour: the sanitiser");
(function () {
  var S = makeSandbox(["static/js/sanitize.js"]).KM.sanitize;

  check("a control character is removed",
    S.line("Cubao\u0000 to Makati") === "Cubao to Makati");
  check("a bidi override is removed",
    S.line("Cubao‮ to Makati").indexOf("‮") === -1,
    "a right-to-left override reorders what is DISPLAYED without changing what is stored");
  check("a zero-width character is removed",
    S.line("Cu​bao") === "Cubao",
    "invisible padding is how a duplicate slips past a uniqueness check");
  check("odd whitespace collapses",
    S.line("Cubao  to  Makati") === "Cubao to Makati");
  check("accents and non-Latin scripts survive",
    S.line("Población — 日本") === "Población — 日本",
    "a filter that rejects a real place name is a bug, not a protection");
  check("a name is capped at its limit",
    S.line(new Array(400).join("x"), 90).length === 90);
  check("a block keeps paragraphs but not a wall of blank lines",
    S.block("a\n\n\n\n\nb") === "a\n\nb");

  check("a handle is narrowed to its alphabet", S.handle("Juan Dela Cruz!") === "juandelacruz");
  check("a handle that starts with a digit is rejected", !!S.handleError("1juan"));
  check("a short handle is rejected", !!S.handleError("ab"));
  check("a good handle passes", S.handleError("juan_dc") === null);

  check("a coordinate out of range is rejected", S.coord(91, 0) === null && S.coord(0, 181) === null);
  check("a coordinate that is not a number is rejected", S.coord("north", 0) === null);
  check("a coordinate is rounded to about 11 cm",
    S.coord(14.59951234567, 120.98421234567).lat === 14.599512);
  check("a negative fare is rejected", S.fare(-5) === null);
  check("an absurd fare is rejected", S.fare(1e9) === null);
  check("a blank fare is null, not zero", S.fare("") === null);
  check("a country code is normalised", S.countryCode("ph") === "PH" && S.countryCode("PHL") === null);
  check("an unknown value in a fixed set is rejected, not defaulted",
    S.oneOf("rocketship", ["jeepney", "bus"]) === null);
  check("PostgREST's own punctuation is stripped from a search",
    S.search("Cubao, (QC).").indexOf(",") === -1);
})();

section("Behaviour: reliability and ranking");
(function () {
  var T = makeSandbox(["static/js/transit.js"]).KM.transit;

  check("no votes means no confidence, not half", T.wilson(0, 0) === 0,
    "starting everything at half would make the meter meaningless on a new board");
  check("more votes at the same ratio means more confidence",
    T.wilson(200, 20) > T.wilson(20, 2));
  check("all-down is the floor", T.wilson(0, 30) === 0);
  check("the bound is never above the ratio", T.wilson(9, 1) < 0.9);

  var fresh = new Date().toISOString();
  var old = new Date(Date.now() - 1200 * 86400000).toISOString();

  check("reliability stays inside 0..1",
    [0, 1].every(function () { return true; }) &&
    T.reliability({ upvotes: 500, downvotes: 0, last_confirmed_at: fresh }) <= 1 &&
    T.reliability({ upvotes: 0, downvotes: 500, last_confirmed_at: fresh }) >= 0);
  check("a stale route is worth less than the same route fresh",
    T.reliability({ upvotes: 50, downvotes: 2, last_confirmed_at: old }) <
    T.reliability({ upvotes: 50, downvotes: 2, last_confirmed_at: fresh }));
  check("a validated route holds a floor",
    T.reliability({ upvotes: 0, downvotes: 0, validated: true, last_confirmed_at: fresh }) >= 0.5);
  check("but a validated route the community rejects does not",
    T.reliability({ upvotes: 1, downvotes: 12, validated: true, last_confirmed_at: fresh }) < 0.3,
    "the tag means it was right when it was checked, not that it outranks everybody");
  check("discussion helps a little and not a lot",
    T.reliability({ upvotes: 10, downvotes: 0, comment_count: 900, last_confirmed_at: fresh }) -
    T.reliability({ upvotes: 10, downvotes: 0, comment_count: 0, last_confirmed_at: fresh }) <= 0.07);

  check("the bands cover the whole range",
    T.band(0).id === "unproven" && T.band(1).id === "strong" && T.band(0.5).id === "fair");

  var good = { upvotes: 30, downvotes: 1, last_confirmed_at: fresh };
  var hated = { upvotes: 1, downvotes: 30, last_confirmed_at: fresh };
  check("a route voted into the ground ranks below one nobody voted on",
    T.rank(hated, 1) < T.rank({ upvotes: 0, downvotes: 0, last_confirmed_at: fresh }, 1),
    "negative votes have to push down, not merely fail to push up");
  check("a well-backed route beats a hated one on the same query",
    T.rank(good, 1) > T.rank(hated, 1));
  check("relevance still matters", T.rank(good, 1) > T.rank(good, 0));
})();

section("Behaviour: talking to PostgREST safely");
(function () {
  var sandbox = makeSandbox(["static/js/sanitize.js", "static/js/config.js", "static/js/supa.js"]);
  var q = sandbox.KM.supa._quote;

  check("a value with a comma stays one value", q("Cubao, Quezon City") === '"Cubao, Quezon City"',
    "an unquoted comma would be read as a second filter");
  check("a value with a parenthesis is quoted", q("Route (old)").charAt(0) === '"');
  check("a quote inside a value is escaped", q('say "hi"').indexOf('\\"') !== -1);
  check("an empty value is still a value", q("") === '""');
  check("a plain value is left alone", q("jeepney") === "jeepney");

  var url = sandbox.KM.supa.from("routes").select("id,name").eq("city", "Cubao, QC").limit(5)._url();
  check("the whole filter is percent-encoded",
    url.indexOf(" ") === -1 && url.indexOf("%2C") !== -1, url);
  check("the query names its table", url.indexOf("/rest/v1/routes?") === 0, url);

  /* Whether config.js happens to be filled in here is not the point; that
     the unconfigured path is still the polite one is. So it is set both
     ways rather than read. */
  var saved = sandbox.KM.config.SUPABASE_URL;
  sandbox.KM.config.SUPABASE_URL = "";
  check("an app with no database configured knows it", sandbox.KM.supa.ready() === false);

  /* The URL stays blank until the refusal has actually landed: a query
     reaches the network on a later microtask than the one that starts it,
     so restoring the config first would let the request through and the
     check would pass for the wrong reason. */
  pending.push(sandbox.KM.supa.from("routes").select("id").run().then(
    function () { return "resolved"; },
    function (err) { return err.kind; }
  ).then(function (kind) {
    check("a request without a database fails cleanly rather than throwing",
      kind === "unconfigured", String(kind));
    sandbox.KM.config.SUPABASE_URL = saved || "https://example.supabase.co";
    check("and with one configured, it is ready", sandbox.KM.supa.ready() === true);
  }));
})();

section("Behaviour: polylines");
(function () {
  var sandbox = makeSandbox(["static/js/sanitize.js", "static/js/router.js"]);
  var R = sandbox.KM.router;
  var KMx = sandbox.KM;

  /* A known polyline5 string from the format's own documentation, decoded
     at precision 5: (38.5,-120.2) (40.7,-120.95) (43.252,-126.453). */
  var pts = R.decode("_p~iF~ps|U_ulLnnqC_mqNvxq`@", 5);
  check("the polyline decoder agrees with the reference example",
    pts.length === 3 &&
    Math.abs(pts[0][0] - 38.5) < 1e-5 && Math.abs(pts[0][1] + 120.2) < 1e-5 &&
    Math.abs(pts[2][0] - 43.252) < 1e-5 && Math.abs(pts[2][1] + 126.453) < 1e-5,
    JSON.stringify(pts));

  var path = [];
  for (var i = 0; i <= 100; i++) path.push([14.6, 121.0 + i * 0.0005]);
  var cum = R.cumulative(path);
  check("cumulative distance starts at zero and rises", cum[0] === 0 && cum[100] > cum[50]);
  check("the total matches the straight line",
    Math.abs(cum[100] - KMx.haversine({ lat: 14.6, lon: 121.0 }, { lat: 14.6, lon: 121.05 })) < 1);

  var sampled = R.sample(path, 500);
  check("sampling is evenly spaced", sampled.length > 8 &&
    Math.abs((sampled[2].along - sampled[1].along) - 500) < 1);
  check("sampling always reaches the end",
    Math.abs(sampled[sampled.length - 1].along - cum[100]) < 2);

  var hit = R.nearestOnPath({ lat: 14.6045, lon: 121.025 }, path, cum);
  check("the nearest point on a path is found",
    hit && Math.abs(hit.along - cum[100] / 2) < 60 && hit.distance > 400 && hit.distance < 560,
    hit ? Math.round(hit.distance) + " m off, " + Math.round(hit.along) + " m along" : "no hit");

  var w = R.walk({ lat: 14.6, lon: 121.0 }, { lat: 14.6, lon: 121.002 });
  check("a walk is longer than the crow flies", w.distance > w.straight);
  check("a walk has a duration a person would recognise",
    w.duration > 150 && w.duration < 300, w.duration + " s for " + w.distance + " m");
})();

section("Behaviour: the journey planner finds a transfer");
(function () {
  var sandbox = makeSandbox([
    "static/js/sanitize.js", "static/js/config.js", "static/js/transit.js",
    "static/js/router.js", "static/js/plan.js"
  ]);
  var P = sandbox.KM.plan;

  /* Two routes that cross at one corner and nowhere else:
       A runs east  along  lat 14.600, lon 121.000 -> 121.050
       B runs north along  lon 121.050, lat 14.600 -> 14.650
     The origin sits on A near its west end, the destination on B near its
     north end. There is no single route between them, so the only answer
     is a change at the corner. */
  function eastWest() {
    var p = [];
    for (var i = 0; i <= 60; i++) p.push([14.600, 121.000 + i * 0.05 / 60]);
    return p;
  }
  function southNorth() {
    var p = [];
    for (var i = 0; i <= 60; i++) p.push([14.600 + i * 0.05 / 60, 121.050]);
    return p;
  }

  var rows = [
    { id: "a", name: "A line", route_type: "jeepney", path: eastWest(),
      distance_m: 5400, duration_s: 900, upvotes: 40, downvotes: 1,
      fare_min: 13, fare_max: 25, currency: "PHP",
      last_confirmed_at: new Date().toISOString() },
    { id: "b", name: "B line", route_type: "bus", path: southNorth(),
      distance_m: 5500, duration_s: 1000, upvotes: 30, downvotes: 0,
      fare_min: 15, fare_max: 30, currency: "PHP",
      last_confirmed_at: new Date().toISOString() }
  ];

  var prepared = P.prepare(rows);
  check("both routes prepare", prepared.length === 2);
  check("a prepared route knows how long it is",
    prepared[0].length > 5000 && prepared[0].length < 5800, Math.round(prepared[0].length) + " m");

  var grid = P.buildGrid(prepared);
  var shared = Object.keys(grid).filter(function (k) { return grid[k].length > 1; });
  check("the two routes share a cell where they cross", shared.length >= 1,
    shared.length + " shared cells");

  var origin = { lat: 14.6001, lon: 121.003 };
  var destination = { lat: 14.6480, lon: 121.0505 };
  var found = P._search(prepared, grid, origin, destination);

  check("a way across is found", found.length >= 1, found.length + " itineraries");
  if (found.length) {
    var best = found[0];
    var rides = best.legs.filter(function (l) { return l.mode === "ride"; });
    check("the best answer is two rides with a change",
      rides.length === 2 && best.transfers === 1,
      rides.length + " rides, " + best.transfers + " transfers");
    check("it uses both routes, in the right order",
      rides.length === 2 && rides[0].route.id === "a" && rides[1].route.id === "b");
    check("it starts and ends with a walk",
      best.legs[0].mode === "walk" && best.legs[best.legs.length - 1].mode === "walk");
    check("the fares are added up", !!best.fare && best.fare.min === 28 && best.fare.max === 55,
      best.fare ? best.fare.min + "-" + best.fare.max : "none");
    check("the duration is plausible for 10 km of jeepney and bus",
      best.duration > 1200 && best.duration < 5400, Math.round(best.duration / 60) + " min");
    check("the walking is counted", best.walkM > 0 && best.walkM < 2000, best.walkM + " m");
    check("the reliability shown is the weakest leg's",
      Math.abs(best.reliability - Math.min(
        sandbox.KM.transit.reliability(rows[0]),
        sandbox.KM.transit.reliability(rows[1]))) < 1e-9,
      "the weak leg is the one that strands you");
  }

  /* A short hop must not be answered with a jeepney. */
  var near = P._search(prepared, grid, { lat: 14.6001, lon: 121.003 }, { lat: 14.6003, lon: 121.0045 });
  check("a two-hundred-metre trip is answered with a walk",
    near.length >= 1 && near[0].legs.length === 1 && near[0].legs[0].mode === "walk",
    near.length ? near[0].legs.length + " legs" : "nothing offered");

  /* And a route people have voted down must lose to one they have not,
     all else equal. */
  var hated = JSON.parse(JSON.stringify(rows));
  hated[0].upvotes = 0; hated[0].downvotes = 60;
  var hatedPrepared = P.prepare(hated);
  check("an unreliable leg costs more than a trusted one",
    hatedPrepared[0].reliability < prepared[0].reliability);
})();

section("Behaviour: what the builder sends");
(function () {
  var sandbox = makeSandbox([
    "static/js/sanitize.js", "static/js/config.js", "static/js/transit.js", "static/js/supa.js"
  ]);
  /* routes.js needs KM.supa, which it has, and no DOM. */
  vm.runInContext(read("static/js/routes.js"), sandbox, { filename: "routes.js" });
  var V = sandbox.KM.routes.validate;

  var path = [];
  for (var i = 0; i <= 40; i++) path.push([14.6 + i * 0.001, 121.0]);

  var good = V({
    name: "Cubao to Montalban",
    route_type: "jeepney",
    origin_name: "Cubao",
    destination_name: "Montalban",
    stops: [{ lat: 14.6, lon: 121.0, name: "Cubao" }, { lat: 14.64, lon: 121.0, name: "Montalban" }],
    path: path,
    distance_m: 4400, duration_s: 1200,
    fare_min: "13", fare_max: "45", city: "Quezon City", country_code: "ph"
  });
  check("a well-formed route validates", good.ok, JSON.stringify(good.errors));
  check("the country code is normalised on the way out", good.value.country_code === "PH");
  check("a fare arrives as a number", good.value.fare_min === 13);

  var noStops = V({ name: "Nowhere line", route_type: "bus", origin_name: "a", destination_name: "b", stops: [], path: [] });
  check("a route with no stops is refused", !noStops.ok && !!noStops.errors.stops);

  var badType = V({ name: "Teleporter", route_type: "warp", origin_name: "a", destination_name: "b",
    stops: [{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }], path: path });
  check("an unknown route type is refused, not defaulted", !!badType.errors.route_type);

  var swapped = V({
    name: "Backwards fares", route_type: "bus", origin_name: "a", destination_name: "b",
    stops: [{ lat: 1, lon: 1, name: "a" }, { lat: 2, lon: 2, name: "b" }], path: path,
    fare_min: "90", fare_max: "20"
  });
  check("fares given the wrong way round are swapped rather than refused",
    swapped.value.fare_min === 20 && swapped.value.fare_max === 90);

  var huge = [];
  for (var j = 0; j < 9000; j++) huge.push([14.6 + j * 1e-5, 121.0]);
  var thinned = V({
    name: "Very long line", route_type: "bus", origin_name: "a", destination_name: "b",
    stops: [{ lat: 1, lon: 1, name: "a" }, { lat: 2, lon: 2, name: "b" }], path: huge
  });
  check("a path longer than the database allows is thinned, not rejected",
    thinned.value.path.length <= 4000 && thinned.value.path.length > 1000,
    thinned.value.path.length + " points");

  var nasty = V({
    name: "  Cubao‮​ to  Makati  ", route_type: "jeepney",
    origin_name: "Cubao\u0000", destination_name: "Makati",
    stops: [{ lat: 14.6, lon: 121.0, name: "a" }, { lat: 14.64, lon: 121.0, name: "b" }],
    path: path
  });
  check("a name is cleaned on the way out of the client",
    nasty.value.name === "Cubao to Makati" && nasty.value.origin_name === "Cubao",
    JSON.stringify(nasty.value.name));
})();

section("Behaviour: formatting");
(function () {
  var KMx = makeSandbox([]).KM;
  check("a fare range reads as one", KMx.fmtFare(13, 45, "PHP") === "₱13–45");
  check("a single fare has no range", KMx.fmtFare(13, 13, "PHP") === "₱13");
  check("no fare is no text", KMx.fmtFare(null, null, "PHP") === "");
  check("a foreign currency keeps its code", KMx.fmtFare(2, 3, "SGD").indexOf("SGD") === 0);
  check("distance switches units sensibly",
    KMx.fmtDist(450) === "450 m" && KMx.fmtDist(4500) === "4.5 km" && KMx.fmtDist(45000) === "45 km");
  check("a duration reads in hours and minutes", KMx.fmtDur(5400) === "1 h 30 min");
  check("a count is abbreviated past a thousand", KMx.fmtCount(2400) === "2.4k");
  check("a time ago is coarse", KMx.fmtAgo(new Date(Date.now() - 3 * 86400000)) === "3 days ago");
  check("an unparseable date says nothing rather than NaN", KMx.fmtAgo("not a date") === "");
  check("the HTML escaper covers the five",
    KMx.escapeHtml("<a href=\"x\">&'") === "&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
})();

/* ============================================================
   Result
   ============================================================ */
Promise.all(pending).then(function () {
  process.stdout.write("\n" + checks + " checks, " + failures.length + " failed\n");
  if (failures.length) {
    process.stdout.write("\n" + failures.map(function (f) { return "  ✗ " + f; }).join("\n") + "\n");
    process.exit(1);
  }
  process.stdout.write("All good.\n");
});
