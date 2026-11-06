// @ts-nocheck
/**
 * Bot focus and diagnosis: what each kind of seat attends to, round by round, and why it wins or loses (designer,
 * 2026-11-05: metrics of the bots' focus, attention and card plays each round, comparable across profiles, and a
 * diagnostic of why they did better or worse).
 *
 * Reads the native runner's logs (`motw tournament ... log=X.jsonl`). Seats are grouped by profile, or by one setting
 * in it (by=hfrom groups "…,hfrom=2" seats as "hfrom=2"; a seat without it is "hfrom=default").
 *
 *   node scripts/bot-focus.js a.jsonl[,b.jsonl] [by=hfrom] [rounds=1]
 *
 * Focus (per seat-game, by round): its goal and invaders' chance, what it played (uses, card verbs), sway placed,
 * tokens it placed and moved, standing and trophies gained from its own plays and from the rest of the round
 * (fights, nightfall), what its plays did to its own faction's presence (the faction it stands best in) and to the
 * others', and the fights it had sway in.
 * Diagnosis: win share overall and by ending; its score against the winner's in each ending; where it stood after
 * each round on both endings' scoring (island: its fewest-held trophy colour; invaders: its standing less trophies
 * in the faction then leading presence), as a rank among the seats; and whether its last goal matched the ending.
 */
import { readFileSync } from 'node:fs';

const spec = JSON.parse(readFileSync(new URL('../public/spec.json', import.meta.url), 'utf8'));
const verbOf = Object.fromEntries(spec.cards.map((c) => [c.id, c.layout?.verb ?? c.action ?? c.id]));
const args = process.argv.slice(2);
const opt = Object.fromEntries(args.filter((a) => /^(by|rounds)=/.test(a)).map((a) => a.split('=')));
const files = args.filter((a) => !/^(by|rounds)=/.test(a)).flatMap((a) => a.split(','));
if (!files.length) { console.error('usage: node scripts/bot-focus.js a.jsonl[,b.jsonl] [by=setting] [rounds=1]'); process.exit(1); }
const games = files.flatMap((f) => readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));

const groupOf = (profile) => {
  if (!opt.by) return profile;
  const m = profile.match(new RegExp(`(?:^|[,:])${opt.by}=([^,;]+)`));
  return `${opt.by}=${m ? m[1] : 'default'}`;
};
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : '·');
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '·');
const pct = (x) => (Number.isFinite(x) ? `${Math.round(100 * x)}%` : '·');
const islandScore = (t) => [...t].sort((a, b) => a - b)[0];
const leader = (presence) => presence.indexOf(Math.max(...presence));

// One record per seat-game.
const seats = [];
for (const g of games) {
  const names = Object.keys(g.seats);
  const n = names.length;
  const R = g.rounds;
  const final = R[R.length - 1].seats;
  // The faction(s) that took the island, by slot (invaders' endings): what standing was worth in the end.
  const won = (g.wonBy ?? []).map((f) => g.factions.indexOf(f)).filter((f) => f >= 0);
  for (let i = 0; i < n; i++) {
    const name = names[i];
    const rec = { group: groupOf(g.seats[name]), win: g.winners.includes(name) ? 1 / g.winners.length : 0, side: g.side, rounds: [] };
    rec.score = g.scores[i];
    rec.best = Math.max(...g.scores);
    rec.lastGoal = final[i].goal;
    rec.broke = R.findIndex((r) => r.seats[i].broke) + 1 || null;
    for (let r = 0; r < R.length; r++) {
      const now = R[r].seats[i];
      const prev = r ? R[r - 1].seats[i] : { standing: [0, 0, 0, 0, 0], trophies: [0, 0, 0, 0, 0] };
      const plays = g.plays.filter((p) => p.r === r + 1 && p.seat === name);
      const own = prev.standing.map((s, f) => s - prev.trophies[f]);
      const mine = own.indexOf(Math.max(...own)); // the faction it stands best in going into the round
      const pStand = sum(plays.map((p) => sum(p.dStanding)));
      const pTroph = sum(plays.map((p) => sum(p.dTrophies)));
      const dStand = sum(now.standing) - sum(prev.standing);
      const dTroph = sum(now.trophies) - sum(prev.trophies);
      const lead = leader(R[r].end);
      const isl = R[r].seats.map((s) => islandScore(s.trophies));
      const inv = R[r].seats.map((s) => s.standing[lead] - s.trophies[lead]);
      const rank = (xs) => 1 + xs.filter((x) => x > xs[i]).length;
      rec.rounds.push({
        goalInv: now.goal === 'invaders' ? 1 : 0,
        pInv: now.pInvaders,
        plays: plays.length,
        uses: Object.fromEntries(['action', 'sway', 'return'].map((u) => [u, plays.filter((p) => p.use === u).length])),
        verbs: plays.filter((p) => p.use === 'action').map((p) => verbOf[p.card] ?? p.card),
        sway: g.swayLog.filter((x) => x.r === r + 1 && x.seat === i).length,
        placed: sum(plays.map((p) => p.placed ?? 0)),
        moved: sum(plays.map((p) => p.moved ?? 0)),
        standPlays: pStand, standRest: dStand - pStand,
        trophPlays: pTroph, trophRest: dTroph - pTroph,
        ownPresence: sum(plays.map((p) => p.dPresence[mine])),
        otherPresence: sum(plays.map((p) => sum(p.dPresence) - p.dPresence[mine])),
        fights: g.fightLog.filter((x) => x.r === r + 1 && x.sway[i] > 0).length,
        islRank: rank(isl), invRank: rank(inv), isl: isl[i], inv: inv[i],
        colours: now.trophies.filter((t) => t > 0).length,
        // Standing less trophies in the faction that went on to win (invaders' endings), and whether the faction it
        // stood best in was that one.
        wonStand: won.length ? Math.max(...won.map((f) => now.standing[f] - now.trophies[f])) : null,
        backedWinner: won.length ? (won.includes(((a) => a.indexOf(Math.max(...a)))(now.standing.map((x, f) => x - now.trophies[f]))) ? 1 : 0) : null,
      });
    }
    seats.push(rec);
  }
}

