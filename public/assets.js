// @ts-check
/**
 * Assets page: every piece of content in spec.json with its art, grouped once
 * each (player cards, the board, locations, factions, cubes, symbols), plus
 * the palette. Read-only; holds no rules.
 * Sprites are plain static files under /assets/, built by assets/sprites.py.
 */
import { spec } from './rules.js';
import art from './assets/sprites.json' with { type: 'json' };
import { tokenHtml, cubeHtml, hexHtml, SEAT_COLOURS } from './pieces.js';
import { LAYOUT_SUGGESTIONS } from './layout-suggestions.js';
import { cardHtml } from './cards.js';
import { NOUNS, VERBS, verbDiagram } from './icons.js';


/** @param {unknown} value */
const esc = (value) => String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);

/** @param {string} id */
function $(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing #${id}`);
  return element;
}

/** @typedef {Record<string, { width: number, height: number, src: string }>} SpriteMap */
const sprites = /** @type {SpriteMap} */ (art.sprites);

const symbols9 = /** @type {SpriteMap} */ (art.symbols ?? {});

/** @param {string} title @param {string} body */
const card = (title, body) => `<div class="asset"><div class="row-between small"><b>${title}</b></div><div class="asset-scales">${body}</div></div>`;
/** @param {string} html @param {string} caption */
const fig = (html, caption) => `<figure class="asset-scale">${html || '<span class="small muted">Not drawn yet</span>'}<figcaption class="mono small muted">${caption}</figcaption></figure>`;
/** @param {string} title @param {string} note @param {string} body */
const panel = (title, note, body) => `<section class="panel"><div class="row-between"><h2>${title}</h2><span class="small muted">${note}</span></div>${body}</section>`;
/** @param {{ width: number, height: number, src: string } | undefined} sprite @param {number} scale */
const img = (sprite, scale) => (sprite ? `<img class="sprite" src="${esc(sprite.src)}" width="${sprite.width * scale}" height="${sprite.height * scale}" alt="">` : '');

/** The action icons, a first draft (IK1, D34): every mark, then cards written in blocks. */
function renderIcons() {
  const marks = (/** @type {Record<string, { label: string, svg: string }>} */ set, /** @type {string} */ cls) => Object.values(set).map((m) => `<figure class="ik-mark"><span class="ik ik-solo"><span class="${cls}">${m.svg}</span></span><figcaption class="small">${esc(m.label)}</figcaption></figure>`).join('');
  // Direction B: each verb as its mini board diagram (tokens as the piece), and one verb with each noun.
  const diagrams = Object.entries(VERBS).map(([id, m]) => `<figure class="ik-mark ik-mark-b"><span class="ik ik-b"><span class="ik-n">${verbDiagram(/** @type {any} */ (id))}</span></span><figcaption class="small">${esc(m.label)}</figcaption></figure>`).join('');
  $('icons').innerHTML = `<div class="row-between"><h2>Action icons (draft)</h2><span class="small muted">IK1, D34: a verb block plus a noun block</span></div>
    <p class="small muted">Direction B (designer): each verb is a mini board diagram, and the noun is the piece moving through it. One set of parts throughout (D35): a token is a circle, sway a cube, a location a hex; standing is a cube over a line, being off the board; every mark has the same stroke. Before and after: what was is dotted and faint. Clean vector, not pixel art. The cards use them in their toplines and rows (D37).</p>
    <h3 class="small">Verbs as diagrams (direction B)</h3><div class="ik-marks ik-marks-b">${diagrams}</div>
    <h3 class="small">Nouns</h3><div class="ik-marks">${marks(NOUNS, 'ik-n')}</div>`;
}


/** The row tags' marks (designer, 2026-10-30, D35): LOC, FAC, and the uses' nouns. */

