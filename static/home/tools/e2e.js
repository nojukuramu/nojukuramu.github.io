#!/usr/bin/env node
/* ============================================================
   The homepage — in a real browser
   `node static/home/tools/e2e.js [--shots <dir>]` from the repository root.

   The shape is Type's and Hacks' tools/e2e.js: serve the repository, open
   the page in Chromium, use it the way a person would, and fail on
   anything a person would notice, including any error in the console.

   What it covers:
     - the intro opens on its own and gets out of the way
     - the page scrolls at all (an overflow on body once stopped it dead,
       and a class shared between <html> and the intro once hid the lot)
     - every detent of the wheel shows its own project — name, link, the
       engraving under the index, the frame counter — and halfway between
       two the iris is shut
     - left between two frames, the page settles on the nearer one
     - the arrow keys, the step buttons and the dial's engravings turn it
     - the contact sheet holds every project, and its filters filter
     - the film chip changes the film, and the palette finds things
     - a link to #roll, or to #work from the old page, lands where it says
     - no horizontal scroll at eleven widths, top to bottom, with main's
       clip taken off so nothing is masked
     - with reduced motion there is no intro, and the wheel still turns
     - without scripts the page is still a readable column
     - the 404 page draws its iris without an error

   Fonts are not fetched: the page must work without them, and the run
   must not depend on a network.

   Skipped (not failed) where Playwright is not installed.
   ============================================================ */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let chromium;
for (const where of ["playwright", "playwright-core", path.join(path.dirname(process.execPath), "..", "lib", "node_modules", "playwright")]) {
  try { chromium = require(where).chromium; break; } catch (e) { /* try the next */ }
}
if (!chromium) { console.log("Playwright is not installed; skipping the browser tests."); process.exit(0); }

const ROOT = path.join(__dirname, "..", "..", "..");
const shotsDir = process.argv.includes("--shots") ? process.argv[process.argv.indexOf("--shots") + 1] : null;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };

const failures = [];
let checks = 0;
function check(name, cond, detail) {
  checks++;
  if (cond) process.stdout.write("  ✓ " + name + "\n");
  else { failures.push(name + (detail ? " — " + detail : "")); process.stdout.write("  ✗ " + name + (detail ? " — " + detail : "") + "\n"); }
}
function section(t) { process.stdout.write("\n" + t + "\n"); }

/* the list, read the way the validator reads it */
const P = (function () {
  const win = {};
  win.window = win;
  vm.runInContext(fs.readFileSync(path.join(ROOT, "static/home/js/projects.js"), "utf8"), vm.createContext({ window: win }));
  return win.NJ.projects;
})();
const N = P.projects.length;

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p.endsWith("/")) p += "index.html";
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" });
    res.end(d);
  });
});

