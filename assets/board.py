"""The prototype board's backdrop: one island drawn round the hex ring.

Land fills the space between and around the tiles, with each patch of land
taking the terrain of its nearest region (snow and peaks by the Mountains,
pine forest by the Woods, dirt and rocks by the Badlands, grass elsewhere).
The coast wobbles, sand runs along it, the sea surrounds it, and the gap in
the middle of the ring is a lake. Tiles are drawn on top by the page, at the
positions this module exports.
"""
import json
import math
import pathlib

from hexart import Canvas, PINE, SNOW_PINE, BOULDER, _noise, moonlight

TILE_W, TILE_H = 54, 62
STEP_X, STEP_Y = 53, 46
GUTTER = 2           # pixels each region is nudged outward, so regions read apart
MARGIN = 44          # sea and coast round the outermost tiles (room for the northern range)

REGION_TERRAIN = {
    "Mountains": {"ground": "w", "shade": "a", "shore": "X"},
    "Woods": {"ground": "e", "shade": "h", "shore": "s"},
    "Badlands": {"ground": "f", "shade": "U", "shore": "s"},
    "Coast": {"ground": "e", "shade": "G", "shore": "s"},
    "Old Town": {"ground": "e", "shade": "G", "shore": "s"},
}


def load_layout(root, name="D"):
    text = (root / "public" / "layout-suggestions.js").read_text()
    data = json.loads(text[text.index("= ") + 2:text.rindex(";")])
    return data[name]["hexes"]


def tile_positions(cells):
    """Pixel positions (top-left, 1x) for every tile, regions nudged apart."""
    base = [dict(c, x=STEP_X * (c["q"] + c["r"] / 2), y=STEP_Y * c["r"]) for c in cells]
    mx = sum(c["x"] for c in base) / len(base); my = sum(c["y"] for c in base) / len(base)
    shift = {}
    for region in {c["region"] for c in base}:
        own = [c for c in base if c["region"] == region]
        rx = sum(c["x"] for c in own) / len(own) - mx; ry = sum(c["y"] for c in own) / len(own) - my
        n = math.hypot(rx, ry) or 1
        shift[region] = (rx / n * GUTTER, ry / n * GUTTER)
    out = []
    for c in base:
        sx, sy = shift[c["region"]]
        out.append(dict(c, x=round(c["x"] + sx), y=round(c["y"] + sy)))
    minx = min(c["x"] for c in out); miny = min(c["y"] for c in out)
    for c in out:
        c["x"] += MARGIN - minx; c["y"] += MARGIN - miny
    return out


def _in_tile(x, y, t):
    """Inside the tile's hex (its face and outline)?"""
    lx, ly = x - t["x"] + 0.5, y - t["y"] + 0.5
    dx, dy = abs(lx - TILE_W / 2), abs(ly - TILE_H / 2)
    r = TILE_H / 2
    return dx <= TILE_W / 2 and dy <= r - dx / math.sqrt(3)


GROUND_TERRAIN = {
    "w": {"ground": "w", "shade": "a", "shore": "z"},    # snow
    "e": {"ground": "e", "shade": "G", "shore": "s"},    # grass
    "f": {"ground": "f", "shade": "U", "shore": "s"},    # dirt
    "g": {"ground": "g", "shade": "X", "shore": "s"},    # stone
    "s": {"ground": "s", "shade": "o", "shore": "s"},    # sand
}


EDGE_ANGLES = {"E": 0, "SE": 60, "SW": 120, "W": 180, "NW": 240, "NE": 300}


