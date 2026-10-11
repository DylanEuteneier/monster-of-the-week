// @ts-check
/**
 * Hints (designer, 2026-10-11): a suggestion for a seat's next move, with the
 * reasons and a refresher of the rule it uses. Everywhere but multiplayer
 * games; the tutorial's first round suggests its own scripted moves.
 *
 * The move is the bot's (bots.js rankForHint: its plan, every move valued one
 * move ahead). The words are this file's: each line reports something the
 * bot's value really counts (trophies from this round's fights, sway with a
 * faction, the monster count against the mark), measured before and after the
 * move, so a hint never gives a reason the bot didn't have. Rivals' face-down
 * tokens are left out of every projection: a hint knows only what the seat
 * knows. Pure (no page): runs in the browser (tutorial) and in the worker.
 * Prototype tooling, not rules.
 */
import { cardById, factionById, locationById, describeTarget, clone, resolveFight, totalPresence, presenceOf } from './engine.js';
import { rankForHint, afterMove } from './bots.js';

/** @typedef {import('./engine.js').GameState} GameState */
/** @typedef {import('./engine.js').Move} Move */
/** @typedef {import('./bots.js').BotMemory} BotMemory */
/**
 * @typedef {{ title: string, why: string[] }} Option
 * @typedef {{ key: string, plan: string, title: string, why: string[], rule: string, others: Option[], move: Move | null, card?: string, keep?: string[], tiles: string[] }} Hint
 */

