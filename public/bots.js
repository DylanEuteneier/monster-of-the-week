// @ts-check
/**
 * Bots. Pure functions over GameState, shared by the simulation harness
 * (seeded rng) and the Durable Object (Math.random), so a human can test a
 * table against bots.
 *
 * Profiles (Appendix F.9), pruned to the strongest (designer, 2026-10-08):
 * - goal:      goal-driven, the standard bot. It scores positions by its
 *              chance of winning, P(each ending) × P(it wins under it), plus
 *              its raw margins, and keeps a goal (win the island, or back a
 *              faction for the invaders) that it switches only past a margin.
 *              Its style is a lean toward factions or trophy sets that fades by
 *              round (designer: more proof to back a faction early on). It searches one move ahead: each card in hand with
 *              sampled targets, its influence, and passing.
 * - goal-deep: goal, plus a reply lookahead: for its best moves it also plays
 *              the next player's best reply and keeps the move that is still
 *              best for it afterwards. Slower.
 * - backer:    goal, leaning toward backing a faction for the invaders (lean
 *              +0.3 against goal's −0.3): the faction-ally player. Two of them at a table of five
 *              bring the invaders' ending about 40% of the time (the
 *              designer's target), so tuning tables seat two.
 * - (hunter, a trophy chaser with a plain value, was removed 2026-10-09:
 *   against the smarter goal bots it took 6.6% of wins from its seat.)
 *
 * Bots are a tool for checking the rules and rough figures, not a model of
 * real players. Their tuning numbers below are not rules.
 */
import {
  cardById, sampleTarget, listTargets, playableResponses, validate, applyMove, resolveFight, totalPresence, presenceOf, influenceSpots, growthDue,
} from './engine.js';

/** @typedef {import('./engine.js').GameState} GameState */
/** @typedef {import('./engine.js').Move} Move */

/**
 * Spending a card for influence; under the test lever influenceToBoard, 1 of
 * it goes onto a location its faction controls (`at` picks which).
 * @param {GameState} state @param {string} cardId @param {(spots: string[]) => string} [at]
 * @returns {Move}
 */
function spend(state, cardId, at = (spots) => spots[0]) {
  const spots = influenceSpots(state, cardId);
  return spots.length ? { type: 'play', card: cardId, use: 'influence', location: at(spots) } : { type: 'play', card: cardId, use: 'influence' };
}
/** @typedef {'goal' | 'goal-deep' | 'backer'} Profile */
/** @typedef {{ rng: () => number, profile?: Profile, memory?: BotMemory, table?: Record<string, string>, memories?: Record<string, BotMemory> }} BotOptions  table, memories: every seat's profile and memory, for play-outs (persona table) */
/** @typedef {{ profiles?: Record<string, string>, memories?: Record<string, BotMemory> }} Seats  the table as a play-out sees it */
/** What a bot remembers between its turns: its goal, and this game's variation in its lean. The caller keeps one per seat; a bot without it has no hysteresis. @typedef {{ goal?: Goal, jitter?: number }} BotMemory */
/** @typedef {'island' | 'invaders'} Goal */

export const PROFILES = /** @type {Profile[]} */ (['goal', 'goal-deep', 'backer']);

/** A profile with the slow search switched off (play-outs, probes' imagined futures, tests): the same persona, one move ahead, sampled targets. @param {string} profile */
export const fast = (profile) => (personaOf(profile) ? `${profile}${profile.includes(':') ? ',' : ':'}sim=0,enum=0,combo=0` : profile);

/** Tuning for the bots, not rules. */
const SEARCH = {
  targets: 8,         // targets sampled per card
  noise: 0.15,        // random jitter on each move's value, so bots vary
  respondMargin: 0.4, // a response must beat holding the card by this much
};
/** Listing targets (persona enum): up to this many per card; past it, sampling fills in. */
const LIST = { cap: 40 };
/** The play-out search (persona sim): its best moves one move ahead, each played to the round's end this many times, by fast goal bots. */
const SIM = { keep: 6, playouts: 4, maxMoves: 400 };
const ROLLOUT = 'goal:sim=0,enum=0,combo=0';
/** The reply lookahead (goal-deep). */
const DEEP = {
  targets: 12,       // targets sampled per card for its own move
  keep: 10,          // its best moves (one move ahead) checked against a reply
  replyTargets: 8,   // targets sampled per card for the reply
};

