#!/usr/bin/env node
/* ============================================================
   Bloomworks — the game, played in a real browser
   `node tools/e2e.js [--shots <dir>]`

   The shape is Aeons' tools/e2e.js: serve the folder, open it in Chromium
   (WebGL through SwiftShader, so it runs headless), play it the way a
   person would, and fail on anything a person would notice — including any
   error in the console.

   On a phone (touch): the first layout sells Glow; Build opens, a Polisher
   is picked and placed by a tap; a copy is tapped and its card shows; a
   plot's card claims it; every panel and every tab opens; a Harvest, an
   Eclipse and a Star on the Sky; Zen Mode; the save survives a reload, and
   time away comes back as a Logbook. On a computer: the wheel zooms and a
   drag pans.
   ============================================================ */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

let chromium;
for (const where of ["playwright", "/opt/node-tools/node_modules/playwright", "playwright-core"]) {
  try { ({ chromium } = require(where)); break; } catch (e) { /* next */ }
}
if (!chromium) { console.log("playwright is not installed here; skipping the browser pass."); process.exit(0); }

const ROOT = path.join(__dirname, "..");
const shotsAt = process.argv.indexOf("--shots") > 0 ? process.argv[process.argv.indexOf("--shots") + 1] : null;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json", ".txt": "text/plain" };
const failures = [];
let checks = 0;
function check(name, cond, detail) { checks++; if (cond) process.stdout.write("  \u2713 " + name + "\n"); else { failures.push(name + (detail ? " — " + detail : "")); process.stdout.write("  \u2717 " + name + (detail ? " — " + detail : "") + "\n"); } }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const server = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split("?")[0]);
  if (p.endsWith("/")) p += "index.html";
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT)) { r.writeHead(403); r.end(); return; }
  fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" }); r.end(d); });
});

