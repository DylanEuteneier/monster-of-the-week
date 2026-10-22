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
 *   each kind of card play comes up, the first fight, and growth. Bots'
 *   other turns fast-forward (designer, 2026-10-10: cover the main card
 *   actions, then jump ahead).
 * From round 1 the learner makes every move on the real table (designer,
 * 2026-10-11), with hints on: the hint suggests the move the deal was chosen
 * around (autoMove, as the bots play) and explains it (hints.js), but any
 * legal move is taken and the narration follows what happens.
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
import { suggest } from './hints.js';
import { tokenHtml, cubeHtml, hexHtml, SEAT_COLOURS, faceDownHtml } from './pieces.js';
import { flyPaths, SLOW } from './motion.js';
import { cardHtml, suitIcon } from './cards.js';
import { CLASH, tussleOn } from './fx.js';
import art from './assets/sprites.json' with { type: 'json' };

/** @typedef {import('./app.js').TableHooks} TableHooks */
/** @typedef {import('./engine.js').GameState} GameState */
/** @typedef {import('./engine.js').PlayerView} PlayerView */
/** @typedef {import('./engine.js').Move} Move */

/**
 * What a step shows. A step that shows nothing runs and the next one follows.
 * @typedef {{ type: 'modal', title: string, html: string, scene?: { from: Scene, to: Scene, focus?: string[], fight?: string }, stage?: { key: string, n: number }, buttons?: { label: string, primary?: boolean, run: () => void }[] }
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
/** Growth on own ground (AL3), a variant off by default (designer, 2026-10-21). */
const boosted = () => R.table.state.options.alignedGrowth === 'on';
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
// Scenes: a small table in a modal, made of the real assets (hexes, a faction
// row, each player's supply and trophies), where a rule is first shown with
// pieces flying as they would in play (designer, 2026-10-10: a simplified
// board teaches a rule best the first time it comes up).
// ---------------------------------------------------------------------------

/**
 * @typedef {{ loc: string, tokens: Record<string, number>, sway?: Record<string, number>, scorched?: boolean, doomed?: Record<string, number> }} SceneHex
 * @typedef {{ f: string, supply: number, sway: Record<string, number> }} SceneRow
 * @typedef {{ pid: string, supply?: number, trophies?: Record<string, number>, hand?: string[] }} ScenePlayer
 * @typedef {{ hexes?: SceneHex[], rows?: SceneRow[], players?: ScenePlayer[] }} Scene
 */

/** A run of pieces, with a count once it's long. @param {number} n @param {() => string} piece @param {number} [cap] */
const run = (n, piece, cap = 8) => (n > cap ? `${Array.from({ length: cap }, piece).join('')}<b class="tut-count">×${n}</b>` : Array.from({ length: n }, piece).join(''));

/** A card in a scene's hand: its suit, name and printed sway, small. @param {string} id @param {boolean} [on] */
function miniCard(id, on = false) {
  if (id.startsWith('~')) return `<span class="tut-mini-card is-back" data-k="card:${id.slice(1)}"><b>?</b></span>`; // a rival's card, face down
  const c = cardById(id);
  return `<span class="tut-mini-card card-suit-${c.suit ?? 'none'}${on ? ' is-lit' : ''}" data-k="card:${id}">${suitIcon(c.suit, 1)}<b>${esc(c.name)}</b>${c.suit ? `<span class="tut-chip">+${printedOf(R.table.state, id)}</span>` : ''}</span>`;
}

/** A player's slayer group emblem (pixel art, 2×). @param {string} pid */
function emblem(pid) {
  const em = /** @type {Record<string, { width: number, height: number, src: string }>} */ (art.sprites)[R.table.state.players[pid]?.group ?? ''];
  return em ? `<img class="sprite" src="${esc(em.src)}" width="${em.width * 2}" height="${em.height * 2}" alt="">` : '';
}

/** A scene, its focused parts lit in the table's own way (tokens in their hover state; rows outlined; sway underlined; a lit hex, or a player's row holding a lit card, is simply not dimmed) and every part holding nothing lit dimmed. @param {Scene} sc @param {string[]} [focus] */
function sceneHtml(sc, focus = []) {
  const lit = (/** @type {string} */ k) => focus.includes(k);
  const part = (/** @type {boolean} */ on) => (focus.length && !on ? ' is-dim' : '');
  const hexes = (sc.hexes ?? []).map((h) => {
    // Tokens marked to die in this fight are drawn last in their row, crossed out.
    const rows = Object.entries(h.tokens).filter(([, n]) => n > 0).map(([f, n]) => {
      const doomed = Math.min(n, h.doomed?.[f] ?? 0);
      const state = lit(`hextok:${h.loc}:${f}`) ? 'hovered' : '';
      const t = (/** @type {boolean} */ dead) => (dead ? `<span class="tut-doomed">${tokenHtml(f, 1)}</span>` : tokenHtml(f, 1, state));
      return `<span class="piece-row" data-k="hextok:${h.loc}:${f}">${run(n - doomed, () => t(false), 6)}${Array.from({ length: doomed }, () => t(true)).join('')}</span>`;
    }).join('');
    const sway = Object.entries(h.sway ?? {}).filter(([, n]) => n > 0).map(([pid, n]) => run(n, () => cubeHtml(colour(pid), 8))).join('');
    const on = lit(`hex:${h.loc}`) || focus.some((k) => k.startsWith(`hextok:${h.loc}:`) || k === `hexsway:${h.loc}`);
    return `<div class="tut-scene-hex tut-part${h.scorched ? ' is-scorched' : ''}${part(on)}" data-k="hex:${h.loc}">${hexHtml(h.loc, 2, `${rows}<span class="piece-row${lit(`hexsway:${h.loc}`) ? ' is-lit' : ''}" data-k="hexsway:${h.loc}">${sway}</span>`)}<span class="small">${L(h.loc)}</span></div>`;
  }).join('');
  const rows = (sc.rows ?? []).map((r) => `<div class="tut-scene-row tut-part${lit(`row:${r.f}`) ? ' is-lit' : part(false)}" data-k="row:${r.f}">
      <span class="tut-scene-id">${tokenHtml(r.f, 2)}<b>${F(r.f)}</b></span>
      <span class="tut-scene-cell" data-k="rowsupply:${r.f}"><span class="tut-scene-label">supply</span>${run(r.supply, () => tokenHtml(r.f, 1))}</span>
      <span class="tut-scene-cell" data-k="rowsway:${r.f}"><span class="tut-scene-label">sway</span>${Object.entries(r.sway).filter(([, n]) => n > 0).map(([pid, n]) => `<span class="tut-scene-sway">${run(n, () => cubeHtml(colour(pid), 9))}</span>`).join('')}</span>
    </div>`).join('');
  const players = (sc.players ?? []).map((p) => `<div class="tut-scene-player tut-part${lit(`player:${p.pid}`) ? ' is-lit' : part(!!p.hand?.some((id) => lit(`card:${id.replace(/^~/, '')}`)))}" data-k="player:${p.pid}">
      <span class="tut-scene-id">${emblem(p.pid)}<span><b>${who(p.pid)}</b><span class="small muted">${esc(spec.slayerGroups.find((g) => g.id === R.table.state.players[p.pid]?.group)?.name ?? '')}</span></span></span>
      ${p.hand ? `<span class="tut-scene-cell tut-scene-hand" data-k="hand:${p.pid}"><span class="tut-scene-label">hand</span>${p.hand.map((id) => miniCard(id, lit(`card:${id.replace(/^~/, '')}`))).join('')}</span>` : ''}
      ${p.supply !== undefined ? `<span class="tut-scene-cell" data-k="supply:${p.pid}"><span class="tut-scene-label">supply</span>${run(p.supply, () => cubeHtml(colour(p.pid), 9))}</span>` : ''}
      ${p.trophies ? `<span class="tut-scene-cell" data-k="trophies:${p.pid}"><span class="tut-scene-label">trophies</span>${Object.entries(p.trophies).filter(([, n]) => n > 0).map(([f, n]) => run(n, () => tokenHtml(f, 1))).join('')}</span>` : ''}
    </div>`).join('');
  // One persistent layout: faction rows on top, the locations under them, the players under those.
  return `<div class="tut-scene">${rows}${hexes ? `<div class="tut-scene-board tut-grow" data-k="board">${hexes}</div>` : ''}${players ? `<div class="tut-scene-players tut-grow" data-k="players">${players}</div>` : ''}</div>`;
}

/**
 * Update a scene in place rather than redrawing it (designer, 2026-10-11:
 * smooth, no jumps): elements matched by their data-k key (or position) keep
 * their node, so class changes (lighting, dimming) transition; parts that are
 * new animate in quickly and the layout opens to make room.
 * @param {Element} into @param {string} html
 */