server.listen(0, async () => {
  const base = "http://127.0.0.1:" + server.address().port + "/";
  const browser = await chromium.launch({ executablePath: fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined });
  const errors = [];

  async function open(opts) {
    opts = opts || {};
    const ctx = await browser.newContext({
      viewport: opts.viewport || { width: 1440, height: 900 },
      reducedMotion: opts.reduced ? "reduce" : "no-preference",
      javaScriptEnabled: opts.noScript ? false : true,
      hasTouch: !!opts.touch, isMobile: !!opts.touch
    });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      /* the fonts are refused on purpose, below */
      if (/ERR_FAILED|fonts\.g/.test(m.text() + (m.location().url || ""))) return;
      errors.push(m.text());
    });
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await page.goto(base + (opts.path || ""));
    return page;
  }
  const settle = (page, ms) => page.waitForTimeout(ms || 900);
  const frame = (page) => page.evaluate(() => ({
    name: document.getElementById("info-name").textContent,
    href: document.getElementById("info-open").getAttribute("href"),
    no: document.getElementById("info-no").textContent,
    hud: document.getElementById("hud-frame").textContent,
    f: document.getElementById("hud-f").textContent,
    on: [...document.querySelectorAll("#lens-marks .dl.on")].map((g) => +g.dataset.k),
    y: window.scrollY
  }));
  const scrollTo = (page, y) => page.evaluate((y) => window.scrollTo(0, y), y);
  const yOf = (page, k) => page.evaluate((k) => window.NJ.wheel.yOf(k), k);

  try {
    section("The intro");
    {
      const page = await open();
      const early = await page.evaluate(() => ({ built: document.getElementById("intro").classList.contains("built"), blades: document.querySelectorAll("#intro-iris use").length }));
      check("the intro starts behind a shut iris of nine blades", early.built && early.blades === 9, JSON.stringify(early));
      await page.waitForFunction(() => document.getElementById("intro").classList.contains("done"), null, { timeout: 4000 });
      const after = await page.evaluate(() => ({ splashed: document.documentElement.classList.contains("splashed"), vis: getComputedStyle(document.getElementById("intro")).visibility }));
      check("it opens on its own and gets out of the way", after.splashed && after.vis === "hidden", JSON.stringify(after));

      section("The page scrolls");
      const dims = await page.evaluate(() => ({ h: document.documentElement.scrollHeight, vh: innerHeight }));
      check("the document is many screens tall", dims.h > dims.vh * 10, dims.h + " on a " + dims.vh + " window");
      await scrollTo(page, 600);
      await page.waitForTimeout(100);
      check("and scrolling it moves it", (await page.evaluate(() => window.scrollY)) === 600);
      await scrollTo(page, 0);

      section("The wheel");
      for (const k of [0, 1, 4, 9, N - 1]) {
        await scrollTo(page, await yOf(page, k));
        await settle(page);
        const s = await frame(page);
        const p = P.projects[k];
        const pad = (k < 9 ? "0" : "") + (k + 1);
        check("detent " + (k + 1) + " shows " + p.name, s.name === p.name && s.href === p.href && s.no === pad && s.hud === pad &&
              s.on.length === 1 && s.on[0] === k, JSON.stringify(s));
        if (shotsDir && (k === 0 || k === 4)) await page.screenshot({ path: path.join(shotsDir, "wheel-" + pad + ".png") });
      }

      /* halfway between two frames, with the settling held off */
      await page.evaluate(() => { window.__glide = window.NJ.glide; window.NJ.glide = null; });
      const a = await yOf(page, 2), b = await yOf(page, 3);
      await scrollTo(page, (a + b) / 2);
      await settle(page);
      const mid = await frame(page);
      check("halfway between two frames the iris is shut", mid.f === "F22", mid.f);
      await page.evaluate(() => { window.NJ.glide = window.__glide; });

      await scrollTo(page, a + (b - a) * 0.4);
      await settle(page, 1400);
      const s1 = await frame(page);
      check("left at 40% of the way, it settles back on the nearer frame", Math.abs(s1.y - a) < 3 && s1.name === P.projects[2].name, s1.y + " vs " + a);
      await scrollTo(page, a + (b - a) * 0.66);
      await settle(page, 1400);
      const s2 = await frame(page);
      check("left at 66%, it settles forward", Math.abs(s2.y - b) < 3 && s2.name === P.projects[3].name, s2.y + " vs " + b);

      await page.keyboard.press("ArrowRight");
      await settle(page, 1100);
      check("the right arrow turns it one frame on", (await frame(page)).name === P.projects[4].name);
      await page.keyboard.press("ArrowLeft");
      await settle(page, 1100);
      check("the left arrow turns it back", (await frame(page)).name === P.projects[3].name);
      await page.click("#wheel-next");
      await settle(page, 1100);
      check("the next button turns it on", (await frame(page)).name === P.projects[4].name);
      await page.click("#wheel-prev");
      await settle(page, 1100);
      check("the previous button turns it back", (await frame(page)).name === P.projects[3].name);

      /* a click on an engraving: the one two places clockwise of the index */
      const box = await page.evaluate(() => { const r = document.getElementById("lens").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2 }; });
      const ang = (-90 + 2 * 360 / N) * Math.PI / 180, rr = box.r * 0.84;
      await page.mouse.click(box.x + Math.cos(ang) * rr, box.y + Math.sin(ang) * rr);
      await settle(page, 1300);
      check("a click on an engraving turns the dial to it", (await frame(page)).name === P.projects[5].name, (await frame(page)).name);

      section("The film");
      const f0 = await page.evaluate(() => document.documentElement.dataset.film);
      await page.click("#film-btn");
      const f1 = await page.evaluate(() => ({ id: document.documentElement.dataset.film, filter: getComputedStyle(document.getElementById("lens-photo")).filter, hud: document.getElementById("hud-film").textContent }));
      check("the film chip winds on to another film", f1.id !== f0 && f1.filter !== "none", JSON.stringify(f1));
      check("and the viewfinder says which", f1.hud === (await page.evaluate(() => document.getElementById("film-name").textContent.toUpperCase())));

      section("The contact sheet");
      const sheet = await page.evaluate(() => [...document.querySelectorAll("#sheet .frame-link")].map((a) => a.getAttribute("href")));
      check("it holds every project, in order", sheet.length === N && sheet.every((h, i) => h === P.projects[i].href), sheet.length + " frames");
      await page.evaluate(() => document.getElementById("roll").scrollIntoView());
      const games = P.projects.filter((p) => p.kind === "games").length;
      await page.click('[data-filter="games"]');
      const shown = await page.evaluate(() => [...document.querySelectorAll("#sheet .frame")].filter((li) => !li.hidden).length);
      check("the Games filter leaves the " + games + " games", shown === games, shown + " shown");
      await page.click('[data-filter="all"]');
      await page.waitForTimeout(2600);
      const dev = await page.evaluate(() => document.querySelectorAll("#sheet .frame.developed").length);
      check("the frames in view have developed", dev >= 3, dev + " developed");
      if (shotsDir) await page.screenshot({ path: path.join(shotsDir, "sheet.png") });

      section("The palette");
      await page.keyboard.press("/");
      await page.waitForTimeout(80);
      await page.keyboard.type("karaoke");
      const items = await page.evaluate(() => [...document.querySelectorAll("#palette-list li")].map((li) => li.textContent));
      check("/ opens it, and it finds a project by its tags", !(await page.evaluate(() => document.getElementById("palette").hidden)) &&
            items.some((t) => /KaraokeNatin/.test(t)), items.join(" | "));
      await page.keyboard.press("Escape");
      check("Esc closes it", await page.evaluate(() => document.getElementById("palette").hidden));

      section("Rewinding");
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(300);
      await page.click("#rewind");
      await page.waitForTimeout(3300);
      check("rewind goes all the way back to the top", (await page.evaluate(() => window.scrollY)) === 0);
      await page.context().close();
    }

    section("Links into the page");
    {
      const page = await open({ path: "#roll" });
      await page.waitForTimeout(700);
      const off = await page.evaluate(() => Math.round(document.getElementById("roll").getBoundingClientRect().top));
      check("#roll lands on the contact sheet", Math.abs(off) < 4, off + "px off");
      await page.context().close();
      const old = await open({ path: "#work" });
      await old.waitForTimeout(900);
      const w = await old.evaluate(() => ({ y: window.scrollY, want: window.NJ.wheel.yOf(0) }));
      check("#work, from before the page was a camera, lands on the first frame", Math.abs(w.y - w.want) < 4, JSON.stringify(w));
      await old.context().close();
    }

    section("No sideways scroll");
    {
      const widths = [320, 360, 390, 414, 600, 768, 820, 1024, 1280, 1440, 1920];
      const bad = [];
      for (const w of widths) {
        const page = await open({ viewport: { width: w, height: w < 700 ? 780 : 900 }, touch: w < 700 });
        await page.addStyleTag({ content: "main{ overflow-x:visible !important; }" });
        await page.waitForTimeout(400);
        const stops = await page.evaluate(() => {
          const h = document.documentElement.scrollHeight;
          return [0, window.NJ.wheel.yOf(0), window.NJ.wheel.yOf(7), h * 0.62, h * 0.8, h];
        });
        for (const y of stops) {
          await scrollTo(page, y);
          await page.waitForTimeout(120);
          const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
          if (o.sw > o.w) bad.push(w + "px at y=" + Math.round(y) + " (" + o.sw + ")");
        }
        await page.context().close();
      }
      check("none at " + widths.length + " widths, top to bottom", bad.length === 0, bad.slice(0, 6).join(", "));
    }

    section("Reduced motion");
    {
      const page = await open({ reduced: true });
      await page.waitForTimeout(200);
      check("there is no intro", await page.evaluate(() => document.getElementById("intro").classList.contains("done")));
      await scrollTo(page, await yOf(page, 6));
      await settle(page, 500);
      check("the wheel still turns with the scroll", (await frame(page)).name === P.projects[6].name);
      await page.context().close();
    }

    section("Without scripts");
    {
      const page = await open({ noScript: true, viewport: { width: 390, height: 780 } });
      const r = await page.evaluate(() => ({
        h1: getComputedStyle(document.querySelector(".hero-title")).visibility,
        hero: getComputedStyle(document.getElementById("hero")).opacity,
        intro: getComputedStyle(document.getElementById("intro")).display,
        sw: document.documentElement.scrollWidth, w: innerWidth
      }));
      check("the hero reads, with no sideways scroll", r.h1 === "visible" && r.hero === "1" && r.sw <= r.w, JSON.stringify(r));
      await page.waitForTimeout(5400);
      check("and the intro's black clears on its own", (await page.evaluate(() => getComputedStyle(document.getElementById("intro")).visibility)) === "hidden");
      await page.context().close();
    }

    section("The 404 page");
    {
      const page = await open({ path: "404.html" });
      await page.waitForTimeout(300);
      check("it draws its iris", (await page.evaluate(() => document.querySelectorAll("#lost-iris use").length)) === 9);
      await page.context().close();
    }

    section("The console");
    check("no errors on any page", errors.length === 0, errors.slice(0, 4).join(" | "));
  } catch (e) {
    failures.push("crashed: " + (e && e.stack || e));
    console.log(e);
  }

  await browser.close();
  server.close();
  process.stdout.write("\n" + (failures.length ? "FAILED" : "PASSED") + " — " + (checks - failures.length) + "/" + checks + " checks\n");
  if (failures.length) failures.forEach((f) => process.stdout.write("  - " + f + "\n"));
  process.exit(failures.length ? 1 : 0);
});
