/* tools/player-e2e.js — playback state machine, without YouTube.
 *
 * The real IFrame API cannot be reached from CI (and should not be hammered
 * from it anyway), so this serves a stand-in that behaves the way YouTube's
 * player actually does in the two cases that matter:
 *
 *   1. `loadVideoById` lands in CUED rather than playing outright — the host
 *      has to kick it, exactly as the desktop app does.
 *   2. `playVideo` is ignored until the page has seen a real user gesture,
 *      which is the browser autoplay policy a Tauri webview never applies.
 *
 * What is verified here is our side of that contract: the CUED kick, the
 * blocked-autoplay detection, the tap-to-play prompt, the resulting state
 * reaching a guest, and ENDED advancing the queue.
 *
 * Run: node tools/player-e2e.js
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const broker = require("./broker");

const ROOT = path.resolve(__dirname, "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

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

/* A stand-in for https://www.youtube.com/iframe_api */
const MOCK_API = `
(function () {
  var gestureSeen = false;
  document.addEventListener("click", function () { gestureSeen = true; }, true);

  function Player(target, opts) {
    var node = typeof target === "string" ? document.getElementById(target) : target;
    var frame = document.createElement("iframe");
    frame.id = node.id;
    node.parentNode.replaceChild(frame, node);

    this._opts = opts;
    this._state = -1;
    this._time = 0;
    this._duration = 0;
    this._volume = 100;
    this._muted = false;
    this.videoId = null;
    // embed.js builds offscreen players of its own to vet search results;
    // those must not stand in for the room's real one in any assertion here.
    this._probe = node.id.indexOf("kn-probe") === 0;
    if (!this._probe) window.__player = this;

    var self = this;
    setTimeout(function () { opts.events.onReady({ target: self }); }, 10);
  }

  Player.prototype._set = function (s) {
    this._state = s;
    if (!this._probe) (window.__states = window.__states || []).push(s);
    if (this._opts.events.onStateChange) this._opts.events.onStateChange({ data: s, target: this });
  };

  // Mirrors the real API: loading cues the video, it does not start it.
  Player.prototype.loadVideoById = function (arg) {
    this.videoId = (arg && arg.videoId) || arg;
    this._duration = 213;
    this._time = (arg && arg.startSeconds) || 0;
    var self = this;
    setTimeout(function () { self._set(5); }, 20);
  };

  // What embed.js probes with: asks whether the video would play without
  // playing it. This mock never refuses, so every result passes vetting.
  Player.prototype.cueVideoById = function (arg) {
    this.videoId = (arg && arg.videoId) || arg;
    var self = this;
    setTimeout(function () { self._set(5); }, 10);
  };

  Player.prototype.playVideo = function () {
    if (!gestureSeen) return;          // autoplay policy: silently ignored
    if (this._state === 1) return;
    var self = this;
    setTimeout(function () {
      self._set(3);
      setTimeout(function () { self._set(1); }, 20);
    }, 10);
  };
  Player.prototype.pauseVideo = function () { if (this._state === 1) this._set(2); };
  Player.prototype.stopVideo = function () { this._set(-1); };
  Player.prototype.seekTo = function (t) { this._time = t; };
  Player.prototype.setVolume = function (v) { this._volume = v; };
  Player.prototype.getVolume = function () { return this._volume; };
  Player.prototype.mute = function () { this._muted = true; };
  Player.prototype.unMute = function () { this._muted = false; };
  Player.prototype.isMuted = function () { return this._muted; };
  Player.prototype.getCurrentTime = function () { return this._time; };
  Player.prototype.getDuration = function () { return this._duration; };
  Player.prototype.getPlayerState = function () { return this._state; };
  Player.prototype.getVideoData = function () {
    return { title: "Mock Song", author: "Mock Artist", video_id: this.videoId };
  };
  Player.prototype.destroy = function () {};

  window.YT = {
    Player: Player,
    PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 }
  };
  if (window.onYouTubeIframeAPIReady) window.onYouTubeIframeAPIReady();
})();
`;

const FAKE_RESULTS = {
  items: [
    { url: "/watch?v=aaaaaaaaaaa", type: "stream", title: "Anak (Karaoke Version)", uploaderName: "Freddie Aguilar", duration: 260 },
    { url: "/watch?v=bbbbbbbbbbb", type: "stream", title: "Harana Karaoke Version", uploaderName: "Parokya ni Edgar", duration: 232 }
  ]
};

let failures = 0;

/* Guests must name themselves before a room lets them in; a deep link puts the
 * gate up on arrival, so every scripted guest types a name first. */
/* Rooms ask for approval before letting anyone in — see `joinApproval` in
 * js/room.js. A scripted guest therefore arrives in a lobby and is not a guest
 * at all until the host says so, which is exactly the point of the setting, so
 * every test drives the real door rather than switching it off. */
async function admit(host, name) {
  await host.click('.tab[data-tab="singers"]');
  const row = host.locator("#pending .row", { hasText: name });
  await row.first().waitFor({ timeout: 25000 });
  await row.first().locator(".row-actions button").first().click();
  await host.waitForFunction(
    (n) => (window.KN.app.state.guests || []).some((g) => g.name === n),
    name,
    { timeout: 20000 }
  );
}

