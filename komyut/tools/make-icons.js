#!/usr/bin/env node
/* ============================================================
   TheCommuters — the app icons, generated rather than drawn by hand
   `node tools/make-icons.js`

   The repository has no image toolchain and no build step, and the icon is
   three shapes: a rounded plate, two stops, and the line between them. A
   checked-in binary nobody can regenerate is worse than eighty lines that
   say exactly what the picture is — so this writes the PNGs directly, from
   a tiny scanline rasteriser and Node's own zlib.

   Everything is rendered at 4x and boxed down, which is all the
   antialiasing an icon at 192 px needs.

   static/icon.svg is written by hand alongside these and carries the same
   geometry; tools/validate.js checks that the two agree about the colours.
   ============================================================ */
"use strict";

var fs = require("fs");
var path = require("path");
var zlib = require("zlib");

var OUT = path.join(__dirname, "..", "static");

var PLATE = [0x1F, 0x7A, 0x6B];   // --komyut, the app's one accent
var INK = [0xF4, 0xF6, 0xF3];     // the light background, used as the glyph
var DEEP = [0x14, 0x4F, 0x46];    // the plate's own shadow, for the far stop

var SS = 4;   // supersampling factor

/* ---------- geometry helpers, all in unit coordinates (0..1) ---------- */
function dist2(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }

function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  var cx = Math.min(Math.max(x, x0 + r), x1 - r);
  var cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return dist2(x, y, cx, cy) <= r * r;
}

function inDisc(x, y, cx, cy, r) { return dist2(x, y, cx, cy) <= r * r; }

function inRing(x, y, cx, cy, r, w) {
  var d = Math.sqrt(dist2(x, y, cx, cy));
  return d <= r + w / 2 && d >= r - w / 2;
}

/* A thick segment with round caps: the distance from the point to the
   segment, which is the same primitive the route drawing uses. */
function inSegment(x, y, ax, ay, bx, by, w) {
  var dx = bx - ax, dy = by - ay;
  var len2 = dx * dx + dy * dy;
  var t = len2 === 0 ? 0 : ((x - ax) * dx + (y - ay) * dy) / len2;
  t = t < 0 ? 0 : (t > 1 ? 1 : t);
  return dist2(x, y, ax + dx * t, ay + dy * t) <= (w / 2) * (w / 2);
}

/* ---------- the picture ----------
   Two stops and the line between them: the same motif the app's "route"
   glyph uses, because the icon on the home screen and the icon in the tab
   bar should plainly be the same idea.

   `inset` is how much of the plate the glyph leaves alone. A maskable icon
   is cropped to a circle of 80% by some launchers, so it gets a bigger
   inset and everything stays inside the safe zone. */
function shade(x, y, opts) {
  var glyph = opts.glyph;   // half-width of the drawn area, 0..0.5

  if (!opts.fullBleed && !inRoundRect(x, y, 0, 0, 1, 1, 0.22)) return null;

  var c = 0.5;
  var a = { x: c - glyph * 0.62, y: c - glyph * 0.60 };
  var b = { x: c + glyph * 0.62, y: c + glyph * 0.62 };
  var bend = { x: c + glyph * 0.30, y: c - glyph * 0.18 };
  var w = glyph * 0.30;

  /* the line, in two segments with a bend, so it reads as a route and not
     as a dumbbell */
  if (inSegment(x, y, a.x, a.y, bend.x, bend.y, w)) return INK;
  if (inSegment(x, y, bend.x, bend.y, b.x, b.y, w)) return INK;

  /* the far stop: a ring, so the two ends are not the same mark */
  if (inRing(x, y, a.x, a.y, glyph * 0.30, w * 1.05)) return INK;
  if (inDisc(x, y, a.x, a.y, glyph * 0.30 - w * 0.55)) return DEEP;

  /* the near stop: solid, and larger, because it is where you are */
  if (inDisc(x, y, b.x, b.y, glyph * 0.34)) return INK;

  return PLATE;
}

function render(size, opts) {
  var big = size * SS;
  var acc = new Float64Array(size * size * 4);

  for (var py = 0; py < big; py++) {
    var y = (py + 0.5) / big;
    for (var px = 0; px < big; px++) {
      var x = (px + 0.5) / big;
      var col = shade(x, y, opts);
      var i = (Math.floor(py / SS) * size + Math.floor(px / SS)) * 4;
      if (col) {
        acc[i] += col[0]; acc[i + 1] += col[1]; acc[i + 2] += col[2]; acc[i + 3] += 255;
      }
    }
  }

  var n = SS * SS;
  var out = Buffer.alloc(size * size * 4);
  for (var k = 0; k < size * size; k++) {
    var o = k * 4;
    var alpha = acc[o + 3] / n;
    /* Premultiplied averaging would darken the edge against transparency,
       so the colour is averaged over the COVERED samples only. */
    var covered = acc[o + 3] / 255;
    out[o] = covered ? Math.round(acc[o] / covered) : 0;
    out[o + 1] = covered ? Math.round(acc[o + 1] / covered) : 0;
    out[o + 2] = covered ? Math.round(acc[o + 2] / covered) : 0;
    out[o + 3] = Math.round(alpha);
  }
  return out;
}

/* ---------- PNG ---------- */
function crc32(buf) {
  var table = crc32.table || (crc32.table = (function () {
    var t = new Int32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c;
    }
    return t;
  })());
  var c = -1;
  for (var i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  var len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  var body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  var crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function png(size, rgba) {
  var raw = Buffer.alloc((size * 4 + 1) * size);
  for (var y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;   // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  var ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;      // bit depth
  ihdr[9] = 6;      // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function write(name, size, opts) {
  var file = path.join(OUT, name);
  fs.writeFileSync(file, png(size, render(size, opts)));
  process.stdout.write("  wrote static/" + name + " (" + size + "px)\n");
}

var ANY = { glyph: 0.31, fullBleed: false };
/* A maskable icon may be cropped to the middle 80%, so the glyph shrinks
   and the plate runs to every edge. */
var MASK = { glyph: 0.24, fullBleed: true };

write("icon-192.png", 192, ANY);
write("icon-512.png", 512, ANY);
write("icon-maskable-192.png", 192, MASK);
write("icon-maskable-512.png", 512, MASK);
write("apple-touch-icon.png", 180, { glyph: 0.31, fullBleed: true });
