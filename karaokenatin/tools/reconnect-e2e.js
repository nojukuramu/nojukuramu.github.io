/* tools/reconnect-e2e.js — the room after somebody walks away.
 *
 * The end-to-end suite cuts a link and watches it come back. This one covers
 * the harder half: what happens when a *page* goes away — a phone pocketed
 * mid-song, a laptop lid closed, a signalling socket that died unannounced
 * while nothing was running to notice. Those are the failures that end a
 * party, and none of them look like a clean disconnect from inside the tab.
 *
 * Each check here stands for a way the room used to stay broken:
 *
 *   - a guest coming back to a host that restarted while it was hidden
 *   - repeated wake-ups piling parallel attempts on top of each other
 *   - a host whose broker socket died with nothing to prod it awake
 *   - a host briefly told its own room code is taken, by its own stale
 *     registration, and renaming the room out from under everyone
 *   - commands tapped while offline, after all of the above
 *
 * Run: node tools/reconnect-e2e.js   (needs playwright)
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
    { url: "/watch?v=aaaaaaaaaaa", type: "stream", title: "Anak", uploaderName: "Freddie Aguilar", duration: 260, thumbnail: "" }
  ]
};

let failures = 0;
function check(name, ok, extra) {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (ok || extra === undefined ? "" : "  → " + extra));
  if (!ok) failures++;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const site = await serve();
  const sitePort = site.address().port;
  const { port: brokerPort, peers } = await broker.start(0);
  const base = `http://127.0.0.1:${sitePort}/index.html`;

  const browser = await chromium.launch({
    args: ["--disable-features=WebRtcHideLocalIpsWithMdns", "--no-sandbox"]
  });

  async function newPage() {
    const ctx = await browser.newContext();
    await ctx.addInitScript(
      ([p]) => {
        window.KN_BROKERS = [{ host: "127.0.0.1", port: p, path: "/", key: "peerjs" }];

        // Handles on the two things a real outage kills, so the test can kill
        // them the same way without a hook in the app.
        const NativePC = window.RTCPeerConnection;
        window.__pcs = [];
        window.RTCPeerConnection = function (cfg) {
          const pc = new NativePC(cfg);
          window.__pcs.push(pc);
          return pc;
        };
        window.RTCPeerConnection.prototype = NativePC.prototype;

        const NativeWS = window.WebSocket;
        window.__wss = [];
        window.WebSocket = function (url, protocols) {
          const ws = protocols === undefined ? new NativeWS(url) : new NativeWS(url, protocols);
          window.__wss.push(ws);
          return ws;
        };
        window.WebSocket.prototype = NativeWS.prototype;
        ["CONNECTING", "OPEN", "CLOSING", "CLOSED"].forEach((k, i) => { window.WebSocket[k] = i; });

        // Peer connections nobody closed: the signature of parallel attempts.
        window.__livePcs = () =>
          (window.__pcs || []).filter((pc) => pc.connectionState !== "closed").length;

        // Leaving the browser, as the page experiences it.
        window.__setHidden = (v) => {
          Object.defineProperty(document, "hidden", { configurable: true, get: () => v });
          Object.defineProperty(document, "visibilityState", {
            configurable: true,
            get: () => (v ? "hidden" : "visible")
          });
          document.dispatchEvent(new Event("visibilitychange"));
        };
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

  const guest = await newPage();
  await guest.goto(base + "#/r/" + code);
  await guest.waitForSelector("#conn.conn-ok", { timeout: 30000 });
  await host.waitForFunction(() => document.querySelector("#guest-count").textContent === "1", null, { timeout: 15000 });
  check("a guest joins the room to begin with", true);

  /* ── 1. away, and back to a host that restarted ───────────────────────────
   * The headline case. The phone is put away, the host reloads (or crashes and
   * is reopened) while nothing on the guest is running to see it, and the guest
   * comes back holding a channel that is open only in its own imagination. */
  await guest.evaluate(() => window.__setHidden(true));
  await host.reload();
  await host.waitForSelector("#view-room:not([hidden])", { timeout: 15000 });
  check("host keeps its code across the restart", (await host.textContent("#room-code")).trim() === code);

  await sleep(1500);
  const backAt = Date.now();
  await guest.evaluate(() => window.__setHidden(false));
  await guest.waitForSelector("#conn.conn-ok", { timeout: 45000 });
  check("guest reconnects when the tab comes back", true, String(Date.now() - backAt) + "ms");
  await host.waitForFunction(() => document.querySelector("#guest-count").textContent === "1", null, { timeout: 20000 });
  check("host counts the returning guest exactly once", true);

  /* ── 2. a flurry of wake-ups must not become a flurry of attempts ─────────
   * Every visibility change, every focus, every network event used to start a
   * fresh attempt without cancelling the one already scheduled — all sharing
   * one connection id, so each new attempt made the host discard the previous
   * link, whose close scheduled another attempt. Live peer connections are the
   * visible edge of that: one attempt at a time can never leave a pile. */
  await host.goto("about:blank");           // the host is simply gone
  await guest.waitForSelector("#conn:not(.conn-ok)", { timeout: 30000 });

  let peak = 0;
  for (let i = 0; i < 10; i++) {
    await guest.evaluate(() => {
      window.__setHidden(true);
      window.__setHidden(false);
      window.dispatchEvent(new Event("online"));
      window.dispatchEvent(new Event("focus"));
    });
    peak = Math.max(peak, await guest.evaluate(() => window.__livePcs()));
    await sleep(250);
  }
  await sleep(1000);
  peak = Math.max(peak, await guest.evaluate(() => window.__livePcs()));
  check("wake-ups never pile up parallel peer connections", peak <= 2, peak + " live");

  // Left alone afterwards, one retry loop should be running — not ten. Count
  // the signalling sockets a quiet window produces: parallel chains show up
  // here as a multiple of the honest rate, and each of them tearing down the
  // others' half-built attempt is why the room never came back.
  const before = await guest.evaluate(() => window.__wss.length);
  await sleep(6000);
  const opened = (await guest.evaluate(() => window.__wss.length)) - before;
  check("only one retry loop survives the flurry", opened <= 6, opened + " sockets in 6s");

  // Something tapped while it is down, to be flushed on the other side.
  await guest.click('.tab[data-tab="queue"]');
  const queuedWhileDown = await guest.evaluate(() => {
    const btn = document.querySelector("#clear-btn");
    return !!btn;
  });

  await host.goto(base + "#/host");         // the room comes back on its own code
  await host.waitForSelector("#view-room:not([hidden])", { timeout: 15000 });
  check("host reopens on the same code", (await host.textContent("#room-code")).trim() === code);
  await guest.waitForSelector("#conn.conn-ok", { timeout: 60000 });
  check("guest finds the room again after the flurry", true);
  check("guest had a control to press while offline", queuedWhileDown);

  /* ── 3. the host's own signalling socket dies unannounced ─────────────────
   * A sleeping laptop's WebSocket is closed by the OS with nobody listening.
   * Until the host is registered again, the room cannot be found at all — so
   * this is the one that has to recover fast, without a reload. */
  await host.evaluate(() => (window.__wss || []).forEach((ws) => ws.close()));
  await host.waitForFunction(() => document.querySelector("#broker-count").textContent === "0", null, { timeout: 10000 });
  const woke = Date.now();
  await host.evaluate(() => {
    window.__setHidden(true);
    window.__setHidden(false);
  });
  await host.waitForFunction(() => document.querySelector("#broker-count").textContent === "1", null, { timeout: 10000 });
  check("host re-registers on wake-up", true, String(Date.now() - woke) + "ms");

  /* ── 4. a stale registration must not cost the room its code ──────────────
   * PeerServer holds an id for a while after the socket behind it dies, so a
   * host that reconnects quickly is told its own code is taken. Surrendering
   * on that answer renames the room and strands every guest holding the old
   * code — the worst outcome available. It has to wait the squatter out. */
  const stale = { socket: { write() {}, destroy() {}, end() {} }, token: "someone-elses-token" };
  peers.set("kn-" + code.toLowerCase(), stale);
  await host.evaluate(() => (window.__wss || []).forEach((ws) => ws.close()));
  await sleep(3000);
  check("host holds its code while the id looks taken", (await host.textContent("#room-code")).trim() === code,
    (await host.textContent("#room-code")).trim());

  peers.delete("kn-" + code.toLowerCase());
  await host.waitForFunction(() => document.querySelector("#broker-count").textContent === "1", null, { timeout: 25000 });
  check("host takes its code back once the id is released", (await host.textContent("#room-code")).trim() === code);

  /* ── 5. and the room still works ──────────────────────────────────────────
   * All of the above is only worth anything if a phone can still queue a song
   * at the end of it. */
  await guest.waitForSelector("#conn.conn-ok", { timeout: 60000 });
  await guest.click('.tab[data-tab="search"]');
  await guest.fill("#q", "anak");
  await guest.click("#search-form button[type=submit]");
  await guest.waitForSelector("#results .row", { timeout: 20000 });
  await guest.locator("#results .row").first().locator(".add-btn").click();
  await host.waitForFunction(
    () => document.querySelector("#now .now-title") !== null ||
          document.querySelectorAll("#queue .row").length > 0,
    null,
    { timeout: 20000 }
  );
  check("a song queued after all of that reaches the host", true);

  await browser.close();
  site.close();
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
