// @ts-nocheck
/**
 * The card report: how each card plays, from the bots' own decisions. Reads the native runner's logs made with the
 * card study on (`motw tournament ... cards=1 log=X.jsonl`): every turn of play logs the hand, every move the bot
 * weighed (its one-step score and, if shortlisted, its play-out value) and the move made; every draft pick logs the
 * batch offered and each card's worth to the bot.
 *
 *   node scripts/card-report.js X.jsonl[,Y.jsonl]          one set of games
 *   node scripts/card-report.js X.jsonl card=plough         one card in detail
 *
 * The bots' values have no fixed scale (win chances plus margin and threat terms), so gaps are a share of that turn's
 * spread: the best weighed play's value minus the worst's (0: no difference, 1: the whole range). Bots are the players,
 * so these measure how bots play the cards, not how people will feel about them. Flags are Claude's working lines,
 * not design decisions: they say where to look, never what to change.
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const spec = JSON.parse(readFileSync(new URL('../public/spec.json', import.meta.url), 'utf8'));
const args = process.argv.slice(2);
const OPTS = /^(card|json|goal|only|half)=/;
const opt = Object.fromEntries(args.filter((a) => OPTS.test(a)).map((a) => a.split('=')));
const files = args.filter((a) => !OPTS.test(a)).flatMap((a) => a.split(','));
if (!files.length) { console.error('usage: node scripts/card-report.js a.jsonl[,b.jsonl] [card=id]'); process.exit(1); }
// A line still being written (a run in progress) is skipped.
const allGames = files.flatMap((f) => readFileSync(f, 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }));
// half=0|1: every other game (to check the measures agree with themselves).
const games = opt.half === undefined ? allGames : allGames.filter((g, i) => i % 2 === Number(opt.half));
if (!games.some((g) => g.cardTurns?.length)) { console.error('no card study in these logs: run motw tournament with cards=1'); process.exit(1); }

const cards = spec.cards.map((c) => c.id);
const nameOf = Object.fromEntries(spec.cards.map((c) => [c.id, c.name]));
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const sd = (xs) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };
const uniq = (xs) => [...new Set(xs)];
/** Effective number of kinds: e^entropy of the counts (1: always the same; k: k kinds equally). */
const effective = (counts) => { const n = counts.reduce((a, b) => a + b, 0); if (!n) return NaN; return Math.exp(-counts.filter(Boolean).reduce((h, c) => h + (c / n) * Math.log(c / n), 0)); };
const pct = (x) => `${Math.round(x * 100)}%`;
const tally = (xs) => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map());

/** The way a play is used: sway, the way back, the action's reading (location or faction) or unsuited use, or empty. */
// An action with no target does nothing ('empty'); 'way back' is the return use (any suit card brings its faction's
// tokens back).
const way = (m) => (m.type !== 'play' ? 'pass' : m.use === 'return' ? 'way back' : m.use !== 'action' ? m.use : m.target == null ? 'empty' : m.target.use ?? m.target.mode ?? 'action');
const place = (m) => m.target?.location ?? m.target?.to ?? null;

