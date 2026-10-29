// @ts-check
/**
 * Monster of the Week — the rules, for JavaScript. The rules engine and the bots are Rust (rust/src, built to
 * public/motw.wasm by `npm run wasm`); this module hands them game states as JSON and gives back the answers, under the
 * names the table, the Worker and the scripts use. It holds no rules: only the types, lookups into spec.json (the
 * content), a deep copy, and the bridge.
 *
 * Every call is pure: it takes a game state (or a seat's view of one, for the table's previews) and returns a new
 * state or a derived value. The Durable Object uses it as the authority, the browser for previews and the tutorial's
 * bots, the scripts for simulation.
 *
 * Loading: in a browser the module is fetched at import (top-level await); in Node it is read from disk on first use;
 * the Worker imports motw.wasm itself and hands it over (useModule).
 */
import spec from './spec.json' with { type: 'json' };

export { spec };

// Types
// ---------------------------------------------------------------------------

/** @typedef {typeof spec.archetypes[number]} Archetype */
/** @typedef {typeof spec.factions[number]} Faction */
/** @typedef {typeof spec.locations[number]} Location */
/** @typedef {typeof spec.slayerGroups[number]} SlayerGroup */
/** @typedef {typeof spec.cards[number]} Card */

/**
 * A rule variant the host can pick when dealing (Appendix F.11).
 * @typedef {object} Variant
 * @property {string} id
 * @property {string} label
 * @property {string} description
 * @property {string} default
 * @property {{ id: string, label: string, description: string }[]} choices
 */

/** @typedef {Record<string, string>} Options  variant id → choice id */
/** @typedef {'draft' | 'play' | 'night' | 'growth' | 'ended'} Phase */

/**
 * @typedef {object} Place
 * @property {Record<string, number>} tokens      faction → tokens
 * @property {Record<string, number>} sway  player → sway placed here
 * @property {boolean} scorched
 * @property {string} [gate]       The Gate (ↂ strike, designer 2026-10-17): the location joined to this one for the rest of the round
 * @property {string} [gateLoss]   The Gate: the end the winner's losses come from first (the Gate's player's choice)
 * @property {boolean} [altar]     Spill Blood on the Altar (⎈ signature, designer 2026-10-18): at this round's fight here, the winner loses as many as the loser
 * @property {string} [terror]     Night Terrors (◐ signature, designer 2026-10-20): this player's mark; at nightfall 1 token here may flee
 * @property {string} [study]      Study the Bodies (ↂ signature, designer 2026-10-19): at this round's fight here, this player, if they lead, takes 1 from the runner-up's pile too
 */

/**
 * @typedef {object} PlayerState
 * @property {string} group          slayer group id
 * @property {number} supply         sway cubes not on the board or with a faction
 * @property {Record<string, number>} standing  faction → sway (public, IF1)
 * @property {Record<string, number>} trophies  faction → trophies (secret, IN2)
 * @property {string[]} hand         cards to play this round
 * @property {string[]} kept         draft: cards kept so far
 * @property {string[]} batch        draft: the batch in front of the player
 * @property {boolean} picked        draft: picked from this batch
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
 * @property {number} rngState
 * @property {Phase} phase
 * @property {number} round
 * @property {string[]} seating
 * @property {Record<string, PlayerState>} players
 * @property {string[]} factions   the faction in play for each archetype, spec.archetypes order (3.4)
 * @property {Record<string, Place>} board
 * @property {Record<string, number>} supply  faction → tokens in its supply
 * @property {string[]} leftOut    cards not dealt this round (DR5)
 * @property {number} pass         draft: which pick this is (1-based)
 * @property {string | null} first  this round's first player (FP2)
 * @property {number} turn         index into seating of the player to act
 * @property {number} passesInRow
 * @property {boolean} opened      the first player has opened with their marked card
 * @property {string | null} [copying]  Steal Their Playbook, theirs: the card taken, to be played now (D30)
 * @property {{ pid: string, card: string, use: string }[]} roundPlays  this round's plays, in order (Steal Their Playbook, unsuited, 2026-10-24)
 * @property {{ faction: string, left: number, leaders: string[], next: number, due: Record<string, number> } | null} growing  growth phase when a supply runs short
 * @property {{ player: string, left: string[] } | null} [night]  Night Terrors (◐ signature): nightfall, before the fights; the player's marks still to decide
 * @property {RoundLog[]} log
 * @property {{ side: 'island' | 'invaders', factions: string[], players: string[], scores: Record<string, number>, placings?: string[] } | null} result
 */

