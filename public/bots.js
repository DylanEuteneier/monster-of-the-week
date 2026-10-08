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
 *              Backing a faction needs more proof than going for trophy sets
 *              (designer). It searches one move ahead: each card in hand with
 *              sampled targets, its influence, and passing.
 * - goal-deep: goal, plus a reply lookahead: for its best moves it also plays
 *              the next player's best reply and keeps the move that is still
 *              best for it afterwards. Slower.
 * - hunter:    a trophy chaser with a plain value: trophy sets for the island
 *              and standing less trophies for the invaders, blended by how
 *              likely each ending looks, read as 30 tokens of presence nearer
 *              the island than the board says. The strongest island player in
 *              tournaments so far.
 *
 * Bots are a tool for checking the rules and rough figures, not a model of
 * real players. Their tuning numbers below are not rules.
 */
import {
  cardById, sampleTarget, playableResponses, validate, applyMove, resolveFight, totalPresence, presenceOf, influenceSpots, growthDue,
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
/** @typedef {'goal' | 'goal-deep' | 'hunter'} Profile */
/** @typedef {{ rng: () => number, profile?: Profile, memory?: BotMemory }} BotOptions */
/** What a bot remembers between its turns: its goal. The caller keeps one per seat; a bot without it has no hysteresis. @typedef {{ goal?: Goal }} BotMemory */
/** @typedef {'island' | 'invaders'} Goal */

export const PROFILES = /** @type {Profile[]} */ (['goal', 'goal-deep', 'hunter']);

/** Tuning for the bots, not rules. */
const SEARCH = {
  targets: 8,         // targets sampled per card
  noise: 0.15,        // random jitter on each move's value, so bots vary
  respondMargin: 0.4, // a response must beat holding the card by this much
};
/** The reply lookahead (goal-deep). */
const DEEP = {
  targets: 12,       // targets sampled per card for its own move
  keep: 10,          // its best moves (one move ahead) checked against a reply
  replyTargets: 8,   // targets sampled per card for the reply
};
/** Hunter: how many tokens of presence nearer the island it reads the ending, and how sharply presence picks the likely winning faction. */
const HUNTER = { lean: 30, spread: 3 };

/**
 * The move this bot should make right now, or null if it has nothing to do.
 * @param {GameState} state
 * @param {{ playerId: string } & BotOptions} input
 * @returns {Move | null}
 */
export function botMove(state, input) {
  const p = state.players[input.playerId];
  if (!p || state.phase === 'ended') return null;
  return playMove(state, input.playerId, input.rng, input.profile ?? 'goal', input.memory);
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

/** The board after this round's fights, as they stand now (tokens unknown to the bot are ignored). @param {GameState} state */
function projectFights(state) {
  let s = state;
  for (const loc of contested(state)) {
    if (s.board[loc].token) {
      s = structuredClone(s);
      s.board[loc].token = null;
    }
    s = resolveFight(s, loc);
  }
  return s;
}

const sigmoid = (/** @type {number} */ x) => 1 / (1 + Math.exp(-x));

/**
 * How good a position is for `pid`: a goal bot's goal-weighted win chance, or
 * hunter's plain value.
 * @param {GameState} state @param {string} pid @param {Profile | string} [profile] @param {Goal} [goal]  a goal bot's current goal
 */
export function evaluate(state, pid, profile = 'goal', goal = undefined) {
  const persona = personaOf(profile);
  return persona ? goalValue(state, pid, goal ?? 'island', persona) : hunterValue(state, pid);
}

/** Hunter's value: trophy sets and standing less trophies, against the best rival, blended by the ending it reads as likely. @param {GameState} state @param {string} pid */
function hunterValue(state, pid) {
  const s = projectFights(state);
  const roundsLeft = Number(s.options.rounds) - s.round;
  const pInvaders = sigmoid((totalPresence(s) - Number(s.options.threshold) - HUNTER.lean) / (3 + 3 * roundsLeft));
  const presence = s.factions.map((f) => presenceOf(s, f));
  const top = Math.max(...presence);
  const weights = presence.map((n) => Math.exp((n - top) / HUNTER.spread));
  const sum = weights.reduce((a, b) => a + b, 0);
  /** @param {string} id */
  const invaderScore = (id) => s.factions.reduce((acc, f, i) => {
    const p = s.players[id];
    const onBoard = Object.values(s.board).reduce((n, place) => n + (place.influence[id] ?? 0), 0) * 0.15;
    return acc + (weights[i] / sum) * ((p.standing[f] ?? 0) - p.trophies[f]) + onBoard / s.factions.length;
  }, 0);
  // Island: weakest colour first, then the next (TS2, WT1).
  /** @param {string} id */
  const islandScore = (id) => {
    const t = s.factions.map((f) => s.players[id].trophies[f]).sort((a, b) => a - b);
    return t[0] + 0.35 * t[1] + 0.12 * t[2] + 0.02 * t.reduce((a, b) => a + b, 0);
  };
  const others = s.seating.filter((id) => id !== pid);
  const vsBest = (/** @type {(id: string) => number} */ score) => score(pid) - Math.max(...others.map(score));
  return pInvaders * vsBest(invaderScore) + (1 - pInvaders) * vsBest(islandScore) + 0.02 * s.players[pid].supply;
}

// ---------------------------------------------------------------------------
// Goal bots: the chance of winning, and goals that shift (designer, 2026-10-07)
// ---------------------------------------------------------------------------

/**
 * A goal bot's personality (tuning, not rules; settings tested in
 * tournaments, 2026-10-08, in F.9).
 * - proof: how much better backing a faction must look than the island before
 *   it goes for it (designer: more proof to aim for a faction win).
 * - hold: hysteresis, how far the case must turn before it switches back.
 * - push: tokens of presence per remaining round it reckons one player can
 *   move the game toward the ending it wants.
 * - other: how much the goal it isn't pursuing still counts (0 to 1).
 * - margin: how much the raw margins count beside the win chance (trophies
 *   and standing against the best rival), so a bot far ahead or behind still
 *   reaches for one more (a probability flattens there).
 * @typedef {{ proof: number, hold: number, push: number, other: number, margin: number }} Persona
 */
/** @type {Record<'goal' | 'goal-deep', Persona>} */
const PERSONAS = {
  goal: { proof: 0.3, hold: 0.05, push: 2, other: 0, margin: 3 },
  'goal-deep': { proof: 0.3, hold: 0.05, push: 2, other: 0, margin: 3 },
};

/**
 * A profile's persona. For tuning, a profile can also be written
 * "goal:proof=0.4,other=0.6" (or "goal-deep:..."): the base persona with those
 * numbers changed.
 * @param {string} profile @returns {Persona | undefined}
 */
export function personaOf(profile) {
  const [base, overrides] = profile.split(':');
  const p = PERSONAS[/** @type {'goal' | 'goal-deep'} */ (base)];
  if (!p || !overrides) return p;
  return { ...p, ...Object.fromEntries(overrides.split(',').map((kv) => { const [k, v] = kv.split('='); return [k, Number(v)]; })) };
}

/**
 * The chance of winning, by ending. `pInvaders`: the projected presence (this
 * round's fights and growth) against the threshold. `asInvaders`: each
 * faction's chance of being the winner (from presence) times my chance of
 * leading it (standing less trophies against the best rival). `asIsland`: my
 * weakest colour, then the next, against the best rival (TS2, WT1). Margins
 * sharpen as rounds run out.
 * @param {GameState} state @param {string} pid
 */
export function winChances(state, pid) {
  const s = projectFights(state);
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
  const isl = (/** @type {string} */ id) => {
    const t = s.factions.map((f) => s.players[id].trophies[f]).sort((a, b) => a - b);
    return t[0] + 0.35 * t[1] + 0.12 * t[2];
  };
  const marginIsland = isl(pid) - Math.max(...others.map(isl));
  const asIsland = sigmoid(marginIsland / (0.6 + 0.8 * roundsLeft));
  return { pInvaders: sigmoid((projected - threshold - 0.5) / spreadP), asInvaders, asIsland, marginInvaders, marginIsland, projected, threshold, spreadP, roundsLeft };
}

/** A goal bot's value: its win chance, weighted toward its goal, plus its margins. @param {GameState} state @param {string} pid @param {Goal} goal @param {Persona} persona */
function goalValue(state, pid, goal, persona) {
  const c = winChances(state, pid);
  const inv = c.pInvaders * (10 * c.asInvaders + persona.margin * c.marginInvaders);
  const isl = (1 - c.pInvaders) * (10 * c.asIsland + persona.margin * c.marginIsland);
  return (goal === 'invaders' ? inv + persona.other * isl : isl + persona.other * inv) + 0.02 * state.players[pid].supply;
}

/**
 * Which goal to pursue now: the ending where its chance of winning, if it
 * pushes the game that way, is best. Backing a faction needs `proof` more;
 * a goal already held is kept until the case turns by `hold`.
 * @param {GameState} state @param {string} pid @param {Persona} persona @param {BotMemory} [memory] @returns {Goal}
 */
export function chooseGoal(state, pid, persona, memory) {
  const c = winChances(state, pid);
  const push = persona.push * (c.roundsLeft + 1);
  const reachInv = sigmoid((c.projected - c.threshold - 0.5 + push) / c.spreadP);
  const reachIsl = 1 - sigmoid((c.projected - c.threshold - 0.5 - push) / c.spreadP);
  const edge = reachInv * c.asInvaders - reachIsl * c.asIsland;
  const held = memory?.goal;
  /** @type {Goal} */
  const goal = held === 'invaders' ? (edge > persona.proof - persona.hold ? 'invaders' : 'island') : (edge > persona.proof + (held ? persona.hold : 0) ? 'invaders' : 'island');
  if (memory) memory.goal = goal;
  return goal;
}

// ---------------------------------------------------------------------------
// Choosing a move
// ---------------------------------------------------------------------------

/** Every move worth considering on this bot's turn. @param {GameState} state @param {string} pid @param {() => number} rng */
function candidates(state, pid, rng, targets = SEARCH.targets) {
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

/** @param {GameState} state @param {string} pid @param {() => number} rng @param {Profile | string} profile @param {BotMemory} [memory] @returns {Move | null} */
function playMove(state, pid, rng, profile, memory) {
  const p = state.players[pid];
  const persona = personaOf(profile);
  const goal = persona ? chooseGoal(state, pid, persona, memory) : undefined;
  /** This bot's value of a position (others, in its lookahead, as standard goal bots). @type {Ev} */
  const ev = (s, id = pid) => (id === pid ? evaluate(s, pid, profile, goal) : evaluate(s, id));
  const value = (/** @type {GameState} */ s) => ev(s) + (rng() - 0.5) * SEARCH.noise;

  if (state.phase === 'draft') {
    if (p.picked) return null;
    // Keep the cards whose best play, now, is worth the most.
    const pool = [...p.kept, ...p.batch];
    const base = ev(state);
    const worth = pool.map((cardId) => ({ cardId, v: cardWorth(state, pid, cardId, rng, ev, base) + (rng() - 0.5) * SEARCH.noise }));
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
  const moves = candidates(state, pid, rng, deep ? DEEP.targets : SEARCH.targets);
  if (deep) return deepPick(state, pid, rng, moves, ev);
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
