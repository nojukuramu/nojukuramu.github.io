/* tools/room-e2e.js — who is allowed to run the room, and the turn rules.
 *
 * Everything in this file is about authority. The queue used to be the only
 * shared thing in a room and every control on it was open to anyone holding
 * the code; a room now also has a setup, a guest list, and the power to remove
 * someone from it, and none of that can be open to everyone.
 *
 * So the checks come in pairs: the host or a co-host can do the thing, and a
 * plain guest asking for the same thing over the wire is refused rather than
 * merely lacking a button. A UI that hides a control it does not enforce is
 * not a permission, it is a suggestion.
 *
 * Run: node tools/room-e2e.js
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
    { url: "/watch?v=aaaaaaaaaaa", type: "stream", title: "Anak (Karaoke Version)", uploaderName: "Freddie Aguilar", duration: 260 },
    { url: "/watch?v=bbbbbbbbbbb", type: "stream", title: "Harana Karaoke Version", uploaderName: "Parokya ni Edgar", duration: 232 },
    { url: "/watch?v=ccccccccccc", type: "stream", title: "Tadhana - Minus One", uploaderName: "Up Dharma Down", duration: 301 }
  ]
};

let failures = 0;
function check(name, ok, extra) {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (ok || extra === undefined ? "" : "  → " + extra));
  if (!ok) failures++;
}

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
    return;
  }
  await page.fill("#name-gate-input", name);
  await page.click("#name-gate-form button[type=submit]");
  await page.waitForSelector("#name-gate", { state: "hidden" });
}

/* Queue a song straight into the host's state under a chosen name, so a turn
 * order can be set up without driving three browsers through search. */
async function seed(host, entries) {
  await host.evaluate((rows) => {
    const KN = window.KN;
    const app = window.KN.app;
    rows.forEach(([id, title, by]) => {
      app.state.queue.push(KN.room.toSong({ id: id, title: title, duration: 100 }, by, by));
    });
  }, entries);
}