// Per card: everything the scorecard and the detail need. `end`: the same measures split by ending (designer,
// 2026-11-07: a card's usefulness for each ending measured apart): turns by the seat's goal then, wins by the game's.
const side = () => ({ held: 0, chance: 0, chosen: 0, edges: [], wins: 0, base: 0, plays: 0, sway: 0 });
const goalOf = (t) => (t.goal === 'invaders' ? 'invaders' : t.goal === 'island' ? 'island' : null);
const C = Object.fromEntries(cards.map((c) => [c, { held: 0, chosen: 0, chance: 0, edges: [], playedEdges: [], ranks: [], dead: 0, ways: [], places: [], order: [], rounds: [], wins: 0, plays: 0, offered: 0, picked: 0, pickChance: 0, byGoal: {}, turnsInstinct: 0, end: { island: side(), invaders: side() }, wayEdges: {}, bestWay: {}, ablePlays: 0, swayAble: 0, multi: 0, same: 0, winBy: {}, use: {} }]));
const pairs = new Map(); // "a>b": [b played next by the seat after a, chances]
let turns = 0, instinct = 0, withValues = 0;
const decisions = []; // per turn: the gap between the best two cards, and between the best and the worst
// Working lines (Claude's): close is within a tenth of the turn's spread; clear is a third of it or more.
const CLOSE = 0.1, CLEAR = 0.33;
for (const g of games) {
  const n = Object.keys(g.seats).length;
  const winners = new Set(g.winners);
  const ts = [...(g.cardTurns ?? [])].sort((a, b) => a.mv - b.mv);
  // Each seat's plays in a round, in order (for timing and pairs).
  const seq = new Map();
  for (const t of ts) {
    // goal=: only the turns a seat played for that ending (the scorecards are made once per goal).
    if (opt.goal && goalOf(t) !== opt.goal) continue;
    turns++;
    const hand = uniq(t.hand);
    const pick = t.chosen.type === 'play' ? t.chosen.card : null;
    if (t.instinct) instinct++;
    for (const [i, c] of t.hand.entries()) if (C[c] && t.acts[i] === 0 && hand.indexOf(c) === t.hand.indexOf(c)) C[c].dead++;
    const gl = goalOf(t);
    // Each card's uses open this turn (its readings or unsuited uses among the moves weighed: the bot lists only legal
    // ones; sway, the way back and empty actions left out).
    const open = {};
    for (const [m] of t.options) {
      if (m.type !== 'play') continue;
      const w = way(m);
      if (w === 'sway' || w === 'empty' || w === 'way back') continue;
      (open[m.card] ??= new Set()).add(w);
    }
    for (const c of hand) {
      if (!C[c]) continue;
      for (const u of open[c] ?? []) {
        const x = (C[c].use[u] ??= { open: 0, chances: 0, taken: 0 });
        x.open++;
        if (c === pick) { x.chances++; if (way(t.chosen) === u) x.taken++; }
      }
      C[c].held++; C[c].chance += 1 / hand.length; if (c === pick) C[c].chosen++;
      if (gl) { const e = C[c].end[gl]; e.held++; e.chance += 1 / hand.length; if (c === pick) e.chosen++; }
    }
    if (pick) {
      const k = `${t.seat}:${t.r}`;
      if (!seq.has(k)) seq.set(k, []);
      seq.get(k).push({ card: pick, hand, m: t.chosen });
      const c = C[pick];
      if (c) {
        // Wants to act: of its plays while its action had a legal target, how many were spent for sway instead.
        if (t.acts[t.hand.indexOf(pick)] > 0) {
          c.ablePlays++;
          if (t.chosen.use === 'sway') c.swayAble++;
          if (gl) { const e = c.end[gl]; e.able = (e.able ?? 0) + 1; if (t.chosen.use === 'sway') e.swayAble = (e.swayAble ?? 0) + 1; }
        }
        c.ways.push(way(t.chosen));
        if (place(t.chosen)) c.places.push(place(t.chosen));
        c.rounds.push(t.r);
        c.plays++;
        if (winners.has(t.seat)) c.wins++;
        const goal = t.goal ?? 'none';
        c.byGoal[goal] = (c.byGoal[goal] ?? 0) + 1;
        c.baseWin = (c.baseWin ?? 0) + 1 / n;
        const e = c.end[g.side === 'invaders' ? 'invaders' : 'island'];
        e.plays++; e.base += 1 / n; if (winners.has(t.seat)) e.wins++; if (t.chosen.use === 'sway') e.sway++;
      }
    }
    // Worth relative to the hand: each card's best play-out value this turn (its shortlisted options).
    const best = {};
    for (const [m, , v] of t.options) {
      if (v == null || m.type !== 'play') continue;
      best[m.card] = Math.max(best[m.card] ?? -Infinity, v);
    }
    const all = t.options.map((o) => o[2]).filter((v) => v != null);
    const spread = Math.max(...all) - Math.min(...all);
    const valued = hand.filter((c) => best[c] !== undefined);
    if (valued.length >= 2 && spread > 0) {
      withValues++;
      const pts = (v) => v / spread;
      const floor = Math.min(...all);
      // A card with no shortlisted option is worth at most the weakest shortlisted card's best (counted at that).
      const worth = Object.fromEntries(hand.map((c) => [c, best[c] ?? floor]));
      const order = [...hand].sort((a, b) => worth[b] - worth[a]);
      decisions.push({ r: t.r, n, gap: pts(worth[order[0]] - worth[order[1]]), flat: pts(worth[order[0]] - worth[order[order.length - 1]]), live: hand.filter((c) => pts(worth[order[0]] - worth[c]) <= CLOSE).length, hand: hand.length });
      // Each card's ways this turn (sway and empty actions left out), compared on the one-step score every option
      // has (play-out values exist only for the shortlist): each way's best, as a share of the turn's one-step spread,
      // against the best one-step score of the rest of the hand.
      const qs = t.options.map((o) => o[1]);
      const qSpread = Math.max(...qs) - Math.min(...qs);
      const byWay = {}, cardQ = {};
      for (const [m, q] of t.options) {
        if (m.type !== 'play') continue;
        cardQ[m.card] = Math.max(cardQ[m.card] ?? -Infinity, q);
        const w = way(m);
        if (w === 'sway' || w === 'empty' || !C[m.card]) continue;
        byWay[m.card] ??= {};
        byWay[m.card][w] = Math.max(byWay[m.card][w] ?? -Infinity, q);
      }
      if (qSpread > 0) for (const [c, ws] of Object.entries(byWay)) {
        if (!hand.includes(c)) continue;
        const rest = Math.max(...hand.filter((x) => x !== c).map((x) => cardQ[x] ?? -Infinity));
        if (!isFinite(rest)) continue;
        for (const [w, v] of Object.entries(ws)) (C[c].wayEdges[w] ??= []).push((v - rest) / qSpread);
        const names = Object.keys(ws);
        if (names.length >= 2) {
          const top = Math.max(...Object.values(ws));
          const tops = names.filter((w) => ws[w] === top);
          for (const w of tops) C[c].bestWay[w] = (C[c].bestWay[w] ?? 0) + 1 / tops.length;
        }
        // Reading balance: its own readings or uses (the way back left out, as every suit card has it), on turns with
        // two or more open: the same best play from each, or one ahead (which).
        const own = names.filter((w) => w !== 'way back');
        if (own.length >= 2) {
          C[c].multi++;
          const top = Math.max(...own.map((w) => ws[w]));
          const tops = own.filter((w) => ws[w] === top);
          if (tops.length === own.length) C[c].same++;
          else for (const w of tops) C[c].winBy[w] = (C[c].winBy[w] ?? 0) + 1 / tops.length;
        }
      }
      for (const c of hand) {
        if (!C[c]) continue;
        const others = hand.filter((x) => x !== c).map((x) => worth[x]);
        const edge = pts(worth[c] - Math.max(...others));
        C[c].edges.push(edge);
        if (gl) C[c].end[gl].edges.push(edge);
        if (c === pick) C[c].playedEdges.push(edge);
        C[c].ranks.push(hand.length > 1 ? order.indexOf(c) / (hand.length - 1) : 0);
      }
    }
  }
  // Timing within the seat's round, and which card follows which (held at the time).
  for (const plays of seq.values()) {
    plays.forEach((p, i) => { if (C[p.card]) C[p.card].order.push(plays.length > 1 ? i / (plays.length - 1) : NaN); });
    for (let i = 0; i + 1 < plays.length; i++) {
      const a = plays[i].card, next = plays[i + 1];
      for (const b of next.hand) {
        if (b === a) continue;
        const k = `${a}>${b}`;
        const x = pairs.get(k) ?? [0, 0];
        x[1]++;
        if (next.card === b) x[0]++;
        pairs.set(k, x);
      }
    }
  }
  for (const d of g.draft ?? []) {
    for (const c of uniq(d.offered)) { if (!C[c]) continue; C[c].offered++; C[c].pickChance += 1 / uniq(d.offered).length; if (c === d.picked) C[c].picked++; }
  }
}

