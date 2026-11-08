// @ts-nocheck
/**
 * The card report (part of scripts/measure.js): how each card plays, from the bots' own decisions. Needs games logged
 * with the card study on (cards=1): every turn of play logs the hand, each card's legal targets, every move the bot
 * weighed (its one-step score and, if shortlisted, its play-out value) and the move made; every draft pick logs the
 * batch offered. With the strength probe on (probe=RATE) it adds each card's controlled worth.
 *
 * The bots' values have no fixed scale (win chances plus margin and threat terms), so gaps are a share of that turn's
 * spread: the best weighed play's value minus the worst's. Bots are the players, so these measure how bots play the
 * cards, not how people will feel about them. Flags are Claude's working lines, not design decisions: they say where
 * to look, never what to change.
 */
import { readFileSync } from 'node:fs';

const spec = JSON.parse(readFileSync(new URL('../../public/spec.json', import.meta.url), 'utf8'));
const cards = spec.cards.map((c) => c.id);
const nameOf = Object.fromEntries(spec.cards.map((c) => [c.id, c.name]));
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const sd = (xs) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const uniq = (xs) => [...new Set(xs)];
const pct = (x) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : '–');
const tally = (xs) => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map());
const GOALS = ['invaders', 'island'];
const goalOf = (t) => (t.goal === 'invaders' || t.goal === 'island' ? t.goal : null);

/** The way a play is used: sway, the way back (any suit card brings its faction's tokens back), the action's reading
 *  (location or faction) or unsuited use, or empty (an action with no target, which does nothing). */
export const way = (m) => (m.type !== 'play' ? 'pass' : m.use === 'return' ? 'way back' : m.use !== 'action' ? m.use : m.target == null ? 'empty' : m.target.use ?? m.target.mode ?? 'action');

// Working lines (Claude's): close is within a tenth of the turn's spread; clear is a third of it or more.
const CLOSE = 0.1, CLEAR = 0.33;
const third = (x) => (x < 1 / 3 ? 'early' : x > 2 / 3 ? 'late' : 'mid');

