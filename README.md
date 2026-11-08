# Monster of the Week — prototype

A shared-board area-control game: slayer groups on a small island town push invading factions into each other,
playing for trophies and for standing with whichever faction wins. This repo is the design and its web prototype:
a pure rules engine and bots (Rust, run as WebAssembly), a Cloudflare Worker with one Durable Object as the
authority, a no-build-step browser table playable by 3–5 people on their own devices, and the tools that measure
the game with bots.

Live: https://monster-of-the-week.dylaneuteneier.workers.dev (tutorial at `/tutorial`, art and card review at
`/assets`).

## Where things are decided

| Document | What it covers |
|---|---|
| [`docs/motw-design.md`](docs/motw-design.md) | **The master design document**, the source of truth: context and working style (1), game foundation (2), every design decision area (3), decision records and changelog (A), glossary (B), reference research (C–E), prototype architecture and art (F), the first draft ruleset (G) |
| [`CLAUDE.md`](CLAUDE.md) | How the designer and Claude work: seeds come from the designer, decisions are recorded only when agreed, the code follows the document |
| [`public/spec.json`](public/spec.json) | All content and numbers as data: seats, archetypes, factions, locations, slayer groups, cards, rule variants |
| [`assets/README.md`](assets/README.md) | Art: the art rule, palette, how sprites, tokens and cubes render |
| [`scripts/measure/README.md`](scripts/measure/README.md) | Measuring the game, the cards and the bots with bot games: the baseline, the reports, how to read and trust them |

The code follows the design document; where they disagree, the document wins. Prototype choices (art, board
layout, palette, table talk) are for testing only, never rules.

## Layout

```
docs/motw-design.md      the design document
rust/                    the rules engine and the bots: the only place rules live
  src/lib.rs               module map; types.rs (state, moves), setup.rs (deal), game.rs (moves, fights, ending),
                           cards.rs (targets, actions), board.rs, choice.rs (targets step by step), view.rs and
                           why.rs (for the table), bots.rs (profiles, search, play-outs), judge.rs (learned
                           position judge, off by default), spec.rs, json.rs, small.rs
  src/wasm.rs              the JavaScript bridge (public/rules.js calls it)
  src/tournament.rs        whole bot games natively, with the logs the measuring tool reads
  src/fingerprint.rs       play fingerprints: bot games hashed state by state
  src/bin/motw.rs          the native tool: motw tournament, fingerprint, time, fit
  tests/                   engine, bot and runner tests; fingerprints.rs replays tests/fixtures
  data/judge.json          the learned judge's weights (npm run judge)
public/                  the browser table and the WebAssembly build (static files the Worker serves)
  rules.js, motw.wasm      the engine and bots for JavaScript (motw.wasm is built by npm run wasm and committed)
  spec.json                content and numbers
  index.html, app.js       the table: renders one player's view, sends moves, previews with the engine
  app.css                  styles (tokens at the top; one block per component)
  cards.js, icons.js       a card as the table draws it; action icons (verb + noun blocks)
  pieces.js, motion.js, fx.js   tokens and cubes as CSS pieces; moving pieces; small effects
  guide.js, hints.js       telling other seats' turns; move hints
  tutorial.js, tutorial-game.js the guided tutorial and its in-browser game
  host.html, host.js       the host page: deal games, choose variants and bots, copy links
  assets.html, assets.js   art and card review
  layout-suggestions.js    the board layout under test (prototype)
  assets/                  built art (from assets/sprites.py; don't edit by hand)
src/worker.ts            routing and the Game Durable Object (tokens, websockets, persistence)
scripts/
  measure.js, measure/     the measuring tool: bot games, the baseline, game, card and bot reports
  judge.js                 fits the learned judge's weights from bot games
  smoke.js                 a whole game through a running server over websockets
  watch-play.mjs           plays a table in headless Chrome and reports stalls
  tutorial-seed.js         finds a deal for the tutorial
  admin.js                 create a game, list magic links
test/                    JavaScript tests: bots and the bridge, rendering, assets, the tutorial
assets/                  art sources: sprites.py (palette, sprites; npm run assets), board.py, hexart.py, slayers.py
reports/, research_notes/  research reports and their notes (reference reading, not decisions)
```

