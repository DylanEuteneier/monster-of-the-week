"""Monster of the Week pixel art: the palette and every sprite as data.

Run `python3 assets/sprites.py` (or `npm run assets`) after any change. It
checks every sprite, then writes:

  public/assets/sprites.json        palette + sprites, read by the table and /assets
  public/assets/sprites/<id>.png    each sprite at 1x, served by Cloudflare as a static file
  assets/sheet.png                  every sprite at 8x on one sheet, for review

See assets/README.md for the format and the rules.
"""
import json, pathlib, struct, zlib

ROOT = pathlib.Path(__file__).resolve().parent.parent

PALETTE = {
    # The 32-colour palette (designer, 2026-10-03), in the order supplied.
    # Keys used by the test art keep the role they had; the rest are new.
    ".": None,          # transparent
    "q": "#462d3c",     # deep plum
    "Q": "#5e3643",     # plum
    "u": "#7a444a",     # rosewood
    "U": "#a05b54",     # clay
    "f": "#c07959",     # terracotta
    "o": "#efa260",     # apricot
    "s": "#f6cca1",     # sand
    "l": "#b6d43c",     # lime
    "G": "#71ab43",     # leaf green
    "e": "#387c44",     # forest green
    "h": "#3c5957",     # deep teal
    "k": "#302b2d",     # ink: outlines
    "x": "#5a5454",     # charcoal
    "X": "#7d7071",     # warm grey
    "g": "#a0948f",     # stone grey
    "z": "#cfc6b8",     # bone
    "w": "#e0f2f4",     # near-white
    "a": "#97d8e3",     # pale aqua
    "c": "#3dc3d8",     # cyan
    "b": "#3879a9",     # sea blue
    "N": "#384779",     # navy: night sky, lighter band
    "n": "#39314b",     # night sky
    "v": "#564164",     # dusk violet
    "m": "#8f488d",     # purple
    "p": "#ce5f93",     # pink
    "P": "#f7acb6",     # blush
    "y": "#f4b41a",     # gold: lamplight
    "O": "#f47e20",     # orange
    "r": "#e7482d",     # red
    "R": "#a93c3b",     # dark red
    "L": "#837195",     # lavender
    "d": "#4f546b",     # slate: shadow
}

SPRITES = {
}




# ---------------------------------------------------------------------------
# Faction icons: one per faction, keyed by the faction id in spec.json
# ---------------------------------------------------------------------------