/**
 * What a card's turn action is aimed at. `mode` is the two-target rule
 * (3.7, principle 14): 'location' (a suit location, any faction) or
 * 'faction' (the suit's faction, anywhere). The other fields are used as
 * each card needs them.
 * @typedef {object} Target
 * @property {'location' | 'faction'} [mode]
 * @property {string} [location]
 * @property {string} [faction]
 * @property {string[]} [from]
 * @property {string} [to]
 * @property {string[]} [path]
 * @property {Record<string, number>} [split]
 * @property {{ location: string, faction: string, to: string }[]} [moves]
 * @property {string} [payer]      Invite Them In, the Gate, Wake the Dead: the faction whose standing pays
 * @property {string[]} [payers]   Plough Through: who pays each sway, one per exit (in order of first use), then the fight; the unsuited cards' standing picks
 * @property {string} [use]        an unsuited card with several uses (designer, 2026-10-23): the one played
 * @property {string} [back]       Steal Their Playbook, yours: the card taken back
 * @property {string} [losses]     the Gate: the end the winner's losses come from first
 */

/**
 * @typedef {{ type: 'pick', keep: string[] }
 *   | { type: 'play', card: string, use: 'action' | 'sway' | 'return', target?: Target | null, places?: string[] }
 *   | { type: 'pass' }
 *   | { type: 'grow', location: string }
 *   | { type: 'flee', location: string, faction?: string, to?: string, follow?: boolean }} Move
 */
/** @typedef {{ playerId: string, move: Move }} Submission */
/** @typedef {{ ok: true } | { ok: false, reason: string }} Verdict */

/**
 * What one seat may see (Appendix F.5).
 * @typedef {object} PlayerView
 * @property {string} you
 * @property {Options} options
 * @property {Phase} phase
 * @property {number} round
 * @property {number} rounds
 * @property {string[]} seating
 * @property {Record<string, { group: string, standing: Record<string, number>, supply: number, handSize: number, picked: boolean }>} players
 * @property {{ faction: string, left: number, leaders: string[], next: number, due: Record<string, number> } | null} growing
 * @property {{ player: string, left: string[] } | null} [night]
 * @property {string[]} factions
 * @property {Record<string, { tokens: Record<string, number>, sway: Record<string, number>, scorched: boolean, gate?: string, gateLoss?: string, altar?: boolean, study?: string, terror?: string }>} board
 * @property {Record<string, number>} supply
 * @property {string[]} deck  the game's cards
 * @property {Record<string, number>} printed  each card's sway for this seat now (swayFor)
 * @property {{ pid: string, card: string, use: string }[]} roundPlays  this round's plays
 * @property {string | null} first
 * @property {boolean} opened  the first player has opened with their marked card
 * @property {string | null} [copying]  a card taken with Steal Their Playbook, to be played now (D30)
 * @property {string | null} toAct
 * @property {RoundLog[]} log
 * @property {GameState['result']} result
 * @property {{ hand: string[], kept: string[], batch: string[], picked: boolean, trophies: Record<string, number> }} me
 */

