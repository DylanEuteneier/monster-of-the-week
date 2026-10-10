// @ts-check
/**
 * The tutorial (/tutorial): a guided walkthrough of the first draft's rules
 * (Appendix G) on a real game held in this tab, with three bots.
 *
 * Teaching order (designer, 2026-10-10): 1. how to win; 2. the sway
 * economy, from factions to the board to trophies; 3. the game's structure;
 * 4. a round played out, phase by phase.
 *
 * Three ways of showing (designer's brief; the split is Claude's judgement):
 * - modals with forward / back, for ideas that live off the board (the two
 *   endings, scoring, the economy's flow, the round's shape);
 * - a spotlight (everything but the subject dimmed, scrolled into view) with
 *   a tooltip narrating it, for pointing at the table;
 * - moves played out, animated like any game (motion.js): the first time
 *   each kind of card play comes up (the learner's own turns played for them
 *   on Next), the first fight, and growth. Everything else fast-forwards
 *   (designer, 2026-10-10: cover the main card actions, then jump ahead).
 * After round 1 the learner skips to the last round's fights, or plays on
 * against the bots; either way the game's end is explained from its real
 * result.
 *
 * Prototype tooling: it teaches the rules as the engine plays them and adds
 * none. Cards are temporary, so nothing here names a card; every number is
 * read from the game's options.
 */
import { spec, factionById, locationById, cardById, describeTarget, playerView, resolveFight, clone, listTargets, previewTarget, deckOf, printedOf, controllerOf, growthDue } from './engine.js';
import { newTable, copyTable, autoMove, nextActor, play, botPicks, check, YOU, BOTS } from './tutorial-game.js';
import { tokenHtml, cubeHtml, SEAT_COLOURS } from './pieces.js';
import { cardHtml, suitIcon } from './cards.js';
import art from './assets/sprites.json' with { type: 'json' };

/** @typedef {import('./app.js').TableHooks} TableHooks */
/** @typedef {import('./engine.js').GameState} GameState */
/** @typedef {import('./engine.js').PlayerView} PlayerView */
/** @typedef {import('./engine.js').Move} Move */

/**
 * What a step shows. A step that shows nothing runs and the next one follows.
 * @typedef {{ type: 'modal', title: string, html: string, buttons?: { label: string, primary?: boolean, run: () => void }[] }
 *   | { type: 'spot', target: string | string[], title: string, html: string, dwell?: number, auto?: boolean }
 *   | { type: 'wait' }} Show
 * @typedef {() => (Show | null | Promise<Show | null>)} Step
 */

const BOT_IDS = BOTS.map(([id]) => id);
/** How long each kind of step stays up when the tutorial runs itself (ms). */
const DWELL = { play: 1200, guided: 2400 };

/** @type {TableHooks} */
let hooks;

/** The runner. Everything a step may change is in `snapshot()`, so Back can undo it. */
const R = {
  table: newTable(),
  /** @type {Step[]} */
  queue: [],
  /** @type {{ table: import('./tutorial-game.js').Table, queue: Step[], taught: Record<string, boolean>, chapter: string }[]} */
  history: [],
  /** @type {Record<string, boolean>} things explained once, the first time they happen */
  taught: {},
  chapter: '',
  /** guided: Next by hand, the learner's moves played for them; play: runs itself, the learner moves */
  mode: /** @type {'guided' | 'play'} */ ('guided'),
  paused: false,
  busy: false,
  waiting: false,
  /** @type {ReturnType<typeof setTimeout> | null} */
  timer: null,
  /** @type {Show | null} */
  shown: null,
};

