// @ts-check
/**
 * How well the bots' judgement predicts who wins, and what a fitted judgement
 * would do (a measuring tool, not rules; 2026-10-10, from the bot tuning
 * research: fit the evaluation to logged outcomes, as chess engines do with
 * Texel tuning). From tournament logs with features (bots.js `features`, each
 * seat at the start of each round's play), for each round it fits a table
 * model: P(seat i wins) = exp(w·x_i) / Σ_j exp(w·x_j), so only differences
 * between seats count. Held out: five folds by deal (games g/5, so a duplicate
 * deal's games stay together, across logs run on the same seed). Reports the
 * cross-validated log-loss of the bots' own forecast, of an even split, and of
 * the fitted model, and the
 * fitted weights (standardised: a weight's size is how much one standard
 * deviation of that feature moves the odds).
 *
 *   node scripts/fit.mjs log.jsonl [log.jsonl ...] [features=a,b,c] [l2=0.05] [out=public/eval-fit.json]
 *
 * With out=, writes each round's fitted weights (with the means and spreads
 * they were standardised by) for the bots' `fit` switch.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const files = args.filter((a) => !a.includes('='));
const opts = Object.fromEntries(args.filter((a) => a.includes('=')).map((a) => a.split('=')));
const l2 = Number(opts.l2 ?? 0.05);

/** @typedef {{ fold: number, seats: { x: Record<string, number>, p: number, y: number }[] }} Table */
/** @type {Record<number, Table[]>} */
const byRound = {};
let games = 0;
for (const f of files) for (const line of readFileSync(f, 'utf8').split('\n').filter(Boolean)) {
  const r = JSON.parse(line);
  const fc = (r.forecasts ?? []).filter((/** @type {any} */ x) => x.f);
  if (!fc.length) continue;
  games += 1;
  /** @type {Record<number, Table>} */
  const tables = {};
  // Derived features older logs lack (bots.js features): each ending's win chance, and a rival's through the invaders.
  for (const x of fc) x.f.isBacker = String(r.seats[x.seat]).startsWith('backer') ? 1 : 0; // a control: the profile, not the position
  for (const x of fc) { x.f.invWin ??= x.f.pInvaders * x.f.asInvaders; x.f.islWin ??= (1 - x.f.pInvaders) * x.f.asIsland; x.f.rivalWin ??= x.f.pInvaders * x.f.rivalInvaders; }
  for (const x of fc) (tables[x.r] ??= { fold: Math.floor(r.g / 5) % 5, seats: [] }).seats.push({ x: x.f, p: x.p / 100, y: r.winners.includes(x.seat) ? 1 / r.winners.length : 0 });
  for (const [round, t] of Object.entries(tables)) (byRound[Number(round)] ??= []).push(t);
}
if (!games) throw new Error('no games with features in these logs');
const names = opts.features ? opts.features.split(',') : Object.keys(Object.values(byRound)[0][0].seats[0].x).filter((k) => !['roundsLeft', 'pInvaders', 'projected'].includes(k)); // table-level: the same for every seat, so they cancel
console.log(`${games} games with features (${files.join(', ')}); l2 ${l2}`);
/** @type {Record<string, { mean: number[], sd: number[], w: number[] }>} */
const fitted_ = {};

/** Log-loss of a table's predicted shares against the winners. @param {Table} t @param {number[]} q */
const loss = (t, q) => -t.seats.reduce((a, s, i) => a + s.y * Math.log(Math.max(1e-6, q[i])), 0);
/** Solves A x = b (Gaussian elimination with partial pivoting). @param {number[][]} A @param {number[]} b */
function solve(A, b) {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((row, i) => row[n] / row[i]);
}
const r4 = (/** @type {number} */ x) => Math.round(x * 10000) / 10000;
const softmax = (/** @type {number[]} */ z) => { const m = Math.max(...z); const e = z.map((v) => Math.exp(v - m)); const sum = e.reduce((a, b) => a + b, 0); return e.map((v) => v / sum); };

