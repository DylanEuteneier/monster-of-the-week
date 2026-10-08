// @ts-check
/**
 * Bot harness: plays whole games with bots and prints summary figures.
 *
 *   node scripts/simulate.js [games=1000] [seed=1] [players=5] [option=value ...] [bots=goal,hunter,...]
 *
 * e.g. node scripts/simulate.js 500 1 4 threshold=25 rounds=6 bots=goal,goal,hunter,goal-deep
 * Bot profiles are listed in public/bots.js; one profile repeats for every seat.
 *
 * Whole games check that the rules run start to finish and exercise every
 * phase. Bot figures are a guide, not a prediction (Appendix F.9).
 */
import { createGame, applyMove, nextRandom, spec, totalPresence, presenceOf } from '../public/engine.js';
import { botMove, PROFILES } from '../public/bots.js';

/** @typedef {import('../public/engine.js').GameState} GameState */

const MAX_MOVES_PER_GAME = 20_000;

/** A seeded () => number for the bots, so runs repeat. @param {number} seed */
function seededRng(seed) {
  let state = seed | 0;
  return () => {
    const roll = nextRandom(state);
    state = roll.state;
    return roll.value;
  };
}

/**
 * Play to the end. Each step offers every seat, in seat order, the chance to
 * move; the first that has a move makes it.
 * @param {GameState} state @param {() => number} rng
 * @param {(game: GameState) => void} [onRound]
 * @param {Record<string, import('../public/bots.js').Profile>} [profiles]  seat → bot profile (default goal)
 */
export function playOut(state, rng, onRound, profiles = {}) {
  let game = state;
  let round = game.round;
  /** @type {Record<string, import('../public/bots.js').BotMemory>} one memory per seat (goal bots) */
  const memory = Object.fromEntries(game.seating.map((id) => [id, {}]));
  for (let moves = 0; moves < MAX_MOVES_PER_GAME; moves++) {
    if (game.phase === 'ended') return game;
    let moved = false;
    for (const playerId of game.seating) {
      const move = botMove(game, { playerId, rng, profile: profiles[playerId] ?? 'goal', memory: memory[playerId] });
      if (!move) continue;
      game = applyMove(game, { playerId, move });
      moved = true;
      break;
    }
    if (!moved) throw new Error(`no seat can act in phase ${game.phase}, round ${game.round}`);
    if (game.round !== round) {
      onRound?.(game);
      round = game.round;
    }
  }
  throw new Error(`game did not end within ${MAX_MOVES_PER_GAME} moves`);
}

function main() {
  const [games = 1000, seed = 1, playerCount = spec.meta.players.tunedFor] = process.argv.slice(2, 5).map(Number);
  const pairs = process.argv.slice(5).map((arg) => arg.split('='));
  const botArg = pairs.find(([k]) => k === 'bots')?.[1] ?? 'goal';
  const options = Object.fromEntries(pairs.filter(([k]) => k !== 'bots'));
  const players = Array.from({ length: playerCount }, (_, i) => `P${i + 1}`);
  const list = /** @type {import('../public/bots.js').Profile[]} */ (botArg.split(','));
  for (const p of list) if (!PROFILES.includes(p)) throw new Error(`unknown bot profile ${p}; try ${PROFILES.join(', ')}`);
  const profiles = Object.fromEntries(players.map((pid, i) => [pid, list[i % list.length]]));
  const rng = seededRng(seed);
  const sides = { island: 0, invaders: 0 };
  /** @type {number[]} */ const finals = [];
  /** @type {number[][]} */ const byRound = [];
  /** @type {number[]} */ const scorched = [];
  /** @type {number[]} */ const sharedWins = [];
  /** @type {Map<string, number>} */ const seatWins = new Map();
  /** @type {Map<string, number>} */ const groupWins = new Map();
  /** @type {number[]} */ const trophies = [];
  let fights = 0;
  for (let i = 0; i < games; i++) {
    const start = createGame({ seed: seed + i, players, options });
    const end = playOut(start, rng, (g) => {
      const r = g.round - 2;
      (byRound[r] ??= []).push(totalPresence(g));
    }, profiles);
    const result = /** @type {NonNullable<GameState['result']>} */ (end.result);
    sides[result.side] += 1;
    finals.push(totalPresence(end));
    scorched.push(Object.values(end.board).filter((p) => p.scorched).length);
    sharedWins.push(result.players.length);
    for (const pid of result.players) {
      seatWins.set(pid, (seatWins.get(pid) ?? 0) + 1 / result.players.length);
      const group = end.players[pid].group;
      groupWins.set(group, (groupWins.get(group) ?? 0) + 1 / result.players.length);
    }
    for (const pid of end.seating) trophies.push(Object.values(end.players[pid].trophies).reduce((a, b) => a + b, 0));
    fights += end.log.flatMap((e) => e.events).filter((line) => /beat|true tie/.test(line)).length;
  }
  const mean = (/** @type {number[]} */ xs) => (xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)).toFixed(1);
  const pct = (/** @type {number} */ n) => `${((n / games) * 100).toFixed(1)}%`;
  const rounds = Number(createGame({ seed: 1, players, options }).options.rounds);
  console.log(`${games} games · ${playerCount} players · seed ${seed} · bots ${list.join(',')}${Object.keys(options).length ? ' · ' + Object.entries(options).map(([k, v]) => `${k}=${v}`).join(' ') : ''}\n`);
  console.log(`Island wins ${pct(sides.island)} · invaders win ${pct(sides.invaders)}`);
  console.log(`Total presence: start 35 · ${byRound.map((xs, r) => `after round ${r + 1} ${mean(xs)}`).join(' · ')} · final ${mean(finals)}`);
  console.log(`Fights per round ${(fights / games / rounds).toFixed(1)} · locations scorched per game ${mean(scorched)} · trophies per player ${mean(trophies)}`);
  console.log(`Shared victories ${pct(sharedWins.filter((n) => n > 1).length)}`);
  console.log('\nWins by seat');
  for (const pid of players) console.log(`  ${pid.padEnd(4)} ${profiles[pid].padEnd(8)} ${pct(seatWins.get(pid) ?? 0)}`);
  console.log('\nWins by slayer group');
  for (const g of spec.slayerGroups) console.log(`  ${g.name.padEnd(22)} ${pct(groupWins.get(g.id) ?? 0)}`);
  void presenceOf;
}

if (import.meta.url === `file://${process.argv[1]}`) main();
