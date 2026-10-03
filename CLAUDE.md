# Working in this repo

- `docs/motw-design.md` is the source of truth for the game. Code follows it.
- The designer seeds every rule. Never add, infer, or settle a mechanism in code that the design document has not settled; an open question stays open (make it a variant in `spec.json` or ask).
- The engine (`public/engine.js`) is pure and is the only place rules live. Content and numbers live in `public/spec.json`.
- Anything marked *scaffold* is placeholder plumbing, not a rule; replace it when the real phases land.
- Run `npm run check` before committing. `npm run smoke` needs `npm run dev` running (port 8788).
- Art follows `assets/README.md`: printed art is pixel art (palette only, whole-number scaling), physical things are UI, and tokens and cubes are CSS pieces (`public/pieces.js`). After editing `assets/sprites.py`, run `npm run assets` and commit the generated files in `public/assets/`.