// The measures per card; the scorecard below ranks six of them.
const rows = cards.map((id) => {
  const c = C[id];
  return {
    id,
    pull: c.chosen / c.chance, // played over the rest of the hand, against chance (1 = as often as any card)
    edge: mean(c.edges), // its best play's worth against the best of the rest of the hand (points)
    win: c.baseWin ? c.wins / c.baseWin : NaN, // seats that played it win this many times their table share
    range: effective([...tally(c.ways.filter((w) => w !== 'sway')).values()]), // ways its action is played (sway left out: every card has it)
    sway: c.ways.filter((w) => w === 'sway').length / Math.max(1, c.ways.length),
    places: effective([...tally(c.places).values()]),
    swing: sd(c.ranks), // how much its standing in hand changes turn to turn (0: always the same place)
    dead: c.dead / Math.max(1, c.held), // turns held with no legal action
    draft: c.picked / c.pickChance,
    c,
  };
});
// Strength (designer, 2026-11-07: combine the stats that measure the same thing): the card's mean rank on edge, pull
// and draft (they agree closely across the 21 cards), as a rank 1–21.
const rankBy = (k, dir = -1) => Object.fromEntries([...rows].filter((r) => !isNaN(r[k])).sort((a, b) => dir * (a[k] - b[k])).map((r, i) => [r.id, i + 1]));
const parts = ['edge', 'pull', 'draft'].map((k) => rankBy(k));
for (const r of rows) r.strength = -mean(parts.map((p) => p[r.id]).filter((x) => x !== undefined));
// Timing (designer: whether a card is played early, middle or late in a round, consistently): the seat's plays in a
// round split in thirds; a card is consistent in a third when at least half its plays land there and at least 1.5×
// as often as plays do generally (the middle third holds the most plays in any hand).
const third = (x) => (x < 1 / 3 ? 'early' : x > 2 / 3 ? 'late' : 'mid');
const allOrders = rows.flatMap((r) => r.c.order.filter((x) => !isNaN(x)));
const base = Object.fromEntries(['early', 'mid', 'late'].map((k) => [k, allOrders.filter((x) => third(x) === k).length / allOrders.length]));
for (const r of rows) {
  const o = r.c.order.filter((x) => !isNaN(x));
  const sh = Object.fromEntries(['early', 'mid', 'late'].map((k) => [k, o.length ? o.filter((x) => third(x) === k).length / o.length : NaN]));
  const top = ['early', 'mid', 'late'].sort((a, b) => sh[b] - sh[a])[0];
  r.timing = { sh, top, consistent: sh[top] >= 0.5 && sh[top] >= 1.5 * base[top] };
  r.timingScore = sh.early - sh.late; // for ranking: earliest first
  r.action = 1 - r.sway;
  // Versatility: how many of its ways are its best way, turn to turn (effective count over turns with two or more
  // ways open; 1: one way always best).
  r.versatility = effective(Object.values(r.c.bestWay));
  r.canAct = 1 - r.dead;
  const plays = r.c.ways.length;
  r.empty = plays ? r.c.ways.filter((w) => w === 'empty').length / plays : NaN;
  r.wants = r.c.ablePlays ? 1 - r.c.swayAble / r.c.ablePlays : NaN;
  r.same = r.c.multi ? r.c.same / r.c.multi : NaN;
  const wins = Object.entries(r.c.winBy).sort((a, b) => b[1] - a[1]);
  const decided = wins.reduce((a, [, n]) => a + n, 0);
  r.topReading = decided ? [wins[0][0], wins[0][1] / decided] : null;
  r.distinct = 1 - r.same;
  const ie = mean(r.c.end.island.edges), ve = mean(r.c.end.invaders.edges);
  r.ends = [ie, ve];
  r.endGap = Math.abs(ie - ve);
  // Range ranked within its group: suit cards (two readings) and unsuited ones (their own uses).
  r.group = spec.cards.find((c) => c.id === r.id).suit ? 'suit' : 'unsuited';
}
const FLAG = {
  strength: (v, r) => (r.edge < -0.4 ? 'red' : r.edge > 0.15 ? 'red' : ''),
  pull: (v) => (v < 0.5 ? 'red' : v > 2 ? 'red' : v >= 0.8 && v <= 1.5 ? 'green' : ''),
  edge: (v) => (v < -0.4 ? 'red' : v > 0.15 ? 'red' : ''),
  win: (v) => (v > 1.4 || v < 0.6 ? 'red' : ''),
  canAct: (v, r) => (r.dead > 0.4 || r.empty > 0.15 ? 'red' : r.dead < 0.1 && r.empty < 0.05 ? 'green' : ''),
  wants: (v) => (v < 0.6 ? 'red' : v >= 0.8 ? 'green' : ''),
  distinct: (v, r) => (isNaN(v) ? '' : r.same > 0.7 || (r.topReading && r.topReading[1] > 0.85) ? 'red' : r.same < 0.4 ? 'green' : ''),
  endGap: (v) => (v > 0.1 ? 'red' : v < 0.04 ? 'green' : ''),
  swing: (v) => (v < 0.2 ? 'red' : v > 0.33 ? 'green' : ''),
};
// The scorecard (designer, 2026-11-07: the most actionable measures, one per part of a card, in the order a designer
// fixes one): can it act (its targeting), does it want to (its action's power against its printed sway), which
// reading (rewrite one), strength (its numbers), which ending it serves; timing and swing as context.
const STATS = [
  ['canAct', 'Can act', 'turns held with no legal target · plays with no target (which do nothing)', (v, r) => `${pct(r.dead)}·${pct(r.empty)}`],
  ['wants', 'Wants to', 'plays for its action while it had a legal target (the rest spent for sway)', (v) => (isNaN(v) ? '–' : pct(v))],
  ['distinct', 'Readings', 'turns its readings or uses give the same best play · the one ahead when they differ', (v, r) => (isNaN(v) ? '–' : `${pct(r.same)}·${r.topReading ? `${r.topReading[0].slice(0, 3)} ${pct(r.topReading[1])}` : '–'}`)],
  ['strength', 'Strength', 'worth against the rest of the hand, played over it, drafted (mean rank of the three); edge shown', (v, r) => r.edge.toFixed(2)],
  ['timingScore', 'Timing', `context: its third of the seat's round most often (● consistent); all plays: early ${Math.round(base.early * 100)}%, mid ${Math.round(base.mid * 100)}%, late ${Math.round(base.late * 100)}%`, (v, r) => `${r.timing.consistent ? '●' : ' '}${r.timing.top} ${Math.round(r.timing.sh[r.timing.top] * 100)}%`],
  ['swing', 'Swing', 'context: how much its place in the hand\'s ranking moves turn to turn (sd of rank, 0–0.5; low: automatic)', (v) => v.toFixed(2)],
];
const rank = {};
for (const [k] of STATS) {
  rank[k] = rankBy(k, k === 'endGap' ? 1 : -1);
}
// json=1: the scorecard's rows as JSON (for comparing the stats themselves).
if (opt.json) {
  console.log(JSON.stringify({ turns, base, rows: rows.map((r) => ({ id: r.id, group: r.group, dead: r.dead, empty: r.empty, wants: r.wants, same: r.same, topReading: r.topReading,
    edge: r.edge, strength: r.strength, pull: r.pull, draft: r.draft, swing: r.swing, timing: r.timing, held: r.c.held,
    uses: Object.fromEntries(Object.entries(r.c.use).map(([u, x]) => [u, { open: x.open / Math.max(1, r.c.held), taken: x.chances ? x.taken / x.chances : NaN, edge: mean(r.c.wayEdges[u] ?? []), n: x.open }])) })) }));
  process.exit(0);
}
const mark = (f) => (f === 'red' ? '✗' : f === 'green' ? '✓' : ' ');

