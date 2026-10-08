// @ts-check
/**
 * The tuning tournament (designer, 2026-10-08: one script for tuning; the
 * simulate, economy, balance and roundplay scripts are merged in). Whole games
 * with a bot profile in each seat, rotated so every profile sits in every seat
 * equally. Per game it records:
 * - the game: its ending and winners, wins by seat, profile and slayer group,
 *   total presence after each round, scorched locations, trophies per player;
 * - the economy at the end of each round's play, before the fights: fights,
 *   and how many players have influence at each (bidding contests),
 *   locations with influence, influence on the board and standing held;
 * - every card play: what it was played for (its action or its influence),
 *   whether it opened the round, the swing in its player's chance of winning
 *   (winChances in public/bots.js, percentage points), and for actions what
 *   the play did to this round's fights (trophies changing hands, fights
 *   whose winner flips weighted by the tokens lost there), control taken
 *   (contested locations where its player became sole top influence), pieces
 *   moved or placed, influence placed, and presence after the reckoning;
 * - per card in hand, each turn its player acts, whether it had a legal target
 *   (playable);
 * - probes: on a share of turns (probe=0.05), the controlled card test
 *   (scripts/lib.js measureState): a random probeSample= of the cards (or of
 *   probeCards=), each played in that moment against letting the turn go, the
 *   rest of the round played out. It covers cards nobody held, and gives cause
 *   where whole games give correlation.
 *
 *   node scripts/tournament.js [games=50] [seed=1] [profiles=goal,goal-deep,hunter,goal,goal]
 *     [log=games.jsonl] [out=summary.json] [probe=0] [probeSample=6] [probeCards=id,id] [probePlayouts=2] [probeTargets=2] [option=value ...]
 *
 * - log= appends one line per finished game; a run with the same log resumes,
 *   skipping games already in it. out= is rewritten after every game with the
 *   summary so far (public/card-play-stats.json is what the card review page
 *   reads). Runs across every core.
 * - One seat per profile, so the profile count is the player count (3 to 5).
 *   Goal profiles take persona overrides: goal:proof=0.4,other=0.6; separate
 *   profiles with semicolons when overrides use commas.
 * A measuring tool, not a rule; bot figures are a guide (Appendix F.9).
 */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createGame, applyMove, cardById, spec, totalPresence, resolveFight, growthDue, sampleTarget, validate } from '../public/engine.js';
import { PROFILES, botMove } from '../public/bots.js';
import { seededRng, chance, measureState, MAX_MOVES } from './lib.js';

/** @typedef {import('../public/bots.js').Profile} Profile @typedef {import('../public/engine.js').GameState} GameState */
/** @typedef {{ trophies: number, flips: number, control: number, moved: number, placed: number, presence: number }} Effect */
/** @typedef {{ r: number, seat: string, card: string, use: 'action' | 'influence', dWin: number, opener: boolean, fx?: Effect }} Play */
/** @typedef {{ r: number, fights: number, by: number[], influenced: number, onBoard: number, standing: number }} Economy */
/** @typedef {{ r: number, opening: boolean, benefit: Record<string, number | null> }} Probe */
/**
 * @typedef {{ g: number, side: 'island' | 'invaders', seats: Record<string, string>, groups: Record<string, string>, winners: string[], deck: string[],
 *   presence: number[], scorched: number, trophies: Record<string, number>, economy: Economy[], plays: Play[], held: string[], unplayed: string[],
 *   playable: Record<string, [number, number]>, probes: Probe[] }} GameRecord
 */

// ---------------------------------------------------------------------------
// What a play did (the measures of the former balance study, on the actual play)
// ---------------------------------------------------------------------------

/** @param {GameState['board'][string]} place */
const contestedPlace = (place) => !place.scorched && Object.values(place.tokens).filter((n) => n > 0).length === 2;