function morph(into, html) {
  const tpl = document.createElement('div');
  tpl.innerHTML = html;
  morphChildren(into, tpl);
}
/** @param {Element} a @param {Element} b */
function morphChildren(a, b) {
  const olds = [...a.childNodes];
  const keyed = new Map(olds.filter((n) => n instanceof HTMLElement && n.dataset.k).map((n) => [/** @type {HTMLElement} */ (n).dataset.k, n]));
  /** @type {Set<ChildNode>} */
  const used = new Set();
  let at = 0;
  const next = [...b.childNodes].map((nb) => {
    /** @type {ChildNode | null} */
    let na = null;
    if (nb instanceof HTMLElement && nb.dataset.k) na = keyed.get(nb.dataset.k) ?? null;
    else {
      while (at < olds.length && (used.has(olds[at]) || (olds[at] instanceof HTMLElement && /** @type {HTMLElement} */ (olds[at]).dataset.k))) at++;
      if (olds[at] && olds[at].nodeName === nb.nodeName) na = olds[at++];
    }
    if (na && na.nodeName === nb.nodeName) {
      used.add(na);
      if (na.nodeType === Node.TEXT_NODE) { if (na.textContent !== nb.textContent) na.textContent = nb.textContent; }
      else if (na instanceof Element && nb instanceof Element) {
        const entering = na.classList.contains('is-entering');
        for (const attr of [...na.attributes]) if (!nb.hasAttribute(attr.name)) na.removeAttribute(attr.name);
        for (const attr of [...nb.attributes]) if (na.getAttribute(attr.name) !== attr.value) na.setAttribute(attr.name, attr.value);
        if (entering) na.classList.add('is-entering');
        morphChildren(na, nb);
      }
      return na;
    }
    if (nb instanceof HTMLElement && (nb.classList.contains('tut-part') || nb.classList.contains('tut-grow'))) {
      nb.classList.add('is-entering');
      nb.addEventListener('animationend', () => nb.classList.remove('is-entering'), { once: true });
    }
    return nb;
  });
  for (const n of olds) if (!used.has(n)) n.remove();
  next.forEach((n, i) => { if (a.childNodes[i] !== n) a.insertBefore(n, a.childNodes[i] ?? null); });
}

/** Where each piece is in a scene, as signed changes between two scenes. @param {Scene} a @param {Scene} b */
function sceneChanges(a, b) {
  /** @type {Map<string, Map<string, number>>} piece kind → place key → change */
  const delta = new Map();
  const add = (/** @type {string} */ kind, /** @type {string} */ key, /** @type {number} */ d) => { if (!d) return; const m = delta.get(kind) ?? new Map(); m.set(key, (m.get(key) ?? 0) + d); delta.set(kind, m); };
  for (const [sc, sign] of /** @type {[Scene, number][]} */ ([[a, -1], [b, 1]])) {
    for (const h of sc.hexes ?? []) {
      for (const [f, n] of Object.entries(h.tokens)) add(`token:${f}`, `hex:${h.loc}`, sign * n);
      for (const [pid, n] of Object.entries(h.sway ?? {})) add(`cube:${pid}`, `hex:${h.loc}`, sign * n);
    }
    for (const r of sc.rows ?? []) {
      add(`token:${r.f}`, `rowsupply:${r.f}`, sign * r.supply);
      for (const [pid, n] of Object.entries(r.sway)) add(`cube:${pid}`, `rowsway:${r.f}`, sign * n);
    }
    for (const p of sc.players ?? []) {
      if (p.supply !== undefined) add(`cube:${p.pid}`, `supply:${p.pid}`, sign * p.supply);
      for (const id of p.hand ?? []) add(`card:${id.replace(/^~/, '')}`, `hand:${p.pid}`, sign);
      for (const [f, n] of Object.entries(p.trophies ?? {})) add(`token:${f}`, `trophies:${p.pid}`, sign * n);
    }
  }
  return delta;
}

/** What stays put between two scenes: every count at the lower of the two (pieces leave as they launch, arrive as they land). @param {Scene} a @param {Scene} b @returns {Scene} */
function sceneMid(a, b) {
  const lo = (/** @type {Record<string, number> | undefined} */ x, /** @type {Record<string, number> | undefined} */ y) => Object.fromEntries([...new Set([...Object.keys(x ?? {}), ...Object.keys(y ?? {})])].map((k) => [k, Math.min(x?.[k] ?? 0, y?.[k] ?? 0)]));
  const find = (/** @type {any[] | undefined} */ list, /** @type {string} */ key, /** @type {string} */ id) => (list ?? []).find((x) => x[key] === id);
  return {
    hexes: (b.hexes ?? []).map((h) => { const o = find(a.hexes, 'loc', h.loc); return { ...h, scorched: o?.scorched ?? false, tokens: lo(o?.tokens, h.tokens), sway: lo(o?.sway, h.sway) }; }),
    rows: (b.rows ?? []).map((r) => { const o = find(a.rows, 'f', r.f); return { ...r, supply: Math.min(o?.supply ?? 0, r.supply), sway: lo(o?.sway, r.sway) }; }),
    players: (b.players ?? []).map((p) => { const o = find(a.players, 'pid', p.pid); const had = (o?.hand ?? []).map((/** @type {string} */ x) => x.replace(/^~/, '')); return { ...p, supply: p.supply === undefined ? undefined : Math.min(o?.supply ?? 0, p.supply), trophies: lo(o?.trophies, p.trophies), hand: p.hand?.filter((x) => had.includes(x.replace(/^~/, ''))) }; }),
  };
}

/** A fixed, invisible stand-in at an element's place, so a flight keeps its ends while the scene is redrawn. @param {Element} el */
function ghost(el) {
  const r = el.getBoundingClientRect();
  const g = document.createElement('div');
  Object.assign(g.style, { position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, pointerEvents: 'none' });
  document.body.appendChild(g);
  return g;
}

/** A tussle on a scene's hex: it shakes, dust puffs up, a little blood flies, the clash shows. @param {HTMLElement} slot @param {string} loc */
function tussle(slot, loc) {
  const hex = slot.querySelector(`[data-k="hex:${loc}"]`);
  const at = hex?.querySelector('.hex');
  return hex && at ? tussleOn(hex, at) : Promise.resolve();
}

/** Fly a scene's pieces from one state to the next inside `slot` (a tussle first, if a hex fights), then draw the next. @param {HTMLElement} slot @param {Scene} a @param {Scene} b @param {string} [fight] */
function playScene(slot, a, b, fight = '', focus = /** @type {string[]} */ ([])) {
  /** @type {import('./motion.js').Path[]} */
  const paths = [];
  for (const [kind, places] of sceneChanges(a, b)) {
    const [what, who_] = kind.split(':');
    const out = [...places].filter(([, d]) => d < 0).map(([k, d]) => ({ k, n: -d }));
    const into = [...places].filter(([, d]) => d > 0).map(([k, d]) => ({ k, n: d }));
    for (const src of out) {
      for (const dst of into) {
        const n = Math.min(src.n, dst.n);
        if (n <= 0) continue;
        const from = slot.querySelector(`[data-k="${src.k}"]`), to = slot.querySelector(`[data-k="${dst.k}"]`);
        const off = (/** @type {string} */ k) => /^(supply|rowsupply|trophies):/.test(k);
        const piece = what === 'token' ? tokenHtml(who_, 1) : what === 'card' ? `<span class="tut-mini-card is-back"><b>?</b></span>` : cubeHtml(colour(who_), 9);
        if (from && to) paths.push({ from, to, n, piece, slow: off(src.k) || off(dst.k) ? SLOW : 1 });
        src.n -= n; dst.n -= n;
      }
    }
  }
  // The pieces in flight leave their places as they launch.
  return (fight ? tussle(slot, fight) : Promise.resolve()).then(() => {
    // Measure each path's ends now, then redraw without the pieces in flight; the ends keep where they were.
    const measured = paths.map((p) => ({ ...p, from: ghost(p.from), to: ghost(p.to) }));
    morph(slot, sceneHtml(sceneMid(a, b), focus));
    return flyPaths(measured).then(() => measured.forEach((p) => { p.from.remove(); p.to.remove(); }));
  }).then(() => { morph(slot, sceneHtml(b, focus)); });
}

/**
 * A beat of a scene in a modal: its pieces move from `from` to `to` once it's
 * up, and the parts named in `focus` (data-k keys) are lit, the rest dimmed,
 * so a scene can be walked through beat by beat on one layout.
 * @param {string} title @param {Scene} from @param {Scene} to @param {string} html @param {string[]} [focus] @param {string} [fight]  a hex that fights on this beat (a tussle first) @returns {Step}
 */
