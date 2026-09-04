/* tools/embed-e2e.js — only playable results reach the screen.
 *
 * A search mirror will return videos the host can never play: embedding
 * disabled (player errors 101/150), private or removed (100), and the odd
 * outright refusal (5). js/embed.js cues each candidate in an offscreen player
 * and keeps only the ones YouTube agrees to.
 *
 * The real IFrame API cannot be reached from CI, so this serves a stand-in
 * that refuses specific ids the way YouTube does, and takes its time about it
 * so the ordering and streaming claims are actually tested rather than
 * accidentally satisfied:
 *
 *   1. Refused videos never appear, and the count of them is reported.
 *   2. Rows appear as verdicts land, not after the whole sweep — the first
 *      playable result is on screen while later ones are still being probed.
 *   3. Rows sit in the mirror's ranking regardless of the order verdicts
 *      came back in.
 *   4. Verdicts are cached, so searching the same thing again probes nothing.
 *   5. A blocked IFrame API hides nothing — an unanswerable question must not
 *      cost the user results.
 *   6. A pasted link to a video that cannot be embedded is refused up front
 *      rather than dying on the host screen later.
 *
 * Run: node tools/embed-e2e.js
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

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

/* Seven results; the four that are not "ok" are refused. Two shapes of
 * refusal, because YouTube uses both: "no…" errors outright, while "cue…"
 * cues first and only then says no — the shape that used to sail through,
 * since a cue was taken for a verdict. Ranks 0 and 6 pass, so a list that
 * only appends in verdict order cannot come out right by luck. */
const IDS = [
  "ok000000001", "no000000001", "ok000000002",
  "cue00000001", "no000000002", "cue00000002", "ok000000003"
];
const FAKE_RESULTS = {
  items: IDS.map((id, i) => ({
    url: "/watch?v=" + id,
    type: "stream",
    title: "Song " + (i + 1) + " (Karaoke Version)",
    uploaderName: "Artist " + (i + 1),
    duration: 200 + i
  }))
};

/* A stand-in for https://www.youtube.com/iframe_api.
 *
 * Only the parts a probe uses are real: cueing lands in CUED, an id the
 * fixture refuses raises error 150, and every answer is deliberately slow
 * enough (and unevenly so) that a sweep is observable in progress. */
const MOCK_API = `
(function () {
  window.__cued = [];
  function Player(target, opts) {
    var node = typeof target === "string" ? document.getElementById(target) : target;
    var frame = document.createElement("iframe");
    frame.id = node.id;
    node.parentNode.replaceChild(frame, node);
    this._opts = opts;
    this._state = -1;
    this.videoId = null;
    var self = this;
    setTimeout(function () { opts.events.onReady({ target: self }); }, 10);
  }
  Player.prototype.cueVideoById = function (arg) {
    var id = (arg && arg.videoId) || arg;
    this.videoId = id;
    window.__cued.push(id);
    var self = this;
    function cued() { self._state = 5; self._opts.events.onStateChange({ data: 5, target: self }); }
    function refuse() { self._opts.events.onError({ data: 150, target: self }); }
    // Refusals come back faster than passes, so a result list built in the
    // order answers arrive would be visibly wrong.
    if (id.indexOf("no") === 0) setTimeout(refuse, 60);
    else if (id.indexOf("cue") === 0) {
      // The real player's shape for a video it will not embed: the id is
      // accepted and cued, and the refusal follows a beat later.
      setTimeout(cued, 60);
      setTimeout(refuse, 260);
    } else setTimeout(cued, 220);
  };
  Player.prototype.loadVideoById = Player.prototype.cueVideoById;
  Player.prototype.playVideo = function () {};
  Player.prototype.pauseVideo = function () {};
  Player.prototype.stopVideo = function () {};
  Player.prototype.seekTo = function () {};
  Player.prototype.setVolume = function () {};
  Player.prototype.mute = function () {};
  Player.prototype.unMute = function () {};
  Player.prototype.getCurrentTime = function () { return 0; };
  Player.prototype.getDuration = function () { return 200; };
  Player.prototype.getPlayerState = function () { return this._state; };
  Player.prototype.getVideoData = function () {
    return { title: "Mock", author: "Mock", video_id: this.videoId };
  };
  Player.prototype.destroy = function () {};
  window.YT = {
    Player: Player,
    PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 }
  };
  if (window.onYouTubeIframeAPIReady) window.onYouTubeIframeAPIReady();
})();
`;

let failures = 0;

/* A search is several rounds now — it tops itself up in different words when
 * the first pass comes back thin — so "the status line changed" is no longer
 * the end of it. `searchBusy` is, whatever the status happens to say. */
async function settled(page, timeout) {
  await page.waitForFunction(
    () => window.KN && window.KN.app && window.KN.app.searchBusy === false,
    null,
    { timeout: timeout || 25000 }
  );
}
function check(name, ok, extra) {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (ok || extra === undefined ? "" : "  → " + extra));
  if (!ok) failures++;
}

const titles = (page) =>
  page.$$eval("#results .row-title", (n) => n.map((x) => x.textContent.trim()));

