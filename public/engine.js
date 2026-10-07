// @ts-check
/**
 * Monster of the Week — pure game engine.
 *
 * Every exported function is pure: it takes a GameState (plus inputs) and
 * returns a new GameState or a derived value. Nothing here touches the network,
 * the DOM, or storage. The Durable Object uses it as the authority, the browser
 * uses it for previews, and the bot harness uses it for simulation.
 *
 * The rules are the first draft (docs/motw-design.md, Appendix G); the cards
 * are Set v2 (H.8) with scaffold placeholders for the six extras (H.6); the
 * numbers are first-draft guesses (G.7), each a variant in spec.json. Where a
 * card's text left a detail open, the reading used here is listed in G.8.
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
/** @typedef {'draft' | 'play' | 'growth' | 'ended'} Phase */

/**
 * A face-down token on a location (IN1). `card` is null for a bluff (BT1).
 * The owner's marker cube sits on it and counts as their influence (MC3).
 * @typedef {{ owner: string, card: string | null }} Token
 */

/**
 * @typedef {object} Place
 * @property {Record<string, number>} cubes      faction → cubes
 * @property {Record<string, number>} influence  player → influence placed here
 * @property {Token | null} token
 * @property {boolean} scorched
 */

/**
 * @typedef {object} PlayerState
 * @property {string} group          slayer group id
 * @property {number} supply         influence cubes not on the board or with a faction
 * @property {Record<string, number>} standing  faction → influence (public, IF1)
 * @property {Record<string, number>} trophies  faction → trophies (secret, IN2)
 * @property {number} bluffs         bluff tokens in hand
 * @property {string[]} hand         cards to play this round
 * @property {string[]} kept         draft: cards kept so far
 * @property {string[]} batch        draft: the batch in front of the player
 * @property {boolean} picked        draft: picked from this batch
 * @property {string[]} known        what this player has seen: "token:<loc>:<card|bluff>", "leftout"
 */

/**
 * A turn action announced and in progress (3.7, principle 5: responses fire
 * as it happens; the game never pauses).
 * @typedef {object} Pending
 * @property {string} player
 * @property {string} card
 * @property {Target | null} target
 * @property {boolean} cancelled
 * @property {string[]} blocked  locations nothing may be moved into
 * @property {string[]} responded players who have answered this action
 * @property {{ opened: boolean, passesInRow: number }} [before]  to put back if the card is taken back
 */

/** @typedef {{ type: string, player: string, faction?: string, location?: string, amount?: number }} GameEvent */

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
 * @property {Record<string, number>} supply  faction → cubes in its supply
 * @property {string[]} leftOut    cards not dealt this round (DR5)
 * @property {number} pass         draft: which pick this is (1-based)
 * @property {string | null} first  this round's first player (FP2)
 * @property {number} turn         index into seating of the player to act
 * @property {number} passesInRow
 * @property {boolean} opened      the first player has opened with their marked card
 * @property {Pending | null} pending
 * @property {GameEvent[]} events  what the last resolved action did, for "after" responses
 * @property {{ faction: string, left: number, leaders: string[], next: number, due: Record<string, number> } | null} growing  growth phase when a supply runs short
 * @property {RoundLog[]} log
 * @property {{ side: 'island' | 'invaders', factions: string[], players: string[], scores: Record<string, number> } | null} result
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
 * @property {string} [direction]
 * @property {string} [bluff]      where the bluff goes (hidden cards)
 * @property {boolean} [realOnly]  only one location was free: place the real token there (else the bluff)
 * @property {{ location: string, faction: string, to: string }[]} [moves]
 */

/**
 * @typedef {{ type: 'pick', keep: string[] }
 *   | { type: 'play', card: string, use: 'action' | 'influence', target?: Target | null }
 *   | { type: 'confirm' }
 *   | { type: 'withdraw' }
 *   | { type: 'pass' }
 *   | { type: 'respond', card: string, location?: string }
 *   | { type: 'grow', location: string }} Move
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
 * @property {Record<string, { group: string, standing: Record<string, number>, supply: number, bluffs: number, handSize: number, picked: boolean }>} players
 * @property {{ faction: string, leaders: string[], next: number, due: Record<string, number> } | null} growing
 * @property {string[]} factions
 * @property {Record<string, { cubes: Record<string, number>, influence: Record<string, number>, token: { owner: string } | null, scorched: boolean }>} board
 * @property {Record<string, number>} supply
 * @property {string | null} first
 * @property {boolean} opened  the first player has opened with their marked card
 * @property {string | null} toAct
 * @property {{ player: string, card: string, target: Target | null, cancelled: boolean, blocked: string[] } | null} pending
 * @property {RoundLog[]} log
 * @property {GameState['result']} result
 * @property {GameEvent[]} events  what the last action did (public), for responses
 * @property {{ hand: string[], kept: string[], batch: string[], picked: boolean, trophies: Record<string, number>, known: string[], leftOut: string[] | null }} me
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
/** @type {Map<string, Card>} */
const cardsById = new Map(spec.cards.map((card) => [card.id, card]));
/** @type {Record<string, { q: number, r: number, region: string, adjacent: string[], mirror: string | null }>} */
const MAP = spec.map.locations;
/** @type {Record<string, { neighbours: string[] }>} */
const REGIONS = spec.map.regions;
const LOCATION_IDS = spec.locations.map((location) => location.id);
const MARKS = ['A', 'B', 'C', 'D'];

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

/** @param {{ options: Options }} state @param {string} id */
const num = (state, id) => Number(state.options[id]);

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
// Board helpers
// ---------------------------------------------------------------------------

/** @param {GameState} state @param {string} loc */
const factionsAt = (state, loc) => Object.keys(state.board[loc].cubes).filter((f) => state.board[loc].cubes[f] > 0);
/** @param {GameState} state @param {string} loc @param {string} faction */
const cubesOf = (state, loc, faction) => state.board[loc].cubes[faction] ?? 0;
/** @param {string} loc */
const regionOf = (loc) => MAP[loc].region;
/** @param {GameState} state @param {string} faction */
export const presenceOf = (state, faction) => LOCATION_IDS.reduce((n, loc) => n + cubesOf(state, loc, faction), 0);
/** @param {GameState} state */
export const totalPresence = (state) => state.factions.reduce((n, f) => n + presenceOf(state, f), 0);
/** The faction in play for an archetype. @param {GameState | PlayerView} state @param {string} archetype */
export const factionOfArchetype = (state, archetype) => state.factions[spec.archetypes.findIndex((a) => a.id === archetype)];
/** @param {string} faction */
const archetypeOf = (faction) => factionById(faction).archetype;
/** @param {string} loc */
const alignmentOf = (loc) => locationById(loc).archetype;

/** A region is impassable once all its locations are scorched (3.1). @param {GameState} state @param {string} region */
const regionOpen = (state, region) => LOCATION_IDS.some((loc) => regionOf(loc) === region && !state.board[loc].scorched);

/**
 * May a faction's cubes be moved into this location? Not scorched, its region
 * still passable, and never a third faction (LL1).
 * @param {GameState} state @param {string} loc @param {string} faction @param {string[]} [blocked]
 */
export function canEnter(state, loc, faction, blocked = []) {
  const place = state.board[loc];
  if (!place || place.scorched || !regionOpen(state, regionOf(loc)) || blocked.includes(loc)) return false;
  const here = factionsAt(state, loc);
  return here.includes(faction) || here.length < 2;
}

/** Who controls a location (LC2): the faction with most cubes; a tie goes to the aligned faction, else no one. @param {GameState} state @param {string} loc */
export function controllerOf(state, loc) {
  const here = factionsAt(state, loc).sort((a, b) => cubesOf(state, loc, b) - cubesOf(state, loc, a));
  if (here.length === 0) return null;
  if (here.length === 1 || cubesOf(state, loc, here[0]) > cubesOf(state, loc, here[1])) return here[0];
  const aligned = here.find((f) => archetypeOf(f) === alignmentOf(loc));
  return aligned ?? null;
}

/** The player's slayer group archetype. @param {GameState | PlayerView} state @param {string} pid */
const affinityOf = (state, pid) => {
  const group = spec.slayerGroups.find((g) => g.id === state.players[pid].group);
  return group ? group.archetype : '';
};

/**
 * Influence leaders of a faction: the most standing; affinity breaks a tie
 * (AB1); otherwise all tied are leaders. 0 counts.
 * @param {GameState} state @param {string} faction
 */
export function influenceLeaders(state, faction) {
  const best = Math.max(...state.seating.map((pid) => state.players[pid].standing[faction] ?? 0));
  const tied = state.seating.filter((pid) => (state.players[pid].standing[faction] ?? 0) === best);
  const withAffinity = tied.filter((pid) => affinityOf(state, pid) === archetypeOf(faction));
  return withAffinity.length ? withAffinity : tied;
}

/**
 * Move cubes, placing 1 influence at the destination spent from the
 * player's standing with the faction moved, if they have any (3.7, CA2).
 * Returns the number moved (0 if it may not enter).
 * @param {GameState} state @param {string} pid @param {string} faction
 * @param {string} from @param {string} to @param {number} count @param {Set<string>} placedAt
 */
