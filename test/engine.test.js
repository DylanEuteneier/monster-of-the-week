// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  spec, createGame, validate, applyMove, playerView, waitingOn, shuffle, resolveOptions, IllegalMoveError,
  totalPresence, presenceOf, resolveFight, growthDue, cardById, canEnter, nextChoice, previewTarget, checkTarget, printedOf, sampleTarget,
} from '../public/engine.js';
import { botMove } from '../public/bots.js';
import scores from '../public/card-scores.json' with { type: 'json' };
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
  for (const place of Object.values(next.board)) Object.assign(place, { tokens: {}, influence: {}, token: null, scorched: false });
  // Standing with every faction, so moves can pay for the influence they place (IC1); tests of IC1 set it themselves.
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

test('the pool is 21 cards: five suits of Strike, Shift and Signature, A to D, and two pivots (SU1, PS1, FP2)', () => {
  assert.equal(spec.cards.length, 21);
  for (const a of spec.archetypes) {
    const suit = spec.cards.filter((c) => c.suit === a.id);
    assert.deepEqual(suit.map((c) => [c.slot, c.influence]).sort(), [['shift', 3], ['signature', 4], ['strike', 2]]);
    assert.ok(suit.find((c) => c.slot === 'signature')?.response, `${a.id} Signature carries a response`);
  }
  assert.deepEqual(spec.cards.filter((c) => c.marked).map((c) => c.marked).sort(), ['A', 'B', 'C', 'D']);
  assert.equal(spec.cards.filter((c) => c.action === 'move-influence').length, 2);
  assert.ok(!spec.cards.some((c) => c.id === 'cancel'), 'the Cancel is held out with responses');
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
    for (const [loc, place] of Object.entries(s.board)) if (place.tokens[f]) assert.equal(spec.locations.find((l) => l.id === loc)?.archetype, arch);
  }
});

