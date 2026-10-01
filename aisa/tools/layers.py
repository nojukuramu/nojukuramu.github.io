"""Aisa's parts as one layered file you can paint on.

  python3 layers.py pack   [art/aisa.ora]   # the file -> atlas.png + parts.json
  python3 layers.py guides [art/aisa.ora]   # redraw the hidden-area guides

art/aisa.ora is an OpenRaster file - Krita, GIMP and MyPaint open it as
they would their own. It is the drawing at four times its size, with a
group for every part the rig moves, front to back:

  ahoge                           <- one group per part, named for it
    guide: hidden at rest         shaded where nothing shows until she moves
    paint                         yours: paint here
    base (generated)              cut from the drawing by cut.py; locked
  ...
  background                      the page colour, for judging; not packed

What the rig uses is each group flattened - every visible layer in it but
the guides - so you can add layers, groups and erasers inside a part's
group freely. Paint past a part's edge and the part grows: the packer
measures every part again, and the rig gives it a mesh to match.

The base layers belong to cut.py: when the parts are cut again they are
replaced, and everything else in each group is kept. So paint on `paint`
(or layers of your own), never on `base`.

`pack` is the only step between saving the file and seeing the change:
it rewrites art/atlas.png and art/parts.json, says how much of each part
was painted, and warns when a stroke landed somewhere that shows at rest -
there, she no longer matches the drawing.

Needs Pillow and nothing else.
"""
import hashlib
import io
import json
import os
import sys
import zipfile
import xml.etree.ElementTree as ET

from PIL import Image, ImageChops

HERE = os.path.dirname(os.path.abspath(__file__))
ART = os.path.normpath(os.path.join(HERE, '..', 'art'))     # where the real one lives
sys.path.insert(0, HERE)
from parts_def import DRAW  # noqa: E402

S = 4                                   # texels per pixel of the drawing
W, H = 224 * S, 512 * S                 # the canvas: the whole drawing, 4x
BACKGROUND = (27, 27, 27, 255)          # the page's #1b1b1b
GUIDE = (255, 0, 170, 110)              # what "hidden at rest" is shaded with
PAD = 8                                 # texels kept round each part in the atlas
ATLAS_W = 2048

BASE, PAINT, GUIDE_NAME = 'base (generated)', 'paint', 'guide: hidden at rest'


def is_guide(name):
    return name.strip().lower().startswith('guide')


def is_base(name):
    return name.strip().lower().startswith('base')


# ---- reading ---------------------------------------------------------------

class Ora:
    """An .ora opened for reading: its stack, and its layers on demand."""

    def __init__(self, path):
        self.path = path
        self.zip = zipfile.ZipFile(path)
        self.root = ET.fromstring(self.zip.read('stack.xml'))
        self.size = (int(self.root.get('w')), int(self.root.get('h')))
        if self.size != (W, H):
            raise SystemExit('%s is %dx%d; the parts are drawn on a %dx%d canvas. '
                             'Resize the canvas back (without scaling the layers).'
                             % (path, self.size[0], self.size[1], W, H))
        self.stack = self.root.find('stack')

    def png(self, src):
        return Image.open(io.BytesIO(self.zip.read(src))).convert('RGBA')

    def parts(self):
        """part id -> its element, searching groups the painter may have
        wrapped round them; the outermost element of that name wins."""
        found = {}

        def walk(el):
            for child in el:
                name = (child.get('name') or '').strip()
                if name in DRAW and child.tag in ('stack', 'layer'):
                    if name in found:
                        raise SystemExit('two layers or groups are called "%s"; '
                                         'the packer cannot tell which is the part' % name)
                    found[name] = child
                elif child.tag == 'stack':
                    walk(child)
        walk(self.stack)
        return found


def place(img, x, y):
    """A layer, wherever it was saved, on a canvas the size of the drawing."""
    full = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    full.paste(img, (x, y))
    return full


def with_opacity(img, opacity):
    if opacity >= 0.999:
        return img
    r, g, b, a = img.split()
    a = a.point(lambda v: int(round(v * opacity)))
    return Image.merge('RGBA', (r, g, b, a))


# The blending modes a shading or highlight layer is usually set to, as
# OpenRaster names them (Krita writes its own as "krita:<name>").
MODES = {
    'multiply': ImageChops.multiply, 'screen': ImageChops.screen, 'overlay': ImageChops.overlay,
    'darken': ImageChops.darker, 'lighten': ImageChops.lighter, 'plus': ImageChops.add,
    'addition': ImageChops.add, 'hard-light': ImageChops.hard_light, 'soft-light': ImageChops.soft_light,
}


