"""Cut the 4x upscale of Aisa into the parts the rig moves.

  python3 upscale.py ../art/source.png RealESRGAN_x4plus_anime_6B.pth up4.png
  python3 cut.py up4.png ../art

Writes atlas.png and parts.json (and rest.png, the parts laid back
together, to compare against up4.png; and assign.npy, who owns which
pixel). Every part is the real artwork where it can be seen, plus a
painted-in continuation wherever another part covers it, so that moving a
lock of hair uncovers more face rather than a hole. Where the parts are is
parts_def.py.

Who owns a pixel is decided by colour as much as by polygon: the polygons
are rough, and a pixel inside the face polygon that is hair-coloured is
hair. Each pixel is explained as one palette colour or an anti-aliased
blend of two, and goes to the first region in priority order whose palette
has its dominant colour. That is what lets the polygons be drawn by hand
in source pixels and still split a one-pixel line cleanly.

Build-time only: numpy, opencv-python, Pillow."""
import json, sys, os
import numpy as np, cv2
from PIL import Image
from parts_def import REGIONS, UNDER, LID_EDGE, DRAW

S = 4
U8 = np.array(Image.open(sys.argv[1]).convert('RGB'))
OUT = sys.argv[2]
U = U8.astype(np.float32)
H, W = U.shape[:2]
lum = U @ np.array([0.299, 0.587, 0.114], np.float32)

# ---- silhouette ---------------------------------------------------------
bgl = (np.abs(U - 27).max(2) < 10).astype(np.uint8)
n, lab = cv2.connectedComponents(bgl, connectivity=4)
border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
isbg = np.isin(lab, list(border))
isbg[440*S:, :] = True          # the two sparkles bottom-right are not her
fg = cv2.GaussianBlur((~isbg).astype(np.float32), (0, 0), 1.6) > 0.5

# ---- palette ------------------------------------------------------------
PAL = {
 'line': (4, 3, 4), 'eyeline': (30, 6, 6),
 'hair': (208, 208, 214), 'hairsh': (174, 162, 186), 'hairhi': (250, 250, 250), 'hairdk': (120, 112, 128),
 'tie': (90, 58, 62),
 'skin': (253, 237, 221), 'skinsh': (214, 186, 182), 'necksh': (222, 196, 188),
 'red': (118, 30, 26), 'red2': (180, 66, 56), 'eyehi': (250, 236, 228),
 'mouth': (130, 70, 70),
 'white': (250, 250, 250), 'whitesh': (184, 172, 180),
 'dress': (77, 77, 81),
 'stripe': (170, 168, 168),
 'brown': (72, 58, 50), 'browndk': (46, 38, 32), 'lace': (120, 104, 80), 'lacehi': (214, 200, 160),
 'bg': (27, 27, 27),
}
NP = list(PAL)
PALV = np.array([PAL[k] for k in NP], np.float32)
DARK = {NP.index('line'), NP.index('eyeline')}
# entries that are the same colour under two names (hair highlight and the
# collar are both white) must be accepted by either owner
EQ = {i: {j for j in range(len(NP)) if np.abs(PALV[i] - PALV[j]).max() < 3} for i in range(len(NP))}
BG = NP.index('bg')

def dominant(px, pal):
    """Each pixel explained as one palette colour or an anti-aliased blend of
    two; returns the dominant one. A blend that is a quarter line counts as
    line, because the source lines are a pixel wide and arrive blended."""
    P = PALV[pal]
    best = np.full(len(px), 1e9, np.float32); dom = np.zeros(len(px), np.int32)
    for a in range(len(pal)):
        d = np.linalg.norm(px - P[a], axis=1)
        b = d < best; best[b] = d[b]; dom[b] = pal[a]
    for a in range(len(pal)):
        for c in range(a + 1, len(pal)):
            v = P[c] - P[a]; vv = float(v @ v)
            if vv < 1: continue
            t = np.clip(((px - P[a]) @ v) / vv, 0, 1)
            d = np.linalg.norm(px - (P[a] + t[:, None]*v), axis=1) + 6.0
            b = d < best; best[b] = d[b]
            th = 0.75 if pal[a] in DARK else (0.25 if pal[c] in DARK else 0.5)
            dom[b] = np.where(t[b] < th, pal[a], pal[c])
    return dom

