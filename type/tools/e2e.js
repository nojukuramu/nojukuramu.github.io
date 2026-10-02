#!/usr/bin/env node
/* ============================================================
   Type — played in a real browser
   `node tools/e2e.js [--shots <dir>]`

   The shape is Hacks' tools/e2e.js: serve the folder, open it in Chromium,
   use it the way a person would, and fail on anything a person would notice,
   including any error in the console.

   What it covers:
     - nothing is clicked to start typing: after picking a category with the
       mouse, the keyboard goes straight into the challenge
     - each face (text, terminal, code, keys) typed through to its result,
       newlines and all, and the result's numbers make sense
     - a mistake shows in red, stays until fixed, and backspace repairs it
     - Esc deals a new challenge, Tab replays the same one, Enter after a
       result goes on, Alt+number changes category
     - Mixed never deals random keys
     - the rare conversation (forced with ?convo): phantom lines are typed,
       the room answers, and the result arrives after the last line
     - paste is refused
     - a phone-sized screen has no horizontal scroll
     - the interface itself, on a desktop and a phone, mid-typing and at the
       result: the caret is on screen, wrapped lines do not start with a stray
       space, the result card is fully in view, the pending text is readable
       against the page, the sheet opens and hands the keyboard back, the
       update bar and the "click to carry on" hint appear and clear

   Skipped (not failed) where Playwright is not installed.
   ============================================================ */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

let chromium;
for (const where of ["playwright", "playwright-core", path.join(path.dirname(process.execPath), "..", "lib", "node_modules", "playwright")]) {
  try { chromium = require(where).chromium; break; } catch (e) { /* try the next */ }
}
if (!chromium) { console.log("Playwright is not installed; skipping the browser tests."); process.exit(0); }

const ROOT = path.join(__dirname, "..", "..");
const shotsDir = process.argv.includes("--shots") ? process.argv[process.argv.indexOf("--shots") + 1] : null;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };

