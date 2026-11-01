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
  strongestR3Wins: [0, 0.85],         // * the faction race not settled by round 3
  lastRoundFlip: [0.05, 0.5],      // designer (2026-10-31): 38% not a big worry; never (round 5 can't matter) or most games (it decides everything) would be
  lateSwayOnly: [0.1, 0.65],       // designer (2026-10-31): 48% only mildly worrying; near all sway would be a worry
  round5Decides: [0.15, 0.5],      // designer (2026-11-01): round 5 never deciding the ending is the top worry under votes
  canBig: [0.3, 1],                // * a big play is often on offer
  sameTopFaction: [0, 0.3],        // designer (2026-10-31): the worry is every player bidding for the exact same faction
  lateOneFaction: [0, 0.6],        // the same: late standing gains not all in one faction
  calibration: [0, 0.1],           // * bots' forecasts mean what they say
  skillR3: [0.2, 1],               // * the bots read the game better than the base rate by round 3
  goalGap: [0.1, 99],              // * invader-goal seats' plays add presence relative to island-goal seats'
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
  inFrontR3Island: [0, 0.8],        // * the trophy race open after round 3
  closeFinish: [0.3, 1],           // * close finishes common
  inFrontR4: [0, 0.85],             // designer: the last round matters but can't decide everything; the player in front can still lose
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
const strongest = (p) => { const m = Math.max(...p); return p.map((x, i) => (x === m ? i : -1)).filter((i) => i >= 0); };
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
/** Each seat's score by the ending's own rule, as it stood after round r (1-based): on the island's ending its weakest
 *  colour of trophies (TS2); on the invaders', standing with the winning faction(s) less that faction's trophies (EG3). */
