"""Slayer group art: a 16x16 emblem and an 80x32 player-card header scene for
each group, drawn with the Canvas toolkit from hexart.py."""
from hexart import Canvas


def _line(c, x0, y0, x1, y1, col, thick=1):
    n = max(abs(x1 - x0), abs(y1 - y0), 1)
    for i in range(n + 1):
        x = round(x0 + (x1 - x0) * i / n); y = round(y0 + (y1 - y0) * i / n)
        for t in range(thick):
            c.px(x + t, y, col)


# ---------------------------------------------------------------------------
# Emblems (16x16)
# ---------------------------------------------------------------------------

def emblem_slayerettes():
    c = Canvas(16, 16)
    for i in range(14):                        # the stake, drawn first so the heart covers its middle
        x, y = 1 + i, 14 - i
        c.px(x, y, "U"); c.px(x + 1, y, "U"); c.px(x, y - 1, "u")
    c.px(15, 0, "z"); c.px(14, 0, "z"); c.px(15, 1, "z")   # sharpened point out the far side
    heart = set()
    def hpx(x, y):
        heart.add((x, y))
    for cx in (5, 10):                         # the heart
        for yy in range(3, 10):
            for xx in range(cx - 3, cx + 4):
                if (xx - cx) ** 2 + (yy - 6) ** 2 <= 9 + 1.8:
                    hpx(xx, yy)
    for i in range(7):
        for xx in range(2 + i, 14 - i):
            hpx(xx, 7 + i)
    for x, y in heart:
        c.px(x, y, "r")
    c.outline()
    c.px(4, 5, "P"); c.px(5, 4, "P")           # shine
    for x, y in heart:                         # wounds where the stake goes in and comes out
        if c.g[y][x] == "r" and any((x + dx, y + dy) not in heart and 0 <= x + dx < 16 and 0 <= y + dy < 16
                                    and c.g[y + dy][x + dx] in "Uu" for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, -1), (-1, 1))):
            c.px(x, y, "R")
    return c.rows()


def emblem_kids_on_bikes():
    c = Canvas(16, 16)
    c.box(4, 5, 7, 10, "d", "x", "x")          # walkie-talkie
    c.rect(9, 1, 1, 4, "x")                    # antenna
    c.outline()
    for y in (7, 9, 11):
        c.rect(5, y, 5, 1, "k")                # grille
    c.px(5, 13, "r"); c.px(7, 13, "l")
    return c.rows()


def emblem_av_club():
    c = Canvas(16, 16)
    c.box(1, 2, 14, 10, "z", "z", "g")         # CRT bezel
    c.rect(5, 12, 6, 2, "g")                   # stand
    c.outline()
    c.rect(3, 4, 10, 6, "k")                   # screen
    c.rect(4, 5, 5, 1, "l"); c.rect(4, 7, 7, 1, "l"); c.px(4, 9, "l"); c.px(5, 9, "l")
    c.px(12, 11, "r")
    return c.rows()


def emblem_neighbourhood_watch():
    c = Canvas(16, 16)
    c.rect(7, 7, 7, 3, "g")                    # guide bar, with a rounded nose
    c.rect(14, 7, 1, 3, "g"); c.px(15, 8, "g")
    c.box(1, 6, 7, 6, "O", "r", "R")           # engine
    c.rect(2, 3, 4, 1, "x"); c.rect(1, 4, 1, 2, "x"); c.rect(6, 4, 1, 2, "x")   # top handle
    c.rect(0, 9, 1, 3, "x")                    # rear handle
    c.outline()
    for x in range(8, 14, 2):                  # chain teeth
        c.px(x, 6, "k"); c.px(x + 1, 10, "k")
    c.px(14, 7, "X"); c.px(14, 9, "X")         # shade the rounded nose
    c.px(3, 8, "y"); c.px(4, 10, "k")          # pull cord, vent
    return c.rows()


def emblem_father_and_the_flock():
    c = Canvas(16, 16)
    c.rect(6, 1, 4, 14, "y")                   # cross
    c.rect(2, 4, 12, 4, "y")
    c.outline()
    c.rect(7, 2, 1, 12, "w"); c.rect(3, 5, 10, 1, "w")   # highlight
    c.rect(9, 2, 1, 12, "O"); c.rect(3, 7, 10, 1, "O")
    return c.rows()


