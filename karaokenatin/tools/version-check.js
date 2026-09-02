/* tools/version-check.js — one version number, three files.
 *
 * index.html stamps ?v=… on every stylesheet and script so a deploy's HTML can
 * never be served with the previous deploy's code out of a cache. That only
 * holds while the number actually changes, and while sw.js precaches the same
 * URLs the page asks for. Both are easy to forget by hand, so this fails loudly
 * instead.
 *
 * Run: node tools/version-check.js
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

const html = read("index.html");
const sw = read("sw.js");
const app = read("js/app.js");

let failures = 0;
function check(name, ok, extra) {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (ok || extra === undefined ? "" : "  → " + extra));
  if (!ok) failures++;
}

const appVersion = (app.match(/APP_VERSION\s*=\s*"([^"]+)"/) || [])[1];
const assetV = (sw.match(/ASSET_V\s*=\s*"([^"]+)"/) || [])[1];
check("js/app.js declares APP_VERSION", !!appVersion, appVersion);
check("sw.js declares ASSET_V", !!assetV, assetV);
check("sw.js ASSET_V matches APP_VERSION", assetV === appVersion, assetV + " vs " + appVersion);

// Every local stylesheet and script in the page carries that same version.
const refs = [...html.matchAll(/(?:href|src)="((?:css|js)\/[^"]+)"/g)].map((m) => m[1]);
check("index.html references local css/js", refs.length > 0, String(refs.length));
refs.forEach(function (ref) {
  check("versioned: " + ref, ref.endsWith("?v=" + appVersion));
});

// And the worker precaches exactly those URLs, or an offline start misses them.
const swFiles = [...sw.matchAll(/"\.\/((?:css|js)\/[^"]+)"/g)].map((m) => m[1]);
refs.forEach(function (ref) {
  const bare = ref.split("?")[0];
  check("precached: " + bare, swFiles.indexOf(bare) !== -1);
});

// The service worker itself must never be versioned away: the browser fetches
// it by a fixed URL, and a query string there would orphan every installation.
check("sw.js registered at a stable URL", /register\("sw\.js"\)/.test(app));

console.log(failures ? "\n" + failures + " problem(s)" : "\nversions agree");
process.exit(failures ? 1 : 0);
