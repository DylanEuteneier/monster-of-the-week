// @ts-check
/**
 * Card strength over a played-out round (designer, 2026-10-07): benefit to
 * the player. In each sampled state, the player to act is given the card,
 * plays it, and bots play the rest of the round (every seat, the player's own
 * later turns too) through the round's fights. Its strength is how much
 * better off the player ends the round than if they had let the turn go,
 * scored by the bots' own position value (evaluate in public/bots.js:
 * trophies, standing and influence, weighed by how the game looks like
 * ending).
 *
 *   node scripts/roundplay.js [states=40] [seed=1] [players=5] [playouts=4] [targets=3] [bots=deep] [only=card,card] [opening=1] [out=file.json] [option=value ...]
 *
 * - The player picks the target as a strong player would: it samples
 *   targets, keeps the few best one move ahead (`targets`), plays each out
 *   `playouts` times and takes the best on average. Taking the best of a few
 *   noisy averages leans the figure up a little, the same way for every card
 *   with a choice.
 * - Each playout seed is shared between the card and the baseline, so the
 *   bots meet the same luck in both.
 * - opening=1 samples only each round's first play (the marked cards, FP2).
 * - Runs across every core (worker threads).
 * - out= is rewritten after every state, with the table so far (a long run
 *   always has its latest results on disk; `partial` says how far it got).
 *
 * A measuring tool, not a rule: bots are not real players, and the horizon
 * is one round.
 */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applyMove, spec, cardById, sampleTarget, validate } from '../public/engine.js';
import { botMove, evaluate } from '../public/bots.js';
import { sampleStates, seededRng } from './balance.js';

/** @typedef {import('../public/engine.js').GameState} GameState @typedef {import('../public/engine.js').Move} Move */

const MAX_MOVES = 3000;
const SAMPLED_TARGETS = 12;

/** Bots play from here to the end of the round's play (its fights). @param {GameState} state @param {number} seed @param {import('../public/bots.js').Profile} bots */
function playRest(state, seed, bots) {
  const rng = seededRng(seed);
  let s = state;
  const round = s.round;
  for (let n = 0; n < MAX_MOVES && s.phase === 'play' && s.round === round; n++) {
    let moved = false;
    for (const playerId of s.seating) {
      const move = botMove(s, { playerId, rng, profile: bots });
      if (!move) continue;
      s = applyMove(s, { playerId, move });
      moved = true;
      break;
    }
    if (!moved) break;
  }
  return s;
}

/** A card's action played, straight through to its resolution. @param {GameState} state @param {string} pid @param {Move} move */
function play(state, pid, move) {
  let s = applyMove(state, { playerId: pid, move });
  if (s.pending && s.pending.player === pid) s = applyMove(s, { playerId: pid, move: { type: 'confirm' } });
  return s;
}

/**
 * One state: the baseline, then each card's best benefit (null if it has no legal target).
 * @param {GameState} state @param {string[]} cardIds @param {{ playouts: number, targets: number, bots: import('../public/bots.js').Profile, seed: number }} o
 */