/** @typedef {'trophy' | 'backer'} Profile */
/** @typedef {{ rng: () => number, profile?: Profile | string, memory?: BotMemory, table?: Record<string, string>, memories?: Record<string, BotMemory>, focus?: { card: string, target: Record<string, unknown> } }} BotOptions  table, memories: every seat's profile and memory, for play-outs (persona table); focus: the best move with that card, going on from that target (hints) */
/** What a bot remembers between its turns: its goal, and this game's variation in its lean. The caller keeps one per seat; a bot without it has no hysteresis. @typedef {{ goal?: Goal, jitter?: number }} BotMemory */
/** @typedef {'island' | 'invaders'} Goal */
/**
 * A bot's persona (profile numbers; rust/src/bots.rs).
 * @typedef {{ lean: number, jitter: number, hold: number, push: number, margin: number, linear: number, threat: number, enum: number, sim: number, combo: number, sets: number, table: number, commit: number, protect: number, top: number, race: number, even: number, plan: number, steer: number }} Persona
 */
/**
 * The next choice in building a card's target (nextChoice).
 * @typedef {{ kind: 'mode' } | { kind: 'location', key: 'location' | 'to' | 'path' | 'from' | 'losses', options: string[], optional?: boolean, left?: number }
 *   | { kind: 'group', key: 'group' | 'move', options: { location: string, faction: string }[], optional?: boolean }
 *   | { kind: 'faction', key?: 'faction' | 'to' | 'payer' | 'payers', options: string[], optional?: boolean }
 *   | { kind: 'use', key: 'use' | 'back', options: string[] }
 *   | { kind: 'split', options: string[], left: number } | { kind: 'done' }} Choice
 */

export class IllegalMoveError extends Error {
  /** @param {string} reason */
  constructor(reason) {
    super(reason);
    this.name = 'IllegalMoveError';
  }
}

// ---------------------------------------------------------------------------
// Content: lookups into spec.json, and a deep copy (no rules)
// ---------------------------------------------------------------------------

/** @type {Variant[]} */
export const variants = /** @type {Variant[]} */ (spec.variants);

const factionsById = new Map(spec.factions.map((faction) => [faction.id, faction]));
const locationsById = new Map(spec.locations.map((location) => [location.id, location]));
/** @type {Map<string, Card>} */
const cardsById = new Map(spec.cards.map((card) => [card.id, card]));

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

/** @param {string} id */
export function cardById(id) {
  const card = cardsById.get(id);
  if (!card) throw new Error(`unknown card ${id}`);
  return card;
}

/** The game's cards (the core deck). */
export const deckOf = () => spec.cards.map((card) => card.id);
/** A card's printed sway. @param {string} cardId */
export const printedOf = (cardId) => cardById(cardId).sway;
/** The faction in play for an archetype. @param {GameState | PlayerView} state @param {string} archetype */
export const factionOfArchetype = (state, archetype) => state.factions[spec.archetypes.findIndex((a) => a.id === archetype)];

/**
 * A deep copy of plain game data (objects, arrays, primitives: all a game state holds).
 * @template T @param {T} x @returns {T}
 */
export function clone(x) {
  if (x === null || typeof x !== 'object') return x;
  if (Array.isArray(x)) {
    const n = x.length, a = new Array(n);
    for (let i = 0; i < n; i++) a[i] = clone(x[i]);
    return /** @type {T} */ (/** @type {unknown} */ (a));
  }
  /** @type {Record<string, unknown>} */
  const o = {};
  for (const k in x) o[k] = clone(/** @type {Record<string, unknown>} */ (x)[k]);
  return /** @type {T} */ (o);
}

// ---------------------------------------------------------------------------
// The bridge to the Rust engine (rust/src/wasm.rs)
// ---------------------------------------------------------------------------

/** @type {WebAssembly.Module | null} */
let compiled = null;
/** @type {{ memory: WebAssembly.Memory, motw_alloc: (n: number) => number, motw_call: (p: number, n: number) => number, motw_out_len: () => number } | null} */
let rust = null;
/** The rng a bot call draws from (the caller's). */
let draw = Math.random;
/** A panic's message, handed over by the module before it traps. */
let panic = '';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** The compiled module, for a host that loads it itself (the Worker imports motw.wasm). @param {WebAssembly.Module} m */
export function useModule(m) {
  compiled = m;
  rust = null;
}

