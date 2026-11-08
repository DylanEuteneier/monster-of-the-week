// @ts-nocheck
/**
 * The measuring tool (designer, 2026-11-08: one configurable tool, not a script per question). How to read and
 * configure its runs, typical and deep: scripts/measure/README.md. Plays bot games with
 * the native runner, or reads games already logged, and prints the reports asked for.
 *
 *   node scripts/measure.js games=40 players=3,4,5             play 40 games at each count, then report
 *   node scripts/measure.js logs=.tuning/measure-…              report again on a run (its folder: logs and run.json)
 *   node scripts/measure.js logs=base=DIR logs=test=DIR         runs side by side (a change's before and after)
 *
 * One set of reports: a header per run says what it was (typical or deep, the bots, the probe, the rules, seed and
 * commit; from run.json, written beside the logs), and the reports follow from it (a probe column only when probed).
 *
 * Playing:
 *   games=40          games at each player count
 *   players=3,4,5     the player counts (the table's leans spread as the live game does: island-minded and backers)
 *   profiles=a;b;c    the seats instead (one count; overrides players=)
 *   think=k=v,k=v     extra bot settings for every seat, for deep runs (scripts/measure/README.md), e.g.
 *                     think=playouts=12,planBudget=900; unset, the bots are the live game's
 *   seed=7101         the run's seed
 *   workers=N         cores in all (default: every core), shared between the counts by their cost
 *   cards=1 swing=1 ties=1   the logs the reports read (all on by default; =0 turns one off: its rows come out blank)
 *   probe=0.05        the strength probe on that share of turns of play (off by default: it costs about 2 bot
 *                     decisions and their play-outs per card tested); probeSample=4 cards a test, probePlayouts=4
 *   o.<variant>=value a rule variant (as spec.json names it), e.g. o.threshold=22
 *   out=DIR           where the logs go (default .tuning/measure-<time>/), one file per player count
 *
 * Reporting:
 *   report=…          default game,cards,agreement; the reports, in order: game (the designer's preferences), cards (the card scorecard and its
 *                     detail), agreement (whether each card stat agrees with itself across halves of the games)
 *   card=id           one card in detail (cards report)
 *   bar=20            the presence bar the game report reads, if not the spec's default
 *
 * Bots are the players, so every figure measures how bots play the rules and the cards, not how people will feel.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gameReport } from './measure/game.js';
import { cardReport, cardAgreement } from './measure/cards.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const kv = {};
const variants = [];
const logSets = [];
for (const a of args) {
  const i = a.indexOf('=');
  if (i < 0) { console.error(`not an option: ${a}`); process.exit(1); }
  const k = a.slice(0, i), v = a.slice(i + 1);
  if (k.startsWith('o.')) variants.push(a);
  else if (k === 'logs') logSets.push(v);
  else kv[k] = v;
}
const reports = (kv.report ?? 'game,cards,agreement').split(',');
const readLog = (f) => readFileSync(f, 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });

/** The table's leans for n seats, as the live game spreads them (bots.rs table_leans): island-minded and backers. */
function leans(n) {
  const backing = Math.floor((n - 1) / 2), island = n - backing;
  const spread = (k, a, b) => (k === 1 ? [a] : Array.from({ length: k }, (_, i) => a + ((b - a) * i) / (k - 1)));
  return [...spread(island, -0.3, -0.1), ...spread(backing, 0.3, 0.15).reverse()].map((x) => Math.round(x * 1000) / 1000);
}

