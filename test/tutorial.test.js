// @ts-check
/**
 * The tutorial's table (public/tutorial-game.js) and the flight planner
 * (public/motion.js): both pure, so they run here without a page.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playerView, createGame } from '../public/engine.js';
import { newTable, nextActor, autoMove, play, botPicks, YOU } from '../public/tutorial-game.js';
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
  after.board[to].influence.Ann = (after.board[to].influence.Ann ?? 0) + 1;
  after.board[from].tokens[f] -= 1;
  after.board[to].tokens[f] += 1;
  const flights = planFlights(before, after, () => '#fff');
  const token = flights.filter((x) => x.faction === f);
  const cube = flights.filter((x) => x.owner === 'Ann');
  assert.deepEqual(token.map((x) => [x.from, x.to, x.n]), [[{ kind: 'loc', loc: from }, { kind: 'loc', loc: to }, 1]]);
  assert.deepEqual(cube.map((x) => [x.from.kind, x.to.kind, x.n]), [['supply', 'standing', 2], ['supply', 'loc', 1]]);
});
