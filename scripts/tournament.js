// @ts-check
/**
 * Bot tournament: whole games with a different bot profile in each seat,
 * rotated so every profile sits in every seat equally. Shows which play
 * profile wins most, and how each one's games end. For tuning the bots
 * (their strategy breakpoints, public/bots.js), not the rules.
 *
 *   node scripts/tournament.js [games=50] [seed=1] [profiles=goal,goal-deep,hunter,goal,goal] [option=value ...]
 *
 * One seat per profile, so the profile count is the player count (3 to 5).
 * Goal profiles take persona overrides for tuning: goal:proof=0.4,other=0.6.
 * Profiles are separated by semicolons when overrides use commas:
 * profiles="goal;goal:proof=0.4,other=0.6;hunter".
 * A shared win counts as a fraction for each winner. Runs across every core.
 */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createGame } from '../public/engine.js';
import { PROFILES } from '../public/bots.js';
import { playOut } from './simulate.js';
import { seededRng } from './balance.js';

/** @typedef {import('../public/bots.js').Profile} Profile */

function main() {
  const args = process.argv.slice(2);
  const [gamesArg = '50', seedArg = '1'] = args.filter((a) => !a.includes('='));
  const pairs = Object.fromEntries(args.filter((a) => a.includes('=')).map((a) => [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)]));
  const list = /** @type {Profile[]} */ ((pairs.profiles ?? 'goal,goal-deep,hunter,goal,goal').split(pairs.profiles?.includes(';') ? ';' : ','));
  delete pairs.profiles;
  for (const p of list) if (!PROFILES.includes(/** @type {Profile} */ (p.split(':')[0]))) throw new Error(`unknown bot profile ${p}; try ${PROFILES.join(', ')} (goal profiles take overrides: goal:proof=0.4)`);
  const games = Number(gamesArg), seed = Number(seedArg);
  const workers = Math.min(availableParallelism(), games);
  /** @type {Record<string, { wins: number, island: number, invaders: number }>} */
  const tally = Object.fromEntries(list.map((p) => [p, { wins: 0, island: 0, invaders: 0 }]));
  const sides = { island: 0, invaders: 0 };
  let done = 0, running = workers;
  const t0 = Date.now();
  for (let w = 0; w < workers; w++) {
    const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { games, seed, list, options: pairs, worker: w, workers } });
    worker.on('message', (/** @type {{ side: 'island' | 'invaders', winners: Profile[] }} */ r) => {
      sides[r.side] += 1;
      for (const p of r.winners) { tally[p].wins += 1 / r.winners.length; tally[p][r.side] += 1 / r.winners.length; }
      done += 1;
      process.stderr.write(`\r${done}/${games} games, ${Math.round((Date.now() - t0) / 1000)}s`);
    });
    worker.on('error', (e) => { throw e; });
    worker.on('exit', () => { running -= 1; if (!running) report(); });
  }
  function report() {
    process.stderr.write('\n');
    console.log(`${done} games, ${list.length} players, ${JSON.stringify(pairs)}. Island won ${sides.island}, invaders ${sides.invaders}. An even share is ${(100 / list.length).toFixed(0)}%.`);
    console.log(`${'profile'.padEnd(16)} | wins | share | won as island | won as invaders`);
    for (const p of list.slice().sort((a, b) => tally[b].wins - tally[a].wins)) {
      const t = tally[p];
      console.log(`${p.padEnd(16)} | ${t.wins.toFixed(1).padStart(4)} | ${`${((100 * t.wins) / done).toFixed(0)}%`.padStart(5)} | ${t.island.toFixed(1).padStart(13)} | ${t.invaders.toFixed(1).padStart(15)}`);
    }
  }
}

if (isMainThread) main();
else {
  const d = workerData;
  const players = d.list.map((/** @type {string} */ _, /** @type {number} */ i) => `P${i + 1}`);
  for (let g = d.worker; g < d.games; g += d.workers) {
    // Rotate: in game g, seat i plays profile (i + g) mod n.
    /** @type {Record<string, Profile>} */
    const seats = Object.fromEntries(players.map((/** @type {string} */ pid, /** @type {number} */ i) => [pid, d.list[(i + g) % d.list.length]]));
    const end = playOut(createGame({ seed: d.seed * 10007 + g, players, options: d.options }), seededRng(d.seed * 7 + g), undefined, seats);
    const result = /** @type {NonNullable<typeof end.result>} */ (end.result);
    parentPort?.postMessage({ side: result.side, winners: result.players.map((pid) => seats[pid]) });
  }
}