EMBLEMS = {
    "slayerettes": emblem_slayerettes,
    "kids-on-bikes": emblem_kids_on_bikes,
    "av-club": emblem_av_club,
    "neighbourhood-watch": emblem_neighbourhood_watch,
    "father-and-the-flock": emblem_father_and_the_flock,
}


# ---------------------------------------------------------------------------
# Header scenes (80x32)
# ---------------------------------------------------------------------------

W, H = 80, 32


def _sky(c, bands):
    """Horizontal bands of sky: [(colour, rows), ...] from the top."""
    y = 0
    for col, rows in bands:
        c.rect(0, y, W, rows, col)
        y += rows
    return y


def _figure(fig, x, y, skin, hair, shirt, pants, glasses=False, hold=None, collar=False, long_hair=False):
    """A small chibi figure, feet at y. Drawn on its own canvas and outlined."""
    f = Canvas(9, 14)
    f.rect(2, 0, 5, 2, hair)                   # hair
    if long_hair:
        f.rect(1, 1, 1, 5, hair); f.rect(7, 1, 1, 5, hair)
    f.rect(2, 2, 5, 3, skin)                   # face
    f.rect(2, 5, 5, 5, shirt)                  # body
    f.rect(1, 6, 1, 3, shirt); f.rect(7, 6, 1, 3, shirt)   # arms
    f.rect(2, 10, 2, 4, pants); f.rect(5, 10, 2, 4, pants) # legs
    if hold == "stake":
        f.rect(8, 3, 1, 6, "U"); f.px(8, 2, "z")
    elif hold == "torch":
        f.rect(8, 6, 1, 2, "X")
    elif hold == "chainsaw":
        f.rect(7, 7, 2, 2, "r")
    elif hold == "candle":
        f.rect(8, 5, 1, 3, "w"); f.px(8, 4, "y")
    elif hold == "bat":
        f.rect(8, 1, 1, 7, "z"); f.px(8, 0, "z")
    elif hold == "shovel":
        f.rect(8, 3, 1, 8, "u"); f.rect(7, 11, 2, 2, "g")
    f.outline()
    f.px(3, 3, "k"); f.px(5, 3, "k")           # eyes
    if glasses:
        f.px(3, 3, "a"); f.px(5, 3, "a"); f.px(4, 3, "k")
    if collar:
        f.px(4, 5, "w")
    for yy, row in enumerate(f.g):
        for xx, ch in enumerate(row):
            if ch != ".":
                fig.px(x + xx - 4, y - 14 + yy, ch)


def _bike(c, x, y, frame):
    """A bicycle, wheels resting on y."""
    for wx in (x - 4, x + 4):
        c.disc(wx, y - 2, 2, "k")
        c.px(wx, y - 2, "g")
    _line(c, x - 4, y - 2, x, y - 5, frame); _line(c, x, y - 5, x + 4, y - 2, frame); _line(c, x - 1, y - 5, x + 2, y - 5, frame)


def header_slayerettes():
    c = Canvas(W, H)
    ground = _sky(c, [("n", 10), ("N", 12)])
    c.disc(66, 6, 4, "w", shade="a")           # moon
    c.rect(4, 8, 30, 14, "v")                  # the school
    c.rect(14, 4, 10, 4, "v"); c.rect(18, 2, 2, 2, "v")
    for wx in range(7, 33, 5):
        c.rect(wx, 12, 2, 3, "y")
    c.rect(17, 16, 4, 6, "k")
    c.rect(0, ground, W, H - ground, "h")      # lawn
    c.rect(0, ground, W, 1, "e")
    for x in (40, 52, 64):
        pass
    _figure(c, 44, 31, "s", "y", "p", "b", long_hair=True, hold="stake")
    _figure(c, 56, 31, "u", "k", "m", "x", hold="stake")
    _figure(c, 68, 31, "f", "O", "c", "N", long_hair=True, hold="stake")
    return c.rows()


def header_kids_on_bikes():
    c = Canvas(W, H)
    ground = _sky(c, [("v", 6), ("p", 6), ("O", 5), ("y", 3)])
    for tx in (2, 9, 61, 70, 76):              # tree line
        c.roof(tx - 4, 8, 9, "h", "h"); c.rect(tx - 4, 13, 9, ground - 13, "h")
    c.rect(0, ground, W, H - ground, "x")      # road
    c.rect(0, ground, W, 1, "d")
    for x in range(2, W, 8):
        c.rect(x, 27, 4, 1, "y")
    for bx, frame, skin, hair, shirt in ((22, "r", "s", "u", "c"), (40, "c", "f", "k", "r"), (58, "l", "u", "O", "y")):
        _bike(c, bx, 31, frame)
        _figure(c, bx, 27, skin, hair, shirt, "b")
    return c.rows()


