// @ts-check
/**
 * Calibrating the bots' predicted chance of winning (a measuring tool, not
 * rules). From tournament logs (each seat's forecast at the start of each
 * round's play, against who won), fits per round
 *   logit(calibrated) = a + b · logit(predicted)
 * (Platt scaling; b < 1 means the bots are over-confident), and writes it to
 * scripts/calibration.json, which scripts/lib.js `chance` applies before
 * normalising the table to 100. Reports the Brier score before and after on
 * held-out games (every fifth game) and a reliability table.
 *
 *   node scripts/calibrate.mjs log.jsonl [log.jsonl ...] [out=scripts/calibration.json]
 */
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const files = args.filter((a) => !a.includes('='));
const opts = Object.fromEntries(args.filter((a) => a.includes('=')).map((a) => a.split('=')));
const out = opts.out ?? new URL('./calibration.json', import.meta.url).pathname;
const logit = (/** @type {number} */ p) => Math.log(p / (1 - p));
const sigmoid = (/** @type {number} */ x) => 1 / (1 + Math.exp(-x));
const clip = (/** @type {number} */ p) => Math.min(0.995, Math.max(0.005, p));

/** @type {Record<number, { x: number, y: number, test: boolean }[]>} */
const rows = {};
let games = 0;
for (const f of files) {
  for (const line of readFileSync(f, 'utf8').split('\n').filter(Boolean)) {
    const r = JSON.parse(line);
    games += 1;
    const test = games % 5 === 0;
    for (const fc of r.forecasts ?? []) (rows[fc.r] ??= []).push({ x: logit(clip(fc.p / 100)), y: r.winners.includes(fc.seat) ? 1 / r.winners.length : 0, test });
  }
}

/** Logistic regression of y (a share in [0, 1]) on x, by Newton's method. @param {{ x: number, y: number }[]} d */
function fit(d) {
  let a = 0, b = 1;
  for (let it = 0; it < 50; it++) {
    let ga = 0, gb = 0, haa = 0, hab = 0, hbb = 0;
    for (const { x, y } of d) {
      const p = sigmoid(a + b * x), w = p * (1 - p);
      ga += y - p; gb += (y - p) * x; haa += w; hab += w * x; hbb += w * x * x;
    }
    const ridge = 1e-6, det = (haa + ridge) * (hbb + ridge) - hab * hab;
    const da = ((hbb + ridge) * ga - hab * gb) / det, db = ((haa + ridge) * gb - hab * ga) / det;
    a += da; b += db;
    if (Math.abs(da) + Math.abs(db) < 1e-9) break;
  }
  return { a, b };
}
const brier = (/** @type {{ x: number, y: number }[]} */ d, /** @type {(x: number) => number} */ p) => d.reduce((t, r) => t + (p(r.x) - r.y) ** 2, 0) / Math.max(1, d.length);

/** @type {Record<string, { a: number, b: number, n: number }>} */
const rounds = {};
console.log(`${games} games from ${files.join(', ')}`);
console.log('round |    n |      a |     b | Brier raw → calibrated (held out)');
for (const [round, d] of Object.entries(rows)) {
  const train = d.filter((r) => !r.test), test = d.filter((r) => r.test);
  const held = fit(train);
  const all = fit(d);
  rounds[round] = { a: Math.round(all.a * 1000) / 1000, b: Math.round(all.b * 1000) / 1000, n: d.length };
  console.log(`${round.padStart(5)} | ${String(d.length).padStart(4)} | ${all.a.toFixed(3).padStart(6)} | ${all.b.toFixed(3).padStart(5)} | ${brier(test, sigmoid).toFixed(4)} → ${brier(test, (x) => sigmoid(held.a + held.b * x)).toFixed(4)}`);
}
console.log('\nreliability (all rounds, predicted → won, calibrated in brackets):');
/** @type {{ n: number, p: number, q: number, y: number }[]} */
const bins = Array.from({ length: 10 }, () => ({ n: 0, p: 0, q: 0, y: 0 }));
for (const [round, d] of Object.entries(rows)) for (const r of d) {
  const p = sigmoid(r.x), q = sigmoid(rounds[round].a + rounds[round].b * r.x);
  const bin = bins[Math.min(9, Math.floor(p * 10))];
  bin.n += 1; bin.p += p; bin.q += q; bin.y += r.y;
}
console.log(bins.filter((b) => b.n).map((b) => `${(100 * b.p / b.n).toFixed(0)}→${(100 * b.y / b.n).toFixed(0)} [${(100 * b.q / b.n).toFixed(0)}] n${b.n}`).join(' · '));
writeFileSync(out, `${JSON.stringify({ fitted: new Date().toISOString().slice(0, 10), source: `scripts/calibrate.mjs: ${games} games (${files.join(', ')})`, rounds }, null, 2)}\n`);
console.log(`\nwrote ${out}`);