const measureAt = (g, r) => g.rounds[r - 1]?.seats.map((s) => (g.side === 'invaders' ? sum(winIdx(g).map((i) => s.standing[i] - s.trophies[i])) : Math.min(...s.trophies)));
/** Did the player in front after round r win? Players tied in front count by share (3 tied, one of them won: ⅓). */
const inFrontWins = (g, r) => { const m = measureAt(g, r); if (!m) return NaN; const top = Math.max(...m); const tied = m.filter((x) => x === top).length; return g.winners.filter((w) => m[seatIdx(w)] === top).length / tied; };
const forecasts = (g, r) => g.rounds[r - 1]?.seats.map((s) => s.pInvaders) ?? [];
const nonClosing = (gs) => gs.flatMap((g) => g.plays.filter((p) => !p.closed));
/** Forecast calibration: forecasts binned by tenths, the weighted gap between said and seen. */
const calibration = (gs) => { const bins = Array.from({ length: 10 }, () => [0, 0]); for (const g of gs) for (const r of g.rounds) for (const s of r.seats) { const b = Math.min(9, Math.floor(s.pInvaders * 10)); bins[b][0] += s.pInvaders - (g.side === 'invaders' ? 1 : 0); bins[b][1]++; } const n = sum(bins.map((b) => b[1])); return sum(bins.map((b) => Math.abs(b[0]))) / n; };
/** Brier skill after round r: 1 − Brier / the base rate's Brier. */
const skill = (gs, r) => { const rate = share(gs, (g) => g.side === 'invaders'); const base = rate * (1 - rate); const b = mean(gs.flatMap((g) => forecasts(g, r).map((p) => (p - (g.side === 'invaders' ? 1 : 0)) ** 2))); return base ? 1 - b / base : NaN; };
/** The swing diagnosis (logged with swing=1): one entry per turn of play. */
const turnsOf = (gs) => gs.flatMap((g) => g.swings ?? []);
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
  ['Every round matters', 'Comebacks (side ahead on votes after round 2 loses)', 'RV1; 1.1', (gs) => share(gs, (g) => { const s = roundSides(g).slice(0, 2); const a = s.filter((x) => x === 'invaders').length, b = s.length - a; return a !== b && (a > b ? 'invaders' : 'island') !== g.side; }), pct, 'comeback'],
  ['Every round matters', 'Round 5 flipped the side (after round 4 → end)', 'designer: a last-round flip is welcome; never or almost always is a worry', (gs) => share(gs.filter((g) => !isVotes(g)), (g) => (total(g.rounds[3]?.afterFights ?? [0]) > defaultBar) !== (g.side === 'invaders')), pct, 'lastRoundFlip'],
  ['Every round matters', 'Round 5 decided the ending (votes: 2–2 after round 4)', 'designer: no round-5 decider is bad', (gs) => share(gs.filter(isVotes), (g) => g.votes.length === 5 && g.votes.slice(0, 4).filter((v) => v === 'invaders').length === 2), pct, 'round5Decides'],
  ['Every round matters', 'Forecast error after round 4 (Brier; low = rounds 1–4 shaped the ending)', 'designer: round 5 may flip it, but not the only place it\'s decided', (gs) => mean(gs.flatMap((g) => forecasts(g, 4).map((p) => (p - (g.side === 'invaders' ? 1 : 0)) ** 2))), num(2), 'brierR4'],
  ['Every round matters', 'Invader share of each round\'s side, R1–R5', 'RV1 (where the arc sits)', (gs) => list([0, 1, 2, 3, 4].map((r) => share(gs.filter((g) => roundSides(g)[r]), (g) => roundSides(g)[r] === 'invaders') * 100)), String],

  ['Invader ending', 'Top two factions within 2 at the end', '3.15 concern: not a plain sway race', (gs) => share(inv(gs), (g) => { const p = [...g.rounds.at(-1).afterFights].sort((a, b) => b - a); return p[0] - p[1] <= 2; }), pct, 'raceGapClose'],
  ['Invader ending', 'Strongest faction after round 3 is the one that won', '3.15 concern', (gs) => share(inv(gs), (g) => strongest(g.rounds[2]?.afterFights ?? [0]).some((i) => winIdx(g).includes(i))), pct, 'strongestR3Wins'],
  ['Invader ending', 'Changes of strongest faction per game (median)', '3.15 concern', (gs) => median(inv(gs).map((g) => { const l = g.rounds.map((r) => strongest(r.afterFights).join()); return l.filter((x, i) => i && x !== l[i - 1]).length; })), num(1)],
  ['Invader ending', 'Late plays (R4–5, invaders likely) only sway or standing', '3.15 concern', (gs) => { const ps = inv(gs).flatMap((g) => g.plays.filter((p) => p.r >= 4 && p.pInvaders >= 0.7)); return share(ps, (p) => p.use === 'sway' || (!p.closed && !p.moved && !p.dPresence.some(Boolean) && (p.dStanding.some(Boolean) || p.placed > 0))); }, pct, 'lateSwayOnly'],
  ['Invader ending', 'Every player\'s highest-standing faction the same after round 4', 'designer: not one sway bid for a single faction', (gs) => share(inv(gs), (g) => new Set(g.rounds[3].seats.map((s) => s.standing.indexOf(Math.max(...s.standing)))).size === 1), pct, 'sameTopFaction'],
  ['Invader ending', 'Distinct highest-standing factions among players after round 4 (median)', 'designer: players backing different factions', (gs) => median(inv(gs).map((g) => new Set(g.rounds[3].seats.map((s) => s.standing.indexOf(Math.max(...s.standing)))).size)), num(1)],
  ['Invader ending', 'Late standing gains in a single faction (largest share, median)', 'designer: not one sway bid for a single faction', (gs) => median(inv(gs).map((g) => { const by = [0, 0, 0, 0, 0]; for (const p of g.plays) if (p.r >= 4 && !p.closed) p.dStanding.forEach((d, i) => { if (d > 0) by[i] += d; }); return Math.max(...by) / Math.max(1, sum(by)); })), pct, 'lateOneFaction'],
  ['Invader ending', 'Winners\' plays removing the second-strongest faction\'s monsters (per game)', 'designer: cut one faction to lift another', (gs) => mean(inv(gs).map((g) => { const end = g.rounds.at(-1).afterFights; const w = winIdx(g); const secondStrongest = [0, 1, 2, 3, 4].filter((i) => !w.includes(i)).sort((a, b) => end[b] - end[a])[0]; return sum(g.plays.filter((p) => !p.closed && g.winners.includes(p.seat)).map((p) => Math.max(0, -p.dPresence[secondStrongest]))); })), num(1)],
  ['Invader ending', 'Winners\' standing with the winning faction (share)', '3.15 concern', (gs) => median(inv(gs).flatMap((g) => g.winners.map((w) => { const st = g.rounds.at(-1).seats[Number(w.slice(1)) - 1].standing; return sum(winIdx(g).map((i) => st[i])) / Math.max(1, sum(st)); }))), pct],

  ['Island ending', 'Winning score (median)', 'weakest colour (TS2)', (gs) => median(isl(gs).map((g) => Math.max(...g.scores))), num(1)],
  ['Island ending', 'Player in front on trophies (TS2) after round 3 wins (island games)', 'every round matters; close race', (gs) => mean(isl(gs).map((g) => inFrontWins(g, 3))), pct, 'inFrontR3Island'],
  ['Island ending', 'Winner\'s trophies spread over factions (median count)', 'read the table (many fights matter)', (gs) => median(isl(gs).flatMap((g) => g.winners.map((w) => g.rounds.at(-1).seats[seatIdx(w)].trophies.filter((x) => x > 0).length))), num(1)],
  ['Island ending', 'Island winning margin (median)', '1.4 knife\'s edge', (gs) => median(isl(gs).map((g) => { const s = [...g.scores].sort((a, b) => b - a); return s[0] - (s[1] ?? 0); })), num(1)],
  ['Close games', 'Winning margin over second (median, both endings)', '1.4 knife\'s edge', (gs) => median(gs.map((g) => { const s = [...g.scores].sort((a, b) => b - a); return s[0] - (s[1] ?? 0); })), num(1)],
  ['Close games', 'Won by 1 or less (or tied)', '1.4 knife\'s edge', (gs) => share(gs, (g) => { const s = [...g.scores].sort((a, b) => b - a); return s[0] - (s[1] ?? 0) <= 1; }), pct, 'closeFinish'],
  ['Close games', 'Player in front (under the final ending, TS2 / EG3) after round 4 wins', 'the last round can still change who wins', (gs) => mean(gs.map((g) => inFrontWins(g, 4))), pct, 'inFrontR4'],
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
  ['Big plays: why so few', 'A · presence on the board per turn (mean)', 'too few tokens?', (gs) => mean(turnsOf(gs).map((w) => w.presence)), num(1)],
  ['Big plays: why so few', 'B · groups on the board per turn (mean)', 'too few groups?', (gs) => mean(turnsOf(gs).map((w) => w.groups)), num(1)],
  ['Big plays: why so few', 'B · largest group per turn (mean)', 'groups too small?', (gs) => mean(turnsOf(gs).map((w) => w.maxGroup)), num(1)],
  ['Big plays: why so few', 'B · turns with a group of 4+ on the board', 'groups too small?', (gs) => share(turnsOf(gs), (w) => w.groups4 > 0), pct],
  ['Big plays: why so few', 'C · turns where a legal play in hand could swing 4+', 'can the hand do it?', (gs) => share(turnsOf(gs), (w) => w.best >= 4), pct, 'canBig'],
  ['Big plays: why so few', 'C · the same if sway were free', 'is the sway cost the block?', (gs) => share(turnsOf(gs), (w) => w.bestFree >= 4), pct],
  ['Big plays: why so few', 'D · held cards that could swing 4+ here (as is / sway free)', 'do the cards allow it?', (gs) => { const cs = turnsOf(gs).flatMap((w) => w.cards); return `${pct(share(cs, (c) => c[1] >= 4))} / ${pct(share(cs, (c) => c[2] >= 4))}`; }, String],
  ['Big plays: why so few', 'Taken: plays swinging 4+ per turn with one on offer', 'do players choose it?', (gs) => nonClosing(gs).filter((p) => swing(p) >= 4).length / Math.max(1, turnsOf(gs).filter((w) => w.best >= 4).length), pct],

  ['Not economy-focused', 'Plays that only built sway or standing', '1.3 anti-goal', (gs) => share(gs.flatMap((g) => g.plays.filter((p) => !p.closed)), (p) => p.use === 'sway' || (!p.moved && !p.dPresence.some(Boolean) && (p.dStanding.some(Boolean) || p.placed > 0))), pct, 'economyShare'],

  ['Not economy-focused', 'Plays spent for sway', '1.3 anti-goal', (gs) => share(gs.flatMap((g) => g.plays), (p) => p.use === 'sway'), pct],
  ['Not economy-focused', 'Unspent supply per seat at the end (median)', '1.3 (sway hoarded, not used)', (gs) => median(gs.flatMap((g) => g.rounds.at(-1).seats.map((s) => s.supply))), num(1)],
  ['Light', 'Card plays per seat per game', '1.3 not heavy', (gs) => mean(gs.map((g) => g.plays.length / g.rounds[0].seats.length)), num(1)],

  ['Read the table', 'Every seat chasing one ending by round 5', '1.2 read the table; 1.4 never in control', (gs) => share(gs, (g) => new Set(g.rounds.at(-1).seats.map((s) => s.goal)).size === 1), pct, 'herding'],
  ['Read the table', 'Seats that switched ending at least once', '1.1 push and pull', (gs) => share(gs.flatMap((g) => g.rounds[0].seats.map((_, i) => g.rounds.map((r) => r.seats[i].goal))), (seq) => new Set(seq.filter(Boolean)).size > 1), pct],

  ['Read the table', 'Goal switches per seat (mean)', '1.2 read the table', (gs) => mean(gs.flatMap((g) => g.rounds[0].seats.map((_, i) => { const s = g.rounds.map((r) => r.seats[i].goal).filter(Boolean); return s.filter((x, j) => j && x !== s[j - 1]).length; }))), num(2)],
  ['Read the table', 'Seats split between endings after round 3', '1.1 players pull both ways', (gs) => share(gs, (g) => new Set(g.rounds[2]?.seats.map((s) => s.goal).filter(Boolean)).size > 1), pct, 'splitR3'],

  ['Bot quality', 'Forecast calibration error (all rounds; 0 = says 70%, happens 70%)', 'do the bots read the game right?', (gs) => calibration(gs), num(2), 'calibration'],
  ['Bot quality', 'Forecast skill over the base rate, R1–R5 (1 = perfect, 0 = no better than always guessing the usual split)', 'predictions improve as the game unfolds', (gs) => [1, 2, 3, 4, 5].map((r) => num(2)(skill(gs, r))).join(' / '), String],
  ['Bot quality', 'Forecast skill after round 3', 'the bots see where the game is going', (gs) => skill(gs, 3), num(2), 'skillR3'],
  ['Bot quality', 'Seats whose final goal was the ending that happened', 'they back the right side', (gs) => share(gs.flatMap((g) => g.rounds.at(-1).seats.filter((s) => s.goal).map((s) => s.goal === g.side)), Boolean), pct],
  ['Bot quality', 'Win rate: final goal right vs wrong', 'the goal drives winning (not luck)', (gs) => { const r = [[0, 0], [0, 0]]; for (const g of gs) g.rounds.at(-1).seats.forEach((s, i) => { if (!s.goal) return; const k = s.goal === g.side ? 0 : 1; r[k][0]++; if (g.winners.includes(`P${i + 1}`)) r[k][1]++; }); return `${pct(r[0][1] / r[0][0])} vs ${pct(r[1][1] / r[1][0])}`; }, String],
  ['Bot quality', 'Net presence per play: invader-goal vs island-goal seats', 'plays push toward the seat\'s goal', (gs) => { const by = { invaders: [], island: [] }; for (const p of nonClosing(gs)) if (p.goal) by[p.goal].push(sum(p.dPresence)); return `${num(2)(mean(by.invaders))} vs ${num(2)(mean(by.island))}`; }, String],
  ['Bot quality', 'Goal-consistent presence gap (invader-goal minus island-goal, per play)', 'plays push toward the seat\'s goal', (gs) => { const by = { invaders: [], island: [] }; for (const p of nonClosing(gs)) if (p.goal) by[p.goal].push(sum(p.dPresence)); return mean(by.invaders) - mean(by.island); }, num(2), 'goalGap'],
  ['Bot quality', 'Invader backers\' late standing in the faction that won (share, vs chance)', 'they back the right faction', (gs) => { const xs = [], ch = []; for (const g of inv(gs)) { const w = winIdx(g); const alive = g.rounds[3].afterFights.filter((x) => x > 0).length || 5; for (const p of g.plays) { if (p.r < 4 || p.closed || p.goal !== 'invaders') continue; const up = p.dStanding.map((d) => Math.max(0, d)); const s = sum(up); if (!s) continue; xs.push(sum(w.map((i) => up[i])) / s); ch.push(w.length / alive); } } return `${pct(mean(xs))} vs ${pct(mean(ch))}`; }, String],
  ['Bot quality', 'Bots\' win share against random seats (per seat, vs fair share)', 'strategy beats chance', (gs) => { const t = gs.filter((g) => Object.values(g.seats).includes('random')); if (!t.length) return 'no random seats (add profile random)'; let n = 0, w = 0, fair = 0; for (const g of t) for (const [seat, prof] of Object.entries(g.seats)) if (prof !== 'random') { n++; fair += 1 / Object.keys(g.seats).length; if (g.winners.includes(seat)) w++; } return `${pct(w / n)} vs ${pct(fair / n)}`; }, String],

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
  for (const g of gs) for (const w of g.swings ?? []) for (const [id, s, f] of w.cards) {
    const c = (by[id] ??= { n: 0, changed: 0, monsters: 0, nothing: 0 });
    c.held = (c.held ?? 0) + 1; c.big = (c.big ?? 0) + (s >= 4); c.bigFree = (c.bigFree ?? 0) + (f >= 4); c.max = Math.max(c.max ?? 0, f);
  }
  return Object.entries(by).sort((a, b) => a[1].changed / (a[1].n || 1) - b[1].changed / (b[1].n || 1));
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
  console.log(`\nCARDS (${g.label}): action plays (non-closing) · changed the board · monsters per change · did nothing · held: could swing 4+ (as is / sway free) · biggest swing seen`);
  for (const [id, c] of cardTable(g.games)) console.log(`  ${id.padEnd(16)} ${String(c.n).padStart(4)}  ${pct(c.changed / (c.n || 1)).padStart(4)}  ${(c.monsters / Math.max(1, c.changed)).toFixed(1).padStart(4)}  ${pct(c.nothing / (c.n || 1)).padStart(4)}${c.held ? `   ${pct(c.big / c.held).padStart(4)} / ${pct(c.bigFree / c.held).padStart(4)}  ${String(c.max).padStart(3)}` : ''}`);
}
console.log('\nNot measured yet: ties as a tool (scorched locations, true ties); tough decisions (the bots\' value spread).');