function move(state, pid, faction, from, to, count, placedAt) {
  const n = Math.min(count, cubesOf(state, from, faction));
  if (n <= 0 || from === to) return 0;
  if (!canEnter(state, to, faction, state.pending?.blocked ?? [])) return 0;
  state.board[from].cubes[faction] -= n;
  if (state.board[from].cubes[faction] === 0) delete state.board[from].cubes[faction];
  state.board[to].cubes[faction] = cubesOf(state, to, faction) + n;
  const key = `${to}:${faction}`;
  if (!placedAt.has(key) && (state.players[pid].standing[faction] ?? 0) > 0) {
    placedAt.add(key);
    state.players[pid].standing[faction] -= 1;
    state.board[to].influence[pid] = (state.board[to].influence[pid] ?? 0) + 1;
    state.events.push({ type: 'influence-placed', player: pid, faction, location: to });
  }
  return n;
}

// ---------------------------------------------------------------------------
// Setup (G.3)
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
 * @param {{ seed: number, players: string[], options?: Partial<Options> }} input
 * @returns {GameState}
 */
export function createGame(input) {
  const { min, max } = spec.meta.players;
  if (input.players.length < min || input.players.length > max) throw new Error(`a game seats ${min}–${max} players`);
  if (new Set(input.players).size !== input.players.length) throw new Error('player names must be unique');
  const options = resolveOptions(input.options);
  let rngState = input.seed | 0;
  // One faction picked at random from each archetype (3.4).
  const factions = spec.archetypes.map((archetype) => {
    const pool = spec.factions.filter((faction) => faction.archetype === archetype.id);
    const s = shuffle(pool, rngState);
    rngState = s.rngState;
    return s.items[0].id;
  });
  /** @type {Record<string, Place>} */
  const board = Object.fromEntries(LOCATION_IDS.map((loc) => [loc, { cubes: {}, influence: {}, token: null, scorched: false }]));
  /** @type {Record<string, number>} */
  const supply = {};
  for (const faction of factions) {
    // SD1: a random home location of the archetype's three gets 5; the others 1.
    const locs = spec.locations.filter((l) => l.archetype === archetypeOf(faction)).map((l) => l.id);
    const s = shuffle(locs, rngState);
    rngState = s.rngState;
    let placed = 0;
    for (const loc of s.items) {
      const n = loc === s.items[0] ? spec.constants.seeding.home : spec.constants.seeding.other;
      board[loc].cubes[faction] = n;
      placed += n;
    }
    supply[faction] = num({ options }, 'factionCubes') - placed;
  }
  let groups = spec.slayerGroups.map((g) => g.id);
  if (options.groups === 'random') {
    const s = shuffle(groups, rngState);
    rngState = s.rngState;
    groups = s.items;
  }
  /** @type {Record<string, PlayerState>} */
  const players = {};
  input.players.forEach((pid, i) => {
    const group = groups[i];
    const linked = factions.find((f) => archetypeOf(f) === spec.slayerGroups.find((g) => g.id === group)?.archetype) ?? factions[0];
    const start = num({ options }, 'startInfluence');
    players[pid] = {
      group, supply: num({ options }, 'playerCubes') - start, standing: Object.fromEntries(factions.map((f) => [f, f === linked ? start : 0])),
      trophies: Object.fromEntries(factions.map((f) => [f, 0])), bluffs: num({ options }, 'bluffs'),
      hand: [], kept: [], batch: [], picked: false, known: [],
    };
  });
  /** @type {GameState} */
  const state = {
    version: spec.meta.version, options, rngState, phase: 'draft', round: 1, seating: input.players.slice(), players, factions,
    board, supply, leftOut: [], pass: 1, first: null, turn: 0, passesInRow: 0, opened: false, pending: null, events: [], growing: null,
    log: [], result: null,
  };
  return deal(state);
}

/** Start a round's draft: shuffle all 21 cards, deal hands, leave the rest out (PS1, DR4, DR5). @param {GameState} state */
function deal(state) {
  const handSize = /** @type {Record<string, number>} */ (spec.constants.handSize)[String(state.seating.length)];
  const s = shuffle(spec.cards.map((card) => card.id), state.rngState);
  state.rngState = s.rngState;
  state.seating.forEach((pid, i) => {
    const p = state.players[pid];
    p.batch = s.items.slice(i * handSize, (i + 1) * handSize);
    p.kept = [];
    p.hand = [];
    p.picked = false;
    p.known = p.known.filter((k) => k.startsWith('token:'));
  });
  state.leftOut = s.items.slice(state.seating.length * handSize);
  state.phase = 'draft';
  state.pass = 1;
  state.pending = null;
  state.events = [];
  logLine(state, `Round ${state.round}: cards dealt, ${state.leftOut.length} left out unseen.`);
  return state;
}

/** @param {GameState} state @param {string} line */
function logLine(state, line) {
  let entry = state.log.find((e) => e.round === state.round);
  if (!entry) {
    entry = { round: state.round, events: [] };
    state.log.push(entry);
  }
  entry.events.push(line);
}

// ---------------------------------------------------------------------------
// Targets: the two-target rule and each card's action (G.8)
// ---------------------------------------------------------------------------

/** @param {GameState} state @param {Card} card */
const suitFaction = (state, card) => (card.suit ? factionOfArchetype(state, card.suit) : null);
/** @param {Card} card */
const suitLocations = (card) => spec.locations.filter((l) => l.archetype === card.suit).map((l) => l.id);

/**
 * Is (location, faction) a legal group target under the two-target rule?
 * @param {GameState} state @param {Card} card @param {Target} t
 */
function groupTarget(state, card, t) {
  if (!t.location || !t.faction || cubesOf(state, t.location, t.faction) <= 0) return 'Choose a group on the board.';
  if (!card.suit) return null;
  if (t.mode === 'location') return suitLocations(card).includes(t.location) ? null : 'That location is not one of the suit\'s.';
  if (t.mode === 'faction') return t.faction === suitFaction(state, card) ? null : 'That group is not the suit\'s faction.';
  return 'Choose a location target or a faction target.';
}

/**
 * Is a location a legal destination target? Location mode: a suit location
 * (any faction). Faction mode: any location (the suit's faction moves).
 * @param {GameState} state @param {Card} card @param {Target} t
 */
function placeTarget(state, card, t) {
  if (!t.location || !state.board[t.location] || state.board[t.location].scorched) return 'Choose a location on the board.';
  if (!card.suit) return null;
  if (t.mode === 'location') return suitLocations(card).includes(t.location) ? null : 'That location is not one of the suit\'s.';
  if (t.mode === 'faction') return null;
  return 'Choose a location target or a faction target.';
}

/** The factions a destination card may move: any (location mode) or only the suit's (faction mode). @param {GameState} state @param {Card} card @param {Target} t */
const movable = (state, card, t) => (card.suit && t.mode === 'faction' ? [/** @type {string} */ (suitFaction(state, card))] : state.factions.slice());

/** Free locations for a hidden token under the two-target rule (3.11). @param {GameState} state @param {Card} card @param {'location' | 'faction'} mode */
function tokenSpots(state, card, mode) {
  const sf = suitFaction(state, card);
  return LOCATION_IDS.filter((loc) => !state.board[loc].token && !state.board[loc].scorched
    && (mode === 'location' ? suitLocations(card).includes(loc) : cubesOf(state, loc, /** @type {string} */ (sf)) > 0));
}

/**
 * Check a target for a card's turn action. Returns an error, or null.
 * @param {GameState} state @param {string} pid @param {Card} card @param {Target | null | undefined} t
 */
