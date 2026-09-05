/* fit-test.js — nothing scrolls, at any size anybody actually has.
 *
 * The app is meant to be exactly one viewport: a fixed frame, a stage that
 * takes the slack, and only a chat log or a long list scrolling inside itself.
 * That is easy to state and very easy to break — one card with a fixed height,
 * one grid that will not shrink, and a phone in landscape has a scrollbar.
 *
 * So this walks every screen at nine real viewport sizes, from a small phone in
 * portrait to a TV, and fails if the document is ever taller or wider than the
 * window, or if anything outside a `.pane.scroll` has overflowed.
 *
 * Run: node tools/fit-test.js
 */
"use strict";
var { chromium } = require("/opt/node22/lib/node_modules/playwright");
var http = require("http"), fs = require("fs"), path = require("path");
var ROOT = path.join(__dirname, ".."), PORT = 8961;
var TYPES = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png" };
var pass = 0, fail = 0;
function ok(l, c, x) { if (c) { pass++; console.log("  ok  " + l); } else { fail++; console.log("  FAIL " + l + (x ? "  <- " + x : "")); } }

/* A small phone, a normal phone, a big phone, both in landscape, a tablet, a
 * laptop and a TV. The 320x568 is the floor: an iPhone SE 1st gen, which is
 * still the size that breaks layouts. */
var SIZES = [
  ["small phone", 320, 568], ["phone", 390, 844], ["big phone", 430, 932],
  ["phone landscape", 844, 390], ["small landscape", 568, 320],
  ["tablet", 768, 1024], ["tablet landscape", 1024, 768],
  /* The awkward middle. 900px is where the two-column layout switches on, so
   * the widths either side of it are exactly where a minimum-width column can
   * push the whole page sideways. */
  ["narrow window", 640, 760], ["just under split", 899, 700], ["just over split", 901, 700],
  ["laptop", 1440, 900], ["tv", 1920, 1080]
];
var SCENES = ["home", "lobby", "role_reveal", "night", "door", "dawn", "discussion", "voting", "game_over"];

function serve() {
  return new Promise(function (r) {
    var s = http.createServer(function (q, p) {
      var u = decodeURIComponent(q.url.split("?")[0]);
      var f = path.join(ROOT, u === "/" ? "/index.html" : u);
      if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { p.writeHead(404); return p.end(); }
      p.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "text/plain" });
      p.end(fs.readFileSync(f));
    });
    s.listen(PORT, function () { r(s); });
  });
}

