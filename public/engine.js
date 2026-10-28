// @ts-check
/**
 * Monster of the Week — pure game engine.
 *
 * Every exported function is pure: it takes a GameState (plus inputs) and
 * returns a new GameState or a derived value. Nothing here touches the network,
 * the DOM, or storage. The Durable Object uses it as the authority, the browser
 * uses it for previews, and the bot harness uses it for simulation.
 *
 * The rules are the first draft (docs/motw-design.md, Appendix G) as amended by
 * the decisions in section 3; the cards are the core deck (spec.cards, 21); the
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
 * @property {{ faction: string, leaders: string[], next: number, due: Record<string, number> } | null} growing
 * @property {{ player: string, left: string[] } | null} [night]
 * @property {string[]} factions
 * @property {Record<string, { tokens: Record<string, number>, sway: Record<string, number>, scorched: boolean, gate?: string, gateLoss?: string, altar?: boolean, study?: string, terror?: string }>} board
 * @property {Record<string, number>} supply
 * @property {string[]} deck  the game's cards
 * @property {Record<string, number>} printed  each card's sway for this seat now (swayFor)
 * @property {{ pid: string, card: string, use: string }[]} roundPlays  this round's plays
 * @property {string | null} first
 * @property {boolean} opened  the first player has opened with their marked card
 * @property {string | null} toAct
 * @property {RoundLog[]} log
 * @property {GameState['result']} result
 * @property {{ hand: string[], kept: string[], batch: string[], picked: boolean, trophies: Record<string, number> }} me
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

/** IC1 (designer, 2026-10-07): the sway a card places is a requirement. @param {{ options: Options }} state */
export const swayRequired = (state) => (state.options.swayRequired ?? 'on') === 'on';

/** An option's number; a game saved before an option existed uses its default. @param {{ options: Options }} state @param {string} id */
const num = (state, id) => Number(state.options[id] ?? variants.find((v) => v.id === id)?.default);

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

/**
 * The Gate (ↂ strike, designer 2026-10-17): the location joined to this one for the rest of the round, if any. While
 * it is open the two count as a single location for movement, and their fights act as one (joinedFight).
 * @param {GameState | PlayerView} state @param {string} loc @returns {string | null}
 */
const gateOf = (state, loc) => /** @type {any} */ (state.board[loc])?.gate ?? null;
/** The locations that make up this one: itself, and its Gate partner while the Gate is open. @param {GameState | PlayerView} state @param {string} loc */
const endsOf = (state, loc) => { const g = gateOf(state, loc); return g ? [loc, g] : [loc]; };
/** The factions at a location (both ends of a Gate together). @param {GameState} state @param {string} loc */
const factionsAt = (state, loc) => {
  // Hot path (2026-10-21 profile: 42% of a bot game): plain loops, no intermediate arrays. Same result and order.
  /** @type {string[]} */ const out = [];
  const add = (/** @type {Record<string, number>} */ tokens) => { for (const f in tokens) if (tokens[f] > 0 && !out.includes(f)) out.push(f); };
  add(state.board[loc].tokens);
  const g = gateOf(state, loc);
  if (g) add(state.board[g].tokens);
  return out;
};
/**
 * A location's neighbours. Through an open Gate the two ends are one location: either end's neighbours are its
 * neighbours, and a location next to one end is next to the other. Without a Gate, the map's adjacency.
 * @param {GameState | PlayerView} state @param {string} loc
 */
function adj(state, loc) {
  const base = MAP[loc].adjacent;
  const g = gateOf(state, loc);
  if (!g && !base.some((l) => gateOf(state, l))) return base;
  const out = new Set(g ? [...base, ...MAP[g].adjacent] : base);
  for (const l of [...out]) { const p = gateOf(state, l); if (p) out.add(p); }
  out.delete(loc);
  if (g) out.delete(g);
  return [...out];
}
/** Every group on the board (memoised per state while a bot searches). @param {GameState} state @returns {{ location: string, faction: string }[]} */
function groupsOf(state) {
  const hit = memoDepth ? GROUPS_MEMO.get(state) : undefined;
  if (hit) return hit;
  const out = LOCATION_IDS.flatMap((loc) => factionsAt(state, loc).map((f) => ({ location: loc, faction: f })));
  if (memoDepth) GROUPS_MEMO.set(state, out);
  return out;
}
const GROUPS_MEMO = new WeakMap();
/** A faction's tokens at a location (both ends of a Gate together: one group). @param {GameState} state @param {string} loc @param {string} faction */
const tokensOf = (state, loc, faction) => endsOf(state, loc).reduce((n, l) => n + (state.board[l].tokens[faction] ?? 0), 0);
/** A faction's tokens at one end only. @param {GameState} state @param {string} loc @param {string} faction */
const rawTokens = (state, loc, faction) => state.board[loc].tokens[faction] ?? 0;
/** Add tokens at one end. @param {GameState} state @param {string} loc @param {string} faction @param {number} n */
function addTokens(state, loc, faction, n) {
  if (n > 0) state.board[loc].tokens[faction] = rawTokens(state, loc, faction) + n;
}
/** Take tokens from a location: this end first, then its Gate partner. @param {GameState} state @param {string} loc @param {string} faction @param {number} n */
function takeTokens(state, loc, faction, n) {
  let left = n;
  for (const l of endsOf(state, loc)) {
    const k = Math.min(left, rawTokens(state, l, faction));
    if (k <= 0) continue;
    state.board[l].tokens[faction] -= k;
    if (state.board[l].tokens[faction] <= 0) delete state.board[l].tokens[faction];
    left -= k;
  }
}
/** @param {GameState} state @param {string} faction */
export const presenceOf = (state, faction) => LOCATION_IDS.reduce((n, loc) => n + rawTokens(state, loc, faction), 0);
/** @param {GameState} state */
export const totalPresence = (state) => state.factions.reduce((n, f) => n + presenceOf(state, f), 0);
/** The faction in play for an archetype. @param {GameState | PlayerView} state @param {string} archetype */
export const factionOfArchetype = (state, archetype) => state.factions[spec.archetypes.findIndex((a) => a.id === archetype)];
/** @param {string} faction */
const archetypeOf = (faction) => factionById(faction).archetype;
/** @param {string} loc */
const alignmentOf = (loc) => locationById(loc).archetype;

/**
 * May a faction's tokens be moved into this location? Not scorched, and never
 * a third faction (LL1). Factions only ever move by a card, which says where
 * (D19); regions are geography that cards refer to.
 * @param {GameState} state @param {string} loc @param {string} faction
 */
export function canEnter(state, loc, faction) {
  const place = state.board[loc];
  if (!place || place.scorched) return false;
  const here = factionsAt(state, loc);
  return here.includes(faction) || here.length < 2;
}

/** Who controls a location (LC2): the faction with most tokens; a tie goes to the aligned faction, else no one. @param {GameState} state @param {string} loc */
export function controllerOf(state, loc) {
  const here = factionsAt(state, loc).sort((a, b) => tokensOf(state, loc, b) - tokensOf(state, loc, a));
  if (here.length === 0) return null;
  if (here.length === 1 || tokensOf(state, loc, here[0]) > tokensOf(state, loc, here[1])) return here[0];
  const aligned = here.find((f) => archetypeOf(f) === alignmentOf(loc));
  return aligned ?? null;
}

/** The player's slayer group archetype. @param {GameState | PlayerView} state @param {string} pid */
const affinityOf = (state, pid) => {
  const group = spec.slayerGroups.find((g) => g.id === state.players[pid].group);
  return group ? group.archetype : '';
};

/**
 * Sway leaders of a faction: the most standing; affinity breaks a tie
 * (AB1); otherwise all tied are leaders. 0 counts.
 * @param {GameState} state @param {string} faction
 */
export function swayLeaders(state, faction) {
  const best = Math.max(...state.seating.map((pid) => state.players[pid].standing[faction] ?? 0));
  const tied = state.seating.filter((pid) => (state.players[pid].standing[faction] ?? 0) === best);
  const withAffinity = tied.filter((pid) => affinityOf(state, pid) === archetypeOf(faction));
  return withAffinity.length ? withAffinity : tied;
}

/**
 * A group that can set off: a lone group, or its side of a fight with some free to leave (half from a fight, D22;
 * The Big Chase and Bait the Herd, designer 2026-10-18).
 * @param {GameState} state @param {string} loc @param {string} faction
 */
const canLeave = (state, loc, faction) => factionsAt(state, loc).includes(faction) && freeOf(state, loc, faction) > 0;

/**
 * Tokens of a faction free to leave a location. Half from a fight (D22, designer 2026-10-17; variant fightHalf): from
 * a location where a fight already exists, any card moves at most half of a faction's group, rounded down, so at least
 * half stays and no fight is emptied by movement.
 * @param {GameState} state @param {string} loc @param {string} faction
 */
function freeOf(state, loc, faction) {
  const n = tokensOf(state, loc, faction);
  const other = factionsAt(state, loc).find((f) => f !== faction);
  if (!other) return n;
  return (state.options.fightHalf ?? 'on') === 'on' ? Math.floor(n / 2) : n;
}

/**
 * Move tokens, placing 1 sway at the destination spent from the
 * player's standing with the faction moved (3.7, CA2); under IC1 (D15) a move
 * it can't pay for doesn't happen. Returns the number moved (0 if it may
 * not enter, or can't be paid for).
 * @param {GameState} state @param {string} pid @param {string} faction
 * @param {string} from @param {string} to @param {number} count @param {Set<string>} placedAt  where sway was placed this action ("to:faction")
 * @param {boolean} [freed]  the count is already limited to the free tokens, taken before the board changed
 */
