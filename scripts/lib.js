// @ts-check
/**
 * Shared by the tuning tournament (scripts/tournament.js) and the tests:
 * seeded randomness, whole games and the rest of a round played by bots, a
 * player's chance of winning, and the controlled card test (a card played in
 * a moment, against letting the turn go, with the rest of the round played
 * out). A measuring tool, not rules.
 */
import { applyMove, clone, memoising, nextRandom } from '../public/engine.js';
import { botMove, winChances } from '../public/bots.js';

/** @typedef {import('../public/engine.js').GameState} GameState @typedef {import('../public/engine.js').Move} Move @typedef {import('../public/bots.js').Profile} Profile */

export const MAX_MOVES = 20_000;

/** A seeded () => number, so runs repeat. @param {number} seed */
export function seededRng(seed) {
  let s = seed | 0;
  return () => { const r = nextRandom(s); s = r.state; return r.value; };
}

/**
 * The player's chance of winning, in percentage points: the bots' own
 * estimate for every seat, normalised so the table's chances add up to 100
 * (2026-10-08: unnormalised, each seat rated itself near 47% in round 1, and
 * high predictions came true about half as often as claimed).
 * @param {GameState} s @param {string} pid
 */
export const chance = (s, pid) => memoising(() => chanceNow(s, pid));
/** chance, unmemoised. @param {GameState} s @param {string} pid */
const chanceNow = (s, pid) => {
  const raw = (/** @type {string} */ id) => { const c = winChances(s, id); return c.pInvaders * c.asInvaders + (1 - c.pInvaders) * c.asIsland; };
  const all = s.seating.map((id) => ({ id, v: raw(id) }));
  const sum = all.reduce((n, x) => n + x.v, 0);
  return sum > 0 ? (100 * (all.find((x) => x.id === pid)?.v ?? 0)) / sum : 100 / s.seating.length;
};

/**
 * Play to the end. Each step offers every seat, in seat order, the chance to
 * move; the first that has a move makes it.
 * @param {GameState} state @param {() => number} rng
 * @param {(game: GameState) => void} [onRound]
 * @param {Record<string, string>} [profiles]  seat → bot profile (default trophy; persona overrides allowed)
 */