/**
 * The move this bot should make right now, or null if it has nothing to do.
 * @param {GameState} state
 * @param {{ playerId: string } & BotOptions} input
 * @returns {Move | null}
 */
export function botMove(state, input) {
  const p = state.players[input.playerId];
  if (!p || state.phase === 'ended') return null;
  return playMove(state, input.playerId, input.rng, input.profile ?? 'goal', input.memory, { profiles: input.table, memories: input.memories });
}

/** @param {GameState} state @param {string} pid @param {Move} move */
const legal = (state, pid, move) => (validate(state, { playerId: pid, move }).ok ? move : null);

// ---------------------------------------------------------------------------
// Reading the board
// ---------------------------------------------------------------------------

/** @param {GameState} state */
function contested(state) {
  return Object.keys(state.board).filter((loc) => !state.board[loc].scorched && Object.values(state.board[loc].tokens).filter((n) => n > 0).length === 2);
}

/**
 * The board after this round's fights, as they stand now. Face-down tokens:
 * by default every one is ignored. For `pid` (persona hidden), its own count
 * as they are, and rivals' as they are (`rivals` true) or ignored (false); the
 * caller averages the two, a rival's token being as likely a bluff as not.
 * @param {GameState} state @param {string} [pid] @param {boolean} [rivals]
 */
function projectFights(state, pid = undefined, rivals = false) {
  let s = state;
  for (const loc of contested(state)) {
    const tok = s.board[loc].token;
    if (tok && !(pid !== undefined && (tok.owner === pid || rivals))) {
      s = structuredClone(s);
      s.board[loc].token = null;
    }
    s = resolveFight(s, loc);
  }
  return s;
}

const sigmoid = (/** @type {number} */ x) => 1 / (1 + Math.exp(-x));

/**
 * How good a position is for `pid`: a goal bot's goal-weighted win chance (an
 * unknown profile, such as one saved before a bot was removed, plays as goal).
 * @param {GameState} state @param {string} pid @param {Profile | string} [profile] @param {Goal} [goal]  a goal bot's current goal
 */
export function evaluate(state, pid, profile = 'goal', goal = undefined) {
  const persona = personaOf(profile);
  return goalValue(state, pid, goal ?? 'island', persona ?? PERSONAS.goal);
}

// ---------------------------------------------------------------------------
// Goal bots: the chance of winning, and goals that shift (designer, 2026-10-07)
// ---------------------------------------------------------------------------

/**
 * A goal bot's persona (tuning, not rules; tested in tournaments, F.9).
 * Style (designer, 2026-10-08: at the start a bot decides what to pursue
 * somewhat arbitrarily from its play style; later the board decides):
 * - lean: its bias toward backing a faction (+) or trophy sets (−). It fades
 *   as the game goes on, from full in round 1 to nothing in the last round.
 * - jitter: each game its lean varies by up to this much, at random.
 * - hold: stubbornness, how far the case must turn before it switches plan.
 * Competence (the same for every style):
 * - push: tokens of presence per remaining round it reckons one player can
 *   move the game toward the ending it wants.
 * - margin: how much its standing margin with the likely winning faction
 *   counts beside the win chance.
 * - linear: how much its island margin (trophy sets counted directly)
 *   counts.
 * - threat: how much the best rival's chance of winning through the invaders
 *   counts against it (designer: trophy players block a lone backer).
 * Search (switches, 0 or 1, tested as challengers before they become standard):
 * - hidden: count face-down tokens, its own as they are, a rival's as even odds.
 * - enum: list every legal target of a card (up to LIST.cap), not 8 samples.
 * - sim: choose by playing each of its best moves out to the round's end.
 * - combo: in the draft, value a card with the cards already kept.
 * - table: in its play-outs, every seat plays its own profile (fast), itself
 *   included, instead of all as trophy-leaning goal bots. Needs the table's
 *   profiles (BotOptions.table; a little cheating, fine for now).
 * - keep, playouts: the play-out search's size (default SIM.keep, SIM.playouts);
 *   tune these down for faster tuning runs rather than using a weaker bot.
 * - sets: for the island, value standing (and influence on the board) with the
 *   factions of its weakest colours: the access to the fights that bring them
 *   (IC1), so it builds toward complete sets instead of piling up one colour.
 * @typedef {{ lean: number, jitter: number, hold: number, push: number, margin: number, linear: number, threat: number, hidden?: number, enum?: number, sim?: number, combo?: number, sets?: number, keep?: number, playouts?: number, table?: number }} Persona
 */
