// @ts-check
/**
 * Card action balance study: how much each card's action can change the
 * presence the island will hold after the next reckoning.
 *
 *   node scripts/balance.js [states=300] [seed=1] [players=5] [bots=smart]
 *
 * It plays bot games and samples states at the start of turns in the play
 * phase. In each state, for every card with an action, it walks every target
 * the table would offer (nextChoice), plays it on a copy (previewTarget) and
 * reckons the copy as if the round ended now: every fight, then growth as far
 * as supply allows. The score of a target is the presence after that
 * reckoning minus the presence after reckoning the untouched board, so a
 * positive score helps the invaders and a negative one helps the island.
 *
 * A measuring tool, not a rule: one round's horizon, other players' replies
 * ignored, growth amounts only (not where leaders put it).
 */
import { createGame, applyMove, nextRandom, spec, totalPresence, cardById, nextChoice, previewTarget, resolveFight, growthDue, checkTarget } from '../public/engine.js';
import { botMove } from '../public/bots.js';

/** @typedef {import('../public/engine.js').GameState} GameState @typedef {import('../public/engine.js').Target} Target */

const LEAVES_PER_CARD = 4000;

/** @param {number} seed */
function seededRng(seed) {
  let s = seed | 0;
  return () => { const r = nextRandom(s); s = r.state; return r.value; };
}

/** Presence after fights, then growth as far as each faction's supply allows. @param {GameState} state */
function reckoned(state) {
  let s = state;
  for (const loc of Object.keys(s.board)) {
    const place = s.board[loc];
    if (!place.scorched && Object.values(place.cubes).filter((n) => n > 0).length === 2) s = resolveFight(s, loc);
  }
  let grown = 0;
  for (const f of s.factions) grown += Math.min(s.supply[f], Object.values(growthDue(s, f)).reduce((a, b) => a + b, 0));
  return totalPresence(s) + grown;
}

/** Every finished target the table offers for a card (depth-first, capped). @param {GameState} state @param {string} pid @param {string} cardId */
function targets(state, pid, cardId) {
  /** @type {Target[]} */
  const out = [];
  /** @param {Target} t */
  const walk = (t) => {
    if (out.length >= LEAVES_PER_CARD) return;
    const c = nextChoice(state, pid, cardId, t);
    const next = (/** @type {Partial<Target>} */ add) => walk({ ...structuredClone(t), ...add });
    switch (c.kind) {
      case 'done': out.push(finish(t)); return;
      case 'mode': next({ mode: 'location' }); next({ mode: 'faction' }); return;
      case 'faction': for (const f of c.options) next({ faction: f }); return;
      case 'direction': for (const d of c.options) next({ direction: d }); return;
      case 'split': for (const l of c.options) next({ split: { ...(t.split ?? {}), [l]: (t.split?.[l] ?? 0) + 1 } }); return;
      case 'group':
        for (const g of c.options) {
          if (c.key === 'lure') next({ faction: g.faction, from: [g.location] });
          else if (c.key === 'move') next({ moves: [...(t.moves ?? []), { location: g.location, faction: g.faction, to: '' }] });
          else next({ location: g.location, faction: g.faction });
        }
        if (c.optional) next({ moves: [...(t.moves ?? []), { location: '__stop', faction: '', to: '__stop' }] });
        return;
      case 'location':
        for (const l of c.options) {
          if (c.key === 'path') next({ path: [...(t.path ?? []), l] });
          else if (c.key === 'from') next({ from: [...(t.from ?? []), l] });
          else if (c.key === 'to' && t.moves?.length) { const moves = structuredClone(t.moves); moves[moves.length - 1].to = l; next({ moves }); }
          else next({ [c.key]: l });
        }
        if (c.optional) {
          if (c.key === 'bluff') next({ bluff: '' });
          else if (c.key === 'path') next({ path: [...(t.path ?? []), '__stop'] });
          else if (c.key === 'from') next({ from: [...(t.from ?? []), '__stop'] });
        }
    }
  };
  walk({});
  return out;
}