/** Every measure for every card from the turns that pass `keep` (a goal, or all turns). */
export function analyse(games, keep = () => true) {
  const C = Object.fromEntries(cards.map((c) => [c, { held: 0, chosen: 0, chance: 0, edges: [], ranks: [], dead: 0, ways: [], order: [], rounds: [], plays: 0, offered: 0, picked: 0, pickChance: 0, byGoal: {}, ablePlays: 0, swayAble: 0, multi: 0, same: 0, winBy: {}, use: {}, wayEdges: {}, fx: { n: 0, changed: 0, monsters: 0, nothing: 0 }, probes: [], probesUsed: 0, wins: 0, base: 0, places: [] }]));
  const pairs = new Map(); // "a>b": [b played next by the seat after a, chances]
  const decisions = [];
  let turns = 0, instinct = 0;
  for (const g of games) {
    const n = Object.keys(g.seats).length;
    const seq = new Map();
    const ts = [...(g.cardTurns ?? [])].sort((a, b) => a.mv - b.mv);
    const playAt = new Map((g.plays ?? []).map((p) => [p.mv, p]));
    for (const t of ts) {
      if (!keep(t)) continue;
      turns++;
      if (t.instinct) instinct++;
      const hand = uniq(t.hand);
      const pick = t.chosen.type === 'play' ? t.chosen.card : null;
      for (const c of hand) if (C[c] && t.acts[t.hand.indexOf(c)] === 0) C[c].dead++;
      // Each card's uses open this turn (its readings or unsuited uses among the moves weighed: the bot lists only
      // legal ones; sway, the way back and empty actions left out).
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
      }
      if (pick && C[pick]) {
        const c = C[pick];
        const k = `${t.seat}:${t.r}`;
        if (!seq.has(k)) seq.set(k, []);
        seq.get(k).push({ card: pick, hand });
        // Wants to act: of its plays while its action had a legal target, how many were spent for sway instead.
        if (t.acts[t.hand.indexOf(pick)] > 0) { c.ablePlays++; if (t.chosen.use === 'sway') c.swayAble++; }
        c.ways.push(way(t.chosen));
        c.rounds.push(t.r);
        c.plays++;
        c.byGoal[t.goal ?? 'none'] = (c.byGoal[t.goal ?? 'none'] ?? 0) + 1;
        // Win share (a check, not a lever: noisy and tied to the seat's goal): its players' wins against their share.
        c.base += 1 / n;
        if (g.winners.includes(t.seat)) c.wins++;
        const at = t.chosen.target?.location ?? t.chosen.target?.to;
        if (at) c.places.push(at);
        // Footprint (the game log's play effects): did its action change the board, by how many monsters.
        const p = playAt.get(t.mv);
        if (p && p.use === 'action' && !p.closed) {
          c.fx.n++;
          const m = (p.moved ?? 0) + sum(p.dPresence.map((d) => Math.max(0, -d)));
          if (m) { c.fx.changed++; c.fx.monsters += m; }
          if (!m && !p.placed && !p.dStanding.some(Boolean) && !p.dTrophies.some(Boolean)) c.fx.nothing++;
        }
      }
      // Worth against the hand: each card's best play-out value this turn (its shortlisted options; a card with
      // none counted at the weakest shortlisted value).
      const best = {};
      for (const [m, , v] of t.options) if (v != null && m.type === 'play') best[m.card] = Math.max(best[m.card] ?? -Infinity, v);
      const all = t.options.map((o) => o[2]).filter((v) => v != null);
      const spread = Math.max(...all) - Math.min(...all);
      if (hand.filter((c) => best[c] !== undefined).length >= 2 && spread > 0) {
        const floor = Math.min(...all);
        const worth = Object.fromEntries(hand.map((c) => [c, best[c] ?? floor]));
        const order = [...hand].sort((a, b) => worth[b] - worth[a]);
        const gap = (a, b) => (worth[a] - worth[b]) / spread;
        decisions.push({ r: t.r, n, gap: gap(order[0], order[1]), flat: gap(order[0], order.at(-1)), live: hand.filter((c) => gap(order[0], c) <= CLOSE).length, hand: hand.length });
        for (const c of hand) {
          if (!C[c]) continue;
          C[c].edges.push((worth[c] - Math.max(...hand.filter((x) => x !== c).map((x) => worth[x]))) / spread);
          C[c].ranks.push(order.indexOf(c) / (hand.length - 1));
        }
        // Each use compared on the one-step score every option has (play-out values exist only for the shortlist):
        // its best against the best of the rest of the hand, and whether a card's readings give different best plays.
        const qs = t.options.map((o) => o[1]);
        const qSpread = Math.max(...qs) - Math.min(...qs);
        const byWay = {}, cardQ = {};
        for (const [m, q] of t.options) {
          if (m.type !== 'play') continue;
          cardQ[m.card] = Math.max(cardQ[m.card] ?? -Infinity, q);
          const w = way(m);
          if (w === 'sway' || w === 'empty' || w === 'way back' || !C[m.card]) continue;
          (byWay[m.card] ??= {})[w] = Math.max(byWay[m.card][w] ?? -Infinity, q);
        }
        if (qSpread > 0) for (const [c, ws] of Object.entries(byWay)) {
          if (!hand.includes(c)) continue;
          const rest = Math.max(...hand.filter((x) => x !== c).map((x) => cardQ[x] ?? -Infinity));
          if (!Number.isFinite(rest)) continue;
          for (const [w, v] of Object.entries(ws)) (C[c].wayEdges[w] ??= []).push((v - rest) / qSpread);
          const own = Object.keys(ws);
          if (own.length >= 2) {
            C[c].multi++;
            const top = Math.max(...own.map((w) => ws[w]));
            const tops = own.filter((w) => ws[w] === top);
            if (tops.length === own.length) C[c].same++;
            else for (const w of tops) C[c].winBy[w] = (C[c].winBy[w] ?? 0) + 1 / tops.length;
          }
        }
      }
    }
    // Timing within the seat's round, and which card follows which (held at the time).
    for (const plays of seq.values()) {
      plays.forEach((p, i) => { if (plays.length > 1) C[p.card].order.push(i / (plays.length - 1)); });
      for (let i = 0; i + 1 < plays.length; i++) {
        const a = plays[i].card, next = plays[i + 1];
        for (const b of next.hand) {
          if (b === a) continue;
          const x = pairs.get(`${a}>${b}`) ?? [0, 0];
          x[1]++;
          if (next.card === b) x[0]++;
          pairs.set(`${a}>${b}`, x);
        }
      }
    }
    for (const d of g.draft ?? []) for (const c of uniq(d.offered)) {
      if (!C[c]) continue;
      C[c].offered++; C[c].pickChance += 1 / uniq(d.offered).length; if (c === d.picked) C[c].picked++;
    }
    for (const p of g.probes ?? []) {
      if (!C[p.card] || !keep(p)) continue;
      C[p.card].probes.push(p.benefit);
      if (p.used) C[p.card].probesUsed++;
    }
  }
  const allOrders = cards.flatMap((id) => C[id].order);
  const base = Object.fromEntries(['early', 'mid', 'late'].map((k) => [k, allOrders.filter((x) => third(x) === k).length / allOrders.length]));
  const rows = Object.fromEntries(cards.map((id) => {
    const c = C[id];
    const sh = Object.fromEntries(['early', 'mid', 'late'].map((k) => [k, c.order.length ? c.order.filter((x) => third(x) === k).length / c.order.length : NaN]));
    const top = ['early', 'mid', 'late'].sort((a, b) => sh[b] - sh[a])[0];
    const wins = Object.entries(c.winBy).sort((a, b) => b[1] - a[1]);
    const decided = sum(wins.map(([, x]) => x));
    const plays = c.ways.length;
    return [id, {
      id, c, held: c.held,
      dead: c.dead / Math.max(1, c.held),
      empty: plays ? c.ways.filter((w) => w === 'empty').length / plays : NaN,
      wants: c.ablePlays ? 1 - c.swayAble / c.ablePlays : NaN,
      distinct: c.multi ? 1 - c.same / c.multi : NaN,
      topReading: decided ? [wins[0][0], wins[0][1] / decided] : null,
      edge: mean(c.edges),
      pull: c.chosen / c.chance,
      draft: c.picked / c.pickChance,
      swing: sd(c.ranks),
      timing: { sh, top, consistent: sh[top] >= 0.5 && sh[top] >= 1.5 * base[top] },
      win: c.base ? c.wins / c.base : NaN,
      places: c.places.length ? Math.exp(-[...tally(c.places).values()].reduce((h, k) => h + (k / c.places.length) * Math.log(k / c.places.length), 0)) : NaN,
      probe: mean(c.probes), probeN: c.probes.length, probeUsed: c.probes.length ? c.probesUsed / c.probes.length : NaN,
      uses: Object.fromEntries(Object.entries(c.use).map(([u, x]) => [u, { open: x.open / Math.max(1, c.held), taken: x.chances ? x.taken / x.chances : NaN, edge: mean(c.wayEdges[u] ?? []) }])),
    }];
  }));
  return { rows, base, turns, instinct, decisions, pairs };
}