def header_av_club():
    c = Canvas(W, H)
    c.rect(0, 0, W, 22, "d")                   # basement wall
    for x in range(0, W, 10):
        c.rect(x, 0, 1, 22, "x")
    c.rect(0, 22, W, H - 22, "u")              # floor
    c.rect(2, 14, 34, 3, "U")                  # desk
    for mx in (4, 15, 26):                     # CRT monitors
        c.box(mx, 6, 9, 8, "z", "z", "g")
        c.rect(mx + 1, 7, 7, 5, "k")
        c.rect(mx + 2, 8, 4, 1, "l"); c.rect(mx + 2, 10, 5, 1, "l")
    c.rect(66, 3, 10, 7, "P")                  # a poster
    c.rect(68, 5, 6, 3, "m")
    _figure(c, 44, 31, "s", "k", "G", "x", glasses=True)
    _figure(c, 55, 31, "u", "u", "a", "N", glasses=True)
    _figure(c, 66, 31, "f", "y", "o", "x", glasses=True, long_hair=True)
    return c.rows()


def header_neighbourhood_watch():
    c = Canvas(W, H)
    ground = _sky(c, [("v", 6), ("L", 5), ("h", 9)])
    c.disc(10, 6, 3, "y", shade="O")           # low moon
    for zx in (66, 72):                        # shamblers on the horizon
        c.rect(zx, ground - 6, 3, 6, "q"); c.rect(zx - 1, ground - 5, 1, 2, "q"); c.rect(zx + 3, ground - 5, 2, 1, "q")
        c.px(zx, ground - 7, "q"); c.px(zx + 1, ground - 7, "q")
    c.box(22, 9, 24, 12, "U", "U", "u")        # boarded-up farmhouse
    c.roof(20, 2, 28, "R", "Q")
    for wx in (25, 39):
        c.rect(wx, 12, 4, 4, "k")
        for i in range(4):                     # boards nailed across
            c.px(wx + i, 12 + i, "f"); c.px(wx + 3 - i, 12 + i, "f")
    c.rect(32, 15, 4, 6, "k")
    c.rect(0, ground, W, H - ground, "e")      # yard
    c.rect(0, ground, W, 1, "G")
    c.box(2, 16, 14, 4, "R", "R", "Q")         # pickup truck
    c.rect(3, 13, 6, 3, "R"); c.rect(4, 14, 3, 1, "a")
    c.disc(5, 21, 2, "k"); c.disc(13, 21, 2, "k")
    _figure(c, 50, 31, "s", "u", "R", "b", hold="chainsaw")
    _figure(c, 61, 31, "u", "k", "G", "x", hold="bat")
    _figure(c, 72, 31, "f", "g", "o", "u", hold="shovel")
    return c.rows()


