// @ts-check
/**
 * The tuning tournament (designer, 2026-10-08: one script for tuning; the
 * simulate, economy, balance and roundplay scripts are merged in). Whole games
 * with a bot profile in each seat, rotated so every profile sits in every seat
 * equally. Per game it records:
 * - the game: its ending and winners, wins by seat, profile and slayer group,
 *   total presence after each round, scorched locations, trophies per player;
 * - the economy at the end of each round's play, before the fights: fights,
 *   and how many players have sway at each (bidding contests),
 *   locations with sway, sway on the board and standing held;
 * - every card play: what it was played for (its action or its sway),
 *   whether it opened the round, the swing in its player's chance of winning
 *   (winChances, the bots' estimate, percentage points), and for actions what
 *   the play did to this round's fights (trophies changing hands, fights
 *   whose winner flips weighted by the tokens lost there), control taken
 *   (contested locations where its player became sole top sway), pieces
 *   moved or placed, sway placed, and presence after the reckoning;
 * - calibration: at the start of each round's play, each seat's predicted
 *   chance of winning (the bots' own estimate), against who did win: how
 *   far the bots' judgement can be trusted;
 * - per card in hand, each turn its player acts, whether it had a legal target
 *   (playable);
 * - probes: on a share of turns (probe=0.05), the controlled card test
 *   (scripts/lib.js measureState): a random probeSample= of the cards (or of
 *   probeCards=), each played in that moment against letting the turn go, the
 *   rest of the round played out. It covers cards nobody held, and gives cause
 *   where whole games give correlation. probeOpen=1 also probes every round's
 *   first play (for the marked cards, which open rounds). probeLite=1: the
 *   probes' imagined futures are played by the same bots with the play-out
 *   search (sim) off, which would otherwise nest play-outs inside play-outs.
 * - vanished fights (designer, 2026-10-13: a fight disappearing, not being
 *   outbid, is what undoes a player's progress): each round, every fight
 *   (a location contested by a pair of factions) a play makes, and every
 *   fight a play makes disappear, with who had a stake in it (sway
 *   there), who made it and with which card, and how far into
 *   the round it went; how many fights made in play are still there when the
 *   fights come. reach=rate also asks, on that share of turns, every card
 *   with an action whether it could make a fight others hold a stake in
 *   disappear there and then (its listed targets, up to reachTargets=40).
 *
 *   node scripts/tournament.js [games=50] [seed=1] [profiles=backer,backer,trophy,trophy,trophy]
 *     [log=games.jsonl] [out=summary.json] [probe=0] [probeOpen=0] [probeSample=6] [probeCards=id,id] [probePlayouts=2] [probeTargets=2] [probeLite=0] [reach=0] [reachTargets=40] [workers=cores] [duplicate=0] [option=value ...]
 *
 * - log= appends one line per finished game; a run with the same log resumes,
 *   skipping games already in it. out= is rewritten after every game with the
 *   summary so far (public/card-play-stats.json is what the card review page
 *   reads). Runs across every core.
 * - One seat per profile, so the profile count is the player count (3 to 5).
 *   The standard tuning table (designer, 2026-10-08: both halves of the game)
 *   seats two faction backers and three goal trophy chasers (hunter removed 2026-10-09), so the
 *   invaders' ending comes about 40% of the time. Card figures are also split
 *   by the profile that played them.
 *   Profiles take persona overrides: trophy:lean=0,hold=0.1; separate
 *   profiles with semicolons when overrides use commas.
 * A measuring tool, not a rule; bot figures are a guide (Appendix F.9).
 */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createGame, applyMove, cardById, spec, totalPresence, presenceOf, resolveFight, growthDue, sampleTarget, listTargets, clone, validate, fightsDue } from '../public/rules.js';
import { PROFILES, botMove, fast, features } from '../public/rules.js';
import { seededRng, chance, measureState, play, MAX_MOVES } from './lib.js';