const sceneStep = (title, from, to, html, focus = [], fight = '') => () => ({ type: 'modal', title, html, scene: { from, to, focus, fight } });


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
/** How a fight's losses are counted, in pieces: the loser's whole group, then half that (rounded up) of the winners. @param {string} win @param {number} w @param {string} lose @param {number} l */
const fightMath = (win, w, lose, l) => `${eq(tokens(win, w), op('vs'), tokens(lose, l), op('→'), 'the bigger group wins')}${eq('the loser loses all', op('='), tokens(lose, l))}${eq(`the winner loses half that, rounded up`, op('='), tokens(win, Math.ceil(l / 2)))}${more('More examples', '<p>5 vs 2: the 2 die, the winners lose 1. 6 vs 5: the 5 die, the winners lose 3. 2 vs 1: the 1 dies, the winners lose 1.</p>')}`;
/** A small gauge like the island's: a count against the mark. @param {number} n @param {number} mark */
const miniGauge = (n, mark) => { const top = Math.max(n, mark * 2); return `<span class="tut-gauge${n > mark ? ' is-over' : ''}" style="--now:${(100 * n) / top}%;--mark:${(100 * mark) / top}%"><span class="tut-gauge-fill"></span><span class="tut-gauge-mark"></span></span>`; };
/** One of a faction ("Werewolves" → "Werewolf"). @param {string} name */
const one = (name) => (/ves$/.test(name) ? name.replace(/ves$/, 'f') : name.replace(/s$/, ''));
/** A callback to a rule taught earlier: one line, never the whole lesson again. @param {string} html */
const recall = (html) => `<p class="tut-recall">↩ ${html}</p>`;
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
const versus = (left, right, cls = '') => `<div class="tut-versus ${cls}"><div class="tut-side">${middleOut(left).join('')}</div><span class="tut-op tut-mid"><span class="tut-vs">vs</span><span class="tut-heart" aria-label="backs">${HEART}</span></span><div class="tut-side">${middleOut(right).join('')}</div></div>`;
/** Crossed swords for a fight, in palette colours (blades w, hilts y, ink k). */
/** A puff of dust (palette greys). */
/** A pixel heart, in the palette's red. */
const HEART = '<svg width="21" height="18" viewBox="0 0 7 6" shape-rendering="crispEdges"><path fill="#e7482d" d="M1 0h2v1h1V0h2v1h1v2H6v1H5v1H4v1H3V5H2V4H1V3H0V1h1z"/><path fill="#f47e20" d="M1 1h1v1H1z"/></svg>';
/** A slayer group in the versus layout. @param {string} id @param {boolean} _big (kept for call sites; every item looks the same) @param {number} [_i] unused @param {string} [cls] */
function groupItem(id, _big, _i = 0, cls = '') {
  const g = spec.slayerGroups.find((x) => x.id === id);
  const em = /** @type {Record<string, { width: number, height: number, src: string }>} */ (art.sprites)[id];
  const seat = R.table.state.seating.find((pid) => R.table.state.players[pid].group === id);
  return `<div class="tut-cast-item${seat ? '' : ' is-absent'} ${cls}">${em ? `<img class="sprite" src="${esc(em.src)}" width="${em.width * 3}" height="${em.height * 3}" alt="">` : ''}<b>${esc(g?.name ?? '')}</b><span class="small muted">${!seat ? 'not in this game' : seat === YOU ? `${esc(g?.trope ?? '')} · you` : esc(seat)}</span></div>`;
}
/** A faction in the versus layout. @param {string} f @param {boolean} first  your monster @param {number} [_i] unused @param {boolean} [brawl]  jostling the others @param {string} [cls] */
function factionItem(f, first, _i = 0, brawl = false, cls = '') {
  const arch = spec.archetypes.find((a) => a.id === factionById(f).archetype);
  const item = `<div class="tut-cast-item${brawl ? ' is-brawling' : ''} ${cls}">${tokenHtml(f, 3)}<b>${F(f)}</b><span class="small muted">${first ? 'your monster' : esc(arch?.name ?? '')}</span></div>`;
  return item;
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
  // Who backs whom: you and your own faction, as in the opening; a rival for comparison.
  const backer = YOU;
  const backs = faction;
  const rival = s0.seating.find((pid) => pid !== YOU) ?? YOU;

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
  trophiesTo(E, v.factions.map((f) => (f === backs ? 0 : 1)));
  const homes = groups(E).filter((g) => g.f === backs).map((g) => g.loc);
  const spots = homes.length ? homes : Object.keys(E.board).filter((l) => !Object.values(E.board[l].tokens).some((n) => n > 0)).slice(0, 2);
  for (let k = 0; total(E) <= t + 7 && E.supply[backs] > 0; k++) { E.board[spots[k % spots.length]].tokens[backs] = (E.board[spots[k % spots.length]].tokens[backs] ?? 0) + 1; E.supply[backs] -= 1; }
  // F: you have built sway with it; the rival hasn't.
  const F_ = clone(E);
  const bp = F_.players[backer];
  const want = 8;
  bp.supply -= want - bp.standing[backs];
  bp.standing[backs] = want;
  /** Every faction's monsters on the board, most first, the biggest marked. @param {GameState} st */
  const presenceList = (st) => {
    const counts = st.factions.map((f) => ({ f, n: Object.values(st.board).reduce((k, p) => k + (p.tokens[f] ?? 0), 0) })).sort((x, y) => y.n - x.n);
    return `<ul class="tut-presence">${counts.map(({ f, n }, i) => `<li class="${i === 0 ? 'is-top' : ''}">${tokenHtml(f, 1)}<span>${F(f)}</span><b>${n}</b>${i === 0 ? '<span class="tut-chip">takes the island</span>' : '<span></span>'}</li>`).join('')}</ul>`;
  };
  const yourScore = bp.standing[backs] - bp.trophies[backs];
  const theirScore = F_.players[rival].standing[backs] - F_.players[rival].trophies[backs];

  return [
    spot(SEL.presence, 'Count the monsters', `${eq(...v.factions.map((f) => tokenHtml(f, 1)), op('on the island now'), op('='), `<b>${total(s0)}</b>`)}<p>After round ${rounds()}, count the monster tokens left on the board:</p>${eq(miniGauge(t + 8, t), `more than <b>${t}</b>`, op('→'), '<b>invader sway</b> decides the winner')}${eq(miniGauge(t - 6, t), `<b>${t}</b> or fewer`, op('→'), '<b>complete trophy sets</b> decide the winner')}`),
    demo(() => s0, () => A, () => ({ type: 'spot', target: [SEL.hex(g1.loc), SEL.hex(g2.loc), SEL.presence, SEL.trophyTab], title: 'Fights kill monsters',
      html: `${eq(chip('fight'), op('→'), tokens(g1.f, 3), op('→'), 'trophies', op('·'), `<b>${total(A)}</b> monsters left`)}${recall('The fight: the dead leave the board, and the top bids take them as trophies.')}` })),
    demo(() => A, () => B, () => ({ type: 'spot', target: [...grew.map(SEL.hex), SEL.presence], title: 'Growth breeds more',
      html: `${eq(chip('round end'), op('→'), 'groups grow', op('·'), `<b>${total(B)}</b> monsters`)}${recall(`Growth: ${opt('growth')}+ alone grows${boosted() ? '; more on its own ground' : ''}.`)}` })),
    demo(() => B, () => C, () => ({ type: 'spot', target: [SEL.presence, SEL.trophyTab], title: `${t} or fewer: complete sets decide`,
      html: `${eq(miniGauge(total(C), t), `<b>${total(C)}</b>`, op(`${t} or fewer`))}<p>The slayers did their job. Whoever holds the most <b>complete sets</b> of trophies wins: count your fewest colour.</p>${trophyRow(v.factions, lopsided)}${eq('no', tokenHtml(missing, 1), op('='), 'no complete set', op('='), '<b>0</b>')}<p class="small muted">Sway counts for nothing.</p>` })),
    demo(() => C, () => D, () => ({ type: 'spot', target: [SEL.trophyTab], title: 'Hunt every kind',
      html: `${trophyRow(v.factions, even)}${eq('2 of every colour', op('='), '2 complete sets', op('='), '<b>2</b>')}${more('Ties', 'Compare the next-fewest colour, then the next.')}` })),
    demo(() => D, () => E, () => ({ type: 'spot', target: [...homes.map(SEL.hex), SEL.presence, SEL.faction(backs)], title: `More than ${t}: the biggest faction decides`,
      html: `${eq(miniGauge(total(E), t), `<b>${total(E)}</b>`, op(`more than ${t}`))}${presenceList(E)}<p>The faction with the most monsters on the board takes the island: the <b>${F(backs)}</b>. The winner is whoever they're most swayed by.</p>${more('Ties', 'Factions tied on tokens: the one controlling more locations wins; still tied, they win together and scores add up.')}` })),
    demo(() => E, () => F_, () => ({ type: 'spot', target: [SEL.faction(backs), SEL.trophyTab], title: 'Its backers score',
      html: `${eq(cubes(YOU, want), op('−'), '0', op('='), `<b>${yourScore}</b>`, '<span class="small">you</span>')}${eq(cubes(rival, F_.players[rival].standing[backs]), op('−'), '0', op('='), `<b>${theirScore}</b>`, `<span class="small">${who(rival)}</span>`)}<p>You backed them and never hunted them, so you win. Trophy sets count for nothing.</p>${frame('Your sway with the winning faction, minus your trophies of it, is your score.', 'Back a faction you think will survive, and keep it alive: don\'t hunt it.')}${more('Ties', 'Fewest trophies of the winner, then affinity, then the next faction down.')}` })),
    restore,
    modal('Every move is a bet', `
      <div class="tut-cols">
        <div><h3>Hunt every kind</h3>${eq(tokens(v.factions[0], 1), tokens(v.factions[1], 1), tokens(v.factions[2], 1), op('→'), `pays if ${t} or fewer remain`)}</div>
        <div><h3>Back a faction</h3>${eq(cubes(YOU, 3), op('→'), tokenHtml(faction, 1), op('→'), 'pays if it takes the island')}</div>
      </div>
      <p>Each ending makes the other half worthless, and you won't know which until the end. Read the table.</p>`),
  ];
}

/** @param {PlayerView} v */
const totalPresence = (v) => Object.values(v.board).reduce((n, p) => n + Object.values(p.tokens).reduce((a, b) => a + b, 0), 0);

/**
 * The scenes' cast, from this game: your faction lured from a neighbouring
 * location into a fight with a rival faction at one of your locations, a rival
 * player bidding there too, and a tie elsewhere.
 */
