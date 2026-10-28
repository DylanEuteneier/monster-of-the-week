// @ts-check
/**
 * The tutorial's table (public/tutorial-game.js) and the flight planner
 * (public/motion.js): both pure, so they run here without a page.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playerView, createGame, clone, validate } from '../public/rules.js';
import { newTable, copyTable, nextActor, autoMove, play, botPicks, YOU } from '../public/tutorial-game.js';
import { suggest } from '../public/hints.js';
import { planFlights } from '../public/motion.js';

/** Play the tutorial's game to the end, as its watch mode does. */
function playThrough() {
  const table = newTable();
  for (let i = 0; i < 5000 && table.state.phase !== 'ended'; i++) {
    if (table.state.phase === 'draft') {
      if (!table.state.players[YOU].picked) play(table, YOU, /** @type {any} */ (autoMove(table, YOU)));
      botPicks(table);
      continue;
    }
    const pid = /** @type {string} */ (nextActor(table.state));
    play(table, pid, /** @type {any} */ (autoMove(table, pid)));
  }
  return table.state;
}

test('the tutorial deal plays to the end, the same way every time', () => {
  const a = playThrough(), b = playThrough();
  assert.equal(a.phase, 'ended');
  assert.deepEqual(a.result, b.result);
  assert.deepEqual(a.log, b.log);
});

test('the tutorial\'s first round shows fights with piles for the learner, and growth', () => {
  const log = playThrough().log.find((e) => e.round === 1)?.events ?? [];
  assert.ok(log.some((l) => / beat /.test(l)), 'a fight');
  assert.ok(log.some((l) => l.startsWith(`  ${YOU} takes a pile`)), 'a pile for the learner');
  assert.ok(log.some((l) => / grows/.test(l)), 'growth');
});

test('flights: every token and cube that moved is paired from where it was to where it went', () => {
  const before = playerView(createGame({ seed: 4, players: ['Ann', 'Bob', 'Cat'] }), 'Ann');
  const after = structuredClone(before);
  const f = before.factions[0];
  const [from, to] = Object.keys(before.board).filter((l) => (before.board[l].tokens[f] ?? 0) > 0);
  // 3 cubes from Ann's supply into standing with f; 1 of them onto `to` with 1 of f's tokens from `from`.
  after.players.Ann.supply -= 3;
  after.players.Ann.standing[f] += 2;
  after.board[to].sway.Ann = (after.board[to].sway.Ann ?? 0) + 1;
  after.board[from].tokens[f] -= 1;
  after.board[to].tokens[f] += 1;
  const flights = planFlights(before, after, () => '#fff');
  const token = flights.filter((x) => x.faction === f);
  const cube = flights.filter((x) => x.owner === 'Ann');
  assert.deepEqual(token.map((x) => [x.from, x.to, x.n]), [[{ kind: 'loc', loc: from }, { kind: 'loc', loc: to }, 1]]);
  assert.deepEqual(cube.map((x) => [x.from.kind, x.to.kind, x.n]), [['supply', 'standing', 2], ['supply', 'loc', 1]]);
});

test('a game saved before influence was renamed sway still loads', async () => {
  const { upgradeState } = await import('../public/rules.js');
  const { upgradeRecord } = await import('../scripts/lib.js');
  const s = /** @type {any} */ (createGame({ seed: 2, players: ['Ann', 'Bob', 'Cat'] }));
  const loc = Object.keys(s.board)[0];
  s.board[loc].influence = { Ann: 2 }; delete s.board[loc].sway;
  s.options.influenceRequired = s.options.swayRequired; delete s.options.swayRequired;
  const up = /** @type {any} */ (upgradeState(s));
  assert.deepEqual(up.board[loc].sway, { Ann: 2 });
  assert.equal('influence' in up.board[loc], false);
  assert.equal(up.options.swayRequired, 'on');
  assert.deepEqual(upgradeRecord({ use: 'influence', dWinInfluence: 1, locationsWithInfluence: 2, name: 'influence of the moon' }), { use: 'sway', dWinSway: 1, locationsWithSway: 2, name: 'influence of the moon' });
});

/** Round 1, the learner's moves made by `pick` (the bots' dice kept as the tutorial keeps them). @param {(table: any) => any} pick */
function roundOne(pick) {
  const table = newTable();
  while (table.state.round === 1 && table.state.phase !== 'ended') {
    if (table.state.phase === 'draft') {
      if (!table.state.players[YOU].picked) { const m = pick(table); autoMove(table, YOU); play(table, YOU, m); }
      botPicks(table);
      continue;
    }
    const pid = /** @type {string} */ (nextActor(table.state));
    if (pid === YOU) { const m = pick(table); autoMove(table, YOU); play(table, YOU, m); } else play(table, pid, /** @type {any} */ (autoMove(table, pid)));
  }
  return table.state;
}

test('following the tutorial\'s hints replays its scripted round 1 exactly', () => {
  const scripted = roundOne((t) => autoMove(copyTable(t), YOU));
  const hinted = roundOne((t) => {
    const copy = copyTable(t);
    const move = autoMove(copy, YOU);
    const hint = suggest(t.state, YOU, clone(copy.memory[YOU] ?? {}), /** @type {any} */ (move));
    assert.ok(hint && hint.why.length && hint.plan && hint.rule);
    return hint?.move;
  });
  assert.deepEqual(hinted, scripted);
});

test('a hint (the bot\'s own choice) is always a legal move', () => {
  const memory = {};
  roundOne((t) => {
    const hint = suggest(t.state, YOU, memory);
    assert.ok(hint?.move);
    assert.ok(validate(t.state, { playerId: YOU, move: hint.move }).ok, JSON.stringify(hint.move));
    return hint.move;
  });
});
