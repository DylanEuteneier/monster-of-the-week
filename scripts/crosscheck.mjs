// @ts-check
/**
 * Cross-check cases for the Rust port (rust/src/bin/motw.rs crosscheck): states from bot games, and for the player to
 * act and each card in their hand, what the JavaScript engine answers: the legal targets it lists (listTargets, even
 * and not), a sampled target from a fixed random sequence (sampleTarget), and the first choice (nextChoice). A
 * checking tool, not a rule.
 *
 *   node scripts/crosscheck.mjs [games=10] [seed=1] [every=3] [out=cases.jsonl] [o.variant=choice ...]
 */
import { writeFileSync } from 'node:fs';
import { createGame, applyMove, waitingOn, listTargets, sampleTarget, nextChoice, checkTarget, cardById, previewTarget } from '../public/engine.js';
import { botMove } from '../public/bots.js';

const opts = Object.fromEntries(process.argv.slice(2).map((a) => a.split(/=(.*)/s).slice(0, 2)));
const games = Number(opts.games ?? 10), seed0 = Number(opts.seed ?? 1), every = Number(opts.every ?? 3);
const options = Object.fromEntries(Object.entries(opts).filter(([k]) => k.startsWith('o.')).map(([k, v]) => [k.slice(2), v]));
const profiles = ['backer:sim=0', 'backer:sim=0', 'trophy:sim=0', 'trophy:sim=0', 'trophy:sim=0'];

/** The bots' play-out random sequence (an LCG), the same in the Rust check. @param {number} seed */
const lcg = (seed) => { let x = seed | 0; return () => { x = (Math.imul(x, 1664525) + 1013904223) | 0; return (x >>> 0) / 2 ** 32; }; };

const lines = [];
for (let g = 0; g < games; g++) {
  const players = profiles.map((_, i) => `P${i + 1}`);
  let state = createGame({ seed: seed0 + g, players, options });
  const memory = Object.fromEntries(players.map((p) => [p, {}]));
  const rng = lcg(seed0 * 7919 + g);
  for (let i = 0; state.phase !== 'ended' && i < 5000; i++) {
    const pid = waitingOn(state)[0];
    if (state.phase === 'play' && i % every === 0) {
      for (const card of new Set(state.players[pid].hand)) {
        if (!cardById(card).action) continue;
        const list = listTargets(state, pid, card, 40);
        const even = listTargets(state, pid, card, 40, true);
        const sampled = [];
        for (let k = 0; k < 3; k++) sampled.push(sampleTarget(state, pid, card, lcg(i * 31 + k)));
        const first = nextChoice(state, pid, card, {});
        // A few deliberately broken targets: each listed target with one field dropped, and its reason.
        const broken = list.targets.slice(0, 4).flatMap((t) => Object.keys(t).map((k) => { const x = { ...t }; delete x[/** @type {keyof typeof x} */ (k)]; return { t: x, reason: checkTarget(state, pid, cardById(card), x) }; }));
        const preview = list.targets.slice(0, 3).map((t) => previewTarget(state, pid, card, t));
        lines.push(JSON.stringify({ state, pid, card, list, even, sampled, sampleSeeds: [0, 1, 2].map((k) => i * 31 + k), first, broken, preview }));
      }
    }
    const move = botMove(state, { playerId: pid, rng, profile: profiles[players.indexOf(pid)], memory: memory[pid] });
    state = applyMove(state, { playerId: pid, move: /** @type {any} */ (move) });
  }
}
writeFileSync(String(opts.out ?? 'crosscheck.jsonl'), `${lines.join('\n')}\n`);
console.log(`${lines.length} cases`);
