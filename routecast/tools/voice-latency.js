/* tools/voice-latency.js — how long does the room take to hear you?
 *
 * "Voice feels slow" is not a bug report you can act on, so this turns it into
 * numbers. Three real Chromium contexts join one room over the real transport,
 * against a STUN and a TURN server this file starts itself (tools/stun.js,
 * tools/turn.js) so that nothing measured here depends on somebody else's
 * public server having a good afternoon.
 *
 * What is measured
 * ----------------
 *   setup      join -> RC.group.isLive(): the link is up AND the audio path
 *              survived negotiation, which is when the talk button stops
 *              being a recorder
 *   direct     a guest presses talk -> the HOST hears sound
 *   relayed    a guest presses talk -> the OTHER GUEST hears sound, which is
 *              the long way round: guest -> host -> mix -> guest
 *
 * How it is measured
 * ------------------
 * getUserMedia is replaced, before the app loads, with a steady oscillator —
 * so the moment the app opens its own gate is the only variable, and the
 * receiving page can watch for the tone arriving with an AnalyserNode. Both
 * ends timestamp with Date.now(), and both ends are on this machine, so the
 * subtraction is honest to within a millisecond or two.
 *
 * Edge cases exercised
 * --------------------
 *   1. STUN answering normally                 (the happy path)
 *   2. STUN black-holed                        (a server that quietly died)
 *   3. A TURN server in the list that is dead  (what the shipped config had)
 *   4. iceTransportPolicy: "relay"             (both riders behind hard NATs)
 *   5. A relay with 120 ms of added latency    (a relay on another continent)
 *
 * Run: node tools/voice-latency.js [--keep] [--only=direct,relay]
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const broker = require("./broker");
const stun = require("./stun");
const turn = require("./turn");

const ROOT = path.resolve(__dirname, "..");
const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json"
};

let failures = 0;
const results = [];

function check(name, ok, extra) {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (ok || extra === undefined ? "" : "  -> " + extra));
  if (!ok) failures++;
}
function note(name, value) { console.log("  ..   " + name + ": " + value); }
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

/* ---------- the fake outside world ----------
   The room needs a route to exist and the sky to be answerable; neither is
   what this file is about, so both are answered locally and cheaply. */