/** Plays the games: one native run per player count, side by side, the cores shared out. Returns labelled sets. */
async function play() {
  const bin = join(ROOT, 'rust/target/release/motw');
  const built = spawnSync('cargo', ['build', '--release', '-q'], { cwd: join(ROOT, 'rust'), stdio: 'inherit', env: { ...process.env, PATH: `${process.env.HOME}/.cargo/bin:${process.env.PATH}` } });
  if (built.status !== 0) process.exit(1);
  const games = Number(kv.games ?? 40);
  const extra = kv.think ? `,${kv.think}` : '';
  const tables = kv.profiles ? [kv.profiles.split(';').map((p) => (extra ? (p.includes(':') ? p + extra : `${p}:${kv.think}`) : p)).join(';')] : (kv.players ?? '3,4,5').split(',').map((n) => leans(Number(n)).map((l) => `bot:lean=${l}${extra}`).join(';'));
  const cores = Number(kv.workers ?? availableParallelism());
  const dir = kv.out ?? join(ROOT, '.tuning', `measure-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`);
  mkdirSync(dir, { recursive: true });
  // Cores by cost: a table's games cost about the same per seat, so each count gets a share by its seats.
  const seats = tables.map((t) => t.split(';').length);
  const share = seats.map((s) => Math.max(1, Math.round((cores * s) / seats.reduce((a, b) => a + b, 0))));
  // Every log the reports read is on by default (the game report's big-play diagnosis and tie checks, the card study),
  // so no measure comes out blank; each can be turned off (swing=0, ties=0, cards=0) for a faster run.
  const flags = [`cards=${kv.cards ?? '1'}`, `swing=${kv.swing ?? '1'}`, `ties=${kv.ties ?? '1'}`, ...(kv.probe ? [`probe=${kv.probe}`] : []), ...(kv.probeSample ? [`probeSample=${kv.probeSample}`] : []), ...(kv.probePlayouts ? [`probePlayouts=${kv.probePlayouts}`] : [])];
  // The run's configuration travels with its logs (run.json), so a report read back later says how it was made.
  const git = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout?.trim();
  const config = { made: new Date().toISOString(), commit: git, games, players: seats, seed: Number(kv.seed ?? 7101), workers: cores, think: kv.think ?? null, probe: kv.probe ? { rate: Number(kv.probe), sample: Number(kv.probeSample ?? 4), playouts: Number(kv.probePlayouts ?? 4) } : null, variants: Object.fromEntries(variants.map((v) => v.slice(2).split('='))), cards: (kv.cards ?? '1') !== '0', swing: (kv.swing ?? '1') !== '0', ties: (kv.ties ?? '1') !== '0', profiles: Object.fromEntries(tables.map((t, i) => [`${seats[i]}p`, t])) };
  writeFileSync(join(dir, 'run.json'), JSON.stringify(config, null, 2) + '\n');
  const t0 = Date.now();
  const sets = await Promise.all(tables.map((profiles, i) => new Promise((done) => {
    const log = join(dir, `${seats[i]}p.jsonl`);
    if (existsSync(log)) { console.error(`${log} exists: choose another out=`); process.exit(1); }
    const run = spawn(bin, ['tournament', `games=${games}`, `seed=${kv.seed ?? 7101}`, `workers=${share[i]}`, `profiles=${profiles}`, `log=${log}`, ...flags, ...variants], { stdio: ['ignore', 'ignore', 'pipe'] });
    let last = '';
    run.stderr.on('data', (d) => { last = String(d).split('\r').filter(Boolean).at(-1) ?? last; });
    const tick = setInterval(() => process.stderr.write(`\r${seats[i]}p: ${last.trim()}   `), 30_000);
    run.on('close', (code) => {
      clearInterval(tick);
      if (code !== 0) { console.error(`\nthe ${seats[i]}-player run failed (${code})`); process.exit(1); }
      done({ label: `${seats[i]}p`, games: readLog(log) });
    });
  })));
  config.minutes = Math.round((Date.now() - t0) / 60000);
  writeFileSync(join(dir, 'run.json'), JSON.stringify(config, null, 2) + '\n');
  console.error(`\nplayed ${sets.reduce((a, s) => a + s.games.length, 0)} games in ${config.minutes} min; logs in ${dir}`);
  return { label: 'run', dir, config, sets };
}

