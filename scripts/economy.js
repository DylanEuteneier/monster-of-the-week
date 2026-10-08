// @ts-check
/**
 * Influence economy study: how many fights are influence contests.
 *
 *   node scripts/economy.js [games=200] [seed=1] [players=5] [bots=goal] [option=value ...]
 *
 * Plays bot games and, at the end of each round's play phase (just before the
 * fights), looks at every contested location: how many players have
 * influence there. Also reports influence on the board and standing held.
 * A measuring tool, not a rule; bots are a rough guide (Appendix F.9).
 */
import { createGame, applyMove, nextRandom } from '../public/engine.js';
import { botMove } from '../public/bots.js';

/** @typedef {import('../public/engine.js').GameState} GameState */

/** @param {number} seed */
function seededRng(seed) {
  let s = seed | 0;
  return () => { const r = nextRandom(s); s = r.state; return r.value; };
}

function main() {
  const [gamesArg = '200', seedArg = '1', playersArg = '5', profileArg = 'goal'] = process.argv.slice(2).filter((a) => !a.includes('='));
  const options = Object.fromEntries(process.argv.slice(2).filter((a) => a.includes('=')).map((a) => a.split('=')));
  const profile = /** @type {import('../public/bots.js').Profile} */ (profileArg);
  const players = ['ann', 'bob', 'cat', 'dan', 'eve'].slice(0, Number(playersArg));
  const rng = seededRng(Number(seedArg));
  /** @type {Record<number, { rounds: number, fights: number, by: number[], onBoard: number, standing: number, influenced: number }>} */
  const byRound = {};
  for (let g = 0; g < Number(gamesArg); g++) {
    let game = createGame({ seed: Number(seedArg) * 1000 + g, players, options });
    for (let moves = 0; moves < 20000 && game.phase !== 'ended'; moves++) {
      let next = null;
      for (const playerId of game.seating) {
        const move = botMove(game, { playerId, rng, profile });
        if (!move) continue;
        next = applyMove(game, { playerId, move });
        break;
      }
      if (!next) break;
      if (game.phase === 'play' && next.phase !== 'play') {
        // The board as the fights find it.
        const r = (byRound[game.round] ??= { rounds: 0, fights: 0, by: [0, 0, 0, 0], onBoard: 0, standing: 0, influenced: 0 });
        r.rounds += 1;
        for (const place of Object.values(game.board)) {
          const who = Object.values(place.influence).filter((n) => n > 0).length;
          if (who > 0) r.influenced += 1;
          r.onBoard += Object.values(place.influence).reduce((a, b) => a + b, 0);
          if (place.scorched || Object.values(place.tokens).filter((n) => n > 0).length !== 2) continue;
          r.fights += 1;
          r.by[Math.min(3, who)] += 1;
        }
        for (const pid of game.seating) r.standing += Object.values(game.players[pid].standing).reduce((a, b) => a + b, 0);
      }
      game = next;
    }
  }
  const n = players.length;
  console.log(`${gamesArg} games, ${n} players, ${profile} bots, ${JSON.stringify(options)}. At the end of each round's play phase:`);
  console.log('round | fights | by players with influence there: 0 / 1 / 2 / 3+ | locations with any influence | influence on board per player | standing held per player');
  for (const [round, r] of Object.entries(byRound)) {
    const f = (/** @type {number} */ x) => (x / r.rounds).toFixed(1);
    const share = r.by.map((x) => `${(100 * x / (r.fights || 1)).toFixed(0)}%`).join(' / ');
    console.log(`${round.padStart(5)} | ${f(r.fights).padStart(6)} | ${share.padEnd(47)} | ${f(r.influenced).padStart(28)} | ${(r.onBoard / r.rounds / n).toFixed(1).padStart(29)} | ${(r.standing / r.rounds / n).toFixed(1).padStart(24)}`);
  }
}

main();
