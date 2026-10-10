// @ts-check
/**
 * How well the bots' judgement predicts who wins, and what a fitted judgement
 * would do (a measuring tool, not rules; 2026-10-10, from the bot tuning
 * research: fit the evaluation to logged outcomes, as chess engines do with
 * Texel tuning). From tournament logs with features (bots.js `features`, each
 * seat at the start of each round's play), for each round it fits a table
 * model: P(seat i wins) = exp(w·x_i) / Σ_j exp(w·x_j), so only differences
 * between seats count. Held out: every fifth game. Reports the log-loss of the
 * bots' own forecast, of an even split, and of the fitted model, and the
 * fitted weights (standardised: a weight's size is how much one standard
 * deviation of that feature moves the odds).
 *
 *   node scripts/fit.mjs log.jsonl [log.jsonl ...] [features=a,b,c] [l2=0.01]
 */
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const files = args.filter((a) => !a.includes('='));
const opts = Object.fromEntries(args.filter((a) => a.includes('=')).map((a) => a.split('=')));
const l2 = Number(opts.l2 ?? 0.01);

/** @typedef {{ test: boolean, seats: { x: Record<string, number>, p: number, y: number }[] }} Table */
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
  for (const x of fc) (tables[x.r] ??= { test: games % 5 === 0, seats: [] }).seats.push({ x: x.f, p: x.p / 100, y: r.winners.includes(x.seat) ? 1 / r.winners.length : 0 });
  for (const [round, t] of Object.entries(tables)) (byRound[Number(round)] ??= []).push(t);
}
if (!games) throw new Error('no games with features in these logs');
const names = opts.features ? opts.features.split(',') : Object.keys(Object.values(byRound)[0][0].seats[0].x).filter((k) => k !== 'roundsLeft');
console.log(`${games} games with features (${files.join(', ')}); l2 ${l2}`);

/** Log-loss of a table's predicted shares against the winners. @param {Table} t @param {number[]} q */
const loss = (t, q) => -t.seats.reduce((a, s, i) => a + s.y * Math.log(Math.max(1e-6, q[i])), 0);
const softmax = (/** @type {number[]} */ z) => { const m = Math.max(...z); const e = z.map((v) => Math.exp(v - m)); const sum = e.reduce((a, b) => a + b, 0); return e.map((v) => v / sum); };

for (const [round, tables] of Object.entries(byRound)) {
  // Standardise each feature (differences within a table are what count, so centring per table is implied by the softmax).
  const mean = names.map((k) => tables.flatMap((t) => t.seats.map((s) => s.x[k] ?? 0)).reduce((a, b) => a + b, 0) / (tables.length * 5));
  const sd = names.map((k, j) => Math.sqrt(tables.flatMap((t) => t.seats.map((s) => ((s.x[k] ?? 0) - mean[j]) ** 2)).reduce((a, b) => a + b, 0) / (tables.length * 5)) || 1);
  const X = (/** @type {Table} */ t) => t.seats.map((s) => names.map((k, j) => ((s.x[k] ?? 0) - mean[j]) / sd[j]));
  const train = tables.filter((t) => !t.test), test = tables.filter((t) => t.test);
  const w = names.map(() => 0);
  for (let it = 0; it < 2000; it++) {
    const g = names.map(() => 0);
    for (const t of train) {
      const x = X(t), q = softmax(x.map((xi) => xi.reduce((a, v, j) => a + v * w[j], 0)));
      const ysum = t.seats.reduce((a, s) => a + s.y, 0);
      for (let i = 0; i < x.length; i++) for (let j = 0; j < names.length; j++) g[j] += (t.seats[i].y - ysum * q[i]) * x[i][j];
    }
    for (let j = 0; j < names.length; j++) w[j] += (0.5 / train.length) * (g[j] - l2 * train.length * w[j]);
  }
  const fitted = (/** @type {Table} */ t) => softmax(X(t).map((xi) => xi.reduce((a, v, j) => a + v * w[j], 0)));
  const mloss = (/** @type {Table[]} */ ts, /** @type {(t: Table) => number[]} */ q) => ts.reduce((a, t) => a + loss(t, q(t)), 0) / Math.max(1, ts.length);
  const even = (/** @type {Table} */ t) => t.seats.map(() => 1 / t.seats.length);
  const bots = (/** @type {Table} */ t) => { const s = t.seats.reduce((a, x) => a + x.p, 0); return t.seats.map((x) => x.p / s); };
  console.log(`\nround ${round}: ${tables.length} tables. held-out log-loss: even ${mloss(test, even).toFixed(3)}, bots ${mloss(test, bots).toFixed(3)}, fitted ${mloss(test, fitted).toFixed(3)} (train: bots ${mloss(train, bots).toFixed(3)}, fitted ${mloss(train, fitted).toFixed(3)})`);
  console.log(`  weights: ${names.map((k, j) => [k, w[j]]).sort((a, b) => Math.abs(/** @type {number} */ (b[1])) - Math.abs(/** @type {number} */ (a[1]))).map(([k, v]) => `${k} ${(/** @type {number} */ (v)).toFixed(2)}`).join(', ')}`);
}