async function passNameGate(page, name) {
  try {
    await page.waitForSelector("#name-gate:not([hidden])", { timeout: 5000 });
  } catch (e) {
    return; // already named in this profile
  }
  await page.fill("#name-gate-input", name);
  await page.click("#name-gate-form button[type=submit]");
  await page.waitForSelector("#name-gate", { state: "hidden" });
}

function check(name, ok, extra) {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (ok || extra === undefined ? "" : "  → " + extra));
  if (!ok) failures++;
}

async function main() {
  const site = await serve();
  const sitePort = site.address().port;
  const { port: brokerPort } = await broker.start(0);
  const base = `http://127.0.0.1:${sitePort}/index.html`;

  const browser = await chromium.launch({
    args: ["--disable-features=WebRtcHideLocalIpsWithMdns", "--no-sandbox"]
  });

  async function newPage() {
    const ctx = await browser.newContext();
    await ctx.addInitScript(
      ([p]) => { window.KN_BROKERS = [{ host: "127.0.0.1", port: p, path: "/", key: "peerjs" }]; },
      [brokerPort]
    );
    await ctx.route(/pipedapi|piped\.|invidious|nadeko|yewtu|melmac/, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(FAKE_RESULTS) })
    );
    await ctx.route(/youtube\.com\/iframe_api/, (route) =>
      route.fulfill({ status: 200, contentType: "text/javascript", body: MOCK_API })
    );
    await ctx.route(/ytimg\.com/, (route) => route.abort());
    const page = await ctx.newPage();
    page.on("pageerror", (e) => { console.log("  !! page error:", e.message); failures++; });
    return page;
  }

  const host = await newPage();
  await host.goto(base + "#/host");
  await host.waitForSelector("#view-room:not([hidden])");
  const code = (await host.textContent("#room-code")).trim();

  const ready = await host.waitForFunction(() => !!window.__player, null, { timeout: 15000 }).then(() => true);
  check("player initialises against the IFrame API", ready);

  /* Nothing may be clicked on the host from here until the prompt appears:
   * an untouched TV screen is precisely the case where autoplay is refused,
   * and it is the normal way a karaoke room runs — the phones do the driving.
   * (A host that clicked "Add" itself has already granted the gesture.) */
  /* This suite is the one place the door has to be propped open rather than
   * driven: letting a guest in means clicking on the host, and a click on the
   * host is exactly the user gesture whose absence this file exists to test.
   * `evaluate` changes the setting without ever being a gesture. */
  await host.evaluate(() => {
    window.KN.app.state.config.joinApproval = false;
    window.KN.refresh();
  });

  const guest = await newPage();
  await guest.goto(base + "#/r/" + code);
  await passNameGate(guest, "Remote");
  await guest.waitForSelector("#conn.conn-ok", { timeout: 30000 });
  check("guest connects before the host has been touched", true);

  await guest.click('.tab[data-tab="search"]');
  await guest.fill("#q", "opm");
  await guest.click("#search-form button[type=submit]");
  await guest.waitForSelector("#results .row");
  await guest.locator("#results .row").first().locator(".add-btn").click();

  await host.waitForFunction(() => window.__player && window.__player.videoId === "aaaaaaaaaaa", null, { timeout: 15000 });
  check("a song queued from a phone loads that video id on the host", true);

  await host.waitForFunction(() => (window.__states || []).includes(5), null, { timeout: 15000 });
  check("player reaches the CUED state", true);

  // Autoplay is refused, so the prompt must appear rather than sitting silent.
  await host.waitForSelector("#tap-to-play:not([hidden])", { timeout: 15000 });
  check("blocked autoplay raises the tap-to-play prompt", true);

  const stillNotPlaying = await host.evaluate(() => window.__player.getPlayerState() !== 1);
  check("nothing is playing while the prompt is up", stillNotPlaying);

  // The tap is the gesture the browser was waiting for.
  await host.click("#tap-to-play");
  await host.waitForFunction(() => window.__player.getPlayerState() === 1, null, { timeout: 15000 });
  check("tapping the prompt starts playback", true);
  await host.waitForSelector("#tap-to-play", { state: "hidden", timeout: 10000 });
  check("prompt clears once playback starts", true);

  /* The transport is drawn with icons, not glyphs, so the label is the only
   * thing that carries the state in text. (This used to read textContent for a
   * "⏸" and had been failing silently since the icon set landed.) */
  const btn = await host.getAttribute("#play-btn", "aria-label");
  check("transport shows the pause affordance while playing", btn === "Pause", String(btn));

  // Player-reported metadata should reach the room.
  await host.waitForFunction(
    () => document.querySelector("#t-end") && document.querySelector("#t-end").textContent.trim() === "3:33",
    null,
    { timeout: 15000 }
  );
  check("duration reported by the player reaches the transport", true);

  // The guest should see the same playback state.
  await guest.waitForFunction(
    () => {
      const t = document.querySelector("#now .now-title");
      return t && /^Anak/.test(t.textContent.trim()) &&
        document.querySelector("#play-btn").getAttribute("aria-label") === "Pause";
    },
    null,
    { timeout: 20000 }
  );
  check("guest mirrors the playing state", true);

  // Pause from the guest reaches the host's player.
  await guest.click("#play-btn");
  await host.waitForFunction(() => window.__player.getPlayerState() === 2, null, { timeout: 15000 });
  check("guest pause reaches the host's player", true);

  // Queue a second song, then end the first: the queue must advance itself.
  await guest.click('.tab[data-tab="search"]');
  await guest.locator("#results .row").nth(1).locator(".add-btn").click();
  await host.waitForFunction(() => document.querySelectorAll("#queue .row").length === 1, null, { timeout: 15000 });

  await host.evaluate(() => window.__player._set(0)); // ENDED

  /* A song that reaches the end gets scored, on the stage rather than in a
   * panel — the one place that survives the jump to fullscreen. */
  await host.waitForSelector("#score-card:not([hidden])", { timeout: 10000 });

  /* The number counts up rather than appearing, so reading it the instant the
   * card shows gets whatever it happened to be passing through. `.revealed`
   * is set when the count lands, which is the only moment the digits mean
   * anything. */
  const climbing = await host.evaluate(() => Number(document.getElementById("score-value").textContent));
  await host.waitForSelector("#score-card.revealed", { timeout: 15000 });
  const scored = await host.evaluate(() => Number(document.getElementById("score-value").textContent));
  check("a finished song is scored on the stage", scored >= 65 && scored <= 101, String(scored));
  check("the score counts up to it rather than appearing", climbing < scored, climbing + " → " + scored);
  const scoreLine = await host.textContent("#score-line");
  check("the score comes with something to say", scoreLine.trim().length > 0, scoreLine);

  // And the table underneath says where that number puts them.
  await host.waitForFunction(
    () => document.querySelectorAll("#score-board .sb-row").length > 0,
    null,
    { timeout: 15000 }
  );
  check("the leaderboard follows the score onto the stage", true);

  await host.waitForFunction(() => window.__player.videoId === "bbbbbbbbbbb", null, { timeout: 15000 });
  check("a finished song advances to the next in the queue", true);
  check("the score card clears once the next song loads", await host.locator("#score-card").isHidden());

  const board = await host.evaluate(() => document.querySelectorAll("#board .board-row").length);
  check("the score reaches the session leaderboard", board === 1, String(board));

  await host.waitForFunction(
    () => {
      const t = document.querySelector("#now .now-title");
      return t && /^Harana/.test(t.textContent.trim());
    },
    null,
    { timeout: 10000 }
  );
  check("now-playing follows the advance", true);

  /* Skipping is not a performance. Scoring one would make every number in the
   * room meaningless within about four songs. */
  await host.evaluate(() => document.getElementById("skip-btn").click());
  await host.waitForTimeout(600);
  check("a skipped song is not scored", await host.locator("#score-card").isHidden());
  const boardAfterSkip = await host.evaluate(() => document.querySelectorAll("#board .board-row").length);
  check("and never reaches the leaderboard", boardAfterSkip === 1, String(boardAfterSkip));

  // Volume and mute route through to the player object.
  await host.evaluate(() => {
    const v = document.querySelector("#vol");
    v.value = "35";
    v.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await host.waitForFunction(() => window.__player.getVolume() === 35, null, { timeout: 10000 });
  check("volume changes reach the player", true);

  await host.click("#mute-btn");
  await host.waitForFunction(() => window.__player.isMuted() === true, null, { timeout: 10000 });
  check("mute reaches the player", true);

  /* ── the API load is recoverable ──────────────────────────────────────
   * A blocker switched off, or a lift left, used to change nothing: the
   * rejected load was memoised, so the host stared at "could not load" until
   * it reloaded the page and lost the room. Fail once, fix the cause, retry
   * in place — the player must come up. */
  const flaky = await browser.newContext();
  await flaky.addInitScript(
    ([p]) => { window.KN_BROKERS = [{ host: "127.0.0.1", port: p, path: "/", key: "peerjs" }]; },
    [brokerPort]
  );
  let apiBlocked = true;
  await flaky.route(/youtube\.com\/iframe_api/, (route) =>
    apiBlocked
      ? route.abort()
      : route.fulfill({ status: 200, contentType: "text/javascript", body: MOCK_API })
  );
  await flaky.route(/ytimg\.com/, (route) => route.abort());
  const retryHost = await flaky.newPage();
  await retryHost.goto(base + "#/host");
  await retryHost.waitForSelector(".player-error", { timeout: 20000 });
  check("a refused API script surfaces without waiting out the whole budget", true);

  apiBlocked = false;
  await retryHost.click(".player-error button");
  await retryHost.waitForFunction(() => !!window.__player, null, { timeout: 20000 });
  check("retrying after the block is lifted brings the player up", true);
  check(
    "the error clears once the retry succeeds",
    (await retryHost.locator(".player-error").count()) === 0
  );

  await browser.close();
  site.close();
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