/** @type {Record<'goal' | 'goal-deep' | 'backer', Persona>} */
const PERSONAS = {
  // linear 1: counting island trophies as hunter does closed hunter's lead (challenger 32% against 20%, 2026-10-08).
  // threat 1: trophy players act against a rival pulling ahead with a faction (designer); hunter fell from 41% to 20% against it (2026-10-08).
  // Search switches standard from 2026-10-09 (challengers, 200 games each, seat 5 against backer, backer, goal, goal; an even share 20%):
  // sim 49.9%, sets=2 29.3% (sets=1 26.0%, sets=4 21.0%), enum 24.8%, combo 24.3%, hidden 21.5%; all together 57.9%.
  // table (2026-10-09): a bug fix, not a heuristic: play-outs had every seat, the bot itself included, play as a trophy-leaning goal bot.
  goal: { lean: -0.3, jitter: 0.15, hold: 0.05, push: 2, margin: 3, linear: 1, threat: 1, hidden: 1, enum: 1, sim: 1, combo: 1, sets: 2, table: 1 },
  'goal-deep': { lean: -0.3, jitter: 0.15, hold: 0.05, push: 2, margin: 3, linear: 1, threat: 1, hidden: 1, enum: 1, sim: 1, combo: 1, sets: 2, table: 1 },
  backer: { lean: 0.3, jitter: 0.15, hold: 0.05, push: 2, margin: 3, linear: 1, threat: 1, hidden: 1, enum: 1, sim: 1, combo: 1, sets: 2, table: 1 },
};

/**
 * A profile's persona. For tuning, a profile can also be written
 * "goal:lean=0,hold=0.1" (or "goal-deep:..."): the base persona with those
 * numbers changed.
 * @param {string} profile @returns {Persona | undefined}
 */
export function personaOf(profile) {
  const [base, overrides] = profile.split(':');
  const p = PERSONAS[/** @type {'goal' | 'goal-deep' | 'backer'} */ (base)];
  if (!p || !overrides) return p;
  return { ...p, ...Object.fromEntries(overrides.split(',').map((kv) => { const [k, v] = kv.split('='); return [k, Number(v)]; })) };
}

/** Reading the table (tuning, not rules): a rival with this much standing less trophies with one faction is seen as backing it; each one seen moves the prior for the invaders' ending by `step` from `base`. */
const TABLE = { backing: 8, base: 0.3, step: 0.15 };

/**
 * The chance of winning, by ending. `pInvaders` (designer, 2026-10-08: games
 * always start with presence over the threshold, so first-round presence says
 * nothing about the ending): a prior from reading the table (how many rivals
 * are seen backing a faction) in round 1, moving to the projected presence
 * (this round's fights and growth) against the threshold by the last round. `asInvaders`: each
 * faction's chance of being the winner (from presence) times my chance of
 * leading it (standing less trophies against the best rival). `asIsland`: my
 * weakest colour, then the next, against the best rival (TS2, WT1). Margins
 * sharpen as rounds run out.
 * @param {GameState} state @param {string} pid @param {boolean} [hidden]  persona hidden: count face-down tokens (see projectFights)
 */
