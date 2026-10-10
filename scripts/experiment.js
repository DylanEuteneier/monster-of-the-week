// @ts-check
/**
 * Unattended bot tuning experiments (a measuring tool, not rules). Each
 * experiment jitters one to three of a profile's tunable values (from
 * experiments/space.json, around the current defaults), plays that table
 * against the standard table on the same deals (duplicate=1, same seed),
 * judges the result, writes a log entry (experiments/results/<id>.json),
 * rebuilds the testing log (experiments/CATALOGUE.md) and commits them.
 * Baselines are cached by code, Node version, table and seed
 * (experiments/bases/), so machines share them through the repo.
 *
 *   node scripts/experiment.js                  one jittered experiment, committed locally
 *   node scripts/experiment.js --loop --push    keep going; pull before and push after each
 *   node scripts/experiment.js --count 5 --hours 8 --games 20 --workers 8
 *   node scripts/experiment.js --profile trophy --set threat=4,margin=2 --note "why"   a chosen change, no jitter
 *   node scripts/experiment.js report           rebuild experiments/CATALOGUE.md from the entries
 *   (also: --seed N for the first run's deals, --design single for one changed seat, --no-commit, --no-confirm)
 *
 * Speed: one process plays every game through a pool of worker threads, one
 * per core by default (--workers N), fed from a single queue by several
 * experiments at once (--parallel N; default enough to keep the pool full), so
 * no core sits idle at the end of a run and slower efficiency cores just play
 * fewer games. On macOS it keeps the machine awake while it runs (caffeinate;
 * --no-caffeinate to skip; on a laptop keep it on power with the lid open).
 * With --push, others' entries are pulled between experiments; new bot code is
 * pulled only once no experiment is in flight, so no run mixes two versions.
 *
 * Verdicts (changed seats, paired game by game): promising when wins or
 * placings are up by z ≥ 2 and the other is not down; a promising change is
 * rerun on a fresh seed with twice the games (--no-confirm skips) and is a
 * success only if that run agrees (z ≥ 1) and both together reach z ≥ 2.5,
 * else it faded. Worse: down by z ≥ 2. Otherwise inconclusive. A 20-game run
 * only resolves large effects; the catalogue pools every jittered experiment
 * per value (gain against how far it moved) to find small ones.
 */
import { spawn, execFileSync } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { availableParallelism, hostname } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'experiments');
const RESULTS = join(DIR, 'results'), BASES = join(DIR, 'bases'), CATALOGUE = join(DIR, 'CATALOGUE.md');
const SPACE = join(DIR, 'space.json');
const CODE = ['public/engine.js', 'public/bots.js', 'public/spec.json', 'public/card-strength.json', 'public/eval-fit.json', 'scripts/tournament.js', 'scripts/lib.js'];

/** @typedef {{ g: number, side: string, seats: Record<string, string>, winners: string[], placings?: string[], trophiesByColour?: any, standing?: any, presenceBy?: any }} Game */
/** @typedef {{ games: number, seats: number, winA: number, winB: number, dWin: number, seWin: number, zWin: number, gain: number, seGain: number, zGain: number, invA: number, invB: number }} Metrics */
/** @typedef {{ seed: number, games: number, base: string, metrics: Metrics, records: Game[] }} Run */
/**
 * @typedef {{ id: string, kind: 'jitter' | 'set' | 'overnight', date: string, host: string, node: string, code: { hash: string, commit: string },
 *   profile: string, design: string, params: Record<string, { base: number, value: number, sd?: number }>, table: string, variant: string,
 *   hypothesis?: string, notes?: string, runs: Run[], metrics: Metrics, verdict: string, minutes: number }} Entry
 */

// ---------------------------------------------------------------------------
// Measuring
// ---------------------------------------------------------------------------

const won = (/** @type {Game} */ r, /** @type {string} */ p) => (r.winners.includes(p) ? 1 / r.winners.length : 0);

/**
 * A game's placings: logged, or (older logs) rebuilt from its trophies and
 * standing (island exact; invaders without the control and affinity ties).
 * @param {Game} r @returns {string[]}
 */