SPRITES.update({
    "vampires": [
        "................",
        ".....kkkkkk.....",
        "....kxxxxxxk....",
        "...kxxxkkxxxk...",
        "...kxxkzzkxxk...",
        "...kxkzzzzkxk...",
        "...kkzzzzzzkk...",
        "...kzrzzzzrzk...",
        "...kzzzzzzzgk...",
        "...kzzkkkkzgk...",
        "...kzzwkkwzgk...",
        "..kRkzzzzzzkRk..",
        ".kRRRkzzzzkRRRk.",
        ".kRrRRkkkkRRrRk.",
        ".kRrRRRRRRRRrRk.",
        "..kkkkkkkkkkkk..",
    ],
    "werewolves": [
        "................",
        "..k..........k..",
        "..kk........kk..",
        "..kXk......kXk..",
        "..kXXkkkkkkXXk..",
        "..kXgXXXXXXXxk..",
        ".kXgXXXXXXXXXxk.",
        ".kXXykXXXXkyXxk.",
        ".kXXXXXXXXXXXxk.",
        "..kXXXzzzzXXxk..",
        "..kXXzzkkzzXxk..",
        "...kXzzzzzzxk...",
        "...kXzwkkwzxk...",
        "....kXzzzzxk....",
        ".....kkkkkk.....",
        "................",
    ],
    "occult": [
        "................",
        "......kkkk......",
        ".....kmmmmk.....",
        "....kmLmmmvk....",
        "...kmLmkkmmvk...",
        "...kmmkkkkmvk...",
        "...kmkykkykvk...",
        "...kmkkkkkkvk...",
        "..kmmmkkkkmmvk..",
        "..kmLmmmmmmmvk..",
        ".kmLmmmyymmmmvk.",
        ".kmmmmyyyymmmvk.",
        ".kmmmmmyymmmmvk.",
        ".kmmmmmmmmmmmvk.",
        ".kkkkkkkkkkkkkk.",
        "................",
    ],
    "aliens": [
        "................",
        ".....kkkkkk.....",
        "...kkGGGGGGkk...",
        "..kGlGGGGGGGek..",
        ".kGlGGGGGGGGGek.",
        ".kGGGGGGGGGGGek.",
        ".kGkkkGGGGkkkek.",
        ".kkwkkkGGkkkwkk.",
        ".kGkkkkGGkkkkek.",
        "..kGkkkGGkkkek..",
        "..kGGGGGGGGGek..",
        "...kGGGGGGGek...",
        "....kGGkkGek....",
        ".....kGGGek.....",
        "......kkkk......",
        "................",
    ],
    "dark-government": [
        "................",
        ".....kkkkkk.....",
        "....kxxxxxxk....",
        "....kxdxxxxk....",
        "..kkkkkkkkkkkk..",
        "....ksssssUk....",
        "....kkkkkkkk....",
        "....kkakkakk....",
        "....ksssssUk....",
        "....kskkssUk....",
        ".....ksssUk.....",
        "..kkkxkwwkxkkk..",
        ".kxxxxkwkwkxxxk.",
        ".kxdxxxwkwxxxxk.",
        ".kxdxxxwkwxxxxk.",
        ".kkkkkkkkkkkkkk.",
    ],
    "cryptids": [
        "................",
        ".....kkkkkk.....",
        "...kkUfUUUUkk...",
        "..kUfUUUUUUUuk..",
        ".kUfUUUUUUUUUuk.",
        ".kUUkkkkkkkkUuk.",
        ".kUkffffffffkuk.",
        ".kUfkyffffykfuk.",
        ".kUffffkkffffuk.",
        ".kUfffffffffUuk.",
        "..kUfkkkkkkfuk..",
        "..kUUfffffffuk..",
        "...kUUUUUUUuk...",
        "....kkUUUUukk...",
        "......kkkkk.....",
        "................",
    ],
    "machines": [
        "................",
        "................",
        ".....kkkkkk.....",
        "...kkwggggXkk...",
        "..kwgggggggXXk..",
        "..kggggggggXXk..",
        "..kgkkkggkkkXk..",
        "..kgkrkggkrkXk..",
        "..kgkkkggkkkXk..",
        "..kggggkkggggk..",
        "...kgggggggXk...",
        "...kxkxkxkxkk...",
        "...kgkgkgkgXk...",
        "....kxxxxxxk....",
        ".....kkkkkk.....",
        "................",
    ],
    "ai": [
        "................",
        ".....kkkkkk.....",
        "...kkxxxxxxkk...",
        "..kxxdddddxxxk..",
        ".kxddkkkkkkdxxk.",
        ".kxdkkRRRRkkdxk.",
        ".kxdkRrrrrRkdxk.",
        ".kxdkRryOrRkdxk.",
        ".kxdkRrOOrRkdxk.",
        ".kxdkRrrrrRkdxk.",
        ".kxdkkRRRRkkdxk.",
        ".kxxdkkkkkkddxk.",
        "..kxxxdddddxxk..",
        "...kkxxxxxxkk...",
        ".....kkkkkk.....",
        "................",
    ],
    "cyberpunks": [
        "......kppk......",
        "......kPpk......",
        ".....kkppkk.....",
        "....kxxppxxk....",
        "...kxsssssUxk...",
        "...ksssssssUk...",
        "...kkkkkkkkkk...",
        "...kcacccccck...",
        "...kkkkkkkkkk...",
        "...ksssssssUk...",
        "...kssskkssUk...",
        "....kssssUUk....",
        ".....kkkkkk.....",
        "....kmmkkmmk....",
        "...kmmmLLmmmk...",
        "...kkkkkkkkkk...",
    ],
    "zombies": [
        "................",
        ".....kkkkkk.....",
        "...kkpPpGGGkk...",
        "..kpPppkGGGGek..",
        "..kppkGGGGGGek..",
        "..kGGGGGGGGGek..",
        "..kGkkkGGkkkek..",
        "..kGkwkGGkykek..",
        "..kGGGGGGGGGek..",
        "..kGGGGkkGGGek..",
        "..kGkkkkkkkGek..",
        "..kGkzkzkzkGek..",
        "...kGGGGGGGek...",
        "....kkGGGGkk....",
        "......kkkk......",
        "................",
    ],
    "skeletons": [
        ".....kkkkkk.....",
        "....kwwwwwzk....",
        "...kwwwwwwwzk...",
        "...kwkkwwkkzk...",
        "...kwkkwwkkzk...",
        "...kwwwkkwwzk...",
        "....kwwwwwzk....",
        "....kwkwkwkk....",
        ".....kkwzkk.....",
        "...kkkkwzkkkk...",
        "..kwwwwkkwwwzk..",
        "..kkkkwwzkkkkk..",
        "...kwwwkkwwzk...",
        "...kkkkwzkkkk...",
        "....kwwkkwzk....",
        "....kkk..kkk....",
    ],
    "spirits": [
        "................",
        ".....kkkkkk.....",
        "....kwwwwwak....",
        "...kwwwwwwwak...",
        "...kwwwwwwwak...",
        "...kwkkwwkkak...",
        "...kwkkwwkkak...",
        "...kwwwwwwwak...",
        "...kwwwkkwwak...",
        "...kwwwkkwwak...",
        "...kwwwwwwwak...",
        "...kwwwwwwwak...",
        "...kwwwwwwwak...",
        "...kwakwakwak...",
        "...k..k..k..k...",
        "................",
    ],
    "demons": [
        "................",
        ".k............k.",
        ".kzk........kzk.",
        "..kzk......kzk..",
        "...kzkkkkkkzk...",
        "...krrrrrrrRk...",
        "..krrrrrrrrrRk..",
        "..krkykrrkykRk..",
        "..krrrrrrrrrRk..",
        "..krrkrrrrkrRk..",
        "..krrrkkkkrrRk..",
        "...krrrrrrrRk...",
        "....kkrrrrRkk...",
        "......krRk......",
        ".......kk.......",
        "................",
    ],
    "possessed": [
        "................",
        ".....kkkkkk.....",
        "...kkxxxxxxkk...",
        "..kxxxxxxxxxxk..",
        "..kxxkkkkkkxxk..",
        "..kxkzzzzzzkxk..",
        "..kxkddzzddkxk..",
        "..kxkdyzzydkxk..",
        "..kxkzzzzzzkxk..",
        "..kxkzzkkzzkxk..",
        "..kxkzzkkzzkxk..",
        "..kxxkzzzzkxxk..",
        "..kxxxkkkkxxxk..",
        "..kxxk....kxxk..",
        "..kkk......kkk..",
        "................",
    ],
    "shadows": [
        "................",
        "......kkkk......",
        "....kknnnnkk....",
        "...kvnnnnnnnk...",
        "..kvnnnnnnnnnk..",
        "..kvnynnnnynnk..",
        "..kvnnnnnnnnnk..",
        "..knnnnnnnnnnk..",
        "...knnnnnnnnk...",
        "..kvnnnnnnnnnk..",
        ".kvnnnnnnnnnnnk.",
        ".knnknnnnnnknnk.",
        "knnk.knnnnk.knnk",
        "knk..knnnnk..knk",
        ".k....knnk....k.",
        ".......kk.......",
    ],
})

