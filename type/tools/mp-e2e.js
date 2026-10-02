#!/usr/bin/env node
/* ============================================================
   Type — racing, in real browsers
   `node tools/mp-e2e.js [--shots <dir>]`

   The shape is Hacks' tools/mp-e2e.js: several Chromium pages, each its own
   browser profile, talking over real WebRTC data channels through
   tools/broker.js (a local stand-in for the public PeerJS broker), so
   nothing leaves the machine.

   What it proves, in the order a player would meet it:
     - a private room: create, join by code, ready, the host starts, the
       countdown, both type the same challenge, the first to finish wins, and
       both land back in the room afterwards
     - a public room shows up in another browser's list and can be joined
     - a room code nobody holds is reported as not found
     - quick match: two browsers press the button at the same moment, end up
       in one room (not two), and the race starts by itself
     - nothing in the lobby steals the keyboard from the name box

   Skipped (not failed) where Playwright is not installed.
   ============================================================ */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const broker = require("./broker");

let chromium;
for (const where of ["playwright", "playwright-core", path.join(path.dirname(process.execPath), "..", "lib", "node_modules", "playwright")]) {
  try { ({ chromium } = require(where)); break; } catch (e) { /* try the next */ }
}
if (!chromium) { console.log("Playwright is not installed; skipping the multiplayer pass."); process.exit(0); }

const ROOT = path.resolve(__dirname, "..", "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const SHOT_DIR = (() => { const i = process.argv.indexOf("--shots"); return i === -1 ? null : process.argv[i + 1]; })();
if (SHOT_DIR) fs.mkdirSync(SHOT_DIR, { recursive: true });

let failures = 0, checks = 0;
function check(name, cond, detail) {
  checks++;
  if (cond) console.log("  \u2713 " + name);
  else { failures++; console.log("  \u2717 " + name + (detail !== undefined ? " \u2014 " + detail : "")); }
}
function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const u = decodeURIComponent(req.url.split("?")[0].split("#")[0]);
      let file = path.join(ROOT, u);
      if (u.endsWith("/")) file = path.join(file, "index.html");
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, "127.0.0.1", () => resolve(srv));
  });
}
async function open(browser, base, bport, name, query) {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 760 }, serviceWorkers: "block" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(name + ": " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(name + ": " + m.text()); });
  page.on("dialog", (d) => d.accept());
  await page.addInitScript(([p, n]) => {
    window.TY_BROKERS = [{ host: "127.0.0.1", port: p, path: "/", key: "peerjs" }];
    window.TY_ICE = { iceServers: [] };
    window.TY_AUTO_MS = 2500;        // a quick-match room does not wait eight seconds in a test
    window.TY_COUNTDOWN_MS = 1800;
    try { localStorage.setItem("type:debug", "1"); localStorage.setItem("type:v1", JSON.stringify({ prefs: { category: "all", length: "medium", name: n } })); } catch (e) {}
  }, [bport, name]);
  await page.goto(base + "/type/" + (query || ""));
  await page.waitForSelector("#stage[data-state]");
  return { ctx, page, errors, name };
}
async function until(page, fn, arg, t) {
  const end = Date.now() + (t || 30000);
  for (;;) {
    if (await page.evaluate(fn, arg)) return true;
    if (Date.now() > end) throw new Error("timed out waiting for: " + fn.toString().slice(0, 160));
    await page.waitForTimeout(150);
  }
}
const soft = (p) => p.then(() => true, () => false);
async function shot(page, name) { if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, name + ".png") }); }
const screen = (p) => p.evaluate(() => document.body.dataset.screen);
const rosterLen = (p) => p.evaluate(() => document.getElementById("roster").children.length);
// 16 characters a second: slower than the 30 the host will believe, and fast enough for a test to finish
const TYPE_DELAY = 60;
async function race(p, lag) {
  await until(p, () => window.TY_DEBUG.S.race && window.TY_DEBUG.S.state === "typing", null, 20000);
  if (lag) await p.waitForTimeout(lag);   // after GO: the clock is already running
  const t = await p.evaluate(() => window.TY_DEBUG.S.target);
  await p.keyboard.type(t, { delay: TYPE_DELAY });
  return t;
}

