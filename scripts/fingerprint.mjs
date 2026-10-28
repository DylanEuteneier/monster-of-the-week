// @ts-check
/**
 * The play fingerprint: bot games on fixed seeds, every move and the state after it recorded, so a change that
 * should not change play (a speed-up, a code clean-up, the Rust port) can be checked game by game. A checking
 * tool, not a rule.
 *
 *   node scripts/fingerprint.mjs [games=20] [seed=1] [profiles=trophy:sim=0;backer:sim=0;...] [out=file.jsonl] [check=file.jsonl] [o.variant=choice ...]
 *
 * out= writes one line per move: { g, i, pid, move, hash } (and the full state with full=1). check= replays the same
 * games and reports the first move or state that differs.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createGame, applyMove, waitingOn } from '../public/engine.js';
import { botMove } from '../public/bots.js';

const opts = Object.fromEntries(process.argv.slice(2).map((a) => a.split(/=(.*)/s).slice(0, 2)));
const games = Number(opts.games ?? 20), seed0 = Number(opts.seed ?? 1);
const options = Object.fromEntries(Object.entries(opts).filter(([k]) => k.startsWith('o.')).map(([k, v]) => [k.slice(2), v]));
const profiles = String(opts.profiles ?? 'backer:sim=0;backer:sim=0;trophy:sim=0;trophy:sim=0;trophy:sim=0').split(';');

/** The parts of a state that are the game (everything a player or rule can see). @param {any} s */
export const gameOf = (s) => ({
  phase: s.phase, round: s.round, rngState: s.rngState, seating: s.seating, factions: s.factions, supply: s.supply,
  pass: s.pass, first: s.first, turn: s.turn, passesInRow: s.passesInRow, opened: s.opened,
  board: Object.fromEntries(Object.entries(s.board).map(([l, p]) => [l, { tokens: p.tokens, sway: p.sway, scorched: p.scorched, gate: p.gate, gateLoss: p.gateLoss, altar: p.altar, study: p.study, terror: p.terror }])),
  players: Object.fromEntries(Object.entries(s.players).map(([id, p]) => [id, { group: p.group, supply: p.supply, standing: p.standing, trophies: p.trophies, hand: p.hand, kept: p.kept, batch: p.batch, picked: p.picked }])),
  growing: s.growing ?? null, night: s.night ?? null, roundPlays: s.roundPlays ?? [], result: s.result, log: s.log,
});
/** Canonical JSON (keys sorted, undefined dropped). @param {any} x @returns {string} */
const canon = (x) => (x === null || typeof x !== 'object' ? JSON.stringify(x) : Array.isArray(x) ? `[${x.map(canon).join(',')}]`
  : `{${Object.keys(x).filter((k) => x[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canon(x[k])}`).join(',')}}`);
const hash = (/** @type {any} */ s) => createHash('sha1').update(canon(gameOf(s))).digest('hex').slice(0, 16);

/** One game's moves and hashes. @param {number} g */
function play(g) {
  const players = profiles.map((_, i) => `P${i + 1}`);
  let state = createGame({ seed: seed0 + g, players, options });
  const memory = Object.fromEntries(players.map((p) => [p, {}]));
  let r = (seed0 + g) * 7919 + 1;
  const rng = () => { r = (r * 1103515245 + 12345) % 2147483648; return r / 2147483648; };
  const out = [{ g, i: 0, pid: null, move: null, hash: hash(state), ...(opts.full ? { state: gameOf(state) } : {}) }];
  for (let i = 1; state.phase !== 'ended' && i < 5000; i++) {
    const pid = waitingOn(state)[0];
    const move = botMove(state, { playerId: pid, rng, profile: profiles[players.indexOf(pid)], memory: memory[pid] });
    state = applyMove(state, { playerId: pid, move: /** @type {any} */ (move) });
    out.push({ g, i, pid, move, hash: hash(state), ...(opts.full ? { state: gameOf(state) } : {}) });
  }
  return out;
}

const want = opts.check ? readFileSync(opts.check, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : null;
const lines = [];
let bad = 0;
const t0 = performance.now();
for (let g = 0; g < games; g++) {
  const got = play(g);
  if (want) {
    const ref = want.filter((x) => x.g === g);
    const k = got.findIndex((x, i) => !ref[i] || x.hash !== ref[i].hash || canon(x.move) !== canon(ref[i].move));
    if (k >= 0 || ref.length !== got.length) { bad += 1; console.log(`game ${g}: differs at move ${k < 0 ? got.length : k}`, JSON.stringify(got[k]?.move), JSON.stringify(ref[k]?.move)); }
  }
  lines.push(...got.map((x) => JSON.stringify(x)));
}
if (opts.out) writeFileSync(opts.out, `${lines.join('\n')}\n`);
console.log(`${games} games, ${lines.length} moves, ${Math.round(performance.now() - t0)} ms${want ? `; ${bad ? `${bad} differ` : 'all match'}` : ''}`);