export function order(r) {
  if (r.placings?.length) return r.placings;
  const seats = Object.keys(r.seats), t = r.trophiesByColour;
  if (!t) return seats;
  if (r.side === 'island') {
    const sorted = (/** @type {string} */ p) => Object.values(t[p]).map(Number).sort((x, y) => x - y);
    return seats.slice().sort((a, b) => { const sa = sorted(a), sb = sorted(b); for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sb[i] - sa[i]; return 0; });
  }
  const top = Math.max(...Object.values(r.presenceBy).map(Number));
  const fs = Object.keys(r.presenceBy).filter((f) => r.presenceBy[f] === top);
  const net = (/** @type {string} */ p) => fs.reduce((n, f) => n + (r.standing[p][f] ?? 0) - t[p][f], 0);
  const held = (/** @type {string} */ p) => fs.reduce((n, f) => n + t[p][f], 0);
  return seats.slice().sort((a, b) => net(b) - net(a) || held(a) - held(b));
}
const place = (/** @type {Game} */ r, /** @type {string} */ p) => (r.winners.includes(p) ? 1 : order(r).indexOf(p) + 1);

/** The fields a comparison needs. @param {any} r @returns {Game} */
export const compact = (r) => ({ g: r.g, side: r.side, seats: r.seats, winners: r.winners, placings: r.placings?.length ? r.placings : order(r) });

/**
 * A table's games (A) against the standard table's on the same deals (B):
 * for the changed seats, the win share and the placing gain (places better,
 * so positive is good), paired game by game.
 * @param {Game[]} A @param {Game[]} B @returns {Metrics}
 */
export function compare(A, B) {
  const byG = new Map(B.map((r) => [r.g, r]));
  /** @type {number[]} */ const dw = [], dp = [];
  let seats = 0, a = 0, b = 0, invA = 0, invB = 0;
  for (const ra of A) {
    const rb = byG.get(ra.g);
    if (!rb) continue;
    const changed = Object.keys(ra.seats).filter((p) => ra.seats[p] !== rb.seats[p]);
    if (!changed.length) continue;
    let w = 0, pl = 0;
    for (const p of changed) { w += won(ra, p) - won(rb, p); pl += place(rb, p) - place(ra, p); a += won(ra, p); b += won(rb, p); }
    dw.push(w / changed.length); dp.push(pl / changed.length);
    seats += changed.length;
    invA += ra.side === 'invaders' ? 1 : 0; invB += rb.side === 'invaders' ? 1 : 0;
  }
  const stat = (/** @type {number[]} */ xs) => {
    const n = xs.length, m = xs.reduce((t, x) => t + x, 0) / Math.max(1, n);
    const se = n > 1 ? Math.sqrt(xs.reduce((t, x) => t + (x - m) ** 2, 0) / (n - 1) / n) : 0;
    return { m, se, z: se ? m / se : 0 };
  };
  const w = stat(dw), p = stat(dp);
  const r3 = (/** @type {number} */ x) => Math.round(x * 1000) / 1000;
  return { games: dw.length, seats, winA: r3(a / Math.max(1, seats)), winB: r3(b / Math.max(1, seats)), dWin: r3(w.m), seWin: r3(w.se), zWin: r3(w.z), gain: r3(p.m), seGain: r3(p.se), zGain: r3(p.z), invA, invB };
}

/** @param {Metrics} m */
export function verdictOf(m) {
  if ((m.zWin >= 2 && m.zGain >= 0) || (m.zGain >= 2 && m.zWin >= 0)) return 'promising';
  if ((m.zWin <= -2 && m.zGain <= 0) || (m.zGain <= -2 && m.zWin <= 0)) return 'worse';
  return 'inconclusive';
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

const sh = (/** @type {string[]} */ args, allowFail = false) => {
  try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_EDITOR: 'true' } }).trim(); }
  catch (e) { if (allowFail) return null; throw e; }
};
const codeHash = () => { const h = createHash('sha1'); for (const f of CODE) h.update(existsSync(join(ROOT, f)) ? readFileSync(join(ROOT, f)) : ''); return h.digest('hex').slice(0, 10); };
const short = (/** @type {string} */ s) => createHash('sha1').update(s).digest('hex').slice(0, 6);
const nodeMajor = () => process.versions.node.split('.')[0];
const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
const round3 = (/** @type {number} */ x) => Math.round(x * 1000) / 1000;

