#!/usr/bin/env node
/* ============================================================
   BURST//DUMP — the whole page, in a real browser
   `node tools/e2e.js [screenshot-dir]`

   Serves the repository, opens the page in Playwright's Chromium at desktop
   and phone sizes, feeds it generated photos and a generated song (with
   known tempo) through the real file inputs, waits for the analysis worker
   (Essentia included), checks what it found, exports, and checks the file
   is an MP4 of the right length. Any console error fails the run.
   ============================================================ */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..", "..");
const SHOTS = process.argv[2] || null;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png", ".wasm": "application/wasm" };

let failures = 0;
const ok = (n) => process.stdout.write("  \u2713 " + n + "\n");
const bad = (n, d) => { failures++; process.stdout.write("  \u2717 " + n + (d ? " — " + d : "") + "\n"); };
const check = (n, c, d) => (c ? ok(n) : bad(n, d));

function png(w, h, seed) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = (x * 255 / w + seed * 40) & 255; raw[o + 1] = (y * 255 / h + seed * 90) & 255; raw[o + 2] = (seed * 53) & 255;
    }
  }
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/* mvhd duration / timescale, from the top-level moov */
function mp4Duration(buf) {
  let p = 0;
  while (p + 8 <= buf.length) {
    const size = buf.readUInt32BE(p), type = buf.toString("latin1", p + 4, p + 8);
    if (type === "moov") {
      let q = p + 8;
      while (q + 8 <= p + size) {
        const s2 = buf.readUInt32BE(q), t2 = buf.toString("latin1", q + 4, q + 8);
        if (t2 === "mvhd") { const v = buf[q + 8]; return v === 1 ? Number(buf.readBigUInt64BE(q + 32)) / buf.readUInt32BE(q + 28) : buf.readUInt32BE(q + 24) / buf.readUInt32BE(q + 20); }
        q += s2;
      }
    }
    if (size < 8) break; p += size;
  }
  return null;
}

