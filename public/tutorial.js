// @ts-check
/**
 * The tutorial (/tutorial): a guided walkthrough of the first draft's rules
 * (Appendix G) on a real game held in this tab, with three bots.
 *
 * Teaching order (designer, 2026-10-10): 1. how to win; 2. the influence
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
import { spec, factionById, locationById, cardById, describeTarget, playerView, resolveFight, clone } from './engine.js';
import { newTable, copyTable, autoMove, nextActor, play, botPicks, check, YOU, BOTS } from './tutorial-game.js';
import { tokenHtml, cubeHtml, SEAT_COLOURS } from './pieces.js';
import { cardHtml, suitIcon } from './cards.js';

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
  presence: '#factions .presence-line',
  factions: '#factions',
  board: '#board .map-window',
  players: '#players',
  hand: '#hand .fan',
  bar: '#dock',
  supply: '#mine .chip',
  influenceTab: '#influence',
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

function chapterWin() {
  const t = opt('threshold');
  const v = view();
  const f = v.factions;
  const now = totalPresence(v), top = Math.max(now, t) * 1.25;
  const sample = (/** @type {number[]} */ counts) => `<div class="tut-trophies">${f.map((x, i) => `<span>${tokens(x, counts[i])}<b>${counts[i]}</b></span>`).join('')}</div>`;
  const { faction } = yours();
  return [
    chapter('1 · How to win'),
    modal('Welcome to the island', `
      <p>Five invader factions have landed on a small island town. You lead a <b>slayer group</b>, but you never control the monsters: you bait them, lure them and set traps so they tear into each other.</p>
      <p>This walkthrough teaches the rules, then plays a real first round with three bots (${BOT_IDS.map(esc).join(', ')}). Use <b>Next</b> and <b>Back</b>, or the arrow keys.</p>`),
    modal('Two ways the game ends', `
      <p>The game lasts <b>${rounds()} rounds</b>. Then every invader token on the island is counted.</p>
      <div class="tut-meter" style="--now:${(100 * now) / top}%;--mark:${(100 * t) / top}%"><span class="tut-meter-fill"></span><span class="tut-meter-mark">${t}</span><span class="tut-meter-now">${now} now</span></div>
      <div class="tut-cols">
        <div><h3>${t} or fewer</h3><p><b>The island wins.</b> The invaders are beaten back, and players compare the trophies they took.</p></div>
        <div><h3>More than ${t}</h3><p><b>The invaders win.</b> The faction with the most tokens takes the island, and players compare how much that faction likes them.</p></div>
      </div>`),
    modal('If the island wins: a full set', `
      <p>Trophies are tokens killed in fights. Your score is the number of trophies you hold <b>of the colour you have fewest of</b>. Spread out: one missing colour scores 0.</p>
      <p class="tut-example">Lots of trophies, one colour missing: scores <b>0</b>${sample([4, 3, 3, 2, 0])}</p>
      <p class="tut-example">Fewer, but even: scores <b>2</b>${sample([2, 2, 3, 2, 2])}</p>
      <p class="small muted">Tied? Compare the next-fewest colour, and so on.</p>`),
    modal('If a faction wins: its favourite', `
      <p>Your score is your <b>influence with the winning faction minus your trophies of it</b>. Helping kill a faction's monsters doesn't earn its favour.</p>
      <p class="tut-example">Influence with ${F(faction)} ${cubes(YOU, 6)} minus trophies ${tokens(faction, 2)} = <b>4</b></p>
      <p class="small muted">Factions tied on tokens: the one controlling more locations wins; still tied, they win together and scores add up. Players tied: fewest trophies of the winner, then affinity, then the next faction down.</p>`),
    modal('The bet', `
      <p>You won't know which ending is coming until the end, so every move is a bet.</p>
      <div class="tut-cols">
        <div><h3>Fight widely</h3><p>Collect trophies of every colour, and shrink the invaders. A bet on <b>the island</b>.</p></div>
        <div><h3>Avoid fights</h3><p>Build influence with one faction and keep its tokens alive. A bet on <b>a faction</b>.</p></div>
      </div>
      <p>Watch the table: what others are invested in decides what your moves are worth.</p>`),
    spot(SEL.presence, 'The count', `This line tracks total presence all game against the threshold of <b>${t}</b>. Right now it's <b>${totalPresence(v)}</b>.`),
    spot(SEL.trophyTab, 'Your trophies are secret', 'Everyone sees which pile you take in a fight, but only you see your running total. It lives here.'),
  ];
}

