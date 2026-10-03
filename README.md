# Monster of the Week — prototype

A shared-board area-control game: slayer groups on a small island town push
invading factions into each other, playing for trophies and for standing with
whichever faction wins. This repo is the web prototype: a pure game engine, a
Cloudflare Worker with one Durable Object as the authority, and a
no-build-step browser table, playable remotely by 3–5 people on their own
devices.

The design document is the source of truth for what the game is. The code
follows it; where they disagree, the design document wins.

| Document | What it covers |
|---|---|
| [`docs/motw-design.md`](docs/motw-design.md) | Master design document: pillars, content, every decision area, reference research, candidate analysis, and the prototype architecture (Appendix F) |
| [`assets/README.md`](assets/README.md) | Art style and rendering for the prototype: the art rule, decisions so far, how sprites, tokens, and cubes render, and the open palette and asset-list decisions |
| [`public/spec.json`](public/spec.json) | The data: seat limits, archetypes, factions, locations, slayer groups, cards, variants |

`docs/motw-design.md` is a snapshot of the living design document (a Claude
artifact, updated at the end of each design session). Refresh the snapshot
when the design moves.

## Status: scaffold

The infrastructure from Appendix F is in place and tested end to end. The
rules are not: the design has no complete ruleset yet (Appendix F.16). Until
it does, the engine runs one placeholder phase, a **ready check** in which
every seat commits and the round advances, for two rounds. It exists only to
exercise simultaneous commits, rounds, the log, bots, hotseat, and per-seat
views. Everything marked *scaffold* is replaced when the real phases land.

What the engine already does from settled decisions:

- 3–5 seats (D3, 3.16).
- One faction picked at random from each archetype at setup (3.4), from a
  seeded, repeatable generator.
- Each seat receives only its own `playerView` (hidden hands, D6, slot in
  under `me`).

## Layout

```
public/
  index.html      the table (markup)
  app.css         styles (design tokens at the top)
  app.js          client: renders one playerView, sends moves, previews with the engine
  host.html/js    host page: deal games, choose options and bots, copy links
  assets.html/js  assets page: example location card, tokens, cubes, every sprite, the palette
  pieces.js       presence tokens and influence cubes as HTML (CSS pieces)
  assets/         built art: sprites.json, sprite PNGs, token outlines (SVG); static files
  bots.js         random legal-move bots, shared by the server and the harness
  engine.js       pure game logic — createGame, validate, applyMove, resolve, playerView
  spec.json       all constants and content as data
src/
  worker.ts       routing + the Game Durable Object (tokens, websockets, persistence)
test/
  engine.test.js      data, setup, validation, phases, visibility
  bots.test.js        bots only propose legal moves and finish games
  app.render.test.js  headless render of every phase
scripts/
  simulate.js     random-bot harness for summary figures
  smoke.js        end-to-end run against a live server
  admin.js        create a game / list magic links
docs/
  motw-design.md  the design document
assets/
  README.md       asset creation guide and plan
  sprites.py      palette, sprite data, token outlines; `npm run assets` builds public/assets/
  test/           preview pages for the sprite test and the font specimen
```

The engine is plain JavaScript with JSDoc types, checked under TypeScript
strict mode (`checkJs`). Both the Durable Object and the browser import the
same module; the client only uses it for previews and never decides anything.

## Local development

Needs Node 22+ (`.nvmrc` pins 24, matching CI).

```sh
npm install
npm run dev:setup        # creates .dev.vars from the example (never commit .dev.vars)
npm run dev              # wrangler dev on http://localhost:8788
```

The dev server uses port **8788** and inspector port **9230**, so it runs
alongside the Insider Trading prototype (8787 / 9229).

In a second terminal:

```sh
npm run new-game -- Ann Bob Cat Dan Eve     # deals a game, prints the magic links
npm run links                               # prints them again later
```

Or open **http://localhost:8788/host**, name the seats, tick bots, and deal.
**http://localhost:8788/assets** is where art is reviewed: an example location card, every token and cube, every sprite, and the palette.
Seats keep their links across games, so redealing flips every open tab to
round 1 without new links.

### Testing alone

- **Hotseat** — **http://localhost:8788/hotseat** plays every human seat from
  one tab; "follow the action" jumps to whoever needs to act.
- **Bots** — tick **bot** on the host page, or
  `npm run new-game -- --bots Bob,Cat,Dan,Eve Ann Bob Cat Dan Eve`.

## Commands

| Command | Does |
|---|---|
| `npm run dev` | Worker, Durable Object, and static assets on :8788 with live reload |
| `npm run new-game -- [names…]` | Create a game (3–5 names; default five seats) and print links. Flags: `--seed N`, `--option id=choice`, `--bots A,B` |
| `npm run links` | Re-list the magic links for the current game |
| `npm test` | Engine, bot, and render tests (`node --test`) |
| `npm run test:watch` | Same, re-running on change |
| `npm run typecheck` | Strict TypeScript over engine, client, scripts, and worker |
| `npm run build` | Dry-run bundle of the worker into `dist/` |
| `npm run check` | typecheck + test + build |
| `npm run simulate -- [games] [seed] [players]` | Random-bot harness; prints summary figures |
| `npm run smoke` | Plays a whole game through a running server over websockets |
| `npm run deploy` | `wrangler deploy` |
| `npm run secret` | Optionally lock the host page by setting `ADMIN_SECRET` on the deployed worker |
| `npm run logs` | Tail production logs |
| `npm run assets` | Check every sprite and rebuild `public/assets/` (needs Python 3) |

`BASE=https://your-worker.example npm run links` points the admin scripts at a
deployed instance; if the server is locked, `ADMIN_SECRET` is read from the
environment, falling back to `.dev.vars` locally.

## How it works

- **One game, one Durable Object** named `the-game`. It is single-threaded, so
  simultaneous commits cannot race. State is saved to `ctx.storage` after every
  accepted move and before any broadcast.
- **Hidden information stays server-side.** Each websocket receives only its
  own `playerView`.
- **Magic links** `/p/<token>` map to seats. The link is the identity.
- **Host routes** (`/host`, `/hotseat`, `/admin/*`) are open by default. Set
  `ADMIN_SECRET` and they require `Authorization: Bearer <secret>`.
- **Art.** Whatever would be printed art in a physical production is pixel
  art; whatever would be physical is UI; a few pieces (presence tokens,
  influence cubes) imitate real 3D objects in CSS. Fonts are Tiny5 for
  headings and Rubik for text. Details in `assets/README.md`.
- **Variants.** Candidate rules the host can switch between go in
  `spec.variants`; the host page builds its option pickers from that list and
  the engine validates the choices.

### Client messages

```jsonc
{ "type": "move", "move": { "type": "ready" } }
{ "type": "chat", "text": "The Lighthouse is about to boil over." }
```

Server replies with `state` (your `playerView`, who is online, which seats are
bots), `error` (reason for a rejected move), `chat`, and `presence`.

## Deploy

The Worker is named `monster-of-the-week` (`wrangler.toml`). To deploy on
every push, connect the GitHub repo in the Cloudflare dashboard
(**Workers & Pages → Create → Import a repository**, pick
`monster-of-the-week`, branch `main`). Workers Builds then builds and deploys
every push to `main` and gives pull requests preview URLs. Leave the build
command empty and the deploy command as `npx wrangler deploy`.

`npm run deploy` from a machine logged in with `wrangler login` also works.
The `[[migrations]]` block in `wrangler.toml` registers the Durable Object
class on first deploy. CI (`.github/workflows/ci.yml`) runs typecheck, tests,
and a dry-run bundle on every push and pull request.
