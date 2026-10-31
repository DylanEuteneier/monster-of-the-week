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

// ---------------------------------------------------------------------------
// Direction B (designer, 2026-10-30): each verb is a mini board diagram, its places and arrows, and the noun is the
// piece that moves through it. Standing is off the board, so its places are faction circles, not hexes.
// ---------------------------------------------------------------------------

/** The piece a noun draws inside a diagram, centred on (x, y). @type {Record<string, (x: number, y: number) => string>} */
const PIECES = {
  token: (x, y) => `<circle cx="${x}" cy="${y}" r="3" fill="currentColor" stroke="none"/>`,
  sway: (x, y) => `<rect x="${x - 2.75}" y="${y - 2.75}" width="5.5" height="5.5" fill="currentColor" stroke="none" transform="rotate(45 ${x} ${y})"/>`,
  standing: (x, y) => `<rect x="${x - 2.75}" y="${y - 2.75}" width="5.5" height="5.5" fill="currentColor" stroke="none" transform="rotate(45 ${x} ${y})"/>`,
  location: (x, y) => `<circle cx="${x}" cy="${y}" r="2" fill="currentColor" stroke="none"/>`,
  neighbour: (x, y) => `<circle cx="${x}" cy="${y}" r="3" fill="currentColor" stroke="none"/>`,
  fight: (x, y) => `<circle cx="${x - 2}" cy="${y}" r="2.5" fill="currentColor" stroke="none"/><circle cx="${x + 2.5}" cy="${y}" r="2.5" fill="none" stroke-width="1.5"/>`,
};
const piece = (/** @type {string} */ noun, /** @type {number} */ x, /** @type {number} */ y) => (PIECES[noun] ?? PIECES.token)(x, y);
/** A place: a hex on the board, or a faction circle for standing. */
const place = (/** @type {string} */ noun, /** @type {number} */ x, /** @type {number} */ y, /** @type {string} */ extra = '') => noun === 'standing'
  ? `<circle cx="${x}" cy="${y}" r="6" stroke-width="1.5"${extra}/>`
  : `<g stroke-width="1.5"${extra}>${hex(x, y, 7)}</g>`;
