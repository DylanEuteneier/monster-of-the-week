// @ts-check
/**
 * Moving pieces: when the table goes from one view to the next, every token
 * and cube that changed place flies from where it was to where it went.
 * Display only, holds no rules: it compares two player views and reads the
 * page for positions. Used by every table (app.js), so live games, bot turns
 * and the tutorial all animate the same way.
 *
 * Where pieces can be (D14, G.2):
 * - a faction's tokens: on a location, in the faction's supply, or a trophy
 *   (yours, shown in your trophy tab; a rival's, at their seat, from the
 *   public "takes a pile" line in the log, IN2);
 * - a player's cubes: on a location, in standing with a faction, or in
 *   their supply.
 */
import { factionById } from './engine.js';
import { tokenHtml, cubeHtml } from './pieces.js';

/** @typedef {import('./engine.js').PlayerView} PlayerView */

/** One kind of place a piece can be. @typedef {{ kind: 'loc', loc: string } | { kind: 'supply' } | { kind: 'standing', faction: string } | { kind: 'trophy', player: string }} Spot */
/** Pieces of one kind leaving or arriving somewhere. @typedef {{ spot: Spot, n: number }} Flow */
/** @typedef {{ piece: string, from: Spot, to: Spot, n: number, owner: string, faction?: string }} Flight */

/** How long one piece is in the air, and the gap between pieces leaving. */
export const FLIGHT_MS = 700;
const STAGGER_MS = 45;
/** The most pieces drawn along one path (the rest land with them). */
const MAX_PER_PATH = 6;

/**
 * Pair what left with what arrived, in order of preference: each source sends
 * to the first destination that still wants pieces.
 * @param {Flow[]} out @param {Flow[]} into @returns {{ from: Spot, to: Spot, n: number }[]}
 */
function pair(out, into) {
  const paths = [];
  const want = into.map((f) => ({ ...f }));
  for (const src of out) {
    let left = src.n;
    for (const dst of want) {
      if (left <= 0) break;
      const n = Math.min(left, dst.n);
      if (n <= 0) continue;
      paths.push({ from: src.spot, to: dst.spot, n });
      dst.n -= n;
      left -= n;
    }
  }
  return paths;
}

/** Split signed changes into what left and what arrived. @param {[Spot, number][]} changes */
function flows(changes) {
  return {
    out: changes.filter(([, d]) => d < 0).map(([spot, d]) => ({ spot, n: -d })),
    into: changes.filter(([, d]) => d > 0).map(([spot, n]) => ({ spot, n })),
  };
}

/** The piles rivals took since `before`, from the public log ("  Bea takes a pile of 3 Vampires."). @param {PlayerView} before @param {PlayerView} after */
function pilesTaken(before, after) {
  const seen = new Map(before.log.map((e) => [e.round, e.events.length]));
  const lines = after.log.flatMap((e) => e.events.slice(seen.get(e.round) ?? 0));
  const byName = new Map(after.factions.map((f) => [factionById(f).name, f]));
  /** @type {{ player: string, faction: string, n: number }[]} */
  const piles = [];
  for (const line of lines) {
    const m = /^\s*(.+) takes a pile of (\d+) (.+)\.$/.exec(line);
    const faction = m && byName.get(m[3]);
    if (m && faction && m[1] !== after.you) piles.push({ player: m[1], faction, n: Number(m[2]) });
  }
  return piles;
}

/**
 * Every piece that moved between two views of the same game.
 * @param {PlayerView} before @param {PlayerView} after @param {(player: string) => string} colourOf
 * @returns {Flight[]}
 */
export function planFlights(before, after, colourOf) {
  if (before.you !== after.you || before.seating.join() !== after.seating.join() || before.factions.join() !== after.factions.join()) return [];
  const locs = Object.keys(after.board);
  /** @type {Flight[]} */
  const flights = [];
  const piles = pilesTaken(before, after);
  for (const f of after.factions) {
    /** @type {[Spot, number][]} */
    const changes = locs.map((loc) => [{ kind: 'loc', loc }, (after.board[loc].tokens[f] ?? 0) - (before.board[loc]?.tokens[f] ?? 0)]);
    changes.push([{ kind: 'supply' }, (after.supply[f] ?? 0) - (before.supply[f] ?? 0)]);
    changes.push([{ kind: 'trophy', player: after.you }, (after.me.trophies[f] ?? 0) - (before.me.trophies[f] ?? 0)]);
    for (const p of piles.filter((x) => x.faction === f)) changes.push([{ kind: 'trophy', player: p.player }, p.n]);
    const { out, into } = flows(changes);
    for (const path of pair(out, into)) flights.push({ ...path, piece: tokenHtml(f, 2), owner: '', faction: f });
  }
  for (const pid of after.seating) {
    const was = before.players[pid], now = after.players[pid];
    if (!was || !now) continue;
    /** @type {[Spot, number][]} */
    const changes = [
      ...after.factions.map((f) => /** @type {[Spot, number]} */ ([{ kind: 'standing', faction: f }, (now.standing[f] ?? 0) - (was.standing[f] ?? 0)])),
      ...locs.map((loc) => /** @type {[Spot, number]} */ ([{ kind: 'loc', loc }, (after.board[loc].sway[pid] ?? 0) - (before.board[loc]?.sway[pid] ?? 0)])),
      [{ kind: 'supply' }, now.supply - was.supply],
    ];
    // Natural paths first: standing onto the board, the board back to standing, then the supply.
    const order = { standing: 0, loc: 1, supply: 2, trophy: 3 };
    const { out, into } = flows(changes);
    out.sort((a, b) => order[a.spot.kind] - order[b.spot.kind]);
    into.sort((a, b) => order[a.spot.kind] - order[b.spot.kind]);
    for (const path of pair(out, into)) flights.push({ ...path, piece: cubeHtml(colourOf(pid), 12), owner: pid });
  }
  return flights;
}

