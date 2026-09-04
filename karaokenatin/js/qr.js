/* qr.js — minimal QR Code encoder (byte mode, versions 1–25, ECC L/M).
 *
 * No dependencies, no CDN. Enough to encode a join URL (~60 chars) and draw it
 * to a canvas. Versions past 12 exist for library sharing, where a whole
 * library is split across a handful of codes rather than dozens of them.
 * Throws if the payload does not fit version 25.
 *
 *   QR.encode("https://example.com")  -> { size, modules }  (modules[y][x] = bool)
 *   QR.draw(canvas, text, { scale, quiet, dark, light })
 */
(function (global) {
  "use strict";

  /* ---------------- GF(256) arithmetic ---------------- */
  var EXP = new Uint8Array(512);
  var LOG = new Uint8Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();

  function gmul(a, b) {
    return a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]];
  }

  function generatorPoly(degree) {
    var poly = [1];
    for (var i = 0; i < degree; i++) {
      var next = new Array(poly.length + 1);
      for (var k = 0; k < next.length; k++) next[k] = 0;
      for (var j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= gmul(poly[j], EXP[i]);
      }
      poly = next;
    }
    return poly;
  }

  function eccBytes(data, count) {
    var gen = generatorPoly(count);
    var buf = new Uint8Array(data.length + count);
    buf.set(data, 0);
    for (var i = 0; i < data.length; i++) {
      var factor = buf[i];
      if (factor === 0) continue;
      for (var j = 0; j < gen.length; j++) buf[i + j] ^= gmul(gen[j], factor);
    }
    return buf.subarray(data.length);
  }

  var MAX_VERSION = 25;

  /* ---------------- version tables (v1–v25) ----------------
   * Each entry: [ecPerBlock, blocks1, data1, blocks2, data2]
   */
  var BLOCKS = {
    L: [
      null,
      [7, 1, 19, 0, 0],
      [10, 1, 34, 0, 0],
      [15, 1, 55, 0, 0],
      [20, 1, 80, 0, 0],
      [26, 1, 108, 0, 0],
      [18, 2, 68, 0, 0],
      [20, 2, 78, 0, 0],
      [24, 2, 97, 0, 0],
      [30, 2, 116, 0, 0],
      [18, 2, 68, 2, 69],
      [20, 4, 81, 0, 0],
      [24, 2, 92, 2, 93],
      [26, 4, 107, 0, 0],
      [30, 3, 115, 1, 116],
      [22, 5, 87, 1, 88],
      [24, 5, 98, 1, 99],
      [28, 1, 107, 5, 108],
      [30, 5, 120, 1, 121],
      [28, 3, 113, 4, 114],
      [28, 3, 107, 5, 108],
      [28, 4, 116, 4, 117],
      [28, 2, 111, 7, 112],
      [30, 4, 121, 5, 122],
      [30, 6, 117, 4, 118],
      [26, 8, 106, 4, 107]
    ],
    M: [
      null,
      [10, 1, 16, 0, 0],
      [16, 1, 28, 0, 0],
      [26, 1, 44, 0, 0],
      [18, 2, 32, 0, 0],
      [24, 2, 43, 0, 0],
      [16, 4, 27, 0, 0],
      [18, 4, 31, 0, 0],
      [22, 2, 38, 2, 39],
      [22, 3, 36, 2, 37],
      [26, 4, 43, 1, 44],
      [30, 1, 50, 4, 51],
      [22, 6, 36, 2, 37],
      [22, 8, 37, 1, 38],
      [24, 4, 40, 5, 41],
      [24, 5, 41, 5, 42],
      [28, 7, 45, 3, 46],
      [28, 10, 46, 1, 47],
      [26, 9, 43, 4, 44],
      [26, 3, 44, 11, 45],
      [26, 3, 41, 13, 42],
      [26, 17, 42, 0, 0],
      [28, 17, 46, 0, 0],
      [28, 4, 47, 14, 48],
      [28, 6, 45, 14, 46],
      [28, 8, 47, 13, 48]
    ]
  };

  // Alignment pattern centre coordinates per version.
  var ALIGN = [
    null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
    [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54], [6, 32, 58],
    [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74], [6, 30, 54, 78],
    [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90], [6, 28, 50, 72, 94],
    [6, 26, 50, 74, 98], [6, 30, 54, 78, 102], [6, 28, 54, 80, 106], [6, 32, 58, 84, 110]
  ];

  var ECC_BITS = { L: 1, M: 0, Q: 3, H: 2 };

  function dataCapacity(version, ecc) {
    var b = BLOCKS[ecc][version];
    return b[1] * b[2] + b[3] * b[4];
  }

  /* ---------------- BCH codes for format / version info ---------------- */
  function bitLength(v) {
    var n = 0;
    while (v) { n++; v >>>= 1; }
    return n;
  }

  // Remainder of (value << bits) divided by `poly` over GF(2).
  function bch(value, poly, bits) {
    var degree = bitLength(poly) - 1;
    var v = value << bits;
    while (bitLength(v) > degree) v ^= poly << (bitLength(v) - degree - 1);
    return v;
  }

  function formatInfo(ecc, mask) {
    var data = (ECC_BITS[ecc] << 3) | mask; // 5 bits
    return ((data << 10) | bch(data, 0x537, 10)) ^ 0x5412;
  }

  function versionInfo(version) {
    return (version << 12) | bch(version, 0x1f25, 12);
  }

  /* ---------------- bit buffer ---------------- */
  function BitBuffer() {
    this.bits = [];
  }
  BitBuffer.prototype.put = function (value, length) {
    for (var i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  };

  /* ---------------- encoding ---------------- */
  function utf8Bytes(str) {
    if (global.TextEncoder) return new TextEncoder().encode(str);
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return new Uint8Array(out);
  }

  function buildCodewords(bytes, version, ecc) {
    var capacity = dataCapacity(version, ecc);
    var buf = new BitBuffer();
    buf.put(4, 4); // byte mode
    buf.put(bytes.length, version < 10 ? 8 : 16);
    for (var i = 0; i < bytes.length; i++) buf.put(bytes[i], 8);

    var totalBits = capacity * 8;
    var terminator = Math.min(4, totalBits - buf.bits.length);
    buf.put(0, terminator);
    while (buf.bits.length % 8 !== 0) buf.bits.push(0);

    var data = new Uint8Array(capacity);
    for (var b = 0; b < buf.bits.length; b += 8) {
      var v = 0;
      for (var k = 0; k < 8; k++) v = (v << 1) | buf.bits[b + k];
      data[b / 8] = v;
    }
    var pad = [0xec, 0x11];
    var p = 0;
    for (var d = buf.bits.length / 8; d < capacity; d++) data[d] = pad[p++ % 2];

    // split into blocks, compute ECC, interleave
    var spec = BLOCKS[ecc][version];
    var ecLen = spec[0];
    var blocks = [];
    var offset = 0;
    var g;
    for (g = 0; g < spec[1]; g++) {
      blocks.push(data.subarray(offset, offset + spec[2]));
      offset += spec[2];
    }
    for (g = 0; g < spec[3]; g++) {
      blocks.push(data.subarray(offset, offset + spec[4]));
      offset += spec[4];
    }
    var eccs = blocks.map(function (blk) {
      return eccBytes(blk, ecLen);
    });

    var out = [];
    var maxData = Math.max(spec[2], spec[4] || 0);
    for (var c = 0; c < maxData; c++) {
      for (var bi = 0; bi < blocks.length; bi++) {
        if (c < blocks[bi].length) out.push(blocks[bi][c]);
      }
    }
    for (var e = 0; e < ecLen; e++) {
      for (var ei = 0; ei < eccs.length; ei++) out.push(eccs[ei][e]);
    }
    return out;
  }

  /* ---------------- matrix ---------------- */
  function makeMatrix(version) {
    var size = version * 4 + 17;
    var m = [];
    var reserved = [];
    for (var y = 0; y < size; y++) {
      m.push(new Array(size).fill(null));
      reserved.push(new Array(size).fill(false));
    }

    function finder(cx, cy) {
      for (var dy = -1; dy <= 7; dy++) {
        for (var dx = -1; dx <= 7; dx++) {
          var x = cx + dx;
          var y = cy + dy;
          if (x < 0 || y < 0 || x >= size || y >= size) continue;
          var inRing =
            (dx >= 0 && dx <= 6 && (dy === 0 || dy === 6)) ||
            (dy >= 0 && dy <= 6 && (dx === 0 || dx === 6));
          var inCore = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;
          m[y][x] = inRing || inCore;
          reserved[y][x] = true;
        }
      }
    }
    finder(0, 0);
    finder(size - 7, 0);
    finder(0, size - 7);

    // timing patterns
    for (var i = 8; i < size - 8; i++) {
      m[6][i] = i % 2 === 0;
      reserved[6][i] = true;
      m[i][6] = i % 2 === 0;
      reserved[i][6] = true;
    }

    // alignment patterns
    var centers = ALIGN[version];
    for (var a = 0; a < centers.length; a++) {
      for (var b = 0; b < centers.length; b++) {
        var ax = centers[a];
        var ay = centers[b];
        // Omitted only where they would collide with a finder pattern.
        // (Overlap with the timing lines is expected and consistent.)
        var onFinder =
          (ax === 6 && ay === 6) ||
          (ax === 6 && ay === size - 7) ||
          (ax === size - 7 && ay === 6);
        if (onFinder) continue;
        for (var yy = -2; yy <= 2; yy++) {
          for (var xx = -2; xx <= 2; xx++) {
            m[ay + yy][ax + xx] =
              Math.max(Math.abs(xx), Math.abs(yy)) !== 1;
            reserved[ay + yy][ax + xx] = true;
          }
        }
      }
    }

    // dark module
    m[size - 8][8] = true;
    reserved[size - 8][8] = true;

    // reserve format info areas
    for (var f = 0; f <= 8; f++) {
      if (!reserved[8][f]) { m[8][f] = false; reserved[8][f] = true; }
      if (!reserved[f][8]) { m[f][8] = false; reserved[f][8] = true; }
    }
    for (var q = 0; q < 8; q++) {
      if (!reserved[8][size - 1 - q]) { m[8][size - 1 - q] = false; reserved[8][size - 1 - q] = true; }
      if (!reserved[size - 1 - q][8]) { m[size - 1 - q][8] = false; reserved[size - 1 - q][8] = true; }
    }

    // reserve version info areas (v >= 7)
    if (version >= 7) {
      for (var vy = 0; vy < 6; vy++) {
        for (var vx = 0; vx < 3; vx++) {
          reserved[vy][size - 11 + vx] = true;
          m[vy][size - 11 + vx] = false;
          reserved[size - 11 + vx][vy] = true;
          m[size - 11 + vx][vy] = false;
        }
      }
    }

    return { size: size, modules: m, reserved: reserved };
  }

  function placeData(grid, codewords) {
    var size = grid.size;
    var m = grid.modules;
    var reserved = grid.reserved;
    var bitIndex = 0;
    var total = codewords.length * 8;
    var upward = true;

    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5; // skip the vertical timing column
      for (var step = 0; step < size; step++) {
        var y = upward ? size - 1 - step : step;
        for (var col = 0; col < 2; col++) {
          var x = right - col;
          if (reserved[y][x]) continue;
          var bit = false;
          if (bitIndex < total) {
            bit = ((codewords[bitIndex >> 3] >>> (7 - (bitIndex & 7))) & 1) === 1;
          }
          m[y][x] = bit;
          bitIndex++;
        }
      }
      upward = !upward;
    }
  }

  function maskFn(mask, x, y) {
    switch (mask) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
      case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
      case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
      default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    }
  }

  function applyMask(grid, mask) {
    var out = grid.modules.map(function (row) { return row.slice(); });
    for (var y = 0; y < grid.size; y++) {
      for (var x = 0; x < grid.size; x++) {
        if (!grid.reserved[y][x] && maskFn(mask, x, y)) out[y][x] = !out[y][x];
      }
    }
    return out;
  }

  function writeFormat(modules, size, ecc, mask) {
    var bits = formatInfo(ecc, mask);
    for (var i = 0; i < 15; i++) {
      var bit = ((bits >>> i) & 1) === 1;
      // copy 1 — around the top-left finder
      if (i < 6) modules[i][8] = bit;
      else if (i === 6) modules[7][8] = bit;
      else if (i === 7) modules[8][8] = bit;
      else if (i === 8) modules[8][7] = bit;
      else modules[8][14 - i] = bit;
      // copy 2 — split across the other two finders
      if (i < 8) modules[8][size - 1 - i] = bit;
      else modules[size - 15 + i][8] = bit;
    }
    modules[size - 8][8] = true; // dark module
  }

  function writeVersion(modules, size, version) {
    if (version < 7) return;
    var bits = versionInfo(version);
    for (var i = 0; i < 18; i++) {
      var bit = ((bits >>> i) & 1) === 1;
      var a = Math.floor(i / 3);
      var b = (i % 3) + size - 11;
      modules[a][b] = bit;
      modules[b][a] = bit;
    }
  }

  function penalty(modules, size) {
    var score = 0;
    var x, y, run, i;

    // rule 1 — runs of 5+ same-colour modules
    for (y = 0; y < size; y++) {
      run = 1;
      for (x = 1; x < size; x++) {
        if (modules[y][x] === modules[y][x - 1]) {
          run++;
          if (run === 5) score += 3;
          else if (run > 5) score += 1;
        } else run = 1;
      }
    }
    for (x = 0; x < size; x++) {
      run = 1;
      for (y = 1; y < size; y++) {
        if (modules[y][x] === modules[y - 1][x]) {
          run++;
          if (run === 5) score += 3;
          else if (run > 5) score += 1;
        } else run = 1;
      }
    }

    // rule 2 — 2x2 blocks
    for (y = 0; y < size - 1; y++) {
      for (x = 0; x < size - 1; x++) {
        var v = modules[y][x];
        if (v === modules[y][x + 1] && v === modules[y + 1][x] && v === modules[y + 1][x + 1]) score += 3;
      }
    }

    // rule 3 — finder-like 1:1:3:1:1 patterns with 4 light modules on one side
    var pat1 = [true, false, true, true, true, false, true, false, false, false, false];
    var pat2 = [false, false, false, false, true, false, true, true, true, false, true];
    function matches(get, start, pat) {
      for (var k = 0; k < 11; k++) if (get(start + k) !== pat[k]) return false;
      return true;
    }
    for (y = 0; y < size; y++) {
      for (x = 0; x <= size - 11; x++) {
        var rowGet = (function (yy) { return function (xx) { return modules[yy][xx]; }; })(y);
        if (matches(rowGet, x, pat1) || matches(rowGet, x, pat2)) score += 40;
      }
    }
    for (x = 0; x < size; x++) {
      for (y = 0; y <= size - 11; y++) {
        var colGet = (function (xx) { return function (yy) { return modules[yy][xx]; }; })(x);
        if (matches(colGet, y, pat1) || matches(colGet, y, pat2)) score += 40;
      }
    }

    // rule 4 — dark/light balance
    var dark = 0;
    for (y = 0; y < size; y++) for (x = 0; x < size; x++) if (modules[y][x]) dark++;
    var pct = (dark * 100) / (size * size);
    score += Math.floor(Math.abs(pct - 50) / 5) * 10;
    void i;
    return score;
  }

  function encode(text, opts) {
    opts = opts || {};
    var ecc = opts.ecc || "M";
    if (!BLOCKS[ecc]) ecc = "M";
    var bytes = utf8Bytes(String(text));

    var version = opts.version || 0;
    if (!version) {
      for (var v = 1; v <= MAX_VERSION; v++) {
        var headerBytes = v < 10 ? 2 : 3; // mode+count bits, rounded up
        if (bytes.length + headerBytes <= dataCapacity(v, ecc)) { version = v; break; }
      }
    }
    if (!version) throw new Error("QR: payload too large (max version " + MAX_VERSION + ")");

    var codewords = buildCodewords(bytes, version, ecc);
    var grid = makeMatrix(version);
    placeData(grid, codewords);

    var best = null;
    var bestScore = Infinity;
    var lo = opts.mask === undefined ? 0 : opts.mask;
    var hi = opts.mask === undefined ? 7 : opts.mask;
    for (var mask = lo; mask <= hi; mask++) {
      var modules = applyMask(grid, mask);
      writeFormat(modules, grid.size, ecc, mask);
      writeVersion(modules, grid.size, version);
      var s = penalty(modules, grid.size);
      if (s < bestScore) { bestScore = s; best = modules; }
    }
    return { size: grid.size, version: version, ecc: ecc, modules: best };
  }

  function draw(canvas, text, opts) {
    opts = opts || {};
    var qr = encode(text, opts);
    var quiet = opts.quiet === undefined ? 4 : opts.quiet;
    var total = qr.size + quiet * 2;
    var scale = opts.scale || Math.max(2, Math.floor((opts.px || 240) / total));
    var px = total * scale;
    var dpr = global.devicePixelRatio || 1;

    canvas.width = px * dpr;
    canvas.height = px * dpr;
    canvas.style.width = px + "px";
    canvas.style.height = px + "px";

    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = opts.light || "#ffffff";
    ctx.fillRect(0, 0, px, px);
    ctx.fillStyle = opts.dark || "#000000";
    for (var y = 0; y < qr.size; y++) {
      for (var x = 0; x < qr.size; x++) {
        if (qr.modules[y][x]) {
          ctx.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
        }
      }
    }
    return qr;
  }

  global.QR = {
    encode: encode,
    draw: draw,
    // exposed for the offline conformance test in tools/
    MAX_VERSION: MAX_VERSION,
    /** Largest byte-mode payload that still fits, at this ECC level. */
    capacity: function (ecc, version) {
      var v = version || MAX_VERSION;
      if (!BLOCKS[ecc]) ecc = "M";
      return dataCapacity(v, ecc) - (v < 10 ? 2 : 3);
    },
    _internal: { makeMatrix: makeMatrix, buildCodewords: buildCodewords, BLOCKS: BLOCKS }
  };
})(typeof window !== "undefined" ? window : globalThis);

if (typeof module !== "undefined" && module.exports) module.exports = globalThis.QR;
