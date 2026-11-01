// @ts-nocheck
/**
 * The game report: how a set of bot games measures up against the designer's preferences (design document 1.2–1.4,
 * 1.7, RV1 and 3.15), one row per measure, with a flag where it misses a provisional target.
 *
 * Reads the native runner's logs (`motw tournament ... log=X.jsonl`), so it sees each round's presence by faction
 * before and after its fights, every seat's state, every play's effect, the votes and the scores.
 *
 *   node scripts/game-report.js X.jsonl                       one set of games
 *   node scripts/game-report.js base=A.jsonl,B.jsonl test=C.jsonl   labelled sets side by side (a change's flags)
 *   bar=20                                                     the presence bar, if not the spec's default
 *
 * Targets are provisional working numbers, not design decisions: edit TARGETS below as the designer settles them.
 * A target is [low, high]; a value outside it is flagged ✗ (✓ inside; · no target). Bots are the players, so
 * these measure how bots play the rules, not how people will feel about them.
 */
import { readFileSync } from 'node:fs';

const spec = JSON.parse(readFileSync(new URL('../public/spec.json', import.meta.url), 'utf8'));
const args = process.argv.slice(2);
const opts = Object.fromEntries(args.filter((a) => /^(bar)=/.test(a)).map((a) => a.split('=')));
const defaultBar = Number(opts.bar ?? spec.variants.find((v) => v.id === 'threshold')?.default ?? 20);
const groups = args.filter((a) => !/^(bar)=/.test(a)).map((a, i) => {
  const [label, list] = a.includes('=') ? a.split('=') : [`set ${i + 1}`, a];
  const games = list.split(',').flatMap((f) => readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));
  return { label, games };
});
if (!groups.length) { console.error('usage: node scripts/game-report.js [label=]a.jsonl[,b.jsonl] ...'); process.exit(1); }

// Provisional targets (designer's stated aims where there are any; Claude's working guesses otherwise, marked *).
const TARGETS = {
  invaderShare: [0.3, 0.5],        // D33: about 40% invaders' endings
  settledByR3: [0, 0.6],           // RV1 (designer): some games settled by round 3 is fine (10 of 20 accepted)
  comeback: [0.15, 1],             // * the side ahead after round 2 loses at least sometimes
  patternVariety: [0.25, 1],       // * distinct vote patterns per game (not rote)
  raceGapClose: [0.35, 1],         // * invader endings with the top two factions within 2 at the end
  leaderR3Wins: [0, 0.85],         // * the faction race not settled by round 3
  sameTopFaction: [0, 0.3],        // designer (2026-10-31): the worry is every player bidding for the exact same faction
  lateOneFaction: [0, 0.6],        // the same: late standing gains not all in one faction
  brierR4: [0, 0.2],               // designer (2026-10-31): a last-round flip is welcome, but not the only place the ending is decided
  occupiedR5: [8, 15],             // 1.7: the board empties (about 7 of 15 by round 5)
  fightsR5: [2.5, 99],             // 1.7: about 2 fights left by round 5
  presenceLow: [25, 99],           // 1.7 (designer): presence feels too low (about 22–25 late today); lowest round-end average
  noEffect: [0, 0.2],              // D43: cards that can't do anything
  herding: [0, 0.5],               // * every seat chasing the same ending by round 5
  economyShare: [0, 0.45],         // 1.3 anti-goal: not economy-focused (plays that only build sway or standing)
  seatSpread: [0, 0.15],           // * win share spread between seats (fairness)
  certaintyR3: [0, 0.3],           // * the forecast after round 3 not near-certain
  brierR3: [0.1, 0.25],            // * the outcome readable but not obvious after round 3
  leaderR3Island: [0, 0.8],        // * the trophy race open after round 3
  closeFinish: [0.3, 1],           // * close finishes common
  leaderR4: [0, 0.85],             // designer: the last round matters but can't decide everything; leader can still lose
  weakCards: [0, 3],               // * few cards that rarely change the board
  swingSize: [2, 99],              // * a board play moves enough to matter
  bigPlays: [0.1, 1],              // * some plays swing big
  splitR3: [0.5, 1],               // * players still pulling both ways after round 3
};

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const median = (xs) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const share = (xs, f) => (xs.length ? xs.filter(f).length / xs.length : NaN);
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const total = (p) => sum(p);
const leaders = (p) => { const m = Math.max(...p); return p.map((x, i) => (x === m ? i : -1)).filter((i) => i >= 0); };
const isVotes = (g) => (g.votes ?? []).length > 0;
const winIdx = (g) => g.wonBy.map((f) => g.factions.indexOf(f));