const snapshot = () => ({ table: copyTable(R.table), queue: R.queue.slice(), taught: { ...R.taught }, chapter: R.chapter });

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/** @param {unknown} value */
const esc = (value) => String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);
const F = (/** @type {string} */ f) => esc(factionById(f).name);
const L = (/** @type {string} */ l) => esc(locationById(l).name);
const who = (/** @type {string} */ pid) => (pid === YOU ? 'You' : esc(pid));
/** "plays" or "play", by who. @param {string} pid @param {string} s @param {string} [plain] */
const verb = (pid, s, plain = s.replace(/e?s$/, '')) => (pid === YOU ? plain : s);
const plural = (/** @type {number} */ n, /** @type {string} */ w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const colour = (/** @type {string} */ pid) => SEAT_COLOURS[Math.max(0, R.table.state.seating.indexOf(pid)) % SEAT_COLOURS.length];
const tokens = (/** @type {string} */ f, /** @type {number} */ n) => `<span class="tut-pieces">${Array.from({ length: n }, () => tokenHtml(f, 1)).join('')}</span>`;
const cubes = (/** @type {string} */ pid, /** @type {number} */ n) => `<span class="tut-pieces">${Array.from({ length: n }, () => cubeHtml(colour(pid), 9)).join('')}</span>`;
const view = () => playerView(R.table.state, YOU);
const opt = (/** @type {string} */ id) => Number(R.table.state.options[id]);
const rounds = () => view().rounds;

/** Your slayer group, its archetype and its faction in this game. */
function yours() {
  const v = view();
  const group = /** @type {typeof spec.slayerGroups[number]} */ (spec.slayerGroups.find((g) => g.id === v.players[YOU].group));
  const arch = /** @type {typeof spec.archetypes[number]} */ (spec.archetypes.find((a) => a.id === group.archetype));
  const faction = /** @type {string} */ (v.factions.find((f) => factionById(f).archetype === arch.id));
  return { group, arch, faction };
}

// Selectors on the table (app.js and index.html).
const SEL = {
  header: '#header',
  presence: '#board .gauge',
  factions: '#factions',
  board: '#board .map-window',
  players: '#players',
  hand: '#hand .card',
  bar: '#dock',
  supply: '#mine .chip',
  swayTab: '#sway',
  trophyTab: '#score',
  /** @param {string} loc */ hex: (loc) => `#board [data-tile="${loc}"]`,
  /** @param {string} f */ faction: (f) => `#factions .faction-row[data-faction="${f}"]`,
  /** @param {string} pid */ seat: (pid) => `#players .player[data-player="${pid}"]`,
  /** @param {string} id */ card: (id) => `#hand .card[data-card="${id}"]`,
};

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

/** @param {string} title @param {string} html @returns {Step} */
const modal = (title, html) => () => ({ type: 'modal', title, html });
/** @param {string | string[]} target @param {string} title @param {string} html @returns {Step} */
const spot = (target, title, html) => () => ({ type: 'spot', target, title, html });
/** A step that only changes the chapter shown in the tooltip. @param {string} name @returns {Step} */
const chapter = (name) => () => { R.chapter = name; return null; };
/** Put steps at the front of the queue, in order. @param {Step[]} steps */
const next = (...steps) => { R.queue.unshift(...steps); };

/** Show a game state on the table, animated (or at once; speed > 1 is faster). @param {GameState} state @param {{ instant?: boolean, speed?: number }} [o] */
const present = (state, o = {}) => hooks.present(playerView(state, YOU), BOT_IDS, o);

/** Explain something only the first time. @param {string} key */
function once(key) {
  if (R.taught[key] || R.mode !== 'guided') return false;
  R.taught[key] = true;
  return true;
}

// ---------------------------------------------------------------------------
// 1. How to win
// ---------------------------------------------------------------------------

/**
 * A demonstration: a made-up moment on a copy of the game, shown with the
 * real pieces flying as they would in play. The game itself is untouched;
 * `restore` puts the real table back. Each step shows its own "before"
 * first, so Back replays it cleanly.
 * @param {() => GameState} from @param {() => GameState} to @param {() => Show} show @returns {Step}
 */
const demo = (from, to, show) => () => present(from(), { instant: true }).then(() => lead(show(), () => present(to())));
/** Back to the real game after a demonstration. @type {Step} */
const restore = () => present(R.table.state, { instant: true }).then(() => null);

// Visual words: equations built from the real pieces, and the mechanic /
// strategy frame for the core ideas (designer, 2026-10-10: fewer words, more
// pictures; frame each core mechanic by how it works and why it matters).
/** @param {...string} parts */
const eq = (...parts) => `<div class="tut-eq">${parts.join('')}</div>`;
const op = (/** @type {string} */ s) => `<span class="tut-op">${s}</span>`;
const chip = (/** @type {string} */ s) => `<span class="tut-chip">${s}</span>`;
const frame = (/** @type {string} */ mechanic, /** @type {string} */ strategy) => `<dl class="tut-frame"><dt>Mechanic</dt><dd>${mechanic}</dd><dt>Strategy</dt><dd>${strategy}</dd></dl>`;
const more = (/** @type {string} */ label, /** @type {string} */ html) => `<details class="tut-more"><summary>${label}</summary>${html}</details>`;
/** One count per faction as tokens, the lowest picked out. @param {string[]} factions @param {number[]} counts */
const trophyRow = (factions, counts) => { const low = Math.min(...counts); return `<div class="tut-trophies">${factions.map((f, i) => `<span class="${counts[i] === low ? 'is-low' : ''}">${counts[i] ? tokens(f, counts[i]) : `<span class="tut-none">${tokenHtml(f, 1)}</span>`}<b>${counts[i]}</b></span>`).join('')}</div>`; };

/** The slayer groups at this table (yours first) and the factions in play (your nemesis first). */
function castOf() {
  const st = R.table.state;
  const { group, faction } = yours();
  const seated = st.seating.map((pid) => st.players[pid].group).filter((g) => g !== group.id);
  const groups = [group.id, ...seated, ...spec.slayerGroups.map((g) => g.id).filter((g) => g !== group.id && !seated.includes(g))];
  return { groups, factions: [faction, ...st.factions.filter((f) => f !== faction)] };
}
/** The order a column shows its items in: the first in the middle, the next two either side of it, the last two at the ends. @param {string[]} items */
const middleOut = (items) => [items[1], items[2], items[0], items[3], items[4]].filter((x) => x !== undefined);
/** Slayers against invaders: two columns, each grown out from its first item. @param {string[]} left @param {string[]} right */
const versus = (left, right) => `<div class="tut-versus"><div class="tut-side">${middleOut(left).join('')}</div><span class="tut-op">vs</span><div class="tut-side">${middleOut(right).join('')}</div></div>`;
/** Crash-in order for the items after the first: the inner pair, then the outer pair. @param {number} k  0-based index among the rest */
const wave = (k) => k + 1;
/** A slayer group in the versus layout. @param {string} id @param {boolean} _big (kept for call sites; every item looks the same) @param {number} [i] crash-in order (0: there from the start; -1: waiting for Next) @param {string} [cls] */
function groupItem(id, _big, i = 0, cls = '') {
  const g = spec.slayerGroups.find((x) => x.id === id);
  const em = /** @type {Record<string, { width: number, height: number, src: string }>} */ (art.sprites)[id];
  const seat = R.table.state.seating.find((pid) => R.table.state.players[pid].group === id);
  return `<div class="tut-cast-item${i > 0 ? ' is-new' : i < 0 ? ' is-waiting' : ''}${seat ? '' : ' is-absent'} ${cls}" style="--i:${i}">${em ? `<img class="sprite" src="${esc(em.src)}" width="${em.width * 3}" height="${em.height * 3}" alt="">` : ''}<b>${esc(g?.name ?? '')}</b><span class="small muted">${!seat ? 'not in this game' : seat === YOU ? `${esc(g?.trope ?? '')} · you` : esc(seat)}</span></div>`;
}
/** A faction in the versus layout. @param {string} f @param {boolean} first  your monster @param {number} [i] @param {string} [with_]  a group standing with this faction */
function factionItem(f, first, i = 0, with_ = '') {
  const arch = spec.archetypes.find((a) => a.id === factionById(f).archetype);
  const item = `<div class="tut-cast-item${i > 0 ? ' is-new' : i < 0 ? ' is-waiting' : ''}" style="--i:${i}">${tokenHtml(f, 3)}<b>${F(f)}</b><span class="small muted">${first ? 'your monster' : esc(arch?.name ?? '')}</span></div>`;
  return with_ ? `<div class="tut-allied">${with_}${item}</div>` : item;
}

/**
 * How the game ends, told on copies of the real board (designer, 2026-10-10:
 * the endings need explaining properly). Fights shrink presence, growth adds
 * to it; then each ending with its score, and what each makes worthless.
 * @returns {Step[]}
 */
function endingSteps() {
  const t = opt('threshold');
  const s0 = R.table.state;
  const v = playerView(s0, YOU);
  const { faction } = yours();
  const fi = v.factions.indexOf(faction);
  const total = (/** @type {GameState} */ s) => Object.values(s.board).reduce((n, p) => n + Object.values(p.tokens).reduce((a, b) => a + b, 0), 0);
  const groups = (/** @type {GameState} */ s) => Object.keys(s.board).flatMap((loc) => Object.entries(s.board[loc].tokens).filter(([, n]) => n > 0).map(([f, n]) => ({ loc, f, n })));
  /** Take n of f's tokens off loc: to your trophies, or back to its supply. @param {GameState} s @param {string} loc @param {string} f @param {number} n @param {boolean} toYou */
  const kill = (s, loc, f, n, toYou) => { const k = Math.min(n, s.board[loc].tokens[f] ?? 0); s.board[loc].tokens[f] -= k; if (toYou) s.players[YOU].trophies[f] += k; else s.supply[f] += k; };
  /** Your trophies set to these counts (from or to the factions' supplies). @param {GameState} s @param {number[]} counts */
  const trophiesTo = (s, counts) => s.factions.forEach((f, i) => { const d = (counts[i] ?? 0) - s.players[YOU].trophies[f]; s.players[YOU].trophies[f] += d; s.supply[f] -= d; });
  // Who backs whom: the group that switched sides in the opening, with its own faction.
  const { groups: cast } = castOf();
  const turn = cast[1] ?? cast[0];
  const backer = s0.seating.find((pid) => s0.players[pid].group === turn) ?? s0.seating[1];
  const backs = s0.factions.find((f) => factionById(f).archetype === spec.slayerGroups.find((g) => g.id === turn)?.archetype) ?? s0.factions[1];

  // A: two fights. The two biggest groups lose 3 each; you take one pile.
  const A = clone(s0);
  const [g1, g2] = groups(s0).sort((x, y) => y.n - x.n);
  kill(A, g1.loc, g1.f, 3, true);
  kill(A, g2.loc, g2.f, 3, false);
  // B: growth, by the engine's own rule.
  const B = clone(A);
  for (const f of B.factions) for (const [loc, n] of Object.entries(growthDue(B, f))) { const k = Math.min(n, B.supply[f]); B.board[loc].tokens[f] += k; B.supply[f] -= k; }
  const grew = Object.keys(B.board).filter((l) => B.factions.some((f) => B.board[l].tokens[f] > (A.board[l].tokens[f] ?? 0)));
  // C, D: the island wins; your trophies lopsided, then even.
  const lopsided = v.factions.map((f, i) => (i === (fi + 1) % 5 ? 0 : [4, 3, 3, 2, 3][i]));
  const even = v.factions.map((_, i) => (i === fi ? 3 : 2));
  const missing = v.factions[(fi + 1) % 5];
  const C = clone(B);
  while (total(C) > t - 3) { const g = groups(C).sort((x, y) => y.n - x.n)[0]; kill(C, g.loc, g.f, 1, false); }
  trophiesTo(C, lopsided);
  const D = clone(C);
  trophiesTo(D, even);
  // E: the invaders win: the backed faction swells across its locations.
  const E = clone(D);
  trophiesTo(E, v.factions.map((f) => (f === backs ? 1 : 0)));
  const homes = groups(E).filter((g) => g.f === backs).map((g) => g.loc);
  const spots = homes.length ? homes : Object.keys(E.board).filter((l) => !Object.values(E.board[l].tokens).some((n) => n > 0)).slice(0, 2);
  for (let k = 0; total(E) <= t + 7 && E.supply[backs] > 0; k++) { E.board[spots[k % spots.length]].tokens[backs] = (E.board[spots[k % spots.length]].tokens[backs] ?? 0) + 1; E.supply[backs] -= 1; }
  // F: the backer has built sway with it; you haven't.
  const F_ = clone(E);
  const bp = F_.players[backer];
  const want = 8;
  bp.supply -= want - bp.standing[backs];
  bp.standing[backs] = want;
  const yourScore = F_.players[YOU].standing[backs] - F_.players[YOU].trophies[backs];
  const theirScore = bp.standing[backs] - bp.trophies[backs];

  return [
    spot(SEL.presence, 'Count the monsters', `${eq(...v.factions.map((f) => tokenHtml(f, 1)), op('on the island now'), op('='), `<b>${total(s0)}</b>`)}<p>After round ${rounds()}, count the monster tokens left on the board:</p>${eq(`more than <b>${t}</b>`, op('→'), '<b>invader sway</b> decides the winner')}${eq(`<b>${t}</b> or fewer`, op('→'), '<b>complete trophy sets</b> decide the winner')}`),
    demo(() => s0, () => A, () => ({ type: 'spot', target: [SEL.hex(g1.loc), SEL.hex(g2.loc), SEL.presence, SEL.trophyTab], title: 'Fights kill monsters',
      html: `${eq(chip('fight'), op('→'), tokens(g1.f, 3), op('→'), 'trophies', op('·'), `<b>${total(A)}</b> monsters left`)}<p>The dead leave the board. Some become your trophies.</p>` })),
    demo(() => A, () => B, () => ({ type: 'spot', target: [...grew.map(SEL.hex), SEL.presence], title: 'Growth breeds more',
      html: `${eq(chip('round end'), op('→'), 'groups grow', op('·'), `<b>${total(B)}</b> monsters`)}<p>Left alone, monsters multiply.</p>` })),
    demo(() => B, () => C, () => ({ type: 'spot', target: [SEL.presence, SEL.trophyTab], title: `${t} or fewer: the slayers win`,
      html: `<p>The slayers did their job. Now the slayer with the most <b>complete sets</b> of trophies wins: you score your fewest colour.</p>${trophyRow(v.factions, lopsided)}${eq('no', tokenHtml(missing, 1), op('='), 'no complete set', op('='), '<b>0</b>')}<p class="small muted">Sway counts for nothing.</p>` })),
    demo(() => C, () => D, () => ({ type: 'spot', target: [SEL.trophyTab], title: 'Hunt every kind',
      html: `${trophyRow(v.factions, even)}${eq('2 of every colour', op('='), '2 complete sets', op('='), '<b>2</b>')}${more('Ties', 'Compare the next-fewest colour, then the next.')}` })),
    demo(() => D, () => E, () => ({ type: 'spot', target: [...homes.map(SEL.hex), SEL.presence, SEL.faction(backs)], title: `More than ${t}: the invaders win`,
      html: `${eq(tokens(backs, 3), op('most monsters'), op('→'), `<b>${F(backs)}</b> decide the winner`)}<p>The faction with the most monsters on the board takes the island, and picks its winner by sway.</p>${more('Ties', 'Factions tied on tokens: the one controlling more locations wins; still tied, they win together and scores add up.')}` })),
    demo(() => E, () => F_, () => ({ type: 'spot', target: [SEL.faction(backs), SEL.trophyTab], title: 'Its backers score',
      html: `${eq(cubes(backer, want), op('−'), '0', op('='), `<b>${theirScore}</b>`, `<span class="small">${who(backer)}</span>`)}${eq(cubes(YOU, F_.players[YOU].standing[backs]), op('−'), tokens(backs, F_.players[YOU].trophies[backs]), op('='), `<b>${yourScore}</b>`, '<span class="small">you</span>')}<p>Most sway with them, minus their trophies, wins. ${who(backer)} backed them and never hunted them. Your sets count for nothing.</p>${more('Ties', 'Fewest trophies of the winner, then affinity, then the next faction down.')}` })),
    restore,
    modal('Every move is a bet', `
      <div class="tut-cols">
        <div><h3>Hunt widely</h3>${eq(tokens(v.factions[0], 1), tokens(v.factions[1], 1), tokens(v.factions[2], 1), op('→'), 'pays if the island wins')}</div>
        <div><h3>Back a faction</h3>${eq(cubes(YOU, 3), op('→'), tokenHtml(faction, 1), op('→'), 'pays if it wins')}</div>
      </div>
      <p>Each ending makes the other half worthless. You won't know which until the end: read the table.</p>`),
  ];
}

function chapterWin() {
  const v = view();
  const { faction } = yours();
  const fi = v.factions.indexOf(faction);
  return [
    chapter('1 · The basics'),
    // The premise (designer, 2026-10-10), in three frames of one layout: one
    // slayer group against its monster; then every group against every
    // faction; then one group crossing over to back a faction.
    // One frame that escalates on Next: you against your monster, then everyone against everyone (same layout, so nothing jumps).
    ...[false, true].map((all) => () => {
      const { group } = yours();
      const { groups, factions } = castOf();
      const rest = (/** @type {number} */ i) => (all ? wave(i) : -1); // -1: hidden until Next
      return { type: /** @type {const} */ ('modal'), title: all ? 'This week, they all show up' : 'Monster of the week', html: `
        ${versus([groupItem(groups[0], true), ...groups.slice(1).map((g, i) => groupItem(g, false, rest(i)))], [factionItem(factions[0], true), ...factions.slice(1).map((f, i) => factionItem(f, false, rest(i)))])}
        ${all ? '<p><b>Every slayer group against every invader</b>, on one island. You can\'t beat them head-on, so you lure and trick them into tearing each other apart.</p>' : `<p>You're the ${esc(group.name)}. Every week a new monster comes to town, and it's up to you to stop it.</p>`}` };
    }),
    () => {
      const { groups, factions } = castOf();
      const st = R.table.state;
      // The one who crosses over: the first rival seat, backing its own archetype's faction.
      const turn = groups[1] ?? groups[0];
      const arch = spec.slayerGroups.find((g) => g.id === turn)?.archetype;
      const backs = factions.find((f) => factionById(f).archetype === arch) ?? factions[0];
      const seat = st.seating.find((pid) => st.players[pid].group === turn) ?? '';
      return { type: /** @type {const} */ ('modal'), title: 'Until someone switches sides', html: `
        ${versus(groups.map((g) => groupItem(g, false, 0, g === turn ? 'is-gone' : '')), factions.map((f) => factionItem(f, f === factions[0], 0, f === backs ? groupItem(turn, false, 0, 'tut-defect') : '')))}
        <p>It's slayers against invaders, <b>until a group decides a faction is worth backing</b>. Here ${who(seat)} ${verb(seat, 'sides', 'side')} with the ${F(backs)}: if they take the island, ${seat === YOU ? 'you win' : `${esc(seat)} wins`}.</p>` };
    },
    spot(SEL.board, 'They\'re all here already', `${eq(...view().factions.map((f) => tokenHtml(f, 2)))}<p>Every token is a monster.</p>`),
    // The two things a score is made of, before the endings that count them (designer, 2026-10-10).
    spot(SEL.faction(faction), 'Sway: your sway over a faction', `
      ${eq(cubes(YOU, 3), op('→'), tokenHtml(faction, 1))}
      <p>How much a faction has noticed you: the pull your bait and traps have on it. Back a faction, and it's your claim if it wins.</p>`),
    spot(SEL.trophyTab, 'Trophies: monsters you got killed', `
      ${eq(chip('fight'), op('→'), tokens(v.factions[(fi + 2) % 5], 2), op('→'), cubeHtml(colour(YOU), 10))}
      <p>When monsters fight, the biggest bids take the dead. Kept secret, here.</p>`),
    chapter('2 · How to win'),
    ...endingSteps(),
  ];
}

/** @param {PlayerView} v */
const totalPresence = (v) => Object.values(v.board).reduce((n, p) => n + Object.values(p.tokens).reduce((a, b) => a + b, 0), 0);

// ---------------------------------------------------------------------------
// 2. The sway economy
// ---------------------------------------------------------------------------

/**
 * The economy shown on a copy of the start: spend a card of your faction's
 * suit for sway; play a card that moves a faction into a fight, paying
 * standing (the engine's own preview of a real card in this deck); then that
 * fight. The move is the one, of every card and target, that best shows the
 * flow (it pays your faction's standing and wins you a pile).
 */
function economyDemo() {
  const s0 = R.table.state;
  const { faction, arch } = yours();
  const spend = deckOf(s0).find((id) => cardById(id).suit === arch.id) ?? null;
  const gain = spend ? Math.min(printedOf(s0, spend), s0.players[YOU].supply) : 0;
  const s1 = clone(s0);
  s1.players[YOU].supply -= gain;
  s1.players[YOU].standing[faction] += gain;
  /** @type {{ score: number, card: string, target: import('./engine.js').Target, s2: GameState, s3: GameState, loc: string } | null} */
  let best = null;
  for (const id of deckOf(s0)) {
    const c = cardById(id);
    if (!c.suit || !c.action || c.action === 'token') continue;
    let targets = [];
    try { targets = listTargets(s1, YOU, id, 30).targets; } catch { continue; }
    for (const t of targets) {
      let after;
      try { after = previewTarget(s1, YOU, id, t); } catch { continue; }
      const s2 = { ...clone(s1), board: after.board, players: after.players };
      const paid = s2.players[YOU].standing[faction] < s1.players[YOU].standing[faction];
      for (const loc of Object.keys(s2.board)) {
        const place = s2.board[loc];
        if ((place.sway[YOU] ?? 0) <= (s1.board[loc].sway[YOU] ?? 0)) continue;
        const sides = Object.entries(place.tokens).filter(([, n]) => n > 0);
        if (sides.length !== 2 || sides[0][1] === sides[1][1]) continue;
        const s3 = resolveFight(s2, loc);
        const won = Object.values(s3.players[YOU].trophies).reduce((a, b) => a + b, 0);
        // Best shows the whole contest: a rival bidding there too (each of you takes a pile), your sway paying for the lure.
        const rivals = s3.seating.filter((pid) => pid !== YOU && Object.values(s3.players[pid].trophies).reduce((x, y) => x + y, 0) > Object.values(s2.players[pid].trophies).reduce((x, y) => x + y, 0)).length;
        const mine = place.sway[YOU] ?? 0, top = Math.max(0, ...s2.seating.filter((pid) => pid !== YOU).map((pid) => place.sway[pid] ?? 0));
        const clear = top > 0 && mine > top; // you lead outright, a rival runs up
        const loserN = Math.min(sides[0][1], sides[1][1]), winnerLoss = Math.max(1, Math.floor(loserN / 2));
        const score = won + (rivals && clear ? 40 : rivals ? 15 : 0) + (loserN !== winnerLoss ? 5 : 0) + (paid ? 10 : 0) + (sides.some(([f]) => f === faction) ? 3 : 0);
        if (!best || score > best.score) best = { score, card: id, target: t, s2, s3, loc };
      }
    }
  }
  return { s0, s1, spend, gain, best };
}

function chapterEconomy() {
  const v = view();
  const { group, arch, faction } = yours();
  const mine = v.players[YOU];
  const onBoard = Object.keys(v.board).filter((l) => (v.board[l].sway[YOU] ?? 0) > 0);
  const others = v.factions.filter((f) => f !== faction);
  const both = onBoard.find((l) => Object.values(v.board[l].tokens).some((n) => n > 0)) ?? onBoard[0];
  const d = economyDemo();
  /** @type {Step[]} */
  const flow = [];
  if (d.spend) {
    flow.push(demo(() => d.s0, () => d.s1, () => ({ type: 'spot', target: [SEL.faction(faction), SEL.supply], title: '1 · Spend a card: supply → sway',
      html: `${eq(chip('supply'), op('→'), cubes(YOU, d.gain), op('→'), tokenHtml(faction, 1))}<p>Spend <b>${esc(cardById(/** @type {string} */ (d.spend)).name)}</b> for its +${d.gain}. (A demonstration.)</p>` })));
  }
  const b = d.best;
  if (b) {
    const moved = changes(d.s1, b.s2);
    const paidWith = d.s1.factions.filter((f) => b.s2.players[YOU].standing[f] < d.s1.players[YOU].standing[f]);
    const lines = (/** @type {GameState} */ x, /** @type {GameState} */ y) => {
      const was = x.log.find((e) => e.round === x.round)?.events.length ?? 0;
      return (y.log.find((e) => e.round === y.round)?.events ?? []).slice(was).map((l) => `<li>${esc(youify(l.trim()))}</li>`).join('');
    };
    flow.push(
      demo(() => d.s1, () => b.s2, () => ({ type: 'spot', target: [...moved.locs.map(SEL.hex), ...paidWith.map(SEL.faction)], title: '2 · Set the bait: sway → a bid',
        html: `${eq(...paidWith.map((f) => tokenHtml(f, 1)), cubes(YOU, 1), op('→'), chip(L(b.loc)))}<p><b>${esc(cardById(b.card).name)}</b>: ${esc(describeTarget(b.card, b.target))}.</p>` })),
      demo(() => b.s2, () => b.s3, () => ({ type: 'spot', target: [SEL.hex(b.loc), SEL.trophyTab, ...b.s3.factions.filter((f) => b.s3.players[YOU].standing[f] > b.s2.players[YOU].standing[f]).map(SEL.faction), SEL.supply], title: '3 · The fight: a bid → trophies',
        html: `<ul class="tut-changes">${lines(b.s2, b.s3)}</ul>${eq(cubes(YOU, 1), op('→'), 'half back as sway with the winner')}${more('Fight rules', 'Bigger group wins. The loser loses all its tokens there; the winner loses half that, rounded down (at least 1). Most cubes there takes the bigger pile, second the smaller. Then half the leader\'s cubes (rounded down) join their sway with the winner; the rest go home.')}` })),
    );
  }
  return [
    chapter('3 · Sway'),
    ...(both ? [spot(SEL.hex(both), 'Tokens and cubes', `${eq(tokenHtml(v.board[both] ? Object.keys(v.board[both].tokens).find((f) => v.board[both].tokens[f] > 0) ?? faction : faction, 2), op('='), 'a faction\'s monsters')}${eq(cubeHtml(colour(YOU), 12), op('='), 'your sway')}`)] : []),
    (() => {
      // A concrete example: your cubes against a rival's at one of your locations, and who takes which pile.
      const rival = R.table.state.seating.find((pid) => pid !== YOU) ?? YOU;
      const where = onBoard[0] ? L(onBoard[0]) : 'a location';
      return spot(onBoard.length ? onBoard.map(SEL.hex) : SEL.board, 'Sway on a location: a bid for the dead', `
      ${eq(cubes(YOU, 2), '<span class="small">you</span>', op('vs'), cubes(rival, 1), `<span class="small">${who(rival)}</span>`, op('at'), chip(where))}
      ${eq(chip('fight there'), op('→'), 'you take the bigger pile', tokens(others[0], 3), op('·'), `${who(rival)} the smaller`, tokens(faction, 1))}
      ${frame('When a location fights, the most cubes there takes the bigger pile of dead tokens; second most, the smaller.', 'Bid where the big fights will be.')}
      <p class="small muted">Lit: you start with a cube on each ${suitIcon(arch.id)} location.</p>`);
    })(),
    spot(SEL.faction(faction), 'Sway on a faction (A): fuel for gambits', `
      ${eq(tokenHtml(faction, 1), cubes(YOU, 1), op('→'), 'bait', op('→'), cubes(YOU, 1), op('on'), chip('location'))}
      ${frame('Each place your gambit lures a faction to costs 1 sway with it, and that cube lands there with them: your bid.', 'A faction that has never noticed you won\'t take your bait. Build sway before you need it.')}
      <p class="small muted">You start with ${mine.standing[faction]} with ${F(faction)}, ${mine.standing[others[0]]} with the rest.</p>`),
    spot(SEL.faction(faction), 'Sway on a faction (B): a bet', `
      ${eq(cubes(YOU, 6), op('−'), tokens(faction, 2), op('='), '<b>4</b>')}
      ${frame('If that faction wins the game, your sway with it, minus its trophies, is your score.', 'Back a faction you think will survive, and keep it alive.')}`),
    ...flow,
    restore,
    spot(SEL.seat(YOU), `You are the ${esc(group.name)}`, `${eq(suitIcon(arch.id), op('='), 'you win ties', op('with'), tokenHtml(faction, 1), op('and on'), suitIcon(arch.id), 'locations')}`),
  ];
}

// ---------------------------------------------------------------------------
// 3. The shape of the game
// ---------------------------------------------------------------------------

function chapterStructure() {
  const hand = /** @type {Record<string, number>} */ (spec.constants.handSize)[String(R.table.state.seating.length)];
  const s = R.table.state;
  const map = /** @type {{ regions: Record<string, { neighbours: string[] }>, locations: Record<string, { region: string }> }} */ (/** @type {unknown} */ (spec.map));
  const inRegion = (/** @type {string} */ r) => Object.keys(map.locations).filter((l) => map.locations[l].region === r);
  const { arch } = yours();
  const region = map.locations[spec.locations.find((l) => l.archetype === arch.id)?.id ?? Object.keys(map.locations)[0]].region;
  const near = map.regions[region].neighbours;
  const big = Object.keys(s.board).map((l) => ({ l, f: controllerOf(s, l), n: Math.max(0, ...Object.values(s.board[l].tokens)) })).sort((a, b) => b.n - a.n)[0];
  return [
    chapter('4 · A round'),
    modal('Every round, three phases', `
      <div class="tut-phases">
        <div><b>1 · Draft</b><span>pick ${hand} cards</span></div>
        <div><b>2 · Play</b><span>one card or pass, until all pass</span></div>
        <div><b>3 · Resolve</b><span>fights, then growth</span></div>
      </div>
      <p class="small muted">${rounds()} rounds, then the count.</p>`),
    spot(inRegion(region).map(SEL.hex), `A region: ${esc(region)}`, 'Lured monsters roam freely inside a region…'),
    spot([...inRegion(region), ...near.flatMap(inRegion)].map(SEL.hex), 'Neighbouring regions', `…and into a neighbour: ${near.map(esc).join(', ')}. No further.`),
    ...(big?.f ? [spot(SEL.hex(big.l), 'Control', `${eq(tokens(big.f, big.n), op('='), 'control')}<p>Most tokens controls. At most two factions per location; two means a fight.</p>`)] : []),
    spot(SEL.header, 'Where we are', 'Round and phase, always here.'),
  ];
}

// ---------------------------------------------------------------------------
// 4. Playing a round
// ---------------------------------------------------------------------------

/**
 * What kind of card use a move is: the round teaches each kind the first
 * time it comes up and fast-forwards the rest (designer, 2026-10-10: cover
 * the main card actions, then jump ahead).
 * @param {Move} move @returns {'sway' | 'move' | 'token' | 'special' | 'pass' | 'other'}
 */
function kindOf(move) {
  if (move.type === 'pass') return 'pass';
  if (move.type !== 'play') return 'other';
  if (move.use === 'sway') return 'sway';
  const c = cardById(move.card);
  return c.action === 'token' ? 'token' : c.suit ? 'move' : 'special';
}

/** The driver: decides what comes next from the game itself. @type {Step} */
function drive() {
  const s = R.table.state;
  if (s.phase === 'ended') { next(...endSteps()); return null; }
  if (s.round === 2 && !R.taught.roundOneDone) {
    R.taught.roundOneDone = true;
    next(choiceStep);
    return null;
  }
  if (s.phase === 'draft') { next(...draftSteps(), drive); return null; }
  const actor = nextActor(s);
  if (!actor) return null;
  if (s.phase === 'play' && R.mode === 'guided' && !R.taught.playIntro) {
    R.taught.playIntro = true;
    R.chapter = '5 · Play';
    const first = /** @type {string} */ (s.first);
    next(spot(SEL.players, 'Who goes first', `${who(first)} ${verb(first, 'holds', 'hold')} the earliest marked card (A–D), so ${first === YOU ? 'you open' : `${esc(first)} opens`} with it. Then round the table. We'll stop at each new kind of play and skip the rest.`), drive);
    return null;
  }
  if (actor === YOU && R.mode === 'play') { next(waitStep, drive); return null; }
  if (R.mode === 'guided') {
    // Teach a turn if it's the learner's first, or the first of its kind; otherwise fast-forward it.
    const move = /** @type {Move} */ (autoMove(R.table, actor));
    const kind = kindOf(move);
    const fresh = (actor === YOU && !R.taught.yourTurn) || (kind !== 'other' && !R.taught[`kind:${kind}`]);
    if (fresh) {
      R.taught[`kind:${kind}`] = true;
      next(...turnSteps(actor, move, true), drive);
    } else next(fastStep(actor, move), drive);
    return null;
  }
  next(...turnSteps(actor), drive);
  return null;
}

/** A turn played quickly with no stop (its pieces still fly). @param {string} pid @param {Move} move @returns {Step} */
function fastStep(pid, move) {
  return () => {
    const s = R.table.state;
    if (move.type === 'pass' && s.phase === 'play' && s.passesInRow === s.seating.length - 1) {
      hooks.ui.note = null;
      next(...resolveSteps(pid, move, 'teach'));
      return null;
    }
    play(R.table, pid, move);
    hooks.ui.note = 'Fast-forward';
    return present(R.table.state, { speed: 2.5 }).then(() => null);
  };
}

/** The learner's move, in play mode. @type {Step} */
function waitStep() { R.waiting = true; return { type: 'wait' }; }

/** The draft: the first pass taught in round 1, the rest fast-forwarded; in play mode, the learner picks. @returns {Step[]} */
function draftSteps() {
  const s = R.table.state;
  if (R.mode === 'play') return [waitStep, () => { botPicks(R.table); return null; }, () => present(R.table.state).then(() => null)];
  const me = s.players[YOU];
  if (s.pass > 1 || s.round > 1) {
    // Fast-forward the rest of the draft.
    return [() => {
      while (R.table.state.phase === 'draft') {
        const move = autoMove(R.table, YOU);
        if (move && !R.table.state.players[YOU].picked) play(R.table, YOU, move);
        botPicks(R.table);
      }
      hooks.ui.note = null;
      return present(R.table.state).then(() => ({ type: 'spot', target: SEL.hand, title: 'Your hand for the round', html: 'Draft skipped ahead. These are your actions for the round; unplayed cards are lost.' }));
    }];
  }
  const dealt = me.batch.length;
  return [chapter('5 · The draft'),
    spot(SEL.hand, 'The draft: keep one, pass the rest', `${eq(chip(`${dealt} cards`), op('→'), 'keep 1', op('→'), 'pass on', op('→'), 'keep 2…')}<p class="small muted">${plural(s.leftOut.length, 'card')} left out unseen. The whole pool returns every round.</p>`),
    () => {
      const id = me.batch.find((c) => cardById(c).suit) ?? me.batch[0];
      const c = cardById(id);
      const sf = /** @type {string} */ (R.table.state.factions.find((f) => factionById(f).archetype === c.suit) ?? '');
      return { type: 'spot', target: SEL.card(id), title: 'Every card: one use', html: c.suit
        ? `${eq(chip('action'), op('or'), chip(`+${view().printed[id]}`), op('→'), tokenHtml(sf, 1))}<p>Its action aims at a ${suitIcon(c.suit)} location (LOC) or at ${F(sf)} anywhere (FAC).</p>`
        : `${eq(chip('action'), op('only'))}<p>Unsuited: no sway, a stronger action. A–D also decide who goes first.</p>` };
    },
    () => {
      const move = autoMove(R.table, YOU);
      if (!move || move.type !== 'pick') return null;
      hooks.setKeep(move.keep);
      pickMove = move;
      return { type: 'spot', target: SEL.hand, title: 'Keep 1', html: `We keep <b>${esc(cardById(move.keep[0]).name)}</b>.` };
    }, () => {
      if (!pickMove) return null;
      play(R.table, YOU, pickMove);
      pickMove = null;
      botPicks(R.table);
      const after = R.table.state;
      return present(after).then(() => (after.phase === 'draft' ? { type: 'spot', target: SEL.hand, title: 'A new batch', html: `From ${esc(after.seating[after.seating.length - 1])}, with your card back in. Keep ${after.players[YOU].kept.length + 1} now.` } : null));
    }];
}
/** The pick shown with ticks, applied on the next step. @type {Move | null} */
let pickMove = null;

/** The pieces that changed between two states, location by location, in words. @param {GameState} a @param {GameState} b */
function changes(a, b) {
  /** @type {string[]} */
  const locs = [];
  const lines = Object.keys(b.board).map((loc) => {
    const pa = a.board[loc], pb = b.board[loc];
    const parts = b.factions.map((f) => [f, (pb.tokens[f] ?? 0) - (pa.tokens[f] ?? 0)]).filter(([, n]) => n)
      .map(([f, n]) => `${Number(n) > 0 ? '+' : '−'}${Math.abs(Number(n))} ${F(String(f))}`);
    for (const pid of b.seating) {
      const n = (pb.sway[pid] ?? 0) - (pa.sway[pid] ?? 0);
      if (n) parts.push(`${n > 0 ? '+' : '−'}${Math.abs(n)} ${cubeHtml(colour(pid), 9)} ${who(pid)}`);
    }
    if (!pa.token && pb.token) parts.push('a face-down token');
    if (!parts.length) return '';
    locs.push(loc);
    return `<li><b>${L(loc)}</b>: ${parts.join(', ')}</li>`;
  }).filter(Boolean);
  return { locs, html: lines.length ? `<ul class="tut-changes">${lines.join('')}</ul>` : '' };
}

/** What a move did, in words, and what to point at. @param {string} pid @param {Move} move @param {GameState} a @param {GameState} b @returns {Show} */
function narrate(pid, move, a, b) {
  if (move.type === 'play' && move.use === 'sway') {
    const c = cardById(move.card);
    const f = /** @type {string} */ (b.factions.find((x) => factionById(x).archetype === c.suit));
    const gain = b.players[pid].standing[f] - a.players[pid].standing[f];
    const teach = once('sway') ? '<p class="small muted">Supply → sway: pull for your gambits, and a bet on that faction.</p>' : '';
    return { type: 'spot', target: SEL.faction(f), title: `${who(pid)} ${verb(pid, 'spends')} ${esc(c.name)}`, html: `${eq(cubes(pid, gain), op('→'), tokenHtml(f, 1), `<b>+${gain}</b>`)}${teach}`, auto: pid !== YOU && !teach };
  }
  if (move.type === 'play') {
    const c = cardById(move.card);
    const ch = changes(a, b);
    const what = c.action === 'token' ? (pid === YOU ? describeTarget(c.id, move.target ?? null) : 'two face-down tokens: one real, one bluff') : describeTarget(c.id, move.target ?? null);
    // Paid from standing onto the board (a move), not from the supply (a token's marker cube).
    const placed = b.seating.some((x) => b.factions.some((f) => b.players[x].standing[f] < a.players[x].standing[f]) && Object.keys(b.board).some((l) => (b.board[l].sway[x] ?? 0) > (a.board[l].sway[x] ?? 0)));
    const teach = [
      placed && once('move') ? '<p class="small muted">Sway spent on the lure → a bid on the board.</p>' : '',
      c.action === 'token' && once('token') ? '<p class="small muted">Face-down: one real, one bluff. Each cube counts as a bid. They flip at the fight.</p>' : '',
      !c.suit && c.marked && once('marked') ? `<p class="small muted">Marked ${esc(c.marked)}: opened the round.</p>` : '',
      !c.suit && c.action !== 'token' && once('special') ? '<p class="small muted">Unsuited: no sway, bends a rule.</p>' : '',
    ].join('');
    return { type: 'spot', target: ch.locs.length ? ch.locs.map(SEL.hex) : SEL.seat(pid), title: `${who(pid)} ${verb(pid, 'plays')} ${esc(c.name)}`,
      html: `<div class="tut-card">${cardHtml(c.id, { view: playerView(b, YOU) })}</div><p>${esc(what)}${ch.locs.length ? '' : ': no effect'}.</p>${teach}`, auto: pid !== YOU && !teach, dwell: 3200 };
  }
  if (move.type === 'pass') {
    const teach = once('pass') ? '<p>Not final: play again when the turn returns. All pass in a row → the round ends.</p>' : '';
    return { type: 'spot', target: SEL.seat(pid), title: `${who(pid)} ${verb(pid, 'passes', 'pass')}`, html: teach || `<p>${plural(b.passesInRow, 'pass')} in a row.</p>`, auto: pid !== YOU && !teach };
  }
  if (move.type === 'grow') return { type: 'spot', target: SEL.hex(move.location), title: `${who(pid)} ${verb(pid, 'chooses')} where a faction grows`, html: `<p>Short supply: its sway leaders choose ${L(move.location)}.</p>` };
  return { type: 'spot', target: SEL.bar, title: who(pid), html: '' };
}

/**
 * One turn: in guided mode the learner's move is shown before it's played;
 * then it's played and narrated. `taught` marks a turn the guided round stops
 * on (otherwise bots' turns run by themselves).
 * @param {string} pid @param {Move} [given] @param {boolean} [taught] @returns {Step[]}
 */
function turnSteps(pid, given, taught = false) {
  /** @type {Move | null} */
  let move = given ?? null;
  /** @type {Step[]} */
  const steps = [() => {
    move ??= autoMove(R.table, pid);
    return null;
  }];
  if (pid === YOU && R.mode === 'guided') {
    steps.push(() => {
      if (R.taught.yourTurn) return null;
      R.taught.yourTurn = true;
      hooks.ui.note = null;
      const s = R.table.state;
      const mustOpen = s.first === YOU && !s.opened;
      return { type: 'spot', target: SEL.hand, title: 'Your turn', html: `${eq(chip('play a card'), op('or'), chip('pass'))}${mustOpen ? '<p>You must open with your marked card.</p>' : ''}` };
    }, () => {
      const m = /** @type {Move} */ (move);
      if (m.type === 'play' && m.use === 'action' && m.target) {
        try { hooks.choose(m.card, m.target); } catch { hooks.choose(null); }
        return { type: 'spot', target: SEL.card(m.card), title: `We'll play ${esc(cardById(m.card).name)}`, html: `<p>Its action: ${esc(describeTarget(m.card, m.target))}.</p><p class="small muted">Playing for real: click the card, then its targets.</p>` };
      }
      if (m.type === 'play') {
        return { type: 'spot', target: SEL.card(m.card), title: `We'll spend ${esc(cardById(m.card).name)}`, html: `${eq(chip(`+${view().printed[m.card]}`), op('→'), 'sway', op('instead of'), 'its action')}` };
      }
      return { type: 'spot', target: SEL.bar, title: 'We\'ll pass', html: 'Nothing worth playing yet.' };
    });
  }
  steps.push(() => {
    const m = /** @type {Move} */ (move);
    hooks.ui.note = null;
    hooks.choose(null);
    const s = R.table.state;
    if (m.type === 'pass' && s.phase === 'play' && s.passesInRow === s.seating.length - 1) {
      next(...resolveSteps(pid, m, R.mode === 'guided' ? 'teach' : 'show'));
      return null;
    }
    const before = s;
    play(R.table, pid, m);
    const after = R.table.state;
    const shown = narrate(pid, m, before, after);
    if (taught && shown.type === 'spot') shown.auto = false;
    return lead(shown, () => present(after)).then(() => (R.mode === 'play' && pid === YOU ? null : shown));
  });
  return steps;
}

/**
 * The last pass: the round's fights, then growth. The fights are shown on
 * copies (the engine's own fight, a location at a time, in board order as at
 * round end); the game itself moves on with the real pass.
 * - teach: the first fight before and after, the rest fast-forwarded into one summary;
 * - show: every fight in turn, each on its own (play mode, the final round).
 * @param {string} pid @param {Move} move @param {'teach' | 'show'} style @returns {Step[]}
 */
function resolveSteps(pid, move, style) {
  const start = clone(R.table.state);
  for (const id of start.seating) start.players[id].hand = [];
  start.pending = null;
  const fights = Object.keys(start.board).filter((l) => !start.board[l].scorched && Object.values(start.board[l].tokens).filter((n) => n > 0).length === 2);
  /** @type {GameState[]} */
  const chain = [start];
  for (const loc of fights) chain.push(resolveFight(chain[chain.length - 1], loc));
  const end = chain[chain.length - 1];
  const teach = style === 'teach';
  /** @type {Step[]} */
  const steps = [() => {
    if (teach) R.chapter = '5 · Resolve';
    hooks.ui.note = 'Resolve: fights';
    return present(start).then(() => ({ type: 'spot', target: fights.length ? fights.map(SEL.hex) : SEL.board, title: `${who(pid)} ${verb(pid, 'passes', 'pass')}: play is over`,
      html: `${fights.length ? `${eq(op('2 factions'), op('='), 'a fight')}<p>${plural(fights.length, 'fight')} now. Unplayed cards are lost.</p>` : '<p>No location holds two factions: no fights.</p>'}`, dwell: 1800 }));
  }];
  fights.forEach((loc, i) => {
    const a = chain[i], b = chain[i + 1];
    if (teach && i > 0) return;
    if (teach) steps.push(() => present(a, { instant: true }).then(() => ({ type: 'spot', target: SEL.hex(loc), title: `Fight at ${L(loc)}`, html: before(a, loc) })));
    steps.push(() => present(a, { instant: true }).then(() => lead({ type: 'spot', target: SEL.hex(loc), title: `Fight at ${L(loc)}`, html: after(a, b, loc), dwell: 2600 }, () => present(b))));
  });
  if (teach && fights.length > 1) {
    // The rest fast-forwarded, summed up in one step.
    steps.push(() => {
      hooks.ui.note = 'Resolve: fast-forward';
      let p = Promise.resolve();
      for (let i = 1; i < fights.length; i++) p = p.then(() => present(chain[i + 1], { speed: 2 }));
      const lines = fights.slice(1).map((loc, i) => after(chain[i + 1], chain[i + 2], loc)).join('');
      return p.then(() => ({ type: 'spot', target: fights.slice(1).map(SEL.hex), title: `${plural(fights.length - 1, 'more fight')}`, html: `<p class="small muted">Same rules, skipped ahead:</p>${lines}` }));
    });
  }
  steps.push(() => {
    play(R.table, pid, move);
    const post = R.table.state;
    // Growth on the round that just ended (the new round's deal is shown next).
    const shown = post.phase === 'growth' ? post : { ...clone(end), board: clone(post.board), supply: { ...post.supply } };
    hooks.ui.note = 'Resolve: growth';
    const grew = Object.keys(post.board).filter((l) => post.factions.some((f) => (post.board[l].tokens[f] ?? 0) > (end.board[l].tokens[f] ?? 0)));
    const g = opt('growth');
    const lesson = once('growth') ? `${eq(chip(`${g}+ tokens alone`), op('→'), '+1', op('·'), 'own ground it controls', op('→'), '+1 more')}<p class="small muted">Left alone, factions snowball.</p>` : '';
    return present(end, { instant: true }).then(() => lead({ type: 'spot', target: grew.length ? grew.map(SEL.hex) : SEL.board, title: 'Growth',
      html: `<p>${grew.length ? `${plural(grew.length, 'location')} grew.` : 'Nothing grew.'}</p>${lesson}` }, () => present(shown)));
  }, () => {
    hooks.ui.note = null;
    const s = R.table.state;
    return present(s).then(() => null);
  });
  return steps;
}

/** A fight before it happens. @param {GameState} s @param {string} loc */
function before(s, loc) {
  const place = s.board[loc];
  const sides = Object.entries(place.tokens).filter(([, n]) => n > 0).map(([f, n]) => `${tokens(f, n)}<b>${n}</b>`);
  const bids = s.seating.map((pid) => [pid, place.sway[pid] ?? 0]).filter(([, n]) => Number(n) > 0).sort((x, y) => Number(y[1]) - Number(x[1]));
  const teach = once('fightBefore') ? '<p class="small muted">Bigger group wins. Most cubes takes the bigger pile; second, the smaller.</p>' : '';
  return `${eq(sides[0] ?? '', op('vs'), sides[1] ?? '')}${bids.length ? eq(...bids.map(([pid, n]) => `${cubes(String(pid), Number(n))}<span class="small">${who(String(pid))}</span>`)) : '<p>No bids here: the dead go back to their supplies.</p>'}${place.token ? '<p class="small">A face-down token will flip.</p>' : ''}${teach}`;
}

/** The engine's log lines speak of the learner's seat in the third person ("You takes"); put them in the second. @param {string} line */
const youify = (line) => line.replace(/\bYou takes\b/g, 'You take').replace(/\bYou's\b/g, 'Your').replace(/\bYou passes\b/g, 'You pass').replace(/\bYou plays\b/g, 'You play');

/** A fight's result, from the engine's own log lines. @param {GameState} a @param {GameState} b @param {string} loc */
function after(a, b, loc) {
  const was = a.log.find((e) => e.round === a.round)?.events.length ?? 0;
  const lines = (b.log.find((e) => e.round === b.round)?.events ?? []).slice(was).map((l) => `<li>${esc(youify(l.trim()))}</li>`).join('');
  const tie = b.board[loc].scorched;
  const teach = tie && once('scorch') ? '<p class="small muted">A true tie: equal groups, neither on its own ground. Both wiped out, nobody collects, the location is gone for good.</p>'
    : once('fightAfter') ? `${eq('loser', op('→'), 'loses all', op('·'), 'winner', op('→'), 'loses half that (min 1)')}${eq('leader\'s cubes', op('→'), 'half to sway with the winner')}` : '';
  return `<ul class="tut-changes">${lines}</ul>${teach}`;
}

/** After round 1: skip to the end, or play on. @type {Step} */
function choiceStep() {
  const t = opt('threshold');
  return { type: 'modal', title: 'That was a round', html: `
    ${eq(chip('draft'), op('→'), chip('play'), op('→'), chip('fights'), op('→'), chip('growth'))}
    <p>Presence ${totalPresence(view())} against ${t}, ${plural(rounds() - 1, 'round')} to go. Skip to the ending, or play on yourself.</p>`,
  buttons: [
    { label: 'Play the rest', run: () => { R.mode = 'play'; R.chapter = 'Your game'; next(drive); void go(); } },
    { label: 'Skip to the end', primary: true, run: () => { next(skipStep, drive); void go(); } },
  ] };
}

/** Fast-forward (unseen) to the last round's final pass, then show its fights and the end. @type {Step} */
function skipStep() {
  R.chapter = 'The end';
  const last = rounds();
  /** @type {{ pid: string, move: Move } | null} */
  let final = null;
  for (let i = 0; i < 5000 && !final && R.table.state.phase !== 'ended'; i++) {
    const s = R.table.state;
    if (s.phase === 'draft') {
      const move = autoMove(R.table, YOU);
      if (move && !s.players[YOU].picked) play(R.table, YOU, move);
      botPicks(R.table);
      continue;
    }
    const pid = /** @type {string} */ (nextActor(s));
    const move = /** @type {Move} */ (autoMove(R.table, pid));
    if (s.round === last && s.phase === 'play' && move.type === 'pass' && s.passesInRow === s.seating.length - 1) final = { pid, move };
    else play(R.table, pid, move);
  }
  return present(R.table.state, { instant: true }).then(() => {
    if (final) next(...resolveSteps(final.pid, final.move, 'show').map((step) => () => Promise.resolve(step()).then((sh) => (sh && sh.type === 'spot' ? { ...sh, auto: false } : sh))));
    return { type: 'spot', target: SEL.presence, title: `Round ${last}: the last fights`, html: `<p>Rounds 2–${last} skipped ahead. The last fights decide it.</p>` };
  });
}

/** The end of the game, from its real result. @returns {Step[]} */
function endSteps() {
  return [() => present(R.table.state).then(() => {
    R.mode = 'guided';
    R.chapter = 'The end';
    const v = view();
    const r = /** @type {NonNullable<PlayerView['result']>} */ (v.result);
    const t = opt('threshold');
    return { type: 'spot', target: SEL.presence, title: 'The count', html: `Total presence is <b>${totalPresence(v)}</b>: ${r.side === 'island' ? `not more than ${t}, so <b>the island wins</b>` : `more than ${t}, so <b>the invaders win</b>`}.` };
  }), () => {
    const v = view();
    const r = /** @type {NonNullable<PlayerView['result']>} */ (v.result);
    const mine = v.me.trophies;
    const rows = v.seating.slice().sort((x, y) => r.scores[y] - r.scores[x]).map((pid) => `<li>${cubeHtml(colour(pid), 10)} ${who(pid)}: <b>${r.scores[pid]}</b>${r.players.includes(pid) ? ' <span class="tag">wins</span>' : ''}</li>`).join('');
    const how = r.side === 'island'
      ? `<p>The island won, so each score is the trophies of the colour held fewest of. Yours:</p><div class="tut-trophies">${v.factions.map((f) => `<span>${tokens(f, mine[f])}<b>${mine[f]}</b></span>`).join('')}</div>`
      : `<p>${r.factions.map(F).join(' and ')} won, so each score is standing with ${r.factions.length > 1 ? 'them' : 'it'} minus trophies of ${r.factions.length > 1 ? 'them' : 'it'}. Yours: ${r.factions.map((f) => `${v.players[YOU].standing[f]} − ${mine[f]}`).join(' + ')}.</p>`;
    const best = Math.max(...v.seating.map((pid) => r.scores[pid]));
    const tied = v.seating.filter((pid) => r.scores[pid] === best);
    const tie = tied.length > 1 ? `<p class="small">${tied.map(who).join(', ')} tied on ${best}. ${r.side === 'island' ? 'Ties go to the next-fewest colour, then the next.' : 'Ties go to the fewest trophies of the winning faction, then affinity, then the next faction down.'}${r.players.length > 1 ? ' Still tied, they share the win.' : ''}</p>` : '';
    return { type: 'modal', title: r.players.includes(YOU) ? 'You win!' : `${r.players.map(esc).join(' and ')} ${r.players.length > 1 ? 'win' : 'wins'}`, html: `${how}${tie}<ol class="tut-list tut-scores">${rows}</ol><p class="small muted">That's the whole game. Start a real one from the host page.</p>`,
      buttons: [{ label: 'Start over', run: () => location.reload() }, { label: 'Host page', primary: true, run: () => { location.href = '/host'; } }] };
  }];
}

// ---------------------------------------------------------------------------
// The runner
// ---------------------------------------------------------------------------

/** Run steps until one shows something. */
async function go() {
  if (R.busy) return;
  R.busy = true;
  clearTimer();
  hideAll();
  try {
    for (;;) {
      const step = R.queue.shift();
      if (!step) break;
      const snap = snapshot();
      snap.queue.unshift(step);
      const show = await step();
      if (!show) continue;
      R.history.push(snap);
      display(show);
      break;
    }
  } finally {
    R.busy = false;
  }
}

/** Back one shown step: restore the game as it was before it, and show it again. */
async function back() {
  if (R.busy || R.mode !== 'guided' || R.history.length < 2) return;
  clearTimer();
  R.history.pop();
  const snap = /** @type {(typeof R.history)[number]} */ (R.history.pop());
  R.table = copyTable(snap.table);
  R.queue = snap.queue.slice();
  R.taught = { ...snap.taught };
  R.chapter = snap.chapter;
  pickMove = null;
  hooks.ui.note = null;
  hooks.choose(null);
  await present(R.table.state, { instant: true });
  return go();
}

function clearTimer() {
  if (R.timer) clearTimeout(R.timer);
  R.timer = null;
}

// ---------------------------------------------------------------------------
// The overlay: spotlight, tooltip, modal
// ---------------------------------------------------------------------------

/** @type {{ root: HTMLElement, block: HTMLElement, dim: SVGSVGElement, holes: SVGGElement, tip: HTMLElement, wrap: HTMLElement, modal: HTMLElement }} */
let el;
/** The elements spotlit now. @type {string[]} */
let lit = [];

function build() {
  const root = document.createElement('div');
  root.className = 'tut';
  // The spotlight: a dimmed layer with a hole cut for each lit element (a hexagon for a hex), so several places can be lit at once.
  root.innerHTML = `<div class="tut-block"></div>
    <svg class="tut-dim" hidden aria-hidden="true"><defs><mask id="tut-holes"><rect width="100%" height="100%" fill="white"/><g class="tut-holes" fill="black"></g></mask></defs><rect class="tut-dim-fill" width="100%" height="100%" mask="url(#tut-holes)"/></svg>
    <div class="tut-tip" role="dialog" aria-live="polite" hidden></div>
    <div class="tut-wrap" hidden><div class="tut-modal panel" role="dialog" aria-modal="true"></div></div>`;
  document.body.appendChild(root);
  const q = (/** @type {string} */ s) => /** @type {HTMLElement} */ (root.querySelector(s));
  el = { root, block: q('.tut-block'), dim: /** @type {SVGSVGElement} */ (/** @type {unknown} */ (q('.tut-dim'))), holes: /** @type {SVGGElement} */ (/** @type {unknown} */ (q('.tut-holes'))), tip: q('.tut-tip'), wrap: q('.tut-wrap'), modal: q('.tut-modal') };
  root.addEventListener('click', (event) => {
    const b = event.target instanceof HTMLElement ? event.target.closest('[data-tut]') : null;
    if (!b) return;
    const what = /** @type {HTMLElement} */ (b).dataset.tut;
    if (what === 'next') void go();
    if (what === 'back') void back();
    if (what === 'pause') { R.paused = !R.paused; if (R.paused) clearTimer(); else void go(); renderTipNav(); }
    if (what === 'leave' && confirm('Leave the tutorial?')) location.href = '/host';
    if (what?.startsWith('button:')) R.shown?.type === 'modal' && R.shown.buttons?.[Number(what.slice(7))]?.run();
  });
  document.addEventListener('keydown', (event) => {
    if (R.shown?.type === 'wait' || (R.shown?.type === 'modal' && R.shown.buttons)) return;
    if (event.key === 'ArrowRight' || event.key === 'Enter') { event.preventDefault(); void go(); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); void back(); }
  });
  const follow = () => { place(); requestAnimationFrame(follow); };
  requestAnimationFrame(follow);
}

function hideAll() {
  el.dim.toggleAttribute('hidden', true);
  el.tip.hidden = true;
  el.wrap.hidden = true;
  lit = [];
}

/** The nav row: chapter, Back, Next (or Pause in the modes that run themselves), Leave. */
function nav() {
  const guided = R.mode === 'guided';
  const backBtn = guided ? `<button class="btn" data-tut="back"${R.history.length < 2 ? ' disabled' : ''}>Back</button>` : '';
  const auto = !guided || (R.shown?.type === 'spot' && !!R.shown.auto);
  const go_ = !auto ? '<button class="btn btn-primary" data-tut="next">Next</button>'
    : `<button class="btn" data-tut="pause">${R.paused ? 'Resume' : 'Pause'}</button>${R.paused ? '<button class="btn btn-primary" data-tut="next">Next</button>' : ''}`;
  return `<div class="tut-nav"><span class="tut-chapter">${esc(R.chapter)}</span><span class="tut-nav-btns"><button class="btn" data-tut="leave">Leave</button>${backBtn}${go_}</span></div>`;
}
function renderTipNav() {
  const n = el.tip.querySelector('.tut-nav');
  if (n) n.outerHTML = nav();
}

/** Elements fixed to the window (the hand, bar and tabs on desktop) never need scrolling to. @param {Element} x */
const fixedEl = (x) => { const f = x.closest('.dock, .hand, .side-stack'); return !!f && getComputedStyle(f).position === 'fixed'; };
const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Bring a step's subject into view before anything moves, so its pieces are
 * seen flying: all the lit places centred if they fit, else the first. The
 * hand collapses unless the step is about it.
 * @param {string | string[]} target @returns {Promise<void>}
 */
function focusOn(target) {
  const sels = [target].flat();
  hooks.hand(sels.every((t) => t.startsWith('#hand')) ? 'raise' : 'tuck');
  const els = sels.flatMap((sel) => [...document.querySelectorAll(sel)]).filter((x) => !fixedEl(x));
  if (!els.length) return Promise.resolve();
  const before = window.scrollY;
  if (phone()) els[0].scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'center' });
  else {
    const rs = els.map((x) => x.getBoundingClientRect());
    const top = Math.min(...rs.map((r) => r.top)), bottom = Math.max(...rs.map((r) => r.bottom));
    const fits = bottom - top <= window.innerHeight * 0.8;
    const mid = fits ? (top + bottom) / 2 : (rs[0].top + rs[0].bottom) / 2;
    const y = Math.max(0, window.scrollY + mid - window.innerHeight / 2);
    if (Math.abs(y - before) > 4) window.scrollTo({ top: y, behavior: 'smooth' });
    else return Promise.resolve();
  }
  return sleep(450);
}