export function checkTarget(state, pid, card, t) {
  if (!card.action) return 'This card has no turn action.';
  if (!t) return null; // a card with no legal target may be played for no effect (partial actions)
  switch (card.action) {
    case 'lure': return placeTarget(state, card, t);
    case 'sow': return groupTarget(state, card, t) ?? (t.path === undefined || Array.isArray(t.path) ? null : 'Choose a path.');
    case 'token': {
      if (t.mode !== 'location' && t.mode !== 'faction') return 'Choose a location target or a faction target.';
      const spots = tokenSpots(state, card, t.mode);
      if (!t.location || !spots.includes(t.location)) return 'That location can\'t take a token.';
      if (t.bluff && (!spots.includes(t.bluff) || t.bluff === t.location)) return 'The bluff can\'t go there.';
      if (t.bluff && state.players[pid].bluffs <= 0) return 'You have no bluff tokens left.';
      if (state.players[pid].supply <= 0) return 'You have no cube in your supply to mark the token.';
      return null;
    }
    case 'broadcast': {
      const e = placeTarget(state, card, t);
      if (e) return e;
      if (!t.faction || !movable(state, card, t).includes(t.faction)) return 'Choose which faction answers.';
      if (!t.from || t.from.length < 1 || t.from.length > 2 || t.from.some((l) => cubesOf(state, l, /** @type {string} */ (t.faction)) <= 0 || l === t.location)) return 'Choose one or two locations holding that faction.';
      return null;
    }
    case 'halve': case 'teleport': case 'spread': case 'split': {
      const e = groupTarget(state, card, t);
      if (e) return e;
      const loc = /** @type {string} */ (t.location), f = /** @type {string} */ (t.faction);
      if (card.action === 'halve') return cubesOf(state, loc, f) >= 2 && t.to && MAP[loc].adjacent.includes(t.to) ? null : 'Half needs a group of 2 or more and an adjacent destination.';
      if (card.action === 'teleport') return t.to && t.to !== loc && state.board[t.to] ? null : 'Choose where to set it down.';
      if (card.action === 'split') {
        const split = t.split ?? {};
        const dests = Object.keys(split).filter((d) => split[d] > 0);
        if (dests.length < 2 || dests.some((d) => !MAP[loc].adjacent.includes(d))) return 'Split across at least two adjacent locations.';
        if (dests.reduce((n, d) => n + split[d], 0) !== cubesOf(state, loc, f)) return 'Every cube must go somewhere.';
      }
      return null;
    }
    case 'gather-region': case 'gather-neighbours': case 'draw-adjacent': {
      const e = placeTarget(state, card, t);
      if (e) return e;
      if (card.action !== 'draw-adjacent' && (!t.faction || !movable(state, card, t).includes(t.faction))) return 'Choose which faction moves.';
      return null;
    }
    case 'conveyor': {
      if (!spec.map.directions.some((d) => d.id === t.direction)) return 'Choose a direction.';
      if (t.mode === 'location') return t.location && suitLocations(card).includes(t.location) ? null : 'Choose one of the suit\'s locations (its region moves).';
      return t.mode === 'faction' ? null : 'Choose a location target or a faction target.';
    }
    case 'drive-out': {
      if (!t.location || factionsAt(state, t.location).length !== 2 || !t.faction || cubesOf(state, t.location, t.faction) <= 0) return 'Choose a faction at a contested location.';
      if (t.mode === 'location') {
        if (!suitLocations(card).includes(t.location)) return 'That location is not one of the suit\'s.';
        const [a, b] = factionsAt(state, t.location);
        const smaller = cubesOf(state, t.location, a) <= cubesOf(state, t.location, b) ? a : b;
        if (cubesOf(state, t.location, t.faction) > cubesOf(state, t.location, smaller)) return 'Only the smaller faction can be driven out.';
      } else if (t.mode === 'faction') {
        if (t.faction !== suitFaction(state, card)) return 'Only the suit\'s faction.';
      } else return 'Choose a location target or a faction target.';
      return t.to && MAP[t.location].adjacent.includes(t.to) ? null : 'Choose an adjacent location to drive them to.';
    }
    case 'move-two': case 'move-one': case 'move-half': case 'move-far': {
      const moves = t.moves ?? [];
      const max = card.action === 'move-two' ? 2 : 1;
      if (moves.length < 1 || moves.length > max) return `Choose ${max === 2 ? 'one or two groups' : 'a group'} to move.`;
      for (const m of moves) {
        if (cubesOf(state, m.location, m.faction) <= 0) return 'Choose a group on the board.';
        const reach = card.action === 'move-far' ? twoHex(m.location) : MAP[m.location].adjacent;
        if (!reach.includes(m.to)) return 'That is too far.';
      }
      return null;
    }
    default: return 'Unknown card.';
  }
}

/** Locations within two hexes. @param {string} loc */
const twoHex = (loc) => [...new Set(MAP[loc].adjacent.flatMap((a) => [a, ...MAP[a].adjacent]))].filter((l) => l !== loc);

/** @param {GameState} state @param {string} loc @param {string} dir */
function step(state, loc, dir) {
  const d = spec.map.directions.find((x) => x.id === dir);
  if (!d) return null;
  const { q, r } = MAP[loc];
  return LOCATION_IDS.find((l) => MAP[l].q === q + d.dq && MAP[l].r === r + d.dr) ?? null;
}

/**
 * Carry out a card's turn action. Mutates `state` (a clone).
 * @param {GameState} state @param {string} pid @param {Card} card @param {Target} t
 */