for (const [round, tables] of Object.entries(byRound)) {
  // Standardise each feature (differences within a table are what count, so centring per table is implied by the softmax).
  const mean = names.map((k) => tables.flatMap((t) => t.seats.map((s) => s.x[k] ?? 0)).reduce((a, b) => a + b, 0) / (tables.length * 5));
  const sd = names.map((k, j) => Math.sqrt(tables.flatMap((t) => t.seats.map((s) => ((s.x[k] ?? 0) - mean[j]) ** 2)).reduce((a, b) => a + b, 0) / (tables.length * 5)) || 1);
  const X = (/** @type {Table} */ t) => t.seats.map((s) => names.map((k, j) => ((s.x[k] ?? 0) - mean[j]) / sd[j]));
  const score = (/** @type {number[][]} */ x, /** @type {number[]} */ w) => softmax(x.map((xi) => xi.reduce((a, v, j) => a + v * w[j], 0)));
  /** Weights fitted to some tables: the penalised likelihood maximised by Newton's method. @param {Table[]} train */
  const train = (train) => {
    const d = names.length;
    let w = names.map(() => 0);
    const xs = train.map(X);
    for (let it = 0; it < 30; it++) {
      const g = names.map((_, j) => -l2 * train.length * w[j]);
      const H = names.map((_, j) => names.map((_, k) => (j === k ? l2 * train.length + 1e-9 : 0)));
      train.forEach((t, n) => {
        const x = xs[n], q = score(x, w);
        const ysum = t.seats.reduce((a, s) => a + s.y, 0);
        const bar = names.map((_, j) => x.reduce((a, xi, i) => a + q[i] * xi[j], 0));
        for (let i = 0; i < x.length; i++) {
          for (let j = 0; j < d; j++) {
            g[j] += (t.seats[i].y - ysum * q[i]) * x[i][j];
            for (let k = 0; k < d; k++) H[j][k] += ysum * q[i] * (x[i][j] - bar[j]) * (x[i][k] - bar[k]);
          }
        }
      });
      const step = solve(H, g);
      w = w.map((v, j) => v + step[j]);
      if (step.reduce((a, v) => a + Math.abs(v), 0) < 1e-8) break;
    }
    return w;
  };
  const mloss = (/** @type {Table[]} */ ts, /** @type {(t: Table) => number[]} */ q) => ts.reduce((a, t) => a + loss(t, q(t)), 0) / Math.max(1, ts.length);
  const even = (/** @type {Table} */ t) => t.seats.map(() => 1 / t.seats.length);
  const bots = (/** @type {Table} */ t) => { const s = t.seats.reduce((a, x) => a + x.p, 0); return t.seats.map((x) => x.p / s); };
  // Cross-validated: each fold scored by weights fitted to the other four.
  let cv = 0;
  for (let k = 0; k < 5; k++) {
    const test = tables.filter((t) => t.fold === k);
    if (!test.length) continue;
    const wk = train(tables.filter((t) => t.fold !== k));
    cv += test.reduce((a, t) => a + loss(t, score(X(t), wk)), 0);
  }
  cv /= tables.length;
  const w = train(tables);
  fitted_[round] = { mean: mean.map(r4), sd: sd.map(r4), w: w.map(r4) };
  console.log(`\nround ${round}: ${tables.length} tables. log-loss: even ${mloss(tables, even).toFixed(3)}, bots ${mloss(tables, bots).toFixed(3)}, fitted ${cv.toFixed(3)} cross-validated (${mloss(tables, (t) => score(X(t), w)).toFixed(3)} on its own data)`);
  console.log(`  weights: ${names.map((k, j) => [k, w[j]]).sort((a, b) => Math.abs(/** @type {number} */ (b[1])) - Math.abs(/** @type {number} */ (a[1]))).map(([k, v]) => `${k} ${(/** @type {number} */ (v)).toFixed(2)}`).join(', ')}`);
}
if (opts.out) {
  writeFileSync(opts.out, `${JSON.stringify({ fitted: new Date().toISOString().slice(0, 10), source: `scripts/fit.mjs: ${games} games (${files.join(', ')}), l2 ${l2}`, names, rounds: fitted_ }, null, 2)}\n`);
  console.log(`\nwrote ${opts.out}`);
}