def backdrop(tiles, grounds, lake_centre, coasts=None, night=lambda ch: ch, darken=None):
    coasts = coasts or {}
    W = max(t["x"] for t in tiles) + TILE_W + MARGIN
    H = max(t["y"] for t in tiles) + TILE_H + MARGIN
    c = Canvas(W, H)
    centres = [(t["x"] + TILE_W / 2, t["y"] + TILE_H / 2, t) for t in tiles]
    lx, ly = lake_centre

    # The lake: the hole in the middle of the ring.
    def lake_dist(x, y):
        return math.hypot((x - lx) / 1.05, y - ly)

    owner = {}
    soft = {}
    land = set()
    for y in range(H):
        for x in range(W):
            dists = [math.hypot(p[0] - x, (p[1] - y) * 1.1) for p in centres]
            best = centres[dists.index(min(dists))]
            # a smooth union of the tiles, so the island is one blob, not circles
            K = 12.0
            d = -K * math.log(sum(math.exp(-di / K) for di in dists))
            wob = (7 * math.sin(x * 0.045 + y * 0.031) + 4.5 * math.sin(x * 0.11 - y * 0.087 + 1)
                   + 2.5 * math.sin(x * 0.27 + y * 0.21 + 2) + 1.5 * math.sin(x * 0.53 - y * 0.47)
                   + 2 * (_noise(x // 4, y // 4, 9) - 0.5))
            owner[(x, y)] = best[2]
            # beyond a tile's coastal edge the sea runs right up to the tile
            ang = math.degrees(math.atan2(y - best[1], x - best[0])) % 360
            coastal = any(min(abs(ang - EDGE_ANGLES[e]), 360 - abs(ang - EDGE_ANGLES[e])) <= 42 for e in coasts.get(best[2]["loc"], ()))
            inside = _in_tile(x, y, best[2])
            north = 20 if grounds.get(best[2]["loc"]) == "w" and y < best[1] - 8 else 0   # room for the range behind the snow tiles
            soft[(x, y)] = d - wob
            lake_wob = 3 * math.sin(x * 0.21 + y * 0.13) + 2 * math.sin(x * 0.47 - y * 0.39 + 1)
            if inside or (not coastal and d < TILE_H / 2 + 6 + north + wob and lake_dist(x, y) > 25 + lake_wob):
                land.add((x, y))

    water = lambda p: p not in land
    waves = set()
    for y in range(H):                                    # sea and lake
        for x in range(W):
            if (x, y) in land:
                continue
            in_lake = lake_dist(x, y) <= 34
            near = any(((x + dx, y + dy) in land) for dx, dy in ((2, 0), (-2, 0), (0, 2), (0, -2)))
            if near:
                c.px(x, y, "w")                            # surf along every shore, as on the tiles
            else:
                c.px(x, y, "N")                            # one sea colour, sea and lake alike
                # a faint wave motif: short, sparse dashes on a loose grid
                row, col = y // 9, (x + (y // 9) * 7) // 14
                wx = col * 14 - (y // 9) * 7 + 4 + int(_noise(col, row, 31) * 5)
                wy = row * 9 + 3 + int(_noise(col, row, 37) * 3)
                if _noise(col, row, 41) < 0.55 and (y == wy and wx <= x < wx + 3 or y == wy - 1 and x == wx + 3):
                    waves.add((x, y))
    for (x, y) in land:                                   # land, in the ground of the nearest tile
        t = GROUND_TERRAIN.get(grounds.get(owner[(x, y)]["loc"], "e"), GROUND_TERRAIN["e"])
        shore = any(water((x + dx, y + dy)) for dx in (-2, -1, 0, 1, 2) for dy in (-2, -1, 0, 1, 2))
        c.px(x, y, t["shore"] if shore else t["ground"])
        if not shore and _noise(x, y, 13) < 0.02:
            c.px(x, y, t["shade"])

    stamped = set()

    def stamp(sprite, x0, y0):
        for yy, row in enumerate(sprite):
            for xx, ch in enumerate(row):
                if ch != "." and (x0 + xx, y0 + yy) in land:
                    c.px(x0 + xx, y0 + yy, ch)
                    stamped.add((x0 + xx, y0 + yy))

    free = lambda x, y, w, h: all((x + i, y + j) in land and not any(_in_tile(x + i, y + j, t) for t in tiles)
                                  and not any(abs(x + i - xx) + abs(y + j - yy) < 0 for xx, yy in ())
                                  for i in range(0, w, 2) for j in range(0, h, 2))
    placed = []
    for y in range(0, H, 5):                              # scatter terrain features off the tiles
        for x in range(0, W, 5):
            if (x, y) not in land or any(_in_tile(x, y, t) for t in tiles):
                continue
            region = owner[(x, y)]["region"]
            snowy = grounds.get(owner[(x, y)]["loc"]) == "w"
            n = _noise(x, y, 21)
            if region == "Woods" and n < 0.55:
                sprite = PINE
            elif snowy and n < 0.18:
                sprite = SNOW_PINE
            elif region in ("Badlands",) and n < 0.12:
                sprite = BOULDER
            elif region in ("Coast", "Old Town", "Badlands") and grounds.get(owner[(x, y)]["loc"]) == "e" and n < 0.22:
                sprite = PINE
            else:
                continue
            w, h = len(sprite[0]), len(sprite)
            if free(x, y, w, h) and all(abs(x - px_) > 6 or abs(y - py_) > 7 for px_, py_ in placed):
                stamp(sprite, x, y)
                placed.append((x, y))

    # A mountain range across the snowy north: a darker back range behind a
    # lit front range, peaks of different heights, ragged snow, inked ridges.
    snow_tiles = [t for t in tiles if grounds.get(t["loc"]) == "w"]
    if snow_tiles:
        x0 = min(t["x"] for t in snow_tiles) - 20
        x1 = max(t["x"] for t in snow_tiles) + TILE_W + 20
        foot = min(t["y"] for t in snow_tiles) + 10
        def free_px(x, y):
            return (x, y) in land and not any(_in_tile(x, y, t) for t in tiles)
        for layer, (base, height, rock_lit, rock_dark, snow_lit, snow_dark, seed) in enumerate((
                (foot - 8, 40, "x", "d", "a", "g", 1.3),       # back range, in shadow
                (foot + 2, 30, "X", "x", "w", "a", 4.1))):     # front range, lit
            def ridge(x):
                t = x * 0.09
                h = (0.55 + 0.45 * math.sin(t + seed)) * 0.6 + 0.4 * abs(math.sin(t * 2.3 + seed * 2))
                h += 0.15 * math.sin(x * 0.7 + seed)
                return base - height * max(0.2, h)
            for x in range(x0, x1):
                top = ridge(x)
                slope_right = ridge(x + 1) > top                # facing away from the light
                for y in range(int(top), base + 1):
                    if not free_px(x, y):
                        continue
                    snowline = top + height * 0.35 + 2.5 * math.sin(x * 1.7 + seed) + 1.5 * math.sin(x * 0.6)
                    if y < snowline:
                        c.px(x, y, snow_dark if slope_right else snow_lit)
                    else:
                        c.px(x, y, rock_dark if slope_right else rock_lit)
                if free_px(x, int(top)):
                    c.px(x, int(top), "k")                     # inked ridgeline
                if free_px(x, int(top) + 1) and abs(ridge(x + 1) - top) > 1.5:
                    c.px(x, int(top) + 1, "k")
    for y in range(H):                                    # night falls on the island and the sea
        for x in range(W):
            c.g[y][x] = night(c.g[y][x])
    if darken:                                            # moonlight from the west
        moonlight(c.g, [(x, y) for y in range(H) for x in range(W)],
                  lambda x, y: 0 <= x < W and 0 <= y < H and (x, y) not in land, darken, stamped)
    for x, y in waves:                                    # waves catch a little moonlight
        if c.g[y][x] == night("N"):
            c.g[y][x] = "N"
    for x in range(W):                                    # the board's frame
        for y in range(H):
            edge = min(x, y, W - 1 - x, H - 1 - y)
            if edge == 0 or edge == 4:
                c.px(x, y, "k")
            elif edge < 4:
                c.px(x, y, "Q" if edge != 1 else "u")
    return c.rows()


def build(root, grounds, coasts=None, lake_axial=(2, 2), night=lambda ch: ch, darken=None):
    cells = load_layout(root)
    tiles = tile_positions(cells)
    # Where the lake's hex would sit, in the same frame as the tiles.
    raw = [(STEP_X * (c["q"] + c["r"] / 2), STEP_Y * c["r"]) for c in cells]
    ox, oy = MARGIN - min(x for x, _ in raw), MARGIN - min(y for _, y in raw)
    q, r = lake_axial
    lake_centre = (STEP_X * (q + r / 2) + ox + TILE_W / 2, STEP_Y * r + oy + TILE_H / 2)
    rows = backdrop(tiles, grounds, lake_centre, coasts, night, darken)
    return rows, [{"loc": t["loc"], "region": t["region"], "x": t["x"], "y": t["y"]} for t in tiles]
