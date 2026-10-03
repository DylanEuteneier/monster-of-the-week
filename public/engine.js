// @ts-check
/**
 * Monster of the Week — pure game engine.
 *
 * Every exported function is pure: it takes a GameState (plus inputs) and
 * returns a new GameState or a derived value. Nothing here touches the network,
 * the DOM, or storage. The Durable Object uses it as the authority, the browser
 * uses it for previews, and the bot harness uses it for simulation.
 *
 * SCAFFOLD: the only phase today is a placeholder ready check that exercises
 * simultaneous commits, rounds, the log, bots, and per-seat views. It is not a
 * rule of the game. The real phases follow the round structure (design doc
 * 3.12) once a complete ruleset and implementation spec exist (Appendix F.16).
 *
 * Where this file and docs/motw-design.md disagree, the design document wins.
 */
import spec from './spec.json' with { type: 'json' };

export { spec };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** @typedef {typeof spec.archetypes[number]} Archetype */
/** @typedef {typeof spec.factions[number]} Faction */
/** @typedef {typeof spec.locations[number]} Location */
/** @typedef {typeof spec.slayerGroups[number]} SlayerGroup */

/**
 * A rule variant the host can pick when dealing (Appendix F.11).
 * @typedef {object} Variant
 * @property {string} id
 * @property {string} label
 * @property {string} description
 * @property {string} default  id of the default choice
 * @property {{ id: string, label: string, description: string }[]} choices
 */

/** @typedef {Record<string, string>} Options  variant id → choice id */
/** @typedef {'ready' | 'ended'} Phase */

/**
 * @typedef {object} PlayerState
 * @property {boolean} committed
 */

/**
 * @typedef {object} RoundLog
 * @property {number} round
 * @property {string[]} events  plain-language lines, in order
 */

/**
 * @typedef {object} GameState
 * @property {string} version
 * @property {Options} options
 * @property {number} rngState  advanced every time a shuffle uses it
 * @property {Phase} phase
 * @property {number} round  1-based
 * @property {string[]} seating  player ids in seat order
 * @property {Record<string, PlayerState>} players
 * @property {string[]} factions  the faction in play for each archetype, in spec.archetypes order (3.4)
 * @property {RoundLog[]} log
 * @property {string | null} winner
 */

/** @typedef {{ type: 'ready' }} Move */
/** @typedef {{ playerId: string, move: Move }} Submission */
/** @typedef {{ ok: true } | { ok: false, reason: string }} Verdict */

/**
 * What one seat may see (Appendix F.5): the public board, a public summary of
 * each seat, and a "me" part with the viewer's private information.
 * @typedef {object} PlayerView
 * @property {string} you
 * @property {Options} options
 * @property {Phase} phase
 * @property {number} round
 * @property {number} rounds
 * @property {string[]} seating
 * @property {Record<string, { committed: boolean }>} players
 * @property {string[]} factions
 * @property {RoundLog[]} log
 * @property {string | null} winner
 * @property {{ committed: boolean }} me
 */

export class IllegalMoveError extends Error {
  /** @param {string} reason */
  constructor(reason) {
    super(reason);
    this.name = 'IllegalMoveError';
  }
}

// ---------------------------------------------------------------------------
// Data lookups, built once
// ---------------------------------------------------------------------------

/** @type {Variant[]} */
export const variants = /** @type {Variant[]} */ (spec.variants);

const factionsById = new Map(spec.factions.map((faction) => [faction.id, faction]));
const locationsById = new Map(spec.locations.map((location) => [location.id, location]));

/** @param {string} id */
export function factionById(id) {
  const faction = factionsById.get(id);
  if (!faction) throw new Error(`unknown faction ${id}`);
  return faction;
}

/** @param {string} id */
export function locationById(id) {
  const location = locationsById.get(id);
  if (!location) throw new Error(`unknown location ${id}`);
  return location;
}

// ---------------------------------------------------------------------------
// Randomness — seeded, never from the system (Appendix F.4)
// ---------------------------------------------------------------------------

/**
 * mulberry32: one step of the generator.
 * @param {number} state
 * @returns {{ value: number, state: number }} value in [0, 1)
 */
export function nextRandom(state) {
  const next = (state + 0x6d2b79f5) | 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, state: next };
}

/**
 * Fisher–Yates shuffle driven by the seeded generator.
 * @template T
 * @param {T[]} items
 * @param {number} rngState
 * @returns {{ items: T[], rngState: number }}
 */
