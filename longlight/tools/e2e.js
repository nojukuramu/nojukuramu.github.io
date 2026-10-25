#!/usr/bin/env node
/* ============================================================
   The Long Light — the game, played in a real browser
   `node tools/e2e.js [--shots <dir>]`

   The shape is Last Flame's tools/e2e.js (lastflame/tools/e2e.js), which is
   Ballzooka's: serve the folder, open it in Chromium (WebGL through
   SwiftShader, so it runs headless), use it the way a person would, and fail
   on anything a person would notice, including any error in the console.
   The window is small on purpose: a software GPU draws a frame or two a
   second, and the checks wait on outcomes, not frames.

   On a computer: the title is up and the coast is laid out; a new journey
   wakes you in the bunkhouse and the hut is drawn, not black; W walks; E
   takes the lantern and F lights it; Q shows how you are, in words; Tab
   opens the pack and closes it; E opens the door; outside, the land comes
   in round you; holding E at a beacon lights it; Escape pauses and Settings
   change and stick, Full quality arrives when chosen and Packed puts back
   what ships; leaving saves the walk and the title offers to go on with
   it, on the same coast, where you stood; lighting the station's beacon
   ends the walk, the light answers, and the journey ends on its screen. On
   a phone held sideways: the touch controls are there, the stick walks,
   and the hand button takes what is in front of you.
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
    await wait(200);
  }
  return false;
}
/* Average brightness of the 3D canvas, drawn and read in one task. */
const brightness = (p) => p.evaluate(() => {
  const L = window.__ll, c = document.getElementById("view");
  // past the fade in from black that every waking opens with
  for (let i = 0; i < 4; i++) L.render.draw(L.g, 0.5, {});
  const s = document.createElement("canvas"); s.width = 64; s.height = 36;
  const x = s.getContext("2d"); x.drawImage(c, 0, 0, 64, 36);
  const d = x.getImageData(0, 0, 64, 36).data; let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
  return sum / (d.length / 4) / 3;
});
/* Stand somewhere, facing something (a point with a height). */
const standAt = (p, at, look) => p.evaluate(([at, look]) => {
  const L = window.__ll, g = L.g, pl = g.p;
  pl.x = at.x; pl.z = at.z;
  if (at.inside !== undefined) pl.inside = at.inside;
  pl.y = L.game.groundAt(g, pl.x, pl.z);
  const yaw = Math.atan2(look.x - at.x, look.z - at.z), pitch = Math.atan2(look.y - (pl.y + pl.eye), Math.max(0.2, Math.hypot(look.x - at.x, look.z - at.z)));
  L.input.setLook(yaw, pitch); pl.yaw = yaw; pl.pitch = pitch;
}, [at, look]);
/* Where an item is, and a spot in arm's reach of it on the bunkhouse floor. */
const itemSpot = (p, key) => p.evaluate((key) => {
  const g = window.__ll.g, q = g.P.props.find((x) => x.item && x.item.key === key);
  const dx = g.p.x - q.x, dz = g.p.z - q.z, d = Math.max(0.01, Math.hypot(dx, dz)), r = Math.min(d, 0.9);
  return { id: q.id, at: { x: q.x + (dx / d) * r, z: q.z + (dz / d) * r, inside: q.inside }, look: { x: q.x, y: q.y + 0.1, z: q.z } };
}, key);
/* The widest normal map in the scene's lit materials, as they hold it now. */
const normalWidth = (p) => p.evaluate(() => { let w = 0; window.__ll.render.three().scene.traverse((o) => { if (o.isMesh && o.material && o.material.normalMap && o.material.normalMap.image) w = Math.max(w, o.material.normalMap.image.width || 0); }); return w; });

/* Wait until the walk's clock is moving: a software GPU stops for a long
   while (a minute, once) the first time it draws anything new, and a key
   pressed then is a key held through nothing. */