function render() {
  renderIcons();
  const headers = /** @type {SpriteMap} */ (art.headers ?? {});
  const hexes = /** @type {SpriteMap} */ (art.hexes ?? {});
  const schemes = /** @type {SpriteMap} */ (art.hexSchemes ?? {});
  const drawn = [
    ...spec.archetypes.map((a) => symbols9[a.id]), ...spec.factions.map((f) => sprites[f.id]),
    ...spec.locations.map((l) => hexes[l.id]), ...spec.slayerGroups.map((g) => sprites[g.id]),
  ];
  $('coverage').textContent = `${drawn.filter(Boolean).length} of ${drawn.length} drawn`;

  const playerCards = spec.slayerGroups.map((group) => `<div class="player-card">
      ${img(headers[group.id], 2)}
      <div class="player-card-body">${img(sprites[group.id], 2)}
        <div><b>${esc(group.name)}</b><div class="small muted">${esc(group.trope)}</div></div>
      </div>
    </div>`);

  const smallStack = (/** @type {string} */ id, /** @type {number} */ n) => `<span class="token-stack">${Array.from({ length: n }, () => tokenHtml(id, 1)).join('')}</span>`;
  const samplePieces = `<div class="stack-row">${smallStack('possessed', 4)}${smallStack('aliens', 2)}</div><div class="cube-row">${Array.from({ length: 3 }, () => cubeHtml(SEAT_COLOURS[0], 9)).join('')}${cubeHtml(SEAT_COLOURS[2], 9)}</div>`;
  const locationCards = spec.locations.map((loc) => card(`${esc(loc.name)}`,
    fig(hexHtml(loc.id, 1), '1×') + fig(hexHtml(loc.id, 2), '2×') + fig(hexHtml(loc.id, 2, '', 'candidate'), '2× candidate')));
  const factionCards = spec.factions.map((f) => card(`${esc(f.name)}`,
    fig(img(sprites[f.id], 3), 'icon 3×') + [1, 2, 4].map((scale) => fig(tokenHtml(f.id, scale), `${scale}×`)).join('')
    + fig(tokenHtml(f.id, 2, 'candidate'), '2× candidate')));
  const cubeCards = SEAT_COLOURS.map((colour, i) => card(`Seat ${i + 1} <span class="mono muted">${esc(colour)}</span>`,
    [12, 16, 22].map((size) => fig(cubeHtml(colour, size), `${size}px`)).join('')));
  const neighbours = Object.values(LAYOUT_SUGGESTIONS)[0]?.neighbours ?? {};

  $('pieces').innerHTML = [
    panel('Player cards', 'header and emblem, shown at 2×', `<p class="small muted">Each slayer group's card: a header scene and its emblem.</p><div class="player-cards">${playerCards.join('')}</div>`),
    panel('The board', 'layout D, chosen for prototyping', `
      <p class="small muted">Five regions of three (CN3), each mixing three archetypes so every archetype's locations are spread across the island (AL1). The island is drawn round the tiles: land takes the ground of its nearest tile, forest grows round the Woods, peaks rise in the north, and the gap in the ring is a lake. Neighbours: ${Object.entries(neighbours).map(([region, n]) => `${esc(region)} ${n}`).join(' · ')}. Hover a tile to see its region.</p>
      <p class="small muted">Choosing a target: mark one or more suits as candidates and their three locations are spotlit, as a card's location target allows. A hovered candidate is in full daylight; click it to choose it.</p>
      <div class="inline" id="target-controls"></div>
      <p class="small" id="target-status"></p>
      <div id="target-board"></div>`),
    panel('Locations', 'hexes drawn at 1×, shown at 1× and 2×', `
      <p class="small muted">One hex per location: the building at the top, the archetype symbol at the bottom, and the space between kept clear for tokens and cubes. Target states change only the light, never the border: a candidate is caught in a spotlight; hovered, it is in full daylight and lifts.</p>
      <div class="hex-grid"><figure class="asset-scale">${hexHtml('lighthouse', 2, samplePieces)}<figcaption class="small muted">with sample pieces</figcaption></figure></div>
      <div class="asset-grid">${locationCards.join('')}</div>
      <h3>Archetype schemes</h3>
      <p class="small muted">Each hex's border takes its archetype's colours, and the archetype's symbol sits bottom middle, over the border.</p>
      <div class="inline">${spec.archetypes.map((arch) => fig(img(schemes[arch.id], 2), `${esc(arch.name)}`)).join('')}</div>`),
    panel('Factions', 'icon 16×16; CSS token', `
      <p class="small muted">Each faction's icon, and its presence token: a cardboard token cut to the icon's outline (outline from <span class="mono">assets/sprites.py</span>; card, edge and shadow in CSS). A candidate token's edge turns gold and its face glows gold, pulsing gently; hovered, it brightens and lifts.</p>
      <div class="asset-grid">${factionCards.join('')}</div>`),
    panel('Sway cubes', 'seat colours: red, gold, cyan, lime, pink', `<p class="small muted">A cube seen from above, shaded from one seat colour.</p><div class="asset-grid">${cubeCards.join('')}</div>`),
    panel('Archetype symbols', '9×9', `<div class="asset-grid">${spec.archetypes.map((a) => card(`${esc(a.name)}`, [1, 3, 6].map((s) => fig(img(symbols9[a.id], s), `${s}×`)).join(''))).join('')}</div>`),
  ].join('');
  $('palette').innerHTML = Object.entries(art.palette)
    .filter(([, colour]) => colour)
    .map(([key, colour]) => `<div class="swatch-row"><i style="background:${esc(colour)}"></i><span class="mono small">${esc(key)} ${esc(colour)}</span></div>`)
    .join('');
}

render();

/**
 * Cards: every card the engine can play, for review, drawn as the table
 * draws them. The deck, the test cards from the revision rounds (never
 * dealt in a fixed deck), and cards held out, in one grid sorted by suit,
 * then type, then action. How the cards play is measured by the card report
 * (scripts/measure.js report=cards), not shown here.
 */
