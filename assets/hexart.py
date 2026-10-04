"""Board hex art: the buildings and landscapes for the 15 location hexes.

Buildings are drawn with a small shape toolkit (boxes, roofs, discs) and then
given an ink outline automatically. Landscapes are painters that run on the
hex ground before the building is placed. sprites.py turns these into tiles.
"""


class Canvas:
    """A small pixel canvas of palette keys ('.' is transparent)."""

    def __init__(self, w, h):
        self.w, self.h = w, h
        self.g = [["."] * w for _ in range(h)]

    def px(self, x, y, c):
        if 0 <= x < self.w and 0 <= y < self.h:
            self.g[y][x] = c

    def rect(self, x, y, w, h, c):
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                self.px(xx, yy, c)

    def box(self, x, y, w, h, lit, mid, dark):
        """A filled block lit from the left and shaded on the right."""
        self.rect(x, y, w, h, mid)
        self.rect(x, y, 1, h, lit)
        self.rect(x + w - 1, y, 1, h, dark)

    def roof(self, x, y, w, lit, dark):
        """A gable seen from the front: a triangle w wide, peak at the top."""
        h = (w + 1) // 2
        cx = x + (w - 1) / 2
        for i in range(h):
            for xx in range(round(cx - i), round(cx + i) + 1):
                self.px(xx, y + i, lit if xx < cx else dark)
        return h

    def disc(self, cx, cy, r, c, shade=None):
        for yy in range(cy - r, cy + r + 1):
            for xx in range(cx - r, cx + r + 1):
                if (xx - cx) ** 2 + (yy - cy) ** 2 <= r * r + r * 0.6:
                    self.px(xx, yy, shade if shade and xx > cx + r * 0.3 else c)

    def outline(self):
        """Ink one pixel round everything drawn so far."""
        filled = {(x, y) for y in range(self.h) for x in range(self.w) if self.g[y][x] != "."}
        for x, y in filled:
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                n = (x + dx, y + dy)
                if n not in filled:
                    self.px(*n, "k")

    def rows(self):
        return ["".join(r) for r in self.g]


# ---------------------------------------------------------------------------
# Buildings (each fits roughly 20x16, narrow at the top)
# ---------------------------------------------------------------------------

def military_facility():
    c = Canvas(22, 15)
    c.disc(8, 13, 7, "g", shade="X")          # quonset hangar
    c.rect(0, 14, 22, 1, "x")                  # slab
    c.rect(17, 2, 1, 12, "X")                  # radio mast
    c.rect(15, 13, 5, 1, "X")
    c.outline()
    for x in (4, 7, 10):                       # hangar ribs
        for y in range(8, 14):
            if c.g[y][x] in "gX":
                c.px(x, y, "X")
    c.rect(6, 11, 4, 3, "k")                   # hangar door
    c.rect(7, 12, 2, 2, "o"); c.px(7, 12, "!") # light inside the door
    c.px(17, 1, "r")                           # warning light
    c.px(16, 5, "X"); c.px(18, 5, "X"); c.px(16, 8, "X"); c.px(18, 8, "X")
    return c.rows()


def weather_station():
    c = Canvas(20, 16)
    c.box(6, 7, 7, 9, "w", "z", "g")           # tower
    c.disc(9, 4, 3, "w", shade="a")            # radar dome
    c.rect(16, 2, 1, 14, "X")                  # anemometer pole
    c.rect(14, 2, 5, 1, "X")
    c.outline()
    c.rect(5, 7, 9, 1, "k")                    # railing
    c.px(8, 10, "!"); c.px(10, 10, "y"); c.px(8, 13, "y"); c.px(10, 13, "!")
    c.px(14, 1, "r"); c.px(18, 1, "r"); c.px(16, 0, "r")
    return c.rows()


def state_park():
    c = Canvas(22, 13)
    c.roof(1, 2, 13, "O", "f")                 # tent
    c.rect(15, 10, 6, 2, "u")                  # log bench / fire logs
    c.outline()
    c.roof(6, 5, 3, "k", "k")                  # tent door
    c.rect(6, 7, 3, 1, "k")
    c.px(7, 1, "u")                            # tent pole tip
    c.px(18, 8, "!"); c.px(17, 9, "O"); c.px(18, 9, "y"); c.px(19, 9, "O")
    return c.rows()


