// @ts-check
/**
 * A player card as the table draws it: shared by the table (app.js) and the
 * assets page's card review. Display only; holds no rules.
 */
import { spec, factionById, cardById } from './rules.js';
import art from './assets/sprites.json' with { type: 'json' };

/** @typedef {import('./rules.js').PlayerView} PlayerView */

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
 * @typedef {{ mode?: '' | 'act' | 'keep', ticked?: boolean, sway?: boolean, back?: boolean, dim?: boolean, selected?: boolean, next?: boolean, reading?: string, use?: string, empty?: string[], why?: Partial<Record<'location' | 'faction', { label: string, met: boolean }[]>>, view?: PlayerView | null, extra?: string }} CardOptions
 */

/** The uses' names on a card, and their short tags. */
const USE_TAGS = /** @type {Record<string, string>} */ ({ Standing: 'STAND', Sway: 'SWAY', Tokens: 'TOKENS', Theirs: 'THEIRS', Yours: 'YOURS' });

/**
 * A card text with uses ("Choose one. Standing: … Sway: … X is …") split into its head, a row per use, and its foot
 * (what X is, or a closing rule); null for any other text. @param {string} text
 */
export function usesOf(text) {
  if (!/^Choose one\./.test(text)) return null;
  const names = Object.keys(USE_TAGS).join('|');
  const parts = text.split(new RegExp(`(?:^|\\s)(${names}): `));
  if (parts.length < 3) return null;
  const head = parts[0].trim();
  /** @type {{ id: string, tag: string, text: string }[]} */
  const rows = [];
  for (let i = 1; i < parts.length; i += 2) { const body = parts[i + 1].trim(); rows.push({ id: parts[i].toLowerCase(), tag: USE_TAGS[parts[i]], text: body.charAt(0).toUpperCase() + body.slice(1) }); }
  // The foot: a closing sentence on the last use that is about the whole card (X, or the last-card rule).
  const last = rows[rows.length - 1];
  const m = /\s((?:X is|It can't be)[^]*)$/.exec(last.text);
  const foot = m ? m[1] : '';
  if (m) last.text = last.text.slice(0, m.index).trim();
  return { head, rows, foot };
}

/**
 * A card. `mode` says what clicking it does: 'act' (play its action),
 * 'keep' (draft), or '' (nothing). `view`
 * names the faction behind each reading; `extra` is HTML added at the foot
 * of the card (the assets page's review tags).
 * @param {string} id @param {CardOptions} [o]
 */
export function cardHtml(id, o = {}) {
  const c = cardById(id);
  const suit = spec.archetypes.find((a) => a.id === c.suit);
  const view = o.view ?? null;
  // The card's sway for this seat now (a signature's is the hand size, D24).
  const printed = view?.printed?.[id] ?? c.sway;
  const sf = view && c.suit ? view.factions.find((f) => factionById(f).archetype === c.suit) : undefined;
  const band = c.suit ? `<span class="suit-line">${suitIcon(c.suit)} ${esc(suit?.name ?? '')}</span><span>${esc(c.slot)}</span>` : `<span>${c.marked ? `Marked ${esc(c.marked)}` : 'Unsuited'}</span><span>${c.marked ? 'opens' : ''}</span>`;
  // The card's options, on its right: its two readings and its sway.
  // Live (clickable) on your turn; lit as the next step once the card is picked.
  const live = !!o.sway;
  // What each reading targets, under the effect; once one is chosen the other fades.
  const r = 'readings' in c ? c.readings : undefined;
  // A reading that can't be played lists what it needs, met (✓) or not (✗) (designer, 2026-10-28).
  const why = (/** @type {'location' | 'faction'} */ m) => o.why?.[m]?.length ? `<ul class="card-why">${(o.why[m] ?? []).map((x) => `<li class="${x.met ? 'is-met' : 'is-unmet'}">${x.met ? '✓' : '✗'} ${esc(x.label)}</li>`).join('')}</ul>` : '';
  const reading = (/** @type {'location' | 'faction'} */ m, /** @type {string} */ label, /** @type {string} */ text) => `<div class="card-reading${o.reading ? (o.reading === m ? ' is-on' : ' is-off') : ''}"><dt>${label}</dt><dd>${esc(text)}${why(m)}</dd></div>`;
  const readings = r ? `<dl class="card-readings small">${reading('location', 'LOC', r.location)}${reading('faction', 'FAC', `${r.faction}${sf ? ` (${fname(sf)})` : ''}`)}</dl>` : '';
  // A card with uses (Choose one. Standing: … Sway: …) reads as a list, one row per use, not a paragraph
  // (designer, 2026-10-29: glanceable); the chosen use stays lit. Presentation only: the words are the card's.
  const uses = usesOf(c.text);
  const opt = (/** @type {string} */ action, /** @type {string} */ inner, /** @type {string} */ tip, /** @type {boolean} */ on, /** @type {Record<string, string>} */ data = {}) => live
    ? `<button class="card-opt${on ? ' is-on' : ''}${o.next ? ' is-next' : ''}${o.empty?.includes(data.mode ?? '') ? ' is-empty' : ''}" data-action="${action}" data-card="${esc(id)}"${Object.entries(data).map(([k, v]) => ` data-${k}="${esc(v)}"`).join('')} title="${esc(tip)}">${inner}</button>`
    : `<span class="card-opt is-off" title="${esc(tip)}">${inner}</span>`;
  const options = c.suit ? `<div class="card-options">
      ${c.action ? opt('set-mode', 'LOC', `Location target: ${r?.location ?? ''}${o.empty?.includes('location') ? ' Nothing to target right now.' : ''}`, o.reading === 'location', { mode: 'location' }) : ''}
      ${c.action ? opt('set-mode', 'FAC', `Faction target: ${r?.faction ?? ''}${sf ? ` (${fname(sf)})` : ''}${o.empty?.includes('faction') ? ' Nothing to target right now.' : ''}`, o.reading === 'faction', { mode: 'faction' }) : ''}
      ${opt('sway', `<b>+${printed}</b>`, `Spend for ${printed} sway with ${sf ? fname(sf) : `the ${suit?.name ?? ''} faction`}`, false)}
      ${o.back ? opt('return', 'BACK', `Bring ${sf ? fname(sf) : 'its faction'} back: up to its sway of tokens at its own locations or where it is, 1 standing with it each`, false) : ''}
    </div>` : '';
  const classes = ['card', `card-suit-${c.suit ?? 'none'}`, o.ticked ? 'card-ticked' : '', o.mode ? `card-${o.mode}` : '', o.dim ? 'card-dim' : '', o.selected ? 'card-selected' : '', o.selected && o.next ? 'card-needs-reading' : ''].filter(Boolean).join(' ');
  const full = `${c.name}. ${c.text}`;
  return `<div class="${classes}" data-card="${esc(id)}" title="${esc(full)}"${o.mode ? ` data-card-mode="${o.mode}"` : ''}>
    <div class="card-band">${band}</div>
    <div class="card-main">
      <div class="card-text">
        <span class="card-name">${esc(c.name)}</span>
        ${uses ? `${uses.head ? `<p class="small">${esc(uses.head)}</p>` : ''}<dl class="card-uses small">${uses.rows.map((u) => `<div class="card-use${o.use ? (o.use === u.id ? ' is-on' : ' is-off') : ''}"><dt>${esc(u.tag)}</dt><dd>${esc(u.text)}</dd></div>`).join('')}</dl>${uses.foot ? `<p class="small card-x">${esc(uses.foot)}</p>` : ''}` : `<p class="small">${esc(c.text)}</p>`}
        ${readings}
      </div>
      ${options}
    </div>
    ${o.extra ?? ''}
  </div>`;
}
