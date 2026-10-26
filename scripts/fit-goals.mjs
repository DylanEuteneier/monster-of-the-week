// @ts-check
/**
 * Each seat's chance of winning by each ending, fitted to logged games (a measuring and tuning tool, not rules;
 * 2026-10-26, designer: accurate round evaluation passed back to the bots' strategy). From tournament logs with
 * features (bots.js `features`, each seat at the start of each round's play), for each round it fits two logistic
 * models: P(this seat wins and the island ending comes) and P(this seat wins and the invaders' ending comes).
 * Held out: five folds by game. Reports the cross-validated log-loss of the fitted chances against the bots' own
 * (islWin, invWin: the chances their goal choice runs on) and against a constant. With out=, writes the weights
 * (standardised, with the means and spreads) for the bots' `goalFit` switch.
 *
 *   node scripts/fit-goals.mjs log.jsonl [log.jsonl ...] [l2=0.05] [out=public/goal-fit.json]
 */
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const files = args.filter((a) => !a.includes('='));
const opts = Object.fromEntries(args.filter((a) => a.includes('=')).map((a) => a.split('=')));
const l2 = Number(opts.l2 ?? 0.05);

/** @typedef {{ fold: number, x: Record<string, number>, yIsl: number, yInv: number }} Row */
/** @type {Record<number, Row[]>} */
const byRound = {};
let games = 0;
for (const f of files) for (const line of readFileSync(f, 'utf8').split('\n').filter(Boolean)) {
  const r = JSON.parse(line);
  const fc = (r.forecasts ?? []).filter((/** @type {any} */ x) => x.f);
  if (!fc.length) continue;
  games += 1;
  for (const x of fc) {
    const won = r.winners.includes(x.seat) ? 1 / r.winners.length : 0;
    (byRound[x.r] ??= []).push({ fold: r.g % 5, x: x.f, yIsl: r.side === 'island' ? won : 0, yInv: r.side === 'invaders' ? won : 0 });
  }
}
if (!games) throw new Error('no games with features in these logs');
const names = Object.keys(Object.values(byRound)[0][0].x);
console.log(`${games} games (${files.join(', ')}); l2 ${l2}; ${names.length} features`);

const sig = (/** @type {number} */ z) => 1 / (1 + Math.exp(-z));
const ll = (/** @type {number} */ p, /** @type {number} */ y) => -(y * Math.log(Math.max(1e-6, p)) + (1 - y) * Math.log(Math.max(1e-6, 1 - p)));
/** Solves A x = b. @param {number[][]} A @param {number[]} b */
function solve(A, b) {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const k = M[r][c] / M[c][c]; for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j]; }
  }
  return M.map((row, i) => row[n] / row[i]);
}
/** Penalised logistic regression by Newton's method; w[0] is the intercept (not penalised). @param {number[][]} X @param {number[]} y */
function fit(X, y) {
  const d = X[0].length + 1;
  let w = new Array(d).fill(0);
  for (let it = 0; it < 25; it++) {
    const g = w.map((v, j) => (j ? -l2 * X.length * v : 0));
    const H = w.map((_, j) => w.map((__, k) => (j === k && j ? l2 * X.length : j === k ? 1e-9 : 0)));
    for (let i = 0; i < X.length; i++) {
      const xi = [1, ...X[i]];
      const p = sig(xi.reduce((a, v, j) => a + v * w[j], 0));
      for (let j = 0; j < d; j++) { g[j] += (y[i] - p) * xi[j]; for (let k = 0; k < d; k++) H[j][k] += p * (1 - p) * xi[j] * xi[k]; }
    }
    const step = solve(H, g);
    w = w.map((v, j) => v + step[j]);
    if (Math.max(...step.map(Math.abs)) < 1e-6) break;
  }
  return w;
}
const r4 = (/** @type {number} */ x) => Math.round(x * 10000) / 10000;
/** @type {Record<string, { mean: number[], sd: number[], isl: number[], inv: number[] }>} */
const out = {};
for (const [round, rows] of Object.entries(byRound)) {
  const mean = names.map((k) => rows.reduce((a, r) => a + (r.x[k] ?? 0), 0) / rows.length);
  const sd = names.map((k, j) => Math.sqrt(rows.reduce((a, r) => a + ((r.x[k] ?? 0) - mean[j]) ** 2, 0) / rows.length) || 1);
  const X = (/** @type {Row[]} */ rs) => rs.map((r) => names.map((k, j) => ((r.x[k] ?? 0) - mean[j]) / sd[j]));
  const pred = (/** @type {number[]} */ w, /** @type {number[]} */ xi) => sig(w[0] + xi.reduce((a, v, j) => a + v * w[j + 1], 0));
  let cv = { isl: 0, inv: 0 }, own = { isl: 0, inv: 0 }, flat = { isl: 0, inv: 0 };
  for (let f = 0; f < 5; f++) {
    const tr = rows.filter((r) => r.fold !== f), te = rows.filter((r) => r.fold === f);
    if (!te.length) continue;
    const wI = fit(X(tr), tr.map((r) => r.yIsl)), wV = fit(X(tr), tr.map((r) => r.yInv));
    const bI = tr.reduce((a, r) => a + r.yIsl, 0) / tr.length, bV = tr.reduce((a, r) => a + r.yInv, 0) / tr.length;
    X(te).forEach((xi, i) => {
      const r = te[i];
      cv.isl += ll(pred(wI, xi), r.yIsl); cv.inv += ll(pred(wV, xi), r.yInv);
      own.isl += ll(Math.min(0.99, Math.max(0.01, r.x.islWin ?? 0)), r.yIsl); own.inv += ll(Math.min(0.99, Math.max(0.01, r.x.invWin ?? 0)), r.yInv);
      flat.isl += ll(bI, r.yIsl); flat.inv += ll(bV, r.yInv);
    });
  }
  const n = rows.length, f3 = (/** @type {number} */ x) => (x / n).toFixed(3);
  console.log(`round ${round}: ${n} seats. island: constant ${f3(flat.isl)}, bots ${f3(own.isl)}, fitted ${f3(cv.isl)} | invaders: constant ${f3(flat.inv)}, bots ${f3(own.inv)}, fitted ${f3(cv.inv)}`);
  out[round] = { mean: mean.map(r4), sd: sd.map(r4), isl: fit(X(rows), rows.map((r) => r.yIsl)).map(r4), inv: fit(X(rows), rows.map((r) => r.yInv)).map(r4) };
}
if (opts.out) {
  writeFileSync(opts.out, `${JSON.stringify({ updated: new Date().toISOString(), games, l2, names, rounds: out }, null, 1)}\n`);
  console.log(`wrote ${opts.out}`);
}
