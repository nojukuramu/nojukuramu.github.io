/* ============================================================
   BURST//DUMP — drawing a frame

   Every frame is a pure function of its time: the accumulated prints behind
   the current cut are drawn once into an offscreen canvas and only re-drawn
   when the timeline jumps, the current cut is drawn on top, and the effects
   go over that. Grain and glitch take their randomness from a hash of the
   frame time rather than Math.random(), so the preview and the export show
   the same frame, and an export done twice is the same file.

   The draw code for the sixteen styles is the first version's, unchanged in
   what it draws.
   ============================================================ */
import { feelAt, feelWeights } from "./timeline.js";

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const fmtT = (ms) => { const s = Math.max(0, ms) / 1000; return Math.floor(s / 60) + ":" + (s % 60).toFixed(1).padStart(4, "0"); };
function hash(n) { n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; }

/* Canvas `filter` (the xerox style) is missing in older Safari: check the
   property exists rather than assign-and-read-back, which an engine that
   ignores it would happily echo. */
const CAN_FILTER = (() => { try { return "filter" in document.createElement("canvas").getContext("2d"); } catch (e) { return false; } })();

let cv, ctx, acc, accx, fx, fxx, blurSm, blurSx, vigCv = null, grain = [];
let photos = [], tl = { events: [], D: 0, beats: [] }, anchor = [], evT = [];
let cfg = null, music = null;
const st = { dirty: true, accAnchor: -2, stamped: -1, lastT: -1, lastIdx: -1 };

export function init(canvas, config) {
  cv = canvas; cfg = config;
  ctx = cv.getContext("2d", { alpha: false });
  acc = document.createElement("canvas"); accx = acc.getContext("2d", { alpha: false });
  fx = document.createElement("canvas"); fxx = fx.getContext("2d");
  blurSm = document.createElement("canvas"); blurSm.width = 36; blurSm.height = 64; blurSx = blurSm.getContext("2d");
}
export function size(w, h) {
  // acc/fx too: they start life at 300x150, and a mismatch leaves a ghost
  if (cv.width !== w || cv.height !== h || acc.width !== w || acc.height !== h) {
    cv.width = w; cv.height = h; acc.width = w; acc.height = h; fx.width = w; fx.height = h;
    vigCv = null; invalidate(); bg(accx);
  }
}
export function setPhotos(p) { photos = p; invalidate(); }
export function setMusic(m) { music = m; }
export function setTimeline(t) {
  tl = t; evT = t.events.map((e) => e.t); anchor = [];
  for (let k = 0; k < t.events.length; k++) anchor.push(t.events[k].clear || t.events[k].covers ? k : (k ? anchor[k - 1] : 0));
  invalidate();
}
export function invalidate() { st.dirty = true; st.accAnchor = -2; st.stamped = -1; }
export function canvas() { return cv; }

function bg(c) { c.fillStyle = cfg.bg; c.fillRect(0, 0, cv.width, cv.height); }
export function clear() { bg(ctx); }
function vig() {
  if (vigCv) return vigCv;
  vigCv = document.createElement("canvas"); vigCv.width = cv.width; vigCv.height = cv.height;
  const g = vigCv.getContext("2d"), r = Math.hypot(cv.width, cv.height) / 2;
  const gr = g.createRadialGradient(cv.width / 2, cv.height / 2, r * 0.45, cv.width / 2, cv.height / 2, r * 1.02);
  gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(1, "rgba(0,0,0,1)");
  g.fillStyle = gr; g.fillRect(0, 0, cv.width, cv.height);
  return vigCv;
}
function grainTile(i) {
  if (!grain.length) {
    for (let k = 0; k < 3; k++) {
      const t = document.createElement("canvas"); t.width = t.height = 384;
      const g = t.getContext("2d"), im = g.createImageData(384, 384), d = im.data;
      for (let p = 0, n = 1; p < d.length; p += 4, n++) { const v = hash(n * 7919 + k * 104729) * 255 | 0; d[p] = d[p + 1] = d[p + 2] = v; d[p + 3] = 46; }
      g.putImageData(im, 0, 0); grain.push(t);
    }
  }
  return grain[i % 3];
}

