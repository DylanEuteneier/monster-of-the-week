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


TOKEN_SOURCES = ("nocturnals", "scifi", "sentients", "undead", "demons")


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
    for name, rows in SPRITES.items():
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
    }
    (public / "sprites.json").write_text(json.dumps(manifest, indent=1) + "\n")
    sheet(ROOT / "assets" / "sheet.png")
    print(f"ok: {len(SPRITES)} sprites, {len(TOKEN_SOURCES)} token outlines -> public/assets/")


if __name__ == "__main__":
    build()