/** @param {Target} t */
function finish(t) {
  const out = structuredClone(t);
  if (out.path) out.path = out.path.filter((l) => l !== '__stop');
  if (out.from) out.from = out.from.filter((l) => l !== '__stop');
  if (out.moves) out.moves = out.moves.filter((m) => m.location !== '__stop');
  if (out.bluff === '') delete out.bluff;
  return out;
}

/** Sample play-phase states from bot games. @param {number} n @param {number} seed @param {string[]} players @param {import('../public/bots.js').Profile} profile */
function sampleStates(n, seed, players, profile) {
  const rng = seededRng(seed);
  /** @type {GameState[]} */
  const states = [];
  for (let g = 0; states.length < n; g++) {
    let game = createGame({ seed: seed * 1000 + g, players });
    for (let moves = 0; moves < 20000 && game.phase !== 'ended'; moves++) {
      if (game.phase === 'play' && !game.pending && rng() < 0.15) states.push(structuredClone(game));
      let moved = false;
      for (const playerId of game.seating) {
        const move = botMove(game, { playerId, rng, profile });
        if (!move) continue;
        game = applyMove(game, { playerId, move });
        moved = true;
        break;
      }
      if (!moved) break;
    }
  }
  return states.slice(0, n);
}

function main() {
  const [nArg = '300', seedArg = '1', playersArg = '5', profileArg = 'smart'] = process.argv.slice(2);
  const profile = /** @type {import('../public/bots.js').Profile} */ (profileArg);
  const players = ['ann', 'bob', 'cat', 'dan', 'eve'].slice(0, Number(playersArg));
  const states = sampleStates(Number(nArg), Number(seedArg), players, profile);
  const cards = spec.cards.filter((c) => c.action);
  /** @type {Record<string, { up: number[], down: number[], swing: number[], usable: number, leaves: number, capped: number }>} */
  const stats = Object.fromEntries(cards.map((c) => [c.id, { up: [], down: [], swing: [], usable: 0, leaves: 0, capped: 0 }]));
  for (const state of states) {
    const pid = state.seating[state.turn];
    const base = reckoned(state);
    for (const card of cards) {
      const ts = targets(state, pid, card.id).filter((t) => !checkTarget(state, pid, card, t));
      const st = stats[card.id];
      st.leaves += ts.length;
      if (ts.length >= LEAVES_PER_CARD) st.capped += 1;
      let up = 0, down = 0;
      for (const t of ts) {
        const { board } = previewTarget(state, pid, card.id, t);
        const d = reckoned({ ...structuredClone(state), board: structuredClone(board) }) - base;
        up = Math.max(up, d);
        down = Math.min(down, d);
      }
      if (up || down) st.usable += 1;
      st.up.push(up);
      st.down.push(down);
      st.swing.push(Math.max(up, -down));
    }
  }
  const mean = (/** @type {number[]} */ xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
  const pct = (/** @type {number[]} */ xs, /** @type {number} */ p) => { const s = xs.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0; };
  console.log(`${states.length} states, ${players.length} players, ${profile} bots. Presence change at the next reckoning (+ invaders, - island).`);
  console.log('card                            usable  best+ mean  p90  max | best- mean  p10  min | swing mean  max | targets/state');
  const rows = cards.map((c) => ({ c, st: stats[c.id] })).sort((a, b) => mean(b.st.swing) - mean(a.st.swing));
  for (const { c, st } of rows) {
    const f = (/** @type {number} */ x) => x.toFixed(1).padStart(5);
    console.log(`${c.name.padEnd(32)}${(100 * st.usable / states.length).toFixed(0).padStart(5)}%  ${f(mean(st.up))}${f(pct(st.up, 0.9))}${f(Math.max(...st.up))} | ${f(mean(st.down))}${f(pct(st.down, 0.1))}${f(Math.min(...st.down))} | ${f(mean(st.swing))}${f(Math.max(...st.swing))} | ${(st.leaves / states.length).toFixed(0)}${st.capped ? ` (capped ${st.capped}x)` : ''}`);
  }
}

main();