/** @param {PlayerView} v */
const totalPresence = (v) => Object.values(v.board).reduce((n, p) => n + Object.values(p.tokens).reduce((a, b) => a + b, 0), 0);

// ---------------------------------------------------------------------------
// 2. The influence economy
// ---------------------------------------------------------------------------

function chapterEconomy() {
  const v = view();
  const { group, arch, faction } = yours();
  const mine = v.players[YOU];
  const onBoard = Object.keys(v.board).filter((l) => (v.board[l].influence[YOU] ?? 0) > 0);
  const others = v.factions.filter((f) => f !== faction);
  return [
    chapter('2 · Influence'),
    modal('Cubes and tokens', `
      <p>Factions are made of <b>tokens</b> ${tokenHtml(faction, 1)}. Your influence is <b>cubes</b> ${cubeHtml(colour(YOU), 10)}. You never own tokens, and a faction never holds cubes.</p>
      <p>Your cubes are always in one of three places:</p>
      <ol class="tut-list">
        <li><b>Your supply</b>: unused.</li>
        <li><b>Standing with a faction</b>: public. It's what the faction thinks of you, and it pays for moving that faction.</li>
        <li><b>On a location</b>: a bid for the trophies of the next fight there.</li>
      </ol>`),
    modal('How influence flows', `
      <div class="tut-flow">
        <div class="tut-node"><b>Supply</b>${cubes(YOU, 3)}</div>
        <div class="tut-arrow">spend a card<br>for influence</div>
        <div class="tut-node"><b>Standing</b>${tokenHtml(faction, 1)}${cubes(YOU, 2)}</div>
        <div class="tut-arrow">move that<br>faction</div>
        <div class="tut-node"><b>Location</b>${cubes(YOU, 1)}</div>
        <div class="tut-arrow">fight</div>
        <div class="tut-node"><b>Trophies</b>${tokens(others[0], 2)}</div>
      </div>
      <ol class="tut-list">
        <li>Spend a suit card for the influence printed on it: cubes go from your supply into standing with that suit's faction.</li>
        <li>Play a card that moves a faction into a new location: you pay 1 standing with that faction and put the cube there, with its tokens. No standing with a faction, no moving it.</li>
        <li>When that location fights, the player with the most cubes there takes the bigger pile of dead tokens, the runner-up the smaller.</li>
        <li>Afterwards half the leader's cubes there join their standing with the faction that won; the rest go home. Everyone else's stay put.</li>
      </ol>`),
    spot(SEL.supply, 'Your supply', `${plural(mine.supply, 'cube')} ready to use. Cubes that come back from the board return here.`),
    spot(SEL.factions, 'Standing with each faction', `Everyone's standing is public, in each faction's row. You start with <b>${mine.standing[faction]}</b> with ${F(faction)} (your group's own faction) and ${others.map((f) => mine.standing[f]).every((n) => n === mine.standing[others[0]]) ? `<b>${mine.standing[others[0]]}</b> with each other faction` : 'a little with the others'}.`),
    ...(onBoard.length ? [spot(onBoard.map(SEL.hex), 'Already on the board', `You also start with cubes on ${onBoard.map(L).join(', ')}: the ${esc(arch.name)} locations, your group's own ground.`)] : []),
    spot(SEL.seat(YOU), `You are the ${esc(group.name)}`, `Your group has <b>affinity</b> ${suitIcon(arch.id)} with ${F(faction)} and the ${esc(arch.name)} locations. Affinity only breaks ties between players: at those locations' fights, and in standing with that faction.`),
  ];
}

// ---------------------------------------------------------------------------
// 3. The shape of the game
// ---------------------------------------------------------------------------