function idxFor(t) { let lo = 0, hi = evT.length - 1, a = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (evT[m] <= t) { a = m; lo = m + 1; } else hi = m - 1; } return a; }

/* ---------- the sixteen styles ---------- */
export function coverSrc(bmp, dw, dh) { const s = Math.max(dw / bmp.width, dh / bmp.height), sw = dw / s, sh = dh / s; return [(bmp.width - sw) / 2, (bmp.height - sh) / 2, sw, sh]; }
function coverFull(c, bmp, e) { e = e || 1; const w = cv.width * e, h = cv.height * e, [sx, sy, sw, sh] = coverSrc(bmp, cv.width, cv.height); c.drawImage(bmp, sx, sy, sw, sh, (cv.width - w) / 2, (cv.height - h) / 2, w, h); }
function blurBg(c, bmp) {
  const [sx, sy, sw, sh] = coverSrc(bmp, blurSm.width, blurSm.height);
  blurSx.drawImage(bmp, sx, sy, sw, sh, 0, 0, blurSm.width, blurSm.height);
  c.imageSmoothingEnabled = true; c.drawImage(blurSm, 0, 0, cv.width, cv.height);
  c.fillStyle = "rgba(0,0,0,0.34)"; c.fillRect(0, 0, cv.width, cv.height);
}
function drawEvent(c, ev, prog, tNow) {
  const src = photos[ev.i]; if (!src) return;
  const bmp = src.bmp, W = cv.width, H = cv.height;
  switch (ev.st) {
    case "slam": {
      let dz = 1;
      if (cfg.drift && ev.hold > 350 && prog >= 1) dz = tNow == null ? 1.04 : 1 + 0.04 * clamp((tNow - ev.t) / ev.hold, 0, 1);
      if (ev.fit === "contain") { blurBg(c, bmp); const s = Math.min(W / bmp.width, H / bmp.height) * dz, w = bmp.width * s, h = bmp.height * s; c.drawImage(bmp, (W - w) / 2, (H - h) / 2, w, h); }
      else coverFull(c, bmp, dz);
      return;
    }
    case "punch": {
      const [sx, sy, sw, sh] = coverSrc(bmp, W, H), cw = sw / ev.zs, ch = sh / ev.zs;
      c.drawImage(bmp, clamp(sx + ev.zx * sw - cw / 2, sx, sx + sw - cw), clamp(sy + ev.zy * sh - ch / 2, sy, sy + sh - ch), cw, ch, 0, 0, W, H);
      return;
    }
    case "quad": {
      const gap = Math.round(W * 0.006), cw = W / 2, ch = H / 2, [sx, sy, sw, sh] = coverSrc(bmp, cw, ch);
      let i = 0;
      for (let qy = 0; qy < 2; qy++) for (let qx = 0; qx < 2; qx++) {
        const x = qx * cw + gap / 2, y = qy * ch + gap / 2, w = cw - gap, h = ch - gap;
        c.save();
        if (ev.qflip[i]) { c.translate(x + w, y); c.scale(-1, 1); c.drawImage(bmp, sx, sy, sw, sh, 0, 0, w, h); } else c.drawImage(bmp, sx, sy, sw, sh, x, y, w, h);
        c.restore(); i++;
      }
      return;
    }
    case "xerox":
      if (CAN_FILTER) { c.save(); c.filter = "grayscale(1) contrast(2.2) brightness(1.05)"; coverFull(c, bmp); c.restore(); } else coverFull(c, bmp);
      return;
    case "grid": {
      const gap = Math.round(W * 0.006), cw = W / ev.cols, ch = H / ev.rows;
      const x = ev.cell.c * cw + gap / 2, y = ev.cell.r * ch + gap / 2, w = cw - gap, h = ch - gap, [sx, sy, sw, sh] = coverSrc(bmp, w, h);
      c.drawImage(bmp, sx, sy, sw, sh, x, y, w, h); return;
    }
    case "bars": { const w = Math.round(W * ev.w), x = Math.round(W * ev.x), [sx, sy, sw, sh] = coverSrc(bmp, w, H); c.drawImage(bmp, sx, sy, sw, sh, x, 0, w, H); return; }
    case "strip": { const h = Math.round(H * ev.h), y = Math.round(H * ev.y), [sx, sy, sw, sh] = coverSrc(bmp, W, h); c.drawImage(bmp, sx, sy, sw, sh, 0, y, W, h); return; }
    case "split": {
      const gap = Math.round(W * 0.008), x = ev.rect.x * W + gap / 2, y = ev.rect.y * H + gap / 2, w = ev.rect.w * W - gap, h = ev.rect.h * H - gap, [sx, sy, sw, sh] = coverSrc(bmp, w, h);
      c.drawImage(bmp, sx, sy, sw, sh, x, y, w, h); return;
    }
    case "echo": {
      coverFull(c, bmp);
      const [sx, sy, sw, sh] = coverSrc(bmp, W, H);
      for (let i = 1; i <= ev.echoN; i++) {
        const s = Math.pow(ev.esc, i), w = W * s, h = H * s;
        c.save(); c.translate(W * (0.5 + (ev.ex - 0.5) * i), H * (0.5 + (ev.ey - 0.5) * i)); c.rotate(ev.erot * i);
        c.fillStyle = "#0b0c0e"; c.fillRect(-w / 2 - W * 0.004, -h / 2 - W * 0.004, w + W * 0.008, h + W * 0.008);
        c.drawImage(bmp, sx, sy, sw, sh, -w / 2, -h / 2, w, h); c.restore();
      }
      return;
    }
    case "slash": {
      const L = Math.hypot(W, H) * 1.05, h = ev.h * H, yo = ev.off * H * 0.5;
      c.save(); c.translate(W / 2, H / 2); c.rotate(ev.ang);
      const [sx, sy, sw, sh] = coverSrc(bmp, L, h);
      c.fillStyle = "#f5f2ea"; c.fillRect(-L / 2, yo - h / 2 - W * 0.004, L, h + W * 0.008);
      c.drawImage(bmp, sx, sy, sw, sh, -L / 2, yo - h / 2, L, h); c.restore();
      return;
    }
    case "bubble": {
      const settle = prog >= 1 ? 1 : easeOut(prog), r = ev.r * W * (1.16 - 0.16 * settle), cx = ev.x * W, cy = ev.y * H, d = r * 2;
      c.save();
      if (ev.ring && cfg.border !== "none") { c.shadowColor = "rgba(0,0,0,0.5)"; c.shadowBlur = W * 0.015; c.beginPath(); c.arc(cx, cy, r * 1.06, 0, Math.PI * 2); c.fillStyle = "#f5f2ea"; c.fill(); c.shadowColor = "transparent"; }
      c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.clip();
      const [sx, sy, sw, sh] = coverSrc(bmp, d, d); c.drawImage(bmp, sx, sy, sw, sh, cx - r, cy - r, d, d); c.restore();
      return;
    }
    case "mirror": {
      if (ev.mdir === "v") {
        const [sx, sy, sw, sh] = coverSrc(bmp, W / 2, H), x = clamp(sx + ev.msh * bmp.width, 0, Math.max(0, bmp.width - sw));
        c.drawImage(bmp, x, sy, sw, sh, 0, 0, W / 2, H); c.save(); c.translate(W, 0); c.scale(-1, 1); c.drawImage(bmp, x, sy, sw, sh, 0, 0, W / 2, H); c.restore();
      } else if (ev.mdir === "h") {
        const [sx, sy, sw, sh] = coverSrc(bmp, W, H / 2), y = clamp(sy + ev.msh * bmp.height, 0, Math.max(0, bmp.height - sh));
        c.drawImage(bmp, sx, y, sw, sh, 0, 0, W, H / 2); c.save(); c.translate(0, H); c.scale(1, -1); c.drawImage(bmp, sx, y, sw, sh, 0, 0, W, H / 2); c.restore();
      } else {
        const [sx, sy, sw, sh] = coverSrc(bmp, W / 2, H / 2), x = clamp(sx + ev.msh * bmp.width, 0, Math.max(0, bmp.width - sw)), y = clamp(sy + ev.msh * bmp.height, 0, Math.max(0, bmp.height - sh));
        for (let qx = 0; qx < 2; qx++) for (let qy = 0; qy < 2; qy++) { c.save(); c.translate(qx ? W : 0, qy ? H : 0); c.scale(qx ? -1 : 1, qy ? -1 : 1); c.drawImage(bmp, x, y, sw, sh, 0, 0, W / 2, H / 2); c.restore(); }
      }
      return;
    }
  }
  // pop, pile, stack and tape: placed prints
  const settle = prog >= 1 ? 1 : easeOut(prog);
  let w = ev.sc * W, h = w / ev.ar;
  const maxH = H * (ev.st === "stack" ? 0.92 : 0.82); if (h > maxH) { h = maxH; w = h * ev.ar; }
  const s = 1.16 - 0.16 * settle;
  c.save(); c.translate(ev.x * W, ev.y * H); c.rotate(ev.rot); c.scale(s, s);
  const print = ev.st === "pile" || ev.st === "stack" || ev.st === "tape";
  if (print && cfg.border !== "none") {
    const pad = w * 0.035, bot = cfg.border === "polaroid" ? w * 0.16 : pad;
    c.shadowColor = "rgba(0,0,0,0.55)"; c.shadowBlur = W * 0.02; c.shadowOffsetY = W * 0.006;
    c.fillStyle = "#f5f2ea"; c.fillRect(-w / 2 - pad, -h / 2 - pad, w + pad * 2, h + pad + bot); c.shadowColor = "transparent";
  } else if (print) { c.shadowColor = "rgba(0,0,0,0.5)"; c.shadowBlur = W * 0.018; }
  c.drawImage(bmp, -w / 2, -h / 2, w, h);
  if (ev.st === "tape") {
    const tw = w * 0.32, th = w * 0.09;
    for (const [tx, ty, r] of [[-w * 0.32, -h * 0.42, -0.5], [w * 0.30, h * 0.40, 0.45]]) {
      c.save(); c.translate(tx, ty); c.rotate(r);
      c.fillStyle = "rgba(255,255,255,0.28)"; c.fillRect(-tw / 2, -th / 2, tw, th);
      c.fillStyle = "rgba(255,255,255,0.5)"; c.fillRect(-tw / 2, -th / 2, tw, th * 0.18); c.restore();
    }
  }
  c.restore();
}