/** This round's fights and growth on a copy: presence after, trophies per player, each fight's winner and losses. @param {GameState} state */
function reckon(state) {
  let s = state;
  /** @type {Record<string, { winner: string, lost: number }>} */
  const fights = {};
  for (const loc of Object.keys(s.board)) {
    const place = s.board[loc];
    if (!contestedPlace(place)) continue;
    const here = Object.keys(place.tokens).filter((f) => place.tokens[f] > 0);
    const before = here.reduce((n, f) => n + place.tokens[f], 0);
    s = resolveFight(s, loc);
    const after = s.board[loc];
    fights[loc] = { winner: here.find((f) => (after.tokens[f] ?? 0) > 0) ?? '', lost: before - here.reduce((n, f) => n + (after.tokens[f] ?? 0), 0) };
  }
  let grown = 0;
  for (const f of s.factions) grown += Math.min(s.supply[f], Object.values(growthDue(s, f)).reduce((a, b) => a + b, 0));
  return { presence: totalPresence(s) + grown, trophies: Object.fromEntries(s.seating.map((p) => [p, Object.values(s.players[p].trophies).reduce((a, b) => a + b, 0)])), fights };
}

/** The sole top-influence player at a location, or null. @param {GameState['board'][string]} place */
function topOf(place) {
  const e = Object.entries(place.influence).filter(([, n]) => n > 0).sort((x, y) => y[1] - x[1]);
  return e.length && (e.length === 1 || e[0][1] > e[1][1]) ? e[0][0] : null;
}

