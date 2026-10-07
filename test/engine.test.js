// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  spec, createGame, validate, applyMove, playerView, waitingOn, shuffle, resolveOptions, IllegalMoveError,
  totalPresence, presenceOf, resolveFight, growthDue, cardById, canEnter,
} from '../public/engine.js';
import { botMove } from '../public/bots.js';
import { playOut } from '../scripts/simulate.js';

/** @typedef {import('../public/engine.js').GameState} GameState */

const PLAYERS = ['ann', 'bob', 'cat', 'dan', 'eve'];
const newGame = (seed = 1, players = PLAYERS) => createGame({ seed, players });
/** @param {number} seed */
function rng(seed) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x80000000);
}
/** An empty board to stage a fight on. @param {GameState} state */
function clear(state) {
  const next = structuredClone(state);
  for (const place of Object.values(next.board)) Object.assign(place, { cubes: {}, influence: {}, token: null, scorched: false });
  return next;
}
const [A, B, C] = newGame().factions;
const NEUTRAL = spec.locations.find((l) => l.archetype !== spec.factions.find((f) => f.id === A)?.archetype && l.archetype !== spec.factions.find((f) => f.id === B)?.archetype)?.id ?? 'lighthouse';

// Data ---------------------------------------------------------------------

test('spec holds five archetypes with three factions and three locations each (2.5)', () => {
  for (const archetype of spec.archetypes) {
    assert.equal(spec.factions.filter((f) => f.archetype === archetype.id).length, 3);
    assert.equal(spec.locations.filter((l) => l.archetype === archetype.id).length, 3);
  }
});