def blend(dst, src, op, notes, where):
    """A layer onto what is under it in its group: over it, through a
    blending mode, or cutting it away. Anything else is painted over as
    Normal, and said so."""
    op = (op or 'svg:src-over').lower()
    mode = op.split(':', 1)[-1]
    if mode in ('dst-out', 'erase'):
        r, g, b, a = dst.split()
        a = ImageChops.multiply(a, ImageChops.invert(src.getchannel('A')))
        return Image.merge('RGBA', (r, g, b, a))
    if mode in MODES:
        # the blended colour where there is something under the layer, the
        # layer's own where there is not, then laid over as usual
        under = dst.convert('RGB')
        mixed = MODES[mode](under, src.convert('RGB'))
        rgb = Image.composite(mixed, src.convert('RGB'), dst.getchannel('A'))
        rgb.putalpha(src.getchannel('A'))
        # a blending mode changes colour, never coverage: it paints only
        # where the part already is
        return Image.alpha_composite(dst, _clip_to(rgb, dst))
    if mode != 'src-over':
        notes.append('%s: blending mode %s is packed as Normal' % (where, op))
    return Image.alpha_composite(dst, src)


def _clip_to(img, under):
    a = ImageChops.multiply(img.getchannel('A'), under.getchannel('A'))
    img = img.copy()
    img.putalpha(a)
    return img


def flatten(ora, el, part, notes, only_base=False):
    """A part's group as the rig will see it: every visible layer, bottom
    to top, except the guides. The base counts even when hidden - hiding
    it to look at the paint alone must not delete the part."""
    def opacity(e):
        try:
            return float(e.get('opacity', '1'))
        except ValueError:
            return 1.0

    if el.tag == 'layer':
        return with_opacity(place(ora.png(el.get('src')), int(el.get('x', 0)), int(el.get('y', 0))), opacity(el))
    canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    for child in reversed(list(el)):            # stack.xml lists the top first
        if child.tag not in ('stack', 'layer'):
            continue
        name = child.get('name') or ''
        if is_guide(name):
            continue
        base = is_base(name)
        if only_base and not base:
            continue
        if child.get('visibility', 'visible') == 'hidden' and not base:
            notes.append('%s: hidden layer "%s" left out' % (part, name))
            continue
        if child.tag == 'stack':
            img = with_opacity(flatten(ora, child, part, notes), opacity(child))
        else:
            img = with_opacity(place(ora.png(child.get('src')), int(child.get('x', 0)), int(child.get('y', 0))),
                               opacity(child))
        canvas = blend(canvas, img, child.get('composite-op'), notes, '%s / %s' % (part, name))
    return canvas


def read_parts(path, only_base=False):
    ora = Ora(path)
    els = ora.parts()
    missing = [p for p in DRAW if p not in els]
    if missing:
        raise SystemExit('%s has no layer or group for: %s' % (path, ', '.join(missing)))
    notes = []
    parts = {p: flatten(ora, els[p], p, notes, only_base) for p in DRAW}
    return parts, notes


# ---- what shows at rest ----------------------------------------------------

def coverage_in_front(parts):
    """For each part, how opaque everything drawn over it is at rest."""
    cover, acc = {}, Image.new('L', (W, H), 0)
    for name in reversed(DRAW):
        cover[name] = acc
        acc = ImageChops.screen(acc, parts[name].getchannel('A'))
    return cover


def hidden_mask(part, cover):
    """Where a part has paint that nothing shows at rest."""
    covered = cover.point(lambda v: 255 if v >= 250 else 0)
    there = part.getchannel('A').point(lambda v: 255 if v > 0 else 0)
    return ImageChops.multiply(covered, there)


def count(mask):
    return sum(mask.point(lambda v: 1 if v else 0).histogram()[1:])


# ---- writing ----------------------------------------------------------------

def crop_layer(img):
    """A layer saved at the size of what is on it, with its offset."""
    box = img.getchannel('A').getbbox()
    if not box:
        return Image.new('RGBA', (1, 1), (0, 0, 0, 0)), 0, 0
    return img.crop(box), box[0], box[1]


def png_bytes(img):
    b = io.BytesIO()
    img.save(b, 'PNG', optimize=True)
    return b.getvalue()


