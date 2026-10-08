// @ts-check
/**
 * Card action balance study, scored on the designer's provisional strength
 * ranking (Current focus 4):
 *   1. battles: altering the outcome of a large, high-trophy fight; the
 *      trophies that change hands at this round's fights, plus fights whose
 *      winner flips, weighted by the tokens lost there
 *   2. control: contested locations (two factions) where the player becomes
 *      the sole top-influence player
 *   3. movement: pieces moved or placed (faction tokens, hidden tokens) and
 *      influence placed
 *   4. rule-breaking: from the card text, not measured
 * Also the old measure: presence after reckoning (fights, then growth).
 *
 *   node scripts/balance.js [states=300] [seed=1] [players=5] [bots=smart] [option=value ...] [only=card,card] [out=file.json]
 *
 * out= also writes the scores as JSON (npm run cards:score writes
 * public/card-scores.json, which the assets page shows).
 *
 * It plays bot games and samples states at the start of turns in the play
 * phase. In each state, for every card with an action, it walks every target
 * the table would offer (nextChoice) and plays it on a copy (previewTarget).
 * Each measure takes the card's best target in that state; the table shows
 * the mean of those bests, how often the best is above zero, and the largest.
 *
 * A measuring tool, not a rule: one round's horizon, other players' replies
 * ignored, growth amounts only (not where leaders put it), ties for top
 * influence count as no one's.
 */
import { createGame, applyMove, nextRandom, spec, totalPresence, cardById, nextChoice, previewTarget, resolveFight, growthDue, checkTarget } from '../public/engine.js';
import { botMove } from '../public/bots.js';
import { writeFileSync } from 'node:fs';

/** @typedef {import('../public/engine.js').GameState} GameState @typedef {import('../public/engine.js').Target} Target */

const LEAVES_PER_CARD = 4000;

/** @param {number} seed */
function seededRng(seed) {
  let s = seed | 0;
  return () => { const r = nextRandom(s); s = r.state; return r.value; };
}

/**
 * The round's end on a copy: every fight, then growth as far as supply allows.
 * @param {GameState} state
 */
function reckon(state) {
  let s = state;
  /** @type {Record<string, { winner: string, lost: number }>} */
  const fights = {};
  for (const loc of Object.keys(s.board)) {
    const place = s.board[loc];
    const here = Object.keys(place.tokens).filter((f) => place.tokens[f] > 0);
    if (place.scorched || here.length !== 2) continue;
    const before = here.reduce((n, f) => n + place.tokens[f], 0);
    s = resolveFight(s, loc);
    const after = s.board[loc];
    const winner = here.find((f) => (after.tokens[f] ?? 0) > 0) ?? '';
    fights[loc] = { winner, lost: before - here.reduce((n, f) => n + (after.tokens[f] ?? 0), 0) };
  }
  let grown = 0;
  for (const f of s.factions) grown += Math.min(s.supply[f], Object.values(growthDue(s, f)).reduce((a, b) => a + b, 0));
  const trophies = Object.fromEntries(s.seating.map((pid) => [pid, Object.values(s.players[pid].trophies).reduce((a, b) => a + b, 0)]));
  return { presence: totalPresence(s) + grown, trophies, fights };
}

/** The sole top-influence player at a location, or null. @param {GameState['board'][string]} place */
function topOf(place) {
  const e = Object.entries(place.influence).filter(([, n]) => n > 0).sort((x, y) => y[1] - x[1]);
  return e.length && (e.length === 1 || e[0][1] > e[1][1]) ? e[0][0] : null;
}

/** @param {GameState['board'][string]} place */
const contested = (place) => !place.scorched && Object.values(place.tokens).filter((n) => n > 0).length === 2;

/**
 * Score one target against the untouched board.
 * @param {GameState} state @param {string} pid @param {ReturnType<typeof reckon>} base @param {ReturnType<typeof previewTarget>} after
 */