/**
 * Where a spot is on the page, or null if it isn't shown.
 * @param {Spot} spot @param {string} owner  the player whose cubes these are ('' for tokens) @param {string} you @param {string} [faction]
 * @returns {Element | null}
 */
function elementOf(spot, owner, you, faction) {
  const q = (/** @type {string} */ s) => document.querySelector(s);
  const seat = (/** @type {string} */ pid) => q(`#players .player[data-player="${CSS.escape(pid)}"]`);
  switch (spot.kind) {
    case 'loc': return q(`#board [data-tile="${CSS.escape(spot.loc)}"] .hex`) ?? q(`#board [data-tile="${CSS.escape(spot.loc)}"]`);
    case 'standing': return q(`#factions .faction-row[data-faction="${CSS.escape(spot.faction)}"] .cell-sway`);
    case 'trophy': return spot.player === you ? q('#score') : seat(spot.player);
    case 'supply':
      if (!owner) return q(`#factions .faction-row[data-faction="${CSS.escape(faction ?? '')}"] .cell-supply`);
      return owner === you ? q('#mine .chip') : seat(owner);
  }
}

/** The middle of an element on screen. @param {Element} el */
function centre(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** True when moving pieces should be drawn at all. */
export function motionOn() {
  if (typeof document === 'undefined' || typeof document.querySelector !== 'function' || typeof window === 'undefined') return false;
  return !(typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

/**
 * Fly the pieces over the page (drawn as it was before the change), then
 * resolve. Both ends are measured again on every frame, so a page that
 * scrolls or shifts mid-flight still lands each piece on its place.
 * Destinations get a short landing pulse.
 * @param {Flight[]} flights @param {string} you @param {{ speed?: number }} [o]  speed > 1 is faster
 * @returns {Promise<void>}
 */
export function fly(flights, you, o = {}) {
  /** @type {Path[]} */
  const paths = [];
  for (const f of flights) {
    const from = elementOf(f.from, f.owner, you, f.faction);
    const to = elementOf(f.to, f.owner, you, f.faction);
    if (from && to) paths.push({ from, to, piece: f.piece, n: f.n });
  }
  return flyPaths(paths, o);
}

/** Pieces flying from one element to another. @typedef {{ from: Element, to: Element, piece: string, n: number }} Path */

/**
 * Fly pieces along paths between elements (any elements: the table, or the
 * tutorial's small scenes), then resolve. Both ends are measured again on
 * every frame. Destinations get a short landing pulse.
 * @param {Path[]} paths @param {{ speed?: number }} [o]
 * @returns {Promise<void>}
 */
export function flyPaths(paths, o = {}) {
  if (!paths.length || !motionOn()) return Promise.resolve();
  const speed = Math.max(0.25, o.speed ?? 1);
  const duration = FLIGHT_MS / speed;
  const layer = document.createElement('div');
  layer.className = 'flight-layer';
  document.body.appendChild(layer);
  /** @type {{ el: HTMLElement, from: Element, to: Element, delay: number, jitter: number, last: { a: { x: number, y: number }, b: { x: number, y: number } } }[]} */
  const pieces = [];
  /** @type {Set<Element>} */
  const landing = new Set();
  let i = 0;
  for (const f of paths) {
    const { from, to } = f;
    landing.add(to);
    const n = Math.min(f.n, MAX_PER_PATH);
    for (let k = 0; k < n; k++) {
      const el = document.createElement('div');
      el.className = 'flight';
      el.innerHTML = f.piece;
      el.style.opacity = '0';
      layer.appendChild(el);
      pieces.push({ el, from, to, delay: (i++ * STAGGER_MS) / speed, jitter: (k - (n - 1) / 2) * 6, last: { a: centre(from), b: centre(to) } });
    }
  }
  if (!pieces.length) {
    layer.remove();
    return Promise.resolve();
  }
  const ease = (/** @type {number} */ t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
  return new Promise((done) => {
    const start = performance.now();
    const frame = (/** @type {number} */ now) => {
      let busy = false;
      for (const p of pieces) {
        const t = Math.min(1, Math.max(0, (now - start - p.delay) / duration));
        if (t < 1) busy = true;
        // Re-measure both ends (an element replaced mid-flight keeps its last place).
        if (p.from.isConnected) p.last.a = centre(p.from);
        if (p.to.isConnected) p.last.b = centre(p.to);
        const { a, b } = p.last;
        const e = ease(t);
        const lift = Math.min(80, 24 + Math.hypot(b.x - a.x, b.y - a.y) * 0.15);
        const x = a.x + (b.x - a.x) * e + p.jitter;
        const y = a.y + (b.y - a.y) * e - lift * 4 * e * (1 - e);
        const scale = 0.9 + 0.3 * Math.sin(Math.PI * e);
        p.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${scale.toFixed(3)})`;
        p.el.style.opacity = String(t <= 0 ? 0 : t < 0.1 ? t * 10 : t > 0.92 ? (1 - t) / 0.08 : 1);
      }
      if (busy) requestAnimationFrame(frame);
      else {
        layer.remove();
        for (const el of landing) {
          el.classList.remove('is-landing');
          void (/** @type {HTMLElement} */ (el)).offsetWidth;
          el.classList.add('is-landing');
          setTimeout(() => el.classList.remove('is-landing'), 500);
        }
        done();
      }
    };
    requestAnimationFrame(frame);
  });
}