(async () => {
  await new Promise((res) => server.listen(0, res));
  const url = "http://localhost:" + server.address().port + "/";
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const errors = [];
  const watch = (p) => { p.on("pageerror", (e) => errors.push(e.message)); p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); }); };
  const shot = async (p, name) => { if (shotsAt) { fs.mkdirSync(shotsAt, { recursive: true }); await p.screenshot({ path: path.join(shotsAt, name + ".png") }); } };
  const ev = (p, fn, arg) => p.evaluate(fn, arg);
  const click = (p, sel) => p.dispatchEvent(sel, "click");

  process.stdout.write("\nA phone\n");
  const ctx = await browser.newContext({ viewport: { width: 400, height: 820 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const p = await ctx.newPage();
  watch(p);
  await p.goto(url);
  await p.waitForFunction(() => window.__bw && window.__bw.S && window.__bw.S.season);
  await wait(800);
  check("the first visit explains the game", await p.isVisible("#info-sheet"));
  await p.click("#info-close");
  check("the first layout is placed for you", await ev(p, () => window.__bw.S.season.copies.length === 4));
  await ev(p, () => window.__bw.game.advance(90));
  await wait(400);
  check("the first layout sells Glow", await ev(p, () => window.__bw.S.meta.stats.sold > 10));
  await shot(p, "phone-start");

  // Build a Polisher by tapping the ground.
  await ev(p, () => { const { S, E } = window.__bw; S.season.glow = 4; S.meta.discovered.types.polisher = 1; });
  await click(p, '#dock [data-arg="build"]');
  await wait(300);
  check("Build lists the contraptions", (await p.$$("#panelBody .tcard")).length >= 3);
  await click(p, '#panelBody .tcard[data-arg="polisher"]');
  const spot = await ev(p, () => {
    const { B, render } = window.__bw;
    for (let y = 1; y < 9; y++) for (let x = 1; x < 9; x++) if (!B.whyNot("polisher", x, y)) { const [sx, sy] = render.toScreen(x + 0.5, y + 0.5, 0.2); return { x, y, sx, sy }; }
    return null;
  });
  await p.touchscreen.tap(spot.sx, spot.sy);
  await wait(200);
  check("a tap places the Polisher", await ev(p, (s) => { const c = window.__bw.B.copyAt(s.x, s.y); return !!c && c.type === "polisher"; }, spot));
  await click(p, "#placeDone");
  await p.touchscreen.tap(spot.sx, spot.sy);
  await wait(300);
  check("tapping a copy shows its card", await p.isVisible("#card") && (await p.textContent("#card")).includes("Polisher"));
  // Claim the plot to the east from its card.
  await ev(p, () => { window.__bw.S.season.glow = 4; window.__bw.ui.select(null); window.__bw.ui.selectTile(14, 4); });
  await wait(200);
  await click(p, '#card [data-act="claim"]');
  check("a plot's card claims it", await ev(p, () => !!window.__bw.S.season.plots["1,0"]));

  // Every panel and every tab opens without an error.
  await ev(p, () => { const { S } = window.__bw; S.world.eclipses = 1; S.meta.everEclipsed = true; S.meta.depth = 1; S.seasonNo = 3; });
  for (const id of ["build", "levels", "workshop", "season", "goals", "tinkers", "codex", "menu"]) {
    await click(p, '#dock [data-arg="' + id + '"]');
    await wait(150);
    const tabs = await p.$$eval("#panelBody .tabs button", (bs) => bs.map((b) => b.dataset.arg));
    for (const t of tabs) { await click(p, '#panelBody .tabs button[data-arg="' + t + '"]'); await wait(80); }
    check("the " + id + " panel opens" + (tabs.length ? " with " + tabs.length + " tabs" : ""), (await p.$eval("#panelBody", (b) => b.innerHTML.length)) > 40);
    if (id === "season") await shot(p, "phone-season");
    await click(p, '#dock [data-arg="' + id + '"]');
  }
  check("the panel closes", await p.isHidden("#panel"));

  // The three resets.
  await ev(p, () => { const { S } = window.__bw; S.world.eclipses = 0; S.meta.everEclipsed = false; S.meta.depth = 0; S.season.glowSeason = 6.3; S.eclipse.glowSince = 6.3; });
  await click(p, '#dock [data-arg="season"]'); await wait(150);
  await click(p, '#panelBody .tabs button[data-arg="season:harvest"]'); await wait(100);
  p.once("dialog", (d) => d.accept());
  await click(p, '#panelBody [data-act="harvest"]'); await wait(300);
  check("Harvest pays Seeds and starts Season 4", await ev(p, () => window.__bw.S.seasonNo === 4 && window.__bw.S.eclipse.seeds > 0 && window.__bw.S.season.ghosts.length > 0));
  await ev(p, () => { const { S } = window.__bw; S.eclipse.seedsEarned = 6.2; S.world.seedsSince = 6.2; });
  await wait(1200);
  p.once("dialog", (d) => d.accept());
  await click(p, '#panelBody [data-act="eclipse"]');
  await ev(p, () => window.__bw.game.advance(31));
  await wait(300);
  check("an Eclipse (after its 30 s show) pays Stars", await ev(p, () => window.__bw.S.world.eclipses === 1 && window.__bw.E.starsTotal() >= 3));
  await click(p, '#panelBody .tabs button[data-arg="season:sky"]'); await wait(200);
  await click(p, 'svg.sky circle[data-arg="lantern:0"]');
  check("a Star goes on the Sky", await ev(p, () => !!window.__bw.S.world.sky["lantern:0"]));
  await click(p, '#dock [data-arg="season"]');

  // Zen Mode hides everything; a tap brings it back.
  await click(p, '[data-act="zen"]'); await wait(200);
  check("Zen Mode hides the interface", await p.isHidden("#dock"));
  await p.touchscreen.tap(200, 400); await wait(200);
  check("a tap leaves Zen Mode", await p.isVisible("#dock"));

  // Save, reload, and come back an hour later.
  const before = await ev(p, () => { const { S, save } = window.__bw; save.save(); return { n: S.season.copies.length + S.season.ghosts.length, season: S.seasonNo }; });
  // Leaving the page saves again, so the hour is taken off on the way back in.
  await p.addInitScript(() => { try { const k = "bloomworks-save-v1"; const o = JSON.parse(localStorage.getItem(k)); if (o && !sessionStorage.getItem("aged")) { sessionStorage.setItem("aged", "1"); o.savedAt -= 3600 * 1000; o.lastPerSec = 1; localStorage.setItem(k, JSON.stringify(o)); } } catch (e) { /* no save yet */ } });
  await p.reload();
  await p.waitForFunction(() => window.__bw && window.__bw.S && window.__bw.S.season);
  await wait(800);
  check("the save survives a reload", await ev(p, (b) => { const { S } = window.__bw; return S.seasonNo === b.season && S.season.copies.length + S.season.ghosts.length === b.n; }, before));
  check("an hour away comes back as a Logbook", await p.isVisible("#logbook") && (await p.textContent("#logBody")).includes("Glow earned"));
  await shot(p, "phone-logbook");
  await ctx.close();

  process.stdout.write("\nA computer\n");
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 760 } });
  const d = await ctx2.newPage();
  watch(d);
  await d.goto(url);
  await d.waitForFunction(() => window.__bw && window.__bw.S && window.__bw.S.season);
  await wait(600);
  await d.click("#info-close");
  const z0 = await ev(d, () => window.__bw.render.cam.z);
  await d.mouse.move(640, 380); await d.mouse.wheel(0, -400); await wait(100);
  check("the wheel zooms", (await ev(d, () => window.__bw.render.cam.z)) > z0);
  const x0 = await ev(d, () => window.__bw.render.cam.x);
  await d.mouse.move(640, 380); await d.mouse.down(); await d.mouse.move(440, 380, { steps: 6 }); await d.mouse.up(); await wait(100);
  check("a drag pans", (await ev(d, () => window.__bw.render.cam.x)) > x0 + 1);
  await ev(d, () => window.__bw.game.advance(60));
  await wait(500);
  await shot(d, "desktop");
  await ctx2.close();

  check("no errors in the console", !errors.length, errors.slice(0, 5).join(" | "));
  await browser.close();
  server.close();
  process.stdout.write("\n" + (failures.length ? failures.length + " of " + checks + " checks FAILED:\n  " + failures.join("\n  ") : checks + "/" + checks + " checks passed") + "\n");
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); try { server.close(); } catch (x) { /* already closed */ } process.exit(1); });
