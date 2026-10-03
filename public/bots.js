// @ts-check
/**
 * Random legal-move bots. Pure functions over GameState, shared by the
 * simulation harness (seeded rng) and the Durable Object (Math.random), so a
 * human can test a table against bots.
 *
 * Random bots don't read the board or follow each other, so they understate
 * real play. Use them for mechanics and UI testing, not for balancing
 * (Appendix F.9).
 */
/** @typedef {import('./engine.js').GameState} GameState */
/** @typedef {import('./engine.js').Move} Move */
/** @typedef {'random'} Profile */
/** @typedef {{ rng: () => number, profile?: Profile }} BotOptions */

/**
 * The move this bot should make right now, or null if it cannot act.
 * One small function per phase; add one as each real phase lands.
 * @param {GameState} state
 * @param {{ playerId: string } & BotOptions} input
 * @returns {Move | null}
 */
export function botMove(state, input) {
  const player = state.players[input.playerId];
  if (!player || state.phase === 'ended') return null;
  if (state.phase === 'ready' && !player.committed) return { type: 'ready' };
  return null;
}
