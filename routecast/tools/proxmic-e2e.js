/* tools/proxmic-e2e.js — four real browsers on one stretch of road.
 *
 * The proximity mic is a claim about other machines in three ways at once:
 * that the right phones find each other (and the wrong ones do not), that the
 * voice actually crosses between them, and that it arrives as loud as its
 * rider is close. validate.js covers the arithmetic and the mesh with the
 * links faked; this drives four Chromium contexts through the real transport
 * — the hub's introductions, real peer connections, real Opus — on a broker
 * that lives in this process and GPS positions the test sets by hand.
 *
 *   Ana   on the spot
 *   Ben   10 m north of her
 *   Cy    40 m north of her (30 m from Ben)
 *   Dee  300 m north, mic on, and nobody's neighbour
 *
 * Each microphone is a steady tone, and every inbound audio track is watched
 * with an analyser, so "heard" means energy arrived rather than a flag said so.
 *
 * Run: node tools/proxmic-e2e.js
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const broker = require("./broker");

const ROOT = path.resolve(__dirname, "..");
const SHOTS = process.env.RC_SHOTS || "";
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

async function stubWorld(ctx) {
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => {
    const url = route.request().url();
    if (/open-meteo/.test(url)) {
      return route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ hourly: { time: [], temperature_2m: [] } }) });
    }
    if (/nominatim|osrm/.test(url)) {
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    }
    return route.fulfill({ status: 200, contentType: "image/png", body: Buffer.alloc(0) });
  });
}

/* Injected before any app script: a microphone that is a tone, a note of
   every peer connection and every element the app plays a voice through,
   and an analyser on every inbound audio track. */
function instrument() {
  const AC = window.AudioContext || window.webkitAudioContext;
  let fake = null;
  function fakeMic() {
    if (fake) return fake;
    const ac = new AC({ sampleRate: 48000 });
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    const dest = ac.createMediaStreamDestination();
    osc.frequency.value = 440;
    gain.gain.value = 0.35;
    osc.connect(gain).connect(dest);
    osc.start();
    fake = dest.stream;
    return fake;
  }
  navigator.mediaDevices.getUserMedia = function () {
    window.__micOpened = (window.__micOpened || 0) + 1;
    const t = fakeMic().getAudioTracks()[0].clone();
    return Promise.resolve(new MediaStream([t]));
  };

  const RealPC = window.RTCPeerConnection;
  window.__pcs = [];
  function Wrapped(cfg) { const pc = new RealPC(cfg); window.__pcs.push(pc); return pc; }
  Wrapped.prototype = RealPC.prototype;
  Wrapped.generateCertificate = RealPC.generateCertificate && RealPC.generateCertificate.bind(RealPC);
  window.RTCPeerConnection = Wrapped;

  const RealAudio = window.Audio;
  window.__audios = [];
  window.Audio = function (src) {
    const a = src === undefined ? new RealAudio() : new RealAudio(src);
    window.__audios.push(a);
    return a;
  };
  window.Audio.prototype = RealAudio.prototype;

  /* The element volumes the app is playing remote voices at, loudest first. */
  window.__levels = function () {
    return window.__audios
      .filter((a) => a.srcObject && !a.paused && a.srcObject.getAudioTracks().some((t) => t.readyState === "live"))
      .map((a) => a.volume)
      .sort((x, y) => y - x);
  };

  /* The loudest thing arriving on any inbound audio track, measured over the
     last few hundred milliseconds. */
  window.__peak = 0;
  window.__watch = function () {
    if (window.__watching) return;
    window.__watching = true;
    const ac = new AC({ sampleRate: 48000 });
    const seen = new WeakSet();
    const list = [];
    setInterval(() => {
      window.__pcs.forEach((pc) => {
        try {
          pc.getReceivers().forEach((r) => {
            const t = r.track;
            if (!t || t.kind !== "audio" || seen.has(t)) return;
            seen.add(t);
            const sink = new RealAudio();
            sink.srcObject = new MediaStream([t]);
            sink.volume = 0.0001;
            sink.play().catch(() => {});
            const src = ac.createMediaStreamSource(new MediaStream([t]));
            const an = ac.createAnalyser();
            an.fftSize = 1024;
            src.connect(an);
            list.push({ an, buf: new Float32Array(an.fftSize) });
          });
        } catch (e) { /* closing */ }
      });
    }, 150);
    const recent = [];
    setInterval(() => {
      let loud = 0;
      list.forEach((x) => {
        x.an.getFloatTimeDomainData(x.buf);
        let s = 0;
        for (let i = 0; i < x.buf.length; i++) s += x.buf[i] * x.buf[i];
        loud = Math.max(loud, Math.sqrt(s / x.buf.length));
      });
      recent.push(loud);
      if (recent.length > 6) recent.shift();
      window.__peak = Math.max.apply(null, recent);
    }, 60);
  };
}

