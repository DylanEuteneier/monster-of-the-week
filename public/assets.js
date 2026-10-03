// @ts-check
/**
 * Assets page: every piece of content in spec.json with its sprite (where one
 * is drawn) at 1×, 3× and 6×, plus the palette. Read-only; holds no rules.
 * Sprites are plain static files under /assets/, built by assets/sprites.py.
 */
import { spec } from './engine.js';
import art from './assets/sprites.json' with { type: 'json' };
import { tokenHtml, cubeHtml, SEAT_COLOURS } from './pieces.js';

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

/** @type {{ title: string, size: string, entries: Entry[] }[]} */
const GROUPS = [
  { title: 'Archetype icons', size: '16×16', entries: spec.archetypes },
  { title: 'Faction icons', size: '16×16', entries: spec.factions },
  { title: 'Location tiles', size: '32×32', entries: spec.locations },
  { title: 'Slayer group emblems', size: '16×16', entries: spec.slayerGroups },
];

/** @param {Entry} entry @param {SpriteMap} [from] */
function renderEntry(entry, from = sprites) {
  const sprite = from[entry.id];
  const symbol = entry.archetype ? symbols.get(entry.archetype) : symbols.get(entry.id);
  const label = `<div class="row-between small"><b>${esc(symbol ?? '')} ${esc(entry.name)}</b><span class="mono muted">${esc(entry.id)}</span></div>`;
  if (!sprite) return `<div class="asset asset-missing">${label}<span class="small muted">Not drawn yet</span></div>`;
  const scales = SCALES.map((scale) => `
    <figure class="asset-scale">
      <img class="sprite" src="${esc(sprite.src)}" width="${sprite.width * scale}" height="${sprite.height * scale}" alt="${esc(entry.name)} at ${scale}×">
      <figcaption class="mono small muted">${scale}×</figcaption>
    </figure>`);
  return `<div class="asset">${label}<div class="asset-scales">${scales.join('')}</div><a class="mono small" href="${esc(sprite.src)}">${esc(sprite.src)}</a></div>`;
}

function render() {
  const all = GROUPS.flatMap((group) => group.entries);
  const drawn = all.filter((entry) => sprites[entry.id]).length;
  $('coverage').textContent = `${drawn} of ${all.length} drawn`;
  $('groups').innerHTML = GROUPS.map((group) => {
    const count = group.entries.filter((entry) => sprites[entry.id]).length;
    return `<section class="panel">
      <div class="row-between"><h2>${esc(group.title)} · ${esc(group.size)}</h2><span class="small muted">${count} of ${group.entries.length}</span></div>
      <div class="asset-grid">${group.entries.map((entry) => renderEntry(entry)).join('')}</div>
    </section>`;
  }).join('');
  /** @param {string} title @param {string} body */
  const card = (title, body) => `<div class="asset"><div class="row-between small"><b>${title}</b></div><div class="asset-scales">${body}</div></div>`;
  /** @param {string} html @param {string} caption */
  const fig = (html, caption) => `<figure class="asset-scale">${html || '<span class="small muted">Not drawn yet</span>'}<figcaption class="mono small muted">${caption}</figcaption></figure>`;
  const tokenCards = spec.archetypes.map((entry) => card(`${esc(entry.symbol)} ${esc(entry.name)}`,
    [2, 3, 4].map((scale) => fig(tokenHtml(entry.id, scale), `${scale}×`)).join('')));
  const cubeCards = SEAT_COLOURS.map((colour, i) => card(`Seat ${i + 1} <span class="mono muted">${esc(colour)}</span>`,
    [12, 16, 22].map((size) => fig(cubeHtml(colour, size), `${size}px`)).join('')));
  const stack = (/** @type {string} */ id, /** @type {number} */ n) => `<span class="token-stack">${Array.from({ length: n }, () => tokenHtml(id, 2)).join('')}</span>`;
  const cubes = (/** @type {number} */ seat, /** @type {number} */ n) => `<span class="cube-row">${Array.from({ length: n }, () => cubeHtml(SEAT_COLOURS[seat], 14)).join('')}</span>`;
  const place = `
    <div class="place">
      <img class="sprite" src="/assets/sprites/lighthouse.png" width="96" height="96" alt="The Lighthouse">
      <div class="place-pieces">
        <div class="row-between"><h3>The Lighthouse</h3><span class="small muted">⎈ Demons</span></div>
        <div class="stack-row">${stack('demons', 4)}<span class="count">4</span><span class="small muted">Demons</span></div>
        <div class="stack-row">${stack('scifi', 2)}<span class="count">2</span><span class="small muted">Aliens</span></div>
        <div class="stack-row">${cubes(0, 3)}${cubes(2, 1)}<span class="small muted">Ann 3 · Cat 1</span></div>
      </div>
    </div>`;
  $('pieces').innerHTML = `
    <section class="panel">
      <div class="row-between"><h2>Location layout</h2><span class="small muted">example numbers</span></div>
      <p class="small muted">A location with faction presence (tokens) and player influence (cubes). Sample data, to judge the look; not a game state.</p>
      ${place}
    </section>
    <section class="panel">
      <div class="row-between"><h2>Presence tokens</h2><span class="small muted">CSS card, pixel-art face</span></div>
      <p class="small muted">A cardboard token cut to the art's outline. The outline comes from <span class="mono">assets/sprites.py</span>; the card, edge and shadow are CSS.</p>
      <div class="asset-grid">${tokenCards.join('')}</div>
    </section>
    <section class="panel">
      <div class="row-between"><h2>Influence cubes</h2><span class="small muted">draft seat colours</span></div>
      <p class="small muted">A cube seen from above, shaded from one seat colour.</p>
      <div class="asset-grid">${cubeCards.join('')}</div>
    </section>`;
  $('palette').innerHTML = Object.entries(art.palette)
    .filter(([, colour]) => colour)
    .map(([key, colour]) => `<div class="swatch-row"><i style="background:${esc(colour)}"></i><span class="mono small">${esc(key)} ${esc(colour)}</span></div>`)
    .join('');
}

render();