/** The profiles' current values, read fresh (a pull may have changed the bots). @returns {Record<string, Record<string, number>>} */
function defaults(/** @type {string[]} */ profiles) {
  const code = `import(${JSON.stringify(pathToFileURL(join(ROOT, 'public/bots.js')).href)}).then((m) => console.log(JSON.stringify(Object.fromEntries(${JSON.stringify(profiles)}.map((p) => [p, m.personaOf(p)])))))`;
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', code], { cwd: ROOT, encoding: 'utf8' }));
}

/**
 * The machine's game pool: one worker thread per slot, each playing one game
 * at a time (tournament.js's worker, so a game is the same as in a tournament
 * run) from one queue that every experiment in flight feeds. Fast and slow
 * cores (performance and efficiency) and long and short games balance out,
 * and no core waits on another experiment's last game.
 */
class Pool {
  constructor(/** @type {number} */ size) {
    this.size = size;
    this.busy = 0;
    /** @type {{ table: string, seed: number, g: number, resolve: (r: Game) => void, reject: (e: Error) => void }[]} */
    this.queue = [];
  }
  /** One game of a table on a seed's deals. @param {string} table @param {number} seed @param {number} g @returns {Promise<Game>} */
  game(table, seed, g) {
    return new Promise((resolve, reject) => { this.queue.push({ table, seed, g, resolve, reject }); this.pump(); });
  }
  pump() {
    while (this.busy < this.size && this.queue.length) {
      const job = /** @type {Pool['queue'][number]} */ (this.queue.shift());
      this.busy += 1;
      /** @type {Game | null} */
      let record = null;
      const w = new Worker(TOURNAMENT, { workerData: { games: [job.g], seed: job.seed, list: job.table.split(';'), options: {}, probe: NO_PROBES, duplicate: true } });
      w.on('message', (/** @type {any} */ r) => { record = compact(r); });
      w.on('error', (e) => job.reject(e));
      w.on('exit', () => {
        this.busy -= 1;
        if (record) job.resolve(record); else job.reject(new Error(`game ${job.g} of ${job.table} (seed ${job.seed}) ended without a result`));
        this.pump();
      });
    }
  }
}
const TOURNAMENT = join(ROOT, 'scripts/tournament.js');
const NO_PROBES = { rate: 0, open: false, sample: 6, playouts: 2, targets: 2, lite: false };
/** @type {Pool} */
let pool;

/** Plays a table's games on a seed, through the pool. @param {string} table @param {number} seed @param {number} games @param {string} label @returns {Promise<Game[]>} */
async function play(table, seed, games, label) {
  let n = 0, last = Date.now();
  const all = await Promise.all(Array.from({ length: games }, (_, g) => pool.game(table, seed, g).then((r) => {
    n += 1;
    if (Date.now() - last > 60000 || n === games) { last = Date.now(); process.stderr.write(`  ${label}: ${n}/${games} games\n`); }
    return r;
  })));
  return all.sort((x, y) => x.g - y.g);
}