function measureState(state, cardIds, o) {
  const pid = state.seating[state.turn];
  const seeds = Array.from({ length: o.playouts }, (_, i) => o.seed * 7919 + i);
  const mean = (/** @type {GameState} */ s) => seeds.reduce((n, seed) => n + evaluate(playRest(s, seed, o.bots), pid), 0) / seeds.length;
  // Baseline: the turn goes by with nothing played (a measuring device, not a move in the game).
  const skip = structuredClone(state);
  skip.opened = true;
  skip.turn = (skip.turn + 1) % skip.seating.length;
  const base = mean(skip);
  /** @type {Record<string, number | null>} */
  const out = {};
  const rng = seededRng(o.seed);
  for (const cardId of cardIds) {
    const s = structuredClone(state);
    s.opened = true; // the card is measured on its own, not as the forced opener
    s.players[pid].hand.push(cardId);
    /** @type {Map<string, Move>} */
    const moves = new Map();
    for (let i = 0; i < SAMPLED_TARGETS * 2 && moves.size < SAMPLED_TARGETS; i++) {
      const target = sampleTarget(s, pid, cardId, rng);
      const move = /** @type {Move} */ ({ type: 'play', card: cardId, use: 'action', target });
      if (target && validate(s, { playerId: pid, move }).ok) moves.set(JSON.stringify(target), move);
    }
    if (!moves.size) { out[cardId] = null; continue; }
    const best = [...moves.values()].map((m) => { const after = play(s, pid, m); return { after, v: evaluate(after, pid) }; })
      .sort((a, b) => b.v - a.v).slice(0, o.targets);
    out[cardId] = Math.max(...best.map((b) => mean(b.after))) - base;
  }
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const [nArg = '40', seedArg = '1', playersArg = '5', playoutsArg = '4', targetsArg = '3', botsArg = 'deep'] = args.filter((a) => !a.includes('='));
  const options = Object.fromEntries(args.filter((a) => a.includes('=')).map((a) => a.split('=')));
  const only = options.only?.split(','), outFile = options.out, opening = options.opening === '1';
  delete options.only; delete options.out; delete options.opening;
  const players = ['ann', 'bob', 'cat', 'dan', 'eve'].slice(0, Number(playersArg));
  const n = Number(nArg);
  const cardIds = [...spec.cards, ...spec.testCards.cards].filter((c) => c.action && (!only || only.includes(c.id))).map((c) => c.id);
  const workers = Math.min(availableParallelism(), n);
  const job = { n, seed: Number(seedArg), players, options, opening, cardIds, playouts: Number(playoutsArg), targets: Number(targetsArg), bots: botsArg };
  /** @type {Record<string, (number | null)[]>} */
  const results = Object.fromEntries(cardIds.map((id) => [id, []]));
  let done = 0, running = workers;
  const t0 = Date.now();
  for (let w = 0; w < workers; w++) {
    const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { ...job, worker: w, workers } });
    worker.on('message', (/** @type {Record<string, number | null>} */ r) => {
      for (const [id, v] of Object.entries(r)) results[id].push(v);
      done += 1;
      process.stderr.write(`\r${done}/${n} states, ${Math.round((Date.now() - t0) / 1000)}s`);
      if (outFile) write(table(), true);
    });
    worker.on('exit', () => { running -= 1; if (!running) report(); });
  }
  function table() {
    return cardIds.map((id) => {
      const vs = /** @type {number[]} */ (results[id].filter((v) => v !== null));
      const m = vs.reduce((a, b) => a + b, 0) / (vs.length || 1);
      return { id, playable: (100 * vs.length) / done, mean: m, up: vs.length ? (100 * vs.filter((v) => v > 0).length) / vs.length : 0, max: vs.length ? Math.max(...vs) : 0 };
    }).sort((a, b) => b.mean - a.mean);
  }
  /** @param {ReturnType<typeof table>} stats @param {boolean} partial */
  function write(stats, partial) {
    const r2 = (/** @type {number} */ x) => Math.round(x * 100) / 100;
    writeFileSync(/** @type {string} */ (outFile), `${JSON.stringify({ measured: new Date().toISOString().slice(0, 10), partial: partial ? `${done}/${n} states` : false, states: done, players: players.length, bots: job.bots, playouts: job.playouts, targets: job.targets, opening, options, scores: Object.fromEntries(stats.map((s) => [s.id, { name: cardById(s.id).name, playable: Math.round(s.playable), benefit: r2(s.mean), up: Math.round(s.up) }])) }, null, 2)}\n`);
  }
  function report() {
    process.stderr.write('\n');
    const stats = table();
    if (outFile) write(stats, false);
    console.log(`${done} ${opening ? 'opening ' : ''}states, ${players.length} players, ${job.bots} bots, ${job.playouts} playouts, best of ${job.targets} targets, ${JSON.stringify(options)}. Benefit: the player's position after the round's fights, against letting the turn go (mean, how often above 0, largest).`);
    console.log(`${'card'.padEnd(30)} | playable | benefit`);
    for (const s of stats) console.log(`${cardById(s.id).name.padEnd(30)} | ${`${s.playable.toFixed(0)}%`.padStart(8)} | ${s.mean.toFixed(2).padStart(6)} ${`${s.up.toFixed(0)}%`.padStart(4)} ${s.max.toFixed(2).padStart(6)}`);
  }
}

if (isMainThread) main();
else {
  const d = workerData;
  const states = sampleStates(d.n, d.seed, d.players, 'smart', d.options, d.opening);
  for (let i = d.worker; i < states.length; i += d.workers) {
    parentPort?.postMessage(measureState(states[i], d.cardIds, { playouts: d.playouts, targets: d.targets, bots: d.bots, seed: d.seed * 100003 + i }));
  }
}
