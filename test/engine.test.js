// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fightsDue,
  spec, createGame, validate, applyMove, playerView, waitingOn, shuffle, resolveOptions, IllegalMoveError,
  totalPresence, presenceOf, resolveFight, growthDue, cardById, canEnter, nextChoice, previewTarget, checkTarget, printedOf, sampleTarget, deckOf, factionOfArchetype,
} from '../public/engine.js';
import { botMove, fast } from '../public/bots.js';
import cardStrength from '../public/card-strength.json' with { type: 'json' };
import { playOut } from '../scripts/lib.js';

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
  for (const place of Object.values(next.board)) Object.assign(place, { tokens: {}, sway: {}, token: null, scorched: false });
  // Standing with every faction, so moves can pay for the sway they place (IC1); tests of IC1 set it themselves.
  for (const p of Object.values(next.players)) p.standing = Object.fromEntries(next.factions.map((f) => [f, 10]));
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

test('the pool is 21 cards: five suits of Strike, Shift and Signature, and six unsuited, open slots filled from the unmarked (SU1, PS1, FP2)', () => {
  for (const deck of ['fixed', 'mixed']) {
    const g = createGame({ seed: 3, players: PLAYERS, options: { deck } });
    assert.equal(deckOf(g).length, 21);
    assert.equal(new Set(deckOf(g)).size, 21);
    assert.equal(deckOf(g).filter((id) => !cardById(id).suit).length, 6);
  }
  for (const a of spec.archetypes) {
    const suit = spec.cards.filter((c) => c.suit === a.id);
    assert.deepEqual(suit.map((c) => [c.slot, c.sway]).sort(), [['shift', 3], ['signature', 4], ['strike', 2]]);
    assert.ok(suit.find((c) => c.slot === 'signature')?.response, `${a.id} Signature carries a response`);
  }
  assert.deepEqual(spec.cards.filter((c) => c.marked).map((c) => c.marked).sort(), ['A', 'C', 'D']); // B to come
  assert.equal(spec.cards.filter((c) => c.action === 'move-sway').length, 1); // Plan B, one copy
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

test('seeding=home puts 5 + 1 + 1 of each faction on its own locations (SD1 as first drafted)', () => {
  const s = createGame({ seed: 4, players: PLAYERS, options: { seeding: 'home' } });
  assert.equal(totalPresence(s), 35);
  for (const f of s.factions) {
    assert.equal(presenceOf(s, f), 7);
    assert.equal(s.supply[f], 13);
    const arch = spec.factions.find((x) => x.id === f)?.archetype;
    for (const [loc, place] of Object.entries(s.board)) if (place.tokens[f]) assert.equal(spec.locations.find((l) => l.id === loc)?.archetype, arch);
  }
});

test('starting setup: more standing with the affinity faction, 1 with each other, 1 sway on each affinity location (designer)', () => {
  const s = newGame(2);
  const def = (/** @type {string} */ id) => Number(spec.variants.find((v) => v.id === id)?.default);
  for (const pid of PLAYERS) {
    const p = s.players[pid];
    const arch = spec.slayerGroups.find((g) => g.id === p.group)?.archetype;
    const linked = s.factions.find((f) => spec.factions.find((x) => x.id === f)?.archetype === arch) ?? '';
    assert.equal(p.standing[linked], def('startSway'));
    for (const f of s.factions.filter((x) => x !== linked)) assert.equal(p.standing[f], def('startOthers'));
    const mine = spec.locations.filter((l) => l.archetype === arch).map((l) => s.board[l.id].sway[pid] ?? 0);
    assert.deepEqual(mine, [1, 1, 1].map(() => def('startBoard')));
    assert.equal(p.supply, def('playerCubes') - def('startSway') - 4 * def('startOthers') - 3 * def('startBoard'));
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
    if (other) assert.equal(validate(s, { playerId: first, move: { type: 'play', card: other, use: cardById(other).suit ? 'sway' : 'action' } }).ok, false);
  }
  assert.deepEqual(waitingOn(s), [first]);
});

// Fights -------------------------------------------------------------------

test('the winner loses half the loser\'s tokens, rounded down, minimum 1 (FR5)', () => {
  let s = clear(newGame());
  s.board[NEUTRAL].tokens = { [A]: 6, [B]: 4 };
  let r = resolveFight(s, NEUTRAL);
  assert.deepEqual(r.board[NEUTRAL].tokens, { [A]: 4 });
  s.board[NEUTRAL].tokens = { [A]: 3, [B]: 1 };
  r = resolveFight(s, NEUTRAL);
  assert.deepEqual(r.board[NEUTRAL].tokens, { [A]: 2 });
});

test('a true tie wipes both sides, scorches the location and rewards no one (TF1, TM1)', () => {
  const s = clear(newGame());
  s.board[NEUTRAL].tokens = { [A]: 3, [B]: 3 };
  s.board[NEUTRAL].sway = { ann: 2 };
  const r = resolveFight(s, NEUTRAL);
  assert.equal(r.board[NEUTRAL].scorched, true);
  assert.deepEqual(r.board[NEUTRAL].tokens, {});
  assert.equal(r.players.ann.supply, s.players.ann.supply + 2);
  assert.equal(r.players.ann.trophies[A] + r.players.ann.trophies[B], 0);
  assert.equal(canEnter(r, NEUTRAL, C), false);
});

test('on aligned ground the aligned faction wins a tie (AL2)', () => {
  const s = clear(newGame());
  const home = spec.locations.find((l) => l.archetype === spec.factions.find((f) => f.id === A)?.archetype)?.id ?? '';
  s.board[home].tokens = { [A]: 3, [B]: 3 };
  const r = resolveFight(s, home);
  assert.deepEqual(r.board[home].tokens, { [A]: 2 });
  assert.equal(r.board[home].scorched, false);
});

test('trophies: the leader takes the bigger pile, the runner-up the smaller (TD1); half the leader\'s sway goes to the winner (AF3)', () => {
  const s = clear(newGame());
  s.board[NEUTRAL].tokens = { [A]: 6, [B]: 4 };
  s.board[NEUTRAL].sway = { ann: 4, bob: 1 };
  const r = resolveFight(s, NEUTRAL);
  assert.equal(r.players.ann.trophies[B], 4);
  assert.equal(r.players.bob.trophies[A], 2);
  assert.equal(r.players.ann.standing[A], s.players.ann.standing[A] + 2);
  assert.equal(r.players.ann.supply, s.players.ann.supply + 2);
  assert.equal(r.board[NEUTRAL].sway.bob, 1);
});

test('tied leaders collect nothing and both piles go back (PT2, ST1, AS1); a lone player takes both piles (UP1)', () => {
  const s = clear(newGame());
  for (const pid of PLAYERS) s.players[pid].group = 'slayerettes';
  s.board[NEUTRAL].tokens = { [A]: 6, [B]: 4 };
  s.board[NEUTRAL].sway = { ann: 2, bob: 2 };
  const tied = resolveFight(s, NEUTRAL);
  assert.equal(tied.players.ann.trophies[B] + tied.players.bob.trophies[B], 0);
  assert.equal(tied.supply[B], s.supply[B] + 4);
  s.board[NEUTRAL].sway = { cat: 1 };
  const lone = resolveFight(s, NEUTRAL);
  assert.equal(lone.players.cat.trophies[B], 4);
  assert.equal(lone.players.cat.trophies[A], 2);
});

// Growth and the end -------------------------------------------------------

test('a lone faction with 2 or more tokens grows, aligned locations one extra (GR1, AL3)', () => {
  const s = clear(newGame());
  const home = spec.locations.find((l) => l.archetype === spec.factions.find((f) => f.id === A)?.archetype)?.id ?? '';
  s.board[home].tokens = { [A]: 2 };
  s.board[NEUTRAL].tokens = { [A]: 3 };
  assert.deepEqual(growthDue(s, A), { [home]: 2, [NEUTRAL]: 1 });
});

test('bots play whole games of legal moves at every player count, and a winner is named', () => {
  for (const n of [3, 4, 5]) {
    const g = newGame(n * 7, PLAYERS.slice(0, n));
    const end = playOut(g, rng(n), undefined, Object.fromEntries(g.seating.map((pid) => [pid, fast('trophy')])));
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

test('illegal moves throw IllegalMoveError and leave the state untouched', () => {
  const s = newGame();
  const before = JSON.stringify(s);
  assert.throws(() => applyMove(s, { playerId: 'zed', move: { type: 'pass' } }), IllegalMoveError);
  assert.throws(() => applyMove(s, { playerId: 'ann', move: { type: 'pass' } }), IllegalMoveError);
  assert.equal(JSON.stringify(s), before);
  void botMove;
});

// Step-by-step targets (nextChoice): only candidates that do something -----

test('Track Them in the Snow lights only groups you can chase, and counts the steps left', () => {
  const s = clear(newGame());
  const f = /** @type {string} */ (s.factions[0]); // the Nocturnal faction
  const loc = /** @type {string} */ (spec.locations.find((l) => l.archetype === 'nocturnals')?.id);
  s.board[loc].tokens[f] = 3;
  s.players.ann.standing[f] = 0;
  const groups = (/** @type {any} */ c) => c.kind === 'group' ? c.options : [];
  assert.deepEqual(groups(nextChoice(s, 'ann', 'track-snow', { mode: 'faction' })), []);
  s.players.ann.standing[f] = 2;
  assert.deepEqual(groups(nextChoice(s, 'ann', 'track-snow', { mode: 'faction' })), [{ location: loc, faction: f }]);
  const step = nextChoice(s, 'ann', 'track-snow', { mode: 'faction', location: loc, faction: f });
  assert.equal(step.kind === 'location' && step.left, 2);
});

test('Light of the Cross (reworked from Board Up the Windows) splits a group evenly between two adjacent locations, both paid for (designer, 2026-10-15)', () => {
  const s = clear(newGame());
  const f = /** @type {string} */ (factionOfArchetype(s, 'demonic'));
  const loc = /** @type {string} */ (spec.locations.find((l) => l.archetype === 'demonic')?.id);
  const [p, q, r] = /** @type {Record<string, { adjacent: string[] }>} */ (spec.map.locations)[loc].adjacent;
  s.board[loc].tokens[f] = 5;
  const base = { mode: /** @type {const} */ ('faction'), location: loc, faction: f };
  assert.equal(checkTarget(s, 'ann', cardById('light-cross'), { ...base, split: { [p]: 3, [q]: 2 } }), null); // the odd token goes where the player sends it
  assert.ok(checkTarget(s, 'ann', cardById('light-cross'), { ...base, split: { [p]: 4, [q]: 1 } })); // not even
  if (r) assert.ok(checkTarget(s, 'ann', cardById('light-cross'), { ...base, split: { [p]: 2, [q]: 2, [r]: 1 } })); // exactly two locations
  // Step by step: once one side has 3 of 5, the other takes the rest, and no third location is offered.
  const c = nextChoice(s, 'ann', 'light-cross', { ...base, split: { [p]: 3, [q]: 1 } });
  assert.ok(c.kind === 'split' && c.options.length === 1 && c.options[0] === q);
  const after = previewTarget(s, 'ann', 'light-cross', { ...base, split: { [p]: 3, [q]: 2 } });
  assert.deepEqual([after.board[p].tokens[f], after.board[q].tokens[f], after.board[loc].tokens[f], after.board[p].sway.ann, after.board[q].sway.ann], [3, 2, undefined, 1, 1]);
  s.players.ann.standing[f] = 1;
  assert.ok(checkTarget(s, 'ann', cardById('light-cross'), { ...base, split: { [p]: 3, [q]: 2 } })); // can't pay both: can't play
  s.players.ann.standing[f] = 10;
  s.board[loc].tokens[f] = 1;
  assert.ok(checkTarget(s, 'ann', cardById('light-cross'), { ...base, split: { [p]: 1 } })); // a group of 1 can't be split
});

test('Broadcast a Signal offers only factions that can enter the target', () => {
  const s = clear(newGame());
  const [x, y, z] = s.factions;
  const to = /** @type {string} */ (spec.locations.find((l) => l.archetype === 'scifi')?.id);
  s.board[to].tokens = { [/** @type {string} */ (x)]: 1, [/** @type {string} */ (y)]: 1 };
  const far = /** @type {string} */ (spec.locations.find((l) => l.id !== to)?.id);
  s.board[far].tokens[/** @type {string} */ (z)] = 2;
  const c = nextChoice(s, 'ann', 'broadcast', { mode: 'location', location: to });
  assert.ok(c.kind === 'faction' && !c.options.includes(/** @type {string} */ (z)));
});

test('Track Them in the Snow never enters a location twice', () => {
  const s = clear(newGame());
  const f = /** @type {string} */ (s.factions[0]);
  const adj = /** @type {Record<string, { adjacent: string[] }>} */ (spec.map.locations);
  const loc = /** @type {string} */ (spec.locations.find((l) => l.archetype === 'nocturnals')?.id);
  s.board[loc].tokens[f] = 4;
  s.players.ann.standing[f] = 4;
  const a = adj[loc].adjacent[0];
  const c = nextChoice(s, 'ann', 'track-snow', { mode: 'faction', location: loc, faction: f, path: [a] });
  assert.ok(c.kind === 'location' && !c.options.includes(a) && !c.options.includes(loc));
});

test('Leave Out Fresh Meat asks which group comes when the largest are tied', () => {
  const s = clear(newGame());
  const adj = /** @type {Record<string, { adjacent: string[] }>} */ (spec.map.locations);
  const bait = /** @type {string} */ (spec.locations.find((l) => l.archetype === 'nocturnals' && adj[l.id].adjacent.length >= 2)?.id);
  const [x, y] = adj[bait].adjacent;
  s.board[x].tokens[/** @type {string} */ (s.factions[1])] = 3;
  s.board[y].tokens[/** @type {string} */ (s.factions[2])] = 3;
  const c = nextChoice(s, 'ann', 'fresh-meat', { mode: 'location', location: bait });
  assert.ok(c.kind === 'group' && c.key === 'lure' && c.options.length === 2);
  assert.equal(nextChoice(s, 'ann', 'fresh-meat', { mode: 'location', location: bait, faction: s.factions[2], from: [y] }).kind, 'done');
});

// Round 8 test cards (spec.testCards): never dealt in a fixed deck, measured by scripts/tournament.js.

test('a fixed deck deals test cards only into open unsuited slots', () => {
  const s = createGame({ seed: 1, players: PLAYERS, options: { deck: 'fixed' } });
  const dealt = s.seating.flatMap((pid) => s.players[pid].batch).concat(s.leftOut);
  const tests = dealt.filter((id) => spec.testCards.cards.some((c) => c.id === id));
  assert.equal(tests.length, 6 - spec.cards.filter((c) => !c.suit).length);
  for (const id of tests) assert.ok(!cardById(id).suit && !cardById(id).marked);
});

test('a mixed deck: one Strike, Shift and Signature per suit, 2/3/4 sway weighted to strength (D12), the marked extras kept, the other unsuited slots drawn from the unmarked', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const s = createGame({ seed, players: PLAYERS, options: { deck: 'mixed' } });
    const deck = /** @type {string[]} */ (s.deck);
    assert.equal(deck.length, 21);
    const dealt = s.seating.flatMap((pid) => s.players[pid].batch).concat(s.leftOut);
    assert.deepEqual([...dealt].sort(), [...deck].sort());
    for (const arch of spec.archetypes) {
      const mine = deck.map((id) => cardById(id)).filter((c) => c.suit === arch.id);
      assert.deepEqual(mine.map((c) => c.slot).sort(), ['shift', 'signature', 'strike']);
      assert.deepEqual(mine.map((c) => printedOf(s, c.id)).sort(), [2, 3, 4]);
      // Weighted to strength (D12): a weaker action never prints less than a stronger one.
      const strength = (/** @type {string} */ id) => /** @type {Record<string, number>} */ (cardStrength.strength)[id] ?? -Infinity;
      for (const x of mine) for (const y of mine) if (strength(x.id) < strength(y.id)) assert.ok(printedOf(s, x.id) > printedOf(s, y.id), `${x.id} vs ${y.id}`);
    }
    for (const c of spec.cards.filter((x) => !x.suit && x.marked)) assert.ok(deck.includes(c.id));
    const unmarked = deck.map((id) => cardById(id)).filter((c) => !c.suit && !c.marked);
    assert.equal(unmarked.length, 6 - spec.cards.filter((x) => !x.suit && x.marked).length);
  }
});

test('bots can target every test card that has a target (a walk through the table\'s choices)', () => {
  const s = clear(newGame());
  const [f, g] = /** @type {string[]} */ (s.factions);
  for (const loc of spec.locations.map((l) => l.id)) s.board[loc].tokens = { [loc.length % 2 ? f : g]: 3 };
  for (const card of spec.testCards.cards.filter((c) => c.action && c.action !== 'token' && c.action !== 'cash-in' && c.action !== 'surveil')) {
    const t = sampleTarget(s, 'ann', card.id, rng(7));
    if (t) assert.equal(checkTarget(s, 'ann', cardById(card.id), t), null, card.id);
  }
});

test('Leak It to the Press sends half the group anywhere (round 9)', () => {
  const s = clear(newGame());
  const f = /** @type {string} */ (s.factions[0]);
  const loc = /** @type {string} */ (spec.locations.find((l) => l.archetype === 'scifi')?.id);
  const far = /** @type {string} */ (spec.locations.find((l) => l.id !== loc && !(/** @type {Record<string, { adjacent: string[] }>} */ (spec.map.locations))[loc].adjacent.includes(l.id))?.id);
  s.board[loc].tokens[f] = 5;
  const t = { mode: /** @type {const} */ ('location'), location: loc, faction: f, to: far };
  assert.equal(checkTarget(s, 'ann', cardById('leak-press'), t), null);
  assert.equal(previewTarget(s, 'ann', 'leak-press', t).board[far].tokens[f], 2);
});

test('Turn On the Tractor Beam carries both groups of a contest to an empty neighbour (round 10)', () => {
  const s = clear(newGame());
  s.options = { ...s.options, fightHalf: 'off' }; // the first draft's movement: whole groups may leave a fight
  const [f, g] = /** @type {string[]} */ (s.factions);
  const adj = /** @type {Record<string, { adjacent: string[] }>} */ (spec.map.locations);
  const loc = /** @type {string} */ (spec.locations.find((l) => l.archetype === 'scifi')?.id);
  const [to] = adj[loc].adjacent;
  s.board[loc].tokens = { [f]: 2, [g]: 4 };
  const t = { mode: /** @type {const} */ ('location'), location: loc, to, lead: f };
  assert.equal(checkTarget(s, 'ann', cardById('tractor-beam'), t), null);
  assert.deepEqual(previewTarget(s, 'ann', 'tractor-beam', t).board[to].tokens, { [f]: 2, [g]: 4 });
  s.board[to].tokens = { [f]: 1 };
  assert.ok(checkTarget(s, 'ann', cardById('tractor-beam'), t)); // only into a location with no tokens
});

test('Hear the Banshee Wail drives each neighbouring group one hex straight on, away (round 10)', () => {
  const s = clear(newGame());
  const f = /** @type {string} */ (s.factions[0]);
  const map = /** @type {Record<string, { q: number, r: number, adjacent: string[] }>} */ (spec.map.locations);
  const at = (/** @type {number} */ q, /** @type {number} */ r) => Object.keys(map).find((l) => map[l].q === q && map[l].r === r);
  // A straight line of three locations: centre, neighbour, and the hex beyond.
  const undead = spec.locations.filter((l) => l.archetype === 'undead').map((l) => l.id);
  const line = undead.flatMap((c) => map[c].adjacent.map((n) => [c, n, at(2 * map[n].q - map[c].q, 2 * map[n].r - map[c].r)])).find((x) => x[2]);
  const [centre, near, beyond] = /** @type {string[]} */ (line);
  s.board[near].tokens[f] = 3;
  const after = previewTarget(s, 'ann', 'banshee', { mode: 'location', location: centre });
  assert.equal(after.board[beyond].tokens[f], 3);
  assert.equal(after.board[near].tokens[f], undefined);
});

test('Trade Souls swaps two groups of different factions anywhere (round 11)', () => {
  const s = clear(newGame());
  s.options = { ...s.options, fightHalf: 'off' }; // the first draft's movement: whole groups may leave a fight
  const [f, g, h] = /** @type {string[]} */ (s.factions);
  const demonic = /** @type {string} */ (spec.locations.find((l) => l.archetype === 'demonic')?.id);
  const far = /** @type {string} */ (spec.locations.find((l) => l.archetype === 'nocturnals')?.id);
  s.board[demonic].tokens = { [f]: 2 };
  s.board[far].tokens = { [g]: 5, [h]: 1 };
  const t = { mode: /** @type {const} */ ('location'), location: demonic, faction: f, moves: [{ location: far, faction: g, to: '' }] };
  assert.equal(checkTarget(s, 'ann', cardById('trade-souls'), t), null);
  const after = previewTarget(s, 'ann', 'trade-souls', t);
  assert.deepEqual(after.board[demonic].tokens, { [g]: 5 });
  assert.deepEqual(after.board[far].tokens, { [h]: 1, [f]: 2 });
  s.board[far].tokens = { [f]: 5 };
  assert.ok(checkTarget(s, 'ann', cardById('trade-souls'), { ...t, moves: [{ location: far, faction: f, to: '' }] })); // a group of the same faction: nothing to trade
});

test('a pulled card (spec: pulled) stays built but is never dealt in the mixed playtesting deck (designer, 2026-10-15)', () => {
  const gone = [...spec.cards, ...spec.testCards.cards].filter((c) => 'pulled' in c && c.pulled).map((c) => c.id);
  assert.ok(gone.includes('call-truce') && gone.includes('trade-souls'));
  for (let seed = 1; seed <= 40; seed++) {
    const deck = createGame({ seed, players: PLAYERS, options: { deck: 'mixed' } }).deck ?? [];
    assert.equal(deck.filter((id) => gone.includes(id)).length, 0);
  }
  assert.ok(cardById('trade-souls') && cardById('call-truce')); // still built
});

test('Invite Them In: two lone groups next door come whole into an empty ◐ location; 1 sway where each left and 1 at the fight (designer, 2026-10-15)', () => {
  const s = clear(newGame());
  const map = /** @type {Record<string, { adjacent: string[] }>} */ (spec.map.locations);
  const noct = /** @type {string} */ (factionOfArchetype(s, 'nocturnals'));
  const [f, g, h] = s.factions.filter((x) => x !== noct);
  const to = /** @type {string} */ (spec.locations.find((l) => l.archetype === 'nocturnals' && map[l.id].adjacent.length >= 3)?.id);
  const [a, b, c] = map[to].adjacent;
  s.board[a].tokens = { [f]: 3 };
  s.board[b].tokens = { [g]: 4 };
  s.board[c].tokens = { [f]: 2, [h]: 2 }; // engaged: never invited
  s.players.ann.standing = Object.fromEntries(s.factions.map((x) => [x, 0]));
  s.players.ann.standing[f] = 2; s.players.ann.standing[g] = 1;
  const offered = nextChoice(s, 'ann', 'invite-in', { mode: 'location', location: to });
  assert.ok(offered.kind === 'group' && offered.options.every((o) => o.location !== c));
  const t = { mode: /** @type {const} */ ('location'), location: to, moves: [{ location: a, faction: f, to: '' }, { location: b, faction: g, to: '' }], payer: f };
  assert.equal(checkTarget(s, 'ann', cardById('invite-in'), t), null);
  const after = previewTarget(s, 'ann', 'invite-in', t);
  assert.deepEqual(after.board[to].tokens, { [f]: 3, [g]: 4 });
  assert.deepEqual([after.board[a].sway.ann, after.board[b].sway.ann, after.board[to].sway.ann, after.players.ann.standing[f], after.players.ann.standing[g]], [1, 1, 1, 0, 0]);
  assert.ok(checkTarget(s, 'ann', cardById('invite-in'), { ...t, payer: g })); // g can't pay twice: all or nothing
  // Faction reading: a lone Nocturnal group next door comes into a lone host's location (2 Nocturnal sway).
  const q = clear(newGame());
  q.board[to].tokens = { [f]: 2 };
  q.board[a].tokens = { [noct]: 3 };
  q.players.ann.standing[noct] = 2;
  const ft = { mode: /** @type {const} */ ('faction'), location: to, moves: [{ location: a, faction: noct, to: '' }] };
  assert.equal(checkTarget(q, 'ann', cardById('invite-in'), ft), null);
  const fa = previewTarget(q, 'ann', 'invite-in', ft);
  assert.deepEqual([fa.board[to].tokens[noct], fa.board[a].sway.ann, fa.board[to].sway.ann], [3, 1, 1]);
  q.players.ann.standing[noct] = 1;
  assert.ok(checkTarget(q, 'ann', cardById('invite-in'), ft));
});

test('The Gate joins two locations: one location for movement, one fight (designer, 2026-10-17)', () => {
  const s = clear(newGame());
  const sci = /** @type {string} */ (factionOfArchetype(s, 'scifi'));
  const [f, g, h] = s.factions.filter((x) => x !== sci);
  const a = 'military-facility', b = 'state-park';
  s.board[a].tokens = { [f]: 3 };
  s.board[b].tokens = { [g]: 2 };
  s.players.ann.standing = Object.fromEntries(s.factions.map((x) => [x, 1]));
  const t = { mode: /** @type {const} */ ('location'), location: a, to: b, payer: f, losses: a };
  assert.equal(checkTarget(s, 'ann', cardById('gate'), t), null);
  s.board[b].tokens = { [g]: 2, [h]: 1 };
  assert.ok(checkTarget(s, 'ann', cardById('gate'), t)); // three factions across the two: no
  s.board[b].tokens = { [g]: 2 };
  s.players.ann.standing[f] = 0;
  assert.ok(checkTarget(s, 'ann', cardById('gate'), t)); // can't pay: can't play
  s.players.ann.standing[f] = 1;
  const joined = /** @type {GameState} */ ({ ...s, ...previewTarget(s, 'ann', 'gate', t) });
  assert.deepEqual([joined.board[a].gate, joined.board[b].gate, joined.board[a].sway.ann, joined.players.ann.standing[f]], [b, a, 1, 0]);
  assert.deepEqual(fightsDue(joined).sort(), [a, b].sort()); // the two lone groups now fight
  // The joined fight: 3 against 2; the winner's 1 loss from the chosen end; trophies by sway across both ends.
  joined.board[a].sway = { ann: 2 };
  joined.board[b].sway = { bob: 1 };
  const fought = resolveFight(joined, a);
  assert.deepEqual([fought.board[a].tokens, fought.board[b].tokens], [{ [f]: 2 }, {}]);
  assert.deepEqual([fought.players.ann.trophies[g], fought.players.bob.trophies[f]], [2, 1]);
  assert.deepEqual([fought.board[a].sway.ann, fought.board[b].sway.bob, fought.board[a].gate], [undefined, 1, undefined]); // the leader's sway converts; the runner-up's stays where it was
  // A true tie on neutral ground scorches both ends.
  const tie = structuredClone(joined);
  tie.board[a].tokens = { [f]: 2 };
  if (![f, g].some((x) => [a, b].some((l) => spec.locations.find((L) => L.id === l)?.archetype === spec.factions.find((F) => F.id === x)?.archetype))) {
    const burnt = resolveFight(tie, b);
    assert.deepEqual([burnt.board[a].scorched, burnt.board[b].scorched], [true, true]);
  }
});

test('The Gate: a group at both ends moves as one, and next door reaches through it (designer, 2026-10-17)', () => {
  const s = clear(newGame());
  const sci = /** @type {string} */ (factionOfArchetype(s, 'scifi'));
  const [f, g] = s.factions.filter((x) => x !== sci);
  const a = 'military-facility', b = 'state-park';
  s.board[a].tokens = { [f]: 3 };
  s.board[b].tokens = { [f]: 2 };
  s.board[a].gate = b; s.board[b].gate = a;
  const far = /** @type {string} */ (Object.keys(s.board).find((l) => ![a, b].includes(l) && !/** @type {Record<string, { adjacent: string[] }>} */ (spec.map.locations)[a].adjacent.includes(l)));
  const beamed = previewTarget(s, 'ann', 'beam', { mode: 'location', location: a, faction: f, to: far });
  assert.deepEqual([beamed.board[far].tokens[f], beamed.board[a].tokens[f], beamed.board[b].tokens[f]], [5, undefined, undefined]);
  // Invite Them In at the Ski Resort: the Military Facility is next door, so its Gate partner's group is too.
  const q = clear(newGame());
  q.board['military-facility'].gate = b; q.board[b].gate = 'military-facility';
  q.board[b].tokens = { [g]: 2 };
  q.board.junkyard.tokens = { [f]: 1 };
  const offered = nextChoice(q, 'ann', 'invite-in', { mode: 'location', location: 'ski-resort' });
  assert.ok(offered.kind === 'group' && offered.options.some((o) => o.faction === g));
});

test('Spoof the Signal: a lone group marches on the largest lone rival within two locations (designer, 2026-10-17)', () => {
  const s = clear(newGame());
  const map = /** @type {Record<string, { adjacent: string[] }>} */ (spec.map.locations);
  const sent = /** @type {string} */ (factionOfArchetype(s, 'sentients'));
  const [f, g, h] = s.factions.filter((x) => x !== sent);
  const from = /** @type {string} */ (spec.locations.find((l) => l.archetype === 'sentients')?.id);
  const one = map[from].adjacent[0];
  const two = /** @type {string} */ (map[one].adjacent.find((l) => l !== from && !map[from].adjacent.includes(l)));
  s.board[from].tokens = { [f]: 4 };
  s.board[one].tokens = { [g]: 3 };
  s.board[two].tokens = { [h]: 5 };
  s.players.ann.standing[f] = 2;
  const c = nextChoice(s, 'ann', 'hack-targeting', { mode: 'location', location: from, faction: f });
  assert.ok(c.kind === 'location' && c.options.length === 1 && c.options[0] === two); // the largest in reach, two away
  const t = { mode: /** @type {const} */ ('location'), location: from, faction: f, to: two };
  assert.equal(checkTarget(s, 'ann', cardById('hack-targeting'), t), null);
  assert.ok(checkTarget(s, 'ann', cardById('hack-targeting'), { ...t, to: one })); // not the largest
  const after = previewTarget(s, 'ann', 'hack-targeting', t);
  assert.deepEqual([after.board[two].tokens[f], after.board[from].tokens[f], after.board[from].sway.ann, after.board[two].sway.ann], [4, undefined, 1, 1]);
  s.players.ann.standing[f] = 1;
  assert.ok(checkTarget(s, 'ann', cardById('hack-targeting'), t)); // can't pay both: can't play
});

test('Bait the Herd: a herd swells with its own kind along a trail, leaving nothing behind, and crashes into a lone rival (designer, 2026-10-17)', () => {
  const s = clear(newGame());
  s.options = { ...s.options, fightHalf: 'off' }; // the straggler scoop (the core rule D22 forbids moving a single token out of a fight)
  const map = /** @type {Record<string, { adjacent: string[] }>} */ (spec.map.locations);
  const und = /** @type {string} */ (factionOfArchetype(s, 'undead'));
  const [f, g, h] = s.factions.filter((x) => x !== und);
  const start = 'sawmill', stop = 'lake-house', scoop = 'mine';
  const crash = /** @type {string} */ (map[scoop].adjacent.find((l) => ![start, stop].includes(l) && !map[start].adjacent.includes(l) && !map[stop].adjacent.includes(l)) ?? map[scoop].adjacent.find((l) => ![start, stop].includes(l)));
  s.board[start].tokens = { [und]: 2 };
  s.board[stop].tokens = { [und]: 3 };
  s.board[scoop].tokens = { [und]: 1, [g]: 4 }; // a lone straggler in a fight: scooped out
  s.board[crash].tokens = { [h]: 2 };
  s.players.ann.standing[und] = 4;
  const t = { mode: /** @type {const} */ ('location'), location: start, faction: und, path: [stop, scoop, crash] };
  assert.equal(checkTarget(s, 'ann', cardById('bait-trail'), t), null);
  const after = previewTarget(s, 'ann', 'bait-trail', t);
  assert.deepEqual([after.board[crash].tokens[und], after.board[start].tokens[und], after.board[stop].tokens[und], after.board[scoop].tokens], [6, undefined, undefined, { [g]: 4 }]);
  assert.deepEqual([start, stop, scoop, crash].map((l) => after.board[l].sway.ann), [1, 1, 1, 1]);
  const moved = previewTarget(s, 'ann', 'bait-trail', { ...t, path: [stop] }); // plain movement: it stops at its first stop
  assert.deepEqual([moved.board[stop].tokens[und], moved.board[start].tokens[und], moved.board[start].sway.ann, moved.board[stop].sway.ann], [5, undefined, 1, 1]);
  s.players.ann.standing[und] = 3;
  assert.ok(checkTarget(s, 'ann', cardById('bait-trail'), t)); // 4 locations, 3 sway: can't play
  s.players.ann.standing[und] = 4;
  s.board[scoop].tokens = { [und]: 2, [g]: 4 };
  assert.deepEqual(previewTarget(s, 'ann', 'bait-trail', t).board[scoop].tokens, { [g]: 4 }); // D22 off: the card takes all of its kind
  // Under D22 (the default): from a fight its kind is in, the herd takes half, rounded down; a lone straggler can't leave.
  const d22 = { ...s, options: { ...s.options, fightHalf: 'on' } };
  d22.board[scoop].tokens = { [und]: 1, [g]: 4 };
  assert.ok(checkTarget(d22, 'ann', cardById('bait-trail'), t));
  d22.board[scoop].tokens = { [und]: 5, [g]: 4 };
  assert.equal(checkTarget(d22, 'ann', cardById('bait-trail'), t), null);
  assert.deepEqual(previewTarget(d22, 'ann', 'bait-trail', t).board[scoop].tokens, { [und]: 3, [g]: 4 }); // 2 of 5 come; the fight goes on
  void f;
});

test('Perform the Ritual: one faction next door is drawn in; lone groups whole, up to half out of fights (designer, 2026-10-17)', () => {
  const s = clear(newGame());
  const map = /** @type {Record<string, { adjacent: string[] }>} */ (spec.map.locations);
  const dem = /** @type {string} */ (factionOfArchetype(s, 'demonic'));
  const [f, g, h] = s.factions.filter((x) => x !== dem);
  const centre = /** @type {string} */ (spec.locations.find((l) => l.archetype === 'demonic' && map[l.id].adjacent.length >= 3)?.id);
  const [x, y, z] = map[centre].adjacent;
  s.board[x].tokens = { [f]: 3 };
  s.board[y].tokens = { [f]: 3, [g]: 2 }; // a fight: up to 1 of the 3 may answer
  s.board[z].tokens = { [h]: 2 };
  s.players.ann.standing[f] = 3;
  const t = { mode: /** @type {const} */ ('location'), location: centre, faction: f, from: [y] };
  assert.equal(checkTarget(s, 'ann', cardById('ritual'), t), null);
  assert.ok(checkTarget(s, 'ann', cardById('ritual'), { ...t, from: [y, y] })); // more than half
  const after = previewTarget(s, 'ann', 'ritual', t);
  assert.deepEqual([after.board[centre].tokens[f], after.board[x].tokens[f], after.board[y].tokens[f], after.board[z].tokens[h]], [4, undefined, 2, 2]);
  assert.deepEqual([x, y, centre].map((l) => after.board[l].sway.ann), [1, 1, 1]);
  s.players.ann.standing[f] = 2;
  assert.ok(checkTarget(s, 'ann', cardById('ritual'), t)); // 3 locations, 2 sway: can't play
  assert.equal(checkTarget(s, 'ann', cardById('ritual'), { ...t, from: [] }), null); // the lone group alone: 2 sway
  // Faction reading: the Demons next door, into any location.
  const q = clear(newGame());
  q.board[x].tokens = { [dem]: 2 };
  q.board[centre].tokens = { [f]: 2 };
  q.players.ann.standing[dem] = 2;
  const fa = previewTarget(q, 'ann', 'ritual', { mode: 'faction', location: centre, faction: dem });
  assert.deepEqual(fa.board[centre].tokens, { [f]: 2, [dem]: 2 });
});

test('Half from a fight (D22, designer 2026-10-17): from a fight, a card moves at most half a group, rounded down', () => {
  const s = clear(newGame());
  const [f, g] = /** @type {string[]} */ (s.factions);
  const map = /** @type {Record<string, { adjacent: string[] }>} */ (spec.map.locations);
  const from = /** @type {string} */ (spec.locations.find((l) => l.archetype === 'undead')?.id);
  const to = map[from].adjacent[0];
  s.board[from].tokens = { [f]: 5, [g]: 2 };
  const horde = { mode: /** @type {const} */ ('location'), location: from, faction: f, to };
  assert.equal(previewTarget({ ...s, options: { ...s.options, fightHalf: 'off' } }, 'ann', 'horde', horde).board[to].tokens[f], 5); // off: the whole group
  const on = { ...s, options: { ...s.options, fightHalf: 'on' } };
  const after = previewTarget(on, 'ann', 'horde', horde);
  assert.deepEqual([after.board[to].tokens[f], after.board[from].tokens[f]], [2, 3]); // half of 5, rounded down, leaves; the fight stays
  s.board[from].tokens = { [f]: 5, [g]: 1 };
  const lone = previewTarget({ ...s, options: { ...s.options, fightHalf: 'on' } }, 'ann', 'horde', { ...horde, faction: g });
  assert.equal(lone.board[from].tokens[g], 1); // a single token in a fight can't be moved
});

test('seeding=even, the first draft (designer 2026-10-17): each faction starts with 3 on each of its aligned locations', () => {
  const s = newGame(3);
  for (const f of s.factions) {
    const arch = /** @type {string} */ (spec.factions.find((x) => x.id === f)?.archetype);
    for (const l of spec.locations.filter((x) => x.archetype === arch)) assert.equal(s.board[l.id].tokens[f], 3);
  }
  assert.equal(totalPresence(s), 45);
});

test('The Big Chase: a lone group runs a chase, leaving 1 token and 1 sway at each location passed (designer, 2026-10-17)', () => {
  const s = clear(newGame());
  const map = /** @type {Record<string, { adjacent: string[] }>} */ (spec.map.locations);
  const sci = /** @type {string} */ (factionOfArchetype(s, 'scifi'));
  const [f, g, h] = s.factions.filter((x) => x !== sci);
  const start = 'military-facility';
  const a = map[start].adjacent[0];
  const b = /** @type {string} */ (map[a].adjacent.find((l) => l !== start && !map[start].adjacent.includes(l)));
  const c = /** @type {string} */ (map[b].adjacent.find((l) => ![start, a].includes(l)));
  s.board[start].tokens = { [f]: 5 };
  s.board[b].tokens = { [g]: 2 }; // a lone rival passed: the dropped token starts a small contest there
  s.players.ann.standing[f] = 4;
  const t = { mode: /** @type {const} */ ('location'), location: start, faction: f, path: [a, b, c] };
  assert.equal(checkTarget(s, 'ann', cardById('big-chase'), t), null);
  const after = previewTarget(s, 'ann', 'big-chase', t);
  assert.deepEqual([after.board[start].tokens[f], after.board[a].tokens[f], after.board[b].tokens, after.board[c].tokens[f]], [undefined, 1, { [g]: 2, [f]: 1 }, 3]);
  assert.deepEqual([start, a, b, c].map((l) => after.board[l].sway.ann), [1, 1, 1, 1]);
  s.players.ann.standing[f] = 3;
  assert.ok(checkTarget(s, 'ann', cardById('big-chase'), t)); // 4 locations, start included, 3 sway: can't play
  s.players.ann.standing[f] = 9;
  s.board[start].tokens = { [f]: 2 };
  assert.ok(checkTarget(s, 'ann', cardById('big-chase'), t)); // 2 tokens can pass only 1 location and still arrive
  s.board[start].tokens = { [f]: 5 };
  s.board[a].tokens = { [g]: 1, [h]: 1 };
  assert.ok(checkTarget(s, 'ann', cardById('big-chase'), t)); // never through a fight it isn't part of
});

test('Draw Them Away: a lone group bursts, 1 token to each chosen neighbour, the rest stay (designer, 2026-10-17)', () => {
  const s = clear(newGame());
  const map = /** @type {Record<string, { adjacent: string[] }>} */ (spec.map.locations);
  const dead = /** @type {string} */ (factionOfArchetype(s, 'undead'));
  const [f, g] = s.factions.filter((x) => x !== dead);
  const loc = /** @type {string} */ (spec.locations.find((l) => l.archetype === 'undead' && map[l.id].adjacent.length >= 3)?.id);
  const [a, b, c] = map[loc].adjacent;
  s.board[loc].tokens = { [f]: 4 };
  s.board[c].tokens = { [g]: 2 };
  s.players.ann.standing[f] = 4;
  const t = { mode: /** @type {const} */ ('location'), location: loc, faction: f, from: [a, b, c] };
  assert.equal(checkTarget(s, 'ann', cardById('draw-away'), t), null);
  const after = previewTarget(s, 'ann', 'draw-away', t);
  assert.deepEqual([after.board[loc].tokens[f], after.board[a].tokens[f], after.board[b].tokens[f], after.board[c].tokens], [1, 1, 1, { [g]: 2, [f]: 1 }]);
  assert.deepEqual([loc, a, b, c].map((l) => after.board[l].sway.ann), [1, 1, 1, 1]);
  assert.ok(checkTarget(s, 'ann', cardById('draw-away'), { ...t, from: [a] })); // at least two
  s.players.ann.standing[f] = 3;
  assert.ok(checkTarget(s, 'ann', cardById('draw-away'), t)); // 4 locations, where it leaves included, 3 sway: can't play
});

test('Wake the Dead (☾ signature): the dead rise as a third side, and a three-way fight pays the leader the two larger piles (designer, 2026-10-18)', () => {
  const s = clear(newGame());
  const dead = /** @type {string} */ (factionOfArchetype(s, 'undead'));
  const [f, g] = s.factions.filter((x) => x !== dead);
  const arch = (/** @type {string} */ x) => spec.factions.find((y) => y.id === x)?.archetype;
  const loc = /** @type {string} */ (spec.locations.find((l) => l.archetype === 'undead')?.id); // location reading: a ☾ location (designer, 2026-10-18)
  s.board[loc].tokens = { [f]: 6, [g]: 3 };
  s.board[loc].sway = { bob: 2 };
  s.players.ann.standing[dead] = 3;
  s.players.ann.hand = ['wake-the-dead', 'fresh-meat', 'track-snow', 'broadcast']; // a signature's sway: 1 per card in hand, itself included (D24)
  const t = { mode: /** @type {const} */ ('location'), location: loc, from: [loc, loc, loc] };
  assert.equal(checkTarget(s, 'ann', cardById('wake-the-dead'), t), null);
  assert.ok(checkTarget(s, 'ann', cardById('wake-the-dead'), { ...t, from: [loc, loc, loc, loc] })); // only 3 standing
  const late = { ...s, players: { ...s.players, ann: { ...s.players.ann, hand: ['wake-the-dead', 'fresh-meat'] } } };
  assert.ok(checkTarget(late, 'ann', cardById('wake-the-dead'), t)); // 2 cards in hand: up to 2 rise (D24)
  assert.equal(checkTarget(late, 'ann', cardById('wake-the-dead'), { ...t, from: [loc, loc] }), null);
  const after = { ...s, ...previewTarget(s, 'ann', 'wake-the-dead', t) };
  assert.deepEqual(after.board[loc].tokens, { [f]: 6, [g]: 3, [dead]: 3 });
  assert.equal(after.board[loc].sway.ann, 3); // the bid: one sway for each risen
  assert.equal(after.players.ann.standing[dead], 0);
  assert.deepEqual(fightsDue(after).includes(loc), true);
  // The fight: 6 beat 3 and 3; both losers lose everything; the winner loses half the larger loser's number.
  const fought = resolveFight(after, loc);
  assert.deepEqual(fought.board[loc].tokens, { [f]: 5 });
  // Piles 3, 3 and 1: ann leads (3 sway) and takes the two larger; bob, runner-up, the smallest.
  assert.equal(Object.values(fought.players.ann.trophies).reduce((x, y) => x + y, 0), 6);
  assert.equal(fought.players.bob.trophies[f], 1);
  // Two largest tied and neither aligned: a true tie, all three wiped out and the location scorched.
  const tie = clear(newGame());
  const open = /** @type {string} */ (spec.locations.find((l) => ![arch(f), arch(g), 'undead'].includes(l.archetype))?.id);
  tie.board[open].tokens = { [f]: 4, [g]: 4, [dead]: 2 };
  const burnt = resolveFight(tie, open);
  assert.equal(burnt.board[open].scorched, true);
  assert.deepEqual(burnt.board[open].tokens, {});
  // At a ☾ location the dead can also rise on empty ground or against a lone group.
  s.board[loc].tokens = {};
  assert.equal(checkTarget(s, 'ann', cardById('wake-the-dead'), t), null);
  s.board[loc].tokens = { [f]: 6 };
  assert.equal(checkTarget(s, 'ann', cardById('wake-the-dead'), t), null);
  // Not at a fight elsewhere ("any fight" is gone); the faction reading raises them wherever the Undead are, joining them.
  s.board[open].tokens = { [f]: 6, [g]: 3 };
  assert.ok(checkTarget(s, 'ann', cardById('wake-the-dead'), { ...t, location: open, from: [open] }));
  s.board[open].tokens = { [f]: 6, [dead]: 2 };
  const joined = { mode: /** @type {const} */ ('faction'), location: open, from: [open, open] };
  assert.equal(checkTarget(s, 'ann', cardById('wake-the-dead'), joined), null);
  assert.equal(previewTarget(s, 'ann', 'wake-the-dead', joined).board[open].tokens[dead], 4);
  assert.ok(checkTarget(s, 'ann', cardById('wake-the-dead'), { ...joined, location: loc, from: [loc] })); // no Undead there
});

test('Plough Through: every side of a fight leaves by half rounded up, through its own exits; a side of 1 leaves entirely (designer, 2026-10-17)', () => {
  const s = clear(newGame());
  const map = /** @type {Record<string, { adjacent: string[] }>} */ (spec.map.locations);
  const noct = /** @type {string} */ (factionOfArchetype(s, 'nocturnals'));
  const g = /** @type {string} */ (s.factions.find((x) => x !== noct));
  const loc = /** @type {string} */ (spec.locations.find((l) => l.archetype === 'nocturnals' && map[l.id].adjacent.length >= 3)?.id);
  const [a, b, c] = map[loc].adjacent;
  s.board[loc].tokens = { [noct]: 5, [g]: 1 };
  s.players.ann.standing[noct] = 2;
  s.players.ann.standing[g] = 2;
  const [first, second] = s.factions.filter((f) => f === noct || f === g); // sides in seat order of factions
  const exits = first === noct ? [a, a, b, c] : [c, a, a, b]; // the Nocturnals: 3 out (2 to a, 1 to b); the other: 1 to c
  const t = { mode: /** @type {const} */ ('faction'), location: loc, payer: g, from: exits }; // the other side pays the 1 at the fight
  assert.equal(checkTarget(s, 'ann', cardById('plough'), t), null);
  const after = previewTarget(s, 'ann', 'plough', t);
  assert.deepEqual([after.board[loc].tokens[noct], after.board[loc].tokens[g] ?? 0, after.board[a].tokens[noct], after.board[b].tokens[noct], after.board[c].tokens[g]], [2, 0, 2, 1, 1]);
  assert.deepEqual([loc, a, b, c].map((l) => after.board[l].sway.ann), [1, 1, 1, 1]);
  s.players.ann.standing[g] = 1;
  assert.ok(checkTarget(s, 'ann', cardById('plough'), t)); // the payer needs 2: its exit and the fight
  s.players.ann.standing[g] = 2;
  assert.ok(second);
  const clash = first === noct ? [a, a, b, a] : [a, a, a, b];
  assert.ok(checkTarget(s, 'ann', cardById('plough'), { ...t, from: clash })); // never two sides to one location
  assert.ok(checkTarget(s, 'ann', cardById('plough'), { ...t, from: exits.slice(1) })); // every side leaves in full
  s.players.ann.standing[noct] = 1;
  assert.ok(checkTarget(s, 'ann', cardById('plough'), t)); // two Nocturnal exits, 1 sway: can't play
  s.board[loc].tokens = { [noct]: 5 };
  assert.ok(checkTarget(s, 'ann', cardById('plough'), t)); // not a fight
});

test('Cut the Powerlines: a group rejoins its kin 1 at a time round them all; from a fight, exactly half (designer, 2026-10-17)', () => {
  const s = clear(newGame());
  const sent = /** @type {string} */ (factionOfArchetype(s, 'sentients'));
  const g = /** @type {string} */ (s.factions.find((x) => x !== sent));
  const [loc, a, b, c] = spec.locations.map((l) => l.id).filter((l) => !s.board[l].scorched);
  s.board[loc].tokens = { [sent]: 5 };
  s.board[a].tokens = { [sent]: 1 };
  s.board[b].tokens = { [sent]: 2, [g]: 2 }; // a fight: still kin
  s.board[c].tokens = { [sent]: 1 };
  s.players.ann.standing[sent] = 4;
  const t = { mode: /** @type {const} */ ('faction'), location: loc, faction: sent, from: [a, c] }; // 5 over 3: 2 / 1 / 2
  assert.equal(checkTarget(s, 'ann', cardById('cut-powerlines'), t), null);
  const after = previewTarget(s, 'ann', 'cut-powerlines', t);
  assert.deepEqual([loc, a, b, c].map((l) => after.board[l].tokens[sent] ?? 0), [0, 3, 3, 3]);
  assert.deepEqual([loc, a, b, c].map((l) => after.board[l].sway.ann), [1, 1, 1, 1]);
  assert.ok(checkTarget(s, 'ann', cardById('cut-powerlines'), { ...t, from: [a] })); // the player names both extras
  assert.ok(checkTarget(s, 'ann', cardById('cut-powerlines'), { ...t, from: [a, a] }));
  s.players.ann.standing[sent] = 3;
  assert.ok(checkTarget(s, 'ann', cardById('cut-powerlines'), t)); // 4 locations, where it leaves included, 3 sway: can't play
  // From a fight, exactly half leaves: 5 → 2 go, to 2 of the 3 kin (the player picks which).
  s.players.ann.standing[sent] = 4;
  s.board[loc].tokens = { [sent]: 5, [g]: 1 };
  const fought = { ...t, from: [b, c] };
  assert.equal(checkTarget(s, 'ann', cardById('cut-powerlines'), fought), null);
  const half = previewTarget(s, 'ann', 'cut-powerlines', fought);
  assert.deepEqual([loc, a, b, c].map((l) => half.board[l].tokens[sent] ?? 0), [3, 1, 3, 2]);
  // No kin anywhere: can't be played.
  for (const l of [a, b, c]) s.board[l].tokens = {};
  assert.ok(checkTarget(s, 'ann', cardById('cut-powerlines'), { ...t, from: [] }));
});

test('payInFull (designer, 2026-10-15): a card that can\'t pay for every move can\'t be played for its action; off, it goes as far as it can pay (IC1)', () => {
  const s = clear(newGame());
  const map = /** @type {Record<string, { adjacent: string[] }>} */ (spec.map.locations);
  const bell = /** @type {string} */ (spec.locations.find((l) => l.archetype === 'undead' && map[l.id].adjacent.length >= 2)?.id);
  const [x, y] = map[bell].adjacent;
  s.board[x].tokens = { [A]: 2 };
  s.board[y].tokens = { [B]: 4 };
  s.players.ann.standing = { [A]: 1, [B]: 0, [C]: 0 };
  const t = { mode: /** @type {const} */ ('location'), location: bell };
  assert.ok(checkTarget(s, 'ann', cardById('bell'), t)); // B can't be paid for
  assert.equal(checkTarget({ ...s, options: { ...s.options, payInFull: 'off' } }, 'ann', cardById('bell'), t), null);
  s.players.ann.standing[B] = 1;
  assert.equal(checkTarget(s, 'ann', cardById('bell'), t), null);
});

test('pinning (test lever): in a fight each token pins one enemy token; only the surplus leaves; a card that isn\'t movement (unpinned) is not held', () => {
  const s = clear(newGame());
  s.options = { ...s.options, fightHalf: 'off' }; // the first draft's movement: whole groups may leave a fight
  const [f, g, h] = /** @type {string[]} */ (s.factions);
  const map = /** @type {Record<string, { adjacent: string[] }>} */ (spec.map.locations);
  const from = /** @type {string} */ (spec.locations.find((l) => l.archetype === 'undead')?.id);
  const to = map[from].adjacent[0];
  s.board[from].tokens = { [f]: 5, [g]: 2 };
  const horde = { mode: /** @type {const} */ ('location'), location: from, faction: f, to };
  assert.equal(previewTarget(s, 'ann', 'horde', horde).board[to].tokens[f], 5); // off: the whole group goes
  const on = { ...s, options: { ...s.options, pinning: 'on' } };
  const after = previewTarget(on, 'ann', 'horde', horde);
  assert.deepEqual(after.board[from].tokens, { [f]: 2, [g]: 2 }); // the surplus of 3 leaves; the fight stays
  assert.equal(after.board[to].tokens[f], 3);
  assert.equal(previewTarget(on, 'ann', 'beam', { mode: 'location', location: from, faction: f, to }).board[to].tokens[f], 5); // Beam Them Up isn't movement (unpinned)
  const demonic = /** @type {string} */ (spec.locations.find((l) => l.archetype === 'demonic')?.id);
  const far = /** @type {string} */ (spec.locations.find((l) => l.archetype === 'nocturnals')?.id);
  const t = { mode: /** @type {const} */ ('location'), location: demonic, faction: f, moves: [{ location: far, faction: g, to: '' }] };
  on.board = structuredClone(s.board);
  on.board[demonic].tokens = { [f]: 2 };
  on.board[far].tokens = { [g]: 5, [h]: 1 };
  assert.equal(checkTarget(on, 'ann', cardById('trade-souls'), t), null); // trading souls isn't movement (unpinned): the pin doesn't hold it
  assert.deepEqual(previewTarget(on, 'ann', 'trade-souls', t).board[demonic].tokens, { [g]: 5 });
});

test('Lay Them to Rest: the token\'s owner takes the smaller pile; the rest go back to their supplies (round 17 revision)', () => {
  const s = clear(newGame());
  const [f, g] = /** @type {string[]} */ (s.factions);
  const loc = /** @type {string} */ (spec.locations.find((l) => l.archetype === 'undead')?.id);
  s.board[loc].tokens = { [f]: 2, [g]: 5 };
  s.board[loc].sway = { ann: 2 };
  s.board[loc].token = { owner: 'ann', card: 'lay-to-rest' };
  const before = s.supply[f];
  const after = resolveFight(s, loc);
  assert.equal(after.players.ann.trophies[f], 0);
  assert.equal(after.supply[f], before + 2);
  assert.equal(after.players.ann.trophies[g], 1); // the smaller pile, the winner's single casualty
});

test('Follow the Lights: the leader moves next door and a group of another faction follows it in (round 12)', () => {
  const s = clear(newGame());
  const [f, g] = /** @type {string[]} */ (s.factions);
  const map = /** @type {Record<string, { adjacent: string[] }>} */ (spec.map.locations);
  const from = /** @type {string} */ (spec.locations.find((l) => l.archetype === 'scifi')?.id);
  const to = map[from].adjacent[0];
  const near = /** @type {string} */ (map[to].adjacent.find((l) => l !== from));
  s.board[from].tokens = { [f]: 3 };
  s.board[near].tokens = { [g]: 4 };
  assert.equal(nextChoice(s, 'ann', 'follow-lights', { mode: 'location', location: from, faction: f, to }).kind, 'group');
  const t = { mode: /** @type {const} */ ('location'), location: from, faction: f, to, moves: [{ location: near, faction: g, to: '' }] };
  assert.equal(checkTarget(s, 'ann', cardById('follow-lights'), t), null);
  assert.deepEqual(previewTarget(s, 'ann', 'follow-lights', t).board[to].tokens, { [f]: 3, [g]: 4 });
});

test('Circle the Prey: the groups round the target each move one location on, all at once (round 12)', () => {
  const s = clear(newGame());
  const f = /** @type {string} */ (s.factions[0]);
  const map = /** @type {Record<string, { q: number, r: number, adjacent: string[] }>} */ (spec.map.locations);
  // A ◐ location with a full ring of six neighbours, if the board has one; otherwise any with two in a row.
  const centre = /** @type {string} */ (spec.locations.filter((l) => l.archetype === 'nocturnals').map((l) => l.id).sort((a, b) => map[b].adjacent.length - map[a].adjacent.length)[0]);
  for (const l of map[centre].adjacent) s.board[l].tokens = { [f]: 1 };
  const before = map[centre].adjacent.reduce((n, l) => n + (s.board[l].tokens[f] ?? 0), 0);
  const after = previewTarget(s, 'ann', 'circle-prey', { mode: 'location', location: centre });
  assert.equal(map[centre].adjacent.reduce((n, l) => n + (after.board[l].tokens[f] ?? 0), 0), before); // no token lost
});

test('Lead the Horde shoves the smaller group on when it would make three factions (round 13)', () => {
  const s = clear(newGame());
  s.options = { ...s.options, fightHalf: 'off' }; // the first draft's movement: whole groups may leave a fight
  const [f, g, h] = /** @type {string[]} */ (s.factions);
  const map = /** @type {Record<string, { adjacent: string[] }>} */ (spec.map.locations);
  const from = /** @type {string} */ (spec.locations.find((l) => l.archetype === 'undead')?.id);
  const to = map[from].adjacent[0];
  const away = /** @type {string} */ (map[to].adjacent.find((l) => l !== from));
  s.board[from].tokens = { [f]: 4 };
  s.board[to].tokens = { [g]: 1, [h]: 3 };
  const c = nextChoice(s, 'ann', 'horde', { mode: 'location', location: from, faction: f, to });
  assert.ok(c.kind === 'group' && c.options.length === 1 && c.options[0].faction === g);
  const t = { mode: /** @type {const} */ ('location'), location: from, faction: f, to, moves: [{ location: to, faction: g, to: away }] };
  assert.equal(checkTarget(s, 'ann', cardById('horde'), t), null);
  const after = previewTarget(s, 'ann', 'horde', t);
  assert.deepEqual(after.board[to].tokens, { [h]: 3, [f]: 4 });
  assert.equal(after.board[away].tokens[g], 1);
});

test('round 14 unsuited: Bail Out, Call for Backup, Fall Back and Stake Out move or add only your own sway', () => {
  const s = clear(newGame());
  const map = /** @type {Record<string, { adjacent: string[] }>} */ (spec.map.locations);
  const [x, y] = map[NEUTRAL].adjacent;
  s.board[x].sway = { ann: 2, bob: 1 };
  s.board[y].sway = { ann: 1 };
  s.board[NEUTRAL].sway = { ann: 1 };
  const bail = previewTarget(s, 'ann', 'bail-out', { location: x, to: NEUTRAL });
  assert.deepEqual([bail.board[x].sway, bail.board[NEUTRAL].sway.ann], [{ bob: 1 }, 3]);
  const backup = previewTarget(s, 'ann', 'call-backup', { location: x });
  assert.deepEqual([backup.board[x].sway.ann, backup.players.ann.supply], [4, s.players.ann.supply - 2]);
  const fall = previewTarget(s, 'ann', 'fall-back', { location: NEUTRAL });
  assert.deepEqual([fall.board[NEUTRAL].sway.ann, fall.board[x].sway.ann, fall.board[x].sway.bob], [4, undefined, 1]);
  const stake = previewTarget(s, 'ann', 'stake-out', { location: y });
  assert.deepEqual([stake.board[y].sway.ann, stake.players.ann.supply], [5, s.players.ann.supply - 4]);
  s.players.ann.supply = 0;
  assert.ok(checkTarget(s, 'ann', cardById('stake-out'), { location: y }));
});


test('previewTarget runs a move with the game options (sway placed at the destination)', () => {
  const s = clear(newGame());
  const f = /** @type {string} */ (factionOfArchetype(s, 'demonic'));
  const adj = /** @type {Record<string, { adjacent: string[] }>} */ (spec.map.locations);
  const loc = /** @type {string} */ (spec.locations.find((l) => l.archetype === 'demonic')?.id);
  s.board[loc].tokens[f] = 3;
  s.players.ann.standing[f] = 2;
  const to = adj[loc].adjacent[0];
  const after = previewTarget(s, 'ann', 'light-cross', { mode: 'faction', location: loc, faction: f, split: { [to]: 2, [adj[loc].adjacent[1]]: 1 } });
  assert.equal(after.board[to].sway.ann, 1);
});

test('Plan B moves only your own sway, up to 3, to one location', () => {
  const s = clear(newGame());
  const [x, y, z] = spec.locations.map((l) => l.id);
  s.board[x].sway = { ann: 2, bob: 4 };
  s.board[y].sway = { ann: 1 };
  const c = nextChoice(s, 'ann', 'plan-b', {});
  assert.ok(c.kind === 'location' && c.options.includes(z));
  const step = nextChoice(s, 'ann', 'plan-b', { location: z, from: [x, x] });
  assert.ok(step.kind === 'location' && step.key === 'from' && !step.options.includes(x) && step.options.includes(y));
  assert.ok(checkTarget(s, 'ann', cardById('plan-b'), { location: z, from: [x, x, x] }));
  const after = previewTarget(s, 'ann', 'plan-b', { location: z, from: [x, x, y] });
  assert.deepEqual([after.board[x].sway, after.board[y].sway, after.board[z].sway], [{ bob: 4 }, {}, { ann: 3 }]);
});

test('a game saved before an option existed plays on with its default', () => {
  const s = newGame(7);
  delete (/** @type {Record<string, string>} */ (s.options)).swayPerMove;
  const end = playOut(s, rng(7), undefined, Object.fromEntries(s.seating.map((pid) => [pid, fast('trophy')])));
  assert.equal(end.phase, 'ended');
  for (const pid of end.seating) for (const n of Object.values(end.players[pid].standing)) assert.ok(Number.isFinite(n));
});

test('with responses out (the first draft), a played action resolves at once and responses are refused', () => {
  const s = draftAll(newGame(11));
  const actor = /** @type {string} */ (s.first);
  const card = s.players[actor].hand.filter((c) => cardById(c).marked).sort((a, b) => String(cardById(a).marked).localeCompare(String(cardById(b).marked)))[0] ?? s.players[actor].hand.find((c) => cardById(c).action);
  if (!card) return;
  const next = applyMove(s, { playerId: actor, move: { type: 'play', card, use: 'action', target: null } });
  assert.equal(next.pending, null);
  assert.notEqual(next.seating[next.turn], actor);
  const holder = /** @type {string} */ (PLAYERS.find((pid) => pid !== actor));
  next.players[holder].hand.push('cancel');
  assert.equal(validate(next, { playerId: holder, move: { type: 'respond', card: 'cancel' } }).ok, false);
});

test('Set a Trap (A) hides its trap among bluffs and takes every pile; round 15 unsuited: Call a Truce stops the fight, Lay a Trail draws a group to your lead, Steal Their Playbook copies the last card', () => {
  const s = clear(newGame());
  const map = /** @type {Record<string, { adjacent: string[] }>} */ (spec.map.locations);
  s.board[NEUTRAL].tokens = { [A]: 6, [B]: 4 };
  s.board[NEUTRAL].sway = { ann: 1, bob: 3, cat: 2 };
  const trapped = previewTarget(s, 'ann', 'set-trap', { location: NEUTRAL, bluff: map[NEUTRAL].adjacent[0] });
  assert.ok(trapped.board[NEUTRAL].token && trapped.board[map[NEUTRAL].adjacent[0]].token); // the trap and a bluff, face down
  const fought = resolveFight(/** @type {GameState} */ ({ ...s, board: trapped.board }), NEUTRAL);
  assert.deepEqual([fought.players.ann.trophies[B], fought.players.ann.trophies[A], fought.players.bob.trophies[B]], [4, 2, 0]);
  const truce = previewTarget(s, 'ann', 'call-truce', { location: NEUTRAL });
  assert.deepEqual(resolveFight(/** @type {GameState} */ ({ ...s, board: truce.board }), NEUTRAL).board[NEUTRAL].tokens, { [A]: 6, [B]: 4 });
  const near = map[NEUTRAL].adjacent[0];
  s.board[NEUTRAL].tokens = {};
  s.board[NEUTRAL].sway = { ann: 2, bob: 1 };
  s.board[near].tokens = { [C]: 3 };
  const t = { location: NEUTRAL, faction: C, from: [near] };
  assert.equal(checkTarget(s, 'ann', cardById('lay-trail'), t), null);
  assert.ok(checkTarget(s, 'bob', cardById('lay-trail'), t)); // bob doesn't lead there
  assert.equal(previewTarget(s, 'ann', 'lay-trail', t).board[NEUTRAL].tokens[C], 3);
  assert.ok(checkTarget(s, 'ann', cardById('steal-playbook'), {}));
  s.lastPlayed = 'lay-trail';
  assert.equal(previewTarget(s, 'ann', 'steal-playbook', t).board[NEUTRAL].tokens[C], 3);
});

test('round 16 unsuited: Canvass the Town, Set the Bait, Defect', () => {
  const s = clear(newGame());
  const map = /** @type {Record<string, { adjacent: string[] }>} */ (spec.map.locations);
  const [x, y] = map[NEUTRAL].adjacent;
  const supply = s.players.ann.supply;
  const canvass = previewTarget(s, 'ann', 'canvass', { from: [x, y, NEUTRAL] });
  assert.deepEqual([x, y, NEUTRAL].map((l) => canvass.board[l].sway.ann).concat(canvass.players.ann.supply), [1, 1, 1, supply - 3]);
  s.board[x].tokens = { [A]: 3 };
  const bait = { location: NEUTRAL, faction: A, from: [x] };
  assert.equal(checkTarget(s, 'ann', cardById('set-bait'), bait), null);
  const baited = previewTarget(s, 'ann', 'set-bait', bait);
  assert.deepEqual([baited.board[NEUTRAL].tokens[A], baited.board[NEUTRAL].sway.ann >= 2], [3, true]);
  s.players.ann.standing = { [A]: 5, [B]: 0 };
  const c = nextChoice(s, 'ann', 'change-allegiance', { faction: A });
  assert.ok(c.kind === 'faction' && c.key === 'to' && !c.options.includes(A));
  const moved = previewTarget(s, 'ann', 'change-allegiance', { faction: A, to: B });
  assert.deepEqual([moved.players.ann.standing[A], moved.players.ann.standing[B]], [1, 4]);
});

test('IC1: a move goes only as far as the player can pay for the sway it places', () => {
  const s = clear(newGame());
  const map = /** @type {Record<string, { adjacent: string[] }>} */ (spec.map.locations);
  const from = /** @type {string} */ (Object.keys(map).find((l) => map[l].adjacent.length >= 3));
  const dem = /** @type {string} */ (factionOfArchetype(s, 'demonic'));
  s.board[from].tokens = { [dem]: 5 };
  s.players.ann.standing[dem] = 1;
  const [p, q] = map[from].adjacent;
  assert.match(String(checkTarget(s, 'ann', cardById('light-cross'), { mode: 'faction', location: from, faction: dem, split: { [p]: 2, [q]: 3 } })), /both/); // Light of the Cross must pay both or not play
  const sci = /** @type {string} */ (factionOfArchetype(s, 'scifi'));
  s.board[from].tokens = { [sci]: 5 };
  s.players.ann.standing[sci] = 0;
  const beam = { mode: /** @type {const} */ ('faction'), location: from, faction: sci, to: map[from].adjacent[0] };
  assert.ok(checkTarget(s, 'ann', cardById('beam'), beam));
  const off = { ...s, options: { ...s.options, swayRequired: 'off' } };
  assert.equal(checkTarget(off, 'ann', cardById('beam'), beam), null);
});

test('gatherSway (test lever): a gather places its sway on each location taken from, paid by the faction moved', () => {
  const s = clear(newGame());
  const map = /** @type {Record<string, { adjacent: string[] }>} */ (spec.map.locations);
  const bell = /** @type {string} */ (spec.locations.find((l) => l.archetype === 'undead' && map[l.id].adjacent.length >= 2)?.id);
  const [x, y] = map[bell].adjacent;
  s.board[x].tokens = { [A]: 2 };
  s.board[y].tokens = { [A]: 3 };
  s.players.ann.standing = { [A]: 5, [B]: 0, [C]: 0 };
  const t = { mode: /** @type {const} */ ('location'), location: bell };
  const off = previewTarget(s, 'ann', 'bell', t);
  assert.deepEqual([off.board[bell].sway.ann, off.board[x].sway.ann, off.board[y].sway.ann, off.players.ann.standing[A]], [1, undefined, undefined, 4]);
  const on = previewTarget({ ...s, options: { ...s.options, gatherSway: 'origin' } }, 'ann', 'bell', t);
  assert.deepEqual([on.board[bell].tokens[A], on.board[bell].sway.ann, on.board[x].sway.ann, on.board[y].sway.ann, on.players.ann.standing[A]], [5, undefined, 1, 1, 3]);
});

test('D15: each faction moved pays its own (whoPays=each, first draft); only the selected faction pays, the others free (whoPays=selected)', () => {
  const s = clear(newGame());
  const map = /** @type {Record<string, { adjacent: string[] }>} */ (spec.map.locations);
  const bell = /** @type {string} */ (spec.locations.find((l) => l.archetype === 'undead' && map[l.id].adjacent.length >= 2)?.id);
  const [x, y] = map[bell].adjacent;
  s.board[x].tokens = { [A]: 2 };
  s.board[y].tokens = { [B]: 4 };
  s.players.ann.standing = { [A]: 1, [B]: 0, [C]: 0 };
  s.options = { ...s.options, whoPays: 'selected' };
  const c = nextChoice(s, 'ann', 'bell', { mode: 'location', location: bell });
  assert.ok(c.kind === 'faction' && c.key === 'lead' && c.options.includes(A) && !c.options.includes(B));
  const t = { mode: /** @type {const} */ ('location'), location: bell, lead: A };
  assert.equal(checkTarget(s, 'ann', cardById('bell'), t), null);
  const led = previewTarget(s, 'ann', 'bell', t);
  assert.deepEqual([led.board[bell].tokens[A], led.board[bell].tokens[B], led.board[bell].sway.ann, led.players.ann.standing[A]], [2, 4, 1, 0]);
  const each = { ...s, options: { ...s.options, whoPays: 'each' } };
  const paid = previewTarget(each, 'ann', 'bell', { mode: 'location', location: bell });
  assert.deepEqual([paid.board[bell].tokens[A], paid.board[bell].tokens[B]], [2, undefined]);
});

test('round 17: Open the Pit drops a small group in its region; Trade Secrets swaps standing', () => {
  const s = clear(newGame());
  const map = /** @type {Record<string, { adjacent: string[] }>} */ (spec.map.locations);
  const from = /** @type {string} */ (Object.keys(map).find((l) => map[l].adjacent.length >= 3));
  const [x, y] = map[from].adjacent;
  s.board[from].tokens = { [A]: 4 };
  s.board[x].tokens = { [B]: 2 };
  s.players.ann.standing = { [A]: 5, [B]: 1, [C]: 0 };
  const sw = previewTarget(s, 'ann', 'swap-allegiance', { faction: A, to: B });
  assert.deepEqual([sw.players.ann.standing[A], sw.players.ann.standing[B]], [1, 5]);
  const c = nextChoice(s, 'ann', 'pit', { mode: 'location', location: x, faction: B });
  if (c.kind === 'location') for (const l of c.options) assert.notEqual(l, x);
});

test('round 18: Tip Off the Sheriff pays its tipper; Split Up doubles sway at the fight; Wake the Dead raises the fallen as Undead', () => {
  const s = clear(newGame());
  const map = /** @type {Record<string, { adjacent: string[] }>} */ (spec.map.locations);
  const [x] = map[NEUTRAL].adjacent;
  s.board[x].tokens = { [A]: 4 };
  // Tip-off: bob tipped A, so ann's move of A gives bob 1 sway where it lands.
  s.tips = [{ pid: 'bob', faction: A }];
  const tipped = previewTarget(s, 'ann', 'lamps', { mode: 'location', location: x, faction: A, to: NEUTRAL });
  assert.equal(tipped.board[NEUTRAL].sway.bob, 1);
  s.tips = [];
  // Split Up: ann 2 doubled beats bob 3.
  s.board[x].tokens = {};
  s.board[NEUTRAL].tokens = { [A]: 6, [B]: 4 };
  s.board[NEUTRAL].sway = { ann: 2, bob: 3 };
  s.board[NEUTRAL].double = ['ann'];
  const split = resolveFight(s, NEUTRAL);
  assert.ok(split.players.ann.trophies[B] > 0);
  // Wake the Dead: the loser's casualties rise as Undead.
  delete s.board[NEUTRAL].double;
  s.board[NEUTRAL].wake = true;
  const undead = /** @type {string} */ (s.factions.find((f) => spec.factions.find((y) => y.id === f)?.archetype === 'undead'));
  const woke = resolveFight(s, NEUTRAL);
  assert.ok((woke.board[NEUTRAL].tokens[undead] ?? 0) >= (s.board[NEUTRAL].tokens[undead] ?? 0));
  assert.equal(woke.players.bob.trophies[B], 0);
});

test('round 19: Lock Down the Town stops moves across its region\'s border; Put a Bounty On It costs the winner 1 more', () => {
  const s = clear(newGame());
  const map = /** @type {Record<string, { adjacent: string[], region: string }>} */ (spec.map.locations);
  const inside = /** @type {string} */ (Object.keys(map).find((l) => map[l].adjacent.some((x) => map[x].region !== map[l].region)));
  const out = /** @type {string} */ (map[inside].adjacent.find((l) => map[l].region !== map[inside].region));
  s.board[out].tokens = { [A]: 2 };
  const locked = previewTarget(s, 'ann', 'lockdown', { location: inside });
  assert.ok(Object.keys(map).filter((l) => map[l].region === map[inside].region).every((l) => locked.board[l].lock));
  for (const l of Object.keys(map)) if (locked.board[l].lock) s.board[l].lock = true;
  const blocked = previewTarget(s, 'ann', 'lamps', { mode: 'location', location: out, faction: A, to: inside });
  assert.equal(blocked.board[inside].tokens[A], undefined);
  s.board[out].tokens = {};
  for (const l of Object.keys(map)) delete s.board[l].lock;
  s.board[NEUTRAL].tokens = { [A]: 6, [B]: 4 };
  const plain = resolveFight(s, NEUTRAL);
  s.bounties = [A];
  const hunted = resolveFight(s, NEUTRAL);
  assert.equal((plain.board[NEUTRAL].tokens[A] ?? 0) - (hunted.board[NEUTRAL].tokens[A] ?? 0), 1);
  s.bounties = [];
});

test('round 20 Sentients: Hack the Network jumps to a lone rival anywhere; Link the Swarm counts next-door Sentients for who wins', () => {
  const s = clear(newGame());
  const map = /** @type {Record<string, { adjacent: string[] }>} */ (spec.map.locations);
  const sent = /** @type {string} */ (factionOfArchetype(s, 'sentients'));
  const [x, y] = map[NEUTRAL].adjacent;
  s.board[NEUTRAL].tokens = { [sent]: 3 };
  s.board[x].tokens = { [A === sent ? B : A]: 2 };
  const far = /** @type {string} */ (Object.keys(map).find((l) => l !== NEUTRAL && !map[NEUTRAL].adjacent.includes(l)));
  s.board[far].tokens = { [A === sent ? B : A]: 1 };
  const t = { mode: /** @type {const} */ ('faction'), location: NEUTRAL, faction: sent, to: far };
  assert.equal(checkTarget(s, 'ann', cardById('hack-network'), t), null);
  assert.equal(previewTarget(s, 'ann', 'hack-network', t).board[far].tokens[sent], 3);
  // Swarm: 2 Sentients here against 3 rivals, with 2 more Sentients next door: the Sentients win.
  const rival = A === sent ? B : A;
  s.board[NEUTRAL].tokens = { [sent]: 2, [rival]: 3 };
  s.board[x].tokens = { [sent]: 2 };
  s.board[far].tokens = {};
  s.board[NEUTRAL].swarm = true;
  const fought = resolveFight(s, NEUTRAL);
  assert.equal(fought.board[NEUTRAL].tokens[rival], undefined);
});

test('Link the Swarm: the location reading links any faction at a Sentients location; the faction reading links the Sentients (designer, 2026-10-15)', () => {
  const s = clear(newGame());
  const map = /** @type {Record<string, { adjacent: string[] }>} */ (spec.map.locations);
  const sent = /** @type {string} */ (factionOfArchetype(s, 'sentients'));
  const [f, g] = s.factions.filter((x) => x !== sent);
  const hub = /** @type {string} */ (spec.locations.find((l) => l.archetype === 'sentients')?.id);
  const [x] = map[hub].adjacent;
  s.board[hub].tokens = { [f]: 2, [g]: 3 };
  s.board[x].tokens = { [f]: 2 };
  s.players.ann.hand = ['link-swarm', 'fresh-meat', 'track-snow']; // D24: a signature's sway is the hand
  const c = nextChoice(s, 'ann', 'link-swarm', { mode: 'location', location: hub });
  assert.ok(c.kind === 'faction' && c.options.includes(f) && !c.options.includes(g)); // g has no group next door to link
  assert.ok(checkTarget(s, 'ann', cardById('link-swarm'), { mode: 'location', location: hub })); // a faction must be chosen
  const t = { mode: /** @type {const} */ ('location'), location: hub, faction: f, path: [x] };
  assert.equal(checkTarget(s, 'ann', cardById('link-swarm'), t), null);
  assert.ok(checkTarget(s, 'ann', cardById('link-swarm'), { ...t, path: [] })); // at least one group linked in (designer, 2026-10-18)
  const linked = previewTarget(s, 'ann', 'link-swarm', t);
  assert.equal(linked.board[hub].swarm, f);
  assert.deepEqual([linked.board[hub].sway.ann, linked.board[x].sway.ann], [1, 1]); // the bid: 1 at the hub and 1 at each linked group
  const fought = resolveFight(/** @type {GameState} */ ({ ...s, board: linked.board }), hub);
  assert.equal(fought.board[hub].tokens[g], undefined); // 2 here and 2 next door beat 3
  s.board[hub].tokens = { [sent]: 1 };
  s.board[x].tokens = { [sent]: 1 };
  assert.equal(previewTarget(s, 'ann', 'link-swarm', { mode: 'faction', location: hub, path: [x] }).board[hub].swarm, sent);
});

test('round 20 Sentients: Call Home pulls 1 token from every location holding the faction; Install a Backdoor counts the Sentients there as your sway', () => {
  const s = clear(newGame());
  const map = /** @type {Record<string, { adjacent: string[] }>} */ (spec.map.locations);
  const sent = /** @type {string} */ (factionOfArchetype(s, 'sentients'));
  const rival = A === sent ? B : A;
  const others = Object.keys(map).filter((l) => l !== NEUTRAL).slice(0, 3);
  for (const l of others) s.board[l].tokens = { [sent]: 2 };
  const home = previewTarget(s, 'ann', 'call-home', { mode: 'faction', location: NEUTRAL, faction: sent });
  assert.equal(home.board[NEUTRAL].tokens[sent], 3);
  assert.ok(others.every((l) => home.board[l].tokens[sent] === 1));
  for (const l of others) s.board[l].tokens = {};
  s.board[NEUTRAL].tokens = { [sent]: 4, [rival]: 2 };
  s.board[NEUTRAL].sway = { bob: 3 };
  s.board[NEUTRAL].backdoor = ['ann'];
  const fought = resolveFight(s, NEUTRAL);
  assert.ok(Object.values(fought.players.ann.trophies).reduce((a, b) => a + b, 0) > 0); // ann's 4 beats bob's 3
  assert.equal(Object.values(fought.players.bob.trophies).reduce((a, b) => a + b, 0) > 0, true); // bob runner-up takes the smaller pile
});
