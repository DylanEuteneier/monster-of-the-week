# Monster of the Week

This project is the design of a monster-of-the-week board game. We are currently prototyping.

The master design document is `docs/motw-design.md`. At the start of every session, read it before responding. At the end of a session, or whenever I ask, update that same file (don't create a new document) and commit it. Add decisions as decision records in Appendix A, and new terms to the glossary in Appendix B.

The document has three sections: 1. Context (working style and approach, plus truly ephemeral opinions, inspiration, and ideas that inform the game without direct details), 2. Game foundation (core tension, theme, setting, players, content, genre), 3. Design decisions (one entry per decision area, grouped as The Contest, The Levers, The Reckoning, The Stakes, and Scaling; each entry matures in place from Ideas to Decisions to Details to Rules). Keep context and direct game details distinct.

## How we work

- Every rule, idea, and mechanism starts with a seed from me. Do not add or infer mechanisms, rules, or ideas on your own.
- We work each seed through together, in small steps. Your role is to ask questions, point out implications, conflicts, and gaps, and help refine what I've brought.
- No wholesale generation. Don't produce large swaths of rules, content, or design in one go.
- If I explicitly ask for options, offer a small number and label them clearly as suggestions.
- Record only what I've agreed to as decisions. Never record your own suggestions as decisions, and keep ideas clearly separate from decisions.
- Follow the working style and approach in section 1.1 of the document.

## Working in the code

- The code follows the design document. Never add, infer, or settle a mechanism in code that the document has not settled; an open question stays open (make it a variant in `spec.json` or ask).
- The engine (`public/engine.js`) is pure and is the only place rules live. Content and numbers live in `public/spec.json`.
- Anything marked *scaffold* is placeholder plumbing, not a rule; replace it when the real phases land.
- Art follows `assets/README.md` and Appendix F.17: printed art is pixel art (palette only, whole-number scaling), physical things are UI, and tokens and cubes are CSS pieces (`public/pieces.js`). After editing `assets/sprites.py`, run `npm run assets` and commit the generated files in `public/assets/`.
- Run `npm run check` before committing. `npm run smoke` needs `npm run dev` running (port 8788).
- Prototype choices (art, board layout, region grouping, palette, table talk) are for testing only. Never apply them to the rules or treat them as settled design; the rules come only from decisions in the design document's section 3.
