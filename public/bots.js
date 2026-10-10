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
 *              sampled targets, its influence, and passing; with the
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
  cardById, clone, memoising, memoOn, resolveFights, sampleTarget, listTargets, playableResponses, validate, applyMove, totalPresence, presenceOf, influenceSpots, growthDue,
} from './engine.js';
import evalFit from './eval-fit.json' with { type: 'json' };

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
/** @typedef {'trophy' | 'backer'} Profile */
/** @typedef {{ rng: () => number, profile?: Profile, memory?: BotMemory, table?: Record<string, string>, memories?: Record<string, BotMemory> }} BotOptions  table, memories: every seat's profile and memory, for play-outs (persona table) */
/** @typedef {{ profiles?: Record<string, string>, memories?: Record<string, BotMemory>, deep?: number }} Seats  the table as a play-out sees it (deep: persona deep) */
/** What a bot remembers between its turns: its goal, and this game's variation in its lean. The caller keeps one per seat; a bot without it has no hysteresis. @typedef {{ goal?: Goal, jitter?: number }} BotMemory */
/** @typedef {'island' | 'invaders'} Goal */

export const PROFILES = /** @type {Profile[]} */ (['trophy', 'backer']);

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
  const s = clone({ ...state, log: [], events: [] }); // the log is not read here, and copying it was most of the cost
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
export function evaluate(state, pid, profile = 'trophy', goal = undefined) {
  const persona = personaOf(profile);
  return goalValue(state, pid, goal ?? 'island', persona ?? PERSONAS.trophy);
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
 * - deep: play-outs go on this many rounds past this one (drafts included;
 *   the next deals drawn at random per play-out), so the value at
 *   their end is read later, or from the game's result. Needs table.
 * - fit: score positions by the evaluation fitted to how games end
 *   (eval-fit.json, from scripts/fit.mjs), this many points per unit of
 *   log-odds, in place of the hand-built goal value; its goal still steers
 *   only the draft's and the plan's choices. A tuning test.
 * - save: the worth of each influence cube kept in supply (default 0.02).
 * - blend: add the fitted evaluation, this many points per unit of log-odds,
 *   to the goal value (which keeps the goal's own terms).
 * - w2, w3: the island margin's weights on the second and third weakest
 *   colours (default 0.35, 0.12; the weakest counts 1).
 * - soft: widen the spread of every win chance (the ending's, and each
 *   seat's within it) by this factor: the bots' forecasts are over-confident.
 * - keep, playouts: the play-out search's size (default SIM.keep, SIM.playouts);
 *   tune these down for faster tuning runs rather than using a weaker bot.
 * - sets: for the island, value standing (and influence on the board) with the
 *   factions of its weakest colours: the access to the fights that bring them
 *   (IC1), so it builds toward complete sets instead of piling up one colour.
 * @typedef {{ lean: number, jitter: number, hold: number, push: number, margin: number, linear: number, threat: number, hidden?: number, enum?: number, sim?: number, combo?: number, sets?: number, keep?: number, playouts?: number, halve?: number, deep?: number, draft?: number, fit?: number, blend?: number, save?: number, soft?: number, w2?: number, w3?: number, table?: number, commit?: number, allies?: number, protect?: number, top?: number, race?: number }} Persona
 */
/** @type {Record<'trophy' | 'backer', Persona>} */
const PERSONAS = {
  // linear 1: counting island trophies as hunter does closed hunter's lead (challenger 32% against 20%, 2026-10-08).
  // threat 1: trophy players act against a rival pulling ahead with a faction (designer); hunter fell from 41% to 20% against it (2026-10-08).
  // Search switches standard from 2026-10-09 (challengers, 200 games each, seat 5 against backer, backer, goal, goal; an even share 20%):
  // sim 49.9%, sets=2 29.3% (sets=1 26.0%, sets=4 21.0%), enum 24.8%, combo 24.3%, hidden 21.5%; all together 57.9%.
  // table (2026-10-09): a bug fix, not a heuristic: play-outs had every seat, the bot itself included, play as a trophy-leaning goal bot.
  // threat 3 (2026-10-09, 10 games against top=2 backers): trophy 30% a seat (13% at threat 1); they take the lead of the backed faction.
  trophy: { lean: -0.3, jitter: 0.15, hold: 0.05, push: 2, margin: 3, linear: 1, threat: 3, hidden: 1, enum: 1, sim: 1, combo: 1, sets: 2, table: 1 },
  // protect 4 (2026-10-09, 10 games): presence held at or over the threshold through round 4 (21 against 14).
  // commit 2 with protect: the invaders' ending 5 in 10 (1 in 10 before), final presence 20.3 (10.9).
  // top 2: backers 30% a seat against goal 13% (15% against 23% before), mostly from island wins (10 games).
  // race 2 (against threat-3 trophy bots): backers 20% a seat, trophy 20%; the invaders' ending 4 in 10, backers winning 3 of them (10 games).
  backer: { lean: 0.3, jitter: 0.15, hold: 0.05, push: 2, margin: 3, linear: 1, threat: 1, hidden: 1, enum: 1, sim: 1, combo: 1, sets: 2, table: 1, protect: 4, commit: 2, top: 2, race: 2 },
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
 * @param {GameState} state @param {string} pid @param {boolean} [hidden]  persona hidden: count face-down tokens (see projectFights)
 */
export function winChances(state, pid, hidden = false, soft = 1, colours = ISLAND) {
  // Memoised per state (a speed-up): goals, values and play-outs ask about the same position many times. Read-only result.
  if (!memoOn()) return chancesNow(state, pid, hidden, soft, colours);
  let memo = CHANCES.get(state);
  if (!memo) { memo = new Map(); CHANCES.set(state, memo); }
  const key = `${pid}|${hidden ? 1 : 0}|${soft}|${colours}`;
  let c = memo.get(key);
  if (!c) { c = chancesNow(state, pid, hidden, soft, colours); memo.set(key, c); }
  return c;
}
/** @type {WeakMap<object, Map<string, ReturnType<typeof chancesAfter>>>} */
const CHANCES = new WeakMap();
/** The island margin's weights on the weakest three colours (TS2, WT1: the weakest decides, then the next). */
const ISLAND = [1, 0.35, 0.12];
/** @param {Persona} persona */
const coloursOf = (persona) => (persona.w2 === undefined && persona.w3 === undefined ? ISLAND : [1, persona.w2 ?? ISLAND[1], persona.w3 ?? ISLAND[2]]);

/** winChances, uncached. @param {GameState} state @param {string} pid @param {boolean} hidden @param {number} soft @param {number[]} colours */
function chancesNow(state, pid, hidden, soft, colours) {
  if (!hidden) return chancesAfter(projectFights(state), pid, soft, colours);
  const mine = chancesAfter(projectFights(state, pid, false), pid, soft, colours);
  if (!Object.values(state.board).some((place) => place.token && place.token.owner !== pid)) return mine;
  const theirs = chancesAfter(projectFights(state, pid, true), pid, soft, colours);
  return /** @type {typeof mine} */ (Object.fromEntries(Object.entries(mine).map(([k, v]) => [k, (v + /** @type {Record<string, number>} */ (/** @type {unknown} */ (theirs))[k]) / 2])));
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
    onBoard: Object.values(s.board).reduce((a, place) => a + (place.influence[pid] ?? 0), 0), access: setAccess(state, pid),
  }).map(([k, v]) => [k, r3(v)]));
}

/** winChances on a board whose fights are already projected. @param {GameState} s @param {string} pid @param {number} [soft]  persona soft: widens every chance's spread @param {number[]} [colours]  the island margin's weights on the weakest, second and third colours */
function chancesAfter(s, pid, soft = 1, colours = ISLAND) {
  const roundsLeft = Math.max(0, Number(s.options.rounds) - s.round);
  const threshold = Number(s.options.threshold);
  let grow = 0;
  for (const f of s.factions) grow += Math.min(s.supply[f], Object.values(growthDue(s, f)).reduce((a, b) => a + b, 0));
  const projected = totalPresence(s) + (s.phase === 'play' ? grow : 0);
  const spreadP = soft * (2 + 3 * roundsLeft);
  const others = s.seating.filter((id) => id !== pid);
  const presence = s.factions.map((f) => presenceOf(s, f));
  const top = Math.max(...presence);
  const w = presence.map((n) => Math.exp((n - top) / (1.5 + 1.5 * roundsLeft)));
  const wSum = w.reduce((a, b) => a + b, 0);
  // Each seat's net standing with each faction, and per faction the best and second best seat (so "the best of the others" is a lookup).
  const nets = Object.fromEntries(s.seating.map((id) => [id, s.factions.map((f) => (s.players[id].standing[f] ?? 0) - s.players[id].trophies[f])]));
  const best = s.factions.map((_, i) => { let a = -Infinity, b = -Infinity, who = ''; for (const id of s.seating) { const v = nets[id][i]; if (v > a) { b = a; a = v; who = id; } else if (v > b) b = v; } return { a, b, who }; });
  const bestOther = (/** @type {string} */ id, /** @type {number} */ i) => (best[i].who === id ? best[i].b : best[i].a);
  const lead = (/** @type {number} */ i) => nets[pid][i] - bestOther(pid, i);
  const asInvaders = s.factions.reduce((acc, f, i) => acc + (w[i] / wSum) * sigmoid(lead(i) / (soft * (1 + roundsLeft))), 0);
  const marginInvaders = s.factions.reduce((acc, f, i) => acc + (w[i] / wSum) * lead(i), 0);
  // The best rival's chance of leading the winning faction (each rival against everyone else).
  const rivalInvaders = Math.max(0, ...others.map((o) => s.factions.reduce((acc, f, i) => acc + (w[i] / wSum) * sigmoid((nets[o][i] - bestOther(o, i)) / (soft * (1 + roundsLeft))), 0)));
  /** @type {Record<string, number>} */
  const islOf = {};
  /** @type {Record<string, number>} */
  const allOf = {};
  for (const id of s.seating) {
    const t = s.factions.map((f) => s.players[id].trophies[f]).sort((a, b) => a - b);
    islOf[id] = colours[0] * t[0] + colours[1] * t[1] + colours[2] * t[2];
    allOf[id] = islOf[id] + 0.02 * s.factions.reduce((n, f) => n + s.players[id].trophies[f], 0);
  }
  const marginIsland = islOf[pid] - Math.max(...others.map((o) => islOf[o]));
  const linearIsland = allOf[pid] - Math.max(...others.map((o) => allOf[o])); // the island margin, counted directly
  const asIsland = sigmoid(marginIsland / (soft * (0.6 + 0.8 * roundsLeft)));
  const backers = others.filter((o) => Math.max(...nets[o]) >= TABLE.backing).length;
  const prior = Math.min(0.9, Math.max(0.1, TABLE.base + TABLE.step * backers));
  const rounds = Number(s.options.rounds);
  const known = rounds > 1 ? Math.min(1, (s.round - 1) / (rounds - 1)) : 1; // how much presence says by now
  const pInvaders = (1 - known) * prior + known * sigmoid((projected - threshold - 0.5) / spreadP);
  return { pInvaders, prior, known, backers, linearIsland, rivalInvaders, asInvaders, asIsland, marginInvaders, marginIsland, projected, threshold, spreadP, roundsLeft };
}

/** A goal bot's value: its win chance, weighted toward its goal, plus its margins. @param {GameState} state @param {string} pid @param {Goal} goal @param {Persona} persona */
function goalValue(state, pid, goal, persona) {
  if (persona.fit) { const v = fitValue(state, pid); if (v !== null) return persona.fit * v + 0.02 * state.players[pid].supply; }
  const c = winChances(state, pid, !!persona.hidden, persona.soft ?? 1, coloursOf(persona));
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
  const margin = Math.max(-3, Math.min(3, (c.projected - c.threshold) / 5));
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
  const c = winChances(state, pid, !!persona.hidden, persona.soft ?? 1, coloursOf(persona));
  const push = persona.push * (c.roundsLeft + 1);
  // allies: the rivals seen backing a faction push presence up too, so the invaders' ending is more reachable than one player's push.
  const pushInv = push * (1 + (persona.allies ?? 0) * c.backers);
  const reachInv = (1 - c.known) * Math.min(1, c.prior + 0.15) + c.known * sigmoid((c.projected - c.threshold - 0.5 + pushInv) / c.spreadP);
  const reachIsl = (1 - c.known) * Math.min(1, 1 - c.prior + 0.15) + c.known * (1 - sigmoid((c.projected - c.threshold - 0.5 - push) / c.spreadP));
  const evidence = reachInv * c.asInvaders - reachIsl * c.asIsland;
  if (memory && memory.jitter === undefined) memory.jitter = (rng() * 2 - 1) * persona.jitter; // this game's play style
  const score = evidence + (persona.lean + (memory?.jitter ?? 0)) * (1 - c.known);
  const held = memory?.goal;
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
    const n = p.kept.length + 1;
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
  const moves = candidates(state, pid, rng, SEARCH.targets, !!persona?.enum);
  if (persona?.sim) return simPick(state, pid, rng, moves, ev, memory, persona.keep ?? SIM.keep, persona.playouts ?? SIM.playouts, persona.table ? { profiles: { ...seats.profiles, [pid]: String(profile) }, memories: seats.memories, deep: persona.deep } : undefined, persona.halve ?? 0);
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
 * @param {GameState} state @param {string} pid @param {() => number} rng @param {Move[]} moves @param {Ev} ev @param {BotMemory} [memory] @param {number} [keep] @param {number} [playouts] @param {Seats} [table]  persona table: each seat's profile (played fast) and memory, in the play-outs @param {number} [halve]  persona halve: successive halving over `keep` moves
 */
function simPick(state, pid, rng, moves, ev, memory, keep = SIM.keep, playouts = SIM.playouts, table = undefined, halve = 0) {
  const ranked = moves.map((move) => { const s = after(state, pid, move); return { move, s, v: ev(s) }; }).sort((a, b) => b.v - a.v);
  const short = ranked.slice(0, keep);
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
 * Successive halving (persona halve): the same play-outs as the plain search
 * (keep × playouts), spent in rounds; after each, the worse half of the moves
 * is dropped, so the close calls among the best get the most play-outs. Every
 * move meets the same futures (seeds in the same order), so the comparisons
 * stay paired. Tuning, not rules.
 * @param {{ move: Move, s: GameState }[]} arms @param {string} pid @param {() => number} rng @param {Ev} ev @param {BotMemory | undefined} memory @param {number} budget @param {Seats} [table]
 */
function halvingPick(arms, pid, rng, ev, memory, budget, table) {
  const rounds = Math.ceil(Math.log2(arms.length));
  /** @type {number[]} */
  const seeds = [];
  let alive = arms.map((a) => ({ ...a, total: 0, n: 0 }));
  for (let r = 0; r < rounds && alive.length > 1; r++) {
    const each = Math.max(1, Math.floor(budget / (alive.length * rounds)));
    const upto = alive[0].n + each;
    while (seeds.length < upto) seeds.push(Math.floor(rng() * 2 ** 31));
    for (const a of alive) for (; a.n < upto; a.n++) a.total += ev(playOutRound(a.s, seeds[a.n], pid, memory, table));
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
function playOutRound(state, seed, pid, memory, table = undefined, through = false) {
  let x = seed | 0;
  const r = () => { x = (Math.imul(x, 1664525) + 1013904223) | 0; return (x >>> 0) / 2 ** 32; };
  /** @type {Record<string, BotMemory>} */
  // Each seat keeps the plan it holds (persona table: every seat's memory; otherwise only this bot's own).
  const mem = Object.fromEntries(state.seating.map((id) => [id, id === pid && memory ? { ...memory } : { ...(table?.memories?.[id] ?? {}) }]));
  const deep = table?.deep ?? 0;
  // deep: the next rounds' deals are drawn from this play-out's seed, not the game's (a bot can't see the coming deck).
  let s = deep ? { ...state, rngState: (seed ^ 0x5bd1e995) >>> 0 } : state;
  const round = s.round;
  // deep: on through the next rounds' drafts and play, until `deep` rounds after this one have been played (or the game ends).
  // through (the draft's search): from the draft on, through this round's play.
  const going = deep || through ? () => s.phase !== 'ended' && s.round <= round + deep : () => s.phase === 'play' && s.round === round;
  for (let n = 0; n < SIM.maxMoves * (deep + 1) && going(); n++) {
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
    const s = clone(state);
    s.phase = 'play';
    s.turn = s.seating.indexOf(pid);
    s.opened = true;
    s.pending = null;
    s.players[pid].hand = [k, cardId];
    const firsts = bestPlays(s, pid, k, rng, ev);
    if (!firsts.length) continue;
    const alone = firsts[0].v;
    for (const f of firsts.slice(0, 2)) {
      const s2 = clone(f.s);
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