export function shuffle(items, rngState) {
  const out = items.slice();
  let state = rngState;
  for (let i = out.length - 1; i > 0; i--) {
    const roll = nextRandom(state);
    state = roll.state;
    const j = Math.floor(roll.value * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return { items: out, rngState: state };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/** @param {Partial<Options> | undefined} raw @returns {Options} */
export function resolveOptions(raw = {}) {
  /** @type {Options} */
  const options = {};
  for (const [id, choice] of Object.entries(raw)) {
    const variant = variants.find((candidate) => candidate.id === id);
    if (!variant) throw new Error(`unknown option ${id}`);
    if (!variant.choices.some((candidate) => candidate.id === choice)) throw new Error(`unknown choice ${choice} for ${id}`);
  }
  for (const variant of variants) options[variant.id] = raw[variant.id] ?? variant.default;
  return options;
}

/**
 * One faction picked at random from each archetype (3.4).
 * @param {number} rngState
 */
function pickFactions(rngState) {
  let state = rngState;
  const picked = spec.archetypes.map((archetype) => {
    const pool = spec.factions.filter((faction) => faction.archetype === archetype.id);
    const shuffled = shuffle(pool, state);
    state = shuffled.rngState;
    return shuffled.items[0].id;
  });
  return { factions: picked, rngState: state };
}

/**
 * @param {{ seed: number, players: string[], options?: Partial<Options> }} input
 * @returns {GameState}
 */
export function createGame(input) {
  const { min, max } = spec.meta.players;
  if (input.players.length < min || input.players.length > max) throw new Error(`a game seats ${min}–${max} players`);
  if (new Set(input.players).size !== input.players.length) throw new Error('player names must be unique');
  const options = resolveOptions(input.options);
  const { factions, rngState } = pickFactions(input.seed | 0);
  return {
    version: spec.meta.version,
    options,
    rngState,
    phase: 'ready',
    round: 1,
    seating: input.players.slice(),
    players: Object.fromEntries(input.players.map((id) => [id, { committed: false }])),
    factions,
    log: [],
    winner: null,
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** @param {string} reason @returns {Verdict} */
const no = (reason) => ({ ok: false, reason });
/** @type {Verdict} */
const OK = { ok: true };

/**
 * Checks run in a fixed order: seat, game over, move kind for the phase, the
 * seat may act now, then the move's own details.
 * @param {GameState} state
 * @param {Submission} submission
 * @returns {Verdict}
 */
export function validate(state, submission) {
  const player = state.players[submission.playerId];
  if (!player) return no('You are not seated at this table.');
  if (state.phase === 'ended') return no('The game is over.');
  if (submission.move?.type !== 'ready') return no('That move does not belong in this phase.');
  if (player.committed) return no('You have already committed this round.');
  return OK;
}

// ---------------------------------------------------------------------------
// Applying moves
// ---------------------------------------------------------------------------

/**
 * Validates, copies, changes the copy, and runs the automatic step when the
 * move completes the round. The state passed in is never altered.
 * @param {GameState} state
 * @param {Submission} submission
 * @returns {GameState}
 */
export function applyMove(state, submission) {
  const verdict = validate(state, submission);
  if (!verdict.ok) throw new IllegalMoveError(verdict.reason);
  /** @type {GameState} */
  const next = structuredClone(state);
  next.players[submission.playerId].committed = true;
  const everyone = next.seating.every((id) => next.players[id].committed);
  return everyone ? resolve(next) : next;
}

/**
 * The automatic part of a round: log it, clear the round's fields, and either
 * advance or end the game.
 * @param {GameState} state
 * @returns {GameState}
 */
export function resolve(state) {
  /** @type {GameState} */
  const next = structuredClone(state);
  next.log.push({ round: next.round, events: [`Round ${next.round}: every seat was ready.`] });
  for (const id of next.seating) next.players[id].committed = false;
  if (next.round >= spec.scaffold.rounds) {
    next.phase = 'ended';
    return next;
  }
  next.round += 1;
  return next;
}

// ---------------------------------------------------------------------------
// Derived values
// ---------------------------------------------------------------------------

/** Seats the current phase is still waiting on. @param {GameState | PlayerView} state */
export function waitingOn(state) {
  if (state.phase === 'ended') return [];
  return state.seating.filter((id) => !state.players[id].committed);
}

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

/**
 * The copy of the state one seat may see. Hidden information (hands, per 3.11)
 * belongs in `me` for the viewer and as counts for everyone else.
 * @param {GameState} state
 * @param {string} playerId
 * @returns {PlayerView}
 */
export function playerView(state, playerId) {
  const player = state.players[playerId];
  if (!player) throw new Error(`unknown player ${playerId}`);
  return {
    you: playerId,
    options: { ...state.options },
    phase: state.phase,
    round: state.round,
    rounds: spec.scaffold.rounds,
    seating: state.seating.slice(),
    players: Object.fromEntries(state.seating.map((id) => [id, { committed: state.players[id].committed }])),
    factions: state.factions.slice(),
    log: structuredClone(state.log),
    winner: state.winner,
    me: { committed: player.committed },
  };
}
