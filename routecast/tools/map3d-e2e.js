/* tools/map3d-e2e.js — the 3D view, in a real browser.
 *
 * Everything the tilted map does is a claim about a GPU, a camera and a set
 * of gesture handlers, and not one of those exists in a sandbox with a
 * JavaScript context and no DOM. tools/validate.js can check that the styles
 * are styles and that the wiring is still wired; it cannot check that a drag
 * moves the map, and a drag that does not move the map is the whole feature
 * gone.
 *
 * So this drives Chromium through a ride: the camera tilts, the map turns to
 * the heading, a drag hands the map to the rider, Re-centre hands it back, a
 * two-finger twist turns it, a two-finger drag tilts it and the tilt sticks,
 * the overlays Leaflet drew are mirrored into the scene, and leaving the ride
 * takes every one of them away again.
 *
 * Nothing here touches the internet: the page is served from disk and every
 * outside request is refused, which is also a test in itself — the vector
 * style is built locally, so the map must come up with no tile server at all.
 *
 * Run: node tools/map3d-e2e.js
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json"
};

let failures = 0;
function check(name, ok, extra) {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (ok || extra === undefined ? "" : "  -> " + extra));
  if (!ok) failures++;
}
function section(t) { console.log("\n" + t); }

function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html";
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server)));
}

const RIDER = { lat: 14.6, lon: 120.98, course: 45 };

async function main() {
  const site = await serve();
  const origin = "http://127.0.0.1:" + site.address().port;

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 400, height: 800 }, hasTouch: true, isMobile: true
  });
  const page = await ctx.newPage();

  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message)));
  page.on("console", (m) => {
    // A missing tile is the point of the exercise, not a failure.
    if (m.type() === "error" && !/ERR_|AJAX|Failed to fetch|Failed to load resource/.test(m.text())) {
      errors.push(m.text());
    }
  });
  await page.route("**/*", (r) => (r.request().url().startsWith(origin) ? r.continue() : r.abort()));

  await page.goto(origin + "/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(600);

  /* A recorded ride, so the heat map has roads to draw, and two marks, so
     there are markers to mirror. Both go in before the reload that puts them
     on the map the way a returning rider would find them. */
  await page.evaluate((r) => {
    window.RC.marks.save({ name: "Gate", lat: r.lat + 0.004, lon: r.lon + 0.004 });
    window.RC.history.startSession("motorcycle");
    let t = Date.now() - 3600e3;
    for (let i = 0; i < 260; i++) {
      t += 4000;
      window.RC.history.record({ lat: r.lat + i * 0.00012, lon: r.lon + i * 0.00012, t: t, speedKmh: 42 });
    }
    window.RC.history.endSession();
  }, RIDER);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);

  const state = () => page.evaluate(() => window.RC.gl.state());
  const settle = (ms) => page.waitForTimeout(ms || 400);

  section("The camera");
  await page.evaluate(() => {
    window.RC.follow.enable({ zoom: 16 });
    window.RC.layers.setDriveBase("streets");
    window.RC.layers.enterDrive();
  });
  await page.waitForFunction(() => window.RC.gl.state().ready, null, { timeout: 30000 });
  check("a vector map comes up with no tile server at all", (await state()).on);

  await page.evaluate((r) => {
    window.RC.compass.setMode("course", { gesture: false });
    window.RC.compass.setCourse(r.course, 40, r.course);
    window.RC.layers.rider(r.lat, r.lon, r.course);
  }, RIDER);
  await settle(900);

  let s = await state();
  check("the view is tilted", s.pitch > 40, "pitch=" + s.pitch.toFixed(1));
  check("and turned to the heading the compass chose",
        Math.abs(s.bearing - RIDER.course) < 6, "bearing=" + s.bearing.toFixed(1));
  check("the rider is drawn as geometry on the road", s.rider);
  check("the camera is following", s.following === true);

  section("The map moves");
  /* A finger, not a mouse: this is a phone on a handlebar, and MapLibre's
     touch handlers are the ones that will actually be used. */
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, pts) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: i })) });

  const before = await state();
  await touch("touchStart", [[200, 420]]);
  for (let i = 1; i <= 10; i++) await touch("touchMove", [[200 - 7 * i, 420 - 11 * i]]);
  await touch("touchEnd", []);
  await settle(500);
  let after = await state();
  check("a drag moves the map",
        Math.abs(after.centre[0] - before.centre[0]) > 1e-5 ||
        Math.abs(after.centre[1] - before.centre[1]) > 1e-5,
        JSON.stringify(before.centre) + " -> " + JSON.stringify(after.centre));
  check("and hands it to the rider", after.following === false);
  check("so the Re-centre pill is offered",
        await page.evaluate(() => !window.RC.el("recentre").hidden));

  await page.evaluate(() => window.RC.follow.recenter());
  await settle(700);
  after = await state();
  check("Re-centre gives the camera the map back", after.following === true);
  check("and it comes back to the rider",
        Math.abs(after.centre[0] - RIDER.lat) < 0.002, JSON.stringify(after.centre));

  section("Two fingers");
  const beforeTwist = (await state()).bearing;
  await touch("touchStart", [[150, 450], [250, 450]]);
  for (let i = 1; i <= 8; i++) {
    const a = (i * 5 * Math.PI) / 180;
    await touch("touchMove", [[200 - 50 * Math.cos(a), 450 - 50 * Math.sin(a)],
                              [200 + 50 * Math.cos(a), 450 + 50 * Math.sin(a)]]);
  }
  await touch("touchEnd", []);
  await settle(400);
  const twisted = await state();
  check("a two-finger twist turns the map",
        Math.abs(twisted.bearing - beforeTwist) > 4,
        beforeTwist.toFixed(1) + " -> " + twisted.bearing.toFixed(1));

  await page.evaluate(() => window.RC.follow.recenter());
  await settle(500);
  const beforeTilt = (await state()).pitch;
  await touch("touchStart", [[170, 520], [230, 520]]);
  for (let i = 1; i <= 8; i++) await touch("touchMove", [[170, 520 - i * 12], [230, 520 - i * 12]]);
  await touch("touchEnd", []);
  await settle(400);
  const tilted = await state();
  check("a two-finger drag tilts it",
        Math.abs(tilted.pitch - beforeTilt) > 1, beforeTilt.toFixed(1) + " -> " + tilted.pitch.toFixed(1));

  /* The rule the flat map already follows for zoom: what the rider chose is
     what the camera resumes at, or they stop touching it. */
  const chosen = tilted.pitch;
  await page.evaluate(() => window.RC.follow.recenter());
  await settle(900);
  check("and the chase keeps the tilt the rider chose",
        Math.abs((await state()).pitch - chosen) < 2, "kept " + chosen.toFixed(1));

  section("Everything else is in the scene too");
  s = await state();
  check("the marks Leaflet drew are mirrored into it", s.markers > 0, "markers=" + s.markers);
  const shown = await page.evaluate(() => window.RC.heat.show());
  await settle(700);
  s = await state();
  check("the heat map is drawn in 3D as well", shown && s.lines > 0, "lines=" + s.lines);

  const scaled = await page.evaluate(() => {
    const el = document.querySelector(".rc-gl-marker-in");
    return el ? el.style.transform : "";
  });
  check("a mirrored marker is scaled by how far away it is", /scale\(/.test(scaled), scaled || "no transform");

  /* Changing the map under a running ride throws away every source and
     layer the 3D view added. It used to leave the rider looking at an empty
     world with a ride in progress. */
  section("Changing the map mid-ride");
  await page.evaluate(() => window.RC.layers.setDriveBase("midnight"));
  await page.waitForFunction(() => window.RC.gl.state().base === "midnight" && window.RC.gl.state().ready,
                             null, { timeout: 30000 });
  await settle(1200);
  s = await state();
  check("the new map comes up", s.base === "midnight");
  check("and the rider survives it", s.rider);
  check("and so does everything drawn over it", s.lines > 0 && s.markers > 0,
        "lines=" + s.lines + " markers=" + s.markers);

  section("Putting it away");
  await page.evaluate(() => window.RC.layers.leaveDrive());
  await settle(700);
  s = await state();
  check("leaving the ride takes the camera down", s.driving === false);
  check("and every mirrored marker with it",
        (await page.evaluate(() => document.querySelectorAll(".rc-gl-marker").length)) === 0);
  check("the flat overlays are back",
        await page.evaluate(() => getComputedStyle(document.querySelector(".leaflet-map-pane")).display !== "none"));
  check("no script threw along the way", errors.length === 0, errors.slice(0, 3).join(" | "));

  await browser.close();
  site.close();

  console.log("\n" + (failures ? "FAILED" : "PASSED") + " — " + failures + " failure(s)\n");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