async function main() {
  const site = await serve();
  const sitePort = site.address().port;
  const { port: brokerPort } = await broker.start(0);
  const base = `http://127.0.0.1:${sitePort}/index.html`;

  const browser = await chromium.launch({
    args: ["--disable-features=WebRtcHideLocalIpsWithMdns", "--no-sandbox"]
  });

  async function newPage(width) {
    const ctx = await browser.newContext({ viewport: { width: width || 900, height: 800 } });
    await ctx.addInitScript(
      ([p]) => { window.KN_BROKERS = [{ host: "127.0.0.1", port: p, path: "/", key: "peerjs" }]; },
      [brokerPort]
    );
    await ctx.route(/pipedapi|piped\.|invidious|nadeko|yewtu|melmac/, (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(FAKE_RESULTS) })
    );
    await ctx.route(/youtube\.com|youtube-nocookie|ytimg\.com/, (r) => r.abort());
    const page = await ctx.newPage();
    page.on("pageerror", (e) => { console.log("  !! page error:", e.message); failures++; });
    return page;
  }

  const host = await newPage(1280);
  await host.goto(base + "#/host");
  await host.waitForSelector("#view-room:not([hidden])");
  const code = (await host.textContent("#room-code")).trim();

  /* ── the tabs each role gets ──────────────────────────────────────────── */
  check("the host gets the Setup tab", await host.locator(".tab[data-tab='config']").isVisible());
  check("the host gets the Singers tab", await host.locator(".tab[data-tab='singers']").isVisible());
  check("scoring is on, so the Scores tab is offered", await host.locator(".tab-scores").isVisible());
  check("the host can clear the queue", await host.locator("#clear-btn").isVisible());

  const alice = await newPage();
  await alice.goto(base + "#/r/" + code);
  await passNameGate(alice, "Alice");
  await alice.waitForSelector("#conn.conn-ok", { timeout: 30000 });

  const bob = await newPage();
  await bob.goto(base + "#/r/" + code);
  await passNameGate(bob, "Bob");
  await bob.waitForSelector("#conn.conn-ok", { timeout: 30000 });

  /* ── the door ─────────────────────────────────────────────────────────── */
  check("an arrival is held in the lobby, not in the room", await alice.locator("#lobby-wait").isVisible());
  const barred = await alice.evaluate(() => {
    // Straight down the wire, past whatever the UI is or is not showing.
    window.KN.app.net.send({ type: "ADD", video: { id: "zzzzzzzzzzz", title: "Gatecrash" } });
    return true;
  });
  await host.waitForTimeout(1200);
  check(
    "a command from the lobby is refused rather than applied",
    barred && (await host.evaluate(() => window.KN.app.state.queue.length)) === 0
  );
  await admit(host, "Alice");
  await admit(host, "Bob");

  await host.waitForFunction(() => document.querySelector("#guest-count").textContent === "2", null, { timeout: 20000 });
  check("host sees both guests once they are let in", true);

  check("a guest gets no Setup tab", !(await alice.locator(".tab[data-tab='config']").isVisible()));
  check("a guest cannot clear the queue", !(await alice.locator("#clear-btn").isVisible()));

  /* ── the guest list ───────────────────────────────────────────────────── */
  await host.click(".tab[data-tab='singers']");
  const names = await host.locator("#singers .row-title").allTextContents();
  check(
    "the singer list holds the host and both guests",
    names.length === 3 && names.some((n) => /Alice/.test(n)) && names.some((n) => /Bob/.test(n)),
    names.join(" | ")
  );
  const hostRow = host.locator("#singers .row").first();
  check("the host's own row offers no way to remove the host", (await hostRow.locator(".row-actions button").count()) === 0);

  /* ── a guest asking for authority it does not have ────────────────────── */
  await alice.evaluate(() => {
    window.KN.app.net.send({ type: "CONFIG", config: { scoring: false, leaderboard: false, maxRun: true }, rev: window.KN.app.state.rev });
  });
  await host.waitForTimeout(800);
  const stillOn = await host.evaluate(() => window.KN.app.state.config.scoring);
  check("a plain guest cannot rewrite the room's setup over the wire", stillOn === true);

  await alice.evaluate(() => {
    const ids = window.KN.app.state.guests.map((g) => g.id);
    window.KN.app.net.send({ type: "KICK", id: ids[ids.length - 1], rev: window.KN.app.state.rev });
  });
  await host.waitForTimeout(800);
  const guestsLeft = await host.evaluate(() => window.KN.app.state.guests.length);
  check("a plain guest cannot remove anybody", guestsLeft === 2, String(guestsLeft));

  /* ── promoting a co-host ──────────────────────────────────────────────── */
  const aliceRow = host.locator("#singers .row").filter({ hasText: "Alice" }).first();
  await aliceRow.locator('button[title="Make co-host"]').click();
  await alice.waitForFunction(() => document.body.classList.contains("can-manage"), null, { timeout: 15000 });
  check("a co-host is told it can run the room", true);
  check("and gets the Setup tab", await alice.locator(".tab[data-tab='config']").isVisible());
  check("and the clear-queue button", await alice.locator("#clear-btn").isVisible());

  /* A co-host running the room is the point; a co-host minting more co-hosts
   * would leave the room with no owner, so that one stays with the host. */
  await alice.click(".tab[data-tab='singers']");
  const bobRowForAlice = alice.locator("#singers .row").filter({ hasText: "Bob" }).first();
  check(
    "a co-host cannot appoint another co-host",
    (await bobRowForAlice.locator('button[title="Make co-host"]').count()) === 0
  );
  check("but can remove a guest", (await bobRowForAlice.locator('button[title="Remove from the room"]').count()) === 1);

  /* ── a co-host changing the setup ─────────────────────────────────────── */
  await alice.click(".tab[data-tab='config']");
  await alice.uncheck("#cfg-leaderboard");
  await host.waitForFunction(() => window.KN.app.state.config.leaderboard === false, null, { timeout: 15000 });
  check("a co-host's setup change reaches the host", true);
  await bob.waitForFunction(() => !document.querySelector(".tab-scores").offsetParent, null, { timeout: 15000 });
  check("turning the leaderboard off withdraws the Scores tab everywhere", true);

  await alice.check("#cfg-leaderboard");
  await host.waitForFunction(() => window.KN.app.state.config.leaderboard === true, null, { timeout: 15000 });

  /* ── two in a row, and no more ────────────────────────────────────────── */
  await seed(host, [
    ["aaaaaaaaaaa", "Anak", "Alice"],
    ["bbbbbbbbbbb", "Harana", "Alice"],
    ["ccccccccccc", "Tadhana", "Alice"],
    ["ddddddddddd", "Kisapmata", "Bob"]
  ]);
  await host.evaluate(() => window.KN.refresh());

  await host.click(".tab[data-tab='config']");
  await host.check("#cfg-maxrun");
  await host.waitForTimeout(600);

  const order = await host.evaluate(() => window.KN.app.state.queue.map((s) => s.addedBy));
  check(
    "turning the cap on rearranges the queue that is already there",
    order.join(",") === "Alice,Alice,Bob,Alice",
    order.join(",")
  );

  /* A third song from the same singer, added while the cap is on, lands after
   * whoever else is waiting rather than in front of them. */
  await host.evaluate(() => {
    const KN = window.KN;
    window.KN.app.state.queue.push(KN.room.toSong({ id: "eeeeeeeeeee", title: "Migraine", duration: 90 }, "Alice", "Alice"));
    KN.room.rebalance(window.KN.app.state);
  });
  const order2 = await host.evaluate(() => window.KN.app.state.queue.map((s) => s.addedBy));
  check("nobody holds the microphone for a third song", !/Alice,Alice,Alice/.test(order2.join(",")), order2.join(","));

  await host.uncheck("#cfg-maxrun");
  await host.waitForTimeout(400);

  /* ── removing somebody ────────────────────────────────────────────────── */
  await host.click(".tab[data-tab='singers']");
  host.once("dialog", (d) => d.accept());
  const bobRow = host.locator("#singers .row").filter({ hasText: "Bob" }).first();
  await bobRow.locator('button[title="Remove from the room"]').click();

  await bob.waitForSelector("#view-home:not([hidden])", { timeout: 20000 });
  check("a removed guest is put back on the home screen", true);

  await host.waitForFunction(() => window.KN.app.state.guests.length === 1, null, { timeout: 20000 });
  check("and is gone from the host's guest list", true);

  /* The removal has to survive the guest's own reconnect loop, which is
   * already dialling by the time the channel closes. */
  await host.waitForTimeout(6000);
  const cameBack = await host.evaluate(() => window.KN.app.state.guests.length);
  check("and does not walk straight back in", cameBack === 1, String(cameBack));

  /* ── the 10pm rule ─────────────────────────────────────────────────────
   * Waiting for ten o'clock is not a test, so the clock is the thing that
   * moves: the page is told it is 10pm and then asked to prove it does the
   * whole thing exactly once, however many times it looks at the clock. */
  const lateCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await lateCtx.addInitScript(
    ([p]) => {
      window.KN_BROKERS = [{ host: "127.0.0.1", port: p, path: "/", key: "peerjs" }];
      Date.prototype.getHours = function () { return 22; };
    },
    [brokerPort]
  );
  await lateCtx.route(/youtube\.com|ytimg\.com/, (r) => r.abort());
  const late = await lateCtx.newPage();
  await late.goto(base + "#/host");
  await late.waitForSelector("#view-room:not([hidden])");

  await late.waitForSelector("#curfew:not([hidden])", { timeout: 15000 });
  const curfewText = await late.textContent("#curfew-text");
  check(
    "10pm puts the warning across the stage",
    /10:00PM/.test(curfewText) && /NEIGHBORS/.test(curfewText) && /50%/.test(curfewText),
    curfewText
  );

  /* The volume is walked down rather than snapped, so that it reads as the
   * room easing off rather than as something breaking. */
  await late.waitForFunction(() => window.KN.app.state.player.volume === 50, null, { timeout: 15000 });
  check("and eases the volume down to half", true);

  /* Turning it back up has to stick. The message is a nudge, and a nudge that
   * fights you is just a broken volume knob. */
  await late.evaluate(() => {
    const v = document.getElementById("vol");
    v.value = "90";
    v.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await late.waitForTimeout(2500);
  const back = await late.evaluate(() => window.KN.app.state.player.volume);
  check("and does not fight the host who turns it back up", back === 90, String(back));

  // Same evening, same browser: it has already had its say.
  await late.reload();
  await late.waitForSelector("#view-room:not([hidden])");
  await late.waitForTimeout(2500);
  check("it happens once a night, not on every reload", await late.locator("#curfew").isHidden());

  await browser.close();
  site.close();
  console.log(failures ? "\n" + failures + " failure(s)" : "\nall room checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