def write_ora(path, bases):
    """Write (or rewrite) the file with these base layers. Whatever else
    the existing file has in each part's group - paint, layers and groups
    of the painter's own - is carried over as it was; the guides are drawn
    again from what the parts now are."""
    kept, extra = {}, []
    files = {}                       # zip name -> bytes, for kept layers
    if os.path.exists(path):
        old = Ora(path)
        els = old.parts()
        counter = [0]

        def adopt(el):
            """Copy a kept element, and the layer images it points at,
            under fresh names."""
            el = _copy(el)
            for node in el.iter('layer'):
                counter[0] += 1
                new = 'data/kept-%03d.png' % counter[0]
                files[new] = old.zip.read(node.get('src'))
                node.set('src', new)
            return el

        for p in DRAW:
            if p in els and els[p].tag == 'stack':
                kept[p] = [adopt(c) for c in els[p]
                           if c.tag in ('stack', 'layer') and not is_base(c.get('name') or '')
                           and not is_guide(c.get('name') or '')]
            elif p in els:
                # the part was flattened into a single layer: that layer is
                # paint now, over a fresh base
                kept[p] = [adopt(els[p])]
                kept[p][0].set('name', PAINT)
        def keep_extras(el):
            # layers of the painter's own outside the parts - a reference,
            # a sketch - are kept, even inside a group wrapped round the
            # parts (which is itself unwrapped: the parts go back to the top)
            for c in el:
                n = (c.get('name') or '').strip()
                if c.tag not in ('stack', 'layer') or n in DRAW or (n == 'background' and el is old.stack):
                    continue
                if _holds_parts(c):
                    keep_extras(c)
                else:
                    extra.append(adopt(c))
        keep_extras(old.stack)

    # the parts as they will be, for the guides and the flattened preview
    finals = {}
    for p in DRAW:
        canvas = bases[p]
        for el in reversed(kept.get(p, [])):
            if el.get('visibility', 'visible') == 'hidden':
                continue
            tmp = _Mem(files)
            img = flatten(tmp, el, p, []) if el.tag == 'stack' else \
                with_opacity(place(tmp.png(el.get('src')), int(el.get('x', 0)), int(el.get('y', 0))),
                             float(el.get('opacity', '1')))
            canvas = blend(canvas, img, el.get('composite-op'), [], p)
        finals[p] = canvas
    cover = coverage_in_front(finals)

    image = ET.Element('image', {'version': '0.0.5', 'w': str(W), 'h': str(H), 'xres': '72', 'yres': '72'})
    root = ET.SubElement(image, 'stack')
    for el in extra:
        root.append(el)
    for p in reversed(DRAW):                    # the frontmost part first
        g = ET.SubElement(root, 'stack', {'name': p, 'opacity': '1.0', 'visibility': 'visible',
                                          'composite-op': 'svg:src-over', 'isolation': 'isolate',
                                          'x': '0', 'y': '0'})
        guide = Image.new('RGBA', (W, H), GUIDE)
        guide.putalpha(ImageChops.multiply(hidden_mask(finals[p], cover[p]),
                                           Image.new('L', (W, H), GUIDE[3])))
        gi, gx, gy = crop_layer(guide)
        files['data/%s-guide.png' % p] = png_bytes(gi)
        _layer(g, GUIDE_NAME, 'data/%s-guide.png' % p, gx, gy, visible=False, locked=True)
        if p in kept and kept[p]:
            for el in kept[p]:
                g.append(el)
        else:
            # a whole-canvas layer, so an editor with fixed-size layers
            # (GIMP) still has room to paint past the part's edge
            files['data/%s-paint.png' % p] = png_bytes(Image.new('RGBA', (W, H), (0, 0, 0, 0)))
            _layer(g, PAINT, 'data/%s-paint.png' % p, 0, 0, selected=(p == 'face'))
        bi, bx, by = crop_layer(bases[p])
        files['data/%s-base.png' % p] = png_bytes(bi)
        _layer(g, BASE, 'data/%s-base.png' % p, bx, by, locked=True)
    files['data/background.png'] = png_bytes(Image.new('RGBA', (W, H), BACKGROUND))
    _layer(root, 'background', 'data/background.png', 0, 0, locked=True)

    merged = Image.new('RGBA', (W, H), BACKGROUND)
    for p in DRAW:
        merged = Image.alpha_composite(merged, finals[p])
    thumb = merged.copy()
    thumb.thumbnail((256, 256))

    tmp = path + '.tmp'
    with zipfile.ZipFile(tmp, 'w') as z:
        # the format's one hard rule: "mimetype" first, and not compressed
        z.writestr(zipfile.ZipInfo('mimetype'), 'image/openraster', compress_type=zipfile.ZIP_STORED)
        z.writestr('stack.xml', ET.tostring(image, encoding='UTF-8', xml_declaration=True),
                   compress_type=zipfile.ZIP_DEFLATED)
        for name in sorted(files):
            z.writestr(name, files[name], compress_type=zipfile.ZIP_STORED)
        z.writestr('mergedimage.png', png_bytes(merged), compress_type=zipfile.ZIP_STORED)
        z.writestr('Thumbnails/thumbnail.png', png_bytes(thumb), compress_type=zipfile.ZIP_STORED)
    os.replace(tmp, path)