/** Point at a step's subject, then run what moves (so it's seen), then show the step. @param {Show} show @param {() => Promise<unknown>} run @returns {Promise<Show>} */
const lead = (show, run) => (show.type === 'spot' && R.mode !== 'play' ? focusOn(show.target) : Promise.resolve()).then(run).then(() => show);

/** @param {Show} show */
function display(show) {
  R.shown = show;
  R.waiting = show.type === 'wait';
  el.block.hidden = show.type === 'wait' || R.mode === 'play';
  // The hand stays collapsed unless the step is about it (or it's the learner's move).
  if (show.type === 'modal') hooks.hand('tuck');
  if (show.type === 'wait') hooks.hand('rest');
  if (show.type === 'wait') { hideAll(); return; }
  if (show.type === 'modal') {
    el.wrap.hidden = false;
    const buttons = show.buttons
      ? `<div class="tut-nav"><span class="tut-chapter">${esc(R.chapter)}</span><span class="tut-nav-btns">${R.mode === 'guided' && R.history.length > 1 ? '<button class="btn" data-tut="back">Back</button>' : ''}${show.buttons.map((b, i) => `<button class="btn${b.primary ? ' btn-primary' : ''}" data-tut="button:${i}">${esc(b.label)}</button>`).join('')}</span></div>`
      : nav();
    el.modal.innerHTML = `${show.title ? `<h2>${esc(show.title)}</h2>` : ''}<div class="tut-body">${show.html}</div>${buttons}`;
    /** @type {HTMLElement | null} */ (el.modal.querySelector('.btn-primary'))?.focus({ preventScroll: true });
    return;
  }
  lit = Array.isArray(show.target) ? show.target : [show.target];
  if (R.mode !== 'play') void focusOn(lit);
  el.dim.toggleAttribute('hidden', R.mode === 'play');
  el.tip.hidden = false;
  el.tip.classList.toggle('is-caption', R.mode === 'play');
  el.tip.style.left = ''; el.tip.style.top = ''; // each step finds its own place
  el.tip.innerHTML = `<h3>${show.title}</h3><div class="tut-body">${show.html}</div>${R.mode === 'play' ? '' : nav()}`;
  place();
  if ((R.mode !== 'guided' || show.auto) && !R.paused) R.timer = setTimeout(() => void go(), show.dwell ?? DWELL[R.mode]);
}

