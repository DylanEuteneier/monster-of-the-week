// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyMove, validate, nextRandom } from '../public/rules.js';
import { botMove, fast } from '../public/rules.js';

const PLAYERS = ['ann', 'bob', 'cat', 'dan', 'eve'];

/** @param {number} seed */
function rng(seed) {
  let state = seed;
  return () => {
    const roll = nextRandom(state);
    state = roll.state;
    return roll.value;
  };
}

test('bots only ever propose legal moves and play games to the end', () => {
  for (let g = 0; g < 10; g++) {
    const random = rng(100 + g);
    let state = createGame({ seed: 100 + g, players: PLAYERS });
    for (let moves = 0; state.phase !== 'ended' && moves < 20000; moves++) {
      let moved = false;
      for (const playerId of state.seating) {
        const move = botMove(state, { playerId, rng: random, profile: /** @type {import('../public/rules.js').Profile} */ (fast('trophy')) });
        if (!move) continue;
        assert.deepEqual(validate(state, { playerId, move }), { ok: true }, JSON.stringify(move));
        state = applyMove(state, { playerId, move });
        moved = true;
        break;
      }
      assert.ok(moved, `stuck in ${state.phase}`);
    }
    assert.equal(state.phase, 'ended');
  }
});

test('a seat that is not at the table gets no move', () => {
  assert.equal(botMove(createGame({ seed: 1, players: PLAYERS }), { playerId: 'zed', rng: Math.random }), null);
});

test('the rules module: profiles, refused moves, views and memory cross the bridge', async () => {
  const { PROFILES, engineProfiles, IllegalMoveError, playerView, nextChoice, waitingOn, rankForHint } = await import('../public/rules.js');
  assert.deepEqual(PROFILES, engineProfiles());
  const s = createGame({ seed: 3, players: PLAYERS });
  assert.throws(() => applyMove(s, { playerId: 'ann', move: { type: 'pass' } }), IllegalMoveError);
  assert.throws(() => applyMove(s, { playerId: 'zed', move: { type: 'pass' } }), /not seated/);
  // The table builds targets on its own view.
  let t = s;
  for (const playerId of t.seating) t = applyMove(t, { playerId, move: /** @type {any} */ (botMove(t, { playerId, rng: rng(5), profile: /** @type {any} */ (fast('trophy')) })) });
  const view = playerView(t, 'ann');
  assert.deepEqual(waitingOn(view), waitingOn(t).filter((id) => !view.players[id].picked));
  const card = view.me.kept[0] ?? view.me.hand[0];
  if (card) assert.deepEqual(nextChoice(view, 'ann', card, {}), nextChoice(t, 'ann', card, {}));
  // A bot's memory is written back into the caller's object.
  const memory = {};
  rankForHint(t, 'ann', memory);
  assert.ok('goal' in memory && 'jitter' in memory, JSON.stringify(memory));
});