// The scorecards (designer, 2026-11-07): one per goal, invader backers and trophy hunters, each from that goal's
// turns alone; each is this script run again with goal= and only=scorecard.
function printScorecard() {
  const who = { invaders: 'invader backers (turns a seat played for the invaders\' ending)', island: 'trophy hunters (turns a seat played for the island\'s ending)' }[opt.goal] ?? 'every turn';
  console.log(`\nScorecard: ${who}; ${turns} turns`);
  console.log(['Card'.padEnd(24), ...STATS.map(([, l]) => l.padEnd(16))].join(''));
  for (const r of rows) {
    const cells = STATS.map(([k, , , fmt]) => `${mark((FLAG[k] ?? (() => ''))(r[k], r))}${fmt(r[k], r)} (${rank[k][r.id] ?? '–'})`.padEnd(16));
    console.log([`${nameOf[r.id]}`.slice(0, 23).padEnd(24), ...cells].join(''));
  }
}
if (opt.only === 'scorecard') {
  printScorecard();
  process.exit(0);
}
console.log(`${games.length} games, ${turns} turns of play (${Math.round((instinct / turns) * 100)}% on instinct, no values), ${withValues} with values for two or more cards.\n`);

// Decisions: how hard the turns are.
const D = (f) => (decisions.length ? decisions.filter(f).length / decisions.length : NaN);
console.log('Decisions (turns with values for two or more cards; gaps as a share of the turn\'s spread)');
console.log(`  one card clearly best (a third of the spread ahead)  ${pct(D((d) => d.gap >= CLEAR))}`);
console.log(`  close (best two cards within a tenth)               ${pct(D((d) => d.gap <= CLOSE))}`);
console.log(`  nothing stands out (every card within a tenth)     ${pct(D((d) => d.flat <= CLOSE))}`);
console.log(`  live cards (within a tenth of the best), mean            ${mean(decisions.map((d) => d.live)).toFixed(1)} of ${mean(decisions.map((d) => d.hand)).toFixed(1)} in hand`);
const byR = [1, 2, 3, 4, 5].map((r) => { const ds = decisions.filter((d) => d.r === r); return `R${r} ${pct(ds.filter((d) => d.gap <= CLOSE).length / ds.length)} close, ${pct(ds.filter((d) => d.gap >= CLEAR).length / ds.length)} clear`; });
console.log(`  by round: ${byR.join(' · ')}`);
const counts = uniq(decisions.map((d) => d.n)).sort();
if (counts.length > 1) console.log(`  by players: ${counts.map((n) => { const ds = decisions.filter((d) => d.n === n); return `${n}p ${pct(ds.filter((d) => d.gap <= CLOSE).length / ds.length)} close`; }).join(' · ')}`);


