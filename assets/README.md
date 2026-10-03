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
| 2026-10-03 | An all-pixel version of tokens and cubes was tried and retired (git: commit 2f41a8d) |

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
- Today one token exists per archetype icon; whether presence uses 15
  faction tokens or 5 archetype tokens is still open.

### Influence cubes

- Seen from above, never rotated: a square top face, the near side as a band
  below it, the right side as a narrower band.
- Every face is shaded from one seat colour with `color-mix()`, so each seat
  needs only one palette colour.
- Code: `cubeHtml(colour, size)` in `public/pieces.js`. Seat colours are a
  draft (`SEAT_COLOURS`) until the palette is set.

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
   Add the id to `TOKEN_SOURCES` if it should have a token.
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
| `o` | `#efa260` | apricot; draft seat 4 |
| `s` | `#f6cca1` |  |
| `l` | `#b6d43c` |  |
| `G` | `#71ab43` | ghoul green; draft seat 3 |
| `e` | `#387c44` |  |
| `h` | `#3c5957` |  |
| `k` | `#302b2d` | outline, ink |
| `x` | `#5a5454` |  |
| `X` | `#7d7071` |  |
| `g` | `#a0948f` | metal |
| `z` | `#cfc6b8` |  |
| `w` | `#e0f2f4` | highlights, bone |
| `a` | `#97d8e3` |  |
| `c` | `#3dc3d8` | glow, wave crest; draft seat 2 |
| `b` | `#3879a9` | sea |
| `N` | `#384779` | night sky, lighter band |
| `n` | `#39314b` | night sky |
| `v` | `#564164` |  |
| `m` | `#8f488d` | purple |
| `p` | `#ce5f93` | pink; draft seat 5 |
| `P` | `#f7acb6` |  |
| `y` | `#f4b41a` | lamplight |
| `O` | `#f47e20` |  |
| `r` | `#e7482d` | red; draft seat 1 |
| `R` | `#a93c3b` | dark red |
| `L` | `#837195` |  |
| `d` | `#4f546b` | shadow; token edge |

Still to decide:

- **Seat colours.** Which five palette colours mark the players' influence
  cubes. They must read at a glance on the location card and beside each
  other. Tokens are identified by their art, so seat colours may share hues
  with faction art.
- **UI colours.** Which palette colours serve as background, panel, text,
  muted text, border, accent, danger, and ok. Is the UI dark (night island,
  like the test art) or light (the current table)?
- **Token cardboard.** Should the token face and edge use palette colours
  (`w` or `z` for the face, `g` or `X` for the edge), or keep their own
  neutral tones?
- **Day and night.** Does any location or phase need a daytime look, or is
  the whole game at night?

### 2. The asset list

Mark each row keep, cut, or later. **Required** rows are confirmed.

| Asset | Count | Size | Notes |
|---|---|---|---|
| **Location tiles** (Required) | 15 | 32×32 | Lighthouse drafted; three per archetype |
| **Presence tokens** (Required) | 15 or 5 | from 16×16 art | Generated from faction or archetype icons; see open question below |
| **Influence cubes** (Required) | 5 | CSS | Built; need final seat colours |
| **Location card layout** (Required) | 1 | UI | Tile, presence, and influence at a glance; example on `/assets` |
| Archetype icons | 5 | 16×16 | Drafts exist |
| Faction icons | 15 | 16×16 | One per faction; variations on the archetype icon |
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
- **Tokens per faction or per archetype?** Fifteen (Vampires look unlike
  Werewolves), or five, since only one faction per archetype is in play
  each game (3.4)? Five is enough to tell them apart; fifteen adds flavour.
- **Influence at locations is a candidate rule** (CU4, 3.7; influence ties at
  a location, 3.13). The cubes are ready; how they're used follows whichever
  rule is settled.
- **Size.** The tile at 3× (96px) with tokens at 2× reads well; confirm once
  real counts are known.

## When resuming

1. Choose the palette roles (seat colours, UI colours, dark or light), then
   point the UI's CSS colour tokens and `SEAT_COLOURS` at those palette keys.
   The 32 colours themselves are already in `assets/sprites.py`.
2. Settle the asset list and the location-card questions.
3. Draw in batches: location tiles first (the board needs them), then faction
   or archetype token art, then emblems. One sheet render and one review per
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