function score(state, pid, base, after) {
  const next = { ...structuredClone(state), board: structuredClone(after.board), players: structuredClone(after.players) };
  const r = reckon(next);
  const trophies = state.seating.reduce((n, p) => n + Math.abs(r.trophies[p] - base.trophies[p]), 0);
  let flips = 0;
  for (const loc of new Set([...Object.keys(r.fights), ...Object.keys(base.fights)])) {
    const x = base.fights[loc], y = r.fights[loc];
    if ((x?.winner ?? '') !== (y?.winner ?? '')) flips += Math.max(x?.lost ?? 0, y?.lost ?? 0);
  }
  let control = 0, moved = 0, placed = 0;
  for (const loc of Object.keys(state.board)) {
    const was = state.board[loc], now = after.board[loc];
    if (contested(now) && topOf(now) === pid && topOf(was) !== pid) control += 1;
    for (const f of new Set([...Object.keys(was.tokens), ...Object.keys(now.tokens)])) moved += Math.max(0, (now.tokens[f] ?? 0) - (was.tokens[f] ?? 0));
    if (now.token && !was.token) moved += 1;
    placed += Math.max(0, (now.influence[pid] ?? 0) - (was.influence[pid] ?? 0));
  }
  return { battle: trophies + flips, trophies, flips, control, moved, placed, presence: r.presence - base.presence };
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

/** Sample play-phase states from bot games. @param {number} n @param {number} seed @param {string[]} players @param {import('../public/bots.js').Profile} profile @param {Record<string, string>} options */
function sampleStates(n, seed, players, profile, options) {
  const rng = seededRng(seed);
  /** @type {GameState[]} */
  const states = [];
  for (let g = 0; states.length < n; g++) {
    let game = createGame({ seed: seed * 1000 + g, players, options });
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

const MEASURES = /** @type {const} */ (['battle', 'control', 'moved', 'placed', 'presence']);

function main() {
  const [nArg = '300', seedArg = '1', playersArg = '5', profileArg = 'smart'] = process.argv.slice(2).filter((a) => !a.includes('='));
  const options = Object.fromEntries(process.argv.slice(2).filter((a) => a.includes('=')).map((a) => a.split('=')));
  const only = options.only?.split(','); // only=card,card scores just those cards
  const outFile = options.out;
  delete options.only;
  delete options.out;
  const profile = /** @type {import('../public/bots.js').Profile} */ (profileArg);
  const players = ['ann', 'bob', 'cat', 'dan', 'eve'].slice(0, Number(playersArg));
  const states = sampleStates(Number(nArg), Number(seedArg), players, profile, options);
  const cards = /** @type {import('../public/engine.js').Card[]} */ (/** @type {unknown} */ ([...spec.cards, ...spec.testCards.cards])).filter((c) => c.action && (!only || only.includes(c.id)));
  /** @type {Record<string, Record<typeof MEASURES[number], number[]> & { leaves: number, capped: number, playable: number }>} */
  const stats = /** @type {any} */ (Object.fromEntries(cards.map((c) => [c.id, { ...Object.fromEntries(MEASURES.map((m) => [m, []])), leaves: 0, capped: 0, playable: 0 }])));
  for (const state of states) {
    const pid = state.seating[state.turn];
    const base = reckon(state);
    for (const card of cards) {
      const ts = targets(state, pid, card.id).filter((t) => !checkTarget(state, pid, card, t));
      const st = stats[card.id];
      st.leaves += ts.length;
      if (ts.length) st.playable += 1;
      if (ts.length >= LEAVES_PER_CARD) st.capped += 1;
      const best = Object.fromEntries(MEASURES.map((m) => [m, 0]));
      for (const t of ts) {
        const sc = score(state, pid, base, previewTarget(state, pid, card.id, t));
        for (const m of MEASURES) best[m] = m === 'presence' ? Math.max(best[m], Math.abs(sc[m])) : Math.max(best[m], sc[m]);
      }
      for (const m of MEASURES) st[m].push(best[m]);
    }
  }
  const mean = (/** @type {number[]} */ xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
  const often = (/** @type {number[]} */ xs) => `${(100 * xs.filter((x) => x > 0).length / (xs.length || 1)).toFixed(0)}%`;
  const col = (/** @type {number[]} */ xs) => `${mean(xs).toFixed(1).padStart(5)} ${often(xs).padStart(4)} ${String(Math.max(...xs)).padStart(3)}`;
  console.log(`${states.length} states, ${players.length} players, ${profile} bots, ${JSON.stringify(options)}. Each column: mean of the card's best target per state, how often above 0, largest.`);
  console.log(`${'card'.padEnd(30)} | playable | 1 battle (trophies+flips) | 2 control taken | 3 pieces moved | 3 influence placed | presence swing | targets`);
  const rows = cards.map((c) => ({ c, st: stats[c.id] })).sort((x, y) => mean(y.st.battle) - mean(x.st.battle));
  if (outFile) {
    const round1 = (/** @type {number} */ x) => Math.round(x * 10) / 10;
    const scores = Object.fromEntries(rows.map(({ c, st }) => [c.id, { playable: round1(100 * st.playable / states.length), ...Object.fromEntries(MEASURES.map((m) => [m, round1(mean(st[m]))])) }]));
    writeFileSync(outFile, `${JSON.stringify({ measured: new Date().toISOString().slice(0, 10), states: states.length, players: players.length, bots: profile, options, scores }, null, 2)}\n`);
  }
  for (const { c, st } of rows) {
    console.log(`${c.name.padEnd(30)} | ${`${(100 * st.playable / states.length).toFixed(0)}%`.padStart(8)} | ${col(st.battle).padEnd(25)} | ${col(st.control).padEnd(15)} | ${col(st.moved).padEnd(14)} | ${col(st.placed).padEnd(18)} | ${col(st.presence).padEnd(14)} | ${(st.leaves / states.length).toFixed(0)}${st.capped ? ` (capped ${st.capped}x)` : ''}`);
  }
}

main();
