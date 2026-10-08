// @ts-check
/**
 * Bots. Pure functions over GameState, shared by the simulation harness
 * (seeded rng) and the Durable Object (Math.random), so a human can test a
 * table against bots.
 *
 * Profiles (Appendix F.9):
 * - random:  any legal move. Checks that the rules run; understates real play.
 * - smart:   looks one move ahead. It tries each card it holds (its action with
 *            several sampled targets, or its influence) and passing, projects
 *            the round's fights on a copy, and keeps the move that scores best
 *            for it. Its score weighs the two ways the game can end (the
 *            invaders win, or the island) by how likely each looks.
 * - invader: smart, but always plays as if the invaders will win.
 * - island:  smart, but always plays as if the island will win.
 * - deep:    smart, plus a reply lookahead: for its few best moves it also
 *            plays the next player's best reply (as smart) and keeps the move
 *            that is still best for it afterwards. Slower; used to play out
 *            rounds when measuring cards (designer, 2026-10-07).
 * - deep-bold, deep-balanced, deep-cautious: deep, with strategy breakpoints
 *            (STRATEGIES below): the same search, different play profiles.
 *
 * Bots are a tool for checking the rules and rough figures, not a model of
 * real players. Their tuning numbers below are not rules.
 */
import {
  cardById, sampleTarget, playableResponses, validate, applyMove, resolveFight, totalPresence, presenceOf, spec, influenceSpots,
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
/** @typedef {'random' | 'smart' | 'invader' | 'island' | 'deep' | 'deep-bold' | 'deep-balanced' | 'deep-cautious'} Profile */
/** @typedef {{ rng: () => number, profile?: Profile }} BotOptions */

export const PROFILES = /** @type {Profile[]} */ (['random', 'smart', 'invader', 'island', 'deep', 'deep-bold', 'deep-balanced', 'deep-cautious']);

/** Tuning for the bots, not rules. */
const RANDOM_ODDS = { respond: 0.35, pass: 0.15, action: 0.6 };
const SMART = {
  targets: 8,        // targets sampled per card
  noise: 0.15,       // random jitter on each move's value, so bots vary
  respondMargin: 0.4, // a response must beat holding the card by this much
  spread: 3,         // how sharply presence decides which faction is likely to win
};
/**
 * Strategy breakpoints (designer, 2026-10-07): the points at which a bot
 * shifts focus, on two axes. Each profile has its own numbers, so they play
 * differently. Tuning for the bots, not rules.
 *
 * 1. The ending it plays for: a trophy mix (the island wins) or faction
 *    influence (the invaders win). It commits to one when the projected
 *    presence is `commit` or more from the threshold, or in the last round if
 *    `lastRound`; otherwise it hedges by how likely each looks.
 *    Which faction it backs depends on the ending (designer, 2026-10-07):
 *    - if the invaders look like winning, the faction it has the best shot
 *      at leading: among the factions within `backLead` presence of the top,
 *      the one where its standing less trophies is furthest ahead of the
 *      other players;
 *    - mid-game, if the invaders look like losing, the faction that sets up
 *      the actions it wants to take: the faction of most of the suit cards in
 *      its hand (presence actions spend standing with the faction moved).
 *      Standing with it counts `setup` per point, up to 3 per such card.
 * 2. Mid-game, influence on a faction (spending cards for standing) or
 *    actions that produce trophies. It builds influence through round
 *    `buildRounds` while its standing with the faction it would back is
 *    under `standingGoal`, then hunts trophies. `weight` is how much more the
 *    current focus counts (standing while building; trophies and influence at
 *    fights while hunting).
 * @typedef {{ commit: number, lastRound: boolean, backLead: number, setup: number, buildRounds: number, standingGoal: number, weight: number }} Strategy
 */
export const STRATEGIES = /** @type {const} */ ({
  bold:     { commit: 2, lastRound: true, backLead: 2, setup: 0.3, buildRounds: 1, standingGoal: 4, weight: 0.6 },
  balanced: { commit: 5, lastRound: true, backLead: 4, setup: 0.25, buildRounds: 2, standingGoal: 7, weight: 0.4 },
  cautious: { commit: 9, lastRound: true, backLead: 6, setup: 0.2, buildRounds: 3, standingGoal: 10, weight: 0.25 },
});
/** @type {Partial<Record<Profile, Strategy>>} */
const STRATEGY_OF = { 'deep-bold': STRATEGIES.bold, 'deep-balanced': STRATEGIES.balanced, 'deep-cautious': STRATEGIES.cautious };

/**
 * Where a bot's focus is now, by its strategy's breakpoints (on the board
 * after this round's fights, as they stand).
 * @param {GameState} s @param {string} pid @param {Strategy} st
 * @returns {{ ending: 'island' | 'invaders' | 'hedge', backs: string | null, setup: { faction: string, cards: number } | null, focus: 'influence' | 'trophies' }}
 */
export function plan(s, pid, st) {
  const threshold = Number(s.options.threshold);
  const total = totalPresence(s);
  const last = s.round >= Number(s.options.rounds);
  /** @type {'island' | 'invaders' | 'hedge'} */
  let ending = 'hedge';
  if (total - threshold >= st.commit) ending = 'invaders';
  else if (threshold - total >= st.commit) ending = 'island';
  else if (st.lastRound && last) ending = total > threshold ? 'invaders' : 'island';
  const p = s.players[pid];
  const net = (/** @type {string} */ id, /** @type {string} */ f) => (s.players[id].standing[f] ?? 0) - s.players[id].trophies[f];
  // Invaders likely: the contender it has the best shot at leading.
  const top = Math.max(...s.factions.map((f) => presenceOf(s, f)));
  const contenders = s.factions.filter((f) => top - presenceOf(s, f) <= st.backLead);
  const shot = (/** @type {string} */ f) => net(pid, f) - Math.max(...s.seating.filter((id) => id !== pid).map((id) => net(id, f)));
  const backs = ending === 'island' ? null : contenders.slice().sort((a, b) => shot(b) - shot(a))[0] ?? null;
  // Invaders unlikely: the faction behind most of its suit cards.
  /** @type {Record<string, number>} */
  const behind = {};
  for (const c of p.hand) {
    const suit = cardById(c).suit;
    const f = suit ? s.factions[spec.archetypes.findIndex((a) => a.id === suit)] : null;
    if (f) behind[f] = (behind[f] ?? 0) + 1;
  }
  const best = Object.entries(behind).sort((a, b) => b[1] - a[1])[0];
  const setup = ending === 'island' && best ? { faction: best[0], cards: best[1] } : null;
  const goal = backs ?? setup?.faction;
  const standing = goal ? (p.standing[goal] ?? 0) : Math.max(...s.factions.map((f) => p.standing[f] ?? 0));
  const focus = s.round <= st.buildRounds && standing < st.standingGoal ? 'influence' : 'trophies';
  return { ending, backs, setup, focus };
}

/** Tuning for the deep bot's reply lookahead, not rules. */
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
  return (input.profile ?? 'smart') === 'random' ? randomMove(state, input.playerId, input.rng) : smartMove(state, input.playerId, input.rng, input.profile ?? 'smart');
}