async function main() {
  const site = await serve();
  const base = `http://127.0.0.1:${site.address().port}/index.html`;
  const browser = await chromium.launch({ args: ["--no-sandbox"] });

  /* `youtube` decides whether the IFrame API is reachable — the "blocked"
   * case below is the same page with it switched off. */
  async function newPage({ youtube = true } = {}) {
    const ctx = await browser.newContext();
    await ctx.route(/pipedapi|piped\.|invidious|nadeko|yewtu|melmac/, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(FAKE_RESULTS) })
    );
    await ctx.route(/youtube\.com\/iframe_api/, (route) =>
      youtube
        ? route.fulfill({ status: 200, contentType: "text/javascript", body: MOCK_API })
        : route.abort()
    );
    await ctx.route(/youtube\.com\/oembed/, (route) => route.abort());
    await ctx.route(/ytimg\.com/, (route) => route.abort());
    const page = await ctx.newPage();
    page.on("pageerror", (e) => { console.log("  !! page error:", e.message); failures++; });
    return page;
  }

  // ── the sweep ─────────────────────────────────────────────────────────────
  const page = await newPage();
  await page.goto(base + "#/library");
  await page.waitForSelector("#view-library:not([hidden])");

  await page.fill("#q", "opm");
  await page.click("#search-form button[type=submit]");

  // Streaming: a row is on screen while the sweep is still running. The status
  // line still says "checking", which is the proof it has not finished.
  await page.waitForSelector("#results .row", { timeout: 15000 });
  const midway = (await page.textContent("#search-status")).trim();
  check("a result is rendered before the sweep finishes", /checking/i.test(midway), JSON.stringify(midway));

  await settled(page);

  const shown = await titles(page);
  check("only the embeddable results are shown", shown.length === 3, String(shown.length));
  check(
    "they are the right three, in the mirror's order",
    JSON.stringify(shown) === JSON.stringify(["Song 1 (Karaoke Version)", "Song 3 (Karaoke Version)", "Song 7 (Karaoke Version)"]),
    JSON.stringify(shown)
  );
  check(
    "a video that cues and only then refuses is still dropped",
    !shown.some((t) => /^Song [46] /.test(t)),
    JSON.stringify(shown)
  );

  const status = (await page.textContent("#search-status")).trim();
  check("the status says how many were skipped", /4 cannot be embedded/.test(status), JSON.stringify(status));
  check("and claims no unchecked results when every probe answered", !/unchecked/.test(status), JSON.stringify(status));

  const probed = await page.evaluate(() => window.__cued.slice());
  check("every result was probed exactly once", probed.length === 7, String(probed.length));

  // ── the cache ─────────────────────────────────────────────────────────────
  await page.fill("#q", "opm");
  await page.click("#search-form button[type=submit]");
  await settled(page);
  const again = await titles(page);
  check("a repeat search shows the same three", JSON.stringify(again) === JSON.stringify(shown), JSON.stringify(again));
  const probedAgain = await page.evaluate(() => window.__cued.length);
  check("a repeat search probes nothing — verdicts are remembered", probedAgain === 7, String(probedAgain));

  // Remembered across a reload, not just in this page's memory.
  await page.reload();
  await page.waitForSelector("#view-library:not([hidden])");
  await page.fill("#q", "opm");
  await page.click("#search-form button[type=submit]");
  await settled(page);
  // __cued only exists once the API script loads — a sweep answered
  // entirely from cache never asks for it, which is the strongest form of
  // the claim.
  const afterReload = await page.evaluate(() => (window.__cued || []).length);
  check("the verdicts survive a reload", afterReload === 0, String(afterReload));
  check("and still show three results", (await titles(page)).length === 3);

  // ── a pasted link that cannot be embedded ────────────────────────────────
  await page.evaluate(() => window.KN.embed._forget());
  await page.fill("#q", "https://www.youtube.com/watch?v=cue00000001");
  await page.click("#search-form button[type=submit]");
  await page.waitForFunction(
    () => /cannot be played in an embed/.test(document.querySelector("#search-status").textContent),
    null,
    { timeout: 20000 }
  );
  check("a pasted link that disallows embedding is refused", true);
  check("and nothing was saved to the library", (await page.locator("#lib-songs .row").count()) === 0);

  await page.fill("#q", "https://www.youtube.com/watch?v=ok000000001");
  await page.click("#search-form button[type=submit]");
  await page.waitForFunction(
    () => document.querySelectorAll("#lib-songs .row").length > 0,
    null,
    { timeout: 20000 }
  );
  check("a pasted link that can be embedded still goes through", true);

  // ── the API is blocked ────────────────────────────────────────────────────
  // Nothing can be verified, so nothing may be hidden: a check we cannot run
  // must not cost the user results.
  const blind = await newPage({ youtube: false });
  await blind.goto(base + "#/library");
  await blind.waitForSelector("#view-library:not([hidden])");
  await blind.fill("#q", "opm");
  await blind.click("#search-form button[type=submit]");
  await blind.waitForSelector("#results .row", { timeout: 20000 });
  await settled(blind, 30000);
  const blindShown = await titles(blind);
  check(
    "an unreachable player API hides nothing",
    blindShown.length === 7,
    String(blindShown.length)
  );
  // …but it does not pass them off as vetted, either.
  const blindStatus = (await blind.textContent("#search-status")).trim();
  check("and says so — 0 playable, 7 unchecked", /0 playable · 7 unchecked/.test(blindStatus), JSON.stringify(blindStatus));
  check(
    "every unchecked row is flagged as such",
    (await blind.locator("#results .row-flag").count()) === 7,
    String(await blind.locator("#results .row-flag").count())
  );

  await browser.close();
  site.close();
  console.log(failures ? "\n" + failures + " problem(s)" : "\nall embed checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
