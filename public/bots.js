// @ts-check
/**
 * Random legal-move bots. Pure functions over GameState, shared by the
 * simulation harness (seeded rng) and the Durable Object (Math.random), so a
 * human can test a table against bots.
 *
 * Random bots don't read the board or follow each other, so they understate
 * real play. Use them for mechanics, UI testing and rough figures, not for
 * balancing (Appendix F.9). Smarter profiles come next.
 */
import { cardById, sampleTarget, playableResponses, validate } from './engine.js';

/** @typedef {import('./engine.js').GameState} GameState */
/** @typedef {import('./engine.js').Move} Move */
/** @typedef {'random'} Profile */
/** @typedef {{ rng: () => number, profile?: Profile }} BotOptions */

/** How often a random bot does things. Tuning for the bot, not rules. */
const ODDS = { respond: 0.35, pass: 0.15, action: 0.6 };

/**
 * The move this bot should make right now, or null if it has nothing to do.
 * @param {GameState} state
 * @param {{ playerId: string } & BotOptions} input
 * @returns {Move | null}
 */
export function botMove(state, input) {
  const { playerId: pid, rng } = input;
  const p = state.players[pid];
  if (!p || state.phase === 'ended') return null;
  const pick = (/** @type {any[]} */ xs) => xs[Math.floor(rng() * xs.length)];
  /** @param {Move} move */
  const legal = (move) => (validate(state, { playerId: pid, move }).ok ? move : null);

  if (state.phase === 'draft') {
    if (p.picked) return null;
    const pool = [...p.kept, ...p.batch];
    const keep = pool.slice().sort(() => rng() - 0.5).slice(0, p.kept.length + 1);
    return legal({ type: 'pick', keep });
  }

  if (state.phase === 'growth') {
    const g = state.growing;
    if (!g || g.leaders[g.next % g.leaders.length] !== pid) return null;
    return legal({ type: 'grow', location: pick(Object.keys(g.due)) });
  }

  if (state.phase !== 'play') return null;

  // Responses fire as things happen (3.7, principle 5).
  const responses = playableResponses(state, pid);
  if (responses.length && rng() < ODDS.respond) {
    const r = pick(responses);
    return legal({ type: 'respond', card: r.card, location: r.location });
  }

  if (state.pending) return state.pending.player === pid ? { type: 'confirm' } : null;
  if (state.seating[state.turn] !== pid) return null;

  // The first player opens with their marked card (FP2).
  if (!state.opened && pid === state.first) {
    const marked = p.hand.filter((c) => cardById(c).marked).sort((a, b) => (cardById(a).marked ?? '').localeCompare(cardById(b).marked ?? ''));
    if (marked.length) return legal({ type: 'play', card: marked[0], use: 'action', target: sampleTarget(state, pid, marked[0], rng) });
  }

  const playable = p.hand.filter((c) => cardById(c).action);
  if (!playable.length || rng() < ODDS.pass) return { type: 'pass' };
  const cardId = pick(playable);
  const card = cardById(cardId);
  if (card.suit && (rng() >= ODDS.action || p.supply <= 0)) {
    const influence = legal({ type: 'play', card: cardId, use: 'influence' });
    if (influence) return influence;
  }
  const target = sampleTarget(state, pid, cardId, rng);
  if (!target && card.suit) return legal({ type: 'play', card: cardId, use: 'influence' }) ?? { type: 'pass' };
  return legal({ type: 'play', card: cardId, use: 'action', target }) ?? { type: 'pass' };
}