/** The phone layout (app.css's phone block). */
const phone = () => window.matchMedia('(max-width: 600px), (hover: none) and (pointer: coarse)').matches;

/** Keep the spotlight on its elements and the tooltip beside it (every frame: pages scroll and cards move). */
function place() {
  if (!el || el.tip.hidden || !lit.length) return;
  const vw = window.innerWidth, vh = window.innerHeight;
  const pad = 6;
  // Each lit element, clamped to the window; a hex is lit as its own hexagon.
  const lits = lit.flatMap((s, i) => [...document.querySelectorAll(s)].map((x) => ({ x, i }))).map(({ x, i }) => {
    const hex = x.matches('[data-tile]') ? x.querySelector('.hex') ?? x : null;
    const r = (hex ?? x).getBoundingClientRect();
    return { i, hex: !!hex, left: Math.max(2, r.left - (hex ? 0 : pad)), top: Math.max(2, r.top - (hex ? 0 : pad)), right: Math.min(vw - 2, r.right + (hex ? 0 : pad)), bottom: Math.min(vh - 2, r.bottom + (hex ? 0 : pad)) };
  }).filter((r) => r.right > r.left && r.bottom > r.top);
  if (!lits.length) return;
  const holes = lits.map((r) => {
    if (!r.hex) return `<rect x="${r.left}" y="${r.top}" width="${r.right - r.left}" height="${r.bottom - r.top}" rx="3"/>`;
    const cx = (r.left + r.right) / 2, q = (r.bottom - r.top) / 4;
    return `<polygon points="${cx},${r.top} ${r.right},${r.top + q} ${r.right},${r.bottom - q} ${cx},${r.bottom} ${r.left},${r.bottom - q} ${r.left},${r.top + q}"/>`;
  }).join('');
  if (el.holes.innerHTML !== holes) el.holes.innerHTML = holes;
  if (R.mode === 'play' || phone()) { el.tip.style.left = ''; el.tip.style.top = ''; return; } // a caption or a phone's sheet: placed by its class
  // The tooltip goes where it covers the least of what's lit: beside all the
  // lit places, else beside the main one (the first target), else a corner.
  const tw = el.tip.offsetWidth, th = el.tip.offsetHeight, gap = 12, m = 16;
  const around = (/** @type {typeof lits} */ rs) => {
    const b = { left: Math.min(...rs.map((r) => r.left)), top: Math.min(...rs.map((r) => r.top)), right: Math.max(...rs.map((r) => r.right)), bottom: Math.max(...rs.map((r) => r.bottom)) };
    const cx = (b.left + b.right) / 2 - tw / 2, cy = (b.top + b.bottom) / 2 - th / 2;
    return [[cx, b.bottom + gap], [cx, b.top - gap - th], [b.right + gap, cy], [b.left - gap - tw, cy]];
  };
  const spots = [...around(lits), ...around(lits.filter((r) => r.i === lits[0].i)), [m, m], [vw - tw - m, m], [m, vh - th - m], [vw - tw - m, vh - th - m]]
    .map(([x, y]) => [Math.max(m, Math.min(vw - tw - m, x)), Math.max(m, Math.min(vh - th - m, y))]);
  const covered = (/** @type {number} */ x, /** @type {number} */ y) => lits.reduce((n, r) => n + Math.max(0, Math.min(x + tw, r.right) - Math.max(x, r.left)) * Math.max(0, Math.min(y + th, r.bottom) - Math.max(y, r.top)), 0);
  const nowX = parseFloat(el.tip.style.left), nowY = parseFloat(el.tip.style.top);
  let best = spots[0], least = Infinity;
  for (const [x, y] of spots) { const c = covered(x, y); if (c < least - 1) { least = c; best = [x, y]; } }
  // Stay put unless moving uncovers more (no jitter while cards settle).
  if (!Number.isNaN(nowX) && covered(nowX, nowY) <= least + 1 && nowX >= m - 1 && nowX <= vw - tw - m + 1 && nowY >= m - 1 && nowY <= vh - th - m + 1) return;
  el.tip.style.left = `${Math.round(best[0])}px`;
  el.tip.style.top = `${Math.round(best[1])}px`;
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

/** The player's own moves, in play mode. @param {Move} move */
function onMove(move) {
  if (!R.waiting || R.busy) return hooks.toast('Wait for your turn');
  const verdict = check(R.table, YOU, move);
  if (!verdict.ok) return hooks.toast(verdict.reason);
  R.waiting = false;
  if (move.type === 'pick') {
    play(R.table, YOU, move);
    void present(R.table.state).then(() => go());
    return;
  }
  next(...turnSteps(YOU, move));
  void go();
}

/** @param {TableHooks} h */
export function start(h) {
  hooks = h;
  hooks.ui.local = onMove;
  hooks.ui.connectionNote = '';
  build();
  R.queue = [...chapterWin(), ...chapterEconomy(), ...chapterStructure(), drive];
  void present(R.table.state, { instant: true }).then(() => go());
}
