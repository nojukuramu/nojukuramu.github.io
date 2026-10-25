#!/usr/bin/env node
/* ============================================================
   Last Flame — the game, played in a real browser
   `node tools/e2e.js [--shots <dir>]`

   The shape is Ballzooka's tools/e2e.js: serve the folder, open it in
   Chromium (WebGL through SwiftShader, so it runs headless), use it the way a
   person would, and fail on anything a person would notice — including any
   error in the console. The window is small on purpose: a software GPU draws
   a frame or two a second, and the checks wait on outcomes, not frames.

   On a computer: the title is up and the house loads; Begin starts a night
   and the house is drawn, not black; W walks, F turns the wick down and up;
   holding E at a lamp lights it; E at a closet hides you and E again lets
   you out; Escape pauses and Settings change and stick — the Original
   textures arrive when chosen and Low shrinks them, Unrestrained draws
   with multisampled edges; being caught under
   Lola's Rules wakes you by the lamp; at the fifth lamp the house turns and
   the dead rise out of the lamps; the front door at the end is the way out
   and the night ends on its screen. On a phone held sideways: the touch
   controls are there, the stick walks, and the hand button hides you.
   ============================================================ */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

let chromium;
for (const where of ["playwright", "/opt/node22/lib/node_modules/playwright", "/opt/node-tools/node_modules/playwright", "playwright-core"]) {
  try { ({ chromium } = require(where)); break; } catch (e) { /* next */ }
}
if (!chromium) { console.log("playwright is not installed here; skipping the browser pass."); process.exit(0); }

const ROOT = path.join(__dirname, "..");
const shotsAt = process.argv.indexOf("--shots") > 0 ? process.argv[process.argv.indexOf("--shots") + 1] : null;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".glb": "model/gltf-binary", ".mp3": "audio/mpeg", ".webmanifest": "application/manifest+json" };
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

/* Wait until a condition in the page holds, or give up. */
async function until(p, fn, arg, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 30000)) {
    if (await p.evaluate(fn, arg).catch(() => false)) return true;
    await wait(150);
  }
  return false;
}
/* Average brightness of the 3D canvas, drawn and read in one task. */
const brightness = (p) => p.evaluate(() => {
  const lf = window.__lf, c = document.getElementById("view");
  // past the fade in from black that every night opens with
  for (let i = 0; i < 4; i++) lf.render.draw(lf.g, 0.5, {});
  const s = document.createElement("canvas"); s.width = 64; s.height = 36;
  const x = s.getContext("2d"); x.drawImage(c, 0, 0, 64, 36);
  const d = x.getImageData(0, 0, 64, 36).data; let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
  return sum / (d.length / 4) / 3;
});
/* Stand in front of something, facing it. */
const standAt = (p, at, look) => p.evaluate(([at, look]) => {
  const lf = window.__lf, pl = lf.g.player;
  pl.x = at.x; pl.z = at.z;
  const yaw = Math.atan2(look.x - at.x, look.z - at.z);
  lf.input.setLook(yaw, 0); pl.yaw = yaw;
}, [at, look]);