## Local development

Needs Node 22+ (`.nvmrc` pins 24, matching CI) and Rust with the WebAssembly target
(`rustup target add wasm32-unknown-unknown`).

```sh
npm install
npm run dev:setup        # creates .dev.vars from the example (never commit .dev.vars)
npm run dev              # wrangler dev on http://localhost:8788
```

The dev server uses port **8788** and inspector port **9230**, so it runs alongside other prototypes on 8787/9229.

- **http://localhost:8788/host**: name the seats, tick bots, choose variants, deal. Seats keep their links across
  games. `npm run new-game -- Ann Bob Cat` and `npm run links` do the same from the command line.
- **http://localhost:8788/hotseat**: every human seat from one tab.
- **http://localhost:8788/tutorial**: the guided first game.
- **http://localhost:8788/assets**: every sprite, token, cube and card, and the palette.

## Commands

| Command | Does |
|---|---|
| `npm run dev` | Worker, Durable Object and static files on :8788 with live reload |
| `npm run check` | Everything before a commit: wasm, typecheck, JavaScript and Rust tests, a dry-run bundle |
| `npm run wasm` | Build the Rust engine to `public/motw.wasm` (commit it with the Rust change) |
| `npm test` / `npm run test:watch` | JavaScript tests (`node --test`) |
| `npm run test:rust` | Engine, bot and runner tests, and the play fingerprints (`cargo test`) |
| `npm run typecheck` | Strict TypeScript over the client, scripts, rules module and worker |
| `npm run measure -- …` | The measuring tool (`scripts/measure/README.md`); `baseline=1` rebuilds the baseline |
| `npm run judge` | Refit the learned judge's weights |
| `npm run assets` | Check every sprite and rebuild `public/assets/` (Python 3) |
| `npm run smoke` | A whole game through a running server (needs `npm run dev`) |
| `npm run new-game -- [names…]` / `npm run links` | Deal a game and print the magic links / print them again (`--seed N`, `--option id=choice`, `--bots A,B`) |
| `npm run build` | Dry-run bundle of the worker into `dist/` |
| `npm run deploy` / `npm run logs` / `npm run secret` | Deploy by hand / tail production logs / lock the host page with `ADMIN_SECRET` |

`BASE=https://your-worker.example npm run links` points the admin script at a deployed instance.

**Play fingerprints.** `rust/tests/fixtures/fingerprints.json` records how the bots play on fixed seeds. A change
that changes play fails `npm run test:rust`; regenerate them (`motw fingerprint … digests=1`) only when a decision
means play to change.

## How it works

- **One engine everywhere.** The Rust engine is built to WebAssembly and loaded by the Durable Object (the authority)
  and by the browser (previews of its own view only; it never decides anything). The measuring tool runs it natively.
- **One game, one Durable Object** named `the-game`. It is single-threaded, so simultaneous commits cannot race.
  State is saved after every accepted move and before any broadcast.
- **Hidden information stays server-side.** Each websocket receives only its own `playerView`.
- **Magic links** `/p/<token>` map to seats; the link is the identity. Host routes (`/host`, `/hotseat`, `/admin/*`)
  are open unless `ADMIN_SECRET` is set.
- **Variants.** Candidate rules the host can switch between live in `spec.variants`; the host page builds its
  pickers from that list and the engine validates the choices.
- **Bots** play from the same engine: one bot with dials, its lean spread over the table. They are the players in
  every measurement.
- **Art.** What would be printed is pixel art; what would be physical is UI; tokens and cubes are CSS pieces. Fonts:
  Tiny5 for headings, Rubik for text.

## Deploy

Every push to `main` builds and deploys through Cloudflare Workers Builds (the GitHub repo connected in the
Cloudflare dashboard; deploy command `npx wrangler deploy`). CI (`.github/workflows/ci.yml`) builds the WebAssembly
and runs the typecheck, the JavaScript and Rust tests and a dry-run bundle on every push and pull request.
`npm run deploy` from a machine logged in with `wrangler login` also works. The `[[migrations]]` block in
`wrangler.toml` registers the Durable Object class on first deploy.