/** The standard table's games on a seed, if cached (by code, Node version, table and seed). @returns {{ records: Game[], file: string } | null} */
function cachedBase(/** @type {string} */ table, /** @type {number} */ seed, /** @type {number} */ games) {
  const prefix = baseName(table, seed);
  if (!existsSync(BASES)) return null;
  const have = readdirSync(BASES).filter((f) => f.startsWith(prefix)).map((f) => ({ f, n: Number(f.slice(prefix.length).replace('.jsonl', '')) })).filter((x) => x.n >= games).sort((x, y) => x.n - y.n)[0];
  if (!have) return null;
  return { records: readFileSync(join(BASES, have.f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.g < games), file: join(BASES, have.f) };
}
const baseName = (/** @type {string} */ table, /** @type {number} */ seed) => `${codeHash()}-node${nodeMajor()}-${short(table)}-s${seed}-g`;

/** Plays the standard table on a seed and caches it. */
function playBase(/** @type {string} */ table, /** @type {number} */ seed, /** @type {number} */ games) {
  // Two experiments in flight on the same seed share one baseline.
  const key = `${baseName(table, seed)}${games}`;
  if (!PLAYING.has(key)) PLAYING.set(key, playBaseNow(table, seed, games).finally(() => PLAYING.delete(key)));
  return /** @type {Promise<{ records: Game[], file: string }>} */ (PLAYING.get(key));
}
/** @type {Map<string, Promise<{ records: Game[], file: string }>>} */
const PLAYING = new Map();
/** @returns {Promise<{ records: Game[], file: string }>} */
async function playBaseNow(/** @type {string} */ table, /** @type {number} */ seed, /** @type {number} */ games) {
  const records = await play(table, seed, games, `standard table, seed ${seed}`);
  mkdirSync(BASES, { recursive: true });
  const file = join(BASES, `${baseName(table, seed)}${games}.jsonl`);
  writeFileSync(file, `${records.map((r) => JSON.stringify(r)).join('\n')}\n`);
  return { records, file };
}

/** One experiment: the change, its runs, its verdict. */
async function experiment(/** @type {any} */ opts) {
  const space = JSON.parse(readFileSync(SPACE, 'utf8'));
  const names = Object.keys(space.profiles);
  const profile = opts.profile ?? names[Math.floor(Math.random() * names.length)];
  const spec = space.profiles[profile];
  if (!spec) throw new Error(`no profile ${profile} in experiments/space.json`);
  const current = defaults([profile])[profile];
  /** @type {Record<string, { base: number, value: number, sd?: number }>} */
  const params = {};
  if (opts.set) {
    for (const kv of String(opts.set).split(',')) { const [k, v] = kv.split('='); params[k] = { base: current[k] ?? spec.params[k]?.default ?? 0, value: Number(v), sd: spec.params[k]?.sd }; }
  } else {
    const keys = Object.keys(spec.params).sort(() => Math.random() - 0.5);
    const k = Math.random() < 0.6 ? 1 : Math.random() < 0.75 ? 2 : 3;
    for (const name of keys.slice(0, k)) {
      const p = spec.params[name], base = current[name] ?? p.default ?? 0;
      let v = base + gauss() * p.sd;
      if (Math.abs(v - base) < p.sd / 4) v = base + Math.sign(v - base || 1) * p.sd / 4;
      v = Math.min(p.max ?? Infinity, Math.max(p.min ?? -Infinity, v));
      v = p.int ? Math.round(v) : round3(v);
      if (v === base) v = p.int ? base + 1 : round3(base + p.sd / 2);
      params[name] = { base, value: v, sd: p.sd };
    }
  }
  const variantProfile = `${profile}:${Object.entries(params).map(([k, p]) => `${k}=${p.value}`).join(',')}`;
  const seats = /** @type {string[]} */ (space.table.split(';'));
  const variant = seats.map((s, i) => (s === profile && (opts.design !== 'single' || i === seats.lastIndexOf(profile)) ? variantProfile : s)).join(';');
  const seedPool = Number(space.seeds ?? 40), games = Number(opts.games ?? space.games ?? 20);
  const pick = (/** @type {number[]} */ not) => { let s; do s = 1 + Math.floor(Math.random() * seedPool); while (not.includes(s) && not.length < seedPool); return s; };
  const describe = Object.entries(params).map(([k, p]) => `${k} ${p.base}→${p.value}`).join(', ');
  const t0 = Date.now();
  const hash = codeHash();
  /** @type {Run[]} */ const runs = [];
  /** @type {string[]} */ const files = [];
  const once = async (/** @type {number} */ seed, /** @type {number} */ n) => {
    process.stderr.write(`${profile} ${describe}: seed ${seed}, ${n} games\n`);
    const cached = cachedBase(space.table, seed, n);
    const [base, records] = await Promise.all([cached ?? playBase(space.table, seed, n), play(variant, seed, n, `${profile} ${describe}, seed ${seed}`)]);
    if (!cached) files.push(base.file);
    const metrics = compare(records, base.records);
    runs.push({ seed, games: n, base: base.file.slice(ROOT.length + 1), metrics, records });
    return metrics;
  };
  const first = await once(opts.seed ? Number(opts.seed) : pick([]), games);
  let verdict = verdictOf(first);
  let metrics = first;
  if (verdict === 'promising' && !opts.noConfirm) {
    const again = await once(pick([runs[0].seed]), games * 2);
    const both = compare(runs.flatMap((r) => r.records.map((x) => ({ ...x, g: x.g + r.seed * 100000 }))), runs.flatMap((r) => (cachedBase(space.table, r.seed, r.games)?.records ?? []).map((x) => ({ ...x, g: x.g + r.seed * 100000 }))));
    const key = first.zWin >= first.zGain ? 'zWin' : 'zGain';
    verdict = again[key] >= 1 && both[key] >= 2.5 ? 'success' : 'faded';
    metrics = both;
  }
  /** @type {Entry} */
  const entry = {
    id: `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${hostname().split('.')[0]}-${randomBytes(2).toString('hex')}`,
    kind: opts.set ? 'set' : 'jitter', date: new Date().toISOString(), host: hostname().split('.')[0], node: process.version,
    code: { hash, commit: sh(['rev-parse', '--short', 'HEAD'], true) ?? '' },
    profile, design: opts.design ?? 'group', params, table: space.table, variant, hypothesis: opts.note, runs, metrics, verdict,
    minutes: Math.round((Date.now() - t0) / 600) / 100,
  };
  mkdirSync(RESULTS, { recursive: true });
  const file = join(RESULTS, `${entry.id}.json`);
  writeFileSync(file, `${JSON.stringify(entry, null, 1)}\n`);
  files.push(file);
  console.log(`${entry.id}: ${profile} ${describe} — ${verdict}. ${line(entry.metrics)} (${entry.minutes} min)`);
  return { entry, files };
}

const sign = (/** @type {number} */ x, d = 1) => `${x > 0 ? '+' : ''}${x.toFixed(d)}`;
/** @param {Metrics} m */
const line = (m) => `wins ${sign(100 * m.dWin)} ±${(100 * m.seWin).toFixed(1)} points a seat (z ${m.zWin.toFixed(1)}), placing ${sign(m.gain, 2)} ±${m.seGain.toFixed(2)} (z ${m.zGain.toFixed(1)}), invaders ${m.invA}/${m.games} against ${m.invB}/${m.games}`;

// ---------------------------------------------------------------------------
// The testing log
// ---------------------------------------------------------------------------

/**
 * Weighted least squares of y on x: a + b·x + c·x² with six rows or more (and
 * at least three distinct x), else a + b·x. Returns the coefficients and the
 * standard errors of b and c, or null with too few rows.
 * @param {{ x: number, y: number, w: number }[]} rows
 */
export function curve(rows) {
  const quadratic = rows.length >= 6 && new Set(rows.map((r) => r.x.toFixed(3))).size >= 3;
  const d = quadratic ? 3 : 2;
  if (rows.length <= d) return null;
  const X = rows.map((r) => (quadratic ? [1, r.x, r.x * r.x] : [1, r.x]));
  const A = Array.from({ length: d }, (_, i) => Array.from({ length: d }, (_, j) => rows.reduce((t, r, n) => t + r.w * X[n][i] * X[n][j], 0)));
  const v = Array.from({ length: d }, (_, i) => rows.reduce((t, r, n) => t + r.w * X[n][i] * r.y, 0));
  const inv = invert(A);
  if (!inv) return null;
  const beta = inv.map((row) => row.reduce((t, a, j) => t + a * v[j], 0));
  // Residual variance per unit weight, scaled so the weights act as relative (games), not as known variances.
  const res = rows.reduce((t, r, n) => t + r.w * (r.y - X[n].reduce((u, x, j) => u + x * beta[j], 0)) ** 2, 0) / (rows.length - d);
  const se = (/** @type {number} */ i) => Math.sqrt(Math.max(0, res * inv[i][i]));
  return { quadratic, a: beta[0], b: beta[1], c: quadratic ? beta[2] : 0, seB: se(1), seC: quadratic ? se(2) : NaN };
}

/** The inverse of a small matrix (Gauss–Jordan), or null if it is singular. @param {number[][]} A */
function invert(A) {
  const n = A.length, M = A.map((row, i) => [...row, ...row.map((_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    const f = M[c][c];
    for (let k = 0; k < 2 * n; k++) M[c][k] /= f;
    for (let r = 0; r < n; r++) if (r !== c) { const g = M[r][c]; for (let k = 0; k < 2 * n; k++) M[r][k] -= g * M[c][k]; }
  }
  return M.map((row) => row.slice(n));
}

/** Every entry, newest first. @returns {Entry[]} */
export function entries() {
  if (!existsSync(RESULTS)) return [];
  return readdirSync(RESULTS).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(RESULTS, f), 'utf8'))).sort((a, b) => b.date.localeCompare(a.date));
}

/** Rebuilds experiments/CATALOGUE.md. */
export function catalogue() {
  const all = entries(), hash = codeHash();
  const now = all.filter((e) => e.code.hash === hash);
  const out = ['# Bot tuning experiments', '', 'Generated by `node scripts/experiment.js report` from `experiments/results/` (one entry per attempt). A measuring tool, not rules: see the design document, Appendix F.9.', '',
    `Current bot code ${hash}: ${now.length} experiments; ${all.length} entries in all.`, '',
    'Gains are for the changed seats against the same seats at the standard table on the same deals: win points a seat (± its standard error) and places gained (positive is better). Verdicts: promising (z ≥ 2, then rerun on a fresh seed: success or faded), worse (z ≤ −2), inconclusive.', ''];
  // Pooled signal per value, current code, jittered and set experiments of the group design.
  const pooled = now.filter((e) => e.design === 'group' && e.kind !== 'overnight');
  /** @type {Record<string, { x: number, y: number, w: number, n: number }[]>} */
  const by = {};
  for (const e of pooled) for (const [k, p] of Object.entries(e.params)) (by[`${e.profile} ${k}`] ??= []).push({ x: (p.value - p.base) / (p.sd || 1), y: e.metrics.gain, w: e.metrics.games, n: e.metrics.games });
  if (Object.keys(by).length) {
    out.push('## Pooled signal by value (current code)', '', 'Each value, over every experiment that moved it: the placing gain against how far it moved (x, in steps of its jitter), fitted weighted by games as gain = a + b·x + c·x² (a straight line below 6 experiments). b is the slope at the current value: |z| ≥ 2 says which way to move it. c < 0 is a peak; best is where the curve tops out, in steps from the current value, within the range tried. Check any reading with a set experiment before adopting.', '',
      '| profile value | experiments | games | x tried | slope b | ± | z | curve c | best | reading |', '|---|---|---|---|---|---|---|---|---|---|');
    for (const [k, rows] of Object.entries(by).sort()) {
      const fit = curve(rows);
      const lo = Math.min(...rows.map((r) => r.x)), hi = Math.max(...rows.map((r) => r.x));
      const z = fit && fit.seB ? fit.b / fit.seB : NaN;
      const best = fit && fit.c < 0 ? Math.min(hi, Math.max(lo, -fit.b / (2 * fit.c))) : null;
      const reading = !fit || !Number.isFinite(z) ? 'too few' : z >= 2 ? 'raise it' : z <= -2 ? 'lower it' : best !== null && Math.abs(best) < 0.5 && fit.c / (fit.seC || Infinity) <= -2 ? 'at its best' : 'no signal yet';
      out.push(`| ${k} | ${rows.length} | ${rows.reduce((t, r) => t + r.n, 0)} | ${lo.toFixed(1)} to ${hi.toFixed(1)} | ${fit ? sign(fit.b, 3) : '–'} | ${fit && Number.isFinite(fit.seB) ? fit.seB.toFixed(3) : '–'} | ${Number.isFinite(z) ? z.toFixed(1) : '–'} | ${fit && fit.quadratic ? sign(fit.c, 3) : '–'} | ${best === null ? '–' : sign(best, 1)} | ${reading} |`);
    }
    out.push('');
  }
  const counts = Object.entries(now.reduce((t, e) => ({ ...t, [e.verdict]: (t[e.verdict] ?? 0) + 1 }), /** @type {Record<string, number>} */ ({})));
  if (counts.length) out.push(`Verdicts on the current code: ${counts.map(([v, n]) => `${v} ${n}`).join(', ')}.`, '');
  out.push('## Testing log', '', '| when | where | profile | change | seeds × games | wins (points a seat) | placing | invaders | verdict | notes |', '|---|---|---|---|---|---|---|---|---|---|');
  for (const e of all) {
    const m = e.metrics;
    const change = e.kind === 'overnight' && !Object.keys(e.params).length ? e.variant : Object.entries(e.params).map(([k, p]) => `${k} ${p.base}→${p.value}`).join(', ');
    const note = [e.hypothesis, e.notes].filter(Boolean).join(' ').replace(/\|/g, '/').replace(/\n/g, ' ');
    out.push(`| ${e.date.slice(0, 16).replace('T', ' ')} | ${e.host} ${e.code.hash === hash ? '' : `(code ${e.code.hash})`} | ${e.profile}${e.design === 'single' ? ' (one seat)' : ''} | ${change} | ${e.runs.map((r) => `${r.seed}×${r.games}`).join(', ')} | ${sign(100 * m.dWin)} ±${(100 * m.seWin).toFixed(1)} | ${sign(m.gain, 2)} ±${m.seGain.toFixed(2)} | ${m.invA}/${m.games} vs ${m.invB}/${m.games} | ${e.verdict} | ${note} |`);
  }
  writeFileSync(CATALOGUE, `${out.join('\n')}\n`);
  return { all, now };
}

// ---------------------------------------------------------------------------
// Committing
// ---------------------------------------------------------------------------

/** Commits an experiment's files and the rebuilt log (locally; pushing is the sync step's). */
function commit(/** @type {string[]} */ files, /** @type {string} */ message) {
  catalogue();
  const rel = [...files, CATALOGUE].map((f) => f.slice(ROOT.length + 1));
  sh(['add', '--', ...rel]);
  sh(['commit', '-q', '-m', message, '--', ...rel]);
}

/**
 * Pulls others' commits, rebasing ours on them. Entries never collide (each
 * has its own file; baselines are the same wherever they are played); the
 * generated log is rebuilt from both sides when it conflicts. Anything else
 * that conflicts aborts the rebase and is reported.
 */
function pull() {
  if (sh(['pull', '-q', '--rebase', '--autostash'], true) !== null) return true;
  for (let step = 0; step < 100; step++) {
    const conflicted = (sh(['diff', '--name-only', '--diff-filter=U'], true) ?? '').split('\n').filter(Boolean);
    if (!conflicted.length) break;
    if (conflicted.some((f) => f !== CATALOGUE.slice(ROOT.length + 1))) {
      sh(['rebase', '--abort'], true);
      console.error(`pull stopped on a conflict outside the experiments (${conflicted.join(', ')}); resolve it by hand`);
      return false;
    }
    catalogue();
    sh(['add', '--', CATALOGUE.slice(ROOT.length + 1)]);
    if (sh(['rebase', '--continue'], true) !== null && !existsSync(join(ROOT, '.git', 'rebase-merge')) && !existsSync(join(ROOT, '.git', 'rebase-apply'))) break;
  }
  return !existsSync(join(ROOT, '.git', 'rebase-merge')) && !existsSync(join(ROOT, '.git', 'rebase-apply'));
}

// ---------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  /** @type {any} */
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === 'report') opts.report = true;
    else if (a === '--loop') opts.loop = true;
    else if (a === '--push') opts.push = true;
    else if (a === '--no-commit') opts.noCommit = true;
    else if (a === '--no-confirm') opts.noConfirm = true;
    else if (a === '--no-caffeinate') opts.noCaffeinate = true;
    else if (a.startsWith('--')) opts[a.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = args[++i];
  }
  if (opts.report) {
    const { all, now } = catalogue();
    console.log(`wrote ${CATALOGUE.slice(ROOT.length + 1)}: ${all.length} entries, ${now.length} on the current code`);
    return;
  }
  const count = opts.loop ? Infinity : Number(opts.count ?? 1);
  const until = opts.hours ? Date.now() + Number(opts.hours) * 3600e3 : Infinity;
  const slots = Number(opts.workers ?? availableParallelism());
  pool = new Pool(slots);
  // Enough experiments in flight to keep every slot busy (each queues its games at once).
  const parallel = Number(opts.parallel ?? Math.max(2, Math.ceil(slots / 8)));
  if (process.platform === 'darwin' && !opts.noCaffeinate) spawn('caffeinate', ['-i', '-s', '-w', String(process.pid)], { stdio: 'ignore' }).on('error', () => {}).unref(); // unref: it ends with this process and must not keep it alive
  console.error(`${slots} game slots, ${parallel} experiments at a time${opts.push ? ', pulling and pushing' : ''}${count < Infinity ? `, ${count} experiments` : ''}${until < Infinity ? `, for ${opts.hours} hours` : ''}`);
  // Git work runs one step at a time (commits, pulls), never two at once.
  let git = Promise.resolve();
  const locked = (/** @type {() => void} */ fn) => (git = git.then(fn, fn));
  /**
   * Pulls others' entries and pushes ours. New bot code is pulled only when no
   * experiment is in flight (a game reads the code when it starts), so until
   * then nothing is pulled or pushed and new entries wait, committed locally.
   */
  const sync = async () => {
    if (!opts.push) return;
    await locked(() => {
      sh(['fetch', '-q'], true);
      const incoming = (sh(['diff', '--name-only', 'HEAD...@{u}'], true) ?? '').split('\n').filter(Boolean);
      if (incoming.some((f) => CODE.includes(f))) {
        if (inflight.size) { draining = true; return; }
        draining = false;
        console.error('pulling new bot code');
      }
      if (incoming.length && !pull()) return;
      if (sh(['rev-list', '--count', '@{u}..HEAD'], true) !== '0') sh(['push', '-q'], true);
    });
  };
  let draining = false, started = 0, failed = 0;
  /** @type {Set<Promise<void>>} */
  const inflight = new Set();
  const launch = () => {
    started += 1;
    const job = (async () => {
      const { entry, files } = await experiment(opts);
      if (opts.noCommit) { catalogue(); return; }
      const m = entry.metrics;
      const change = Object.entries(entry.params).map(([k, p]) => `${k} ${p.base}→${p.value}`).join(', ');
      await locked(() => { commit(files, `Experiment: ${entry.profile} ${change} — ${entry.verdict} (wins ${sign(100 * m.dWin)} ±${(100 * m.seWin).toFixed(1)}, placing ${sign(m.gain, 2)} ±${m.seGain.toFixed(2)}; ${m.games} games, ${entry.host})`); });
    })().catch((e) => {
      // An unattended run logs a failure and goes on (one crash should not end a night's run).
      failed += 1;
      console.error(`experiment failed: ${e instanceof Error ? e.stack : e}`);
    }).finally(() => inflight.delete(job));
    inflight.add(job);
  };
  await sync();
  for (;;) {
    const more = started < count && Date.now() < until && failed < 10;
    if (draining && !inflight.size) await sync();
    while (more && !draining && inflight.size < parallel && started < count) launch();
    if (!inflight.size) break;
    await Promise.race(inflight);
    await sync();
  }
  await sync();
  if (failed && count === 1) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error(e); process.exit(1); });