export function winChances(state, pid, hidden = false) {
  if (!hidden) return chancesAfter(projectFights(state), pid);
  const mine = chancesAfter(projectFights(state, pid, false), pid);
  if (!Object.values(state.board).some((place) => place.token && place.token.owner !== pid)) return mine;
  const theirs = chancesAfter(projectFights(state, pid, true), pid);
  return /** @type {typeof mine} */ (Object.fromEntries(Object.entries(mine).map(([k, v]) => [k, (v + /** @type {Record<string, number>} */ (/** @type {unknown} */ (theirs))[k]) / 2])));
}

/** winChances on a board whose fights are already projected. @param {GameState} s @param {string} pid */
function chancesAfter(s, pid) {
  const roundsLeft = Math.max(0, Number(s.options.rounds) - s.round);
  const threshold = Number(s.options.threshold);
  let grow = 0;
  for (const f of s.factions) grow += Math.min(s.supply[f], Object.values(growthDue(s, f)).reduce((a, b) => a + b, 0));
  const projected = totalPresence(s) + (s.phase === 'play' ? grow : 0);
  const spreadP = 2 + 3 * roundsLeft;
  const others = s.seating.filter((id) => id !== pid);
  const presence = s.factions.map((f) => presenceOf(s, f));
  const top = Math.max(...presence);
  const w = presence.map((n) => Math.exp((n - top) / (1.5 + 1.5 * roundsLeft)));
  const wSum = w.reduce((a, b) => a + b, 0);
  const net = (/** @type {string} */ id, /** @type {string} */ f) => (s.players[id].standing[f] ?? 0) - s.players[id].trophies[f];
  const lead = (/** @type {string} */ f) => net(pid, f) - Math.max(...others.map((o) => net(o, f)));
  const asInvaders = s.factions.reduce((acc, f, i) => acc + (w[i] / wSum) * sigmoid(lead(f) / (1 + roundsLeft)), 0);
  const marginInvaders = s.factions.reduce((acc, f, i) => acc + (w[i] / wSum) * lead(f), 0);
  // The best rival's chance of leading the winning faction (each rival against everyone else).
  const rivalInvaders = Math.max(0, ...others.map((o) => s.factions.reduce((acc, f, i) => acc + (w[i] / wSum) * sigmoid((net(o, f) - Math.max(...s.seating.filter((x) => x !== o).map((x) => net(x, f)))) / (1 + roundsLeft)), 0)));
  const isl = (/** @type {string} */ id) => {
    const t = s.factions.map((f) => s.players[id].trophies[f]).sort((a, b) => a - b);
    return t[0] + 0.35 * t[1] + 0.12 * t[2];
  };
  const marginIsland = isl(pid) - Math.max(...others.map(isl));
  const islAll = (/** @type {string} */ id) => isl(id) + 0.02 * s.factions.reduce((n, f) => n + s.players[id].trophies[f], 0);
  const linearIsland = islAll(pid) - Math.max(...others.map(islAll)); // the island margin, counted directly
  const asIsland = sigmoid(marginIsland / (0.6 + 0.8 * roundsLeft));
  const backers = others.filter((o) => Math.max(...s.factions.map((f) => net(o, f))) >= TABLE.backing).length;
  const prior = Math.min(0.9, Math.max(0.1, TABLE.base + TABLE.step * backers));
  const rounds = Number(s.options.rounds);
  const known = rounds > 1 ? Math.min(1, (s.round - 1) / (rounds - 1)) : 1; // how much presence says by now
  const pInvaders = (1 - known) * prior + known * sigmoid((projected - threshold - 0.5) / spreadP);
  return { pInvaders, prior, known, backers, linearIsland, rivalInvaders, asInvaders, asIsland, marginInvaders, marginIsland, projected, threshold, spreadP, roundsLeft };
}

