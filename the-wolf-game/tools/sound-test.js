/* sound-test.js — the audio actually makes a sound, and only when allowed to.
 *
 * Everything is synthesised, so there is nothing to load and nothing to 404 —
 * but there is plenty to get wrong: a voice that throws, a bed that never
 * starts, or a game that makes noise before the player has touched anything.
 * This renders each voice into an OfflineAudioContext in a real browser and
 * checks that something came out.
 *
 * Run: node tools/sound-test.js
 */
"use strict";
var { chromium } = require("/opt/node22/lib/node_modules/playwright");
var http = require("http"), fs = require("fs"), path = require("path");
var ROOT = path.join(__dirname, ".."), PORT = 8991;
var TYPES = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png" };
var pass = 0, fail = 0;
function ok(l, c, x) { if (c) { pass++; console.log("  ok  " + l); } else { fail++; console.log("  FAIL " + l + (x ? "  <- " + x : "")); } }

http.createServer(function (q, p) {
  var u = decodeURIComponent(q.url.split("?")[0]);
  var f = path.join(ROOT, u === "/" ? "/index.html" : u);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { p.writeHead(404); return p.end(); }
  p.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "text/plain" });
  p.end(fs.readFileSync(f));
}).listen(PORT, async function () {
  var browser = await chromium.launch({
    executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"]
  });
  var page = await browser.newPage();
  var errs = [];
  page.on("pageerror", function (e) { errs.push(e.message); });
  await page.goto("http://127.0.0.1:" + PORT + "/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(function () { return window.WG && WG.sound; });

  console.log("\nNothing plays before a gesture");
  ok("the engine starts locked", !(await page.evaluate(function () { return WG.sound.ready; })));
  ok("and play() on a locked engine is a no-op, not a throw",
    await page.evaluate(function () { try { WG.sound.play("howl"); return true; } catch (e) { return false; } }));

  console.log("\nEvery voice renders actual audio");
  var results = await page.evaluate(async function () {
    /* Each voice is rendered on its own into an offline context. The module
     * binds to one context at init, so the test swaps the constructor for an
     * offline one and re-initialises per voice — which also proves the voices
     * do not depend on anything the live context set up. */
    var names = WG.sound.voices;
    var out = {};
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      var offline = new OfflineAudioContext(2, 44100 * 4, 44100);
      var RealAC = window.AudioContext;
      window.AudioContext = function () { return offline; };
      // Force a fresh init against the offline context.
      delete window.WG.sound;
      var src = await fetch("js/ui/sound.js?probe=" + i).then(function (r) { return r.text(); });
      (0, eval)(src);
      window.WG.sound.unlock();
      window.WG.sound.play(name);
      window.AudioContext = RealAC;
      var buf = await offline.startRendering();
      var d = buf.getChannelData(0);
      var peak = 0, energy = 0;
      for (var k = 0; k < d.length; k++) { var v = Math.abs(d[k]); if (v > peak) peak = v; energy += v; }
      out[name] = { peak: Math.round(peak * 1000) / 1000, rms: Math.round((energy / d.length) * 10000) / 10000 };
    }
    return out;
  });

  Object.keys(results).forEach(function (name) {
    var r = results[name];
    ok(name.padEnd(7) + " peak " + r.peak, r.peak > 0.005 && r.peak < 1.6, JSON.stringify(r));
  });

  console.log("\nThe ambient bed follows the phase");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(function () { return window.WG && WG.sound; });
  var bed = await page.evaluate(function () {
    WG.sound.unlock();
    WG.sound.scene("night");
    var a = WG.sound.ready;
    WG.sound.scene("day");
    WG.sound.scene("none");
    WG.sound.setEnabled(false);
    WG.sound.setEnabled(true);
    return a;
  });
  ok("scenes can be swapped without throwing", bed === true);
  ok("no page errors anywhere", errs.length === 0, errs.slice(0, 2).join(" | "));

  await browser.close();
  console.log("\n" + pass + " passed, " + fail + " failed\n");
  process.exit(fail ? 1 : 0);
});
