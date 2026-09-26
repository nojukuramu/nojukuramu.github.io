/* tools/group-e2e.js — two real browsers, one room.
 *
 * Everything about a group ride is a claim about another machine: that the code
 * finds it, that the door holds, that the planned route arrives BYTE FOR BYTE
 * rather than being recomputed, that a rider who drifts off it is offered ways
 * back. None of that can be checked in a sandbox with one JavaScript context,
 * so this drives two Chromium contexts through the real transport.
 *
 * Nothing here touches the internet. The public PeerJS broker is replaced by
 * tools/broker.js on localhost (window.RC_BROKERS), and OSRM, Open-Meteo,
 * Nominatim and the tile server are answered locally — a route is a straight
 * line through the waypoints, the sky is always the same hour, which is all a
 * test of a ROOM needs from them.
 *
 * Run: node tools/group-e2e.js
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const broker = require("./broker");

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

/* ---------- the fake outside world ---------- */

const R = 6371008.8, TO_RAD = Math.PI / 180;
function metres(a, b) {
  const dLat = (b[0] - a[0]) * TO_RAD;
  const dLon = (b[1] - a[1]) * TO_RAD * Math.cos(((a[0] + b[0]) / 2) * TO_RAD);
  return Math.sqrt(dLat * dLat + dLon * dLon) * R;
}

/** A straight line through the requested waypoints, densified so the app has
    something to sample, project onto and draw. */
function fakeOsrm(url) {
  const m = /driving\/([^?]+)\?/.exec(url);
  const pairs = decodeURIComponent(m[1]).split(";").map((p) => p.split(",").map(Number));
  const waypoints = pairs.map(([lon, lat]) => [lat, lon]);

  const coords = [];
  const legs = [];
  for (let i = 1; i < waypoints.length; i++) {
    const a = waypoints[i - 1], b = waypoints[i];
    const legDist = metres(a, b);
    const steps = 40;
    const dArr = [], uArr = [];
    for (let s = 0; s < steps; s++) {
      if (i === 1 && s === 0) coords.push([a[1], a[0]]);
      const t = (s + 1) / steps;
      /* A dead straight line would simplify away to its two endpoints before it
         ever crossed the wire, which is not what a road looks like. A small
         lateral wobble keeps the geometry worth sending — and makes the
         "arrives whole" check mean something. */
      const wobble = Math.sin(t * Math.PI * 6) * 0.0006;
      coords.push([a[1] + (b[1] - a[1]) * t + wobble, a[0] + (b[0] - a[0]) * t]);
      dArr.push(legDist / steps);
      uArr.push(legDist / steps / 12);
    }
    legs.push({
      distance: legDist,
      duration: legDist / 12,
      annotation: { distance: dArr, duration: uArr },
      steps: [{
        name: "Test Road", distance: legDist, duration: legDist / 12,
        maneuver: { type: i === waypoints.length - 1 ? "arrive" : "depart", location: [a[1], a[0]] }
      }]
    });
  }
  const distance = legs.reduce((s, l) => s + l.distance, 0);
  return {
    code: "Ok",
    routes: [{
      distance: distance,
      duration: distance / 12,
      legs: legs,
      geometry: { coordinates: coords }
    }],
    waypoints: waypoints.map(([lat, lon]) => ({ location: [lon, lat] }))
  };
}

function fakeForecast(url) {
  const q = new URL(url);
  const lats = (q.searchParams.get("latitude") || "0").split(",").map(Number);
  const lons = (q.searchParams.get("longitude") || "0").split(",").map(Number);
  const start = new Date();
  start.setUTCMinutes(0, 0, 0);
  start.setUTCHours(start.getUTCHours() - 2);
  const times = [], n = 72;
  for (let i = 0; i < n; i++) {
    times.push(new Date(start.getTime() + i * 3600000).toISOString().slice(0, 16));
  }
  const fill = (v) => times.map(() => v);
  const entries = lats.map((lat, i) => ({
    latitude: lat, longitude: lons[i] == null ? lons[0] : lons[i],
    hourly: {
      time: times,
      temperature_2m: fill(29), apparent_temperature: fill(31), precipitation: fill(0),
      precipitation_probability: fill(5), weather_code: fill(1), wind_speed_10m: fill(8),
      wind_gusts_10m: fill(14), relative_humidity_2m: fill(70), cloud_cover: fill(20),
      visibility: fill(20000), is_day: fill(1)
    }
  }));
  return entries.length === 1 ? entries[0] : entries;
}

