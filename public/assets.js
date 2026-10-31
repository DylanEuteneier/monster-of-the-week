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
import { cardHtml, suitIcon } from './cards.js';
import { NOUNS, VERBS, iconHtml, nounHtml, verbDiagram } from './icons.js';


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

/** The action icons, a first draft (IK1, D34): every mark, then cards written in blocks. */
function renderIcons() {
  const marks = (/** @type {Record<string, { label: string, svg: string }>} */ set, /** @type {string} */ cls) => Object.values(set).map((m) => `<figure class="ik-mark"><span class="ik ik-solo"><span class="${cls}">${m.svg}</span></span><figcaption class="small">${esc(m.label)}</figcaption></figure>`).join('');
  // Direction B: each verb as its mini board diagram (tokens as the piece), and one verb with each noun.
  const diagrams = Object.entries(VERBS).map(([id, m]) => `<figure class="ik-mark ik-mark-b"><span class="ik ik-b"><span class="ik-n">${verbDiagram(/** @type {any} */ (id))}</span></span><figcaption class="small">${esc(m.label)}</figcaption></figure>`).join('');
  const nounsIn = ['token', 'sway', 'standing'].map((n) => `<figure class="ik-mark ik-mark-b">${iconHtml('gather', /** @type {any} */ (n))}<figcaption class="small">Gather + ${esc(NOUNS[n].label.toLowerCase())}</figcaption></figure>`).join('');
  /** One line of a card in blocks: the blocks, then a few words. @param {string} blocks @param {string} words */
  const line = (blocks, words) => `<div class="ik-line"><span class="ik-blocks">${blocks}</span><span class="small muted">${esc(words)}</span></div>`;
  const to = '<span class="ik-to">→</span>';
  const examples = [
    ['Raise the Stakes', 'Gather up to X into one: standing, sway or tokens.', [
      line(`${iconHtml('gather', 'standing', 'X')}`, '1 from each of up to X factions, into one'),
      line(`${iconHtml('gather', 'sway', 'X')}${to}${nounHtml('location')}`, 'up to X of yours from next door, into one location'),
      line(`${iconHtml('gather', 'token', 'X')}${to}${nounHtml('location')}`, 'up to X of one faction from next door, to where you have sway'),
    ]],
    ['Cover Every Exit', 'Spread 1 to each of up to X.', [
      line(`${iconHtml('spread', 'standing', 'X')}`, 'from one faction to up to X others'),
      line(`${iconHtml('spread', 'sway', 'X')}${to}${nounHtml('neighbour')}`, 'from one location to up to X neighbours'),
      line(`${iconHtml('spread', 'token', 'X')}${to}${nounHtml('neighbour')}`, 'a group sends 1 to each of up to X neighbours'),
    ]],
    ['Switch Allegiance', 'Move up to X from one to another.', [
      line(`${iconHtml('burn', 'standing', 'X')}${to}${iconHtml('gain', 'standing', 'X')}`, 'with one faction, gain the same with another'),
      line(`${iconHtml('move', 'sway', 'X')}`, 'from one location to any other'),
    ]],
    ['Call in Favours', 'Gain up to X from your supply.', [
      line(`${iconHtml('gain', 'sway', 'X')}${to}${nounHtml('fight')}`, '1 at each of up to X fights'),
      line(`${iconHtml('gain', 'standing', 'X')}`, 'with one faction'),
    ]],
    ['Draw Them Away', 'A group spreads to at least two neighbours.', [line(`${nounHtml('group')}${to}${iconHtml('spread', 'token', '2+')}`, '1 to each chosen neighbour; the rest stay')]],
    ['Light of the Cross', 'A group splits evenly in two.', [line(`${nounHtml('group')}${to}${iconHtml('split', 'neighbour')}`, 'between two neighbours')]],
    ['The Big Chase', 'A group is chased step by step.', [line(`${nounHtml('group')}${to}${iconHtml('trail', 'token', '1')}`, '1 stays at each step; the rest arrive at the end')]],
    ['Showdown', 'Burn sway at a lone group to slay as many.', [line(`${nounHtml('lone')}${to}${iconHtml('burn', 'sway', 'X')}${to}${iconHtml('slay', 'token', 'X')}`, 'never a fight; they are your trophies')]],
    ['Spill Blood on the Altar', 'Mark locations; their fights are bent.', [line(`${iconHtml('mark', 'location', 'N')}${to}${iconHtml('bend', 'fight')}`, 'the winner loses as many as the loser')]],
    ['Wake the Dead', 'The dead rise from the supply.', [line(`${iconHtml('raise', 'token', 'N')}${to}${nounHtml('location')}`, '1 sway each; a third side at a fight')]],
  ].map(([name, gist, lines]) => `<div class="ik-example"><b>${esc(String(name))}</b><div class="small">${esc(String(gist))}</div>${/** @type {string[]} */ (lines).join('')}</div>`).join('');
  $('icons').innerHTML = `<div class="row-between"><h2>Action icons (draft)</h2><span class="small muted">IK1, D34: a verb block plus a noun block</span></div>
    <p class="small muted">Second draft, direction B (designer): each verb is a mini board diagram (hexes, arrows), and the noun is the piece moving through it (a token dot, a sway cube; standing uses faction circles, being off the board). An amount (1, X, ½, all) sits beside it where it matters. Clean vector, not pixel art. No card uses them yet.</p>
    <h3 class="small">Verbs as diagrams (direction B)</h3><div class="ik-marks ik-marks-b">${diagrams}</div>
    <h3 class="small">One verb, three nouns</h3><div class="ik-marks ik-marks-b">${nounsIn}</div>
    <h3 class="small">Nouns</h3><div class="ik-marks">${marks(NOUNS, 'ik-n')}</div>
    <h3 class="small">Cards in blocks</h3><div class="ik-examples">${examples}</div>`;
}