/** The side each round's close favoured: the vote, or (single count) presence after the fights against the bar. */
const roundSides = (g) => (isVotes(g) ? g.votes : g.rounds.map((r) => (total(r.afterFights) > defaultBar ? 'invaders' : 'island')));
/** The round after which the side could no longer change (votes: a majority; single count: never before the end). */
const settledRound = (g) => {
  if (!isVotes(g)) return g.rounds.length;
  let a = 0, b = 0;
  for (const [i, v] of g.votes.entries()) { if (v === 'invaders') a++; else b++; if (Math.max(a, b) > g.votes.length / 2) return i + 1; }
  return g.votes.length;
};

// Each measure: section, name, the preference it serves, how to compute it over a set of games, format, target key.
const pct = (x) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : '–');
const num = (d = 1) => (x) => (Number.isFinite(x) ? x.toFixed(d) : '–');
const list = (xs) => xs.map((x) => (Number.isFinite(x) ? x.toFixed(1) : '–')).join(' / ');
const inv = (gs) => gs.filter((g) => g.side === 'invaders');
const seatIdx = (s) => Number(s.slice(1)) - 1;
/** Each seat's standing in the ending's own measure after round r (1-based): trophies on the island's ending, standing with the winning faction(s) on the invaders'. */
const measureAt = (g, r) => g.rounds[r - 1]?.seats.map((s) => (g.side === 'invaders' ? sum(winIdx(g).map((i) => s.standing[i])) : sum(s.trophies)));
const leaderAtWins = (g, r) => { const m = measureAt(g, r); if (!m) return NaN; const top = Math.max(...m); return g.winners.some((w) => m[seatIdx(w)] === top) ? 1 : 0; };
const forecasts = (g, r) => g.rounds[r - 1]?.seats.map((s) => s.pInvaders) ?? [];
const nonClosing = (gs) => gs.flatMap((g) => g.plays.filter((p) => !p.closed));
const swing = (p) => (p.moved ?? 0) + sum(p.dPresence.map((d) => Math.max(0, -d)));
const isl = (gs) => gs.filter((g) => g.side !== 'invaders');

