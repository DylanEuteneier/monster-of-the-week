// @ts-check
/**
 * Bot tournament: whole games with a bot profile in each seat, rotated so
 * every profile sits in every seat equally. Two uses:
 * - tuning the bots: which profile wins most, and how each one's games end;
 * - balancing the cards (designer, 2026-10-08): every card play is recorded,
 *   with what it was played for (its action or its influence), whether it
 *   opened the round, and the swing in its player's chance of winning at that
 *   moment (winChances in public/bots.js, percentage points); with each
 *   game's ending and winners, and the cards held but never played.
 *
 *   node scripts/tournament.js [games=50] [seed=1] [profiles=goal,goal-deep,hunter,goal,goal] [log=games.jsonl] [out=summary.json] [option=value ...]
 *
 * - log= appends one line per finished game. A run with the same log resumes:
 *   games already in it are skipped, so a stopped run loses nothing.
 * - out= is rewritten after every game with the summary so far: profiles,
 *   endings, and per card how often it was dealt, held, played for its action
 *   or its influence, left unplayed or used as an opener, the mean swing in
 *   win chance per use, and how often its player went on to win. The card
 *   review page reads public/card-play-stats.json.
 * - Whole-game figures show what strong bots choose and how games end, not
 *   cause: a card's win rate mixes the card with the position it was played
 *   from. Round play-outs (scripts/roundplay.js) are the controlled check.
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
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createGame, applyMove, cardById } from '../public/engine.js';
import { PROFILES, botMove, winChances } from '../public/bots.js';
import { seededRng } from './balance.js';

/** @typedef {import('../public/bots.js').Profile} Profile @typedef {import('../public/engine.js').GameState} GameState */
/** @typedef {{ r: number, seat: string, card: string, use: 'action' | 'influence', dWin: number, opener: boolean }} Play */
/** @typedef {{ g: number, side: 'island' | 'invaders', seats: Record<string, string>, winners: string[], deck: string[], plays: Play[], held: string[], unplayed: string[] }} GameRecord */

const MAX_MOVES = 20_000;

/** The player's chance of winning, in percentage points. @param {GameState} s @param {string} pid */
const chance = (s, pid) => { const c = winChances(s, pid); return 100 * (c.pInvaders * c.asInvaders + (1 - c.pInvaders) * c.asIsland); };

/** Summary of every game so far. @param {GameRecord[]} records @param {string[]} list @param {Record<string, string>} options */
function summarise(records, list, options) {
  const sides = { island: 0, invaders: 0 };
  /** @type {Record<string, { wins: number, island: number, invaders: number }>} */
  const profiles = Object.fromEntries(list.map((p) => [p, { wins: 0, island: 0, invaders: 0 }]));
  /** @typedef {{ dealt: number, held: number, unplayed: number, action: number, influence: number, opener: number, dAction: number, dInfluence: number, winAction: number, winInfluence: number, endsIsland: number }} Acc */
  /** @type {Record<string, Acc>} */
  const cards = {};
  const acc = (/** @type {string} */ id) => (cards[id] ??= { dealt: 0, held: 0, unplayed: 0, action: 0, influence: 0, opener: 0, dAction: 0, dInfluence: 0, winAction: 0, winInfluence: 0, endsIsland: 0 });
  for (const r of records) {
    sides[r.side] += 1;
    for (const pid of r.winners) { const p = profiles[r.seats[pid]]; if (p) { p.wins += 1 / r.winners.length; p[r.side] += 1 / r.winners.length; } }
    for (const id of r.deck) acc(id).dealt += 1;
    for (const id of r.held) acc(id).held += 1;
    for (const id of r.unplayed) acc(id).unplayed += 1;
    for (const p of r.plays) {
      const a = acc(p.card);
      const won = r.winners.includes(p.seat) ? 1 / r.winners.length : 0;
      if (p.use === 'action') { a.action += 1; a.dAction += p.dWin; a.winAction += won; if (r.side === 'island') a.endsIsland += 1; } else { a.influence += 1; a.dInfluence += p.dWin; a.winInfluence += won; }
      if (p.opener) a.opener += 1;
    }
  }
  const r1 = (/** @type {number} */ x) => Math.round(x * 10) / 10;
  const pct = (/** @type {number} */ x, /** @type {number} */ n) => (n ? r1((100 * x) / n) : null);
  return {
    updated: new Date().toISOString(), games: records.length, players: list.length, profiles: list, options, sides,
    byProfile: Object.fromEntries(Object.entries(profiles).map(([p, t]) => [p, { share: pct(t.wins, records.length), island: r1(t.island), invaders: r1(t.invaders) }])),
    cards: Object.fromEntries(Object.entries(cards).map(([id, a]) => [id, {
      name: cardById(id).name, dealt: a.dealt, held: a.held, action: a.action, influence: a.influence, unplayed: a.unplayed, opener: a.opener,
      playedPct: pct(a.action + a.influence, a.held), actionPct: pct(a.action, a.action + a.influence),
      dWinAction: a.action ? r1(a.dAction / a.action) : null, dWinInfluence: a.influence ? r1(a.dInfluence / a.influence) : null,
      winAfterAction: pct(a.winAction, a.action), winAfterInfluence: pct(a.winInfluence, a.influence), islandAfterAction: pct(a.endsIsland, a.action),
    }])),
  };
}

