/* e2e.js — four real browsers, one real room, a whole game played over WebRTC.
 *
 * The headless suite in engine-test.js proves the rules by calling the engine
 * directly. This proves the app: that the page boots clean, that guests find
 * the host and get through the door, that a night played on four separate
 * phones resolves in the order the taps actually arrived, and — the thing the
 * whole redesign exists for — that a Bodyguard who picks a door after the pack
 * has already been there is told he found a body.
 *
 * The public brokers are never touched. tools/broker.js is a ~120-line local
 * stand-in for the PeerJS signalling protocol and the pages are pointed at it
 * with window.WG_BROKERS, so this runs with no egress and no dependency on
 * anybody else's uptime. The WebRTC link itself is real.
 *
 * Run: node tools/e2e.js
 */
"use strict";
var { chromium } = require("/opt/node22/lib/node_modules/playwright");
var http = require("http");
var fs = require("fs");
var path = require("path");
var broker = require("./broker.js");

var ROOT = path.join(__dirname, "..");
var PORT = 8911, BROKER_PORT = 8912;
var pass = 0, fail = 0, errors = [];

function ok(l, c, x) { if (c) { pass++; console.log("  ✓ " + l); } else { fail++; console.log("  ✗ " + l + (x ? "  <- " + x : "")); } }
function section(s) { console.log("\n" + s); }

var TYPES = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css",
              ".json": "application/json", ".png": "image/png", ".webmanifest": "application/manifest+json" };

function serve() {
  return new Promise(function (res) {
    var s = http.createServer(function (req, rep) {
      var p = decodeURIComponent(req.url.split("?")[0]);
      if (p === "/") p = "/index.html";
      var f = path.join(ROOT, p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rep.writeHead(404); return rep.end("no"); }
      rep.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" });
      rep.end(fs.readFileSync(f));
    });
    s.listen(PORT, function () { res(s); });
  });
}

