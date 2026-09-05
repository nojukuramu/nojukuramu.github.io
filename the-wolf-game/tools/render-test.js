/* render-test.js — a repaint must not take the screen away from the reader.
 *
 * The host rebuilds the whole stage every few seconds on its own, and every
 * guest rebuilt it again each time a snapshot landed. That is invisible right
 * up until somebody is reading the log or typing into the chat: the log jumps
 * back to the bottom, the half-typed line vanishes, and the entrance animation
 * plays again. It reads as the page randomly refreshing itself.
 *
 * So: scroll something, type something, focus it, force a render, and check
 * that all three are still where they were.
 *
 * Run: node tools/render-test.js
 */
"use strict";
var { chromium } = require("/opt/node22/lib/node_modules/playwright");
var http = require("http"), fs = require("fs"), path = require("path");
var ROOT = path.join(__dirname, ".."), PORT = 8963;
var TYPES = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png" };
var pass = 0, fail = 0;
function ok(l, c, x) { if (c) { pass++; console.log("  ok  " + l); } else { fail++; console.log("  FAIL " + l + (x ? "  <- " + x : "")); } }

/* The scene builder is the fit-test's — one game, mid-round, with a chat. */
var SRC = fs.readFileSync(path.join(__dirname, "fit-test.js"), "utf8");
var scene = eval("(" + SRC.slice(SRC.indexOf("function scene(which)")) + ")");

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
  var page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  var errs = [];
  page.on("pageerror", function (e) { errs.push(e.message); });
  await page.goto("http://127.0.0.1:" + PORT + "/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(function () { return window.WG && WG.roles && WG.roles.all().length === 35; });
  await page.evaluate(scene, "discussion");
  await page.waitForTimeout(200);

  console.log("\nA repaint keeps the reader's place");

  var r = await page.evaluate(function () {
    var log = document.querySelector(".log.scroll") || document.querySelector(".chat.scroll");
    var input = document.querySelector(".chat-form input");
    if (!log || !input) return { missing: true };

    // Fill the log until it genuinely scrolls, then read it from the top.
    for (var i = 0; i < 40; i++) {
      var li = document.createElement("li");
      li.textContent = "Line " + i;
      log.appendChild(li);
    }
    log.scrollTop = 0;
    var scrolled = log.scrollHeight > log.clientHeight;

    input.value = "half a thou";
    input.focus();
    input.setSelectionRange(4, 4);

    WG.app.render();

    var log2 = document.querySelector(".log.scroll") || document.querySelector(".chat.scroll");
    var in2 = document.querySelector(".chat-form input");
    return {
      scrolled: scrolled,
      top: log2 ? log2.scrollTop : -1,
      value: in2 ? in2.value : null,
      focused: document.activeElement === in2,
      caret: in2 ? in2.selectionStart : -1
    };
  });

  ok("the fixture actually scrolls", !r.missing && r.scrolled, r.missing ? "no log or chat input on screen" : "");
  ok("a log read from the top stays at the top", r.top === 0, "scrollTop " + r.top);
  ok("half-typed chat survives", r.value === "half a thou", String(r.value));
  ok("and keeps the focus", r.focused === true);
  ok("and the caret where it was", r.caret === 4, String(r.caret));

  console.log("\nA log at the bottom stays pinned to the bottom");
  var s = await page.evaluate(function () {
    var log = document.querySelector(".log.scroll") || document.querySelector(".chat.scroll");
    log.scrollTop = log.scrollHeight;
    WG.app.render();
    var l2 = document.querySelector(".log.scroll") || document.querySelector(".chat.scroll");
    return { end: l2.scrollTop + l2.clientHeight >= l2.scrollHeight - 2 };
  });
  ok("new lines do not strand the reader above them", s.end === true);

  console.log("\nAn unchanged snapshot is not a repaint");
  var q = await page.evaluate(function () {
    // Stand in as a guest: the same view twice in a row must not rebuild.
    var view = WG.view.build(window.__st, "host");
    window.WG_APP.role = "guest";
    window.WG_APP.view = view;
    var before = document.querySelector("#stage").firstElementChild;
    WG.app.onHostMessage({ type: "STATE", rev: view.rev = 99, state: view });
    var mid = document.querySelector("#stage").firstElementChild;
    WG.app.onHostMessage({ type: "STATE", rev: 100, state: JSON.parse(JSON.stringify(view)) });
    var after = document.querySelector("#stage").firstElementChild;
    return { rebuiltOnce: before !== mid, keptSecond: mid === after };
  }).catch(function (e) { return { err: e.message }; });

  if (q.err) ok("guest repaint check ran", false, q.err);
  else {
    ok("the first snapshot paints", q.rebuiltOnce === true);
    ok("an identical one does not", q.keptSecond === true);
  }

  ok("no page errors", errs.length === 0, errs[0]);

  await browser.close();
  server.close();
  console.log("\n" + pass + " passed, " + fail + " failed\n");
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
