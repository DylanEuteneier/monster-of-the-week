// @ts-check
/**
 * Bots. Pure functions over GameState, shared by the simulation harness
 * (seeded rng) and the Durable Object (Math.random), so a human can test a
 * table against bots.
 *
 * Profiles (Appendix F.9), pruned to the strongest (designer, 2026-10-08):
 * - trophy:    the trophy player (named goal until 2026-10-09). Goal-driven, the standard bot. It scores positions by its
 *              chance of winning, P(each ending) × P(it wins under it), plus
 *              its raw margins, and keeps a goal (win the island, or back a
 *              faction for the invaders) that it switches only past a margin.
 *              Its style is a lean toward factions or trophy sets that fades by
 *              round (designer: more proof to back a faction early on). It searches one move ahead: each card in hand with
 *              sampled targets, its sway, and passing; with the
 *              search switches below it plays its best moves out to the end
 *              of the round.
 * - (goal-deep, goal with a reply lookahead, was removed 2026-10-09: its
 *   lookahead bypassed the play-out search, and it won 5% against 42.5%.)
 * - backer:    trophy, leaning toward backing a faction for the invaders (lean
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
  cardById, clone, cloneState, memoising, memoOn, resolveFights, fightsDue, sampleTarget, listTargets, playableResponses, validate, applyMove, totalPresence, presenceOf, swaySpots, growthTotal, fleeOptions, returnRoom, choiceSteps, completeTarget,
} from './engine.js';
import evalFit from './eval-fit.json' with { type: 'json' };
import goalFitData from './goal-fit.json' with { type: 'json' };

/** @typedef {import('./engine.js').GameState} GameState */
/** @typedef {import('./engine.js').Move} Move */
/** @typedef {import('./engine.js').Target} Target */

/**
 * Spending a card for sway; under the test lever swayToBoard, 1 of
 * it goes onto a location its faction controls (`at` picks which).
 * @param {GameState} state @param {string} cardId @param {(spots: string[]) => string} [at]
 * @returns {Move}
 */
function spend(state, cardId, at = (spots) => spots[0]) {
  const spots = swaySpots(state, cardId);
  return spots.length ? { type: 'play', card: cardId, use: 'sway', location: at(spots) } : { type: 'play', card: cardId, use: 'sway' };
}
/** @typedef {'trophy' | 'backer'} Profile */
/** @typedef {{ rng: () => number, profile?: Profile, memory?: BotMemory, table?: Record<string, string>, memories?: Record<string, BotMemory> }} BotOptions  table, memories: every seat's profile and memory, for play-outs (persona table) */
/** @typedef {{ profiles?: Record<string, string>, memories?: Record<string, BotMemory>, deep?: boolean }} Seats  the table as a play-out sees it; deep: the play-outs' seats keep their target listing (persona deepRoll) */
/** What a bot remembers between its turns: its goal, and this game's variation in its lean. The caller keeps one per seat; a bot without it has no hysteresis. @typedef {{ goal?: Goal, jitter?: number }} BotMemory */
/** @typedef {'island' | 'invaders'} Goal */

export const PROFILES = /** @type {Profile[]} */ (['trophy', 'backer']);

/** A profile with the slow search switched off (play-outs, probes' imagined futures, tests): the same persona, one move ahead, sampled targets. @param {string} profile */
export const fast = (profile) => (personaOf(profile) ? `${profile}${profile.includes(':') ? ',' : ':'}sim=0,enum=0,combo=0` : profile);
/** A play-out seat that keeps its target listing (and even): persona deepRoll. @param {string} profile */
const fastListing = (profile) => (personaOf(profile) ? `${profile}${profile.includes(':') ? ',' : ':'}sim=0,combo=0` : profile);

/** Tuning for the bots, not rules. */
const SEARCH = {
  targets: 8,         // targets sampled per card
  noise: 0.15,        // random jitter on each move's value, so bots vary
  respondMargin: 0.4, // a response must beat holding the card by this much
};
/** Listing targets (persona enum): up to this many per card; past it, sampling fills in. */
const LIST = { cap: 40 };
/** Ranked listing (persona rank): list up to `list`, keep the `top` by quick score and `random` others. Tuning, not rules. */
const RANK = { list: 200, top: 30, random: 10 };
/** The play-out search (persona sim): its best moves one move ahead, each played to the round's end this many times, by fast goal bots. */
// keep 8, playouts 6 (2026-10-26, challengers, 40 games each, seed 111: backer 40% a seat against 5%, trophy 38% against 16%;
// designer: data quality over speed). Was 6 and 4.
const SIM = { keep: 8, playouts: 6, maxMoves: 400 };
/** Counters for looking inside the planning search (a measuring aid, not tuning). */
export const PLAN_STATS = { decisions: 0, planned: 0, changed: 0, gain: 0, lucky: 0, followed: 0, dropped: 0 };
/** Hand planning (persona plan): play-outs per decision, spread over the (first move, plan) pairs. Tuning, not rules. */
// moves: plans for every shortlisted first move (2026-10-27: plans only for the plain search's best 3 changed 8% of moves;
// a setup move ranks low alone, so it never got a plan).
const PLAN = { budget: 450, depth: 2, moves: 99 };
/** Planning in the draft (persona draftPlan): keeps compared besides the best by worth, and play-outs for each keep's plan. Tuning, not rules. */
const DRAFT_PLAN = { swaps: 3, budget: 120 };
const ROLLOUT = 'trophy:sim=0,enum=0,combo=0';

/**
 * The move this bot should make right now, or null if it has nothing to do.
 * @param {GameState} state
 * @param {{ playerId: string } & BotOptions} input
 * @returns {Move | null}
 */
export function botMove(state, input) {
  const p = state.players[input.playerId];
  if (!p || state.phase === 'ended') return null;
  return memoising(() => playMove(state, input.playerId, input.rng, input.profile ?? 'trophy', input.memory, { profiles: input.table, memories: input.memories }));
}

/** @param {GameState} state @param {string} pid @param {Move} move */
const legal = (state, pid, move) => (validate(state, { playerId: pid, move }).ok ? move : null);

// ---------------------------------------------------------------------------
// Reading the board
// ---------------------------------------------------------------------------

/** @param {GameState} state */
function contested(state) {
  return fightsDue(state); // the engine's: a Gate's two ends count as one location
}

/**
 * The board after this round's fights, as they stand now. Face-down tokens:
 * by default every one is ignored. For `pid` (persona hidden), its own count
 * as they are, and rivals' as they are (`rivals` true) or ignored (false); the
 * caller averages the two, a rival's token being as likely a bluff as not.
 * @param {GameState} state @param {string} [pid] @param {boolean} [rivals]
 */
function projectFights(state, pid = undefined, rivals = false) {
  const locs = contested(state);
  if (!locs.length) return state;
  const hide = locs.filter((loc) => { const tok = state.board[loc].token; return tok && !(pid !== undefined && (tok.owner === pid || rivals)); });
  // Memoised per state and tokens set aside (a speed-up, not a heuristic): the same projection is asked for many times.
  if (!memoOn()) return resolveFights({ ...state, log: [], events: [], board: Object.fromEntries(Object.entries(state.board).map(([loc, place]) => [loc, hide.includes(loc) ? { ...place, token: null } : place])) }, locs);
  let memo = PROJECTED.get(state);
  if (!memo) { memo = new Map(); PROJECTED.set(state, memo); }
  const key = hide.join(',');
  const hit = memo.get(key);
  if (hit) return hit;
  const s = cloneState({ ...state, log: [], events: [] }); // the log is not read here, and copying it was most of the cost
  for (const loc of hide) s.board[loc].token = null;
  const out = resolveFights(s, locs, false);
  memo.set(key, out);
  return out;
}