const F = (/** @type {string} */ f) => factionById(f).name;
const L = (/** @type {string} */ l) => locationById(l).name;
const plural = (/** @type {number} */ n, /** @type {string} */ w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const one = (/** @type {string} */ name) => (/ves$/.test(name) ? name.replace(/ves$/, 'f') : name.replace(/s$/, ''));
const count = (/** @type {number} */ n, /** @type {string} */ f) => (n === 1 ? `1 ${one(F(f))}` : `${n} ${F(f)}`);

/** Which hint a view is for: a hint for another moment is stale. @param {{ round: number, phase: string, turn: number, log?: unknown }} s @param {string} pid */
export function hintKey(s, pid) {
  const me = /** @type {any} */ (s).players?.[pid];
  return `${s.round}:${s.phase}:${s.turn}:${me?.hand?.length ?? 0}:${me?.kept?.length ?? 0}:${/** @type {any} */ (s).passesInRow ?? 0}:${/** @type {any} */ (s).growing?.next ?? ''}`;
}

/**
 * This round's fights as the seat can foresee them: who would take what,
 * location by location (rivals' face-down tokens left out).
 * @param {GameState} state @param {string} pid
 */
function foresee(state, pid) {
  const s = clone(state);
  for (const place of Object.values(s.board)) if (place.token && place.token.owner !== pid) place.token = null;
  /** @type {Record<string, { gains: Record<string, Record<string, number>>, lead: string | null, sway: Record<string, number> }>} */
  const out = {};
  let cur = s;
  for (const loc of Object.keys(s.board)) {
    const place = cur.board[loc];
    if (place.scorched || Object.values(place.tokens).filter((n) => n > 0).length < 2) continue;
    const next = resolveFight(cur, loc);
    /** @type {Record<string, Record<string, number>>} */
    const gains = {};
    for (const id of s.seating) for (const f of s.factions) {
      const d = next.players[id].trophies[f] - cur.players[id].trophies[f];
      if (d > 0) (gains[id] ??= {})[f] = d;
    }
    const order = s.seating.map((id) => [id, place.sway[id] ?? 0]).filter(([, n]) => Number(n) > 0).sort((a, b) => Number(b[1]) - Number(a[1]));
    const lead = order.length && (order.length === 1 || order[0][1] > order[1][1]) ? String(order[0][0]) : null;
    out[loc] = { gains, lead, sway: { ...place.sway } };
    cur = next;
  }
  return out;
}

/** The projected monster count: after this round's fights and growth, as the bot counts it. @param {GameState} s @param {string} pid */
function projectedCount(s, pid) {
  const f = clone(s);
  for (const place of Object.values(f.board)) if (place.token && place.token.owner !== pid) place.token = null;
  let cur = f;
  for (const loc of Object.keys(f.board)) if (!cur.board[loc].scorched && Object.values(cur.board[loc].tokens).filter((n) => n > 0).length === 2) cur = resolveFight(cur, loc);
  return totalPresence(cur);
}

/** The faction a plan to back one would back: the seat's best net standing (sway less trophies, as the bot counts it). @param {GameState} s @param {string} pid */
function backed(s, pid) {
  const p = s.players[pid];
  return s.factions.slice().sort((a, b) => ((p.standing[b] ?? 0) - p.trophies[b]) - ((p.standing[a] ?? 0) - p.trophies[a]))[0];
}
/** The seat's weakest trophy colour. @param {GameState} s @param {string} pid */
const weakest = (s, pid) => s.factions.slice().sort((a, b) => s.players[pid].trophies[a] - s.players[pid].trophies[b])[0];

/** The plan, in a line. @param {GameState} s @param {string} pid @param {'island' | 'invaders'} goal */
function planLine(s, pid, goal) {
  const t = Number(s.options.threshold);
  if (goal === 'invaders') {
    const f = backed(s, pid);
    return `Back the ${F(f)}. Over ${t} monsters at the end, the biggest faction wins and its sway leader with it: build your sway with them and keep the count up.`;
  }
  const w = weakest(s, pid);
  return `Trophy sets. At ${t} monsters or fewer, complete sets decide: your weakest colour is the ${F(w)} (${s.players[pid].trophies[w]}).`;
}

/**
 * What a move changes that the bot's value counts, as short lines, the ones
 * that serve the plan first.
 * @param {GameState} a @param {GameState} b @param {string} pid @param {'island' | 'invaders'} goal
 */
function reasons(a, b, pid, goal) {
  const fa = foresee(a, pid), fb = foresee(b, pid);
  const t = Number(a.options.threshold);
  const w = weakest(a, pid);
  /** @type {{ text: string, weight: number }[]} */
  const lines = [];
  // Trophies from this round's fights.
  for (const loc of new Set([...Object.keys(fa), ...Object.keys(fb)])) {
    const ga = fa[loc]?.gains[pid] ?? {}, gb = fb[loc]?.gains[pid] ?? {};
    const more = Object.keys(gb).filter((f) => (gb[f] ?? 0) > (ga[f] ?? 0));
    const lost = Object.keys(ga).filter((f) => (ga[f] ?? 0) > (gb[f] ?? 0));
    if (more.length) {
      const what = more.map((f) => count(gb[f], f)).join(' and ');
      const lead = fb[loc]?.lead === pid && fa[loc]?.lead !== pid ? ' You take the lead there.' : '';
      const set = more.includes(w) ? ` The ${F(w)} are your weakest colour.` : '';
      lines.push({ text: `In line for ${what} when ${L(loc)} fights.${lead}${set}`, weight: goal === 'island' ? 3 : 2 });
    } else if (lost.length) lines.push({ text: `Gives up ${lost.map((f) => count(ga[f], f)).join(' and ')} at ${L(loc)}.`, weight: -1 });
    if (!fa[loc] && fb[loc]) lines.push({ text: `Starts a fight at ${L(loc)}.`, weight: 1 });
    // Rivals' piles taken away.
    for (const id of a.seating.filter((x) => x !== pid)) {
      const ra = Object.values(fa[loc]?.gains[id] ?? {}).reduce((x, y) => x + y, 0), rb = Object.values(fb[loc]?.gains[id] ?? {}).reduce((x, y) => x + y, 0);
      if (rb < ra && !more.length) lines.push({ text: `Takes ${(ra - rb === 1 ? '1 trophy' : `${ra - rb} trophies`)} away from ${id} at ${L(loc)}.`, weight: 1.5 });
    }
  }
  // Sway with factions.
  const fav = backed(a, pid);
  for (const f of a.factions) {
    const d = (b.players[pid].standing[f] ?? 0) - (a.players[pid].standing[f] ?? 0);
    if (d > 0) {
      lines.push(goal === 'invaders' && f === fav
        ? { text: `+${d} sway with the ${F(f)}, the faction your plan backs.`, weight: 3 }
        : { text: `+${d} sway with the ${F(f)}: fuel to lure them later, and a bet on them.`, weight: 1.5 });
    }
  }
  // The monster count against the mark.
  const ca = projectedCount(a, pid), cb = projectedCount(b, pid);
  if (Math.abs(cb - ca) >= 2 || (ca > t) !== (cb > t)) {
    const good = goal === 'invaders' ? cb > ca : cb < ca;
    lines.push({ text: `Puts the monster count after this round's fights at about ${cb} (mark: ${t}), ${cb > ca ? 'up' : 'down'} from ${ca}${good ? ', which your plan wants' : ''}.`, weight: good ? (goal === 'invaders' ? 2.5 : 2) : 0.5 });
  }
  // A backed faction's own size (the invaders' ending goes to the biggest faction).
  if (goal === 'invaders') {
    const d = presenceOf(b, fav) - presenceOf(a, fav);
    if (d > 0) lines.push({ text: `More ${F(fav)} on the island: the biggest faction wins over the mark.`, weight: 2 });
  }
  return lines.sort((x, y) => y.weight - x.weight).map((l) => l.text);
}

/** The rule a move uses, as a refresher. @param {GameState} s @param {Move} move */
function ruleFor(s, move) {
  if (move.type === 'pass') return 'Passing isn\'t final: you can play when the turn comes back. When everyone passes in a row, the round ends and every location with two factions fights.';
  if (move.type === 'grow') return 'Growth: when a faction is short of monsters in supply, its sway leaders choose where it grows.';
  if (move.type !== 'play') return '';
  const c = cardById(move.card);
  const f = s.factions.find((x) => factionById(x).archetype === c.suit);
  if (move.use === 'sway') return `An offering: spend a suited card for its printed sway with the faction of its suit${f ? ` (the ${F(f)})` : ''}. Its action is lost.`;
  if (!c.suit) return 'Unsuited cards have no LOC or FAC: they bend the rules as the card says, and can\'t be spent for sway.';
  if (move.target?.mode === 'faction') return `FAC: the card acts on the faction of its suit${f ? `, the ${F(f)},` : ''} wherever they are.`;
  const moves = ['lure', 'draw-adjacent', 'gather-region', 'gather-neighbours', 'call-home', 'broadcast'].includes(c.action ?? '');
  return `LOC: the card acts at a location of its suit, on whichever faction is there.${moves ? ' Moving a faction costs 1 sway with it, and that sway lands with them as your bid.' : ''}`;
}

/** A move as a short title. @param {GameState} s @param {string} pid @param {Move} move */
function titleOf(s, pid, move) {
  if (move.type === 'pass') return 'Pass';
  if (move.type === 'grow') return `Grow at ${L(move.location)}`;
  if (move.type !== 'play') return '';
  const c = cardById(move.card);
  if (move.use === 'sway') {
    const f = s.factions.find((x) => factionById(x).archetype === c.suit);
    return `Spend ${c.name} for sway${f ? ` with the ${F(f)}` : ''}`;
  }
  const how = move.target?.mode === 'faction' ? ' (FAC)' : move.target?.mode === 'location' ? ' (LOC)' : '';
  return `${c.name}${how}: ${describeTarget(c.id, move.target ?? null).replace(/ \((faction|location) target\)/, '')}`;
}

/** Every location a move names, to light on the board. @param {Move} move */
function tilesOf(move) {
  if (move.type === 'grow') return [move.location];
  if (move.type !== 'play' || !move.target) return move.type === 'play' && move.location ? [move.location] : [];
  const t = move.target;
  return [...new Set([t.location, t.to, t.bluff, ...(t.from ?? []), ...(t.path ?? []), ...Object.keys(t.split ?? {}), ...(t.moves ?? []).flatMap((m) => [m.location, m.to])].filter((x) => typeof x === 'string'))];
}

/**
 * Explain a given move (the tutorial's scripted ones, or the bot's best).
 * @param {GameState} state @param {string} pid @param {Move} move @param {'island' | 'invaders'} goal @returns {Hint}
 */
export function explain(state, pid, move, goal) {
  const b = afterMove(state, pid, move);
  const why = reasons(state, b, pid, goal).slice(0, 2);
  if (move.type === 'pass' && !why.length) why.push('Nothing in your hand helps your plan right now. Passing keeps your cards, and you see the others\' moves before you commit.');
  if (!why.length) why.push('Little changes now: it sets up later plays.');
  return { key: hintKey(state, pid), plan: planLine(state, pid, goal), title: titleOf(state, pid, move), why, rule: ruleFor(state, move), others: [], move, card: move.type === 'play' ? move.card : undefined, tiles: tilesOf(move) };
}

/**
 * The hint for a seat now, or null if it has nothing to decide.
 * @param {GameState} state @param {string} pid @param {BotMemory} memory  kept by the caller, so the plan holds between hints
 * @param {Move} [given]  the move to suggest (the tutorial's scripted one); the bot's best otherwise
 * @returns {Hint | null}
 */
export function suggest(state, pid, memory, given = undefined) {
  const r = rankForHint(state, pid, memory);
  const p = state.players[pid];
  if (state.phase === 'draft') {
    if (p.picked) return null;
    const n = p.kept.length + 1;
    const keep = given?.type === 'pick' ? given.keep : r.worth.slice(0, n).map((w) => w.card);
    const fresh = keep.find((c) => !p.kept.includes(c)) ?? keep[0];
    // The new pick's reason: its best play now, explained (as the bot values a card in the draft).
    const solo = clone(state);
    solo.phase = 'play'; solo.turn = solo.seating.indexOf(pid); solo.opened = true; solo.pending = null; solo.players[pid].hand = [fresh];
    const best = rankForHint(solo, pid, { ...memory }).moves.find((m) => m.move.type === 'play');
    const how = best ? (best.move.type === 'play' && best.move.use === 'sway' ? 'spent for sway' : titleOf(solo, pid, best.move).replace(/^.*?(\((LOC|FAC)\))?: /, (_, m) => (m ? `${m} ` : ''))) : '';
    const why = best ? [`${cardById(fresh).name}, played now: ${how}. ${reasons(solo, best.s, pid, r.goal)[0] ?? ''}`.trim()] : [];
    return { key: hintKey(state, pid), plan: planLine(state, pid, r.goal), title: `Keep ${keep.map((c) => cardById(c).name).join(', ')}${p.kept.some((c) => !keep.includes(c)) ? ` (put back ${p.kept.filter((c) => !keep.includes(c)).map((c) => cardById(c).name).join(', ')})` : ''}`, why, rule: `Keep ${n} from your picks so far and this batch; the rest pass left. Your picks rejoin every new batch, so you can swap one back.`, others: [], move: { type: 'pick', keep }, keep, tiles: [] };
  }
  if (!r.moves.length && !given) return null;
  const top = given ?? r.moves[0].move;
  const hint = explain(state, pid, top, r.goal);
  // Other options: the best of the rest, one per card and use, with what each does differently.
  const seen = new Set([JSON.stringify(top.type === 'play' ? [top.card, top.use] : [top.type])]);
  for (const m of r.moves) {
    const k = JSON.stringify(m.move.type === 'play' ? [m.move.card, m.move.use] : [m.move.type]);
    if (seen.has(k) || hint.others.length >= 3) continue;
    seen.add(k);
    const why = reasons(state, m.s, pid, r.goal).slice(0, 1);
    hint.others.push({ title: titleOf(state, pid, m.move), why: why.length ? why : [m.move.type === 'pass' ? 'Wait and see.' : 'Little changes now.'] });
  }
  return hint;
}