test('starting setup: more standing with the affinity faction, 1 with each other, 1 influence on each affinity location (designer)', () => {
  const s = newGame(2);
  const def = (/** @type {string} */ id) => Number(spec.variants.find((v) => v.id === id)?.default);
  for (const pid of PLAYERS) {
    const p = s.players[pid];
    const arch = spec.slayerGroups.find((g) => g.id === p.group)?.archetype;
    const linked = s.factions.find((f) => spec.factions.find((x) => x.id === f)?.archetype === arch) ?? '';
    assert.equal(p.standing[linked], def('startInfluence'));
    for (const f of s.factions.filter((x) => x !== linked)) assert.equal(p.standing[f], def('startOthers'));
    const mine = spec.locations.filter((l) => l.archetype === arch).map((l) => s.board[l.id].influence[pid] ?? 0);
    assert.deepEqual(mine, [1, 1, 1].map(() => def('startBoard')));
    assert.equal(p.supply, def('playerCubes') - def('startInfluence') - 4 * def('startOthers') - 3 * def('startBoard'));
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
  s.board[NEUTRAL].influence = { ann: 2 };
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

test('trophies: the leader takes the bigger pile, the runner-up the smaller (TD1); half the leader\'s influence goes to the winner (AF3)', () => {
  const s = clear(newGame());
  s.board[NEUTRAL].tokens = { [A]: 6, [B]: 4 };
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
  s.board[NEUTRAL].tokens = { [A]: 6, [B]: 4 };
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

test('a lone faction with 2 or more tokens grows, aligned locations one extra (GR1, AL3)', () => {
  const s = clear(newGame());
  const home = spec.locations.find((l) => l.archetype === spec.factions.find((f) => f.id === A)?.archetype)?.id ?? '';
  s.board[home].tokens = { [A]: 2 };
  s.board[NEUTRAL].tokens = { [A]: 3 };
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

test('the cancel response stops a card that is in progress (principle 5; responses on)', () => {
  let s = draftAll(createGame({ seed: 11, players: PLAYERS, options: { responses: 'on' } }));
  const actor = /** @type {string} */ (s.first);
  const holder = /** @type {string} */ (PLAYERS.find((pid) => pid !== actor));
  s.players[holder].hand.push('cancel'); // held out of the deal with responses; given by hand here
  const card = s.players[actor].hand.filter((c) => cardById(c).marked).sort((a, b) => String(cardById(a).marked).localeCompare(String(cardById(b).marked)))[0] ?? s.players[actor].hand.find((c) => cardById(c).action);
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

test('Board Up the Windows never lets the last token make a one-location split', () => {
  const s = clear(newGame());
  const f = /** @type {string} */ (s.factions[3]); // the Undead faction
  const loc = /** @type {string} */ (spec.locations.find((l) => l.archetype === 'undead')?.id);
  s.board[loc].tokens[f] = 2;
  const first = /** @type {Record<string, { adjacent: string[] }>} */ (spec.map.locations)[loc].adjacent[0];
  const c = nextChoice(s, 'ann', 'board-up', { mode: 'faction', location: loc, faction: f, split: { [first]: 1 } });
  assert.ok(c.kind === 'split' && !c.options.includes(first));
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

test('a fixed deck never deals test cards', () => {
  const s = createGame({ seed: 1, players: PLAYERS, options: { deck: 'fixed' } });
  const dealt = s.seating.flatMap((pid) => s.players[pid].batch).concat(s.leftOut);
  for (const c of spec.testCards.cards) assert.ok(!dealt.includes(c.id));
});

test('a mixed deck: one Strike, Shift and Signature per suit, 2/3/4 influence weighted to strength (D12), the marked extras kept, two unmarked extras drawn', () => {
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
      const battle = (/** @type {string} */ id) => /** @type {Record<string, { battle: number }>} */ (scores.scores)[id]?.battle ?? 0;
      for (const x of mine) for (const y of mine) if (battle(x.id) < battle(y.id)) assert.ok(printedOf(s, x.id) > printedOf(s, y.id), `${x.id} vs ${y.id}`);
    }
    for (const c of spec.cards.filter((x) => !x.suit && x.marked)) assert.ok(deck.includes(c.id));
    const unmarked = deck.map((id) => cardById(id)).filter((c) => !c.suit && !c.marked);
    assert.equal(unmarked.length, 2);
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

test('Take Over the Wake places up to 3 influence from standing with a faction there', () => {
  const s = clear(newGame());
  const f = /** @type {string} */ (s.factions[3]);
  const loc = /** @type {string} */ (spec.locations.find((l) => l.archetype === 'undead')?.id);
  s.board[loc].tokens[f] = 2;
  s.players.ann.standing[f] = 5;
  const after = previewTarget(s, 'ann', 'take-wake', { mode: 'location', location: loc, faction: f });
  assert.equal(after.board[loc].influence.ann, 3);
  assert.equal(after.players.ann.standing[f], 2);
});

test('Spread a Virus (infectious): each token that joins another faction costs it 1 token to its supply (round 9)', () => {
  const s = clear(newGame());
  const [f, g] = /** @type {string[]} */ (s.factions);
  const adj = /** @type {Record<string, { adjacent: string[] }>} */ (spec.map.locations);
  const loc = /** @type {string} */ (spec.locations.find((l) => l.archetype === 'sentients')?.id);
  const [to] = adj[loc].adjacent;
  s.board[loc].tokens[f] = 1;
  s.board[to].tokens[g] = 3;
  const supply = s.supply[g];
  const after = previewTarget(s, 'ann', 'virus-infect', { mode: 'location', location: loc, faction: f });
  assert.equal(after.board[to].tokens[f], 1);
  assert.equal(after.board[to].tokens[g], 2);
  assert.ok(!checkTarget(s, 'ann', cardById('virus-infect'), { mode: 'location', location: loc, faction: f }));
  assert.equal(supply, s.supply[g]); // the preview leaves the game untouched
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

test('Lay Them to Rest: no one takes trophies at its fight (round 11)', () => {
  const s = clear(newGame());
  const [f, g] = /** @type {string[]} */ (s.factions);
  const loc = /** @type {string} */ (spec.locations.find((l) => l.archetype === 'undead')?.id);
  s.board[loc].tokens = { [f]: 2, [g]: 5 };
  s.board[loc].influence = { ann: 2 };
  s.board[loc].token = { owner: 'ann', card: 'lay-to-rest' };
  const before = s.supply[f];
  const after = resolveFight(s, loc);
  assert.equal(after.players.ann.trophies[f], 0);
  assert.equal(after.supply[f], before + 2);
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

test('round 14 unsuited: Bail Out, Call for Backup, Fall Back and Stake Out move or add only your own influence', () => {
  const s = clear(newGame());
  const map = /** @type {Record<string, { adjacent: string[] }>} */ (spec.map.locations);
  const [x, y] = map[NEUTRAL].adjacent;
  s.board[x].influence = { ann: 2, bob: 1 };
  s.board[y].influence = { ann: 1 };
  s.board[NEUTRAL].influence = { ann: 1 };
  const bail = previewTarget(s, 'ann', 'bail-out', { location: x, to: NEUTRAL });
  assert.deepEqual([bail.board[x].influence, bail.board[NEUTRAL].influence.ann], [{ bob: 1 }, 3]);
  const backup = previewTarget(s, 'ann', 'call-backup', { location: x });
  assert.deepEqual([backup.board[x].influence.ann, backup.players.ann.supply], [4, s.players.ann.supply - 2]);
  const fall = previewTarget(s, 'ann', 'fall-back', { location: NEUTRAL });
  assert.deepEqual([fall.board[NEUTRAL].influence.ann, fall.board[x].influence.ann, fall.board[x].influence.bob], [4, undefined, 1]);
  const stake = previewTarget(s, 'ann', 'stake-out', { location: y });
  assert.deepEqual([stake.board[y].influence.ann, stake.players.ann.supply], [5, s.players.ann.supply - 4]);
  s.players.ann.supply = 0;
  assert.ok(checkTarget(s, 'ann', cardById('stake-out'), { location: y }));
});


test('previewTarget runs a move with the game options (influence placed at the destination)', () => {
  const s = clear(newGame());
  const f = /** @type {string} */ (s.factions[3]);
  const adj = /** @type {Record<string, { adjacent: string[] }>} */ (spec.map.locations);
  const loc = /** @type {string} */ (spec.locations.find((l) => l.archetype === 'undead')?.id);
  s.board[loc].tokens[f] = 3;
  s.players.ann.standing[f] = 2;
  const to = adj[loc].adjacent[0];
  const after = previewTarget(s, 'ann', 'board-up', { mode: 'faction', location: loc, faction: f, split: { [to]: 2, [adj[loc].adjacent[1]]: 1 } });
  assert.equal(after.board[to].influence.ann, 1);
});

test('Switch to Plan B moves only your own influence, up to 3, to one location', () => {
  const s = clear(newGame());
  const [x, y, z] = spec.locations.map((l) => l.id);
  s.board[x].influence = { ann: 2, bob: 4 };
  s.board[y].influence = { ann: 1 };
  const c = nextChoice(s, 'ann', 'plan-b', {});
  assert.ok(c.kind === 'location' && c.options.includes(z));
  const step = nextChoice(s, 'ann', 'plan-b', { location: z, from: [x, x] });
  assert.ok(step.kind === 'location' && step.key === 'from' && !step.options.includes(x) && step.options.includes(y));
  assert.ok(checkTarget(s, 'ann', cardById('plan-b'), { location: z, from: [x, x, x] }));
  const after = previewTarget(s, 'ann', 'plan-b', { location: z, from: [x, x, y] });
  assert.deepEqual([after.board[x].influence, after.board[y].influence, after.board[z].influence], [{ bob: 4 }, {}, { ann: 3 }]);
});

test('a game saved before an option existed plays on with its default', () => {
  const s = newGame(7);
  delete (/** @type {Record<string, string>} */ (s.options)).influencePerMove;
  const end = playOut(s, rng(7), undefined, Object.fromEntries(s.seating.map((pid) => [pid, 'goal'])));
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

test('round 15 unsuited: Claim the Spoils takes every pile, Call a Truce stops the fight, Lay a Trail draws a group to your lead, Steal Their Playbook copies the last card', () => {
  const s = clear(newGame());
  const map = /** @type {Record<string, { adjacent: string[] }>} */ (spec.map.locations);
  s.board[NEUTRAL].tokens = { [A]: 6, [B]: 4 };
  s.board[NEUTRAL].influence = { ann: 1, bob: 3, cat: 2 };
  const claimed = previewTarget(s, 'ann', 'claim-spoils', { location: NEUTRAL });
  const fought = resolveFight(/** @type {GameState} */ ({ ...s, board: claimed.board }), NEUTRAL);
  assert.deepEqual([fought.players.ann.trophies[B], fought.players.ann.trophies[A], fought.players.bob.trophies[B]], [4, 2, 0]);
  const truce = previewTarget(s, 'ann', 'call-truce', { location: NEUTRAL });
  assert.deepEqual(resolveFight(/** @type {GameState} */ ({ ...s, board: truce.board }), NEUTRAL).board[NEUTRAL].tokens, { [A]: 6, [B]: 4 });
  const near = map[NEUTRAL].adjacent[0];
  s.board[NEUTRAL].tokens = {};
  s.board[NEUTRAL].influence = { ann: 2, bob: 1 };
  s.board[near].tokens = { [C]: 3 };
  const t = { location: NEUTRAL, faction: C, from: [near] };
  assert.equal(checkTarget(s, 'ann', cardById('lay-trail'), t), null);
  assert.ok(checkTarget(s, 'bob', cardById('lay-trail'), t)); // bob doesn't lead there
  assert.equal(previewTarget(s, 'ann', 'lay-trail', t).board[NEUTRAL].tokens[C], 3);
  assert.ok(checkTarget(s, 'ann', cardById('steal-playbook'), {}));
  s.lastPlayed = 'lay-trail';
  assert.equal(previewTarget(s, 'ann', 'steal-playbook', t).board[NEUTRAL].tokens[C], 3);
});

test('round 16 unsuited: Canvass the Town, Set the Bait, Change Allegiance, Stake Out (6)', () => {
  const s = clear(newGame());
  const map = /** @type {Record<string, { adjacent: string[] }>} */ (spec.map.locations);
  const [x, y] = map[NEUTRAL].adjacent;
  const supply = s.players.ann.supply;
  const canvass = previewTarget(s, 'ann', 'canvass', { from: [x, y, NEUTRAL] });
  assert.deepEqual([x, y, NEUTRAL].map((l) => canvass.board[l].influence.ann).concat(canvass.players.ann.supply), [1, 1, 1, supply - 3]);
  s.board[x].tokens = { [A]: 3 };
  const bait = { location: NEUTRAL, faction: A, from: [x] };
  assert.equal(checkTarget(s, 'ann', cardById('set-bait'), bait), null);
  const baited = previewTarget(s, 'ann', 'set-bait', bait);
  assert.deepEqual([baited.board[NEUTRAL].tokens[A], baited.board[NEUTRAL].influence.ann >= 2], [3, true]);
  s.players.ann.standing = { [A]: 5, [B]: 0 };
  const c = nextChoice(s, 'ann', 'change-allegiance', { faction: A });
  assert.ok(c.kind === 'faction' && c.key === 'to' && !c.options.includes(A));
  const moved = previewTarget(s, 'ann', 'change-allegiance', { faction: A, to: B });
  assert.deepEqual([moved.players.ann.standing[A], moved.players.ann.standing[B]], [1, 4]);
  assert.equal(previewTarget(s, 'ann', 'stake-out-6', { location: y }).board[y].influence.ann, 6);
});

test('IC1: a move goes only as far as the player can pay for the influence it places', () => {
  const s = clear(newGame());
  const map = /** @type {Record<string, { adjacent: string[] }>} */ (spec.map.locations);
  const from = /** @type {string} */ (Object.keys(map).find((l) => map[l].adjacent.length >= 3));
  s.board[from].tokens = { [A]: 5 };
  s.players.ann.standing[A] = 1;
  const one = previewTarget(s, 'ann', 'virus', { mode: 'faction', location: from, faction: A });
  assert.equal(map[from].adjacent.filter((l) => one.board[l].tokens[A]).length, 1); // 1 standing: one location
  s.players.ann.standing[A] = 0;
  assert.ok(checkTarget(s, 'ann', cardById('extra-c'), { moves: [{ location: from, faction: A, to: map[from].adjacent[0] }] }));
  const off = { ...s, options: { ...s.options, influenceRequired: 'off' } };
  assert.equal(checkTarget(off, 'ann', cardById('extra-c'), { moves: [{ location: from, faction: A, to: map[from].adjacent[0] }] }), null);
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
  assert.deepEqual([led.board[bell].tokens[A], led.board[bell].tokens[B], led.board[bell].influence.ann, led.players.ann.standing[A]], [2, 4, 1, 0]);
  const each = { ...s, options: { ...s.options, whoPays: 'each' } };
  const paid = previewTarget(each, 'ann', 'bell', { mode: 'location', location: bell });
  assert.deepEqual([paid.board[bell].tokens[A], paid.board[bell].tokens[B]], [2, undefined]);
});