async function stubWorld(ctx) {
  await ctx.route("**://router.project-osrm.org/**", (route) => {
    route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ code: "Ok", routes: [], waypoints: [] })
    });
  });
  await ctx.route("**://api.open-meteo.com/**", (route) => {
    route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ hourly: { time: [], temperature_2m: [] } })
    });
  });
  await ctx.route("**://nominatim.openstreetmap.org/**", (route) => {
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await ctx.route(/tile\.openstreetmap|basemaps|tiles?\./, (route) => {
    route.fulfill({ status: 200, contentType: "image/png", body: Buffer.alloc(0) });
  });
}

/* ---------- the instrumentation ----------
   Injected before any app script runs. Two jobs: hand the app a microphone
   whose content we know, and let the test watch every inbound audio track. */

function instrument() {
  /* ---- a microphone that is a tone ----
     A steady 440 Hz sine, always running. The app's own gate — a disabled
     track on a guest, a gain ramp on a host — is then the only thing standing
     between it and the wire, which is exactly what we want to time. */
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
    window.__toneCtx = ac;
    fake = dest.stream;
    return fake;
  }

  const realGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = function (c) {
    if (c && c.audio && !c.video) {
      try {
        // A fresh clone each time: the app stops tracks it is done with, and a
        // stopped track cannot be handed out again.
        const s = fakeMic();
        const t = s.getAudioTracks()[0].clone();
        window.__micTracks = (window.__micTracks || []).concat(t);
        return Promise.resolve(new MediaStream([t]));
      } catch (e) { /* fall through to the real one */ }
    }
    return realGUM(c);
  };

  /* ---- every peer connection this page makes ----
     Captured by wrapping the constructor, so the test never has to reach into
     the app's own bookkeeping. The ICE configuration is NOT forced here: each
     case sets `window.RC_ICE` instead, which is the app's own documented
     override — so the suite exercises that hook rather than a back door only
     the suite has. */
  const RealPC = window.RTCPeerConnection;
  window.__pcs = [];
  function Wrapped(cfg) {
    const pc = new RealPC(cfg);
    window.__pcs.push(pc);
    return pc;
  }
  Wrapped.prototype = RealPC.prototype;
  Wrapped.generateCertificate = RealPC.generateCertificate && RealPC.generateCertificate.bind(RealPC);
  window.RTCPeerConnection = Wrapped;

  /* ---- listening for the tone ----
     One analyser per inbound audio track. Arming records the moment the test
     started listening; the first frame whose energy crosses the floor records
     the moment the room actually heard something. */
  window.__arm = function () {
    window.__heardAt = 0;
    window.__armedAt = Date.now();
    window.__peak = 0;
    // The previous measurement's tone is still in flight when this is called
    // again — down a relay 120 ms away, noticeably so — and a detector that
    // fires on it reports a press being heard before it happened. So arming
    // does not start listening: it starts waiting for quiet, and only what
    // rises *after* that counts.
    window.__quiet = 0;
    if (window.__watching) return true;
    window.__watching = true;

    const ac = new AC({ sampleRate: 48000 });
    window.__watchCtx = ac;
    const seen = new WeakSet();
    const analysers = [];

    function attach(track) {
      if (seen.has(track)) return;
      seen.add(track);
      // Chrome will not pull on a remote track that nothing is rendering, so
      // it is sunk into an element as well as into the graph.
      const el = new Audio();
      el.srcObject = new MediaStream([track]);
      el.autoplay = true;
      el.volume = 0.0001;
      const p = el.play();
      if (p && p.catch) p.catch(function () {});
      window.__sinks = (window.__sinks || []).concat(el);

      const src = ac.createMediaStreamSource(new MediaStream([track]));
      const an = ac.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      analysers.push({ an, buf: new Float32Array(an.fftSize) });
    }

    setInterval(function () {
      window.__pcs.forEach(function (pc) {
        try {
          pc.getReceivers().forEach(function (r) {
            if (r.track && r.track.kind === "audio") attach(r.track);
          });
        } catch (e) { /* closing */ }
      });
    }, 100);

    const FLOOR = 0.02;      // comfort noise and a ramp tail both sit well under
    const QUIET_FRAMES = 12; // ~200 ms of unbroken silence before going live

    function poll() {
      if (!window.__heardAt) {
        let loudest = 0;
        for (let i = 0; i < analysers.length; i++) {
          const a = analysers[i];
          a.an.getFloatTimeDomainData(a.buf);
          let sum = 0;
          for (let k = 0; k < a.buf.length; k++) sum += a.buf[k] * a.buf[k];
          const rms = Math.sqrt(sum / a.buf.length);
          if (rms > loudest) loudest = rms;
        }
        if (loudest > window.__peak) window.__peak = loudest;
        if (window.__quiet < QUIET_FRAMES) {
          window.__quiet = loudest < FLOOR ? window.__quiet + 1 : 0;
        } else if (loudest > FLOOR) {
          window.__heardAt = Date.now();
        }
      }
      requestAnimationFrame(poll);
    }
    requestAnimationFrame(poll);
    return true;
  };
}

/* ---------- driving one run ---------- */

const START = { lat: 14.30, lon: 121.00 };

async function makeBrowser() {
  return chromium.launch({
    args: [
      "--disable-features=WebRtcHideLocalIpsWithMdns",
      "--no-sandbox",
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
      // Loopback would otherwise be filtered out of the candidate set, which
      // would make every case here a relay case by accident.
      "--allow-loopback-in-peer-connection"
    ]
  });
}

async function newPage(browser, label, base, brokerPort, ice) {
  const ctx = await browser.newContext({
    viewport: { width: 900, height: 760 },
    permissions: ["geolocation", "microphone"],
    geolocation: { latitude: START.lat, longitude: START.lon, accuracy: 8 }
  });
  await ctx.addInitScript(
    ([p, iceJson]) => {
      window.RC_BROKERS = [{ host: "127.0.0.1", port: p, path: "/", key: "peerjs" }];
      if (iceJson) window.RC_ICE = JSON.parse(iceJson);
    },
    [brokerPort, ice ? JSON.stringify(ice) : ""]
  );
  await ctx.addInitScript(instrument);
  await stubWorld(ctx);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => {
    console.log("  !! " + label + " page error: " + e.message);
    failures++;
  });
  await page.goto(base);
  await page.waitForSelector("#map", { state: "attached" });
  await page.waitForFunction(() => !!(window.RC && window.RC.group && window.RC.voice));
  page.__label = label;
  page.__ctx = ctx;
  return page;
}

/** Press talk on `from`, and wait for `listeners` to hear the tone.
    Returns milliseconds, or null for a listener that never heard anything. */