/** A goal bot's value: its win chance, weighted toward its goal, plus its margins. @param {GameState} state @param {string} pid @param {Goal} goal @param {Persona} persona */
function goalValue(state, pid, goal, persona) {
  const c = winChances(state, pid, !!persona.hidden);
  // Margins are added on their own, never scaled by an ending's chance: a margin can be negative, and scaling it would
  // reward a bot that is behind for making that ending less likely (2026-10-08 fix).
  const inv = c.pInvaders * 10 * c.asInvaders + persona.margin * c.marginInvaders;
  const islandMargin = persona.linear * 10 * c.linearIsland;
  const isl = (1 - c.pInvaders) * 10 * c.asIsland + islandMargin;
  const threat = (persona.threat ?? 0) * 10 * c.pInvaders * c.rivalInvaders;
  return (goal === 'invaders' ? inv : isl + (persona.sets ? persona.sets * (1 - c.pInvaders) * setAccess(state, pid) : 0)) - threat + 0.02 * state.players[pid].supply;
}

/**
 * Access to the colours a player is short of (persona sets): for each faction,
 * how much its colour is needed (the weakest counts most, as the island
 * ending does, TS2/WT1) times the standing and board influence the player
 * could use to contest its fights, with diminishing returns. Fades to nothing
 * in the last round, when only trophies in hand count.
 * @param {GameState} state @param {string} pid
 */
function setAccess(state, pid) {
  const p = state.players[pid];
  const roundsLeft = Math.max(0, Number(state.options.rounds) - state.round);
  if (!roundsLeft) return 0;
  const order = state.factions.slice().sort((a, b) => p.trophies[a] - p.trophies[b]);
  const need = [1, 0.35, 0.12, 0, 0];
  const onBoard = (/** @type {string} */ f) => Object.values(state.board).reduce((n, place) => n + ((place.tokens[f] ?? 0) > 0 ? place.influence[pid] ?? 0 : 0), 0);
  return order.reduce((acc, f, i) => acc + need[i] * Math.sqrt((p.standing[f] ?? 0) + onBoard(f)), 0) * Math.min(1, roundsLeft / 2);
}

/**
 * Which goal to pursue now: the evidence (for each ending, how reachable it
 * is if it pushes that way, times its chance of winning there) plus its lean,
 * which fades by round. A plan it holds is kept until the case turns by
 * `hold`.
 * @param {GameState} state @param {string} pid @param {Persona} persona @param {BotMemory} [memory] @param {() => number} [rng] @returns {Goal}
 */
export function chooseGoal(state, pid, persona, memory, rng = Math.random) {
  const c = winChances(state, pid, !!persona.hidden);
  const push = persona.push * (c.roundsLeft + 1);
  const reachInv = (1 - c.known) * Math.min(1, c.prior + 0.15) + c.known * sigmoid((c.projected - c.threshold - 0.5 + push) / c.spreadP);
  const reachIsl = (1 - c.known) * Math.min(1, 1 - c.prior + 0.15) + c.known * (1 - sigmoid((c.projected - c.threshold - 0.5 - push) / c.spreadP));
  const evidence = reachInv * c.asInvaders - reachIsl * c.asIsland;
  if (memory && memory.jitter === undefined) memory.jitter = (rng() * 2 - 1) * persona.jitter; // this game's play style
  const score = evidence + (persona.lean + (memory?.jitter ?? 0)) * (1 - c.known);
  const held = memory?.goal;
  /** @type {Goal} */
  const goal = score > (held === 'invaders' ? -persona.hold : held === 'island' ? persona.hold : 0) ? 'invaders' : 'island';
  if (memory) memory.goal = goal;
  return goal;
}

// ---------------------------------------------------------------------------
// Choosing a move
// ---------------------------------------------------------------------------

