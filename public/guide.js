// @ts-check
/**
 * Telling other seats' turns and the round's end (designer, 2026-10-11): the
 * pieces a bot's turn is made of, step by step, and each fight of a round's
 * end with its numbers. Pure (no page): the worker builds the data it sends,
 * the table (app.js) and the tutorial tell it. Prototype tooling, not rules:
 * everything here is read from the engine (nextChoice, resolveFight).
 */
import { cardById, factionById, locationById, nextChoice, resolveFight, clone } from './engine.js';

/** @typedef {import('./engine.js').GameState} GameState */
/** @typedef {import('./engine.js').PlayerView} PlayerView */
/** @typedef {import('./engine.js').Move} Move */
/** @typedef {import('./engine.js').Target} Target */
/**
 * A move as another seat may see it: a hidden play (a face-down token card)
 * shows its card and where its tokens went, never which one is real.
 * @typedef {Move | { type: 'hidden', card: string, locations: string[] }} SeenMove  hidden: the card is known (its tokens' backs show it), not which token is real
 * @typedef {{ kind: 'location', location: string, label: string } | { kind: 'group', location: string, faction: string, label: string } | { kind: 'faction', faction: string, label: string } | { kind: 'direction', label: string }} Step
 * @typedef {{ loc: string, sides: { f: string, n: number, lost: number }[], sway: Record<string, number>, piles: { pid: string, f: string, n: number }[], scorched: boolean, flipped: string | null, lines: string[],
 *   place: PlayerView['board'][string], supply: Record<string, number>, players: Record<string, { standing: Record<string, number>, supply: number }> }} Fight
 */

const F = (/** @type {string} */ f) => factionById(f).name;
const L = (/** @type {string} */ l) => locationById(l).name;

/** What a viewer may see of a seat's move. @param {Move} move @param {string} pid  who made it @param {string} viewer @returns {SeenMove | null} */
export function seenBy(move, pid, viewer) {
  if (move.type === 'pick') return null; // the draft is secret
  if (pid !== viewer && move.type === 'play' && move.use === 'action' && cardById(move.card).action === 'token') {
    return { type: 'hidden', card: move.card, locations: [move.target?.location, move.target?.bluff].filter((x) => typeof x === 'string').sort() };
  }
  return move;
}

/**
 * A card action's target as the steps that build it, in the order the table
 * asks for them (the same steps a player clicks), each with a few words.
 * @param {GameState | PlayerView} state  before the move @param {string} pid @param {string} cardId @param {Target} target @returns {Step[]}
 */