def sawmill():
    c = Canvas(22, 16)
    h = c.roof(0, 2, 13, "x", "k")             # mill roof
    c.box(1, 2 + h, 11, 7, "r", "r", "R")      # mill
    c.disc(16, 10, 5, "u", shade="U")          # waterwheel
    c.outline()
    for dx, dy in ((0, -4), (0, 4), (-4, 0), (4, 0), (-3, -3), (3, 3), (-3, 3), (3, -3)):
        c.px(16 + dx, 10 + dy, "X")
    c.px(16, 10, "k")
    c.rect(5, 12, 3, 3, "k")                   # door
    c.px(3, 10, "!"); c.px(9, 10, "!")
    return c.rows()


def graveyard():
    c = Canvas(16, 17)
    c.rect(7, 0, 1, 3, "z")                    # cross
    c.rect(6, 1, 3, 1, "z")
    c.roof(4, 3, 7, "x", "k")                  # steeple
    c.box(4, 7, 7, 5, "z", "z", "g")           # tower
    h = c.roof(0, 9, 15, "x", "k")             # nave roof
    c.box(1, 9 + h - 2, 13, 4, "z", "z", "g")  # nave
    c.outline()
    c.rect(6, 14, 3, 3, "k")                   # door
    c.px(7, 9, "!")                            # bell window
    c.px(3, 14, "y"); c.px(11, 14, "!")
    return c.rows()


def ski_resort():
    c = Canvas(20, 16)
    c.roof(1, 1, 15, "u", "u")                 # A-frame roof
    c.rect(18, 2, 1, 14, "X")                  # lift pylon
    c.rect(16, 2, 4, 1, "X")
    c.outline()
    for i in range(8):                         # snow on the roof edges
        c.px(8 - i, 1 + i, "w")
        c.px(8 + i, 1 + i, "a")
    c.rect(6, 9, 5, 4, "f")                    # gable front
    c.rect(7, 10, 3, 2, "y"); c.px(8, 10, "!")   # lit window
    c.rect(4, 13, 9, 3, "U")
    c.rect(7, 13, 3, 3, "k")                   # door
    return c.rows()


def fallout_bunker():
    c = Canvas(20, 11)
    c.disc(9, 10, 8, "g", shade="X")           # concrete dome
    c.rect(0, 10, 20, 1, "x")
    c.outline()
    c.rect(7, 6, 5, 5, "k")                    # hatch
    c.rect(8, 7, 3, 3, "x")
    c.px(9, 4, "!")                            # lamp over the hatch
    c.px(3, 6, "y"); c.px(4, 6, "k"); c.px(3, 7, "k"); c.px(4, 7, "y")   # hazard sign
    c.px(15, 6, "y"); c.px(16, 6, "k"); c.px(15, 7, "k"); c.px(16, 7, "y")
    return c.rows()


def occult_camp():
    c = Canvas(24, 13)
    for x, y, h in ((1, 5, 7), (6, 2, 9), (15, 2, 9), (20, 5, 7)):   # standing stones
        c.box(x, y, 3, h, "g", "X", "x")
    c.rect(9, 10, 6, 2, "u")                   # fire pit
    c.outline()
    c.px(11, 7, "L"); c.px(12, 6, "L"); c.px(11, 8, "m"); c.px(12, 8, "m"); c.px(13, 8, "m"); c.px(12, 7, "!")
    return c.rows()


def lake_house():
    c = Canvas(18, 14)
    h = c.roof(0, 1, 15, "x", "k")             # roof
    c.box(1, 1 + h, 13, 6, "U", "U", "u")      # cabin
    c.rect(14, 10, 4, 1, "u")                  # porch
    c.outline()
    for y in range(1 + h + 1, 1 + h + 6, 2):   # log lines
        c.rect(2, y, 11, 1, "u")
    c.rect(3, 10, 3, 2, "y"); c.px(4, 10, "!")   # windows
    c.rect(9, 10, 2, 4, "k")                   # door
    c.rect(6, 0, 2, 3, "x")                    # chimney
    return c.rows()