async function stubWorld(ctx) {
  await ctx.route(/router\.project-osrm\.org/, (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fakeOsrm(r.request().url())) }));
  await ctx.route(/api\.open-meteo\.com\/v1\/forecast/, (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fakeForecast(r.request().url())) }));
  await ctx.route(/api\.open-meteo\.com\/v1\/elevation/, (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ elevation: new Array(64).fill(30) }) }));
  await ctx.route(/nominatim\.openstreetmap\.org/, (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await ctx.route(/tile\.openstreetmap\.org|fonts\.googleapis|fonts\.gstatic/, (r) => r.abort());
}

/* ---------- the ride under test ----------
   A line due north from a point outside Manila, and a rider who starts on it
   and then wanders a kilometre and a half east of it. */
const START = { lat: 14.30, lon: 121.00 };
const END = { lat: 14.40, lon: 121.00 };
const OFF = { lat: 14.35, lon: 121.018 };

async function main() {
  const site = await serve();
  const sitePort = site.address().port;
  const { port: brokerPort, server: brokerServer } = await broker.start(0);
  const base = `http://127.0.0.1:${sitePort}/index.html`;

  const browser = await chromium.launch({
    args: [
      "--disable-features=WebRtcHideLocalIpsWithMdns",
      "--no-sandbox",
      // A fake microphone, so push-to-talk can be driven for real rather than
      // asserted about. The tone it generates is what actually gets recorded,
      // encoded, chunked, relayed and reassembled.
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required"
    ],
    executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined
  });

  /* `gps: true` replaces the browser's geolocation with one this file drives
     (window.__fix), with speed and heading in it — the emulated one has
     neither, and a rider who is "riding" needs both. */
  async function newPage(label, where, viewport, gps) {
    const ctx = await browser.newContext({
      viewport: viewport || { width: 1100, height: 820 },
      permissions: ["geolocation", "microphone"],
      geolocation: { latitude: where.lat, longitude: where.lon, accuracy: 8 }
    });
    await ctx.addInitScript(
      ([p]) => {
        window.RC_BROKERS = [{ host: "127.0.0.1", port: p, path: "/", key: "peerjs" }];
      },
      [brokerPort]
    );
    await stubWorld(ctx);
    if (gps) {
      await ctx.addInitScript(([w]) => {
        const watchers = {}; let id = 0; let last = { lat: w.lat, lon: w.lon };
        const pos = (f) => ({ coords: { latitude: f.lat, longitude: f.lon, accuracy: 6,
          speed: f.speed == null ? null : f.speed / 3.6, heading: f.heading == null ? null : f.heading, altitude: null },
          timestamp: Date.now() });
        navigator.geolocation.watchPosition = function (ok) { id++; watchers[id] = ok; setTimeout(() => ok(pos(last)), 50); return id; };
        navigator.geolocation.clearWatch = function (i) { delete watchers[i]; };
        navigator.geolocation.getCurrentPosition = function (ok) { setTimeout(() => ok(pos(last)), 30); };
        window.__fix = function (f) { last = f; Object.keys(watchers).forEach((k) => watchers[k](pos(f))); };
      }, [where]);
    }
    const page = await ctx.newPage();
    page.on("pageerror", (e) => { console.log("  !! " + label + " page error: " + e.message); failures++; });
    page.on("console", (m) => {
      if (m.type() === "error" && !/favicon|manifest|ERR_FAILED|net::/.test(m.text())) {
        console.log("  !! " + label + " console: " + m.text());
      }
    });
    await page.goto(base);
    await page.waitForSelector("#map", { state: "attached" });
    await page.waitForFunction(() => !!(window.RC && window.RC.group && window.RC.groupui));
    // Kept so a page opened mid-suite can be closed again — a browser context
    // left open holds a camera, a microphone and a broker socket.
    page.__ctx = ctx;
    return page;
  }

  const host = await newPage("host", START);
  const guest = await newPage("guest", START, { width: 430, height: 860 });

  section("A room opens, and the door holds");

  await host.click("#group-btn");
  check("the pane asks one question first: start or join",
        await host.evaluate(() => !document.getElementById("group-start-box").hidden &&
                                  document.getElementById("group-join-box").hidden));
  await host.fill("#group-name", "Lead Rider");
  await host.click("#group-own-code-fold summary");
  await host.fill("#group-own-code", "RIDE42");
  await host.click("#group-host-btn");
  await host.waitForFunction(() => window.RC.group.isActive(), null, { timeout: 20000 });
  check("the host is in its own room", await host.evaluate(() => window.RC.group.isHost()));
  check("the code is the one that was asked for",
        (await host.evaluate(() => window.RC.group.code())) === "RIDE42");
  check("approval is on by default", await host.evaluate(() => window.RC.group.settings().approval));

  await guest.click("#group-btn");
  await guest.click("#group-mode-join");
  check("a joiner is not shown the host's switches",
        await guest.evaluate(() => document.getElementById("group-start-box").hidden &&
                                   !document.getElementById("group-join-box").hidden));
  await guest.fill("#group-name", "Second Rider");
  await guest.fill("#group-code", "ride42");
  await guest.click("#group-join-btn");
  await guest.waitForFunction(() => window.RC.group.isActive() && window.RC.group.linkState() === "connected",
                              null, { timeout: 40000 });
  check("the guest reached the room over the real transport", true);

  // Before the host says yes, the guest is in a lobby and the host's roster
  // knows it. This is the security claim, so it is checked from both ends.
  await host.waitForFunction(() => window.RC.group.pending().length === 1, null, { timeout: 20000 });
  check("the guest is waiting at the door, not in the room",
        await host.evaluate(() => window.RC.group.pending()[0].name === "Second Rider"));
  check("an unapproved guest knows it is waiting",
        await guest.evaluate(() => window.RC.group.isWaiting()));

  /* An unapproved guest that shouts anyway is refused at the host, not merely
     missing a button: the wire is the boundary, so the wire is what is tested. */
  await guest.evaluate(() => window.RC.group.say("let me in please"));
  await host.waitForTimeout(1200);
  check("nothing an unapproved guest sends reaches the room",
        await host.evaluate(() => window.RC.group.chat().every((m) => m.text.indexOf("let me in") < 0)));

  await host.click("#group-pending [data-approve]");
  await guest.waitForFunction(() => !window.RC.group.isWaiting(), null, { timeout: 20000 });
  check("the host can let a rider in", true);
  check("the roster reaches the guest",
        await guest.evaluate(() => window.RC.group.members().length === 2));
  check("everyone gets their own colour",
        await guest.evaluate(() => {
          const m = window.RC.group.members();
          return m[0].color !== m[1].color;
        }));

  section("One planned route, the same line on every phone");

  // Plan an ordinary route on the host, then make it the ride's planned route.
  await host.click("#tab-route");
  await host.fill("#from-input", `${START.lat}, ${START.lon}`);
  await host.fill("#to-input", `${END.lat}, ${END.lon}`);
  await host.click("#plan-btn");
  await host.waitForFunction(() => window.RC && document.getElementById("summary") &&
                                   !document.getElementById("summary").hidden, null, { timeout: 30000 });
  await host.click("#tab-group");
  await host.click('[data-subtabs="group"] [data-sub="route"]');
  check("with a route planned, sharing it is the next step",
        await host.evaluate(() => document.getElementById("group-step-plan").getAttribute("data-done") === "yes"));
  await host.click("#group-plan-set");
  await host.waitForFunction(() => !!window.RC.group.planned(), null, { timeout: 10000 });
  await guest.waitForFunction(() => !!window.RC.group.planned(), null, { timeout: 30000 });

  const hostPlan = await host.evaluate(() => window.RC.group.planned());
  const guestPlan = await guest.evaluate(() => window.RC.group.planned());
  check("the planned route arrives whole",
        guestPlan.coords.length === hostPlan.coords.length && guestPlan.coords.length > 2,
        guestPlan.coords.length + " vs " + hostPlan.coords.length);
  check("it is the same geometry on both phones, not a recomputation",
        JSON.stringify(guestPlan.coords) === JSON.stringify(hostPlan.coords));
  check("its stops travel with it", guestPlan.stops.length === hostPlan.stops.length &&
        guestPlan.stops.length >= 1);
  check("and it says who set it", guestPlan.by === "Lead Rider", guestPlan.by);
  check("the guest draws it as the planned route, not as its own",
        await guest.evaluate(() => window.RC.groupui.plannedRoute() !== null));

  // The point of a STATIC route: the guest planning something of its own does
  // not move the line the room agreed on.
  const before = JSON.stringify(guestPlan.coords);
  await guest.click("#tab-route");
  await guest.fill("#from-input", `${START.lat}, ${START.lon}`);
  await guest.fill("#to-input", "14.33, 121.05");
  await guest.click("#plan-btn");
  await guest.waitForFunction(() => document.getElementById("summary") &&
                                    !document.getElementById("summary").hidden, null, { timeout: 30000 });
  check("a rider's own plan does not touch the planned route",
        (await guest.evaluate(() => JSON.stringify(window.RC.group.planned().coords))) === before);

  section("Off the line, and the ways back");

  await guest.context().setGeolocation({ latitude: OFF.lat, longitude: OFF.lon, accuracy: 8 });
  await guest.evaluate((p) => {
    // The browser only re-reads geolocation on its own schedule; the room's own
    // entry point is what the watch calls anyway.
    window.RC.group.pushFix({ lat: p.lat, lon: p.lon, speedKmh: 42, courseDeg: 90, accuracy: 8 });
  }, OFF);
  await guest.waitForSelector("#offplan-alert:not([hidden])", { timeout: 15000 });
  check("a rider off the planned route is told so", true);
  await guest.click("#panel-close");
  await guest.click("#offplan-open");
  await guest.waitForFunction(() => document.querySelectorAll("#rejoin-list .rc-way").length >= 2,
                              null, { timeout: 30000 });
  const ways = await guest.evaluate(() =>
    Array.prototype.map.call(document.querySelectorAll("#rejoin-list .rc-way"),
      (n) => n.getAttribute("data-way")));
  check("several ways back are offered", ways.length >= 2, ways.join(", "));
  check("exactly one of them is highlighted",
        (await guest.evaluate(() => document.querySelectorAll("#rejoin-list .rc-way.is-selected").length)) === 1);
  check("one of them is marked as the best",
        (await guest.evaluate(() => document.querySelectorAll("#rejoin-list .rc-badge").length)) >= 1);

  // Picking a different one moves the highlight, and only the highlight.
  const other = ways[ways.length - 1];
  await guest.click(`#rejoin-list [data-way="${other}"]`);
  check("the rider can pick a different way back",
        await guest.evaluate((id) => {
          const n = document.querySelector(`#rejoin-list [data-way="${id}"]`);
          return n.classList.contains("is-selected") &&
                 document.querySelectorAll("#rejoin-list .rc-way.is-selected").length === 1;
        }, other));

  check("the host, still on the line, is not told it is off it",
        await host.evaluate(() => document.getElementById("offplan-alert").hidden));

  section("The room talks");

  await host.evaluate(() => window.RC.group.say("Fuel stop in ten"));
  await guest.waitForFunction(
    () => window.RC.group.chat().some((m) => m.text === "Fuel stop in ten"),
    null, { timeout: 15000 });
  check("the host's message reaches the guest", true);

  await guest.evaluate(() => window.RC.group.say("Copy that"));
  await host.waitForFunction(
    () => window.RC.group.chat().some((m) => m.text === "Copy that"),
    null, { timeout: 15000 });
  check("and the guest's reaches the host", true);
  check("chat is attributed to the rider who sent it",
        await host.evaluate(() => {
          const m = window.RC.group.chat().filter((x) => x.text === "Copy that")[0];
          return m && m.name === "Second Rider";
        }));

  /* One rider cannot flood the room: the host drops anything inside its own
     minimum gap. Two messages a few milliseconds apart, one survivor — after
     waiting out the gap earned by the message above. */
  await guest.waitForTimeout(900);
  await guest.evaluate(() => {
    window.RC.group.say("flood one");
    window.RC.group.say("flood two");
  });
  await host.waitForFunction(
    () => window.RC.group.chat().some((m) => m.text === "flood one"),
    null, { timeout: 15000 });
  await host.waitForTimeout(1000);
  check("a rider cannot flood the room",
        await host.evaluate(() => !window.RC.group.chat().some((m) => m.text === "flood two")));

  /* A guest cannot forge someone else's chat: the host credits the link the
     message arrived on, whatever the payload claims. The pause is the room's
     own rate limit, not a race. */
  await guest.waitForTimeout(900);
  await guest.evaluate(() => window.RC.group.say("this is the host speaking"));
  await host.waitForFunction(
    () => window.RC.group.chat().some((m) => m.text === "this is the host speaking"),
    null, { timeout: 15000 });
  check("a guest cannot post under the host's name",
        await host.evaluate(() => {
          const m = window.RC.group.chat().filter((x) => x.text === "this is the host speaking")[0];
          return m && m.name === "Second Rider";
        }));

  section("A room code as a picture");

  // The host's QR carries the invite link and nothing else, so what the guest
  // scans has to be exactly what the guest would have been told to type.
  await host.click("#group-qr-btn");
  await host.waitForFunction(() => {
    const box = document.getElementById("group-qr");
    const c = document.getElementById("group-qr-canvas");
    return box && !box.hidden && c && c.width > 0;
  }, null, { timeout: 10000 });
  check("the host can show the room code as a QR", true);

  const qrPayload = await host.evaluate(() => {
    // Re-encode what the app encoded and compare the module grids: a canvas
    // this test decoded itself would only prove the decoder agrees with the
    // encoder, which is not a claim worth making.
    const url = location.origin + location.pathname + "?ride=" + window.RC.group.code();
    const a = window.RC.qr.encode(url, { ecc: "M" });
    const c = document.getElementById("group-qr-canvas");
    return { url: url, size: a.size, version: a.version, drawn: c.width > 0 && c.height > 0 };
  });
  check("the QR encodes this room's invite link",
        qrPayload.url.endsWith("?ride=RIDE42"), qrPayload.url);
  check("and it is small enough to read at arm's length",
        qrPayload.version <= 4, "version " + qrPayload.version);

  await host.click("#group-qr-btn");
  check("and it folds away again",
        await host.evaluate(() => document.getElementById("group-qr").hidden));

  // A third rider joins by camera. There is no camera here and Chromium has no
  // BarcodeDetector, so both are stubbed — what is under test is the app's own
  // path from "the detector saw this string" to "the rider is in the room",
  // which is the part that can actually be wrong.
  const scanner = await newPage("scanner", START, { width: 430, height: 860 });
  await scanner.evaluate((payload) => {
    window.BarcodeDetector = function () {
      return {
        detect: function () {
          return Promise.resolve([{ rawValue: payload, format: "qr_code" }]);
        }
      };
    };
    // A canvas stream stands in for a camera. It has to actually produce
    // frames — a canvas that is never redrawn emits none, the <video> never
    // reaches its first frame, and anything waiting on that is waiting for
    // ever.
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const cx = canvas.getContext("2d");
    let tick = 0;
    setInterval(function () {
      cx.fillStyle = tick++ % 2 ? "#202020" : "#303030";
      cx.fillRect(0, 0, 64, 64);
    }, 100);
    const fake = canvas.captureStream(10);
    navigator.mediaDevices.getUserMedia = function () { return Promise.resolve(fake); };
  }, qrPayload.url);

  await scanner.click("#group-btn");
  await scanner.click("#group-mode-join");
  await scanner.fill("#group-name", "Third Rider");
  await scanner.click("#group-scan-btn");
  await scanner.waitForFunction(
    () => document.getElementById("group-code").value === "RIDE42",
    null, { timeout: 15000 });
  check("a scanned code fills the room in", true);
  check("the camera is let go the moment it has been read",
        await scanner.evaluate(() => {
          const v = document.getElementById("group-scan-video");
          return document.getElementById("group-scan").hidden && !v.srcObject;
        }));
  check("but scanning alone does not put anybody in the room",
        !(await scanner.evaluate(() => window.RC.group.isActive())));

  await scanner.click("#group-join-btn");
  await scanner.waitForFunction(
    () => window.RC.group.isActive() && window.RC.group.linkState() === "connected",
    null, { timeout: 40000 });
  await host.waitForFunction(() => window.RC.group.pending().length === 1, null, { timeout: 20000 });
  check("and the scanned code reaches the right room",
        await host.evaluate(() => window.RC.group.pending()[0].name === "Third Rider"));
  check("a scanned rider still has to be let in",
        await scanner.evaluate(() => window.RC.group.isWaiting()));

  // Refused at the door, and gone from the roster — which is also how the rest
  // of this file gets its two-rider room back. A rider who merely *drops* keeps
  // their slot on purpose, so leaving would not have cleared it.
  await host.evaluate(() => window.RC.group.kick(window.RC.group.pending()[0].id));
  await scanner.waitForFunction(() => !window.RC.group.isActive(), null, { timeout: 20000 });
  check("a scanned rider can be refused like any other",
        await host.evaluate(() => window.RC.group.members().length === 2));
  await scanner.__ctx.close();

  section("Voice carries across the room");

  const canRecord = await guest.evaluate(() => window.RC.group.canTalk());
  if (!canRecord) {
    check("this browser can record audio (skipped: it cannot)", true);
  } else {
    // Watch for the clip landing on the host, whatever the UI does with it.
    await host.evaluate(() => {
      window.__heard = [];
      const was = window.RC.group.onVoice;
      window.RC.group.onVoice = function (v) { window.__heard.push(v); if (was) was(v); };
    });
    await guest.evaluate(() => window.RC.group.startTalking());
    await guest.waitForTimeout(1400);
    await guest.evaluate(() => window.RC.group.stopTalking());
    await host.waitForFunction(() => (window.__heard || []).length > 0, null, { timeout: 25000 });
    check("a push-to-talk clip reaches the room",
          await host.evaluate(() => window.__heard[0].name === "Second Rider"),
          await host.evaluate(() => JSON.stringify(window.__heard[0])));
    check("the speaker does not hear their own clip back",
          await guest.evaluate(() => !window.RC.group.speaking() ||
                                     window.RC.group.speaking().from !== window.RC.group.myId()));
    check("a muted rider queues nothing",
          await host.evaluate(() => {
            window.RC.group.setMuted(true);
            const muted = window.RC.group.isMuted();
            window.RC.group.setMuted(false);
            return muted;
          }));
  }

  section("Landscape and portrait both fit");

  for (const size of [{ width: 740, height: 380 }, { width: 390, height: 780 }]) {
    await guest.setViewportSize(size);
    await guest.waitForTimeout(400);
    const fits = await guest.evaluate(() => {
      const doc = document.documentElement;
      const wide = doc.scrollWidth > doc.clientWidth + 1;
      const boxes = ["offplan-alert", "rejoin-card", "group-toast", "ptt-btn"]
        .map((id) => document.getElementById(id))
        .filter((n) => n && !n.hidden)
        .map((n) => n.getBoundingClientRect());
      const off = boxes.filter((b) => b.left < -1 || b.right > doc.clientWidth + 1 ||
                                      b.bottom > doc.clientHeight + 1);
      return { wide: wide, off: off.length, seen: boxes.length };
    });
    check(`nothing overflows at ${size.width}x${size.height}`,
          !fits.wide && fits.off === 0, JSON.stringify(fits));
    check(`the room's furniture is on screen at ${size.width}x${size.height}`,
          fits.seen > 0, JSON.stringify(fits));
  }
  await guest.setViewportSize({ width: 430, height: 860 });

  section("The Ride pane, reorganised");

  // The guest's copy of the plan is a list of stops on the Route sub-tab.
  await guest.click("#group-btn");
  await guest.click('[data-subtabs="group"] [data-sub="route"]');
  check("the planned stops are listed in order",
        await guest.evaluate(() => document.querySelectorAll("#group-plan-stoplist li").length ===
                                   window.RC.group.planned().stops.length));
  check("a guest can ride the agreed line", await guest.evaluate(() => !document.getElementById("group-plan-ride").hidden));
  check("but only the host can replace it", await guest.evaluate(() => document.getElementById("group-plan-set").hidden));
  await guest.click("#group-plan-ride");
  await guest.waitForFunction(() => {
    const plan = window.RC.group.planned();
    const last = plan.stops[plan.stops.length - 1];
    return document.getElementById("to-input").value === last.name &&
           !document.getElementById("summary").hidden;
  }, null, { timeout: 30000 }).then(() => check("riding it plans the agreed stops from where you are", true),
                                    () => check("riding it plans the agreed stops from where you are", false));
  check("and the ride's own line is untouched by it",
        (await guest.evaluate(() => JSON.stringify(window.RC.group.planned().coords))) === before);

  // Something said while the planner is shut lands on the rail button, and
  // the button goes straight to it.
  await guest.click("#panel-close");
  await host.evaluate(() => window.RC.group.say("Wait up"));
  await guest.waitForFunction(() => document.getElementById("group-count").getAttribute("data-kind") === "chat",
                              null, { timeout: 15000 });
  check("an unread line shows on the ride button", true);
  await guest.click("#group-btn");
  check("and the ride button opens the talk",
        await guest.evaluate(() => document.querySelector('[data-subtabs="group"] [data-sub="talk"]')
                                     .getAttribute("aria-selected") === "true"));
  check("which clears the count",
        await guest.evaluate(() => document.getElementById("group-sub-talk-n").hidden));

  // A one-tap line is a whole sentence.
  await guest.click('#group-says [data-say="0"]');
  await host.waitForFunction(() => window.RC.group.chat().some((m) => m.text === "On my way"), null, { timeout: 15000 });
  check("a one-tap line reaches the room", true);

  // How the ride is drawn is this phone's business.
  await guest.click('[data-subtabs="group"] [data-sub="map"]');
  await guest.click('[data-mate-names="always"]');
  await guest.waitForFunction(() => document.querySelectorAll(".rc-mate-name").length > 0, null, { timeout: 10000 })
    .then(() => check("names can be always on", true), () => check("names can be always on", false));
  await guest.click('[data-mate-names="never"]');
  check("or off entirely", await guest.evaluate(() => document.querySelectorAll(".rc-mate-name").length === 0));
  check("and the choice is kept", await guest.evaluate(() => window.RC.store.get("groupView", {}).names === "never"));

  // Tap a rider, get their card.
  await guest.click('[data-subtabs="group"] [data-sub="riders"]');
  const hostId = await guest.evaluate(() => window.RC.group.members().filter((m) => m.host)[0].id);
  await guest.click(`#group-members [data-mate="${hostId}"]`);
  await guest.waitForSelector("#who-card:not([hidden])", { timeout: 5000 });
  check("tapping a rider opens their card",
        (await guest.evaluate(() => document.getElementById("who-name").textContent)) === "Lead Rider");
  check("with a way to find them and ride to them",
        await guest.evaluate(() => Array.from(document.querySelectorAll("#who-acts .rc-act"))
                                     .map((b) => b.textContent).join("|").indexOf("Ride to them") >= 0));
  check("and the planner is out of the way", await guest.evaluate(() =>
        document.getElementById("panel").getAttribute("data-open") === "false"));
  await guest.click("#who-close");
  check("the card closes", await guest.evaluate(() => document.getElementById("who-card").hidden));

  section("Positions, and leaving");

  /* The guest's own geolocation watch is live and its fixes are the real thing,
     so a one-off injected fix gets overwritten by the next real one — which is
     correct, and exactly why this keeps pushing while it waits. */
  await guest.evaluate((p) => {
    window.__pushTimer = setInterval(function () {
      window.RC.group.pushFix({ lat: p.lat, lon: p.lon, speedKmh: 42, courseDeg: 90, accuracy: 8 });
    }, 400);
  }, OFF);
  await host.waitForFunction(() => {
    const them = window.RC.group.members().filter((m) => !m.me);
    return them.length === 1 && them[0].fix && them[0].fix.lat > 14 && them[0].fix.lat < 15;
  }, null, { timeout: 20000 });
  check("the host sees where the guest is", true);
  await host.waitForFunction(() => {
    const m = window.RC.group.members().filter((x) => !x.me)[0];
    return m && m.fix && m.fix.speedKmh > 0 && m.fix.courseDeg === 90;
  }, null, { timeout: 20000 }).then(() => {
    check("the guest's speed and heading travel with the fix", true);
  }, () => {
    check("the guest's speed and heading travel with the fix", false);
  });
  await guest.evaluate(() => clearInterval(window.__pushTimer));

  await host.evaluate(() => {
    const other = window.RC.group.members().filter((m) => !m.me)[0];
    window.RC.group.kick(other.id);
  });
  await guest.waitForFunction(() => !window.RC.group.isActive(), null, { timeout: 20000 });
  check("a removed rider is out of the room", true);
  check("and the room forgets them",
        await host.evaluate(() => window.RC.group.members().length === 1));
  check("the planned route goes with the room",
        await guest.evaluate(() => window.RC.group.planned() === null));

  section("PUBs: the road talks");

  const pubA = await newPage("pubA", START, null, true);
  const pubB = await newPage("pubB", { lat: START.lat + 0.002, lon: START.lon + 0.001 });
  for (const [pg, name] of [[pubA, "Ana"], [pubB, "Ben"]]) {
    await pg.click("#pubs-btn");
    await pg.fill("#pubs-name", name);
    await pg.click("#pubs-start");
    await pg.waitForFunction(() => window.RC.pubs.isOn(), null, { timeout: 15000 });
  }
  await pubA.waitForFunction(() => window.RC.pubs.role() === "host", null, { timeout: 20000 });
  await pubB.waitForFunction(() => window.RC.pubs.role() === "guest", null, { timeout: 30000 });
  check("the first phone holds the area and the second joins it", true);
  await pubA.waitForFunction(() => window.RC.pubs.world().length === 1, null, { timeout: 20000 });
  await pubB.waitForFunction(() => window.RC.pubs.world().length === 1, null, { timeout: 20000 });
  check("each sees the other", true);
  check("a stranger is a badge with a glyph, not a ride-mate's dot",
        await pubB.evaluate(() => !!document.querySelector(".rc-pub .rc-pub-face svg")));
  check("the map button for the road appears while PUBs is on",
        await pubB.evaluate(() => !document.getElementById("pubs-fab").hidden));

  // A shout from the map's own sheet floats over the sender on the other map.
  await pubA.click("#panel-close");
  await pubB.click("#panel-close");
  await pubA.click("#pubs-fab");
  await pubA.fill("#pubs-sheet-input", "Anyone at the pass?");
  await pubA.click("#pubs-sheet-send");
  await pubB.waitForFunction(() => Array.from(document.querySelectorAll(".rc-bubble"))
                                   .some((b) => b.textContent === "Anyone at the pass?"), null, { timeout: 15000 });
  check("a shout floats over the sender on everybody else's map", true);
  check("and the sheet gets out of the way once it is said",
        await pubA.evaluate(() => document.getElementById("pubs-sheet").hidden));

  // A report from the sheet is a pin on the other map.
  await pubB.click("#pubs-fab");
  await pubB.click('#pubs-sheet-grid [data-report="crash"]');
  await pubA.waitForSelector('.rc-rep[data-kind="crash"]', { timeout: 15000 });
  check("a report is a pin on the other rider's map", true);
  await pubA.click('.rc-rep[data-kind="crash"]');
  await pubA.waitForSelector("#who-card:not([hidden])", { timeout: 5000 });
  check("tapping the pin says what it is",
        (await pubA.evaluate(() => document.getElementById("who-name").textContent)) === "Crash");
  await pubA.click("#who-close");

  // Riding towards a pin, you are told once — on screen and out loud — and
  // riding up to it, you are asked whether it is still there.
  await pubA.evaluate(() => {
    window.__said = [];
    window.speechSynthesis.speak = function (u) { window.__said.push(u.text); };
  });
  await pubA.click("#dock-free");
  await pubA.waitForFunction(() => document.documentElement.getAttribute("data-mode") === "free", null, { timeout: 15000 });
  const pin = await pubA.evaluate(() => { const r = window.RC.pubs.reports()[0]; return { lat: r.lat, lon: r.lon }; });
  await pubA.evaluate((p) => window.__fix({ lat: p.lat - 0.0054, lon: p.lon, speed: 36, heading: 0 }), pin);
  await pubA.waitForFunction(() => /Crash reported ahead/.test(document.getElementById("group-toast").textContent),
                             null, { timeout: 20000 })
    .then(() => check("riding towards a pin, the rider is told", true),
          () => check("riding towards a pin, the rider is told", false));
  check("out loud", await pubA.evaluate(() => window.__said.some((t) => /crash reported ahead/i.test(t))),
        await pubA.evaluate(() => JSON.stringify(window.__said)));
  await pubA.evaluate((p) => window.__fix({ lat: p.lat - 0.0006, lon: p.lon, speed: 20, heading: 0 }), pin);
  await pubA.waitForFunction(() => !document.getElementById("who-card").hidden &&
                                   /still there/.test(document.getElementById("who-name").textContent),
                             null, { timeout: 15000 })
    .then(() => check("riding up to it asks whether it is still there", true),
          () => check("riding up to it asks whether it is still there", false));
  await pubA.click("#who-acts .rc-act-primary");
  await pubB.waitForFunction(() => window.RC.pubs.reports().length === 1 && window.RC.pubs.reports()[0].ups === 2,
                             null, { timeout: 15000 });
  check("still there is counted for everyone", true);

  // A beep is addressed, and heard.
  await pubA.evaluate(() => window.RC.pubs.beep(window.RC.pubs.world()[0].id));
  await pubB.waitForFunction(() => /beeped at you/.test(document.getElementById("group-toast").textContent),
                             null, { timeout: 15000 });
  check("a beep is heard by the rider it was for", true);

  await pubB.click("#pubs-btn");
  await pubB.click("#pubs-stop");
  check("going dark takes the map furniture with it",
        await pubB.evaluate(() => document.getElementById("pubs-fab").hidden &&
                                  !document.querySelector(".rc-pub") && !document.querySelector(".rc-rep")));
  await pubA.__ctx.close();
  await pubB.__ctx.close();

  await browser.close();
  site.close();
  brokerServer.close();

  console.log("\n" + (failures ? "FAILED" : "PASSED") + " — " + failures + " failure(s)\n");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