/** @type {WeakMap<object, Map<string, GameState>>} */
const PROJECTED = new WeakMap();

const sigmoid = (/** @type {number} */ x) => 1 / (1 + Math.exp(-x));

/**
 * How good a position is for `pid`: a goal bot's goal-weighted win chance (an
 * unknown profile, such as one saved before a bot was removed, plays as goal).
 * @param {GameState} state @param {string} pid @param {Profile | string} [profile] @param {Goal} [goal]  a goal bot's current goal
 */
export function evaluate(state, pid, profile = 'trophy', goal = undefined, quick = false) {
  const persona = personaOf(profile);
  return goalValue(state, pid, goal ?? 'island', persona ?? PERSONAS.trophy, quick);
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
 * - steer: with enum, a card with more targets than the listing holds has them found best first (designer, 2026-10-26:
 *   first see which kind of move is needed and fits the plan, then spend the listing there): each option of each choice
 *   is tried with a couple of random completions, scored by the bot's own value (so its goal counts), and the most
 *   promising branch is opened further, until the listing is spent.
 * - draftPlan: plan in the draft (designer, 2026-10-27: planning begins as the draft goes): the best keep by card worth
 *   and a few others (its weakest card swapped for the next best) are each scored by planning that hand as if play
 *   began now (best first move and plan, played out; others hold what they have kept); the best-planned keep is kept.
 * - plan: with sim, plan the whole hand (designer, 2026-10-26: chains of plays, the hand played together). Each of
 *   its best first moves is tried with every plan for the cards left (none; one card next; two cards in order): in
 *   its play-outs it keeps to the plan, choosing each planned card's target on the board as it then is. The budget
 *   (planBudget play-outs, default PLAN.budget) is spent by successive halving over the (move, plan) pairs. It plays
 *   the best pair's first move and plans again next turn.
 * - goalFit: the goal (island or invaders) chosen on each ending's fitted win chance (goal-fit.json, from
 *   scripts/fit-goals.mjs; 2026-10-26, designer: accurate round evaluation passed back to strategy), not on the
 *   bots' own, which predicts no better than a constant early on. Moves are still chosen by the bot's own value.
 * - deepRoll: with sim and table, the play-outs' seats keep their target listing and even (2026-10-26: imagined
 *   futures sampled 8 targets a card, so the big unsuited cards were misplayed in them).
 * - rank: with enum, a card with more targets than the listing holds lists up to RANK.list, scores each quickly (its own
 *   evaluation on the board after the play, fights not projected), and fully scores the best RANK.top and RANK.random others.
 * - even: with enum, a card with several uses shares the listing between them (2026-10-25: the last use filled it).
 * - field: win chances against every rival, multiplied (2026-10-25, designer: value making any rival lose points), not
 *   only against the best of them.
 * - spread: with sim, every card in hand sends its best move to the play-outs (2026-10-25: a play whose worth comes
 *   later, such as taking a card back or a mark that pays at nightfall, scores little one move ahead and never got there).
 * - combo: in the draft, value a card with the cards already kept.
 * - race: with protect, value its lead in its backed faction's net standing,
 *   weighted by how safe presence is (once it is safe, the lead decides).
 * - top: with protect, also value its backed faction having the most
 *   presence (the faction that wins the invaders' ending, TH1).
 * - protect: while backing, value total presence over the threshold and its
 *   backed faction's presence (presenceGuard), from round 1.
 * - commit: once backing a faction, switch to the island only for an island
 *   chance at least this many times the invader chance (a large number: never).
 * - allies: count the push of rivals seen backing when judging whether the
 *   invaders' ending can still be reached (1: each counts as much as itself).
 * - table: in its play-outs, every seat plays its own profile (fast), itself
 *   included, instead of all as trophy-leaning goal bots. Needs the table's
 *   profiles (BotOptions.table; a little cheating, fine for now).
 * - halve: spend the play-outs (keep × playouts) by successive halving: each
 *   round drops the worse half of the moves, so the best get the most.
 * - draft: in the draft, play out the keeps of its this-many best cards (the
 *   rest of the draft, then the round's play) and keep the best. Needs table.
 * - fit: score positions by the evaluation fitted to how games end
 *   (eval-fit.json, from scripts/fit.mjs), this many points per unit of
 *   log-odds, in place of the hand-built goal value; its goal still steers
 *   only the draft's and the plan's choices. A tuning test.
 * - save: the worth of each sway cube kept in supply (default 0.02).
 * - blend: add the fitted evaluation, this many points per unit of log-odds,
 *   to the goal value (which keeps the goal's own terms).
 * - w2, w3: the island margin's weights on the second and third weakest
 *   colours (default 0.35, 0.12; the weakest counts 1).
 * - all: the counted island margin's weight on every trophy (default 0.02).
 * - soft: widen the spread of every win chance (the ending's, and each
 *   seat's within it) by this factor: the bots' forecasts are over-confident.
 * - keep, playouts: the play-out search's size (default SIM.keep, SIM.playouts);
 *   tune these down for faster tuning runs rather than using a weaker bot.
 * - sets: for the island, value standing (and sway on the board) with the
 *   factions of its weakest colours: the access to the fights that bring them
 *   (IC1), so it builds toward complete sets instead of piling up one colour.
 * @typedef {{ lean: number, jitter: number, hold: number, push: number, margin: number, linear: number, threat: number, hidden?: number, enum?: number, sim?: number, combo?: number, sets?: number, keep?: number, playouts?: number, halve?: number, draft?: number, fit?: number, blend?: number, save?: number, soft?: number, w2?: number, w3?: number, all?: number, table?: number, commit?: number, allies?: number, protect?: number, top?: number, race?: number, spread?: number, field?: number, even?: number, rank?: number, deepRoll?: number, goalFit?: number, guardCap?: number, plan?: number, planBudget?: number, steer?: number, draftPlan?: number }} Persona
 */
/** @type {Record<'trophy' | 'backer', Persona>} */
const PERSONAS = {
  // linear 1: counting island trophies as hunter does closed hunter's lead (challenger 32% against 20%, 2026-10-08).
  // threat 1: trophy players act against a rival pulling ahead with a faction (designer); hunter fell from 41% to 20% against it (2026-10-08).
  // Search switches standard from 2026-10-09 (challengers, 200 games each, seat 5 against backer, backer, goal, goal; an even share 20%):
  // sim 49.9%, sets=2 29.3% (sets=1 26.0%, sets=4 21.0%), enum 24.8%, combo 24.3%, hidden 21.5%; all together 57.9%.
  // table (2026-10-09): a bug fix, not a heuristic: play-outs had every seat, the bot itself included, play as a trophy-leaning goal bot.
  // threat 3 (2026-10-09, 10 games against top=2 backers): trophy 30% a seat (13% at threat 1); they take the lead of the backed faction.
  // even 1 (2026-10-25, challenger, 64 games, seeds 61 and 71): trophy 37% a seat with it against 20%; backer 16% against 12.5%.
  trophy: { lean: -0.3, jitter: 0.15, hold: 0.05, push: 2, margin: 3, linear: 1, threat: 3, hidden: 1, enum: 1, sim: 1, combo: 1, sets: 2, table: 1, even: 1 },
  // protect 4 (2026-10-09, 10 games): presence held at or over the threshold through round 4 (21 against 14).
  // commit 2 with protect: the invaders' ending 5 in 10 (1 in 10 before), final presence 20.3 (10.9).
  // top 2: backers 30% a seat against goal 13% (15% against 23% before), mostly from island wins (10 games).
  // race 2 (against threat-3 trophy bots): backers 20% a seat, trophy 20%; the invaders' ending 4 in 10, backers winning 3 of them (10 games).
  // plan 1, steer 1 (2026-10-27, challengers: rounds 2-3 35% a seat against 10% over 48 games, validation 23% against 15%
  // over 80 games, seed 401). Trophy bots measured no better with them (21/21%, 17/24%, 17/19%), so they don't plan.
  backer: { lean: 0.3, jitter: 0.15, hold: 0.05, push: 2, margin: 3, linear: 1, threat: 1, hidden: 1, enum: 1, sim: 1, combo: 1, sets: 2, table: 1, protect: 4, commit: 2, top: 2, race: 2, even: 1, plan: 1, steer: 1 },
};

/**
 * A profile's persona. For tuning, a profile can also be written
 * "trophy:lean=0,hold=0.1" (or "backer:..."): the base persona with those
 * numbers changed.
 * @param {string} profile @returns {Persona | undefined}
 */
export function personaOf(profile) {
  if (!PERSONA_CACHE.has(profile)) PERSONA_CACHE.set(profile, parsePersona(profile));
  return PERSONA_CACHE.get(profile);
}
/** @type {Map<string, Persona | undefined>} */
const PERSONA_CACHE = new Map();
/** personaOf, unmemoised. @param {string} profile @returns {Persona | undefined} */
function parsePersona(profile) {
  const [base, overrides] = profile.split(':');
  const p = PERSONAS[/** @type {'trophy' | 'backer'} */ (base === 'goal' ? 'trophy' : base)]; // goal: the old name, for saved games
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
 * @param {GameState} state @param {string} pid @param {boolean} [hidden]  persona hidden: count face-down tokens (see projectFights) @param {number} [soft] @param {number[]} [colours] @param {boolean} [field]  persona field
 */
export function winChances(state, pid, hidden = false, soft = 1, colours = ISLAND, field = false) {
  // Memoised per state (a speed-up): goals, values and play-outs ask about the same position many times. Read-only result.
  if (!memoOn()) return chancesNow(state, pid, hidden, soft, colours, field);
  let memo = CHANCES.get(state);
  if (!memo) { memo = new Map(); CHANCES.set(state, memo); }
  const key = `${pid}|${hidden ? 1 : 0}|${soft}|${colours}|${field ? 1 : 0}`;
  let c = memo.get(key);
  if (!c) { c = chancesNow(state, pid, hidden, soft, colours, field); memo.set(key, c); }
  return c;
}
/** @type {WeakMap<object, Map<string, ReturnType<typeof chancesAfter>>>} */
const CHANCES = new WeakMap();
/** The island margin's weights on the weakest three colours (TS2, WT1: the weakest decides, then the next), and on every trophy in the counted margin. */
const ISLAND = [1, 0.35, 0.12, 0.02];
/** @param {Persona} persona */
const coloursOf = (persona) => (persona.w2 === undefined && persona.w3 === undefined && persona.all === undefined ? ISLAND : [1, persona.w2 ?? ISLAND[1], persona.w3 ?? ISLAND[2], persona.all ?? ISLAND[3]]);

/** winChances, uncached. @param {GameState} state @param {string} pid @param {boolean} hidden @param {number} soft @param {number[]} colours @param {boolean} [field] */
function chancesNow(state, pid, hidden, soft, colours, field = false) {
  if (!hidden) return chancesAfter(projectFights(state), pid, soft, colours, field);
  const mine = chancesAfter(projectFights(state, pid, false), pid, soft, colours, field);
  let rival = false;
  for (const loc in state.board) { const tk = state.board[loc].token; if (tk && tk.owner !== pid) { rival = true; break; } }
  if (!rival) return mine;
  const theirs = chancesAfter(projectFights(state, pid, true), pid, soft, colours, field);
  /** @type {Record<string, number>} */ const avg = {};
  const m = /** @type {Record<string, number>} */ (/** @type {unknown} */ (mine)), th = /** @type {Record<string, number>} */ (/** @type {unknown} */ (theirs));
  for (const k in m) avg[k] = (m[k] + th[k]) / 2;
  return /** @type {typeof mine} */ (/** @type {unknown} */ (avg));
}

/**
 * A seat's position as numbers, for fitting the evaluation to how games end
 * (scripts/fit.mjs; tournament logs record it at the start of each round's
 * play). A measuring tool: the bots don't read it.
 * @param {GameState} state @param {string} pid @returns {Record<string, number>}
 */
export function features(state, pid) {
  const c = winChances(state, pid, true);
  const s = projectFights(state, pid, false);
  const p = s.players[pid];
  const t = s.factions.map((f) => p.trophies[f]).sort((x, y) => x - y);
  const others = s.seating.filter((id) => id !== pid);
  const net = (/** @type {string} */ id, /** @type {string} */ f) => (s.players[id].standing[f] ?? 0) - s.players[id].trophies[f];
  const presence = s.factions.map((f) => presenceOf(s, f));
  const top = s.factions[presence.indexOf(Math.max(...presence))];
  const r3 = (/** @type {number} */ x) => Math.round(x * 1000) / 1000;
  return Object.fromEntries(Object.entries({
    pInvaders: c.pInvaders, invWin: c.pInvaders * c.asInvaders, islWin: (1 - c.pInvaders) * c.asIsland, rivalWin: c.pInvaders * c.rivalInvaders, asInvaders: c.asInvaders, asIsland: c.asIsland, marginIsland: c.marginIsland, marginInvaders: c.marginInvaders,
    rivalInvaders: c.rivalInvaders, linearIsland: c.linearIsland, roundsLeft: c.roundsLeft, projected: c.projected - c.threshold,
    weakest: t[0], second: t[1], third: t[2], trophies: t.reduce((a, x) => a + x, 0),
    leadTop: net(pid, top) - Math.max(...others.map((o) => net(o, top))), bestLead: Math.max(...s.factions.map((f) => net(pid, f) - Math.max(...others.map((o) => net(o, f))))),
    standing: s.factions.reduce((a, f) => a + (p.standing[f] ?? 0), 0), supply: p.supply, hand: state.players[pid].hand.length,
    onBoard: Object.values(s.board).reduce((a, place) => a + (place.sway[pid] ?? 0), 0), access: setAccess(state, pid),
  }).map(([k, v]) => [k, r3(v)]));
}

/** winChances on a board whose fights are already projected. @param {GameState} s @param {string} pid @param {number} [soft]  persona soft: widens every chance's spread @param {number[]} [colours]  the island margin's weights on the weakest, second and third colours, and on every trophy @param {boolean} [field]  persona field: beat every rival, not only the best */
function chancesAfter(s, pid, soft = 1, colours = ISLAND, field = false) {
  // Plain loops (a speed-up): the same sums in the same order as before, so the same numbers.
  const roundsLeft = Math.max(0, Number(s.options.rounds) - s.round);
  const threshold = Number(s.options.threshold);
  const grow = growthTotal(s);
  const F = s.factions, nF = F.length, seats = s.seating;
  const presence = F.map((f) => presenceOf(s, f));
  let total = 0;
  for (let i = 0; i < nF; i++) total += presence[i];
  const projected = total + (s.phase === 'play' ? grow : 0);
  const spreadP = soft * (2 + 3 * roundsLeft);
  let top = -Infinity;
  for (let i = 0; i < nF; i++) if (presence[i] > top) top = presence[i];
  const w = presence.map((n) => Math.exp((n - top) / (1.5 + 1.5 * roundsLeft)));
  let wSum = 0;
  for (let i = 0; i < nF; i++) wSum += w[i];
  // Each seat's net standing with each faction, and per faction the best and second best seat (so "the best of the others" is a lookup).
  /** @type {Record<string, number[]>} */
  const nets = {};
  for (const id of seats) { const pl = s.players[id], row = new Array(nF); for (let i = 0; i < nF; i++) row[i] = (pl.standing[F[i]] ?? 0) - pl.trophies[F[i]]; nets[id] = row; }
  const bestA = new Array(nF), bestB = new Array(nF), bestWho = new Array(nF);
  for (let i = 0; i < nF; i++) { let a = -Infinity, b = -Infinity, who = ''; for (const id of seats) { const v = nets[id][i]; if (v > a) { b = a; a = v; who = id; } else if (v > b) b = v; } bestA[i] = a; bestB[i] = b; bestWho[i] = who; }
  const bestOther = (/** @type {string} */ id, /** @type {number} */ i) => (bestWho[i] === id ? bestB[i] : bestA[i]);
  const spreadI = soft * (1 + roundsLeft);
  let asInvaders = 0, marginInvaders = 0;
  for (let i = 0; i < nF; i++) {
    if (field) { let p = 1; for (const o of seats) if (o !== pid) p *= sigmoid((nets[pid][i] - nets[o][i]) / spreadI); asInvaders += (w[i] / wSum) * p; continue; } // beat every rival
    const l = nets[pid][i] - bestOther(pid, i); asInvaders += (w[i] / wSum) * sigmoid(l / spreadI);
  }
  for (let i = 0; i < nF; i++) marginInvaders += (w[i] / wSum) * (nets[pid][i] - bestOther(pid, i));
  // The best rival's chance of leading the winning faction (each rival against everyone else).
  let rivalInvaders = 0;
  /** @type {Record<string, number>} */
  const islOf = {};
  /** @type {Record<string, number>} */
  const allOf = {};
  const t = new Array(nF);
  for (const id of seats) {
    const tr = s.players[id].trophies;
    let sum = 0;
    for (let i = 0; i < nF; i++) { t[i] = tr[F[i]]; sum += t[i]; }
    t.sort((a, b) => a - b);
    islOf[id] = colours[0] * t[0] + colours[1] * t[1] + colours[2] * t[2];
    allOf[id] = islOf[id] + (colours[3] ?? 0.02) * sum;
    if (id === pid) continue;
    let r = 0;
    for (let i = 0; i < nF; i++) r += (w[i] / wSum) * sigmoid((nets[id][i] - bestOther(id, i)) / spreadI);
    if (r > rivalInvaders) rivalInvaders = r;
  }
  let bestIsl = -Infinity, bestAll = -Infinity, backers = 0;
  for (const id of seats) {
    if (id === pid) continue;
    if (islOf[id] > bestIsl) bestIsl = islOf[id];
    if (allOf[id] > bestAll) bestAll = allOf[id];
    let m = -Infinity;
    for (let i = 0; i < nF; i++) if (nets[id][i] > m) m = nets[id][i];
    if (m >= TABLE.backing) backers += 1;
  }
  const marginIsland = islOf[pid] - bestIsl;
  const linearIsland = allOf[pid] - bestAll; // the island margin, counted directly
  const spreadT = soft * (0.6 + 0.8 * roundsLeft);
  let asIsland = sigmoid(marginIsland / spreadT);
  if (field) { asIsland = 1; for (const o of seats) if (o !== pid) asIsland *= sigmoid((islOf[pid] - islOf[o]) / spreadT); } // beat every rival
  const prior = Math.min(0.9, Math.max(0.1, TABLE.base + TABLE.step * backers));
  const rounds = Number(s.options.rounds);
  const known = rounds > 1 ? Math.min(1, (s.round - 1) / (rounds - 1)) : 1; // how much presence says by now
  const pInvaders = (1 - known) * prior + known * sigmoid((projected - threshold - 0.5) / spreadP);
  return { pInvaders, prior, known, backers, linearIsland, rivalInvaders, asInvaders, asIsland, marginInvaders, marginIsland, projected, threshold, spreadP, roundsLeft };
}

/** A goal bot's value: its win chance, weighted toward its goal, plus its margins. @param {GameState} state @param {string} pid @param {Goal} goal @param {Persona} persona */
function goalValue(state, pid, goal, persona, quick = false) {
  if (persona.fit) { const v = fitValue(state, pid); if (v !== null) return persona.fit * v + 0.02 * state.players[pid].supply; }
  // quick (persona rank): the board as it stands, fights not projected; a cheap first look, not the bot's judgement.
  const c = quick ? chancesAfter(state, pid, persona.soft ?? 1, coloursOf(persona), !!persona.field) : winChances(state, pid, !!persona.hidden, persona.soft ?? 1, coloursOf(persona), !!persona.field);
  // Margins are added on their own, never scaled by an ending's chance: a margin can be negative, and scaling it would
  // reward a bot that is behind for making that ending less likely (2026-10-08 fix).
  const inv = c.pInvaders * 10 * c.asInvaders + persona.margin * c.marginInvaders;
  const islandMargin = persona.linear * 10 * c.linearIsland;
  const isl = (1 - c.pInvaders) * 10 * c.asIsland + islandMargin;
  const threat = (persona.threat ?? 0) * 10 * c.pInvaders * c.rivalInvaders;
  const guard = persona.protect && goal === 'invaders' ? persona.protect * presenceGuard(state, pid, c, persona) : 0;
  const fitted = persona.blend ? persona.blend * (fitValue(state, pid) ?? 0) : 0;
  return (goal === 'invaders' ? inv + guard : isl + (persona.sets ? persona.sets * (1 - c.pInvaders) * setAccess(state, pid) : 0)) - threat + (persona.save ?? 0.02) * state.players[pid].supply + fitted;
}

/**
 * Each ending's fitted chance of this seat winning by it (persona goalFit): island and invaders, from goal-fit.json for
 * this round; null when there is no fit for the round. @param {GameState} state @param {string} pid
 */
function endingChances(state, pid) {
  const data = /** @type {{ names: string[], rounds: Record<string, { mean: number[], sd: number[], isl: number[], inv: number[] }> }} */ (goalFitData);
  const m = data.rounds[String(state.round)];
  if (!m) return null;
  const f = /** @type {Record<string, number>} */ (features(state, pid));
  const x = data.names.map((k, j) => ((f[k] ?? 0) - m.mean[j]) / m.sd[j]);
  const p = (/** @type {number[]} */ w) => sigmoid(w[0] + x.reduce((a, v, j) => a + v * w[j + 1], 0));
  return { isl: p(m.isl), inv: p(m.inv) };
}

/**
 * The fitted evaluation (persona fit): the log-odds of winning from this
 * seat's features, by the weights fitted for this round (a play-out ends
 * after the round's fights, in the next round). Null at the game's end, where
 * the hand-built value counts the result, and with no fit for the round.
 * @param {GameState} state @param {string} pid @returns {number | null}
 */
function fitValue(state, pid) {
  const rounds = /** @type {Record<string, { mean: number[], sd: number[], w: number[] }>} */ (evalFit.rounds);
  const m = state.phase === 'ended' ? undefined : rounds[String(state.round)];
  if (!m) return null;
  const f = features(state, pid);
  return /** @type {string[]} */ (evalFit.names).reduce((a, k, j) => a + m.w[j] * ((f[k] ?? 0) - m.mean[j]) / m.sd[j], 0);
}

/**
 * Guarding presence (persona protect), for a bot backing a faction: the
 * projected presence's margin over the threshold (this round's fights and
 * growth counted), in units of 5 tokens and capped at ±3, plus its backed
 * faction's own presence (the faction it leads by the most). Counted at full
 * weight from round 1: the early rounds are when presence is lost.
 * @param {GameState} state @param {string} pid @param {ReturnType<typeof winChances>} c @param {Persona} persona
 */
function presenceGuard(state, pid, c, persona) {
  const p = state.players[pid];
  const others = state.seating.filter((id) => id !== pid);
  const lead = (/** @type {string} */ f) => ((p.standing[f] ?? 0) - p.trophies[f]) - Math.max(...others.map((o) => (state.players[o].standing[f] ?? 0) - state.players[o].trophies[f]));
  const backed = state.factions.slice().sort((a, b) => lead(b) - lead(a))[0];
  const cap = persona.guardCap ?? 3; // guardCap (2026-10-26): at 3, presence 15 over the threshold already saturated, so early losses went unseen
  const margin = Math.max(-cap, Math.min(cap, (c.projected - c.threshold) / 5));
  // top: the invaders' ending is won by the faction with the most presence (TH1), so its backed faction must be that one.
  const rivalTop = Math.max(...state.factions.filter((f) => f !== backed).map((f) => presenceOf(state, f)));
  const ahead = Math.max(-2, Math.min(2, (presenceOf(state, backed) - rivalTop) / 3));
  // race: once presence is safe, everything rides on leading the faction's standing; weight that lead by how safe presence is.
  const safe = sigmoid((c.projected - c.threshold - 3) / 2);
  const race = (persona.race ?? 0) * safe * Math.max(-3, Math.min(3, lead(backed) / 2));
  return margin + 0.1 * presenceOf(state, backed) + (persona.top ?? 0) * ahead + race;
}

/**
 * Access to the colours a player is short of (persona sets): for each faction,
 * how much its colour is needed (the weakest counts most, as the island
 * ending does, TS2/WT1) times the standing and board sway the player
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
  const onBoard = (/** @type {string} */ f) => Object.values(state.board).reduce((n, place) => n + ((place.tokens[f] ?? 0) > 0 ? place.sway[pid] ?? 0 : 0), 0);
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
  const c = winChances(state, pid, !!persona.hidden, persona.soft ?? 1, coloursOf(persona), !!persona.field);
  const push = persona.push * (c.roundsLeft + 1);
  // allies: the rivals seen backing a faction push presence up too, so the invaders' ending is more reachable than one player's push.
  const pushInv = push * (1 + (persona.allies ?? 0) * c.backers);
  const reachInv = (1 - c.known) * Math.min(1, c.prior + 0.15) + c.known * sigmoid((c.projected - c.threshold - 0.5 + pushInv) / c.spreadP);
  const reachIsl = (1 - c.known) * Math.min(1, 1 - c.prior + 0.15) + c.known * (1 - sigmoid((c.projected - c.threshold - 0.5 - push) / c.spreadP));
  const fitted = persona.goalFit ? endingChances(state, pid) : null;
  const evidence = fitted ? fitted.inv - fitted.isl : reachInv * c.asInvaders - reachIsl * c.asIsland;
  if (memory && memory.jitter === undefined) memory.jitter = (rng() * 2 - 1) * persona.jitter; // this game's play style
  const score = evidence + (persona.lean + (memory?.jitter ?? 0)) * (1 - c.known);
  const held = memory?.goal;
  if (fitted && held === 'invaders' && persona.commit && fitted.isl < persona.commit * fitted.inv) return (memory && (memory.goal = 'invaders'), 'invaders'); // commit, on the fitted chances
  /** @type {Goal} */
  let goal = score > (held === 'invaders' ? -persona.hold : held === 'island' ? persona.hold : 0) ? 'invaders' : 'island';
  // commit: a bot backing a faction abandons it only for an island chance at least `commit` times its invader chance.
  if (held === 'invaders' && goal === 'island' && persona.commit && reachIsl * c.asIsland < persona.commit * reachInv * c.asInvaders) goal = 'invaders';
  if (memory) memory.goal = goal;
  return goal;
}

// ---------------------------------------------------------------------------
// Choosing a move
// ---------------------------------------------------------------------------

/** Every move worth considering on this bot's turn. @param {GameState} state @param {string} pid @param {() => number} rng */
function candidates(state, pid, rng, targets = SEARCH.targets, list = false, even = false, quick = /** @type {((s: GameState) => number) | null} */ (null), steer = /** @type {((s: GameState) => number) | null} */ (null)) {
  const p = state.players[pid];
  /** @type {Move[]} */
  const moves = [{ type: 'pass' }];
  for (const cardId of new Set(p.hand)) {
    const card = cardById(cardId);
    if (card.suit) {
      const spots = swaySpots(state, cardId);
      if (spots.length) for (const location of spots) moves.push({ type: 'play', card: cardId, use: 'sway', location });
      else moves.push({ type: 'play', card: cardId, use: 'sway' });
      // A way back (2026-10-26): at each spot 1 token, or all of them; and one spread over the spots.
      const back = returnRoom(state, pid, cardId);
      if (back.max > 0) {
        /** @type {string[][]} */ const ways = [];
        for (const l of back.spots) { ways.push([l]); if (back.max > 1) ways.push(Array(back.max).fill(l)); }
        if (back.spots.length > 1 && back.max > 1) ways.push(back.spots.slice(0, back.max));
        for (const places of ways) moves.push({ type: 'play', card: cardId, use: 'return', places });
      }
    }
    if (!card.action) continue;
    /** @type {Set<string>} */
    const seen = new Set();
    /** @type {ReturnType<typeof listTargets> | null} */
    let listed = null;
    if (list && steer && !listTargets(state, pid, cardId, LIST.cap + 1, even).complete) {
      // persona steer: the listing spent best first, where the bot's own value says the card's worth lies.
      for (const target of steered(state, pid, cardId, rng, steer, LIST.cap)) { const k = JSON.stringify(target); if (seen.has(k)) continue; seen.add(k); moves.push({ type: 'play', card: cardId, use: 'action', target }); }
      targets += seen.size;
    }
    if (list && quick) {
      // persona rank: list wide, keep the likeliest by a quick score, plus a few others at random.
      const wide = listTargets(state, pid, cardId, RANK.list, even);
      if (wide.complete && wide.targets.length <= LIST.cap) listed = wide; // all of it fits: the same list as the plain listing, made once
      else if (wide.targets.length > LIST.cap) {
        const scored = wide.targets.map((target) => /** @type {Move} */ ({ type: 'play', card: cardId, use: 'action', target }))
          .filter((move) => validate(state, { playerId: pid, move }).ok) // only plays legal now (the opener must open with the marked card)
          .map((move) => ({ target: /** @type {any} */ (move).target, v: quick(after(state, pid, move)) })).sort((a, b) => b.v - a.v);
        const rest = scored.slice(RANK.top);
        const picks = [...scored.slice(0, RANK.top), ...Array.from({ length: Math.min(RANK.random, rest.length) }, () => rest.splice(Math.floor(rng() * rest.length), 1)[0])];
        for (const { target } of picks) { seen.add(JSON.stringify(target)); moves.push({ type: 'play', card: cardId, use: 'action', target }); }
        if (wide.complete) continue;
        targets += seen.size;
      }
    }
    if (list && !seen.size) {
      const l = listed ?? listTargets(state, pid, cardId, LIST.cap, even);
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

/**
 * Best-first targets for a card (persona steer): each branch of its choice tree gets a couple of random completions,
 * scored by the bot's own value; the most promising open branch is opened next, until `budget` targets are scored.
 * Returns them, best first. Tuning, not rules.
 * @param {GameState} state @param {string} pid @param {string} cardId @param {() => number} rng @param {(s: GameState) => number} value @param {number} budget
 */
function steered(state, pid, cardId, rng, value, budget) {
  /** @type {Map<string, { target: Target, v: number }>} */
  const found = new Map();
  const score = (/** @type {Target} */ target) => {
    const k = JSON.stringify(target);
    const hit = found.get(k);
    if (hit) return hit.v;
    const move = /** @type {Move} */ ({ type: 'play', card: cardId, use: 'action', target });
    if (!validate(state, { playerId: pid, move }).ok) return -Infinity;
    const v = value(after(state, pid, move));
    found.set(k, { target, v });
    return v;
  };
  /** @type {{ t: Target, v: number }[]} */
  const open = [];
  const look = (/** @type {Target} */ t) => {
    const { done, next } = choiceSteps(state, pid, cardId, t);
    for (const d of done) score(d);
    for (const n of next) {
      let v = -Infinity;
      for (let i = 0; i < 2 && found.size < budget; i++) { const c = completeTarget(state, pid, cardId, n, rng); if (c) v = Math.max(v, score(c)); }
      if (v > -Infinity) open.push({ t: n, v });
    }
  };
  look({});
  for (let guard = 0; guard < 200 && found.size < budget && open.length; guard++) {
    open.sort((a, b) => b.v - a.v);
    look(/** @type {{ t: Target }} */ (open.shift()).t);
  }
  return [...found.values()].sort((a, b) => b.v - a.v).map((x) => x.target);
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
    const n = p.kept.length + 1;
    if (persona?.draftPlan && worth.length > n) {
      const top = worth.slice(0, n).map((w) => w.cardId);
      const keeps = [top, ...worth.slice(n, n + DRAFT_PLAN.swaps).map((w) => [...top.slice(0, n - 1), w.cardId])];
      const table = persona.table ? { profiles: { ...seats.profiles, [pid]: String(profile) }, memories: seats.memories } : undefined;
      let best = keeps[0], bestV = -Infinity;
      for (const keep of keeps) { const v = handPlanValue(state, pid, keep, rng, ev, memory, table); if (v > bestV) { best = keep; bestV = v; } }
      return legal(state, pid, { type: 'pick', keep: best });
    }
    if (persona?.draft && persona.table && worth.length > n) return draftPick(state, pid, rng, worth.map((w) => w.cardId), n, ev, memory, persona, { profiles: { ...seats.profiles, [pid]: String(profile) }, memories: seats.memories });
    return legal(state, pid, { type: 'pick', keep: worth.slice(0, n).map((w) => w.cardId) });
  }

  if (state.phase === 'growth') {
    const g = state.growing;
    if (!g || g.leaders[g.next % g.leaders.length] !== pid) return null;
    const options = Object.keys(g.due).map((location) => ({ location, v: value(applyMove(state, { playerId: pid, move: { type: 'grow', location } })) }));
    options.sort((a, b) => b.v - a.v);
    return { type: 'grow', location: options[0].location };
  }

  if (state.phase === 'night') {
    // Night Terrors' nightfall: at the first mark left, the flight (or none) worth the most now.
    const n = state.night;
    if (!n || n.player !== pid) return null;
    const options = nightMoves(state, n.left[0]).map((move) => ({ move, v: value(applyMove(state, { playerId: pid, move })) }));
    options.sort((a, b) => b.v - a.v);
    return options[0].move;
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
  const moves = candidates(state, pid, rng, SEARCH.targets, !!persona?.enum, !!persona?.even, persona?.rank ? (s) => evaluate(s, pid, profile, goal, true) : null, persona?.steer ? ev : null);
  if (persona?.sim && persona.plan) return planPick(state, pid, rng, moves, ev, memory, persona.keep ?? SIM.keep, persona.planBudget ?? PLAN.budget, persona.table ? { profiles: { ...seats.profiles, [pid]: String(profile) }, memories: seats.memories, deep: !!persona.deepRoll } : undefined);
  if (persona?.sim) return simPick(state, pid, rng, moves, ev, memory, persona.keep ?? SIM.keep, persona.playouts ?? SIM.playouts, persona.table ? { profiles: { ...seats.profiles, [pid]: String(profile) }, memories: seats.memories, deep: !!persona.deepRoll } : undefined, persona.halve ?? 0, !!persona.spread);
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
 * The play-out search (persona sim): its best moves one move ahead (passing
 * always among them), each played out to the end of the round's play by
 * standard goal bots several times, scored for this bot at the end. Each
 * playout's randomness is shared across the moves, so they meet the same
 * futures. Passing and holding a card are judged like any other move.
 * @param {GameState} state @param {string} pid @param {() => number} rng @param {Move[]} moves @param {Ev} ev @param {BotMemory} [memory] @param {number} [keep] @param {number} [playouts] @param {Seats} [table]  persona table: each seat's profile (played fast) and memory, in the play-outs @param {number} [halve]  persona halve: successive halving over `keep` moves @param {boolean} [spread]  persona spread: every card in hand gets its best move into the play-outs
 */
function simPick(state, pid, rng, moves, ev, memory, keep = SIM.keep, playouts = SIM.playouts, table = undefined, halve = 0, spread = false) {
  const ranked = moves.map((move) => { const s = after(state, pid, move); return { move, s, v: ev(s) }; }).sort((a, b) => b.v - a.v);
  // spread: the best move of each card in hand first (its action, else its sway), then the best of the rest.
  const firsts = spread ? [...new Set(ranked.flatMap((r) => (r.move.type === 'play' ? [r.move.card] : [])))].map((c) => /** @type {typeof ranked[number]} */ (ranked.find((r) => r.move.type === 'play' && r.move.card === c))) : [];
  const short = spread ? [...firsts, ...ranked.filter((r) => !firsts.includes(r))].slice(0, Math.max(keep, firsts.length)) : ranked.slice(0, keep);
  if (spread) short.sort((a, b) => b.v - a.v);
  const pass = ranked.find((r) => r.move.type === 'pass');
  if (pass && !short.includes(pass)) short.push(pass);
  if (halve && short.length > 2) return halvingPick(short, pid, rng, ev, memory, keep * playouts, table);
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

/**
 * Hand planning (persona plan): the best `keep` first moves one move ahead (passing always among them), each with
 * every plan for the cards left in hand (none; one card next; two cards in order), as (move, plan) pairs; play-outs
 * keep to the plan. Successive halving over the pairs, shared seeds. Tuning, not rules.
 * @param {GameState} state @param {string} pid @param {() => number} rng @param {Move[]} moves @param {Ev} ev @param {BotMemory | undefined} memory @param {number} keep @param {number} budget @param {Seats} [table]
 */
function planPick(state, pid, rng, moves, ev, memory, keep, budget, table) {
  const ranked = moves.map((move) => { const s = after(state, pid, move); return { move, s, v: ev(s) }; }).sort((a, b) => b.v - a.v);
  const short = ranked.slice(0, keep);
  const pass = ranked.find((r) => r.move.type === 'pass');
  if (pass && !short.includes(pass)) short.push(pass);
  // First, as the plain search does: every first move gets its play-outs with no plan (the same seeds), so planning
  // only adds to what the bot would see anyway (2026-10-27: spread thin, good first moves were dropped on bad luck).
  const seeds = Array.from({ length: SIM.playouts }, () => Math.floor(rng() * 2 ** 31));
  const plain = short.map(({ move, s }) => ({ move, s, v: seeds.reduce((n, seed) => n + ev(playOutRound(s, seed, pid, memory, table)), 0) / seeds.length }));
  plain.sort((a, b) => b.v - a.v);
  // Then plans for the cards left, for the best few first moves, by successive halving; a plan wins only if it beats
  // the best plain value.
  /** @type {{ move: Move, s: GameState, plan: string[] }[]} */
  const arms = [];
  for (const { move, s } of plain.slice(0, PLAN.moves)) {
    const left = [...new Set(s.players[pid].hand)];
    for (const a of left) {
      arms.push({ move, s, plan: [a] });
      if (PLAN.depth > 1) for (const b of left) if (b !== a) arms.push({ move, s, plan: [a, b] });
    }
  }
  if (!arms.length) return plain[0]?.move ?? null;
  const planned = halvingBest(arms, pid, rng, ev, memory, budget, table);
  // Like for like (2026-10-27): the winning plan, chosen from many pairs, is lucky by selection; scored again on the
  // plain search's seeds, it must still beat the best plain move.
  const arm = /** @type {{ move: Move, s: GameState, plan: string[] }} */ (arms.find((x) => x.move === planned.move && x.plan === planned.plan) ?? arms.find((x) => x.move === planned.move));
  const fair = seeds.reduce((n, seed) => n + ev(playOutRound(arm.s, seed, pid, memory, table, false, arm.plan)), 0) / seeds.length;
  PLAN_STATS.decisions += 1;
  if (fair > plain[0].v) { PLAN_STATS.planned += 1; if (planned.move !== plain[0].move) PLAN_STATS.changed += 1; PLAN_STATS.gain += fair - plain[0].v; }
  PLAN_STATS.lucky += planned.v - fair;
  return fair > plain[0].v ? planned.move : plain[0].move;
}

/**
 * A hand's worth by planning it (persona draftPlan): as if play began now with `hand` (the others holding what they
 * have kept), the best (first move, plan) pair's mean played-out value, by successive halving. Tuning, not rules.
 * @param {GameState} state @param {string} pid @param {string[]} hand @param {() => number} rng @param {Ev} ev @param {BotMemory | undefined} memory @param {Seats} [table]
 */
function handPlanValue(state, pid, hand, rng, ev, memory, table) {
  const s = cloneState(state);
  s.phase = 'play';
  s.turn = s.seating.indexOf(pid);
  s.opened = true;
  s.pending = null;
  for (const id of s.seating) s.players[id].hand = id === pid ? hand.slice() : s.players[id].kept.slice();
  const moves = candidates(s, pid, rng, SEARCH.targets, true, true);
  const ranked = moves.map((move) => { const t = after(s, pid, move); return { move, s: t, v: ev(t) }; }).sort((a, b) => b.v - a.v).slice(0, 4);
  /** @type {{ move: Move, s: GameState, plan: string[] }[]} */
  const arms = [];
  for (const { move, s: t } of ranked) {
    const left = [...new Set(t.players[pid].hand)];
    arms.push({ move, s: t, plan: [] });
    for (const a of left) { arms.push({ move, s: t, plan: [a] }); for (const b of left) if (b !== a) arms.push({ move, s: t, plan: [a, b] }); }
  }
  if (!arms.length) return ev(s);
  return halvingValue(arms, pid, rng, ev, memory, DRAFT_PLAN.budget, table);
}

/**
 * Successive halving that returns the best arm and its mean value. @param {{ move: Move, s: GameState, plan?: string[] }[]} arms @param {string} pid @param {() => number} rng @param {Ev} ev @param {BotMemory | undefined} memory @param {number} budget @param {Seats} [table]
 * @returns {{ move: Move, v: number, plan?: string[] }}
 */
function halvingBest(arms, pid, rng, ev, memory, budget, table) {
  const rounds = Math.max(1, Math.ceil(Math.log2(arms.length)));
  /** @type {number[]} */
  const seeds = [];
  let alive = arms.map((a) => ({ ...a, total: 0, n: 0 }));
  for (let r = 0; r < rounds; r++) {
    const each = Math.max(1, Math.floor(budget / (alive.length * rounds)));
    const upto = alive[0].n + each;
    while (seeds.length < upto) seeds.push(Math.floor(rng() * 2 ** 31));
    for (const a of alive) for (; a.n < upto; a.n++) a.total += ev(playOutRound(a.s, seeds[a.n], pid, memory, table, false, a.plan));
    alive.sort((x, y) => y.total / y.n - x.total / x.n);
    if (alive.length > 1) alive = alive.slice(0, Math.ceil(alive.length / 2));
  }
  return { move: alive[0].move, v: alive[0].total / alive[0].n, plan: alive[0].plan };
}

/**
 * Successive halving that returns the best arm's mean value (for planning in the draft). @param {{ move: Move, s: GameState, plan?: string[] }[]} arms @param {string} pid @param {() => number} rng @param {Ev} ev @param {BotMemory | undefined} memory @param {number} budget @param {Seats} [table]
 */
function halvingValue(arms, pid, rng, ev, memory, budget, table) {
  const rounds = Math.max(1, Math.ceil(Math.log2(arms.length)));
  /** @type {number[]} */
  const seeds = [];
  let alive = arms.map((a) => ({ ...a, total: 0, n: 0 }));
  for (let r = 0; r < rounds; r++) {
    const each = Math.max(1, Math.floor(budget / (alive.length * rounds)));
    const upto = alive[0].n + each;
    while (seeds.length < upto) seeds.push(Math.floor(rng() * 2 ** 31));
    for (const a of alive) for (; a.n < upto; a.n++) a.total += ev(playOutRound(a.s, seeds[a.n], pid, memory, table, false, a.plan));
    alive.sort((x, y) => y.total / y.n - x.total / x.n);
    if (alive.length > 1) alive = alive.slice(0, Math.ceil(alive.length / 2));
  }
  return alive[0].total / alive[0].n;
}

/**
 * The planned card's move in a play-out (persona plan): its best play now (its action on sampled targets, its sway,
 * bringing its faction back) by the bot's own value one move ahead; null if it can't be played.
 * @param {GameState} s @param {string} pid @param {string} card @param {() => number} rng @param {string} profile @param {BotMemory | undefined} memory
 */
function plannedMove(s, pid, card, rng, profile, memory) {
  // Listed targets, shared across a card's uses (enum + even), as the bot itself chooses: sampled targets misplayed the big multi-use cards (designer, 2026-10-26).
  const options = candidates(s, pid, rng, SEARCH.targets, true, true).filter((m) => m.type === 'play' && m.card === card);
  let best = null, bestV = -Infinity;
  for (const m of options) { const v = evaluate(after(s, pid, m), pid, profile, memory?.goal); if (v > bestV) { best = m; bestV = v; } }
  return best;
}

/**
 * Successive halving (persona halve): the same play-outs as the plain search
 * (keep × playouts), spent in rounds; after each, the worse half of the moves
 * is dropped, so the close calls among the best get the most play-outs. Every
 * move meets the same futures (seeds in the same order), so the comparisons
 * stay paired. Tuning, not rules.
 * @param {{ move: Move, s: GameState }[]} arms @param {string} pid @param {() => number} rng @param {Ev} ev @param {BotMemory | undefined} memory @param {number} budget @param {Seats} [table]
 */
function halvingPick(arms, pid, rng, ev, memory, budget, table) {
  if (arms.length === 1) return arms[0].move;
  const rounds = Math.ceil(Math.log2(arms.length));
  /** @type {number[]} */
  const seeds = [];
  let alive = arms.map((a) => ({ ...a, total: 0, n: 0 }));
  for (let r = 0; r < rounds && alive.length > 1; r++) {
    const each = Math.max(1, Math.floor(budget / (alive.length * rounds)));
    const upto = alive[0].n + each;
    while (seeds.length < upto) seeds.push(Math.floor(rng() * 2 ** 31));
    for (const a of alive) for (; a.n < upto; a.n++) a.total += ev(playOutRound(a.s, seeds[a.n], pid, memory, table, false, /** @type {any} */ (a).plan));
    alive.sort((x, y) => y.total / y.n - x.total / x.n);
    alive = alive.slice(0, Math.ceil(alive.length / 2));
  }
  return alive[0].move;
}

/**
 * The draft's play-out search (persona draft): the `draft` best cards by their
 * worth now, each kept with the best others, and each keep played out by the
 * table (the rest of the draft, then the round's play), scored for this bot
 * at the end. Shared seeds, as in the play's search. Tuning, not rules.
 * @param {GameState} state @param {string} pid @param {() => number} rng @param {string[]} ranked  the pool, best first @param {number} n  cards to keep
 * @param {Ev} ev @param {BotMemory | undefined} memory @param {Persona} persona @param {Seats} table
 */
function draftPick(state, pid, rng, ranked, n, ev, memory, persona, table) {
  /** @type {Map<string, string[]>} */
  const keeps = new Map();
  for (const c of ranked.slice(0, persona.draft ?? 3)) {
    const keep = [c, ...ranked.filter((x) => x !== c).slice(0, n - 1)];
    keeps.set([...keep].sort().join(','), keep);
  }
  const seeds = Array.from({ length: persona.playouts ?? SIM.playouts }, () => Math.floor(rng() * 2 ** 31));
  let best = ranked.slice(0, n), bestV = -Infinity;
  for (const keep of keeps.values()) {
    const s = applyMove(state, { playerId: pid, move: { type: 'pick', keep } });
    let total = 0;
    for (const seed of seeds) total += ev(playOutRound(s, seed, pid, memory, table, true));
    if (total > bestV) { best = keep; bestV = total; }
  }
  return legal(state, pid, { type: 'pick', keep: best });
}

/** Fast bots play from here to the end of this round's play: each seat's own profile (persona table) or ROLLOUT. @param {GameState} state @param {number} seed @param {string} pid @param {BotMemory} [memory] @param {Seats} [table] @param {boolean} [through]  from the draft, on through the round's play */
function playOutRound(state, seed, pid, memory, table = undefined, through = false, plan = /** @type {string[] | undefined} */ (undefined)) {
  const todo = plan ? plan.slice() : [];
  let x = seed | 0;
  const r = () => { x = (Math.imul(x, 1664525) + 1013904223) | 0; return (x >>> 0) / 2 ** 32; };
  /** @type {Record<string, BotMemory>} */
  // Each seat keeps the plan it holds (persona table: every seat's memory; otherwise only this bot's own).
  const mem = Object.fromEntries(state.seating.map((id) => [id, id === pid && memory ? { ...memory } : { ...(table?.memories?.[id] ?? {}) }]));
  let s = state;
  const round = s.round;
  // through (the draft's search): from the draft on, through this round's play.
  const going = through ? () => s.phase !== 'ended' && s.round === round : () => s.phase === 'play' && s.round === round;
  for (let n = 0; n < SIM.maxMoves && going(); n++) {
    let moved = false;
    for (const id of s.seating) {
      const profile = table?.profiles?.[id] ? (table.deep ? fastListing(table.profiles[id]) : fast(table.profiles[id])) : ROLLOUT;
      let m = null;
      // persona plan: on its own turns this bot plays its planned cards in order, each as well as it can then.
      if (id === pid && todo.length && s.phase === 'play' && !s.pending && s.seating[s.turn] === pid) {
        while (todo.length && !m) { const c = /** @type {string} */ (todo.shift()); if (s.players[pid].hand.includes(c)) m = plannedMove(s, pid, c, r, profile, mem[id]); }
        // Flexible (2026-10-27): the planned card is played only if it is at least as good one move ahead as what the
        // bot would do anyway; otherwise the plan waits.
        if (m) {
          const own = playMove(s, id, r, profile, mem[id]);
          const v = (/** @type {Move} */ x) => evaluate(after(s, pid, x), pid, profile, mem[id]?.goal);
          if (own && own.type === 'play' && v(own) > v(m)) { todo.unshift(/** @type {any} */ (m).card); m = own; PLAN_STATS.dropped += 1; } else PLAN_STATS.followed += 1;
        }
      }
      m ??= playMove(s, id, r, profile, mem[id]);
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
  const s = clone(state);
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
    const s = cloneState(state);
    s.phase = 'play';
    s.turn = s.seating.indexOf(pid);
    s.opened = true;
    s.pending = null;
    s.players[pid].hand = [k, cardId];
    const firsts = bestPlays(s, pid, k, rng, ev);
    if (!firsts.length) continue;
    const alone = firsts[0].v;
    for (const f of firsts.slice(0, 2)) {
      const s2 = cloneState(f.s);
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

// ---------------------------------------------------------------------------
// Hints (designer, 2026-10-11: a suggestion mode outside multiplayer games)
// ---------------------------------------------------------------------------

/**
 * The bot's view of a seat's options, for a hint (public/hints.js): its plan
 * and every move ranked by its value one move ahead, with no noise and no
 * play-outs (play-outs would play rivals' hidden hands; one move ahead uses
 * only what the seat can see, rivals' face-down tokens as even odds). Draft:
 * each card in the pool by the worth of its best play now. Growth: each
 * location the seat may choose. `memory` keeps the plan between hints.
 * @param {GameState} state @param {string} pid @param {BotMemory} memory @param {string} [profile]
 * @returns {{ goal: Goal, ev: (s: GameState) => number, base: number, moves: { move: Move, s: GameState, v: number }[], worth: { card: string, v: number }[] }}
 */
export function rankForHint(state, pid, memory, profile = 'trophy:hidden=1,enum=1') {
  let x = 12345;
  const rng = () => { x = (Math.imul(x, 1664525) + 1013904223) | 0; return (x >>> 0) / 2 ** 32; };
  const persona = personaOf(profile) ?? /** @type {Persona} */ (personaOf('trophy'));
  if (memory.jitter === undefined) memory.jitter = 0; // no random lean in a hint
  const goal = chooseGoal(state, pid, persona, memory, rng);
  const ev = (/** @type {GameState} */ s) => evaluate(s, pid, profile, goal);
  const base = ev(state);
  /** @type {{ move: Move, s: GameState, v: number }[]} */
  let moves = [];
  /** @type {{ card: string, v: number }[]} */
  let worth = [];
  const p = state.players[pid];
  if (state.phase === 'draft' && !p.picked) {
    worth = [...p.kept, ...p.batch].map((card) => ({ card, v: cardWorth(state, pid, card, rng, ev, base) })).sort((a, b) => b.v - a.v);
  } else if (state.phase === 'growth') {
    const g = state.growing;
    if (g && g.leaders[g.next % g.leaders.length] === pid) moves = Object.keys(g.due).map((location) => { const move = /** @type {Move} */ ({ type: 'grow', location }); const s = applyMove(state, { playerId: pid, move }); return { move, s, v: ev(s) }; });
  } else if (state.phase === 'night') {
    const n = state.night;
    if (n && n.player === pid) moves = nightMoves(state, n.left[0]).map((move) => { const s = applyMove(state, { playerId: pid, move }); return { move, s, v: ev(s) }; });
  } else if (state.phase === 'play' && !state.pending && state.seating[state.turn] === pid) {
    moves = candidates(state, pid, rng, SEARCH.targets, true).map((move) => { const s = after(state, pid, move); return { move, s, v: ev(s) }; });
  }
  moves.sort((a, b) => b.v - a.v);
  return { goal, ev, base, moves, worth };
}

/** A state after a move played straight through (for hints). @param {GameState} state @param {string} pid @param {Move} move */
export const afterMove = (state, pid, move) => after(state, pid, move);

/** Night Terrors' nightfall: every choice at one mark (let them be, or 1 token to a neighbour, the sway following or not). @param {GameState} state @param {string} loc @returns {Move[]} */
function nightMoves(state, loc) {
  /** @type {Move[]} */
  const out = [{ type: 'flee', location: loc }];
  for (const o of fleeOptions(state, loc)) for (const to of o.to) for (const follow of [false, true]) out.push({ type: 'flee', location: loc, faction: o.faction, to, follow });
  return out.filter((m) => !('follow' in m && m.follow) || (state.board[loc].sway[/** @type {NonNullable<GameState['night']>} */ (state.night).player] ?? 0) > 0);
}