/** Every move worth considering on this bot's turn. @param {GameState} state @param {string} pid @param {() => number} rng */
function candidates(state, pid, rng, targets = SEARCH.targets, list = false) {
  const p = state.players[pid];
  /** @type {Move[]} */
  const moves = [{ type: 'pass' }];
  for (const cardId of new Set(p.hand)) {
    const card = cardById(cardId);
    if (card.suit) {
      const spots = influenceSpots(state, cardId);
      if (spots.length) for (const location of spots) moves.push({ type: 'play', card: cardId, use: 'influence', location });
      else moves.push({ type: 'play', card: cardId, use: 'influence' });
    }
    if (!card.action) continue;
    /** @type {Set<string>} */
    const seen = new Set();
    if (list) {
      const l = listTargets(state, pid, cardId, LIST.cap);
      for (const target of l.targets) { seen.add(JSON.stringify(target)); moves.push({ type: 'play', card: cardId, use: 'action', target }); }
      if (l.complete && !l.targets.length) moves.push({ type: 'play', card: cardId, use: 'action', target: null }); // no legal target: played for no effect
      if (l.complete) continue;
      targets += seen.size;
    }
    for (let i = 0; i < targets * 2 && seen.size < targets; i++) {
      const target = sampleTarget(state, pid, cardId, rng);
      const key = JSON.stringify(target);
      if (seen.has(key)) continue;
      seen.add(key);
      moves.push({ type: 'play', card: cardId, use: 'action', target });
    }
  }
  return moves.filter((m) => validate(state, { playerId: pid, move: m }).ok);
}

/** The state after a move, with an action played straight through to its resolution. @param {GameState} state @param {string} pid @param {Move} move */
function after(state, pid, move) {
  let s = applyMove(state, { playerId: pid, move });
  if (s.pending && s.pending.player === pid && move.type === 'play') s = applyMove(s, { playerId: pid, move: { type: 'confirm' } });
  return s;
}

/** @typedef {(s: GameState, id?: string) => number} Ev  a bot's value of a position, for itself or (in its lookahead) another seat */

/** @param {GameState} state @param {string} pid @param {() => number} rng @param {Profile | string} profile @param {BotMemory} [memory] @param {Seats} [seats] @returns {Move | null} */
function playMove(state, pid, rng, profile, memory, seats = {}) {
  const p = state.players[pid];
  const persona = personaOf(profile);
  const goal = persona ? chooseGoal(state, pid, persona, memory, rng) : undefined;
  /** This bot's value of a position (others, in its lookahead, as standard goal bots). @type {Ev} */
  const ev = (s, id = pid) => (id === pid ? evaluate(s, pid, profile, goal) : evaluate(s, id));
  const value = (/** @type {GameState} */ s) => ev(s) + (rng() - 0.5) * SEARCH.noise;

  if (state.phase === 'draft') {
    if (p.picked) return null;
    // Keep the cards whose best play, now, is worth the most.
    const pool = [...p.kept, ...p.batch];
    const base = ev(state);
    const worth = pool.map((cardId) => ({ cardId, v: (persona?.combo ? comboWorth(state, pid, cardId, p.kept, rng, ev, base) : cardWorth(state, pid, cardId, rng, ev, base)) + (rng() - 0.5) * SEARCH.noise }));
    worth.sort((a, b) => b.v - a.v);
    return legal(state, pid, { type: 'pick', keep: worth.slice(0, p.kept.length + 1).map((w) => w.cardId) });
  }

  if (state.phase === 'growth') {
    const g = state.growing;
    if (!g || g.leaders[g.next % g.leaders.length] !== pid) return null;
    const options = Object.keys(g.due).map((location) => ({ location, v: value(applyMove(state, { playerId: pid, move: { type: 'grow', location } })) }));
    options.sort((a, b) => b.v - a.v);
    return { type: 'grow', location: options[0].location };
  }

  if (state.phase !== 'play') return null;

  // Responses: only when they beat holding the card.
  const responses = playableResponses(state, pid);
  if (responses.length) {
    const actor = state.pending?.player;
    const finish = (/** @type {GameState} */ s) => (s.pending && actor ? applyMove(s, { playerId: actor, move: { type: 'confirm' } }) : s);
    const baseline = ev(finish(state));
    let best = null, bestV = baseline + SEARCH.respondMargin;
    for (const r of responses) {
      const move = /** @type {Move} */ ({ type: 'respond', card: r.card, location: r.location });
      const v = ev(finish(applyMove(state, { playerId: pid, move })));
      if (v > bestV) {
        best = move;
        bestV = v;
      }
    }
    if (best) return best;
  }

  if (state.pending) return state.pending.player === pid ? { type: 'confirm' } : null;
  if (state.seating[state.turn] !== pid) return null;

  // Only legal moves compete; the first is kept if none scores (passing isn't always legal).
  const deep = profile.split(':')[0] === 'goal-deep';
  const moves = candidates(state, pid, rng, deep ? DEEP.targets : SEARCH.targets, !!persona?.enum);
  if (deep) return deepPick(state, pid, rng, moves, ev);
  if (persona?.sim) return simPick(state, pid, rng, moves, ev, memory, persona.keep ?? SIM.keep, persona.playouts ?? SIM.playouts, persona.table ? { profiles: { ...seats.profiles, [pid]: String(profile) }, memories: seats.memories } : undefined);
  let best = moves[0] ?? null, bestV = -Infinity;
  for (const move of moves) {
    const v = value(after(state, pid, move));
    if (v > bestV) {
      best = move;
      bestV = v;
    }
  }
  return best;
}