async function settle(p) {
  const t0 = await p.evaluate(() => window.__ll.g ? window.__ll.g.t : 0);
  return until(p, (t0) => { const g = window.__ll.g; return !!g && g.t > t0 + 0.3; }, t0, 240000);
}

(async () => {
  await new Promise((res) => server.listen(0, res));
  const url = "http://localhost:" + server.address().port + "/";
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
  const errors = [];
  const watch = (p) => { p.on("pageerror", (e) => errors.push(e.message)); p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); }); };
  const shot = async (p, name) => { if (shotsAt) { fs.mkdirSync(shotsAt, { recursive: true }); await p.screenshot({ path: path.join(shotsAt, name + ".png"), timeout: 120000 }).catch(() => {}); } };

  process.stdout.write("\nA computer\n");
  const ctx = await browser.newContext({ viewport: { width: 640, height: 360 } });
  const p = await ctx.newPage();
  watch(p);
  // Fast, so a software GPU keeps up; everything else as it ships
  await p.addInitScript(() => { try { if (!localStorage.getItem("longlight-save-v1")) localStorage.setItem("longlight-save-v1", JSON.stringify({ v: 1, set: { quality: "low" } })); } catch (e) { /* none */ } });
  await p.goto(url);
  await p.waitForFunction(() => window.__ll && window.__ll.S);
  check("the title is up", await p.isVisible("#screen.s-title h1"));
  check("the coast is laid out and the station's things load", await until(p, () => !!window.__ll.W && window.__ll.render.isReady(), null, 120000));
  check("Begin is enabled once they have", await until(p, () => !document.querySelector('[data-act="newrun"]').disabled, null, 10000));
  await p.click('[data-act="help"]');
  check("How to play opens the sheet", await p.isVisible("#info-sheet"));
  await p.click("#info-close");
  await p.click('[data-act="newrun"]');
  check("a new journey asks how hard", await p.isVisible('[data-arg="diff:normal"]'));
  await p.click('[data-arg="diff:normal"]');
  await p.click('[data-act="begin"]');
  check("Wake up starts a journey", await until(p, () => window.__ll.g && window.__ll.g.state === "play" && document.getElementById("screen").hidden, null, 180000));
  check("you wake in the bunkhouse", await p.evaluate(() => { const g = window.__ll.g; return g.p.inside === g.W.sites[0].wake.hut; }));
  // (a setting changed on the way in, the difficulty, once stopped the
  // loop dead: every setting rebuilt the shadows under compiled materials)
  check("and the walk's clock is moving", await settle(p));
  check("and the first hint comes", await until(p, () => document.getElementById("hint").textContent.length > 10, null, 120000));
  const nSounds = await p.evaluate(() => window.__ll.audio.SOUNDS.length + window.__ll.audio.PIANO.length + window.__ll.audio.CELLO.length);
  check("every recording loads and decodes (" + nSounds + ")", await until(p, (n) => window.__ll.audio.loadedCount() >= n, nSounds, 60000), await p.evaluate(() => window.__ll.audio.loadedCount()) + " loaded");
  const b = await brightness(p);
  check("the hut is drawn, and it is not black (" + b.toFixed(1) + ")", b > 4);
  await shot(p, "wake");

  // walking
  const at0 = await p.evaluate(() => ({ x: window.__ll.g.p.x, z: window.__ll.g.p.z }));
  await p.keyboard.down("KeyW");
  await until(p, (a) => { const pl = window.__ll.g.p; return Math.hypot(pl.x - a.x, pl.z - a.z) > 0.3; }, at0, 60000);
  await p.keyboard.up("KeyW");
  const moved = await p.evaluate((a) => { const pl = window.__ll.g.p; return Math.hypot(pl.x - a.x, pl.z - a.z); }, at0);
  check("W walks (" + moved.toFixed(2) + " m)", moved > 0.3);

  // the lantern
  const lan = await itemSpot(p, "lantern");
  await standAt(p, lan.at, lan.look);
  await settle(p);
  check("at the lantern, the prompt says what E will do", await until(p, () => /take the lantern/i.test(document.getElementById("prompt-verb").textContent) && !document.getElementById("prompt").hidden, null, 20000), await p.evaluate(() => document.getElementById("prompt-verb").textContent));
  await p.keyboard.press("KeyE");
  check("E takes it", await until(p, () => window.__ll.g.p.keys.lantern, null, 20000));
  await p.evaluate(() => { window.__ll.g.p.fuel = Math.max(window.__ll.g.p.fuel, 1); });
  await p.keyboard.press("KeyF");
  check("F lights it", await until(p, () => window.__ll.g.p.lantern, null, 15000));
  await p.keyboard.press("KeyF");
  check("and F puts it out", await until(p, () => !window.__ll.g.p.lantern, null, 15000));
  // checking yourself
  await p.keyboard.down("KeyQ");
  check("Q says how you are, in words", await until(p, () => document.getElementById("check").classList.contains("in") && document.getElementById("check-words").textContent.length > 10, null, 15000));
  await p.keyboard.up("KeyQ");
  // the pack
  await p.keyboard.press("Tab");
  check("Tab opens the pack, and the lantern is in it", await until(p, () => document.getElementById("screen").className === "s-pack" && /Lantern/.test(document.getElementById("screen").textContent), null, 15000));
  await p.keyboard.press("Tab");
  check("and Tab closes it", await until(p, () => document.getElementById("screen").hidden, null, 15000));

  // the door
  const door = await p.evaluate(() => {
    const L = window.__ll, g = L.g, h = g.P.huts[g.W.sites[0].wake.hut];
    // the hut's own frame, as places.hutWorld turns it
    const c = Math.cos(h.rot), s = Math.sin(h.rot), w = (lx, lz) => ({ x: h.x + lx * c + lz * s, z: h.z - lx * s + lz * c });
    const a = w(h.door.off, h.d / 2 - 0.8), d = w(h.door.off, h.d / 2);
    return { hut: h.id, at: { x: a.x, z: a.z, inside: h.id }, look: { x: d.x, y: h.floor + 1.1, z: d.z } };
  });
  await standAt(p, door.at, door.look);
  await settle(p);
  check("at the door, E will open it", await until(p, () => /open the door/i.test(document.getElementById("prompt-verb").textContent), null, 20000), await p.evaluate(() => document.getElementById("prompt-verb").textContent));
  await p.keyboard.press("KeyE");
  check("E opens it", await until(p, (id) => window.__ll.g.doors[id] > 0.5, door.hut, 15000));

  // outside, at the base's beacon
  const bea = await p.evaluate(() => { const g = window.__ll.g, b = g.W.beacons[0], s = g.W.sites[0]; const dx = s.x - b.x, dz = s.z - b.z, d = Math.hypot(dx, dz) || 1; return { id: b.id, at: { x: b.x + (dx / d) * 1.8, z: b.z + (dz / d) * 1.8, inside: -1 }, look: { x: b.x, y: b.y + 1.2, z: b.z } }; });
  await standAt(p, bea.at, bea.look);
  check("outside, the land comes in round you", await until(p, () => { const c = window.__ll.terrain.coverage(); return c.pending === 0 && c.queued === 0; }, null, 120000));
  await p.evaluate(() => { const g = window.__ll.g; g.p.fuel = Math.max(g.p.fuel, g.D.beacon); });
  await settle(p);
  check("at a beacon, E will light it", await until(p, () => /light the beacon/i.test(document.getElementById("prompt-verb").textContent), null, 20000), await p.evaluate(() => document.getElementById("prompt-verb").textContent));
  await p.keyboard.down("KeyE");
  const lit = await until(p, (id) => window.__ll.g.lit[id], bea.id, 90000);
  await p.keyboard.up("KeyE");
  check("holding E lights it", lit);
  check("and it is counted", await p.evaluate(() => window.__ll.g.stats.beacons >= 1 && window.__ll.S.stats.beacons >= 1));
  const bo = await brightness(p);
  check("the coast is drawn, and it is not black (" + bo.toFixed(1) + ")", bo > 20);
  await shot(p, "beacon");

  // pause and settings
  await p.keyboard.press("Escape");
  check("Escape pauses", await until(p, () => document.getElementById("screen").className === "s-pause", null, 60000));
  await p.click('[data-act="settings"]');
  await p.click('[data-arg="motion:false"]');
  check("a setting changes and is saved", await p.evaluate(() => window.__ll.S.set.motion === false && /"motion":false/.test(localStorage.getItem("longlight-save-v1") || "")));
  check("the version and a manual update check are in Settings", await p.isVisible('[data-act="updCheck"]') || await p.isVisible('[data-act="updApply"]'));
  const w0 = await normalWidth(p);
  await p.click('[data-arg="assets:full"]');
  check("Full quality arrives and goes onto the huts (" + w0 + " px -> 2048 px)", await until(p, () => { let w = 0; window.__ll.render.three().scene.traverse((o) => { if (o.isMesh && o.material && o.material.normalMap && o.material.normalMap.image) w = Math.max(w, o.material.normalMap.image.width || 0); }); return w >= 2048; }, null, 120000));
  await p.click('[data-arg="assets:packed"]');
  check("and Packed puts back what ships", await until(p, (w0) => { let w = 0; window.__ll.render.three().scene.traverse((o) => { if (o.isMesh && o.material && o.material.normalMap && o.material.normalMap.image) w = Math.max(w, o.material.normalMap.image.width || 0); }); return w === w0; }, w0, 60000));
  await p.click('[data-arg="quality:high"]');
  check("Normal graphics draws with three shadow cascades", await p.evaluate(() => { const L = window.__ll; L.render.draw(L.g, 0.016, {}); return L.render.three().csm.cascades === 3; }));
  await p.click('[data-arg="quality:low"]');
  await p.click('[data-act="back"]');
  await p.click('[data-act="resume"]');
  check("and the walk goes on, its clock moving, every setting applied", await until(p, () => document.getElementById("screen").hidden && window.__ll.g.state === "play", null, 30000) && await settle(p));

  // leaving saves the walk; the title offers to go on with it
  const before = await p.evaluate(() => ({ seed: window.__ll.W.seed, x: window.__ll.g.p.x, z: window.__ll.g.p.z, lit: window.__ll.g.lit[0] }));
  await p.keyboard.press("Escape");
  await until(p, () => document.getElementById("screen").className === "s-pause", null, 60000);
  await p.click('[data-act="quit"]');
  check("leaving goes back to the title, which offers to go on", await until(p, () => document.getElementById("screen").className === "s-title" && !!document.querySelector('[data-act="resume"]'), null, 15000));
  await p.click('[data-act="resume"]');
  check("and going on is the same walk, where you stood", await until(p, (b) => { const L = window.__ll, g = L.g; return g && g.state === "play" && L.W.seed === b.seed && Math.hypot(g.p.x - b.x, g.p.z - b.z) < 1 && g.lit[0] === b.lit; }, before, 120000));

  // the end, the real way: the station's beacon lit, and the light answers
  const st = await p.evaluate(() => { const g = window.__ll.g, b = g.W.beacons.find((x) => x.big), s = g.W.sites[g.W.sites.length - 1]; const dx = s.x - b.x, dz = s.z - b.z, d = Math.hypot(dx, dz) || 1; return { id: b.id, at: { x: b.x + (dx / d) * 2.2, z: b.z + (dz / d) * 2.2, inside: -1 }, look: { x: b.x, y: b.y + 1.6, z: b.z } }; });
  await standAt(p, st.at, st.look);
  await p.evaluate(() => { const g = window.__ll.g; g.p.fuel = Math.max(g.p.fuel, g.D.beacon); for (let i = 0; i < g.lit.length; i++) g.lit[i] = true; });
  await until(p, () => { const c = window.__ll.terrain.coverage(); return c.pending === 0 && c.queued === 0; }, null, 120000);
  await settle(p);
  check("at the station, the last beacon waits", await until(p, () => /light the beacon/i.test(document.getElementById("prompt-verb").textContent), null, 20000), await p.evaluate(() => document.getElementById("prompt-verb").textContent));
  await p.keyboard.down("KeyE");
  check("lighting it begins the end", await until(p, () => !!window.__ll.g.ending, null, 90000));
  await p.keyboard.up("KeyE");
  // (the ending is a minute of game time, at most 0.1 s a frame: on a software
  // GPU that is many minutes, so the clock is moved on to just before each beat)
  await p.evaluate(() => { window.__ll.g.ending.t = 21.5; });
  check("and the light answers", await until(p, () => window.__ll.g.ending.answered, null, 60000));
  await shot(p, "answer");
  await p.evaluate(() => { window.__ll.g.ending.t = 57.5; });
  check("and the journey ends on its screen", await until(p, () => document.getElementById("screen").className === "s-over" && /answered/.test(document.getElementById("screen").textContent), null, 60000));
  await shot(p, "over");
  check("the journey is counted", await p.evaluate(() => window.__ll.S.stats.arrived >= 1));
  check("no errors in the console (computer)", !errors.length, errors.slice(0, 3).join(" | "));
  await ctx.close();

  process.stdout.write("\nA phone, held sideways\n");
  errors.length = 0;
  const pctx = await browser.newContext({ viewport: { width: 640, height: 300 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const q = await pctx.newPage();
  watch(q);
  await q.addInitScript(() => { try { localStorage.setItem("longlight-save-v1", JSON.stringify({ v: 1, set: { quality: "low" } })); } catch (e) { /* none */ } });
  await q.goto(url);
  await q.waitForFunction(() => window.__ll && window.__ll.W && window.__ll.render.isReady(), null, { timeout: 120000 });
  await until(q, () => !document.querySelector('[data-act="newrun"]').disabled, null, 10000);
  await q.tap('[data-act="newrun"]');
  await q.tap('[data-act="begin"]');
  check("a tap begins the walk", await until(q, () => window.__ll.g && window.__ll.g.state === "play" && document.getElementById("screen").hidden, null, 180000));
  await settle(q);
  check("the touch controls are there", await until(q, () => !document.getElementById("touch").hidden, null, 10000));
  const s0 = await q.evaluate(() => ({ x: window.__ll.g.p.x, z: window.__ll.g.p.z }));
  // a thumb on the left half, pushed up
  const cdp = await pctx.newCDPSession(q);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 120, y: 220, id: 1 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 120, y: 170, id: 1 }] });
  await until(q, (a) => { const pl = window.__ll.g.p; return Math.hypot(pl.x - a.x, pl.z - a.z) > 0.3; }, s0, 60000);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  const tm = await q.evaluate((a) => { const pl = window.__ll.g.p; return Math.hypot(pl.x - a.x, pl.z - a.z); }, s0);
  check("the stick walks (" + tm.toFixed(2) + " m)", tm > 0.3);
  const ql = await itemSpot(q, "lantern");
  await standAt(q, ql.at, ql.look);
  await settle(q);
  await until(q, () => /take the lantern/i.test(document.getElementById("prompt-verb").textContent), null, 20000);
  const ub = await q.evaluate(() => { const b = document.getElementById("use").getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
  await q.touchscreen.tap(ub.x, ub.y);
  check("the hand button takes the lantern", await until(q, () => window.__ll.g.p.keys.lantern, null, 20000));
  check("and the lantern's button comes up", await until(q, () => !document.getElementById("btn-lantern").hidden, null, 15000));
  await shot(q, "phone");
  check("no errors in the console (phone)", !errors.length, errors.slice(0, 3).join(" | "));

  await browser.close();
  server.close();
  process.stdout.write("\n" + (failures.length ? failures.length + " of " + checks + " checks failed" : "All " + checks + " checks passed") + "\n");
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
