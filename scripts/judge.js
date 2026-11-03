#!/usr/bin/env node
// The learned judge (designer, 2026-11-02): plays games under the current rules with every turn's positions logged,
// fits the judge's weights (`motw fit`), writes them to rust/data/judge.json and rebuilds the WebAssembly, so the
// bots (persona judge=1) and the table's hints use them. Run it after any rule or card change.
//
//   npm run judge                       60 games at each of 3, 4 and 5 players, seed 7101, the spec's default options
//   npm run judge -- games=100 seed=9 o.roundVotes=on    more games, another seed, any game option (o.name=value)
//   npm run judge -- dry=1              fit and report, but don't write the weights
//
// It prints how the learned judge predicts the ending and the winner on held-out games, against the hand formula.
// The weights are written only when the learned judge predicts the ending better (or with force=1).
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { availableParallelism } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=')).map(([k, ...v]) => [k, v.join('=')]));
const games = Number(args.games ?? 60);
const seed = Number(args.seed ?? 7101);
const options = Object.entries(args).filter(([k]) => k.startsWith('o.')).map(([k, v]) => `${k}=${v}`);
const env = { ...process.env, PATH: `${process.env.HOME}/.cargo/bin:${process.env.PATH}` };
/** @param {string} cmd @param {string[]} argv @param {string} [cwd] */
const run = (cmd, argv, cwd = root) => execFileSync(cmd, argv, { cwd, env, stdio: ['ignore', 'pipe', 'inherit'] }).toString();

console.log('Building the runner…');
run('cargo', ['build', '-q', '--release'], join(root, 'rust'));
const motw = join(root, 'rust/target/release/motw');

// The standard tables (designer's leans: fewer seats backing a faction than playing for the island).
const tables = { 3: ['0.3', '-0.3', '-0.3'], 4: ['0.3', '0.3', '-0.3', '-0.3'], 5: ['0.3', '0.3', '-0.3', '-0.3', '-0.3'] };
const dir = join(root, '.tuning/judge');
mkdirSync(dir, { recursive: true });
/** @type {string[]} */
const logs = [];
const workers = String(Math.max(1, availableParallelism()));
for (const [n, leans] of Object.entries(tables)) {
  const log = join(dir, `positions_${n}.jsonl`);
  rmSync(log, { force: true });
  console.log(`Playing ${games} games at ${n} players…`);
  run(motw, ['tournament', `games=${games}`, `seed=${seed}`, `workers=${workers}`, `profiles=${leans.map((l) => `bot:lean=${l}`).join(';')}`, 'positions=1', `log=${log}`, ...options]);
  logs.push(log);
}

const out = join(root, 'rust/data/judge.json');
const trial = join(dir, 'judge.json');
const report = run(motw, ['fit', `in=${logs.join(',')}`, `out=${trial}`]);
process.stdout.write(report);
const m = /ending's log loss ([\d.]+) learned vs ([\d.]+) hand formula/.exec(report);
const better = m && Number(m[1]) < Number(m[2]);
if (args.dry === '1') {
  console.log(`Dry run: weights left in ${trial}.`);
} else if (better || args.force === '1') {
  writeFileSync(out, readFileSync(trial));
  console.log(`Wrote ${out}. Rebuilding the WebAssembly…`);
  run('npm', ['run', 'wasm']);
  console.log('Done: commit rust/data/judge.json and public/motw.wasm with the change that called for it.');
} else {
  console.log(`The learned judge did not beat the hand formula on held-out games: ${out} left as it was${existsSync(out) ? '' : ' (none)'}.`);
}