function sceneCast() {
  const st = R.table.state;
  const v = view();
  const { faction: F0 } = yours();
  const mine = v.players[YOU];
  const onBoard = Object.keys(v.board).filter((l) => (v.board[l].sway[YOU] ?? 0) > 0);
  const others = v.factions.filter((f) => f !== F0);
  const map = /** @type {{ locations: Record<string, { region: string }> }} */ (/** @type {unknown} */ (spec.map));
  const G = others[0], H = others[1];
  const ash = st.seating.find((pid) => pid !== YOU) ?? YOU;
  const L1 = onBoard[0] ?? Object.keys(st.board)[0];
  const L2 = Object.keys(map.locations).find((l) => l !== L1 && map.locations[l].region === map.locations[L1].region) ?? Object.keys(st.board)[1];
  const aligned = (/** @type {string} */ l, /** @type {string} */ f) => locationById(l).archetype === factionById(f).archetype;
  const L3 = Object.keys(st.board).find((l) => l !== L1 && l !== L2 && !aligned(l, G) && !aligned(l, H)) ?? Object.keys(st.board)[2];
  const supF = st.supply[F0], you0 = mine.standing[F0], ash0 = v.players[ash].standing[F0];
  const row = (/** @type {number} */ yours_) => ({ f: F0, supply: supF, sway: { [YOU]: yours_, [ash]: ash0 } });
  /** @type {Scene} */ const bid = { hexes: [{ loc: L1, tokens: { [F0]: 4, [G]: 3 }, sway: { [YOU]: 2, [ash]: 1 } }], players: [{ pid: YOU, trophies: {} }, { pid: ash, trophies: {} }] };
  /** @type {Scene} */ const fought = { hexes: [{ loc: L1, tokens: { [F0]: 3, [G]: 0 }, sway: { [YOU]: 2, [ash]: 1 } }], players: [{ pid: YOU, trophies: { [G]: 3 } }, { pid: ash, trophies: { [F0]: 1 } }] };
  return { st, v, F0, G, H, ash, L1, L2, L3, mine, onBoard, others, supF, you0, ash0, row, bid, fought };
}

// ---------------------------------------------------------------------------
// 1. The theme
// ---------------------------------------------------------------------------

function chapterTheme() {
  // The premise (designer) as one modal drawn once, in three stages (designer, 2026-10-11: fluid, no pauses, no
  // jumps): your group against your monster; every group and every monster, the monsters at each other's throats;
  // everyone else folding away and the vs turning to a heart. Next only changes the stage, so pieces move by
  // transition (and Back runs them in reverse), and the stacked titles and texts cross-fade in one fixed space.
  const intro = () => {
    const { group } = yours();
    const { groups, factions } = castOf();
    const wave = (/** @type {number} */ k) => `is-extra wave-${k + 1}`;
    const titles = ['Monster of the week', 'This week, they all show up', 'Until someone switches sides'];
    const texts = [
      `You're the ${esc(group.name)}. Every week a new monster comes to town, and it's up to you to stop it.`,
      'Five monsters, all at each other\'s throats for the island, and every slayer group caught in the middle. You can\'t beat them head-on, so you lure and trick them into tearing each other apart.',
      `Every group hunts every monster, <b>until one decides a monster is worth backing</b>. Say you fall for the ${F(factions[0])}: if they take the island, you win.`,
    ];
    const stack = (/** @type {string[]} */ items, /** @type {string} */ tag) => `<div class="tut-stack">${items.map((x, i) => `<${tag} data-s="${i + 1}">${x}</${tag}>`).join('')}</div>`;
    return `<div class="tut-intro">${stack(titles, 'h2')}
      ${versus([groupItem(groups[0], true), ...groups.slice(1).map((g, k) => groupItem(g, false, 0, wave(k)))], [factionItem(factions[0], true), ...factions.slice(1).map((f, k) => factionItem(f, false, 0, true, wave(k)))])}
      ${stack(texts, 'p')}</div>`;
  };
  return [
    chapter('1 · The story'),
    ...[1, 2, 3].map((n) => () => ({ type: /** @type {const} */ ('modal'), title: '', html: intro(), stage: { key: 'intro', n } })),
  ];
}

// ---------------------------------------------------------------------------
// 2. How it works: one story on one small table
// ---------------------------------------------------------------------------

/**
 * The game's concepts as one story on one growing scene (designer,
 * 2026-10-11: each rule taught once, in a cohesive story): a faction row and
 * your sway; a location; monsters arriving; sway following as bids; your
 * group and affinity; a card's suit and its three uses (an offering, then a
 * gambit at a location of its suit shown as the road not taken, then a gambit
 * with its faction for real); the contested fight, one rule at a time; what
 * happens to sway after; ties; the loop.
 * @returns {Step[]}
 */