// ---------------------------------------------------------------------------
// Shared: the forced moves every bot makes the same way
// ---------------------------------------------------------------------------

/** @param {GameState} state @param {string} pid @param {Move} move */
const legal = (state, pid, move) => (validate(state, { playerId: pid, move }).ok ? move : null);

// ---------------------------------------------------------------------------
// Random
// ---------------------------------------------------------------------------

/** @param {GameState} state @param {string} pid @param {() => number} rng @returns {Move | null} */
function randomMove(state, pid, rng) {
  const p = state.players[pid];
  const pick = (/** @type {any[]} */ xs) => xs[Math.floor(rng() * xs.length)];
  if (state.phase === 'draft') {
    if (p.picked) return null;
    const pool = [...p.kept, ...p.batch];
    return legal(state, pid, { type: 'pick', keep: pool.slice().sort(() => rng() - 0.5).slice(0, p.kept.length + 1) });
  }
  if (state.phase === 'growth') {
    const g = state.growing;
    if (!g || g.leaders[g.next % g.leaders.length] !== pid) return null;
    return legal(state, pid, { type: 'grow', location: pick(Object.keys(g.due)) });
  }
  if (state.phase !== 'play') return null;
  const responses = playableResponses(state, pid);
  if (responses.length && rng() < RANDOM_ODDS.respond) {
    const r = pick(responses);
    return legal(state, pid, { type: 'respond', card: r.card, location: r.location });
  }
  if (state.pending) return state.pending.player === pid ? { type: 'confirm' } : null;
  if (state.seating[state.turn] !== pid) return null;
  if (!state.opened && pid === state.first) {
    const marked = p.hand.filter((c) => cardById(c).marked).sort((a, b) => (cardById(a).marked ?? '').localeCompare(cardById(b).marked ?? ''));
    if (marked.length) return legal(state, pid, { type: 'play', card: marked[0], use: 'action', target: sampleTarget(state, pid, marked[0], rng) });
  }
  const playable = p.hand.filter((c) => cardById(c).action);
  if (!playable.length || rng() < RANDOM_ODDS.pass) return { type: 'pass' };
  const cardId = pick(playable);
  const card = cardById(cardId);
  if (card.suit && (rng() >= RANDOM_ODDS.action || p.supply <= 0)) {
    const influence = legal(state, pid, spend(state, cardId, pick));
    if (influence) return influence;
  }
  const target = sampleTarget(state, pid, cardId, rng);
  if (!target && card.suit) return legal(state, pid, spend(state, cardId, pick)) ?? { type: 'pass' };
  return legal(state, pid, { type: 'play', card: cardId, use: 'action', target }) ?? { type: 'pass' };
}