function move(state, pid, faction, from, to, count, placedAt, freed = false) {
  const n = Math.min(count, freed ? tokensOf(state, from, faction) : freeOf(state, from, faction));
  if (n <= 0 || from === to) return 0;
  if (!canEnter(state, to, faction)) return 0;
  // IC1: a move that places sway goes only as far as the player can pay for it.
  const cost = num(state, 'swayPerMove');
  const key = `${to}:${faction}`;
  if (swayRequired(state) && cost > 0 && !placedAt.has(key) && (state.players[pid].standing[faction] ?? 0) < cost) { unpaidMoves += 1; return 0; }
  takeTokens(state, from, faction, n);
  addTokens(state, to, faction, n);
  if (placedAt.has(key)) return n;
  placedAt.add(key);
  const k = Math.min(cost, state.players[pid].standing[faction] ?? 0);
  if (k > 0) {
    state.players[pid].standing[faction] -= k;
    state.board[to].sway[pid] = (state.board[to].sway[pid] ?? 0) + k;
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
  const board = Object.fromEntries(LOCATION_IDS.map((loc) => [loc, { tokens: {}, sway: {}, scorched: false }]));
  /** @type {Record<string, number>} */
  const supply = {};
  for (const faction of factions) {
    // SD1 (designer, 2026-10-21): 2 on each of the archetype's three locations (variant seeding=two); seeding=even: 3 on
    // each (2026-10-17); seeding=home: a random home location gets 5, the others 1.
    const locs = spec.locations.filter((l) => l.archetype === archetypeOf(faction)).map((l) => l.id);
    const s = shuffle(locs, rngState);
    rngState = s.rngState;
    const how = options.seeding ?? 'two', even = how === 'even' || how === 'two';
    let placed = 0;
    for (const loc of s.items) {
      const n = how === 'two' ? spec.constants.seeding.two : even ? spec.constants.seeding.even : loc === s.items[0] ? spec.constants.seeding.home : spec.constants.seeding.other;
      board[loc].tokens[faction] = n;
      placed += n;
    }
    supply[faction] = num({ options }, 'factionTokens') - placed;
  }
  let groups = spec.slayerGroups.map((g) => g.id);
  if (options.groups === 'random') {
    const s = shuffle(groups, rngState);
    rngState = s.rngState;
    groups = s.items;
  }
  /** @type {Record<string, PlayerState>} */
  const players = {};
  const onBoard = num({ options }, 'startBoard');
  input.players.forEach((pid, i) => {
    const group = groups[i];
    const linked = factions.find((f) => archetypeOf(f) === spec.slayerGroups.find((g) => g.id === group)?.archetype) ?? factions[0];
    const start = num({ options }, 'startSway');
    // Starting setup (designer, 2026-10-07): more with the affinity faction, startOthers with every other faction.
    const others = num({ options }, 'startOthers');
    const standing = Object.fromEntries(factions.map((f) => [f, f === linked ? start : others]));
    const held = Object.values(standing).reduce((a, b) => a + b, 0);
    players[pid] = {
      group, supply: num({ options }, 'playerCubes') - held, standing,
      trophies: Object.fromEntries(factions.map((f) => [f, 0])),
      hand: [], kept: [], batch: [], picked: false,
    };
    // Each slayer group starts with sway on the board at each of its affinity locations (designer, 2026-10-07), from its supply.
    const arch = spec.slayerGroups.find((g) => g.id === group)?.archetype;
    for (const loc of LOCATION_IDS.filter((l) => alignmentOf(l) === arch)) {
      const n = Math.min(onBoard, players[pid].supply);
      if (n > 0) { board[loc].sway[pid] = (board[loc].sway[pid] ?? 0) + n; players[pid].supply -= n; }
    }
  });
  /** @type {GameState} */
  const state = {
    version: spec.meta.version, options, rngState, phase: 'draft', round: 1, seating: input.players.slice(), players, factions,
    board, supply, leftOut: [], pass: 1, first: null, turn: 0, passesInRow: 0, opened: false, growing: null,
    log: [], result: null, roundPlays: [],
  };
  return deal(state);
}

/** The game's cards: the core deck, all 21 (PS1). */
export const deckOf = () => spec.cards.map((card) => card.id);
/** A card's printed sway. @param {string} cardId */
export const printedOf = (cardId) => cardById(cardId).sway;
/**
 * A card's sway for a player now (D24, designer 2026-10-18): a signature's is 1 for each card in that player's hand,
 * itself included (while it is being played, it has already left the hand), with no cap, for its action and for
 * playing it for sway alike; any other card's is its printed sway.
 * @param {GameState | PlayerView} state @param {string} pid @param {string} cardId
 */
export function swayFor(state, pid, cardId) {
  const p = state.players[pid];
  const hand = p && 'hand' in p ? p.hand : null;
  if (cardById(cardId).slot !== 'signature' || !Array.isArray(hand)) return printedOf(cardId);
  const held = hand.includes(cardId) || (hand.includes(PLAYBOOK) && lastAction(/** @type {GameState} */ (state)) === cardId); // copied by Steal Their Playbook: the Playbook is the card played
  return hand.length + (held ? 0 : 1);
}

/** Steal Their Playbook (unsuited, designer 2026-10-24). */
const PLAYBOOK = 'playbook';
/** This round's last card played for its action, the Playbook's own plays aside, or null. @param {GameState | PlayerView} state */
function lastAction(state) {
  const plays = ('roundPlays' in state && state.roundPlays) || [];
  for (let i = plays.length - 1; i >= 0; i--) if (plays[i].use === 'action' && plays[i].card !== PLAYBOOK) return plays[i].card;
  return null;
}
/** The cards a player played earlier this round, each once, that the Playbook may take back. @param {GameState | PlayerView} state @param {string} pid */
const ownPlays = (state, pid) => [...new Set((('roundPlays' in state && state.roundPlays) || []).filter((x) => x.pid === pid && x.card !== PLAYBOOK).map((x) => x.card))];
/**
 * The unsuited cards' X (designer, 2026-10-23): the cards in hand, the one played included (as D24).
 * @param {GameState | PlayerView} state @param {string} pid @param {string} cardId
 */
function handX(state, pid, cardId) {
  const p = /** @type {any} */ (state.players[pid]);
  const hand = 'me' in state && state.you === pid ? state.me.hand : p && Array.isArray(p.hand) ? p.hand : null;
  if (!Array.isArray(hand)) return 1;
  return hand.length + (hand.includes(cardId) ? 0 : 1);
}
/** A pick list with the stop marker taken out. @param {string[] | undefined} xs */
const picked = (xs) => (xs ?? []).filter((x) => x !== '__stop');
/** How many times each entry appears. @param {string[]} xs @returns {Record<string, number>} */
function tally(xs) {
  /** @type {Record<string, number>} */ const n = {};
  for (const x of xs) n[x] = (n[x] ?? 0) + 1;
  return n;
}
/** The fights now (not scorched). @param {GameState | PlayerView} state */
const fightsNow = (state) => LOCATION_IDS.filter((l) => !state.board[l].scorched && factionsAt(/** @type {GameState} */ (state), l).length >= 2);
/** Your sway at a location. @param {GameState | PlayerView} state @param {string} pid @param {string} l */
const mySway = (state, pid, l) => state.board[l].sway[pid] ?? 0;
/** Your standing with a faction (no limit when sway isn't required). @param {GameState | PlayerView} state @param {string} pid @param {string} f */
const myStanding = (state, pid, f) => (swayRequired(/** @type {GameState} */ (state)) ? state.players[pid].standing[f] ?? 0 : Infinity);
/** Your supply. @param {GameState | PlayerView} state @param {string} pid */
const mySupply = (state, pid) => state.players[pid].supply ?? 0;
/** Raise the Stakes, tokens: where a faction's kin next door can come from, and how many each may send (from a fight, half). @param {GameState} state @param {string} centre @param {string} f */
const stakeSources = (state, centre, f) => adj(state, centre).filter((l) => !state.board[l].scorched && freeOf(state, l, f) > 0).map((l) => ({ l, n: freeOf(state, l, f) }));


/** Start a round's draft: shuffle all 21 cards, deal hands, leave the rest out (PS1, DR4, DR5). @param {GameState} state */
function deal(state) {
  const handSize = /** @type {Record<string, number>} */ (spec.constants.handSize)[String(state.seating.length)];
  const s = shuffle(deckOf(), state.rngState);
  state.rngState = s.rngState;
  state.seating.forEach((pid, i) => {
    const p = state.players[pid];
    p.batch = s.items.slice(i * handSize, (i + 1) * handSize);
    p.kept = [];
    p.hand = [];
    p.picked = false;
  });
  state.leftOut = s.items.slice(state.seating.length * handSize);
  state.roundPlays = [];
  state.phase = 'draft';
  state.pass = 1;
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
  if (!t.location || !t.faction || tokensOf(state, t.location, t.faction) <= 0) return 'Choose a group on the board.';
  if (!card.suit) return null;
  if (t.mode === 'location') return suitLocations(card).includes(t.location) ? null : 'That location is not one of the suit\'s.';
  if (t.mode === 'faction') return t.faction === suitFaction(state, card) ? null : 'That group is not the suit\'s faction.';
  return 'Choose a location target or a faction target.';
}



/** Place 1 of the player's sway at a location, spent from standing with a faction (if they have it). @param {GameState} state @param {string} pid @param {string} f @param {string} loc */
function placeOne(state, pid, f, loc) {
  if ((state.players[pid].standing[f] ?? 0) <= 0) return;
  state.players[pid].standing[f] -= 1;
  state.board[loc].sway[pid] = (state.board[loc].sway[pid] ?? 0) + 1;
}

/**
 * Spill Blood on the Altar (⎈ signature, designer 2026-10-18) and Study the Bodies (ↂ, 2026-10-19): the locations
 * they can mark, each with the faction whose standing pays its 1 sway. Faction reading: any location holding the suit's
 * faction, paid by it. Location reading: any suit location, paid by a faction there (the player's choice), or by the
 * suit's faction when it is empty (`empty`).
 * @param {GameState} state @param {Card} card @param {'location' | 'faction'} mode
 */
function altarMarks(state, card, mode) {
  const sf = /** @type {string} */ (suitFaction(state, card));
  const open = LOCATION_IDS.filter((l) => !state.board[l].scorched);
  if (mode === 'faction') return { held: open.filter((l) => tokensOf(state, l, sf) > 0).map((l) => ({ location: l, faction: sf })), empty: /** @type {string[]} */ ([]) };
  const spots = open.filter((l) => suitLocations(card).includes(l));
  return { held: spots.flatMap((l) => factionsAt(state, l).map((f) => ({ location: l, faction: f }))), empty: spots.filter((l) => !factionsAt(state, l).length) };
}

/**
 * Night Terrors (◐ signature, designer 2026-10-20): at nightfall, who may flee a mark: 1 token of a faction there with
 * one free to leave (from a fight, half: D22), to any neighbouring location it can enter (never making three factions).
 * @param {GameState} state @param {string} loc
 */
export const fleeOptions = (state, loc) => factionsAt(state, loc).filter((f) => freeOf(state, loc, f) > 0).map((f) => ({ faction: f, to: burstSpots(state, loc, f) })).filter((o) => o.to.length);

/** The marks a Spill Blood or Study the Bodies target names: the held locations with their payers, then the empty ones (the Demons pay). @param {GameState} state @param {Card} card @param {Target} t */
const altarChosen = (state, card, t) => [
  ...(t.moves ?? []).filter((m) => m.location !== '__stop').map((m) => ({ location: m.location, faction: m.faction })),
  ...(t.from ?? []).filter((l) => l !== '__stop').map((l) => ({ location: l, faction: /** @type {string} */ (suitFaction(state, card)) })),
];

/**
 * The Gate (designer, 2026-10-17): can this location be one of its ends? Any ↂ location, or any location holding the
 * Sci-Fi faction; not scorched, and not already joined.
 * @param {GameState} state @param {Card} card @param {string | undefined} loc
 */
const gateEnd = (state, card, loc) => !!loc && !!state.board[loc] && !state.board[loc].scorched && !gateOf(state, loc)
  && (suitLocations(card).includes(loc) || factionsAt(state, loc).includes(/** @type {string} */ (suitFaction(state, card))));
/** The factions present across two locations. @param {GameState} state @param {string} a @param {string} b */
const factionsAcross = (state, a, b) => [...new Set([...factionsAt(state, a), ...factionsAt(state, b)])];

/**
 * Draw Them Away (☾ shift, designer 2026-10-17; was the ◐ shift Crash the Party, then Set Off the Fireworks): the neighbours a bursting group of `f` at `loc` can send a token to:
 * ones it can enter, not scorched.
 * @param {GameState} state @param {string} loc @param {string} f
 */
const burstSpots = (state, loc, f) => adj(state, loc).filter((l) => !state.board[l].scorched && canEnter(state, l, f));


/**
 * Take Control (⏏ signature, working name; designer 2026-10-18): how many of `f`'s tokens you may turn into trophies at
 * `loc`: 1 of your sway there for each, up to the card's sway (D24) and the tokens there. Location reading: any fight
 * at a ⏏ location, any faction there hit. Faction reading: any fight the Sentients are in, a rival of theirs hit.
 * @param {GameState} state @param {string} pid @param {Card} card @param {Target} t
 */
function controlRoom(state, pid, card, t) {
  const loc = t.location, f = t.faction, sent = factionOfArchetype(state, 'sentients');
  if (!loc || !f || !state.board[loc] || state.board[loc].scorched) return 0;
  const here = factionsAt(state, loc);
  if (here.length < 2 || !here.includes(f)) return 0;
  if (t.mode === 'location' ? !suitLocations(card).includes(loc) : !sent || !here.includes(sent) || f === sent) return 0;
  return Math.min(swayFor(state, pid, card.id), state.board[loc].sway[pid] ?? 0, tokensOf(state, loc, f));
}

/**
 * Wake the Dead (☾ signature, designer 2026-10-18; first named Raise the Dead): how many of the dead you may raise at
 * `loc`, up to the card's sway (D24), your standing with the faction paying (`payer`; absent: the best of them) and the
 * Undead supply. Location reading: any ☾
 * location: empty, a lone group (a fight with the Undead), or a fight without them (a three-way fight, the only way one
 * happens). Faction reading: anywhere the Undead are; the risen join their group. A Gate's ends never hold three factions.
 * @param {GameState} state @param {string} pid @param {string} loc @param {'location' | 'faction' | undefined} mode @param {string} [payer]
 */
function raiseRoom(state, pid, loc, mode, payer) {
  const undead = factionOfArchetype(state, 'undead');
  const place = state.board[loc];
  if (!undead || !place || place.scorched) return { undead, max: 0, payers: /** @type {string[]} */ ([]) };
  const here = factionsAt(state, loc);
  const ok = mode === 'faction' ? here.includes(undead) : alignmentOf(loc) === 'undead' && (here.includes(undead) || here.length < 2 || !gateOf(state, loc));
  if (!ok) return { undead, max: 0, payers: /** @type {string[]} */ ([]) };
  // Who pays the bid (common rule 8, designer 2026-10-20): faction reading, the Undead; location reading, a faction
  // there, the risen Undead included.
  const payers = mode === 'faction' ? [undead] : [...new Set([undead, ...here])];
  const room = (/** @type {string} */ f) => Math.min(swayFor(state, pid, 'wake-the-dead'), swayRequired(state) ? state.players[pid].standing[f] ?? 0 : Infinity, state.supply[undead] ?? 0);
  const max = payer ? (payers.includes(payer) ? room(payer) : 0) : Math.max(0, ...payers.map(room));
  return { undead, max, payers: payers.filter((f) => room(f) > 0) };
}

/**
 * Plough Through (◐ shift, designer 2026-10-17): the sides of the fight at `loc` and their exits. Every side sends out
 * half, rounded up (the card's deliberate exception to D22: a side of 1 leaves entirely, and the fight can break), to
 * neighbours it can enter. Sides in the order of state.factions; a target lists one exit per token, side by side.
 * @param {GameState} state @param {string} loc
 */
const ploughSides = (state, loc) => state.factions.filter((f) => factionsAt(state, loc).includes(f))
  .map((f) => ({ f, n: Math.ceil(tokensOf(state, loc, f) / 2), spots: burstSpots(state, loc, f) }));
/**
 * Plough Through: can the exits chosen so far (`from`) be finished? No location takes two sides, and under D21 the
 * standing you hold with the factions that may pay covers every exit and the fight.
 * @param {GameState} state @param {string} pid @param {Card} card @param {string} loc @param {string[]} from
 */
function ploughFits(state, pid, card, loc, from) {
  const sides = ploughSides(state, loc);
  /** @type {string[][]} */ const used = [];
  let i = 0;
  for (const side of sides) { used.push(from.slice(i, i + side.n)); i += side.n; }
  if (from.length > i) return false;
  const taken = (/** @type {number} */ k) => new Set(used.flatMap((u, j) => (j === k ? [] : u)));
  for (const [k, side] of sides.entries()) if (used[k].some((l) => !side.spots.includes(l) || taken(k).has(l))) return false;
  // The sides still to open an exit each need one free location, distinct from the others' (a small matching).
  const need = sides.map((side, k) => ({ side, k })).filter(({ k }) => !used[k].length);
  const held = new Set(used.flat());
  // The card's stated break (designer, 2026-10-21): 1 at each exit and 1 at the fight, split as you choose among
  // the fight's factions and the Nocturnals; all or nothing.
  const budget = swayRequired(state) ? ploughPool(state, card, loc).reduce((n, f) => n + (state.players[pid].standing[f] ?? 0), 0) : Infinity;
  if (held.size + need.length + 1 > budget) return false;
  /** @type {(j: number, busy: Set<string>) => boolean} */
  const match = (j, busy) => j === need.length || need[j].side.spots.some((l) => !busy.has(l) && match(j + 1, new Set([...busy, l])));
  return match(0, held);
}

/** Plough Through: who may pay: the fight's factions, and the Nocturnals if they aren't in it (designer, 2026-10-21). @param {GameState} state @param {Card} card @param {string} loc */
const ploughPool = (state, card, loc) => [...new Set([...factionsAt(state, loc), /** @type {string} */ (suitFaction(state, card))])];

/**
 * Cut the Powerlines (⏏ shift, designer 2026-10-17): the faction's other groups a group of `f` at `loc` can rejoin,
 * anywhere on the island (fights too): locations holding `f` it can enter, not scorched. Both
 * ends of a Gate are one group, listed once.
 * @param {GameState} state @param {string} loc @param {string} f
 */
const kinOf = (state, loc, f) => {
  const ends = endsOf(state, loc);
  return LOCATION_IDS.filter((l) => !ends.includes(l) && rawTokens(state, l, f) > 0 && !(gateOf(state, l) && /** @type {string} */ (gateOf(state, l)) < l && rawTokens(state, /** @type {string} */ (gateOf(state, l)), f) > 0)
    && !state.board[l].scorched && canEnter(state, l, f));
};
/**
 * Cut the Powerlines: how the tokens share out. A lone group leaves entirely; from a fight exactly half, rounded down
 * (D22). 1 at a time round the kin: each gets `each`, and `extra` of them (the player's choice) one more.
 * @param {GameState} state @param {string} loc @param {string} f
 */
const powerShare = (state, loc, f) => {
  const kin = kinOf(state, loc, f), n = freeOf(state, loc, f);
  return { kin, n, each: kin.length ? Math.floor(n / kin.length) : 0, extra: kin.length ? n % kin.length : 0, reached: Math.min(n, kin.length) };
};

/**
 * The Big Chase (ↂ shift, designer 2026-10-17): where a chased group of `f` may go next from `at`: a neighbour it can
 * enter (empty, its own kind, a lone rival, or a fight it's part of), not one already on the chase, not scorched.
 * @param {GameState} state @param {string} at @param {string} f @param {string[]} chase  the start and the steps so far
 */
const chaseSteps = (state, at, f, chase) => adj(state, at).filter((l) => !chase.some((x) => endsOf(state, x).includes(l)) && !state.board[l].scorched
  && canEnter(state, l, f));

/**
 * Perform the Ritual (⎈ strike, designer 2026-10-17): a gravity well from next door. The groups of `f` next to the
 * centre: lone ones come whole; one in a fight may send up to half, rounded down (at least half stays, so no fight
 * ends).
 * @param {GameState} state @param {string} centre @param {string} f
 */
function wellSources(state, centre, f) {
  const near = adj(state, centre).filter((l) => !state.board[l].scorched && tokensOf(state, l, f) > 0);
  return {
    lone: near.filter((l) => loneAt(state, l) === f),
    fights: near.filter((l) => factionsAt(state, l).length >= 2 && Math.floor(tokensOf(state, l, f) / 2) > 0),
  };
}
/** How many of `f` a fight next door may send: half, rounded down. @param {GameState} state @param {string} l @param {string} f */
const wellShare = (state, l, f) => Math.floor(tokensOf(state, l, f) / 2);

/**
 * Bait the Herd (☾ strike, designer 2026-10-17): the next steps a herd of `f` may take from `at`. A pick-up: a neighbour
 * holding its own kind, either a lone group (all of it comes) or its kind in a fight (as much as may leave a fight,
 * D22: half, rounded down); never a location already on the trail. The crash: a neighbour held by a lone group of another faction.
 * Lock Down's borders hold.
 * @param {GameState} state @param {string} at @param {string} f @param {string[]} trail  the start and the stops so far
 */
function trailSteps(state, at, f, trail) {
  const open = adj(state, at).filter((l) => !trail.some((x) => endsOf(state, x).includes(l)) && !state.board[l].scorched);
  const pickups = open.filter((l) => loneAt(state, l) === f || (factionsAt(state, l).length >= 2 && tokensOf(state, l, f) > 0 && freeOf(state, l, f) > 0));
  const crashes = open.filter((l) => loneAt(state, l) && loneAt(state, l) !== f);
  return { pickups, crashes };
}

/**
 * Spoof the Signal (⏏ strike, designer 2026-10-17): where a group at `loc` may march (from a fight, half; 2026-10-18). The spoofed order: the
 * largest lone group of another faction within two locations of it (steps between neighbours, a Gate's ends as one;
 * whatever lies between is ignored). Several tied for largest: any of them, the player's choice.
 * @param {GameState} state @param {string} loc @param {string} f
 */
function threatsOf(state, loc, f) {
  const ends = endsOf(state, loc);
  const near = new Set(adj(state, loc));
  for (const l of [...near]) for (const m of adj(state, l)) near.add(m);
  const rivals = [...near].filter((l) => !ends.includes(l) && loneAt(state, l) && loneAt(state, l) !== f && canEnter(state, l, f));
  const most = Math.max(0, ...rivals.map((l) => tokensOf(state, l, /** @type {string} */ (loneAt(state, l)))));
  return rivals.filter((l) => tokensOf(state, l, /** @type {string} */ (loneAt(state, l))) === most);
}

/** The one faction at a location, if exactly one is there (a group not otherwise engaged), else null. @param {GameState} state @param {string} loc */
const loneAt = (state, loc) => { const here = factionsAt(state, loc); return !state.board[loc].scorched && here.length === 1 ? here[0] : null; };

/**
 * Invite Them In (designer, 2026-10-15): the groups that may be invited into `to`. Location reading: groups next
 * door, any faction, into an empty location. Faction reading: a Nocturnal group next door, into a location held
 * by a lone group of another faction (the host).
 * @param {GameState} state @param {Card} card @param {'location' | 'faction'} mode @param {string} to
 */
function guestsOf(state, card, mode, to) {
  const sf = suitFaction(state, card);
  return adj(state, to).flatMap((l) => factionsAt(state, l).map((f) => ({ location: l, faction: f })))
    .filter((g) => canLeave(state, g.location, g.faction) && (mode === 'location' || g.faction === sf) && g.faction !== loneAt(state, to));
}







/**
 * A way back for factions (designer, 2026-10-26; a third way to play a suit card): while the suit's faction has no
 * location with 2 or more of its tokens, up to X of its tokens (X the card's sway) come back from its supply, at its
 * suit locations or where it already is, each paid with 1 standing with it (back to your supply). Where they may go,
 * and how many at most; none while the faction can still grow somewhere.
 * @param {GameState} state @param {string} pid @param {string} cardId
 */
export function returnRoom(state, pid, cardId) {
  const card = cardById(cardId);
  if (!card.suit) return { spots: /** @type {string[]} */ ([]), max: 0, faction: '' };
  const f = /** @type {string} */ (factionOfArchetype(state, card.suit));
  if ((state.options.wayBack ?? 'on') === 'off') return { spots: /** @type {string[]} */ ([]), max: 0, faction: f };
  if (LOCATION_IDS.some((l) => rawTokens(state, l, f) >= 2)) return { spots: /** @type {string[]} */ ([]), max: 0, faction: f };
  const spots = LOCATION_IDS.filter((l) => !state.board[l].scorched && (suitLocations(card).includes(l) || rawTokens(state, l, f) > 0) && canEnter(state, l, f));
  const max = Math.min(swayFor(state, pid, cardId), state.supply[f] ?? 0, swayRequired(state) ? state.players[pid].standing[f] ?? 0 : Infinity);
  return { spots, max: spots.length ? max : 0, faction: f };
}

/** Moves refused for want of standing (IC1), counted so checkTarget can tell when paying changed nothing. Not a rule. */
let unpaidMoves = 0;

/**
 * Check a target for a card's turn action. Returns an error, or null.
 * @param {GameState} state @param {string} pid @param {Card} card @param {Target | null | undefined} t
 */
export function checkTarget(state, pid, card, t) {
  // Memoised per state object while a bot searches (memoising): there states are not changed once built, and the same
  // question is asked many times. Not a rule.
  if (!memoDepth) return checkTargetNow(state, pid, card, t);
  let memo = TARGET_MEMO.get(state);
  if (!memo) { memo = new Map(); TARGET_MEMO.set(state, memo); }
  const key = `${pid}|${card.id}|${JSON.stringify(t ?? null)}`;
  const hit = memo.get(key);
  if (hit !== undefined) return hit;
  const reason = checkTargetNow(state, pid, card, t);
  memo.set(key, reason);
  return reason;
}
/** @type {WeakMap<object, Map<string, string | null>>} */
const TARGET_MEMO = new WeakMap();
let memoDepth = 0;
/**
 * Runs `fn` with per-state memos on (checkTarget here, projections in the bots): for callers that never change a
 * state after asking about it, such as a bot's search. A speed-up, not a rule.
 * @template T @param {() => T} fn @returns {T}
 */
export function memoising(fn) {
  memoDepth += 1;
  try { return fn(); } finally { memoDepth -= 1; }
}
/** Whether memoising is on (for the bots' own memos). */
export const memoOn = () => memoDepth > 0;

/** checkTarget, uncached. @param {GameState} state @param {string} pid @param {Card} card @param {Target | null | undefined} t */
function checkTargetNow(state, pid, card, t) {
  const reason = checkShape(state, pid, card, t);
  if (reason || !t || !swayRequired(state)) return reason;
  const tokensAfter = (/** @type {Options} */ options) => {
    const copy = /** @type {GameState} */ (/** @type {unknown} */ (cloneState({ board: state.board, players: state.players, factions: state.factions, supply: state.supply, round: state.round, options, log: [] }))); // no roundPlays: as before the port, a copied Playbook play isn't re-checked here (to review)
    act(copy, pid, card, t);
    return JSON.stringify(LOCATION_IDS.map((l) => copy.board[l].tokens));
  };
  const refused = unpaidMoves;
  const paid = tokensAfter(state.options);
  // All or nothing (designer, 2026-10-15; variant payInFull): every move the card makes must be paid for. Inside a card's
  // action, only a move refused for want of standing makes paying differ from not paying; if none was, they match.
  const inFull = (state.options.payInFull ?? 'on') === 'on';
  if (inFull && unpaidMoves === refused) return null;
  const free = tokensAfter({ ...state.options, swayRequired: 'off' });
  if (inFull) return paid === free ? null : 'You need the sway to pay for all of it (all or nothing).';
  // IC1 as first drafted: the card must be payable for at least one of its moves.
  const before = JSON.stringify(LOCATION_IDS.map((l) => state.board[l].tokens));
  if (paid === before && free !== before) return 'You need standing with the faction to pay for the sway this move places (IC1).';
  return null;
}

/** The target's shape, before IC1. @param {GameState} state @param {string} pid @param {Card} card @param {Target | null | undefined} t @returns {string | null} */
function checkShape(state, pid, card, t) {
  card = card;
  if (!card.action) return 'This card has no turn action.';
  if (!t) return null; // a card with no legal target may be played for no effect (partial actions)
  switch (card.action) {
    case 'burst': {
      const loc = t.location, f = t.faction, sf = suitFaction(state, card);
      if (t.mode !== 'location' && t.mode !== 'faction') return 'Choose a location target or a faction target.';
      if (!loc || !f || !state.board[loc] || !canLeave(state, loc, f) || (t.mode === 'location' ? !suitLocations(card).includes(loc) : f !== sf)) return t.mode === 'location' ? 'Choose a group at a ☾ location.' : 'Choose an Undead group.';
      const to = (t.from ?? []).filter((l) => l !== '__stop');
      const spots = burstSpots(state, loc, f);
      if (to.length < 2 || new Set(to).size !== to.length || to.some((l) => !spots.includes(l))) return 'It bursts to at least two neighbouring locations it can enter, 1 token each.';
      if (to.length > freeOf(state, loc, f)) return 'One token to each: not more locations than tokens free to leave (from a fight, half).';
      return swayRequired(state) && (state.players[pid].standing[f] ?? 0) < to.length + 1 ? 'You need the sway to pay where it leaves and at every location a token reaches (all or nothing).' : null;
    }
    case 'control': {
      if (t.mode !== 'location' && t.mode !== 'faction') return 'Choose a location target or a faction target.';
      const max = controlRoom(state, pid, card, t);
      if (max <= 0) return t.mode === 'location' ? 'Choose a fight at a ⏏ location where you have sway, then the faction hit.' : 'Choose a fight the Sentients are in where you have sway, then their rival.';
      const n = (t.from ?? []).filter((l) => l === t.location).length;
      return n >= 1 && n <= max ? null : `Turn 1 to ${max} tokens into trophies: 1 of your sway there for each, up to the card's sway.`;
    }
    case 'raise': {
      if (t.mode !== 'location' && t.mode !== 'faction') return 'Choose a location target or a faction target.';
      const payer = t.mode === 'faction' ? factionOfArchetype(state, 'undead') : t.payer;
      if (!t.location || raiseRoom(state, pid, t.location, t.mode).max <= 0) return t.mode === 'location' ? 'Choose a ☾ location, with the standing to pay for the dead.' : 'Choose a location holding the Undead, with standing with them to raise more.';
      const { max } = raiseRoom(state, pid, t.location, t.mode, payer);
      if (!payer || max <= 0) return 'Choose whose standing pays: a faction there, the risen Undead included.';
      const n = (t.from ?? []).filter((l) => l === t.location).length;
      return n >= 1 && n <= max ? null : `Raise from 1 to ${max} of the dead: up to the card's sway, your standing with the faction paying and the Undead supply.`;
    }
    case 'plough': {
      const loc = t.location, sf = suitFaction(state, card);
      if (t.mode !== 'location' && t.mode !== 'faction') return 'Choose a location target or a faction target.';
      if (!loc || !state.board[loc] || state.board[loc].scorched || factionsAt(state, loc).length < 2 || (t.mode === 'location' ? !suitLocations(card).includes(loc) : !factionsAt(state, loc).includes(/** @type {string} */ (sf)))) return t.mode === 'location' ? 'Choose a fight at a ◐ location.' : 'Choose a fight the Nocturnals are in.';
      const from = (t.from ?? []).filter((l) => l !== '__stop');
      const total = ploughSides(state, loc).reduce((n, side) => n + side.n, 0);
      if (from.length !== total) return `Every side leaves by half, rounded up: choose ${total} exits, one per token.`;
      if (!ploughFits(state, pid, card, loc, from)) return 'Each side goes out to neighbours it can enter, never where another side goes, and you need the sway for every exit and the fight (all or nothing).';
      const payers = t.payers ?? [], pool = ploughPool(state, card, loc);
      if (payers.length !== new Set(from).size + 1 || payers.some((f) => !pool.includes(f))) return 'Choose who pays each sway: a faction in the fight, or the Nocturnals.';
      return swayRequired(state) && pool.some((f) => payers.filter((x) => x === f).length > (state.players[pid].standing[f] ?? 0)) ? 'You need the standing for each sway you split (all or nothing).' : null;
    }
    case 'rejoin': {
      const loc = t.location, f = t.faction, sf = suitFaction(state, card);
      if (t.mode !== 'location' && t.mode !== 'faction') return 'Choose a location target or a faction target.';
      if (!loc || !f || !state.board[loc] || !factionsAt(state, loc).includes(f) || (t.mode === 'location' ? !suitLocations(card).includes(loc) : f !== sf)) return t.mode === 'location' ? 'Choose a group at a ⏏ location.' : 'Choose a Sentients group.';
      const { kin, n, extra, reached } = powerShare(state, loc, f);
      if (!kin.length || n <= 0) return 'It needs another group of its faction to rejoin, and tokens free to leave.';
      const to = (t.from ?? []).filter((l) => l !== '__stop');
      if (to.length !== extra || new Set(to).size !== to.length || to.some((l) => !kin.includes(l))) return `Choose ${extra} of its other groups to get one more token each (1 at a time round them all).`;
      return swayRequired(state) && (state.players[pid].standing[f] ?? 0) < reached + 1 ? 'You need the sway to pay where it leaves and at every location a token reaches (all or nothing).' : null;
    }
    case 'chase': {
      const start = t.location, f = t.faction, sf = suitFaction(state, card);
      if (t.mode !== 'location' && t.mode !== 'faction') return 'Choose a location target or a faction target.';
      if (!start || !f || !state.board[start] || !canLeave(state, start, f) || (t.mode === 'location' ? !suitLocations(card).includes(start) : f !== sf)) return t.mode === 'location' ? 'Choose a group at an ↂ location (from a fight, half of it).' : 'Choose a Sci-Fi group (from a fight, half of it).';
      const path = (t.path ?? []).filter((l) => l !== '__stop');
      if (!path.length) return 'Lead the chase at least one step.';
      const chase = [start];
      for (const l of path) {
        if (!chaseSteps(state, chase[chase.length - 1], f, chase).includes(l)) return 'The chase goes from neighbour to neighbour, where the group can enter, never back.';
        chase.push(l);
      }
      // 1 token and 1 sway stay at each location passed; at least 1 token arrives; 1 sway at the end too.
      if (path.length > freeOf(state, start, f)) return 'At least 1 token must arrive: a token stays at every location passed.';
      return swayRequired(state) && (state.players[pid].standing[f] ?? 0) < path.length + 1 ? 'You need the sway to pay at every location on the chase, the start too (all or nothing).' : null;
    }
    case 'well': {
      const centre = t.location, f = t.faction, sf = /** @type {string} */ (suitFaction(state, card));
      if (t.mode !== 'location' && t.mode !== 'faction') return 'Choose a location target or a faction target.';
      if (!centre || !state.board[centre] || state.board[centre].scorched || factionsAt(state, centre).length > 1) return 'Choose a centre that is empty or holds one faction.';
      if (t.mode === 'location' ? !suitLocations(card).includes(centre) : f !== sf) return t.mode === 'location' ? 'The centre is a ⎈ location.' : 'The ritual calls the Demon faction.';
      if (!f || (factionsAt(state, centre).length === 1 && !canEnter(state, centre, f))) return 'Choose the faction the ritual calls.';
      const { lone, fights } = wellSources(state, centre, f);
      const picks = (t.from ?? []).filter((l) => l !== '__stop');
      for (const l of new Set(picks)) if (!fights.includes(l) || picks.filter((x) => x === l).length > wellShare(state, l, f)) return 'From a fight, up to half of the group, rounded down.';
      const origins = lone.length + new Set(picks).size;
      if (!origins) return 'Nothing of that faction is next door to answer.';
      return swayRequired(state) && (state.players[pid].standing[f] ?? 0) < origins + 1 ? 'You need the sway to pay at every location pulled from and at the centre (all or nothing).' : null;
    }
    case 'herd': {
      const start = t.location, f = t.faction, sf = suitFaction(state, card);
      if (t.mode !== 'location' && t.mode !== 'faction') return 'Choose a location target or a faction target.';
      if (!start || !f || !state.board[start] || !canLeave(state, start, f) || (t.mode === 'location' ? !suitLocations(card).includes(start) : f !== sf)) return t.mode === 'location' ? 'Choose a group at a ☾ location (from a fight, half of it).' : 'Choose an Undead group (from a fight, half of it).';
      const path = (t.path ?? []).filter((l) => l !== '__stop');
      if (!path.length) return 'Lay the trail: at least one stop, or a group to crash into.';
      // Every stop picks up its own kind; it may end at its last stop (plain movement, designer) or crash into a lone rival.
      const trail = [start];
      for (const [i, l] of path.entries()) {
        const { pickups, crashes } = trailSteps(state, trail[trail.length - 1], f, trail);
        if (!pickups.includes(l) && !(i === path.length - 1 && crashes.includes(l))) return i < path.length - 1 ? 'Each stop must hold its own kind: a lone group, or its kind in a fight that some can leave.' : 'The trail ends at a stop, or crashing into a lone group of another faction.';
        trail.push(l);
      }
      return swayRequired(state) && (state.players[pid].standing[f] ?? 0) < path.length + 1 ? 'You need the sway to pay at every location on the trail (all or nothing).' : null;
    }
    case 'threat': {
      const loc = t.location, f = t.faction, sf = suitFaction(state, card);
      if (t.mode !== 'location' && t.mode !== 'faction') return 'Choose a location target or a faction target.';
      if (!loc || !f || !state.board[loc] || !canLeave(state, loc, f) || (t.mode === 'location' ? !suitLocations(card).includes(loc) : f !== sf)) return t.mode === 'location' ? 'Choose a group at a ⏏ location.' : 'Choose a Sentient group.';
      if (!t.to || !threatsOf(state, loc, f).includes(t.to)) return 'It marches on the largest lone group of another faction within two locations.';
      return swayRequired(state) && (state.players[pid].standing[f] ?? 0) < 2 ? 'You need the sway to pay where it leaves and at the fight (all or nothing).' : null;
    }
    case 'gate': {
      const a = t.location, b = t.to, sf = /** @type {string} */ (suitFaction(state, card));
      if (t.mode !== 'location' && t.mode !== 'faction') return 'Choose a location target or a faction target.';
      if (!gateEnd(state, card, a) || !gateEnd(state, card, b) || a === b) return 'Join two locations: each an ↂ location or one holding the Sci-Fi faction.';
      const across = factionsAcross(state, /** @type {string} */ (a), /** @type {string} */ (b));
      if (across.length > 2) return 'The Gate can\'t join locations holding three or more factions between them.';
      if (!t.payer || ![sf, ...across].includes(t.payer)) return 'Choose the faction whose sway pays: the Sci-Fi faction or one at either end.';
      if (swayRequired(state) && (state.players[pid].standing[t.payer] ?? 0) < 1) return 'You need the sway to pay (all or nothing).';
      return t.losses === a || t.losses === b ? null : 'Choose the end the winner\'s losses come from.';
    }
    case 'invite': {
      // Invite Them In: all of it, or it can't be played (designer).
      const to = t.location, sf = /** @type {string} */ (suitFaction(state, card));
      if (!to || !state.board[to] || state.board[to].scorched) return 'Choose a location on the board.';
      if (t.mode !== 'location' && t.mode !== 'faction') return 'Choose a location target or a faction target.';
      const host = loneAt(state, to);
      if (t.mode === 'location' ? !suitLocations(card).includes(to) || factionsAt(state, to).length : !host || host === sf) return t.mode === 'location' ? 'Choose an empty ◐ location.' : 'Choose a location held by a lone group of another faction.';
      const guests = t.moves ?? [], ok = guestsOf(state, card, t.mode, to);
      if (guests.length !== (t.mode === 'location' ? 2 : 1) || guests.some((g) => !ok.some((o) => o.location === g.location && o.faction === g.faction))) return 'Choose the groups to invite.';
      if (guests.length === 2 && (guests[0].faction === guests[1].faction || guests[0].location === guests[1].location)) return 'Invite two groups of different factions.';
      const payer = t.mode === 'faction' ? sf : t.payer;
      if (!payer || !guests.some((g) => g.faction === payer)) return 'Choose which invited faction pays at the fight.';
      if (swayRequired(state) && guests.some((g) => (state.players[pid].standing[g.faction] ?? 0) < 1 + (g.faction === payer ? 1 : 0))) return 'You need the sway to pay at every location.';
      return null;
    }
    case 'split': {
      // Light of the Cross (reworked from Board Up the Windows; designer, 2026-10-15): the group splits evenly between exactly two adjacent locations
      // (the player chooses which takes an odd token); both must take the faction, and both must be paid for.
      const e = groupTarget(state, card, t);
      if (e) return e;
      const loc = /** @type {string} */ (t.location), f = /** @type {string} */ (t.faction);
      const split = t.split ?? {};
      const dests = Object.keys(split).filter((d) => split[d] > 0);
      const n = freeOf(state, loc, f);
      if (n < 2) return 'A group of 1 can\'t be split.';
      if (dests.length !== 2 || dests.some((d) => !adj(state, loc).includes(d) || !canEnter(state, d, f))) return 'Split between two adjacent locations that can take the group.';
      const sizes = dests.map((d) => split[d]).sort((a, b) => a - b);
      if (sizes[0] !== Math.floor(n / 2) || sizes[1] !== Math.ceil(n / 2)) return 'Split the group evenly.';
      const cost = num(state, 'swayPerMove');
      if (swayRequired(state) && cost > 0 && (state.players[pid].standing[f] ?? 0) < 2 * cost + 1) return 'You need the sway to pay where it leaves and at both locations.';
      return null;
    }
    case 'favours': {
      // A, Call in Favours: 1 sway from your supply at each of up to X fights, or up to X standing with one faction.
      const x = Math.min(handX(state, pid, card.id), mySupply(state, pid));
      if (t.use === 'sway') {
        const at = picked(t.from);
        if (!at.length || new Set(at).size !== at.length || at.some((l) => !fightsNow(state).includes(l))) return 'Pick fights, each once.';
        return at.length <= x ? null : 'At most the cards in your hand, and what your supply holds.';
      }
      if (t.use === 'standing') {
        const fs = picked(t.payers);
        if (!fs.length || fs.some((f) => f !== fs[0]) || !state.factions.includes(fs[0])) return 'Pick one faction.';
        return fs.length <= x ? null : 'At most the cards in your hand, and what your supply holds.';
      }
      return 'Pick a use: sway at fights, or standing.';
    }
    case 'stakes': {
      // B, Raise the Stakes (gather).
      const x = handX(state, pid, card.id);
      if (t.use === 'standing') {
        const to = t.faction, from = picked(t.payers);
        if (!to || !state.factions.includes(to)) return 'Pick the faction to raise your stake with.';
        if (!from.length || from.length > x || new Set(from).size !== from.length || from.some((f) => f === to || !state.factions.includes(f) || myStanding(state, pid, f) < 1)) return 'Take 1 standing from each of up to X other factions you have standing with.';
        return null;
      }
      if (t.use === 'sway') {
        const to = t.location, from = picked(t.from), n = tally(from);
        if (!to || !state.board[to] || state.board[to].scorched) return 'Pick where your sway gathers.';
        if (!from.length || from.length > x || Object.entries(n).some(([l, k]) => !adj(state, to).includes(l) || mySway(state, pid, l) < k)) return 'Gather up to X of your sway from next door.';
        return null;
      }
      if (t.use === 'tokens') {
        const to = t.location, f = t.faction, from = picked(t.from), n = tally(from);
        if (!to || !state.board[to] || state.board[to].scorched || mySway(state, pid, to) < 1) return 'Pick a location where you have sway.';
        if (!f || !canEnter(state, to, f)) return 'Pick a faction that can come in.';
        const src = stakeSources(state, to, f);
        if (!from.length || from.length > x || Object.entries(n).some(([l, k]) => (src.find((q) => q.l === l)?.n ?? 0) < k)) return 'Up to X of its tokens come in from next door (from a fight, half).';
        return myStanding(state, pid, f) < Object.keys(n).length + 1 ? 'You need the sway to pay where they leave and where they arrive (all or nothing).' : null;
      }
      return 'Pick a use: standing, sway on the board, or tokens.';
    }
    case 'exit': {
      // C, Cover Every Exit (scatter).
      const x = handX(state, pid, card.id);
      if (t.use === 'standing') {
        const from = t.faction, to = picked(t.payers);
        if (!from || !state.factions.includes(from)) return 'Pick the faction to spread your standing from.';
        if (!to.length || to.length > Math.min(x, myStanding(state, pid, from)) || new Set(to).size !== to.length || to.some((f) => f === from || !state.factions.includes(f))) return 'Move 1 standing to each of up to X other factions.';
        return null;
      }
      if (t.use === 'sway') {
        const from = t.location, to = picked(t.from);
        if (!from || !state.board[from] || mySway(state, pid, from) < 1) return 'Pick a location where you have sway.';
        if (!to.length || to.length > Math.min(x, mySway(state, pid, from)) || new Set(to).size !== to.length || to.some((l) => !adj(state, from).includes(l) || state.board[l].scorched)) return 'Send 1 of your sway to each of up to X neighbours.';
        return null;
      }
      if (t.use === 'tokens') {
        const loc = t.location, f = t.faction, to = picked(t.from);
        if (!loc || !f || !state.board[loc] || !canLeave(state, loc, f)) return 'Pick a group (from a fight, half of it).';
        const spots = burstSpots(state, loc, f);
        if (!to.length || to.length > Math.min(x, freeOf(state, loc, f)) || new Set(to).size !== to.length || to.some((l) => !spots.includes(l))) return 'It sends 1 token to each of up to X neighbours it can enter.';
        return myStanding(state, pid, f) < to.length + 1 ? 'You need the sway to pay where it leaves and at every location a token reaches (all or nothing).' : null;
      }
      return 'Pick a use: standing, sway on the board, or tokens.';
    }
    case 'showdown': {
      // D, Showdown: at a lone group, burn your sway there, 1 per token, for as many of its tokens as trophies.
      const loc = t.location, f = t.faction, n = picked(t.from).filter((l) => l === loc).length;
      if (!loc || !f || !state.board[loc] || loneAt(state, loc) !== f) return 'Pick a lone group (never a fight).';
      if (mySway(state, pid, loc) < 1) return 'You need sway there to fight them.';
      return n >= 1 && n <= Math.min(mySway(state, pid, loc), tokensOf(state, loc, f)) ? null : 'As many as your sway there, and the group, allow.';
    }
    case 'switch': {
      // Switch Allegiance (unmarked): standing 1:1 from one faction to another, or your sway from one location to any other.
      const x = handX(state, pid, card.id);
      if (t.use === 'standing') {
        const from = t.faction, to = t.to, n = picked(t.payers).length;
        if (!from || !to || from === to || !state.factions.includes(from) || !state.factions.includes(to)) return 'Pick the faction you leave, then the one you join.';
        return n >= 1 && n <= Math.min(x, myStanding(state, pid, from)) ? null : 'Up to X of your standing with it.';
      }
      if (t.use === 'sway') {
        const from = t.location, to = t.to, n = picked(t.from).length;
        if (!from || !to || from === to || !state.board[from] || !state.board[to] || state.board[to].scorched) return 'Pick where your sway leaves, then where it goes.';
        return n >= 1 && n <= Math.min(x, mySway(state, pid, from)) ? null : 'Up to X of your sway there.';
      }
      return 'Pick a use: standing, or sway on the board.';
    }
    case 'playbook': {
      // Steal Their Playbook (unmarked): theirs, the last card played for its action this round, as if yours; yours, take one of your plays back.
      if (t.use === 'yours') return t.back && ownPlays(state, pid).includes(t.back) ? null : 'Pick a card you played earlier this round.';
      if (t.use === 'theirs') { const last = lastAction(state); return last ? checkShape(state, pid, cardById(last), t) : 'Nothing has been played for its action this round.'; }
      return 'Pick a use: theirs, or yours.';
    }
    case 'altar': case 'study': case 'terror': {
      if (t.mode !== 'location' && t.mode !== 'faction') return 'Choose a location target or a faction target.';
      const { held, empty } = altarMarks(state, card, t.mode);
      const marks = altarChosen(state, card, t);
      if (!marks.length) return 'Mark at least one location.';
      if (new Set(marks.map((m) => m.location)).size !== marks.length) return 'Each location takes one mark.';
      if (marks.some((m) => !held.some((h) => h.location === m.location && h.faction === m.faction) && !(empty.includes(m.location) && (t.from ?? []).includes(m.location)))) return t.mode === 'location' ? `Mark ${{ altar: '⎈', study: 'ↂ', terror: '◐' }[card.action]} locations, each paid by a faction there (an empty one by the suit's faction).` : 'Mark locations holding the suit\'s faction.';
      if (marks.length > swayFor(state, pid, card.id)) return 'Mark no more locations than the card\'s sway: 1 sway on each.';
      const owed = /** @type {Record<string, number>} */ ({});
      for (const m of marks) owed[m.faction] = (owed[m.faction] ?? 0) + 1;
      return swayRequired(state) && Object.entries(owed).some(([f, n]) => (state.players[pid].standing[f] ?? 0) < n) ? 'You need the standing for every mark: 1 sway on each (all or nothing).' : null;
    }
    default: return 'Unknown card.';
  }
}


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
    case 'burst': {
      // 1 token to each chosen neighbour (1 sway where it lands, as any move); the rest stay.
      const f = /** @type {string} */ (t.faction), loc = /** @type {string} */ (t.location);
      const to = (t.from ?? []).filter((l) => l !== '__stop');
      let n = 0;
      for (const l of to) n += move(state, pid, f, loc, l, 1, placed);
      placeOne(state, pid, f, loc);
      logLine(state, `${pid}: ${card.name}: the ${names(f)} at ${lname(loc)} scatter${n ? ` to ${to.map(lname).join(', ')}` : ''}.`);
      break;
    }
    case 'control': {
      // The machines turn on their rival: each token falls as your trophy, paid with 1 of your sway there (back to your supply).
      const loc = /** @type {string} */ (t.location), f = /** @type {string} */ (t.faction);
      const n = (t.from ?? []).filter((l) => l === loc).length;
      takeTokens(state, loc, f, n);
      state.players[pid].trophies[f] += n;
      state.board[loc].sway[pid] -= n;
      if (state.board[loc].sway[pid] <= 0) delete state.board[loc].sway[pid];
      state.players[pid].supply += n;
      logLine(state, `${pid}: ${card.name}: the machines cut down ${n} ${names(f)} at ${lname(loc)}.`);
      break;
    }
    case 'raise': {
      // The dead rise; each one risen places 1 of your sway there, the bid, from standing with the faction paying (rule 8).
      const loc = /** @type {string} */ (t.location);
      const undead = /** @type {string} */ (factionOfArchetype(state, 'undead'));
      const n = (t.from ?? []).filter((l) => l === loc).length;
      state.supply[undead] -= n;
      addTokens(state, loc, undead, n);
      const payer = t.mode === 'faction' ? undead : /** @type {string} */ (t.payer ?? undead);
      for (let i = 0; i < n; i++) placeOne(state, pid, payer, loc);
      logLine(state, `${pid}: ${card.name}: ${n} ${names(undead)} rise at ${lname(loc)}.`);
      break;
    }
    case 'plough': {
      // Every side leaves by half, rounded up, through its own exits.
      const loc = /** @type {string} */ (t.location);
      const from = (t.from ?? []).filter((l) => l !== '__stop');
      let i = 0;
      for (const side of ploughSides(state, loc)) {
        const mine = from.slice(i, i + side.n); i += side.n;
        for (const l of new Set(mine)) { placed.add(`${l}:${side.f}`); move(state, pid, side.f, loc, l, mine.filter((x) => x === l).length, placed, true); }
      }
      // 1 at each exit and 1 at the fight, split among the payers as chosen (the card's stated break).
      const spots = [...new Set(from), loc], payers = t.payers ?? [];
      spots.forEach((l, k) => placeOne(state, pid, payers[k], l));
      logLine(state, `${pid}: ${card.name}: the fight at ${lname(loc)} scatters to ${[...new Set(from)].map(lname).join(', ')}.`);
      break;
    }
    case 'rejoin': {
      // The whole group (from a fight, half) rejoins its kin 1 at a time round them all; 1 sway where tokens land.
      const f = /** @type {string} */ (t.faction), loc = /** @type {string} */ (t.location);
      const { kin, each } = powerShare(state, loc, f);
      const extra = (t.from ?? []).filter((l) => l !== '__stop');
      const went = kin.map((l) => ({ l, k: each + (extra.includes(l) ? 1 : 0) })).filter((x) => x.k > 0);
      for (const { l, k } of went) move(state, pid, f, loc, l, k, placed, true);
      placeOne(state, pid, f, loc);
      logLine(state, `${pid}: ${card.name}: the ${names(f)} at ${lname(loc)} scatter to their own at ${went.map((x) => lname(x.l)).join(', ')}.`);
      break;
    }
    case 'chase': {
      // The group runs the chase, leaving 1 token and 1 sway at each location passed; the rest arrive at the end.
      const f = /** @type {string} */ (t.faction), start = /** @type {string} */ (t.location);
      const path = (t.path ?? []).filter((l) => l !== '__stop');
      const n = freeOf(state, start, f); // from a fight, half (D22)
      takeTokens(state, start, f, n);
      placeOne(state, pid, f, start);
      for (const l of path.slice(0, -1)) { addTokens(state, l, f, 1); placeOne(state, pid, f, l); }
      const end = /** @type {string} */ (path[path.length - 1]);
      addTokens(state, end, f, n - (path.length - 1));
      placeOne(state, pid, f, end);
      logLine(state, `${pid}: ${card.name}: ${names(f)} chased from ${lname(start)} to ${lname(end)}${path.length > 1 ? `, leaving stragglers at ${path.slice(0, -1).map(lname).join(', ')}` : ''}.`);
      break;
    }
    case 'well': {
      // Every lone group of the faction next door comes whole; fights next door send what the player chose.
      const centre = /** @type {string} */ (t.location), f = /** @type {string} */ (t.faction);
      const { lone } = wellSources(state, centre, f);
      const picks = (t.from ?? []).filter((l) => l !== '__stop');
      /** @type {[string, number][]} */
      const pulls = [...lone.map((l) => /** @type {[string, number]} */ ([l, tokensOf(state, l, f)])), ...[...new Set(picks)].map((l) => /** @type {[string, number]} */ ([l, picks.filter((x) => x === l).length]))];
      placed.add(`${centre}:${f}`);
      let n = 0;
      for (const [l, k] of pulls) { const m = move(state, pid, f, l, centre, k, placed); if (m) { n += m; placeOne(state, pid, f, l); } }
      if (n) placeOne(state, pid, f, centre);
      logLine(state, `${pid}: ${card.name}: ${n} ${names(f)} are drawn into ${lname(centre)}.`);
      break;
    }
    case 'herd': {
      // The herd swells along the trail, leaving nothing behind, and crashes into the rival at its end.
      const f = /** @type {string} */ (t.faction), start = /** @type {string} */ (t.location);
      const path = (t.path ?? []).filter((l) => l !== '__stop');
      const end = /** @type {string} */ (path[path.length - 1]);
      const crashes = !factionsAt(state, end).includes(f); // the last location holds a rival, not its own kind
      let n = freeOf(state, start, f); // from a fight, half (D22)
      takeTokens(state, start, f, n);
      placeOne(state, pid, f, start);
      for (const l of crashes ? path.slice(0, -1) : path) {
        const k = factionsAt(state, l).length >= 2 ? freeOf(state, l, f) : tokensOf(state, l, f); // from a fight: as much as may leave (D22)
        takeTokens(state, l, f, k);
        n += k;
        placeOne(state, pid, f, l);
      }
      addTokens(state, end, f, n);
      if (crashes) placeOne(state, pid, f, end);
      logLine(state, `${pid}: ${card.name}: ${n} ${names(f)} follow the trail ${crashes ? 'and crash into' : 'to'} ${lname(end)}.`);
      break;
    }
    case 'threat': {
      // The group marches on its target (from a fight, half: move holds D22); 1 sway where it left and 1 at the fight.
      const f = /** @type {string} */ (t.faction), from = /** @type {string} */ (t.location), to = /** @type {string} */ (t.to);
      placed.add(`${to}:${f}`);
      const n = move(state, pid, f, from, to, tokensOf(state, from, f), placed);
      if (n) { placeOne(state, pid, f, from); placeOne(state, pid, f, to); }
      logLine(state, `${pid}: ${card.name}: ${n} ${names(f)} march on ${lname(to)}.`);
      break;
    }
    case 'gate': {
      // The two ends are one location for movement, and fight as one, until the round's fights (joinedFight).
      const a = /** @type {string} */ (t.location), b = /** @type {string} */ (t.to);
      state.board[a].gate = b; state.board[b].gate = a;
      state.board[a].gateLoss = t.losses; state.board[b].gateLoss = t.losses;
      placeOne(state, pid, /** @type {string} */ (t.payer), a);
      logLine(state, `${pid}: ${card.name} joins ${lname(a)} and ${lname(b)} for the rest of the round.`);
      break;
    }
    case 'invite': {
      // Each invited group comes in (from a fight, half: move holds D22); 1 sway where each left and 1 at the new fight.
      const to = /** @type {string} */ (t.location);
      const payer = t.mode === 'faction' ? /** @type {string} */ (suitFaction(state, card)) : /** @type {string} */ (t.payer);
      const pay = (/** @type {string} */ f, /** @type {string} */ loc) => placeOne(state, pid, f, loc);
      for (const g of t.moves ?? []) {
        placed.add(`${to}:${g.faction}`); // its sway goes where it left, not to the fight
        if (move(state, pid, g.faction, g.location, to, tokensOf(state, g.location, g.faction), placed)) pay(g.faction, g.location);
      }
      pay(payer, to);
      logLine(state, `${pid}: ${card.name}: ${(t.moves ?? []).map((g) => names(g.faction)).join(' and ')} come into ${lname(to)}.`);
      break;
    }
    case 'split': {
      const f = /** @type {string} */ (t.faction), from = /** @type {string} */ (t.location);
      for (const [to, n] of Object.entries(t.split ?? {})) move(state, pid, f, from, to, n, placed);
      placeOne(state, pid, f, from);
      logLine(state, `${pid}: ${card.name} turns ${names(f)} away from ${lname(from)}.`);
      break;
    }
    case 'favours': {
      const me = state.players[pid];
      if (t.use === 'sway') {
        for (const l of picked(t.from)) { if (me.supply <= 0) break; me.supply -= 1; state.board[l].sway[pid] = (state.board[l].sway[pid] ?? 0) + 1; }
        logLine(state, `${pid}: ${card.name}: sway from the supply at ${picked(t.from).map(lname).join(', ')}.`);
      } else {
        const fs = picked(t.payers), f = fs[0], n = Math.min(fs.length, me.supply);
        me.supply -= n; me.standing[f] += n;
        logLine(state, `${pid}: ${card.name}: ${n} standing with ${names(f)}, from the supply.`);
      }
      break;
    }
    case 'stakes': {
      const me = state.players[pid];
      if (t.use === 'standing') {
        const to = /** @type {string} */ (t.faction), from = picked(t.payers);
        for (const f of from) me.standing[f] -= 1;
        me.standing[to] += from.length;
        logLine(state, `${pid}: ${card.name}: ${from.length} standing gathered with ${names(to)}.`);
      } else if (t.use === 'sway') {
        const to = /** @type {string} */ (t.location), from = picked(t.from);
        for (const l of from) { state.board[l].sway[pid] -= 1; if (!state.board[l].sway[pid]) delete state.board[l].sway[pid]; }
        state.board[to].sway[pid] = (state.board[to].sway[pid] ?? 0) + from.length;
        logLine(state, `${pid}: ${card.name}: ${from.length} sway gathered at ${lname(to)}.`);
      } else {
        // Tokens: up to X come in from next door (from a fight, half); 1 sway where each group left and 1 at the centre.
        const to = /** @type {string} */ (t.location), f = /** @type {string} */ (t.faction), n = tally(picked(t.from));
        placed.add(`${to}:${f}`);
        let moved = 0;
        for (const [l, k] of Object.entries(n)) { const m = move(state, pid, f, l, to, k, placed); if (m) { moved += m; placeOne(state, pid, f, l); } }
        if (moved) placeOne(state, pid, f, to);
        logLine(state, `${pid}: ${card.name}: ${moved} ${names(f)} come in to ${lname(to)}.`);
      }
      break;
    }
    case 'exit': {
      const me = state.players[pid];
      if (t.use === 'standing') {
        const from = /** @type {string} */ (t.faction), to = picked(t.payers);
        me.standing[from] -= to.length;
        for (const f of to) me.standing[f] += 1;
        logLine(state, `${pid}: ${card.name}: standing with ${names(from)} spread to ${to.map(names).join(', ')}.`);
      } else if (t.use === 'sway') {
        const from = /** @type {string} */ (t.location), to = picked(t.from);
        state.board[from].sway[pid] -= to.length;
        if (!state.board[from].sway[pid]) delete state.board[from].sway[pid];
        for (const l of to) state.board[l].sway[pid] = (state.board[l].sway[pid] ?? 0) + 1;
        logLine(state, `${pid}: ${card.name}: sway spread from ${lname(from)} to ${to.map(lname).join(', ')}.`);
      } else {
        // Tokens: 1 to each chosen neighbour (1 sway where each lands, as any move), and 1 where it left.
        const f = /** @type {string} */ (t.faction), loc = /** @type {string} */ (t.location), to = picked(t.from);
        let n = 0;
        for (const l of to) n += move(state, pid, f, loc, l, 1, placed);
        placeOne(state, pid, f, loc);
        logLine(state, `${pid}: ${card.name}: ${n} ${names(f)} scatter from ${lname(loc)}.`);
      }
      break;
    }
    case 'showdown': {
      // Burned sway goes back to your supply (designer, 2026-10-24); the tokens taken are your trophies.
      const loc = /** @type {string} */ (t.location), f = /** @type {string} */ (t.faction);
      const n = Math.min(picked(t.from).filter((l) => l === loc).length, state.board[loc].sway[pid] ?? 0, tokensOf(state, loc, f));
      takeTokens(state, loc, f, n);
      state.players[pid].trophies[f] += n;
      state.board[loc].sway[pid] -= n;
      if (!state.board[loc].sway[pid]) delete state.board[loc].sway[pid];
      state.players[pid].supply += n;
      logLine(state, `${pid}: ${card.name} at ${lname(loc)}: ${n} ${names(f)} slain, ${pid}'s trophies.`);
      break;
    }
    case 'switch': {
      const me = state.players[pid];
      if (t.use === 'standing') {
        const n = picked(t.payers).length, from = /** @type {string} */ (t.faction), to = /** @type {string} */ (t.to);
        me.standing[from] -= n; me.standing[to] += n;
        logLine(state, `${pid}: ${card.name}: ${n} standing from ${names(from)} to ${names(to)}.`);
      } else {
        const n = picked(t.from).length, from = /** @type {string} */ (t.location), to = /** @type {string} */ (t.to);
        state.board[from].sway[pid] -= n;
        if (!state.board[from].sway[pid]) delete state.board[from].sway[pid];
        state.board[to].sway[pid] = (state.board[to].sway[pid] ?? 0) + n;
        logLine(state, `${pid}: ${card.name}: ${n} sway from ${lname(from)} to ${lname(to)}.`);
      }
      break;
    }
    case 'playbook': {
      if (t.use === 'yours') {
        const back = /** @type {string} */ (t.back), plays = ('roundPlays' in state && state.roundPlays) || [];
        const i = plays.map((x) => x.pid === pid && x.card === back).lastIndexOf(true);
        if (i >= 0) plays.splice(i, 1);
        state.players[pid].hand.push(back);
        logLine(state, `${pid}: ${card.name}: takes ${cardById(back).name} back.`);
      } else {
        const last = lastAction(state);
        if (last) { logLine(state, `${pid}: ${card.name}: plays ${cardById(last).name} as their own.`); act(state, pid, cardById(last), t); }
      }
      break;
    }
    case 'altar': {
      // Each marked location takes 1 sway, the bid; at its fight this round, the winner loses as many as the loser.
      const marks = altarChosen(state, card, t);
      for (const m of marks) { state.board[m.location].altar = true; placeOne(state, pid, m.faction, m.location); }
      logLine(state, `${pid}: ${card.name}: blood on ${marks.map((m) => lname(m.location)).join(', ')}.`);
      break;
    }
    case 'terror': {
      // Each marked location takes 1 sway, the bid; at nightfall, 1 token there may flee (the nightfall step).
      const marks = altarChosen(state, card, t);
      for (const m of marks) { state.board[m.location].terror = pid; placeOne(state, pid, m.faction, m.location); }
      logLine(state, `${pid}: ${card.name}: terror waits for nightfall at ${marks.map((m) => lname(m.location)).join(', ')}.`);
      break;
    }
    case 'study': {
      // Each marked location takes 1 sway, the bid; after its fight this round, the player takes 1 of the winner's losses.
      const marks = altarChosen(state, card, t);
      for (const m of marks) { state.board[m.location].study = pid; placeOne(state, pid, m.faction, m.location); }
      logLine(state, `${pid}: ${card.name}: the kids will study the bodies at ${marks.map((m) => lname(m.location)).join(', ')}.`);
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
  if (state.phase === 'draft') {
    if (m.type !== 'pick') return no('Pick cards in the draft.');
    if (p.picked) return no('You have already picked from this batch.');
    const pool = [...p.kept, ...p.batch];
    const keep = m.keep ?? [];
    if (keep.length !== p.kept.length + 1) return no(`Keep ${p.kept.length + 1} cards.`);
    if (new Set(keep).size !== keep.length || keep.some((c) => !pool.includes(c))) return no('Keep cards from your kept cards and this batch.');
    return OK;
  }
  if (state.phase === 'night') {
    // Night Terrors (◐ signature): at each mark, 1 token of a faction there may flee to a neighbour; the mark's sway may follow.
    if (m.type !== 'flee' || !state.night) return no('Night has fallen: decide who flees from each mark.');
    if (state.night.player !== pid) return no('Another player decides at nightfall.');
    if (!state.night.left.includes(m.location)) return no('Choose one of your marks.');
    if (!m.faction) return OK; // let them be
    const exits = fleeOptions(state, m.location).find((o) => o.faction === m.faction)?.to ?? [];
    if (!m.to || !exits.includes(m.to)) return no('1 token flees to a neighbouring location it can enter (from a fight, half may leave).');
    return m.follow && (state.board[m.location].sway[pid] ?? 0) < 1 ? no('You have no sway there to follow.') : OK;
  }
  if (state.phase === 'growth') {
    if (m.type !== 'grow' || !state.growing) return no('Choose where the faction grows.');
    if (state.growing.leaders[state.growing.next % state.growing.leaders.length] !== pid) return no('Another sway leader places this token.');
    return (state.growing.due[m.location] ?? 0) > 0 ? OK : no('That location doesn\'t grow.');
  }
  if (state.phase !== 'play') return no('That move does not belong in this phase.');
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
  if (m.use === 'sway') {
    if (!card.suit) return no('Unsuited cards have no sway use.');
    return p.supply <= 0 ? no('Your supply is empty.') : OK;
  }
  if (m.use === 'return') {
    const { spots, max } = returnRoom(state, pid, m.card);
    const places = m.places ?? [];
    if (!max) return no('Its faction can come back only when it has no location with 2 or more of its tokens, and you need standing with it.');
    return places.length >= 1 && places.length <= max && places.every((l) => spots.includes(l)) ? OK : no(`Bring back 1 to ${max} of its tokens, at its own locations or where it already is.`);
  }
  if (m.use !== 'action') return no('Choose the action or the sway.');
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
  const next = cloneState({ ...state, log: [] });
  // The log is shared copy-on-write: only this round's entry can still change (logLine), so only it is copied.
  next.log = state.log.map((e) => (e.round === state.round ? { ...e, events: e.events.slice() } : e));
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
    case 'grow': return growOne(next, m.location);
    case 'flee': {
      const n = /** @type {NonNullable<GameState['night']>} */ (next.night);
      const place = next.board[m.location];
      if (m.faction && m.to) {
        takeTokens(next, m.location, m.faction, 1);
        addTokens(next, m.to, m.faction, 1);
        if (m.follow) { place.sway[pid] -= 1; if (!place.sway[pid]) delete place.sway[pid]; next.board[m.to].sway[pid] = (next.board[m.to].sway[pid] ?? 0) + 1; }
        logLine(next, `  Night terrors at ${locationById(m.location).name}: 1 ${factionById(m.faction).name} flees to ${locationById(m.to).name}${m.follow ? `, ${pid}'s sway following` : ''}.`);
      }
      delete place.terror;
      n.left = n.left.filter((l) => l !== m.location);
      return n.left.length ? next : closeRound(next);
    }
    case 'pass': {
      next.passesInRow += 1;
      logLine(next, `${pid} passes.`);
      if (next.passesInRow >= next.seating.length) return endOfPlay(next);
      next.turn = (next.turn + 1) % next.seating.length;
      return next;
    }
    case 'play': {
      p.hand = p.hand.filter((c) => c !== m.card);
      next.roundPlays = [...(next.roundPlays ?? []), { pid, card: m.card, use: m.use }];
      next.passesInRow = 0;
      if (pid === next.first) next.opened = true;
      const card = cardById(m.card);
      if (m.use === 'sway') {
        const faction = factionOfArchetype(next, /** @type {string} */ (card.suit));
        const gain = Math.min(swayFor(state, pid, card.id), p.supply);
        p.supply -= gain;
        p.standing[faction] += gain;
        logLine(next, `${pid} plays ${card.name} for ${gain} sway with ${factionById(faction).name}.`);
        next.turn = (next.turn + 1) % next.seating.length;
        return next;
      }
      if (m.use === 'return') {
        // A way back (designer, 2026-10-26): its faction's tokens return; 1 standing with it for each, back to the supply.
        const { faction } = returnRoom(state, pid, m.card);
        const places = m.places ?? [];
        for (const l of places) addTokens(next, l, faction, 1);
        next.supply[faction] -= places.length;
        p.standing[faction] -= places.length;
        p.supply += places.length;
        logLine(next, `${pid} plays ${card.name} to bring ${places.length} ${factionById(faction).name} back, at ${[...new Set(places)].map((l) => locationById(l).name).join(', ')}.`);
        next.turn = (next.turn + 1) % next.seating.length;
        return next;
      }
      logLine(next, `${pid} plays ${card.name}.`);
      if (m.target) act(next, pid, card, m.target);
      else logLine(next, `${card.name} has nothing to act on.`);
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

// ---------------------------------------------------------------------------
// The resolve phase (G.4.3): fights, then growth
// ---------------------------------------------------------------------------

/** The round's play is over: unplayed cards go back; fights; then growth. @param {GameState} state */
function endOfPlay(state) {
  for (const id of state.seating) state.players[id].hand = [];
  const marks = LOCATION_IDS.filter((l) => state.board[l].terror);
  if (marks.length) {
    // Night Terrors (◐ signature): nightfall comes first, before the fights.
    state.phase = 'night';
    state.night = { player: /** @type {string} */ (state.board[marks[0]].terror), left: marks };
    logLine(state, 'Everyone passed. Night falls.');
    return state;
  }
  return closeRound(state);
}

/** The fights, then growth. @param {GameState} state */
function closeRound(state) {
  state.phase = 'play';
  state.night = null;
  logLine(state, 'Fights:');
  for (const loc of LOCATION_IDS) fightAt(state, loc);
  for (const loc of LOCATION_IDS) { const p = state.board[loc]; delete p.gate; delete p.gateLoss; delete p.altar; delete p.study; delete p.terror; } // marks last the round
  return beginGrowth(state);
}

/**
 * A deep copy of plain game data (objects, arrays, primitives: all a game
 * state holds). Several times faster than structuredClone, which was most of
 * a bot game's time (2026-10-10 profile: 81%). Not a rule.
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

/** The parts of a game state no rule changes once the game is made: shared between copies, not copied. */
const FIXED = new Set(['options', 'seating', 'factions']);
/**
 * A copy of a game state (or a slice of one) that shares its fixed parts (FIXED) and deep-copies the rest. Much of a
 * plain clone's time went on the options. A speed-up, not a rule.
 * @template T @param {T} state @returns {T}
 */
export function cloneState(state) {
  /** @type {Record<string, unknown>} */
  const o = {};
  for (const k in state) {
    const v = /** @type {Record<string, unknown>} */ (state)[k];
    o[k] = FIXED.has(k) ? v : k === 'board' ? copyRecords(/** @type {Record<string, Record<string, unknown>>} */ (v)) : k === 'players' ? copyRecords(/** @type {Record<string, Record<string, unknown>>} */ (v)) : clone(v);
  }
  return /** @type {T} */ (o);
}
/**
 * The board or the players, copied one record deep by spreading (fast for their small flat maps): each place or
 * player gets fresh copies of its maps and lists; anything deeper falls back to clone. @param {Record<string, Record<string, unknown>>} recs
 */
function copyRecords(recs) {
  /** @type {Record<string, Record<string, unknown>>} */
  const out = {};
  for (const id in recs) {
    const r = recs[id];
    /** @type {Record<string, unknown>} */
    const c = {};
    for (const k in r) {
      const v = r[k];
      if (v === null || typeof v !== 'object') c[k] = v;
      else if (Array.isArray(v)) c[k] = v.some((x) => x !== null && typeof x === 'object') ? clone(v) : v.slice();
      else { let flat = true; for (const j in v) { const x = /** @type {Record<string, unknown>} */ (v)[j]; if (x !== null && typeof x === 'object') { flat = false; break; } } c[k] = flat ? { ...v } : clone(v); }
    }
    out[id] = c;
  }
  return out;
}

/** Several locations' fights in turn, on one copy (as resolveFight one after another); `copy` false: on `state` itself, already a copy. @param {GameState} state @param {string[]} locs @returns {GameState} */
export function resolveFights(state, locs, copy = true) {
  const next = copy ? cloneState(state) : state;
  for (const loc of locs) fightAt(next, loc);
  return next;
}

/** One location's fight on a copy of the state, for tests and previews. @param {GameState} state @param {string} loc @returns {GameState} */
export function resolveFight(state, loc) {
  const next = clone(state);
  fightAt(next, loc);
  return next;
}

/** The locations that will fight at round end as things stand: contested, not scorched (a Gate's ends together). @param {GameState} state */
export const fightsDue = (state) => LOCATION_IDS.filter((loc) => !state.board[loc].scorched && factionsAt(state, loc).length >= 2);

/**
 * A location's fight. A Gate's two ends fight once, as one (joinedFight), and the Gate closes; a location with no
 * contest, or one already resolved through its Gate, has none. Mutates state.
 * @param {GameState} state @param {string} loc
 */
function fightAt(state, loc) {
  if (state.board[loc].scorched || factionsAt(state, loc).length < 2) return;
  const g = gateOf(state, loc);
  if (g) joinedFight(state, loc, g);
  else fight(state, loc);
}

/**
 * The Gate's fight (designer, 2026-10-17): its two ends fight as one location. Strength and trophy sway are added
 * across both, both ends' hidden tokens apply, alignment with either end breaks a tie, a true tie scorches both,
 * and the winner's losses come from the end the Gate's player chose first. Afterwards each player's sway that
 * stays (everyone but the leader and tied leaders) stays where it was. Mutates state.
 * @param {GameState} state @param {string} a @param {string} b
 */
function joinedFight(state, a, b) {
  const A = state.board[a], B = state.board[b];
  const lossEnd = A.gateLoss ?? B.gateLoss ?? a;
  const other = lossEnd === a ? b : a;
  const before = { [a]: { ...A.tokens }, [b]: { ...B.tokens } };
  const sway = { [a]: { ...A.sway }, [b]: { ...B.sway } };
  const name = `${locationById(a).name} and ${locationById(b).name}, through the Gate`;
  for (const p of [A, B]) { delete p.gate; delete p.gateLoss; }
  // Merge both ends into `a` for the fight.
  const merge = (/** @type {Record<string, number>} */ x, /** @type {Record<string, number>} */ y) => { /** @type {Record<string, number>} */ const out = { ...x }; for (const [k, n] of Object.entries(y)) out[k] = (out[k] ?? 0) + n; return out; };
  A.tokens = merge(A.tokens, B.tokens);
  A.sway = merge(A.sway, B.sway);
  if (B.altar) A.altar = true;
  if (B.study && !A.study) A.study = B.study;
  B.tokens = {}; B.sway = {};
  fight(state, a, { other: b, name });
  if (A.scorched) { B.scorched = true; return; } // a true tie: both ends scorched; everything already back in its supply
  // Split what's left back to the two ends.
  const after = A.tokens;
  A.tokens = {}; B.tokens = {};
  for (const [f, n] of Object.entries(after)) {
    if (n <= 0) continue;
    let lost = (before[a][f] ?? 0) + (before[b][f] ?? 0) - n;
    for (const end of [lossEnd, other]) {
      const k = Math.min(Math.max(0, lost), before[end][f] ?? 0);
      addTokens(state, end, f, (before[end][f] ?? 0) - k);
      lost -= k;
    }
  }
  const kept = A.sway;
  A.sway = {}; B.sway = {};
  for (const pid of Object.keys(kept)) for (const end of [a, b]) if (sway[end][pid]) state.board[end].sway[pid] = sway[end][pid];
}

/**
 * One fight (FR5, TF1, TD1, AF3 adjusted). Mutates state. `joined`: a Gate's fight run on the merged location
 * (joinedFight): the other end (for alignment, AL2) and the fight's name.
 * @param {GameState} state @param {string} loc
 * @param {{ other: string, name: string }} [joined]
 */
function fight(state, loc, joined = undefined) {
  const place = state.board[loc];
  const sides = factionsAt(state, loc);
  const name = joined?.name ?? locationById(loc).name;
  // Strength of every side: two, or three after Wake the Dead, the ☾ signature (designer, 2026-10-18).
  const strength = Object.fromEntries(sides.map((f) => [f, place.tokens[f]]));
  const ranked = sides.slice().sort((x, y) => strength[y] - strength[x]);
  const top = ranked.filter((f) => strength[f] === strength[ranked[0]]);
  const aligned = top.find((f) => [loc, ...(joined ? [joined.other] : [])].some((l) => archetypeOf(f) === alignmentOf(l)));
  if (top.length > 1 && !aligned) {
    // TF1 + TM1: both wiped, the location scorched, nothing rewarded; everything back to its supply.
    for (const f of sides) state.supply[f] += place.tokens[f];
    for (const [pid, n] of Object.entries(place.sway)) state.players[pid].supply += n;
    place.tokens = {};
    place.sway = {};
    place.scorched = true;
    logLine(state, `  ${name}: a true tie. ${sides.length > 2 ? 'Every side is' : 'Both sides are'} wiped out and ${name} is scorched.`);
    return;
  }
  const winner = top.length > 1 ? /** @type {string} */ (aligned) : ranked[0];
  const losers = sides.filter((f) => f !== winner);
  const loser = losers.slice().sort((x, y) => place.tokens[y] - place.tokens[x])[0]; // the larger loser
  const lost = Object.fromEntries(losers.map((f) => [f, place.tokens[f]])); // every loser loses everything (FR5)
  const nl = place.tokens[loser];
  // The winner loses half the loser's number; in a three-way fight, half the larger loser's (designer, 2026-10-18).
  // Rounded up (D25, designer 2026-10-18, for now); variant winnerLoss=down: rounded down, at least 1 (FR5 as first drafted).
  let winnerLoss = state.options.winnerLoss === 'down' ? Math.max(1, Math.floor(nl / 2)) : Math.ceil(nl / 2);
  if (place.altar) winnerLoss = nl; // Spill Blood on the Altar (⎈ signature): as many as the (larger) loser
  winnerLoss = Math.min(winnerLoss, place.tokens[winner]);
  for (const f of losers) place.tokens[f] -= lost[f];
  place.tokens[winner] -= winnerLoss;
  for (const f of sides) if (place.tokens[f] <= 0) delete place.tokens[f];
  logLine(state, `  ${name}: ${factionById(winner).name} beat ${losers.map((f) => factionById(f).name).join(' and ')}; casualties ${losers.map((f) => lost[f]).join(', ')} and ${winnerLoss}.`);
  // Trophies (TD1): bigger pile to the leader, smaller to the runner-up; with three piles, the leader takes the two larger (designer, 2026-10-18).
  const piles = [...losers.map((f) => ({ faction: f, n: lost[f] })), { faction: winner, n: winnerLoss }].filter((x) => x.n > 0).sort((x, y) => y.n - x.n);
  /** Who takes the i-th largest of n piles: the runner-up the smallest, the leader the rest. @param {number} i @param {number} n */
  const placeFor = (i, n) => (n > 1 && i === n - 1 ? 1 : 0);
  const ranking = rankAt(state, loc);
  const collectors = ranking.places;
  if (place.study && collectors[0] === place.study && collectors[1] && piles.length > 1) { // no runner-up (alone, or tied for second): nothing extra
    // Study the Bodies (ↂ signature): if the player leads here, they also take 1 from the runner-up's pile, the
    // smallest, before the piles go out (designer, 2026-10-20).
    const rp = piles[piles.length - 1];
    rp.n -= 1;
    state.players[place.study].trophies[rp.faction] += 1;
    logLine(state, `  ${place.study} studies one of the ${factionById(rp.faction).name} dead.`);
    if (!rp.n) piles.pop();
  }
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
    piles.forEach((pile, i) => give(pile, collectors[placeFor(i, piles.length)] ?? null));
  }
  // Sway after the fight (AF3 adjusted, AS1).
  const leader = collectors[0];
  if (leader) {
    const n = place.sway[leader] ?? 0;
    const half = Math.floor(n / 2);
    state.players[leader].standing[winner] += half;
    state.players[leader].supply += n - half;
    delete place.sway[leader];
  }
  for (const pid of ranking.tiedLeaders) {
    state.players[pid].supply += place.sway[pid] ?? 0;
    delete place.sway[pid];
  }
}

/**
 * Rank players by sway at a location, with affinity breaking ties (AB1)
 * and standing ties using up their places (PT2, ST1). `places` lists who
 * collects first and second place (null where a tie used the place up).
 * @param {GameState} state @param {string} loc
 */
function rankAt(state, loc) {
  const place = state.board[loc];
  const entries = Object.entries(place.sway).filter(([, n]) => n > 0);
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
  return LOCATION_IDS.filter((loc) => !state.board[loc].scorched && factionsAt(state, loc).length === 1 && tokensOf(state, loc, faction) >= threshold);
}

/** What each growth location is due: 1, plus 1 if the faction is aligned with it (AL3; variant alignedGrowth, off by default since 2026-10-21). @param {GameState} state @param {string} faction */
export function growthDue(state, faction) {
  const boost = state.options.alignedGrowth === 'on';
  return Object.fromEntries(growthSpots(state, faction).map((loc) => [loc, 1 + (boost && archetypeOf(faction) === alignmentOf(loc) ? 1 : 0)]));
}

/**
 * Each faction's total growth due this round, capped by its supply, in one pass over the board: the same sums as
 * growthDue faction by faction (for the bots' estimates; a speed-up, not a rule). @param {GameState} state
 */
export function growthTotal(state) {
  const threshold = num(state, 'growth');
  const boost = state.options.alignedGrowth === 'on';
  /** @type {Record<string, number>} */ const due = {};
  for (const loc of LOCATION_IDS) {
    if (state.board[loc].scorched) continue;
    const here = factionsAt(state, loc);
    if (here.length !== 1) continue;
    const f = here[0];
    if (tokensOf(state, loc, f) < threshold) continue;
    due[f] = (due[f] ?? 0) + 1 + (boost && archetypeOf(f) === alignmentOf(loc) ? 1 : 0);
  }
  let total = 0;
  for (const f of state.factions) total += Math.min(state.supply[f], due[f] ?? 0);
  return total;
}

/**
 * Growth for each faction in turn, from `from`. A faction with enough supply
 * grows everywhere it is due; one short of tokens grows as far as its supply
 * allows, its sway leaders taking turns to choose (3.5).
 * @param {GameState} state @param {number} [from]
 */
function beginGrowth(state, from = 0) {
  for (const faction of state.factions.slice(from)) {
    const due = growthDue(state, faction);
    const wants = Object.values(due).reduce((n, x) => n + x, 0);
    if (wants === 0) continue;
    if (wants <= state.supply[faction]) {
      for (const [loc, n] of Object.entries(due)) state.board[loc].tokens[faction] += n;
      state.supply[faction] -= wants;
      logLine(state, `${factionById(faction).name} grows at ${Object.keys(due).length} location${Object.keys(due).length === 1 ? '' : 's'}.`);
    } else if (state.supply[faction] > 0) {
      state.growing = { faction, left: state.supply[faction], leaders: swayLeaders(state, faction), next: 0, due };
      state.phase = 'growth';
      return state;
    }
  }
  return endRound(state);
}

/** One token placed by a sway leader during a short-supply growth. @param {GameState} state @param {string} loc */
function growOne(state, loc) {
  const g = /** @type {NonNullable<GameState['growing']>} */ (state.growing);
  state.board[loc].tokens[g.faction] += 1;
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

/**
 * Every seat in order, by the same score and tiebreaks as the winners (for
 * measuring how bots place; not a rule: only the winners count).
 * @param {GameState} state @param {Record<string, number>} scores @param {string[]} winners @param {(a: string, b: string) => number} tiebreak
 */
function placings(state, scores, winners, tiebreak) {
  const rest = state.seating.filter((pid) => !winners.includes(pid)).sort((a, b) => scores[b] - scores[a] || tiebreak(a, b));
  return [...winners, ...rest];
}

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
    const tiebreak = (/** @type {string} */ a, /** @type {string} */ b) => {
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
    };
    const winners = rankPlayers(state, scores, tiebreak);
    state.result = { side: 'invaders', factions: top, players: winners, scores, placings: placings(state, scores, winners, tiebreak) };
    logLine(state, `Total presence ${total} is more than ${threshold}: the invaders win. ${top.map((f) => factionById(f).name).join(' and ')} take the island. Winner: ${winners.join(', ')}.`);
  } else {
    // TS2: the count of the colour held fewest of; WT1 compares the next weakest.
    const sorted = (/** @type {string} */ pid) => state.factions.map((f) => state.players[pid].trophies[f]).sort((x, y) => x - y);
    for (const pid of state.seating) scores[pid] = sorted(pid)[0];
    const tiebreak = (/** @type {string} */ a, /** @type {string} */ b) => {
      const sa = sorted(a), sb = sorted(b);
      for (let i = 1; i < sa.length; i++) if (sa[i] !== sb[i]) return sb[i] - sa[i];
      return 0;
    };
    const winners = rankPlayers(state, scores, tiebreak);
    state.result = { side: 'island', factions: [], players: winners, scores, placings: placings(state, scores, winners, tiebreak) };
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
  if (state.phase === 'night' && state.night) return [state.night.player];
  return [state.seating[state.turn]];
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
  // Light of the Cross is guessed directly, from a random group; every other card walks the table's choices (and
  // still draws a number in the group's place, so the random sequence is the same for every card).
  const sampled = card.action === 'split';
  const groups = sampled ? LOCATION_IDS.flatMap((loc) => factionsAt(state, loc).map((f) => ({ loc, f }))) : [];
  /** @type {('location' | 'faction')[]} */
  const modes = card.suit ? ['location', 'faction'] : ['location'];
  for (let tries = 0; tries < 40; tries++) {
    const mode = pick(modes);
    /** @type {Target | null} */
    let t = null;
    const g = sampled ? pick(groups) : (rng(), undefined);
    if (sampled) {
      if (g) {
        const n = freeOf(state, g.loc, g.f);
        const dests = adj(state, g.loc).filter((d) => canEnter(state, d, g.f));
        if (n >= 2 && dests.length >= 2) {
          const a = pick(dests), b = pick(dests.filter((d) => d !== a));
          const na = Math.floor(n / 2) + (n % 2 && rng() < 0.5 ? 1 : 0);
          t = { mode, location: g.loc, faction: g.f, split: { [a]: na, [b]: n - na } };
        }
      }
    } else t = walkTarget(state, pid, cardId, mode, rng);
    if (t && !checkTarget(state, pid, card, t)) return t;
  }
  return null;
}

/**
 * For a bot's steered search (2026-10-26): the next step from a partial target, as finished targets (`done`) and
 * partial ones one choice further (`next`). A mode (reading) choice opens both readings. Not a rule.
 * @param {GameState} state @param {string} pid @param {string} cardId @param {Target} t
 * @returns {{ done: Target[], next: Target[] }}
 */
export function choiceSteps(state, pid, cardId, t) {
  const c = nextChoice(state, pid, cardId, t);
  if (c.kind === 'done') return { done: [t], next: [] };
  if (c.kind === 'mode') return { done: [], next: [{ ...t, mode: 'location' }, { ...t, mode: 'faction' }] };
  if (!('options' in c)) return { done: [], next: [] };
  return { done: 'optional' in c && c.optional ? [t] : [], next: /** @type {any[]} */ (c.options).map((o) => chooseStep(t, c, o)) };
}
/**
 * For a bot's steered search: a random finished target from a partial one, choice by choice as the table offers
 * them; null if the walk gets stuck. Not a rule. @param {GameState} state @param {string} pid @param {string} cardId @param {Target} t @param {() => number} rng
 */
export function completeTarget(state, pid, cardId, t, rng) {
  let x = t;
  for (let steps = 0; steps < 30; steps++) {
    const c = nextChoice(state, pid, cardId, x);
    if (c.kind === 'done') return x;
    if (c.kind === 'mode') { x = { ...x, mode: rng() < 0.5 ? 'location' : 'faction' }; continue; }
    if ('optional' in c && c.optional && rng() < 0.3) return x;
    if (!('options' in c) || !c.options.length) return null;
    x = chooseStep(x, c, /** @type {any[]} */ (c.options)[Math.floor(rng() * c.options.length)]);
  }
  return null;
}

/**
 * A random target built one choice at a time, as the table offers them (for bots).
 * @param {GameState} state @param {string} pid @param {string} cardId @param {'location' | 'faction'} mode @param {() => number} rng @returns {Target | null}
 */
function walkTarget(state, pid, cardId, mode, rng) {
  const pick = (/** @type {any[]} */ xs) => xs[Math.floor(rng() * xs.length)];
  /** @type {Target} */
  let t = cardById(cardId).suit ? { mode } : {};
  // While a bot searches, each choice is memoised by the path of picks that led to it (cheaper than keying by the
  // whole target, as nextChoice does). A speed-up, not a rule.
  const memo = memoDepth ? (WALK_MEMO.get(state) ?? WALK_MEMO.set(state, new Map()).get(state)) : null;
  let path = `${pid}|${cardId}|${mode}`;
  for (let steps = 0; steps < 30; steps++) {
    let c = memo?.get(path);
    if (!c) { c = nextChoice(state, pid, cardId, t); memo?.set(path, c); }
    if (c.kind === 'done') return finishWalk(t);
    if (c.kind === 'mode') { t = { ...t, mode }; path += '|m'; continue; }
    if ('optional' in c && c.optional && rng() < 0.3) return finishWalk(t);
    if (!('options' in c) || !c.options.length) return null;
    const i = Math.floor(rng() * c.options.length);
    t = chooseStep(t, c, /** @type {any[]} */ (c.options)[i]);
    path += `|${i}`;
  }
  return null;
}

/**
 * The unsuited cards' choices once a use is picked (designer, 2026-10-23/24). Picks with a stop marker end early.
 * @param {GameState} st @param {string} pid @param {Card} card @param {Target} t @returns {Choice}
 */
function unsuitedShape(st, pid, card, t) {
  const x = handX(st, pid, card.id);
  const stopped = (/** @type {string[] | undefined} */ xs) => (xs ?? []).includes('__stop');
  const all = st.factions;
  const open = LOCATION_IDS.filter((l) => !st.board[l].scorched);
  const done = /** @type {Choice} */ ({ kind: 'done' });
  switch (card.action) {
    case 'favours': {
      const cap = Math.min(x, mySupply(st, pid));
      if (cap < 1) return { kind: 'faction', key: 'payers', options: [] };
      if (t.use === 'sway') {
        const at = picked(t.from);
        if (stopped(t.from) || at.length >= cap) return done;
        return { kind: 'location', key: 'from', options: fightsNow(st).filter((l) => !at.includes(l)), optional: at.length > 0, left: cap - at.length };
      }
      const fs = picked(t.payers);
      if (stopped(t.payers) || fs.length >= cap) return done;
      return { kind: 'faction', key: 'payers', options: fs.length ? [fs[0]] : all.slice(), optional: fs.length > 0 };
    }
    case 'stakes': {
      if (t.use === 'standing') {
        if (!t.faction) return { kind: 'faction', key: 'faction', options: all.filter((f) => all.some((g) => g !== f && myStanding(st, pid, g) >= 1)) };
        const from = picked(t.payers);
        if (stopped(t.payers) || from.length >= x) return done;
        return { kind: 'faction', key: 'payers', options: all.filter((f) => f !== t.faction && !from.includes(f) && myStanding(st, pid, f) >= 1), optional: from.length > 0 };
      }
      if (t.use === 'sway') {
        if (!t.location) return { kind: 'location', key: 'location', options: open.filter((l) => adj(st, l).some((n) => mySway(st, pid, n) > 0)) };
        const from = picked(t.from), n = tally(from);
        if (stopped(t.from) || from.length >= x) return done;
        return { kind: 'location', key: 'from', options: adj(st, t.location).filter((l) => mySway(st, pid, l) > (n[l] ?? 0)), optional: from.length > 0, left: x - from.length };
      }
      // tokens
      const can = (/** @type {string} */ c, /** @type {string} */ f) => canEnter(st, c, f) && stakeSources(st, c, f).length > 0 && myStanding(st, pid, f) >= 2;
      if (!t.location) return { kind: 'location', key: 'location', options: open.filter((l) => mySway(st, pid, l) > 0 && all.some((f) => can(l, f))) };
      if (!t.faction) return { kind: 'faction', key: 'faction', options: all.filter((f) => can(/** @type {string} */ (t.location), f)) };
      const from = picked(t.from), n = tally(from);
      if (stopped(t.from) || from.length >= x) return done;
      const sources = Object.keys(n).length;
      const options = stakeSources(st, t.location, t.faction).filter((q) => q.n > (n[q.l] ?? 0) && myStanding(st, pid, t.faction ?? '') >= sources + (n[q.l] ? 0 : 1) + 1).map((q) => q.l);
      return { kind: 'location', key: 'from', options, optional: from.length > 0, left: x - from.length };
    }
    case 'exit': {
      if (t.use === 'standing') {
        if (!t.faction) return { kind: 'faction', key: 'faction', options: all.filter((f) => myStanding(st, pid, f) >= 1) };
        const to = picked(t.payers), cap = Math.min(x, myStanding(st, pid, t.faction));
        if (stopped(t.payers) || to.length >= cap) return done;
        return { kind: 'faction', key: 'payers', options: all.filter((f) => f !== t.faction && !to.includes(f)), optional: to.length > 0 };
      }
      if (t.use === 'sway') {
        if (!t.location) return { kind: 'location', key: 'location', options: open.filter((l) => mySway(st, pid, l) > 0 && adj(st, l).some((n) => !st.board[n].scorched)) };
        const to = picked(t.from), cap = Math.min(x, mySway(st, pid, t.location));
        if (stopped(t.from) || to.length >= cap) return done;
        return { kind: 'location', key: 'from', options: adj(st, t.location).filter((l) => !st.board[l].scorched && !to.includes(l)), optional: to.length > 0, left: cap - to.length };
      }
      if (!t.location) return { kind: 'group', key: 'group', options: groupsOf(st).filter((g) => canLeave(st, g.location, g.faction) && burstSpots(st, g.location, g.faction).length > 0 && myStanding(st, pid, g.faction) >= 2) };
      const f = /** @type {string} */ (t.faction), to = picked(t.from), cap = Math.min(x, freeOf(st, t.location, f), myStanding(st, pid, f) - 1);
      if (stopped(t.from) || to.length >= cap) return done;
      return { kind: 'location', key: 'from', options: burstSpots(st, t.location, f).filter((l) => !to.includes(l)), optional: to.length > 0, left: cap - to.length };
    }
    case 'switch': {
      if (t.use === 'standing') {
        if (!t.faction) return { kind: 'faction', key: 'faction', options: all.filter((f) => myStanding(st, pid, f) >= 1) };
        if (!t.to) return { kind: 'faction', key: 'to', options: all.filter((f) => f !== t.faction) };
        const n = picked(t.payers).length, cap = Math.min(x, myStanding(st, pid, t.faction));
        if (stopped(t.payers) || n >= cap) return done;
        return { kind: 'faction', key: 'payers', options: [t.faction], optional: n > 0 };
      }
      if (!t.location) return { kind: 'location', key: 'location', options: open.filter((l) => mySway(st, pid, l) > 0) };
      if (!t.to) return { kind: 'location', key: 'to', options: open.filter((l) => l !== t.location) };
      const n = picked(t.from).length, cap = Math.min(x, mySway(st, pid, t.location));
      if (stopped(t.from) || n >= cap) return done;
      return { kind: 'location', key: 'from', options: [t.to], optional: n > 0, left: cap - n };
    }
    case 'playbook': {
      if (t.use === 'yours') return t.back ? done : { kind: 'use', key: 'back', options: ownPlays(st, pid) };
      const last = lastAction(st);
      return last ? nextShape(st, pid, last, t) : { kind: 'use', key: 'back', options: [] };
    }
  }
  return done;
}

/** @type {WeakMap<object, Map<string, Choice>>} */
const WALK_MEMO = new WeakMap();

/** A target with one more choice made. @param {Target} t @param {Choice} c @param {any} o @returns {Target} */
function chooseStep(t, c, o) {
  if (c.kind === 'use') return { ...t, [c.key]: o };
  if (c.kind === 'faction' && c.key === 'payers') return { ...t, payers: [...(t.payers ?? []), o] };
  if (c.kind === 'faction') return { ...t, [c.key ?? 'faction']: o };
  if (c.kind === 'split') return { ...t, split: { ...(t.split ?? {}), [o]: (t.split?.[o] ?? 0) + 1 } };
  if (c.kind === 'group') {
    if (c.key === 'move') return { ...t, moves: [...(t.moves ?? []), { location: o.location, faction: o.faction, to: '' }] };
    return { ...t, location: o.location, faction: o.faction };
  }
  if (!('key' in c)) return t;
  if (c.key === 'path') return { ...t, path: [...(t.path ?? []), o] };
  if (c.key === 'from') return { ...t, from: [...(t.from ?? []), o] };
  return { ...t, [c.key]: o };
}

/**
 * For bots: the legal targets of a card, listed by walking every choice the
 * table offers, up to `cap`. `complete` is false when the list was cut short
 * (then a bot should sample more besides). Not a rule.
 * `even`: a card with several uses shares the cap between them (2026-10-25: listed depth first, the last use filled
 * the cap on its own).
 * @param {GameState} state @param {string} pid @param {string} cardId @param {number} cap @param {boolean} [even]
 * @returns {{ targets: Target[], complete: boolean }}
 */
export function listTargets(state, pid, cardId, cap, even = false) {
  const card = cardById(cardId);
  const uses = /** @type {string[]} */ ('uses' in card && card.uses ? card.uses : []);
  if (even && uses.length > 1) {
    const each = Math.max(1, Math.ceil(cap / uses.length));
    const parts = uses.map((use) => listTargetsFrom(state, pid, cardId, each, [{ use }]));
    return { targets: parts.flatMap((p) => p.targets), complete: parts.every((p) => p.complete) };
  }
  return listTargetsFrom(state, pid, cardId, cap, card.suit ? [{ mode: 'faction' }, { mode: 'location' }] : [{}]);
}
/** listTargets from given starting targets. @param {GameState} state @param {string} pid @param {string} cardId @param {number} cap @param {Target[]} start @returns {{ targets: Target[], complete: boolean }} */
function listTargetsFrom(state, pid, cardId, cap, start) {
  const card = cardById(cardId);
  /** @type {Target[]} */
  const stack = start.slice();
  /** @type {Map<string, Target>} */
  const found = new Map();
  let visits = 0;
  const keep = (/** @type {Target} */ t) => { const k = JSON.stringify(t); if (!found.has(k) && !checkTarget(state, pid, card, t)) found.set(k, t); };
  while (stack.length && found.size < cap) {
    if (++visits > cap * 40) return { targets: [...found.values()], complete: false };
    const t = /** @type {Target} */ (stack.pop());
    const c = nextChoice(state, pid, cardId, t);
    if (c.kind === 'done') { keep(t); continue; }
    if (c.kind === 'mode') { if (!t.mode) stack.push({ ...t, mode: 'faction' }, { ...t, mode: 'location' }); continue; }
    if ('optional' in c && c.optional) keep(t);
    if (!('options' in c)) continue;
    for (const o of /** @type {any[]} */ (c.options)) stack.push(chooseStep(t, c, o));
  }
  return { targets: [...found.values()], complete: stack.length === 0 };
}
/** @param {Target} t */
const finishWalk = (t) => t;

/**
 * For the table: the next choice in building a card's target, given what has
 * been chosen so far. Not a rule; it offers the legal options one step at a
 * time, and the server still checks the finished target (checkTarget).
 * @typedef {{ kind: 'mode' } | { kind: 'location', key: 'location' | 'to' | 'path' | 'from' | 'losses', options: string[], optional?: boolean, left?: number }
 *   | { kind: 'group', key: 'group' | 'move', options: { location: string, faction: string }[], optional?: boolean }
 *   | { kind: 'faction', key?: 'faction' | 'to' | 'payer' | 'payers', options: string[], optional?: boolean }
 *   | { kind: 'use', key: 'use' | 'back', options: string[] }
 *   | { kind: 'split', options: string[], left: number } | { kind: 'done' }} Choice
 * @param {GameState} state @param {string} pid @param {string} cardId @param {Target} t
 * @returns {Choice}
 */
export function nextChoice(state, pid, cardId, t) {
  // Memoised per state object while a bot searches (memoising), as checkTarget: a walk asks the same first questions
  // of the same state again and again. Callers never change a choice they're given. Not a rule.
  if (!memoDepth) return nextShape(state, pid, cardId, t);
  let memo = CHOICE_MEMO.get(state);
  if (!memo) { memo = new Map(); CHOICE_MEMO.set(state, memo); }
  const key = `${pid}|${cardId}|${JSON.stringify(t)}`;
  const hit = memo.get(key);
  if (hit !== undefined) return hit;
  const c = nextShape(state, pid, cardId, t);
  memo.set(key, c);
  return c;
}
/** @type {WeakMap<object, Map<string, Choice>>} */
const CHOICE_MEMO = new WeakMap();

/** nextChoice, uncached. @param {GameState} state @param {string} pid @param {string} cardId @param {Target} t @returns {Choice} */
function nextShape(state, pid, cardId, t) {
  const card = cardById(cardId);
  const mode = /** @type {'location' | 'faction'} */ (t.mode ?? 'location');
  if (card.suit && !t.mode) return { kind: 'mode' };
  const sf = suitFaction(state, card);
  const groups = () => groupsOf(state);
  const groupOk = (/** @type {{ location: string, faction: string }} */ g) => !card.suit || (mode === 'location' ? suitLocations(card).includes(g.location) : g.faction === sf);
  /** Where a group could go, among `reach`. */
  const exits = (/** @type {{ location: string, faction: string }} */ g, /** @type {string[]} */ reach) => reach.filter((l) => l !== g.location && canEnter(state, l, g.faction));
  switch (card.action) {
    case 'burst': {
      const st = /** @type {GameState} */ (state);
      const can = (/** @type {string} */ f, /** @type {number} */ n) => !swayRequired(state) || (state.players[pid].standing[f] ?? 0) >= n;
      if (!t.location) return { kind: 'group', key: 'group', options: groups().filter(groupOk).filter((g) => freeOf(st, g.location, g.faction) >= 2 && can(g.faction, 3) && burstSpots(st, g.location, g.faction).length >= 2) };
      const f = /** @type {string} */ (t.faction);
      const to = t.from ?? [];
      if (to.includes('__stop')) return { kind: 'done' };
      const more = to.length < freeOf(st, t.location, f) && can(f, to.length + 2) ? burstSpots(st, t.location, f).filter((l) => !to.includes(l)) : [];
      if (!more.length && to.length >= 2) return { kind: 'done' };
      return { kind: 'location', key: 'from', options: more, optional: to.length >= 2 };
    }
    case 'control': {
      const st = /** @type {GameState} */ (state);
      const hits = (/** @type {string} */ l) => factionsAt(st, l).filter((f) => controlRoom(st, pid, card, { mode, location: l, faction: f }) > 0);
      if (!t.location) return { kind: 'location', key: 'location', options: LOCATION_IDS.filter((l) => hits(l).length > 0) };
      if (!t.faction) return { kind: 'faction', key: 'faction', options: hits(t.location) };
      const from = t.from ?? [];
      if (from.includes('__stop')) return { kind: 'done' };
      const max = controlRoom(st, pid, card, t);
      if (from.length >= max) return { kind: 'done' };
      return { kind: 'location', key: 'from', options: [t.location], optional: from.length >= 1, left: max - from.length };
    }
    case 'raise': {
      const st = /** @type {GameState} */ (state);
      if (!t.location) return { kind: 'location', key: 'location', options: LOCATION_IDS.filter((l) => raiseRoom(st, pid, l, mode).max > 0) };
      if (mode === 'location' && !t.payer) return { kind: 'faction', key: 'payer', options: raiseRoom(st, pid, t.location, mode).payers };
      const from = t.from ?? [];
      if (from.includes('__stop')) return { kind: 'done' };
      const n = from.length, { max } = raiseRoom(st, pid, t.location, mode, mode === 'faction' ? undefined : t.payer);
      if (n >= max) return { kind: 'done' };
      return { kind: 'location', key: 'from', options: [t.location], optional: n >= 1, left: max - n };
    }
    case 'plough': {
      const st = /** @type {GameState} */ (state);
      const fightOk = (/** @type {string} */ l) => !st.board[l].scorched && factionsAt(st, l).length >= 2 && (mode === 'location' ? suitLocations(card).includes(l) : factionsAt(st, l).includes(/** @type {string} */ (sf)));
      if (!t.location) return { kind: 'location', key: 'location', options: LOCATION_IDS.filter((l) => fightOk(l) && ploughFits(st, pid, card, l, [])) };
      const sides = ploughSides(st, t.location);
      const from = t.from ?? [];
      const total = sides.reduce((n, side) => n + side.n, 0);
      if (from.length >= total) {
        // Who pays each sway, one at a time: each exit, then the fight.
        const owed = new Set(from).size + 1, payers = t.payers ?? [];
        if (payers.length >= owed) return { kind: 'done' };
        const left = (/** @type {string} */ f) => (swayRequired(state) ? (state.players[pid].standing[f] ?? 0) : Infinity) - payers.filter((x) => x === f).length;
        const pool = ploughPool(st, card, t.location);
        const rest = owed - payers.length - 1; // still to pay after this one
        return { kind: 'faction', key: 'payers', options: pool.filter((f) => left(f) >= 1 && pool.reduce((n, g) => n + Math.max(0, left(g) - (g === f ? 1 : 0)), 0) >= rest) };
      }
      let i = 0, side = sides[0];
      for (const x of sides) { if (from.length < i + x.n) { side = x; break; } i += x.n; }
      return { kind: 'location', key: 'from', options: side.spots.filter((l) => ploughFits(st, pid, card, t.location ?? '', [...from, l])), left: total - from.length };
    }
    case 'rejoin': {
      const st = /** @type {GameState} */ (state);
      const can = (/** @type {string} */ f, /** @type {number} */ n) => !swayRequired(state) || (state.players[pid].standing[f] ?? 0) >= n;
      if (!t.location) return { kind: 'group', key: 'group', options: groups().filter(groupOk).filter((g) => { const p = powerShare(st, g.location, g.faction); return p.kin.length > 0 && p.n > 0 && can(g.faction, p.reached + 1); }) };
      const { kin, extra } = powerShare(st, t.location, /** @type {string} */ (t.faction));
      const to = t.from ?? [];
      if (to.length >= extra) return { kind: 'done' };
      return { kind: 'location', key: 'from', options: kin.filter((l) => !to.includes(l)), left: extra - to.length };
    }
    case 'chase': {
      const st = /** @type {GameState} */ (state);
      const can = (/** @type {string} */ f, /** @type {number} */ n) => !swayRequired(state) || (state.players[pid].standing[f] ?? 0) >= n;
      if (!t.location) return { kind: 'group', key: 'group', options: groups().filter(groupOk).filter((g) => canLeave(st, g.location, g.faction) && can(g.faction, 2) && chaseSteps(st, g.location, g.faction, [g.location]).length > 0) };
      const f = /** @type {string} */ (t.faction);
      const path = t.path ?? [];
      if (path.includes('__stop')) return { kind: 'done' };
      const chase = [t.location, ...path];
      // Another step: one more location passed (a token and a sway stay there), and still at least 1 token arriving.
      const options = path.length + 1 <= freeOf(st, t.location, f) && can(f, path.length + 2) ? chaseSteps(st, chase[chase.length - 1], f, chase) : [];
      if (!options.length && path.length) return { kind: 'done' };
      return { kind: 'location', key: 'path', options, optional: path.length > 0, left: Math.max(0, Math.min(freeOf(st, t.location, f), state.players[pid].standing[f] ?? 0) - path.length) };
    }
    case 'well': {
      const st = /** @type {GameState} */ (state);
      const pay = (/** @type {string} */ f, /** @type {number} */ n) => !swayRequired(state) || (state.players[pid].standing[f] ?? 0) >= n;
      const callable = (/** @type {string} */ c) => (mode === 'faction' ? [/** @type {string} */ (sf)] : state.factions.slice()).filter((f) => {
        if (factionsAt(st, c).length === 1 && !canEnter(st, c, f)) return false;
        const { lone, fights } = wellSources(st, c, f);
        return lone.length + fights.length > 0 && pay(f, (lone.length || 1) + 1);
      });
      const centreOk = (/** @type {string} */ c) => !state.board[c].scorched && factionsAt(st, c).length <= 1 && (mode === 'faction' || suitLocations(card).includes(c)) && callable(c).length > 0;
      if (!t.location) return { kind: 'location', key: 'location', options: LOCATION_IDS.filter(centreOk) };
      if (!t.faction) return { kind: 'faction', options: callable(t.location) };
      const f = t.faction;
      const { lone, fights } = wellSources(st, t.location, f);
      const picks = t.from ?? [];
      if (picks.includes('__stop')) return { kind: 'done' };
      const chosen = new Set(picks);
      const more = fights.filter((l) => picks.filter((x) => x === l).length < wellShare(st, l, f) && pay(f, lone.length + chosen.size + (chosen.has(l) ? 0 : 1) + 1));
      if (!more.length) return lone.length || chosen.size ? { kind: 'done' } : { kind: 'location', key: 'from', options: [] };
      return { kind: 'location', key: 'from', options: more, optional: lone.length + chosen.size > 0 };
    }
    case 'herd': {
      const st = /** @type {GameState} */ (state);
      const can = (/** @type {string} */ f, /** @type {number} */ n) => !swayRequired(state) || (state.players[pid].standing[f] ?? 0) >= n;
      if (!t.location) return { kind: 'group', key: 'group', options: groups().filter(groupOk).filter((g) => canLeave(st, g.location, g.faction) && can(g.faction, 2) && (({ pickups, crashes }) => pickups.length + crashes.length > 0)(trailSteps(st, g.location, g.faction, [g.location]))) };
      const f = /** @type {string} */ (t.faction);
      const path = t.path ?? [];
      const trail = [t.location, ...path];
      const at = trail[trail.length - 1];
      // A crash, or the player stopping (Done), ends the trail.
      if (path.includes('__stop') || (path.length && loneAt(st, at) && loneAt(st, at) !== f)) return { kind: 'done' };
      const { pickups, crashes } = trailSteps(st, at, f, trail);
      // Sway so far: the start and each stop; each further location needs 1 more.
      const options = can(f, path.length + 2) ? [...pickups, ...crashes] : [];
      if (!options.length && path.length) return { kind: 'done' };
      return { kind: 'location', key: 'path', options, optional: path.length > 0, left: Math.max(0, (state.players[pid].standing[f] ?? 0) - path.length - 1) };
    }
    case 'threat': {
      const pays = (/** @type {string} */ f) => !swayRequired(state) || (state.players[pid].standing[f] ?? 0) >= 2;
      if (!t.location) return { kind: 'group', key: 'group', options: groups().filter(groupOk).filter((g) => canLeave(/** @type {GameState} */ (state), g.location, g.faction) && pays(g.faction) && threatsOf(/** @type {GameState} */ (state), g.location, g.faction).length > 0) };
      return t.to ? { kind: 'done' } : { kind: 'location', key: 'to', options: threatsOf(/** @type {GameState} */ (state), t.location, /** @type {string} */ (t.faction)) };
    }
    case 'gate': {
      const ends = LOCATION_IDS.filter((l) => gateEnd(/** @type {GameState} */ (state), card, l));
      const payers = (/** @type {string} */ x, /** @type {string} */ y) => [...new Set([/** @type {string} */ (sf), ...factionsAcross(/** @type {GameState} */ (state), x, y)])]
        .filter((f) => !swayRequired(state) || (state.players[pid].standing[f] ?? 0) >= 1);
      const pairs = (/** @type {string} */ x) => ends.filter((y) => y !== x && factionsAcross(/** @type {GameState} */ (state), x, y).length <= 2 && payers(x, y).length > 0);
      if (!t.location) return { kind: 'location', key: 'location', options: ends.filter((x) => pairs(x).length > 0) };
      if (!t.to) return { kind: 'location', key: 'to', options: pairs(t.location) };
      if (!t.payer) return { kind: 'faction', key: 'payer', options: payers(t.location, t.to) };
      if (!t.losses) return { kind: 'location', key: 'losses', options: [t.location, t.to] };
      return { kind: 'done' };
    }
    case 'invite': {
      const need = mode === 'location' ? 2 : 1;
      const pays = (/** @type {string} */ f, /** @type {number} */ n) => !swayRequired(state) || (state.players[pid].standing[f] ?? 0) >= n;
      // Guests that can come, given those already chosen: other locations, other factions, and payable.
      const open = (/** @type {string} */ to, /** @type {{ location: string, faction: string }[]} */ chosen) => guestsOf(state, card, mode, to)
        .filter((g) => !chosen.some((c) => c.location === g.location || c.faction === g.faction) && pays(g.faction, mode === 'faction' ? 2 : 1));
      const fits = (/** @type {string} */ to) => (mode === 'location' ? suitLocations(card).includes(to) && !state.board[to].scorched && factionsAt(state, to).length === 0
        : !!loneAt(state, to) && loneAt(state, to) !== sf) && (need === 1 ? open(to, []).length > 0 : open(to, []).some((g) => open(to, [g]).length > 0 && (pays(g.faction, 2) || open(to, [g]).some((h) => pays(h.faction, 2)))));
      if (!t.location) return { kind: 'location', key: 'location', options: LOCATION_IDS.filter(fits) };
      const chosen = (t.moves ?? []).map((g) => ({ location: g.location, faction: g.faction }));
      if (chosen.length < need) return { kind: 'group', key: 'move', options: open(t.location, chosen) };
      if (mode === 'location' && !t.payer) return { kind: 'faction', key: 'payer', options: chosen.map((g) => g.faction).filter((f) => pays(f, 2)) };
      return { kind: 'done' };
    }
    case 'split': {
      // Evenly between exactly two adjacent locations; an odd token goes where the player sends it (designer, 2026-10-15).
      const size = (/** @type {{ location: string, faction: string }} */ g) => freeOf(state, g.location, g.faction);
      const pays = (/** @type {string} */ f) => !swayRequired(state) || (state.players[pid].standing[f] ?? 0) >= 2 * num(state, 'swayPerMove') + 1;
      if (!t.location) return { kind: 'group', key: 'group', options: groups().filter(groupOk).filter((g) => size(g) >= 2 && exits(g, adj(state, g.location)).length >= 2 && pays(g.faction)) };
      const f = /** @type {string} */ (t.faction);
      const n = size({ location: t.location, faction: f });
      const split = t.split ?? {};
      const placedN = Object.values(split).reduce((a, b) => a + b, 0);
      const left = n - placedN;
      const used = Object.keys(split).filter((d) => (split[d] ?? 0) > 0);
      const big = Math.ceil(n / 2);
      const full = (/** @type {string} */ d) => (split[d] ?? 0) + 1 > big || (n % 2 === 1 && (split[d] ?? 0) + 1 === big && used.some((u) => u !== d && split[u] === big));
      const dests = adj(state, t.location).filter((l) => canEnter(state, l, f) && (used.length < 2 || used.includes(l)) && !full(l));
      return left > 0 ? { kind: 'split', options: dests, left } : { kind: 'done' };
    }
    case 'favours': case 'stakes': case 'exit': case 'switch': case 'playbook': {
      // An unsuited card with several uses: pick one first, among those with something to do.
      const st = /** @type {GameState} */ (state);
      if (!t.use) {
        const uses = /** @type {string[]} */ ('uses' in card && card.uses ? card.uses : []);
        return { kind: 'use', key: 'use', options: uses.filter((u) => { const c = unsuitedShape(st, pid, card, { use: u }); return c.kind === 'done' || ('options' in c && c.options.length > 0); }) };
      }
      const c = unsuitedShape(st, pid, card, t);
      return 'options' in c && !c.options.length && 'optional' in c && c.optional ? { kind: 'done' } : c; // nothing more to add: finished
    }
    case 'showdown': {
      const st = /** @type {GameState} */ (state);
      if (!t.location) return { kind: 'group', key: 'group', options: groups().filter((g) => loneAt(st, g.location) === g.faction && mySway(st, pid, g.location) > 0) };
      const n = picked(t.from).length, cap = Math.min(mySway(st, pid, t.location), tokensOf(st, t.location, /** @type {string} */ (t.faction)));
      if ((t.from ?? []).includes('__stop') || n >= cap) return { kind: 'done' };
      return { kind: 'location', key: 'from', options: [t.location], optional: n > 0, left: cap - n };
    }
    case 'altar': case 'study': case 'terror': {
      // First the held locations (pick the group whose standing pays), then the empty ⎈ ones (the Demons pay).
      const st = /** @type {GameState} */ (state);
      const { held, empty } = altarMarks(st, card, mode);
      const marks = altarChosen(st, card, t);
      const cap = swayFor(state, pid, card.id);
      const left = (/** @type {string} */ f) => !swayRequired(state) ? Infinity : (state.players[pid].standing[f] ?? 0) - marks.filter((m) => m.faction === f).length;
      const free = (/** @type {string} */ l) => !marks.some((m) => m.location === l);
      if (marks.length >= cap || (t.from ?? []).includes('__stop')) return { kind: 'done' };
      const groupsDone = (t.moves ?? []).some((m) => m.location === '__stop') || (t.from ?? []).length > 0;
      const empties = empty.filter((l) => free(l) && left(/** @type {string} */ (sf)) >= 1);
      if (!groupsDone) {
        const options = held.filter((h) => free(h.location) && left(h.faction) >= 1);
        if (options.length) return { kind: 'group', key: 'move', options, optional: marks.length > 0 || empties.length > 0 };
      }
      if (!empties.length) return marks.length ? { kind: 'done' } : { kind: 'group', key: 'move', options: [] };
      return { kind: 'location', key: 'from', options: empties, optional: marks.length > 0 };
    }
    default: return { kind: 'done' };
  }
}

/**
 * For the table: the board and the players' standing a finished target
 * would leave, without playing it. Not a rule; it runs the card's action on a
 * copy (a player view is enough).
 * @param {GameState | PlayerView} state @param {string} pid @param {string} cardId @param {Target} t
 * @returns {{ board: GameState['board'], players: GameState['players'] }}
 */
export function previewTarget(state, pid, cardId, t) {
  const copy = /** @type {GameState} */ (/** @type {unknown} */ (clone({ board: state.board, players: state.players, factions: state.factions, supply: state.supply, round: state.round, options: state.options, log: [] })));
  act(copy, pid, cardById(cardId), t);
  return { board: copy.board, players: copy.players };
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
    case 'burst': return `${F(t.faction)} at ${L(t.location)} scatter to ${(t.from ?? []).filter((l) => l !== '__stop').map(L).join(', ')}${how}`;
    case 'control': return `${(t.from ?? []).filter((l) => l !== '__stop').length} ${F(t.faction)} cut down at ${L(t.location)}${how}`;
    case 'raise': return `${(t.from ?? []).filter((l) => l !== '__stop').length} of the dead rise at ${L(t.location)}${how}`;
    case 'plough': return `the fight at ${L(t.location)} scatters to ${[...new Set((t.from ?? []).filter((l) => l !== '__stop'))].map(L).join(', ')}${how}`;
    case 'rejoin': { const x = (t.from ?? []).filter((l) => l !== '__stop'); return `${F(t.faction)} at ${L(t.location)} scatter to their own${x.length ? `, extras to ${x.map(L).join(', ')}` : ''}${how}`; }
    case 'chase': { const p = (t.path ?? []).filter((l) => l !== '__stop'); return `${F(t.faction)} chased from ${L(t.location)} to ${L(p[p.length - 1])}${p.length > 1 ? ` via ${p.slice(0, -1).map(L).join(', ')}` : ''}${how}`; }
    case 'well': return `${F(t.faction)} drawn into ${L(t.location)}${(t.from ?? []).filter((l) => l !== '__stop').length ? `, ${(t.from ?? []).filter((l) => l !== '__stop').length} out of fights next door` : ''}${how}`;
    case 'herd': { const p = (t.path ?? []).filter((l) => l !== '__stop'); return `${F(t.faction)} from ${L(t.location)}${p.length > 1 ? ` via ${p.slice(0, -1).map(L).join(', ')}` : ''} to ${L(p[p.length - 1])}${how}`; }
    case 'threat': return `${F(t.faction)} at ${L(t.location)} march on ${L(t.to)}${how}`;
    case 'gate': return `${L(t.location)} and ${L(t.to)} joined${t.payer ? `, ${F(t.payer)} paying` : ''}${t.losses ? `; the winner's losses from ${L(t.losses)}` : ''}`;
    case 'invite': return `${(t.moves ?? []).map((g) => `${F(g.faction)} from ${L(g.location)}`).join(' and ')} into ${L(t.location)}${t.payer ? `, ${F(t.payer)} paying at the fight` : ''}`;
    case 'favours': return t.use === 'sway' ? `sway from the supply at ${(t.from ?? []).filter((l) => l !== '__stop').map(L).join(', ')}` : `${(t.payers ?? []).filter((x) => x !== '__stop').length} standing with ${F((t.payers ?? [])[0])}`;
    case 'stakes': return t.use === 'standing' ? `standing gathered with ${F(t.faction)}` : t.use === 'sway' ? `sway gathered at ${L(t.location)}` : `${F(t.faction)} come in to ${L(t.location)}`;
    case 'exit': return t.use === 'standing' ? `standing spread from ${F(t.faction)}` : t.use === 'sway' ? `sway spread from ${L(t.location)}` : `${F(t.faction)} scatter from ${L(t.location)}`;
    case 'showdown': return `${(t.from ?? []).filter((l) => l !== '__stop').length} ${F(t.faction)} slain at ${L(t.location)}`;
    case 'switch': return t.use === 'standing' ? `standing from ${F(t.faction)} to ${F(t.to)}` : `sway from ${L(t.location)} to ${L(t.to)}`;
    case 'playbook': return t.use === 'yours' ? `takes ${t.back ? cardById(t.back).name : '?'} back` : 'plays the last card as their own';
    case 'terror': return `night terrors at ${[...(t.moves ?? []).map((m) => m.location), ...(t.from ?? [])].filter((l) => l !== '__stop').map(L).join(', ')}${how}`;
    case 'study': return `bodies studied at ${[...(t.moves ?? []).map((m) => m.location), ...(t.from ?? [])].filter((l) => l !== '__stop').map(L).join(', ')}${how}`;
    case 'altar': return `blood on ${[...(t.moves ?? []).map((m) => m.location), ...(t.from ?? [])].filter((l) => l !== '__stop').map(L).join(', ')}${how}`;
    case 'split': return `${F(t.faction)} at ${L(t.location)} split ${Object.entries(t.split ?? {}).map(([l, n]) => `${n} to ${L(l)}`).join(', ')}${how}`;
    default: return '';
  }
}

// ---------------------------------------------------------------------------
// Visibility (F.5, 3.11)
// ---------------------------------------------------------------------------

/**
 * A saved game from before "influence" was renamed "sway" (designer,
 * 2026-10-10), brought up to date: each location's influence and the option
 * ids. Data plumbing, not a rule; a game saved since
 * passes through unchanged.
 * @param {GameState} state @returns {GameState}
 */
export function upgradeState(state) {
  const old = /** @type {any} */ (state);
  for (const place of Object.values(old.board ?? {})) {
    if (place && 'influence' in place) { place.sway = { ...(place.sway ?? {}), ...place.influence }; delete place.influence; }
  }
  for (const key of Object.keys(old.options ?? {})) {
    if (key.startsWith('influence')) { old.options[`sway${key.slice(9)}`] ??= old.options[key]; delete old.options[key]; }
  }
  return state;
}

/**
 * The copy of the state one seat may see. Hands, kept cards, batches, the
 * left-out cards and trophy totals are hidden (3.11, IN2).
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
      return [id, { group: p.group, standing: { ...p.standing }, supply: p.supply, handSize: state.phase === 'draft' ? p.kept.length : p.hand.length, picked: p.picked }];
    })),
    factions: state.factions.slice(),
    board: Object.fromEntries(LOCATION_IDS.map((loc) => {
      const place = state.board[loc];
      return [loc, { tokens: { ...place.tokens }, sway: { ...place.sway }, scorched: place.scorched, ...(place.gate ? { gate: place.gate, gateLoss: place.gateLoss } : {}), ...(place.altar ? { altar: true } : {}), ...(place.study ? { study: place.study } : {}), ...(place.terror ? { terror: place.terror } : {}) }];
    })),
    supply: { ...state.supply },
    deck: deckOf(),
    roundPlays: (state.roundPlays ?? []).map((x) => ({ ...x })),
    printed: Object.fromEntries(deckOf().map((id) => [id, swayFor(state, playerId, id)])),
    growing: state.growing ? clone(state.growing) : null,
    night: state.night ? clone(state.night) : null,
    first: state.first,
    opened: state.opened,
    toAct: waitingOn(state)[0] ?? null,
    log: clone(state.log),
    result: state.result ? clone(state.result) : null,
    me: { hand: me.hand.slice(), kept: me.kept.slice(), batch: me.batch.slice(), picked: me.picked, trophies: { ...me.trophies } },
  };
}
