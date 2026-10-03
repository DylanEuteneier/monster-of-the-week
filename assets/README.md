# Assets

How the pixel art for Monster of the Week is made, stored, and reviewed, and
what is still to decide before the full set is drawn.

**Status: on hold (2026-10-03).** A test batch exists. The fonts are chosen.
The full set waits on two decisions from the designer: the 16-colour palette
and the asset list (see [To decide](#to-decide)). Nothing beyond the test
batch is drawn until both are settled.

The art direction comes from the design document (`docs/motw-design.md`, 1.5
and 2.2): a small island town in a pixel-art RPG / animated-series style, in
the vein of EarthBound and Steven Universe.

## Layout

```
assets/                          source and review (not served)
  README.md                      this guide
  sprites.py                     the palette and every sprite as data; checks and builds
  sheet.png                      every sprite at 8x on one sheet, for review (generated)
  test/
    island-sprite-test.html      source of the sprite test page (artifact below)
    island-type-specimen.html    source of the font specimen page (artifact below)
public/assets/                   built output, served by Cloudflare as static files
  sprites.json                   palette + every sprite, token, and cube: size, src, pixel rows (generated)
  sprites/<id>.png               each sprite at 1x (generated)
  tokens/<id>.png                cardboard presence tokens, from the sprites (generated)
  cubes/seat-<n>.png             influence cubes, one per seat colour (generated)
public/assets.html, assets.js    the /assets page
```

`npm run assets` (`python3 assets/sprites.py`) checks every sprite and
rebuilds everything marked *generated*. Commit the generated files: Cloudflare
serves `public/` as it is, with no build step.

### How assets are served

- **Static files.** Everything in `public/` is uploaded with the Worker and
  served by Cloudflare directly, cached at the edge, without running the
  Worker. Sprites live at `/assets/sprites/<id>.png`, the manifest at
  `/assets/sprites.json`.
- **Ids match the content.** A sprite's id is the id of the content it
  draws in `public/spec.json` (`lighthouse`, `vampires`, `scifi`). A test
  fails if a sprite matches no content, its file is missing, or it uses a
  colour outside the palette.
- **In the table.** `app.js` imports `sprites.json` and renders a sprite as
  `<img class="sprite" src=… width=… height=…>` at a whole-number scale,
  falling back to text when a sprite isn't drawn yet. The `.sprite` class
  (in `app.css`) keeps pixels crisp.
- **The /assets page** (linked from `/host`) lists every piece of content
  with its sprite at 1x, 3x and 6x, marks what isn't drawn yet, and shows
  the palette. Use it to review a batch in the real UI.

## The test batch

- Five 16×16 archetype icons: bat (Nocturnals), UFO (80's Sci-Fi), robot
  (Sentients), skull (Undead), demon (Demons).
- One 32×32 location tile: The Lighthouse, at night.
- A draft 16-colour palette (below).
- Preview page: https://claude.ai/artifact/6hvwZPQpLtyVBHYswHMHEU (private to
  the designer). It shows each sprite at 1×, 3× and 6×, a mock
  factions-in-play panel, and the palette.
- The designer liked the test a lot.
- The same sprites are live on the `/assets` page and in the table's board
  panel.

![Test sheet](sheet.png)

## How assets are made

### Sprite format

Each sprite is a list of equal-length strings: one string per row, one
character per pixel. Each character is a palette key; `.` is transparent.

```python
"undead": [
    ".....kkkkkk.....",
    "....kwwwwwwk....",
    "...kwwwwwwwgk...",
    "...kwkkwwkkgk...",
    "...kwkGwwkGgk...",
    ...
]
```

This keeps the art small, readable in a diff, and editable by hand or by
Claude. Larger pieces (a 32×32 tile) can be drawn by a short function that
fills regions and then places detail pixels, as `lighthouse()` does.

### Rules

- **One 16-colour palette for everything.** Sprites, UI chrome, and the
  table's CSS colour tokens all come from it. No colour outside it.
- **Native sizes:** 16×16 for icons and tokens, 32×32 for location tiles.
  Bigger pieces only where the asset list says so.
- **Whole-number scaling only,** with `image-rendering: pixelated`. Never
  scale by fractions, and never smooth.
- **Outline in `k`** (the ink colour) so sprites read on any panel.
- **Light from the upper left;** shade the right edge one step darker.
- **Readable at 1×.** If a sprite doesn't read at native size, simplify it.

### Making a batch

1. Add or edit sprite data in `assets/sprites.py`, keyed by the content id.
2. Run `npm run assets`. It checks every sprite (equal row widths, only
   palette keys), writes the PNGs and `sprites.json` into `public/assets/`,
   and renders `assets/sheet.png`.
3. Look at `sheet.png` once, or open `/assets` on the dev server. Fix
   anything that reads badly at 1×.
4. Hand over the batch for review. Feedback comes per batch, not per sprite.

Work in batches (for example all 15 location tiles in one go): it keeps
reviews cheap and the style consistent.

### What to draw here, and what not to

- **Draw here:** icons and tokens at 16×16 to 32×32, simple location tiles,
  UI chrome (panel borders, buttons, card frames, dividers).
- **Needs an artist, or a generated image plus cleanup:** the island map as
  one illustration, expressive characters (slayer group portraits), heavy
  shading, and animation beyond two or three frames.

### Generated art

If an image model is used, its output goes through a cleanup step (script not
yet written): downscale to the real grid, snap every pixel to the palette,
export in the sprite format above, then touch up by hand in Aseprite or
LibreSprite.

Candidate free models (check what's current): FLUX.1 [schnell] (Apache 2.0,
allows commercial use) or SDXL with a pixel-art LoRA, run locally in Draw
Things. Avoid non-commercial licences such as FLUX.1 [dev]. Hosted tools made
for pixel art: PixelLab and Retro Diffusion.

## To decide

### 1. The palette

Sixteen colours, used for everything. The draft from the test batch:

| Key | Colour | Role in the test |
|---|---|---|
| `k` | `#1a1626` | outline, ink |
| `n` | `#26244a` | night sky |
| `N` | `#353268` | night sky, lighter band |
| `b` | `#2f5d8f` | sea |
| `c` | `#6fc3df` | glow cyan, wave crest |
| `w` | `#f4efe2` | bone, cream |
| `g` | `#9a9cb8` | metal grey |
| `d` | `#55536f` | shadow |
| `r` | `#c8364c` | red |
| `R` | `#7e1f3a` | dark red |
| `p` | `#f07ca0` | pink (unused so far) |
| `y` | `#f7e07a` | lamp yellow |
| `o` | `#f2a541` | orange (unused so far) |
| `G` | `#7bd389` | ghoul green |
| `m` | `#7a4ea3` | purple |

That is 15 colours plus transparent. The final palette has to answer:

- **Faction colours.** Five factions are in play each game, one per
  archetype. Each needs a cube colour that reads at a glance and stays
  distinct from the others. Is the colour tied to the archetype (five
  colours) or to each faction (fifteen, which can't fit in 16)?
- **Seat colours.** Three to five players each need a colour. Can they share
  colours with the factions, or must they be distinct? Ten distinct hues plus
  ink, paper, and shading won't fit in 16, so some sharing or a non-colour
  marker (shape, pattern) is likely.
- **UI.** The table needs a background, panel, text, muted text, border,
  accent, danger, and ok colour from the same palette. Is the UI dark (night
  island, like the test) or light?
- **Day and night.** Does any location or phase need a daytime look, or is
  the whole game set at night?
- **Starting point.** Hand-picked (like the draft), or an established
  16-colour pixel palette adapted to the theme?

### 2. The asset list

Candidates from content the design has already settled (2.5, 3.4). Rows
marked **Required** are confirmed by the designer; mark the rest keep, cut, or
later:

| Asset | Count | Size | Notes |
|---|---|---|---|
| **Faction presence sprites** (Required) | 15, or 5 | 8×8 to 12×12 | Small sprites showing each faction's presence at a location. See [Presence on locations](#presence-on-locations) |
| **Player influence cubes** (Required) | 1 per seat colour | 8×8 | Plain cubes in each player's seat colour. See [Presence on locations](#presence-on-locations) |
| **Location card layout** (Required) | 1 | — | Location tile plus its faction presence and player influence, readable at a glance |
| Archetype icons | 5 | 16×16 | Drafts exist |
| Faction icons | 15 | 16×16 | One per faction; variations on the archetype icon. Presence sprites can be small versions of these |
| Location tiles | 15 | 32×32 | Lighthouse drafted; three per archetype |
| Slayer group emblems | 5 | 16×16 | Simple emblems; full portraits need an artist |
| Slayer group portraits | 5 | 32×32+ | Artist, or generated plus cleanup |
| UI chrome | 1 set | 9-slice | Panel border, button, card frame, divider |
| Fonts | 2 | — | See [Fonts](#3-fonts) |
| Island map | 1 | large | Artist, or generated plus cleanup; waits on map design |

Assets that depend on rules not yet settled wait for them: action cards (card
design is deferred), trophies, hidden tokens, and anything the board topology
decides (connections, regions).

#### Presence on locations

Decided by the designer for the prototype (2026-10-03): every location shows
its presence visually, at a glance.

- **Faction presence as sprites.** Each faction's presence at a location is
  drawn with small faction sprites. In the rules, invaders are cubes at
  locations (3.4); the sprite is how the digital table draws those cubes. It
  does not change the rule.
- **Player influence as cubes,** in the player's seat colour. Influence
  placed at locations is still a candidate rule (CU4, 3.7; influence at
  locations, 3.13), so how the cubes are used follows whichever rule is
  settled; the art can be made ahead of it.
- **Shape separates the two:** sprites are factions, plain cubes are
  players. Seat colours can share hues with faction sprites without
  confusion.
- **Presence sprites look like cardboard tokens** (decided 2026-10-03): the
  pixel art printed on a cream die-cut face whose edge roughly follows the
  art, with the card's thickness showing as a dark edge below.
  `token()` in `sprites.py` generates one from any sprite; the test batch has
  one per archetype icon (`public/assets/tokens/`).
- **Influence cubes look a little 3D** (decided 2026-10-03): solid front in
  the seat colour, a lit top (seat colour dithered with cream), and the side
  in shadow grey, so every seat colour needs only one palette entry.
  `cube()` generates them; the seat colours are a draft
  (`SEAT_COLOURS`, `public/assets/cubes/`).

Open questions for the layout:

- **Counts.** One sprite per cube (a stack you count), or one sprite plus a
  number? Stacks read as "on the board" (1.4) but get crowded; a location may
  hold up to two factions (LL1, a candidate) and growth pushes counts up. The
  same question applies to influence cubes.
- **Presence sprites per faction or per archetype?** Fifteen (Vampires look
  unlike Werewolves), or five, one per archetype, since only one faction per
  archetype is ever in play (3.4)? Five is enough to tell them apart in a
  game; fifteen adds flavour. They can be small versions of the faction or
  archetype icons.
- **Seat colours.** Three to five, from the 16-colour palette (see
  [The palette](#1-the-palette)).
- **Size.** Location tiles are 32×32; sprites and cubes small enough that a
  full location stays readable at 2×.

### 3. Fonts (decided 2026-10-03)

- **Headings and labels: Tiny5.** A small, clean pixel face. One weight
  only, so headings are never bolded. Pixel faces are crisp only at certain
  sizes; check headings at 1× in the browser and adjust sizes, not weight.
- **Everything else: Rubik.** Slightly rounded, echoes the cartoon style,
  clear at 12px.

Both are Google Fonts, linked in the `<head>` of each page and set as the
`--font-display` and `--font-body` tokens in `public/app.css`. Specimen page
with the other candidates and a pairing mock-up:
https://claude.ai/artifact/1SqgAYUV1V5bxEaKh6Ni1e (source in
`test/island-type-specimen.html`).

## When resuming

1. Settle the palette questions and write the final palette into
   `public/spec.json` (or a sibling data file the engine and client both
   read).
2. Settle the asset list: keep, cut, or later for each row.
3. Fonts are set (Tiny5 and Rubik); keep new UI on the two tokens.
4. Draw in batches, one sheet render and one review per batch.
5. Wire the table's CSS colour tokens to the palette, and render sprites in
   the remaining panels (seats, log).
