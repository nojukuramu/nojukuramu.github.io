/* version-check.js — one version number, three files.
 *
 * index.html stamps ?v=… on every stylesheet, script and data file, so a
 * deploy's HTML can never be served with the previous deploy's code out of a
 * cache. That only holds while the number actually changes, and while sw.js
 * precaches the same URLs the page asks for. Both are easy to forget by hand,
 * so this fails loudly instead of shipping a half-updated app.
 *
 * Run: node tools/version-check.js
 */
"use strict";
var fs = require("fs"), path = require("path");
var ROOT = path.resolve(__dirname, "..");
function read(f) { return fs.readFileSync(path.join(ROOT, f), "utf8"); }

var html = read("index.html"), sw = read("sw.js"), app = read("js/app.js");
var pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FAIL " + label + (extra === undefined ? "" : "  -> " + extra)); }
}

/* The page declares the version once, in the loader at the bottom, and hands
 * it to the app as WG.VERSION. Everything else has to agree with that. */
var V = (html.match(/var V = "([^"]+)";/) || [])[1];
var assetV = (sw.match(/ASSET_V\s*=\s*"([^"]+)"/) || [])[1];
ok("index.html declares a version", !!V, V);
ok("sw.js declares ASSET_V", !!assetV, assetV);
ok("sw.js ASSET_V matches", assetV === V, assetV + " vs " + V);

var refs = (html.match(/(?:href|src)="((?:css|js|manifest)[^"]*)"/g) || [])
  .map(function (m) { return m.replace(/^(?:href|src)="/, "").replace(/"$/, ""); })
  .filter(function (r) { return /\.(?:css|js|webmanifest)/.test(r); });
ok("index.html references local assets", refs.length > 10, String(refs.length));
var unstamped = refs.filter(function (r) { return r.indexOf("?v=" + V) < 0; });
ok("every asset carries ?v=" + V, unstamped.length === 0, unstamped.slice(0, 4).join(", "));

/* The data files are fetched by script rather than linked, and they are the
 * game itself — a stale list_of_roles.json is a room where a role quietly
 * does the wrong thing. */
var fetched = (html.match(/fetch\("data\/[^"]+"/g) || []);
ok("the data files are fetched with the version", fetched.length === 4 &&
   fetched.every(function (f) { return /\?v=" \+ V|\?v=/.test(f); }), fetched.join(" "));

/* And the worker precaches what an offline start actually asks for. */
var swFiles = (sw.match(/"\.\/(?:css|js|data)\/[^"]*"/g) || [])
  .map(function (m) { return m.slice(3, -1).split("?")[0]; });
["css/theme.css", "css/app.css", "data/list_of_roles.json", "data/game_flow.json",
 "data/sky.json", "data/list_of_events.json"].forEach(function (f) {
  ok("precached: " + f, swFiles.indexOf(f) >= 0);
});

/* The worker itself is fetched by a fixed URL: a query string there would
 * orphan every existing installation. */
ok("sw.js registered at a stable URL", /register\("\.\/sw\.js"\)/.test(app));

/* And it must not take over on its own. The handover is the player's call —
 * a build swapping in under a running night would take the room with it. */
var calls = sw.match(/self\.skipWaiting\(\)/g) || [];
var handover = sw.indexOf('e.data === "skip-waiting"');
ok("the worker takes over in exactly one place", calls.length === 1, String(calls.length));
ok("and only when the page asks it to",
   handover >= 0 && sw.indexOf("self.skipWaiting()", handover) > handover &&
   sw.indexOf("self.skipWaiting()", handover) - handover < 80);
ok("the page offers the update rather than forcing it",
   /skip-waiting/.test(app) && /checkForUpdate/.test(app));

console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