/**
 * goal-deep's choice: its best moves one move ahead, each followed by the next
 * player's best reply (one move ahead), scored for this bot.
 * @param {GameState} state @param {string} pid @param {() => number} rng @param {Move[]} moves @param {Ev} ev
 */
function deepPick(state, pid, rng, moves, ev) {
  const noise = () => (rng() - 0.5) * SEARCH.noise;
  const first = moves.map((move) => { const s = after(state, pid, move); return { move, s, v: ev(s) + noise() }; })
    .sort((a, b) => b.v - a.v).slice(0, DEEP.keep);
  let best = first[0]?.move ?? null, bestV = -Infinity;
  for (const { move, s } of first) {
    let end = s;
    const q = s.phase === 'play' && !s.pending ? s.seating[s.turn] : null;
    if (q && q !== pid) {
      let reply = null, replyV = -Infinity;
      for (const m of candidates(s, q, rng, DEEP.replyTargets)) {
        const r = after(s, q, m);
        const v = ev(r, q) + noise();
        if (v > replyV) { reply = r; replyV = v; }
      }
      if (reply) end = reply;
    }
    const v = ev(end) + noise();
    if (v > bestV) { best = move; bestV = v; }
  }
  return best;
}

/**
 * The play-out search (persona sim): its best moves one move ahead (passing
 * always among them), each played out to the end of the round's play by
 * standard goal bots several times, scored for this bot at the end. Each
 * playout's randomness is shared across the moves, so they meet the same
 * futures. Passing and holding a card are judged like any other move.
 * @param {GameState} state @param {string} pid @param {() => number} rng @param {Move[]} moves @param {Ev} ev @param {BotMemory} [memory] @param {number} [keep] @param {number} [playouts] @param {Seats} [table]  persona table: each seat's profile (played fast) and memory, in the play-outs
 */
function simPick(state, pid, rng, moves, ev, memory, keep = SIM.keep, playouts = SIM.playouts, table = undefined) {
  const ranked = moves.map((move) => { const s = after(state, pid, move); return { move, s, v: ev(s) }; }).sort((a, b) => b.v - a.v);
  const short = ranked.slice(0, keep);
  const pass = ranked.find((r) => r.move.type === 'pass');
  if (pass && !short.includes(pass)) short.push(pass);
  const seeds = Array.from({ length: playouts }, () => Math.floor(rng() * 2 ** 31));
  let best = short[0]?.move ?? null, bestV = -Infinity;
  for (const { move, s } of short) {
    let total = 0;
    for (const seed of seeds) total += ev(playOutRound(s, seed, pid, memory, table));
    const v = total / seeds.length;
    if (v > bestV) { best = move; bestV = v; }
  }
  return best;
}