def poly(pts, dil=0.0):
    m = np.zeros((H, W), np.uint8)
    cv2.fillPoly(m, [np.array([[x*S, y*S] for x, y in pts], np.int32)], 1)
    if dil > 0:
        r = int(round(dil*S))
        m = cv2.dilate(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2*r+1, 2*r+1)))
    return m.astype(bool)

# ---- who owns each pixel ----------------------------------------------
PARTS = list(dict.fromkeys(r[0] for r in REGIONS))
DIL = {'browR': 0.3, 'browL': 0.3, 'lidR': 0.5, 'lidL': 0.5, 'mouth': 0.3, 'ballR': 0.5, 'ballL': 0.5, 'armR': 0.8, 'armL': 0.8}
cand = [poly(p, DIL.get(n, 2.0)) & fg for n, p, _ in REGIONS]
plain = [poly(p) & fg for n, p, _ in REGIONS]
key = np.zeros((H, W), np.int64)
for i, c in enumerate(cand):
    key |= c.astype(np.int64) << i
ys0, xs0 = np.nonzero(key > 0)
keys = key[ys0, xs0]
assign = np.full((H, W), -1, np.int16)
domc = np.full((H, W), -1, np.int16)
for k in np.unique(keys):
    sel = keys == k
    ys, xs = ys0[sel], xs0[sel]
    regs = [i for i in range(len(REGIONS)) if (k >> i) & 1]
    pal = sorted({NP.index(c) for i in regs for c in (REGIONS[i][2] or [])} | {BG})
    d = dominant(U[ys, xs], pal)
    domc[ys, xs] = d
    out = np.full(len(ys), -1, np.int16)
    for i in regs:
        own = list(range(len(NP))) if REGIONS[i][2] is None else \
            sorted(set().union(*[EQ[NP.index(c)] for c in REGIONS[i][2]]))
        m = (out < 0) & np.isin(d, own)
        out[m] = PARTS.index(REGIONS[i][0])
    assign[ys, xs] = out
# whatever no palette claimed (mostly the anti-aliased silhouette) goes to
# the first region that holds it, then to the first that nearly does
for group in (plain, cand):
    for i, m in enumerate(group):
        sel = m & (assign < 0)
        assign[sel] = PARTS.index(REGIONS[i][0])
# specks: hand to the neighbour that surrounds them
for i in range(len(PARTS)):
    m = (assign == i).astype(np.uint8)
    nl, cc, st, _ = cv2.connectedComponentsWithStats(m, connectivity=8)
    for j in range(1, nl):
        if st[j, cv2.CC_STAT_AREA] < 40:
            reg = cc == j
            ring = cv2.dilate(reg.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool) & ~reg
            nb = assign[ring]; nb = nb[(nb >= 0) & (nb != i)]
            if len(nb): assign[reg] = np.bincount(nb).argmax()
# A limb, a lock or a shoe is one piece. Anything else a part picked up -
# a stretch of the dress's outline beside a hand - would fly off with the
# arm, so it goes back to whatever surrounds it.
for name in ('armR', 'armL', 'legR', 'legL', 'shoeR', 'shoeL', 'ear', 'sideR', 'sideL', 'ahoge'):
    i = PARTS.index(name)
    m = (assign == i).astype(np.uint8)
    nl, cc, st, _ = cv2.connectedComponentsWithStats(m, connectivity=8)
    if nl <= 2: continue
    keep = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))
    for j in range(1, nl):
        if j == keep: continue
        reg = cc == j
        ring = cv2.dilate(reg.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool) & ~reg
        nb = assign[ring]; nb = nb[(nb >= 0) & (nb != i)]
        if len(nb): assign[reg] = np.bincount(nb).argmax()
np.save(os.path.join(OUT, 'assign.npy'), assign)