def shipping_docks():
    c = Canvas(24, 16)
    c.rect(4, 2, 1, 12, "y")                   # crane tower
    c.rect(4, 2, 18, 1, "y")                   # jib
    c.rect(1, 13, 7, 3, "o")                   # crane base
    c.box(9, 11, 7, 5, "r", "r", "R")          # containers
    c.box(16, 11, 7, 5, "c", "b", "b")
    c.box(12, 7, 7, 4, "G", "G", "e")
    c.outline()
    for y in range(3, 13, 2):                  # lattice
        c.px(4, y, "o")
    c.rect(18, 3, 1, 3, "x")                   # cable
    c.rect(17, 6, 3, 1, "x")
    c.px(2, 13, "!")                           # a lamp on the crane
    for x in (11, 13, 18, 20, 14, 16):
        c.px(x, 13, "k")
    return c.rows()


def junkyard():
    c = Canvas(24, 13)
    c.box(1, 7, 9, 5, "b", "b", "N")           # wrecked car
    c.box(9, 4, 9, 4, "r", "r", "R")           # car on top
    c.box(13, 8, 9, 4, "G", "G", "e")          # another
    c.disc(4, 11, 2, "x")                      # tyres
    c.disc(19, 11, 2, "x")
    c.outline()
    c.rect(11, 5, 3, 1, "a"); c.rect(3, 8, 3, 1, "a"); c.rect(15, 9, 3, 1, "a")   # windows
    c.px(4, 11, "g"); c.px(19, 11, "g")
    c.px(16, 4, "o"); c.px(7, 6, "U")
    c.px(22, 9, "!")                           # one headlight still on
    return c.rows()


def beach_city():
    c = Canvas(24, 16)
    c.disc(19, 3, 3, "g", shade="X")           # water tower tank
    c.rect(17, 6, 1, 8, "X"); c.rect(21, 6, 1, 8, "X")
    c.box(1, 7, 7, 8, "P", "P", "p")           # town buildings
    c.box(8, 4, 7, 11, "s", "o", "f")
    c.box(14, 9, 7, 6, "a", "a", "c")
    c.outline()
    for x in (2, 4, 6):
        c.px(x, 9, "b"); c.px(x, 12, "b")
    for y in (6, 9, 12):
        c.px(10, y, "b"); c.px(12, y, "b")
    c.px(16, 11, "y"); c.px(18, 11, "!")
    c.px(4, 9, "!"); c.px(10, 6, "!")
    c.rect(4, 13, 2, 2, "k"); c.rect(16, 13, 2, 2, "k")
    return c.rows()


# ---------------------------------------------------------------------------
# Landscape painters: f(g, face, W, H) paints on the hex ground in place.
# `face` is the set of ground pixels inside the border.
# ---------------------------------------------------------------------------

def _paint(g, face, pred, c):
    for x, y in face:
        if pred(x, y):
            g[y][x] = c


def coast(normal=(0.8, -0.6), sea=17, sand=13, cliff=10):
    """Sea beyond a sandy beach below a cliff, along the given direction."""
    nx, ny = normal

    def paint(g, face, W, H):
        cx, cy = W / 2, H / 2
        d = lambda x, y: (x - cx) * nx + (y - cy) * ny
        _paint(g, face, lambda x, y: d(x, y) > cliff, "f")
        _paint(g, face, lambda x, y: cliff < d(x, y) <= cliff + 1.2, "U")
        _paint(g, face, lambda x, y: d(x, y) > sand, "s")
        _paint(g, face, lambda x, y: sand < d(x, y) <= sand + 1 and (x + y) % 3 == 0, "o")
        _paint(g, face, lambda x, y: d(x, y) > sea, "b")
        _paint(g, face, lambda x, y: sea < d(x, y) <= sea + 1, "w")
        _paint(g, face, lambda x, y: d(x, y) > sea + 3 and _noise(x, y, 7) < 0.1, "a")
        _paint(g, face, lambda x, y: cliff - 1 < d(x, y) <= cliff, "k")
    return paint


