#!/usr/bin/env node
/* ============================================================
   Aeons — the game, played in a real browser
   `node tools/e2e.js [--shots <dir>]`

   The shape is Hacks' tools/e2e.js: serve the folder, open it in Chromium,
   play it the way a person would, and fail on anything a person would
   notice — including any error in the console.

   What it covers, on a phone held sideways (touch):
     - the title, a new realm, the HUD
     - tapping a worker and a tree; the build menu; placing a house and
       confirming it; training a worker at the hall
     - taking a champion in hand: the stick walks it, a skill casts, letting go
     - every panel opens: the realm, intel, automation, the codex, the menu,
       settings; a save to a slot, leaving to the title, loading it back
   On a phone held upright with Force landscape on: the game is turned, and a
   tap still lands on what is under the finger.
   On a computer: a box drawn with the mouse, a right-click order, a hotkey.
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
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json", ".json": "application/json" };
const failures = [];
let checks = 0;
function check(name, cond, detail) { checks++; if (cond) process.stdout.write("  \u2713 " + name + "\n"); else { failures.push(name + (detail ? " — " + detail : "")); process.stdout.write("  \u2717 " + name + (detail ? " — " + detail : "") + "\n"); } }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split("?")[0]);
      if (p.endsWith("/")) p += "index.html";
      const f = path.join(ROOT, p);
      if (!f.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
      fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" }); res.end(d); });
    });
    srv.listen(0, "127.0.0.1", () => resolve(srv));
  });
}

async function open(browser, base, ctxOpts) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem("aeons:debug", "1"); } catch (e) {} });
  await page.goto(base);
  await page.waitForFunction(() => !!window.AE_DEBUG);
  return { ctx, page, errors };
}
const shot = async (page, name) => { if (shotsAt) { fs.mkdirSync(shotsAt, { recursive: true }); await page.screenshot({ path: path.join(shotsAt, name + ".png") }); } };
/** Where a world point is on the screen, in page coordinates — turned or not. */
async function screenOf(page, x, y) {
  return page.evaluate(([x, y]) => {
    const D = window.AE_DEBUG, s = D.render.toScreen(x, y);
    if (!document.body.classList.contains("turned")) return s;
    return { x: window.innerWidth - s.y, y: s.x };
  }, [x, y]);
}
async function centreOf(page, sel) {
  const b = await page.locator(sel).first().boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

(async () => {
  const srv = await serve();
  const base = "http://127.0.0.1:" + srv.address().port + "/";
  const browser = await chromium.launch({ args: ["--no-sandbox"] });

  /* ---------------- a phone, sideways ---------------- */
  process.stdout.write("\nA phone held sideways\n");
  {
    const { page, errors, ctx } = await open(browser, base, { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    check("the title is up", await page.locator("#title").isVisible());
    await page.locator("[data-t=new]").tap();
    await page.locator("[data-t=begin]").tap();
    await page.waitForFunction(() => window.AE_DEBUG.G.mode === "play");
    await wait(600);
    check("a realm begins with the HUD up", await page.locator("#top").isVisible() && !(await page.locator("#title").isVisible()));
    await shot(page, "phone-start");

    const w = await page.evaluate(() => { const u = window.AE_DEBUG.G.units.find((u) => u.line === "worker"); return { id: u.id, x: u.x, y: u.y - 8 }; });
    let p = await screenOf(page, w.x, w.y);
    await page.touchscreen.tap(p.x, p.y);
    await wait(300);
    check("tapping a worker selects it", await page.evaluate((id) => window.AE_DEBUG.G.sel[0] === id, w.id));
    check("its name is in the panel", /Gatherer/.test(await page.locator("#selPanel").innerText()));

    // the build menu, a house, and a place for it
    await page.locator('#card .cmd[aria-label="Build"]').tap();
    await wait(200);
    await page.locator('#card .cmd[aria-label="Hut"]').tap();
    await wait(200);
    check("choosing a building starts placing it, with a confirm bar", await page.locator("#placeBar").isVisible());
    const spot = await page.evaluate(async () => { const a = await import("./js/auto.js"); const D = window.AE_DEBUG, h = D.G.blds.find((b) => b.type === "hall"); const s = a.findSpot("house", h); return { x: (s.tx + 1) * 32, y: (s.ty + 1) * 32 }; });
    p = await screenOf(page, spot.x, spot.y);
    await page.touchscreen.tap(p.x, p.y);
    await wait(200);
    await page.locator("#placeOk").tap();
    await wait(300);
    check("confirming lays a foundation the worker goes to raise", await page.evaluate(() => window.AE_DEBUG.G.blds.some((b) => b.type === "house" && b.team === 0) && window.AE_DEBUG.G.units.some((u) => u.order.t === "build")));
    check("and the bar goes away", !(await page.locator("#placeBar").isVisible()));

    // the hall trains a worker
    const hall = await page.evaluate(() => { const h = window.AE_DEBUG.G.blds.find((b) => b.type === "hall"); return { x: h.x, y: h.y }; });
    p = await screenOf(page, hall.x, hall.y);
    await page.touchscreen.tap(p.x, p.y);
    await wait(300);
    await page.locator("#card .cmd").first().tap();
    await wait(200);
    check("the hall queues a worker", await page.evaluate(() => window.AE_DEBUG.G.blds.find((b) => b.type === "hall").q.length === 1));
    await shot(page, "phone-hall");

    // a champion, in hand
    const hb = await centreOf(page, "#heroBar .hero");
    await page.touchscreen.tap(hb.x, hb.y);
    await wait(60);
    await page.touchscreen.tap(hb.x, hb.y);
    await wait(300);
    check("double-tapping a champion takes control", await page.locator("#manualUI").isVisible());
    const before = await page.evaluate(() => { const u = window.AE_DEBUG.G.units.find((u) => u.hero); return u.x; });
    const z = await centreOf(page, "#stickZone");
    await page.evaluate(([x, y]) => {
      const el = document.getElementById("stickZone");
      const ev = (t, x, y) => el.dispatchEvent(new PointerEvent(t, { bubbles: true, pointerId: 7, pointerType: "touch", clientX: x, clientY: y }));
      ev("pointerdown", x, y); ev("pointermove", x + 40, y);
      window.__stickUp = () => ev("pointerup", x + 40, y);
    }, [z.x, z.y]);
    await wait(1200);
    await page.evaluate(() => window.__stickUp());
    const after = await page.evaluate(() => { const u = window.AE_DEBUG.G.units.find((u) => u.hero); return u.x; });
    check("the stick walks it (" + Math.round(after - before) + " px)", after - before > 40);
    await page.locator('#skillPad .sk[data-sk="1"]').tap();
    await wait(200);
    check("a skill button casts", await page.evaluate(() => window.AE_DEBUG.G.units.find((u) => u.hero).skcd[1] > 0));
    await shot(page, "phone-manual");
    await page.locator("#mRelease").tap();
    await wait(200);
    check("and it can be let go", !(await page.locator("#manualUI").isVisible()));

    // panels
    for (const [btn, word] of [["#phaseChip", "long road"], ["#btnIntel", "Alarms"], ["#btnAuto", "Foremen"], ["#btnCodex", "Fire"], ["#btnMenu", "Settings"]]) {
      await page.locator(btn).tap();
      await wait(250);
      const txt = await page.locator("#panelBody").innerText();
      check("the " + btn.slice(1) + " panel opens with what it should hold", await page.locator("#panel").isVisible() && txt.toLowerCase().includes(word.toLowerCase()), txt.slice(0, 80));
      if (btn !== "#btnMenu") await page.locator("#panelClose").tap();
      await wait(150);
    }
    await page.locator("[data-go=settings]").tap();
    await wait(200);
    check("settings has Force landscape on by default", await page.locator('[data-set="s:forceLandscape"]').isChecked());
    await page.locator("#panelClose").tap();
    // save, leave, come back
    await page.locator("#btnMenu").tap(); await wait(150);
    await page.locator("[data-go=save]").tap(); await wait(500);
    await page.locator('[data-do=save][data-slot="1"]').tap(); await wait(600);
    const was = await page.evaluate(() => ({ units: window.AE_DEBUG.G.units.length, time: Math.floor(window.AE_DEBUG.G.time) }));
    await page.locator("#panelClose").tap(); await wait(150);
    await page.locator("#btnMenu").tap(); await wait(150);
    await page.locator("[data-go=quit]").tap(); await wait(800);
    check("leaving goes to the title, with Continue offered", await page.locator("#title").isVisible() && await page.locator("#btnContinue").isVisible());
    await page.locator("[data-t=load]").tap(); await wait(500);
    await page.locator('[data-do=load][data-slot="1"]').tap(); await wait(800);
    const now = await page.evaluate(() => ({ units: window.AE_DEBUG.G.units.length, time: Math.floor(window.AE_DEBUG.G.time), mode: window.AE_DEBUG.G.mode }));
    check("loading the slot brings the realm back as it was", now.mode === "play" && Math.abs(now.units - was.units) <= 1 && Math.abs(now.time - was.time) < 3, JSON.stringify([was, now]));
    check("no errors in the console", !errors.length, errors.slice(0, 3).join(" | "));
    await ctx.close();
  }

  /* ---------------- a phone, upright ---------------- */
  process.stdout.write("\nA phone held upright, Force landscape on\n");
  {
    const { page, errors, ctx } = await open(browser, base, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    check("the game is turned to play sideways", await page.evaluate(() => document.body.classList.contains("turned")));
    await page.evaluate(() => window.AE_DEBUG.emit("startGame", { diff: "normal", seedTxt: "upright" }));
    await wait(700);
    const s = await page.evaluate(() => { const D = window.AE_DEBUG; return { W: D.view.W, H: D.view.H }; });
    check("the game is wider than tall inside the turn", s.W > s.H, JSON.stringify(s));
    const w = await page.evaluate(() => { const u = window.AE_DEBUG.G.units.find((u) => u.line === "worker"); return { id: u.id, x: u.x, y: u.y - 8 }; });
    const p = await screenOf(page, w.x, w.y);
    await page.touchscreen.tap(p.x, p.y);
    await wait(300);
    check("a tap still lands on the worker under the finger", await page.evaluate((id) => window.AE_DEBUG.G.sel[0] === id, w.id));
    await shot(page, "phone-upright");
    check("no errors in the console", !errors.length, errors.slice(0, 3).join(" | "));
    await ctx.close();
  }

  /* ---------------- a computer ---------------- */
  process.stdout.write("\nA computer\n");
  {
    const { page, errors, ctx } = await open(browser, base, { viewport: { width: 1280, height: 760 } });
    check("a computer is never turned", !(await page.evaluate(() => document.body.classList.contains("turned"))));
    await page.evaluate(() => window.AE_DEBUG.emit("startGame", { diff: "calm", seedTxt: "desk" }));
    await wait(700);
    const ws = await page.evaluate(() => window.AE_DEBUG.G.units.filter((u) => u.line === "worker").map((u) => ({ x: u.x, y: u.y })));
    const xs = ws.map((u) => u.x), ys = ws.map((u) => u.y);
    const a = await screenOf(page, Math.min(...xs) - 20, Math.min(...ys) - 30), b = await screenOf(page, Math.max(...xs) + 20, Math.max(...ys) + 20);
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2); await page.mouse.move(b.x, b.y); await page.mouse.up();
    await wait(200);
    check("a box drawn with the mouse selects the workers", await page.evaluate(() => window.AE_DEBUG.G.sel.length >= 5));
    const t = await screenOf(page, ws[0].x + 200, ws[0].y + 60);
    await page.mouse.click(t.x, t.y, { button: "right" });
    await wait(200);
    check("a right-click orders them there", await page.evaluate(() => window.AE_DEBUG.G.units.filter((u) => u.line === "worker" && u.order.t === "move").length >= 5));
    await page.keyboard.press("s");
    await wait(100);
    check("S stops them", await page.evaluate(() => window.AE_DEBUG.G.units.filter((u) => u.line === "worker" && u.order.t === "idle").length >= 5));
    await page.keyboard.press("b");
    await wait(100);
    check("B opens the build menu", (await page.locator("#card .cmd").count()) > 6);
    await shot(page, "desk");
    check("no errors in the console", !errors.length, errors.slice(0, 3).join(" | "));
    await ctx.close();
  }

  await browser.close();
  srv.close();
  process.stdout.write("\n" + (checks - failures.length) + "/" + checks + " checks passed\n");
  if (failures.length) { process.stdout.write("\nFailed:\n" + failures.map((f) => "  - " + f).join("\n") + "\n"); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
