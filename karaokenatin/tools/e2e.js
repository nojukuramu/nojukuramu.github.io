/* tools/e2e.js — end-to-end check: two real browsers, one real WebRTC link.
 *
 * Boots a static file server and the local broker stand-in, opens a host page
 * and a guest page in Chromium, and drives a full session: connect, add songs
 * from search, reorder, remove, take over playback, and reconnect after the
 * link is cut. Nothing here talks to a public broker, Piped, or YouTube —
 * search is intercepted and the YouTube API is blocked on purpose, which also
 * exercises the "player unavailable" path.
 *
 * Run: node tools/e2e.js
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

const FAKE_RESULTS = {
  items: [
    { url: "/watch?v=aaaaaaaaaaa", type: "stream", title: "Anak", uploaderName: "Freddie Aguilar", duration: 260, thumbnail: "" },
    { url: "/watch?v=bbbbbbbbbbb", type: "stream", title: "Kahit Maputi Na Ang Buhok Ko", uploaderName: "Noel Cabangon", duration: 245, thumbnail: "" },
    { url: "/watch?v=ccccccccccc", type: "stream", title: "Harana", uploaderName: "Parokya ni Edgar", duration: 232, thumbnail: "" }
  ]
};

let failures = 0;

/* Guests must name themselves before a room lets them in; a deep link puts the
 * gate up on arrival, so every scripted guest types a name first. */
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
    // Point the app at the local broker, and keep every external request off
    // the wire: YouTube's API is blocked (tests the degraded path) and search
    // is answered with a fixture.
    await ctx.addInitScript(
      ([p]) => {
        window.KN_BROKERS = [{ host: "127.0.0.1", port: p, path: "/", key: "peerjs" }];
        // Keep a handle on every peer connection so the test can sever a live
        // link the way a dropped network would, without a hook in the app.
        var Native = window.RTCPeerConnection;
        window.__pcs = [];
        window.RTCPeerConnection = function (cfg) {
          var pc = new Native(cfg);
          window.__pcs.push(pc);
          return pc;
        };
        window.RTCPeerConnection.prototype = Native.prototype;
      },
      [brokerPort]
    );
    await ctx.route(/pipedapi|piped\.|invidious|nadeko|yewtu|melmac/, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(FAKE_RESULTS) })
    );
    await ctx.route(/youtube\.com|youtube-nocookie\.com|ytimg\.com/, (route) => route.abort());
    const page = await ctx.newPage();
    page.on("pageerror", (e) => { console.log("  !! page error:", e.message); failures++; });
    return page;
  }

  const host = await newPage();
  await host.goto(base + "#/host");
  await host.waitForSelector("#view-room:not([hidden])");
  const code = (await host.textContent("#room-code")).trim();
  check("host opens a room with a 6-character code", /^[A-Z0-9]{6}$/.test(code), code);

  // The QR canvas should have been drawn with the join link.
  await host.click('.tab[data-tab="share"]');
  const qrDrawn = await host.evaluate(() => {
    const c = document.getElementById("qr");
    return !c.hidden && c.width > 0 && c.height > 0;
  });
  check("QR code renders for the join link", qrDrawn);

  const shareUrl = (await host.textContent("#share-url")).trim();
  check("share link carries the room code", shareUrl.endsWith("#/r/" + code), shareUrl);

  // ── guest joins ───────────────────────────────────────────────────────────
  const guest = await newPage();
  await guest.goto(base + "#/r/" + code);
  await passNameGate(guest, "Guest One");
  await guest.waitForSelector("#conn.conn-ok", { timeout: 30000 });
  check("guest connects to the host over WebRTC", true);

  await host.waitForFunction(() => document.querySelector("#guest-count").textContent === "1", null, { timeout: 15000 });
  check("host sees one connected guest", true);

  // ── search + queue ────────────────────────────────────────────────────────
  await guest.click('.tab[data-tab="search"]');
  await guest.fill("#q", "opm karaoke");
  await guest.click("#search-form button[type=submit]");
  await guest.waitForSelector("#results .row", { timeout: 15000 });
  const resultCount = await guest.locator("#results .row").count();
  check("search returns results through the Piped tier", resultCount === 3, String(resultCount));

  await guest.locator("#results .row").first().locator(".add-btn").click();
  await guest.locator("#results .row").nth(1).locator(".add-btn").click();

  await host.waitForFunction(() => document.querySelectorAll("#queue .row").length >= 1, null, { timeout: 15000 });
  const hostTitles = () => host.locator("#queue .row .row-title").allTextContents();

  // The first song auto-starts, so one of the two lands in `now`.
  await host.waitForFunction(() => document.querySelector("#now .now-title") !== null, null, { timeout: 15000 });
  const nowTitle = (await host.textContent("#now .now-title")).trim();
  check("first added song becomes now-playing on the host", nowTitle === "Anak", nowTitle);
  check("second song waits in the host queue", (await hostTitles()).length === 1);

  // Guest mirror agrees.
  await guest.waitForFunction(() => {
    const n = document.querySelector("#now .now-title");
    return n && n.textContent.trim() === "Anak";
  }, null, { timeout: 15000 });
  check("guest mirror shows the same now-playing", true);

  // ── a pasted link needs no search mirror ─────────────────────────────────
  await guest.fill("#q", "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await guest.click("#search-form button[type=submit]");
  await guest.waitForFunction(() => document.querySelectorAll("#queue .row").length === 2, null, { timeout: 20000 });
  check("pasted YouTube link is added straight to the queue", true);

  // ── reordering from the guest reaches the host ────────────────────────────
  await guest.click('.tab[data-tab="queue"]');
  const before = await guest.locator("#queue .row .row-title").allTextContents();
  await guest.locator("#queue .row").last().locator('button[title="Play next"]').click();
  await host.waitForFunction(
    (first) => {
      const rows = document.querySelectorAll("#queue .row .row-title");
      return rows.length === 2 && rows[0].textContent.trim() !== first;
    },
    before[0],
    { timeout: 15000 }
  );
  check("guest can reorder the host's queue", true);

  // ── removal ──────────────────────────────────────────────────────────────
  await guest.locator("#queue .row").first().locator('button[title="Remove"]').click();
  await host.waitForFunction(() => document.querySelectorAll("#queue .row").length === 1, null, { timeout: 15000 });
  check("guest can remove a song from the host's queue", true);

  // ── the player really is unavailable here, and says so ───────────────────
  const playerMsg = await host.textContent(".player-error-text").catch(() => null);
  check("blocked YouTube API degrades to a visible message", !!playerMsg, playerMsg || "no message");
  /* The two hops fail differently and must not be described with one shrug:
   * here it is the API script itself that was refused, so say that. */
  check(
    "the message names the refused script, not the connection",
    !!playerMsg && /iframe_api/.test(playerMsg),
    playerMsg || "no message"
  );
  /* Blockers get switched off and lifts get left — the failure has to offer a
   * way back that is not "reload and lose the room". */
  check(
    "a failed player load offers a retry",
    await host.locator(".player-error button").isVisible().catch(() => false)
  );

  // ── reconnection ─────────────────────────────────────────────────────────
  // Sever the guest's peer connection the way a dropped network would, and
  // confirm it climbs back on its own.
  const dropped = await guest.evaluate(() => {
    const pcs = window.__pcs || [];
    if (!pcs.length) return false;
    pcs.forEach((pc) => pc.close());
    return true;
  });
  check("test could sever the guest's peer connection", dropped);

  if (dropped) {
    await guest.waitForSelector("#conn.conn-warn", { timeout: 20000 });
    await guest.waitForSelector("#conn.conn-ok", { timeout: 60000 });
    check("guest reconnects after the data channel drops", true);
    await host.waitForFunction(() => document.querySelector("#guest-count").textContent === "1", null, { timeout: 30000 });
    check("host converges back to one guest after the reconnect", true);
  }

  // ── host reload keeps the room ───────────────────────────────────────────
  await host.reload();
  await host.waitForSelector("#view-room:not([hidden])", { timeout: 15000 });
  const codeAfter = (await host.textContent("#room-code")).trim();
  check("host keeps its room code across a reload", codeAfter === code, codeAfter + " vs " + code);
  await host.waitForFunction(() => document.querySelectorAll("#queue .row").length === 1, null, { timeout: 15000 });
  check("host restores its queue across a reload", true);

  await browser.close();
  site.close();
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