/** An arrow from (x1, y1) to (x2, y2), stopping short of both ends. */
const arrow = (/** @type {number} */ x1, /** @type {number} */ y1, /** @type {number} */ x2, /** @type {number} */ y2, /** @type {string} */ dash = '') => {
  const dx = x2 - x1, dy = y2 - y1, d = Math.hypot(dx, dy), ux = dx / d, uy = dy / d, a = (Math.atan2(dy, dx) * 180) / Math.PI;
  const sx = x1 + ux * 8.5, sy = y1 + uy * 8.5, ex = x2 - ux * 9, ey = y2 - uy * 9;
  return `<path d="M${sx.toFixed(1)} ${sy.toFixed(1)}L${ex.toFixed(1)} ${ey.toFixed(1)}" stroke-width="1.5"${dash ? ` stroke-dasharray="${dash}"` : ''}/>${head(ex, ey, a).replace('<path', '<path stroke-width="1.5"')}`;
};
/** A diagram in an 80×44 box, drawn at 1.25×. */
const dia = (/** @type {string} */ body) => `<svg class="ik-svg ik-dia" viewBox="0 0 80 44" width="100" height="55" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
/** The supply: a tray at (x, y). */
const tray = (/** @type {number} */ x, /** @type {number} */ y) => `<path d="M${x - 7} ${y - 3}v5h14v-5" stroke-width="1.5"/>`;
/** Three places, top, middle and bottom: the middle one staggered sideways so none touch. */
const COLUMN = [8, 22, 36];
const stagger = (/** @type {number} */ y, /** @type {number} */ dx) => (y === 22 ? dx : 0);

/** Each verb's diagram, given the noun that moves. @type {Record<string, (noun: string) => string>} */
const DIAGRAMS = {
  gather: (n) => `${place(n, 66, 22)}${piece(n, 66, 22)}${COLUMN.map((y) => { const x = 10 + stagger(y, 12); return `${place(n, x, y)}${piece(n, x, y)}${arrow(x, y, 66, 22)}`; }).join('')}`,
  spread: (n) => `${place(n, 14, 22)}${piece(n, 14, 22)}${COLUMN.map((y) => { const x = 70 - stagger(y, 12); return `${place(n, x, y)}${piece(n, x, y)}${arrow(14, 22, x, y)}`; }).join('')}`,
  move: (n) => `${place(n, 12, 22)}${place(n, 68, 22)}${piece(n, 68, 22)}${arrow(12, 22, 68, 22)}`,
  split: (n) => `${place(n, 12, 22)}${[8, 36].map((y) => `${place(n, 68, y)}${piece(n, 65.5, y)}${piece(n, 71, y)}${arrow(12, 22, 68, y)}`).join('')}`,
  trail: (n) => `${[9, 29, 49, 69].map((x, i) => `${place(n, x, 22)}${i ? piece(n, x, 22) : ''}`).join('')}${arrow(9, 22, 29, 22)}${arrow(29, 22, 49, 22)}${arrow(49, 22, 69, 22)}`,
  march: (n) => `${place(n, 10, 26)}${piece(n, 10, 26)}${place(n, 40, 26, ' stroke-dasharray="2 2"')}${place(n, 70, 26)}<circle cx="70" cy="26" r="3.5" stroke-width="1.5"/><path d="M16 17Q40 2 64 17" stroke-width="1.5"/>${head(64, 17, 32).replace('<path', '<path stroke-width="1.5"')}`,
  drive: (n) => `${place(n, 40, 22)}<circle cx="37.5" cy="22" r="2.5" fill="currentColor" stroke="none"/><circle cx="43" cy="22" r="2.5" stroke-width="1.5"/>${place(n, 9, 22)}${piece(n, 9, 22)}${place(n, 71, 22)}<circle cx="71" cy="22" r="3" stroke-width="1.5"/>${arrow(40, 22, 9, 22)}${arrow(40, 22, 71, 22)}`,
  flee: (n) => `${place(n, 14, 24)}${place(n, 66, 24)}${piece(n, 66, 24)}${arrow(14, 24, 66, 24, '2 2.5')}<path d="M38 6a5 5 0 1 0 4 7.5 3.75 3.75 0 0 1-4-7.5z" stroke-width="1.25"/>`,
  slay: (n) => `${place(n, 14, 22)}${piece(n, 11, 22)}${piece(n, 17, 22)}${arrow(14, 22, 64, 22)}<path d="M59 13h12v5a6 6 0 0 1-12 0zM65 24v5M60 32h10" stroke-width="1.5"/>`,
  raise: (n) => `${tray(14, 36)}${piece(n, 14, 32)}${place(n, 64, 14)}${piece(n, 64, 14)}${arrow(14, 33, 64, 14)}`,
  join: (n) => `${place(n, 14, 22)}${place(n, 66, 22)}<path d="M23 20h34M23 24h34" stroke-width="1.5"/>`,
  mark: (n) => `${place(n, 40, 26)}<path d="M40 26V5h11l-3 4 3 4H40" stroke-width="1.5"/>${PIECES.sway(34, 30)}`,
  pay: (n) => `<path d="M6 38h16" stroke-width="1.5"/>${PIECES.standing(14, 32)}${place(n, 66, 20)}${piece(n, 66, 20)}${arrow(14, 32, 66, 20)}`,
  gain: (n) => `${tray(14, 36)}${piece(n, 14, 32)}${n === 'standing' || n === 'sway' ? `<path d="M58 38h16" stroke-width="1.5"/>${piece(n, 66, 32)}` : `${place(n, 66, 20)}${piece(n, 66, 20)}`}${arrow(14, 32, 66, n === 'standing' || n === 'sway' ? 32 : 20)}`,
  burn: (n) => `${place(n, 14, 20)}${piece(n, 14, 20)}${tray(66, 36)}${piece(n, 66, 32)}${arrow(14, 20, 66, 32)}`,
  take: () => `<rect x="5" y="10" width="16" height="24" rx="2" stroke-width="1.5" stroke-dasharray="2 2"/><rect x="59" y="10" width="16" height="24" rx="2" stroke-width="1.5"/>${arrow(13, 22, 67, 22)}`,
  bend: (n) => `${place(n, 24, 22)}<circle cx="21.5" cy="22" r="2.5" fill="currentColor" stroke="none"/><circle cx="27" cy="22" r="2.5" stroke-width="1.5"/><path d="M60 7l10 15-10 15-10-15z" stroke-width="1.5"/><path d="M60 15v8M60 28v.5"/>`,
};

/** A verb's diagram on its own (the legend), with tokens as the piece. @param {keyof typeof VERBS} verb */
export const verbDiagram = (verb) => dia((DIAGRAMS[verb] ?? (() => ''))('token'));

/**
 * A composed icon (D34): the verb's diagram with the noun as its piece, and an optional amount (1, X, ½, all).
 * @param {keyof typeof VERBS} verb @param {keyof typeof NOUNS} noun @param {string} [amount]
 */
export function iconHtml(verb, noun, amount = '') {
  const v = VERBS[verb], n = NOUNS[noun];
  const body = DIAGRAMS[verb] ? dia(DIAGRAMS[verb](noun)) : `${v.svg}${n.svg}`;
  return `<span class="ik ik-b" title="${v.label}: ${n.label}"><span class="ik-n">${body}</span>${amount ? `<span class="ik-amt">${amount}</span>` : ''}</span>`;
}

/** A noun on its own (a target, or where an action happens). @param {keyof typeof NOUNS} noun @param {string} [amount] */
export const nounHtml = (noun, amount = '') => `<span class="ik ik-solo" title="${NOUNS[noun].label}"><span class="ik-n">${NOUNS[noun].svg}</span>${amount ? `<span class="ik-amt">${amount}</span>` : ''}</span>`;