/** Fast bots play from here to the end of this round's play: each seat's own profile (persona table) or ROLLOUT. @param {GameState} state @param {number} seed @param {string} pid @param {BotMemory} [memory] @param {Seats} [table] */
function playOutRound(state, seed, pid, memory, table = undefined) {
  let x = seed | 0;
  const r = () => { x = (Math.imul(x, 1664525) + 1013904223) | 0; return (x >>> 0) / 2 ** 32; };
  /** @type {Record<string, BotMemory>} */
  // Each seat keeps the plan it holds (persona table: every seat's memory; otherwise only this bot's own).
  const mem = Object.fromEntries(state.seating.map((id) => [id, id === pid && memory ? { ...memory } : { ...(table?.memories?.[id] ?? {}) }]));
  let s = state;
  const round = s.round;
  for (let n = 0; n < SIM.maxMoves && s.phase === 'play' && s.round === round; n++) {
    let moved = false;
    for (const id of s.seating) {
      const m = playMove(s, id, r, table?.profiles?.[id] ? fast(table.profiles[id]) : ROLLOUT, mem[id]);
      if (!m) continue;
      s = applyMove(s, { playerId: id, move: m });
      moved = true;
      break;
    }
    if (!moved) break;
  }
  return s;
}

/** How much a card adds, played as well as the bot can find right now. @param {GameState} state @param {string} pid @param {string} cardId @param {() => number} rng @param {Ev} ev @param {number} base */
function cardWorth(state, pid, cardId, rng, ev, base) {
  const card = cardById(cardId);
  // A rough worth in the draft, where it isn't this bot's turn: score the
  // card's best play as if it were.
  const s = structuredClone(state);
  s.phase = 'play';
  s.turn = s.seating.indexOf(pid);
  s.opened = true;
  s.pending = null;
  s.players[pid].hand = [cardId];
  let best = card.response ? 0.5 : 0;
  const infl = spend(s, cardId);
  if (card.suit && validate(s, { playerId: pid, move: infl }).ok) best = Math.max(best, ev(after(s, pid, infl)) - base);
  if (card.action) {
    for (let i = 0; i < 4; i++) {
      const target = sampleTarget(s, pid, cardId, rng);
      if (!target) continue;
      const move = /** @type {Move} */ ({ type: 'play', card: cardId, use: 'action', target });
      if (!validate(s, { playerId: pid, move }).ok) continue;
      best = Math.max(best, ev(after(s, pid, move)) - base);
    }
  }
  return best + (card.marked ? 0.2 : 0);
}

/**
 * In the draft (persona combo): a card's worth with the cards already kept.
 * Its best play alone, or after the best play of a kept card (whichever adds
 * more over that kept card's play on its own), so pairs that work together
 * (bait and a trap, a gather and a claim) count.
 * @param {GameState} state @param {string} pid @param {string} cardId @param {string[]} kept @param {() => number} rng @param {Ev} ev @param {number} base
 */
function comboWorth(state, pid, cardId, kept, rng, ev, base) {
  let best = cardWorth(state, pid, cardId, rng, ev, base);
  for (const k of kept.filter((id) => id !== cardId)) {
    const s = structuredClone(state);
    s.phase = 'play';
    s.turn = s.seating.indexOf(pid);
    s.opened = true;
    s.pending = null;
    s.players[pid].hand = [k, cardId];
    const firsts = bestPlays(s, pid, k, rng, ev);
    if (!firsts.length) continue;
    const alone = firsts[0].v;
    for (const f of firsts.slice(0, 2)) {
      const s2 = structuredClone(f.s);
      s2.phase = 'play';
      s2.turn = s2.seating.indexOf(pid);
      s2.pending = null;
      const seconds = bestPlays(s2, pid, cardId, rng, ev);
      if (seconds.length) best = Math.max(best, seconds[0].v - alone);
    }
  }
  return best + (cardById(cardId).marked ? 0.2 : 0);
}

/** A card's best few plays for its action, best first. @param {GameState} s @param {string} pid @param {string} cardId @param {() => number} rng @param {Ev} ev */
function bestPlays(s, pid, cardId, rng, ev) {
  if (!cardById(cardId).action) return [];
  const out = [];
  for (let i = 0; i < 4; i++) {
    const target = sampleTarget(s, pid, cardId, rng);
    if (!target) continue;
    const move = /** @type {Move} */ ({ type: 'play', card: cardId, use: 'action', target });
    if (!validate(s, { playerId: pid, move }).ok) continue;
    const after2 = after(s, pid, move);
    out.push({ s: after2, v: ev(after2) });
  }
  return out.sort((a, b) => b.v - a.v);
}