async function timeTalk(from, listeners, timeoutMs) {
  await Promise.all(listeners.map((p) => p.evaluate(() => window.__arm())));
  // Long enough for the previous utterance to have drained out of even a slow
  // relay, and for every listener to have seen its run of quiet frames.
  await from.waitForTimeout(1000);
  for (const p of listeners) {
    await p.waitForFunction(() => window.__quiet >= 12 && !window.__heardAt, null, { timeout: 8000 })
      .catch(() => { /* reported as a miss below if it never settles */ });
  }
  // Whatever the tail of the last utterance may have tripped, it was not this
  // press: start the measurement from a clean slate.
  await Promise.all(listeners.map((p) => p.evaluate(() => {
    window.__heardAt = 0;
    window.__quiet = 12;
  })));

  const pressedAt = await from.evaluate(() => {
    const t = Date.now();
    window.RC.group.startTalking();
    return t;
  });

  const out = [];
  for (const p of listeners) {
    let heard = 0;
    const deadline = Date.now() + (timeoutMs || 6000);
    while (Date.now() < deadline) {
      heard = await p.evaluate(() => window.__heardAt || 0);
      if (heard) break;
      await p.waitForTimeout(25);
    }
    // A detection stamped before the thumb went down is the previous
    // utterance still draining, not this one arriving early.
    out.push(heard && heard >= pressedAt ? heard - pressedAt : null);
  }

  await from.evaluate(() => window.RC.group.stopTalking());
  await from.waitForTimeout(200);
  return out;
}

/**
 * One full scenario: three riders in a room, with whatever ICE configuration
 * the case calls for.
 */
async function runCase(name, browser, base, brokerPort, ice, opts) {
  opts = opts || {};
  section(name);
  const t0 = Date.now();

  const host = await newPage(browser, "host", base, brokerPort, ice);
  const g1 = await newPage(browser, "guest-1", base, brokerPort, ice);
  const g2 = await newPage(browser, "guest-2", base, brokerPort, ice);
  const pages = [host, g1, g2];
  const code = "LAT" + String(Math.floor(Math.random() * 900) + 100);

  try {
    await host.click("#group-btn");
    await host.fill("#group-name", "Lead");
    await host.fill("#group-code", code);
    await host.click("#group-host-btn");
    await host.waitForFunction(() => window.RC.group.isActive(), null, { timeout: 20000 });

    const joinAt = Date.now();
    for (const [p, who] of [[g1, "One"], [g2, "Two"]]) {
      await p.click("#group-btn");
      await p.fill("#group-name", who);
      await p.fill("#group-code", code);
      await p.click("#group-join-btn");
    }

    await host.waitForFunction(() => window.RC.group.pending().length === 2, null, { timeout: 40000 });
    await host.evaluate(() => window.RC.group.pending().forEach((g) => window.RC.group.approve(g.id, true)));

    for (const p of [g1, g2]) {
      await p.waitForFunction(() => window.RC.group.isActive() && !window.RC.group.isWaiting(),
                              null, { timeout: 40000 });
    }

    // The number that matters for "the button did nothing for ages": how long
    // until the talk button is a radio rather than a recorder.
    let liveAt = null;
    try {
      await Promise.all(pages.map((p) =>
        p.waitForFunction(() => window.RC.group.isLive(), null, { timeout: opts.liveTimeout || 30000 })));
      liveAt = Date.now();
    } catch (e) { /* recorded below as a failure */ }

    const setupMs = liveAt ? liveAt - joinAt : null;
    check("the live audio path came up for everyone", !!liveAt,
          liveAt ? "" : "still on the recorded-clip fallback after " +
                        Math.round((Date.now() - joinAt) / 1000) + "s");
    if (setupMs != null) note("setup (join -> live voice)", setupMs + " ms");

    const pair = await host.evaluate(() => ({
      selected: (window.__pcs[0] && window.__pcs[0].__selected) || null
    })).catch(() => ({}));
    void pair;

    // Which candidate pair actually won — the difference between "it works"
    // and "it works, through a relay in another country".
    const kinds = await host.evaluate(async () => {
      const out = [];
      for (const pc of window.__pcs) {
        try {
          const stats = await pc.getStats();
          let sel = null;
          stats.forEach((r) => {
            if (r.type === "candidate-pair" && (r.selected || r.state === "succeeded") && r.nominated) sel = r;
          });
          if (!sel) continue;
          const local = stats.get(sel.localCandidateId);
          const remote = stats.get(sel.remoteCandidateId);
          out.push((local && local.candidateType) + "/" + (remote && remote.candidateType));
        } catch (e) { /* closing */ }
      }
      return out;
    });
    if (kinds.length) note("selected candidate pairs (host)", kinds.join(", "));

    let direct = [null], relayed = [null];
    if (liveAt) {
      direct = await timeTalk(g1, [host], opts.talkTimeout);
      relayed = await timeTalk(g1, [g2], opts.talkTimeout);
    }

    check("the host hears a guest", direct[0] != null,
          direct[0] == null ? "no audio arrived within the deadline" : "");
    if (direct[0] != null) note("direct  (guest -> host)", direct[0] + " ms");

    check("a guest hears another guest through the host mix", relayed[0] != null,
          relayed[0] == null ? "no audio arrived within the deadline" : "");
    if (relayed[0] != null) note("relayed (guest -> host mix -> guest)", relayed[0] + " ms");

    results.push({
      name, setupMs, direct: direct[0], relayed: relayed[0],
      pairs: kinds.join(", "), totalMs: Date.now() - t0
    });
  } finally {
    for (const p of pages) {
      try { await p.evaluate(() => window.RC.group.leave()); } catch (e) { /* already gone */ }
      try { await p.__ctx.close(); } catch (e) { /* already gone */ }
    }
  }
}

