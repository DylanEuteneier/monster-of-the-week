// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fightsDue,
  spec, createGame, validate, applyMove, playerView, waitingOn, shuffle, resolveOptions, IllegalMoveError,
  totalPresence, presenceOf, resolveFight, growthDue, cardById, canEnter, nextChoice, previewTarget, checkTarget, printedOf, sampleTarget, deckOf, factionOfArchetype, swayFor,
} from '../public/engine.js';
import { botMove, fast } from '../public/bots.js';
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
  for (const place of Object.values(next.board)) Object.assign(place, { tokens: {}, sway: {}, scorched: false });
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

test('the deck is the core 21: five suits of Strike, Shift and Signature, and six unsuited, A to D marked (SU1, PS1, FP2)', () => {
  assert.equal(deckOf().length, 21);
  assert.equal(new Set(deckOf()).size, 21);
  assert.equal(deckOf().filter((id) => !cardById(id).suit).length, 6);
  for (const a of spec.archetypes) {
    const suit = spec.cards.filter((c) => c.suit === a.id);
    assert.deepEqual(suit.map((c) => [c.slot, c.sway]).sort(), [['shift', 3], ['signature', 4], ['strike', 2]]);
  }
  assert.deepEqual(spec.cards.filter((c) => c.marked).map((c) => c.marked).sort(), ['A', 'B', 'C', 'D']);
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
  assert.deepEqual(r.board[home].tokens, { [A]: 1 }); // loses half the loser's 3, rounded up (D25)
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

test('a lone faction with 2 or more tokens grows by 1 (GR1), aligned locations one extra (AL3, on by default again, designer 2026-10-24); alignedGrowth=off, no extra', () => {
  const s = clear(newGame());
  const home = spec.locations.find((l) => l.archetype === spec.factions.find((f) => f.id === A)?.archetype)?.id ?? '';
  s.board[home].tokens = { [A]: 2 };
  s.board[NEUTRAL].tokens = { [A]: 3 };
  assert.deepEqual(growthDue(s, A), { [home]: 2, [NEUTRAL]: 1 });
  assert.deepEqual(growthDue({ ...s, options: { ...s.options, alignedGrowth: 'off' } }, A), { [home]: 1, [NEUTRAL]: 1 });
});

test('bots play whole games of legal moves at every player count, and a winner is named', () => {
  for (const n of [3, 4, 5]) {
    const g = newGame(n * 7, PLAYERS.slice(0, n));
    const end = playOut(g, rng(n), undefined, Object.fromEntries(g.seating.map((pid) => [pid, fast('trophy')])));
    assert.equal(end.phase, 'ended');
    assert.ok(end.result && end.result.players.length >= 1);
  }
});

// Hidden information ---------------------------------------------------------

test('views hide other hands and trophy totals (3.11, IN2)', () => {
  const s = draftAll(newGame(8));
  const view = playerView(s, 'ann');
  assert.deepEqual(view.me.hand, s.players.ann.hand);
  assert.equal(JSON.stringify(view).includes(JSON.stringify(s.players.bob.hand)), s.players.bob.hand.length === 0);
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

test('Invite Them In: two groups next door come into an empty ◐ location, half from a fight; 1 sway where each left and 1 at the fight (designer, 2026-10-15, 2026-10-18)', () => {
  const s = clear(newGame());
  const map = /** @type {Record<string, { adjacent: string[] }>} */ (spec.map.locations);
  const noct = /** @type {string} */ (factionOfArchetype(s, 'nocturnals'));
  const [f, g, h] = s.factions.filter((x) => x !== noct);
  const to = /** @type {string} */ (spec.locations.find((l) => l.archetype === 'nocturnals' && map[l.id].adjacent.length >= 3)?.id);
  const [a, b, c] = map[to].adjacent;
  s.board[a].tokens = { [f]: 3 };
  s.board[b].tokens = { [g]: 4 };
  s.board[c].tokens = { [f]: 2, [h]: 2 }; // in a fight: half may come (D22, designer 2026-10-18)
  s.players.ann.standing = Object.fromEntries(s.factions.map((x) => [x, 0]));
  s.players.ann.standing[f] = 2; s.players.ann.standing[g] = 1; s.players.ann.standing[h] = 1;
  const offered = nextChoice(s, 'ann', 'invite-in', { mode: 'location', location: to });
  assert.ok(offered.kind === 'group' && offered.options.some((o) => o.location === c && o.faction === h));
  const half = { mode: /** @type {const} */ ('location'), location: to, moves: [{ location: c, faction: h, to: '' }, { location: b, faction: g, to: '' }], payer: g };
  s.players.ann.standing[h] = 1; s.players.ann.standing[g] = 2;
  assert.equal(checkTarget(s, 'ann', cardById('invite-in'), half), null);
  const halfAfter = previewTarget(s, 'ann', 'invite-in', half);
  assert.deepEqual([halfAfter.board[to].tokens[h], halfAfter.board[c].tokens[h]], [1, 1]);
  s.players.ann.standing[h] = 0; s.players.ann.standing[g] = 1;
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
  const sen = /** @type {string} */ (factionOfArchetype(s, 'sentients'));
  const g = /** @type {string} */ (s.factions.find((x) => x !== sci && x !== sen));
  const a = 'military-facility', b = 'state-park';
  s.board[a].tokens = { [sen]: 3 };
  s.board[b].tokens = { [sen]: 2 };
  s.board[a].gate = b; s.board[b].gate = a;
  // Cut the Powerlines (faction reading): the lone group at both ends rejoins its kin as one group of 5.
  const far = /** @type {string} */ (Object.keys(s.board).find((l) => ![a, b].includes(l) && !/** @type {Record<string, { adjacent: string[] }>} */ (spec.map.locations)[a].adjacent.includes(l)));
  s.board[far].tokens = { [sen]: 1 };
  const t = { mode: /** @type {const} */ ('faction'), location: a, faction: sen, from: [] };
  assert.equal(checkTarget(s, 'ann', cardById('cut-powerlines'), t), null);
  const cut = previewTarget(s, 'ann', 'cut-powerlines', t);
  assert.deepEqual([cut.board[far].tokens[sen], cut.board[a].tokens[sen], cut.board[b].tokens[sen]], [6, undefined, undefined]);
  // Invite Them In at the Ski Resort: the Military Facility is next door, so its Gate partner's group is too.
  const q = clear(newGame());
  q.board['military-facility'].gate = b; q.board[b].gate = 'military-facility';
  q.board[b].tokens = { [g]: 2 };
  q.board.junkyard.tokens = { [sen]: 1 };
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
  const from = 'junkyard', to = 'graveyard'; // a ⏏ location, and somewhere not next to it
  s.board[from].tokens = { [f]: 5, [g]: 2 };
  s.board[to].tokens = { [f]: 1 };
  // Cut the Powerlines (location reading) sends the group to its kin: half of it, from a fight.
  const cut = { mode: /** @type {const} */ ('location'), location: from, faction: f, from: [] };
  assert.equal(previewTarget({ ...s, options: { ...s.options, fightHalf: 'off' } }, 'ann', 'cut-powerlines', cut).board[to].tokens[f], 6); // off: the whole group
  const after = previewTarget({ ...s, options: { ...s.options, fightHalf: 'on' } }, 'ann', 'cut-powerlines', cut);
  assert.deepEqual([after.board[to].tokens[f], after.board[from].tokens[f]], [3, 3]); // half of 5, rounded down, leaves; the fight stays
  s.board[from].tokens = { [f]: 5, [g]: 1 };
  s.board[to].tokens = { [g]: 1 };
  assert.ok(checkTarget({ ...s, options: { ...s.options, fightHalf: 'on' } }, 'ann', cardById('cut-powerlines'), { ...cut, faction: g })); // a single token in a fight can't be moved
});

test('SD1 (designer, 2026-10-21): each faction starts with 2 on each of its aligned locations; seeding=even, 3', () => {
  const s = newGame(3);
  for (const f of s.factions) {
    const arch = /** @type {string} */ (spec.factions.find((x) => x.id === f)?.archetype);
    for (const l of spec.locations.filter((x) => x.archetype === arch)) assert.equal(s.board[l.id].tokens[f], 2);
  }
  assert.equal(totalPresence(s), 30);
  assert.equal(totalPresence(createGame({ seed: 3, players: PLAYERS, options: { seeding: 'even' } })), 45);
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

test('The Big Chase sets off from a fight too, with half (D22 is global; no lone-group targets; designer, 2026-10-18)', () => {
  const s = clear(newGame());
  const map = /** @type {Record<string, { adjacent: string[] }>} */ (spec.map.locations);
  const sci = /** @type {string} */ (factionOfArchetype(s, 'scifi'));
  const [f, g] = s.factions.filter((x) => x !== sci);
  const start = 'military-facility';
  const a = map[start].adjacent[0];
  s.board[start].tokens = { [f]: 5, [g]: 4 }; // a fight: 2 of the 5 may leave
  s.players.ann.standing[f] = 9;
  const chase = { mode: /** @type {const} */ ('location'), location: start, faction: f, path: [a] };
  assert.equal(checkTarget(s, 'ann', cardById('big-chase'), chase), null);
  assert.deepEqual(previewTarget(s, 'ann', 'big-chase', chase).board[start].tokens, { [f]: 3, [g]: 4 });
  const c = /** @type {string} */ (map[a].adjacent.find((l) => l !== start && !map[start].adjacent.includes(l)));
  assert.ok(checkTarget(s, 'ann', cardById('big-chase'), { ...chase, path: [a, c] }) === null);
  const d = /** @type {string} */ (map[c].adjacent.find((l) => ![start, a].includes(l) && !map[start].adjacent.includes(l)));
  assert.ok(checkTarget(s, 'ann', cardById('big-chase'), { ...chase, path: [a, c, d] })); // 2 free: at most 1 location passed
  s.board[start].tokens = { [sci]: 4, [g]: 4 };
  s.players.ann.standing[sci] = 9;
  const sciChase = { mode: /** @type {const} */ ('faction'), location: start, faction: sci, path: [a] };
  assert.equal(checkTarget(s, 'ann', cardById('big-chase'), sciChase), null);
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

test('the core deck prints each card\'s own sway: Strikes 2, Shifts 3; a Signature\'s is the hand (D24)', () => {
  const g = newGame();
  assert.deepEqual([printedOf('invite-in'), printedOf('plough')], [2, 3]);
  const s = draftAll(g);
  const pid = /** @type {string} */ (s.seating.find((id) => s.players[id].hand.length));
  assert.equal(swayFor(s, pid, 'night-terrors'), s.players[pid].hand.length + (s.players[pid].hand.includes('night-terrors') ? 0 : 1));
});

test('Take Control (⏏ signature): spend your sway at a fight to cut down a faction there, taking them as trophies (designer, 2026-10-18)', () => {
  const s = clear(newGame());
  const sent = /** @type {string} */ (factionOfArchetype(s, 'sentients'));
  const [f, g] = s.factions.filter((x) => x !== sent);
  const hub = /** @type {string} */ (spec.locations.find((l) => l.archetype === 'sentients')?.id);
  const away = /** @type {string} */ (spec.locations.find((l) => l.archetype !== 'sentients')?.id);
  s.players.ann.hand = ['take-control', 'gate', 'plough']; // the card's sway: 3 (D24)
  // Faction reading: a fight the Sentients are in; their rival is hit.
  s.board[away].tokens = { [sent]: 2, [f]: 5 };
  s.board[away].sway = { ann: 4, bob: 2 };
  const t = { mode: /** @type {const} */ ('faction'), location: away, faction: f, from: [away, away, away] };
  assert.equal(checkTarget(s, 'ann', cardById('take-control'), t), null);
  assert.ok(checkTarget(s, 'ann', cardById('take-control'), { ...t, from: [away, away, away, away] })); // up to the card's sway
  assert.ok(checkTarget(s, 'ann', cardById('take-control'), { ...t, faction: sent })); // not the Sentients themselves
  const after = previewTarget(s, 'ann', 'take-control', t);
  assert.deepEqual(after.board[away].tokens, { [sent]: 2, [f]: 2 });
  assert.equal(after.players.ann.trophies[f], 3);
  assert.equal(after.board[away].sway.ann, 1); // 1 of your sway there for each
  assert.equal(after.players.ann.supply, s.players.ann.supply + 3); // back to your supply
  // Wiping the rival out is allowed (designer).
  s.board[away].tokens = { [sent]: 2, [f]: 2 };
  assert.equal(checkTarget(s, 'ann', cardById('take-control'), { ...t, from: [away, away] }), null);
  // Location reading: any fight at a ⏏ location, any faction there; you need sway there to spend.
  s.board[hub].tokens = { [f]: 3, [g]: 3 };
  const loc = { mode: /** @type {const} */ ('location'), location: hub, faction: g, from: [hub] };
  assert.ok(checkTarget(s, 'ann', cardById('take-control'), loc));
  s.board[hub].sway = { ann: 1 };
  assert.equal(checkTarget(s, 'ann', cardById('take-control'), loc), null);
  assert.ok(checkTarget(s, 'ann', cardById('take-control'), { ...loc, location: away })); // not a ⏏ location
});

test('Spill Blood on the Altar (⎈ signature): marks up to the hand, 1 sway each; at a marked fight the winner loses as many as the loser (designer, 2026-10-18)', () => {
  const s = clear(newGame());
  const demon = /** @type {string} */ (factionOfArchetype(s, 'demonic'));
  const [f, g] = s.factions.filter((x) => x !== demon);
  const arch = (/** @type {string} */ x) => spec.factions.find((y) => y.id === x)?.archetype;
  const [x, y, z] = spec.locations.filter((l) => ![arch(f), arch(g), 'demonic'].includes(l.archetype)).map((l) => l.id);
  s.board[x].tokens = { [demon]: 5, [f]: 3 };
  s.board[y].tokens = { [demon]: 2 };
  s.board[z].tokens = { [demon]: 1 };
  s.players.ann.standing[demon] = 3;
  s.players.ann.hand = ['spill-blood', 'gate']; // a signature's sway: the hand (D24): 2 marks
  const t = { mode: /** @type {const} */ ('faction'), moves: [{ location: x, faction: demon, to: '' }, { location: y, faction: demon, to: '' }] };
  assert.equal(checkTarget(s, 'ann', cardById('spill-blood'), t), null);
  assert.ok(checkTarget(s, 'ann', cardById('spill-blood'), { ...t, moves: [...t.moves, { location: z, faction: demon, to: '' }] })); // 3 marks, 2 cards in hand
  const after = { ...s, ...previewTarget(s, 'ann', 'spill-blood', t) };
  assert.deepEqual([after.board[x].altar, after.board[y].altar, after.board[x].sway.ann, after.board[y].sway.ann, after.players.ann.standing[demon]], [true, true, 1, 1, 1]);
  // 5 beat 3 at the marked fight: the winner loses 3, not 2.
  assert.deepEqual(resolveFight(after, x).board[x].tokens, { [demon]: 2 });
  // Location reading: an empty ⎈ location is marked from Demon standing; one held is paid by a faction there.
  const q = clear(newGame());
  const [home, other] = spec.locations.filter((l) => l.archetype === 'demonic').map((l) => l.id);
  q.board[other].tokens = { [f]: 2 };
  q.players.ann.standing[demon] = 1; q.players.ann.standing[f] = 1;
  q.players.ann.hand = ['spill-blood', 'gate', 'ritual'];
  const lt = { mode: /** @type {const} */ ('location'), moves: [{ location: other, faction: f, to: '' }], from: [home] };
  assert.equal(checkTarget(q, 'ann', cardById('spill-blood'), lt), null);
  const la = previewTarget(q, 'ann', 'spill-blood', lt);
  assert.deepEqual([la.board[home].altar, la.board[other].altar, la.players.ann.standing[demon], la.players.ann.standing[f]], [true, true, 0, 0]);
});

test('the unsuited cards (designer, 2026-10-23/24): X is the hand, this card included; each use does what it says', () => {
  const s = clear(newGame());
  const [f, g, h] = s.factions;
  const map = /** @type {Record<string, { adjacent: string[] }>} */ (spec.map.locations);
  const loc = /** @type {string} */ (spec.locations[0].id);
  const [a, b] = map[loc].adjacent;
  const ann = s.players.ann;
  const hand = (/** @type {string} */ c) => { ann.hand = [c, 'gate', 'ritual']; }; // X = 3
  // A, Call in Favours: standing from the supply, up to X with one faction; sway from the supply at fights.
  hand('favours');
  ann.supply = 10;
  const fav = { use: 'standing', payers: [f, f, f] };
  assert.equal(checkTarget(s, 'ann', cardById('favours'), fav), null);
  assert.ok(checkTarget(s, 'ann', cardById('favours'), { ...fav, payers: [f, f, f, f] })); // more than X
  assert.ok(checkTarget(s, 'ann', cardById('favours'), { ...fav, payers: [f, g] })); // one faction only
  const fa = previewTarget(s, 'ann', 'favours', fav);
  assert.deepEqual([fa.players.ann.standing[f], fa.players.ann.supply], [s.players.ann.standing[f] + 3, 7]);
  s.board[a].tokens = { [f]: 2, [g]: 2 };
  const fs = previewTarget(s, 'ann', 'favours', { use: 'sway', from: [a] });
  assert.equal(fs.board[a].sway.ann, 1);
  assert.ok(checkTarget(s, 'ann', cardById('favours'), { use: 'sway', from: [b] })); // not a fight
  // B, Raise the Stakes: standing gathered, 1 from each of up to X factions.
  hand('stakes');
  const st = previewTarget(s, 'ann', 'stakes', { use: 'standing', faction: f, payers: [g, h] });
  assert.deepEqual([st.players.ann.standing[f], st.players.ann.standing[g]], [s.players.ann.standing[f] + 2, s.players.ann.standing[g] - 1]);
  // Tokens: a faction's kin next door come in, to where you have sway; 1 sway where they left and at the centre.
  s.board[a].tokens = { [g]: 3 };
  s.board[loc].sway = { ann: 1 };
  const tk = previewTarget(s, 'ann', 'stakes', { use: 'tokens', location: loc, faction: g, from: [a, a] });
  assert.deepEqual([tk.board[loc].tokens[g], tk.board[a].tokens[g], tk.board[a].sway.ann, tk.board[loc].sway.ann], [2, 1, 1, 2]);
  assert.ok(checkTarget(s, 'ann', cardById('stakes'), { use: 'tokens', location: b, faction: g, from: [a] })); // no sway of yours there
  // C, Cover Every Exit: a group sends 1 token to each of up to X neighbours.
  hand('exit');
  s.board[a].tokens = {};
  s.board[loc].tokens = { [g]: 4 };
  const ex = previewTarget(s, 'ann', 'exit', { use: 'tokens', location: loc, faction: g, from: [a, b] });
  assert.deepEqual([ex.board[loc].tokens[g], ex.board[a].tokens[g], ex.board[b].tokens[g]], [2, 1, 1]);
  // D, Showdown: at a lone group, 1 of your sway there for each token, as your trophies; the sway back to your supply.
  hand('showdown');
  s.board[loc].sway = { ann: 2 };
  const sd = previewTarget(s, 'ann', 'showdown', { location: loc, faction: g, from: [loc, loc] });
  assert.deepEqual([sd.board[loc].tokens[g], sd.players.ann.trophies[g], sd.board[loc].sway.ann ?? 0, sd.players.ann.supply], [2, 2, 0, s.players.ann.supply + 2]);
  assert.ok(checkTarget(s, 'ann', cardById('showdown'), { location: loc, faction: g, from: [loc, loc, loc] })); // only 2 of your sway there
  s.board[loc].tokens = { [g]: 4, [h]: 1 };
  assert.ok(checkTarget(s, 'ann', cardById('showdown'), { location: loc, faction: g, from: [loc] })); // never a fight
  // Switch Allegiance: standing 1:1; or your sway jumps anywhere.
  hand('switch');
  const sw = previewTarget(s, 'ann', 'switch', { use: 'standing', faction: f, to: g, payers: [f, f] });
  assert.deepEqual([sw.players.ann.standing[f], sw.players.ann.standing[g]], [s.players.ann.standing[f] - 2, s.players.ann.standing[g] + 2]);
  const far = /** @type {string} */ (spec.locations[spec.locations.length - 1].id);
  const sj = previewTarget(s, 'ann', 'switch', { use: 'sway', location: loc, to: far, from: [far, far] });
  assert.deepEqual([sj.board[loc].sway.ann ?? 0, sj.board[far].sway.ann], [0, 2]);
});

test('Steal Their Playbook (designer, 2026-10-24): theirs copies the last card played for its action this round; yours takes one of your plays back', () => {
  const s = clear(draftAll(newGame()));
  s.opened = true;
  const pid = s.seating[s.turn];
  s.players[pid].hand = ['playbook', 'plough'];
  assert.ok(checkTarget(s, pid, cardById('playbook'), { use: 'theirs' })); // nothing played yet
  s.roundPlays = [{ pid, card: 'gate', use: 'sway' }, { pid: 'zed', card: 'showdown', use: 'action' }];
  const c = nextChoice(s, pid, 'playbook', {});
  assert.ok(c.kind === 'use' && c.options.includes('yours'));
  // Yours: the Gate, played for sway earlier, comes back to hand.
  const back = applyMove(s, { playerId: pid, move: { type: 'play', card: 'playbook', use: 'action', target: { use: 'yours', back: 'gate' } } });
  assert.ok(back.players[pid].hand.includes('gate'));
  assert.ok(!(back.roundPlays ?? []).some((x) => x.card === 'gate'));
});

test('A way back (designer, 2026-10-26): a suit card brings its faction back while it has no location with 2 or more, up to its sway, 1 standing each', () => {
  const s = clear(draftAll(newGame()));
  s.opened = true;
  const pid = s.seating[s.turn];
  const noct = /** @type {string} */ (factionOfArchetype(s, 'nocturnals'));
  const home = /** @type {string} */ (spec.locations.find((l) => l.archetype === 'nocturnals')?.id);
  s.players[pid].hand = ['invite-in', 'gate']; // a ◐ strike, printed sway 2
  s.players[pid].standing[noct] = 5;
  const supply = s.supply[noct], cubes = s.players[pid].supply;
  const play = (/** @type {string[]} */ places) => /** @type {import('../public/engine.js').Move} */ ({ type: 'play', card: 'invite-in', use: 'return', places });
  const move = play([home, home]);
  assert.equal(validate(s, { playerId: pid, move }).ok, true); // the Nocturnals are gone: no location with 2 or more
  assert.equal(validate(s, { playerId: pid, move: play([home, home, home]) }).ok, false); // more than its sway
  const after = applyMove(s, { playerId: pid, move });
  assert.deepEqual([after.board[home].tokens[noct], after.supply[noct], after.players[pid].standing[noct], after.players[pid].supply], [2, supply - 2, 3, cubes + 2]);
  s.board[home].tokens = { [noct]: 2 };
  assert.equal(validate(s, { playerId: pid, move }).ok, false); // it can still grow: no way back
  s.options.wayBack = 'off'; s.board[home].tokens = {};
  assert.equal(validate(s, { playerId: pid, move }).ok, false); // variant off
});

test('Night Terrors (◐ signature): marks, then at nightfall 1 token may flee each mark to a neighbour, your sway following if you choose (designer, 2026-10-20)', () => {
  const s = clear(draftAll(newGame()));
  s.opened = true;
  const noct = /** @type {string} */ (factionOfArchetype(s, 'nocturnals'));
  const [f] = s.factions.filter((x) => x !== noct);
  const map = /** @type {Record<string, { adjacent: string[] }>} */ (spec.map.locations);
  const loc = /** @type {string} */ (spec.locations.find((l) => l.archetype !== 'nocturnals')?.id);
  const b = map[loc].adjacent[1];
  s.board[loc].tokens = { [noct]: 3 };
  s.board[b].tokens = { [f]: 2 };
  const pid = s.seating[s.turn];
  s.players[pid].hand = ['night-terrors', ...s.players[pid].hand.filter((c) => c !== 'night-terrors')].slice(0, 2);
  const t = { mode: /** @type {const} */ ('faction'), moves: [{ location: loc, faction: noct, to: '' }] };
  assert.equal(checkTarget(s, pid, cardById('night-terrors'), t), null);
  let g = applyMove(s, { playerId: pid, move: { type: 'play', card: 'night-terrors', use: 'action', target: t } });
  assert.equal(g.board[loc].terror, pid);
  // Everyone passes: night falls before the fights, and the card's player decides.
  for (let i = 0; i < 10 && g.phase === 'play'; i++) g = applyMove(g, { playerId: g.seating[g.turn], move: { type: 'pass' } });
  assert.equal(g.phase, 'night');
  assert.deepEqual(waitingOn(g), [pid]);
  assert.equal(validate(g, { playerId: pid, move: { type: 'flee', location: loc, faction: noct, to: loc } }).ok, false); // to a neighbour
  // 1 Nocturnal flees into the lone rival next door: a fight, with the mark's sway following.
  const night = applyMove(g, { playerId: pid, move: { type: 'flee', location: loc, faction: noct, to: b, follow: true } });
  assert.notEqual(night.phase, 'night');
  assert.equal(night.board[loc].tokens[noct] >= 2, true);
  // Letting them be is allowed too.
  const calm = applyMove(g, { playerId: pid, move: { type: 'flee', location: loc } });
  assert.notEqual(calm.phase, 'night');
});

test('Study the Bodies (ↂ signature): marks like the Altar; at a marked fight, if you lead, you also take 1 from the runner-up\'s pile (designer, 2026-10-19, 2026-10-20)', () => {
  const s = clear(newGame());
  const sci = /** @type {string} */ (factionOfArchetype(s, 'scifi'));
  const [f] = s.factions.filter((x) => x !== sci);
  const arch = (/** @type {string} */ x) => spec.factions.find((y) => y.id === x)?.archetype;
  const loc = /** @type {string} */ (spec.locations.find((l) => ![arch(f), 'scifi'].includes(l.archetype))?.id);
  s.board[loc].tokens = { [sci]: 6, [f]: 4 };
  s.board[loc].sway = { ann: 2, cat: 2 }; // ann's bid makes 3: ann leads
  s.players.ann.standing[sci] = 2;
  s.players.ann.hand = ['study-bodies', 'gate'];
  const t = { mode: /** @type {const} */ ('faction'), moves: [{ location: loc, faction: sci, to: '' }] };
  assert.equal(checkTarget(s, 'ann', cardById('study-bodies'), t), null);
  const after = { ...s, ...previewTarget(s, 'ann', 'study-bodies', t) };
  assert.equal(after.board[loc].study, 'ann');
  // 6 beat 4: the winner loses 2. ann leads: the 4, and 1 of the 2; cat, runner-up, the 1 left.
  const fought = resolveFight(after, loc);
  assert.deepEqual([fought.players.ann.trophies[f], fought.players.ann.trophies[sci], fought.players.cat.trophies[sci]], [4, 1, 1]);
  // Not leading: nothing extra. bob leads with 5; ann (3) is runner-up and takes the 2 as usual.
  after.board[loc].sway = { ...after.board[loc].sway, bob: 5 };
  const lost = resolveFight(after, loc);
  assert.deepEqual([lost.players.bob.trophies[f], lost.players.ann.trophies[sci]], [4, 2]);
  // Players tied for runner-up: that pile goes back to the supply, and the leader takes nothing from it (designer, 2026-10-20).
  const home = spec.locations.find((l) => l.id === loc)?.archetype;
  const [p, q] = ['bob', 'cat', 'dan', 'eve'].filter((x) => spec.slayerGroups.find((gr) => gr.id === after.players[x].group)?.archetype !== home); // no affinity to break the tie
  after.board[loc].sway = { ann: 3, [p]: 2, [q]: 2 };
  const tied = resolveFight(after, loc);
  assert.deepEqual([tied.players.ann.trophies[f], tied.players.ann.trophies[sci] ?? 0, tied.players[p].trophies[sci] ?? 0], [4, 0, 0]);
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
  s.players.ann.hand = ['wake-the-dead', 'gate', 'plough', 'ritual']; // a signature's sway: 1 per card in hand, itself included (D24)
  const t = { mode: /** @type {const} */ ('location'), location: loc, from: [loc, loc, loc], payer: dead };
  assert.equal(checkTarget(s, 'ann', cardById('wake-the-dead'), t), null);
  // Common rule 8 (designer, 2026-10-20): a faction there may pay instead, the risen Undead included; not one elsewhere.
  s.players.ann.standing[f] = 3;
  assert.equal(checkTarget(s, 'ann', cardById('wake-the-dead'), { ...t, payer: f }), null);
  const elsewhere = s.factions.find((x) => ![dead, f, g].includes(x));
  assert.ok(checkTarget(s, 'ann', cardById('wake-the-dead'), { ...t, payer: elsewhere }));
  s.players.ann.standing[f] = 0;
  assert.ok(checkTarget(s, 'ann', cardById('wake-the-dead'), { ...t, from: [loc, loc, loc, loc] })); // only 3 standing
  const late = { ...s, players: { ...s.players, ann: { ...s.players.ann, hand: ['wake-the-dead', 'gate'] } } };
  assert.ok(checkTarget(late, 'ann', cardById('wake-the-dead'), t)); // 2 cards in hand: up to 2 rise (D24)
  assert.equal(checkTarget(late, 'ann', cardById('wake-the-dead'), { ...t, from: [loc, loc] }), null);
  const after = { ...s, ...previewTarget(s, 'ann', 'wake-the-dead', t) };
  assert.deepEqual(after.board[loc].tokens, { [f]: 6, [g]: 3, [dead]: 3 });
  assert.equal(after.board[loc].sway.ann, 3); // the bid: one sway for each risen
  assert.equal(after.players.ann.standing[dead], 0);
  assert.deepEqual(fightsDue(after).includes(loc), true);
  // The fight: 6 beat 3 and 3; both losers lose everything; the winner loses half the larger loser's number.
  const fought = resolveFight(after, loc);
  assert.deepEqual(fought.board[loc].tokens, { [f]: 4 }); // half of 3, rounded up (D25)
  // Piles 3, 3 and 2: ann leads (3 sway) and takes the two larger; bob, runner-up, the smallest.
  assert.equal(Object.values(fought.players.ann.trophies).reduce((x, y) => x + y, 0), 6);
  assert.equal(fought.players.bob.trophies[f], 2);
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

test('Plough Through: every side of a fight leaves by half rounded up, through its own exits; a side of 1 leaves entirely; the sway split as you choose among the fight\'s factions and the Nocturnals (designer, 2026-10-17, 2026-10-21)', () => {
  const s = clear(newGame());
  const map = /** @type {Record<string, { adjacent: string[] }>} */ (spec.map.locations);
  const noct = /** @type {string} */ (factionOfArchetype(s, 'nocturnals'));
  const [g, h] = s.factions.filter((x) => x !== noct);
  const loc = /** @type {string} */ (spec.locations.find((l) => l.archetype === 'nocturnals' && map[l.id].adjacent.length >= 3)?.id);
  const [a, b, c] = map[loc].adjacent;
  s.board[loc].tokens = { [noct]: 5, [g]: 1 };
  s.players.ann.standing[noct] = 0;
  s.players.ann.standing[g] = 4;
  const first = s.factions.find((f) => f === noct || f === g); // sides in the order of the factions
  const exits = first === noct ? [a, a, b, c] : [c, a, a, b]; // the Nocturnals: 3 out (2 to a, 1 to b); the other: 1 to c
  // Three exits and the fight: 4 sway, here all from the other side.
  const t = { mode: /** @type {const} */ ('faction'), location: loc, from: exits, payers: [g, g, g, g] };
  assert.equal(checkTarget(s, 'ann', cardById('plough'), t), null);
  const after = previewTarget(s, 'ann', 'plough', t);
  assert.deepEqual([after.board[loc].tokens[noct], after.board[loc].tokens[g] ?? 0, after.board[a].tokens[noct], after.board[b].tokens[noct], after.board[c].tokens[g]], [2, 0, 2, 1, 1]);
  assert.deepEqual([loc, a, b, c].map((l) => after.board[l].sway.ann), [1, 1, 1, 1]);
  assert.equal(after.players.ann.standing[g], 0);
  s.players.ann.standing[g] = 3;
  assert.ok(checkTarget(s, 'ann', cardById('plough'), t)); // 3 standing for 4 sway
  // Split as you choose: 2 from each.
  s.players.ann.standing[noct] = 2; s.players.ann.standing[g] = 2;
  assert.equal(checkTarget(s, 'ann', cardById('plough'), { ...t, payers: [noct, g, noct, g] }), null);
  assert.ok(checkTarget(s, 'ann', cardById('plough'), { ...t, payers: [h, g, noct, g] })); // never a faction outside the fight but the Nocturnals
  s.players.ann.standing[g] = 4;
  const clash = first === noct ? [a, a, b, a] : [a, a, a, b];
  assert.ok(checkTarget(s, 'ann', cardById('plough'), { ...t, from: clash })); // never two sides to one location
  assert.ok(checkTarget(s, 'ann', cardById('plough'), { ...t, from: exits.slice(1) })); // every side leaves in full
  // At a ◐ fight without the Nocturnals, they may still pay.
  s.board[loc].tokens = { [g]: 2, [h]: 2 };
  s.players.ann.standing[g] = 0; s.players.ann.standing[h] = 0; s.players.ann.standing[noct] = 3;
  const first2 = s.factions.find((f) => f === g || f === h);
  const ex2 = first2 === g ? [a, b] : [b, a];
  assert.equal(checkTarget(s, 'ann', cardById('plough'), { mode: 'location', location: loc, from: ex2, payers: [noct, noct, noct] }), null);
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

test('a game saved before an option existed plays on with its default', () => {
  const s = newGame(7);
  delete (/** @type {Record<string, string>} */ (s.options)).swayPerMove;
  const end = playOut(s, rng(7), undefined, Object.fromEntries(s.seating.map((pid) => [pid, fast('trophy')])));
  assert.equal(end.phase, 'ended');
  for (const pid of end.seating) for (const n of Object.values(end.players[pid].standing)) assert.ok(Number.isFinite(n));
});

test('IC1: a card is played only if its sway can be paid', () => {
  const s = clear(newGame());
  const map = /** @type {Record<string, { adjacent: string[] }>} */ (spec.map.locations);
  const from = /** @type {string} */ (Object.keys(map).find((l) => map[l].adjacent.length >= 3));
  const dem = /** @type {string} */ (factionOfArchetype(s, 'demonic'));
  s.board[from].tokens = { [dem]: 5 };
  s.players.ann.standing[dem] = 1;
  const [p, q] = map[from].adjacent;
  assert.match(String(checkTarget(s, 'ann', cardById('light-cross'), { mode: 'faction', location: from, faction: dem, split: { [p]: 2, [q]: 3 } })), /both/); // Light of the Cross must pay both or not play
  const sen = /** @type {string} */ (factionOfArchetype(s, 'sentients'));
  s.board[from].tokens = { [sen]: 5 };
  s.board[q].tokens = { [sen]: 1 };
  s.players.ann.standing[sen] = 0;
  const cut = { mode: /** @type {const} */ ('faction'), location: from, faction: sen, from: [] };
  assert.ok(checkTarget(s, 'ann', cardById('cut-powerlines'), cut));
  const off = { ...s, options: { ...s.options, swayRequired: 'off' } };
  assert.equal(checkTarget(off, 'ann', cardById('cut-powerlines'), cut), null);
});

