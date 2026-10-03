# Working in this repo

- `docs/motw-design.md` is the source of truth for the game. Code follows it.
- The designer seeds every rule. Never add, infer, or settle a mechanism in code that the design document has not settled; an open question stays open (make it a variant in `spec.json` or ask).
- The engine (`public/engine.js`) is pure and is the only place rules live. Content and numbers live in `public/spec.json`.
- Anything marked *scaffold* is placeholder plumbing, not a rule; replace it when the real phases land.
- Run `npm run check` before committing. `npm run smoke` needs `npm run dev` running (port 8788).
