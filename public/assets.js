// @ts-check
/**
 * Assets page: every piece of content in spec.json with its sprite (where one
 * is drawn) at 1×, 3× and 6×, plus the palette. Read-only; holds no rules.
 * Sprites are plain static files under /assets/, built by assets/sprites.py.
 */
import { spec } from './engine.js';
import art from './assets/sprites.json' with { type: 'json' };

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
const tokens = /** @type {SpriteMap} */ (art.tokens);
const cubes = /** @type {SpriteMap} */ (art.cubes);
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
  const seatEntries = Object.keys(cubes).map((id, i) => ({ id, name: `Seat ${i + 1}` }));
  $('pieces').innerHTML = `
    <section class="panel">
      <div class="row-between"><h2>Presence tokens</h2><span class="small muted">${Object.keys(tokens).length} of ${spec.archetypes.length}</span></div>
      <p class="small muted">Faction presence on a location, drawn as die-cut cardboard tokens. Generated from the archetype icons by <span class="mono">assets/sprites.py</span>.</p>
      <div class="asset-grid">${spec.archetypes.map((entry) => renderEntry(entry, tokens)).join('')}</div>
    </section>
    <section class="panel">
      <div class="row-between"><h2>Influence cubes</h2><span class="small muted">draft seat colours</span></div>
      <p class="small muted">Player influence on a location, one cube per seat colour.</p>
      <div class="asset-grid">${seatEntries.map((entry) => renderEntry(entry, cubes)).join('')}</div>
    </section>`;
  $('palette').innerHTML = Object.entries(art.palette)
    .filter(([, colour]) => colour)
    .map(([key, colour]) => `<div class="swatch-row"><i style="background:${esc(colour)}"></i><span class="mono small">${esc(key)} ${esc(colour)}</span></div>`)
    .join('');
}

render();