const MEASURES = [
  ['Push and pull', 'Invaders\' endings', '1.4 knife\'s edge; D33 about 40%', (gs) => share(gs, (g) => g.side === 'invaders'), pct, 'invaderShare'],
  ['Push and pull', 'Final count within 3 of the bar', '1.4 knife\'s edge', (gs) => share(gs, (g) => Math.abs(total(g.rounds.at(-1).afterFights) - defaultBar) <= 3), pct],
  ['Push and pull', 'Side changed at least once (round by round)', '1.1 push and pull', (gs) => share(gs, (g) => { const s = roundSides(g); return s.some((x, i) => i && x !== s[i - 1]); }), pct],

  ['Push and pull', 'Forecast certainty after round 3 (mean |p − ½|, 0 = coin flip)', '1.4 knife\'s edge', (gs) => mean(gs.flatMap((g) => forecasts(g, 3).map((p) => Math.abs(p - 0.5)))), num(2), 'certaintyR3'],
  ['Push and pull', 'Forecast error after round 3 (Brier; 0.25 = no better than a coin)', '1.4 knife\'s edge (outcome not obvious early)', (gs) => mean(gs.flatMap((g) => forecasts(g, 3).map((p) => (p - (g.side === 'invaders' ? 1 : 0)) ** 2))), num(2), 'brierR3'],
  ['Push and pull', 'Final presence distance from the bar (median)', '1.4 knife\'s edge', (gs) => median(gs.map((g) => Math.abs(total(g.rounds.at(-1).afterFights) - defaultBar))), num(1)],
  ['Every round matters', 'Settled by round 3 (votes)', 'RV1', (gs) => share(gs.filter(isVotes), (g) => settledRound(g) <= 3), pct, 'settledByR3'],
  ['Every round matters', 'Rounds 1–3 all one side', 'RV1 not rote', (gs) => share(gs, (g) => new Set(roundSides(g).slice(0, 3)).size === 1), pct],
  ['Every round matters', 'Distinct round patterns per game', 'RV1 not rote', (gs) => new Set(gs.map((g) => roundSides(g).map((v) => v[1]).join(''))).size / gs.length, num(2), 'patternVariety'],
  ['Every round matters', 'Comebacks (side ahead after round 2 loses)', 'RV1; 1.1', (gs) => share(gs, (g) => { const s = roundSides(g).slice(0, 2); const a = s.filter((x) => x === 'invaders').length, b = s.length - a; return a !== b && (a > b ? 'invaders' : 'island') !== g.side; }), pct, 'comeback'],
  ['Every round matters', 'Round 5 flipped the side (after round 4 → end)', 'designer: a last-round flip is welcome (information)', (gs) => share(gs.filter((g) => !isVotes(g)), (g) => (total(g.rounds[3]?.afterFights ?? [0]) > defaultBar) !== (g.side === 'invaders')), pct],
  ['Every round matters', 'Forecast error after round 4 (Brier; low = rounds 1–4 shaped the ending)', 'designer: round 5 may flip it, but not the only place it\'s decided', (gs) => mean(gs.flatMap((g) => forecasts(g, 4).map((p) => (p - (g.side === 'invaders' ? 1 : 0)) ** 2))), num(2), 'brierR4'],
  ['Every round matters', 'Invader share of each round\'s side, R1–R5', 'RV1 (where the arc sits)', (gs) => list([0, 1, 2, 3, 4].map((r) => share(gs.filter((g) => roundSides(g)[r]), (g) => roundSides(g)[r] === 'invaders') * 100)), String],

  ['Invader ending', 'Top two factions within 2 at the end', '3.15 concern: not a plain sway race', (gs) => share(inv(gs), (g) => { const p = [...g.rounds.at(-1).afterFights].sort((a, b) => b - a); return p[0] - p[1] <= 2; }), pct, 'raceGapClose'],
  ['Invader ending', 'Winning faction led after round 3', '3.15 concern', (gs) => share(inv(gs), (g) => leaders(g.rounds[2]?.afterFights ?? [0]).some((i) => winIdx(g).includes(i))), pct, 'leaderR3Wins'],
  ['Invader ending', 'Lead changes per game (median)', '3.15 concern', (gs) => median(inv(gs).map((g) => { const l = g.rounds.map((r) => leaders(r.afterFights).join()); return l.filter((x, i) => i && x !== l[i - 1]).length; })), num(1)],
  ['Invader ending', 'Late plays (R4–5, invaders likely) only sway or standing', '3.15 concern', (gs) => { const ps = inv(gs).flatMap((g) => g.plays.filter((p) => p.r >= 4 && p.pInvaders >= 0.7)); return share(ps, (p) => p.use === 'sway' || (!p.closed && !p.moved && !p.dPresence.some(Boolean) && (p.dStanding.some(Boolean) || p.placed > 0))); }, pct],
  ['Invader ending', 'Every seat\'s top faction the same after round 4', 'designer: not one sway bid for a single faction', (gs) => share(inv(gs), (g) => new Set(g.rounds[3].seats.map((s) => s.standing.indexOf(Math.max(...s.standing)))).size === 1), pct, 'sameTopFaction'],
  ['Invader ending', 'Seats\' top factions after round 4 (median distinct)', 'designer: players backing different factions', (gs) => median(inv(gs).map((g) => new Set(g.rounds[3].seats.map((s) => s.standing.indexOf(Math.max(...s.standing)))).size)), num(1)],
  ['Invader ending', 'Late standing gains in a single faction (largest share, median)', 'designer: not one sway bid for a single faction', (gs) => median(inv(gs).map((g) => { const by = [0, 0, 0, 0, 0]; for (const p of g.plays) if (p.r >= 4 && !p.closed) p.dStanding.forEach((d, i) => { if (d > 0) by[i] += d; }); return Math.max(...by) / Math.max(1, sum(by)); })), pct, 'lateOneFaction'],
  ['Invader ending', 'Winners\' plays removing runner-up monsters (per game)', 'designer: cut one faction to lift another', (gs) => mean(inv(gs).map((g) => { const end = g.rounds.at(-1).afterFights; const w = winIdx(g); const second = [0, 1, 2, 3, 4].filter((i) => !w.includes(i)).sort((a, b) => end[b] - end[a])[0]; return sum(g.plays.filter((p) => !p.closed && g.winners.includes(p.seat)).map((p) => Math.max(0, -p.dPresence[second]))); })), num(1)],
  ['Invader ending', 'Winners\' standing with the winning faction (share)', '3.15 concern', (gs) => median(inv(gs).flatMap((g) => g.winners.map((w) => { const st = g.rounds.at(-1).seats[Number(w.slice(1)) - 1].standing; return sum(winIdx(g).map((i) => st[i])) / Math.max(1, sum(st)); }))), pct],

  ['Island ending', 'Winning score (median)', 'weakest colour (TS2)', (gs) => median(isl(gs).map((g) => Math.max(...g.scores))), num(1)],
  ['Island ending', 'Trophy leader after round 3 wins', 'every round matters; close race', (gs) => mean(isl(gs).map((g) => leaderAtWins(g, 3))), pct, 'leaderR3Island'],
  ['Island ending', 'Winner\'s trophies spread over factions (median count)', 'read the table (many fights matter)', (gs) => median(isl(gs).flatMap((g) => g.winners.map((w) => g.rounds.at(-1).seats[seatIdx(w)].trophies.filter((x) => x > 0).length))), num(1)],
  ['Island ending', 'Island winning margin (median)', '1.4 knife\'s edge', (gs) => median(isl(gs).map((g) => { const s = [...g.scores].sort((a, b) => b - a); return s[0] - (s[1] ?? 0); })), num(1)],
  ['Close games', 'Winning margin over second (median, both endings)', '1.4 knife\'s edge', (gs) => median(gs.map((g) => { const s = [...g.scores].sort((a, b) => b - a); return s[0] - (s[1] ?? 0); })), num(1)],
  ['Close games', 'Won by 1 or less (or tied)', '1.4 knife\'s edge', (gs) => share(gs, (g) => { const s = [...g.scores].sort((a, b) => b - a); return s[0] - (s[1] ?? 0) <= 1; }), pct, 'closeFinish'],
  ['Close games', 'Leader in the ending\'s measure after round 4 wins', 'the last round can still change who wins', (gs) => mean(gs.map((g) => leaderAtWins(g, 4))), pct, 'leaderR4'],
  ['Close games', 'Last place within 3 of first (score)', 'everyone in it to the end', (gs) => share(gs, (g) => Math.max(...g.scores) - Math.min(...g.scores) <= 3), pct],

  ['Dynamic board', 'Presence at each round\'s end, R1–R5', '1.7 (presence feels low)', (gs) => list([0, 1, 2, 3, 4].map((r) => mean(gs.map((g) => total(g.rounds[r]?.end ?? [NaN]))))), String],
  ['Dynamic board', 'Lowest average presence at a round\'s end', '1.7 (designer: too low)', (gs) => Math.min(...[0, 1, 2, 3, 4].map((r) => mean(gs.map((g) => total(g.rounds[r]?.end ?? [NaN]))))), num(1), 'presenceLow'],
  ['Dynamic board', 'Fights per round, R1–R5', '1.7 stale board', (gs) => list([0, 1, 2, 3, 4].map((r) => mean(gs.map((g) => g.rounds[r]?.fights ?? NaN)))), String],
  ['Dynamic board', 'Fights in round 5', '1.7 stale board', (gs) => mean(gs.map((g) => g.rounds[4]?.fights ?? NaN)), num(1), 'fightsR5'],
  ['Dynamic board', 'Locations occupied at round 5\'s end (of 15)', '1.7 the board empties', (gs) => mean(gs.map((g) => g.rounds[4]?.occupied ?? NaN)), num(1), 'occupiedR5'],
  ['Dynamic board', 'Monsters cards moved or brought on per round, R1–R5', '1.7 dynamic', (gs) => list([1, 2, 3, 4, 5].map((r) => mean(gs.map((g) => sum(g.plays.filter((p) => p.r === r).map((p) => p.moved ?? 0)))))), String],
  ['Dynamic board', 'Fight losses / refill per round, R1–R4', '1.7 the refill cancels the fights', (gs) => [0, 1, 2, 3].map((r) => `${mean(gs.map((g) => total(g.rounds[r].beforeFights) - total(g.rounds[r].afterFights))).toFixed(0)}/${mean(gs.map((g) => total(g.rounds[r].end) - total(g.rounds[r].afterFights))).toFixed(0)}`).join(' '), String],

  ['Cards matter', 'Plays with no effect at all', 'D43; 1.7 few options', (gs) => share(gs.flatMap((g) => g.plays.filter((p) => !p.closed)), (p) => p.use !== 'sway' && !p.moved && !p.placed && !p.dPresence.some(Boolean) && !p.dStanding.some(Boolean) && !p.dTrophies.some(Boolean)), pct, 'noEffect'],
  ['Cards matter', 'Plays that changed the board (moved, added or removed monsters)', '1.7', (gs) => share(gs.flatMap((g) => g.plays.filter((p) => !p.closed)), (p) => p.moved > 0 || p.dPresence.some(Boolean)), pct],
  ['Cards matter', 'Cards whose action changes the board under 25% of the time', '1.7 few options; card levers', (gs) => cardTable(gs).filter(([, c]) => c.changed / c.n < 0.25).length, num(0), 'weakCards'],
  ['Cards matter', 'Action plays that did nothing (cards with an action)', 'D43', (gs) => share(nonClosing(gs).filter((p) => p.use === 'action'), (p) => !swing(p) && !p.placed && !p.dStanding.some(Boolean) && !p.dTrophies.some(Boolean)), pct],

  ['Few choices, huge consequences', 'Monsters moved or removed per board-changing play (mean)', '1.2 pillar 5', (gs) => mean(nonClosing(gs).map(swing).filter(Boolean)), num(1), 'swingSize'],
  ['Few choices, huge consequences', 'Plays moving or removing 4+ monsters', '1.2 pillar 5', (gs) => share(nonClosing(gs).filter((p) => p.use === 'action'), (p) => swing(p) >= 4), pct, 'bigPlays'],
  ['Few choices, huge consequences', 'Forecast flips across ½ per seat (round to round)', '1.2 pillar 5; 1.1 push and pull', (gs) => mean(gs.map((g) => { let n = 0; for (let r = 1; r < g.rounds.length; r++) { const a = forecasts(g, r), b = forecasts(g, r + 1); n += a.filter((p, i) => (p > 0.5) !== (b[i] > 0.5)).length; } return n / Math.max(1, g.rounds[0].seats.length); })), num(1)],
  ['Not economy-focused', 'Plays that only built sway or standing', '1.3 anti-goal', (gs) => share(gs.flatMap((g) => g.plays.filter((p) => !p.closed)), (p) => p.use === 'sway' || (!p.moved && !p.dPresence.some(Boolean) && (p.dStanding.some(Boolean) || p.placed > 0))), pct, 'economyShare'],

  ['Not economy-focused', 'Plays spent for sway', '1.3 anti-goal', (gs) => share(gs.flatMap((g) => g.plays), (p) => p.use === 'sway'), pct],
  ['Not economy-focused', 'Unspent supply per seat at the end (median)', '1.3 (sway hoarded, not used)', (gs) => median(gs.flatMap((g) => g.rounds.at(-1).seats.map((s) => s.supply))), num(1)],
  ['Light', 'Card plays per seat per game', '1.3 not heavy', (gs) => mean(gs.map((g) => g.plays.length / g.rounds[0].seats.length)), num(1)],

  ['Read the table', 'Every seat chasing one ending by round 5', '1.2 read the table; 1.4 never in control', (gs) => share(gs, (g) => new Set(g.rounds.at(-1).seats.map((s) => s.goal)).size === 1), pct, 'herding'],
  ['Read the table', 'Seats that switched ending at least once', '1.1 push and pull', (gs) => share(gs.flatMap((g) => g.rounds[0].seats.map((_, i) => g.rounds.map((r) => r.seats[i].goal))), (seq) => new Set(seq.filter(Boolean)).size > 1), pct],

  ['Read the table', 'Goal switches per seat (mean)', '1.2 read the table', (gs) => mean(gs.flatMap((g) => g.rounds[0].seats.map((_, i) => { const s = g.rounds.map((r) => r.seats[i].goal).filter(Boolean); return s.filter((x, j) => j && x !== s[j - 1]).length; }))), num(2)],
  ['Read the table', 'Seats split between endings after round 3', '1.1 players pull both ways', (gs) => share(gs, (g) => new Set(g.rounds[2]?.seats.map((s) => s.goal).filter(Boolean)).size > 1), pct, 'splitR3'],

  ['Fair', 'Win share spread between seats (max − min)', '* fairness', (gs) => { const n = gs[0].rounds[0].seats.length; const w = Array.from({ length: n }, (_, i) => share(gs, (g) => g.winners.includes(`P${i + 1}`))); return Math.max(...w) - Math.min(...w); }, pct, 'seatSpread'],
  ['Fair', 'Round 1\'s first player wins', 'D44 (random opener)', (gs) => share(gs.filter((g) => g.rounds[0].first), (g) => g.winners.includes(g.rounds[0].first)), pct],
  ['Fair', 'Steal Their Playbook players win', 'D44 (last move now, first next round)', (gs) => share(gs.flatMap((g) => [...new Set(g.plays.filter((p) => p.card === 'playbook' && p.use === 'action').map((p) => p.seat))].map((s) => g.winners.includes(s))), Boolean), pct],
  ['Fair', 'Wins by bot profile', 'effort changes the ending', (gs) => { const by = {}; for (const g of gs) for (const [seat, prof] of Object.entries(g.seats)) { by[prof] ??= [0, 0]; by[prof][0]++; if (g.winners.includes(seat)) by[prof][1]++; } return Object.entries(by).map(([p, [n, w]]) => `${p.replace('bot:', '')} ${Math.round((100 * w) / n)}%`).join(' · '); }, String],
];