def water_corner(corner, radius, shore="s"):
    """A pond or bay in one corner of the hex, with a shore."""
    def paint(g, face, W, H):
        ox, oy = {"tl": (0, 10), "tr": (W, 10), "bl": (0, H - 12), "br": (W, H - 12), "l": (0, H / 2), "r": (W, H / 2)}[corner]
        r = lambda x, y: ((x - ox) ** 2 + (y - oy) ** 2) ** 0.5
        _paint(g, face, lambda x, y: r(x, y) < radius + 2, shore)
        _paint(g, face, lambda x, y: r(x, y) < radius, "b")
        _paint(g, face, lambda x, y: radius - 1 <= r(x, y) < radius, "a")
        _paint(g, face, lambda x, y: r(x, y) < radius - 3 and _noise(x, y, 3) < 0.012, "a")
    return paint


def island(radius=21, shore=2):
    """Water all round, with an island in the middle."""
    def paint(g, face, W, H):
        cx, cy = W / 2, H / 2 + 1
        r = lambda x, y: (((x - cx) / 1.15) ** 2 + (y - cy) ** 2) ** 0.5
        _paint(g, face, lambda x, y: r(x, y) >= radius, "b")
        _paint(g, face, lambda x, y: radius - shore <= r(x, y) < radius, "s")
        _paint(g, face, lambda x, y: radius <= r(x, y) < radius + 1, "a")
        _paint(g, face, lambda x, y: r(x, y) > radius + 3 and _noise(x, y, 5) < 0.012, "a")
    return paint


def river(x_at_top, x_at_bottom, width=4):
    def paint(g, face, W, H):
        def inside(x, y):
            t = y / H
            mid = x_at_top + (x_at_bottom - x_at_top) * t
            return abs(x - mid) < width / 2
        _paint(g, face, inside, "b")
        _paint(g, face, lambda x, y: inside(x, y) and _noise(x, y, 9) < 0.03, "a")
    return paint


def _noise(x, y, salt=0):
    """A repeatable pseudo-random number in [0, 1) for a pixel."""
    n = (x * 374761393 + y * 668265263 + salt * 2246822519) & 0xFFFFFFFF
    n = (n ^ (n >> 13)) * 1274126177 & 0xFFFFFFFF
    return ((n ^ (n >> 16)) & 0xFFFF) / 65536


def texture(colour, step=7, salt=0):
    """Scattered single pixels of a second ground colour, roughly one in
    `step * 25`, placed pseudo-randomly so they never form a grid."""
    def paint(g, face, W, H):
        _paint(g, face, lambda x, y: _noise(x, y, salt) < 1 / (step * 25), colour)
    return paint


# Small ground sprites
PINE = ["...k...", "..kGk..", ".kGGek.", "..kGk..", ".kGGek.", "kGGGeek", "kkkkkkk", "...u..."]
SNOW_PINE = ["...k...", "..kwk..", ".kwGek.", "..kwk..", ".kwGek.", "kwGGeek", "kkkkkkk", "...u..."]
BOULDER = [".kkk.", "kgXxk", "kXXxk", ".kkk."]
STONE = ["kk", "XX"]
HEADSTONE = [".kk.", "kzgk", "kzgk", "kkkk"]
REEDS = ["G.G", "GeG"]
DOCK = ["kkkkkkk", "kUUUUUk", "kkkkkkk", ".k...k."]
PALM = [".kGGk.", "kGeGGk", "..ku..", "..ku..", "..ku..", ".kuu.."]
TYRE = [".kk.", "kxxk", ".kk."]
SKI_TRACK = ["a..", ".a.", "..a"]
RAILS = ["u.u", "kuk", "u.u", "kuk", "u.u"]
MINECART = [".kkkk.", "kXXxxk", "kxxxxk", ".kkkk.", ".k..k."]


