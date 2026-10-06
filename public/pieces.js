// @ts-check
/**
 * Pieces on the board, as HTML: presence tokens (a CSS cardboard token with
 * the faction's pixel art on its face) and influence cubes (a CSS 3D cube in
 * a seat colour). Styles live in app.css under "Pieces on the board".
 * Shared by the table and the /assets page; holds no rules.
 */
import art from './assets/sprites.json' with { type: 'json' };

/** Seat colours, by palette key: the palette's most vivid, clearly distinct hues (red, gold, cyan, lime, pink). */
const SEAT_KEYS = ['r', 'y', 'c', 'l', 'p'];
const palette = /** @type {Record<string, string | null>} */ (art.palette);
export const SEAT_COLOURS = SEAT_KEYS.map((key) => palette[key] ?? '#888888');

/** @typedef {{ pad: number, width: number, height: number, src: string, art: string }} Token */
const tokens = /** @type {Record<string, Token>} */ (art.tokens);

/** @param {string} id */
export const hasToken = (id) => id in tokens;

/**
 * Target states (2026-10-06): '' for the normal game state; 'candidate' when
 * the piece can be chosen as a card's target; 'hovered' forces the hovered
 * look (a candidate also shows it under the pointer).
 * @typedef {'' | 'candidate' | 'hovered'} TargetState
 */

/** @param {TargetState} state */
const stateClass = (state) => (state === 'candidate' ? ' is-candidate' : state === 'hovered' ? ' is-candidate is-hovered' : '');

/**
 * A presence token at a whole-number pixel scale, or '' if none exists.
 * @param {string} id  the sprite id (an archetype id for now)
 * @param {number} scale
 * @param {TargetState} [state]
 */
export function tokenHtml(id, scale, state = '') {
  const token = tokens[id];
  if (!token) return '';
  const w = token.width * scale;
  const h = token.height * scale;
  const pad = token.pad * scale;
  const art = (token.width - 2 * token.pad) * scale;
  return `<span class="token${stateClass(state)}" style="width:${w}px;height:${h}px;--w:${w}px;--t:${Math.max(1, scale / 2)}px" aria-hidden="true">`
    + `<span class="token-face" style="--cut:url('${token.src}')"></span>`
    + `<img class="token-art" src="${token.art}" alt="" style="left:${pad}px;top:${pad}px;width:${art}px;height:${art}px">`
    + '</span>';
}

/**
 * An influence cube in a seat colour.
 * @param {string} colour  any CSS colour
 * @param {number} [size]  edge length in px
 */
export function cubeHtml(colour, size = 14) {
  return `<span class="cube" style="--c:${colour};--size:${size}px" aria-hidden="true">`
    + '<span class="cube-face cube-front"></span><span class="cube-face cube-side"></span><span class="cube-face cube-top"></span>'
    + '</span>';
}


/** @typedef {{ width: number, height: number, src: string, pieces: { x: number, y: number, w: number, h: number }, states?: Record<string, { src: string, pad: number }> }} Hex */
const hexes = /** @type {Record<string, Hex>} */ (art.hexes ?? {});

/**
 * A board hex at a whole-number pixel scale, with optional pieces laid over
 * its clear middle, in a target state. '' if no art exists.
 * @param {string} id  a location id
 * @param {number} scale
 * @param {string} [inner]  pieces HTML
 * @param {TargetState} [state]
 */
export function hexHtml(id, scale, inner = '', state = '') {
  const hex = hexes[id];
  if (!hex) return '';
  const esc = (/** @type {string} */ v) => v.replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`);
  const w = hex.width * scale, h = hex.height * scale, p = hex.pieces;
  const states = Object.entries(hex.states ?? {}).map(([name, st]) => {
    const pad = st.pad * scale;
    return `<img class="hex-state hex-state-${name}" src="${esc(st.src)}" width="${w + 2 * pad}" height="${h + 2 * pad}" alt="" style="left:${-pad}px;top:${-pad}px">`;
  }).join('');
  return `<div class="hex${stateClass(state)}" style="width:${w}px;height:${h}px">`
    + `<img class="sprite" src="${esc(hex.src)}" width="${w}" height="${h}" alt="">${states}`
    + `<div class="hex-pieces" style="left:${p.x * scale}px;top:${p.y * scale}px;width:${p.w * scale}px;height:${p.h * scale}px">${inner}</div>`
    + '</div>';
}