async function open(browser, name) {
  var page = await browser.newPage({ viewport: { width: 430, height: 920 } });
  page.on("console", function (m) { if (m.type() === "error") errors.push(name + ": " + m.text()); });
  page.on("pageerror", function (e) { errors.push(name + ": " + e.message); });
  await page.addInitScript(function (port) {
    window.WG_BROKERS = [{ host: "127.0.0.1", port: port, path: "/", key: "peerjs", secure: false }];
  }, BROKER_PORT);
  await page.goto("http://127.0.0.1:" + PORT + "/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(function () { return window.WG && window.WG.roles && window.WG.roles.all().length === 35; }, null, { timeout: 20000 });
  return page;
}

async function join(page, name, code) {
  await page.fill('input[type="text"]:not(.code-input)', name);
  await page.fill(".code-input", code);
  await page.click("#btn-join");
}

/** What this page's own view says, straight from the renderer's input. */
function view(page) { return page.evaluate(function () { return WG.app.currentView(); }); }

(async function () {
  var server = await serve();
  var brokerServer = broker.start(BROKER_PORT);
  var browser = await chromium.launch({
    executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-sandbox", "--disable-dev-shm-usage"]
  });

  section("The village opens");
  var host = await open(browser, "host");
  await host.fill('input[type="text"]:not(.code-input)', "Aisa");
  await host.click("#btn-host");
  await host.waitForSelector(".roomcode", { timeout: 20000 });
  var code = (await host.textContent(".roomcode")).trim();
  ok("a room code was minted", /^[A-Z0-9]{6}$/.test(code), code);

  section("Three phones find it, and wait at the door");
  var guests = [];
  for (var i = 0; i < 3; i++) {
    var g = await open(browser, "guest" + i);
    await join(g, ["Bruno", "Carla", "Dario"][i], code);
    guests.push(g);
  }
  for (var j = 0; j < 3; j++) {
    await guests[j].waitForSelector("text=At the door", { timeout: 45000 });
  }
  ok("all three are held at the door", true);
  ok("a six-character code alone does not get you in", true);

  await host.waitForFunction(function () {
    return WG.app.currentView().pending.length === 3;
  }, null, { timeout: 20000 });
  ok("the host sees all three waiting", true);

  for (var k = 0; k < 3; k++) await host.click(".card .row .btn.primary");
  await host.waitForFunction(function () { return WG.app.currentView().players.length === 4; }, null, { timeout: 20000 });
  ok("letting them in seats them", true);
  for (var m = 0; m < 3; m++) await guests[m].waitForSelector(".roomcode", { timeout: 20000 });
  ok("and every phone knows it", true);

  section("The bag is dealt");
  // A board built to make the timing test deterministic: one wolf, one
  // bodyguard, two villagers.
  await host.evaluate(function () {
    WG_HELPERS.dispatch({ type: "ROLESET", roles: { werewolf: 1, bodyguard: 1, villager: 2 } });
  });
  await host.evaluate(function () {
    WG_HELPERS.dispatch({ type: "CONFIG", config: Object.assign(JSON.parse(JSON.stringify(WG.app.currentView().config)), {
      flow: { preset: "custom", durations: { role_reveal: 600, night: 600, dawn: 600, discussion: 600, voting: 600, verdict: 600 },
              endNightEarly: false, endVotingEarly: false }
    }) });
  });
  await host.click("text=Start the night");
  await host.waitForFunction(function () { return WG.app.currentView().phase === "role_reveal"; }, null, { timeout: 15000 });
  ok("the game started", true);

  var all = [host].concat(guests);
  for (var n = 0; n < all.length; n++) {
    await all[n].waitForFunction(function () { return WG.app.currentView().phase === "role_reveal"; }, null, { timeout: 20000 });
  }
  ok("every phone is on the reveal", true);

  section("Everybody sees their own role and nobody else's");
  var seen = [];
  for (var q = 0; q < all.length; q++) {
    var v = await view(all[q]);
    seen.push({ id: v.me.id, role: v.me.role.id, name: v.me.name,
      others: v.players.filter(function (p) { return !p.isMe && p.role; }).length });
  }
  ok("each phone knows its own role", seen.every(function (s) { return !!s.role; }), JSON.stringify(seen.map(function (s) { return s.role; })));
  ok("nobody can read anybody else's", seen.every(function (s) { return s.others === 0; }),
    JSON.stringify(seen.map(function (s) { return s.others; })));
  var roles = seen.map(function (s) { return s.role; }).sort().join(",");
  ok("the bag was dealt as configured", roles === "bodyguard,villager,villager,werewolf", roles);

  for (var r2 = 0; r2 < all.length; r2++) await all[r2].click(".dock .btn.primary");
  for (var r3 = 0; r3 < all.length; r3++) {
    await all[r3].waitForFunction(function () { return WG.app.currentView().phase === "night"; }, null, { timeout: 20000 });
  }
  ok("everybody being ready ends the phase early", true);

  section("The night, played on four phones at once");
  var wolf = all[seen.findIndex(function (s) { return s.role === "werewolf"; })];
  var guard = all[seen.findIndex(function (s) { return s.role === "bodyguard"; })];
  var villagers = all.filter(function (p, i) { return seen[i].role === "villager"; });
  var victimId = (await view(villagers[0])).me.id;
  var victimName = (await view(villagers[0])).me.name;

  var houses = await wolf.locator(".village-svg .hs").count();
  ok("the village is drawn as houses, one per player", houses === 4, String(houses));
  ok("and it is one SVG that scales, not a scrolling grid",
    (await wolf.locator(".village-svg").count()) === 1);

  // The wolf knocks on the victim's door and howls. One wolf, so it lands now.
  await wolf.evaluate(function (id) { WG_HELPERS.dispatch({ type: "KNOCK", houseId: id }); }, victimId);
  await wolf.waitForSelector(".sheet .offer", { timeout: 10000 });
  var wolfOffer = await wolf.textContent(".sheet .offer .verb");
  ok("the wolf is offered the pack's door verb", /door for the pack/i.test(wolfOffer), wolfOffer);
  await wolf.click(".sheet .offer");
  await villagers[0].waitForFunction(function () { return WG.app.currentView().me.alive === false; }, null, { timeout: 15000 });
  ok("the kill lands during the night, not at dawn", true);

  // Now the Bodyguard walks up to the same door — late.
  await guard.evaluate(function (id) { WG_HELPERS.dispatch({ type: "KNOCK", houseId: id }); }, victimId);
  await guard.waitForSelector(".sheet", { timeout: 10000 });
  var disc = await guard.locator(".discovery").count();
  ok("he is shown a body, not a target list", disc === 1);
  var text = disc ? await guard.textContent(".discovery") : "";
  ok("in the Bodyguard's own words", /found them already dead inside/i.test(text), text.slice(0, 120));
  ok("it names who it was", text.indexOf(victimName) >= 0, text.slice(0, 120));

  var offerLabels = await guard.locator(".sheet .offer .verb").allTextContents();
  ok("guarding a corpse is not on the menu", !offerLabels.some(function (t) { return /Stand at the door/i.test(t); }),
    JSON.stringify(offerLabels));
  ok("raising the alarm is", offerLabels.some(function (t) { return /Raise the alarm/i.test(t); }),
    JSON.stringify(offerLabels));

  var turnBefore = (await view(guard)).me.turn.spent;
  ok("finding the body cost him nothing", turnBefore === false);
  await guard.click(".sheet .offer:has-text('Raise the alarm')");
  await guard.waitForTimeout(600);
  ok("and neither did reporting it", (await view(guard)).me.turn.spent === false);

  // He still has a night to spend, on somebody who is still breathing.
  var otherId = (await view(villagers[1])).me.id;
  await guard.evaluate(function (id) { WG_HELPERS.dispatch({ type: "KNOCK", houseId: id }); }, otherId);
  await guard.waitForSelector(".sheet .offer", { timeout: 10000 });
  await guard.click(".sheet .offer:has-text('Stand at the door')");
  await guard.waitForFunction(function () { return WG.app.currentView().me.turn.spent === true; }, null, { timeout: 10000 });
  ok("he can still guard somebody living", true);

  section("The village sees a corpse; only the finder knows how");
  var vv = await view(villagers[1]);
  var deadHouse = vv.houses.filter(function (h) { return h.id === victimId; })[0];
  ok("everyone can see the house has a body", deadHouse.state === "dead-tonight", deadHouse.state);
  ok("and that it was reported", deadHouse.reported === true);
  ok("but the village has been told nothing about it",
    !vv.publicLog.some(function (e) { return e.kind === "death" || e.kind === "report"; }),
    JSON.stringify(vv.publicLog.map(function (e) { return e.kind; })));

  section("Dawn");
  await host.evaluate(function () { WG_HELPERS.dispatch({ type: "SKIP_PHASE" }); });
  for (var d = 0; d < all.length; d++) {
    await all[d].waitForFunction(function () { return WG.app.currentView().phase === "dawn"; }, null, { timeout: 20000 });
  }
  var log = (await view(villagers[1])).publicLog.map(function (e) { return e.text; }).join(" | ");
  ok("the morning report names the dead", log.indexOf(victimName) >= 0, log);
  ok("and says who found them", /raised the alarm/.test(log), log);

  section("The room's colour actually moved");
  var nightBg = await host.evaluate(function () { return getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(); });
  await host.evaluate(function () { WG_HELPERS.dispatch({ type: "SKIP_PHASE" }); });
  await host.waitForFunction(function () { return WG.app.currentView().phase === "discussion"; }, null, { timeout: 15000 });
  await host.waitForTimeout(400);
  var dayBg = await host.evaluate(function () {
    WG.theme.paint();
    return getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  });
  ok("dawn and discussion are not the same colour", nightBg !== dayBg, nightBg + " -> " + dayBg);

  section("Discussion, and the vote");
  // From the Bodyguard, who is reliably alive — a dead player's "day" message
  // is routed to the dead channel, which is the point of the dead channel.
  await guard.evaluate(function () {
    WG_HELPERS.dispatch({ type: "CHAT", text: "It was not me.", channel: "day" });
  });
  await villagers[1].waitForFunction(function () {
    return (WG.app.currentView().chat.day || []).length > 0;
  }, null, { timeout: 15000 });
  ok("chat reaches the other phones", true);
  ok("the dead cannot speak into the village square", await villagers[0].evaluate(function () {
    WG_HELPERS.dispatch({ type: "CHAT", text: "I know who did it", channel: "day" });
    return true;
  }) && await (async function () {
    await villagers[1].waitForTimeout(500);
    var v = await view(villagers[1]);
    return !(v.chat.day || []).some(function (m) { return m.text.indexOf("I know who did it") >= 0; });
  })());

  await host.evaluate(function () { WG_HELPERS.dispatch({ type: "SKIP_PHASE" }); });
  for (var vph = 0; vph < all.length; vph++) {
    await all[vph].waitForFunction(function () { return WG.app.currentView().phase === "voting"; }, null, { timeout: 20000 });
  }
  var wolfId = (await view(wolf)).me.id;
  var guardId = (await view(guard)).me.id;
  for (var vt = 0; vt < all.length; vt++) {
    var vw = await view(all[vt]);
    if (!vw.me.alive) continue;
    // Voting for yourself is off by default, so the wolf has to pick somebody.
    var target = vw.me.id === wolfId ? guardId : wolfId;
    await all[vt].evaluate(function (id) { WG_HELPERS.dispatch({ type: "VOTE", targetId: id }); }, target);
  }
  await host.waitForFunction(function () { return WG.app.currentView().votes.cast >= 3; }, null, { timeout: 15000 });
  ok("all three living players voted", true);
  var selfVote = await wolf.evaluate(function () {
    WG_HELPERS.dispatch({ type: "VOTE", targetId: WG.app.currentView().me.id });
    return true;
  });
  await wolf.waitForTimeout(400);
  ok("and the wolf could not vote for itself",
    (await view(wolf)).votes.mine !== wolfId, String((await view(wolf)).votes.mine));
  await host.evaluate(function () { WG_HELPERS.dispatch({ type: "SKIP_PHASE" }); });
  await host.waitForFunction(function () { return WG.app.currentView().winner; }, null, { timeout: 20000 });
  var winner = (await view(host)).winner;
  ok("hanging the wolf ends it", winner && winner.team === "village", JSON.stringify(winner));

  for (var go = 0; go < all.length; go++) {
    await all[go].waitForFunction(function () { return WG.app.currentView().phase === "game_over"; }, null, { timeout: 20000 });
  }
  var final = await view(villagers[1]);
  ok("everything is revealed at the end", final.players.every(function (p) { return !!p.role; }));

  section("Housekeeping");
  ok("no console errors anywhere in that", errors.length === 0, errors.slice(0, 4).join(" | "));
  ok("a service worker registered", await host.evaluate(function () {
    return navigator.serviceWorker.getRegistration().then(function (r) { return !!r; });
  }));

  await host.screenshot({ path: "/tmp/wg-end.png" });
  await guard.screenshot({ path: "/tmp/wg-guard.png" });

  await browser.close();
  server.close();
  if (brokerServer && brokerServer.close) brokerServer.close();
  console.log("\n" + pass + " passed, " + fail + " failed\n");
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
