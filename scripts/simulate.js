// @ts-check
/**
 * Random-bot harness: plays whole games with bots and prints summary figures.
 *
 *   node scripts/simulate.js [games=1000] [seed=1] [players=5]
 *
 * Random bots are good for checking that the rules run start to finish and
 * that every phase is exercised. Their figures are a rough guide, not a
 * prediction (Appendix F.9). Add figures here as the real rules land.
 */
import { createGame, applyMove, nextRandom, spec } from '../public/engine.js';
import { botMove } from '../public/bots.js';

/** @typedef {import('../public/engine.js').GameState} GameState */

const MAX_MOVES_PER_GAME = 10_000;

/** A seeded () => number for the bots, so runs repeat. @param {number} seed */
function seededRng(seed) {
  let state = seed | 0;
  return () => {
    const roll = nextRandom(state);
    state = roll.state;
    return roll.value;
  };
}

/** @param {GameState} state @param {() => number} rng */
function playOut(state, rng) {
  let game = state;
  for (let moves = 0; moves < MAX_MOVES_PER_GAME; moves++) {
    if (game.phase === 'ended') return game;
    const mover = game.seating.find((playerId) => botMove(game, { playerId, rng }) !== null);
    if (!mover) throw new Error(`no seat can act in phase ${game.phase}, round ${game.round}`);
    const move = botMove(game, { playerId: mover, rng });
    if (move) game = applyMove(game, { playerId: mover, move });
  }
  throw new Error(`game did not end within ${MAX_MOVES_PER_GAME} moves`);
}

function main() {
  const games = Number(process.argv[2] ?? 1000);
  const seed = Number(process.argv[3] ?? 1);
  const playerCount = Number(process.argv[4] ?? spec.meta.players.tunedFor);
  const players = Array.from({ length: playerCount }, (_, i) => `P${i + 1}`);
  const rng = seededRng(seed);
  /** @type {Map<number, number>} */
  const endRounds = new Map();
  /** @type {Map<string, number>} */
  const factionCounts = new Map();
  for (let i = 0; i < games; i++) {
    const end = playOut(createGame({ seed: seed + i, players }), rng);
    endRounds.set(end.round, (endRounds.get(end.round) ?? 0) + 1);
    for (const faction of end.factions) factionCounts.set(faction, (factionCounts.get(faction) ?? 0) + 1);
  }
  console.log(`${games} games · ${playerCount} players · seed ${seed}\n`);
  console.log('End round');
  for (const [round, count] of [...endRounds].sort((a, b) => a[0] - b[0])) console.log(`  ${String(round).padStart(2)}  ${((count / games) * 100).toFixed(1)}%`);
  console.log('\nFaction in play (expect ~33.3% each within an archetype)');
  for (const faction of spec.factions) console.log(`  ${faction.name.padEnd(24)} ${(((factionCounts.get(faction.id) ?? 0) / games) * 100).toFixed(1)}%`);
}

main();
