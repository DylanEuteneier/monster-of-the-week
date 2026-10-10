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
// Measured card strength (D12, designer 2026-10-08: the probe result from the tuning tournament, scripts/tournament.js strength=): sets printed influence.
import cardStrength from './card-strength.json' with { type: 'json' };

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
 * @property {Record<string, number>} tokens      faction → tokens
 * @property {Record<string, number>} influence  player → influence placed here
 * @property {Token | null} token
 * @property {boolean} scorched
 * @property {boolean} [truce]     Call a Truce (test card, round 15): no fight here this round
 * @property {string[]} [double]   Split Up, Gang! (test card, round 18): players whose influence here counts twice at this round's fight
 * @property {boolean} [wake]      Wake the Dead (test card, round 18): this round's fight can't scorch, and the loser's casualties rise as Undead
 * @property {string[]} [backdoor] Install a Backdoor (test card, round 20): players whose influence here counts 1 more per Sentient token at this round's fight
 * @property {boolean} [swarm]     Link the Swarm (test card, round 20): at this round's fight, the Sentients here count their tokens next door too
 * @property {boolean} [lock]      Lock Down the Town (test card, round 19): this round, no group moves into or out of this location's region
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
 * @property {Record<string, number>} supply  faction → tokens in its supply
 * @property {string[]} leftOut    cards not dealt this round (DR5)
 * @property {string[]} [deck]     this game's 21 cards (variant deck=mixed); absent: spec.cards
 * @property {Record<string, number>} [printed]  this game's printed influence by card (variant deck=mixed); absent: each card's own
 * @property {number} pass         draft: which pick this is (1-based)
 * @property {string | null} first  this round's first player (FP2)
 * @property {number} turn         index into seating of the player to act
 * @property {number} passesInRow
 * @property {boolean} opened      the first player has opened with their marked card
 * @property {Pending | null} pending
 * @property {{ pid: string, faction: string }[]} [tips]  Tip Off the Sheriff (test card, round 18): this round, whoever moves the faction, the tipper places 1 influence where it lands
 * @property {string[]} [bounties]  Put a Bounty On It (test card, round 19): factions whose winning group loses 1 more token at each fight this round
 * @property {string | null} [lastPlayed]  the last card played for its action (Steal Their Playbook, test card, round 15)
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
 * @property {string} [lead]       the faction the player leads, on cards that move several factions (D15)
 */

/**
 * @typedef {{ type: 'pick', keep: string[] }
 *   | { type: 'play', card: string, use: 'action' | 'influence', target?: Target | null, location?: string }
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
 * @property {Record<string, { tokens: Record<string, number>, influence: Record<string, number>, token: { owner: string } | null, scorched: boolean, truce?: boolean, double?: string[], wake?: boolean, swarm?: boolean, backdoor?: string[], lock?: boolean }>} board
 * @property {Record<string, number>} supply
 * @property {string[]} deck  this game's cards
 * @property {Record<string, number>} printed  this game's printed influence by card
 * @property {string | null} lastPlayed  the last card played for its action
 * @property {{ pid: string, faction: string }[]} tips  Tip Off the Sheriff this round (round 18)
 * @property {string[]} bounties  Put a Bounty On It this round (round 19)
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
// Test cards (spec.testCards) are ideas under measurement: never dealt, but playable on a copy.
const cardsById = new Map(/** @type {Card[]} */ (/** @type {unknown} */ ([...spec.cards, ...spec.testCards.cards])).map((card) => [card.id, card]));
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

/** Are responses in play? Out of the first draft unless the variant turns them on. @param {{ options: Options }} state */
export const responsesOn = (state) => (state.options.responses ?? 'off') === 'on';
/** IC1 (designer, 2026-10-07): the influence a card places is a requirement. @param {{ options: Options }} state */
export const influenceRequired = (state) => (state.options.influenceRequired ?? 'on') === 'on';
/** D15, as a variant: each faction moved pays its own (first draft), or only the selected faction pays (others free). @param {{ options: Options }} state */
export const selectedPays = (state) => (state.options.whoPays ?? 'each') === 'selected';
/** Cards that move several factions at once: the player names the faction they lead (location reading). */
const LEADS = new Set(['draw-adjacent', 'conveyor', 'repel', 'circle', 'carry-fight']);
/**
 * The faction that pays a card's influence (D15): the faction the player
 * selects (a target group's, or the one named on a card that moves several),
 * or the suit's faction in the faction reading. Other factions the card moves
 * come along free (designer). null: each group pays its own (scaffold multi-moves).
 * @param {GameState} state @param {Card} card @param {Target} t @returns {string | null}
 */
function ledFaction(state, card, t) {
  if (LEADS.has(/** @type {string} */ (card.action))) return card.suit && t.mode === 'faction' ? /** @type {string} */ (suitFaction(state, card)) : t.lead ?? null;
  return t.faction ?? null;
}

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

/** @param {GameState} state @param {string} loc */
const factionsAt = (state, loc) => Object.keys(state.board[loc].tokens).filter((f) => state.board[loc].tokens[f] > 0);
/** Every group on the board (memoised per state while a bot searches). @param {GameState} state @returns {{ location: string, faction: string }[]} */
function groupsOf(state) {
  const hit = memoDepth ? GROUPS_MEMO.get(state) : undefined;
  if (hit) return hit;
  const out = LOCATION_IDS.flatMap((loc) => factionsAt(state, loc).map((f) => ({ location: loc, faction: f })));
  if (memoDepth) GROUPS_MEMO.set(state, out);
  return out;
}
const GROUPS_MEMO = new WeakMap();
/** @param {GameState} state @param {string} loc @param {string} faction */
const tokensOf = (state, loc, faction) => state.board[loc].tokens[faction] ?? 0;
/** @param {string} loc */
const regionOf = (loc) => MAP[loc].region;
/** @param {GameState} state @param {string} faction */
export const presenceOf = (state, faction) => LOCATION_IDS.reduce((n, loc) => n + tokensOf(state, loc, faction), 0);
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
 * May a faction's tokens be moved into this location? Not scorched, its region
 * still passable, and never a third faction (LL1).
 * @param {GameState} state @param {string} loc @param {string} faction @param {string[]} [blocked]
 */
export function canEnter(state, loc, faction, blocked = []) {
  const place = state.board[loc];
  if (!place || place.scorched || !regionOpen(state, regionOf(loc)) || blocked.includes(loc)) return false;
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
 * Move tokens, placing 1 influence at the destination spent from the
 * player's standing with the faction moved (3.7, CA2); under IC1 (D15) a move
 * it can't pay for doesn't happen. A faction other than the led one comes
 * along free and places nothing (D15). Returns the number moved (0 if it may
 * not enter, or can't be paid for).
 * @param {GameState} state @param {string} pid @param {string} faction
 * @param {string} from @param {string} to @param {number} count @param {Placed} placedAt
 */
function move(state, pid, faction, from, to, count, placedAt) {
  const n = Math.min(count, tokensOf(state, from, faction));
  if (n <= 0 || from === to) return 0;
  if (!canEnter(state, to, faction, state.pending?.blocked ?? [])) return 0;
  if ((state.board[from].lock || state.board[to].lock) && regionOf(from) !== regionOf(to)) return 0; // Lock Down the Town (test card, round 19)
  // D15: only the led faction pays; the others come along free, placing nothing.
  const free = !!placedAt.led && faction !== placedAt.led;
  // IC1: a move that places influence goes only as far as the player can pay for it.
  const cost = num(state, 'influencePerMove');
  if (!free && influenceRequired(state) && cost > 0 && !placedAt.has(`${to}:${faction}`) && (state.players[pid].standing[faction] ?? 0) < cost) return 0;
  state.board[from].tokens[faction] -= n;
  if (state.board[from].tokens[faction] === 0) delete state.board[from].tokens[faction];
  state.board[to].tokens[faction] = tokensOf(state, to, faction) + n;
  const place = (/** @type {string} */ loc, /** @type {string} */ key, /** @type {number} */ amount) => {
    if (free || placedAt.has(key)) return;
    placedAt.add(key);
    const k = Math.min(amount, state.players[pid].standing[faction] ?? 0);
    if (k <= 0) return;
    state.players[pid].standing[faction] -= k;
    state.board[loc].influence[pid] = (state.board[loc].influence[pid] ?? 0) + k;
    for (let i = 0; i < k; i++) state.events.push({ type: 'influence-placed', player: pid, faction, location: loc });
  };
  place(to, `${to}:${faction}`, num(state, 'influencePerMove'));
  // Tip Off the Sheriff (test card, round 18): each tipper places 1 influence from their supply where the faction lands.
  for (const tip of ('tips' in state && state.tips) || []) {
    if (tip.faction !== faction || state.players[tip.pid].supply <= 0) continue;
    state.players[tip.pid].supply -= 1;
    state.board[to].influence[tip.pid] = (state.board[to].influence[tip.pid] ?? 0) + 1;
  }
  if (state.options.influenceAtOrigin === 'on') place(from, `${from}:${faction}:origin`, 1); // test lever
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

/** An unsuited card with an action and no mark: it can fill an open unsuited slot. @param {Card} c */
const unmarkedExtra = (c) => !c.suit && !('marked' in c && c.marked) && !!c.action;

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
  const board = Object.fromEntries(LOCATION_IDS.map((loc) => [loc, { tokens: {}, influence: {}, token: null, scorched: false }]));
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
    const start = num({ options }, 'startInfluence');
    // Starting setup (designer, 2026-10-07): more with the affinity faction, startOthers with every other faction.
    const others = num({ options }, 'startOthers');
    const standing = Object.fromEntries(factions.map((f) => [f, f === linked ? start : others]));
    const held = Object.values(standing).reduce((a, b) => a + b, 0);
    players[pid] = {
      group, supply: num({ options }, 'playerCubes') - held, standing,
      trophies: Object.fromEntries(factions.map((f) => [f, 0])), bluffs: num({ options }, 'bluffs'),
      hand: [], kept: [], batch: [], picked: false, known: [],
    };
    // Each slayer group starts with influence on the board at each of its affinity locations (designer, 2026-10-07), from its supply.
    const arch = spec.slayerGroups.find((g) => g.id === group)?.archetype;
    for (const loc of LOCATION_IDS.filter((l) => alignmentOf(l) === arch)) {
      const n = Math.min(onBoard, players[pid].supply);
      if (n > 0) { board[loc].influence[pid] = (board[loc].influence[pid] ?? 0) + n; players[pid].supply -= n; }
    }
  });
  // The deck. Mixed (prototype test plumbing, not a rule): each suit draws
  // one Strike, Shift and Signature from the deck and the test cards; the
  // unsuited extras stay. Fixed: Set v2.
  /** @type {string[]} */
  let deck = spec.cards.map((c) => c.id);
  if (options.deck === 'mixed') {
    const pool = /** @type {Card[]} */ (/** @type {unknown} */ ([...spec.cards, ...spec.testCards.cards])).filter((c) => c.action);
    deck = [];
    for (const arch of spec.archetypes) {
      for (const slot of ['strike', 'shift', 'signature']) {
        const s = shuffle(pool.filter((c) => c.suit === arch.id && c.slot === slot).map((c) => c.id), rngState);
        rngState = s.rngState;
        if (s.items[0]) deck.push(s.items[0]);
      }
    }
    // Unsuited: the marked cards stay; the other slots draw from every unmarked unsuited card.
    deck.push(...spec.cards.filter((c) => !c.suit && !unmarkedExtra(c)).map((c) => c.id));
  }
  // Six unsuited slots (PS1). While some have no card yet (prototype), they
  // are filled at random from the unmarked unsuited cards, so the pool stays 21.
  const unsuited = deck.filter((id) => !cardById(id).suit).length;
  const fill = shuffle(/** @type {Card[]} */ (/** @type {unknown} */ ([...spec.cards, ...spec.testCards.cards])).filter((c) => unmarkedExtra(c) && !deck.includes(c.id)).map((c) => c.id), rngState);
  rngState = fill.rngState;
  deck.push(...fill.items.slice(0, Math.max(0, spec.constants.unsuitedSlots - unsuited)));
  // Printed influence (D12): each suit prints 2, 3 and 4 (9 in all), weighted
  // to strength: the weakest action gets the most. Strength is the probe
  // result (the change in a player's chance of winning when the card is
  // played); a card not yet measured counts as weakest; ties fall at random.
  /** @type {Record<string, number>} */
  const printed = {};
  const strength = (/** @type {string} */ id) => /** @type {Record<string, number>} */ (cardStrength.strength)[id] ?? -Infinity;
  for (const arch of spec.archetypes) {
    const s = shuffle(deck.filter((id) => cardById(id).suit === arch.id), rngState);
    rngState = s.rngState;
    const byStrength = s.items.slice().sort((a, b) => strength(b) - strength(a));
    byStrength.forEach((id, i) => { printed[id] = [2, 3, 4][i] ?? 3; });
  }
  /** @type {GameState} */
  const state = {
    version: spec.meta.version, options, rngState, phase: 'draft', round: 1, seating: input.players.slice(), players, factions,
    board, supply, leftOut: [], pass: 1, first: null, turn: 0, passesInRow: 0, opened: false, pending: null, events: [], growing: null,
    log: [], result: null, deck, printed, lastPlayed: null, tips: [],
  };
  return deal(state);
}