export function targetSteps(state, pid, cardId, target) {
  /** @type {Step[]} */
  const steps = [];
  /** @type {Target} */
  const t = target.mode ? { mode: target.mode } : cardById(cardId).suit ? { mode: 'location' } : {};
  const real = (/** @type {string[] | undefined} */ xs) => (xs ?? []).filter((l) => l !== '__stop');
  for (let i = 0; i < 24; i++) {
    let c;
    try { c = nextChoice(/** @type {GameState} */ (state), pid, cardId, t); } catch { break; }
    if (c.kind === 'done' || c.kind === 'mode') break;
    if (c.kind === 'location') {
      /** @type {string | undefined} */
      let l;
      if (c.key === 'path') l = real(target.path)[real(t.path).length];
      else if (c.key === 'from') l = real(target.from)[real(t.from).length];
      else if (c.key === 'to' && t.moves?.length) l = target.moves?.[t.moves.length - 1]?.to;
      else l = /** @type {string | undefined} */ (target[c.key]);
      if (!l) {
        if (!c.optional) break;
        if (c.key === 'path') t.path = [...(t.path ?? []), '__stop'];
        else if (c.key === 'from') t.from = [...(t.from ?? []), '__stop'];
        else if (c.key === 'bluff') t.bluff = '';
        else break;
        continue;
      }
      const word = { location: 'at', to: 'to', from: 'from', path: 'via', bluff: 'bluff at' }[c.key] ?? 'at';
      steps.push({ kind: 'location', location: l, label: `${word} ${L(l)}` });
      if (c.key === 'path') t.path = [...(t.path ?? []), l];
      else if (c.key === 'from') t.from = [...(t.from ?? []), l];
      else if (c.key === 'to' && t.moves?.length) t.moves[t.moves.length - 1].to = l;
      else t[c.key] = l;
      continue;
    }
    if (c.kind === 'split') {
      const l = c.options.find((x) => (t.split?.[x] ?? 0) < (target.split?.[x] ?? 0));
      if (!l) break;
      steps.push({ kind: 'location', location: l, label: `1 to ${L(l)}` });
      t.split = { ...(t.split ?? {}), [l]: (t.split?.[l] ?? 0) + 1 };
      continue;
    }
    if (c.kind === 'group') {
      const g = c.key === 'lure' ? { location: target.from?.[0] ?? '', faction: target.faction ?? '' }
        : c.key === 'move' ? target.moves?.[(t.moves ?? []).length]
        : { location: target.location ?? '', faction: target.faction ?? '' };
      if (!g || !g.location || g.location === '__stop') {
        if (c.optional && c.key === 'move') { t.moves = [...(t.moves ?? []), { location: '__stop', faction: '', to: '__stop' }]; continue; }
        break;
      }
      steps.push({ kind: 'group', location: g.location, faction: g.faction, label: `the ${F(g.faction)} at ${L(g.location)}` });
      if (c.key === 'lure') Object.assign(t, { faction: g.faction, from: [g.location] });
      else if (c.key === 'move') t.moves = [...(t.moves ?? []), { location: g.location, faction: g.faction, to: '' }];
      else Object.assign(t, { location: g.location, faction: g.faction });
      continue;
    }
    if (c.kind === 'faction') {
      const key = c.key ?? 'faction';
      const f = /** @type {string | undefined} */ (target[key]);
      if (!f) break;
      steps.push({ kind: 'faction', faction: f, label: key === 'lead' ? `leading the ${F(f)}` : `the ${F(f)}` });
      t[key] = f;
      continue;
    }
    if (c.kind === 'direction') {
      if (!target.direction) break;
      steps.push({ kind: 'direction', label: `heading ${target.direction}` });
      t.direction = target.direction;
      continue;
    }
    break;
  }
  return steps;
}

/**
 * The round's fights, one at a time, from the state as play ends (before the
 * fights): each with its sides, the bids, who takes which pile, and the
 * public pieces after it (for the table to show one fight at a time). Fights
 * don't depend on each other's order (RO1); this is board order, as the
 * engine runs them. Hidden tokens flip in the fight, so nothing secret.
 * @param {GameState} before @returns {Fight[]}
 */
export function roundFights(before) {
  let cur = clone(before);
  /** @type {Fight[]} */
  const out = [];
  for (const loc of Object.keys(cur.board)) {
    const place = cur.board[loc];
    if (place.scorched || Object.values(place.tokens).filter((n) => n > 0).length < 2) continue;
    const was = cur.log.find((e) => e.round === cur.round)?.events.length ?? 0;
    const next = resolveFight(cur, loc);
    const sides = Object.entries(place.tokens).filter(([, n]) => n > 0).map(([f, n]) => ({ f, n, lost: n - (next.board[loc].tokens[f] ?? 0) }));
    /** @type {{ pid: string, f: string, n: number }[]} */
    const piles = [];
    for (const pid of cur.seating) for (const f of cur.factions) {
      const d = next.players[pid].trophies[f] - cur.players[pid].trophies[f];
      if (d > 0) piles.push({ pid, f, n: d });
    }
    const np = next.board[loc];
    out.push({
      loc, sides, sway: { ...place.sway }, piles, scorched: np.scorched, flipped: place.token ? place.token.owner : null,
      lines: (next.log.find((e) => e.round === next.round)?.events ?? []).slice(was).map((l) => l.trim()),
      place: { tokens: { ...np.tokens }, sway: { ...np.sway }, token: np.token ? { owner: np.token.owner, ...(np.token.kind ? { kind: np.token.kind } : {}) } : null, scorched: np.scorched },
      supply: { ...next.supply },
      players: Object.fromEntries(next.seating.map((id) => [id, { standing: { ...next.players[id].standing }, supply: next.players[id].supply }])),
    });
    cur = next;
  }
  return out;
}
