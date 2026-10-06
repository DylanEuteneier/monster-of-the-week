// @ts-check
/**
 * Assets page: every piece of content in spec.json with its sprite (where one
 * is drawn) at 1×, 3× and 6×, plus the palette. Read-only; holds no rules.
 * Sprites are plain static files under /assets/, built by assets/sprites.py.
 */
import { spec } from './engine.js';
import art from './assets/sprites.json' with { type: 'json' };
import { tokenHtml, cubeHtml, hexHtml, SEAT_COLOURS } from './pieces.js';
import { LAYOUT_SUGGESTIONS } from './layout-suggestions.js';

const SCALES = [1, 3, 6];

/** @typedef {{ id: string, name: string, archetype?: string }} Entry */

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
const symbols = new Map(spec.archetypes.map((archetype) => [archetype.id, archetype.symbol]));

const symbols9 = /** @type {SpriteMap} */ (art.symbols ?? {});

const hexMap = /** @type {SpriteMap} */ (art.hexes ?? {});

/** @type {{ title: string, size: string, entries: Entry[], from: SpriteMap, scales?: number[] }[]} */
const GROUPS = [
  { title: 'Archetype symbols', size: '9×9', entries: spec.archetypes, from: symbols9 },
  { title: 'Faction icons', size: '16×16', entries: spec.factions, from: sprites },
  { title: 'Board hexes', size: '54×62', entries: spec.locations, from: hexMap, scales: [1, 2] },
  { title: 'Slayer group emblems', size: '16×16', entries: spec.slayerGroups, from: sprites },
];

/** @param {Entry} entry @param {SpriteMap} [from] @param {number[]} [scales] */
function renderEntry(entry, from = sprites, scales = SCALES) {
  const sprite = from[entry.id];
  const symbol = entry.archetype ? symbols.get(entry.archetype) : symbols.get(entry.id);
  const label = `<div class="row-between small"><b>${esc(symbol ?? '')} ${esc(entry.name)}</b><span class="mono muted">${esc(entry.id)}</span></div>`;
  if (!sprite) return `<div class="asset asset-missing">${label}<span class="small muted">Not drawn yet</span></div>`;
  const figures = scales.map((scale) => `
    <figure class="asset-scale">
      <img class="sprite" src="${esc(sprite.src)}" width="${sprite.width * scale}" height="${sprite.height * scale}" alt="${esc(entry.name)} at ${scale}×">
      <figcaption class="mono small muted">${scale}×</figcaption>
    </figure>`);
  return `<div class="asset">${label}<div class="asset-scales">${figures.join('')}</div><a class="mono small" href="${esc(sprite.src)}">${esc(sprite.src)}</a></div>`;
}

