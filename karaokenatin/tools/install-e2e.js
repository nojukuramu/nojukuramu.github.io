/* tools/install-e2e.js — the PWA: manifest, service worker, install button.
 *
 * The real install prompt cannot be driven from a test — Chrome only fires
 * `beforeinstallprompt` against its own installability heuristics, and never
 * under automation. So this checks the two halves separately:
 *
 *   1. the static contract a browser reads to decide the app is installable
 *      (manifest fields, icon sizes, a registered worker with a fetch handler)
 *   2. our behaviour once an install prompt exists, by dispatching a stand-in
 *      event and asserting we defer it, show the button, and fire it on click
 *
 * Plus the fallback path: with no prompt event at all, the button must still
 * appear and explain how to install by hand, rather than hiding the option.
 *
 * Run: node tools/install-e2e.js
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json"
};

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

let failures = 0;
function check(name, ok, extra) {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (ok || extra === undefined ? "" : "  → " + extra));
  if (!ok) failures++;
}

/* A stand-in for the BeforeInstallPromptEvent, recording what we do with it. */
const FAKE_PROMPT = `
window.__install = { prevented: false, prompted: 0 };
var ev = new Event("beforeinstallprompt");
ev.preventDefault = function () { window.__install.prevented = true; };
ev.prompt = function () {
  window.__install.prompted++;
  return Promise.resolve();
};
ev.userChoice = Promise.resolve({ outcome: "accepted", platform: "web" });
window.dispatchEvent(ev);
`;

async function main() {
  const site = await serve();
  const port = site.address().port;
  const base = `http://127.0.0.1:${port}/index.html`;

  /* ── the static installability contract ────────────────────────────────── */
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.webmanifest"), "utf8"));

  check("manifest declares a name", !!manifest.name, manifest.name);
  check("manifest declares a start_url", !!manifest.start_url, manifest.start_url);
  check("manifest display is standalone", manifest.display === "standalone", manifest.display);
  check("manifest sets a theme colour", /^#[0-9a-f]{6}$/i.test(manifest.theme_color || ""), manifest.theme_color);

  const sizes = (manifest.icons || []).map((i) => i.sizes);
  check("manifest ships a 192px icon", sizes.includes("192x192"), sizes.join(" "));
  check("manifest ships a 512px icon", sizes.includes("512x512"), sizes.join(" "));
  check(
    "manifest ships a maskable icon",
    (manifest.icons || []).some((i) => (i.purpose || "").split(/\s+/).includes("maskable"))
  );

  let iconsPresent = true;
  const missing = [];
  for (const icon of manifest.icons) {
    const p = path.join(ROOT, icon.src);
    if (!fs.existsSync(p)) { iconsPresent = false; missing.push(icon.src); }
  }
  check("every icon the manifest names exists", iconsPresent, missing.join(", "));

  const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  check("service worker handles fetch (required to be installable)", /addEventListener\(\s*["']fetch["']/.test(sw));

  /* ── it registers, and leaves other origins alone ──────────────────────── */
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const ctx = await browser.newContext();
  await ctx.route(/youtube\.com|ytimg\.com|pipedapi|invidious/, (r) => r.abort());
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { console.log("  !! page error:", e.message); failures++; });

  await page.goto(base);
  const registered = await page.evaluate(() =>
    navigator.serviceWorker.ready.then(
      (reg) => !!reg.active || !!reg.installing || !!reg.waiting,
      () => false
    )
  );
  check("service worker registers", registered);

  const scope = await page.evaluate(() => navigator.serviceWorker.ready.then((r) => r.scope));
  check("worker scope is limited to this app", /\/$/.test(scope), scope);

  const linked = await page.getAttribute('link[rel="manifest"]', "href");
  check("page links the manifest", linked === "manifest.webmanifest", String(linked));

  const manifestRes = await page.evaluate((u) => fetch(u).then((r) => r.status), "manifest.webmanifest");
  check("manifest is served", manifestRes === 200, String(manifestRes));

  /* ── behaviour when a prompt is available ──────────────────────────────── */
  await page.evaluate(FAKE_PROMPT);
  await page.waitForSelector("#install-bar:not([hidden])", { timeout: 10000 });
  check("install bar appears when the browser offers a prompt", true);

  const prevented = await page.evaluate(() => window.__install.prevented);
  check("the browser's own mini-infobar is suppressed", prevented);

  await page.click("#install-btn");
  await page.waitForFunction(() => window.__install.prompted === 1, null, { timeout: 10000 });
  check("clicking Install fires the deferred prompt", true);

  await page.waitForSelector("#install-bar", { state: "hidden", timeout: 10000 });
  check("bar clears once the install is accepted", true);

  /* ── dismissal sticks ──────────────────────────────────────────────────── */
  const ctx2 = await browser.newContext();
  await ctx2.route(/youtube\.com|ytimg\.com|pipedapi|invidious/, (r) => r.abort());
  const p2 = await ctx2.newPage();
  await p2.goto(base);
  await p2.evaluate(FAKE_PROMPT);
  await p2.waitForSelector("#install-bar:not([hidden])");
  await p2.click("#install-dismiss");
  await p2.waitForSelector("#install-bar", { state: "hidden" });
  await p2.reload();
  await p2.evaluate(FAKE_PROMPT);
  await p2.waitForTimeout(3200); // past the manual-fallback timer
  const stillHidden = await p2.locator("#install-bar").isHidden();
  check("a dismissed install bar stays dismissed across reloads", stillHidden);

  /* ── no prompt event at all (Safari, Firefox) ──────────────────────────── */
  const ctx3 = await browser.newContext();
  await ctx3.route(/youtube\.com|ytimg\.com|pipedapi|invidious/, (r) => r.abort());
  const p3 = await ctx3.newPage();
  await p3.goto(base);
  await p3.waitForSelector("#install-bar:not([hidden])", { timeout: 15000 });
  check("install option still appears without a prompt event", true);

  await p3.click("#install-btn");
  await p3.waitForSelector("#install-help:not([hidden])", { timeout: 10000 });
  const help = (await p3.textContent("#install-help-body")).trim();
  check("manual instructions are offered instead", help.length > 20, help.slice(0, 60));

  await browser.close();
  site.close();
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
