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
    ".": None,          # transparent
    "k": "#1a1626",     # outline, ink purple-black
    "n": "#26244a",     # night sky
    "N": "#353268",     # night sky, lighter band
    "b": "#2f5d8f",     # sea
    "c": "#6fc3df",     # glow cyan / wave crest
    "w": "#f4efe2",     # bone / cream
    "g": "#9a9cb8",     # metal grey
    "d": "#55536f",     # shadow grey-purple
    "r": "#c8364c",     # red
    "R": "#7e1f3a",     # dark red
    "p": "#f07ca0",     # pink
    "y": "#f7e07a",     # lamp yellow
    "o": "#f2a541",     # orange
    "G": "#7bd389",     # ghoul green
    "m": "#7a4ea3",     # purple
}

SPRITES = {
    "nocturnals": [
        "................",
        "................",
        "................",
        "......k..k......",
        "......kkkk......",
        ".....kmmmmk.....",
        "kk..kmymmymk..kk",
        "kmk.kmmmmmmk.kmk",
        "kmmkkmwmmwmkkmmk",
        "kmmmmmmmmmmmmmmk",
        "kmdmmmmmmmmmmdmk",
        ".kmdmmmmmmmmdmk.",
        ".kmmkkmmmmkkmmk.",
        "..kk..kmmk..kk..",
        "................",
        "................",
    ],
    "scifi": [
        "................",
        "................",
        "......kkkk......",
        ".....kccwck.....",
        "....kcGGGcck....",
        "....kcGkGcck....",
        "..kkkkkkkkkkkk..",
        ".kggggggggggggk.",
        "kgwgygwgygwgygwk",
        ".kddddddddddddk.",
        "..kkkkkkkkkkkk..",
        "......y..y......",
        ".....y.yy.y.....",
        "....y.y..y.y....",
        "...y..y..y..y...",
        "................",
    ],
    "sentients": [
        "................",
        "......kyyk......",
        ".......kk.......",
        ".......kk.......",
        "...kkkkkkkkkk...",
        "...kggggggggk...",
        "..kkgccggccgkk..",
        "..kkgccggccgkk..",
        "...kggggggggk...",
        "...kgkkkkkkgk...",
        "...kgkykykkgk...",
        "...kggggggggk...",
        "...kkkkkkkkkk...",
        "......kddk......",
        "....kkkkkkkk....",
        "................",
    ],
    "undead": [
        "................",
        "................",
        ".....kkkkkk.....",
        "....kwwwwwwk....",
        "...kwwwwwwwgk...",
        "...kwwwwwwwgk...",
        "...kwkkwwkkgk...",
        "...kwkGwwkGgk...",
        "...kwwwkkwwgk...",
        "....kwwwwwgk....",
        "....kwkwwkgk....",
        ".....kkkkkk.....",
        "................",
        "................",
        "................",
        "................",
    ],
    "demons": [
        "................",
        "..k..........k..",
        "..kk........kk..",
        "..kwk......kwk..",
        "...kwkkkkkkwk...",
        "...krrrrrrrrk...",
        "..krrrrrrrrrrk..",
        "..krrkyrrykrrk..",
        "..krrrrrrrrrRk..",
        "..krrkkkkkkrRk..",
        "..krrkwkkwkrRk..",
        "...krrrrrrRRk...",
        "....kRRRRRRk....",
        ".....kkkkkk.....",
        "................",
        "................",
    ],
}