def bay(corner=(60, 2), sea=19, sand=24, cliff=27, wobble=2.4):
    """A curved, irregular coast round one corner: sea, a sandy beach, then
    (unless cliff is None) a low cliff up to the grass. Edges wobble at several frequencies so the
    shoreline never runs straight."""
    import math
    ox, oy = corner

    def paint(g, face, W, H):
        def dist(x, y):
            a = math.atan2(y - oy, x - ox)
            w = wobble * (math.sin(a * 7 + 0.7) * 0.6 + math.sin(a * 13 + 2.1) * 0.3 + math.sin(a * 23) * 0.25)
            return math.hypot(x - ox, y - oy) + w

        def band(lo, hi):
            return lambda x, y: lo <= dist(x, y) < hi
        if cliff:
            _paint(g, face, band(sand, cliff), "f")                               # cliff face
            _paint(g, face, band(sand, sand + 1.2), "U")
            _paint(g, face, band(cliff - 0.9, cliff), "k")                        # cliff top edge
        _paint(g, face, band(sea, sand), "s")                                     # beach
        _paint(g, face, lambda x, y: sea + 1 <= dist(x, y) < sand and _noise(x, y, 4) < 0.01, "o")
        _paint(g, face, band(0, sea), "b")                                        # sea
        _paint(g, face, band(sea - 1.1, sea), "w")                                # surf line
        _paint(g, face, lambda x, y: dist(x, y) < sea - 3 and _noise(x, y, 8) < 0.012, "a")
    return paint


def open_pit(center=(27, 13), rx=18, ry=10, rings=4):
    """A terraced open-pit mine: concentric rings stepping down, each ring a
    light ledge over a darker wall, ending in a dark floor."""
    import math
    cx, cy = center

    def paint(g, face, W, H):
        for x, y in face:
            r = math.hypot((x - cx) / rx, (y - cy) / ry)
            if r >= 1:
                continue
            t = (1 - r) * rings                    # 0 at the rim, rings at the floor
            ring, frac = int(t), t - int(t)
            if ring >= rings - 1:
                g[y][x] = "q"                      # floor
            elif frac < 0.35:
                g[y][x] = "o" if y < cy + ry * 0.2 or x < cx else "f"   # ledge, lit on top and left
            else:
                g[y][x] = "u" if ring < 2 else "Q"  # wall
        for x, y in face:                          # rim edge
            r = math.hypot((x - cx) / rx, (y - cy) / ry)
            if 1 <= r < 1 + 1.2 / min(rx, ry):
                g[y][x] = "U"
    return paint