function chapterStructure() {
  const hand = /** @type {Record<string, number>} */ (spec.constants.handSize)[String(R.table.state.seating.length)];
  return [
    chapter('3 · A round'),
    modal('Every round, three phases', `
      <div class="tut-phases">
        <div><b>1 · Draft</b><span>Everyone ends up with ${hand} cards, picked from hands passed round the table.</span></div>
        <div><b>2 · Play</b><span>Take turns playing one card or passing, until everyone passes in a row.</span></div>
        <div><b>3 · Resolve</b><span>Every location holding two factions fights. Then factions grow.</span></div>
      </div>
      <p>Repeat for <b>${rounds()} rounds</b>, then count the invaders.</p>`),
    modal('The island', `
      <p>Fifteen locations in five regions of three, in a ring round the lake. Each location belongs to an archetype, shown by its symbol.</p>
      <ul class="tut-list">
        <li>A location holds <b>at most two factions</b>. Two factions in one place will fight at the end of the round.</li>
        <li>A faction <b>controls</b> a location where it has the most tokens. Players never control locations.</li>
        <li>Cards move factions freely within a region and into a neighbouring region.</li>
      </ul>`),
    spot(SEL.board, 'The island', 'Each faction starts with one big group on a home location and single tokens on its two other locations.'),
    spot(SEL.header, 'Where we are', 'The round and phase are always shown up here. Time to draft.'),
  ];
}

// ---------------------------------------------------------------------------
// 4. Playing a round
// ---------------------------------------------------------------------------

/**
 * What kind of card use a move is: the round teaches each kind the first
 * time it comes up and fast-forwards the rest (designer, 2026-10-10: cover
 * the main card actions, then jump ahead).
 * @param {Move} move @returns {'influence' | 'move' | 'token' | 'special' | 'pass' | 'other'}
 */