const START = { lat: 14.30, lon: 121.00 };
const M = 1 / 111195;            // degrees of latitude per metre
function north(m) { return { lat: START.lat + m * M, lon: START.lon }; }

async function main() {
  const site = await serve();
  const { port: brokerPort, server: brokerServer } = await broker.start(0);
  const base = `http://127.0.0.1:${site.address().port}/index.html`;
  const browser = await chromium.launch({
    args: [
      "--no-sandbox",
      "--disable-features=WebRtcHideLocalIpsWithMdns",
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
      "--allow-loopback-in-peer-connection"
    ]
  });

  async function newPage(label, where, viewport) {
    const ctx = await browser.newContext({
      viewport: viewport || { width: 1000, height: 800 },
      permissions: ["geolocation", "microphone"],
      geolocation: { latitude: where.lat, longitude: where.lon, accuracy: 6 }
    });
    await ctx.addInitScript(([p, ice]) => {
      window.RC_BROKERS = [{ host: "127.0.0.1", port: p, path: "/", key: "peerjs" }];
      // Loopback only: nothing in this test may depend on a public STUN server.
      window.RC_ICE = ice;
    }, [brokerPort, { iceServers: [] }]);
    // A GPS the test moves by hand.
    await ctx.addInitScript(([w]) => {
      const watchers = {}; let id = 0; let last = { lat: w.lat, lon: w.lon };
      const pos = (f) => ({ coords: { latitude: f.lat, longitude: f.lon, accuracy: 5,
        speed: null, heading: null, altitude: null }, timestamp: Date.now() });
      navigator.geolocation.watchPosition = function (ok) { id++; watchers[id] = ok; setTimeout(() => ok(pos(last)), 50); return id; };
      navigator.geolocation.clearWatch = function (i) { delete watchers[i]; };
      navigator.geolocation.getCurrentPosition = function (ok) { setTimeout(() => ok(pos(last)), 30); };
      window.__fix = function (f) { last = f; Object.keys(watchers).forEach((k) => watchers[k](pos(f))); };
    }, [where]);
    await ctx.addInitScript(instrument);
    await stubWorld(ctx);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => { console.log("  !! " + label + " page error: " + e.message); failures++; });
    await page.goto(base);
    await page.waitForFunction(() => !!(window.RC && window.RC.proxmic && window.RC.pubsui));
    page.__ctx = ctx;
    page.__label = label;
    return page;
  }

  async function goPublic(page, name) {
    await page.click("#pubs-btn");
    await page.fill("#pubs-name", name);
    await page.click("#pubs-start");
    await page.waitForFunction(() => window.RC.pubs.isOn(), null, { timeout: 15000 });
  }

  async function micOn(page) {
    await page.click("#pubs-btn").catch(() => {});
    await page.click('[data-subtabs="pubs"] [data-sub="chat"]');
    await page.click("label:has(#pubs-mic-on)");
    await page.waitForFunction(() => window.RC.proxmic.isOn() && window.RC.pubs.micOn(), null, { timeout: 10000 });
  }

  function near(page) {
    return page.evaluate(() => window.RC.proxmic.snapshot().near.map((n) => ({
      name: n.name, state: n.state, level: n.level, talking: n.talking, dist: n.dist
    })));
  }

  try {
    section("Four riders, one road");
    const ana = await newPage("Ana", north(0));
    await goPublic(ana, "Ana");
    await ana.waitForFunction(() => window.RC.pubs.role() === "host", null, { timeout: 20000 });
    const ben = await newPage("Ben", north(10));
    const cy = await newPage("Cy", north(40));
    const dee = await newPage("Dee", north(300));
    for (const [p, n] of [[ben, "Ben"], [cy, "Cy"], [dee, "Dee"]]) await goPublic(p, n);
    for (const p of [ben, cy, dee]) {
      await p.waitForFunction(() => window.RC.pubs.role() === "guest", null, { timeout: 30000 });
    }
    for (const p of [ana, ben, cy, dee]) {
      await p.waitForFunction(() => window.RC.pubs.world().length === 3, null, { timeout: 20000 });
    }
    check("everybody is on the area's map", true);

    check("the mic is off until it is switched on",
          await ana.evaluate(() => !window.RC.proxmic.isOn() && document.getElementById("pubs-ptt").hidden));

    const t0 = Date.now();
    for (const p of [ana, ben, cy, dee]) await micOn(p);
    check("switching it on shows the talk button",
          await ana.evaluate(() => !document.getElementById("pubs-ptt").hidden));
    check("and asks for the microphone at once, not on the first press",
          await ana.evaluate(() => window.__micOpened >= 1));

    await ana.waitForFunction(() => {
      const n = window.RC.proxmic.snapshot().near;
      return n.length === 2 && n.every((x) => x.state === "open");
    }, null, { timeout: 30000 }).then(() => {}, () => {});
    const anaNear = await near(ana);
    check("the riders in reach are connected", anaNear.length === 2 && anaNear.every((n) => n.state === "open"),
          JSON.stringify(anaNear));
    console.log("       (" + (Date.now() - t0) + " ms from the switch to both links)");
    check("nearest first", anaNear.map((n) => n.name).join(",") === "Ben,Cy", anaNear.map((n) => n.name).join(","));
    check("the rider 300 m away is not",
          (await near(dee)).length === 0 && !anaNear.some((n) => n.name === "Dee"));

    // Positions cross the links once a second; give the levels a moment.
    await ana.waitForTimeout(2500);
    const a2 = await near(ana);
    const b2 = await near(ben);
    const lv = (list, name) => (list.find((n) => n.name === name) || {}).level;
    check("ten metres is nearly full volume", Math.abs(lv(a2, "Ben") - 0.889) < 0.06, lv(a2, "Ben"));
    check("forty metres is quiet", Math.abs(lv(a2, "Cy") - 0.222) < 0.06, lv(a2, "Cy"));
    check("the same pair is as loud both ways", Math.abs(lv(b2, "Ana") - lv(a2, "Ben")) < 0.03,
          lv(b2, "Ana") + " vs " + lv(a2, "Ben"));
    check("thirty metres is in between", Math.abs(lv(b2, "Cy") - 0.444) < 0.06, lv(b2, "Cy"));

    const played = await ana.evaluate(() => window.__levels());
    check("the voices are played at those levels",
          played.length === 2 && Math.abs(played[0] - lv(a2, "Ben")) < 0.03 && Math.abs(played[1] - lv(a2, "Cy")) < 0.03,
          JSON.stringify(played));

    check("riders in earshot carry a ring on the map",
          await ana.evaluate(() => document.querySelectorAll(".rc-pub.is-near").length === 2));
    check("the talk button counts them",
          (await ana.evaluate(() => document.getElementById("pubs-ptt-n").textContent)) === "2");
    if (SHOTS) await ana.screenshot({ path: path.join(SHOTS, "proxmic-pane.png") });

    section("Talking");
    for (const p of [ana, ben, cy]) await p.evaluate(() => window.__watch());
    for (const p of [ana, ben, cy]) await p.click("#panel-close").catch(() => {});
    await ana.waitForTimeout(1500);
    const quiet = await ana.evaluate(() => window.__peak);
    check("nothing arrives while nobody is pressing", quiet < 0.01, quiet.toFixed(4));

    const btn = await ben.$("#pubs-ptt");
    const box = await btn.boundingBox();
    await ben.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await ben.mouse.down();
    await ana.waitForFunction(() => window.__peak > 0.05, null, { timeout: 8000 }).then(() => {}, () => {});
    const loud = await ana.evaluate(() => window.__peak);
    check("holding the button, the rider next to you is heard", loud > 0.05, loud.toFixed(4));
    await ana.waitForFunction(() => document.querySelectorAll(".rc-pub.is-talking").length === 1, null, { timeout: 5000 })
      .then(() => check("and their badge says they are the one talking", true),
            () => check("and their badge says they are the one talking", false));
    check("the button says so on the talker's side",
          (await ben.evaluate(() => document.getElementById("pubs-ptt").getAttribute("data-state"))) === "talking");
    if (SHOTS) await ana.screenshot({ path: path.join(SHOTS, "proxmic-talking.png") });
    await ben.mouse.up();
    await ana.waitForFunction(() => window.__peak < 0.01, null, { timeout: 6000 }).then(() => {}, () => {});
    check("letting go is silence again", (await ana.evaluate(() => window.__peak)) < 0.01);
    await ana.waitForFunction(() => !document.querySelector(".rc-pub.is-talking"), null, { timeout: 6000 })
      .then(() => check("and the badge stops", true), () => check("and the badge stops", false));

    // Open mic: no thumb, still heard.
    await cy.evaluate(() => window.RC.proxmic.setOpenMic(true));
    await ben.waitForFunction(() => window.__peak > 0.05, null, { timeout: 8000 }).then(() => {}, () => {});
    check("open mic is heard without a press", (await ben.evaluate(() => window.__peak)) > 0.05);
    check("and the button fills to say the mic is open",
          (await cy.evaluate(() => document.getElementById("pubs-ptt").getAttribute("data-state"))) === "open");
    await cy.evaluate(() => window.RC.proxmic.setOpenMic(false));

    // Muting is one-way: Ana stops hearing, Ben still hears her.
    await ana.evaluate(() => window.RC.proxmic.setMuted(true));
    await ana.waitForTimeout(600);
    check("muting turns every voice down to nothing",
          (await ana.evaluate(() => window.__levels())).every((v) => v === 0));
    await ana.evaluate(() => window.RC.proxmic.setMuted(false));

    section("Moving apart");
    await cy.evaluate((f) => window.__fix(f), north(420));
    await ana.waitForFunction(() => !window.RC.proxmic.snapshot().near.some((n) => n.name === "Cy"),
                              null, { timeout: 25000 })
      .then(() => check("a rider who rides off is let go", true),
            () => check("a rider who rides off is let go", false));
    check("their voice goes with them", (await ana.evaluate(() => window.__levels())).length === 1);

    // Back again: they are found again, without anybody touching anything.
    await cy.evaluate((f) => window.__fix(f), north(20));
    await ana.waitForFunction(() => window.RC.proxmic.snapshot().near.some((n) => n.name === "Cy" && n.state === "open"),
                              null, { timeout: 40000 })
      .then(() => check("and found again when they come back", true),
            () => check("and found again when they come back", false));

    section("Going dark");
    await ben.click("#pubs-btn");
    await ben.click("#pubs-stop");
    await ana.waitForFunction(() => !window.RC.proxmic.snapshot().near.some((n) => n.name === "Ben"),
                              null, { timeout: 8000 })
      .then(() => check("going dark hangs up on everybody at once", true),
            () => check("going dark hangs up on everybody at once", false));
    check("and switches the mic off with it", await ben.evaluate(() => !window.RC.proxmic.isOn() &&
                                                                       document.getElementById("pubs-ptt").hidden));

    section("On a phone");
    const phone = await newPage("Phone", north(5), { width: 390, height: 844 });
    await goPublic(phone, "Eve");
    await phone.waitForFunction(() => window.RC.pubs.role() === "guest", null, { timeout: 30000 });
    await micOn(phone);
    const overflow = await phone.evaluate(() => {
      const pane = document.getElementById("pane-pubs");
      return { page: document.documentElement.scrollWidth - window.innerWidth, pane: pane.scrollWidth - pane.clientWidth };
    });
    check("the mic block fits a phone", overflow.page <= 0 && overflow.pane <= 0, JSON.stringify(overflow));
    if (SHOTS) await phone.screenshot({ path: path.join(SHOTS, "proxmic-phone.png") });
    await phone.click("#panel-close").catch(() => {});
    await phone.waitForFunction(() => window.RC.proxmic.snapshot().audible >= 1, null, { timeout: 30000 }).then(() => {}, () => {});
    await phone.waitForTimeout(900);    // the sheet's own exit
    if (SHOTS) await phone.screenshot({ path: path.join(SHOTS, "proxmic-phone-map.png") });
    const ptt = await phone.evaluate(() => {
      const b = document.getElementById("pubs-ptt").getBoundingClientRect();
      if (!(b.width > 0 && b.right <= window.innerWidth && b.bottom <= window.innerHeight)) return false;
      // On the screen and not under anything: the topmost thing at its centre is the button.
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return !!hit && !!hit.closest("#pubs-ptt");
    });
    check("and the talk button is on the screen, uncovered", ptt);
  } finally {
    await browser.close();
    site.close();
    brokerServer.close();
  }

  console.log("\n" + (failures ? "FAILED" : "PASSED") + " — " + failures + " failure(s)\n");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