// ---------------------------------------------------------------------------
// Smart: one move of lookahead and a value function
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

/**
 * How good a position is for `pid`, between the two ways the game ends.
 * @param {GameState} state @param {string} pid @param {Profile} profile
 */
export function evaluate(state, pid, profile = 'smart') {
  const s = projectFights(state);
  const roundsLeft = Number(s.options.rounds) - s.round;
  const threshold = Number(s.options.threshold);
  const total = totalPresence(s);
  const uncertainty = 3 + 3 * roundsLeft;
  const st = STRATEGY_OF[profile];
  const pl = st ? plan(s, pid, st) : null;
  const pInvaders = profile === 'invader' || pl?.ending === 'invaders' ? 1 : profile === 'island' || pl?.ending === 'island' ? 0 : 1 / (1 + Math.exp(-(total - threshold) / uncertainty));
  // Focus (strategy axis 2): the current focus counts `weight` more.
  const standingW = pl?.focus === 'influence' ? 1 + (st?.weight ?? 0) : 1;
  const trophyW = pl?.focus === 'trophies' ? 1 + (st?.weight ?? 0) : 1;

  // Invaders: each faction's chance to be the winner, from presence (or the one it backs).
  const presence = s.factions.map((f) => presenceOf(s, f));
  const top = Math.max(...presence);
  const weights = pl?.backs && pl.ending === 'invaders' ? s.factions.map((f) => (f === pl.backs ? 1 : 0)) : presence.map((n) => Math.exp((n - top) / SMART.spread));
  const sum = weights.reduce((a, b) => a + b, 0);
  /** @param {string} id */
  const invaderScore = (id) => s.factions.reduce((acc, f, i) => {
    const p = s.players[id];
    const onBoard = Object.values(s.board).reduce((n, place) => n + (place.influence[id] ?? 0), 0) * 0.15 * trophyW;
    return acc + (weights[i] / sum) * (standingW * (p.standing[f] ?? 0) - p.trophies[f]) + onBoard / s.factions.length;
  }, 0);
  // Island: weakest colour first, then the next (TS2, WT1).
  /** @param {string} id */
  const islandScore = (id) => {
    const t = s.factions.map((f) => s.players[id].trophies[f]).sort((a, b) => a - b);
    // Standing with the faction behind its cards fuels the actions it wants to take (strategy axis 1, island side).
    const fuel = pl?.setup && st ? st.setup * Math.min(s.players[id].standing[pl.setup.faction] ?? 0, 3 * pl.setup.cards) : 0;
    return trophyW * (t[0] + 0.35 * t[1] + 0.12 * t[2] + 0.02 * t.reduce((a, b) => a + b, 0)) + (id === pid ? fuel : 0);
  };
  const others = s.seating.filter((id) => id !== pid);
  const vsBest = (/** @type {(id: string) => number} */ score) => score(pid) - Math.max(...others.map(score));
  return pInvaders * vsBest(invaderScore) + (1 - pInvaders) * vsBest(islandScore) + 0.02 * s.players[pid].supply;
}