function kindOf(move) {
  if (move.type === 'pass') return 'pass';
  if (move.type !== 'play') return 'other';
  if (move.use === 'influence') return 'influence';
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
    R.chapter = '4 · Play';
    const first = /** @type {string} */ (s.first);
    next(spot(SEL.players, 'Who goes first', `${who(first)} ${verb(first, 'holds', 'hold')} the earliest marked card dealt, so ${first === YOU ? 'you go' : `${esc(first)} goes`} first and must open with it. Turns then go round the table in this order. We'll stop the first time each kind of card play comes up and fast-forward the rest.`), drive);
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
      return present(R.table.state).then(() => ({ type: 'spot', target: SEL.hand, title: 'Your hand for the round', html: `We've fast-forwarded the rest of the draft: each pass you keep one more card, and the last card of each batch is kept automatically. These are your actions for the whole round; cards you don't play are lost when it ends.` }));
    }];
  }
  const dealt = me.batch.length;
  return [chapter('4 · The draft'),
    spot(SEL.hand, 'Your first batch', `You're dealt ${dealt} cards, and every hand of ${dealt} is passed round the table. ${plural(s.leftOut.length, 'card')} ${s.leftOut.length === 1 ? 'is' : 'are'} left out unseen. The same pool of cards is drafted again every round.`),
    () => {
      const id = me.batch.find((c) => cardById(c).suit) ?? me.batch[0];
      const c = cardById(id);
      return { type: 'spot', target: SEL.card(id), title: 'Reading a card', html: c.suit
        ? `Each card is played once, in one of two ways: for its <b>action</b> (the text), or for the <b>influence</b> printed on it (+${view().printed[id]}) with its suit's faction. Its action can aim at a <b>location</b> of its suit (any faction there) or at its suit's <b>faction</b> (anywhere): the LOC and FAC lines.`
        : 'Six cards have no suit: no influence to spend, but wild or powerful actions. Four are marked A to D: whoever holds the earliest letter dealt goes first, and must open the round with it.' };
    },
    spot(SEL.hand, 'Pick and pass', 'Keep one card and pass the rest on. Each time a new batch arrives, the cards you kept rejoin it, and you keep one more than before. You can put earlier picks back to take more from the new batch.'),
    () => {
      const move = autoMove(R.table, YOU);
      if (!move || move.type !== 'pick') return null;
      hooks.setKeep(move.keep);
      pickMove = move;
      return { type: 'spot', target: SEL.hand, title: 'Keep 1', html: `We'll keep <b>${esc(cardById(move.keep[0]).name)}</b>. Press Next to pass the rest on.` };
    }, () => {
      if (!pickMove) return null;
      play(R.table, YOU, pickMove);
      pickMove = null;
      botPicks(R.table);
      const after = R.table.state;
      return present(after).then(() => (after.phase === 'draft' ? { type: 'spot', target: SEL.hand, title: 'A new batch', html: `${esc(after.seating[after.seating.length - 1])} passed you this batch, and your kept card rejoined it. Now you'd keep ${after.players[YOU].kept.length + 1}, and so on until the cards run out.` } : null));
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
      const n = (pb.influence[pid] ?? 0) - (pa.influence[pid] ?? 0);
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
  if (move.type === 'play' && move.use === 'influence') {
    const c = cardById(move.card);
    const f = /** @type {string} */ (b.factions.find((x) => factionById(x).archetype === c.suit));
    const gain = b.players[pid].standing[f] - a.players[pid].standing[f];
    const teach = once('influence') ? '<p>That\'s step 1 of the economy: cubes from the supply into standing. Standing is what pays for moving that faction later.</p>' : '';
    return { type: 'spot', target: SEL.faction(f), title: `${who(pid)} ${verb(pid, 'spends')} ${esc(c.name)} for influence`, html: `<p><b>+${gain}</b> standing with ${F(f)}.</p>${teach}`, auto: pid !== YOU && !teach };
  }
  if (move.type === 'play') {
    const c = cardById(move.card);
    const ch = changes(a, b);
    const what = c.action === 'token' ? (pid === YOU ? describeTarget(c.id, move.target ?? null) : 'two face-down tokens: one real, one bluff') : describeTarget(c.id, move.target ?? null);
    // Paid from standing onto the board (a move), not from the supply (a token's marker cube).
    const placed = b.seating.some((x) => b.factions.some((f) => b.players[x].standing[f] < a.players[x].standing[f]) && Object.keys(b.board).some((l) => (b.board[l].influence[x] ?? 0) > (a.board[l].influence[x] ?? 0)));
    const teach = [
      placed && once('move') ? '<p>Step 2 of the economy: each faction moved into a new location costs its mover 1 standing with it, and that cube goes there as a bid for the trophies.</p>' : '',
      c.action === 'token' && once('token') ? '<p>A face-down token flips when its location fights. Only its owner knows which is real; the cube on each counts as their influence there.</p>' : '',
      !c.suit && c.marked && once('marked') ? `<p>A marked card (${esc(c.marked)}): no influence to spend, but a strong action. Whoever holds the earliest letter dealt goes first and opens with it.</p>` : '',
      !c.suit && c.action !== 'token' && once('special') ? '<p>An unsuited card: it has no influence to spend, but bends the normal rules instead.</p>' : '',
    ].join('');
    return { type: 'spot', target: ch.locs.length ? ch.locs.map(SEL.hex) : SEL.seat(pid), title: `${who(pid)} ${verb(pid, 'plays')} ${esc(c.name)}`,
      html: `<div class="tut-card">${cardHtml(c.id, { view: playerView(b, YOU) })}</div><p>${esc(what)}.</p>${ch.html || '<p>Nothing to act on: played for no effect.</p>'}${teach}`, auto: pid !== YOU && !teach, dwell: 3200 };
  }
  if (move.type === 'pass') {
    const teach = once('pass') ? '<p>Passing isn\'t final: if the turn comes back, a player who passed can still play. The round\'s play ends when everyone passes in a row.</p>' : '';
    return { type: 'spot', target: SEL.seat(pid), title: `${who(pid)} ${verb(pid, 'passes', 'pass')}`, html: teach || `<p>${plural(b.passesInRow, 'pass')} in a row.</p>`, auto: pid !== YOU && !teach };
  }
  if (move.type === 'grow') return { type: 'spot', target: SEL.hex(move.location), title: `${who(pid)} ${verb(pid, 'chooses')} where a faction grows`, html: `<p>Its supply is short, so its influence leaders choose: ${L(move.location)}.</p>` };
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
      hooks.ui.raise = true;
      hooks.render();
      const s = R.table.state;
      const mustOpen = s.first === YOU && !s.opened;
      return { type: 'spot', target: SEL.hand, title: 'Your turn', html: `On your turn, play one card or pass.${mustOpen ? ' You hold the earliest marked card, so you go first and must open with it.' : ''} A suit card can be played for its action or spent for its influence.` };
    }, () => {
      const m = /** @type {Move} */ (move);
      hooks.ui.raise = false;
      if (m.type === 'play' && m.use === 'action' && m.target) {
        try { hooks.choose(m.card, m.target); } catch { hooks.choose(null); }
        return { type: 'spot', target: [SEL.card(m.card), ...targetLocs(m.target).map(SEL.hex)], title: `We'll play ${esc(cardById(m.card).name)}`, html: `For its action: ${esc(describeTarget(m.card, m.target))}. When you play for real, you click the card, then pick its targets on the board.` };
      }
      if (m.type === 'play') {
        hooks.ui.raise = true;
        hooks.render();
        return { type: 'spot', target: SEL.card(m.card), title: `We'll spend ${esc(cardById(m.card).name)}`, html: `For its influence (the +${view().printed[m.card]} on the card), sacrificing its action.` };
      }
      return { type: 'spot', target: SEL.bar, title: 'We\'ll pass', html: 'Nothing worth playing right now. Passing keeps your cards for later in the round.' };
    });
  }
  steps.push(() => {
    const m = /** @type {Move} */ (move);
    hooks.ui.raise = false;
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
    return present(after).then(() => (R.mode === 'play' && pid === YOU ? null : shown));
  });
  return steps;
}