function act(state, pid, card, t) {
  /** @type {Set<string>} */
  const placed = new Set();
  const names = (/** @type {string} */ f) => factionById(f).name;
  const lname = (/** @type {string} */ l) => locationById(l).name;
  switch (card.action) {
    case 'lure': {
      const to = /** @type {string} */ (t.location);
      const groups = MAP[to].adjacent.flatMap((from) => movable(state, card, t).map((f) => ({ from, f, n: cubesOf(state, from, f) })))
        .filter((g) => g.n > 0 && canEnter(state, to, g.f, state.pending?.blocked)).sort((a, b) => b.n - a.n);
      const pick = (t.faction && t.from?.[0] ? groups.find((g) => g.f === t.faction && g.from === t.from?.[0] && g.n === groups[0].n) : null) ?? groups[0];
      if (pick) logLine(state, `${pid}: ${card.name} draws ${move(state, pid, pick.f, pick.from, to, pick.n, placed)} ${names(pick.f)} into ${lname(to)}.`);
      break;
    }
    case 'sow': {
      // The whole group sets off; each location entered gets 1 cube and 1 of
      // the player's influence; the chase stops at a location it can't enter
      // or when the player's influence with that faction runs out; leftover
      // cubes stay together at the last location entered.
      const f = /** @type {string} */ (t.faction), start = /** @type {string} */ (t.location);
      let left = cubesOf(state, start, f);
      delete state.board[start].cubes[f];
      let at = start;
      const visited = [];
      for (const next of t.path ?? []) {
        if (left <= 0 || !MAP[at].adjacent.includes(next) || !canEnter(state, next, f, state.pending?.blocked) || (state.players[pid].standing[f] ?? 0) <= 0) break;
        state.board[next].cubes[f] = cubesOf(state, next, f) + 1;
        state.players[pid].standing[f] -= 1;
        state.board[next].influence[pid] = (state.board[next].influence[pid] ?? 0) + 1;
        state.events.push({ type: 'influence-placed', player: pid, faction: f, location: next });
        left -= 1;
        visited.push(next);
        at = next;
      }
      if (left > 0) state.board[at].cubes[f] = cubesOf(state, at, f) + left;
      logLine(state, visited.length ? `${pid}: ${card.name} chases ${names(f)} through ${visited.map(lname).join(', ')}.` : `${pid}: ${card.name} finds no trail.`);
      break;
    }
    case 'token': {
      const p = state.players[pid];
      const loc = /** @type {string} */ (t.location);
      const real = t.realOnly !== false;
      if (real || !t.bluff) {
        state.board[loc].token = { owner: pid, card: real ? card.id : null };
        if (!real) p.bluffs -= 1;
        p.supply -= 1;
        state.board[loc].influence[pid] = (state.board[loc].influence[pid] ?? 0) + 1;
        state.events.push({ type: 'token-placed', player: pid, location: loc });
      }
      if (t.bluff && p.bluffs > 0 && p.supply > 0) {
        state.board[t.bluff].token = { owner: pid, card: null };
        p.bluffs -= 1;
        p.supply -= 1;
        state.board[t.bluff].influence[pid] = (state.board[t.bluff].influence[pid] ?? 0) + 1;
        state.events.push({ type: 'token-placed', player: pid, location: t.bluff });
      }
      logLine(state, `${pid} places a face-down token${t.bluff ? 's at ' + lname(loc) + ' and ' + lname(t.bluff) : ' at ' + lname(loc)}.`);
      break;
    }
    case 'broadcast': {
      const f = /** @type {string} */ (t.faction);
      let n = 0;
      for (const from of t.from ?? []) n += move(state, pid, f, from, /** @type {string} */ (t.location), cubesOf(state, from, f), placed);
      logLine(state, `${pid}: ${card.name} calls ${n} ${names(f)} into ${lname(/** @type {string} */ (t.location))}.`);
      break;
    }
    case 'halve': {
      const f = /** @type {string} */ (t.faction), from = /** @type {string} */ (t.location);
      const n = move(state, pid, f, from, /** @type {string} */ (t.to), Math.floor(cubesOf(state, from, f) / 2), placed);
      logLine(state, `${pid}: ${card.name} sends ${n} ${names(f)} from ${lname(from)} to ${lname(/** @type {string} */ (t.to))}.`);
      break;
    }
    case 'teleport': {
      const f = /** @type {string} */ (t.faction), from = /** @type {string} */ (t.location);
      const n = move(state, pid, f, from, /** @type {string} */ (t.to), cubesOf(state, from, f), placed);
      logLine(state, `${pid}: ${card.name} lifts ${n} ${names(f)} from ${lname(from)} to ${lname(/** @type {string} */ (t.to))}.`);
      break;
    }
    case 'spread': {
      const f = /** @type {string} */ (t.faction), from = /** @type {string} */ (t.location);
      const reached = [];
      for (const to of MAP[from].adjacent) {
        if (cubesOf(state, from, f) <= 0) break;
        if (move(state, pid, f, from, to, 1, placed)) reached.push(to);
      }
      logLine(state, `${pid}: ${card.name} spreads ${names(f)} into ${reached.map(lname).join(', ') || 'nowhere'}.`);
      break;
    }
    case 'gather-region': case 'gather-neighbours': {
      const f = /** @type {string} */ (t.faction), to = /** @type {string} */ (t.location);
      const regions = card.action === 'gather-region' ? [regionOf(to)] : REGIONS[regionOf(to)].neighbours;
      let n = 0;
      for (const from of LOCATION_IDS.filter((l) => regions.includes(regionOf(l)) && l !== to)) n += move(state, pid, f, from, to, cubesOf(state, from, f), placed);
      logLine(state, `${pid}: ${card.name} gathers ${n} ${names(f)} into ${lname(to)}.`);
      break;
    }
    case 'draw-adjacent': {
      const to = /** @type {string} */ (t.location);
      const groups = MAP[to].adjacent.flatMap((from) => movable(state, card, t).map((f) => ({ from, f, n: cubesOf(state, from, f) }))).filter((g) => g.n > 0).sort((a, b) => b.n - a.n);
      let n = 0;
      for (const g of groups) n += move(state, pid, g.f, g.from, to, g.n, placed);
      logLine(state, `${pid}: ${card.name} draws ${n} cubes into ${lname(to)}.`);
      break;
    }
    case 'split': {
      const f = /** @type {string} */ (t.faction), from = /** @type {string} */ (t.location);
      for (const [to, n] of Object.entries(t.split ?? {})) move(state, pid, f, from, to, n, placed);
      logLine(state, `${pid}: ${card.name} turns ${names(f)} away from ${lname(from)}.`);
      break;
    }
    case 'conveyor': {
      const region = t.mode === 'location' ? regionOf(/** @type {string} */ (t.location)) : null;
      const sf = suitFaction(state, card);
      const groups = LOCATION_IDS.flatMap((loc) => factionsAt(state, loc).map((f) => ({ loc, f })))
        .filter((g) => (region ? regionOf(g.loc) === region : g.f === sf));
      let moved = 0;
      for (const g of groups) {
        const to = step(state, g.loc, /** @type {string} */ (t.direction));
        if (to) moved += move(state, pid, g.f, g.loc, to, cubesOf(state, g.loc, g.f), placed) ? 1 : 0;
      }
      logLine(state, `${pid}: ${card.name} shifts ${moved} group${moved === 1 ? '' : 's'} ${t.direction}.`);
      break;
    }
    case 'drive-out': {
      const f = /** @type {string} */ (t.faction), from = /** @type {string} */ (t.location);
      const n = move(state, pid, f, from, /** @type {string} */ (t.to), cubesOf(state, from, f), placed);
      logLine(state, `${pid}: ${card.name} drives ${n} ${names(f)} out of ${lname(from)}.`);
      break;
    }
    case 'move-two': case 'move-one': case 'move-half': case 'move-far': {
      for (const m of t.moves ?? []) {
        const n = card.action === 'move-half' ? Math.floor(cubesOf(state, m.location, m.faction) / 2) : cubesOf(state, m.location, m.faction);
        const got = move(state, pid, m.faction, m.location, m.to, n, placed);
        if (got) logLine(state, `${pid}: ${card.name} moves ${got} ${names(m.faction)} to ${lname(m.to)}.`);
      }
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** @param {string} reason @returns {Verdict} */
const no = (reason) => ({ ok: false, reason });
/** @type {Verdict} */
const OK = { ok: true };

/** Whose turn it is in the play phase. @param {GameState} state */
const toAct = (state) => (state.phase === 'play' ? state.seating[state.turn] : null);

/**
 * Does a response's trigger match what is happening now?
 * @param {GameState} state @param {string} pid @param {NonNullable<Card['response']>} response @param {string | undefined} location
 */
function triggerMatches(state, pid, response, location) {
  const pend = state.pending;
  switch (response.trigger) {
    case 'card-played': return !!pend && pend.player !== pid && !pend.cancelled;
    case 'move-into-your-location':
      return !!pend && pend.player !== pid && !pend.cancelled && !!location && (state.board[location]?.influence[pid] ?? 0) > 0
        && pendingDestinations(state, pend).includes(location) && !pend.blocked.includes(location);
    case 'token-placed': return state.events.some((e) => e.type === 'token-placed' && e.player !== pid && (!location || e.location === location));
    case 'influence-spent': return state.events.some((e) => e.type === 'influence-spent' && e.player !== pid);
    case 'influence-placed': return state.events.some((e) => e.type === 'influence-placed' && e.player !== pid);
    case 'pass': return state.events.some((e) => e.type === 'pass' && e.player !== pid);
    default: return false;
  }
}

/** Where a pending action would move cubes into (for blocks). @param {GameState | PlayerView} state @param {{ card: string, target: Target | null }} pend */
export function pendingDestinations(state, pend) {
  const t = pend.target;
  if (!t) return [];
  const card = cardById(pend.card);
  switch (card.action) {
    case 'lure': case 'broadcast': case 'gather-region': case 'gather-neighbours': case 'draw-adjacent': return t.location ? [t.location] : [];
    case 'halve': case 'teleport': case 'drive-out': return t.to ? [t.to] : [];
    case 'sow': return t.path ?? [];
    case 'split': return Object.keys(t.split ?? {});
    case 'spread': return t.location ? MAP[t.location].adjacent : [];
    case 'conveyor': return LOCATION_IDS;
    case 'move-two': case 'move-one': case 'move-half': case 'move-far': return (t.moves ?? []).map((m) => m.to);
    default: return [];
  }
}

/**
 * @param {GameState} state
 * @param {Submission} submission
 * @returns {Verdict}
 */
export function validate(state, submission) {
  const { playerId: pid, move: m } = submission;
  const p = state.players[pid];
  if (!p) return no('You are not seated at this table.');
  if (state.phase === 'ended') return no('The game is over.');
  if (!m || typeof m !== 'object') return no('That is not a move.');
  if (m.type === 'respond') {
    if (state.phase !== 'play') return no('Responses are played during the play phase.');
    if (!p.hand.includes(m.card)) return no('That card is not in your hand.');
    const response = cardById(m.card).response;
    if (!response) return no('That card has no response.');
    if (state.pending && state.pending.responded.includes(pid) && response.timing === 'before') return no('You have already answered this action.');
    return triggerMatches(state, pid, response, m.location) ? OK : no('Nothing has happened that this response answers.');
  }
  if (state.phase === 'draft') {
    if (m.type !== 'pick') return no('Pick cards in the draft.');
    if (p.picked) return no('You have already picked from this batch.');
    const pool = [...p.kept, ...p.batch];
    const keep = m.keep ?? [];
    if (keep.length !== p.kept.length + 1) return no(`Keep ${p.kept.length + 1} cards.`);
    if (new Set(keep).size !== keep.length || keep.some((c) => !pool.includes(c))) return no('Keep cards from your kept cards and this batch.');
    return OK;
  }
  if (state.phase === 'growth') {
    if (m.type !== 'grow' || !state.growing) return no('Choose where the faction grows.');
    if (state.growing.leaders[state.growing.next % state.growing.leaders.length] !== pid) return no('Another influence leader places this cube.');
    return (state.growing.due[m.location] ?? 0) > 0 ? OK : no('That location doesn\'t grow.');
  }
  if (state.phase !== 'play') return no('That move does not belong in this phase.');
  if (state.pending) {
    if (m.type === 'withdraw') {
      if (state.pending.player !== pid) return no('Only the acting player can take it back.');
      return state.pending.responded.length || state.pending.cancelled || state.pending.blocked.length ? no('Someone has answered it; it is locked in.') : OK;
    }
    if (m.type !== 'confirm') return no('An action is in progress.');
    return state.pending.player === pid ? OK : no('Only the acting player confirms.');
  }
  if (toAct(state) !== pid) return no('It is not your turn.');
  if (m.type === 'pass') {
    if (!state.opened && pid === state.first && p.hand.some((c) => cardById(c).marked)) return no('The first player opens with their marked card.');
    return OK;
  }
  if (m.type !== 'play') return no('Play a card or pass.');
  if (!p.hand.includes(m.card)) return no('That card is not in your hand.');
  const card = cardById(m.card);
  if (!state.opened && pid === state.first) {
    const mine = p.hand.filter((c) => cardById(c).marked).sort((a, b) => MARKS.indexOf(cardById(a).marked ?? '') - MARKS.indexOf(cardById(b).marked ?? ''));
    if (mine.length && m.card !== mine[0]) return no('The first player opens with their marked card.');
  }
  if (m.use === 'influence') {
    if (!card.suit) return no('Unsuited cards have no influence use.');
    return p.supply > 0 ? OK : no('Your supply is empty.');
  }
  if (m.use !== 'action') return no('Choose the action or the influence.');
  const e = checkTarget(state, pid, card, m.target ?? null);
  if (e) return no(e);
  return OK;
}

// ---------------------------------------------------------------------------
// Applying moves
// ---------------------------------------------------------------------------

/**
 * Validates, copies, changes the copy, and runs any automatic steps.
 * @param {GameState} state
 * @param {Submission} submission
 * @returns {GameState}
 */
export function applyMove(state, submission) {
  const verdict = validate(state, submission);
  if (!verdict.ok) throw new IllegalMoveError(verdict.reason);
  /** @type {GameState} */
  const next = structuredClone(state);
  const { playerId: pid, move: m } = submission;
  const p = next.players[pid];
  switch (m.type) {
    case 'pick': {
      const pool = [...p.kept, ...p.batch];
      p.kept = m.keep.slice();
      p.batch = pool.filter((c) => !m.keep.includes(c));
      p.picked = true;
      if (next.seating.every((id) => next.players[id].picked)) passBatches(next);
      return next;
    }
    case 'respond': return respond(next, pid, m.card, m.location);
    case 'grow': return growOne(next, m.location);
    case 'pass': {
      next.events = [{ type: 'pass', player: pid }];
      next.passesInRow += 1;
      logLine(next, `${pid} passes.`);
      if (next.passesInRow >= next.seating.length) return endOfPlay(next);
      next.turn = (next.turn + 1) % next.seating.length;
      return next;
    }
    case 'play': {
      p.hand = p.hand.filter((c) => c !== m.card);
      next.passesInRow = 0;
      next.events = [];
      if (pid === next.first) next.opened = true;
      const card = cardById(m.card);
      if (m.use === 'influence') {
        const faction = factionOfArchetype(next, /** @type {string} */ (card.suit));
        const gain = Math.min(card.influence, p.supply);
        p.supply -= gain;
        p.standing[faction] += gain;
        next.events.push({ type: 'influence-spent', player: pid, faction, amount: gain });
        logLine(next, `${pid} plays ${card.name} for ${gain} influence with ${factionById(faction).name}.`);
        next.turn = (next.turn + 1) % next.seating.length;
        return next;
      }
      next.pending = { player: pid, card: m.card, target: m.target ?? null, cancelled: false, blocked: [], responded: [], before: { opened: state.opened, passesInRow: state.passesInRow } };
      logLine(next, `${pid} plays ${card.name}.`);
      return next;
    }
    case 'withdraw': {
      // Taken back before anyone answered: the card returns to hand (web prototype convenience).
      const pend = /** @type {Pending} */ (next.pending);
      p.hand.push(pend.card);
      next.opened = pend.before?.opened ?? next.opened;
      next.passesInRow = pend.before?.passesInRow ?? next.passesInRow;
      next.pending = null;
      logLine(next, `${pid} takes back ${cardById(pend.card).name}.`);
      return next;
    }
    case 'confirm': {
      const pend = /** @type {Pending} */ (next.pending);
      const card = cardById(pend.card);
      if (pend.cancelled) logLine(next, `${card.name} is cancelled.`);
      else if (pend.target) act(next, pid, card, pend.target);
      else logLine(next, `${card.name} has nothing to act on.`);
      next.pending = null;
      next.turn = (next.turn + 1) % next.seating.length;
      return next;
    }
  }
  return next;
}

/** Everyone has picked: pass the rest on (to the next seat); when the batches are empty the draft is over. @param {GameState} state */
function passBatches(state) {
  const batches = state.seating.map((id) => state.players[id].batch);
  state.seating.forEach((id, i) => {
    const p = state.players[id];
    p.batch = batches[(i - 1 + state.seating.length) % state.seating.length];
    p.picked = false;
  });
  state.pass += 1;
  // The last card of each batch has no choice to it: everyone keeps it at once.
  if (state.seating.every((id) => state.players[id].batch.length === 1)) {
    for (const id of state.seating) {
      const p = state.players[id];
      p.kept = [...p.kept, ...p.batch];
      p.batch = [];
    }
  }
  if (state.seating.every((id) => state.players[id].batch.length === 0)) startPlay(state);
}

/** The draft is done: hands are the kept cards; the earliest marked card dealt sets the first player (FP2). @param {GameState} state */
function startPlay(state) {
  for (const id of state.seating) {
    state.players[id].hand = state.players[id].kept;
    state.players[id].kept = [];
  }
  const first = MARKS.map((mark) => state.seating.find((id) => state.players[id].hand.some((c) => cardById(c).marked === mark))).find(Boolean)
    ?? state.seating[(state.round - 1) % state.seating.length];
  state.first = first;
  state.turn = state.seating.indexOf(first);
  state.opened = !state.players[first].hand.some((c) => cardById(c).marked);
  state.passesInRow = 0;
  state.phase = 'play';
  logLine(state, `Draft done. ${first} goes first.`);
}

/** @param {GameState} state @param {string} pid @param {string} cardId @param {string | undefined} location */
function respond(state, pid, cardId, location) {
  const p = state.players[pid];
  p.hand = p.hand.filter((c) => c !== cardId);
  const response = /** @type {NonNullable<Card['response']>} */ (cardById(cardId).response);
  const pend = state.pending;
  if (pend) pend.responded.push(pid);
  logLine(state, `${pid} answers with ${response.name}.`);
  switch (response.id) {
    case 'cancel': if (pend) pend.cancelled = true; break;
    case 'never-invite': if (pend && location) pend.blocked.push(location); break;
    case 'classified': {
      const e = state.events.find((x) => x.type === 'token-placed' && x.player !== pid && (!location || x.location === location));
      const tok = e?.location ? state.board[e.location].token : null;
      if (e?.location && tok) p.known.push(`token:${e.location}:${tok.card ?? 'bluff'}`);
      break;
    }
    case 'pull-plug': {
      const e = state.events.find((x) => x.type === 'influence-spent' && x.player !== pid);
      if (e?.faction) {
        const target = state.players[e.player];
        if ((target.standing[e.faction] ?? 0) > 0 && (e.amount ?? 0) > 1) {
          target.standing[e.faction] -= 1;
          target.supply += 1;
        }
        if (p.supply > 0) {
          p.supply -= 1;
          p.standing[e.faction] += 1;
        }
      }
      break;
    }
    case 'seance': p.known.push('leftout'); break;
    case 'sign-blood': {
      const demon = factionOfArchetype(state, 'demonic');
      if (p.supply > 0) {
        p.supply -= 1;
        p.standing[demon] += 1;
      }
      break;
    }
  }
  if (response.timing === 'after') {
    const kind = { 'token-placed': 'token-placed', 'influence-spent': 'influence-spent', 'influence-placed': 'influence-placed', pass: 'pass' }[response.trigger];
    const i = state.events.findIndex((e) => e.type === kind && e.player !== pid);
    if (i >= 0) state.events.splice(i, 1); // each event is answered once
  }
  return state;
}

// ---------------------------------------------------------------------------
// The resolve phase (G.4.3): fights, then growth
// ---------------------------------------------------------------------------

/** The round's play is over: unplayed cards go back; fights; then growth. @param {GameState} state */
function endOfPlay(state) {
  for (const id of state.seating) state.players[id].hand = [];
  state.pending = null;
  state.events = [];
  logLine(state, 'Everyone passed. Fights:');
  for (const loc of LOCATION_IDS) if (!state.board[loc].scorched && factionsAt(state, loc).length === 2) fight(state, loc);
  return beginGrowth(state);
}

/** One location's fight on a copy of the state, for tests and previews. @param {GameState} state @param {string} loc @returns {GameState} */
export function resolveFight(state, loc) {
  const next = structuredClone(state);
  fight(next, loc);
  return next;
}

/**
 * One fight (FR5, TF1, TD1, AF3 adjusted). Mutates state.
 * @param {GameState} state @param {string} loc
 */
function fight(state, loc) {
  const place = state.board[loc];
  const [a, b] = factionsAt(state, loc);
  const name = locationById(loc).name;
  // A hidden token flips and takes part (IN1); its marker cube returns to its owner (MC3) after the fight.
  const token = place.token;
  place.token = null;
  const effect = token?.card ?? null;
  if (token) logLine(state, `  ${name}: ${token.owner}'s token flips: ${effect ? cardById(effect).name : 'a bluff'}.`);
  const na = place.cubes[a], nb = place.cubes[b];
  const aligned = [a, b].find((f) => archetypeOf(f) === alignmentOf(loc));
  const trueTie = effect === 'house-fire' || (na === nb && !aligned);
  if (trueTie) {
    // TF1 + TM1: both wiped, the location scorched, nothing rewarded; everything back to its supply.
    state.supply[a] += na;
    state.supply[b] += nb;
    for (const [pid, n] of Object.entries(place.influence)) state.players[pid].supply += n;
    place.cubes = {};
    place.influence = {};
    place.scorched = true;
    logLine(state, `  ${name}: a true tie. Both sides are wiped out and ${name} is scorched.`);
    return;
  }
  let winner, loser;
  if (na === nb) {
    winner = /** @type {string} */ (aligned);
    loser = winner === a ? b : a;
  } else [winner, loser] = na > nb ? [a, b] : [b, a];
  const nl = place.cubes[loser];
  const loserLoss = nl; // the loser always loses everything (FR5)
  let winnerLoss = Math.max(1, Math.floor(nl / 2));
  if (effect === 'silver-bullets') winnerLoss += 2; // each group loses 2 more; the loser has none left to lose
  if (effect === 'salt-burn') winnerLoss = place.cubes[winner];
  winnerLoss = Math.min(winnerLoss, place.cubes[winner]);
  place.cubes[loser] -= loserLoss;
  place.cubes[winner] -= winnerLoss;
  for (const f of [winner, loser]) if (place.cubes[f] <= 0) delete place.cubes[f];
  logLine(state, `  ${name}: ${factionById(winner).name} beat ${factionById(loser).name}; casualties ${loserLoss} and ${winnerLoss}.`);
  // Trophies (TD1): bigger pile to the leader, smaller to the runner-up.
  const piles = [{ faction: loser, n: loserLoss }, { faction: winner, n: winnerLoss }].filter((x) => x.n > 0).sort((x, y) => y.n - x.n);
  const ranking = rankAt(state, loc);
  const collectors = ranking.places;
  /** @param {{ faction: string, n: number }} pile @param {string | null} pid */
  const give = (pile, pid) => {
    if (pid) {
      state.players[pid].trophies[pile.faction] += pile.n;
      logLine(state, `  ${pid} takes a pile of ${pile.n} ${factionById(pile.faction).name}.`);
    } else state.supply[pile.faction] += pile.n;
  };
  if (ranking.involved === 1 && collectors[0]) {
    for (const pile of piles) give(pile, collectors[0]); // UP1
  } else {
    piles.forEach((pile, i) => give(pile, collectors[i] ?? null));
  }
  // Influence after the fight (AF3 adjusted, AS1).
  const leader = collectors[0];
  if (leader) {
    const n = place.influence[leader] ?? 0;
    const half = Math.floor(n / 2);
    state.players[leader].standing[winner] += half;
    state.players[leader].supply += n - half;
    delete place.influence[leader];
  }
  for (const pid of ranking.tiedLeaders) {
    state.players[pid].supply += place.influence[pid] ?? 0;
    delete place.influence[pid];
  }
}

/**
 * Rank players by influence at a location, with affinity breaking ties (AB1)
 * and standing ties using up their places (PT2, ST1). `places` lists who
 * collects first and second place (null where a tie used the place up).
 * @param {GameState} state @param {string} loc
 */
function rankAt(state, loc) {
  const place = state.board[loc];
  const entries = Object.entries(place.influence).filter(([, n]) => n > 0);
  const involved = entries.length;
  const byAmount = new Map();
  for (const [pid, n] of entries) byAmount.set(n, [...(byAmount.get(n) ?? []), pid]);
  const amounts = [...byAmount.keys()].sort((x, y) => y - x);
  /** @type {(string | null)[]} */
  const places = [];
  /** @type {string[]} */
  let tiedLeaders = [];
  for (const amount of amounts) {
    if (places.length >= 2) break;
    let tied = byAmount.get(amount);
    if (tied.length > 1) {
      const aff = tied.filter((/** @type {string} */ pid) => affinityOf(state, pid) === alignmentOf(loc));
      if (aff.length === 1) {
        places.push(aff[0]);
        tied = tied.filter((/** @type {string} */ pid) => pid !== aff[0]);
        if (places.length >= 2) break;
        if (tied.length === 1) {
          places.push(tied[0]);
          continue;
        }
      }
      if (places.length === 0) tiedLeaders = tied.slice();
      for (let i = 0; i < tied.length && places.length < 2; i++) places.push(null);
    } else places.push(tied[0]);
  }
  return { places, involved, tiedLeaders };
}

/** Where a faction grows this round (GR1, AL3). @param {GameState} state @param {string} faction */
function growthSpots(state, faction) {
  const threshold = num(state, 'growth');
  return LOCATION_IDS.filter((loc) => !state.board[loc].scorched && factionsAt(state, loc).length === 1 && cubesOf(state, loc, faction) >= threshold);
}

/** What each growth location is due: 1, plus 1 if the faction is aligned with it (AL3). @param {GameState} state @param {string} faction */
export function growthDue(state, faction) {
  return Object.fromEntries(growthSpots(state, faction).map((loc) => [loc, 1 + (archetypeOf(faction) === alignmentOf(loc) ? 1 : 0)]));
}

/**
 * Growth for each faction in turn, from `from`. A faction with enough supply
 * grows everywhere it is due; one short of cubes grows as far as its supply
 * allows, its influence leaders taking turns to choose (3.5).
 * @param {GameState} state @param {number} [from]
 */
function beginGrowth(state, from = 0) {
  for (const faction of state.factions.slice(from)) {
    const due = growthDue(state, faction);
    const wants = Object.values(due).reduce((n, x) => n + x, 0);
    if (wants === 0) continue;
    if (wants <= state.supply[faction]) {
      for (const [loc, n] of Object.entries(due)) state.board[loc].cubes[faction] += n;
      state.supply[faction] -= wants;
      logLine(state, `${factionById(faction).name} grows at ${Object.keys(due).length} location${Object.keys(due).length === 1 ? '' : 's'}.`);
    } else if (state.supply[faction] > 0) {
      state.growing = { faction, left: state.supply[faction], leaders: influenceLeaders(state, faction), next: 0, due };
      state.phase = 'growth';
      return state;
    }
  }
  return endRound(state);
}

/** One cube placed by an influence leader during a short-supply growth. @param {GameState} state @param {string} loc */
function growOne(state, loc) {
  const g = /** @type {NonNullable<GameState['growing']>} */ (state.growing);
  state.board[loc].cubes[g.faction] += 1;
  state.supply[g.faction] -= 1;
  g.due[loc] -= 1;
  if (g.due[loc] <= 0) delete g.due[loc];
  g.left -= 1;
  g.next += 1;
  if (g.left > 0 && state.supply[g.faction] > 0 && Object.keys(g.due).length) return state;
  logLine(state, `${factionById(g.faction).name} grows as far as its supply allows.`);
  const index = state.factions.indexOf(g.faction);
  state.growing = null;
  state.phase = 'play';
  return beginGrowth(state, index + 1);
}

/** @param {GameState} state */
function endRound(state) {
  state.phase = 'play';
  if (state.round >= num(state, 'rounds')) return endGame(state);
  state.round += 1;
  return deal(state);
}

// ---------------------------------------------------------------------------
// The end of the game (G.5)
// ---------------------------------------------------------------------------

/** @param {GameState} state */
function endGame(state) {
  state.phase = 'ended';
  const total = totalPresence(state);
  const threshold = num(state, 'threshold');
  /** @type {Record<string, number>} */
  const scores = {};
  if (total > threshold) {
    // TH1: the invaders win; most presence, then most locations controlled (FX1), else they win together (FX2).
    const ranked = state.factions.map((f) => ({ f, p: presenceOf(state, f), c: LOCATION_IDS.filter((l) => controllerOf(state, l) === f).length }))
      .sort((x, y) => y.p - x.p || y.c - x.c);
    const top = ranked.filter((x) => x.p === ranked[0].p && x.c === ranked[0].c).map((x) => x.f);
    for (const pid of state.seating) scores[pid] = top.reduce((n, f) => n + (state.players[pid].standing[f] ?? 0) - state.players[pid].trophies[f], 0);
    const order = ranked.map((x) => x.f);
    const winners = rankPlayers(state, scores, (a, b) => {
      // ET4: fewest trophies of the winning faction(s), then affinity, then the next faction (ET1).
      const ta = top.reduce((n, f) => n + state.players[a].trophies[f], 0), tb = top.reduce((n, f) => n + state.players[b].trophies[f], 0);
      if (ta !== tb) return ta - tb;
      const aa = top.some((f) => archetypeOf(f) === affinityOf(state, a)), ab = top.some((f) => archetypeOf(f) === affinityOf(state, b));
      if (aa !== ab) return aa ? -1 : 1;
      for (const f of order.filter((x) => !top.includes(x))) {
        const sa = (state.players[a].standing[f] ?? 0) - state.players[a].trophies[f], sb = (state.players[b].standing[f] ?? 0) - state.players[b].trophies[f];
        if (sa !== sb) return sb - sa;
      }
      return 0;
    });
    state.result = { side: 'invaders', factions: top, players: winners, scores };
    logLine(state, `Total presence ${total} is more than ${threshold}: the invaders win. ${top.map((f) => factionById(f).name).join(' and ')} take the island. Winner: ${winners.join(', ')}.`);
  } else {
    // TS2: the count of the colour held fewest of; WT1 compares the next weakest.
    const sorted = (/** @type {string} */ pid) => state.factions.map((f) => state.players[pid].trophies[f]).sort((x, y) => x - y);
    for (const pid of state.seating) scores[pid] = sorted(pid)[0];
    const winners = rankPlayers(state, scores, (a, b) => {
      const sa = sorted(a), sb = sorted(b);
      for (let i = 1; i < sa.length; i++) if (sa[i] !== sb[i]) return sb[i] - sa[i];
      return 0;
    });
    state.result = { side: 'island', factions: [], players: winners, scores };
    logLine(state, `Total presence ${total} is not more than ${threshold}: the island wins. Winner: ${winners.join(', ')}.`);
  }
  return state;
}

/**
 * The best score wins; ties go to the tiebreak; players still tied share it.
 * @param {GameState} state @param {Record<string, number>} scores @param {(a: string, b: string) => number} tiebreak
 */
function rankPlayers(state, scores, tiebreak) {
  const best = Math.max(...state.seating.map((pid) => scores[pid]));
  const tied = state.seating.filter((pid) => scores[pid] === best).sort(tiebreak);
  return tied.filter((pid) => tiebreak(pid, tied[0]) === 0);
}

// ---------------------------------------------------------------------------
// Derived values
// ---------------------------------------------------------------------------

/** Seats the current phase is waiting on. @param {GameState | PlayerView} state */
export function waitingOn(state) {
  if (state.phase === 'ended') return [];
  if ('me' in state) return state.phase === 'draft' ? state.seating.filter((id) => !state.players[id].picked) : state.toAct ? [state.toAct] : [];
  if (state.phase === 'draft') return state.seating.filter((id) => !state.players[id].picked);
  if (state.phase === 'growth' && state.growing) return [state.growing.leaders[state.growing.next % state.growing.leaders.length]];
  if (state.pending) return [state.pending.player];
  return [state.seating[state.turn]];
}

/** For the bots and the UI: response cards a player could play right now. @param {GameState} state @param {string} pid */
export function playableResponses(state, pid) {
  if (state.phase !== 'play') return [];
  const p = state.players[pid];
  /** @type {{ card: string, location?: string }[]} */
  const out = [];
  for (const c of p.hand) {
    const response = cardById(c).response;
    if (!response) continue;
    if (response.trigger === 'move-into-your-location') {
      for (const loc of state.pending ? pendingDestinations(state, state.pending) : []) {
        if (validate(state, { playerId: pid, move: { type: 'respond', card: c, location: loc } }).ok) out.push({ card: c, location: loc });
      }
    } else if (validate(state, { playerId: pid, move: { type: 'respond', card: c } }).ok) out.push({ card: c });
  }
  return out;
}

/**
 * For the bots: a random legal target for a card's turn action, or null if
 * none was found. Not a rule; a sampler over the legal space.
 * @param {GameState} state @param {string} pid @param {string} cardId @param {() => number} rng
 * @returns {Target | null}
 */
export function sampleTarget(state, pid, cardId, rng) {
  const card = cardById(cardId);
  const pick = (/** @type {any[]} */ xs) => xs[Math.floor(rng() * xs.length)];
  const groups = LOCATION_IDS.flatMap((loc) => factionsAt(state, loc).map((f) => ({ loc, f })));
  /** @type {('location' | 'faction')[]} */
  const modes = card.suit ? ['location', 'faction'] : ['location'];
  for (let tries = 0; tries < 40; tries++) {
    const mode = pick(modes);
    /** @type {Target | null} */
    let t = null;
    const g = pick(groups);
    switch (card.action) {
      case 'lure': case 'draw-adjacent': t = { mode, location: pick(LOCATION_IDS) }; break;
      case 'gather-region': case 'gather-neighbours': t = { mode, location: pick(LOCATION_IDS), faction: pick(state.factions) }; break;
      case 'broadcast': {
        const f = pick(state.factions);
        const holds = LOCATION_IDS.filter((l) => cubesOf(state, l, f) > 0);
        t = { mode, location: pick(LOCATION_IDS), faction: f, from: [pick(holds), pick(holds)].filter((x, i, a) => x && a.indexOf(x) === i) };
        break;
      }
      case 'sow': {
        if (!g) break;
        const path = [];
        let at = g.loc;
        for (let i = 0; i < 4; i++) {
          at = pick(MAP[at].adjacent);
          path.push(at);
        }
        t = { mode, location: g.loc, faction: g.f, path };
        break;
      }
      case 'token': {
        const spots = tokenSpots(state, card, mode);
        const loc = pick(spots);
        const others = spots.filter((l) => l !== loc);
        t = { mode, location: loc, bluff: others.length && state.players[pid].bluffs > 0 ? pick(others) : undefined };
        break;
      }
      case 'halve': case 'drive-out': if (g) t = { mode, location: g.loc, faction: g.f, to: pick(MAP[g.loc].adjacent) }; break;
      case 'teleport': if (g) t = { mode, location: g.loc, faction: g.f, to: pick(LOCATION_IDS) }; break;
      case 'spread': if (g) t = { mode, location: g.loc, faction: g.f }; break;
      case 'split': {
        if (!g) break;
        const n = cubesOf(state, g.loc, g.f);
        const dests = MAP[g.loc].adjacent.slice();
        if (n < 2 || dests.length < 2) break;
        const a = pick(dests), b = pick(dests.filter((d) => d !== a));
        const na = 1 + Math.floor(rng() * (n - 1));
        t = { mode, location: g.loc, faction: g.f, split: { [a]: na, [b]: n - na } };
        break;
      }
      case 'conveyor': t = { mode, location: pick(LOCATION_IDS), direction: pick(spec.map.directions).id }; break;
      case 'move-two': case 'move-one': case 'move-half': case 'move-far': {
        if (!g) break;
        const reach = card.action === 'move-far' ? twoHex(g.loc) : MAP[g.loc].adjacent;
        t = { moves: [{ location: g.loc, faction: g.f, to: pick(reach) }] };
        break;
      }
    }
    if (t && !checkTarget(state, pid, card, t)) return t;
  }
  return null;
}

/**
 * For the table: the next choice in building a card's target, given what has
 * been chosen so far. Not a rule; it offers the legal options one step at a
 * time, and the server still checks the finished target (checkTarget).
 * @typedef {{ kind: 'mode' } | { kind: 'location', key: 'location' | 'to' | 'bluff' | 'path' | 'from', options: string[], optional?: boolean, left?: number }
 *   | { kind: 'group', key: 'group' | 'move', options: { location: string, faction: string }[], optional?: boolean }
 *   | { kind: 'faction', options: string[] } | { kind: 'direction', options: string[] }
 *   | { kind: 'split', options: string[], left: number } | { kind: 'done' }} Choice
 * @param {GameState} state @param {string} pid @param {string} cardId @param {Target} t
 * @returns {Choice}
 */
export function nextChoice(state, pid, cardId, t) {
  const card = cardById(cardId);
  const mode = /** @type {'location' | 'faction'} */ (t.mode ?? 'location');
  if (card.suit && !t.mode) return { kind: 'mode' };
  const sf = suitFaction(state, card);
  const groups = LOCATION_IDS.flatMap((loc) => factionsAt(state, loc).map((f) => ({ location: loc, faction: f })));
  const groupOk = (/** @type {{ location: string, faction: string }} */ g) => !card.suit || (mode === 'location' ? suitLocations(card).includes(g.location) : g.faction === sf);
  const placeOk = (/** @type {string} */ loc) => !state.board[loc].scorched && (!card.suit || mode === 'faction' || suitLocations(card).includes(loc));
  const ok = (/** @type {Target} */ x) => !checkTarget(state, pid, card, x);
  /** Where a group could go, among `reach`. */
  const exits = (/** @type {{ location: string, faction: string }} */ g, /** @type {string[]} */ reach) => reach.filter((l) => l !== g.location && canEnter(state, l, g.faction));
  /** The factions this reading may move: any (location target) or only the suit's (faction target). */
  const movers = card.suit && mode === 'faction' ? [/** @type {string} */ (sf)] : state.factions.slice();
  switch (card.action) {
    case 'lure': case 'draw-adjacent': {
      // Only where it would do something: a group of a faction that may come is adjacent and can enter.
      const comes = (/** @type {string} */ loc) => MAP[loc].adjacent.some((from) => movers.some((f) => cubesOf(state, from, f) > 0 && canEnter(state, loc, f)));
      return t.location ? { kind: 'done' } : { kind: 'location', key: 'location', options: LOCATION_IDS.filter(placeOk).filter(comes) };
    }
    case 'gather-region': case 'gather-neighbours': {
      const sources = (/** @type {string} */ loc) => LOCATION_IDS.filter((l) => l !== loc && (card.action === 'gather-region' ? regionOf(l) === regionOf(loc) : REGIONS[regionOf(loc)].neighbours.includes(regionOf(l))));
      const gathers = (/** @type {string} */ loc, /** @type {string} */ f) => canEnter(state, loc, f) && sources(loc).some((l) => cubesOf(state, l, f) > 0);
      if (!t.location) return { kind: 'location', key: 'location', options: LOCATION_IDS.filter(placeOk).filter((loc) => movers.some((f) => gathers(loc, f))) };
      if (!t.faction) return { kind: 'faction', options: movers.filter((f) => gathers(/** @type {string} */ (t.location), f)) };
      return { kind: 'done' };
    }
    case 'broadcast':
      if (!t.location) return { kind: 'location', key: 'location', options: LOCATION_IDS.filter(placeOk).filter((loc) => movers.some((f) => canEnter(state, loc, f) && LOCATION_IDS.some((l) => l !== loc && cubesOf(state, l, f) > 0))) };
      if (!t.faction) return { kind: 'faction', options: movers.filter((f) => canEnter(state, /** @type {string} */ (t.location), f) && LOCATION_IDS.some((l) => l !== t.location && cubesOf(state, l, f) > 0)) };
      if ((t.from ?? []).includes('__stop')) return { kind: 'done' };
      if ((t.from ?? []).length < 2) {
        const opts = LOCATION_IDS.filter((l) => l !== t.location && !(t.from ?? []).includes(l) && cubesOf(state, l, /** @type {string} */ (t.faction)) > 0);
        return opts.length ? { kind: 'location', key: 'from', options: opts, optional: (t.from ?? []).length === 1 } : { kind: 'done' };
      }
      return { kind: 'done' };
    case 'token': {
      const spots = tokenSpots(state, card, mode);
      if (!t.location) return { kind: 'location', key: 'location', options: spots };
      if (t.bluff === undefined && state.players[pid].bluffs > 0 && spots.length > 1) return { kind: 'location', key: 'bluff', options: spots.filter((l) => l !== t.location), optional: true };
      return { kind: 'done' };
    }
    case 'sow': {
      // Only groups that can be chased at least one step: influence with the faction, and a bordering location it can enter.
      if (!t.location) return { kind: 'group', key: 'group', options: groups.filter(groupOk).filter((g) => (state.players[pid].standing[g.faction] ?? 0) > 0 && exits(g, MAP[g.location].adjacent).length > 0) };
      const path = t.path ?? [];
      if (path.includes('__stop')) return { kind: 'done' };
      const at = path.length ? path[path.length - 1] : t.location;
      const f = /** @type {string} */ (t.faction);
      // Steps left: one cube and one influence per location entered.
      const left = Math.min(cubesOf(state, t.location, f), state.players[pid].standing[f] ?? 0) - path.length;
      const opts = left > 0 ? MAP[at].adjacent.filter((l) => canEnter(state, l, f) && l !== t.location) : [];
      return opts.length ? { kind: 'location', key: 'path', options: opts, optional: path.length > 0, left } : { kind: 'done' };
    }
    case 'halve': case 'drive-out': case 'teleport': {
      if (!t.location) {
        const gs = groups.filter(groupOk).filter((g) => (card.action !== 'halve' || cubesOf(state, g.location, g.faction) >= 2)
          && exits(g, card.action === 'teleport' ? LOCATION_IDS : MAP[g.location].adjacent).length > 0);
        return { kind: 'group', key: 'group', options: card.action === 'drive-out' ? gs.filter((g) => MAP[g.location].adjacent.some((to) => ok({ ...t, location: g.location, faction: g.faction, to }))) : gs };
      }
      const reach = card.action === 'teleport' ? LOCATION_IDS.filter((l) => l !== t.location) : MAP[t.location].adjacent;
      return t.to ? { kind: 'done' } : { kind: 'location', key: 'to', options: reach.filter((to) => canEnter(state, to, /** @type {string} */ (t.faction))) };
    }
    case 'spread':
      return t.location ? { kind: 'done' } : { kind: 'group', key: 'group', options: groups.filter(groupOk).filter((g) => exits(g, MAP[g.location].adjacent).length > 0) };
    case 'split': {
      if (!t.location) return { kind: 'group', key: 'group', options: groups.filter(groupOk).filter((g) => cubesOf(state, g.location, g.faction) >= 2 && exits(g, MAP[g.location].adjacent).length >= 2) };
      const placedN = Object.values(t.split ?? {}).reduce((a, b) => a + b, 0);
      const left = cubesOf(state, t.location, /** @type {string} */ (t.faction)) - placedN;
      const dests = MAP[t.location].adjacent.filter((l) => canEnter(state, l, /** @type {string} */ (t.faction)));
      // At least two locations: the last cube can't join the only one used so far.
      const used = Object.keys(t.split ?? {}).filter((d) => (t.split?.[d] ?? 0) > 0);
      return left > 0 ? { kind: 'split', options: left === 1 && used.length === 1 ? dests.filter((d) => d !== used[0]) : dests, left } : { kind: 'done' };
    }
    case 'conveyor':
      if (mode === 'location' && !t.location) return { kind: 'location', key: 'location', options: suitLocations(card) };
      return t.direction ? { kind: 'done' } : { kind: 'direction', options: spec.map.directions.map((d) => d.id) };
    case 'move-two': case 'move-one': case 'move-half': case 'move-far': {
      const moves = t.moves ?? [];
      if (moves.some((m) => m.location === '__stop')) return { kind: 'done' };
      const last = moves[moves.length - 1];
      if (last && !last.to) {
        const reach = card.action === 'move-far' ? twoHex(last.location) : MAP[last.location].adjacent;
        return { kind: 'location', key: 'to', options: reach.filter((l) => canEnter(state, l, last.faction)) };
      }
      const max = card.action === 'move-two' ? 2 : 1;
      const reachOf = (/** @type {string} */ l) => (card.action === 'move-far' ? twoHex(l) : MAP[l].adjacent);
      if (moves.length < max) return { kind: 'group', key: 'move', options: groups.filter((g) => !moves.some((m) => m.location === g.location && m.faction === g.faction) && exits(g, reachOf(g.location)).length > 0), optional: moves.length > 0 };
      return { kind: 'done' };
    }
    default: return { kind: 'done' };
  }
}

/**
 * A target in words, for the table. @param {string} cardId @param {Target | null} t
 */
export function describeTarget(cardId, t) {
  if (!t) return 'no effect';
  const card = cardById(cardId);
  const L = (/** @type {string | undefined} */ l) => (l ? locationById(l).name : '?');
  const F = (/** @type {string | undefined} */ f) => (f ? factionById(f).name : '?');
  const how = t.mode === 'faction' ? ' (faction target)' : t.mode === 'location' ? ' (location target)' : '';
  switch (card.action) {
    case 'lure': case 'draw-adjacent': return `at ${L(t.location)}${how}`;
    case 'gather-region': case 'gather-neighbours': return `${F(t.faction)} into ${L(t.location)}${how}`;
    case 'broadcast': return `${F(t.faction)} from ${(t.from ?? []).map(L).join(' and ')} into ${L(t.location)}${how}`;
    case 'sow': return `${F(t.faction)} from ${L(t.location)} via ${(t.path ?? []).map(L).join(', ')}${how}`;
    case 'token': return `token at ${L(t.location)}${t.bluff ? `, bluff at ${L(t.bluff)}` : ''}${how}`;
    case 'halve': case 'teleport': case 'drive-out': return `${F(t.faction)} at ${L(t.location)} to ${L(t.to)}${how}`;
    case 'spread': return `${F(t.faction)} at ${L(t.location)}${how}`;
    case 'split': return `${F(t.faction)} at ${L(t.location)} split ${Object.entries(t.split ?? {}).map(([l, n]) => `${n} to ${L(l)}`).join(', ')}${how}`;
    case 'conveyor': return `${t.mode === 'location' ? `the ${regionOf(/** @type {string} */ (t.location))} region` : 'every Sentient group'} one hex ${t.direction}`;
    default: return (t.moves ?? []).map((m) => `${F(m.faction)} at ${L(m.location)} to ${L(m.to)}`).join('; ');
  }
}

// ---------------------------------------------------------------------------
// Visibility (F.5, 3.11)
// ---------------------------------------------------------------------------

/**
 * The copy of the state one seat may see. Hands, kept cards, batches, the
 * left-out cards, token faces and trophy totals are hidden (3.11, IN2).
 * @param {GameState} state
 * @param {string} playerId
 * @returns {PlayerView}
 */
export function playerView(state, playerId) {
  const me = state.players[playerId];
  if (!me) throw new Error(`unknown player ${playerId}`);
  return {
    you: playerId,
    options: { ...state.options },
    phase: state.phase,
    round: state.round,
    rounds: num(state, 'rounds'),
    seating: state.seating.slice(),
    players: Object.fromEntries(state.seating.map((id) => {
      const p = state.players[id];
      return [id, { group: p.group, standing: { ...p.standing }, supply: p.supply, bluffs: p.bluffs, handSize: state.phase === 'draft' ? p.kept.length : p.hand.length, picked: p.picked }];
    })),
    factions: state.factions.slice(),
    board: Object.fromEntries(LOCATION_IDS.map((loc) => {
      const place = state.board[loc];
      return [loc, { cubes: { ...place.cubes }, influence: { ...place.influence }, token: place.token ? { owner: place.token.owner } : null, scorched: place.scorched }];
    })),
    supply: { ...state.supply },
    growing: state.growing ? structuredClone(state.growing) : null,
    first: state.first,
    opened: state.opened,
    toAct: waitingOn(state)[0] ?? null,
    pending: state.pending ? { player: state.pending.player, card: state.pending.card, target: state.pending.target, cancelled: state.pending.cancelled, blocked: state.pending.blocked.slice() } : null,
    log: structuredClone(state.log),
    result: state.result ? structuredClone(state.result) : null,
    events: structuredClone(state.events),
    me: {
      hand: me.hand.slice(), kept: me.kept.slice(), batch: me.batch.slice(), picked: me.picked, trophies: { ...me.trophies }, known: me.known.slice(),
      leftOut: me.known.includes('leftout') ? state.leftOut.slice() : null,
    },
  };
}

