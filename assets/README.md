# Assets

The art style for the Monster of the Week web prototype, how it is rendered,
how assets are made and served, and what is still to decide.

**Status (2026-10-03):** the art direction, fonts, and the look of tokens and
cubes are decided, and a test batch is live on `/assets`. Drawing the full set
waits on the **asset list**, and on which palette colours play which roles
(see [To decide](#to-decide)).

## The goal

A small island town in a pixel-art RPG / animated-series style, in the vein
of EarthBound and Steven Universe (design document 1.5, 2.2). The table should
feel like a real board game laid out on screen: readable at a glance, with the
board state carried by what's on it (1.4, "on the board, not in memory").

### The rule

**Whatever would be printed art in a physical production is pixel art.
Whatever would be physical is UI. A select few physical pieces imitate real
3D objects.** (Designer, 2026-10-03.)

| Tier | What | Rendered as |
|---|---|---|
| **Pixel art** | Illustrations, icons, location tiles, the art printed on a token or card | Pixel sprites, scaled by whole numbers, never smoothed |
| **UI** | Boards, panels, cards, tracks, buttons, frames: the physical parts of a production | Clean, readable HTML and CSS layout; not imitated, not pixel art |
| **Physical pieces** | Presence tokens, influence cubes (later, any other piece that sits on the board) | CSS objects with a realistic but clean look: depth, edges, soft shadows |

### Decisions so far

| Date | Decision |
|---|---|
| 2026-10-03 | The rule above |
| 2026-10-03 | One palette for the whole game and UI |
| 2026-10-03 | The palette's colours: 32, supplied by the designer (see [The palette](#1-the-palette)) |
| 2026-10-03 | Fonts: **Tiny5** (pixel) for headings and labels, **Rubik** for everything else |
| 2026-10-03 | Every location shows its presence visually, at a glance |
| 2026-10-03 | Faction presence is shown with **tokens**; player influence with **cubes** in seat colours |
| 2026-10-03 | Tokens are CSS cardboard cut to the art's outline, with pixel art on the face |
| 2026-10-03 | Cubes are seen from above, never rotated: top face, near side, and right side |
| 2026-10-03 | Presence tokens are per faction: 15, one for each faction's icon |
| 2026-10-03 | Archetype symbols are pixel art: moon and star (Nocturnals), alien head (80's Sci-Fi), power (Sentients), skull (Undead), horns (Demons). The font characters ◐ ↂ ⏏ ☾ ⎈ stay only as text shorthand |
| 2026-10-03 | Board hexes: flat, no cliffs; a bevelled border in the archetype's colours; the building top middle, the archetype symbol bottom middle over the border, and the space between kept clear for 1× tokens and cubes |
| 2026-10-03 | Prototype board (testing only, not a design decision): layout D, five regions of three in a ring round a central lake; data in `public/layout-suggestions.js` |
| 2026-10-03 | Slayer group art: 16×16 emblems and 160×64 mood banners with no people (stake through a heart, walkie-talkie, CRT, chainsaw, cross) |
| 2026-10-03 | An all-pixel version of tokens and cubes was tried and retired (git: commit 2f41a8d) |
| 2026-10-04 | Prototype board art (testing only): one island drawn round the hexes (`assets/board.py`), boxed in a framed rectangle of sea; a mountain range in the north, forest and fields, a lake in the ring's gap; water is one colour with a faint wave motif |
| 2026-10-04 | The prototype board is at night (`NIGHT_MODE` in `assets/sprites.py`) so the pieces stand out: landscape darkened most, buildings one step, archetype borders and symbols unchanged; every location has a light (bright core, no glow); moonlight from the west lights west-facing shores, sprites' west edges, and casts shadows east, each shadow about a fifth darker than its ground |
| 2026-10-06 | Target states for choosing a card's target: normal, candidate (spotlight) and hovered (full daylight, lifted). Nothing is drawn outside a hex or token. Hexes get pixel variants (`hexes/<location>-candidate.png`, `-hover.png`) made of light alone, with the border unchanged: a candidate is caught in a spotlight (a crisp pool of its daytime colours), and hovered it is in full daylight and lifts. Tokens get CSS states (`.is-candidate`, `.is-hovered`): a gold tint on the face, deeper when hovered, and a lift. Colours are palette `y`, `w` and `k`. Shown on `/assets` |

## How it renders in the prototype

### Pixel sprites

- Drawn at native size (16×16 icons, 32×32 location tiles) and shown at a
  whole-number scale with `<img class="sprite">`. The `.sprite` class sets
  `image-rendering: pixelated` so pixels stay crisp.
- Every sprite id is the id of the content it draws in `public/spec.json`
  (`lighthouse`, `vampires`, `scifi`).
- Where a sprite isn't drawn yet, the table falls back to text (the
  archetype symbol and name).

### Presence tokens

A die-cut cardboard token with the faction's art printed on it.

- **Outline:** generated per sprite as an SVG (`token_svg()` in
  `assets/sprites.py`): the art's silhouette grown by a couple of pixels and
  smoothed, so the cut follows the art without tracing every pixel.
- **Card:** CSS. A cream face masked to that outline, a cardboard edge built
  from stacked shadows, and a soft drop shadow. Only the art on the face is
  pixel art.
- **Stacks:** several tokens overlap like a real pile (`.token-stack`).
- Code: `tokenHtml(id, scale)` in `public/pieces.js`; styles under "Pieces
  on the board" in `public/app.css`.
- One token per faction (15), generated from each faction's icon. Every
  faction in `spec.json` that has a sprite gets a token automatically.

### Influence cubes

- Seen from above, never rotated: a square top face, the near side as a band
  below it, the right side as a narrower band.
- Every face is shaded from one seat colour with `color-mix()`, so each seat
  needs only one palette colour.
- Code: `cubeHtml(colour, size)` in `public/pieces.js`. Seat colours
  (`SEAT_COLOURS`) are the palette's most vivid hues: red, gold, cyan, lime,
  pink. The table's seat colours use the same five.

### Type

- **Tiny5** for headings and labels. One weight only, so headings are never
  bolded. Pixel faces are crisp only at certain sizes: adjust size, never
  weight.
- **Rubik** for body text, controls, and small print; clear at 12px.
- Both come from Google Fonts, linked in each page's `<head>`, and are set
  once as `--font-display` and `--font-body` in `public/app.css`.

### Colour

- **Pixel art uses only the palette.** No colour outside it, enforced by a
  test.
- **UI and pieces take their base colours from the palette.** CSS may derive
  shades from a palette colour (the cube faces, hover states) but never adds
  a new hue.
- The token's cardboard (cream face, tan edge) currently uses its own
  neutral tones; whether those must be palette colours is an
  [open question](#1-the-palette).

## Files and serving

```
assets/                          source and review (not served)
  README.md                      this guide
  sprites.py                     palette, sprite data, token outlines; checks and builds
  sheet.png                      every sprite at 8x on one sheet, for review (generated)
  test/
    island-sprite-test.html      source of the first sprite test page
    island-type-specimen.html    source of the font specimen page
public/assets/                   built output, served by Cloudflare as static files
  sprites.json                   palette, sprites, and token metadata (generated)
  sprites/<id>.png               each sprite at 1x (generated)
  tokens/<id>.svg                die-cut outline for each token (generated)
public/pieces.js                 tokens and cubes as HTML, for the table and /assets
public/assets.html, assets.js    the /assets page
```

- `npm run assets` (`python3 assets/sprites.py`) checks every sprite and
  rebuilds everything marked *generated*. **Commit the generated files:**
  Cloudflare serves `public/` as it is, with no build step.
- Everything in `public/` is uploaded with the Worker and served by
  Cloudflare directly, cached at the edge.
- `test/assets.test.js` fails if a sprite or token matches no content id, a
  file it points to is missing, or a sprite uses a colour outside the
  palette.
- **The `/assets` page** (linked from `/host`) is where art is reviewed in the
  real UI: an example location card with tokens and cubes, every token and
  cube, every piece of content with its sprite (or "not drawn yet"), and the
  palette.

## Making pixel art

### Sprite format

Each sprite is a list of equal-length strings: one string per row, one
character per pixel, each character a palette key (`.` is transparent).

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

Small, readable in a diff, and editable by hand or by Claude. Larger pieces
(a 32×32 tile) can be drawn by a short function that fills regions and then
places detail pixels, as `lighthouse()` does.

### Rules

- **Palette only;** 32 colours, no exceptions.
- **Native sizes:** 16×16 for icons (and so for token art), 32×32 for
  location tiles. Bigger only where the asset list says so.
- **Whole-number scaling only.** Never fractional, never smoothed.
- **Outline in `k`** (the ink colour) so sprites read on any panel.
- **Light from the upper left;** shade the right edge one step darker.
- **Readable at 1×.** If a sprite doesn't read at native size, simplify it.

### Making a batch

1. Add or edit sprite data in `assets/sprites.py`, keyed by the content id.
   Faction sprites get a token automatically.
2. Run `npm run assets`.
3. Review once: `assets/sheet.png`, or `/assets` on the dev server. Fix
   anything that reads badly at 1×.
4. Hand over the batch for review. Feedback comes per batch, not per sprite.

Batches (for example all 15 location tiles at once) keep reviews cheap and
the style consistent.

### Who draws what

- **Claude, as sprite data:** icons and token art at 16×16, simple location
  tiles at 32×32.
- **An artist, or a generated image plus cleanup:** the island map as one
  illustration, expressive characters (slayer group portraits), heavy
  shading, animation beyond two or three frames.
- **Not pixel art at all:** panels, buttons, frames, tracks. Those are UI
  (see [The rule](#the-rule)).

### Generated art

Image-model output goes through a cleanup step (script not yet written):
downscale to the real grid, snap every pixel to the palette, export in the
sprite format, then touch up by hand in Aseprite or LibreSprite.

Candidate free models (check what's current): FLUX.1 [schnell] (Apache 2.0,
allows commercial use) or SDXL with a pixel-art LoRA, run locally in Draw
Things. Avoid non-commercial licences such as FLUX.1 [dev]. Hosted tools made
for pixel art: PixelLab and Retro Diffusion.

## To decide

### 1. The palette

**The colours are chosen (2026-10-03):** 32, in the order the designer
supplied them. Keys the test art already used kept their role; the rest are
new. The roles column shows what the test art uses each for.

| Key | Colour | Used for in the test art |
|---|---|---|
| `q` | `#462d3c` |  |
| `Q` | `#5e3643` |  |
| `u` | `#7a444a` |  |
| `U` | `#a05b54` |  |
| `f` | `#c07959` |  |
| `o` | `#efa260` | apricot |
| `s` | `#f6cca1` |  |
| `l` | `#b6d43c` | seat 4 |
| `G` | `#71ab43` | ghoul green |
| `e` | `#387c44` |  |
| `h` | `#3c5957` |  |
| `k` | `#302b2d` | outline, ink |
| `x` | `#5a5454` |  |
| `X` | `#7d7071` |  |
| `g` | `#a0948f` | metal |
| `z` | `#cfc6b8` |  |
| `w` | `#e0f2f4` | highlights, bone |
| `a` | `#97d8e3` |  |
| `c` | `#3dc3d8` | glow, wave crest; seat 3 |
| `b` | `#3879a9` | sea |
| `N` | `#384779` | night sky, lighter band |
| `n` | `#39314b` | night sky |
| `v` | `#564164` |  |
| `m` | `#8f488d` | purple |
| `p` | `#ce5f93` | pink; seat 5 |
| `P` | `#f7acb6` |  |
| `y` | `#f4b41a` | lamplight; seat 2 |
| `O` | `#f47e20` |  |
| `r` | `#e7482d` | red; seat 1 |
| `R` | `#a93c3b` | dark red |
| `L` | `#837195` |  |
| `d` | `#4f546b` | shadow; token edge |

Still to decide:

- **UI colours.** Which palette colours serve as background, panel, text,
  muted text, border, accent, danger, and ok. Is the UI dark (night island,
  like the test art) or light (the current table)?
- **Token cardboard.** Should the token face and edge use palette colours
  (`w` or `z` for the face, `g` or `X` for the edge), or keep their own
  neutral tones?
- **Day and night.** The prototype board is at night for now (see
  decisions). Does any location or phase need a daytime look?

### 2. The asset list

Mark each row keep, cut, or later. **Required** rows are confirmed.

| Asset | Count | Size | Notes |
|---|---|---|---|
| **Location tiles** (Required) | 15 | 32×32 | Lighthouse drafted; three per archetype |
| **Presence tokens** (Required) | 15 | from 16×16 art | **Built**, one per faction, generated from the faction icons |
| **Influence cubes** (Required) | 5 | CSS | Built; need final seat colours |
| **Location card layout** (Required) | 1 | UI | Tile, presence, and influence at a glance; example on `/assets` |
| **Archetype symbols** (Required) | 5 | 9×9 plaque | **Done**: moon and star, alien head, power, skull, horns |
| **Board hexes** (Required) | 15 | 54×62 | Format set; the Lighthouse is drawn as the sample |
| **Faction icons** (Required) | 15 | 16×16 | **Drawn** (first pass, 2026-10-03) |
| Slayer group emblems | 5 | 16×16 | Simple emblems |
| Slayer group portraits | 5 | 32×32+ | Artist, or generated plus cleanup |
| Island map | 1 | large | Artist, or generated plus cleanup; waits on map design |

Assets that depend on rules not yet settled wait for them: action cards (card
design is deferred), trophies, hidden tokens, and anything the board topology
decides (connections, regions).

### 3. The location card

The example on `/assets` shows The Lighthouse with stacks of tokens and a row
of cubes. Open:

- **Counts.** One token or cube per unit (a pile you count, as now), or one
  with a number beside it? Piles read as "on the board" (1.4) but get
  crowded; a location may hold up to two factions (LL1, a candidate) and
  growth pushes counts up.
- **Influence at locations is a candidate rule** (CU4, 3.7; influence ties at
  a location, 3.13). The cubes are ready; how they're used follows whichever
  rule is settled.
- **Size.** The tile at 3× (96px) with tokens at 2× reads well; confirm once
  real counts are known.

## When resuming

1. Choose the UI palette roles (background, panel, text, accent; dark or
   light) and point the UI's CSS colour tokens at those palette keys.
   The 32 colours themselves are already in `assets/sprites.py`.
2. Settle the asset list and the location-card questions.
3. Draw in batches: location tiles next (the board needs them), then
   emblems. Faction icons and their tokens are done. One sheet render and one review per
   batch.
4. Render tokens, cubes, and tiles in the table once the engine tracks
   presence and influence.

## Preview pages

- First sprite test (archetype icons, Lighthouse tile, draft palette):
  https://claude.ai/artifact/6hvwZPQpLtyVBHYswHMHEU
- Font specimen and pairing mock-up:
  https://claude.ai/artifact/1SqgAYUV1V5bxEaKh6Ni1e

Both are private to the designer; their sources are in `test/`. The live
`/assets` page supersedes them for tokens, cubes, and the location card.

![Sprite sheet](sheet.png)