# ---- painting each part -------------------------------------------------
SKIN = np.array(PAL['skin'], np.float32)
INK = np.array([10, 6, 8], np.float32)
L_SKIN = float(SKIN @ np.array([0.299, 0.587, 0.114]))

def nearest_fill(src_mask, want):
    """Colour every pixel of `want` with the colour of the nearest pixel of
    `src_mask` (a Voronoi continuation of the part's own flat colours)."""
    if not src_mask.any():
        return np.zeros((H, W, 3), np.float32)
    _, labels = cv2.distanceTransformWithLabels((~src_mask).astype(np.uint8), cv2.DIST_L2, 5,
                                                labelType=cv2.DIST_LABEL_PIXEL)
    ys, xs = np.nonzero(src_mask)
    lut = np.zeros((labels.max() + 1, 3), np.float32)
    lut[labels[ys, xs]] = U[ys, xs]
    out = np.zeros((H, W, 3), np.float32)
    out[want] = lut[labels[want]]
    return out

def smooth_fill(src_mask, want):
    """A soft continuation of the colours in `src_mask`: normalized
    convolution at growing radii, so skin under an eye or a fringe of hair
    comes out as one smooth tone, not the facets a nearest-pixel fill
    leaves behind."""
    out = nearest_fill(src_mask, want)
    m = src_mask.astype(np.float32)
    done = np.zeros((H, W), bool)
    for sigma in (8, 24, 64):
        den = cv2.GaussianBlur(m, (0, 0), sigma)
        ok = want & ~done & (den > 0.05)
        if ok.any():
            for ch in range(3):
                num = cv2.GaussianBlur(U[..., ch] * m, (0, 0), sigma)
                out[..., ch][ok] = (num[ok] / den[ok])
        done |= ok
    return out

def ink_alpha(mask):
    a = np.clip((L_SKIN - lum) / (L_SKIN - 4.0), 0, 1)
    a[~mask] = 0
    return a