# Slayer group emblems (16x16) and player-card header scenes (80x32)
import slayers as SL
SPRITES.update({gid: draw() for gid, draw in SL.EMBLEMS.items()})
HEADERS = {gid: draw() for gid, draw in SL.BANNERS.items()}   # 160x64 mood scenes

FACTION_IDS = tuple(f["id"] for f in json.loads((ROOT / "public" / "spec.json").read_text())["factions"])


# ---------------------------------------------------------------------------
# Presence tokens: a smooth die-cut outline per sprite, as SVG
# ---------------------------------------------------------------------------
# The token itself is drawn by CSS (.token in public/app.css): a cream card
# cut to this outline, with thickness and a soft shadow. The pixel art sits
# on its face. Only the outline is generated here.

TOKEN_PAD = 4          # sprite pixels of card around the art; room for wide art
TOKEN_SPREAD = 1.9     # radius of the blob drawn around each art pixel
TOKEN_SMOOTH = 1.1     # blur before thresholding; higher = rounder, rougher cut


def token_svg(rows):
    w, h = len(rows[0]) + 2 * TOKEN_PAD, len(rows) + 2 * TOKEN_PAD
    dots = "".join(
        f'<circle cx="{x + TOKEN_PAD + 0.5}" cy="{y + TOKEN_PAD + 0.5}" r="{TOKEN_SPREAD}"/>'
        for y, row in enumerate(rows) for x, ch in enumerate(row) if PALETTE[ch]
    )
    # Blur the blobs together, then snap the alpha back to a hard edge: a
    # smooth outline that follows the art without tracing every pixel.
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">'
        f'<filter id="cut" x="-10%" y="-10%" width="120%" height="120%">'
        f'<feGaussianBlur stdDeviation="{TOKEN_SMOOTH}"/>'
        f'<feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 24 -11"/>'
        f'</filter><g filter="url(#cut)" fill="#fff">{dots}</g></svg>\n'
    )


# Presence tokens are per faction (designer, 2026-10-03).
TOKEN_SOURCES = tuple(fid for fid in FACTION_IDS if fid in SPRITES)


# ---------------------------------------------------------------------------
# Board hexes: a floating hex of ground with a location's building on it
# ---------------------------------------------------------------------------
# Pointy-top hexes, drawn at 1x and shown at 2x. The upper part holds the
# building; the lower part is left clear for presence tokens and influence
# cubes (its box is exported as "pieces" in sprites.json).

HEX_R = 30           # circumradius of the hex, in pixels
HEX_W = round(3 ** 0.5 * HEX_R)
HEX_H = 2 * HEX_R


def _in_hex(x, y, cx, cy):
    """Is the pixel centre (x + .5, y + .5) inside the pointy-top hex at (cx, cy)?"""
    dx, dy = abs(x + 0.5 - cx), abs(y + 0.5 - cy)
    return dx <= HEX_W / 2 and dy <= HEX_R - dx / (3 ** 0.5)


# Each location's archetype shows in its hex: a bevelled border in the
# archetype's colours, and a small pixel symbol on the ground. The ground
# itself is the location's own (grass, snow, sand...). Tiles have no cliffs;
# they sit together as one board.
ARCHETYPE_BORDERS = {
    "nocturnals": {"lit": "L", "mid": "m", "dark": "v"},
    "scifi": {"lit": "a", "mid": "c", "dark": "b"},
    "sentients": {"lit": "z", "mid": "g", "dark": "X"},
    "undead": {"lit": "l", "mid": "G", "dark": "h"},
    "demonic": {"lit": "o", "mid": "r", "dark": "R"},
}

