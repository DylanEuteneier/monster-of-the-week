// @ts-check
/**
 * The tutorial's table: a whole game held in the browser, with the engine as
 * the authority and bots in the other seats. Pure (no page), so the seed
 * search and the tests can run it in Node. Prototype tooling, not rules: every
 * move goes through the engine exactly as it would on the server.
 */
import { createGame, applyMove, validate, waitingOn, nextRandom, clone } from './rules.js';
import { botMove, fast } from './rules.js';

/** @typedef {import('./rules.js').GameState} GameState */
/** @typedef {import('./rules.js').Move} Move */
/** @typedef {import('./rules.js').BotMemory} BotMemory */

/** The seat the learner sits in. */
export const YOU = 'You';
/** The bot seats and their profiles (one faction backer, two trophy players, as at the tuning table). */
export const BOTS = /** @type {const} */ ([['Ash', 'bot:lean=0.3'], ['Bea', 'bot:lean=-0.3'], ['Cy', 'bot:lean=-0.3']]);
/**
 * The tutorial's deal: found by scripts/tutorial-seed.js so the first round
 * shows every part of a round (both uses of a card, fights with piles, growth).
 * A different engine or deck may need a new seed; the narration adapts either way.
 */
export const SEED = 7;
/** Seats in order, so the learner is Slayerettes; otherwise the game's defaults (passing off, D29). */
// Pinned to growth by groups (GR1, with D33's shifts) and the fixed threshold until the tutorial is rewritten for nightfall tokens (D38) and D40.
export const OPTIONS = { groups: 'seat', growth: '2', alignedGrowth: 'on', swayTokens: 'shifts', thresholdPerPlayer: 'off' };

/**
 * Everything the tutorial's table holds. Plain data, so a snapshot is a copy.
 * @typedef {{ state: GameState, rng: number, memory: Record<string, BotMemory> }} Table
 */

/** A new tutorial game. @param {number} [seed] @returns {Table} */
export function newTable(seed = SEED) {
  const state = createGame({ seed, players: [YOU, ...BOTS.map(([id]) => id)], options: OPTIONS });
  return { state, rng: seed ^ 0x5eed, memory: Object.fromEntries(state.seating.map((id) => [id, {}])) };
}

/** @param {Table} table */
export const copyTable = (table) => clone(table);

/**
 * Does this move end the round's play? With passing off (D29), the last card in anyone's hand; with passing on, the
 * last pass in a row. @param {GameState} state @param {Move} move
 */
export function endsPlay(state, move) {
  if (state.phase !== 'play') return false;
  if (state.options.passing === 'on') return move.type === 'pass' && state.passesInRow === state.seating.length - 1;
  return move.type === 'play' && state.seating.reduce((n, id) => n + state.players[id].hand.length, 0) === 1;
}

/**
 * The board after a move that ends play, before the fights: a last card played as if passing were on, so play
 * doesn't end yet (a last pass changes nothing). For showing only; the game moves on with the real move.
 * @param {GameState} state @param {string} pid @param {Move} move @returns {GameState}
 */
export function beforeFights(state, pid, move) {
  if (move.type !== 'play') return state;
  const open = clone(state);
  open.options = { ...open.options, passing: 'on' };
  return applyMove(open, { playerId: pid, move });
}

/** Seat → profile, every seat (the learner's automatic moves play as a trophy player). */
const PROFILES = /** @type {Record<string, string>} */ (Object.fromEntries([[YOU, 'bot:lean=-0.3'], ...BOTS]));

/**
 * The move a bot (or the learner, when the tutorial plays for them) makes now.
 * Mutates the table's rng and that seat's memory.
 * @param {Table} table @param {string} pid @returns {Move | null}
 */
export function autoMove(table, pid) {
  const rng = () => { const r = nextRandom(table.rng); table.rng = r.state; return r.value; };
  const table_ = Object.fromEntries(Object.entries(PROFILES).map(([id, p]) => [id, fast(p)]));
  return botMove(table.state, { playerId: pid, rng, profile: /** @type {any} */ (fast(PROFILES[pid])), memory: table.memory[pid], table: table_, memories: table.memory });
}

/** Who acts next: the learner first while they still owe a draft pick, then seats in order. @param {GameState} state */
export function nextActor(state) {
  const waiting = waitingOn(state);
  return waiting.includes(YOU) ? YOU : waiting[0] ?? null;
}

/** Apply a move to the table (throws the engine's reason if illegal). @param {Table} table @param {string} pid @param {Move} move */
export function play(table, pid, move) {
  table.state = applyMove(table.state, { playerId: pid, move });
}

/** @param {Table} table @param {string} pid @param {Move} move */
export const check = (table, pid, move) => validate(table.state, { playerId: pid, move });

/** Every bot draft pick still owed this pass (the draft is simultaneous; the learner picks first). @param {Table} table */
export function botPicks(table) {
  for (const [id] of BOTS) {
    if (table.state.phase !== 'draft' || table.state.players[id].picked) continue;
    const move = autoMove(table, id);
    if (move) play(table, id, move);
  }
}