/** Every move worth considering on this bot's turn. @param {GameState} state @param {string} pid @param {() => number} rng */
function candidates(state, pid, rng, targets = SMART.targets) {
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

/** @param {GameState} state @param {string} pid @param {() => number} rng @param {Profile} profile @returns {Move | null} */
function smartMove(state, pid, rng, profile) {
  const p = state.players[pid];
  const value = (/** @type {GameState} */ s) => evaluate(s, pid, profile) + (rng() - 0.5) * SMART.noise;

  if (state.phase === 'draft') {
    if (p.picked) return null;
    // Keep the cards whose best play, now, is worth the most.
    const pool = [...p.kept, ...p.batch];
    const base = evaluate(state, pid, profile);
    const worth = pool.map((cardId) => ({ cardId, v: cardWorth(state, pid, cardId, rng, profile, base) + (rng() - 0.5) * SMART.noise }));
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
    const baseline = evaluate(finish(state), pid, profile);
    let best = null, bestV = baseline + SMART.respondMargin;
    for (const r of responses) {
      const move = /** @type {Move} */ ({ type: 'respond', card: r.card, location: r.location });
      const v = evaluate(finish(applyMove(state, { playerId: pid, move })), pid, profile);
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
  const deep = profile.startsWith('deep');
  const moves = candidates(state, pid, rng, deep ? DEEP.targets : SMART.targets);
  if (deep) return deepPick(state, pid, rng, moves, profile);
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
 * The deep bot's choice: its few best moves one move ahead, each followed by
 * the next player's best reply (one move ahead, as smart), scored for this bot.
 * @param {GameState} state @param {string} pid @param {() => number} rng @param {Move[]} moves @param {Profile} profile
 */
function deepPick(state, pid, rng, moves, profile) {
  const noise = () => (rng() - 0.5) * SMART.noise;
  const first = moves.map((move) => { const s = after(state, pid, move); return { move, s, v: evaluate(s, pid, profile) + noise() }; })
    .sort((a, b) => b.v - a.v).slice(0, DEEP.keep);
  let best = first[0]?.move ?? null, bestV = -Infinity;
  for (const { move, s } of first) {
    let end = s;
    const q = s.phase === 'play' && !s.pending ? s.seating[s.turn] : null;
    if (q && q !== pid) {
      let reply = null, replyV = -Infinity;
      for (const m of candidates(s, q, rng, DEEP.replyTargets)) {
        const r = after(s, q, m);
        const v = evaluate(r, q) + noise();
        if (v > replyV) { reply = r; replyV = v; }
      }
      if (reply) end = reply;
    }
    const v = evaluate(end, pid, profile) + noise();
    if (v > bestV) { best = move; bestV = v; }
  }
  return best;
}

/** How much a card adds, played as well as the bot can find right now. @param {GameState} state @param {string} pid @param {string} cardId @param {() => number} rng @param {Profile} profile @param {number} base */
function cardWorth(state, pid, cardId, rng, profile, base) {
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
  if (card.suit && validate(s, { playerId: pid, move: infl }).ok) best = Math.max(best, evaluate(after(s, pid, infl), pid, profile) - base);
  if (card.action) {
    for (let i = 0; i < 4; i++) {
      const target = sampleTarget(s, pid, cardId, rng);
      if (!target) continue;
      const move = /** @type {Move} */ ({ type: 'play', card: cardId, use: 'action', target });
      if (!validate(s, { playerId: pid, move }).ok) continue;
      best = Math.max(best, evaluate(after(s, pid, move), pid, profile) - base);
    }
  }
  return best + (card.marked ? 0.2 : 0);
}

void spec;