test('content ids are unique across every list, cards included', () => {
  const ids = [spec.archetypes, spec.factions, spec.locations, spec.slayerGroups, spec.cards].flat().map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('the pool is 21 cards: five suits of Strike, Shift and Signature, A to D, and the cancel (SU1, PS1, FP2)', () => {
  assert.equal(spec.cards.length, 21);
  for (const a of spec.archetypes) {
    const suit = spec.cards.filter((c) => c.suit === a.id);
    assert.deepEqual(suit.map((c) => [c.slot, c.influence]).sort(), [['shift', 3], ['signature', 4], ['strike', 2]]);
    assert.ok(suit.find((c) => c.slot === 'signature')?.response, `${a.id} Signature carries a response`);
  }
  assert.deepEqual(spec.cards.filter((c) => c.marked).map((c) => c.marked).sort(), ['A', 'B', 'C', 'D']);
  assert.equal(spec.cards.filter((c) => c.response?.id === 'cancel').length, 1);
});

test('the map is symmetric, with five regions of three (layout D)', () => {
  const map = /** @type {Record<string, { adjacent: string[], region: string }>} */ (spec.map.locations);
  for (const [loc, v] of Object.entries(map)) for (const a of v.adjacent) assert.ok(map[a].adjacent.includes(loc), `${loc}–${a}`);
  const regions = Object.values(map).map((v) => v.region);
  for (const r of new Set(regions)) assert.equal(regions.filter((x) => x === r).length, 3);
});

// Setup --------------------------------------------------------------------

test('createGame enforces 3–5 seats and unique names (3.16)', () => {
  assert.throws(() => newGame(1, ['a', 'b']));
  assert.throws(() => newGame(1, ['a', 'b', 'c', 'd', 'e', 'f']));
  assert.throws(() => newGame(1, ['a', 'a', 'b']));
});

test('seeding puts 5 + 1 + 1 of each faction on its own locations (SD1)', () => {
  const s = newGame(4);
  assert.equal(totalPresence(s), 35);
  for (const f of s.factions) {
    assert.equal(presenceOf(s, f), 7);
    assert.equal(s.supply[f], 13);
    const arch = spec.factions.find((x) => x.id === f)?.archetype;
    for (const [loc, place] of Object.entries(s.board)) if (place.cubes[f]) assert.equal(spec.locations.find((l) => l.id === loc)?.archetype, arch);
  }
});

test('each slayer group starts with influence with its linked faction (G.7)', () => {
  const s = newGame(2);
  for (const pid of PLAYERS) {
    const p = s.players[pid];
    const arch = spec.slayerGroups.find((g) => g.id === p.group)?.archetype;
    const linked = s.factions.find((f) => spec.factions.find((x) => x.id === f)?.archetype === arch) ?? '';
    assert.equal(p.standing[linked], 3);
    assert.equal(p.supply, 17);
  }
});

test('hands are 6, 5 or 4 and the rest is left out (PS1)', () => {
  for (const [n, hand, out] of [[3, 6, 3], [4, 5, 1], [5, 4, 1]]) {
    const s = newGame(1, PLAYERS.slice(0, n));
    for (const pid of s.seating) assert.equal(s.players[pid].batch.length, hand);
    assert.equal(s.leftOut.length, out);
  }
});

test('resolveOptions fills defaults and rejects unknown choices', () => {
  assert.equal(resolveOptions({}).rounds, '5');
  assert.throws(() => resolveOptions({ rounds: '99' }));
  assert.throws(() => resolveOptions({ nope: '1' }));
});

test('shuffle is a seeded permutation', () => {
  const a = shuffle([1, 2, 3, 4, 5], 9), b = shuffle([1, 2, 3, 4, 5], 9);
  assert.deepEqual(a, b);
  assert.deepEqual(a.items.slice().sort(), [1, 2, 3, 4, 5]);
});

// The draft ----------------------------------------------------------------

/** @param {GameState} s */
function draftAll(s) {
  let state = s;
  while (state.phase === 'draft') {
    for (const pid of state.seating) {
      const p = state.players[pid];
      state = applyMove(state, { playerId: pid, move: { type: 'pick', keep: [...p.kept, ...p.batch].slice(0, p.kept.length + 1) } });
    }
  }
  return state;
}

test('the draft keeps one more card each pass and ends with full hands (DR3)', () => {
  const s = newGame(5);
  assert.equal(validate(s, { playerId: 'ann', move: { type: 'pick', keep: [] } }).ok, false);
  const after = draftAll(s);
  assert.equal(after.phase, 'play');
  for (const pid of PLAYERS) assert.equal(after.players[pid].hand.length, 4);
});

test('the earliest marked card dealt sets the first player, who must open with it (FP2)', () => {
  const s = draftAll(newGame(6));
  const first = /** @type {string} */ (s.first);
  const marked = s.players[first].hand.filter((c) => cardById(c).marked);
  if (marked.length) {
    assert.equal(validate(s, { playerId: first, move: { type: 'pass' } }).ok, false);
    const other = s.players[first].hand.find((c) => !cardById(c).marked);
    if (other) assert.equal(validate(s, { playerId: first, move: { type: 'play', card: other, use: cardById(other).suit ? 'influence' : 'action' } }).ok, false);
  }
  assert.deepEqual(waitingOn(s), [first]);
});

// Fights -------------------------------------------------------------------

test('the winner loses half the loser\'s cubes, rounded down, minimum 1 (FR5)', () => {
  let s = clear(newGame());
  s.board[NEUTRAL].cubes = { [A]: 6, [B]: 4 };
  let r = resolveFight(s, NEUTRAL);
  assert.deepEqual(r.board[NEUTRAL].cubes, { [A]: 4 });
  s.board[NEUTRAL].cubes = { [A]: 3, [B]: 1 };
  r = resolveFight(s, NEUTRAL);
  assert.deepEqual(r.board[NEUTRAL].cubes, { [A]: 2 });
});

test('a true tie wipes both sides, scorches the location and rewards no one (TF1, TM1)', () => {
  const s = clear(newGame());
  s.board[NEUTRAL].cubes = { [A]: 3, [B]: 3 };
  s.board[NEUTRAL].influence = { ann: 2 };
  const r = resolveFight(s, NEUTRAL);
  assert.equal(r.board[NEUTRAL].scorched, true);
  assert.deepEqual(r.board[NEUTRAL].cubes, {});
  assert.equal(r.players.ann.supply, s.players.ann.supply + 2);
  assert.equal(r.players.ann.trophies[A] + r.players.ann.trophies[B], 0);
  assert.equal(canEnter(r, NEUTRAL, C), false);
});

test('on aligned ground the aligned faction wins a tie (AL2)', () => {
  const s = clear(newGame());
  const home = spec.locations.find((l) => l.archetype === spec.factions.find((f) => f.id === A)?.archetype)?.id ?? '';
  s.board[home].cubes = { [A]: 3, [B]: 3 };
  const r = resolveFight(s, home);
  assert.deepEqual(r.board[home].cubes, { [A]: 2 });
  assert.equal(r.board[home].scorched, false);
});

test('trophies: the leader takes the bigger pile, the runner-up the smaller (TD1); half the leader\'s influence goes to the winner (AF3)', () => {
  const s = clear(newGame());
  s.board[NEUTRAL].cubes = { [A]: 6, [B]: 4 };
  s.board[NEUTRAL].influence = { ann: 4, bob: 1 };
  const r = resolveFight(s, NEUTRAL);
  assert.equal(r.players.ann.trophies[B], 4);
  assert.equal(r.players.bob.trophies[A], 2);
  assert.equal(r.players.ann.standing[A], s.players.ann.standing[A] + 2);
  assert.equal(r.players.ann.supply, s.players.ann.supply + 2);
  assert.equal(r.board[NEUTRAL].influence.bob, 1);
});

test('tied leaders collect nothing and both piles go back (PT2, ST1, AS1); a lone player takes both piles (UP1)', () => {
  const s = clear(newGame());
  for (const pid of PLAYERS) s.players[pid].group = 'slayerettes';
  s.board[NEUTRAL].cubes = { [A]: 6, [B]: 4 };
  s.board[NEUTRAL].influence = { ann: 2, bob: 2 };
  const tied = resolveFight(s, NEUTRAL);
  assert.equal(tied.players.ann.trophies[B] + tied.players.bob.trophies[B], 0);
  assert.equal(tied.supply[B], s.supply[B] + 4);
  s.board[NEUTRAL].influence = { cat: 1 };
  const lone = resolveFight(s, NEUTRAL);
  assert.equal(lone.players.cat.trophies[B], 4);
  assert.equal(lone.players.cat.trophies[A], 2);
});

// Growth and the end -------------------------------------------------------

test('a lone faction with 2 or more cubes grows, aligned locations one extra (GR1, AL3)', () => {
  const s = clear(newGame());
  const home = spec.locations.find((l) => l.archetype === spec.factions.find((f) => f.id === A)?.archetype)?.id ?? '';
  s.board[home].cubes = { [A]: 2 };
  s.board[NEUTRAL].cubes = { [A]: 3 };
  assert.deepEqual(growthDue(s, A), { [home]: 2, [NEUTRAL]: 1 });
});

test('bots play whole games of legal moves at every player count, and a winner is named', () => {
  for (const n of [3, 4, 5]) {
    const end = playOut(newGame(n * 7, PLAYERS.slice(0, n)), rng(n));
    assert.equal(end.phase, 'ended');
    assert.ok(end.result && end.result.players.length >= 1);
  }
});

// Hidden information and responses ------------------------------------------

test('views hide other hands, token faces and trophy totals (3.11, IN2)', () => {
  const s = draftAll(newGame(8));
  const view = playerView(s, 'ann');
  assert.deepEqual(view.me.hand, s.players.ann.hand);
  assert.equal(JSON.stringify(view).includes(JSON.stringify(s.players.bob.hand)), s.players.bob.hand.length === 0);
  assert.equal(view.me.leftOut, null);
  assert.ok(!('trophies' in view.players.bob));
  assert.ok(!JSON.stringify(view.players).includes('trophy'));
});

test('the cancel response stops a card that is in progress (principle 5)', () => {
  let s = draftAll(newGame(11));
  const holder = PLAYERS.find((pid) => s.players[pid].hand.includes('cancel'));
  const actor = /** @type {string} */ (s.first);
  if (!holder || holder === actor) return; // not dealt that way with this seed
  const card = s.players[actor].hand.find((c) => cardById(c).marked) ?? s.players[actor].hand.find((c) => cardById(c).action);
  if (!card) return;
  s = applyMove(s, { playerId: actor, move: { type: 'play', card, use: 'action', target: null } });
  s = applyMove(s, { playerId: holder, move: { type: 'respond', card: 'cancel' } });
  assert.equal(s.pending?.cancelled, true);
  s = applyMove(s, { playerId: actor, move: { type: 'confirm' } });
  assert.equal(s.pending, null);
  assert.ok(!s.players[holder].hand.includes('cancel'));
});

test('illegal moves throw IllegalMoveError and leave the state untouched', () => {
  const s = newGame();
  const before = JSON.stringify(s);
  assert.throws(() => applyMove(s, { playerId: 'zed', move: { type: 'pass' } }), IllegalMoveError);
  assert.throws(() => applyMove(s, { playerId: 'ann', move: { type: 'pass' } }), IllegalMoveError);
  assert.equal(JSON.stringify(s), before);
  void botMove;
});