(async function main() {
  const { chromium } = require("playwright");
  const synth = await import(pathToFileURL(path.join(__dirname, "synth.mjs")).href);
  const server = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let f = path.join(ROOT, u); if (f.endsWith("/")) f += "index.html";
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}/burst_dump/`;

  const photos = Array.from({ length: 48 }, (_, i) => ({ name: `IMG_${String(i).padStart(4, "0")}.png`, mimeType: "image/png", buffer: png(i % 3 ? 300 : 200, i % 3 ? 200 : 300, i) }));
  const { mono, sr } = synth.synthSong({ bpm: 120, seed: 5, sr: 44100, form: [{ kind: "intro", bars: 4 }, { kind: "verse", bars: 8 }, { kind: "build", bars: 4 }, { kind: "chorus", bars: 8 }, { kind: "outro", bars: 2 }] });
  const song = { name: "test-song.wav", mimeType: "audio/wav", buffer: Buffer.from(synth.wav(mono, sr)) };

  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  /* desktop takes the fast WebCodecs path (VP9 here: this Chromium has no
     H.264 encoder), the phone the real-time MediaRecorder fallback */
  for (const [label, opts, query] of [["desktop", { viewport: { width: 1440, height: 900 } }, "?test-vp9"], ["phone", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, ""]]) {
    process.stdout.write(`\n${label}\n`);
    const ctx = await browser.newContext(Object.assign({ acceptDownloads: true }, opts));
    const page = await ctx.newPage();
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(base + query);
    await page.waitForFunction(() => window.__bd);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${label}-0-empty.png`) });

    await page.setInputFiles("#filesInput", photos);
    await page.waitForFunction((n) => window.__bd.photos().length === n, photos.length, { timeout: 30000 });
    ok(`${photos.length} photos decoded`);
    check("an edit was built with a cut for every photo", await page.evaluate(() => window.__bd.tl().events.length) === photos.length);

    const t0 = Date.now();
    await page.setInputFiles("#musicInput", song);
    await page.waitForFunction(() => { const s = window.__bd.song(); return s && s.melodyEngine; }, null, { timeout: 120000 });
    const a = await page.evaluate(() => { const s = window.__bd.song(); return { engine: s.engine, mel: s.melodyEngine, bpm: s.bpm, beats: s.beats.length, bars: s.bars.length, secs: s.sections.map((x) => x.type), notes: s.notes.length, rhythm: window.__bd.cfg.rhythm }; });
    ok(`song analysed in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    check("beats came from Essentia", a.engine === "essentia", a.engine);
    check("the melody came from Melodia", a.mel === "essentia", a.mel);
    check("tempo read as 120 BPM", Math.abs(a.bpm - 120) < 1.5, a.bpm);
    check("bars found every four beats", Math.abs(a.bars * 4 - a.beats) <= 4, a.bars + " bars, " + a.beats + " beats");
    check("a quiet part and a chorus were found", a.secs.includes("low") && a.secs.includes("peak"), a.secs.join(","));
    check("melody notes were found", a.notes > 20, a.notes);
    check("the rhythm switched to follow the song", a.rhythm === "song", a.rhythm);
    const onBeat = await page.evaluate(() => {
      const s = window.__bd.song(), off = window.__bd.cfg.musicOff, ev = window.__bd.tl().events, beats = s.beats.map((b) => (b.t - off) * 1000);
      const per = (beats[beats.length - 1] - beats[0]) / (beats.length - 1);
      let on = 0;
      for (const e of ev) { if (e.kind === "start") { on++; continue; } let best = 1e9; for (let i = 0; i < beats.length; i++) for (const f of [0, 0.25, 0.5, 0.75]) best = Math.min(best, Math.abs(e.mt - (beats[i] + f * per))); if (best < 15) on++; }
      return on / ev.length;
    });
    check("cuts land on the beat grid", onBeat > 0.95, (onBeat * 100).toFixed(0) + "%");
    const fit = await page.evaluate(() => ({ len: window.__bd.cfg.lenMode, n: window.__bd.tl().events.length, note: window.__bd.tl().note, lead: window.__bd.tl().events.slice(1).every((e) => e.mt - e.t >= 7.9 && e.mt - e.t <= 8 + 1000 / 60 + 0.1) }));
    check("fit the photos is the default, and uses every photo", fit.len === "fit" && fit.n === photos.length && !fit.note, JSON.stringify(fit));
    check("every cut is shown a little before its beat, never after", fit.lead);
    await page.click('[data-tab="music"]');
    await page.click("#bestBtn");
    await page.waitForTimeout(300);
    const best = await page.evaluate(() => { const off = window.__bd.cfg.musicOff; return { off, onBar: window.__bd.song().bars.some((b) => Math.abs(b - off) < 0.002) }; });
    check("Best part starts the reel on a bar", best.onBar && best.off > 0, best.off.toFixed(2) + " s");
    await page.click('[data-tab="edit"]');
    const d0 = await page.evaluate(() => window.__bd.tl().D);
    await page.$eval("#pace", (el) => { el.value = "-1"; el.dispatchEvent(new Event("input", { bubbles: true })); });
    await page.waitForTimeout(400);
    const d1 = await page.evaluate(() => window.__bd.tl().D);
    check("a calmer pace stretches the same photos over more of the song", d1 > d0, (d0 / 1000).toFixed(1) + " s, then " + (d1 / 1000).toFixed(1) + " s");
    await page.$eval("#pace", (el) => { el.value = "0"; el.dispatchEvent(new Event("input", { bubbles: true })); });
    await page.waitForTimeout(400);
    if (SHOTS) {
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(SHOTS, `${label}-1-loaded.png`) });
      await page.click('[data-tab="music"]'); await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(SHOTS, `${label}-2-music.png`) });
      await page.click('[data-tab="edit"]'); await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(SHOTS, `${label}-3-edit.png`) });
      await page.click("[data-info=rhythm]"); await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(SHOTS, `${label}-4-info.png`) });
      await page.click("#info-close");
    }

    // export
    await page.click('[data-tab="export"]');
    const sup = await page.evaluate(() => !!window.__bd.support());
    check(query ? "the fast path is available" : "the real-time path is used without an encoder", sup === !!query);
    const dl = page.waitForEvent("download", { timeout: 180000 });
    const e0 = Date.now();
    await page.click("#exportBtn2");
    const d = await dl;
    const file = await d.path();
    const buf = fs.readFileSync(file);
    const reel = await page.evaluate(() => (window.__bd.tl().D + (window.__bd.cfg.holdLast ? window.__bd.cfg.holdMs : 0)) / 1000);
    ok(`${sup ? "fast" : "real-time"} export of a ${reel.toFixed(1)} s reel in ${((Date.now() - e0) / 1000).toFixed(1)} s: ${d.suggestedFilename()}, ${(buf.length / 1048576).toFixed(1)} MB`);
    if (d.suggestedFilename().endsWith(".mp4")) {
      check("the file is an MP4", buf.toString("latin1", 4, 8) === "ftyp" || buf.toString("latin1", 4, 8) === "moov");
      const dur = mp4Duration(buf);
      check("its header carries the reel's length", dur && Math.abs(dur - reel) < 0.5, dur && dur.toFixed(2));
    } else check("the file is a WebM", buf[0] === 0x1a && buf[1] === 0x45);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${label}-5-exported.png`) });

    // layout: nothing wider than the screen
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    check("no horizontal overflow", overflow <= 0, overflow + "px");
    check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
    await ctx.close();
  }
  await browser.close();
  server.close();
  process.stdout.write(failures ? `\n${failures} failed\n` : "\nall passed\n");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