/** What one play did, against the board before it. @param {GameState} was @param {GameState} now @param {string} pid @returns {Effect} */
function effectOf(was, now, pid) {
  const a = reckon(was), b = reckon(now);
  const trophies = was.seating.reduce((n, p) => n + Math.abs(b.trophies[p] - a.trophies[p]), 0);
  let flips = 0;
  for (const loc of new Set([...Object.keys(a.fights), ...Object.keys(b.fights)])) {
    const x = a.fights[loc], y = b.fights[loc];
    if ((x?.winner ?? '') !== (y?.winner ?? '')) flips += Math.max(x?.lost ?? 0, y?.lost ?? 0);
  }
  let control = 0, moved = 0, placed = 0;
  for (const loc of Object.keys(was.board)) {
    const p0 = was.board[loc], p1 = now.board[loc];
    if (contestedPlace(p1) && topOf(p1) === pid && topOf(p0) !== pid) control += 1;
    for (const f of new Set([...Object.keys(p0.tokens), ...Object.keys(p1.tokens)])) moved += Math.max(0, (p1.tokens[f] ?? 0) - (p0.tokens[f] ?? 0));
    if (p1.token && !p0.token) moved += 1;
    placed += Math.max(0, (p1.influence[pid] ?? 0) - (p0.influence[pid] ?? 0));
  }
  return { trophies, flips, control, moved, placed, presence: b.presence - a.presence };
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

const r1 = (/** @type {number} */ x) => Math.round(x * 10) / 10;
const pct = (/** @type {number} */ x, /** @type {number} */ n) => (n ? r1((100 * x) / n) : null);
const avg = (/** @type {number} */ x, /** @type {number} */ n) => (n ? Math.round((x / n) * 100) / 100 : null);

/** Summary of every game so far. @param {GameRecord[]} records @param {string[]} list @param {Record<string, string>} options */
function summarise(records, list, options) {
  const n = records.length;
  const sides = { island: 0, invaders: 0 };
  /** @type {Record<string, { wins: number, island: number, invaders: number }>} */
  const profiles = Object.fromEntries(list.map((p) => [p, { wins: 0, island: 0, invaders: 0 }]));
  /** @type {Record<string, number>} */ const seatWins = {};
  /** @type {Record<string, number>} */ const groupWins = {};
  /** @type {number[][]} */ const presence = [];
  let scorched = 0, trophySum = 0, trophyN = 0, shared = 0;
  /** @type {Record<number, Economy & { rounds: number }>} */
  const economy = {};
  /** @typedef {{ dealt: number, held: number, unplayed: number, action: number, influence: number, opener: number, dAction: number, dInfluence: number, winAction: number, winInfluence: number, endsIsland: number, fx: Effect, turns: number, playable: number, probes: number[], openingProbes: number[], probeNull: number }} Acc */
  /** @type {Record<string, Acc>} */
  const cards = {};
  const acc = (/** @type {string} */ id) => (cards[id] ??= { dealt: 0, held: 0, unplayed: 0, action: 0, influence: 0, opener: 0, dAction: 0, dInfluence: 0, winAction: 0, winInfluence: 0, endsIsland: 0, fx: { trophies: 0, flips: 0, control: 0, moved: 0, placed: 0, presence: 0 }, turns: 0, playable: 0, probes: [], openingProbes: [], probeNull: 0 });
  for (const r of records) {
    sides[r.side] += 1;
    if (r.winners.length > 1) shared += 1;
    for (const pid of r.winners) {
      const share = 1 / r.winners.length;
      const p = profiles[r.seats[pid]];
      if (p) { p.wins += share; p[r.side] += share; }
      seatWins[pid] = (seatWins[pid] ?? 0) + share;
      groupWins[r.groups[pid]] = (groupWins[r.groups[pid]] ?? 0) + share;
    }
    r.presence.forEach((x, i) => (presence[i] ??= []).push(x));
    scorched += r.scorched;
    for (const t of Object.values(r.trophies)) { trophySum += t; trophyN += 1; }
    for (const e of r.economy) {
      const x = (economy[e.r] ??= { r: e.r, rounds: 0, fights: 0, by: [0, 0, 0, 0], influenced: 0, onBoard: 0, standing: 0 });
      x.rounds += 1; x.fights += e.fights; e.by.forEach((v, i) => (x.by[i] += v)); x.influenced += e.influenced; x.onBoard += e.onBoard; x.standing += e.standing;
    }
    for (const id of r.deck) acc(id).dealt += 1;
    for (const id of r.held) acc(id).held += 1;
    for (const id of r.unplayed) acc(id).unplayed += 1;
    for (const [id, [turns, ok]] of Object.entries(r.playable)) { acc(id).turns += turns; acc(id).playable += ok; }
    for (const p of r.plays) {
      const a = acc(p.card);
      const won = r.winners.includes(p.seat) ? 1 / r.winners.length : 0;
      if (p.use === 'action') {
        a.action += 1; a.dAction += p.dWin; a.winAction += won;
        if (r.side === 'island') a.endsIsland += 1;
        if (p.fx) for (const k of /** @type {(keyof Effect)[]} */ (Object.keys(a.fx))) a.fx[k] += p.fx[k];
      } else { a.influence += 1; a.dInfluence += p.dWin; a.winInfluence += won; }
      if (p.opener) a.opener += 1;
    }
    for (const pr of r.probes) for (const [id, v] of Object.entries(pr.benefit)) {
      if (v === null) { acc(id).probeNull += 1; continue; }
      acc(id).probes.push(v);
      if (pr.opening) acc(id).openingProbes.push(v);
    }
  }
  const players = list.length;
  const mean = (/** @type {number[]} */ xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null);
  return {
    updated: new Date().toISOString(), games: n, players, profiles: list, options, sides, sharedWins: pct(shared, n),
    byProfile: Object.fromEntries(Object.entries(profiles).map(([p, t]) => [p, { share: pct(t.wins, n), island: r1(t.island), invaders: r1(t.invaders) }])),
    bySeat: Object.fromEntries(Object.entries(seatWins).map(([s, w]) => [s, pct(w, n)])),
    byGroup: Object.fromEntries(spec.slayerGroups.map((g) => [g.name, pct(groupWins[g.id] ?? 0, n)])),
    game: { presenceByRound: presence.map((xs) => mean(xs)), scorchedPerGame: avg(scorched, n), trophiesPerPlayer: avg(trophySum, trophyN) },
    economy: Object.values(economy).map((e) => ({
      round: e.r, fights: avg(e.fights, e.rounds), contests: e.by.map((v) => pct(v, e.fights)), locationsWithInfluence: avg(e.influenced, e.rounds),
      onBoardPerPlayer: avg(e.onBoard, e.rounds * players), standingPerPlayer: avg(e.standing, e.rounds * players),
    })),
    cards: Object.fromEntries(Object.entries(cards).map(([id, a]) => [id, {
      name: cardById(id).name, dealt: a.dealt, held: a.held, action: a.action, influence: a.influence, unplayed: a.unplayed, opener: a.opener,
      playedPct: pct(a.action + a.influence, a.held), actionPct: pct(a.action, a.action + a.influence), playablePct: pct(a.playable, a.turns),
      dWinAction: avg(a.dAction, a.action), dWinInfluence: avg(a.dInfluence, a.influence),
      winAfterAction: pct(a.winAction, a.action), winAfterInfluence: pct(a.winInfluence, a.influence), islandAfterAction: pct(a.endsIsland, a.action),
      perAction: Object.fromEntries(Object.entries(a.fx).map(([k, v]) => [k, avg(v, a.action)])),
      probe: { n: a.probes.length, benefit: mean(a.probes), up: pct(a.probes.filter((v) => v > 0).length, a.probes.length), opening: mean(a.openingProbes), openingN: a.openingProbes.length, noTarget: a.probeNull },
    }])),
  };
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const [gamesArg = '50', seedArg = '1'] = args.filter((a) => !a.includes('='));
  const pairs = Object.fromEntries(args.filter((a) => a.includes('=')).map((a) => [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)]));
  const list = (pairs.profiles ?? 'goal,goal-deep,hunter,goal,goal').split(pairs.profiles?.includes(';') ? ';' : ',');
  const logFile = pairs.log, outFile = pairs.out;
  const probe = { rate: Number(pairs.probe ?? 0), sample: Number(pairs.probeSample ?? 6), cards: pairs.probeCards?.split(','), playouts: Number(pairs.probePlayouts ?? 2), targets: Number(pairs.probeTargets ?? 2) };
  for (const k of ['profiles', 'log', 'out', 'probe', 'probeSample', 'probeCards', 'probePlayouts', 'probeTargets']) delete pairs[k];
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
    const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { games: todo.filter((_, i) => i % workers === w), seed, list, options: pairs, probe } });
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
    console.log(`${s.games} games, ${list.length} players, ${JSON.stringify(pairs)}. Island won ${s.sides.island}, invaders ${s.sides.invaders}; shared wins ${s.sharedWins}%. An even share is ${(100 / list.length).toFixed(0)}%.`);
    console.log(`${'profile'.padEnd(16)} | share | won as island | won as invaders`);
    for (const [p, t] of Object.entries(s.byProfile).sort((a, b) => (b[1].share ?? 0) - (a[1].share ?? 0))) console.log(`${p.padEnd(16)} | ${`${t.share}%`.padStart(5)} | ${String(t.island).padStart(13)} | ${String(t.invaders).padStart(15)}`);
    console.log(`\nPresence after each round: ${s.game.presenceByRound.join(' · ')}; scorched per game ${s.game.scorchedPerGame}; trophies per player ${s.game.trophiesPerPlayer}`);
    console.log(`Wins by seat: ${Object.entries(s.bySeat).map(([k, v]) => `${k} ${v}%`).join(' · ')}`);
    console.log(`Wins by slayer group: ${Object.entries(s.byGroup).map(([k, v]) => `${k} ${v}%`).join(' · ')}`);
    console.log('\nround | fights | by players with influence there: 0 / 1 / 2 / 3+ | locations with influence | influence on board per player | standing per player');
    for (const e of s.economy) console.log(`${String(e.round).padStart(5)} | ${String(e.fights).padStart(6)} | ${e.contests.map((x) => `${x}%`).join(' / ').padEnd(47)} | ${String(e.locationsWithInfluence).padStart(24)} | ${String(e.onBoardPerPlayer).padStart(29)} | ${String(e.standingPerPlayer).padStart(19)}`);
    const probing = Object.values(s.cards).some((c) => c.probe.n);
    const rows = Object.entries(s.cards).filter(([, c]) => c.held > 0 || c.probe.n > 0).sort((a, b) => (probing ? (b[1].probe.benefit ?? -99) - (a[1].probe.benefit ?? -99) : (b[1].dWinAction ?? -99) - (a[1].dWinAction ?? -99)));
    const f = (/** @type {number | null} */ x, /** @type {string} */ u = '') => (x === null ? '–' : `${u === 'pp' && x > 0 ? '+' : ''}${x}${u === '%' ? '%' : ''}`);
    console.log(`\n${'card'.padEnd(30)} | held | played | action | playable | Δwin act | Δwin infl | won after | trophies | flips | moved | ${probing ? 'probe | opener probe' : 'opener'}`);
    for (const [, c] of rows) {
      console.log(`${c.name.padEnd(30)} | ${String(c.held).padStart(4)} | ${f(c.playedPct, '%').padStart(6)} | ${f(c.actionPct, '%').padStart(6)} | ${f(c.playablePct, '%').padStart(8)} | ${f(c.dWinAction, 'pp').padStart(8)} | ${f(c.dWinInfluence, 'pp').padStart(9)} | ${f(c.winAfterAction, '%').padStart(9)} | ${f(c.perAction.trophies).padStart(8)} | ${f(c.perAction.flips).padStart(5)} | ${f(c.perAction.moved).padStart(5)} | ${probing ? `${f(c.probe.benefit, 'pp').padStart(5)} | ${f(c.probe.opening, 'pp').padStart(12)}` : String(c.opener).padStart(6)}`);
    }
  }
}

