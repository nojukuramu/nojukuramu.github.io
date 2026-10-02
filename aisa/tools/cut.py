"""Cut the 4x upscale of Aisa into the parts the rig moves.

  python3 upscale.py ../art/source.png RealESRGAN_x4plus_anime_6B.pth up4.png
  python3 cut.py up4.png ../art [debug_dir]

Writes the parts as the base layers of aisa.ora - keeping everything
painted over them there (layers.py) - then packs the file into atlas.png
and parts.json. With a debug_dir, also rest.png there (the parts laid back
together, to compare against up4.png) and assign.npy (who owns which
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

Build-time only: numpy, opencv-python, Pillow, potracer (pip install potracer)."""
import json, sys, os
import numpy as np, cv2
from PIL import Image
from parts_def import REGIONS, UNDER, LID_EDGE, DRAW, DRESS_SIL, SEAM_L, SEAM_R

S = 4
U8 = np.array(Image.open(sys.argv[1]).convert('RGB'))
OUT = sys.argv[2]
DEBUG = sys.argv[3] if len(sys.argv) > 3 else None
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
DIL = {'browR': 0.3, 'browL': 0.3, 'lidR': 0.5, 'lidL': 0.5, 'mouth': 0.3, 'ballR': 0.5, 'ballL': 0.5, 'armR': 0.8, 'armL': 0.8,
       'face': 0.4, 'neck': 0.6, 'dress': 0.8}
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

# A line between two parts belongs to the one in front: it is that part's
# outline. Where the colour test split a line down the middle - half to a
# side lock, half to the hair behind it - the two halves part company the
# moment the lock sways, and the outline reads as broken. So line pixels
# touching a front part's fill are handed to it, front to back. Limbs and
# the eyes are left out: their polygons are traced to the pixel already.
isdark = np.isin(domc, list(DARK))
L_SKIN = float(np.array(PAL['skin'], np.float32) @ np.array([0.299, 0.587, 0.114]))
LINE_OWNERS = ['ahoge', 'frontHair', 'sideL', 'sideR', 'face', 'ear', 'collar', 'ponytail']
NOT_VICTIMS = {PARTS.index(p) for p in ('ballR', 'ballL', 'lidR', 'lidL', 'browR', 'browL', 'mouth',
                                          'armR', 'armL', 'legR', 'legL', 'shoeR', 'shoeL')}
for name in sorted(LINE_OWNERS, key=lambda n: -DRAW.index(n)):
    i = PARTS.index(name)
    behind = [PARTS.index(p) for p in DRAW[:DRAW.index(name)] if PARTS.index(p) not in NOT_VICTIMS]
    near = cv2.dilate(((assign == i) & ~isdark).astype(np.uint8), np.ones((7, 7), np.uint8)).astype(bool)
    # grow along the line itself, so a line claimed at one end is claimed
    # along its width rather than in a 1px sliver
    victim = np.isin(assign, behind)
    steal = near & isdark & victim
    for _ in range(5):
        steal |= cv2.dilate(steal.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool) & isdark & victim
    # and the line's anti-aliased fringe on the far side, or that fringe
    # stays behind when the part moves, as a dotted ghost of the line
    lines = steal | ((assign == i) & isdark)
    # (darker than the part it lies on: on skin, nearly anything that is
    # not skin; on hair, what is darker than the hair's own shadow)
    dark_for = np.where(np.isin(assign, [PARTS.index(p) for p in ('face', 'ear', 'neck')]), L_SKIN - 12, 150)
    fringe = cv2.dilate(lines.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool) & victim & ~isdark & (lum < dark_for)
    # on skin the fringe runs on into the soft shadow a lock or the bangs
    # cast just under their edge; that shadow is theirs too, and goes with
    # them
    on_skin = victim & np.isin(assign, [PARTS.index(p) for p in ('face', 'ear', 'neck')]) & ~isdark & (lum < L_SKIN - 12)
    for _ in range(4):
        fringe |= cv2.dilate(fringe.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool) & on_skin
    fringe &= ~np.isin(assign, [PARTS.index('dress')])
    assign[steal | fringe] = i
# An eyeball is what is inside its outline, and the outline. The light
# halo the upscaler drew round it outside matches the eye's own whites and
# highlights, so it was claimed too; left there it is a ring of pale and
# pink specks on skin that is otherwise clean. It goes to the face, which
# repaints it.
EYE_C = {'ballR': (103.6, 206.2), 'ballL': (148.2, 205.6)}
# Under the lash, the iris and its highlights are the eye's, however close
# they come to the ink: the lash takes only what is ink, or nearly. Taken
# by the lash, a pink glint is measured as faint ink over skin and drawn as
# a grey smudge over the iris.
for lid, ball in (('lidR', 'ballR'), ('lidL', 'ballL')):
    inner = poly([p for n, p, pal in REGIONS if n == ball and pal is None][0])
    m = inner & (assign == PARTS.index(lid)) & (U[..., 0] > 75)
    assign[m] = PARTS.index(ball)