/** This game's cards: its mixed deck, or the fixed pool. @param {GameState | PlayerView} state */
export const deckOf = (state) => ('deck' in state && state.deck ? state.deck.slice() : spec.cards.map((card) => card.id));
/** A card's printed influence in this game. @param {GameState | PlayerView} state @param {string} cardId */
export const printedOf = (state, cardId) => (('printed' in state && state.printed?.[cardId]) || cardById(cardId).influence)
  + (cardById(cardId).suit ? num(state, 'influenceBonus') : 0); // test lever: more influence from cards (designer, 2026-10-07)

/** Start a round's draft: shuffle all 21 cards, deal hands, leave the rest out (PS1, DR4, DR5). @param {GameState} state */
function deal(state) {
  const handSize = /** @type {Record<string, number>} */ (spec.constants.handSize)[String(state.seating.length)];
  const s = shuffle(deckOf(state), state.rngState);
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
  if (!t.location || !t.faction || tokensOf(state, t.location, t.faction) <= 0) return 'Choose a group on the board.';
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

/** Locations under the two-target rule: a suit location, or one holding the suit's faction. @param {GameState} state @param {Card} card @param {'location' | 'faction'} mode */
function holdingSpots(state, card, mode) {
  if (!card.suit) return LOCATION_IDS.filter((loc) => !state.board[loc].scorched); // unsuited: any location
  const sf = suitFaction(state, card);
  return LOCATION_IDS.filter((loc) => !state.board[loc].scorched && (mode === 'location' ? suitLocations(card).includes(loc) : tokensOf(state, loc, /** @type {string} */ (sf)) > 0));
}

/** Round 10 test cards. @param {GameState | PlayerView} state @param {string} loc */
const contestAt = (state, loc) => !state.board[loc].scorched && factionsAt(/** @type {GameState} */ (state), loc).length === 2;
/** Where each group next to `loc` would be pushed: one hex straight on, away from it (repel). @param {GameState} state @param {string} loc @param {string[]} factions */
function pushes(state, loc, factions) {
  const { q, r } = MAP[loc];
  return MAP[loc].adjacent.flatMap((from) => {
    const d = spec.map.directions.find((x) => x.dq === MAP[from].q - q && x.dr === MAP[from].r - r);
    const to = d ? step(state, from, d.id) : null;
    return factionsAt(state, from).filter((f) => factions.includes(f)).map((f) => ({ from, f, to }));
  }).filter((g) => g.to && canEnter(state, g.to, g.f));
}

/** Where a slide stops: hex by hex in one direction while the group can enter (round 11). @param {GameState} state @param {string} loc @param {string} f @param {string} dir */
function slideEnd(state, loc, f, dir) {
  let at = loc;
  for (let next = step(state, at, dir); next && next !== loc && canEnter(state, next, f); next = step(state, at, dir)) at = next;
  return at;
}
/** Can two groups trade places (round 11)? Each must be able to stand where the other was. @param {GameState} state @param {{ location: string, faction: string }} a @param {{ location: string, faction: string }} b */
function canSwap(state, a, b) {
  if (a.location === b.location || a.faction === b.faction) return false;
  const after = (/** @type {string} */ loc, /** @type {string} */ out, /** @type {string} */ inn) => {
    const place = state.board[loc];
    if (place.scorched) return false;
    const left = factionsAt(state, loc).filter((f) => f !== out);
    return left.includes(inn) || left.length < 2;
  };
  return tokensOf(state, a.location, a.faction) > 0 && tokensOf(state, b.location, b.faction) > 0 && after(a.location, a.faction, b.faction) && after(b.location, b.faction, a.faction);
}

/** The ring round a location, clockwise: [from, to] for each neighbour with a next neighbour (round 12). @param {GameState} state @param {string} loc */
function ringSteps(state, loc) {
  const dirs = spec.map.directions.map((d) => d.id).reverse(); // E, SE, SW, W, NW, NE: clockwise on screen
  const ring = dirs.map((d) => step(state, loc, d));
  return ring.flatMap((from, i) => {
    const to = ring[(i + 1) % ring.length];
    return from && to ? [[from, to]] : [];
  });
}
/** Groups that would circle (round 12). @param {GameState} state @param {string} loc @param {string[]} factions */
const circlers = (state, loc, factions) => ringSteps(state, loc).flatMap(([from, to]) => factionsAt(state, from).filter((f) => factions.includes(f) && !state.board[to].scorched).map((f) => ({ from, to, f })));
/** Go Viral and Hack the Network (round 20): locations holding exactly one faction other than f, which f can enter. @param {GameState | PlayerView} state @param {string} f @param {string[]} from */
const loneRivals = (state, f, from) => from.filter((l) => !state.board[l].scorched && canEnter(/** @type {GameState} */ (state), l, f) && factionsAt(/** @type {GameState} */ (state), l).filter((o) => o !== f).length === 1 && tokensOf(/** @type {GameState} */ (state), l, f) === 0);
/** Open the Pit (v2, round 17): where a small group can fall to, in its region. @param {GameState | PlayerView} state @param {string} loc @param {string} f */
function pitFalls(state, loc, f) {
  return LOCATION_IDS.filter((l) => l !== loc && regionOf(l) === regionOf(loc) && !state.board[l].scorched && canEnter(/** @type {GameState} */ (state), l, f));
}

/** Where Install the Cameras places influence, with the faction it spends standing from (round 12). @param {GameState | PlayerView} state @param {string} pid @param {string} loc */
function cameraSpots(state, pid, loc) {
  const standing = { ...state.players[pid].standing };
  return [loc, ...MAP[loc].adjacent].flatMap((l) => {
    if (state.board[l].scorched) return [];
    const f = factionsAt(/** @type {GameState} */ (state), l).filter((x) => (standing[x] ?? 0) > 0).sort((a, b) => (standing[b] ?? 0) - (standing[a] ?? 0))[0];
    if (!f) return [];
    standing[f] -= 1;
    return [{ loc: l, f }];
  });
}
/** Where a Howl draws a group two hexes out: a location next to both, already holding that faction if one does, else the first it can enter (round 13). @param {GameState} state @param {string} target @param {string} from @param {string} f */
function howlStep(state, target, from, f) {
  const between = MAP[from].adjacent.filter((m) => MAP[target].adjacent.includes(m) && canEnter(state, m, f));
  return between.find((m) => tokensOf(state, m, f) > 0) ?? between[0] ?? null;
}
/** Lay a Trail: locations where the player alone has the most influence. @param {GameState | PlayerView} state @param {string} pid */
const trailSpots = (state, pid) => LOCATION_IDS.filter((l) => {
  const inf = state.board[l].influence, mine = inf[pid] ?? 0;
  return !state.board[l].scorched && mine > 0 && Object.entries(inf).every(([p, n]) => p === pid || n < mine);
});
/**
 * Steal Their Playbook (test card, round 15): the card it copies, the last one played for its action; otherwise the card itself.
 * @param {GameState | PlayerView} state @param {Card} card @returns {Card}
 */
const copied = (state, card) => (card.action === 'copy' && 'lastPlayed' in state && state.lastPlayed ? cardById(state.lastPlayed) : card);
/** Fall Back: the locations next to `to` holding the player's influence (`to` itself not scorched). @param {GameState | PlayerView} state @param {string} pid @param {string} to */
const fallBackFrom = (state, pid, to) => (state.board[to].scorched ? [] : MAP[to].adjacent.filter((l) => (state.board[l].influence[pid] ?? 0) > 0));
/** Groups a Howl draws in (round 13). @param {GameState} state @param {string} target @param {string} f */
const howlers = (state, target, f) => LOCATION_IDS.filter((l) => l !== target && !MAP[target].adjacent.includes(l) && twoHex(target).includes(l) && tokensOf(state, l, f) > 0)
  .flatMap((from) => { const to = howlStep(state, target, from, f); return to ? [{ from, to }] : []; });
/** Network jump destinations (round 13). @param {GameState} state @param {Card} card @param {Target} t */
const networkSpots = (state, card, t) => (t.mode === 'location' ? suitLocations(card) : LOCATION_IDS.filter((l) => tokensOf(state, l, /** @type {string} */ (suitFaction(state, card))) > 0))
  .filter((l) => l !== t.location && canEnter(state, l, /** @type {string} */ (t.faction)));
/** Would a shove be needed, and who could be shoved (round 13)? The smaller group already there; ties are the player's choice. @param {GameState} state @param {string} to @param {string} f */
function shoveable(state, to, f) {
  const there = factionsAt(state, to);
  if (there.includes(f) || there.length < 2) return null;
  const least = Math.min(...there.map((x) => tokensOf(state, to, x)));
  return there.filter((x) => tokensOf(state, to, x) === least);
}

/** Can a group join `to` after `mover` has entered it? @param {GameState} state @param {string} to @param {string} mover @param {string} f */
const canFollow = (state, to, mover, f) => {
  const there = new Set([...factionsAt(state, to), mover]);
  return !state.board[to].scorched && (there.has(f) || there.size < 2);
};

/**
 * Where 1 influence goes when a card is spent for influence, under the test
 * lever influenceToBoard: the locations its faction controls (LC2). Empty
 * when the lever is off.
 * @param {GameState | PlayerView} state @param {string} cardId
 */
export function influenceSpots(state, cardId) {
  const card = cardById(cardId);
  if (state.options.influenceToBoard !== 'on' || !card.suit) return [];
  const f = factionOfArchetype(state, card.suit);
  return LOCATION_IDS.filter((loc) => !state.board[loc].scorched && controllerOf(/** @type {GameState} */ (state), loc) === f);
}

/** Free locations for a hidden token under the two-target rule (3.11). @param {GameState} state @param {Card} card @param {'location' | 'faction'} mode */
function tokenSpots(state, card, mode) {
  if (!card.suit) return LOCATION_IDS.filter((loc) => !state.board[loc].token && !state.board[loc].scorched); // Set a Trap: any location
  const sf = suitFaction(state, card);
  return LOCATION_IDS.filter((loc) => !state.board[loc].token && !state.board[loc].scorched
    && (mode === 'location' ? suitLocations(card).includes(loc) : tokensOf(state, loc, /** @type {string} */ (sf)) > 0));
}

/** @typedef {Set<string> & { led: string | null }} Placed  where influence was placed this action, and the led faction (D15) */

/**
 * The factions a target would move, before IC1 (influence not required).
 * @param {GameState} state @param {string} pid @param {Card} card @param {Target} t
 */
function movingFactions(state, pid, card, t) {
  const copy = /** @type {GameState} */ (/** @type {unknown} */ (clone({ board: state.board, players: state.players, pending: state.pending, factions: state.factions, supply: state.supply, round: state.round, options: { ...state.options, influenceRequired: 'off' }, lastPlayed: state.lastPlayed ?? null, leftOut: state.leftOut ?? [], tips: state.tips ?? [], events: [], log: [] })));
  act(copy, pid, card, t);
  return state.factions.filter((f) => LOCATION_IDS.some((l) => (copy.board[l].tokens[f] ?? 0) > (state.board[l].tokens[f] ?? 0)));
}

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
  if (reason || !t) return reason;
  const lead = selectedPays(state) && LEADS.has(/** @type {string} */ (copied(state, card).action)) ? ledFaction(state, copied(state, card), t) : 'n/a';
  if (lead === null) return 'Choose the faction you lead.';
  if (lead !== 'n/a' && !movingFactions(state, pid, card, { ...t, lead: undefined }).includes(lead)) return 'That faction doesn\'t move with this card.';
  if (!influenceRequired(state)) return null;
  const cost = num(state, 'influencePerMove');
  const led = selectedPays(state) ? ledFaction(state, copied(state, card), t) : null;
  if (led && cost > 0 && (state.players[pid].standing[led] ?? 0) < cost && movingFactions(state, pid, card, t).includes(led)) return 'You need standing with the faction you lead to pay for the influence this move places (IC1).';
  // IC1: the card must be payable for at least one of its moves.
  const moved = (/** @type {Options} */ options) => {
    const copy = /** @type {GameState} */ (/** @type {unknown} */ (clone({ board: state.board, players: state.players, pending: state.pending, factions: state.factions, supply: state.supply, round: state.round, options, lastPlayed: state.lastPlayed ?? null, leftOut: state.leftOut ?? [], tips: state.tips ?? [], events: [], log: [] })));
    act(copy, pid, card, t);
    return LOCATION_IDS.some((l) => JSON.stringify(copy.board[l].tokens) !== JSON.stringify(state.board[l].tokens));
  };
  if (!moved(state.options) && moved({ ...state.options, influenceRequired: 'off' })) return 'You need standing with the faction to pay for the influence this move places (IC1).';
  return null;
}

