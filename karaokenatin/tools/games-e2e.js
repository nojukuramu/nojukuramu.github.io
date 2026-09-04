/* tools/games-e2e.js — the Games tab, dragging the queue, and the statistics
 * this browser keeps about itself.
 *
 * Three features that share one property: they are all about state that has to
 * survive being handled by more than one person, or by the same person twice.
 * A roulette pot is filled by everybody and drawn from once; a drag races the
 * queue it is dragging in; a statistics page is the only part of this app that
 * remembers anything past midnight.
 *
 * Run: node tools/games-e2e.js      (needs playwright)
 *
 * No public broker, no mirror, no YouTube: the signalling runs against
 * tools/broker.js, the search mirror is stubbed, and the IFrame API is a
 * stand-in that answers every id. Nothing here reaches the network.
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

/* Four karaoke-shaped results: the roulette needs three in the pot before it
 * will go in the queue, so four is one more than the interesting boundary. */
const FAKE_RESULTS = {
  items: [
    { url: "/watch?v=aaaaaaaaaaa", type: "stream", title: "Anak (Karaoke Version)", uploaderName: "Sing King Karaoke", duration: 260 },
    { url: "/watch?v=bbbbbbbbbbb", type: "stream", title: "Harana Karaoke Version", uploaderName: "Karaoke PH", duration: 232 },
    { url: "/watch?v=ccccccccccc", type: "stream", title: "Tadhana - Minus One", uploaderName: "Videoke Channel", duration: 301 },
    { url: "/watch?v=ddddddddddd", type: "stream", title: "Migraine Karaoke", uploaderName: "Karaoke PH", duration: 214 },
    /* Deliberately not a karaoke track. It must never reach the list. */
    { url: "/watch?v=eeeeeeeeeee", type: "stream", title: "Anak (Official Music Video)", uploaderName: "Freddie Aguilar", duration: 260 }
  ]
};

/* A stand-in for YouTube's IFrame API that says yes to everything, so the
 * embeddability sweep is not what this file is measuring. */
const FAKE_YT = `
(function () {
  function Player(el, opts) {
    var self = this;
    this.opts = opts || {};
    var node = typeof el === "string" ? document.getElementById(el) : el;
    if (node) { var d = document.createElement("div"); d.id = node.id; node.parentNode.replaceChild(d, node); }
    this.videoId = null;
    this.state = -1;
    setTimeout(function () { if (self.opts.events && self.opts.events.onReady) self.opts.events.onReady({ target: self }); }, 5);
  }
  Player.prototype._emit = function (s) {
    this.state = s;
    if (this.opts.events && this.opts.events.onStateChange) this.opts.events.onStateChange({ data: s, target: this });
  };
  Player.prototype.cueVideoById = function (a) {
    this.videoId = a && a.videoId ? a.videoId : a;
    var self = this;
    setTimeout(function () { self._emit(5); }, 5);
  };
  Player.prototype.loadVideoById = function (a) {
    this.videoId = a && a.videoId ? a.videoId : a;
    /* Only the host's real player ever loads; the embeddability probes only
     * cue. So the last thing to load is the one the room is watching, and it
     * is the one a test needs a handle on to end a song. */
    window.__player = this;
    window.__loaded = (window.__loaded || []).concat([this.videoId]);
    var self = this;
    setTimeout(function () { self._emit(1); }, 5);
  };
  Player.prototype.playVideo = function () { this._emit(1); };
  Player.prototype.pauseVideo = function () { this._emit(2); };
  Player.prototype.stopVideo = function () { this._emit(-1); };
  Player.prototype.seekTo = function () {};
  Player.prototype.setVolume = function (v) { this._v = v; };
  Player.prototype.getVolume = function () { return this._v === undefined ? 80 : this._v; };
  Player.prototype.mute = function () { this._m = true; };
  Player.prototype.unMute = function () { this._m = false; };
  Player.prototype.isMuted = function () { return !!this._m; };
  Player.prototype.getCurrentTime = function () { return 0; };
  Player.prototype.getDuration = function () { return 0; };
  Player.prototype.getPlayerState = function () { return this.state; };
  Player.prototype.getVideoData = function () { return { video_id: this.videoId, title: "", author: "" }; };
  Player.prototype.destroy = function () {};
  window.YT = { Player: Player, PlayerState: { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } };
  if (window.onYouTubeIframeAPIReady) window.onYouTubeIframeAPIReady();
})();
`;

let failures = 0;
function check(name, ok, extra) {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (ok || extra === undefined ? "" : "  → " + extra));
  if (!ok) failures++;
}

