# Monster of the Week

This project is the design of a monster-of-the-week board game. We are currently prototyping.

The master design document is `docs/motw-design.md`. At the start of every session, read it before responding. At the end of a session, or whenever I ask, update that same file (don't create a new document) and commit it. Add decisions as decision records in Appendix A, and new terms to the glossary in Appendix B.

The document has three sections: 1. Context (working style and approach, plus truly ephemeral opinions, inspiration, and ideas that inform the game without direct details), 2. Game foundation (core tension, theme, setting, players, content, genre), 3. Design decisions (one entry per decision area, grouped as The Contest, The Levers, The Reckoning, The Stakes, and Scaling; each rule matures from Seed and Draft there to Trial and above in the rulebook, Appendix G). Keep context and direct game details distinct.

My goals, preferences and principles for this game are gathered in `docs/principles.md`, imported below. Check every proposal, measurement and change against it. When I state or change a preference, add it there, with its source, in the same session.

@docs/principles.md

## How we work

- Every rule, idea, and mechanism starts with a seed from me. Do not add or infer mechanisms, rules, or ideas on your own.
- We work each seed through together, in small steps. Your role is to ask questions, point out implications, conflicts, and gaps, and help refine what I've brought.
- No wholesale generation. Don't produce large swaths of rules, content, or design in one go.
- If I explicitly ask for options, offer a small number and label them clearly as suggestions.
- Record only what I've agreed to as decisions. Never record your own suggestions as decisions, and keep ideas clearly separate from decisions.
- Follow the working style and approach in section 1.1 of the document, including its process: the stages, what each produces, where it lives and the gate that finishes it. Current focus names the stage we are on.
- Ask me one question at a time, never a batch.
- Table presentation (tooltips, panels, prompt wording) is your call: decide, build and mention it. Rules, cards and the game's feel are mine.
- Keep the repository curated: nothing stale, one tool per job, each with a README. Keep the line between generic machinery and this game's specifics clear; the repo becomes the template for future designs.

## Running tests and measurements

- Run every test or measurement run in the background, and keep working while it runs. Size runs to the machine's 8 cores. To queue a run behind another, wait on its PID, never on a process-name search.
- Iterate on small samples (10 to 20 games, variants side by side); large runs only to confirm. Changes to default play are tested as challengers.
- Before a run, add every log its follow-up questions will need, so one run answers them.
- One measuring tool (`scripts/measure.js`), and one run feeds every report. New measures go into it, never into a new script.
- For speed work, iterate forward: prove play is unchanged with the fingerprints and `npm run check`, commit, move on. Don't re-time the old code after each change.
- Check UI in Node (`cardHtml` from `public/cards.js`) or with one screenshot of a page that shows it directly; never walk the tutorial or a game in a headless browser.

## Working in the code

- The code follows the design document. Never add, infer, or settle a mechanism in code that the document has not settled; an open question stays open (make it a variant in `spec.json` or ask).
- The engine and the bots are Rust (`rust/src`), pure, and the only place rules live. Content and numbers live in `public/spec.json`. The Worker and the table reach them through `public/rules.js` and the WebAssembly build `public/motw.wasm`: `npm run wasm` builds it (`npm run check` does too); commit it with the Rust change. `rust/tests/fixtures/fingerprints.json` records how the bots play: a change that changes play fails `npm run test:rust`, and is regenerated (`motw fingerprint ... digests=1`) only when a decision means play to change.
- Art follows `assets/README.md` and Appendix F.17: printed art is pixel art (palette only, whole-number scaling), physical things are UI, and tokens and cubes are CSS pieces (`public/pieces.js`). After editing `assets/sprites.py`, run `npm run assets` and commit the generated files in `public/assets/`.
- Run `npm run check` before committing (it runs the design document's link check first: `node scripts/doc-check.js`). When it passes, push to main, which deploys; no need to ask. You may use or replace my live dev game for testing. `npm run smoke` needs `npm run dev` running (port 8788).
- Prototype choices (art, board layout, region grouping, palette, table talk) are for testing only. Never apply them to the rules or treat them as settled design; the rules come only from decisions in the design document's section 3.