/** Compiling and the module's own address, for the browser and Node (a Worker may not compile at run time). */
const host = /** @type {{ compile: (b: ArrayBuffer) => Promise<WebAssembly.Module>, Module: new (b: Uint8Array) => WebAssembly.Module }} */ (/** @type {unknown} */ (WebAssembly));
const here = () => new URL('./motw.wasm', /** @type {{ url: string }} */ (/** @type {unknown} */ (import.meta)).url);

if ('document' in globalThis) {
  const res = await fetch(here());
  if (!res.ok) throw new Error(`motw.wasm: ${res.status}`);
  compiled = await host.compile(await res.arrayBuffer());
}

function instance() {
  if (rust) return rust;
  if (!compiled) {
    // Node (scripts, tests): read beside this file.
    const fs = /** @type {{ process?: { getBuiltinModule?: (id: string) => { readFileSync: (url: URL) => Uint8Array } } }} */ (globalThis).process?.getBuiltinModule?.('node:fs');
    if (!fs) throw new Error('the rules module (motw.wasm) is not loaded');
    compiled = new host.Module(fs.readFileSync(here()));
  }
  const env = {
    random: () => draw(),
    /** @param {number} ptr @param {number} len */
    panicked: (ptr, len) => { panic = decoder.decode(new Uint8Array(/** @type {NonNullable<typeof rust>} */ (rust).memory.buffer, ptr, len)); },
  };
  rust = /** @type {NonNullable<typeof rust>} */ (/** @type {unknown} */ (new WebAssembly.Instance(/** @type {WebAssembly.Module} */ (compiled), { env }).exports));
  return rust;
}

/**
 * One call into the engine: the arguments go over as JSON, the answer comes back parsed. A refused move throws
 * IllegalMoveError; anything else wrong throws an Error (after a panic, the module is started afresh).
 * @param {string} fn @param {unknown[]} args @returns {any}
 */
function call(fn, ...args) {
  const r = instance();
  const bytes = encoder.encode(JSON.stringify({ fn, args }));
  const ptr = r.motw_alloc(bytes.length);
  new Uint8Array(r.memory.buffer, ptr, bytes.length).set(bytes);
  let out;
  try {
    out = r.motw_call(ptr, bytes.length);
  } catch (error) {
    rust = null;
    const why = panic || (error instanceof Error ? error.message : String(error));
    panic = '';
    throw new Error(`rules engine: ${fn}: ${why}`);
  }
  const answer = JSON.parse(decoder.decode(new Uint8Array(r.memory.buffer, out, r.motw_out_len())));
  if ('err' in answer) throw answer.illegal ? new IllegalMoveError(answer.err) : new Error(answer.err);
  return answer.ok;
}

/** A state without its log, for questions that never read it (the log is most of a state's text). @template {GameState | PlayerView} T @param {T} state @returns {T} */
const lean = (state) => (state && Array.isArray(state.log) && state.log.length ? { ...state, log: [] } : state);

/** Runs a bot call with the caller's rng. @template T @param {() => number} rng @param {() => T} f @returns {T} */
function drawing(rng, f) {
  const before = draw;
  draw = rng;
  try { return f(); } finally { draw = before; }
}

