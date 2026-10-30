// @ts-check
/**
 * Action icons (IK1, D34): composable blocks, a verb mark plus a noun mark, as clean vector shapes (not pixel art).
 * A first draft for review on the assets page: no card or prompt uses them yet. Each mark is a 24×24 SVG drawn in
 * currentColor, so it takes the colour of where it sits.
 */

/** @param {string} body @param {string} [extra] */
const svg = (body, extra = '') => `<svg class="ik-svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${body}</svg>`;

/** A hexagon path centred on (cx, cy) with radius r (pointy top, as the board's hexes). */
const hex = (/** @type {number} */ cx, /** @type {number} */ cy, /** @type {number} */ r) => {
  const p = [0, 1, 2, 3, 4, 5].map((i) => { const a = (Math.PI / 3) * i - Math.PI / 2; return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`; });
  return `<polygon points="${p.join(' ')}"/>`;
};
/** A small isometric cube centred near (cx, cy). */
const cube = (/** @type {number} */ cx, /** @type {number} */ cy, /** @type {number} */ s) => `<path d="M${cx} ${cy - s}l${s} ${s / 2}v${s}l-${s} ${s / 2}l-${s} -${s / 2}v-${s}z M${cx - s} ${cy - s / 2}l${s} ${s / 2}l${s} -${s / 2} M${cx} ${cy}v${s}"/>`;
/** An arrowhead at (x, y) pointing along angle a (degrees). */
const head = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ a) => `<path d="M-4 -3.5L0 0L-4 3.5" transform="translate(${x} ${y}) rotate(${a})"/>`;

/** The nouns: the things actions act on. @type {Record<string, { label: string, svg: string }>} */
export const NOUNS = {
  token: { label: 'Faction token', svg: svg('<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/>') },
  group: { label: 'Group', svg: svg('<circle cx="8" cy="15" r="4"/><circle cx="16" cy="15" r="4"/><circle cx="12" cy="8" r="4"/>') },
  lone: { label: 'Lone group', svg: svg(`${hex(12, 12, 10)}<circle cx="12" cy="12" r="4"/>`) },
  fight: { label: 'Fight', svg: svg('<path d="M5 5l14 14M19 5L5 19M4 9l5-5M15 4l5 5"/>') },
  sway: { label: 'Sway (your cube)', svg: svg(cube(12, 10, 7)) },
  standing: { label: 'Standing (with a faction)', svg: svg(`${cube(12, 8, 6)}<path d="M3 21h18"/>`) },
  location: { label: 'Location', svg: svg(hex(12, 12, 10)) },
  neighbour: { label: 'Neighbour (next door)', svg: svg(`${hex(7.5, 12, 6)}${hex(17.5, 12, 6)}`, ' stroke-width="1.75"') },
  empty: { label: 'Empty location', svg: svg(hex(12, 12, 10), ' stroke-dasharray="3 3"') },
  scorched: { label: 'Scorched location', svg: svg(`${hex(12, 12, 10)}<path d="M8 8l8 8M16 8l-8 8"/>`) },
  supply: { label: 'Supply', svg: svg('<path d="M3 10v9h18v-9"/><path d="M3 10h18"/><circle cx="9" cy="6" r="2.5"/><circle cx="15" cy="6" r="2.5"/>') },
  trophy: { label: 'Trophy', svg: svg('<path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3M12 14v4M8 21h8"/>') },
  pile: { label: 'Pile', svg: svg('<circle cx="7" cy="17" r="3.5"/><circle cx="17" cy="17" r="3.5"/><circle cx="12" cy="9" r="3.5"/>', ' stroke-width="1.75"') },
  card: { label: 'Card (X: cards in hand)', svg: svg('<rect x="6" y="3" width="12" height="18" rx="1.5"/><path d="M9.5 9.5l5 5M14.5 9.5l-5 5"/>') },
  played: { label: 'A played card', svg: svg('<rect x="4" y="6" width="11" height="15" rx="1.5"/><rect x="9" y="3" width="11" height="15" rx="1.5"/>') },
  mark: { label: 'Mark', svg: svg('<path d="M6 21V4"/><path d="M6 4h11l-3 4 3 4H6"/>') },
  gate: { label: 'The Gate (joined)', svg: svg(`${hex(7.5, 12, 6)}${hex(16.5, 12, 6)}<path d="M10 12h4" stroke-width="3"/>`, ' stroke-width="1.75"') },
  leader: { label: 'Sway leader', svg: svg('<path d="M4 18l2-10 6 5 6-5 2 10z"/>') },
};

/** The verbs: what an action does. @type {Record<string, { label: string, svg: string }>} */
export const VERBS = {
  gather: { label: 'Gather (into one)', svg: svg(`<circle cx="12" cy="12" r="2.5" fill="currentColor"/><path d="M3 4l6 6M21 4l-6 6M12 22v-6"/>${head(9, 10, 45)}${head(15, 10, 135)}${head(12, 16, -90)}`) },
  spread: { label: 'Spread (1 to each)', svg: svg(`<circle cx="12" cy="12" r="2.5" fill="currentColor"/><path d="M10 10L4 4M14 10l6-6M12 15v7"/>${head(4, 4, -135)}${head(20, 4, -45)}${head(12, 22, 90)}`) },
  move: { label: 'Move (one to another)', svg: svg(`<circle cx="5" cy="12" r="2.5"/><path d="M8 12h12"/>${head(20, 12, 0)}`) },
  split: { label: 'Split (evenly in two)', svg: svg(`<path d="M3 12h7M10 12l9-7M10 12l9 7"/>${head(19, 5, -38)}${head(19, 19, 38)}`) },
  trail: { label: 'Trail (step by step)', svg: svg(`<path d="M3 18h4M9 12h4M15 6h4" /><path d="M7 18l2-6M13 12l2-6" stroke-dasharray="1 3"/>${head(19, 6, 0)}`) },
  march: { label: 'March on (a rival within two)', svg: svg(`<path d="M3 12h11"/>${head(14, 12, 0)}<circle cx="19" cy="12" r="3"/><path d="M19 6v2M19 16v2"/>`) },
  drive: { label: 'Drive out (every side leaves)', svg: svg(`<path d="M9 9l6 6M15 9l-6 6"/><path d="M5 5L2 2M19 5l3-3M5 19l-3 3M19 19l3 3"/>`) },
  flee: { label: 'Flee (at night)', svg: svg(`<path d="M14 5a7 7 0 1 0 5 9 5.5 5.5 0 0 1-5-9z"/><path d="M3 20h9"/>${head(12, 20, 0)}`) },
  slay: { label: 'Slay (as trophies)', svg: svg('<path d="M4 20L18 6M15 4l5 5M6 14l4 4"/>') },
  raise: { label: 'Raise / bring (from supply)', svg: svg(`<path d="M3 21h18"/><path d="M12 18V5"/>${head(12, 5, -90)}`) },
  mark: { label: 'Mark (1 sway on it)', svg: svg('<path d="M6 21V4"/><path d="M6 4h11l-3 4 3 4H6"/>') },
  join: { label: 'Join (two as one)', svg: svg('<rect x="2.5" y="8" width="9" height="8" rx="4"/><rect x="12.5" y="8" width="9" height="8" rx="4"/>') },
  pay: { label: 'Pay (spend)', svg: svg('<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>') },
  gain: { label: 'Gain', svg: svg('<circle cx="12" cy="12" r="9"/><path d="M8 12h8M12 8v8"/>') },
  burn: { label: 'Burn (back to supply)', svg: svg('<path d="M12 3c1 4 6 6 6 11a6 6 0 0 1-12 0c0-3 2-4 3-6 1 2 2 3 3 3-1-3-1-5 0-8z"/>') },
  take: { label: 'Take a card', svg: svg(`<rect x="11" y="3" width="10" height="14" rx="1.5"/><path d="M3 15h9"/>${head(3, 15, 180)}`) },
  bend: { label: 'Bend a fight (a rule this round)', svg: svg('<path d="M12 3l9 9-9 9-9-9z"/><path d="M12 8v5M12 16v.5"/>') },
};

/**
 * A composed icon: a verb block and a noun block, with an optional amount (1, X, ½, all).
 * @param {keyof typeof VERBS} verb @param {keyof typeof NOUNS} noun @param {string} [amount]
 */
export function iconHtml(verb, noun, amount = '') {
  const v = VERBS[verb], n = NOUNS[noun];
  return `<span class="ik" title="${v.label}: ${n.label}"><span class="ik-v">${v.svg}</span><span class="ik-n">${n.svg}</span>${amount ? `<span class="ik-amt">${amount}</span>` : ''}</span>`;
}

/** A noun on its own (a target, or where an action happens). @param {keyof typeof NOUNS} noun @param {string} [amount] */
export const nounHtml = (noun, amount = '') => `<span class="ik ik-solo" title="${NOUNS[noun].label}"><span class="ik-n">${NOUNS[noun].svg}</span>${amount ? `<span class="ik-amt">${amount}</span>` : ''}</span>`;