(async () => {
  await new Promise((res) => server.listen(0, res));
  const url = "http://localhost:" + server.address().port + "/";
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
  const errors = [];
  const watch = (p) => { p.on("pageerror", (e) => errors.push(e.message)); p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); }); };
  const shot = async (p, name) => { if (shotsAt) { fs.mkdirSync(shotsAt, { recursive: true }); await p.screenshot({ path: path.join(shotsAt, name + ".png"), timeout: 60000 }).catch(() => {}); } };

  process.stdout.write("\nA computer\n");
  const ctx = await browser.newContext({ viewport: { width: 640, height: 360 } });
  const p = await ctx.newPage();
  watch(p);
  await p.goto(url);
  await p.waitForFunction(() => window.__lf && window.__lf.S);
  check("the title is up", await p.isVisible("#screen.s-title h1"));
  check("the house loads (models, surfaces)", await until(p, () => window.__lf.render.progress() >= 1, null, 60000));
  check("Begin is enabled once it has", await until(p, () => !document.querySelector('[data-act="begin"]').disabled, null, 5000));
  await p.click('[data-act="help"]');
  check("How to play opens the sheet", await p.isVisible("#info-sheet"));
  await p.click("#info-close");
  await p.evaluate(() => { const lf = window.__lf; lf.S.set.quality = "low"; lf.render.setQuality("low"); });
  await p.click('[data-act="begin"]');
  check("Begin starts a night", await until(p, () => window.__lf.g && window.__lf.g.state === "play", null, 20000));
  check("the screen goes, the night's hint comes", await until(p, () => document.getElementById("screen").hidden && document.getElementById("hint").classList.contains("in"), null, 20000));
  const nSounds = await p.evaluate(() => window.__lf.audio.SOUNDS.length);
  check("every recording loads and decodes (" + nSounds + ")", await until(p, (n) => window.__lf.audio.loadedCount() >= n, nSounds, 40000), await p.evaluate(() => window.__lf.audio.loadedCount()) + " loaded");
  const b = await brightness(p);
  check("the house is drawn, and it is not black (" + b.toFixed(1) + ")", b > 4);
  await shot(p, "night");

  // walking
  const at0 = await p.evaluate(() => ({ x: window.__lf.g.player.x, z: window.__lf.g.player.z }));
  await p.keyboard.down("KeyW");
  await until(p, (a) => { const pl = window.__lf.g.player; return Math.hypot(pl.x - a.x, pl.z - a.z) > 0.3; }, at0, 20000);
  await p.keyboard.up("KeyW");
  const moved = await p.evaluate((a) => { const pl = window.__lf.g.player; return Math.hypot(pl.x - a.x, pl.z - a.z); }, at0);
  check("W walks (" + moved.toFixed(2) + " m)", moved > 0.3);
  // the wick
  await p.keyboard.press("KeyF");
  check("F turns the wick down", await until(p, () => !window.__lf.g.player.lantern, null, 10000));
  await p.keyboard.press("KeyF");
  check("and F turns it up again", await until(p, () => window.__lf.g.player.lantern, null, 10000));

  // the first lamp
  const lamp = await p.evaluate(() => { const l = window.__lf.g.L.lamps[0]; return { x: l.x, z: l.z, front: l.front }; });
  await standAt(p, lamp.front, lamp);
  check("at a lamp, the prompt says what E will do", await until(p, () => /light the lamp/i.test(document.getElementById("prompt-verb").textContent) && !document.getElementById("prompt").hidden, null, 15000));
  await p.keyboard.down("KeyE");
  const lit = await until(p, () => window.__lf.g.L.lamps[0].lit, null, 60000);
  await p.keyboard.up("KeyE");
  check("holding E lights it", lit);
  await shot(p, "lamp");
  // from here the checks drive the night by hand; keep the hunter out of it
  await p.evaluate(() => { const g = window.__lf.g; g.flags.passStarted = g.flags.passDone = true; g.phase = "unease"; g.hunter.active = false; g.hunter.state = "absent"; });

  // a closet
  const closet = await p.evaluate(() => { const c = window.__lf.g.L.closets[0]; return { x: c.x, z: c.z, front: c.front, id: c.id }; });
  await standAt(p, closet.front, closet);
  await until(p, () => /hide/i.test(document.getElementById("prompt-verb").textContent), null, 15000);
  await p.keyboard.press("KeyE");
  check("E at a closet hides you", await until(p, (id) => window.__lf.g.player.hiding === id, closet.id, 20000));
  await shot(p, "closet");
  await p.keyboard.press("KeyE");
  check("and E again lets you out", await until(p, () => window.__lf.g.player.hiding < 0, null, 20000));

  // pause and settings
  await p.keyboard.press("Escape");
  check("Escape pauses", await until(p, () => !document.getElementById("screen").hidden && document.getElementById("screen").className === "s-pause", null, 15000));
  await p.click('[data-act="settings"]');
  await p.click('[data-arg="fear:gentle"]');
  check("a setting changes and is saved", await p.evaluate(() => window.__lf.S.set.fear === "gentle" && /"fear":"gentle"/.test(localStorage.getItem("lastflame-save-v1") || "")));
  check("the version and a manual update check are in Settings", await p.isVisible('[data-act="updCheck"]') || await p.isVisible('[data-act="updApply"]'));
  // textures: the widest normal map on the house's surfaces, as the materials hold it now
  const surfaceWidth = () => p.evaluate(() => { let w = 0; window.__lf.render.three().scene.traverse((o) => { if (o.isMesh && o.material && o.material.isMeshStandardMaterial && o.material.normalMap && o.material.normalMap.image) w = Math.max(w, o.material.normalMap.image.width || 0); }); return w; });
  const w0 = await surfaceWidth();
  await p.click('[data-arg="textures:original"]');
  check("Original textures arrive and go into the house (" + w0 + " px -> 2048 px)", await until(p, () => { let w = 0; window.__lf.render.three().scene.traverse((o) => { if (o.isMesh && o.material && o.material.isMeshStandardMaterial && o.material.normalMap && o.material.normalMap.image) w = Math.max(w, o.material.normalMap.image.width || 0); }); return w >= 2048; }, null, 60000));
  await p.click('[data-arg="textures:low"]');
  const wl = await surfaceWidth();
  check("Low makes them smaller, on the spot (" + wl + " px)", wl > 0 && wl <= w0 / 4 + 1);
  await p.click('[data-arg="textures:high"]');
  check("and High puts back what ships (" + (await surfaceWidth()) + " px)", (await surfaceWidth()) === w0);
  await p.click('[data-arg="quality:ultra"]');
  const ultra = await p.evaluate(() => { const lf = window.__lf; lf.render.draw(lf.g, 0.016, {}); const r = lf.render.three().renderer; return { aa: lf.render._debug().composer.renderTarget1.samples, dpr: r.getPixelRatio() }; });
  check("Unrestrained draws with multisampled edges (" + ultra.aa + "x)", ultra.aa === 4);
  await p.click('[data-arg="quality:low"]');
  await p.click('[data-act="back"]');
  await p.click('[data-act="resume"]');
  check("and the night goes on", await until(p, () => !window.__lf.g || (document.getElementById("screen").hidden && window.__lf.g.state === "play"), null, 15000));

  // caught, under Lola's Rules
  await p.evaluate(() => { const g = window.__lf.g, h = g.hunter, pl = g.player; h.active = true; h.state = "chase"; h.chaseV = 3; h.x = pl.x + 0.5; h.z = pl.z; h.aware = 1.2; g.dir.relaxT = 0; });
  check("caught is caught", await until(p, () => window.__lf.g.state === "caught" || window.__lf.g.stats.deaths > 0, null, 20000));
  await shot(p, "caught");
  check("and under Lola's Rules you wake by the lamp", await until(p, () => { const g = window.__lf.g, l = g.L.lamps[0]; return g.state === "play" && Math.hypot(g.player.x - l.x, g.player.z - l.z) < 3; }, null, 45000));

  // the end, the real way: every lamp lit, the breather run out, and the house turns
  await p.evaluate(() => {
    const g = window.__lf.g;
    for (const l of g.L.lamps) { if (!l.lit) window.__lf.render.feed([{ type: "lampLit", id: l.id, n: 5 }], g); l.lit = true; l.refilled = true; }
    g.lit = 5; g.phase = "breather"; g.phaseT = 99;
  });
  check("at the end, the dead come out of the lamps", await until(p, () => window.__lf.g.flipped && window.__lf.g.ghosts.length > 0, null, 20000));
  check("and they rise, and come", await until(p, () => window.__lf.g.ghosts.some((q) => q.state !== "rise") || window.__lf.g.state !== "play", null, 60000));
  await shot(p, "finale");
  // the way out
  await p.evaluate(() => {
    const g = window.__lf.g;
    g.state = "play"; g.ghosts = [];
    g.L.doors.find((d) => d.kind === "front").locked = false;
    g.hunter.active = false;
  });
  const exit = await p.evaluate(() => { const g = window.__lf.g, d = g.L.doors.find((q) => q.kind === "front"); return { x: d.x, z: d.z, front: { x: d.x, z: d.z - 0.9 } }; });
  await standAt(p, exit.front, exit);
  await until(p, () => /get out/i.test(document.getElementById("prompt-verb").textContent), null, 15000);
  await p.keyboard.press("KeyE");
  check("the front door, at the end, is the way out", await until(p, () => window.__lf.g.state === "won", null, 20000));
  check("and the night ends on its screen", await until(p, () => document.getElementById("screen").className === "s-won", null, 20000));
  await shot(p, "won");
  check("the night is counted", await p.evaluate(() => window.__lf.S.stats.escaped >= 1));
  check("no errors in the console (computer)", !errors.length, errors.slice(0, 3).join(" | "));
  await ctx.close();

  process.stdout.write("\nA phone, held sideways\n");
  errors.length = 0;
  const pctx = await browser.newContext({ viewport: { width: 640, height: 300 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const q = await pctx.newPage();
  watch(q);
  // a phone that chose Original textures last time: they must come in at start
  await q.addInitScript(() => { try { localStorage.setItem("lastflame-save-v1", JSON.stringify({ v: 1, set: { textures: "original", quality: "low" } })); } catch (e) { /* none */ } });
  await q.goto(url);
  await q.waitForFunction(() => window.__lf && window.__lf.render.progress() >= 1, null, { timeout: 60000 });
  await q.evaluate(() => { const lf = window.__lf; lf.S.set.quality = "low"; lf.render.setQuality("low"); });
  await q.tap('[data-act="begin"]');
  check("a tap begins the night", await until(q, () => window.__lf.g && window.__lf.g.state === "play", null, 20000));
  check("Original textures chosen before, load at start", await until(q, () => { let w = 0; window.__lf.render.three().scene.traverse((o) => { if (o.isMesh && o.material && o.material.isMeshStandardMaterial && o.material.normalMap && o.material.normalMap.image) w = Math.max(w, o.material.normalMap.image.width || 0); }); return w >= 2048; }, null, 60000));
  await q.evaluate(() => { const lf = window.__lf; lf.S.set.textures = "high"; lf.render.setTextures("high"); });
  check("the touch controls are there", await until(q, () => !document.getElementById("touch").hidden, null, 10000));
  const s0 = await q.evaluate(() => ({ x: window.__lf.g.player.x, z: window.__lf.g.player.z }));
  // a thumb on the left half, pushed up
  const cdp = await pctx.newCDPSession(q);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 120, y: 220, id: 1 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 120, y: 170, id: 1 }] });
  await until(q, (a) => { const pl = window.__lf.g.player; return Math.hypot(pl.x - a.x, pl.z - a.z) > 0.3; }, s0, 25000);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  const tm = await q.evaluate((a) => { const pl = window.__lf.g.player; return Math.hypot(pl.x - a.x, pl.z - a.z); }, s0);
  check("the stick walks (" + tm.toFixed(2) + " m)", tm > 0.3);
  const cl = await q.evaluate(() => { const c = window.__lf.g.L.closets[0]; return { x: c.x, z: c.z, front: c.front, id: c.id }; });
  await standAt(q, cl.front, cl);
  const prompted = await until(q, () => /hide/i.test(document.getElementById("prompt-verb").textContent), null, 15000);
  const diag = await q.evaluate(() => { const b = document.getElementById("use").getBoundingClientRect(), el = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return { hit: el && (el.id || el.tagName), hud: document.getElementById("hud").hidden, state: window.__lf.g.state, hiding: window.__lf.g.player.hiding, prompt: document.getElementById("prompt-verb").textContent }; });
  if (!prompted) console.log("    (no prompt yet)", JSON.stringify(diag));
  const ub = await q.evaluate(() => { const b = document.getElementById("use").getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
  await q.touchscreen.tap(ub.x, ub.y);
  check("the hand button hides you", await until(q, (id) => window.__lf.g.player.hiding === id, cl.id, 20000));
  await shot(q, "phone");
  check("no errors in the console (phone)", !errors.length, errors.slice(0, 3).join(" | "));

  await browser.close();
  server.close();
  process.stdout.write("\n" + (failures.length ? failures.length + " of " + checks + " checks failed" : "All " + checks + " checks passed") + "\n");
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
