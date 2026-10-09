// @ts-check
/**
 * Shared by the tuning tournament (scripts/tournament.js) and the tests:
 * seeded randomness, whole games and the rest of a round played by bots, a
 * player's chance of winning, and the controlled card test (a card played in
 * a moment, against letting the turn go, with the rest of the round played
 * out). A measuring tool, not rules.
 */
import { applyMove, nextRandom, sampleTarget, validate } from '../public/engine.js';
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
export const chance = (s, pid) => {
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
 * @param {Record<string, string>} [profiles]  seat → bot profile (default goal; persona overrides allowed)
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
      const move = botMove(game, { playerId, rng, profile: /** @type {Profile} */ (profiles[playerId] ?? 'goal'), memory: memory[playerId], table: profiles, memories: memory });
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
  const memory = Object.fromEntries(s.seating.map((id) => [id, structuredClone(memories?.[id] ?? {})]));
  for (let n = 0; n < MAX_MOVES && s.phase === 'play' && s.round === round; n++) {
    let moved = false;
    for (const playerId of s.seating) {
      const move = botMove(s, { playerId, rng, profile: /** @type {Profile} */ (typeof bots === 'string' ? bots : bots[playerId] ?? 'goal'), memory: memory[playerId], table: typeof bots === 'string' ? undefined : bots, memories: memory });
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
export function play(state, pid, move) {
  let s = applyMove(state, { playerId: pid, move });
  if (s.pending && s.pending.player === pid) s = applyMove(s, { playerId: pid, move: { type: 'confirm' } });
  return s;
}

const SAMPLED_TARGETS = 12;

/**
 * The controlled card test (designer, 2026-10-07: card strength over a
 * played-out round, as benefit to the player). The player to act is given each
 * card, plays it as well as it can find (the few best targets one move ahead,
 * each played out), and bots play the rest of the round; its benefit is the
 * change in the player's chance of winning against letting the turn go, in
 * percentage points. Each playout seed is shared between the card and the
 * baseline. The rest of the round is played by `bots`: the table's own seats
 * and profiles, so the imagined future has the same players as the game.
 * null: no legal target.
 * @param {GameState} state @param {string[]} cardIds @param {{ playouts: number, targets: number, bots: Profile | Record<string, string>, seed: number, memories?: Record<string, import('../public/bots.js').BotMemory> }} o
 * @returns {Record<string, number | null>}
 */
export function measureState(state, cardIds, o) {
  const pid = state.seating[state.turn];
  const seeds = Array.from({ length: o.playouts }, (_, i) => o.seed * 7919 + i);
  const mean = (/** @type {GameState} */ s) => seeds.reduce((n, seed) => n + chance(playRest(s, seed, o.bots, o.memories), pid), 0) / seeds.length;
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
    const best = [...moves.values()].map((m) => { const after = play(s, pid, m); return { after, v: chance(after, pid) }; })
      .sort((a, b) => b.v - a.v).slice(0, o.targets);
    out[cardId] = Math.round((Math.max(...best.map((b) => mean(b.after))) - base) * 100) / 100;
  }
  return out;
}