function chapterStory() {
  const c = sceneCast();
  const { arch } = yours();
  const map = /** @type {{ directions: { dq: number, dr: number }[], locations: Record<string, { q: number, r: number }> }} */ (/** @type {unknown} */ (spec.map));
  const adj = (/** @type {string} */ a, /** @type {string} */ b) => map.directions.some((d) => map.locations[a].q + d.dq === map.locations[b].q && map.locations[a].r + d.dr === map.locations[b].r);
  const own = (/** @type {string} */ l) => locationById(l).archetype === arch.id;
  const { F0, G, H, ash } = c;
  const homeOf = (/** @type {string} */ l, /** @type {string} */ f) => locationById(l).archetype === factionById(f).archetype;
  // Your archetype's ground (S, the Werewolves), a neighbour off it (T, the Cryptids the lure will draw), and a
  // third place (W) where the Cryptids and another faction stand tied, on ground neither calls home.
  const S = c.L1;
  const T = Object.keys(map.locations).find((l) => adj(S, l) && !own(l)) ?? c.L2;
  const W = Object.keys(map.locations).find((l) => l !== S && l !== T && (adj(S, l) || adj(T, l)) && !homeOf(l, G) && !homeOf(l, H)) ?? c.L3;
  const gArch = /** @type {typeof spec.archetypes[number]} */ (spec.archetypes.find((x) => x.id === factionById(G).archetype));
  const deck = deckOf(c.st);
  // A mixed hand: a card of the Cryptids' suit (the offering that pays for the lure), your suit's lure, and an unsuited card.
  const lure = deck.find((id) => cardById(id).suit === arch.id && cardById(id).action === 'lure') ?? deck.find((id) => cardById(id).suit === arch.id) ?? deck[0];
  const offer = deck.find((id) => cardById(id).suit === gArch.id) ?? deck.find((id) => cardById(id).suit && id !== lure) ?? deck[1];
  const wild = deck.find((id) => !cardById(id).suit) ?? deck[2];
  const po = printedOf(c.st, offer);
  const sF = c.supF, sG = c.st.supply[G], y = c.you0, yG = c.mine.standing[G], a = c.ash0, S0 = c.mine.supply, A0 = c.st.players[ash].supply;
  const icon = suitIcon(arch.id), gIcon = suitIcon(gArch.id);
  /** @param {{ fS?: number, fRow?: number, ashF?: number, gSup?: number, gRow?: number, ashG?: number, S?: any, T?: any, W?: any, you?: any, ash?: any, gRowOn?: boolean, players?: boolean, hexes?: string[] }} o @returns {Scene} */
  const at = (o) => ({
    rows: [
      { f: F0, supply: o.fS ?? sF, sway: { [YOU]: o.fRow ?? y, [ash]: o.ashF ?? a - 1 } },
      ...(o.gRowOn === false ? [] : [{ f: G, supply: o.gSup ?? sG, sway: { [YOU]: o.gRow ?? yG, [ash]: o.ashG ?? 0 } }]),
    ],
    hexes: (o.hexes ?? [T, S, W]).map((loc) => ({ loc, tokens: {}, ...(loc === S ? o.S : loc === T ? o.T : o.W) })),
    players: o.players === false ? [] : [{ pid: YOU, supply: S0, trophies: {}, ...o.you }, { pid: ash, supply: A0, trophies: {}, ...o.ash }],
  });
  const hand = [offer, lure, wild];
  const tied = { tokens: { [G]: 2, [H]: 2 } };
  // The table, beat by beat. Sway starts in the rows and flies onto the locations once the slayers are there.
  const q1 = at({ fS: sF + 4, fRow: y + 1, ashF: a, gRowOn: false, players: false, hexes: [] });
  const q2 = at({ fRow: y + 1, ashF: a, gRowOn: false, players: false, hexes: [S], S: { tokens: { [F0]: 4 } } });
  const q3a = at({ fRow: y + 1, ashF: a, gSup: sG + 5, ashG: 3, players: false, S: { tokens: { [F0]: 4 } } });
  const q3 = at({ fRow: y + 1, ashF: a, ashG: 3, players: false, S: { tokens: { [F0]: 4 } }, T: { tokens: { [G]: 3 } }, W: tied });
  const qP = at({ fRow: y + 1, ashF: a, ashG: 3, S: { tokens: { [F0]: 4 } }, T: { tokens: { [G]: 3 } }, W: tied, you: { hand } });
  const placed = { S: { tokens: { [F0]: 4 }, sway: { [YOU]: 1, [ash]: 1 } }, T: { tokens: { [G]: 3 }, sway: { [ash]: 2 } }, W: { ...tied, sway: { [ash]: 1 } } };
  const q5 = at({ ...placed, you: { hand } });
  const q7 = at({ ...placed, gRow: yG + po, you: { supply: S0 - po, hand: [lure, wild] } });
  // The road not taken: on the Werewolves (FAC), into the Cryptids' location, where Ash leads.
  const q8 = at({ ...placed, fRow: y - 1, gRow: yG + po, S: { tokens: {}, sway: { [YOU]: 1, [ash]: 1 } }, T: { tokens: { [G]: 3, [F0]: 4 }, sway: { [ash]: 2, [YOU]: 1 } }, you: { supply: S0 - po, hand: [wild] } });
  // The play: at your archetype's location (LOC); the Cryptids come, paid with the sway the offering bought.
  const after = (/** @type {any} */ sHex, /** @type {any} */ you, /** @type {any} */ ash_, fRow = y, w = /** @type {any} */ ({ ...tied, sway: { [ash]: 1 } })) => at({ fRow, gRow: yG + po - 1, S: sHex, T: { tokens: {}, sway: { [ash]: 2 } }, W: w, you: { supply: S0 - po, hand: [wild], ...you }, ash: ash_ });
  const q9 = after({ tokens: { [F0]: 4, [G]: 3 }, sway: { [YOU]: 2, [ash]: 1 } }, {}, {});
  const q12 = after({ tokens: { [F0]: 4, [G]: 3 }, sway: { [YOU]: 2, [ash]: 1 }, doomed: { [G]: 3, [F0]: 1 } }, {}, {});
  const q13 = after({ tokens: { [F0]: 4, [G]: 0 }, sway: { [YOU]: 2, [ash]: 1 } }, { trophies: { [G]: 3 } }, {});
  const q14 = after({ tokens: { [F0]: 3 }, sway: { [YOU]: 2, [ash]: 1 } }, { trophies: { [G]: 3 } }, { trophies: { [F0]: 1 } });
  const q15 = after({ tokens: { [F0]: 3 }, sway: { [YOU]: 0, [ash]: 1 } }, { trophies: { [G]: 3 }, supply: S0 - po + 1 }, { trophies: { [F0]: 1 } }, y + 1);
  // Meanwhile, the tie: both groups wiped out, Ash's sway home, the location scorched.
  const q16 = after({ tokens: { [F0]: 3 }, sway: { [YOU]: 0, [ash]: 1 } }, { trophies: { [G]: 3 }, supply: S0 - po + 1 }, { trophies: { [F0]: 1 }, supply: A0 + 1 }, y + 1, { tokens: {}, sway: {}, scorched: true });
  const t = 'How it works';
  return [
    chapter('2 · How it works'),
    // The archetype is the thread: a faction, its ground and the cards of its suit all share it (designer, 2026-10-11).
    sceneStep(t, q1, q1, `<p>This is the ${F(F0)}' row: their monsters waiting in supply. The ${F(F0)} are ${icon} ${esc(arch.name)}, one of five archetypes.</p>`, [`row:${F0}`]),
    sceneStep(t, q1, q2, `${eq(tokenHtml(F0, 2), op('/'), tokenHtml(G, 2), op('='), 'a monster')}<p>Below it, ${L(S)}: a ${icon} location, ${esc(arch.name)} home ground. The ${F(F0)} come onto it from their supply.</p>`, [`hex:${S}`, `row:${F0}`]),
    sceneStep(t, q3a, q3, `<p>Nearby, the ${F(G)} (${gIcon} ${esc(gArch.name)}) arrive at ${L(T)}, and square off with the ${F(H)} at ${L(W)}. Two factions in one place will fight.</p>`, [`hex:${T}`, `hex:${W}`, `row:${G}`]),
    sceneStep(t, q3, qP, `<p>The slayers arrive: you, and ${who(ash)}.</p>`, [`player:${YOU}`, `player:${ash}`]),
    sceneStep(t, qP, q5, `<p>Your cubes are your <b>sway</b>. In a faction's row: how much it has noticed you. On a location: a <b>bid</b> for the trophies when it fights.</p>`, [`hexsway:${S}`, `hexsway:${T}`, `hexsway:${W}`, `row:${F0}`, `row:${G}`]),
    sceneStep(t, q5, q5, `${eq(icon, op('card'), op('→'), `${icon} locations`, op('or'), `the ${F(F0)}`)}<p>Every card has a <b>suit</b>: an archetype, or none. A ${icon} card's action works at ${icon} locations (any faction there) or on the ${F(F0)} (anywhere). Each card is played once, one of three ways.</p>`, [`card:${offer}`, `card:${lure}`, `card:${wild}`]),
    sceneStep('1 · An offering', q5, q7, `${eq(miniCard(offer), op('→'), `+${po} sway`, op('→'), tokenHtml(G, 1))}<p>Spend a card for the sway printed on it, with the faction of its suit: this ${gIcon} card gives sway with the ${F(G)}. Its action is lost.</p>`, [`card:${offer}`, `player:${YOU}`, `row:${G}`]),
    sceneStep(`2 · A gambit on the ${factionById(F0).name} (FAC)`, q7, q8, `<p>Play ${miniCard(lure)} on the ${F(F0)}, anywhere: bait ${L(T)} and only the ${F(F0)} come, paid with 1 of your sway with them. But ${who(ash)} has 2 there: you'd be second. Not this one.</p>`, [`card:${lure}`, `hex:${S}`, `hex:${T}`, `row:${F0}`]),
    sceneStep(`3 · A gambit at a ${arch.name} location (LOC)`, q7, q9, `<p>Or play it at a ${icon} location: bait ${L(S)}, and the biggest group next door comes, whatever its faction: the ${F(G)} from ${L(T)}. You pay 1 sway with them, the sway your offering just bought, and it lands there with them. Now you lead, 2 to 1.</p>${frame('Luring a faction to a new place costs 1 sway with it, and that sway lands there with them: your bid.', 'Build sway with a faction before you need to move it.')}`, [`card:${lure}`, `hex:${S}`, `hex:${T}`, `row:${G}`]),
    sceneStep('End of round: the fights', q9, q9, `<p>When the round ends, every location holding two factions fights: here ${L(S)} and ${L(W)}. ${L(S)} first.</p>${frame('When a location fights, the most sway there takes the bigger pile of the dead; second most, the smaller.', 'Bid where the big fights will be.')}${more('Ties between players', 'Tied for the most sway: a group whose archetype matches the location wins the tie. Otherwise nobody tied collects their pile.')}`, [`hextok:${S}:${F0}`, `hextok:${S}:${G}`, `hexsway:${S}`], S),
    sceneStep('Counting the dead', q12, q12, fightMath(F0, 4, G, 3), [`hextok:${S}:${F0}`, `hextok:${S}:${G}`]),
    sceneStep('The bigger pile', q12, q13, `<p>All 3 ${F(G)}: the bigger pile, to you, the most sway here.</p>`, [`hextok:${S}:${G}`, `hexsway:${S}`, `player:${YOU}`]),
    sceneStep('The smaller pile', q13, q14, `<p>The 1 ${esc(one(factionById(F0).name))} the winners lost: the smaller pile, to ${who(ash)}, second.</p>`, [`hextok:${S}:${F0}`, `hexsway:${S}`, `player:${ash}`]),
    sceneStep('After the fight', q14, q15, `<p>Only the leader's sway leaves: half of yours joins your sway with the winners, the ${F(F0)}; the rest comes home. ${who(ash)}'s stays for the next fight.</p>`, [`hexsway:${S}`, `row:${F0}`, `player:${YOU}`]),
    sceneStep('Meanwhile, a tie', q15, q16, `${eq('2 vs 2', op('→'), 'both wiped out')}<p>At ${L(W)} the ${F(G)} and the ${F(H)} are level, on ground neither calls home. Both groups are wiped out, nobody collects, sway goes home, and ${L(W)} is gone for good. (On one side's own ground, that side would win.)</p>`, [`hex:${W}`, `player:${ash}`], W),
    sceneStep('The loop', q16, q16, `${eq(chip('an offering'), op('→'), chip('a gambit'), op('→'), chip('a fight'), op('→'), chip('trophies'))}<p>Cards become sway, sway becomes bids, bids become trophies.</p>`),
  ];
}

// ---------------------------------------------------------------------------
// 3. Growth and control
// ---------------------------------------------------------------------------

