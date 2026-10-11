// @ts-check
/**
 * Pieces on the board, as HTML: presence tokens (a CSS cardboard token with
 * the faction's pixel art on its face) and sway cubes (a CSS 3D cube in
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
 * A sway cube in a seat colour.
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

// ---------------------------------------------------------------------------
// Marks (designer, 2026-10-11): rubble on a scorched location, face-down
// tokens whose backs show the card that placed them, and a token for each
// effect a card leaves on a location. The icons are printed pixel art
// (assets/sprites.py MARKS); the tokens holding them are CSS.
// ---------------------------------------------------------------------------

const marks = /** @type {Record<string, { width: number, height: number, src: string }>} */ (/** @type {any} */ (art).marks ?? {});

/** A mark's pixel art at a whole-number scale, or '' if none. @param {string} id @param {number} [scale] */
export function markImg(id, scale = 2) {
  const m = marks[id];
  return m ? `<img class="sprite mark" src="${m.src}" width="${m.width * scale}" height="${m.height * scale}" alt="">` : '';
}

/**
 * A face-down token in its owner's colour. Everyone sees its back: the icon
 * of the card that placed it (a play's real token and its bluff look the
 * same). Its owner always sees its face instead: the card's icon on
 * cardboard if it's the real one, struck through if it's the bluff.
 * @param {{ kind?: string, real?: boolean }} token @param {string} colour  the owner's seat colour @param {string} [title]
 */
export function faceDownHtml(token, colour, title = '') {
  const face = token.real === undefined ? 'back' : token.real ? 'real' : 'bluff';
  return `<span class="face-down is-${face}" style="--owner:${colour}"${title ? ` title="${title}"` : ''}>${token.kind ? markImg(token.kind, 2) : ''}</span>`;
}

/** The effects a card can leave on a location for the round, by the flag it sets (engine Place), with words for a tooltip. */
export const EFFECTS = /** @type {const} */ ({
  truce: 'Call a Truce: no fight here this round',
  double: 'Split Up, Gang!: some players\' sway here counts twice at this fight',
  wake: 'Wake the Dead: this fight can\'t scorch, and the loser\'s casualties rise as Undead',
  backdoor: 'Install a Backdoor: some players\' sway here counts 1 more per Sentient token at this fight',
  swarm: 'Link the Swarm: the Sentients here count their tokens next door too at this fight',
  lock: 'Lock Down the Town: no group moves into or out of this region this round',
});

/** A round token showing an effect on a location. @param {keyof typeof EFFECTS} id */
export function effectHtml(id) {
  return `<span class="effect-token" title="${EFFECTS[id].replace(/"/g, '&quot;')}">${markImg(id, 2)}</span>`;
}