// The scorecard (designer, 2026-11-07): one row per card, every stat as invader backers · trophy hunters, each from
// that goal's turns alone (this script run again per goal, json=1). ✗ when either side crosses a working line;
// ◆ when the two sides differ by 20 points or more (the card serves one ending); ranks on the weaker side.
const sub = (goal) => {
  const out = spawnSync(process.execPath, [fileURLToPath(import.meta.url), files.join(','), `goal=${goal}`, 'json=1', ...(opt.half !== undefined ? [`half=${opt.half}`] : [])], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (out.status !== 0) { process.stderr.write(out.stderr); process.exit(1); }
  return JSON.parse(out.stdout);
};
const SIDES = opt.goal ? null : { invaders: sub('invaders'), island: sub('island') };
if (SIDES) {
  const byId = (s) => Object.fromEntries(s.rows.map((r) => [r.id, r]));
  const inv = byId(SIDES.invaders), isl = byId(SIDES.island);
  // Each stat: the value read from a side's row, whether higher is healthier, its line, and how a value prints.
  const COLS = [
    ['Can act', 'turns held with a legal target (the rest dead) · empty plays (no target, nothing happens) beside', (r) => 1 - r.dead, 1, (v) => (v < 0.6 ? 'red' : v >= 0.9 ? 'green' : ''), pct, true],
    ['Wants to', 'plays for its action while it had a legal target (the rest spent for sway)', (r) => r.wants, 1, (v) => (v < 0.6 ? 'red' : v >= 0.8 ? 'green' : ''), pct, true],
    ['Readings', 'turns its readings or uses give different best plays (when two or more are open)', (r) => (r.same == null || isNaN(r.same) ? NaN : 1 - r.same), 1, (v) => (v < 0.3 ? 'red' : v >= 0.6 ? 'green' : ''), pct, false],
    ['Strength', 'worth against the best of the rest of the hand (share of the turn\'s spread; 0: level with it)', (r) => r.edge, 1, (v) => (v < -0.4 ? 'red' : v > 0.15 ? 'red' : ''), (v) => v.toFixed(2), false],
    ['Timing', 'context: its third of the seat\'s round most often (● at least half its plays and 1.5× the usual share)', (r) => r.timing, 0, () => '', (v) => `${v.consistent ? '●' : ''}${v.top} ${Math.round(v.sh[v.top] * 100)}%`, false],
    ['Swing', 'context: how much its place in the hand\'s ranking moves turn to turn (sd of rank; under 0.2: automatic)', (r) => r.swing, 1, (v) => (v < 0.2 ? 'red' : v > 0.33 ? 'green' : ''), (v) => v.toFixed(2), false],
  ];
  console.log(`\nScorecard: each cell invader backers · trophy hunters (${SIDES.invaders.turns} and ${SIDES.island.turns} turns); ✗ either side over a working line (Claude's), ✓ both healthy, ◆ the sides 20+ points apart; rank (1 healthiest, on the weaker side)`);
  for (const [label, what] of COLS) console.log(`  ${label.padEnd(9)} ${what}`);
  // Ranks on the weaker side of each stat.
  const ranks = COLS.map(([, , get, dir]) => {
    if (!dir) return {};
    const weak = (id) => Math.min(get(inv[id]), get(isl[id]));
    return Object.fromEntries(cards.filter((id) => !isNaN(weak(id))).sort((a, b) => weak(b) - weak(a)).map((id, i) => [id, i + 1]));
  });
  console.log('');
  console.log(['Card'.padEnd(24), ...COLS.map(([l]) => l.padEnd(l === 'Timing' ? 24 : 18))].join(''));
  for (const id of cards) {
    const cells = COLS.map(([label, , get, dir, flag, fmt, gap], k) => {
      const a = get(inv[id]), b = get(isl[id]);
      const bad = (x) => x != null && (typeof x !== 'number' || !isNaN(x));
      if (!bad(a) && !bad(b)) return '–'.padEnd(18);
      const fa = bad(a) && typeof a === 'number' ? flag(a) : '', fb = bad(b) && typeof b === 'number' ? flag(b) : '';
      const m = fa === 'red' || fb === 'red' ? '✗' : fa === 'green' && fb === 'green' ? '✓' : ' ';
      const apart = gap && typeof a === 'number' && Math.abs(a - b) >= 0.2 ? '◆' : ' ';
      const extra = label === 'Can act' ? ` e${pct(Math.max(inv[id].empty || 0, isl[id].empty || 0))}` : '';
      const s = `${m}${apart}${bad(a) ? fmt(a) : '–'}·${bad(b) ? fmt(b) : '–'}${dir ? ` (${ranks[k][id] ?? '–'})` : ''}${extra}`;
      return s.padEnd(label === 'Timing' ? 24 : 18);
    });
    console.log([nameOf[id].slice(0, 23).padEnd(24), ...cells].join(''));
  }
  // Each card's uses, both sides: how often open when held, how often taken when the card was played with it open,
  // and its strength (one-step, against the rest of the hand).
  console.log('\nUses (readings and unsuited uses; sway and the way back left out): open = held turns it had a legal target; taken = plays of the card that used it, when it was open; strength as above (one-step); invader backers · trophy hunters');
  for (const id of cards) {
    const us = [...new Set([...Object.keys(inv[id].uses), ...Object.keys(isl[id].uses)])].sort();
    if (!us.length) continue;
    const f = (x, k, fm) => (x?.[k] == null || isNaN(x[k]) ? '–' : fm(x[k]));
    const parts = us.map((u) => `${u}: open ${f(inv[id].uses[u], 'open', pct)}·${f(isl[id].uses[u], 'open', pct)}, taken ${f(inv[id].uses[u], 'taken', pct)}·${f(isl[id].uses[u], 'taken', pct)}, strength ${f(inv[id].uses[u], 'edge', (v) => v.toFixed(2))}·${f(isl[id].uses[u], 'edge', (v) => v.toFixed(2))}`);
    console.log(`  ${nameOf[id].padEnd(24)} ${parts.join('  |  ')}`);
  }
  console.log('');
} else {
  console.log('\nScorecard (one goal)');
  printScorecard();
}

// Side tables.
console.log('\nWays each card is played (share of its plays); when: the seat\'s first, a middle or last play of its round (rounds with two or more plays), and its plays by round; by the player\'s goal');
for (const r of rows) {
  const c = r.c;
  const w = [...tally(c.ways).entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${pct(v / c.ways.length)}`).join(', ');
  const goals = Object.entries(c.byGoal).map(([k, v]) => `${k} ${pct(v / c.plays)}`).join(', ');
  const o = c.order.filter((x) => !isNaN(x));
  const timing = o.length ? `first ${pct(o.filter((x) => x === 0).length / o.length)}, mid ${pct(o.filter((x) => x > 0 && x < 1).length / o.length)}, last ${pct(o.filter((x) => x === 1).length / o.length)}` : '–';
  const byRound = [1, 2, 3, 4, 5].map((k) => pct(c.rounds.filter((x) => x === k).length / Math.max(1, c.rounds.length)).padStart(4)).join(' ');
  console.log(`  ${nameOf[r.id].padEnd(24)} ${String(c.plays).padStart(4)} plays · ${w.padEnd(44)} · ${timing.padEnd(30)} · R1–5 ${byRound} · ${goals}`);
}

console.log('\nPairs: a card played next, right after another, by the same seat (lift over how often it follows any card; 8+ chances)');
const follows = new Map();
for (const [k, [hit, n]] of pairs) { const b = k.split('>')[1]; const x = follows.get(b) ?? [0, 0]; x[0] += hit; x[1] += n; follows.set(b, x); }
const lifts = [...pairs].filter(([, [, n]]) => n >= 8).map(([k, [hit, n]]) => { const b = k.split('>')[1]; const [h, t] = follows.get(b); return [k, hit / n / (h / t), hit, n]; }).sort((a, b) => b[1] - a[1]);
for (const [k, lift, hit, n] of lifts.slice(0, 8)) { const [a, b] = k.split('>'); console.log(`  ${nameOf[a]} → ${nameOf[b]}: ${lift.toFixed(1)}× (${hit} of ${n})`); }

if (opt.card) {
  const c = C[opt.card];
  if (!c) { console.error(`no card ${opt.card}`); process.exit(1); }
  console.log(`\n${nameOf[opt.card]} in detail`);
  console.log(`  held on ${c.held} turns, played on ${c.chosen}; passed over on ${c.held - c.chosen}`);
  console.log(`  places: ${[...tally(c.places).entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log(`  edge when played ${mean(c.playedEdges).toFixed(1)} points; edge when held ${mean(c.edges).toFixed(1)}`);
}