def header_father_and_the_flock():
    c = Canvas(W, H)
    c.rect(0, 0, W, 24, "X")                   # stone wall
    for y in range(2, 24, 4):
        for x in range((y // 4 % 2) * 4, W, 8):
            c.rect(x, y, 1, 4, "x")
        c.rect(0, y, W, 1, "x")
    c.rect(32, 2, 16, 18, "k")                 # stained glass window
    c.disc(40, 8, 6, "k")
    for i, col in enumerate(("r", "b", "y", "G", "m", "c")):
        c.rect(34 + (i % 3) * 4, 8 + (i // 3) * 5, 3, 4, col)
    c.disc(40, 6, 3, "y")
    c.rect(0, 24, W, H - 24, "u")              # floor
    c.rect(2, 20, 22, 3, "U"); c.rect(56, 20, 22, 3, "U")   # pews
    _figure(c, 40, 31, "s", "g", "k", "k", collar=True)
    _figure(c, 27, 31, "u", "k", "Q", "x", hold="candle")
    _figure(c, 53, 31, "f", "O", "v", "x", hold="candle", long_hair=True)
    return c.rows()


HEADERS = {
    "slayerettes": header_slayerettes,
    "kids-on-bikes": header_kids_on_bikes,
    "av-club": header_av_club,
    "neighbourhood-watch": header_neighbourhood_watch,
    "father-and-the-flock": header_father_and_the_flock,
}


# ---------------------------------------------------------------------------
# Banner scenes, 160x64: layered silhouettes, dithered skies, rim light
# ---------------------------------------------------------------------------

BW, BH = 160, 64
BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]


def gradient(c, y0, y1, colours):
    """A vertical sky gradient through the given colours, ordered-dithered."""
    n = len(colours) - 1
    for y in range(y0, y1):
        t = (y - y0) / max(1, y1 - y0 - 1) * n
        i = min(int(t), n - 1); f = t - i
        for x in range(BW):
            c.px(x, y, colours[i + 1] if f * 16 > BAYER[y % 4][x % 4] else colours[i])


def glow(c, cx, cy, r, colour, under):
    """A dithered halo of `colour` over pixels of `under`, fading with distance."""
    for y in range(cy - r, cy + r + 1):
        for x in range(cx - r, cx + r + 1):
            d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5 / r
            if d < 1 and 0 <= x < BW and 0 <= y < BH and c.g[y][x] in under and (1 - d) * 16 > BAYER[y % 4][x % 4] + 4:
                c.px(x, y, colour)


def ridge(c, y_base, amp, freq, colour, seed=0, y_max=None):
    """A silhouette band (hills, treeline, rooftops) filled down to y_max."""
    import math
    y_max = y_max or BH
    for x in range(BW):
        top = int(y_base - amp * (0.6 * math.sin(x * freq + seed) + 0.4 * math.sin(x * freq * 2.7 + seed * 2)))
        for y in range(max(0, top), y_max):
            c.px(x, y, colour)


def silhouette(c, x, feet, h, body="k", rim=None, rim_side=1, item=None, hair="short", stance=1):
    """A standing figure in silhouette, about h pixels tall: round head, hair,
    shoulders tapering to a waist, solid legs, arms at the sides (the right one
    raised if holding something). Optional rim light down one side."""
    shape = set()
    def row(y, x0, x1):
        for xx in range(round(x0), round(x1) + 1):
            shape.add((xx, y))
    r = h / 9                                  # head radius
    top = feet - h
    hy = top + r
    for yy in range(top, int(hy + r) + 1):     # head
        half = max(0.0, r * r - (yy - hy) ** 2) ** 0.5
        row(yy, x - half, x + half)
    if hair == "long":                         # hair falls past the shoulders
        for yy in range(int(hy), int(hy + r * 2.6)):
            row(yy, x - r - 1, x - r + 0.5); row(yy, x + r - 0.5, x + r + 1)
    elif hair == "pony":
        for yy in range(int(hy - r * 0.4), int(hy + r * 1.6)):
            row(yy, x - r - 1.5 - (yy - hy) * 0.15, x - r)
    neck = int(hy + r)
    row(neck, x - 1, x + 1)
    sh = neck + 1
    waist = feet - int(h * 0.45)
    hip = waist + int(h * 0.08)
    for yy in range(sh, hip + 1):              # torso: shoulders to waist to hips
        t = (yy - sh) / max(1, waist - sh)
        half = r * 1.5 - min(1.0, t) * r * 0.55 + (0.6 if yy > waist else 0)
        row(yy, x - half, x + half)
    for yy in range(hip, feet + 1):            # legs
        t = (yy - hip) / max(1, feet - hip)
        spread = t * 1.6 * stance
        row(yy, x - r * 0.95 - spread, x - 0.5 - spread * 0.6)
        row(yy, x + 0.5 + spread * 0.6, x + r * 0.95 + spread)
    for yy in range(sh + 1, hip):              # left arm hanging
        row(yy, x - r * 1.5 - 1.2, x - r * 1.5 - 0.2)
    if item == "stake":                        # right arm raised, stake held up
        for i in range(int(h * 0.22)):
            row(sh + 1 + i // 2 - i // 3, x + r * 1.5 + i * 0.35, x + r * 1.5 + i * 0.35 + 1)
        hx, hy2 = round(x + r * 1.5 + h * 0.08), sh
        for i in range(int(h * 0.38)):
            shape.add((hx + i // 5, hy2 - i))
    else:
        for yy in range(sh + 1, hip):
            row(yy, x + r * 1.5 + 0.2, x + r * 1.5 + 1.2)
    for px_, py_ in shape:
        c.px(px_, py_, body)
    if rim:
        for px_, py_ in shape:
            if (px_ + rim_side, py_) not in shape:
                c.px(px_, py_, rim)
    return shape


def ring(c, cx, cy, r, col, squash=1.0):
    """A one-pixel circle outline (squash < 1 flattens it vertically)."""
    import math
    for i in range(int(r * 8)):
        a = i / (r * 8) * 2 * math.pi
        c.px(round(cx + r * math.cos(a)), round(cy + r * squash * math.sin(a)), col)


def wire(c, x0, y0, x1, y1, sag, col):
    for x in range(min(x0, x1), max(x0, x1) + 1):
        t = (x - x0) / (x1 - x0)
        c.px(x, round(y0 + (y1 - y0) * t + sag * 4 * t * (1 - t)), col)


def fog(c, y0, y1, col, under):
    """A band of dithered mist, thickest at the bottom."""
    for y in range(y0, y1):
        f = (y - y0) / max(1, y1 - y0)
        for x in range(BW):
            if c.g[y][x] in under and f * 9 > BAYER[y % 4][x % 4] + 3:
                c.px(x, y, col)


def shaft(c, x_top, w_top, x_bottom, w_bottom, y0, y1, col, density=6):
    """A dithered light beam, a trapezoid from (x_top, y0) to (x_bottom, y1)."""
    for y in range(y0, y1):
        t = (y - y0) / max(1, y1 - y0)
        xc = x_top + (x_bottom - x_top) * t; w = w_top + (w_bottom - w_top) * t
        for x in range(int(xc - w / 2), int(xc + w / 2) + 1):
            if 0 <= x < BW and BAYER[y % 4][x % 4] < density * (1 - t * 0.6):
                c.px(x, y, col)


def banner_slayerettes():
    c = Canvas(BW, BH)
    gradient(c, 0, 46, ["n", "n", "v", "m", "L"])              # night sky to a violet horizon
    for sx, sy in ((14, 6), (40, 12), (71, 4), (98, 9), (150, 14), (138, 3), (58, 20), (84, 24)):
        c.px(sx, sy, "w")
    c.disc(118, 18, 11, "w")                                   # the moon, with a soft dithered shadow
    for y in range(7, 30):
        for x in range(107, 130):
            if c.g[y][x] == "w":
                d = ((x - 122) ** 2 + (y - 21) ** 2) ** 0.5
                if d > 9 and (d - 9) * 5 > BAYER[y % 4][x % 4]:
                    c.px(x, y, "a")
    glow(c, 118, 18, 24, "L", "vm")
    for bx, by in ((92, 12), (98, 16), (104, 10), (87, 19), (140, 26)):   # bats
        c.px(bx, by, "k"); c.px(bx - 1, by - 1, "k"); c.px(bx + 1, by - 1, "k")
    ridge(c, 44, 3, 0.05, "q", seed=1)                         # far hills
    c.rect(14, 22, 34, 24, "q"); c.rect(26, 12, 10, 10, "q"); c.roof(24, 6, 14, "q", "q")   # the school and its bell tower
    for wx in range(18, 46, 6):
        c.rect(wx, 28, 2, 3, "o"); c.rect(wx, 35, 2, 3, "y")
    c.rect(29, 15, 3, 4, "y")
    ridge(c, 52, 2, 0.08, "k", seed=3)                         # the near hill
    for i in range(20):                                        # a stake driven into the hill
        x = 112 + i // 7
        for dx in (0, 1, 2):
            c.px(x + dx, 34 + i, "k")
        c.px(x + 2, 34 + i, "L")                               # moonlit edge
    c.px(112, 33, "k"); c.px(113, 32, "L")
    return c.rows()


def banner_kids_on_bikes():
    c = Canvas(BW, BH)
    gradient(c, 0, 44, ["v", "p", "p", "O", "o", "y"])         # burning sunset
    c.disc(44, 44, 12, "y")                                    # the sun, sinking
    glow(c, 44, 44, 28, "y", "Oo")
    ridge(c, 42, 4, 0.07, "q", seed=2, y_max=50)               # treeline
    for tx in (8, 19, 140, 151):
        c.roof(tx - 6, 26, 13, "q", "q"); c.rect(tx - 6, 32, 13, 12, "q")
    c.rect(0, 44, BW, BH - 44, "k")                            # ground
    for y in range(44, BH):                                    # the road, narrowing to the horizon
        t = (y - 44) / (BH - 44)
        half = 4 + t * 46
        for x in range(int(80 - half), int(80 + half) + 1):
            c.px(x, y, "x")
        if int(y * 1.3) % 5 < 2:
            c.px(80, y, "y")
    for px_ in (12, 60, 104, 148):                             # telephone poles and wires
        c.rect(px_, 14, 2, 31, "k"); c.rect(px_ - 4, 17, 10, 1, "k")
    for a, b in ((12, 60), (60, 104), (104, 148)):
        wire(c, a - 3, 18, b - 3, 18, 3, "k"); wire(c, a + 4, 18, b + 4, 18, 3, "k")
    for wx, wy in ((70, 57), (92, 58)):                        # the abandoned bike, lying in the road
        ring(c, wx, wy, 8, "k", squash=0.5)
        ring(c, wx, wy, 7, "k", squash=0.5)
        c.px(wx, wy, "k")
    for a_, b_ in (((70, 57), (81, 53)), ((81, 53), (92, 58)), ((78, 53), (85, 53)), ((81, 53), (80, 49)), ((80, 49), (75, 48))):
        n = max(abs(b_[0] - a_[0]), abs(b_[1] - a_[1]), 1)
        for k in range(n + 1):
            t = k / n
            x_, y_ = round(a_[0] + (b_[0] - a_[0]) * t), round(a_[1] + (b_[1] - a_[1]) * t)
            c.px(x_, y_, "k"); c.px(x_, y_ + 1, "k")
    c.rect(73, 47, 5, 1, "k")                                  # handlebar
    c.rect(84, 51, 4, 1, "k")                                  # seat
    for x in range(58, 104):                                   # sunset rim along the bike's top edges
        for y in range(45, 63):
            if c.g[y][x] == "k" and c.g[y - 1][x] in "xy":
                c.px(x, y - 1, "O")
    return c.rows()


def banner_av_club():
    c = Canvas(BW, BH)
    c.rect(0, 0, BW, BH, "n")                                  # a computer lab after hours
    for wx in (6, 126):                                        # windows with the blinds half down
        c.rect(wx, 4, 28, 24, "N")
        for y in range(4, 28, 3):
            c.rect(wx, y, 28, 1, "k")
        c.rect(wx - 1, 3, 30, 1, "k"); c.rect(wx - 1, 28, 30, 1, "k")
    shaft(c, 20, 26, 34, 40, 28, 64, "v", density=3)            # moonlight through the blinds
    shaft(c, 140, 26, 126, 40, 28, 64, "v", density=3)
    for row, (y, w, gap) in enumerate(((30, 12, 6), (40, 16, 8))):   # two rows of desks, back row smaller
        x = 8 + row * 2
        c.rect(0, y + w // 2 + 2, BW, 2, "q")
        lit_at = 3 if row == 1 else -1
        for k in range(8 - row):
            mx = x + k * (w + gap)
            c.box(mx, y, w, w - 3, "d", "x", "k")
            screen = "h" if k == lit_at else "k"
            c.rect(mx + 2, y + 2, w - 4, w - 7, screen)
            if k == lit_at:
                for ty in range(y + 3, y + w - 6, 2):
                    c.rect(mx + 3, ty, (w - 7) - (ty % 3), 1, "l")
                glow(c, mx + w // 2, y + w // 2, 30, "h", "nqvk")
    c.rect(0, 56, BW, BH - 56, "k")
    return c.rows()

def banner_neighbourhood_watch():
    c = Canvas(BW, BH)
    gradient(c, 0, 46, ["q", "Q", "R", "r", "O"])              # blood-red dusk
    for bx, by in ((60, 15), (64, 17), (68, 14)):              # crows on the wire
        c.rect(bx, by - 1, 2, 2, "k"); c.px(bx + 2, by - 2, "k")
    wire(c, 0, 18, 159, 16, 3, "k")
    ridge(c, 46, 2, 0.06, "q", seed=4)
    c.rect(18, 24, 44, 24, "k"); c.roof(14, 8, 52, "k", "k")   # the farmhouse
    for wx in (24, 48):                                        # light leaking between boards nailed across the windows
        c.rect(wx, 30, 7, 7, "O"); c.rect(wx + 2, 32, 3, 3, "y")
        for by in (30, 32, 34, 36):
            c.rect(wx - 1, by, 9, 1, "k")
    c.rect(37, 36, 6, 12, "k")
    for i in range(30):                                        # a dead tree
        c.px(76 + i // 10, 47 - i, "k"); c.px(77 + i // 10, 47 - i, "k")
    for bx, by, dx in ((79, 26, 1), (78, 22, -1), (80, 32, 1)):
        for i in range(10):
            c.px(bx + i * dx, by - i // 2, "k")
    c.rect(0, 47, BW, BH - 47, "k")                            # ground
    fog(c, 40, 54, "Q", "kqR")                                 # low fog
    # the pickup, left with its door open and its headlights on
    truck = set()
    def block(x, y, w, h):
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                truck.add((xx, yy))
    block(96, 44, 22, 8)                                       # bed
    block(118, 37, 14, 15)                                     # cab
    block(132, 44, 9, 8)                                       # hood
    for x, y in truck:
        c.px(x, y, "k")
    for x, y in truck:                                         # dusk light on the top edge only
        if (x, y - 1) not in truck:
            c.px(x, y, "R")
    c.rect(120, 39, 9, 4, "q")                                 # windscreen
    c.rect(120, 43, 10, 8, "o"); c.rect(121, 44, 8, 6, "y")    # the open doorway, cab light on
    for y in range(52, 59):                                    # cab light spilling onto the ground
        for x in range(116 - (y - 52), 136 + (y - 52)):
            if BAYER[y % 4][x % 4] < 7 - (y - 52):
                c.px(x, y, "O")
    c.disc(104, 53, 4, "k"); c.disc(132, 53, 4, "k")           # wheels
    c.px(104, 53, "x"); c.px(132, 53, "x")
    door = Canvas(9, 14)                                       # the door, swung out towards us
    for i in range(12):
        door.rect(i // 4, i, 6, 1, "Q")
    door.outline()
    door.rect(1, 1, 4, 4, "q"); door.px(2, 2, "O")             # its window
    for y, row in enumerate(door.g):
        for x, ch in enumerate(row):
            if ch != ".":
                c.px(130 + x, 41 + y, ch)
    c.rect(140, 46, 1, 2, "y")                                 # headlight
    for x in range(141, BW):                                   # beams thrown into the fog
        t = (x - 141) / (BW - 141)
        for y in range(int(46 - t * 6), int(48 + t * 7) + 1):
            if 0 <= y < BH and BAYER[y % 4][x % 4] < 9 - t * 5:
                c.px(x, y, "y" if t < 0.35 else "o")
    return c.rows()


def banner_father_and_the_flock():
    c = Canvas(BW, BH)
    c.rect(0, 0, BW, BH, "k")                                  # inside a dark church
    for y in range(4, 50, 6):                                  # stone courses, barely lit
        for x in range((y // 6 % 2) * 8, BW, 16):
            c.rect(x, y, 15, 5, "n")
    c.rect(66, 2, 28, 40, "k")                                 # the window: lead and coloured glass
    c.disc(80, 14, 13, "k")
    cols = ["r", "b", "y", "G", "m", "c", "O", "b", "r", "y", "m", "G"]
    for i, (gx, gy) in enumerate((x, y) for y in range(6, 40, 6) for x in range(69, 92, 6)):
        c.rect(gx, gy, 5, 5, cols[i % len(cols)])
    c.disc(80, 12, 5, "y"); c.disc(80, 12, 2, "w")
    shaft(c, 74, 10, 50, 36, 42, 64, "r", density=4)            # coloured light across the floor
    shaft(c, 86, 10, 112, 36, 42, 64, "b", density=4)
    shaft(c, 80, 8, 80, 30, 42, 64, "y", density=5)
    c.rect(56, 48, 48, 6, "q")                                 # the altar
    c.rect(78, 40, 4, 8, "y"); c.rect(75, 43, 10, 2, "y")       # a cross
    for cx in (60, 66, 94, 100):                               # candles
        c.rect(cx, 44, 2, 4, "w"); c.px(cx, 42, "y"); c.px(cx, 43, "O")
        glow(c, cx, 42, 7, "Q", "kn")
    return c.rows()

BANNERS = {
    "slayerettes": banner_slayerettes,
    "kids-on-bikes": banner_kids_on_bikes,
    "av-club": banner_av_club,
    "neighbourhood-watch": banner_neighbourhood_watch,
    "father-and-the-flock": banner_father_and_the_flock,
}