/** Writes a bot's memory back into the caller's object (the caller keeps one per seat). @param {BotMemory | undefined} memory @param {BotMemory | null} next */
function remember(memory, next) {
  if (!memory || !next) return;
  for (const k of Object.keys(memory)) delete /** @type {Record<string, unknown>} */ (memory)[k];
  Object.assign(memory, next);
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

/** @param {Partial<Options> | undefined} [raw] @returns {Options} */
export const resolveOptions = (raw = {}) => call('resolveOptions', raw);
/** @param {{ seed: number, players: string[], options?: Partial<Options> }} input @returns {GameState} */
export const createGame = (input) => call('createGame', input);
/** @param {GameState} state @param {Submission} submission @returns {Verdict} */
export const validate = (state, submission) => call('validate', lean(state), submission);
/** @param {GameState} state @param {Submission} submission @returns {GameState} */
export const applyMove = (state, submission) => call('applyMove', state, submission);
/** The copy of the state one seat may see (Appendix F.5). @param {GameState} state @param {string} playerId @returns {PlayerView} */
export const playerView = (state, playerId) => call('playerView', state, playerId);
/** Seats the current phase is waiting on. @param {GameState | PlayerView} state @returns {string[]} */
export const waitingOn = (state) => call('waitingOn', lean(state));
/** The next choice in building a card's target. @param {GameState | PlayerView} state @param {string} pid @param {string} cardId @param {Target} t @returns {Choice} */
export const nextChoice = (state, pid, cardId, t) => call('nextChoice', lean(state), pid, cardId, t);
/** Why a target is refused, or null. @param {GameState | PlayerView} state @param {string} pid @param {Card | string} card @param {Target | null | undefined} t @returns {string | null} */
export const checkTarget = (state, pid, card, t) => call('checkTarget', lean(state), pid, typeof card === 'string' ? card : card.id, t ?? null);
/** The board and players a finished target would leave. @param {GameState | PlayerView} state @param {string} pid @param {string} cardId @param {Target} t @returns {{ board: GameState['board'], players: GameState['players'] }} */
export const previewTarget = (state, pid, cardId, t) => call('previewTarget', lean(state), pid, cardId, t);
/** A target in words, for the table. @param {string} cardId @param {Target | null} t @returns {string} */
export const describeTarget = (cardId, t) => call('describeTarget', cardId, t ?? null);
/** A card's legal targets, up to `cap`. @param {GameState} state @param {string} pid @param {string} cardId @param {number} cap @param {boolean} [even] @returns {{ targets: Target[], complete: boolean }} */
export const listTargets = (state, pid, cardId, cap, even = false) => call('listTargets', lean(state), pid, cardId, cap, even);
/** A random legal target, or null. @param {GameState} state @param {string} pid @param {string} cardId @param {() => number} rng @returns {Target | null} */
export const sampleTarget = (state, pid, cardId, rng) => drawing(rng, () => call('sampleTarget', lean(state), pid, cardId));
/** A way back for factions: where its tokens may come back, how many at most. @param {GameState | PlayerView} state @param {string} pid @param {string} cardId @returns {{ spots: string[], max: number, faction: string }} */
export const returnRoom = (state, pid, cardId) => call('returnRoom', lean(state), pid, cardId);
/** Night Terrors: where each faction at a mark may flee. @param {GameState | PlayerView} state @param {string} loc @returns {{ faction: string, to: string[] }[]} */
export const fleeOptions = (state, loc) => call('fleeOptions', lean(state), loc);
/** One location's fight, on a copy. @param {GameState} state @param {string} loc @returns {GameState} */
export const resolveFight = (state, loc) => call('resolveFight', state, loc);
/** Several locations' fights in turn, on a copy. @param {GameState} state @param {string[]} locs @returns {GameState} */
export const resolveFights = (state, locs) => call('resolveFights', state, locs);
/** The locations that will fight at round end as things stand. @param {GameState} state @returns {string[]} */
export const fightsDue = (state) => call('fightsDue', lean(state));
/** Where a faction grows this round, and by how much. @param {GameState} state @param {string} faction @returns {Record<string, number>} */
export const growthDue = (state, faction) => call('growthDue', lean(state), faction);
/** The faction that controls a location, or null. @param {GameState | PlayerView} state @param {string} loc @returns {string | null} */
export const controllerOf = (state, loc) => call('controllerOf', lean(state), loc);
/** @param {GameState | PlayerView} state @param {string} faction @returns {number} */
export const presenceOf = (state, faction) => call('presenceOf', lean(state), faction);
/** @param {GameState | PlayerView} state @returns {number} */
export const totalPresence = (state) => call('totalPresence', lean(state));
/** A card's sway for a player now. @param {GameState | PlayerView} state @param {string} pid @param {string} cardId @returns {number} */
export const swayFor = (state, pid, cardId) => call('swayFor', lean(state), pid, cardId);
/** @typedef {{ label: string, met: boolean }} Condition  one thing an action needs, and whether it is met */
/** Why a card's reading can't be played: the conditions of the candidate that comes closest, or null for a card not yet described. @param {GameState | PlayerView} state @param {string} pid @param {string} cardId @param {'location' | 'faction'} mode @returns {Condition[] | null} */
export const readingConditions = (state, pid, cardId, mode) => call('readingConditions', lean(state), pid, cardId, mode);
/** A clicked group's conditions as a card's first pick, or null for a card not yet described. @param {GameState | PlayerView} state @param {string} pid @param {string} cardId @param {'location' | 'faction'} mode @param {string} loc @param {string} faction @returns {Condition[] | null} */
export const pickConditions = (state, pid, cardId, mode, loc, faction) => call('pickConditions', lean(state), pid, cardId, mode, loc, faction);
/** One step of the seeded generator (Appendix F.4). @param {number} state @returns {{ value: number, state: number }} */
export const nextRandom = (state) => call('nextRandom', state);
/** A seeded shuffle. @template T @param {T[]} items @param {number} rngState @returns {{ items: T[], rngState: number }} */
export const shuffle = (items, rngState) => call('shuffle', items, rngState);

// ---------------------------------------------------------------------------
// The bots
// ---------------------------------------------------------------------------

/** The bot profiles (Appendix F.9; the engine's list, checked by test/bots.test.js). @type {Profile[]} */
export const PROFILES = ['trophy', 'backer'];
/** The engine's own list of profiles. @returns {string[]} */
export const engineProfiles = () => call('profiles');
/** A profile with the slow search switched off. @param {string} profile @returns {string} */
export const fast = (profile) => call('fast', profile);
/** A profile's persona, or undefined. @param {string} profile @returns {Persona | undefined} */
export const personaOf = (profile) => call('personaOf', profile) ?? undefined;

/**
 * The move this bot should make right now, or null if it has nothing to do. Its memory is updated in place.
 * @param {GameState} state @param {{ playerId: string } & BotOptions} input @returns {Move | null}
 */
export function botMove(state, input) {
  const { rng, ...rest } = input;
  const answer = drawing(rng, () => call('botMove', lean(state), rest));
  remember(input.memory, answer.memory);
  return answer.move;
}

/** The chance of winning, by ending. @param {GameState} state @param {string} pid */
export const winChances = (state, pid) => /** @type {{ pInvaders: number, prior: number, known: number, backers: number, linearIsland: number, rivalInvaders: number, asInvaders: number, asIsland: number, marginInvaders: number, marginIsland: number, projected: number, threshold: number, spreadP: number, roundsLeft: number }} */ (call('winChances', lean(state), pid));
/** How good a position is for a seat. @param {GameState} state @param {string} pid @param {string} [profile] @param {Goal} [goal] @returns {number} */
export const evaluate = (state, pid, profile = 'trophy', goal) => call('evaluate', lean(state), pid, profile, goal ?? null);
/** A seat's position as numbers (a measuring tool). @param {GameState} state @param {string} pid @returns {Record<string, number>} */
export const features = (state, pid) => call('features', lean(state), pid);

/**
 * A hint's ranking: the seat's goal and its options ranked one move ahead (no noise, no play-outs). `memory` keeps
 * the goal between hints (updated in place).
 * @param {GameState} state @param {string} pid @param {BotMemory} memory @param {string} [profile]
 * @returns {{ goal: Goal, moves: { move: Move, s: GameState, v: number }[], worth: { card: string, v: number }[] }}
 */
export function rankForHint(state, pid, memory, profile = 'trophy:enum=1') {
  const answer = call('rankForHint', lean(state), pid, memory, profile);
  remember(memory, answer.memory);
  return { goal: answer.goal, moves: answer.moves, worth: answer.worth };
}

/** A state after a move played straight through (for hints). @param {GameState} state @param {string} pid @param {Move} move @returns {GameState} */
export const afterMove = (state, pid, move) => call('afterMove', state, pid, move);
