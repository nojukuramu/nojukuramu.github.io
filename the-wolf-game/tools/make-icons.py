#!/usr/bin/env python3
"""make-icons.py — the app icon, drawn in code so there is no binary to lose.

The mark is a crescent: a full moon with a bite taken out of it. It reads as the
moon the whole game happens under and as the bite the game is about, which is
more than a wolf silhouette manages at 48 pixels.

Supersampled 4x and box-filtered, because a crescent is all curve and an aliased
one looks like a chipped plate.
"""
import zlib, struct, math, os

OUT = os.path.join(os.path.dirname(__file__), "..", "icons")
SS = 4

# Ash Blue, matching css/theme.css: deep slate ground, pale moon.
GROUND = (0x10, 0x18, 0x22)
MOON   = (0xBE, 0xD6, 0xE6)
GLOW   = (0x2f, 0x64, 0x84)


def png(path, w, h, rows):
    raw = b"".join(b"\x00" + r for r in rows)
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    hdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)   # RGBA: rounded corners are transparent, not black
    blob = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", hdr) +
            chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(blob)
    return len(blob)


def draw(size, pad_frac, rounded):
    """One icon, supersampled then boxed down."""
    S = size * SS
    pad = S * pad_frac
    inner = S - pad * 2
    radius = inner * 0.235 if rounded else S  # maskable fills the whole square

    cx, cy = S / 2, S / 2
    moon_r = inner * 0.30
    # The bite: a second circle, up and to the right, slightly larger.
    bx, by, br = cx + moon_r * 0.62, cy - moon_r * 0.38, moon_r * 0.86

    big = []
    for y in range(S):
        row = bytearray()
        for x in range(S):
            # rounded-square ground
            dx = abs(x - cx) - (inner / 2 - radius)
            dy = abs(y - cy) - (inner / 2 - radius)
            if rounded:
                d = math.hypot(max(dx, 0), max(dy, 0)) - radius
                inside = d <= 0 and abs(x - cx) <= inner / 2 and abs(y - cy) <= inner / 2
            else:
                inside = True
            if not inside:
                row += bytes((0, 0, 0, 0))
                continue

            # a soft glow rising from the bottom, same idea as the .sky gradient
            t = max(0.0, min(1.0, 1.0 - (y / S)))
            g = [int(GROUND[i] + (GLOW[i] - GROUND[i]) * (0.30 * t)) for i in range(3)]

            dm = math.hypot(x - cx, y - cy)
            db = math.hypot(x - bx, y - by)
            if dm <= moon_r and db > br:
                g = list(MOON)
            row += bytes(g + [255])
        big.append(bytes(row))

    # box filter down
    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            r = g = b = a = 0
            for j in range(SS):
                src = big[y * SS + j]
                for i in range(SS):
                    o = (x * SS + i) * 4
                    # Premultiplied while averaging, so a half-covered edge
                    # pixel does not average towards black.
                    al = src[o + 3]
                    r += src[o] * al; g += src[o + 1] * al; b += src[o + 2] * al
                    a += al
            n = SS * SS
            if a:
                row += bytes((r // a, g // a, b // a, a // n))
            else:
                row += bytes((0, 0, 0, 0))
        rows.append(bytes(row))
    return rows


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    jobs = [
        ("icon-192.png", 192, 0.0, True),
        ("icon-512.png", 512, 0.0, True),
        # Maskable icons get cropped to a circle by some launchers, so the mark
        # sits inside the 80% safe zone with ground filling everything else.
        ("maskable-512.png", 512, 0.0, False),
        ("apple-touch-icon.png", 180, 0.0, False),
    ]
    for name, size, pad, rounded in jobs:
        rows = draw(size, pad, rounded)
        n = png(os.path.join(OUT, name), size, size, rows)
        print("%-24s %4dpx  %6d bytes" % (name, size, n))