# Archetype symbols (designer, 2026-10-03): moon and star, alien head, power,
# skull, horns. Bold 7x7 glyphs, "#" in the main colour, "*" in the second, other letters as palette keys,
# each on a plaque cut to its own shape: a solid ink outline one pixel all
# round, 9x9 in all, placed bottom middle over the lower border.
ARCHETYPE_GLYPHS = {
    "nocturnals": ["..###..", ".##....", "##...*.", "##..***", "##...*.", ".##....", "..###.."],   # moon and star
    "scifi": [".#####.", "#######", "#..#..#", "###.###", ".#####.", "..###..", "...#..."],        # alien head
    "sentients": ["...#...", ".#.#.#.", "#.rrr.#", "#.rOr.#", "#.rrr.#", ".#...#.", "..###.."],    # power, with a red eye
    "undead": [".#####.", "#######", "#..#..#", "#######", "###.###", ".#.#.#.", "......."],       # skull
    "demonic": ["#.....#", "#.....#", "##...##", ".#####.", ".#y#y#.", "..###..", "......."],      # horns, with glowing eyes
}

# (main, second) colour for each symbol.
SYMBOL_COLOURS = {
    "nocturnals": ("w", "y"),
    "scifi": ("l", "l"),
    "sentients": ("a", "a"),
    "undead": ("z", "z"),
    "demonic": ("r", "r"),
}


def shaped_plaque(glyph, colours):
    size = len(glyph) + 2
    main, second = colours
    # "#" main colour, "*" second colour, any other letter is that palette key
    ink = {(x + 1, y + 1): (main if ch == "#" else second if ch == "*" else ch)
           for y, row in enumerate(glyph) for x, ch in enumerate(row) if ch != "."}
    ring = {(x + dx, y + dy) for x, y in ink for dx in (-1, 0, 1) for dy in (-1, 0, 1)} - set(ink)
    return ["".join(ink.get((x, y)) or ("k" if (x, y) in ring else ".") for x in range(size)) for y in range(size)]


ARCHETYPE_SYMBOLS = {arch: shaped_plaque(glyph, SYMBOL_COLOURS[arch]) for arch, glyph in ARCHETYPE_GLYPHS.items()}


def hex_ground(top="e", lit="l", mid="G", dark="h"):
    """A flat hex: the location's ground, framed by a bevelled border in the
    archetype's colours (light on the upper-left, dark on the lower-right),
    with an ink outline."""
    W, H = HEX_W + 2, HEX_H + 2
    cx, cy = W / 2, HEX_R + 1
    face = {(x, y) for y in range(H) for x in range(W) if _in_hex(x, y, cx, cy)}
    g = [["."] * W for _ in range(H)]
    sides = ((1, 0), (-1, 0), (0, 1), (0, -1))
    outer = {(x, y) for x, y in face if any((x + dx, y + dy) not in face for dx, dy in sides)}
    inner = {(x, y) for x, y in face - outer if any((x + dx, y + dy) in outer for dx, dy in sides)}
    lower_right = lambda x, y: (x + 0.5 - cx) + (y + 0.5 - cy) * 0.8 > 0
    for x, y in face:
        g[y][x] = top
    for x, y in inner:
        g[y][x] = mid if lower_right(x, y) else lit
    for x, y in outer:
        g[y][x] = dark if lower_right(x, y) else mid
    for x, y in _outline(face, W, H):
        g[y][x] = "k"
    top_face = face - outer - inner
    return g, top_face


def _outline(cells, W, H):
    out = set()
    for x, y in cells:
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            n = (x + dx, y + dy)
            if n not in cells and 0 <= n[0] < W and 0 <= n[1] < H:
                out.add(n)
    return out


# A building's shadow darkens whatever terrain it falls on, one step.
SHADOW = {
    "e": "h", "G": "e", "l": "G", "h": "d",          # grass
    "w": "a", "a": "g",                               # snow
    "s": "o", "o": "f",                               # sand
    "f": "U", "U": "u", "u": "Q", "Q": "q",           # dirt and pit
    "g": "X", "X": "x", "x": "d", "z": "g",           # stone and concrete
    "b": "N", "N": "n",                               # water
    "P": "p", "y": "O",
}

# Night: the island's ground, water, and buildings shift to darker, cooler
# palette colours so the pieces (cream tokens, vivid cubes) stand out. Lights
# (gold, orange, cyan) and ink stay as they are, and so do the archetype
# borders and symbols. Set NIGHT_MODE = False for the daytime colours.
NIGHT_MODE = True
NIGHT = {
    "e": "h", "G": "e", "l": "G", "h": "d",          # grass
    "w": "L", "a": "v",                              # snow and surf
    "s": "X", "o": "U", "z": "g",                    # sand and bone
    "f": "u", "U": "Q", "u": "q", "Q": "q",          # dirt, wood, brick
    "g": "X", "X": "x", "x": "d", "d": "n",          # stone and concrete
    "b": "N", "N": "n",                              # water
    "r": "R", "R": "q", "p": "m", "P": "p",          # reds and pinks
    "m": "v", "L": "v", "v": "n",                    # purples
}


# The landscape (ground, water, plants) gets its own darker night map, chosen
# so land and water stay distinct.
LANDSCAPE_NIGHT = {
    "e": "h", "G": "h", "l": "e", "h": "d",          # grass, darkest green
    "w": "v", "a": "L",                              # snow to dusk violet; surf a faint lavender
    "s": "x", "o": "u", "z": "X",                    # sand
    "f": "Q", "U": "q", "u": "q", "Q": "q",          # dirt
    "g": "x", "X": "d", "x": "n", "d": "n",          # stone
    "b": "n", "N": "n",                              # all water one dark sea colour
    "r": "R", "R": "q", "p": "m", "P": "p", "m": "v", "L": "v", "v": "n",
}