def headframe():
    c = Canvas(11, 13)
    for i in range(10):                        # A-frame legs
        c.px(1 + i * 3 // 10, 12 - i, "u")
        c.px(9 - i * 3 // 10, 12 - i, "U")
    c.rect(2, 7, 7, 1, "u")                    # cross brace
    c.rect(3, 4, 5, 1, "u")
    c.disc(5, 2, 2, "X", shade="x")            # winding wheel
    c.outline()
    c.px(5, 2, "k")
    c.px(5, 8, "!"); c.px(5, 9, "O")           # a lantern on the frame
    return c.rows()
LOGS = [".kkkkkkkk.", "kuuuuuuusk", "kkkkkkkkkk", "kuuuuuuusk", "kkkkkkkkkk"]
LOG = ["kkkkkk", "kuuusk", "kkkkkk"]
UMBRELLA = ["..kkk..", ".krwrk.", "krwrwrk", "...k...", "...k..."]
TOWEL = ["kkkk", "kPpk", "kkkk"]
BARREL = [".kkk.", "kyyOk", "kkkkk", "kyyOk", ".kkk."]
FENCE = ["k.k.k.k", "kkkkkkk", "k.k.k.k"]


def peaks(mountains):
    """Rocky mountains with uneven ridgelines: (cx, base_y, height, half_width)
    each. The ridge has shoulders and a secondary bump rather than a clean
    triangle; lit on the left, shaded on the right, a ragged snow line, and
    an inked silhouette."""
    import math

    def paint(g, face, W, H):
        for i, (cx, base, h, hw) in enumerate(mountains):
            def ridge(x):
                t = (x - cx) / hw
                if abs(t) >= 1:
                    return None
                shape = (1 - abs(t)) ** 0.8
                bumps = 0.18 * math.sin(t * 7 + i * 1.7) + 0.1 * math.sin(t * 15 + i)
                return base - h * max(0.15, shape + bumps * (1 - abs(t)))
            inside = lambda x, y: ridge(x) is not None and ridge(x) <= y <= base
            for x, y in face:
                if not inside(x, y):
                    continue
                top = ridge(x)
                snowy = y < top + h * 0.3 + 1.5 * math.sin(x * 1.3 + i)
                g[y][x] = ("w" if x <= cx else "a") if snowy else ("X" if x <= cx else "x")
            for x, y in face:
                if inside(x, y) and (not inside(x - 1, y) or not inside(x + 1, y) or not inside(x, y - 1)):
                    g[y][x] = "k"
    return paint


def planks(every=3, colour="u"):
    """Wooden decking: long vertical boards, with the odd joint and grain."""
    def paint(g, face, W, H):
        _paint(g, face, lambda x, y: x % every == 0, colour)
        _paint(g, face, lambda x, y: x % every != 0 and (y + (x // every) * 11) % 29 == 0, colour)
        _paint(g, face, lambda x, y: x % every == 1 and _noise(x, y, 12) < 0.005, "f")
    return paint


BOLLARD = [".kk.", "kxxk", "kxxk", ".kk."]


def crag(top=8, ledge=21, seed=0):
    """A close-up mountainside: a rock wall across the top with a jagged,
    snow-dusted crest and vertical cracks, ending in a ledge; below it a
    stony slope with scree and snow patches."""
    import math

    def paint(g, face, W, H):
        crest = lambda x: top + 3.2 * math.sin(x * 0.45 + seed) + 1.8 * math.sin(x * 1.1 + 2 + seed) + 1.0 * math.sin(x * 2.3)
        foot = lambda x: ledge + 1.5 * math.sin(x * 0.35 + 1 + seed) + 0.8 * math.sin(x * 1.7)
        for x, y in face:                                   # slope: scree
            if y > foot(x) and _noise(x, y, 21) < 0.008:
                g[y][x] = "X"
        for x, y in face:                                   # the rock wall
            if crest(x) <= y <= foot(x):
                lit = (x + int(y * 0.4)) % 9 < 4
                g[y][x] = "X" if lit else "x"
                if (x * 5 + 3) % 7 == 0 and y > crest(x) + 2:
                    g[y][x] = "d"                           # cracks
                if y < crest(x) + 2.2:
                    g[y][x] = "w" if lit else "a"           # snow on the crest
        for x, y in face:                                   # inked crest and ledge
            if crest(x) <= y <= foot(x) and (y - 1 < crest(x) or y + 1 > foot(x)):
                g[y][x] = "k"
    return paint
SNOWDRIFT = [".www..", "wwwwaa", ".aaaa."]


def gravel(center=(27, 15), rx=22, ry=9):
    """An irregular gravel yard: grey speckle with a ragged edge."""
    import math
    cx, cy = center

    def paint(g, face, W, H):
        for x, y in face:
            r = math.hypot((x - cx) / rx, (y - cy) / ry) + 0.12 * math.sin(x * 0.9) + 0.08 * math.sin(y * 1.3)
            if r < 1:
                n = _noise(x, y, 31)
                g[y][x] = "g" if n < 0.97 else "X" if n < 0.995 else "z"
    return paint


def snow_hills(hills):
    """Rolling snow: each (cx, cy, r) hill gets a shaded lower-right rim."""
    import math

    def paint(g, face, W, H):
        for cx, cy, r in hills:
            for x, y in face:
                d = math.hypot(x - cx, (y - cy) * 1.4)
                if r - 1.6 <= d < r and (x - cx) + (y - cy) * 1.4 > r * 0.2:
                    g[y][x] = "a"
    return paint


def ski_run(x_top=40, y_top=18, x_bottom=12, y_bottom=50, sway=6):
    """A winding ski run: two parallel tracks in an S-curve."""
    import math

    def paint(g, face, W, H):
        for y in range(y_top, y_bottom):
            t = (y - y_top) / (y_bottom - y_top)
            x = x_top + (x_bottom - x_top) * t + sway * math.sin(t * math.pi * 2)
            for dx in (0, 2):
                p = (round(x) + dx, y)
                if p in face:
                    g[y][p[0]] = "g"
    return paint


def cable(x0, y0, x1, y1, every=6):
    """A ski-lift cable with chairs hanging from it."""
    def paint(g, face, W, H):
        n = max(abs(x1 - x0), abs(y1 - y0))
        for i in range(n + 1):
            x = round(x0 + (x1 - x0) * i / n); y = round(y0 + (y1 - y0) * i / n)
            if (x, y) in face:
                g[y][x] = "x"
            if i % every == every // 2:
                for cx, cy, c in ((x, y + 1, "k"), (x, y + 2, "r"), (x - 1, y + 2, "r"), (x, y + 3, "k")):
                    if (cx, cy) in face:
                        g[cy][cx] = c
    return paint


SKIER = ["..k..", ".krk.", "..r..", ".k.k.", "kkkkk"]
FLAG_RED = ["kr", "kr", "k.", "k."]
FLAG_BLUE = ["kb", "kb", "k.", "k."]


def cave_cliff(top=6, foot=23, arches=((12, 4, 6), (27, 5, 9), (42, 4, 6)), eyes=27, seed=1):
    """A rock cliff across the top of the hex with cave mouths in its base:
    arches are (centre x, half width, height). Brown rock lit on the left of
    each buttress, a mossy uneven crest, rubble at the foot, glowing eyes in
    one cave."""
    import math

    def paint(g, face, W, H):
        crest = lambda x: top + 2.5 * math.sin(x * 0.5 + seed) + 1.5 * math.sin(x * 1.3 + 2) + 0.8 * math.sin(x * 2.9)
        base = lambda x: foot + 1.0 * math.sin(x * 0.4 + seed)
        def in_arch(x, y):
            for cx, hw, h in arches:
                b = base(x)
                if abs(x - cx) <= hw and y >= b - h * math.sqrt(max(0.0, 1 - ((x - cx) / (hw + 0.5)) ** 2)):
                    return True
            return False
        for x, y in face:                                         # cliff body
            if crest(x) <= y <= base(x):
                lit = (x + int(y * 0.3)) % 10 < 5
                g[y][x] = "U" if lit else "u"
                if (x * 3 + 1) % 8 == 0 and y > crest(x) + 3:
                    g[y][x] = "Q"                                 # cracks
                if y < crest(x) + 1.6:
                    g[y][x] = "G" if (x // 3) % 2 == 0 else "e"   # moss on the crest
        for x, y in face:                                         # cave mouths
            if crest(x) <= y <= base(x) and in_arch(x, y):
                g[y][x] = "k"
        for x, y in face:                                         # inked crest and foot
            if crest(x) <= y <= base(x) and not in_arch(x, y) and (y - 1 < crest(x) or y + 1 > base(x)):
                g[y][x] = "k"
        b = base(eyes)
        for ex in (eyes - 2, eyes + 1):                           # eyes in the big cave
            if (ex, round(b - 4)) in face:
                g[round(b - 4)][ex] = "y"
        for x, y in face:                                         # rubble at the foot
            if base(x) < y <= base(x) + 2 and _noise(x, y, 17) < 0.18 and not any(abs(x - cx) <= hw for cx, hw, _ in arches):
                g[y][x] = "X"
    return paint


EDGE_CORNERS = {"E": (0, 1), "SE": (1, 2), "SW": (2, 3), "W": (3, 4), "NW": (4, 5), "NE": (5, 0)}


def edge_coast(edges, sea=8, sand=12, cliff=None, wobble=1.6, water="b", shore="s", seed=0):
    """Water hugging the named hex edges (E, SE, SW, W, NW, NE), so it meets
    water on a neighbouring tile or the board's edge. Bands, measured in from
    the edge: sea, then sand (or another shore), then optionally a low cliff
    up to the ground. Every band edge wobbles so no line runs straight."""
    import math

    def paint(g, face, W, H):
        cx, cy, R = W / 2, H / 2, (H - 2) / 2
        corner = lambda i: (cx + R * math.cos(math.radians(60 * i - 30)), cy + R * math.sin(math.radians(60 * i - 30)))
        segs = [(corner(a), corner(b)) for a, b in (EDGE_CORNERS[e] for e in edges)]

        def dist(x, y):
            px_, py_ = x + 0.5, y + 0.5
            best = 1e9
            for (x1, y1), (x2, y2) in segs:
                dx, dy = x2 - x1, y2 - y1
                t = max(0.0, min(1.0, ((px_ - x1) * dx + (py_ - y1) * dy) / (dx * dx + dy * dy)))
                best = min(best, math.hypot(px_ - (x1 + t * dx), py_ - (y1 + t * dy)))
            w = wobble * (math.sin(px_ * 0.55 + py_ * 0.3 + seed) * 0.6 + math.sin(px_ * 1.3 - py_ * 0.9 + 2 + seed) * 0.4)
            return best + w

        band = lambda lo, hi: (lambda x, y: lo <= dist(x, y) < hi)
        if cliff:
            _paint(g, face, band(sand, cliff), "f")
            _paint(g, face, band(sand, sand + 1.2), "U")
            _paint(g, face, band(cliff - 0.9, cliff), "k")
        _paint(g, face, band(0, sand), shore)
        _paint(g, face, band(0, sea), water)
        _paint(g, face, band(sea - 1.0, sea), "w" if water == "b" else "a")
        _paint(g, face, lambda x, y: dist(x, y) < sea - 3 and _noise(x, y, 8 + seed) < 0.012, "a")
    return paint
BURNING_BARREL = ["...r...", "..rOr..", ".rOyOr.", ".OyyyO.", "..O!O..", ".kkkkk.", ".kXxxk.", ".kxxxk.", ".kXxxk.", "..kkk.."]
TYRE_STACK = [".kkkk.", "kxggxk", ".kkkk.", "kxggxk", ".kkkk.", "kxggxk", ".kkkk."]
CRUSHED_CAR = ["kkkkkkk", "kbbNbbk", "kNbbbNk", "kkkkkkk", "krrRrrk", "kkkkkkk"]


# Moonlight from the west, applied after night falls. LIT raises a night colour
# one subtle step; shadows use the caller's darkening.
LIT = {"v": "L", "x": "X", "X": "g", "Q": "u", "u": "U", "q": "Q", "h": "G", "e": "G",
       "n": "d", "d": "L", "N": "b", "k": "k"}


def moonlight(g, cells, water, darken, sprites=()):
    """West-facing shores catch a rim of light, east-facing shores fall into
    shade, and sprite pixels just inside their west outline are lit.
    `water(x, y)` says what was water before night; `sprites` is the set of
    pixels belonging to trees and other small sprites."""
    out = {}
    for x, y in cells:
        here = water(x, y)
        west = water(x - 1, y) or water(x - 2, y)
        east = water(x + 1, y) or water(x + 2, y)
        if not here:                                       # the shore itself
            if west and not east:
                out[(x, y)] = LIT.get(g[y][x], g[y][x])
            elif east and not west:
                out[(x, y)] = darken(g[y][x])
        else:                                              # surf at the shore's foot
            land_e = not water(x + 1, y) or not water(x + 2, y)
            land_w = not water(x - 1, y) or not water(x - 2, y)
            if land_e and not land_w:
                out[(x, y)] = LIT.get(g[y][x], g[y][x])
            elif land_w and not land_e:
                out[(x, y)] = darken(g[y][x])
    for x, y in sprites:
        if g[y][x] != "k" and ((x - 1, y) not in sprites or g[y][x - 1] == "k"):
            out[(x, y)] = LIT.get(g[y][x], g[y][x])
    for (x, y), ch in out.items():
        if 0 <= y < len(g) and 0 <= x < len(g[0]):
            g[y][x] = ch