/**
 * Card layout mock-ups (designer, 2026-10-30): Claude's two suggestions from the layout research, shown beside each
 * card as it is now. Suggestion 1 (suit cards): topline (icon block, verb, gist), a target field holding both
 * readings, one specific rule per line, flavour last. Suggestion 2 (choose-one extras): the topline over one row
 * per use. Drafts only: the words are the card's own (spec.json), moved or split, never a rule change.
 */
const LAYOUTS = [
  { id: 'light-cross', verb: 'split', noun: 'token', word: 'Split', gist: 'a group, evenly between two neighbours',
    target: { head: 'the group' }, specifics: ['A group of 1 can’t be split.'],
    flavour: 'The cross is raised and the target group falls back from its light.' },
  { id: 'draw-away', verb: 'spread', noun: 'token', word: 'Spread', gist: '1 token to each of at least two neighbours',
    target: { head: 'the group' }, specifics: ['The rest stay.'],
    flavour: 'The Watch sets out distractions all round the location, and one of the dead shambles off to check each.' },
  { id: 'invite-in', verb: 'gather', noun: 'token', word: 'Gather', gist: 'groups next door into one location',
    target: { head: 'where they’re invited', grid: ['Where', 'Who comes'], loc: ['an empty ◐ location', 'any two groups next to it, of different factions'], fac: ['a location held by a lone group of another faction, next to a Nocturnal group', 'only the Nocturnals'] },
    specifics: [], flavour: '', note: 'The card says “into an empty location”, but the FAC reading’s location is held by a lone group: each reading shows its own.' },
  { id: 'spill-blood', verb: 'mark', noun: 'location', word: 'Mark', gist: 'up to the card’s sway of locations, 1 sway on each',
    target: { head: 'the locations marked' }, specifics: ['This round, at a marked location’s fight, the winner loses as many as the loser.'],
    flavour: 'Father and the Flock spill blood on the altar.' },
  { id: 'gate', verb: 'join', noun: 'location', word: 'Join', gist: 'two locations, for the rest of the round',
    target: { head: 'the two ends' },
    specifics: ['They count as a single location for movement.', 'They fight as one: strength and sway added across both; a true tie scorches both.', 'Never three factions across them.', 'Only 1 sway, at one end.'], flavour: '' },
  { id: 'stakes', verb: 'gather', word: 'Gather', gist: 'up to X into one', uses: [
    ['Standing', 'standing', 'take 1 standing from each of up to X factions, all into one.'],
    ['Sway', 'sway', 'gather up to X of your sway from next door into one location.'],
    ['Tokens', 'token', 'up to X tokens of one faction come in from its groups next door, to a location where you have sway.']],
    specifics: ['X is the cards in your hand, this one included.'] },
  { id: 'exit', verb: 'spread', word: 'Spread', gist: '1 to each of up to X', uses: [
    ['Standing', 'standing', 'move 1 standing from one faction to each of up to X others.'],
    ['Sway', 'sway', 'send 1 of your sway from one location to each of up to X neighbours.'],
    ['Tokens', 'token', 'a group sends 1 token to each of up to X neighbours.']],
    specifics: ['X is the cards in your hand, this one included.'] },
];