for name, (ecx, ecy) in EYE_C.items():
    i = PARTS.index(name)
    m = assign == i
    # along each ray out from the middle of the eye, the outermost pixel of
    # its outline; anything of the eye's beyond that is halo. Rays that
    # meet no outline (the top, where the lash is the lid's) are left be.
    cx, cy = ecx * S, ecy * S
    ang = np.linspace(-np.pi, np.pi, 1440, endpoint=False)
    rad = np.arange(0, 20 * S, 0.5)
    px = np.clip((cx + np.cos(ang)[:, None] * rad[None]).astype(int), 0, W - 1)
    py = np.clip((cy + np.sin(ang)[:, None] * rad[None]).astype(int), 0, H - 1)
    hit = m[py, px] & isdark[py, px]
    last = np.where(hit.any(1), rad[hit.shape[1] - 1 - np.argmax(hit[:, ::-1], axis=1)], np.inf)
    # the iris has dark of its own; only a hit out near where the outline
    # should be counts, and never upwards, where the outline is the lash's
    ell_r = S / np.sqrt((np.cos(ang) / 9.8) ** 2 + (np.sin(ang) / 14.0) ** 2)
    last[(last < 0.8 * ell_r) | (np.sin(ang) < -0.35)] = np.inf
    ys, xs = np.nonzero(m)
    a = np.arctan2(ys - cy, xs - cx)
    k = ((a + np.pi) / (2 * np.pi) * len(ang)).astype(int) % len(ang)
    r = np.hypot(ys - cy, xs - cx)
    halo = r > last[k] + 2
    assign[ys[halo], xs[halo]] = PARTS.index('face')
# Outlines, by what they touch. A hand-drawn polygon reaches ink only
# roughly: it takes a stub of the hair's outline beside a hand, and misses
# half of a line it only half covers. So for the pieces that move on their
# own, an outline pixel goes to the part whose fill it touches (within
# about a line's width of it), and to the one in front where it touches two:
# the line between an arm and the dress is the arm's. An outline that
# touches nothing of the part that held it is somebody else's stub, and
# goes to whatever it does touch.
_pv = np.array([PAL[k] for k in PAL if k != 'bg'], np.float32)
_dmin = np.full((H, W), 1e9, np.float32)
for _c in _pv:
    _dmin = np.minimum(_dmin, np.abs(U - _c).max(2))
pure = _dmin < 14

def outline_pass(parts, reach, far_reach):
    pidx = [PARTS.index(p) for p in parts]
    held = np.isin(assign, pidx) | (assign < 0)
    # fill is a pixel that is one of the drawing's flat colours; everything
    # else - ink, and every anti-aliased blend of ink with a colour - is
    # outline, and is owned by what it touches. A blend of dress and ink
    # that the colour test called skin is how a hand ended up with a spike.
    ink = fg & held & (isdark | (assign < 0) | ~pure)
    fill = {}
    for p in range(len(PARTS)):
        if PARTS[p] in ('ballR', 'ballL', 'lidR', 'lidL', 'browR', 'browL', 'mouth'): continue
        f = (assign == p) & ~isdark & pure
        if f.any(): fill[p] = cv2.distanceTransform((~f).astype(np.uint8), cv2.DIST_L2, 5)
    order = sorted(fill, key=lambda p: DRAW.index(PARTS[p]) if PARTS[p] in DRAW else -1)
    ys, xs = np.nonzero(ink)
    owner = np.full(len(ys), -1, np.int16)
    for p in order:                                   # back to front: the last to claim wins
        owner[fill[p][ys, xs] <= reach.get(PARTS[p], 4.5)] = p
    near = np.full(len(ys), 1e9, np.float32); nowner = np.full(len(ys), -1, np.int16)
    for p in order:
        d = fill[p][ys, xs]; b = d < near; near[b] = d[b]; nowner[b] = p
    lost = owner < 0
    take = lost & (near <= far_reach)
    owner[take] = nowner[take]
    # An outline is as wide as a line. Dark further from a limb than that is
    # the shadow in the gap between it and the body, and goes with neither:
    # on the arm it travels as a black chip along its edge.
    limbs = [PARTS.index(p) for p in ('armR', 'armL', 'legR', 'legL')]
    limb = np.isin(nowner, limbs)
    # (against the background there is no body behind the arm, so its
    # outline is all its own; it is the gap only where something else is near)
    other = np.full(len(ys), 1e9, np.float32)
    for p in order:
        if p in limbs: continue
        other = np.minimum(other, fill[p][ys, xs])
    gap = take & limb & (near > 4.5) & (other <= 10.0)
    owner[gap] = -2
    assign[ys, xs] = np.where(owner >= 0, owner, np.where(owner == -2, -1, assign[ys, xs]))

OUTLINED = ['armR', 'armL', 'legR', 'legL', 'shoeR', 'shoeL', 'dress', 'neck', 'collar', 'ear']
outline_pass(OUTLINED, {}, 14.0)
for name in ('armR', 'armL', 'legR', 'legL', 'shoeR', 'shoeL'):
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
if DEBUG:
    np.save(os.path.join(DEBUG, 'assign.npy'), assign)

# The upscaler left a light halo beside every line. On skin it is lighter
# than the skin itself, which nothing on her face legitimately is (the eye
# highlights belong to the eyes), so it goes: a halo that stayed would slide
# out from under a lock of hair as a white stripe when she turns.
SKIN = np.array(PAL['skin'], np.float32)
L_SKIN = float(SKIN @ np.array([0.299, 0.587, 0.114]))
for name in ('face', 'ear', 'neck'):
    m = (assign == PARTS.index(name)) & (lum > L_SKIN + 1.5)
    U[m] = SKIN
    lum[m] = L_SKIN

# What each pixel is, judged against the whole palette rather than only the
# colours of the parts that could own it. Where only the hair could own a
# pixel, a stray of skin from the edge of a forearm reads as the hair's
# white highlight; against everything, it reads as skin.
ALLPAL = [i for i in range(len(NP)) if i != BG] + [BG]
dom_all = np.full((H, W), -1, np.int16)
ys_, xs_ = np.nonzero(assign >= 0)
for k in range(0, len(ys_), 400000):
    dom_all[ys_[k:k + 400000], xs_[k:k + 400000]] = dominant(U[ys_[k:k + 400000], xs_[k:k + 400000]], ALLPAL)