const groups = [...new Set(seats.map((s) => s.group))].sort();
const by = (g) => seats.filter((s) => s.group === g);
const nRounds = Math.max(...games.map((g) => g.rounds.length));
const pad = (s, w) => String(s).padEnd(w);
const col = 16;
const header = (title) => console.log(`\n${title}\n${pad('', 34)}${groups.map((g) => pad(g, col)).join('')}`);
const row = (label, f) => console.log(pad(label, 34) + groups.map((g) => pad(f(by(g)), col)).join(''));

console.log(`${games.length} games, ${seats.length} seat-games; groups: ${groups.map((g) => `${g} (${by(g).length})`).join(', ')}`);

header('DIAGNOSIS');
row('win share', (S) => pct(mean(S.map((s) => s.win))));
for (const side of ['island', 'invaders']) {
  row(`  in ${side} endings`, (S) => { const T = S.filter((s) => s.side === side); return `${pct(mean(T.map((s) => s.win)))} of ${T.length}`; });
  row(`  score / winner's (${side})`, (S) => { const T = S.filter((s) => s.side === side); return `${f1(mean(T.map((s) => s.score)))}/${f1(mean(T.map((s) => s.best)))}`; });
}
row('last goal matched ending', (S) => pct(mean(S.map((s) => (s.lastGoal === s.side ? 1 : 0)))));
row('committed (broke) by round', (S) => { const B = S.filter((s) => s.broke); return B.length ? `${pct(B.length / S.length)} r${f1(mean(B.map((s) => s.broke)))}` : 'never'; });
const at = (S, r, k, only) => mean(S.filter((s) => s.rounds[r] && (!only || s.side === only) && s.rounds[r][k] !== null).map((s) => s.rounds[r][k]));
for (let r = 0; r < nRounds; r++) {
  row(`after r${r + 1}: fewest colour / held`, (S) => `${f2(at(S, r, 'isl'))} / ${f1(at(S, r, 'colours'))}`);
  row(`  invaders rank (leader)`, (S) => f2(at(S, r, 'invRank')));
  row(`  in winning faction*`, (S) => `${f1(at(S, r, 'wonStand', 'invaders'))} ${pct(at(S, r, 'backedWinner', 'invaders'))}`);
}
console.log("  * invaders' endings: standing less trophies in the faction that went on to win; share whose best faction was it");
row('final island rank: winners', (S) => f2(mean(S.filter((s) => s.win > 0).map((s) => s.rounds.at(-1).islRank))));
row('final island rank: losers', (S) => f2(mean(S.filter((s) => s.win === 0).map((s) => s.rounds.at(-1).islRank))));

const showRounds = opt.rounds !== '0';
const focus = [
  ['backing invaders', (x) => x.goalInv, pct],
  ["invaders' chance read", (x) => x.pInv, f2],
  ['plays', (x) => x.plays, f1],
  ['  action / sway / return', (x) => x, null],
  ['sway placed', (x) => x.sway, f1],
  ['tokens placed', (x) => x.placed, f1],
  ['tokens moved', (x) => x.moved, f1],
  ['standing: plays / rest', (x) => x, 'stand'],
  ['trophies: plays / rest', (x) => x, 'troph'],
  ['own faction presence', (x) => x.ownPresence, f1],
  ['other factions presence', (x) => x.otherPresence, f1],
  ['fights with sway in', (x) => x.fights, f1],
];
const cell = (S, r, [_, get, fmt]) => {
  const X = S.filter((s) => s.rounds[r]).map((s) => s.rounds[r]);
  if (fmt === null) return ['action', 'sway', 'return'].map((u) => f1(mean(X.map((x) => x.uses[u])))).join('/');
  if (fmt === 'stand') return `${f1(mean(X.map((x) => x.standPlays)))}/${f1(mean(X.map((x) => x.standRest)))}`;
  if (fmt === 'troph') return `${f1(mean(X.map((x) => x.trophPlays)))}/${f1(mean(X.map((x) => x.trophRest)))}`;
  return fmt(mean(X.map(get)));
};
if (showRounds) {
  for (let r = 0; r < nRounds; r++) {
    header(`FOCUS, ROUND ${r + 1} (per seat-game)`);
    for (const m of focus) row(m[0], (S) => cell(S, r, m));
    row('top card verbs (action)', (S) => {
      const c = {};
      for (const s of S) for (const v of s.rounds[r]?.verbs ?? []) c[v] = (c[v] ?? 0) + 1;
      return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([v, k]) => `${v} ${f1(k / S.length)}`).join(' ');
    });
  }
}
