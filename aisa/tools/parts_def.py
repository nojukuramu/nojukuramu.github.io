"""Where every part of Aisa lives on the artwork, in source pixels (the
224x512 original). Order is priority: when two regions overlap, the first
one listed that owns a pixel's colour takes it."""
import math

def ell(cx, cy, rx, ry, n=36):
    return [(round(cx + rx*math.cos(2*math.pi*i/n), 2), round(cy + ry*math.sin(2*math.pi*i/n), 2)) for i in range(n)]

HAIR = ['line', 'hair', 'hairsh', 'hairhi']

# (part, polygon, palette). A part may be listed more than once with
# different palettes - the sleeve is dress-coloured, the forearm is not.
REGIONS = [
 ("ahoge",     [(98,84),(165,84),(165,118),(132,118),(124,128.5),(108,128.5),(98,120)], HAIR),
 # The "brows" are the two thin strokes over each eye's inner corner: the
 # brows proper are under the bangs. The bangs' own bottom outline runs
 # just above them and is not theirs.
 ("browR",     [(103.4,186.4),(110,187.6),(121.6,189.4),(122,191.6),(119.2,194),(112,192),(106.8,191),(103.4,188.4)], ['line']),
 ("browL",     [(139,189.8),(147,186.6),(155.2,184),(156.4,185.6),(151,188.6),(151,189.8),(146,191.6),(142.6,193.4),(139.2,192.4)], ['line']),
 ("lidR",      [(86.8,191.2),(92,189.9),(100,189.5),(106,190.2),(110,191.4),(114,192.9),(118,194.7),(121.8,196),(122.2,200),(116,199.8),(112,196.2),(104,195.1),(96,194.5),(90,194.8),(86.6,194)], ['line', 'eyeline']),
 ("lidL",      [(137,196.5),(140,195.1),(143,193.7),(146,192.5),(149,191.4),(152,190.6),(156,189.9),(160,189.5),(163.2,189.8),(164.6,191),(164.6,193.8),(158,194.4),(150,195.4),(143,197.6),(137.4,198.2)], ['line', 'eyeline']),
 # the iris interior is the eye whatever its colour - the right eye's
 # highlight is pink enough to read as skin
 ("ballR",     ell(103.6, 206.2, 8.9, 12.6), None),
 ("ballL",     ell(148.2, 205.6, 7.6, 12.3), None),
 # the white of the eye in each outer corner, between the iris, the end
 # of the lash and the lock beside it: it is the eye's, and closes with it
 ("ballR",     [(110,195.4),(116,197),(122.8,197.6),(122.8,201.6),(115,203),(110,199)], ['white', 'eyehi', 'line', 'eyeline', 'red2']),
 ("ballL",     [(153,193.6),(160,193.4),(164.8,193.2),(164.8,201),(157,203),(153,198)], ['white', 'eyehi', 'line', 'eyeline', 'red2']),
 ("ballR",     ell(103.6, 206.2, 10.9, 14.6), ['eyeline', 'red', 'red2', 'eyehi', 'line', 'white']),
 ("ballL",     ell(148.2, 205.6, 9.6, 14.3), ['eyeline', 'red', 'red2', 'eyehi', 'line', 'white']),
 ("mouth",     [(127,231),(134,231),(134,235.6),(127,235.6)], ['mouth', 'line']),
 ("frontHair", [(64,118),(190,118),(190,149),(172,148.5),(150,151),(151,167),(149,179),(140,180),(128,182),(118,183),(110,185),(100,184),(91,186),(93,175),(97,162),(104,149),(78,148),(70,146),(67.5,139)], HAIR),
 ("sideR",     [(74,140),(106,140),(97,162),(91,175),(89,190),(88,215),(90,235),(93,252),(80,254),(72,242),(66,226),(65,200),(67,180),(71,160)], HAIR),
 ("sideL",     [(148,140),(186,140),(192,160),(193,200),(191,240),(176,250),(167,247),(164,220),(161,200),(156,182),(151,168)], HAIR),
 ("ear",       [(50,193),(72,193),(74,230),(50,230)], ['line', 'skin', 'skinsh', 'white']),
 # the face stops at the lower edge of the chin line, measured column by
 # column: the shadow under the chin is the neck's, and must stay behind
 # when she lifts her head
 ("face",      [(84,150),(170,150),(170,200),(168,229),(158,233),(154,234.6),(150,236.3),(146,237.8),(142,238.8),(138,240.0),(134,240.8),(130,241.5),(126,242.0),(122,242.0),(118,241.8),(114,241.3),(110,240.6),(106,240.1),(102,239.3),(98,238.6),(94,237.6),(90,236.6),(86,235.0),(84,233)], ['line', 'skin', 'skinsh', 'white']),
 ("collar",    [(97,247),(110,241),(123,250),(130,243),(139,249),(131,260),(123,253),(114,261)], ['line', 'white', 'whitesh']),
 ("neck",      [(104,236),(140,236),(140,252),(104,252)], ['line', 'necksh', 'skin', 'skinsh']),
 ("armR",      [(84,256),(92,250),(99,249),(101,256),(102.5,266),(101.5,280),(99,290),(92,291),(80,287),(75.5,281),(75,274),(77,266)], ['line', 'dress', 'white', 'whitesh', 'skin', 'skinsh']),
 # the forearm runs a couple of pixels from the dress's outline on one side
 # and the hair's on the other: the polygon follows the arm's own outline,
 # or the arm walks off with a stretch of dress or a few strands
 ("armR",      [(76,286),(99,286),(97,292),(90,298),(87.6,306),(85,316),(82.4,326),(80.5,336),(76,340),(66,340.5),(60.5,338.5),(58.6,333),(59.4,328),(62.1,322),(65.4,316),(67.9,310),(69.4,304),(70.5,298),(72.5,291)], ['line', 'skin', 'skinsh', 'white']),
 # the sleeve starts at the armhole: the shoulder line above it is the
 # bodice's, and stays with the dress when the arm goes up rather than
 # stretching after it
 ("armL",      [(141.5,257),(147,256),(150,260),(155,268),(158,276),(156,282),(150,287),(145,288),(145,283),(145.2,276),(141,263)], ['line', 'dress', 'white', 'whitesh', 'skin', 'skinsh']),
 ("armL",      [(146,286),(158,286),(160.4,290),(161.5,295),(163.2,301),(166.2,310),(170.4,319),(174.2,328),(174.3,332),(172,335.5),(167,339),(160,345),(156.5,336),(154,325),(151.5,312),(149,300),(147,292)], ['line', 'skin', 'skinsh', 'white']),
 # the bodice stops at the sleeves: beside them is hair, whose outline
 # would otherwise go with the dress and be left floating when an arm
 # comes up
 ("dress",     [(92,244),(152,244),(152,252),(149,262),(147,283),(158,315),(167,356),(70,360),(80,315),(97,283),(95,262),(92,252)], ['line', 'dress']),
 ("shoeR",     [(82,404),(118,404),(118,440),(82,440)], ['line', 'brown', 'browndk', 'lace', 'lacehi']),
 ("shoeL",     [(120,404),(156,404),(156,440),(120,440)], ['line', 'brown', 'browndk', 'lace', 'lacehi']),
 ("legR",      [(84,350),(115,350),(115,412),(84,412)], ['line', 'white', 'stripe', 'skin', 'skinsh']),
 ("legL",      [(121,350),(152,350),(152,412),(121,412)], ['line', 'white', 'stripe', 'skin', 'skinsh']),
 ("ponytail",  [(0,118),(64,118),(67.5,139),(63,147),(58,154),(54,162),(53,190),(52,210),(48,232),(44,258),(0,258)], HAIR + ['hairdk', 'tie']),
 ("hairBack",  [(0,118),(224,118),(224,330),(0,330)], HAIR + ['hairdk']),
]