SKINLIKE = [NP.index(k) for k in ('skin', 'skinsh', 'necksh')]

def smooth_curve(pts, n=8):
    """A Catmull-Rom curve through the points: the seam is measured at a few
    places and passes through them smoothly, not in straight runs that kink
    where the measurements disagree by a pixel."""
    P = [pts[0]] + list(pts) + [pts[-1]]
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = (np.array(P[i + k], np.float64) for k in (-1, 0, 1, 2))
        for u in np.linspace(0, 1, n, endpoint=False):
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * u + (2*p0 - 5*p1 + 4*p2 - p3) * u*u + (-p0 + 3*p1 - 3*p2 + p3) * u**3))
    out.append(np.array(pts[-1], np.float64))
    return [tuple(q) for q in out]

# ---- painting each part -------------------------------------------------
INK = np.array([10, 6, 8], np.float32)

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

def strand_fill(src_mask, want, reach=60 * S):
    """Hair hangs, and so does a sock: a hidden stretch of either is what
    is above it and what is below it in the same column, blended down the
    gap - strand lines, stripes and highlights carried through - rather
    than the nearest colour smeared sideways. A column with only one side
    within reach takes that side; one with neither falls back to the
    nearest colour."""
    out = nearest_fill(src_mask, want)
    rowi = np.arange(H)[:, None]
    above = np.maximum.accumulate(np.where(src_mask, rowi, -1), axis=0)
    below = np.minimum.accumulate(np.where(src_mask, rowi, H)[::-1], axis=0)[::-1]
    ok_a = want & (above >= 0) & (rowi - above <= reach)
    ok_b = want & (below < H) & (below - rowi <= reach)
    cols = np.broadcast_to(np.arange(W)[None, :], (H, W))
    both = ok_a & ok_b
    ys, xs = np.nonzero(both)
    t = ((ys - above[ys, xs]) / np.maximum(below[ys, xs] - above[ys, xs], 1))[:, None]
    out[ys, xs] = U[above[ys, xs], xs] * (1 - t) + U[below[ys, xs], xs] * t
    ys, xs = np.nonzero(ok_a & ~ok_b); out[ys, xs] = U[above[ys, xs], xs]
    ys, xs = np.nonzero(ok_b & ~ok_a); out[ys, xs] = U[below[ys, xs], xs]
    return out

