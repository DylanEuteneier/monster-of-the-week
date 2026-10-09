// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyMove, validate, nextRandom } from '../public/engine.js';
import { botMove, fast } from '../public/bots.js';

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
        const move = botMove(state, { playerId, rng: random, profile: /** @type {import('../public/bots.js').Profile} */ (fast('trophy')) });
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