# Shadows at night: the palette colour nearest the ground darkened by about a
# fifth, and always darker than the ground it falls on.
def _shadow_of(ch):
    hex_rgb = lambda h: tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))
    rgb = hex_rgb(PALETTE[ch])
    lum = lambda c: 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]
    target = tuple(v * 0.8 for v in rgb)
    darker = [k for k, v in PALETTE.items() if v and lum(hex_rgb(v)) < lum(rgb) * 0.92]
    if not darker:
        return ch
    return min(darker, key=lambda k: sum((a - b) ** 2 for a, b in zip(hex_rgb(PALETTE[k]), target)))




def night(ch):
    return NIGHT.get(ch, ch) if NIGHT_MODE else ch


def night_landscape(ch):
    return LANDSCAPE_NIGHT.get(ch, ch) if NIGHT_MODE else ch


TUFT = ["l.l", ".G."]
ROCK = [".kk.", "kXgk", "kxdk", ".kk."]
FLOWER = ["P", "G"]
PATH = ["ss", "ss", "zs"]


SYMBOL_AT = ((HEX_W + 2 - 9) // 2, 49)   # bottom middle, over the lower border


def hex_tile(building, at, archetype, ground=None, decor=(), landscape=(), bright_night=False, light="night"):
    """Place a building sprite on a hex, with a soft shadow to the lower right.
    The border takes the archetype's colours and its symbol sits on the ground.
    `landscape` painters run on the ground first, then `decor` sprites
    ((sprite, (x, y)) pairs), then the building, clipped to the hex."""
    g, top_face = hex_ground(**{**ARCHETYPE_BORDERS[archetype], **(ground or {})})
    W, H = len(g[0]), len(g)
    for paint in landscape:
        paint(g, top_face, W, H)
    lights = []                                            # "!" in a building or decor is a light
    front = [d for d in decor if len(d) > 2]               # (sprite, at, "front") is drawn over the building
    for sprite, (dx, dy), *_ in [d for d in decor if len(d) == 2]:
        for y, row in enumerate(sprite):
            for x, ch in enumerate(row):
                if ch != "." and (dx + x, dy + y) in top_face:
                    if ch == "!":
                        lights.append((dx + x, dy + y)); ch = "y"
                    g[dy + y][dx + x] = ch
    bx, by = at
    shape = {(bx + x, by + y) for y, row in enumerate(building) for x, ch in enumerate(row) if ch != "."}
    shaded = set()
    for x, y in shape:
        for sx, sy in ((2, 1), (3, 2), (4, 2)):
            p = (x + sx, y + sy)
            if p in top_face and p not in shape and p not in shaded:
                shaded.add(p)
                if not NIGHT_MODE:
                    g[p[1]][p[0]] = SHADOW.get(g[p[1]][p[0]], g[p[1]][p[0]])
    inside = {(x, y) for y in range(H) for x in range(W) if g[y][x] != "."}
    for y, row in enumerate(building):
        for x, ch in enumerate(row):
            if ch != "." and (bx + x, by + y) in inside:
                if ch == "!":
                    lights.append((bx + x, by + y)); ch = "y"
                g[by + y][bx + x] = ch
    for sprite, (dx, dy), _ in front:
        for y, row in enumerate(sprite):
            for x, ch in enumerate(row):
                if ch != "." and (dx + x, dy + y) in top_face:
                    if ch == "!":
                        lights.append((dx + x, dy + y)); ch = "y"
                    g[dy + y][dx + x] = ch
                    shape.add((dx + x, dy + y))
    day = [row[:] for row in g]
    for x, y in top_face:                                  # night falls: buildings one step, landscape darker
        g[y][x] = night(g[y][x]) if (x, y) in shape or bright_night else night_landscape(g[y][x])
    if NIGHT_MODE:                                         # shadows fall after night, one step darker
        for x, y in shaded:
            if (x, y) not in shape:
                g[y][x] = _shadow_of(g[y][x]) if PALETTE.get(g[y][x]) else g[y][x]
    if NIGHT_MODE:                                         # moonlight from the west on the tile's shores
        wet = lambda x, y: 0 <= y < H and 0 <= x < W and (day[y][x] in "bN" or (
            day[y][x] in "wa" and any(0 <= x + i < W and day[y][x + i] in "bN" for i in (-1, 1))))
        def water(x, y):
            return (x, y) in top_face and wet(x, y) if (x, y) in top_face else water_off(x, y)
        def water_off(x, y):                                # past the tile's edge, carry the nearest water on
            return wet(min(max(x, 0), W - 1), y)
        A.moonlight(g, [p for p in top_face if p not in shape], water,
                    lambda ch: _shadow_of(ch) if PALETTE.get(ch) else ch)
    if NIGHT_MODE:                                         # each light burns bright: a near-white core
        for x, y in lights:
            g[y][x] = "w"
    if light == "spotlight":                               # a torch on the tile: a crisp pool of true colour
        cx, cy, rx, ry = W / 2, H * 0.44, W * 0.36, H * 0.30
        for x, y in top_face:
            if ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1:
                g[y][x] = day[y][x]
    if light == "day":                                     # full daylight: the whole tile in its true colours
        for x, y in top_face:
            g[y][x] = day[y][x]
        for x, y in shaded:
            if (x, y) not in shape:
                g[y][x] = SHADOW.get(g[y][x], g[y][x])
    sx, sy = SYMBOL_AT
    for y, row in enumerate(ARCHETYPE_SYMBOLS[archetype]):
        for x, ch in enumerate(row):
            if ch != ".":
                g[sy + y][sx + x] = ch
    return ["".join(r) for r in g]


LIGHTHOUSE_BUILDING = [
    "......k" + "." * 11,
    ".....kXk" + "." * 10,
    "....kXXxk" + "." * 9,
    "....kkkkk" + "." * 9,
    "....ky!yk" + "." * 9,
    "...kkkkkkk" + "." * 8,
    "....kwzgk" + "." * 9,
    "....kwkgk." + "kkkkkk" + "..",
    "....kwzgk" + "kxxxxxk" + "..",
    "...kwwzgk" + "kkkkkkk" + "..",
    "...kwwkgk" + "dyydydk" + "..",
    "...kwwzgk" + "ddddkdk" + "..",
    "..kkkkkkk" + "ddddkdk" + "..",
    "..kXXxxxk" + "ddddddk" + "..",
    "..kkkkkkkkkkkkkk..",
]

import hexart as A

LOCATION_ARCHETYPE = {l["id"]: l["archetype"] for l in json.loads((ROOT / "public" / "spec.json").read_text())["locations"]}

HELIPAD = ["kkkkkkk", "kxwxwxk", "kxwwwxk", "kxwxwxk", "kkkkkkk"]

# id: (building, ground, landscape painters, decor[, building position])
LOCATION_ART = {
    "lighthouse": (LIGHTHOUSE_BUILDING, "e", [A.edge_coast(["E", "SE"], sea=5, sand=8, cliff=10, wobble=1.2, seed=1)],
                   [(TUFT, (6, 30)), (TUFT, (9, 44)), (FLOWER, (10, 20)), (FLOWER, (13, 22)),
                    (ROCK, (49, 40)), (A.STONE, (50, 31))]),
    "caves": (["."], "e", [A.texture("G", step=8), A.cave_cliff()],
              [(["!"], (25, 19)), (["!"], (28, 19)), (A.BOULDER, (8, 30)), (A.BOULDER, (42, 32)), (A.STONE, (14, 44)), (A.STONE, (38, 45)), (TUFT, (20, 34)), (TUFT, (34, 40))], (0, 0)),
    "lake-house": (A.lake_house(), "e", [A.edge_coast(["E"], sea=10, sand=12, seed=2)],
                   [(A.REEDS, (40, 24)), (A.REEDS, (41, 40)), (A.DOCK, (38, 31)), (TUFT, (8, 30)), (TUFT, (12, 44)), (FLOWER, (16, 22))]),
    "military-facility": (A.military_facility(), "w", [A.texture("a", step=5)],
                          [(HELIPAD, (6, 38)), (A.BOULDER, (43, 22)), (A.STONE, (44, 42))]),
    "weather-station": (A.weather_station(), "w", [A.texture("a", step=8), A.crag(top=5, ledge=22)],
                        [(A.SNOWDRIFT, (6, 27)), (A.SNOWDRIFT, (40, 33)), (A.SNOWDRIFT, (12, 44)), (A.SNOW_PINE, (42, 36)),
                         (A.BOULDER, (43, 25)), (A.STONE, (8, 37))]),
    "state-park": (A.state_park(), "e", [A.texture("G", step=5)],
                   [(A.PINE, (5, 13)), (A.PINE, (42, 11)), (A.PINE, (4, 36)), (A.PINE, (43, 37))]),
    "sawmill": (A.sawmill(), "e", [A.river(47, 44, width=5)],
                [(A.LOGS, (5, 19)), (A.LOGS, (7, 41)), (A.LOG, (42, 32)), (TUFT, (9, 30)), (FLOWER, (16, 19)), (A.STONE, (38, 44))]),
    "mine": (A.headframe(), "f", [A.texture("U", step=4), A.open_pit(center=(27, 12), rx=19, ry=10)],
             [(A.MINECART, (40, 20)), (A.RAILS, (46, 19)), (A.BOULDER, (5, 23)), (A.STONE, (8, 43)), (A.STONE, (43, 44))], (6, 8)),
    "graveyard": (A.graveyard(), "e", [A.texture("h", step=4)],
                  [(A.HEADSTONE, (7, 16)), (A.HEADSTONE, (43, 17)), (A.HEADSTONE, (5, 40)), (A.HEADSTONE, (45, 40)), (A.HEADSTONE, (11, 44))]),
    "ski-resort": (A.ski_resort(), "w", [A.texture("a", step=8),
                                         A.snow_hills([(12, 26, 12), (42, 30, 13), (24, 44, 11)]),
                                         A.cable(35, 7, 50, 30)],
                   [(A.SNOW_PINE, (5, 13)), (A.SNOW_PINE, (3, 34)), (A.SNOW_PINE, (45, 38))]),
    "fallout-bunker": (A.fallout_bunker(), "e", [A.texture("U", step=6)],
                       [(A.BARREL, (8, 19)), (A.BARREL, (12, 21)), (A.BARREL, (42, 21)), (A.FENCE, (4, 40)), (A.FENCE, (41, 41)),
                        (TUFT, (14, 30)), (TUFT, (38, 32)), (A.STONE, (13, 44))]),
    "occult-camp": (A.occult_camp(), "e", [A.texture("h", step=4)],
                    [(FLOWER, (8, 22)), (A.BOULDER, (44, 25)), (A.STONE, (7, 42)), (A.STONE, (44, 43))]),
    "shipping-docks": (A.shipping_docks(), "e", [A.texture("G", step=6), A.gravel(center=(24, 16), rx=20, ry=9),
                                                 A.edge_coast(["NE", "E", "SE"], sea=5, sand=7, wobble=1.2, seed=4)],
                       [(A.DOCK, (45, 24)), (A.BOLLARD, (40, 27)), (A.TYRE, (8, 22)), (TUFT, (9, 36)), (TUFT, (30, 42)), (FLOWER, (12, 44))]),
    "junkyard": (A.junkyard(), "f", [A.texture("U", step=4)],
                 [(A.TYRE_STACK, (10, 13)), (A.CRUSHED_CAR, (37, 15)), (A.BURNING_BARREL, (12, 14), "front"), (A.TYRE, (33, 18), "front"), (A.STONE, (8, 43)), (A.TYRE, (42, 43))]),
    "beach-city": (A.beach_city(), "e", [A.texture("G", step=6), A.edge_coast(["SE"], sea=8, sand=15, seed=3)],
                   [(A.PALM, (4, 15)), (A.PALM, (5, 34)), (A.UMBRELLA, (33, 37)), (A.UMBRELLA, (41, 31)), (A.TOWEL, (27, 44))]),
}


# Tiles whose landscape keeps the lighter night map, so detail survives the dark.
BRIGHT_NIGHT = {"mine", "junkyard"}


def _place(building):
    """Top middle, with the building's foot just above the pieces area."""
    w, h = len(building[0]), len(building)
    return ((HEX_W + 2 - w) // 2, max(2, 21 - h))


HEXES = {
    loc: hex_tile(building, at=(spec[4] if len(spec) > 4 else _place(building)), archetype=LOCATION_ARCHETYPE[loc],
                  ground={"top": top}, decor=decor, landscape=landscape, bright_night=loc in BRIGHT_NIGHT)
    for loc, spec in LOCATION_ART.items()
    for building, top, landscape, decor in [spec[:4]]
}

# Target states for board hexes (2026-10-06): a hex that can be chosen as a
# card's target is a *candidate*; the candidate under the pointer is
# *hovered*. Nothing is drawn outside the hex and the border never changes:
# the states are light. A candidate is caught in a spotlight (a crisp pool of
# the tile's true colours, the rest still night); hovered, the whole tile is
# in full daylight. The hovered tile also lifts, in CSS.
STATE_PAD = 0
HEX_STATES = {"candidate": "spotlight", "hover": "day"}
HEX_STATE_TILES = {
    state: {
        loc: hex_tile(building, at=(spec[4] if len(spec) > 4 else _place(building)), archetype=LOCATION_ARCHETYPE[loc],
                      ground={"top": top}, decor=decor, landscape=landscape, bright_night=loc in BRIGHT_NIGHT, light=light)
        for loc, spec in LOCATION_ART.items()
        for building, top, landscape, decor in [spec[:4]]
    }
    for state, light in HEX_STATES.items()
}


def hex_state(rows, state):
    """The state art for the hex whose normal art is `rows`."""
    loc = next(l for l, r in HEXES.items() if r == rows)
    return HEX_STATE_TILES[state][loc]


# Bare hexes in each archetype's scheme, for choosing the schemes.
HEX_SCHEMES = {arch: hex_tile(["."], at=(0, 0), archetype=arch) for arch in ARCHETYPE_BORDERS}

# Where the pieces go on every hex, in hex pixels: below the building.
HEX_PIECES = {"x": 4, "y": 22, "w": HEX_W + 2 - 8, "h": 24}


def hex_rgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def write_png(path, pixels, width, height):
    raw = b"".join(b"\x00" + bytes(c for px in row for c in px) for row in pixels)

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    open(path, "wb").write(png)


def check():
    for name, rows in {**SPRITES, **{f"header:{k}": v for k, v in HEADERS.items()}, **{f"hex:{k}": v for k, v in HEXES.items()}, **{f"scheme:{k}": v for k, v in HEX_SCHEMES.items()}, **{f"symbol:{k}": v for k, v in ARCHETYPE_SYMBOLS.items()}}.items():
        widths = {len(r) for r in rows}
        assert len(widths) == 1, (name, widths)
        for r in rows:
            for ch in r:
                assert ch in PALETTE, (name, ch)


def sheet(path, scale=8, gap=2):
    every = SPRITES
    names = list(every)
    bg = (60, 58, 80, 255)
    cell = 32
    width = (cell + gap) * len(names) + gap
    height = cell + 2 * gap
    canvas = [[bg] * width for _ in range(height)]
    for i, name in enumerate(names):
        rows = every[name]
        ox = gap + i * (cell + gap) + (cell - len(rows[0])) // 2
        oy = gap + (cell - len(rows)) // 2
        for y, row in enumerate(rows):
            for x, ch in enumerate(row):
                if PALETTE[ch]:
                    canvas[oy + y][ox + x] = hex_rgb(PALETTE[ch]) + (255,)
    big = [[px for px in row for _ in range(scale)] for row in canvas for _ in range(scale)]
    write_png(path, big, width * scale, height * scale)


def sprite_png(path, rows):
    pixels = [[hex_rgb(PALETTE[ch]) + (255,) if PALETTE[ch] else (0, 0, 0, 0) for ch in row] for row in rows]
    write_png(path, pixels, len(rows[0]), len(rows))


def build():
    check()
    public = ROOT / "public" / "assets"
    (public / "sprites").mkdir(parents=True, exist_ok=True)
    for stale in (public / "sprites").glob("*.png"):
        if stale.stem not in SPRITES:
            stale.unlink()
    for name, rows in SPRITES.items():
        sprite_png(public / "sprites" / f"{name}.png", rows)
    tokens = public / "tokens"
    tokens.mkdir(parents=True, exist_ok=True)
    for stale in tokens.iterdir():
        if stale.stem not in TOKEN_SOURCES or stale.suffix != ".svg":
            stale.unlink()
    for name in TOKEN_SOURCES:
        (tokens / f"{name}.svg").write_text(token_svg(SPRITES[name]))
    import board as BD
    coasts = {"lighthouse": ["E", "SE"], "shipping-docks": ["NE", "E", "SE"], "beach-city": ["SE"]}   # tile edges with coast, see LOCATION_ART
    board_rows, board_tiles = BD.build(ROOT, {loc: art[1] for loc, art in LOCATION_ART.items()}, coasts, night=night_landscape, darken=lambda ch: _shadow_of(ch) if PALETTE.get(ch) else ch)
    (public / "board").mkdir(parents=True, exist_ok=True)
    sprite_png(public / "board" / "d.png", board_rows)
    headers = public / "headers"
    headers.mkdir(parents=True, exist_ok=True)
    for stale in headers.glob("*.png"):
        if stale.stem not in HEADERS:
            stale.unlink()
    for name, rows in HEADERS.items():
        sprite_png(headers / f"{name}.png", rows)
    hexes = public / "hexes"
    hexes.mkdir(parents=True, exist_ok=True)
    keep = set(HEXES) | {f"scheme-{n}" for n in HEX_SCHEMES} | {f"{n}-{s}" for n in HEXES for s in HEX_STATES}
    for stale in hexes.glob("*.png"):
        if stale.stem not in keep:
            stale.unlink()
    for name, rows in HEXES.items():
        sprite_png(hexes / f"{name}.png", rows)
        for state in HEX_STATES:
            sprite_png(hexes / f"{name}-{state}.png", hex_state(rows, state))
    for name, rows in HEX_SCHEMES.items():
        sprite_png(hexes / f"scheme-{name}.png", rows)
    symbols = public / "symbols"
    symbols.mkdir(parents=True, exist_ok=True)
    for stale in symbols.glob("*.png"):
        stale.unlink()
    for name, rows in ARCHETYPE_SYMBOLS.items():
        sprite_png(symbols / f"{name}.png", rows)
    for folder in ("pixel-tokens", "pixel-cubes"):  # option B, retired 2026-10-03
        old = public / folder
        if old.exists():
            for stale in old.iterdir():
                stale.unlink()
            old.rmdir()

    def entries(group, folder):
        return {name: {"width": len(rows[0]), "height": len(rows), "src": f"/assets/{folder}/{name}.png", "rows": rows} for name, rows in group.items()}

    manifest = {
        "palette": PALETTE,
        "sprites": entries(SPRITES, "sprites"),
        "tokens": {
            name: {"pad": TOKEN_PAD, "width": len(SPRITES[name][0]) + 2 * TOKEN_PAD, "height": len(SPRITES[name]) + 2 * TOKEN_PAD, "src": f"/assets/tokens/{name}.svg", "art": f"/assets/sprites/{name}.png"}
            for name in TOKEN_SOURCES
        },
        "hexes": {name: {"width": len(rows[0]), "height": len(rows), "src": f"/assets/hexes/{name}.png", "pieces": HEX_PIECES,
                         "states": {state: {"src": f"/assets/hexes/{name}-{state}.png", "pad": STATE_PAD} for state in HEX_STATES}}
                  for name, rows in HEXES.items()},
        "symbols": {arch: {"width": len(rows[0]), "height": len(rows), "src": f"/assets/symbols/{arch}.png"} for arch, rows in ARCHETYPE_SYMBOLS.items()},
        "board": {"width": len(board_rows[0]), "height": len(board_rows), "src": "/assets/board/d.png", "tiles": board_tiles},
        "headers": {name: {"width": len(rows[0]), "height": len(rows), "src": f"/assets/headers/{name}.png"} for name, rows in HEADERS.items()},
        "hexSchemes": {name: {"width": len(rows[0]), "height": len(rows), "src": f"/assets/hexes/scheme-{name}.png"} for name, rows in HEX_SCHEMES.items()},
    }
    (public / "sprites.json").write_text(json.dumps(manifest, indent=1) + "\n")
    sheet(ROOT / "assets" / "sheet.png")
    print(f"ok: {len(SPRITES)} sprites, {len(TOKEN_SOURCES)} token outlines, {len(HEXES)} hexes -> public/assets/")


if __name__ == "__main__":
    build()