/** One mock-up card in the suggested layout. @param {typeof LAYOUTS[number]} l */
function layoutCard(l) {
  const c = /** @type {any} */ (spec.cards.find((x) => x.id === l.id));
  const suit = spec.archetypes.find((a) => a.id === c.suit);
  const band = c.suit ? `<span class="suit-line">${suitIcon(c.suit)} ${esc(suit?.name ?? '')}</span><span>${esc(c.slot)}</span>` : `<span>Marked ${esc(c.marked ?? '')}</span><span>choose one</span>`;
  const top = `<div class="lay-top">${iconHtml(/** @type {any} */ (l.verb), /** @type {any} */ (l.noun ?? 'token'))}<div><b class="lay-verb">${esc(l.word)}</b><span class="lay-gist">${esc(l.gist)}</span></div></div>`;
  const t = /** @type {any} */ (l.target);
  const r = c.readings;
  // Each reading is a button-like row (designer, 2026-10-30: the target looks clickable, the LOC/FAC choice moving into it).
  const row = (/** @type {string} */ tag, /** @type {string[]} */ cells) => `<div class="lay-row" role="button"><b>${tag}</b>${cells.map((x) => `<span>${esc(x)}</span>`).join('')}</div>`;
  const target = !t ? '' : t.grid
    // Where the readings change the effect: each row stacks its parts, each with its own small label (no table: the parts' lengths differ).
    ? `<div class="lay-target"><div class="lay-label">Target: ${esc(t.head)}</div>${['loc', 'fac'].map((m) => `<div class="lay-row" role="button"><b>${m.toUpperCase()}</b><span class="lay-parts">${t.grid.map((/** @type {string} */ g, /** @type {number} */ i) => `<span><i>${esc(g)}</i> ${esc(t[m][i])}</span>`).join('')}</span></div>`).join('')}</div>`
    : `<div class="lay-target"><div class="lay-label">Target: ${esc(t.head)}</div>${row('LOC', [r.location])}${row('FAC', [r.faction])}</div>`;
  const uses = l.uses ? `<div class="lay-target lay-target-uses"><div class="lay-label">Choose one</div>${l.uses.map(([tag, , text]) => `<div class="lay-row" role="button"><b>${esc(tag)}</b><span>${esc(text)}</span></div>`).join('')}</div>` : '';
  const specifics = l.specifics.length ? `<ul class="lay-specifics">${l.specifics.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : '';
  // Every card carries its thematic text at the bottom (designer, 2026-10-30); a card without it shows the empty slot.
  const flavour = `<p class="lay-flavour${l.flavour ? '' : ' is-missing'}">${esc(l.flavour || 'Thematic text to come.')}</p>`;
  const corner = c.suit ? `<span class="lay-sway" title="Or spend for sway">+${c.sway}</span>` : '';
  return `<div class="card lay-card card-suit-${c.suit ?? 'none'}"><div class="card-band">${band}</div>
    <div class="lay-name"><span class="card-name">${esc(c.name)}</span>${corner}</div>${top}${target}${uses}${specifics}${flavour}</div>`;
}


/** Options for small icons beside the row tags (designer, 2026-10-30: options for each). Drawn like the noun marks. */
const tagSvg = (/** @type {string} */ body) => `<svg class="ik-svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const HEX = '<polygon points="12,2 20.7,7 20.7,17 12,22 3.3,17 3.3,7"/>';
const CUBE = (/** @type {number} */ y, /** @type {number} */ s, x = 12) => `<path d="M${x} ${y - s}l${s} ${s / 2}v${s}l-${s} ${s / 2}l-${s} -${s / 2}v-${s}z M${x - s} ${y - s / 2}l${s} ${s / 2}l${s} -${s / 2} M${x} ${y}v${s}"/>`;
const TAG_OPTIONS = [
  ['LOC', 'a group at a ☾ location.', [
    ['A', 'A hex (the location mark)', tagSvg(HEX)],
    ['B', 'A hex with a dot: this place', tagSvg(`${HEX}<circle cx="12" cy="12" r="3" fill="currentColor"/>`)],
    ['C', 'The suit glyph', 'glyph'],
  ]],
  ['FAC', 'an Undead group anywhere.', [
    ['A', 'A faction token', tagSvg('<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/>')],
    ['B', 'A group (three tokens)', tagSvg('<circle cx="8" cy="15" r="4"/><circle cx="16" cy="15" r="4"/><circle cx="12" cy="8" r="4"/>')],
    ['C', 'The suit glyph', 'glyph'],
  ]],
  ['Standing', 'take 1 standing from each of up to X factions, all into one.', [
    ['A', 'A cube on a line (off the board)', tagSvg(`${CUBE(8, 6)}<path d="M3 21h18"/>`)],
    ['B', 'A cube in a faction circle', tagSvg(`<circle cx="12" cy="12" r="10"/>${CUBE(12, 5)}`)],
    ['C', 'A cube beside a token', tagSvg(`<circle cx="17.5" cy="14" r="4.5"/>${CUBE(10, 5.5, 7)}`)],
  ]],
  ['Sway', 'gather up to X of your sway from next door into one location.', [
    ['A', 'A cube (your sway)', tagSvg(CUBE(10, 7))],
    ['B', 'A cube on a hex (sway on the board)', tagSvg(`<polygon points="12,9 20.7,14 20.7,20 12,23 3.3,20 3.3,14" stroke-width="1.5"/>${CUBE(9, 6)}`)],
    ['C', 'A filled cube', tagSvg(CUBE(10, 7).replace('<path', '<path fill="currentColor" fill-opacity="0.35"'))],
  ]],
  ['Tokens', 'a group sends 1 token to each of up to X neighbours.', [
    ['A', 'A faction token', tagSvg('<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/>')],
    ['B', 'A group (three tokens)', tagSvg('<circle cx="8" cy="15" r="4"/><circle cx="16" cy="15" r="4"/><circle cx="12" cy="8" r="4"/>')],
    ['C', 'Two tokens, stacked', tagSvg('<ellipse cx="12" cy="9" rx="8" ry="4"/><path d="M4 9v6c0 2.2 3.6 4 8 4s8-1.8 8-4V9"/><path d="M4 12c0 2.2 3.6 4 8 4s8-1.8 8-4"/>')],
  ]],
];

/** The tag-icon options, each shown in a row as it would sit on a card. */
function renderTagOptions() {
  const rows = TAG_OPTIONS.map(([tag, text, opts]) => `<div class="lay-opt-set"><h3 class="small">${esc(String(tag))}</h3><div class="lay-opt-grid">${/** @type {string[][]} */ (opts).map(([k, label, icon]) => {
    const mark = icon === 'glyph' ? suitIcon('undead', 2) : icon;
    return `<figure class="lay-opt"><div class="card card-suit-undead lay-opt-card"><div class="lay-target"><div class="lay-row lay-row-ic${tag.length > 3 ? ' lay-row-wide' : ''}" role="button"><b>${mark}<span>${esc(String(tag))}</span></b><span>${esc(String(text))}</span></div></div></div><figcaption class="small"><b>${k}:</b> ${esc(label)}</figcaption></figure>`;
  }).join('')}</div></div>`).join('');
  return `<div class="lay-opts"><h3>Tag icons (options)</h3><p class="small muted">A small mark beside each tag word, never instead of it. The verb’s diagram stays in the topline only.</p>${rows}</div>`;
}

/** The layout mock-ups, each beside the card as it is now. */
function renderLayouts() {
  const pairs = LAYOUTS.map((l) => `<div class="lay-pair"><figure class="asset-scale">${cardHtml(l.id)}<figcaption class="mono small muted">now</figcaption></figure>
    <figure class="asset-scale">${layoutCard(l)}<figcaption class="mono small muted">suggested</figcaption></figure>${l.note ? `<p class="small muted lay-note">${esc(l.note)}</p>` : ''}</div>`).join('');
  $('layouts').innerHTML = `<div class="row-between"><h2>Card layout (draft)</h2><span class="small muted">Suggestions from the layout research, not decisions</span></div>
    <p class="small muted">Suit cards (suggestion 1): a topline (the action’s icon block, its verb, a few words: the card’s only icon), a target field whose readings are the buttons, one specific rule per line, then thematic text at the bottom of every card. Choose-one cards (suggestion 2): the same topline over one button-like row per use. Every word is the card’s own, moved or split; the toplines’ verbs and gists are drafts. Same card width as now.</p>
    <div class="lay-pairs">${pairs}</div>${renderTagOptions()}`;
}

function render() {
  renderIcons();
  renderLayouts();
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
    panel('Sway cubes', 'seat colours: red, gold, cyan, lime, pink', `<p class="small muted">A cube seen from above, shaded from one seat colour.</p><div class="asset-grid">${cubeCards.join('')}</div>`),
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
 * dealt in a fixed deck), and cards held out, in one grid sorted by suit,
 * then type, then action. Tags come from the tuning tournament
 * (scripts/tournament.js out=public/card-play-stats.json, npm run
 * cards:plays), rewritten after every game, so a reload shows results as
 * they come in. Old scores were reset and are no longer shown (designer,
 * 2026-10-07). The figures are a reading aid, not rules.
 */
async function cards() {
  const load = async (/** @type {string} */ url) => { try { const r = await fetch(url, { cache: 'no-store' }); return r.ok ? await r.json() : null; } catch { return null; } };
  /**
   * @typedef {{ held: number, playedPct: number | null, actionPct: number | null, playablePct: number | null, dWinAction: number | null, dWinSway: number | null,
   *   winAfterAction: number | null, opener: number, perAction: Record<string, number | null>, probe: { n: number, benefit: number | null, up: number | null, opening: number | null, openingN: number, noTarget: number } }} CardFigures
   * @type {{ games: number, updated: string, profiles: string[], cards: Record<string, CardFigures> } | null}
   */
  const plays = await load('/card-play-stats.json');
  const sign = (/** @type {number | null | undefined} */ x) => (x === null || x === undefined ? '–' : `${x > 0 ? '+' : ''}${x}`);
  const pctOf = (/** @type {number | null} */ x) => (x === null ? '–' : `${x}%`);
  const tag = (/** @type {string} */ label, /** @type {string} */ v, /** @type {string} */ title, cls = '') => `<span class="review-tag${cls}" title="${esc(title)}">${esc(label)} <b>${esc(v)}</b></span>`;
  // Every figure is banded by rank across the cards that have it: top third green, middle third gold, the rest plain.
  /** @param {(c: CardFigures) => number | null | undefined} get */
  const banding = (get) => {
    const ids = plays ? Object.entries(plays.cards).filter(([, c]) => get(c) !== null && get(c) !== undefined).sort((a, b) => /** @type {number} */ (get(b[1])) - /** @type {number} */ (get(a[1]))).map(([id]) => id) : [];
    return (/** @type {string} */ id) => { const i = ids.indexOf(id); return i < 0 ? '' : i < ids.length / 3 ? ' is-high' : i < (2 * ids.length) / 3 ? ' is-mid' : ''; };
  };
  const band = banding((c) => c.probe.benefit), bandOpen = banding((c) => (c.probe.openingN ? c.probe.opening : null)), bandHeld = banding((c) => c.held),
    bandPlayed = banding((c) => c.playedPct), bandAction = banding((c) => c.actionPct), bandPlayable = banding((c) => c.playablePct), bandDWin = banding((c) => c.dWinAction),
    bandDInfl = banding((c) => c.dWinSway), bandWon = banding((c) => c.winAfterAction), bandBattle = banding((c) => (c.perAction.trophies === null ? null : (c.perAction.trophies ?? 0) + (c.perAction.flips ?? 0))),
    bandMoved = banding((c) => c.perAction.moved);
  const playTags = (/** @type {string} */ id, /** @type {boolean} */ acts) => {
    const c = plays?.cards[id];
    if (!plays) return '';
    if (!c) return '<span class="review-tag">Not seen yet</span>';
    const fx = c.perAction;
    return (c.probe.n ? tag('Probe', sign(c.probe.benefit), `Controlled test: mean change in its player's chance of winning when played, against letting the turn go, the rest of the round played out (${c.probe.n} probes; above 0 in ${c.probe.up}%)`, band(id)) : '')
      + (c.probe.openingN ? tag('Opener probe', sign(c.probe.opening), `The same, at each round's first play (${c.probe.openingN} probes)`, bandOpen(id)) : '')
      + tag('Held', String(c.held), 'Times in a hand at the start of play', bandHeld(id))
      + tag('Played', pctOf(c.playedPct), 'Share of the times it was held that it was played', bandPlayed(id))
      + (acts ? tag('Action', pctOf(c.actionPct), 'Share of its plays that were for its action (the rest spent for sway)', bandAction(id)) : '')
      + (acts ? tag('Playable', pctOf(c.playablePct), 'Share of its holder\'s turns on which it had a legal target', bandPlayable(id)) : '')
      + (acts ? tag('Δ win', sign(c.dWinAction), 'Mean swing in its player\'s chance of winning when played for its action, in percentage points', bandDWin(id)) : '')
      + (c.dWinSway === null ? '' : tag('Δ win (infl.)', sign(c.dWinSway), 'Mean swing in win chance when spent for sway, in percentage points', bandDInfl(id)))
      + (acts ? tag('Won after', pctOf(c.winAfterAction), 'How often its player went on to win after playing it for its action (an even share is 100% ÷ players)', bandWon(id)) : '')
      + (acts && fx.trophies !== null ? tag('Battle', String(Math.round(((fx.trophies ?? 0) + (fx.flips ?? 0)) * 10) / 10), 'Per action play: trophies changing hands at this round\'s fights, plus fights flipped weighted by the tokens lost', bandBattle(id)) : '')
      + (acts && fx.moved !== null ? tag('Moved', String(fx.moved), 'Per action play: pieces moved or placed', bandMoved(id)) : '')
      + (c.opener ? tag('Opened', String(c.opener), 'Times it was played as the round\'s first play') : '');
  };
  /** @typedef {{ id: string, suit: string | null, action: string | null, name: string, round?: number, marked?: string }} AnyCard */
  const deck = /** @type {AnyCard[]} */ (/** @type {unknown} */ (spec.cards));
  const all = deck.map((c) => ({ c, status: c.marked ? `Marked ${c.marked}` : c.suit ? 'Suited' : 'Unsuited' }));
  const suits = [...spec.archetypes.map((a) => a.id), null];
  all.sort((x, y) => suits.indexOf(x.c.suit) - suits.indexOf(y.c.suit) || (x.c.action ?? '').localeCompare(y.c.action ?? '') || x.c.name.localeCompare(y.c.name));
  const tags = (/** @type {AnyCard} */ c, /** @type {string} */ status) => `<div class="review-tags">${playTags(c.id, !!c.action)}<span class="review-tag is-status">${esc(status)}</span><span class="review-tag is-status"><span class="mono">${esc(c.action ?? 'none')}</span></span></div>`;
  const how = plays
    ? `Figures from ${plays.games} bot games of the tuning tournament (${esc(plays.profiles.join(', '))}; updated ${esc(plays.updated.slice(0, 16).replace('T', ' '))}). Every figure is coloured by rank across the cards: green the top third, gold the middle third. <b>Probe</b>: a controlled test, the card played against letting the turn go (cause). The rest come from what the bots chose in whole games (correlation, not cause). Hover a tag for its meaning.`
    : 'No tournament figures yet: run <span class="mono">npm run cards:plays</span>.';
  $('cards').innerHTML = `<div class="row-between"><h2>Cards</h2><span class="small muted">${all.length} cards in the deck</span></div>
    <p class="small muted">Every card in the deck, for review, sorted by suit, then action. ${how}</p>
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