(async function () {
  var server = await serve();
  var browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
  var worst = [];

  for (var i = 0; i < SIZES.length; i++) {
    var name = SIZES[i][0], w = SIZES[i][1], h = SIZES[i][2];
    var page = await browser.newPage({ viewport: { width: w, height: h } });
    var errs = [];
    page.on("pageerror", function (e) { errs.push(e.message); });
    await page.goto("http://127.0.0.1:" + PORT + "/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(function () { return window.WG && WG.roles && WG.roles.all().length === 35; });

    var bad = [];
    for (var j = 0; j < SCENES.length; j++) {
      await page.evaluate(scene, SCENES[j]);
      /* Long enough for the entrance animations to finish. A sheet sliding in
       * or the hit-flash shaking the frame is off the edge on purpose for a
       * few frames, and neither can scroll anything: measure once it lands. */
      await page.waitForTimeout(700);
      var r = await page.evaluate(measure);
      if (r.docH > r.winH + 1 || r.docW > r.winW + 1) {
        bad.push(SCENES[j] + " doc " + r.docW + "x" + r.docH + " > " + r.winW + "x" + r.winH);
      }
      if (r.overflowing.length) bad.push(SCENES[j] + " overflow: " + r.overflowing.join(", "));
      if (r.wide.length) bad.push(SCENES[j] + " past the edge: " + r.wide.join(", "));
    }
    ok(name + " (" + w + "x" + h + ") fits", bad.length === 0, bad.slice(0, 3).join(" | "));
    if (bad.length) worst = worst.concat(bad);
    if (errs.length) ok(name + " had no page errors", false, errs[0]);
    await page.close();
  }

  await browser.close();
  server.close();
  console.log("\n" + pass + " passed, " + fail + " failed\n");
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });

/* --- in-page --- */

function measure() {
  var d = document.documentElement;
  var out = {
    docH: Math.max(d.scrollHeight, document.body.scrollHeight),
    docW: Math.max(d.scrollWidth, document.body.scrollWidth),
    winH: window.innerHeight, winW: window.innerWidth,
    overflowing: [], wide: []
  };

  /* True when some ancestor clips this node horizontally. */
  function clipped(n) {
    for (var p = n.parentElement; p && p !== document.body; p = p.parentElement) {
      var o = getComputedStyle(p).overflowX;
      if (o && o !== "visible") return true;
    }
    return false;
  }

  function name(n) {
    return (n.tagName || "").toLowerCase() +
      (n.id ? "#" + n.id : "") +
      (typeof n.className === "string" && n.className ? "." + n.className.trim().split(/\s+/).join(".") : "");
  }

  /* Anything sticking out past the right edge of the window. This is the check
   * that was missing: the old one only looked at vertical overflow and at the
   * document, so an element 40px too wide inside a clipped ancestor went
   * unnoticed here and showed up as a cut-off interface in a real browser. */
  var all = document.querySelectorAll("body *");
  for (var i = 0; i < all.length; i++) {
    var n = all[i];
    if (n.id === "sky" || n.classList.contains("gore") || n.classList.contains("sweep")) continue;
    /* Inside an <svg>, geometry is deliberately drawn past the viewBox and the
     * viewport clips it - a ridge that spans -20..VW+20 is correct, not a bug.
     * So only the <svg> element itself is measured, never its contents. */
    if (n.ownerSVGElement) continue;
    /* Something inside a scroller or any other clipping box is not sticking
     * out of the window - it is cut off by its own ancestor, which is what a
     * scroll strip is for. Only things nothing clips can reach the edge. */
    if (clipped(n)) continue;
    var cs = getComputedStyle(n);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    var r = n.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (r.right > out.winW + 1 || r.left < -1) {
      out.wide.push(name(n) + " " + Math.round(r.left) + ".." + Math.round(r.right));
      if (out.wide.length > 5) break;
    }
  }

  // And anything that scrolls without being told it may.
  var inner = document.querySelectorAll(".app *");
  for (var j = 0; j < inner.length; j++) {
    var m = inner[j];
    if (m.closest(".pane.scroll") || m.classList.contains("scroll") || m.classList.contains("tabs")) continue;
    var mc = getComputedStyle(m);
    if (m.scrollHeight > m.clientHeight + 2 && mc.overflowY !== "visible") {
      out.overflowing.push(name(m) + " v");
    }
    /* A single line that ends in an ellipsis is over-wide by design. */
    var ellipsis = mc.textOverflow === "ellipsis" && mc.whiteSpace === "nowrap";
    if (!ellipsis && m.scrollWidth > m.clientWidth + 2 && mc.overflowX !== "visible") {
      out.overflowing.push(name(m) + " h");
    }
    if (out.overflowing.length > 4) break;
  }
  return out;
}

function scene(which) {
  if (which === "home") {
    window.WG_APP.role = null; window.WG_APP.state = null; window.WG_APP.screen = "home";
    WG.app.render();
    return;
  }
  var NAMES = ["Aisa", "Bruno", "Carla", "Dario", "Elena", "Fitz", "Gia", "Hugo", "Ivo", "Jun", "Kai", "Lia"];
  var ROLES = ["bodyguard", "werewolf", "seer", "villager", "doctor", "wolf_shaman", "villager", "cat",
               "mason", "witch", "jester", "detective"];
  var st = WG.state.createState("QX3JHG");
  st.hostId = "host";
  NAMES.forEach(function (n, i) {
    var p = WG.state.createPlayer(i ? "p" + i : "host", n, i);
    p.role = ROLES[i];
    Object.assign(p, WG.roles.initialState(ROLES[i]));
    st.players.push(p);
  });
  st.roster = { werewolf: 2, seer: 1, doctor: 1, bodyguard: 1, cat: 1, mason: 1, witch: 1, jester: 1, detective: 1, villager: 2 };
  st.round = which === "lobby" ? 0 : 2;
  WG.win.noteLeaders(st);

  var phase = which === "door" ? "night" : which;
  if (phase !== "lobby" && phase !== "role_reveal") {
    WG.resolver.beginNight(st);
    var out = WG.resolver.bag();
    WG.resolver.kill(st, "p3", { cause: "pack", byId: "p1", out: out });
    if (phase !== "night") WG.resolver.announceDeath(st, "p3");
    st.publicLog = [
      { text: "Dario is dead - torn apart in the night. They were a Villager.", kind: "death", round: 2, at: Date.now() },
      { text: "Aisa found Dario and raised the alarm.", kind: "report", round: 2, at: Date.now() }
    ];
    st.chat.day = NAMES.map(function (n, i) {
      return { id: "p" + i, name: n, text: "Something reasonably long to say about who did it.", at: Date.now() };
    });
  }
  if (phase === "voting") st.votes = { host: "p1", p2: "p1", p4: "p6" };
  if (phase === "game_over") {
    st.winner = { team: "village", message: "The Village wins. Every wolf is dead." };
    st.players[1].alive = false; st.players[1].diedNight = 3;
  }
  WG.clock.enter(st, phase);
  st.phaseStartedAt = Date.now() - (st.phaseEndsAt - st.phaseStartedAt) * 0.34;

  window.WG_APP.role = "host";
  window.WG_APP.state = st;
  window.WG_APP.clientId = "host";
  window.WG_APP.screen = "room";
  window.WG_APP.waiting = false;
  window.__st = st;
  WG.app.render();

  if (which === "door") {
    st.night.houses.p3.reportedBy = null;
    var res = WG.resolver.knock(st, "host", "p3");
    WG_HELPERS.openModal(WG.screens.doorSheet({
      houseId: "p3", occupant: res.occupant, state: res.state,
      discovery: res.discovery, offers: res.offers
    }));
  } else {
    WG_HELPERS.closeModal();
  }
}