def lighthouse():
    """32x32 location tile: The Lighthouse, at night, beam sweeping left."""
    W = H = 32
    g = [["n"] * W for _ in range(H)]
    for y in range(0, 9):
        for x in range(W):
            g[y][x] = "n"
    for y in range(9, 21):
        for x in range(W):
            g[y][x] = "N" if (y > 14 or (x + y) % 2 == 0 and y > 11) else "n"
    for x, y in [(3, 2), (11, 5), (27, 3), (22, 8), (6, 10), (29, 12), (15, 1)]:
        g[y][x] = "y" if (x + y) % 3 else "w"
    # sea
    for y in range(21, H):
        for x in range(W):
            g[y][x] = "b"
    for y, xs in [(22, range(1, 6)), (24, range(9, 14)), (23, range(24, 30)), (27, range(3, 8)), (29, range(14, 19)), (26, range(26, 31))]:
        for x in xs:
            g[y][x] = "c"
    # rocks
    rock = [
        (20, 15, 27), (21, 13, 29), (22, 12, 30), (23, 12, 31), (24, 13, 31), (25, 15, 30), (26, 18, 28),
    ]
    for y, x0, x1 in rock:
        for x in range(x0, x1):
            g[y][x] = "d"
        g[y][x0] = "k"
        g[y][x1 - 1] = "k"
    for x in range(15, 27):
        g[19][x] = "k"
    # tower: tapers from 8 wide at the base to 6 at the top, red and cream bands
    for y in range(9, 20):
        half = 3 if y < 14 else 4
        x0, x1 = 21 - half, 21 + half
        band = "r" if ((y - 9) // 3) % 2 == 0 else "w"
        for x in range(x0, x1):
            g[y][x] = band
        g[y][x1 - 1] = "R" if band == "r" else "g"  # shaded right edge
        g[y][x0 - 1] = "k"
        g[y][x1] = "k"
    g[17][20] = "k"  # door
    g[18][20] = "k"
    g[17][21] = "k"
    g[18][21] = "k"
    # gallery and lamp room
    for x in range(16, 27):
        g[8][x] = "k"
    for y in range(5, 8):
        g[y][17] = "k"
        g[y][25] = "k"
        for x in range(18, 25):
            g[y][x] = "y"
    g[6][21] = "w"
    for x in range(18, 25):
        g[4][x] = "k"
    for x in range(19, 24):
        g[3][x] = "R"
    g[2][21] = "k"
    # beam to the left, widening, dithered
    for x in range(0, 17):
        spread = (17 - x) // 4
        for y in range(6 - spread, 7 + spread):
            if 0 <= y < H and (x + y) % 2 == 0 and g[y][x] in ("n", "N"):
                g[y][x] = "y"
    return ["".join(row) for row in g]


SPRITES["lighthouse"] = lighthouse()


# ---------------------------------------------------------------------------
# Derived pieces: cardboard tokens (faction presence) and cubes (influence)
# ---------------------------------------------------------------------------

TOKEN_FACE = "w"      # the token's printed border, cream card
TOKEN_EDGE = "d"      # the cardboard's cut edge, seen below the face
TOKEN_THICKNESS = 2   # pixels of edge showing below the face
SEAT_COLOURS = ["r", "c", "G", "o", "p"]   # draft; final picks wait on the palette


def _dilate(mask, w, h, diagonal=True):
    out = set(mask)
    for x, y in mask:
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                if (dx or dy) and (diagonal or not (dx and dy)) and 0 <= x + dx < w and 0 <= y + dy < h:
                    out.add((x + dx, y + dy))
    return out


def _erode(mask, w, h):
    return {(x, y) for x, y in mask if all((x + dx, y + dy) in mask for dx in (-1, 0, 1) for dy in (-1, 0, 1) if 0 <= x + dx < w and 0 <= y + dy < h)}


def token(rows):
    """A die-cut cardboard token: the art on a cream face whose edge roughly
    follows the art's outline, with the card's thickness showing below."""
    pad = 3
    w, h = len(rows[0]) + 2 * pad, len(rows) + 2 * pad + TOKEN_THICKNESS
    art = {(x + pad, y + pad): ch for y, row in enumerate(rows) for x, ch in enumerate(row) if PALETTE[ch]}
    # Die-cut: grow the art by two, then close small notches so the cut is a
    # rough, smooth outline rather than a tracing of every pixel.
    cut = _dilate(_dilate(set(art), w, h), w, h, diagonal=False)
    cut = _erode(_dilate(cut, w, h), w, h)
    face = {(x, y) for x, y in cut if (x, y + 1) in cut or True}
    grid = [["."] * w for _ in range(h)]
    # Edge: the face shifted down, visible where the face isn't.
    edge = {(x, y + t) for x, y in face for t in range(1, TOKEN_THICKNESS + 1) if y + t < h} - face
    for x, y in edge:
        grid[y][x] = TOKEN_EDGE
    for x, y in face:
        grid[y][x] = TOKEN_FACE
    for (x, y), ch in art.items():
        grid[y][x] = ch
    # Ink outline around the whole piece, and a line where face meets edge.
    solid = face | edge
    for x, y in _dilate(solid, w, h, diagonal=False) - solid:
        grid[y][x] = "k"
    for x, y in edge:
        if (x, y - 1) in face:
            grid[y][x] = "k"
    return trim(["".join(r) for r in grid])


def trim(rows):
    """Drop fully transparent rows and columns around a sprite."""
    rows = [r for r in rows]
    while rows and set(rows[0]) == {"."}:
        rows.pop(0)
    while rows and set(rows[-1]) == {"."}:
        rows.pop()
    left = min(len(r) - len(r.lstrip(".")) for r in rows)
    right = min(len(r) - len(r.rstrip(".")) for r in rows)
    return [r[left:len(r) - right] for r in rows]


def cube(colour, size=7, depth=3):
    """A small oblique 3D cube: solid front in the seat colour, a lit top
    (seat colour dithered with cream), and the side in shadow grey."""
    w, h = size + depth + 2, size + depth + 2
    grid = [["."] * w for _ in range(h)]
    filled = {}
    for r in range(depth):                      # top face, leaning right
        for x in range(depth - r, depth - r + size):
            filled[(x + 1, r + 1)] = "w" if (x + r) % 2 == 0 else colour
    for y in range(depth, depth + size):         # front face
        for x in range(size):
            filled[(x + 1, y + 1)] = colour
    for c in range(depth):                      # right side face
        for y in range(depth - c, depth - c + size):
            if (size + c + 1, y + 1) not in filled:
                filled[(size + c + 1, y + 1)] = "d"
    for (x, y), ch in filled.items():
        grid[y][x] = ch
    for x, y in _dilate(set(filled), w, h, diagonal=False) - set(filled):
        grid[y][x] = "k"
    return ["".join(r) for r in grid]


TOKENS = {name: token(SPRITES[name]) for name in ("nocturnals", "scifi", "sentients", "undead", "demons")}
CUBES = {f"seat-{i + 1}": cube(colour) for i, colour in enumerate(SEAT_COLOURS)}


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
    for name, rows in {**SPRITES, **TOKENS, **CUBES}.items():
        widths = {len(r) for r in rows}
        assert len(widths) == 1, (name, widths)
        for r in rows:
            for ch in r:
                assert ch in PALETTE, (name, ch)


def sheet(path, scale=8, gap=2):
    every = {**SPRITES, **{f"token:{k}": v for k, v in TOKENS.items()}, **CUBES}
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
    for folder, group in (("tokens", TOKENS), ("cubes", CUBES)):
        (public / folder).mkdir(parents=True, exist_ok=True)
        for stale in (public / folder).glob("*.png"):
            if stale.stem not in group:
                stale.unlink()
        for name, rows in group.items():
            sprite_png(public / folder / f"{name}.png", rows)

    def entries(group, folder):
        return {name: {"width": len(rows[0]), "height": len(rows), "src": f"/assets/{folder}/{name}.png", "rows": rows} for name, rows in group.items()}

    manifest = {
        "palette": PALETTE,
        "sprites": entries(SPRITES, "sprites"),
        "tokens": entries(TOKENS, "tokens"),
        "cubes": entries(CUBES, "cubes"),
    }
    (public / "sprites.json").write_text(json.dumps(manifest, indent=1) + "\n")
    sheet(ROOT / "assets" / "sheet.png")
    print(f"ok: {len(SPRITES)} sprites, {len(TOKENS)} tokens, {len(CUBES)} cubes -> public/assets/")


if __name__ == "__main__":
    build()
