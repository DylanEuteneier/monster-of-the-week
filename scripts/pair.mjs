// @ts-check
/**
 * Two tables compared deal by deal (a measuring tool, not rules). Run the
 * tournament twice with duplicate=1 and the same seed, once per table:
 *
 *   node scripts/tournament.js 20 5 duplicate=1 log=a.jsonl profiles=backer:race=3,backer:race=3,trophy,trophy,trophy
 *   node scripts/tournament.js 20 5 duplicate=1 log=b.jsonl
 *   node scripts/pair.mjs a.jsonl b.jsonl
 *
 * The seats whose profile differs between the two are the changed seats. For
 * each deal (a block of games, the same deal with the profiles rotated through
 * every seat) it takes the changed seats' wins in A less their wins in B, so
 * the luck of the deal cancels, and reports the mean difference per changed
 * seat with its standard error between deals, beside the error a comparison
 * of pooled win shares would have (2026-10-10, from the bot tuning research:
 * paired seeds and duplicate deals, compared deal by deal).
 *
 * Also the changed seats' mean placing (logs with placings: 1 is first, by
 * the winners' score and tiebreaks), a finer measure than wins alone.
 *
 * Optional: blocks=N (games per deal; default the player count).
 */
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const files = args.filter((a) => !a.includes('='));
const opts = Object.fromEntries(args.filter((a) => a.includes('=')).map((a) => a.split('=')));
if (files.length !== 2) throw new Error('usage: node scripts/pair.mjs a.jsonl b.jsonl [blocks=5]');
const load = (/** @type {string} */ f) => new Map(readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((r) => [r.g, r]));
const [A, B] = files.map(load);
const won = (/** @type {any} */ r, /** @type {string} */ p) => (r.winners.includes(p) ? 1 / r.winners.length : 0);
/** A seat's placing, 1 to n (winners tied at 1). @param {any} r @param {string} p */
const place = (r, p) => (r.winners.includes(p) ? 1 : order(r).indexOf(p) + 1);
/**
 * A game's placings: logged, or (older logs) rebuilt from its trophies and
 * standing: island, the weakest colour then the next (TS2, WT1); invaders, net
 * standing in the faction(s) with the most presence, then fewest of their
 * trophies (TH1, ET4; ties on control and affinity not rebuilt).
 * @param {any} r @returns {string[]}
 */
function order(r) {
  if (r.placings?.length) return r.placings;
  const seats = Object.keys(r.seats), t = r.trophiesByColour;
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

/** @type {Map<number, { a: number, b: number, seats: number, games: number, invA: number, invB: number }>} */
const blocks = new Map();
let n = 0;
for (const [g, a] of A) {
  const b = B.get(g);
  if (!b) continue;
  const per = Number(opts.blocks ?? Object.keys(a.seats).length);
  const changed = Object.keys(a.seats).filter((p) => a.seats[p] !== b.seats[p]);
  if (!changed.length) continue;
  const k = Math.floor(g / per);
  const x = blocks.get(k) ?? { a: 0, b: 0, seats: 0, games: 0, invA: 0, invB: 0 };
  for (const p of changed) { x.a += won(a, p); x.b += won(b, p); }
  x.seats += changed.length;
  x.games += 1;
  x.invA += a.side === 'invaders' ? 1 : 0;
  x.invB += b.side === 'invaders' ? 1 : 0;
  blocks.set(k, x);
  n += 1;
}
const xs = [...blocks.values()];
// Placings, paired game by game, where both logs have them.
const placed = [...A.keys()].filter((g) => B.has(g) && A.get(g).trophiesByColour && B.get(g).trophiesByColour).map((g) => {
  const a = A.get(g), b = B.get(g);
  const changed = Object.keys(a.seats).filter((p) => a.seats[p] !== b.seats[p]);
  return changed.map((p) => place(a, p) - place(b, p));
}).flat();
if (!xs.length) throw new Error('no paired games with changed seats');
const seats = xs.reduce((t, x) => t + x.seats, 0);
const shareA = xs.reduce((t, x) => t + x.a, 0) / seats, shareB = xs.reduce((t, x) => t + x.b, 0) / seats;
// Per deal: the difference per changed seat; the mean over deals, weighted by seats, and its standard error between deals.
const d = xs.map((x) => ({ v: (x.a - x.b) / x.seats, w: x.seats }));
const mean = d.reduce((t, x) => t + x.v * x.w, 0) / seats;
const k = d.length;
const sd = Math.sqrt(d.reduce((t, x) => t + x.w * (x.v - mean) ** 2, 0) / seats * (k / Math.max(1, k - 1)));
const se = sd / Math.sqrt(k);
// What pooling would give: two independent win shares over the same number of seats.
const seUnpaired = Math.sqrt((shareA * (1 - shareA) + shareB * (1 - shareB)) / seats);
const pc = (/** @type {number} */ v) => `${(100 * v).toFixed(1)}%`;
const games = xs.reduce((t, x) => t + x.games, 0);
console.log(`${files[0]} against ${files[1]}: ${games} paired games, ${k} deals, ${seats} changed seat-games`);
console.log(`changed seats' win share: A ${pc(shareA)}, B ${pc(shareB)} (an even share is ${pc(1 / Object.keys(A.values().next().value.seats).length)})`);
console.log(`A − B: ${(100 * mean).toFixed(1)} points a seat, ±${(100 * se).toFixed(1)} (standard error between deals; pooled shares would give ±${(100 * seUnpaired).toFixed(1)}); z ${(mean / (se || 1e-9)).toFixed(2)}`);
console.log(`the invaders' ending: A ${xs.reduce((t, x) => t + x.invA, 0)}/${games}, B ${xs.reduce((t, x) => t + x.invB, 0)}/${games}`);
if (placed.length > 1) {
  const m = placed.reduce((t, x) => t + x, 0) / placed.length;
  const sdp = Math.sqrt(placed.reduce((t, x) => t + (x - m) ** 2, 0) / (placed.length - 1));
  console.log(`placing A − B: ${m.toFixed(2)} places (negative is better), ±${(sdp / Math.sqrt(placed.length)).toFixed(2)} over ${placed.length} seat-games; z ${(-m / (sdp / Math.sqrt(placed.length) || 1e-9)).toFixed(2)}`);
}
