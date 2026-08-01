#!/usr/bin/env python3
"""Generate the PWA icon set from the desktop app's icon.

The web port shares its identity with the Tauri app, so it shares the icon.
Source lives in the KaraokeNatin repo; the generated PNGs are committed here so
the site needs no build step.

    python3 tools/make-icons.py [path/to/icon.png]

Produces icons/icon-{192,512}.png (transparent, purpose "any"),
icons/maskable-512.png (opaque, art inside the 80% safe zone so Android's
circle/squircle masks do not clip the microphone), and icons/apple-touch.png
(opaque — iOS composites transparency against black).
"""
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "icons")
DEFAULT_SRC = os.path.join(HERE, "..", "..", "..", "KaraokeNatin", "icon.png")

BG = (11, 11, 18, 255)  # --bg, so the opaque variants sit on the app's own dark


def square(img):
    """Trim transparent padding, then centre on a transparent square canvas."""
    box = img.getbbox()
    if box:
        img = img.crop(box)
    side = max(img.size)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(img, ((side - img.width) // 2, (side - img.height) // 2))
    return canvas


def resize(img, size):
    return img.resize((size, size), Image.LANCZOS)


def on_background(img, size, scale=1.0, bg=BG):
    canvas = Image.new("RGBA", (size, size), bg)
    art = resize(img, int(size * scale))
    off = (size - art.width) // 2
    canvas.paste(art, (off, off), art)
    return canvas


def main():
    src_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SRC
    if not os.path.exists(src_path):
        sys.exit("source icon not found: %s" % src_path)

    os.makedirs(OUT, exist_ok=True)
    base = square(Image.open(src_path).convert("RGBA"))

    written = []
    for size in (192, 512):
        path = os.path.join(OUT, "icon-%d.png" % size)
        resize(base, size).save(path, optimize=True)
        written.append(path)

    # Maskable: Android may crop to a circle inscribed in the middle 80%.
    path = os.path.join(OUT, "maskable-512.png")
    on_background(base, 512, scale=0.68).save(path, optimize=True)
    written.append(path)

    path = os.path.join(OUT, "apple-touch.png")
    on_background(base, 180, scale=0.86).save(path, optimize=True)
    written.append(path)

    for p in written:
        print("%-28s %6d bytes" % (os.path.basename(p), os.path.getsize(p)))


if __name__ == "__main__":
    main()