/** @typedef {import('../public/rules.js').Profile} Profile @typedef {import('../public/rules.js').GameState} GameState */
/** @typedef {{ trophies: number, flips: number, control: number, moved: number, placed: number, presence: number, made?: number, big?: number }} Effect */
/** @typedef {{ r: number, seat: string, card: string, use: 'action' | 'sway' | 'return', dWin: number, opener: boolean, fx?: Effect }} Play */
/** @typedef {{ r: number, fights: number, by: number[], swayd: number, onBoard: number, standing: number }} Economy */
/** @typedef {{ r: number, opening: boolean, profile: string, benefit: Record<string, number | null>, used?: Record<string, boolean> }} Probe  benefit: the card's worth in hand; used: whether the bot chose to use it */
/** @typedef {{ at: number, card: string, seat: string, loc: string, stake: string[], maker: string, makerCard: string, moved: boolean, size?: number, big?: boolean }} Vanish */
/** @typedef {{ r: number, plays: number, start: number, made: number, kept: number, lost: Vanish[], bigMade?: number, bigKept?: number }} FightRound */
/** @typedef {{ r: number, staked: number, cards: Record<string, [number, number]> }} Reach */
/**
 * @typedef {{ g: number, side: 'island' | 'invaders', seats: Record<string, string>, groups: Record<string, string>, winners: string[], placings: string[], deck: string[],
 *   presence: number[], scorched: number, trophies: Record<string, number>, trophiesByColour?: Record<string, Record<string, number>>, scores?: Record<string, number>, goals?: Record<string, string>[], wonBy?: string[], standing?: Record<string, Record<string, number>>, presenceBy?: Record<string, number>, economy: Economy[], plays: Play[], held: string[], unplayed: string[],
 *   playable: Record<string, [number, number]>, probes: Probe[], fightRounds?: FightRound[], reach?: Reach[], forecasts: { r: number, seat: string, p: number, f?: Record<string, number> }[] }} GameRecord
 */

// ---------------------------------------------------------------------------
// What a play did (the measures of the former balance study, on the actual play)
// ---------------------------------------------------------------------------

/** @param {GameState['board'][string]} place */
const contestedPlace = (place) => !place.scorched && Object.values(place.tokens).filter((n) => n > 0).length >= 2;