# Hidden areas a part has to be painted under, so that moving whatever
# covers it shows more of the part instead of a hole. Filled with the
# nearest of the part's own colours; `outline` draws the edge that becomes
# a silhouette once it is uncovered.
UNDER = [
 # under the hair as far as the hair's inner edge and a little past it:
 # no further, or a turn uncovers skin beyond the silhouette
 ("face",     [(86,150),(160,150),(166,172),(168,200),(166,222),(160,230),(150,235),(130,236.6),(110,236),(92,231),(86,215),(84,180)], False),
 ("hairBack", [(56,130),(100,124),(150,126),(175,140),(185,165),(190,200),(188,240),(170,250),(150,246),(100,246),(70,246),(55,230),(50,180)], False),
 ("ponytail", [(48,128),(68,128),(70,160),(57,205),(47,165)], False),
 ("sideR",    [(74,138),(106,138),(104,153),(76,153)], False),
 ("sideL",    [(148,138),(178,138),(182,152),(150,153)], False),
 # a neck, not a slab: a column with its own sides, so looking up shows
 # a throat in shadow rather than a rectangle of skin
 ("neck",     [(110.5,222),(133.5,222),(134,236),(135,252),(109,252),(110,236)], True),
 # the bodice under the sleeves ends at the armhole seams and runs down
 # the side seams to the hem - which is what shows when an arm goes up
 ("dress",    [(100,247),(146,247),(145.5,262),(146,283),(165.5,350),(120,358),(74,350),(102.5,283),(101.5,262)], True),
 # the long hair carries on behind each arm
 # behind her right arm the hair runs on under the dress (which hides
 # it), so the only edge that can show is the tips
 ("hairBack", [(60,240),(104,240),(104,306),(96,306),(94,300),(88,296),(80,305),(70,300),(62,296)], True),
 ("hairBack", [(144,240),(170,240),(172,286),(165,294),(158,290),(151,297),(146,290)], True),
 # thighs up under the skirt to the hips, so a swinging leg has a leg
 # above the sock rather than a cut edge
 ("legR",     [(90,326),(111,326),(112,362),(88.5,362)], True),
 ("legL",     [(125,326),(146,326),(147.5,362),(124,362)], True),
 ("ballR",    ell(103.6, 206.2, 10.0, 13.9), True),
 ("ballL",    ell(148.2, 205.6, 8.6, 13.5), True),
 ("ear",      [(62,197),(70,196),(76,200),(77.5,212),(76,224),(70,229),(63,227)], True),
]

# The lash's lower edge, left to right. The rig clips the eyeball against
# this line as the lid comes down, so the iris disappears under the lash
# rather than being squashed.
LID_EDGE = {
 "lidR": [(87.2,193.6),(90,195.0),(96,194.7),(104,195.3),(110,196.0),(113.6,197.6),(116.6,199.8),(120.6,199.6),(122.8,200.4)],
 "lidL": [(137.6,197.8),(143,197.8),(150,195.6),(158,194.6),(166.6,193.8)],
}

DRAW = ["hairBack", "ponytail", "legR", "legL", "shoeR", "shoeL", "dress", "armR", "armL", "neck", "collar", "ear",
        "face", "ballR", "ballL", "lidR", "lidL", "browR", "browL", "sideR", "sideL", "frontHair", "ahoge"]