function main() {
  const args = process.argv.slice(2);
  const [gamesArg = '50', seedArg = '1'] = args.filter((a) => !a.includes('='));
  const pairs = Object.fromEntries(args.filter((a) => a.includes('=')).map((a) => [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)]));
  const list = (pairs.profiles ?? 'goal,goal-deep,hunter,goal,goal').split(pairs.profiles?.includes(';') ? ';' : ',');
  const logFile = pairs.log, outFile = pairs.out;
  delete pairs.profiles; delete pairs.log; delete pairs.out;
  for (const p of list) if (!PROFILES.includes(/** @type {Profile} */ (p.split(':')[0]))) throw new Error(`unknown bot profile ${p}; try ${PROFILES.join(', ')} (goal profiles take overrides: goal:proof=0.4)`);
  const games = Number(gamesArg), seed = Number(seedArg);
  /** @type {GameRecord[]} */
  const records = logFile && existsSync(logFile) ? readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const done = new Set(records.map((r) => r.g));
  const todo = Array.from({ length: games }, (_, g) => g).filter((g) => !done.has(g));
  if (records.length) process.stderr.write(`resuming: ${records.length} games already in ${logFile}\n`);
  const write = () => { if (outFile) writeFileSync(outFile, `${JSON.stringify(summarise(records, list, pairs), null, 2)}\n`); };
  if (!todo.length) { write(); report(); return; }
  const workers = Math.min(availableParallelism(), todo.length);
  let running = workers;
  const t0 = Date.now();
  for (let w = 0; w < workers; w++) {
    const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { games: todo.filter((_, i) => i % workers === w), seed, list, options: pairs } });
    worker.on('message', (/** @type {GameRecord} */ r) => {
      records.push(r);
      if (logFile) appendFileSync(logFile, `${JSON.stringify(r)}\n`);
      write();
      process.stderr.write(`\r${records.length}/${games} games, ${Math.round((Date.now() - t0) / 1000)}s`);
    });
    worker.on('error', (e) => { throw e; });
    worker.on('exit', () => { running -= 1; if (!running) report(); });
  }
  function report() {
    process.stderr.write('\n');
    const s = summarise(records, list, pairs);
    console.log(`${s.games} games, ${list.length} players, ${JSON.stringify(pairs)}. Island won ${s.sides.island}, invaders ${s.sides.invaders}. An even share is ${(100 / list.length).toFixed(0)}%.`);
    console.log(`${'profile'.padEnd(16)} | share | won as island | won as invaders`);
    for (const [p, t] of Object.entries(s.byProfile).sort((a, b) => (b[1].share ?? 0) - (a[1].share ?? 0))) console.log(`${p.padEnd(16)} | ${`${t.share}%`.padStart(5)} | ${String(t.island).padStart(13)} | ${String(t.invaders).padStart(15)}`);
    const rows = Object.entries(s.cards).filter(([, c]) => c.held > 0).sort((a, b) => (b[1].dWinAction ?? -99) - (a[1].dWinAction ?? -99));
    console.log(`\n${'card'.padEnd(30)} | held | played | as action | Δwin action | Δwin infl. | won after action | opener`);
    for (const [, c] of rows) {
      const f = (/** @type {number | null} */ x, /** @type {string} */ u = '') => (x === null ? '–' : `${x > 0 && u === 'pp' ? '+' : ''}${x}${u === '%' ? '%' : ''}`);
      console.log(`${c.name.padEnd(30)} | ${String(c.held).padStart(4)} | ${f(c.playedPct, '%').padStart(6)} | ${f(c.actionPct, '%').padStart(9)} | ${f(c.dWinAction, 'pp').padStart(11)} | ${f(c.dWinInfluence, 'pp').padStart(10)} | ${f(c.winAfterAction, '%').padStart(16)} | ${String(c.opener).padStart(6)}`);
    }
  }
}