def _layer(parent, name, src, x, y, visible=True, locked=False, selected=False):
    a = {'name': name, 'src': src, 'x': str(x), 'y': str(y), 'opacity': '1.0',
         'visibility': 'visible' if visible else 'hidden', 'composite-op': 'svg:src-over'}
    if locked:
        a['edit-locked'] = 'true'
    if selected:
        a['selected'] = 'true'
    return ET.SubElement(parent, 'layer', a)


def _copy(el):
    return ET.fromstring(ET.tostring(el))


def _holds_parts(el):
    return any((n.get('name') or '').strip() in DRAW for n in el.iter() if n is not el)


class _Mem:
    """Reads kept layers back out of the bytes about to be written."""
    def __init__(self, files):
        self.files = files

    def png(self, src):
        return Image.open(io.BytesIO(self.files[src])).convert('RGBA')


# ---- packing ------------------------------------------------------------------

def pack(path, out_dir=None, quiet=False):
    """The file, flattened part by part, into the atlas the page loads -
    written beside the file, so a copy being tried out elsewhere never
    overwrites the real one."""
    out_dir = out_dir or os.path.dirname(os.path.abspath(path))
    parts, notes = read_parts(path)
    bases, _ = read_parts(path, only_base=True)

    boxes = []
    for name in DRAW:
        box = parts[name].getchannel('A').getbbox()
        if not box:
            raise SystemExit('"%s" is empty: there is nothing left to draw' % name)
        x0, y0 = max(box[0] - PAD, 0), max(box[1] - PAD, 0)
        x1, y1 = min(box[2] + PAD, W), min(box[3] + PAD, H)
        boxes.append((name, x0, y0, x1, y1))
    # shelves, tallest first: the same packing cut.py always used
    placed, x, y, shelf = {}, 0, 0, 0
    for name, x0, y0, x1, y1 in sorted(boxes, key=lambda b: -(b[4] - b[2])):
        w, h = x1 - x0, y1 - y0
        if x + w > ATLAS_W:
            x, y, shelf = 0, y + shelf + 4, 0
        placed[name] = (x, y)
        x += w + 4
        shelf = max(shelf, h)
    atlas_h = 1
    while atlas_h < y + shelf:
        atlas_h *= 2                        # a power of two, for mipmaps
    atlas = Image.new('RGBA', (ATLAS_W, atlas_h), (0, 0, 0, 0))
    meta = {'scale': S, 'width': ATLAS_W, 'height': atlas_h, 'parts': {}}
    for name, x0, y0, x1, y1 in boxes:
        u, v = placed[name]
        atlas.paste(parts[name].crop((x0, y0, x1, y1)), (u, v))
        meta['parts'][name] = {'x': x0 / S, 'y': y0 / S, 'w': (x1 - x0) / S, 'h': (y1 - y0) / S,
                               'u': u, 'v': v, 'tw': x1 - x0, 'th': y1 - y0}
    meta['order'] = DRAW
    with open(path, 'rb') as f:
        meta['source'] = {'file': os.path.basename(path), 'sha1': hashlib.sha1(f.read()).hexdigest()}
    atlas.save(os.path.join(out_dir, 'atlas.png'), optimize=True)
    with open(os.path.join(out_dir, 'parts.json'), 'w') as f:
        json.dump(meta, f, indent=1)

    if quiet:
        return meta
    # what was painted, and how much of it shows before she moves
    cover = coverage_in_front(parts)
    painted_any = False
    for name in DRAW:
        diff = ImageChops.difference(parts[name], bases[name])
        changed = diff.convert('L').point(lambda v: 255 if v > 6 else 0)
        n = count(changed)
        if not n:
            continue
        painted_any = True
        shows = ImageChops.multiply(changed, cover[name].point(lambda v: 0 if v >= 250 else 255))
        shown = count(shows)
        grew = parts[name].getchannel('A').getbbox() != bases[name].getchannel('A').getbbox()
        line = '  %-9s %8.1f px painted' % (name, n / (S * S))
        if grew:
            line += ', part grew'
        if shown:
            line += ', %.1f px of it showing at rest' % (shown / (S * S))
        print(line)
    if not painted_any:
        print('  nothing painted yet: every part is its base')
    for n in notes:
        print('  note: ' + n)
    print('packed %s -> atlas.png %dx%d, parts.json' % (os.path.basename(path), ATLAS_W, atlas_h))
    return meta


def main(argv):
    if len(argv) < 2 or argv[1] not in ('pack', 'guides'):
        sys.exit(__doc__)
    path = argv[2] if len(argv) > 2 else os.path.join(ART, 'aisa.ora')
    if argv[1] == 'pack':
        pack(path)
    else:
        bases, _ = read_parts(path, only_base=True)
        write_ora(path, bases)
        pack(path, quiet=True)
        print('guides redrawn in %s (and the atlas packed again)' % os.path.basename(path))


if __name__ == '__main__':
    main(sys.argv)