async function passNameGate(page, name) {
  try {
    await page.waitForSelector("#name-gate:not([hidden])", { timeout: 5000 });
  } catch (e) {
    return;
  }
  await page.fill("#name-gate-input", name);
  await page.click("#name-gate-form button[type=submit]");
  await page.waitForSelector("#name-gate", { state: "hidden" });
}

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

async function main() {
  const { port: brokerPort } = await broker.start(0);
  const site = await serve();
  const base = "http://127.0.0.1:" + site.address().port + "/index.html";

  const browser = await chromium.launch();
  const queries = [];

  async function newPage(width) {
    const ctx = await browser.newContext({ viewport: { width: width || 420, height: 900 } });
    await ctx.addInitScript(
      ([p]) => { window.KN_BROKERS = [{ host: "127.0.0.1", port: p, path: "/", key: "peerjs" }]; },
      [brokerPort]
    );
    await ctx.route(/pipedapi|piped\.|invidious|nadeko|yewtu|melmac/, (r) => {
      queries.push(decodeURIComponent(r.request().url()));
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(FAKE_RESULTS) });
    });
    await ctx.route(/youtube\.com\/iframe_api/, (r) =>
      r.fulfill({ status: 200, contentType: "text/javascript", body: FAKE_YT })
    );
    /* Only the thumbnails are blocked. A blanket youtube.com abort would be
     * matched ahead of the iframe_api stub above and take the player with it. */
    await ctx.route(/ytimg\.com/, (r) => r.abort());
    const page = await ctx.newPage();
    page.on("pageerror", (e) => { console.log("  !! page error:", e.message); failures++; });
    return page;
  }

  /* ── the search list ──────────────────────────────────────────────────── */
  const host = await newPage(1280);
  await host.goto(base + "#/host");
  await host.waitForSelector("#view-room:not([hidden])");
  const code = (await host.textContent("#room-code")).trim();

  await host.click('.tab[data-tab="search"]');
  await host.fill("#q", "opm");
  await host.click("#search-form button[type=submit]");
  await host.waitForFunction(() => window.KN.app.searchBusy === false, null, { timeout: 30000 });

  const titles = await host.locator("#results .row-title").allTextContents();
  check("the official music video never reaches the list", !titles.some((t) => /Official Music Video/.test(t)), titles.join(" | "));
  check("the four karaoke tracks do", titles.length === 4, String(titles.length));
  check(
    "and they are badged as karaoke",
    (await host.locator("#results .row-karaoke .karaoke-badge").count()) === 4,
    String(await host.locator("#results .row-karaoke .karaoke-badge").count())
  );
  const status = await host.textContent("#search-status");
  check("the status accounts for the one that was dropped", /1 not karaoke/.test(status), JSON.stringify(status));

  /* The multi-round top-up: four is under the ten it wants, so it asks the
   * mirror again in different words rather than settling for a short list. */
  /* Each round fans out across several mirrors at once, so counting requests
   * says nothing. Counting *distinct queries* is the claim: more than one
   * means the thin list was asked about again in different words. */
  const asked = [...new Set(queries.map((u) => (u.split("q=")[1] || "").split("&")[0]))];
  check(
    "a thin list is topped up with a differently-worded search",
    asked.length >= 2 && asked.every((q) => /opm/.test(q)),
    JSON.stringify(asked)
  );

  /* ── filling the pot ──────────────────────────────────────────────────── */
  const guest = await newPage();
  await guest.goto(base + "#/r/" + code);
  await passNameGate(guest, "Maria");
  await guest.waitForSelector("#conn.conn-ok", { timeout: 30000 });
  await admit(host, "Maria");
  await guest.waitForSelector("#lobby-wait", { state: "hidden", timeout: 20000 });

  await host.click('.tab[data-tab="games"]');
  const queueBtn = host.locator("#roulette-queue");
  check("an empty pot cannot be queued", await queueBtn.isDisabled());
  check("and says how many more it needs", /3 more songs/.test(await host.textContent("#roulette-hint")));

  // Two from the host, one from the guest — "added by" has to survive the wire.
  await host.click('.tab[data-tab="search"]');
  for (const i of [0, 1]) {
    await host.locator("#results .row").nth(i).locator('button[title*="playlist"]').click();
    await host.waitForSelector("#picker:not([hidden])");
    await host.click("#picker-roulette");
    await host.waitForSelector("#picker", { state: "hidden" });
  }

  await guest.click('.tab[data-tab="search"]');
  await guest.fill("#q", "opm");
  await guest.click("#search-form button[type=submit]");
  await guest.waitForFunction(() => window.KN.app.searchBusy === false, null, { timeout: 30000 });
  await guest.locator("#results .row").nth(2).locator('button[title*="playlist"]').click();
  await guest.waitForSelector("#picker:not([hidden])");
  await guest.click("#picker-roulette");

  await host.waitForFunction(
    () => window.KN.app.state.roulette.pool.length === 3,
    null,
    { timeout: 20000 }
  );
  check("songs from every phone land in the same pot", true);

  const addedBy = await host.evaluate(() => window.KN.app.state.roulette.pool.map((e) => e.addedBy));
  check("each one remembers who put it there", addedBy.includes("Maria"), JSON.stringify(addedBy));

  /* Measured on the host, which is the only copy that decides anything — a
   * guest's mirror can be a snapshot behind and would make this look flaky. */
  const potBefore = await host.evaluate(() => window.KN.app.state.roulette.pool.length);
  const already = await host.evaluate(() => window.KN.app.state.roulette.pool[0].id);
  await guest.evaluate(
    (id) => window.KN.app.net.send({ type: "GAME_ADD", video: { id: id, title: "Sneaked in twice" } }),
    already
  );
  await host.waitForTimeout(1500);
  const potAfter = await host.evaluate(() => window.KN.app.state.roulette.pool.length);
  check("the same song cannot go in the pot twice", potAfter === potBefore, potBefore + " → " + potAfter);

  /* ── the wheel ────────────────────────────────────────────────────────── */
  await host.click('.tab[data-tab="games"]');
  check("three songs is enough to queue a round", !(await queueBtn.isDisabled()));
  await queueBtn.click();

  await host.waitForFunction(
    () => document.querySelector("#spin-card") && !document.querySelector("#spin-card").hidden,
    null,
    { timeout: 20000 }
  );
  check("a queued round takes over the stage as a wheel", true);
  check("and starts by asking who is singing", /who is singing/i.test(await host.textContent("#spin-label")));

  await host.waitForFunction(
    () => {
      const s = window.KN.app.state;
      return !!(s.now && s.now.viaGame === "roulette");
    },
    null,
    { timeout: 30000 }
  );
  const picked = await host.evaluate(() => ({
    title: window.KN.app.state.now.title,
    by: window.KN.app.state.now.addedBy,
    left: window.KN.app.state.roulette.pool.length
  }));
  check("the wheel lands on a song and plays it", !!picked.title, JSON.stringify(picked));
  check("credited to whoever the wheel picked", !!picked.by, picked.by);
  check("and a picked song leaves the pot", picked.left === 2, String(picked.left));
  check(
    "the round is charged to the roulette, not to whoever queued it",
    (await host.evaluate(() => window.KN.app.state.queue.length)) === 0
  );

  /* ── the score, and the offer to go again ─────────────────────────────── */
  await host.evaluate(() => window.__player._emit(0));       // ENDED
  await host.waitForSelector("#score-card.revealed", { timeout: 25000 });
  check("a roulette song is scored like any other", true);

  /* Two songs left in the pot — below the three it takes to *start* a
   * roulette, and plenty to carry one on — so the room is offered another
   * round on the spot rather than being marched back to the queue. */
  await host.waitForSelector("#spin-again:not([hidden])", { timeout: 25000 });
  check("and the host is offered another round", true);
  const countdown = await host.textContent("#spin-again-count");
  check("with a visible countdown rather than a silent one", /^[0-3]$/.test(countdown.trim()), countdown);

  /* A co-host is usually on a phone, and the offer is explicitly theirs too —
   * so it has to reach somewhere they can press it, not just the host screen. */
  await host.evaluate(() => {
    window.KN.app.net.guests().forEach((l) => { window.KN.app.cohosts[l.id] = true; });
    window.KN.app.state.cohosts = window.KN.app.cohosts;
    window.KN.app.net.guests().forEach((l) =>
      l.send({ type: "STATE", rev: window.KN.app.state.rev, state: window.KN.app.state }));
  });
  await guest.waitForSelector("#spin-again:not([hidden])", { timeout: 15000 });
  check("a co-host on a phone is offered the round too", true);

  await host.click("#spin-again-yes");
  await host.waitForFunction(
    () => window.KN.app.state.roulette.pool.length === 1,
    null,
    { timeout: 30000 }
  );
  check("spinning again draws another song from the pot", true);
  check(
    "and the offer is gone once it is taken",
    await host.locator("#spin-again").isHidden()
  );

  /* ── dragging the queue ───────────────────────────────────────────────── */
  await host.evaluate(() => {
    const R = window.KN.room;
    const s = window.KN.app.state;
    s.queue.push(R.toSong({ id: "q000000001", title: "First", duration: 100 }, "Maria", "m"));
    s.queue.push(R.toSong({ id: "q000000002", title: "Second", duration: 100 }, "Maria", "m"));
    s.queue.push(R.toSong({ id: "q000000003", title: "Third", duration: 100 }, "Maria", "m"));
    window.KN.refresh();
  });
  await host.click('.tab[data-tab="queue"]');
  await host.waitForSelector("#queue .row:nth-child(3)");
  check("every queue row offers a drag handle", (await host.locator("#queue .row-grip").count()) === 3);

  const rows = host.locator("#queue .row");
  const firstGrip = rows.first().locator(".row-grip");
  const from = await firstGrip.boundingBox();
  const target = await rows.nth(2).boundingBox();

  await host.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await host.mouse.down();
  // Past the last row's midpoint, not onto it: a row only gives up its slot
  // once the thing being dragged has actually gone by it.
  await host.mouse.move(from.x + from.width / 2, target.y + target.height * 0.9, { steps: 12 });
  await host.mouse.up();

  await host.waitForFunction(
    () => {
      const t = [...document.querySelectorAll("#queue .row-title")].map((n) => n.textContent);
      return t[0] === "Second";
    },
    null,
    { timeout: 15000 }
  );
  const order = await host.locator("#queue .row-title").allTextContents();
  check("dragging a row to the bottom reorders the queue", JSON.stringify(order) === JSON.stringify(["Second", "Third", "First"]), JSON.stringify(order));

  const guestOrder = await guest.evaluate(() => window.KN.app.state.queue.map((s) => s.title));
  check("and the reorder reaches every phone", JSON.stringify(guestOrder) === JSON.stringify(order), JSON.stringify(guestOrder));

  /* ── statistics ───────────────────────────────────────────────────────── */
  const solo = await newPage();
  await solo.goto(base + "#/stats");
  await solo.waitForSelector("#view-stats:not([hidden])");
  check("statistics open with no room at all", true);
  check("an empty page says so rather than showing zeroes", await solo.locator("#stats-empty").isVisible());
  const privacy = await solo.textContent(".stats-privacy");
  check(
    "and says where the data lives before showing any",
    /stored on this device only/i.test(privacy) && /never uploaded/i.test(privacy),
    JSON.stringify(privacy.slice(0, 80))
  );

  await solo.evaluate(() => {
    window.KN.stats.startSession({ code: "ABC123", role: "guest" });
    window.KN.stats.recordSong({ title: "Anak", score: 88, seconds: 240 });
    window.KN.stats.recordSong({ title: "Harana", score: 96, seconds: 200 });
    window.KN.stats.recordGame("roulette", "win");
    window.KN.stats.recordGame("roulette", "loss");
    window.KN.stats.endSession();
  });
  await solo.reload();
  await solo.waitForSelector("#view-stats:not([hidden])");
  check("a page with history shows it", !(await solo.locator("#stats-empty").isVisible()));

  const values = await solo.locator(".stat-value").allTextContents();
  check("the headline is the average of the two scores", values[0] === "92", JSON.stringify(values));
  check("the best score is the higher one", values[1] === "96", JSON.stringify(values));
  check("both songs are counted", values[2] === "2", JSON.stringify(values));

  const games = await solo.textContent("#stats-games");
  check("a game's winrate is worked out", /50% winrate/.test(games), JSON.stringify(games.slice(0, 120)));
  check("and it says which game", /Song Roulette/.test(games));

  const sessionRows = await solo.locator("#stats-sessions .row").count();
  check("the session is listed", sessionRows === 1, String(sessionRows));
  const songRows = await solo.locator("#stats-songs .row").count();
  check("and so are the songs in it", songRows === 2, String(songRows));

  /* Statistics survive a reload — they are the one part of this app that is
   * supposed to outlive the night — and can be erased outright. */
  await solo.evaluate(() => { window.confirm = () => true; });
  await solo.click("#stats-clear");
  await solo.waitForSelector("#stats-empty:not([hidden])");
  check("and the whole lot can be erased on demand", true);
  const wiped = await solo.evaluate(() => localStorage.getItem("kn:stats"));
  check("erasing really empties the store", !wiped || !/Anak/.test(wiped), String(wiped).slice(0, 60));

  await browser.close();
  site.close();
  console.log(failures ? "\n" + failures + " problem(s)" : "\nall games checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