const failures = [];
let checks = 0;
function check(name, cond, detail) {
  checks++;
  if (cond) process.stdout.write("  \u2713 " + name + "\n");
  else { failures.push(name + (detail ? " — " + detail : "")); process.stdout.write("  \u2717 " + name + (detail ? " — " + detail : "") + "\n"); }
}
function section(t) { process.stdout.write("\n" + t + "\n"); }

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
  const base = "http://127.0.0.1:" + server.address().port + "/type/";
  const browser = await chromium.launch({ executablePath: fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined });
  const errors = [];

  async function open(query, viewport) {
    const ctx = await browser.newContext({ viewport: viewport || { width: 1100, height: 760 } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await page.addInitScript(() => { try { localStorage.setItem("type:debug", "1"); } catch (e) {} });
    await page.goto(base + (query || ""));
    await page.waitForSelector("#stage[data-state]");
    return page;
  }
  const state = (page) => page.evaluate(() => ({ kind: document.getElementById("stage").dataset.kind, st: document.getElementById("stage").dataset.state, target: window.TY_DEBUG.S.target, typed: window.TY_DEBUG.S.typed, cat: window.TY_DEBUG.S.cat, id: window.TY_DEBUG.S.ch.id, resultHidden: document.getElementById("result").hidden }));

  try {
    section("Typing without clicking");
    {
      const page = await open("?seed=e2e1");
      await page.click('[data-cat="text"]');          // the mouse goes to the toolbar...
      const s0 = await state(page);
      await page.keyboard.type(s0.target.slice(0, 12));   // ...and the keyboard still reaches the challenge
      const s1 = await state(page);
      check("keys typed after a toolbar click reach the challenge", s1.typed === s0.target.slice(0, 12), JSON.stringify(s1.typed));
      check("the clock starts on the first key", s1.st === "typing");

      section("A mistake");
      await page.keyboard.type("#");
      const bad = await page.evaluate(() => document.querySelectorAll("#docText .c.bad").length);
      check("a wrong key shows in red", bad === 1, "bad count " + bad);
      await page.keyboard.press("Backspace");
      const fixed = await page.evaluate(() => document.querySelectorAll("#docText .c.bad").length);
      check("backspace repairs it", fixed === 0);

      section("Finishing a text");
      await page.keyboard.type(s0.target.slice(12));
      const s2 = await state(page);
      check("the whole text ends the challenge", s2.st === "done" && !s2.resultHidden);
      const r = await page.evaluate(() => ({ wpm: +document.getElementById("rWpm").textContent, acc: document.getElementById("rAcc").textContent }));
      check("the result has a speed and an accuracy under 100 after a mistake", r.wpm > 0 && parseFloat(r.acc) < 100, JSON.stringify(r));
      if (shotsDir) await page.screenshot({ path: path.join(shotsDir, "text-result.png") });

      section("Keys after a result");
      await page.keyboard.press("Enter");
      await page.waitForTimeout(450);
      await page.keyboard.press("Enter");
      const s3 = await state(page);
      check("Enter after a result deals a new challenge", s3.id !== s0.id && s3.st === "idle", s3.id + " vs " + s0.id);
      await page.keyboard.type(s3.target.slice(0, 5));
      await page.keyboard.press("Tab");
      const s4 = await state(page);
      check("Tab replays the same challenge from the start", s4.id === s3.id && s4.typed === "");
      await page.keyboard.press("Escape");
      const s5 = await state(page);
      check("Esc deals a different one", s5.id !== s4.id);
      await page.keyboard.press("Alt+3");
      const s6 = await state(page);
      check("Alt+3 switches to Terminal", s6.cat === "terminal" && s6.kind === "terminal", s6.cat);
      await page.context().close();
    }

    for (const cat of ["terminal", "code", "keys"]) {
      section("The " + cat + " face");
      const page = await open("?seed=e2e-" + cat);
      await page.click('[data-cat="' + cat + '"]');
      const s0 = await state(page);
      check("the board is the " + cat + " face", s0.kind === cat);
      const visible = await page.evaluate(() => [...document.querySelectorAll(".view")].filter((v) => !v.hidden).map((v) => v.id));
      check("only that face is showing", visible.length === 1 && visible[0] === "v-" + cat, visible.join(","));
      await page.keyboard.type(s0.target);
      const s1 = await state(page);
      check("typing it through, newlines included, finishes it", s1.st === "done" && !s1.resultHidden, s1.st + " typed " + s1.typed.length + "/" + s0.target.length);
      if (cat === "terminal") {
        const outs = await page.evaluate(() => [...document.querySelectorAll("#termBody .tline")].every((l) => l.classList.contains("done")));
        check("every line is marked done", outs);
        const prompts = await page.evaluate(() => [...document.querySelectorAll("#termBody .prompt")].map((p) => p.textContent.trim()));
        check("each line has its own prompt, which is not typed", prompts.length >= 3 && prompts.every(Boolean) && !s0.target.includes(prompts[0]), prompts.join(" | "));
      }
      if (cat === "code") {
        const gutter = await page.evaluate(() => document.querySelectorAll("#codeBody .ln").length);
        check("the editor has a line number for every line", gutter === s0.target.split("\n").length);
        check("indentation is not part of what is typed", !/^ +\S/m.test(s0.target));
      }
      if (shotsDir) await page.screenshot({ path: path.join(shotsDir, cat + "-result.png") });
      await page.context().close();
    }

    section("Mixed");
    {
      const page = await open("");
      await page.click('[data-cat="all"]');
      const kinds = new Set();
      for (let i = 0; i < 40; i++) { await page.keyboard.press("Escape"); kinds.add((await state(page)).kind); }
      check("Mixed deals text, terminal and code", kinds.has("text") && kinds.has("terminal") && kinds.has("code"), [...kinds].join(","));
      check("Mixed never deals random keys", !kinds.has("keys"));
      await page.context().close();
    }

    section("The rare conversation");
    {
      const page = await open("?convo&seed=e2e-convo");
      await page.click('[data-cat="text"]');
      await page.waitForSelector("#v-convo:not([hidden])");
      let turns = 0;
      for (let guard = 0; guard < 12; guard++) {
        await page.waitForFunction(() => window.TY_DEBUG.S.target || !document.getElementById("result").hidden, null, { timeout: 15000 });
        if (!(await state(page)).resultHidden) break;
        const t = await state(page);
        const ghost = await page.evaluate(() => document.querySelectorAll("#chatInput .c").length);
        if (!ghost) break;
        await page.keyboard.type(t.target);
        turns++;
        await page.waitForTimeout(150);
      }
      await page.waitForSelector("#result:not([hidden])", { timeout: 15000 });
      const msgs = await page.evaluate(() => ({ me: document.querySelectorAll("#chatBody .msg.me").length, them: document.querySelectorAll("#chatBody .msg.them:not(.typing)").length }));
      check("the player's lines went into the chat", msgs.me === turns && turns >= 2, JSON.stringify(msgs));
      check("the room answered", msgs.them >= 3, JSON.stringify(msgs));
      const w = await page.evaluate(() => +document.getElementById("rWpm").textContent);
      check("the speed counts typing only, not the room's pauses", w > 40, "wpm " + w);
      if (shotsDir) await page.screenshot({ path: path.join(shotsDir, "convo-result.png") });
      await page.context().close();
    }

    section("Paste is refused");
    {
      const page = await open("?seed=e2e-paste");
      await page.click('[data-cat="text"]');
      const prevented = await page.evaluate(() => {
        const ev = new Event("paste", { bubbles: true, cancelable: true });
        document.getElementById("cap").dispatchEvent(ev);
        return ev.defaultPrevented;
      });
      check("the paste event is cancelled", prevented);
      await page.context().close();
    }

    section("A phone");
    {
      const page = await open("?seed=e2e-phone", { width: 390, height: 780 });
      for (const cat of ["text", "terminal", "code", "keys"]) {
        await page.click('[data-cat="' + cat + '"]');
        const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        check(cat + " has no sideways scroll at 390px", over <= 0, "overflow " + over);
      }
      if (shotsDir) await page.screenshot({ path: path.join(shotsDir, "phone.png") });
      await page.context().close();
    }

    section("The interface");
    for (const [dev, vp] of [["desktop", { width: 1100, height: 760 }], ["phone", { width: 390, height: 780 }]]) {
      const page = await open("?seed=ui-" + dev, vp);
      await page.click('[data-cat="text"]');
      // pending text must be readable: at least 3:1 against the page, the usual floor for large text
      const contrast = await page.evaluate(() => {
        const lum = (c) => { const m = c.match(/[\d.]+/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
        const el = document.querySelector("#docText .c:not(.ok)");
        const a = lum(getComputedStyle(el).color), b = lum(getComputedStyle(document.body).backgroundColor);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      });
      check(dev + ": untyped text is readable against the page (" + contrast.toFixed(1) + ":1)", contrast >= 3);
      for (const cat of ["text", "terminal", "code", "keys"]) {
        await page.click('[data-cat="' + cat + '"]');
        await page.waitForTimeout(350); // the face fades in; measure it settled
        const t = (await state(page)).target;
        await page.keyboard.type(t.slice(0, Math.floor(t.length * 0.6)));
        const at = Math.floor(t.length * 0.6);
        await page.keyboard.type(t[at] === "~" ? "`" : "~"); // a key that is certainly wrong here
        const mid = await page.evaluate((cat) => {
          const cur = document.querySelector(".view:not([hidden]) .c.cur");
          if (!cur) return { cur: false };
          const r = cur.getBoundingClientRect(), vw = innerWidth, vh = innerHeight;
          const box = cur.closest(".body");
          const br = box ? box.getBoundingClientRect() : null;
          // a space that starts a line sits at the container's left edge, which is where the first letter of any line is
          const sps = [...document.querySelectorAll(".view:not([hidden]) .c.sp")];
          const words = [...document.querySelectorAll(".view:not([hidden]) .w")];
          const edge = words.length ? Math.min.apply(null, words.map((w) => w.getBoundingClientRect().left)) : 0;
          const stray = sps.filter((sp) => sp.getBoundingClientRect().left <= edge + 1).length;
          return { cur: true, onScreen: r.left >= 0 && r.right <= vw + 1 && r.top >= 0 && r.bottom <= vh, inBox: !br || (r.left >= br.left - 1 && r.right <= br.right + 1 && r.top >= br.top - 1 && r.bottom <= br.bottom + 1), stray, bad: document.querySelectorAll(".view:not([hidden]) .c.bad").length };
        }, cat);
        check(dev + " " + cat + ": the caret is on screen and inside its window mid-typing", mid.cur && mid.onScreen && mid.inBox, JSON.stringify(mid));
        check(dev + " " + cat + ": the mistake is marked", mid.bad === 1, "bad " + mid.bad);
        check(dev + " " + cat + ": no wrapped line starts with a stray space", mid.stray === 0, mid.stray + " spaces");
        await page.keyboard.press("Backspace");
        await page.keyboard.type(t.slice(Math.floor(t.length * 0.6)));
        await page.waitForTimeout(150);
        const res = await page.evaluate(() => {
          const r = document.getElementById("result").getBoundingClientRect();
          return { shown: !document.getElementById("result").hidden, top: r.top, bottom: r.bottom, vh: innerHeight, over: document.documentElement.scrollWidth - document.documentElement.clientWidth };
        });
        check(dev + " " + cat + ": the result card is fully in view", res.shown && res.top >= 0 && res.bottom <= res.vh + 1, JSON.stringify(res));
        check(dev + " " + cat + ": the result state has no sideways scroll", res.over <= 0, "overflow " + res.over);
        if (shotsDir) await page.screenshot({ path: path.join(shotsDir, "ui-" + dev + "-" + cat + ".png") });
      }
      // the sheet takes the keyboard while it is open and hands it back
      await page.keyboard.press("Escape");
      const before = (await state(page)).id;
      await page.click('[data-info="categories"]');
      check(dev + ": the (i) opens its sheet", await page.evaluate(() => !document.getElementById("info-sheet").hidden));
      await page.keyboard.press("Escape");
      const after = await state(page);
      check(dev + ": Esc closes the sheet and does not also deal a new challenge", await page.evaluate(() => document.getElementById("info-sheet").hidden) && after.id === before);
      await page.keyboard.type(after.target.slice(0, 3));
      check(dev + ": typing carries on straight after the sheet closes", (await state(page)).typed === after.target.slice(0, 3));
      // the update bar sits clear of the toolbar's controls and can be dismissed
      await page.evaluate(() => { document.getElementById("update-bar").hidden = false; });
      const bar = await page.evaluate(() => { const r = document.getElementById("update-bar").getBoundingClientRect(); return { l: r.left, r: r.right, vw: innerWidth }; });
      check(dev + ": the update bar fits on screen", bar.l >= 0 && bar.r <= bar.vw + 1, JSON.stringify(bar));
      await page.evaluate(() => { document.getElementById("update-bar").hidden = true; });
      // losing focus says so, and any key brings it back
      await page.evaluate(() => document.getElementById("cap").blur());
      await page.waitForTimeout(250);
      check(dev + ": the focus hint appears when the box loses focus", await page.evaluate(() => !document.getElementById("focusHint").hidden));
      await page.keyboard.type("x");
      await page.waitForTimeout(100);
      check(dev + ": a key press hides it and is not lost", await page.evaluate(() => document.getElementById("focusHint").hidden && document.activeElement === document.getElementById("cap")));
      await page.context().close();
    }

    section("The console");
    check("no errors on any page", errors.length === 0, errors.slice(0, 4).join(" | "));
  } catch (e) {
    failures.push("crashed: " + (e && e.stack || e));
    console.log("crashed:", e && e.stack || e);
  }
  await browser.close();
  server.close();
  console.log("\n" + (failures.length ? "FAILED — " + failures.length + " of " + checks + " checks\n" + failures.map((f) => "  - " + f).join("\n") : "PASSED — " + checks + "/" + checks + " checks"));
  process.exit(failures.length ? 1 : 0);
});