// Per-card table: how often a card's action changes the board, and by how much.
function cardTable(gs) {
  const by = {};
  for (const g of gs) for (const p of g.plays) {
    if (p.use !== 'action' || p.closed) continue;
    const c = (by[p.card] ??= { n: 0, changed: 0, monsters: 0, nothing: 0 });
    c.n++;
    const m = (p.moved ?? 0) + sum(p.dPresence.map((d) => Math.max(0, -d))); // arrivals, plus monsters removed
    if (m) { c.changed++; c.monsters += m; }
    if (!m && !p.placed && !p.dStanding.some(Boolean) && !p.dTrophies.some(Boolean)) c.nothing++;
  }
  return Object.entries(by).sort((a, b) => a[1].changed / a[1].n - b[1].changed / b[1].n);
}

const flag = (key, v) => {
  const t = key && TARGETS[key];
  if (!t || !Number.isFinite(v)) return '·';
  return v >= t[0] && v <= t[1] ? '✓' : '✗';
};

const w = 54;
console.log(`Game report · bar ${defaultBar} · ${groups.map((g) => `${g.label}: ${g.games.length} games`).join(' · ')}`);
console.log('Targets are provisional (edit TARGETS in the script); ✗ marks a miss. Bots are the players.\n');
let section = '';
for (const [sec, name, pref, f, fmt, key] of MEASURES) {
  if (sec !== section) { console.log(`\n${sec.toUpperCase()}`); section = sec; }
  const cells = groups.map((g) => { let v; try { v = f(g.games); } catch { v = NaN; } return `${flag(key, typeof v === 'number' ? v : NaN)} ${typeof v === 'number' ? fmt(v) : v}`; });
  const t = key ? ` [${TARGETS[key].map((x) => (x >= 99 ? '' : fmt(x))).join('–')}]` : '';
  console.log(`  ${(name + t).padEnd(w)} ${cells.map((c) => c.padEnd(24)).join(' ')}  (${pref})`);
}
for (const g of groups) {
  console.log(`\nCARDS (${g.label}): action plays (non-closing) · changed the board · monsters per change · did nothing`);
  for (const [id, c] of cardTable(g.games)) console.log(`  ${id.padEnd(16)} ${String(c.n).padStart(4)}  ${pct(c.changed / c.n).padStart(4)}  ${(c.monsters / Math.max(1, c.changed)).toFixed(1).padStart(4)}  ${pct(c.nothing / c.n).padStart(4)}`);
}
console.log('\nNot measured yet: ties as a tool (scorched locations, true ties); tough decisions (the bots\' value spread).');