if (isMainThread) main();
else {
  const d = workerData;
  const players = d.list.map((/** @type {string} */ _, /** @type {number} */ i) => `P${i + 1}`);
  for (const g of d.games) {
    // Rotate: in game g, seat i plays profile (i + g) mod n.
    /** @type {Record<string, string>} */
    const seats = Object.fromEntries(players.map((/** @type {string} */ pid, /** @type {number} */ i) => [pid, d.list[(i + g) % d.list.length]]));
    let s = createGame({ seed: d.seed * 10007 + g, players, options: d.options });
    const rng = seededRng(d.seed * 7 + g);
    /** @type {Record<string, import('../public/bots.js').BotMemory>} */
    const memory = Object.fromEntries(players.map((/** @type {string} */ pid) => [pid, {}]));
    /** @type {Play[]} */
    const plays = [];
    /** @type {string[]} */
    const held = [], unplayed = [];
    /** @type {Record<string, string[]> | null} */
    let hands = null; // this round's hands when play began, less what was played
    for (let n = 0; n < MAX_MOVES && s.phase !== 'ended'; n++) {
      if (s.phase === 'play' && !hands) {
        hands = Object.fromEntries(s.seating.map((pid) => [pid, s.players[pid].hand.slice()]));
        for (const h of Object.values(hands)) held.push(...h);
      }
      let moved = false;
      for (const pid of s.seating) {
        const move = botMove(s, { playerId: pid, rng, profile: /** @type {Profile} */ (seats[pid]), memory: memory[pid] });
        if (!move) continue;
        if (move.type === 'play') {
          const before = chance(s, pid), opener = !s.opened && pid === s.first;
          s = applyMove(s, { playerId: pid, move });
          if (s.pending && s.pending.player === pid) s = applyMove(s, { playerId: pid, move: { type: 'confirm' } });
          plays.push({ r: s.round, seat: pid, card: move.card, use: move.use, dWin: Math.round((chance(s, pid) - before) * 10) / 10, opener });
          if (hands) hands[pid] = hands[pid].filter((c, i, a) => c !== move.card || a.indexOf(c) !== i);
        } else s = applyMove(s, { playerId: pid, move });
        moved = true;
        break;
      }
      if (!moved) break;
      if (hands && s.phase !== 'play') { for (const h of Object.values(hands)) unplayed.push(...h); hands = null; }
    }
    const result = /** @type {NonNullable<GameState['result']>} */ (s.result);
    parentPort?.postMessage(/** @type {GameRecord} */ ({ g, side: result.side, seats, winners: result.players, deck: s.deck ?? [], plays, held, unplayed }));
  }
}