async function cards() {
  /** @typedef {{ id: string, suit: string | null, action: string | null, name: string, round?: number }} AnyCard */
  const deck = /** @type {AnyCard[]} */ (/** @type {unknown} */ (spec.cards));
  const all = deck.map((c) => ({ c, status: c.suit ? 'Suited' : 'Unsuited' }));
  const suits = [...spec.archetypes.map((a) => a.id), null];
  all.sort((x, y) => suits.indexOf(x.c.suit) - suits.indexOf(y.c.suit) || (x.c.action ?? '').localeCompare(y.c.action ?? '') || x.c.name.localeCompare(y.c.name));
  const tags = (/** @type {AnyCard} */ c, /** @type {string} */ status) => `<div class="review-tags"><span class="review-tag is-status">${esc(status)}</span><span class="review-tag is-status"><span class="mono">${esc(c.action ?? 'none')}</span></span></div>`;
  $('cards').innerHTML = `<div class="row-between"><h2>Cards</h2><span class="small muted">${all.length} cards in the deck</span></div>
    <p class="small muted">Every card in the deck, for review, sorted by suit, then action. How they play: <span class="mono">npm run measure</span> (the card report).</p>
    <div class="review-grid" id="review-grid"></div>`;
  const items = all.map(({ c, status }) => cardHtml(c.id, { extra: tags(c, status) }));
  // Masonry that reads left to right: each card, in order, goes to the shortest column.
  const grid = $('review-grid');
  let columns = 0;
  const layout = () => {
    const width = parseFloat(getComputedStyle(grid).getPropertyValue('--col')) || 214;
    const gap = parseFloat(getComputedStyle(grid).columnGap) || 12;
    const n = Math.max(1, Math.floor((grid.clientWidth + gap) / (width + gap)));
    if (n === columns) return;
    columns = n;
    grid.innerHTML = Array.from({ length: n }, () => '<div class="review-col"></div>').join('');
    const cols = /** @type {HTMLElement[]} */ ([...grid.children]);
    for (const html of items) {
      const shortest = cols.reduce((a, b) => (b.offsetHeight < a.offsetHeight ? b : a));
      shortest.insertAdjacentHTML('beforeend', html);
    }
  };
  layout();
  new ResizeObserver(layout).observe(grid);
}

cards();

/** The interactive board on /assets: candidates are spotlit, hovered ones are in daylight, and a click picks the target. */
function targeting() {
  const board = /** @type {{ width: number, height: number, src: string, tiles: { loc: string, region: string, x: number, y: number }[] } | undefined} */ (art.board);
  if (!board) return;
  const S = 2;
  const name = new Map(spec.locations.map((loc) => [loc.id, loc.name]));
  const archetypeOf = new Map(spec.locations.map((loc) => [loc.id, loc.archetype]));
  /** Suits marked as candidates: their three locations can be chosen. */
  const marked = new Set();
  const filter = (/** @type {string} */ loc) => marked.has(archetypeOf.get(loc));
  /** @type {string | null} */
  let chosen = null;
  const draw = () => {
    const tiles = board.tiles.map((t) => {
      const state = chosen === t.loc ? 'hovered' : (!chosen && filter(t.loc) ? 'candidate' : '');
      return `<div class="board-tile" data-loc="${esc(t.loc)}" title="${esc(name.get(t.loc) ?? t.loc)} · ${esc(t.region)}" style="position:absolute;left:${t.x * S}px;top:${t.y * S}px">${hexHtml(t.loc, S, '', /** @type {import('./pieces.js').TargetState} */ (state))}</div>`;
    });
    $('target-board').innerHTML = `<div class="board" style="width:${board.width * S}px;height:${board.height * S}px">
      <img class="sprite" src="${esc(board.src)}" width="${board.width * S}" height="${board.height * S}" alt="The island" style="position:absolute;left:0;top:0">${tiles.join('')}</div>`;
    const count = board.tiles.filter((t) => filter(t.loc)).length;
    $('target-status').innerHTML = chosen
      ? `Target: <b>${esc(name.get(chosen) ?? chosen)}</b> · <button class="btn" id="target-reset">Choose again</button>`
      : count ? `${count} candidate${count === 1 ? '' : 's'}: hover one, then click to choose it.` : 'Mark a suit as candidates to light up its three locations.';
    document.getElementById('target-reset')?.addEventListener('click', () => { chosen = null; draw(); });
  };
  const controls = () => {
    $('target-controls').innerHTML = spec.archetypes.map((arch) => `<button class="btn${marked.has(arch.id) ? ' btn-primary' : ''}" data-suit="${esc(arch.id)}" aria-pressed="${marked.has(arch.id)}">${esc(arch.name)}</button>`).join('')
      + '<button class="btn" data-suit="">Clear</button>';
  };
  $('target-controls').addEventListener('click', (event) => {
    const button = /** @type {HTMLElement} */ (event.target).closest('[data-suit]');
    if (!button) return;
    const suit = button.getAttribute('data-suit') ?? '';
    if (!suit) marked.clear();
    else if (marked.has(suit)) marked.delete(suit);
    else marked.add(suit);
    chosen = null;
    controls();
    draw();
  });
  $('target-board').addEventListener('click', (event) => {
    const tile = /** @type {HTMLElement} */ (event.target).closest('.board-tile');
    const loc = tile?.getAttribute('data-loc');
    if (!loc || chosen || !filter(loc)) return;
    chosen = loc;
    draw();
  });
  controls();
  draw();
}

targeting();