if (isMainThread) main();
else {
  const d = workerData;
  const players = d.list.map((/** @type {string} */ _, /** @type {number} */ i) => `P${i + 1}`);
  const probeCards = d.probe.cards ?? [...spec.cards, ...spec.testCards.cards].filter((c) => c.action).map((c) => c.id);
  for (const g of d.games) {
    // Rotate: in game g, seat i plays profile (i + g) mod n.
    /** @type {Record<string, string>} */
    const seats = Object.fromEntries(players.map((/** @type {string} */ pid, /** @type {number} */ i) => [pid, d.list[(i + g) % d.list.length]]));
    let s = createGame({ seed: d.seed * 10007 + g, players, options: d.options });
    const rng = seededRng(d.seed * 7 + g), side = seededRng(d.seed * 13 + g); // side: probes and playable checks, so they don't change the game
    /** @type {Record<string, import('../public/bots.js').BotMemory>} */
    const memory = Object.fromEntries(players.map((/** @type {string} */ pid) => [pid, {}]));
    /** @type {Play[]} */ const plays = [];
    /** @type {string[]} */ const held = [], unplayed = [];
    /** @type {Economy[]} */ const economy = [];
    /** @type {Probe[]} */ const probes = [];
    /** @type {Record<string, [number, number]>} */ const playable = {};
    const presence = [totalPresence(s)];
    /** @type {Record<string, string[]> | null} */
    let hands = null; // this round's hands when play began, less what was played
    let round = s.round;
    for (let n = 0; n < MAX_MOVES && s.phase !== 'ended'; n++) {
      if (s.phase === 'play' && !hands) {
        hands = Object.fromEntries(s.seating.map((pid) => [pid, s.players[pid].hand.slice()]));
        for (const h of Object.values(hands)) held.push(...h);
      }
      // The player to act: playable checks, and a probe on a share of turns.
      const actor = s.phase === 'play' && !s.pending ? s.seating[s.turn] : null;
      let moved = false;
      for (const pid of s.seating) {
        const move = botMove(s, { playerId: pid, rng, profile: /** @type {Profile} */ (seats[pid]), memory: memory[pid] });
        if (!move) continue;
        if (pid === actor) {
          for (const c of new Set(s.players[pid].hand)) {
            if (!cardById(c).action) continue;
            const t = sampleTarget(s, pid, c, side);
            const ok = !!t && validate(s, { playerId: pid, move: { type: 'play', card: c, use: 'action', target: t } }).ok;
            const p = (playable[c] ??= [0, 0]);
            p[0] += 1; if (ok) p[1] += 1;
          }
          if (d.probe.rate > 0 && side() < d.probe.rate) {
            const pick = probeCards.map((/** @type {string} */ c) => ({ c, k: side() })).sort((/** @type {{ k: number }} */ a, /** @type {{ k: number }} */ b) => a.k - b.k).slice(0, d.probe.sample).map((/** @type {{ c: string }} */ x) => x.c);
            probes.push({ r: s.round, opening: !s.opened && pid === s.first, benefit: measureState(s, pick, { playouts: d.probe.playouts, targets: d.probe.targets, bots: 'goal', seed: d.seed * 100003 + g * 101 + n }) });
          }
        }
        const prev = s;
        if (move.type === 'play') {
          const before = chance(s, pid), opener = !s.opened && pid === s.first;
          s = applyMove(s, { playerId: pid, move });
          if (s.pending && s.pending.player === pid) s = applyMove(s, { playerId: pid, move: { type: 'confirm' } });
          /** @type {Play} */
          const rec = { r: prev.round, seat: pid, card: move.card, use: move.use, dWin: Math.round((chance(s, pid) - before) * 10) / 10, opener };
          if (move.use === 'action' && s.phase === 'play') rec.fx = effectOf(prev, s, pid);
          plays.push(rec);
          if (hands) hands[pid] = hands[pid].filter((c, i, a) => c !== move.card || a.indexOf(c) !== i);
        } else s = applyMove(s, { playerId: pid, move });
        if (prev.phase === 'play' && s.phase !== 'play') {
          // The board as the fights find it (the former economy study).
          const e = { r: prev.round, fights: 0, by: [0, 0, 0, 0], influenced: 0, onBoard: 0, standing: 0 };
          for (const place of Object.values(prev.board)) {
            const who = Object.values(place.influence).filter((x) => x > 0).length;
            if (who > 0) e.influenced += 1;
            e.onBoard += Object.values(place.influence).reduce((a, b) => a + b, 0);
            if (!contestedPlace(place)) continue;
            e.fights += 1;
            e.by[Math.min(3, who)] += 1;
          }
          for (const p of prev.seating) e.standing += Object.values(prev.players[p].standing).reduce((a, b) => a + b, 0);
          economy.push(e);
          if (hands) { for (const h of Object.values(hands)) unplayed.push(...h); hands = null; }
        }
        moved = true;
        break;
      }
      if (!moved) break;
      if (s.round !== round || s.phase === 'ended') { presence.push(totalPresence(s)); round = s.round; }
    }
    const result = /** @type {NonNullable<GameState['result']>} */ (s.result);
    parentPort?.postMessage(/** @type {GameRecord} */ ({
      g, side: result.side, seats, groups: Object.fromEntries(s.seating.map((p) => [p, s.players[p].group])), winners: result.players, deck: s.deck ?? [],
      presence, scorched: Object.values(s.board).filter((p) => p.scorched).length, trophies: Object.fromEntries(s.seating.map((p) => [p, Object.values(s.players[p].trophies).reduce((a, b) => a + b, 0)])),
      economy, plays, held, unplayed, playable, probes,
    }));
  }
}