/** A run read back: a folder (its run.json and logs), or log files (the configuration read from the games). */
function loadRun(spec, i) {
  const [label, list] = /^[^/.=][^/=]*=/.test(spec) ? [spec.slice(0, spec.indexOf('=')), spec.slice(spec.indexOf('=') + 1)] : [`run ${i + 1}`, spec];
  const paths = list.split(',');
  let config = null;
  const files = paths.flatMap((p) => {
    if (!statSync(p).isDirectory()) return [p];
    if (existsSync(join(p, 'run.json'))) config = JSON.parse(readFileSync(join(p, 'run.json'), 'utf8'));
    return readdirSync(p).filter((f) => f.endsWith('.jsonl')).sort().map((f) => join(p, f));
  });
  const games = files.flatMap(readLog);
  // One set per player count.
  const by = {};
  for (const g of games) (by[`${Object.keys(g.seats).length}p`] ??= []).push(g);
  const sets = Object.keys(by).sort().map((k) => ({ label: k, games: by[k] }));
  if (!config) {
    const profiles = Object.fromEntries(sets.map((s) => [s.label, [...new Set(s.games.flatMap((g) => Object.values(g.seats)))].join(';')]));
    // Bot settings beyond the lean mean stronger (or otherwise changed) bots: a deep run.
    const extra = [...new Set(games.flatMap((g) => Object.values(g.seats)).flatMap((p) => (p.split(':')[1] ?? '').split(',').filter((kv) => kv && !kv.startsWith('lean='))))];
    config = { games: null, players: sets.map((s) => Number(s.label.slice(0, -1))), seed: [...new Set(games.map((g) => g.seed))].join(','), think: extra.length ? extra.join(',') : null, probe: games.some((g) => g.probes?.length) ? { rate: '?' } : null, variants: null, cards: games.some((g) => g.cardTurns?.length), profiles, inferred: true };
  }
  return { label, dir: paths.join(','), config, sets };
}

/** What the run was: typical (the live game's bots and rules) or deep (stronger bots or the probe), and how. */
function describe(run) {
  const c = run.config;
  const n = run.sets.map((s) => `${s.label} ${s.games.length}`).join(' · ');
  const deep = c.think || c.probe;
  const changed = c.variants && Object.keys(c.variants).length;
  const out = [`${run.label.toUpperCase()} · ${deep ? 'DEEP RUN' : changed ? 'TYPICAL BOTS, VARIANT RULES' : 'TYPICAL RUN (the live game\'s bots and rules)'} · ${run.sets.reduce((a, s) => a + s.games.length, 0)} games (${n}) · seed ${c.seed}${c.commit ? ` · commit ${c.commit}` : ''}${c.minutes != null ? ` · ${c.minutes} min` : ''}`];
  out.push(`  bots: ${c.think ? `the live game's, thinking deeper: ${c.think}` : 'the live game\'s (one bot with dials, leans spread over the table)'}`);
  out.push(`  probe: ${c.probe ? `on, ${c.probe.rate} of turns, ${c.probe.sample ?? '?'} cards a test, ${c.probe.playouts ?? '?'} play-outs a side` : 'off'} · card study: ${c.cards ? 'on' : 'off'} · rules: ${changed ? Object.entries(c.variants).map(([k, v]) => `${k}=${v}`).join(', ') : 'spec defaults'}`);
  if (c.inferred) out.push('  (no run.json: read from the games themselves)');
  out.push(`  logs: ${run.dir}`);
  return out;
}

const runs = logSets.length ? logSets.map(loadRun) : [await play()];
const lines = [];
for (const run of runs) lines.push(...describe(run), '');
if (runs.length > 1) lines.push('Runs side by side: the game report has a column per run; the card report comes once per run.', '');
for (const r of reports) {
  if (r === 'game') {
    // One run: a column per player count. Several: a column per run (its counts together).
    const cols = runs.length > 1 ? runs.map((run) => ({ label: run.label, games: run.sets.flatMap((s) => s.games) })) : runs[0].sets;
    lines.push(...gameReport(cols, { bar: kv.bar }), '');
  } else if (r === 'cards' || r === 'agreement') {
    for (const run of runs) {
      const games = run.sets.flatMap((s) => s.games);
      if (runs.length > 1) lines.push(`${run.label.toUpperCase()}:`);
      lines.push(...(r === 'cards' ? cardReport(games, { card: kv.card }) : cardAgreement(games)), '');
    }
  } else { console.error(`no report ${r} (game, cards, agreement)`); process.exit(1); }
}
console.log(lines.join('\n'));
