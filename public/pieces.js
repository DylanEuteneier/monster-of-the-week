// @ts-check
/**
 * Pieces on the board, as HTML: presence tokens (a CSS cardboard token with
 * the faction's pixel art on its face) and influence cubes (a CSS 3D cube in
 * a seat colour). Styles live in app.css under "Pieces on the board".
 * Shared by the table and the /assets page; holds no rules.
 */
import art from './assets/sprites.json' with { type: 'json' };

/** Draft seat colours, by palette key; final picks wait on the palette (assets/README.md). */
const SEAT_KEYS = ['r', 'c', 'G', 'o', 'p'];
const palette = /** @type {Record<string, string | null>} */ (art.palette);
export const SEAT_COLOURS = SEAT_KEYS.map((key) => palette[key] ?? '#888888');

/** @typedef {{ pad: number, width: number, height: number, src: string, art: string }} Token */
const tokens = /** @type {Record<string, Token>} */ (art.tokens);

/** @param {string} id */
export const hasToken = (id) => id in tokens;

/**
 * A presence token at a whole-number pixel scale, or '' if none exists.
 * @param {string} id  the sprite id (an archetype id for now)
 * @param {number} scale
 */
export function tokenHtml(id, scale) {
  const token = tokens[id];
  if (!token) return '';
  const w = token.width * scale;
  const h = token.height * scale;
  const pad = token.pad * scale;
  const art = (token.width - 2 * token.pad) * scale;
  return `<span class="token" style="width:${w}px;height:${h}px;--w:${w}px;--t:${Math.max(1, scale / 2)}px" aria-hidden="true">`
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