def smooth_fill(src_mask, want):
    """A soft continuation of the colours in `src_mask`, for skin: an
    average of the source around each pixel at several radii, the finer
    ones trusted wherever they have enough to go on. Blended rather than
    switched between radii, so the fill has no contours of its own - a
    switched fill draws a faint ring wherever one radius hands over to the
    next, and a closing eye uncovers it."""
    m = src_mask.astype(np.float32)
    out = np.zeros((H, W, 3), np.float32)
    first = True
    # the wide radii are smooth by construction, so they are worked out at a
    # quarter of the size and scaled back up: the same fill, in a fraction
    # of the time
    q = (W // 4, H // 4)
    mq = cv2.resize(m, q, interpolation=cv2.INTER_AREA)
    Uq = [cv2.resize(U[..., ch] * m, q, interpolation=cv2.INTER_AREA) for ch in range(3)]
    for sigma in (256, 96, 32, 12, 5):
        est = np.zeros((H, W, 3), np.float32)
        if sigma >= 32:
            denq = cv2.GaussianBlur(mq, (0, 0), sigma / 4)
            den = cv2.resize(denq, (W, H), interpolation=cv2.INTER_LINEAR)
            for ch in range(3):
                nq = cv2.GaussianBlur(Uq[ch], (0, 0), sigma / 4)
                est[..., ch] = cv2.resize(nq / np.maximum(denq, 1e-6), (W, H), interpolation=cv2.INTER_LINEAR)
        else:
            den = cv2.GaussianBlur(m, (0, 0), sigma)
            for ch in range(3):
                est[..., ch] = cv2.GaussianBlur(U[..., ch] * m, (0, 0), sigma) / np.maximum(den, 1e-6)
        if first:
            out = est; first = False
        else:
            conf = np.clip(den / 0.25, 0, 1)[..., None]
            out = out * (1 - conf) + est * conf
    res = np.zeros((H, W, 3), np.float32)
    res[want] = out[want]
    return res

FACE_BG = None   # the face's own luminance, shading and all, once painted

def ink_alpha(mask):
    """How much ink is on each pixel: how far it is from the skin under it
    towards black. The skin under it is the face as painted (with the pink
    of the shadow under the bangs), not one flat skin tone - measured
    against flat skin, that shadow reads as faint ink and slides about
    with the lash as a grey film. The faintest tenth is dropped for the
    same reason."""
    bgl = FACE_BG if FACE_BG is not None else np.full((H, W), L_SKIN, np.float32)
    a = np.clip((bgl - lum) / np.maximum(bgl - 4.0, 1), 0, 1)
    a = np.clip((a - 0.1) / 0.9, 0, 1)
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
        feat = np.isin(assign, [PARTS.index(p) for p in ('ballR', 'ballL', 'lidR', 'lidL', 'mouth')])
        thin = np.isin(assign, [PARTS.index(p) for p in ('browR', 'browL')])
        ring = (cv2.dilate(feat.astype(np.uint8), np.ones((17, 17), np.uint8)).astype(bool) |
                cv2.dilate(thin.astype(np.uint8), np.ones((11, 11), np.uint8)).astype(bool)) & own
        face_ring = ring
        own = own & ~ring
    # a short way under its neighbours in front, enough that no hairline of
    # background opens between two parts at rest; the collar stops at the
    # chin, or lifting her head would lift white out from under it
    grow = cv2.dilate(own.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13))).astype(bool)
    ext_into = [p for p in front if not (name == 'collar' and p == PARTS.index('face'))]
    ext = grow & np.isin(assign, ext_into) & fg
    # Where a painted-in stretch has a drawn edge of its own (the end of the
    # hair behind an arm, the side seam under a sleeve), that edge is where
    # the part stops: the seam-hiding margin above may not spill past it,
    # or the moment the arm moves there is a sliver of hair beyond the tips.
    ol_mask = np.zeros((H, W), bool)
    for pn, pts, ol in UNDER:
        if pn == name and ol:
            ol_mask |= poly(pts)
    if ol_mask.any():
        ext &= ~(cv2.dilate(ol_mask.astype(np.uint8), np.ones((41, 41), np.uint8)).astype(bool) & ~ol_mask)
    region = own | ext
    if name == 'dress':
        region &= poly(DRESS_SIL, 2.5) | own
    outline = np.zeros((H, W), bool)
    rim = cv2.distanceTransform(fg.astype(np.uint8), cv2.DIST_L2, 5) < 1.1 * S
    for pn, pts, ol in UNDER:
        if pn != name: continue
        # only ever under something drawn over this part: an underlay that
        # reached a part drawn behind it would paint over what is visible
        um = poly(pts) & fg & np.isin(assign, front)
        region |= um
        if ol:
            o = np.zeros((H, W), np.uint8)
            cv2.polylines(o, [np.array([[x*S, y*S] for x, y in pts], np.int32)], True, 1, thickness=5)
            outline |= o.astype(bool) & um
        if name == 'hairBack':
            # the back of the head shows past the bangs when she turns: it
            # reaches the silhouette and carries the silhouette's outline,
            # so what shows is the back of her hair, not a shelf of grey.
            # Only up there: lower down the silhouette beside a hidden stretch
            # of hair is an arm's, and the hair does not end at it.
            crown_rows = np.zeros((H, W), bool); crown_rows[:244 * S] = True
            outline |= rim & um & crown_rows
    # A light halo along the edge of a part, where a part in front of it
    # meets it, is the upscaler's and not the drawing's: when the front part
    # moves, it would stay behind as a pale line. Hair keeps the highlights
    # that are part of its strands; only the edge band goes.
    if name in ('hairBack', 'ponytail', 'sideR', 'sideL', 'neck', 'dress', 'collar'):
        infront = np.isin(assign, [p for p in front if p != pi])
        band = cv2.dilate(infront.astype(np.uint8), np.ones((11, 11), np.uint8)).astype(bool) & own
        own = own & ~(band & (lum > 222) & (U.max(2) - U.min(2) < 30))
    if name in ('hairBack', 'ponytail', 'dress'):
        # and neither hair nor dress is ever skin: what is, is the edge of
        # an arm or the neck beside it, and is painted over as the part
        own = own & ~(np.isin(dom_all, SKINLIKE) &
                      cv2.dilate(infront.astype(np.uint8), np.ones((13, 13), np.uint8)).astype(bool))
    seam_ink = None
    if name == 'dress':
        own = own & poly(DRESS_SIL, 1.8)
    if name == 'dress':
        # Beside each forearm the bodice keeps the arm's outline, its soft
        # edge and a dark sliver of background from the gap between them.
        # When the arm swings out those are left on the dress as streaks and
        # specks. Down the arm (not below the hands, where the dress's own
        # edge shows) anything that is not dress-coloured is repainted, and
        # the painted-in side seam carries the outline instead.
        arms = np.isin(assign, [PARTS.index('armR'), PARTS.index('armL')])
        near_arm = cv2.dilate(arms.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (25, 25))).astype(bool)
        band = np.zeros((H, W), bool); band[250 * S:336 * S] = True
        own = own & ~(near_arm & band & ((lum < 62) | (dom_all != NP.index('dress'))))
    if name in ('hairBack', 'dress'):
        # and in the narrow gaps between an arm and her side, what is left
        # of either part is a few slivers a pixel wide: too small to carry
        # the part's colour, big enough to show as specks once the arm
        # moves. Pieces that small go and are painted over.
        arms = np.isin(assign, [PARTS.index('armR'), PARTS.index('armL')])
        near_arm = cv2.dilate(arms.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (25, 25))).astype(bool)
        nl, cc, stt, _ = cv2.connectedComponentsWithStats(own.astype(np.uint8), connectivity=8)
        small = np.zeros(nl, bool)
        small[1:] = stt[1:, cv2.CC_STAT_AREA] < 160
        hit = np.zeros(nl, bool); hit[np.unique(cc[near_arm & own])] = True
        own = own & ~(small & hit)[cc]
        # and the soft grey edge of the arm's outline, left on the hair
        # beside it, which shows as a dotted ghost of the arm
        hug = cv2.dilate(arms.astype(np.uint8), np.ones((9, 9), np.uint8)).astype(bool)
        if name == 'hairBack':
            own = own & ~(hug & (lum < 176))
            # and what is left of it beside the arm that is not a flat hair
            # colour - the pale half of the same blend - goes the same way
            own = own & ~(hug & ~pure)
    if name == 'dress':
        # Down the side the arm covers, the dress's edge as drawn is the
        # arm's outline, the gap's shadow and a few stray pixels of both. It
        # is replaced by the seam itself: everything outside the line goes,
        # and the line is drawn once, smooth. Below the hand, where the edge
        # is the dress's own, the drawing is kept.
        seam_ink = np.zeros((H, W), np.uint8)
        for seam, edge_x in ((SEAM_L, 60), (SEAM_R, 175)):
            own &= ~poly(seam + [(edge_x, seam[-1][1]), (edge_x, seam[0][1])])
            cv2.polylines(seam_ink, [np.array([[x * S, y * S] for x, y in smooth_curve(seam)], np.int32)],
                          False, 1, thickness=5, lineType=cv2.LINE_AA)
        seam_ink = seam_ink.astype(bool) & fg
        own |= seam_ink
    # the colours a hidden area continues: the part's own, away from its
    # anti-aliased edges and never its line work
    clean = cv2.erode(own.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
    clean &= ~np.isin(domc, list(DARK))
    skin = name in ('face', 'neck', 'ear')
    if name == 'face':
        # skin and its shading - the pink under the bangs included - but
        # never the red the upscaler smeared round the iris, nor ink
        clean &= ((U[..., 0] - U[..., 1]) < 42) & (lum > 175) & ((U[..., 0] - U[..., 2]) > 14)
    if not clean.any(): clean = own
    halo = cv2.dilate(region.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
    want = halo & ~own
    if skin:
        fill = smooth_fill(clean, want)
    elif name in ('hairBack', 'ponytail'):
        # from the hair's own colours: not its line work, which carried down
        # a gap becomes a streak, and not the anti-aliasing beside it. The
        # long hair hangs, so it
        # is carried down its strands; the crown under the bangs is seen
        # only at its edges as she turns, and is better soft than streaked.
        src_h = own & ~rim & ~cv2.dilate(isdark.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
        # a highlight glimpsed in the gap beside an arm is a glint on one
        # strand, not the colour of everything hidden above it
        src_h &= ~((lum > 225) & cv2.dilate(np.isin(assign, [PARTS.index('armR'), PARTS.index('armL')]).astype(np.uint8),
                                             np.ones((41, 41), np.uint8)).astype(bool))
        fill = strand_fill(src_h, want)
        # a glint carried down a hidden stretch becomes a white stripe the
        # length of it: hidden hair keeps its tone, not its highlights
        fl = fill @ np.array([0.299, 0.587, 0.114], np.float32)
        hot = want & (fl > 214)
        k = np.clip((fl[hot] - 214) / 30, 0, 1)[:, None]
        fill[hot] = fill[hot] * (1 - k) + np.array(PAL['hair'], np.float32) * k
        # softened across the strands, so a column that happened to start
        # from a highlight does not run down the gap as a hard stripe
        # (a normalized blur: nothing outside the gap is averaged in, or the
        # black of the empty texture bleeds into its edges as a seam)
        wm = want.astype(np.float32)
        den = cv2.GaussianBlur(wm, (0, 0), sigmaX=5, sigmaY=2)
        for ch in range(3):
            num = cv2.GaussianBlur(fill[..., ch] * wm, (0, 0), sigmaX=5, sigmaY=2)
            fill[..., ch] = np.where(want, num / np.maximum(den, 1e-3), fill[..., ch])
        if name == 'hairBack':
            # Under the crown the hair is a soft continuation of its own
            # shadow; below the shoulders it is the drawing's flat shadow
            # colour, as it is wherever it can be seen, and the two are
            # blended over a few pixels so no seam shows between them.
            soft = smooth_fill(src_h & (lum < 225), want)
            low = own & (dom_all == NP.index('hairsh'))
            low[:250 * S] = False; low[300 * S:] = False
            base = np.median(U[low], axis=0) if low.sum() > 200 else np.array(PAL['hairsh'], np.float32)
            rows = np.arange(H, dtype=np.float32)[:, None, None]
            k = np.clip((rows - 232 * S) / (14 * S), 0, 1)
            fill = np.where(want[..., None], soft * (1 - k) + base * k, fill)
    elif name in ('sleeveR', 'sleeveL'):
        # the sleeve's own colour, flat, as it is drawn; the cap's shading is
        # too slight to matter on a part that is mostly under the dress
        fill = np.zeros((H, W, 3), np.float32); fill[:] = PAL['dress']
    elif name in ('legR', 'legL'):
        # the sock carries its stripes down the column, which is right for
        # a sock and wrong for skin: carried down, a thigh turns to bars.
        # Above the top of the sock the fill is a smooth skin continuation.
        sk = clean & (U[..., 0] - U[..., 2] > 12) & (lum > 150)
        if sk.any():
            top_sock = int(np.nonzero(sk.any(1))[0].max())
            thigh = want.copy(); thigh[top_sock + 1:] = False
            fill = strand_fill(clean, want)
            fill[thigh] = smooth_fill(sk, thigh)[thigh]
        else:
            fill = strand_fill(clean, want)
    else:
        fill = nearest_fill(clean, want)
    rgb = np.where(own[..., None], U, fill)
    if seam_ink is not None:
        rgb[seam_ink] = INK
    if name == 'face':
        # the repainted ring blends into the skin round it over a pixel or
        # so, instead of stopping at a hard edge that shows the moment a
        # brow lifts off it
        # distance from the ring, for every pixel outside it
        dist = cv2.distanceTransform((~face_ring).astype(np.uint8), cv2.DIST_L2, 5)
        blend = (np.clip(1 - dist / 6.0, 0, 1) * (~face_ring))[..., None]
        near = (blend[..., 0] > 0) & own & ~isdark
        soft = smooth_fill(clean & ~face_ring, near)
        rgb[near] = rgb[near] * (1 - blend[near]) + soft[near] * blend[near]
    # The silhouette is smoothed, so a part's edge can take in a sliver of
    # the background beside it. Painted with the part's colour, that sliver
    # shows at rest as a faint light line in the gaps between her hair and
    # her face; painted with what the drawing has there - the dark of the
    # outline running into the background - it does not show at all.
    # The soft edge of the alpha reaches a texel or two past the region
    # too; over background those texels take the background's own colour,
    # or three parts' light edges meeting in one narrow gap add up to a line.
    stray = halo & (assign < 0) & ~own
    rgb[stray] = np.minimum(U[stray], INK + 30)
    fillonly = region & ~own
    # An underlay's outline is for when it is uncovered. Right beside what
    # is visible it would show through the soft edge of the part over it,
    # as a line the drawing does not have.
    far = cv2.distanceTransform((~own).astype(np.uint8), cv2.DIST_L2, 5) > 2.0
    # and only where the painted-in area actually ends: an underlay's edge
    # that runs on into more of the same part (the hair behind an arm
    # meeting the hair behind the neck) is not an edge at all
    edge = region & cv2.dilate((~region).astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11))).astype(bool)
    rgb[outline & fillonly & far & edge] = INK
    if name == 'face':
        FACE_BG = (rgb @ np.array([0.299, 0.587, 0.114], np.float32)).astype(np.float32)
    # Straight cuts are softened by half a texel - outwards only. A part's
    # own pixels are always opaque: softened inwards, the outermost texel
    # of a line drawn along its edge goes half transparent and the line
    # thins wherever something lighter lies under it.
    alpha = cv2.GaussianBlur(region.astype(np.float32), (0, 0), 0.7)
    alpha[own] = 1.0
    rgb = np.where(halo[..., None], rgb, 0)
    rgba[name] = (rgb, alpha)

# ---- smoother lines ---------------------------------------------------
# The upscaler draws every line a little unevenly: stepped along a diagonal,
# swollen here and pinched there, with a speck of ink beside it now and
# then. Each part's lines are smoothed on their own: a pixel is taken as the
# colour it lies on plus an amount of ink, only the amount is smoothed
# (supersampled, then sharpened back to an edge a texel wide, so a line keeps
# its weight and loses its steps), ink too small to be a line is dropped, and
# the pixel is put back together. Nothing but the ink moves: colour, shading
# and the part's own edge are as they were.
SMOOTH_SKIP = {'lidR', 'lidL', 'browR', 'browL', 'sleeveR', 'sleeveL'}

def prune_stubs(t):
    """A line has a width and a length. What is attached to one and is both
    thinner than the line and short - a stub of someone else's outline, a
    hair of ink - goes; a stroke that is thin but long (a strand) stays."""
    b = (t > 0.5).astype(np.uint8)
    thick = cv2.morphologyEx(b, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
    body = cv2.dilate(thick, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
    thin = b & ~body
    nl, cc, st, _ = cv2.connectedComponentsWithStats(thin, connectivity=8)
    out = t.copy()
    # a thin piece counts as a stub only if it grows out of a thick line;
    # a thin line on its own (a hem, a strand) is a line
    touch = cv2.dilate(body, np.ones((5, 5), np.uint8)).astype(bool)
    for j in range(1, nl):
        if st[j, cv2.CC_STAT_AREA] < STUB and (touch & (cc == j)).any():
            out[cv2.dilate((cc == j).astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool) & (body == 0)] = 0
    return out

STUB = 70                                             # texels squared: a strand is longer than this

def trace_ink(t, near, k=4):
    """The ink amount `t`, redrawn as outlines: traced as curves at k times
    the atlas's resolution (potrace: straight where it is straight, a
    smooth curve where it curves, a corner where there is one), and drawn
    back down with anti-aliasing. Pieces of ink smaller than a speck are
    dropped by the tracer."""
    import potrace
    h, w = t.shape
    big = cv2.GaussianBlur(cv2.resize(t * near, (w * k, h * k), interpolation=cv2.INTER_CUBIC), (0, 0), BLUR * k)
    bm = big > 0.5
    if not bm.any(): return np.zeros_like(t)
    plist = potrace.Bitmap(~bm).trace(turdsize=SPECK * k * k, turnpolicy=potrace.POTRACE_TURNPOLICY_MINORITY,
                                     alphamax=1.1, opticurve=True, opttolerance=0.5)
    out = np.zeros((h * k, w * k), np.uint8)
    for curve in plist:
        pts = [curve.start_point]
        cur = curve.start_point
        for s in curve.segments:
            if s.is_corner:
                pts += [s.c, s.end_point]
            else:
                p0, p1, p2, p3 = cur, s.c1, s.c2, s.end_point
                for u in np.linspace(0, 1, 13)[1:]:
                    m = 1 - u
                    pts.append(type(p0)(m*m*m*p0.x + 3*m*m*u*p1.x + 3*m*u*u*p2.x + u*u*u*p3.x,
                                        m*m*m*p0.y + 3*m*m*u*p1.y + 3*m*u*u*p2.y + u*u*u*p3.y))
            cur = s.end_point
        poly = np.array([[p.x, p.y] for p in pts], np.float64)
        m = np.zeros_like(out)
        cv2.fillPoly(m, [np.round(poly * 16).astype(np.int32)], 1, lineType=cv2.LINE_AA, shift=4)
        out ^= m                                      # a hole is a curve inside a curve
    return cv2.resize(out.astype(np.float32), (w, h), interpolation=cv2.INTER_AREA)

BLUR = 0.7                                            # texels: noise finer than this is not a shape
SPECK = 12                                            # texels squared: less than this is not a line

def smooth_lines(rgb, a):
    ys, xs = np.nonzero(a > 0.02)
    if not len(ys): return rgb
    pad = 10
    y0, y1 = max(ys.min() - pad, 0), min(ys.max() + pad + 1, H)
    x0, x1 = max(xs.min() - pad, 0), min(xs.max() + pad + 1, W)
    p = rgb[y0:y1, x0:x1].copy(); sa = a[y0:y1, x0:x1]
    h, w = sa.shape
    d_ink = np.linalg.norm(p - INK_L, axis=2)
    pure_fill = (sa > 0.9) & (d_ink > 85)
    core = (sa > 0.5) & (d_ink < 22)
    if core.sum() < 30 or not pure_fill.any(): return rgb
    ink = p[core].mean(0)
    _, lab = cv2.distanceTransformWithLabels((~pure_fill).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    ly, lx = np.nonzero(pure_fill)
    lut = np.zeros((lab.max() + 1, 3), np.float32); lut[lab[ly, lx]] = p[ly, lx]
    F = lut[lab]
    v = F - ink; vv = np.maximum((v * v).sum(2), 1.0)
    t = np.clip(((F - p) * v).sum(2) / vv, 0, 1)
    t[sa < 0.5] = 0                                   # the soft rim of the part is not a line
    # near a line only: far from any ink there is nothing to smooth
    near = cv2.dilate((t > 0.15).astype(np.uint8), np.ones((9, 9), np.uint8)).astype(bool)
    if not near.any(): return rgb
    t = prune_stubs(t)
    t2 = trace_ink(t, near)
    t2[sa < 0.5] = np.minimum(t2[sa < 0.5], t[sa < 0.5])      # never ink the soft rim
    out = F * (1 - t2[..., None]) + ink * t2[..., None]
    m = near & (sa > 0.02)
    res = rgb.copy()
    sub = res[y0:y1, x0:x1]
    sub[m] = out[m]
    return res

INK_L = np.array([4, 3, 4], np.float32)

LIMBS = {'armR', 'armL', 'legR', 'legL', 'shoeR', 'shoeL'}

def tidy_part(name, rgb, a):
    """What the cut leaves at a part's rim that is not part of the drawing:
    a speck of dark or colour that came loose from the line it belonged to
    (a line is one piece of ink, a speck is not), and, on a skin part, a
    notch or a slit where the colour test dropped a few pixels - background
    shows through those, and they open when the part moves."""
    ys, xs = np.nonzero(a > 0.02)
    if not len(ys): return rgb, a
    y0, y1 = max(ys.min() - 12, 0), min(ys.max() + 13, H)
    x0, x1 = max(xs.min() - 12, 0), min(xs.max() + 13, W)
    p = rgb[y0:y1, x0:x1]; sa = a[y0:y1, x0:x1].copy()
    m = sa > 0.5
    lm = p @ np.array([0.299, 0.587, 0.114], np.float32)
    rim = cv2.distanceTransform(m.astype(np.uint8), cv2.DIST_L2, 5) <= 5
    # loose dark: separate from the line it lies beside, small, at the rim.
    # Only on a limb or a shoe: there the rim is a lone outline and debris
    # is easy to tell from it; on the dress's hem a fragment of the line is
    # a piece of the line, and deleting it opens a notch.
    dark = m & (lm < 70)
    nl, cc, st, _ = cv2.connectedComponentsWithStats(dark.astype(np.uint8), connectivity=8)
    for j in range(1, nl):
        if name in LIMBS and st[j, cv2.CC_STAT_AREA] < 48 and (rim & (cc == j)).any():
            sa[cv2.dilate((cc == j).astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool) & (lm < 120)] = 0
    # loose pieces of the part itself
    m = sa > 0.5
    nl, cc, st, _ = cv2.connectedComponentsWithStats(m.astype(np.uint8), connectivity=8)
    for j in range(1, nl):
        if st[j, cv2.CC_STAT_AREA] < 60: sa[cc == j] = 0
    if name in ('legR', 'legL'):
        # Across the thigh, small fragments of dark are the dress's hem line
        # that the leg picked up as dashes. Hidden under the dress at rest,
        # they show as teeth along the hem the moment the skirt moves. The
        # leg's own side outlines are long and stay.
        band = np.zeros((H, W), bool); band[336 * S:374 * S] = True
        bm = band[y0:y1, x0:x1]
        dk = (sa > 0.5) & (lm < 110) & bm
        nl, cc, st, _ = cv2.connectedComponentsWithStats(dk.astype(np.uint8), connectivity=8)
        junk = np.zeros_like(dk)
        for j in range(1, nl):
            if st[j, cv2.CC_STAT_AREA] < 400 and st[j, cv2.CC_STAT_HEIGHT] < 40: junk |= cc == j
        junk = cv2.dilate(junk.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool) & (lm < 150) & (sa > 0.02)
        if junk.any():
            skin = (sa > 0.5) & (lm > 170) & ~junk
            _, lab = cv2.distanceTransformWithLabels((~skin).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
            sy, sx = np.nonzero(skin)
            lut = np.zeros((lab.max() + 1, 3), np.float32); lut[lab[sy, sx]] = p[sy, sx]
            p = p.copy(); p[junk] = lut[lab][junk]
    if name in ('neck', 'ear'):
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (21, 21))
        closed = cv2.morphologyEx((sa > 0.5).astype(np.uint8), cv2.MORPH_CLOSE, k).astype(bool)
        add = closed & (sa <= 0.5)
        if add.any():
            _, lab = cv2.distanceTransformWithLabels((sa <= 0.5).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
            # skin only: the nearest colour might be the outline's
            sy, sx = np.nonzero((sa > 0.5) & (lm > 120))
            _, lab = cv2.distanceTransformWithLabels((~((sa > 0.5) & (lm > 120))).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
            lut = np.zeros((lab.max() + 1, 3), np.float32); lut[lab[sy, sx]] = p[sy, sx]
            p = p.copy(); p[add] = lut[lab][add]; sa[add] = 1.0
    out = rgb.copy(); out[y0:y1, x0:x1] = p
    oa = a.copy(); oa[y0:y1, x0:x1] = sa
    return out, oa

def smooth_edge(rgb, a):
    """The part's own edge, redrawn the way its lines were: traced as curves
    and drawn back with anti-aliasing, so a cut that followed pixel steps
    follows a straight line or a curve instead. Inside the part the alpha is
    untouched; only a band along the edge changes, and where the edge moves
    out, the new texels take the colour beside them."""
    import potrace
    ys, xs = np.nonzero(a > 0.02)
    if not len(ys): return rgb, a
    y0, y1 = max(ys.min() - 6, 0), min(ys.max() + 7, H)
    x0, x1 = max(xs.min() - 6, 0), min(xs.max() + 7, W)
    sa = a[y0:y1, x0:x1]; p = rgb[y0:y1, x0:x1]
    h, w = sa.shape; k = 4
    b = (sa > 0.5)
    big = cv2.GaussianBlur(cv2.resize(sa, (w * k, h * k), interpolation=cv2.INTER_CUBIC), (0, 0), BLUR * k) > 0.5
    plist = potrace.Bitmap(~big).trace(turdsize=SPECK * k * k, turnpolicy=potrace.POTRACE_TURNPOLICY_MINORITY,
                                       alphamax=1.0, opticurve=True, opttolerance=0.6)
    out = np.zeros((h * k, w * k), np.uint8)
    for curve in plist:
        pts = [curve.start_point]; cur = curve.start_point
        for s in curve.segments:
            if s.is_corner:
                pts += [s.c, s.end_point]
            else:
                p0, p1, p2, p3 = cur, s.c1, s.c2, s.end_point
                for u in np.linspace(0, 1, 13)[1:]:
                    m = 1 - u
                    pts.append(type(p0)(m*m*m*p0.x + 3*m*m*u*p1.x + 3*m*u*u*p2.x + u*u*u*p3.x,
                                        m*m*m*p0.y + 3*m*m*u*p1.y + 3*m*u*u*p2.y + u*u*u*p3.y))
            cur = s.end_point
        poly = np.array([[q.x, q.y] for q in pts], np.float64)
        m = np.zeros_like(out)
        cv2.fillPoly(m, [np.round(poly * 16).astype(np.int32)], 1, lineType=cv2.LINE_AA, shift=4)
        out ^= m
    a2 = cv2.resize(out.astype(np.float32), (w, h), interpolation=cv2.INTER_AREA)
    # only a band along the edge may change
    inside = cv2.erode(b.astype(np.uint8), np.ones((9, 9), np.uint8)).astype(bool)
    outside = ~cv2.dilate(b.astype(np.uint8), np.ones((9, 9), np.uint8)).astype(bool)
    new_a = np.where(inside, sa, np.where(outside, 0.0, a2)).astype(np.float32)
    # colour for texels that gained alpha: the nearest texel that has it
    gain = (new_a > 0.02) & (sa <= 0.5)
    if gain.any():
        src = sa > 0.5
        _, lab = cv2.distanceTransformWithLabels((~src).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
        sy, sx = np.nonzero(src)
        lut = np.zeros((lab.max() + 1, 3), np.float32); lut[lab[sy, sx]] = p[sy, sx]
        p = p.copy(); p[gain] = lut[lab][gain]
    # The outermost texels of an outlined edge are the line: where ink lies
    # right inside the rim, a rim texel that is not ink (the fill the nearest
    # colour put there, or a pale speck of the upscaler's) is made ink, so
    # the edge is dark all the way out and no light teeth show along it.
    lm = p @ np.array([0.299, 0.587, 0.114], np.float32)
    ink_in = (new_a > 0.5) & (lm < 45)
    rim = cv2.dilate((new_a < 0.5).astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool) & (new_a > 0.02)
    want = rim & cv2.dilate(ink_in.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool) & (lm >= 45)
    if want.any():
        p = p.copy(); p[want] = INK_L
    oa = a.copy(); oa[y0:y1, x0:x1] = new_a
    orgb = rgb.copy(); orgb[y0:y1, x0:x1] = p
    return orgb, oa

for name in DRAW:
    if name in SMOOTH_SKIP: continue
    rgb, al = rgba[name]
    rgb = smooth_lines(rgb, al)
    if name not in ('ballR', 'ballL'):
        rgb, al = tidy_part(name, rgb, al)
        rgb, al = smooth_edge(rgb, al)
    rgba[name] = (rgb, al)

# ---- into the layered file, and from it the atlas ----------------------
import layers
bases = {}
for name in DRAW:
    rgb, a = rgba[name]
    px = np.dstack([np.clip(rgb, 0, 255), np.clip(a * 255, 0, 255)])
    bases[name] = Image.fromarray((px + 0.5).astype(np.uint8), 'RGBA')
ora = os.path.join(OUT, 'aisa.ora')
layers.write_ora(ora, bases)
meta = layers.pack(ora, OUT, quiet=True)

if DEBUG:
    # rest-pose check: the parts laid back together over the background
    comp = np.zeros((H, W, 3), np.float32); comp[:] = 27
    for name in DRAW:
        rgb, a = rgba[name]
        comp = comp * (1 - a[..., None]) + rgb * a[..., None]
    Image.fromarray(np.clip(comp, 0, 255).astype(np.uint8)).save(os.path.join(DEBUG, 'rest.png'))
print('atlas', meta['width'], meta['height'])
