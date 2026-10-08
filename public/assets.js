// @ts-check
/**
 * Assets page: every piece of content in spec.json with its art, grouped once
 * each (player cards, the board, locations, factions, cubes, symbols), plus
 * the palette. Read-only; holds no rules.
 * Sprites are plain static files under /assets/, built by assets/sprites.py.
 */
import { spec } from './engine.js';
import art from './assets/sprites.json' with { type: 'json' };
import { tokenHtml, cubeHtml, hexHtml, SEAT_COLOURS } from './pieces.js';
import { LAYOUT_SUGGESTIONS } from './layout-suggestions.js';
import { cardHtml } from './cards.js';


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

/** @param {string} title @param {string} body */
const card = (title, body) => `<div class="asset"><div class="row-between small"><b>${title}</b></div><div class="asset-scales">${body}</div></div>`;
/** @param {string} html @param {string} caption */
const fig = (html, caption) => `<figure class="asset-scale">${html || '<span class="small muted">Not drawn yet</span>'}<figcaption class="mono small muted">${caption}</figcaption></figure>`;
/** @param {string} title @param {string} note @param {string} body */
const panel = (title, note, body) => `<section class="panel"><div class="row-between"><h2>${title}</h2><span class="small muted">${note}</span></div>${body}</section>`;
/** @param {{ width: number, height: number, src: string } | undefined} sprite @param {number} scale */
const img = (sprite, scale) => (sprite ? `<img class="sprite" src="${esc(sprite.src)}" width="${sprite.width * scale}" height="${sprite.height * scale}" alt="">` : '');