rgba = {}
draw_index = {p: i for i, p in enumerate(DRAW)}
for name in DRAW:
    pi = PARTS.index(name)
    own = assign == pi
    if name.startswith('lid') or name.startswith('brow'):
        # the lash and crease are ink over skin: lift the ink out, with its
        # anti-aliased edge, so it can move over skin that is not the skin
        # it was drawn on
        m = cv2.dilate(own.astype(np.uint8), np.ones((7, 7), np.uint8)).astype(bool) & ~np.isin(assign, [PARTS.index(p) for p in ('ballR', 'ballL')])
        a = ink_alpha(m)
        rgb = np.zeros((H, W, 3), np.float32); rgb[:] = INK
        rgba[name] = (rgb, a.astype(np.float32))
        continue
    front = [PARTS.index(p) for p in DRAW[draw_index[name] + 1:] if p in PARTS] + [PARTS.index('mouth')]
    front += [pi]
    if name == 'face':
        # A ring of skin round each eye, crease and the mouth is repainted
        # rather than kept: it holds the upscaler's halo and the features'
        # anti-aliasing, which stay where they were drawn when the features
        # move, as ghost outlines of an open eye on a closed one.
        # The side locks too: the upscaler left a light halo beside every
        # line, and when the face turns under a lock the halo would slide
        # out from under it as a white stripe.
        feat = np.isin(assign, [PARTS.index(p) for p in ('ballR', 'ballL', 'lidR', 'lidL', 'browR', 'browL', 'mouth', 'sideR', 'sideL')])
        ring = cv2.dilate(feat.astype(np.uint8), np.ones((17, 17), np.uint8)).astype(bool) & own
        own = own & ~ring
    grow = cv2.dilate(own.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (25, 25))).astype(bool)
    region = own | (grow & np.isin(assign, front) & fg)
    outline = np.zeros((H, W), bool)
    inset = cv2.erode(fg.astype(np.uint8), np.ones((13, 13), np.uint8)).astype(bool)
    for pn, pts, ol in UNDER:
        if pn != name: continue
        # only ever under something drawn over this part: an underlay that
        # reached a part drawn behind it would paint over what is visible
        um = poly(pts) & fg & np.isin(assign, front)
        if name == 'hairBack':
            # the back of the head shows past the bangs when she turns; kept
            # a little inside the silhouette, so what shows is an edge of
            # hair rather than a shelf without an outline
            um &= inset
        region |= um
        if ol:
            o = np.zeros((H, W), np.uint8)
            cv2.polylines(o, [np.array([[x*S, y*S] for x, y in pts], np.int32)], True, 1, thickness=5)
            outline |= o.astype(bool) & um
    # the colours a hidden area continues: the part's own, away from its
    # anti-aliased edges and never its line work
    clean = cv2.erode(own.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
    clean &= ~np.isin(domc, list(DARK))
    skin = name in ('face', 'neck', 'ear')
    if name == 'face':
        # and only from skin that is skin: not the light halo, not a shadow
        clean &= np.linalg.norm(U - SKIN, axis=2) < 10
    if not clean.any(): clean = own
    halo = cv2.dilate(region.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
    fill = (smooth_fill if skin else nearest_fill)(clean, halo & ~own)
    rgb = np.where(own[..., None], U, fill)
    fillonly = region & ~own
    rgb[outline & fillonly] = INK
    # straight cuts are softened by half a texel; the silhouette keeps the
    # source's own anti-aliasing because the outline is dark against dark
    alpha = cv2.GaussianBlur(region.astype(np.float32), (0, 0), 0.7)
    rgb = np.where(halo[..., None], rgb, 0)
    rgba[name] = (rgb, alpha)

# ---- pack ------------------------------------------------------------
PAD = 3
boxes = []
for name in DRAW:
    rgb, a = rgba[name]
    ys, xs = np.nonzero(a > 0.004)
    x0, x1 = max(xs.min() - PAD, 0), min(xs.max() + PAD + 1, W)
    y0, y1 = max(ys.min() - PAD, 0), min(ys.max() + PAD + 1, H)
    boxes.append((name, x0, y0, x1, y1))
AW = 2048
order = sorted(boxes, key=lambda b: -(b[4] - b[2]))
placed = {}
x = y = shelf = 0
for name, x0, y0, x1, y1 in order:
    w, h = x1 - x0, y1 - y0
    if x + w > AW:
        x, y, shelf = 0, y + shelf + 2, 0
    placed[name] = (x, y)
    x += w + 2; shelf = max(shelf, h)
AH = y + shelf
AH = 1 << int(np.ceil(np.log2(AH)))
atlas = np.zeros((AH, AW, 4), np.uint8)
meta = {'scale': S, 'width': AW, 'height': AH, 'parts': {}}
for name, x0, y0, x1, y1 in boxes:
    rgb, a = rgba[name]
    u, v = placed[name]
    sub = np.dstack([np.clip(rgb[y0:y1, x0:x1], 0, 255), np.clip(a[y0:y1, x0:x1] * 255, 0, 255)])
    atlas[v:v + (y1 - y0), u:u + (x1 - x0)] = (sub + 0.5).astype(np.uint8)
    meta['parts'][name] = {'x': x0 / S, 'y': y0 / S, 'w': (x1 - x0) / S, 'h': (y1 - y0) / S,
                           'u': int(u), 'v': int(v), 'tw': int(x1 - x0), 'th': int(y1 - y0)}
meta['order'] = DRAW
Image.fromarray(atlas, 'RGBA').save(os.path.join(OUT, 'atlas.png'), optimize=True)
json.dump(meta, open(os.path.join(OUT, 'parts.json'), 'w'), indent=1)

# ---- rest-pose check: the parts laid back together over the background
comp = np.zeros((H, W, 3), np.float32); comp[:] = 27
for name in DRAW:
    rgb, a = rgba[name]
    comp = comp * (1 - a[..., None]) + rgb * a[..., None]
Image.fromarray(np.clip(comp, 0, 255).astype(np.uint8)).save(os.path.join(OUT, 'rest.png'))
print('atlas', AW, AH)