/* ---------- a frame ---------- */
export function endT() { return tl.events.length ? tl.D + (cfg.holdLast ? cfg.holdMs : 0) : 0; }

/* Draws the frame at t (ms). Returns how many cuts were crossed since the
   last frame, which is what the shutter sound counts. */
export function frame(t) {
  const N = tl.events.length;
  if (!N) { bg(ctx); return 0; }
  const tt = clamp(t, 0, endT());
  const fh = feelAt(cfg, music, tt), fw = feelWeights(cfg);
  const et = Math.min(tt, tl.D - 0.001);
  const idx = Math.max(0, idxFor(et)), anch = anchor[idx];
  let crossed = 0;
  if (st.dirty || anch !== st.accAnchor || tt < st.lastT - 1) {
    bg(accx);
    for (let j = anch; j < idx; j++) drawEvent(accx, tl.events[j], 1, null);
    st.accAnchor = anch; st.stamped = idx - 1; st.dirty = false;
    if (st.lastIdx !== idx && tt >= st.lastT) crossed = 1;
  } else {
    while (st.stamped < idx - 1) { st.stamped++; drawEvent(accx, tl.events[st.stamped], 1, null); crossed++; }
    if (st.lastIdx !== idx) crossed = Math.max(crossed, 1);
  }
  st.lastIdx = idx;
  ctx.drawImage(acc, 0, 0);
  const top = tl.events[idx];
  drawEvent(ctx, top, top.pop ? clamp((et - top.t) / top.pop, 0, 1) : 1, et);

  // beat pulse: the whole frame breathes on each beat, harder on a downbeat
  if (cfg.pulse > 0 && tl.beats && tl.beats.length) {
    let lo = 0, hi = tl.beats.length - 1, b = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (tl.beats[m].t <= et) { b = m; lo = m + 1; } else hi = m - 1; }
    if (b >= 0) {
      const bt = tl.beats[b], amt = cfg.pulse * (0.4 + 0.6 * bt.s) * (bt.down ? 1.3 : 1) * Math.exp(-(et - bt.t) / 110);
      if (amt > 0.004) {
        const s = 0.045 * amt, dx = cv.width * s / 2, dy = cv.height * s / 2;
        fxx.clearRect(0, 0, cv.width, cv.height); fxx.drawImage(cv, 0, 0);
        ctx.drawImage(fx, -dx, -dy, cv.width + 2 * dx, cv.height + 2 * dy);
      }
    }
  }
  if (cfg.flash) {
    let a = 0;
    for (let j = idx; j >= 0 && et - tl.events[j].t < 140; j--) if (tl.events[j].flash) a = Math.max(a, (1 - (et - tl.events[j].t) / 140) * 0.85);
    if (a > 0) { ctx.fillStyle = `rgba(255,255,255,${a})`; ctx.fillRect(0, 0, cv.width, cv.height); }
  }
  if (cfg.glitch && top.glitch && et - top.t < 80) {
    fxx.clearRect(0, 0, cv.width, cv.height); fxx.drawImage(cv, 0, 0);
    const seed = (idx * 2654435761) ^ ((et / 16) | 0);
    for (let s = 0; s < 5; s++) {
      const y = hash(seed + s * 3) * cv.height | 0, h = (cv.height * 0.02 + hash(seed + s * 3 + 1) * cv.height * 0.05) | 0;
      const off = ((hash(seed + s * 3 + 2) * 2 - 1) * cv.width * 0.04) | 0;
      ctx.drawImage(fx, 0, y, cv.width, h, off, y, cv.width, h);
    }
  }
  const gAmt = fh ? clamp(cfg.grain * (1 + (fh.noisiness - 0.5) * 0.9 * fw.tex), 0, 0.5) : cfg.grain;
  if (gAmt > 0) {
    const q = (et / 50) | 0, tile = grainTile(q);
    ctx.save(); ctx.globalAlpha = gAmt;
    const ox = -(hash(q * 31 + 1) * 384 | 0), oy = -(hash(q * 31 + 2) * 384 | 0);
    for (let x = ox; x < cv.width; x += 384) for (let y = oy; y < cv.height; y += 384) ctx.drawImage(tile, x, y);
    ctx.restore();
  }
  const vAmt = fh ? clamp(cfg.vig * (1 - (fh.brightness - 0.5) * 0.5 * fw.tex), 0, 0.8) : cfg.vig;
  if (vAmt > 0) { ctx.save(); ctx.globalAlpha = vAmt; ctx.drawImage(vig(), 0, 0); ctx.restore(); }
  if (cfg.hud) {
    const fs = Math.round(cv.height * 0.02);
    ctx.save(); ctx.font = `500 ${fs}px 'IBM Plex Mono', ui-monospace, monospace`; ctx.textBaseline = "alphabetic";
    ctx.shadowColor = "rgba(0,0,0,0.8)"; ctx.shadowBlur = fs * 0.4; ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.textAlign = "right"; ctx.fillText(`#${String(top.i + 1).padStart(4, "0")} / ${photos.length}`, cv.width - fs, cv.height - fs);
    ctx.textAlign = "left"; ctx.globalAlpha = 0.75; ctx.fillText(fmtT(tt), fs, cv.height - fs);
    ctx.restore();
  }
  st.lastT = tt;
  return crossed;
}