function render() {
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
        <div><b>${esc(group.name)}</b><div class="small muted">${esc(symbols.get(group.archetype) ?? '')} ${esc(group.trope)}</div></div>
      </div>
    </div>`);

  const smallStack = (/** @type {string} */ id, /** @type {number} */ n) => `<span class="token-stack">${Array.from({ length: n }, () => tokenHtml(id, 1)).join('')}</span>`;
  const samplePieces = `<div class="stack-row">${smallStack('possessed', 4)}${smallStack('aliens', 2)}</div><div class="cube-row">${Array.from({ length: 3 }, () => cubeHtml(SEAT_COLOURS[0], 9)).join('')}${cubeHtml(SEAT_COLOURS[2], 9)}</div>`;
  const locationCards = spec.locations.map((loc) => card(`${esc(symbols.get(loc.archetype) ?? '')} ${esc(loc.name)}`,
    fig(hexHtml(loc.id, 1), '1×') + fig(hexHtml(loc.id, 2), '2×') + fig(hexHtml(loc.id, 2, '', 'candidate'), '2× candidate')));
  const factionCards = spec.factions.map((f) => card(`${esc(symbols.get(f.archetype) ?? '')} ${esc(f.name)}`,
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
      <div class="inline">${spec.archetypes.map((arch) => fig(img(schemes[arch.id], 2), `${esc(arch.symbol)} ${esc(arch.name)}`)).join('')}</div>`),
    panel('Factions', 'icon 16×16; CSS token', `
      <p class="small muted">Each faction's icon, and its presence token: a cardboard token cut to the icon's outline (outline from <span class="mono">assets/sprites.py</span>; card, edge and shadow in CSS). A candidate token's edge turns gold and its face glows gold, pulsing gently; hovered, it brightens and lifts.</p>
      <div class="asset-grid">${factionCards.join('')}</div>`),
    panel('Influence cubes', 'seat colours: red, gold, cyan, lime, pink', `<p class="small muted">A cube seen from above, shaded from one seat colour.</p><div class="asset-grid">${cubeCards.join('')}</div>`),
    panel('Archetype symbols', '9×9', `<div class="asset-grid">${spec.archetypes.map((a) => card(`${esc(a.symbol)} ${esc(a.name)}`, [1, 3, 6].map((s) => fig(img(symbols9[a.id], s), `${s}×`)).join(''))).join('')}</div>`),
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
 * dealt), and cards held out, in one grid sorted by suit, then type, then
 * action. Tags on each card place it on the balance review's measures
 * (Current focus 4), from public/card-scores.json, written by
 * `npm run cards:score`. The tag bands are a reading aid, not rules.
 * The played-out round measure (designer, 2026-10-07) comes from
 * public/card-round-scores.json (every turn) and card-opening-scores.json
 * (each round's first play), written by scripts/roundplay.js out=...; a run
 * rewrites them after every state, so a reload shows results as they come in.
 */
/** Scores are off the page until they can be trusted (designer, 2026-10-07); set true to show them again. */
const SHOW_SCORES = false;

async function cards() {
  /** @type {{ measured: string, states: number, players: number, bots: string, options: Record<string, string>, scores: Record<string, Record<string, number>> } | null} */
  let data = null;
  try { data = await (await fetch('/card-scores.json')).json(); } catch { /* not measured yet */ }
  /** @typedef {{ measured: string, partial: string | false, states: number, bots: string, playouts: number, scores: Record<string, { benefit: number, playable: number }> } | null} RoundData */
  const load = async (/** @type {string} */ url) => { try { const r = await fetch(url, { cache: 'no-store' }); return r.ok ? /** @type {RoundData} */ (await r.json()) : null; } catch { return null; } };
  const [round, opening] = await Promise.all([load('/card-round-scores.json'), load('/card-opening-scores.json')]);
  // Benefit bands by rank within each run: top third high, middle third mid.
  const rankBand = (/** @type {RoundData} */ d) => {
    const ids = d ? Object.keys(d.scores).sort((a, b) => d.scores[b].benefit - d.scores[a].benefit) : [];
    return (/** @type {string} */ id) => { const i = ids.indexOf(id); return i < 0 ? 'low' : i < ids.length / 3 ? 'high' : i < (2 * ids.length) / 3 ? 'mid' : 'low'; };
  };
  const roundBand = rankBand(round), openingBand = rankBand(opening);
  // Whole-game play figures from bot tournaments (designer, 2026-10-08): scripts/tournament.js out=public/card-play-stats.json, rewritten after every game.
  /** @type {{ games: number, updated: string, profiles: string[], cards: Record<string, { held: number, playedPct: number | null, actionPct: number | null, dWinAction: number | null, dWinInfluence: number | null, winAfterAction: number | null, opener: number }> } | null} */
  const plays = /** @type {any} */ (await load('/card-play-stats.json'));
  const playTags = (/** @type {string} */ id) => {
    const c = plays?.cards[id];
    if (!c) return plays ? '<span class="review-tag">Not dealt yet</span>' : '';
    const sign = (/** @type {number | null} */ x) => (x === null ? '–' : `${x > 0 ? '+' : ''}${x}`);
    const tag = (/** @type {string} */ label, /** @type {string} */ v, /** @type {string} */ title) => `<span class="review-tag" title="${esc(title)}">${esc(label)} <b>${esc(v)}</b></span>`;
    return tag('Held', String(c.held), 'Times in a hand at the start of play, over the tournament games')
      + tag('Played', c.playedPct === null ? '–' : `${c.playedPct}%`, 'Share of the times it was held that it was played')
      + tag('Action', c.actionPct === null ? '–' : `${c.actionPct}%`, 'Share of its plays that were for its action (the rest spent for influence)')
      + tag('Δ win', sign(c.dWinAction), 'Mean swing in its player\'s chance of winning when played for its action, in percentage points')
      + (c.dWinInfluence === null ? '' : tag('Δ win (infl.)', sign(c.dWinInfluence), 'Mean swing in win chance when spent for influence, in percentage points'))
      + tag('Won after', c.winAfterAction === null ? '–' : `${c.winAfterAction}%`, 'How often the player who played it for its action went on to win (an even share is 100% ÷ players)')
      + (c.opener ? tag('Opened', String(c.opener), 'Times it was played as the round\'s first play') : '');
  };
  const benefitTag = (/** @type {RoundData} */ d, /** @type {(id: string) => string} */ band, /** @type {string} */ label, /** @type {string} */ id) => {
    const v = d?.scores[id];
    if (!v) return '';
    return `<span class="review-tag is-${band(id)}" title="${esc(label)}: benefit to the player over a played-out round, ${v.benefit} (${v.playable}% playable${d?.partial ? `; partial, ${d.partial}` : ''})">${esc(label)} <b>${v.benefit > 0 ? '+' : ''}${v.benefit}</b>${d?.partial ? '…' : ''}</span>`;
  };
  /** @typedef {{ id: string, suit: string | null, action: string | null, name: string, round?: number, marked?: string }} AnyCard */
  const deck = /** @type {AnyCard[]} */ (/** @type {unknown} */ (spec.cards));
  const tests = /** @type {AnyCard[]} */ (/** @type {unknown} */ (spec.testCards.cards));
  const all = [...deck.map((c) => ({ c, status: c.marked ? 'Scaffold' : 'Deck' })), ...tests.map((c) => ({ c, status: c.round ? `Test · round ${c.round}` : 'Held out' }))];
  /** Types, from H.9's action types. */
  const TYPES = ['Presence', 'Fight modifier', 'Influence', 'Response only'];
  const typeOf = (/** @type {string | null} */ action) => (!action ? 'Response only' : action === 'token' ? 'Fight modifier' : ['move-influence', 'cash-in'].includes(action) ? 'Influence' : 'Presence');
  const suits = [...spec.archetypes.map((a) => a.id), null];
  all.sort((x, y) => suits.indexOf(x.c.suit) - suits.indexOf(y.c.suit) || TYPES.indexOf(typeOf(x.c.action)) - TYPES.indexOf(typeOf(y.c.action))
    || (x.c.action ?? '').localeCompare(y.c.action ?? '') || x.c.name.localeCompare(y.c.name));
  // Bands: [measure, label, mid from, high from].
  const BANDS = /** @type {const} */ ([['battle', 'Battle', 5, 10], ['control', 'Control', 0.5, 1], ['moved', 'Moved', 3, 7], ['placed', 'Influence', 1, 2], ['playable', 'Playable', 50, 80]]);
  const tags = (/** @type {AnyCard} */ c, /** @type {string} */ status) => {
    const sc = data?.scores[c.id];
    const measured = !SHOW_SCORES || !c.action ? '' : !sc ? '<span class="review-tag">Not measured</span>' : BANDS.map(([m, label, mid, high]) => {
      const v = sc[m] ?? 0;
      const band = v >= high ? 'high' : v >= mid ? 'mid' : 'low';
      return `<span class="review-tag is-${band}" title="${esc(label)}: ${v}${m === 'playable' ? '% of states' : ''} (${band})">${esc(label)} <b>${v}${m === 'playable' ? '%' : ''}</b></span>`;
    }).join('') + (SHOW_SCORES ? benefitTag(round, roundBand, 'Round', c.id) + benefitTag(opening, openingBand, 'Opener', c.id) : '');
    return `<div class="review-tags">${playTags(c.id)}<span class="review-tag is-status">${esc(status)}</span><span class="review-tag is-status">${esc(typeOf(c.action))} · <span class="mono">${esc(c.action ?? 'none')}</span></span>${measured}</div>`;
  };
  const how = data
    ? `Measured ${esc(data.measured)}: ${data.states} states from ${esc(data.bots)} bot games at ${data.players} players${Object.keys(data.options).length ? `, ${esc(JSON.stringify(data.options))}` : ''}; each number is the mean of the card's best play per state (<span class="mono">npm run cards:score</span>).`
    : 'Not measured yet: run <span class="mono">npm run cards:score</span>.';
  const roundHow = (/** @type {RoundData} */ d, /** @type {string} */ what) => (d ? ` <b>${what}</b>: ${d.partial ? `in progress, ${esc(d.partial)}` : `${d.states} states`}, ${esc(d.bots)} bots, ${d.playouts} playouts (${esc(d.measured)}).` : '');
  $('cards').innerHTML = `<div class="row-between"><h2>Cards</h2><span class="small muted">${all.length} cards: ${deck.length} in the deck, ${tests.length} out of the deal</span></div>
    <p class="small muted">Every card the engine can play, for review, sorted by suit, then type, then action. ${SHOW_SCORES ? `Tags: green high, gold mid, grey low. <b>Battle</b> trophies changing hands plus fights flipped (mid ${BANDS[0][2]}, high ${BANDS[0][3]}); <b>Control</b> contested locations where you become sole top influence (${BANDS[1][2]} / ${BANDS[1][3]}); <b>Moved</b> pieces moved or placed (${BANDS[2][2]} / ${BANDS[2][3]}); <b>Influence</b> influence placed (${BANDS[3][2]} / ${BANDS[3][3]}); <b>Playable</b> states with a legal target (${BANDS[4][2]}% / ${BANDS[4][3]}%). Rule-breaking is judged from the text; hidden tokens are undercounted (one round ahead). ${how} <b>Round</b> and <b>Opener</b>: benefit to the player over a played-out round (every turn, and each round's first play), banded by rank; … marks a run still in progress.${roundHow(round, 'Round')}${roundHow(opening, 'Opener')}` : 'Strength scores are hidden until they can be trusted.'}${plays ? ` <b>Play figures</b> from ${plays.games} bot tournament games (${esc(plays.profiles.join(', '))}; updated ${esc(plays.updated.slice(0, 16).replace('T', ' '))}): what the bots chose and how it went; correlation, not cause.` : ''}</p>
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
    $('target-controls').innerHTML = spec.archetypes.map((arch) => `<button class="btn${marked.has(arch.id) ? ' btn-primary' : ''}" data-suit="${esc(arch.id)}" aria-pressed="${marked.has(arch.id)}">${esc(arch.symbol)} ${esc(arch.name)}</button>`).join('')
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