/* ---------- the run ---------- */

async function main() {
  const only = (process.argv.find((a) => a.startsWith("--only=")) || "").slice(7)
    .split(",").filter(Boolean);
  const want = (k) => !only.length || only.indexOf(k) >= 0;

  const site = await serve();
  const sitePort = site.address().port;
  const base = `http://127.0.0.1:${sitePort}/index.html`;
  const { port: brokerPort, server: brokerServer } = await broker.start(0);

  const goodStun = await stun.start({ mode: "ok" });
  const deadStun = await stun.start({ mode: "black" });
  const relay = await turn.start({});
  const slowRelay = await turn.start({ delayMs: 120 });

  const browser = await makeBrowser();

  console.log("RouteCast voice latency");
  console.log("  site     " + base);
  console.log("  broker   127.0.0.1:" + brokerPort);
  console.log("  stun     ok=" + goodStun.port + "  black-holed=" + deadStun.port);
  console.log("  turn     ok=" + relay.port + "  +120ms=" + slowRelay.port);

  const stunUrl = (s) => "stun:127.0.0.1:" + s.port;

  try {
    if (want("baseline")) {
      await runCase("1. A STUN server that answers", browser, base, brokerPort, {
        iceServers: [{ urls: [stunUrl(goodStun)] }],
        iceCandidatePoolSize: 2
      });
    }

    if (want("deadstun")) {
      await runCase("2. A STUN server that quietly died", browser, base, brokerPort, {
        iceServers: [{ urls: [stunUrl(deadStun)] }],
        iceCandidatePoolSize: 2
      });
    }

    if (want("deadturn")) {
      // What the shipped configuration amounted to once openrelay stopped
      // answering: a good STUN server, and a TURN entry that is a black hole.
      // 192.0.2.0/24 is TEST-NET-1 — it routes nowhere and answers nothing,
      // which is precisely how a dead public relay behaves.
      await runCase("3. A dead TURN server in the list", browser, base, brokerPort, {
        iceServers: [
          { urls: [stunUrl(goodStun)] },
          {
            urls: [
              "turn:192.0.2.1:3478?transport=udp",
              "turn:192.0.2.1:3478?transport=tcp",
              "turns:192.0.2.1:5349?transport=tcp"
            ],
            username: "nobody", credential: "nothing"
          }
        ],
        iceCandidatePoolSize: 2
      });
    }

    if (want("relay")) {
      await runCase("4. Both riders behind hard NATs (relay only)", browser, base, brokerPort, {
        iceServers: [{ urls: [stunUrl(goodStun)] }, relay.iceServer],
        iceTransportPolicy: "relay",
        iceCandidatePoolSize: 2
      });
      note("turn relayed packets", relay.stats.relayedOut + " out / " + relay.stats.relayedIn + " in");
    }

    if (want("slowrelay")) {
      await runCase("5. A relay 120 ms away", browser, base, brokerPort, {
        iceServers: [{ urls: [stunUrl(goodStun)] }, slowRelay.iceServer],
        iceTransportPolicy: "relay",
        iceCandidatePoolSize: 2
      }, { talkTimeout: 9000 });
    }
  } finally {
    await browser.close();
    await Promise.all([goodStun.close(), deadStun.close(), relay.close(), slowRelay.close()]);
    brokerServer.close();
    site.close();
  }

  section("Summary");
  const pad = (s, n) => String(s == null ? "—" : s).padEnd(n);
  console.log("  " + pad("case", 40) + pad("setup", 10) + pad("direct", 10) + "relayed");
  results.forEach((r) => {
    console.log("  " + pad(r.name, 40) + pad(r.setupMs, 10) + pad(r.direct, 10) + (r.relayed == null ? "—" : r.relayed));
  });

  console.log("\n" + (failures ? failures + " failure(s)" : "all good"));
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
