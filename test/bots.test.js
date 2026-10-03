// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyMove, validate, nextRandom } from '../public/engine.js';
import { botMove } from '../public/bots.js';

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

test('bots only ever propose legal moves and play a game to the end', () => {
  const random = rng(11);
  let state = createGame({ seed: 11, players: PLAYERS });
  let moves = 0;
  while (state.phase !== 'ended' && moves < 2000) {
    const playerId = PLAYERS.find((id) => botMove(state, { playerId: id, rng: random }) !== null);
    if (!playerId) throw new Error(`no bot can act in ${state.phase}`);
    const move = botMove(state, { playerId, rng: random });
    if (!move) throw new Error('unreachable');
    assert.deepEqual(validate(state, { playerId, move }), { ok: true });
    state = applyMove(state, { playerId, move });
    moves += 1;
  }
  assert.equal(state.phase, 'ended');
});

test('a bot that has already committed proposes nothing', () => {
  const state = applyMove(createGame({ seed: 1, players: PLAYERS }), { playerId: 'ann', move: { type: 'ready' } });
  assert.equal(botMove(state, { playerId: 'ann', rng: Math.random }), null);
  assert.equal(botMove(state, { playerId: 'zed', rng: Math.random }), null);
});