function render() {
  const all = GROUPS.flatMap((group) => group.entries);
  const drawn = GROUPS.reduce((n, group) => n + group.entries.filter((entry) => group.from[entry.id]).length, 0);
  $('coverage').textContent = `${drawn} of ${all.length} drawn`;
  $('groups').innerHTML = GROUPS.map((group) => {
    const count = group.entries.filter((entry) => group.from[entry.id]).length;
    return `<section class="panel">
      <div class="row-between"><h2>${esc(group.title)} · ${esc(group.size)}</h2><span class="small muted">${count} of ${group.entries.length}</span></div>
      <div class="asset-grid">${group.entries.map((entry) => renderEntry(entry, group.from, group.scales)).join('')}</div>
    </section>`;
  }).join('');
  /** @param {string} title @param {string} body */
  const card = (title, body) => `<div class="asset"><div class="row-between small"><b>${title}</b></div><div class="asset-scales">${body}</div></div>`;
  /** @param {string} html @param {string} caption */
  const fig = (html, caption) => `<figure class="asset-scale">${html || '<span class="small muted">Not drawn yet</span>'}<figcaption class="mono small muted">${caption}</figcaption></figure>`;
  const tokenCards = spec.factions.map((entry) => card(`${esc(symbols.get(entry.archetype) ?? '')} ${esc(entry.name)}`,
    [1, 2, 3, 4].map((scale) => fig(tokenHtml(entry.id, scale), `${scale}×`)).join('')));
  const cubeCards = SEAT_COLOURS.map((colour, i) => card(`Seat ${i + 1} <span class="mono muted">${esc(colour)}</span>`,
    [12, 16, 22].map((size) => fig(cubeHtml(colour, size), `${size}px`)).join('')));
  /** @typedef {{ width: number, height: number, src: string }} HexArt */
  const hexes = /** @type {Record<string, HexArt>} */ (art.hexes ?? {});
  /** @type {[import('./pieces.js').TargetState, string][]} */
  const STATES = [['', 'normal'], ['candidate', 'candidate'], ['hovered', 'hovered']];
  const smallStack = (/** @type {string} */ id, /** @type {number} */ n) => `<span class="token-stack">${Array.from({ length: n }, () => tokenHtml(id, 1)).join('')}</span>`;
  const hexPieces = `<div class="stack-row">${smallStack('possessed', 4)}${smallStack('aliens', 2)}</div><div class="cube-row">${Array.from({ length: 3 }, () => cubeHtml(SEAT_COLOURS[0], 9)).join('')}${cubeHtml(SEAT_COLOURS[2], 9)}</div>`;
  /** One suggested board: hex tiles at their axial positions. Each region is
   * nudged outward from the board's centre, so tiles within a region stay
   * flush and a gutter opens between regions. */
  const SCALE = 2;
  const STEP_X = 53 * SCALE;
  const STEP_Y = 46 * SCALE;
  const GUTTER = 7;
  /** @param {{ q: number, r: number, loc: string, region: string }[]} cells */
  const boardHtml = (cells) => {
    const base = cells.map((c) => ({ ...c, x: STEP_X * (c.q + c.r / 2), y: STEP_Y * c.r }));
    const mid = { x: base.reduce((s, c) => s + c.x, 0) / base.length, y: base.reduce((s, c) => s + c.y, 0) / base.length };
    /** @type {Map<string, { x: number, y: number }>} */
    const shift = new Map();
    for (const region of new Set(base.map((c) => c.region))) {
      const own = base.filter((c) => c.region === region);
      const rx = own.reduce((s, c) => s + c.x, 0) / own.length - mid.x, ry = own.reduce((s, c) => s + c.y, 0) / own.length - mid.y;
      const len = Math.hypot(rx, ry) || 1;
      shift.set(region, { x: (rx / len) * GUTTER, y: (ry / len) * GUTTER });
    }
    const px = base.map((c) => { const s = shift.get(c.region) ?? { x: 0, y: 0 }; return { ...c, x: c.x + s.x, y: c.y + s.y }; });
    const minX = Math.min(...px.map((c) => c.x)), minY = Math.min(...px.map((c) => c.y));
    const hexW = 54 * SCALE, hexH = 62 * SCALE;
    const W = Math.ceil(Math.max(...px.map((c) => c.x)) - minX + hexW), H = Math.ceil(Math.max(...px.map((c) => c.y)) - minY + hexH);
    const tiles = px.map((c) => {
      const hex = hexes[c.loc];
      return hex ? `<img class="sprite" src="${esc(hex.src)}" width="${hexW}" height="${hexH}" alt="${esc(c.loc)}" title="${esc(c.region)}" style="position:absolute;left:${Math.round(c.x - minX)}px;top:${Math.round(c.y - minY)}px">` : '';
    });
    return `<div class="board" style="width:${W}px;height:${H}px">${tiles.join('')}</div>`;
  };
  const layoutNotes = {
    D: 'A ring of five regions round a central lake. Every region touches exactly two others.',
  };
  /** @typedef {{ width: number, height: number, src: string, tiles: { loc: string, region: string, x: number, y: number }[] }} BoardArt */
  const boardArt = /** @type {BoardArt | undefined} */ (art.board);
  /** The prototype board: the island backdrop with every hex at its exported position. */
  const islandHtml = () => {
    if (!boardArt) return '';
    const s = SCALE;
    const tiles = boardArt.tiles.map((t) => {
      const hex = hexes[t.loc];
      return hex ? `<img class="sprite" src="${esc(hex.src)}" width="${hex.width * s}" height="${hex.height * s}" alt="${esc(t.loc)}" title="${esc(t.region)}" style="position:absolute;left:${t.x * s}px;top:${t.y * s}px">` : '';
    });
    return `<div class="board" style="width:${boardArt.width * s}px;height:${boardArt.height * s}px">
      <img class="sprite" src="${esc(boardArt.src)}" width="${boardArt.width * s}" height="${boardArt.height * s}" alt="The island" style="position:absolute;left:0;top:0">
      ${tiles.join('')}
    </div>`;
  };
  const layoutBlocks = Object.entries(LAYOUT_SUGGESTIONS).sort(([a], [b]) => a.localeCompare(b)).map(([name, lay]) => `
    <div class="stack">
      <h3>Layout ${esc(name)}</h3>
      <p class="small muted">${esc(layoutNotes[/** @type {'D'} */ (name)] ?? '')} Neighbours: ${Object.entries(lay.neighbours).map(([region, n]) => `${esc(region)} ${n}`).join(' · ')}.</p>
      ${boardArt ? islandHtml() : boardHtml(lay.hexes)}
    </div>`);
  const headers = /** @type {SpriteMap} */ (art.headers ?? {});
  const playerCards = spec.slayerGroups.map((group) => {
    const header = headers[group.id], emblem = sprites[group.id];
    return `<div class="player-card">
      ${header ? `<img class="sprite" src="${esc(header.src)}" width="${header.width * 2}" height="${header.height * 2}" alt="">` : ''}
      <div class="player-card-body">
        ${emblem ? `<img class="sprite" src="${esc(emblem.src)}" width="${emblem.width * 2}" height="${emblem.height * 2}" alt="">` : ''}
        <div><b>${esc(group.name)}</b><div class="small muted">${esc(symbols.get(group.archetype) ?? '')} ${esc(group.trope)}</div></div>
      </div>
    </div>`;
  });
  $('pieces').innerHTML = `
    <section class="panel">
      <div class="row-between"><h2>Player cards</h2><span class="small muted">header 80×32 and emblem 16×16, shown at 2×</span></div>
      <p class="small muted">Each slayer group's card: a header scene and its emblem.</p>
      <div class="player-cards">${playerCards.join('')}</div>
    </section>
    <section class="panel">
      <div class="row-between"><h2>Board layout</h2><span class="small muted">layout D, chosen for prototyping</span></div>
      <p class="small muted">Five regions of three (CN3), each mixing three archetypes so every archetype's locations are spread across the island (AL1). Mountains: Ski Resort, Weather Station, Mine. Coast: Lighthouse, Shipping Docks, Fallout Bunker. Woods: State Park, Sawmill, The Lake House. Old Town: Beach City, Graveyard, Occult Camp. Badlands: Military Facility, Junkyard, Caves. The island is drawn round the tiles: land takes the ground of its nearest tile, forest grows round the Woods, peaks rise in the north, and the gap in the ring is a lake. Hover a tile to see its region.</p>
      ${layoutBlocks.join('')}
    </section>
    <section class="panel">
      <div class="row-between"><h2>Board hexes</h2><span class="small muted">drawn at 1×, shown at 2×</span></div>
      <p class="small muted">One hex per location. The building sits at the top, the archetype symbol at the bottom, and the space between is kept clear for presence tokens and influence cubes. The first hex shows sample pieces.</p>
      <div class="hex-grid">${hexHtml('lighthouse', 2, hexPieces)}${spec.locations.map((loc) => `<figure class="asset-scale">${hexHtml(loc.id, 2, '')}<figcaption class="small muted">${esc(symbols.get(loc.archetype) ?? '')} ${esc(loc.name)}</figcaption></figure>`).join('')}</div>
      <h3>Archetype schemes</h3>
      <p class="small muted">Each hex's border takes its archetype's colours, and the archetype's symbol sits bottom middle, over the border.</p>
      <div class="inline">${spec.archetypes.map((arch) => {
        const sch = /** @type {Record<string, { width: number, height: number, src: string }>} */ (art.hexSchemes ?? {})[arch.id];
        return sch ? `<figure class="asset-scale"><img class="sprite" src="${esc(sch.src)}" width="${sch.width * 2}" height="${sch.height * 2}" alt="${esc(arch.name)}"><figcaption class="small muted">${esc(arch.symbol)} ${esc(arch.name)}</figcaption></figure>` : '';
      }).join('')}</div>
    </section>
    <section class="panel">
      <div class="row-between"><h2>Presence tokens</h2><span class="small muted">CSS card, pixel-art face</span></div>
      <p class="small muted">A cardboard token cut to the art's outline. The outline comes from <span class="mono">assets/sprites.py</span>; the card, edge and shadow are CSS.</p>
      <div class="asset-grid">${tokenCards.join('')}</div>
    </section>
    <section class="panel">
      <div class="row-between"><h2>Target states</h2><span class="small muted">normal · candidate · hovered</span></div>
      <p class="small muted">How a location or a token shows when a card can target it. A candidate gets a gold ring; the candidate under the pointer gets a white-and-gold ring and lifts. Hex states are pixel art from <span class="mono">assets/sprites.py</span>; token states are CSS.</p>
      <h3>Try it</h3>
      <p class="small muted">These are live candidates: hover them.</p>
      <div class="hex-grid">${['graveyard', 'lighthouse', 'mine'].map((id) => hexHtml(id, 2, '', 'candidate')).join('')}
        <div class="stack-row">${['zombies', 'aliens', 'vampires'].map((id) => tokenHtml(id, 3, 'candidate')).join('')}</div></div>
      <h3>Locations</h3>
      <div class="asset-grid">${spec.locations.map((loc) => card(`${esc(symbols.get(loc.archetype) ?? '')} ${esc(loc.name)}`,
        STATES.map(([state, label]) => fig(hexHtml(loc.id, 2, '', state), label)).join(''))).join('')}</div>
      <h3>Presence tokens</h3>
      <div class="asset-grid">${spec.factions.map((entry) => card(`${esc(symbols.get(entry.archetype) ?? '')} ${esc(entry.name)}`,
        STATES.map(([state, label]) => fig(tokenHtml(entry.id, 2, state), label)).join(''))).join('')}</div>
    </section>
    <section class="panel">
      <div class="row-between"><h2>Influence cubes</h2><span class="small muted">seat colours: red, gold, cyan, lime, pink</span></div>
      <p class="small muted">A cube seen from above, shaded from one seat colour.</p>
      <div class="asset-grid">${cubeCards.join('')}</div>
    </section>`;
  $('palette').innerHTML = Object.entries(art.palette)
    .filter(([, colour]) => colour)
    .map(([key, colour]) => `<div class="swatch-row"><i style="background:${esc(colour)}"></i><span class="mono small">${esc(key)} ${esc(colour)}</span></div>`)
    .join('');
}

render();