function chapterGrowth() {
  const c = sceneCast();
  const ownF = c.L1;
  const away = Object.keys(c.st.board).find((l) => l !== c.L1 && l !== c.L2 && locationById(l).archetype !== factionById(c.G).archetype) ?? c.L2;
  /** @type {Scene} */ const held = { rows: [{ f: c.F0, supply: 6, sway: {} }, { f: c.G, supply: 6, sway: {} }], hexes: [{ loc: away, tokens: { [c.G]: 2 } }, { loc: ownF, tokens: { [c.F0]: 3, [c.G]: 1 } }] };
  /** @type {Scene} */ const g0 = { ...held, hexes: [{ loc: away, tokens: { [c.G]: 2 } }, { loc: ownF, tokens: { [c.F0]: 3 } }] };
  const more = boosted() ? 1 : 0; // AL3, off by default (designer, 2026-10-21)
  /** @type {Scene} */ const g1 = { rows: [{ f: c.F0, supply: 5 - more, sway: {} }, { f: c.G, supply: 5, sway: {} }], hexes: [{ loc: away, tokens: { [c.G]: 3 } }, { loc: ownF, tokens: { [c.F0]: 4 + more } }] };
  return [
    chapter('3 · Growth'),
    sceneStep('Control', held, held, `${eq(tokens(c.F0, 3), op('vs'), tokens(c.G, 1), op('→'), `the ${F(c.F0)} control ${L(ownF)}`)}<p>The most monsters at a location control it. At most two factions share a location: no lure can bring a third.</p>`, [`hex:${ownF}`]),
    sceneStep('Growth', g0, g1, `${eq(`${opt('growth')}+ alone`, op('→'), '+1', ...(more ? [op('·'), 'on its own ground, if it controls it', op('→'), '+1 more'] : []))}<p>After the fights, each faction alone somewhere with ${opt('growth')}+ monsters grows from its supply.${more ? ` ${L(ownF)} is the ${F(c.F0)}' own ground, so they grow twice there.` : ''} Left alone, monsters multiply.</p>`, [`hex:${away}`, `hex:${ownF}`, `row:${c.G}`, `row:${c.F0}`]),
  ];
}

// ---------------------------------------------------------------------------
// 4. How to win (endingSteps, above), then the table and the round
// ---------------------------------------------------------------------------

function chapterEndings() {
  return [chapter('4 · How to win'), ...endingSteps()];
}

/** The real table: where the story's pieces live, and the island's geography. */
function chapterTable() {
  const v = view();
  const { arch, faction } = yours();
  const onBoard = Object.keys(v.board).filter((l) => (v.board[l].sway[YOU] ?? 0) > 0);
  const map = /** @type {{ regions: Record<string, { neighbours: string[] }>, locations: Record<string, { region: string }> }} */ (/** @type {unknown} */ (spec.map));
  const region = map.locations[onBoard[0] ?? Object.keys(map.locations)[0]].region;
  const inRegion = Object.keys(map.locations).filter((l) => map.locations[l].region === region);
  return [
    chapter('5 · The table'),
    spot(SEL.factions, 'The faction rows', `<p>The rows from the story, for real: each faction's supply and everyone's sway with it. You start with ${v.players[YOU].standing[faction]} with the ${F(faction)}, ${v.players[YOU].standing[v.factions.find((f) => f !== faction) ?? faction]} with each of the rest.</p>`),
    spot([SEL.supply, SEL.trophyTab], 'Your pieces', '<p>Your supply sits in the bar at the bottom; your trophies, secret, in the tab on the right.</p>'),
    ...(onBoard.length ? [spot(onBoard.map(SEL.hex), 'Your ground', `<p>You start with 1 sway on each ${suitIcon(arch.id)} location.</p>`)] : []),
    spot(inRegion.map(SEL.hex), 'Locations and regions', `<p>A <b>location</b> is one hex; a <b>region</b> is three neighbouring locations, like these. Monsters only move by your gambits, and each card says where: next door, anywhere, or a whole region. Hovering a target lights everything a card reaches.</p>`),
  ];
}

/** The round: its phases as a picture, with what's particular to this draft in the same frame (drafting itself is familiar: designer, 2026-10-11). */
function chapterRound() {
  const st = R.table.state;
  const hand = /** @type {Record<string, number>} */ (spec.constants.handSize)[String(st.seating.length)];
  const c = sceneCast();
  const first = st.players[YOU].batch[0];
  return [
    chapter('6 · A round'),
    modal('Every round, three phases', `
      <div class="tut-phases">
        <div><b>1 · Draft</b>${eq(miniCard(first))}<span>plan your week: ${hand} cards each</span></div>
        <div><b>2 · Play</b>${eq(tokenHtml(c.F0, 1), op('→'), cubeHtml(colour(YOU), 9))}<span>one card at a time, until everyone passes</span></div>
        <div><b>3 · Resolve</b>${eq(CLASH, op('then'), '+1')}<span>fights, then growth</span></div>
      </div>
      <p><b>The draft:</b> pick and pass, left, to ${hand} cards each (${plural(st.leftOut.length, 'card')} left out, unseen). When a new batch arrives, your picks so far rejoin it, so you can put one back for something better. Cards you don't play are lost; every round drafts the whole deck again.</p>
      <p class="small muted">${rounds()} rounds, then the count.</p>`),
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
    R.chapter = '7 · Round 1';
    const first = /** @type {string} */ (s.first);
    const marked = s.players[first].hand.filter((id) => 'marked' in cardById(id) && cardById(id).marked).sort((a, b) => String(cardById(a).marked).localeCompare(String(cardById(b).marked)))[0];
    next(spot(SEL.players, 'Who goes first', `${marked ? eq(miniCard(marked)) : ''}<p>${who(first)} ${verb(first, 'holds', 'hold')} the earliest marked card (A–D), so ${first === YOU ? 'you open' : `${esc(first)} opens`} with it, then play goes round the table. We'll stop at each new kind of play and skip the rest.</p>`), drive);
    return null;
  }
  if (actor === YOU) {
    // The learner moves on the table, with a hint (designer, 2026-10-11); the controls explained the first time.
    // No cards left: the pass is the only move, made for them (designer, 2026-10-11).
    if (s.phase === 'play' && !s.pending && !s.players[YOU].hand.length) { next(...turnSteps(YOU, { type: 'pass' }), drive); return null; }
    if (hooks.ui.note) { hooks.ui.note = null; hooks.render(); }
    if (R.mode === 'guided' && !R.taught.yourTurn) { R.taught.yourTurn = true; next(yourTurn, waitStep, drive); } else next(waitStep, drive);
    return null;
  }
  if (R.mode === 'guided') {
    // Teach a bot's turn if it's the first of its kind; otherwise fast-forward it.
    const move = /** @type {Move} */ (autoMove(R.table, actor));
    const kind = kindOf(move);
    const fresh = kind !== 'other' && !R.taught[`kind:${kind}`];
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
function waitStep() {
  R.waiting = true;
  if (hooks.ui.note) { hooks.ui.note = null; hooks.render(); }
  ahead();
  return { type: 'wait' };
}

/**
 * The scripted move for the learner's decision now, worked out while they
 * think (autoMove on a copy): the hint shows it, and the bots' dice move on
 * as it would, so nothing is computed after their click.
 * @type {{ state: GameState, move: Move | null, rng: number, memory: import('./tutorial-game.js').Table['memory'] } | null}
 */
let scripted = null;
function ahead() {
  if (scripted?.state === R.table.state) return scripted;
  const copy = copyTable(R.table);
  const move = autoMove(copy, YOU);
  scripted = { state: R.table.state, move, rng: copy.rng, memory: copy.memory };
  return scripted;
}

/** The draft: the first pass taught in round 1, the rest fast-forwarded; in play mode, the learner picks. @returns {Step[]} */
function draftSteps() {
  // The learner drafts by hand, hints on (designer, 2026-10-11); the draft's rules were in chapter 6.
  const intro = R.mode === 'guided' && !R.taught.draftIntro ? [chapter('7 · Round 1'), () => {
    R.taught.draftIntro = true;
    hooks.hints(true, tutorialHint);
    return /** @type {Show} */ ({ type: 'spot', target: ['#hint-overlay', SEL.hand], title: 'Your turn now', html: `<p>From here you play: tick cards to keep, then ✓. The <b>Hint</b> panel suggests a move, says why, and recalls the rule. Take it or not: any legal move is fine. The Hints button (top right) cycles between off, marks on the table only, and marks with this panel.</p>` });
  }] : [];
  return [...intro, waitStep, () => { botPicks(R.table); return null; }, () => present(R.table.state).then(() => null)];
}

/** The learner's first turn in the play phase: the controls. @type {Step} */
function yourTurn() {
  hooks.ui.note = null;
  const s = R.table.state;
  const mustOpen = s.first === YOU && !s.opened;
  return { type: 'spot', target: SEL.hand, title: 'Your turn', html: `${eq(chip('LOC'), chip('FAC'), chip('+N'), op('·'), '<span class="bar-btn bar-icon">»</span>')}<p>Play one card or pass. Click a card, then LOC or FAC on it, then a lit target; its +N spends it as an offering; » passes.${mustOpen ? ' You must open with your marked card.' : ''}</p>` };
}

/**
 * The tutorial's hint: the move the deal was chosen around (autoMove, on a
 * copy so the game's dice are untouched), explained. @returns {import('./hints.js').Hint | null}
 */
function tutorialHint() {
  const a = ahead();
  if (!a.move) return null;
  return suggest(R.table.state, YOU, clone(a.memory[YOU] ?? {}), a.move);
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
    const teach = once('sway') ? recall('An offering: sway with that faction, fuel for gambits and a bet on it.') : '';
    return { type: 'spot', target: SEL.faction(f), title: `${who(pid)} ${verb(pid, 'spends')} ${esc(c.name)}`, html: `${eq(cubes(pid, gain), op('→'), tokenHtml(f, 1), `<b>+${gain}</b>`)}${teach}`, auto: pid !== YOU && !teach };
  }
  if (move.type === 'play') {
    const c = cardById(move.card);
    const ch = changes(a, b);
    // What it did: the target in words (a rival's face-down tokens stay secret), or the card's own text when the target has none.
    const said = c.action === 'token' && pid !== YOU ? `two face-down ${c.name} tokens: one real, one bluff` : describeTarget(c.id, move.target ?? null);
    const what = said || c.text;
    // Paid from standing onto the board (a move), not from the supply (a token's marker cube).
    const placed = b.seating.some((x) => b.factions.some((f) => b.players[x].standing[f] < a.players[x].standing[f]) && Object.keys(b.board).some((l) => (b.board[l].sway[x] ?? 0) > (a.board[l].sway[x] ?? 0)));
    const teach = [
      placed && once('move') ? recall('The sway paid for the lure lands with the monsters as a bid.') : '',
      c.action === 'token' && once('token') ? `${eq(faceDownHtml({ kind: c.id }, colour(pid)), faceDownHtml({ kind: c.id }, colour(pid)))}<p>Two face-down tokens with the same back, the card's: one real, one bluff, and only ${pid === YOU ? 'you know' : `${esc(pid)} knows`} which. Each carries 1 sway as a bid; both flip when that location fights.</p>` : '',
      !c.suit && c.action !== 'token' && once('special') ? '<p class="small muted">Unsuited cards can\'t be spent for sway; they bend the rules instead.</p>' : '',
    ].join('');
    // The learner's own play was just previewed: say what changed rather than repeat the target.
    // Your own play was just previewed, and a token play is shown as its tokens: no need to say it again.
    const body = (pid === YOU && R.taught.yourTurn) ? '' : c.action === 'token' && pid !== YOU ? `<div class="tut-card">${cardHtml(c.id, { view: playerView(b, YOU) })}</div>` : `<div class="tut-card">${cardHtml(c.id, { view: playerView(b, YOU) })}</div><p>${esc(what.replace(/\.$/, ''))}${ch.locs.length || !said ? '' : ': no effect'}.</p>`;
    return { type: 'spot', target: ch.locs.length ? ch.locs.map(SEL.hex) : SEL.seat(pid), title: `${who(pid)} ${verb(pid, 'plays')} ${esc(c.name)}`,
      html: `${body}${teach}` || '<p>Done: see the board.</p>', auto: pid !== YOU && !teach, dwell: 3200 };
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
    // The learner's own move was made on the table: narrate it only when it teaches something.
    const quiet = pid === YOU && (R.mode === 'play' || shown.type !== 'spot' || !/tut-recall|<p>(?!Done)/.test(shown.html));
    // The learner's own move moves at once (designer, 2026-10-11: no pause after their click); a bot's is pointed at first.
    if (pid === YOU) return present(after).then(() => (quiet ? null : shown));
    return lead(shown, () => present(after)).then(() => (quiet ? null : shown));
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
    if (teach) R.chapter = '7 · Round 1';
    hooks.ui.note = 'Resolve: fights';
    return present(start).then(() => ({ type: 'spot', target: fights.length ? fights.map(SEL.hex) : SEL.board, title: `${who(pid)} ${verb(pid, 'passes', 'pass')}: play is over`,
      html: `${fights.length ? `${eq(op('2 factions'), op('='), 'a fight')}<p>${plural(fights.length, 'fight')} now. Unplayed cards are lost.</p>` : '<p>No location holds two factions: no fights.</p>'}`, dwell: 1800 }));
  }];
  fights.forEach((loc, i) => {
    const a = chain[i], b = chain[i + 1];
    if (teach && i > 0) return;
    if (teach) steps.push(() => present(a, { instant: true }).then(() => ({ type: 'spot', target: SEL.hex(loc), title: `Fight at ${L(loc)}`, html: `${before(a, loc)}${recall('The most sway takes the bigger pile, second most the smaller.')}` })));
    // Counting the dead (designer, 2026-10-11), with this fight's real numbers.
    if (teach) steps.push(() => ({ type: 'spot', target: SEL.hex(loc), title: 'Counting the dead', html: countDead(a, b, loc) }));
    steps.push(() => present(a, { instant: true }).then(() => lead({ type: 'spot', target: SEL.hex(loc), title: `Fight at ${L(loc)}`, html: after(a, b, loc), dwell: 2600 }, () => present(b))));
  });
  if (teach && fights.length > 1) {
    // The rest fast-forwarded, summed up in one step.
    steps.push(() => {
      hooks.ui.note = 'Resolve: fast-forward';
      let p = Promise.resolve();
      for (let i = 1; i < fights.length; i++) p = p.then(() => present(chain[i + 1], { speed: 2 }));
      const lines = fights.slice(1).map((loc, i) => `<p class="small"><b>${L(loc)}</b></p>${fightLines(chain[i + 1], chain[i + 2], loc)}`).join('');
      return p.then(() => ({ type: 'spot', target: fights.slice(1).map(SEL.hex), title: `${plural(fights.length - 1, 'more fight')}`, html: lines }));
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
    const lesson = once('growth') ? recall(`Growth: ${g}+ alone → +1${boosted() ? '; on its own ground, if it controls it, +1 more' : ''}.`) : '';
    return present(end, { instant: true }).then(() => lead({ type: 'spot', target: grew.length ? grew.map(SEL.hex) : SEL.board, title: 'Growth',
      html: `<p>${grew.length ? `${plural(grew.length, 'location')} grew.` : 'Nothing grew.'}</p>${lesson}` }, () => present(shown)));
  }, () => {
    hooks.ui.note = null;
    const s = R.table.state;
    return present(s).then(() => null);
  });
  return steps;
}

/**
 * The first live fight's losses, counted out: the chapter 2 rule with this
 * fight's numbers (a face-down token flips first, so its counts are the ones
 * that fight). @param {GameState} a @param {GameState} b @param {string} loc
 */
function countDead(a, b, loc) {
  const sides = Object.entries(a.board[loc].tokens).filter(([, n]) => n > 0).map(([f, n]) => ({ f, n, lost: n - (b.board[loc].tokens[f] ?? 0) }));
  const flip = a.board[loc].token ? '<p class="small">The face-down token flips first, so the count is after it.</p>' : '';
  if (sides.length === 2 && !a.board[loc].token) {
    const [x, y] = sides;
    if (x.n === y.n) {
      const home = sides.find((t) => factionById(t.f).archetype === locationById(loc).archetype);
      if (b.board[loc].scorched || !home) return `${eq(tokens(x.f, x.n), op('vs'), tokens(y.f, y.n), op('→'), 'level')}<p>A true tie on ground neither calls home: both groups wiped out, nobody collects, and ${L(loc)} is gone for good.</p>`;
      const away = /** @type {typeof home} */ (sides.find((t) => t !== home));
      return `${eq(tokens(x.f, x.n), op('vs'), tokens(y.f, y.n), op('→'), 'level')}<p>Level, but ${L(loc)} is ${suitIcon(locationById(loc).archetype)} ground, the ${F(home.f)}' own: they win, as in any fight.</p>${eq(`the ${F(away.f)} lose all`, op('='), tokens(away.f, away.n))}${eq('the winners lose half that, rounded up', op('='), tokens(home.f, Math.ceil(away.n / 2)))}`;
    }
    const [win, lose] = x.n > y.n ? [x, y] : [y, x];
    return fightMath(win.f, win.n, lose.f, lose.n);
  }
  return `${flip}${sides.map((s) => eq(`the ${F(s.f)} lose`, op('='), s.lost ? tokens(s.f, s.lost) : '0')).join('')}${recall('Bigger group wins; the loser loses all, the winner half that, rounded up.')}`;
}

/** A fight before it happens. @param {GameState} s @param {string} loc */
function before(s, loc) {
  const place = s.board[loc];
  const sides = Object.entries(place.tokens).filter(([, n]) => n > 0).map(([f, n]) => `${tokens(f, n)}<b>${n}</b>`);
  const bids = s.seating.map((pid) => [pid, place.sway[pid] ?? 0]).filter(([, n]) => Number(n) > 0).sort((x, y) => Number(y[1]) - Number(x[1]));
  return `${eq(sides[0] ?? '', op('vs'), sides[1] ?? '')}${bids.length ? eq(op('sway here'), ...bids.map(([pid, n]) => `${cubes(String(pid), Number(n))}<span class="small">${who(String(pid))}</span>`)) : '<p>Nobody has sway here: the dead go back to their supplies.</p>'}${place.token ? '<p class="small">A face-down token here flips first.</p>' : ''}`;
}

/** The engine's log lines speak of the learner's seat in the third person ("You takes"); put them in the second. @param {string} line */
const youify = (line) => line.replace(/\bYou takes\b/g, 'You take').replace(/\bYou's\b/g, 'Your').replace(/\bYou passes\b/g, 'You pass').replace(/\bYou plays\b/g, 'You play');

/**
 * A fight in a few short lines, from the engine's own log: any face-down
 * token that flipped, who beat whom, and each player's piles together.
 * @param {GameState} a @param {GameState} b @param {string} loc
 */
function fightLines(a, b, loc) {
  const was = a.log.find((e) => e.round === a.round)?.events.length ?? 0;
  const raw = (b.log.find((e) => e.round === b.round)?.events ?? []).slice(was).map((l) => youify(l.trim()));
  const name = locationById(loc).name;
  /** @type {Map<string, string[]>} */
  const piles = new Map();
  const out = [];
  for (const line of raw) {
    const pile = /^(.+?) takes? a pile of (\d+) (.+)\.$/.exec(line);
    if (pile) { piles.set(pile[1], [...(piles.get(pile[1]) ?? []), `${pile[2]} ${pile[3]}`]); continue; }
    const beat = /^.+?: (.+) beat (.+?);/.exec(line);
    if (beat) { out.push(`<b>${esc(beat[1])}</b> beat ${esc(beat[2])}`); continue; }
    out.push(esc(line.replace(`${name}: `, '')));
  }
  for (const [pid, ps] of piles) out.push(`${esc(pid)} ${pid === 'You' ? 'take' : 'takes'} ${esc(ps.join(' + '))}`);
  return `<ul class="tut-changes">${out.map((l) => `<li>${l}</li>`).join('')}</ul>`;
}

/** A fight's result, from the engine's own log lines. @param {GameState} a @param {GameState} b @param {string} loc */
function after(a, b, loc) {
  const scorch = b.board[loc].scorched && once('scorch') ? '<p class="small muted">A true tie: nobody collects, and the location is gone for good.</p>' : '';
  return `${fightLines(a, b, loc)}${scorch}`;
}

/** After round 1: skip to the end, or play on. @type {Step} */
function choiceStep() {
  const t = opt('threshold');
  return { type: 'modal', title: 'That was a round', html: `
    ${eq(chip('draft'), op('→'), chip('play'), op('→'), chip('fights'), op('→'), chip('growth'))}
    <p>${totalPresence(view())} monsters on the island against the mark of ${t}, with ${plural(rounds() - 1, 'round')} to go. Skip to the ending, or play on yourself.</p>`,
  buttons: [
    { label: 'Play the rest', run: () => { next(playHelp); void go(); } },
    { label: 'Skip to the end', primary: true, run: () => { next(skipStep, drive); void go(); } },
  ] };
}

/** Before playing on: how to play from the table. @type {Step} */
function playHelp() {
  return { type: 'modal', title: 'Your game', html: `
    <ul class="tut-list">
      <li><b>Draft:</b> tick the cards to keep in your hand, then ✓.</li>
      <li><b>A plan:</b> click a card, choose LOC or FAC on it, then click the lit targets on the board.</li>
      <li><b>An offering:</b> the +N on a suit card spends it for sway.</li>
      <li><b>Pass:</b> » on the bar.</li>
      <li><b>Hints:</b> the Hints button, top right, cycles off → marks → marks and panel.</li>
    </ul>
    <p class="small muted">Hover a lit target to preview what it does.</p>`,
  buttons: [{ label: 'Play', primary: true, run: () => { R.mode = 'play'; R.chapter = 'Your game'; next(drive); void go(); } }] };
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
    return { type: 'spot', target: SEL.presence, title: `Round ${last}: the last fights`, html: `<p>The bots played rounds 2–${last - 1} and the last round's cards. ${totalPresence(view())} monsters before the last fights.</p>` };
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
    return { type: 'spot', target: SEL.presence, title: 'The count', html: `<p><b>${totalPresence(v)}</b> monsters left: ${r.side === 'island' ? `${t} or fewer, so <b>complete sets decide</b>` : `more than ${t}, so <b>the ${r.factions.map(F).join(' and ')} decide</b>, by sway`}.</p>` };
  }), () => {
    const v = view();
    const r = /** @type {NonNullable<PlayerView['result']>} */ (v.result);
    const mine = v.me.trophies;
    const rows = v.seating.slice().sort((x, y) => r.scores[y] - r.scores[x]).map((pid) => `<li>${cubeHtml(colour(pid), 10)} ${who(pid)}: <b>${r.scores[pid]}</b>${r.players.includes(pid) ? ' <span class="tag">wins</span>' : ''}</li>`).join('');
    const how = r.side === 'island'
      ? `<p>Complete sets decide: each score is your fewest colour. Yours:</p>${trophyRow(v.factions, v.factions.map((f) => mine[f]))}${Math.max(...v.seating.map((pid) => r.scores[pid])) === 0 ? '<p class="small">Nobody hunted every kind, so nobody completed a set.</p>' : ''}`
      : `<p>The ${r.factions.map(F).join(' and ')} decide: each score is sway with ${r.factions.length > 1 ? 'them' : 'them'} minus their trophies. Yours: ${r.factions.map((f) => `${v.players[YOU].standing[f]} − ${mine[f]}`).join(' + ')}.</p>`;
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
const fixedEl = (x) => { const f = x.closest('.dock, .hand, .side-stack, .overlay'); return !!f && getComputedStyle(f).position === 'fixed'; };
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

/**
 * Swap a step's text in place: the old fades out where it was, the new fades
 * in, and the box eases to the new height (designer: text changes without
 * jumps). @param {Element} box  a .tut-textbox @param {string} html
 */
function swapText(box, html) {
  const old = box.querySelector('.tut-text:not(.is-leaving)');
  const fresh = document.createElement('div');
  fresh.className = 'tut-text is-arriving';
  fresh.innerHTML = html;
  const from = /** @type {HTMLElement} */ (box).offsetHeight;
  old?.classList.add('is-leaving');
  box.appendChild(fresh);
  const to = fresh.offsetHeight;
  const b = /** @type {HTMLElement} */ (box);
  b.style.height = `${from}px`;
  void b.offsetHeight;
  b.style.height = `${to}px`;
  requestAnimationFrame(() => fresh.classList.remove('is-arriving'));
  setTimeout(() => { old?.remove(); b.style.height = ''; }, 280);
}
/** Cross-fade a heading's text. @param {Element | null} h @param {string} text */
function swapTitle(h, text) {
  if (!h || h.textContent === text) return;
  h.classList.add('is-swapping');
  setTimeout(() => { h.textContent = text; h.classList.remove('is-swapping'); }, 120);
}

/** @param {Show} show */
function display(show) {
  const before = R.shown;
  R.shown = show;
  R.waiting = show.type === 'wait';
  el.block.hidden = show.type === 'wait' || R.mode === 'play';
  // The hand stays collapsed unless the step is about it (or it's the learner's move).
  if (show.type === 'modal') hooks.hand('tuck');
  if (show.type === 'wait') hooks.hand('rest');
  if (show.type === 'wait') { hideAll(); return; }
  if (show.type === 'modal') {
    el.wrap.hidden = false;
    const staged = el.modal.querySelector('.tut-intro, [data-stage-key]');
    if (show.stage && el.modal.dataset.stageKey === show.stage.key && staged) {
      // Same modal, next stage: no redraw, so everything moves by transition.
      el.modal.querySelectorAll('.tut-intro').forEach((x) => { /** @type {HTMLElement} */ (x).dataset.stage = String(show.stage?.n); });
      const navEl = el.modal.querySelector('.tut-nav');
      if (navEl) navEl.outerHTML = nav();
      /** @type {HTMLElement | null} */ (el.modal.querySelector('.btn-primary'))?.focus({ preventScroll: true });
      return;
    }
    // A scene beat that carries straight on from the last one: update it in place.
    const slotNow = el.modal.querySelector('.tut-scene-slot');
    if (show.scene && !show.buttons && before?.type === 'modal' && before.scene && before.scene.to === show.scene.from && slotNow && el.modal.querySelector('.tut-textbox')) {
      swapTitle(el.modal.querySelector('h2'), show.title);
      swapText(/** @type {Element} */ (el.modal.querySelector('.tut-textbox')), show.html);
      const navEl = el.modal.querySelector('.tut-nav');
      if (navEl) navEl.outerHTML = nav();
      const sc = show.scene;
      const slot = /** @type {HTMLElement} */ (slotNow);
      if (sc.from !== sc.to) setTimeout(() => { if (R.shown === show) void playScene(slot, sc.from, sc.to, sc.fight, sc.focus); }, 120);
      else {
        morph(slot, sceneHtml(sc.to, sc.focus));
        if (sc.fight) setTimeout(() => { if (R.shown === show) void tussle(slot, /** @type {string} */ (sc.fight)); }, 200);
      }
      /** @type {HTMLElement | null} */ (el.modal.querySelector('.btn-primary'))?.focus({ preventScroll: true });
      return;
    }
    const buttons = show.buttons
      ? `<div class="tut-nav"><span class="tut-chapter">${esc(R.chapter)}</span><span class="tut-nav-btns">${R.mode === 'guided' && R.history.length > 1 ? '<button class="btn" data-tut="back">Back</button>' : ''}${show.buttons.map((b, i) => `<button class="btn${b.primary ? ' btn-primary' : ''}" data-tut="button:${i}">${esc(b.label)}</button>`).join('')}</span></div>`
      : nav();
    el.modal.innerHTML = `${show.title ? `<h2>${esc(show.title)}</h2>` : ''}<div class="tut-body">${show.scene ? `<div class="tut-scene-slot">${sceneHtml(show.scene.from, show.scene.focus)}</div>` : ''}<div class="tut-textbox"><div class="tut-text">${show.html}</div></div></div>${buttons}`;
    el.modal.dataset.stageKey = show.stage?.key ?? '';
    if (show.stage) el.modal.querySelectorAll('.tut-intro').forEach((x) => { /** @type {HTMLElement} */ (x).dataset.stage = String(show.stage?.n); });
    const sc = show.scene;
    if (sc) {
      const slot = /** @type {HTMLElement} */ (el.modal.querySelector('.tut-scene-slot'));
      if (sc.from !== sc.to) setTimeout(() => { if (R.shown === show) void playScene(slot, sc.from, sc.to, sc.fight, sc.focus); }, 450);
      else if (sc.fight) setTimeout(() => { if (R.shown === show) void tussle(slot, /** @type {string} */ (sc.fight)); }, 450);
    }
    /** @type {HTMLElement | null} */ (el.modal.querySelector('.btn-primary'))?.focus({ preventScroll: true });
    return;
  }
  lit = Array.isArray(show.target) ? show.target : [show.target];
  if (R.mode !== 'play') void focusOn(lit);
  el.dim.toggleAttribute('hidden', R.mode === 'play');
  el.tip.hidden = false;
  el.tip.classList.toggle('is-caption', R.mode === 'play');
  const box = el.tip.querySelector('.tut-textbox');
  if (before?.type === 'spot' && box && R.mode !== 'play') {
    // Spot after spot: the tooltip glides to its new place and its text cross-fades.
    swapTitle(el.tip.querySelector('h3'), show.title.replace(/<[^>]+>/g, ''));
    swapText(box, show.html);
    const navEl = el.tip.querySelector('.tut-nav');
    if (navEl) navEl.outerHTML = nav();
  } else {
    el.tip.style.left = ''; el.tip.style.top = ''; // each step finds its own place
    el.tip.innerHTML = `<h3>${show.title}</h3><div class="tut-body"><div class="tut-textbox"><div class="tut-text">${show.html}</div></div></div>${R.mode === 'play' ? '' : nav()}`;
  }
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
  // The bots' dice run as if the learner's move had been chosen by autoMove (as the deal was found), whatever they play.
  const a = ahead();
  R.table.rng = a.rng;
  R.table.memory = clone(a.memory);
  if (move.type === 'pick') {
    play(R.table, YOU, move);
    void present(R.table.state, { instant: true }).then(() => go());
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
  R.queue = [...chapterTheme(), ...chapterStory(), ...chapterGrowth(), ...chapterEndings(), ...chapterTable(), ...chapterRound(), drive];
  void present(R.table.state, { instant: true }).then(() => go());
}