export function playOut(state, rng, onRound, profiles = {}) {
  let game = state;
  let round = game.round;
  /** @type {Record<string, import('../public/bots.js').BotMemory>} one memory per seat (goal bots) */
  const memory = Object.fromEntries(game.seating.map((id) => [id, {}]));
  for (let moves = 0; moves < MAX_MOVES; moves++) {
    if (game.phase === 'ended') return game;
    let moved = false;
    for (const playerId of game.seating) {
      const move = botMove(game, { playerId, rng, profile: /** @type {Profile} */ (profiles[playerId] ?? 'trophy'), memory: memory[playerId], table: profiles, memories: memory });
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
  throw new Error(`game did not end within ${MAX_MOVES} moves`);
}

/** Bots play from here to the end of the round's play (its fights). @param {GameState} state @param {number} seed @param {Profile | Record<string, string>} bots  one profile for every seat, or each seat's @param {Record<string, import('../public/bots.js').BotMemory>} [memories]  each bot's memory now (copied; its plan carries on) */
export function playRest(state, seed, bots, memories = undefined) {
  const rng = seededRng(seed);
  let s = state;
  const round = s.round;
  /** @type {Record<string, import('../public/bots.js').BotMemory>} */
  const memory = Object.fromEntries(s.seating.map((id) => [id, clone(memories?.[id] ?? {})]));
  for (let n = 0; n < MAX_MOVES && s.phase === 'play' && s.round === round; n++) {
    let moved = false;
    for (const playerId of s.seating) {
      const move = botMove(s, { playerId, rng, profile: /** @type {Profile} */ (typeof bots === 'string' ? bots : bots[playerId] ?? 'trophy'), memory: memory[playerId], table: typeof bots === 'string' ? undefined : bots, memories: memory });
      if (!move) continue;
      s = applyMove(s, { playerId, move });
      moved = true;
      break;
    }
    if (!moved) break;
  }
  return s;
}

/** A card's action played. @param {GameState} state @param {string} pid @param {Move} move */
export const play = (state, pid, move) => applyMove(state, { playerId: pid, move });

/**
 * The card test (designer, 2026-10-26: a card's worth is what it adds to a hand, not the average of every way to play
 * it; a situational card is played when it's good, and otherwise held, spent for sway or ignored). At a moment of a
 * real game, the player to act is given the card and its bot chooses freely, as in play (the card's action, its sway,
 * bringing its faction back, another card, or passing); bots play out the rest of the round. The card's worth is the
 * change in that player's chance of winning against the same moment without the card, in percentage points; each
 * play-out seed, and the decision's randomness, is shared between the two. Also: whether the bot chose to use the card.
 * The rest of the round is played by `bots`: the table's own seats and profiles. Replaces the forced-play test (the
 * card's action played as well as a few sampled targets allowed, against letting the turn go).
 * @param {GameState} state @param {string[]} cardIds @param {{ playouts: number, bots: Profile | Record<string, string>, seed: number, memories?: Record<string, import('../public/bots.js').BotMemory> }} o
 * @returns {{ benefit: Record<string, number | null>, used: Record<string, boolean> }}
 */
export function measureState(state, cardIds, o) {
  const pid = state.seating[state.turn];
  const seeds = Array.from({ length: o.playouts }, (_, i) => o.seed * 7919 + i);
  const profile = /** @type {Profile} */ (typeof o.bots === 'string' ? o.bots : o.bots[pid] ?? 'trophy');
  /** The player's chance after its bot chooses freely from this state, the round played out. @param {GameState} s */
  const value = (s) => {
    const move = botMove(s, { playerId: pid, rng: seededRng(o.seed), profile, memory: clone(o.memories?.[pid] ?? {}), table: typeof o.bots === 'string' ? undefined : o.bots, memories: o.memories });
    const after = !move ? s : move.type === 'play' ? play(s, pid, move) : applyMove(s, { playerId: pid, move });
    return { move, v: seeds.reduce((n, seed) => n + chance(playRest(after, seed, o.bots, o.memories), pid), 0) / seeds.length };
  };
  /** @type {Map<string, number>} without each card: the hand as it is, or less that card */
  const without = new Map();
  /** @type {Record<string, number | null>} */
  const benefit = {};
  /** @type {Record<string, boolean>} */
  const used = {};
  for (const cardId of cardIds) {
    const base = clone(state);
    base.players[pid].hand = base.players[pid].hand.filter((c) => c !== cardId);
    const key = base.players[pid].hand.join(',');
    if (!without.has(key)) without.set(key, value(base).v);
    const s = clone(base);
    s.players[pid].hand.push(cardId);
    const r = value(s);
    benefit[cardId] = Math.round((r.v - /** @type {number} */ (without.get(key))) * 100) / 100;
    used[cardId] = !!r.move && r.move.type === 'play' && r.move.card === cardId;
  }
  return { benefit, used };
}

/**
 * A logged record from before "influence" was renamed "sway" (designer,
 * 2026-10-10), with its keys and its enum values renamed: so old tournament
 * logs and baselines still read. Records written since pass through unchanged.
 * @template T @param {T} x @returns {T}
 */
export function upgradeRecord(x) {
  const fix = (/** @type {string} */ k) => k.replace(/Influence/g, 'Sway').replace(/influence/g, 'sway');
  if (Array.isArray(x)) return /** @type {T} */ (/** @type {unknown} */ (x.map(upgradeRecord)));
  if (typeof x === 'string') return /** @type {T} */ (/** @type {unknown} */ (/^influence(-spent|-placed)?$/.test(x) ? fix(x) : x));
  if (x === null || typeof x !== 'object') return x;
  return /** @type {T} */ (Object.fromEntries(Object.entries(x).map(([k, v]) => [fix(k), upgradeRecord(v)])));
}

