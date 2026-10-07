// @ts-check
/**
 * A player card as the table draws it: shared by the table (app.js) and the
 * assets page's card review. Display only; holds no rules.
 */
import { spec, factionById, cardById, responsesOn } from './engine.js';
import art from './assets/sprites.json' with { type: 'json' };

/** @typedef {import('./engine.js').PlayerView} PlayerView */

/** @param {unknown} value */
function esc(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);
}

const SYMBOLS = /** @type {Record<string, { width: number, height: number, src: string }>} */ (art.symbols ?? {});
/** An archetype's pixel symbol (the art on the hexes), or '' if not drawn. @param {string | null | undefined} archetype @param {number} [scale] */
export function suitIcon(archetype, scale = 2) {
  const s = archetype ? SYMBOLS[archetype] : undefined;
  return s ? `<img class="sprite suit-icon" src="${esc(s.src)}" width="${s.width * scale}" height="${s.height * scale}" alt="">` : '';
}
/** @param {string} f */
const fname = (f) => factionById(f).name;

/**
 * @typedef {{ mode?: '' | 'act' | 'respond' | 'keep', ticked?: boolean, influence?: boolean, dim?: boolean, selected?: boolean, next?: boolean, reading?: string, empty?: string[], view?: PlayerView | null, extra?: string }} CardOptions
 */

/**
 * A card. `mode` says what clicking it does: 'act' (play its action),
 * 'respond' (fire its response), 'keep' (draft), or '' (nothing). `view`
 * names the faction behind each reading; `extra` is HTML added at the foot
 * of the card (the assets page's review tags).
 * @param {string} id @param {CardOptions} [o]
 */
export function cardHtml(id, o = {}) {
  const c = cardById(id);
  const suit = spec.archetypes.find((a) => a.id === c.suit);
  const view = o.view ?? null;
  // This game's printed influence (a mixed deck sets it per game).
  const printed = view?.printed?.[id] ?? c.influence;
  const sf = view && c.suit ? view.factions.find((f) => factionById(f).archetype === c.suit) : undefined;
  const band = c.suit ? `<span class="suit-line">${suitIcon(c.suit)} ${esc(suit?.name ?? '')}</span><span>${esc(c.slot)}</span>` : `<span>${c.marked ? `Marked ${esc(c.marked)}` : 'Unsuited'}</span><span>${c.marked ? 'opens' : ''}</span>`;
  // The card's options, on its right: its two readings and its influence.
  // Live (clickable) on your turn; lit as the next step once the card is picked.
  const live = !!o.influence;
  // What each reading targets, under the effect; once one is chosen the other fades.
  const r = 'readings' in c ? c.readings : undefined;
  const reading = (/** @type {'location' | 'faction'} */ m, /** @type {string} */ label, /** @type {string} */ text) => `<div class="card-reading${o.reading ? (o.reading === m ? ' is-on' : ' is-off') : ''}"><dt>${label}</dt><dd>${esc(text)}</dd></div>`;
  const readings = r ? `<dl class="card-readings small">${reading('location', 'LOC', r.location)}${reading('faction', 'FAC', `${r.faction}${sf ? ` (${fname(sf)})` : ''}`)}</dl>` : '';
  const opt = (/** @type {string} */ action, /** @type {string} */ inner, /** @type {string} */ tip, /** @type {boolean} */ on, /** @type {Record<string, string>} */ data = {}) => live
    ? `<button class="card-opt${on ? ' is-on' : ''}${o.next ? ' is-next' : ''}${o.empty?.includes(data.mode ?? '') ? ' is-empty' : ''}" data-action="${action}" data-card="${esc(id)}"${Object.entries(data).map(([k, v]) => ` data-${k}="${esc(v)}"`).join('')} title="${esc(tip)}">${inner}</button>`
    : `<span class="card-opt is-off" title="${esc(tip)}">${inner}</span>`;
  const options = c.suit ? `<div class="card-options">
      ${c.action ? opt('set-mode', 'LOC', `Location target: ${r?.location ?? ''}${o.empty?.includes('location') ? ' Nothing to target right now.' : ''}`, o.reading === 'location', { mode: 'location' }) : ''}
      ${c.action ? opt('set-mode', 'FAC', `Faction target: ${r?.faction ?? ''}${sf ? ` (${fname(sf)})` : ''}${o.empty?.includes('faction') ? ' Nothing to target right now.' : ''}`, o.reading === 'faction', { mode: 'faction' }) : ''}
      ${opt('influence', `<b>+${printed}</b>`, `Spend for ${printed} influence with ${sf ? fname(sf) : `the ${suit?.name ?? ''} faction`}`, false)}
    </div>` : '';
  const classes = ['card', `card-suit-${c.suit ?? 'none'}`, o.ticked ? 'card-ticked' : '', o.mode ? `card-${o.mode}` : '', o.dim ? 'card-dim' : '', o.selected ? 'card-selected' : '', o.selected && o.next ? 'card-needs-reading' : ''].filter(Boolean).join(' ');
  // Responses are out of the first draft: their text shows only when the variant turns them on.
  const response = c.response && view && responsesOn(view) ? c.response : null;
  const full = `${c.name}. ${c.text}${response ? ` Response (${response.timing}): ${response.name}. ${response.text}` : ''}`;
  return `<div class="${classes}" data-card="${esc(id)}" title="${esc(full)}"${o.mode ? ` data-card-mode="${o.mode}"` : ''}>
    <div class="card-band">${band}</div>
    <div class="card-main">
      <div class="card-text">
        <span class="card-name">${esc(c.name)}</span>
        <p class="small">${esc(c.text)}</p>
        ${readings}
        ${response ? `<p class="small card-response"><b>Response, ${esc(response.timing)}: ${esc(response.name)}.</b> ${esc(response.text)}</p>` : ''}
      </div>
      ${options}
    </div>
    ${o.extra ?? ''}
  </div>`;
}
