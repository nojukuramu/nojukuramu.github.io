/* tools/library-e2e.js — the library, playlists, and the search bias.
 *
 * Covers the parts that have nothing to do with a room: saving songs while
 * searching, building playlists, having all of it survive a reload, and
 * exporting/importing it. Then joins a room to check the one direction the
 * two are allowed to interact — queueing out of the library into the room.
 *
 * Also asserts the karaoke bias reaches the wire but never the input box.
 *
 * Run: node tools/library-e2e.js
 */
"use strict";

const http = require("http");
const fs = require("fs");
const os = require("os");
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
    { url: "/watch?v=aaaaaaaaaaa", type: "stream", title: "Anak (Karaoke Version)", uploaderName: "Freddie Aguilar", duration: 260 },
    { url: "/watch?v=bbbbbbbbbbb", type: "stream", title: "Harana Karaoke Version", uploaderName: "Parokya ni Edgar", duration: 232 },
    { url: "/watch?v=ccccccccccc", type: "stream", title: "Tadhana - Minus One", uploaderName: "Up Dharma Down", duration: 301 }
  ]
};

/* A newly created playlist opens itself, a reloaded one does not — so assert
 * on the state rather than assuming a click toggles the way you want. */
async function ensureOpen(page) {
  const toggle = page.locator(".pl-toggle").first();
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await page.waitForSelector(".pl-songs", { timeout: 10000 });
}

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

  const browser = await chromium.launch({ args: ["--disable-features=WebRtcHideLocalIpsWithMdns", "--no-sandbox"] });
  const searched = [];

  // One context throughout: localStorage has to persist across reloads for
  // the library to mean anything.
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 420, height: 900 } });
  await ctx.addInitScript(
    ([p]) => { window.KN_BROKERS = [{ host: "127.0.0.1", port: p, path: "/", key: "peerjs" }]; },
    [brokerPort]
  );
  await ctx.route(/pipedapi|piped\.|invidious|nadeko|yewtu|melmac/, (route) => {
    searched.push(route.request().url());
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(FAKE_RESULTS) });
  });
  await ctx.route(/youtube\.com|youtube-nocookie|ytimg\.com/, (route) => route.abort());

  const page = await ctx.newPage();
  page.on("pageerror", (e) => { console.log("  !! page error:", e.message); failures++; });

  /* ── library works with no room at all ─────────────────────────────────── */
  await page.goto(base + "#/library");
  await page.waitForSelector("#view-library:not([hidden])");
  check("library opens without a room", true);

  await page.fill("#q", "anak");
  await page.click("#search-form button[type=submit]");
  await page.waitForSelector("#results .row", { timeout: 15000 });
  check("search works outside a room", (await page.locator("#results .row").count()) === 3);

  const noQueueButton = (await page.locator("#results .add-btn").count()) === 0;
  check("no add-to-queue button when there is no room", noQueueButton);

  /* ── the karaoke bias ──────────────────────────────────────────────────── */
  /* The *first* query, not the last: a thin list is now topped up by asking
   * again in different words, so the later rounds deliberately say something
   * else. The first one is the one the bias is about. */
  const sent = decodeURIComponent(searched[0] || "");
  check("query sent to the mirror is biased to karaoke", /anak karaoke/i.test(sent), sent.slice(0, 120));
  const laterRounds = searched.slice(1).map((u) => decodeURIComponent(u));
  check(
    "a short list is asked for again in different words",
    laterRounds.length > 0 && laterRounds.every((u) => u !== sent),
    JSON.stringify(laterRounds.map((u) => u.split("q=")[1] || "").slice(0, 3))
  );
  const shown = await page.inputValue("#q");
  check("the bias never appears in the search box", shown === "anak", JSON.stringify(shown));

  const alreadyKaraoke = await page.evaluate(() => window.KN.search.biasToKaraoke("anak karaoke"));
  check("a query that already says karaoke is left alone", alreadyKaraoke === "anak karaoke", alreadyKaraoke);

  /* ── saving songs ──────────────────────────────────────────────────────── */
  await page.locator("#results .row").nth(0).locator(".star").click();
  await page.locator("#results .row").nth(1).locator(".star").click();
  await page.waitForFunction(() => document.querySelector("#lib-song-count").textContent === "2", null, { timeout: 10000 });
  check("saving a search result puts it in the library", true);

  const starOn = await page.locator("#results .row").nth(0).locator(".star").getAttribute("class");
  check("a saved result shows as saved", /\bon\b/.test(starOn), starOn);

  // Toggling off again removes it.
  await page.locator("#results .row").nth(1).locator(".star").click();
  await page.waitForFunction(() => document.querySelector("#lib-song-count").textContent === "1", null, { timeout: 10000 });
  check("tapping a saved result again removes it", true);

  /* ── playlists ─────────────────────────────────────────────────────────── */
  await page.click('.lib-tab[data-libtab="playlists"]');
  await page.fill("#new-playlist-name", "Videoke Night");
  await page.click("#new-playlist-form button[type=submit]");
  await page.waitForFunction(() => document.querySelector("#lib-list-count").textContent === "1", null, { timeout: 10000 });
  check("a playlist can be created", true);

  // Add two songs to it through the picker.
  await page.locator("#results .row").nth(1).locator('button[title="Add to a playlist"]').click();
  await page.waitForSelector("#picker:not([hidden])");
  await page.locator(".picker-item").first().click();
  await page.waitForSelector("#picker", { state: "hidden" });

  await page.locator("#results .row").nth(2).locator('button[title="Add to a playlist"]').click();
  await page.waitForSelector("#picker:not([hidden])");
  await page.locator(".picker-item").first().click();
  await page.waitForSelector("#picker", { state: "hidden" });

  const plCount = await page.textContent(".pl-count");
  check("songs land in the playlist", plCount.trim() === "2 songs", plCount);

  // Adding the same song twice is refused rather than duplicated.
  await page.locator("#results .row").nth(1).locator('button[title="Add to a playlist"]').click();
  await page.waitForSelector("#picker:not([hidden])");
  const disabled = await page.locator(".picker-item").first().isDisabled();
  check("a song already in the playlist cannot be added twice", disabled);
  await page.click("#picker-close");

  /* ── reordering and persistence ────────────────────────────────────────── */
  await ensureOpen(page);
  const before = await page.locator(".pl-songs .row-title").allTextContents();
  await page.locator(".pl-songs .row").last().locator('button[title="Move up"]').click();
  const after = await page.locator(".pl-songs .row-title").allTextContents();
  check("playlist songs can be reordered", before[0] !== after[0], before + " → " + after);

  await page.reload();
  await page.waitForSelector("#view-library:not([hidden])");
  await page.click('.lib-tab[data-libtab="playlists"]');
  const listCount = await page.textContent("#lib-list-count");
  const songCount = await page.textContent("#lib-song-count");
  check("library survives a reload", listCount === "1" && songCount === "1", "lists=" + listCount + " songs=" + songCount);
  await ensureOpen(page);
  const afterReload = await page.locator(".pl-songs .row-title").allTextContents();
  check("the reordering survived too", JSON.stringify(afterReload) === JSON.stringify(after), afterReload.join(","));

  /* ── export / import ───────────────────────────────────────────────────── */
  const dl = await Promise.all([page.waitForEvent("download"), page.click("#lib-export")]).then((r) => r[0]);
  const file = path.join(os.tmpdir(), "kn-library-test.json");
  await dl.saveAs(file);
  const exported = JSON.parse(fs.readFileSync(file, "utf8"));
  check(
    "export contains the saved songs and playlists",
    exported.songs.length === 1 && exported.playlists.length === 1 && exported.playlists[0].songs.length === 2,
    JSON.stringify({ s: exported.songs.length, p: exported.playlists.length })
  );

  /* Re-importing the file you just exported is the common case, and it is
   * ambiguous: the answer might be "I already have this" or "yes, again". So
   * the import stops and asks rather than picking one silently. */
  await page.setInputFiles("#lib-import-file", file);
  await page.waitForSelector("#dupes:not([hidden])", { timeout: 10000 });
  check("a colliding import asks before it writes anything", true);
  const dupeText = await page.textContent("#dupes-body");
  check("the question names what already exists", /1 song/.test(dupeText) && /1 playlist/.test(dupeText), dupeText);

  await page.click("#dupes-skip");
  await page.waitForTimeout(400);
  const afterSkip = await page.textContent("#lib-list-count");
  check("skipping the duplicates leaves the library alone", afterSkip === "1", afterSkip);

  await page.setInputFiles("#lib-import-file", file);
  await page.waitForSelector("#dupes:not([hidden])", { timeout: 10000 });
  await page.click("#dupes-again");
  await page.waitForFunction(() => document.querySelector("#lib-list-count").textContent === "2", null, { timeout: 10000 });
  check("importing again merges rather than replaces", true);
  const names = await page.locator(".pl-toggle").allTextContents();
  check("an imported playlist with a clashing name is marked", names.some((n) => /imported/.test(n)), names.join(" | "));

  /* Sharing is a between-parties thing; in a room the useful gesture is
   * queueing a song, so the button is not there. */
  check("the share button is offered outside a room", await page.locator("#lib-share").isVisible());

  /* ── sharing over QR ───────────────────────────────────────────────────
   * The camera half of this cannot be driven from here, but the part that can
   * actually lose data can: split the library into codes, hand the pieces back
   * in the wrong order (which is how they really arrive), and see the same
   * library come out. Each part is also encoded for real, because a chunk that
   * does not fit in a QR is a share that fails on the last code. */
  const trip = await page.evaluate(() => {
    const L = window.KN.library;
    const parts = L.shareParts(window.QR.capacity("L") - 16);
    const encodable = parts.every((p) => {
      try { window.QR.encode(p, { ecc: "L" }); return true; } catch (e) { return false; }
    });
    const shuffled = parts.slice().reverse();
    const seen = {};
    let count = 0;
    shuffled.forEach((raw) => {
      const part = L.readPart(raw);
      if (!part) return;
      count = part.count;
      seen[part.index] = part.chunk;
    });
    const ordered = [];
    for (let i = 1; i <= count; i++) ordered.push(seen[i]);
    return { parts: parts.length, encodable, json: L.joinParts(ordered), junk: L.readPart("not a library") };
  });
  check("a library splits into at least one code", trip.parts >= 1, String(trip.parts));
  check("every part actually fits in a QR code", trip.encodable);
  check("anything that is not one of our codes is ignored", trip.junk === null);

  const rebuilt = JSON.parse(trip.json);
  check(
    "codes scanned out of order rebuild the same library",
    rebuilt.songs.length === 1 && rebuilt.playlists.length === 2 && rebuilt.playlists[0].songs.length === 2,
    JSON.stringify({ s: rebuilt.songs.length, p: rebuilt.playlists.length })
  );
  /* A song that only ever lived in a playlist has to cross with it, but it
   * must not arrive on the other side as a saved song — sharing a library
   * should hand over the same library, not a rearranged one. */
  check(
    "a playlist-only song does not come back as a saved song",
    !rebuilt.songs.some((x) => !rebuilt.songs.slice(0, 1).includes(x)) && rebuilt.songs.length === 1,
    JSON.stringify(rebuilt.songs.map((x) => x.title))
  );
  check(
    "and the songs come back with their titles, not just their ids",
    rebuilt.playlists[0].songs.every((x) => x.title && x.id),
    JSON.stringify(rebuilt.playlists[0].songs.map((x) => x.title))
  );

  /* ── into a room ───────────────────────────────────────────────────────── */
  const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await hostCtx.addInitScript(
    ([p]) => { window.KN_BROKERS = [{ host: "127.0.0.1", port: p, path: "/", key: "peerjs" }]; },
    [brokerPort]
  );
  await hostCtx.route(/pipedapi|piped\.|invidious|nadeko|yewtu|melmac/, (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(FAKE_RESULTS) })
  );
  await hostCtx.route(/youtube\.com|youtube-nocookie|ytimg\.com/, (r) => r.abort());
  const host = await hostCtx.newPage();
  await host.goto(base + "#/host");
  await host.waitForSelector("#view-room:not([hidden])");
  const code = (await host.textContent("#room-code")).trim();

  // The rail keeps the code scannable beside the video on a wide screen.
  const railVisible = await host.locator("#invite-rail").isVisible();
  check("wide host screen shows the invite rail", railVisible);
  const railCode = (await host.textContent("#room-code-3")).trim();
  check("the rail names the room code for screen readers", railCode === code, railCode);
  // …but not in ink: the header already shows it, a hand's width away.
  const railCodeShown = await host.evaluate(
    () => document.getElementById("room-code-3").getBoundingClientRect().width > 4
  );
  check("the rail does not print a second copy of the code", !railCodeShown);
  await host.click("#rail-toggle");
  const collapsed = await host.locator("#invite-rail.collapsed").count();
  check("the invite rail collapses", collapsed === 1);

  await page.goto(base + "#/r/" + code);
  await passNameGate(page, "Librarian");
  await page.waitForSelector("#conn.conn-ok", { timeout: 30000 });
  await admit(host, "Librarian");
  await page.waitForSelector("#lobby-wait", { state: "hidden", timeout: 20000 });
  await page.click('.tab[data-tab="library"]');
  await page.waitForSelector("#library-root:not([hidden])");
  check("library is reachable from inside a room", true);
  check("the share button is withdrawn inside a room", !(await page.locator("#lib-share").isVisible()));

  await page.click('.lib-tab[data-libtab="playlists"]');
  await page.locator('.pl-actions button[title="Queue this playlist"]').first().click();
  await host.waitForFunction(
    () => document.querySelectorAll("#queue .row").length + (document.querySelector("#now .now-title") ? 1 : 0) === 2,
    null,
    { timeout: 20000 }
  );
  check("queueing a playlist sends every song to the room", true);

  await browser.close();
  site.close();
  try { fs.unlinkSync(file); } catch (e) { /* already gone */ }
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
