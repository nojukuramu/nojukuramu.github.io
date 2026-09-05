/* icon-sheet.js — every glyph, at the sizes it is actually used, to look at.
 *
 * Not a test. A drawn icon set only works if the drawings are legible at 16px,
 * and the only way to know that is to put them all on one page and look.
 */
"use strict";
var { chromium } = require("/opt/node22/lib/node_modules/playwright");
var http = require("http"), fs = require("fs"), path = require("path");
var ROOT = path.join(__dirname, ".."), PORT = 8981;
var T = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png" };

http.createServer(function (q, p) {
  var u = decodeURIComponent(q.url.split("?")[0]);
  var f = path.join(ROOT, u === "/" ? "/index.html" : u);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { p.writeHead(404); return p.end(); }
  p.writeHead(200, { "Content-Type": T[path.extname(f)] || "text/plain" });
  p.end(fs.readFileSync(f));
}).listen(PORT, async function () {
  var b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
  var page = await b.newPage({ viewport: { width: 900, height: 1200 }, deviceScaleFactor: 2 });
  await page.goto("http://127.0.0.1:" + PORT + "/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(function () { return window.WG && WG.icons; });
  await page.evaluate(function () {
    WG.theme.setMode("dark");
    document.getElementById("sky").remove();
    document.querySelector(".gore").remove();
    var app = document.querySelector(".app");
    app.style.position = "static";
    app.innerHTML = "";
    var wrap = document.createElement("div");
    wrap.style.cssText = "display:grid;grid-template-columns:repeat(6,1fr);gap:10px;padding:14px";
    WG.icons.names.sort().forEach(function (n) {
      var cell = document.createElement("div");
      cell.style.cssText = "display:flex;align-items:center;gap:10px;padding:8px;border:1px solid var(--line);border-radius:10px;background:var(--bg-2)";
      cell.appendChild(WG.icons.node(n, 34, { weight: 1.3 }));
      cell.appendChild(WG.icons.node(n, 20));
      cell.appendChild(WG.icons.node(n, 14));
      var t = document.createElement("span");
      t.textContent = n;
      t.style.cssText = "font-size:11px;color:var(--ink-2)";
      cell.appendChild(t);
      wrap.appendChild(cell);
    });
    document.body.style.overflow = "auto";
    document.body.style.background = "var(--bg)";
    app.appendChild(wrap);
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: "/tmp/icons.png", fullPage: true });
  await b.close();
  console.log("wrote /tmp/icons.png");
  process.exit(0);
});
