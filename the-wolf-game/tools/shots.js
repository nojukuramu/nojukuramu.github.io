/* shots.js — a screenshot of every screen, in both themes.
 *
 * Not a test: a way to look at the thing. It drives one page through the whole
 * round with the state faked in place, which is enough for the screens because
 * they only ever read the view.
 */
"use strict";
var { chromium } = require("/opt/node22/lib/node_modules/playwright");
var http = require("http"), fs = require("fs"), path = require("path");
var ROOT = path.join(__dirname, ".."), PORT = 8921;
var OUT = process.env.OUT || "/tmp/shots";
var TYPES = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png" };

function serve() {
  return new Promise(function (r) {
    var s = http.createServer(function (q, p) {
      var f = path.join(ROOT, decodeURIComponent(q.url.split("?")[0]) === "/" ? "/index.html" : decodeURIComponent(q.url.split("?")[0]));
      if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { p.writeHead(404); return p.end(); }
      p.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "text/plain" });
      p.end(fs.readFileSync(f));
    });
    s.listen(PORT, function () { r(s); });
  });
}

var SCENES = ["lobby", "role_reveal", "night", "dawn", "discussion", "voting", "game_over"];

(async function () {
  fs.mkdirSync(OUT, { recursive: true });
  var server = await serve();
  var browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });

  for (var t = 0; t < 2; t++) {
    var mode = ["light", "dark"][t];
    var page = await browser.newPage({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 });
    await page.goto("http://127.0.0.1:" + PORT + "/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(function () { return window.WG && window.WG.roles && window.WG.roles.all().length === 35; });
    await page.evaluate(function (m) { WG.theme.setMode(m); }, mode);
    await page.waitForTimeout(2000);
    await page.screenshot({ path: OUT + "/00-home-" + mode + ".png" });

    for (var i = 0; i < SCENES.length; i++) {
      await page.evaluate(fake, SCENES[i]);
      await page.waitForTimeout(2000);
      await page.screenshot({ path: OUT + "/" + String(i + 1).padStart(2, "0") + "-" + SCENES[i] + "-" + mode + ".png" });

      // The door sheet belongs on the night screen — it is the screen the
      // whole redesign exists for, and it only makes sense mid-night.
      if (SCENES[i] === "night") {
        await page.evaluate(fakeSheet);
        await page.waitForTimeout(900);
        await page.screenshot({ path: OUT + "/03b-door-" + mode + ".png" });
        await page.evaluate(function () { WG_HELPERS.closeModal(); });
      }
    }
    await page.close();
  }

  await browser.close();
  server.close();
  console.log("wrote " + fs.readdirSync(OUT).length + " shots to " + OUT);
})();

/* Everything below runs inside the page. */
function fake(phase) {
  var NAMES = ["Aisa", "Bruno", "Carla", "Dario", "Elena", "Fitz", "Gia", "Hugo", "Ivo", "Jun"];
  var ROLES = ["bodyguard", "werewolf", "seer", "villager", "doctor", "wolf_shaman", "villager", "cat", "mason", "witch"];
  var state = WG.state.createState("7HGPR6");
  state.hostId = "host";
  NAMES.forEach(function (n, i) {
    var p = WG.state.createPlayer(i ? "p" + i : "host", n, i);
    p.role = ROLES[i];
    Object.assign(p, WG.roles.initialState(ROLES[i]));
    state.players.push(p);
  });
  state.roster = { werewolf: 1, wolf_shaman: 1, seer: 1, doctor: 1, bodyguard: 1, cat: 1, mason: 1, witch: 1, villager: 2 };
  state.round = phase === "lobby" ? 0 : 2;
  WG.win.noteLeaders(state);

  if (phase !== "lobby" && phase !== "role_reveal") {
    WG.resolver.beginNight(state);
    var out = WG.resolver.bag();
    WG.resolver.kill(state, "p3", { cause: "pack", byId: "p1", out: out });
    state.night.houses.p3.reportedBy = "host";
    state.night.turns.host.spent = phase !== "night";
    state.publicLog = [
      { text: "Dario is dead - torn apart in the night. They were a Villager.", kind: "death", round: 2, at: Date.now() },
      { text: "Aisa found Dario and raised the alarm.", kind: "report", round: 2, at: Date.now() }
    ];
    state.chat.day = [
      { id: "p2", name: "Carla", text: "Aisa found the body awfully fast.", at: Date.now() },
      { id: "host", name: "Aisa", text: "I was there to guard him. I was late.", at: Date.now() },
      { id: "p4", name: "Elena", text: "Late, or first?", at: Date.now() },
      { id: "p7", name: "Hugo", text: "meow meow meow meow meow", at: Date.now() }
    ];
  }
  if (phase === "voting") {
    state.votes = { host: "p1", p2: "p1", p4: "p6", p5: "p1" };
  }
  if (phase === "game_over") {
    state.winner = { team: "village", message: "The Village wins. Every wolf is dead." };
    state.players[1].alive = false; state.players[1].diedNight = 3;
    state.players[5].alive = false; state.players[5].diedNight = 2;
  }
  WG.clock.enter(state, phase);
  // Park the clock a third of the way in, so the sky is mid-blend rather than
  // sitting exactly on a named stop.
  state.phaseStartedAt = Date.now() - (state.phaseEndsAt - state.phaseStartedAt) * 0.34;

  // Pose as the host with this state. The screens only read the view, so this
  // is the whole of what "being in a game" means to them.
  window.__fakeState = state;
  window.WG_APP.role = "host";
  window.WG_APP.waiting = false;
  window.WG_APP.state = state;
  window.WG_APP.clientId = "host";
  window.WG_APP.screen = "room";
  window.WG_APP.waiting = false;
  WG.theme.follow(function () { return WG.view.build(state, "host"); });
  WG.theme.paint();
  WG.app.render();
}

function fakeSheet() {
  var state = window.__fakeState;
  state.night.turns.host.spent = false;
  state.night.houses.p3.reportedBy = null;   // nobody has raised the alarm yet
  var res = WG.resolver.knock(state, "host", "p3");
  WG_HELPERS.openModal(WG.screens.doorSheet({
    houseId: "p3", occupant: res.occupant, state: res.state,
    discovery: res.discovery, offers: res.offers
  }));
}