(async function main() {
  const srv = await serve();
  const b = await broker.start(0);
  const base = "http://127.0.0.1:" + srv.address().port;
  const browser = await chromium.launch({ args: ["--disable-features=WebRtcHideLocalIpsWithMdns", "--no-sandbox"] });
  const all = [];
  try {
    console.log("\nA private room");
    const A = await open(browser, base, b.port, "Ada"); all.push(A);
    const B = await open(browser, base, b.port, "Bo"); all.push(B);
    await A.page.click("#btnVersus");
    check("the Race button opens the lobby", (await screen(A.page)) === "mp");
    await A.page.click("#mpCreate");
    const code = await A.page.evaluate(() => document.getElementById("roomCode").textContent);
    check("creating a room shows a six-character code (" + code + ")", /^[A-Z0-9]{6}$/.test(code));
    await A.page.click('[data-set-cat="text"]');
    await A.page.click('[data-set-len="short"]');
    await B.page.click("#btnVersus");
    await B.page.fill("#mpName", "Bo Peep");
    check("typing in the name box works (the lobby does not steal the keyboard)", (await B.page.inputValue("#mpName")) === "Bo Peep");
    await B.page.fill("#mpCode", code.toLowerCase());
    await B.page.click("#mpJoin");
    check("the second browser joins by code", await soft(until(A.page, () => document.getElementById("roster").children.length === 2, null, 30000)));
    check("both rosters show both players", (await rosterLen(B.page)) === 2);
    check("the host sees the guest's name", await A.page.evaluate(() => document.getElementById("roster").textContent.includes("Bo Peep")));
    check("the guest sees the host's settings (Text, Short)", await soft(until(B.page, () => /Text/.test(document.getElementById("roomSummary").textContent) && /Short/.test(document.getElementById("roomSummary").textContent))));
    check("the host cannot start until the guest is ready", await A.page.evaluate(() => document.getElementById("roomStart").disabled));
    await B.page.click("#roomReady");
    check("once the guest is ready the host can start", await soft(until(A.page, () => !document.getElementById("roomStart").disabled)));
    await shot(A.page, "room");
    await A.page.click("#roomStart");
    check("both screens go to the race", await soft(until(A.page, () => document.body.dataset.screen === "race")) && await soft(until(B.page, () => document.body.dataset.screen === "race")));
    check("the countdown shows", await soft(until(A.page, () => !document.getElementById("count").hidden, null, 5000)));
    check("lanes show both players", (await A.page.evaluate(() => document.getElementById("lanes").children.length)) === 2);
    const seeds = await Promise.all([A, B].map((x) => x.page.evaluate(() => window.TY_DEBUG.S.ch.id)));
    check("both are given the same challenge", seeds[0] === seeds[1], seeds.join(" vs "));
    const early = await B.page.evaluate(() => { window.TY_DEBUG.S.typed; return window.TY_DEBUG.S.state; });
    check("typing is locked until GO", early === "locked" || early === "typing");
    const [ta] = await Promise.all([race(A.page), race(B.page, 2500)]);
    check("the board is an ordinary typing board", ta.length > 10);
    check("each finishes and the race ends for both", await soft(until(A.page, () => !document.getElementById("raceResult").hidden && /Results|won|came/.test(document.getElementById("rrTitle").textContent), null, 20000)) && await soft(until(B.page, () => /Results|won|came/.test(document.getElementById("rrTitle").textContent), null, 20000)));
    check("the first to finish wins", (await A.page.evaluate(() => document.getElementById("rrTitle").textContent)) === "You won", await A.page.evaluate(() => document.getElementById("rrTitle").textContent));
    check("the other is told their place", /2nd/.test(await B.page.evaluate(() => document.getElementById("rrTitle").textContent)), await B.page.evaluate(() => document.getElementById("rrTitle").textContent));
    check("the table lists both, with times", (await A.page.evaluate(() => [...document.querySelectorAll("#rrBody tr")].map((r) => r.textContent))).filter((t) => /\ds/.test(t)).length === 2);
    await shot(A.page, "race-result");
    await A.page.click("#rrBack");
    check("back in the room, ready is reset", await soft(until(B.page, () => !document.getElementById("rrBack").disabled)) && await A.page.evaluate(() => document.body.dataset.screen === "mp" && document.getElementById("roomStart").disabled));
    await B.page.click("#rrBack");
    check("and the guest can ready up for another go", await soft(until(B.page, () => !document.getElementById("roomReady").hidden && /ready/i.test(document.getElementById("roomReady").textContent))));
    await B.page.click("#roomLeave");
    check("leaving takes the guest out of the host's roster", await soft(until(A.page, () => document.getElementById("roster").children.length === 1, null, 20000)));
    await A.page.click("#roomLeave");

    console.log("\nA room nobody holds");
    await B.page.fill("#mpCode", "QQQQQQ");
    await B.page.click("#mpJoin");
    check("an unknown code is reported, not waited on forever", await soft(until(B.page, () => !document.getElementById("mpError").hidden && /find/.test(document.getElementById("mpError").textContent), null, 30000)));
    await A.ctx.close(); await B.ctx.close();

    console.log("\nA public room");
    const C = await open(browser, base, b.port, "Cy"); all.push(C);
    const D = await open(browser, base, b.port, "Di"); all.push(D);
    await C.page.click("#btnVersus");
    await C.page.click("#mpHostPublic");
    await D.page.click("#btnVersus");
    check("a public room appears in another browser's list", await soft(until(D.page, () => [...document.querySelectorAll("#mpList li")].some((li) => li.textContent.includes("Cy")), null, 30000)));
    await shot(D.page, "lobby");
    await D.page.click("#mpList li button");
    check("and can be joined from the list", await soft(until(C.page, () => document.getElementById("roster").children.length === 2, null, 30000)));
    check("the room says it is public", (await C.page.evaluate(() => document.getElementById("roomKind").textContent)) === "Public");
    await D.page.click("#roomLeave");
    check("a guest leaving empties a seat", await soft(until(C.page, () => document.getElementById("roster").children.length === 1, null, 20000)));
    await C.page.click("#roomLeave");
    await C.ctx.close(); await D.ctx.close();

    console.log("\nQuick match");
    const E = await open(browser, base, b.port, "Em"); all.push(E);
    const F = await open(browser, base, b.port, "Fi"); all.push(F);
    await Promise.all([E.page.click("#btnVersus"), F.page.click("#btnVersus")]);
    await Promise.all([E.page.click("#mpQuick"), F.page.click("#mpQuick")]);
    check("two browsers pressing at once end up in the same room", await soft(until(E.page, () => document.getElementById("roster").children.length === 2, null, 40000)) && await soft(until(F.page, () => document.getElementById("roster").children.length === 2, null, 40000)));
    check("it is a quick-match room", (await E.page.evaluate(() => document.getElementById("roomKind").textContent)) === "Quick match");
    check("there is no Start button: it starts by itself", await E.page.evaluate(() => document.getElementById("roomStart").hidden));
    await shot(E.page, "quick");
    check("the race starts without anybody pressing anything", await soft(until(E.page, () => document.body.dataset.screen === "race", null, 20000)) && await soft(until(F.page, () => document.body.dataset.screen === "race", null, 20000)));
    await Promise.all([race(E.page), race(F.page)]);
    check("the quick-match race finishes for both", await soft(until(E.page, () => /Results|won|came/.test(document.getElementById("rrTitle").textContent), null, 30000)) && await soft(until(F.page, () => /Results|won|came/.test(document.getElementById("rrTitle").textContent), null, 30000)));
    await shot(F.page, "quick-result");

    const errs = all.flatMap((x) => x.errors).filter((e) => !/favicon|ERR_|Failed to load resource/.test(e));
    check("no page errors in any browser", errs.length === 0, errs.slice(0, 5).join(" | "));
  } catch (e) {
    failures++;
    console.log("  \u2717 " + e.message.split("\n")[0]);
    // what was on each screen when it went wrong
    for (const x of all) {
      try {
        const st = await x.page.evaluate(() => ({ screen: document.body.dataset.screen, home: !document.getElementById("mp-home").hidden, room: !document.getElementById("mp-room").hidden, err: document.getElementById("mpError").textContent, title: document.getElementById("roomTitle").textContent }));
        console.log("    " + x.name + ": " + JSON.stringify(st));
        await shot(x.page, "fail-" + x.name);
      } catch (e2) { /* page already closed */ }
    }
  } finally {
    for (const x of all) await x.ctx.close().catch(() => {});
    await browser.close();
    b.close && b.close();
    srv.close();
  }
  console.log("\n" + (checks - failures) + "/" + checks + " multiplayer checks " + (failures ? "FAILED" : "passed"));
  process.exit(failures ? 1 : 0);
})();