/** The locations a target names (for pointing at them). @param {import('./engine.js').Target} t */
const targetLocs = (t) => [...new Set([t.location, t.to, ...(t.from ?? []), ...(t.path ?? []), ...Object.keys(t.split ?? {}), ...(t.moves ?? []).flatMap((m) => [m.location, m.to])])]
  .filter(/** @returns {l is string} */ (l) => !!l && l in R.table.state.board);

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
    if (teach) R.chapter = '4 · Resolve';
    hooks.ui.note = 'Resolve: fights';
    return present(start).then(() => ({ type: 'spot', target: fights.length ? fights.map(SEL.hex) : SEL.board, title: `${who(pid)} ${verb(pid, 'passes', 'pass')}: play is over`,
      html: `Everyone has passed in a row, so the round's play ends; unplayed cards are lost. ${fights.length ? `${plural(fights.length, 'location')} ${fights.length === 1 ? 'holds' : 'hold'} two factions: each fights now. Fights don't affect each other.` : 'No location holds two factions, so nothing fights.'}`, dwell: 1800 }));
  }];
  fights.forEach((loc, i) => {
    const a = chain[i], b = chain[i + 1];
    if (teach && i > 0) return;
    if (teach) steps.push(() => present(a, { instant: true }).then(() => ({ type: 'spot', target: SEL.hex(loc), title: `Fight at ${L(loc)}`, html: before(a, loc) })));
    steps.push(() => present(a, { instant: true }).then(() => present(b)).then(() => ({ type: 'spot', target: SEL.hex(loc), title: `Fight at ${L(loc)}`, html: after(a, b, loc), dwell: 2600 })));
  });
  if (teach && fights.length > 1) {
    // The rest fast-forwarded, summed up in one step.
    steps.push(() => {
      hooks.ui.note = 'Resolve: fast-forward';
      let p = Promise.resolve();
      for (let i = 1; i < fights.length; i++) p = p.then(() => present(chain[i + 1], { speed: 2 }));
      const lines = fights.slice(1).map((loc, i) => after(chain[i + 1], chain[i + 2], loc)).join('');
      return p.then(() => ({ type: 'spot', target: fights.slice(1).map(SEL.hex), title: `${plural(fights.length - 1, 'more fight')}`, html: `<p>The same rules, fast-forwarded:</p>${lines}` }));
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
    const lesson = once('growth') ? ` Every location where a faction has at least ${g} tokens gains 1 from its supply; a faction controlling a location of its own archetype gains 1 more there. Left alone, factions snowball.` : '';
    return present(end, { instant: true }).then(() => present(shown)).then(() => ({ type: 'spot', target: grew.length ? grew.map(SEL.hex) : SEL.board, title: 'Growth',
      html: `${grew.length ? `${plural(grew.length, 'location')} grew.` : 'Nothing grew.'}${lesson}` }));
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
  const sides = Object.entries(place.tokens).filter(([, n]) => n > 0).map(([f, n]) => `${tokens(f, n)} <b>${n}</b> ${F(f)}`);
  const bids = s.seating.map((pid) => [pid, place.influence[pid] ?? 0]).filter(([, n]) => Number(n) > 0).sort((x, y) => Number(y[1]) - Number(x[1]));
  const teach = once('fightBefore') ? '<p>The bigger group wins. The player with the most cubes here (the <b>leader</b>) will take the bigger pile of dead tokens; the <b>runner-up</b> the smaller.</p>' : '';
  return `<p>${sides.join(' <i>against</i> ')}</p><p>${bids.length ? `Influence here: ${bids.map(([pid, n]) => `${cubes(String(pid), Number(n))} ${who(String(pid))} ${n}`).join(', ')}.` : 'No one has influence here: the dead return to their supplies.'}${place.token ? ' A face-down token here will flip.' : ''}</p>${teach}`;
}

/** The engine's log lines speak of the learner's seat in the third person ("You takes"); put them in the second. @param {string} line */
const youify = (line) => line.replace(/\bYou takes\b/g, 'You take').replace(/\bYou's\b/g, 'Your').replace(/\bYou passes\b/g, 'You pass').replace(/\bYou plays\b/g, 'You play');

/** A fight's result, from the engine's own log lines. @param {GameState} a @param {GameState} b @param {string} loc */
function after(a, b, loc) {
  const was = a.log.find((e) => e.round === a.round)?.events.length ?? 0;
  const lines = (b.log.find((e) => e.round === b.round)?.events ?? []).slice(was).map((l) => `<li>${esc(youify(l.trim()))}</li>`).join('');
  const tie = b.board[loc].scorched;
  const teach = tie && once('scorch') ? '<p>A true tie: equal groups on ground aligned with neither faction. Both are wiped out, nobody collects, all influence goes home, and the location is gone for the rest of the game.</p>'
    : once('fightAfter') ? '<p>The loser loses every token here; the winner loses half as many, rounded down (at least 1). Those casualties are the trophies. Then half the leader\'s cubes here (rounded down) join their standing with the winning faction, and the rest go back to their supply. Everyone else\'s cubes stay for next time.</p>' : '';
  return `<ul class="tut-changes">${lines}</ul>${teach}`;
}

/** After round 1: skip to the end, or play on. @type {Step} */
function choiceStep() {
  const t = opt('threshold');
  return { type: 'modal', title: 'That was a round', html: `
    <p>That's everything a round holds: the draft, the play, the fights and growth. Total presence is now <b>${totalPresence(view())}</b> against the threshold of ${t}, with ${plural(rounds() - 1, 'round')} to go, each played the same way.</p>
    <p>Skip ahead to the last round's fights and see how the game ends and is scored, or play the rest yourself against the bots.</p>`,
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
    return { type: 'spot', target: SEL.presence, title: `Round ${last}: the last fights`, html: `We've skipped ahead: the bots played rounds 2 to ${last} for you, and the last round's play is over. Total presence before its fights: <b>${totalPresence(view())}</b>. Its fights and growth decide the ending.` };
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
  hooks.ui.raise = false;
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

/** @type {{ root: HTMLElement, block: HTMLElement, spot: HTMLElement, tip: HTMLElement, wrap: HTMLElement, modal: HTMLElement }} */
let el;
/** The elements spotlit now. @type {string[]} */
let lit = [];

function build() {
  const root = document.createElement('div');
  root.className = 'tut';
  root.innerHTML = `<div class="tut-block"></div><div class="tut-spot" hidden></div>
    <div class="tut-tip" role="dialog" aria-live="polite" hidden></div>
    <div class="tut-wrap" hidden><div class="tut-modal panel" role="dialog" aria-modal="true"></div></div>`;
  document.body.appendChild(root);
  const q = (/** @type {string} */ s) => /** @type {HTMLElement} */ (root.querySelector(s));
  el = { root, block: q('.tut-block'), spot: q('.tut-spot'), tip: q('.tut-tip'), wrap: q('.tut-wrap'), modal: q('.tut-modal') };
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
  el.spot.hidden = true;
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

/** @param {Show} show */
function display(show) {
  R.shown = show;
  R.waiting = show.type === 'wait';
  el.block.hidden = show.type === 'wait' || R.mode === 'play';
  if (show.type === 'wait') { hideAll(); return; }
  if (show.type === 'modal') {
    el.wrap.hidden = false;
    const buttons = show.buttons
      ? `<div class="tut-nav"><span class="tut-chapter">${esc(R.chapter)}</span><span class="tut-nav-btns">${R.mode === 'guided' && R.history.length > 1 ? '<button class="btn" data-tut="back">Back</button>' : ''}${show.buttons.map((b, i) => `<button class="btn${b.primary ? ' btn-primary' : ''}" data-tut="button:${i}">${esc(b.label)}</button>`).join('')}</span></div>`
      : nav();
    el.modal.innerHTML = `<h2>${esc(show.title)}</h2><div class="tut-body">${show.html}</div>${buttons}`;
    /** @type {HTMLElement | null} */ (el.modal.querySelector('.btn-primary'))?.focus({ preventScroll: true });
    return;
  }
  lit = Array.isArray(show.target) ? show.target : [show.target];
  // Scroll to the first target in the page's flow (the hand, bar and tabs are fixed to the window).
  const fixed = (/** @type {Element} */ x) => { const f = x.closest('.dock, .hand, .side-stack'); return !!f && getComputedStyle(f).position === 'fixed'; };
  const first = lit.map((sel) => document.querySelector(sel)).find((x) => x && !fixed(x));
  // Phones: the tooltip is a sheet along the bottom, so the subject goes to the top.
  first?.scrollIntoView({ behavior: 'smooth', block: phone() ? 'start' : 'center', inline: 'center' });
  el.spot.hidden = R.mode === 'play';
  el.tip.hidden = false;
  el.tip.classList.toggle('is-caption', R.mode === 'play');
  if (R.mode === 'play') { el.tip.style.left = ''; el.tip.style.top = ''; }
  el.tip.innerHTML = `<h3>${show.title}</h3><div class="tut-body">${show.html}</div>${R.mode === 'play' ? '' : nav()}`;
  place();
  if ((R.mode !== 'guided' || show.auto) && !R.paused) R.timer = setTimeout(() => void go(), show.dwell ?? DWELL[R.mode]);
}

/** The phone layout (app.css's phone block). */
const phone = () => window.matchMedia('(max-width: 600px), (hover: none) and (pointer: coarse)').matches;

/** Keep the spotlight on its elements and the tooltip beside it (every frame: pages scroll and cards move). */
function place() {
  if (!el || el.tip.hidden || !lit.length) return;
  const rects = lit.flatMap((s) => [...document.querySelectorAll(s)]).map((x) => x.getBoundingClientRect()).filter((r) => r.width || r.height);
  const vw = window.innerWidth, vh = window.innerHeight;
  const pad = 8;
  if (!rects.length) return;
  const box = {
    left: Math.max(4, Math.min(...rects.map((r) => r.left)) - pad), top: Math.max(4, Math.min(...rects.map((r) => r.top)) - pad),
    right: Math.min(vw - 4, Math.max(...rects.map((r) => r.right)) + pad), bottom: Math.min(vh - 4, Math.max(...rects.map((r) => r.bottom)) + pad),
  };
  Object.assign(el.spot.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${Math.max(0, box.right - box.left)}px`, height: `${Math.max(0, box.bottom - box.top)}px` });
  if (R.mode === 'play' || phone()) { el.tip.style.left = ''; el.tip.style.top = ''; return; } // a caption or a phone's sheet: placed by its class
  const tw = el.tip.offsetWidth, th = el.tip.offsetHeight, gap = 12, m = 16;
  const below = vh - box.bottom, above = box.top, right = vw - box.right, left = box.left;
  let x, y;
  if (below >= th + gap + m) { y = box.bottom + gap; x = (box.left + box.right) / 2 - tw / 2; }
  else if (above >= th + gap + m) { y = box.top - gap - th; x = (box.left + box.right) / 2 - tw / 2; }
  else if (right >= tw + gap + m) { x = box.right + gap; y = (box.top + box.bottom) / 2 - th / 2; }
  else if (left >= tw + gap + m) { x = box.left - gap - tw; y = (box.top + box.bottom) / 2 - th / 2; }
  else { x = vw / 2 - tw / 2; y = m; }
  el.tip.style.left = `${Math.round(Math.max(m, Math.min(vw - tw - m, x)))}px`;
  el.tip.style.top = `${Math.round(Math.max(m, Math.min(vh - th - m, y)))}px`;
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
