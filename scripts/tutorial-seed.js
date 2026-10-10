// @ts-check
/**
 * Finds a deal for the tutorial (public/tutorial-game.js SEED): plays round 1
 * as the tutorial does and scores how much of a round it shows. Prototype
 * tooling, not rules.
 *
 *   node scripts/tutorial-seed.js [count=300] [from=1]
 */
import { newTable, nextActor, autoMove, play, botPicks, YOU } from '../public/tutorial-game.js';
import { cardById } from '../public/engine.js';

const [count = 300, from = 1] = process.argv.slice(2).map(Number);

/** Round 1 as the tutorial plays it. @param {number} seed */
function roundOne(seed) {
  const table = newTable(seed);
  const plays = /** @type {{ pid: string, use: string, card: string }[]} */ ([]);
  let fightsState = null;
  while (table.state.round === 1 && table.state.phase !== 'ended') {
    const s = table.state;
    if (s.phase === 'draft') {
      if (!s.players[YOU].picked) play(table, YOU, /** @type {any} */ (autoMove(table, YOU)));
      botPicks(table);
      continue;
    }
    const pid = /** @type {string} */ (nextActor(s));
    const move = /** @type {any} */ (autoMove(table, pid));
    if (move.type === 'play') plays.push({ pid, use: move.use, card: move.card });
    if (move.type === 'pass' && s.passesInRow === s.seating.length - 1) fightsState = s;
    play(table, pid, move);
  }
  const log = table.state.log.find((e) => e.round === 1)?.events ?? [];
  const fights = log.filter((l) => / beat | true tie/.test(l)).length;
  const yourPiles = log.filter((l) => l.startsWith(`  ${YOU} takes a pile`)).length;
  const piles = log.filter((l) => / takes a pile/.test(l)).length;
  const grows = log.some((l) => / grows/.test(l));
  const scorched = log.some((l) => /scorched/.test(l));
  const mine = plays.filter((p) => p.pid === YOU);
  const youAct = mine.some((p) => p.use === 'action');
  const youInf = mine.some((p) => p.use === 'influence');
  const botInf = plays.some((p) => p.pid !== YOU && p.use === 'influence');
  const first = log.find((l) => l.startsWith('Draft done'))?.replace(/Draft done\. | goes first\./g, '');
  const unsuitedYou = mine.some((p) => !cardById(p.card).suit);
  const contestedWithYou = fightsState ? Object.values(fightsState.board).filter((pl) => Object.values(pl.tokens).filter((n) => n > 0).length === 2 && (pl.influence[YOU] ?? 0) > 0).length : 0;
  const score = (youAct ? 3 : 0) + (youInf ? 3 : 0) + (botInf ? 1 : 0) + Math.min(fights, 4) + (yourPiles ? 3 : 0) + Math.min(piles, 4) * 0.5 + (grows ? 2 : 0) + (first !== YOU ? 1 : 0) + (contestedWithYou ? 1 : 0) - (scorched ? 0 : 0) - (unsuitedYou ? 0 : 0) - Math.max(0, plays.length - 14) * 0.3;
  return { seed, score, fights, piles, yourPiles, youAct, youInf, botInf, grows, scorched, first, plays: plays.length };
}

const results = [];
for (let seed = from; seed < from + count; seed++) {
  try { results.push(roundOne(seed)); } catch (e) { console.error(seed, e instanceof Error ? e.message : e); }
}
results.sort((a, b) => b.score - a.score);
for (const r of results.slice(0, 12)) console.log(JSON.stringify(r));
