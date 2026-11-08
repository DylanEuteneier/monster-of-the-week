// @ts-nocheck
/**
 * Bot focus and diagnosis: what each kind of seat attends to, round by round, and why it wins or loses (designer,
 * 2026-11-05: metrics of the bots' focus, attention and card plays each round, comparable across profiles, and a
 * diagnostic of why they did better or worse).
 *
 * Part of the measuring tool (scripts/measure.js report=bots). Seats are grouped by profile, or by one setting in it
 * (by=hfrom groups "…,hfrom=2" seats as "hfrom=2"; a seat without it is "hfrom=default"); rounds=0 hides the
 * round-by-round focus.
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

const spec = JSON.parse(readFileSync(new URL('../../public/spec.json', import.meta.url), 'utf8'));
const verbOf = Object.fromEntries(spec.cards.map((c) => [c.id, c.layout?.verb ?? c.action ?? c.id]));
// Factions are cosmetic: each game has one per archetype, so trophies are compared by archetype.
const archetypeOf = Object.fromEntries(spec.factions.map((f) => [f.id, f.archetype]));

/** The bot report: one column per group of seats. Returns its lines. */
export function botReport(games, opt = {}) {
  const out = [];
  const log = (s) => out.push(s);
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

  // Each of a seat's plays, with what it led to that round (needs logs with the plays' mv and the fights' colours):
  // standing and trophies it took directly; trophies (by faction) and standing from the fights where it had placed
  // sway, shared over the seat's plays that added sway there since that location's last fight; and the nightfall tokens
  // its sway brought, shared the same way. Credit by outcome, not intent.
  function effortOf(g, i) {
    const name = Object.keys(g.seats)[i];
    if (!g.plays.length || g.plays[0].mv === undefined || !g.fightLog.every((f) => f.took)) return null;
    // A play that closes the round counts its fights' trophies and standing too: those are credited by sway below.
    const fightsAt = (mv) => g.fightLog.filter((f) => f.mv === mv);
    const direct = (p, key, fk) => p[key].map((x, f) => Math.max(0, x - sum(fightsAt(p.mv).map((F) => (fk === 'took' ? F.took[i][f] : F.winner === f ? F.gotStanding?.[i] ?? 0 : 0)))));
    const mine = g.plays.filter((p) => p.seat === name).map((p) => ({ r: p.r, mv: p.mv, use: p.use, troph: direct(p, 'dTrophies', 'took'), stand: direct(p, 'dStanding', 'standing'), grew: 0, card: p.card }));
    const byMv = new Map(mine.map((m) => [m.mv, m]));
    // Sway placed before play (the opening placement) isn't in the sway log: what it earned goes to its own bucket.
    const opening = { r: 0, troph: [0, 0, 0, 0, 0], stand: [0, 0, 0, 0, 0], grew: 0 };
    // Sway this seat added, by location, since the location's last fight; fights and nightfall, in order (a round's
    // nightfall after its fights).
    const events = [
      ...g.swayLog.filter((x) => x.seat === i && x.after[i] > x.before[i]).map((x) => ({ k: 'sway', at: [x.r, x.mv], loc: x.loc, add: x.after[i] - x.before[i], mv: x.mv, r: x.r })),
      ...g.fightLog.map((f) => ({ k: 'fight', at: [f.r, f.mv], loc: f.loc, f })),
      ...g.nightLog.filter((x) => x.sway[i] > 0).map((x) => ({ k: 'night', at: [x.r, Infinity], loc: x.loc, nt: x })),
    ].sort((a, b) => a.at[0] - b.at[0] || a.at[1] - b.at[1] || (a.k === 'sway' ? -1 : b.k === 'sway' ? 1 : 0));
    const pending = new Map();
    // Share an outcome over the plays that put the seat's sway there (by the sway each added, out of the sway it had
    // there); the rest of its sway there came from the opening.
    const share = (loc, have, fn) => {
      const P = pending.get(loc) ?? [];
      const tot = sum(P.map((x) => x.add));
      const base = Math.max(have, tot);
      if (base <= 0) return;
      for (const x of P) { const m = byMv.get(x.mv); if (m) fn(m, x.add / base); }
      if (tot < base) fn(opening, (base - tot) / base);
    };
    for (const e of events) {
      if (e.k === 'sway') { if (!pending.has(e.loc)) pending.set(e.loc, []); pending.get(e.loc).push(e); continue; }
      if (e.k === 'night') { share(e.loc, e.nt.sway[i], (m, w) => (m.grew += w * e.nt.n)); continue; }
      if (e.f.sway[i] > 0) share(e.loc, e.f.sway[i], (m, w) => { e.f.took[i].forEach((t, f) => (m.troph[f] += w * t)); if (e.f.winner >= 0) m.stand[e.f.winner] += w * (e.f.gotStanding?.[i] ?? 0); });
      if (!(e.f.left?.[i] > 0)) pending.delete(e.loc);
    }
    // The seat's fewest-held colours at each round's start (what island scoring counts).
    for (const m of mine) {
      const t = m.r > 1 ? g.rounds[m.r - 2].seats[i].trophies : [0, 0, 0, 0, 0];
      const low = Math.min(...t);
      m.weak = t.map((x) => x === low);
      m.names = g.factions;
    }
    mine.opening = opening;
    return mine;
  }

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
      rec.moves = effortOf(g, i);
      // Backing a losing faction (invaders' endings): the faction it stood best in at the end, its place in the final
      // presence and its gap to the winner's.
      if (won.length) {
        const st = final[i].standing.map((x, f) => x - final[i].trophies[f]);
        const mine = st.indexOf(Math.max(...st));
        const end = R[R.length - 1].end;
        rec.backed = { right: won.includes(mine) ? 1 : 0, place: 1 + end.filter((x) => x > end[mine]).length, gap: Math.max(...end) - end[mine], stake: st[mine] };
      }
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
  const header = (title) => log(`\n${title}\n${pad('', 34)}${groups.map((g) => pad(g, col)).join('')}`);
  const row = (label, f) => log(pad(label, 34) + groups.map((g) => pad(f(by(g)), col)).join(''));

  log(`${games.length} games, ${seats.length} seat-games; groups: ${groups.map((g) => `${g} (${by(g).length})`).join(', ')}`);

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
  log("  * invaders' endings: standing less trophies in the faction that went on to win; share whose best faction was it");
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

  const withMoves = (S) => S.filter((s) => s.moves);
  if (seats.some((s) => s.moves)) {
    const cls = (m) => {
      const T = sum(m.troph) > 0.05, F = sum(m.stand) > 0.05, N = m.grew > 0.05;
      return T && F ? 'both' : T ? 'trophies' : F ? 'standing' : N ? 'nightfall' : 'nothing';
    };
    const effortRows = (label, keep) => {
      header(`EFFORT${label} (share of its plays, by what they led to that round; credit by outcome)`);
      for (const c of ['trophies', 'standing', 'both', 'nightfall', 'nothing']) {
        row(`  ${c}`, (S) => { const M = withMoves(S).flatMap((s) => s.moves.filter(keep)); return pct(M.filter((m) => cls(m) === c).length / M.length); });
      }
      row('  trophies per play', (S) => { const M = withMoves(S).flatMap((s) => s.moves.filter(keep)); return f2(mean(M.map((m) => sum(m.troph)))); });
      row('  standing per play', (S) => { const M = withMoves(S).flatMap((s) => s.moves.filter(keep)); return f2(mean(M.map((m) => sum(m.stand)))); });
      row('  of trophies: fewest colour', (S) => {
        const M = withMoves(S).flatMap((s) => s.moves.filter(keep));
        const all = sum(M.map((m) => sum(m.troph)));
        return pct(sum(M.map((m) => sum(m.troph.map((t, f) => (m.weak[f] ? t : 0))))) / all);
      });
    };
    effortRows('', () => true);
    row("  trophies from opening sway", (S) => { const W = withMoves(S); const o = sum(W.map((s) => sum(s.moves.opening.troph))); return pct(o / (o + sum(W.flatMap((s) => s.moves.map((m) => sum(m.troph)))))); });
    if (showRounds) for (let r = 1; r <= nRounds; r++) effortRows(`, ROUND ${r}`, (m) => m.r === r);

    header('TROPHY HUNTING BY ARCHETYPE (share of its trophies taken; one faction per archetype each game)');
    for (const a of spec.archetypes.map((x) => x.id ?? x)) {
      row(`  ${a}`, (S) => {
        const M = withMoves(S).flatMap((s) => s.moves);
        const all = sum(M.map((m) => sum(m.troph)));
        return pct(sum(M.map((m) => sum(m.troph.map((t, f) => (archetypeOf[m.names[f]] === a ? t : 0))))) / all);
      });
    }

    header("BACKING A LOSING FACTION (invaders' endings: the faction it stood best in at the end)");
    const B = (S) => S.filter((s) => s.backed);
    row('  backed the winner', (S) => pct(mean(B(S).map((s) => s.backed.right))));
    row('  when wrong: its place', (S) => f1(mean(B(S).filter((s) => !s.backed.right).map((s) => s.backed.place))));
    row('  when wrong: presence gap', (S) => f1(mean(B(S).filter((s) => !s.backed.right).map((s) => s.backed.gap))));
    row('  when wrong: gap ≤ 2 (close)', (S) => pct(mean(B(S).filter((s) => !s.backed.right).map((s) => (s.backed.gap <= 2 ? 1 : 0)))));
    row('  when wrong: its stake there', (S) => f1(mean(B(S).filter((s) => !s.backed.right).map((s) => s.backed.stake))));
    row('  when right: its stake there', (S) => f1(mean(B(S).filter((s) => s.backed.right).map((s) => s.backed.stake))));
  }
  return out;
}