/** This round's fights and growth on a copy: presence after, trophies per player, each fight's winner and losses. @param {GameState} state */
function reckon(state) {
  let s = state;
  /** @type {Record<string, { winner: string, lost: number }>} */
  const fights = {};
  for (const loc of fightsDue(state)) { // a Gate's two ends fight once, as one (the engine's fightsDue)
    if (!fightsDue(s).includes(loc)) continue;
    const place = s.board[loc];
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

/** The sole top-sway player at a location, or null. @param {GameState['board'][string]} place */
function topOf(place) {
  const e = Object.entries(place.sway).filter(([, n]) => n > 0).sort((x, y) => y[1] - x[1]);
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
    placed += Math.max(0, (p1.sway[pid] ?? 0) - (p0.sway[pid] ?? 0));
  }
  // The largest fight the play made or grew (both groups' tokens), and whether it is big (BIG_FIGHT or more): a big
  // fight made in a single move is as lazy as one undone (designer, 2026-10-13).
  let made = 0;
  for (const [loc, pair] of fightsOn(now)) {
    const before = sameFight(fightsOn(was).get(loc), pair) ? fightSize(was, loc, pair) : 0;
    if (fightSize(now, loc, pair) > before) made = Math.max(made, fightSize(now, loc, pair));
  }
  return { trophies, flips, control, moved, placed, presence: b.presence - a.presence, made, big: made >= BIG_FIGHT ? 1 : 0 };
}

/** A big fight, in tokens (both groups together): a measuring line, not a rule. */
const BIG_FIGHT = 6;

// ---------------------------------------------------------------------------
// Vanished fights (a play that makes a fight disappear)
// ---------------------------------------------------------------------------

/** Each fight on the board, as location → the pair of factions, sorted. @param {GameState} s */
function fightsOn(s) {
  /** @type {Map<string, string>} */
  const out = new Map();
  for (const loc of fightsDue(s)) out.set(loc, Object.keys(unionTokens(s, loc)).sort().join('+')); // a Gate's ends: one fight, listed at both
  return out;
}

/** A location's tokens, with its Gate partner's while a Gate joins them. @param {GameState} s @param {string} loc @returns {Record<string, number>} */
function unionTokens(s, loc) {
  /** @type {Record<string, number>} */ const out = {};
  for (const l of [loc, s.board[loc].gate].filter(Boolean)) for (const [f, n] of Object.entries(s.board[/** @type {string} */ (l)].tokens)) if (n > 0) out[f] = (out[f] ?? 0) + n;
  return out;
}

/**
 * Whether the fight `now` at a location is the one that was there: every faction that fought there still does (a third
 * side joining, as the ☾ signature Wake the Dead's risen Undead do, keeps the fight; it doesn't make it disappear).
 * @param {string | undefined} was @param {string | undefined} now
 */
const sameFight = (was, now) => !!was && !!now && was.split('+').every((f) => now.split('+').includes(f));

/** A fight's size: both groups' tokens together. @param {GameState} s @param {string} loc @param {string} pair */
const fightSize = (s, loc, pair) => { const t = unionTokens(s, loc); return pair.split('+').reduce((n, f) => n + (t[f] ?? 0), 0); };

/** The players with a stake in a location's fight: sway there. @param {GameState['board'][string]} place */
const stakeOf = (place) => Object.entries(place.sway).filter(([, n]) => n > 0).map(([p]) => p);

/** What one play did to the fights: those that disappeared (with their stakes; moved: the same pair now fights at a new location) and those it made. @param {GameState} was @param {GameState} now */
function fightChange(was, now) {
  const a = fightsOn(was), b = fightsOn(now);
  const made = [...b].filter(([loc, pair]) => !sameFight(a.get(loc), pair)).map(([loc]) => loc);
  const pairsMade = new Set(made.map((loc) => b.get(loc)));
  const gone = [...a].filter(([loc, pair]) => !sameFight(pair, b.get(loc))).map(([loc, pair]) => ({ loc, stake: stakeOf(was.board[loc]), moved: pairsMade.has(pair) }));
  return { gone, made };
}

/**
 * Could each card make a fight that others hold a stake in disappear, played now by the player to act? Per card:
 * [could, the most such fights one play makes disappear]; absent: no legal target. A measuring device, not a move.
 * @param {GameState} state @param {string[]} cardIds @param {number} cap
 */
function reachOf(state, cardIds, cap) {
  const pid = state.seating[state.turn];
  const theirs = (/** @type {GameState} */ s, /** @type {string} */ loc) => stakeOf(s.board[loc]).some((p) => p !== pid);
  /** @type {Record<string, [number, number]>} */
  const out = {};
  for (const id of cardIds) {
    const s = clone(state);
    s.opened = true;
    s.players[pid].hand.push(id);
    const { targets } = listTargets(s, pid, id, cap);
    let best = -1;
    for (const target of targets) {
      const move = /** @type {import('../public/rules.js').Move} */ ({ type: 'play', card: id, use: 'action', target });
      if (!validate(s, { playerId: pid, move }).ok) continue;
      const n = fightChange(s, play(s, pid, move)).gone.filter((g) => !g.moved && theirs(s, g.loc)).length;
      best = Math.max(best, n);
    }
    if (best >= 0) out[id] = [best > 0 ? 1 : 0, best];
  }
  return out;
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
  /** @type {Record<number, { n: number, p: number, won: number }[]>} predicted chance in tenths, by round */
  const calib = {};
  /** @type {Record<string, number>} */ const groupWins = {};
  /** @type {number[][]} */ const presence = [];
  let scorched = 0, trophySum = 0, trophyN = 0, shared = 0;
  /** @type {Record<number, Economy & { rounds: number }>} */
  const economy = {};
  /** @typedef {{ dealt: number, held: number, unplayed: number, action: number, sway: number, opener: number, dAction: number, dSway: number, winAction: number, winSway: number, endsIsland: number, fx: Effect, turns: number, playable: number, probes: number[], usedProbes: number[], openingProbes: number[], probeNull: number, byProfile: Record<string, { probes: number[], dWin: number, plays: number }> }} Acc */
  /** @type {Record<string, Acc>} */
  const cards = {};
  const acc = (/** @type {string} */ id) => (cards[id] ??= { dealt: 0, held: 0, unplayed: 0, action: 0, sway: 0, opener: 0, dAction: 0, dSway: 0, winAction: 0, winSway: 0, endsIsland: 0, fx: { trophies: 0, flips: 0, control: 0, moved: 0, placed: 0, presence: 0, made: 0, big: 0 }, turns: 0, playable: 0, probes: [], usedProbes: [], openingProbes: [], probeNull: 0, byProfile: {} });
  const vanish = { rounds: 0, plays: 0, start: 0, made: 0, kept: 0, gone: 0, staked: 0, moved: 0, byQuarter: [0, 0, 0, 0], own: 0, bigRounds: 0, bigMade: 0, bigKept: 0, bigUndone: 0, bigUndoneStaked: 0 };
  /** @type {Record<string, { actions: number, gone: number, staked: number, moved: number, plays: number, reachN: number, reach: number, reachMax: number, bigUndone: number }>} */
  const undo = {};
  const un = (/** @type {string} */ id) => (undo[id] ??= { actions: 0, gone: 0, staked: 0, moved: 0, plays: 0, reachN: 0, reach: 0, reachMax: 0, bigUndone: 0 });
  /** @type {Record<string, number>} maker card → card that made it disappear */
  const pairs = {};
  for (const r of records) {
    for (const fr of r.fightRounds ?? []) {
      vanish.rounds += 1; vanish.plays += fr.plays; vanish.start += fr.start; vanish.made += fr.made; vanish.kept += fr.kept;
      if (fr.bigMade !== undefined) { vanish.bigRounds += 1; vanish.bigMade += fr.bigMade; vanish.bigKept += fr.bigKept ?? 0; }
      for (const v of fr.lost) {
        if (v.moved) { vanish.moved += 1; un(v.card).moved += 1; continue; }
        if (v.big) { vanish.bigUndone += 1; un(v.card).bigUndone += 1; if (v.stake.some((p) => p !== v.seat)) vanish.bigUndoneStaked += 1; }
        vanish.gone += 1; un(v.card).gone += 1;
        if (!v.stake.some((p) => p !== v.seat)) continue; // no one else's stake: nobody's progress undone
        vanish.staked += 1; un(v.card).staked += 1;
        vanish.byQuarter[Math.min(3, Math.floor((4 * v.at) / Math.max(1, fr.plays)))] += 1;
        if (v.maker === v.seat) vanish.own += 1;
        if (v.makerCard) pairs[`${v.makerCard} → ${v.card}`] = (pairs[`${v.makerCard} → ${v.card}`] ?? 0) + 1;
      }
    }
    for (const p of r.plays) if (p.use === 'action' && r.fightRounds) un(p.card).actions += 1;
    for (const x of r.reach ?? []) for (const [id, [could, most]] of Object.entries(x.cards)) { const u = un(id); u.reachN += 1; u.reach += could; u.reachMax = Math.max(u.reachMax, most); }
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
    for (const fc of r.forecasts ?? []) {
      const bin = ((calib[fc.r] ??= Array.from({ length: 10 }, () => ({ n: 0, p: 0, won: 0 }))))[Math.min(9, Math.floor(fc.p / 10))];
      bin.n += 1; bin.p += fc.p; bin.won += r.winners.includes(fc.seat) ? 100 / r.winners.length : 0;
    }
    scorched += r.scorched;
    for (const t of Object.values(r.trophies)) { trophySum += t; trophyN += 1; }
    for (const e of r.economy) {
      const x = (economy[e.r] ??= { r: e.r, rounds: 0, fights: 0, by: [0, 0, 0, 0], swayd: 0, onBoard: 0, standing: 0 });
      x.rounds += 1; x.fights += e.fights; e.by.forEach((v, i) => (x.by[i] += v)); x.swayd += e.swayd; x.onBoard += e.onBoard; x.standing += e.standing;
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
        if (p.fx) for (const k of /** @type {(keyof Effect)[]} */ (Object.keys(a.fx))) a.fx[k] = (a.fx[k] ?? 0) + (p.fx[k] ?? 0);
      } else { a.sway += 1; a.dSway += p.dWin; a.winSway += won; }
      if (p.opener) a.opener += 1;
      if (p.use === 'action') { const bp = (a.byProfile[r.seats[p.seat]] ??= { probes: [], dWin: 0, plays: 0 }); bp.dWin += p.dWin; bp.plays += 1; }
    }
    for (const pr of r.probes) for (const [id, v] of Object.entries(pr.benefit)) {
      if (v === null) { acc(id).probeNull += 1; continue; }
      acc(id).probes.push(v);
      if (pr.used?.[id]) acc(id).usedProbes.push(v); // the moments the bot chose to use it
      if (pr.opening) acc(id).openingProbes.push(v);
      if (pr.profile) (acc(id).byProfile[pr.profile] ??= { probes: [], dWin: 0, plays: 0 }).probes.push(v);
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
    calibration: Object.fromEntries(Object.entries(calib).map(([round, bins]) => [round, bins.filter((b) => b.n).map((b) => ({ predicted: r1(b.p / b.n), won: r1(b.won / b.n), n: b.n }))])),
    economy: Object.values(economy).map((e) => ({
      round: e.r, fights: avg(e.fights, e.rounds), contests: e.by.map((v) => pct(v, e.fights)), locationsWithSway: avg(e.swayd, e.rounds),
      onBoardPerPlayer: avg(e.onBoard, e.rounds * players), standingPerPlayer: avg(e.standing, e.rounds * players),
    })),
    fights: {
      rounds: vanish.rounds, playsPerRound: avg(vanish.plays, vanish.rounds), atStartPerRound: avg(vanish.start, vanish.rounds), madePerRound: avg(vanish.made, vanish.rounds),
      madeKeptPct: pct(vanish.kept, vanish.made), vanishedPerRound: avg(vanish.gone, vanish.rounds), stakedVanishedPerRound: avg(vanish.staked, vanish.rounds), movedPerRound: avg(vanish.moved, vanish.rounds),
      stakedByQuarter: vanish.byQuarter.map((q) => pct(q, vanish.staked)), stakedOwnMadePct: pct(vanish.own, vanish.staked),
      bigFight: BIG_FIGHT, bigMadePerRound: avg(vanish.bigMade, vanish.bigRounds), bigUndonePct: pct(vanish.bigUndone, vanish.bigMade), bigUndoneStakedPct: pct(vanish.bigUndoneStaked, vanish.bigMade), bigKeptPct: pct(vanish.bigKept, vanish.bigMade),
      pairs: Object.entries(pairs).sort((a, b) => b[1] - a[1]).slice(0, 15),
      byCard: Object.fromEntries(Object.entries(undo).map(([id, u]) => [id, { name: cardById(id).name, actions: u.actions, stakedPerAction: avg(u.staked, u.actions), vanished: u.gone, moved: u.moved, reachN: u.reachN, reachPct: pct(u.reach, u.reachN), reachMax: u.reachMax, bigUndone: u.bigUndone }])),
    },
    cards: Object.fromEntries(Object.entries(cards).map(([id, a]) => [id, {
      name: cardById(id).name, dealt: a.dealt, held: a.held, action: a.action, sway: a.sway, unplayed: a.unplayed, opener: a.opener,
      playedPct: pct(a.action + a.sway, a.held), actionPct: pct(a.action, a.action + a.sway), playablePct: pct(a.playable, a.turns),
      dWinAction: avg(a.dAction, a.action), dWinSway: avg(a.dSway, a.sway),
      winAfterAction: pct(a.winAction, a.action), winAfterSway: pct(a.winSway, a.sway), islandAfterAction: pct(a.endsIsland, a.action),
      perAction: Object.fromEntries(Object.entries(a.fx).map(([k, v]) => [k, avg(v, a.action)])),
      probe: { n: a.probes.length, benefit: mean(a.probes), up: pct(a.probes.filter((v) => v > 0).length, a.probes.length), usedPct: pct(a.usedProbes.length, a.probes.length), whenUsed: mean(a.usedProbes), opening: mean(a.openingProbes), openingN: a.openingProbes.length, noTarget: a.probeNull },
      byProfile: Object.fromEntries(Object.entries(a.byProfile).map(([p, b]) => [p, { probe: mean(b.probes), probes: b.probes.length, dWinAction: avg(b.dWin, b.plays), actions: b.plays }])),
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
  const list = (pairs.profiles ?? 'backer,backer,trophy,trophy,trophy').split(pairs.profiles?.includes(';') ? ';' : ',');
  const duplicate = pairs.duplicate === '1';
  const logFile = pairs.log, outFile = pairs.out, workerCap = Number(pairs.workers ?? 0);
  const probe = { rate: Number(pairs.probe ?? 0), open: pairs.probeOpen === '1', sample: Number(pairs.probeSample ?? 6), cards: pairs.probeCards?.split(','), playouts: Number(pairs.probePlayouts ?? 2), targets: Number(pairs.probeTargets ?? 2), lite: pairs.probeLite === '1' };
  const reach = { rate: Number(pairs.reach ?? 0), targets: Number(pairs.reachTargets ?? 40) };
  for (const k of ['profiles', 'duplicate', 'log', 'out', 'probe', 'probeOpen', 'probeSample', 'probeCards', 'probePlayouts', 'probeTargets', 'probeLite', 'reach', 'reachTargets', 'workers']) delete pairs[k];
  for (const p of list) if (!PROFILES.includes(/** @type {Profile} */ (p.split(':')[0]))) throw new Error(`unknown bot profile ${p}; try ${PROFILES.join(', ')} (goal profiles take overrides: goal:lean=0)`);
  const games = Number(gamesArg), seed = Number(seedArg);
  /** @type {GameRecord[]} */
  const records = logFile && existsSync(logFile) ? readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const done = new Set(records.map((r) => r.g));
  const todo = Array.from({ length: games }, (_, g) => g).filter((g) => !done.has(g));
  if (records.length) process.stderr.write(`resuming: ${records.length} games already in ${logFile}\n`);
  const write = () => { if (outFile) writeFileSync(outFile, `${JSON.stringify(summarise(records, list, pairs), null, 2)}\n`); };
  if (!todo.length) { write(); report(); return; }
  const workers = Math.min(workerCap || availableParallelism(), todo.length); // workers=N: fewer, so several small runs can share the cores
  let running = workers;
  const t0 = Date.now();
  for (let w = 0; w < workers; w++) {
    const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { games: todo.filter((_, i) => i % workers === w), seed, list, options: pairs, probe, reach, duplicate } });
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
    console.log(`Calibration (predicted chance of winning → how often it happened, by round): ${Object.entries(s.calibration).map(([round, bins]) => `r${round} ${bins.map((b) => `${b.predicted}→${b.won}`).join(' ')}`).join(' | ')}`);
    console.log(`Wins by seat: ${Object.entries(s.bySeat).map(([k, v]) => `${k} ${v}%`).join(' · ')}`);
    console.log(`Wins by slayer group: ${Object.entries(s.byGroup).map(([k, v]) => `${k} ${v}%`).join(' · ')}`);
    console.log('\nround | fights | by players with sway there: 0 / 1 / 2 / 3+ | locations with sway | sway on board per player | standing per player');
    for (const e of s.economy) console.log(`${String(e.round).padStart(5)} | ${String(e.fights).padStart(6)} | ${e.contests.map((x) => `${x}%`).join(' / ').padEnd(47)} | ${String(e.locationsWithSway).padStart(24)} | ${String(e.onBoardPerPlayer).padStart(29)} | ${String(e.standingPerPlayer).padStart(19)}`);
    const fx = s.fights;
    if (fx.rounds) {
      console.log(`\nFights per round: ${fx.atStartPerRound} at the start of play, ${fx.madePerRound} made by plays (${fx.madeKeptPct}% of those still there when the fights come). Plays per round ${fx.playsPerRound}.`);
      console.log(`Made to disappear per round: ${fx.vanishedPerRound}, of them ${fx.stakedVanishedPerRound} with another player's stake (${fx.stakedOwnMadePct}% of those the remover had made); moved whole to a new location ${fx.movedPerRound}.`);
      if (fx.bigMadePerRound !== null) console.log(`Big fights (${fx.bigFight}+ tokens) a play made or grew to big: ${fx.bigMadePerRound} per round; ${fx.bigUndonePct}% made to disappear later that round (${fx.bigUndoneStakedPct}% with another player's stake), ${fx.bigKeptPct}% still there when the fights come.`);
      console.log(`Staked fights made to disappear, by quarter of the round's plays: ${fx.stakedByQuarter.map((q) => `${q}%`).join(' / ')}`);
      console.log(`Most frequent (card that made the fight → card that made it disappear): ${fx.pairs.map(([k, v]) => `${k} ${v}`).join(' · ')}`);
      console.log(`\n${'card'.padEnd(34)} | actions | staked gone / action | gone | moved | could (reach) | most at once | fight made (tokens) | big made | big undone`);
      for (const [id, u] of Object.entries(fx.byCard).sort((a, b) => (b[1].stakedPerAction ?? -1) - (a[1].stakedPerAction ?? -1) || (b[1].reachPct ?? -1) - (a[1].reachPct ?? -1))) {
        if (!u.actions && !u.reachN) continue;
        console.log(`${u.name.padEnd(34)} | ${String(u.actions).padStart(7)} | ${String(u.stakedPerAction ?? '–').padStart(20)} | ${String(u.vanished).padStart(4)} | ${String(u.moved).padStart(5)} | ${(u.reachPct === null ? '–' : `${u.reachPct}% of ${u.reachN}`).padStart(13)} | ${String(u.reachN ? u.reachMax : '–').padStart(12)} | ${String(s.cards[id]?.perAction.made ?? '–').padStart(19)} | ${(s.cards[id]?.perAction.big === undefined || s.cards[id]?.perAction.big === null ? '–' : `${Math.round(100 * (s.cards[id]?.perAction.big ?? 0))}%`).padStart(8)} | ${String(u.bigUndone).padStart(10)}`);
      }
    }
    const probing = Object.values(s.cards).some((c) => c.probe.n);
    const rows = Object.entries(s.cards).filter(([, c]) => c.held > 0 || c.probe.n > 0).sort((a, b) => (probing ? (b[1].probe.benefit ?? -99) - (a[1].probe.benefit ?? -99) : (b[1].dWinAction ?? -99) - (a[1].dWinAction ?? -99)));
    const f = (/** @type {number | null} */ x, /** @type {string} */ u = '') => (x === null ? '–' : `${u === 'pp' && x > 0 ? '+' : ''}${x}${u === '%' ? '%' : ''}`);
    console.log(`\n${'card'.padEnd(30)} | held | played | action | playable | Δwin act | Δwin infl | won after | trophies | flips | moved | ${probing ? 'probe | opener probe | probe by profile' : 'opener'}`);
    for (const [, c] of rows) {
      console.log(`${c.name.padEnd(30)} | ${String(c.held).padStart(4)} | ${f(c.playedPct, '%').padStart(6)} | ${f(c.actionPct, '%').padStart(6)} | ${f(c.playablePct, '%').padStart(8)} | ${f(c.dWinAction, 'pp').padStart(8)} | ${f(c.dWinSway, 'pp').padStart(9)} | ${f(c.winAfterAction, '%').padStart(9)} | ${f(c.perAction.trophies).padStart(8)} | ${f(c.perAction.flips).padStart(5)} | ${f(c.perAction.moved).padStart(5)} | ${probing ? `${f(c.probe.benefit, 'pp').padStart(5)} | ${f(c.probe.opening, 'pp').padStart(12)} | ${Object.entries(c.byProfile).filter(([, b]) => b.probes).map(([p, b]) => `${p} ${f(b.probe, 'pp')}`).join(', ')}` : String(c.opener).padStart(6)}`);
    }
  }
}

if (isMainThread) main();
else {
  const d = workerData;
  const players = d.list.map((/** @type {string} */ _, /** @type {number} */ i) => `P${i + 1}`);
  const probeCards = d.probe.cards ?? spec.cards.filter((c) => c.action).map((c) => c.id);
  for (const g of d.games) {
    // Rotate: in game g, seat i plays profile (i + g) mod n.
    /** @type {Record<string, string>} */
    const seats = Object.fromEntries(players.map((/** @type {string} */ pid, /** @type {number} */ i) => [pid, d.list[(i + g) % d.list.length]]));
    // duplicate=1: games come in blocks of one deal per profile count, the same deal with the profiles rotated through
    // every seat, and each seat's bot draws from its own stream seeded by the deal: two tables run on the same seed meet
    // the same deals with the same luck, so they can be compared deal by deal (scripts/pair.mjs).
    const deal = d.duplicate ? Math.floor(g / d.list.length) : g;
    let s = createGame({ seed: d.seed * 10007 + deal, players, options: d.options });
    const own = Object.fromEntries(players.map((/** @type {string} */ pid, /** @type {number} */ i) => [pid, seededRng(d.seed * 7919 + deal * 31 + i)]));
    const shared = seededRng(d.seed * 7 + g), side = seededRng(d.seed * 13 + g); // side: probes and playable checks, so they don't change the game
    const rngOf = (/** @type {string} */ pid) => (d.duplicate ? own[pid] : shared);
    /** @type {Record<string, import('../public/rules.js').BotMemory>} */
    const memory = Object.fromEntries(players.map((/** @type {string} */ pid) => [pid, {}]));
    /** @type {Play[]} */ const plays = [];
    /** @type {string[]} */ const held = [], unplayed = [];
    /** @type {Economy[]} */ const economy = [];
    /** @type {Probe[]} */ const probes = [];
    /** @type {{ r: number, seat: string, p: number, f: Record<string, number> }[]} */ const forecasts = [];
    /** @type {Record<string, [number, number]>} */ const playable = {};
    /** @type {FightRound[]} */ const fightRounds = [];
    /** @type {Reach[]} */ const reach = [];
    /** @type {FightRound | null} */ let fr = null;
    /** @type {Map<string, { maker: string, card: string, big: boolean }>} this round's fights, by location: who made each (none: there when play began), and whether a play made it big */
    const makers = new Map();
    const presence = [totalPresence(s)];
    /** @type {Record<string, string>[]} each round's end: the plan each seat holds (goal bots: island or invaders) */ const goals = [];
    /** @type {Record<string, string[]> | null} */
    let hands = null; // this round's hands when play began, less what was played
    let round = s.round;
    for (let n = 0; n < MAX_MOVES && s.phase !== 'ended'; n++) {
      if (s.phase === 'play' && !hands) {
        hands = Object.fromEntries(s.seating.map((pid) => [pid, s.players[pid].hand.slice()]));
        for (const pid of s.seating) forecasts.push({ r: s.round, seat: pid, p: Math.round(chance(s, pid) * 10) / 10, f: features(s, pid) });
        for (const h of Object.values(hands)) held.push(...h);
        fr = { r: s.round, plays: 0, start: fightsOn(s).size, made: 0, kept: 0, lost: [], bigMade: 0, bigKept: 0 };
        makers.clear();
        for (const loc of fightsOn(s).keys()) makers.set(loc, { maker: '', card: '', big: false });
      }
      // The player to act: playable checks, and a probe on a share of turns.
      const actor = s.phase === 'play' ? s.seating[s.turn] : null;
      let moved = false;
      for (const pid of s.seating) {
        const move = botMove(s, { playerId: pid, rng: rngOf(pid), profile: /** @type {Profile} */ (seats[pid]), memory: memory[pid], table: seats, memories: memory });
        if (!move) continue;
        if (pid === actor) {
          for (const c of new Set(s.players[pid].hand)) {
            if (!cardById(c).action) continue;
            const t = sampleTarget(s, pid, c, side);
            const ok = !!t && validate(s, { playerId: pid, move: { type: 'play', card: c, use: 'action', target: t } }).ok;
            const p = (playable[c] ??= [0, 0]);
            p[0] += 1; if (ok) p[1] += 1;
          }
          const opening = !s.opened && pid === s.first;
          if ((d.probe.open && opening) || (d.probe.rate > 0 && side() < d.probe.rate)) { // probeOpen=1: every round's first play too (the marked cards' moment)
            const pick = probeCards.map((/** @type {string} */ c) => ({ c, k: side() })).sort((/** @type {{ k: number }} */ a, /** @type {{ k: number }} */ b) => a.k - b.k).slice(0, d.probe.sample).map((/** @type {{ c: string }} */ x) => x.c);
            probes.push({ r: s.round, opening: !s.opened && pid === s.first, profile: seats[pid], ...measureState(s, pick, { playouts: d.probe.playouts, bots: d.probe.lite ? Object.fromEntries(Object.entries(seats).map(([k, v]) => [k, fast(String(v))])) : seats, memories: memory, seed: d.seed * 100003 + g * 101 + n }) });
          }
          if (d.reach.rate > 0 && side() < d.reach.rate) { // reach=rate: what every card could do to the fights here (only where others hold a stake in one)
            const staked = [...fightsOn(s).keys()].filter((loc) => stakeOf(s.board[loc]).some((p) => p !== pid)).length;
            if (staked) reach.push({ r: s.round, staked, cards: reachOf(s, probeCards, d.reach.targets) });
          }
        }
        const prev = s;
        if (move.type === 'play') {
          const before = chance(s, pid), opener = !s.opened && pid === s.first;
          s = applyMove(s, { playerId: pid, move });
          /** @type {Play} */
          const rec = { r: prev.round, seat: pid, card: move.card, use: move.use, dWin: Math.round((chance(s, pid) - before) * 10) / 10, opener };
          if (move.use === 'action' && s.phase === 'play') rec.fx = effectOf(prev, s, pid);
          plays.push(rec);
          if (fr && s.phase === 'play') {
            const { gone, made } = fightChange(prev, s);
            const was = fightsOn(prev);
            for (const v of gone) {
              const m = makers.get(v.loc);
              fr.lost.push({ at: fr.plays, card: move.card, seat: pid, loc: v.loc, stake: v.stake, maker: m?.maker ?? '', makerCard: m?.card ?? '', moved: v.moved, size: fightSize(prev, v.loc, /** @type {string} */ (was.get(v.loc))), big: !!m?.big });
              makers.delete(v.loc);
            }
            for (const loc of made) { makers.set(loc, { maker: pid, card: move.card, big: false }); fr.made += 1; }
            // A fight this play made big (BIG_FIGHT or more, from below it): made, or grown.
            for (const [loc, pair] of fightsOn(s)) {
              const m = makers.get(loc);
              if (!m || m.big || fightSize(s, loc, pair) < BIG_FIGHT) continue;
              if (!made.includes(loc) && fightSize(prev, loc, pair) >= BIG_FIGHT) continue;
              m.big = true; fr.bigMade = (fr.bigMade ?? 0) + 1;
            }
            fr.plays += 1;
          }
          if (hands) hands[pid] = hands[pid].filter((c, i, a) => c !== move.card || a.indexOf(c) !== i);
        } else s = applyMove(s, { playerId: pid, move });
        if (prev.phase === 'play' && s.phase !== 'play') {
          // The board as the fights find it (the former economy study).
          const e = { r: prev.round, fights: 0, by: [0, 0, 0, 0], swayd: 0, onBoard: 0, standing: 0 };
          for (const place of Object.values(prev.board)) {
            const who = Object.values(place.sway).filter((x) => x > 0).length;
            if (who > 0) e.swayd += 1;
            e.onBoard += Object.values(place.sway).reduce((a, b) => a + b, 0);
            if (!contestedPlace(place)) continue;
            e.fights += 1;
            e.by[Math.min(3, who)] += 1;
          }
          for (const p of prev.seating) e.standing += Object.values(prev.players[p].standing).reduce((a, b) => a + b, 0);
          economy.push(e);
          if (fr) { fr.kept = [...makers.values()].filter((m) => m.maker).length; fr.bigKept = [...makers.values()].filter((m) => m.big).length; fightRounds.push(fr); fr = null; }
          if (hands) { for (const h of Object.values(hands)) unplayed.push(...h); hands = null; }
        }
        moved = true;
        break;
      }
      if (!moved) break;
      if (s.round !== round || s.phase === 'ended') { presence.push(totalPresence(s)); goals.push(Object.fromEntries(players.map((/** @type {string} */ p) => [p, memory[p].goal ?? '-']))); round = s.round; }
    }
    const result = /** @type {NonNullable<GameState['result']>} */ (s.result);
    parentPort?.postMessage(/** @type {GameRecord} */ ({
      g, side: result.side, seats, groups: Object.fromEntries(s.seating.map((p) => [p, s.players[p].group])), winners: result.players, placings: result.placings ?? [], deck: spec.cards.map((c) => c.id),
      presence, scorched: Object.values(s.board).filter((p) => p.scorched).length, trophies: Object.fromEntries(s.seating.map((p) => [p, Object.values(s.players[p].trophies).reduce((a, b) => a + b, 0)])),
      trophiesByColour: Object.fromEntries(s.seating.map((p) => [p, { ...s.players[p].trophies }])), scores: s.result?.scores ?? {}, goals, wonBy: s.result?.factions ?? [], standing: Object.fromEntries(s.seating.map((p) => [p, { ...s.players[p].standing }])), presenceBy: Object.fromEntries(s.factions.map((f) => [f, presenceOf(s, f)])),
      economy, plays, held, unplayed, playable, probes, fightRounds, reach, forecasts,
    }));
  }
}
