// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spec, variants, createGame, validate, applyMove, playerView, waitingOn, factionById, shuffle, resolveOptions, IllegalMoveError } from '../public/engine.js';

/** @typedef {import('../public/engine.js').GameState} GameState */

const PLAYERS = ['ann', 'bob', 'cat', 'dan', 'eve'];

/** @param {number} [seed] */
const newGame = (seed = 1) => createGame({ seed, players: PLAYERS });

/** @param {GameState} state */
function everyoneReady(state) {
  return PLAYERS.reduce((next, playerId) => applyMove(next, { playerId, move: { type: 'ready' } }), state);
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

test('spec holds five archetypes with three factions and three locations each (2.5)', () => {
  assert.equal(spec.archetypes.length, 5);
  for (const archetype of spec.archetypes) {
    assert.equal(spec.factions.filter((faction) => faction.archetype === archetype.id).length, 3, archetype.id);
    assert.equal(spec.locations.filter((location) => location.archetype === archetype.id).length, 3, archetype.id);
    assert.equal(spec.slayerGroups.filter((group) => group.archetype === archetype.id).length, 1, archetype.id);
  }
});

test('content ids are unique across every list, so a sprite id names one thing', () => {
  const ids = [spec.archetypes, spec.factions, spec.locations, spec.slayerGroups].flat().map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length);
});

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

test('createGame enforces the 3–5 seat limit (3.16)', () => {
  assert.throws(() => createGame({ seed: 1, players: ['a', 'b'] }), /seats 3–5/);
  assert.throws(() => createGame({ seed: 1, players: ['a', 'b', 'c', 'd', 'e', 'f'] }), /seats 3–5/);
  assert.doesNotThrow(() => createGame({ seed: 1, players: ['a', 'b', 'c'] }));
});

test('createGame rejects duplicate seat names', () => {
  assert.throws(() => createGame({ seed: 1, players: ['a', 'a', 'b'] }), /unique/);
});

test('one faction is in play per archetype, in archetype order (3.4)', () => {
  for (let seed = 0; seed < 50; seed++) {
    const state = newGame(seed);
    assert.deepEqual(state.factions.map((id) => factionById(id).archetype), spec.archetypes.map((archetype) => archetype.id));
  }
});

test('the same seed deals the same game; different seeds vary', () => {
  assert.deepEqual(newGame(42), newGame(42));
  const deals = new Set(Array.from({ length: 30 }, (_, seed) => newGame(seed).factions.join(',')));
  assert.ok(deals.size > 1);
});

test('shuffle is a permutation and advances the generator', () => {
  const result = shuffle([1, 2, 3, 4, 5], 9);
  assert.deepEqual(result.items.slice().sort(), [1, 2, 3, 4, 5]);
  assert.notEqual(result.rngState, 9);
});

test('options fall back to each variant default and reject unknown ids', () => {
  assert.deepEqual(resolveOptions({}), Object.fromEntries(variants.map((variant) => [variant.id, variant.default])));
  assert.throws(() => resolveOptions({ nonsense: 'x' }), /unknown option/);
});

// ---------------------------------------------------------------------------
// Moves and phases (scaffold ready check)
// ---------------------------------------------------------------------------

test('validate rejects unseated players, wrong move types, and double commits', () => {
  const state = newGame();
  assert.deepEqual(validate(state, { playerId: 'zed', move: { type: 'ready' } }), { ok: false, reason: 'You are not seated at this table.' });
  assert.equal(validate(state, { playerId: 'ann', move: /** @type {any} */ ({ type: 'bogus' }) }).ok, false);
  const committed = applyMove(state, { playerId: 'ann', move: { type: 'ready' } });
  assert.equal(validate(committed, { playerId: 'ann', move: { type: 'ready' } }).ok, false);
});

test('applyMove never alters the state passed in and throws IllegalMoveError on bad moves', () => {
  const state = newGame();
  const snapshot = structuredClone(state);
  applyMove(state, { playerId: 'ann', move: { type: 'ready' } });
  assert.deepEqual(state, snapshot);
  assert.throws(() => applyMove(state, { playerId: 'zed', move: { type: 'ready' } }), IllegalMoveError);
});

test('the round resolves when the last seat commits, then the game ends after the scaffold rounds', () => {
  let state = newGame();
  assert.deepEqual(waitingOn(state), PLAYERS);
  state = everyoneReady(state);
  assert.equal(state.round, 2);
  assert.equal(state.log.length, 1);
  assert.deepEqual(waitingOn(state), PLAYERS);
  for (let round = 2; round <= spec.scaffold.rounds; round++) state = everyoneReady(state);
  assert.equal(state.phase, 'ended');
  assert.equal(validate(state, { playerId: 'ann', move: { type: 'ready' } }).ok, false);
});

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

test('playerView carries the viewer, the public board, and only the viewer’s private part', () => {
  const state = applyMove(newGame(), { playerId: 'bob', move: { type: 'ready' } });
  const view = playerView(state, 'ann');
  assert.equal(view.you, 'ann');
  assert.deepEqual(view.factions, state.factions);
  assert.equal(view.players.bob.committed, true);
  assert.equal(view.me.committed, false);
  assert.ok(!('rngState' in view), 'the generator state never reaches a client');
  assert.throws(() => playerView(state, 'zed'));
});