/** The card report as lines. opt: card (one card in detail). */
export function cardReport(games, opt = {}) {
  const out = [];
  const log = (s = '') => out.push(s);
  if (!games.some((g) => g.cardTurns?.length)) return ['Cards: no card study in these games (run with cards=1).'];
  const all = analyse(games);
  const side = Object.fromEntries(GOALS.map((goal) => [goal, analyse(games, (t) => goalOf(t) === goal)]));
  log(`CARDS · ${games.length} games, ${all.turns} turns of play (${pct(all.instinct / all.turns)} on instinct, no values)`);

  // How hard the turns are.
  const ds = all.decisions;
  const D = (f, xs = ds) => (xs.length ? xs.filter(f).length / xs.length : NaN);
  log('\nTurns (with values for two or more cards; gaps as a share of the turn\'s spread)');
  log(`  one card clearly best (a third of the spread ahead)  ${pct(D((d) => d.gap >= CLEAR))}`);
  log(`  close (best two cards within a tenth)                ${pct(D((d) => d.gap <= CLOSE))}`);
  log(`  nothing stands out (every card within a tenth)       ${pct(D((d) => d.flat <= CLOSE))}`);
  log(`  live cards (within a tenth of the best), mean        ${mean(ds.map((d) => d.live)).toFixed(1)} of ${mean(ds.map((d) => d.hand)).toFixed(1)} in hand`);
  log(`  by round: ${[1, 2, 3, 4, 5].map((r) => { const x = ds.filter((d) => d.r === r); return `R${r} ${pct(D((d) => d.gap <= CLOSE, x))} close, ${pct(D((d) => d.gap >= CLEAR, x))} clear`; }).join(' · ')}`);
  const counts = uniq(ds.map((d) => d.n)).sort();
  if (counts.length > 1) log(`  by players: ${counts.map((n) => { const x = ds.filter((d) => d.n === n); return `${n}p ${pct(D((d) => d.gap <= CLOSE, x))} close, ${pct(D((d) => d.gap >= CLEAR, x))} clear`; }).join(' · ')}`);

  // The scorecard (designer, 2026-11-07): the most actionable measures, one per part of a card, in the order a
  // designer fixes one; every cell invader backers · trophy hunters, each from that goal's turns alone.
  const probed = cards.some((id) => side.invaders.rows[id].probeN + side.island.rows[id].probeN > 0);
  const COLS = [
    ['Can act', 'turns held with a legal target (the rest dead) → its targeting; e: the most plays with no target (nothing happens)', (r) => 1 - r.dead, (v) => (v < 0.6 ? 'red' : v >= 0.9 ? 'green' : ''), pct, true],
    ['Wants to', 'plays for its action while it had a legal target (the rest spent for sway) → its power against its printed sway', (r) => r.wants, (v) => (v < 0.6 ? 'red' : v >= 0.8 ? 'green' : ''), pct, true],
    ['Readings', 'turns its readings or uses give different best plays (two or more open) → rewrite one', (r) => r.distinct, (v) => (v < 0.3 ? 'red' : v >= 0.6 ? 'green' : ''), pct, false],
    ['Strength', 'worth against the best of the rest of the hand (share of the turn\'s spread; 0 level) → its numbers', (r) => r.edge, (v) => (v < -0.4 || v > 0.15 ? 'red' : ''), (v) => v.toFixed(2), false],
    ...(probed ? [['Probe', 'controlled worth: the seat\'s value holding it minus not (same moment, same luck; the probe)', (r) => r.probe, () => '', (v) => v.toFixed(2), false]] : []),
    ['Timing', 'context: its third of the seat\'s round most often (● at least half its plays and 1.5× the usual share)', (r) => r.timing, null, (v) => `${v.consistent ? '●' : ''}${v.top} ${Math.round(v.sh[v.top] * 100)}%`, false],
    ['Swing', 'context: how much its place in the hand\'s ranking moves (sd of rank; under 0.2 automatic; noise among suit cards)', (r) => r.swing, (v) => (v < 0.2 ? 'red' : v > 0.33 ? 'green' : ''), (v) => v.toFixed(2), false],
  ];
  const inv = side.invaders.rows, isl = side.island.rows;
  log(`\nScorecard · each cell invader backers · trophy hunters (${side.invaders.turns} and ${side.island.turns} turns) · ✗ either side over a working line (Claude's), ✓ both healthy, ◆ the sides 20+ points apart · (rank, 1 healthiest, on the weaker side)`);
  for (const [label, what] of COLS) log(`  ${label.padEnd(9)} ${what}`);
  const ok = (x) => x != null && (typeof x !== 'number' || !Number.isNaN(x));
  const ranks = COLS.map(([, , get, flag]) => {
    if (!flag) return {};
    const weak = (id) => Math.min(get(inv[id]), get(isl[id]));
    return Object.fromEntries(cards.filter((id) => !Number.isNaN(weak(id))).sort((a, b) => weak(b) - weak(a)).map((id, i) => [id, i + 1]));
  });
  const width = (l) => (l === 'Timing' ? 24 : l === 'Can act' ? 22 : 18);
  log('');
  log(['Card'.padEnd(24), ...COLS.map(([l]) => l.padEnd(width(l)))].join(''));
  for (const id of cards) {
    const cells = COLS.map(([label, , get, flag, fmt, gap], k) => {
      const a = get(inv[id]), b = get(isl[id]);
      if (!ok(a) && !ok(b)) return '–'.padEnd(width(label));
      const fa = flag && typeof a === 'number' && ok(a) ? flag(a) : '', fb = flag && typeof b === 'number' && ok(b) ? flag(b) : '';
      const m = fa === 'red' || fb === 'red' ? '✗' : fa === 'green' && fb === 'green' ? '✓' : ' ';
      const apart = gap && ok(a) && ok(b) && Math.abs(a - b) >= 0.2 ? '◆' : ' ';
      const extra = label === 'Can act' ? ` e${pct(Math.max(inv[id].empty || 0, isl[id].empty || 0))}` : '';
      return `${m}${apart}${ok(a) ? fmt(a) : '–'}·${ok(b) ? fmt(b) : '–'}${flag ? ` (${ranks[k][id] ?? '–'})` : ''}${extra}`.padEnd(width(label));
    });
    log([nameOf[id].slice(0, 23).padEnd(24), ...cells].join(''));
  }

  // Each card's uses, both sides.
  log('\nUses (readings and unsuited uses; sway and the way back left out) · open: held turns it had a legal target · taken: plays of the card that used it, when open · strength: one-step, against the rest of the hand · invader backers · trophy hunters');
  const f = (x, k, fm) => (x?.[k] == null || Number.isNaN(x[k]) ? '–' : fm(x[k]));
  for (const id of cards) {
    const us = uniq([...Object.keys(inv[id].uses), ...Object.keys(isl[id].uses)]).sort();
    if (!us.length) continue;
    log(`  ${nameOf[id].padEnd(24)} ${us.map((u) => `${u}: open ${f(inv[id].uses[u], 'open', pct)}·${f(isl[id].uses[u], 'open', pct)}, taken ${f(inv[id].uses[u], 'taken', pct)}·${f(isl[id].uses[u], 'taken', pct)}, strength ${f(inv[id].uses[u], 'edge', (v) => v.toFixed(2))}·${f(isl[id].uses[u], 'edge', (v) => v.toFixed(2))}`).join('  |  ')}`);
  }

  // Detail on every turn: how each card is played, its footprint, when, by whom, and drafting.
  log('\nDetail (all turns) · ways played (share of its plays) · places: how many locations it targets (effective count) · footprint: its action changed the board, monsters per change, did nothing · when: first/middle/last of the seat\'s round, plays by round · drafted against chance · win share: its players\' wins against their table share (a check: noisy, tied to goals) · played by goal');
  for (const id of cards) {
    const r = all.rows[id], c = r.c;
    const w = [...tally(c.ways).entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${pct(v / c.ways.length)}`).join(', ');
    const fx = c.fx.n ? `board ${pct(c.fx.changed / c.fx.n)}, ${(c.fx.monsters / Math.max(1, c.fx.changed)).toFixed(1)}/change, nothing ${pct(c.fx.nothing / c.fx.n)}` : '–';
    const o = c.order;
    const when = o.length ? `first ${pct(o.filter((x) => x === 0).length / o.length)}, mid ${pct(o.filter((x) => x > 0 && x < 1).length / o.length)}, last ${pct(o.filter((x) => x === 1).length / o.length)}` : '–';
    const byRound = [1, 2, 3, 4, 5].map((k) => pct(c.rounds.filter((x) => x === k).length / Math.max(1, c.rounds.length)).padStart(4)).join(' ');
    const goals = Object.entries(c.byGoal).map(([k, v]) => `${k} ${pct(v / c.plays)}`).join(', ');
    log(`  ${nameOf[id].padEnd(24)} ${String(c.plays).padStart(4)} plays · ${w} · places ${Number.isFinite(r.places) ? r.places.toFixed(1) : '–'} · ${fx} · ${when} · R1–5 ${byRound} · draft ${Number.isFinite(r.draft) ? r.draft.toFixed(2) : '–'}× · win ${Number.isFinite(r.win) ? r.win.toFixed(2) : '–'}× · ${goals}`);
  }
  if (probed) {
    log('\nProbe (controlled tests, both goals) · worth holding it (mean) · share of tests where holding it helped · the bot played it when it had it · tests');
    for (const id of cards) {
      const r = all.rows[id];
      if (!r.probeN) continue;
      log(`  ${nameOf[id].padEnd(24)} ${r.probe.toFixed(2).padStart(6)} · helped ${pct(r.c.probes.filter((v) => v > 0).length / r.probeN)} · played ${pct(r.probeUsed)} · ${r.probeN}`);
    }
  }

  // Pairs: a card played right after another by the same seat, against how often it follows any card.
  log('\nPairs · a card played next, right after another, by the same seat (lift over how often it follows any card; 8+ chances)');
  const follows = new Map();
  for (const [k, [hit, n]] of all.pairs) { const b = k.split('>')[1]; const x = follows.get(b) ?? [0, 0]; x[0] += hit; x[1] += n; follows.set(b, x); }
  const lifts = [...all.pairs].filter(([, [, n]]) => n >= 8).map(([k, [hit, n]]) => { const [h, t] = follows.get(k.split('>')[1]); return [k, hit / n / (h / t), hit, n]; }).sort((a, b) => b[1] - a[1]);
  for (const [k, lift, hit, n] of lifts.slice(0, 8)) { const [a, b] = k.split('>'); log(`  ${nameOf[a]} → ${nameOf[b]}: ${lift.toFixed(1)}× (${hit} of ${n})`); }

  if (opt.card) {
    const r = all.rows[opt.card];
    if (!r) return [...out, `no card ${opt.card}`];
    log(`\n${nameOf[opt.card]} in detail: held on ${r.held} turns, played on ${r.c.chosen}; dead ${pct(r.dead)}; readings ahead when they differ: ${r.topReading ? `${r.topReading[0]} ${pct(r.topReading[1])}` : '–'}; pull ${r.pull.toFixed(2)}× against chance`);
  }
  return out;
}

/** Each stat's split-half agreement: the cards ranked on even games against odd ones (rank correlation, per goal). */
export function cardAgreement(games) {
  const halves = [games.filter((_, i) => i % 2 === 0), games.filter((_, i) => i % 2 === 1)];
  const rank = (xs) => { const s = xs.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]); const o = []; s.forEach(([, i], k) => { o[i] = k; }); return o; };
  const cor = (a, b) => {
    const p = a.map((x, i) => [x, b[i]]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    if (p.length < 4) return NaN;
    const ra = rank(p.map((x) => x[0])), rb = rank(p.map((x) => x[1]));
    const ma = mean(ra), mb = mean(rb);
    return sum(ra.map((x, i) => (x - ma) * (rb[i] - mb))) / Math.sqrt(sum(ra.map((x) => (x - ma) ** 2)) * sum(rb.map((y) => (y - mb) ** 2)));
  };
  const stats = { 'Can act': (r) => 1 - r.dead, 'Wants to': (r) => r.wants, Readings: (r) => r.distinct, Strength: (r) => r.edge, Probe: (r) => r.probe, Timing: (r) => r.timing.sh.early - r.timing.sh.late, Swing: (r) => r.swing };
  const out = ['\nAgreement · each stat ranks the cards the same way on even and odd games (1 = same order; under about 0.7, read with care)'];
  for (const goal of GOALS) {
    const [a, b] = halves.map((h) => analyse(h, (t) => goalOf(t) === goal).rows);
    out.push(`  ${goal.padEnd(9)} ${Object.entries(stats).map(([k, fn]) => { const v = cor(cards.map((id) => fn(a[id])), cards.map((id) => fn(b[id]))); return `${k} ${Number.isFinite(v) ? v.toFixed(2) : '–'}`; }).join(' · ')}`);
  }
  return out;
}