/** The target's shape, before IC1. @param {GameState} state @param {string} pid @param {Card} card @param {Target | null | undefined} t @returns {string | null} */
function checkShape(state, pid, card, t) {
  card = copied(state, card);
  if (!card.action) return 'This card has no turn action.';
  if (!t) return null; // a card with no legal target may be played for no effect (partial actions)
  switch (card.action) {
    case 'lure': return placeTarget(state, card, t);
    case 'sow': return groupTarget(state, card, t) ?? (t.path === undefined || Array.isArray(t.path) ? null : 'Choose a path.');
    case 'token': {
      if (card.suit && t.mode !== 'location' && t.mode !== 'faction') return 'Choose a location target or a faction target.';
      const spots = tokenSpots(state, card, t.mode ?? 'location');
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
      if (!t.from || t.from.length < 1 || t.from.length > 2 || t.from.some((l) => tokensOf(state, l, /** @type {string} */ (t.faction)) <= 0 || l === t.location)) return 'Choose one or two locations holding that faction.';
      return null;
    }
    case 'halve': case 'halve-far': case 'teleport': case 'split': {
      const e = groupTarget(state, card, t);
      if (e) return e;
      const loc = /** @type {string} */ (t.location), f = /** @type {string} */ (t.faction);
      if (card.action === 'halve') return tokensOf(state, loc, f) >= 2 && t.to && MAP[loc].adjacent.includes(t.to) ? null : 'Half needs a group of 2 or more and an adjacent destination.';
      if (card.action === 'halve-far') return tokensOf(state, loc, f) >= 2 && t.to && t.to !== loc && state.board[t.to] ? null : 'Half needs a group of 2 or more and a destination.';
      if (card.action === 'teleport') return t.to && t.to !== loc && state.board[t.to] ? null : 'Choose where to set it down.';
      if (card.action === 'split') {
        const split = t.split ?? {};
        const dests = Object.keys(split).filter((d) => split[d] > 0);
        if (dests.length < 2 || dests.some((d) => !MAP[loc].adjacent.includes(d))) return 'Split across at least two adjacent locations.';
        if (dests.reduce((n, d) => n + split[d], 0) !== tokensOf(state, loc, f)) return 'Every token must go somewhere.';
      }
      return null;
    }
    case 'gather-region': case 'gather-neighbours': case 'call-home': case 'draw-adjacent': {
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
    case 'drive-out': case 'drive-out-either': {
      if (!t.location || factionsAt(state, t.location).length !== 2 || !t.faction || tokensOf(state, t.location, t.faction) <= 0) return 'Choose a faction at a contested location.';
      if (t.mode === 'location') {
        if (!suitLocations(card).includes(t.location)) return 'That location is not one of the suit\'s.';
        const [a, b] = factionsAt(state, t.location);
        const smaller = tokensOf(state, t.location, a) <= tokensOf(state, t.location, b) ? a : b;
        if (card.action === 'drive-out' && tokensOf(state, t.location, t.faction) > tokensOf(state, t.location, smaller)) return 'Only the smaller faction can be driven out.';
      } else if (t.mode === 'faction') {
        if (t.faction !== suitFaction(state, card)) return 'Only the suit\'s faction.';
      } else return 'Choose a location target or a faction target.';
      return t.to && MAP[t.location].adjacent.includes(t.to) ? null : 'Choose an adjacent location to drive them to.';
    }
    case 'reinforce': {
      const e = groupTarget(state, card, t);
      if (e) return e;
      return state.supply[/** @type {string} */ (t.faction)] > 0 ? null : 'That faction has no tokens in its supply.';
    }
    case 'carry-fight': {
      if (t.mode !== 'location' && t.mode !== 'faction') return 'Choose a location target or a faction target.';
      if (!t.location || !contestAt(state, t.location)) return 'Choose a contested location.';
      if (t.mode === 'location' ? !suitLocations(card).includes(t.location) : tokensOf(state, t.location, /** @type {string} */ (suitFaction(state, card))) <= 0) return 'That contest is not the suit\'s.';
      return t.to && MAP[t.location].adjacent.includes(t.to) && factionsAt(state, t.to).length === 0 && canEnter(state, t.to, factionsAt(state, t.location)[0]) ? null : 'Choose an adjacent location with no tokens.';
    }
    case 'defect': case 'pit': {
      if (!t.location || !t.faction || tokensOf(state, t.location, t.faction) <= 0) return 'Choose a group on the board.';
      const other = factionsAt(state, t.location).find((f) => f !== t.faction);
      if (card.action === 'defect' && !contestAt(state, t.location)) return 'Choose a group in a contest.';
      if (card.action === 'pit' && tokensOf(state, t.location, t.faction) > 3) return 'Only a group of 3 or fewer tokens.';
      if (t.mode === 'location') return suitLocations(card).includes(t.location) ? null : 'That location is not one of the suit\'s.';
      if (t.mode === 'faction') return other && other === suitFaction(state, card) ? null : 'The group must share its location with the suit\'s faction.';
      return 'Choose a location target or a faction target.';
    }
    case 'slide': case 'chain': {
      const e = groupTarget(state, card, t);
      if (e) return e;
      if (!spec.map.directions.some((d) => d.id === t.direction)) return 'Choose a direction.';
      const next = step(state, /** @type {string} */ (t.location), /** @type {string} */ (t.direction));
      if (card.action === 'slide') return slideEnd(state, /** @type {string} */ (t.location), /** @type {string} */ (t.faction), /** @type {string} */ (t.direction)) !== t.location ? null : 'It can\'t move that way.';
      return next && !state.board[next].scorched ? null : 'Nothing lies that way.';
    }
    case 'swap-far': {
      const e = groupTarget(state, card, t);
      if (e) return e;
      const other = t.moves?.[0];
      return other && canSwap(state, { location: /** @type {string} */ (t.location), faction: /** @type {string} */ (t.faction) }, other) ? null : 'Choose a group elsewhere that can trade places with it.';
    }
    case 'circle': return placeTarget(state, card, t) ?? (circlers(state, /** @type {string} */ (t.location), movable(state, card, t)).length ? null : 'Nothing round it can circle.');
    case 'surveil': {
      if ((t.mode !== 'location' && t.mode !== 'faction') || !t.location || !holdingSpots(state, card, t.mode).includes(t.location)) return 'Choose the target location.';
      return cameraSpots(state, pid, t.location).length ? null : 'You have no standing with any faction there or next to it.';
    }
    case 'follow': {
      const e = groupTarget(state, card, t);
      if (e) return e;
      const from = /** @type {string} */ (t.location), f = /** @type {string} */ (t.faction);
      if (!t.to || !MAP[from].adjacent.includes(t.to) || !canEnter(state, t.to, f)) return 'Choose an adjacent location it can enter.';
      const g = t.moves?.[0];
      if (g && (g.faction === f || !MAP[t.to].adjacent.includes(g.location) || g.location === t.to || tokensOf(state, g.location, g.faction) <= 0 || !canFollow(state, t.to, f, g.faction))) return 'That group can\'t follow it in.';
      return null;
    }
    case 'leap': {
      const e = groupTarget(state, card, t);
      if (e) return e;
      const over = t.direction ? step(state, /** @type {string} */ (t.location), t.direction) : null;
      const land = over ? step(state, over, /** @type {string} */ (t.direction)) : null;
      return land && canEnter(state, land, /** @type {string} */ (t.faction)) ? null : 'Nothing to land on that way.';
    }
    case 'network': {
      const e = groupTarget(state, card, t);
      if (e) return e;
      return t.to && networkSpots(state, card, t).includes(t.to) ? null : 'Choose where on the network it goes.';
    }
    case 'shove': {
      const e = groupTarget(state, card, t);
      if (e) return e;
      const f = /** @type {string} */ (t.faction);
      if (!t.to || !MAP[/** @type {string} */ (t.location)].adjacent.includes(t.to) || state.board[t.to].scorched) return 'Choose an adjacent location.';
      const can = shoveable(state, t.to, f);
      if (!can) return canEnter(state, t.to, f) ? null : 'It can\'t enter there.';
      const g = t.moves?.[0];
      if (!g || g.location !== t.to || !can.includes(g.faction) || !MAP[t.to].adjacent.includes(g.to) || !canEnter(state, g.to, g.faction)) return 'Shove the smaller group on to an adjacent location it can enter.';
      return null;
    }
    case 'howl': {
      const e = placeTarget(state, card, t);
      if (e) return e;
      if (!t.faction || !movable(state, card, t).includes(t.faction)) return 'Choose which faction answers.';
      return howlers(state, t.location ?? '', t.faction).length ? null : 'No group of that faction two hexes away can come closer.';
    }
    case 'repel': return placeTarget(state, card, t) ?? (pushes(state, /** @type {string} */ (t.location), movable(state, card, t)).length ? null : 'Nothing next to it can be pushed away.');
    case 'move-influence': {
      if ((card.suit && t.mode !== 'location' && t.mode !== 'faction') || !t.location || !holdingSpots(state, card, t.mode ?? 'location').includes(t.location)) return 'Choose the target location.';
      const from = t.from ?? [];
      if (from.length < 1 || from.length > 3) return 'Move 1 to 3 influence.';
      for (const l of new Set(from)) if (l === t.location || from.filter((x) => x === l).length > (state.board[l]?.influence[pid] ?? 0)) return 'You don\'t have that much influence there.';
      return null;
    }
    case 'cash-in': {
      if ((t.mode !== 'location' && t.mode !== 'faction') || !t.location || !holdingSpots(state, card, t.mode).includes(t.location)) return 'Choose the target location.';
      if (!t.faction || tokensOf(state, t.location, t.faction) <= 0 || (state.players[pid].standing[t.faction] ?? 0) <= 0) return 'Choose a faction there you have standing with.';
      return null;
    }
    case 'bail-out': {
      if (!t.location || (state.board[t.location]?.influence[pid] ?? 0) <= 0) return 'Choose a location where you have influence.';
      return t.to && t.to !== t.location && state.board[t.to] && !state.board[t.to].scorched ? null : 'Choose where your influence goes.';
    }
    case 'backup': {
      if (!t.location || (state.board[t.location]?.influence[pid] ?? 0) <= 0) return 'Choose a location where you have influence.';
      return state.players[pid].supply > 0 ? null : 'You have no cubes in your supply.';
    }
    case 'fall-back': return t.location && fallBackFrom(state, pid, t.location).length ? null : 'Choose a location next to your influence.';
    case 'canvass': {
      const at = t.from ?? [];
      if (at.length < 1 || at.length > 4 || new Set(at).size !== at.length || at.some((l) => !state.board[l] || state.board[l].scorched)) return 'Choose one to four locations.';
      return state.players[pid].supply > 0 ? null : 'You have no cubes in your supply.';
    }
    case 'bait': {
      if (!t.location || !state.board[t.location] || state.board[t.location].scorched) return 'Choose where to set the bait.';
      const from = t.from?.[0];
      return t.faction && from && MAP[t.location].adjacent.includes(from) && tokensOf(state, from, t.faction) > 0 && canEnter(state, t.location, t.faction) ? null : 'Choose a group next to it.';
    }
    case 'allegiance': {
      if (!t.faction || (state.players[pid].standing[t.faction] ?? 0) <= 0) return 'Choose a faction you have standing with.';
      return t.to && t.to !== t.faction && state.factions.includes(t.to) ? null : 'Choose the faction your standing goes to.';
    }
    case 'surveil-supply': {
      if ((card.suit && t.mode !== 'location' && t.mode !== 'faction') || !t.location || !holdingSpots(state, card, t.mode ?? 'location').includes(t.location)) return 'Choose the target location.';
      return state.players[pid].supply > 0 ? null : 'You have no cubes in your supply.';
    }
    case 'pit-fall': {
      const e = groupTarget(state, card, t);
      if (e) return e;
      if (tokensOf(state, /** @type {string} */ (t.location), /** @type {string} */ (t.faction)) > 3) return 'Only a group of 3 or fewer tokens.';
      return t.to && pitFalls(state, /** @type {string} */ (t.location), /** @type {string} */ (t.faction)).includes(t.to) ? null : 'Choose a location in its region it can fall to.';
    }
    case 'raise-stakes': return t.location && contestAt(state, t.location) && state.players[pid].supply > 0 ? null : 'Choose a contested location (with cubes in your supply).';
    case 'swap-standing': return t.faction && t.to && t.faction !== t.to && state.factions.includes(t.faction) && state.factions.includes(t.to) ? null : 'Choose two factions.';
    case 'split-up': {
      const at = t.from ?? [];
      if (at.length < 1 || at.length > 3 || new Set(at).size !== at.length || new Set(at.map(regionOf)).size !== at.length || at.some((l) => !state.board[l] || state.board[l].scorched)) return 'Choose up to three locations in different regions.';
      return state.players[pid].supply > 0 ? null : 'You have no cubes in your supply.';
    }
    case 'tipoff': case 'bounty': return t.faction && state.factions.includes(t.faction) ? null : 'Choose a faction.';
    case 'lockdown': return t.location && state.board[t.location] && !state.board[t.location].lock ? null : 'Choose a location in a region not already locked down.';
    case 'wake-dead': case 'swarm': case 'backdoor': return (t.mode === 'location' || t.mode === 'faction') && t.location && holdingSpots(state, card, t.mode).includes(t.location) ? null : 'Choose the target location.';
    case 'hack': {
      const e = groupTarget(state, card, t);
      if (e) return e;
      return t.to && t.to !== t.location && loneRivals(state, /** @type {string} */ (t.faction), LOCATION_IDS).includes(t.to) ? null : 'Choose a location holding one other faction.';
    }
    case 'truce': return t.location && state.board[t.location] && !state.board[t.location].scorched ? null : 'Choose a location.';
    case 'copy': return 'Nothing has been played to copy yet.';
    case 'trail': {
      if (!t.location || !trailSpots(state, pid).includes(t.location)) return 'Choose a location where you have the most influence.';
      const from = t.from?.[0];
      return t.faction && from && MAP[t.location].adjacent.includes(from) && tokensOf(state, from, t.faction) > 0 && canEnter(state, t.location, t.faction) ? null : 'Choose a group next to it.';
    }
    case 'stake': return t.location && state.board[t.location] && !state.board[t.location].scorched ? (state.players[pid].supply > 0 ? null : 'You have no cubes in your supply.') : 'Choose a location.';
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
  card = copied(state, card);
  /** @type {Placed} */
  const placed = Object.assign(new Set(), { led: selectedPays(state) ? ledFaction(state, card, t) : null });
  const names = (/** @type {string} */ f) => factionById(f).name;
  const lname = (/** @type {string} */ l) => locationById(l).name;
  switch (card.action) {
    case 'lure': {
      const to = /** @type {string} */ (t.location);
      const groups = MAP[to].adjacent.flatMap((from) => movable(state, card, t).map((f) => ({ from, f, n: tokensOf(state, from, f) })))
        .filter((g) => g.n > 0 && canEnter(state, to, g.f, state.pending?.blocked)).sort((a, b) => b.n - a.n);
      const pick = (t.faction && t.from?.[0] ? groups.find((g) => g.f === t.faction && g.from === t.from?.[0] && g.n === groups[0].n) : null) ?? groups[0];
      if (pick) logLine(state, `${pid}: ${card.name} draws ${move(state, pid, pick.f, pick.from, to, pick.n, placed)} ${names(pick.f)} into ${lname(to)}.`);
      break;
    }
    case 'sow': {
      // The whole group sets off; each location entered gets 1 token and 1 of
      // the player's influence; the chase stops at a location it can't enter
      // or when the player's influence with that faction runs out; leftover
      // tokens stay together at the last location entered.
      const f = /** @type {string} */ (t.faction), start = /** @type {string} */ (t.location);
      let left = tokensOf(state, start, f);
      delete state.board[start].tokens[f];
      let at = start;
      const visited = /** @type {string[]} */ ([]);
      for (const next of t.path ?? []) {
        if (left <= 0 || next === start || visited.includes(next) || !MAP[at].adjacent.includes(next) || !canEnter(state, next, f, state.pending?.blocked) || (state.players[pid].standing[f] ?? 0) <= 0) break;
        state.board[next].tokens[f] = tokensOf(state, next, f) + 1;
        state.players[pid].standing[f] -= 1;
        state.board[next].influence[pid] = (state.board[next].influence[pid] ?? 0) + 1;
        state.events.push({ type: 'influence-placed', player: pid, faction: f, location: next });
        left -= 1;
        visited.push(next);
        at = next;
      }
      if (left > 0) state.board[at].tokens[f] = tokensOf(state, at, f) + left;
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
      for (const from of t.from ?? []) n += move(state, pid, f, from, /** @type {string} */ (t.location), tokensOf(state, from, f), placed);
      logLine(state, `${pid}: ${card.name} calls ${n} ${names(f)} into ${lname(/** @type {string} */ (t.location))}.`);
      break;
    }
    case 'halve': {
      const f = /** @type {string} */ (t.faction), from = /** @type {string} */ (t.location);
      const n = move(state, pid, f, from, /** @type {string} */ (t.to), Math.floor(tokensOf(state, from, f) / 2), placed);
      logLine(state, `${pid}: ${card.name} sends ${n} ${names(f)} from ${lname(from)} to ${lname(/** @type {string} */ (t.to))}.`);
      break;
    }
    case 'halve-far': {
      const f = /** @type {string} */ (t.faction), from = /** @type {string} */ (t.location);
      const n = move(state, pid, f, from, /** @type {string} */ (t.to), Math.floor(tokensOf(state, from, f) / 2), placed);
      logLine(state, `${pid}: ${card.name} sends ${n} ${names(f)} from ${lname(from)} to ${lname(/** @type {string} */ (t.to))}.`);
      break;
    }
    case 'teleport': {
      const f = /** @type {string} */ (t.faction), from = /** @type {string} */ (t.location);
      const n = move(state, pid, f, from, /** @type {string} */ (t.to), tokensOf(state, from, f), placed);
      logLine(state, `${pid}: ${card.name} lifts ${n} ${names(f)} from ${lname(from)} to ${lname(/** @type {string} */ (t.to))}.`);
      break;
    }
    case 'surveil-supply': {
      const at = [/** @type {string} */ (t.location), ...MAP[/** @type {string} */ (t.location)].adjacent].filter((l) => !state.board[l].scorched && factionsAt(state, l).length > 0);
      const n = Math.min(at.length, state.players[pid].supply);
      for (const l of at.slice(0, n)) state.board[l].influence[pid] = (state.board[l].influence[pid] ?? 0) + 1;
      state.players[pid].supply -= n;
      logLine(state, `${pid}: ${card.name} places influence at ${at.slice(0, n).map(lname).join(', ')}.`);
      break;
    }
    case 'pit-fall': {
      const f = /** @type {string} */ (t.faction), from = /** @type {string} */ (t.location), to = /** @type {string} */ (t.to);
      logLine(state, `${pid}: ${card.name}: ${move(state, pid, f, from, to, tokensOf(state, from, f), placed)} ${names(f)} fall through to ${lname(to)}.`);
      break;
    }
    case 'raise-stakes': {
      const to = /** @type {string} */ (t.location);
      const n = Math.min(5, Math.max(...factionsAt(state, to).map((f) => tokensOf(state, to, f))), state.players[pid].supply);
      state.players[pid].supply -= n;
      state.board[to].influence[pid] = (state.board[to].influence[pid] ?? 0) + n;
      logLine(state, `${pid}: ${card.name} places ${n} influence at ${lname(to)}.`);
      break;
    }
    case 'swap-standing': {
      const a = /** @type {string} */ (t.faction), b = /** @type {string} */ (t.to), st = state.players[pid].standing;
      [st[a], st[b]] = [st[b] ?? 0, st[a] ?? 0];
      logLine(state, `${pid}: ${card.name} swaps their standing with ${names(a)} and ${names(b)}.`);
      break;
    }
    case 'gather-region': case 'gather-neighbours': {
      const f = /** @type {string} */ (t.faction), to = /** @type {string} */ (t.location);
      const regions = card.action === 'gather-region' ? [regionOf(to)] : REGIONS[regionOf(to)].neighbours;
      let n = 0;
      for (const from of LOCATION_IDS.filter((l) => regions.includes(regionOf(l)) && l !== to)) n += move(state, pid, f, from, to, tokensOf(state, from, f), placed);
      logLine(state, `${pid}: ${card.name} gathers ${n} ${names(f)} into ${lname(to)}.`);
      break;
    }
    case 'call-home': {
      // Call Home (round 20): 1 token from every other location holding the faction, anywhere.
      const f = /** @type {string} */ (t.faction), to = /** @type {string} */ (t.location);
      let n = 0;
      for (const from of LOCATION_IDS.filter((l) => l !== to && tokensOf(state, l, f) > 0)) n += move(state, pid, f, from, to, 1, placed);
      logLine(state, `${pid}: ${card.name} calls ${n} ${names(f)} home to ${lname(to)}.`);
      break;
    }
    case 'backdoor': {
      const place = state.board[/** @type {string} */ (t.location)];
      place.backdoor = [...(place.backdoor ?? []), pid];
      logLine(state, `${pid}: ${card.name} at ${lname(/** @type {string} */ (t.location))}.`);
      break;
    }
    case 'draw-adjacent': {
      const to = /** @type {string} */ (t.location);
      const led = placed.led;
      // The led faction comes first, then the largest of the rest (D15 reading).
      const groups = MAP[to].adjacent.flatMap((from) => movable(state, card, t).map((f) => ({ from, f, n: tokensOf(state, from, f) }))).filter((g) => g.n > 0)
        .sort((a, b) => Number(b.f === led) - Number(a.f === led) || b.n - a.n);
      let n = 0;
      for (const g of groups) n += move(state, pid, g.f, g.from, to, g.n, placed);
      logLine(state, `${pid}: ${card.name} draws ${n} tokens into ${lname(to)}.`);
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
        if (to) moved += move(state, pid, g.f, g.loc, to, tokensOf(state, g.loc, g.f), placed) ? 1 : 0;
      }
      logLine(state, `${pid}: ${card.name} shifts ${moved} group${moved === 1 ? '' : 's'} ${t.direction}.`);
      break;
    }
    case 'drive-out': case 'drive-out-either': {
      const f = /** @type {string} */ (t.faction), from = /** @type {string} */ (t.location);
      const n = move(state, pid, f, from, /** @type {string} */ (t.to), tokensOf(state, from, f), placed);
      logLine(state, `${pid}: ${card.name} drives ${n} ${names(f)} out of ${lname(from)}.`);
      break;
    }
    case 'reinforce': {
      const f = /** @type {string} */ (t.faction), loc = /** @type {string} */ (t.location);
      const n = Math.min(3, state.supply[f]);
      state.supply[f] -= n;
      state.board[loc].tokens[f] = tokensOf(state, loc, f) + n;
      logLine(state, `${pid}: ${card.name} adds ${n} ${names(f)} at ${lname(loc)} from the supply.`);
      break;
    }
    case 'carry-fight': {
      const from = /** @type {string} */ (t.location), to = /** @type {string} */ (t.to);
      for (const f of factionsAt(state, from)) move(state, pid, f, from, to, tokensOf(state, from, f), placed);
      logLine(state, `${pid}: ${card.name} carries the fight at ${lname(from)} to ${lname(to)}.`);
      break;
    }
    case 'defect': {
      const f = /** @type {string} */ (t.faction), loc = /** @type {string} */ (t.location);
      const other = /** @type {string} */ (factionsAt(state, loc).find((x) => x !== f));
      const n = Math.min(3, tokensOf(state, loc, f), state.supply[other]);
      state.board[loc].tokens[f] -= n;
      if (state.board[loc].tokens[f] <= 0) delete state.board[loc].tokens[f];
      state.supply[f] += n;
      state.supply[other] -= n;
      state.board[loc].tokens[other] += n;
      logLine(state, `${pid}: ${card.name} turns ${n} ${names(f)} to the ${names(other)} at ${lname(loc)}.`);
      break;
    }
    case 'pit': {
      const f = /** @type {string} */ (t.faction), loc = /** @type {string} */ (t.location);
      const n = tokensOf(state, loc, f);
      delete state.board[loc].tokens[f];
      state.supply[f] += n;
      logLine(state, `${pid}: ${card.name} swallows ${n} ${names(f)} at ${lname(loc)}.`);
      break;
    }
    case 'slide': {
      const f = /** @type {string} */ (t.faction), from = /** @type {string} */ (t.location);
      const to = slideEnd(state, from, f, /** @type {string} */ (t.direction));
      const n = move(state, pid, f, from, to, tokensOf(state, from, f), placed);
      logLine(state, `${pid}: ${card.name} sends ${n} ${names(f)} sliding from ${lname(from)} to ${lname(to)}.`);
      break;
    }
    case 'chain': {
      // The group moves one hex; each group of another faction in its way is knocked one hex on, the same way, and so on down the line.
      const dir = /** @type {string} */ (t.direction);
      const knock = (/** @type {string} */ loc, /** @type {string} */ incoming, /** @type {number} */ depth) => {
        const next = step(state, loc, dir);
        if (!next || depth > 12) return;
        for (const g of factionsAt(state, loc).filter((x) => x !== incoming)) {
          knock(next, g, depth + 1);
          move(state, pid, g, loc, next, tokensOf(state, loc, g), placed);
        }
      };
      const f = /** @type {string} */ (t.faction), from = /** @type {string} */ (t.location);
      const to = step(state, from, dir);
      if (to) {
        knock(to, f, 0);
        move(state, pid, f, from, to, tokensOf(state, from, f), placed);
      }
      logLine(state, `${pid}: ${card.name} crashes ${names(f)} ${dir} from ${lname(from)}.`);
      break;
    }
    case 'swap-far': {
      const a = { location: /** @type {string} */ (t.location), faction: /** @type {string} */ (t.faction) }, b = /** @type {{ location: string, faction: string }} */ (t.moves?.[0]);
      const nb = tokensOf(state, b.location, b.faction);
      delete state.board[b.location].tokens[b.faction];
      move(state, pid, a.faction, a.location, b.location, tokensOf(state, a.location, a.faction), placed);
      state.board[b.location].tokens[b.faction] = nb;
      move(state, pid, b.faction, b.location, a.location, nb, placed);
      logLine(state, `${pid}: ${card.name}: ${names(a.faction)} at ${lname(a.location)} and ${names(b.faction)} at ${lname(b.location)} trade places.`);
      break;
    }
    case 'circle': {
      const moves = circlers(state, /** @type {string} */ (t.location), movable(state, card, t)).map((g) => ({ ...g, n: tokensOf(state, g.from, g.f) }));
      for (const g of moves) { delete state.board[g.from].tokens[g.f]; } // all lift at once
      let n = 0;
      for (const g of moves) {
        state.board[g.from].tokens[g.f] = tokensOf(state, g.from, g.f) + g.n;
        n += move(state, pid, g.f, g.from, g.to, g.n, placed) ? 1 : 0; // a group that can't enter stays
      }
      logLine(state, `${pid}: ${card.name}: ${n} group${n === 1 ? '' : 's'} circle ${lname(/** @type {string} */ (t.location))}.`);
      break;
    }
    case 'surveil': {
      const spots = cameraSpots(state, pid, /** @type {string} */ (t.location));
      for (const { loc, f } of spots) {
        state.players[pid].standing[f] -= 1;
        state.board[loc].influence[pid] = (state.board[loc].influence[pid] ?? 0) + 1;
        state.events.push({ type: 'influence-placed', player: pid, faction: f, location: loc });
      }
      logLine(state, `${pid}: ${card.name} places influence at ${spots.map((x) => lname(x.loc)).join(', ')}.`);
      break;
    }
    case 'follow': {
      const f = /** @type {string} */ (t.faction), from = /** @type {string} */ (t.location), to = /** @type {string} */ (t.to);
      move(state, pid, f, from, to, tokensOf(state, from, f), placed);
      const g = t.moves?.[0];
      if (g) move(state, pid, g.faction, g.location, to, tokensOf(state, g.location, g.faction), placed);
      logLine(state, `${pid}: ${card.name} leads ${names(f)} into ${lname(to)}${g ? `; ${names(g.faction)} follow` : ''}.`);
      break;
    }
    case 'leap': {
      const f = /** @type {string} */ (t.faction), from = /** @type {string} */ (t.location);
      const land = /** @type {string} */ (step(state, /** @type {string} */ (step(state, from, /** @type {string} */ (t.direction))), /** @type {string} */ (t.direction)));
      const n = move(state, pid, f, from, land, tokensOf(state, from, f), placed);
      logLine(state, `${pid}: ${card.name}: ${n} ${names(f)} leap from ${lname(from)} to ${lname(land)}.`);
      break;
    }
    case 'network': {
      const f = /** @type {string} */ (t.faction), from = /** @type {string} */ (t.location);
      const to = /** @type {string} */ (t.to);
      const n = move(state, pid, f, from, to, tokensOf(state, from, f), placed);
      logLine(state, `${pid}: ${card.name} sends ${n} ${names(f)} from ${lname(from)} to ${lname(to)}.`);
      break;
    }
    case 'shove': {
      const f = /** @type {string} */ (t.faction), from = /** @type {string} */ (t.location), to = /** @type {string} */ (t.to);
      const g = t.moves?.[0];
      if (g && shoveable(state, to, f)) move(state, pid, g.faction, to, g.to, tokensOf(state, to, g.faction), placed);
      const n = move(state, pid, f, from, to, tokensOf(state, from, f), placed);
      logLine(state, `${pid}: ${card.name} leads ${n} ${names(f)} into ${lname(to)}${g ? `, shoving ${names(g.faction)} on to ${lname(g.to)}` : ''}.`);
      break;
    }
    case 'howl': {
      const f = /** @type {string} */ (t.faction), target = /** @type {string} */ (t.location);
      let n = 0;
      for (const { from } of howlers(state, target, f)) {
        const to = howlStep(state, target, from, f); // re-checked: an earlier group may have changed what can enter
        if (to) n += move(state, pid, f, from, to, tokensOf(state, from, f), placed) ? 1 : 0;
      }
      logLine(state, `${pid}: ${card.name} draws ${n} ${names(f)} group${n === 1 ? '' : 's'} closer to ${lname(target)}.`);
      break;
    }
    case 'repel': {
      let n = 0;
      for (const g of pushes(state, /** @type {string} */ (t.location), movable(state, card, t))) n += move(state, pid, g.f, g.from, /** @type {string} */ (g.to), tokensOf(state, g.from, g.f), placed) ? 1 : 0;
      logLine(state, `${pid}: ${card.name} drives ${n} group${n === 1 ? '' : 's'} away from ${lname(/** @type {string} */ (t.location))}.`);
      break;
    }
    case 'move-influence': {
      const to = /** @type {string} */ (t.location);
      for (const from of t.from ?? []) {
        if ((state.board[from].influence[pid] ?? 0) <= 0) continue;
        state.board[from].influence[pid] -= 1;
        if (state.board[from].influence[pid] === 0) delete state.board[from].influence[pid];
        state.board[to].influence[pid] = (state.board[to].influence[pid] ?? 0) + 1;
      }
      logLine(state, `${pid}: ${card.name} moves ${(t.from ?? []).length} influence to ${lname(to)}.`);
      break;
    }
    case 'cash-in': {
      const to = /** @type {string} */ (t.location), f = /** @type {string} */ (t.faction);
      const n = Math.min(3, state.players[pid].standing[f] ?? 0);
      state.players[pid].standing[f] -= n;
      state.board[to].influence[pid] = (state.board[to].influence[pid] ?? 0) + n;
      for (let i = 0; i < n; i++) state.events.push({ type: 'influence-placed', player: pid, faction: f, location: to });
      logLine(state, `${pid}: ${card.name} places ${n} influence at ${lname(to)}.`);
      break;
    }
    case 'bail-out': {
      const from = /** @type {string} */ (t.location), to = /** @type {string} */ (t.to);
      const n = state.board[from].influence[pid] ?? 0;
      delete state.board[from].influence[pid];
      state.board[to].influence[pid] = (state.board[to].influence[pid] ?? 0) + n;
      logLine(state, `${pid}: ${card.name} moves all ${n} of their influence from ${lname(from)} to ${lname(to)}.`);
      break;
    }
    case 'backup': {
      const to = /** @type {string} */ (t.location);
      const n = Math.min(state.board[to].influence[pid] ?? 0, state.players[pid].supply);
      state.players[pid].supply -= n;
      state.board[to].influence[pid] += n;
      logLine(state, `${pid}: ${card.name} doubles their influence at ${lname(to)} (+${n} from their supply).`);
      break;
    }
    case 'fall-back': {
      const to = /** @type {string} */ (t.location);
      let n = 0;
      for (const from of fallBackFrom(state, pid, to)) { n += state.board[from].influence[pid]; delete state.board[from].influence[pid]; }
      state.board[to].influence[pid] = (state.board[to].influence[pid] ?? 0) + n;
      logLine(state, `${pid}: ${card.name} gathers ${n} of their influence into ${lname(to)}.`);
      break;
    }
    case 'stake': {
      const to = /** @type {string} */ (t.location);
      const n = Math.min(/** @type {number} */ ((/** @type {any} */ (card)).amount ?? 4), state.players[pid].supply);
      state.players[pid].supply -= n;
      state.board[to].influence[pid] = (state.board[to].influence[pid] ?? 0) + n;
      logLine(state, `${pid}: ${card.name} places ${n} influence at ${lname(to)}.`);
      break;
    }
    case 'canvass': {
      const at = (t.from ?? []).slice(0, state.players[pid].supply);
      for (const l of at) state.board[l].influence[pid] = (state.board[l].influence[pid] ?? 0) + 1;
      state.players[pid].supply -= at.length;
      logLine(state, `${pid}: ${card.name} places 1 influence at each of ${at.map(lname).join(', ')}.`);
      break;
    }
    case 'bait': {
      const to = /** @type {string} */ (t.location), from = /** @type {string} */ (t.from?.[0]), f = /** @type {string} */ (t.faction);
      const n = Math.min(2, state.players[pid].supply);
      state.players[pid].supply -= n;
      state.board[to].influence[pid] = (state.board[to].influence[pid] ?? 0) + n;
      logLine(state, `${pid}: ${card.name} at ${lname(to)} (${n} influence) and draws ${move(state, pid, f, from, to, tokensOf(state, from, f), placed)} ${names(f)} in.`);
      break;
    }
    case 'allegiance': {
      const f = /** @type {string} */ (t.faction), to = /** @type {string} */ (t.to);
      const n = Math.min(4, state.players[pid].standing[f] ?? 0);
      state.players[pid].standing[f] -= n;
      state.players[pid].standing[to] = (state.players[pid].standing[to] ?? 0) + n;
      logLine(state, `${pid}: ${card.name} moves ${n} standing from ${names(f)} to ${names(to)}.`);
      break;
    }
    case 'split-up': {
      const at = (t.from ?? []).slice(0, state.players[pid].supply);
      for (const l of at) {
        state.board[l].influence[pid] = (state.board[l].influence[pid] ?? 0) + 1;
        state.board[l].double = [...(state.board[l].double ?? []), pid];
      }
      state.players[pid].supply -= at.length;
      logLine(state, `${pid}: ${card.name}: 1 influence each at ${at.map(lname).join(', ')}, counting double there this round.`);
      break;
    }
    case 'tipoff': {
      state.tips = [...(state.tips ?? []), { pid, faction: /** @type {string} */ (t.faction) }];
      logLine(state, `${pid}: ${card.name}: whoever moves ${names(/** @type {string} */ (t.faction))} this round, ${pid} gets a share.`);
      break;
    }
    case 'bounty': {
      state.bounties = [...(state.bounties ?? []), /** @type {string} */ (t.faction)];
      logLine(state, `${pid}: ${card.name}: a bounty on ${names(/** @type {string} */ (t.faction))} this round.`);
      break;
    }
    case 'lockdown': {
      const region = regionOf(/** @type {string} */ (t.location));
      for (const l of LOCATION_IDS) if (regionOf(l) === region) state.board[l].lock = true;
      logLine(state, `${pid}: ${card.name}: ${region} is locked down this round.`);
      break;
    }
    case 'wake-dead': {
      state.board[/** @type {string} */ (t.location)].wake = true;
      logLine(state, `${pid}: ${card.name} at ${lname(/** @type {string} */ (t.location))}.`);
      break;
    }
    case 'swarm': {
      state.board[/** @type {string} */ (t.location)].swarm = true;
      logLine(state, `${pid}: ${card.name} at ${lname(/** @type {string} */ (t.location))}.`);
      break;
    }
    case 'hack': {
      const f = /** @type {string} */ (t.faction), from = /** @type {string} */ (t.location);
      const n = move(state, pid, f, from, /** @type {string} */ (t.to), tokensOf(state, from, f), placed);
      logLine(state, `${pid}: ${card.name} sends ${n} ${names(f)} from ${lname(from)} to ${lname(/** @type {string} */ (t.to))}.`);
      break;
    }
    case 'truce': {
      state.board[/** @type {string} */ (t.location)].truce = true;
      logLine(state, `${pid}: ${card.name} at ${lname(/** @type {string} */ (t.location))}: no fight there this round.`);
      break;
    }
    case 'trail': {
      const to = /** @type {string} */ (t.location), from = /** @type {string} */ (t.from?.[0]), f = /** @type {string} */ (t.faction);
      logLine(state, `${pid}: ${card.name} draws ${move(state, pid, f, from, to, tokensOf(state, from, f), placed)} ${names(f)} into ${lname(to)}.`);
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

/** Where a pending action would move tokens into (for blocks). @param {GameState | PlayerView} state @param {{ card: string, target: Target | null }} pend */
export function pendingDestinations(state, pend) {
  const t = pend.target;
  if (!t) return [];
  const card = copied(state, cardById(pend.card));
  switch (card.action) {
    case 'lure': case 'broadcast': case 'gather-region': case 'gather-neighbours': case 'call-home': case 'draw-adjacent': return t.location ? [t.location] : [];
    case 'halve': case 'halve-far': case 'teleport': case 'drive-out': case 'drive-out-either': case 'hack': return t.to ? [t.to] : [];
    case 'sow': return t.path ?? [];
    case 'split': return Object.keys(t.split ?? {});
    case 'pit-fall': return t.to ? [t.to] : [];
    case 'carry-fight': return t.to ? [t.to] : [];
    case 'slide': case 'chain': return LOCATION_IDS;
    case 'circle': return t.location ? MAP[t.location].adjacent : [];
    case 'leap': case 'howl': return LOCATION_IDS;
    case 'network': case 'shove': return [t.to ?? '', t.moves?.[0]?.to ?? ''].filter(Boolean);
    case 'follow': return t.to ? [t.to] : [];
    case 'swap-far': return [t.location ?? '', t.moves?.[0]?.location ?? ''].filter(Boolean);
    case 'repel': return t.location ? MAP[t.location].adjacent.flatMap((a) => MAP[a].adjacent) : [];
    case 'conveyor': return LOCATION_IDS;
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
    if (!responsesOn(state)) return no('Responses are out of the first draft.');
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
    if (state.growing.leaders[state.growing.next % state.growing.leaders.length] !== pid) return no('Another influence leader places this token.');
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
    if (p.supply <= 0) return no('Your supply is empty.');
    const spots = influenceSpots(state, m.card);
    if (spots.length ? !spots.includes(m.location ?? '') : m.location) return no('Choose a location its faction controls for 1 of the influence.');
    return OK;
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
  const next = clone({ ...state, log: [] });
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
        const gain = Math.min(printedOf(state, card.id), p.supply);
        p.supply -= gain;
        p.standing[faction] += gain;
        next.events.push({ type: 'influence-spent', player: pid, faction, amount: gain });
        if (m.location && gain > 0) {
          // Test lever influenceToBoard: 1 of it goes onto the chosen location.
          p.standing[faction] -= 1;
          next.board[m.location].influence[pid] = (next.board[m.location].influence[pid] ?? 0) + 1;
          next.events.push({ type: 'influence-placed', player: pid, faction, location: m.location });
        }
        logLine(next, `${pid} plays ${card.name} for ${gain} influence with ${factionById(faction).name}.`);
        next.turn = (next.turn + 1) % next.seating.length;
        return next;
      }
      logLine(next, `${pid} plays ${card.name}${card.action === 'copy' && next.lastPlayed ? `, copying ${cardById(next.lastPlayed).name}` : ''}.`);
      if (card.action !== 'copy') next.lastPlayed = card.id;
      if (!responsesOn(next)) {
        // No responses (the first draft): the action resolves at once.
        if (m.target) act(next, pid, card, m.target);
        else logLine(next, `${card.name} has nothing to act on.`);
        next.turn = (next.turn + 1) % next.seating.length;
        return next;
      }
      next.pending = { player: pid, card: m.card, target: m.target ?? null, cancelled: false, blocked: [], responded: [], before: { opened: state.opened, passesInRow: state.passesInRow } };
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
  for (const loc of LOCATION_IDS) { const p = state.board[loc]; delete p.truce; delete p.double; delete p.wake; delete p.swarm; delete p.backdoor; delete p.lock; } // round 15, 18 and 19 test cards last the round
  state.tips = [];
  state.bounties = [];
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

/** Several locations' fights in turn, on one copy (as resolveFight one after another); `copy` false: on `state` itself, already a copy. @param {GameState} state @param {string[]} locs @returns {GameState} */
export function resolveFights(state, locs, copy = true) {
  const next = copy ? clone(state) : state;
  for (const loc of locs) fight(next, loc);
  return next;
}

/** One location's fight on a copy of the state, for tests and previews. @param {GameState} state @param {string} loc @returns {GameState} */
export function resolveFight(state, loc) {
  const next = clone(state);
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
  if (place.truce) { logLine(state, `  ${name}: a truce; no fight this round.`); return; } // test card (round 15)
  // A hidden token flips and takes part (IN1); its marker cube returns to its owner (MC3) after the fight.
  const token = place.token;
  place.token = null;
  const effect = token?.card ?? null;
  if (token) logLine(state, `  ${name}: ${token.owner}'s token flips: ${effect ? cardById(effect).name : 'a bluff'}.`);
  const na = place.tokens[a], nb = place.tokens[b];
  // Link the Swarm (test card, round 20): the Sentients count their tokens next door too, for who wins.
  const swarm = place.swarm ? factionOfArchetype(state, 'sentients') : null;
  const next = (/** @type {string} */ f) => (f === swarm ? MAP[loc].adjacent.reduce((n, l) => n + tokensOf(state, l, f), 0) : 0);
  const sa = na + next(a), sb = nb + next(b);
  // Install a Backdoor (test card, round 20): counted on the Sentients here as the fight starts.
  const hacked = place.backdoor?.length ? tokensOf(state, loc, /** @type {string} */ (factionOfArchetype(state, 'sentients'))) : 0;
  const aligned = [a, b].find((f) => archetypeOf(f) === alignmentOf(loc));
  const trueTie = effect === 'house-fire' || (sa === sb && !aligned);
  if (trueTie && place.wake) {
    // Wake the Dead (test card, round 18): no scorching; both sides go back to their supplies.
    state.supply[a] += na;
    state.supply[b] += nb;
    for (const [pid, n] of Object.entries(place.influence)) state.players[pid].supply += n;
    place.tokens = {};
    place.influence = {};
    logLine(state, `  ${name}: a true tie, but the dead won't rest: ${name} is not scorched.`);
    return;
  }
  if (trueTie) {
    // TF1 + TM1: both wiped, the location scorched, nothing rewarded; everything back to its supply.
    state.supply[a] += na;
    state.supply[b] += nb;
    for (const [pid, n] of Object.entries(place.influence)) state.players[pid].supply += n;
    place.tokens = {};
    place.influence = {};
    place.scorched = true;
    logLine(state, `  ${name}: a true tie. Both sides are wiped out and ${name} is scorched.`);
    return;
  }
  let winner, loser;
  if (sa === sb) {
    winner = /** @type {string} */ (aligned);
    loser = winner === a ? b : a;
  } else [winner, loser] = sa > sb ? [a, b] : [b, a];
  if (effect === 'invert' && sa !== sb) [winner, loser] = [loser, winner]; // test card (round 12): the smaller group wins
  const nl = place.tokens[loser];
  const loserLoss = nl; // the loser always loses everything (FR5)
  let winnerLoss = Math.max(1, Math.floor(nl / 2));
  if (effect === 'silver-bullets') winnerLoss += 2; // each group loses 2 more; the loser has none left to lose
  if (effect === 'salt-burn') winnerLoss = place.tokens[winner];
  if (effect === 'force-field') winnerLoss = 0; // test card (round 8)
  winnerLoss += (('bounties' in state && state.bounties) || []).filter((f) => f === winner).length; // Put a Bounty On It (test card, round 19): 1 more for each bounty
  winnerLoss = Math.min(winnerLoss, place.tokens[winner]);
  place.tokens[loser] -= loserLoss;
  place.tokens[winner] -= winnerLoss;
  for (const f of [winner, loser]) if (place.tokens[f] <= 0) delete place.tokens[f];
  logLine(state, `  ${name}: ${factionById(winner).name} beat ${factionById(loser).name}; casualties ${loserLoss} and ${winnerLoss}.`);
  // Trophies (TD1): bigger pile to the leader, smaller to the runner-up.
  const piles = [{ faction: loser, n: loserLoss }, { faction: winner, n: winnerLoss }].filter((x) => x.n > 0).sort((x, y) => y.n - x.n);
  if (effect === 'livestream') for (const pile of piles) { // test card (round 11): each pile doubled from its faction's supply
    const extra = Math.min(pile.n, state.supply[pile.faction]);
    state.supply[pile.faction] -= extra;
    pile.n += extra;
  }
  if (place.wake) {
    // Wake the Dead (test card, round 18): the loser's casualties rise as Undead here instead of becoming trophies.
    const undead = state.factions.find((f) => archetypeOf(f) === 'undead');
    const lp = piles.find((p) => p.faction === loser);
    if (undead && lp) {
      const rise = Math.min(lp.n, state.supply[undead]);
      state.supply[undead] -= rise;
      state.supply[loser] += lp.n;
      place.tokens[undead] = (place.tokens[undead] ?? 0) + rise;
      piles.splice(piles.indexOf(lp), 1);
      logLine(state, `  ${name}: ${rise} of the fallen rise as ${factionById(undead).name}.`);
    }
  }
  const ranking = rankAt(state, loc, hacked);
  const collectors = ranking.places;
  /** @param {{ faction: string, n: number }} pile @param {string | null} pid */
  const give = (pile, pid) => {
    if (pid) {
      state.players[pid].trophies[pile.faction] += pile.n;
      logLine(state, `  ${pid} takes a pile of ${pile.n} ${factionById(pile.faction).name}.`);
    } else state.supply[pile.faction] += pile.n;
  };
  if (effect === 'lay-to-rest' && token) { // test card (round 17 revision): the token's owner takes the smaller pile; the rest go back to their supplies
    piles.forEach((pile, i) => give(pile, i === piles.length - 1 ? token.owner : null));
  } else if (effect === 'sign-contract' && token) { // test card (round 17 revision): the owner takes the bigger pile, the leader only the smaller; the owner pays 2 standing with the Demons
    piles.forEach((pile, i) => give(pile, i === 0 ? token.owner : collectors[0] ?? null));
    const demons = state.factions.find((f) => archetypeOf(f) === 'demonic');
    if (demons) state.players[token.owner].standing[demons] = Math.max(0, (state.players[token.owner].standing[demons] ?? 0) - 2);
  } else if (effect === 'silver-bullets' && token) { // round 17 revision (designer): the extra casualties go to the token's owner as their own pile
    const extra = piles.find((p) => p.faction === winner);
    const owed = Math.min(2, extra?.n ?? 0);
    if (extra && owed) { extra.n -= owed; give({ faction: winner, n: owed }, token.owner); }
    const order = piles.filter((p) => p.n > 0).sort((x, y) => y.n - x.n);
    if (ranking.involved === 1 && collectors[0]) for (const pile of order) give(pile, collectors[0]);
    else order.forEach((pile, i) => give(pile, collectors[i] ?? null));
  } else if (effect === 'set-trap' && token) for (const pile of piles) give(pile, token.owner); // Set a Trap (A, designer): the trap's owner takes every pile
  else if (ranking.involved === 1 && collectors[0]) {
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
 * @param {GameState} state @param {string} loc @param {number} [hacked]  Sentient tokens at the fight's start, for Install a Backdoor
 */
function rankAt(state, loc, hacked = 0) {
  const place = state.board[loc];
  // Install a Backdoor (test card, round 20): 1 more per Sentient token here as the fight started, even with no influence placed.
  const influence = { ...place.influence };
  for (const pid of place.backdoor ?? []) influence[pid] = (influence[pid] ?? 0) + hacked;
  const entries = Object.entries(influence).filter(([, n]) => n > 0).map(([pid, n]) => /** @type {[string, number]} */ ([pid, place.double?.includes(pid) ? 2 * n : n]));
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

/** What each growth location is due: 1, plus 1 if the faction is aligned with it (AL3). @param {GameState} state @param {string} faction */
export function growthDue(state, faction) {
  return Object.fromEntries(growthSpots(state, faction).map((loc) => [loc, 1 + (archetypeOf(faction) === alignmentOf(loc) ? 1 : 0)]));
}

/**
 * Growth for each faction in turn, from `from`. A faction with enough supply
 * grows everywhere it is due; one short of tokens grows as far as its supply
 * allows, its influence leaders taking turns to choose (3.5).
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
      state.growing = { faction, left: state.supply[faction], leaders: influenceLeaders(state, faction), next: 0, due };
      state.phase = 'growth';
      return state;
    }
  }
  return endRound(state);
}

/** One token placed by an influence leader during a short-supply growth. @param {GameState} state @param {string} loc */
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
  if (state.phase !== 'play' || !responsesOn(state)) return [];
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
        const holds = LOCATION_IDS.filter((l) => tokensOf(state, l, f) > 0);
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
      case 'halve': case 'drive-out': case 'drive-out-either': if (g) t = { mode, location: g.loc, faction: g.f, to: pick(MAP[g.loc].adjacent) }; break;
      case 'teleport': case 'halve-far': if (g) t = { mode, location: g.loc, faction: g.f, to: pick(LOCATION_IDS) }; break;
      case 'move-influence': {
        const mine = LOCATION_IDS.filter((l) => (state.board[l].influence[pid] ?? 0) > 0);
        const to = pick(holdingSpots(state, card, mode));
        const from = mine.filter((l) => l !== to);
        if (to && from.length) t = { mode, location: to, from: Array.from({ length: 1 + Math.floor(rng() * 3) }, () => pick(from)) };
        break;
      }
      case 'split': {
        if (!g) break;
        const n = tokensOf(state, g.loc, g.f);
        const dests = MAP[g.loc].adjacent.slice();
        if (n < 2 || dests.length < 2) break;
        const a = pick(dests), b = pick(dests.filter((d) => d !== a));
        const na = 1 + Math.floor(rng() * (n - 1));
        t = { mode, location: g.loc, faction: g.f, split: { [a]: na, [b]: n - na } };
        break;
      }
      case 'conveyor': t = { mode, location: pick(LOCATION_IDS), direction: pick(spec.map.directions).id }; break;
    }
    if (!t && !SAMPLED.has(/** @type {string} */ (card.action))) t = walkTarget(state, pid, cardId, mode, rng);
    if (t && !checkTarget(state, pid, card, t)) return t;
  }
  return null;
}
/** Actions sampleTarget guesses directly; any other walks the table's choices. */
const SAMPLED = new Set(['lure', 'draw-adjacent', 'gather-region', 'gather-neighbours', 'broadcast', 'sow', 'token', 'halve', 'drive-out', 'drive-out-either', 'teleport', 'halve-far', 'move-influence', 'split', 'conveyor']);

/**
 * A random target built one choice at a time, as the table offers them (for bots).
 * @param {GameState} state @param {string} pid @param {string} cardId @param {'location' | 'faction'} mode @param {() => number} rng @returns {Target | null}
 */
function walkTarget(state, pid, cardId, mode, rng) {
  const pick = (/** @type {any[]} */ xs) => xs[Math.floor(rng() * xs.length)];
  /** @type {Target} */
  let t = copied(state, cardById(cardId)).suit ? { mode } : {};
  for (let steps = 0; steps < 30; steps++) {
    const c = nextChoice(state, pid, cardId, t);
    if (c.kind === 'done') return finishWalk(t);
    if (c.kind === 'mode') { t = { mode }; continue; }
    if ('optional' in c && c.optional && rng() < 0.3) return finishWalk(t);
    if (!('options' in c) || !c.options.length) return null;
    t = chooseStep(t, c, pick(/** @type {any[]} */ (c.options)));
  }
  return null;
}

/** A target with one more choice made. @param {Target} t @param {Choice} c @param {any} o @returns {Target} */
function chooseStep(t, c, o) {
  if (c.kind === 'faction') return { ...t, [c.key ?? 'faction']: o };
  if (c.kind === 'direction') return { ...t, direction: o };
  if (c.kind === 'split') return { ...t, split: { ...(t.split ?? {}), [o]: (t.split?.[o] ?? 0) + 1 } };
  if (c.kind === 'group') {
    if (c.key === 'lure') return { ...t, faction: o.faction, from: [o.location] };
    if (c.key === 'move') return { ...t, moves: [...(t.moves ?? []), { location: o.location, faction: o.faction, to: '' }] };
    return { ...t, location: o.location, faction: o.faction };
  }
  if (!('key' in c)) return t;
  if (c.key === 'path') return { ...t, path: [...(t.path ?? []), o] };
  if (c.key === 'from') return { ...t, from: [...(t.from ?? []), o] };
  if (c.key === 'to' && t.moves?.length && !t.moves[t.moves.length - 1].to) return { ...t, moves: t.moves.map((m, i, a) => (i === a.length - 1 ? { ...m, to: o } : m)) };
  return { ...t, [c.key]: o };
}

/**
 * For bots: the legal targets of a card, listed by walking every choice the
 * table offers, up to `cap`. `complete` is false when the list was cut short
 * (then a bot should sample more besides). Not a rule.
 * @param {GameState} state @param {string} pid @param {string} cardId @param {number} cap
 * @returns {{ targets: Target[], complete: boolean }}
 */
export function listTargets(state, pid, cardId, cap) {
  const card = cardById(cardId);
  /** @type {Target[]} */
  const stack = copied(state, card).suit ? [{ mode: 'faction' }, { mode: 'location' }] : [{}];
  /** @type {Map<string, Target>} */
  const found = new Map();
  let visits = 0;
  const keep = (/** @type {Target} */ t) => { const k = JSON.stringify(t); if (!found.has(k) && !checkTarget(state, pid, card, t)) found.set(k, t); };
  while (stack.length && found.size < cap) {
    if (++visits > cap * 40) return { targets: [...found.values()], complete: false };
    const t = /** @type {Target} */ (stack.pop());
    const c = nextChoice(state, pid, cardId, t);
    if (c.kind === 'done') { keep(t); continue; }
    if (c.kind === 'mode') continue;
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
 * @typedef {{ kind: 'mode' } | { kind: 'location', key: 'location' | 'to' | 'bluff' | 'path' | 'from', options: string[], optional?: boolean, left?: number }
 *   | { kind: 'group', key: 'group' | 'move' | 'lure', options: { location: string, faction: string }[], optional?: boolean }
 *   | { kind: 'faction', key?: 'faction' | 'to' | 'lead', options: string[] } | { kind: 'direction', options: string[] }
 *   | { kind: 'split', options: string[], left: number } | { kind: 'done' }} Choice
 * @param {GameState} state @param {string} pid @param {string} cardId @param {Target} t
 * @returns {Choice}
 */
export function nextChoice(state, pid, cardId, t) {
  const c = nextShape(state, pid, cardId, t);
  const card = copied(state, cardById(cardId));
  if (c.kind !== 'done' || !selectedPays(state) || !LEADS.has(/** @type {string} */ (card.action)) || ledFaction(state, card, t) !== null) return c;
  // D15: name the faction you lead, among those that would move (and, under IC1, that you can pay for).
  const cost = num(state, 'influencePerMove');
  const options = movingFactions(state, pid, card, t).filter((f) => !influenceRequired(state) || cost <= 0 || (state.players[pid].standing[f] ?? 0) >= cost);
  return { kind: 'faction', key: 'lead', options };
}

/** nextChoice before the led faction (D15). @param {GameState} state @param {string} pid @param {string} cardId @param {Target} t @returns {Choice} */
function nextShape(state, pid, cardId, t) {
  const card = copied(state, cardById(cardId));
  const mode = /** @type {'location' | 'faction'} */ (t.mode ?? 'location');
  if (card.suit && !t.mode) return { kind: 'mode' };
  const sf = suitFaction(state, card);
  const groups = () => groupsOf(state);
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
      const comes = (/** @type {string} */ loc) => MAP[loc].adjacent.some((from) => movers.some((f) => tokensOf(state, from, f) > 0 && canEnter(state, loc, f)));
      if (!t.location) return { kind: 'location', key: 'location', options: LOCATION_IDS.filter(placeOk).filter(comes) };
      if (card.action === 'lure' && !t.faction) {
        // Fresh Meat: a tie for the largest group goes to the player's choice (G.8).
        const to = t.location;
        const near = MAP[to].adjacent.flatMap((from) => movers.map((f) => ({ location: from, faction: f, n: tokensOf(state, from, f) }))).filter((g) => g.n > 0 && canEnter(state, to, g.faction));
        const most = Math.max(0, ...near.map((g) => g.n));
        const tied = near.filter((g) => g.n === most).map(({ location, faction }) => ({ location, faction }));
        if (tied.length > 1) return { kind: 'group', key: 'lure', options: tied };
      }
      return { kind: 'done' };
    }
    case 'gather-region': case 'gather-neighbours': case 'call-home': {
      const sources = (/** @type {string} */ loc) => LOCATION_IDS.filter((l) => l !== loc && (card.action === 'call-home' || card.action === 'gather-region' ? regionOf(l) === regionOf(loc) : REGIONS[regionOf(loc)].neighbours.includes(regionOf(l))));
      const gathers = (/** @type {string} */ loc, /** @type {string} */ f) => canEnter(state, loc, f) && sources(loc).some((l) => tokensOf(state, l, f) > 0);
      if (!t.location) return { kind: 'location', key: 'location', options: LOCATION_IDS.filter(placeOk).filter((loc) => movers.some((f) => gathers(loc, f))) };
      if (!t.faction) return { kind: 'faction', options: movers.filter((f) => gathers(/** @type {string} */ (t.location), f)) };
      return { kind: 'done' };
    }
    case 'broadcast':
      if (!t.location) return { kind: 'location', key: 'location', options: LOCATION_IDS.filter(placeOk).filter((loc) => movers.some((f) => canEnter(state, loc, f) && LOCATION_IDS.some((l) => l !== loc && tokensOf(state, l, f) > 0))) };
      if (!t.faction) return { kind: 'faction', options: movers.filter((f) => canEnter(state, /** @type {string} */ (t.location), f) && LOCATION_IDS.some((l) => l !== t.location && tokensOf(state, l, f) > 0)) };
      if ((t.from ?? []).includes('__stop')) return { kind: 'done' };
      if ((t.from ?? []).length < 2) {
        const opts = LOCATION_IDS.filter((l) => l !== t.location && !(t.from ?? []).includes(l) && tokensOf(state, l, /** @type {string} */ (t.faction)) > 0);
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
      if (!t.location) return { kind: 'group', key: 'group', options: groups().filter(groupOk).filter((g) => (state.players[pid].standing[g.faction] ?? 0) > 0 && exits(g, MAP[g.location].adjacent).length > 0) };
      const path = t.path ?? [];
      if (path.includes('__stop')) return { kind: 'done' };
      const at = path.length ? path[path.length - 1] : t.location;
      const f = /** @type {string} */ (t.faction);
      // Steps left: one token and one influence per location entered.
      const left = Math.min(tokensOf(state, t.location, f), state.players[pid].standing[f] ?? 0) - path.length;
      // The chase never enters a location twice, nor goes back to its start (G.8).
      const opts = left > 0 ? MAP[at].adjacent.filter((l) => canEnter(state, l, f) && l !== t.location && !path.includes(l)) : [];
      return opts.length ? { kind: 'location', key: 'path', options: opts, optional: path.length > 0, left } : { kind: 'done' };
    }
    case 'halve': case 'halve-far': case 'drive-out': case 'drive-out-either': case 'teleport': {
      const far = card.action === 'teleport' || card.action === 'halve-far';
      if (!t.location) {
        const gs = groups().filter(groupOk).filter((g) => (!card.action.startsWith('halve') || tokensOf(state, g.location, g.faction) >= 2)
          && exits(g, far ? LOCATION_IDS : MAP[g.location].adjacent).length > 0);
        return { kind: 'group', key: 'group', options: card.action.startsWith('drive-out') ? gs.filter((g) => MAP[g.location].adjacent.some((to) => ok({ ...t, location: g.location, faction: g.faction, to }))) : gs };
      }
      const reach = far ? LOCATION_IDS.filter((l) => l !== t.location) : MAP[t.location].adjacent;
      return t.to ? { kind: 'done' } : { kind: 'location', key: 'to', options: reach.filter((to) => canEnter(state, to, /** @type {string} */ (t.faction))) };
    }
    case 'reinforce':
      return t.location ? { kind: 'done' } : { kind: 'group', key: 'group', options: groups().filter(groupOk).filter((g) => state.supply[g.faction] > 0) };
    case 'defect': case 'pit':
      return t.location ? { kind: 'done' } : { kind: 'group', key: 'group', options: groups().filter((g) => ok({ mode, location: g.location, faction: g.faction })) };
    case 'carry-fight': {
      const dests = (/** @type {string} */ loc) => MAP[loc].adjacent.filter((to) => ok({ mode, location: loc, to }));
      if (!t.location) return { kind: 'location', key: 'location', options: LOCATION_IDS.filter((loc) => dests(loc).length > 0) };
      return t.to ? { kind: 'done' } : { kind: 'location', key: 'to', options: dests(t.location) };
    }
    case 'slide': case 'chain': {
      const dirs = (/** @type {string} */ loc, /** @type {string} */ f) => spec.map.directions.map((d) => d.id).filter((d) => ok({ mode, location: loc, faction: f, direction: d }));
      if (!t.location) return { kind: 'group', key: 'group', options: groups().filter(groupOk).filter((g) => dirs(g.location, g.faction).length > 0) };
      return t.direction ? { kind: 'done' } : { kind: 'direction', options: dirs(t.location, /** @type {string} */ (t.faction)) };
    }
    case 'swap-far': {
      const partners = (/** @type {{ location: string, faction: string }} */ a) => groups().filter((b) => canSwap(state, a, b));
      if (!t.location) return { kind: 'group', key: 'group', options: groups().filter(groupOk).filter((g) => partners(g).length > 0) };
      return t.moves?.length ? { kind: 'done' } : { kind: 'group', key: 'move', options: partners({ location: t.location, faction: /** @type {string} */ (t.faction) }) };
    }
    case 'leap': {
      const dirs = (/** @type {string} */ loc, /** @type {string} */ f) => spec.map.directions.map((d) => d.id).filter((d) => ok({ mode, location: loc, faction: f, direction: d }));
      if (!t.location) return { kind: 'group', key: 'group', options: groups().filter(groupOk).filter((g) => dirs(g.location, g.faction).length > 0) };
      return t.direction ? { kind: 'done' } : { kind: 'direction', options: dirs(t.location, /** @type {string} */ (t.faction)) };
    }
    case 'network': {
      if (!t.location) return { kind: 'group', key: 'group', options: groups().filter(groupOk).filter((g) => networkSpots(state, card, { mode, location: g.location, faction: g.faction }).length > 0) };
      return t.to ? { kind: 'done' } : { kind: 'location', key: 'to', options: networkSpots(state, card, t) };
    }
    case 'shove': {
      const f = /** @type {string} */ (t.faction);
      const tos = (/** @type {string} */ loc, /** @type {string} */ gf) => MAP[loc].adjacent.filter((to) => !state.board[to].scorched && (canEnter(state, to, gf) || (shoveable(state, to, gf) ?? []).some((x) => MAP[to].adjacent.some((d) => canEnter(state, d, x)))));
      if (!t.location) return { kind: 'group', key: 'group', options: groups().filter(groupOk).filter((g) => tos(g.location, g.faction).length > 0) };
      if (!t.to) return { kind: 'location', key: 'to', options: tos(t.location, f) };
      const can = shoveable(state, t.to, f);
      if (!can) return { kind: 'done' };
      const g = t.moves?.[0];
      if (!g) return { kind: 'group', key: 'move', options: can.filter((x) => MAP[/** @type {string} */ (t.to)].adjacent.some((d) => canEnter(state, d, x))).map((x) => ({ location: /** @type {string} */ (t.to), faction: x })) };
      return g.to ? { kind: 'done' } : { kind: 'location', key: 'to', options: MAP[t.to].adjacent.filter((d) => canEnter(state, d, g.faction)) };
    }
    case 'howl':
      if (!t.location) return { kind: 'location', key: 'location', options: LOCATION_IDS.filter(placeOk).filter((loc) => movers.some((f) => howlers(state, loc, f).length > 0)) };
      return t.faction ? { kind: 'done' } : { kind: 'faction', options: movers.filter((f) => howlers(state, /** @type {string} */ (t.location), f).length > 0) };
    case 'circle':
      return t.location ? { kind: 'done' } : { kind: 'location', key: 'location', options: LOCATION_IDS.filter(placeOk).filter((loc) => circlers(state, loc, movers).length > 0) };
    case 'surveil':
      return t.location ? { kind: 'done' } : { kind: 'location', key: 'location', options: holdingSpots(state, card, mode).filter((loc) => cameraSpots(state, pid, loc).length > 0) };
    case 'follow': {
      if (!t.location) return { kind: 'group', key: 'group', options: groups().filter(groupOk).filter((g) => exits(g, MAP[g.location].adjacent).length > 0) };
      const f = /** @type {string} */ (t.faction);
      if (!t.to) return { kind: 'location', key: 'to', options: MAP[t.location].adjacent.filter((l) => canEnter(state, l, f)) };
      if (t.moves?.length) return { kind: 'done' };
      const to = t.to;
      const followers = groups().filter((g) => g.faction !== f && g.location !== to && MAP[to].adjacent.includes(g.location) && canFollow(state, to, f, g.faction));
      return followers.length ? { kind: 'group', key: 'move', options: followers, optional: true } : { kind: 'done' };
    }
    case 'repel':
      return t.location ? { kind: 'done' } : { kind: 'location', key: 'location', options: LOCATION_IDS.filter(placeOk).filter((loc) => pushes(state, loc, movers).length > 0) };
    case 'surveil-supply':
      if (state.players[pid].supply <= 0) return { kind: 'location', key: 'location', options: [] };
      return t.location ? { kind: 'done' } : { kind: 'location', key: 'location', options: holdingSpots(state, card, mode) };
    case 'pit-fall':
      if (!t.location) return { kind: 'group', key: 'group', options: groups().filter(groupOk).filter((g) => tokensOf(state, g.location, g.faction) <= 3 && pitFalls(state, g.location, g.faction).length > 0) };
      return t.to ? { kind: 'done' } : { kind: 'location', key: 'to', options: pitFalls(state, t.location, /** @type {string} */ (t.faction)) };
    case 'raise-stakes':
      if (state.players[pid].supply <= 0) return { kind: 'location', key: 'location', options: [] };
      return t.location ? { kind: 'done' } : { kind: 'location', key: 'location', options: LOCATION_IDS.filter((l) => contestAt(state, l)) };
    case 'swap-standing':
      if (!t.faction) return { kind: 'faction', options: state.factions.slice() };
      return t.to ? { kind: 'done' } : { kind: 'faction', key: 'to', options: state.factions.filter((f) => f !== t.faction && (state.players[pid].standing[f] ?? 0) !== (state.players[pid].standing[/** @type {string} */ (t.faction)] ?? 0)) };
    case 'split': {
      if (!t.location) return { kind: 'group', key: 'group', options: groups().filter(groupOk).filter((g) => tokensOf(state, g.location, g.faction) >= 2 && exits(g, MAP[g.location].adjacent).length >= 2) };
      const placedN = Object.values(t.split ?? {}).reduce((a, b) => a + b, 0);
      const left = tokensOf(state, t.location, /** @type {string} */ (t.faction)) - placedN;
      const dests = MAP[t.location].adjacent.filter((l) => canEnter(state, l, /** @type {string} */ (t.faction)));
      // At least two locations: the last token can't join the only one used so far.
      const used = Object.keys(t.split ?? {}).filter((d) => (t.split?.[d] ?? 0) > 0);
      return left > 0 ? { kind: 'split', options: left === 1 && used.length === 1 ? dests.filter((d) => d !== used[0]) : dests, left } : { kind: 'done' };
    }
    case 'conveyor':
      if (mode === 'location' && !t.location) return { kind: 'location', key: 'location', options: suitLocations(card) };
      return t.direction ? { kind: 'done' } : { kind: 'direction', options: spec.map.directions.map((d) => d.id) };
    case 'bail-out': {
      const mine = LOCATION_IDS.filter((l) => (state.board[l].influence[pid] ?? 0) > 0);
      if (!t.location) return { kind: 'location', key: 'location', options: mine };
      return t.to ? { kind: 'done' } : { kind: 'location', key: 'to', options: LOCATION_IDS.filter((l) => l !== t.location && !state.board[l].scorched) };
    }
    case 'backup':
      if (state.players[pid].supply <= 0) return { kind: 'location', key: 'location', options: [] };
      return t.location ? { kind: 'done' } : { kind: 'location', key: 'location', options: LOCATION_IDS.filter((l) => (state.board[l].influence[pid] ?? 0) > 0) };
    case 'fall-back':
      return t.location ? { kind: 'done' } : { kind: 'location', key: 'location', options: LOCATION_IDS.filter((l) => fallBackFrom(state, pid, l).length > 0) };
    case 'canvass': {
      if (state.players[pid].supply <= 0) return { kind: 'location', key: 'from', options: [] };
      const at = t.from ?? [];
      if (at.includes('__stop') || at.length >= Math.min(4, state.players[pid].supply)) return { kind: 'done' };
      return { kind: 'location', key: 'from', options: LOCATION_IDS.filter((l) => !state.board[l].scorched && !at.includes(l)), optional: at.length > 0 };
    }
    case 'bait': {
      const into = (/** @type {string} */ to) => MAP[to].adjacent.flatMap((from) => factionsAt(state, from).filter((f) => canEnter(state, to, f)).map((f) => ({ location: from, faction: f })));
      if (!t.location) return { kind: 'location', key: 'location', options: LOCATION_IDS.filter((l) => !state.board[l].scorched && into(l).length > 0) };
      return t.faction ? { kind: 'done' } : { kind: 'group', key: 'lure', options: into(t.location) };
    }
    case 'allegiance':
      if (!t.faction) return { kind: 'faction', options: state.factions.filter((f) => (state.players[pid].standing[f] ?? 0) > 0) };
      return t.to ? { kind: 'done' } : { kind: 'faction', key: 'to', options: state.factions.filter((f) => f !== t.faction) };
    case 'split-up': {
      if (state.players[pid].supply <= 0) return { kind: 'location', key: 'from', options: [] };
      const at = (t.from ?? []).filter((l) => l !== '__stop');
      if ((t.from ?? []).includes('__stop') || at.length >= Math.min(3, state.players[pid].supply)) return { kind: 'done' };
      return { kind: 'location', key: 'from', options: LOCATION_IDS.filter((l) => !state.board[l].scorched && !at.map(regionOf).includes(regionOf(l))), optional: at.length > 0 };
    }
    case 'tipoff': case 'bounty':
      return t.faction ? { kind: 'done' } : { kind: 'faction', options: state.factions.slice() };
    case 'lockdown':
      return t.location ? { kind: 'done' } : { kind: 'location', key: 'location', options: LOCATION_IDS.filter((l) => !state.board[l].lock) };
    case 'wake-dead': case 'swarm': case 'backdoor':
      return t.location ? { kind: 'done' } : { kind: 'location', key: 'location', options: holdingSpots(state, card, mode) };
    case 'hack':
      if (!t.location) return { kind: 'group', key: 'group', options: groups().filter(groupOk).filter((g) => loneRivals(state, g.faction, LOCATION_IDS).some((l) => l !== g.location)) };
      return t.to ? { kind: 'done' } : { kind: 'location', key: 'to', options: loneRivals(state, /** @type {string} */ (t.faction), LOCATION_IDS).filter((l) => l !== t.location) };
    case 'truce':
      return t.location ? { kind: 'done' } : { kind: 'location', key: 'location', options: LOCATION_IDS.filter((l) => !state.board[l].scorched) };
    case 'copy': return { kind: 'location', key: 'location', options: [] };
    case 'trail': {
      const into = (/** @type {string} */ to) => MAP[to].adjacent.flatMap((from) => factionsAt(state, from).filter((f) => canEnter(state, to, f)).map((f) => ({ location: from, faction: f })));
      if (!t.location) return { kind: 'location', key: 'location', options: trailSpots(state, pid).filter((l) => into(l).length > 0) };
      return t.faction ? { kind: 'done' } : { kind: 'group', key: 'lure', options: into(t.location) };
    }
    case 'stake':
      if (state.players[pid].supply <= 0) return { kind: 'location', key: 'location', options: [] };
      return t.location ? { kind: 'done' } : { kind: 'location', key: 'location', options: LOCATION_IDS.filter((l) => !state.board[l].scorched) };
    case 'move-influence': {
      const mine = (/** @type {string} */ l) => state.board[l].influence[pid] ?? 0;
      if (!t.location) return { kind: 'location', key: 'location', options: holdingSpots(state, card, mode).filter((to) => LOCATION_IDS.some((l) => l !== to && mine(l) > 0)) };
      const from = t.from ?? [];
      if (from.includes('__stop') || from.length >= 3) return { kind: 'done' };
      const opts = LOCATION_IDS.filter((l) => l !== t.location && mine(l) - from.filter((x) => x === l).length > 0);
      return opts.length ? { kind: 'location', key: 'from', options: opts, optional: from.length > 0 } : { kind: 'done' };
    }
    case 'cash-in': {
      const has = (/** @type {string} */ l) => factionsAt(state, l).filter((f) => (state.players[pid].standing[f] ?? 0) > 0);
      if (!t.location) return { kind: 'location', key: 'location', options: holdingSpots(state, card, mode).filter((l) => has(l).length > 0) };
      return t.faction ? { kind: 'done' } : { kind: 'faction', options: has(t.location) };
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
  const copy = /** @type {GameState} */ (/** @type {unknown} */ (clone({ board: state.board, players: state.players, pending: state.pending, factions: state.factions, supply: state.supply, round: state.round, options: state.options, lastPlayed: 'lastPlayed' in state ? state.lastPlayed : null, leftOut: 'leftOut' in state ? state.leftOut : [], tips: 'tips' in state ? state.tips : [], events: [], log: [] })));
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
    case 'lure': case 'draw-adjacent': return `at ${L(t.location)}${how}`;
    case 'gather-region': case 'gather-neighbours': case 'call-home': return `${F(t.faction)} into ${L(t.location)}${how}`;
    case 'backdoor': return `at ${L(t.location)}${how}`;
    case 'broadcast': return `${F(t.faction)} from ${(t.from ?? []).map(L).join(' and ')} into ${L(t.location)}${how}`;
    case 'sow': return `${F(t.faction)} from ${L(t.location)} via ${(t.path ?? []).map(L).join(', ')}${how}`;
    case 'token': return `token at ${L(t.location)}${t.bluff ? `, bluff at ${L(t.bluff)}` : ''}${how}`;
    case 'halve': case 'halve-far': case 'teleport': case 'drive-out': case 'drive-out-either': return `${F(t.faction)} at ${L(t.location)} to ${L(t.to)}${how}`;
    case 'pit-fall': return `${F(t.faction)} at ${L(t.location)}${t.to ? ` to ${L(t.to)}` : ''}${how}`;
    case 'surveil-supply': case 'raise-stakes': return `at ${L(t.location)}${how}`;
    case 'split-up': return `at ${(t.from ?? []).map(L).join(', ')}`;
    case 'wake-dead': case 'swarm': return `at ${L(t.location)}${how}`;
    case 'hack': return `${F(t.faction)} at ${L(t.location)} to ${L(t.to)}${how}`;
    case 'tipoff': case 'bounty': return `on ${F(t.faction)}`;
    case 'lockdown': return `the region of ${L(t.location)}`;
    case 'swap-standing': return `${F(t.faction)} and ${F(t.to)}`;
    case 'split': return `${F(t.faction)} at ${L(t.location)} split ${Object.entries(t.split ?? {}).map(([l, n]) => `${n} to ${L(l)}`).join(', ')}${how}`;
    case 'bail-out': return `from ${L(t.location)} to ${L(t.to)}`;
    case 'backup': case 'fall-back': case 'stake': return `at ${L(t.location)}`;
    case 'truce': return `at ${L(t.location)}`;
    case 'canvass': return `at ${(t.from ?? []).map(L).join(', ')}`;
    case 'bait': return `at ${L(t.location)}, drawing ${F(t.faction)} from ${L(t.from?.[0])}`;
    case 'allegiance': return `${F(t.faction)} to ${F(t.to)}`;
    case 'trail': return `${F(t.faction)} from ${L(t.from?.[0])} into ${L(t.location)}`;
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
      return [loc, { tokens: { ...place.tokens }, influence: { ...place.influence }, token: place.token ? { owner: place.token.owner } : null, scorched: place.scorched, ...(place.truce ? { truce: true } : {}), ...(place.double ? { double: place.double.slice() } : {}), ...(place.wake ? { wake: true } : {}), ...(place.swarm ? { swarm: true } : {}), ...(place.backdoor ? { backdoor: place.backdoor.slice() } : {}), ...(place.lock ? { lock: true } : {}) }];
    })),
    supply: { ...state.supply },
    deck: deckOf(state),
    lastPlayed: state.lastPlayed ?? null,
    tips: (state.tips ?? []).map((x) => ({ ...x })),
    bounties: (state.bounties ?? []).slice(),
    printed: Object.fromEntries(deckOf(state).map((id) => [id, printedOf(state, id)])),
    growing: state.growing ? clone(state.growing) : null,
    first: state.first,
    opened: state.opened,
    toAct: waitingOn(state)[0] ?? null,
    pending: state.pending ? { player: state.pending.player, card: state.pending.card, target: state.pending.target, cancelled: state.pending.cancelled, blocked: state.pending.blocked.slice() } : null,
    log: clone(state.log),
    result: state.result ? clone(state.result) : null,
    events: clone(state.events),
    me: {
      hand: me.hand.slice(), kept: me.kept.slice(), batch: me.batch.slice(), picked: me.picked, trophies: { ...me.trophies }, known: me.known.slice(),
      leftOut: me.known.includes('leftout') ? state.leftOut.slice() : null,
    },
  };
}

