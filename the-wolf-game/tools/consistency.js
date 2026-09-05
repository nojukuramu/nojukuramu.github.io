/* consistency.js — the checks that catch drift between files that must agree.
 *
 * Three pairs get out of step silently, and each one produces a bug that looks
 * like something else:
 *
 *   1. The base palette lives in css/theme.css (what the page looks like with
 *      no JavaScript) and again in js/ui/theme.js (what gets blended with the
 *      sky). If they disagree, the app changes colour the instant the theme
 *      engine starts, which reads as a flash rather than as a bug.
 *   2. The ?v= stamps in index.html, sw.js and the service worker's precache
 *      list. A mismatch serves one deploy's HTML with another's CSS for exactly
 *      one load.
 *   3. Every file index.html loads has to exist, and every role module has to
 *      be loaded. A role that is never scripted throws at link() — but only
 *      once somebody opens the page.
 *
 * Run: node tools/consistency.js
 */
"use strict";
var fs = require("fs"), path = require("path");
var ROOT = path.join(__dirname, "..");
var pass = 0, fail = 0;
function ok(l, c, x) { if (c) { pass++; console.log("  ✓ " + l); } else { fail++; console.log("  ✗ " + l + (x ? "  <- " + x : "")); } }
function read(p) { return fs.readFileSync(path.join(ROOT, p), "utf8"); }

var css = read("css/theme.css");
var themeJs = read("js/ui/theme.js");
var html = read("index.html");
var sw = read("sw.js");

console.log("\nThe palette is written twice and must agree");
(function () {
  function fromCss(block) {
    var out = {};
    var re = /--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g, m;
    while ((m = re.exec(block))) out[m[1]] = m[2].toLowerCase();
    return out;
  }
  // The light block is bare :root; the explicit dark block is html[data-theme="dark"].
  var lightBlock = css.slice(css.indexOf(":root {"), css.indexOf('html[data-theme="dark"] { color-scheme'));
  var darkStart = css.lastIndexOf('html[data-theme="dark"] {');
  var darkBlock = css.slice(darkStart);
  var cssLight = fromCss(lightBlock), cssDark = fromCss(darkBlock);

  var jsBlock = themeJs.slice(themeJs.indexOf("var BASE = {"), themeJs.indexOf("var PULL"));
  function fromJs(name) {
    var seg = jsBlock.slice(jsBlock.indexOf(name + ": {"));
    seg = seg.slice(0, seg.indexOf("}"));
    var out = {}, re = /"?([a-z0-9-]+)"?:\s*"(#[0-9a-fA-F]{6})"/g, m;
    while ((m = re.exec(seg))) out[m[1]] = m[2].toLowerCase();
    return out;
  }
  var jsLight = fromJs("light"), jsDark = fromJs("dark");

  ["light", "dark"].forEach(function (mode) {
    var a = mode === "light" ? cssLight : cssDark;
    var b = mode === "light" ? jsLight : jsDark;
    var keys = Object.keys(b);
    var bad = keys.filter(function (k) { return a[k] !== b[k]; });
    ok(mode + ": every token the blender touches matches the stylesheet",
      bad.length === 0,
      bad.map(function (k) { return k + " css=" + a[k] + " js=" + b[k]; }).join(", "));
    ok(mode + ": the blender covers something real", keys.length >= 10, String(keys.length));
  });
})();

console.log("\nCache-busting stamps agree");
(function () {
  var htmlV = /\?v=([0-9.]+)/.exec(html);
  var swV = /ASSET_V = "([0-9.]+)"/.exec(sw);
  ok("index.html stamps a version", !!htmlV);
  ok("sw.js names the same one", htmlV && swV && htmlV[1] === swV[1],
    (htmlV && htmlV[1]) + " vs " + (swV && swV[1]));
  var stamps = (html.match(/\?v=[0-9.]+/g) || []).map(function (s) { return s.slice(3); });
  ok("every asset in index.html carries it", new Set(stamps).size === 1, JSON.stringify([].concat(new Set(stamps))));
})();

console.log("\nEverything index.html loads exists, and nothing is missed");
(function () {
  var srcs = (html.match(/src="([^"]+)"/g) || []).map(function (s) { return s.slice(5, -1).split("?")[0]; });
  var hrefs = (html.match(/href="([^"]+\.(?:css|webmanifest|png))[^"]*"/g) || [])
    .map(function (s) { return /href="([^"?]+)/.exec(s)[1]; });
  var missing = srcs.concat(hrefs).filter(function (f) { return !fs.existsSync(path.join(ROOT, f)); });
  ok("no dead script or stylesheet references", missing.length === 0, missing.join(", "));

  var roleFiles = fs.readdirSync(path.join(ROOT, "js/roles")).filter(function (f) { return f.endsWith(".js"); });
  var loaded = srcs.filter(function (s) { return s.indexOf("js/roles/") === 0; })
    .map(function (s) { return s.split("/").pop(); });
  var notLoaded = roleFiles.filter(function (f) { return loaded.indexOf(f) < 0; });
  ok("every role module is on the page", notLoaded.length === 0, notLoaded.join(", "));
  ok("the generic actions load before the roles that use them",
    loaded[0] === "_generic.js", loaded[0]);

  var data = JSON.parse(read("data/list_of_roles.json"));
  var declared = data.roles.map(function (r) { return r.id + ".js"; });
  var orphans = roleFiles.filter(function (f) { return f !== "_generic.js" && declared.indexOf(f) < 0; });
  var unimplemented = declared.filter(function (f) { return roleFiles.indexOf(f) < 0; });
  ok("no role module without a data entry", orphans.length === 0, orphans.join(", "));
  ok("no data entry without a role module", unimplemented.length === 0, unimplemented.join(", "));
  ok("the service worker precaches the data files",
    ["list_of_roles", "game_flow", "sky", "list_of_events"].every(function (n) { return sw.indexOf(n + ".json") > 0; }));
})();

console.log("\nThe flow and the sky refer to each other correctly");
(function () {
  var flow = JSON.parse(read("data/game_flow.json"));
  var sky = JSON.parse(read("data/sky.json"));
  var bad = [];
  flow.phases.forEach(function (p) {
    if (!p.sky) return bad.push(p.id + ": no sky");
    if (!sky.stops[p.sky.from]) bad.push(p.id + ": unknown from " + p.sky.from);
    if (!sky.stops[p.sky.to]) bad.push(p.id + ": unknown to " + p.sky.to);
  });
  ok("every phase names sky stops that exist", bad.length === 0, bad.join(", "));

  var ids = flow.phases.map(function (p) { return p.id; });
  var dangling = flow.phases.filter(function (p) { return p.next && ids.indexOf(p.next) < 0; });
  ok("every `next` points at a real phase", dangling.length === 0,
    dangling.map(function (p) { return p.id + "->" + p.next; }).join(", "));

  var loop = [], id = "night";
  for (var i = 0; i < 12 && id; i++) {
    if (loop.indexOf(id) >= 0) break;
    loop.push(id);
    id = (flow.phases.filter(function (p) { return p.id === id; })[0] || {}).next;
  }
  ok("the round is a loop, not a dead end", id === "night", loop.join(">") + " then " + id);
})();

console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
